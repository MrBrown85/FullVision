-- Read-only post-check, after the apply for migrations/2026111807_quizzes_student_list.sql (2026-11-18).
-- SELECTs only, catalog facts only (no row of any table is read). Every row says ok. Run it with public
-- on the search path (as Supabase's SQL editor does): an md5 of pg_get_functiondef depends on it.
with want(sig, after_md5) as (values
    ('student_submit.quiz_list(text,uuid,text)', '51453e03b4293ff17eb598ab653dc0f2'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
-- Read from proacl itself (aclexplode), in any order: who besides the owner may run it, and nothing but EXECUTE.
union all select 'grants on student_submit.quiz_list(text,uuid,text): exactly its owner and service_role',
       case when coalesce((select string_agg(y.w, ', ' order by y.w collate "C")
                             from (select case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end || ' ' || x.privilege_type as w
                                     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                    where p.oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)') and x.grantee <> p.proowner) y), '')
                 = 'service_role EXECUTE'
            then 'ok' else 'NOT AS EXPECTED: ' || coalesce((select p.proacl::text from pg_proc p where p.oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)')), 'absent') end
union all select 'quiz_list is owned by the owner of _session_class (the role the edge function signs in as)',
       case when (select proowner from pg_proc where oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)'))
                 = (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) then 'ok' else 'NOT AS EXPECTED' end
union all select 'quiz_list runs as its owner with the search path pinned, marked stable (it can write nothing)',
       case when (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public, student_submit, pg_temp']
                    from pg_proc p where p.oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)')) then 'ok' else 'NOT AS EXPECTED' end
union all select 'quiz_list does not name quiz_key, quiz_question or quiz_answer',
       case when pg_get_functiondef(to_regprocedure('student_submit.quiz_list(text,uuid,text)')) !~ 'quiz_key|quiz_question|quiz_answer' then 'ok' else 'NOT AS EXPECTED' end
union all select 'no student_submit function names quiz_key',
       case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'student_submit'
                                and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like '%quiz_key%') then 'ok' else 'NOT AS EXPECTED' end;
