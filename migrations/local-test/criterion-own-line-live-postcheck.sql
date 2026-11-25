-- Read-only post-check, after the apply for migrations/2026112410_criterion_own_line.sql (2026-11-24).
-- SELECTs only, catalog facts. Every row says ok. Run it with public on the search path, as Supabase's SQL
-- tools do.
with want(sig, after_md5) as (values
    -- FINGERPRINTS-BEGIN postcheck
    ('public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb)', 'c19affb3ec09f6782c41139a44208ac8'),
    ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd'),
    ('public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb)', '9c161107ce8c9b37c7f7b785f8359d2d'),
    ('public.fill_rubric(uuid,uuid,integer,smallint)', '59c53fb566c6d47fbf0030586a18113c'),
    ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', 'eb9e161daa032f3b272435ec52a0bc7a'),
    ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
    ('fv_private.restore_grade_returns(jsonb)', '66501afe2d758a938cfc8f1d4fc13a92'),
    ('public._grade_return_on_change()', '250d2d680daa2bd3b54cd041285f1696'),
    ('public.fv_owns_rubric_score_cell(uuid,uuid,uuid)', '524e48c2997c6bf4867e3cd7ffa838d2'),
    ('public._grade_copy(uuid,uuid)', 'd6ae115df5d072e442a2a2a686e694f2'),
    ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311'),
    ('public.get_withdrawn_student_records(uuid)', 'c0938a84a84fbff35e983a2138f69414'),
    ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976'),
    ('public._assessment_draft_guard()', '5d9bedb5d58db88a59471b836ce6991c'),
    ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'dcd964d7880a6391f44de117f0002489'),
    ('public._grade_copy_entry(integer,integer,text,text,boolean,text)', '2826ff58262f52c9ac9103a8ef6138fc')
    -- FINGERPRINTS-END
)
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'the old seven-argument upsert_rubric_score and five-argument _grade_copy_entry are gone',
       case when to_regprocedure('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)') is null
             and to_regprocedure('public._grade_copy_entry(integer,integer,text,text,boolean)') is null then 'ok' else 'NOT AS EXPECTED' end
union all select 'one upsert_rubric_score and one _grade_copy_entry',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('upsert_rubric_score', '_grade_copy_entry')) = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'public.rubric_score has own_comment text',
       case when exists (select 1 from pg_attribute where attrelid = 'public.rubric_score'::regclass and attname = 'own_comment'
                          and atttypid = 'text'::regtype and not attisdropped) then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher and the service role may run upsert_rubric_score; a visitor may not',
       case when has_function_privilege('authenticated', 'public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'execute')
             and has_function_privilege('service_role', 'public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'execute')
             and not has_function_privilege('anon', 'public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'only the service role may run _grade_copy_entry',
       case when has_function_privilege('service_role', 'public._grade_copy_entry(integer,integer,text,text,boolean,text)', 'execute')
             and not has_function_privilege('authenticated', 'public._grade_copy_entry(integer,integer,text,text,boolean,text)', 'execute')
             and not has_function_privilege('anon', 'public._grade_copy_entry(integer,integer,text,text,boolean,text)', 'execute') then 'ok' else 'NOT AS EXPECTED' end;
