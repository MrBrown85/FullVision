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
-- row of the app's.
--
-- PART 2 drops everything the file made: the procedure, its eight
-- functions and its three tables. It REFUSES, with nothing changed, while
-- public.markup_kept holds a row: those are teachers' marks on photos Keep
-- Photos Until deleted, and dropping the table would delete them. To drop it
-- anyway, first run (it deletes them for good):
--     delete from public.markup_kept;
-- It also refuses unless every function is as the file leaves it, and while
-- either job is still scheduled (run PART 1 first).
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
begin
    if to_regclass('public.markup_kept') is null then
        return;   -- nothing of the file's is here (the drops below say "if exists")
    end if;
    if exists (select 1 from public.markup_kept) then
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
            ('public._keep_photos_day(text,jsonb,date)',                 '568deb1608a96d645e698c767393c293'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', 'fa6aac4df967a762d06e92471d28315a'),
            ('public._photo_keep_class(uuid,timestamp with time zone)',  'e19b23b73cf9355855d2533dfaf510f7'),
            ('public._photo_strays(uuid,timestamp with time zone)',      'bf8e6db4222384f840bafa491cd1d08a'),
            ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
            ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
            ('public.photo_removal_call()',                              '73487154c0b63b16231b25f007031522')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% is not as 2026111140 leaves it (found %): something else changed it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;
drop procedure if exists public.photo_lifecycle_nightly();
drop function if exists public.photo_removal_call();
drop function if exists public.photo_removal_due();
drop function if exists public._photo_keep_class(uuid, timestamptz);
drop function if exists public._photo_keep_cutoff(uuid, timestamptz);
drop function if exists public._photo_strays(uuid, timestamptz);
drop function if exists public._photo_missing(uuid);
drop function if exists public._photo_log(uuid, text, integer, jsonb);
drop function if exists public._keep_photos_day(text, jsonb, date);
drop table if exists public.markup_kept;
drop table if exists public.photo_keep_check;
drop table if exists public.photo_check_log;
commit;
