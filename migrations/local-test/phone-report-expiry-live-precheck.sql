-- Read-only pre-check, before the apply for migrations/2026112412_phone_report_expiry_bc_day.sql (2026-11-24).
-- SELECTs only, catalog facts only (no row of an app table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready. Run it with public on the search
-- path, as Supabase's SQL tools do.
with want(sig, md5) as (values
    -- What the file replaces or relies on, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck
    ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
    ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', '55a852bc57853ac9b558b13b4dd965ff'),
    ('public.update_phone_report(uuid,jsonb,date,uuid)', 'd3d30f8a96ecfd8431c6e44683e6bebd'),
    ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
    -- FINGERPRINTS-END
),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'Etc/GMT+7 is not UTC-7 with no daylight time here', coalesce((select utc_offset::text from pg_timezone_names where name = 'Etc/GMT+7'), 'absent')
     where not exists (select 1 from pg_timezone_names where name = 'Etc/GMT+7' and utc_offset = interval '-7 hours' and not is_dst)
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17
    union all
    select 'public.course has no text column timezone', 'absent'
     where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course'
                        and column_name = 'timezone' and data_type = 'text')
    union all
    select 'the role running this does not own ' || p.oid::regprocedure::text, current_user::text
      from pg_proc p
     where p.oid in (to_regprocedure('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'),
                     to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)'),
                     to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'),
                     to_regprocedure('public._fv_timezone(text)'))
       and p.proowner is distinct from (select oid from pg_roles where rolname = current_user)
)
select * from checks order by 1;
