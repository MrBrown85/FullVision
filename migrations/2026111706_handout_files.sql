-- Handout files: a web page, a text file or an EPUB on an assessment (2026-11-17).
-- Colin, Nov 17 ("Yes, build it"): "+ Add a PDF" becomes "+ Add a File". A PDF works as it does
-- (its pages, 2026111170). Any other file is kept as uploaded and opens on the student page by its
-- kind. Contract: migrations/local-test/handouts-links-contract.md, "Handout files". Apply after
-- 2026111705_photo_expiry_warning.sql (live since Nov 17); the first check stops it otherwise.
--
-- ── Why a second bucket ─────────────────────────────────────────────────────
-- Students upload into student-photos, so it stays as strict as it is (private, JPEG only, 2 MB).
-- A handout file gets a bucket of its own in the same project (same region: student data stays in
-- Canada; no new party, no new key): handout-files, private, 20 MB a file (20971520 bytes), only
-- text/html, text/plain and application/epub+zip. A file's name is <class id>/<resource id>.<kind>,
-- made from its row in one place (_handout_file_path).
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. assessment_resource: kinds 'html', 'txt' and 'epub', and a column bytes (a file's size, 1 to
--    20971520; null for a PDF or a link). A file is 'uploading' from its start until it is in
--    storage, then 'ready', as a PDF is. The 50-a-piece limit counts files too.
-- 2. The bucket, and four policies on storage.objects for it, the shape of student-photos' (2026111102):
--      fv_handout_files_read           a signed-in teacher reads a file in a class they own
--      fv_handout_files_upload         and writes one exact name: the file of their handout still
--                                      'uploading', for two hours from its start. No policy allows an
--                                      update or a delete, so no overwrite.
--      fv_handout_files_teachers_only  (restricting) only a signed-in teacher passes in this bucket
--      fv_handout_files_fence          (restricting) and only as the two above allow
--    Students have no storage role: the edge function signs a 60-second link for the one file
--    student_submit.handout_file names.
-- 3. For a signed-in teacher (each write takes p_idempotency_key):
--      start_handout_file(assessment, title, kind, bytes, key)  the row, with bucket, path, finish_by
--      finish_handout_file(resource, key)  'ready' once the file is stored with its kind's type and
--          within 20 MB (bytes becomes the stored size); else still 'uploading' with missing: true or
--          bad: true; { id, status: 'gone' } when the handout is not there
--    Remove and the list stay remove_assessment_resource and list_course_resources.
-- 4. student_submit.handout_file(session, enrollment, resource, ip hash), service role only: the one
--    file's path, kind, size and title, under handout_links' checks (the session's class, ready, the
--    piece listed by student_submit._listed).
-- 5. Helpers nobody is granted, and the two the policies call (signed-in teachers only).
--
-- ── What it changes that exists ─────────────────────────────────────────────
-- Five functions, each only if it is exactly as live had it on Nov 17 (migrations/baseline):
--   _assessment_resource_json    a file's row also carries bytes and path (a PDF's and a link's as before)
--   _assessment_resource_removed a file's row going, by any path (Remove, its assessment deleted, the
--                                purge of its class or teacher, an upload not finished in two hours),
--                                queues its file in submission_file_removal, bucket handout-files
--   _handout_drop_expired        drops an unfinished file upload too
--   student_submit.removal_done  asks "gone from storage?" of the row's own bucket (it asked
--                                student-photos only, so a handout file would be marked done unseen)
--   photo_lifecycle_nightly      also visits a class with a handout still uploading, so one never
--                                finished is dropped that night in a class with no photos
-- And the two constraints assessment_resource_kind_check and _shape_check, made again with the new kinds.
-- Keep Photos Until (_photo_keep_class) deletes submission_file rows only and _photo_strays looks only
-- in student-photos: neither can delete a handout file early, and neither changes. student_submit.page
-- already sends each ready resource's kind; it does not change.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing: every existing row gets bytes null, as a PDF and a link must have. No file is touched.
--
-- ── What applying it accepts ────────────────────────────────────────────────
--   THE EDGE FUNCTION MUST BE DEPLOYED BEFORE THE APP USES THIS: until then the worker skips a
--   handout file (the nightly job reports it stuck after six hours) and students cannot open one.
--   Until the app's release nothing adds a file, so applying this alone is safe.
--   The project's own upload limit (Storage settings) must be 20 MB or more (default 50 MB).
--   A file is not checked beyond its type and size; the student page shows a web page or a book only
--   in a sealed frame (no access to the page, its session or its storage).
--   Copies of an assessment do not carry handout files, as they carry no PDFs or links.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless 2026111705 is applied; every function it calls or replaces
-- is the one it was tested against (md5 of pg_get_functiondef, written by
-- migrations/local-test/handout_files.py fingerprints); none of its names is taken (or, on a second
-- run, each is as it leaves it); assessment_resource and its constraints are as 2026111170 made
-- them; storage.objects has row security on and the six policies; a bucket handout-files, if there,
-- has these settings and holds no file. Its last step checks everything came out as written.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- assessment_resource and storage.objects, for a moment; it gives up after five seconds with nothing
-- applied if a long transaction holds one: run it again.
--
-- ── How to apply ────────────────────────────────────────────────────────────
-- Only on the owner's OK (rule 1). Tested on a throwaway PostgreSQL 17 (local-test/README.md).
--   1. local-test/handout-files-live-precheck.sql, read-only. Expected: no rows.
--   2. This whole file as one migration named handout_files (one transaction).
--   3. local-test/handout-files-live-postcheck.sql. Every row ok.
-- Undo: local-test/handout-files-undo.sql. PART 0 stops new files (ready ones still open and can be
-- removed); the rest puts the five functions and two constraints back word for word and drops what
-- this file made, refusing while a file is held. The bucket is left (deleted through the Storage API).
begin;

set local lock_timeout = '5s';
-- md5 of pg_get_functiondef depends on the search path (student_submit._listed takes a
-- public.assessment, printed as "assessment" only while public is on it): fixed here as
-- the tests and the pre-check ran.
set local search_path = public, pg_temp;

do $guard$
declare
    _f   record;
    _md5 text;
    _b   record;
    _c   text;
begin
    if to_regprocedure('public.list_course_photo_expiry()') is null or to_regclass('public.assessment_resource') is null then
        raise exception '2026111705_photo_expiry_warning.sql (and 2026111170) are not applied: apply them first. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/handout_files.py)
            ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
            ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
            ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
            ('public._grade_return_lock(uuid)', '530dca441198b1546a4ec4967cd83b9f'),
            ('public._grade_return_lock_first(uuid)', '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
            ('public._work_bucket()', '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_hold()', 'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._handout_path(uuid,uuid,integer)', '90e3c0e7b44ef1cc8fb3ad1b8b0bc222'),
            ('public._assessment_resource_same_class()', '1d661e6e1a34b6c2a82735f439fdc064'),
            ('public._assessment_resource_gone()', 'e7b0e2e222ddd148422248e7e96ce425'),
            ('public._assessment_resource_truncated()', '5d4a8ca2dd10909f2d669927b2a5bba6'),
            ('public.remove_assessment_resource(uuid,uuid)', 'ceaa38e29071d14b04ba0240c1a9589e'),
            ('public.list_course_resources(uuid)', 'aedc2494e8d6236cc287a0c1afc9b412'),
            ('public.start_handout_upload(uuid,text,integer,uuid)', 'ac3c7d7c3a3f8d30eec287fed2c510ec'),
            ('public.finish_handout_upload(uuid,uuid)', '03444c3bd55e4826285eeac20bdcfc40'),
            ('public._photo_keep_class(uuid,timestamp with time zone)', '67d1ae88eeacd34543cc0a80f1055991'),
            ('public._photo_strays(uuid,timestamp with time zone)', '54ffc47d26beeeb480a2430cd57f8f1e'),
            ('public._photo_missing(uuid)', 'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_stuck()', '8f35709beffa04b59f36840e2d4e2fa0'),
            ('public._photo_log(uuid,text,integer,jsonb)', '53859922b32f0e4f2da95052edc130e2'),
            ('public.delete_assessment(uuid)', 'b0557c759c662175194a75bff27c7001'),
            ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39'),
            ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit._listed(assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
            ('student_submit.removal_batch(integer)', '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.handout_links(text,uuid,uuid,text)', '410877d7e4d5b860b8dadb4c1b185f3c'),
            ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The five it replaces: as live had them, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/handout_files.py)
            ('public._assessment_resource_json(uuid)', '216a6f09d7632edc558686e66a14d086', 'ba262085f68a12f1320aa12cebf2f4af'),
            ('public._assessment_resource_removed()', '331dd8c1a4915e28e1a9ee2131991a93', 'becec68516a8cd68cccc383cf71325f7'),
            ('public._handout_drop_expired(uuid)', 'b73cf6fbb7b2b44d1c308d3cca1dfbaf', '2a89c8ea4984d1832f3dd4370756f253'),
            ('student_submit.removal_done(bigint[])', 'de793c82a2b5aa59052994a82e80d166', '0414f8b4f5b2429c1799dde1a68179d3'),
            ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26', '511904d486e08f495f2823aefd80b7e9')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- What it adds: absent, or as this file leaves it (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/handout_files.py)
            ('public._handout_file_bucket()', 'f7ed7b1fe72127f538fcc133ebf7e423'),
            ('public._handout_file_max_bytes()', '587c06ecb2e6fa6980dfc027eae9ea00'),
            ('public._handout_file_mime(text)', '234e3efb8c0358be67c1705dea81fac1'),
            ('public._handout_file_path(uuid,uuid,text)', '72ad6e9a0c48f4243ba66a03a42427b0'),
            ('fv_private.handout_file_path_parts(text)', '185ad3fd3fc9ae84d6ae747f54a3423f'),
            ('public._handout_file_object(text)', '797abf1f084660a2cf8254d712f7e040'),
            ('fv_private.handout_file_upload_allowed(text)', 'fd3ee2b395e774629f6e8d2c53a36e59'),
            ('fv_private.handout_file_read_allowed(text)', '01f9d53fbc7b87536957dca9984103be'),
            ('public.start_handout_file(uuid,text,text,bigint,uuid)', 'cfe44806c71f0927070a4299bef64dd6'),
            ('public.finish_handout_file(uuid,uuid)', '88338da511bac8aa1d931244aa1ee559'),
            ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists, and is not as this file leaves it (found %): something else made it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'student_submit', 'fv_private')
                  and p.proname in ('start_handout_file', 'finish_handout_file', 'handout_file', '_handout_file_path', '_handout_file_object',
                                    'handout_file_path_parts', 'handout_file_upload_allowed', 'handout_file_read_allowed')
                  and p.oid not in (select coalesce(to_regprocedure(s)::oid, 0) from unnest(array[
                      'public.start_handout_file(uuid,text,text,bigint,uuid)', 'public.finish_handout_file(uuid,uuid)',
                      'student_submit.handout_file(text,uuid,uuid,text)', 'public._handout_file_path(uuid,uuid,text)',
                      'public._handout_file_object(text)', 'fv_private.handout_file_path_parts(text)',
                      'fv_private.handout_file_upload_allowed(text)', 'fv_private.handout_file_read_allowed(text)']) s)) then
        raise exception 'a function with one of this file''s names and other arguments is there. Nothing was changed.';
    end if;

    -- The table as 2026111170 made it, or as this file leaves it.
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _c
      from pg_attribute where attrelid = 'public.assessment_resource'::regclass and attnum > 0 and not attisdropped;
    if _c not in ('id uuid, assessment_id uuid, course_id uuid, kind text, title text, url text, page_count integer, status text, position integer, created_at timestamp with time zone, updated_at timestamp with time zone',
                  'id uuid, assessment_id uuid, course_id uuid, kind text, title text, url text, page_count integer, status text, position integer, created_at timestamp with time zone, updated_at timestamp with time zone, bytes bigint') then
        raise exception 'public.assessment_resource is not as 2026111170 made it (found %). Nothing was changed.', _c;
    end if;
    select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) into _c
      from pg_constraint where conrelid = 'public.assessment_resource'::regclass and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check');
    if _c not in (
        'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)))))',
        -- SHAPE-AFTER (as this file leaves them; written by migrations/local-test/handout_files.py)
        'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (bytes IS NULL)) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)))))') then
        raise exception 'the constraints on public.assessment_resource are not as 2026111170 made them (found %). Nothing was changed.', _c;
    end if;

    -- Storage.
    if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
       or (select count(*) from pg_attribute where attrelid = to_regclass('storage.buckets') and not attisdropped
              and attname in ('id', 'name', 'public', 'file_size_limit', 'allowed_mime_types')) <> 5
       or (select count(*) from pg_attribute where attrelid = to_regclass('storage.objects') and not attisdropped
              and attname in ('bucket_id', 'name', 'metadata', 'archived_at', 'is_delete_marker')) <> 5 then
        raise exception 'storage.buckets or storage.objects is not the shape this file was written for. Nothing was changed.';
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
        raise exception 'storage.objects has row security turned off: every signed-in user could read every file. Nothing was changed.';
    end if;
    -- The six policies 2026111102 and 2026111170 made, and (a second run) this file's four.
    select string_agg(p.polname, ', ' order by p.polname collate "C") into _c from pg_policy p where p.polrelid = 'storage.objects'::regclass;
    if _c is distinct from 'fv_handouts_read, fv_handouts_upload, fv_student_photos_fence, fv_student_photos_read, fv_student_photos_teachers_only, fv_student_photos_upload'
       and _c is distinct from 'fv_handout_files_fence, fv_handout_files_read, fv_handout_files_teachers_only, fv_handout_files_upload, fv_handouts_read, fv_handouts_upload, fv_student_photos_fence, fv_student_photos_read, fv_student_photos_teachers_only, fv_student_photos_upload' then
        raise exception 'the policies on storage.objects are not the six this file was written against, nor those and its own four (found %). Nothing was changed.', _c;
    end if;
    select b.public, b.file_size_limit, b.allowed_mime_types into _b from storage.buckets b where b.id = 'handout-files';
    if found and (_b.public is distinct from false or _b.file_size_limit is distinct from 20971520
                  or _b.allowed_mime_types is distinct from array['text/html', 'text/plain', 'application/epub+zip']) then
        raise exception 'a bucket named handout-files exists and is not private, 20971520 bytes, text/html, text/plain and application/epub+zip only (found %, %, %). Nothing was changed.',
            _b.public, _b.file_size_limit, _b.allowed_mime_types;
    end if;
    if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'fv_handout_files_fence')
       and exists (select 1 from storage.objects o where o.bucket_id = 'handout-files') then
        raise exception 'the bucket handout-files already holds files, and this file has not been applied: something else put them there. Nothing was changed.';
    end if;
end
$guard$;

-- ── 1. The table ────────────────────────────────────────────────────────────
alter table public.assessment_resource add column if not exists bytes bigint;
alter table public.assessment_resource
    drop constraint assessment_resource_kind_check,
    add constraint assessment_resource_kind_check check (kind in ('pdf', 'link', 'html', 'txt', 'epub')),
    drop constraint assessment_resource_shape_check,
    -- A link has an address; a PDF has pages; a file has a size. Each has only its own.
    add constraint assessment_resource_shape_check check (
        (kind = 'link' and url is not null and char_length(url) <= 2000 and url ~* '^https?://'
                       and page_count is null and status = 'ready' and bytes is null)
     or (kind = 'pdf' and url is null and page_count is not null and page_count between 1 and 20 and bytes is null)
     or (kind in ('html', 'txt', 'epub') and url is null and page_count is null and bytes is not null
                                         and bytes between 1 and 20971520));
comment on column public.assessment_resource.bytes is
    'Handout files (2026111706): a web page''s, text file''s or EPUB''s size in bytes, as declared at its start and as stored once ready. Null for a PDF or a link.';

-- ── 2. Where a file is ──────────────────────────────────────────────────────
create or replace function public._handout_file_bucket()
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select 'handout-files'::text;
$function$;

create or replace function public._handout_file_max_bytes()
 returns bigint
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select 20971520::bigint;
$function$;

-- The type a kind is stored as (the bucket allows these three and no other).
create or replace function public._handout_file_mime(p_kind text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select case p_kind when 'html' then 'text/html' when 'txt' then 'text/plain' when 'epub' then 'application/epub+zip' end;
$function$;

-- The one place a file's name is made: <class>/<resource>.<kind>.
create or replace function public._handout_file_path(p_course_id uuid, p_resource_id uuid, p_kind text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select p_course_id::text || '/' || p_resource_id::text || '.' || p_kind
     where p_kind in ('html', 'txt', 'epub');
$function$;

-- A name's parts when it is exactly a handout file's (lower-case ids), and no row otherwise.
create or replace function fv_private.handout_file_path_parts(p_name text)
 returns table (course_id uuid, resource_id uuid, kind text)
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select m[1]::uuid, m[2]::uuid, m[3]
      from regexp_match(p_name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(html|txt|epub)$') m
     where m is not null;
$function$;

-- The stored file of a name in handout-files: its size and type, or no row.
create or replace function public._handout_file_object(p_path text)
 returns table (bytes bigint, mimetype text)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select nullif(o.metadata->>'size', '')::bigint, o.metadata->>'mimetype'
      from storage.objects o
     where o.bucket_id = public._handout_file_bucket()
       and o.name = p_path collate "C"
       and o.archived_at is null
       and not o.is_delete_marker
     limit 1;
$function$;

-- ── 3. What the storage policies ask ────────────────────────────────────────
-- May the signed-in teacher write this exact name? Only the file of a
-- handout in a class they own that is still uploading and holds its place.
create or replace function fv_private.handout_file_upload_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_file_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = h.kind
                      and r.status = 'uploading'
                      and r.created_at >= now() - _work_hold()
                      and fv_owns_assessment(r.assessment_id));
$function$;

-- May the signed-in teacher read this name? The file of a handout in a class they own.
create or replace function fv_private.handout_file_read_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_file_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = h.kind
                      and fv_owns_assessment(r.assessment_id));
$function$;

-- ── 4. The five replaced ────────────────────────────────────────────────────
-- One row as the browser is given it: as 2026111170 made it, and a file
-- also carries its size and its name in handout-files.
create or replace function public._assessment_resource_json(p_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object('id', r.id, 'assessment_id', r.assessment_id, 'kind', r.kind, 'title', r.title,
                              'url', r.url, 'page_count', r.page_count, 'status', r.status, 'position', r.position,
                              'created_at', r.created_at, 'updated_at', r.updated_at)
           || case when r.kind = 'pdf'
                   then jsonb_build_object('paths', (select jsonb_agg(_handout_path(r.course_id, r.id, n) order by n)
                                                       from generate_series(1, r.page_count) n))
                   else '{}'::jsonb end
           || case when r.kind in ('html', 'txt', 'epub')
                   then jsonb_build_object('bytes', r.bytes, 'path', _handout_file_path(r.course_id, r.id, r.kind))
                   else '{}'::jsonb end
           || case when r.kind <> 'link' and r.status = 'uploading'
                   then jsonb_build_object('finish_by', r.created_at + _work_hold())
                   else '{}'::jsonb end
      from assessment_resource r
     where r.id = p_id;
$function$;

-- When a row goes, whoever deleted it and however, a PDF's pages or a
-- file are queued for deletion from storage in the same transaction.
create or replace function public._assessment_resource_removed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _why text := coalesce(nullif(current_setting('fv.handout_removal_reason', true), ''), 'handout_removed');
begin
    if old.kind = 'pdf' then
        insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
        select _work_bucket(), _handout_path(old.course_id, old.id, n), old.course_id, _why, now() + interval '10 minutes'
          from generate_series(1, old.page_count) n
        on conflict (bucket, path) do nothing;
    elsif old.kind in ('html', 'txt', 'epub') then
        insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
        values (_handout_file_bucket(), _handout_file_path(old.course_id, old.id, old.kind), old.course_id, _why,
                now() + interval '10 minutes')
        on conflict (bucket, path) do nothing;
    end if;
    return null;
end;
$function$;

-- A PDF or a file still 'uploading' two hours after its start is dropped;
-- the trigger queues whatever was uploaded. How many were dropped.
create or replace function public._handout_drop_expired(p_course_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _n int;
begin
    perform set_config('fv.handout_removal_reason', 'handout_expired', true);
    delete from assessment_resource
     where course_id = p_course_id and kind <> 'link' and status = 'uploading' and created_at < now() - _work_hold();
    get diagnostics _n = row_count;
    perform set_config('fv.handout_removal_reason', '', true);
    return _n;
end;
$function$;

-- As 2026111102 made it, but "no longer in storage" is asked of the row's own bucket.
create or replace function student_submit.removal_done(p_ids bigint[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _gone  int;
    _still jsonb;
begin
    update submission_file_removal r
       set removed_at = now(), done = now() >= r.link_dies_at
     where r.id = any (coalesce(p_ids, '{}')) and not r.done
       -- a path a page has since been given cannot happen (a file's name is
       -- its row's id); if it ever did, the file would not be marked gone
       and not exists (select 1 from submission_file f where f.path = r.path or f.thumb_path = r.path)
       and not exists (select 1 from storage.objects o
                        where o.bucket_id = r.bucket and o.name = r.path collate "C"
                          and o.archived_at is null and not o.is_delete_marker);
    get diagnostics _gone = row_count;
    select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into _still
      from submission_file_removal r
     where r.id = any (coalesce(p_ids, '{}')) and not r.done and r.removed_at is null;
    return jsonb_build_object('ok', true, 'gone', _gone, 'still_there', _still);
end;
$function$;

-- As 2026111704 left it, with one more line in the classes it visits.
create or replace procedure public.photo_lifecycle_nightly()
 language plpgsql
as $procedure$
declare
    _course uuid;
    _failed integer := 0;
    _state  text;
    _msg    text;
    _miss   jsonb;
    _stuck  jsonb;
begin
    delete from public.photo_check_log where at < now() - interval '90 days';
    delete from public.photo_keep_check k where not exists (select 1 from public.course c where c.id = k.course_id);
    commit;
    -- Every class with work, and every class that has a folder in the bucket (section 4).
    for _course in
        select s.course_id from public.submission s
        union
        select c.id from public.course c
         where c.id in (select distinct fv_private.work_path_course(o.name) from storage.objects o
                         where o.bucket_id = public._work_bucket() and o.archived_at is null and not o.is_delete_marker)
        union
        -- and every class with a handout still uploading (2026111706), so one never finished is dropped
        select r.course_id from public.assessment_resource r where r.status = 'uploading'
        order by 1
    loop
        begin
            perform set_config('lock_timeout', '10s', true);
            perform public._photo_keep_class(_course, now());
            perform public._photo_strays(_course, now());
            _miss := public._photo_missing(_course);
            if (_miss->>'n')::int > 0 then
                perform public._photo_log(_course, 'missing_file', (_miss->>'n')::int, _miss->'file_ids');
            end if;
        exception when others then
            get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            perform public._photo_log(_course, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
            _failed := _failed + 1;
        end;
        commit;
    end loop;
    begin
        perform set_config('lock_timeout', '10s', true);
        perform public._photo_strays(null, now());
    exception when others then
        get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
        perform public._photo_log(null, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
        _failed := _failed + 1;
    end;
    commit;
    -- Files due for hours: the calls to the edge function are not working (section 6).
    _stuck := public._photo_stuck();
    if (_stuck->>'n')::int > 0 then
        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));
        _failed := _failed + 1;
    end if;
    commit;
    if _failed > 0 then
        raise exception 'photo_lifecycle_nightly: % part(s) of this run failed or found files stuck in the queue; the rest is done. See public.photo_check_log.', _failed;
    end if;
end;
$procedure$;

-- ── 5. The teacher's two ────────────────────────────────────────────────────
-- Add a File, first step: the row, and the one name its file goes to. The
-- browser uploads it signed in, typed as its kind; the storage policy lets
-- it write exactly that name for two hours.
create or replace function public.start_handout_file(
    p_assessment_id uuid, p_title text, p_kind text, p_bytes bigint, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _title  text := btrim(coalesce(p_title, ''));
    _id     uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    if p_kind is null or p_kind not in ('html', 'txt', 'epub') then
        raise exception 'a handout file is a web page (html), a text file (txt) or an EPUB (epub)' using errcode = '22023';
    end if;
    if p_bytes is null or p_bytes < 1 or p_bytes > _handout_file_max_bytes() then
        raise exception 'a handout file can be 20 MB at most' using errcode = '22023';
    end if;
    if _title = '' then
        _title := 'Handout';
    end if;
    if char_length(_title) > 200 then
        raise exception 'a name can be 200 characters at most' using errcode = '22023';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;

    perform _grade_return_lock_first(_course);
    _cached := fv_idem_check(p_idempotency_key, 'start_handout_file');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    perform _handout_drop_expired(_course);
    if (select count(*) from assessment_resource r where r.assessment_id = p_assessment_id) >= 50 then
        raise exception 'an assessment can hold 50 handouts and links at most' using errcode = '22023';
    end if;
    insert into assessment_resource (assessment_id, course_id, kind, title, bytes, status, position)
    values (p_assessment_id, _course, p_kind, _title, p_bytes, 'uploading',
            (select coalesce(max(r.position), 0) + 1 from assessment_resource r where r.assessment_id = p_assessment_id))
    returning id into _id;
    _cached := _assessment_resource_json(_id) || jsonb_build_object('bucket', _handout_file_bucket());
    perform fv_idem_store(p_idempotency_key, 'start_handout_file', _cached);
    return _cached;
end;
$function$;

-- Add a File, last step: ready only when the file is in storage, typed as
-- its kind and within 20 MB. Otherwise the row comes back still 'uploading'
-- with missing: true (send it again) or bad: true (the stored file is
-- another type or size: it cannot be replaced, so remove the handout), and
-- nothing is remembered. A handout that is not there answers { id, status:
-- 'gone' }.
create or replace function public.finish_handout_file(p_resource_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _r      assessment_resource%rowtype;
    _o      record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from assessment_resource r
     where r.id = p_resource_id and r.kind in ('html', 'txt', 'epub') and fv_owns_assessment(r.assessment_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'finish_handout_file');
    if _cached is not null then return _cached; end if;
    if _course is null then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    perform _handout_drop_expired(_course);
    select * into _r from assessment_resource where id = p_resource_id for update;
    if not found then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    if _r.status = 'uploading' then
        select o.bytes, o.mimetype into _o from _handout_file_object(_handout_file_path(_r.course_id, _r.id, _r.kind)) o;
        if not found then
            return _assessment_resource_json(_r.id) || jsonb_build_object('missing', true);
        end if;
        if _o.mimetype is distinct from _handout_file_mime(_r.kind)
           or coalesce(_o.bytes, 0) not between 1 and _handout_file_max_bytes() then
            return _assessment_resource_json(_r.id) || jsonb_build_object('bad', true);
        end if;
        update assessment_resource set status = 'ready', bytes = _o.bytes, updated_at = now() where id = _r.id;
    end if;
    _cached := _assessment_resource_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'finish_handout_file', _cached);
    return _cached;
end;
$function$;

-- ── 6. The student's side ───────────────────────────────────────────────────
-- The one file of a ready handout, for the edge function to sign. Only for
-- a piece the student's page lists, in the session's own class.
create or replace function student_submit.handout_file(
    p_session_token text, p_enrollment_id uuid, p_resource_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _r  assessment_resource%rowtype;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select r.* into _r
      from assessment_resource r
      join assessment a on a.id = r.assessment_id
      join course c on c.id = a.course_id
     where r.id = p_resource_id and r.kind in ('html', 'txt', 'epub') and r.status = 'ready'
       and r.course_id = (_in->>'course_id')::uuid and a.course_id = r.course_id
       and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._handout_file_bucket(),
        'resource_id', _r.id, 'assessment_id', _r.assessment_id, 'title', _r.title, 'kind', _r.kind,
        'bytes', _r.bytes, 'path', public._handout_file_path(_r.course_id, _r.id, _r.kind));
end;
$function$;

-- ── 7. The bucket and who may touch its files ───────────────────────────────
-- Made by a row, as 2026111102 made student-photos; it lives in the
-- project's region. Versioning is the column's own default (DISABLED).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('handout-files', 'handout-files', false, 20971520, array['text/html', 'text/plain', 'application/epub+zip'])
on conflict (id) do nothing;

drop policy if exists fv_handout_files_read on storage.objects;
create policy fv_handout_files_read on storage.objects
    for select to authenticated
    using (bucket_id = 'handout-files' and fv_private.handout_file_read_allowed(name));

drop policy if exists fv_handout_files_upload on storage.objects;
create policy fv_handout_files_upload on storage.objects
    for insert to authenticated
    with check (bucket_id = 'handout-files' and fv_private.handout_file_upload_allowed(name));

drop policy if exists fv_handout_files_teachers_only on storage.objects;
create policy fv_handout_files_teachers_only on storage.objects
    as restrictive for all to public
    using (bucket_id is distinct from 'handout-files' or current_user = 'authenticated')
    with check (bucket_id is distinct from 'handout-files' or current_user = 'authenticated');

drop policy if exists fv_handout_files_fence on storage.objects;
create policy fv_handout_files_fence on storage.objects
    as restrictive for all to authenticated
    using (bucket_id is distinct from 'handout-files' or fv_private.handout_file_read_allowed(name))
    with check (bucket_id is distinct from 'handout-files' or fv_private.handout_file_upload_allowed(name));

-- ── 8. Who can run what ─────────────────────────────────────────────────────
revoke all on function public.start_handout_file(uuid, text, text, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_handout_file(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_handout_file(uuid, text, text, bigint, uuid) to authenticated;
grant execute on function public.finish_handout_file(uuid, uuid) to authenticated;
revoke all on function fv_private.handout_file_upload_allowed(text) from public, anon, authenticated, service_role;
revoke all on function fv_private.handout_file_read_allowed(text) from public, anon, authenticated, service_role;
grant execute on function fv_private.handout_file_upload_allowed(text) to authenticated;
grant execute on function fv_private.handout_file_read_allowed(text) to authenticated;
revoke all on function student_submit.handout_file(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function student_submit.handout_file(text, uuid, uuid, text) to service_role;
revoke all on function public._handout_file_bucket() from public, anon, authenticated, service_role;
revoke all on function public._handout_file_max_bytes() from public, anon, authenticated, service_role;
revoke all on function public._handout_file_mime(text) from public, anon, authenticated, service_role;
revoke all on function public._handout_file_path(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function fv_private.handout_file_path_parts(text) from public, anon, authenticated, service_role;
revoke all on function public._handout_file_object(text) from public, anon, authenticated, service_role;
-- The five replaced keep their grants (create or replace keeps them).

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _n    int;
    _left text;
    _b    record;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN after (written by migrations/local-test/handout_files.py)
            ('public._handout_file_bucket()', 'f7ed7b1fe72127f538fcc133ebf7e423'),
            ('public._handout_file_max_bytes()', '587c06ecb2e6fa6980dfc027eae9ea00'),
            ('public._handout_file_mime(text)', '234e3efb8c0358be67c1705dea81fac1'),
            ('public._handout_file_path(uuid,uuid,text)', '72ad6e9a0c48f4243ba66a03a42427b0'),
            ('fv_private.handout_file_path_parts(text)', '185ad3fd3fc9ae84d6ae747f54a3423f'),
            ('public._handout_file_object(text)', '797abf1f084660a2cf8254d712f7e040'),
            ('fv_private.handout_file_upload_allowed(text)', 'fd3ee2b395e774629f6e8d2c53a36e59'),
            ('fv_private.handout_file_read_allowed(text)', '01f9d53fbc7b87536957dca9984103be'),
            ('public.start_handout_file(uuid,text,text,bigint,uuid)', 'cfe44806c71f0927070a4299bef64dd6'),
            ('public.finish_handout_file(uuid,uuid)', '88338da511bac8aa1d931244aa1ee559'),
            ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511'),
            ('public._assessment_resource_json(uuid)', 'ba262085f68a12f1320aa12cebf2f4af'),
            ('public._assessment_resource_removed()', 'becec68516a8cd68cccc383cf71325f7'),
            ('public._handout_drop_expired(uuid)', '2a89c8ea4984d1832f3dd4370756f253'),
            ('student_submit.removal_done(bigint[])', '0414f8b4f5b2429c1799dde1a68179d3'),
            ('public.photo_lifecycle_nightly()', '511904d486e08f495f2823aefd80b7e9')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    select b.public, b.file_size_limit, b.allowed_mime_types into _b from storage.buckets b where b.id = 'handout-files';
    if not found or _b.public is distinct from false or _b.file_size_limit is distinct from 20971520
       or _b.allowed_mime_types is distinct from array['text/html', 'text/plain', 'application/epub+zip'] then
        raise exception 'the bucket handout-files is not private, 20971520 bytes and the three types. Nothing was changed.';
    end if;
    select count(*) into _n from pg_policy p
     where p.polrelid = 'storage.objects'::regclass
       and (p.polname, p.polcmd, p.polpermissive,
            coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) in (
            ('fv_handout_files_read', 'r', true,
             '((bucket_id = ''handout-files''::text) AND fv_private.handout_file_read_allowed(name))', ''),
            ('fv_handout_files_upload', 'a', true,
             '', '((bucket_id = ''handout-files''::text) AND fv_private.handout_file_upload_allowed(name))'),
            ('fv_handout_files_teachers_only', '*', false,
             '((bucket_id IS DISTINCT FROM ''handout-files''::text) OR (CURRENT_USER = ''authenticated''::name))',
             '((bucket_id IS DISTINCT FROM ''handout-files''::text) OR (CURRENT_USER = ''authenticated''::name))'),
            ('fv_handout_files_fence', '*', false,
             '((bucket_id IS DISTINCT FROM ''handout-files''::text) OR fv_private.handout_file_read_allowed(name))',
             '((bucket_id IS DISTINCT FROM ''handout-files''::text) OR fv_private.handout_file_upload_allowed(name))'));
    if _n <> 4 then
        raise exception 'the four policies for handout-files are not all there as written (found %). Nothing was changed.', _n;
    end if;
    if (select count(*) from pg_policy p where p.polrelid = 'storage.objects'::regclass) <> 10 then
        raise exception 'storage.objects does not have the ten policies it should (student-photos'' six and these four). Nothing was changed.';
    end if;
    select string_agg(p.oid::regprocedure::text, ', ') into _left
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.proname ~ '^(_?handout_file|start_handout_file$|finish_handout_file$)'
       and has_function_privilege('anon', p.oid, 'execute');
    if _left is not null then
        raise exception 'the anonymous role can run: %. Nothing was changed.', _left;
    end if;
    select string_agg(n.nspname || '.' || p.proname, ', ') into _left
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
       and p.proname ~ '^(_?handout_file|start_handout_file$|finish_handout_file$|_assessment_resource_json$|_assessment_resource_removed$|_handout_drop_expired$|removal_done$)'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$');
    if _left is not null then
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. Nothing was changed.', _left;
    end if;
end
$final$;

commit;
