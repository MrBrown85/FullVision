-- BATCH B, BEFORE THE APPLY. Read-only: two queries for gradebook-prod, to
-- run just before migrations/2026111101_student_work_submissions.sql and
-- migrations/2026111102_student_work_storage.sql are applied. Neither
-- changes anything. Run each by itself (QUERY 1, then QUERY 2).
-- migrations/local-test/submissions.py runs both on the local stand-in.
--
-- ── QUERY 1: is the database what the two files were tested on? ─────────────
-- Expected: NO ROWS. Each row is one thing that differs, with what was
-- tested, what was found, and whether a file would stop on it:
--   stops = 'yes'  the file's own first check refuses it, with nothing
--                  changed. Do not apply; find out why it differs.
--   stops = 'no'   the files would still apply, but something they rely on
--                  is not what the tests ran against. Read it before
--                  applying.
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11, built as gradebook-prod is since S3-M1 was applied
-- (2026-11-11 02:02 UTC): Batch A, S0-M5, S0-M4b, S3-M1. The lists are
-- written by migrations/local-test/submissions_fingerprints.py, never by
-- hand.
with relied(fn, md5) as (values
    -- the live functions the new ones call
    -- FINGERPRINTS-BEGIN relied
    ('public.fv_owns_course(uuid)',              'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_owns_enrollment(uuid)',          '728526648388367393162be706f7f9ea'),
    ('public.fv_owns_assessment(uuid)',          '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)',          '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)',    '6d0b48c458d273a332db39e1a4b68626'),
    ('public._fv_timezone(text)',                '8dbcb5716f155e2441f47416a0b28527'),
    ('public._fv_date(text)',                    '0dcf865b5254cf0f9535df0fac1cb8a4'),
    ('public._grade_return_lock(uuid)',          '530dca441198b1546a4ec4967cd83b9f'),
    ('public._grade_return_lock_first(uuid)',    '4d85813e08aaeb108cda95d85f3d66e4'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._device_session(text)',     'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._card_refusal(uuid)',       'cb88af0a6bf62c22ff6c636b291b1a25')
    -- FINGERPRINTS-END
), made(fn, md5) as (values
    -- the functions the first file makes: none may be there yet
    -- FINGERPRINTS-BEGIN absent
    ('public._work_bucket()',                                                               'absent'),
    ('public._work_max_bytes()',                                                            'absent'),
    ('public._work_object(text)',                                                           'absent'),
    ('public._work_check_pages(jsonb)',                                                     'absent'),
    ('public._work_check_files(jsonb)',                                                     'absent'),
    ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', 'absent'),
    ('public._work_files_state(uuid,jsonb)',                                                'absent'),
    ('public._work_settle_files(uuid,jsonb)',                                               'absent'),
    ('public._work_upload_json(uuid)',                                                      'absent'),
    ('public._submission_json(uuid)',                                                       'absent'),
    ('public._assessment_work_json(uuid)',                                                  'absent'),
    ('public._submission_same_class()',                                                     'absent'),
    ('public._submission_file_removed()',                                                   'absent'),
    ('public._submission_target_gone()',                                                    'absent'),
    ('public._submission_gone()',                                                           'absent'),
    ('public._submission_truncated()',                                                      'absent'),
    ('public.set_course_send_work(uuid,jsonb,uuid)',                                        'absent'),
    ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'absent'),
    ('public.list_course_submissions(uuid)',                                                'absent'),
    ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 'absent'),
    ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'absent'),
    ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       'absent'),
    ('public.delete_submission(uuid,uuid)',                                                 'absent'),
    ('public.rotate_submission_page(uuid,integer,uuid)',                                    'absent'),
    ('fv_private.work_path_course(text)',                                                   'absent'),
    ('fv_private.work_upload_allowed(text)',                                                'absent'),
    ('fv_private.work_read_allowed(text)',                                                  'absent'),
    ('student_submit._grading_started(uuid,uuid)',                                          'absent'),
    ('student_submit._send_session(text,uuid)',                                             'absent'),
    ('student_submit._work_window(uuid)',                                                   'absent'),
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                'absent'),
    ('student_submit.work(text,uuid,text)',                                                 'absent'),
    ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'absent'),
    ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    'absent'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               'absent'),
    ('student_submit.unsend(text,uuid,uuid,text)',                                          'absent'),
    ('student_submit.file_links(text,uuid,uuid,text)',                                      'absent'),
    ('student_submit.removal_batch(integer)',                                               'absent'),
    ('student_submit.removal_done(bigint[])',                                               'absent')
    -- FINGERPRINTS-END
), hard(fn) as (values
    -- the five the first file compares itself and stops on
    ('student_submit._session_class(text,uuid)'), ('student_submit._device_session(text)'),
    ('student_submit._card_refusal(uuid)'), ('public._grade_return_lock(uuid)'), ('public._grade_return_lock_first(uuid)')
), found as (
    select e.fn, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') as is_now,
           case when e.fn in (select fn from hard) then 'yes' else 'no' end as stops
      from relied e
    union all
    select m.fn, m.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(m.fn))), 'absent'), 'yes'
      from made m
)
select 'function ' || fn as what, md5 as tested, is_now as found, stops
  from found
 where is_now <> md5
union all
select 'earlier migrations',
       'Batch A, S0-M4b, S0-M5 and S3-M1 applied',
       concat_ws(', ',
           case when to_regclass('public.student_card') is null or to_regclass('student_submit.device_session') is null
                     or to_regclass('public.grade_return') is null or to_regclass('public.course_sync_cursor') is null
                then 'Batch A is not all applied' end,
           case when to_regprocedure('public._grade_return_repair_class(uuid)') is null then 'S0-M4b is not applied' end,
           case when exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)', 'public.fv_owns_assessment(uuid)',
                                                        'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)']) x
                              where to_regprocedure(x) is null
                                 or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp'])
                then 'S0-M5 is not applied' end,
           case when to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null then 'S3-M1 is not applied' end),
       'yes'
 where to_regclass('public.student_card') is null or to_regclass('student_submit.device_session') is null
    or to_regclass('public.grade_return') is null or to_regclass('public.course_sync_cursor') is null
    or to_regprocedure('public._grade_return_repair_class(uuid)') is null
    or to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null
    or exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)', 'public.fv_owns_assessment(uuid)',
                                          'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)']) x
                where to_regprocedure(x) is null
                   or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp'])
union all
select 'a table the first file makes', 'absent', t, 'yes'
  from unnest(array['public.submission', 'public.submission_file', 'public.submission_file_removal', 'student_submit.send_log']) t
 where to_regclass(t) is not null
union all
select 'a column the first file adds', 'absent', c.oid::regclass::text || '.' || a.attname, 'yes'
  from pg_attribute a join pg_class c on c.oid = a.attrelid
 where not a.attisdropped
   and ((c.oid = to_regclass('public.course') and a.attname in ('send_work', 'keep_photos_until'))
     or (c.oid = to_regclass('public.assessment')
         and a.attname in ('students_send', 'after_due', 'accept_until', 'group_work', 'students_see_markup')))
union all
select 'a trigger name the first file uses', 'absent', t.tgrelid::regclass::text || ': ' || t.tgname, 'yes'
  from pg_trigger t
 where not t.tgisinternal and t.tgname in ('submission_gone', 'submission_truncate')
   and t.tgrelid in (to_regclass('public.assessment'), to_regclass('public.enrollment'))
union all
select 'storage.objects and storage.buckets',
       'both there, with bucket_id, name, metadata; id, name, public, file_size_limit, allowed_mime_types',
       'a table or a column is missing', 'yes'
 where to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
    or (select count(*) from pg_attribute where attrelid = to_regclass('storage.objects') and not attisdropped
                                             and attname in ('bucket_id', 'name', 'metadata')) <> 3
    or (select count(*) from pg_attribute where attrelid = to_regclass('storage.buckets') and not attisdropped
                                             and attname in ('id', 'name', 'public', 'file_size_limit', 'allowed_mime_types')) <> 5
union all
select 'row security on storage.objects', 'on', 'off', 'yes'
  from pg_class c where c.oid = to_regclass('storage.objects') and not c.relrowsecurity
union all
-- The first file's functions run as the role that applies it (postgres) and
-- read storage.objects, which has row security and belongs to Supabase's
-- storage role.
select 'the role postgres reads storage.objects past its row security', 'yes (it is a superuser, passes row security, or owns the table)', 'no', 'yes'
  from pg_roles r
 where r.rolname = 'postgres' and not r.rolsuper and not r.rolbypassrls
   and (select c.relowner from pg_class c where c.oid = to_regclass('storage.objects')) <> r.oid
union all
-- The edge functions ask the Storage API with the service key. If that role
-- did not pass row security, the bucket's policies would keep it out too,
-- and no upload link could be made.
select 'the service role passes row security', 'yes', 'no', 'no'
  from pg_roles r where r.rolname = 'service_role' and not r.rolbypassrls and not r.rolsuper
union all
select 'a bucket named student-photos', 'absent',
       'public ' || coalesce(b.public::text, 'null') || ', limit ' || coalesce(b.file_size_limit::text, 'none')
           || ', types ' || coalesce(b.allowed_mime_types::text, 'any'),
       case when b.public is distinct from false or b.file_size_limit is distinct from 2097152
                 or b.allowed_mime_types is distinct from array['image/jpeg'] then 'yes' else 'no' end
  from storage.buckets b where b.id = 'student-photos'
union all
-- Policies that allow are added together. One that is already there and is
-- not tied to another bucket is read with ours. (The second file's two
-- restrictive policies still fence student-photos whatever it says.)
select 'a policy already on storage.objects', 'none', p.polname || ' (' || case when p.polpermissive then 'allows' else 'restricts' end || ')', 'no'
  from pg_policy p where p.polrelid = to_regclass('storage.objects')
union all
select 'anon or signed-in teachers can enter schema student_submit', 'no', r, 'no'
  from unnest(array['anon', 'authenticated']) r
 where has_schema_privilege(r, 'student_submit', 'usage')
union all
select 'signed-in teachers can enter schema fv_private (storage asks the policies'' functions as them)', 'yes', 'no', 'no'
 where not has_schema_privilege('authenticated', 'fv_private', 'usage')
 order by 1, 2;

-- ── QUERY 2: what is there ──────────────────────────────────────────────────
-- One row. Expected on gradebook-prod, before the apply:
--   postgres            17.x
--   storage_migration   the newest of Supabase's own storage changes this
--                       project has (a name; any is fine)
--   sql_delete_refused  true or false. True: this project's storage refuses
--                       a DELETE on storage.objects from SQL. False: it
--                       would let one through and leave the file's bytes
--                       behind. Either way Batch B never issues one.
--   name_index          true: storage has its index on (bucket_id, name),
--                       which the new functions' look-ups use. False: they
--                       would still be right, and slow in a large bucket.
--   keeps_versions      true or false: whether storage.objects has the
--                       columns of the newer shape (archived_at,
--                       is_delete_marker). The functions read both shapes.
--   buckets, files, storage_policies
--                       0, 0, 0: the project has never used storage
--   classes, assessments
--                       how many rows the two ALTER TABLEs give new columns
--                       (every one gets the defaults: Send Work off,
--                       Students Send nothing)
--   pages_on            classes with the Student Page on
select current_setting('server_version') as postgres,
       (select m.name from storage.migrations m order by m.id desc limit 1) as storage_migration,
       exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('storage.objects') and t.tgname = 'protect_objects_delete') as sql_delete_refused,
       exists (select 1 from pg_indexes i where i.schemaname = 'storage' and i.tablename = 'objects'
                  and i.indexdef ~ '\(bucket_id, name( COLLATE "C")?\)') as name_index,
       exists (select 1 from pg_attribute a where a.attrelid = to_regclass('storage.objects') and a.attname = 'archived_at' and not a.attisdropped) as keeps_versions,
       (select count(*) from storage.buckets) as buckets,
       (select count(*) from storage.objects) as files,
       (select count(*) from pg_policy p where p.polrelid = to_regclass('storage.objects')) as storage_policies,
       (select count(*) from public.course) as classes,
       (select count(*) from public.assessment) as assessments,
       (select count(*) from public.course where student_page_enabled) as pages_on;
