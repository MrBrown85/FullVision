-- Read-only pre-check, before the apply for migrations/2026111705_photo_expiry_warning.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready.
with want(sig, md5) as (values
    -- What the file relies on, unchanged (2026111704's, as live has them).
    ('public._photo_keep_class(uuid,timestamptz)', '67d1ae88eeacd34543cc0a80f1055991'),
    ('public.note_course_opened(uuid,uuid)', '0c9431bb6ff130f8de2715f8315838f1'),
    ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26'),
    ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('list_course_photo_expiry', '_course_restored_opened')
    union all
    select 'public.course_opened (2026111704''s columns)', coalesce(s, 'absent')
      from (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) as s
              from pg_attribute where attrelid = to_regclass('public.course_opened') and attnum > 0 and not attisdropped) t
     where s is distinct from 'course_id uuid, last_opened_at timestamp with time zone'
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
