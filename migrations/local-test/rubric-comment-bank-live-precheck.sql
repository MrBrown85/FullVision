-- Read-only pre-check, before the apply for migrations/2026112601_rubric_comment_bank.sql (2026-11-26).
-- SELECTs only. It returns the rows that differ from what the file was written and tested against, and two
-- count rows: "count: criteria" and "count: rubrics", the rows that get the new empty column (every one of
-- them reads [] after the apply; none is otherwise touched). Only the two count rows means ready. Run it with
-- public on the search path, as Supabase's SQL tools do.
with want(sig, md5) as (values
    -- What the file calls, patches or replaces, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck
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
),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('add_criterion_comment', 'add_rubric_overall_comment', '_rubric_comment_list')
    union all
    select 'another function named upsert_rubric', p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_rubric'
       and p.oid is distinct from to_regprocedure('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)')
    union all
    select 'public.criterion columns', coalesce(s, 'absent')
      from (select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end, ', ' order by attnum) as s
              from pg_attribute where attrelid = to_regclass('public.criterion') and attnum > 0 and not attisdropped) t
     where s is distinct from 'id uuid not null, rubric_id uuid not null, name text not null, level_4_descriptor text, level_3_descriptor text, level_2_descriptor text, level_1_descriptor text, level_4_value numeric not null, level_3_value numeric not null, level_2_value numeric not null, level_1_value numeric not null, weight numeric not null, display_order integer not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, level_5_descriptor text, level_6_descriptor text'
    union all
    select 'public.rubric columns', coalesce(s, 'absent')
      from (select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end, ', ' order by attnum) as s
              from pg_attribute where attrelid = to_regclass('public.rubric') and attnum > 0 and not attisdropped) t
     where s is distinct from 'id uuid not null, course_id uuid not null, name text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, copy_group uuid, style text not null, scale jsonb'
    union all
    select 'already there: constraint ' || conname, conrelid::regclass::text
      from pg_constraint where conname in ('criterion_comments_is_list', 'rubric_overall_comments_is_list')
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17
    union all
    select 'the role running this does not own public.criterion and public.rubric', current_user::text
     where (select relowner from pg_class where oid = 'public.criterion'::regclass) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = 'public.rubric'::regclass) is distinct from (select oid from pg_roles where rolname = current_user)
    union all
    select 'count: criteria', (select count(*) from public.criterion)::text
    union all
    select 'count: rubrics', (select count(*) from public.rubric)::text
)
select * from checks order by check_name collate "C", value collate "C";
