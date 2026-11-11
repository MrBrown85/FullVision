-- PHOTO LIFECYCLE, UNDONE. Not a migration: the way back from
-- migrations/2026111140_photo_lifecycle.sql. Kept under local-test/ so CI's
-- drift check does not wait for it to be applied. Proved by
-- migrations/local-test/photo_lifecycle.py (scenario undo).
--
-- A PHOTO ALREADY DELETED STAYS DELETED. Nothing can bring one back (no
-- second copy is kept). This undo only stops more from being deleted on a
-- schedule.
--
-- PART 1 (the fast stop) unschedules the two pg_cron jobs,
-- fv_photo_lifecycle_daily and fv_photo_removal. From then on nothing is
-- deleted on a date, no stray is queued, and files already queued wait for
-- a student's route or a teacher's sweep, as before the file. It changes no
-- row of the app's. It does not stop a nightly run already going (cancel
-- that run's backend for that) or a call pg_net has already queued; files
-- those queue still leave storage, and their rows are already gone.
--
-- PART 2 puts C1's student_submit._grading_started back (word for word;
-- kept marks then no longer count as grading started) and drops everything
-- else the file made: the procedure, its nine functions and its three
-- tables. It REFUSES, with nothing changed, while public.markup_kept holds a
-- row: those are teachers' marks on photos Keep Photos Until deleted, and
-- dropping the table would delete them. To drop it anyway, first run (it
-- deletes them for good):
--     delete from public.markup_kept;
-- It also refuses unless every function is as the file leaves it (or
-- already back as before), and while either job is still scheduled (run
-- PART 1 first).
-- The removal queue's rows the job added (reasons keep_photos_until, stray,
-- expired) stay in submission_file_removal: they are Batch B's table, and
-- the worker still deletes what they name.

-- ── PART 1 ──────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '5s';
do $stop$
begin
    if to_regclass('cron.job') is not null then
        execute 'select cron.unschedule(jobname) from cron.job where jobname in (''fv_photo_lifecycle_daily'', ''fv_photo_removal'')';
    end if;
end
$stop$;
commit;

-- ── PART 2 ──────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '5s';
do $guard$
declare
    _f    record;
    _md5  text;
    _jobs int := 0;
    _kept boolean := false;
begin
    -- (named only inside execute: on a database without the file the table is not there)
    if to_regclass('public.markup_kept') is not null then
        execute 'select exists (select 1 from public.markup_kept)' into _kept;
    end if;
    if _kept then
        raise exception 'public.markup_kept holds teachers'' marks on photos Keep Photos Until deleted; dropping it would delete them. Delete them first if that is meant (delete from public.markup_kept). Nothing was changed.';
    end if;
    if to_regclass('cron.job') is not null then
        execute 'select count(*)::int from cron.job where jobname in (''fv_photo_lifecycle_daily'', ''fv_photo_removal'')' into _jobs;
    end if;
    if _jobs > 0 then
        raise exception 'a photo lifecycle job is still scheduled: run PART 1 first. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/photo_lifecycle.py)
            ('public._keep_photos_day(text,jsonb,date)',                 'ad345bdd6eadab44296ed32ef7870be6'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', '57f0aac3911eb4657447a951232bed4a'),
            ('public._photo_keep_class(uuid,timestamp with time zone)',  'fb78dde9520f84f0f58faa1bebf98c23'),
            ('public._photo_strays(uuid,timestamp with time zone)',      '21db626094c7be734d536357c91826c8'),
            ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
            ('public._photo_stuck()',                                    '8f35709beffa04b59f36840e2d4e2fa0'),
            ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
            ('public.photo_removal_call()',                              '08b22d449cc3312b31b975ee057fbc08')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% is not as 2026111140 leaves it (found %): something else changed it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/photo_lifecycle.py)
            ('student_submit._grading_started(uuid,uuid)', '13622bbca72904fdf877ce6b336dc6b4', '586a6a0b5910e6c153b72e73a5b672bc')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is neither as 2026111140 leaves it nor as C1 left it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;
-- C1's body (2026111120, section 2b), word for word. CREATE OR REPLACE keeps
-- the owner and the grants (nobody).
create or replace function student_submit._grading_started(p_enrollment_id uuid, p_assessment_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select coalesce((select g.is_draft or g.returned_at is not null
                       from grade_return g
                      where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
                        -- a DIBELS benchmark has no Draft and no Returned (2026110905)
                        and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels')), false)
        -- Mark Up (2026111120): the teacher's marks on a page of this student's work for the piece
        or exists (select 1 from markup m
                    where m.enrollment_id = p_enrollment_id and m.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) > 0);
$function$;
drop procedure if exists public.photo_lifecycle_nightly();
drop function if exists public.photo_removal_call();
drop function if exists public.photo_removal_due();
drop function if exists public._photo_stuck();
drop function if exists public._photo_keep_class(uuid, timestamptz);
drop function if exists public._photo_keep_cutoff(uuid, timestamptz);
drop function if exists public._photo_strays(uuid, timestamptz);
drop function if exists public._photo_missing(uuid);
drop function if exists public._photo_log(uuid, text, integer, jsonb);
drop function if exists public._keep_photos_day(text, jsonb, date);
drop table if exists public.markup_kept;
drop table if exists public.photo_keep_check;
drop table if exists public.photo_check_log;
do $back$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/photo_lifecycle.py)
            ('student_submit._grading_started(uuid,uuid)', '13622bbca72904fdf877ce6b336dc6b4', '586a6a0b5910e6c153b72e73a5b672bc')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before then
            raise exception '% is not back as C1 left it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
end
$back$;
commit;
