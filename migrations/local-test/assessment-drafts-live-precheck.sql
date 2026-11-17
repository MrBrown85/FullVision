-- Read-only pre-check for migrations/2026111701_assessment_drafts.sql (2026-11-16).
-- Run on gradebook-prod before the apply: SELECTs only, it changes nothing.
-- What the file would meet: every function it replaces as it expects
-- (want = before), what it adds not there yet, and what the Unassign rule
-- (the trigger assessment_draft_guard) would say about today's rows.
-- Nov 16 on live: every 'fingerprint' row says ok; 149 assessments, 0 dated
-- in the future, 146 with a student result or work (Unassign refused), 3
-- without; 73 empty score rows and 2 seen-only grade_return rows, which do
-- not block; 1 create_assessment; no column, no trigger, no guard function.
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
    ('public._assessment_draft_guard()', 'absent', 'c18fcd8b805c83a2b75e8ca051792658')),
found as (select w.*, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent') as md5 from want w)
select 'fingerprint ' || sig as check, case when md5 = before_md5 then 'ok' else 'NOT AS EXPECTED: ' || md5 end as value from found
union all select 'is_draft column exists (want false)',
       exists (select 1 from pg_attribute where attrelid = 'public.assessment'::regclass and attname = 'is_draft' and not attisdropped)::text
union all select 'trigger assessment_draft_guard exists (want false)',
       exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and tgname = 'assessment_draft_guard')::text
union all select 'create_assessment overloads (want 1)', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_assessment'
union all select 'assessments', count(*)::text from public.assessment
union all select 'assessments dated in the future', count(*)::text
  from public.assessment a join public.course c on c.id = a.course_id
 where a.date_assigned > (now() at time zone public._fv_timezone(c.timezone))::date
union all select 'assessments with a student result or work (Unassign refused)', count(*)::text from public.assessment a
 where exists (select 1 from public.score x where x.assessment_id = a.id
                  and (x.value is not null or nullif(btrim(x.status), '') is not null
                       or nullif(btrim(x.comment), '') is not null or nullif(btrim(x.report_note), '') is not null))
       or exists (select 1 from public.rubric_score x where x.assessment_id = a.id
                     and (x.value is not null or nullif(btrim(x.comment), '') is not null or nullif(btrim(x.beyond), '') is not null))
       or exists (select 1 from public.tag_score x where x.assessment_id = a.id and (x.value is not null or nullif(btrim(x.comment), '') is not null))
       or exists (select 1 from public.rubric_check_score x where x.assessment_id = a.id)
       or exists (select 1 from public.dibels_score x where x.assessment_id = a.id
                     and (x.orf_wrc is not null or x.orf_errors is not null or x.maze_correct is not null or x.maze_incorrect is not null))
       or exists (select 1 from public.grade_return x where x.assessment_id = a.id
                     and (x.returned_at is not null or x.is_draft or x.returned_copy is not null or x.previous_copy is not null
                          or x.working_copy is not null or x.held_note is not null))
       or exists (select 1 from public.submission x where x.assessment_id = a.id)
       or exists (select 1 from public.markup x where x.assessment_id = a.id)
       or exists (select 1 from public.markup_kept x where x.assessment_id = a.id)
       or exists (select 1 from public.revision_request x where x.assessment_id = a.id)
       or exists (select 1 from public.feedback_reflection x where x.assessment_id = a.id)
union all select 'score rows that hold nothing (do not block)', count(*)::text from public.score
 where value is null and nullif(btrim(status), '') is null and nullif(btrim(comment), '') is null and nullif(btrim(report_note), '') is null
union all select 'grade_return rows with only seen_at (do not block)', count(*)::text from public.grade_return
 where returned_at is null and not is_draft and returned_copy is null and previous_copy is null and working_copy is null and held_note is null
union all select 'server version (want 17.x)', current_setting('server_version');
