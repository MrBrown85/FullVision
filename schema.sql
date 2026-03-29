-- ============================================================
-- FullVision — Complete Database Schema
-- ============================================================
-- Target: Supabase (PostgreSQL) in ca-central-1 (Montreal)
--         Required for FOIPPA compliance with BC student data.
--
-- Run this entire file in the Supabase SQL Editor to create
-- a fresh database from scratch for a new Supabase project.
--
-- Sections:
--   1. Extensions
--   2. Tables (profiles, normalized course tables, JSONB stores)
--   3. Indexes
--   4. Functions & Triggers
--   5. Row-Level Security (RLS) policies
--
-- Architecture note:
--   The app is migrating from JSONB blobs to normalized tables:
--
--   A) Normalized per-entity tables (scores, observations, assessments, students)
--      These are the PRIMARY runtime tables for high-frequency data.
--      gb-data.js reads/writes directly to these tables, converting
--      between app blob format and normalized rows on the fly.
--      All include teacher_id in the PK for co-teaching readiness.
--
--   B) Normalized medium-frequency tables (goals, reflections, overrides,
--      statuses, student_notes, student_flags, term_ratings)
--      Per-entity rows with delete-all + bulk-insert sync pattern.
--
--   C) Config tables (config_learning_maps, config_course, config_modules,
--      config_rubrics, config_custom_tags, config_report)
--      Single JSONB blob per teacher+course. Upsert sync pattern.
--
--   D) Global config (teacher_config)
--      Stores the COURSES object and gb-config preferences.
--      Not scoped to a course.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- SECTION 1: Extensions
-- ════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ════════════════════════════════════════════════════════════
-- SECTION 2: Tables
-- ════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────
-- profiles
-- Extends Supabase auth.users with app-specific fields.
-- Auto-populated by the handle_new_user() trigger on signup.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);


-- ──────────────────────────────────────────────────────────
-- scores  [NORMALIZED TABLE — Phase 1]
-- One row per score entry. Replaces the JSONB blob that was
-- previously stored in course_data with data_key='scores'.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scores (
  teacher_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id      TEXT        NOT NULL,
  student_id     TEXT        NOT NULL,
  assessment_id  TEXT        NOT NULL,
  tag_id         TEXT        NOT NULL,
  score          SMALLINT    NOT NULL,
  date           DATE,
  type           TEXT        NOT NULL DEFAULT 'summative',
  note           TEXT        DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id, assessment_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_student
  ON scores (teacher_id, course_id, student_id);
CREATE INDEX IF NOT EXISTS idx_scores_assessment
  ON scores (teacher_id, course_id, assessment_id);

ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own scores"
  ON scores FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- observations  [NORMALIZED TABLE — Phase 2]
-- One row per observation. Replaces the JSONB blob that was
-- previously stored in course_data with data_key='quick-obs'.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observations (
  teacher_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id          TEXT        NOT NULL,
  student_id         TEXT        NOT NULL,
  id                 TEXT        NOT NULL,
  text               TEXT        NOT NULL DEFAULT '',
  dims               JSONB       DEFAULT '[]',
  sentiment          TEXT,
  context            TEXT,
  assignment_context JSONB,
  date               DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at        TIMESTAMPTZ,
  PRIMARY KEY (teacher_id, course_id, id)
);

CREATE INDEX IF NOT EXISTS idx_observations_student
  ON observations (teacher_id, course_id, student_id);

ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own observations"
  ON observations FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- assessments  [NORMALIZED TABLE — Phase 3]
-- One row per assessment. Replaces the JSONB blob that was
-- previously stored in course_data with data_key='assessments'.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  teacher_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id           TEXT        NOT NULL,
  id                  TEXT        NOT NULL,
  title               TEXT        NOT NULL DEFAULT '',
  date                TEXT        DEFAULT '',
  type                TEXT        NOT NULL DEFAULT 'summative',
  tag_ids             JSONB       DEFAULT '[]',
  evidence_type       TEXT        DEFAULT '',
  notes               TEXT        DEFAULT '',
  core_competency_ids JSONB       DEFAULT '[]',
  rubric_id           TEXT        DEFAULT '',
  score_mode          TEXT        DEFAULT '',
  max_points          INTEGER     DEFAULT 0,
  weight              REAL        DEFAULT 1,
  due_date            TEXT        DEFAULT '',
  collaboration       TEXT        DEFAULT 'individual',
  module_id           TEXT        DEFAULT '',
  pairs               JSONB       DEFAULT '[]',
  groups              JSONB       DEFAULT '[]',
  excluded_students   JSONB       DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, id)
);

CREATE INDEX IF NOT EXISTS idx_assessments_course
  ON assessments (teacher_id, course_id);

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own assessments"
  ON assessments FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- students  [NORMALIZED TABLE — Phase 3]
-- One row per enrolled student per course. Replaces the JSONB
-- blob previously stored in course_data with data_key='students'.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  teacher_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id          TEXT        NOT NULL,
  id                 TEXT        NOT NULL,
  first_name         TEXT        NOT NULL DEFAULT '',
  last_name          TEXT        DEFAULT '',
  preferred          TEXT        DEFAULT '',
  pronouns           TEXT        DEFAULT '',
  student_number     TEXT        DEFAULT '',
  email              TEXT        DEFAULT '',
  date_of_birth      TEXT        DEFAULT '',
  designations       JSONB       DEFAULT '[]',
  enrolled_date      TEXT        DEFAULT '',
  attendance         JSONB       DEFAULT '[]',
  sort_name          TEXT        DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, id)
);

CREATE INDEX IF NOT EXISTS idx_students_course
  ON students (teacher_id, course_id);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own students"
  ON students FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- goals  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  teacher_id  UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   TEXT  NOT NULL,
  student_id  TEXT  NOT NULL,
  tag_id      TEXT  NOT NULL,
  text        TEXT  NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id, tag_id)
);
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own goals"
  ON goals FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- reflections  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reflections (
  teacher_id  UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   TEXT     NOT NULL,
  student_id  TEXT     NOT NULL,
  tag_id      TEXT     NOT NULL,
  confidence  SMALLINT DEFAULT 0,
  text        TEXT     NOT NULL DEFAULT '',
  date        TEXT     DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id, tag_id)
);
ALTER TABLE reflections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own reflections"
  ON reflections FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- overrides  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overrides (
  teacher_id  UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   TEXT     NOT NULL,
  student_id  TEXT     NOT NULL,
  tag_id      TEXT     NOT NULL,
  level       SMALLINT NOT NULL DEFAULT 0,
  reason      TEXT     NOT NULL DEFAULT '',
  date        TEXT     DEFAULT '',
  calculated  REAL     DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id, tag_id)
);
ALTER TABLE overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own overrides"
  ON overrides FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- statuses  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS statuses (
  teacher_id    UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id     TEXT  NOT NULL,
  student_id    TEXT  NOT NULL,
  assessment_id TEXT  NOT NULL,
  status        TEXT  NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id, assessment_id)
);
ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own statuses"
  ON statuses FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- student_notes  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_notes (
  teacher_id  UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   TEXT  NOT NULL,
  student_id  TEXT  NOT NULL,
  text        TEXT  NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id)
);
ALTER TABLE student_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own student_notes"
  ON student_notes FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- student_flags  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_flags (
  teacher_id  UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   TEXT  NOT NULL,
  student_id  TEXT  NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id)
);
ALTER TABLE student_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own student_flags"
  ON student_flags FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- term_ratings  [NORMALIZED TABLE — Phase 4]
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS term_ratings (
  teacher_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id   TEXT        NOT NULL,
  student_id  TEXT        NOT NULL,
  term_id     TEXT        NOT NULL,
  dims        JSONB       DEFAULT '{}',
  narrative   TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, student_id, term_id)
);
ALTER TABLE term_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own term_ratings"
  ON term_ratings FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);


-- (course_data table removed in Phase 6 — all data now in normalized tables above)


-- ──────────────────────────────────────────────────────────
-- teacher_config  [PRIMARY RUNTIME TABLE]
-- Global config not scoped to a course. Stores the COURSES
-- object and gb-config (activeCourse, preferences, etc.).
--
-- config_key values:
--   'courses' — the full COURSES object (all course metadata)
--   'config'  — gb-config (activeCourse, sidebar state, etc.)
--
-- onConflict: (teacher_id, config_key)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_config (
  teacher_id UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_key TEXT     NOT NULL,
  data       JSONB    NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, config_key)
);


-- ──────────────────────────────────────────────────────────
-- error_logs
-- Client-side JS errors logged via window.onerror and
-- unhandledrejection handlers in gb-ui.js. Fire-and-forget
-- inserts; only service_role can read.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS error_logs (
  id         BIGSERIAL   PRIMARY KEY,
  teacher_id UUID,
  page       TEXT,
  message    TEXT,
  stack      TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ════════════════════════════════════════════════════════════
-- CONFIG TABLES  [NORMALIZED — Phase 5]
-- Single JSONB blob per teacher+course. Config changes rarely,
-- so a simple data column is efficient. teacher_id in PK for
-- co-teaching readiness.
-- ════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────
-- config_learning_maps  [Phase 5]
-- Custom curriculum structure per course. Contains subjects
-- (top-level groupings) and sections/tags (learning outcomes).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_learning_maps (
  teacher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id)
);
ALTER TABLE config_learning_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own config_learning_maps"
  ON config_learning_maps FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- config_course  [Phase 5]
-- Per-course calculation settings: category weights, grading
-- scale overrides, etc.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_course (
  teacher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id)
);
ALTER TABLE config_course ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own config_course"
  ON config_course FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- config_modules  [Phase 5]
-- Teaching units/modules for grouping assessments.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_modules (
  teacher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id)
);
ALTER TABLE config_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own config_modules"
  ON config_modules FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- config_rubrics  [Phase 5]
-- Reusable scoring rubrics per course.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_rubrics (
  teacher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id)
);
ALTER TABLE config_rubrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own config_rubrics"
  ON config_rubrics FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- config_custom_tags  [Phase 5]
-- Teacher-created observation dimension tags per course.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_custom_tags (
  teacher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id)
);
ALTER TABLE config_custom_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own config_custom_tags"
  ON config_custom_tags FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ──────────────────────────────────────────────────────────
-- config_report  [Phase 5]
-- Per-course report generation settings (which sections to
-- include, comment templates, layout options, etc.).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_report (
  teacher_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id)
);
ALTER TABLE config_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own config_report"
  ON config_report FOR ALL USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);


-- ════════════════════════════════════════════════════════════
-- SECTION 3: Indexes
-- ════════════════════════════════════════════════════════════
-- All tables use composite PKs as their primary indexes.
-- Additional indexes are omitted until query patterns warrant them.
-- Unused indexes waste disk IO on writes.


-- ════════════════════════════════════════════════════════════
-- SECTION 4: Functions & Triggers
-- ════════════════════════════════════════════════════════════

-- Auto-create a profiles row when a new user signs up via
-- Supabase Auth. Extracts display_name from user metadata
-- (set during signUp in gb-supabase.js), falling back to
-- the email username.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ════════════════════════════════════════════════════════════
-- SECTION 5: Row-Level Security (RLS)
-- ════════════════════════════════════════════════════════════
-- Every table has RLS enabled. Teachers can only access their
-- own data. All tables check teacher_id = auth.uid() directly.


-- ── profiles ──────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);


-- ── teacher_config ───────────────────────────────────────
ALTER TABLE teacher_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers access own teacher_config"
  ON teacher_config FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);


-- ── error_logs ────────────────────────────────────────────
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own errors"
  ON error_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Service role can read all errors"
  ON error_logs FOR SELECT TO service_role
  USING (true);


-- (Legacy tables courses, course_config, learning_maps, rubrics, modules,
--  custom_tags, report_config, grading_scales removed in Phase 5.
--  Replaced by config_* tables with teacher_id PK. RLS policies are
--  defined inline with the config table definitions above.)


-- ════════════════════════════════════════════════════════════
-- DONE
-- ════════════════════════════════════════════════════════════
-- All tables, indexes, functions, triggers, and RLS policies
-- have been created. The database is ready for use.
--
-- Next steps:
--   1. Configure gb-supabase.js with your Project URL and anon key
--   2. Sign up a user — the handle_new_user trigger creates their profile
--   3. The app will auto-seed normalized tables from localStorage on first login
-- ════════════════════════════════════════════════════════════
