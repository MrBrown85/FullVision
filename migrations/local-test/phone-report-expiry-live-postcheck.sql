-- Read-only post-check, after the apply for migrations/2026112412_phone_report_expiry_bc_day.sql (2026-11-24).
-- SELECTs only, catalog facts and the answers of one pure function. Every row says ok. Run it with public on
-- the search path, as Supabase's SQL tools do.
with want(sig, after_md5) as (values
    -- FINGERPRINTS-BEGIN postcheck
    ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
    ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', 'ba3b0d2c4e47b3f517bf67648a90f8cf'),
    ('public.update_phone_report(uuid,jsonb,date,uuid)', 'af3a4d8dceebd78e2757e15470767100'),
    ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', '3fecf86d8b285c6f72072ab72b71e410')
    -- FINGERPRINTS-END
)
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'neither teacher function uses current_date, and each reads the class''s BC day through _fv_timezone',
       case when (select count(*) from unnest(array[to_regprocedure('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'),
                                                    to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)')]) f
                   where pg_get_functiondef(f) !~* 'current_date'
                     and pg_get_functiondef(f) like '%(now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = %))::date%') = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'update_phone_report and issue_slips set a card''s end from the start of the next BC day, not midnight in the session''s zone',
       case when (select count(*) from unnest(array[to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)'),
                                                    to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)')]) f
                   where pg_get_functiondef(f) !~ 'expires_on [+] 1[)]::timestamptz'
                     and pg_get_functiondef(f) like '%::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = %))%') = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'issue_slips is still security definer, volatile, search_path=public, student_submit, pg_temp, run by service_role and fv_teacher_cards only',
       case when (select count(*) from pg_proc p
                   where p.oid = to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)')
                     and p.provolatile = 'v' and p.prosecdef and p.proconfig::text = '{"search_path=public, student_submit, pg_temp"}'
                     and (select coalesce(string_agg(w, ', ' order by w collate "C"), '')
                            from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                   where a.grantee <> p.proowner
                                     and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x) in ('service_role', 'fv_teacher_cards, service_role')) = 1 then 'ok' else 'NOT AS EXPECTED' end
union all select 'the start of Nov 25 in BC is 07:00 UTC',
       case when (date '2026-11-24' + 1)::timestamp at time zone public._fv_timezone('America/Vancouver') = timestamptz '2026-11-25 07:00:00+00' then 'ok' else 'NOT AS EXPECTED' end
union all select 'both are volatile, invoker, search_path=public',
       case when (select count(*) from pg_proc p
                   where p.oid in (to_regprocedure('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'),
                                   to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)'))
                     and p.provolatile = 'v' and not p.prosecdef and p.proconfig::text = '{search_path=public}') = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'both may be run by authenticated and service_role only (and the owner)',
       case when (select count(*) from pg_proc p
                   where p.oid in (to_regprocedure('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'),
                                   to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)'))
                     and (select coalesce(string_agg(w, ', ' order by w collate "C"), '')
                            from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                   where a.grantee <> p.proowner
                                     and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x) = 'authenticated, service_role') = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'public._fv_timezone may be run by authenticated and service_role only (and the owner)',
       case when (select coalesce(string_agg(w, ', ' order by w collate "C"), '')
                    from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                            from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           where p.oid = to_regprocedure('public._fv_timezone(text)') and a.grantee <> p.proowner
                             and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x) = 'authenticated, service_role' then 'ok' else 'NOT AS EXPECTED' end
union all select '00:30 UTC on Nov 25 is Nov 24 in BC, 07:30 UTC is Nov 25',
       case when (timestamptz '2026-11-25 00:30:00+00' at time zone public._fv_timezone('America/Vancouver'))::date = date '2026-11-24'
             and (timestamptz '2026-11-25 07:30:00+00' at time zone public._fv_timezone('America/Vancouver'))::date = date '2026-11-25' then 'ok' else 'NOT AS EXPECTED' end
order by 1;
