-- Read-only fingerprint check for migrations/2026112601_rubric_comment_bank.sql (2026-11-26). NOT RUN BY ITS AUTHOR.
-- ONE select, catalog only (pg_proc and pg_get_functiondef; no row of any table is read). It returns ONLY the
-- functions whose live definition differs from the one the file was built and tested against: no rows means
-- every one matches, byte for byte. Run it with public on the search path (as Supabase's SQL editor does): an
-- md5 of pg_get_functiondef depends on it. The expected values were read on a database rebuilt from the repo
-- with scripts/db-rebuild.mjs --check, which proves it equal to migrations/baseline/.
select v.sig, v.expected, coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') as live
  from (values
    -- FINGERPRINTS-BEGIN live
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('public._touch_course_sync_cursor(uuid,text)', 'b0b9eb6dbbe09e9edc5640cde262248d'),
    ('public._touch_course_sync_cursor_from_trigger()', '225aac90e5534c2826298d084e77991c'),
    ('fv_private.same_teacher()', '81cd77e2e122e6b12562a3ff412871f0'),
    ('public.delete_rubric(uuid)', '8800838f8148a080b9042c1e646c1ca7'),
    ('public.get_assessment_detail(uuid)', '55d1f49f14d78a713eebadfd20417afa'),
    ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa'),
    ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311'),
    ('public.duplicate_course(uuid,uuid)', '27a2bdb32de32b2c2eea29e45bd7186d'),
    ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976'),
    ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)', '8346ff56ec20239d3289f641597401d4')
    -- FINGERPRINTS-END
  ) as v(sig, expected)
 where coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') is distinct from v.expected
 order by v.sig collate "C";
