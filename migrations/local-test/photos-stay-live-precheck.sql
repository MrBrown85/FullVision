-- Read-only pre-check, before the apply for migrations/2026111704_photos_stay_with_class.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready.
with want(sig, md5) as (values
    -- The function the file replaces.
    ('public._photo_keep_class(uuid,timestamptz)', 'fb78dde9520f84f0f58faa1bebf98c23'),
    -- What the file relies on, unchanged.
    ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26'),
    ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39'),
    ('public.set_course_send_work(uuid,jsonb,uuid)', '694863746b03f4be25263a5107f5b02e'),
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('public._grade_return_lock_first(uuid)', '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._work_drop_expired(uuid)', '417711d4dadba3966d0358baee0214f0'),
    ('public._photo_log(uuid,text,integer,jsonb)', '53859922b32f0e4f2da95052edc130e2'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('public._submission_file_removed()', 'edc99e4c04baefcf83b9ce3c94723023')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname = 'note_course_opened'
    union all
    select 'already there: table public.course_opened', 'present'
     where to_regclass('public.course_opened') is not null
    union all
    -- The only function that calls _photo_keep_class is the nightly job.
    select 'another function calls _photo_keep_class: ' || p.oid::regprocedure::text, 'not checked'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosrc like '%_photo_keep_class(%'
       and p.oid not in (to_regprocedure('public.photo_lifecycle_nightly()'), to_regprocedure('public._photo_keep_class(uuid,timestamptz)'))
    union all
    select 'the triggers on public.course', s
      from (select string_agg(tgname, ', ' order by tgname) as s from pg_trigger where tgrelid = 'public.course'::regclass and not tgisinternal) t
     where s is distinct from 'course_sync_cursor_course_gradebook, grade_return_release, markup_given_on_release'
    union all
    select 'the nightly job (pg_cron fv_photo_lifecycle_daily)', coalesce((select schedule || ' ' || command from cron.job where jobname = 'fv_photo_lifecycle_daily'), 'absent')
     where (select schedule || ' ' || command from cron.job where jobname = 'fv_photo_lifecycle_daily') is distinct from '27 10 * * * call public.photo_lifecycle_nightly()'
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by 1;
