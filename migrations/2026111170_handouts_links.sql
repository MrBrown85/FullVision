-- Handouts and Links on an assessment (2026-11-11).
-- The contract: migrations/local-test/handouts-links-contract.md. Storage
-- rules: docs/plans/student-page-build-plan.md 1.7; DECISIONS, "Student page
-- build rulings (2026-11-10, late night)" 1 (one private bucket, JPEG pages
-- only, 2 MB a page) and 5 (a delete takes its files).
-- Apply after everything through 2026111160_slips_keyed.sql; its first
-- check stops it otherwise.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. ONE TABLE, public.assessment_resource: one row for each handout or link
--    a teacher puts on an assessment.
--      kind 'link'  title, url (http:// or https://, 2000 characters at
--                   most). Always status 'ready'.
--      kind 'pdf'   title, page_count (1 to 20: ruling 18, the same as a
--                   student's PDF). status 'uploading' from the start of the
--                   upload until every page is in storage, then 'ready'.
--      position     the order added, within the assessment.
--    A signed-in teacher can read the rows of their own classes (row
--    security through fv_owns_assessment) and can write none of them
--    directly: every write is one of the functions in 3. The anonymous role
--    and the service role have no right on the table.
--    IT HAS NO FOREIGN KEY to assessment (the contract's draft had one, on
--    delete cascade). The reason is the one submission and grade_return have
--    none for: every write here is made under the class's lock, taken first,
--    and a foreign-key check or a cascade takes the assessment's row lock in
--    the other order, so adding a handout while the assessment is deleted
--    would deadlock. Instead, as for submissions: a trigger on assessment
--    deletes the rows when their assessment goes, and a trigger on this
--    table refuses a row whose assessment is not in its class.
-- 2. WHERE A HANDOUT'S PAGES ARE. The browser turns each page of the PDF into
--    a JPEG; the PDF is not kept. The pages go in the bucket there already
--    is, student-photos (private, JPEG only, 2 MB a file), at
--      <class id>/handouts/<resource id>/<page number>.jpg      (1, 2, 3 ...)
--    with no thumbnail. The path is worked out from the row, in one place
--    (public._handout_path). A handout is the teacher's material, not a
--    student's work: it has no row in submission_file.
-- 3. FIVE FUNCTIONS for a signed-in teacher (public; each write takes
--    p_idempotency_key, so a request sent twice is answered once):
--      add_assessment_link(assessment, url, title, key)       the new row
--      start_handout_upload(assessment, title, pages, key)    the new row,
--          status 'uploading', with the paths to upload to and finish_by
--          (two hours from the start)
--      finish_handout_upload(resource, key)   the row, 'ready' when every
--          page is in storage; otherwise still 'uploading', with the page
--          numbers missing; { id, status: 'gone' } when it is not there
--      remove_assessment_resource(resource, key)   { removed }
--      list_course_resources(class)           the class's rows
--    An upload not finished within two hours is dropped, and its pages
--    queued for deletion, by the next add, start or finish in the class or
--    by the nightly job.
--    An assessment holds 50 handouts and links at most. That number is a
--    stop for a runaway script, not a product rule; no screen should come
--    near it.
-- 4. ONE FUNCTION for the student page (student_submit.handout_links,
--    service role only, called by the edge function): the page paths of one
--    ready handout, only for an assessment that student's page shows (the
--    same test student_submit.page and file_links make: the session's own
--    class, and not dated into the future). The edge function signs a
--    short-lived link for each path, as it does for returned work.
-- 5. TWO STORAGE POLICIES on storage.objects, for the same bucket, for
--    signed-in teachers:
--      fv_handouts_upload  write one exact path: a page of a handout in a
--                          class they own that is still 'uploading', for
--                          the two hours from its start
--      fv_handouts_read    read a page of a handout in a class they own
--    Nothing lets a teacher's browser change, move or delete a file, and
--    students still have no storage role at all.
-- 6. TRIGGERS.
--      on assessment_resource:
--        assessment_resource_same_class  refuses a row whose assessment is
--                          not in the class the row names
--        assessment_resource_removed     when a row goes, by whatever path,
--                          every page of a handout is written to the removal
--                          queue (public.submission_file_removal) in the
--                          same transaction. The worker that deletes
--                          students' photos from storage deletes these too.
--      on assessment (two more, beside the eight it has):
--        assessment_resource_gone      after delete, each row: takes the
--                          class's lock, then deletes that assessment's
--                          rows here. So deleting an assessment, and the
--                          30-day purge of a class (which deletes its
--                          assessments), delete the handouts' files.
--        assessment_resource_truncate  after truncate: removes rows left
--                          without their assessment.
--      What they cost a teacher who never adds a handout: deleting an
--      assessment runs one more trigger, which takes the lock the others
--      take and deletes no row, by an index.
--
-- ── What it changes that exists ─────────────────────────────────────────────
-- Three things, each only if it is exactly as it was read from
-- gradebook-prod on 2026-11-11 (the checks below):
--   student_submit.page    each assessment in its answer gains resources:
--                          [{ id, kind, title, url, page_count }], the ready
--                          ones, in the order added ([] when there are
--                          none). Every other line is as it was.
--   public._photo_strays   the nightly check for files with no row. Until
--                          now it knew one shape of name; a handout's page
--                          would have been reported every night as a file
--                          with a strange name. Now a handout's page with
--                          its row is left alone and not reported; one with
--                          no row, more than 24 hours old, is queued for
--                          deletion like any stray; and an upload never
--                          finished is dropped. Everything it did for
--                          students' photos is as it was.
--   the policy fv_student_photos_fence (the restricting policy that holds a
--                          signed-in teacher to what the allowing policies
--                          say) now also lets through what the two new
--                          policies allow, and nothing else. The other
--                          restricting policy, fv_student_photos_teachers_
--                          only, is not touched.
-- Keep Photos Until is not changed and does not touch a handout: it deletes
-- rows of submission_file, and a handout has none (proved in the tests).
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing. No row of any table is changed, moved or deleted, and no file.
--
-- ── What applying it accepts ────────────────────────────────────────────────
--   THE EDGE FUNCTION MUST BE CHANGED AND DEPLOYED BEFORE ANY SCREEN USES
--   THIS. The student-submit function's worker deletes only names of the
--   students' shape (supabase/functions/_shared/storage-rest.ts, PATH), so
--   today it would skip a queued handout page and leave it in storage, and
--   after six hours the nightly job would report the queue as stuck. It also
--   has no route that calls handout_links. Until the screens exist nothing
--   can add a handout, so applying this file alone is safe.
--   Copy Assessment, Duplicate Class, Copy to Another Class and Restore do
--   not copy handouts or links (an open question for the owner).
--   Backups and Download All My Data leave them out, as they leave photos.
--   A handout's pages do not count against the class's limit for students'
--   photos.
--   A link is not checked beyond its first letters: any http or https
--   address is taken.
--   The photo lifecycle's own post-check (photo-lifecycle-live-postcheck.sql)
--   will from now on list public._photo_strays as changed. That is this
--   file's change, and expected.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless:
--   the functions it calls, and the two it replaces, are exactly the ones it
--     was tested against (md5 of pg_get_functiondef on PostgreSQL 17; the
--     lists below are written by migrations/local-test/handouts_links.py);
--   none of its names is taken (or, on a second run, each is as this file
--     leaves it);
--   storage.objects has row security on, the bucket student-photos is
--     private, 2097152 bytes, image/jpeg only, and the four policies Batch B
--     made are there, the fence exactly as Batch B wrote it (or as this file
--     leaves it).
-- Its last step checks everything came out as this header says.
--
-- Can be run again: the table is left as it is, the functions, triggers and
-- policies are made again, the same.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- Adding the two triggers locks public.assessment against writes, and
-- changing the policies locks storage.objects, each from that statement
-- until the file commits (the rest of its run: a moment). If a long
-- transaction holds either, the file gives up after five seconds with
-- nothing applied: run it again.
--
-- ── What it needs that only the live database can show ──────────────────────
-- That the role applying it may create and alter a policy on
-- storage.objects (it made Batch B's four; the pre-check reads the setting
-- that allows it).
--
-- ── How to apply ────────────────────────────────────────────────────────────
-- Only on the owner's OK (project rule 1), and never to try it out: it was
-- tested on a throwaway PostgreSQL 17 (migrations/local-test/README.md,
-- "Handouts and Links").
--   1. Run migrations/local-test/handouts-links-live-precheck.sql on
--      gradebook-prod (read-only). Expected: no rows. Any row: stop.
--   2. Apply this whole file as one migration named handouts_links. It is
--      one transaction: it all applies or none of it does.
--   3. Run migrations/local-test/handouts-links-live-postcheck.sql
--      (read-only). Expected: no rows.
-- Nothing else is needed for the apply itself. Before a screen uses it, the
-- edge function change above.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/handouts-links-undo.sql (proved by
-- handouts_links.py undo). PART 1, the fast stop: no link or handout can be
-- added and no upload finished; what is ready still shows and can still be
-- removed. PART 2 puts the two functions and the fence back word for word
-- and drops everything this file made; it refuses while the table holds a
-- row.
--
-- One transaction: begin first, commit last; every check that can stop it
-- runs before anything is created.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f     record;
    _md5   text;
    _b     record;
    _fence record;
    _n     int;
    -- The fence as Batch B wrote it, and as this file leaves it.
    _read_before   constant text := '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name))';
    _write_before  constant text := '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name))';
    _read_becomes  constant text := '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name) OR fv_private.handout_read_allowed(name))';
    _write_becomes constant text := '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name) OR fv_private.handout_upload_allowed(name))';
begin
    if to_regclass('public.submission_file_removal') is null or to_regclass('public.photo_check_log') is null
       or to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)') is null then
        raise exception 'the student-work migrations through 2026111160_slips_keyed.sql are not all applied: apply them first. Nothing was changed.';
    end if;
    -- What the new functions call, and what must stay as it is for the
    -- tests to mean anything.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/handouts_links.py)
            ('public.fv_owns_assessment(uuid)',                         '9f4c680c35f9f3ac32e8290824707673'),
            ('public.fv_owns_course(uuid)',                             'e3afeca06043a6e907e6f4ae777c85da'),
            ('public.fv_idem_check(uuid,text)',                         '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)',                   '6d0b48c458d273a332db39e1a4b68626'),
            ('public._grade_return_lock(uuid)',                         '530dca441198b1546a4ec4967cd83b9f'),
            ('public._grade_return_lock_first(uuid)',                   '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._fv_timezone(text)',                               '8dbcb5716f155e2441f47416a0b28527'),
            ('public._work_bucket()',                                   '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_object(text)',                               '1c78c7884df1e02c326b06989da25c5c'),
            ('public._work_hold()',                                     'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_max_bytes()',                                '1384cb1ea953d11cea982d60d87e5421'),
            ('fv_private.work_path_course(text)',                       '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_read_allowed(text)',                      '3ea2b37a835c7a86a881ed743b95d1c9'),
            ('fv_private.work_upload_allowed(text)',                    'b53e85108b1e870a16e717055c63f2dc'),
            ('student_submit._session_class(text,uuid)',                '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit._session_classes(uuid)',                   '722d403571069e3e97516f432ed9de5c'),
            ('student_submit._returned_grade(uuid,uuid)',               '21706ae9eec783107d9da24e52e1855a'),
            ('student_submit.removal_batch(integer)',                   '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                   'de793c82a2b5aa59052994a82e80d166'),
            ('public._submission_file_removed()',                       'edc99e4c04baefcf83b9ce3c94723023'),
            ('public._submission_gone()',                               '606be06c71d963805c12f23208b5c304'),
            ('public._photo_log(uuid,text,integer,jsonb)',              '53859922b32f0e4f2da95052edc130e2'),
            ('public._photo_keep_class(uuid,timestamp with time zone)', 'fb78dde9520f84f0f58faa1bebf98c23'),
            ('public._photo_missing(uuid)',                             'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_stuck()',                                   '8f35709beffa04b59f36840e2d4e2fa0'),
            ('public.photo_removal_due()',                              '3faf3499da0753407687386407c8b01f'),
            ('public.photo_lifecycle_nightly()',                        '7e3dc52c80eb21f50848d67011385a26'),
            ('public.delete_assessment(uuid)',                          'b0557c759c662175194a75bff27c7001'),
            ('public.fv_retention_cleanup()',                           'a8da46d6664ba5956f4215ba3b2ada39')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). A later migration may have replaced it. Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The two it replaces: as read from live, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/handouts_links.py)
            ('student_submit.page(text,uuid,text)',                 '2f1795ba4c5416788d477a540b49fccb', '8d8e3f9aa91e43b0163cb3189430b758'),
            ('public._photo_strays(uuid,timestamp with time zone)', '21db626094c7be734d536357c91826c8', '54ffc47d26beeeb480a2430cd57f8f1e')
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
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/handouts_links.py)
            ('public._handout_path(uuid,uuid,integer)',             '90e3c0e7b44ef1cc8fb3ad1b8b0bc222'),
            ('fv_private.handout_path_parts(text)',                 '9dd1528f2d0d1f49014b4b425b60492b'),
            ('public._assessment_resource_json(uuid)',              '216a6f09d7632edc558686e66a14d086'),
            ('public._assessment_resource_same_class()',            '1d661e6e1a34b6c2a82735f439fdc064'),
            ('public._assessment_resource_removed()',               '331dd8c1a4915e28e1a9ee2131991a93'),
            ('public._assessment_resource_gone()',                  'e7b0e2e222ddd148422248e7e96ce425'),
            ('public._assessment_resource_truncated()',             '5d4a8ca2dd10909f2d669927b2a5bba6'),
            ('public._handout_drop_expired(uuid)',                  'b73cf6fbb7b2b44d1c308d3cca1dfbaf'),
            ('fv_private.handout_upload_allowed(text)',             'b7a01941ecc710558b161f247c6cb413'),
            ('fv_private.handout_read_allowed(text)',               'c49416c21dea4d9ebdae95e1ca881b8c'),
            ('public.add_assessment_link(uuid,text,text,uuid)',     '4b72d1a6e5f2a56e2eb4d2f595be7f4d'),
            ('public.start_handout_upload(uuid,text,integer,uuid)', 'ac3c7d7c3a3f8d30eec287fed2c510ec'),
            ('public.finish_handout_upload(uuid,uuid)',             '03444c3bd55e4826285eeac20bdcfc40'),
            ('public.remove_assessment_resource(uuid,uuid)',        'ceaa38e29071d14b04ba0240c1a9589e'),
            ('public.list_course_resources(uuid)',                  'aedc2494e8d6236cc287a0c1afc9b412'),
            ('student_submit.handout_links(text,uuid,uuid,text)',   'bfb7707f3178d02e63317e3eca4c83c5')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists, and is not as this file leaves it (found %): something else made it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    -- The table: not there, or there with this file's functions (a second run).
    if to_regclass('public.assessment_resource') is not null
       and to_regprocedure('public.start_handout_upload(uuid,text,integer,uuid)') is null then
        raise exception 'public.assessment_resource already exists, and this file''s functions do not: something else made it. Nothing was changed.';
    end if;

    -- Storage: the bucket and Batch B's four policies, as they were read.
    if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
        raise exception 'storage.objects or storage.buckets is not there. Nothing was changed.';
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
        raise exception 'storage.objects has row security turned off: every signed-in user could read every file. Nothing was changed.';
    end if;
    select b.public, b.file_size_limit, b.allowed_mime_types into _b from storage.buckets b where b.id = 'student-photos';
    if not found or _b.public is distinct from false or _b.file_size_limit is distinct from 2097152
       or _b.allowed_mime_types is distinct from array['image/jpeg'] then
        raise exception 'the bucket student-photos is not there, or is not private, limited to 2097152 bytes and to image/jpeg. Nothing was changed.';
    end if;
    select count(*) into _n from pg_policy p
     where p.polrelid = 'storage.objects'::regclass
       and (p.polname, p.polcmd, p.polpermissive) in (('fv_student_photos_read', 'r', true), ('fv_student_photos_upload', 'a', true),
                                                      ('fv_student_photos_teachers_only', '*', false), ('fv_student_photos_fence', '*', false));
    if _n <> 4 then
        raise exception 'the four policies of 2026111102_student_work_storage.sql are not all on storage.objects (found %). Nothing was changed.', _n;
    end if;
    select pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w into _fence
      from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'fv_student_photos_fence';
    if not ((_fence.q = _read_before and _fence.w = _write_before) or (_fence.q = _read_becomes and _fence.w = _write_becomes)) then
        raise exception 'the policy fv_student_photos_fence is not as Batch B wrote it, nor as this file leaves it (found % / %). Nothing was changed.',
            _fence.q, _fence.w;
    end if;
    -- A policy of either new name that says something else is not this file's to replace.
    if exists (select 1 from pg_policy p
                where p.polrelid = 'storage.objects'::regclass and p.polname in ('fv_handouts_read', 'fv_handouts_upload')
                  and coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
                      not in ('((bucket_id = ''student-photos''::text) AND fv_private.handout_read_allowed(name))',
                              '((bucket_id = ''student-photos''::text) AND fv_private.handout_upload_allowed(name))')) then
        raise exception 'a policy named fv_handouts_read or fv_handouts_upload is on storage.objects and says something else. Nothing was changed.';
    end if;
end
$guard$;

-- ── 1. The table ────────────────────────────────────────────────────────────
create table if not exists public.assessment_resource (
    id            uuid        primary key default gen_random_uuid(),
    -- No foreign key (the header, 1): the triggers below keep it true.
    assessment_id uuid        not null,
    course_id     uuid        not null,
    kind          text        not null constraint assessment_resource_kind_check check (kind in ('pdf', 'link')),
    -- What students see: the handout's name, or the link's.
    title         text        not null constraint assessment_resource_title_check check (char_length(title) between 1 and 200),
    url           text,
    page_count    integer,
    status        text        not null constraint assessment_resource_status_check check (status in ('uploading', 'ready')),
    position      integer     not null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    -- A link has an address and no pages, and is ready at once. A handout
    -- has pages (20 at most) and no address.
    constraint assessment_resource_shape_check check (
        (kind = 'link' and url is not null and char_length(url) <= 2000 and url ~* '^https?://'
                       and page_count is null and status = 'ready')
     or (kind = 'pdf' and url is null and page_count is not null and page_count between 1 and 20))
);
-- What the trigger on assessment deletes by, and what every list reads by.
create index if not exists assessment_resource_assessment_idx on public.assessment_resource (assessment_id, position);
create index if not exists assessment_resource_course_idx on public.assessment_resource (course_id);
comment on table public.assessment_resource is
    'Handouts and Links (2026111170): one row for each handout (a PDF kept as JPEG pages in the bucket student-photos) or link a teacher puts on an assessment. Written only by the functions of 2026111170, under the class''s lock. Deleting a row queues a handout''s pages for deletion (submission_file_removal).';

alter table public.assessment_resource enable row level security;
drop policy if exists assessment_resource_read on public.assessment_resource;
create policy assessment_resource_read on public.assessment_resource
    for select to authenticated
    using (public.fv_owns_assessment(assessment_id));
revoke all on table public.assessment_resource from public, anon, authenticated, service_role;
grant select on table public.assessment_resource to authenticated;

-- ── 2. Where a page is ──────────────────────────────────────────────────────
-- The one place a handout page's path is made.
create or replace function public._handout_path(p_course_id uuid, p_resource_id uuid, p_page integer)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select p_course_id::text || '/handouts/' || p_resource_id::text || '/' || p_page::text || '.jpg';
$function$;

-- A name's parts when it is exactly a handout page's (lower-case ids, a
-- page number from 1 to 99 with no leading zero), and no row otherwise.
create or replace function fv_private.handout_path_parts(p_name text)
 returns table (course_id uuid, resource_id uuid, page integer)
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select m[1]::uuid, m[2]::uuid, m[3]::integer
      from regexp_match(p_name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/handouts/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([1-9][0-9]?)\.jpg$') m
     where m is not null;
$function$;

-- One row as the browser is given it. A handout also carries its pages'
-- paths, and, while it is uploading, the time the upload must be finished by.
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
           || case when r.kind = 'pdf' and r.status = 'uploading'
                   then jsonb_build_object('finish_by', r.created_at + _work_hold())
                   else '{}'::jsonb end
      from assessment_resource r
     where r.id = p_id;
$function$;

-- ── 3. Triggers ─────────────────────────────────────────────────────────────
-- A row's assessment is in the class the row names.
create or replace function public._assessment_resource_same_class()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if not exists (select 1 from assessment a where a.id = new.assessment_id and a.course_id = new.course_id) then
        raise exception 'assessment_resource: the assessment is not in this class' using errcode = '23514';
    end if;
    return new;
end;
$function$;

create or replace trigger assessment_resource_same_class
    before insert or update of assessment_id, course_id on public.assessment_resource
    for each row execute function public._assessment_resource_same_class();

-- When a row goes, every page of a handout is queued for deletion from
-- storage, in the same transaction, whoever deleted the row and however.
-- The file is deleted at the worker's next run, and looked for once more ten
-- minutes later: an upload the Storage service had already let through when
-- the row went could still land.
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
    end if;
    return null;
end;
$function$;

create or replace trigger assessment_resource_removed
    after delete on public.assessment_resource
    for each row execute function public._assessment_resource_removed();

-- An assessment's rows go with it (and so with its class, when the class is
-- purged). The class's lock first, as every write here.
create or replace function public._assessment_resource_gone()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _grade_return_lock(old.course_id);
    delete from assessment_resource where assessment_id = old.id;
    return null;
end;
$function$;

create or replace trigger assessment_resource_gone after delete on public.assessment
    for each row execute function public._assessment_resource_gone();

-- TRUNCATE fires no row trigger: whatever is left without its assessment
-- goes (as submission_truncate does for submissions).
create or replace function public._assessment_resource_truncated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    delete from assessment_resource r
     where not exists (select 1 from assessment a where a.id = r.assessment_id);
    return null;
end;
$function$;

create or replace trigger assessment_resource_truncate after truncate on public.assessment
    for each statement execute function public._assessment_resource_truncated();

-- ── 4. An upload never finished ─────────────────────────────────────────────
-- A handout still 'uploading' two hours after its start is dropped; the
-- trigger queues whatever pages were uploaded. How many were dropped.
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
     where course_id = p_course_id and kind = 'pdf' and status = 'uploading' and created_at < now() - _work_hold();
    get diagnostics _n = row_count;
    perform set_config('fv.handout_removal_reason', '', true);
    return _n;
end;
$function$;

-- ── 5. What the storage policies ask ────────────────────────────────────────
-- May the signed-in teacher write this exact name? Only a page of a handout
-- in a class they own that is still uploading and still holds its place.
create or replace function fv_private.handout_upload_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = 'pdf' and h.page <= r.page_count
                      and r.status = 'uploading'
                      and r.created_at >= now() - _work_hold()
                      and fv_owns_assessment(r.assessment_id));
$function$;

-- May the signed-in teacher read this name? A page of a handout in a class
-- they own, uploading or ready.
create or replace function fv_private.handout_read_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = 'pdf' and h.page <= r.page_count
                      and fv_owns_assessment(r.assessment_id));
$function$;

-- ── 6. The teacher's functions ──────────────────────────────────────────────
-- Add a Link. With no name, students see the site's address (the part
-- between the slashes).
create or replace function public.add_assessment_link(
    p_assessment_id uuid, p_url text, p_title text default null, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _url    text := btrim(coalesce(p_url, ''));
    _title  text := btrim(coalesce(p_title, ''));
    _id     uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    if char_length(_url) > 2000 or _url !~* '^https?://[^[:space:][:cntrl:]/?#]+[^[:space:][:cntrl:]]*$' then
        raise exception 'a link must start with http:// or https://, with no spaces, and be 2000 characters at most' using errcode = '22023';
    end if;
    if _title = '' then
        _title := left(substring(_url from '^[A-Za-z]+://(?:[^/?#@]*@)?([^/?#]+)'), 200);
    end if;
    if char_length(_title) > 200 then
        raise exception 'a name can be 200 characters at most' using errcode = '22023';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;

    perform _grade_return_lock_first(_course);
    -- Asked under the lock: the same request sent twice at once waits here,
    -- and the second is answered as a repeat of the first.
    _cached := fv_idem_check(p_idempotency_key, 'add_assessment_link');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        -- deleted while this call waited for the class
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    perform _handout_drop_expired(_course);
    if (select count(*) from assessment_resource r where r.assessment_id = p_assessment_id) >= 50 then
        raise exception 'an assessment can hold 50 handouts and links at most' using errcode = '22023';
    end if;
    insert into assessment_resource (assessment_id, course_id, kind, title, url, status, position)
    values (p_assessment_id, _course, 'link', _title, _url, 'ready',
            (select coalesce(max(r.position), 0) + 1 from assessment_resource r where r.assessment_id = p_assessment_id))
    returning id into _id;
    _cached := _assessment_resource_json(_id);
    perform fv_idem_store(p_idempotency_key, 'add_assessment_link', _cached);
    return _cached;
end;
$function$;

-- Add a PDF, first step: the row, and the paths its pages go to. The
-- browser uploads each page signed in, and the storage policy lets it write
-- exactly those paths for two hours.
create or replace function public.start_handout_upload(
    p_assessment_id uuid, p_title text, p_page_count integer, p_idempotency_key uuid default null)
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
    if p_page_count is null or p_page_count not between 1 and 20 then
        raise exception 'a handout can have 1 to 20 pages' using errcode = '22023';
    end if;
    if _title = '' then
        _title := 'Handout';
    end if;
    if char_length(_title) > 200 then
        raise exception 'a name can be 200 characters at most' using errcode = '22023';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;

    perform _grade_return_lock_first(_course);
    _cached := fv_idem_check(p_idempotency_key, 'start_handout_upload');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    perform _handout_drop_expired(_course);
    if (select count(*) from assessment_resource r where r.assessment_id = p_assessment_id) >= 50 then
        raise exception 'an assessment can hold 50 handouts and links at most' using errcode = '22023';
    end if;
    insert into assessment_resource (assessment_id, course_id, kind, title, page_count, status, position)
    values (p_assessment_id, _course, 'pdf', _title, p_page_count, 'uploading',
            (select coalesce(max(r.position), 0) + 1 from assessment_resource r where r.assessment_id = p_assessment_id))
    returning id into _id;
    _cached := _assessment_resource_json(_id) || jsonb_build_object('bucket', _work_bucket());
    perform fv_idem_store(p_idempotency_key, 'start_handout_upload', _cached);
    return _cached;
end;
$function$;

-- Add a PDF, last step: ready only when every page is in storage, a JPEG
-- within the bucket's limit. Otherwise the row comes back still 'uploading'
-- with the page numbers that are missing (and, apart, any that are there
-- but are not a JPEG of that size), and nothing is remembered, so the next
-- try looks again. A handout that is not there (never was, another
-- teacher's, removed, or its two hours ran out) answers { id, status:
-- 'gone' }: an answer, not an error, so the drop of an upload that ran out
-- of time is kept.
create or replace function public.finish_handout_upload(p_resource_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached  jsonb;
    _course  uuid;
    _r       assessment_resource%rowtype;
    _missing jsonb;
    _bad     jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from assessment_resource r
     where r.id = p_resource_id and r.kind = 'pdf' and fv_owns_assessment(r.assessment_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock): the same request
    -- sent twice at once waits above, and the second is answered as a repeat.
    _cached := fv_idem_check(p_idempotency_key, 'finish_handout_upload');
    if _cached is not null then return _cached; end if;
    if _course is null then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    -- An upload that has lost its place is dropped here, with the class's others.
    perform _handout_drop_expired(_course);
    select * into _r from assessment_resource where id = p_resource_id for update;
    if not found then
        return jsonb_build_object('id', p_resource_id, 'status', 'gone');
    end if;
    if _r.status = 'uploading' then
        select coalesce(jsonb_agg(g.n order by g.n) filter (where w.n is null), '[]'::jsonb),
               coalesce(jsonb_agg(g.n order by g.n)
                        filter (where w.n is not null
                                  and (w.mimetype = 'image/jpeg' and w.bytes between 1 and _work_max_bytes()) is not true), '[]'::jsonb)
          into _missing, _bad
          from generate_series(1, _r.page_count) g(n)
          left join lateral (select g.n, x.bytes, x.mimetype
                               from _work_object(_handout_path(_r.course_id, _r.id, g.n)) x) w on true;
        if _missing <> '[]'::jsonb or _bad <> '[]'::jsonb then
            return _assessment_resource_json(_r.id)
                   || jsonb_build_object('missing', _missing)
                   || case when _bad <> '[]'::jsonb then jsonb_build_object('bad', _bad) else '{}'::jsonb end;
        end if;
        update assessment_resource set status = 'ready', updated_at = now() where id = _r.id;
    end if;
    _cached := _assessment_resource_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'finish_handout_upload', _cached);
    return _cached;
end;
$function$;

-- Remove a handout or a link. A handout's pages are queued for deletion by
-- the trigger. One that is already gone, or is not the teacher's, answers
-- { removed: false }: asking twice is not an error.
create or replace function public.remove_assessment_resource(p_resource_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _n      int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from assessment_resource r
     where r.id = p_resource_id and fv_owns_assessment(r.assessment_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'remove_assessment_resource');
    if _cached is not null then return _cached; end if;
    if _course is null then
        return jsonb_build_object('removed', false);
    end if;
    delete from assessment_resource where id = p_resource_id;
    get diagnostics _n = row_count;
    _cached := jsonb_build_object('removed', _n > 0);
    perform fv_idem_store(p_idempotency_key, 'remove_assessment_resource', _cached);
    return _cached;
end;
$function$;

-- The class's handouts and links, for the teacher's screens: each
-- assessment's in the order added. An upload that has lost its place is left
-- out (the next write drops it).
create or replace function public.list_course_resources(p_course_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return coalesce((
        select jsonb_agg(_assessment_resource_json(r.id) order by r.assessment_id, r.position, r.created_at, r.id)
          from assessment_resource r
         where r.course_id = p_course_id
           and not (r.status = 'uploading' and r.created_at < now() - _work_hold())), '[]'::jsonb);
end;
$function$;

-- ── 7. The student's side ───────────────────────────────────────────────────
-- The page paths of one ready handout, for the edge function to sign. Only
-- for an assessment the student's page shows: in the session's own class,
-- and not dated into the future (the test page and file_links make).
create or replace function student_submit.handout_links(
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
       and (a.date_assigned is null
            or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'resource_id', _r.id, 'assessment_id', _r.assessment_id, 'title', _r.title, 'page_count', _r.page_count,
        'pages', (select jsonb_agg(jsonb_build_object('page', n, 'path', public._handout_path(_r.course_id, _r.id, n)) order by n)
                    from generate_series(1, _r.page_count) n));
end;
$function$;

-- page, as 2026111150 left it, with one more key on each assessment:
-- resources, the ready handouts and links in the order added. Every other
-- line is as it was.
create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb := _session_class(p_session_token, p_enrollment_id);
    _course  course%rowtype;
    _today   date;
    _weights numeric;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    -- What the class's category weights total: 100, or null with no categories.
    select sum(k.weight) into _weights from category k where k.course_id = _course.id;

    return jsonb_build_object(
        'ok', true, 'v', 1,
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent,
            -- The name the class's teacher signed up with, and nothing else of theirs.
            'teacher_name', (select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code,
                                                                   'i_can', to_jsonb(t.i_can_statements)))
              from tag t join section s on s.id = t.section_id
             where s.course_id = _course.id and s.removed_at is null), '{}'::jsonb),
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'name', r.name, 'style', r.style,
                       'criteria', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'id', cr.id, 'name', cr.name, 'weight', cr.weight,
                                      'level_1_value', cr.level_1_value, 'level_2_value', cr.level_2_value,
                                      'level_3_value', cr.level_3_value, 'level_4_value', cr.level_4_value,
                                      'level_1_descriptor', cr.level_1_descriptor, 'level_2_descriptor', cr.level_2_descriptor,
                                      'level_3_descriptor', cr.level_3_descriptor, 'level_4_descriptor', cr.level_4_descriptor,
                                      -- The competencies this row counts toward, only those still on the class.
                                      'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                             from criterion_tag x
                                                             join tag t on t.id = x.tag_id
                                                             join section s on s.id = t.section_id
                                                            where x.criterion_id = cr.id
                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),
                                      'checks', coalesce((
                                          select jsonb_agg(jsonb_build_object('id', ck.id, 'level', ck.level, 'label', ck.label)
                                                           order by ck.level, ck.display_order, ck.id)
                                            from criterion_check ck where ck.criterion_id = cr.id), '[]'::jsonb))
                                    order by cr.display_order, cr.id)
                             from criterion cr where cr.rubric_id = r.id), '[]'::jsonb)) order by r.id)
              from rubric r
             where r.course_id = _course.id
               and exists (select 1 from assessment a where a.rubric_id = r.id
                              and (a.date_assigned is null or a.date_assigned <= _today))), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', a.id, 'title', a.title, 'date', a.date_assigned, 'due_date', a.due_date,
                           'score_mode', a.score_mode, 'max_points', a.max_points, 'weight', a.weight,
                           'rubric_id', a.rubric_id, 'created_at', a.created_at,
                           'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                  from assessment_tag x
                                                  join tag t on t.id = x.tag_id
                                                  join section s on s.id = t.section_id
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb),
                           'description', nullif(a.description, ''),
                           'module_name', (select m.name from module m where m.id = a.module_id and m.course_id = _course.id),
                           'category_name', k.name,
                           -- What the category counts toward the course grade as the class is set
                           -- up, or null where no percent would be true (the header says when).
                           'category_percent', case when a.score_mode = 'dibels' then null
                                                    when k.weight = 0 then 0
                                                    when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight
                                               end,
                           -- The Ministry's seven, in its order, named as shared/constants.js names them.
                           'core_competencies', coalesce((
                               select jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.ord)
                                 from (values (1, 'COM', 'Communicating'),
                                              (2, 'COL', 'Collaborating'),
                                              (3, 'CT',  'Creative Thinking'),
                                              (4, 'CRT', 'Critical & Reflective Thinking'),
                                              (5, 'PPI', 'Personal & Cultural Identity'),
                                              (6, 'PAR', 'Personal Awareness & Responsibility'),
                                              (7, 'SAR', 'Social Awareness & Responsibility')) as cc(ord, id, name)
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb),
                           -- Handouts and Links (2026111170): what the teacher put on the piece, the
                           -- ready ones only, in the order added
                           'resources', coalesce((
                               select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title,
                                                                   'url', r.url, 'page_count', r.page_count)
                                                order by r.position, r.created_at, r.id)
                                 from assessment_resource r
                                where r.assessment_id = a.id and r.status = 'ready'), '[]'::jsonb))
                       -- E9: the piece's category id, only when Show My Learning is on
                       || case when _course.show_my_learning then jsonb_build_object('category_id', k.id) else '{}'::jsonb end
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
              left join category k on k.id = a.category_id and k.course_id = _course.id
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb))
        -- E9: Show My Learning on: the class's own settings, categories, folders and learning map
        -- (get_class_bundle's shapes; no tag source_text). Off: nothing is added.
        || case when _course.show_my_learning then jsonb_build_object(
               'show_my_learning', true,
               'learning', jsonb_build_object(
                   -- E9: the twelve calculation and grading-style columns of course, and no other
                   'course', jsonb_build_object(
                       'grading_system', _course.grading_system, 'calc_method', _course.calc_method,
                       'decay_weight', _course.decay_weight, 'recent_score_limit', _course.recent_score_limit,
                       'grading_scale', _course.grading_scale, 'category_weights', _course.category_weights,
                       'round_percent', _course.round_percent, 'level_order', _course.level_order,
                       'reporting_terms', _course.reporting_terms, 'timezone', _course.timezone,
                       'folders_count_as_one', _course.folders_count_as_one,
                       'courses_count_equally', _course.courses_count_equally),
                   -- E9: every category of the class, as the bundle sends them
                   'categories', coalesce((
                       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                           'display_order', c.display_order, 'calc_mode', c.calc_mode)
                                        order by c.display_order, c.id)
                         from category c where c.course_id = _course.id), '[]'::jsonb),
                   -- E9: this student's own hand-set levels, as the bundle sends them, without the teacher's reason
                   'section_overrides', coalesce((
                       select jsonb_object_agg(o.section_id::text, jsonb_build_object('level', o.level, 'date', o.updated_at))
                         from section_override o where o.enrollment_id = p_enrollment_id), '{}'::jsonb),
                   -- E9: the class's folders, as the bundle sends them
                   'competency_groups', coalesce((
                       select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                           'display_order', cg.display_order,
                                                           'counts_as_one', cg.counts_as_one)
                                        order by cg.display_order, cg.name)
                         from competency_group cg where cg.course_id = _course.id), '[]'::jsonb),
                   -- E9: the learning map: subjects, their sections not removed, their tags, in the bundle's order
                   'subjects', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'id', subj.id, 'name', subj.name, 'display_order', subj.display_order,
                                  'sections', coalesce((
                                      select jsonb_agg(jsonb_build_object(
                                                 'id', sec.id, 'name', sec.name, 'display_order', sec.display_order,
                                                 'competency_group_id', sec.competency_group_id,
                                                 'tags', coalesce((
                                                     select jsonb_agg(jsonb_build_object(
                                                                'id', t.id, 'code', t.code, 'label', t.label,
                                                                'i_can_text', t.i_can_text,
                                                                'i_can_statements', to_jsonb(t.i_can_statements),
                                                                'bank_id', t.bank_id, 'display_order', t.display_order)
                                                            order by t.display_order, t.label)
                                                       from tag t where t.section_id = sec.id), '[]'::jsonb))
                                             order by sec.display_order, sec.name)
                                        from section sec
                                       where sec.subject_id = subj.id and sec.course_id = _course.id
                                         and sec.removed_at is null), '[]'::jsonb))
                                order by subj.display_order, subj.name)
                         from subject subj where subj.course_id = _course.id), '[]'::jsonb)))
           else '{}'::jsonb end;
end;
$function$;

-- Service role only for page, as before (create or replace keeps its grants;
-- these two lines change nothing where they are as they should be).
revoke all on function student_submit.page(text, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.page(text, uuid, text) to service_role;

-- ── 8. The nightly check for files with no row ──────────────────────────────
-- As 2026111140 made it, and now it knows a handout's page:
--   a class's own run (p_course_id given) first drops that class's uploads
--     never finished, then queues, beside the strays of the students' shape,
--     each handout-shaped file under the class's folder that no row names
--     and that is more than 24 hours old;
--   the run for no class (null) queues such files of classes that are gone,
--     and no longer counts a handout-shaped name among the files with
--     strange names.
-- A handout's page that has its row is never queued and never reported.
create or replace function public._photo_strays(p_course_id uuid, p_now timestamptz)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _layout constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){4}(-thumb)?\.jpg$';
    -- a handout's page (2026111170): <class>/handouts/<resource>/<page number>.jpg
    _handout constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/handouts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]?\.jpg$';
    _queued int := 0;
    _more   int := 0;
    _other  int := 0;
    _gone   int := 0;
begin
    if p_course_id is not null then
        perform _grade_return_lock_first(p_course_id);
        -- '/' then '0' are next to each other: every name that starts "<class>/", and no other
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.name >= (p_course_id::text || '/') collate "C" and o.name < (p_course_id::text || '0') collate "C"
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _layout
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, p_course_id, 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
        -- Handouts (2026111170). An upload never finished goes first, so its
        -- pages are queued by its row's trigger, not as strays.
        _gone := _handout_drop_expired(p_course_id);
        if _gone > 0 then
            perform _photo_log(p_course_id, 'expired', _gone, jsonb_build_object('handouts', _gone));
        end if;
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.name >= (p_course_id::text || '/handouts/') collate "C" and o.name < (p_course_id::text || '/handouts0') collate "C"
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _handout
               -- a page some handout's row still names is not a stray
               and not exists (select 1 from fv_private.handout_path_parts(o.name) h
                                 join assessment_resource a on a.id = h.resource_id
                                where a.course_id = h.course_id and a.kind = 'pdf' and h.page <= a.page_count)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, p_course_id, 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _more from q;
        _queued := _queued + _more;
    else
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and (o.name ~ _layout or o.name ~ _handout)
               and not exists (select 1 from course c where c.id = fv_private.work_path_course(o.name))
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from fv_private.handout_path_parts(o.name) h
                                 join assessment_resource a on a.id = h.resource_id
                                where a.course_id = h.course_id and a.kind = 'pdf' and h.page <= a.page_count)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, fv_private.work_path_course(s.name), 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
        select count(*) into _other
          from storage.objects o
         where o.bucket_id = _work_bucket() and o.archived_at is null and not o.is_delete_marker
           and o.created_at < p_now - interval '24 hours' and o.name !~ _layout and o.name !~ _handout;
        if _other > 0 then
            perform _photo_log(null, 'stray_other_name', _other, null);
        end if;
    end if;
    if _queued > 0 then
        perform _photo_log(p_course_id, 'stray_queued', _queued, null);
    end if;
    return jsonb_build_object('queued', _queued, 'other_name', _other);
end;
$function$;

-- ── 9. Who may touch a handout's files ──────────────────────────────────────
-- Storage checks these as the signed-in teacher. The service role (the edge
-- functions) is not subject to them: a student's link to a page is made with
-- the service key, for the paths handout_links names and no other.
drop policy if exists fv_handouts_read on storage.objects;
create policy fv_handouts_read on storage.objects
    for select to authenticated
    using (bucket_id = 'student-photos' and fv_private.handout_read_allowed(name));

drop policy if exists fv_handouts_upload on storage.objects;
create policy fv_handouts_upload on storage.objects
    for insert to authenticated
    with check (bucket_id = 'student-photos' and fv_private.handout_upload_allowed(name));

-- The fence (2026111102) holds a signed-in teacher to what the allowing
-- policies say, whatever other policy storage.objects is ever given. It
-- must let through what the two policies above allow, or they would allow
-- nothing: so it now names their two tests beside Batch B's, and still
-- nothing else. Changed in place, so the bucket is never without it.
alter policy fv_student_photos_fence on storage.objects
    using (bucket_id is distinct from 'student-photos' or fv_private.work_read_allowed(name) or fv_private.handout_read_allowed(name))
    with check (bucket_id is distinct from 'student-photos' or fv_private.work_upload_allowed(name) or fv_private.handout_upload_allowed(name));

-- ── 10. Who can run what ────────────────────────────────────────────────────
-- The teacher's five: signed-in teachers only. The anonymous role runs
-- nothing (20261013), and the service role has no use for them.
revoke all on function public.add_assessment_link(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.start_handout_upload(uuid, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_handout_upload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.remove_assessment_resource(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_course_resources(uuid) from public, anon, authenticated, service_role;
grant execute on function public.add_assessment_link(uuid, text, text, uuid) to authenticated;
grant execute on function public.start_handout_upload(uuid, text, integer, uuid) to authenticated;
grant execute on function public.finish_handout_upload(uuid, uuid) to authenticated;
grant execute on function public.remove_assessment_resource(uuid, uuid) to authenticated;
grant execute on function public.list_course_resources(uuid) to authenticated;

-- What the storage policies call: signed-in teachers only (Storage asks as
-- the teacher).
revoke all on function fv_private.handout_upload_allowed(text) from public, anon, authenticated, service_role;
revoke all on function fv_private.handout_read_allowed(text) from public, anon, authenticated, service_role;
grant execute on function fv_private.handout_upload_allowed(text) to authenticated;
grant execute on function fv_private.handout_read_allowed(text) to authenticated;

-- The student's side: the service role only (the edge function).
revoke all on function student_submit.handout_links(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function student_submit.handout_links(text, uuid, uuid, text) to service_role;

-- Helpers and trigger functions: nobody is granted them. They are called by
-- the functions above, as their owner.
revoke all on function public._handout_path(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function fv_private.handout_path_parts(text) from public, anon, authenticated, service_role;
revoke all on function public._assessment_resource_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public._assessment_resource_same_class() from public, anon, authenticated, service_role;
revoke all on function public._assessment_resource_removed() from public, anon, authenticated, service_role;
revoke all on function public._assessment_resource_gone() from public, anon, authenticated, service_role;
revoke all on function public._assessment_resource_truncated() from public, anon, authenticated, service_role;
revoke all on function public._handout_drop_expired(uuid) from public, anon, authenticated, service_role;
-- _photo_strays keeps 2026111140's grants (create or replace keeps them): nobody.

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _n    int;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/handouts_links.py)
            ('public._handout_path(uuid,uuid,integer)',             '90e3c0e7b44ef1cc8fb3ad1b8b0bc222'),
            ('fv_private.handout_path_parts(text)',                 '9dd1528f2d0d1f49014b4b425b60492b'),
            ('public._assessment_resource_json(uuid)',              '216a6f09d7632edc558686e66a14d086'),
            ('public._assessment_resource_same_class()',            '1d661e6e1a34b6c2a82735f439fdc064'),
            ('public._assessment_resource_removed()',               '331dd8c1a4915e28e1a9ee2131991a93'),
            ('public._assessment_resource_gone()',                  'e7b0e2e222ddd148422248e7e96ce425'),
            ('public._assessment_resource_truncated()',             '5d4a8ca2dd10909f2d669927b2a5bba6'),
            ('public._handout_drop_expired(uuid)',                  'b73cf6fbb7b2b44d1c308d3cca1dfbaf'),
            ('fv_private.handout_upload_allowed(text)',             'b7a01941ecc710558b161f247c6cb413'),
            ('fv_private.handout_read_allowed(text)',               'c49416c21dea4d9ebdae95e1ca881b8c'),
            ('public.add_assessment_link(uuid,text,text,uuid)',     '4b72d1a6e5f2a56e2eb4d2f595be7f4d'),
            ('public.start_handout_upload(uuid,text,integer,uuid)', 'ac3c7d7c3a3f8d30eec287fed2c510ec'),
            ('public.finish_handout_upload(uuid,uuid)',             '03444c3bd55e4826285eeac20bdcfc40'),
            ('public.remove_assessment_resource(uuid,uuid)',        'ceaa38e29071d14b04ba0240c1a9589e'),
            ('public.list_course_resources(uuid)',                  'aedc2494e8d6236cc287a0c1afc9b412'),
            ('student_submit.handout_links(text,uuid,uuid,text)',   'bfb7707f3178d02e63317e3eca4c83c5')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/handouts_links.py)
            ('student_submit.page(text,uuid,text)',                 '2f1795ba4c5416788d477a540b49fccb', '8d8e3f9aa91e43b0163cb3189430b758'),
            ('public._photo_strays(uuid,timestamp with time zone)', '21db626094c7be734d536357c91826c8', '54ffc47d26beeeb480a2430cd57f8f1e')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    -- The six policies on storage.objects: Batch B's four and the two here, the fence naming all four tests.
    select count(*) into _n from pg_policy p
     where p.polrelid = 'storage.objects'::regclass
       and (p.polname, p.polcmd, p.polpermissive,
            coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) in (
            ('fv_student_photos_read', 'r', true,
             '((bucket_id = ''student-photos''::text) AND fv_private.work_read_allowed(name))', ''),
            ('fv_student_photos_upload', 'a', true,
             '', '((bucket_id = ''student-photos''::text) AND fv_private.work_upload_allowed(name))'),
            ('fv_student_photos_teachers_only', '*', false,
             '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR (CURRENT_USER = ''authenticated''::name))',
             '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR (CURRENT_USER = ''authenticated''::name))'),
            ('fv_student_photos_fence', '*', false,
             '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name) OR fv_private.handout_read_allowed(name))',
             '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name) OR fv_private.handout_upload_allowed(name))'),
            ('fv_handouts_read', 'r', true,
             '((bucket_id = ''student-photos''::text) AND fv_private.handout_read_allowed(name))', ''),
            ('fv_handouts_upload', 'a', true,
             '', '((bucket_id = ''student-photos''::text) AND fv_private.handout_upload_allowed(name))'));
    if _n <> 6 then
        raise exception 'the six policies on storage.objects are not all there as written (found %). Nothing was changed.', _n;
    end if;
    -- The table: row security on, read by signed-in teachers only, written by nobody directly.
    if not (select c.relrowsecurity from pg_class c where c.oid = 'public.assessment_resource'::regclass)
       or has_table_privilege('anon', 'public.assessment_resource', 'select')
       or has_table_privilege('authenticated', 'public.assessment_resource', 'insert, update, delete, truncate')
       or not has_table_privilege('authenticated', 'public.assessment_resource', 'select') then
        raise exception 'public.assessment_resource is not closed as the header says. Nothing was changed.';
    end if;
    -- The four triggers.
    select count(*) into _n from pg_trigger t
     where not t.tgisinternal
       and (t.tgrelid, t.tgname) in (('public.assessment_resource'::regclass, 'assessment_resource_same_class'),
                                     ('public.assessment_resource'::regclass, 'assessment_resource_removed'),
                                     ('public.assessment'::regclass, 'assessment_resource_gone'),
                                     ('public.assessment'::regclass, 'assessment_resource_truncate'));
    if _n <> 4 then
        raise exception 'the four triggers are not all there (found %). Nothing was changed.', _n;
    end if;
    -- The anonymous role runs none of it.
    select string_agg(p.oid::regprocedure::text, ', ') into _left
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and (p.proname ~ '^(_?handout_|_assessment_resource_|add_assessment_link$|start_handout_upload$|finish_handout_upload$|remove_assessment_resource$|list_course_resources$)')
       and has_function_privilege('anon', p.oid, 'execute');
    if _left is not null then
        raise exception 'the anonymous role can run: %. Nothing was changed.', _left;
    end if;
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                        where s ~ '^search_path=(.*, )?pg_temp$');
    if _left is not null then
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. Nothing was changed.', _left;
    end if;
end
$final$;

commit;
