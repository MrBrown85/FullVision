-- Read-only post-check, after the apply for migrations/2026112601_rubric_comment_bank.sql (2026-11-26).
-- SELECTs only. Every row says ok. Run it with public on the search path, as Supabase's SQL tools do.
with want(sig, after_md5) as (values
    -- FINGERPRINTS-BEGIN postcheck
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('public._touch_course_sync_cursor(uuid,text)', 'b0b9eb6dbbe09e9edc5640cde262248d'),
    ('public._touch_course_sync_cursor_from_trigger()', '225aac90e5534c2826298d084e77991c'),
    ('fv_private.same_teacher()', '81cd77e2e122e6b12562a3ff412871f0'),
    ('public.delete_rubric(uuid)', '8800838f8148a080b9042c1e646c1ca7'),
    ('public.get_assessment_detail(uuid)', '55d1f49f14d78a713eebadfd20417afa'),
    ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa'),
    ('public.get_class_bundle(uuid,bigint)', '481cba076e47cf26dbd523cfe7943d2e'),
    ('public.duplicate_course(uuid,uuid)', '07496e59952ea9fddc55373e21322b09'),
    ('public.import_json_restore(jsonb,uuid)', 'c2943dda03581e9397b1d5e3e44ec5d6'),
    ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)', '9ee43afa5a004f1eb49c19ea066b4f09'),
    ('public._rubric_comment_list(jsonb,integer)', '3c09d92742de880fac5cafa2657a6f99'),
    ('public.add_criterion_comment(uuid,smallint,text,uuid)', 'bb89f9e27e67e91b03606cd753b2a19a'),
    ('public.add_rubric_overall_comment(uuid,text,uuid)', 'f39938dae40b2c981c43f76a1b934640')
    -- FINGERPRINTS-END
)
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'the nine-argument upsert_rubric is gone; one upsert_rubric is left',
       case when to_regprocedure('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)') is null
             and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'upsert_rubric') = 1 then 'ok' else 'NOT AS EXPECTED' end
union all select 'criterion.comments and rubric.overall_comments: jsonb, not null, default [], checked to be lists',
       case when (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where ((a.attrelid = 'public.criterion'::regclass and a.attname = 'comments')
                       or (a.attrelid = 'public.rubric'::regclass and a.attname = 'overall_comments'))
                     and not a.attisdropped and a.attnotnull and a.atttypid = 'jsonb'::regtype
                     and pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb') = 2
             and (select count(*) from pg_constraint where conname in ('criterion_comments_is_list', 'rubric_overall_comments_is_list')
                   and contype = 'c' and convalidated) = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher and the service role may run the four functions; a visitor may not',
       case when (select bool_and(has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute')
                                  and not has_function_privilege('anon', f, 'execute'))
                    from unnest(array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)',
                                      'public.add_criterion_comment(uuid,smallint,text,uuid)',
                                      'public.add_rubric_overall_comment(uuid,text,uuid)',
                                      'public._rubric_comment_list(jsonb,integer)']) f) then 'ok' else 'NOT AS EXPECTED' end;
