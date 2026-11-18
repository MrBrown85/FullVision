-- Read-only post-check, after the apply for migrations/2026111803_bulletins_student.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read). Every row says ok.
with want(sig, after_md5) as (values
    ('student_submit._bulletin_visible(uuid,uuid)', 'cab9dc514218ac1839b112895e2baa11'),
    ('student_submit.bulletins(text,uuid,text)', 'e055c811b42aec87be4124ca3ae93f87'),
    ('student_submit.bulletin_seen(text,uuid,uuid[],text)', '96185b2e8173c90ccd40f2a054ad5cc7'),
    ('student_submit.bulletin_react(text,uuid,uuid,text,text)', 'e86e2c4c9454186390ad1fe9a845d8c1'),
    ('student_submit.bulletin_file_links(text,uuid,uuid,text)', '5e93daec794c4f5f5b936c385e4905ca'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e'),
    ('student_submit._write_limit(uuid,text,integer)', 'c2edfa96402a2eb7a839db3c106e11a9'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('fv_private.bulletin_file_path(uuid,uuid,integer)', '382dc77b5c162295891790d42fb13763'),
    ('fv_private.bulletin_pinned_now(boolean,date,text)', '3d68484d7051fd8f380fe2a84c401546')),
routes(sig) as (values
    ('student_submit.bulletins(text,uuid,text)'), ('student_submit.bulletin_seen(text,uuid,uuid[],text)'),
    ('student_submit.bulletin_react(text,uuid,uuid,text,text)'), ('student_submit.bulletin_file_links(text,uuid,uuid,text)'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'write_log_kind_check allows the four kinds it did and bulletin, validated, and is write_log''s only check',
       case when (select string_agg(pg_get_constraintdef(c.oid) || ' ' || c.conname || ' ' || c.convalidated::text, ' | ')
                    from pg_constraint c where c.conrelid = 'student_submit.write_log'::regclass and c.contype = 'c')
                 = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text]))) write_log_kind_check true'
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'the edge function''s role may run the four routes',
       case when (select bool_and(has_function_privilege('service_role', sig, 'execute')) from routes) then 'ok' else 'NOT AS EXPECTED' end
union all select 'a visitor, a teacher and everyone (public) may run none of the five',
       case when not exists (select 1 from (select sig from routes union all select 'student_submit._bulletin_visible(uuid,uuid)') r
                              where has_function_privilege('anon', r.sig, 'execute')
                                 or has_function_privilege('authenticated', r.sig, 'execute')
                                 or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                             where p.oid = to_regprocedure(r.sig) and x.grantee = 0))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'no role may call the shared rule _bulletin_visible directly',
       case when not has_function_privilege('service_role', 'student_submit._bulletin_visible(uuid,uuid)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'each of the five runs as its owner with the search path pinned',
       case when (select count(*) from pg_proc p
                   where p.oid in (select to_regprocedure(sig) from routes union all select to_regprocedure('student_submit._bulletin_visible(uuid,uuid)'))
                     and p.prosecdef and p.proconfig = array['search_path=public, student_submit, pg_temp']) = 5 then 'ok' else 'NOT AS EXPECTED' end
union all select 'no role reads or writes the four bulletin tables directly',
       case when not exists (select 1 from unnest(array['public.bulletin', 'public.bulletin_file', 'public.bulletin_seen', 'public.bulletin_reaction']) t,
                                          unnest(array['anon', 'authenticated', 'service_role']) r
                              where has_table_privilege(r, t, 'select,insert,update,delete')) then 'ok' else 'NOT AS EXPECTED' end;
