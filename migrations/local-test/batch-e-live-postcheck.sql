-- BATCH E, AFTER THE APPLY. Read-only: one query for gradebook-prod, to run
-- right after migrations/2026111150_student_page_last_changes.sql. It
-- changes nothing and reads no student's row.
-- migrations/local-test/batch_e.py runs it on the local stand-in, before
-- the file (it lists what is missing) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the file should
-- have left it. It proves the seven new functions and the eleven replaced
-- ones are the ones tested; the functions they rely on (the slip's own
-- among them) are untouched; who may run each; write_log has row security
-- on and no grant to the API; grade_return has its two columns; and no
-- SECURITY DEFINER function lost pg_temp. Written by
-- migrations/local-test/batch_e.py, never by hand.
--
-- AFTER THIS FILE, USE THIS POST-CHECK. Batch D's post-check lists
-- student_submit.work and send_paths as changed, and C1's the student
-- functions this file replaces: expected, not a fault.
with relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('student_submit._session_class(text,uuid)',              '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._send_session(text,uuid)',               'c39242f54850eeeada19945ac8123644'),
    ('student_submit._group_members(uuid,uuid)',              'b38b1af6f2dc142c94ce1cca454fd0fb'),
    ('student_submit._grading_started(uuid,uuid)',            '586a6a0b5910e6c153b72e73a5b672bc'),
    ('student_submit._work_window(uuid)',                     '767795b7835e3c4d6cb628c76df8e6eb'),
    ('public._grade_return_lock_first(uuid)',                 '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._fv_timezone(text)',                             '8dbcb5716f155e2441f47416a0b28527'),
    ('public._work_hold()',                                   'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._work_bucket()',                                 '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_upload_json(uuid)',                        '63982ca7888b11ce9b80e962f674c98a'),
    ('public._revision_state(uuid)',                          '894bb53b0ad066e21f36c3a8038d5c6c'),
    ('public._grade_copy_in_use(jsonb,uuid)',                 'befe9f034ce927b2abdf8c8825c402bd'),
    ('student_submit._closed_reason(questionnaire,text)',     '118a059d7d73c56cc15bf07ff17c9389'),
    ('student_submit._part(uuid)',                            'b008fc4bee310de623de95e0296678f7'),
    ('student_submit._clean_answer(text,jsonb,text[],jsonb)', '0f8377c8b45d14bc5c1b93c04852e49d'),
    ('public.fv_owns_enrollment(uuid)',                       '728526648388367393162be706f7f9ea'),
    ('public.fv_idem_check(uuid,text)',                       '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)',                 '6d0b48c458d273a332db39e1a4b68626'),
    ('student_submit.open(text,text)',                        'd11b2e67cbf10cae4d44ae6082fd8e01'),
    ('student_submit.verify(text,text,text,text,text)',       '901e62bdb5d94a9ffcebe33563425ad7'),
    ('student_submit."check"(text,text,text)',                'cc54e80ca585024c65926cb5e73f3f43'),
    ('student_submit.submit(text,jsonb,text)',                '90ace3c164dab19f6a77ba7dfb19e40e'),
    ('student_submit._payload(uuid)',                         '7382a387265a87a32c6e4f22f0b1a898')
    -- FINGERPRINTS-END
), replaces(fn, before, becomes) as (values
    -- FINGERPRINTS-BEGIN replaces
    ('student_submit.work(text,uuid,text)',                  '2ec445c5d5afadb7c3fc1699d9929e52', '9e237f6e19649807b64aa6dc870de3f3'),
    ('student_submit.send_paths(text,uuid,uuid,text)',       '2f36c08b8ace950b9c7eb905b320aa40', '25ced0f7757967dc79ab1a9ce465009d'),
    ('student_submit.markup(text,uuid,uuid,text)',           '6cc78118aa4e98252514826aabf957a9', '754e27d5088fd0053bac3edba94c445d'),
    ('student_submit.feedback(text,uuid,text)',              '4ee8ebfb4b2af25698d2fb3eafc7f9ea', '1b90f53ea0d838acae50da7639e8c935'),
    ('student_submit.group_file_links(text,uuid,uuid,text)', '1c034fa5647b5808209b0ef9b31e8e4d', '5f15b29dd67898c3339e57e694b42edd'),
    ('student_submit.file_links(text,uuid,uuid,text)',       '99ef3b9e89574fae0a230c4464998baf', '1bd03e7e959fc7ff127bc9602badc283'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)',    '7a4e2ab29d369ef159dce65e1e1e8f77', '9e62c67308321d3dd4095db16e2ad8e1'),
    ('student_submit.reply(text,uuid,uuid,jsonb,text)',      '264a736a722cf19022c20c343ecb01fb', 'c62efad49630d212de8357e64a23088f'),
    ('student_submit.answer_seen(text,uuid,uuid[],text)',    'da85d013a0511618c989d7bb44eac2f3', '360aa4c1fe8e0e0d860284cb3809c943'),
    ('public.save_score_report_note(uuid,uuid,text,uuid)',   '7b230f6d11458a7660e23c80f8829b95', '0278137275a8a15e973648c855643447'),
    ('public.list_course_grade_returns(uuid)',               'bc5529a69303cdfe8d91604388dc927a', '0779f1e345fb278fd8702592163784c1')
    -- FINGERPRINTS-END
), new(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN new
    ('student_submit._write_limit(uuid,text,integer)',   'c2edfa96402a2eb7a839db3c106e11a9'),
    ('fv_private.report_note_hold(uuid,uuid)',           'f3ded8cae1f22c24b15fa2f7ba55427f'),
    ('student_submit._card_listed(uuid,uuid)',           'a0dc2d9e540be764da89a98e83751260'),
    ('student_submit.forms(text,uuid,text)',             '40ae918432795a5effbdd4cf6efead15'),
    ('student_submit.form(text,uuid,uuid,text)',         '8a2fcc6954bd63425d9460dea9800f26'),
    ('student_submit.answer(text,uuid,uuid,jsonb,text)', 'd625cba1843c7b409a5cb8743c7471fd'),
    ('student_submit.report(text,uuid,uuid,text)',       'd009be8b73801173f816d9a5db036b42')
    -- FINGERPRINTS-END
), student(fn) as (values
    ('student_submit.forms(text,uuid,text)'), ('student_submit.form(text,uuid,uuid,text)'),
    ('student_submit.answer(text,uuid,uuid,jsonb,text)'), ('student_submit.report(text,uuid,uuid,text)'),
    ('student_submit.work(text,uuid,text)'), ('student_submit.send_paths(text,uuid,uuid,text)'),
    ('student_submit.markup(text,uuid,uuid,text)'), ('student_submit.feedback(text,uuid,text)'),
    ('student_submit.group_file_links(text,uuid,uuid,text)'), ('student_submit.file_links(text,uuid,uuid,text)'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)'), ('student_submit.reply(text,uuid,uuid,jsonb,text)'),
    ('student_submit.answer_seen(text,uuid,uuid[],text)')
), helper(fn) as (values
    ('student_submit._write_limit(uuid,text,integer)'), ('student_submit._card_listed(uuid,uuid)')
), found as (
    select 'relied on: ' || fn as what, md5 as expected,
           coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found
      from relied where fn <> 'public.no_such_function_at_all()'
    union all
    select 'replaced: ' || fn, becomes, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
      from replaces where fn <> 'public.no_such_function_at_all()'
    union all
    select 'new: ' || fn, becomes, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
      from new where fn <> 'public.no_such_function_at_all()'
    union all
    select 'who can run ' || s.fn || ' (' || r.role || ')', case when r.role = 'service_role' then 'yes' else 'no' end,
           case when to_regprocedure(s.fn) is not null and has_function_privilege(r.role, to_regprocedure(s.fn), 'execute') then 'yes' else 'no' end
      from student s cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
    union all
    select 'who can run ' || h.fn || ' (' || r.role || ')', 'no',
           case when to_regprocedure(h.fn) is not null and has_function_privilege(r.role, to_regprocedure(h.fn), 'execute') then 'yes' else 'no' end
      from helper h cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
    union all
    select 'who can run fv_private.report_note_hold (anon)', 'no',
           case when to_regprocedure('fv_private.report_note_hold(uuid,uuid)') is not null
                 and has_function_privilege('anon', to_regprocedure('fv_private.report_note_hold(uuid,uuid)'), 'execute') then 'yes' else 'no' end
    union all
    select 'student_submit.write_log: row security on, no grant to anon or authenticated', 'yes',
           case when to_regclass('student_submit.write_log') is not null
                 and (select relrowsecurity from pg_class where oid = to_regclass('student_submit.write_log'))
                 and not has_table_privilege('anon', to_regclass('student_submit.write_log'), 'select')
                 and not has_table_privilege('authenticated', to_regclass('student_submit.write_log'), 'select') then 'yes' else 'no' end
    union all
    select 'grade_return has held_note and held_note_at', '2',
           (select count(*) from pg_attribute where attrelid = 'public.grade_return'::regclass
             and attname in ('held_note', 'held_note_at') and not attisdropped)::text
    union all
    select 'SECURITY DEFINER functions without pg_temp last', '0',
           (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
               and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$'))::text
)
select what, expected, found from found where expected <> found order by 1;
