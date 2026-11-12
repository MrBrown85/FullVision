-- HANDOUTS AND LINKS, BEFORE THE APPLY. Read-only: one query for
-- gradebook-prod, to run right before
-- migrations/2026111170_handouts_links.sql. It changes nothing and reads no
-- student's row. migrations/local-test/handouts_links.py runs it on the
-- local stand-in.
--
-- Expected: NO ROWS. Each row is one thing that would stop the file, or
-- that is not as the file was tested against. (Run after the apply it also
-- gives no rows: everything is then as the file leaves it.) The lists are
-- written by handouts_links.py, never by hand.
with relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('public.fv_owns_assessment(uuid)',                         '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_owns_course(uuid)',                             'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)',                         '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)',                   '6d0b48c458d273a332db39e1a4b68626'),
    ('public._grade_return_lock(uuid)',                         '530dca441198b1546a4ec4967cd83b9f'),
    ('public._grade_return_lock_first(uuid)',                   '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._fv_timezone(text)',                               '8dbcb5716f155e2441f47416a0b28527'),
    ('public._work_bucket()',                                   '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_object(text)',                               '1c78c7884df1e02c326b06989da25c5c'),
    ('public._work_hold()',                                     'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._work_max_bytes()',                                '1384cb1ea953d11cea982d60d87e5421'),
    ('fv_private.work_path_course(text)',                       '7fb0272243ceef1cb6b42658d27664e3'),
    ('fv_private.work_read_allowed(text)',                      '3ea2b37a835c7a86a881ed743b95d1c9'),
    ('fv_private.work_upload_allowed(text)',                    'b53e85108b1e870a16e717055c63f2dc'),
    ('student_submit._session_class(text,uuid)',                '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._session_classes(uuid)',                   '722d403571069e3e97516f432ed9de5c'),
    ('student_submit._returned_grade(uuid,uuid)',               '21706ae9eec783107d9da24e52e1855a'),
    ('student_submit.removal_batch(integer)',                   '964eef99a747dc7180d4ad61bd19b1db'),
    ('student_submit.removal_done(bigint[])',                   'de793c82a2b5aa59052994a82e80d166'),
    ('public._submission_file_removed()',                       'edc99e4c04baefcf83b9ce3c94723023'),
    ('public._submission_gone()',                               '606be06c71d963805c12f23208b5c304'),
    ('public._photo_log(uuid,text,integer,jsonb)',              '53859922b32f0e4f2da95052edc130e2'),
    ('public._photo_keep_class(uuid,timestamp with time zone)', 'fb78dde9520f84f0f58faa1bebf98c23'),
    ('public._photo_missing(uuid)',                             'd099b00a7d1a2997ee287dfdbb528c43'),
    ('public._photo_stuck()',                                   '8f35709beffa04b59f36840e2d4e2fa0'),
    ('public.photo_removal_due()',                              '3faf3499da0753407687386407c8b01f'),
    ('public.photo_lifecycle_nightly()',                        '7e3dc52c80eb21f50848d67011385a26'),
    ('public.delete_assessment(uuid)',                          'b0557c759c662175194a75bff27c7001'),
    ('public.fv_retention_cleanup()',                           'a8da46d6664ba5956f4215ba3b2ada39')
    -- FINGERPRINTS-END
), replaces(fn, before, becomes) as (values
    -- FINGERPRINTS-BEGIN replaces
    ('student_submit.page(text,uuid,text)',                 '2f1795ba4c5416788d477a540b49fccb', '8d8e3f9aa91e43b0163cb3189430b758'),
    ('public._photo_strays(uuid,timestamp with time zone)', '21db626094c7be734d536357c91826c8', '54ffc47d26beeeb480a2430cd57f8f1e')
    -- FINGERPRINTS-END
), new(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN new
    ('public._handout_path(uuid,uuid,integer)',             '90e3c0e7b44ef1cc8fb3ad1b8b0bc222'),
    ('fv_private.handout_path_parts(text)',                 '9dd1528f2d0d1f49014b4b425b60492b'),
    ('public._assessment_resource_json(uuid)',              '216a6f09d7632edc558686e66a14d086'),
    ('public._assessment_resource_same_class()',            '1d661e6e1a34b6c2a82735f439fdc064'),
    ('public._assessment_resource_removed()',               '331dd8c1a4915e28e1a9ee2131991a93'),
    ('public._assessment_resource_gone()',                  'e7b0e2e222ddd148422248e7e96ce425'),
    ('public._assessment_resource_truncated()',             '5d4a8ca2dd10909f2d669927b2a5bba6'),
    ('public._handout_drop_expired(uuid)',                  'b73cf6fbb7b2b44d1c308d3cca1dfbaf'),
    ('fv_private.handout_upload_allowed(text)',             'b7a01941ecc710558b161f247c6cb413'),
    ('fv_private.handout_read_allowed(text)',               'c49416c21dea4d9ebdae95e1ca881b8c'),
    ('public.add_assessment_link(uuid,text,text,uuid)',     '4b72d1a6e5f2a56e2eb4d2f595be7f4d'),
    ('public.start_handout_upload(uuid,text,integer,uuid)', 'ac3c7d7c3a3f8d30eec287fed2c510ec'),
    ('public.finish_handout_upload(uuid,uuid)',             '03444c3bd55e4826285eeac20bdcfc40'),
    ('public.remove_assessment_resource(uuid,uuid)',        'ceaa38e29071d14b04ba0240c1a9589e'),
    ('public.list_course_resources(uuid)',                  'aedc2494e8d6236cc287a0c1afc9b412'),
    ('student_submit.handout_links(text,uuid,uuid,text)',   'bfb7707f3178d02e63317e3eca4c83c5')
    -- FINGERPRINTS-END
), fence as (
    select pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w
      from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'fv_student_photos_fence'
)
select 'relied on: ' || fn as what, md5 as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found
  from relied where fn <> 'public.no_such_function_at_all()'
   and md5 <> coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
union all
select 'replaced: ' || fn, before, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from replaces where fn <> 'public.no_such_function_at_all()'
   and coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') not in (before, becomes)
union all
select 'new name already taken: ' || fn, 'absent', coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from new where fn <> 'public.no_such_function_at_all()'
   and coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') not in ('absent', becomes)
union all
select 'public.assessment_resource is there without this file''s functions', 'absent', 'present'
 where to_regclass('public.assessment_resource') is not null
   and to_regprocedure('public.start_handout_upload(uuid,text,integer,uuid)') is null
union all
select 'an earlier migration is missing (through 2026111160_slips_keyed.sql)', 'present', 'absent'
 where to_regclass('public.submission_file_removal') is null or to_regclass('public.photo_check_log') is null
    or to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)') is null
union all
select 'storage.objects row security', 'on', 'off'
 where not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass)
union all
select 'the bucket student-photos (private, 2097152 bytes, image/jpeg)', 'as Batch B made it', 'not so'
 where not exists (select 1 from storage.buckets b
                    where b.id = 'student-photos' and b.public is false and b.file_size_limit = 2097152
                      and b.allowed_mime_types = array['image/jpeg'])
union all
select 'Batch B''s policy on storage.objects: ' || v.name, 'present', 'absent'
  from (values ('fv_student_photos_read', 'r', true), ('fv_student_photos_upload', 'a', true),
               ('fv_student_photos_teachers_only', '*', false), ('fv_student_photos_fence', '*', false)) as v(name, cmd, permissive)
 where not exists (select 1 from pg_policy p
                    where p.polrelid = 'storage.objects'::regclass and p.polname = v.name
                      and p.polcmd = v.cmd and p.polpermissive = v.permissive)
union all
select 'the policy fv_student_photos_fence', 'as Batch B wrote it', f.q || ' / ' || f.w
  from fence f
 where not ((f.q = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name))'
             and f.w = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name))')
         or (f.q = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name) OR fv_private.handout_read_allowed(name))'
             and f.w = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name) OR fv_private.handout_upload_allowed(name))'))
union all
select 'a policy named ' || p.polname || ' says something else', 'absent', 'present'
  from pg_policy p
 where p.polrelid = 'storage.objects'::regclass and p.polname in ('fv_handouts_read', 'fv_handouts_upload')
   and coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
       not in ('((bucket_id = ''student-photos''::text) AND fv_private.handout_read_allowed(name))',
               '((bucket_id = ''student-photos''::text) AND fv_private.handout_upload_allowed(name))')
union all
select 'a trigger named ' || t.tgname || ' on public.assessment runs something else', 'absent', p.proname::text
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.assessment'::regclass and not t.tgisinternal
   and ((t.tgname = 'assessment_resource_gone' and p.proname <> '_assessment_resource_gone')
     or (t.tgname = 'assessment_resource_truncate' and p.proname <> '_assessment_resource_truncated'))
union all
-- Supabase lets the applying role make and change policies on the tables
-- this setting lists. Where the setting is not there (the local stand-in),
-- nothing is said.
select 'this role may change policies on storage.objects (supautils.policy_grants)', 'yes', 'no'
 where coalesce(current_setting('supautils.policy_grants', true), '') <> ''
   and not coalesce((current_setting('supautils.policy_grants', true)::jsonb -> current_user) ? 'storage.objects', false)
   and not (select r.rolsuper from pg_roles r where r.rolname = current_user)
order by 1;
