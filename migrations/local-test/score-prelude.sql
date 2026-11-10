-- The score paths of gradebook-prod, for the local harness: the functions
-- the score RPCs need and the RPCs themselves. Each body is copied, text
-- unchanged, from the file named above it: the migration that last defined
-- it. Load after harness.sql and before score-tables.sql, which makes the
-- tables (from docs/schema.generated.sql) with the triggers and policies
-- that call these.
--
--   python3 run.py harness.sql score-prelude.sql score-tables.sql
--
-- import_json_restore's score part and duplicate_course / duplicate_assessment
-- are not here: they need most of the schema. Batch A's restore test loads
-- them.

-- fv_owns_assessment is a SQL function, checked when it is made, and
-- `assessment` does not exist until score-tables.sql.
set check_function_bodies = off;

-- Ownership through the assessment. migrations/20261012_course_soft_delete.sql
create or replace function public.fv_owns_assessment(aid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (select 1 from assessment a join course c on c.id = a.course_id
                   where a.id = aid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

-- The class version every score write bumps. The trigger function is from
-- migrations/20261015_course_sync_version.sql; _touch_course_sync_cursor from
-- migrations/20261103_import_json_restore_full_class.sql (it skips the bump while a restore runs).
create or replace function public._touch_course_sync_cursor_from_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _bucket    text := coalesce(tg_argv[0], 'gradebook');
    _source    text := coalesce(tg_argv[1], 'course');
    _course_id uuid;
    _student_id uuid;
    _row       record;
begin
    if _source = 'student' then
        _student_id := coalesce(new.id, old.id);
        for _row in
            select distinct e.course_id
              from public.enrollment e
             where e.student_id = _student_id
        loop
            perform public._touch_course_sync_cursor(_row.course_id, _bucket);
        end loop;
        return coalesce(new, old);
    end if;

    if _source = 'course' then
        if tg_table_name = 'course' then
            if tg_op = 'DELETE' then
                return old;
            end if;
            _course_id := coalesce(new.id, old.id);
        else
            _course_id := coalesce(new.course_id, old.course_id);
        end if;
    elsif _source = 'assessment' then
        select a.course_id into _course_id
          from public.assessment a
         where a.id = coalesce(new.assessment_id, old.assessment_id);
    elsif _source = 'section' then
        select s.course_id into _course_id
          from public.section s
         where s.id = coalesce(new.section_id, old.section_id);
    elsif _source = 'rubric' then
        select r.course_id into _course_id
          from public.rubric r
         where r.id = coalesce(new.rubric_id, old.rubric_id);
    elsif _source = 'criterion' then
        select r.course_id into _course_id
          from public.criterion c
          join public.rubric r on r.id = c.rubric_id
         where c.id = coalesce(new.criterion_id, old.criterion_id);
    elsif _source = 'observation' then
        select o.course_id into _course_id
          from public.observation o
         where o.id = coalesce(new.observation_id, old.observation_id);
    elsif _source = 'term_rating' then
        select e.course_id into _course_id
          from public.term_rating tr
          join public.enrollment e on e.id = tr.enrollment_id
         where tr.id = coalesce(new.term_rating_id, old.term_rating_id);
    else
        select e.course_id into _course_id
          from public.enrollment e
         where e.id = coalesce(new.enrollment_id, old.enrollment_id, new.id, old.id);
    end if;

    perform public._touch_course_sync_cursor(_course_id, _bucket);
    return coalesce(new, old);
end;
$function$;
create or replace function public._touch_course_sync_cursor(p_course_id uuid, p_bucket text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _client text := left(nullif(current_setting('request.headers', true), '')::json ->> 'x-fv-client', 64);
begin
    if p_course_id is null then
        return;
    end if;

    -- import_json_restore bumps each course once when it finishes.
    if current_setting('fv.restoring', true) = 'on' then
        return;
    end if;

    -- Course already deleted (we are inside its delete cascade): nothing to touch.
    if not exists (select 1 from public.course where id = p_course_id) then
        return;
    end if;

    insert into public.course_sync_cursor (course_id)
    values (p_course_id)
    on conflict (course_id) do nothing;

    update public.course_sync_cursor
       set version = version + 1,
           last_client = _client,
           gradebook_updated_at =
               case when p_bucket = 'gradebook' then now() else gradebook_updated_at end,
           student_records_updated_at =
               case when p_bucket = 'student-records' then now() else student_records_updated_at end
     where course_id = p_course_id;
end;
$function$;

-- category's deferred weight check (assessment points at category). migrations/20261016_category_weights_exactly_100.sql
create or replace function public.fv_check_category_weight_sum()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
    target_course uuid;
    total numeric;
    n int;
begin
    if tg_op = 'DELETE' then
        target_course := old.course_id;
    else
        target_course := new.course_id;
    end if;
    select coalesce(sum(weight), 0), count(*) into total, n from category where course_id = target_course;
    if n > 0 and total <> 100 then
        raise exception 'category weights for course % total % (must be 100)', target_course, total
            using errcode = '23514';  -- check_violation
    end if;
    -- A row that moved to another class leaves the old one changed too.
    if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
        select coalesce(sum(weight), 0), count(*) into total, n from category where course_id = old.course_id;
        if n > 0 and total <> 100 then
            raise exception 'category weights for course % total % (must be 100)', old.course_id, total
                using errcode = '23514';
        end if;
    end if;
    return null;
end;
$function$;

-- The score change history. migrations/20261102_audit_helpers_owner_check.sql
create or replace function public._score_audit_diff(
    p_score_id uuid, p_old_value numeric, p_new_value numeric,
    p_old_status text, p_new_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if not exists (select 1 from score s
                   where s.id = p_score_id and fv_owns_enrollment(s.enrollment_id)) then
        return;
    end if;
    if p_old_value is distinct from p_new_value
       or p_old_status is distinct from p_new_status then
        insert into score_audit (score_id, changed_by,
                                 old_value, new_value, old_status, new_status)
        values (p_score_id, (select auth.uid()),
                p_old_value, p_new_value, p_old_status, p_new_status);
    end if;
end; $function$;

-- upsert_score. migrations/20261022_score_modifier.sql
create function public.upsert_score(p_enrollment_id uuid, p_assessment_id uuid, p_value numeric, p_modifier smallint default null)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _id uuid; _old_v numeric; _old_s text; _old_m smallint;
    _m smallint := coalesce(p_modifier, 0);
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    insert into score (enrollment_id, assessment_id, value, modifier)
    values (p_enrollment_id, p_assessment_id, p_value, _m)
    on conflict (enrollment_id, assessment_id) do nothing
    returning id into _id;

    if _id is not null then
        perform _score_audit_diff(_id, null, p_value, null, null);
        return _id;
    end if;

    select id, value, status, modifier into _id, _old_v, _old_s, _old_m
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;

    if _old_v is distinct from p_value or _old_m is distinct from _m then
        update score set value = p_value, modifier = _m, scored_at = now(), updated_at = now()
         where id = _id;
        if _old_v is distinct from p_value then
            perform _score_audit_diff(_id, _old_v, p_value, _old_s, _old_s);
        end if;
    end if;
    return _id;
end; $function$;

-- upsert_tag_score. migrations/20261027_score_comments.sql
create function public.upsert_tag_score(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_tag_id uuid,
  p_value integer,
  p_modifier smallint default 0,
  p_comment text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _rubric uuid; _mode text; _note text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select rubric_id, score_mode into _rubric, _mode from assessment where id = p_assessment_id;
    if _rubric is not null then
        raise exception 'tag_score is not used for rubric assessments' using errcode = '22023';
    end if;

    if _mode in ('points', 'complete') then
        delete from tag_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        return upsert_score(p_enrollment_id, p_assessment_id, p_value);
    end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its comment.
        if p_comment is null then
            select comment into _note from tag_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        else
            _note := nullif(p_comment, '');
        end if;
        if _note is null then
            delete from tag_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
            return null;
        end if;
        insert into tag_score (enrollment_id, assessment_id, tag_id, value, modifier, comment)
        values (p_enrollment_id, p_assessment_id, p_tag_id, null, 0, _note)
        on conflict (enrollment_id, assessment_id, tag_id) do update
           set value = null, modifier = 0, comment = _note, updated_at = now()
        returning id into _id;
        return _id;
    end if;

    insert into tag_score (enrollment_id, assessment_id, tag_id, value, modifier, comment)
    values (p_enrollment_id, p_assessment_id, p_tag_id, p_value, coalesce(p_modifier, 0), nullif(p_comment, ''))
    on conflict (enrollment_id, assessment_id, tag_id) do update
       set value = excluded.value,
           modifier = excluded.modifier,
           comment = case when p_comment is null then tag_score.comment else nullif(p_comment, '') end,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

-- upsert_rubric_score. migrations/20261027_single_point_rubric.sql
create function public.upsert_rubric_score(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_criterion_id uuid,
  p_value integer,
  p_modifier smallint default 0,
  p_comment text default null,
  p_beyond text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _note text; _beyond text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its notes.
        select comment, beyond into _note, _beyond from rubric_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
        if p_comment is not null then _note := nullif(p_comment, ''); end if;
        if p_beyond is not null then _beyond := nullif(p_beyond, ''); end if;
        if _note is null and _beyond is null then
            delete from rubric_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
            return null;
        end if;
        insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond)
        values (p_enrollment_id, p_assessment_id, p_criterion_id, null, 0, _note, _beyond)
        on conflict (enrollment_id, assessment_id, criterion_id) do update
           set value = null, modifier = 0, comment = _note, beyond = _beyond, updated_at = now()
        returning id into _id;
        return _id;
    end if;

    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value, coalesce(p_modifier, 0),
            nullif(p_comment, ''), nullif(p_beyond, ''))
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value,
           modifier = excluded.modifier,
           comment = case when p_comment is null then rubric_score.comment else nullif(p_comment, '') end,
           beyond = case when p_beyond is null then rubric_score.beyond else nullif(p_beyond, '') end,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

-- fill_rubric. migrations/20261013_proficiency_plus_minus.sql
create or replace function public.fill_rubric(
    p_enrollment_id uuid, p_assessment_id uuid, p_value integer, p_modifier smallint default 0
) returns integer
language plpgsql
set search_path to 'public'
as $function$
declare _n int := 0; _crit record; _rubric uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select rubric_id into _rubric from assessment where id = p_assessment_id;
    if _rubric is null then
        raise exception 'assessment % has no rubric', p_assessment_id using errcode = '22023';
    end if;

    for _crit in select id from criterion where rubric_id = _rubric loop
        perform upsert_rubric_score(p_enrollment_id, p_assessment_id, _crit.id, p_value, p_modifier);
        _n := _n + 1;
    end loop;
    return _n;
end; $function$;

-- set_rubric_check. migrations/20261022_advanced_rubric_checks.sql
create or replace function public.set_rubric_check(
    p_enrollment_id uuid,
    p_assessment_id uuid,
    p_check_id      uuid,
    p_on            boolean
) returns boolean
language plpgsql set search_path to 'public' as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    -- The check must sit in the rubric the assessment uses. Row security on
    -- the joined tables keeps this to the teacher's own classes.
    if not exists (
        select 1
          from criterion_check ck
          join criterion c on c.id = ck.criterion_id
          join assessment a on a.rubric_id = c.rubric_id
         where ck.id = p_check_id and a.id = p_assessment_id
    ) then
        raise exception 'check % is not in the rubric of assessment %', p_check_id, p_assessment_id
            using errcode = '22023';
    end if;

    if coalesce(p_on, false) then
        insert into rubric_check_score (enrollment_id, assessment_id, check_id)
        values (p_enrollment_id, p_assessment_id, p_check_id)
        on conflict do nothing;
        return true;
    end if;

    delete from rubric_check_score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and check_id = p_check_id;
    return false;
end;
$function$;

-- save_score_report_note. migrations/20261031_score_report_note.sql
create or replace function public.save_score_report_note(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_note text,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _note text; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'save_score_report_note');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    _note := nullif(btrim(p_note), '');
    if char_length(_note) > 300 then
        raise exception 'report note must be 300 characters or fewer' using errcode = '22023';
    end if;

    select id into _id from score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;

    if _id is null then
        insert into score (enrollment_id, assessment_id, report_note)
        values (p_enrollment_id, p_assessment_id, _note)
        returning id into _id;
    else
        update score set report_note = _note, updated_at = now() where id = _id;
    end if;

    perform fv_idem_store(p_idempotency_key, 'save_score_report_note', jsonb_build_object('id', _id));
    return _id;
end; $function$;

-- clear_score. migrations/20261103_clear_score_keeps_comment.sql
create or replace function public.clear_score(p_enrollment_id uuid, p_assessment_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _id uuid; _old_v numeric; _old_s text; _keep boolean;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select id, value, status,
           status is not null
           or nullif(btrim(comment), '') is not null
           or report_note is not null
      into _id, _old_v, _old_s, _keep
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;

    if _id is not null then
        perform _score_audit_diff(_id, _old_v, null, _old_s, _old_s);
        if _keep then
            update score set value = null, modifier = 0, updated_at = now() where id = _id;
        else
            delete from score where id = _id;
        end if;
    end if;
    delete from rubric_score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    delete from tag_score    where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
end; $function$;

-- move_rubric_scores. migrations/20261102_move_rubric_scores.sql
create or replace function public.move_rubric_scores(
    p_assessment_id   uuid,
    p_rubric_id       uuid,
    p_criterion_map   jsonb,          -- { "<old criterion id>": "<new criterion id>" }
    p_check_map       jsonb default '{}'::jsonb,
    p_idempotency_key uuid default null
) returns jsonb
language plpgsql set search_path to 'public' as $function$
declare
    _cached  jsonb;
    _course  uuid;
    _moved   int := 0;
    _checks  int := 0;
    _result  jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment % not found', p_assessment_id using errcode = '42501';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'move_rubric_scores');
    if _cached is not null then return _cached; end if;

    -- The copy must be a rubric in the assessment's class.
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    if not exists (select 1 from rubric r where r.id = p_rubric_id and r.course_id = _course) then
        raise exception 'rubric % is not in the class of assessment %', p_rubric_id, p_assessment_id
            using errcode = '22023';
    end if;
    -- Every target criterion is on that rubric; every target check on one of its criteria.
    if exists (
        select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
         where not exists (select 1 from criterion c where c.id = m.value::uuid and c.rubric_id = p_rubric_id)
    ) then
        raise exception 'a target criterion is not on rubric %', p_rubric_id using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
         where not exists (
            select 1 from criterion_check ck join criterion c on c.id = ck.criterion_id
             where ck.id = m.value::uuid and c.rubric_id = p_rubric_id)
    ) then
        raise exception 'a target check is not on rubric %', p_rubric_id using errcode = '22023';
    end if;

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()
      from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
     where rs.assessment_id = p_assessment_id
       and rs.criterion_id = m.key::uuid
       -- a score already on the new criterion (a retry) is left as it is
       and not exists (select 1 from rubric_score x
                        where x.enrollment_id = rs.enrollment_id and x.assessment_id = p_assessment_id
                          and x.criterion_id = m.value::uuid);
    get diagnostics _moved = row_count;

    update rubric_check_score cs
       set check_id = m.value::uuid
      from jsonb_each_text(coalesce(p_check_map, '{}')) m
     where cs.assessment_id = p_assessment_id
       and cs.check_id = m.key::uuid
       and not exists (select 1 from rubric_check_score x
                        where x.enrollment_id = cs.enrollment_id and x.assessment_id = p_assessment_id
                          and x.check_id = m.value::uuid);
    get diagnostics _checks = row_count;

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);
    perform fv_idem_store(p_idempotency_key, 'move_rubric_scores', _result);
    return _result;
end;
$function$;

-- set_score_status, save_score_comment, clear_row_scores and clear_column_scores
-- have no migration file: they were applied in April 2026 from the design
-- file docs/backend-design/write-paths.sql ("Phase 1.7") and no
-- migration in the repo has redefined them since. These are that file's
-- bodies. docs/schema.generated.sql confirms the live signatures and that
-- all four are SECURITY INVOKER; it does not hold bodies, so the live
-- bodies are unconfirmed (compare with pg_get_functiondef on gradebook-prod).
create or replace function set_score_status(
    p_enrollment_id uuid, p_assessment_id uuid, p_status text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _old_v numeric; _old_s text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_status is not null and p_status not in ('NS','EXC','LATE') then
        raise exception 'invalid status %', p_status using errcode = '22023';
    end if;
    select id, value, status into _id, _old_v, _old_s
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is null then
        insert into score (enrollment_id, assessment_id, status)
        values (p_enrollment_id, p_assessment_id, p_status) returning id into _id;
        perform _score_audit_diff(_id, null, null, null, p_status);
    else
        update score set status = p_status, updated_at = now() where id = _id;
        perform _score_audit_diff(_id, _old_v, _old_v, _old_s, p_status);
    end if;
    return _id;
end; $$;
create or replace function save_score_comment(
    p_enrollment_id uuid, p_assessment_id uuid, p_comment text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select id into _id from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is null then
        insert into score (enrollment_id, assessment_id, comment)
        values (p_enrollment_id, p_assessment_id, p_comment) returning id into _id;
    else
        update score set comment = p_comment, updated_at = now() where id = _id;
    end if;
    return _id;
end; $$;
create or replace function clear_row_scores(p_enrollment_id uuid, p_course_id uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int := 0; _s record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    for _s in select s.id, s.value, s.status from score s
              join assessment a on a.id = s.assessment_id
              where s.enrollment_id = p_enrollment_id and a.course_id = p_course_id
    loop
        perform _score_audit_diff(_s.id, _s.value, null, _s.status, null);
        _n := _n + 1;
    end loop;
    delete from score
     where enrollment_id = p_enrollment_id
       and assessment_id in (select id from assessment where course_id = p_course_id);
    delete from rubric_score
     where enrollment_id = p_enrollment_id
       and assessment_id in (select id from assessment where course_id = p_course_id);
    delete from tag_score
     where enrollment_id = p_enrollment_id
       and assessment_id in (select id from assessment where course_id = p_course_id);
    return _n;
end; $$;
create or replace function clear_column_scores(p_assessment_id uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int := 0; _s record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    for _s in select id, value, status from score where assessment_id = p_assessment_id
    loop
        perform _score_audit_diff(_s.id, _s.value, null, _s.status, null);
        _n := _n + 1;
    end loop;
    delete from score        where assessment_id = p_assessment_id;
    delete from rubric_score where assessment_id = p_assessment_id;
    delete from tag_score    where assessment_id = p_assessment_id;
    return _n;
end; $$;

set check_function_bodies = on;

-- As production: signed-out callers run no function, signed-in teachers run
-- the RPCs and the helpers the SECURITY INVOKER RPCs call, and only triggers
-- run the sync-cursor functions (migrations/20261013_revoke_anon_function_execute.sql
-- and the revoke at the end of migrations/20261015_course_sync_version.sql;
-- each RPC's own migration grants it to authenticated).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to service_role;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
grant execute on function
  public.fv_idem_check(uuid, text), public.fv_idem_store(uuid, text, jsonb),
  public.fv_owns_course(uuid), public.fv_owns_enrollment(uuid), public.fv_owns_assessment(uuid),
  public._score_audit_diff(uuid, numeric, numeric, text, text),
  public.upsert_score(uuid, uuid, numeric, smallint),
  public.upsert_tag_score(uuid, uuid, uuid, integer, smallint, text),
  public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text),
  public.fill_rubric(uuid, uuid, integer, smallint),
  public.set_rubric_check(uuid, uuid, uuid, boolean),
  public.save_score_report_note(uuid, uuid, text, uuid),
  public.clear_score(uuid, uuid),
  public.move_rubric_scores(uuid, uuid, jsonb, jsonb, uuid),
  public.set_score_status(uuid, uuid, text),
  public.save_score_comment(uuid, uuid, text),
  public.clear_row_scores(uuid, uuid),
  public.clear_column_scores(uuid)
  to authenticated;
revoke execute on function public._touch_course_sync_cursor(uuid, text) from public, anon, authenticated;
revoke execute on function public._touch_course_sync_cursor_from_trigger() from public, anon, authenticated;
