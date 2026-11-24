-- Read-only pre-check, before the apply for migrations/2026112408_handout_pdf_original.sql (2026-11-24).
-- SELECTs only, catalog facts only (no row of an app table is read; storage.buckets and the names in
-- storage.objects are read for the one bucket). It returns ONLY the rows that differ from what the file was
-- written and tested against: no rows means ready. Run it with public on the search path, as Supabase's SQL
-- tools do.
with want(sig, md5) as (values
    -- What the file calls, and the six it replaces, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
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
    ('public.start_handout_file(uuid,text,text,bigint,uuid)', 'cfe44806c71f0927070a4299bef64dd6'),
    ('public.finish_handout_file(uuid,uuid)', '88338da511bac8aa1d931244aa1ee559'),
    ('public._handout_file_bucket()', 'f7ed7b1fe72127f538fcc133ebf7e423'),
    ('public._handout_file_max_bytes()', '587c06ecb2e6fa6980dfc027eae9ea00'),
    ('public._handout_file_mime(text)', '234e3efb8c0358be67c1705dea81fac1'),
    ('public._handout_file_path(uuid,uuid,text)', '72ad6e9a0c48f4243ba66a03a42427b0'),
    ('public._handout_file_object(text)', '797abf1f084660a2cf8254d712f7e040'),
    ('fv_private.handout_file_path_parts(text)', '185ad3fd3fc9ae84d6ae747f54a3423f'),
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
    ('student_submit.removal_done(bigint[])', '0414f8b4f5b2429c1799dde1a68179d3'),
    ('student_submit.handout_links(text,uuid,uuid,text)', '410877d7e4d5b860b8dadb4c1b185f3c'),
    ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511'),
    ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa'),
    ('public._assessment_resource_json(uuid)', 'ba262085f68a12f1320aa12cebf2f4af'),
    ('public._assessment_resource_removed()', 'becec68516a8cd68cccc383cf71325f7'),
    ('public._handout_drop_expired(uuid)', '2a89c8ea4984d1832f3dd4370756f253'),
    ('public.photo_lifecycle_nightly()', '511904d486e08f495f2823aefd80b7e9'),
    ('fv_private.handout_file_upload_allowed(text)', 'fd3ee2b395e774629f6e8d2c53a36e59'),
    ('fv_private.handout_file_read_allowed(text)', '01f9d53fbc7b87536957dca9984103be')
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
       and p.proname in ('start_handout_original', 'finish_handout_original', 'handout_original', '_handout_original_path', 'handout_original_parts')
    union all
    select 'bucket handout-files', coalesce(b.public::text || ', ' || b.file_size_limit::text || ', ' || b.allowed_mime_types::text, 'absent')
      from (select 1) one left join storage.buckets b on b.id = 'handout-files'
     where b.id is null or b.public is distinct from false or b.file_size_limit is distinct from 20971520
        or b.allowed_mime_types is distinct from array['text/html', 'text/plain', 'application/epub+zip']
    union all
    select 'a .pdf in the bucket handout-files', o.name
      from storage.objects o where o.bucket_id = 'handout-files' and right(o.name, 4) = '.pdf'
    union all
    select 'the ten policies of student-photos, handouts and handout-files', n::text
      from (select count(*) as n from pg_policy where polrelid = 'storage.objects'::regclass and polname in ('fv_handout_files_fence', 'fv_handout_files_read', 'fv_handout_files_teachers_only', 'fv_handout_files_upload', 'fv_handouts_read', 'fv_handouts_upload', 'fv_student_photos_fence', 'fv_student_photos_read', 'fv_student_photos_teachers_only', 'fv_student_photos_upload')) t
     where n <> 10
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
     where s is distinct from 'id uuid, assessment_id uuid, course_id uuid, kind text, title text, url text, page_count integer, status text, position integer, created_at timestamp with time zone, updated_at timestamp with time zone, bytes bigint'
    union all
    select 'public.assessment_resource constraints', coalesce(s, 'absent')
      from (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") as s
              from pg_constraint where conrelid = 'public.assessment_resource'::regclass
               and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check')) t
     where s is distinct from
           -- SHAPE-BEFORE
           'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (bytes IS NULL)) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)))))'
    union all
    select 'the role running this does not own assessment_resource', current_user::text
     where (select relowner from pg_class where oid = 'public.assessment_resource'::regclass) is distinct from (select oid from pg_roles where rolname = current_user)
)
select * from checks order by 1;
