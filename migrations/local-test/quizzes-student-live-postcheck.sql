-- Read-only post-check, after the apply for migrations/2026111806_quizzes_student.sql (2026-11-18).
-- SELECTs only, catalog facts only (no row of any table is read). Every row says ok. Run it with public
-- on the search path (as Supabase's SQL editor does): an md5 of pg_get_functiondef depends on it.
with want(sig, after_md5) as (values
    ('student_submit._quiz_window(uuid,uuid)', 'a6aad8a24c4b47020eb23e51a9b564a6'),
    ('student_submit._quiz_new_order(uuid)', '60094583822902bdafa8b0623942e9ef'),
    ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be'),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
    ('student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)', '106de8942ce40ccc9d51c35d2e4e328a'),
    ('student_submit.quiz_send(text,uuid,uuid,text)', 'ebd17424915013d30d69e83c50f1f7de'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._write_limit(uuid,text,integer)', 'c2edfa96402a2eb7a839db3c106e11a9'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit._work_window(uuid)', '904f6388c7f2b65bfb9f093f343100e4'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('public.reopen_quiz(uuid,uuid,uuid)', 'daabc9bbdd81761d4ddfd72b773eca78'),
    ('public._quiz_draft_guard()', '9e6ed6b0336305322b22c309161472f9'),
    ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f')),
-- Each new function's exact grants: its owner, and for the three entry points service_role, and no one else.
acl(sig, extra) as (values
    ('student_submit._quiz_window(uuid,uuid)', ''),
    ('student_submit._quiz_new_order(uuid)', ''),
    ('student_submit._quiz_questions(uuid,jsonb)', ''),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', 'service_role'),
    ('student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)', 'service_role'),
    ('student_submit.quiz_send(text,uuid,uuid,text)', 'service_role'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
-- Read from proacl itself (aclexplode), in any order: who besides the owner may run it, and nothing but EXECUTE.
union all select 'grants on ' || a.sig || ': exactly ' || case when a.extra = '' then 'its owner' else 'its owner and ' || a.extra end,
       case when coalesce((select string_agg(y.w, ', ' order by y.w collate "C")
                             from (select case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end || ' ' || x.privilege_type as w
                                     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                    where p.oid = to_regprocedure(a.sig) and x.grantee <> p.proowner) y), '')
                 = case when a.extra = '' then '' else a.extra || ' EXECUTE' end
             and to_regprocedure(a.sig) is not null
            then 'ok' else 'NOT AS EXPECTED: ' || coalesce((select p.proacl::text from pg_proc p where p.oid = to_regprocedure(a.sig)), 'absent') end
  from acl a
union all select 'the six are owned by the owner of _session_class (the role the edge function signs in as)',
       case when (select count(*) from acl a join pg_proc p on p.oid = to_regprocedure(a.sig)
                   where p.proowner = (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)'))) = 6
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'write_log_kind_check allows the five kinds it did and quiz, validated, and is write_log''s only check',
       case when (select string_agg(pg_get_constraintdef(c.oid) || ' ' || c.conname || ' ' || c.convalidated::text, ' | ' order by c.conname collate "C", c.oid)
                    from pg_constraint c where c.conrelid = 'student_submit.write_log'::regclass and c.contype = 'c')
                 = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text]))) write_log_kind_check true'
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'each of the six runs as its owner with the search path pinned',
       case when (select count(*) from acl a join pg_proc p on p.oid = to_regprocedure(a.sig)
                   where p.prosecdef and p.proconfig = array['search_path=public, student_submit, pg_temp']) = 6 then 'ok' else 'NOT AS EXPECTED' end
union all select 'no student_submit function names quiz_key',
       case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'student_submit'
                                and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like '%quiz_key%') then 'ok' else 'NOT AS EXPECTED' end
union all select 'no role reads or writes the five quiz tables directly',
       case when not exists (select 1 from unnest(array['public.quiz', 'public.quiz_question', 'public.quiz_key', 'public.quiz_attempt', 'public.quiz_answer']) t,
                                          unnest(array['anon', 'authenticated', 'service_role']) r
                              where has_table_privilege(r, t, 'select,insert,update,delete')) then 'ok' else 'NOT AS EXPECTED' end;
