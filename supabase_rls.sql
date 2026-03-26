-- Row-Level Security Policies for FullVision
-- Each teacher can only read/write their own data

-- Helper: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════

-- Profiles: users can read/update their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Courses: teachers see only their courses
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers see own courses" ON courses FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "Teachers create own courses" ON courses FOR INSERT WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "Teachers update own courses" ON courses FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "Teachers delete own courses" ON courses FOR DELETE USING (teacher_id = auth.uid());

-- Course config: linked to courses the teacher owns
ALTER TABLE course_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own course config" ON course_config FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Learning maps: linked to courses
ALTER TABLE learning_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own learning maps" ON learning_maps FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Students: linked to courses
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own students" ON students FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Assessments: linked to courses
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own assessments" ON assessments FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Scores: linked to courses
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own scores" ON scores FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Rubrics: linked to courses
ALTER TABLE rubrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own rubrics" ON rubrics FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Modules: linked to courses
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own modules" ON modules FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Student meta: linked to courses
ALTER TABLE student_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own student meta" ON student_meta FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Observations: linked to courses
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own observations" ON observations FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Term ratings: linked to courses
ALTER TABLE term_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own term ratings" ON term_ratings FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Custom tags: linked to courses
ALTER TABLE custom_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own custom tags" ON custom_tags FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Report config: linked to courses
ALTER TABLE report_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own report config" ON report_config FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));

-- Grading scales: linked to courses
ALTER TABLE grading_scales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own grading scales" ON grading_scales FOR ALL
  USING (course_id IN (SELECT id FROM courses WHERE teacher_id = auth.uid()));
