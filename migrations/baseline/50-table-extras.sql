-- Printed by scripts/db-baseline.sql from gradebook-prod's system catalogs.
-- Don't edit by hand: refresh it with the Database baseline workflow (docs/database-rebuild.md).
create policy answer_via_response on public.answer as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.response r
  WHERE ((r.id = answer.response_id) AND public.fv_owns_enrollment(r.enrollment_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.response r
  WHERE ((r.id = answer.response_id) AND public.fv_owns_enrollment(r.enrollment_id)))));
create policy assessment_via_course on public.assessment as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy assessment_resource_read on public.assessment_resource as permissive for select to authenticated
  using (public.fv_owns_assessment(assessment_id));
create policy assessment_tag_via_assessment on public.assessment_tag as permissive for all to public
  using (public.fv_owns_assessment(assessment_id))
  with check (public.fv_owns_assessment(assessment_id));
create policy attendance_via_enrollment on public.attendance as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy category_via_course on public.category as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy comment_template_self on public.comment_template as permissive for all to authenticated
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy competency_descriptor_self on public.competency_descriptor as permissive for all to public
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy competency_group_via_course on public.competency_group as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy core_self_assessment_via_enrollment on public.core_self_assessment as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy course_owner on public.course as permissive for all to public
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy course_sync_cursor_via_course on public.course_sync_cursor as permissive for select to public
  using (public.fv_owns_course(course_id));
create policy criterion_via_rubric on public.criterion as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.rubric r
  WHERE ((r.id = criterion.rubric_id) AND public.fv_owns_course(r.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.rubric r
  WHERE ((r.id = criterion.rubric_id) AND public.fv_owns_course(r.course_id)))));
create policy criterion_check_via_parents on public.criterion_check as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM (public.criterion cr
     JOIN public.rubric r ON ((r.id = cr.rubric_id)))
  WHERE ((cr.id = criterion_check.criterion_id) AND public.fv_owns_course(r.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM (public.criterion cr
     JOIN public.rubric r ON ((r.id = cr.rubric_id)))
  WHERE ((cr.id = criterion_check.criterion_id) AND public.fv_owns_course(r.course_id)))));
create policy criterion_tag_via_parents on public.criterion_tag as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM (public.criterion cr
     JOIN public.rubric r ON ((r.id = cr.rubric_id)))
  WHERE ((cr.id = criterion_tag.criterion_id) AND public.fv_owns_course(r.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM (public.criterion cr
     JOIN public.rubric r ON ((r.id = cr.rubric_id)))
  WHERE ((cr.id = criterion_tag.criterion_id) AND public.fv_owns_course(r.course_id)))));
create policy custom_tag_via_course on public.custom_tag as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy dibels_score_same_class on public.dibels_score as permissive for all to public
  using (public.fv_owns_score_cell(enrollment_id, assessment_id))
  with check (public.fv_owns_score_cell(enrollment_id, assessment_id));
create policy enrollment_via_course on public.enrollment as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy fv_idempotency_self on public.fv_idempotency as permissive for select to public
  using ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy goal_via_enrollment on public.goal as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy grade_return_read on public.grade_return as permissive for select to public
  using (public.fv_owns_enrollment(enrollment_id));
create policy guardian_owner on public.guardian as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.student s
  WHERE ((s.id = guardian.student_id) AND (s.teacher_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.student s
  WHERE ((s.id = guardian.student_id) AND (s.teacher_id = ( SELECT auth.uid() AS uid))))));
create policy module_via_course on public.module as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy note_via_enrollment on public.note as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy observation_via_course on public.observation as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy observation_custom_tag_via_obs on public.observation_custom_tag as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.observation o
  WHERE ((o.id = observation_custom_tag.observation_id) AND public.fv_owns_course(o.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.observation o
  WHERE ((o.id = observation_custom_tag.observation_id) AND public.fv_owns_course(o.course_id)))));
create policy observation_student_via_obs on public.observation_student as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.observation o
  WHERE ((o.id = observation_student.observation_id) AND public.fv_owns_course(o.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.observation o
  WHERE ((o.id = observation_student.observation_id) AND public.fv_owns_course(o.course_id)))));
create policy observation_tag_via_obs on public.observation_tag as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.observation o
  WHERE ((o.id = observation_tag.observation_id) AND public.fv_owns_course(o.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.observation o
  WHERE ((o.id = observation_tag.observation_id) AND public.fv_owns_course(o.course_id)))));
create policy observation_template_own on public.observation_template as permissive for all to public
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy phone_report_via_course on public.phone_report as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy phone_report_student_via_report on public.phone_report_student as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.phone_report r
  WHERE ((r.id = phone_report_student.report_id) AND public.fv_owns_course(r.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.phone_report r
  WHERE ((r.id = phone_report_student.report_id) AND public.fv_owns_course(r.course_id)))));
create policy question_via_questionnaire on public.question as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.questionnaire q
  WHERE ((q.id = question.questionnaire_id) AND public.fv_owns_course(q.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.questionnaire q
  WHERE ((q.id = question.questionnaire_id) AND public.fv_owns_course(q.course_id)))));
create policy questionnaire_via_course on public.questionnaire as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy questionnaire_template_read on public.questionnaire_template as permissive for select to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy reflection_via_enrollment on public.reflection as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy report_config_via_course on public.report_config as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy report_issue_owner on public.report_issue as permissive for all to authenticated
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy report_issue_student_owner on public.report_issue_student as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.report_issue i
  WHERE ((i.id = report_issue_student.issue_id) AND public.fv_owns_course(i.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.report_issue i
  WHERE ((i.id = report_issue_student.issue_id) AND public.fv_owns_course(i.course_id)))));
create policy report_template_self on public.report_template as permissive for all to authenticated
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy response_via_enrollment on public.response as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy rubric_via_course on public.rubric as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy rubric_check_score_same_class on public.rubric_check_score as permissive for all to public
  using (public.fv_owns_score_cell(enrollment_id, assessment_id))
  with check (public.fv_owns_rubric_check_cell(enrollment_id, assessment_id, check_id));
create policy rubric_print_via_enrollment on public.rubric_print as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy rubric_score_same_class on public.rubric_score as permissive for all to public
  using (public.fv_owns_score_cell(enrollment_id, assessment_id))
  with check (public.fv_owns_rubric_score_cell(enrollment_id, assessment_id, criterion_id));
create policy rubric_tag_via_parents on public.rubric_tag as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.rubric r
  WHERE ((r.id = rubric_tag.rubric_id) AND public.fv_owns_course(r.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM ((public.rubric r
     JOIN public.tag t ON ((t.id = rubric_tag.tag_id)))
     JOIN public.section s ON ((s.id = t.section_id)))
  WHERE ((r.id = rubric_tag.rubric_id) AND (s.course_id = r.course_id) AND public.fv_owns_course(r.course_id)))));
create policy score_same_class on public.score as permissive for all to public
  using (public.fv_owns_score_cell(enrollment_id, assessment_id))
  with check (public.fv_owns_score_cell(enrollment_id, assessment_id));
create policy score_audit_read on public.score_audit as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM public.score s
  WHERE ((s.id = score_audit.score_id) AND public.fv_owns_enrollment(s.enrollment_id)))));
create policy section_via_course on public.section as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy section_override_via_enrollment on public.section_override as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy student_owner on public.student as permissive for all to public
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy student_access_code_via_enrollment on public.student_access_code as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy subject_via_course on public.subject as permissive for all to public
  using (public.fv_owns_course(course_id))
  with check (public.fv_owns_course(course_id));
create policy support_report_insert_own on public.support_report as permissive for insert to authenticated
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy tag_via_section on public.tag as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM public.section s
  WHERE ((s.id = tag.section_id) AND public.fv_owns_course(s.course_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.section s
  WHERE ((s.id = tag.section_id) AND public.fv_owns_course(s.course_id)))));
create policy tag_score_same_class on public.tag_score as permissive for all to public
  using (public.fv_owns_score_cell(enrollment_id, assessment_id))
  with check (public.fv_owns_tag_score_cell(enrollment_id, assessment_id, tag_id));
create policy teacher_self on public.teacher as permissive for all to public
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));
create policy teacher_preference_self on public.teacher_preference as permissive for all to public
  using ((teacher_id = ( SELECT auth.uid() AS uid)))
  with check ((teacher_id = ( SELECT auth.uid() AS uid)));
create policy term_rating_via_enrollment on public.term_rating as permissive for all to public
  using (public.fv_owns_enrollment(enrollment_id))
  with check (public.fv_owns_enrollment(enrollment_id));
create policy term_rating_assessment_via_tr on public.term_rating_assessment as permissive for all to public
  using (public.fv_owns_term_rating(term_rating_id))
  with check (public.fv_owns_term_rating(term_rating_id));
create policy term_rating_audit_read on public.term_rating_audit as permissive for select to public
  using (public.fv_owns_term_rating(term_rating_id));
create policy term_rating_dimension_via_tr on public.term_rating_dimension as permissive for all to public
  using (public.fv_owns_term_rating(term_rating_id))
  with check (public.fv_owns_term_rating(term_rating_id));
create policy term_rating_growth_area_via_tr on public.term_rating_growth_area as permissive for all to public
  using (public.fv_owns_term_rating(term_rating_id))
  with check (public.fv_owns_term_rating(term_rating_id));
create policy term_rating_observation_via_tr on public.term_rating_observation as permissive for all to public
  using (public.fv_owns_term_rating(term_rating_id))
  with check (public.fv_owns_term_rating(term_rating_id));
create policy term_rating_strength_via_tr on public.term_rating_strength as permissive for all to public
  using (public.fv_owns_term_rating(term_rating_id))
  with check (public.fv_owns_term_rating(term_rating_id));
alter table public.grade_return_repair_log alter column id add generated always as identity (sequence name public.grade_return_repair_log_id_seq start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1);
alter table public.photo_check_log alter column id add generated always as identity (sequence name public.photo_check_log_id_seq start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1);
alter table public.submission_file_removal alter column id add generated always as identity (sequence name public.submission_file_removal_id_seq start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1);
alter table student_submit.attempt alter column id add generated always as identity (sequence name student_submit.attempt_id_seq start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1);
alter table student_submit.send_log alter column id add generated always as identity (sequence name student_submit.send_log_id_seq start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1);
alter table student_submit.write_log alter column id add generated always as identity (sequence name student_submit.write_log_id_seq start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1);
alter publication supabase_realtime add table public.course_sync_cursor;
CREATE TRIGGER fv_teacher_sign_in_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public._fv_teacher_sign_in_deleted();
create policy fv_handouts_read on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'student-photos'::text) AND fv_private.handout_read_allowed(name)));
create policy fv_handouts_upload on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'student-photos'::text) AND fv_private.handout_upload_allowed(name)));
create policy fv_student_photos_fence on storage.objects as restrictive for all to authenticated
  using (((bucket_id IS DISTINCT FROM 'student-photos'::text) OR fv_private.work_read_allowed(name) OR fv_private.handout_read_allowed(name)))
  with check (((bucket_id IS DISTINCT FROM 'student-photos'::text) OR fv_private.work_upload_allowed(name) OR fv_private.handout_upload_allowed(name)));
create policy fv_student_photos_read on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'student-photos'::text) AND fv_private.work_read_allowed(name)));
create policy fv_student_photos_teachers_only on storage.objects as restrictive for all to public
  using (((bucket_id IS DISTINCT FROM 'student-photos'::text) OR (CURRENT_USER = 'authenticated'::name)))
  with check (((bucket_id IS DISTINCT FROM 'student-photos'::text) OR (CURRENT_USER = 'authenticated'::name)));
create policy fv_student_photos_upload on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'student-photos'::text) AND fv_private.work_upload_allowed(name)));
create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable();
