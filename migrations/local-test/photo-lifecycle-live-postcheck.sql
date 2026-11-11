-- PHOTO LIFECYCLE (BATCH D), AFTER THE APPLY. Read-only: one query for
-- gradebook-prod, to run right after migrations/2026111140_photo_lifecycle.sql.
-- It changes nothing and reads no student's row.
-- migrations/local-test/photo_lifecycle.py runs it on the local stand-in,
-- before the file (it lists what is missing) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the file should
-- have left it: what it is, what was expected, what was found. It proves
-- the eight functions and the procedure are the ones tested, run by nobody
-- but their owner (and pg_cron, as the owner); the functions they rely on
-- are untouched; the three tables have row security on and no grant; the
-- two jobs are scheduled with the tested times and commands; the Vault
-- secrets are set (by name: no value is read); and no SECURITY DEFINER
-- function lost pg_temp. Written by migrations/local-test/photo_lifecycle.py,
-- never by hand.
with relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('public._grade_return_lock(uuid)',                                      '530dca441198b1546a4ec4967cd83b9f'),
    ('public._grade_return_lock_first(uuid)',                                '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._fv_timezone(text)',                                            '8dbcb5716f155e2441f47416a0b28527'),
    ('public._fv_date(text)',                                                '0dcf865b5254cf0f9535df0fac1cb8a4'),
    ('public._work_bucket()',                                                '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_object(text)',                                            '1c78c7884df1e02c326b06989da25c5c'),
    ('public._work_hold()',                                                  'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._work_drop_expired(uuid)',                                      '417711d4dadba3966d0358baee0214f0'),
    ('public._submission_file_removed()',                                    'edc99e4c04baefcf83b9ce3c94723023'),
    ('public._submission_gone()',                                            '606be06c71d963805c12f23208b5c304'),
    ('public._submission_truncated()',                                       '9abaa6530a1e7f7215951d9952675de0'),
    ('public._submission_target_gone()',                                     'f4f03a728aa0937ff0d89d9e5b62cc67'),
    ('student_submit.removal_batch(integer)',                                '964eef99a747dc7180d4ad61bd19b1db'),
    ('student_submit.removal_done(bigint[])',                                'de793c82a2b5aa59052994a82e80d166'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                '340cb72444d555a9cef594b543e2674c'),
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '6cad6dd40eb1c33451a5dcf4f60e7624'),
    ('student_submit.work(text,uuid,text)',                                  '2ec445c5d5afadb7c3fc1699d9929e52'),
    ('student_submit.send_paths(text,uuid,uuid,text)',                       '2f36c08b8ace950b9c7eb905b320aa40'),
    ('fv_private.work_path_course(text)',                                    '7fb0272243ceef1cb6b42658d27664e3'),
    ('public._revision_gone()',                                              '13b5fb325c563a0475437829446ef089'),
    ('public._markup_on_return()',                                           'ce8ceaa830617aa9caf935b161d7e379'),
    ('public._markup_on_release()',                                          'a7e8838702d000c42621d72bf8621dfb')
    -- FINGERPRINTS-END
), replaces(fn, before, becomes) as (values
    -- FINGERPRINTS-BEGIN replaces
    ('student_submit._grading_started(uuid,uuid)', '13622bbca72904fdf877ce6b336dc6b4', '586a6a0b5910e6c153b72e73a5b672bc')
    -- FINGERPRINTS-END
), new(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN new
    ('public._keep_photos_day(text,jsonb,date)',                 'ad345bdd6eadab44296ed32ef7870be6'),
    ('public._photo_keep_cutoff(uuid,timestamp with time zone)', '57f0aac3911eb4657447a951232bed4a'),
    ('public._photo_keep_class(uuid,timestamp with time zone)',  'fb78dde9520f84f0f58faa1bebf98c23'),
    ('public._photo_strays(uuid,timestamp with time zone)',      '21db626094c7be734d536357c91826c8'),
    ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
    ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
    ('public._photo_stuck()',                                    '8f35709beffa04b59f36840e2d4e2fa0'),
    ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
    ('public.photo_removal_call()',                              '08b22d449cc3312b31b975ee057fbc08')
    -- FINGERPRINTS-END
), want_jobs(jobname, schedule, command) as (values
    ('fv_photo_lifecycle_daily', '27 10 * * *', 'call public.photo_lifecycle_nightly()'),
    ('fv_photo_removal', '*/10 * * * *', 'select public.photo_removal_call()')
), jobs(jobname, schedule, command, active) as (
    select unnest(xpath('/row/j/text()', r))::text, unnest(xpath('/row/s/text()', r))::text,
           unnest(xpath('/row/c/text()', r))::text, unnest(xpath('/row/a/text()', r))::text
      from unnest(xpath('/table/row', case when to_regclass('cron.job') is not null then
             query_to_xml($q$select jobname as j, schedule as s, command as c, active::text as a from cron.job
                             where jobname in ('fv_photo_lifecycle_daily', 'fv_photo_removal')$q$, false, false, '')
           else '<table/>'::xml end)) r
), secrets(name) as (
    select unnest(xpath('/row/n/text()', r))::text
      from unnest(xpath('/table/row', case when to_regclass('vault.secrets') is not null then
             query_to_xml($q$select name as n from vault.secrets where name in ('fv_photo_sweep_url', 'fv_photo_sweep_secret')$q$, false, false, '')
           else '<table/>'::xml end)) r
), routines(sig) as (
    select fn from new union all select fn from replaces union all select 'public.photo_lifecycle_nightly()'
)
select 'function ' || fn as what, becomes as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found
  from new
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> becomes
union all
select 'function ' || fn, md5, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from relied
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> md5
union all
select 'function ' || fn, becomes, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from replaces
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> becomes
union all
select 'procedure public.photo_lifecycle_nightly()', 'present', 'absent'
 where to_regprocedure('public.photo_lifecycle_nightly()') is null
union all
select 'who can run ' || sig, 'nobody but the owner', string_agg(r, ', ' order by r)
  from routines, unnest(array['anon', 'authenticated', 'public', 'service_role']) r
 where to_regprocedure(sig) is not null and has_function_privilege(r, to_regprocedure(sig), 'execute')
 group by sig
union all
select 'table ' || t, 'present, row security on, no grant to anon, authenticated or service_role',
       case when to_regclass(t) is null then 'absent'
            when not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(t)) then 'row security off'
            else 'granted to ' || (select string_agg(r, ', ') from unnest(array['anon', 'authenticated', 'service_role']) r
                                    where has_table_privilege(r, to_regclass(t), 'select, insert, update, delete')) end
  from unnest(array['public.markup_kept', 'public.photo_keep_check', 'public.photo_check_log']) t
 where to_regclass(t) is null
    or not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(t))
    or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, to_regclass(t), 'select, insert, update, delete'))
union all
select 'pg_cron job ' || w.jobname, w.schedule || ' ' || w.command || ' (active)',
       coalesce(j.schedule || ' ' || j.command || case when j.active = 'true' then ' (active)' else ' (not active)' end, 'absent')
  from want_jobs w left join jobs j on j.jobname = w.jobname
 where j.jobname is null or j.schedule <> w.schedule or j.command <> w.command or j.active <> 'true'
union all
select 'Vault secret ' || n, 'set (the timer''s runs fail until it is)', 'not set'
  from unnest(array['fv_photo_sweep_url', 'fv_photo_sweep_secret']) n
 where n not in (select name from secrets)
union all
select 'SECURITY DEFINER without pg_temp last: ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'pg_temp last in search_path', coalesce(array_to_string(p.proconfig, ', '), 'no settings')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$');
