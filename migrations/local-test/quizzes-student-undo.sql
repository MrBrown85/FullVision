-- Undo for migrations/2026111806_quizzes_student.sql (2026-11-18).
--
-- == PART 1, the fast stop that deletes nothing ==
-- Drops the three functions the student-submit edge function calls (quiz,
-- quiz_save, quiz_send). A revoke would stop nothing: the edge function signs
-- in to the database as its owner (docs/ROADMAP.md), and the owner may run
-- every function it owns. With the three gone, the routes quiz, quiz-save and
-- quiz-send answer a plain server error (check the released student page
-- before relying on what it shows then). Every try and answer stays in its
-- table (2026111804's); the three private helpers and write_log's check are
-- left as they are; the teacher's quiz functions are not touched. To turn it
-- back on, run the migration file again: it makes the three again, exactly
-- as tested. Run PART 1 alone (from "PART 1 begins" to "PART 1 ends"). It
-- stops, dropping nothing, if one of the three is not this file's definition
-- (a later change would be lost).
--
-- == PART 2, the full removal: the rest of this file ==
-- Drops the three private helpers too, and puts the check on
-- student_submit.write_log.kind back exactly as it was before the file
-- (validated, with Bulletins' 'bulletin'). To do that it first takes
-- write_log to itself, then deletes its rows of kind 'quiz': rate-limit
-- counters (a card, the word, a time), each kept a day at most, holding no
-- student's words. No try, answer or any other row is touched (the quiz
-- tables are 2026111804's undo's). Stops, with everything kept, if a function
-- is not this file's definition or the check is neither this file's nor the
-- one before it.
--
-- Run whole, the file is PART 1 and then PART 2, each its own transaction:
-- a PART 2 that stops (its guard, or the lock below) leaves PART 1 done, so
-- students are without the three routes until the migration file is run
-- again.
--
-- Lock: PART 2 takes student_submit.write_log to itself before it deletes,
-- so a student's write that counts against a limit waits behind it (never a
-- deadlock). After five seconds of waiting for the table it gives up with
-- PART 2 not applied. Run it at a quiet time.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing. Undo this file before Bulletins' M2 undo
-- (2026111803), which expects the check without 'quiz'. Run it with public
-- on the search path, as Supabase's SQL editor does (each part sets its own).
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   student_submit._quiz_window(uuid,uuid)                        2eb5a1c0652415e1cd3923b79c22b101
--   student_submit._quiz_new_order(uuid)                          60094583822902bdafa8b0623942e9ef
--   student_submit._quiz_questions(uuid,jsonb)                    774274b707ad660b1d3f2d023edf13be
--   student_submit.quiz(text,uuid,uuid,text,boolean)              0746b4af4f1cadd75b86cc20f49931d3
--   student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)      106de8942ce40ccc9d51c35d2e4e328a
--   student_submit.quiz_send(text,uuid,uuid,text)                 ebd17424915013d30d69e83c50f1f7de

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
        ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
        ('student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)', '106de8942ce40ccc9d51c35d2e4e328a'),
        ('student_submit.quiz_send(text,uuid,uuid,text)', 'ebd17424915013d30d69e83c50f1f7de')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111806 left (md5 %). Nothing was dropped.', _f.fn, _md5;
        end if;
    end loop;
end
$stop$;

drop function if exists student_submit.quiz(text, uuid, uuid, text, boolean);
drop function if exists student_submit.quiz_save(text, uuid, uuid, uuid, jsonb, text);
drop function if exists student_submit.quiz_send(text, uuid, uuid, text);

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
        ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
        ('student_submit._quiz_new_order(uuid)', '60094583822902bdafa8b0623942e9ef'),
        ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be'),
        ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
        ('student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)', '106de8942ce40ccc9d51c35d2e4e328a'),
        ('student_submit.quiz_send(text,uuid,uuid,text)', 'ebd17424915013d30d69e83c50f1f7de')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111806 left (md5 %). Everything is kept; if PART 1 ran before this, students are without the three routes until the migration file is run again.', _f.fn, _md5;
        end if;
    end loop;
    select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname collate "C", c.oid) into _def
      from pg_constraint c where c.conrelid = 'student_submit.write_log'::regclass and c.contype = 'c';
    if _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text])))'
       and _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))' then
        raise exception 'student_submit.write_log''s check is neither 2026111806''s nor the one before it (%). Everything is kept.', coalesce(_def, 'none');
    end if;
end
$guard$;

drop function if exists student_submit.quiz(text, uuid, uuid, text, boolean);
drop function if exists student_submit.quiz_save(text, uuid, uuid, uuid, jsonb, text);
drop function if exists student_submit.quiz_send(text, uuid, uuid, text);
drop function if exists student_submit._quiz_questions(uuid, jsonb);
drop function if exists student_submit._quiz_new_order(uuid);
drop function if exists student_submit._quiz_window(uuid, uuid);

do $kind$
begin
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text])))' then
        -- The table first, then the rows: a student's write that arrives now waits for the table. Deleting
        -- first and locking after would let that write hold the table while waiting for a deleted row,
        -- and the two would deadlock.
        lock table student_submit.write_log in access exclusive mode;
        -- Rate-limit counters of the removed routes: they could not pass the check put back.
        delete from student_submit.write_log where kind = 'quiz';
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check
                check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text]));
    end if;
end
$kind$;

commit;
