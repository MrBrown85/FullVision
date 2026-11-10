-- A score row belongs to one class (2026-11-09).
--
-- What was wrong (found by the first SQL tests of the score RPCs,
-- migrations/local-test/score_rpcs.py, PR 958): row security on score,
-- tag_score, rubric_score, rubric_check_score and dibels_score checked only
-- that the caller owns the enrollment. The foreign keys to assessment, tag,
-- criterion and criterion_check do not check an owner. So a teacher could
-- save a score for their own student against another teacher's assessment,
-- competency, criterion or checkbox by sending its id, or against an
-- assessment in another of their own classes. Nothing read such a row back
-- to the other teacher, and the app never sends one, but the row was
-- accepted.
--
-- Now a row in those five tables can be read, changed or deleted only when
-- the caller owns the enrollment AND the assessment is in the enrollment's
-- class. To insert or change a row, the other record it names must be in
-- that class too: tag_score's competency (tag -> section -> course),
-- rubric_score's criterion (criterion -> rubric -> course) and
-- rubric_check_score's checkbox (criterion_check -> criterion -> rubric ->
-- course). Same class, not same teacher: a competency and a rubric each
-- belong to one class (section.course_id, rubric.course_id); a rubric used
-- in two classes is two rubrics joined by copy_group.
--
-- The check on what a row names is on writes only (WITH CHECK). A row that
-- already names another class's competency or criterion stays readable and
-- can still be cleared; it cannot be given a new level.
--
-- Who it covers: every score RPC is SECURITY INVOKER (upsert_score,
-- upsert_tag_score, upsert_rubric_score, fill_rubric, set_rubric_check,
-- save_score_comment, save_score_report_note, set_score_status, clear_score,
-- clear_row_scores, clear_column_scores, move_rubric_scores,
-- upsert_dibels_score), and so are import_json_restore, duplicate_course and
-- duplicate_assessment, so the policies apply to all of them. The SECURITY
-- DEFINER functions that touch these tables are not affected and need no
-- change: get_class_bundle only reads, and filters by the class it was asked
-- for after its own ownership check; _score_audit_diff writes score_audit
-- only; fv_retention_cleanup deletes whole classes.
--
-- Still open, on purpose (PR 958 lists them): a competency the assessment is
-- not linked to, a criterion from another rubric in the same class (no
-- migration in this batch refuses it: that waits until the client sends a
-- rubric change before the scores that depend on it), points over the
-- maximum, a score on Excused or Missing work, Missing on work that has a
-- score, and ticked checkboxes left behind by the three clear functions.
--
-- Cost: one helper call per row, as today. fv_owns_enrollment joins two
-- tables by primary key; these join three (five for a checkbox), all by
-- primary key, no scans. Filling a rubric for 30 students with 5 criteria
-- is 30 fill_rubric calls writing 150 rows; on the local harness all 30 took
-- about 15 ms before and 21 ms after (migrations/local-test/batch_a_apply.py
-- prints it). Class loads do not run these policies: get_class_bundle is
-- SECURITY DEFINER.
--
-- Existing rows: none change. The file's first step counts the rows below
-- and stops, with nothing changed, unless the answer is 0: a row it counts
-- would disappear from its teacher's view when the policies change. To look
-- before applying, run it by hand (counted 0 on gradebook-prod on
-- 2026-11-09: score 1,872 rows, tag_score 697, rubric_score 3,964,
-- rubric_check_score 500, dibels_score 0).
--
--   select (select count(*) from score x join enrollment e on e.id = x.enrollment_id
--             join assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
--        + (select count(*) from tag_score x join enrollment e on e.id = x.enrollment_id
--             join assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
--        + (select count(*) from rubric_score x join enrollment e on e.id = x.enrollment_id
--             join assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
--        + (select count(*) from rubric_check_score x join enrollment e on e.id = x.enrollment_id
--             join assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
--        + (select count(*) from dibels_score x join enrollment e on e.id = x.enrollment_id
--             join assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
--          as rows_in_another_class;
--
-- And this one, for the other record each row names. A row it counts stays
-- visible and can be cleared, but its level can no longer be changed:
--
--   select (select count(*) from tag_score x join enrollment e on e.id = x.enrollment_id
--             join tag t on t.id = x.tag_id join section s on s.id = t.section_id
--            where s.course_id <> e.course_id) as competencies_from_another_class,
--          (select count(*) from rubric_score x join enrollment e on e.id = x.enrollment_id
--             join criterion c on c.id = x.criterion_id join rubric r on r.id = c.rubric_id
--            where r.course_id <> e.course_id) as criteria_from_another_class,
--          (select count(*) from rubric_check_score x join enrollment e on e.id = x.enrollment_id
--             join criterion_check k on k.id = x.check_id join criterion c on c.id = k.criterion_id
--             join rubric r on r.id = c.rubric_id
--            where r.course_id <> e.course_id) as checkboxes_from_another_class;
--
-- Can be run again: every statement replaces what it made.
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
    _n bigint;
begin
    select (select count(*) from public.score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.tag_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.rubric_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.rubric_check_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.dibels_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
      into _n;
    if _n > 0 then
        raise exception '% score rows name an assessment in another class than their student''s; the new policies would hide them from their teacher. Nothing was changed.', _n;
    end if;
end
$guard$;

-- ── The helpers, in the style of fv_owns_enrollment ─────────────────────────
-- pg_temp is named last in each search_path, so a temporary table called
-- `course` or `enrollment` cannot stand in for the real one (the older
-- fv_owns_* helpers lack this; see the PR).
create or replace function public.fv_owns_score_cell(eid uuid, aid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select exists (select 1 from enrollment e
                     join course c on c.id = e.course_id
                     join assessment a on a.course_id = e.course_id
                   where e.id = eid and a.id = aid
                     and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.fv_owns_tag_score_cell(eid uuid, aid uuid, tid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select exists (select 1 from enrollment e
                     join course c on c.id = e.course_id
                     join assessment a on a.course_id = e.course_id
                     join section s on s.course_id = e.course_id
                     join tag t on t.section_id = s.id
                   where e.id = eid and a.id = aid and t.id = tid
                     and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.fv_owns_rubric_score_cell(eid uuid, aid uuid, crid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select exists (select 1 from enrollment e
                     join course c on c.id = e.course_id
                     join assessment a on a.course_id = e.course_id
                     join rubric r on r.course_id = e.course_id
                     join criterion cr on cr.rubric_id = r.id
                   where e.id = eid and a.id = aid and cr.id = crid
                     and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.fv_owns_rubric_check_cell(eid uuid, aid uuid, ckid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select exists (select 1 from enrollment e
                     join course c on c.id = e.course_id
                     join assessment a on a.course_id = e.course_id
                     join rubric r on r.course_id = e.course_id
                     join criterion cr on cr.rubric_id = r.id
                     join criterion_check ck on ck.criterion_id = cr.id
                   where e.id = eid and a.id = aid and ck.id = ckid
                     and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

-- Policies run as the caller, so signed-in teachers need EXECUTE.
revoke all on function public.fv_owns_score_cell(uuid, uuid) from public, anon;
revoke all on function public.fv_owns_tag_score_cell(uuid, uuid, uuid) from public, anon;
revoke all on function public.fv_owns_rubric_score_cell(uuid, uuid, uuid) from public, anon;
revoke all on function public.fv_owns_rubric_check_cell(uuid, uuid, uuid) from public, anon;
grant execute on function public.fv_owns_score_cell(uuid, uuid) to authenticated, service_role;
grant execute on function public.fv_owns_tag_score_cell(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.fv_owns_rubric_score_cell(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.fv_owns_rubric_check_cell(uuid, uuid, uuid) to authenticated, service_role;

-- ── The policies ────────────────────────────────────────────────────────────
drop policy if exists score_via_enrollment on public.score;
drop policy if exists score_same_class on public.score;
create policy score_same_class on public.score
    for all
    using (public.fv_owns_score_cell(enrollment_id, assessment_id))
    with check (public.fv_owns_score_cell(enrollment_id, assessment_id));

drop policy if exists dibels_score_via_enrollment on public.dibels_score;
drop policy if exists dibels_score_same_class on public.dibels_score;
create policy dibels_score_same_class on public.dibels_score
    for all
    using (public.fv_owns_score_cell(enrollment_id, assessment_id))
    with check (public.fv_owns_score_cell(enrollment_id, assessment_id));

drop policy if exists tag_score_via_enrollment on public.tag_score;
drop policy if exists tag_score_same_class on public.tag_score;
create policy tag_score_same_class on public.tag_score
    for all
    using (public.fv_owns_score_cell(enrollment_id, assessment_id))
    with check (public.fv_owns_tag_score_cell(enrollment_id, assessment_id, tag_id));

drop policy if exists rubric_score_via_enrollment on public.rubric_score;
drop policy if exists rubric_score_same_class on public.rubric_score;
create policy rubric_score_same_class on public.rubric_score
    for all
    using (public.fv_owns_score_cell(enrollment_id, assessment_id))
    with check (public.fv_owns_rubric_score_cell(enrollment_id, assessment_id, criterion_id));

drop policy if exists rubric_check_score_via_enrollment on public.rubric_check_score;
drop policy if exists rubric_check_score_same_class on public.rubric_check_score;
create policy rubric_check_score_same_class on public.rubric_check_score
    for all
    using (public.fv_owns_score_cell(enrollment_id, assessment_id))
    with check (public.fv_owns_rubric_check_cell(enrollment_id, assessment_id, check_id));

notify pgrst, 'reload schema';

commit;
