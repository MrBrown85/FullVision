-- Read-only post-check, after the apply of migrations/2026111801_bulletins.sql (2026-11-17).
-- SELECTs only. Every row says ok. The one count reads how many bulletin rows there are, never a row.
-- Run it with public on the search path (as Supabase's SQL editor does).
-- It reads functions in public and fv_private only: the student side's (M2, in student_submit) are not this file's.
with want(sig, md5) as (values
    -- FINGERPRINTS-BEGIN postcheck (written by migrations/local-test/bulletins.py)
    ('delete_bulletin(uuid,uuid)', '8e7cca634add4151e773ac344b8d1331'),
    ('edit_bulletin(uuid,jsonb,uuid)', '5583fb3f7d1191e57e439870646ba6e7'),
    ('finish_bulletin_file(uuid,uuid)', '5ff81d27ecf035324eaf5782a899d8f9'),
    ('fv_private.bulletin_audience(uuid)', '0cd8d6cc98739a5b53af1916ac0d0be3'),
    ('fv_private.bulletin_drop_expired(uuid)', '387a8b7f2cdbdd200903a12664e4f8a4'),
    ('fv_private.bulletin_file_path(uuid,uuid,integer)', '382dc77b5c162295891790d42fb13763'),
    ('fv_private.bulletin_file_path_parts(text)', '91ebfc1cf60827326b6b56db3bca3d66'),
    ('fv_private.bulletin_file_read_allowed(text)', 'a7ac859897b34bceedc19e79bec0db1d'),
    ('fv_private.bulletin_file_removed()', 'f5d9ff024d8f189564993de228d302b0'),
    ('fv_private.bulletin_file_upload_allowed(text)', '8a17cc9d6971e5d3e9dc8e3e8975c8aa'),
    ('fv_private.bulletin_json(uuid)', 'a9ff292bcbce828af1020e58a5dae1c1'),
    ('fv_private.bulletin_patched(bulletin,jsonb,boolean)', 'ba36bb8518537938220b8b66ece60add'),
    ('fv_private.bulletin_pinned_now(boolean,date,text)', '3d68484d7051fd8f380fe2a84c401546'),
    ('fv_private.bulletin_student_same_class()', 'e141cc62d498e426078f6f1da638416d'),
    ('list_bulletin_seen(uuid)', '7e8055f12c4300d0e16d7c884b103494'),
    ('list_bulletins(uuid)', 'fc94d54275b68e231365361c0ba2815a'),
    ('post_bulletin(uuid,jsonb,jsonb,uuid)', 'b383dee60c48bea8edf769bdfd2a4a41'),
    ('show_bulletin_again(uuid,uuid)', '57d461e5ea790ae6a8406f8a69777298')
    -- FINGERPRINTS-END
),
fns as (select p.oid::regprocedure::text sig, md5(pg_get_functiondef(p.oid)) md5 from pg_proc p where p.proname ~ 'bulletin' and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace))
select 'fingerprint ' || coalesce(w.sig, f.sig) as check,
       case when w.md5 = f.md5 then 'ok' else 'NOT AS EXPECTED: ' || coalesce(f.md5, 'absent') end as value
  from want w full join fns f on f.sig = w.sig
union all select 'the four tables, row security on, no policy, no client grant',
       case when (select count(*) from pg_class c where c.oid in ('public.bulletin'::regclass, 'public.bulletin_file'::regclass,
                        'public.bulletin_seen'::regclass, 'public.bulletin_reaction'::regclass) and c.relrowsecurity) = 4
             and not exists (select 1 from pg_policy where polrelid::regclass::text ~ '^bulletin')
             and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name ~ '^bulletin'
                               and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) then 'ok' else 'NOT AS EXPECTED' end
union all select 'every table has a primary key',
       case when (select count(*) from pg_constraint where contype = 'p' and conrelid in ('public.bulletin'::regclass, 'public.bulletin_file'::regclass,
                        'public.bulletin_seen'::regclass, 'public.bulletin_reaction'::regclass)) = 4 then 'ok' else 'NOT AS EXPECTED' end
union all select 'each goes with its class, bulletin and student (on delete cascade); the assessment link is set null',
       case when (select count(*) from pg_constraint where contype = 'f' and confdeltype = 'c' and convalidated
                    and conrelid in ('public.bulletin'::regclass, 'public.bulletin_file'::regclass, 'public.bulletin_seen'::regclass, 'public.bulletin_reaction'::regclass)) = 7
             and exists (select 1 from pg_constraint where conrelid = 'public.bulletin'::regclass and contype = 'f'
                           and confrelid = 'public.assessment'::regclass and confdeltype = 'n') then 'ok' else 'NOT AS EXPECTED' end
union all select 'a file row deleted queues its pages; seen and reaction rows stay in their class',
       case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('bulletin_file_removed', 'bulletin_seen_same_class', 'bulletin_reaction_same_class')) = 3
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'the bucket bulletin-files: private, 2 MB, image/jpeg only',
       case when exists (select 1 from storage.buckets where id = 'bulletin-files' and public = false and file_size_limit = 2097152
                           and allowed_mime_types = array['image/jpeg']) then 'ok' else 'NOT AS EXPECTED' end
union all select 'storage.objects: the ten policies and these four',
       case when (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass) = 14
             and (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname ~ '^fv_bulletin_files_') = 4 then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher may run the seven and the two storage helpers; nobody else runs any',
       case when (select count(*) from pg_proc p where p.proname ~ 'bulletin' and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace) and has_function_privilege('authenticated', p.oid, 'execute')) = 9
             and not exists (select 1 from pg_proc p where p.proname ~ 'bulletin' and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace)
                               and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'the tables start empty (' || (select count(*) from public.bulletin) + (select count(*) from public.bulletin_file)
                 + (select count(*) from public.bulletin_seen) + (select count(*) from public.bulletin_reaction) || ' rows)',
       case when (select count(*) from public.bulletin) + (select count(*) from public.bulletin_file)
                 + (select count(*) from public.bulletin_seen) + (select count(*) from public.bulletin_reaction) = 0 then 'ok' else 'NOT AS EXPECTED' end;
