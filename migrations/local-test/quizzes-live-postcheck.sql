-- Read-only post-check, after the apply of migrations/2026111804_quizzes.sql (2026-11-17).
-- SELECTs only. Every row says ok. The last row counts quizzes, never reads one.
with want(sig, after_md5) as (values
    ('public.list_quiz(uuid)', '4b5a877bdade0126970b90acbfa613d7'),
    ('public.save_quiz(uuid,jsonb,uuid)', '514d96e7fe70d09121d1068e7e7f70d1'),
    ('public.list_quiz_tries(uuid)', 'e929cbfe0aa1130741bd2b3af1615a2d'),
    ('fv_private.quiz_json(uuid)', 'c1d41659890c23cb02d0f517cd5c037d'),
    ('public._quiz_draft_guard()', '9e6ed6b0336305322b22c309161472f9'),
    ('public._quiz_tag_gone()', '3cd4fba9441edaec432cc3322c654826'),
    ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f'),
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626')),
tbl(t) as (values ('public.quiz'), ('public.quiz_question'), ('public.quiz_key'), ('public.quiz_attempt'), ('public.quiz_answer')),
fk(child, parent, n) as (values
    -- Each key cascades: (table, the table it names, how many keys to it).
    ('public.quiz', 'public.assessment', 1), ('public.quiz_question', 'public.quiz', 1), ('public.quiz_key', 'public.quiz_question', 1),
    ('public.quiz_attempt', 'public.quiz', 1), ('public.quiz_attempt', 'public.enrollment', 1),
    ('public.quiz_answer', 'public.quiz_attempt', 1), ('public.quiz_answer', 'public.quiz_question', 1))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'table ' || t || ': row security on, no policy, no client role may read or write it',
       case when to_regclass(t) is not null
             and (select relrowsecurity from pg_class where oid = to_regclass(t))
             and not exists (select 1 from pg_policy where polrelid = to_regclass(t))
             and not has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
             and not has_table_privilege('authenticated', t, 'select,insert,update,delete,truncate,references,trigger')
             and not has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger') then 'ok' else 'NOT AS EXPECTED' end
  from tbl
union all select 'key ' || child || ' -> ' || parent || ' cascades',
       case when (select count(*) from pg_constraint where conrelid = to_regclass(child) and contype = 'f'
                    and confrelid = to_regclass(parent) and confdeltype = 'c' and convalidated) = n then 'ok' else 'NOT AS EXPECTED' end
  from fk
union all select 'no key from quiz_question.tag_id (the deferred trigger empties it instead)',
       case when not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                              where c.conrelid = 'public.quiz_question'::regclass and c.contype = 'f' and a.attname = 'tag_id') then 'ok' else 'NOT AS EXPECTED' end
union all select 'one open try and one confirmed try per student (unique, partial)',
       case when (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.quiz_attempt'::regclass and i.indisunique and i.indpred is not null
                     and c.relname in ('quiz_attempt_one_open_idx', 'quiz_attempt_one_marked_idx')) = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'trigger assessment_quiz_draft_guard: before update of is_draft on assessment, enabled',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and tgname = 'assessment_quiz_draft_guard'
                           and tgfoid = 'public._quiz_draft_guard()'::regprocedure and tgenabled = 'O') then 'ok' else 'NOT AS EXPECTED' end
union all select 'the existing assessment_draft_guard is still there and unchanged',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and tgname = 'assessment_draft_guard' and tgenabled = 'O')
             and md5(pg_get_functiondef('public._assessment_draft_guard()'::regprocedure)) = 'c18fcd8b805c83a2b75e8ca051792658' then 'ok' else 'NOT AS EXPECTED' end
union all select 'trigger quiz_tag_gone: a constraint trigger on assessment_tag, deferred to commit',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.assessment_tag'::regclass and tgname = 'quiz_tag_gone'
                           and tgfoid = 'public._quiz_tag_gone()'::regprocedure and tgconstraint <> 0 and tgdeferrable and tginitdeferred
                           and tgenabled = 'O') then 'ok' else 'NOT AS EXPECTED' end
union all select 'trigger quiz_attempt_same_class on quiz_attempt',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.quiz_attempt'::regclass and tgname = 'quiz_attempt_same_class'
                           and tgfoid = 'public._quiz_attempt_same_class()'::regprocedure) then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher may run list_quiz, save_quiz and list_quiz_tries; a visitor and the edge functions may not',
       case when (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
                                  and not has_function_privilege('service_role', f, 'execute'))
                    from unnest(array['public.list_quiz(uuid)', 'public.save_quiz(uuid,jsonb,uuid)', 'public.list_quiz_tries(uuid)']) f) then 'ok' else 'NOT AS EXPECTED' end
union all select 'no role may call the helper or the trigger functions',
       case when (select bool_and(not has_function_privilege(r, f, 'execute'))
                    from unnest(array['fv_private.quiz_json(uuid)', 'public._quiz_draft_guard()', 'public._quiz_tag_gone()',
                                      'public._quiz_attempt_same_class()']) f,
                         unnest(array['anon', 'authenticated', 'service_role']) r) then 'ok' else 'NOT AS EXPECTED' end
union all select 'no function of the student page names the answer key',
       case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'student_submit' and p.prosrc like '%quiz_key%') then 'ok' else 'NOT AS EXPECTED' end
union all select 'the tables start empty (' || (select count(*) from public.quiz) || ' quizzes)',
       case when (select count(*) from public.quiz) = 0 then 'ok' else 'NOT AS EXPECTED' end;
