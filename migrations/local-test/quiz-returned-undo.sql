-- Undo for migrations/2026112407_quiz_returned.sql (2026-11-24).
--
-- == PART 1, the fast stop that deletes nothing ==
-- Drops student_submit.quiz_result, the one function the file adds. A
-- revoke would stop nothing: the edge function signs in to the database as
-- its owner (docs/ROADMAP.md), and the owner may run every function it owns.
-- With it gone, the route quiz-result answers a plain server error and no
-- student is sent anything of the key; quiz-list, quiz, quiz-save and
-- quiz-send are not touched, and no row is (the function wrote none). To
-- turn it back on, run the migration file again. Run PART 1 alone (from
-- "PART 1 begins" to "PART 1 ends"), in its own transaction. It stops,
-- dropping nothing, if quiz_result is not this file's definition (a later
-- change would be lost).
--
-- == PART 2: the rest of this file ==
-- The file adds nothing else, so PART 2 only checks that nothing of it is
-- left (a second PART 1 in its own transaction, and a check). Run whole, the
-- file is PART 1 and then PART 2, each its own transaction.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing. Run it with public on the search path, as
-- Supabase's SQL editor does (each part sets its own).
--
-- md5 of pg_get_functiondef (as the file leaves it):
--   student_submit.quiz_result(text,uuid,uuid,text)               30ae0744d9bc53043e6df40dbee5274c

-- PART 1 begins
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $stop$
declare
    _md5 text := md5(pg_get_functiondef(to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')));
begin
    if _md5 is not null and _md5 <> '30ae0744d9bc53043e6df40dbee5274c' then
        raise exception 'student_submit.quiz_result(text,uuid,uuid,text) is not the definition 2026112407 left (md5 %). Nothing was dropped.', _md5;
    end if;
end
$stop$;

drop function if exists student_submit.quiz_result(text, uuid, uuid, text);

commit;
-- PART 1 ends

begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _md5 text := md5(pg_get_functiondef(to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')));
begin
    if _md5 is not null and _md5 <> '30ae0744d9bc53043e6df40dbee5274c' then
        raise exception 'student_submit.quiz_result(text,uuid,uuid,text) is not the definition 2026112407 left (md5 %). Everything is kept.', _md5;
    end if;
end
$guard$;

drop function if exists student_submit.quiz_result(text, uuid, uuid, text);

do $after$
begin
    if to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)') is not null then
        raise exception 'student_submit.quiz_result is still there.';
    end if;
end
$after$;

commit;
