-- Undo for migrations/2026111705_photo_expiry_warning.sql (2026-11-17).
--
-- Neither part deletes or changes a row. Stamps the trigger wrote while it
-- was on stay in course_opened: each is a real restore of a class, and
-- taking one away would bring that class's photos closer to deletion.
--
-- ── PART 0, the stop (deletes nothing) ────────────────────────────────────
-- Drops the trigger (a class restored from the trash keeps its old stamp
-- again, as before the file) and takes list_course_photo_expiry away from
-- signed-in teachers (the app then shows no line, as when the function is
-- missing; nothing on the sync dot). Run PART 0 alone (from "PART 0 begins"
-- to "PART 0 ends").
--
-- ── PART 1, the full removal: the rest of this file ───────────────────────
-- Drops both functions. It stops with nothing changed if either is not this
-- file's definition (a later change would be lost).
--
-- Run whole, the file is PART 0 and PART 1 in one transaction: the full
-- removal. On a database where the file was never applied it changes
-- nothing; a second run changes nothing.
--
-- md5 of pg_get_functiondef, as the file leaves them:
--   public.list_course_photo_expiry()   09fea36f5f757a3de2508a25f9460376
--   public._course_restored_opened()    a345459a8b66ded92f8aad90e01b4f63

begin;
set local lock_timeout = '5s';

-- PART 0 begins
drop trigger if exists course_restored_opened on public.course;
do $stop$
begin
    if to_regprocedure('public.list_course_photo_expiry()') is not null then
        revoke execute on function public.list_course_photo_expiry() from authenticated;
    end if;
end
$stop$;
-- PART 0 ends

do $guard$
declare
    _f record;
    _md5 text;
begin
    for _f in select * from (values
        ('public.list_course_photo_expiry()', '09fea36f5f757a3de2508a25f9460376'),
        ('public._course_restored_opened()', 'a345459a8b66ded92f8aad90e01b4f63')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.now then
            raise exception '% is neither absent nor this file''s definition (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

drop function if exists public.list_course_photo_expiry();
drop function if exists public._course_restored_opened();

commit;
