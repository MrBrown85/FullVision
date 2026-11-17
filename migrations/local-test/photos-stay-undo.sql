-- Undo for migrations/2026111704_photos_stay_with_class.sql (2026-11-17).
--
-- ── PART 1, the fast stop ────────────────────────────────────────────────────
-- Puts public._photo_keep_class back word for word as live had it before the
-- file: the nightly job stops deleting the photos of a class not opened for
-- a year and judges Keep Photos Until again, exactly as before (the file kept
-- photo_keep_check current, so it judges from yesterday and catches up on no
-- night it skipped). note_course_opened keeps stamping, so the app's calls
-- still land and nothing shows on the sync dot. Run PART 1 alone (from
-- "PART 1 begins" to "PART 1 ends") to stop only the deleting.
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
-- Drops note_course_opened and the course_opened table (when each class was
-- last opened; no student data), and clears the two comments the file set.
-- Run it only while no app that calls note_course_opened is released: after
-- that release each call would fail and show on the sync dot until the file
-- is applied again.
--
-- Each part stops with nothing changed if a function is neither the file's
-- definition nor the one before it (a later change would be lost). On a
-- database where the file was never applied it changes nothing; a second run
-- changes nothing.
--
-- md5 of pg_get_functiondef (function, before the file, as the file leaves it):
--   public._photo_keep_class(uuid,timestamptz)  fb78dde9520f84f0f58faa1bebf98c23  67d1ae88eeacd34543cc0a80f1055991
--   public.note_course_opened(uuid,uuid)        (none)                            0c9431bb6ff130f8de2715f8315838f1

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
