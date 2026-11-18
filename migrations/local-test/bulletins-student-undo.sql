-- Undo for migrations/2026111803_bulletins_student.sql (2026-11-17).
--
-- ── PART 1, the fast stop that deletes nothing ──────────────────────────────
-- Takes the four student functions away from the edge function (revokes
-- execute from service_role). The routes bulletins, bulletin-seen,
-- bulletin-react and bulletin-files then answer a plain server error, and the
-- student page must then show no Bulletins tab (plan rule 7; check the
-- released student page before relying on this). Every seen mark and
-- reaction stays in its table; the teacher's Bulletins page is not touched.
-- To turn it back on, run the migration file again (its grants are restated)
-- or grant execute on the four to service_role. Run PART 1 alone (from
-- "PART 1 begins" to "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
-- Drops the five functions the file added, and puts the check on
-- student_submit.write_log.kind back exactly as it was before the file
-- (validated). To do that it first deletes write_log's rows of kind
-- 'bulletin': rate-limit counters (a card, the word, a time), each kept a day
-- at most, holding no student's words. No seen mark, reaction, bulletin or
-- any other row is touched (M1's tables are M1's undo's). Stops, with
-- everything kept, if a function is not this file's definition or the check
-- is neither this file's nor the one before it.
--
-- Run whole, the file is PART 1 and then PART 2. PART 1 is not inside PART
-- 2's transaction: sent statement by statement, a PART 2 that stops (its
-- guard, or the lock below) leaves PART 1 done, so students are without the
-- four routes until the migration file is run again or execute is granted
-- back to service_role.
--
-- Lock: swapping the check takes student_submit.write_log to itself for a
-- moment; students' writes that count against a limit wait behind it. After
-- five seconds it gives up with PART 2 not applied. Run it at a quiet time.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   student_submit._bulletin_visible(uuid,uuid)                   cab9dc514218ac1839b112895e2baa11
--   student_submit.bulletins(text,uuid,text)                      08b1f6637c7ada669563388865f31cb7
--   student_submit.bulletin_seen(text,uuid,uuid[],text)           96185b2e8173c90ccd40f2a054ad5cc7
--   student_submit.bulletin_react(text,uuid,uuid,text,text)       e86e2c4c9454186390ad1fe9a845d8c1
--   student_submit.bulletin_file_links(text,uuid,uuid,text)       5e93daec794c4f5f5b936c385e4905ca

-- PART 1 begins
do $stop$
declare
    _sig text;
begin
    foreach _sig in array array['student_submit.bulletins(text,uuid,text)', 'student_submit.bulletin_seen(text,uuid,uuid[],text)',
                                'student_submit.bulletin_react(text,uuid,uuid,text,text)', 'student_submit.bulletin_file_links(text,uuid,uuid,text)'] loop
        if to_regprocedure(_sig) is not null then
            execute 'revoke execute on function ' || _sig || ' from service_role';
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
    _def text;
begin
    for _f in select * from (values
        ('student_submit._bulletin_visible(uuid,uuid)', 'cab9dc514218ac1839b112895e2baa11'),
        ('student_submit.bulletins(text,uuid,text)', '08b1f6637c7ada669563388865f31cb7'),
        ('student_submit.bulletin_seen(text,uuid,uuid[],text)', '96185b2e8173c90ccd40f2a054ad5cc7'),
        ('student_submit.bulletin_react(text,uuid,uuid,text,text)', 'e86e2c4c9454186390ad1fe9a845d8c1'),
        ('student_submit.bulletin_file_links(text,uuid,uuid,text)', '5e93daec794c4f5f5b936c385e4905ca')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111803 left (md5 %). Everything is kept; if PART 1 ran before this, students are without the four routes until the migration file is run again.', _f.fn, _md5;
        end if;
    end loop;
    select string_agg(pg_get_constraintdef(c.oid), ' | ') into _def
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
drop function if exists student_submit._bulletin_visible(uuid, uuid);

do $kind$
begin
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))' then
        -- Rate-limit counters of the removed routes: they could not pass the check put back.
        delete from student_submit.write_log where kind = 'bulletin';
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text]));
    end if;
end
$kind$;

commit;
