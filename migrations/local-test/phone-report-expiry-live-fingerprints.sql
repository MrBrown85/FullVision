-- Read-only fingerprint check for migrations/2026112412_phone_report_expiry_bc_day.sql (2026-11-24).
-- ONE select, catalog only (pg_proc and pg_get_functiondef; no row of any table is read). It returns ONLY the
-- functions whose live definition differs from the one the file was built and tested against: no rows means
-- every one matches, byte for byte. Run it with public on the search path (as Supabase's SQL editor does): an
-- md5 of pg_get_functiondef depends on it. The expected values for the two phone report functions were read on
-- gradebook-prod itself (read-only) on 2026-11-24 and equal those of a database rebuilt from the repo;
-- public._fv_timezone is as 2026112411 left it (applied Nov 24).
select v.sig, v.expected, coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') as live
  from (values
    -- FINGERPRINTS-BEGIN live
    ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
    ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', '55a852bc57853ac9b558b13b4dd965ff'),
    ('public.update_phone_report(uuid,jsonb,date,uuid)', 'd3d30f8a96ecfd8431c6e44683e6bebd'),
    ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
    -- FINGERPRINTS-END
  ) as v(sig, expected)
 where coalesce(md5(pg_get_functiondef(to_regprocedure(v.sig))), 'absent') is distinct from v.expected
 order by v.sig collate "C";
