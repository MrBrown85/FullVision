-- Database housekeeping from the Supabase advisor (2026-11-02).
--
-- 1. Twelve foreign keys had no index on their referencing column, so a
--    delete or update on the parent table scans the child table, and joins
--    through them can't use an index. Each gets a plain btree index.
-- 2. fv_idempotency_self called auth.uid() once per row; wrapped in a
--    sub-select it is evaluated once per query (Supabase's RLS guidance).
-- 3. fv_check_reporting_terms and student_submit._norm had a mutable
--    search_path. Both use only built-in functions, so they get an empty
--    one.
--
-- Not done, on purpose: the advisor's seven "unused" indexes stay. They
-- look unused because the tables are still small; they back foreign keys,
-- ownership checks and the student page's code lookup, which matter as the
-- data grows. The fv_backup tables stay too (Colin, 2026-11-01).

create index if not exists answer_question_id_idx on public.answer (question_id);
create index if not exists fv_idempotency_teacher_id_idx on public.fv_idempotency (teacher_id);
create index if not exists phone_report_created_by_idx on public.phone_report (created_by);
create index if not exists phone_report_reply_questionnaire_id_idx on public.phone_report (reply_questionnaire_id);
create index if not exists phone_report_student_enrollment_id_idx on public.phone_report_student (enrollment_id);
create index if not exists questionnaire_parent_id_idx on public.questionnaire (parent_id);
create index if not exists questionnaire_template_id_idx on public.questionnaire (template_id);
create index if not exists report_issue_issued_by_idx on public.report_issue (issued_by);
create index if not exists report_issue_student_enrollment_id_idx on public.report_issue_student (enrollment_id);
create index if not exists response_enrollment_id_idx on public.response (enrollment_id);
create index if not exists student_access_code_phone_report_id_idx on public.student_access_code (phone_report_id);
create index if not exists student_access_code_questionnaire_id_idx on public.student_access_code (questionnaire_id);

alter policy fv_idempotency_self on public.fv_idempotency using (teacher_id = (select auth.uid()));

alter function public.fv_check_reporting_terms(jsonb) set search_path = '';
alter function student_submit._norm(text) set search_path = '';
