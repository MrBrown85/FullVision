-- Read-only post-check, after the apply for migrations/2026112407_quiz_returned.sql (2026-11-24).
-- SELECTs only, catalog facts only (no row of any table is read). Every row says ok. Run it with public
-- on the search path (as Supabase's SQL editor does): an md5 of pg_get_functiondef depends on it.
with want(sig, after_md5) as (values
    ('student_submit.quiz_result(text,uuid,uuid,text)', '30ae0744d9bc53043e6df40dbee5274c'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', '86d4747f0dd055fa4a61945046ca64d3'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
    ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be'),
    ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b'),
    ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd'),
    ('public._grade_return_holds(uuid)', '51d6525109333424405e826bbc303b90'),
    ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)', '89899f9dbc1569f7f1cc4216e252eb32'),
    ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689'),
    ('public._grade_return_release()', '81222b025ca3625612b1bcd3ff9e2431'),
    ('public.confirm_quiz(uuid,jsonb,uuid)', 'ee23f2910b1484f18a41ea76b08f0846'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
-- Read from proacl itself (aclexplode), in any order: who besides the owner may run it, and nothing but EXECUTE.
union all select 'grants on student_submit.quiz_result(text,uuid,uuid,text): exactly its owner and service_role',
       case when coalesce((select string_agg(y.w, ', ' order by y.w collate "C")
                             from (select case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end || ' ' || x.privilege_type as w
                                     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                    where p.oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)') and x.grantee <> p.proowner) y), '')
                 = 'service_role EXECUTE'
            then 'ok' else 'NOT AS EXPECTED: ' || coalesce((select p.proacl::text from pg_proc p where p.oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')), 'absent') end
union all select 'quiz_result is owned by the owner of _session_class (the role the edge function signs in as)',
       case when (select proowner from pg_proc where oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)'))
                 = (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) then 'ok' else 'NOT AS EXPECTED' end
union all select 'quiz_result runs as its owner with the search path pinned, marked stable (it can write nothing)',
       case when (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public, student_submit, pg_temp']
                    from pg_proc p where p.oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')) then 'ok' else 'NOT AS EXPECTED' end
union all select 'no student_submit function but quiz_result names quiz_key',
       case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'student_submit' and p.proname <> 'quiz_result'
                                and strpos(case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end, 'quiz_key') > 0) then 'ok' else 'NOT AS EXPECTED' end
union all select 'quiz_result names quiz_key (it is the one that reads the key)',
       case when coalesce(strpos(pg_get_functiondef(to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')), 'quiz_key') > 0, false)
            then 'ok' else 'NOT AS EXPECTED' end;
