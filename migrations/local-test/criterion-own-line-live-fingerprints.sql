-- Read-only fingerprint check for migrations/2026112410_criterion_own_line.sql (2026-11-24). NOT RUN BY ITS AUTHOR.
-- ONE select, catalog only (pg_proc and pg_get_functiondef; no row of any table is read). It returns ONLY the
-- functions whose live definition differs from the one the file was built and tested against: no rows means
-- every one matches, byte for byte. Run it with public on the search path (as Supabase's SQL editor does): an
-- md5 of pg_get_functiondef depends on it. The expected values were read on a database rebuilt from the repo
-- with scripts/db-rebuild.mjs --check, which proves it equal to migrations/baseline/, and the seven the file
-- replaces were also read from gradebook-prod itself (read-only) on 2026-11-24.
select v.sig, v.expected, coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') as live
  from (values
    -- FINGERPRINTS-BEGIN live
    ('public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb)', 'c19affb3ec09f6782c41139a44208ac8'),
    ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd'),
    ('public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb)', '9c161107ce8c9b37c7f7b785f8359d2d'),
    ('public.fill_rubric(uuid,uuid,integer,smallint)', '59c53fb566c6d47fbf0030586a18113c'),
    ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', 'eb9e161daa032f3b272435ec52a0bc7a'),
    ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
    ('fv_private.restore_grade_returns(jsonb)', '66501afe2d758a938cfc8f1d4fc13a92'),
    ('public._grade_return_on_change()', '250d2d680daa2bd3b54cd041285f1696'),
    ('public.fv_owns_rubric_score_cell(uuid,uuid,uuid)', '524e48c2997c6bf4867e3cd7ffa838d2'),
    ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b'),
    ('public.get_class_bundle(uuid,bigint)', '837999a0468728ccdbf75f74ee2ca360'),
    ('public.get_withdrawn_student_records(uuid)', '218afcff7d47714d89ee45848a30b211'),
    ('public.import_json_restore(jsonb,uuid)', 'ddc59b55cdc6185e871b9812335853d8'),
    ('public._assessment_draft_guard()', 'c18fcd8b805c83a2b75e8ca051792658'),
    ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)', '969a701836ca6c50a92327e66efa0055'),
    ('public._grade_copy_entry(integer,integer,text,text,boolean)', '7d37c111f89850b78f69e4f1676ec255')
    -- FINGERPRINTS-END
  ) as v(sig, expected)
 where coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') is distinct from v.expected
 order by v.sig collate "C";
