-- Printed by scripts/db-baseline.sql from gradebook-prod's system catalogs.
-- Don't edit by hand: refresh it with the Database baseline workflow (docs/database-rebuild.md).
-- Bodies are read when a routine runs, not when it is made, so the order
-- below (by name) needs nothing else to exist first.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION fv_private.grade_return_remap(p_assessment_id uuid, p_criterion_map jsonb, p_check_map jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    -- Only inside move_rubric_scores, and only for the caller's own class.
    if coalesce(current_setting('fv.moving_rubric', true), '') <> 'on'
       or not fv_owns_assessment(p_assessment_id) then
        return;
    end if;
    perform _grade_return_lock((select a.course_id from assessment a where a.id = p_assessment_id));
    update grade_return g
       set returned_copy = _grade_copy_remap(g.returned_copy, coalesce(p_criterion_map, '{}'::jsonb), coalesce(p_check_map, '{}'::jsonb)),
           previous_copy = _grade_copy_remap(g.previous_copy, coalesce(p_criterion_map, '{}'::jsonb), coalesce(p_check_map, '{}'::jsonb))
     where g.assessment_id = p_assessment_id
       and (g.returned_copy is not null or g.previous_copy is not null);
end;
$function$;

CREATE OR REPLACE FUNCTION fv_private.handout_path_parts(p_name text)
 RETURNS TABLE(course_id uuid, resource_id uuid, page integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select m[1]::uuid, m[2]::uuid, m[3]::integer
      from regexp_match(p_name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/handouts/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([1-9][0-9]?)\.jpg$') m
     where m is not null;
$function$;

CREATE OR REPLACE FUNCTION fv_private.handout_read_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = 'pdf' and h.page <= r.page_count
                      and fv_owns_assessment(r.assessment_id));
$function$;

CREATE OR REPLACE FUNCTION fv_private.handout_upload_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = 'pdf' and h.page <= r.page_count
                      and r.status = 'uploading'
                      and r.created_at >= now() - _work_hold()
                      and fv_owns_assessment(r.assessment_id));
$function$;

CREATE OR REPLACE FUNCTION fv_private.report_note_hold(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    update grade_return g
       set held_note = (select s.report_note from score s
                         where s.enrollment_id = g.enrollment_id and s.assessment_id = g.assessment_id),
           held_note_at = g.returned_at
     where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
       and g.is_draft and g.returned_at is not null
       and g.held_note_at is distinct from g.returned_at
       and fv_owns_enrollment(p_enrollment_id);
$function$;

CREATE OR REPLACE FUNCTION fv_private.restore_grade_returns(p_payload jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _at     timestamptz := clock_timestamp();
    _n      integer := 0;
    _es     uuid[];
    _as     uuid[];
    _course uuid;
begin
    if (select auth.uid()) is null or coalesce(current_setting('fv.restoring', true), '') <> 'on' then
        return 0;
    end if;

    -- Every student and assessment of the caller's that the payload names a
    -- grade or a state for.
    select coalesce(array_agg(c.enrollment_id), '{}'), coalesce(array_agg(c.assessment_id), '{}')
      into _es, _as
      from (select distinct (r->>'enrollment_id')::uuid as enrollment_id, (r->>'assessment_id')::uuid as assessment_id
              from (select 'scores' union all select 'rubric_scores' union all select 'tag_scores'
                    union all select 'rubric_check_scores' union all select 'grade_returns') k(arr)
             cross join lateral jsonb_array_elements(
                     case when jsonb_typeof(p_payload->k.arr) = 'array' then p_payload->k.arr else '[]'::jsonb end) r
             where nullif(r->>'enrollment_id', '') is not null and nullif(r->>'assessment_id', '') is not null) c
      join enrollment e on e.id = c.enrollment_id
      join assessment a on a.id = c.assessment_id and a.course_id = e.course_id
     where fv_owns_enrollment(c.enrollment_id);

    -- The restore's rows are in. Now the class lock for each class the
    -- payload names, or names a grade in, in id order, as any writer takes
    -- it after its rows (the sync-cursor triggers stood aside during the
    -- restore). A restore always makes a new class in the app; a hand-made
    -- one that names a class the teacher already has waits here for any
    -- save to it.
    for _course in
        select c.id from course c
         where c.teacher_id = (select auth.uid())
           and (c.id::text in (select r->>'id' from jsonb_array_elements(
                    case when jsonb_typeof(p_payload->'courses') = 'array' then p_payload->'courses' else '[]'::jsonb end) r)
                or c.id in (select e.course_id from enrollment e where e.id = any (_es)))
         order by c.id
    loop
        perform _grade_return_lock(_course);
    end loop;

    -- Every restored student and assessment that now has a grade: Returned.
    insert into grade_return (enrollment_id, assessment_id, is_draft, returned_at)
    select c.enrollment_id, c.assessment_id, false, _at
      from (select distinct (r->>'enrollment_id')::uuid as enrollment_id, (r->>'assessment_id')::uuid as assessment_id
              from (select 'scores' union all select 'rubric_scores' union all select 'tag_scores'
                    union all select 'rubric_check_scores') k(arr)
             cross join lateral jsonb_array_elements(
                     case when jsonb_typeof(p_payload->k.arr) = 'array' then p_payload->k.arr else '[]'::jsonb end) r
             where nullif(r->>'enrollment_id', '') is not null and nullif(r->>'assessment_id', '') is not null) c
      join enrollment e on e.id = c.enrollment_id
      join assessment a on a.id = c.assessment_id and a.course_id = e.course_id
     where fv_owns_enrollment(c.enrollment_id)
       and _grade_copy(c.enrollment_id, c.assessment_id) is not null
    on conflict (enrollment_id, assessment_id) do update
       set is_draft = false, returned_at = coalesce(grade_return.returned_at, excluded.returned_at), returned_copy = null;

    -- Then the backup's own state, where it has one. A row is made to fit the
    -- table's rule: a returned copy is kept only on a draft of a returned
    -- grade; a draft with no copy is a draft never returned (the student is
    -- given nothing); a grade that is not a draft and has something in it
    -- was returned.
    if jsonb_typeof(p_payload->'grade_returns') = 'array' then
        insert into grade_return (enrollment_id, assessment_id, is_draft, returned_at, returned_copy,
                                  previous_copy, updated_at, seen_at)
        select x.enrollment_id, x.assessment_id,
               x.is_draft and (x.has_grade or x.copy is not null),
               case when x.is_draft and (x.has_grade or x.copy is not null)
                         then case when x.copy is not null then x.returned_at end
                    when x.has_grade then coalesce(x.returned_at, _at) end,
               x.copy, x.previous, x.updated_at, x.seen_at
          from (select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid)
                       (r->>'enrollment_id')::uuid as enrollment_id, (r->>'assessment_id')::uuid as assessment_id,
                       coalesce((r->>'is_draft')::boolean, false) as is_draft,
                       nullif(r->>'returned_at', '')::timestamptz as returned_at,
                       -- kept only on a draft of a returned grade
                       case when coalesce((r->>'is_draft')::boolean, false) and nullif(r->>'returned_at', '') is not null
                                 and jsonb_typeof(r->'returned_copy') = 'object' then r->'returned_copy' end as copy,
                       case when jsonb_typeof(r->'previous_copy') = 'object' then r->'previous_copy' end as previous,
                       nullif(r->>'updated_at', '')::timestamptz as updated_at,
                       nullif(r->>'seen_at', '')::timestamptz as seen_at,
                       _grade_copy((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid) is not null as has_grade
                  from jsonb_array_elements(p_payload->'grade_returns') r
                 where nullif(r->>'enrollment_id', '') is not null and nullif(r->>'assessment_id', '') is not null) x
          join enrollment e on e.id = x.enrollment_id
          join assessment a on a.id = x.assessment_id and a.course_id = e.course_id
         where fv_owns_enrollment(x.enrollment_id)
        on conflict (enrollment_id, assessment_id) do update
           set is_draft = excluded.is_draft, returned_at = excluded.returned_at, returned_copy = excluded.returned_copy,
               previous_copy = excluded.previous_copy, updated_at = excluded.updated_at, seen_at = excluded.seen_at;
        get diagnostics _n = row_count;
    end if;

    -- A draft waits only in a class that holds grades. In a restored class
    -- that does not, every draft is returned, as when a class leaves When I
    -- Return Them: the ones the backup named, and any the class already had
    -- (the course trigger stood aside during the restore).
    perform _grade_return_one(g.enrollment_id, g.assessment_id, _at)
       from grade_return g
       join enrollment e on e.id = g.enrollment_id
       join course c on c.id = e.course_id
      where g.is_draft and c.teacher_id = (select auth.uid())
        and (c.id::text in (select r->>'id' from jsonb_array_elements(
                 case when jsonb_typeof(p_payload->'courses') = 'array' then p_payload->'courses' else '[]'::jsonb end) r)
             -- or a class the payload names a grade or a state in (2026110905)
             or c.id in (select e2.course_id from enrollment e2 where e2.id = any (_es)))
        and not (c.student_page_enabled and c.return_grades is not distinct from 'on_return');

    -- And the working copy the next save to each is compared with.
    update grade_return g
       set working_copy = _grade_copy(g.enrollment_id, g.assessment_id)
      from unnest(_es, _as) c(enrollment_id, assessment_id)
     where g.enrollment_id = c.enrollment_id and g.assessment_id = c.assessment_id
       and g.working_copy is distinct from _grade_copy(g.enrollment_id, g.assessment_id);
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION fv_private.work_path_course(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then split_part(p_name, '/', 1)::uuid end;
$function$;

CREATE OR REPLACE FUNCTION fv_private.work_read_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from submission_file f
                     join submission s on s.id = f.submission_id
                    where (f.path = p_name or f.thumb_path = p_name)
                      and (s.state = 'sent' or s.sent_by = 'teacher')
                      and fv_owns_course(s.course_id));
$function$;

CREATE OR REPLACE FUNCTION fv_private.work_upload_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from submission_file f
                     join submission s on s.id = f.submission_id
                    where (f.path = p_name or f.thumb_path = p_name)
                      and s.state = 'sending' and s.sent_by = 'teacher'
                      and s.created_at >= now() - _work_hold()
                      and fv_owns_course(s.course_id));
$function$;

CREATE OR REPLACE FUNCTION public._access_code_hash(p_code text, p_salt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select encode(sha256(convert_to(p_salt || ':' || upper(replace(btrim(p_code), '-', '')), 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public._assessment_resource_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _grade_return_lock(old.course_id);
    delete from assessment_resource where assessment_id = old.id;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._assessment_resource_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object('id', r.id, 'assessment_id', r.assessment_id, 'kind', r.kind, 'title', r.title,
                              'url', r.url, 'page_count', r.page_count, 'status', r.status, 'position', r.position,
                              'created_at', r.created_at, 'updated_at', r.updated_at)
           || case when r.kind = 'pdf'
                   then jsonb_build_object('paths', (select jsonb_agg(_handout_path(r.course_id, r.id, n) order by n)
                                                       from generate_series(1, r.page_count) n))
                   else '{}'::jsonb end
           || case when r.kind = 'pdf' and r.status = 'uploading'
                   then jsonb_build_object('finish_by', r.created_at + _work_hold())
                   else '{}'::jsonb end
      from assessment_resource r
     where r.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public._assessment_resource_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _why text := coalesce(nullif(current_setting('fv.handout_removal_reason', true), ''), 'handout_removed');
begin
    if old.kind = 'pdf' then
        insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
        select _work_bucket(), _handout_path(old.course_id, old.id, n), old.course_id, _why, now() + interval '10 minutes'
          from generate_series(1, old.page_count) n
        on conflict (bucket, path) do nothing;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._assessment_resource_same_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if not exists (select 1 from assessment a where a.id = new.assessment_id and a.course_id = new.course_id) then
        raise exception 'assessment_resource: the assessment is not in this class' using errcode = '23514';
    end if;
    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public._assessment_resource_truncated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    delete from assessment_resource r
     where not exists (select 1 from assessment a where a.id = r.assessment_id);
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._assessment_work_json(p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object('id', a.id, 'students_send', a.students_send, 'after_due', a.after_due,
                              'accept_until', a.accept_until, 'group_work', a.group_work,
                              'students_see_markup', a.students_see_markup)
      from assessment a
     where a.id = p_assessment_id;
$function$;

CREATE OR REPLACE FUNCTION public._cards_work_until(p_course_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select coalesce(
        c.cards_work_until,
        -- the last reporting date, unless it has already passed
        (select max(_fv_date(t->>'ends_on')) from jsonb_array_elements(
             case when jsonb_typeof(c.reporting_terms) = 'array' then c.reporting_terms else '[]'::jsonb end) t
         having max(_fv_date(t->>'ends_on')) >= (now() at time zone _fv_timezone(c.timezone))::date),
        -- No reporting date ahead: the next June 30, today included.
        (select make_date(extract(year from d.today)::int
                            + case when d.today > make_date(extract(year from d.today)::int, 6, 30) then 1 else 0 end, 6, 30)
           from (select (now() at time zone _fv_timezone(c.timezone))::date as today) d))
      from course c
     where c.id = p_course_id;
$function$;

CREATE OR REPLACE FUNCTION public._fv_date(p text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
    return p::date;
exception when others then
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._fv_release_orphan_teacher_email()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _uid   uuid := (select auth.uid());
    _email text := nullif(btrim(coalesce((select auth.jwt()) ->> 'email', '')), '');
begin
    if _uid is null or _email is null then
        return;
    end if;

    update teacher t
       set deleted_at = coalesce(t.deleted_at, now()),
           email      = t.email || ' (sign-in removed ' || to_char(now(), 'YYYY-MM-DD')
                        || ', ' || left(t.id::text, 8) || ')'
     where lower(t.email) = lower(_email)
       and t.id <> _uid
       and not exists (select 1 from auth.users u where u.id = t.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public._fv_teacher_sign_in_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    update teacher
       set deleted_at = coalesce(deleted_at, now())
     where id = old.id;
    return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public._fv_timezone(p_tz text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if nullif(btrim(p_tz), '') is null then return 'America/Vancouver'; end if;
    perform now() at time zone p_tz;
    return p_tz;
exception when others then
    return 'America/Vancouver';
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_copy(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select _grade_copy_of(
        (select s.value from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id),
        (select s.modifier from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id),
        (select s.comment from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id),
        (select jsonb_object_agg(t.tag_id::text, _grade_copy_entry(t.value, t.modifier, t.comment, null, false))
           from tag_score t
          where t.enrollment_id = p_enrollment_id and t.assessment_id = p_assessment_id
            and _grade_copy_entry(t.value, t.modifier, t.comment, null, false) is not null),
        (select jsonb_object_agg(r.criterion_id::text, _grade_copy_entry(r.value, r.modifier, r.comment, r.beyond, true))
           from rubric_score r
          where r.enrollment_id = p_enrollment_id and r.assessment_id = p_assessment_id
            and _grade_copy_entry(r.value, r.modifier, r.comment, r.beyond, true) is not null),
        (select jsonb_agg(k.check_id::text)
           from rubric_check_score k
          where k.enrollment_id = p_enrollment_id and k.assessment_id = p_assessment_id));
$function$;

CREATE OR REPLACE FUNCTION public._grade_copy_entry(p_value integer, p_modifier integer, p_comment text, p_beyond text, p_criterion boolean)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case
        when p_value is null and nullif(btrim(p_comment), '') is null and nullif(btrim(p_beyond), '') is null then null
        else jsonb_build_object(
                 'value', p_value,
                 'modifier', case when p_value is null then 0 else coalesce(p_modifier, 0) end,
                 'comment', case when nullif(btrim(p_comment), '') is null then null else p_comment end)
             || case when p_criterion
                     then jsonb_build_object('beyond', case when nullif(btrim(p_beyond), '') is null then null else p_beyond end)
                     else '{}'::jsonb end
    end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_copy_in_use(p_copy jsonb, p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case when p_copy is null then null else (
        select _grade_copy_of(
            -- score.value: points and marks (a 0 is a score); or, on work
            -- scored by level with no rubric, the Overall level when the
            -- grade holds no competency or criterion row at all (a 0 is
            -- none). The app shows that level under the work's first
            -- competency, or as Overall when it has none (shared/data.js,
            -- "fallbackTag").
            case when a.rubric_id is not null then null
                 when a.score_mode in ('points', 'complete') then (p_copy->>'value')::numeric
                 when a.score_mode = 'proficiency'
                      and coalesce(p_copy->'tags', '{}'::jsonb) = '{}'::jsonb
                      and coalesce(p_copy->'criteria', '{}'::jsonb) = '{}'::jsonb
                 then nullif((p_copy->>'value')::numeric, 0)
            end,
            (p_copy->>'modifier')::int,
            p_copy->>'comment',
            -- competency levels: work with no rubric, scored by level, for
            -- the competencies it is linked to that are still on the class
            case when a.rubric_id is null and a.score_mode = 'proficiency' then (
                select jsonb_object_agg(e.key, e.value)
                  from jsonb_each(coalesce(p_copy->'tags', '{}'::jsonb)) e
                 where exists (select 1 from assessment_tag x
                                 join tag t on t.id = x.tag_id
                                 join section s on s.id = t.section_id
                                where x.assessment_id = a.id and x.tag_id::text = e.key
                                  and s.course_id = a.course_id and s.removed_at is null)) end,
            -- criterion levels and ticks: the rubric the work has now
            case when a.rubric_id is not null then (
                select jsonb_object_agg(e.key, e.value)
                  from jsonb_each(coalesce(p_copy->'criteria', '{}'::jsonb)) e
                 where exists (select 1 from criterion c where c.id::text = e.key and c.rubric_id = a.rubric_id)) end,
            case when a.rubric_id is not null then (
                select jsonb_agg(k)
                  from jsonb_array_elements_text(coalesce(p_copy->'checks', '[]'::jsonb)) k
                 where exists (select 1 from criterion_check ck join criterion c on c.id = ck.criterion_id
                                where ck.id::text = k and c.rubric_id = a.rubric_id)) end)
          from assessment a
         where a.id = p_assessment_id) end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_copy_of(p_value numeric, p_modifier integer, p_comment text, p_tags jsonb, p_criteria jsonb, p_checks jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case
        when p_value is null and nullif(btrim(p_comment), '') is null
             and coalesce(p_tags, '{}'::jsonb) = '{}'::jsonb
             and coalesce(p_criteria, '{}'::jsonb) = '{}'::jsonb
             and coalesce(p_checks, '[]'::jsonb) = '[]'::jsonb
        then null
        else jsonb_build_object(
            'v', 1,
            'value', p_value,
            'modifier', case when p_value is null then 0 else coalesce(p_modifier, 0) end,
            'comment', case when nullif(btrim(p_comment), '') is null then null else p_comment end,
            'tags', coalesce(p_tags, '{}'::jsonb),
            'criteria', coalesce(p_criteria, '{}'::jsonb),
            'checks', coalesce((select jsonb_agg(x order by x collate "C") from jsonb_array_elements_text(p_checks) x), '[]'::jsonb))
    end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_copy_remap(p_copy jsonb, p_criterion_map jsonb, p_check_map jsonb, p_tag_map jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case when p_copy is null then null else _grade_copy_of(
        (p_copy->>'value')::numeric, (p_copy->>'modifier')::int, p_copy->>'comment',
        (select coalesce(jsonb_object_agg(coalesce(p_tag_map->>e.key, e.key), e.value), '{}'::jsonb)
           from jsonb_each(coalesce(p_copy->'tags', '{}'::jsonb)) e),
        (select coalesce(jsonb_object_agg(coalesce(p_criterion_map->>e.key, e.key), e.value), '{}'::jsonb)
           from jsonb_each(coalesce(p_copy->'criteria', '{}'::jsonb)) e),
        (select coalesce(jsonb_agg(coalesce(p_check_map->>x, x)), '[]'::jsonb)
           from jsonb_array_elements_text(coalesce(p_copy->'checks', '[]'::jsonb)) x)) end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_apply(p_enrollment_id uuid, p_assessment_id uuid, p_before jsonb, _now jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _g       grade_return%rowtype;
    _has     boolean;
    _changed boolean := _now is distinct from p_before;
    _at      timestamptz := clock_timestamp();
begin
    select * into _g from grade_return
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;
    _has := found;

    if _grade_return_holds(p_enrollment_id) then
        -- When I Return Them: a change waits as a draft.
        if not _has then
            if _changed and _now is not null then
                insert into grade_return (enrollment_id, assessment_id, is_draft)
                values (p_enrollment_id, p_assessment_id, true)
                on conflict (enrollment_id, assessment_id) do nothing;
            end if;
        elsif not _g.is_draft then
            if not _changed then
                null;  -- a save that changed nothing
            elsif _g.returned_at is not null and p_before is not null then
                update grade_return set is_draft = true, returned_copy = p_before
                 where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
            else
                update grade_return
                   set is_draft = _now is not null, returned_at = null, previous_copy = null, updated_at = null
                 where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
            end if;
        elsif _g.returned_copy is not null then
            -- A draft on a returned grade: put back, it is Returned again.
            if _now is not distinct from _g.returned_copy then
                update grade_return set is_draft = false, returned_copy = null
                 where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
            end if;
        elsif _now is null then
            -- A draft never returned, with nothing left in it.
            update grade_return set is_draft = false
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
        end if;
        return;
    end if;

    -- Any other class: a save that changes the grade is returned at once.
    if not _changed then
        return;
    end if;
    if not _has then
        if _now is not null then
            insert into grade_return (enrollment_id, assessment_id, is_draft, returned_at)
            values (p_enrollment_id, p_assessment_id, false, _at)
            on conflict (enrollment_id, assessment_id) do nothing;
        end if;
    elsif _now is null then
        update grade_return
           set is_draft = false, returned_at = null, returned_copy = null, previous_copy = null, updated_at = null
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    elsif _g.is_draft then
        -- A draft left from When I Return Them: this save returns it.
        update grade_return
           set is_draft = false, returned_at = _at, returned_copy = null,
               previous_copy = case when _g.returned_copy is not null and _g.returned_copy <> _now
                                    then _g.returned_copy else previous_copy end,
               updated_at = case when _g.returned_copy is not null and _g.returned_copy <> _now
                                 then _at else updated_at end
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    elsif _g.returned_at is null then
        update grade_return set returned_at = _at
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    elsif _g.seen_at is not null and _g.seen_at >= _g.returned_at and p_before is not null then
        update grade_return set returned_at = _at, previous_copy = p_before, updated_at = _at
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    elsif _g.previous_copy is not null and _g.previous_copy = _now then
        update grade_return set returned_at = _at, previous_copy = null, updated_at = null
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    else
        update grade_return
           set returned_at = _at, updated_at = case when previous_copy is not null then _at else updated_at end
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _grade_return_lock(old.course_id);
    if tg_table_name = 'enrollment' then
        delete from grade_return where enrollment_id = old.id;
    else
        delete from grade_return where assessment_id = old.id;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_holds(p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select coalesce((select c.student_page_enabled and c.return_grades = 'on_return'
                       from enrollment e join course c on c.id = e.course_id
                      where e.id = p_enrollment_id), false);
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_lock(p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    insert into course_sync_cursor (course_id)
    select p_course_id where exists (select 1 from course where id = p_course_id)
    on conflict (course_id) do nothing;
    perform 1 from course_sync_cursor where course_id = p_course_id for update;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_lock_first(p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    for _try in 1..5 loop
        begin
            perform _grade_return_lock(p_course_id);
            return;
        exception when deadlock_detected then
            null;
        end;
    end loop;
    perform _grade_return_lock(p_course_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_mode_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _e uuid;
begin
    -- import_json_restore sets the state itself when its rows are in.
    if current_setting('fv.restoring', true) = 'on' then return null; end if;
    perform _grade_return_lock(new.course_id);
    for _e in
        select x.enrollment_id
          from (select enrollment_id from score where assessment_id = new.id
                union all select enrollment_id from tag_score where assessment_id = new.id
                union all select enrollment_id from rubric_score where assessment_id = new.id
                union all select enrollment_id from rubric_check_score where assessment_id = new.id
                union all select enrollment_id from grade_return where assessment_id = new.id) x
          join enrollment e on e.id = x.enrollment_id and e.course_id = new.course_id
         group by x.enrollment_id
         order by 1
    loop
        perform _grade_return_settle(_e, new.id);
    end loop;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    -- Not in a copy: a change to these alone is no change to the grade.
    _skip   constant text[] := array['updated_at', 'scored_at', 'created_at', 'status', 'report_note'];
    _cells  jsonb;
    _c      record;
    _before jsonb;
    _now    jsonb;
begin
    -- import_json_restore sets the state itself when its rows are in.
    if current_setting('fv.restoring', true) = 'on' then return null; end if;

    -- old_rows exists on UPDATE and DELETE, new_rows on INSERT and UPDATE.
    if tg_op = 'INSERT' then
        select coalesce(jsonb_agg(distinct jsonb_build_array(n.enrollment_id, n.assessment_id)), '[]'::jsonb)
          into _cells from new_rows n;
    elsif tg_op = 'DELETE' then
        select coalesce(jsonb_agg(distinct jsonb_build_array(o.enrollment_id, o.assessment_id)), '[]'::jsonb)
          into _cells from old_rows o;
    else
        -- An UPDATE: only rows where something a copy holds changed (a status
        -- or a Note for the Report takes no lock here and reads no grade).
        select coalesce(jsonb_agg(distinct jsonb_build_array(d.r->'enrollment_id', d.r->'assessment_id')), '[]'::jsonb)
          into _cells
          from ((select to_jsonb(o) - _skip as r from old_rows o except all select to_jsonb(n) - _skip from new_rows n)
                union all
                (select to_jsonb(n) - _skip from new_rows n except all select to_jsonb(o) - _skip from old_rows o)) d;
    end if;

    -- A cell whose student or assessment is being deleted is left alone: its
    -- grade_return row goes with it. Classes in id order.
    for _c in
        select distinct (x->>0)::uuid as enrollment_id, (x->>1)::uuid as assessment_id, e.course_id
          from jsonb_array_elements(_cells) x
          join enrollment e on e.id = (x->>0)::uuid
         where exists (select 1 from assessment a where a.id = (x->>1)::uuid)
         order by e.course_id, 1, 2
    loop
        -- The class's lock (its sync-cursor row, which this statement's own
        -- cursor trigger takes too); then both copies, as the last writer to
        -- the class left them.
        perform _grade_return_lock(_c.course_id);
        -- Gone while this waited for the lock: its rows went with it.
        -- Or it is a DIBELS benchmark: a reading record, not a grade that is
        -- returned. A save to it makes no row and changes none (2026110905).
        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id and a.score_mode <> 'dibels');
        _before := (select g.working_copy from grade_return g
                     where g.enrollment_id = _c.enrollment_id and g.assessment_id = _c.assessment_id);
        _now := _grade_copy(_c.enrollment_id, _c.assessment_id);
        continue when _now is not distinct from _before;
        perform _grade_return_apply(_c.enrollment_id, _c.assessment_id, _before, _now);
        update grade_return set working_copy = _now
         where enrollment_id = _c.enrollment_id and assessment_id = _c.assessment_id;
    end loop;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_one(p_enrollment_id uuid, p_assessment_id uuid, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _g   grade_return%rowtype;
    _now jsonb;
begin
    select * into _g from grade_return
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and is_draft
       for update;
    if not found then
        return false;
    end if;
    _now := _grade_copy(p_enrollment_id, p_assessment_id);
    if _now is null then
        -- The teacher cleared a returned grade: returned, there is no grade.
        update grade_return
           set is_draft = false, returned_at = null, returned_copy = null, previous_copy = null, updated_at = null,
               working_copy = null
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    else
        update grade_return
           set is_draft = false, returned_at = p_at, returned_copy = null, working_copy = _now,
               previous_copy = case when _g.returned_copy is not null then _g.returned_copy else previous_copy end,
               updated_at = case when _g.returned_copy is not null then p_at else updated_at end
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    end if;
    return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if current_setting('fv.restoring', true) = 'on' then return null; end if;
    perform _grade_return_lock(new.id);
    perform _grade_return_one(g.enrollment_id, g.assessment_id, clock_timestamp())
       from grade_return g
       join enrollment e on e.id = g.enrollment_id
      where e.course_id = new.id and g.is_draft;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_repair_class(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _orphans integer := 0;
    _added   integer := 0;
    _settled integer := 0;
    _c       record;
    _did     integer;
begin
    -- The class's lock first: grade_return is written only under it. The
    -- lock that waits again if it is picked as a deadlock victim while it
    -- waits. A class deleted as this reaches it has nothing to repair (the
    -- lock's own row cannot be made for a class that is going).
    begin
        perform _grade_return_lock_first(p_course_id);
    exception when foreign_key_violation then
        return jsonb_build_object('orphans_removed', 0, 'rows_added', 0, 'rows_settled', 0);
    end;
    if not exists (select 1 from course c where c.id = p_course_id) then
        return jsonb_build_object('orphans_removed', 0, 'rows_added', 0, 'rows_settled', 0);
    end if;

    -- Rows whose student or assessment is gone. The one that is left says
    -- which class the row was in.
    delete from grade_return g
     where (exists (select 1 from enrollment e where e.id = g.enrollment_id and e.course_id = p_course_id)
            and not exists (select 1 from assessment a where a.id = g.assessment_id))
        or (exists (select 1 from assessment a where a.id = g.assessment_id and a.course_id = p_course_id)
            and not exists (select 1 from enrollment e where e.id = g.enrollment_id));
    get diagnostics _orphans = row_count;

    -- Every cell of the class with a grade or a row, on work that is not
    -- DIBELS (a DIBELS piece's rows are dormant, and it gets none).
    for _c in
        select x.enrollment_id, x.assessment_id
          from (select enrollment_id, assessment_id from score
                union all select enrollment_id, assessment_id from tag_score
                union all select enrollment_id, assessment_id from rubric_score
                union all select enrollment_id, assessment_id from rubric_check_score
                union all select enrollment_id, assessment_id from grade_return) x
          join enrollment e on e.id = x.enrollment_id and e.course_id = p_course_id
          join assessment a on a.id = x.assessment_id and a.course_id = p_course_id and a.score_mode <> 'dibels'
         group by x.enrollment_id, x.assessment_id
         order by 1, 2
    loop
        _did := _grade_return_settle(_c.enrollment_id, _c.assessment_id);
        if _did = 1 then _added := _added + 1; elsif _did = 2 then _settled := _settled + 1; end if;
    end loop;

    return jsonb_build_object('orphans_removed', _orphans, 'rows_added', _added, 'rows_settled', _settled);
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_repair_lost()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n integer;
begin
    delete from grade_return g
     where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
       and not exists (select 1 from assessment a where a.id = g.assessment_id);
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_repoint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _old  text := to_jsonb(old) ->> tg_argv[1];
    _new  text := to_jsonb(new) ->> tg_argv[1];
    _map  jsonb;
    _none constant jsonb := '{}'::jsonb;
begin
    if coalesce(current_setting('fv.moving_rubric', true), '') <> 'on'
       or current_setting('fv.restoring', true) = 'on' or _old = _new
       or old.enrollment_id <> new.enrollment_id or old.assessment_id <> new.assessment_id then
        return null;
    end if;
    _map := jsonb_build_object(_old, _new);
    perform _grade_return_lock((select e.course_id from enrollment e where e.id = new.enrollment_id));
    update grade_return g
       set returned_copy = _grade_copy_remap(g.returned_copy, case when tg_argv[0] = 'criteria' then _map else _none end,
                               case when tg_argv[0] = 'checks' then _map else _none end,
                               case when tg_argv[0] = 'tags' then _map else _none end),
           previous_copy = _grade_copy_remap(g.previous_copy, case when tg_argv[0] = 'criteria' then _map else _none end,
                               case when tg_argv[0] = 'checks' then _map else _none end,
                               case when tg_argv[0] = 'tags' then _map else _none end),
           working_copy = _grade_copy_remap(g.working_copy, case when tg_argv[0] = 'criteria' then _map else _none end,
                               case when tg_argv[0] = 'checks' then _map else _none end,
                               case when tg_argv[0] = 'tags' then _map else _none end)
     where g.enrollment_id = new.enrollment_id and g.assessment_id = new.assessment_id;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_settle(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _has    boolean;
    _before jsonb;
    _now    jsonb;
begin
    select true, g.working_copy into _has, _before
      from grade_return g
     where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id;
    _has := coalesce(_has, false);
    _now := _grade_copy(p_enrollment_id, p_assessment_id);
    if _now is not distinct from _before then
        return 0;
    end if;
    perform _grade_return_apply(p_enrollment_id, p_assessment_id, _before, _now);
    update grade_return set working_copy = _now
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    return case when _has then 2 else 1 end;
end;
$function$;

CREATE OR REPLACE FUNCTION public._grade_return_truncated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    delete from grade_return g
     where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
        or not exists (select 1 from assessment a where a.id = g.assessment_id);
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._handout_drop_expired(p_course_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n int;
begin
    perform set_config('fv.handout_removal_reason', 'handout_expired', true);
    delete from assessment_resource
     where course_id = p_course_id and kind = 'pdf' and status = 'uploading' and created_at < now() - _work_hold();
    get diagnostics _n = row_count;
    perform set_config('fv.handout_removal_reason', '', true);
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public._handout_path(p_course_id uuid, p_resource_id uuid, p_page integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select p_course_id::text || '/handouts/' || p_resource_id::text || '/' || p_page::text || '.jpg';
$function$;

CREATE OR REPLACE FUNCTION public._keep_photos_day(p_choice text, p_terms jsonb, p_on date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    with j as (
        select make_date(extract(year from p_on)::int + case when extract(month from p_on) >= 8 then 1 else 0 end, 6, 30) as june
    ), e as (
        select public._fv_date(t->>'ends_on') as d
          from jsonb_array_elements(case when jsonb_typeof(p_terms) = 'array' then p_terms else '[]'::jsonb end) t
    )
    select case
             when p_choice is distinct from 'end_of_term' then j.june
             -- the term the class is in, else the next to end; none ahead: End of Year's day
             else coalesce((select min(e.d) from e where e.d >= p_on), j.june)
           end
      from j;
$function$;

CREATE OR REPLACE FUNCTION public._markup_check(p_marks jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _m jsonb;
begin
    if p_marks is null or jsonb_typeof(p_marks) <> 'object' or jsonb_typeof(p_marks->'marks') is distinct from 'array'
       or p_marks->'v' is distinct from '1'::jsonb
       or exists (select 1 from jsonb_object_keys(p_marks) k where k not in ('v', 'marks')) then
        raise exception 'marks must be { "v": 1, "marks": [ ... ] }' using errcode = '22023';
    end if;
    if octet_length(p_marks::text) > 262144 then
        raise exception 'marks are over 256 KB' using errcode = '22023';
    end if;
    if jsonb_array_length(p_marks->'marks') > 500 then
        raise exception 'more than 500 marks on a page' using errcode = '22023';
    end if;
    for _m in select x from jsonb_array_elements(p_marks->'marks') x loop
        if jsonb_typeof(_m) <> 'object' or jsonb_typeof(_m->'type') is distinct from 'string'
           or _m->>'type' not in ('pen', 'highlight', 'note', 'tick', 'cross') then
            raise exception 'a mark is not one of pen, highlight, note, tick or cross' using errcode = '22023';
        end if;
        if _m->>'type' = 'note' and (jsonb_typeof(_m->'text') is distinct from 'string'
                                     or char_length(btrim(_m->>'text')) not between 1 and 500) then
            raise exception 'a note needs a text of 1 to 500 characters' using errcode = '22023';
        end if;
        if exists (select 1 from jsonb_object_keys(_m) k
                    where k not in ('id', 'type', 'color')
                      and not (k in ('x', 'y') and _m->>'type' in ('note', 'tick', 'cross'))
                      and not (k = 'text' and _m->>'type' = 'note')
                      and not (k in ('points', 'width') and _m->>'type' in ('pen', 'highlight'))) then
            raise exception 'a mark has a key its type does not take' using errcode = '22023';
        end if;
        if _m ? 'id' and (jsonb_typeof(_m->'id') <> 'string' or char_length(_m->>'id') not between 1 and 64) then
            raise exception 'a mark''s id is 1 to 64 characters' using errcode = '22023';
        end if;
        if _m ? 'color' and (jsonb_typeof(_m->'color') <> 'string' or _m->>'color' not in ('red', 'green', 'blue')) then
            raise exception 'a mark''s color is red, green or blue' using errcode = '22023';
        end if;
        if _m->>'type' in ('note', 'tick', 'cross')
           and (jsonb_typeof(_m->'x') is distinct from 'number' or jsonb_typeof(_m->'y') is distinct from 'number'
                or (_m->>'x')::numeric not between 0 and 1 or (_m->>'y')::numeric not between 0 and 1) then
            raise exception 'a note, tick or cross needs x and y, each from 0 to 1' using errcode = '22023';
        end if;
        if _m->>'type' in ('pen', 'highlight') then
            if jsonb_typeof(_m->'points') is distinct from 'array'
               or jsonb_array_length(_m->'points') not between 1 and 5000
               or exists (select 1 from jsonb_array_elements(_m->'points') pt
                           where jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
                              or jsonb_typeof(pt->0) <> 'number' or jsonb_typeof(pt->1) <> 'number'
                              or (pt->>0)::numeric not between 0 and 1 or (pt->>1)::numeric not between 0 and 1) then
                raise exception 'a pen or highlight needs 1 to 5000 points [x, y], each from 0 to 1' using errcode = '22023';
            end if;
            if _m ? 'width' and (jsonb_typeof(_m->'width') <> 'number'
                                 or (_m->>'width')::numeric <= 0 or (_m->>'width')::numeric > 0.2) then
                raise exception 'a stroke''s width is above 0 and at most 0.2 of the page' using errcode = '22023';
            end if;
        end if;
    end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public._markup_give(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n int;
begin
    update markup
       set given = working, given_rev = working_rev, given_at = clock_timestamp()
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       and given_rev is distinct from working_rev
       and not (given is null and jsonb_array_length(coalesce(working->'marks', '[]'::jsonb)) = 0);
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public._markup_on_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _grade_return_lock(new.id);
    perform _markup_give(p.enrollment_id, p.assessment_id)
       from (select distinct m.enrollment_id, m.assessment_id
               from markup m
               join enrollment e on e.id = m.enrollment_id and e.course_id = new.id
               join grade_return g on g.enrollment_id = m.enrollment_id and g.assessment_id = m.assessment_id
              where m.course_id = new.id and m.given_rev is distinct from m.working_rev
                and g.returned_at is not null and not g.is_draft) p;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._markup_on_return()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _markup_give(new.enrollment_id, new.assessment_id);
    -- A restore (fv.restoring) writes the backup's own state over what it
    -- first marks Returned: no request is closed from that. (The app
    -- restores as a new class, where there is no request.)
    if current_setting('fv.restoring', true) = 'on' then
        return null;
    end if;
    -- The revision's grade returned: the request is done, for good.
    perform _revision_settle(new.enrollment_id, new.assessment_id, false);
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._phone_report_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select to_jsonb(r) || jsonb_build_object(
           'students', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'enrollment_id', s.enrollment_id,
                      'data', s.data,
                      'updated_at', s.updated_at,
                      'opened_at', (select min(c.opened_at) from student_access_code c
                                     where c.phone_report_id = r.id and c.enrollment_id = s.enrollment_id))
                    order by s.enrollment_id)
               from phone_report_student s where s.report_id = r.id), '[]'::jsonb))
    from phone_report r
   where r.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public._phone_report_put(p_report_id uuid, p_course_id uuid, p_students jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _item jsonb;
    _eid  uuid;
begin
    if jsonb_typeof(p_students) is distinct from 'array' then
        raise exception 'students must be an array' using errcode = '22023';
    end if;
    for _item in select * from jsonb_array_elements(p_students) loop
        _eid := (_item->>'enrollment_id')::uuid;
        if not exists (select 1 from enrollment e where e.id = _eid and e.course_id = p_course_id
                         and fv_owns_enrollment(e.id)) then
            raise exception 'enrollment not in this class' using errcode = 'P0002';
        end if;
        insert into phone_report_student (report_id, enrollment_id, data, updated_at)
        values (p_report_id, _eid, _item->'data', now())
        on conflict (report_id, enrollment_id) do update set data = excluded.data, updated_at = now();
    end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public._photo_keep_class(p_course_id uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _expired int;
    _cutoff  timestamptz;
    _marks   int := 0;
    _pages   int := 0;
    _c       record;
begin
    -- The class's lock first, as every write to its work.
    perform _grade_return_lock_first(p_course_id);
    _expired := _work_drop_expired(p_course_id);
    if _expired > 0 then
        perform _photo_log(p_course_id, 'expired', _expired, null);
    end if;
    select c.timezone, c.deleted_at, c.keep_photos_until, c.reporting_terms into _c from course c where c.id = p_course_id;
    if not found or _c.deleted_at is not null then
        -- Gone, or in the trash: Keep Photos Until waits (section 7).
        return jsonb_build_object('expired', _expired, 'pages', 0, 'marks_kept', 0, 'before', null, 'skipped', found);
    end if;
    _cutoff := _photo_keep_cutoff(p_course_id, p_now);
    if _cutoff is not null then
        -- Mark Up stays (section 3): copied before its page goes.
        insert into markup_kept (file_id, submission_id, course_id, assessment_id, enrollment_id, page, width, height, rotation,
                                 added_by, working, working_rev, working_at, given, given_rev, given_at, marked_at)
        select m.file_id, f.submission_id, m.course_id, m.assessment_id, m.enrollment_id, f.page, f.width, f.height, f.rotation,
               f.added_by, m.working, m.working_rev, m.working_at, m.given, m.given_rev, m.given_at, m.created_at
          from markup m
          join submission_file f on f.id = m.file_id
          join submission s on s.id = f.submission_id
         where s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
           -- handed in after the day (ruling 106): stays
           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff)
        on conflict (file_id) do nothing;
        get diagnostics _marks = row_count;
        -- The pages go; Batch B's trigger queues both files of each.
        perform set_config('fv.work_removal_reason', 'keep_photos_until', true);
        delete from submission_file f
         using submission s
         where s.id = f.submission_id and s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff);
        get diagnostics _pages = row_count;
        perform set_config('fv.work_removal_reason', '', true);
        if _pages > 0 then
            perform _photo_log(p_course_id, 'keep_photos_until', _pages, jsonb_build_object('before', _cutoff, 'marks_kept', _marks));
        end if;
    end if;
    insert into photo_keep_check (course_id, checked_through, judged_choice, judged_terms, at)
    values (p_course_id, (p_now at time zone _fv_timezone(_c.timezone))::date - 1, _c.keep_photos_until, _c.reporting_terms, now())
    on conflict (course_id) do update
        set checked_through = greatest(photo_keep_check.checked_through, excluded.checked_through),
            judged_choice = excluded.judged_choice, judged_terms = excluded.judged_terms, at = now();
    return jsonb_build_object('expired', _expired, 'pages', _pages, 'marks_kept', _marks, 'before', _cutoff);
end;
$function$;

CREATE OR REPLACE FUNCTION public._photo_keep_cutoff(p_course_id uuid, p_now timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _c     record;
    _k     record;
    _tz    text;
    _today date;
    _from  date;
    _due   date;
begin
    select c.keep_photos_until, c.reporting_terms, c.timezone into _c from course c where c.id = p_course_id;
    if not found then return null; end if;
    _tz := _fv_timezone(_c.timezone);
    _today := (p_now at time zone _tz)::date;
    select k.checked_through, k.judged_choice, k.judged_terms into _k from photo_keep_check k where k.course_id = p_course_id;
    if not found or _k.judged_choice is distinct from _c.keep_photos_until or _k.judged_terms is distinct from _c.reporting_terms then
        -- A first night, or a setting the job has not judged with: yesterday only.
        _from := _today - 1;
    else
        _from := greatest(_k.checked_through + 1, _today - 400);
    end if;
    select max(g.d::date) into _due
      from generate_series(_from, _today - 1, interval '1 day') g(d)
     where _keep_photos_day(_c.keep_photos_until, _c.reporting_terms, g.d::date) <= g.d::date;
    if _due is null then return null; end if;
    return (_due + 1)::timestamp at time zone _tz;
end;
$function$;

CREATE OR REPLACE FUNCTION public._photo_log(p_course_id uuid, p_kind text, p_n integer, p_detail jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    insert into photo_check_log (course_id, kind, n, detail) values (p_course_id, p_kind, p_n, p_detail);
$function$;

CREATE OR REPLACE FUNCTION public._photo_missing(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    with m as (
        select f.id
          from submission s
          join submission_file f on f.submission_id = s.id
         where s.course_id = p_course_id and s.state = 'sent'
           and (not exists (select 1 from _work_object(f.path)) or not exists (select 1 from _work_object(f.thumb_path)))
    )
    select jsonb_build_object('n', (select count(*) from m),
                              'file_ids', coalesce((select jsonb_agg(x.id order by x.id) from (select id from m order by id limit 50) x), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public._photo_strays(p_course_id uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _layout constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){4}(-thumb)?\.jpg$';
    -- a handout's page (2026111170): <class>/handouts/<resource>/<page number>.jpg
    _handout constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/handouts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]?\.jpg$';
    _queued int := 0;
    _more   int := 0;
    _other  int := 0;
    _gone   int := 0;
begin
    if p_course_id is not null then
        perform _grade_return_lock_first(p_course_id);
        -- '/' then '0' are next to each other: every name that starts "<class>/", and no other
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.name >= (p_course_id::text || '/') collate "C" and o.name < (p_course_id::text || '0') collate "C"
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _layout
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, p_course_id, 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
        -- Handouts (2026111170). An upload never finished goes first, so its
        -- pages are queued by its row's trigger, not as strays.
        _gone := _handout_drop_expired(p_course_id);
        if _gone > 0 then
            perform _photo_log(p_course_id, 'expired', _gone, jsonb_build_object('handouts', _gone));
        end if;
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.name >= (p_course_id::text || '/handouts/') collate "C" and o.name < (p_course_id::text || '/handouts0') collate "C"
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _handout
               -- a page some handout's row still names is not a stray
               and not exists (select 1 from fv_private.handout_path_parts(o.name) h
                                 join assessment_resource a on a.id = h.resource_id
                                where a.course_id = h.course_id and a.kind = 'pdf' and h.page <= a.page_count)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, p_course_id, 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _more from q;
        _queued := _queued + _more;
    else
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and (o.name ~ _layout or o.name ~ _handout)
               and not exists (select 1 from course c where c.id = fv_private.work_path_course(o.name))
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from fv_private.handout_path_parts(o.name) h
                                 join assessment_resource a on a.id = h.resource_id
                                where a.course_id = h.course_id and a.kind = 'pdf' and h.page <= a.page_count)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, fv_private.work_path_course(s.name), 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
        select count(*) into _other
          from storage.objects o
         where o.bucket_id = _work_bucket() and o.archived_at is null and not o.is_delete_marker
           and o.created_at < p_now - interval '24 hours' and o.name !~ _layout and o.name !~ _handout;
        if _other > 0 then
            perform _photo_log(null, 'stray_other_name', _other, null);
        end if;
    end if;
    if _queued > 0 then
        perform _photo_log(p_course_id, 'stray_queued', _queued, null);
    end if;
    return jsonb_build_object('queued', _queued, 'other_name', _other);
end;
$function$;

CREATE OR REPLACE FUNCTION public._photo_stuck()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object('n', count(*), 'due_since', min(x.since))
      from (select case when r.removed_at is null then r.queued_at else r.link_dies_at end as since
              from submission_file_removal r
             where not r.done and (r.removed_at is null or r.link_dies_at <= now())) x
     where x.since < now() - interval '6 hours';
$function$;

CREATE OR REPLACE FUNCTION public._piece_latest(p_assessment_id uuid, p_enrollment_id uuid)
 RETURNS public.submission
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select s.* from submission s
     where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id and s.state = 'sent'
     order by s.version desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public._questionnaire_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select to_jsonb(q) || jsonb_build_object(
           'questions', coalesce((
             select jsonb_agg(to_jsonb(x) order by x.display_order, x.created_at)
               from question x
              where x.questionnaire_id = q.id and not x.archived), '[]'::jsonb))
    from questionnaire q
   where q.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public._reflection_json(p_reflection_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'id', f.id, 'assessment_id', f.assessment_id, 'enrollment_id', f.enrollment_id,
               'makes_sense', f.makes_sense, 'question', f.question, 'plan', f.plan, 'plan_at', f.plan_at, 'went_well', f.went_well,
               'sent_at', f.sent_at, 'answer', f.answer, 'answered_at', f.answered_at, 'note', f.note, 'noted_at', f.noted_at,
               'answer_seen_at', f.answer_seen_at,
               'sense_now', f.sense_now, 'sense_now_at', f.sense_now_at,
               'follow_up', f.follow_up, 'follow_up_answer', f.follow_up_answer, 'follow_up_answered_at', f.follow_up_answered_at,
               'follow_up_note', f.follow_up_note, 'follow_up_noted_at', f.follow_up_noted_at,
               'follow_up_answer_seen_at', f.follow_up_answer_seen_at,
               'waiting', (f.question is not null and f.answer is null and (f.noted_at is null or f.noted_at < f.sent_at))
                          or (f.follow_up is not null and f.follow_up_answer is null and f.follow_up_note is null))
      from feedback_reflection f where f.id = p_reflection_id;
$function$;

CREATE OR REPLACE FUNCTION public._report_preset_defaults(p_preset text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
    return case p_preset
        when 'brief'    then '{"header":true,"narrative":true,"grades":false,"competencies":false,"goals":false,"attendance":false}'::jsonb
        when 'standard' then '{"header":true,"narrative":true,"grades":true,"competencies":true,"goals":true,"attendance":false}'::jsonb
        when 'detailed' then '{"header":true,"narrative":true,"grades":true,"competencies":true,"goals":true,"attendance":true,"reflections":true,"strengths":true,"growth":true}'::jsonb
        else '{}'::jsonb
    end;
end; $function$;

CREATE OR REPLACE FUNCTION public._revision_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _grade_return_lock(old.course_id);
    perform _revision_settle(old.enrollment_id, old.assessment_id, false);
    return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public._revision_json(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'id', r.id, 'assessment_id', r.assessment_id, 'enrollment_id', r.enrollment_id,
               'what_to_fix', r.what_to_fix, 'revise_by', r.revise_by, 'criterion_ids', to_jsonb(r.criterion_ids),
               'keep_grade', r.keep_grade, 'grade_hidden', false,
               'first_submission_id', r.first_submission_id, 'first_version', r.first_version,
               'first_grade', r.first_grade, 'first_returned_at', r.first_returned_at,
               'created_at', r.created_at, 'updated_at', r.updated_at, 'closed_at', r.closed_at)
           || _revision_state(r.id)
      from revision_request r where r.id = p_request_id;
$function$;

CREATE OR REPLACE FUNCTION public._revision_settle(p_enrollment_id uuid, p_assessment_id uuid, p_returned boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n int;
begin
    update revision_request r
       set state = 'done', closed_at = now(), updated_at = now()
     where r.assessment_id = p_assessment_id and r.enrollment_id = p_enrollment_id and r.state = 'open'
       and _revision_state(r.id)->>'state' in ('returned', case when p_returned then 'sent' end, case when p_returned then 'grading' end);
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public._revision_state(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'state', case when r.state = 'cancelled' then 'cancelled'
                             when r.state = 'done' then 'returned'
                             when v.id is null then 'open'
                             -- the revision in, returned since it came in (a draft on it since does not take that back)
                             when r.revision_in_at is not null and g.returned_at is not null
                                  and g.returned_at is distinct from r.in_returned_at then 'returned'
                             when md5(coalesce(g.working_copy::text, '')) is distinct from r.grade_mark then 'grading'
                             when exists (select 1 from markup m join submission_file f on f.id = m.file_id
                                           where f.submission_id = v.id
                                             and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) > 0) then 'grading'
                             else 'sent' end,
               'revision_submission_id', v.id, 'revision_version', v.version, 'revision_sent_at', v.sent_at,
               'revision_note', v.note, 'revision_late', v.is_late, 'revision_sent_by', v.sent_by)
      from revision_request r
      left join lateral (select s.* from submission s
                          where s.assessment_id = r.assessment_id and s.enrollment_id = r.enrollment_id and s.state = 'sent'
                            and s.version > r.first_version
                          order by s.version desc limit 1) v on true
      left join grade_return g on g.enrollment_id = r.enrollment_id and g.assessment_id = r.assessment_id
     where r.id = p_request_id;
$function$;

CREATE OR REPLACE FUNCTION public._score_audit_diff(p_score_id uuid, p_old_value numeric, p_new_value numeric, p_old_status text, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public._slip_password_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _slip_password_settle(e.student_id) from enrollment e where e.id = new.enrollment_id;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._slip_password_settle(p_student_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    update student s set slip_password = null
     where s.id = p_student_id
       and s.slip_password is not null
       and not exists (
           select 1 from student_access_code c join enrollment e on e.id = c.enrollment_id
            where e.student_id = s.id and e.withdrawn_at is null
              and c.questionnaire_id is not null
              and c.pw_hmac is null
              and (c.code_hash is not null or c.converted_at is not null)
              and c.used_at is null and c.revoked_at is null
              and c.expires_at > now()
              and now() < student_submit._slip_old_until());
$function$;

CREATE OR REPLACE FUNCTION public._student_card_json(p_card_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'id', k.id, 'enrollment_id', k.enrollment_id, 'seq', k.seq,
               'created_at', k.created_at, 'printed_at', k.printed_at, 'last_opened_at', k.last_opened_at,
               'locked_at', k.locked_at, 'wrong_tries', k.wrong_tries,
               'wrong_tries_7d', (select count(*) from unnest(k.wrong_times) t where t > now() - interval '7 days'),
               'works_until', k.works_until,
               'check', case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null
                             then 'identity' else 'password' end,
               -- the card has a password of its own (printed on it once; only its tag is kept)
               'has_password', k.pw_hmac is not null,
               -- made under a key other than the one the edge functions last called with
               'needs_new', k.key_id is distinct from coalesce((select x.key_id from student_submit.card_key x), k.key_id))
      from student_card k
      join enrollment e on e.id = k.enrollment_id
      join student s on s.id = e.student_id
     where k.id = p_card_id;
$function$;

CREATE OR REPLACE FUNCTION public._submission_file_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _why text := coalesce(nullif(current_setting('fv.work_removal_reason', true), ''), 'row_deleted');
begin
    insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
    select _work_bucket(), p, fv_private.work_path_course(p), _why, old.link_dies_at
      from unnest(array[old.path, old.thumb_path]) p
    on conflict (bucket, path) do nothing;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._submission_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _grade_return_lock(old.course_id);
    if tg_table_name = 'enrollment' then
        delete from submission where enrollment_id = old.id;
    else
        delete from submission where assessment_id = old.id;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._submission_json(p_submission_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'id', s.id, 'assessment_id', s.assessment_id, 'enrollment_id', s.enrollment_id, 'version', s.version,
               'state', s.state, 'intent', s.intent, 'target_id', s.target_id,
               'sent_by', s.sent_by, 'on_paper', s.on_paper, 'is_late', s.is_late,
               'note', s.note, 'followed_plan', s.followed_plan,
               'created_at', s.created_at, 'sent_at', s.sent_at,
               'files', coalesce((
                   select jsonb_agg(jsonb_build_object(
                              'id', f.id, 'page', f.page, 'path', f.path, 'thumb_path', f.thumb_path,
                              'bytes', f.bytes, 'thumb_bytes', f.thumb_bytes, 'width', f.width, 'height', f.height,
                              'rotation', f.rotation, 'sha256', f.sha256, 'added_by', f.added_by) order by f.page, f.id)
                     from submission_file f where f.submission_id = s.id), '[]'::jsonb))
      from submission s
     where s.id = p_submission_id;
$function$;

CREATE OR REPLACE FUNCTION public._submission_same_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if tg_op = 'UPDATE' then
        if new.course_id is distinct from old.course_id or new.assessment_id is distinct from old.assessment_id
           or new.enrollment_id is distinct from old.enrollment_id then
            raise exception 'a submission keeps its student, assessment and class' using errcode = '23514';
        end if;
        return new;
    end if;
    if not exists (select 1 from assessment a where a.id = new.assessment_id and a.course_id = new.course_id)
       or not exists (select 1 from enrollment e where e.id = new.enrollment_id and e.course_id = new.course_id) then
        raise exception 'the student and the assessment are not both in that class' using errcode = '23514';
    end if;
    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public._submission_target_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    delete from submission where target_id = old.id;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._submission_truncated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    delete from submission s
     where not exists (select 1 from enrollment e where e.id = s.enrollment_id)
        or not exists (select 1 from assessment a where a.id = s.assessment_id);
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._term_rating_audit_field(p_tr_id uuid, p_field text, p_old text, p_new text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if not fv_owns_term_rating(p_tr_id) then
        return;
    end if;
    if p_old is distinct from p_new then
        insert into term_rating_audit (term_rating_id, changed_by, field_changed, old_value, new_value)
        values (p_tr_id, (select auth.uid()), p_field, p_old, p_new);
    end if;
end; $function$;

CREATE OR REPLACE FUNCTION public._touch_course_sync_cursor(p_course_id uuid, p_bucket text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public._touch_course_sync_cursor_from_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public._touch_teacher_sync_cursor_from_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _row record;
begin
    for _row in
        select c.id from public.course c
         where c.teacher_id = coalesce(new.teacher_id, old.teacher_id) and c.deleted_at is null
    loop
        perform public._touch_course_sync_cursor(_row.id, coalesce(tg_argv[0], 'student-records'));
    end loop;
    return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_begin(p_course_id uuid, p_assessment_id uuid, p_enrollment_id uuid, p_sent_by text, p_intent text, p_target_id uuid, p_pages jsonb, p_note text, p_followed_plan text, p_is_late boolean, p_card_id uuid, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _id   uuid;
    _file uuid;
    _p    record;
    _path text;
begin
    insert into submission (course_id, assessment_id, enrollment_id, state, intent, target_id, sent_by,
                            note, followed_plan, is_late, card_id, request_id)
    values (p_course_id, p_assessment_id, p_enrollment_id, 'sending', p_intent, p_target_id, p_sent_by,
            nullif(btrim(p_note), ''), p_followed_plan, coalesce(p_is_late, false), p_card_id, p_request_id)
    returning id into _id;
    for _p in select t.x, t.ord from jsonb_array_elements(p_pages) with ordinality as t(x, ord) order by t.ord loop
        _file := gen_random_uuid();
        _path := p_course_id::text || '/' || p_assessment_id::text || '/' || p_enrollment_id::text || '/' || _id::text || '/' || _file::text;
        insert into submission_file (id, submission_id, page, path, thumb_path, width, height, added_by,
                                     declared_bytes, declared_thumb_bytes, link_dies_at)
        values (_file, _id, _p.ord, _path || '.jpg', _path || '-thumb.jpg', (_p.x->>'width')::int, (_p.x->>'height')::int, p_sent_by,
                coalesce((_p.x->>'bytes')::int, _work_max_bytes()::int), coalesce((_p.x->>'thumb_bytes')::int, _work_max_bytes()::int),
                now() + _work_hold() + interval '2 hours 10 minutes');
    end loop;
    return _id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_bucket()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select 'student-photos'::text;
$function$;

CREATE OR REPLACE FUNCTION public._work_check_files(p_files jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _f jsonb;
begin
    if p_files is null or jsonb_typeof(p_files) <> 'array' then
        raise exception 'files must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_files) not between 1 and 30 then
        raise exception 'between 1 and 30 files' using errcode = '22023';
    end if;
    for _f in select x from jsonb_array_elements(p_files) x loop
        if jsonb_typeof(_f) <> 'object'
           or jsonb_typeof(_f->'file_id') is distinct from 'string'
           or _f->>'file_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           or jsonb_typeof(_f->'sha256') is distinct from 'string' or _f->>'sha256' !~ '^[0-9a-f]{64}$' then
            raise exception 'a file is not { file_id, sha256 }' using errcode = '22023';
        end if;
    end loop;
    if (select count(distinct lower(x->>'file_id')) from jsonb_array_elements(p_files) x) <> jsonb_array_length(p_files) then
        raise exception 'a file is named twice' using errcode = '22023';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_check_pages(p_pages jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _p jsonb;
    _k record;
begin
    if p_pages is null or jsonb_typeof(p_pages) <> 'array' then
        raise exception 'pages must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_pages) not between 1 and 30 then
        raise exception 'between 1 and 30 pages' using errcode = '22023';
    end if;
    for _p in select x from jsonb_array_elements(p_pages) x loop
        if jsonb_typeof(_p) <> 'object' then
            raise exception 'a page is not an object' using errcode = '22023';
        end if;
        for _k in select * from (values ('width', 20000::bigint), ('height', 20000), ('bytes', _work_max_bytes()), ('thumb_bytes', _work_max_bytes())) as v(name, most) loop
            if _p ? _k.name and jsonb_typeof(_p->_k.name) <> 'null'
               and (jsonb_typeof(_p->_k.name) <> 'number' or (_p->>_k.name) !~ '^[0-9]{1,7}$' or (_p->>_k.name)::bigint not between 1 and _k.most) then
                raise exception 'a page has a % that is not a whole number from 1 to %', _k.name, _k.most using errcode = '22023';
            end if;
        end loop;
    end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_class_full(p_course_id uuid, p_pages jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case when u.pages + n.pages > _work_class_max_pages() or u.bytes + n.bytes > _work_class_max_bytes()
                then jsonb_build_object('pages', u.pages, 'bytes', u.bytes,
                                        'max_pages', _work_class_max_pages(), 'max_bytes', _work_class_max_bytes()) end
      from (select count(f.id) as pages,
                   coalesce(sum(case when s.state = 'sent'
                                     then coalesce(f.bytes, f.declared_bytes) + coalesce(f.thumb_bytes, f.declared_thumb_bytes)
                                     else f.declared_bytes + f.declared_thumb_bytes end), 0)::bigint as bytes
              from submission s join submission_file f on f.submission_id = s.id
             where s.course_id = p_course_id) u,
           (select count(*) as pages,
                   coalesce(sum(coalesce((x->>'bytes')::bigint, _work_max_bytes()) + coalesce((x->>'thumb_bytes')::bigint, _work_max_bytes())), 0)::bigint as bytes
              from jsonb_array_elements(p_pages) x) n;
$function$;

CREATE OR REPLACE FUNCTION public._work_class_max_bytes()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select 5368709120::bigint;
$function$;

CREATE OR REPLACE FUNCTION public._work_class_max_pages()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select 10000;
$function$;

CREATE OR REPLACE FUNCTION public._work_drop_expired(p_course_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n int;
begin
    perform set_config('fv.work_removal_reason', 'expired', true);
    delete from submission
     where course_id = p_course_id and state = 'sending' and created_at < now() - _work_hold();
    get diagnostics _n = row_count;
    perform set_config('fv.work_removal_reason', '', true);
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_feedback_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    perform _grade_return_lock(old.course_id);
    if tg_table_name = 'enrollment' then
        delete from revision_request where enrollment_id = old.id;
        delete from feedback_reflection where enrollment_id = old.id;
    else
        delete from revision_request where assessment_id = old.id;
        delete from feedback_reflection where assessment_id = old.id;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_feedback_truncated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    delete from revision_request r
     where not exists (select 1 from enrollment e where e.id = r.enrollment_id)
        or not exists (select 1 from assessment a where a.id = r.assessment_id);
    delete from feedback_reflection r
     where not exists (select 1 from enrollment e where e.id = r.enrollment_id)
        or not exists (select 1 from assessment a where a.id = r.assessment_id);
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_files_state(p_submission_id uuid, p_files jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
        'missing', coalesce(jsonb_agg(f.id order by t.ord) filter (where o.n = 0 or th.n = 0), '[]'::jsonb),
        'bad', coalesce(jsonb_agg(f.id order by t.ord) filter (where o.n > 0 and th.n > 0 and (
                            o.bytes > _work_max_bytes() or th.bytes > _work_max_bytes()
                            or o.bytes > f.declared_bytes or th.bytes > f.declared_thumb_bytes
                            or o.mimetype <> 'image/jpeg' or th.mimetype <> 'image/jpeg')), '[]'::jsonb))
      from jsonb_array_elements(p_files) with ordinality as t(x, ord)
      join submission_file f on f.id = (t.x->>'file_id')::uuid and f.submission_id = p_submission_id
     cross join lateral (select count(*) as n, max(w.bytes) as bytes, max(w.mimetype) as mimetype from _work_object(f.path) w) o
     cross join lateral (select count(*) as n, max(w.bytes) as bytes, max(w.mimetype) as mimetype from _work_object(f.thumb_path) w) th;
$function$;

CREATE OR REPLACE FUNCTION public._work_hold()
 RETURNS interval
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select interval '2 hours';
$function$;

CREATE OR REPLACE FUNCTION public._work_max_bytes()
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select 2097152::bigint;
$function$;

CREATE OR REPLACE FUNCTION public._work_object(p_path text)
 RETURNS TABLE(bytes bigint, mimetype text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select nullif(o.metadata->>'size', '')::bigint, o.metadata->>'mimetype'
      from storage.objects o
     where o.bucket_id = public._work_bucket()
       -- compared byte by byte, as storage's own indexes on (bucket_id, name) are kept
       and o.name = p_path collate "C"
       and o.archived_at is null
       and not o.is_delete_marker
     limit 1;
$function$;

CREATE OR REPLACE FUNCTION public._work_settle_files(p_submission_id uuid, p_files jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n int;
begin
    perform set_config('fv.work_removal_reason', 'page_removed', true);
    delete from submission_file f
     where f.submission_id = p_submission_id
       and f.id not in (select (x->>'file_id')::uuid from jsonb_array_elements(p_files) x);
    perform set_config('fv.work_removal_reason', '', true);
    update submission_file f
       set page = t.ord, sha256 = t.x->>'sha256',
           bytes = (select w.bytes from _work_object(f.path) w),
           thumb_bytes = (select w.bytes from _work_object(f.thumb_path) w)
      from jsonb_array_elements(p_files) with ordinality as t(x, ord)
     where f.submission_id = p_submission_id and f.id = (t.x->>'file_id')::uuid;
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public._work_upload_json(p_submission_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object('file_id', f.id, 'page', f.page, 'path', f.path, 'thumb_path', f.thumb_path)
                              order by f.page, f.id), '[]'::jsonb)
      from submission_file f
     where f.submission_id = p_submission_id;
$function$;

CREATE OR REPLACE FUNCTION public.add_assessment_link(p_assessment_id uuid, p_url text, p_title text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _url    text := btrim(coalesce(p_url, ''));
    _title  text := btrim(coalesce(p_title, ''));
    _id     uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    if char_length(_url) > 2000 or _url !~* '^https?://[^[:space:][:cntrl:]/?#]+[^[:space:][:cntrl:]]*$' then
        raise exception 'a link must start with http:// or https://, with no spaces, and be 2000 characters at most' using errcode = '22023';
    end if;
    if _title = '' then
        _title := left(substring(_url from '^[A-Za-z]+://(?:[^/?#@]*@)?([^/?#]+)'), 200);
    end if;
    if char_length(_title) > 200 then
        raise exception 'a name can be 200 characters at most' using errcode = '22023';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;

    perform _grade_return_lock_first(_course);
    -- Asked under the lock: the same request sent twice at once waits here,
    -- and the second is answered as a repeat of the first.
    _cached := fv_idem_check(p_idempotency_key, 'add_assessment_link');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        -- deleted while this call waited for the class
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    perform _handout_drop_expired(_course);
    if (select count(*) from assessment_resource r where r.assessment_id = p_assessment_id) >= 50 then
        raise exception 'an assessment can hold 50 handouts and links at most' using errcode = '22023';
    end if;
    insert into assessment_resource (assessment_id, course_id, kind, title, url, status, position)
    values (p_assessment_id, _course, 'link', _title, _url, 'ready',
            (select coalesce(max(r.position), 0) + 1 from assessment_resource r where r.assessment_id = p_assessment_id))
    returning id into _id;
    _cached := _assessment_resource_json(_id);
    perform fv_idem_store(p_idempotency_key, 'add_assessment_link', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.answer_reflection(p_reflection_id uuid, p_answer text, p_idempotency_key uuid DEFAULT NULL::uuid, p_only_me boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _f      feedback_reflection%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_answer is null or char_length(btrim(p_answer)) not between 1 and 2000 then
        raise exception 'the answer must be 1 to 2000 characters' using errcode = '22023';
    end if;
    if p_only_me is null then
        raise exception 'only_me must be true or false' using errcode = '22023';
    end if;
    select f.course_id into _course from feedback_reflection f where f.id = p_reflection_id and fv_owns_course(f.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'answer_reflection');
    if _cached is not null then return _cached; end if;
    select * into _f from feedback_reflection where id = p_reflection_id and course_id = _course for update;
    if not found then
        raise exception 'reflection not found' using errcode = 'P0002';
    end if;
    if not (select c.reflect_on_feedback from course c where c.id = _course) then
        return jsonb_build_object('result', 'reflect_off');
    end if;
    if _f.answer is null and p_only_me then
        update feedback_reflection set note = btrim(p_answer), noted_at = now(), updated_at = now() where id = _f.id;
    elsif _f.answer is null then
        update feedback_reflection set answer = btrim(p_answer), answered_at = now(), updated_at = now() where id = _f.id;
    elsif _f.follow_up is not null and _f.follow_up_answer is null and p_only_me then
        update feedback_reflection set follow_up_note = btrim(p_answer), follow_up_noted_at = now(), updated_at = now() where id = _f.id;
    elsif _f.follow_up is not null and _f.follow_up_answer is null then
        update feedback_reflection set follow_up_answer = btrim(p_answer), follow_up_answered_at = now(), updated_at = now()
         where id = _f.id;
    else
        return jsonb_build_object('result', 'already_answered', 'reflection', _reflection_json(_f.id));
    end if;
    _cached := jsonb_build_object('result', 'answered', 'reflection', _reflection_json(_f.id));
    perform fv_idem_store(p_idempotency_key, 'answer_reflection', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_report_preset(p_course_id uuid, p_preset text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_preset not in ('brief','standard','detailed') then
        raise exception 'preset must be brief|standard|detailed' using errcode = '22023';
    end if;

    insert into report_config (course_id, preset, blocks_config)
    values (p_course_id, p_preset, _report_preset_defaults(p_preset))
    on conflict (course_id) do update
       set preset = excluded.preset,
           blocks_config = excluded.blocks_config,
           updated_at = now();
end; $function$;

CREATE OR REPLACE FUNCTION public.archive_course(p_course_id uuid, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course
       set is_archived = p_archived,
           updated_at  = now()
     where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bootstrap_teacher(p_email text, p_display_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid        uuid := (select auth.uid());
    _email      text := coalesce(nullif(btrim(coalesce((select auth.jwt()) ->> 'email', '')), ''), p_email);
    _teacher    teacher%rowtype;
    _prefs      teacher_preference%rowtype;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- Load existing teacher (including soft-deleted, within grace window).
    select * into _teacher from teacher where id = _uid;

    if not found then
        -- ── First verified sign-in ─────────────────────────────────────────
        -- A teacher row left by a deleted sign-in account may still hold
        -- this email; free it first (20261108_teacher_outlives_sign_in).
        perform _fv_release_orphan_teacher_email();

        -- Another tab may be making this same row right now; whichever
        -- commits second does nothing and reads the first one's row.
        insert into teacher (id, email, display_name)
        values (_uid, _email, p_display_name)
        on conflict (id) do nothing;

        select * into _teacher from teacher where id = _uid;
    end if;

    -- Also covers a partial bootstrap from an earlier failed transaction.
    insert into teacher_preference (teacher_id)
    values (_uid)
    on conflict (teacher_id) do nothing;

    select * into _prefs from teacher_preference where teacher_id = _uid;

    return jsonb_build_object(
        'id',           _teacher.id,
        'email',        _teacher.email,
        'display_name', _teacher.display_name,
        'created_at',   _teacher.created_at,
        'deleted_at',   _teacher.deleted_at,
        'preferences',  jsonb_build_object(
            'active_course_id',   _prefs.active_course_id,
            'view_mode',          _prefs.view_mode,
            'mobile_view_mode',   _prefs.mobile_view_mode,
            'mobile_sort_mode',   _prefs.mobile_sort_mode,
            'card_widget_config', _prefs.card_widget_config,
            'dashboard_prefs',    _prefs.dashboard_prefs
        )
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_apply_pronouns(p_student_ids uuid[], p_pronouns text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _n int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_student_ids is null or array_length(p_student_ids, 1) is null then return 0; end if;

    update student set pronouns = p_pronouns, updated_at = now()
     where id = any(p_student_ids);
    get diagnostics _n = row_count;
    return _n;
end; $function$;

CREATE OR REPLACE FUNCTION public.bulk_attendance(p_enrollment_ids uuid[], p_date date, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _n int := 0; _eid uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_enrollment_ids is null then return 0; end if;

    foreach _eid in array p_enrollment_ids loop
        insert into attendance (enrollment_id, attendance_date, status)
        values (_eid, p_date, p_status)
        on conflict (enrollment_id, attendance_date) do update
           set status = excluded.status, updated_at = now();
        _n := _n + 1;
    end loop;
    return _n;
end; $function$;

CREATE OR REPLACE FUNCTION public.cancel_revision(p_request_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached   jsonb;
    _course   uuid;
    _r        revision_request%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from revision_request r where r.id = p_request_id and fv_owns_course(r.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'cancel_revision');
    if _cached is not null then return _cached; end if;
    select * into _r from revision_request where id = p_request_id and course_id = _course for update;
    if not found then
        raise exception 'revision request not found' using errcode = 'P0002';
    end if;
    if _r.state <> 'open' then
        return jsonb_build_object('result', 'not_open', 'request', _revision_json(_r.id));
    end if;
    update revision_request set state = 'cancelled', closed_at = now(), updated_at = now() where id = _r.id;
    _cached := jsonb_build_object('result', 'cancelled', 'request', _revision_json(_r.id), 'unhidden', false);
    perform fv_idem_store(p_idempotency_key, 'cancel_revision', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_column_scores(p_assessment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end; $function$;

CREATE OR REPLACE FUNCTION public.clear_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _c_count int;
    _s_count int;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    delete from course where teacher_id = _uid;
    get diagnostics _c_count = row_count;

    delete from student where teacher_id = _uid;
    get diagnostics _s_count = row_count;

    update teacher_preference set active_course_id = null where teacher_id = _uid;

    return jsonb_build_object('courses', _c_count, 'students', _s_count);
end; $function$;

CREATE OR REPLACE FUNCTION public.clear_row_scores(p_enrollment_id uuid, p_course_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end; $function$;

CREATE OR REPLACE FUNCTION public.clear_score(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.clear_section_override(p_enrollment_id uuid, p_section_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from section_override where enrollment_id = p_enrollment_id and section_id = p_section_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.close_phone_report(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _r      phone_report%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'close_phone_report');
    if _cached is not null then
        return _cached;
    end if;
    select * into _r from phone_report where id = p_id and fv_owns_course(course_id) for update;
    if not found then
        raise exception 'report not found' using errcode = 'P0002';
    end if;
    update phone_report set closed_at = coalesce(closed_at, now()), updated_at = now() where id = _r.id;
    update student_access_code set revoked_at = now() where phone_report_id = _r.id and revoked_at is null;
    _cached := _phone_report_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'close_phone_report', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.course_draft_count(p_course_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select count(*)::int
      from grade_return g
      join enrollment e on e.id = g.enrollment_id
      join assessment a on a.id = g.assessment_id
     where e.course_id = p_course_id and g.is_draft
       -- a DIBELS benchmark is not a grade that is returned (2026110905)
       and a.score_mode <> 'dibels';
$function$;

CREATE OR REPLACE FUNCTION public.create_assessment(p_course_id uuid, p_title text, p_category_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_date_assigned date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_score_mode text DEFAULT 'proficiency'::text, p_max_points numeric DEFAULT NULL::numeric, p_weight numeric DEFAULT 1.0, p_evidence_type text DEFAULT NULL::text, p_rubric_id uuid DEFAULT NULL::uuid, p_module_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT '{}'::uuid[], p_copy_group uuid DEFAULT NULL::uuid, p_core_competency_ids text[] DEFAULT '{}'::text[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _id       uuid;
    _next_pos int;
    _tag      uuid;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = p_course_id
       and module_id is not distinct from p_module_id;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, display_order, copy_group, core_competency_ids)
    values (p_course_id, p_category_id, p_title, p_description, p_date_assigned, p_due_date,
            p_score_mode, p_max_points, p_weight, p_evidence_type,
            p_rubric_id, p_module_id, _next_pos, p_copy_group,
            array(select distinct c from unnest(coalesce(p_core_competency_ids, '{}')) c order by c))
    returning id into _id;

    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id)
              values (_id, _tag) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_assessment', jsonb_build_object('id', _id));
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.create_course(p_name text, p_grade_level text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_color text DEFAULT NULL::text, p_grading_system text DEFAULT 'proficiency'::text, p_calc_method text DEFAULT 'average'::text, p_decay_weight numeric DEFAULT NULL::numeric, p_timezone text DEFAULT 'America/Vancouver'::text, p_late_work_policy text DEFAULT NULL::text, p_subjects text[] DEFAULT NULL::text[], p_idempotency_key uuid DEFAULT NULL::uuid, p_block text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid       uuid := (select auth.uid());
    _course_id uuid;
    _i         int;
    _cached    jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'create_course');
    if _cached is not null then return (_cached->>'id')::uuid; end if;

    insert into course (teacher_id, name, grade_level, description, color,
        grading_system, calc_method, decay_weight, timezone, late_work_policy, block)
    values (_uid, p_name, p_grade_level, p_description, p_color,
        p_grading_system, p_calc_method, p_decay_weight, p_timezone, p_late_work_policy,
        nullif(btrim(p_block), ''))
    returning id into _course_id;

    insert into report_config (course_id) values (_course_id);

    if p_subjects is not null then
        for _i in 1 .. array_length(p_subjects, 1) loop
            insert into subject (course_id, name, display_order)
            values (_course_id, p_subjects[_i], _i - 1);
        end loop;
    end if;

    insert into teacher_preference (teacher_id, active_course_id)
    values (_uid, _course_id)
    on conflict (teacher_id) do update set active_course_id = excluded.active_course_id;

    perform fv_idem_store(p_idempotency_key, 'create_course', jsonb_build_object('id', _course_id));
    return _course_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_custom_tag(p_course_id uuid, p_label text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _id     uuid;
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_custom_tag');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    insert into custom_tag (course_id, label)
    values (p_course_id, p_label)
    returning id into _id;

    perform fv_idem_store(p_idempotency_key, 'create_custom_tag', jsonb_build_object('id', _id));
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.create_observation(p_course_id uuid, p_body text, p_sentiment text DEFAULT NULL::text, p_context_type text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid, p_enrollment_ids uuid[] DEFAULT '{}'::uuid[], p_tag_ids uuid[] DEFAULT '{}'::uuid[], p_custom_tag_ids uuid[] DEFAULT '{}'::uuid[], p_idempotency_key uuid DEFAULT NULL::uuid, p_dims text[] DEFAULT NULL::text[], p_level smallint DEFAULT NULL::smallint, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _id     uuid;
    _x      uuid;
    _cached jsonb;
    _tpl    uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_observation');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    -- RLS hides other teachers' starters, so theirs reads as null.
    if p_template_id is not null then
        select id into _tpl from observation_template where id = p_template_id;
    end if;

    insert into observation (course_id, body, sentiment, context_type, assessment_id, dims, level, template_id)
    values (p_course_id, p_body, p_sentiment, p_context_type, p_assessment_id,
            array(select d from unnest(p_dims) with ordinality u(d, n) where nullif(d, '') is not null order by n),
            p_level, _tpl)
    returning id into _id;

    if p_enrollment_ids is not null then
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_observation', jsonb_build_object('id', _id));
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.create_phone_report(p_course_id uuid, p_term integer, p_term_label text, p_expires_on date, p_students jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _id     uuid;
    _label  text := nullif(btrim(coalesce(p_term_label, '')), '');
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'create_phone_report');
    if _cached is not null then
        return _cached;
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    if p_expires_on is null or p_expires_on < current_date then
        raise exception 'the last day must be today or later' using errcode = '22023';
    end if;
    insert into phone_report (course_id, term, term_label, expires_on, created_by)
    values (p_course_id, p_term, _label, p_expires_on, (select auth.uid()))
    returning id into _id;
    perform _phone_report_put(_id, p_course_id, p_students);
    _cached := _phone_report_json(_id);
    perform fv_idem_store(p_idempotency_key, 'create_phone_report', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_report_issue(p_course_id uuid, p_term integer, p_term_label text, p_paper text, p_form jsonb, p_students jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _id     uuid;
    _at     timestamptz;
    _n      integer;
    _bad    integer;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_report_issue');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_course(p_course_id) then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;
    if p_students is null or jsonb_typeof(p_students) <> 'array' or jsonb_array_length(p_students) = 0 then
        raise exception 'no students to issue' using errcode = '22023';
    end if;

    -- Every enrollment must be in this course (withdrawn students may be
    -- issued; a report can go home after a withdrawal).
    select count(*) into _bad
      from jsonb_array_elements(p_students) s
      left join enrollment e on e.id = (s->>'enrollment_id')::uuid and e.course_id = p_course_id
     where e.id is null;
    if _bad > 0 then
        raise exception '% student(s) are not in this course', _bad using errcode = '22023';
    end if;

    insert into report_issue (course_id, term, term_label, paper, form, issued_by, student_count)
    values (p_course_id, p_term, nullif(btrim(coalesce(p_term_label, '')), ''),
            coalesce(p_paper, 'letter'), p_form, (select auth.uid()), jsonb_array_length(p_students))
    returning id, issued_at, student_count into _id, _at, _n;

    insert into report_issue_student (issue_id, enrollment_id, sheets, hash, html)
    select _id,
           (s->>'enrollment_id')::uuid,
           greatest(1, least(20, coalesce((s->>'sheets')::integer, 1))),
           coalesce(s->>'hash', ''),
           coalesce(s->>'html', '')
      from jsonb_array_elements(p_students) s;

    _result := jsonb_build_object('id', _id, 'issued_at', _at, 'student_count', _n);
    perform fv_idem_store(p_idempotency_key, 'create_report_issue', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_student_and_enroll(p_course_id uuid, p_first_name text, p_last_name text DEFAULT NULL::text, p_preferred_name text DEFAULT NULL::text, p_pronouns text DEFAULT NULL::text, p_student_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_designations text[] DEFAULT '{}'::text[], p_existing_student_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid        uuid := (select auth.uid());
    _student_id uuid;
    _enroll_id  uuid;
    _next_pos   int;
    _cached     jsonb;
    _result     jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_student_and_enroll');
    if _cached is not null then
        return _cached;
    end if;

    if p_existing_student_id is not null then
        _student_id := p_existing_student_id;
    else
        insert into student (teacher_id, first_name, last_name, preferred_name,
                             pronouns, student_number, email, date_of_birth)
        values (_uid, p_first_name, p_last_name, p_preferred_name,
                p_pronouns, p_student_number, p_email, p_date_of_birth)
        returning id into _student_id;
    end if;

    select coalesce(max(roster_position) + 1, 0) into _next_pos
      from enrollment
     where course_id = p_course_id;

    insert into enrollment (student_id, course_id, designations, roster_position)
    values (_student_id, p_course_id, coalesce(p_designations, '{}'), _next_pos)
    returning id into _enroll_id;

    _result := jsonb_build_object('student_id', _student_id, 'enrollment_id', _enroll_id);
    perform fv_idem_store(p_idempotency_key, 'create_student_and_enroll', _result);
    return _result;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_assessment(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from assessment where id = p_id;
    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_category(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _course uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    select course_id into _course from category where id = p_id;
    if _course is not null
       and exists (select 1 from assessment where category_id = p_id)
       and exists (select 1 from category where course_id = _course and id <> p_id) then
        raise exception 'category in use: move its assessments to another category first'
            using errcode = 'P0001';
    end if;

    delete from category where id = p_id;
    if not found then
        raise exception 'category not found' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_comment_template(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'delete_comment_template');
    if _cached is not null then
        return _cached;
    end if;
    delete from comment_template where id = p_id and teacher_id = (select auth.uid());
    if not found then
        raise exception 'comment template not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_comment_template', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_competency_group(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    -- section.competency_group_id is ON DELETE SET NULL (composite FK, match simple).
    delete from competency_group where id = p_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_course(p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course
       set deleted_at = now(),
           updated_at = now()
     where id = p_course_id
       and teacher_id = _uid
       and deleted_at is null;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    update teacher_preference
       set active_course_id = null
     where teacher_id = _uid
       and active_course_id = p_course_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_custom_tag(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- RLS hides other teachers' tags; an already-deleted tag matches nothing.
    -- Both are a successful no-op.
    delete from custom_tag where id = p_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_custom_tag_by_label(p_course_id uuid, p_label text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _deleted_count integer;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    delete from custom_tag where course_id = p_course_id and label = p_label;
    get diagnostics _deleted_count = row_count;
    return _deleted_count;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_guardian(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_guardian');
    if _cached is not null then
        return _cached;
    end if;

    delete from guardian g
     where g.id = p_id
       and exists (select 1 from student s where s.id = g.student_id and s.teacher_id = (select auth.uid()));
    if not found then
        raise exception 'guardian not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_guardian', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_module(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- assessment.module_id is ON DELETE SET NULL; no pre-update needed.
    delete from module where id = p_id;
    if not found then
        raise exception 'module not found' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_note(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from note where id = p_id;
    if not found then raise exception 'note not found' using errcode = 'P0002'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_observation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from observation where id = p_id;
    if not found then raise exception 'observation not found' using errcode = 'P0002'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_observation_template(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _n int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from observation_template where id = p_id and is_seed = false;
    get diagnostics _n = row_count;
    if _n = 0 then
        raise exception 'observation_template not found or is seed (immutable)' using errcode = 'P0002';
    end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_questionnaire(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'delete_questionnaire');
    if _cached is not null then
        return _cached;
    end if;
    if exists (select 1 from response where questionnaire_id = p_id) then
        raise exception 'students have answered this questionnaire' using errcode = '23503';
    end if;
    delete from questionnaire where id = p_id and fv_owns_course(course_id);
    if not found then
        raise exception 'questionnaire not found' using errcode = 'P0002';
    end if;
    _cached := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_questionnaire', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_report_issue(p_issue_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_report_issue');
    if _cached is not null then
        return _cached;
    end if;

    select course_id into _course from report_issue where id = p_issue_id;
    if not found or not fv_owns_course(_course) then
        raise exception 'issue not found' using errcode = 'P0002';
    end if;

    delete from report_issue where id = p_issue_id;

    _result := jsonb_build_object('id', p_issue_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_report_issue', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_report_template(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_report_template');
    if _cached is not null then
        return _cached;
    end if;

    delete from report_template where id = p_id and teacher_id = (select auth.uid());
    if not found then
        raise exception 'report template not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_report_template', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_rubric(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- assessment.rubric_id is ON DELETE SET NULL; criterion/criterion_tag/rubric_score cascade.
    delete from rubric where id = p_id;
    if not found then
        raise exception 'rubric not found' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_section(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from section where id = p_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_subject(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from subject where id = p_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_submission(p_submission_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _pages  int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock): the same request
    -- sent twice at once waits above, and the second is answered as a repeat.
    _cached := fv_idem_check(p_idempotency_key, 'delete_submission');
    if _cached is not null then return _cached; end if;
    select count(*) into _pages from submission_file f join submission s on s.id = f.submission_id
     where s.id = p_submission_id and s.course_id = _course and (s.state = 'sent' or s.sent_by = 'teacher');
    perform set_config('fv.work_removal_reason', 'teacher', true);
    delete from submission s
     where s.id = p_submission_id and s.course_id = _course and (s.state = 'sent' or s.sent_by = 'teacher');
    -- One answer whether it was never there, is another teacher's, or was
    -- already deleted: a repeated call is not an error.
    _cached := jsonb_build_object('deleted', found, 'pages', case when found then _pages else 0 end);
    perform set_config('fv.work_removal_reason', '', true);
    perform fv_idem_store(p_idempotency_key, 'delete_submission', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_tag(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from tag where id = p_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_withdrawn_student(p_enrollment_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached       jsonb;
    _student_id   uuid;
    _withdrawn_at timestamptz;
    _obs_ids      uuid[];
    _obs_deleted  int := 0;
    _student_gone boolean := false;
    _result       jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_withdrawn_student');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    select student_id, withdrawn_at into _student_id, _withdrawn_at
      from enrollment where id = p_enrollment_id
       for update;
    if not found then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;
    if _withdrawn_at is null then
        raise exception 'withdraw the student before deleting them' using errcode = '55000';
    end if;

    -- Observations about this student; the ones left about no one go too.
    select coalesce(array_agg(observation_id), '{}') into _obs_ids
      from observation_student where enrollment_id = p_enrollment_id;

    delete from enrollment where id = p_enrollment_id;

    delete from observation o
     where o.id = any(_obs_ids)
       and not exists (select 1 from observation_student os where os.observation_id = o.id);
    get diagnostics _obs_deleted = row_count;

    delete from student s
     where s.id = _student_id
       and not exists (select 1 from enrollment e where e.student_id = s.id);
    _student_gone := found;

    _result := jsonb_build_object(
        'enrollment_id', p_enrollment_id,
        'student_deleted', _student_gone,
        'observations_deleted', _obs_deleted
    );
    perform fv_idem_store(p_idempotency_key, 'delete_withdrawn_student', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_assessment(p_src_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _new_id   uuid;
    _course   uuid;
    _module   uuid;
    _next_pos int;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'duplicate_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select course_id, module_id into _course, _module
      from assessment
     where id = p_src_id;
    if _course is null then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = _course
       and module_id is not distinct from _module;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, collab_mode, collab_config, display_order,
                            core_competency_ids)
    select course_id, category_id, title || ' (copy)', description, date_assigned, due_date,
           score_mode, max_points, weight, evidence_type,
           rubric_id, module_id, collab_mode, collab_config, _next_pos,
           core_competency_ids
      from assessment
     where id = p_src_id
    returning id into _new_id;

    insert into assessment_tag (assessment_id, tag_id)
    select _new_id, tag_id from assessment_tag where assessment_id = p_src_id;

    perform fv_idem_store(p_idempotency_key, 'duplicate_assessment', jsonb_build_object('id', _new_id));
    return _new_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.duplicate_course(p_src_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid        uuid := (select auth.uid());
    _new_course uuid := gen_random_uuid();
    _new_id     uuid;
    _subj_map   jsonb := '{}';
    _cgrp_map   jsonb := '{}';
    _sect_map   jsonb := '{}';
    _tag_map    jsonb := '{}';
    _rubric_map jsonb := '{}';
    _crit_map   jsonb := '{}';
    _row        record;
    _cached     jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'duplicate_course');
    if _cached is not null then return (_cached->>'id')::uuid; end if;
    if not exists (select 1 from course where id = p_src_id and teacher_id = _uid) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    insert into course (id, teacher_id, name, grade_level, description, color,
                        is_archived, display_order, grading_system, calc_method,
                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades
    from course where id = p_src_id;

    insert into report_config (course_id, preset, blocks_config)
    select _new_course, preset, blocks_config from report_config where course_id = p_src_id;

    for _row in select * from subject where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into subject (id, course_id, name, display_order)
        values (_new_id, _new_course, _row.name, _row.display_order);
        _subj_map := _subj_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from competency_group where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into competency_group (id, course_id, name, color, display_order, counts_as_one)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order, _row.counts_as_one);
        _cgrp_map := _cgrp_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from section where course_id = p_src_id and removed_at is null loop
        _new_id := gen_random_uuid();
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order)
        values (_new_id, _new_course,
            (_subj_map ->> _row.subject_id::text)::uuid,
            case when _row.competency_group_id is not null
                 then (_cgrp_map ->> _row.competency_group_id::text)::uuid
                 else null end,
            _row.name, _row.display_order);
        _sect_map := _sect_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select t.* from tag t join section s on s.id = t.section_id where s.course_id = p_src_id and s.removed_at is null loop
        _new_id := gen_random_uuid();
        insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values (_new_id, (_sect_map ->> _row.section_id::text)::uuid,
            _row.code, _row.label, _row.i_can_text, _row.i_can_statements, _row.source_text, _row.bank_id, _row.display_order);
        _tag_map := _tag_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from module where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into module (id, course_id, name, color, display_order)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order);
    end loop;

    for _row in select * from rubric where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into rubric (id, course_id, name, style) values (_new_id, _new_course, _row.name, _row.style);
        _rubric_map := _rubric_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select c.* from criterion c join rubric r on r.id = c.rubric_id where r.course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into criterion (id, rubric_id, name,
            level_4_descriptor, level_3_descriptor, level_2_descriptor, level_1_descriptor,
            level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order)
        values (_new_id, (_rubric_map ->> _row.rubric_id::text)::uuid, _row.name,
            _row.level_4_descriptor, _row.level_3_descriptor,
            _row.level_2_descriptor, _row.level_1_descriptor,
            _row.level_4_value, _row.level_3_value, _row.level_2_value, _row.level_1_value,
            _row.weight, _row.display_order);
        _crit_map := _crit_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    insert into criterion_tag (criterion_id, tag_id)
    select (_crit_map ->> ct.criterion_id::text)::uuid,
           (_tag_map  ->> ct.tag_id::text)::uuid
    from criterion_tag ct
    join criterion c on c.id = ct.criterion_id
    join rubric r on r.id = c.rubric_id
    where r.course_id = p_src_id
      and (_crit_map ->> ct.criterion_id::text) is not null
      and (_tag_map  ->> ct.tag_id::text) is not null;

    -- Competencies a whole rubric scores.
    insert into rubric_tag (rubric_id, tag_id)
    select (_rubric_map ->> rt.rubric_id::text)::uuid,
           (_tag_map    ->> rt.tag_id::text)::uuid
    from rubric_tag rt
    join rubric r on r.id = rt.rubric_id
    where r.course_id = p_src_id
      and (_rubric_map ->> rt.rubric_id::text) is not null
      and (_tag_map    ->> rt.tag_id::text) is not null;

    -- Advanced Rubrics: the checkboxes go with their criteria. Ticks
    -- (rubric_check_score) stay with the source class, as rubric scores do.
    insert into criterion_check (criterion_id, level, label, display_order)
    select (_crit_map ->> ck.criterion_id::text)::uuid, ck.level, ck.label, ck.display_order
    from criterion_check ck
    join criterion c on c.id = ck.criterion_id
    join rubric r on r.id = c.rubric_id
    where r.course_id = p_src_id
      and (_crit_map ->> ck.criterion_id::text) is not null;

    insert into custom_tag (course_id, label)
    select _new_course, label from custom_tag where course_id = p_src_id;


    perform fv_idem_store(p_idempotency_key, 'duplicate_course', jsonb_build_object('id', _new_course));
    return _new_course;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fill_rubric(p_enrollment_id uuid, p_assessment_id uuid, p_value integer, p_modifier smallint DEFAULT 0)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.finish_handout_upload(p_resource_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached  jsonb;
    _course  uuid;
    _r       assessment_resource%rowtype;
    _missing jsonb;
    _bad     jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from assessment_resource r
     where r.id = p_resource_id and r.kind = 'pdf' and fv_owns_assessment(r.assessment_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock): the same request
    -- sent twice at once waits above, and the second is answered as a repeat.
    _cached := fv_idem_check(p_idempotency_key, 'finish_handout_upload');
    if _cached is not null then return _cached; end if;
    if _course is null then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    -- An upload that has lost its place is dropped here, with the class's others.
    perform _handout_drop_expired(_course);
    select * into _r from assessment_resource where id = p_resource_id for update;
    if not found then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    if _r.status = 'uploading' then
        select coalesce(jsonb_agg(g.n order by g.n) filter (where w.n is null), '[]'::jsonb),
               coalesce(jsonb_agg(g.n order by g.n)
                        filter (where w.n is not null
                                  and (w.mimetype = 'image/jpeg' and w.bytes between 1 and _work_max_bytes()) is not true), '[]'::jsonb)
          into _missing, _bad
          from generate_series(1, _r.page_count) g(n)
          left join lateral (select g.n, x.bytes, x.mimetype
                               from _work_object(_handout_path(_r.course_id, _r.id, g.n)) x) w on true;
        if _missing <> '[]'::jsonb or _bad <> '[]'::jsonb then
            return _assessment_resource_json(_r.id)
                   || jsonb_build_object('missing', _missing)
                   || case when _bad <> '[]'::jsonb then jsonb_build_object('bad', _bad) else '{}'::jsonb end;
        end if;
        update assessment_resource set status = 'ready', updated_at = now() where id = _r.id;
    end if;
    _cached := _assessment_resource_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'finish_handout_upload', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finish_work_upload(p_submission_id uuid, p_files jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _sub    submission%rowtype;
    _target submission%rowtype;
    _state  jsonb;
    _last   int;
    _pages  int;
    _result uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    perform _work_check_files(p_files);
    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock): the same request
    -- sent twice at once waits above, and the second is answered as a repeat.
    _cached := fv_idem_check(p_idempotency_key, 'finish_work_upload');
    if _cached is not null then return _cached; end if;
    if _course is null then
        -- Never existed, another teacher's, or already finished and since
        -- replaced or deleted. The same answer for all of them.
        return jsonb_build_object('result', 'gone');
    end if;
    -- An upload that has lost its place is dropped here, with the class's others.
    perform _work_drop_expired(_course);
    -- The teacher's own upload, and never a student's unfinished send.
    select * into _sub from submission where id = p_submission_id and sent_by = 'teacher' for update;
    if not found then
        return jsonb_build_object('result', 'gone');
    end if;
    if _sub.state = 'sent' then
        return jsonb_build_object('result', 'sent', 'submission', _submission_json(_sub.id) - 'intent' - 'target_id');
    end if;
    if exists (select 1 from jsonb_array_elements(p_files) x
                where not exists (select 1 from submission_file f
                                   where f.submission_id = _sub.id and f.id = (x->>'file_id')::uuid)) then
        raise exception 'a file is not one of this upload''s' using errcode = '22023';
    end if;
    _state := _work_files_state(_sub.id, p_files);
    if _state->'missing' <> '[]'::jsonb then
        -- Not remembered: the next try looks again.
        return jsonb_build_object('result', 'missing_pages', 'missing', _state->'missing');
    end if;
    if _state->'bad' <> '[]'::jsonb then
        return jsonb_build_object('result', 'bad_file', 'files', _state->'bad');
    end if;

    if _sub.intent <> 'new' then
        select * into _target from submission where id = _sub.target_id and state = 'sent' for update;
        if not found then
            -- cannot happen: an unfinished upload goes with the work it was for
            return jsonb_build_object('result', 'gone');
        end if;
    end if;
    if _sub.intent = 'add' then
        -- 30 pages at most in one submission (ruling 88), asked again now:
        -- the work may have grown since the start asked (a student's Replace
        -- finished meanwhile, and this upload now adds to it). Not
        -- remembered, and the upload stays: finish it with fewer pages (the
        -- ones left out are deleted) or start again.
        _pages := (select count(*) from submission_file f where f.submission_id = _target.id);
        if _pages + jsonb_array_length(p_files) > 30 then
            return jsonb_build_object('result', 'too_many_pages', 'room', greatest(30 - _pages, 0));
        end if;
    end if;
    perform _work_settle_files(_sub.id, p_files);
    if _sub.intent = 'add' then
        -- Its pages go on the end of what was sent, each still marked as the
        -- teacher's, and the row that carried them goes (it has no pages
        -- left, so nothing is queued).
        select coalesce(max(f.page), 0) into _last from submission_file f where f.submission_id = _target.id;
        update submission_file set submission_id = _target.id, page = page + _last where submission_id = _sub.id;
        delete from submission where id = _sub.id;
        update submission set updated_at = now() where id = _target.id;
        _result := _target.id;
    else
        if _sub.intent = 'replace' then
            -- Let go of what it replaces first: an unfinished upload goes
            -- with its target, and this one is about to take its place.
            update submission set intent = 'new', target_id = null where id = _sub.id;
            perform set_config('fv.work_removal_reason', 'replace', true);
            delete from submission where id = _target.id;
            perform set_config('fv.work_removal_reason', '', true);
        elsif exists (select 1 from submission
                       where assessment_id = _sub.assessment_id and enrollment_id = _sub.enrollment_id and state = 'sent') then
            -- The student sent while the teacher's pages were going up.
            perform set_config('fv.work_removal_reason', 'abandoned', true);
            delete from submission where id = _sub.id;
            perform set_config('fv.work_removal_reason', '', true);
            return jsonb_build_object('result', 'already_sent');
        end if;
        update submission
           set state = 'sent', intent = 'new', target_id = null, version = coalesce(_target.version, version),
               sent_at = now(), updated_at = now()
         where id = _sub.id;
        _result := _sub.id;
    end if;
    _cached := jsonb_build_object('result', 'sent', 'submission', _submission_json(_result) - 'intent' - 'target_id');
    perform fv_idem_store(p_idempotency_key, 'finish_work_upload', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_assessment_overall(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS public.score_result
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select null::score_result $function$;

CREATE OR REPLACE FUNCTION public.fv_check_category_weight_sum()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.fv_check_reporting_terms(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
    _t jsonb;
    _n int;
begin
    if p is null then return true; end if;
    if jsonb_typeof(p) <> 'array' then return false; end if;
    if jsonb_array_length(p) > 6 then return false; end if;

    for _t in select * from jsonb_array_elements(p) loop
        if jsonb_typeof(_t) <> 'object' then return false; end if;
        if jsonb_typeof(_t->'ordinal') <> 'number' then return false; end if;
        _n := (_t->>'ordinal')::numeric;
        if _n::numeric <> (_t->>'ordinal')::numeric or _n < 1 or _n > 6 then return false; end if;
        if coalesce(btrim(_t->>'label'), '') = '' then return false; end if;
        if (_t->>'starts_on') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
        if (_t->>'ends_on')   !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
        if (_t->>'starts_on')::date > (_t->>'ends_on')::date then return false; end if;
    end loop;

    -- ordinals unique
    if (select count(*) from jsonb_array_elements(p) e)
       <> (select count(distinct e->>'ordinal') from jsonb_array_elements(p) e) then
        return false;
    end if;
    return true;
exception when others then
    return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_course_letter_pipeline(p_enrollment_id uuid, p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select null::jsonb $function$;

CREATE OR REPLACE FUNCTION public.fv_idem_check(p_key uuid, p_endpoint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _r   jsonb;
begin
    if _uid is null or p_key is null then
        return null;
    end if;
    -- Held until the calling RPC's transaction ends. A concurrent call with
    -- the same key blocks here, then sees the result the first one stored.
    perform pg_advisory_xact_lock(hashtext(_uid::text), hashtext(p_key::text));
    select result into _r
      from fv_idempotency
     where key = p_key
       and teacher_id = _uid
       and endpoint = p_endpoint;
    return _r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_idem_store(p_key uuid, p_endpoint text, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null or p_key is null then
        return;
    end if;
    insert into fv_idempotency (key, teacher_id, endpoint, result)
      values (p_key, _uid, p_endpoint, p_result)
      on conflict (key, teacher_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_overall_proficiency(p_enrollment_id uuid, p_course_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select null::numeric $function$;

CREATE OR REPLACE FUNCTION public.fv_owns_assessment(aid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select exists (select 1 from assessment a join course c on c.id = a.course_id
                   where a.id = aid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_course(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select exists (select 1 from course c
                   where c.id = cid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_enrollment(eid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select exists (select 1 from enrollment e join course c on c.id = e.course_id
                   where e.id = eid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_rubric_check_cell(eid uuid, aid uuid, ckid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    return exists (select 1 from enrollment e
                         join course c on c.id = e.course_id
                         join assessment a on a.course_id = e.course_id
                         join rubric r on r.course_id = e.course_id
                         join criterion cr on cr.rubric_id = r.id
                         join criterion_check ck on ck.criterion_id = cr.id
                       where e.id = eid and a.id = aid and ck.id = ckid
                         and c.teacher_id = (select auth.uid())
                         and c.deleted_at is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_rubric_score_cell(eid uuid, aid uuid, crid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    return exists (select 1 from enrollment e
                         join course c on c.id = e.course_id
                         join assessment a on a.course_id = e.course_id
                         join rubric r on r.course_id = e.course_id
                         join criterion cr on cr.rubric_id = r.id
                       where e.id = eid and a.id = aid and cr.id = crid
                         and c.teacher_id = (select auth.uid())
                         and c.deleted_at is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_score_cell(eid uuid, aid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    return exists (select 1 from enrollment e
                         join course c on c.id = e.course_id
                         join assessment a on a.course_id = e.course_id
                       where e.id = eid and a.id = aid
                         and c.teacher_id = (select auth.uid())
                         and c.deleted_at is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_tag_score_cell(eid uuid, aid uuid, tid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    return exists (select 1 from enrollment e
                         join course c on c.id = e.course_id
                         join assessment a on a.course_id = e.course_id
                         join section s on s.course_id = e.course_id
                         join tag t on t.section_id = s.id
                       where e.id = eid and a.id = aid and t.id = tid
                         and c.teacher_id = (select auth.uid())
                         and c.deleted_at is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fv_owns_term_rating(trid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select exists (select 1 from term_rating tr join enrollment e on e.id = tr.enrollment_id
                   join course c on c.id = e.course_id
                   where tr.id = trid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.fv_q_to_percentage(q numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select null::numeric $function$;

CREATE OR REPLACE FUNCTION public.fv_retention_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _teachers_purged int;
    _courses_purged int;
    _students_purged int;
    _purge_students uuid[];
    _score_audit_purged int;
    _tr_audit_purged    int;
begin
    -- Hard-delete teachers whose soft-delete passed the 30-day grace window.
    -- Cascades: teacher → student/enrollment/score/observation/term_rating/etc.
    delete from teacher
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _teachers_purged = row_count;

    -- Hard-delete classes whose soft-delete passed the 30-day grace window.
    -- Cascades through enrollment, assessment, observation, etc. Remember
    -- their students first so the ones left with no class go too.
    select coalesce(array_agg(distinct e.student_id), '{}')
      into _purge_students
      from enrollment e
      join course c on c.id = e.course_id
     where c.deleted_at is not null
       and c.deleted_at < now() - interval '30 days';

    delete from course
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _courses_purged = row_count;

    delete from student s
     where s.id = any(_purge_students)
       and not exists (select 1 from enrollment e where e.student_id = s.id);
    get diagnostics _students_purged = row_count;

    -- Audit retention: 2 years.
    delete from score_audit where changed_at < now() - interval '2 years';
    get diagnostics _score_audit_purged = row_count;

    delete from term_rating_audit where changed_at < now() - interval '2 years';
    get diagnostics _tr_audit_purged = row_count;

    return jsonb_build_object(
        'teachers_purged',     _teachers_purged,
        'courses_purged',      _courses_purged,
        'students_purged',     _students_purged,
        'score_audit_purged',  _score_audit_purged,
        'term_rating_audit_purged', _tr_audit_purged,
        'ran_at', now()
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.fv_section_proficiency(p_enrollment_id uuid, p_section_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select null::numeric $function$;

CREATE OR REPLACE FUNCTION public.fv_status_counts(p_enrollment_id uuid, p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    graded int := 0;
    ns_cnt int := 0;
    excused int := 0;
    late_cnt int := 0;
    not_yet_graded int := 0;
    a record;
    s score%rowtype;
begin
    for a in select id from assessment where course_id = p_course_id loop
        select * into s from score
          where enrollment_id = p_enrollment_id and assessment_id = a.id;
        if not found then
            not_yet_graded := not_yet_graded + 1;
        elsif s.status = 'NS' then
            ns_cnt := ns_cnt + 1;
        elsif s.status = 'EXC' then
            excused := excused + 1;
        elsif s.status = 'LATE' then
            late_cnt := late_cnt + 1;
            if s.value is not null then graded := graded + 1;
            else not_yet_graded := not_yet_graded + 1; end if;
        elsif s.value is not null then
            graded := graded + 1;
        else
            not_yet_graded := not_yet_graded + 1;
        end if;
    end loop;
    return jsonb_build_object(
        'graded', graded, 'ns', ns_cnt, 'excused', excused,
        'late', late_cnt, 'not_yet_graded', not_yet_graded
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_assessment_detail(p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _a assessment%rowtype;
    _course course%rowtype;
    _category category%rowtype;  _has_cat bool := false;
    _module module%rowtype;      _has_mod bool := false;
    _rubric rubric%rowtype;      _has_rub bool := false;
    _criteria jsonb;
    _crit_tags jsonb;
    _linked_tags jsonb;
    _cells jsonb;
begin
    select * into _a from assessment where id = p_assessment_id;
    if not found then
        raise exception 'assessment not found or not owned';
    end if;
    select * into _course from course where id = _a.course_id;

    if _a.category_id is not null then
        select * into _category from category where id = _a.category_id;
        _has_cat := found;
    end if;
    if _a.module_id is not null then
        select * into _module from module where id = _a.module_id;
        _has_mod := found;
    end if;
    if _a.rubric_id is not null then
        select * into _rubric from rubric where id = _a.rubric_id;
        _has_rub := found;

        select coalesce(jsonb_agg(to_jsonb(c) order by c.display_order, c.name), '[]'::jsonb)
          into _criteria
          from criterion c where c.rubric_id = _a.rubric_id;

        select coalesce(jsonb_agg(jsonb_build_object(
                 'criterion_id', ct.criterion_id,
                 'tag_id',       ct.tag_id,
                 'tag_code',     t.code,
                 'tag_label',    t.label,
                 'section_id',   t.section_id
               )), '[]'::jsonb)
          into _crit_tags
          from criterion_tag ct
          join criterion c on c.id = ct.criterion_id
          join tag t on t.id = ct.tag_id
         where c.rubric_id = _a.rubric_id;
    else
        _criteria := '[]'::jsonb;
        _crit_tags := '[]'::jsonb;
    end if;

    -- Linked tags (via assessment_tag).
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'code', t.code, 'label', t.label,
             'i_can_text', t.i_can_text, 'section_id', t.section_id
           ) order by t.display_order, t.label), '[]'::jsonb)
      into _linked_tags
      from assessment_tag at
      join tag t on t.id = at.tag_id
     where at.assessment_id = p_assessment_id;

    -- Per-cell state for every active enrollment.
    with enrs as (
      select e.id as enrollment_id, e.student_id, e.roster_position, e.is_flagged,
             s.first_name, s.last_name, s.preferred_name
        from enrollment e join student s on s.id = e.student_id
       where e.course_id = _a.course_id and e.withdrawn_at is null
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'enrollment_id',   enrs.enrollment_id,
             'student_id',      enrs.student_id,
             'first_name',      enrs.first_name,
             'last_name',       enrs.last_name,
             'preferred_name',  enrs.preferred_name,
             'roster_position', enrs.roster_position,
             'is_flagged',      enrs.is_flagged,
             'score', (
                select to_jsonb(s) from score s
                 where s.enrollment_id = enrs.enrollment_id
                   and s.assessment_id = p_assessment_id
             ),
             'overall', to_jsonb(fv_assessment_overall(enrs.enrollment_id, p_assessment_id)),
             'rubric_scores', coalesce((
                select jsonb_agg(jsonb_build_object('criterion_id', rs.criterion_id, 'value', rs.value, 'modifier', rs.modifier))
                  from rubric_score rs
                 where rs.enrollment_id = enrs.enrollment_id
                   and rs.assessment_id = p_assessment_id
             ), '[]'::jsonb),
             'tag_scores', coalesce((
                select jsonb_agg(jsonb_build_object('tag_id', ts.tag_id, 'value', ts.value, 'modifier', ts.modifier))
                  from tag_score ts
                 where ts.enrollment_id = enrs.enrollment_id
                   and ts.assessment_id = p_assessment_id
             ), '[]'::jsonb)
           ) order by enrs.roster_position, enrs.last_name, enrs.first_name), '[]'::jsonb)
      into _cells
      from enrs;

    return jsonb_build_object(
      'assessment',     to_jsonb(_a),
      'course',         to_jsonb(_course),
      'category',       case when _has_cat then to_jsonb(_category) else null end,
      'module',         case when _has_mod then to_jsonb(_module)   else null end,
      'rubric',         case when _has_rub then to_jsonb(_rubric)   else null end,
      'criteria',       _criteria,
      'criterion_tags', _crit_tags,
      'linked_tags',    _linked_tags,
      'cells',          _cells
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_class_bundle(p_course_id uuid, p_if_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
    _course public.course%rowtype;
    _version bigint;
    _gradebook jsonb;
    _learning_map jsonb;
    _rubrics jsonb;
    _observations jsonb;
    _profiles jsonb;
    _term_ratings jsonb;
    _report_config jsonb;
    _custom_tags jsonb;
    _observation_templates jsonb;
    _course_config jsonb;
    _withdrawn jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- The only access check: everything below reads by p_course_id.
    select * into _course from public.course
     where id = p_course_id and teacher_id = (select auth.uid()) and deleted_at is null;
    if not found then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    select coalesce((select version from public.course_sync_cursor where course_id = p_course_id), 0) into _version;
    if p_if_version is not null and p_if_version = _version then
        return jsonb_build_object('not_modified', true, 'version', _version);
    end if;

    -- ── Gradebook: get_gradebook's roster, assessments, categories and
    --    modules, with scores as compact rows instead of `cells`.
    with
    enr as (
        select e.*, s.first_name, s.last_name, s.preferred_name, s.pronouns,
               s.student_number, s.email, s.date_of_birth,
               (row_number() over (order by e.roster_position, s.last_name, s.first_name, e.id) - 1)::int as ix
          from public.enrollment e join public.student s on s.id = e.student_id
         where e.course_id = p_course_id and e.withdrawn_at is null
    ),
    asm as (
        select a.*, (row_number() over (order by a.display_order, a.created_at, a.id) - 1)::int as ix
          from public.assessment a where a.course_id = p_course_id
    ),
    tg as (
        select t.id, (row_number() over (order by t.id) - 1)::int as ix
          from public.tag t join public.section sec on sec.id = t.section_id
         where sec.course_id = p_course_id
    ),
    cr as (
        select c.id, (row_number() over (order by c.id) - 1)::int as ix
          from public.criterion c join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    ck as (
        select ck.id, (row_number() over (order by ck.id) - 1)::int as ix
          from public.criterion_check ck
          join public.criterion c on c.id = ck.criterion_id
          join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    asm_tags as (
        select at.assessment_id, jsonb_agg(at.tag_id order by t.display_order, t.label) as tag_ids
          from public.assessment_tag at
          join public.tag t on t.id = at.tag_id
          join asm on asm.id = at.assessment_id
         group by at.assessment_id
    )
    select jsonb_build_object(
        'course', to_jsonb(_course),
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', enr.id, 'student_id', enr.student_id,
                       'first_name', enr.first_name, 'last_name', enr.last_name,
                       'preferred_name', enr.preferred_name, 'pronouns', enr.pronouns,
                       'student_number', enr.student_number, 'email', enr.email,
                       'date_of_birth', enr.date_of_birth, 'designations', enr.designations,
                       'enrolled_at', enr.enrolled_at, 'roster_position', enr.roster_position,
                       'is_flagged', enr.is_flagged
                   ) order by enr.ix)
              from enr), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', asm.id, 'title', asm.title, 'description', asm.description,
                       'category_id', asm.category_id, 'score_mode', asm.score_mode,
                       'max_points', asm.max_points, 'weight', asm.weight,
                       'evidence_type', asm.evidence_type, 'rubric_id', asm.rubric_id,
                       'module_id', asm.module_id, 'collab_mode', asm.collab_mode,
                       'collab_config', asm.collab_config, 'has_rubric', asm.rubric_id is not null,
                       'date_assigned', asm.date_assigned, 'due_date', asm.due_date,
                       'display_order', asm.display_order,
                       'tag_ids', coalesce(asm_tags.tag_ids, '[]'::jsonb),
                       'copy_group', asm.copy_group,
                       'core_competency_ids', to_jsonb(asm.core_competency_ids),
                       'created_at', asm.created_at
                   ) order by asm.ix)
              from asm left join asm_tags on asm_tags.assessment_id = asm.id), '[]'::jsonb),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                'display_order', c.display_order, 'calc_mode', c.calc_mode) order by c.display_order)
              from public.category c where c.course_id = p_course_id), '[]'::jsonb),
        'modules', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'course_id', m.course_id, 'name', m.name,
                                                'color', m.color, 'display_order', m.display_order,
                                                'created_at', m.created_at, 'updated_at', m.updated_at)
                             order by m.display_order)
              from public.module m where m.course_id = p_course_id), '[]'::jsonb),
        -- Positions in tag_rows and criterion_rows point into these.
        'tag_index', coalesce((select jsonb_agg(tg.id order by tg.ix) from tg), '[]'::jsonb),
        'criterion_index', coalesce((select jsonb_agg(cr.id order by cr.ix) from cr), '[]'::jsonb),
        'check_index', coalesce((select jsonb_agg(ck.id order by ck.ix) from ck), '[]'::jsonb),
        -- [student, assessment, value, status, comment, modifier, report_note]
        'score_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment, s.modifier, s.report_note))
              from public.score s
              join enr on enr.id = s.enrollment_id
              join asm on asm.id = s.assessment_id), '[]'::jsonb),
        -- [student, assessment, tag, value, modifier, comment]
        'tag_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, tg.ix, t.value, t.modifier, t.comment))
              from public.tag_score t
              join enr on enr.id = t.enrollment_id
              join asm on asm.id = t.assessment_id
              join tg on tg.id = t.tag_id), '[]'::jsonb),
        -- [student, assessment, criterion, value, modifier, comment, beyond]
        'criterion_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond))
              from public.rubric_score r
              join enr on enr.id = r.enrollment_id
              join asm on asm.id = r.assessment_id
              join cr on cr.id = r.criterion_id), '[]'::jsonb),
        -- [student, assessment, check]: a ticked checkbox (rubric_check_score)
        'check_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, ck.ix))
              from public.rubric_check_score x
              join enr on enr.id = x.enrollment_id
              join asm on asm.id = x.assessment_id
              join ck on ck.id = x.check_id), '[]'::jsonb),
        -- [student, assessment, printed_at, hash]: a printed rubric (rubric_print)
        'print_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, p.printed_at, p.content_hash))
              from public.rubric_print p
              join enr on enr.id = p.enrollment_id
              join asm on asm.id = p.assessment_id), '[]'::jsonb)
    ) into _gradebook;

    -- ── Learning map: same shape as get_learning_map, without the per-tag
    --    class_avg and coverage_count (the client computes its own).
    with
    sections_with_tags as (
        select s.id as section_id, s.subject_id, s.name, s.display_order, s.competency_group_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'code', t.code, 'label', t.label, 'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text, 'bank_id', t.bank_id,
                   'display_order', t.display_order
               ) order by t.display_order, t.label) filter (where t.id is not null), '[]'::jsonb) as tags
          from public.section s
          left join public.tag t on t.section_id = s.id
         where s.course_id = p_course_id and s.removed_at is null
         group by s.id, s.subject_id, s.name, s.display_order, s.competency_group_id
    ),
    subjects_with_sections as (
        select subj.id, subj.name, subj.display_order,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', sec.section_id, 'name', sec.name, 'display_order', sec.display_order,
                   'competency_group_id', sec.competency_group_id, 'tags', sec.tags
               ) order by sec.display_order, sec.name) filter (where sec.section_id is not null), '[]'::jsonb) as sections
          from public.subject subj
          left join sections_with_tags sec on sec.subject_id = subj.id
         where subj.course_id = p_course_id
         group by subj.id, subj.name, subj.display_order
    )
    select jsonb_build_object(
        'competency_groups', coalesce((
            select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                'display_order', cg.display_order,
                                                'counts_as_one', cg.counts_as_one)
                             order by cg.display_order, cg.name)
              from public.competency_group cg where cg.course_id = p_course_id), '[]'::jsonb),
        'subjects', coalesce((
            select jsonb_agg(jsonb_build_object('id', sws.id, 'name', sws.name,
                                                'display_order', sws.display_order, 'sections', sws.sections)
                             order by sws.display_order, sws.name)
              from subjects_with_sections sws), '[]'::jsonb)
    ) into _learning_map;

    -- ── Rubrics: the rows the client read from three tables.
    select jsonb_build_object(
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'created_at', r.created_at,
                                                'copy_group', r.copy_group, 'style', r.style)
                             order by r.created_at, r.id)
              from public.rubric r where r.course_id = p_course_id), '[]'::jsonb),
        'criteria', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'rubric_id', c.rubric_id, 'name', c.name,
                       'level_4_descriptor', c.level_4_descriptor, 'level_3_descriptor', c.level_3_descriptor,
                       'level_2_descriptor', c.level_2_descriptor, 'level_1_descriptor', c.level_1_descriptor,
                       'level_4_value', c.level_4_value, 'level_3_value', c.level_3_value,
                       'level_2_value', c.level_2_value, 'level_1_value', c.level_1_value,
                       'weight', c.weight, 'display_order', c.display_order
                   ) order by c.display_order, c.id)
              from public.criterion c join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_tags', coalesce((
            select jsonb_agg(jsonb_build_object('criterion_id', ct.criterion_id, 'tag_id', ct.tag_id))
              from public.criterion_tag ct
              join public.criterion c on c.id = ct.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'rubric_tags', coalesce((
            select jsonb_agg(jsonb_build_object('rubric_id', rt.rubric_id, 'tag_id', rt.tag_id))
              from public.rubric_tag rt
              join public.rubric r on r.id = rt.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_checks', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', ck.id, 'criterion_id', ck.criterion_id, 'level', ck.level,
                       'label', ck.label, 'display_order', ck.display_order
                   ) order by ck.display_order, ck.id)
              from public.criterion_check ck
              join public.criterion c on c.id = ck.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb)
    ) into _rubrics;

    -- ── Observations: the most recent 500, same row shape as
    --    get_observations, plus the total so the client knows what's older.
    with
    obs as (
        select o.* from public.observation o where o.course_id = p_course_id
         order by o.created_at desc limit 500
    ),
    os as (
        select observation_id, jsonb_agg(enrollment_id) as ids
          from public.observation_student where observation_id in (select id from obs) group by observation_id
    ),
    ot as (
        select observation_id, jsonb_agg(tag_id) as ids
          from public.observation_tag where observation_id in (select id from obs) group by observation_id
    ),
    oct as (
        select observation_id, jsonb_agg(custom_tag_id) as ids
          from public.observation_custom_tag where observation_id in (select id from obs) group by observation_id
    )
    select jsonb_build_object(
        'observations', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', obs.id, 'body', obs.body, 'sentiment', obs.sentiment,
                       'context_type', obs.context_type, 'assessment_id', obs.assessment_id,
                       'created_at', obs.created_at, 'updated_at', obs.updated_at,
                       'dims', to_jsonb(coalesce(obs.dims, '{}'::text[])),
                       'level', obs.level,
                       'enrollment_ids', coalesce(os.ids, '[]'::jsonb),
                       'tag_ids', coalesce(ot.ids, '[]'::jsonb),
                       'custom_tag_ids', coalesce(oct.ids, '[]'::jsonb)
                   ) order by obs.created_at desc)
              from obs
              left join os on os.observation_id = obs.id
              left join ot on ot.observation_id = obs.id
              left join oct on oct.observation_id = obs.id), '[]'::jsonb),
        'total', (select count(*) from public.observation o where o.course_id = p_course_id)
    ) into _observations;

    -- ── Profiles: same row shape as list_course_student_profiles, without the
    --    computed overall_proficiency / letter / counts and override
    --    'calculated', plus the notes it never returned.
    with
    enr as (
        select e.* from public.enrollment e where e.course_id = p_course_id and e.withdrawn_at is null
    ),
    g as (
        select enrollment_id, jsonb_object_agg(section_id::text, body) as v
          from public.goal where enrollment_id in (select id from enr) group by enrollment_id
    ),
    rf as (
        select enrollment_id, jsonb_object_agg(section_id::text, jsonb_build_object(
                   'confidence', confidence, 'text', body, 'date', updated_at)) as v
          from public.reflection where enrollment_id in (select id from enr) group by enrollment_id
    ),
    so as (
        select enrollment_id, jsonb_object_agg(section_id::text, jsonb_build_object(
                   'level', level, 'reason', reason, 'date', updated_at)) as v
          from public.section_override where enrollment_id in (select id from enr) group by enrollment_id
    ),
    nt as (
        select enrollment_id, jsonb_agg(jsonb_build_object('id', id, 'body', body, 'created_at', created_at)
                                        order by created_at) as v
          from public.note where enrollment_id in (select id from enr) group by enrollment_id
    ),
    recent as (
        select x.enrollment_id, jsonb_agg(jsonb_build_object(
                   'id', x.id, 'text', x.body, 'sentiment', x.sentiment, 'context', x.context_type,
                   'created_at', x.created_at, 'observed_at', x.created_at) order by x.created_at desc) as v
          from (
            select os.enrollment_id, o.id, o.body, o.sentiment, o.context_type, o.created_at,
                   row_number() over (partition by os.enrollment_id order by o.created_at desc) as rn
              from public.observation_student os
              join public.observation o on o.id = os.observation_id
             where o.course_id = p_course_id and os.enrollment_id in (select id from enr)
          ) x
         where x.rn <= 3
         group by x.enrollment_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'student', to_jsonb(s.*),
               'enrollment', to_jsonb(enr.*),
               'goals', coalesce(g.v, '{}'::jsonb),
               'reflections', coalesce(rf.v, '{}'::jsonb),
               'section_overrides', coalesce(so.v, '{}'::jsonb),
               'notes', coalesce(nt.v, '[]'::jsonb),
               'is_flagged', enr.is_flagged,
               'recent_observations', coalesce(recent.v, '[]'::jsonb)
           ) order by enr.roster_position, s.last_name, s.first_name), '[]'::jsonb)
      into _profiles
      from enr
      join public.student s on s.id = enr.student_id
      left join g on g.enrollment_id = enr.id
      left join rf on rf.enrollment_id = enr.id
      left join so on so.enrollment_id = enr.id
      left join nt on nt.enrollment_id = enr.id
      left join recent on recent.enrollment_id = enr.id;

    -- ── Term ratings, which the client never read back before.
    with
    tr as (
        select tr.* from public.term_rating tr
          join public.enrollment e on e.id = tr.enrollment_id
         where e.course_id = p_course_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', tr.enrollment_id, 'term', tr.term,
               'narrative_html', tr.narrative_html,
               'work_habits_rating', tr.work_habits_rating,
               'participation_rating', tr.participation_rating,
               'social_traits', to_jsonb(coalesce(tr.social_traits, '{}'::text[])),
               'habits', coalesce(tr.habits, '{}'::jsonb), 'approved_at', tr.approved_at,
               'reporting_basis', tr.reporting_basis, 'ie_deadline', tr.ie_deadline,
               'draft_meta', tr.draft_meta,
               'created_at', tr.created_at, 'updated_at', tr.updated_at,
               'strength_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_strength x
                                           where x.term_rating_id = tr.id), '[]'::jsonb),
               'growth_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_growth_area x
                                         where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_assessments', coalesce((select jsonb_agg(x.assessment_id) from public.term_rating_assessment x
                                                 where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_observations', coalesce((select jsonb_agg(x.observation_id) from public.term_rating_observation x
                                                  where x.term_rating_id = tr.id), '[]'::jsonb)
           )), '[]'::jsonb)
      into _term_ratings
      from tr;

    select to_jsonb(rc) into _report_config from public.report_config rc where rc.course_id = p_course_id;

    select coalesce(jsonb_agg(ct.label order by ct.label), '[]'::jsonb)
      into _custom_tags
      from public.custom_tag ct where ct.course_id = p_course_id;

    -- The class's sentence starters, in the teacher's order.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ot.id,
               'body', ot.body,
               'default_sentiment', ot.default_sentiment,
               'default_context_type', ot.default_context_type,
               'default_dims', ot.default_dims,
               'display_order', ot.display_order,
               'use_count', (select count(*) from public.observation o where o.template_id = ot.id)
           ) order by ot.display_order, ot.created_at, ot.id), '[]'::jsonb)
      into _observation_templates
      from public.observation_template ot where ot.teacher_id = (select auth.uid());

    -- Withdrawn students, newest first: who they are and when, nothing
    -- else. Their scores and records stay out of the bundle until re-enrol.
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id, 'student_id', e.student_id,
               'first_name', s.first_name, 'last_name', s.last_name,
               'preferred_name', s.preferred_name, 'pronouns', s.pronouns,
               'student_number', s.student_number, 'email', s.email,
               'date_of_birth', s.date_of_birth, 'designations', e.designations,
               'enrolled_at', e.enrolled_at, 'roster_position', e.roster_position,
               'is_flagged', e.is_flagged, 'withdrawn_at', e.withdrawn_at
           ) order by e.withdrawn_at desc, s.last_name, s.first_name, e.id), '[]'::jsonb)
      into _withdrawn
      from public.enrollment e join public.student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is not null;

    -- Null means the class never saved one.
    _course_config := jsonb_build_object(
        'grading_scale', _course.grading_scale,
        'category_weights', _course.category_weights
    );

    return jsonb_build_object(
        'bundle_schema', 3,
        'version', _version,
        'gradebook', _gradebook,
        'learning_map', _learning_map,
        'rubrics', _rubrics,
        'observations', _observations,
        'profiles', _profiles,
        'term_ratings', _term_ratings,
        'report_config', _report_config,
        'custom_tags', _custom_tags,
        'observation_templates', _observation_templates,
        'course_config', _course_config,
        'withdrawn_students', _withdrawn
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_class_dashboard(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _course course%rowtype;
    _overalls numeric[];
    _percents numeric[];
    _class_avg_p numeric;
    _class_avg_pct numeric;
    _histo_q jsonb;
    _histo_letter jsonb;
    _per_assessment jsonb;
    _per_group jsonb;
    _at_risk jsonb;
    _flagged int;
begin
    select * into _course from course where id = p_course_id;
    if not found then
        raise exception 'course not found or not owned';
    end if;

    -- Class-wide overall proficiency series (active enrollments only).
    with per_student as (
      select e.id as enrollment_id,
             fv_overall_proficiency(e.id, p_course_id) as op
        from enrollment e
       where e.course_id = p_course_id and e.withdrawn_at is null
    )
    select array_agg(op) filter (where op is not null)
      into _overalls
      from per_student;

    _class_avg_p := case when _overalls is not null and array_length(_overalls,1) > 0
                         then round((
                            select avg(x)::numeric from unnest(_overalls) as x
                         ), 2)
                         else null end;

    -- Proficiency histogram: Q1..Q4 bins.
    select jsonb_build_object(
      'Q1', coalesce(sum(case when x >= 1   and x < 1.5 then 1 else 0 end), 0),
      'Q2', coalesce(sum(case when x >= 1.5 and x < 2.5 then 1 else 0 end), 0),
      'Q3', coalesce(sum(case when x >= 2.5 and x < 3.5 then 1 else 0 end), 0),
      'Q4', coalesce(sum(case when x >= 3.5              then 1 else 0 end), 0),
      'not_yet_graded', coalesce(sum(case when x is null then 1 else 0 end), 0)
    )
    into _histo_q
    from unnest(coalesce(_overalls, '{}'::numeric[])) as x;

    -- Letter grade — only when course is in letter or both mode.
    if _course.grading_system in ('letter', 'both') then
      with per_student as (
        select fv_course_letter_pipeline(e.id, p_course_id) as lp
          from enrollment e
         where e.course_id = p_course_id and e.withdrawn_at is null
      )
      select jsonb_object_agg(letter, cnt)
        into _histo_letter
        from (
          select coalesce((lp->>'letter'), 'N/A') as letter,
                 count(*) as cnt
            from per_student
           group by 1
        ) x;

      with per_student as (
        select fv_overall_proficiency(e.id, p_course_id) as op
          from enrollment e
         where e.course_id = p_course_id and e.withdrawn_at is null
      )
      select round(avg(fv_q_to_percentage(op))::numeric, 2)
        into _class_avg_pct
        from per_student
       where op is not null;
    end if;

    -- Per-assessment averages.
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'assessment_id', a.id,
               'title', a.title,
               'class_avg', row.class_avg,
               'graded_count',   row.graded_count,
               'ungraded_count', row.ungraded_count,
               'display_order', a.display_order
             ) order by a.display_order, a.title
           ), '[]'::jsonb)
      into _per_assessment
      from assessment a
      join lateral (
        with enrs as (
          select e.id as eid from enrollment e
           where e.course_id = p_course_id and e.withdrawn_at is null
        ),
        cells as (
          select (fv_assessment_overall(enrs.eid, a.id)).kind as kind,
                 (fv_assessment_overall(enrs.eid, a.id)).value as value
            from enrs
        )
        select
          round(avg(value) filter (where kind = 'value')::numeric, 2) as class_avg,
          count(*) filter (where kind = 'value' or kind = 'zero') as graded_count,
          count(*) filter (where kind = 'not_yet_graded' or kind = 'excluded') as ungraded_count
          from cells
      ) row on true
     where a.course_id = p_course_id;

    -- Per-competency-group averages: group → sections → tags → tag_scores.
    -- Average is of most-recent tag_score per (enrollment, tag) across all tags in
    -- the group's sections. Ungrouped sections bucket into id=null, name='Unassigned'.
    with
    active_enr as (
      select id from enrollment where course_id = p_course_id and withdrawn_at is null
    ),
    section_group as (
      select s.id as section_id, s.competency_group_id, s.course_id
        from section s where s.course_id = p_course_id
    ),
    latest_ts as (
      select distinct on (ts.enrollment_id, ts.tag_id)
             ts.enrollment_id, ts.tag_id, ts.value + ts.modifier / 3.0 as value
        from (select * from tag_score where value is not null) ts join active_enr e on e.id = ts.enrollment_id
       order by ts.enrollment_id, ts.tag_id, ts.updated_at desc
    ),
    tag_to_group as (
      select t.id as tag_id, sg.competency_group_id as group_id
        from tag t join section_group sg on sg.section_id = t.section_id
    ),
    group_avg as (
      select ttg.group_id,
             round(avg(lts.value)::numeric, 2) as class_avg
        from latest_ts lts join tag_to_group ttg on ttg.tag_id = lts.tag_id
       group by ttg.group_id
    ),
    group_sections as (
      select sg.competency_group_id as group_id, count(*) as sections_count
        from section_group sg group by sg.competency_group_id
    )
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'competency_group_id', row.gid,
               'name', row.gname,
               'color', row.gcolor,
               'class_avg', row.class_avg,
               'sections_count', row.sections_count
             )
             order by coalesce(row.display_order, 1e6), coalesce(row.gname, 'Unassigned')
           ), '[]'::jsonb)
      into _per_group
      from (
        select cg.id as gid, cg.name as gname, cg.color as gcolor, cg.display_order,
               ga.class_avg,
               coalesce(gs.sections_count, 0) as sections_count
          from competency_group cg
          left join group_avg ga on ga.group_id = cg.id
          left join group_sections gs on gs.group_id = cg.id
         where cg.course_id = p_course_id
         union all
        select null::uuid as gid, 'Unassigned' as gname, null::text as gcolor,
               null::int as display_order,
               ga2.class_avg,
               coalesce(gs2.sections_count, 0) as sections_count
          from (select class_avg from group_avg where group_id is null) ga2
          full outer join (select sections_count from group_sections where group_id is null) gs2 on true
         where ga2.class_avg is not null or gs2.sections_count is not null
      ) row;

    -- At-risk students: overall_proficiency < 2.0 OR letter.R < 60.
    with per_student as (
      select e.id as eid,
             coalesce(s.preferred_name, s.first_name) || ' ' || coalesce(s.last_name, '') as student_name,
             fv_overall_proficiency(e.id, p_course_id) as op,
             case when _course.grading_system in ('letter','both')
                  then fv_course_letter_pipeline(e.id, p_course_id)
                  else null end as lp
        from enrollment e join student s on s.id = e.student_id
       where e.course_id = p_course_id and e.withdrawn_at is null
    )
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'enrollment_id', eid,
               'student_name', trim(student_name),
               'overall_proficiency', op,
               'letter', lp
             ) order by op nulls last, student_name
           ), '[]'::jsonb)
      into _at_risk
      from per_student
     where (op is not null and op < 2.0)
        or (lp is not null and (lp->>'R')::numeric < 60);

    -- Flagged count.
    select count(*) into _flagged
      from enrollment
     where course_id = p_course_id and withdrawn_at is null and is_flagged = true;

    return jsonb_build_object(
      'course', to_jsonb(_course),
      'class_avg_proficiency', _class_avg_p,
      'class_avg_percentage', _class_avg_pct,
      'proficiency_histogram', _histo_q,
      'letter_histogram', _histo_letter,
      'per_assessment_avg', _per_assessment,
      'per_competency_group_avg', _per_group,
      'at_risk', _at_risk,
      'flagged_count', _flagged
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_gradebook(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    course_row course%rowtype;
    students jsonb;
    assessments jsonb;
    categories jsonb;
    modules jsonb;
    cells jsonb;
    summaries jsonb;
begin
    select * into course_row from course where id = p_course_id;
    if not found then raise exception 'course not found or not owned'; end if;

    select jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student_id', s.id,
               'first_name', s.first_name,
               'last_name', s.last_name,
               'preferred_name', s.preferred_name,
               'pronouns', s.pronouns,
               'student_number', s.student_number,
               'email', s.email,
               'date_of_birth', s.date_of_birth,
               'designations', e.designations,
               'enrolled_at', e.enrolled_at,
               'roster_position', e.roster_position,
               'is_flagged', e.is_flagged
           ) order by e.roster_position, s.last_name, s.first_name)
      into students
      from enrollment e join student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is null;

    select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'title', a.title,
               'description', a.description,
               'category_id', a.category_id,
               'score_mode', a.score_mode,
               'max_points', a.max_points,
               'weight', a.weight,
               'evidence_type', a.evidence_type,
               'rubric_id', a.rubric_id,
               'module_id', a.module_id,
               'collab_mode', a.collab_mode,
               'collab_config', a.collab_config,
               'has_rubric', a.rubric_id is not null,
               'date_assigned', a.date_assigned,
               'due_date', a.due_date,
               'display_order', a.display_order,
               'core_competency_ids', to_jsonb(a.core_competency_ids),
               'created_at', a.created_at,
               'tag_ids', coalesce((
                   select jsonb_agg(at.tag_id order by t.display_order, t.label)
                     from assessment_tag at
                     join tag t on t.id = at.tag_id
                    where at.assessment_id = a.id
               ), '[]'::jsonb)
           ) order by a.display_order, a.created_at)
      into assessments
      from assessment a where a.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', cat.id, 'name', cat.name,
               'weight', cat.weight, 'display_order', cat.display_order, 'calc_mode', cat.calc_mode
           ) order by cat.display_order)
      into categories
      from category cat where cat.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'course_id', m.course_id,
               'name', m.name,
               'color', m.color,
               'display_order', m.display_order,
               'created_at', m.created_at,
               'updated_at', m.updated_at
           ) order by m.display_order)
      into modules
      from module m where m.course_id = p_course_id;

    with pairs as (
        select e.id as eid, a.id as aid,
               fv_assessment_overall(e.id, a.id) as ov
          from enrollment e cross join assessment a
         where e.course_id = p_course_id and e.withdrawn_at is null
           and a.course_id = p_course_id
    )
    select jsonb_object_agg(eid, cells_per_student)
      into cells
      from (
        select eid, jsonb_object_agg(
                       aid,
                       jsonb_build_object(
                           'kind', (ov).kind, 'value', (ov).value,
                           'score', (
                               select jsonb_build_object(
                                          'id', sc.id,
                                          'value', sc.value,
                                          'status', sc.status,
                                          'comment', sc.comment,
                                          'scored_at', sc.scored_at,
                                          'updated_at', sc.updated_at
                                      )
                                 from score sc
                                where sc.enrollment_id = p.eid
                                  and sc.assessment_id = p.aid
                           ),
                           'tag_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'tag_id', ts.tag_id,
                                          'value', ts.value, 'modifier', ts.modifier
                                      ) order by ts.tag_id)
                                 from tag_score ts
                                where ts.enrollment_id = p.eid
                                  and ts.assessment_id = p.aid
                           ), '[]'::jsonb),
                           'rubric_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'criterion_id', rs.criterion_id,
                                          'value', rs.value, 'modifier', rs.modifier
                                      ) order by rs.criterion_id)
                                 from rubric_score rs
                                where rs.enrollment_id = p.eid
                                  and rs.assessment_id = p.aid
                           ), '[]'::jsonb)
                       )
                   ) as cells_per_student
          from pairs p group by eid
      ) x;

    select jsonb_object_agg(
               e.id,
               jsonb_build_object(
                   'letter', case when course_row.grading_system in ('letter','both')
                       then fv_course_letter_pipeline(e.id, p_course_id) else null end,
                   'overall_proficiency', case when course_row.grading_system in ('proficiency','both')
                       then fv_overall_proficiency(e.id, p_course_id) else null end,
                   'counts', fv_status_counts(e.id, p_course_id)
               )
           )
      into summaries
      from enrollment e
     where e.course_id = p_course_id and e.withdrawn_at is null;

    return jsonb_build_object(
        'course', to_jsonb(course_row),
        'students', coalesce(students, '[]'::jsonb),
        'assessments', coalesce(assessments, '[]'::jsonb),
        'categories', coalesce(categories, '[]'::jsonb),
        'modules', coalesce(modules, '[]'::jsonb),
        'cells', coalesce(cells, '{}'::jsonb),
        'row_summaries', coalesce(summaries, '{}'::jsonb)
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_learning_map(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _course course%rowtype;
    _groups jsonb;
    _subjects jsonb;
begin
    select * into _course from course where id = p_course_id;
    if not found then
        raise exception 'course not found or not owned';
    end if;

    -- Competency groups (flat list; sections reference them by id).
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', cg.id, 'name', cg.name, 'color', cg.color,
             'display_order', cg.display_order,
             'counts_as_one', cg.counts_as_one
           ) order by cg.display_order, cg.name), '[]'::jsonb)
      into _groups
      from competency_group cg
     where cg.course_id = p_course_id;

    -- Per-tag class_avg: most-recent tag_score per (student, tag), averaged.
    -- Includes only enrollments that are still active (withdrawn_at is null).
    with
    active_enr as (
      select id from enrollment where course_id = p_course_id and withdrawn_at is null
    ),
    -- Most-recent tag_score per (enrollment, tag): dedup to the latest updated_at.
    latest_ts as (
      select distinct on (ts.enrollment_id, ts.tag_id)
             ts.enrollment_id, ts.tag_id, ts.value + ts.modifier / 3.0 as value
        from (select * from tag_score where value is not null) ts
        join active_enr e on e.id = ts.enrollment_id
       order by ts.enrollment_id, ts.tag_id, ts.updated_at desc
    ),
    tag_avg as (
      select tag_id, round(avg(value)::numeric, 2) as class_avg
        from latest_ts
       group by tag_id
    ),
    -- Per-tag coverage: how many course assessments target this tag.
    tag_cov as (
      select at.tag_id, count(distinct at.assessment_id) as coverage
        from assessment_tag at
        join assessment a on a.id = at.assessment_id
       where a.course_id = p_course_id
       group by at.tag_id
    ),
    -- Tags hydrated with avg + coverage.
    tags_hydrated as (
      select t.id, t.section_id, t.code, t.label, t.i_can_text, t.i_can_statements, t.source_text, t.bank_id, t.display_order,
             tag_avg.class_avg,
             coalesce(tag_cov.coverage, 0) as coverage_count
        from tag t
        join section s on s.id = t.section_id
        left join tag_avg on tag_avg.tag_id = t.id
        left join tag_cov on tag_cov.tag_id = t.id
       where s.course_id = p_course_id
    ),
    -- Group tags into their owning section.
    sections_with_tags as (
      select s.id as section_id, s.subject_id, s.name, s.display_order,
             s.competency_group_id,
             coalesce(jsonb_agg(
               jsonb_build_object(
                 'id', t.id, 'code', t.code, 'label', t.label,
                 'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,
                 'bank_id', t.bank_id,
                 'display_order', t.display_order,
                 'class_avg', t.class_avg,
                 'coverage_count', t.coverage_count
               ) order by t.display_order, t.label
             ) filter (where t.id is not null), '[]'::jsonb) as tags
        from section s
        left join tags_hydrated t on t.section_id = s.id
       where s.course_id = p_course_id and s.removed_at is null
       group by s.id, s.subject_id, s.name, s.display_order, s.competency_group_id
    ),
    subjects_with_sections as (
      select subj.id, subj.name, subj.display_order,
             coalesce(jsonb_agg(
               jsonb_build_object(
                 'id', sec.section_id,
                 'name', sec.name,
                 'display_order', sec.display_order,
                 'competency_group_id', sec.competency_group_id,
                 'tags', sec.tags
               ) order by sec.display_order, sec.name
             ) filter (where sec.section_id is not null), '[]'::jsonb) as sections
        from subject subj
        left join sections_with_tags sec on sec.subject_id = subj.id
       where subj.course_id = p_course_id
       group by subj.id, subj.name, subj.display_order
    )
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id', sws.id, 'name', sws.name,
               'display_order', sws.display_order,
               'sections', sws.sections
             ) order by sws.display_order, sws.name
           ), '[]'::jsonb)
      into _subjects
      from subjects_with_sections sws;

    return jsonb_build_object(
      'competency_groups', _groups,
      'subjects', _subjects
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_observations(p_course_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _filters jsonb := coalesce(p_filters, '{}'::jsonb);
    _page int := greatest(coalesce(p_page, 1), 1);
    _size int := least(greatest(coalesce(p_page_size, 50), 1), 200);
    _offset int := (_page - 1) * _size;
    _total bigint;
    _ids uuid[];
    _rows jsonb;
    _students_index jsonb;
    _tags_index jsonb;
    _ctags_index jsonb;
    _enr_filter uuid[];
    _sent_filter text[];
    _tag_filter uuid[];
    _ctag_filter uuid[];
    _asmt_filter uuid;
    _search text;
    _since timestamptz;
    _until timestamptz;
begin
    -- Unpack filters.
    if _filters ? 'enrollment_id' and nullif(_filters->>'enrollment_id','') is not null then
        _enr_filter := array[(_filters->>'enrollment_id')::uuid];
    end if;
    if _filters ? 'enrollment_ids' and jsonb_typeof(_filters->'enrollment_ids') = 'array' then
        select array_agg((v #>> '{}')::uuid) into _enr_filter
          from jsonb_array_elements(_filters->'enrollment_ids') v;
    end if;

    if _filters ? 'sentiment' and nullif(_filters->>'sentiment','') is not null then
        _sent_filter := array[_filters->>'sentiment'];
    end if;
    if _filters ? 'sentiments' and jsonb_typeof(_filters->'sentiments') = 'array' then
        select array_agg(v #>> '{}') into _sent_filter
          from jsonb_array_elements(_filters->'sentiments') v;
    end if;

    if _filters ? 'tag_ids' and jsonb_typeof(_filters->'tag_ids') = 'array' then
        select array_agg((v #>> '{}')::uuid) into _tag_filter
          from jsonb_array_elements(_filters->'tag_ids') v;
    end if;
    if _filters ? 'custom_tag_ids' and jsonb_typeof(_filters->'custom_tag_ids') = 'array' then
        select array_agg((v #>> '{}')::uuid) into _ctag_filter
          from jsonb_array_elements(_filters->'custom_tag_ids') v;
    end if;

    if _filters ? 'assessment_id' and nullif(_filters->>'assessment_id','') is not null then
        _asmt_filter := (_filters->>'assessment_id')::uuid;
    end if;
    _search := nullif(_filters->>'search', '');
    _since  := nullif(_filters->>'since', '')::timestamptz;
    _until  := nullif(_filters->>'until', '')::timestamptz;

    -- Find matching observation IDs.
    with
    base as (
      select o.id, o.created_at
        from observation o
       where o.course_id = p_course_id
         and (_sent_filter is null or o.sentiment = any(_sent_filter))
         and (_asmt_filter is null or o.assessment_id = _asmt_filter)
         and (_search     is null or o.body ilike '%' || _search || '%')
         and (_since      is null or o.created_at >= _since)
         and (_until      is null or o.created_at <= _until)
    ),
    filtered as (
      select b.id, b.created_at
        from base b
       where (_enr_filter is null or exists (
               select 1 from observation_student os
                where os.observation_id = b.id and os.enrollment_id = any(_enr_filter)))
         and (_tag_filter is null or exists (
               select 1 from observation_tag ot
                where ot.observation_id = b.id and ot.tag_id = any(_tag_filter)))
         and (_ctag_filter is null or exists (
               select 1 from observation_custom_tag oct
                where oct.observation_id = b.id and oct.custom_tag_id = any(_ctag_filter)))
    ),
    paged as (
      select id from filtered
       order by created_at desc
       offset _offset limit _size
    )
    select count(*) from filtered into _total;

    select array_agg(id) into _ids from (
      select id from observation o
       where o.course_id = p_course_id
         and (_sent_filter is null or o.sentiment = any(_sent_filter))
         and (_asmt_filter is null or o.assessment_id = _asmt_filter)
         and (_search     is null or o.body ilike '%' || _search || '%')
         and (_since      is null or o.created_at >= _since)
         and (_until      is null or o.created_at <= _until)
         and (_enr_filter is null or exists (
               select 1 from observation_student os
                where os.observation_id = o.id and os.enrollment_id = any(_enr_filter)))
         and (_tag_filter is null or exists (
               select 1 from observation_tag ot
                where ot.observation_id = o.id and ot.tag_id = any(_tag_filter)))
         and (_ctag_filter is null or exists (
               select 1 from observation_custom_tag oct
                where oct.observation_id = o.id and oct.custom_tag_id = any(_ctag_filter)))
       order by o.created_at desc
       offset _offset limit _size
    ) x;

    -- Hydrate rows.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id, 'body', o.body,
             'sentiment', o.sentiment, 'context_type', o.context_type,
             'assessment_id', o.assessment_id,
             'created_at', o.created_at, 'updated_at', o.updated_at,
             'dims', to_jsonb(coalesce(o.dims, '{}'::text[])),
             'level', o.level,
             'enrollment_ids', coalesce((
                select jsonb_agg(os.enrollment_id)
                  from observation_student os where os.observation_id = o.id
             ), '[]'::jsonb),
             'tag_ids', coalesce((
                select jsonb_agg(ot.tag_id)
                  from observation_tag ot where ot.observation_id = o.id
             ), '[]'::jsonb),
             'custom_tag_ids', coalesce((
                select jsonb_agg(oct.custom_tag_id)
                  from observation_custom_tag oct where oct.observation_id = o.id
             ), '[]'::jsonb)
           ) order by o.created_at desc), '[]'::jsonb)
      into _rows
      from observation o
     where o.id = any(coalesce(_ids, '{}'::uuid[]));

    -- Students index: limited to the enrollments referenced by the page.
    select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
             'first_name', s.first_name,
             'last_name',  s.last_name,
             'preferred_name', s.preferred_name,
             'roster_position', e.roster_position
           )), '{}'::jsonb)
      into _students_index
      from enrollment e
      join student s on s.id = e.student_id
     where e.id in (
       select os.enrollment_id from observation_student os
        where os.observation_id = any(coalesce(_ids, '{}'::uuid[]))
     );

    -- Tags index: all tags referenced by the page.
    select coalesce(jsonb_object_agg(t.id, jsonb_build_object(
             'code', t.code, 'label', t.label, 'section_id', t.section_id
           )), '{}'::jsonb)
      into _tags_index
      from tag t
     where t.id in (
       select ot.tag_id from observation_tag ot
        where ot.observation_id = any(coalesce(_ids, '{}'::uuid[]))
     );

    select coalesce(jsonb_object_agg(ct.id, jsonb_build_object('label', ct.label)), '{}'::jsonb)
      into _ctags_index
      from custom_tag ct
     where ct.id in (
       select oct.custom_tag_id from observation_custom_tag oct
        where oct.observation_id = any(coalesce(_ids, '{}'::uuid[]))
     );

    return jsonb_build_object(
      'observations',  _rows,
      'total',         _total,
      'page',          _page,
      'page_size',     _size,
      'has_more',      _offset + _size < _total,
      'students_index',    _students_index,
      'tags_index',        _tags_index,
      'custom_tags_index', _ctags_index
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_report(p_enrollment_id uuid, p_term integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _enr enrollment%rowtype;
    _stu student%rowtype;
    _course course%rowtype;
    _rc report_config%rowtype;
    _tr term_rating%rowtype;
    _bc jsonb;
    _blocks jsonb := '[]'::jsonb;
    _enabled bool;
    _val jsonb;
    _attendance_counts jsonb;
    _counts jsonb;
    _overall numeric;
    _letter jsonb;
begin
    select * into _enr from enrollment where id = p_enrollment_id;
    if not found then
        raise exception 'enrollment not found or not owned';
    end if;
    select * into _stu from student where id = _enr.student_id;
    select * into _course from course where id = _enr.course_id;
    select * into _rc from report_config where course_id = _enr.course_id;

    -- Pick the TermRating: explicit term wins; else most-recently-updated.
    if p_term is not null then
        select * into _tr from term_rating
         where enrollment_id = p_enrollment_id and term = p_term;
    else
        select * into _tr from term_rating
         where enrollment_id = p_enrollment_id
         order by updated_at desc nulls last, term desc
         limit 1;
    end if;

    _bc := coalesce(_rc.blocks_config, '{}'::jsonb);
    _counts := fv_status_counts(p_enrollment_id, _enr.course_id);
    if _course.grading_system in ('proficiency','both') then
        _overall := fv_overall_proficiency(p_enrollment_id, _enr.course_id);
    end if;
    if _course.grading_system in ('letter','both') then
        _letter := fv_course_letter_pipeline(p_enrollment_id, _enr.course_id);
    end if;

    -- Helper: a block is "enabled" if the key is true OR missing+default.
    -- Default policy: header + narrative + grades + competencies on by default;
    -- the rest only when explicitly true.

    -- Header
    _enabled := coalesce((_bc->>'header')::boolean, true);
    if _enabled then
        _val := jsonb_build_object(
          'student_name',
            trim(coalesce(_stu.preferred_name, _stu.first_name, '') || ' ' || coalesce(_stu.last_name, '')),
          'course_name',       _course.name,
          'grade_level',       _course.grade_level,
          'term',              coalesce(_tr.term, p_term),
          'teacher_name',      (select display_name from teacher where id = _course.teacher_id),
          'report_generated_at', now()
        );
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','header','data',_val));
    end if;

    -- Narrative
    _enabled := coalesce((_bc->>'narrative')::boolean, true);
    if _enabled and _tr.id is not null then
        _val := jsonb_build_object(
          'narrative_html', _tr.narrative_html,
          'work_habits_rating', _tr.work_habits_rating,
          'participation_rating', _tr.participation_rating,
          'social_traits', _tr.social_traits
        );
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','narrative','data',_val));
    end if;

    -- Grades
    _enabled := coalesce((_bc->>'grades')::boolean, true);
    if _enabled then
        with enr_asmts as (
          select a.id, a.title, a.score_mode, a.max_points, a.date_assigned,
                 a.display_order
            from assessment a where a.course_id = _enr.course_id
           order by a.display_order, a.date_assigned
        )
        select jsonb_build_object(
          'overall_proficiency', _overall,
          'letter',              _letter,
          'counts',              _counts,
          'assessments', coalesce(jsonb_agg(jsonb_build_object(
            'assessment_id', ea.id,
            'title',         ea.title,
            'date_assigned', ea.date_assigned,
            'score_mode',    ea.score_mode,
            'max_points',    ea.max_points,
            'overall',       to_jsonb(fv_assessment_overall(p_enrollment_id, ea.id))
          )), '[]'::jsonb)
        )
        into _val
        from enr_asmts ea;
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','grades','data',_val));
    end if;

    -- Competencies (per-section proficiency + suggested dim rounding)
    _enabled := coalesce((_bc->>'competencies')::boolean, true);
    if _enabled then
        with per_sec as (
          select s.id as section_id, s.name, s.display_order,
                 s.subject_id,
                 fv_section_proficiency(p_enrollment_id, s.id) as sp,
                 (select rating from term_rating_dimension d
                    where d.term_rating_id = _tr.id and d.section_id = s.id) as dim
            from section s where s.course_id = _enr.course_id
        )
        select jsonb_build_object(
          'sections', coalesce(jsonb_agg(jsonb_build_object(
            'section_id',       section_id,
            'name',             name,
            'proficiency',      sp,
            'suggested_rating', case when sp is null then null else round(sp)::int end,
            'dim_rating',       dim
          ) order by display_order, name), '[]'::jsonb)
        ) into _val from per_sec;
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','competencies','data',_val));
    end if;

    -- Goals (teacher-authored, per section)
    _enabled := coalesce((_bc->>'goals')::boolean, false);
    if _enabled then
        select jsonb_build_object(
          'goals', coalesce(jsonb_agg(jsonb_build_object(
            'section_id', g.section_id,
            'section_name', s.name,
            'body',       g.body
          )), '[]'::jsonb)
        ) into _val
        from goal g join section s on s.id = g.section_id
       where g.enrollment_id = p_enrollment_id;
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','goals','data',_val));
    end if;

    -- Reflections (student-authored)
    _enabled := coalesce((_bc->>'reflections')::boolean, false);
    if _enabled then
        select jsonb_build_object(
          'reflections', coalesce(jsonb_agg(jsonb_build_object(
            'section_id',   r.section_id,
            'section_name', s.name,
            'body',         r.body,
            'confidence',   r.confidence
          )), '[]'::jsonb)
        ) into _val
        from reflection r join section s on s.id = r.section_id
       where r.enrollment_id = p_enrollment_id;
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','reflections','data',_val));
    end if;

    -- Attendance summary counts
    _enabled := coalesce((_bc->>'attendance')::boolean, false);
    if _enabled then
        select jsonb_object_agg(status, cnt) into _attendance_counts
          from (select status, count(*) as cnt
                  from attendance where enrollment_id = p_enrollment_id
                 group by status) x;
        _val := jsonb_build_object('counts', coalesce(_attendance_counts, '{}'::jsonb));
        _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','attendance','data',_val));
    end if;

    -- Strengths / Growth (from TermRating tag memberships)
    if _tr.id is not null then
        _enabled := coalesce((_bc->>'strengths')::boolean, false);
        if _enabled then
            select jsonb_build_object('tags', coalesce(jsonb_agg(jsonb_build_object(
              'tag_id', t.id, 'label', t.label, 'code', t.code, 'section_id', t.section_id
            )), '[]'::jsonb))
            into _val
            from term_rating_strength trs join tag t on t.id = trs.tag_id
           where trs.term_rating_id = _tr.id;
            _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','strengths','data',_val));
        end if;

        _enabled := coalesce((_bc->>'growth')::boolean, false);
        if _enabled then
            select jsonb_build_object('tags', coalesce(jsonb_agg(jsonb_build_object(
              'tag_id', t.id, 'label', t.label, 'code', t.code, 'section_id', t.section_id
            )), '[]'::jsonb))
            into _val
            from term_rating_growth_area trg join tag t on t.id = trg.tag_id
           where trg.term_rating_id = _tr.id;
            _blocks := _blocks || jsonb_build_array(jsonb_build_object('type','growth','data',_val));
        end if;
    end if;

    return jsonb_build_object(
      'enrollment_id', p_enrollment_id,
      'course_id',     _enr.course_id,
      'preset',        _rc.preset,
      'blocks_config', _bc,
      'term',          coalesce(_tr.term, p_term),
      'blocks',        _blocks
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_report_issue(p_issue_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _issue report_issue%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    select * into _issue from report_issue where id = p_issue_id;
    if not found or not fv_owns_course(_issue.course_id) then
        raise exception 'issue not found' using errcode = 'P0002';
    end if;

    return to_jsonb(_issue) || jsonb_build_object(
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', s.enrollment_id,
                       'sheets', s.sheets,
                       'hash', s.hash,
                       'html', s.html
                   ) order by e.roster_position, e.id)
              from report_issue_student s
              left join enrollment e on e.id = s.enrollment_id
             where s.issue_id = _issue.id
        ), '[]'::jsonb)
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_student_profile(p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    enr         enrollment%rowtype;
    stu         student%rowtype;
    course_row  course%rowtype;
    _tree       jsonb;
begin
    select * into enr from enrollment where id = p_enrollment_id;
    if not found then
        raise exception 'enrollment not found or not owned';
    end if;
    select * into stu from student where id = enr.student_id;
    select * into course_row from course where id = enr.course_id;

    -- Compose the competency tree: subjects → sections → tags, each tag
    -- carrying the student's latest tag_score value.
    with
    groups as (
      select jsonb_agg(jsonb_build_object(
               'id', cg.id, 'name', cg.name, 'color', cg.color,
               'display_order', cg.display_order
             ) order by cg.display_order, cg.name) as groups_jsonb
        from competency_group cg where cg.course_id = enr.course_id
    ),
    latest_ts as (
      select distinct on (ts.tag_id)
             ts.tag_id, ts.value + ts.modifier / 3.0 as value
        from (select * from tag_score where value is not null) ts
       where ts.enrollment_id = p_enrollment_id
       order by ts.tag_id, ts.updated_at desc
    ),
    tag_rows as (
      select t.id, t.section_id, t.code, t.label, t.i_can_text, t.display_order,
             lts.value as latest_value,
             (select count(distinct at.assessment_id)
                from assessment_tag at
                join assessment a on a.id = at.assessment_id
               where at.tag_id = t.id and a.course_id = enr.course_id) as coverage_count
        from tag t
        join section s on s.id = t.section_id
        left join latest_ts lts on lts.tag_id = t.id
       where s.course_id = enr.course_id
    ),
    sections_with_tags as (
      select s.id as section_id, s.subject_id, s.name, s.display_order,
             s.competency_group_id,
             fv_section_proficiency(p_enrollment_id, s.id) as proficiency,
             (select to_jsonb(o.*) from section_override o
               where o.enrollment_id = p_enrollment_id and o.section_id = s.id) as override,
             coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'code', t.code, 'label', t.label,
               'i_can_text', t.i_can_text,
               'display_order', t.display_order,
               'latest_value', t.latest_value,
               'coverage_count', t.coverage_count
             ) order by t.display_order, t.label) filter (where t.id is not null), '[]'::jsonb) as tags
        from section s
        left join tag_rows t on t.section_id = s.id
       where s.course_id = enr.course_id and s.removed_at is null
       group by s.id, s.subject_id, s.name, s.display_order, s.competency_group_id
    ),
    subjects_with_sections as (
      select subj.id, subj.name, subj.display_order,
             coalesce(jsonb_agg(jsonb_build_object(
               'id', swt.section_id,
               'name', swt.name,
               'display_order', swt.display_order,
               'competency_group_id', swt.competency_group_id,
               'proficiency', swt.proficiency,
               'override',    swt.override,
               'tags',        swt.tags
             ) order by swt.display_order, swt.name) filter (where swt.section_id is not null), '[]'::jsonb) as sections
        from subject subj
        left join sections_with_tags swt on swt.subject_id = subj.id
       where subj.course_id = enr.course_id
       group by subj.id, subj.name, subj.display_order
    )
    select jsonb_build_object(
      'competency_groups', coalesce((select groups_jsonb from groups), '[]'::jsonb),
      'subjects', coalesce(jsonb_agg(jsonb_build_object(
         'id', sws.id, 'name', sws.name,
         'display_order', sws.display_order,
         'sections', sws.sections
      ) order by sws.display_order, sws.name), '[]'::jsonb)
    )
    into _tree
    from subjects_with_sections sws;

    return jsonb_build_object(
        'student', to_jsonb(stu),
        'enrollment', to_jsonb(enr),
        'course', to_jsonb(course_row),
        'overall_proficiency',
            case when course_row.grading_system in ('proficiency','both')
                 then fv_overall_proficiency(p_enrollment_id, enr.course_id)
                 else null end,
        'letter',
            case when course_row.grading_system in ('letter','both')
                 then fv_course_letter_pipeline(p_enrollment_id, enr.course_id)
                 else null end,
        'counts', fv_status_counts(p_enrollment_id, enr.course_id),
        'notes', (
            select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
              from note n where n.enrollment_id = p_enrollment_id
        ),
        'goals', (
            select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
              from goal g where g.enrollment_id = p_enrollment_id
        ),
        'reflections', (
            select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
              from reflection r where r.enrollment_id = p_enrollment_id
        ),
        'competency_tree', _tree
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_term_rating(p_enrollment_id uuid, p_term integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    _enr enrollment%rowtype;
    _course course%rowtype;
    _stu student%rowtype;
    _tr term_rating%rowtype;
    _tr_id uuid;
    _dims jsonb; _strengths jsonb; _growths jsonb;
    _mention_asmt jsonb; _mention_obs jsonb;
    _pick_sections jsonb; _pick_tags jsonb; _pick_assessments jsonb; _pick_observations jsonb;
    _per_section jsonb; _suggested jsonb;
    _overall numeric; _letter jsonb; _counts jsonb;
begin
    if p_term < 1 or p_term > 6 then
        raise exception 'term must be 1..6' using errcode = '22023';
    end if;

    select * into _enr from enrollment where id = p_enrollment_id;
    if not found then
        raise exception 'enrollment not found or not owned';
    end if;
    select * into _course from course where id = _enr.course_id;
    select * into _stu from student where id = _enr.student_id;

    select * into _tr from term_rating where enrollment_id = p_enrollment_id and term = p_term;
    _tr_id := _tr.id;

    -- Join memberships — empty arrays when no row yet.
    if _tr_id is not null then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'section_id', d.section_id, 'rating', d.rating
               )), '[]'::jsonb)
          into _dims
          from term_rating_dimension d where d.term_rating_id = _tr_id;

        select coalesce(jsonb_agg(tag_id), '[]'::jsonb) into _strengths
          from term_rating_strength where term_rating_id = _tr_id;
        select coalesce(jsonb_agg(tag_id), '[]'::jsonb) into _growths
          from term_rating_growth_area where term_rating_id = _tr_id;
        select coalesce(jsonb_agg(assessment_id), '[]'::jsonb) into _mention_asmt
          from term_rating_assessment where term_rating_id = _tr_id;
        select coalesce(jsonb_agg(observation_id), '[]'::jsonb) into _mention_obs
          from term_rating_observation where term_rating_id = _tr_id;
    else
        _dims := '[]'::jsonb;
        _strengths := '[]'::jsonb;
        _growths := '[]'::jsonb;
        _mention_asmt := '[]'::jsonb;
        _mention_obs := '[]'::jsonb;
    end if;

    -- Pickers: course-scoped lists teachers choose from.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'subject_id', s.subject_id,
             'name', s.name, 'display_order', s.display_order,
             'competency_group_id', s.competency_group_id
           ) order by s.display_order, s.name), '[]'::jsonb)
      into _pick_sections
      from section s where s.course_id = _enr.course_id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'section_id', t.section_id,
             'code', t.code, 'label', t.label,
             'i_can_text', t.i_can_text, 'display_order', t.display_order
           ) order by t.display_order, t.label), '[]'::jsonb)
      into _pick_tags
      from tag t
      join section s on s.id = t.section_id
     where s.course_id = _enr.course_id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'title', a.title,
             'date_assigned', a.date_assigned,
             'score_mode', a.score_mode,
             'display_order', a.display_order
           ) order by a.display_order, a.date_assigned nulls last), '[]'::jsonb)
      into _pick_assessments
      from assessment a where a.course_id = _enr.course_id;

    -- Observations picker: restrict to observations that mention THIS enrollment.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id, 'body', o.body,
             'sentiment', o.sentiment,
             'context_type', o.context_type,
             'created_at', o.created_at
           ) order by o.created_at desc), '[]'::jsonb)
      into _pick_observations
      from observation o
      join observation_student os on os.observation_id = o.id
     where os.enrollment_id = p_enrollment_id;

    -- Context: overall + per-section proficiency + status counts.
    if _course.grading_system in ('proficiency','both') then
        _overall := fv_overall_proficiency(p_enrollment_id, _enr.course_id);
    end if;
    if _course.grading_system in ('letter','both') then
        _letter := fv_course_letter_pipeline(p_enrollment_id, _enr.course_id);
    end if;
    _counts := fv_status_counts(p_enrollment_id, _enr.course_id);

    with per_sec as (
      select s.id as section_id,
             fv_section_proficiency(p_enrollment_id, s.id) as sp
        from section s
       where s.course_id = _enr.course_id
    )
    select
      coalesce(jsonb_object_agg(section_id, sp), '{}'::jsonb),
      coalesce(jsonb_object_agg(section_id,
                case when sp is null then null else round(sp)::int end), '{}'::jsonb)
      into _per_section, _suggested
      from per_sec;

    return jsonb_build_object(
      'enrollment',  to_jsonb(_enr),
      'student',     to_jsonb(_stu),
      'course',      to_jsonb(_course),
      'term',        p_term,
      'term_rating', case when _tr_id is null then null else to_jsonb(_tr) end,
      'dimensions',          _dims,
      'strength_tag_ids',    _strengths,
      'growth_tag_ids',      _growths,
      'mention_assessment_ids',  _mention_asmt,
      'mention_observation_ids', _mention_obs,
      'pickers', jsonb_build_object(
        'sections',     _pick_sections,
        'tags',         _pick_tags,
        'assessments',  _pick_assessments,
        'observations', _pick_observations
      ),
      'context', jsonb_build_object(
        'overall_proficiency', _overall,
        'letter',              _letter,
        'counts',              _counts,
        'per_section_proficiency', _per_section
      ),
      'suggested_dim_defaults', _suggested
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_withdrawn_student_records(p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  _withdrawn_at timestamptz;
begin
  select e.withdrawn_at into _withdrawn_at from public.enrollment e where e.id = p_enrollment_id;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'P0002';
  end if;
  if _withdrawn_at is null then
    raise exception 'enrollment % is not withdrawn', p_enrollment_id using errcode = '22023';
  end if;

  return jsonb_build_object(
    'scores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assessment', a.title, 'date', coalesce(a.due_date, a.date_assigned),
               'score_mode', a.score_mode, 'max_points', a.max_points,
               'value', sc.value, 'modifier', sc.modifier, 'status', sc.status, 'comment', sc.comment)
             order by coalesce(a.due_date, a.date_assigned), a.title)
        from public.score sc
        join public.assessment a on a.id = sc.assessment_id
       where sc.enrollment_id = p_enrollment_id), '[]'::jsonb),
    'tag_scores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assessment', a.title, 'date', coalesce(a.due_date, a.date_assigned),
               'code', t.code, 'competency', t.label,
               'value', ts.value, 'modifier', ts.modifier)
             order by coalesce(a.due_date, a.date_assigned), a.title, t.label)
        from public.tag_score ts
        join public.assessment a on a.id = ts.assessment_id
        join public.tag t on t.id = ts.tag_id
       where ts.enrollment_id = p_enrollment_id), '[]'::jsonb),
    'rubric_scores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assessment', a.title, 'date', coalesce(a.due_date, a.date_assigned),
               'criterion', c.name, 'value', rs.value, 'modifier', rs.modifier, 'comment', rs.comment, 'beyond', rs.beyond)
             order by coalesce(a.due_date, a.date_assigned), a.title, c.display_order)
        from public.rubric_score rs
        join public.assessment a on a.id = rs.assessment_id
        join public.criterion c on c.id = rs.criterion_id
       where rs.enrollment_id = p_enrollment_id), '[]'::jsonb),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', o.created_at, 'sentiment', o.sentiment, 'context', o.context_type, 'body', o.body)
             order by o.created_at)
        from public.observation o
        join public.observation_student os on os.observation_id = o.id
       where os.enrollment_id = p_enrollment_id), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE PROCEDURE public.grade_return_repair_nightly()
 LANGUAGE plpgsql
AS $procedure$
declare
    _course uuid;
    _failed integer := 0;
    _state  text;
    _msg    text;
begin
    delete from public.grade_return_repair_log where at < now() - interval '90 days';
    commit;
    for _course in select c.id from public.course c order by c.id loop
        begin
            perform public._grade_return_repair_class(_course);
        exception when others then
            get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            insert into public.grade_return_repair_log (course_id, sqlstate, message) values (_course, _state, _msg);
            _failed := _failed + 1;
        end;
        commit;
    end loop;
    begin
        perform public._grade_return_repair_lost();
    exception when others then
        get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
        insert into public.grade_return_repair_log (course_id, sqlstate, message) values (null, _state, _msg);
        _failed := _failed + 1;
    end;
    commit;
    -- Everything above is committed. This only marks the run as failed, for
    -- whoever called it and for pg_cron's record of the job.
    if _failed > 0 then
        raise exception 'grade_return_repair_nightly: % part(s) of this run failed and were skipped; the rest is done. See public.grade_return_repair_log.', _failed;
    end if;
end;
$procedure$;

CREATE OR REPLACE FUNCTION public.import_json_restore(p_payload jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _row jsonb;
    _id uuid;
    _sid uuid;
    _students jsonb := '{}'::jsonb;  -- payload student id → student id used
    _used jsonb := '{}'::jsonb;      -- existing student ids already matched
    _n_courses int := 0; _n_rc int := 0; _n_cat int := 0;
    _n_subj int := 0; _n_cg int := 0; _n_sect int := 0; _n_tag int := 0;
    _n_mod int := 0; _n_rub int := 0; _n_crit int := 0; _n_ct int := 0; _n_chk int := 0;
    _n_stu int := 0; _n_matched int := 0; _n_enr int := 0; _n_asm int := 0; _n_at int := 0;
    _n_scr int := 0; _n_rs int := 0; _n_ts int := 0; _n_rcs int := 0;
    _n_note int := 0; _n_goal int := 0; _n_refl int := 0; _n_ovr int := 0;
    _n_ctag int := 0; _n_obs int := 0; _n_tr int := 0;
    _cached jsonb; _result jsonb;
    _bad text;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'import_json_restore');
    if _cached is not null then return _cached; end if;
    perform set_config('fv.restoring', 'on', true);

    if p_payload ? 'courses' then
      for _row in select * from jsonb_array_elements(p_payload->'courses') loop
        insert into course (id, teacher_id, name, grade_level, description, color,
                            is_archived, grading_system, calc_method, decay_weight,
                            timezone, late_work_policy, grading_scale, category_weights,
                            round_percent, reporting_terms, block, recent_score_limit,
                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)
        values ((_row->>'id')::uuid, _uid,
                coalesce(_row->>'name','Untitled'),
                _row->>'grade_level', _row->>'description', _row->>'color',
                coalesce((_row->>'is_archived')::boolean, false),
                coalesce(_row->>'grading_system','proficiency'),
                coalesce(_row->>'calc_method','average'),
                nullif(_row->>'decay_weight','')::numeric,
                coalesce(_row->>'timezone','America/Vancouver'),
                _row->>'late_work_policy',
                case when jsonb_typeof(_row->'grading_scale') = 'object' then _row->'grading_scale' end,
                case when jsonb_typeof(_row->'category_weights') = 'object' then _row->'category_weights' end,
                nullif(_row->>'round_percent','')::boolean,
                case when jsonb_typeof(_row->'reporting_terms') in ('object','array') then _row->'reporting_terms' end,
                nullif(_row->>'block',''),
                nullif(_row->>'recent_score_limit','')::smallint,
                coalesce(_row->>'level_order','desc'),
                case when jsonb_typeof(_row->'curriculum_tags') = 'array'
                     then array(select jsonb_array_elements_text(_row->'curriculum_tags')) end,
                coalesce((_row->>'folders_count_as_one')::boolean, true),
                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))
        on conflict (id) do update set
          name=excluded.name, grade_level=excluded.grade_level,
          description=excluded.description, color=excluded.color,
          is_archived=excluded.is_archived, grading_system=excluded.grading_system,
          calc_method=excluded.calc_method, decay_weight=excluded.decay_weight,
          timezone=excluded.timezone, late_work_policy=excluded.late_work_policy,
          grading_scale=excluded.grading_scale, category_weights=excluded.category_weights,
          round_percent=excluded.round_percent, reporting_terms=excluded.reporting_terms,
          block=excluded.block, recent_score_limit=excluded.recent_score_limit,
          level_order=excluded.level_order, curriculum_tags=excluded.curriculum_tags,
          folders_count_as_one=excluded.folders_count_as_one,
          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,
          updated_at=now();
        _n_courses := _n_courses + 1;
      end loop;
    end if;

    if p_payload ? 'report_configs' then
      for _row in select * from jsonb_array_elements(p_payload->'report_configs') loop
        insert into report_config (course_id, preset, blocks_config)
        values ((_row->>'course_id')::uuid,
                coalesce(_row->>'preset','standard'),
                _row->'blocks_config')
        on conflict (course_id) do update set
          preset=excluded.preset, blocks_config=excluded.blocks_config, updated_at=now();
        _n_rc := _n_rc + 1;
      end loop;
    end if;

    if p_payload ? 'categories' then
      for _row in select * from jsonb_array_elements(p_payload->'categories') loop
        insert into category (id, course_id, name, weight, display_order, calc_mode)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'weight')::numeric, 0),
                coalesce((_row->>'display_order')::int, 0),
                coalesce(_row->>'calc_mode','points'))
        on conflict (id) do update set
          name=excluded.name, weight=excluded.weight,
          display_order=excluded.display_order, calc_mode=excluded.calc_mode, updated_at=now();
        _n_cat := _n_cat + 1;
      end loop;
    end if;

    if p_payload ? 'subjects' then
      for _row in select * from jsonb_array_elements(p_payload->'subjects') loop
        insert into subject (id, course_id, name, display_order, color)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), coalesce((_row->>'display_order')::int, 0),
                _row->>'color')
        on conflict (id) do update set name=excluded.name, display_order=excluded.display_order,
          color=excluded.color, updated_at=now();
        _n_subj := _n_subj + 1;
      end loop;
    end if;

    if p_payload ? 'competency_groups' then
      for _row in select * from jsonb_array_elements(p_payload->'competency_groups') loop
        insert into competency_group (id, course_id, name, color, display_order, counts_as_one)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0),
                coalesce((_row->>'counts_as_one')::boolean, true))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, counts_as_one=excluded.counts_as_one, updated_at=now();
        _n_cg := _n_cg + 1;
      end loop;
    end if;

    if p_payload ? 'sections' then
      for _row in select * from jsonb_array_elements(p_payload->'sections') loop
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order, color)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                (_row->>'subject_id')::uuid,
                nullif(_row->>'competency_group_id','')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'display_order')::int, 0),
                _row->>'color')
        on conflict (id) do update set
          subject_id=excluded.subject_id, competency_group_id=excluded.competency_group_id,
          name=excluded.name, display_order=excluded.display_order, color=excluded.color,
          updated_at=now();
        _n_sect := _n_sect + 1;
      end loop;
    end if;

    if p_payload ? 'tags' then
      for _row in select * from jsonb_array_elements(p_payload->'tags') loop
        insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values ((_row->>'id')::uuid, (_row->>'section_id')::uuid,
                _row->>'code', coalesce(_row->>'label',''), _row->>'i_can_text',
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'i_can_statements') = 'array'
                         then _row->'i_can_statements' else '[]'::jsonb end)), '{}'),
                _row->>'source_text', _row->>'bank_id',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          code=excluded.code, label=excluded.label, i_can_text=excluded.i_can_text,
          i_can_statements=case when _row ? 'i_can_statements' then excluded.i_can_statements else tag.i_can_statements end,
          source_text=case when _row ? 'source_text' then excluded.source_text else tag.source_text end,
          bank_id=case when _row ? 'bank_id' then excluded.bank_id else tag.bank_id end,
          display_order=excluded.display_order, updated_at=now();
        _n_tag := _n_tag + 1;
      end loop;
    end if;

    if p_payload ? 'modules' then
      for _row in select * from jsonb_array_elements(p_payload->'modules') loop
        insert into module (id, course_id, name, color, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, updated_at=now();
        _n_mod := _n_mod + 1;
      end loop;
    end if;

    if p_payload ? 'rubrics' then
      for _row in select * from jsonb_array_elements(p_payload->'rubrics') loop
        insert into rubric (id, course_id, name, style)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid, coalesce(_row->>'name',''),
                coalesce(_row->>'style','standard'))
        on conflict (id) do update set name=excluded.name, style=excluded.style, updated_at=now();
        _n_rub := _n_rub + 1;
      end loop;
    end if;

    if p_payload ? 'criteria' then
      for _row in select * from jsonb_array_elements(p_payload->'criteria') loop
        insert into criterion (id, rubric_id, name,
          level_4_descriptor, level_3_descriptor, level_2_descriptor, level_1_descriptor,
          level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order)
        values ((_row->>'id')::uuid, (_row->>'rubric_id')::uuid,
                coalesce(_row->>'name',''),
                _row->>'level_4_descriptor', _row->>'level_3_descriptor',
                _row->>'level_2_descriptor', _row->>'level_1_descriptor',
                coalesce((_row->>'level_4_value')::numeric, 4),
                coalesce((_row->>'level_3_value')::numeric, 3),
                coalesce((_row->>'level_2_value')::numeric, 2),
                coalesce((_row->>'level_1_value')::numeric, 1),
                coalesce((_row->>'weight')::numeric, 1.0),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          name=excluded.name,
          level_4_descriptor=excluded.level_4_descriptor, level_3_descriptor=excluded.level_3_descriptor,
          level_2_descriptor=excluded.level_2_descriptor, level_1_descriptor=excluded.level_1_descriptor,
          level_4_value=excluded.level_4_value, level_3_value=excluded.level_3_value,
          level_2_value=excluded.level_2_value, level_1_value=excluded.level_1_value,
          weight=excluded.weight, display_order=excluded.display_order, updated_at=now();
        _n_crit := _n_crit + 1;
      end loop;
    end if;

    if p_payload ? 'criterion_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'criterion_tags') loop
        insert into criterion_tag (criterion_id, tag_id)
        values ((_row->>'criterion_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    -- Competencies a whole rubric scores.
    if p_payload ? 'rubric_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'rubric_tags') loop
        insert into rubric_tag (rubric_id, tag_id)
        values ((_row->>'rubric_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    -- An Advanced Rubric's checkboxes.
    if p_payload ? 'criterion_checks' then
      for _row in select * from jsonb_array_elements(p_payload->'criterion_checks') loop
        insert into criterion_check (id, criterion_id, level, label, display_order)
        values ((_row->>'id')::uuid, (_row->>'criterion_id')::uuid,
                (_row->>'level')::smallint, coalesce(_row->>'label',''),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set level=excluded.level, label=excluded.label,
          display_order=excluded.display_order, updated_at=now();
        _n_chk := _n_chk + 1;
      end loop;
    end if;

    -- Students: one of the teacher's students with the same student number,
    -- else the backup's own student record, is used instead of a new one.
    -- RLS shows only the teacher's own students, so another teacher's
    -- backup always makes new records.
    if p_payload ? 'students' then
      for _row in select * from jsonb_array_elements(p_payload->'students') loop
        _sid := null;
        if nullif(btrim(_row->>'student_number'),'') is not null then
          select s.id into _sid from student s
           where s.teacher_id = _uid and s.student_number = btrim(_row->>'student_number')
             and not (_used ? s.id::text)
           order by s.created_at limit 1;
        end if;
        if _sid is null and nullif(_row->>'match_id','') is not null then
          select s.id into _sid from student s
           where s.teacher_id = _uid and s.id::text = _row->>'match_id'
             and not (_used ? s.id::text);
        end if;
        if _sid is not null then
          _n_matched := _n_matched + 1;
        else
          _sid := (_row->>'id')::uuid;
          insert into student (id, teacher_id, first_name, last_name, preferred_name,
                               pronouns, student_number, email, date_of_birth)
          values (_sid, _uid,
                  coalesce(_row->>'first_name',''),
                  _row->>'last_name', _row->>'preferred_name', _row->>'pronouns',
                  nullif(btrim(_row->>'student_number'),''), nullif(_row->>'email',''),
                  nullif(_row->>'date_of_birth','')::date)
          on conflict (id) do update set
            first_name=excluded.first_name, last_name=excluded.last_name,
            preferred_name=excluded.preferred_name, pronouns=excluded.pronouns,
            student_number=excluded.student_number, email=excluded.email,
            date_of_birth=excluded.date_of_birth, updated_at=now();
        end if;
        _used := _used || jsonb_build_object(_sid::text, true);
        _students := _students || jsonb_build_object(_row->>'id', _sid::text);
        _n_stu := _n_stu + 1;
      end loop;
    end if;

    if p_payload ? 'enrollments' then
      for _row in select * from jsonb_array_elements(p_payload->'enrollments') loop
        insert into enrollment (id, student_id, course_id, designations, roster_position,
                                is_flagged, withdrawn_at, enrolled_at)
        values ((_row->>'id')::uuid,
                coalesce(_students->>(_row->>'student_id'), _row->>'student_id')::uuid,
                (_row->>'course_id')::uuid,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'designations') = 'array'
                         then _row->'designations' else '[]'::jsonb end)), '{}'),
                coalesce((_row->>'roster_position')::int, 0),
                coalesce((_row->>'is_flagged')::boolean, false),
                nullif(_row->>'withdrawn_at','')::timestamptz,
                coalesce(nullif(_row->>'enrolled_at','')::timestamptz, now()))
        on conflict (id) do update set
          designations=excluded.designations, roster_position=excluded.roster_position,
          is_flagged=excluded.is_flagged, withdrawn_at=excluded.withdrawn_at, updated_at=now();
        _n_enr := _n_enr + 1;
      end loop;
    end if;

    if p_payload ? 'assessments' then
      for _row in select * from jsonb_array_elements(p_payload->'assessments') loop
        insert into assessment (id, course_id, category_id, title, description,
                                date_assigned, due_date, score_mode, max_points, weight,
                                evidence_type, rubric_id, module_id, display_order,
                                collab_mode, collab_config, core_competency_ids)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                nullif(_row->>'category_id','')::uuid,
                coalesce(_row->>'title',''), _row->>'description',
                nullif(_row->>'date_assigned','')::date,
                nullif(_row->>'due_date','')::date,
                coalesce(_row->>'score_mode','proficiency'),
                nullif(_row->>'max_points','')::numeric,
                coalesce((_row->>'weight')::numeric, 1.0),
                _row->>'evidence_type',
                nullif(_row->>'rubric_id','')::uuid,
                nullif(_row->>'module_id','')::uuid,
                coalesce((_row->>'display_order')::int, 0),
                coalesce(_row->>'collab_mode','none'),
                case when jsonb_typeof(_row->'collab_config') = 'object' then _row->'collab_config' end,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'core_competency_ids') = 'array'
                         then _row->'core_competency_ids' else '[]'::jsonb end)), '{}'))
        on conflict (id) do update set
          category_id=excluded.category_id, title=excluded.title, description=excluded.description,
          date_assigned=excluded.date_assigned, due_date=excluded.due_date,
          score_mode=excluded.score_mode, max_points=excluded.max_points, weight=excluded.weight,
          evidence_type=excluded.evidence_type, rubric_id=excluded.rubric_id,
          module_id=excluded.module_id, display_order=excluded.display_order,
          collab_mode=excluded.collab_mode, collab_config=excluded.collab_config,
          core_competency_ids=excluded.core_competency_ids, updated_at=now();
        _n_asm := _n_asm + 1;
      end loop;
    end if;

    if p_payload ? 'assessment_tags' then
      insert into assessment_tag (assessment_id, tag_id)
      select (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid from jsonb_array_elements(case when jsonb_typeof(p_payload->'assessment_tags') = 'array' then p_payload->'assessment_tags' else '[]'::jsonb end) r
      on conflict do nothing;
      get diagnostics _n_at = row_count;
    end if;

    if p_payload ? 'scores' then
      insert into score (id, enrollment_id, assessment_id, value, status, comment, scored_at,
                         modifier, report_note)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid,
             nullif(r->>'value','')::numeric, r->>'status', r->>'comment',
             coalesce(nullif(r->>'scored_at','')::timestamptz, now()),
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'report_note','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'scores') = 'array' then p_payload->'scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id) do update set
        value=excluded.value, status=excluded.status, comment=excluded.comment,
        modifier=excluded.modifier, report_note=excluded.report_note, updated_at=now();
      get diagnostics _n_scr = row_count;
    end if;

    if p_payload ? 'rubric_scores' then
      insert into rubric_score (id, enrollment_id, assessment_id, criterion_id, value,
                                modifier, comment, beyond)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'criterion_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'criterion_id')::uuid,
             (r->>'value')::int,
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'comment',''), nullif(r->>'beyond','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'rubric_scores') = 'array' then p_payload->'rubric_scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id, criterion_id) do update set
        value=excluded.value, modifier=excluded.modifier, comment=excluded.comment,
        beyond=excluded.beyond, updated_at=now();
      get diagnostics _n_rs = row_count;
    end if;

    if p_payload ? 'tag_scores' then
      insert into tag_score (id, enrollment_id, assessment_id, tag_id, value, modifier, comment)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid,
             (r->>'value')::int,
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'comment','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'tag_scores') = 'array' then p_payload->'tag_scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id, tag_id) do update set
        value=excluded.value, modifier=excluded.modifier, comment=excluded.comment, updated_at=now();
      get diagnostics _n_ts = row_count;
    end if;

    -- Ticked Advanced Rubric checkboxes.
    if p_payload ? 'rubric_check_scores' then
      insert into rubric_check_score (enrollment_id, assessment_id, check_id)
      select (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'check_id')::uuid
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'rubric_check_scores') = 'array' then p_payload->'rubric_check_scores' else '[]'::jsonb end) r
      on conflict do nothing;
      get diagnostics _n_rcs = row_count;
    end if;

    if p_payload ? 'notes' then
      insert into note (id, enrollment_id, body, created_at)
      select coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, coalesce(r->>'body',''),
             coalesce(nullif(r->>'created_at','')::timestamptz, now())
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'notes') = 'array' then p_payload->'notes' else '[]'::jsonb end) r
      on conflict (id) do update set body=excluded.body;
      get diagnostics _n_note = row_count;
    end if;

    if p_payload ? 'goals' then
      insert into goal (id, enrollment_id, section_id, body)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid, coalesce(r->>'body','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'goals') = 'array' then p_payload->'goals' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set body=excluded.body, updated_at=now();
      get diagnostics _n_goal = row_count;
    end if;

    if p_payload ? 'reflections' then
      insert into reflection (id, enrollment_id, section_id, body, confidence)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid, r->>'body',
             nullif(r->>'confidence','')::int
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'reflections') = 'array' then p_payload->'reflections' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set
        body=excluded.body, confidence=excluded.confidence, updated_at=now();
      get diagnostics _n_refl = row_count;
    end if;

    if p_payload ? 'section_overrides' then
      insert into section_override (id, enrollment_id, section_id, level, reason)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid,
             (r->>'level')::int, r->>'reason'
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'section_overrides') = 'array' then p_payload->'section_overrides' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set
        level=excluded.level, reason=excluded.reason, updated_at=now();
      get diagnostics _n_ovr = row_count;
    end if;

    if p_payload ? 'custom_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'custom_tags') loop
        insert into custom_tag (id, course_id, label)
        values (coalesce(nullif(_row->>'id','')::uuid, gen_random_uuid()),
                (_row->>'course_id')::uuid, _row->>'label')
        on conflict (id) do update set label=excluded.label;
        _n_ctag := _n_ctag + 1;
      end loop;
    end if;

    -- Observations, with their students and competency. A sentence starter
    -- the teacher no longer has is dropped from the link, not the note.
    if p_payload ? 'observations' then
      for _row in select * from jsonb_array_elements(p_payload->'observations') loop
        _id := (_row->>'id')::uuid;
        insert into observation (id, course_id, body, sentiment, context_type, assessment_id,
                                 created_at, dims, level, template_id)
        values (_id, (_row->>'course_id')::uuid, coalesce(_row->>'body',''),
                nullif(_row->>'sentiment',''), nullif(_row->>'context_type',''),
                nullif(_row->>'assessment_id','')::uuid,
                coalesce(nullif(_row->>'created_at','')::timestamptz, now()),
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'dims') = 'array'
                         then _row->'dims' else '[]'::jsonb end)), '{}'),
                nullif(_row->>'level','')::smallint,
                (select t.id from observation_template t
                  where t.id::text = nullif(_row->>'template_id','')))
        on conflict (id) do update set
          body=excluded.body, sentiment=excluded.sentiment, context_type=excluded.context_type,
          assessment_id=excluded.assessment_id, dims=excluded.dims, level=excluded.level,
          template_id=excluded.template_id, updated_at=now();
        insert into observation_student (observation_id, enrollment_id)
        select _id, e::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'enrollment_ids') = 'array' then _row->'enrollment_ids' else '[]'::jsonb end) e
        on conflict do nothing;
        insert into observation_tag (observation_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'tag_ids') = 'array' then _row->'tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        _n_obs := _n_obs + 1;
      end loop;
    end if;

    -- Term ratings, with the competencies, assessments and observations
    -- they name. After observations, which they can point to.
    if p_payload ? 'term_ratings' then
      for _row in select * from jsonb_array_elements(p_payload->'term_ratings') loop
        insert into term_rating (id, enrollment_id, term, narrative_html, work_habits_rating,
                                 participation_rating, social_traits, habits, approved_at,
                                 reporting_basis, ie_deadline, draft_meta, absences, lates)
        values (coalesce(nullif(_row->>'id','')::uuid, gen_random_uuid()),
                (_row->>'enrollment_id')::uuid, (_row->>'term')::int,
                _row->>'narrative_html',
                nullif(_row->>'work_habits_rating','')::int,
                nullif(_row->>'participation_rating','')::int,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'social_traits') = 'array'
                         then _row->'social_traits' else '[]'::jsonb end)), '{}'),
                case when jsonb_typeof(_row->'habits') = 'object' then _row->'habits' else '{}'::jsonb end,
                nullif(_row->>'approved_at','')::timestamptz,
                coalesce(nullif(_row->>'reporting_basis',''), 'grade'),
                nullif(_row->>'ie_deadline','')::date,
                case when jsonb_typeof(_row->'draft_meta') = 'object' then _row->'draft_meta' end,
                nullif(_row->>'absences','')::int,
                nullif(_row->>'lates','')::int)
        on conflict (enrollment_id, term) do update set
          narrative_html=excluded.narrative_html, work_habits_rating=excluded.work_habits_rating,
          participation_rating=excluded.participation_rating, social_traits=excluded.social_traits,
          habits=excluded.habits, approved_at=excluded.approved_at,
          reporting_basis=excluded.reporting_basis, ie_deadline=excluded.ie_deadline,
          draft_meta=excluded.draft_meta, absences=excluded.absences, lates=excluded.lates,
          updated_at=now()
        returning id into _id;
        insert into term_rating_strength (term_rating_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'strength_tag_ids') = 'array' then _row->'strength_tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        insert into term_rating_growth_area (term_rating_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'growth_tag_ids') = 'array' then _row->'growth_tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        insert into term_rating_assessment (term_rating_id, assessment_id)
        select _id, a::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'mention_assessment_ids') = 'array' then _row->'mention_assessment_ids' else '[]'::jsonb end) a
        on conflict do nothing;
        insert into term_rating_observation (term_rating_id, observation_id)
        select _id, o::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'mention_observation_ids') = 'array' then _row->'mention_observation_ids' else '[]'::jsonb end) o
        on conflict do nothing;
        _n_tr := _n_tr + 1;
      end loop;
    end if;

    -- Every other record a restored row names must be the teacher's own:
    -- RLS on each row checks only its own parent. A student is checked by
    -- teacher; any other record by whether RLS shows it. Each id is checked
    -- once: a class's thousands of scores name a few dozen records.
    select l.kind || ' ' || l.id into _bad
      from (
        select distinct v.kind,
               case when v.kind = 'student' then coalesce(_students->>n.id, n.id) else n.id end as id
          from (values
                  ('enrollments', 'student_id', 'student'),
                  ('sections', 'subject_id', 'subject'),
                  ('sections', 'competency_group_id', 'competency_group'),
                  ('assessments', 'category_id', 'category'),
                  ('assessments', 'rubric_id', 'rubric'),
                  ('assessments', 'module_id', 'module'),
                  ('assessment_tags', 'tag_id', 'tag'),
                  ('criterion_tags', 'tag_id', 'tag'),
                  ('rubric_tags', 'tag_id', 'tag'),
                  ('scores', 'assessment_id', 'assessment'),
                  ('rubric_scores', 'assessment_id', 'assessment'),
                  ('rubric_scores', 'criterion_id', 'criterion'),
                  ('tag_scores', 'assessment_id', 'assessment'),
                  ('tag_scores', 'tag_id', 'tag'),
                  ('rubric_check_scores', 'assessment_id', 'assessment'),
                  ('rubric_check_scores', 'check_id', 'criterion_check'),
                  ('goals', 'section_id', 'section'),
                  ('reflections', 'section_id', 'section'),
                  ('section_overrides', 'section_id', 'section'),
                  ('observations', 'assessment_id', 'assessment'),
                  ('observations', 'enrollment_ids', 'enrollment'),
                  ('observations', 'tag_ids', 'tag'),
                  ('term_ratings', 'strength_tag_ids', 'tag'),
                  ('term_ratings', 'growth_tag_ids', 'tag'),
                  ('term_ratings', 'mention_assessment_ids', 'assessment'),
                  ('term_ratings', 'mention_observation_ids', 'observation')
               ) v(arr, field, kind)
         cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(p_payload->v.arr) = 'array' then p_payload->v.arr else '[]'::jsonb end) r
         cross join lateral (
                 select nullif(r->>v.field, '') as id where jsonb_typeof(r->v.field) is distinct from 'array'
                 union all
                 select e from jsonb_array_elements_text(
                     case when jsonb_typeof(r->v.field) = 'array' then r->v.field else '[]'::jsonb end) e
               ) n
      ) l
     where l.id is not null
       and not case l.kind
             when 'student' then exists (select 1 from student x where x.id = l.id::uuid and x.teacher_id = _uid)
             when 'subject' then exists (select 1 from subject x where x.id = l.id::uuid)
             when 'competency_group' then exists (select 1 from competency_group x where x.id = l.id::uuid)
             when 'category' then exists (select 1 from category x where x.id = l.id::uuid)
             when 'rubric' then exists (select 1 from rubric x where x.id = l.id::uuid)
             when 'module' then exists (select 1 from module x where x.id = l.id::uuid)
             when 'tag' then exists (select 1 from tag x where x.id = l.id::uuid)
             when 'assessment' then exists (select 1 from assessment x where x.id = l.id::uuid)
             when 'criterion' then exists (select 1 from criterion x where x.id = l.id::uuid)
             when 'criterion_check' then exists (select 1 from criterion_check x where x.id = l.id::uuid)
             when 'section' then exists (select 1 from section x where x.id = l.id::uuid)
             when 'enrollment' then exists (select 1 from enrollment x where x.id = l.id::uuid)
             when 'observation' then exists (select 1 from observation x where x.id = l.id::uuid)
           end
     limit 1;
    if _bad is not null then
        raise exception 'import_json_restore: % not found', _bad using errcode = 'P0002';
    end if;

    -- One cursor bump per restored course, now the rows are in, through the
    -- course's own trigger (the teacher can't call _touch_course_sync_cursor).
    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform fv_private.restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);
    if p_payload ? 'courses' then
      update course set updated_at = now()
       where id in (select (r->>'id')::uuid from jsonb_array_elements(p_payload->'courses') r);
    end if;

    _result := jsonb_build_object(
      'courses', _n_courses, 'report_configs', _n_rc, 'categories', _n_cat,
      'subjects', _n_subj, 'competency_groups', _n_cg,
      'sections', _n_sect, 'tags', _n_tag,
      'modules', _n_mod, 'rubrics', _n_rub, 'criteria', _n_crit, 'criterion_tags', _n_ct,
      'criterion_checks', _n_chk,
      'students', _n_stu, 'students_matched', _n_matched, 'student_ids', _students,
      'enrollments', _n_enr,
      'assessments', _n_asm, 'assessment_tags', _n_at,
      'scores', _n_scr, 'rubric_scores', _n_rs, 'tag_scores', _n_ts,
      'rubric_check_scores', _n_rcs,
      'notes', _n_note, 'goals', _n_goal, 'reflections', _n_refl,
      'section_overrides', _n_ovr, 'custom_tags', _n_ctag,
      'observations', _n_obs, 'term_ratings', _n_tr
    );
    perform fv_idem_store(p_idempotency_key, 'import_json_restore', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_roster_csv(p_course_id uuid, p_rows jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _row jsonb; _sid uuid;
    _created int := 0; _enrolled int := 0; _reactivated int := 0;
    _existed_id uuid; _was_withdrawn boolean;
    _next_pos int; _desig text[];
    _sn text; _em text; _fn text; _ln text;
    _cached jsonb; _result jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows must be an array' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'import_roster_csv');
    if _cached is not null then return _cached; end if;

    for _row in select * from jsonb_array_elements(p_rows) loop
        _sid := null;
        _sn := nullif(_row->>'student_number', '');
        _em := nullif(_row->>'email', '');
        _fn := nullif(_row->>'first_name', '');
        _ln := nullif(_row->>'last_name', '');
        if _sn is not null then
            select id into _sid from student where teacher_id = _uid and student_number = _sn limit 1;
        end if;
        if _sid is null and _em is not null then
            select id into _sid from student where teacher_id = _uid and email = _em limit 1;
        end if;
        if _sid is null and _fn is not null then
            select id into _sid from student where teacher_id = _uid and first_name = _fn
               and coalesce(last_name, '') = coalesce(_ln, '') limit 1;
        end if;
        if _sid is null then
            insert into student (teacher_id, first_name, last_name, preferred_name,
                                 pronouns, student_number, email, date_of_birth)
            values (_uid, _fn, _ln,
                    nullif(_row->>'preferred_name', ''),
                    nullif(_row->>'pronouns', ''),
                    _sn, _em,
                    nullif(_row->>'date_of_birth', '')::date)
            returning id into _sid;
            _created := _created + 1;
        end if;
        _desig := '{}';
        if _row ? 'designations' and jsonb_typeof(_row->'designations') = 'array' then
            select array_agg(v #>> '{}') into _desig from jsonb_array_elements(_row->'designations') v;
        end if;
        select id, (withdrawn_at is not null) into _existed_id, _was_withdrawn
          from enrollment where student_id = _sid and course_id = p_course_id;
        if _existed_id is null then
            select coalesce(max(roster_position)+1, 0) into _next_pos
              from enrollment where course_id = p_course_id;
            insert into enrollment (student_id, course_id, designations, roster_position)
            values (_sid, p_course_id, coalesce(_desig, '{}'), _next_pos);
            _enrolled := _enrolled + 1;
        elsif _was_withdrawn then
            update enrollment set withdrawn_at = null,
                designations = coalesce(_desig, designations),
                updated_at = now()
             where id = _existed_id;
            _reactivated := _reactivated + 1;
        else
            if _row ? 'designations' then
                update enrollment set designations = coalesce(_desig, '{}'), updated_at = now()
                 where id = _existed_id;
            end if;
            _reactivated := _reactivated + 1;
        end if;
    end loop;

    _result := jsonb_build_object('created', _created, 'enrolled', _enrolled, 'reactivated', _reactivated);
    perform fv_idem_store(p_idempotency_key, 'import_roster_csv', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_teams_class(p_payload jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _course_id uuid;
    _stu_created int := 0; _enr_created int := 0; _asm_created int := 0; _next_pos int := 0;
    _row jsonb; _sid uuid;
    _sn text; _em text; _fn text; _ln text;
    _cached jsonb; _result jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'import_teams_class');
    if _cached is not null then return _cached; end if;

    insert into course (teacher_id, name, grade_level, timezone)
    values (_uid,
            coalesce(p_payload->>'class_name', 'Imported Class'),
            p_payload->>'grade_level',
            coalesce(p_payload->>'timezone', 'America/Vancouver'))
    returning id into _course_id;
    insert into report_config (course_id) values (_course_id);

    if p_payload ? 'students' and jsonb_typeof(p_payload->'students') = 'array' then
        for _row in select * from jsonb_array_elements(p_payload->'students') loop
            _sid := null;
            _sn := nullif(_row->>'student_number', '');
            _em := nullif(_row->>'email', '');
            _fn := nullif(_row->>'first_name', '');
            _ln := nullif(_row->>'last_name', '');
            if _sn is not null then
                select id into _sid from student where teacher_id = _uid and student_number = _sn limit 1;
            end if;
            if _sid is null and _em is not null then
                select id into _sid from student where teacher_id = _uid and email = _em limit 1;
            end if;
            if _sid is null and _fn is not null then
                select id into _sid from student where teacher_id = _uid and first_name = _fn
                   and coalesce(last_name, '') = coalesce(_ln, '') limit 1;
            end if;
            if _sid is null then
                insert into student (teacher_id, first_name, last_name, preferred_name,
                                     pronouns, student_number, email, date_of_birth)
                values (_uid, _fn, _ln,
                        nullif(_row->>'preferred_name',''),
                        nullif(_row->>'pronouns',''),
                        _sn, _em,
                        nullif(_row->>'date_of_birth','')::date)
                returning id into _sid;
                _stu_created := _stu_created + 1;
            end if;
            insert into enrollment (student_id, course_id, roster_position)
            values (_sid, _course_id, _next_pos)
            on conflict (student_id, course_id) do update set withdrawn_at = null, updated_at = now();
            _next_pos := _next_pos + 1;
            _enr_created := _enr_created + 1;
        end loop;
    end if;

    if p_payload ? 'assignments' and jsonb_typeof(p_payload->'assignments') = 'array' then
        for _row in select * from jsonb_array_elements(p_payload->'assignments') loop
            insert into assessment (course_id, title, description, date_assigned, due_date,
                                    score_mode, max_points, weight, display_order)
            values (_course_id,
                    coalesce(_row->>'title', 'Untitled'),
                    _row->>'description',
                    nullif(_row->>'date_assigned','')::date,
                    nullif(_row->>'due_date','')::date,
                    coalesce(_row->>'score_mode', 'proficiency'),
                    nullif(_row->>'max_points','')::numeric,
                    coalesce((_row->>'weight')::numeric, 1.0),
                    _asm_created);
            _asm_created := _asm_created + 1;
        end loop;
    end if;

    update teacher_preference set active_course_id = _course_id where teacher_id = _uid;

    _result := jsonb_build_object('course_id', _course_id,
        'students_created', _stu_created,
        'enrollments_created', _enr_created,
        'assessments_created', _asm_created);
    perform fv_idem_store(p_idempotency_key, 'import_teams_class', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_assessment_copies(p_copy_group uuid)
 RETURNS TABLE(assessment_id uuid, course_id uuid, course_name text, title text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select a.id, a.course_id, c.name, a.title
      from assessment a
      join course c on c.id = a.course_id
     where p_copy_group is not null
       and a.copy_group = p_copy_group
       and c.teacher_id = (select auth.uid())
       and c.deleted_at is null
       and not c.is_archived
     order by c.display_order, c.name;
$function$;

CREATE OR REPLACE FUNCTION public.list_assessment_markup(p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'file_id', m.file_id, 'enrollment_id', m.enrollment_id, 'rev', m.working_rev, 'marks', m.working,
                   'saved_at', m.working_at, 'given', m.given, 'given_rev', m.given_rev, 'given_at', m.given_at,
                   'waiting', m.given_rev is distinct from m.working_rev
                              and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0)
                              and a.students_see_markup) order by m.enrollment_id, m.file_id)
          from markup m join assessment a on a.id = m.assessment_id
         where m.assessment_id = p_assessment_id), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_categories(p_course_id uuid)
 RETURNS TABLE(id uuid, course_id uuid, name text, weight numeric, display_order integer, calc_mode text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
    select id, course_id, name, weight, display_order, calc_mode, created_at, updated_at
    from category
    where course_id = p_course_id
    order by display_order asc, created_at asc;
$function$;

CREATE OR REPLACE FUNCTION public.list_comment_templates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(to_jsonb(t) order by t.uses desc, t.created_at, t.id), '[]'::jsonb)
      from comment_template t
     where t.teacher_id = (select auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.list_competency_descriptors()
 RETURNS TABLE(competency_key text, level smallint, text text, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select d.competency_key, d.level, d.text, d.updated_at
      from competency_descriptor d
     where d.teacher_id = (select auth.uid())
     order by d.competency_key, d.level;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_core_self_assessments(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(x.enrollment_id::text, x.terms), '{}'::jsonb)
    from (
      select t.enrollment_id, jsonb_object_agg(t.term_key, t.cores) as terms
        from (
          select c.enrollment_id, c.term_key,
                 jsonb_object_agg(c.core_id, jsonb_build_object(
                   'level', c.level, 'text', c.body, 'goal', c.goal, 'date', c.updated_at)) as cores
            from core_self_assessment c
            join enrollment e on e.id = c.enrollment_id
           where e.course_id = p_course_id
           group by c.enrollment_id, c.term_key
        ) t
       group by t.enrollment_id
    ) x;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_dibels(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrollment_id', d.enrollment_id,
           'assessment_id', d.assessment_id,
           'period', d.period,
           'orf_wrc', d.orf_wrc,
           'orf_errors', d.orf_errors,
           'maze_correct', d.maze_correct,
           'maze_incorrect', d.maze_incorrect
         ) order by d.assessment_id, d.enrollment_id, d.period), '[]'::jsonb)
    from dibels_score d
    join enrollment e on e.id = d.enrollment_id
   where e.course_id = p_course_id;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_feedback(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
        'course', (select jsonb_build_object('reflect_on_feedback', c.reflect_on_feedback, 'show_my_learning', c.show_my_learning)
                     from course c where c.id = p_course_id),
        'markup', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', m.file_id, 'assessment_id', m.assessment_id, 'enrollment_id', m.enrollment_id,
                       'rev', m.working_rev, 'given_rev', m.given_rev, 'given_at', m.given_at,
                       'waiting', m.given_rev is distinct from m.working_rev
                                  and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0)
                                  and a.students_see_markup) order by m.assessment_id, m.enrollment_id, m.file_id)
              from markup m join assessment a on a.id = m.assessment_id where m.course_id = p_course_id), '[]'::jsonb),
        'revisions', coalesce((
            select jsonb_agg(_revision_json(r.id) order by r.created_at, r.id)
              from revision_request r where r.course_id = p_course_id), '[]'::jsonb),
        'reflections', coalesce((
            select jsonb_agg(_reflection_json(f.id) order by f.sent_at, f.id)
              from feedback_reflection f join course c on c.id = f.course_id
             where f.course_id = p_course_id and c.reflect_on_feedback), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_goal_dates(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(x.enrollment_id::text, x.dates), '{}'::jsonb)
    from (
      select g.enrollment_id,
             jsonb_object_agg(g.section_id::text, g.updated_at) as dates
        from goal g
        join enrollment e on e.id = g.enrollment_id
       where e.course_id = p_course_id
       group by g.enrollment_id
    ) x;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_grade_returns(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select coalesce(jsonb_object_agg(x.assessment_id::text, x.students), '{}'::jsonb)
      from (select g.assessment_id,
                   jsonb_object_agg(g.enrollment_id::text, jsonb_strip_nulls(jsonb_build_object(
                       'is_draft', g.is_draft, 'returned_at', g.returned_at, 'updated_at', g.updated_at,
                       'returned_copy', g.returned_copy, 'previous_copy', g.previous_copy,
                       -- E3: the Note for the Report the returned grade went out with, while a
                       -- regrade of it is open (sent only then; held_note null is an empty note)
                       'held_note_at', case when g.is_draft and g.returned_at is not null and g.held_note_at = g.returned_at
                                            then g.held_note_at end,
                       'held_note', case when g.is_draft and g.returned_at is not null and g.held_note_at = g.returned_at
                                         then g.held_note end))) as students
              from grade_return g
              join enrollment e on e.id = g.enrollment_id
              join assessment a on a.id = g.assessment_id
             where e.course_id = p_course_id
               -- a row with nothing to say (a grade cleared, a save in flight) is left out.
               -- seen_at is the student's own and is not sent to the teacher, and a DIBELS
               -- benchmark is not a grade that is returned (2026110905).
               and (g.is_draft or g.returned_at is not null)
               and a.score_mode <> 'dibels'
             group by g.assessment_id) x;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_guardians(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    return coalesce((
        select jsonb_agg(to_jsonb(g) || jsonb_build_object('enrollment_id', e.id)
                         order by e.roster_position, e.id, g.name)
          from enrollment e
          join guardian g on g.student_id = e.student_id
         where e.course_id = p_course_id
           and e.withdrawn_at is null
    ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_questionnaires(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(
           _questionnaire_json(q.id) || jsonb_build_object(
             'answered', coalesce((
               select jsonb_agg(distinct r.enrollment_id)
                 from response r where r.questionnaire_id = q.id), '[]'::jsonb))
           order by q.opens_on nulls first, q.created_at), '[]'::jsonb)
    from questionnaire q
   where q.course_id = p_course_id;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_resources(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return coalesce((
        select jsonb_agg(_assessment_resource_json(r.id) order by r.assessment_id, r.position, r.created_at, r.id)
          from assessment_resource r
         where r.course_id = p_course_id
           and not (r.status = 'uploading' and r.created_at < now() - _work_hold())), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_responses(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(x.questionnaire_id::text, x.by_student), '{}'::jsonb)
    from (
      select y.questionnaire_id, jsonb_object_agg(y.enrollment_id::text, y.subs) as by_student
        from (
          select r.questionnaire_id, r.enrollment_id,
                 jsonb_agg(jsonb_build_object(
                   'id', r.id, 'submitted_at', r.submitted_at, 'via', r.via,
                   'answers', coalesce((
                     select jsonb_object_agg(a.question_id::text, jsonb_build_object(
                              'num', a.value_num, 'text', a.value_text, 'json', a.value_json))
                       from answer a where a.response_id = r.id), '{}'::jsonb))
                   order by r.submitted_at desc) as subs
            from response r
            join questionnaire q on q.id = r.questionnaire_id
           where q.course_id = p_course_id
           group by r.questionnaire_id, r.enrollment_id
        ) y
       group by y.questionnaire_id
    ) x;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_student_profiles(p_course_id uuid)
 RETURNS TABLE(student jsonb, enrollment jsonb, overall_proficiency numeric, letter jsonb, counts jsonb, goals jsonb, reflections jsonb, section_overrides jsonb, is_flagged boolean, recent_observations jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select
        to_jsonb(s.*) as student,
        to_jsonb(e.*) as enrollment,
        case when c.grading_system in ('proficiency','both')
             then fv_overall_proficiency(e.id, e.course_id)
             else null end as overall_proficiency,
        case when c.grading_system in ('letter','both')
             then fv_course_letter_pipeline(e.id, e.course_id)
             else jsonb_build_object('Q', null, 'R', null, 'S', null) end as letter,
        fv_status_counts(e.id, e.course_id) as counts,
        coalesce((
            select jsonb_object_agg(g.section_id::text, g.body)
              from goal g
             where g.enrollment_id = e.id
        ), '{}'::jsonb) as goals,
        coalesce((
            select jsonb_object_agg(
                r.section_id::text,
                jsonb_build_object(
                    'confidence', r.confidence,
                    'text',       r.body,
                    'date',       r.updated_at
                )
            )
              from reflection r
             where r.enrollment_id = e.id
        ), '{}'::jsonb) as reflections,
        coalesce((
            select jsonb_object_agg(
                so.section_id::text,
                jsonb_build_object(
                    'level',      so.level,
                    'reason',     so.reason,
                    'date',       so.updated_at,
                    'calculated', fv_section_proficiency(e.id, so.section_id)
                )
            )
              from section_override so
             where so.enrollment_id = e.id
        ), '{}'::jsonb) as section_overrides,
        e.is_flagged,
        coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id',          ro.id,
                    'text',        ro.body,
                    'sentiment',   ro.sentiment,
                    'context',     ro.context_type,
                    'created_at',  ro.created_at,
                    'observed_at', ro.created_at
                )
                order by ro.created_at desc
            )
            from (
                select o.*
                  from observation o
                  join observation_student os on os.observation_id = o.id
                 where o.course_id = e.course_id
                   and os.enrollment_id = e.id
                 order by o.created_at desc
                 limit 3
            ) ro
        ), '[]'::jsonb) as recent_observations
    from enrollment e
    join student s on s.id = e.student_id
    join course c on c.id = e.course_id
    where e.course_id = p_course_id
      and e.withdrawn_at is null
    order by e.roster_position nulls last, s.last_name, s.first_name;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_submissions(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
        'bucket', _work_bucket(),
        'course', (select jsonb_build_object('send_work', c.send_work, 'keep_photos_until', c.keep_photos_until)
                     from course c where c.id = p_course_id),
        'assessments', coalesce((
            select jsonb_agg(_assessment_work_json(a.id) order by a.id)
              from assessment a where a.course_id = p_course_id), '[]'::jsonb),
        -- handed in: never one with a page missing
        'submissions', coalesce((
            select jsonb_agg(_submission_json(s.id) - 'intent' - 'target_id' order by s.sent_at, s.id)
              from submission s where s.course_id = p_course_id and s.state = 'sent'), '[]'::jsonb),
        -- the teacher's own uploads that are not finished and still hold their place
        'uploads', coalesce((
            select jsonb_agg(_submission_json(s.id) || jsonb_build_object('finish_by', s.created_at + _work_hold()) order by s.created_at, s.id)
              from submission s
             where s.course_id = p_course_id and s.state = 'sending' and s.sent_by = 'teacher'
               and s.created_at >= now() - _work_hold()), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_course_term_attendance(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(x.enrollment_id::text, x.terms), '{}'::jsonb)
    from (
      select tr.enrollment_id,
             jsonb_object_agg(tr.term::text, jsonb_build_object('absences', tr.absences, 'lates', tr.lates)) as terms
        from term_rating tr
        join enrollment e on e.id = tr.enrollment_id
       where e.course_id = p_course_id
         and (tr.absences is not null or tr.lates is not null)
       group by tr.enrollment_id
    ) x;
$function$;

CREATE OR REPLACE FUNCTION public.list_phone_reports(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(_phone_report_json(r.id) order by r.issued_at desc), '[]'::jsonb)
    from phone_report r
   where r.course_id = p_course_id and fv_owns_course(r.course_id);
$function$;

CREATE OR REPLACE FUNCTION public.list_questionnaire_templates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.kind, t.grade nulls first, t.period nulls first), '[]'::jsonb)
    from questionnaire_template t;
$function$;

CREATE OR REPLACE FUNCTION public.list_removed_sections(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'subject_id', s.subject_id,
             'competency_group_id', s.competency_group_id, 'removed_at', s.removed_at,
             'tags', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', t.id, 'code', t.code, 'label', t.label, 'i_can_text', t.i_can_text,
                        'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,
                        'bank_id', t.bank_id)
                      order by t.display_order, t.label)
                 from tag t where t.section_id = s.id), '[]'::jsonb)
           ) order by s.removed_at desc), '[]'::jsonb)
      from section s
     where s.course_id = p_course_id and s.removed_at is not null;
$function$;

CREATE OR REPLACE FUNCTION public.list_report_issues(p_course_id uuid, p_term integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', i.id,
                   'course_id', i.course_id,
                   'term', i.term,
                   'term_label', i.term_label,
                   'paper', i.paper,
                   'issued_at', i.issued_at,
                   'student_count', i.student_count,
                   'hashes', coalesce((select jsonb_object_agg(s.enrollment_id::text, s.hash)
                                         from report_issue_student s where s.issue_id = i.id), '{}'::jsonb)
               ) order by i.issued_at desc)
          from report_issue i
         where i.course_id = p_course_id
           and (p_term is null or i.term = p_term)
    ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_report_templates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb)
      from report_template t
     where t.teacher_id = (select auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.list_rubric_copies(p_copy_group uuid)
 RETURNS TABLE(rubric_id uuid, course_id uuid, course_name text, name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select r.id, r.course_id, c.name, r.name
      from rubric r
      join course c on c.id = r.course_id
     where p_copy_group is not null
       and r.copy_group = p_copy_group
       and c.teacher_id = (select auth.uid())
       and c.deleted_at is null
       and not c.is_archived
     order by c.display_order, c.name;
$function$;

CREATE OR REPLACE FUNCTION public.list_student_cards(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return coalesce((
        select jsonb_agg(_student_card_json(k.id) order by e.roster_position nulls last, e.id)
          from student_card k
          join enrollment e on e.id = k.enrollment_id
         where e.course_id = p_course_id and k.stopped_at is null and e.withdrawn_at is null), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_teacher_courses()
 RETURNS TABLE(id uuid, name text, grade_level text, description text, color text, is_archived boolean, display_order integer, grading_system text, calc_method text, decay_weight numeric, timezone text, late_work_policy text, created_at timestamp with time zone, updated_at timestamp with time zone, block text, curriculum_tags text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    select c.id, c.name, c.grade_level, c.description, c.color,
           c.is_archived, c.display_order, c.grading_system, c.calc_method,
           c.decay_weight, c.timezone, c.late_work_policy,
           c.created_at, c.updated_at, c.block, c.curriculum_tags
      from course c
     where c.teacher_id = (select auth.uid())
       and c.deleted_at is null
     order by c.is_archived asc, c.display_order asc, c.created_at asc;
$function$;

CREATE OR REPLACE FUNCTION public.mark_handed_in_paper(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _eid    uuid;
    _id     uuid;
    _made   uuid[] := '{}';
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    perform _grade_return_lock_first(_course);
    -- Asked under the lock: the same request sent twice at once waits above,
    -- and the second is answered as a repeat of the first.
    _cached := fv_idem_check(p_idempotency_key, 'mark_handed_in_paper');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    for _eid in
        select e.id from enrollment e
         where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course and e.withdrawn_at is null
           and not exists (select 1 from submission s
                            where s.assessment_id = p_assessment_id and s.enrollment_id = e.id and s.state = 'sent')
         order by e.id
    loop
        insert into submission (course_id, assessment_id, enrollment_id, state, sent_by, on_paper, sent_at, request_id)
        values (_course, p_assessment_id, _eid, 'sent', 'teacher', true, now(), p_idempotency_key)
        returning id into _id;
        _made := _made || _id;
    end loop;
    _cached := jsonb_build_object(
        'marked', cardinality(_made),
        'submissions', coalesce((select jsonb_agg(_submission_json(s.id) - 'intent' - 'target_id' order by s.enrollment_id)
                                   from submission s where s.id = any (_made)), '[]'::jsonb));
    perform fv_idem_store(p_idempotency_key, 'mark_handed_in_paper', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_student_cards_printed(p_card_ids uuid[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _n      int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'mark_student_cards_printed');
    if _cached is not null then return _cached; end if;
    update student_card k set printed_at = now()
     where k.id = any (coalesce(p_card_ids, '{}')) and k.stopped_at is null and fv_owns_enrollment(k.enrollment_id);
    get diagnostics _n = row_count;
    _cached := jsonb_build_object('printed', _n);
    perform fv_idem_store(p_idempotency_key, 'mark_student_cards_printed', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.move_rubric_scores(p_assessment_id uuid, p_rubric_id uuid, p_criterion_map jsonb, p_check_map jsonb DEFAULT '{}'::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

    -- Draft and Returned: the updates below point scores at the copy's
    -- criteria and checkboxes. They are a rubric move, not a change to any
    -- grade, and the triggers read this flag to know it. Only a move to
    -- another rubric is one: a map that starts from a criterion or checkbox
    -- of the target rubric itself swaps levels inside one rubric, and that
    -- is a change like any other.
    perform set_config('fv.moving_rubric',
        case when exists (select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
                            join criterion c on c.id::text = m.key where c.rubric_id = p_rubric_id)
               or exists (select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
                            join criterion_check ck on ck.id::text = m.key
                            join criterion c on c.id = ck.criterion_id where c.rubric_id = p_rubric_id)
             then '' else 'on' end, true);

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

    -- The copies kept for students follow the scores to the new ids, also
    -- where the working copy no longer has the row.
    perform fv_private.grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);
    perform set_config('fv.moving_rubric', '', true);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);
    perform fv_idem_store(p_idempotency_key, 'move_rubric_scores', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE PROCEDURE public.photo_lifecycle_nightly()
 LANGUAGE plpgsql
AS $procedure$
declare
    _course uuid;
    _failed integer := 0;
    _state  text;
    _msg    text;
    _miss   jsonb;
    _stuck  jsonb;
begin
    delete from public.photo_check_log where at < now() - interval '90 days';
    delete from public.photo_keep_check k where not exists (select 1 from public.course c where c.id = k.course_id);
    commit;
    -- Every class with work, and every class that has a folder in the bucket (section 4).
    for _course in
        select s.course_id from public.submission s
        union
        select c.id from public.course c
         where c.id in (select distinct fv_private.work_path_course(o.name) from storage.objects o
                         where o.bucket_id = public._work_bucket() and o.archived_at is null and not o.is_delete_marker)
        order by 1
    loop
        begin
            perform set_config('lock_timeout', '10s', true);
            perform public._photo_keep_class(_course, now());
            perform public._photo_strays(_course, now());
            _miss := public._photo_missing(_course);
            if (_miss->>'n')::int > 0 then
                perform public._photo_log(_course, 'missing_file', (_miss->>'n')::int, _miss->'file_ids');
            end if;
        exception when others then
            get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            perform public._photo_log(_course, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
            _failed := _failed + 1;
        end;
        commit;
    end loop;
    begin
        perform set_config('lock_timeout', '10s', true);
        perform public._photo_strays(null, now());
    exception when others then
        get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
        perform public._photo_log(null, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
        _failed := _failed + 1;
    end;
    commit;
    -- Files due for hours: the calls to the edge function are not working (section 6).
    _stuck := public._photo_stuck();
    if (_stuck->>'n')::int > 0 then
        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));
        _failed := _failed + 1;
    end if;
    commit;
    if _failed > 0 then
        raise exception 'photo_lifecycle_nightly: % part(s) of this run failed or found files stuck in the queue; the rest is done. See public.photo_check_log.', _failed;
    end if;
end;
$procedure$;

CREATE OR REPLACE FUNCTION public.photo_removal_call()
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _url    text;
    _secret text;
    _stuck  jsonb;
begin
    if not public.photo_removal_due() then
        return null;
    end if;
    select s.decrypted_secret into _url from vault.decrypted_secrets s where s.name = 'fv_photo_sweep_url';
    select s.decrypted_secret into _secret from vault.decrypted_secrets s where s.name = 'fv_photo_sweep_secret';
    if _url is null or _secret is null then
        raise exception 'photo removal: the Vault secrets fv_photo_sweep_url and fv_photo_sweep_secret are not both set; queued files wait.';
    end if;
    if _url <> 'https://novsfeqjhbleyyaztmlh.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1' then
        raise exception 'photo removal: fv_photo_sweep_url is not this project''s student-submit address with ?forceFunctionRegion=ca-central-1; nothing was sent.';
    end if;
    if _secret !~ '^[0-9a-f]{64}$' then
        raise exception 'photo removal: fv_photo_sweep_secret is not 64 lower-case hex characters.';
    end if;
    -- Files due for hours: the calls are not working. Said once an hour, and the call is still made.
    _stuck := public._photo_stuck();
    if (_stuck->>'n')::int > 0
       and not exists (select 1 from public.photo_check_log l
                        where l.kind = 'error' and l.detail ? 'stuck_files' and l.at > now() - interval '1 hour') then
        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));
    end if;
    return net.http_post(url := _url,
                         body := jsonb_build_object('route', 'scheduled-sweep', 'secret', _secret),
                         params := '{}'::jsonb,
                         headers := '{"Content-Type": "application/json"}'::jsonb,
                         timeout_milliseconds := 10000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.photo_removal_due()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select exists (select 1 from submission_file_removal r
                    where not r.done and (r.removed_at is null or r.link_dies_at <= now()))
       and not exists (select 1 from submission_file_removal r
                        where not r.done and r.last_try_at > now() - interval '5 minutes');
$function$;

CREATE OR REPLACE FUNCTION public.reenrol_student(p_enrollment_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'reenrol_student');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    update enrollment
       set withdrawn_at = null,
           updated_at = now()
     where id = p_enrollment_id;

    if not found then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('enrollment_id', p_enrollment_id);
    perform fv_idem_store(p_idempotency_key, 'reenrol_student', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.relink_student(p_ghost_student_id uuid, p_canonical_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _ghost student%rowtype;
    _canon student%rowtype;
    _moved int := 0;
    _merged int := 0;
    _ghost_enr enrollment%rowtype;
    _canon_enr enrollment%rowtype;
    _merged_designations text[];
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ghost_student_id = p_canonical_student_id then
        raise exception 'ghost and canonical cannot be the same student' using errcode = '22023';
    end if;

    select * into _ghost from student where id = p_ghost_student_id;
    if not found then raise exception 'ghost student not found' using errcode = 'P0002'; end if;
    select * into _canon from student where id = p_canonical_student_id;
    if not found then raise exception 'canonical student not found' using errcode = 'P0002'; end if;

    -- Per-enrollment: move or merge.
    for _ghost_enr in
        select * from enrollment where student_id = p_ghost_student_id
    loop
        select * into _canon_enr
          from enrollment
         where student_id = p_canonical_student_id
           and course_id = _ghost_enr.course_id;

        if found then
            -- Merge: union designations, clear withdrawn_at if either active.
            _merged_designations := (
                select array(
                  select distinct unnest(
                    coalesce(_canon_enr.designations, '{}') ||
                    coalesce(_ghost_enr.designations, '{}')
                  )
                )
            );
            update enrollment set
                designations = _merged_designations,
                withdrawn_at = case
                    when _canon_enr.withdrawn_at is null or _ghost_enr.withdrawn_at is null
                    then null
                    else greatest(_canon_enr.withdrawn_at, _ghost_enr.withdrawn_at)
                end,
                updated_at = now()
            where id = _canon_enr.id;
            delete from enrollment where id = _ghost_enr.id;
            _merged := _merged + 1;
        else
            -- Simple move.
            update enrollment set student_id = p_canonical_student_id,
                                  updated_at = now()
             where id = _ghost_enr.id;
            _moved := _moved + 1;
        end if;
    end loop;

    -- Ghost must have no enrollments left → safe to delete.
    delete from student where id = p_ghost_student_id;

    return jsonb_build_object(
      'enrollments_moved',  _moved,
      'enrollments_merged', _merged,
      'deleted_student',    p_ghost_student_id
    );
end; $function$;

CREATE OR REPLACE FUNCTION public.remove_assessment_resource(p_resource_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _n      int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from assessment_resource r
     where r.id = p_resource_id and fv_owns_assessment(r.assessment_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'remove_assessment_resource');
    if _cached is not null then return _cached; end if;
    if _course is null then
        return jsonb_build_object('removed', false);
    end if;
    delete from assessment_resource where id = p_resource_id;
    get diagnostics _n = row_count;
    _cached := jsonb_build_object('removed', _n > 0);
    perform fv_idem_store(p_idempotency_key, 'remove_assessment_resource', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_section(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _at     timestamptz;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'remove_section');
    if _cached is not null then
        return _cached;
    end if;
    update section set removed_at = coalesce(removed_at, now()) where id = p_id returning removed_at into _at;
    if not found then
        raise exception 'section not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('section_id', p_id, 'removed_at', _at);
    perform fv_idem_store(p_idempotency_key, 'remove_section', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_categories(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update category
    set display_order = sub.idx - 1,
        updated_at    = now()
    from unnest(p_ids) with ordinality as sub(id, idx)
    where category.id = sub.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_competency_groups(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _i int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update competency_group set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.reorder_modules(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _i int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update module set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.reorder_roster(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update enrollment set roster_position = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.reorder_sections(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _i int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update section set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.reorder_subjects(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _i int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update subject set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.reorder_tags(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _i int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update tag set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.restore_section(p_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'restore_section');
    if _cached is not null then
        return _cached;
    end if;
    update section set removed_at = null where id = p_id;
    if not found then
        raise exception 'section not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('section_id', p_id, 'removed_at', null);
    perform fv_idem_store(p_idempotency_key, 'restore_section', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_teacher()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update teacher
       set deleted_at = null
     where id = _uid
       and deleted_at is not null;

    if not found then
        raise exception 'no pending deletion found for this teacher' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_for_revision(p_assessment_id uuid, p_enrollment_id uuid, p_request jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached  jsonb;
    _course  uuid;
    _a       assessment%rowtype;
    _k       text;
    _fix     text;
    _by      date;
    _crit    uuid[] := '{}';
    _keep    boolean := true;
    _open    revision_request%rowtype;
    _sub     submission%rowtype;
    _g       grade_return%rowtype;
    _ret     jsonb;
    _id      uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select * into _a from assessment where id = p_assessment_id;
    _course := _a.course_id;
    if not fv_owns_enrollment(p_enrollment_id)
       or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.course_id = _course and e.withdrawn_at is null) then
        raise exception 'student not found' using errcode = 'P0002';
    end if;
    -- The request's shape, before anything is written.
    if p_request is null or jsonb_typeof(p_request) <> 'object' then
        raise exception 'the request must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_request) loop
        if _k not in ('what_to_fix', 'revise_by', 'criterion_ids', 'keep_grade') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
    end loop;
    if jsonb_typeof(p_request->'what_to_fix') is distinct from 'string'
       or char_length(btrim(p_request->>'what_to_fix')) not between 1 and 2000 then
        raise exception 'what_to_fix must be 1 to 2000 characters' using errcode = '22023';
    end if;
    _fix := btrim(p_request->>'what_to_fix');
    if p_request ? 'revise_by' and jsonb_typeof(p_request->'revise_by') <> 'null' then
        if jsonb_typeof(p_request->'revise_by') <> 'string' or _fv_date(p_request->>'revise_by') is null then
            raise exception 'revise_by must be a date, YYYY-MM-DD' using errcode = '22023';
        end if;
        _by := _fv_date(p_request->>'revise_by');
    end if;
    if p_request ? 'keep_grade' then
        if jsonb_typeof(p_request->'keep_grade') <> 'boolean' then
            raise exception 'keep_grade must be true or false' using errcode = '22023';
        end if;
        _keep := (p_request->>'keep_grade')::boolean;
    end if;
    if p_request ? 'criterion_ids' then
        if jsonb_typeof(p_request->'criterion_ids') <> 'array'
           or exists (select 1 from jsonb_array_elements(p_request->'criterion_ids') x
                       where jsonb_typeof(x) <> 'string'
                          or x #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
            raise exception 'criterion_ids must be a list of ids' using errcode = '22023';
        end if;
        select coalesce(array_agg(distinct (x #>> '{}')::uuid), '{}') into _crit from jsonb_array_elements(p_request->'criterion_ids') x;
        if exists (select 1 from unnest(_crit) c
                    where not exists (select 1 from criterion cr where cr.id = c and cr.rubric_id = _a.rubric_id)) then
            raise exception 'a criterion is not on this assessment''s rubric' using errcode = '22023';
        end if;
    end if;

    perform _grade_return_lock_first(_course);
    -- Asked under the lock.
    _cached := fv_idem_check(p_idempotency_key, 'return_for_revision');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id)
       or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null) then
        -- deleted or withdrawn while this call waited for the class
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    if _a.score_mode = 'dibels' then
        return jsonb_build_object('result', 'not_for_dibels');
    end if;
    -- A request whose revision's grade has since been returned is done.
    perform _revision_settle(p_enrollment_id, p_assessment_id, false);
    select * into _open from revision_request
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'open';
    if found then
        return jsonb_build_object('result', 'already_open', 'request', _revision_json(_open.id));
    end if;
    if not _keep then
        return jsonb_build_object('result', 'hide_not_available');
    end if;

    -- The work is returned first, as Return would return it.
    _ret := return_work(p_assessment_id, array[p_enrollment_id], null);
    _sub := _piece_latest(p_assessment_id, p_enrollment_id);
    select * into _g from grade_return where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    insert into revision_request (course_id, assessment_id, enrollment_id, what_to_fix, revise_by, criterion_ids, keep_grade,
                                  first_submission_id, first_version, first_grade, first_returned_at, created_by)
    values (_course, p_assessment_id, p_enrollment_id, _fix, _by, _crit, _keep,
            _sub.id, coalesce(_sub.version, 1),
            -- What the student has now: just returned, so not a draft.
            case when _g.returned_at is not null and not _g.is_draft then _grade_copy(p_enrollment_id, p_assessment_id) end,
            case when _g.returned_at is not null and not _g.is_draft then _g.returned_at end,
            (select auth.uid()))
    returning id into _id;
    _cached := jsonb_build_object('result', 'made', 'request', _revision_json(_id), 'returned', _ret, 'hidden', false);
    perform fv_idem_store(p_idempotency_key, 'return_for_revision', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_grades(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _e      uuid;
    _at     timestamptz := clock_timestamp();
    _done   uuid[] := '{}';
    _result jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'return_grades');
    if _cached is not null then return _cached; end if;

    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    -- Wait for any save to this class that is under way, then read.
    perform _grade_return_lock_first(_course);
    for _e in
        select g.enrollment_id from grade_return g
          join enrollment e on e.id = g.enrollment_id
         where g.assessment_id = p_assessment_id
           and g.enrollment_id = any (coalesce(p_enrollment_ids, '{}'))
           and e.course_id = _course
           and g.is_draft
           -- a DIBELS benchmark is not a grade that is returned (2026110905)
           and not exists (select 1 from assessment a where a.id = g.assessment_id and a.score_mode = 'dibels')
         order by g.enrollment_id
    loop
        if _grade_return_one(_e, p_assessment_id, _at) then
            _done := _done || _e;
        end if;
    end loop;

    -- Other devices reload the class, as after any score write.
    if cardinality(_done) > 0 then
        perform _touch_course_sync_cursor(_course, 'gradebook');
    end if;

    _result := jsonb_build_object('returned', cardinality(_done), 'enrollment_ids', to_jsonb(_done), 'returned_at', _at);
    perform fv_idem_store(p_idempotency_key, 'return_grades', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_work(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _r       jsonb;
    _e       uuid;
    _pages   int := 0;
    _who     uuid[] := '{}';
    _waiting uuid[];
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    perform _grade_return_lock_first(_course);
    -- Asked under the lock: the same request twice at once waits above.
    _cached := fv_idem_check(p_idempotency_key, 'return_work');
    if _cached is not null then return _cached; end if;
    -- return_grades, unchanged. It asks who is signed in and whether they
    -- own the assessment again, and takes the lock this call holds. No key:
    -- this call remembers the whole answer under its own.
    -- A revision returned since by another path is closed first, so this
    -- Return cannot read it as anything else.
    perform _revision_settle(e.id, p_assessment_id, false)
       from enrollment e where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course;
    -- The listed students' pages with marks waiting (as _markup_give reads
    -- them), counted at the end once given.
    select coalesce(array_agg(m.file_id), '{}') into _waiting
      from markup m join enrollment e on e.id = m.enrollment_id
     where m.assessment_id = p_assessment_id and e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course
       and m.given_rev is distinct from m.working_rev
       and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0);
    _r := return_grades(p_assessment_id, p_enrollment_ids, null);
    -- Then Return ends each listed student's request whose revision is in,
    -- graded or left at the same grade.
    perform _revision_settle(e.id, p_assessment_id, true)
       from enrollment e where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course;
    for _e in
        select e.id from enrollment e
         where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course
           and not exists (select 1 from grade_return g
                            where g.enrollment_id = e.id and g.assessment_id = p_assessment_id and g.is_draft)
         order by e.id
    loop
        perform _markup_give(_e, p_assessment_id);
    end loop;
    select count(*)::int, coalesce(array_agg(distinct m.enrollment_id order by m.enrollment_id), '{}')
      into _pages, _who
      from markup m
     where m.file_id = any (_waiting) and m.given_rev = m.working_rev;
    _cached := _r || jsonb_build_object('marks_given', _pages, 'marks_enrollment_ids', to_jsonb(_who));
    perform fv_idem_store(p_idempotency_key, 'return_work', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rotate_submission_page(p_file_id uuid, p_rotation integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_rotation is null or p_rotation not in (0, 90, 180, 270) then
        raise exception 'rotation must be 0, 90, 180 or 270' using errcode = '22023';
    end if;
    select s.course_id into _course
      from submission_file f join submission s on s.id = f.submission_id
     where f.id = p_file_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock): the same request
    -- sent twice at once waits above, and the second is answered as a repeat.
    _cached := fv_idem_check(p_idempotency_key, 'rotate_submission_page');
    if _cached is not null then return _cached; end if;
    if _course is null then
        raise exception 'page not found' using errcode = 'P0002';
    end if;
    update submission_file set rotation = p_rotation where id = p_file_id;
    if not found then
        raise exception 'page not found' using errcode = 'P0002';
    end if;
    _cached := jsonb_build_object('file_id', p_file_id, 'rotation', p_rotation);
    perform fv_idem_store(p_idempotency_key, 'rotate_submission_page', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_assessment_tags(p_id uuid, p_tag_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not exists (select 1 from assessment where id = p_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;

    delete from assessment_tag where assessment_id = p_id;
    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag)
            on conflict do nothing;
        end loop;
    end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.save_categories(p_course_id uuid, p_categories jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _row jsonb;
    _id uuid;
    _name text;
    _mode text;
    _ids uuid[] := '{}';
    _keep uuid[];
    _ord int := 0;
    _total numeric;
    _count int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_categories is null or jsonb_typeof(p_categories) <> 'array' then
        raise exception 'categories must be an array' using errcode = '22023';
    end if;

    perform 1 from course
     where id = p_course_id and teacher_id = (select auth.uid()) and deleted_at is null;
    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(coalesce((e->>'weight')::numeric, 0)), 0), count(*)
      into _total, _count
      from jsonb_array_elements(p_categories) e;
    if _count > 0 and _total <> 100 then
        raise exception 'category weights must total 100 (they total %)', _total
            using errcode = '23514';
    end if;

    select coalesce(array_agg((e->>'id')::uuid), '{}')
      into _keep
      from jsonb_array_elements(p_categories) e
     where nullif(e->>'id', '') is not null;

    if _count > 0 and exists (
        select 1 from category c
         where c.course_id = p_course_id
           and not (c.id = any (_keep))
           and exists (select 1 from assessment a where a.category_id = c.id)
    ) then
        raise exception 'category in use: move its assessments to another category first'
            using errcode = 'P0001';
    end if;

    delete from category c where c.course_id = p_course_id and not (c.id = any (_keep));

    for _row in select * from jsonb_array_elements(p_categories) loop
        _name := btrim(coalesce(_row->>'name', ''));
        if _name = '' then
            raise exception 'every category needs a name' using errcode = '22023';
        end if;
        _mode := nullif(_row->>'calc_mode', '');
        if _mode is not null and _mode not in ('points', 'percent') then
            raise exception 'calc_mode must be points or percent' using errcode = '22023';
        end if;
        _id := nullif(_row->>'id', '')::uuid;
        if _id is null then
            insert into category (course_id, name, weight, display_order, calc_mode)
            values (p_course_id, _name, coalesce((_row->>'weight')::numeric, 0), _ord,
                    coalesce(_mode, 'points'))
            returning id into _id;
        else
            update category set
                name = _name,
                weight = coalesce((_row->>'weight')::numeric, 0),
                display_order = _ord,
                calc_mode = coalesce(_mode, calc_mode),
                updated_at = now()
             where id = _id and course_id = p_course_id;
            if not found then
                raise exception 'category not found' using errcode = 'P0002';
            end if;
        end if;
        _ids := _ids || _id;
        _ord := _ord + 1;
    end loop;

    return _ids;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_collab(p_id uuid, p_mode text, p_config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_mode not in ('none','pairs','groups') then
        raise exception 'invalid collab_mode %', p_mode using errcode = '22023';
    end if;

    update assessment set
        collab_mode   = p_mode,
        collab_config = case when p_mode = 'none' then null else p_config end,
        updated_at    = now()
    where id = p_id;
    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.save_comment_template(p_text text, p_slots jsonb DEFAULT '[]'::jsonb, p_condition jsonb DEFAULT '{}'::jsonb, p_id uuid DEFAULT NULL::uuid, p_uses integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _row    comment_template%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'save_comment_template');
    if _cached is not null then
        return _cached;
    end if;
    if p_uses is not null and p_uses < 0 then
        raise exception 'uses must be 0 or more' using errcode = '22023';
    end if;
    if p_id is not null then
        update comment_template
           set text = btrim(p_text),
               slots = coalesce(p_slots, '[]'::jsonb),
               condition = coalesce(p_condition, '{}'::jsonb),
               uses = coalesce(p_uses, uses),
               updated_at = now()
         where id = p_id and teacher_id = (select auth.uid())
        returning * into _row;
        if not found then
            raise exception 'comment template not found' using errcode = 'P0002';
        end if;
    else
        insert into comment_template (teacher_id, text, slots, condition, uses)
        values ((select auth.uid()), btrim(p_text), coalesce(p_slots, '[]'::jsonb),
                coalesce(p_condition, '{}'::jsonb), coalesce(p_uses, 0))
        on conflict (teacher_id, lower(btrim(text))) do update
           set slots = excluded.slots,
               condition = excluded.condition,
               uses = coalesce(p_uses, comment_template.uses),
               updated_at = now()
        returning * into _row;
    end if;
    _cached := to_jsonb(_row);
    perform fv_idem_store(p_idempotency_key, 'save_comment_template', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_competency_descriptors(p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid   uuid := (select auth.uid());
    _e     jsonb;
    _key   text;
    _level smallint;
    _text  text;
    _n     integer := 0;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'p_entries must be a jsonb array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_entries) > 200 then
        raise exception 'too many entries' using errcode = '22023';
    end if;

    for _e in select * from jsonb_array_elements(p_entries) loop
        _key   := nullif(btrim(_e->>'key'), '');
        _level := (_e->>'level')::smallint;
        _text  := nullif(btrim(coalesce(_e->>'text', '')), '');
        if _key is null or _level is null or _level not between 1 and 4 then
            raise exception 'each entry needs a key and a level from 1 to 4' using errcode = '22023';
        end if;

        if _text is null then
            delete from competency_descriptor
             where teacher_id = _uid and competency_key = _key and level = _level;
        else
            insert into competency_descriptor (teacher_id, competency_key, level, text)
            values (_uid, _key, _level, _text)
            on conflict (teacher_id, competency_key, level) do update
               set text = excluded.text, updated_at = now();
        end if;
        _n := _n + 1;
    end loop;
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_markup(p_file_id uuid, p_marks jsonb, p_base_rev integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _s      submission%rowtype;
    _m      markup%rowtype;
    _given  int := 0;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    perform _markup_check(p_marks);
    if p_base_rev is not null and p_base_rev < 0 then
        raise exception 'base_rev must be 0 or more' using errcode = '22023';
    end if;
    select s.course_id into _course
      from submission_file f join submission s on s.id = f.submission_id
     where f.id = p_file_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock).
    _cached := fv_idem_check(p_idempotency_key, 'save_markup');
    if _cached is not null then return _cached; end if;
    -- Only a page of handed-in work, of a class the teacher owns. Read
    -- again under the lock: it may have been unsent while this call waited.
    select s.* into _s
      from submission_file f join submission s on s.id = f.submission_id
     where f.id = p_file_id and s.course_id = _course and s.state = 'sent';
    if _s.id is null then
        raise exception 'page not found' using errcode = 'P0002';
    end if;
    select * into _m from markup where file_id = p_file_id for update;
    if p_base_rev is not null and coalesce(_m.working_rev, 0) <> p_base_rev then
        -- Not remembered: the screen reads what is there and decides.
        return jsonb_build_object('result', 'changed', 'file_id', p_file_id, 'rev', coalesce(_m.working_rev, 0), 'marks', _m.working);
    end if;
    insert into markup (file_id, course_id, assessment_id, enrollment_id, working, working_rev, working_at)
    values (p_file_id, _s.course_id, _s.assessment_id, _s.enrollment_id, p_marks, 1, clock_timestamp())
    on conflict (file_id) do update
       set working = excluded.working, working_rev = markup.working_rev + 1, working_at = excluded.working_at
    returning * into _m;
    if not _grade_return_holds(_s.enrollment_id) then
        _given := _markup_give(_s.enrollment_id, _s.assessment_id);
    end if;
    -- given_rev and waiting as list_assessment_markup has them (given, there,
    -- is the student's copy of the marks; it is not repeated here).
    select jsonb_build_object('result', 'saved', 'file_id', p_file_id, 'rev', m.working_rev, 'given_rev', m.given_rev,
                              'waiting', m.given_rev is distinct from m.working_rev
                                         and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0)
                                         and a.students_see_markup)
      into _cached
      from markup m join assessment a on a.id = m.assessment_id where m.file_id = p_file_id;
    perform fv_idem_store(p_idempotency_key, 'save_markup', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_report_config(p_course_id uuid, p_blocks_config jsonb, p_preset text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _preset text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _preset := coalesce(p_preset, 'custom');
    if _preset not in ('brief','standard','detailed','custom') then
        raise exception 'invalid preset %', _preset using errcode = '22023';
    end if;

    insert into report_config (course_id, preset, blocks_config)
    values (p_course_id, _preset, p_blocks_config)
    on conflict (course_id) do update
       set preset = excluded.preset,
           blocks_config = excluded.blocks_config,
           updated_at = now();
end; $function$;

CREATE OR REPLACE FUNCTION public.save_report_template(p_name text, p_form jsonb, p_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _row    report_template%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'save_report_template');
    if _cached is not null then
        return _cached;
    end if;

    if p_id is not null then
        update report_template
           set name = btrim(p_name), form = p_form, updated_at = now()
         where id = p_id and teacher_id = (select auth.uid())
        returning * into _row;
        if not found then
            raise exception 'report template not found' using errcode = 'P0002';
        end if;
    else
        insert into report_template (teacher_id, name, form)
        values ((select auth.uid()), btrim(p_name), p_form)
        on conflict (teacher_id, lower(btrim(name))) do update
           set form = excluded.form, updated_at = now()
        returning * into _row;
    end if;

    _cached := to_jsonb(_row);
    perform fv_idem_store(p_idempotency_key, 'save_report_template', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_score_comment(p_enrollment_id uuid, p_assessment_id uuid, p_comment text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select id into _id from score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;

    if _id is null then
        insert into score (enrollment_id, assessment_id, comment)
        values (p_enrollment_id, p_assessment_id, p_comment)
        returning id into _id;
    else
        update score set comment = p_comment, updated_at = now() where id = _id;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.save_score_report_note(p_enrollment_id uuid, p_assessment_id uuid, p_note text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    -- E3: a regrade of a returned grade is open (a draft): the note the
    -- returned grade went out with is kept beside it before this change, so
    -- reports print that one until the regrade is returned.
    perform fv_private.report_note_hold(p_enrollment_id, p_assessment_id);
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

CREATE OR REPLACE FUNCTION public.save_teacher_preferences(p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _uid uuid := (select auth.uid());
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    insert into teacher_preference (teacher_id,
        active_course_id, view_mode, mobile_view_mode, mobile_sort_mode, card_widget_config, dashboard_prefs)
    values (_uid,
        nullif(p_patch->>'active_course_id','')::uuid,
        nullif(p_patch->>'view_mode',''),
        nullif(p_patch->>'mobile_view_mode',''),
        nullif(p_patch->>'mobile_sort_mode',''),
        case when p_patch ? 'card_widget_config' then p_patch->'card_widget_config' else null end,
        case when p_patch ? 'dashboard_prefs' then p_patch->'dashboard_prefs' else null end)
    on conflict (teacher_id) do update set
        active_course_id   = case when p_patch ? 'active_course_id'
                                  then nullif(p_patch->>'active_course_id','')::uuid
                                  else teacher_preference.active_course_id end,
        view_mode          = case when p_patch ? 'view_mode'
                                  then nullif(p_patch->>'view_mode','')
                                  else teacher_preference.view_mode end,
        mobile_view_mode   = case when p_patch ? 'mobile_view_mode'
                                  then nullif(p_patch->>'mobile_view_mode','')
                                  else teacher_preference.mobile_view_mode end,
        mobile_sort_mode   = case when p_patch ? 'mobile_sort_mode'
                                  then nullif(p_patch->>'mobile_sort_mode','')
                                  else teacher_preference.mobile_sort_mode end,
        card_widget_config = case when p_patch ? 'card_widget_config'
                                  then p_patch->'card_widget_config'
                                  else teacher_preference.card_widget_config end,
        dashboard_prefs    = case when p_patch ? 'dashboard_prefs'
                                  then p_patch->'dashboard_prefs'
                                  else teacher_preference.dashboard_prefs end;
end; $function$;

CREATE OR REPLACE FUNCTION public.save_term_attendance(p_enrollment_id uuid, p_term integer, p_absences integer, p_lates integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _tr_id uuid; _old term_rating%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_term < 1 or p_term > 6 then raise exception 'term must be 1..6' using errcode = '22023'; end if;
    if (p_absences is not null and p_absences < 0) or (p_lates is not null and p_lates < 0) then
        raise exception 'attendance totals cannot be negative' using errcode = '22023';
    end if;

    select * into _old from term_rating where enrollment_id = p_enrollment_id and term = p_term;

    insert into term_rating (enrollment_id, term, absences, lates)
    values (p_enrollment_id, p_term, p_absences, p_lates)
    on conflict (enrollment_id, term) do update
       set absences = excluded.absences, lates = excluded.lates, updated_at = now()
    returning id into _tr_id;

    perform _term_rating_audit_field(_tr_id, 'absences', _old.absences::text, p_absences::text);
    perform _term_rating_audit_field(_tr_id, 'lates', _old.lates::text, p_lates::text);
    return _tr_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.save_term_rating(p_enrollment_id uuid, p_term integer, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _tr_id uuid; _old term_rating%rowtype;
    _new_nar text; _new_wh int; _new_pr int; _new_st text[];
    _new_habits jsonb; _new_approved timestamptz;
    _new_basis text; _new_deadline date; _new_meta jsonb;
    _elem jsonb; _u uuid;
    _old_dim_map jsonb; _new_dim_map jsonb := '{}';
    _sec_id uuid; _rating int;
    _kv record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_term < 1 or p_term > 6 then raise exception 'term must be 1..6' using errcode = '22023'; end if;

    if p_payload ? 'work_habits_rating' then
        _new_wh := nullif(p_payload->>'work_habits_rating','')::int;
        if _new_wh is not null and (_new_wh < 1 or _new_wh > 4) then
            raise exception 'work_habits_rating must be 1..4' using errcode = '22023';
        end if;
    end if;
    if p_payload ? 'participation_rating' then
        _new_pr := nullif(p_payload->>'participation_rating','')::int;
        if _new_pr is not null and (_new_pr < 1 or _new_pr > 4) then
            raise exception 'participation_rating must be 1..4' using errcode = '22023';
        end if;
    end if;
    if p_payload ? 'habits' then
        if jsonb_typeof(p_payload->'habits') is distinct from 'object' then
            raise exception 'habits must be an object' using errcode = '22023';
        end if;
        for _kv in select key as k, value as v from jsonb_each(p_payload->'habits') loop
            if _kv.k not in ('completes', 'ready', 'others', 'part', 'feedback', 'devices') then
                raise exception 'unknown habit %', _kv.k using errcode = '22023';
            end if;
            if jsonb_typeof(_kv.v) is distinct from 'number' or (_kv.v #>> '{}') !~ '^[1-5]$' then
                raise exception 'habit % must be 1..5', _kv.k using errcode = '22023';
            end if;
        end loop;
    end if;
    if p_payload ? 'approved' and jsonb_typeof(p_payload->'approved') is distinct from 'boolean' then
        raise exception 'approved must be true or false' using errcode = '22023';
    end if;
    if p_payload ? 'reporting_basis'
       and coalesce(p_payload->>'reporting_basis', '') not in ('grade', 'ie', 'language_goals', 'iep_goals') then
        raise exception 'reporting_basis must be grade, ie, language_goals or iep_goals' using errcode = '22023';
    end if;
    if p_payload ? 'ie_deadline' and jsonb_typeof(p_payload->'ie_deadline') <> 'null'
       and coalesce(p_payload->>'ie_deadline', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'ie_deadline must be a date (YYYY-MM-DD) or null' using errcode = '22023';
    end if;
    if p_payload ? 'draft_meta' and jsonb_typeof(p_payload->'draft_meta') <> 'null' then
        if jsonb_typeof(p_payload->'draft_meta') <> 'object' then
            raise exception 'draft_meta must be an object or null' using errcode = '22023';
        end if;
        if octet_length((p_payload->'draft_meta')::text) > 65536 then
            raise exception 'draft_meta is over 64 KB' using errcode = '22023';
        end if;
        if coalesce(jsonb_typeof(p_payload->'draft_meta'->'sentences'), 'array') <> 'array'
           or coalesce(jsonb_typeof(p_payload->'draft_meta'->'slots'), 'object') <> 'object'
           or coalesce(jsonb_typeof(p_payload->'draft_meta'->'class_sentences'), 'object') <> 'object'
           or coalesce(jsonb_typeof(p_payload->'draft_meta'->'facts_hash'), 'string') <> 'string' then
            raise exception 'draft_meta: sentences must be an array, slots and class_sentences objects, facts_hash a string'
                using errcode = '22023';
        end if;
    end if;

    select * into _old from term_rating where enrollment_id = p_enrollment_id and term = p_term;

    _new_nar := case when p_payload ? 'narrative_html' then p_payload->>'narrative_html' else _old.narrative_html end;
    _new_wh  := case when p_payload ? 'work_habits_rating'
                    then nullif(p_payload->>'work_habits_rating','')::int else _old.work_habits_rating end;
    _new_pr  := case when p_payload ? 'participation_rating'
                    then nullif(p_payload->>'participation_rating','')::int else _old.participation_rating end;
    if p_payload ? 'social_traits' and jsonb_typeof(p_payload->'social_traits') = 'array' then
        select array_agg(v #>> '{}') into _new_st from jsonb_array_elements(p_payload->'social_traits') v;
        _new_st := coalesce(_new_st, '{}');
    else
        _new_st := coalesce(_old.social_traits, '{}');
    end if;
    _new_habits := case when p_payload ? 'habits' then p_payload->'habits' else coalesce(_old.habits, '{}'::jsonb) end;
    _new_approved := case
        when p_payload ? 'approved' and (p_payload->>'approved')::boolean then
            case when _new_nar is distinct from _old.narrative_html then now()
                 else coalesce(_old.approved_at, now()) end
        when p_payload ? 'approved' then null
        when _new_nar is distinct from _old.narrative_html then null
        else _old.approved_at
    end;
    _new_basis := case when p_payload ? 'reporting_basis' then p_payload->>'reporting_basis'
                       else coalesce(_old.reporting_basis, 'grade') end;
    _new_deadline := case when p_payload ? 'ie_deadline' then (p_payload->>'ie_deadline')::date
                          else _old.ie_deadline end;
    _new_meta := case when p_payload ? 'draft_meta' then nullif(p_payload->'draft_meta', 'null'::jsonb)
                      else _old.draft_meta end;
    if _new_basis = 'ie' and _new_deadline is null then
        raise exception 'an IE needs a deadline (ie_deadline)' using errcode = '22023';
    end if;

    insert into term_rating (enrollment_id, term, narrative_html,
                             work_habits_rating, participation_rating, social_traits,
                             habits, approved_at, reporting_basis, ie_deadline, draft_meta)
    values (p_enrollment_id, p_term, _new_nar, _new_wh, _new_pr, _new_st, _new_habits, _new_approved,
            _new_basis, _new_deadline, _new_meta)
    on conflict (enrollment_id, term) do update
       set narrative_html       = excluded.narrative_html,
           work_habits_rating   = excluded.work_habits_rating,
           participation_rating = excluded.participation_rating,
           social_traits        = excluded.social_traits,
           habits               = excluded.habits,
           approved_at          = excluded.approved_at,
           reporting_basis      = excluded.reporting_basis,
           ie_deadline          = excluded.ie_deadline,
           draft_meta           = excluded.draft_meta,
           updated_at           = now()
    returning id into _tr_id;

    perform _term_rating_audit_field(_tr_id, 'narrative_html', _old.narrative_html, _new_nar);
    perform _term_rating_audit_field(_tr_id, 'work_habits_rating', _old.work_habits_rating::text, _new_wh::text);
    perform _term_rating_audit_field(_tr_id, 'participation_rating', _old.participation_rating::text, _new_pr::text);
    perform _term_rating_audit_field(_tr_id, 'social_traits',
        array_to_string(_old.social_traits, ','),
        array_to_string(_new_st, ','));
    perform _term_rating_audit_field(_tr_id, 'habits', coalesce(_old.habits, '{}'::jsonb)::text, _new_habits::text);
    perform _term_rating_audit_field(_tr_id, 'approved_at', _old.approved_at::text, _new_approved::text);
    perform _term_rating_audit_field(_tr_id, 'reporting_basis', coalesce(_old.reporting_basis, 'grade'), _new_basis);
    perform _term_rating_audit_field(_tr_id, 'ie_deadline', _old.ie_deadline::text, _new_deadline::text);
    perform _term_rating_audit_field(_tr_id, 'draft_meta.facts_hash',
        _old.draft_meta->>'facts_hash', _new_meta->>'facts_hash');

    if p_payload ? 'dimensions' and jsonb_typeof(p_payload->'dimensions') = 'array' then
        select jsonb_object_agg(section_id::text, rating::text)
          into _old_dim_map
          from term_rating_dimension where term_rating_id = _tr_id;
        _old_dim_map := coalesce(_old_dim_map, '{}'::jsonb);

        delete from term_rating_dimension where term_rating_id = _tr_id;

        for _elem in select * from jsonb_array_elements(p_payload->'dimensions') loop
            _sec_id := (_elem->>'section_id')::uuid;
            _rating := (_elem->>'rating')::int;
            if _rating < 1 or _rating > 4 then
                raise exception 'dimension rating must be 1..4' using errcode = '22023';
            end if;
            insert into term_rating_dimension (term_rating_id, section_id, rating)
            values (_tr_id, _sec_id, _rating);
            _new_dim_map := _new_dim_map || jsonb_build_object(_sec_id::text, _rating::text);
        end loop;

        -- Audit changes/adds/removes
        for _kv in select key as k, value as v from jsonb_each_text(_new_dim_map) loop
            perform _term_rating_audit_field(_tr_id,
                'dimension:' || _kv.k,
                _old_dim_map->>_kv.k,
                _kv.v);
        end loop;
        for _kv in select key as k, value as v from jsonb_each_text(_old_dim_map) where not (_new_dim_map ? key) loop
            perform _term_rating_audit_field(_tr_id,
                'dimension:' || _kv.k,
                _kv.v, null);
        end loop;
    end if;

    if p_payload ? 'strength_tags' and jsonb_typeof(p_payload->'strength_tags') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'strength_tags',
            (select string_agg(tag_id::text, ',' order by tag_id) from term_rating_strength where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'strength_tags') v));
        delete from term_rating_strength where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'strength_tags') v loop
            insert into term_rating_strength (term_rating_id, tag_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    if p_payload ? 'growth_tags' and jsonb_typeof(p_payload->'growth_tags') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'growth_tags',
            (select string_agg(tag_id::text, ',' order by tag_id) from term_rating_growth_area where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'growth_tags') v));
        delete from term_rating_growth_area where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'growth_tags') v loop
            insert into term_rating_growth_area (term_rating_id, tag_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    if p_payload ? 'mention_assessments' and jsonb_typeof(p_payload->'mention_assessments') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'mention_assessments',
            (select string_agg(assessment_id::text, ',' order by assessment_id) from term_rating_assessment where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'mention_assessments') v));
        delete from term_rating_assessment where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'mention_assessments') v loop
            insert into term_rating_assessment (term_rating_id, assessment_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    if p_payload ? 'mention_observations' and jsonb_typeof(p_payload->'mention_observations') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'mention_observations',
            (select string_agg(observation_id::text, ',' order by observation_id) from term_rating_observation where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'mention_observations') v));
        delete from term_rating_observation where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'mention_observations') v loop
            insert into term_rating_observation (term_rating_id, observation_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    return _tr_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_assessment_student_work(p_assessment_id uuid, p_patch jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _k      text;
    _a      assessment%rowtype;
    _after  text;
    _until  date;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_assessment_student_work');
    if _cached is not null then return _cached; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('students_send', 'after_due', 'accept_until', 'group_work', 'students_see_markup') then
            raise exception 'unknown setting %', _k using errcode = '22023';
        end if;
    end loop;
    if p_patch ? 'students_send' and (jsonb_typeof(p_patch->'students_send') <> 'string'
                                      or p_patch->>'students_send' not in ('nothing', 'photos', 'photos_files')) then
        raise exception 'students_send must be nothing, photos or photos_files' using errcode = '22023';
    end if;
    if p_patch ? 'after_due' and (jsonb_typeof(p_patch->'after_due') <> 'string'
                                  or p_patch->>'after_due' not in ('keep', 'until', 'stop')) then
        raise exception 'after_due must be keep, until or stop' using errcode = '22023';
    end if;
    if p_patch ? 'group_work' and (jsonb_typeof(p_patch->'group_work') <> 'string'
                                   or p_patch->>'group_work' not in ('each', 'group')) then
        raise exception 'group_work must be each or group' using errcode = '22023';
    end if;
    if p_patch ? 'students_see_markup' and jsonb_typeof(p_patch->'students_see_markup') <> 'boolean' then
        raise exception 'students_see_markup must be true or false' using errcode = '22023';
    end if;
    if p_patch ? 'accept_until' and jsonb_typeof(p_patch->'accept_until') <> 'null'
       and (jsonb_typeof(p_patch->'accept_until') <> 'string' or _fv_date(p_patch->>'accept_until') is null) then
        raise exception 'accept_until must be a date, YYYY-MM-DD' using errcode = '22023';
    end if;

    select * into _a from assessment where id = p_assessment_id for update;
    _after := case when p_patch ? 'after_due' then p_patch->>'after_due' else _a.after_due end;
    -- The date is kept only with "until"; any other choice drops it.
    _until := case when _after <> 'until' then null
                   when p_patch ? 'accept_until' then _fv_date(p_patch->>'accept_until')
                   else _a.accept_until end;
    if _after = 'until' and _until is null then
        raise exception 'after_due until needs accept_until' using errcode = '22023';
    end if;
    if _after = 'until' and _a.due_date is not null and _until < _a.due_date then
        raise exception 'accept_until is before the due date' using errcode = '22023';
    end if;
    update assessment
       set students_send = case when p_patch ? 'students_send' then p_patch->>'students_send' else students_send end,
           after_due = _after,
           accept_until = _until,
           group_work = case when p_patch ? 'group_work' then p_patch->>'group_work' else group_work end,
           students_see_markup = case when p_patch ? 'students_see_markup' then (p_patch->>'students_see_markup')::boolean
                                      else students_see_markup end,
           updated_at = now()
     where id = p_assessment_id;
    _cached := _assessment_work_json(p_assessment_id);
    perform fv_idem_store(p_idempotency_key, 'set_assessment_student_work', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_cards_work_until(p_course_id uuid, p_date date, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_cards_work_until');
    if _cached is not null then return _cached; end if;
    update course set cards_work_until = p_date, updated_at = now() where id = p_course_id;
    update student_card k set works_until = _cards_work_until(p_course_id)
      from enrollment e
     where e.id = k.enrollment_id and e.course_id = p_course_id and k.stopped_at is null;
    _cached := jsonb_build_object('works_until', _cards_work_until(p_course_id));
    perform fv_idem_store(p_idempotency_key, 'set_cards_work_until', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_course_feedback_options(p_course_id uuid, p_patch jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _k      text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_course_feedback_options');
    if _cached is not null then return _cached; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('reflect_on_feedback', 'show_my_learning') then
            raise exception 'unknown setting %', _k using errcode = '22023';
        end if;
        if jsonb_typeof(p_patch->_k) <> 'boolean' then
            raise exception '% must be true or false', _k using errcode = '22023';
        end if;
    end loop;
    update course
       set reflect_on_feedback = case when p_patch ? 'reflect_on_feedback' then (p_patch->>'reflect_on_feedback')::boolean else reflect_on_feedback end,
           show_my_learning = case when p_patch ? 'show_my_learning' then (p_patch->>'show_my_learning')::boolean else show_my_learning end,
           updated_at = now()
     where id = p_course_id;
    select jsonb_build_object('reflect_on_feedback', c.reflect_on_feedback, 'show_my_learning', c.show_my_learning)
      into _cached from course c where c.id = p_course_id;
    perform fv_idem_store(p_idempotency_key, 'set_course_feedback_options', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_course_send_work(p_course_id uuid, p_patch jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _k      text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_course_send_work');
    if _cached is not null then return _cached; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('send_work', 'keep_photos_until') then
            raise exception 'unknown setting %', _k using errcode = '22023';
        end if;
    end loop;
    if p_patch ? 'send_work' and jsonb_typeof(p_patch->'send_work') <> 'boolean' then
        raise exception 'send_work must be true or false' using errcode = '22023';
    end if;
    if p_patch ? 'keep_photos_until' and (jsonb_typeof(p_patch->'keep_photos_until') <> 'string'
                                          or p_patch->>'keep_photos_until' not in ('end_of_year', 'end_of_term')) then
        raise exception 'keep_photos_until must be end_of_year or end_of_term' using errcode = '22023';
    end if;
    -- Only what the patch names is written (DECISIONS, "Class settings on
    -- two computers" 3).
    update course
       set send_work = case when p_patch ? 'send_work' then (p_patch->>'send_work')::boolean else send_work end,
           keep_photos_until = case when p_patch ? 'keep_photos_until' then p_patch->>'keep_photos_until' else keep_photos_until end,
           updated_at = now()
     where id = p_course_id;
    select jsonb_build_object('send_work', c.send_work, 'keep_photos_until', c.keep_photos_until)
      into _cached from course c where c.id = p_course_id;
    perform fv_idem_store(p_idempotency_key, 'set_course_send_work', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_questionnaire_on(p_id uuid, p_is_on boolean, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_questionnaire_on');
    if _cached is not null then
        return _cached;
    end if;
    update questionnaire set is_on = coalesce(p_is_on, false), updated_at = now()
     where id = p_id and fv_owns_course(course_id);
    if not found then
        raise exception 'questionnaire not found' using errcode = 'P0002';
    end if;
    _cached := jsonb_build_object('id', p_id, 'is_on', coalesce(p_is_on, false));
    perform fv_idem_store(p_idempotency_key, 'set_questionnaire_on', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_revision_request(p_request_id uuid, p_patch jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _r      revision_request%rowtype;
    _k      text;
    _crit   uuid[];
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('what_to_fix', 'revise_by', 'criterion_ids') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
    end loop;
    if p_patch ? 'what_to_fix' and (jsonb_typeof(p_patch->'what_to_fix') is distinct from 'string'
                                    or char_length(btrim(p_patch->>'what_to_fix')) not between 1 and 2000) then
        raise exception 'what_to_fix must be 1 to 2000 characters' using errcode = '22023';
    end if;
    if p_patch ? 'revise_by' and jsonb_typeof(p_patch->'revise_by') <> 'null'
       and (jsonb_typeof(p_patch->'revise_by') <> 'string' or _fv_date(p_patch->>'revise_by') is null) then
        raise exception 'revise_by must be a date, YYYY-MM-DD' using errcode = '22023';
    end if;
    if p_patch ? 'criterion_ids' and (jsonb_typeof(p_patch->'criterion_ids') <> 'array'
           or exists (select 1 from jsonb_array_elements(p_patch->'criterion_ids') x
                       where jsonb_typeof(x) <> 'string'
                          or x #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then
        raise exception 'criterion_ids must be a list of ids' using errcode = '22023';
    end if;
    select r.course_id into _course from revision_request r where r.id = p_request_id and fv_owns_course(r.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_revision_request');
    if _cached is not null then return _cached; end if;
    select * into _r from revision_request where id = p_request_id and course_id = _course for update;
    if not found then
        raise exception 'revision request not found' using errcode = 'P0002';
    end if;
    if _r.state <> 'open' then
        return jsonb_build_object('result', 'not_open', 'request', _revision_json(_r.id));
    end if;
    if p_patch ? 'criterion_ids' then
        select coalesce(array_agg(distinct (x #>> '{}')::uuid), '{}') into _crit from jsonb_array_elements(p_patch->'criterion_ids') x;
        if exists (select 1 from unnest(_crit) c
                    where not exists (select 1 from criterion cr join assessment a on a.rubric_id = cr.rubric_id
                                       where cr.id = c and a.id = _r.assessment_id)) then
            raise exception 'a criterion is not on this assessment''s rubric' using errcode = '22023';
        end if;
    end if;
    update revision_request
       set what_to_fix = case when p_patch ? 'what_to_fix' then btrim(p_patch->>'what_to_fix') else what_to_fix end,
           revise_by = case when p_patch ? 'revise_by' then _fv_date(p_patch->>'revise_by') else revise_by end,
           criterion_ids = case when p_patch ? 'criterion_ids' then _crit else criterion_ids end,
           updated_at = now()
     where id = _r.id;
    _cached := jsonb_build_object('result', 'saved', 'request', _revision_json(_r.id));
    perform fv_idem_store(p_idempotency_key, 'set_revision_request', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_rubric_check(p_enrollment_id uuid, p_assessment_id uuid, p_check_id uuid, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.set_rubric_printed(p_enrollment_id uuid, p_assessment_id uuid, p_hash text, p_printed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _hash text; _cached jsonb; _on boolean;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'set_rubric_printed');
    if _cached is not null then
        return (_cached->>'on')::boolean;
    end if;

    -- The student and the work must be in the same class. Row security on
    -- both tables keeps this to the teacher's own classes.
    if not exists (
        select 1
          from enrollment e
          join assessment a on a.course_id = e.course_id
         where e.id = p_enrollment_id and a.id = p_assessment_id
    ) then
        raise exception 'enrollment % and assessment % are not in one class', p_enrollment_id, p_assessment_id
            using errcode = '22023';
    end if;

    _hash := nullif(btrim(p_hash), '');
    if char_length(_hash) > 64 then
        raise exception 'print hash must be 64 characters or fewer' using errcode = '22023';
    end if;
    _on := _hash is not null;

    if _on then
        insert into rubric_print (enrollment_id, assessment_id, printed_at, content_hash)
        values (p_enrollment_id, p_assessment_id, coalesce(p_printed_at, now()), _hash)
        on conflict (enrollment_id, assessment_id) do update
           set printed_at = excluded.printed_at, content_hash = excluded.content_hash;
    else
        delete from rubric_print
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    end if;

    perform fv_idem_store(p_idempotency_key, 'set_rubric_printed', jsonb_build_object('on', _on));
    return _on;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_score_status(p_enrollment_id uuid, p_assessment_id uuid, p_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
        values (p_enrollment_id, p_assessment_id, p_status)
        returning id into _id;
        perform _score_audit_diff(_id, null, null, null, p_status);
    else
        update score set status = p_status, updated_at = now() where id = _id;
        perform _score_audit_diff(_id, _old_v, _old_v, _old_s, p_status);
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.soft_delete_teacher()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update teacher
       set deleted_at = now()
     where id = _uid;

    if not found then
        raise exception 'teacher not found' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_handout_upload(p_assessment_id uuid, p_title text, p_page_count integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _title  text := btrim(coalesce(p_title, ''));
    _id     uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    if p_page_count is null or p_page_count not between 1 and 20 then
        raise exception 'a handout can have 1 to 20 pages' using errcode = '22023';
    end if;
    if _title = '' then
        _title := 'Handout';
    end if;
    if char_length(_title) > 200 then
        raise exception 'a name can be 200 characters at most' using errcode = '22023';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;

    perform _grade_return_lock_first(_course);
    _cached := fv_idem_check(p_idempotency_key, 'start_handout_upload');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    perform _handout_drop_expired(_course);
    if (select count(*) from assessment_resource r where r.assessment_id = p_assessment_id) >= 50 then
        raise exception 'an assessment can hold 50 handouts and links at most' using errcode = '22023';
    end if;
    insert into assessment_resource (assessment_id, course_id, kind, title, page_count, status, position)
    values (p_assessment_id, _course, 'pdf', _title, p_page_count, 'uploading',
            (select coalesce(max(r.position), 0) + 1 from assessment_resource r where r.assessment_id = p_assessment_id))
    returning id into _id;
    _cached := _assessment_resource_json(_id) || jsonb_build_object('bucket', _work_bucket());
    perform fv_idem_store(p_idempotency_key, 'start_handout_upload', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_work_upload(p_assessment_id uuid, p_enrollment_id uuid, p_pages jsonb, p_mode text DEFAULT 'new'::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _course uuid;
    _sent   submission%rowtype;
    _id     uuid;
    _pages  int;
    _full   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    if not fv_owns_enrollment(p_enrollment_id)
       or not exists (select 1 from enrollment e
                       where e.id = p_enrollment_id and e.course_id = _course and e.withdrawn_at is null) then
        raise exception 'student not found' using errcode = 'P0002';
    end if;
    if coalesce(p_mode, '') not in ('new', 'add', 'replace') then
        raise exception 'mode must be new, add or replace' using errcode = '22023';
    end if;
    perform _work_check_pages(p_pages);

    perform _grade_return_lock_first(_course);
    -- Asked under the lock: the same request sent twice at once waits here,
    -- and the second is answered as a repeat of the first.
    _cached := fv_idem_check(p_idempotency_key, 'start_work_upload');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id)
       or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null) then
        -- deleted while this call waited for the class
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    perform _work_drop_expired(_course);
    select * into _sent from submission
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'sent'
     order by version desc limit 1;
    if p_mode = 'new' and _sent.id is not null then
        -- The student, or another of the teacher's devices, got there first.
        -- Nothing is made; the screen offers Add as More Pages, Replace Them
        -- or Skip. Not remembered: a retry reads the piece again.
        return jsonb_build_object('result', 'already_sent', 'submission', _submission_json(_sent.id) - 'intent' - 'target_id');
    end if;
    if p_mode in ('add', 'replace') and _sent.id is null then
        return jsonb_build_object('result', 'nothing_sent');
    end if;
    -- More things the screen cannot know for sure when it asks (another
    -- device may have changed the piece): answers, not errors, and not
    -- remembered.
    if p_mode = 'add' and _sent.on_paper then
        -- nothing to add pages to: Replace Them is the way
        return jsonb_build_object('result', 'on_paper', 'submission', _submission_json(_sent.id) - 'intent' - 'target_id');
    end if;
    _pages := (select count(*) from submission_file f where f.submission_id = _sent.id);
    if p_mode = 'add' and _pages + jsonb_array_length(p_pages) > 30 then
        return jsonb_build_object('result', 'too_many_pages', 'room', 30 - _pages);
    end if;
    -- An upload this teacher started for the piece and never finished goes.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'teacher';
    perform set_config('fv.work_removal_reason', '', true);
    -- The class may hold only so much.
    _full := _work_class_full(_course, p_pages);
    if _full is not null then
        return jsonb_build_object('result', 'class_full') || _full;
    end if;
    _id := _work_begin(_course, p_assessment_id, p_enrollment_id, 'teacher', p_mode,
                       case when p_mode = 'new' then null else _sent.id end, p_pages, null, null, false, null, p_idempotency_key);
    _cached := jsonb_build_object('result', 'ready', 'submission_id', _id, 'mode', p_mode, 'bucket', _work_bucket(),
                                  'finish_by', now() + _work_hold(), 'files', _work_upload_json(_id));
    perform fv_idem_store(p_idempotency_key, 'start_work_upload', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_support_report(p_page text, p_message text, p_browser text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _uid    uuid := (select auth.uid());
    _cached jsonb;
    _id     uuid;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_message is null or btrim(p_message) = '' then
        raise exception 'message is required' using errcode = '22023';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'submit_support_report');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    insert into public.support_report (teacher_id, page, message, browser, app_version)
    values (
        _uid,
        left(coalesce(p_page, ''), 200),
        left(p_message, 5000),
        left(p_browser, 300),
        left(p_app_version, 100)
    )
    returning id into _id;

    perform fv_idem_store(p_idempotency_key, 'submit_support_report', jsonb_build_object('id', _id));
    return _id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_report_block(p_course_id uuid, p_block_key text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _cur jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select blocks_config into _cur from report_config where course_id = p_course_id;
    _cur := coalesce(_cur, '{}'::jsonb) || jsonb_build_object(p_block_key, p_enabled);

    insert into report_config (course_id, preset, blocks_config)
    values (p_course_id, 'custom', _cur)
    on conflict (course_id) do update
       set preset = 'custom',
           blocks_config = _cur,
           updated_at = now();
end; $function$;

CREATE OR REPLACE FUNCTION public.unlock_all_student_cards(p_course_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
    _n      int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'unlock_all_student_cards');
    if _cached is not null then return _cached; end if;
    update student_card k set locked_at = null, wrong_tries = 0, wrong_times = '{}'
      from enrollment e
     where e.id = k.enrollment_id and e.course_id = p_course_id
       and k.stopped_at is null and k.locked_at is not null;
    get diagnostics _n = row_count;
    _cached := jsonb_build_object('unlocked', _n);
    perform fv_idem_store(p_idempotency_key, 'unlock_all_student_cards', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unlock_student_card(p_card_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'unlock_student_card');
    if _cached is not null then return _cached; end if;
    update student_card k set locked_at = null, wrong_tries = 0, wrong_times = '{}'
     where k.id = p_card_id and fv_owns_enrollment(k.enrollment_id);
    if not found then
        raise exception 'card not found' using errcode = 'P0002';
    end if;
    _cached := _student_card_json(p_card_id);
    perform fv_idem_store(p_idempotency_key, 'unlock_student_card', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_assessment(p_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update assessment set
        title         = coalesce(p_patch->>'title', title),
        description   = case when p_patch ? 'description'   then p_patch->>'description'   else description end,
        category_id   = case when p_patch ? 'category_id'
                             then nullif(p_patch->>'category_id','')::uuid else category_id end,
        date_assigned = case when p_patch ? 'date_assigned'
                             then nullif(p_patch->>'date_assigned','')::date else date_assigned end,
        due_date      = case when p_patch ? 'due_date'
                             then nullif(p_patch->>'due_date','')::date else due_date end,
        score_mode    = coalesce(p_patch->>'score_mode', score_mode),
        max_points    = case when p_patch ? 'max_points'
                             then nullif(p_patch->>'max_points','')::numeric else max_points end,
        weight        = coalesce((p_patch->>'weight')::numeric, weight),
        evidence_type = case when p_patch ? 'evidence_type' then p_patch->>'evidence_type' else evidence_type end,
        rubric_id     = case when p_patch ? 'rubric_id'
                             then nullif(p_patch->>'rubric_id','')::uuid else rubric_id end,
        module_id     = case when p_patch ? 'module_id'
                             then nullif(p_patch->>'module_id','')::uuid else module_id end,
        display_order = case when p_patch ? 'display_order'
                             then (p_patch->>'display_order')::int else display_order end,
        copy_group    = case when p_patch ? 'copy_group'
                             then nullif(p_patch->>'copy_group','')::uuid else copy_group end,
        core_competency_ids = case
                             when not (p_patch ? 'core_competency_ids') then core_competency_ids
                             when jsonb_typeof(p_patch->'core_competency_ids') = 'array'
                             then array(select distinct c
                                          from jsonb_array_elements_text(p_patch->'core_competency_ids') c
                                         order by c)
                             else '{}' end,
        updated_at    = now()
    where id = p_id;

    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    if p_tag_ids is not null then
        delete from assessment_tag where assessment_id = p_id;
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag)
            on conflict do nothing;
        end loop;
    end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.update_course(p_course_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course set
        name             = coalesce(p_patch->>'name',             name),
        grade_level      = coalesce(p_patch->>'grade_level',      grade_level),
        description      = case when p_patch ? 'description'
                                then p_patch->>'description'
                                else description end,
        color            = case when p_patch ? 'color'
                                then p_patch->>'color'
                                else color end,
        block            = case when p_patch ? 'block'
                                then nullif(btrim(p_patch->>'block'), '')
                                else block end,
        grading_system   = coalesce(p_patch->>'grading_system',   grading_system),
        calc_method      = coalesce(p_patch->>'calc_method',      calc_method),
        decay_weight     = case when p_patch ? 'decay_weight'
                                then (p_patch->>'decay_weight')::numeric
                                else decay_weight end,
        timezone         = coalesce(p_patch->>'timezone',         timezone),
        late_work_policy = case when p_patch ? 'late_work_policy'
                                then p_patch->>'late_work_policy'
                                else late_work_policy end,
        grading_scale    = case when p_patch ? 'grading_scale'
                                then nullif(p_patch->'grading_scale', 'null'::jsonb)
                                else grading_scale end,
        category_weights = case when p_patch ? 'category_weights'
                                then nullif(p_patch->'category_weights', 'null'::jsonb)
                                else category_weights end,
        round_percent    = case when p_patch ? 'round_percent'
                                then (p_patch->>'round_percent')::boolean
                                else round_percent end,
        reporting_terms  = case when p_patch ? 'reporting_terms'
                                then nullif(p_patch->'reporting_terms', 'null'::jsonb)
                                else reporting_terms end,
        recent_score_limit = case when p_patch ? 'recent_score_limit'
                                then (p_patch->>'recent_score_limit')::smallint
                                else recent_score_limit end,
        level_order      = coalesce(p_patch->>'level_order',      level_order),
        folders_count_as_one = case when p_patch ? 'folders_count_as_one'
                                then coalesce((p_patch->>'folders_count_as_one')::boolean, true)
                                else folders_count_as_one end,
        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
        student_page_enabled = case when p_patch ? 'student_page_enabled'
                                then coalesce((p_patch->>'student_page_enabled')::boolean, false)
                                else student_page_enabled end,
        return_grades    = case when p_patch ? 'return_grades'
                                then nullif(p_patch->>'return_grades', '')
                                else return_grades end,
        curriculum_tags  = case when p_patch ? 'curriculum_tags'
                                then case when jsonb_typeof(p_patch->'curriculum_tags') = 'array'
                                          then array(select jsonb_array_elements_text(p_patch->'curriculum_tags'))
                                          else null end
                                else curriculum_tags end,
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_enrollment(p_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _desig text[];
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_patch ? 'designations' and jsonb_typeof(p_patch->'designations') = 'array' then
        select array_agg(v #>> '{}') into _desig from jsonb_array_elements(p_patch->'designations') v;
    end if;

    update enrollment set
        designations    = case when p_patch ? 'designations' then coalesce(_desig, '{}') else designations end,
        is_flagged      = case when p_patch ? 'is_flagged' then (p_patch->>'is_flagged')::boolean else is_flagged end,
        roster_position = case when p_patch ? 'roster_position' then (p_patch->>'roster_position')::int else roster_position end,
        withdrawn_at    = case when p_patch ? 'withdrawn_at'
                               then nullif(p_patch->>'withdrawn_at', '')::timestamptz
                               else withdrawn_at end,
        updated_at      = now()
    where id = p_id;

    if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.update_observation(p_id uuid, p_patch jsonb, p_enrollment_ids uuid[] DEFAULT NULL::uuid[], p_tag_ids uuid[] DEFAULT NULL::uuid[], p_custom_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _x uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update observation set
        body          = coalesce(p_patch->>'body', body),
        sentiment     = case when p_patch ? 'sentiment'     then p_patch->>'sentiment'     else sentiment end,
        context_type  = case when p_patch ? 'context_type'  then p_patch->>'context_type'  else context_type end,
        assessment_id = case when p_patch ? 'assessment_id' then nullif(p_patch->>'assessment_id','')::uuid else assessment_id end,
        dims          = case when jsonb_typeof(p_patch->'dims') = 'array'
                             then array(select d from jsonb_array_elements_text(p_patch->'dims') with ordinality u(d, n)
                                         where nullif(d, '') is not null order by n)
                             else dims end,
        level         = case when p_patch ? 'level' then nullif(p_patch->>'level', '')::smallint else level end,
        updated_at    = now()
    where id = p_id;
    if not found then raise exception 'observation not found' using errcode = 'P0002'; end if;

    if p_enrollment_ids is not null then
        delete from observation_student where observation_id = p_id;
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        delete from observation_tag where observation_id = p_id;
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        delete from observation_custom_tag where observation_id = p_id;
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.update_phone_report(p_id uuid, p_students jsonb DEFAULT '[]'::jsonb, p_expires_on date DEFAULT NULL::date, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _r      phone_report%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'update_phone_report');
    if _cached is not null then
        return _cached;
    end if;
    select * into _r from phone_report where id = p_id and fv_owns_course(course_id) for update;
    if not found then
        raise exception 'report not found' using errcode = 'P0002';
    end if;
    perform _phone_report_put(_r.id, _r.course_id, coalesce(p_students, '[]'::jsonb));
    if p_expires_on is not null then
        if p_expires_on < current_date then
            raise exception 'the last day must be today or later' using errcode = '22023';
        end if;
        update phone_report set expires_on = p_expires_on where id = _r.id;
        update student_access_code set expires_at = (p_expires_on + 1)::timestamptz
         where phone_report_id = _r.id and revoked_at is null;
    end if;
    update phone_report set updated_at = now() where id = _r.id;
    _cached := _phone_report_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'update_phone_report', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_student(p_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update student set
        first_name     = coalesce(p_patch->>'first_name',     first_name),
        last_name      = case when p_patch ? 'last_name'      then p_patch->>'last_name'      else last_name end,
        preferred_name = case when p_patch ? 'preferred_name' then p_patch->>'preferred_name' else preferred_name end,
        pronouns       = case when p_patch ? 'pronouns'       then p_patch->>'pronouns'       else pronouns end,
        student_number = case when p_patch ? 'student_number' then p_patch->>'student_number' else student_number end,
        email          = case when p_patch ? 'email'          then p_patch->>'email'          else email end,
        date_of_birth  = case when p_patch ? 'date_of_birth'  then (p_patch->>'date_of_birth')::date else date_of_birth end,
        updated_at     = now()
    where id = p_id;

    if not found then raise exception 'student not found' using errcode = 'P0002'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_category(p_id uuid, p_course_id uuid, p_name text, p_weight numeric, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_category');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into category (course_id, name, weight, display_order)
        values (p_course_id, p_name, p_weight, coalesce(p_display_order, 0))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_category', jsonb_build_object('id', _id));
    else
        update category set
            name = p_name, weight = p_weight,
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
        where id = p_id returning id into _id;
        if _id is null then raise exception 'category not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_competency_group(p_id uuid, p_course_id uuid, p_name text, p_color text DEFAULT NULL::text, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid, p_counts_as_one boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_competency_group');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into competency_group (course_id, name, color, display_order, counts_as_one)
        values (p_course_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from competency_group where course_id = p_course_id)),
                coalesce(p_counts_as_one, true))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_competency_group', jsonb_build_object('id', _id));
    else
        update competency_group set name = p_name, color = p_color,
            display_order = coalesce(p_display_order, display_order),
            counts_as_one = coalesce(p_counts_as_one, counts_as_one),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'competency_group not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_core_self_assessment(p_enrollment_id uuid, p_core_id text, p_term_key text, p_level integer, p_body text, p_goal text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_level is not null and (p_level < 1 or p_level > 4) then
        raise exception 'level must be 1..4' using errcode = '22023';
    end if;
    -- Nothing left to keep: the self-assessment goes.
    if p_level is null and coalesce(btrim(p_body), '') = '' and coalesce(btrim(p_goal), '') = '' then
        delete from core_self_assessment
         where enrollment_id = p_enrollment_id
           and core_id = p_core_id
           and term_key = coalesce(p_term_key, '');
        return null;
    end if;
    insert into core_self_assessment (enrollment_id, core_id, term_key, level, body, goal)
    values (p_enrollment_id, p_core_id, coalesce(p_term_key, ''), p_level,
            nullif(btrim(p_body), ''), nullif(btrim(p_goal), ''))
    on conflict (enrollment_id, core_id, term_key) do update
       set level = excluded.level, body = excluded.body, goal = excluded.goal, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_dibels_score(p_enrollment_id uuid, p_assessment_id uuid, p_period text, p_orf_wrc integer, p_orf_errors integer, p_maze_correct integer, p_maze_incorrect integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _mode text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_period is null or p_period not in ('boy', 'moy', 'eoy') then
        raise exception 'p_period must be boy, moy or eoy' using errcode = '22023';
    end if;
    select score_mode into _mode from assessment where id = p_assessment_id;
    if _mode is distinct from 'dibels' then
        raise exception 'dibels_score is only for DIBELS assessments' using errcode = '22023';
    end if;

    if p_orf_wrc is null and p_orf_errors is null and p_maze_correct is null and p_maze_incorrect is null then
        delete from dibels_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and period = p_period;
        return null;
    end if;

    insert into dibels_score (enrollment_id, assessment_id, period, orf_wrc, orf_errors, maze_correct, maze_incorrect)
    values (p_enrollment_id, p_assessment_id, p_period, p_orf_wrc, p_orf_errors, p_maze_correct, p_maze_incorrect)
    on conflict (enrollment_id, assessment_id, period) do update
       set orf_wrc = excluded.orf_wrc,
           orf_errors = excluded.orf_errors,
           maze_correct = excluded.maze_correct,
           maze_incorrect = excluded.maze_incorrect,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_goal(p_enrollment_id uuid, p_section_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into goal (enrollment_id, section_id, body)
    values (p_enrollment_id, p_section_id, p_body)
    on conflict (enrollment_id, section_id) do update
       set body = excluded.body, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_guardian(p_student_id uuid, p_name text, p_relationship text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_language text DEFAULT 'en'::text, p_consent_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_consent_source text DEFAULT NULL::text, p_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _row    guardian%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'upsert_guardian');
    if _cached is not null then
        return _cached;
    end if;

    if not exists (select 1 from student s where s.id = p_student_id and s.teacher_id = (select auth.uid())) then
        raise exception 'student not found' using errcode = 'P0002';
    end if;

    if p_id is not null then
        update guardian
           set name = btrim(p_name),
               relationship = nullif(btrim(coalesce(p_relationship, '')), ''),
               email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
               phone = nullif(btrim(coalesce(p_phone, '')), ''),
               language = coalesce(nullif(btrim(p_language), ''), 'en'),
               consent_at = p_consent_at,
               consent_source = p_consent_source,
               updated_at = now()
         where id = p_id and student_id = p_student_id
        returning * into _row;
        if not found then
            raise exception 'guardian not found' using errcode = 'P0002';
        end if;
    else
        insert into guardian (student_id, name, relationship, email, phone, language, consent_at, consent_source)
        values (p_student_id, btrim(p_name),
                nullif(btrim(coalesce(p_relationship, '')), ''),
                nullif(lower(btrim(coalesce(p_email, ''))), ''),
                nullif(btrim(coalesce(p_phone, '')), ''),
                coalesce(nullif(btrim(p_language), ''), 'en'),
                p_consent_at, p_consent_source)
        returning * into _row;
    end if;

    _cached := to_jsonb(_row);
    perform fv_idem_store(p_idempotency_key, 'upsert_guardian', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_module(p_id uuid, p_course_id uuid, p_name text, p_color text DEFAULT NULL::text, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_module');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into module (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color, coalesce(p_display_order, 0))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_module', jsonb_build_object('id', _id));
    else
        update module set name = p_name, color = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
        where id = p_id returning id into _id;
        if _id is null then raise exception 'module not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_note(p_enrollment_id uuid, p_body text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _id     uuid;
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'upsert_note');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    insert into note (enrollment_id, body)
    values (p_enrollment_id, p_body)
    returning id into _id;

    perform fv_idem_store(p_idempotency_key, 'upsert_note', jsonb_build_object('id', _id));
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_observation_template(p_id uuid, p_course_id uuid, p_body text, p_default_sentiment text DEFAULT NULL::text, p_default_context_type text DEFAULT NULL::text, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid, p_default_dims text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- p_course_id is unused: starters belong to the teacher (20261022_teacher_sentence_starters.sql).
declare _id uuid; _cached jsonb; _me uuid := (select auth.uid());
begin
    if _me is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_observation_template');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into observation_template (teacher_id, course_id, body, default_sentiment,
                                          default_context_type, default_dims, is_seed, display_order)
        values (_me, null, p_body, p_default_sentiment, p_default_context_type,
                coalesce(p_default_dims, '{}'::text[]), false,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from observation_template where teacher_id = _me)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_observation_template', jsonb_build_object('id', _id));
    else
        update observation_template set
            body = p_body, default_sentiment = p_default_sentiment,
            default_context_type = p_default_context_type,
            default_dims = coalesce(p_default_dims, default_dims),
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id and is_seed = false
        returning id into _id;
        if _id is null then
            raise exception 'observation_template not found or is seed (immutable)' using errcode = 'P0002';
        end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_questionnaire(p_course_id uuid, p_kind text, p_title text, p_template_id text DEFAULT NULL::text, p_theme text DEFAULT NULL::text, p_report_period integer DEFAULT NULL::integer, p_parent_id uuid DEFAULT NULL::uuid, p_opens_on date DEFAULT NULL::date, p_closes_on date DEFAULT NULL::date, p_is_on boolean DEFAULT true, p_myed_comment text DEFAULT NULL::text, p_questions jsonb DEFAULT NULL::jsonb, p_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _id     uuid;
    _tpl    questionnaire_template%rowtype;
    _qs     jsonb := p_questions;
    _keep   uuid[] := '{}';
    _item   jsonb;
    _qid    uuid;
    _n      integer := 0;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'upsert_questionnaire');
    if _cached is not null then
        return _cached;
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    if p_template_id is not null then
        select * into _tpl from questionnaire_template where id = p_template_id;
        if not found then
            raise exception 'template not found' using errcode = 'P0002';
        end if;
    end if;
    if p_parent_id is not null and not exists (
        select 1 from questionnaire where id = p_parent_id and course_id = p_course_id) then
        raise exception 'parent questionnaire not found' using errcode = 'P0002';
    end if;

    if p_id is null then
        insert into questionnaire (course_id, template_id, kind, title, theme, report_period, parent_id,
                                   opens_on, closes_on, is_on, myed_comment)
        values (p_course_id, p_template_id, p_kind, btrim(p_title),
                coalesce(p_theme, _tpl.theme), p_report_period, p_parent_id, p_opens_on, p_closes_on,
                coalesce(p_is_on, true), coalesce(p_myed_comment, _tpl.myed_comment))
        returning id into _id;
        if _qs is null and p_template_id is not null then
            _qs := _tpl.questions;
        end if;
    else
        update questionnaire
           set kind = p_kind, title = btrim(p_title), template_id = p_template_id, theme = p_theme,
               report_period = p_report_period, parent_id = p_parent_id, opens_on = p_opens_on,
               closes_on = p_closes_on, is_on = coalesce(p_is_on, true), myed_comment = p_myed_comment,
               updated_at = now()
         where id = p_id and course_id = p_course_id
        returning id into _id;
        if not found then
            raise exception 'questionnaire not found' using errcode = 'P0002';
        end if;
    end if;

    if _qs is not null then
        if jsonb_typeof(_qs) <> 'array' then
            raise exception 'questions must be an array' using errcode = '22023';
        end if;
        for _item in select value from jsonb_array_elements(_qs) loop
            _n := _n + 1;
            _qid := nullif(_item->>'id', '')::uuid;
            if _qid is not null then
                update question
                   set display_order = _n, prompt = btrim(_item->>'prompt'), kind = _item->>'kind',
                       options = coalesce(_item->'options', '{}'::jsonb),
                       core_ids = coalesce(array(select jsonb_array_elements_text(_item->'core_ids')), '{}'),
                       repeated_key = nullif(_item->>'repeated_key', ''),
                       teacher_only = coalesce((_item->>'teacher_only')::boolean, false),
                       prompt_translations = coalesce(_item->'prompt_translations', '{}'::jsonb),
                       archived = false, updated_at = now()
                 where id = _qid and questionnaire_id = _id;
                if not found then
                    _qid := null;
                end if;
            end if;
            if _qid is null then
                insert into question (questionnaire_id, display_order, prompt, kind, options, core_ids,
                                      repeated_key, teacher_only, prompt_translations)
                values (_id, _n, btrim(_item->>'prompt'), _item->>'kind', coalesce(_item->'options', '{}'::jsonb),
                        coalesce(array(select jsonb_array_elements_text(_item->'core_ids')), '{}'),
                        nullif(_item->>'repeated_key', ''), coalesce((_item->>'teacher_only')::boolean, false),
                        coalesce(_item->'prompt_translations', '{}'::jsonb))
                returning id into _qid;
            end if;
            _keep := _keep || _qid;
        end loop;
        update question q set archived = true, updated_at = now()
         where q.questionnaire_id = _id and not (q.id = any(_keep)) and not q.archived
           and exists (select 1 from answer a where a.question_id = q.id);
        delete from question q
         where q.questionnaire_id = _id and not (q.id = any(_keep))
           and not exists (select 1 from answer a where a.question_id = q.id);
    end if;

    _cached := _questionnaire_json(_id);
    perform fv_idem_store(p_idempotency_key, 'upsert_questionnaire', _cached);
    return _cached;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_reflection(p_enrollment_id uuid, p_section_id uuid, p_body text, p_confidence integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_confidence is not null and (p_confidence < 1 or p_confidence > 5) then
        raise exception 'confidence must be 1..5' using errcode = '22023';
    end if;
    insert into reflection (enrollment_id, section_id, body, confidence)
    values (p_enrollment_id, p_section_id, p_body, p_confidence)
    on conflict (enrollment_id, section_id) do update
       set body = excluded.body, confidence = excluded.confidence, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_rubric(p_id uuid, p_course_id uuid, p_name text, p_criteria jsonb, p_copy_group uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_style text DEFAULT NULL::text, p_linked_tag_ids jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _rubric_id   uuid;
    _elem        jsonb;
    _crit_id     uuid;
    _kept_ids    uuid[] := '{}';
    _tag_id      uuid;
    _cached      jsonb;
    _is_insert   boolean := false;
    _check       jsonb;
    _check_id    uuid;
    _kept_checks uuid[];
    _level       int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
        raise exception 'p_criteria must be a jsonb array' using errcode = '22023';
    end if;

    if p_style is not null and p_style not in ('standard', 'advanced', 'single_point') then
        raise exception 'p_style must be standard, advanced or single_point' using errcode = '22023';
    end if;

    if p_linked_tag_ids is not null and jsonb_typeof(p_linked_tag_ids) <> 'array' then
        raise exception 'p_linked_tag_ids must be a jsonb array' using errcode = '22023';
    end if;

    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_rubric');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;
        _is_insert := true;

        insert into rubric (course_id, name, copy_group, style)
        values (p_course_id, p_name, p_copy_group, coalesce(p_style, 'standard'))
        returning id into _rubric_id;
    else
        -- A copy group is only ever set, never cleared, by a save. A save
        -- that names no style keeps the rubric's.
        update rubric set name = p_name, copy_group = coalesce(p_copy_group, copy_group),
                          style = coalesce(p_style, style), updated_at = now()
         where id = p_id
        returning id into _rubric_id;

        if _rubric_id is null then
            raise exception 'rubric not found' using errcode = 'P0002';
        end if;
    end if;

    for _elem in select * from jsonb_array_elements(p_criteria) loop
        if _elem ? 'id' and nullif(_elem->>'id','') is not null then
            _crit_id := (_elem->>'id')::uuid;

            update criterion set
                name               = _elem->>'name',
                level_4_descriptor = _elem->>'level_4_descriptor',
                level_3_descriptor = _elem->>'level_3_descriptor',
                level_2_descriptor = _elem->>'level_2_descriptor',
                level_1_descriptor = _elem->>'level_1_descriptor',
                level_4_value      = coalesce((_elem->>'level_4_value')::numeric, 4),
                level_3_value      = coalesce((_elem->>'level_3_value')::numeric, 3),
                level_2_value      = coalesce((_elem->>'level_2_value')::numeric, 2),
                level_1_value      = coalesce((_elem->>'level_1_value')::numeric, 1),
                weight             = coalesce((_elem->>'weight')::numeric, 1.0),
                display_order      = coalesce((_elem->>'display_order')::int, 0),
                updated_at         = now()
            where id = _crit_id and rubric_id = _rubric_id;

            if not found then
                raise exception 'criterion % not in rubric %', _crit_id, _rubric_id
                    using errcode = 'P0002';
            end if;
        else
            insert into criterion (
                rubric_id, name,
                level_4_descriptor, level_3_descriptor,
                level_2_descriptor, level_1_descriptor,
                level_4_value, level_3_value, level_2_value, level_1_value,
                weight, display_order
            ) values (
                _rubric_id,
                _elem->>'name',
                _elem->>'level_4_descriptor', _elem->>'level_3_descriptor',
                _elem->>'level_2_descriptor', _elem->>'level_1_descriptor',
                coalesce((_elem->>'level_4_value')::numeric, 4),
                coalesce((_elem->>'level_3_value')::numeric, 3),
                coalesce((_elem->>'level_2_value')::numeric, 2),
                coalesce((_elem->>'level_1_value')::numeric, 1),
                coalesce((_elem->>'weight')::numeric, 1.0),
                coalesce((_elem->>'display_order')::int, 0)
            ) returning id into _crit_id;
        end if;

        _kept_ids := _kept_ids || _crit_id;

        delete from criterion_tag where criterion_id = _crit_id;
        if _elem ? 'linked_tag_ids' and jsonb_typeof(_elem->'linked_tag_ids') = 'array' then
            for _tag_id in
                select (v #>> '{}')::uuid
                  from jsonb_array_elements(_elem->'linked_tag_ids') v
            loop
                insert into criterion_tag (criterion_id, tag_id)
                values (_crit_id, _tag_id)
                on conflict do nothing;
            end loop;
        end if;

        -- Advanced Rubrics: the checkboxes in each level cell. A known id is
        -- updated so its ticks (rubric_check_score) survive a relabel; any
        -- other is a new row; rows left out are deleted with their ticks.
        if _elem ? 'checks' and jsonb_typeof(_elem->'checks') = 'array' then
            _kept_checks := '{}';
            for _check in select * from jsonb_array_elements(_elem->'checks') loop
                _level := (_check->>'level')::int;
                if _level is null or _level < 1 or _level > 4 then
                    raise exception 'check level must be 1..4' using errcode = '22023';
                end if;
                _check_id := null;
                if _check ? 'id' and nullif(_check->>'id','') is not null then
                    update criterion_check set
                        level         = _level,
                        label         = coalesce(_check->>'label', ''),
                        display_order = coalesce((_check->>'display_order')::int, 0),
                        updated_at    = now()
                     where id = (_check->>'id')::uuid and criterion_id = _crit_id
                    returning id into _check_id;
                end if;
                if _check_id is null then
                    insert into criterion_check (criterion_id, level, label, display_order)
                    values (_crit_id, _level, coalesce(_check->>'label', ''),
                            coalesce((_check->>'display_order')::int, 0))
                    returning id into _check_id;
                end if;
                _kept_checks := _kept_checks || _check_id;
            end loop;
            delete from criterion_check
             where criterion_id = _crit_id
               and id <> all (_kept_checks);
        end if;
    end loop;

    delete from criterion
     where rubric_id = _rubric_id
       and id <> all (_kept_ids);

    -- Competencies the whole rubric scores. Null keeps them; an array
    -- replaces them.
    if p_linked_tag_ids is not null then
        delete from rubric_tag where rubric_id = _rubric_id;
        insert into rubric_tag (rubric_id, tag_id)
        select _rubric_id, (v #>> '{}')::uuid
          from jsonb_array_elements(p_linked_tag_ids) v
        on conflict do nothing;
    end if;

    if _is_insert then
        perform fv_idem_store(p_idempotency_key, 'upsert_rubric', jsonb_build_object('id', _rubric_id));
    end if;
    return _rubric_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_rubric_score(p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid, p_value integer, p_modifier smallint DEFAULT 0, p_comment text DEFAULT NULL::text, p_beyond text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.upsert_score(p_enrollment_id uuid, p_assessment_id uuid, p_value numeric, p_modifier smallint DEFAULT NULL::smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.upsert_section(p_id uuid, p_subject_id uuid, p_name text, p_color text DEFAULT NULL::text, p_competency_group_id uuid DEFAULT NULL::uuid, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _course_id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select course_id into _course_id from subject where id = p_subject_id;
    if _course_id is null then raise exception 'subject not found' using errcode = 'P0002'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_section');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into section (course_id, subject_id, competency_group_id, name, color, display_order)
        values (_course_id, p_subject_id, p_competency_group_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from section where subject_id = p_subject_id)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_section', jsonb_build_object('id', _id));
    else
        update section set
            subject_id = p_subject_id, course_id = _course_id,
            competency_group_id = p_competency_group_id,
            name = p_name, color = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'section not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_section_override(p_enrollment_id uuid, p_section_id uuid, p_level integer, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_level < 1 or p_level > 4 then
        raise exception 'level must be 1..4' using errcode = '22023';
    end if;
    insert into section_override (enrollment_id, section_id, level, reason)
    values (p_enrollment_id, p_section_id, p_level, p_reason)
    on conflict (enrollment_id, section_id) do update
       set level = excluded.level, reason = excluded.reason, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_subject(p_id uuid, p_course_id uuid, p_name text, p_color text DEFAULT NULL::text, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_subject');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into subject (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from subject where course_id = p_course_id)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_subject', jsonb_build_object('id', _id));
    else
        update subject set name = p_name, color = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'subject not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_tag(p_id uuid, p_section_id uuid, p_label text, p_code text DEFAULT NULL::text, p_i_can_text text DEFAULT NULL::text, p_display_order integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid, p_i_can_statements text[] DEFAULT NULL::text[], p_source_text text DEFAULT NULL::text, p_bank_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_tag');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into tag (section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values (p_section_id, p_code, p_label, p_i_can_text, coalesce(p_i_can_statements, '{}'), p_source_text, p_bank_id,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from tag where section_id = p_section_id)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_tag', jsonb_build_object('id', _id));
    else
        update tag set
            section_id = p_section_id, code = p_code, label = p_label,
            i_can_text = p_i_can_text,
            i_can_statements = coalesce(p_i_can_statements, i_can_statements),
            source_text = coalesce(p_source_text, source_text),
            bank_id = coalesce(p_bank_id, bank_id),
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'tag not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.upsert_tag_score(p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid, p_value integer, p_modifier smallint DEFAULT 0, p_comment text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.withdraw_student(p_enrollment_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _at     timestamptz;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'withdraw_student');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    update enrollment
       set withdrawn_at = coalesce(withdrawn_at, now()),
           updated_at = now()
     where id = p_enrollment_id
    returning withdrawn_at into _at;

    if not found then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('enrollment_id', p_enrollment_id, 'withdrawn_at', _at);
    perform fv_idem_store(p_idempotency_key, 'withdraw_student', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._as_teacher(p_teacher_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
begin
    if p_teacher_id is null
       or not exists (select 1 from teacher t where t.id = p_teacher_id and t.deleted_at is null) then
        raise exception 'not a teacher' using errcode = 'PT401';
    end if;
    perform set_config('request.jwt.claim.sub', p_teacher_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_teacher_id, 'role', 'authenticated')::text, true);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._card_key_seen(p_key_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
begin
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    if exists (select 1 from card_key where key_id = p_key_id) then
        return;
    end if;
    insert into card_key (one, key_id) values (true, p_key_id)
    on conflict (one) do update set key_id = excluded.key_id, seen_at = now()
     where card_key.key_id <> excluded.key_id;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._card_listed(p_questionnaire_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select exists (select 1 from student_access_code c
                    where c.questionnaire_id = p_questionnaire_id and c.enrollment_id = p_enrollment_id
                      and c.revoked_at is null)
        or exists (select 1 from response r
                    where r.questionnaire_id = p_questionnaire_id and r.enrollment_id = p_enrollment_id);
$function$;

CREATE OR REPLACE FUNCTION student_submit._card_lookup(p_code_hmac text, p_key_id text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _k   student_card%rowtype;
    _why text;
begin
    -- A tag is 64 lower-case hex characters. Anything else is a bug in the
    -- caller, not a student's guess: fail, and log nothing.
    if coalesce(p_code_hmac, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed code tag' using errcode = '22023';
    end if;
    perform _card_key_seen(p_key_id);

    -- Housekeeping on every scan, each an index range that is nearly always
    -- empty: sessions past their midnight, and log rows past 30 days (a
    -- slip's open() does the same for the log, one scan in fifty).
    delete from device_session where expires_at < now();
    delete from attempt where at < now() - interval '30 days';

    -- A school's students share one address, so the limit is generous and
    -- counts only codes that were not found (a guess).
    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'card' and outcome in ('not_found', 'bad_format', 'ambiguous')
           and at > now() - interval '15 minutes') >= 300 then
        perform _log('card', 'locked', p_ip_hash);
        return jsonb_build_object('error', 'locked');
    end if;

    -- The card with this tag, live or stopped, through the unique index on
    -- tags: one row read, however many cards there are.
    select * into _k from student_card where code_hmac = p_code_hmac;
    if _k.id is null then
        perform _log('card', 'not_found', p_ip_hash);
        return jsonb_build_object('error', 'not_found');
    end if;

    -- A stopped card says so (card_stopped). It is a real card that was
    -- replaced, not a guess, so it is logged with its id and counts toward
    -- no limit.
    _why := _card_refusal(_k.id);
    if _why is not null then
        perform _log('card', _why, p_ip_hash, _k.id,
                     (select e.course_id from enrollment e where e.id = _k.enrollment_id));
        return jsonb_build_object('error', _why);
    end if;
    if _k.locked_at is not null then
        perform _log('card', 'card_locked', p_ip_hash, _k.id,
                     (select e.course_id from enrollment e where e.id = _k.enrollment_id));
        return jsonb_build_object('error', 'card_locked');
    end if;
    return jsonb_build_object('card_id', _k.id);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._card_refusal(p_card_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select case
               when k.stopped_at is not null then 'card_stopped'
               when c.deleted_at is not null or e.withdrawn_at is not null then 'not_found'
               when not c.student_page_enabled then 'closed'
               when (now() at time zone public._fv_timezone(c.timezone))::date > k.works_until then 'card_expired'
           end
      from student_card k
      join enrollment e on e.id = k.enrollment_id
      join course c on c.id = e.course_id
     where k.id = p_card_id;
$function$;

CREATE OR REPLACE FUNCTION student_submit._clean_answer(p_kind text, p_options jsonb, p_core_ids text[], p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _t      text;
    _arr    jsonb := '[]'::jsonb;
    _e      jsonb;
    _k      text;
    _n      int;
    _levels jsonb := '{}'::jsonb;
    _why    jsonb;
    _whys   jsonb := '{}'::jsonb;
begin
    if p_value is null or p_value = 'null'::jsonb then return null; end if;
    if p_kind = 'text' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := btrim(p_value #>> '{}');
        if _t = '' then return null; end if;
        if char_length(_t) > 2000 then raise exception 'invalid'; end if;
        return jsonb_build_object('text', _t);
    elsif p_kind = 'short_set' then
        if jsonb_typeof(p_value) <> 'array'
           or jsonb_array_length(p_value) > greatest(jsonb_array_length(coalesce(p_options->'labels', '[]')), 1) then
            raise exception 'invalid';
        end if;
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' or char_length(_e #>> '{}') > 300 then raise exception 'invalid'; end if;
            _arr := _arr || to_jsonb(btrim(_e #>> '{}'));
        end loop;
        if not exists (select 1 from jsonb_array_elements_text(_arr) v where v <> '') then return null; end if;
        return jsonb_build_object('json', _arr,
               'text', (select string_agg(v, ' · ') from jsonb_array_elements_text(_arr) v where v <> ''));
    elsif p_kind = 'choice' then
        if jsonb_typeof(p_value) = 'string' then p_value := jsonb_build_array(p_value); end if;
        if jsonb_typeof(p_value) <> 'array' then raise exception 'invalid'; end if;
        -- Listed choices, plus typed-in ones (60 characters each) when the
        -- question allows another.
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' then raise exception 'invalid'; end if;
            _t := btrim(_e #>> '{}');
            continue when _t = '' or _arr ? _t;
            if not (coalesce(p_options->'choices', '[]') ? _t)
               and (coalesce(p_options->>'other', '') <> 'true' or char_length(_t) > 60) then
                raise exception 'invalid';
            end if;
            _arr := _arr || to_jsonb(_t);
        end loop;
        if jsonb_array_length(_arr) = 0 then return null; end if;
        if jsonb_array_length(_arr) > 20
           or ((p_options->>'multiple') = 'false' and jsonb_array_length(_arr) > 1) then
            raise exception 'invalid';
        end if;
        return jsonb_build_object('json', _arr,
               'text', (select string_agg(v, ', ') from jsonb_array_elements_text(_arr) v));
    elsif p_kind = 'scale4' then
        -- {levels: {PAR: 3, PPI: 2}, why: {PAR: '…', PPI: '…'}} on Core
        -- Competencies (why may also be one string), or {level: 3, why: '…'}.
        if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid'; end if;
        _why := coalesce(p_value->'why', 'null'::jsonb);
        if jsonb_typeof(_why) = 'string' then
            _t := nullif(btrim(_why #>> '{}'), '');
            if char_length(coalesce(_t, '')) > 2000 then raise exception 'invalid'; end if;
        elsif jsonb_typeof(_why) = 'object' and cardinality(p_core_ids) > 0 then
            for _k, _e in select * from jsonb_each(_why) loop
                if not (_k = any(p_core_ids)) or jsonb_typeof(_e) <> 'string' or char_length(_e #>> '{}') > 1000 then
                    raise exception 'invalid';
                end if;
                if btrim(_e #>> '{}') <> '' then
                    _whys := _whys || jsonb_build_object(_k, btrim(_e #>> '{}'));
                end if;
            end loop;
        elsif _why <> 'null'::jsonb then
            raise exception 'invalid';
        end if;
        if cardinality(p_core_ids) > 0 then
            if jsonb_typeof(coalesce(p_value->'levels', '{}')) <> 'object' then raise exception 'invalid'; end if;
            for _k, _e in select * from jsonb_each(coalesce(p_value->'levels', '{}')) loop
                if not (_k = any(p_core_ids)) or jsonb_typeof(_e) <> 'number'
                   or (_e #>> '{}')::numeric not in (1, 2, 3, 4) then
                    raise exception 'invalid';
                end if;
                _levels := _levels || jsonb_build_object(_k, (_e #>> '{}')::int);
            end loop;
            if _levels = '{}'::jsonb and _t is null and _whys = '{}'::jsonb then return null; end if;
            return jsonb_build_object(
                'json', jsonb_build_object('levels', _levels)
                        || case when _whys <> '{}'::jsonb then jsonb_build_object('why', _whys)
                                when _t is not null then jsonb_build_object('why', _t)
                                else '{}'::jsonb end,
                'text', coalesce(_t, (select string_agg(v, ' · ') from jsonb_each_text(_whys) w(k, v))));
        end if;
        if p_value ? 'level' then
            if jsonb_typeof(p_value->'level') <> 'number' or (p_value->>'level')::numeric not in (1, 2, 3, 4) then
                raise exception 'invalid';
            end if;
            _n := (p_value->>'level')::int;
        end if;
        if _n is null and _t is null then return null; end if;
        return jsonb_build_object('num', _n, 'text', _t);
    elsif p_kind = 'goal_status' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := p_value #>> '{}';
        select i into _n from jsonb_array_elements_text(coalesce(p_options->'choices', '[]')) with ordinality c(v, i)
         where v = _t;
        if _n is null then raise exception 'invalid'; end if;
        return jsonb_build_object('num', _n, 'text', _t);
    elsif p_kind = 'core_pick' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := p_value #>> '{}';
        if not (_t = any(case when cardinality(p_core_ids) > 0 then p_core_ids
                              else array['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR'] end)) then
            raise exception 'invalid';
        end if;
        return jsonb_build_object('text', _t);
    end if;
    raise exception 'invalid';
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._closed_reason(p_q public.questionnaire, p_tz text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _today date := (now() at time zone coalesce(nullif(p_tz, ''), 'America/Vancouver'))::date;
begin
    if not p_q.is_on then return 'closed'; end if;
    if p_q.opens_on is not null and _today < p_q.opens_on then return 'not_open_yet'; end if;
    if p_q.closes_on is not null and _today > p_q.closes_on then return 'closed'; end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._device_session(p_token text)
 RETURNS student_submit.device_session
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select d.* from device_session d
     where coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
       and d.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       and d.expires_at > now();
$function$;

CREATE OR REPLACE FUNCTION student_submit._grading_started(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select coalesce((select g.is_draft or g.returned_at is not null
                       from grade_return g
                      where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
                        -- a DIBELS benchmark has no Draft and no Returned (2026110905)
                        and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels')), false)
        -- Mark Up (2026111120): the teacher's marks on a page of this student's work for the piece
        or exists (select 1 from markup m
                    where m.enrollment_id = p_enrollment_id and m.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) > 0)
        -- Mark Up kept after Keep Photos Until took its photos (2026111140)
        or exists (select 1 from markup_kept k
                    where k.enrollment_id = p_enrollment_id and k.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(k.working->'marks', '[]'::jsonb)) > 0);
$function$;

CREATE OR REPLACE FUNCTION student_submit._group_members(p_assessment_id uuid, p_enrollment_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select (select array_agg(e.id order by e.id)
              from jsonb_array_elements_text(g.grp) m
              join enrollment e on e.id::text = lower(m) and e.course_id = a.course_id and e.withdrawn_at is null)
      from assessment a
     cross join lateral (
         select x as grp
           from jsonb_array_elements(case when jsonb_typeof(a.collab_config->(case a.collab_mode when 'pairs' then 'pairs' else 'groups' end)) = 'array'
                                          then a.collab_config->(case a.collab_mode when 'pairs' then 'pairs' else 'groups' end)
                                          else '[]'::jsonb end) x
          where jsonb_typeof(x) = 'array'
            and exists (select 1 from jsonb_array_elements_text(x) m where lower(m) = p_enrollment_id::text)
          limit 1) g
     where a.id = p_assessment_id and a.group_work = 'group' and a.collab_mode in ('pairs', 'groups');
$function$;

CREATE OR REPLACE FUNCTION student_submit._log(p_route text, p_outcome text, p_ip_hash text, p_code_id uuid DEFAULT NULL::uuid, p_course_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
  insert into student_submit.attempt (route, outcome, ip_hash, code_id, course_id)
  values (p_route, p_outcome, left(p_ip_hash, 128), p_code_id, p_course_id);
$function$;

CREATE OR REPLACE FUNCTION student_submit._midnight(p_tz text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select (((now() at time zone public._fv_timezone(p_tz))::date + 1)::timestamp
            at time zone public._fv_timezone(p_tz));
$function$;

CREATE OR REPLACE FUNCTION student_submit._norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $function$;

CREATE OR REPLACE FUNCTION student_submit._part(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
  select jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'title', q.title, 'theme', q.theme, 'closes_on', q.closes_on,
           'grade', (select t.grade from questionnaire_template t where t.id = q.template_id),
           'questions', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', x.id, 'prompt', x.prompt, 'prompt_translations', x.prompt_translations,
                      'kind', x.kind, 'options', x.options, 'core_ids', to_jsonb(x.core_ids),
                      'teacher_only', x.teacher_only)
                    order by x.display_order, x.created_at)
               from question x
              where x.questionnaire_id = q.id and not x.archived), '[]'::jsonb))
    from questionnaire q
   where q.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION student_submit._payload(p_code_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _child  questionnaire%rowtype;
    _course course%rowtype;
    _parts  jsonb;
    _ctx    jsonb := '{}'::jsonb;
begin
    select * into _c from student_access_code where id = p_code_id;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;

    _parts := jsonb_build_array(_part(_q.id));
    -- A Goal Check-In rides on its reflection's slip.
    for _child in
        select * from questionnaire
         where parent_id = _q.id and kind = 'goal_checkin' and is_on
         order by created_at
    loop
        if _closed_reason(_child, _course.timezone) is null then
            _parts := _parts || jsonb_build_array(_part(_child.id));
        end if;
    end loop;

    -- The Goal Check-In shows the course goal the student last wrote in About
    -- Me (their own words, back to the holder of their own slip).
    if exists (select 1 from jsonb_array_elements(_parts) p where p->>'kind' = 'goal_checkin') then
        select jsonb_build_object('course_goal', jsonb_build_object('text', a.value_text, 'at', r.submitted_at))
          into _ctx
          from answer a
          join question x on x.id = a.question_id
          join response r on r.id = a.response_id
          join questionnaire q2 on q2.id = r.questionnaire_id
         where r.enrollment_id = _c.enrollment_id and q2.course_id = _q.course_id
           and x.repeated_key = 'better_at' and nullif(btrim(a.value_text), '') is not null
         order by r.submitted_at desc
         limit 1;
    end if;

    return jsonb_build_object('parts', _parts, 'context', coalesce(_ctx, '{}'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._preview(p_code_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'count',
               (select count(*) from question x where x.questionnaire_id = q.id and not x.archived
                  and not coalesce(x.teacher_only, false)))
             order by q.parent_id nulls first, q.created_at), '[]'::jsonb)
      from student_access_code c
      join questionnaire p on p.id = c.questionnaire_id
      join course co on co.id = p.course_id
      join questionnaire q on q.id = p.id
         or (q.parent_id = p.id and q.kind = 'goal_checkin' and q.is_on
             and student_submit._closed_reason(q, co.timezone) is null)
     where c.id = p_code_id
$function$;

CREATE OR REPLACE FUNCTION student_submit._returned_grade(p_enrollment_id uuid, p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'status', s.status,
               'returned_at', g.returned_at,
               'updated_at', g.updated_at,
               'seen_at', g.seen_at,
               -- Missing and Excused win at once: no result is sent while
               -- either is on the piece, whatever was returned before.
               -- Otherwise only the part the work's scoring uses now, so the
               -- student page never sees a row the teacher's screens hide.
               'grade', case when s.status in ('NS', 'EXC') then null else public._grade_copy_in_use(
                            case when g.returned_at is null then null
                                 when g.is_draft then g.returned_copy
                                 else public._grade_copy(p_enrollment_id, p_assessment_id) end, p_assessment_id) end,
               'previous', case when s.status in ('NS', 'EXC') then null else public._grade_copy_in_use(
                            case when g.returned_at is not null then g.previous_copy end, p_assessment_id) end)
      from (select 1) one
      left join score s on s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id
      left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
           -- a DIBELS benchmark is a reading record, not a grade that is returned: a row it
           -- has from before it was DIBELS is not read (2026110905)
           and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels');
$function$;

CREATE OR REPLACE FUNCTION student_submit._send_begin(p_intent text, p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb, p_note text, p_followed_plan text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb;
    _course  course%rowtype;
    _a       assessment%rowtype;
    _w       jsonb;
    _card    uuid;
    _sub     submission%rowtype;
    _sent    submission%rowtype;
    _expired boolean;
    _n       int;
    _oldest  timestamptz;
    _theirs  int;
    _full    jsonb;
    _id      uuid;
begin
    -- The request's shape, before anything is read. A wrong shape is the
    -- caller's bug, not something a student did: the call fails.
    if p_request_id is null then
        raise exception 'a request id is needed' using errcode = '22023';
    end if;
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    perform public._work_check_pages(p_pages);
    if char_length(coalesce(p_note, '')) > 1000 then
        raise exception 'the note is over 1000 characters' using errcode = '22023';
    end if;
    if p_followed_plan is not null and p_followed_plan not in ('yes', 'partly', 'no') then
        raise exception 'followed_plan must be yes, partly or no' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _card := (_in->>'card_id')::uuid;

    -- The class's lock, first: this call has written nothing yet. Every
    -- change to a submission is made under it, so two sends, an Unsend, the
    -- teacher's Add Work and a grade being saved take turns.
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

    -- Is this a repeat of a send that has lost its place? Looked at before
    -- the class's expired sends are dropped, this one among them.
    _expired := exists (select 1 from submission
                         where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and sent_by = 'student'
                           and request_id = p_request_id and state = 'sending'
                           and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);

    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;
    _w := _work_window(_a.id);
    if _a.id is null or not (_w->>'listed')::boolean then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if _expired then
        -- Started more than _work_hold ago and never finished: it is gone,
        -- and its files are queued. A new send needs a new request id.
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- The same request again (the reply was lost): the same answer, and
    -- nothing new is made or counted. It does not give the send any longer:
    -- it still has to be finished within _work_hold of its first start.
    select * into _sub from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and sent_by = 'student' and request_id = p_request_id;
    if found then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,
                                  'bucket', public._work_bucket(), 'late', _sub.is_late,
                                  'finish_by', case when _sub.state = 'sending' then _sub.created_at + public._work_hold() end,
                                  'files', case when _sub.state = 'sending' then public._work_upload_json(_sub.id) else '[]'::jsonb end);
    end if;

    if not (_w->>'open')::boolean then
        return jsonb_build_object('ok', false, 'error', 'work_closed', 'closed_on', _w->'closes_on');
    end if;
    select * into _sent from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sent'
     order by version desc limit 1;
    if p_intent = 'new' and _sent.id is not null then
        -- Ruling 107: work the teacher handed in for the student (Add Work,
        -- or what an Unsend left of the teacher's pages) is not the end of
        -- the student's sending. Their new pages will join the teacher's, by
        -- the rule a Replace follows (send_finish). Closed as before: the
        -- student's own work (Replace is the way), work Handed In on Paper,
        -- and a piece with a revision open (Send My Revision is the way).
        if _sent.sent_by <> 'teacher' or _sent.on_paper
           or exists (select 1 from revision_request r
                       where r.assessment_id = _a.id and r.enrollment_id = p_enrollment_id and r.state = 'open') then
            return jsonb_build_object('ok', false, 'error', 'already_sent');
        end if;
        if _grading_started(p_enrollment_id, _a.id) then
            return jsonb_build_object('ok', false, 'error', 'grading_started');
        end if;
        -- The teacher's pages stay: with them the new pages must fit in 30.
        select count(*) into _theirs from submission_file f where f.submission_id = _sent.id and f.added_by = 'teacher';
        if _theirs + jsonb_array_length(p_pages) > 30 then
            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));
        end if;
    end if;
    if p_intent = 'replace' then
        if _sent.id is null then
            return jsonb_build_object('ok', false, 'error', 'nothing_sent');
        end if;
        if _sent.sent_by <> 'student' then
            -- the teacher added it, or marked it handed in on paper
            return jsonb_build_object('ok', false, 'error', 'cannot_change');
        end if;
        if _grading_started(p_enrollment_id, _a.id) then
            return jsonb_build_object('ok', false, 'error', 'grading_started');
        end if;
        -- Pages the teacher added to it stay when the student's are
        -- replaced: with them the new pages must still fit in 30.
        select count(*) into _theirs from submission_file f where f.submission_id = _sent.id and f.added_by = 'teacher';
        if _theirs + jsonb_array_length(p_pages) > 30 then
            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', 30 - _theirs);
        end if;
    end if;

    -- Twenty sends an hour for one card (Colin, Nov 9). Counted when links
    -- are handed out, so unsending does not give a send back.
    delete from send_log where at < now() - interval '1 day';
    select count(*), min(at) into _n, _oldest from send_log where card_id = _card and at > now() - interval '1 hour';
    if _n >= 20 then
        return jsonb_build_object('ok', false, 'error', 'too_many',
                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));
    end if;

    -- A send this student started for the piece and never finished goes.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';
    perform set_config('fv.work_removal_reason', '', true);

    -- The class may hold only so much (pages and bytes, handed in and
    -- unfinished together).
    _full := public._work_class_full(_course.id, p_pages);
    if _full is not null then
        return jsonb_build_object('ok', false, 'error', 'class_full');
    end if;

    insert into send_log (card_id) values (_card);
    _id := public._work_begin(_course.id, _a.id, p_enrollment_id, 'student', p_intent,
                              case when p_intent = 'replace' then _sent.id end,
                              p_pages, p_note, p_followed_plan, (_w->>'late')::boolean, _card, p_request_id);
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _id, 'state', 'sending',
                              'bucket', public._work_bucket(), 'late', (_w->>'late')::boolean,
                              'finish_by', now() + public._work_hold(),
                              'files', public._work_upload_json(_id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._send_session(p_session_token text, p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if _in ? 'error' then
        return _in;
    end if;
    if exists (select 1 from student_card k where k.id = (_in->>'card_id')::uuid and k.locked_at is not null) then
        return jsonb_build_object('error', 'card_locked');
    end if;
    return _in;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._session_class(p_session_token text, p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _session device_session%rowtype;
    _card    uuid;
    _why     text;
begin
    select * into _session from _device_session(p_session_token);
    if _session.id is null then
        return jsonb_build_object('error', 'signed_out');
    end if;
    select x.card_id into _card from device_session_enrollment x
     where x.session_id = _session.id and x.enrollment_id = p_enrollment_id;
    if _card is null then
        return jsonb_build_object('error', 'not_found');
    end if;
    _why := _card_refusal(_card);
    if _why is not null then
        return jsonb_build_object('error', _why);
    end if;
    return jsonb_build_object('card_id', _card, 'session_id', _session.id, 'expires_at', _session.expires_at,
                              'course_id', (select e.course_id from enrollment e where e.id = p_enrollment_id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit._session_classes(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student', jsonb_build_object('first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name)),
               'course', jsonb_build_object('name', c.name, 'block', c.block),
               'to_do', (select count(*)
                           from assessment a
                          cross join lateral _returned_grade(e.id, a.id) as g(r)
                          where a.course_id = c.id
                            and (a.date_assigned is null
                                 or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                            and a.score_mode <> 'dibels'
                            and (coalesce(g.r->>'status', '') = 'NS'
                                 or (coalesce(g.r->>'status', '') <> 'EXC' and g.r->>'returned_at' is null)))
               ) order by x.added_at, e.id), '[]'::jsonb)
      from device_session_enrollment x
      join student_card k on k.id = x.card_id
      join enrollment e on e.id = x.enrollment_id
      join student s on s.id = e.student_id
      join course c on c.id = e.course_id
     where x.session_id = p_session_id
       and k.stopped_at is null and e.withdrawn_at is null and c.deleted_at is null and c.student_page_enabled;
$function$;

CREATE OR REPLACE FUNCTION student_submit._slip_old_until()
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select timestamptz '2027-07-01 07:00:00+00' $function$;

CREATE OR REPLACE FUNCTION student_submit._work_window(p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'listed', a.date_assigned is null or a.date_assigned <= d.today,
               'closes_on', case a.after_due when 'until' then a.accept_until when 'stop' then a.due_date end,
               'open', case a.after_due when 'until' then d.today <= a.accept_until
                                        when 'stop' then a.due_date is null or d.today <= a.due_date
                                        else true end,
               'late', a.due_date is not null and d.today > a.due_date)
      from assessment a
      join course c on c.id = a.course_id
     cross join lateral (select (now() at time zone public._fv_timezone(c.timezone))::date as today) d
     where a.id = p_assessment_id;
$function$;

CREATE OR REPLACE FUNCTION student_submit._write_limit(p_card_id uuid, p_kind text, p_per_hour integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _n      int;
    _oldest timestamptz;
begin
    delete from write_log where at < now() - interval '1 day';
    select count(*), min(at) into _n, _oldest
      from write_log where card_id = p_card_id and kind = p_kind and at > now() - interval '1 hour';
    if _n >= p_per_hour then
        return jsonb_build_object('ok', false, 'error', 'too_many',
                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));
    end if;
    insert into write_log (card_id, kind) values (p_card_id, p_kind);
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.answer(p_session_token text, p_enrollment_id uuid, p_questionnaire_id uuid, p_answers jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb;
    _no      jsonb;
    _q       questionnaire%rowtype;
    _course  course%rowtype;
    _why     text;
    _parts   uuid[];
    _qid     text;
    _val     jsonb;
    _x       question%rowtype;
    _clean   jsonb;
    _clean_by_part jsonb := '{}'::jsonb;
    _part    uuid;
    _rid     uuid;
    _term    text;
    _core    text;
    _lvl     jsonb;
    _now     timestamptz := now();
begin
    if p_questionnaire_id is null then
        raise exception 'a questionnaire is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'answer', 10);
    if _no is not null then
        return _no;
    end if;
    -- One send at a time for this student: a second tap waits, then finds the first.
    perform 1 from enrollment where id = p_enrollment_id for update;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    select * into _q from questionnaire
     where id = p_questionnaire_id and course_id = _course.id and parent_id is null and kind <> 'goal_checkin';
    if _q.id is null or not _card_listed(_q.id, p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if exists (select 1 from response r where r.questionnaire_id = _q.id and r.enrollment_id = p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        return jsonb_build_object('ok', false, 'error', _why);
    end if;
    if jsonb_typeof(p_answers) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(p_answers)) > 80
       or octet_length(p_answers::text) > 100000 then
        return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    -- From here, submit's own checks and writes, word for word but for the slip.
    select array_agg(id) into _parts from (
        select _q.id as id
        union all
        select g.id from questionnaire g
         where g.parent_id = _q.id and g.kind = 'goal_checkin' and g.is_on
           and _closed_reason(g, _course.timezone) is null
    ) p;

    for _qid, _val in select * from jsonb_each(p_answers) loop
        if _qid !~ '^[0-9a-fA-F-]{36}$' then
            return jsonb_build_object('ok', false, 'error', 'invalid');
        end if;
        select * into _x from question
         where id = _qid::uuid and not archived and questionnaire_id = any(_parts);
        if not found then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end if;
        begin
            _clean := _clean_answer(_x.kind, _x.options, _x.core_ids, _val);
        exception when others then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end;
        if _clean is not null then
            _clean_by_part := jsonb_set(_clean_by_part, array[_x.questionnaire_id::text],
                coalesce(_clean_by_part->(_x.questionnaire_id::text), '{}'::jsonb)
                  || jsonb_build_object(_x.id::text, _clean || jsonb_build_object('kind', _x.kind)));
        end if;
    end loop;
    if _clean_by_part = '{}'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'empty');
    end if;

    _term := case when _q.report_period is not null
                   and jsonb_typeof(_course.reporting_terms) = 'array'
                   and jsonb_array_length(_course.reporting_terms) > 0
                  then 'T' || _q.report_period else '' end;

    foreach _part in array _parts loop
        if not (_clean_by_part ? _part::text) then continue; end if;
        insert into response (questionnaire_id, enrollment_id, via, submitted_at)
        values (_part, p_enrollment_id, 'link', _now)
        returning id into _rid;
        for _qid, _val in select * from jsonb_each(_clean_by_part->(_part::text)) loop
            insert into answer (response_id, question_id, value_num, value_text, value_json)
            values (_rid, _qid::uuid, (_val->>'num')::numeric, _val->>'text', _val->'json');
            if _val->>'kind' = 'scale4' and _val->'json' ? 'levels' then
                for _core, _lvl in select * from jsonb_each(_val->'json'->'levels') loop
                    insert into core_self_assessment (enrollment_id, core_id, term_key, level, body)
                    values (p_enrollment_id, _core, _term, (_lvl #>> '{}')::int,
                            case when jsonb_typeof(_val->'json'->'why') = 'object'
                                 then _val->'json'->'why'->>_core
                                 else _val->'json'->>'why' end)
                    on conflict (enrollment_id, core_id, term_key)
                    do update set level = excluded.level,
                                  body = coalesce(excluded.body, core_self_assessment.body),
                                  updated_at = now();
                end loop;
            end if;
        end loop;
    end loop;

    -- A slip of this student's for it, not yet used, can no longer send it.
    update student_access_code set used_at = _now
     where questionnaire_id = _q.id and enrollment_id = p_enrollment_id and used_at is null and revoked_at is null;
    return jsonb_build_object('ok', true, 'submitted_at', _now);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.answer_seen(p_session_token text, p_enrollment_id uuid, p_assessment_ids uuid[], p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _n  int;
    _no jsonb;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- E6: sixty an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'seen', 60);
    if _no is not null then
        return _no;
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    update feedback_reflection f
       set answer_seen_at = case when f.answer is not null then coalesce(f.answer_seen_at, clock_timestamp())
                                 else f.answer_seen_at end,
           follow_up_answer_seen_at = case when f.follow_up_answer is not null
                                           then coalesce(f.follow_up_answer_seen_at, clock_timestamp())
                                           else f.follow_up_answer_seen_at end
     where f.enrollment_id = p_enrollment_id and f.course_id = (_in->>'course_id')::uuid
       and f.assessment_id = any (coalesce(p_assessment_ids, '{}'))
       and ((f.answer is not null and f.answer_seen_at is null)
            or (f.follow_up_answer is not null and f.follow_up_answer_seen_at is null));
    get diagnostics _n = row_count;
    return jsonb_build_object('ok', true, 'seen', _n);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.card(p_code_hmac text, p_key_id text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _found  jsonb := _card_lookup(p_code_hmac, p_key_id, p_ip_hash);
    _card   uuid := (_found->>'card_id')::uuid;
    _course course%rowtype;
    _name   text;
    _by     text;
    _pw     boolean;
begin
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select c.* into _course
      from student_card k join enrollment e on e.id = k.enrollment_id join course c on c.id = e.course_id
     where k.id = _card;
    -- What the student must prove, as a questionnaire slip asks it.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when k.pw_hmac is not null then 'password' end,
           k.pw_hmac is not null
      into _name, _by, _pw
      from student_card k join enrollment e on e.id = k.enrollment_id join student s on s.id = e.student_id
     where k.id = _card;
    if _by is null then
        perform _log('card', 'no_identity', p_ip_hash, _card, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    perform _log('card', 'ok', p_ip_hash, _card, _course.id);
    return jsonb_build_object(
        'ok', true, 'kind', 'card',
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        'also_password', _by = 'identity' and _pw);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit."check"(p_token text, p_birthday text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _s      session%rowtype;
    _c      student_access_code%rowtype;
    _r      phone_report%rowtype;
    _course course%rowtype;
    _dob    date;
    _given  date;
    _data   jsonb;
begin
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       for update;
    if not found or _s.expires_at < now() then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _c from student_access_code where id = _s.code_id;
    if _c.phone_report_id is null or _c.revoked_at is not null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _r from phone_report where id = _c.phone_report_id;
    select * into _course from course where id = _r.course_id;
    if _r.closed_at is not null
       or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
        perform _log('open', 'closed', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'report_closed');
    end if;
    if _s.check_fails >= 5
       or (select count(*) from attempt
            where code_id = _c.id and outcome = 'wrong_birthday' and at > now() - interval '15 minutes') >= 10 then
        perform _log('open', 'locked', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    select s.date_of_birth into _dob
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    if _dob is null then
        perform _log('open', 'no_birthday', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'no_birthday');
    end if;
    begin
        _given := p_birthday::date;
    exception when others then
        _given := null;
    end;
    if _given is distinct from _dob then
        update session set check_fails = check_fails + 1 where id = _s.id;
        perform _log('open', 'wrong_birthday', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'wrong_birthday', 'tries_left', greatest(0, 4 - _s.check_fails));
    end if;

    update session set checked_at = coalesce(checked_at, now()) where id = _s.id;
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;
    select data into _data from phone_report_student
     where report_id = _r.id and enrollment_id = _c.enrollment_id;
    perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
    return jsonb_build_object('ok', true, 'report', coalesce(_data, '{}'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.done(p_session_token text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
begin
    if coalesce(p_session_token, '') ~ '^[0-9a-f]{64}$' then
        delete from device_session
         where token_hash = encode(sha256(convert_to(p_session_token, 'UTF8')), 'hex');
    end if;
    return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.feedback(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'reflect_on_feedback', _course.reflect_on_feedback,
        'show_my_learning', _course.show_my_learning,
        'assessments', coalesce((
            select jsonb_agg(x.j order by x.ord1 nulls first, x.ord2, x.ord3, x.id)
              from (select a.id, a.date_assigned as ord1, a.display_order as ord2, a.created_at as ord3,
                           jsonb_build_object(
                               'id', a.id,
                               'marks', mk.j,
                               'revision', rv.j,
                               'reflection', rf.j) as j
                      from assessment a
                      left join score s on s.enrollment_id = p_enrollment_id and s.assessment_id = a.id
                      -- marks given on the student's own pages, and on their group's
                      left join lateral (
                          select case when count(*) = 0 then null else jsonb_build_object(
                                     'pages', count(*),
                                     -- every page of the work: each member's latest handed-in version
                                     'work_pages', (select count(*) from submission_file wf
                                                     where wf.submission_id in (
                                                         select distinct on (ws.enrollment_id) ws.id from submission ws
                                                          where ws.assessment_id = a.id and ws.state = 'sent'
                                                            and ws.enrollment_id = any (coalesce(_group_members(a.id, p_enrollment_id), array[p_enrollment_id]))
                                                          order by ws.enrollment_id, ws.version desc)),
                                     'notes', sum((select count(*) from jsonb_array_elements(coalesce(m.given->'marks', '[]'::jsonb)) k
                                                    where k->>'type' = 'note'))) end as j
                            from markup m
                           where m.assessment_id = a.id and m.given is not null
                             and m.enrollment_id = any (coalesce(_group_members(a.id, p_enrollment_id), array[p_enrollment_id]))
                             -- E5: a group-mate who is Missing or Excused on the piece: their marks are not the group's
                             and (m.enrollment_id = p_enrollment_id
                                  or not exists (select 1 from score gs where gs.enrollment_id = m.enrollment_id
                                                                       and gs.assessment_id = a.id and gs.status in ('NS', 'EXC')))
                             and jsonb_array_length(coalesce(m.given->'marks', '[]'::jsonb)) > 0
                             and a.students_see_markup and coalesce(s.status, '') not in ('NS', 'EXC')
                             and exists (select 1 from submission_file f join submission x on x.id = f.submission_id
                                          where f.id = m.file_id and x.state = 'sent')) mk on true
                      left join lateral (
                          select jsonb_build_object(
                                     'state', st->>'state', 'what_to_fix', r.what_to_fix, 'revise_by', r.revise_by,
                                     'criterion_ids', to_jsonb(r.criterion_ids), 'keep_grade', r.keep_grade,
                                     'grade_hidden', false,
                                     'first_version', r.first_version,
                                     'first_sent_at', (select x.sent_at from submission x where x.id = r.first_submission_id),
                                     -- the first version's grade as the student had it: not while Missing or
                                     -- Excused is on the piece
                                     'first_grade', case when coalesce(s.status, '') in ('NS', 'EXC') then null
                                                         else public._grade_copy_in_use(r.first_grade, a.id) end,
                                     'revision_version', st->'revision_version', 'revision_sent_at', st->'revision_sent_at',
                                     'revision_note', case when st->>'revision_sent_by' = 'student' then st->'revision_note' end,
                                     'revision_late', st->'revision_late',
                                     'asked_at', r.created_at) as j
                            from revision_request r
                           cross join lateral (select public._revision_state(r.id) as st) z
                           where r.assessment_id = a.id and r.enrollment_id = p_enrollment_id and r.state <> 'cancelled'
                           order by r.created_at desc limit 1) rv on true
                      left join lateral (
                          select jsonb_build_object(
                                     'makes_sense', f.makes_sense, 'question', f.question, 'plan', f.plan, 'went_well', f.went_well,
                                     'sent_at', f.sent_at,
                                     -- the teacher's Only Me notes (note, follow_up_note) are never read here
                                     'answer', f.answer, 'answered_at', f.answered_at,
                                     'sense_now', f.sense_now, 'follow_up', f.follow_up,
                                     'follow_up_answer', f.follow_up_answer, 'follow_up_answered_at', f.follow_up_answered_at,
                                     -- What Changed: an answer the page has not shown yet (answer_seen)
                                     'answer_new', (f.answer is not null and f.answer_seen_at is null)
                                                   or (f.follow_up_answer is not null and f.follow_up_answer_seen_at is null)) as j
                            from feedback_reflection f
                           where f.assessment_id = a.id and f.enrollment_id = p_enrollment_id
                             and _course.reflect_on_feedback) rf on true
                     where a.course_id = _course.id
                       and (a.date_assigned is null or a.date_assigned <= _today)
                       and (mk.j is not null or rv.j is not null or rf.j is not null)) x), '[]'::jsonb),
        'last_plan', (select jsonb_build_object('assessment_id', f.assessment_id, 'plan', f.plan, 'sent_at', f.plan_at)
                        from feedback_reflection f
                       where f.enrollment_id = p_enrollment_id and f.course_id = _course.id and f.plan is not null
                         and _course.reflect_on_feedback
                       order by f.plan_at desc, f.id limit 1));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'files', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', f.id, 'submission_id', s.id, 'version', s.version, 'page', f.page,
                       'path', f.path, 'thumb_path', f.thumb_path,
                       'width', f.width, 'height', f.height, 'rotation', f.rotation)
                     order by s.version, f.page, f.id)
              from submission s
              join submission_file f on f.submission_id = s.id
             where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id
               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'
               -- E4: a piece dated in the future is not on the student's page: no link for its pages
               and exists (select 1 from assessment a join course c on c.id = a.course_id
                             where a.id = p_assessment_id
                               and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.form(p_session_token text, p_enrollment_id uuid, p_questionnaire_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb;
    _course course%rowtype;
    _q      questionnaire%rowtype;
    _child  questionnaire%rowtype;
    _why    text;
    _parts  jsonb;
    _ctx    jsonb;
begin
    if p_questionnaire_id is null then
        raise exception 'a questionnaire is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    select * into _q from questionnaire
     where id = p_questionnaire_id and course_id = _course.id and parent_id is null and kind <> 'goal_checkin';
    if _q.id is null or not _card_listed(_q.id, p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if exists (select 1 from response r where r.questionnaire_id = _q.id and r.enrollment_id = p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        return jsonb_build_object('ok', false, 'error', _why, 'opens_on', _q.opens_on);
    end if;
    -- As _payload builds them for a slip.
    _parts := jsonb_build_array(_part(_q.id));
    for _child in
        select * from questionnaire
         where parent_id = _q.id and kind = 'goal_checkin' and is_on
         order by created_at
    loop
        if _closed_reason(_child, _course.timezone) is null then
            _parts := _parts || jsonb_build_array(_part(_child.id));
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(_parts) p where p->>'kind' = 'goal_checkin') then
        select jsonb_build_object('course_goal', jsonb_build_object('text', a.value_text, 'at', r.submitted_at))
          into _ctx
          from answer a
          join question x on x.id = a.question_id
          join response r on r.id = a.response_id
          join questionnaire q2 on q2.id = r.questionnaire_id
         where r.enrollment_id = p_enrollment_id and q2.course_id = _q.course_id
           and x.repeated_key = 'better_at' and nullif(btrim(a.value_text), '') is not null
         order by r.submitted_at desc
         limit 1;
    end if;
    return jsonb_build_object('ok', true, 'parts', _parts, 'context', coalesce(_ctx, '{}'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.forms(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'questionnaires', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', x.id, 'title', x.title, 'description', x.theme, 'minutes', null,
                       'state', x.state, 'opens_on', x.opens_on, 'closes_on', x.closes_on, 'sent_at', x.sent_at)
                     order by x.opens_on nulls first, x.created_at, x.id)
              from (select q.id, q.title, q.theme, q.opens_on, q.closes_on, q.created_at, r.sent_at,
                           case when r.sent_at is not null then 'sent'
                                when _closed_reason(q, _course.timezone) is null then 'open'
                                when _closed_reason(q, _course.timezone) = 'not_open_yet' then 'not_open_yet' end as state
                      from questionnaire q
                      cross join lateral (select max(x.submitted_at) as sent_at from response x
                                           where x.questionnaire_id = q.id and x.enrollment_id = p_enrollment_id) r
                     where q.course_id = _course.id and q.parent_id is null and q.kind <> 'goal_checkin'
                       and _card_listed(q.id, p_enrollment_id)) x
             where x.state is not null), '[]'::jsonb),
        'reports', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'title', coalesce(r.term_label, 'Report ' || r.term),
                       'issued_at', r.issued_at, 'expires_on', r.expires_on,
                       'opened_at', (select min(c.opened_at) from student_access_code c
                                      where c.phone_report_id = r.id and c.enrollment_id = p_enrollment_id),
                       'overall', s.data->'overall', 'comment', s.data->'comment')
                     order by r.issued_at desc, r.id)
              from phone_report r
              join phone_report_student s on s.report_id = r.id and s.enrollment_id = p_enrollment_id
             where r.course_id = _course.id and r.closed_at is null and _today <= r.expires_on), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.group_file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'files', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', f.id, 'submission_id', s.id, 'version', s.version, 'page', f.page,
                       'path', f.path, 'thumb_path', f.thumb_path,
                       'width', f.width, 'height', f.height, 'rotation', f.rotation,
                       'mine', s.enrollment_id = p_enrollment_id)
                     order by s.sent_at, s.id, f.page, f.id)
              from submission s
              join submission_file f on f.submission_id = s.id
             where s.assessment_id = p_assessment_id and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'
               and s.enrollment_id = any (coalesce(_group_members(p_assessment_id, p_enrollment_id), array[p_enrollment_id]))
               -- E4: a piece dated in the future is not on the student's page: no link for its pages
               and exists (select 1 from assessment a join course c on c.id = a.course_id
                             where a.id = p_assessment_id
                               and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.group_work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    return jsonb_build_object('ok', true, 'assessments', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', a.id,
                   'members', cardinality(m.ids),
                   'sent', w.subs > 0,
                   'pages', w.pages,
                   'you_sent', w.mine > 0,
                   'first_sent_at', w.first_at)
                 order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
          from assessment a
         cross join lateral (select _group_members(a.id, p_enrollment_id) as ids) m
         cross join lateral (
             select count(distinct s.id) as subs, count(f.id) as pages,
                    count(distinct s.id) filter (where s.enrollment_id = p_enrollment_id) as mine,
                    min(s.sent_at) as first_at
               from submission s left join submission_file f on f.submission_id = s.id
              where s.assessment_id = a.id and s.state = 'sent' and s.enrollment_id = any (m.ids)) w
         where a.course_id = _course.id and m.ids is not null
           and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.handout_links(p_session_token text, p_enrollment_id uuid, p_resource_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _r  assessment_resource%rowtype;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select r.* into _r
      from assessment_resource r
      join assessment a on a.id = r.assessment_id
      join course c on c.id = a.course_id
     where r.id = p_resource_id and r.kind = 'pdf' and r.status = 'ready'
       and r.course_id = (_in->>'course_id')::uuid and a.course_id = r.course_id
       and (a.date_assigned is null
            or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'resource_id', _r.id, 'assessment_id', _r.assessment_id, 'title', _r.title, 'page_count', _r.page_count,
        'pages', (select jsonb_agg(jsonb_build_object('page', n, 'path', public._handout_path(_r.course_id, _r.id, n)) order by n)
                    from generate_series(1, _r.page_count) n));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.issue_cards(p_teacher_id uuid, p_course_id uuid, p_items jsonb, p_key_id text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    _hex64   constant text := '^[0-9a-f]{64}$';
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
    _cached  jsonb;
    _item    record;
    _cand    jsonb;
    _until   date;
    _live    uuid;
    _made    uuid;
    _seq     int;
    _pick    int;
    _has_pw  boolean;
    _con     text;
    _one     jsonb;
    _by_pos  jsonb := '{}'::jsonb;   -- each student's result, by its place in p_items
    _results jsonb;
begin
    -- The request's shape, before anything is read or changed. A tag is 64
    -- lower-case hex characters and nothing else: a code can never arrive
    -- where a tag goes.
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'items must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_items) > 250 then
        raise exception 'at most 250 students in one request' using errcode = '22023';
    end if;
    for _item in select t.i, t.ord from jsonb_array_elements(p_items) with ordinality as t(i, ord) loop
        if jsonb_typeof(_item.i) <> 'object'
           or jsonb_typeof(_item.i->'enrollment_id') is distinct from 'string' or _item.i->>'enrollment_id' !~ _uuid
           or not (_item.i->'replaces' is null or jsonb_typeof(_item.i->'replaces') = 'null'
                   or (jsonb_typeof(_item.i->'replaces') = 'string' and _item.i->>'replaces' ~ _uuid))
           or jsonb_typeof(_item.i->'candidates') is distinct from 'array' then
            raise exception 'item % is malformed', _item.ord using errcode = '22023';
        end if;
        if jsonb_array_length(_item.i->'candidates') <> 2 then
            raise exception 'item % must have exactly two candidates', _item.ord using errcode = '22023';
        end if;
        for _cand in select c from jsonb_array_elements(_item.i->'candidates') c loop
            if jsonb_typeof(_cand) <> 'object'
               or jsonb_typeof(_cand->'code_hmac') is distinct from 'string' or _cand->>'code_hmac' !~ _hex64
               or jsonb_typeof(_cand->'pw_hmac') is distinct from 'string' or _cand->>'pw_hmac' !~ _hex64 then
                raise exception 'item % has a candidate that is not two tags', _item.ord using errcode = '22023';
            end if;
        end loop;
    end loop;
    if (select count(distinct lower(i->>'enrollment_id')) from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
        raise exception 'a student is named twice' using errcode = '22023';
    end if;
    if (select count(distinct c->>'code_hmac') from jsonb_array_elements(p_items) i, jsonb_array_elements(i->'candidates') c)
       <> 2 * jsonb_array_length(p_items) then
        raise exception 'a code tag is given twice' using errcode = '22023';
    end if;

    -- From here on, as that teacher: ownership and idempotency are the same
    -- helpers every teacher RPC uses.
    perform _as_teacher(p_teacher_id);
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    -- A replay returns what the first call said of each student and makes
    -- nothing. It cannot return a code or which candidate was used: the
    -- first call's answer is stored without them, and no code was ever here.
    _cached := fv_idem_check(p_idempotency_key, 'issue_cards');
    if _cached is not null then
        perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
        return jsonb_build_object('replayed', true, 'results', _cached->'results');
    end if;
    perform _card_key_seen(p_key_id);
    _until := _cards_work_until(p_course_id);

    -- One student at a time, in the order of their ids whatever order the
    -- request lists them in, so two requests never wait on each other's
    -- students.
    for _item in
        select t.ord, (t.i->>'enrollment_id')::uuid as enrollment_id, (t.i->>'replaces')::uuid as replaces, t.i->'candidates' as candidates
          from jsonb_array_elements(p_items) with ordinality as t(i, ord)
         order by (t.i->>'enrollment_id')::uuid
    loop
        _one := jsonb_build_object('enrollment_id', _item.enrollment_id);
        if not exists (select 1 from enrollment e
                        where e.id = _item.enrollment_id and e.course_id = p_course_id and e.withdrawn_at is null) then
            -- not in this class, or withdrawn
            _one := _one || jsonb_build_object('result', 'not_found');
        else
            -- The block is all or nothing: if no new card can be stored, the
            -- stop of the old one is undone with it.
            begin
                -- The student's live card, locked. A request that named the
                -- same card and got here second waits, then finds it stopped.
                select k.id into _live from student_card k
                 where k.enrollment_id = _item.enrollment_id and k.stopped_at is null
                   for update;
                if _live is distinct from _item.replaces then
                    -- Not the card the browser believed was live (another
                    -- tab made or replaced one first): nothing is done.
                    _one := _one || jsonb_build_object('result', 'changed');
                else
                    if _live is not null then
                        update student_card set stopped_at = now() where id = _live;
                    end if;
                    select coalesce(max(k.seq), 0) + 1 into _seq from student_card k where k.enrollment_id = _item.enrollment_id;
                    -- A password of the card's own only for a student with
                    -- nothing else to answer "Is This You?" with right now.
                    _has_pw := exists (select 1 from enrollment e join student s on s.id = e.student_id
                                        where e.id = _item.enrollment_id and s.date_of_birth is null
                                          and nullif(btrim(s.student_number), '') is null);
                    _made := null;
                    for _try in 0..1 loop
                        begin
                            insert into student_card (enrollment_id, code_hmac, pw_hmac, key_id, seq, works_until)
                            values (_item.enrollment_id, _item.candidates->_try->>'code_hmac',
                                    case when _has_pw then _item.candidates->_try->>'pw_hmac' end,
                                    p_key_id, _seq, _until)
                            returning id into _made;
                            _pick := _try;   -- which candidate was stored: the function returns its code
                            exit;
                        exception when unique_violation then
                            get stacked diagnostics _con = constraint_name;
                            if _con is distinct from 'student_card_code_hmac_key' then
                                -- The student got a live card from another
                                -- request in the meantime.
                                raise exception 'another request made this card' using errcode = 'FVC01';
                            end if;
                            -- That tag is already a card's: try the other candidate.
                        end;
                    end loop;
                    if _made is null then
                        raise exception 'both candidates are taken' using errcode = 'FVC02';
                    end if;
                    _one := _one || jsonb_build_object(
                        'result', 'made', 'card_id', _made, 'seq', _seq, 'works_until', _until,
                        'candidate', _pick, 'has_password', _has_pw);
                end if;
            exception
                when sqlstate 'FVC01' then
                    _one := jsonb_build_object('enrollment_id', _item.enrollment_id, 'result', 'changed');
                when sqlstate 'FVC02' then
                    _one := jsonb_build_object('enrollment_id', _item.enrollment_id, 'result', 'failed');
            end;
        end if;
        _by_pos := _by_pos || jsonb_build_object(_item.ord::text, _one);
    end loop;

    -- In the order of the request.
    select coalesce(jsonb_agg(_by_pos->(t.ord::text) order by t.ord), '[]'::jsonb) into _results
      from jsonb_array_elements(p_items) with ordinality as t(i, ord);
    -- What a replay returns: the same, without which candidate was used.
    perform fv_idem_store(p_idempotency_key, 'issue_cards',
                          jsonb_build_object('results', (select coalesce(jsonb_agg(r - 'candidate' order by n), '[]'::jsonb)
                                                           from jsonb_array_elements(_results) with ordinality as x(r, n))));
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
    return jsonb_build_object('replayed', false, 'results', _results);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.issue_slips(p_teacher_id uuid, p_kind text, p_target_id uuid, p_items jsonb, p_key_id text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    _hex64   constant text := '^[0-9a-f]{64}$';
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
    _cached  jsonb;
    _item    record;
    _cand    jsonb;
    _q       questionnaire%rowtype;
    _r       phone_report%rowtype;
    _course  uuid;
    _expires timestamptz;
    _has_pw  boolean;
    _made    uuid;
    _pick    int;
    _con     text;
    _one     jsonb;
    _results jsonb := '[]'::jsonb;
begin
    -- The request's shape, before anything is read or changed. A tag is 64
    -- lower-case hex characters and nothing else: a code can never arrive
    -- where a tag goes.
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    if p_kind is null or p_kind not in ('questionnaire', 'report') then
        raise exception 'kind must be questionnaire or report' using errcode = '22023';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'items must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_items) > 250 then
        raise exception 'at most 250 students in one request' using errcode = '22023';
    end if;
    for _item in select t.i, t.ord from jsonb_array_elements(p_items) with ordinality as t(i, ord) loop
        if jsonb_typeof(_item.i) <> 'object'
           or jsonb_typeof(_item.i->'enrollment_id') is distinct from 'string' or _item.i->>'enrollment_id' !~ _uuid
           or jsonb_typeof(_item.i->'candidates') is distinct from 'array' then
            raise exception 'item % is malformed', _item.ord using errcode = '22023';
        end if;
        if jsonb_array_length(_item.i->'candidates') <> 2 then
            raise exception 'item % must have exactly two candidates', _item.ord using errcode = '22023';
        end if;
        for _cand in select c from jsonb_array_elements(_item.i->'candidates') c loop
            if jsonb_typeof(_cand) <> 'object'
               or jsonb_typeof(_cand->'code_hmac') is distinct from 'string' or _cand->>'code_hmac' !~ _hex64
               or jsonb_typeof(_cand->'pw_hmac') is distinct from 'string' or _cand->>'pw_hmac' !~ _hex64 then
                raise exception 'item % has a candidate that is not two tags', _item.ord using errcode = '22023';
            end if;
        end loop;
    end loop;
    if (select count(distinct lower(i->>'enrollment_id')) from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
        raise exception 'a student is named twice' using errcode = '22023';
    end if;
    if (select count(distinct c->>'code_hmac') from jsonb_array_elements(p_items) i, jsonb_array_elements(i->'candidates') c)
       <> 2 * jsonb_array_length(p_items) then
        raise exception 'a code tag is given twice' using errcode = '22023';
    end if;

    perform _as_teacher(p_teacher_id);
    if p_kind = 'questionnaire' then
        select * into _q from questionnaire where id = p_target_id and fv_owns_course(course_id);
        if _q.id is null then
            raise exception 'questionnaire not found' using errcode = 'P0002';
        end if;
        _course := _q.course_id;
        _expires := coalesce((_q.closes_on + 1)::timestamptz, now() + interval '30 days');
    else
        select * into _r from phone_report where id = p_target_id and fv_owns_course(course_id);
        if _r.id is null then
            raise exception 'report not found' using errcode = 'P0002';
        end if;
        if _r.closed_at is not null then
            raise exception 'this report is closed' using errcode = 'FVS01';
        end if;
        _course := _r.course_id;
        _expires := (_r.expires_on + 1)::timestamptz;
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'issue_slips');
    if _cached is not null then
        perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
        return jsonb_build_object('replayed', true, 'results', _cached->'results');
    end if;

    for _item in
        select (t.i->>'enrollment_id')::uuid as enrollment_id, t.i->'candidates' as candidates
          from jsonb_array_elements(p_items) with ordinality as t(i, ord)
         order by t.ord
    loop
        _one := jsonb_build_object('enrollment_id', _item.enrollment_id);
        if not exists (select 1 from enrollment e
                        where e.id = _item.enrollment_id and e.course_id = _course and e.withdrawn_at is null
                          and fv_owns_enrollment(e.id))
           or (p_kind = 'report' and not exists (select 1 from phone_report_student s
                                                  where s.report_id = _r.id and s.enrollment_id = _item.enrollment_id)) then
            -- not in this class (or not sent this report), or withdrawn
            _results := _results || jsonb_build_array(_one || jsonb_build_object('result', 'not_found'));
            continue;
        end if;
        -- All or nothing for the student: if no new slip can be stored, the
        -- old one is not taken back either.
        begin
            if p_kind = 'questionnaire' then
                update student_access_code set revoked_at = now()
                 where enrollment_id = _item.enrollment_id and questionnaire_id = _q.id
                   and used_at is null and revoked_at is null;
                _has_pw := exists (select 1 from enrollment e join student s on s.id = e.student_id
                                    where e.id = _item.enrollment_id and s.date_of_birth is null
                                      and nullif(btrim(s.student_number), '') is null);
            else
                update student_access_code set revoked_at = now()
                 where enrollment_id = _item.enrollment_id and phone_report_id = _r.id and revoked_at is null;
                _has_pw := false;
            end if;
            _made := null;
            for _try in 0..1 loop
                begin
                    insert into student_access_code (enrollment_id, questionnaire_id, phone_report_id,
                                                     code_hmac, pw_hmac, key_id, expires_at)
                    values (_item.enrollment_id, _q.id, _r.id, _item.candidates->_try->>'code_hmac',
                            case when _has_pw then _item.candidates->_try->>'pw_hmac' end, p_key_id, _expires)
                    returning id into _made;
                    _pick := _try;   -- which candidate was stored: the edge returns its code
                    exit;
                exception when unique_violation then
                    get stacked diagnostics _con = constraint_name;
                    if _con is distinct from 'student_access_code_code_hmac' then
                        raise;
                    end if;
                    -- That tag is a slip's already: try the other candidate.
                end;
            end loop;
            if _made is null then
                raise exception 'both candidates are taken' using errcode = 'FVS02';
            end if;
            _one := _one || jsonb_build_object('result', 'made', 'slip_id', _made, 'candidate', _pick,
                                               'has_password', _has_pw);
        exception when sqlstate 'FVS02' then
            _one := jsonb_build_object('enrollment_id', _item.enrollment_id, 'result', 'failed');
        end;
        _results := _results || jsonb_build_array(_one);
    end loop;

    -- What a replay returns: the same, without which candidate was used.
    perform fv_idem_store(p_idempotency_key, 'issue_slips',
                          jsonb_build_object('results', (select coalesce(jsonb_agg(r - 'candidate' order by n), '[]'::jsonb)
                                                           from jsonb_array_elements(_results) with ordinality as x(r, n))));
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
    return jsonb_build_object('replayed', false, 'results', _results);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.markup(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _a      assessment%rowtype;
    _course course%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- E4: a piece dated in the future is not on the student's page: nothing of it is served
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date);
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _a.students_see_markup
       or exists (select 1 from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = _a.id and s.status in ('NS', 'EXC')) then
        return jsonb_build_object('ok', true, 'files', '[]'::jsonb);
    end if;
    return jsonb_build_object('ok', true, 'files', coalesce((
        select jsonb_agg(jsonb_build_object('file_id', m.file_id, 'marks', m.given, 'given_at', m.given_at) order by m.file_id)
          from markup m
          join submission_file f on f.id = m.file_id
          join submission x on x.id = f.submission_id and x.state = 'sent'
         where m.assessment_id = _a.id and m.given is not null
           and m.enrollment_id = any (coalesce(_group_members(_a.id, p_enrollment_id), array[p_enrollment_id]))
           -- E5: a group-mate who is Missing or Excused on the piece: their marks are not the group's
           and (m.enrollment_id = p_enrollment_id
                or not exists (select 1 from score s where s.enrollment_id = m.enrollment_id and s.assessment_id = _a.id
                                                       and s.status in ('NS', 'EXC')))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.open(p_code_hmac text, p_key_id text, p_code text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _until  constant timestamptz := _slip_old_until();
    _code   text;
    _ids    uuid[];
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _course course%rowtype;
    _name   text;
    _why    text;
    _token  text;
    _exp    timestamptz := now() + interval '80 minutes';
    _r      phone_report%rowtype;
    _dob    date;
    _by     text;
    _pw     boolean;
begin
    -- A tag is 64 lower-case hex characters, and a key id 8. Anything else is
    -- a bug in the caller, not a student's guess: fail, and log nothing.
    if p_code_hmac is not null and p_code_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed code tag' using errcode = '22023';
    end if;
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;

    if random() < 0.02 then
        delete from attempt where at < now() - interval '30 days';
        delete from session where expires_at < now() - interval '1 day';
    end if;

    -- A school's students share one address, so the limit is generous and
    -- counts only codes that weren't found (a guess), not closed forms,
    -- used slips or wrong birthdays.
    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'open' and outcome in ('not_found', 'bad_format', 'ambiguous')
           and at > now() - interval '15 minutes') >= 300 then
        perform _log('open', 'locked', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if (select count(*) from attempt
         where route = 'open' and outcome in ('not_found', 'bad_format')
           and at > now() - interval '10 minutes') >= 500 then
        perform _log('open', 'busy', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    -- Not six characters of the slip alphabet: the edge sends no tag.
    if p_code_hmac is null then
        perform _log('open', 'bad_format', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- 1. By its tag: a slip made since this file, or one already converted.
    --    Live (or used) slips only, through the unique index on tags.
    select * into _c from student_access_code
     where code_hmac = p_code_hmac and revoked_at is null and expires_at > now()
       for update;

    -- 2. A slip printed before this file and not yet converted. THE PLAIN
    --    CODE IS USED HERE AND NOWHERE ELSE, and only against rows that still
    --    have a salted hash (code_hash is not null): it is never compared
    --    with a converted or a new slip, never stored and never logged.
    if _c.id is null then
        if now() >= _until
           or not exists (select 1 from student_access_code
                           where code_hash is not null and revoked_at is null and expires_at > now()) then
            -- No unconverted slip can be live: a miss is a miss.
            perform _log('open', 'not_found', p_ip_hash);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if p_code is null then
            -- Ask the edge for the plain code. Nothing is counted or logged:
            -- the second call counts this code, once.
            return jsonb_build_object('ok', false, 'error', 'not_found', 'fallback', true);
        end if;
        _code := _norm(p_code);
        if _code !~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$' then
            perform _log('open', 'bad_format', p_ip_hash);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        -- Each old slip has its own salt, so each is hashed with the code.
        select array_agg(m.id) into _ids from (
            select x.id from student_access_code x
             where x.code_hash is not null and x.revoked_at is null and x.expires_at > now()
               and x.code_hash = _access_code_hash(_code, x.salt)
               for update) m;
        if coalesce(cardinality(_ids), 0) = 0 then
            -- Another scan of the same slip may have converted it just now
            -- (the row it locked no longer has a hash): by its tag, again.
            select * into _c from student_access_code
             where code_hmac = p_code_hmac and revoked_at is null and expires_at > now()
               for update;
            if _c.id is null then
                perform _log('open', 'not_found', p_ip_hash);
                return jsonb_build_object('ok', false, 'error', 'not_found');
            end if;
        elsif cardinality(_ids) > 1 then
            perform _log('open', 'ambiguous', p_ip_hash);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        else
            -- Converted on the spot: the tag in place of the hash and salt.
            begin
                update student_access_code
                   set code_hmac = p_code_hmac, key_id = p_key_id, converted_at = now(), code_hash = null, salt = null
                 where id = _ids[1];
            exception when unique_violation then
                -- That tag is already a slip's (taken back, or past its
                -- date): this one keeps its hash and opens as before.
                null;
            end;
            select * into _c from student_access_code where id = _ids[1];
        end if;
    end if;

    -- From here, as the slip's open always was, but for which password counts.

    -- A phone report's code opens to the birthday check, not the report:
    -- check() hands the report over once the birthday matches. It works
    -- until the report's last day or until the teacher closes it, as often
    -- as the student likes.
    if _c.phone_report_id is not null then
        select * into _r from phone_report where id = _c.phone_report_id;
        select * into _course from course where id = _r.course_id;
        if _course.deleted_at is not null
           or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
            perform _log('open', 'not_found', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if _r.closed_at is not null
           or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
            perform _log('open', 'closed', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'report_closed');
        end if;
        if (select count(*) from session where code_id = _c.id) >= 200 then
            perform _log('open', 'too_many_opens', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'locked');
        end if;
        _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
        insert into session (token_hash, code_id, expires_at)
        values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);
        select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name), s.date_of_birth into _name, _dob
          from enrollment e join student s on s.id = e.student_id
         where e.id = _c.enrollment_id;
        perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object(
            'ok', true, 'kind', 'report', 'token', _token, 'expires_at', _exp,
            'student', jsonb_build_object('first_name', _name),
            'course', jsonb_build_object('name', _course.name, 'block', _course.block),
            'report', jsonb_build_object('title', coalesce(_r.term_label, 'Report ' || _r.term), 'expires_on', _r.expires_on),
            'has_birthday', _dob is not null);
    end if;
    if _c.questionnaire_id is null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.used_at is not null then
        perform _log('open', 'used', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'used');
    end if;
    if _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('open', 'not_found', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        perform _log('open', _why, p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', _why, 'opens_on', _q.opens_on);
    end if;
    if (select count(*) from session where code_id = _c.id) >= 20 then
        perform _log('open', 'too_many_opens', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;

    -- Who the student must prove they are: their birthday or student number
    -- when the teacher entered one, else the password printed on the slip:
    -- the slip's own (its tag), or, for a slip printed before this file and
    -- until the end of the old slips, the one stored with the student. A
    -- slip with neither has nothing to check against: they need a new slip.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when _c.pw_hmac is not null
                     or (now() < _until and nullif(btrim(s.slip_password), '') is not null) then 'password' end,
           _c.pw_hmac is not null or (now() < _until and nullif(btrim(s.slip_password), '') is not null)
      into _name, _by, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    if _by is null then
        perform _log('open', 'no_identity', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;

    _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
    insert into session (token_hash, code_id, expires_at)
    values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);

    -- The questions wait for verify(); the slip alone shows only the first
    -- name and what the questions are called.
    perform _log('open', 'ok', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object(
        'ok', true, 'kind', 'questionnaire', 'token', _token, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        -- A password printed before the teacher added a birthday or number
        -- still works, so the phone offers it beside them.
        'also_password', _by = 'identity' and _pw,
        'preview', student_submit._preview(_c.id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb := _session_class(p_session_token, p_enrollment_id);
    _course  course%rowtype;
    _today   date;
    _weights numeric;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    -- What the class's category weights total: 100, or null with no categories.
    select sum(k.weight) into _weights from category k where k.course_id = _course.id;

    return jsonb_build_object(
        'ok', true, 'v', 1,
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent,
            -- The name the class's teacher signed up with, and nothing else of theirs.
            'teacher_name', (select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code,
                                                                   'i_can', to_jsonb(t.i_can_statements)))
              from tag t join section s on s.id = t.section_id
             where s.course_id = _course.id and s.removed_at is null), '{}'::jsonb),
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'name', r.name, 'style', r.style,
                       'criteria', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'id', cr.id, 'name', cr.name, 'weight', cr.weight,
                                      'level_1_value', cr.level_1_value, 'level_2_value', cr.level_2_value,
                                      'level_3_value', cr.level_3_value, 'level_4_value', cr.level_4_value,
                                      'level_1_descriptor', cr.level_1_descriptor, 'level_2_descriptor', cr.level_2_descriptor,
                                      'level_3_descriptor', cr.level_3_descriptor, 'level_4_descriptor', cr.level_4_descriptor,
                                      -- The competencies this row counts toward, only those still on the class.
                                      'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                             from criterion_tag x
                                                             join tag t on t.id = x.tag_id
                                                             join section s on s.id = t.section_id
                                                            where x.criterion_id = cr.id
                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),
                                      'checks', coalesce((
                                          select jsonb_agg(jsonb_build_object('id', ck.id, 'level', ck.level, 'label', ck.label)
                                                           order by ck.level, ck.display_order, ck.id)
                                            from criterion_check ck where ck.criterion_id = cr.id), '[]'::jsonb))
                                    order by cr.display_order, cr.id)
                             from criterion cr where cr.rubric_id = r.id), '[]'::jsonb)) order by r.id)
              from rubric r
             where r.course_id = _course.id
               and exists (select 1 from assessment a where a.rubric_id = r.id
                              and (a.date_assigned is null or a.date_assigned <= _today))), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', a.id, 'title', a.title, 'date', a.date_assigned, 'due_date', a.due_date,
                           'score_mode', a.score_mode, 'max_points', a.max_points, 'weight', a.weight,
                           'rubric_id', a.rubric_id, 'created_at', a.created_at,
                           'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                  from assessment_tag x
                                                  join tag t on t.id = x.tag_id
                                                  join section s on s.id = t.section_id
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb),
                           'description', nullif(a.description, ''),
                           'module_name', (select m.name from module m where m.id = a.module_id and m.course_id = _course.id),
                           'category_name', k.name,
                           -- What the category counts toward the course grade as the class is set
                           -- up, or null where no percent would be true (the header says when).
                           'category_percent', case when a.score_mode = 'dibels' then null
                                                    when k.weight = 0 then 0
                                                    when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight
                                               end,
                           -- The Ministry's seven, in its order, named as shared/constants.js names them.
                           'core_competencies', coalesce((
                               select jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.ord)
                                 from (values (1, 'COM', 'Communicating'),
                                              (2, 'COL', 'Collaborating'),
                                              (3, 'CT',  'Creative Thinking'),
                                              (4, 'CRT', 'Critical & Reflective Thinking'),
                                              (5, 'PPI', 'Personal & Cultural Identity'),
                                              (6, 'PAR', 'Personal Awareness & Responsibility'),
                                              (7, 'SAR', 'Social Awareness & Responsibility')) as cc(ord, id, name)
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb),
                           -- Handouts and Links (2026111170): what the teacher put on the piece, the
                           -- ready ones only, in the order added
                           'resources', coalesce((
                               select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title,
                                                                   'url', r.url, 'page_count', r.page_count)
                                                order by r.position, r.created_at, r.id)
                                 from assessment_resource r
                                where r.assessment_id = a.id and r.status = 'ready'), '[]'::jsonb))
                       -- E9: the piece's category id, only when Show My Learning is on
                       || case when _course.show_my_learning then jsonb_build_object('category_id', k.id) else '{}'::jsonb end
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
              left join category k on k.id = a.category_id and k.course_id = _course.id
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb))
        -- E9: Show My Learning on: the class's own settings, categories, folders and learning map
        -- (get_class_bundle's shapes; no tag source_text). Off: nothing is added.
        || case when _course.show_my_learning then jsonb_build_object(
               'show_my_learning', true,
               'learning', jsonb_build_object(
                   -- E9: the twelve calculation and grading-style columns of course, and no other
                   'course', jsonb_build_object(
                       'grading_system', _course.grading_system, 'calc_method', _course.calc_method,
                       'decay_weight', _course.decay_weight, 'recent_score_limit', _course.recent_score_limit,
                       'grading_scale', _course.grading_scale, 'category_weights', _course.category_weights,
                       'round_percent', _course.round_percent, 'level_order', _course.level_order,
                       'reporting_terms', _course.reporting_terms, 'timezone', _course.timezone,
                       'folders_count_as_one', _course.folders_count_as_one,
                       'courses_count_equally', _course.courses_count_equally,
                       -- 20261112: the class's grade level, so the device rounds the course % as the
                       -- teacher's app does when Round to Whole Percent was never chosen (grades 10-12)
                       'grade_level', _course.grade_level),
                   -- 20261112: the competencies each rubric scores as a whole (rubric_tag), for the
                   -- rubrics this page lists, only those still on the class; a rubric with none is left out
                   'rubric_tags', coalesce((
                       select jsonb_object_agg(w.rubric_id::text, w.tag_ids)
                         from (select rt.rubric_id, jsonb_agg(rt.tag_id order by rt.tag_id) as tag_ids
                                 from rubric_tag rt
                                 join rubric r on r.id = rt.rubric_id and r.course_id = _course.id
                                 join tag t on t.id = rt.tag_id
                                 join section s on s.id = t.section_id
                                where s.course_id = _course.id and s.removed_at is null
                                  and exists (select 1 from assessment a where a.rubric_id = r.id
                                                 and (a.date_assigned is null or a.date_assigned <= _today))
                                group by rt.rubric_id) w), '{}'::jsonb),
                   -- E9: every category of the class, as the bundle sends them
                   'categories', coalesce((
                       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                           'display_order', c.display_order, 'calc_mode', c.calc_mode)
                                        order by c.display_order, c.id)
                         from category c where c.course_id = _course.id), '[]'::jsonb),
                   -- E9: this student's own hand-set levels, as the bundle sends them, without the teacher's reason
                   'section_overrides', coalesce((
                       select jsonb_object_agg(o.section_id::text, jsonb_build_object('level', o.level, 'date', o.updated_at))
                         from section_override o where o.enrollment_id = p_enrollment_id), '{}'::jsonb),
                   -- E9: the class's folders, as the bundle sends them
                   'competency_groups', coalesce((
                       select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                           'display_order', cg.display_order,
                                                           'counts_as_one', cg.counts_as_one)
                                        order by cg.display_order, cg.name)
                         from competency_group cg where cg.course_id = _course.id), '[]'::jsonb),
                   -- E9: the learning map: subjects, their sections not removed, their tags, in the bundle's order
                   'subjects', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'id', subj.id, 'name', subj.name, 'display_order', subj.display_order,
                                  'sections', coalesce((
                                      select jsonb_agg(jsonb_build_object(
                                                 'id', sec.id, 'name', sec.name, 'display_order', sec.display_order,
                                                 'competency_group_id', sec.competency_group_id,
                                                 'tags', coalesce((
                                                     select jsonb_agg(jsonb_build_object(
                                                                'id', t.id, 'code', t.code, 'label', t.label,
                                                                'i_can_text', t.i_can_text,
                                                                'i_can_statements', to_jsonb(t.i_can_statements),
                                                                'bank_id', t.bank_id, 'display_order', t.display_order)
                                                            order by t.display_order, t.label)
                                                       from tag t where t.section_id = sec.id), '[]'::jsonb))
                                             order by sec.display_order, sec.name)
                                        from section sec
                                       where sec.subject_id = subj.id and sec.course_id = _course.id
                                         and sec.removed_at is null), '[]'::jsonb))
                                order by subj.display_order, subj.name)
                         from subject subj where subj.course_id = _course.id), '[]'::jsonb)))
           else '{}'::jsonb end;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.reflect(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reflection jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _no    jsonb;
    _in     jsonb;
    _course course%rowtype;
    _a      assessment%rowtype;
    _k      text;
    _sense  text;
    _q      text;
    _plan   text;
    _well   text;
    _f      feedback_reflection%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if p_reflection is null or jsonb_typeof(p_reflection) <> 'object' then
        raise exception 'the reflection must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_reflection) loop
        if _k not in ('makes_sense', 'question', 'plan', 'went_well') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
        if _k <> 'makes_sense' and jsonb_typeof(p_reflection->_k) not in ('string', 'null') then
            raise exception '% must be text', _k using errcode = '22023';
        end if;
    end loop;
    _sense := p_reflection->>'makes_sense';
    if _sense is null or _sense not in ('yes', 'not_sure') or jsonb_typeof(p_reflection->'makes_sense') <> 'string' then
        raise exception 'makes_sense must be yes or not_sure' using errcode = '22023';
    end if;
    _q := nullif(btrim(p_reflection->>'question'), '');
    _plan := nullif(btrim(p_reflection->>'plan'), '');
    _well := nullif(btrim(p_reflection->>'went_well'), '');
    if char_length(_q) > 1000 or char_length(_plan) > 1000 or char_length(_well) > 1000 then
        raise exception 'each answer is 1000 characters at most' using errcode = '22023';
    end if;
    if _sense = 'not_sure' and _q is null then
        raise exception 'not_sure needs a question' using errcode = '22023';
    end if;
    if _sense = 'yes' and _plan is null then
        raise exception 'yes needs a plan' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- E6: thirty reflections and replies an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'reflect', 30);
    if _no is not null then
        return _no;
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;
    if not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.reflect_on_feedback then
        return jsonb_build_object('ok', false, 'error', 'reflect_off');
    end if;
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date);
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not exists (select 1 from grade_return g
                    where g.enrollment_id = p_enrollment_id and g.assessment_id = _a.id and g.returned_at is not null) then
        return jsonb_build_object('ok', false, 'error', 'not_returned');
    end if;
    select * into _f from feedback_reflection where assessment_id = _a.id and enrollment_id = p_enrollment_id for update;
    if found and _f.answer is not null then
        return jsonb_build_object('ok', false, 'error', 'already_answered');
    end if;
    insert into feedback_reflection (course_id, assessment_id, enrollment_id, makes_sense, question, plan, plan_at, went_well)
    values (_course.id, _a.id, p_enrollment_id, _sense, _q, _plan, case when _plan is not null then now() end, _well)
    on conflict (assessment_id, enrollment_id) do update
       set makes_sense = excluded.makes_sense, question = excluded.question, plan = excluded.plan, went_well = excluded.went_well,
           plan_at = case when excluded.plan is null then null
                          when excluded.plan is not distinct from feedback_reflection.plan then feedback_reflection.plan_at
                          else now() end,
           sent_at = case when (feedback_reflection.makes_sense, feedback_reflection.question, feedback_reflection.plan, feedback_reflection.went_well)
                               is not distinct from (excluded.makes_sense, excluded.question, excluded.plan, excluded.went_well)
                          then feedback_reflection.sent_at else now() end,
           updated_at = now()
    returning * into _f;
    return jsonb_build_object('ok', true, 'reflection', jsonb_build_object(
        'makes_sense', _f.makes_sense, 'question', _f.question, 'plan', _f.plan, 'went_well', _f.went_well, 'sent_at', _f.sent_at));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.removal_batch(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _ids bigint[];
begin
    select coalesce(array_agg(x.id), '{}') into _ids
      from (select r.id from submission_file_removal r
             where not r.done and (r.removed_at is null or r.link_dies_at <= now())
             order by (r.tries = 0) desc, case when r.tries = 0 then r.queued_at end desc, r.last_try_at, r.id
             limit greatest(1, least(coalesce(p_limit, 100), 1000))
               for update skip locked) x;
    update submission_file_removal set tries = tries + 1, last_try_at = now() where id = any (_ids);
    return jsonb_build_object(
        'ok', true,
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'bucket', r.bucket, 'path', r.path) order by r.id)
                             from submission_file_removal r where r.id = any (_ids)), '[]'::jsonb),
        'left', (select count(*) from submission_file_removal r
                  where not r.done and (r.removed_at is null or r.link_dies_at <= now()) and r.id <> all (_ids)));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.removal_done(p_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _gone  int;
    _still jsonb;
begin
    update submission_file_removal r
       set removed_at = now(), done = now() >= r.link_dies_at
     where r.id = any (coalesce(p_ids, '{}')) and not r.done
       -- a path a page has since been given cannot happen (a file's name is
       -- its row's id); if it ever did, the file would not be marked gone
       and not exists (select 1 from submission_file f where f.path = r.path or f.thumb_path = r.path)
       and not exists (select 1 from public._work_object(r.path));
    get diagnostics _gone = row_count;
    select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into _still
      from submission_file_removal r
     where r.id = any (coalesce(p_ids, '{}')) and not r.done and r.removed_at is null;
    return jsonb_build_object('ok', true, 'gone', _gone, 'still_there', _still);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.replace(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb, p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select student_submit._send_begin('replace', p_session_token, p_enrollment_id, p_assessment_id, p_pages,
                                      p_note, p_followed_plan, p_request_id);
$function$;

CREATE OR REPLACE FUNCTION student_submit.reply(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reply jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _no    jsonb;
    _in    jsonb;
    _k     text;
    _sense text;
    _more  text;
    _plan  text;
    _f     feedback_reflection%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if p_reply is null or jsonb_typeof(p_reply) <> 'object' then
        raise exception 'the reply must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_reply) loop
        if _k not in ('sense_now', 'follow_up', 'plan') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
    end loop;
    _sense := p_reply->>'sense_now';
    if jsonb_typeof(p_reply->'sense_now') is distinct from 'string' or _sense not in ('yes', 'not_sure') then
        raise exception 'sense_now must be yes or not_sure' using errcode = '22023';
    end if;
    if p_reply ? 'follow_up' and jsonb_typeof(p_reply->'follow_up') not in ('string', 'null') then
        raise exception 'follow_up must be text' using errcode = '22023';
    end if;
    _more := nullif(btrim(p_reply->>'follow_up'), '');
    if _more is not null and (_sense <> 'not_sure' or char_length(_more) > 1000) then
        raise exception 'a follow_up of 1 to 1000 characters goes only with not_sure' using errcode = '22023';
    end if;
    if p_reply ? 'plan' and jsonb_typeof(p_reply->'plan') not in ('string', 'null') then
        raise exception 'plan must be text' using errcode = '22023';
    end if;
    _plan := nullif(btrim(p_reply->>'plan'), '');
    if _plan is not null and (_sense <> 'yes' or char_length(_plan) > 1000) then
        raise exception 'a plan of 1 to 1000 characters goes only with yes' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- E6: thirty reflections and replies an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'reflect', 30);
    if _no is not null then
        return _no;
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    if not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not (select c.reflect_on_feedback from course c where c.id = (_in->>'course_id')::uuid) then
        return jsonb_build_object('ok', false, 'error', 'reflect_off');
    end if;
    select * into _f from feedback_reflection
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and course_id = (_in->>'course_id')::uuid
       for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _f.answer is null then
        return jsonb_build_object('ok', false, 'error', 'not_answered');
    end if;
    if _more is not null and _f.follow_up is not null and _f.follow_up is distinct from _more then
        return jsonb_build_object('ok', false, 'error', 'already_asked');
    end if;
    update feedback_reflection
       set sense_now = _sense,
           sense_now_at = case when sense_now is distinct from _sense then now() else coalesce(sense_now_at, now()) end,
           follow_up = coalesce(follow_up, _more),
           plan_at = case when _plan is null then plan_at when _plan is distinct from plan then now() else plan_at end,
           plan = coalesce(_plan, plan),
           updated_at = now()
     where id = _f.id
    returning * into _f;
    return jsonb_build_object('ok', true, 'reflection', jsonb_build_object(
        'sense_now', _f.sense_now, 'follow_up', _f.follow_up, 'plan', _f.plan, 'answer', _f.answer,
        'follow_up_answer', _f.follow_up_answer));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.report(p_session_token text, p_enrollment_id uuid, p_report_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _r      phone_report%rowtype;
    _course course%rowtype;
    _data   jsonb;
begin
    if p_report_id is null then
        raise exception 'a report is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _r from phone_report where id = p_report_id and course_id = (_in->>'course_id')::uuid;
    select data into _data from phone_report_student where report_id = _r.id and enrollment_id = p_enrollment_id;
    if _r.id is null or _data is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _course from course where id = _r.course_id;
    if _r.closed_at is not null
       or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
        return jsonb_build_object('ok', false, 'error', 'report_closed');
    end if;
    update student_access_code set opened_at = coalesce(opened_at, now())
     where phone_report_id = _r.id and enrollment_id = p_enrollment_id;
    return jsonb_build_object('ok', true, 'report', _data);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.revision_finish(p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_files jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb;
    _course  course%rowtype;
    _sub     submission%rowtype;
    _r       revision_request%rowtype;
    _st      jsonb;
    _state   jsonb;
    _expired boolean;
    _old     uuid;
    _version smallint;
begin
    if p_submission_id is null then
        raise exception 'a submission is needed' using errcode = '22023';
    end if;
    perform public._work_check_files(p_files);
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

    _expired := exists (select 1 from submission
                         where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id
                           and sent_by = 'student' and state = 'sending' and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);
    if _expired then
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- This student's own revision send (a version above 1), and no one else's.
    select * into _sub from submission
     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id
       and sent_by = 'student' and version > 1
       for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _sub.state = 'sent' then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'version', _sub.version,
                                  'sent_at', _sub.sent_at, 'late', _sub.is_late,
                                  'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
    end if;
    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    if (select a.students_send from assessment a where a.id = _sub.assessment_id) = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if exists (select 1 from jsonb_array_elements(p_files) x
                where not exists (select 1 from submission_file f
                                   where f.submission_id = _sub.id and f.id = (x->>'file_id')::uuid)) then
        raise exception 'a file is not one of this send''s' using errcode = '22023';
    end if;
    perform public._revision_settle(p_enrollment_id, _sub.assessment_id, false);
    select * into _r from revision_request
     where assessment_id = _sub.assessment_id and enrollment_id = p_enrollment_id and state = 'open';
    _st := case when _r.id is null then null else public._revision_state(_r.id) end;
    if _r.id is null or _st->>'state' in ('grading', 'returned') then
        perform set_config('fv.work_removal_reason', 'abandoned', true);
        delete from submission where id = _sub.id;
        perform set_config('fv.work_removal_reason', '', true);
        return jsonb_build_object('ok', false, 'error', case when _r.id is null then 'no_revision' else 'grading_started' end);
    end if;
    -- The version this request takes now, as revision_start reckons it: the
    -- revision in (replaced), else the next. A send begun under a request
    -- taken back and asked again is not it: dropped, with an answer.
    _version := coalesce((_st->>'revision_version')::smallint,
                         (select max(s.version) from submission s
                           where s.assessment_id = _sub.assessment_id and s.enrollment_id = p_enrollment_id and s.state = 'sent') + 1,
                         _r.first_version + 1);
    if _sub.version <> _version then
        perform set_config('fv.work_removal_reason', 'abandoned', true);
        delete from submission where id = _sub.id;
        perform set_config('fv.work_removal_reason', '', true);
        return jsonb_build_object('ok', false, 'error', 'request_changed');
    end if;

    _state := public._work_files_state(_sub.id, p_files);
    if _state->'missing' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'missing_pages', 'missing', _state->'missing');
    end if;
    if _state->'bad' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'bad_file', 'files', _state->'bad');
    end if;

    perform public._work_settle_files(_sub.id, p_files);
    -- The revision it replaces, if one is in: the student's own pages go;
    -- pages the teacher added to it move to the new one, after its pages.
    _old := (_st->>'revision_submission_id')::uuid;
    if _old is not null then
        if (select s.sent_by from submission s where s.id = _old) <> 'student' then
            perform set_config('fv.work_removal_reason', 'abandoned', true);
            delete from submission where id = _sub.id;
            perform set_config('fv.work_removal_reason', '', true);
            return jsonb_build_object('ok', false, 'error', 'cannot_change');
        end if;
        update submission_file f
           set submission_id = _sub.id,
               page = (select count(*) from submission_file t where t.submission_id = _sub.id) + x.rn
          from (select t.id, row_number() over (order by t.page, t.id) as rn
                  from submission_file t where t.submission_id = _old and t.added_by = 'teacher') x
         where f.id = x.id;
        perform set_config('fv.work_removal_reason', 'replace', true);
        delete from submission where id = _old;
        perform set_config('fv.work_removal_reason', '', true);
    end if;
    update submission
       set state = 'sent', sent_at = now(), updated_at = now(),
           is_late = _r.revise_by is not null and (now() at time zone public._fv_timezone(_course.timezone))::date > _r.revise_by
     where id = _sub.id
    returning * into _sub;
    -- Grading of the revision starts when the grade next changes; it is
    -- returned by the next Return that gives a grade (returned_at as it is
    -- now, read under the class's lock: a Return that held the class while
    -- this send waited came before it).
    update revision_request
       set grade_mark = (select md5(coalesce(g.working_copy::text, '')) from (select 1) one
                           left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = _sub.assessment_id),
           revision_in_at = _sub.sent_at,
           in_returned_at = (select g.returned_at from grade_return g
                              where g.enrollment_id = p_enrollment_id and g.assessment_id = _sub.assessment_id),
           updated_at = now()
     where id = _r.id;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _sub.id, 'version', _sub.version,
                              'sent_at', _sub.sent_at, 'late', _sub.is_late,
                              'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.revision_start(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb, p_note text, p_request_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb;
    _card    uuid;
    _course  course%rowtype;
    _a       assessment%rowtype;
    _r       revision_request%rowtype;
    _st      jsonb;
    _sub     submission%rowtype;
    _expired boolean;
    _version smallint;
    _n       int;
    _oldest  timestamptz;
    _late    boolean;
    _id      uuid;
begin
    if p_request_id is null then
        raise exception 'a request id is needed' using errcode = '22023';
    end if;
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    perform public._work_check_pages(p_pages);
    if char_length(coalesce(p_note, '')) > 1000 then
        raise exception 'the note is over 1000 characters' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _card := (_in->>'card_id')::uuid;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

    _expired := exists (select 1 from submission
                         where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and sent_by = 'student'
                           and request_id = p_request_id and state = 'sending'
                           and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);

    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if _expired then
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- The same request again: the same answer, nothing new made or counted.
    select * into _sub from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and sent_by = 'student' and request_id = p_request_id;
    if found then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,
                                  'version', _sub.version, 'bucket', public._work_bucket(), 'late', _sub.is_late,
                                  'finish_by', case when _sub.state = 'sending' then _sub.created_at + public._work_hold() end,
                                  'files', case when _sub.state = 'sending' then public._work_upload_json(_sub.id) else '[]'::jsonb end);
    end if;

    perform public._revision_settle(p_enrollment_id, _a.id, false);
    select * into _r from revision_request where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'open';
    if _r.id is null then
        return jsonb_build_object('ok', false, 'error', 'no_revision');
    end if;
    _st := public._revision_state(_r.id);
    if _st->>'state' in ('grading', 'returned') then
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;
    -- A revision in and not yet graded is replaced at the finish, and keeps
    -- its version; otherwise this is the next version.
    _version := coalesce((_st->>'revision_version')::smallint,
                         (select max(s.version) from submission s
                           where s.assessment_id = _a.id and s.enrollment_id = p_enrollment_id and s.state = 'sent') + 1,
                         _r.first_version + 1);

    -- Twenty sends an hour for one card, counted as Batch B counts them.
    delete from send_log where at < now() - interval '1 day';
    select count(*), min(at) into _n, _oldest from send_log where card_id = _card and at > now() - interval '1 hour';
    if _n >= 20 then
        return jsonb_build_object('ok', false, 'error', 'too_many',
                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));
    end if;

    -- A send this student started for the piece and never finished goes.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';
    perform set_config('fv.work_removal_reason', '', true);
    if public._work_class_full(_course.id, p_pages) is not null then
        return jsonb_build_object('ok', false, 'error', 'class_full');
    end if;

    _late := _r.revise_by is not null and (now() at time zone public._fv_timezone(_course.timezone))::date > _r.revise_by;
    insert into send_log (card_id) values (_card);
    _id := public._work_begin(_course.id, _a.id, p_enrollment_id, 'student', 'new', null,
                              p_pages, p_note, null, _late, _card, p_request_id);
    update submission set version = _version where id = _id;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _id, 'state', 'sending', 'version', _version,
                              'bucket', public._work_bucket(), 'late', _late,
                              'finish_by', now() + public._work_hold(),
                              'files', public._work_upload_json(_id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.revision_unsend(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in        jsonb;
    _course    uuid;
    _r         revision_request%rowtype;
    _st        jsonb;
    _old       uuid;
    _cancelled int;
    _pages     int;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _course := (_in->>'course_id')::uuid;
    perform public._grade_return_lock_first(_course);
    perform public._work_drop_expired(_course);
    if not exists (select 1 from assessment a where a.id = p_assessment_id and a.course_id = _course) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'sending'
       and sent_by = 'student' and version > 1;
    get diagnostics _cancelled = row_count;
    perform set_config('fv.work_removal_reason', '', true);

    perform public._revision_settle(p_enrollment_id, p_assessment_id, false);
    select * into _r from revision_request where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'open';
    _st := case when _r.id is null then null else public._revision_state(_r.id) end;
    _old := (_st->>'revision_submission_id')::uuid;
    if _r.id is null
       and (select r.state from revision_request r where r.assessment_id = p_assessment_id and r.enrollment_id = p_enrollment_id
             order by r.created_at desc, r.id limit 1) = 'done'
       and exists (select 1 from submission s
                    where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id and s.state = 'sent' and s.version > 1) then
        -- the revision was returned: it is the teacher's now, as a graded first version is
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;
    if _old is null then
        return jsonb_build_object('ok', true, 'unsent', false, 'cancelled', _cancelled > 0, 'pages', 0);
    end if;
    if _st->>'state' <> 'sent' then
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;
    if (select s.sent_by from submission s where s.id = _old) <> 'student'
       or exists (select 1 from submission_file f where f.submission_id = _old and f.added_by = 'teacher') then
        return jsonb_build_object('ok', false, 'error', 'cannot_change');
    end if;
    select count(*) into _pages from submission_file f where f.submission_id = _old;
    perform set_config('fv.work_removal_reason', 'unsend', true);
    delete from submission where id = _old;
    perform set_config('fv.work_removal_reason', '', true);
    update revision_request set grade_mark = null, revision_in_at = null, in_returned_at = null, updated_at = now() where id = _r.id;
    return jsonb_build_object('ok', true, 'unsent', true, 'cancelled', _cancelled > 0, 'pages', _pages);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.seen(p_session_token text, p_enrollment_id uuid, p_assessment_ids uuid[], p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _n  int;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- grade_return is written only under the class's lock (2026110902, 4).
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    insert into grade_return (enrollment_id, assessment_id, seen_at)
    select p_enrollment_id, a.id, clock_timestamp()
      from assessment a
     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid
       -- a DIBELS benchmark is a reading record: nothing is returned, so nothing is seen (2026110905)
       and a.score_mode <> 'dibels'
       and exists (select 1 from enrollment e where e.id = p_enrollment_id)
     order by a.id
    on conflict (enrollment_id, assessment_id) do update set seen_at = excluded.seen_at;
    get diagnostics _n = row_count;
    return jsonb_build_object('ok', true, 'seen', _n);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.send_finish(p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_files jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in      jsonb;
    _course  course%rowtype;
    _sub     submission%rowtype;
    _target  submission%rowtype;
    _a       assessment%rowtype;
    _w       jsonb;
    _state   jsonb;
    _expired boolean;
    _pages   int;
    _theirs  int;
begin
    if p_submission_id is null then
        raise exception 'a submission is needed' using errcode = '22023';
    end if;
    perform public._work_check_files(p_files);
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

    -- Has this send lost its place? Looked at before the class's expired
    -- sends are dropped, this one among them.
    _expired := exists (select 1 from submission
                         where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id
                           and sent_by = 'student' and state = 'sending' and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);
    if _expired then
        -- It could be finished for _work_hold after its first start and no
        -- longer. It is gone and its files are queued: start again.
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- This student's own send, and no one else's.
    select * into _sub from submission
     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id and sent_by = 'student'
       for update;
    if not found then
        -- never there, or dropped: a newer send took its place, or the
        -- piece's work was changed under it
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _sub.state = 'sent' then
        -- the same finish again
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'sent_at', _sub.sent_at,
                                  'late', _sub.is_late,
                                  'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
    end if;
    -- A revision's pages are Send My Revision's (revision_finish), never
    -- this function's. Only revision_start makes an unfinished send above
    -- version 1 (every send _send_begin makes is version 1 until it is
    -- handed in), so version is how it is told. Refused before anything else
    -- is asked, and nothing is changed: the send keeps its place and its
    -- pages, and revision_finish can still hand it in.
    if _sub.version <> 1 then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    -- Everything a start asks is asked again now, at the moment of handing
    -- in: Send Work, the piece still taking work, still open; and late is
    -- what it is now, not what it was when the send started.
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = _sub.assessment_id;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    _w := _work_window(_a.id);
    -- Ruling 106: a send started while the piece was open can be finished
    -- after its last day, within its two hours, and is marked Late below.
    -- "Started while open" is the piece's dates as they are now, asked of
    -- the day the send started (its first start, in the class's time zone,
    -- as _work_window counts days): a send started on the last day passes;
    -- a send the teacher closed under it, by moving the last day to before
    -- the day it started, does not.
    if not (_w->>'open')::boolean
       and ((_sub.created_at at time zone public._fv_timezone(_course.timezone))::date <= (_w->>'closes_on')::date) is not true then
        return jsonb_build_object('ok', false, 'error', 'work_closed', 'closed_on', _w->'closes_on');
    end if;
    if exists (select 1 from jsonb_array_elements(p_files) x
                where not exists (select 1 from submission_file f
                                   where f.submission_id = _sub.id and f.id = (x->>'file_id')::uuid)) then
        raise exception 'a file is not one of this send''s' using errcode = '22023';
    end if;

    -- Nothing is handed in until every page is up (Colin, Nov 9): each page
    -- and its thumbnail must be in storage, read from storage's own table.
    _state := public._work_files_state(_sub.id, p_files);
    if _state->'missing' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'missing_pages', 'missing', _state->'missing');
    end if;
    if _state->'bad' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'bad_file', 'files', _state->'bad');
    end if;

    if _sub.intent = 'replace' then
        select * into _target from submission where id = _sub.target_id and state = 'sent' for update;
        if not found then
            -- cannot happen: an unfinished send goes with the work it was to replace
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if _grading_started(p_enrollment_id, _sub.assessment_id) then
            -- The teacher started grading while the new pages were going
            -- up. What was sent stays; the new pages are dropped.
            perform set_config('fv.work_removal_reason', 'abandoned', true);
            delete from submission where id = _sub.id;
            perform set_config('fv.work_removal_reason', '', true);
            return jsonb_build_object('ok', false, 'error', 'grading_started');
        end if;
        -- 30 pages at most in one submission (ruling 88), asked again now:
        -- the teacher may have added pages to the old work since the start
        -- asked, and they stay. The send stays too: finish it with fewer
        -- pages (the ones left out are deleted) or start again.
        select count(*) into _theirs from submission_file f where f.submission_id = _target.id and f.added_by = 'teacher';
        if _theirs + jsonb_array_length(p_files) > 30 then
            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));
        end if;
    else
        -- Ruling 107: a new send for a piece whose work in is the teacher's
        -- (not on paper) joins the teacher's pages, by the rule a Replace
        -- follows, whether that work was there when the send started or
        -- was handed in while its pages went up. Every other work in is
        -- answered as before. (A revision's pages never come here: refused
        -- above.)
        select * into _target from submission
         where assessment_id = _sub.assessment_id and enrollment_id = p_enrollment_id and state = 'sent'
         order by version desc limit 1
           for update;
        if found then
            if _target.sent_by <> 'teacher' or _target.on_paper
               or exists (select 1 from revision_request r
                           where r.assessment_id = _sub.assessment_id and r.enrollment_id = p_enrollment_id and r.state = 'open') then
                -- The teacher added this student's work while the pages were going up.
                perform set_config('fv.work_removal_reason', 'abandoned', true);
                delete from submission where id = _sub.id;
                perform set_config('fv.work_removal_reason', '', true);
                return jsonb_build_object('ok', false, 'error', 'already_sent');
            end if;
            if _grading_started(p_enrollment_id, _sub.assessment_id) then
                -- As for a Replace: what was sent stays; the new pages are dropped.
                perform set_config('fv.work_removal_reason', 'abandoned', true);
                delete from submission where id = _sub.id;
                perform set_config('fv.work_removal_reason', '', true);
                return jsonb_build_object('ok', false, 'error', 'grading_started');
            end if;
            -- As for a Replace (ruling 88): with the teacher's pages, 30 at
            -- most. The send stays; finish it with fewer pages or start again.
            select count(*) into _theirs from submission_file f where f.submission_id = _target.id and f.added_by = 'teacher';
            if _theirs + jsonb_array_length(p_files) > 30 then
                return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));
            end if;
        end if;
    end if;

    _pages := public._work_settle_files(_sub.id, p_files);
    if _target.id is not null then
        -- The student's old pages go. Pages the teacher added to the old
        -- work are not the student's to remove: they move to the new work,
        -- after the new pages, each keeping its file.
        update submission_file f
           set submission_id = _sub.id, page = _pages + x.rn
          from (select t.id, row_number() over (order by t.page, t.id) as rn
                  from submission_file t where t.submission_id = _target.id and t.added_by = 'teacher') x
         where f.id = x.id;
        -- Let go of what it replaces first: an unfinished send goes with
        -- its target, and this one is about to take its place.
        update submission set intent = 'new', target_id = null where id = _sub.id;
        -- An Add as More Pages the teacher has started on the old work and
        -- not finished is not the student's to drop (ruling 92): it now adds
        -- to this work, and is finished onto it.
        update submission set target_id = _sub.id
         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';
        perform set_config('fv.work_removal_reason', 'replace', true);
        delete from submission where id = _target.id;
        perform set_config('fv.work_removal_reason', '', true);
    end if;
    -- Late: finished after the due date, or (ruling 106) after the piece's
    -- last day.
    update submission
       set state = 'sent', intent = 'new', target_id = null, version = coalesce(_target.version, version),
           is_late = (_w->>'late')::boolean or (_w->>'open')::boolean is false, sent_at = now(), updated_at = now()
     where id = _sub.id
    returning * into _sub;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _sub.id, 'sent_at', _sub.sent_at,
                              'late', _sub.is_late,
                              'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.send_paths(p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in  jsonb;
    _sub submission%rowtype;
    _no  jsonb;
begin
    if p_submission_id is null then
        raise exception 'a submission is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- This student's own send, not finished, in the session's class.
    select * into _sub from submission
     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = (_in->>'course_id')::uuid
       and sent_by = 'student' and state = 'sending';
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _sub.created_at < now() - public._work_hold() then
        -- It has lost its place; the next call that finishes or starts
        -- work in the class drops it.
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    -- E6: each finish the function will read files for counts, twenty an
    -- hour for a card (send-finish and revise-finish together).
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'finish', 20);
    if _no is not null then
        return _no;
    end if;
    return jsonb_build_object('ok', true, 'submission_id', _sub.id, 'assessment_id', _sub.assessment_id,
                              'version', _sub.version, 'finish_by', _sub.created_at + public._work_hold(),
                              'bucket', public._work_bucket(), 'files', public._work_upload_json(_sub.id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.send_start(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb, p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select student_submit._send_begin('new', p_session_token, p_enrollment_id, p_assessment_id, p_pages,
                                      p_note, p_followed_plan, p_request_id);
$function$;

CREATE OR REPLACE FUNCTION student_submit.slip_roster(p_teacher_id uuid, p_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
    _course  uuid;
    _closed  timestamptz;
    _ids     jsonb;
begin
    if p_kind is null or p_kind not in ('questionnaire', 'report') then
        raise exception 'kind must be questionnaire or report' using errcode = '22023';
    end if;
    perform _as_teacher(p_teacher_id);
    if p_kind = 'questionnaire' then
        select q.course_id into _course from questionnaire q where q.id = p_target_id and fv_owns_course(q.course_id);
    else
        select r.course_id, r.closed_at into _course, _closed from phone_report r where r.id = p_target_id and fv_owns_course(r.course_id);
    end if;
    if _course is null then
        raise exception 'not found' using errcode = 'P0002';
    end if;
    if _closed is not null then
        raise exception 'this report is closed' using errcode = 'FVS01';
    end if;
    select coalesce(jsonb_agg(e.id order by e.roster_position nulls last, e.id), '[]'::jsonb) into _ids
      from enrollment e
     where e.course_id = _course and e.withdrawn_at is null and fv_owns_enrollment(e.id)
       and (p_kind = 'questionnaire'
            or exists (select 1 from phone_report_student s where s.report_id = p_target_id and s.enrollment_id = e.id));
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
    return _ids;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.submit(p_token text, p_answers jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _s       session%rowtype;
    _c       student_access_code%rowtype;
    _q       questionnaire%rowtype;
    _course  course%rowtype;
    _why     text;
    _parts   uuid[];
    _qid     text;
    _val     jsonb;
    _x       question%rowtype;
    _clean   jsonb;
    _clean_by_part jsonb := '{}'::jsonb;
    _part    uuid;
    _rid     uuid;
    _term    text;
    _core    text;
    _lvl     jsonb;
    _now     timestamptz := now();
    _result  jsonb;
begin
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('submit', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       for update;
    if not found then
        perform _log('submit', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    -- A second tap: the first answer, nothing saved twice.
    if _s.submitted_at is not null then
        return _s.result;
    end if;
    if _s.expires_at < _now then
        perform _log('submit', 'expired', p_ip_hash, _s.code_id);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    select * into _c from student_access_code where id = _s.code_id for update;
    -- A report code opens a report to read; there's nothing on it to send.
    if _c.phone_report_id is not null then
        perform _log('submit', 'closed', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'closed');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    -- The slip alone isn't enough: verify() has to have matched.
    if _s.checked_at is null then
        perform _log('submit', 'not_checked', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _course from course where id = _q.course_id;
    if _c.revoked_at is not null or _c.used_at is not null then
        perform _log('submit', case when _c.used_at is not null then 'used' else 'revoked' end,
                     p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', case when _c.used_at is not null then 'used' else 'not_found' end);
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null or _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('submit', coalesce(_why, 'closed'), p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', coalesce(_why, 'closed'));
    end if;
    if (select count(*) from attempt
         where course_id = _q.course_id and route = 'submit' and outcome = 'ok'
           and at > _now - interval '1 minute') >= 120 then
        perform _log('submit', 'busy', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    if jsonb_typeof(p_answers) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(p_answers)) > 80
       or octet_length(p_answers::text) > 100000 then
        perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    -- The parts the slip opened: the questionnaire and its open Goal Check-In.
    select array_agg(id) into _parts from (
        select _q.id as id
        union all
        select g.id from questionnaire g
         where g.parent_id = _q.id and g.kind = 'goal_checkin' and g.is_on
           and _closed_reason(g, _course.timezone) is null
    ) p;

    for _qid, _val in select * from jsonb_each(p_answers) loop
        if _qid !~ '^[0-9a-fA-F-]{36}$' then
            perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'invalid');
        end if;
        select * into _x from question
         where id = _qid::uuid and not archived and questionnaire_id = any(_parts);
        if not found then
            perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end if;
        begin
            _clean := _clean_answer(_x.kind, _x.options, _x.core_ids, _val);
        exception when others then
            perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end;
        if _clean is not null then
            _clean_by_part := jsonb_set(_clean_by_part, array[_x.questionnaire_id::text],
                coalesce(_clean_by_part->(_x.questionnaire_id::text), '{}'::jsonb)
                  || jsonb_build_object(_x.id::text, _clean || jsonb_build_object('kind', _x.kind)));
        end if;
    end loop;
    if _clean_by_part = '{}'::jsonb then
        perform _log('submit', 'empty', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'empty');
    end if;

    -- The class's reporting term for self-assessments: 'T' + the period, or
    -- '' for a class without terms (as the client keys them).
    _term := case when _q.report_period is not null
                   and jsonb_typeof(_course.reporting_terms) = 'array'
                   and jsonb_array_length(_course.reporting_terms) > 0
                  then 'T' || _q.report_period else '' end;

    foreach _part in array _parts loop
        if not (_clean_by_part ? _part::text) then continue; end if;
        insert into response (questionnaire_id, enrollment_id, via, submitted_at)
        values (_part, _c.enrollment_id, 'link', _now)
        returning id into _rid;
        for _qid, _val in select * from jsonb_each(_clean_by_part->(_part::text)) loop
            insert into answer (response_id, question_id, value_num, value_text, value_json)
            values (_rid, _qid::uuid, (_val->>'num')::numeric, _val->>'text', _val->'json');
            if _val->>'kind' = 'scale4' and _val->'json' ? 'levels' then
                for _core, _lvl in select * from jsonb_each(_val->'json'->'levels') loop
                    insert into core_self_assessment (enrollment_id, core_id, term_key, level, body)
                    values (_c.enrollment_id, _core, _term, (_lvl #>> '{}')::int,
                            case when jsonb_typeof(_val->'json'->'why') = 'object'
                                 then _val->'json'->'why'->>_core
                                 else _val->'json'->>'why' end)
                    on conflict (enrollment_id, core_id, term_key)
                    do update set level = excluded.level,
                                  body = coalesce(excluded.body, core_self_assessment.body),
                                  updated_at = now();
                end loop;
            end if;
        end loop;
    end loop;

    update student_access_code set used_at = _now where id = _c.id;
    _result := jsonb_build_object('ok', true, 'submitted_at', _now);
    update session set submitted_at = _now, result = _result where id = _s.id;
    perform _log('submit', 'ok', p_ip_hash, _c.id, _q.course_id);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.unsend(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in        jsonb;
    _course    course%rowtype;
    _a         assessment%rowtype;
    _w         jsonb;
    _sent      submission%rowtype;
    _cancelled int;
    _pages     int;
    _kept      int;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- The lock a grade's save takes. An Unsend and the first level saved for
    -- the piece take turns: whichever is second sees what the first did.
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;
    perform public._work_drop_expired(_course.id);
    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- A send of the student's own that is not finished is theirs to drop,
    -- always.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';
    get diagnostics _cancelled = row_count;
    perform set_config('fv.work_removal_reason', '', true);

    select * into _sent from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sent'
     order by version desc limit 1
       for update;
    if not found then
        -- Nothing is handed in: also the answer to an Unsend sent twice.
        return jsonb_build_object('ok', true, 'unsent', false, 'cancelled', _cancelled > 0, 'pages', 0, 'kept', 0);
    end if;
    if _sent.sent_by <> 'student' then
        return jsonb_build_object('ok', false, 'error', 'cannot_change');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    _w := _work_window(_a.id);
    if not (_w->>'open')::boolean then
        -- Unsent now, it could not be sent again.
        return jsonb_build_object('ok', false, 'error', 'work_closed', 'closed_on', _w->'closes_on');
    end if;
    if _grading_started(p_enrollment_id, _a.id) then
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;

    select count(*) filter (where f.added_by = 'student'), count(*) filter (where f.added_by = 'teacher')
      into _pages, _kept
      from submission_file f where f.submission_id = _sent.id;
    perform set_config('fv.work_removal_reason', 'unsend', true);
    if _kept = 0 then
        -- An Add as More Pages the teacher has started on this work and not
        -- finished is not the student's to drop (ruling 92). With no page of
        -- the teacher's left to add to, it lets go of the work: finished, it
        -- hands its pages in as the teacher's work for the piece.
        update submission set intent = 'new', target_id = null
         where target_id = _sent.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';
        delete from submission where id = _sent.id;
    else
        -- The teacher added pages to this work. They are not the student's
        -- to remove: the student's own pages go, the teacher's close up to
        -- pages 1, 2, 3, and the work stays as the teacher's, without the
        -- student's note.
        delete from submission_file where submission_id = _sent.id and added_by = 'student';
        update submission_file f
           set page = x.rn
          from (select t.id, row_number() over (order by t.page, t.id) as rn
                  from submission_file t where t.submission_id = _sent.id) x
         where f.id = x.id;
        update submission
           set sent_by = 'teacher', note = null, followed_plan = null, card_id = null, request_id = null, updated_at = now()
         where id = _sent.id;
    end if;
    perform set_config('fv.work_removal_reason', '', true);
    return jsonb_build_object('ok', true, 'unsent', true, 'cancelled', _cancelled > 0, 'pages', _pages, 'kept', _kept);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.verify(p_token text, p_birthday text, p_student_number text, p_password text, p_code_hmac text, p_pw_hmac text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _s      session%rowtype;
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _course course%rowtype;
    _why    text;
    _dob    date;
    _num    text;
    _pw     text;
    _plain  boolean;
    _given  date;
    _match  boolean := false;
    _by_pw  boolean := false;
    _misses int;
begin
    if (p_code_hmac is not null and p_code_hmac !~ '^[0-9a-f]{64}$')
       or (p_pw_hmac is not null and p_pw_hmac !~ '^[0-9a-f]{64}$') then
        raise exception 'malformed tag' using errcode = '22023';
    end if;
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       for update;
    if not found or _s.expires_at < now() then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _c from student_access_code where id = _s.code_id for update;
    if _c.questionnaire_id is null or _c.revoked_at is not null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.used_at is not null then
        perform _log('open', 'used', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'used');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null or _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('open', coalesce(_why, 'closed'), p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', coalesce(_why, 'closed'), 'opens_on', _q.opens_on);
    end if;

    -- Matched already (a second tap, or the page reloaded): the questions again.
    if _s.checked_at is not null then
        return jsonb_build_object('ok', true) || _payload(_c.id);
    end if;

    -- Five wrong tries on a slip, across every time it was scanned, and the
    -- slip stops working: one count, so "tries left" is always true.
    select count(*) into _misses from attempt where code_id = _c.id and outcome = 'wrong_identity';
    if _misses >= 5 then
        perform _log('open', 'locked', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'slip_locked');
    end if;

    select s.date_of_birth, nullif(_norm(s.student_number), ''), nullif(_norm(s.slip_password), '')
      into _dob, _num, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    -- The stored password counts only until the end of the old slips.
    _plain := _pw is not null and now() < _slip_old_until();

    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;
    _by_pw := _plain and p_password is not null and _norm(p_password) = _pw;
    _match := (_dob is not null and _given is not null and _given = _dob)
           or (_num is not null and _norm(p_student_number) = _num)
           or (_c.pw_hmac is not null and p_pw_hmac is not null and p_pw_hmac = _c.pw_hmac)
           or _by_pw;

    if not _match and p_password is null and p_pw_hmac is not null and _c.pw_hmac is null and _plain then
        -- This slip's password has no tag yet and the stored one is on file:
        -- ask the edge for the typed password. Nothing is counted or logged:
        -- the second call counts this try, once.
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'fallback', true);
    end if;

    if not _match then
        update session set check_fails = check_fails + 1 where id = _s.id;
        perform _log('open', 'wrong_identity', p_ip_hash, _c.id, _q.course_id);
        if _misses + 1 >= 5 then
            return jsonb_build_object('ok', false, 'error', 'slip_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', 4 - _misses);
    end if;

    -- The printed password matched the stored one: keep its tag on this
    -- slip, bound to this slip's own code (the phone opened it with that
    -- code), so the next check compares tags. Once no live slip needs the
    -- stored password, the trigger clears it.
    if _by_pw and _c.pw_hmac is null and p_pw_hmac is not null
       and _c.code_hmac is not null and p_code_hmac = _c.code_hmac then
        update student_access_code set pw_hmac = p_pw_hmac where id = _c.id;
    end if;

    update session set checked_at = now() where id = _s.id;
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;
    perform _log('open', 'verified', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object('ok', true) || _payload(_c.id);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.verify_card(p_code_hmac text, p_key_id text, p_birthday text, p_student_number text, p_password_hmac text, p_session_token text, p_ip_hash text, p_add boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _found   jsonb;
    _card    uuid;
    _k       student_card%rowtype;
    _course  course%rowtype;
    _dob     date;
    _num     text;
    _given   date;
    _session device_session%rowtype;
    _token   text;
    _ends    timestamptz;
    _row     int;
    _week    int;
begin
    -- The password arrives as its tag (made from the card's code and the
    -- four digits typed), or null when none was typed. Never the digits.
    if p_password_hmac is not null and p_password_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed password tag' using errcode = '22023';
    end if;
    _found := _card_lookup(p_code_hmac, p_key_id, p_ip_hash);
    _card := (_found->>'card_id')::uuid;
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select * into _k from student_card where id = _card for update;
    if _k.locked_at is not null or _k.stopped_at is not null then
        -- Locked or replaced while this call waited for the row.
        return jsonb_build_object('ok', false, 'error', case when _k.stopped_at is not null then 'card_stopped' else 'card_locked' end);
    end if;
    select c.* into _course from enrollment e join course c on c.id = e.course_id where e.id = _k.enrollment_id;

    -- The card's own password: one printed on this card still works after a
    -- birthday or number is added, whatever is printed for the student later.
    select s.date_of_birth, nullif(_norm(s.student_number), '')
      into _dob, _num
      from enrollment e join student s on s.id = e.student_id
     where e.id = _k.enrollment_id;
    if _dob is null and _num is null and _k.pw_hmac is null then
        -- Nothing on file to check against: no try is counted. card() says the same.
        perform _log('card', 'no_identity', p_ip_hash, _k.id, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;

    if not coalesce((_dob is not null and _given is not null and _given = _dob)
                 or (_num is not null and _norm(p_student_number) = _num)
                 or (_k.pw_hmac is not null and p_password_hmac is not null and p_password_hmac = _k.pw_hmac), false) then
        -- Five wrong tries in a row lock it (a right answer starts that
        -- count again), and so do fifteen inside 7 days whatever came
        -- between. "Tries left" is the nearer of the two, so it is always true.
        update student_card
           set wrong_tries = wrong_tries + 1,
               wrong_times = array(select t from unnest(wrong_times) t where t > clock_timestamp() - interval '7 days')
                             || clock_timestamp()
         where id = _k.id
        returning wrong_tries, cardinality(wrong_times) into _row, _week;
        perform _log('card', 'wrong_identity', p_ip_hash, _k.id, _course.id);
        if _row >= 5 or _week >= 15 then
            update student_card set locked_at = now() where id = _k.id;
            return jsonb_build_object('ok', false, 'error', 'card_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', least(5 - _row, 15 - _week));
    end if;

    -- Matched. From the start screen that is a fresh session: whoever was
    -- signed in on this device is signed out. Only Add Another Card (p_add)
    -- joins the session the device has.
    _ends := _midnight(_course.timezone);
    select * into _session from _device_session(p_session_token);
    if _session.id is not null and not coalesce(p_add, false) then
        delete from device_session where id = _session.id;
        _session := null;
    end if;
    if _session.id is null then
        _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
        insert into device_session (token_hash, expires_at)
        values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _ends)
        returning * into _session;
    elsif _ends < _session.expires_at then
        update device_session set expires_at = _ends where id = _session.id returning * into _session;
    end if;
    insert into device_session_enrollment (session_id, enrollment_id, card_id)
    values (_session.id, _k.enrollment_id, _k.id)
    on conflict (session_id, enrollment_id) do update set card_id = excluded.card_id;
    update student_card set last_opened_at = now(), wrong_tries = 0 where id = _k.id;

    perform _log('card', 'verified', p_ip_hash, _k.id, _course.id);
    return jsonb_build_object(
        'ok', true, 'session_token', _token, 'expires_at', _session.expires_at,
        'enrollment_id', _k.enrollment_id, 'classes', _session_classes(_session.id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'send_work', _course.send_work,
        -- E1: the page asks feedback when Send Work or Reflect on Feedback is on
        'reflect_on_feedback', _course.reflect_on_feedback,
        'assessments', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', a.id,
                       'students_send', a.students_send,
                       -- can work be sent for it right now
                       'open', _course.send_work and a.students_send <> 'nothing' and (w.j->>'open')::boolean,
                       'closes_on', w.j->'closes_on',
                       'late_now', w.j->'late',
                       'sent', case when s.id is null then null else jsonb_build_object(
                                   'submission_id', s.id, 'sent_at', s.sent_at, 'sent_by', s.sent_by,
                                   'on_paper', s.on_paper, 'is_late', s.is_late, 'note', s.note,
                                   'pages', (select count(*) from submission_file f where f.submission_id = s.id),
                                   'grading', g.started,
                                   -- Unsend and Replace: the student's own send, not yet being graded, still open
                                   'can_change', s.sent_by = 'student' and not g.started and _course.send_work
                                                 and a.students_send <> 'nothing' and (w.j->>'open')::boolean,
                                   -- Ruling 107: the teacher's pages, not on paper, not yet being graded, no
                                   -- revision open, still open: a send (send_start) joins them
                                   'can_send', s.sent_by = 'teacher' and not s.on_paper and not g.started and _course.send_work
                                               and a.students_send <> 'nothing' and (w.j->>'open')::boolean
                                               and not exists (select 1 from revision_request r
                                                                where r.assessment_id = a.id and r.enrollment_id = p_enrollment_id
                                                                  and r.state = 'open')) end,
                       -- a send of this student's that is not finished and still holds its place
                       'sending', case when u.id is null then null else jsonb_build_object(
                                      'submission_id', u.id, 'intent', u.intent, 'started_at', u.created_at,
                                      'finish_by', u.created_at + public._work_hold(),
                                      'pages', (select count(*) from submission_file f where f.submission_id = u.id)) end)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
             cross join lateral (select _work_window(a.id) as j) w
              left join lateral (select x.* from submission x
                                  where x.assessment_id = a.id and x.enrollment_id = p_enrollment_id and x.state = 'sent'
                                  order by x.version desc limit 1) s on true
              left join lateral (select x.* from submission x
                                  where x.assessment_id = a.id and x.enrollment_id = p_enrollment_id
                                    and x.state = 'sending' and x.sent_by = 'student'
                                    and x.created_at >= now() - public._work_hold() limit 1) u on true
             cross join lateral (select s.id is not null and _grading_started(p_enrollment_id, a.id) as started) g
             where a.course_id = _course.id
               and (w.j->>'listed')::boolean
               and (a.students_send <> 'nothing' or s.id is not null)), '[]'::jsonb));
end;
$function$;
