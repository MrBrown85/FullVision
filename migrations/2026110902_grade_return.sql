-- Draft and Returned (2026-11-09). Student page build plan, S0-M1 (Batch A).
-- docs/plans/student-page-build-plan.md 1.2; DECISIONS, "Grades, photos and
-- sign-in on the student page" 1 to 3 and "Student page build answers" 3 to 5.
--
-- What is needed: every grade is Draft or Returned. The teacher's working
-- copy stays in score, tag_score, rubric_score and rubric_check_score, as
-- now. Beside it, grade_return keeps one row per student per assessment
-- saying what the student has been given. Nothing reads it yet: with the
-- build switch off (every class, after this migration) every save is
-- returned at once and every screen and number is as today.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. course.student_page_enabled  boolean, default false. The build switch.
--    course.return_grades         'on_return' (When I Return Them) or
--                                 'on_save' (As Soon As I Save), or null.
--    Null means no choice made yet and works as on_save. The column is added
--    with no default, so every existing class gets null; then the default
--    becomes 'on_return', so a class made from now on starts there:
--      create_course       names its columns, so a new class gets the
--                          defaults: on_return, switch off. Not changed.
--      duplicate_course    the same: the copy is a new class. Not changed.
--      import_json_restore takes both from the backup's course row; a backup
--                          from before today has neither, and restores as
--                          null and off (patched below).
--      update_course       takes both in its patch (patched below).
--      get_class_bundle    returns the whole course row, so both come with
--                          it. Not changed.
--
-- 2. grade_return (enrollment_id, assessment_id), one row per student per
--    assessment:
--      is_draft       the working copy holds something the student has not
--                     been given
--      returned_at    when the grade was last returned; null = never
--      returned_copy  the grade as last returned, kept only while a newer
--                     draft sits on a returned grade
--      previous_copy  the grade the student had before the newest return
--      updated_at     when a returned grade last changed for the student
--      seen_at        when the student last opened this piece
--    Teachers read their own rows (fv_owns_enrollment). Nobody writes the
--    table directly: only the triggers and functions below do.
--
-- 3. A COPY of a grade is this JSON, the same in returned_copy, previous_copy
--    and everything a student is sent. shared/grade-state.js and the edge
--    function rely on it:
--      { "v": 1,
--        "value": 7,          score.value: points, a Complete (1) or
--                             Incomplete (0) mark, or the Overall level;
--                             null when there is none
--        "modifier": 0,       score.modifier, the + (1) or - (-1) on value
--        "comment": "...",    score.comment, the Overall Comment; null when
--                             blank
--        "tags":     { "<tag id>":       { "value": 3, "modifier": 1, "comment": null } },
--        "criteria": { "<criterion id>": { "value": 3, "modifier": 0,
--                                           "comment": "...", "beyond": null } },
--        "checks":   [ "<criterion_check id>", ... ]   ticked boxes, sorted
--      }
--    A row with no level and no note is left out; a grade with nothing in it
--    is SQL null, not an empty object. Two things on the score row are NOT in
--    a copy and never make a draft: score.status (Missing, Excused and Late
--    show and count as soon as they are set) and score.report_note (the
--    teacher's Note for the Report, never shown to the student).
--
-- 4. Triggers on the four score tables keep grade_return right for any
--    writer: the RPCs, an old cached client, the grade-scans skill. Each
--    fires once per statement, works out each touched cell's copy BEFORE the
--    statement (from the rows it changed) and NOW, and does nothing when they
--    are equal: a save that changes nothing, or the same save sent twice, is
--    not a draft. Otherwise, for that student and assessment:
--
--    The class holds grades (student_page_enabled and return_grades =
--    'on_return'):
--      never returned               -> Draft. The student is given nothing.
--      returned, not a draft        -> Draft; returned_copy := the copy
--                                      before, so the student keeps it.
--      a draft on a returned grade  -> back to Returned, copy dropped, if the
--                                      working copy now equals returned_copy
--                                      (the teacher put it back, or Undo).
--      a draft never returned       -> no longer a draft if nothing is left.
--
--    Any other class (switch off, on_save, or no choice made): the save is
--    returned at once.
--      nothing returned before      -> returned_at := now.
--      a returned grade changes     -> returned_at := now, and:
--          the student had seen it (seen_at >= returned_at):
--                                      previous_copy := the copy before,
--                                      updated_at := now
--          else it now equals previous_copy (changed and put back):
--                                      previous_copy and updated_at cleared
--          else previous_copy is set (changed again before they looked):
--                                      updated_at := now
--          else                        nothing: they never saw another grade
--      a draft left from on_return  -> returned as return_grades would.
--      nothing is left              -> the row goes back to "never returned".
--
--    An UPDATE that only points a row at another criterion, competency or
--    checkbox (move_rubric_scores) keeps the state and re-points the ids
--    inside returned_copy and previous_copy. A cell whose assessment or
--    enrollment is being deleted is left alone. While import_json_restore
--    runs (fv.restoring) the triggers stand aside and the restore sets the
--    state itself (7).
--
-- 5. return_grades(p_assessment_id, p_enrollment_ids, p_idempotency_key):
--    Return, Return and Next, Return N Graded. For each listed student whose
--    grade on that assessment is a draft: returned_at := now, the old
--    returned_copy moves to previous_copy (updated_at := now), returned_copy
--    is cleared. A draft with nothing left in it (the teacher cleared a
--    returned grade) returns as "no grade". Students not in the assessment's
--    class and grades that are not drafts are skipped. Returns
--    { returned, enrollment_ids, returned_at }.
--    list_course_grade_returns(p_course_id): the class's rows for the
--    client's cache, as { "<assessment id>": { "<enrollment id>":
--    { is_draft, returned_at, updated_at, seen_at, returned_copy,
--    previous_copy } } }, nulls left out.
--
-- 6. Two server checks on existing RPCs, each patched in place from the live
--    body (the migration stops if the live body is not the one it was
--    written against):
--      upsert_rubric_score refuses a criterion that is not on the
--        assessment's rubric (errcode 22023), as set_rubric_check refuses a
--        checkbox. A call that sets no level and writes no note is let
--        through: it can only clear. Clients already in teachers' browsers
--        send a 0 for each old criterion after Edit a Copy; those still pass.
--      set_score_status refuses Missing on work that has points, a mark or a
--        level (errcode 22023), unless it is already marked Missing. Excused
--        and Late are not checked, and comments do not count as a score.
--
-- 7. import_json_restore keeps the state in the backup: its payload may
--    carry grade_returns (the rows of 5's list, flat, with enrollment_id and
--    assessment_id); each is applied after the scores. A backup with no
--    grade_returns key restores every grade as Returned.
--    move_rubric_scores keeps the state (4), and now also re-points the ids
--    inside the stored copies for criteria and checkboxes the working copy
--    no longer has a row for (patched in place, one line).
--    duplicate_course and duplicate_assessment copy no grades, so no rows
--    appear. Not changed.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- No score, level, comment or tick changes. Every existing class gets
-- student_page_enabled = false and return_grades = null. The backfill adds
-- one grade_return row, not a draft, for every student and assessment that
-- has a grade today (a level, points, a mark, a comment or a tick; a status
-- or a Note for the Report alone is not a grade). Its returned_at is when
-- that grade was last saved (the latest updated_at of its rows): these
-- classes have always shown a grade as soon as it was saved, so that is when
-- it was returned. The backfill skips rows that exist, so it can run again.
--
-- The whole file can be run again. Apply in one transaction.

-- ── 1. The two class settings ───────────────────────────────────────────────
alter table public.course add column if not exists student_page_enabled boolean not null default false;
alter table public.course add column if not exists return_grades text;
alter table public.course alter column return_grades set default 'on_return';
alter table public.course drop constraint if exists course_return_grades_check;
alter table public.course add constraint course_return_grades_check
    check (return_grades is null or return_grades in ('on_return', 'on_save'));
comment on column public.course.student_page_enabled is
    'The student page build switch. False: every save is returned at once and nothing student-facing opens.';
comment on column public.course.return_grades is
    'on_return: a grade is a draft until the teacher returns it. on_save: returned as soon as saved. Null: no choice made yet; works as on_save.';

-- ── 2. grade_return ─────────────────────────────────────────────────────────
create table if not exists public.grade_return (
    enrollment_id uuid        not null references public.enrollment(id) on delete cascade,
    assessment_id uuid        not null references public.assessment(id) on delete cascade,
    is_draft      boolean     not null default false,
    returned_at   timestamptz,
    returned_copy jsonb,
    previous_copy jsonb,
    updated_at    timestamptz,
    seen_at       timestamptz,
    primary key (enrollment_id, assessment_id),
    constraint grade_return_returned_copy_object check (returned_copy is null or jsonb_typeof(returned_copy) = 'object'),
    constraint grade_return_previous_copy_object check (previous_copy is null or jsonb_typeof(previous_copy) = 'object'),
    -- returned_copy is kept exactly while a draft sits on a returned grade.
    constraint grade_return_copy_while_draft check ((returned_copy is not null) = (is_draft and returned_at is not null))
);
create index if not exists grade_return_assessment_idx on public.grade_return (assessment_id);
comment on table public.grade_return is
    'Draft or Returned, per student per assessment: what the student has been given. Written only by the score-table triggers, return_grades and the restore.';

alter table public.grade_return enable row level security;
drop policy if exists grade_return_read on public.grade_return;
create policy grade_return_read on public.grade_return
    for select
    using (public.fv_owns_enrollment(enrollment_id));
revoke all on table public.grade_return from public, anon, authenticated;
grant select on table public.grade_return to authenticated;

-- ── 3. A grade's copy ───────────────────────────────────────────────────────
-- One place builds a copy from its parts, so "nothing in it" is always null
-- and two equal grades are always equal JSON.
create or replace function public._grade_copy_of(
    p_value numeric, p_modifier integer, p_comment text, p_tags jsonb, p_criteria jsonb, p_checks jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
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

-- One competency's or criterion's entry in a copy; null when the row holds
-- no level and no note.
create or replace function public._grade_copy_entry(p_value integer, p_modifier integer, p_comment text, p_beyond text, p_criterion boolean)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
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

-- The working copy of one student's grade on one assessment, as it is now.
create or replace function public._grade_copy(p_enrollment_id uuid, p_assessment_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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

-- Does this student's class hold grades until they are returned?
create or replace function public._grade_return_holds(p_enrollment_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select coalesce((select c.student_page_enabled and c.return_grades = 'on_return'
                       from enrollment e join course c on c.id = e.course_id
                      where e.id = p_enrollment_id), false);
$function$;

-- ── 4. The rule ─────────────────────────────────────────────────────────────
-- One cell's working copy went from p_before to _now.
create or replace function public._grade_return_apply(
    p_enrollment_id uuid, p_assessment_id uuid, p_before jsonb, _now jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _g   grade_return%rowtype;
    _at  timestamptz := clock_timestamp();
begin
    if _now is not distinct from p_before then
        return;  -- a save that changed nothing
    end if;

    select * into _g from grade_return
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;

    if _grade_return_holds(p_enrollment_id) then
        -- When I Return Them: the change waits as a draft.
        if not found then
            if _now is not null then
                insert into grade_return (enrollment_id, assessment_id, is_draft)
                values (p_enrollment_id, p_assessment_id, true)
                on conflict (enrollment_id, assessment_id) do nothing;
            end if;
        elsif not _g.is_draft then
            if _g.returned_at is not null and p_before is not null then
                update grade_return set is_draft = true, returned_copy = p_before
                 where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
            else
                update grade_return
                   set is_draft = _now is not null, returned_at = null, previous_copy = null, updated_at = null
                 where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
            end if;
        elsif _g.returned_copy is not null then
            if _now is not distinct from _g.returned_copy then
                update grade_return set is_draft = false, returned_copy = null
                 where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
            end if;
        elsif _now is null then
            update grade_return set is_draft = false
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
        end if;
        return;
    end if;

    -- Any other class: the save is returned at once.
    if not found then
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

-- The statement trigger, one function for the four tables. tg_argv[0] says
-- which part of a copy the table holds ('score', 'tags', 'criteria' or
-- 'checks'); tg_argv[1] names the column that keys it. For every cell the
-- statement touched it works out the copy before: the copy now, with the
-- statement's new rows taken out and its old rows put back.
create or replace function public._grade_return_on_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _part   text := tg_argv[0];
    _idcol  text := tg_argv[1];
    _old    jsonb := '[]'::jsonb;
    _new    jsonb := '[]'::jsonb;
    _c      record;
    _now    jsonb;
    _before jsonb;
begin
    -- import_json_restore sets the state itself when its rows are in.
    if current_setting('fv.restoring', true) = 'on' then return null; end if;

    -- old_rows exists on UPDATE and DELETE, new_rows on INSERT and UPDATE.
    if tg_op <> 'INSERT' then
        select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) into _old from old_rows o;
    end if;
    if tg_op <> 'DELETE' then
        select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) into _new from new_rows n;
    end if;

    for _c in
        select x.enrollment_id, x.assessment_id,
               coalesce(array_agg(x.key) filter (where not x.was), '{}') as new_keys,
               coalesce(array_agg(x.key) filter (where x.was), '{}') as old_keys,
               coalesce(jsonb_object_agg(coalesce(x.key, ''), x.entry) filter (where x.was and x.entry is not null),
                        '{}'::jsonb) as old_entries,
               (jsonb_agg(x.r) filter (where x.was)) -> 0 as old_row
          from (-- An old row is filed under the id it has now, so a row that
                -- was only pointed at another criterion is the same grade
                -- before and after.
                select (o.r->>'enrollment_id')::uuid as enrollment_id, (o.r->>'assessment_id')::uuid as assessment_id,
                       true as was, coalesce(n.key, o.r->>_idcol) as key,
                       case _part
                           when 'tags' then _grade_copy_entry((o.r->>'value')::int, (o.r->>'modifier')::int,
                                                              o.r->>'comment', null, false)
                           when 'criteria' then _grade_copy_entry((o.r->>'value')::int, (o.r->>'modifier')::int,
                                                                  o.r->>'comment', o.r->>'beyond', true)
                       end as entry,
                       o.r
                  from jsonb_array_elements(_old) o(r)
                  left join (select m.r->>'id' as id, m.r->>'enrollment_id' as e, m.r->>'assessment_id' as a,
                                    m.r->>_idcol as key
                               from jsonb_array_elements(_new) m(r)) n
                    on n.id = o.r->>'id' and n.e = o.r->>'enrollment_id' and n.a = o.r->>'assessment_id'
                union all
                select (m.r->>'enrollment_id')::uuid, (m.r->>'assessment_id')::uuid, false, m.r->>_idcol, null, null
                  from jsonb_array_elements(_new) m(r)) x
         group by x.enrollment_id, x.assessment_id
    loop
        -- Inside a delete of the assessment, the student or the class: the
        -- cell is going, and grade_return's own cascade takes its row.
        continue when not exists (select 1 from assessment where id = _c.assessment_id)
                   or not exists (select 1 from enrollment where id = _c.enrollment_id);
        -- A tick holds nothing but its checkbox, so an UPDATE that leaves a
        -- cell with as many ticks as it had only re-pointed them
        -- (_grade_return_repoint has moved the ids in the stored copies).
        continue when _part = 'checks' and tg_op = 'UPDATE'
                  and cardinality(_c.new_keys) = cardinality(_c.old_keys);

        _now := _grade_copy(_c.enrollment_id, _c.assessment_id);
        _before := case _part
            when 'score' then _grade_copy_of(
                (_c.old_row->>'value')::numeric, (_c.old_row->>'modifier')::int, _c.old_row->>'comment',
                _now->'tags', _now->'criteria', _now->'checks')
            when 'tags' then _grade_copy_of(
                (_now->>'value')::numeric, (_now->>'modifier')::int, _now->>'comment',
                (coalesce(_now->'tags', '{}'::jsonb) - _c.new_keys) || _c.old_entries, _now->'criteria', _now->'checks')
            when 'criteria' then _grade_copy_of(
                (_now->>'value')::numeric, (_now->>'modifier')::int, _now->>'comment',
                _now->'tags', (coalesce(_now->'criteria', '{}'::jsonb) - _c.new_keys) || _c.old_entries, _now->'checks')
            else _grade_copy_of(
                (_now->>'value')::numeric, (_now->>'modifier')::int, _now->>'comment',
                _now->'tags', _now->'criteria',
                (coalesce(_now->'checks', '[]'::jsonb) - _c.new_keys) || to_jsonb(_c.old_keys))
        end;
        perform _grade_return_apply(_c.enrollment_id, _c.assessment_id, _before, _now);
    end loop;
    return null;
end;
$function$;

-- A row pointed at another competency, criterion or checkbox: the ids inside
-- the stored copies follow it (move_rubric_scores). tg_argv[0] is the copy's
-- part, tg_argv[1] the id column.
create or replace function public._grade_return_repoint()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _part text := tg_argv[0];
    _old  text := to_jsonb(old) ->> tg_argv[1];
    _new  text := to_jsonb(new) ->> tg_argv[1];
begin
    if current_setting('fv.restoring', true) = 'on' or _old = _new
       or old.enrollment_id <> new.enrollment_id or old.assessment_id <> new.assessment_id then
        return null;
    end if;
    if _part = 'checks' then
        update grade_return g
           set returned_copy = case when g.returned_copy -> 'checks' ? _old
                                    then _grade_copy_of((g.returned_copy->>'value')::numeric, (g.returned_copy->>'modifier')::int,
                                             g.returned_copy->>'comment', g.returned_copy->'tags', g.returned_copy->'criteria',
                                             (g.returned_copy->'checks') - _old || to_jsonb(_new))
                                    else g.returned_copy end,
               previous_copy = case when g.previous_copy -> 'checks' ? _old
                                    then _grade_copy_of((g.previous_copy->>'value')::numeric, (g.previous_copy->>'modifier')::int,
                                             g.previous_copy->>'comment', g.previous_copy->'tags', g.previous_copy->'criteria',
                                             (g.previous_copy->'checks') - _old || to_jsonb(_new))
                                    else g.previous_copy end
         where g.enrollment_id = new.enrollment_id and g.assessment_id = new.assessment_id
           and (g.returned_copy -> 'checks' ? _old or g.previous_copy -> 'checks' ? _old);
    else
        update grade_return g
           set returned_copy = case when g.returned_copy -> _part ? _old
                                    then jsonb_set(g.returned_copy #- array[_part, _old], array[_part, _new], g.returned_copy -> _part -> _old)
                                    else g.returned_copy end,
               previous_copy = case when g.previous_copy -> _part ? _old
                                    then jsonb_set(g.previous_copy #- array[_part, _old], array[_part, _new], g.previous_copy -> _part -> _old)
                                    else g.previous_copy end
         where g.enrollment_id = new.enrollment_id and g.assessment_id = new.assessment_id
           and (g.returned_copy -> _part ? _old or g.previous_copy -> _part ? _old);
    end if;
    return null;
end;
$function$;

-- move_rubric_scores calls this once its rows have moved: the copies kept
-- for students follow, also for a criterion or checkbox the working copy no
-- longer has a row for (a level cleared in a draft). Maps are
-- { "<old id>": "<new id>" }, as move_rubric_scores takes them.
create or replace function public._grade_copy_remap(p_copy jsonb, p_criterion_map jsonb, p_check_map jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
    select case when p_copy is null then null else _grade_copy_of(
        (p_copy->>'value')::numeric, (p_copy->>'modifier')::int, p_copy->>'comment', p_copy->'tags',
        (select coalesce(jsonb_object_agg(coalesce(p_criterion_map->>e.key, e.key), e.value), '{}'::jsonb)
           from jsonb_each(coalesce(p_copy->'criteria', '{}'::jsonb)) e),
        (select coalesce(jsonb_agg(coalesce(p_check_map->>x, x)), '[]'::jsonb)
           from jsonb_array_elements_text(coalesce(p_copy->'checks', '[]'::jsonb)) x)) end;
$function$;

create or replace function public._grade_return_remap(p_assessment_id uuid, p_criterion_map jsonb, p_check_map jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    -- move_rubric_scores is SECURITY INVOKER, so teachers can call this:
    -- it only renames ids inside the caller's own stored copies.
    if not fv_owns_assessment(p_assessment_id) then return; end if;
    update grade_return g
       set returned_copy = _grade_copy_remap(g.returned_copy, coalesce(p_criterion_map, '{}'::jsonb), coalesce(p_check_map, '{}'::jsonb)),
           previous_copy = _grade_copy_remap(g.previous_copy, coalesce(p_criterion_map, '{}'::jsonb), coalesce(p_check_map, '{}'::jsonb))
     where g.assessment_id = p_assessment_id
       and (g.returned_copy is not null or g.previous_copy is not null);
end;
$function$;
revoke all on function public._grade_copy_remap(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._grade_return_remap(uuid, jsonb, jsonb) from public, anon;
grant execute on function public._grade_return_remap(uuid, jsonb, jsonb) to authenticated, service_role;

-- Only triggers and the functions here call these.
revoke all on function public._grade_copy_of(numeric, integer, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._grade_copy_entry(integer, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public._grade_copy(uuid, uuid) from public, anon, authenticated;
revoke all on function public._grade_return_holds(uuid) from public, anon, authenticated;
revoke all on function public._grade_return_apply(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._grade_return_on_change() from public, anon, authenticated;
revoke all on function public._grade_return_repoint() from public, anon, authenticated;

-- A trigger with transition tables takes one event, so three per table.
do $triggers$
declare
    _t record;
begin
    for _t in
        select * from (values
            ('score',              'score',    'id'),
            ('tag_score',          'tags',     'tag_id'),
            ('rubric_score',       'criteria', 'criterion_id'),
            ('rubric_check_score', 'checks',   'check_id')
        ) as v(tbl, part, idcol)
    loop
        execute format('drop trigger if exists grade_return_insert on public.%I', _t.tbl);
        execute format('drop trigger if exists grade_return_update on public.%I', _t.tbl);
        execute format('drop trigger if exists grade_return_delete on public.%I', _t.tbl);
        execute format('create trigger grade_return_insert after insert on public.%I '
                       'referencing new table as new_rows for each statement '
                       'execute function public._grade_return_on_change(%L, %L)', _t.tbl, _t.part, _t.idcol);
        execute format('create trigger grade_return_update after update on public.%I '
                       'referencing old table as old_rows new table as new_rows for each statement '
                       'execute function public._grade_return_on_change(%L, %L)', _t.tbl, _t.part, _t.idcol);
        execute format('create trigger grade_return_delete after delete on public.%I '
                       'referencing old table as old_rows for each statement '
                       'execute function public._grade_return_on_change(%L, %L)', _t.tbl, _t.part, _t.idcol);
    end loop;
end
$triggers$;

drop trigger if exists grade_return_repoint on public.tag_score;
create trigger grade_return_repoint after update on public.tag_score
    for each row when (old.tag_id is distinct from new.tag_id)
    execute function public._grade_return_repoint('tags', 'tag_id');
drop trigger if exists grade_return_repoint on public.rubric_score;
create trigger grade_return_repoint after update on public.rubric_score
    for each row when (old.criterion_id is distinct from new.criterion_id)
    execute function public._grade_return_repoint('criteria', 'criterion_id');
drop trigger if exists grade_return_repoint on public.rubric_check_score;
create trigger grade_return_repoint after update on public.rubric_check_score
    for each row when (old.check_id is distinct from new.check_id)
    execute function public._grade_return_repoint('checks', 'check_id');

-- ── 5. Return, and the client's read ────────────────────────────────────────
create or replace function public.return_grades(
    p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _g      grade_return%rowtype;
    _now    jsonb;
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
    for _g in
        select g.* from grade_return g
          join enrollment e on e.id = g.enrollment_id
         where g.assessment_id = p_assessment_id
           and g.enrollment_id = any (coalesce(p_enrollment_ids, '{}'))
           and e.course_id = _course
           and g.is_draft
         order by g.enrollment_id
           for update of g
    loop
        _now := _grade_copy(_g.enrollment_id, p_assessment_id);
        if _now is null then
            -- The teacher cleared a returned grade: returned, there is no grade.
            update grade_return
               set is_draft = false, returned_at = null, returned_copy = null, previous_copy = null, updated_at = null
             where enrollment_id = _g.enrollment_id and assessment_id = p_assessment_id;
        else
            update grade_return
               set is_draft = false, returned_at = _at, returned_copy = null,
                   previous_copy = case when _g.returned_copy is not null then _g.returned_copy else previous_copy end,
                   updated_at = case when _g.returned_copy is not null then _at else updated_at end
             where enrollment_id = _g.enrollment_id and assessment_id = p_assessment_id;
        end if;
        _done := _done || _g.enrollment_id;
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
revoke all on function public.return_grades(uuid, uuid[], uuid) from public, anon;
grant execute on function public.return_grades(uuid, uuid[], uuid) to authenticated, service_role;

create or replace function public.list_course_grade_returns(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
    select coalesce(jsonb_object_agg(x.assessment_id::text, x.students), '{}'::jsonb)
      from (select g.assessment_id,
                   jsonb_object_agg(g.enrollment_id::text, jsonb_strip_nulls(jsonb_build_object(
                       'is_draft', g.is_draft, 'returned_at', g.returned_at, 'updated_at', g.updated_at,
                       'seen_at', g.seen_at, 'returned_copy', g.returned_copy, 'previous_copy', g.previous_copy))) as students
              from grade_return g
              join enrollment e on e.id = g.enrollment_id
             where e.course_id = p_course_id
             group by g.assessment_id) x;
$function$;
revoke all on function public.list_course_grade_returns(uuid) from public, anon;
grant execute on function public.list_course_grade_returns(uuid) to authenticated, service_role;

-- ── 6. Two server checks, update_course, move_rubric_scores, the restore ────
-- Each function is patched in place from its live definition. _was is
-- md5(pg_get_functiondef) of the body this was written against, read from
-- gradebook-prod on 2026-11-09; anything else stops the migration, unless
-- the function already carries the patch (a second run).
do $patch$
declare
    _edits text[][] := array[
      -- function, md5 of the live definition, a line only the patch adds, text to find, replacement
      array['public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)',
            '969a701836ca6c50a92327e66efa0055',
            'is not in the rubric of assessment',
$s$    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its notes.$s$,
$s$    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    -- The criterion must be on the assessment's rubric, as set_rubric_check
    -- checks its checkbox. A call that sets no level and writes no note can
    -- only clear, and is let through: an older client sends a 0 for each old
    -- criterion after the assessment moved to a copy of its rubric.
    if not ((p_value is null or p_value = 0) and nullif(p_comment, '') is null and nullif(p_beyond, '') is null)
       and not exists (select 1 from criterion c join assessment a on a.rubric_id = c.rubric_id
                        where c.id = p_criterion_id and a.id = p_assessment_id) then
        raise exception 'criterion % is not in the rubric of assessment %', p_criterion_id, p_assessment_id
            using errcode = '22023';
    end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its notes.$s$],
      array['public.set_score_status(uuid,uuid,text)',
            '785597b37ce5d5fdb9b9c19f97c89fca',
            'cannot be marked Missing',
$s$        raise exception 'invalid status %', p_status using errcode = '22023';
    end if;
$s$,
$s$        raise exception 'invalid status %', p_status using errcode = '22023';
    end if;

    -- Missing is for work with no score: refused on work that has points, a
    -- mark or a level, unless it is already marked Missing. Excused and Late
    -- are not checked; a comment is not a score.
    if p_status = 'NS'
       and not exists (select 1 from score where enrollment_id = p_enrollment_id
                          and assessment_id = p_assessment_id and status = 'NS')
       and (exists (select 1 from score where enrollment_id = p_enrollment_id
                       and assessment_id = p_assessment_id and value is not null)
         or exists (select 1 from tag_score where enrollment_id = p_enrollment_id
                       and assessment_id = p_assessment_id and value is not null)
         or exists (select 1 from rubric_score where enrollment_id = p_enrollment_id
                       and assessment_id = p_assessment_id and value is not null)) then
        raise exception 'work that has a score cannot be marked Missing' using errcode = '22023';
    end if;
$s$],
      array['public.update_course(uuid,jsonb)',
            '8aacf4f24b0b7133352379e89978776b',
            'student_page_enabled',
$s$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,$s$,
$s$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
        student_page_enabled = case when p_patch ? 'student_page_enabled'
                                then coalesce((p_patch->>'student_page_enabled')::boolean, false)
                                else student_page_enabled end,
        return_grades    = case when p_patch ? 'return_grades'
                                then nullif(p_patch->>'return_grades', '')
                                else return_grades end,$s$],
      array['public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
            '92f7ff4b840c1dd9fe473f8ecdee29b5',
            '_grade_return_remap',
$s$    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$,
$s$    -- Draft and Returned: the copies kept for students follow the scores to
    -- the new ids, also where the working copy no longer has the row.
    perform _grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$],
      -- import_json_restore, three edits: the class's two settings (twice:
      -- the insert and its on-conflict update), then the state after the scores.
      array['public.import_json_restore(jsonb,uuid)',
            '58e48ae4f7ebcc05489b489a4f8906df',
            '_restore_grade_returns',
$s$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally)$s$,
$s$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)$s$],
      array['public.import_json_restore(jsonb,uuid)', '', '',
$s$                coalesce((_row->>'courses_count_equally')::boolean, false))$s$,
$s$                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))$s$],
      array['public.import_json_restore(jsonb,uuid)', '', '',
$s$          courses_count_equally=excluded.courses_count_equally,$s$,
$s$          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,$s$],
      array['public.import_json_restore(jsonb,uuid)', '', '',
$s$    perform set_config('fv.restoring', '', true);$s$,
$s$    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform _restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);$s$]
    ];
    _def  text;
    _fn   text := '';
    _skip boolean := false;
    _hits int;
    i     int;
begin
    for i in 1 .. array_length(_edits, 1) loop
        if _edits[i][1] <> _fn then
            -- The first edit to a function: check it is the one this was written against.
            if _fn <> '' and not _skip then execute _def; end if;
            _fn := _edits[i][1];
            _def := pg_get_functiondef(_fn::regprocedure);
            _skip := position(_edits[i][3] in _def) > 0;
            if not _skip and md5(_def) <> _edits[i][2] then
                raise exception '% is not the definition this migration was written against (md5 %, expected %)',
                    _fn, md5(_def), _edits[i][2];
            end if;
        end if;
        continue when _skip;
        _hits := (length(_def) - length(replace(_def, _edits[i][4], ''))) / length(_edits[i][4]);
        if _hits <> 1 then
            raise exception '% has % matches for "%", expected 1', _fn, _hits, _edits[i][4];
        end if;
        _def := replace(_def, _edits[i][4], _edits[i][5]);
    end loop;
    if not _skip then execute _def; end if;
end
$patch$;

-- ── 7. The restore's state ──────────────────────────────────────────────────
-- Called by import_json_restore once its rows are in. It works only inside a
-- restore, and only on the caller's own students: a teacher cannot use it to
-- set a state by hand.
create or replace function public._restore_grade_returns(p_payload jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _at timestamptz := clock_timestamp();
    _n  integer := 0;
begin
    if (select auth.uid()) is null or coalesce(current_setting('fv.restoring', true), '') <> 'on' then
        return 0;
    end if;

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
    return _n;
end;
$function$;
-- import_json_restore is SECURITY INVOKER, so the teacher's role must be
-- able to call this; the two checks at its top are what guard it.
revoke all on function public._restore_grade_returns(jsonb) from public, anon;
grant execute on function public._restore_grade_returns(jsonb) to authenticated, service_role;

-- ── The backfill: every grade there is today is Returned ────────────────────
insert into public.grade_return (enrollment_id, assessment_id, is_draft, returned_at)
select c.enrollment_id, c.assessment_id, false, max(c.at)
  from (select s.enrollment_id, s.assessment_id, greatest(s.updated_at, s.scored_at) as at
          from public.score s
         where s.value is not null or nullif(btrim(s.comment), '') is not null
        union all
        select t.enrollment_id, t.assessment_id, t.updated_at
          from public.tag_score t
         where t.value is not null or nullif(btrim(t.comment), '') is not null
        union all
        select r.enrollment_id, r.assessment_id, r.updated_at
          from public.rubric_score r
         where r.value is not null or nullif(btrim(r.comment), '') is not null or nullif(btrim(r.beyond), '') is not null
        union all
        select k.enrollment_id, k.assessment_id, k.created_at
          from public.rubric_check_score k) c
 group by c.enrollment_id, c.assessment_id
on conflict (enrollment_id, assessment_id) do nothing;

notify pgrst, 'reload schema';
