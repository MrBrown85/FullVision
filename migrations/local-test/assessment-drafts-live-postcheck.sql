-- Read-only post-check for migrations/2026111701_assessment_drafts.sql (2026-11-16).
-- Run on gradebook-prod after the apply: SELECTs only. Every row says ok.
-- The 'drafts' row is information: how many Drafts there are now (0 right
-- after the apply). The undo refuses while it is above 0.
with want(sig, before_md5, after_md5) as (values
    ('student_submit._session_classes(uuid)', '722d403571069e3e97516f432ed9de5c', 'f6751bf9a7803a84067df8efad66f490'),
    ('student_submit._work_window(uuid)', '767795b7835e3c4d6cb628c76df8e6eb', '07e70e0c63675e895b1db9d6b4d8a472'),
    ('student_submit.feedback(text,uuid,text)', '1b90f53ea0d838acae50da7639e8c935', '0c01e9f5d2efee024e1592fb8a42b6d8'),
    ('student_submit.group_work(text,uuid,text)', '1db83448b1b3d7ae998870bdb07c4f36', '6d1a251fdcc1261129e0c1025c977943'),
    ('student_submit.page(text,uuid,text)', 'b460f6f2753ad24317ad2d1f2f4149ce', '0508ea6a4e183bac79c18df4a1135917'),
    ('student_submit.file_links(text,uuid,uuid,text)', '1bd03e7e959fc7ff127bc9602badc283', 'c977ce3010a3c849110c60195caf2f6e'),
    ('student_submit.group_file_links(text,uuid,uuid,text)', '5f15b29dd67898c3339e57e694b42edd', 'f7a4bf32ea97c2d1dd11e28e7d9cf117'),
    ('student_submit.handout_links(text,uuid,uuid,text)', 'bfb7707f3178d02e63317e3eca4c83c5', '822a5ed9b9433f6ef29af3b8e5856070'),
    ('student_submit.markup(text,uuid,uuid,text)', '754e27d5088fd0053bac3edba94c445d', '3f4031af1d0bb67e15e27eaae7c275cf'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)', '9e62c67308321d3dd4095db16e2ad8e1', 'c77950cbe4d79e1f0e73a46d720d9545'),
    ('public.get_class_bundle(uuid,bigint)', '116294a41f043458e3ddec694520cf0d', '62bd0c41564652e983ccfbcadaafc5a7'),
    ('public.get_gradebook(uuid)', 'beec0fae104cd7f4a0e96364130f267d', '08d83934dcacbf14ddfce6ec6cf9068b'),
    ('public.duplicate_assessment(uuid,uuid)', '248a2de149b71e8d99f4fa27a569e7a7', '91fb43611f5a93739c32e2ee8cbcc7d2'),
    ('public.import_json_restore(jsonb,uuid)', '77018c1c88cb9176daee71e2c93d1d9b', '2de65ba2bca9babf90d5efb9134190ab'),
    ('public.import_teams_class(jsonb,uuid)', 'e785413204a6f91827496f9923b845e5', 'f15548a3b9fb9c6b46680fdff5d0a3cd'),
    ('public.update_assessment(uuid,jsonb,uuid[])', '523f9491dc3b689dc3d6473e411e4876', 'c48044d5e0d902e3e5a6fef63cb74049'),
    ('public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid)', 'b3f6055028ea0ea1bdcb2f481959d9cf', 'absent'),
    ('public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)', 'absent', '2852ea5862f02785711a2d8125b5fadf'),
    ('public._assessment_draft_guard()', 'absent', '8c891dea862dc2ab1353dbad1a8df26a')),
found as (select w.*, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent') as md5 from want w)
select 'fingerprint ' || sig as check, case when md5 = after_md5 then 'ok' else 'NOT AS EXPECTED: ' || md5 end as value from found
union all select 'is_draft is boolean not null default false',
       case when exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                          where a.attrelid = 'public.assessment'::regclass and a.attname = 'is_draft' and not a.attisdropped
                            and a.atttypid = 'boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false')
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'trigger assessment_draft_guard enabled, on the guard function',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and tgname = 'assessment_draft_guard'
                            and tgenabled = 'O' and tgfoid = to_regprocedure('public._assessment_draft_guard()'))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'one create_assessment',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'create_assessment') = 1 then 'ok' else 'NOT AS EXPECTED' end
union all select 'create_assessment: authenticated and service_role may run it, anon may not',
       case when has_function_privilege('authenticated', 'public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)', 'execute')
             and has_function_privilege('service_role', 'public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)', 'execute')
             and not has_function_privilege('anon', 'public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'nobody but the owner may run _assessment_draft_guard',
       case when not has_function_privilege('anon', 'public._assessment_draft_guard()', 'execute')
             and not has_function_privilege('authenticated', 'public._assessment_draft_guard()', 'execute')
             and not has_function_privilege('service_role', 'public._assessment_draft_guard()', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'anon may run no student_submit function the file replaced',
       case when not exists (select 1 from found where sig like 'student_submit.%' and has_function_privilege('anon', sig, 'execute'))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'drafts', count(*)::text from public.assessment where is_draft;
