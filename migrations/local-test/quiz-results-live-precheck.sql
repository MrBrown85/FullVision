-- Read-only pre-check, before the apply of migrations/2026111803_quiz_results.sql, after 2026111802 (2026-11-17).
-- SELECTs only, catalog facts only. It returns ONLY the rows that differ: no rows means ready.
with want(sig, md5) as (values
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    -- 2026111802's, as that file leaves them.
    ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f'),
    ('public.list_quiz_tries(uuid)', 'e929cbfe0aa1130741bd2b3af1615a2d')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('mark_quiz_answer', 'reopen_quiz', 'confirm_quiz')
    union all
    select 'table ' || t, 'absent'
      from unnest(array['public.quiz', 'public.quiz_question', 'public.quiz_attempt', 'public.quiz_answer']) t
     where to_regclass(t) is null
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by 1;
