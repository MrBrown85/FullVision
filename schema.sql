-- ============================================================================
-- FullVision database schema — current-state snapshot
-- ----------------------------------------------------------------------------
-- Regenerated 2026-04-20 from gradebook-prod (novsfeqjhbleyyaztmlh) via
-- Supabase MCP execute_sql against information_schema + pg_proc.
--
-- This is a READABLE SNAPSHOT, not a replayable migration log. It documents
-- the current shape of the database so client code can be cross-referenced
-- against ground truth.
--
-- For function bodies and RLS policies, see:
--   docs/backend-design/write-paths.sql   (write RPC bodies)
--   docs/backend-design/read-paths.sql    (read RPC bodies)
--   docs/backend-design/rls-policies.sql  (policy definitions)
--
-- For the deploy-order migration log, query `supabase_migrations.schema_migrations`
-- directly via `mcp__supabase__list_migrations`. As of 2026-04-20 there are
-- 68 migrations from 2026-03-28 through 2026-04-20.
--
-- Previous contents of this file (pre-v2-rebuild, ending at migration
-- `lock_function_search_paths`, 2026-04-18) are obsolete — every table it
-- described was dropped by `fullvision_v2_reset_public_schema` on 2026-04-19.
-- ============================================================================

-- ─── Schemas ────────────────────────────────────────────────────────────────
-- Active: public (app data), auth (Supabase built-in), storage (Supabase),
-- realtime (Supabase), extensions.
-- Design-phase-only schemas `integration`, `academics`, `assessment`,
-- `projection` were dropped by `fullvision_v2_drop_legacy_schemas` (2026-04-19).

-- ─── Tables (public) ────────────────────────────────────────────────────────
-- 39 tables. Every table has RLS enabled (see rls-policies.sql).
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
  color            text,
  is_archived      boolean     not null default false,
  display_order    integer     not null default 0,
  grading_system   text        not null,
  calc_method      text        not null,                           -- decaying_avg | mean | median | most_recent | …
  decay_weight     numeric,                                        -- only used when calc_method = 'decaying_avg'
  timezone         text        not null default 'America/Vancouver',
  late_work_policy text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table subject (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  color         text,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, course_id)                                           -- subject_id_course_uk — needed by section_subject_fk
);

create table competency_group (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  color         text,
  display_order integer     not null default 0,
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
  color               text,
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
  i_can_text    text,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table module (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  color         text,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table category (
  id            uuid        not null primary key,
  course_id     uuid        not null references course(id) on delete cascade,
  name          text        not null,
  weight        numeric     not null,                              -- sum per course must be ≤100 (fv_check_category_weight_sum trigger)
  display_order integer     not null default 0,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

-- Rubrics
create table rubric (
  id         uuid        not null primary key,
  course_id  uuid        not null references course(id) on delete cascade,
  name       text        not null,
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
  score_mode     text        not null,                              -- scale | rubric | points
  max_points     numeric,
  weight         numeric     not null,
  evidence_type  text,
  rubric_id      uuid                references rubric(id) on delete set null,
  module_id      uuid                references module(id) on delete set null,
  collab_mode    text        not null default 'none',               -- none | pairs | groups
  collab_config  jsonb,
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
  scored_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, assessment_id)
);

create table tag_score (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  assessment_id uuid        not null references assessment(id) on delete cascade,
  tag_id        uuid        not null references tag(id)        on delete cascade,
  value         integer     not null,                                -- proficiency 1..4
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, assessment_id, tag_id)
);

create table rubric_score (
  id            uuid        not null primary key,
  enrollment_id uuid        not null references enrollment(id) on delete cascade,
  assessment_id uuid        not null references assessment(id) on delete cascade,
  criterion_id  uuid        not null references criterion(id)  on delete cascade,
  value         integer     not null,                                -- 1..4
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, assessment_id, criterion_id)
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
  sentiment     text,                                                -- positive | neutral | concern
  context_type  text,                                                -- assessment | general | interaction …
  assessment_id uuid                references assessment(id) on delete set null,
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
  default_sentiment     text,
  default_context_type  text,
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
  term                  integer     not null,                         -- 1 | 2 | 3
  narrative_html        text,
  work_habits_rating    integer,
  participation_rating  integer,
  social_traits         text[]      not null default array[]::text[],
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (enrollment_id, term)
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

-- ─── Extensions + cron ──────────────────────────────────────────────────────
-- pg_cron enabled (migration fullvision_v2_enable_pg_cron).
-- Job `fv_retention_cleanup_daily` runs at 03:17 UTC calling fv_retention_cleanup().

-- ─── Functions ──────────────────────────────────────────────────────────────
-- 95 `authenticated`-EXECUTE functions in public schema. All set
-- `search_path = public` (linter 0011). Bodies live in
-- docs/backend-design/write-paths.sql and docs/backend-design/read-paths.sql.

-- Internal helpers (SECURITY DEFINER):
--   _report_preset_defaults(p_preset text)
--   _score_audit_diff(p_score_id uuid, p_old_value numeric, p_new_value numeric,
--                     p_old_status text, p_new_status text)
--   _term_rating_audit_field(p_tr_id uuid, p_field text, p_old text, p_new text)
--   fv_owns_course(cid uuid) / fv_owns_assessment(aid uuid) / fv_owns_enrollment(eid uuid)
--     / fv_owns_term_rating(trid uuid) — RLS predicates.
--   fv_check_category_weight_sum() — trigger enforcing per-course ≤100% cap.
--   fv_retention_cleanup() — cron entry point (30d teacher purge + 2yr audit purge).
--
-- Auth + bootstrap:
--   bootstrap_teacher(p_email text, p_display_name text)
--   soft_delete_teacher()
--   restore_teacher()
--
-- Course CRUD:
--   create_course(p_name, p_grade_level, p_description, p_color, p_grading_system,
--                 p_calc_method, p_decay_weight, p_timezone, p_late_work_policy, p_subjects text[])
--   update_course(p_course_id uuid, p_patch jsonb)
--   archive_course(p_course_id uuid, p_archived boolean)
--   duplicate_course(p_src_id uuid)
--   delete_course(p_course_id uuid)
--
-- Structural CRUD (subject / competency_group / section / tag / module / category / rubric):
--   upsert_subject / delete_subject / reorder_subjects(p_ids uuid[])
--   upsert_competency_group / delete_competency_group / reorder_competency_groups(p_ids uuid[])
--   upsert_section / delete_section / reorder_sections(p_ids uuid[])
--   upsert_tag / delete_tag / reorder_tags(p_ids uuid[])
--   upsert_module / delete_module / reorder_modules(p_ids uuid[])
--   upsert_category / delete_category
--   upsert_rubric(p_id, p_course_id, p_name, p_criteria jsonb) / delete_rubric
--
-- Student + enrollment:
--   create_student_and_enroll(p_course_id, p_first_name, p_last_name, p_preferred_name,
--                             p_pronouns, p_student_number, p_email, p_date_of_birth,
--                             p_designations text[], p_existing_student_id uuid)
--   update_student(p_id uuid, p_patch jsonb)
--   delete_student(p_id uuid)                                          -- (2026-04-20 addition)
--   relink_student(p_ghost_student_id uuid, p_canonical_student_id uuid)
--   update_enrollment(p_id uuid, p_patch jsonb)
--   withdraw_enrollment(p_id uuid)
--   reorder_roster(p_ids uuid[])
--   bulk_apply_pronouns(p_student_ids uuid[], p_pronouns text)
--   import_roster_csv(p_course_id uuid, p_rows jsonb)
--
-- Assessment CRUD:
--   create_assessment(p_course_id, p_title, p_category_id, p_description, p_date_assigned,
--                     p_due_date, p_score_mode, p_max_points, p_weight, p_evidence_type,
--                     p_rubric_id, p_module_id, p_tag_ids uuid[])
--   update_assessment(p_id uuid, p_patch jsonb, p_tag_ids uuid[])
--   duplicate_assessment(p_src_id uuid)
--   delete_assessment(p_id uuid)
--   save_assessment_tags(p_id uuid, p_tag_ids uuid[])
--   save_collab(p_id uuid, p_mode text, p_config jsonb)
--
-- Scoring (§1.7):
--   upsert_score(p_enrollment_id uuid, p_assessment_id uuid, p_value numeric)
--   set_score_status(p_enrollment_id uuid, p_assessment_id uuid, p_status text)
--   save_score_comment(p_enrollment_id uuid, p_assessment_id uuid, p_comment text)
--   upsert_tag_score(p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid, p_value integer)
--   upsert_rubric_score(p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid,
--                       p_value integer)
--   fill_rubric(p_enrollment_id uuid, p_assessment_id uuid, p_value integer)
--   clear_score(p_enrollment_id uuid, p_assessment_id uuid)
--   clear_row_scores(p_enrollment_id uuid, p_course_id uuid)
--   clear_column_scores(p_assessment_id uuid)
--
-- Observations + templates + custom tags:
--   create_observation(p_course_id, p_body, p_sentiment, p_context_type, p_assessment_id,
--                      p_enrollment_ids uuid[], p_tag_ids uuid[], p_custom_tag_ids uuid[])
--   update_observation(p_id, p_patch jsonb, p_enrollment_ids uuid[], p_tag_ids uuid[],
--                      p_custom_tag_ids uuid[])
--   delete_observation(p_id uuid)
--   upsert_observation_template(p_id, p_course_id, p_body, p_default_sentiment,
--                               p_default_context_type, p_display_order)
--   delete_observation_template(p_id uuid)
--   create_custom_tag(p_course_id uuid, p_label text)
--
-- Student records:
--   upsert_note(p_enrollment_id uuid, p_body text)
--   delete_note(p_id uuid)
--   upsert_goal(p_enrollment_id uuid, p_section_id uuid, p_body text)
--   upsert_reflection(p_enrollment_id uuid, p_section_id uuid, p_body text, p_confidence int)
--   upsert_section_override(p_enrollment_id uuid, p_section_id uuid, p_level int, p_reason text)
--   clear_section_override(p_enrollment_id uuid, p_section_id uuid)
--   bulk_attendance(p_enrollment_ids uuid[], p_date date, p_status text)
--
-- Term rating:
--   save_term_rating(p_enrollment_id uuid, p_term integer, p_payload jsonb)
--   get_term_rating(p_enrollment_id uuid, p_term integer)
--
-- Report config + preferences + report:
--   apply_report_preset(p_course_id uuid, p_preset text)
--   save_report_config(p_course_id uuid, p_blocks_config jsonb, p_preset text)
--   toggle_report_block(p_course_id uuid, p_block_key text, p_enabled boolean)
--   save_teacher_preferences(p_patch jsonb)
--   get_report(p_enrollment_id uuid, p_term integer)
--
-- Imports:
--   import_teams_class(p_payload jsonb)
--   import_json_restore(p_payload jsonb)
--
-- Reads (hot path):
--   list_teacher_courses()
--   get_gradebook(p_course_id uuid)                                    -- the single boot-path RPC
--   get_class_dashboard(p_course_id uuid)
--   get_student_profile(p_enrollment_id uuid)
--   get_assessment_detail(p_assessment_id uuid)
--   get_observations(p_course_id uuid, p_filters jsonb, p_page int, p_page_size int)
--   get_learning_map(p_course_id uuid)
--
-- Analytics (fv_*):
--   fv_assessment_overall(p_enrollment_id uuid, p_assessment_id uuid)
--   fv_category_average(p_enrollment_id uuid, p_category_id uuid)
--   fv_course_letter_pipeline(p_enrollment_id uuid, p_course_id uuid)
--   fv_decaying_avg(vals numeric[], dates date[], dw numeric)
--   fv_group_rollup(p_enrollment_id uuid, p_group_id uuid)
--   fv_overall_proficiency(p_enrollment_id uuid, p_course_id uuid)
--   fv_percentage_to_letter(r numeric)
--   fv_q_to_percentage(q numeric)
--   fv_section_proficiency(p_enrollment_id uuid, p_section_id uuid)
--   fv_status_counts(p_enrollment_id uuid, p_course_id uuid)
--   fv_tag_score_for_assessment(p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid)

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- `category_weight_sum_trigger` before insert/update on category → fv_check_category_weight_sum()
-- `score_audit_trigger`         after  update on score          → _score_audit_diff(...)
-- `term_rating_audit_trigger`   after  update on term_rating    → _term_rating_audit_field(...)

-- ─── Publications ───────────────────────────────────────────────────────────
-- `supabase_realtime` was emptied by migration `zero_data_publication` (2026-04-17)
-- and NOT re-populated by the v2 rebuild. Cross-device live sync is offline
-- until the canonical entity tables are added back. Tracked as P2 item #13
-- in docs/superpowers/plans/2026-04-20-database-wiring-reconciliation.md.

-- ─── End of snapshot ────────────────────────────────────────────────────────
