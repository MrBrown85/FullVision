-- Read-only post-check, after the apply for migrations/2026111720_student_page_per_student.sql (2026-11-17).
-- SELECTs only. Every row says ok. The one count reads how many students have an option set, never who.
with want(sig, after_md5) as (values
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e'),
    ('student_submit.page(text,uuid,text)', '9e16e8aaa8f1379beca4f64d4111fa1d'),
    ('student_submit.feedback(text,uuid,text)', '73b78adc4b6661bc99ca0eaebf2e81bb'),
    ('public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', '1578d29d0af1a5cf25818878d811e5c1'),
    ('public.list_student_page_options(uuid)', '6913c1c295727391000044c2f7098b88'),
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_lookup(text,text,text)', 'b35a926e60a39330f8851d368acec7e6'),
    ('student_submit._send_session(text,uuid)', 'c39242f54850eeeada19945ac8123644'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'enrollment.show_overall_grade boolean and page_paused_at timestamptz, nullable, no default',
       case when (select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull::text || ' ' || atthasdef::text, ', ' order by attname)
                    from pg_attribute where attrelid = 'public.enrollment'::regclass and not attisdropped
                     and attname in ('show_overall_grade', 'page_paused_at'))
                 = 'page_paused_at timestamp with time zone false false, show_overall_grade boolean false false' then 'ok' else 'NOT AS EXPECTED' end
union all select 'one function of each new name',
       case when (select count(*) from pg_proc where proname in ('set_student_page_options', 'list_student_page_options')) = 2
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher may run both; a visitor, public and service_role may not',
       case when has_function_privilege('authenticated', 'public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', 'execute')
             and has_function_privilege('authenticated', 'public.list_student_page_options(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', 'execute')
             and not has_function_privilege('anon', 'public.list_student_page_options(uuid)', 'execute')
             and not has_function_privilege('service_role', 'public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', 'execute')
             and not has_function_privilege('service_role', 'public.list_student_page_options(uuid)', 'execute')
             and not exists (select 1 from pg_proc p, aclexplode(p.proacl) x
                              where p.proname in ('set_student_page_options', 'list_student_page_options')
                                and x.grantee = 0 and x.privilege_type = 'EXECUTE')
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'service_role may still run page and feedback; anon may run no patched function',
       case when has_function_privilege('service_role', 'student_submit.page(text,uuid,text)', 'execute')
             and has_function_privilege('service_role', 'student_submit.feedback(text,uuid,text)', 'execute')
             and not exists (select 1 from want where sig like 'student\_submit.%' and has_function_privilege('anon', sig, 'execute'))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'students with an option set (right after the apply: 0)',
       case when (select count(*) from public.enrollment where show_overall_grade is not null or page_paused_at is not null) = 0
            then 'ok' else 'ok: ' || (select count(*) from public.enrollment where show_overall_grade is not null or page_paused_at is not null) end;
