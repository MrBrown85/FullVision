-- BATCH B, AFTER THE APPLY. Read-only: one query for gradebook-prod, to run
-- right after migrations/2026111101_student_work_submissions.sql and
-- migrations/2026111102_student_work_storage.sql are applied. It changes
-- nothing. migrations/local-test/submissions.py runs it on the local
-- stand-in, before the two files (it lists what is missing) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the two files
-- should have left it: what it is, what was expected, what was found.
--
-- It proves the apply landed: every function is the one tested (md5 of
-- pg_get_functiondef, from the local harness on PostgreSQL 17.11), and the
-- live functions they call are untouched; the four tables are there with
-- row security on, no policy, and nothing readable or writable through the
-- API; who can run what; the triggers; the new columns with their defaults;
-- the bucket, private, 2 MB, JPEG only; the four policies on
-- storage.objects, word for word, and no other; no SECURITY DEFINER
-- function lost pg_temp.
--
-- Two rows are expected to appear LATER and are then no fault: "classes
-- with Send Work on" and "assessments that take work" count what teachers
-- have turned on. Right after the apply there are none.
with tested(fn, md5) as (values
    -- FINGERPRINTS-BEGIN new
    ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
    ('public._work_object(text)',                                                           'e52420e0be52353b1208dbc395ae9e5c'),
    ('public._work_check_pages(jsonb)',                                                     '4f17b090aea75e8d9d9b296f99f0f5a8'),
    ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
    ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '57e75c6fa0bbbd12a04e11d21752bc5b'),
    ('public._work_files_state(uuid,jsonb)',                                                '975d75466b7b1dd7100240028441bea8'),
    ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
    ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
    ('public._submission_json(uuid)',                                                       '2d20f60def0f309725f16b7b86477fab'),
    ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
    ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
    ('public._submission_file_removed()',                                                   'edc99e4c04baefcf83b9ce3c94723023'),
    ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
    ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
    ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
    ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
    ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
    ('public.list_course_submissions(uuid)',                                                '8703f5ddc09b3c8dc92aa70878b5d7b1'),
    ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 'ef4590b75c38b428fcdb81b92a2407f3'),
    ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'd62a6e550d7535f123f58b17cfe838f2'),
    ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '1a966bceb2e46eb59107e2753e731bd4'),
    ('public.delete_submission(uuid,uuid)',                                                 '7da38ac3304aaf2f9639877b3fd0f81a'),
    ('public.rotate_submission_page(uuid,integer,uuid)',                                    'e684b853403b25a1706d29f02a581d5c'),
    ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
    ('fv_private.work_upload_allowed(text)',                                                '02b678a47cb50ef6bf233a0ff244b51c'),
    ('fv_private.work_read_allowed(text)',                                                  'd5462a39d4090cdd6c2d1e8df067729c'),
    ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
    ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
    ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '247b8c12e04333451ae7821a2344a30e'),
    ('student_submit.work(text,uuid,text)',                                                 '72233e7985f93eb6a150c1822ed69d14'),
    ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
    ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               'c20e5a7beae5343f50b968368dfae8c6'),
    ('student_submit.unsend(text,uuid,uuid,text)',                                          '719b3aef45f8946343138924b84a03e9'),
    ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
    ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
    ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
    -- FINGERPRINTS-END
), untouched(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('public.fv_owns_course(uuid)',              'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_owns_enrollment(uuid)',          '728526648388367393162be706f7f9ea'),
    ('public.fv_owns_assessment(uuid)',          '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)',          '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)',    '6d0b48c458d273a332db39e1a4b68626'),
    ('public._fv_timezone(text)',                '8dbcb5716f155e2441f47416a0b28527'),
    ('public._fv_date(text)',                    '0dcf865b5254cf0f9535df0fac1cb8a4'),
    ('public._grade_return_lock(uuid)',          '530dca441198b1546a4ec4967cd83b9f'),
    ('public._grade_return_lock_first(uuid)',    '4d85813e08aaeb108cda95d85f3d66e4'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._device_session(text)',     'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._card_refusal(uuid)',       'cb88af0a6bf62c22ff6c636b291b1a25')
    -- FINGERPRINTS-END
), fn_found as (
    select e.fn, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') as is_now
      from (select * from tested union all select * from untouched) e
), run_by(fn, who) as (
    -- which of the public, anon, signed-in teachers and the service role may run each function
    select t.fn, coalesce((select string_agg(r, ', ' order by r)
                             from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                            where to_regprocedure(t.fn) is not null and has_function_privilege(r, to_regprocedure(t.fn), 'execute')), 'nobody')
      from tested t
), run_want(fn, who) as (
    select t.fn,
           case when t.fn in ('public.set_course_send_work(uuid,jsonb,uuid)', 'public.set_assessment_student_work(uuid,jsonb,uuid)',
                              'public.list_course_submissions(uuid)', 'public.start_work_upload(uuid,uuid,jsonb,text,uuid)',
                              'public.finish_work_upload(uuid,jsonb,uuid)', 'public.mark_handed_in_paper(uuid,uuid[],uuid)',
                              'public.delete_submission(uuid,uuid)', 'public.rotate_submission_page(uuid,integer,uuid)',
                              'fv_private.work_path_course(text)', 'fv_private.work_upload_allowed(text)', 'fv_private.work_read_allowed(text)')
                then 'authenticated, service_role'
                when t.fn in ('student_submit.work(text,uuid,text)', 'student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',
                              'student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)', 'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
                              'student_submit.unsend(text,uuid,uuid,text)', 'student_submit.file_links(text,uuid,uuid,text)',
                              'student_submit.removal_batch(integer)', 'student_submit.removal_done(bigint[])')
                then 'service_role'
                -- the helpers and the trigger functions: called by the functions above as their owner
                else 'nobody' end
      from tested t
), tables(t) as (values ('public.submission'), ('public.submission_file'), ('public.submission_file_removal'), ('student_submit.send_log')
), policies(name, cmd, permissive, roles, using_, check_) as (values
    ('fv_student_photos_fence', '*', false, '{authenticated}',
     '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name))',
     '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name))'),
    ('fv_student_photos_read', 'r', true, '{authenticated}',
     '((bucket_id = ''student-photos''::text) AND fv_private.work_read_allowed(name))', ''),
    ('fv_student_photos_teachers_only', '*', false, '{-}',
     '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR (CURRENT_USER = ''authenticated''::name))',
     '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR (CURRENT_USER = ''authenticated''::name))'),
    ('fv_student_photos_upload', 'a', true, '{authenticated}', '',
     '((bucket_id = ''student-photos''::text) AND fv_private.work_upload_allowed(name))')
), triggers(tbl, name) as (values
    ('public.assessment', 'submission_gone'), ('public.assessment', 'submission_truncate'),
    ('public.enrollment', 'submission_gone'), ('public.enrollment', 'submission_truncate'),
    ('public.submission', 'submission_same_class'), ('public.submission', 'submission_target_gone'),
    ('public.submission_file', 'submission_file_removed')
), columns(tbl, col, def) as (values
    ('public.course', 'send_work', 'false'), ('public.course', 'keep_photos_until', '''end_of_year''::text'),
    ('public.assessment', 'students_send', '''nothing''::text'), ('public.assessment', 'after_due', '''keep''::text'),
    ('public.assessment', 'accept_until', ''), ('public.assessment', 'group_work', '''each''::text'),
    ('public.assessment', 'students_see_markup', 'true')
)
select 'function ' || fn as what, md5 as expected, is_now as found
  from fn_found where is_now <> md5
union all
select 'who can run ' || w.fn, w.who, b.who
  from run_want w join run_by b on b.fn = w.fn
 where b.who <> w.who
union all
select 'table ' || t, 'there, with row security on and no policy',
       case when to_regclass(t) is null then 'absent'
            else 'row security ' || (select case when c.relrowsecurity then 'on' else 'off' end from pg_class c where c.oid = to_regclass(t))
                 || ', ' || (select count(*) from pg_policy p where p.polrelid = to_regclass(t)) || ' policies' end
  from tables
 where to_regclass(t) is null
    or not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(t))
    or exists (select 1 from pg_policy p where p.polrelid = to_regclass(t))
union all
select 'what ' || r || ' can do to ' || t || ' through the API', 'nothing',
       (select string_agg(p, ', ') from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p where has_table_privilege(r, to_regclass(t), p))
  from tables cross join unnest(array['anon', 'authenticated']) r
 where to_regclass(t) is not null
   and has_table_privilege(r, to_regclass(t), 'select, insert, update, delete, truncate')
union all
select 'what the service role can do to the removal queue as a table', 'nothing',
       (select string_agg(p, ', ') from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
         where has_table_privilege('service_role', to_regclass('public.submission_file_removal'), p))
 where to_regclass('public.submission_file_removal') is not null
   and has_table_privilege('service_role', to_regclass('public.submission_file_removal'), 'select, insert, update, delete, truncate')
union all
select 'trigger ' || g.name || ' on ' || g.tbl, 'there, switched on',
       coalesce((select 'switched ' || t.tgenabled::text from pg_trigger t where t.tgrelid = to_regclass(g.tbl) and t.tgname = g.name), 'absent')
  from triggers g
 where not exists (select 1 from pg_trigger t where t.tgrelid = to_regclass(g.tbl) and t.tgname = g.name and t.tgenabled = 'O')
union all
select 'column ' || c.tbl || '.' || c.col, 'there, default ' || coalesce(nullif(c.def, ''), 'none'),
       coalesce((select 'default ' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'none')
                   from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = to_regclass(c.tbl) and a.attname = c.col and not a.attisdropped), 'absent')
  from columns c
 where not exists (select 1 from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                    where a.attrelid = to_regclass(c.tbl) and a.attname = c.col and not a.attisdropped
                      and coalesce(pg_get_expr(d.adbin, d.adrelid), '') = c.def)
union all
select 'the bucket student-photos', 'private, 2097152 bytes a file, image/jpeg only',
       coalesce((select 'public ' || coalesce(b.public::text, 'null') || ', limit ' || coalesce(b.file_size_limit::text, 'none')
                        || ', types ' || coalesce(b.allowed_mime_types::text, 'any')
                   from storage.buckets b where b.id = 'student-photos'), 'absent')
 where not exists (select 1 from storage.buckets b
                    where b.id = 'student-photos' and b.public is false and b.file_size_limit = 2097152
                      and b.allowed_mime_types = array['image/jpeg'])
union all
select 'row security on storage.objects', 'on', 'off'
  from pg_class c where c.oid = to_regclass('storage.objects') and not c.relrowsecurity
union all
select 'policy ' || w.name || ' on storage.objects',
       w.cmd || ' ' || w.permissive::text || ' ' || w.roles || ' using ' || w.using_ || ' check ' || w.check_,
       coalesce((select p.polcmd::text || ' ' || p.polpermissive::text || ' ' || p.polroles::regrole[]::text
                        || ' using ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' check ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                   from pg_policy p where p.polrelid = to_regclass('storage.objects') and p.polname = w.name), 'absent')
  from policies w
 where not exists (select 1 from pg_policy p
                    where p.polrelid = to_regclass('storage.objects') and p.polname = w.name and p.polcmd::text = w.cmd
                      and p.polpermissive = w.permissive and p.polroles::regrole[]::text = w.roles
                      and coalesce(pg_get_expr(p.polqual, p.polrelid), '') = w.using_
                      and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = w.check_)
union all
select 'another policy on storage.objects', 'none', p.polname
  from pg_policy p
 where p.polrelid = to_regclass('storage.objects') and p.polname not in (select name from policies)
union all
select 'SECURITY DEFINER without pg_temp last in its search_path', 'none',
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')
union all
select 'classes with Send Work on', '0 right after the apply', count(*)::text
  from public.course where to_regclass('public.submission') is not null and (to_jsonb(course)->>'send_work')::boolean
having count(*) > 0
union all
select 'assessments that take work', '0 right after the apply', count(*)::text
  from public.assessment where to_regclass('public.submission') is not null and to_jsonb(assessment)->>'students_send' <> 'nothing'
having count(*) > 0
 order by 1, 2;
