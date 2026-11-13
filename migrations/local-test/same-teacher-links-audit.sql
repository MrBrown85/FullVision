-- Read-only. Counts only: no names, no ids. One row per (table, column) the
-- same-teacher rule judges: how many rows today name a record of a teacher
-- other than the teacher who owns the row (through its first column).
-- Run on gradebook-prod as a read-only role. Every count should be 0.
-- Run 2026-11-13 before the migration was applied: every count was 0.
select 'public.answer.question_id'::text as "check", count(*) as "count" from public.answer r where (select c.teacher_id from public.question x join public.questionnaire n on n.id = x.questionnaire_id join public.course c on c.id = n.course_id where x.id = r.question_id) <> (select c.teacher_id from public.response x join public.questionnaire n on n.id = x.questionnaire_id join public.course c on c.id = n.course_id where x.id = r.response_id)
union all
select 'public.assessment.rubric_id'::text as "check", count(*) as "count" from public.assessment r where (select c.teacher_id from public.rubric x join public.course c on c.id = x.course_id where x.id = r.rubric_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.assessment.category_id'::text as "check", count(*) as "count" from public.assessment r where (select c.teacher_id from public.category x join public.course c on c.id = x.course_id where x.id = r.category_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.assessment.copy_group'::text as "check", count(*) as "count" from public.assessment r where r.copy_group is not null and exists (select 1 from public.assessment y join public.course c on c.id = y.course_id where y.copy_group = r.copy_group and c.teacher_id <> (select c.teacher_id from public.course c where c.id = r.course_id))
union all
select 'public.assessment.module_id'::text as "check", count(*) as "count" from public.assessment r where (select c.teacher_id from public.module x join public.course c on c.id = x.course_id where x.id = r.module_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.assessment_resource.assessment_id'::text as "check", count(*) as "count" from public.assessment_resource r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.assessment_tag.tag_id'::text as "check", count(*) as "count" from public.assessment_tag r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id)
union all
select 'public.criterion_tag.tag_id'::text as "check", count(*) as "count" from public.criterion_tag r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.criterion x join public.rubric rb on rb.id = x.rubric_id join public.course c on c.id = rb.course_id where x.id = r.criterion_id)
union all
select 'public.dibels_score.assessment_id'::text as "check", count(*) as "count" from public.dibels_score r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.enrollment.student_id'::text as "check", count(*) as "count" from public.enrollment r where (select s.teacher_id from public.student s where s.id = r.student_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.feedback_reflection.enrollment_id'::text as "check", count(*) as "count" from public.feedback_reflection r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.feedback_reflection.assessment_id'::text as "check", count(*) as "count" from public.feedback_reflection r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.goal.section_id'::text as "check", count(*) as "count" from public.goal r where (select c.teacher_id from public.section x join public.course c on c.id = x.course_id where x.id = r.section_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.grade_return.assessment_id'::text as "check", count(*) as "count" from public.grade_return r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.markup.file_id'::text as "check", count(*) as "count" from public.markup r where (select c.teacher_id from public.submission_file x join public.submission s on s.id = x.submission_id join public.course c on c.id = s.course_id where x.id = r.file_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.markup.enrollment_id'::text as "check", count(*) as "count" from public.markup r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.markup.assessment_id'::text as "check", count(*) as "count" from public.markup r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.markup_kept.submission_id'::text as "check", count(*) as "count" from public.markup_kept r where (select c.teacher_id from public.submission x join public.course c on c.id = x.course_id where x.id = r.submission_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.markup_kept.enrollment_id'::text as "check", count(*) as "count" from public.markup_kept r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.markup_kept.assessment_id'::text as "check", count(*) as "count" from public.markup_kept r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.observation.assessment_id'::text as "check", count(*) as "count" from public.observation r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.observation.template_id'::text as "check", count(*) as "count" from public.observation r where (select coalesce(x.teacher_id, c.teacher_id) from public.observation_template x left join public.course c on c.id = x.course_id where x.id = r.template_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.observation_custom_tag.custom_tag_id'::text as "check", count(*) as "count" from public.observation_custom_tag r where (select c.teacher_id from public.custom_tag x join public.course c on c.id = x.course_id where x.id = r.custom_tag_id) <> (select c.teacher_id from public.observation x join public.course c on c.id = x.course_id where x.id = r.observation_id)
union all
select 'public.observation_student.enrollment_id'::text as "check", count(*) as "count" from public.observation_student r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.observation x join public.course c on c.id = x.course_id where x.id = r.observation_id)
union all
select 'public.observation_tag.tag_id'::text as "check", count(*) as "count" from public.observation_tag r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.observation x join public.course c on c.id = x.course_id where x.id = r.observation_id)
union all
select 'public.observation_template.course_id'::text as "check", count(*) as "count" from public.observation_template r where (select c.teacher_id from public.course c where c.id = r.course_id) <> r.teacher_id
union all
select 'public.phone_report.created_by'::text as "check", count(*) as "count" from public.phone_report r where r.created_by <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.phone_report_student.enrollment_id'::text as "check", count(*) as "count" from public.phone_report_student r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.phone_report x join public.course c on c.id = x.course_id where x.id = r.report_id)
union all
select 'public.questionnaire.parent_id'::text as "check", count(*) as "count" from public.questionnaire r where (select c.teacher_id from public.questionnaire x join public.course c on c.id = x.course_id where x.id = r.parent_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.reflection.section_id'::text as "check", count(*) as "count" from public.reflection r where (select c.teacher_id from public.section x join public.course c on c.id = x.course_id where x.id = r.section_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.report_issue.issued_by'::text as "check", count(*) as "count" from public.report_issue r where r.issued_by <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.report_issue_student.enrollment_id'::text as "check", count(*) as "count" from public.report_issue_student r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.report_issue x join public.course c on c.id = x.course_id where x.id = r.issue_id)
union all
select 'public.response.created_by'::text as "check", count(*) as "count" from public.response r where r.created_by <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.response.questionnaire_id'::text as "check", count(*) as "count" from public.response r where (select c.teacher_id from public.questionnaire x join public.course c on c.id = x.course_id where x.id = r.questionnaire_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.revision_request.enrollment_id'::text as "check", count(*) as "count" from public.revision_request r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.revision_request.assessment_id'::text as "check", count(*) as "count" from public.revision_request r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.revision_request.created_by'::text as "check", count(*) as "count" from public.revision_request r where r.created_by <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.revision_request.criterion_ids'::text as "check", count(*) as "count" from public.revision_request r where exists (select 1 from unnest(r.criterion_ids) u(v) where (select c.teacher_id from public.criterion x join public.rubric rb on rb.id = x.rubric_id join public.course c on c.id = rb.course_id where x.id = u.v) <> (select c.teacher_id from public.course c where c.id = r.course_id))
union all
select 'public.revision_request.first_submission_id'::text as "check", count(*) as "count" from public.revision_request r where (select c.teacher_id from public.submission x join public.course c on c.id = x.course_id where x.id = r.first_submission_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.rubric.copy_group'::text as "check", count(*) as "count" from public.rubric r where r.copy_group is not null and exists (select 1 from public.rubric y join public.course c on c.id = y.course_id where y.copy_group = r.copy_group and c.teacher_id <> (select c.teacher_id from public.course c where c.id = r.course_id))
union all
select 'public.rubric_check_score.assessment_id'::text as "check", count(*) as "count" from public.rubric_check_score r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.rubric_check_score.check_id'::text as "check", count(*) as "count" from public.rubric_check_score r where (select c.teacher_id from public.criterion_check k join public.criterion x on x.id = k.criterion_id join public.rubric rb on rb.id = x.rubric_id join public.course c on c.id = rb.course_id where k.id = r.check_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.rubric_print.assessment_id'::text as "check", count(*) as "count" from public.rubric_print r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.rubric_score.enrollment_id'::text as "check", count(*) as "count" from public.rubric_score r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.criterion x join public.rubric rb on rb.id = x.rubric_id join public.course c on c.id = rb.course_id where x.id = r.criterion_id)
union all
select 'public.rubric_score.assessment_id'::text as "check", count(*) as "count" from public.rubric_score r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.criterion x join public.rubric rb on rb.id = x.rubric_id join public.course c on c.id = rb.course_id where x.id = r.criterion_id)
union all
select 'public.rubric_tag.tag_id'::text as "check", count(*) as "count" from public.rubric_tag r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.rubric x join public.course c on c.id = x.course_id where x.id = r.rubric_id)
union all
select 'public.score.assessment_id'::text as "check", count(*) as "count" from public.score r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.score_audit.changed_by'::text as "check", count(*) as "count" from public.score_audit r where r.changed_by <> (select c.teacher_id from public.score x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.score_id)
union all
select 'public.section.competency_group_id'::text as "check", count(*) as "count" from public.section r where (select c.teacher_id from public.competency_group x join public.course c on c.id = x.course_id where x.id = r.competency_group_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.section.subject_id'::text as "check", count(*) as "count" from public.section r where (select c.teacher_id from public.subject x join public.course c on c.id = x.course_id where x.id = r.subject_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.section_override.section_id'::text as "check", count(*) as "count" from public.section_override r where (select c.teacher_id from public.section x join public.course c on c.id = x.course_id where x.id = r.section_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.student_access_code.phone_report_id'::text as "check", count(*) as "count" from public.student_access_code r where (select c.teacher_id from public.phone_report x join public.course c on c.id = x.course_id where x.id = r.phone_report_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.student_access_code.questionnaire_id'::text as "check", count(*) as "count" from public.student_access_code r where (select c.teacher_id from public.questionnaire x join public.course c on c.id = x.course_id where x.id = r.questionnaire_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.student_access_code.report_issue_id'::text as "check", count(*) as "count" from public.student_access_code r where (select c.teacher_id from public.report_issue x join public.course c on c.id = x.course_id where x.id = r.report_issue_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.submission.enrollment_id'::text as "check", count(*) as "count" from public.submission r where (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.submission.assessment_id'::text as "check", count(*) as "count" from public.submission r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.submission.card_id'::text as "check", count(*) as "count" from public.submission r where (select c.teacher_id from public.student_card x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.card_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.submission.request_id'::text as "check", count(*) as "count" from public.submission r where (select c.teacher_id from public.revision_request x join public.course c on c.id = x.course_id where x.id = r.request_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.submission.target_id'::text as "check", count(*) as "count" from public.submission r where (select c.teacher_id from public.submission x join public.course c on c.id = x.course_id where x.id = r.target_id) <> (select c.teacher_id from public.course c where c.id = r.course_id)
union all
select 'public.tag_score.assessment_id'::text as "check", count(*) as "count" from public.tag_score r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.tag_score.tag_id'::text as "check", count(*) as "count" from public.tag_score r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
union all
select 'public.teacher_preference.active_course_id'::text as "check", count(*) as "count" from public.teacher_preference r where (select c.teacher_id from public.course c where c.id = r.active_course_id) <> r.teacher_id
union all
select 'public.term_rating_assessment.assessment_id'::text as "check", count(*) as "count" from public.term_rating_assessment r where (select c.teacher_id from public.assessment x join public.course c on c.id = x.course_id where x.id = r.assessment_id) <> (select c.teacher_id from public.term_rating x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.term_rating_id)
union all
select 'public.term_rating_audit.changed_by'::text as "check", count(*) as "count" from public.term_rating_audit r where r.changed_by <> (select c.teacher_id from public.term_rating x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.term_rating_id)
union all
select 'public.term_rating_dimension.section_id'::text as "check", count(*) as "count" from public.term_rating_dimension r where (select c.teacher_id from public.section x join public.course c on c.id = x.course_id where x.id = r.section_id) <> (select c.teacher_id from public.term_rating x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.term_rating_id)
union all
select 'public.term_rating_growth_area.tag_id'::text as "check", count(*) as "count" from public.term_rating_growth_area r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.term_rating x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.term_rating_id)
union all
select 'public.term_rating_observation.term_rating_id'::text as "check", count(*) as "count" from public.term_rating_observation r where (select c.teacher_id from public.term_rating x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.term_rating_id) <> (select c.teacher_id from public.observation x join public.course c on c.id = x.course_id where x.id = r.observation_id)
union all
select 'public.term_rating_strength.tag_id'::text as "check", count(*) as "count" from public.term_rating_strength r where (select c.teacher_id from public.tag x join public.section s on s.id = x.section_id join public.course c on c.id = s.course_id where x.id = r.tag_id) <> (select c.teacher_id from public.term_rating x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.term_rating_id)
union all
select 'student_submit.device_session_enrollment.card_id'::text as "check", count(*) as "count" from student_submit.device_session_enrollment r where (select c.teacher_id from public.student_card x join public.enrollment e on e.id = x.enrollment_id join public.course c on c.id = e.course_id where x.id = r.card_id) <> (select c.teacher_id from public.enrollment x join public.course c on c.id = x.course_id where x.id = r.enrollment_id)
order by 1;
