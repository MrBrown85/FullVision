-- Read-only post-check, after the apply of migrations/2026111803_quiz_results.sql (2026-11-17).
-- SELECTs only. Every row says ok.
with want(sig, after_md5) as (values
    ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', '77bd2789ea9f46790f6eef639a605c24'),
    ('public.reopen_quiz(uuid,uuid,uuid)', '012bb9a8cb2a7034b90b14e2f5c20c87'),
    ('public.confirm_quiz(uuid,jsonb,uuid)', '8380e8fa33795295b97e17623376414f'),
    ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f'),
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'a teacher may run the three; a visitor and the edge functions may not',
       case when (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
                                  and not has_function_privilege('service_role', f, 'execute'))
                    from unnest(array['public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', 'public.reopen_quiz(uuid,uuid,uuid)',
                                      'public.confirm_quiz(uuid,jsonb,uuid)']) f) then 'ok' else 'NOT AS EXPECTED' end
union all select 'none of the three names a score, tag score, rubric score or returned grade table',
       case when not exists (select 1 from pg_proc p where p.oid in ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)'::regprocedure,
                                 'public.reopen_quiz(uuid,uuid,uuid)'::regprocedure, 'public.confirm_quiz(uuid,jsonb,uuid)'::regprocedure)
                               and p.prosrc ~* '(from|into|update|join)\s+(public\.)?(score|tag_score|rubric_score|grade_return)\M') then 'ok' else 'NOT AS EXPECTED' end;
