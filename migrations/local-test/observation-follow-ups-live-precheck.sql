-- Read-only pre-check, before the apply for migrations/2026111703_observation_follow_ups.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready.
with want(sig, md5) as (values
    -- The three functions the file patches in place.
    ('public.get_class_bundle(uuid,bigint)', '62bd0c41564652e983ccfbcadaafc5a7'),
    ('public.get_observations(uuid,jsonb,integer,integer)', 'b3e204a54b8b988061bcd62bb800aa30'),
    ('public.import_json_restore(jsonb,uuid)', '2de65ba2bca9babf90d5efb9134190ab'),
    -- Every other function whose body names observation, observation_student, observation_tag or
    -- observation_custom_tag (the file relies on what each does), and the helpers the new ones call.
    ('public._touch_course_sync_cursor_from_trigger()', '225aac90e5534c2826298d084e77991c'),
    ('public.create_observation(uuid,text,text,text,uuid,uuid[],uuid[],uuid[],uuid,text[],smallint,uuid)', 'e5bdcd077bf2b437eb5e02ac7a8ab01c'),
    ('public.delete_observation(uuid)', '75930ccf53435ca15ff3af7578a24689'),
    ('public.delete_withdrawn_student(uuid,uuid)', 'ad4c98f316f4f41f7ac7eec80f1c0093'),
    ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39'),
    ('public.get_term_rating(uuid,integer)', 'a121736eebd08a499bf11341fbd967df'),
    ('public.get_withdrawn_student_records(uuid)', '218afcff7d47714d89ee45848a30b211'),
    ('public.list_course_student_profiles(uuid)', '382e0819ec46b04a2d431b7e00bcb609'),
    ('public.update_observation(uuid,jsonb,uuid[],uuid[],uuid[])', '4c6a5e1a6a507e6f525d4faa2f9e1902'),
    ('fv_private.teacher_of(text,uuid)', 'c2ed64921a7413c387fafdee8038fae2'),
    ('fv_private.same_teacher()', '81cd77e2e122e6b12562a3ff412871f0'),
    ('fv_private.same_teacher_problem(jsonb,text[])', 'c79c97b49b7d5d31b1e9e72c9f4145a1'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da')),
naming as (
    select p.oid, n.nspname || '.' || p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.prosrc ~ '\mobservation(_student|_tag|_custom_tag)?\M'),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'a function names the observation tables and is not in the list: ' || p.oid::regprocedure::text, 'not checked'
      from naming p
     where p.oid not in (select to_regprocedure(sig) from want where to_regprocedure(sig) is not null)
    union all
    select 'already there: column public.observation.' || attname, 'present'
      from pg_attribute where attrelid = 'public.observation'::regclass and attname in ('follow_up_of', 'follow_up_kind') and not attisdropped
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('create_observation_follow_up', 'update_observation_follow_up', 'observation_follow_up_rule')
    union all
    select 'already there: trigger ' || tgname || ' on ' || tgrelid::regclass::text, 'present'
      from pg_trigger where tgname = 'observation_follow_up_rule'
    union all
    select 'already there: ' || conname, 'present'
      from pg_constraint where conname in ('observation_follow_up_of_fkey', 'observation_follow_up_kind_check')
    union all
    select 'already there: index observation_follow_up_of_idx', 'present'
     where to_regclass('public.observation_follow_up_of_idx') is not null
    union all
    select 'the columns of public.observation', s
      from (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) as s
              from pg_attribute where attrelid = 'public.observation'::regclass and attnum > 0 and not attisdropped) c
     where s is distinct from 'id uuid, course_id uuid, body text, sentiment text, context_type text, assessment_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, dims text[], level smallint, template_id uuid'
    union all
    select 'the triggers on observation and observation_student', s
      from (select string_agg(tgrelid::regclass::text || '.' || tgname, ', ' order by tgrelid::regclass::text || '.' || tgname) as s
              from pg_trigger where tgrelid in ('public.observation'::regclass, 'public.observation_student'::regclass) and not tgisinternal) t
     where s is distinct from 'observation.course_sync_cursor_observation_student_records, observation.same_teacher, observation_student.course_sync_cursor_observation_student_student_records, observation_student.same_teacher'
)
select check_name, value from checks order by 1;
