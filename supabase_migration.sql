-- ============================================================
-- FullVision — Full Database Migration
-- ============================================================
-- Run this entire file in the Supabase SQL Editor to set up
-- a fresh database from scratch.
--
-- Supabase project must be in ca-central-1 (Montreal) for FOIPPA.
--
-- Order: Extensions → Tables → Indexes → Functions → Triggers → RLS
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ════════════════════════════════════════════════════════════
-- SECTION 1: Tables
-- ════════════════════════════════════════════════════════════

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade_level TEXT DEFAULT '',
  description TEXT DEFAULT '',
  grading_system TEXT DEFAULT 'proficiency',
  calc_method TEXT DEFAULT 'mostRecent',
  decay_weight REAL DEFAULT 0.65,
  curriculum_tags TEXT[] DEFAULT '{}',
  report_as_percentage BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Course config (calc weights, category weights, etc.)
CREATE TABLE IF NOT EXISTS course_config (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  config JSONB DEFAULT '{}'
);

-- Learning maps
CREATE TABLE IF NOT EXISTS learning_maps (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  map_data JSONB NOT NULL DEFAULT '{}'
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT DEFAULT '',
  preferred TEXT DEFAULT '',
  pronouns TEXT DEFAULT '',
  student_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  date_of_birth TEXT DEFAULT '',
  designation TEXT DEFAULT '',
  enrolled_date TEXT DEFAULT '',
  attendance JSONB DEFAULT '[]',
  PRIMARY KEY (id, course_id)
);

-- Assessments
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT DEFAULT '',
  type TEXT DEFAULT 'summative',
  tag_ids TEXT[] DEFAULT '{}',
  evidence_type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  core_competency_ids TEXT[] DEFAULT '{}',
  rubric_id TEXT DEFAULT '',
  score_mode TEXT DEFAULT '',
  max_points INTEGER DEFAULT 0,
  weight REAL DEFAULT 1,
  due_date TEXT DEFAULT '',
  collaboration TEXT DEFAULT 'individual',
  module_id TEXT DEFAULT '',
  pairs JSONB DEFAULT '[]',
  groups JSONB DEFAULT '[]',
  excluded_students TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, course_id)
);

-- Scores (one row per student-assessment-tag combination)
CREATE TABLE IF NOT EXISTS scores (
  id BIGSERIAL,
  course_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  score REAL DEFAULT 0,
  type TEXT DEFAULT 'summative',
  date TEXT DEFAULT '',
  note TEXT DEFAULT '',
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (id)
);

-- Rubrics
CREATE TABLE IF NOT EXISTS rubrics (
  id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  criteria JSONB DEFAULT '[]',
  PRIMARY KEY (id, course_id)
);

-- Modules (assignment grouping)
CREATE TABLE IF NOT EXISTS modules (
  id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#007AFF',
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (id, course_id)
);

-- Student meta (flags, goals, reflections, overrides)
CREATE TABLE IF NOT EXISTS student_meta (
  student_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  flags JSONB DEFAULT '{}',
  goals JSONB DEFAULT '{}',
  reflections JSONB DEFAULT '{}',
  overrides JSONB DEFAULT '{}',
  statuses JSONB DEFAULT '{}',
  PRIMARY KEY (student_id, course_id)
);

-- Quick observations
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  text TEXT NOT NULL,
  date TEXT DEFAULT '',
  dims TEXT[] DEFAULT '{}',
  sentiment TEXT DEFAULT '',
  context TEXT DEFAULT '',
  assignment_context JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Term ratings
CREATE TABLE IF NOT EXISTS term_ratings (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  dims JSONB DEFAULT '{}',
  narrative TEXT DEFAULT '',
  mention_assessments TEXT[] DEFAULT '{}',
  traits JSONB DEFAULT '{}',
  PRIMARY KEY (course_id, student_id, term_id)
);

-- Custom tags (teacher-created observation tags)
CREATE TABLE IF NOT EXISTS custom_tags (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tags JSONB DEFAULT '[]',
  PRIMARY KEY (course_id)
);

-- Report config (per course)
CREATE TABLE IF NOT EXISTS report_config (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  config JSONB DEFAULT '{}',
  PRIMARY KEY (course_id)
);

-- Grading scale (per course)
CREATE TABLE IF NOT EXISTS grading_scales (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  scale JSONB DEFAULT '{}',
  PRIMARY KEY (course_id)
);

-- Error logs
CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  teacher_id UUID,
  page TEXT,
  message TEXT,
  stack TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Generic key-value store (course-scoped data)
CREATE TABLE IF NOT EXISTS course_data (
  teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  TEXT NOT NULL,
  data_key   TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, data_key)
);

-- Global config (not course-scoped)
CREATE TABLE IF NOT EXISTS teacher_config (
  teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_key TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, config_key)
);


-- ════════════════════════════════════════════════════════════
-- SECTION 2: Indexes
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_scores_course_student ON scores(course_id, student_id);
CREATE INDEX IF NOT EXISTS idx_scores_course_assess ON scores(course_id, assessment_id);
CREATE INDEX IF NOT EXISTS idx_obs_course_student ON observations(course_id, student_id);
CREATE INDEX IF NOT EXISTS idx_course_data_teacher_course ON course_data(teacher_id, course_id);


-- ════════════════════════════════════════════════════════════
-- SECTION 3: Functions & Triggers
-- ════════════════════════════════════════════════════════════

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ════════════════════════════════════════════════════════════
-- SECTION 4: Row-Level Security
-- ════════════════════════════════════════════════════════════

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Courses
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers see own courses" ON courses FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "Teachers create own courses" ON courses FOR INSERT WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "Teachers update own courses" ON courses FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "Teachers delete own courses" ON courses FOR DELETE USING (teacher_id = auth.uid());

-- Course config
ALTER TABLE course_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own course config" ON course_config FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Learning maps
ALTER TABLE learning_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own learning maps" ON learning_maps FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Students
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own students" ON students FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Assessments
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own assessments" ON assessments FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Scores
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own scores" ON scores FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Rubrics
ALTER TABLE rubrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own rubrics" ON rubrics FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Modules
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own modules" ON modules FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Student meta
ALTER TABLE student_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own student meta" ON student_meta FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Observations
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own observations" ON observations FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Term ratings
ALTER TABLE term_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own term ratings" ON term_ratings FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Custom tags
ALTER TABLE custom_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own custom tags" ON custom_tags FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Report config
ALTER TABLE report_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own report config" ON report_config FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Grading scales
ALTER TABLE grading_scales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own grading scales" ON grading_scales FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Error logs
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own errors" ON error_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Service role can read all errors" ON error_logs
  FOR SELECT TO service_role
  USING (true);

-- Course data (generic store)
ALTER TABLE course_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own course_data" ON course_data FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- Teacher config (global store)
ALTER TABLE teacher_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers access own teacher_config" ON teacher_config FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);


-- ════════════════════════════════════════════════════════════
-- DONE. All tables, indexes, functions, triggers, and RLS
-- policies have been created.
-- ════════════════════════════════════════════════════════════
