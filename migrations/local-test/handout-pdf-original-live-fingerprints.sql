-- Read-only fingerprint check for migrations/2026112408_handout_pdf_original.sql (2026-11-24). NOT RUN BY ITS AUTHOR.
-- ONE select, catalog only (pg_proc and pg_get_functiondef; no row of any table is read). It returns ONLY the
-- functions whose live definition differs from the one the file was built and tested against: no rows means
-- every one matches, byte for byte. Run it with public on the search path (as Supabase's SQL editor does): an
-- md5 of pg_get_functiondef depends on it. The expected values were read on a database rebuilt from the repo
-- with scripts/db-rebuild.mjs --check, which proves it equal to migrations/baseline/.
select v.sig, v.expected, coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') as live
  from (values
    -- FINGERPRINTS-BEGIN live
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
  ) as v(sig, expected)
 where coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') is distinct from v.expected
 order by v.sig collate "C";
