-- Undo for migrations/2026111704_photos_stay_with_class.sql (2026-11-17).
--
-- ── Which lever: PART 0 first ────────────────────────────────────────────────
-- PART 0 deletes nothing. PART 1 brings Keep Photos Until's deleting back, on
-- a setting teachers can no longer see. Reach for PART 0 first; run PART 1
-- only when Keep Photos Until's deleting is wanted again.
--
-- ── PART 0, the stop that deletes nothing (recommended) ──────────────────────
-- Stamps every class as opened now. The year rule then deletes nothing for
-- 365 days from the moment it runs, and Keep Photos Until stays off: no
-- photo goes by date at all. Nothing else changes; the app's stamps still
-- land. Run it again within the year to keep it so. Run PART 0 alone (from
-- "PART 0 begins" to "PART 0 ends").
--
-- ── PART 1, put the old nightly step back (DELETES PHOTOS) ───────────────────
-- Puts public._photo_keep_class back word for word as live had it before the
-- file. The year rule stops, and KEEP PHOTOS UNTIL DELETES AGAIN, by the
-- setting each class still holds in course.keep_photos_until, which the app
-- no longer shows and teachers can no longer change, with no reminder:
--   - End of Year (the default): the night after June 30 (10:27 UTC), every
--     page handed in by then, in every class with photos, archived or not.
--   - End of Term (any class whose teacher chose it before Nov 17): the
--     night after the last day of the term the class is in (or the next to
--     end), so a class can lose its photos within days, sooner than the year
--     rule would ever take them.
-- Grades, comments and Mark Up stay; the photos cannot come back. The step
-- picks up from the last night it ran (photo_keep_check is kept current), so
-- it does not catch up on nights before PART 1. note_course_opened keeps
-- stamping, so nothing shows on the sync dot. Run PART 1 alone (from "PART 1
-- begins" to "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
-- Drops note_course_opened and the course_opened table (when each class was
-- last opened; no student data), and clears the two comments the file set.
-- Run it only while no app that calls note_course_opened is released: after
-- that release each call would fail and show on the sync dot until the file
-- is applied again.
--
-- PART 1 and PART 2 each stop with nothing changed if a function is neither
-- the file's definition nor the one before it (a later change would be
-- lost). Run whole, the file is PART 0, 1 and 2 in turn: the full removal.
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.
--
-- md5 of pg_get_functiondef (function, before the file, as the file leaves it):
--   public._photo_keep_class(uuid,timestamptz)  fb78dde9520f84f0f58faa1bebf98c23  67d1ae88eeacd34543cc0a80f1055991
--   public.note_course_opened(uuid,uuid)        (none)                            0c9431bb6ff130f8de2715f8315838f1

-- PART 0 begins
do $stop_all$
begin
    if to_regclass('public.course_opened') is null then
        return;   -- the file was never applied: nothing to stop
    end if;
    insert into public.course_opened (course_id, last_opened_at)
    select c.id, now() from public.course c
    on conflict (course_id) do update set last_opened_at = now();
end
$stop_all$;
-- PART 0 ends

-- PART 1 begins
begin;

set local lock_timeout = '5s';

do $guard_keep$
declare
    _md5 text := md5(pg_get_functiondef(to_regprocedure('public._photo_keep_class(uuid,timestamptz)')));
begin
    if _md5 is distinct from 'fb78dde9520f84f0f58faa1bebf98c23' and _md5 is distinct from '67d1ae88eeacd34543cc0a80f1055991' then
        raise exception 'public._photo_keep_class is neither the file''s nor the one before it (md5 %). Nothing was changed.', coalesce(_md5, 'none');
    end if;
end
$guard_keep$;

-- The body as live had it before the file (migrations/baseline/30-functions.sql).
CREATE OR REPLACE FUNCTION public._photo_keep_class(p_course_id uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _expired int;
    _cutoff  timestamptz;
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
    select c.timezone, c.deleted_at, c.keep_photos_until, c.reporting_terms into _c from course c where c.id = p_course_id;
    if not found or _c.deleted_at is not null then
        -- Gone, or in the trash: Keep Photos Until waits (section 7).
        return jsonb_build_object('expired', _expired, 'pages', 0, 'marks_kept', 0, 'before', null, 'skipped', found);
    end if;
    _cutoff := _photo_keep_cutoff(p_course_id, p_now);
    if _cutoff is not null then
        -- Mark Up stays (section 3): copied before its page goes.
        insert into markup_kept (file_id, submission_id, course_id, assessment_id, enrollment_id, page, width, height, rotation,
                                 added_by, working, working_rev, working_at, given, given_rev, given_at, marked_at)
        select m.file_id, f.submission_id, m.course_id, m.assessment_id, m.enrollment_id, f.page, f.width, f.height, f.rotation,
               f.added_by, m.working, m.working_rev, m.working_at, m.given, m.given_rev, m.given_at, m.created_at
          from markup m
          join submission_file f on f.id = m.file_id
          join submission s on s.id = f.submission_id
         where s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
           -- handed in after the day (ruling 106): stays
           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff)
        on conflict (file_id) do nothing;
        get diagnostics _marks = row_count;
        -- The pages go; Batch B's trigger queues both files of each.
        perform set_config('fv.work_removal_reason', 'keep_photos_until', true);
        delete from submission_file f
         using submission s
         where s.id = f.submission_id and s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff);
        get diagnostics _pages = row_count;
        perform set_config('fv.work_removal_reason', '', true);
        if _pages > 0 then
            perform _photo_log(p_course_id, 'keep_photos_until', _pages, jsonb_build_object('before', _cutoff, 'marks_kept', _marks));
        end if;
    end if;
    insert into photo_keep_check (course_id, checked_through, judged_choice, judged_terms, at)
    values (p_course_id, (p_now at time zone _fv_timezone(_c.timezone))::date - 1, _c.keep_photos_until, _c.reporting_terms, now())
    on conflict (course_id) do update
        set checked_through = greatest(photo_keep_check.checked_through, excluded.checked_through),
            judged_choice = excluded.judged_choice, judged_terms = excluded.judged_terms, at = now();
    return jsonb_build_object('expired', _expired, 'pages', _pages, 'marks_kept', _marks, 'before', _cutoff);
end;
$function$;

do $after_keep$
begin
    if md5(pg_get_functiondef(to_regprocedure('public._photo_keep_class(uuid,timestamptz)'))) <> 'fb78dde9520f84f0f58faa1bebf98c23' then
        raise exception 'public._photo_keep_class did not come back as before. Nothing was changed.';
    end if;
end
$after_keep$;

commit;
-- PART 1 ends

-- PART 2 begins
begin;

set local lock_timeout = '5s';

do $guard_rest$
declare
    _keep text := md5(pg_get_functiondef(to_regprocedure('public._photo_keep_class(uuid,timestamptz)')));
    _note text := md5(pg_get_functiondef(to_regprocedure('public.note_course_opened(uuid,uuid)')));
begin
    if _keep is distinct from 'fb78dde9520f84f0f58faa1bebf98c23' then
        raise exception 'Run PART 1 first: public._photo_keep_class is not the one from before the file (md5 %). Nothing was changed.', coalesce(_keep, 'none');
    end if;
    if _note is not null and _note <> '0c9431bb6ff130f8de2715f8315838f1' then
        raise exception 'public.note_course_opened is not the file''s (md5 %). Nothing was changed.', _note;
    end if;
end
$guard_rest$;

drop function if exists public.note_course_opened(uuid, uuid);
drop table if exists public.course_opened;
comment on column public.course.keep_photos_until is null;
comment on table public.photo_keep_check is null;

commit;
-- PART 2 ends
