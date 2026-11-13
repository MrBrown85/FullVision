-- One teacher's class, for the security rule tests (tests/db/run.mjs).
-- Loaded after tests/db/helpers.sql into the throwaway rebuilt database.
--
-- rls_test.seed(id, email, mark) makes a sign-in account, then, acting as
-- that teacher, makes a class through the app's own write functions: two
-- students, an assessment of each scoring kind with scores, a rubric, an
-- observation, a term rating, a goal, a reflection and the rest. Rows the
-- app writes only from the student page or the edge functions are inserted
-- directly as postgres. Every text the teacher types starts with `mark`
-- ('Alpha' or 'Bravo'), so a test can spot the other teacher's words.
-- It answers with the ids it made, by kind.

create function rls_test.seed(p_uid uuid, p_email text, p_mark text) returns jsonb
language plpgsql
as $$
declare
    _claims text := json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text;
    _ids    jsonb := jsonb_build_object('teacher', p_uid);
    _r      jsonb;
    c uuid; subj uuid; st1 uuid; st2 uuid; e1 uuid; e2 uuid; cat uuid; md uuid; cg uuid; sec uuid; tg uuid;
    rub uuid; crit uuid; chk uuid; a_pts uuid; a_prof uuid; a_rub uuid; a_dib uuid; ctag uuid; otpl uuid;
    obs uuid; tr uuid; q uuid; qq uuid; resp uuid; pr uuid; ri uuid; gu uuid; ct uuid; rt uuid; res uuid;
    sec2 uuid; ho uuid; sub2 uuid; sf2 uuid;
    sub uuid; sf uuid; card uuid; code uuid; rr uuid; sc uuid; nt uuid; ds uuid; fr uuid;
    a_grp uuid := gen_random_uuid();
    r_grp uuid := gen_random_uuid();
    hex64 text := encode(sha256(convert_to(p_mark, 'utf8')), 'hex');
begin
    insert into auth.users (id, email) values (p_uid, p_email);

    -- As the teacher, through the app's own functions.
    perform set_config('request.jwt.claims', _claims, true);
    perform set_config('role', 'authenticated', true);

    perform public.bootstrap_teacher(p_email, p_mark || ' Teacher');
    c := public.create_course(p_name => p_mark || ' Science 9', p_subjects => array[p_mark || ' Science'],
                              p_grading_system => 'both', p_idempotency_key => gen_random_uuid());
    select id into subj from public.subject where course_id = c;
    _r := public.create_student_and_enroll(c, p_mark || ' Ada', p_mark || ' Lovelace',
            p_student_number => p_mark || '1001', p_date_of_birth => date '2011-01-01',
            p_idempotency_key => gen_random_uuid());
    st1 := _r->>'student_id'; e1 := _r->>'enrollment_id';
    _r := public.create_student_and_enroll(c, p_mark || ' Bo', p_mark || ' Diddley');
    st2 := _r->>'student_id'; e2 := _r->>'enrollment_id';

    cat := public.upsert_category(null, c, p_mark || ' Tests', 100, 0, gen_random_uuid());
    md := public.upsert_module(null, c, p_mark || ' Unit', '#336699', 0, gen_random_uuid());
    cg := public.upsert_competency_group(null, c, p_mark || ' Group', '#336699', 0, gen_random_uuid());
    sec := public.upsert_section(null, subj, p_mark || ' Questioning', '#336699', cg, 0, gen_random_uuid());
    tg := public.upsert_tag(null, sec, p_mark || ' Ask questions', 'Q1', p_mark || ' I can ask', 0, gen_random_uuid());
    rub := public.upsert_rubric(null, c, p_mark || ' Rubric',
             jsonb_build_array(jsonb_build_object('name', p_mark || ' Criterion',
                 'level_3_descriptor', p_mark || ' Meets', 'linked_tag_ids', jsonb_build_array(tg),
                 'checks', jsonb_build_array(jsonb_build_object('level', 3, 'label', p_mark || ' Check')))),
             r_grp, gen_random_uuid(), 'advanced', jsonb_build_array(tg));
    select id into crit from public.criterion where rubric_id = rub;
    select id into chk from public.criterion_check where criterion_id = crit;

    a_pts := public.create_assessment(c, p_mark || ' Quiz', cat, p_score_mode => 'points', p_max_points => 10,
               p_module_id => md, p_tag_ids => array[tg], p_copy_group => a_grp, p_idempotency_key => gen_random_uuid());
    a_prof := public.create_assessment(c, p_mark || ' Skill', cat, p_tag_ids => array[tg]);
    a_rub := public.create_assessment(c, p_mark || ' Lab', cat, p_rubric_id => rub, p_tag_ids => array[tg]);
    a_dib := public.create_assessment(c, p_mark || ' Reading', p_score_mode => 'dibels');

    perform public.upsert_score(e1, a_pts, 8, null);
    perform public.upsert_score(e1, a_pts, 9, null);
    perform public.save_score_comment(e1, a_pts, p_mark || ' Nice work');
    perform public.save_score_report_note(e1, a_pts, p_mark || ' Report note', gen_random_uuid());
    perform public.upsert_tag_score(e1, a_prof, tg, 3, null, p_mark || ' Tag comment');
    perform public.upsert_rubric_score(e1, a_rub, crit, 3, null, p_mark || ' Rubric comment', null);
    perform public.set_rubric_check(e1, a_rub, chk, true);
    perform public.set_rubric_printed(e1, a_rub, p_mark || 'hash', now(), gen_random_uuid());
    perform public.upsert_dibels_score(e1, a_dib, 'boy', 50, 2, 10, 1);
    select id into sc from public.score where enrollment_id = e1 and assessment_id = a_pts;

    ctag := public.create_custom_tag(c, p_mark || ' Custom', gen_random_uuid());
    otpl := public.upsert_observation_template(null, c, p_mark || ' Template', 'strength', null, 0, gen_random_uuid());
    obs := public.create_observation(c, p_mark || ' Observed', 'strength', null, a_prof, array[e1], array[tg],
             array[ctag], gen_random_uuid(), null, null, otpl);
    perform public.save_term_rating(e1, 1, jsonb_build_object(
        'narrative_html', p_mark || ' Narrative', 'work_habits_rating', 3,
        'dimensions', jsonb_build_array(jsonb_build_object('section_id', sec, 'rating', 3)),
        'strength_tags', jsonb_build_array(tg), 'growth_tags', jsonb_build_array(tg),
        'mention_observations', jsonb_build_array(obs), 'mention_assessments', jsonb_build_array(a_pts)));
    perform public.save_term_attendance(e1, 1, 2, 1);
    select id into tr from public.term_rating where enrollment_id = e1 and term = 1;
    perform public.upsert_goal(e1, sec, p_mark || ' Goal');
    perform public.upsert_reflection(e1, sec, p_mark || ' Reflection', 3);
    perform public.upsert_note(e1, p_mark || ' Note', gen_random_uuid());
    select id into nt from public.note where enrollment_id = e1;
    perform public.upsert_section_override(e1, sec, 3, p_mark || ' Reason');
    perform public.upsert_core_self_assessment(e1, 'CT', 'T1', 3, p_mark || ' Core body', p_mark || ' Core goal');
    perform public.bulk_attendance(array[e1], current_date, 'absent');
    gu := (public.upsert_guardian(st1, p_mark || ' Parent', 'parent', 'parent@example.test', null, 'en',
            null, null, null, gen_random_uuid()))->>'id';
    q := (public.upsert_questionnaire(c, 'about_me', p_mark || ' About Me',
           p_questions => jsonb_build_array(jsonb_build_object('prompt', p_mark || ' Question', 'kind', 'text')),
           p_idempotency_key => gen_random_uuid()))->>'id';
    select id into qq from public.question where questionnaire_id = q limit 1;
    ct := (public.save_comment_template(p_mark || ' did well', '[]'::jsonb, '{}'::jsonb, null, 0, gen_random_uuid()))->>'id';
    rt := (public.save_report_template(p_mark || ' Report', jsonb_build_object('front', '[]'::jsonb), null, gen_random_uuid()))->>'id';
    perform public.save_competency_descriptors(jsonb_build_array(
        jsonb_build_object('key', p_mark || ' competency', 'level', 3, 'text', p_mark || ' Descriptor')));
    perform public.submit_support_report('gradebook', p_mark || ' Help', 'test browser', '1', gen_random_uuid());
    _r := public.create_phone_report(c, 1, p_mark || ' Term 1', current_date + 30,
            jsonb_build_array(jsonb_build_object('enrollment_id', e1, 'data', jsonb_build_object('note', p_mark || ' Phone'))),
            gen_random_uuid());
    select id into pr from public.phone_report where course_id = c;
    _r := public.create_report_issue(c, 1, p_mark || ' Term 1', 'letter', jsonb_build_object('front', '[]'::jsonb),
            jsonb_build_array(jsonb_build_object('enrollment_id', e1, 'html', p_mark || ' Report html')),
            gen_random_uuid());
    select id into ri from public.report_issue where course_id = c;
    perform public.add_assessment_link(a_prof, 'https://example.test/' || p_mark, p_mark || ' Link', gen_random_uuid());
    select id into res from public.assessment_resource where assessment_id = a_prof;
    perform public.return_grades(a_pts, array[e1], gen_random_uuid());
    sec2 := public.upsert_section(null, subj, p_mark || ' Removed', '#336699', cg, 1, gen_random_uuid());
    perform public.remove_section(sec2, gen_random_uuid());

    -- As postgres: rows only the student page or the edge functions write.
    perform set_config('role', 'none', true);

    insert into public.student_card (enrollment_id, code_hmac, pw_hmac, key_id, seq, works_until)
    values (e1, hex64, encode(sha256(convert_to(p_mark || 'pw', 'utf8')), 'hex'), '0000000a', 1, current_date + 30)
    returning id into card;
    insert into public.student_access_code (enrollment_id, questionnaire_id, code_hash, salt, expires_at)
    values (e1, q, md5(p_mark || 'code'), 'salt', now() + interval '30 days')
    returning id into code;
    insert into public.response (questionnaire_id, enrollment_id, via) values (q, e1, 'link') returning id into resp;
    insert into public.answer (response_id, question_id, value_text) values (resp, qq, p_mark || ' Answer');
    insert into public.submission (course_id, assessment_id, enrollment_id, version, state, intent, sent_by, note, sent_at)
    values (c, a_prof, e1, 1, 'sent', 'new', 'student', p_mark || ' Sent', now())
    returning id into sub;
    sf := gen_random_uuid();
    insert into public.submission_file (id, submission_id, page, path, thumb_path, bytes, thumb_bytes, declared_bytes,
                                        declared_thumb_bytes, width, height, sha256, rotation, added_by, link_dies_at)
    values (sf, sub, 1, c || '/' || sub || '/' || sf || '.jpg', c || '/' || sub || '/' || sf || '-thumb.jpg',
            1000, 100, 1000, 100, 800, 600, hex64, 0, 'student', now() + interval '1 day');
    insert into public.markup (file_id, course_id, assessment_id, enrollment_id, working, working_rev, working_at)
    values (sf, c, a_prof, e1, jsonb_build_object('note', p_mark || ' Markup'), 1, now());
    insert into public.markup_kept (file_id, submission_id, course_id, assessment_id, enrollment_id, page, width, height,
                                    rotation, added_by, working, working_rev, working_at, marked_at)
    values (gen_random_uuid(), sub, c, a_prof, e1, 1, 800, 600, 0, 'student',
            jsonb_build_object('note', p_mark || ' Kept'), 1, now(), now());
    insert into public.feedback_reflection (course_id, assessment_id, enrollment_id, makes_sense, question, sent_at)
    values (c, a_prof, e1, 'yes', p_mark || ' Student question', now())
    returning id into fr;
    insert into public.revision_request (course_id, assessment_id, enrollment_id, state, what_to_fix, keep_grade,
                                         first_submission_id, created_by)
    values (c, a_prof, e1, 'open', p_mark || ' Fix this', true, sub, p_uid)
    returning id into rr;
    -- A draft return, and a handout and a teacher's upload both still uploading.
    insert into public.grade_return (enrollment_id, assessment_id, is_draft, returned_at, returned_copy)
    values (e2, a_prof, true, now(), jsonb_build_object('note', p_mark || ' Draft'));
    insert into public.assessment_resource (assessment_id, course_id, kind, title, page_count, status, position)
    values (a_prof, c, 'pdf', p_mark || ' Handout', 2, 'uploading', 1)
    returning id into ho;
    insert into public.submission (course_id, assessment_id, enrollment_id, version, state, intent, sent_by)
    values (c, a_prof, e2, 1, 'sending', 'new', 'teacher')
    returning id into sub2;
    sf2 := gen_random_uuid();
    insert into public.submission_file (id, submission_id, page, path, thumb_path, bytes, thumb_bytes, declared_bytes,
                                        declared_thumb_bytes, width, height, sha256, rotation, added_by, link_dies_at)
    values (sf2, sub2, 1, c || '/' || sub2 || '/' || sf2 || '.jpg', c || '/' || sub2 || '/' || sf2 || '-thumb.jpg',
            1000, 100, 1000, 100, 800, 600, hex64, 0, 'teacher', now() + interval '1 day');
    insert into public.grade_return_repair_log (course_id, sqlstate, message) values (c, '00000', p_mark || ' Log');
    insert into public.photo_check_log (course_id, kind, n, detail) values (c, 'expired', 1, jsonb_build_object('m', p_mark));
    insert into public.photo_keep_check (course_id, checked_through, judged_choice) values (c, current_date, 'end_of_year');
    insert into public.submission_file_removal (bucket, path, course_id, reason, link_dies_at)
    values ('student-photos', c || '/' || p_mark || '-gone.jpg', c, 'test', now());
    insert into student_submit.attempt (route, outcome, ip_hash, code_id, course_id) values ('card', 'ok', p_mark, code, c);
    insert into student_submit.device_session (token_hash, expires_at) values (md5(p_mark || 'device'), now() + interval '1 day')
    returning id into ds;
    insert into student_submit.device_session_enrollment (session_id, enrollment_id, card_id) values (ds, e1, card);
    insert into student_submit.send_log (card_id) values (card);
    insert into student_submit.write_log (card_id, kind) values (card, 'reflect');
    insert into student_submit.session (token_hash, code_id, expires_at) values (md5(p_mark || 'session'), code, now() + interval '1 day');

    return _ids || jsonb_build_object(
        'course', c, 'subject', subj, 'student', st1, 'student2', st2, 'enrollment', e1, 'enrollment2', e2,
        'category', cat, 'module', md, 'competency_group', cg, 'section', sec, 'tag', tg, 'rubric', rub,
        'criterion', crit, 'criterion_check', chk, 'assessment', a_pts, 'assessment_prof', a_prof,
        'assessment_rubric', a_rub, 'assessment_dibels', a_dib, 'score', sc, 'custom_tag', ctag,
        'observation_template', otpl, 'observation', obs, 'term_rating', tr, 'note', nt, 'guardian', gu,
        'questionnaire', q, 'question', qq, 'response', resp, 'comment_template', ct, 'report_template', rt,
        'phone_report', pr, 'report_issue', ri, 'resource', res, 'submission', sub, 'submission_file', sf,
        'student_card', card, 'access_code', code, 'revision_request', rr, 'feedback_reflection', fr,
        'device_session', ds, 'assessment_copy_group', a_grp, 'rubric_copy_group', r_grp,
        'removed_section', sec2, 'handout', ho, 'enrollment2_submission', sub2, 'sending_file', sf2,
        'custom_tag_label', p_mark || ' Custom',
        'idempotency_key', (select key from public.fv_idempotency where teacher_id = p_uid limit 1));
end;
$$;

-- The rows that belong to no one teacher (tests/db/table-owners.mjs, NO_TEACHER).
create function rls_test.seed_shared() returns void
language sql
as $$
    insert into public.questionnaire_template (id, kind, title, questions)
    values ('rls-test-template', 'about_me', 'Shared Template', '[]');
    insert into student_submit.card_key (one, key_id) values (true, '0000000a');
$$;
