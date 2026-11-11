-- PHOTO LIFECYCLE (BATCH D), BEFORE THE APPLY. Read-only: one query for
-- gradebook-prod, to run right before migrations/2026111140_photo_lifecycle.sql.
-- It changes nothing and reads no student's row: function definitions, the
-- extensions, pg_cron's job names and Vault's secret NAMES (never a value).
-- migrations/local-test/photo_lifecycle.py runs it on the local stand-in.
--
-- FIRST QUERY expected: NO ROWS, once Batch B, its fixes, Batch C and the send rules are
-- applied, pg_net is turned on, and the two Vault secrets are set. Each row
-- is one thing that is not as the file expects: what it is, what was
-- expected, what was found, and whether the file's first check would stop
-- on it (stops = yes: it would stop with nothing changed; no: it would
-- apply, and the row is worth knowing; the Vault secrets are "no": without
-- them the timer's runs fail, visibly, until they are set).
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11, the same lists as the file's own. Written by
-- migrations/local-test/photo_lifecycle.py, never by hand.
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
), ext(what, there) as (values
    ('pg_cron (cron.job, cron.schedule)', to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null),
    ('pg_net (net.http_post)', to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null),
    ('Vault (vault.decrypted_secrets)', to_regclass('vault.decrypted_secrets') is not null)
), jobs(jobname, command) as (
    -- query_to_xml runs only where pg_cron is, so this reads on any database
    select x.jobname, x.command
      from (select unnest(xpath('/row/j/text()', r))::text as jobname, unnest(xpath('/row/c/text()', r))::text as command
              from unnest(xpath('/table/row', case when to_regclass('cron.job') is not null then
                     query_to_xml($q$select jobname as j, command as c from cron.job
                                     where jobname in ('fv_photo_lifecycle_daily', 'fv_photo_removal')$q$, false, false, '')
                   else '<table/>'::xml end)) r) x
), secrets(name) as (
    select unnest(xpath('/row/n/text()', r))::text
      from unnest(xpath('/table/row', case when to_regclass('vault.secrets') is not null then
             query_to_xml($q$select name as n from vault.secrets where name in ('fv_photo_sweep_url', 'fv_photo_sweep_secret')$q$, false, false, '')
           else '<table/>'::xml end)) r
)
select 'function ' || fn as what, md5 as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found, 'yes' as stops
  from relied
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> md5
union all
select 'function ' || fn, 'absent',
       md5(pg_get_functiondef(to_regprocedure(fn))) || case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then ' (already as 2026111140 leaves it)' else '' end,
       case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then 'no' else 'yes' end
  from new
 where to_regprocedure(fn) is not null
union all
select 'function ' || fn, before,
       md5(pg_get_functiondef(to_regprocedure(fn))) || case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then ' (already as 2026111140 leaves it)' else '' end,
       case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then 'no' else 'yes' end
  from replaces
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> before
union all
select 'table ' || t, 'present', 'absent', 'yes'
  from unnest(array['public.submission', 'public.submission_file', 'public.submission_file_removal', 'public.markup', 'public.revision_request']) t
 where to_regclass(t) is null
union all
select 'table ' || t, 'absent', 'present (already applied?)', 'no'
  from unnest(array['public.markup_kept', 'public.photo_keep_check', 'public.photo_check_log']) t
 where to_regclass(t) is not null
union all
select 'extension ' || what, 'installed', 'not installed', 'yes'
  from ext where not there
union all
select 'pg_cron job ' || jobname, 'absent, or runs ' || case jobname when 'fv_photo_lifecycle_daily' then 'call public.photo_lifecycle_nightly()' else 'select public.photo_removal_call()' end,
       'runs ' || command,
       case when command = case jobname when 'fv_photo_lifecycle_daily' then 'call public.photo_lifecycle_nightly()' else 'select public.photo_removal_call()' end then 'no' else 'yes' end
  from jobs
union all
select 'Vault secret ' || n, 'set (the timer''s runs fail until it is)', 'not set', 'no'
  from unnest(array['fv_photo_sweep_url', 'fv_photo_sweep_secret']) n
 where n not in (select name from secrets);

-- SECOND QUERY: what the first nights will delete. One row per class that
-- has photos of handed-in work (counts only: no student's row is read):
-- its Keep Photos Until choice, the day the screen shows today (the rule of
-- public._keep_photos_day, written out here because the function is not
-- there yet), whether that day has already passed, whether the class is in
-- the trash (skipped by the job), and how many pages were made before
-- midnight after that day. A row whose day is today or has passed
-- (gone_tonight = yes: the first night, after the apply, runs after it)
-- is deleted the first night: read it before applying. On 2026-11-11 live
-- held no photos, so this was expected to return no rows.
with c as (
    select c.id, c.keep_photos_until, c.reporting_terms, c.deleted_at is not null as in_trash,
           coalesce(nullif(btrim(c.timezone), ''), 'America/Vancouver') as tz
      from public.course c
     where exists (select 1 from public.submission s join public.submission_file f on f.submission_id = s.id
                    where s.course_id = c.id and s.state = 'sent')
), d as (
    select c.*, (now() at time zone c.tz)::date as today from c
), k as (
    select d.*,
           case when d.keep_photos_until is distinct from 'end_of_term' then j.june
                else coalesce((select min(e.d) from (select case when t->>'ends_on' ~ '^\d{4}-\d{2}-\d{2}$' then (t->>'ends_on')::date end as d
                                                       from jsonb_array_elements(case when jsonb_typeof(d.reporting_terms) = 'array' then d.reporting_terms else '[]'::jsonb end) t) e
                               where e.d >= d.today), j.june) end as day
      from d, lateral (select make_date(extract(year from d.today)::int + case when extract(month from d.today) >= 8 then 1 else 0 end, 6, 30) as june) j
)
select k.id as course_id, k.keep_photos_until as choice, k.day::text as deleted_after, case when k.day < k.today then 'yes' else 'no' end as day_passed,
       case when k.in_trash then 'yes (skipped)' else 'no' end as in_trash,
       (select count(*) from public.submission s join public.submission_file f on f.submission_id = s.id
         where s.course_id = k.id and s.state = 'sent' and f.created_at < ((k.day + 1)::timestamp at time zone k.tz)) as pages_before,
       case when k.day <= k.today and not k.in_trash then 'yes' else 'no' end as gone_tonight
  from k
 order by 1;
