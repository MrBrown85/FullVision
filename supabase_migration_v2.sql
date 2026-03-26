-- ============================================================
-- FullVision — Migration v2: Constraints & Indexes
-- ============================================================
-- Run in Supabase SQL Editor after the initial schema.sql.
-- Adds CHECK constraints for data integrity and indexes for
-- commonly queried columns.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- CHECK CONSTRAINTS
-- ════════════════════════════════════════════════════════════

-- Scores: proficiency must be 0-4 (Not Assessed through Extending)
ALTER TABLE scores
  ADD CONSTRAINT score_range CHECK (score >= 0 AND score <= 4);

-- Scores: enforce NOT NULL on score value and date
ALTER TABLE scores
  ALTER COLUMN score SET NOT NULL;
ALTER TABLE scores
  ALTER COLUMN date SET NOT NULL;

-- Assessments: type must be a known value
ALTER TABLE assessments
  ADD CONSTRAINT assessment_type_check
  CHECK (type IN ('summative', 'formative'));

-- Assessments: collaboration mode must be a known value
ALTER TABLE assessments
  ADD CONSTRAINT collaboration_check
  CHECK (collaboration IN ('individual', 'pairs', 'groups'));

-- Courses: grading system must be a known value
ALTER TABLE courses
  ADD CONSTRAINT grading_system_check
  CHECK (grading_system IN ('proficiency', 'points'));

-- Courses: calculation method must be a known value
ALTER TABLE courses
  ADD CONSTRAINT calc_method_check
  CHECK (calc_method IN ('mostRecent', 'highest', 'mode', 'decayingAvg'));


-- ════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════

-- courses: fast lookup by teacher (used by RLS subqueries on every request)
CREATE INDEX IF NOT EXISTS idx_courses_teacher
  ON courses(teacher_id);

-- observations: chronological feed queries per course
CREATE INDEX IF NOT EXISTS idx_obs_course_date
  ON observations(course_id, created_at DESC);

-- assessments: filter by type within a course
CREATE INDEX IF NOT EXISTS idx_assess_course_type
  ON assessments(course_id, type);

-- students: roster lookup per course
CREATE INDEX IF NOT EXISTS idx_students_course
  ON students(course_id);
