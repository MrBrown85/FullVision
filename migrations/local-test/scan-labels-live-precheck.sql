-- Read-only pre-check, before the apply for migrations/2026111710_scan_labels.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready.
with want(sig, md5) as (values
    -- What the file relies on, unchanged.
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_owns_enrollment(uuid)', '728526648388367393162be706f7f9ea'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('list_scan_labels', 'issue_scan_labels', 'reissue_scan_label', 'scan_label_new')
    union all
    select 'already there: table public.scan_label', 'present'
     where to_regclass('public.scan_label') is not null
    union all
    select 'the schema fv_private', 'absent'
     where to_regnamespace('fv_private') is null
    union all
    -- The columns the three functions read.
    select 'public.enrollment.' || c.col, 'absent or another type'
      from (values ('id', 'uuid'), ('course_id', 'uuid'), ('roster_position', 'integer'),
                   ('withdrawn_at', 'timestamp with time zone')) c(col, typ)
     where not exists (select 1 from pg_attribute a where a.attrelid = 'public.enrollment'::regclass and a.attname = c.col
                         and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = c.typ)
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by 1;
