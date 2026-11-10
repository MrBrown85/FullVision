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
--      duplicate_course    copies the original's return_grades as it is
--                          (null stays null); the copy's student page is
--                          off (Colin, Nov 9). Patched below.
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
-- 3b. A copy is complete: it holds every row, also ones the teacher's
--    screens hide because the work is no longer scored that way (a level
--    left on a rubric the work no longer uses, a competency level on work
--    since changed to points). _grade_copy_in_use(copy, assessment) gives
--    the part the work's scoring uses now, by the rule under 6. Students are
--    sent only that (student_submit._returned_grade), so the student page
--    never has to know the hiding rules.
--
-- 4. Triggers on the four score tables keep grade_return right for any
--    writer: the RPCs, an old cached client, the grade-scans skill. A row
--    trigger BEFORE each change keeps the cell's copy as it was (in
--    grade_return_before, a scratch table) the first time a transaction
--    touches the cell; a statement trigger AFTER compares it with the copy
--    NOW. The copy before is taken before anything is deleted, so it does not
--    depend on the order cascades run in: deleting a criterion that has a
--    ticked box takes its levels and its ticks, and the student still keeps
--    both until the teacher returns the grade. Equal copies do nothing: a
--    save that changes nothing, or the same save sent twice, is not a draft.
--    Otherwise, for that student and assessment:
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
--      a draft still waiting       -> returned as return_grades would
--                                      (there should be none: see below).
--      nothing is left              -> the row goes back to "never returned".
--
--    When move_rubric_scores points a row at another criterion or checkbox
--    (Edit a Copy), the grade is the same grade: the state is kept and the
--    ids inside returned_copy and previous_copy follow. It says so with a
--    flag only it sets (fv.moving_rubric, for the transaction). Any other
--    UPDATE of a row's criterion, competency or checkbox is a change like
--    any other. A cell whose assessment or
--    enrollment is being deleted is left alone. While import_json_restore
--    runs (fv.restoring) the triggers stand aside and the restore sets the
--    state itself (7).
--
--    Leaving When I Return Them returns what was waiting (Colin, Nov 9:
--    "ask, then return them"). When a class stops holding grades, by Return
--    Grades changing to As Soon As I Save or to no choice, or by its student
--    page being turned off, a trigger on course returns every waiting draft
--    in the class in the same transaction, each exactly as return_grades
--    would. No draft is left where no Draft mark or Return button shows. The
--    screen asks first; course_draft_count(p_course_id) tells it how many.
--    Turning the page back on leaves them returned.
--
--    Two saves at once: the BEFORE trigger and return_grades take one lock
--    per class (_grade_return_lock, an advisory lock held to the end of the
--    transaction) before they read a grade, so the second waits and sees
--    what the first did. Without it a save could compare against a grade
--    another save was halfway through changing, and settle a draft as
--    Returned. migrations/local-test/grade_return_race.py runs that race.
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
--    course_draft_count(p_course_id): how many grades in the class are
--    waiting as drafts.
--
-- 6. Two server checks on existing RPCs, each patched in place from the live
--    body (the migration stops if the live body is not the one it was
--    written against). Each refuses only what is certainly wrong: a refused
--    write is a dead letter in a teacher's outbox, with only the sync dot to
--    say so.
--      upsert_rubric_score refuses a real level (1 to 4) for a criterion
--        that is not on the rubric the assessment has (errcode 22023), as
--        set_rubric_check refuses a checkbox. Everything else is taken:
--          the assessment has no rubric yet: saved as before. The outbox can
--            send a score ahead of the update_assessment that attaches its
--            rubric.
--          no level (0 or null) for a criterion that is not on the rubric,
--            with or without a comment: nothing is kept, any stray row is
--            cleared, and the call returns null. Clients already in
--            teachers' browsers send these after Edit a Copy.
--      set_score_status refuses Missing on work that has a score (errcode
--        22023), unless it is already marked Missing. "Has a score" is what
--        the app shows as one, the rule of canSetAssignmentStatus in
--        shared/data.js for levels, points and marks: only the rows the
--        work's scoring uses NOW count (fv_private.work_is_scored, through
--        _grade_copy_in_use, 3b):
--          a rubric attached        criterion levels on that rubric
--          points or Complete       score.value; a 0 is a score
--          competencies linked      their levels (competencies still on the
--                                   class)
--          none of those            the Overall level; a 0 is no score
--        Rows the app hides do not count: a criterion level left from a
--        rubric the work no longer uses, a competency level on points work,
--        a score.value on competency or rubric work. Excused and Late are
--        not checked, and comments do not count as a score.
--        Rows of that hidden kind on gradebook-prod, counted 2026-11-09: 0
--        competency levels on points or rubric work, 0 criterion levels off
--        the current rubric, 1 score.value on competency or rubric work. To
--        count them again:
--          select (select count(*) from tag_score x join assessment a on a.id = x.assessment_id
--                   where x.value is not null and (a.rubric_id is not null or a.score_mode <> 'proficiency'))
--                   as competency_levels_on_points_or_rubric_work,
--                 (select count(*) from rubric_score x join assessment a on a.id = x.assessment_id
--                   where x.value is not null and not exists (select 1 from criterion c
--                          where c.id = x.criterion_id and c.rubric_id = a.rubric_id))
--                   as criterion_levels_off_the_current_rubric,
--                 (select count(*) from score x join assessment a on a.id = x.assessment_id
--                   where x.value is not null and a.score_mode = 'proficiency'
--                     and (a.rubric_id is not null
--                          or exists (select 1 from assessment_tag t where t.assessment_id = a.id)))
--                   as score_values_on_competency_or_rubric_work;
--
-- 7. import_json_restore keeps the state in the backup: its payload may
--    carry grade_returns (the rows of 5's list, flat, with enrollment_id and
--    assessment_id); each is applied after the scores. A backup with no
--    grade_returns key restores every grade as Returned. This is by design
--    (plan 1.2), and it means a teacher can change the state of their own
--    class by restoring a file they edited: mark a draft Returned, or give a
--    returned copy that was never returned. A backup file can already carry
--    any score for that class; it reaches no other teacher's.
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
-- Who else changes a class, and what happens to these rows: clear_data
-- deletes the caller's classes and students, and relink_student deletes a
-- duplicate enrollment when the real student is already in the class; in
-- both the enrollment's grade_return rows go with it (the foreign key), and
-- the triggers stand aside for a cell that is being deleted. When
-- relink_student instead moves an enrollment to the real student record, the
-- enrollment keeps its id, so its grade_return rows stay as they are.
-- Neither writes a score table.
--
-- Functions this file leaves callable by signed-in teachers through the API:
-- return_grades, list_course_grade_returns and course_draft_count. The helpers the SECURITY
-- INVOKER RPCs call (the restore's and move_rubric_scores', and the Missing
-- check's) are in schema fv_private, which the API does not expose.
--
-- The whole file can be run again.
--
-- One transaction: the file opens with begin and ends with commit, as
-- 20261027_score_comments.sql and 20261031_score_report_note.sql do, so it
-- is all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first, before anything
-- is created or changed.
begin;

-- Give up after five seconds rather than queue behind a long transaction and
-- hold every teacher's saves up behind this one. If it gives up, nothing is
-- applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f  record;
    _def text;
begin
    -- Each function this file patches must be the one it was written against
    -- (md5 of pg_get_functiondef, read from gradebook-prod on 2026-11-09), or
    -- already carry the patch (a second run).
    for _f in
        select * from (values
            ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)', '969a701836ca6c50a92327e66efa0055', 'is not in the rubric of assessment'),
            ('public.set_score_status(uuid,uuid,text)', '785597b37ce5d5fdb9b9c19f97c89fca', 'cannot be marked Missing'),
            ('public.update_course(uuid,jsonb)', '8aacf4f24b0b7133352379e89978776b', 'student_page_enabled'),
            ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', '92f7ff4b840c1dd9fe473f8ecdee29b5', 'fv.moving_rubric'),
            ('public.import_json_restore(jsonb,uuid)', '58e48ae4f7ebcc05489b489a4f8906df', 'restore_grade_returns'),
            ('public.duplicate_course(uuid,uuid)', '528aacf8cb9581682178b1914a32fc20', 'courses_count_equally, return_grades')
        ) as v(fn, was, mark)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        if position(_f.mark in _def) = 0 and md5(_def) <> _f.was then
            raise exception '% is not the definition this migration was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, md5(_def), _f.was;
        end if;
    end loop;
    perform 'public._touch_course_sync_cursor(uuid,text)'::regprocedure, 'public.fv_owns_enrollment(uuid)'::regprocedure,
            'public.fv_owns_assessment(uuid)'::regprocedure, 'public.fv_idem_check(uuid,text)'::regprocedure;
end
$guard$;

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
 set search_path to 'public', 'pg_temp'
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
 set search_path to 'public', 'pg_temp'
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
 set search_path to 'public', 'pg_temp'
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
 set search_path to 'public', 'pg_temp'
as $function$
    select coalesce((select c.student_page_enabled and c.return_grades = 'on_return'
                       from enrollment e join course c on c.id = e.course_id
                      where e.id = p_enrollment_id), false);
$function$;

-- ── 3b. The part of a copy the work's scoring uses now ──────────────────────
create or replace function public._grade_copy_in_use(p_copy jsonb, p_assessment_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select case when p_copy is null then null else (
        select _grade_copy_of(
            -- score.value: points and marks (a 0 is a score), or the Overall
            -- level of work with no rubric and no competency (a 0 is none).
            case when a.rubric_id is not null then null
                 when a.score_mode in ('points', 'complete') then (p_copy->>'value')::numeric
                 when a.score_mode = 'proficiency' and not u.has_tags then nullif((p_copy->>'value')::numeric, 0)
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
         cross join lateral (
             select exists (select 1 from assessment_tag x
                              join tag t on t.id = x.tag_id
                              join section s on s.id = t.section_id
                             where x.assessment_id = a.id and s.course_id = a.course_id and s.removed_at is null) as has_tags) u
         where a.id = p_assessment_id) end;
$function$;
revoke all on function public._grade_copy_in_use(jsonb, uuid) from public, anon, authenticated;

-- Helpers that SECURITY INVOKER RPCs call, so the teacher's role must be able
-- to run them, kept out of the API: PostgREST serves schema public only.
create schema if not exists fv_private;
revoke all on schema fv_private from public, anon;
grant usage on schema fv_private to authenticated, service_role;

-- Does this work have a score, as the app shows one? set_score_status asks.
create or replace function fv_private.work_is_scored(p_enrollment_id uuid, p_assessment_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select fv_owns_enrollment(p_enrollment_id) and exists (
        select 1 from (select _grade_copy_in_use(_grade_copy(p_enrollment_id, p_assessment_id), p_assessment_id) as c) x
         where x.c->>'value' is not null
            or exists (select 1 from jsonb_each(x.c->'tags') t where t.value->>'value' is not null)
            or exists (select 1 from jsonb_each(x.c->'criteria') t where t.value->>'value' is not null));
$function$;
revoke all on function fv_private.work_is_scored(uuid, uuid) from public, anon;
grant execute on function fv_private.work_is_scored(uuid, uuid) to authenticated, service_role;

-- ── 4. The rule ─────────────────────────────────────────────────────────────
-- The copy a cell had before it was first changed in this transaction,
-- taken by a BEFORE trigger and used once by the statement trigger that
-- follows. It is what makes the rule independent of the order things
-- happen in: deleting a criterion removes its levels and its ticks through
-- two cascades whose order Postgres does not promise, and the copy the
-- student keeps must be the grade as it was before either. A row is deleted
-- when it is used; one left by a write that changed nothing is overwritten
-- by the next transaction and goes with its student or assessment. Nobody
-- can read or write this table but the triggers.
create table if not exists public.grade_return_before (
    enrollment_id uuid   not null references public.enrollment(id) on delete cascade,
    assessment_id uuid   not null references public.assessment(id) on delete cascade,
    txid          bigint not null,
    copy          jsonb,
    primary key (enrollment_id, assessment_id)
);
create index if not exists grade_return_before_assessment_idx on public.grade_return_before (assessment_id);
alter table public.grade_return_before enable row level security;
revoke all on table public.grade_return_before from public, anon, authenticated;

-- One lock per class for everything that reads a grade and then writes its
-- state: two saves to one class at once take turns, so the second sees what
-- the first did. (Every score write already queues behind the class's
-- course_sync_cursor row, but only at the end of its statement; this does
-- not lean on that.) Held to the end of the transaction.
create or replace function public._grade_return_lock(p_course_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select pg_advisory_xact_lock(hashtextextended('fv.grade_return:' || p_course_id::text, 0));
$function$;

-- Before a row of a score table changes: keep the cell's copy as it is now,
-- the first time this transaction touches the cell. tg_argv[0] is the part
-- of a copy the table holds ('score', 'tags', 'criteria' or 'checks').
create or replace function public._grade_return_before()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _part   text := tg_argv[0];
    _o      jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
    _n      jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
    _skip   constant text[] := array['updated_at', 'scored_at', 'created_at', 'status', 'report_note'];
    _cell   record;
    _course uuid;
begin
    -- import_json_restore sets the state itself when its rows are in.
    if current_setting('fv.restoring', true) = 'on' then
        return coalesce(new, old);
    end if;
    -- Nothing a copy holds is changing: a status, a Note for the Report, a
    -- timestamp, or a score row that only carries those.
    if tg_op = 'UPDATE' and (_o - _skip) = (_n - _skip) then
        return new;
    end if;
    if _part = 'score' and tg_op <> 'UPDATE'
       and coalesce(_o, _n)->>'value' is null and nullif(btrim(coalesce(_o, _n)->>'comment'), '') is null then
        return coalesce(new, old);
    end if;

    for _cell in
        select distinct (r->>'enrollment_id')::uuid as e, (r->>'assessment_id')::uuid as a
          from (values (_o), (_n)) v(r) where r is not null
    loop
        continue when exists (select 1 from grade_return_before b
                               where b.enrollment_id = _cell.e and b.assessment_id = _cell.a and b.txid = txid_current());
        -- Inside a delete of the assessment, the student or the class: the
        -- cell is going, and grade_return's own cascade takes its row.
        select e.course_id into _course from enrollment e where e.id = _cell.e;
        continue when _course is null or not exists (select 1 from assessment where id = _cell.a);
        perform _grade_return_lock(_course);
        -- A statement of its own, after the lock: it reads the cell as the
        -- last save to this class left it.
        insert into grade_return_before (enrollment_id, assessment_id, txid, copy)
        values (_cell.e, _cell.a, txid_current(), _grade_copy(_cell.e, _cell.a))
        on conflict (enrollment_id, assessment_id) do update set txid = excluded.txid, copy = excluded.copy;
    end loop;
    return coalesce(new, old);
end;
$function$;

-- One cell's working copy went from p_before to _now.
create or replace function public._grade_return_apply(
    p_enrollment_id uuid, p_assessment_id uuid, p_before jsonb, _now jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

-- After a statement on a score table: for every cell it touched, the copy
-- kept before against the copy now. A cell with no kept copy was not
-- changed, or was already settled by an earlier trigger of the same delete.
create or replace function public._grade_return_on_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cells jsonb := '[]'::jsonb;
    _more  jsonb;
    _c     record;
    _b     grade_return_before%rowtype;
begin
    if current_setting('fv.restoring', true) = 'on' then return null; end if;

    -- old_rows exists on UPDATE and DELETE, new_rows on INSERT and UPDATE.
    if tg_op <> 'INSERT' then
        select coalesce(jsonb_agg(distinct jsonb_build_array(o.enrollment_id, o.assessment_id)), '[]'::jsonb)
          into _cells from old_rows o;
    end if;
    if tg_op <> 'DELETE' then
        select coalesce(jsonb_agg(distinct jsonb_build_array(n.enrollment_id, n.assessment_id)), '[]'::jsonb)
          into _more from new_rows n;
        _cells := _cells || _more;
    end if;

    for _c in
        select distinct (x->>0)::uuid as e, (x->>1)::uuid as a
          from jsonb_array_elements(_cells) x
         order by 1, 2
    loop
        delete from grade_return_before b
         where b.enrollment_id = _c.e and b.assessment_id = _c.a and b.txid = txid_current()
        returning * into _b;
        continue when not found;
        continue when not exists (select 1 from assessment where id = _c.a)
                   or not exists (select 1 from enrollment where id = _c.e);
        perform _grade_return_apply(_c.e, _c.a, _b.copy, _grade_copy(_c.e, _c.a));
    end loop;
    return null;
end;
$function$;

-- A copy with ids renamed: p_criterion_map and p_check_map are
-- { "<old id>": "<new id>" }, as move_rubric_scores takes them; p_tag_map
-- the same for competencies.
create or replace function public._grade_copy_remap(p_copy jsonb, p_criterion_map jsonb, p_check_map jsonb, p_tag_map jsonb default '{}'::jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select case when p_copy is null then null else _grade_copy_of(
        (p_copy->>'value')::numeric, (p_copy->>'modifier')::int, p_copy->>'comment',
        (select coalesce(jsonb_object_agg(coalesce(p_tag_map->>e.key, e.key), e.value), '{}'::jsonb)
           from jsonb_each(coalesce(p_copy->'tags', '{}'::jsonb)) e),
        (select coalesce(jsonb_object_agg(coalesce(p_criterion_map->>e.key, e.key), e.value), '{}'::jsonb)
           from jsonb_each(coalesce(p_copy->'criteria', '{}'::jsonb)) e),
        (select coalesce(jsonb_agg(coalesce(p_check_map->>x, x)), '[]'::jsonb)
           from jsonb_array_elements_text(coalesce(p_copy->'checks', '[]'::jsonb)) x)) end;
$function$;

-- A row pointed at another criterion or checkbox by move_rubric_scores (Edit
-- a Copy): the grade is the same grade, so the ids inside the stored copies,
-- and inside the copy kept before, follow it. Only then: move_rubric_scores
-- sets fv.moving_rubric for its transaction, and without it an UPDATE of
-- one of these ids is a change like any other. tg_argv[0] is the copy's
-- part, tg_argv[1] the id column.
create or replace function public._grade_return_repoint()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    update grade_return g
       set returned_copy = _grade_copy_remap(g.returned_copy, case when tg_argv[0] = 'criteria' then _map else _none end,
                               case when tg_argv[0] = 'checks' then _map else _none end,
                               case when tg_argv[0] = 'tags' then _map else _none end),
           previous_copy = _grade_copy_remap(g.previous_copy, case when tg_argv[0] = 'criteria' then _map else _none end,
                               case when tg_argv[0] = 'checks' then _map else _none end,
                               case when tg_argv[0] = 'tags' then _map else _none end)
     where g.enrollment_id = new.enrollment_id and g.assessment_id = new.assessment_id
       and (g.returned_copy is not null or g.previous_copy is not null);
    update grade_return_before b
       set copy = _grade_copy_remap(b.copy, case when tg_argv[0] = 'criteria' then _map else _none end,
                      case when tg_argv[0] = 'checks' then _map else _none end,
                      case when tg_argv[0] = 'tags' then _map else _none end)
     where b.enrollment_id = new.enrollment_id and b.assessment_id = new.assessment_id
       and b.txid = txid_current() and b.copy is not null;
    return null;
end;
$function$;

-- move_rubric_scores calls this once its rows have moved: the copies kept
-- for students follow, also for a criterion or checkbox the working copy no
-- longer has a row for (a level cleared in a draft).
create or replace function fv_private.grade_return_remap(p_assessment_id uuid, p_criterion_map jsonb, p_check_map jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    -- Only inside move_rubric_scores, and only for the caller's own class.
    if coalesce(current_setting('fv.moving_rubric', true), '') <> 'on'
       or not fv_owns_assessment(p_assessment_id) then
        return;
    end if;
    update grade_return g
       set returned_copy = _grade_copy_remap(g.returned_copy, coalesce(p_criterion_map, '{}'::jsonb), coalesce(p_check_map, '{}'::jsonb)),
           previous_copy = _grade_copy_remap(g.previous_copy, coalesce(p_criterion_map, '{}'::jsonb), coalesce(p_check_map, '{}'::jsonb))
     where g.assessment_id = p_assessment_id
       and (g.returned_copy is not null or g.previous_copy is not null);
end;
$function$;
revoke all on function public._grade_copy_remap(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function fv_private.grade_return_remap(uuid, jsonb, jsonb) from public, anon;
grant execute on function fv_private.grade_return_remap(uuid, jsonb, jsonb) to authenticated, service_role;

-- Only triggers and the functions here call these.
revoke all on function public._grade_copy_of(numeric, integer, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._grade_copy_entry(integer, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public._grade_copy(uuid, uuid) from public, anon, authenticated;
revoke all on function public._grade_return_holds(uuid) from public, anon, authenticated;
revoke all on function public._grade_return_lock(uuid) from public, anon, authenticated;
revoke all on function public._grade_return_before() from public, anon, authenticated;
revoke all on function public._grade_return_apply(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._grade_return_on_change() from public, anon, authenticated;
revoke all on function public._grade_return_repoint() from public, anon, authenticated;

-- On each of the four tables: one row trigger before, and three statement
-- triggers after (a trigger with transition tables takes one event).
do $triggers$
declare
    _t record;
begin
    for _t in
        select * from (values
            ('score',              'score'),
            ('tag_score',          'tags'),
            ('rubric_score',       'criteria'),
            ('rubric_check_score', 'checks')
        ) as v(tbl, part)
    loop
        execute format('drop trigger if exists grade_return_before on public.%I', _t.tbl);
        execute format('drop trigger if exists grade_return_insert on public.%I', _t.tbl);
        execute format('drop trigger if exists grade_return_update on public.%I', _t.tbl);
        execute format('drop trigger if exists grade_return_delete on public.%I', _t.tbl);
        execute format('create trigger grade_return_before before insert or update or delete on public.%I '
                       'for each row execute function public._grade_return_before(%L)', _t.tbl, _t.part);
        execute format('create trigger grade_return_insert after insert on public.%I '
                       'referencing new table as new_rows for each statement '
                       'execute function public._grade_return_on_change()', _t.tbl);
        execute format('create trigger grade_return_update after update on public.%I '
                       'referencing old table as old_rows new table as new_rows for each statement '
                       'execute function public._grade_return_on_change()', _t.tbl);
        execute format('create trigger grade_return_delete after delete on public.%I '
                       'referencing old table as old_rows for each statement '
                       'execute function public._grade_return_on_change()', _t.tbl);
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
-- One draft returned. return_grades, the class leaving When I Return Them
-- and the restore all return a grade through here, so each does the same.
create or replace function public._grade_return_one(p_enrollment_id uuid, p_assessment_id uuid, p_at timestamptz)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
           set is_draft = false, returned_at = null, returned_copy = null, previous_copy = null, updated_at = null
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    else
        update grade_return
           set is_draft = false, returned_at = p_at, returned_copy = null,
               previous_copy = case when _g.returned_copy is not null then _g.returned_copy else previous_copy end,
               updated_at = case when _g.returned_copy is not null then p_at else updated_at end
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    end if;
    return true;
end;
$function$;
revoke all on function public._grade_return_one(uuid, uuid, timestamptz) from public, anon, authenticated;

-- A class stops holding grades: everything that was waiting is returned.
create or replace function public._grade_return_release()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
revoke all on function public._grade_return_release() from public, anon, authenticated;
drop trigger if exists grade_return_release on public.course;
create trigger grade_return_release
    after update of student_page_enabled, return_grades on public.course
    for each row
    when ((old.student_page_enabled and old.return_grades is not distinct from 'on_return')
          and not (new.student_page_enabled and new.return_grades is not distinct from 'on_return'))
    execute function public._grade_return_release();

create or replace function public.return_grades(
    p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    perform _grade_return_lock(_course);
    for _e in
        select g.enrollment_id from grade_return g
          join enrollment e on e.id = g.enrollment_id
         where g.assessment_id = p_assessment_id
           and g.enrollment_id = any (coalesce(p_enrollment_ids, '{}'))
           and e.course_id = _course
           and g.is_draft
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
revoke all on function public.return_grades(uuid, uuid[], uuid) from public, anon;
grant execute on function public.return_grades(uuid, uuid[], uuid) to authenticated, service_role;

create or replace function public.list_course_grade_returns(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
    select coalesce(jsonb_object_agg(x.assessment_id::text, x.students), '{}'::jsonb)
      from (select g.assessment_id,
                   jsonb_object_agg(g.enrollment_id::text, jsonb_strip_nulls(jsonb_build_object(
                       'is_draft', g.is_draft, 'returned_at', g.returned_at, 'updated_at', g.updated_at,
                       'seen_at', g.seen_at, 'returned_copy', g.returned_copy, 'previous_copy', g.previous_copy))) as students
              from grade_return g
              join enrollment e on e.id = g.enrollment_id
             where e.course_id = p_course_id
               -- a row with nothing to say (a grade cleared, a save in flight) is left out
               and (g.is_draft or g.returned_at is not null or g.seen_at is not null)
             group by g.assessment_id) x;
$function$;
revoke all on function public.list_course_grade_returns(uuid) from public, anon;
grant execute on function public.list_course_grade_returns(uuid) to authenticated, service_role;

-- How many grades in the class are waiting as drafts: what the settings
-- screen says before it changes Return Grades or turns the student page off.
create or replace function public.course_draft_count(p_course_id uuid)
 returns integer
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
    select count(*)::int
      from grade_return g
      join enrollment e on e.id = g.enrollment_id
     where e.course_id = p_course_id and g.is_draft;
$function$;
revoke all on function public.course_draft_count(uuid) from public, anon;
grant execute on function public.course_draft_count(uuid) to authenticated, service_role;

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

    -- A level must be for a criterion on the assessment's rubric, as
    -- set_rubric_check checks its checkbox. Only what is certainly wrong is
    -- refused: the assessment has a rubric, the criterion is not on it, and
    -- the call sets a real level. With no rubric attached yet the call is
    -- taken as before (a score can arrive ahead of the rubric it belongs
    -- to). A call with no level for a criterion that is not on the rubric
    -- (an older client's 0 after Edit a Copy, with or without a comment)
    -- keeps nothing and clears any stray row.
    if exists (select 1 from assessment a where a.id = p_assessment_id and a.rubric_id is not null)
       and not exists (select 1 from criterion c join assessment a on a.rubric_id = c.rubric_id
                        where c.id = p_criterion_id and a.id = p_assessment_id) then
        if p_value is not null and p_value <> 0 then
            raise exception 'criterion % is not in the rubric of assessment %', p_criterion_id, p_assessment_id
                using errcode = '22023';
        end if;
        delete from rubric_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
        return null;
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

    -- Missing is for work with no score: refused on work the app shows as
    -- scored (the rows its scoring uses now), unless it is already marked
    -- Missing. Excused and Late are not checked; a comment is not a score.
    if p_status = 'NS'
       and not exists (select 1 from score where enrollment_id = p_enrollment_id
                          and assessment_id = p_assessment_id and status = 'NS')
       and fv_private.work_is_scored(p_enrollment_id, p_assessment_id) then
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
            'fv.moving_rubric',
$s$    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$s$,
$s$    -- Draft and Returned: the updates below point scores at the copy's
    -- criteria and checkboxes. They are a rubric move, not a change to any
    -- grade, and the triggers read this flag to know it.
    perform set_config('fv.moving_rubric', 'on', true);

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$s$],
      array['public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', '', '',
$s$    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$,
$s$    -- The copies kept for students follow the scores to the new ids, also
    -- where the working copy no longer has the row.
    perform fv_private.grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);
    perform set_config('fv.moving_rubric', '', true);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$],
      -- duplicate_course: the copy keeps the original's Return Grades choice
      -- (its student page starts off, the column's default).
      array['public.duplicate_course(uuid,uuid)',
            '528aacf8cb9581682178b1914a32fc20',
            'courses_count_equally, return_grades',
$s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally)$s$,
$s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades)$s$],
      array['public.duplicate_course(uuid,uuid)', '', '',
$s$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally
$s$,
$s$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades
$s$],
      -- import_json_restore, three edits: the class's two settings (twice:
      -- the insert and its on-conflict update), then the state after the scores.
      array['public.import_json_restore(jsonb,uuid)',
            '58e48ae4f7ebcc05489b489a4f8906df',
            'restore_grade_returns',
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
    perform fv_private.restore_grade_returns(p_payload);

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
-- Called by import_json_restore once its rows are in: every restored grade
-- is Returned, then the backup's own grade_returns rows are applied as they
-- are. So a restore is a way for a teacher to set the state of grades in
-- their own class (see 7 in the header); it is by design. What this helper
-- adds to that: it does nothing outside import_json_restore, it touches
-- only the caller's own students, and it is not in the API.
create or replace function fv_private.restore_grade_returns(p_payload jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
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
        -- A draft waits only in a class that holds grades: in any other,
        -- the restored drafts are returned, as when a class leaves When I
        -- Return Them.
        perform _grade_return_one(g.enrollment_id, g.assessment_id, _at)
           from grade_return g
          where g.is_draft and fv_owns_enrollment(g.enrollment_id)
            and g.enrollment_id in (select nullif(r->>'enrollment_id', '')::uuid
                                      from jsonb_array_elements(p_payload->'grade_returns') r)
            and not _grade_return_holds(g.enrollment_id);
    end if;
    return _n;
end;
$function$;
-- import_json_restore is SECURITY INVOKER, so the teacher's role must be
-- able to run this.
revoke all on function fv_private.restore_grade_returns(jsonb) from public, anon;
grant execute on function fv_private.restore_grade_returns(jsonb) to authenticated, service_role;

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

commit;
