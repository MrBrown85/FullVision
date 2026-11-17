-- Photos stay with the class (2026-11-17). NOT APPLIED: needs Colin's OK (rule 1).
--
-- THIS FILE CHANGES WHEN STUDENTS' PHOTOS ARE DELETED (rule 2: Colin reviews
-- it). Applying it deletes nothing: every class is stamped as opened at the
-- moment of the apply, so the first photos it could delete are those of a
-- class nobody opens for the year after.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Colin, Nov 17 ("Yes, build it"): "Don't give teachers a choice on when to
-- keep photos until. It's unnecessary for the user and confusing. Always
-- keep them for as long as the course exists, including if it's archived.
-- If the course is deleted, delete the images. If the course has not been
-- opened for a year, delete the images." DECISIONS, "Photos stay with the
-- class (2026-11-17)".
--
-- ── When photos are deleted, after this file ───────────────────────────────
--   Class deleted: at the 30-day permanent purge (fv_retention_cleanup), as
--     today. Unchanged.
--   Class not opened for 365 days: the nightly job (photo_lifecycle_nightly,
--     10:27 UTC, unchanged) deletes every page and thumbnail of the class's
--     handed-in work. "Opened" is a teacher opening the class on the desktop
--     or the phone (note_course_opened, below); a class never opened since
--     it was made counts from when it was made. Archived or not makes no
--     difference. A class in the trash is skipped: the purge has it.
--   Keep Photos Until no longer deletes anything. course.keep_photos_until
--     stays, unused: the app in teachers' browsers until the release still
--     sends it through set_course_send_work, which still accepts it
--     (unchanged), and the class bundle still reads it.
-- What stays when a class's photos go, exactly as when Keep Photos Until
-- fired: grades, comments, the submission rows (the record that work was
-- handed in), and Mark Up (copied to markup_kept before its page goes).
-- Handouts are never deleted by this job (they are not submission_file).
--
-- ── What it adds ───────────────────────────────────────────────────────────
-- public.course_opened (course_id primary key, references course on delete
--   cascade; last_opened_at timestamptz not null default now()). One row per
--   class. Row security on, no grants: only the two functions below reach it.
--   A table of its own, not a column on course, because every update of a
--   course row bumps the class's sync cursor (course_sync_cursor_course_
--   gradebook), and that makes every other device with the class open load
--   it again: a stamp a day would do that once a day per device.
-- Backfill: a row for every class that exists (trashed and archived too),
--   last_opened_at = now(). No other row changes.
-- public.note_course_opened(p_course_id, p_idempotency_key) returns boolean:
--   stamps now() for a class the signed-in teacher owns (fv_owns_course).
--   Idempotent through p_idempotency_key (CLAUDE.md rule 7). Another
--   teacher's class, one in the trash or one that is gone answers false and
--   changes nothing, with no error: a class deleted on another device must
--   not leave a write that fails on the sync dot. The app sends it at most
--   once a day per class per device, through the outbox, when the class is
--   opened (not when it loads in the background).
--
-- ── What it changes (replaced whole, md5-checked before and after) ────────
--   public._photo_keep_class(uuid,timestamptz): the nightly job's per-class
--     step. The same class lock, the same expired-send cleanup, the same
--     skip of a class in the trash, the same copy of Mark Up and the same
--     delete of submission_file rows of sent work (Batch B's trigger queues
--     both files of each page for removal), the same photo_check_log line
--     (kind keep_photos_until, now with 'rule': 'not_opened_a_year' in its
--     detail). Only the cutoff differs: "the class has not been opened for
--     365 days" (every sent page) instead of "Keep Photos Until's day has
--     passed". The removal reason is not_opened_a_year. It still keeps
--     photo_keep_check up to date, unused, so the undo's old body judges
--     from yesterday and never catches up on nights this one skipped.
--   _photo_keep_cutoff, _keep_photos_day and photo_keep_check stay, unused.
-- md5 of pg_get_functiondef on PostgreSQL 17 (live, as this file leaves it):
--   public._photo_keep_class(uuid,timestamptz)                fb78dde9520f84f0f58faa1bebf98c23  67d1ae88eeacd34543cc0a80f1055991
--   public.note_course_opened(uuid,uuid) (new)                                                  0c9431bb6ff130f8de2715f8315838f1
--
-- Relied on, unchanged (each checked first): photo_lifecycle_nightly (calls
-- _photo_keep_class for every class with work), fv_retention_cleanup (the
-- purge; the new table's rows go with their class by the cascade),
-- set_course_send_work (still takes keep_photos_until), fv_owns_course,
-- fv_idem_check, fv_idem_store, _grade_return_lock_first, _work_drop_expired,
-- _photo_log, _fv_timezone and _submission_file_removed (the trigger that
-- queues the files).
--
-- ── The checks it makes first ──────────────────────────────────────────────
-- It stops with nothing changed unless every function above is the live
-- definition (or this file's, on a second run) and course_opened is missing
-- or this file's. Read-only from gradebook-prod: the query in
-- migrations/local-test/photos-stay-live-precheck.sql.
--
-- ── Order ──────────────────────────────────────────────────────────────────
-- After 2026111703. Apply before the release that carries the app which
-- calls note_course_opened (a call to a missing function would fail on the
-- sync dot). The app on teachers' pages now neither sends nor reads it.
--
-- Tested on a throwaway PostgreSQL 17 rebuilt equal to live:
-- migrations/local-test/photos_stay.py (README.md, "Photos stay with the
-- class"). Undo: migrations/local-test/photos-stay-undo.sql (PART 1, the fast
-- stop, puts the old body back; PART 2 removes the rest). After:
-- migrations/local-test/photos-stay-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

-- ── 1. The checks, before anything changes ─────────────────────────────────
do $guard$
declare
    _f   record;
    _md5 text;
    _cols text;
begin
    for _f in select * from (values
        ('public._photo_keep_class(uuid,timestamptz)', 'fb78dde9520f84f0f58faa1bebf98c23', '67d1ae88eeacd34543cc0a80f1055991'),
        ('public.note_course_opened(uuid,uuid)', null, '0c9431bb6ff130f8de2715f8315838f1'),
        ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26', null),
        ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39', null),
        ('public.set_course_send_work(uuid,jsonb,uuid)', '694863746b03f4be25263a5107f5b02e', null),
        ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da', null),
        ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f', null),
        ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626', null),
        ('public._grade_return_lock_first(uuid)', '4d85813e08aaeb108cda95d85f3d66e4', null),
        ('public._work_drop_expired(uuid)', '417711d4dadba3966d0358baee0214f0', null),
        ('public._photo_log(uuid,text,integer,jsonb)', '53859922b32f0e4f2da95052edc130e2', null),
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', null),
        ('public._submission_file_removed()', 'edc99e4c04baefcf83b9ce3c94723023', null)
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname = 'note_course_opened'
                 and oid <> coalesce(to_regprocedure('public.note_course_opened(uuid,uuid)'), 0)) then
        raise exception 'A note_course_opened exists with other arguments or in another schema. Nothing was changed.';
    end if;
    if to_regclass('public.course_opened') is not null then
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
          from pg_attribute where attrelid = 'public.course_opened'::regclass and attnum > 0 and not attisdropped;
        if _cols is distinct from 'course_id uuid, last_opened_at timestamp with time zone' then
            raise exception 'public.course_opened exists and is not this file''s (%). Nothing was changed.', _cols;
        end if;
    end if;
end
$guard$;

-- ── 2. The table, and every class stamped as opened now ────────────────────
create table if not exists public.course_opened (
    course_id      uuid primary key references public.course(id) on delete cascade,
    last_opened_at timestamptz not null default now()
);
alter table public.course_opened enable row level security;
revoke all on table public.course_opened from public, anon, authenticated, service_role;

comment on table public.course_opened is
    'When a teacher last opened each class (note_course_opened). The nightly photo job deletes the photos of a class not opened for 365 days (a class with no row counts from course.created_at).';

-- Every class there is now counts as opened at the apply: no photo goes early.
insert into public.course_opened (course_id, last_opened_at)
select c.id, now() from public.course c
on conflict (course_id) do nothing;

comment on column public.course.keep_photos_until is
    'Unused since 2026111704 (photos stay with the class). Kept so the app from before that release can still send it; nothing reads it to delete photos.';
comment on table public.photo_keep_check is
    'Unused since 2026111704: _photo_keep_class keeps it current only so the undo''s old body starts from yesterday.';

-- ── 3. The stamp ───────────────────────────────────────────────────────────
create or replace function public.note_course_opened(p_course_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'note_course_opened');
    if _cached is not null then return (_cached->>'noted')::boolean; end if;
    -- Another teacher's class, one in the trash, or one that is gone: nothing
    -- to note, and no error (a class deleted on another device must not leave
    -- a write that fails on the sync dot).
    if not fv_owns_course(p_course_id) then return false; end if;
    insert into course_opened (course_id, last_opened_at) values (p_course_id, now())
    on conflict (course_id) do update set last_opened_at = greatest(course_opened.last_opened_at, excluded.last_opened_at);
    perform fv_idem_store(p_idempotency_key, 'note_course_opened', jsonb_build_object('noted', true));
    return true;
end;
$function$;

revoke all on function public.note_course_opened(uuid, uuid) from public, anon;
grant execute on function public.note_course_opened(uuid, uuid) to authenticated, service_role;

-- ── 4. The nightly step: a year without being opened, not Keep Photos Until ─
create or replace function public._photo_keep_class(p_course_id uuid, p_now timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _expired int;
    _cutoff  timestamptz;
    _opened  timestamptz;
    _marks   int := 0;
    _pages   int := 0;
    _c       record;
begin
    -- The class's lock first, as every write to its work.
    perform _grade_return_lock_first(p_course_id);
    _expired := _work_drop_expired(p_course_id);
    if _expired > 0 then
        perform _photo_log(p_course_id, 'expired', _expired, null);
    end if;
    select c.timezone, c.deleted_at, c.created_at, c.keep_photos_until, c.reporting_terms into _c from course c where c.id = p_course_id;
    if not found or _c.deleted_at is not null then
        -- Gone, or in the trash: the 30-day purge deletes its photos.
        return jsonb_build_object('expired', _expired, 'pages', 0, 'marks_kept', 0, 'before', null, 'skipped', found);
    end if;
    -- Photos stay with the class until it goes unopened for 365 days
    -- (2026111704). A class with no stamp counts from when it was made. For
    -- update: an open that commits first is seen; one after waits for this.
    select o.last_opened_at into _opened from course_opened o where o.course_id = p_course_id for update;
    _opened := greatest(_opened, _c.created_at);
    if _opened < p_now - interval '365 days' then
        _cutoff := p_now;
        -- Mark Up stays: copied before its page goes.
        insert into markup_kept (file_id, submission_id, course_id, assessment_id, enrollment_id, page, width, height, rotation,
                                 added_by, working, working_rev, working_at, given, given_rev, given_at, marked_at)
        select m.file_id, f.submission_id, m.course_id, m.assessment_id, m.enrollment_id, f.page, f.width, f.height, f.rotation,
               f.added_by, m.working, m.working_rev, m.working_at, m.given, m.given_rev, m.given_at, m.created_at
          from markup m
          join submission_file f on f.id = m.file_id
          join submission s on s.id = f.submission_id
         where s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
        on conflict (file_id) do nothing;
        get diagnostics _marks = row_count;
        -- The pages go; Batch B's trigger queues both files of each.
        perform set_config('fv.work_removal_reason', 'not_opened_a_year', true);
        delete from submission_file f
         using submission s
         where s.id = f.submission_id and s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff;
        get diagnostics _pages = row_count;
        perform set_config('fv.work_removal_reason', '', true);
        if _pages > 0 then
            perform _photo_log(p_course_id, 'keep_photos_until', _pages,
                               jsonb_build_object('before', _cutoff, 'marks_kept', _marks, 'rule', 'not_opened_a_year', 'last_opened', _opened));
        end if;
    end if;
    -- Unused here; kept current so the undo's old body judges from yesterday.
    insert into photo_keep_check (course_id, checked_through, judged_choice, judged_terms, at)
    values (p_course_id, (p_now at time zone _fv_timezone(_c.timezone))::date - 1, _c.keep_photos_until, _c.reporting_terms, now())
    on conflict (course_id) do update
        set checked_through = greatest(photo_keep_check.checked_through, excluded.checked_through),
            judged_choice = excluded.judged_choice, judged_terms = excluded.judged_terms, at = now();
    return jsonb_build_object('expired', _expired, 'pages', _pages, 'marks_kept', _marks, 'before', _cutoff, 'last_opened', _opened);
end;
$function$;

-- ── 5. Both functions are this file's ──────────────────────────────────────
do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('public._photo_keep_class(uuid,timestamptz)', '67d1ae88eeacd34543cc0a80f1055991'),
        ('public.note_course_opened(uuid,uuid)', '0c9431bb6ff130f8de2715f8315838f1')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
end
$after$;

commit;
