-- Read-only pre-check, before the apply for migrations/2026112410_criterion_own_line.sql (2026-11-24).
-- SELECTs only, catalog facts only (no row of an app table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready. Run it with public on the search
-- path, as Supabase's SQL tools do.
with want(sig, md5) as (values
    -- What the file calls, patches or replaces, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck
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
),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.oid in (to_regprocedure('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)'),
                                              to_regprocedure('public._grade_copy_entry(integer,integer,text,text,boolean,text)'))
    union all
    select 'another function named upsert_rubric_score or _grade_copy_entry', p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('upsert_rubric_score', '_grade_copy_entry')
       and p.oid not in (to_regprocedure('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)'),
                         to_regprocedure('public._grade_copy_entry(integer,integer,text,text,boolean)'))
    union all
    select 'public.rubric_score columns', coalesce(s, 'absent')
      from (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) as s
              from pg_attribute where attrelid = to_regclass('public.rubric_score') and attnum > 0 and not attisdropped) t
     where s is distinct from 'id uuid, enrollment_id uuid, assessment_id uuid, criterion_id uuid, value integer, updated_at timestamp with time zone, modifier smallint, comment text, beyond text'
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17
    union all
    select 'the role running this does not own public.rubric_score', current_user::text
     where (select relowner from pg_class where oid = 'public.rubric_score'::regclass) is distinct from (select oid from pg_roles where rolname = current_user)
)
select * from checks order by 1;
