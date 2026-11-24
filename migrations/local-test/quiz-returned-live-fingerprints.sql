-- Read-only fingerprint check for migrations/2026112407_quiz_returned.sql (2026-11-24). NOT RUN BY ITS AUTHOR.
-- ONE select, catalog only (pg_proc and pg_get_functiondef; no row of any table is read). It returns ONLY the
-- functions whose live definition differs from the one this file was built and tested against: no rows means
-- every one matches, byte for byte. Run it with public on the search path (as Supabase's SQL editor does): an
-- md5 of pg_get_functiondef depends on it. The expected values were read on a database rebuilt from the repo
-- with scripts/db-rebuild.mjs --check (which proves it equal to migrations/baseline/, live's catalog as of
-- 2026112404) and agree with migrations/baseline/function-md5.txt for each function (that file is printed
-- with pg_catalog alone on the path, so its line for _listed names public.assessment and differs there only).
select v.sig, v.expected, coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') as live
  from (values
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', '86d4747f0dd055fa4a61945046ca64d3'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
    ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be'),
    ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b'),
    ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd'),
    ('public._grade_return_holds(uuid)', '51d6525109333424405e826bbc303b90'),
    ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)', '89899f9dbc1569f7f1cc4216e252eb32'),
    ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689'),
    ('public._grade_return_release()', '81222b025ca3625612b1bcd3ff9e2431'),
    ('public.confirm_quiz(uuid,jsonb,uuid)', 'ee23f2910b1484f18a41ea76b08f0846'),
    -- Must be absent before the apply: a row saying 'absent' here is the expected state.
    ('student_submit.quiz_result(text,uuid,uuid,text)', 'absent')
  ) as v(sig, expected)
 where coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') is distinct from v.expected
 order by v.sig collate "C";
