-- Undo for migrations/2026111803_bulletins_student.sql (2026-11-17).
--
-- == PART 1, the fast stop that deletes nothing ==
-- Drops the four functions the student-submit edge function calls
-- (bulletins, bulletin_seen, bulletin_react, bulletin_file_links). A revoke
-- would stop nothing: the edge function signs in to the database as its
-- owner (docs/ROADMAP.md), and the owner may run every function it owns. With
-- the four gone, the routes bulletins, bulletin-seen, bulletin-react and
-- bulletin-files answer a plain server error, and the student page must then
-- show no Bulletins tab (plan rule 7; check the released student page before
-- relying on this). Every seen mark and reaction stays in its table; the two
-- private helpers and write_log's check are left as they are; the teacher's
-- Bulletins page is not touched. To turn it back on, run the migration file
-- again: it makes the four again, exactly as tested. Run PART 1 alone (from
-- "PART 1 begins" to "PART 1 ends"). It stops, dropping nothing, if one of
-- the four is not this file's definition (a later change would be lost).
--
-- == PART 2, the full removal: the rest of this file ==
-- Drops the two private helpers too, and puts the check on
-- student_submit.write_log.kind back exactly as it was before the file
-- (validated). To do that it first takes write_log to itself, then deletes
-- its rows of kind 'bulletin': rate-limit counters (a card, the word, a
-- time), each kept a day at most, holding no student's words. No seen mark,
-- reaction, bulletin or any other row is touched (M1's tables are M1's
-- undo's). Stops, with everything kept, if a function is not this file's
-- definition or the check is neither this file's nor the one before it.
--
-- Run whole, the file is PART 1 and then PART 2, each its own transaction:
-- a PART 2 that stops (its guard, or the lock below) leaves PART 1 done, so
-- students are without the four routes until the migration file is run
-- again.
--
-- Lock: PART 2 takes student_submit.write_log to itself before it deletes,
-- so a student's write that counts against a limit waits behind it (never a
-- deadlock). After five seconds of waiting for the table it gives up with
-- PART 2 not applied. Run it at a quiet time.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing. Run it with public on the search path, as
-- Supabase's SQL editor does (each part sets its own, too).
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   student_submit._bulletin_visible(uuid,uuid)                   cab9dc514218ac1839b112895e2baa11
--   student_submit._bulletin_session_enrollments(uuid)            dae16e59257af2443d0aeab273a71243
--   student_submit.bulletins(text,uuid,text)                      634789519b2b2fdf18550c92691618e7
--   student_submit.bulletin_seen(text,uuid,uuid[],text)           96185b2e8173c90ccd40f2a054ad5cc7
--   student_submit.bulletin_react(text,uuid,uuid,text,text)       e86e2c4c9454186390ad1fe9a845d8c1
--   student_submit.bulletin_file_links(text,uuid,uuid,text)       5e93daec794c4f5f5b936c385e4905ca

-- PART 1 begins
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $stop$
declare
    _f   record;
    _md5 text;
begin
    for _f in select * from (values
        ('student_submit.bulletins(text,uuid,text)', '634789519b2b2fdf18550c92691618e7'),
        ('student_submit.bulletin_seen(text,uuid,uuid[],text)', '96185b2e8173c90ccd40f2a054ad5cc7'),
        ('student_submit.bulletin_react(text,uuid,uuid,text,text)', 'e86e2c4c9454186390ad1fe9a845d8c1'),
        ('student_submit.bulletin_file_links(text,uuid,uuid,text)', '5e93daec794c4f5f5b936c385e4905ca')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111803 left (md5 %). Nothing was dropped.', _f.fn, _md5;
        end if;
    end loop;
end
$stop$;

drop function if exists student_submit.bulletins(text, uuid, text);
drop function if exists student_submit.bulletin_seen(text, uuid, uuid[], text);
drop function if exists student_submit.bulletin_react(text, uuid, uuid, text, text);
drop function if exists student_submit.bulletin_file_links(text, uuid, uuid, text);

commit;
-- PART 1 ends

begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f   record;
    _md5 text;
    _def text;
begin
    for _f in select * from (values
        ('student_submit._bulletin_visible(uuid,uuid)', 'cab9dc514218ac1839b112895e2baa11'),
        ('student_submit._bulletin_session_enrollments(uuid)', 'dae16e59257af2443d0aeab273a71243'),
        ('student_submit.bulletins(text,uuid,text)', '634789519b2b2fdf18550c92691618e7'),
        ('student_submit.bulletin_seen(text,uuid,uuid[],text)', '96185b2e8173c90ccd40f2a054ad5cc7'),
        ('student_submit.bulletin_react(text,uuid,uuid,text,text)', 'e86e2c4c9454186390ad1fe9a845d8c1'),
        ('student_submit.bulletin_file_links(text,uuid,uuid,text)', '5e93daec794c4f5f5b936c385e4905ca')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111803 left (md5 %). Everything is kept; if PART 1 ran before this, students are without the four routes until the migration file is run again.', _f.fn, _md5;
        end if;
    end loop;
    select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname collate "C", c.oid) into _def
      from pg_constraint c where c.conrelid = 'student_submit.write_log'::regclass and c.contype = 'c';
    if _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))'
       and _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text])))' then
        raise exception 'student_submit.write_log''s check is neither 2026111803''s nor the one before it (%). Everything is kept.', coalesce(_def, 'none');
    end if;
end
$guard$;

drop function if exists student_submit.bulletins(text, uuid, text);
drop function if exists student_submit.bulletin_seen(text, uuid, uuid[], text);
drop function if exists student_submit.bulletin_react(text, uuid, uuid, text, text);
drop function if exists student_submit.bulletin_file_links(text, uuid, uuid, text);
drop function if exists student_submit._bulletin_session_enrollments(uuid);
drop function if exists student_submit._bulletin_visible(uuid, uuid);

do $kind$
begin
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))' then
        -- The table first, then the rows: a student's write that arrives now waits for the table. Deleting
        -- first and locking after would let that write hold the table while waiting for a deleted row,
        -- and the two would deadlock.
        lock table student_submit.write_log in access exclusive mode;
        -- Rate-limit counters of the removed routes: they could not pass the check put back.
        delete from student_submit.write_log where kind = 'bulletin';
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text]));
    end if;
end
$kind$;

commit;
