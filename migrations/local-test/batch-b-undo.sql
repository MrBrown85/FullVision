-- BATCH B, UNDONE. Not a migration: the way back from
-- migrations/2026111101_student_work_submissions.sql and
-- migrations/2026111102_student_work_storage.sql (students send work). It is
-- kept under local-test/ so CI's drift check does not wait for it to be
-- applied. Proved by migrations/local-test/submissions_undo.py.
--
-- Two parts, each one transaction: all of it or none of it. Run PART 1 by
-- itself to stop sending and lose nothing. Run PART 2 only to take the
-- change itself out.
--
-- ── To stop sending without this script ─────────────────────────────────────
-- Batch B adds nothing to a grade's save, so there is nothing to switch off
-- for teachers. For one class: turn Send Work off in Class Settings, Student
-- Page. Students of that class are told sending is off at once; what they
-- sent stays, and the teacher can still open it.
--
-- ── PART 1: Send Work off for every class ───────────────────────────────────
-- One UPDATE: course.send_work becomes false wherever it is true. Its last
-- statement lists the classes it turned off, so they can be turned on again
-- by hand. Nothing is deleted: every submission, photo and setting stays,
-- and teachers can still see, add and grade work. Students can still see
-- their own pages; they cannot send, replace or unsend.
-- (Each class it changes is marked as changed, as any setting change is,
-- so a teacher's open tab reads its settings again.)
--
-- ── PART 2: take Batch B out ────────────────────────────────────────────────
-- IT DELETES every record of work handed in (who sent what and when, the
-- notes, Handed In on Paper), every class's Send Work and Keep Photos Until,
-- every assessment's Student Work settings, and the list of files deleted
-- so far. None of it can be brought back by anything but a database backup.
--
-- IT REFUSES WHILE THE BUCKET HOLDS A FILE. SQL cannot delete a file, and
-- dropping the tables would leave every photo in storage with nothing
-- pointing at it. So before PART 2, in this order:
--   1. PART 1 (nothing new arrives);
--   2. the student-submit function put back to the version from before the
--      send routes, and the site to a release from before the send screens
--      (otherwise they call functions that are gone and show an error);
--   3. every photo deleted. THIS IS THE STEP THAT CANNOT BE UNDONE: no copy
--      of a photo exists anywhere else. Run the statement between the two
--      marks below; it deletes every submission and so queues every file:
-- empty:
--   delete from public.submission;
-- end empty
--      then have the removal worker run until the queue is done, or empty
--      the bucket student-photos in the Supabase dashboard (Storage);
--   4. PART 2. Its first check counts the bucket's files and says how many
--      are left if any are.
-- It also refuses, with nothing changed, unless the database is exactly as
-- Batch B leaves it: each of its 39 functions by its fingerprint, no column,
-- index, constraint, trigger or policy added to its four tables since, and
-- no function it does not know naming one of its tables or columns
-- (something built on Batch B since, such as Batch C, would break: take
-- that out first).
-- Then, in one transaction:
--   the four policies on storage.objects are dropped;
--   the two triggers on assessment and the two on enrollment are dropped;
--   submission_file, submission, submission_file_removal and
--     student_submit.send_log are dropped;
--   the 39 functions are dropped;
--   the remembered answers of its teacher RPCs are deleted from
--     fv_idempotency (they hold storage paths);
--   course loses send_work and keep_photos_until; assessment loses
--     students_send, after_due, accept_until, group_work and
--     students_see_markup.
--
-- ── What is different afterwards from before Batch B ────────────────────────
-- The catalog (every table, column, index, constraint, trigger, policy,
-- grant and function) is identical, line for line, with one trace:
-- course keeps two and assessment five empty slots where the dropped
-- columns were (Postgres never reuses a column's slot; they hold nothing
-- and cost nothing). submissions_undo.py compares all of it with catalog.py.
-- No row of any table that existed before is changed, apart from each
-- class's "changed" mark (course_sync_cursor) if PART 1 turned it off.
-- NOT touched: scores, grades, Draft and Returned, cards, sessions, slips.
--
-- ── What it leaves, and does not do ─────────────────────────────────────────
--   The bucket. student-photos stays, empty, private, with no policy: no
--     teacher and no student can reach it. Delete it in the Supabase
--     dashboard (Storage) to finish. (A bucket is deleted through the
--     Storage API, like a file.)
--   The migration records. supabase_migrations.schema_migrations still
--     lists both files as applied, so CI's "never applied" check goes on
--     passing though they are no longer in the database, and CI's schema
--     snapshot check fails until docs/schema.generated.sql is regenerated.
--     To make the record true as well, run this separately afterwards (look
--     first with a select of the same rows); CI then asks for the files to
--     be applied again or to leave migrations/:
-- record:
--   delete from supabase_migrations.schema_migrations where name in ('student_work_submissions', 'student_work_storage');
-- end record
--
-- After PART 2 both files apply again cleanly (tested). PART 2 cannot be run
-- twice: the second time the database is no longer as Batch B leaves it,
-- and it says so and changes nothing.

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: Send Work off for every class. Nothing is deleted.
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
create temporary table batch_b_turned_off on commit drop as
    select c.id, c.name from public.course c where c.send_work;
update public.course set send_work = false where send_work;
-- The classes it turned off (turn them on again in Class Settings, or with
-- update public.course set send_work = true where id in (...)).
select id, name from batch_b_turned_off order by name, id;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: take Batch B out. Read the header first.
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
declare
    _f    record;
    _md5  text;
    _n    bigint;
    _left text;
    _known constant text[] := array[
        -- FINGERPRINTS-BEGIN names
        'public._work_bucket()',
        'public._work_max_bytes()',
        'public._work_object(text)',
        'public._work_check_pages(jsonb)',
        'public._work_check_files(jsonb)',
        'public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)',
        'public._work_files_state(uuid,jsonb)',
        'public._work_settle_files(uuid,jsonb)',
        'public._work_upload_json(uuid)',
        'public._submission_json(uuid)',
        'public._assessment_work_json(uuid)',
        'public._submission_same_class()',
        'public._submission_file_removed()',
        'public._submission_target_gone()',
        'public._submission_gone()',
        'public._submission_truncated()',
        'public.set_course_send_work(uuid,jsonb,uuid)',
        'public.set_assessment_student_work(uuid,jsonb,uuid)',
        'public.list_course_submissions(uuid)',
        'public.start_work_upload(uuid,uuid,jsonb,text,uuid)',
        'public.finish_work_upload(uuid,jsonb,uuid)',
        'public.mark_handed_in_paper(uuid,uuid[],uuid)',
        'public.delete_submission(uuid,uuid)',
        'public.rotate_submission_page(uuid,integer,uuid)',
        'fv_private.work_path_course(text)',
        'fv_private.work_upload_allowed(text)',
        'fv_private.work_read_allowed(text)',
        'student_submit._grading_started(uuid,uuid)',
        'student_submit._send_session(text,uuid)',
        'student_submit._work_window(uuid)',
        'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
        'student_submit.work(text,uuid,text)',
        'student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',
        'student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',
        'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
        'student_submit.unsend(text,uuid,uuid,text)',
        'student_submit.file_links(text,uuid,uuid,text)',
        'student_submit.removal_batch(integer)',
        'student_submit.removal_done(bigint[])'
        -- FINGERPRINTS-END
    ];
begin
    if to_regclass('public.submission') is null then
        raise exception 'Batch B is not applied (public.submission is not there). Nothing was changed.';
    end if;
    -- Every function is exactly as Batch B leaves it.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
            ('public._work_object(text)',                                                           'e52420e0be52353b1208dbc395ae9e5c'),
            ('public._work_check_pages(jsonb)',                                                     '4f17b090aea75e8d9d9b296f99f0f5a8'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '57e75c6fa0bbbd12a04e11d21752bc5b'),
            ('public._work_files_state(uuid,jsonb)',                                                '975d75466b7b1dd7100240028441bea8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_json(uuid)',                                                       '2d20f60def0f309725f16b7b86477fab'),
            ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
            ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
            ('public._submission_file_removed()',                                                   '6baa9df0a3f31f3f7a55bb7771c4e8a9'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
            ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
            ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
            ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
            ('public.list_course_submissions(uuid)',                                                '8703f5ddc09b3c8dc92aa70878b5d7b1'),
            ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 'ef4590b75c38b428fcdb81b92a2407f3'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'd62a6e550d7535f123f58b17cfe838f2'),
            ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '1a966bceb2e46eb59107e2753e731bd4'),
            ('public.delete_submission(uuid,uuid)',                                                 '7da38ac3304aaf2f9639877b3fd0f81a'),
            ('public.rotate_submission_page(uuid,integer,uuid)',                                    'e684b853403b25a1706d29f02a581d5c'),
            ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_upload_allowed(text)',                                                '02b678a47cb50ef6bf233a0ff244b51c'),
            ('fv_private.work_read_allowed(text)',                                                  'd5462a39d4090cdd6c2d1e8df067729c'),
            ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '751249a78b6c05e4927d17805e5423fa'),
            ('student_submit.work(text,uuid,text)',                                                 '72233e7985f93eb6a150c1822ed69d14'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               '1b9663c49c49714ec7de2f43e872b0cd'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '719b3aef45f8946343138924b84a03e9'),
            ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
            ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not as Batch B leaves it (found %, expected %): something has changed it since. Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;

    -- No file may be left in the bucket.
    select count(*) into _n from storage.objects o where o.bucket_id = 'student-photos';
    if _n > 0 then
        raise exception 'the bucket student-photos still holds % files. SQL cannot delete a file, and dropping the tables would leave them with nothing pointing at them. Delete them first (the header says how). Nothing was changed.', _n;
    end if;
    select count(*) into _n from public.submission_file;
    if _n > 0 then
        raise exception 'there are still % pages of work handed in. Delete the submissions first (the header says how). Nothing was changed.', _n;
    end if;

    -- Nothing has been built on Batch B's tables: exactly its own columns,
    -- constraints, indexes, triggers and policies.
    select string_agg(x, '; ' order by x) into _left from (
        select c.oid::regclass::text || ' columns: ' || string_agg(a.attname, ', ' order by a.attnum) as x
          from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         where c.oid in ('public.submission'::regclass, 'public.submission_file'::regclass,
                         'public.submission_file_removal'::regclass, 'student_submit.send_log'::regclass)
         group by c.oid
        having string_agg(a.attname, ', ' order by a.attnum) not in (
            'id, course_id, assessment_id, enrollment_id, version, state, intent, target_id, sent_by, on_paper, note, followed_plan, is_late, card_id, request_id, created_at, sent_at, updated_at',
            'id, submission_id, page, path, thumb_path, bytes, thumb_bytes, width, height, sha256, rotation, created_at',
            'id, bucket, path, course_id, reason, queued_at, link_dies_at, tries, last_try_at, removed_at, done',
            'id, card_id, at')
        union all
        select t.tgrelid::regclass::text || ' trigger ' || t.tgname
          from pg_trigger t
         where not t.tgisinternal
           and t.tgrelid in ('public.submission'::regclass, 'public.submission_file'::regclass,
                             'public.submission_file_removal'::regclass, 'student_submit.send_log'::regclass)
           and t.tgname not in ('submission_same_class', 'submission_target_gone', 'submission_file_removed')
        union all
        select p.polrelid::regclass::text || ' policy ' || p.polname
          from pg_policy p
         where p.polrelid in ('public.submission'::regclass, 'public.submission_file'::regclass,
                              'public.submission_file_removal'::regclass, 'student_submit.send_log'::regclass)
        union all
        select co.conrelid::regclass::text || ' constraint ' || co.conname
          from pg_constraint co
         where (co.confrelid in ('public.submission'::regclass, 'public.submission_file'::regclass)
                and co.conname <> 'submission_file_submission_id_fkey')
        union all
        select i.indrelid::regclass::text || ' index ' || ic.relname
          from pg_index i join pg_class ic on ic.oid = i.indexrelid
         where i.indrelid in ('public.submission'::regclass, 'public.submission_file'::regclass,
                              'public.submission_file_removal'::regclass, 'student_submit.send_log'::regclass)
           and ic.relname not in (
               'submission_pkey', 'submission_one_sent', 'submission_one_sending', 'submission_enrollment_idx', 'submission_course_idx',
               'submission_target_idx', 'submission_file_pkey', 'submission_file_path_key', 'submission_file_thumb_path_key',
               'submission_file_page_key', 'submission_file_removal_pkey', 'submission_file_removal_path_key',
               'submission_file_removal_todo', 'send_log_pkey', 'send_log_card_at', 'send_log_at')
    ) s;
    if _left is not null then
        raise exception 'something has been added to Batch B''s tables since: %. Nothing was changed.', _left;
    end if;
    -- No function this script does not know names one of Batch B's tables,
    -- columns or functions (comments left out).
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'storage') and p.prokind in ('f', 'p')
       and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g')
           ~ '\m(submission|submission_file|submission_file_removal|send_log|send_work|keep_photos_until|students_send|after_due|accept_until|group_work|students_see_markup|_work_\w+|work_upload_allowed|work_read_allowed|work_path_course|_grading_started|_send_session|_send_begin)\M'
       and p.oid not in (select to_regprocedure(x)::oid from unnest(_known) x where to_regprocedure(x) is not null);
    if _left is not null then
        raise exception 'a function this script does not know uses something of Batch B''s: %. It would break. Take it out first. Nothing was changed.', _left;
    end if;
end
$guard$;

-- The policies on storage.objects. The bucket itself stays (see the header).
drop policy if exists fv_student_photos_read on storage.objects;
drop policy if exists fv_student_photos_upload on storage.objects;
drop policy if exists fv_student_photos_fence on storage.objects;
drop policy if exists fv_student_photos_teachers_only on storage.objects;

-- The triggers on the two tables that were there before.
drop trigger if exists submission_gone on public.assessment;
drop trigger if exists submission_truncate on public.assessment;
drop trigger if exists submission_gone on public.enrollment;
drop trigger if exists submission_truncate on public.enrollment;

-- The tables (their own triggers and indexes go with them).
drop table public.submission_file;
drop table public.submission;
drop table public.submission_file_removal;
drop table student_submit.send_log;

-- The functions.
do $drop$
declare
    _fn text;
begin
    foreach _fn in array array[
        -- FINGERPRINTS-BEGIN names
        'public._work_bucket()',
        'public._work_max_bytes()',
        'public._work_object(text)',
        'public._work_check_pages(jsonb)',
        'public._work_check_files(jsonb)',
        'public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)',
        'public._work_files_state(uuid,jsonb)',
        'public._work_settle_files(uuid,jsonb)',
        'public._work_upload_json(uuid)',
        'public._submission_json(uuid)',
        'public._assessment_work_json(uuid)',
        'public._submission_same_class()',
        'public._submission_file_removed()',
        'public._submission_target_gone()',
        'public._submission_gone()',
        'public._submission_truncated()',
        'public.set_course_send_work(uuid,jsonb,uuid)',
        'public.set_assessment_student_work(uuid,jsonb,uuid)',
        'public.list_course_submissions(uuid)',
        'public.start_work_upload(uuid,uuid,jsonb,text,uuid)',
        'public.finish_work_upload(uuid,jsonb,uuid)',
        'public.mark_handed_in_paper(uuid,uuid[],uuid)',
        'public.delete_submission(uuid,uuid)',
        'public.rotate_submission_page(uuid,integer,uuid)',
        'fv_private.work_path_course(text)',
        'fv_private.work_upload_allowed(text)',
        'fv_private.work_read_allowed(text)',
        'student_submit._grading_started(uuid,uuid)',
        'student_submit._send_session(text,uuid)',
        'student_submit._work_window(uuid)',
        'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
        'student_submit.work(text,uuid,text)',
        'student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',
        'student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',
        'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
        'student_submit.unsend(text,uuid,uuid,text)',
        'student_submit.file_links(text,uuid,uuid,text)',
        'student_submit.removal_batch(integer)',
        'student_submit.removal_done(bigint[])'
        -- FINGERPRINTS-END
    ] loop
        execute 'drop function ' || _fn;
    end loop;
end
$drop$;

-- What the teacher RPCs remembered (their answers hold storage paths).
delete from public.fv_idempotency
 where endpoint in ('set_course_send_work', 'set_assessment_student_work', 'start_work_upload', 'finish_work_upload',
                    'mark_handed_in_paper', 'delete_submission', 'rotate_submission_page');

-- The columns.
alter table public.assessment
    drop constraint assessment_accept_until_check,
    drop column students_send, drop column after_due, drop column accept_until,
    drop column group_work, drop column students_see_markup;
alter table public.course drop column send_work, drop column keep_photos_until;

do $final$
declare
    _left text;
begin
    select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into _left
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'student_submit' and p.proname in ('work', 'send_start', 'send_finish', 'replace', 'unsend', 'file_links',
                                                          'removal_batch', 'removal_done', '_grading_started', '_send_session',
                                                          '_work_window', '_send_begin'))
        or (n.nspname = 'public' and (p.proname like '\_work\_%' or p.proname like '\_submission\_%' or p.proname = '_assessment_work_json'
                                      or p.proname in ('set_course_send_work', 'set_assessment_student_work', 'list_course_submissions',
                                                       'start_work_upload', 'finish_work_upload', 'mark_handed_in_paper',
                                                       'delete_submission', 'rotate_submission_page')))
        or (n.nspname = 'fv_private' and p.proname like 'work\_%');
    if _left is not null then
        raise exception 'a function of Batch B is still there: %. Nothing was changed.', _left;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname like 'fv\_student\_photos\_%') then
        raise exception 'a policy of Batch B is still on storage.objects. Nothing was changed.';
    end if;
end
$final$;

notify pgrst, 'reload schema';

commit;
