-- ============================================================================
-- FullVision database schema — a reading guide
-- ----------------------------------------------------------------------------
-- The exact live shape (every table, column, constraint, index, trigger, RLS
-- policy and function signature) is docs/schema.generated.sql. It is
-- generated from gradebook-prod by scripts/schema-snapshot.mjs, and CI fails
-- when it stops matching the live database. Trust it over this file.
--
-- This file keeps the notes a generated file can't: what tables are for and
-- how they relate. Its column lists were written by hand (regenerated
-- 2026-04-20, updated by hand through 2026-10-20) and can lag; it is not a
-- replayable migration log. Applied changes are in migrations/.
--
-- For function bodies and RLS policies, see:
--   docs/backend-design/write-paths.sql   (write RPC bodies)
--   docs/backend-design/read-paths.sql    (read RPC bodies)
--   docs/backend-design/rls-policies.sql  (policy definitions)
-- ============================================================================

-- ─── Schemas ────────────────────────────────────────────────────────────────
-- Active: public (app data), auth (Supabase built-in), storage (Supabase),
-- realtime (Supabase), extensions.
-- Design-phase-only schemas `integration`, `academics`, `assessment`,
-- `projection` were dropped by `fullvision_v2_drop_legacy_schemas` (2026-04-19).

-- ─── Tables (public) ────────────────────────────────────────────────────────
-- Every table has RLS enabled (see rls-policies.sql).
-- `created_at`, `updated_at`, `enrolled_at`, `changed_at`, `scored_at` default
-- to `now()`. Primary keys are uuid `id` unless noted.

-- Teacher + preferences
create table teacher (
  id           uuid        not null,                               -- pk; matches auth.uid()
  email        text        not null unique,
  display_name text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                                         -- soft-delete (Q29); purged after 30d by fv_retention_cleanup
);
-- teacher.id has no foreign key to auth.users. Deleting a sign-in account
-- soft-deletes its teacher (trigger below), and a first sign-in frees the
-- email from a teacher left without one (20261108_teacher_outlives_sign_in).

create table teacher_preference (
  teacher_id          uuid  not null primary key references teacher(id) on delete cascade,
  active_course_id    uuid        references course(id) on delete set null,
  view_mode           text,
  mobile_view_mode    text,
  mobile_sort_mode    text,
  card_widget_config  jsonb
);

-- Course + structure
create table course (
  id               uuid        not null primary key,
  teacher_id       uuid        not null references teacher(id) on delete cascade,
  name             text        not null,
  grade_level      text,
  description      text,
  color            text        check (color is null or color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'),
  is_archived      boolean     not null default false,
  display_order    integer     not null default 0,
  grading_system   text        not null,
  calc_method      text        not null,                           -- decaying_avg | mean | median | most_recent | …
  decay_weight     numeric,                                        -- only used when calc_method = 'decaying_avg'
  timezone         text        not null default 'America/Vancouver',
  late_work_policy text,
  grading_scale    jsonb,                                           -- points→level boundaries (20261015_course_grading_config)
  category_weights jsonb,                                           -- summative/formative weights (20261015_course_grading_config)
  round_percent    boolean,                                         -- whole-number course % (20261016_course_round_percent)
  reporting_terms  jsonb,                                           -- up to six {ordinal,label,starts_on,ends_on} (20261017_course_reporting_terms)
  block            text        check (block is null or char_length(block) between 1 and 24), -- "A"–"E", "X" or a short label (20261020_course_block)
  grading_scale    jsonb       check (grading_scale is null or jsonb_typeof(grading_scale) = 'object'),      -- {boundaries:[{min, proficiency}], labels} (20261015_course_grading_config)
  category_weights jsonb       check (category_weights is null or jsonb_typeof(category_weights) = 'object'), -- legacy {summative, formative}; real weights live on `category` (20261015_course_grading_config)
  round_percent    boolean,                                        -- true whole %, false one decimal, null follow grade level (20261016_course_round_percent)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  curriculum_tags  text[],                                         -- BC bank course keys the class is linked to, e.g. {HIST12} (20261102_course_curriculum_tags)
  folders_count_as_one boolean not null default true,             -- overall averages each folder first; false: plain mean of every competency (20261102_folders_count_as_one)
  courses_count_equally boolean not null default false,           -- combined class: roll up each course on its own, then average the courses (20261102_courses_count_equally)
  reflect_on_feedback boolean not null default false,             -- Reflect on Feedback, Class Settings › Student Page (2026111120_markup_reflect_revise, Batch C; not applied when this was written)
  show_my_learning boolean not null default false,                -- Show My Learning: the student page shows the student's own skills and grade, returned work only (2026111120)
  student_page_enabled boolean not null default false,            -- the student page build switch; off: every save is returned at once (2026110902_grade_return)
  return_grades    text default 'on_return'                        -- 'on_return' When I Return Them | 'on_save' As Soon As I Save | null no choice made, works as on_save;
                   check (return_grades is null or return_grades in ('on_return', 'on_save')), -- classes from before 2026-11-09 are null (2026110902_grade_return)
  cards_work_until date,                                           -- last day the class's student cards work; null: the last reporting date (2026110903_student_card)
  send_work        boolean not null default false,                 -- Send Work: off, no student of the class can send work (2026111101_student_work_submissions; not applied when this was written)
  keep_photos_until text not null default 'end_of_year'            -- Keep Photos Until: 'end_of_year' | 'end_of_term'. Stored only; the job that acts on it is Batch D (2026111101)
                   check (keep_photos_until in ('end_of_year', 'end_of_term')),
  deleted_at       timestamptz                                         -- soft-delete marker; hidden immediately, purged after 30d by fv_retention_cleanup (20261012_course_soft_delete)
);

create table subject (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  color         text        check (color is null or color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'),
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, course_id)                                           -- subject_id_course_uk — needed by section_subject_fk
);

create table competency_group (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  color         text        check (color is null or color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'),
  display_order integer     not null default 0,
  counts_as_one boolean     not null default true,                 -- while the class counts folders as one: averaged first, else its competencies count one by one (20261102_folders_count_as_one)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, course_id)                                           -- competency_group_id_course_uk
);

create table section (
  id                  uuid        not null primary key,
  course_id           uuid        not null,
  subject_id          uuid        not null,
  competency_group_id uuid,
  name                text        not null,
  color               text        check (color is null or color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'),
  display_order       integer     not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint section_subject_fk          foreign key (subject_id, course_id)
      references subject (id, course_id) on delete cascade,
  constraint section_competency_group_fk foreign key (competency_group_id, course_id)
      references competency_group (id, course_id) on delete set null (competency_group_id)
      -- ^ PG15+ column-list SET NULL — nulls only the cg_id, preserves course_id NOT NULL.
      -- Fix: migration fullvision_v2_fix_section_competency_group_fk_set_null (2026-04-19).
);

create table tag (
  id            uuid        not null primary key,
  section_id    uuid        not null references section(id) on delete cascade,
  code          text,
  label         text        not null,
  i_can_text    text,         -- the competency's wording, despite the name
  i_can_statements text[]   not null default '{}',
  source_text   text,         -- the curriculum wording it started with
  bank_id       text,         -- BC curriculum bank competency id it was imported from, e.g. bc.draft10.cc.11 (20261102_tag_bank_id)
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table module (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  color         text        check (color is null or color ~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'),
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table category (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  weight        numeric     not null,                              -- sum per course must be 100 (fv_check_category_weight_sum, deferred)
  display_order integer     not null default 0,
  calc_mode     text        not null default 'points' check (calc_mode in ('points', 'percent')), -- Total Points or Average of Percentages (20261029_category_calc_mode)
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

-- Rubrics
create table rubric (
  id         uuid        not null primary key,
  course_id  uuid        not null references course(id) on delete cascade,
  name       text        not null,
  copy_group uuid,                                                    -- shared by a rubric and its copies in the teacher's other classes; null = never copied (20261018_rubric_copy_group)
  style      text        not null default 'standard',                 -- standard | advanced: checkboxes inside each level cell (20261022_advanced_rubric_checks) | single_point: the Proficient standard only, with Work On and Went Beyond notes (20261027_single_point_rubric)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table criterion (
  id                  uuid        not null primary key,
  rubric_id           uuid        not null references rubric(id) on delete cascade,
  name                text        not null,
  level_4_descriptor  text,
  level_3_descriptor  text,
  level_2_descriptor  text,
  level_1_descriptor  text,
  level_4_value       numeric     not null,
  level_3_value       numeric     not null,
  level_2_value       numeric     not null,
  level_1_value       numeric     not null,
  weight              numeric     not null,
  display_order       integer     not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table criterion_tag (
  criterion_id uuid not null references criterion(id) on delete cascade,
  tag_id       uuid not null references tag(id)       on delete cascade,
  primary key (criterion_id, tag_id)
);

-- One checkbox in a level cell of an Advanced Rubric criterion
-- (20261022_advanced_rubric_checks). display_order is within its level.
create table criterion_check (
  id            uuid        not null primary key,
  criterion_id  uuid        not null references criterion(id) on delete cascade,
  level         smallint    not null,                               -- 1..4
  label         text        not null,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Students + enrollment
create table student (
  id             uuid        not null primary key,
  teacher_id     uuid        not null references teacher(id) on delete cascade,
  first_name     text        not null,
  last_name      text,
  preferred_name text,
  pronouns       text,
  student_number text,
  email          text,
  date_of_birth  date,
  slip_password  text,                     -- four digits on a questionnaire slip, for a student with no birthday or number
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table enrollment (
  id              uuid        not null primary key,
  student_id      uuid        not null references student(id) on delete cascade,
  course_id       uuid        not null references course(id)  on delete cascade,
  designations    text[]      not null default array[]::text[],
  roster_position integer     not null default 0,
  is_flagged      boolean     not null default false,
  withdrawn_at    timestamptz,
  enrolled_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (student_id, course_id)
);

-- Assessments
create table assessment (
  id             uuid        not null primary key,
  course_id      uuid        not null references course(id) on delete cascade,
  category_id    uuid                references category(id) on delete set null,
  title          text        not null,
  description    text,
  date_assigned  date,
  due_date       date,
  score_mode     text        not null,                              -- proficiency | points | complete (20261013_complete_incomplete_scoring) | dibels (20261027_dibels_scores)
  max_points     numeric,
  weight         numeric     not null,
  evidence_type  text,
  rubric_id      uuid                references rubric(id) on delete set null,
  module_id      uuid                references module(id) on delete set null,
  collab_mode    text        not null default 'none',               -- none | pairs | groups
  collab_config  jsonb,
  copy_group     uuid,                                              -- shared by an assessment and its copies in the teacher's other classes; null = never copied (20261018_assessment_copy_group)
  core_competency_ids text[]  not null default '{}',                -- BC Core Competency codes COM COL CT CRT PPI PAR SAR; check: only those (20261027_assessment_core_competencies)
  -- The form's Student Work card (2026111101_student_work_submissions; not applied when this was written)
  students_send  text        not null default 'nothing',            -- nothing | photos | photos_files (a PDF may be chosen too; it arrives as JPEG pages either way)
  after_due      text        not null default 'keep',               -- keep (Keep Accepting) | until (accept_until is the last day) | stop (the due date is the last day)
  accept_until   date,                                              -- there exactly when after_due is 'until' (check)
  group_work     text        not null default 'each',               -- each | group. Stored only; one submission for a group is Batch C
  students_see_markup boolean not null default true,                -- Stored only; Mark Up is Batch C
  display_order  integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table assessment_tag (
  assessment_id uuid not null references assessment(id) on delete cascade,
  tag_id        uuid not null references tag(id)        on delete cascade,
  primary key (assessment_id, tag_id)
);

-- Scoring
create table score (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  assessment_id uuid        not null references assessment(id) on delete cascade,
  value         numeric,
  status        text,                                                -- null | 'NS' | 'EXC' | 'LATE' | 'ABS' …
  comment       text,
  report_note   text        check (report_note is null or char_length(report_note) between 1 and 300), -- Note for the Report: one line about what the student did, for the comment's best-piece sentence; null = none, 1..300 chars (20261031_score_report_note)
  scored_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, assessment_id)
);

create table tag_score (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  assessment_id uuid        not null references assessment(id) on delete cascade,
  tag_id        uuid        not null references tag(id)        on delete cascade,
  value         integer,                                             -- proficiency 1..4; null = no level yet, the row holds only its comment (20261027_score_comments)
  modifier      smallint    not null default 0,                      -- −1 | 0 | +1, a third of a level; no 1− or 4+ (20261013_proficiency_plus_minus)
  comment       text,                                                -- the teacher's feedback on this competency (20261027_score_comments)
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, assessment_id, tag_id)
);

create table rubric_score (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  assessment_id uuid        not null references assessment(id) on delete cascade,
  criterion_id  uuid        not null references criterion(id)  on delete cascade,
  value         integer,                                             -- 1..4; null = no level yet, the row holds only its comment (20261027_score_comments)
  modifier      smallint    not null default 0,                      -- −1 | 0 | +1, as tag_score (20261013_proficiency_plus_minus)
  comment       text,                                                -- the teacher's note on this criterion, printed on the rubric handout (20261018_rubric_score_comment); Work On on a single-point rubric
  beyond        text,                                                -- Went Beyond, single-point rubrics (20261027_single_point_rubric)
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, assessment_id, criterion_id)
);

-- DIBELS 8 benchmark raw scores, one row per student, DIBELS assessment and
-- window. Accuracy, the adjusted Maze score and levels are worked out in the
-- app; a DIBELS assessment counts toward no grade (20261027_dibels_scores).
create table dibels_score (
  id             uuid        not null primary key,
  enrollment_id  uuid        not null references enrollment(id) on delete cascade,
  assessment_id  uuid        not null references assessment(id) on delete cascade,
  period         text        not null,                             -- boy | moy | eoy
  orf_wrc        integer,                                          -- oral reading fluency: words read correctly; null = not entered, never negative
  orf_errors     integer,                                          -- oral reading fluency: errors
  maze_correct   integer,
  maze_incorrect integer,
  updated_at     timestamptz not null default now(),
  unique (enrollment_id, assessment_id, period)
);

-- A ticked Advanced Rubric checkbox on one student's rubric score. A row means
-- ticked; unticking deletes it (20261022_advanced_rubric_checks).
create table rubric_check_score (
  enrollment_id uuid        not null references enrollment(id)      on delete cascade,
  assessment_id uuid        not null references assessment(id)      on delete cascade,
  check_id      uuid        not null references criterion_check(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (enrollment_id, assessment_id, check_id)
);

-- Draft or Returned, per student per assessment: what the student has been
-- given (2026110902_grade_return; plan 1.2). The teacher's working copy stays
-- in score, tag_score, rubric_score and rubric_check_score. Statement triggers
-- on those four keep this table right for any writer: after each change they
-- take the class lock (the class's course_sync_cursor row, after the
-- statement's rows, as the sync-cursor triggers do), compare working_copy with
-- the grade now, and write the grade back. return_grades returns drafts; a
-- class leaving When I Return Them returns what was waiting (a trigger on
-- course); the restore sets the backup's state. Teachers read their own rows;
-- nobody writes it directly. A copy is { v, value, modifier, comment, tags
-- {tag id: {value, modifier, comment}}, criteria {criterion id: {value,
-- modifier, comment, beyond}}, checks [check ids] }; status and report_note
-- are never in one. Students are sent only the part of a copy the work's
-- scoring uses now (_grade_copy_in_use), and nothing while the piece is
-- Missing or Excused.
-- No foreign keys, on purpose: a row is read for update, written or deleted
-- only by a transaction that holds the class lock, and a cascade or a
-- foreign-key check would take a lock in the other order. A trigger on
-- enrollment and on assessment deletes the rows (grade_return_gone); the
-- migration's last two statements are the repair and can be run again.
create table grade_return (
  enrollment_id uuid        not null,                               -- enrollment(id), kept by trigger
  assessment_id uuid        not null,                               -- assessment(id), kept by trigger
  is_draft      boolean     not null default false,                -- the working copy holds something the student has not been given
  returned_at   timestamptz,                                        -- last returned; null = never
  returned_copy jsonb,                                              -- the grade as last returned, kept only while a draft sits on a returned grade
  previous_copy jsonb,                                              -- the grade the student had before the newest return
  updated_at    timestamptz,                                        -- when a returned grade last changed for the student
  seen_at       timestamptz,                                        -- when the student last opened this piece
  working_copy  jsonb,                                              -- the grade as the last save left it: what the next save is compared with
  primary key (enrollment_id, assessment_id),
  check ((returned_copy is not null) = (is_draft and returned_at is not null))
);
-- RLS: select only, fv_owns_enrollment(enrollment_id).

-- 2026110905_grade_return_limits (S0-M4b; not applied when this was written):
-- _grade_return_repair_class(course) settles every cell of a class that has a
-- grade or a row by the rule a save follows (_grade_return_settle), and
-- removes rows whose student or assessment is gone; the procedure
-- grade_return_repair_nightly() runs it class by class, committing after
-- each, once a day (pg_cron job fv_grade_return_repair_daily, 10:47 UTC). A
-- trigger after TRUNCATE on enrollment and assessment removes orphan rows.
-- A DIBELS piece (assessment.score_mode = 'dibels') has no Draft or Returned:
-- its rows are dormant, read and written by nothing, and are settled by
-- trigger grade_return_mode when its scoring is changed from DIBELS.
-- list_course_grade_returns sends no seen_at; student_submit.page sends each
-- assessment's created_at.
create table grade_return_repair_log (                              -- what a night's repair could not do; owner only
  id         bigint      generated always as identity primary key,
  at         timestamptz not null default now(),
  course_id  uuid,                                                  -- the class whose repair failed; null for the step after the last class
  sqlstate   text        not null,
  message    text        not null
);
-- RLS on, no policy; no grant to anon, authenticated or service_role.

-- Schema fv_private (2026110902_grade_return): helpers that SECURITY INVOKER
-- RPCs call, so signed-in teachers can run them, kept out of the API (the API
-- serves schema public only): restore_grade_returns (import_json_restore),
-- grade_return_remap (move_rubric_scores).
-- docs/schema.generated.sql does not list this schema.

-- Row security on score, tag_score, rubric_score, rubric_check_score and
-- dibels_score (2026110901_score_rows_same_class): the caller owns the
-- enrollment and the assessment is in the enrollment's class
-- (fv_owns_score_cell); on writes the competency, criterion or checkbox the
-- row names must be in that class too (fv_owns_tag_score_cell,
-- fv_owns_rubric_score_cell, fv_owns_rubric_check_cell).

-- A completed rubric handout printed for one student: when, and a fingerprint
-- of what the sheet showed, so the client can tell when it has changed since
-- (20261102_rubric_print).
create table rubric_print (
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  assessment_id uuid        not null references assessment(id) on delete cascade,
  printed_at    timestamptz not null default now(),
  content_hash  text        not null,                              -- 1..64 chars
  primary key (enrollment_id, assessment_id)
);

-- A teacher's own wording for a competency's rubric levels: where "From
-- competency" drafts start (20261018_competency_descriptor). Keyed by the
-- client's competency key (label + I-can text), never a tag id.
create table competency_descriptor (
  teacher_id     uuid        not null references teacher(id) on delete cascade,
  competency_key text        not null,                               -- 1..400 chars
  level          smallint    not null,                               -- 1..4
  text           text        not null,                               -- 1..2000 chars
  updated_at     timestamptz not null default now(),
  primary key (teacher_id, competency_key, level)
);

create table score_audit (
  id         uuid        not null primary key,
  score_id   uuid        not null references score(id)   on delete cascade,
  changed_by uuid                references teacher(id)  on delete set null,
  old_value  numeric,
  new_value  numeric,
  old_status text,
  new_status text,
  changed_at timestamptz not null default now()
);

-- Observations
create table observation (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  body          text        not null,
  sentiment     text        check (sentiment is null or sentiment in ('strength','growth','concern','note')),
  context_type  text,                                                -- assessment | general | interaction …
  assessment_id uuid                references assessment(id) on delete set null,
  dims          text[]      not null default '{}',                 -- tag keys: 'engagement', 'cc:<id>', 'tag:<label>'
  level         smallint    check (level between 1 and 4),          -- optional "looks Proficient" on a linked competency; evidence only, never graded
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table observation_student (
  observation_id uuid not null references observation(id) on delete cascade,
  enrollment_id  uuid not null references enrollment(id)  on delete cascade,
  primary key (observation_id, enrollment_id)
);

create table observation_tag (
  observation_id uuid not null references observation(id) on delete cascade,
  tag_id         uuid not null references tag(id)         on delete cascade,
  primary key (observation_id, tag_id)
);

create table custom_tag (
  id         uuid        not null primary key,
  course_id  uuid        not null references course(id) on delete cascade,
  label      text        not null,
  created_at timestamptz not null default now()
);

create table observation_custom_tag (
  observation_id uuid not null references observation(id)  on delete cascade,
  custom_tag_id  uuid not null references custom_tag(id)   on delete cascade,
  primary key (observation_id, custom_tag_id)
);

create table observation_template (
  id                    uuid        not null primary key,
  course_id             uuid        not null references course(id) on delete cascade,
  body                  text        not null,
  default_sentiment     text        check (default_sentiment is null or default_sentiment in ('strength','growth','concern','note')),
  default_context_type  text,
  default_dims          text[]      not null default '{}',           -- tag keys the starter adds, as observation.dims
  is_seed               boolean     not null default false,         -- seeds are immutable
  display_order         integer     not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Student records
create table note (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  body          text        not null,
  created_at    timestamptz not null default now()
);

create table goal (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  section_id    uuid        not null references section(id)    on delete cascade,
  body          text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, section_id)
);

create table reflection (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  section_id    uuid        not null references section(id)    on delete cascade,
  body          text,
  confidence    integer,                                             -- 1..5 guard (Pass B §9)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, section_id)
);

-- A student's self-assessment of one BC Core Competency in one reporting
-- term (term_key 'T1', 'T2', … or ''): their step (1 Beginning … 4 Leading),
-- their words and their goal. Never a teacher's grade.
create table core_self_assessment (
  id            uuid        not null primary key default gen_random_uuid(),
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  core_id       text        not null,                                -- COM COL CT CRT PPI PAR SAR
  term_key      text        not null default '',
  level         integer,                                             -- 1..4 guard
  body          text,
  goal          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, core_id, term_key)
);

create table section_override (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  section_id    uuid        not null references section(id)    on delete cascade,
  level         integer     not null,                                -- 1..4 guard
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, section_id)
);

create table attendance (
  id              uuid        not null primary key,
  enrollment_id   uuid        not null references enrollment(id) on delete cascade,
  attendance_date date        not null,
  status          text        not null,                              -- P | A | L | E
  updated_at      timestamptz not null default now(),
  unique (enrollment_id, attendance_date)
);

-- Term ratings
create table term_rating (
  id                    uuid        not null primary key,
  enrollment_id         uuid        not null references enrollment(id) on delete cascade,
  term                  integer     not null,                         -- 1..6; the Reports page offers Report 1–6 and maps "Report N" → N
  narrative_html        text,
  work_habits_rating    integer,
  participation_rating  integer,
  social_traits         text[]      not null default array[]::text[],
  absences              integer     check (absences >= 0),            -- classes absent, total to date at this report (from MyEd)
  lates                 integer     check (lates >= 0),               -- times late, total to date at this report
  habits                jsonb       not null default '{}',             -- six work habits {completes, ready, others, part, feedback, devices}: 1 Rarely … 4 Consistently, 5 Not Seen
  approved_at           timestamptz,                                  -- the teacher approved the comment; cleared when it changes
  reporting_basis       text        not null default 'grade'          -- what the report prints for the grade (20261031_term_rating_reporting_basis)
                        check (reporting_basis in ('grade', 'ie', 'language_goals', 'iep_goals')), -- grade = as calculated; ie = IE; *_goals = no letter
  ie_deadline           date,                                         -- the date an IE must become a grade by; required when reporting_basis = 'ie'
  draft_meta            jsonb                                         -- what the approved comment was built from: sentences, slots, class_sentences, facts_hash (20261031_term_rating_draft_meta); null = none
                        constraint term_rating_draft_meta_object check (draft_meta is null or jsonb_typeof(draft_meta) = 'object'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (enrollment_id, term),
  constraint term_rating_ie_needs_deadline check (reporting_basis <> 'ie' or ie_deadline is not null)
);

create table term_rating_dimension (
  id             uuid    not null primary key,
  term_rating_id uuid    not null references term_rating(id) on delete cascade,
  section_id     uuid    not null references section(id)     on delete cascade,
  rating         integer not null,
  unique (term_rating_id, section_id)
);

create table term_rating_strength (
  term_rating_id uuid not null references term_rating(id) on delete cascade,
  tag_id         uuid not null references tag(id)         on delete cascade,
  primary key (term_rating_id, tag_id)
);

create table term_rating_growth_area (
  term_rating_id uuid not null references term_rating(id) on delete cascade,
  tag_id         uuid not null references tag(id)         on delete cascade,
  primary key (term_rating_id, tag_id)
);

create table term_rating_assessment (
  term_rating_id uuid not null references term_rating(id) on delete cascade,
  assessment_id  uuid not null references assessment(id)  on delete cascade,
  primary key (term_rating_id, assessment_id)
);

create table term_rating_observation (
  term_rating_id uuid not null references term_rating(id) on delete cascade,
  observation_id uuid not null references observation(id) on delete cascade,
  primary key (term_rating_id, observation_id)
);

create table term_rating_audit (
  id             uuid        not null primary key,
  term_rating_id uuid        not null references term_rating(id) on delete cascade,
  changed_by     uuid                references teacher(id)      on delete set null,
  field_changed  text        not null,
  old_value      text,
  new_value      text,
  changed_at     timestamptz not null default now()
);

-- Report config
create table report_config (
  course_id      uuid        not null primary key references course(id) on delete cascade,
  preset         text        not null default 'standard',               -- brief | standard | detailed | custom
  blocks_config  jsonb,
  updated_at     timestamptz not null default now()
);

create table course_sync_cursor (
  course_id                   uuid        not null primary key references course(id) on delete cascade,
  gradebook_updated_at        timestamptz not null default now(),
  student_records_updated_at  timestamptz not null default now(),
  version                     bigint      not null default 0        -- bumped on every class change; get_class_bundle(p_if_version) short-circuits on a match (20261015_course_sync_version)
);

-- Idempotency guard for offline-queue retries (migration 20260423_write_path_idempotency).
-- Stores the return value of a write RPC keyed by (key, teacher_id). When a
-- retrofitted write RPC is called with `p_idempotency_key` and a row exists,
-- the RPC returns the cached result instead of re-executing. Rows older than
-- 24h are pruned every 15 min by the fv_idempotency_cleanup cron job.
create table fv_idempotency (
  key         uuid        not null,
  teacher_id  uuid        not null references teacher(id) on delete cascade,
  endpoint    text        not null,
  result      jsonb,
  created_at  timestamptz not null default now(),
  primary key (key, teacher_id)
);

-- Report forms (20261020_report_template / _report_issue / _guardian).
-- A teacher's saved forms; a fixed copy of every issued report; who a
-- report goes home to. docs/report-forms-plan.md.
create table report_template (
  id          uuid        not null primary key default gen_random_uuid(),
  teacher_id  uuid        not null references teacher(id) on delete cascade,
  name        text        not null,                                   -- 1..60 chars; unique per teacher, case-insensitive
  form        jsonb       not null,                                   -- object with a front array (ReportSheets.normalizeForm fills the rest)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table report_issue (
  id             uuid        not null primary key default gen_random_uuid(),
  course_id      uuid        not null references course(id) on delete cascade,
  term           integer     not null,                                -- 1..6
  term_label     text,
  paper          text        not null default 'letter',               -- letter | legal
  form           jsonb,                                               -- the form as issued
  issued_at      timestamptz not null default now(),
  issued_by      uuid        references teacher(id) on delete set null,
  student_count  integer     not null default 0,
  created_at     timestamptz not null default now()
);

create table report_issue_student (
  issue_id       uuid    not null references report_issue(id) on delete cascade,
  enrollment_id  uuid    not null references enrollment(id) on delete cascade,
  sheets         integer not null default 1,                          -- 1..20
  hash           text    not null,                                    -- client djb2 of html, for "changed since"
  html           text    not null,                                    -- the sheets as rendered, 15-40 KB
  primary key (issue_id, enrollment_id)
);

create table guardian (
  id              uuid        not null primary key default gen_random_uuid(),
  student_id      uuid        not null references student(id) on delete cascade,
  name            text        not null,                               -- 1..120 chars
  relationship    text,
  email           text,                                               -- lower-cased; unique per student
  phone           text,
  language        text        not null default 'en',
  consent_at      timestamptz,                                        -- set together with consent_source or not at all
  consent_source  text,                                               -- form | verbal | roster_import | portal
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Student questionnaires (20261025_questionnaires_tables_and_functions / _templates).
create table questionnaire_template (                                 -- read-only; 17 seeded forms
  id text primary key,                                                -- core-<grade>-<period> | about-me | goal-checkin
  kind text not null, grade integer, period integer, year integer not null default 2026,
  title text not null, theme text, core_heading text, myed_comment text,
  questions jsonb not null default '[]',                              -- [{prompt, kind, options, core_ids, repeated_key, teacher_only}]
  updated_at timestamptz not null default now()
);

create table questionnaire (                                          -- RLS fv_owns_course
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references course(id) on delete cascade,
  template_id text references questionnaire_template(id) on delete set null,
  kind text not null,                                                 -- about_me | core_reflection | goal_checkin | curricular_self_assessment
  title text not null, theme text, report_period integer,
  parent_id uuid references questionnaire(id) on delete set null,     -- a Goal Check-In rides on its reflection's slip
  opens_on date, closes_on date, is_on boolean not null default true, myed_comment text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table question (                                               -- RLS through questionnaire
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references questionnaire(id) on delete cascade,
  display_order integer not null default 0, prompt text not null,
  prompt_translations jsonb not null default '{}',
  kind text not null,                                                 -- text | short_set | scale4 | choice | goal_status | core_pick
  options jsonb not null default '{}', core_ids text[] not null default '{}',
  repeated_key text, teacher_only boolean not null default false,
  archived boolean not null default false,                            -- removed after students answered it
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table response (                                               -- RLS fv_owns_enrollment
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references questionnaire(id) on delete cascade,
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  via text not null default 'link',                                   -- link | paper | forms_csv
  submitted_at timestamptz not null default now(), created_by uuid
);

create table answer (                                                 -- RLS through response
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references response(id) on delete cascade,
  question_id uuid not null references question(id) on delete cascade,
  value_num numeric, value_text text, value_json jsonb,
  unique (response_id, question_id)
);

create table student_access_code (                                    -- RLS fv_owns_enrollment; no plain codes
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  questionnaire_id uuid references questionnaire(id) on delete cascade,
  report_issue_id uuid,
  code_hash text not null unique, salt text not null,                 -- sha256(salt || ':' || CODE)
  expires_at timestamptz not null, opened_at timestamptz, used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Students answering on their phones (20261025_student_submit). The schema is
-- not exposed through the API; only the student-submit edge function reaches
-- it, over a direct connection. RLS on, no policies, nothing granted to anon or
-- authenticated.
create schema student_submit;
create table student_submit.session (                                 -- one per open; the token only as a hash
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  code_id uuid not null references public.student_access_code(id) on delete cascade,
  expires_at timestamptz not null,                                    -- 80 minutes (a block) after open
  submitted_at timestamptz, result jsonb,                             -- a second submit returns result
  created_at timestamptz not null default now()
);
create table student_submit.attempt (                                 -- rate limits and the log; kept 30 days
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  route text not null check (route in ('open', 'submit')),
  outcome text not null,
  ip_hash text, code_id uuid, course_id uuid                          -- an HMAC of the IP; never answers or names
);

-- Student cards (2026110903_student_card; plan 1.5), as
-- 2026111003_card_codes_keyed (S3-M1; not applied when this was written)
-- leaves them. One live card per enrollment (unique where stopped_at is
-- null); a new card stops the old one and keeps its row. The table holds a
-- keyed tag of each card's code and never the code: the tag is made by the
-- edge functions with a key this database does not have
-- (STUDENT_CARD_KEY), so nothing here can turn a code into a tag or a tag
-- into a code. A card's code is eight characters and a slip's six, so the
-- two can never read the same. Nobody reads the table through the API (no
-- policy, no grant): teachers use list_student_cards, which returns no code.
-- Written only by student_submit.issue_cards (no signed-in teacher can run
-- it: the teacher-cards edge function calls it for them, over the database
-- owner's login, acting as the teacher), mark_student_cards_printed,
-- unlock_student_card, unlock_all_student_cards, set_cards_work_until and
-- the student path (student_submit.card, verify_card).
create table student_card (
  id             uuid        primary key default gen_random_uuid(),
  enrollment_id  uuid        not null references enrollment(id) on delete cascade,
  created_at     timestamptz not null default now(),
  printed_at     timestamptz,
  last_opened_at timestamptz,
  wrong_tries    integer     not null default 0,                    -- wrong answers to "Is This You?" in a row; a right one resets it; the fifth locks the card
  wrong_times    timestamptz[] not null default '{}',               -- when each wrong answer of the last 7 days was given; the fifteenth locks the card (the slow lock)
  locked_at      timestamptz,                                       -- Unlock clears it and the count
  stopped_at     timestamptz,                                       -- replaced; never opens again (a scan answers card_stopped)
  works_until    date        not null,                              -- the card's last day, written when it is made: the class's Cards Work Until, else its last reporting date if still ahead, else the next June 30
  code_hmac      text        unique check (code_hmac ~ '^[0-9a-f]{64}$'),  -- the tag of the code; unique across every card ever made; null only on a card from before 2026111003 (all stopped)
  pw_hmac        text        check (pw_hmac ~ '^[0-9a-f]{64}$'),    -- the tag of the card's own four-digit password; kept only for a student with no birthday or number when the card was made
  key_id         text        check (key_id ~ '^[0-9a-f]{8}$'),      -- the id of the key that made the tags
  seq            smallint    not null check (seq >= 1),             -- the card number: this student's first, second, third card
  unique (enrollment_id, seq),
  check (stopped_at is not null or (code_hmac is not null and key_id is not null))   -- a card that can open has a tag
);
-- The id of the card key the edge functions last called with (one row; not
-- the key). list_student_cards marks a card made under another key id
-- needs_new: it cannot be recognised any more.
create table student_submit.card_key (
  one     boolean     primary key default true check (one),
  key_id  text        not null check (key_id ~ '^[0-9a-f]{8}$'),
  seen_at timestamptz not null default now()
);

-- A signed-in student device (2026110904_student_sessions_page). A session
-- belongs to the device, not to a card; device_session_enrollment lists the
-- classes it has opened, one per card added. A card checked from the start
-- screen starts a fresh session; only Add Another Card joins one. It ends at
-- the next midnight in the class's time zone, or on Done (the row is
-- deleted; any card scan deletes rows past their midnight). card,
-- verify_card, page, seen and done are the edge function's; _returned_grade
-- is the only function in the schema that reads a grade.
-- page also sends, to read (2026111103_student_page_fields; the contract is
-- migrations/local-test/s4-m1-contract.md): course.teacher_name
-- (teacher.display_name); each competency's i_can (tag.i_can_statements);
-- each rubric criterion's tag_ids (criterion_tag, competencies still on the
-- class); each assessment's description, module_name, category_name,
-- category_percent (the category's weight where it is a true share of the
-- course grade, else null) and core_competencies; and, in the session's
-- list of classes (_session_classes, which verify_card sends too), each
-- class's to_do: pieces on the page that take a grade and are Missing, or
-- not Excused and never returned, asked of _returned_grade. It adds no
-- table, column or grant.
create table student_submit.device_session (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,                                    -- the phone holds the token
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table student_submit.device_session_enrollment (
  session_id uuid not null references student_submit.device_session(id) on delete cascade,
  enrollment_id uuid not null references public.enrollment(id) on delete cascade,
  card_id uuid not null references public.student_card(id) on delete cascade,
  added_at timestamptz not null default clock_timestamp(),
  primary key (session_id, enrollment_id)
);
-- student_submit.attempt.route also takes 'card'; code_id then holds the card's id.

-- Students send work (2026111101_student_work_submissions, Batch B; plan 1.6
-- to 1.8; not applied when this was written). A submission is work handed in
-- for one assessment by one student: by the student from their page, or by
-- the teacher (Add Work, Handed In on Paper). A page is always a JPEG in the
-- private bucket student-photos (2026111102_student_work_storage), with a
-- thumbnail beside it.
-- No foreign key to assessment, enrollment or course, on purpose, as
-- grade_return has none: every change to a submission is made under the
-- class's lock (its course_sync_cursor row), and triggers on assessment and
-- enrollment delete the rows (submission_gone).
-- Nobody reads these through the API (row security on, no policy, no grant).
-- Teachers: set_course_send_work, set_assessment_student_work,
-- list_course_submissions, start_work_upload, finish_work_upload,
-- mark_handed_in_paper, delete_submission, rotate_submission_page. Students,
-- through the student-submit edge function: student_submit.work, send_start,
-- send_finish, replace, unsend, file_links. A student acts only through a
-- live session of their own card, for their own enrollment, on an assessment
-- set to take work, while it is open (asked when the send starts and again
-- when it is handed in), twenty sends an hour; Unsend and Replace only until
-- grading starts (student_submit._grading_started: a draft or a returned
-- grade exists), and only the pages the student added. A started send holds
-- its place two hours from its first start (_work_hold), then is expired and
-- dropped. One class may hold 10,000 pages and 5 GB (_work_class_max_pages,
-- _work_class_max_bytes). The teacher's Add Work and Handed In on Paper work
-- whatever Send Work and Students Send say. None of these functions reads or
-- writes a grade. The contract: migrations/local-test/batch-b-contract.md.
create table submission (
  id            uuid        primary key default gen_random_uuid(),
  course_id     uuid        not null,                               -- no foreign key (see above); a trigger checks the student and the assessment are both in it
  assessment_id uuid        not null,
  enrollment_id uuid        not null,
  version       smallint    not null default 1,                     -- always 1 until revisions (Batch C)
  state         text        not null,                               -- sending (rows and upload links made, nothing handed in; only its sender sees it) | sent
  intent        text        not null default 'new',                 -- what a sending row does when finished: new | replace | add (to target_id)
  target_id     uuid,                                               -- the sent submission a sending row replaces or adds to
  sent_by       text        not null,                               -- student | teacher
  on_paper      boolean     not null default false,                 -- Handed In on Paper: no pages
  note          text,                                               -- the student's note, 1000 characters at most
  followed_plan text,                                               -- Did You Do It?: yes | partly | no, the student's own word
  is_late       boolean     not null default false,                 -- handed in after the due date, by the class's own calendar (judged at the finish)
  card_id       uuid,                                               -- the card whose session sent it; history only
  request_id    uuid,                                               -- the sender's own id for the call that made the row (a repeat returns the same row)
  created_at    timestamptz not null default now(),                 -- when it was first started; an unfinished send holds its place two hours from then, whatever is asked of it afterwards
  sent_at       timestamptz,                                        -- there exactly when state is sent
  updated_at    timestamptz not null default now()
  -- unique (assessment_id, enrollment_id, version) where state = 'sent'; unique (assessment_id, enrollment_id, sent_by) where state = 'sending'
  -- indexes on (enrollment_id), (course_id), (assessment_id) (what the trigger on assessment deletes by), (target_id) where not null
);
create table submission_file (
  id            uuid        primary key default gen_random_uuid(),
  submission_id uuid        not null references submission(id) on delete cascade,
  page          smallint    not null,                               -- unique within the submission
  path          text        not null unique,                        -- <course>/<assessment>/<enrollment>/<the submission it was first made for>/<this id>.jpg; never changes
  thumb_path    text        not null unique,                        -- the same with -thumb.jpg
  bytes         integer, thumb_bytes integer,                       -- as storage recorded them, read when the work is handed in
  width         integer, height integer,
  sha256        text,                                               -- of the page as stored, given when it is handed in; for the same-photo note
  rotation      smallint    not null default 0,                     -- 0 | 90 | 180 | 270; the file itself is never changed
  added_by      text        not null,                               -- student | teacher: who added the page. A student's Unsend or Replace removes only the student's own
  declared_bytes       integer not null,                            -- the sizes its sender said the page and its thumbnail would be (2 MB where nothing was said):
  declared_thumb_bytes integer not null,                            -- what an unfinished page counts for against the class's limit; a larger file is refused at the finish
  created_at    timestamptz not null default now(),
  link_dies_at  timestamptz not null                                -- the last upload link that can be made for the page has stopped working by then (4 h 10 min after its send was first started)
);
-- SQL cannot delete a file: only the Storage API can. Every file whose page
-- row goes (Unsend, Replace, a teacher's delete, an assessment or a student
-- deleted, a class purged) is written here by a trigger in the same
-- transaction; a caller with the service key works it down
-- (student_submit.removal_batch, removal_done). Owner only.
create table submission_file_removal (
  id           bigint      generated always as identity primary key,
  bucket       text        not null,
  path         text        not null,                                -- unique with bucket
  course_id    uuid,                                                -- the path's first folder; the class itself may be gone
  reason       text        not null,                                -- unsend | replace | teacher | abandoned | expired | page_removed | row_deleted
  queued_at    timestamptz not null default now(),
  link_dies_at timestamptz not null,                                -- until then whoever holds the upload link could put the file back
  tries        integer     not null default 0,
  last_try_at  timestamptz,
  removed_at   timestamptz,                                         -- when storage was last seen without it
  done         boolean     not null default false                   -- seen gone after its link died
);
-- One row each time a card is given upload links, for the limit of twenty an hour.
create table student_submit.send_log (
  id bigint generated always as identity primary key,
  card_id uuid not null,
  at timestamptz not null default now()
);
-- Storage (2026111102_student_work_storage): one bucket, student-photos,
-- private, 2 MB a file, image/jpeg only, versioning DISABLED (no old version
-- of a file is kept). Four policies on storage.objects: a signed-in teacher
-- reads a page that still has its row, in a class they own, and is handed in
-- or part of an upload they started (fv_student_photos_read; so not a
-- student's unfinished send, and not a file waiting to be deleted), and
-- writes exactly the paths of an upload they started and have not finished,
-- for the two hours it holds its place (fv_student_photos_upload); two restrictive
-- policies (fv_student_photos_teachers_only, fv_student_photos_fence) keep
-- the bucket to that whatever other policy is added. A student's upload
-- goes through a signed link the edge function makes for one path the
-- database named. No policy lets anyone change or delete a file.

-- Reports on students' phones (20261025_phone_reports). The teacher's copy of
-- each student's report, fixed until updated; codes in student_access_code
-- (phone_report_id) open it after a birthday check. Read-only: no reply
-- (20261107_no_report_reply). RLS through the course.
create table phone_report (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references course(id) on delete cascade,
  term integer not null,                                              -- 1..6
  term_label text,
  issued_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_on date not null,                                           -- links work through this day
  closed_at timestamptz,                                              -- Close All Links
  created_by uuid references teacher(id) on delete set null
);
create table phone_report_student (
  report_id uuid not null references phone_report(id) on delete cascade,
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  data jsonb not null,                                                -- the phone copy (shared/phone-report-view.js)
  updated_at timestamptz not null default now(),
  primary key (report_id, enrollment_id)
);
-- student_access_code.phone_report_id uuid references phone_report(id) on delete cascade;
-- check (num_nonnulls(questionnaire_id, report_issue_id, phone_report_id) >= 1).
-- student_submit.session gains checked_at timestamptz, check_fails integer.

-- A teacher's own comment sentences (20261031_comment_template). Kept from
-- "Suggested for Your Bank" after a class's comments are approved; no student
-- column. RLS: teacher_id = auth.uid(). Unique per teacher by lower(btrim(text)).
create table comment_template (
  id          uuid        primary key default gen_random_uuid(),
  teacher_id  uuid        not null references teacher(id) on delete cascade,
  text        text        not null,                                   -- the template with slot markers, 1..400 chars
  slots       jsonb       not null default '[]',                      -- array of the slot names the text uses
  condition   jsonb       not null default '{}',                      -- object: the facts that were true when kept
  uses        integer     not null default 0,                         -- approved comments that used it, >= 0
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Report a Problem (20261105_support_report). Written only through
-- submit_support_report (SECURITY DEFINER, idempotent); teachers have no table
-- privileges and can read none back. RLS: insert-own policy as a backstop.
-- The attached fields are the page's name, the build and the browser; never
-- student data.
create table support_report (
  id           uuid        primary key default gen_random_uuid(),
  teacher_id   uuid        not null default auth.uid() references teacher(id) on delete cascade,
  page         text        not null default '',                       -- <= 200 chars, e.g. Gradebook or Help site
  message      text        not null,                                  -- 1..5000 chars, not blank
  browser      text,                                                  -- <= 300 chars, e.g. Chrome 131 on macOS
  app_version  text,                                                  -- <= 100 chars: the deploy's commit id
  created_at   timestamptz not null default now()
);

-- Mark Up, Reflect on Feedback, Revisions (2026111120_markup_reflect_revise,
-- Batch C, first file; needs Batch B's submission tables; not applied when
-- this was written). No foreign key to assessment, enrollment or course, as
-- grade_return and submission have none: every write is made under the
-- class's lock, and triggers on assessment and enrollment delete the rows
-- (work_feedback_gone). Nobody reads these through the API (row security on,
-- no policy, no grant). Teachers: set_course_feedback_options, save_markup,
-- list_assessment_markup, return_work (return_grades, then the marks),
-- return_for_revision, set_revision_request, cancel_revision,
-- answer_reflection, list_course_feedback. Students, through the
-- student-submit edge function: student_submit.feedback, markup, reflect,
-- reply, revision_start, revision_finish, revision_unsend, group_work,
-- group_file_links. A student is sent only markup.given, never working, and
-- only their own (and their group's) pages. A revision is the next version
-- of the piece's submission (submission.version 2, 3). The second file
-- (2026111121_markup_revise_grade_changes, waits for the owner) gives marks
-- and closes a finished revision request on every return path; it writes
-- no grade row. Hiding a grade during a revision is not in Batch C.
-- C1 also replaces Batch B's student_submit._grading_started (not yet decided
-- by the owner): a page carrying the teacher's marks counts as grading
-- started, so the student cannot Unsend or Replace it.
-- The contract: migrations/local-test/batch-c-contract.md.
create table markup (
  file_id       uuid        primary key references submission_file(id) on delete cascade, -- the page; its marks go with it
  course_id     uuid        not null,                               -- the page's piece, for lookups
  assessment_id uuid        not null,
  enrollment_id uuid        not null,
  working       jsonb,                                              -- the teacher's copy: { v: 1, marks: [ { type: pen|highlight|note|tick|cross, ... } ] }; never sent to a student
  working_rev   integer     not null default 0,                     -- save_markup's base_rev compares with it
  working_at    timestamptz,
  given         jsonb,                                              -- the student's copy, set when the work is returned
  given_rev     integer,                                            -- the working_rev it was given at
  given_at      timestamptz,
  created_at    timestamptz not null default now()
  -- indexes on (assessment_id, enrollment_id), (enrollment_id), (course_id)
);
create table revision_request (
  id            uuid        primary key default gen_random_uuid(),
  course_id     uuid        not null,
  assessment_id uuid        not null,
  enrollment_id uuid        not null,
  state         text        not null default 'open',                -- open | done (its revision's grade was returned) | cancelled; sent and grading are read from the submissions
  what_to_fix   text        not null,                               -- 1..2000 characters
  revise_by     date,
  criterion_ids uuid[]      not null default '{}',                  -- criteria of the piece's rubric
  keep_grade    boolean     not null default true,                  -- always true: Hide is not in Batch C (a request for it answers hide_not_available)
  first_submission_id uuid,                                         -- the version it was asked of (null: nothing handed in)
  first_version smallint    not null default 1,
  first_grade   jsonb,                                              -- that version's grade as the student had it (a grade copy); Before and After
  first_returned_at timestamptz,
  grade_mark    text,                                               -- md5 of grade_return.working_copy when the revision came in: grading has started once it differs
  revision_in_at timestamptz,                                       -- when the revision now in came in
  in_returned_at timestamptz,                                       -- grade_return.returned_at then: a Return since has changed it (returned)
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz                                         -- there exactly when state is not open
  -- unique (assessment_id, enrollment_id) where state = 'open'; indexes on (assessment_id), (enrollment_id), (course_id)
);
create table feedback_reflection (
  id            uuid        primary key default gen_random_uuid(),
  course_id     uuid        not null,
  assessment_id uuid        not null,
  enrollment_id uuid        not null,                               -- unique with assessment_id: one per student per piece
  makes_sense   text        not null,                               -- yes | not_sure: the student's own words from here down to went_well
  question      text,                                               -- with not_sure; 1000 characters at most
  plan          text,                                               -- with yes, or later with Make My Plan (reply): Your Plan From Last Time on the next piece
  plan_at       timestamptz,                                        -- when the plan was last written; the newest is Your Plan From Last Time
  went_well     text,
  sent_at       timestamptz not null default now(),
  answer        text,                                               -- the teacher's answer (Send Answer); sent to the student once written, unless answer_only_me
  answered_at   timestamptz,
  answer_only_me boolean    not null default false,                 -- Only Me: the teacher's own note, never sent
  answer_seen_at timestamptz,                                       -- the student's page showed the answer (answer_seen)
  sense_now     text,                                               -- Does It Make Sense Now?: yes | not_sure
  sense_now_at  timestamptz,
  follow_up     text,                                               -- one more question, with not_sure
  follow_up_answer text,
  follow_up_answered_at timestamptz,
  follow_up_only_me boolean not null default false,
  follow_up_answer_seen_at timestamptz,
  updated_at    timestamptz not null default now()
);

-- ─── Extensions + cron ──────────────────────────────────────────────────────
-- pg_cron enabled (migration fullvision_v2_enable_pg_cron).
-- Job `fv_retention_cleanup_daily` runs at 03:17 UTC calling fv_retention_cleanup().
-- Job `fv_idempotency_cleanup` runs every 15 min; prunes fv_idempotency rows
-- older than 24h (migration 20260423_write_path_idempotency).

-- ─── Functions ──────────────────────────────────────────────────────────────
-- Every function's signature and whether it is SECURITY DEFINER is in
-- docs/schema.generated.sql; their bodies are in migrations/ and
-- docs/backend-design/*-paths.sql. Writes go through public RPCs, each
-- idempotent through p_idempotency_key (fv_idem_check, CLAUDE.md rule 7).

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- `category_weight_sum_check(_update)` deferred constraint triggers on category → fv_check_category_weight_sum()
-- `score_audit_trigger`         after  update on score          → _score_audit_diff(...)
-- `term_rating_audit_trigger`   after  update on term_rating    → _term_rating_audit_field(...)
-- `work_feedback_gone`          after  delete (row) on enrollment, assessment → _work_feedback_gone(): the class lock, then its revision requests and reflections go (2026111120)
-- `work_feedback_truncate`      after  truncate on enrollment, assessment → _work_feedback_truncated()
-- `markup_given_on_insert|return` after insert of a returned row, or update of returned_at to a new date on a row that is not a draft, on grade_return (a Return) → _markup_on_return(): the marks on that piece are given and a finished revision request is stored done (2026111121, waits for the owner)
-- `grade_return_insert|update|delete` after each statement on score, tag_score, rubric_score, rubric_check_score → _grade_return_on_change(): the class lock, then working_copy against the grade now
-- `grade_return_gone`           after  delete (row) on enrollment, assessment → _grade_return_gone(): the class lock, then its grade_return rows go
-- `grade_return_repoint`        after  update (row) on tag_score, rubric_score, rubric_check_score when its tag, criterion or check id changes → _grade_return_repoint(part, id column); acts only inside move_rubric_scores
-- `grade_return_release`        after  update of student_page_enabled, return_grades on course, when the class stops holding grades → _grade_return_release()
-- `submission_gone`             after  delete (row) on enrollment, assessment → _submission_gone(): the class lock, then its submissions go (2026111101)
-- `submission_truncate`         after  truncate on enrollment, assessment → _submission_truncated(): submissions left without their student or assessment go
-- `submission_same_class`       before insert or update on submission → _submission_same_class(): its student and assessment are both in its class, and never change
-- `submission_target_gone`      after  delete (row) on submission → _submission_target_gone(): an unfinished send goes with the work it was to replace or add to
-- `submission_file_removed`     after  delete (row) on submission_file → _submission_file_removed(): both files are queued in submission_file_removal
-- `fv_teacher_sign_in_deleted`  after  delete on auth.users     → _fv_teacher_sign_in_deleted() (soft-deletes the teacher)

-- ─── Publications ───────────────────────────────────────────────────────────
-- `course_sync_cursor` is the intended narrow Realtime surface for v2 course invalidation:
--   gradebook_updated_at       → course / enrollment / category / assessment / score trees
--   student_records_updated_at → goals / reflections / overrides / observations / attendance / report config
-- Publish only this table to `supabase_realtime`; client re-fetches by course instead of merging row-level changes.
-- and NOT re-populated by the v2 rebuild. Cross-device live sync is still an
-- open rollout/verification item tracked in codex.md as P2.1.

-- ─── End of snapshot ────────────────────────────────────────────────────────
