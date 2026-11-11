-- Students send work: the bucket and who may touch its files (2026-11-11).
-- Student page build plan, S5-M2 (Batch B).
-- docs/plans/student-page-build-plan.md 1.7; DECISIONS, "Grades, photos and
-- sign-in on the student page" 6 to 8 and "Student page build answers" 2.
-- Apply after 2026111101_student_work_submissions.sql; its first check stops
-- it otherwise.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. ONE BUCKET, student-photos: private, 2 MB a file (2097152 bytes),
--    JPEG only. Every page of student work and its thumbnail go there, one
--    folder per class. A PDF never arrives: the browser turns each page
--    into a JPEG and the PDF is not kept (DECISIONS, "Student page build
--    answers" 2), so there is no second bucket for files. (The plan's line
--    for this file still says "the two buckets"; its section 1.7 and that
--    decision say one. Raised with the owner in the pull request.)
--    The bucket is in the project's region, ca-central-1: Supabase Storage
--    keeps a project's files where the project is.
-- 2. FOUR POLICIES on storage.objects, all for this bucket only.
--    Two that allow, for signed-in teachers:
--      fv_student_photos_read    read any file under a class they own (the
--                                path's first folder is the class's id)
--      fv_student_photos_upload  write one exact path: a page, or its
--                                thumbnail, of an upload that teacher has
--                                started (start_work_upload) and not
--                                finished
--    Two that restrict, whatever other policy is ever added to
--    storage.objects (policies that allow are added together, so without
--    these one careless policy would open the bucket):
--      fv_student_photos_teachers_only  in this bucket nobody but a
--                                signed-in teacher gets past row security
--      fv_student_photos_fence   and a signed-in teacher only as the two
--                                policies above say
--    NOTHING lets a teacher's browser change, move or delete a file, and
--    nothing lets anyone who is not signed in as a teacher read, list or
--    write one.
--
-- ── How each kind of access is decided ──────────────────────────────────────
-- (From Supabase's documentation and the Storage service's source, read
-- 2026-11-10. The service is not run in the local tests: see "What the
-- local tests cannot prove" in migrations/local-test/README.md, Batch B.)
--   A STUDENT'S UPLOAD. Students have no storage role. The edge function,
--     holding the service key, asks the Storage API for a signed upload
--     link for one path the database named (student_submit.send_start).
--     The link is bound to that bucket and path and is good for two hours.
--     The upload itself is carried out by the Storage service under its own
--     role, so none of the policies here is asked: what limits it is the
--     link (one path), the bucket (2 MB; a Content-Type of image/jpeg) and
--     that a path already holding a file is refused. The type is what the
--     upload says it is; the service does not look at the bytes. The edge
--     function looks at them before it calls send_finish (S5-F4).
--   A STUDENT'S READ. The edge function makes a short-lived download link
--     for each path student_submit.file_links returns, and for no other.
--   A TEACHER'S READ AND UPLOAD. The browser asks the Storage API signed
--     in; the service runs the query as that teacher, and the policies
--     decide.
--   DELETING. Only through the Storage API with the service key, for paths
--     in public.submission_file_removal. No policy allows a delete, and SQL
--     cannot delete a file at all.
-- The service key (the service_role) passes row security on Supabase, so
-- the policies do not limit the edge functions; what limits them is which
-- paths the database hands them.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing. The project has never used storage: no bucket, no file, no
-- policy (the pre-check counts them).
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless:
--   the first file is applied, and the three functions the policies call
--     are exactly the ones tested (the list is in the first check below);
--   storage.buckets and storage.objects have the columns it uses, and row
--     security is ON for storage.objects;
--   a bucket named student-photos, if there is one, is already private,
--     2097152 bytes and image/jpeg only; and on a first run it holds no
--     file.
-- Its last step checks the bucket and the four policies are there.
--
-- Can be run again: the bucket is left as it is and the four policies are
-- made again, the same. If the bucket's settings were changed by hand since,
-- it stops and says so rather than leave them or quietly put them back.
--
-- ── What it needs that only the live database can show ──────────────────────
-- That the role applying it may create a policy on storage.objects and a row
-- in storage.buckets (Supabase's guide and its changelog of 2025-04-21 say
-- it may), and that the service role passes row security (the pre-check
-- reads both roles). If either statement is refused the file stops there
-- and nothing of it is applied.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/batch-b-undo.sql, PART 2: the four policies are
-- dropped. The bucket is left, empty and private, to be deleted in the
-- Supabase dashboard (a bucket, like a file, is deleted through the Storage
-- API).
--
-- One transaction: begin first, commit last; every check that can stop it
-- runs before anything is created.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f     record;
    _md5   text;
    _first boolean;
    _b     record;
begin
    if to_regclass('public.submission') is null or to_regclass('public.submission_file') is null then
        raise exception '2026111101_student_work_submissions.sql is not applied: apply it, then this file. Nothing was changed.';
    end if;
    -- What the policies below ask is decided by these three functions. They
    -- must be exactly the ones the tests ran against.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN policy (written by migrations/local-test/submissions_fingerprints.py)
            ('fv_private.work_path_course(text)',    '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_upload_allowed(text)', '02b678a47cb50ef6bf233a0ff244b51c'),
            ('fv_private.work_read_allowed(text)',   '3ea2b37a835c7a86a881ed743b95d1c9')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;

    -- Supabase's storage tables, with the columns this file writes and reads.
    if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null
       or (select count(*) from pg_attribute
            where attrelid = to_regclass('storage.buckets') and not attisdropped
              and attname in ('id', 'name', 'public', 'file_size_limit', 'allowed_mime_types', 'versioning_status')) <> 6
       or (select count(*) from pg_attribute
            where attrelid = to_regclass('storage.objects') and not attisdropped
              and attname in ('bucket_id', 'name')) <> 2 then
        raise exception 'storage.buckets or storage.objects is not the shape this file was written for. Nothing was changed.';
    end if;
    -- Without row security on storage.objects no policy protects anything.
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
        raise exception 'storage.objects has row security turned off: every signed-in user could read every file. Nothing was changed.';
    end if;

    _first := not exists (select 1 from pg_policy p
                           where p.polrelid = 'storage.objects'::regclass and p.polname like 'fv\_student\_photos\_%');
    select b.public, b.file_size_limit, b.allowed_mime_types, b.versioning_status into _b from storage.buckets b where b.id = 'student-photos';
    if found and (_b.public is distinct from false or _b.file_size_limit is distinct from 2097152
                  or _b.allowed_mime_types is distinct from array['image/jpeg']
                  or _b.versioning_status is distinct from 'DISABLED') then
        raise exception 'a bucket named student-photos exists and is not private, limited to 2097152 bytes and to image/jpeg, with versioning DISABLED (found public %, limit %, types %, versioning %). Put it right or remove it through the Storage API, then run this file. (Versioning cannot be turned back off: such a bucket has to be removed.) Nothing was changed.',
            _b.public, _b.file_size_limit, _b.allowed_mime_types, _b.versioning_status;
    end if;
    if _first and exists (select 1 from storage.objects o where o.bucket_id = 'student-photos') then
        raise exception 'the bucket student-photos already holds files, and this file has not been applied: something else put them there. Nothing was changed.';
    end if;
end
$guard$;

-- ── 1. The bucket ───────────────────────────────────────────────────────────
-- Private. The Storage service refuses a file over 2 MB (2097152 bytes) and
-- any upload that does not say it is a JPEG. Made by a row, as Supabase's
-- own guide does; the bucket lives in the project's region. Its versioning
-- is the column's own default, DISABLED, and its two lifecycle columns are
-- left null (storage refuses an insert that sets them): no old version of a
-- file is kept, so a file that is deleted is gone. The last step checks the
-- row came out that way.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- ── 2. Who may touch its files ──────────────────────────────────────────────
-- Storage checks these as the signed-in teacher. The service role (the edge
-- functions) and the Storage service itself are not subject to them: a
-- student's upload link is made with the service key, for one path the
-- database named, and the upload itself is done by the Storage service.
--
-- Two policies that allow:
--   read     any file under a class the teacher owns (the path's first folder)
--   upload   one exact path: a page, or its thumbnail, of an upload that
--            teacher has started with start_work_upload and not finished
-- Nothing allows a teacher to change, move or delete a file. A file is
-- deleted only by the service role, working down submission_file_removal.
drop policy if exists fv_student_photos_read on storage.objects;
create policy fv_student_photos_read on storage.objects
    for select to authenticated
    using (bucket_id = 'student-photos' and fv_private.work_read_allowed(name));

drop policy if exists fv_student_photos_upload on storage.objects;
create policy fv_student_photos_upload on storage.objects
    for insert to authenticated
    with check (bucket_id = 'student-photos' and fv_private.work_upload_allowed(name));

-- Two that restrict, whatever other policy storage.objects is given later.
-- Policies that allow are added together, so one careless policy ("any
-- signed-in user may read storage") would open this bucket to every
-- teacher. A restrictive policy must hold as well as any that allows:
--   teachers_only  in this bucket, nobody but a signed-in teacher gets past
--                  row security at all (the anonymous role calls no function
--                  here, so it needs no right to run one)
--   fence          and a signed-in teacher only as the two policies above say
drop policy if exists fv_student_photos_teachers_only on storage.objects;
create policy fv_student_photos_teachers_only on storage.objects
    as restrictive for all to public
    using (bucket_id is distinct from 'student-photos' or current_user = 'authenticated')
    with check (bucket_id is distinct from 'student-photos' or current_user = 'authenticated');

drop policy if exists fv_student_photos_fence on storage.objects;
create policy fv_student_photos_fence on storage.objects
    as restrictive for all to authenticated
    using (bucket_id is distinct from 'student-photos' or fv_private.work_read_allowed(name))
    with check (bucket_id is distinct from 'student-photos' or fv_private.work_upload_allowed(name));

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _b record;
    _n int;
begin
    select b.public, b.file_size_limit, b.allowed_mime_types, b.versioning_status into _b from storage.buckets b where b.id = 'student-photos';
    if not found or _b.public is distinct from false or _b.file_size_limit is distinct from 2097152
       or _b.allowed_mime_types is distinct from array['image/jpeg'] or _b.versioning_status is distinct from 'DISABLED' then
        raise exception 'the bucket student-photos is not private, limited to 2097152 bytes and to image/jpeg, with versioning DISABLED. Nothing was changed.';
    end if;
    select count(*) into _n from pg_policy p
     where p.polrelid = 'storage.objects'::regclass
       and (p.polname, p.polcmd, p.polpermissive) in (('fv_student_photos_read', 'r', true), ('fv_student_photos_upload', 'a', true),
                                                      ('fv_student_photos_teachers_only', '*', false), ('fv_student_photos_fence', '*', false));
    if _n <> 4 then
        raise exception 'the four policies on storage.objects are not all there (found %). Nothing was changed.', _n;
    end if;
end
$final$;

commit;
