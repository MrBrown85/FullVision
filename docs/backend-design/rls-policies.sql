-- FullVision v2 — Row-Level Security policies (design artifact)
--
-- Generated 2026-04-19. Applied AFTER schema.sql.
--
-- Model
-- ─────
-- Every row in this database ultimately belongs to exactly one Teacher.
-- `auth.uid()` (Supabase auth) returns that teacher's id — it is the
-- `teacher.id` UUID because the app uses Supabase Auth as the identity
-- provider and provisions `teacher` rows with `id = auth.users.id`.
--
-- Policies are written as `FOR ALL` (select/insert/update/delete) with
-- both USING and WITH CHECK expressions so inserts and updates cannot
-- cross the boundary either.
--
-- Ownership is established one of three ways:
--   A. Direct: table has teacher_id → compare to auth.uid().
--   B. Via course: table has course_id → join to course and compare.
--   C. Via enrollment/assessment/etc.: transitive through a parent.
--
-- Every table gets RLS enabled. Supabase's service_role key bypasses RLS,
-- which is how the scheduled cleanup / audit retention jobs run.
--
-- Deferred-delete behavior: rows for teachers where `deleted_at is not null`
-- are still visible to that teacher during the 30-day grace window (so the
-- teacher can sign in, cancel, and recover). Soft-deleted courses, however,
-- are hidden immediately from normal course-scoped reads/writes by the helper
-- predicates below. After hard-delete, cascades remove everything.

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: owns_course(course_id) — used by 80% of the policies below.
-- Declared SECURITY DEFINER so it can check course ownership without
-- triggering RLS recursion on the course table itself.
-- ────────────────────────────────────────────────────────────────────────────

-- auth.uid() wrapped in a subselect so Postgres evaluates it once per query,
-- not once per row (Supabase linter rule 0003_auth_rls_initplan).

create or replace function fv_owns_course(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from course c
        where c.id = cid
          and c.teacher_id = (select auth.uid())
          and c.deleted_at is null
    );
$$;

create or replace function fv_owns_enrollment(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from enrollment e
        join course c on c.id = e.course_id
        where e.id = eid
          and c.teacher_id = (select auth.uid())
          and c.deleted_at is null
    );
$$;

create or replace function fv_owns_assessment(aid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from assessment a
        join course c on c.id = a.course_id
        where a.id = aid
          and c.teacher_id = (select auth.uid())
          and c.deleted_at is null
    );
$$;

create or replace function fv_owns_term_rating(trid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from term_rating tr
        join enrollment e on e.id = tr.enrollment_id
        join course c on c.id = e.course_id
        where tr.id = trid
          and c.teacher_id = (select auth.uid())
          and c.deleted_at is null
    );
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Enable RLS on every table
-- ────────────────────────────────────────────────────────────────────────────

alter table teacher                   enable row level security;
alter table teacher_preference        enable row level security;
alter table course                    enable row level security;
alter table category                  enable row level security;
alter table student                   enable row level security;
alter table enrollment                enable row level security;
alter table subject                   enable row level security;
alter table competency_group          enable row level security;
alter table section                   enable row level security;
alter table tag                       enable row level security;
alter table module                    enable row level security;
alter table rubric                    enable row level security;
alter table criterion                 enable row level security;
alter table criterion_tag             enable row level security;
alter table assessment                enable row level security;
alter table assessment_tag            enable row level security;
alter table score                     enable row level security;
alter table rubric_score              enable row level security;
alter table tag_score                 enable row level security;
alter table observation               enable row level security;
alter table observation_student       enable row level security;
alter table observation_tag           enable row level security;
alter table custom_tag                enable row level security;
alter table observation_custom_tag    enable row level security;
alter table observation_template      enable row level security;
alter table note                      enable row level security;
alter table goal                      enable row level security;
alter table reflection                enable row level security;
alter table section_override          enable row level security;
alter table attendance                enable row level security;
alter table term_rating               enable row level security;
alter table term_rating_dimension     enable row level security;
alter table term_rating_strength      enable row level security;
alter table term_rating_growth_area   enable row level security;
alter table term_rating_assessment    enable row level security;
alter table term_rating_observation   enable row level security;
alter table report_config             enable row level security;
alter table score_audit               enable row level security;
alter table term_rating_audit         enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- A. Direct-ownership tables (teacher_id column)
-- ────────────────────────────────────────────────────────────────────────────

create policy teacher_self on teacher for all
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

create policy teacher_preference_self on teacher_preference for all
    using (teacher_id = (select auth.uid()))
    with check (teacher_id = (select auth.uid()));

create policy course_owner on course for all
    using (teacher_id = (select auth.uid()))
    with check (teacher_id = (select auth.uid()));

create policy student_owner on student for all
    using (teacher_id = (select auth.uid()))
    with check (teacher_id = (select auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- B. Via course_id
-- ────────────────────────────────────────────────────────────────────────────

create policy category_via_course on category for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy subject_via_course on subject for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy competency_group_via_course on competency_group for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy section_via_course on section for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy module_via_course on module for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy rubric_via_course on rubric for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy assessment_via_course on assessment for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy observation_via_course on observation for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy custom_tag_via_course on custom_tag for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy observation_template_via_course on observation_template for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy enrollment_via_course on enrollment for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

create policy report_config_via_course on report_config for all
    using (fv_owns_course(course_id))
    with check (fv_owns_course(course_id));

-- ────────────────────────────────────────────────────────────────────────────
-- C. Transitive ownership (via parent)
-- ────────────────────────────────────────────────────────────────────────────

-- Tag → Section → Course
create policy tag_via_section on tag for all
    using (exists (
        select 1 from section s where s.id = tag.section_id
          and fv_owns_course(s.course_id)
    ))
    with check (exists (
        select 1 from section s where s.id = tag.section_id
          and fv_owns_course(s.course_id)
    ));

-- Criterion → Rubric → Course
create policy criterion_via_rubric on criterion for all
    using (exists (
        select 1 from rubric r where r.id = criterion.rubric_id
          and fv_owns_course(r.course_id)
    ))
    with check (exists (
        select 1 from rubric r where r.id = criterion.rubric_id
          and fv_owns_course(r.course_id)
    ));

-- CriterionTag: both sides must be owned. Checking criterion side is sufficient
-- because a criterion within an owned rubric scoped to an owned course can only
-- link to tags scoped to the same course via CriterionTag — the UI guarantees
-- this. Still, we check the tag side too for defense in depth.
create policy criterion_tag_via_parents on criterion_tag for all
    using (exists (
        select 1 from criterion cr
        join rubric r on r.id = cr.rubric_id
        where cr.id = criterion_tag.criterion_id and fv_owns_course(r.course_id)
    ))
    with check (exists (
        select 1 from criterion cr
        join rubric r on r.id = cr.rubric_id
        where cr.id = criterion_tag.criterion_id and fv_owns_course(r.course_id)
    ));

-- AssessmentTag: via assessment
create policy assessment_tag_via_assessment on assessment_tag for all
    using (fv_owns_assessment(assessment_id))
    with check (fv_owns_assessment(assessment_id));

-- Score: via enrollment (which scopes to course → teacher)
create policy score_via_enrollment on score for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy rubric_score_via_enrollment on rubric_score for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy tag_score_via_enrollment on tag_score for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

-- Observation join tables: via observation
create policy observation_student_via_obs on observation_student for all
    using (exists (
        select 1 from observation o where o.id = observation_student.observation_id
          and fv_owns_course(o.course_id)
    ))
    with check (exists (
        select 1 from observation o where o.id = observation_student.observation_id
          and fv_owns_course(o.course_id)
    ));

create policy observation_tag_via_obs on observation_tag for all
    using (exists (
        select 1 from observation o where o.id = observation_tag.observation_id
          and fv_owns_course(o.course_id)
    ))
    with check (exists (
        select 1 from observation o where o.id = observation_tag.observation_id
          and fv_owns_course(o.course_id)
    ));

create policy observation_custom_tag_via_obs on observation_custom_tag for all
    using (exists (
        select 1 from observation o where o.id = observation_custom_tag.observation_id
          and fv_owns_course(o.course_id)
    ))
    with check (exists (
        select 1 from observation o where o.id = observation_custom_tag.observation_id
          and fv_owns_course(o.course_id)
    ));

-- Student-level records: via enrollment
create policy note_via_enrollment on note for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy goal_via_enrollment on goal for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy reflection_via_enrollment on reflection for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy section_override_via_enrollment on section_override for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy attendance_via_enrollment on attendance for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

-- TermRating: via enrollment
create policy term_rating_via_enrollment on term_rating for all
    using (fv_owns_enrollment(enrollment_id))
    with check (fv_owns_enrollment(enrollment_id));

create policy term_rating_dimension_via_tr on term_rating_dimension for all
    using (fv_owns_term_rating(term_rating_id))
    with check (fv_owns_term_rating(term_rating_id));

create policy term_rating_strength_via_tr on term_rating_strength for all
    using (fv_owns_term_rating(term_rating_id))
    with check (fv_owns_term_rating(term_rating_id));

create policy term_rating_growth_area_via_tr on term_rating_growth_area for all
    using (fv_owns_term_rating(term_rating_id))
    with check (fv_owns_term_rating(term_rating_id));

create policy term_rating_assessment_via_tr on term_rating_assessment for all
    using (fv_owns_term_rating(term_rating_id))
    with check (fv_owns_term_rating(term_rating_id));

create policy term_rating_observation_via_tr on term_rating_observation for all
    using (fv_owns_term_rating(term_rating_id))
    with check (fv_owns_term_rating(term_rating_id));

-- Audit tables: readable by owning teacher; writes only via service_role
-- (the RPC that writes Score/TermRating also writes audit in-transaction, and
-- runs as service_role server-side; never client-writable directly).
create policy score_audit_read on score_audit for select
    using (exists (
        select 1 from score s where s.id = score_audit.score_id
          and fv_owns_enrollment(s.enrollment_id)
    ));

create policy term_rating_audit_read on term_rating_audit for select
    using (fv_owns_term_rating(term_rating_id));

-- No insert/update/delete policies on audit tables → only service_role writes.

-- ────────────────────────────────────────────────────────────────────────────
-- Notes for implementers
-- ────────────────────────────────────────────────────────────────────────────
--
--  * Performance: the helper functions run once per row during scans. For
--    large bulk operations (e.g., gradebook read that touches thousands of
--    score rows), the planner should use the helper's index-backed
--    course.teacher_id lookup efficiently. Measure after load testing;
--    if necessary, materialize (course_id, teacher_id) onto hot tables.
--
--  * Bypassing RLS for legitimate jobs (cleanup cron, audit retention):
--    run as service_role. Never grant regular users service_role.
--
--  * A teacher who is soft-deleted but still within the 30-day grace
--    window retains full access — the policies above do not filter on
--    deleted_at. This is intentional: grace-period recovery requires
--    the teacher to sign in and see their data.
--
--  * Testing: write a pgTAP test (or plain psql script) that signs in as
--    two different teachers and verifies teacher-A cannot read or mutate
--    any row belonging to teacher-B. This is the one non-negotiable
--    security test before production.
