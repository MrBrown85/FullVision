-- Read-only pre-check, before the apply for migrations/2026111706_handout_files.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of an app table is read; storage.buckets is read for the
-- one name). It returns ONLY the rows that differ from what the file was written and tested
-- against: no rows means ready. Run it with public on the search path, as Supabase's SQL tools do
-- (pg_get_functiondef prints student_submit._listed's argument as "assessment" only then).
with want(sig, md5) as (values
    -- What the file calls, and the five it replaces, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck (written by migrations/local-test/handout_files.py)
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('public._grade_return_lock(uuid)', '530dca441198b1546a4ec4967cd83b9f'),
    ('public._grade_return_lock_first(uuid)', '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('public._work_bucket()', '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_hold()', 'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._handout_path(uuid,uuid,integer)', '90e3c0e7b44ef1cc8fb3ad1b8b0bc222'),
    ('public._assessment_resource_same_class()', '1d661e6e1a34b6c2a82735f439fdc064'),
    ('public._assessment_resource_gone()', 'e7b0e2e222ddd148422248e7e96ce425'),
    ('public._assessment_resource_truncated()', '5d4a8ca2dd10909f2d669927b2a5bba6'),
    ('public.remove_assessment_resource(uuid,uuid)', 'ceaa38e29071d14b04ba0240c1a9589e'),
    ('public.list_course_resources(uuid)', 'aedc2494e8d6236cc287a0c1afc9b412'),
    ('public.start_handout_upload(uuid,text,integer,uuid)', 'ac3c7d7c3a3f8d30eec287fed2c510ec'),
    ('public.finish_handout_upload(uuid,uuid)', '03444c3bd55e4826285eeac20bdcfc40'),
    ('public._photo_keep_class(uuid,timestamp with time zone)', '67d1ae88eeacd34543cc0a80f1055991'),
    ('public._photo_strays(uuid,timestamp with time zone)', '54ffc47d26beeeb480a2430cd57f8f1e'),
    ('public._photo_missing(uuid)', 'd099b00a7d1a2997ee287dfdbb528c43'),
    ('public._photo_stuck()', '8f35709beffa04b59f36840e2d4e2fa0'),
    ('public._photo_log(uuid,text,integer,jsonb)', '53859922b32f0e4f2da95052edc130e2'),
    ('public.delete_assessment(uuid)', 'b0557c759c662175194a75bff27c7001'),
    ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._listed(assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit.removal_batch(integer)', '964eef99a747dc7180d4ad61bd19b1db'),
    ('student_submit.handout_links(text,uuid,uuid,text)', '410877d7e4d5b860b8dadb4c1b185f3c'),
    ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917'),
    ('public._assessment_resource_json(uuid)', '216a6f09d7632edc558686e66a14d086'),
    ('public._assessment_resource_removed()', '331dd8c1a4915e28e1a9ee2131991a93'),
    ('public._handout_drop_expired(uuid)', 'b73cf6fbb7b2b44d1c308d3cca1dfbaf'),
    ('student_submit.removal_done(bigint[])', 'de793c82a2b5aa59052994a82e80d166'),
    ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26')
    -- FINGERPRINTS-END
),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.proname in ('start_handout_file', 'finish_handout_file', 'handout_file', '_handout_file_bucket', '_handout_file_max_bytes',
                         '_handout_file_mime', '_handout_file_path', '_handout_file_object', 'handout_file_path_parts',
                         'handout_file_upload_allowed', 'handout_file_read_allowed')
    union all
    select 'bucket handout-files', 'already there'
     where exists (select 1 from storage.buckets where id = 'handout-files')
    union all
    select 'policies on storage.objects', coalesce(s, 'none')
      from (select string_agg(polname, ', ' order by polname collate "C") as s from pg_policy where polrelid = 'storage.objects'::regclass) t
     where s is distinct from 'fv_handouts_read, fv_handouts_upload, fv_student_photos_fence, fv_student_photos_read, fv_student_photos_teachers_only, fv_student_photos_upload'
    union all
    select 'storage.objects row security', 'off'
     where not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass)
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17
    union all
    select 'public.assessment_resource columns', coalesce(s, 'absent')
      from (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) as s
              from pg_attribute where attrelid = to_regclass('public.assessment_resource') and attnum > 0 and not attisdropped) t
     where s is distinct from 'id uuid, assessment_id uuid, course_id uuid, kind text, title text, url text, page_count integer, status text, position integer, created_at timestamp with time zone, updated_at timestamp with time zone'
    union all
    select 'public.assessment_resource constraints', coalesce(s, 'absent')
      from (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) as s
              from pg_constraint where conrelid = 'public.assessment_resource'::regclass
               and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check')) t
     where s is distinct from
           -- SHAPE-BEFORE (written by migrations/local-test/handout_files.py)
           'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)))))'
)
select * from checks order by 1;
