-- Read-only post-check, after the apply for migrations/2026111710_scan_labels.sql (2026-11-17).
-- SELECTs only. Every row says ok. The one count reads how many codes there are, never a code or a student.
with want(sig, after_md5) as (values
    ('public.list_scan_labels(uuid)', '6e03772c7b669ba5bedceb1cd0bfcf02'),
    ('public.issue_scan_labels(uuid,uuid)', 'd2d083b6c33a2cf8991ca65234606169'),
    ('public.reissue_scan_label(uuid,uuid)', 'ff61b3bb56f7aae8b341937caacb4f55'),
    ('fv_private.scan_label_new(uuid)', '09f8ff09c3fbd118697d0eeddbe93ba2'),
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_owns_enrollment(uuid)', '728526648388367393162be706f7f9ea'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'table public.scan_label: its five columns, row security on',
       case when (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
                    from pg_attribute where attrelid = 'public.scan_label'::regclass and attnum > 0 and not attisdropped)
                 = 'id uuid, enrollment_id uuid, code text, created_at timestamp with time zone, retired_at timestamp with time zone'
             and (select relrowsecurity from pg_class where oid = 'public.scan_label'::regclass) then 'ok' else 'NOT AS EXPECTED' end
union all select 'its key goes with the student (on delete cascade)',
       case when exists (select 1 from pg_constraint where conrelid = 'public.scan_label'::regclass and contype = 'f'
                           and confrelid = 'public.enrollment'::regclass and confdeltype = 'c' and convalidated) then 'ok' else 'NOT AS EXPECTED' end
union all select 'a code is unique, of the alphabet, and one live per student',
       case when exists (select 1 from pg_constraint where conrelid = 'public.scan_label'::regclass and conname = 'scan_label_code_key' and contype = 'u')
             and exists (select 1 from pg_constraint where conrelid = 'public.scan_label'::regclass and conname = 'scan_label_code_check' and contype = 'c')
             and exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                          where i.indrelid = 'public.scan_label'::regclass and c.relname = 'scan_label_one_live_idx' and i.indisunique and i.indpred is not null)
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'no policy on the table, and no client role may read or write it',
       case when not exists (select 1 from pg_policy where polrelid = 'public.scan_label'::regclass)
             and not has_table_privilege('anon', 'public.scan_label', 'select,insert,update,delete')
             and not has_table_privilege('authenticated', 'public.scan_label', 'select,insert,update,delete')
             and not has_table_privilege('service_role', 'public.scan_label', 'select,insert,update,delete') then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher may run the three functions; a visitor may not',
       case when has_function_privilege('authenticated', 'public.list_scan_labels(uuid)', 'execute')
             and has_function_privilege('authenticated', 'public.issue_scan_labels(uuid,uuid)', 'execute')
             and has_function_privilege('authenticated', 'public.reissue_scan_label(uuid,uuid)', 'execute')
             and not has_function_privilege('anon', 'public.list_scan_labels(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.issue_scan_labels(uuid,uuid)', 'execute')
             and not has_function_privilege('anon', 'public.reissue_scan_label(uuid,uuid)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'no role may call the code-drawing function directly',
       case when not has_function_privilege('anon', 'fv_private.scan_label_new(uuid)', 'execute')
             and not has_function_privilege('authenticated', 'fv_private.scan_label_new(uuid)', 'execute')
             and not has_function_privilege('service_role', 'fv_private.scan_label_new(uuid)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'no function of the student page reads the table',
       case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'student_submit' and p.prosrc like '%scan_label%') then 'ok' else 'NOT AS EXPECTED' end
union all select 'the table starts empty (' || (select count(*) from public.scan_label) || ' codes)',
       case when (select count(*) from public.scan_label) = 0 then 'ok' else 'NOT AS EXPECTED' end;
