/*
 * Which teacher owns each row, for every table in the app's schemas.
 *
 * The security rule tests (tests/db/run.mjs) list the tables from the
 * database itself. A table missing here fails the run, so a new table
 * cannot be added without deciding whose rows it holds.
 *
 * OWNERS: an SQL expression that gives the owning teacher's id for a row
 * `t`. The rls_test.of_* helpers are in tests/db/helpers.sql.
 *
 * NO_TEACHER: tables whose rows belong to no one teacher, each with its
 * reason. `read` says what a signed-in teacher may do: 'all' (read every
 * row, change none) or 'none' (no access at all). A visitor who is not
 * signed in gets nothing from any table.
 */

export const OWNERS = {
  'public.answer': 'rls_test.of_response(t.response_id)',
  'public.assessment': 'rls_test.of_course(t.course_id)',
  'public.assessment_resource': 'rls_test.of_course(t.course_id)',
  'public.assessment_tag': 'rls_test.of_assessment(t.assessment_id)',
  'public.attendance': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.category': 'rls_test.of_course(t.course_id)',
  'public.comment_template': 't.teacher_id',
  'public.competency_descriptor': 't.teacher_id',
  'public.competency_group': 'rls_test.of_course(t.course_id)',
  'public.core_self_assessment': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.course': 't.teacher_id',
  'public.course_sync_cursor': 'rls_test.of_course(t.course_id)',
  'public.criterion': 'rls_test.of_rubric(t.rubric_id)',
  'public.criterion_check': 'rls_test.of_criterion(t.criterion_id)',
  'public.criterion_tag': 'rls_test.of_criterion(t.criterion_id)',
  'public.custom_tag': 'rls_test.of_course(t.course_id)',
  'public.dibels_score': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.enrollment': 'rls_test.of_course(t.course_id)',
  'public.feedback_reflection': 'rls_test.of_course(t.course_id)',
  'public.fv_idempotency': 't.teacher_id',
  'public.goal': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.grade_return': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.grade_return_repair_log': 'rls_test.of_course(t.course_id)',
  'public.guardian': 'rls_test.of_student(t.student_id)',
  'public.markup': 'rls_test.of_course(t.course_id)',
  'public.markup_kept': 'rls_test.of_course(t.course_id)',
  'public.module': 'rls_test.of_course(t.course_id)',
  'public.note': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.observation': 'rls_test.of_course(t.course_id)',
  'public.observation_custom_tag': 'rls_test.of_observation(t.observation_id)',
  'public.observation_student': 'rls_test.of_observation(t.observation_id)',
  'public.observation_tag': 'rls_test.of_observation(t.observation_id)',
  'public.observation_template': 'coalesce(t.teacher_id, rls_test.of_course(t.course_id))',
  'public.phone_report': 'rls_test.of_course(t.course_id)',
  'public.phone_report_student': 'rls_test.of_phone_report(t.report_id)',
  'public.photo_check_log': 'rls_test.of_course(t.course_id)',
  'public.photo_keep_check': 'rls_test.of_course(t.course_id)',
  'public.question': 'rls_test.of_questionnaire(t.questionnaire_id)',
  'public.questionnaire': 'rls_test.of_course(t.course_id)',
  'public.reflection': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.report_config': 'rls_test.of_course(t.course_id)',
  'public.report_issue': 'rls_test.of_course(t.course_id)',
  'public.report_issue_student': 'rls_test.of_report_issue(t.issue_id)',
  'public.report_template': 't.teacher_id',
  'public.response': 'rls_test.of_questionnaire(t.questionnaire_id)',
  'public.revision_request': 'rls_test.of_course(t.course_id)',
  'public.rubric': 'rls_test.of_course(t.course_id)',
  'public.rubric_check_score': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.rubric_print': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.rubric_score': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.rubric_tag': 'rls_test.of_rubric(t.rubric_id)',
  'public.score': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.score_audit': 'rls_test.of_score(t.score_id)',
  'public.section': 'rls_test.of_course(t.course_id)',
  'public.section_override': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.student': 't.teacher_id',
  'public.student_access_code': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.student_card': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.subject': 'rls_test.of_course(t.course_id)',
  'public.submission': 'rls_test.of_course(t.course_id)',
  'public.submission_file': 'rls_test.of_submission(t.submission_id)',
  'public.submission_file_removal': 'rls_test.of_course(t.course_id)',
  'public.support_report': 't.teacher_id',
  'public.tag': 'rls_test.of_section(t.section_id)',
  'public.tag_score': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.teacher': 't.id',
  'public.teacher_preference': 't.teacher_id',
  'public.term_rating': 'rls_test.of_enrollment(t.enrollment_id)',
  'public.term_rating_assessment': 'rls_test.of_term_rating(t.term_rating_id)',
  'public.term_rating_audit': 'rls_test.of_term_rating(t.term_rating_id)',
  'public.term_rating_dimension': 'rls_test.of_term_rating(t.term_rating_id)',
  'public.term_rating_growth_area': 'rls_test.of_term_rating(t.term_rating_id)',
  'public.term_rating_observation': 'rls_test.of_term_rating(t.term_rating_id)',
  'public.term_rating_strength': 'rls_test.of_term_rating(t.term_rating_id)',
  'student_submit.attempt': 'rls_test.of_course(t.course_id)',
  'student_submit.device_session': 'rls_test.of_device_session(t.id)',
  'student_submit.device_session_enrollment': 'rls_test.of_enrollment(t.enrollment_id)',
  'student_submit.send_log': 'rls_test.of_card(t.card_id)',
  'student_submit.session': 'rls_test.of_access_code(t.code_id)',
  'student_submit.write_log': 'rls_test.of_card(t.card_id)',
};

export const NO_TEACHER = {
  'public.questionnaire_template': {
    read: 'all',
    reason: 'The shared list of term questionnaire templates. Every teacher reads it; no teacher may change it.',
  },
  'student_submit.card_key': {
    read: 'none',
    reason: 'One row: the id of the key the student cards are signed with. Only the student page server uses it.',
  },
};
