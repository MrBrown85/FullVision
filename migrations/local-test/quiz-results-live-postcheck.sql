-- Read-only post-check, after the apply of migrations/2026111805_quiz_results.sql (2026-11-17).
-- SELECTs only. Every row says ok. Grants are read from proacl itself, for every role.
with want(sig, after_md5, runs) as (values
    -- runs: who besides its owner may run it.
    ('public.list_quiz_tries(uuid)', 'e929cbfe0aa1130741bd2b3af1615a2d', 'authenticated'),
    ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', '1222e55ae9915bc81c6194abb8b9050e', 'authenticated'),
    ('public.reopen_quiz(uuid,uuid,uuid)', 'daabc9bbdd81761d4ddfd72b773eca78', 'authenticated'),
    ('public.confirm_quiz(uuid,jsonb,uuid)', 'ee23f2910b1484f18a41ea76b08f0846', 'authenticated'),
    ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f', null),
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673', null),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f', null),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626', null)),
fn_acl as (
    select w.sig, w.runs, (select coalesce(string_agg(x.r, ', ' order by x.r collate "C"), '')
                             from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as r
                                     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    where p.oid = to_regprocedure(w.sig) and a.grantee <> p.proowner) x) as got
      from want w where w.runs is not null)
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'grant: ' || sig || ' may be run by ' || runs || ' and no one else',
       case when got = runs then 'ok' else 'NOT AS EXPECTED: ' || coalesce(nullif(got, ''), 'its owner only') end
  from fn_acl
union all select 'none of the four names a score, tag score, rubric score or returned grade table',
       case when not exists (select 1 from pg_proc p where p.oid in ('public.list_quiz_tries(uuid)'::regprocedure,
                                 'public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)'::regprocedure,
                                 'public.reopen_quiz(uuid,uuid,uuid)'::regprocedure, 'public.confirm_quiz(uuid,jsonb,uuid)'::regprocedure)
                               and p.prosrc ~* '(from|into|update|join)[[:space:]]+(public[.])?(score|tag_score|rubric_score|grade_return)([^a-z_]|$)') then 'ok' else 'NOT AS EXPECTED' end;
