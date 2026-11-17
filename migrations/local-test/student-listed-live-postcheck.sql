-- Read-only post-check, after the apply for migrations/2026111702_student_listed_rule.sql (2026-11-17).
-- SELECTs only. Every row says ok.
with want(sig, before_md5, after_md5) as (values
    ('student_submit._session_classes(uuid)', 'f6751bf9a7803a84067df8efad66f490', '35e766379278258651709e73b9f05940'),
    ('student_submit._work_window(uuid)', '07e70e0c63675e895b1db9d6b4d8a472', '904f6388c7f2b65bfb9f093f343100e4'),
    ('student_submit.feedback(text,uuid,text)', '0c01e9f5d2efee024e1592fb8a42b6d8', 'e093fd549255e5f938491066a5e2ea1c'),
    ('student_submit.group_work(text,uuid,text)', '6d1a251fdcc1261129e0c1025c977943', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
    ('student_submit.page(text,uuid,text)', '0508ea6a4e183bac79c18df4a1135917', 'b2781abd6d579e3dc72b3f5f801bb917'),
    ('student_submit.file_links(text,uuid,uuid,text)', 'c977ce3010a3c849110c60195caf2f6e', 'cb91bac98d5d9b4fb27ba72769b1f211'),
    ('student_submit.group_file_links(text,uuid,uuid,text)', 'f7a4bf32ea97c2d1dd11e28e7d9cf117', '6d1929668e5c32090062fbd1025e0699'),
    ('student_submit.handout_links(text,uuid,uuid,text)', '822a5ed9b9433f6ef29af3b8e5856070', '410877d7e4d5b860b8dadb4c1b185f3c'),
    ('student_submit.markup(text,uuid,uuid,text)', '3f4031af1d0bb67e15e27eaae7c275cf', '2296aefc4e38f67aad5722a2637c2fb4'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 'c77950cbe4d79e1f0e73a46d720d9545', '5f65a3ff02460ea810372d172b988b39')),
found as (select w.*, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent') as md5 from want w)
select 'fingerprint ' || sig as check, case when md5 = after_md5 then 'ok' else 'NOT AS EXPECTED: ' || md5 end as value from found
union all select 'fingerprint student_submit._listed(public.assessment,date)', case when md5(pg_get_functiondef(to_regprocedure('student_submit._listed(public.assessment,date)'))) = 'ee5745a778e8ac1cb56f013d1c3e034e' then 'ok' else 'NOT AS EXPECTED' end
union all select 'one student_submit._listed', case when (select count(*) from pg_proc where pronamespace = 'student_submit'::regnamespace and proname = '_listed') = 1 then 'ok' else 'NOT AS EXPECTED' end
union all select 'nobody but the owner may run _listed',
       case when not has_function_privilege('anon', 'student_submit._listed(public.assessment,date)', 'execute')
             and not has_function_privilege('authenticated', 'student_submit._listed(public.assessment,date)', 'execute')
             and not has_function_privilege('service_role', 'student_submit._listed(public.assessment,date)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'service_role may still run every student_submit function the file changed but the two helpers',
       case when not exists (select 1 from found where sig not like 'student_submit.\_%' and not has_function_privilege('service_role', sig, 'execute'))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'anon may run no student_submit function the file changed',
       case when not exists (select 1 from found where has_function_privilege('anon', sig, 'execute')) then 'ok' else 'NOT AS EXPECTED' end;
