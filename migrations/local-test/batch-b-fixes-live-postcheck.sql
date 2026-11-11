-- BATCH B REVIEW FIXES, AFTER THE APPLY. Read-only: one query for
-- gradebook-prod, to run right after
-- migrations/2026111104_student_work_review_fixes.sql. It changes nothing.
-- migrations/local-test/submissions_fixes.py runs it on the local stand-in,
-- before the file (it lists the three functions) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the file should
-- have left it: what it is, what was expected, what was found. It proves
-- the three functions are the ones tested and run as Batch B made them run
-- (SECURITY DEFINER, search_path, owner, who can run them), the other 41
-- of Batch B's functions are untouched, no SECURITY DEFINER function lost
-- pg_temp, and no work handed in has more than 30 pages.
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11: Batch B's 44 functions as 8c36fe48 leaves them (the
-- same list as 2026111101's own), and the three this file replaces as it
-- leaves them. Written by migrations/local-test/submissions_fixes.py, never
-- by hand.
-- If Batch B is not applied the query fails with 'relation
-- "public.submission" does not exist': apply Batch B's two files first.
with batchb(fn, md5) as (values
    -- FINGERPRINTS-BEGIN batchb
    ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
    ('public._work_object(text)',                                                           '1c78c7884df1e02c326b06989da25c5c'),
    ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._work_class_max_pages()',                                                      'b8ccccd702ef8a8260bd7cf54bc9982a'),
    ('public._work_class_max_bytes()',                                                      '3c5df6fb4a11ae55005ec87362fdf95e'),
    ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
    ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
    ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
    ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
    ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
    ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
    ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
    ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
    ('public._submission_json(uuid)',                                                       'a1933b27974307aeae814ce98714c18f'),
    ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
    ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
    ('public._submission_file_removed()',                                                   'edc99e4c04baefcf83b9ce3c94723023'),
    ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
    ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
    ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
    ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
    ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
    ('public.list_course_submissions(uuid)',                                                '525db92cdf4129afb9e2bc15aa7d4725'),
    ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 '538ffab506d6c20344c07662837fe714'),
    ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'a6b8abb071daf36993e1318c07b42085'),
    ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '6a3caf6c0bfad3398bbb33a8ac1aa79a'),
    ('public.delete_submission(uuid,uuid)',                                                 'c1f98e77a7fb756e75af4334d520f5fc'),
    ('public.rotate_submission_page(uuid,integer,uuid)',                                    '2c08eb9198d7dc2b50a81caf18e08365'),
    ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
    ('fv_private.work_upload_allowed(text)',                                                'b53e85108b1e870a16e717055c63f2dc'),
    ('fv_private.work_read_allowed(text)',                                                  '3ea2b37a835c7a86a881ed743b95d1c9'),
    ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
    ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
    ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '595e0a34dc67e23ca9fadc478c2ab9b7'),
    ('student_submit.work(text,uuid,text)',                                                 '64d016d3d102327917e987b24e811129'),
    ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
    ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               'fe147af22bb706b08193504b72de223d'),
    ('student_submit.unsend(text,uuid,uuid,text)',                                          '3161f6b51e8a8e4e54e2d01033a20848'),
    ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
    ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
    ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
    -- FINGERPRINTS-END
), fixes(fn, md5) as (values
    -- FINGERPRINTS-BEGIN fixes
    ('public.finish_work_upload(uuid,jsonb,uuid)',            'c8c5c26be1758ec2e07fe73a68731159'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', '286e463dca1842c2586a93c77fb93456'),
    ('student_submit.unsend(text,uuid,uuid,text)',            '68665f35e1678f1bba64d30c082409d8')
    -- FINGERPRINTS-END
), found as (
    select b.fn, b.md5 as was, f.md5 as fix, coalesce(md5(pg_get_functiondef(to_regprocedure(b.fn))), 'absent') as is_now
      from batchb b left join fixes f on f.fn = b.fn
), how(fn, expected, is_now) as (
    -- how each of the three is run, as Batch B left it; CREATE OR REPLACE keeps it
    select t.fn,
           'SECURITY DEFINER; ' || t.config || '; volatile; owner as public._work_bucket(); run by ' || t.who,
           case when to_regprocedure(t.fn) is null then 'absent' else
           (select case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end || '; '
                   || coalesce(array_to_string(p.proconfig, ', '), 'no settings') || '; '
                   || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end || '; '
                   || case when p.proowner = (select q.proowner from pg_proc q where q.oid = to_regprocedure('public._work_bucket()'))
                           then 'owner as public._work_bucket()' else 'owner ' || p.proowner::regrole::text end || '; run by '
                   || coalesce((select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                                 where has_function_privilege(r, p.oid, 'execute')), 'nobody')
              from pg_proc p where p.oid = to_regprocedure(t.fn)) end
      from (values ('public.finish_work_upload(uuid,jsonb,uuid)', 'search_path=public, pg_temp', 'authenticated, service_role'),
                   ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'search_path=public, student_submit, pg_temp', 'service_role'),
                   ('student_submit.unsend(text,uuid,uuid,text)', 'search_path=public, student_submit, pg_temp', 'service_role')) t(fn, config, who)
)
select 'function ' || fn as what, coalesce(fix, was) as expected, is_now as found
  from found
 where is_now <> coalesce(fix, was)
union all
select 'how ' || fn || ' is run', expected, is_now
  from how
 where is_now <> expected
union all
select 'SECURITY DEFINER without pg_temp last in its search_path', 'none',
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')
union all
-- 30 pages at most in one submission (ruling 88). Work handed in before the
-- fix may be here; nothing handed in after it can be.
select 'handed-in work with more than 30 pages', 'none',
       count(*)::text || ': ' || string_agg(x.id::text || ' (' || x.n || ' pages)', ', ' order by x.id)
  from (select s.id, count(f.id) as n from public.submission s join public.submission_file f on f.submission_id = s.id
         where s.state = 'sent' group by s.id having count(f.id) > 30) x
having count(*) > 0;
