-- A PDF handout also keeps the original PDF (2026-11-24). NOT APPLIED.
-- Colin, Nov 24: "When a teacher creates an assignment and attaches a pdf to it, it shouldn't only
-- compress that pdf into an image. it should keep it as a pdf so that students can download and print
-- them. they should also be able to see the image they already can." Contract:
-- migrations/local-test/handouts-links-contract.md, "A PDF's original". Apply after 2026111706
-- (live since Nov 17) and 2026112407; the first check stops it otherwise.
--
-- == What it adds ==
-- A PDF handout keeps its pages exactly as now (JPEGs in student-photos, 2026111170). Its original is
-- also stored whole in the private bucket handout-files at <class id>/<resource id>.pdf, up to 20 MB.
--   1. assessment_resource: two columns, original_status (null, 'uploading', 'ready' or 'dropped') and
--      original_started_at. The existing column bytes holds the original's size (declared at the start,
--      the stored size once ready). The shape check is made again so that only a PDF row may have them.
--      A handout with no original (every row today) has all three null, as before.
--   2. The bucket handout-files also accepts application/pdf (its size limit and privacy are as before).
--   3. For a signed-in teacher, each write idempotent through p_idempotency_key (fv_idem_check):
--        start_handout_original(resource, bytes, key)   after the pages are ready: marks the original
--            'uploading' for two hours and answers the row with the one name to upload to
--        finish_handout_original(resource, key)          'ready' once the file is stored as application/pdf
--            within 20 MB; else the row with missing: true or bad: true; { id, status: 'gone' } when the
--            handout is not there
--      The row (list_course_resources, the two above) carries original, original_path, original_bytes and,
--      while uploading, original_finish_by, only when an original was started.
--   4. student_submit.handout_original(session, enrollment, resource, ip hash), service role only: under
--      the checks of student_submit.handout_file (the session's class, ready, listed), answers
--      { ok: true, has_original: false } for a PDF with no ready original, and with one its path, size and title.
--   5. Helpers nobody is granted: _handout_original_path and fv_private.handout_original_parts.
--
-- == What it changes that exists ==
-- Six functions, each only if it is exactly as live had it (migrations/baseline):
--   _assessment_resource_json    a PDF with an original also carries the four keys above
--   _assessment_resource_removed a PDF row going, by any path (Remove, its assessment deleted, the purge of
--                                its class or teacher, an upload not finished in two hours) also queues
--                                its original in submission_file_removal, bucket handout-files
--   _handout_drop_expired        an original still 'uploading' after two hours becomes 'dropped' and its
--                                name is queued for deletion; the PDF keeps working from its pages. It
--                                never restarts. The number it answers is still the rows dropped.
--   photo_lifecycle_nightly      also visits a class with an original still uploading
--   fv_private.handout_file_upload_allowed and _read_allowed (what the storage policies ask): also allow the
--                                one name of a PDF's original, for the owner, while it is 'uploading' and
--                                within two hours (read: while it has one). The four policies are not touched.
-- And the constraint assessment_resource_shape_check, made again with the new columns.
--
-- == What it does to existing rows ==
-- Nothing: every existing row gets original_status and original_started_at null, which the new check allows.
-- No file is touched.
--
-- == What applying it accepts ==
--   THE EDGE FUNCTION MUST BE DEPLOYED BEFORE THE APP USES THIS (its storage check must accept <id>.pdf):
--   until then the removal worker cannot delete a queued original (the nightly job reports it stuck after
--   six hours) and the page cannot ask for one. Until the app's release nothing stores an original.
--   An original is not checked beyond its type and size. A handout whose original never finished (or that
--   is older than this) works from its pages, as today. Copies of an assessment do not carry originals.
--   If the role fv_student_submit exists, it is given EXECUTE on student_submit.handout_original, as
--   2026112402 gave it the others.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the running role owns the tables and
-- functions it changes; 2026111706 is applied; every function it relies on or replaces is the one it was
-- tested against (md5 of pg_get_functiondef, public on the search path); none of its names is taken (or, on
-- a second run, each is as it leaves it); assessment_resource, its constraints, the bucket and the ten
-- ten policies on storage.objects are there; the bucket holds
-- no .pdf before this file. Its last step checks everything came out as written.
--
-- == What it does not depend on ==
-- Collation, locale, time zone, search path and the applying role: nothing is sorted as text but under
-- collate "C"; names are compared byte for byte; no date is printed; the file sets its own search path and
-- each function pins its own; the owner is checked, and grants are read from proacl. No backslash and no
-- non-ASCII character is in the file.
--
-- == Locks ==
-- assessment_resource and storage.buckets for a moment; it gives up after five seconds with nothing
-- applied if a long transaction holds one: run it again. One transaction.
--
-- == How to apply ==
-- Only on the owner's OK (rule 1). Tested on a throwaway PostgreSQL 17, ICU en-US and C
-- (local-test/README.md, "A PDF handout's original").
--   0. local-test/handout-pdf-original-live-fingerprints.sql, read-only. Expected: no rows.
--   1. local-test/handout-pdf-original-live-precheck.sql, read-only. Expected: no rows.
--   2. This whole file as one migration named handout_pdf_original.
--   3. local-test/handout-pdf-original-live-postcheck.sql. Every row ok.
-- Undo: local-test/handout-pdf-original-undo.sql. PART 0 stops new originals; PART 1 puts everything back.
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f    record;
    _md5  text;
    _c    text;
    _b    record;
    _me   oid := (select oid from pg_roles where rolname = current_user);
    _n    int;
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    if to_regprocedure('public.start_handout_file(uuid,text,text,bigint,uuid)') is null then
        raise exception '2026111706_handout_files.sql is not applied: apply it first. Nothing was changed.';
    end if;
    if (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.assessment_resource')) is distinct from _me
       or (select proowner from pg_proc where oid = to_regprocedure('public._assessment_resource_json(uuid)')) is distinct from _me
       or not has_schema_privilege('student_submit', 'create') then
        raise exception 'Run this as the owner of assessment_resource and student_submit._session_class (% is not). Nothing was changed.', current_user;
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied
            ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
            ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
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
            ('public.start_handout_file(uuid,text,text,bigint,uuid)', 'cfe44806c71f0927070a4299bef64dd6'),
            ('public.finish_handout_file(uuid,uuid)', '88338da511bac8aa1d931244aa1ee559'),
            ('public._handout_file_bucket()', 'f7ed7b1fe72127f538fcc133ebf7e423'),
            ('public._handout_file_max_bytes()', '587c06ecb2e6fa6980dfc027eae9ea00'),
            ('public._handout_file_mime(text)', '234e3efb8c0358be67c1705dea81fac1'),
            ('public._handout_file_path(uuid,uuid,text)', '72ad6e9a0c48f4243ba66a03a42427b0'),
            ('public._handout_file_object(text)', '797abf1f084660a2cf8254d712f7e040'),
            ('fv_private.handout_file_path_parts(text)', '185ad3fd3fc9ae84d6ae747f54a3423f'),
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
            ('student_submit.removal_done(bigint[])', '0414f8b4f5b2429c1799dde1a68179d3'),
            ('student_submit.handout_links(text,uuid,uuid,text)', '410877d7e4d5b860b8dadb4c1b185f3c'),
            ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511'),
            ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces
            ('public._assessment_resource_json(uuid)', 'ba262085f68a12f1320aa12cebf2f4af', '0aac1b8e58091a149e90422df56cddff'),
            ('public._assessment_resource_removed()', 'becec68516a8cd68cccc383cf71325f7', '208a21d723c24b89398d29e1733eff65'),
            ('public._handout_drop_expired(uuid)', '2a89c8ea4984d1832f3dd4370756f253', '8bbc7a7dc0f46717b9d1c59016dc9e8e'),
            ('public.photo_lifecycle_nightly()', '511904d486e08f495f2823aefd80b7e9', '590634077c8115f35e972f1d211e04fc'),
            ('fv_private.handout_file_upload_allowed(text)', 'fd3ee2b395e774629f6e8d2c53a36e59', 'd979e73142f88695a49059c207720b8d'),
            ('fv_private.handout_file_read_allowed(text)', '01f9d53fbc7b87536957dca9984103be', '157cbc9d9aef4f0a10ae4d36f061fc65')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new
            ('public._handout_original_path(uuid,uuid)', '8bca6f364391cd12d96027b0a4c02ffb'),
            ('fv_private.handout_original_parts(text)', 'b8f2d9237ed76faf5db4463818088f6e'),
            ('public.start_handout_original(uuid,bigint,uuid)', '72fe4a680ef117111f471d6553ae89ad'),
            ('public.finish_handout_original(uuid,uuid)', 'a7a502a24cdec27cfbdfab95b5cfd723'),
            ('student_submit.handout_original(text,uuid,uuid,text)', '65e00c70081b1234c60679087c117fbe')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists, and is not as this file leaves it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'student_submit', 'fv_private')
                  and p.proname in ('start_handout_original', 'finish_handout_original', 'handout_original', '_handout_original_path', 'handout_original_parts')
                  and p.oid not in (select coalesce(to_regprocedure(s)::oid, 0) from unnest(array[
                      'public.start_handout_original(uuid,bigint,uuid)', 'public.finish_handout_original(uuid,uuid)',
                      'student_submit.handout_original(text,uuid,uuid,text)', 'public._handout_original_path(uuid,uuid)',
                      'fv_private.handout_original_parts(text)']) s)) then
        raise exception 'a function with one of this file''s names and other arguments is there. Nothing was changed.';
    end if;

    select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _c
      from pg_attribute where attrelid = 'public.assessment_resource'::regclass and attnum > 0 and not attisdropped;
    if _c not in ('id uuid, assessment_id uuid, course_id uuid, kind text, title text, url text, page_count integer, status text, position integer, created_at timestamp with time zone, updated_at timestamp with time zone, bytes bigint',
                  'id uuid, assessment_id uuid, course_id uuid, kind text, title text, url text, page_count integer, status text, position integer, created_at timestamp with time zone, updated_at timestamp with time zone, bytes bigint, original_status text, original_started_at timestamp with time zone') then
        raise exception 'public.assessment_resource is not as 2026111706 left it (found %). Nothing was changed.', _c;
    end if;
    select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") into _c
      from pg_constraint where conrelid = 'public.assessment_resource'::regclass and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check');
    if _c not in (
        -- SHAPE-BEFORE
        'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (bytes IS NULL)) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)))))',
        -- SHAPE-AFTER
        'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL) AND (original_status IS NULL) AND (original_started_at IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (((bytes IS NULL) AND (original_status IS NULL) AND (original_started_at IS NULL)) OR ((status = ''ready''::text) AND (original_status = ANY (ARRAY[''uploading''::text, ''ready''::text])) AND (original_started_at IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520))) OR ((status = ''ready''::text) AND (original_status = ''dropped''::text) AND (original_started_at IS NOT NULL) AND (bytes IS NULL)))) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)) AND (original_status IS NULL) AND (original_started_at IS NULL))))') then
        raise exception 'the constraints on public.assessment_resource are not as 2026111706 left them (found %). Nothing was changed.', _c;
    end if;

    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
        raise exception 'storage.objects has row security turned off. Nothing was changed.';
    end if;
    -- The ten policies of 2026111102, 2026111170 and 2026111706 are there (others, such as the bulletins', are not looked at).
    select count(*) into _n from pg_policy p where p.polrelid = 'storage.objects'::regclass
       and p.polname in ('fv_handout_files_fence', 'fv_handout_files_read', 'fv_handout_files_teachers_only', 'fv_handout_files_upload', 'fv_handouts_read', 'fv_handouts_upload', 'fv_student_photos_fence', 'fv_student_photos_read', 'fv_student_photos_teachers_only', 'fv_student_photos_upload');
    if _n <> 10 then
        raise exception 'storage.objects does not have the ten policies of student-photos, handouts and handout-files (found %). Nothing was changed.', _n;
    end if;
    select b.public, b.file_size_limit, b.allowed_mime_types into _b from storage.buckets b where b.id = 'handout-files';
    if not found or _b.public is distinct from false or _b.file_size_limit is distinct from 20971520
       or (_b.allowed_mime_types is distinct from array['text/html', 'text/plain', 'application/epub+zip']
           and _b.allowed_mime_types is distinct from array['text/html', 'text/plain', 'application/epub+zip', 'application/pdf']) then
        raise exception 'the bucket handout-files is not private, 20971520 bytes, with the three types (or those and application/pdf) (found %). Nothing was changed.', _b;
    end if;
    if _b.allowed_mime_types = array['text/html', 'text/plain', 'application/epub+zip']
       and exists (select 1 from storage.objects o where o.bucket_id = 'handout-files' and right(o.name, 4) = '.pdf') then
        raise exception 'the bucket handout-files holds a .pdf and this file has not been applied: something else put it there. Nothing was changed.';
    end if;
end
$guard$;

-- == 1. The table ==
alter table public.assessment_resource
    add column if not exists original_status text,
    add column if not exists original_started_at timestamptz;
alter table public.assessment_resource
    drop constraint assessment_resource_shape_check,
    -- A link has an address; a PDF has pages (and may have an original); a file has a size. Each has only its own.
    add constraint assessment_resource_shape_check check (
        (kind = 'link' and url is not null and char_length(url) <= 2000 and url ~* '^https?://'
                       and page_count is null and status = 'ready' and bytes is null
                       and original_status is null and original_started_at is null)
     or (kind = 'pdf' and url is null and page_count is not null and page_count between 1 and 20
                      and ((bytes is null and original_status is null and original_started_at is null)
                        or (status = 'ready' and original_status in ('uploading', 'ready') and original_started_at is not null
                            and bytes between 1 and 20971520)
                        or (status = 'ready' and original_status = 'dropped' and original_started_at is not null and bytes is null)))
     or (kind in ('html', 'txt', 'epub') and url is null and page_count is null and bytes is not null
                                         and bytes between 1 and 20971520
                                         and original_status is null and original_started_at is null));
comment on column public.assessment_resource.original_status is
    'A PDF handout''s original (2026112408): null (none), uploading, ready or dropped (never finished in two hours; terminal). Its size is bytes.';
comment on column public.assessment_resource.original_started_at is
    'When start_handout_original ran; the original has two hours from then to be stored.';

-- == 2. The bucket takes PDFs ==
update storage.buckets set allowed_mime_types = array['text/html', 'text/plain', 'application/epub+zip', 'application/pdf']
 where id = 'handout-files';

-- == 3. Where an original is ==
create or replace function public._handout_original_path(p_course_id uuid, p_resource_id uuid)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select p_course_id::text || '/' || p_resource_id::text || '.pdf';
$function$;

-- A name's parts when it is exactly an original's (lower-case ids), and no row otherwise.
create or replace function fv_private.handout_original_parts(p_name text)
 returns table (course_id uuid, resource_id uuid)
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select m[1]::uuid, m[2]::uuid
      from regexp_match(p_name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]pdf$') m
     where m is not null;
$function$;

-- == 4. What the storage policies ask: as 2026111706, and an original's one name ==
create or replace function fv_private.handout_file_upload_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and (exists (select 1
                      from fv_private.handout_file_path_parts(p_name) h
                      join assessment_resource r on r.id = h.resource_id
                     where r.course_id = h.course_id and r.kind = h.kind
                       and r.status = 'uploading'
                       and r.created_at >= now() - _work_hold()
                       and fv_owns_assessment(r.assessment_id))
         or exists (select 1
                      from fv_private.handout_original_parts(p_name) h
                      join assessment_resource r on r.id = h.resource_id
                     where r.course_id = h.course_id and r.kind = 'pdf'
                       and r.original_status = 'uploading'
                       and r.original_started_at >= now() - _work_hold()
                       and fv_owns_assessment(r.assessment_id)));
$function$;

create or replace function fv_private.handout_file_read_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and (exists (select 1
                      from fv_private.handout_file_path_parts(p_name) h
                      join assessment_resource r on r.id = h.resource_id
                     where r.course_id = h.course_id and r.kind = h.kind
                       and fv_owns_assessment(r.assessment_id))
         or exists (select 1
                      from fv_private.handout_original_parts(p_name) h
                      join assessment_resource r on r.id = h.resource_id
                     where r.course_id = h.course_id and r.kind = 'pdf'
                       and r.original_status is not null
                       and fv_owns_assessment(r.assessment_id)));
$function$;

-- == 5. The four replaced ==
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
           || case when r.kind = 'pdf' and r.original_status is not null
                   then jsonb_build_object('original', r.original_status,
                                           'original_path', _handout_original_path(r.course_id, r.id))
                        || case when r.bytes is not null then jsonb_build_object('original_bytes', r.bytes) else '{}'::jsonb end
                        || case when r.original_status = 'uploading'
                                then jsonb_build_object('original_finish_by', r.original_started_at + _work_hold())
                                else '{}'::jsonb end
                   else '{}'::jsonb end
      from assessment_resource r
     where r.id = p_id;
$function$;

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
        if old.original_status is not null then
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            values (_handout_file_bucket(), _handout_original_path(old.course_id, old.id), old.course_id, _why,
                    now() + interval '10 minutes')
            on conflict (bucket, path) do nothing;
        end if;
    elsif old.kind in ('html', 'txt', 'epub') then
        insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
        values (_handout_file_bucket(), _handout_file_path(old.course_id, old.id, old.kind), old.course_id, _why,
                now() + interval '10 minutes')
        on conflict (bucket, path) do nothing;
    end if;
    return null;
end;
$function$;

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
    -- A PDF whose original was not stored in time keeps working from its pages; the original is given up
    -- for good (it never restarts, so a name queued here cannot be written again) and its name is queued.
    with d as (
        update assessment_resource
           set original_status = 'dropped', bytes = null, updated_at = now()
         where course_id = p_course_id and kind = 'pdf' and original_status = 'uploading'
           and original_started_at < now() - _work_hold()
        returning id, course_id)
    insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
    select _handout_file_bucket(), _handout_original_path(d.course_id, d.id), d.course_id, 'handout_expired',
           now() + interval '10 minutes'
      from d
    on conflict (bucket, path) do nothing;
    return _n;
end;
$function$;

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
        -- and every class with a handout still uploading, or a PDF's original still uploading (2026112408),
        -- so one never finished is dropped
        select r.course_id from public.assessment_resource r where r.status = 'uploading' or r.original_status = 'uploading'
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

-- == 6. The teacher's two ==
-- First step, once the PDF's pages are ready: the original is 'uploading' for two hours and goes to the one
-- name in the answer, signed in, typed application/pdf, never upsert. Sent again it answers as it stands
-- (a given-up original answers 'dropped' and is not restarted).
create or replace function public.start_handout_original(p_resource_id uuid, p_bytes bigint, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _r      assessment_resource%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from assessment_resource r
     where r.id = p_resource_id and r.kind = 'pdf' and fv_owns_assessment(r.assessment_id);
    if _course is null then
        raise exception 'handout not found' using errcode = 'P0002';
    end if;
    if p_bytes is null or p_bytes < 1 or p_bytes > _handout_file_max_bytes() then
        raise exception 'a PDF can be 20 MB at most' using errcode = '22023';
    end if;
    perform _grade_return_lock_first(_course);
    _cached := fv_idem_check(p_idempotency_key, 'start_handout_original');
    if _cached is not null then return _cached; end if;
    perform _handout_drop_expired(_course);
    select * into _r from assessment_resource where id = p_resource_id for update;
    if not found then
        raise exception 'handout not found' using errcode = 'P0002';
    end if;
    if _r.status <> 'ready' then
        raise exception 'the pages are not finished' using errcode = '22023';
    end if;
    if _r.original_status is null then
        update assessment_resource
           set original_status = 'uploading', original_started_at = now(), bytes = p_bytes, updated_at = now()
         where id = _r.id;
    end if;
    _cached := _assessment_resource_json(_r.id) || jsonb_build_object('bucket', _handout_file_bucket());
    perform fv_idem_store(p_idempotency_key, 'start_handout_original', _cached);
    return _cached;
end;
$function$;

-- Last step: 'ready' only when the file is in storage, typed application/pdf and within 20 MB. Otherwise the
-- row comes back with missing: true (send it again) or bad: true (another type or size; it cannot be
-- replaced, and it is dropped after two hours), and nothing is remembered. { id, status: 'gone' } when the
-- handout is not there.
create or replace function public.finish_handout_original(p_resource_id uuid, p_idempotency_key uuid default null)
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
     where r.id = p_resource_id and r.kind = 'pdf' and fv_owns_assessment(r.assessment_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'finish_handout_original');
    if _cached is not null then return _cached; end if;
    if _course is null then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    perform _handout_drop_expired(_course);
    select * into _r from assessment_resource where id = p_resource_id for update;
    if not found then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    if _r.original_status is null then
        return _assessment_resource_json(_r.id);
    end if;
    if _r.original_status = 'uploading' then
        select o.bytes, o.mimetype into _o from _handout_file_object(_handout_original_path(_r.course_id, _r.id)) o;
        if not found then
            return _assessment_resource_json(_r.id) || jsonb_build_object('missing', true);
        end if;
        if _o.mimetype is distinct from 'application/pdf' or coalesce(_o.bytes, 0) not between 1 and _handout_file_max_bytes() then
            return _assessment_resource_json(_r.id) || jsonb_build_object('bad', true);
        end if;
        update assessment_resource set original_status = 'ready', bytes = _o.bytes, updated_at = now() where id = _r.id;
    end if;
    _cached := _assessment_resource_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'finish_handout_original', _cached);
    return _cached;
end;
$function$;

-- == 7. The student's side ==
-- For the edge function to sign: the original of a ready PDF the student's page lists, in the session's own
-- class. A PDF with no ready original (older, not finished or given up) answers { ok: true, has_original: false }
-- so the page can leave the choice out; anything not listed for this student is not_found, as handout_file.
create or replace function student_submit.handout_original(
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
     where r.id = p_resource_id and r.kind = 'pdf' and r.status = 'ready'
       and r.course_id = (_in->>'course_id')::uuid and a.course_id = r.course_id
       and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _r.original_status is distinct from 'ready' then
        return jsonb_build_object('ok', true, 'has_original', false, 'resource_id', _r.id);
    end if;
    return jsonb_build_object(
        'ok', true, 'has_original', true, 'bucket', public._handout_file_bucket(),
        'resource_id', _r.id, 'assessment_id', _r.assessment_id, 'title', _r.title,
        'bytes', _r.bytes, 'path', public._handout_original_path(_r.course_id, _r.id));
end;
$function$;

-- == 8. Who can run what ==
revoke all on function public.start_handout_original(uuid, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_handout_original(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_handout_original(uuid, bigint, uuid) to authenticated;
grant execute on function public.finish_handout_original(uuid, uuid) to authenticated;
revoke all on function public._handout_original_path(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function fv_private.handout_original_parts(text) from public, anon, authenticated, service_role;
-- The edge function's login (2026112402), if there, is revoked and granted with the service role, in this
-- order, so a second run leaves the same grants in the same order.
do $edge$
begin
    revoke all on function student_submit.handout_original(text, uuid, uuid, text) from public, anon, authenticated, service_role;
    if exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
        revoke all on function student_submit.handout_original(text, uuid, uuid, text) from fv_student_submit;
    end if;
    grant execute on function student_submit.handout_original(text, uuid, uuid, text) to service_role;
    if exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
        grant execute on function student_submit.handout_original(text, uuid, uuid, text) to fv_student_submit;
    end if;
end
$edge$;
-- The six replaced keep their grants (create or replace keeps them).

-- == Everything is as the header says ==
do $final$
declare
    _f    record;
    _md5  text;
    _bad  text[] := '{}';
    _got  text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN after
            ('public._handout_original_path(uuid,uuid)', '8bca6f364391cd12d96027b0a4c02ffb'),
            ('fv_private.handout_original_parts(text)', 'b8f2d9237ed76faf5db4463818088f6e'),
            ('public.start_handout_original(uuid,bigint,uuid)', '72fe4a680ef117111f471d6553ae89ad'),
            ('public.finish_handout_original(uuid,uuid)', 'a7a502a24cdec27cfbdfab95b5cfd723'),
            ('student_submit.handout_original(text,uuid,uuid,text)', '65e00c70081b1234c60679087c117fbe'),
            ('public._assessment_resource_json(uuid)', '0aac1b8e58091a149e90422df56cddff'),
            ('public._assessment_resource_removed()', '208a21d723c24b89398d29e1733eff65'),
            ('public._handout_drop_expired(uuid)', '8bbc7a7dc0f46717b9d1c59016dc9e8e'),
            ('public.photo_lifecycle_nightly()', '590634077c8115f35e972f1d211e04fc'),
            ('fv_private.handout_file_upload_allowed(text)', 'd979e73142f88695a49059c207720b8d'),
            ('fv_private.handout_file_read_allowed(text)', '157cbc9d9aef4f0a10ae4d36f061fc65')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.becomes);
        end if;
    end loop;
    select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") into _got
      from pg_constraint where conrelid = 'public.assessment_resource'::regclass
       and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check');
    if _got is distinct from
       -- SHAPE-AFTER
       'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL) AND (original_status IS NULL) AND (original_started_at IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (((bytes IS NULL) AND (original_status IS NULL) AND (original_started_at IS NULL)) OR ((status = ''ready''::text) AND (original_status = ANY (ARRAY[''uploading''::text, ''ready''::text])) AND (original_started_at IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520))) OR ((status = ''ready''::text) AND (original_status = ''dropped''::text) AND (original_started_at IS NOT NULL) AND (bytes IS NULL)))) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)) AND (original_status IS NULL) AND (original_started_at IS NULL))))' then
        _bad := _bad || 'the constraints on assessment_resource are not as written'::text;
    end if;
    if not exists (select 1 from storage.buckets b where b.id = 'handout-files' and b.public = false and b.file_size_limit = 20971520
                    and b.allowed_mime_types = array['text/html', 'text/plain', 'application/epub+zip', 'application/pdf']) then
        _bad := _bad || 'the bucket handout-files is not private, 20971520 bytes and the four types'::text;
    end if;
    if (select count(*) from pg_policy p where p.polrelid = 'storage.objects'::regclass
           and p.polname in ('fv_handout_files_fence', 'fv_handout_files_read', 'fv_handout_files_teachers_only', 'fv_handout_files_upload', 'fv_handouts_read', 'fv_handouts_upload', 'fv_student_photos_fence', 'fv_student_photos_read', 'fv_student_photos_teachers_only', 'fv_student_photos_upload')) <> 10 then
        _bad := _bad || 'storage.objects does not have its ten policies'::text;
    end if;
    -- Grants are read from proacl itself, so default privileges show here.
    for _f in
        select * from (values
            ('public.start_handout_original(uuid,bigint,uuid)', 'authenticated'),
            ('public.finish_handout_original(uuid,uuid)', 'authenticated'),
            ('student_submit.handout_original(text,uuid,uuid,text)', 'service_role'),
            ('public._handout_original_path(uuid,uuid)', ''),
            ('fv_private.handout_original_parts(text)', ''),
            ('fv_private.handout_file_upload_allowed(text)', 'authenticated'),
            ('fv_private.handout_file_read_allowed(text)', 'authenticated')
        ) as v(fn, who)
    loop
        select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
          from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(_f.fn) and a.grantee <> p.proowner
                   and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x;
        if _got is distinct from _f.who then
            _bad := _bad || format('grant: %s may be run by "%s", not "%s"', _f.fn, _got, _f.who);
        end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'fv_student_submit')
       and not has_function_privilege('fv_student_submit', 'student_submit.handout_original(text,uuid,uuid,text)', 'execute') then
        _bad := _bad || 'fv_student_submit cannot run student_submit.handout_original'::text;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
                  and p.proname in ('start_handout_original', 'finish_handout_original', 'handout_original', '_assessment_resource_json',
                                    '_assessment_resource_removed', '_handout_drop_expired', 'handout_file_upload_allowed', 'handout_file_read_allowed')
                  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')) then
        _bad := _bad || 'a SECURITY DEFINER function here has no pg_temp last in its search_path'::text;
    end if;
    if (select provolatile from pg_proc where oid = to_regprocedure('student_submit.handout_original(text,uuid,uuid,text)')) is distinct from 's' then
        _bad := _bad || 'student_submit.handout_original is not stable'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
