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
--   The app uses TWO storage strategies side by side:
--
--   A) JSONB document store (course_data + teacher_config)
--      This is what gb-data.js actually reads/writes at runtime.
--      Each localStorage key maps to one row in course_data with
--      a data_key like 'students', 'assessments', 'scores', etc.
--      All course data is stored as JSONB blobs per teacher+course.
--
--   B) Normalized tables (courses, students, assessments, etc.)
--      These exist for future query optimization, reporting, and
--      potential migration from the JSONB store. Some are
--      referenced by the account deletion flow in gb-ui.js.
--
--   Both are included here so the schema is complete.
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
-- course_data  [PRIMARY RUNTIME TABLE]
-- Generic key-value store scoped to teacher + course.
-- gb-data.js upserts all per-course data here as JSONB.
--
-- data_key values (one row per key per course per teacher):
--   students, assessments, scores, learningmap, courseconfig,
--   modules, rubrics, flags, goals, reflections, overrides,
--   statuses, quick-obs, term-ratings, custom-tags, notes,
--   report-config
--
-- onConflict: (teacher_id, course_id, data_key)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_data (
  teacher_id UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT     NOT NULL,
  data_key   TEXT     NOT NULL,
  data       JSONB    NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, data_key)
);


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
-- NORMALIZED TABLES
-- These mirror the JSONB data for future query/reporting use.
-- Included for completeness; the app currently reads/writes
-- via the course_data JSONB store above.
-- ════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────
-- courses
-- One row per course. teacher_id links to the owning teacher.
-- Fields match the COURSES global object in the app.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id                    TEXT PRIMARY KEY,
  teacher_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  grade_level           TEXT DEFAULT '',
  description           TEXT DEFAULT '',
  grading_system        TEXT DEFAULT 'proficiency',
  calc_method           TEXT DEFAULT 'mostRecent',
  decay_weight          REAL DEFAULT 0.65,
  curriculum_tags       TEXT[] DEFAULT '{}',
  report_as_percentage  BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now()
);


-- ──────────────────────────────────────────────────────────
-- course_config
-- Per-course calculation settings: category weights, grading
-- scale overrides, etc. Stored as a single JSONB blob.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_config (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  config    JSONB DEFAULT '{}'
);


-- ──────────────────────────────────────────────────────────
-- learning_maps
-- Custom curriculum structure per course. Contains subjects
-- (top-level groupings) and sections/tags (learning outcomes).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_maps (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  map_data  JSONB NOT NULL DEFAULT '{}'
);


-- ──────────────────────────────────────────────────────────
-- students
-- Enrolled students per course. Composite PK of (id, course_id)
-- because the same student ID could appear in multiple courses.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id              TEXT NOT NULL,
  course_id       TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT DEFAULT '',
  preferred       TEXT DEFAULT '',
  pronouns        TEXT DEFAULT '',
  student_number  TEXT DEFAULT '',
  email           TEXT DEFAULT '',
  date_of_birth   TEXT DEFAULT '',
  designation     TEXT DEFAULT '',
  enrolled_date   TEXT DEFAULT '',
  attendance      JSONB DEFAULT '[]',
  PRIMARY KEY (id, course_id)
);


-- ──────────────────────────────────────────────────────────
-- assessments
-- Summative and formative assessments. Each assessment links
-- to curriculum tags via tag_ids and optionally to a module.
-- Supports individual, pair, and group collaboration modes.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  id                  TEXT NOT NULL,
  course_id           TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  date                TEXT DEFAULT '',
  type                TEXT DEFAULT 'summative',
  tag_ids             TEXT[] DEFAULT '{}',
  evidence_type       TEXT DEFAULT '',
  notes               TEXT DEFAULT '',
  core_competency_ids TEXT[] DEFAULT '{}',
  rubric_id           TEXT DEFAULT '',
  score_mode          TEXT DEFAULT '',
  max_points          INTEGER DEFAULT 0,
  weight              REAL DEFAULT 1,
  due_date            TEXT DEFAULT '',
  collaboration       TEXT DEFAULT 'individual',
  module_id           TEXT DEFAULT '',
  pairs               JSONB DEFAULT '[]',
  groups              JSONB DEFAULT '[]',
  excluded_students   TEXT[] DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, course_id)
);


-- ──────────────────────────────────────────────────────────
-- scores
-- One row per student + assessment + tag combination.
-- This is the largest table in a production deployment.
-- Uses BIGSERIAL id for the normalized version (the JSONB
-- store in course_data uses the app-generated string IDs).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scores (
  id            BIGSERIAL PRIMARY KEY,
  course_id     TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  tag_id        TEXT NOT NULL,
  score         REAL DEFAULT 0,
  type          TEXT DEFAULT 'summative',
  date          TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);


-- ──────────────────────────────────────────────────────────
-- rubrics
-- Reusable scoring rubrics per course. criteria is a JSONB
-- array of {name, levels: [{label, description, score}]}.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rubrics (
  id        TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  criteria  JSONB DEFAULT '[]',
  PRIMARY KEY (id, course_id)
);


-- ──────────────────────────────────────────────────────────
-- modules
-- Teaching units/modules for grouping assessments.
-- color is a hex string; sort_order controls display order.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modules (
  id         TEXT NOT NULL,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT '#007AFF',
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (id, course_id)
);


-- ──────────────────────────────────────────────────────────
-- student_meta
-- Per-student-per-course metadata: flags (IEP, ELL, etc.),
-- goals, reflections, proficiency overrides, and assignment
-- statuses (excused / not submitted).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_meta (
  student_id  TEXT NOT NULL,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  flags       JSONB DEFAULT '{}',
  goals       JSONB DEFAULT '{}',
  reflections JSONB DEFAULT '{}',
  overrides   JSONB DEFAULT '{}',
  statuses    JSONB DEFAULT '{}',
  PRIMARY KEY (student_id, course_id)
);


-- ──────────────────────────────────────────────────────────
-- observations
-- Quick observations / anecdotal notes per student.
-- dims links to curriculum dimensions; sentiment and context
-- are optional metadata. assignment_context links an
-- observation to a specific assessment if applicable.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observations (
  id                 TEXT PRIMARY KEY,
  course_id          TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id         TEXT NOT NULL,
  text               TEXT NOT NULL,
  date               TEXT DEFAULT '',
  dims               TEXT[] DEFAULT '{}',
  sentiment          TEXT DEFAULT '',
  context            TEXT DEFAULT '',
  assignment_context JSONB DEFAULT NULL,
  created_at         TIMESTAMPTZ DEFAULT now()
);


-- ──────────────────────────────────────────────────────────
-- term_ratings
-- End-of-term learner profile ratings. One row per student
-- per term per course. dims holds per-dimension ratings;
-- narrative is the written comment.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS term_ratings (
  course_id           TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL,
  term_id             TEXT NOT NULL,
  dims                JSONB DEFAULT '{}',
  narrative           TEXT DEFAULT '',
  mention_assessments TEXT[] DEFAULT '{}',
  traits              JSONB DEFAULT '{}',
  PRIMARY KEY (course_id, student_id, term_id)
);


-- ──────────────────────────────────────────────────────────
-- custom_tags
-- Teacher-created observation dimension tags per course.
-- Stored as a JSONB array of tag objects.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_tags (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tags      JSONB DEFAULT '[]',
  PRIMARY KEY (course_id)
);


-- ──────────────────────────────────────────────────────────
-- report_config
-- Per-course report generation settings (which sections to
-- include, comment templates, layout options, etc.).
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_config (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  config    JSONB DEFAULT '{}',
  PRIMARY KEY (course_id)
);


-- ──────────────────────────────────────────────────────────
-- grading_scales
-- Per-course grading scale overrides. Allows teachers to
-- customize proficiency level labels and boundaries.
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grading_scales (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  scale     JSONB DEFAULT '{}',
  PRIMARY KEY (course_id)
);


-- ════════════════════════════════════════════════════════════
-- SECTION 3: Indexes
-- ════════════════════════════════════════════════════════════

-- course_data: speed up fetching all keys for a teacher+course
CREATE INDEX IF NOT EXISTS idx_course_data_teacher_course
  ON course_data(teacher_id, course_id);

-- scores: fast lookups by course+student and course+assessment
CREATE INDEX IF NOT EXISTS idx_scores_course_student
  ON scores(course_id, student_id);

CREATE INDEX IF NOT EXISTS idx_scores_course_assess
  ON scores(course_id, assessment_id);

-- observations: fast per-student lookups
CREATE INDEX IF NOT EXISTS idx_obs_course_student
  ON observations(course_id, student_id);


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
-- own data. The course_data and teacher_config tables check
-- teacher_id = auth.uid() directly. Normalized tables that
-- lack a teacher_id column use a subquery on the courses table.


-- ── profiles ──────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);


-- ── course_data (JSONB store) ─────────────────────────────
ALTER TABLE course_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers access own course_data"
  ON course_data FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);


-- ── teacher_config (JSONB store) ──────────────────────────
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


-- ── courses ───────────────────────────────────────────────
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see own courses"
  ON courses FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "Teachers create own courses"
  ON courses FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Teachers update own courses"
  ON courses FOR UPDATE
  USING (teacher_id = auth.uid());

CREATE POLICY "Teachers delete own courses"
  ON courses FOR DELETE
  USING (teacher_id = auth.uid());


-- ── course_config ─────────────────────────────────────────
ALTER TABLE course_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own course config"
  ON course_config FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── learning_maps ─────────────────────────────────────────
ALTER TABLE learning_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own learning maps"
  ON learning_maps FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── students ──────────────────────────────────────────────
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own students"
  ON students FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── assessments ───────────────────────────────────────────
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own assessments"
  ON assessments FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── scores ────────────────────────────────────────────────
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own scores"
  ON scores FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── rubrics ───────────────────────────────────────────────
ALTER TABLE rubrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own rubrics"
  ON rubrics FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── modules ───────────────────────────────────────────────
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own modules"
  ON modules FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── student_meta ──────────────────────────────────────────
ALTER TABLE student_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own student meta"
  ON student_meta FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── observations ──────────────────────────────────────────
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own observations"
  ON observations FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── term_ratings ──────────────────────────────────────────
ALTER TABLE term_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own term ratings"
  ON term_ratings FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── custom_tags ───────────────────────────────────────────
ALTER TABLE custom_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own custom tags"
  ON custom_tags FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── report_config ─────────────────────────────────────────
ALTER TABLE report_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own report config"
  ON report_config FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ── grading_scales ────────────────────────────────────────
ALTER TABLE grading_scales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own grading scales"
  ON grading_scales FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));


-- ════════════════════════════════════════════════════════════
-- DONE
-- ════════════════════════════════════════════════════════════
-- All tables, indexes, functions, triggers, and RLS policies
-- have been created. The database is ready for use.
--
-- Next steps:
--   1. Configure gb-supabase.js with your Project URL and anon key
--   2. Sign up a user — the handle_new_user trigger creates their profile
--   3. The app will auto-seed course_data rows from localStorage on first login
-- ════════════════════════════════════════════════════════════
