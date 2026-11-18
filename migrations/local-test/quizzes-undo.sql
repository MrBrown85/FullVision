-- Undo for migrations/2026111804_quizzes.sql (2026-11-17).
--
-- ── PART 1, the stop that deletes nothing ────────────────────────────────────
-- Takes list_quiz, save_quiz and list_quiz_tries away from teachers (revokes
-- execute from authenticated), and the three results functions of
-- 2026111805 too when they are there. Every quiz, question, key, try and
-- answer stays. The two triggers stay: Unassign is still refused on a piece a
-- student has started, and a competency taken off a piece still leaves its
-- questions. The student's functions (MQ2) are not this file's: stop them
-- with their own undo. To turn it back on, run the migration files again
-- (their grants are restated). Run PART 1 alone (from "PART 1 begins" to
-- "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
-- Drops the two triggers on existing tables, the functions and the five
-- tables. It REFUSES while any quiz exists, so it deletes no teacher's
-- question and no student's answer: if a removal is truly wanted after use,
-- `delete from public.quiz;` deletes every quiz and every student's tries
-- and answers, and is a decision for Colin. It also stops, with everything
-- kept, while 2026111805's functions are there (run quiz-results-undo.sql
-- first) or if a function is not this file's definition.
--
-- Run whole, the file is PART 1 and then PART 2. PART 1 is not inside PART
-- 2's transaction: a PART 2 that stops leaves PART 1 done, so teachers are
-- without the functions until the migration files are run again.
--
-- Lock: dropping the tables drops their keys' triggers on public.assessment
-- and public.enrollment, and the trigger on public.assessment_tag, which
-- needs each table to itself for a moment. After five seconds it gives up
-- with PART 2 not applied. Run it at a quiet time.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   public.list_quiz(uuid)                 4b5a877bdade0126970b90acbfa613d7
--   public.save_quiz(uuid,jsonb,uuid)      514d96e7fe70d09121d1068e7e7f70d1
--   public.list_quiz_tries(uuid)           e929cbfe0aa1130741bd2b3af1615a2d
--   fv_private.quiz_json(uuid)             c1d41659890c23cb02d0f517cd5c037d
--   public._quiz_draft_guard()             9e6ed6b0336305322b22c309161472f9
--   public._quiz_tag_gone()                3cd4fba9441edaec432cc3322c654826
--   public._quiz_attempt_same_class()      5b0045acab2f7eb94cf3d8ff75210e1f

-- PART 1 begins
do $stop$
declare
    _sig text;
begin
    foreach _sig in array array['public.list_quiz(uuid)', 'public.save_quiz(uuid,jsonb,uuid)', 'public.list_quiz_tries(uuid)',
                                'public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', 'public.reopen_quiz(uuid,uuid,uuid)',
                                'public.confirm_quiz(uuid,jsonb,uuid)'] loop
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
    _n   bigint;
begin
    for _f in select * from (values
        ('public.list_quiz(uuid)', '4b5a877bdade0126970b90acbfa613d7'),
        ('public.save_quiz(uuid,jsonb,uuid)', '514d96e7fe70d09121d1068e7e7f70d1'),
        ('public.list_quiz_tries(uuid)', 'e929cbfe0aa1130741bd2b3af1615a2d'),
        ('fv_private.quiz_json(uuid)', 'c1d41659890c23cb02d0f517cd5c037d'),
        ('public._quiz_draft_guard()', '9e6ed6b0336305322b22c309161472f9'),
        ('public._quiz_tag_gone()', '3cd4fba9441edaec432cc3322c654826'),
        ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111804 left (md5 %). Everything is kept; if PART 1 ran before this, teachers are without the quiz functions until the migration files are run again.', _f.fn, _md5;
        end if;
    end loop;
    if to_regprocedure('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)') is not null
       or to_regprocedure('public.reopen_quiz(uuid,uuid,uuid)') is not null
       or to_regprocedure('public.confirm_quiz(uuid,jsonb,uuid)') is not null then
        raise exception '2026111805''s functions are there: run quiz-results-undo.sql first. Everything is kept.';
    end if;
    if to_regclass('public.quiz') is not null then
        execute 'select count(*) from public.quiz' into _n;
        if _n > 0 then
            raise exception 'There are % quizzes: the full removal would delete them and every student''s answers. Everything is kept.', _n;
        end if;
    end if;
end
$guard$;

drop trigger if exists assessment_quiz_draft_guard on public.assessment;
drop trigger if exists quiz_tag_gone on public.assessment_tag;
drop function if exists public.list_quiz(uuid);
drop function if exists public.save_quiz(uuid, jsonb, uuid);
drop function if exists public.list_quiz_tries(uuid);
drop function if exists fv_private.quiz_json(uuid);
drop table if exists public.quiz_answer;
drop table if exists public.quiz_attempt;
drop table if exists public.quiz_key;
drop table if exists public.quiz_question;
drop table if exists public.quiz;
drop function if exists public._quiz_draft_guard();
drop function if exists public._quiz_tag_gone();
drop function if exists public._quiz_attempt_same_class();

commit;
