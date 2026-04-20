-- FullVision v2 — Schema migration (design artifact)
--
-- Generated from erd.md + DECISIONS.md on 2026-04-19.
-- Target: Supabase Postgres 15+ (pgcrypto enabled for gen_random_uuid).
--
-- Conventions:
--   - Snake_case table + column names (Postgres/PostgREST idiomatic).
--   - All timestamps are timestamptz.
--   - PKs default to gen_random_uuid().
--   - updated_at columns are application-maintained (set in the write path);
--     a trigger could be added later if desired.
--   - RLS policies are NOT included here — they live in a separate migration
--     (policies reference auth.uid(), which requires the Supabase auth schema).
--   - Foreign keys use ON DELETE CASCADE for child rows owned by a parent
--     (Enrollment child of Course, Score child of Assessment, etc.) and
--     ON DELETE RESTRICT for references that must survive parent lifecycle
--     (Assessment.category_id → Category: SET NULL instead, so dropping a
--     category orphans assessments rather than cascading into score deletion).
--
-- This file is a DESIGN ARTIFACT. It should be re-expressed as one or more
-- timestamped Supabase migration files when implementation begins.

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- Core: Teacher, TeacherPreference
-- ────────────────────────────────────────────────────────────────────────────

create table teacher (
    id            uuid primary key default gen_random_uuid(),
    email         text not null unique,
    display_name  text,
    created_at    timestamptz not null default now(),
    deleted_at    timestamptz  -- soft-delete marker; cleanup job hard-deletes
                               -- rows where deleted_at < now() - interval '30 days'
);

-- TeacherPreference: 1:1 with Teacher, teacher_id is the PK.
create table teacher_preference (
    teacher_id           uuid primary key references teacher(id) on delete cascade,
    active_course_id     uuid,  -- FK added after course table exists
    view_mode            text,
    mobile_view_mode     text,
    mobile_sort_mode     text,
    card_widget_config   jsonb
);

-- ────────────────────────────────────────────────────────────────────────────
-- Course and policy
-- ────────────────────────────────────────────────────────────────────────────

create table course (
    id               uuid primary key default gen_random_uuid(),
    teacher_id       uuid not null references teacher(id) on delete cascade,
    name             text not null,
    grade_level      text,
    description      text,
    color            text,
    is_archived      boolean not null default false,
    display_order    int not null default 0,
    grading_system   text not null default 'proficiency'
                     check (grading_system in ('proficiency','letter','both')),
    calc_method      text not null default 'average'
                     check (calc_method in ('average','median','mostRecent','highest','mode','decayingAvg')),
    decay_weight     numeric check (decay_weight is null or (decay_weight >= 0 and decay_weight <= 1)),
    timezone         text not null default 'America/Vancouver',
    late_work_policy text,  -- display-only free text
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index course_teacher_idx on course(teacher_id) where is_archived = false;

-- Now add the deferred FK on teacher_preference.active_course_id
alter table teacher_preference
    add constraint teacher_preference_active_course_fk
    foreign key (active_course_id) references course(id) on delete set null;

-- Category: teacher-named assessment grouping with a percentage weight.
create table category (
    id             uuid primary key default gen_random_uuid(),
    course_id      uuid not null references course(id) on delete cascade,
    name           text not null,
    weight         numeric not null check (weight >= 0 and weight <= 100),
    display_order  int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index category_course_idx on category(course_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Student + Enrollment
-- ────────────────────────────────────────────────────────────────────────────

create table student (
    id              uuid primary key default gen_random_uuid(),
    teacher_id      uuid not null references teacher(id) on delete cascade,
    first_name      text not null,
    last_name       text,
    preferred_name  text,
    pronouns        text,
    student_number  text,
    email           text,
    date_of_birth   date,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index student_teacher_idx on student(teacher_id);

create table enrollment (
    id               uuid primary key default gen_random_uuid(),
    student_id       uuid not null references student(id) on delete cascade,
    course_id        uuid not null references course(id) on delete cascade,
    designations     text[] not null default '{}',  -- e.g. {'IEP','MOD'}
    roster_position  int not null default 0,
    is_flagged       boolean not null default false,
    withdrawn_at     timestamptz,  -- null = active
    enrolled_at      timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (student_id, course_id)
);
create index enrollment_course_idx on enrollment(course_id);
create index enrollment_student_idx on enrollment(student_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Learning map: Subject, CompetencyGroup, Section, Tag
-- ────────────────────────────────────────────────────────────────────────────

create table subject (
    id             uuid primary key default gen_random_uuid(),
    course_id      uuid not null references course(id) on delete cascade,
    name           text not null,
    display_order  int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    -- composite uniqueness to support Section's composite FK
    constraint subject_id_course_uk unique (id, course_id)
);
create index subject_course_idx on subject(course_id);

create table competency_group (
    id             uuid primary key default gen_random_uuid(),
    course_id      uuid not null references course(id) on delete cascade,
    name           text not null,
    color          text,
    display_order  int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint competency_group_id_course_uk unique (id, course_id)
);
create index competency_group_course_idx on competency_group(course_id);

create table section (
    id                    uuid primary key default gen_random_uuid(),
    course_id             uuid not null,          -- denormalized; enforced via composite FK
    subject_id            uuid not null,
    competency_group_id   uuid,                   -- nullable
    name                  text not null,
    display_order         int not null default 0,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    -- Composite FKs guarantee course_id matches subject.course_id (and, when
    -- set, competency_group.course_id). See erd.md Design Notes.
    constraint section_subject_fk
        foreign key (subject_id, course_id)
        references subject(id, course_id) on delete cascade,
    constraint section_competency_group_fk
        foreign key (competency_group_id, course_id)
        references competency_group(id, course_id)
        match simple on delete set null (competency_group_id)
);
create index section_course_idx on section(course_id);
create index section_subject_idx on section(subject_id);

create table tag (
    id             uuid primary key default gen_random_uuid(),
    section_id     uuid not null references section(id) on delete cascade,
    code           text,
    label          text not null,
    i_can_text     text,
    display_order  int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index tag_section_idx on tag(section_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Module, Rubric, Criterion
-- ────────────────────────────────────────────────────────────────────────────

create table module (
    id             uuid primary key default gen_random_uuid(),
    course_id      uuid not null references course(id) on delete cascade,
    name           text not null,
    color          text,
    display_order  int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index module_course_idx on module(course_id);

create table rubric (
    id          uuid primary key default gen_random_uuid(),
    course_id   uuid not null references course(id) on delete cascade,
    name        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index rubric_course_idx on rubric(course_id);

create table criterion (
    id                    uuid primary key default gen_random_uuid(),
    rubric_id             uuid not null references rubric(id) on delete cascade,
    name                  text not null,
    level_4_descriptor    text,
    level_3_descriptor    text,
    level_2_descriptor    text,
    level_1_descriptor    text,
    level_4_value         numeric not null default 4,
    level_3_value         numeric not null default 3,
    level_2_value         numeric not null default 2,
    level_1_value         numeric not null default 1,
    weight                numeric not null default 1.0 check (weight >= 0),
    display_order         int not null default 0,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);
create index criterion_rubric_idx on criterion(rubric_id);

-- CriterionTag: join; tags a criterion assesses.
create table criterion_tag (
    criterion_id  uuid not null references criterion(id) on delete cascade,
    tag_id        uuid not null references tag(id) on delete cascade,
    primary key (criterion_id, tag_id)
);
create index criterion_tag_tag_idx on criterion_tag(tag_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Assessment
-- ────────────────────────────────────────────────────────────────────────────

create table assessment (
    id              uuid primary key default gen_random_uuid(),
    course_id       uuid not null references course(id) on delete cascade,
    category_id     uuid references category(id) on delete set null,
    title           text not null,
    description     text,
    date_assigned   date,
    due_date        date,
    score_mode      text not null default 'proficiency'
                    check (score_mode in ('proficiency','points')),
    max_points      numeric check (max_points is null or max_points > 0),
    weight          numeric not null default 1.0 check (weight >= 0),
    evidence_type   text,
    rubric_id       uuid references rubric(id) on delete set null,
    module_id       uuid references module(id) on delete set null,
    collab_mode     text not null default 'none'
                    check (collab_mode in ('none','pairs','groups')),
    collab_config   jsonb,  -- null when collab_mode = 'none'
    display_order   int not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index assessment_course_idx on assessment(course_id);
create index assessment_category_idx on assessment(category_id);
create index assessment_module_idx on assessment(module_id);
create index assessment_rubric_idx on assessment(rubric_id);
create index assessment_date_assigned_idx on assessment(course_id, date_assigned);

create table assessment_tag (
    assessment_id  uuid not null references assessment(id) on delete cascade,
    tag_id         uuid not null references tag(id) on delete cascade,
    primary key (assessment_id, tag_id)
);
create index assessment_tag_tag_idx on assessment_tag(tag_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Scoring: Score, RubricScore, TagScore
-- ────────────────────────────────────────────────────────────────────────────

create table score (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    assessment_id  uuid not null references assessment(id) on delete cascade,
    value          numeric,                    -- 1-4 proficiency or raw points
    status         text check (status in ('NS','EXC','LATE')),
    comment        text,
    scored_at      timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (enrollment_id, assessment_id)
);
create index score_assessment_idx on score(assessment_id);
create index score_enrollment_idx on score(enrollment_id);

-- RubricScore: per-criterion score. Sibling of Score (not child).
create table rubric_score (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    assessment_id  uuid not null references assessment(id) on delete cascade,
    criterion_id   uuid not null references criterion(id) on delete cascade,
    value          int not null check (value between 1 and 4),
    updated_at     timestamptz not null default now(),
    unique (enrollment_id, assessment_id, criterion_id)
);
create index rubric_score_assessment_idx on rubric_score(assessment_id);

-- TagScore: per-tag score for NON-rubric assessments only.
-- For rubric assessments, tag scores are derived from RubricScore + CriterionTag.
create table tag_score (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    assessment_id  uuid not null references assessment(id) on delete cascade,
    tag_id         uuid not null references tag(id) on delete cascade,
    value          int not null check (value between 1 and 4),
    updated_at     timestamptz not null default now(),
    unique (enrollment_id, assessment_id, tag_id)
);
create index tag_score_assessment_idx on tag_score(assessment_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Observations
-- ────────────────────────────────────────────────────────────────────────────

create table observation (
    id             uuid primary key default gen_random_uuid(),
    course_id      uuid not null references course(id) on delete cascade,
    body           text not null,
    sentiment      text check (sentiment in ('strength','growth','concern')),
    context_type   text,
    assessment_id  uuid references assessment(id) on delete set null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index observation_course_idx on observation(course_id);
create index observation_created_idx on observation(course_id, created_at desc);

create table observation_student (
    observation_id  uuid not null references observation(id) on delete cascade,
    enrollment_id   uuid not null references enrollment(id) on delete cascade,
    primary key (observation_id, enrollment_id)
);
create index observation_student_enrollment_idx on observation_student(enrollment_id);

create table observation_tag (
    observation_id  uuid not null references observation(id) on delete cascade,
    tag_id          uuid not null references tag(id) on delete cascade,
    primary key (observation_id, tag_id)
);

create table custom_tag (
    id          uuid primary key default gen_random_uuid(),
    course_id   uuid not null references course(id) on delete cascade,
    label       text not null,
    created_at  timestamptz not null default now()
);
create index custom_tag_course_idx on custom_tag(course_id);

create table observation_custom_tag (
    observation_id  uuid not null references observation(id) on delete cascade,
    custom_tag_id   uuid not null references custom_tag(id) on delete cascade,
    primary key (observation_id, custom_tag_id)
);

create table observation_template (
    id                    uuid primary key default gen_random_uuid(),
    course_id             uuid not null references course(id) on delete cascade,
    body                  text not null,
    default_sentiment     text check (default_sentiment is null or default_sentiment in ('strength','growth','concern')),
    default_context_type  text,
    is_seed               boolean not null default false,  -- seeds are immutable
    display_order         int not null default 0,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);
create index observation_template_course_idx on observation_template(course_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Student-level records: Note, Goal, Reflection, SectionOverride, Attendance
-- ────────────────────────────────────────────────────────────────────────────

-- Note: immutable — add/delete only, no updated_at.
create table note (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    body           text not null,
    created_at     timestamptz not null default now()
);
create index note_enrollment_idx on note(enrollment_id, created_at desc);

create table goal (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    section_id     uuid not null references section(id) on delete cascade,
    body           text not null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (enrollment_id, section_id)
);

create table reflection (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    section_id     uuid not null references section(id) on delete cascade,
    body           text,
    confidence     int check (confidence between 1 and 5),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (enrollment_id, section_id)
);

create table section_override (
    id             uuid primary key default gen_random_uuid(),
    enrollment_id  uuid not null references enrollment(id) on delete cascade,
    section_id     uuid not null references section(id) on delete cascade,
    level          int not null check (level between 1 and 4),
    reason         text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (enrollment_id, section_id)
);

create table attendance (
    id               uuid primary key default gen_random_uuid(),
    enrollment_id    uuid not null references enrollment(id) on delete cascade,
    attendance_date  date not null,
    status           text not null,
    updated_at       timestamptz not null default now(),
    unique (enrollment_id, attendance_date)
);
create index attendance_enrollment_idx on attendance(enrollment_id, attendance_date desc);

-- ────────────────────────────────────────────────────────────────────────────
-- Term ratings
-- ────────────────────────────────────────────────────────────────────────────

create table term_rating (
    id                   uuid primary key default gen_random_uuid(),
    enrollment_id        uuid not null references enrollment(id) on delete cascade,
    term                 int not null check (term between 1 and 6),
    narrative_html       text,
    work_habits_rating   int check (work_habits_rating between 1 and 4),
    participation_rating int check (participation_rating between 1 and 4),
    social_traits        text[] not null default '{}',
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    unique (enrollment_id, term)
);
create index term_rating_enrollment_idx on term_rating(enrollment_id);

create table term_rating_dimension (
    id              uuid primary key default gen_random_uuid(),
    term_rating_id  uuid not null references term_rating(id) on delete cascade,
    section_id      uuid not null references section(id) on delete cascade,
    rating          int not null check (rating between 1 and 4),
    unique (term_rating_id, section_id)
);
create index term_rating_dimension_section_idx on term_rating_dimension(section_id);

create table term_rating_strength (
    term_rating_id  uuid not null references term_rating(id) on delete cascade,
    tag_id          uuid not null references tag(id) on delete cascade,
    primary key (term_rating_id, tag_id)
);

create table term_rating_growth_area (
    term_rating_id  uuid not null references term_rating(id) on delete cascade,
    tag_id          uuid not null references tag(id) on delete cascade,
    primary key (term_rating_id, tag_id)
);

create table term_rating_assessment (
    term_rating_id  uuid not null references term_rating(id) on delete cascade,
    assessment_id   uuid not null references assessment(id) on delete cascade,
    primary key (term_rating_id, assessment_id)
);

create table term_rating_observation (
    term_rating_id  uuid not null references term_rating(id) on delete cascade,
    observation_id  uuid not null references observation(id) on delete cascade,
    primary key (term_rating_id, observation_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- ReportConfig
-- ────────────────────────────────────────────────────────────────────────────

create table report_config (
    course_id      uuid primary key references course(id) on delete cascade,
    preset         text not null default 'standard'
                   check (preset in ('brief','standard','detailed','custom')),
    blocks_config  jsonb,
    updated_at     timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- Audit tables (2-year retention; append-only; written in same txn as parent)
-- ────────────────────────────────────────────────────────────────────────────

create table score_audit (
    id          uuid primary key default gen_random_uuid(),
    score_id    uuid not null references score(id) on delete cascade,
    changed_by  uuid references teacher(id) on delete set null,  -- null once actor teacher is hard-deleted
    old_value   numeric,
    new_value   numeric,
    old_status  text,
    new_status  text,
    changed_at  timestamptz not null default now()
);
create index score_audit_score_idx on score_audit(score_id, changed_at desc);
create index score_audit_changed_at_idx on score_audit(changed_at);

create table term_rating_audit (
    id              uuid primary key default gen_random_uuid(),
    term_rating_id  uuid not null references term_rating(id) on delete cascade,
    changed_by      uuid references teacher(id) on delete set null,  -- null once actor teacher is hard-deleted
    field_changed   text not null,
    old_value       text,
    new_value       text,
    changed_at      timestamptz not null default now()
);
create index term_rating_audit_parent_idx on term_rating_audit(term_rating_id, changed_at desc);
create index term_rating_audit_changed_at_idx on term_rating_audit(changed_at);

-- ────────────────────────────────────────────────────────────────────────────
-- Foreign-key covering indexes
-- ────────────────────────────────────────────────────────────────────────────
-- Every FK gets a covering index on its leading column(s). Postgres does not
-- create these automatically; without them, cascading deletes and many
-- lookup joins fall back to sequential scans. Added after the initial schema
-- landed because Supabase linter flagged 18 FKs as unindexed.

create index goal_section_idx                       on goal(section_id);
create index observation_assessment_idx             on observation(assessment_id);
create index observation_custom_tag_ct_idx          on observation_custom_tag(custom_tag_id);
create index observation_tag_tag_idx                on observation_tag(tag_id);
create index reflection_section_idx                 on reflection(section_id);
create index rubric_score_criterion_idx             on rubric_score(criterion_id);
create index score_audit_changed_by_idx             on score_audit(changed_by);
create index section_competency_group_idx           on section(competency_group_id, course_id);
create index section_subject_composite_idx          on section(subject_id, course_id);
create index section_override_section_idx           on section_override(section_id);
create index tag_score_tag_idx                      on tag_score(tag_id);
create index teacher_preference_active_course_idx   on teacher_preference(active_course_id);
create index term_rating_assessment_assessment_idx  on term_rating_assessment(assessment_id);
create index term_rating_audit_changed_by_idx       on term_rating_audit(changed_by);
create index term_rating_growth_area_tag_idx        on term_rating_growth_area(tag_id);
create index term_rating_observation_observation_idx on term_rating_observation(observation_id);
create index term_rating_strength_tag_idx           on term_rating_strength(tag_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Category weight-sum ≤ 100 trigger (defense-in-depth)
-- ────────────────────────────────────────────────────────────────────────────
-- DECISIONS.md Q18 says the UI enforces the cap first. This trigger catches
-- service_role bypasses and bulk imports.

create or replace function fv_check_category_weight_sum()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    total numeric;
    target_course uuid;
begin
    target_course := coalesce(new.course_id, old.course_id);
    select coalesce(sum(weight), 0) into total from category where course_id = target_course;
    if total > 100 then
        raise exception 'category weights for course % sum to % (max 100)',
            target_course, total
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger category_weight_sum_check
after insert or update on category
for each row execute function fv_check_category_weight_sum();

-- ────────────────────────────────────────────────────────────────────────────
-- Role grants (CRITICAL: without these, authenticated role gets 403 on every
-- query before RLS even evaluates)
-- ────────────────────────────────────────────────────────────────────────────
-- When `public` schema is dropped and recreated (as in the v2 reset), the
-- default Supabase grants are lost. Re-grant explicitly.

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables    in schema public to authenticated;
grant usage, select                    on all sequences in schema public to authenticated;
grant execute                          on all functions in schema public to authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables    to authenticated;
alter default privileges in schema public grant usage, select                    on sequences to authenticated;
alter default privileges in schema public grant execute                          on functions to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Deferred (not in this migration — captured here for Pass B/C implementers)
-- ────────────────────────────────────────────────────────────────────────────
--
--  * Row-Level Security policies: enable RLS on every table above and write
--    per-table policies that scope reads/writes to `teacher_id = auth.uid()`
--    (directly or transitively through course/enrollment joins).
--
--  * Category-weight-sum-≤-100 per-course constraint: enforced at the UI
--    layer per DECISIONS.md Q18. A server-side trigger could be added later
--    if the UI check proves insufficient.
--
--  * Scheduled cleanup job: hard-delete teachers where
--    `deleted_at < now() - interval '30 days'` plus cascading child rows.
--    Runs as a Supabase pg_cron job or scheduled Edge Function.
--
--  * Retention job: delete audit rows older than 2 years.
--
--  * View definitions for Pass D read paths (section_proficiency,
--    category_percentage, status_counts, etc.) — these are read-time
--    computations that can start as SQL views/RPCs after the base schema lands.
