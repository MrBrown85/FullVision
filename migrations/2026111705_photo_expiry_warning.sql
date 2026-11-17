-- Photos: a warning before the year runs out, and a restored class counts as
-- opened (2026-11-17). NOT APPLIED: needs Colin's OK (rule 1).
--
-- Applying it deletes nothing and changes no existing row.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- 2026111704 (applied Nov 17) deletes a class's photos once it has gone 365
-- days without a teacher opening it. A review left two gaps; Colin: "Resume
-- the still-open jobs".
--   1. Nothing warns the teacher before that night. The app now shows one
--      quiet line per class within 30 days of it, on the Dashboard and the
--      phone's Students screen. It needs each such class's last-opened time
--      and whether it has photos, which the app cannot read (course_opened
--      has no client grants): list_course_photo_expiry, below.
--   2. A class restored from the trash keeps its old stamp. One last opened
--      340 days before it was deleted would lose its photos the first night
--      after it is restored. There is no restore function: the operator
--      restores with "update course set deleted_at = null" (20261012), and
--      the course_owner policy lets a signed-in teacher's own update do the
--      same. So a trigger on course, not a patched function, covers every
--      way back: when deleted_at goes from a time to null, the class is
--      stamped as opened now, in the same transaction.
--
-- ── What it adds ───────────────────────────────────────────────────────────
-- public.list_course_photo_expiry() returns table (course_id uuid,
--   last_opened_at timestamptz, photos integer). Stable, runs as its owner.
--   Only the signed-in teacher's own classes (teacher_id = auth.uid()), not
--   in the trash, with at least one page of sent work, and not opened for
--   300 days or more (last_opened_at is the greater of the stamp and when
--   the class was made, as _photo_keep_class judges it). Nearly always no
--   rows. Signed out: no rows. A visitor (anon) may not run it.
-- public._course_restored_opened() and the trigger course_restored_opened
--   (after update of deleted_at on public.course, only when it goes from a
--   time to null): upserts course_opened to now(), never moving a stamp
--   back (the same upsert as note_course_opened). Runs as its owner, since
--   course_opened has no grants. Nobody may call it directly.
--
-- Unchanged, each checked first: _photo_keep_class (the 365 days, the
-- greater of the stamp and created_at), note_course_opened (the upsert the
-- trigger repeats), photo_lifecycle_nightly, fv_retention_cleanup (a class
-- purged from the trash takes its stamp by the cascade; the trigger never
-- fires on a delete), and course_opened's columns.
-- md5 of pg_get_functiondef on PostgreSQL 17, as this file leaves them:
--   public.list_course_photo_expiry() (new)                 09fea36f5f757a3de2508a25f9460376
--   public._course_restored_opened() (new)                  a345459a8b66ded92f8aad90e01b4f63
--
-- ── The checks it makes first ──────────────────────────────────────────────
-- It stops with nothing changed unless every function above is the live
-- definition (or this file's, on a second run), course_opened is
-- 2026111704's, and no other list_course_photo_expiry, function or trigger
-- by these names is there. Read-only from gradebook-prod:
-- migrations/local-test/photo-expiry-live-precheck.sql.
--
-- ── Order ──────────────────────────────────────────────────────────────────
-- After 2026111704. Either side of the release that carries the warning:
-- that app treats a missing list_course_photo_expiry as no classes to warn
-- about (no line, nothing on the sync dot).
--
-- Tested on a throwaway PostgreSQL 17 rebuilt equal to live:
-- migrations/local-test/photo_expiry.py (README.md, "A warning before the
-- year runs out"). Undo: migrations/local-test/photo-expiry-undo.sql (PART 0,
-- the stop, deletes nothing). After: photo-expiry-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

-- ── 1. The checks, before anything changes ─────────────────────────────────
do $guard$
declare
    _f    record;
    _md5  text;
    _cols text;
    _def  text;
begin
    for _f in select * from (values
        ('public.list_course_photo_expiry()', null, '09fea36f5f757a3de2508a25f9460376'),
        ('public._course_restored_opened()', null, 'a345459a8b66ded92f8aad90e01b4f63'),
        ('public._photo_keep_class(uuid,timestamptz)', '67d1ae88eeacd34543cc0a80f1055991', null),
        ('public.note_course_opened(uuid,uuid)', '0c9431bb6ff130f8de2715f8315838f1', null),
        ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26', null),
        ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39', null)
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname in ('list_course_photo_expiry', '_course_restored_opened')
                 and oid not in (coalesce(to_regprocedure('public.list_course_photo_expiry()'), 0),
                                 coalesce(to_regprocedure('public._course_restored_opened()'), 0))) then
        raise exception 'A list_course_photo_expiry or _course_restored_opened exists with other arguments or in another schema. Nothing was changed.';
    end if;
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
      from pg_attribute where attrelid = to_regclass('public.course_opened') and attnum > 0 and not attisdropped;
    if _cols is distinct from 'course_id uuid, last_opened_at timestamp with time zone' then
        raise exception 'public.course_opened is not 2026111704''s (%). Nothing was changed.', coalesce(_cols, 'missing');
    end if;
    select pg_get_triggerdef(t.oid) into _def from pg_trigger t
     where t.tgrelid = 'public.course'::regclass and t.tgname = 'course_restored_opened';
    if found and replace(_def, 'FUNCTION public._course', 'FUNCTION _course') is distinct from
        'CREATE TRIGGER course_restored_opened AFTER UPDATE OF deleted_at ON public.course FOR EACH ROW WHEN (((old.deleted_at IS NOT NULL) AND (new.deleted_at IS NULL))) EXECUTE FUNCTION _course_restored_opened()' then
        raise exception 'A trigger course_restored_opened exists and is not this file''s (%). Nothing was changed.', _def;
    end if;
end
$guard$;

-- ── 2. The classes whose photos go within the year, for the warning ────────
create or replace function public.list_course_photo_expiry()
 returns table(course_id uuid, last_opened_at timestamp with time zone, photos integer)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    -- The signed-in teacher's own classes only, not in the trash, with pages
    -- of sent work, unopened for 300 days or more (the nightly job takes the
    -- photos at 365: _photo_keep_class, 2026111704). Signed out: no rows.
    select c.id, greatest(o.last_opened_at, c.created_at), count(f.id)::int
      from course c
      left join course_opened o on o.course_id = c.id
      join submission s on s.course_id = c.id and s.state = 'sent'
      join submission_file f on f.submission_id = s.id
     where c.teacher_id = (select auth.uid())
       and c.deleted_at is null
       and greatest(o.last_opened_at, c.created_at) < now() - interval '300 days'
     group by c.id, o.last_opened_at, c.created_at;
$function$;

revoke all on function public.list_course_photo_expiry() from public, anon;
grant execute on function public.list_course_photo_expiry() to authenticated, service_role;

-- ── 3. A class restored from the trash counts as opened ────────────────────
create or replace function public._course_restored_opened()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    -- Restored from the trash (deleted_at from a time to null): opened now,
    -- or a class last opened long before it was deleted loses its photos the
    -- first night after. Never moves a stamp back.
    insert into course_opened (course_id, last_opened_at) values (new.id, now())
    on conflict (course_id) do update set last_opened_at = greatest(course_opened.last_opened_at, excluded.last_opened_at);
    return null;
end;
$function$;

revoke all on function public._course_restored_opened() from public, anon, authenticated, service_role;

create or replace trigger course_restored_opened
    after update of deleted_at on public.course
    for each row
    when (old.deleted_at is not null and new.deleted_at is null)
    execute function public._course_restored_opened();

-- ── 4. Both functions are this file's ──────────────────────────────────────
do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('public.list_course_photo_expiry()', '09fea36f5f757a3de2508a25f9460376'),
        ('public._course_restored_opened()', 'a345459a8b66ded92f8aad90e01b4f63')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
end
$after$;

commit;
