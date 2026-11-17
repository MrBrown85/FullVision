-- Undo for migrations/2026111710_scan_labels.sql (2026-11-17).
--
-- ── PART 1, the stop that deletes nothing ────────────────────────────────────
-- Takes the three functions away from teachers (revokes execute from
-- authenticated). Every code stays in the table. The app then says sticker
-- sheets are not available, and a scan's stickers are not read: every piece
-- goes to the name box, as it does without stickers. That is what the app
-- must do when a call is refused, and it must make these calls only when a
-- teacher opens Sticker Sheets or splits a scan, never from the outbox, so
-- that nothing shows on the sync dot (check the app that is released before
-- relying on this). To turn it back on, run the migration file again (its
-- grants are restated) or grant execute on the three functions to
-- authenticated. Run PART 1 alone (from "PART 1 begins" to "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file (DELETES THE CODES) ──────
-- Drops the three functions, the code-drawing function and the scan_label
-- table. Every sticker sheet already printed stops being read for good: if
-- the file is applied again, students get new codes and need new sheets. No
-- student work, grade, score or comment is touched; a code is not student
-- work. Stops, with the table, the codes and the functions kept, if a
-- function is not this file's definition (a later change would be lost).
--
-- Run whole, the file is PART 1 and then PART 2. PART 1 is not inside PART
-- 2's transaction: sent statement by statement, a PART 2 that stops (its
-- guard, or the lock below) leaves PART 1 done, so teachers are without the
-- three functions until the migration file is run again or execute is
-- granted back to authenticated.
--
-- Lock: dropping the table drops its key's triggers on public.enrollment,
-- which needs that table to itself for a moment. While PART 2 waits, reads
-- and writes of enrollment queue behind it; after five seconds it gives up
-- with PART 2 not applied. Run it at a quiet time.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   public.list_scan_labels(uuid)          6e03772c7b669ba5bedceb1cd0bfcf02
--   public.issue_scan_labels(uuid,uuid)    d2d083b6c33a2cf8991ca65234606169
--   public.reissue_scan_label(uuid,uuid)   ff61b3bb56f7aae8b341937caacb4f55
--   fv_private.scan_label_new(uuid)        09f8ff09c3fbd118697d0eeddbe93ba2

-- PART 1 begins
do $stop$
declare
    _sig text;
begin
    foreach _sig in array array['public.list_scan_labels(uuid)', 'public.issue_scan_labels(uuid,uuid)', 'public.reissue_scan_label(uuid,uuid)'] loop
        if to_regprocedure(_sig) is not null then
            execute 'revoke execute on function ' || _sig || ' from authenticated';
        end if;
    end loop;
end
$stop$;
-- PART 1 ends

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in select * from (values
        ('public.list_scan_labels(uuid)', '6e03772c7b669ba5bedceb1cd0bfcf02'),
        ('public.issue_scan_labels(uuid,uuid)', 'd2d083b6c33a2cf8991ca65234606169'),
        ('public.reissue_scan_label(uuid,uuid)', 'ff61b3bb56f7aae8b341937caacb4f55'),
        ('fv_private.scan_label_new(uuid)', '09f8ff09c3fbd118697d0eeddbe93ba2')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111710 left (md5 %). The table, the codes and the functions are kept; if PART 1 ran before this, teachers are without the three functions until the migration file is run again.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

drop function if exists public.list_scan_labels(uuid);
drop function if exists public.issue_scan_labels(uuid, uuid);
drop function if exists public.reissue_scan_label(uuid, uuid);
drop function if exists fv_private.scan_label_new(uuid);
drop table if exists public.scan_label;

commit;
