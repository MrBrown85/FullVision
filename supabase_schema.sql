-- FullVision Schema
-- Tables for the gradebook app

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
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

-- Create index for fast score lookups
CREATE INDEX IF NOT EXISTS idx_scores_course_student ON scores(course_id, student_id);
CREATE INDEX IF NOT EXISTS idx_scores_course_assess ON scores(course_id, assessment_id);

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

-- Student meta (flags, goals, reflections, overrides — all in one row per student-course)
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

CREATE INDEX IF NOT EXISTS idx_obs_course_student ON observations(course_id, student_id);

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

