-- Batch C, first file (2026111120_markup_reflect_revise.sql): the read-only
-- check to run on gradebook-prod BEFORE the apply. It reads the catalog and
-- counts nothing about any student. Expected: no rows. Each row is one
-- thing that would stop the apply, or that differs from the database the
-- tests ran on.
--
-- The fingerprint lists are written by batch_c_fingerprints.py from a
-- database built as live is with Batch B applied; never copied by hand.
with relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/batch_c_fingerprints.py)
    ('public.fv_owns_course(uuid)',                                                         'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_owns_enrollment(uuid)',                                                     '728526648388367393162be706f7f9ea'),
    ('public.fv_owns_assessment(uuid)',                                                     '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)',                                                     '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)',                                               '6d0b48c458d273a332db39e1a4b68626'),
    ('public._fv_timezone(text)',                                                           '8dbcb5716f155e2441f47416a0b28527'),
    ('public._fv_date(text)',                                                               '0dcf865b5254cf0f9535df0fac1cb8a4'),
    ('public._grade_return_lock(uuid)',                                                     '530dca441198b1546a4ec4967cd83b9f'),
    ('public._grade_return_lock_first(uuid)',                                               '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._grade_return_holds(uuid)',                                                    '51d6525109333424405e826bbc303b90'),
    ('public._grade_copy(uuid,uuid)',                                                       '3a8e0dfbc873176692a1160150a8d43b'),
    ('public._grade_copy_in_use(jsonb,uuid)',                                               'befe9f034ce927b2abdf8c8825c402bd'),
    ('public.return_grades(uuid,uuid[],uuid)',                                              '7f38e838fd64a648e230ab232c5cce28'),
    ('student_submit._session_class(text,uuid)',                                            '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._device_session(text)',                                                'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._card_refusal(uuid)',                                                  'cb88af0a6bf62c22ff6c636b291b1a25'),
    ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
    ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
    ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
    ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
    ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
    ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
    ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
    ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
    ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
    ('public._submission_file_removed()',                                                   'edc99e4c04baefcf83b9ce3c94723023'),
    ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
    ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
    ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'c8c5c26be1758ec2e07fe73a68731159'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               '286e463dca1842c2586a93c77fb93456'),
    ('student_submit.unsend(text,uuid,uuid,text)',                                          '68665f35e1678f1bba64d30c082409d8')
    -- FINGERPRINTS-END
), replaced(fn, md5) as (values
    -- FINGERPRINTS-BEGIN replbefore (written by migrations/local-test/batch_c_fingerprints.py)
    ('student_submit._grading_started(uuid,uuid)', '720b9f044b853b5c57b04bec7f59010c')
    -- FINGERPRINTS-END
), absent(fn, md5) as (values
    -- FINGERPRINTS-BEGIN absent (written by migrations/local-test/batch_c_fingerprints.py)
    ('public._work_feedback_gone()',                                       'absent'),
    ('public._work_feedback_truncated()',                                  'absent'),
    ('public._markup_check(jsonb)',                                        'absent'),
    ('public._markup_give(uuid,uuid)',                                     'absent'),
    ('public._revision_hide_available()',                                  'absent'),
    ('public._revision_hide_grade(uuid)',                                  'absent'),
    ('public._revision_unhide_grade(uuid)',                                'absent'),
    ('public._piece_latest(uuid,uuid)',                                    'absent'),
    ('public._revision_state(uuid)',                                       'absent'),
    ('public._revision_settle(uuid,uuid)',                                 'absent'),
    ('public._revision_json(uuid)',                                        'absent'),
    ('public._reflection_json(uuid)',                                      'absent'),
    ('public.set_course_feedback_options(uuid,jsonb,uuid)',                'absent'),
    ('public.save_markup(uuid,jsonb,integer,uuid)',                        'absent'),
    ('public.list_assessment_markup(uuid)',                                'absent'),
    ('public.return_work(uuid,uuid[],uuid)',                               'absent'),
    ('public.return_for_revision(uuid,uuid,jsonb,uuid)',                   'absent'),
    ('public.set_revision_request(uuid,jsonb,uuid)',                       'absent'),
    ('public.cancel_revision(uuid,uuid)',                                  'absent'),
    ('public.answer_reflection(uuid,text,uuid,boolean)',                   'absent'),
    ('public.list_course_feedback(uuid)',                                  'absent'),
    ('student_submit._group_members(uuid,uuid)',                           'absent'),
    ('student_submit.feedback(text,uuid,text)',                            'absent'),
    ('student_submit.markup(text,uuid,uuid,text)',                         'absent'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)',                  'absent'),
    ('student_submit.reply(text,uuid,uuid,jsonb,text)',                    'absent'),
    ('student_submit.answer_seen(text,uuid,uuid[],text)',                  'absent'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', 'absent'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',          'absent'),
    ('student_submit.revision_unsend(text,uuid,uuid,text)',                'absent'),
    ('student_submit.group_work(text,uuid,text)',                          'absent'),
    ('student_submit.group_file_links(text,uuid,uuid,text)',               'absent')
    -- FINGERPRINTS-END
)
select 'a function Batch C calls differs from the tested one' as problem, r.fn as detail,
       coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') as found, r.md5 as expected
  from relied r
 where coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') <> r.md5
union all
select 'the function Batch C replaces differs from the tested one', r.fn,
       coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent'), r.md5
  from replaced r
 where coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') <> r.md5
union all
select 'a name Batch C makes is taken', a.fn, 'present', 'absent'
  from absent a where to_regprocedure(a.fn) is not null
union all
select 'a table Batch C makes exists', t, 'present', 'absent'
  from unnest(array['public.markup', 'public.revision_request', 'public.feedback_reflection']) t
 where to_regclass(t) is not null
union all
select 'a column Batch C adds exists', 'course.' || a.attname, 'present', 'absent'
  from pg_attribute a
 where a.attrelid = 'public.course'::regclass and not a.attisdropped and a.attname in ('reflect_on_feedback', 'show_my_learning')
union all
select 'Batch B is not applied', t, 'absent', 'present'
  from unnest(array['public.submission', 'public.submission_file', 'student_submit.send_log']) t
 where to_regclass(t) is null
union all
select 'Batch B''s columns Batch C reads are missing', 'assessment.' || c, 'absent', 'present'
  from unnest(array['students_see_markup', 'group_work', 'students_send']) c
 where not exists (select 1 from pg_attribute a where a.attrelid = 'public.assessment'::regclass and a.attname = c and not a.attisdropped)
union all
select 'a trigger name Batch C makes is taken', t.tgrelid::regclass::text || '.' || t.tgname, 'present', 'absent'
  from pg_trigger t
 where not t.tgisinternal and t.tgname in ('work_feedback_gone', 'work_feedback_truncate')
union all
select 'the server is not PostgreSQL 17', current_setting('server_version'), current_setting('server_version_num'), '17xxxx'
 where current_setting('server_version_num')::int / 10000 <> 17;
