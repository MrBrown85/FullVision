-- HEADER-PLACEHOLDER
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
            ('fv_private.work_read_allowed(text)',   'd5462a39d4090cdd6c2d1e8df067729c')
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
              and attname in ('id', 'name', 'public', 'file_size_limit', 'allowed_mime_types')) <> 5
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
    select b.public, b.file_size_limit, b.allowed_mime_types into _b from storage.buckets b where b.id = 'student-photos';
    if found and (_b.public is distinct from false or _b.file_size_limit is distinct from 2097152
                  or _b.allowed_mime_types is distinct from array['image/jpeg']) then
        raise exception 'a bucket named student-photos exists and is not private, limited to 2097152 bytes and to image/jpeg (found public %, limit %, types %). Put it right or remove it through the Storage API, then run this file. Nothing was changed.',
            _b.public, _b.file_size_limit, _b.allowed_mime_types;
    end if;
    if _first and exists (select 1 from storage.objects o where o.bucket_id = 'student-photos') then
        raise exception 'the bucket student-photos already holds files, and this file has not been applied: something else put them there. Nothing was changed.';
    end if;
end
$guard$;

-- ── 1. The bucket ───────────────────────────────────────────────────────────
-- Private. The Storage service refuses a file over 2 MB (2097152 bytes) and
-- any upload that does not say it is a JPEG. Made by a row, as Supabase's
-- own guide does; the bucket lives in the project's region.
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
    select b.public, b.file_size_limit, b.allowed_mime_types into _b from storage.buckets b where b.id = 'student-photos';
    if not found or _b.public is distinct from false or _b.file_size_limit is distinct from 2097152
       or _b.allowed_mime_types is distinct from array['image/jpeg'] then
        raise exception 'the bucket student-photos is not private, limited to 2097152 bytes and to image/jpeg. Nothing was changed.';
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
