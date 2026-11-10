-- BATCH A, UNDONE. Not a migration: the way back from Batch A
-- (migrations/2026110901 to 2026110904, PR 966), which was applied to
-- gradebook-prod on 2026-11-10. Written for the database as it is now:
-- Batch A, and S0-M5 (2026111002) applied after it.
--
-- It lives under migrations/local-test/ on purpose: CI's drift check treats
-- every file in migrations/ as something to be applied, and this is only to
-- be run if Batch A has to come out.
--
-- Run it in the SQL editor (or psql), one part at a time, by pasting that
-- part from its banner to the next. Not through apply_migration: the parts
-- open and close their own transactions.
--
-- ── BEFORE ANY PART ─────────────────────────────────────────────────────────
-- Nothing here turns off what calls Batch A. Before PART 2, these must
-- already be off, or every call they make fails once its function is gone:
--   the student page's edge function (it calls student_submit.card,
--     verify_card, page, seen and done);
--   any build of the app that calls return_grades, list_course_grade_returns,
--     course_draft_count or the card functions (list_student_cards,
--     issue_student_cards, mark_student_cards_printed, unlock_student_card,
--     unlock_all_student_cards, reissue_student_card, set_cards_work_until).
--     (update_course goes back to ignoring student_page_enabled and
--     return_grades: a build that sends them gets no error and no effect.)
-- PART 1 and PART 1B remove nothing those call, so they need nothing off.
--
-- ── PART 1: the fast stop ───────────────────────────────────────────────────
-- Drops Batch A's 18 triggers and nothing else: the 12 statement triggers
-- and 3 re-pointing triggers on score, tag_score, rubric_score and
-- rubric_check_score, the 2 on enrollment and assessment deletes, and the 1
-- on course settings.
--
-- With teachers working. It takes one table at a time, each in its own
-- transaction: it waits at most 200 ms for the table, and if it cannot have
-- it, lets go and tries again, so it never holds two tables and never
-- outwaits Postgres's deadlock check (one second). Measured with four
-- connections saving in a loop (batch_a_undo_load.py), twice on PostgreSQL
-- 17.11 and twice on 18.6, the same every time:
--   a class at work (about 30 saves a second)   160 of 160 runs finished,
--       no save failed, the slowest save waited 0.4 s;
--   flat out (500 to 800 saves a second)         80 of 80 runs finished,
--       no save failed, the slowest save waited 0.3 s.
-- (As first written, in one transaction, the same test killed 4 saves in
-- one of its four runs at the first speed, and at the second finished 20 to
-- 33 of 80 runs and killed 220 to 330 saves.) A save can wait a few tenths
-- of a second behind it; none is refused. If one table cannot be had in 40 tries it stops there
-- and says which; run PART 1 again and it carries on from that table.
--
-- DESTROYS: nothing.
--
-- What stops: an ordinary save, clear, comment, status or delete no longer
-- touches grade_return (which grades are Draft and which Returned).
--
-- What does NOT stop. Batch A's own functions all stay, and these still run:
--   file 01's five row-security policies, on every save, until PART 1B;
--   Return Grades: it still returns a waiting draft;
--   a rubric move (move_rubric_scores) still re-points, in grade_return,
--     the copy a student was given;
--   a restore (import_json_restore) still writes grade_return rows for the
--     class it restores;
--   the card functions and the student page's own functions: cards are
--     still issued, students still sign in, read and are marked as having
--     seen a piece;
--   update_course still stores the two class settings, but nothing reacts:
--     a class leaving When I Return Them no longer returns what was waiting;
--   a deleted piece or student leaves its grade_return rows behind;
--   with S0-M4b (2026110905, PR 989) applied: its three triggers
--     (grade_return_mode on assessment, grade_return_truncate on assessment
--     and on enrollment) and its nightly job. PART 1's last query lists them.
--
-- What students see after PART 1, in a class with the Student Page on.
-- grade_return no longer follows the grades, and the page reads it:
--   a grade that was Returned, and the teacher then changes: the student
--     is shown the change AT ONCE. It does not wait to be returned. (In an
--     As Soon As I Save class that is what happens anyway.)
--   a first grade on a piece that had none: NOT shown at all, in either
--     kind of class, however long it waits, unless the teacher uses Return
--     Grades on it or file 02 is run again.
--   a draft that was waiting: stays hidden, whatever is saved on it. If the
--     piece had been returned before, the student keeps seeing that
--     returned grade.
-- So while PART 1 stands, a class with the page on shows students some
-- grades early and hides others. If any class has it on and Batch A is not
-- going straight back, turn the page off for those classes AFTER PART 1
-- (before PART 1 that same change would return every waiting draft):
--     select id, name from public.course where student_page_enabled;   -- keep this list
--     update public.course set student_page_enabled = false where student_page_enabled;
-- Then the page and every card scan answer "closed", and nothing is shown
-- early or hidden; turned on again, students see what they saw (tested).
-- While no class has the page on, none of this matters: nothing reads
-- grade_return.
--
-- To turn Batch A back on after PART 1 alone: run 2026110902_grade_return.sql
-- again. It recreates the triggers; its backfill makes a Returned row for
-- every grade first saved in between (so students then see those); a
-- Returned grade changed in between stays Returned with its new value; the
-- drafts are still drafts; rows left by pieces deleted in between are
-- cleared; and every working copy is brought up to date (tested).
--
-- ── PART 1B: the five score-table policies as before file 01 ────────────────
-- The caller owns the enrollment, and nothing more. PART 1 does not touch
-- them: file 01 is independent of the rest, and a save it refuses says
-- "violates row-level security policy" (42501). Run this only if that is the
-- trouble. One transaction, a short lock on each of the five tables.
-- DESTROYS: nothing. A teacher can again save a score against another
-- class's assessment by sending its id, as before Batch A.
--
-- ── PART 2: the full removal ────────────────────────────────────────────────
-- Everything the four files created or changed goes, in an order that
-- works, and the seven functions they patched are put back to their bodies
-- of before by making each edit backwards; then each is checked against its
-- fingerprint on the live database before Batch A (md5 of
-- pg_get_functiondef), and the transaction fails, with nothing changed, if
-- any is not exactly that. It includes PART 1 and PART 1B, so it can be run
-- without them, and it can be run after only some of the four files were
-- applied (tested: 01 alone, 01 and 02, 01 to 03).
--
-- One transaction, on purpose: all or nothing. It holds locks on the score
-- tables until it commits, so it is for a quiet moment, not a busy one.
-- Measured the same way, four times: with a class at work 10 of 10 runs
-- finished each time and no save failed (saves waited up to 0.4 s); flat
-- out, 9 or 10 of 10 finished (one was stopped by a deadlock, with nothing
-- changed) and between 1 and 5 saves were killed. If it stops, run it again.
--
-- With S0-M4b (2026110905, PR 989) applied, PART 2 stops before it changes
-- anything and says so: run S0-M4b's undo first
-- (migrations/local-test/s0-m4b-undo.sql, on PR 989), then this. Tested in
-- that order: the database comes back as before Batch A. It stops the same
-- way for anything else built on Batch A that it does not know: a trigger
-- or table named grade_return_..., or a function that names grade_return
-- and is not one of the 54 Batch A made or patched. It lists what it found.
--
-- S0-M5 (2026111002, pg_temp last in search_path; applied to gradebook-prod
-- after Batch A, on 2026-11-10): LEAVE IT. No part of this script touches
-- any of its sixteen functions, and none of them is one Batch A made or
-- patched. PART 2 runs with S0-M5 applied and leaves all sixteen exactly as
-- they are (tested on 17.11 and 18.6), and Batch A's four files apply again
-- with it in place. If S0-M5 is to come out as well, its own undo
-- (migrations/local-test/s0-m5-undo.sql) can be run before PART 2 or after
-- it: both orders were tested and end in the same database. (What cannot be
-- done while Batch A is out is to apply S0-M5's file afresh: it checks that
-- Batch A is in.)
--
-- DESTROYS, for good:
--   grade_return            which grades are Draft and which Returned, when
--                           each was returned, what each student was shown
--                           before a change, and when they last opened a
--                           piece
--   student_card            every card: its code, its password, when it was
--                           printed and last used, its wrong tries and lock
--   device sessions         every signed-in phone
--   the sign-in log         the rows for card scans (route 'card'); slip
--                           rows stay
--   three class settings    student_page_enabled, return_grades and
--                           cards_work_until, on every class
-- While no class has the student page on, none of that has been used and
-- nothing is lost that anyone has seen. After a class HAS used it: every
-- printed card stops working and must be printed again if Batch A returns
-- (new codes); every student in it is signed out; the line between Draft
-- and Returned is gone, so on re-applying Batch A every grade there is,
-- drafts included, comes back as Returned (its backfill), and the "Updated"
-- marks and "since you last looked" are lost.
--
-- NOT touched, in any part: score, tag_score, rubric_score,
-- rubric_check_score, dibels_score. No grade, level, comment, tick, status
-- or Note for the Report changes.
--
-- What PART 2 leaves, and does not do:
--   Three empty slots on the course table, where the three class settings
--     were. A dropped column keeps its numbered slot for good; it holds
--     nothing, nothing reads it, and a new column goes after it. It is the
--     one difference from the database before Batch A that the proof finds.
--   The migration record. supabase_migrations.schema_migrations still lists
--     the four files as applied. So CI's "never applied" check goes on
--     passing though they are no longer in the database, and CI's schema
--     snapshot check fails until docs/schema.generated.sql is regenerated
--     from the database as it then is. To make the record true as well, run
--     this, separately, after PART 2 (it is not part of any part; look
--     first with a select of the same rows). After it, CI's "never applied"
--     check fails for the four files until they are applied again or leave
--     migrations/, which is then the truth.
-- record:
--   delete from supabase_migrations.schema_migrations
--    where name in ('score_rows_same_class', 'grade_return', 'student_card', 'student_sessions_page');
-- end record
--   pg_cron. Batch A schedules nothing. (S0-M4b does; its undo unschedules.)
--
-- After PART 2 the four files apply again cleanly. batch_a_undo.py proves
-- all of the above on PostgreSQL 17.11 and 18.6, on databases with Batch A
-- and then S0-M5 applied: the whole catalog compared line by line
-- (catalog.py says what that covers), and every table's rows, with the
-- state before Batch A.
--
-- The statements of PART 1B and PART 2 were GENERATED from the four files
-- and from the difference between a database without them and with them
-- (scratch tool; the proof is batch_a_undo.py).

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: the fast stop
-- ════════════════════════════════════════════════════════════════════════════
-- Seven transactions, one table each, so no two tables are ever locked
-- together and each lock is held for the few milliseconds its drops take.
-- Each waits at most 200 ms for its table, lets go, and tries again (up to
-- 40 times, about twelve seconds at the very worst): 200 ms is well under
-- the second Postgres waits before it looks for a deadlock, so it is this
-- script that steps back, never a teacher's save that is killed. A table
-- that cannot be had after 40 tries stops the run there; the tables before
-- it are done and stay done. Run PART 1 again from the top: a table whose
-- triggers are gone is skipped without a lock.

-- public.score
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.score'::regclass and not tgisinternal
                      and tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_update')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_delete on public.score;
            drop trigger if exists grade_return_insert on public.score;
            drop trigger if exists grade_return_update on public.score;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.score in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- public.tag_score
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.tag_score'::regclass and not tgisinternal
                      and tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_repoint', 'grade_return_update')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_delete on public.tag_score;
            drop trigger if exists grade_return_insert on public.tag_score;
            drop trigger if exists grade_return_repoint on public.tag_score;
            drop trigger if exists grade_return_update on public.tag_score;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.tag_score in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- public.rubric_score
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.rubric_score'::regclass and not tgisinternal
                      and tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_repoint', 'grade_return_update')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_delete on public.rubric_score;
            drop trigger if exists grade_return_insert on public.rubric_score;
            drop trigger if exists grade_return_repoint on public.rubric_score;
            drop trigger if exists grade_return_update on public.rubric_score;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.rubric_score in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- public.rubric_check_score
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.rubric_check_score'::regclass and not tgisinternal
                      and tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_repoint', 'grade_return_update')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_delete on public.rubric_check_score;
            drop trigger if exists grade_return_insert on public.rubric_check_score;
            drop trigger if exists grade_return_repoint on public.rubric_check_score;
            drop trigger if exists grade_return_update on public.rubric_check_score;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.rubric_check_score in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- public.enrollment
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.enrollment'::regclass and not tgisinternal
                      and tgname in ('grade_return_gone')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_gone on public.enrollment;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.enrollment in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- public.assessment
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and not tgisinternal
                      and tgname in ('grade_return_gone')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_gone on public.assessment;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.assessment in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- public.course
begin;
set local lock_timeout = '200ms';
do $stop$
declare
    _try int := 0;
begin
    if (select setting::int from pg_settings where name = 'deadlock_timeout') <= 400 then
        raise exception 'deadlock_timeout is under half a second: PART 1 counts on giving up (200 ms) before Postgres looks for a deadlock. Nothing was changed.';
    end if;
    -- Already gone (a second run): take no lock at all.
    if not exists (select 1 from pg_trigger where tgrelid = 'public.course'::regclass and not tgisinternal
                      and tgname in ('grade_return_release')) then
        return;
    end if;
    loop
        _try := _try + 1;
        begin
            drop trigger if exists grade_return_release on public.course;
            exit;
        exception when lock_not_available then
            if _try >= 40 then
                raise exception 'PART 1 could not get public.course in % tries. Its triggers are still there; the tables before it are done. Run PART 1 again.', _try;
            end if;
            perform pg_sleep(0.1);
        end;
    end loop;
end
$stop$;
commit;

-- What is left with grade_return in its name. No rows: Batch A's 18 are gone
-- and nothing else was there. With S0-M4b (2026110905, PR 989) applied this
-- lists its three, which PART 1 leaves alone: grade_return_mode on
-- assessment, and grade_return_truncate on assessment and on enrollment.
select t.tgrelid::regclass::text as on_table, t.tgname as trigger_still_there,
       case when t.tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_update',
                              'grade_return_repoint', 'grade_return_gone', 'grade_return_release')
            then 'Batch A''s: PART 1 did not finish. Run it again.'
            else 'Not Batch A''s (S0-M4b, 2026110905, adds these): left alone. Its own undo removes it.' end as whose
  from pg_trigger t
 where not t.tgisinternal and t.tgname like 'grade\_return\_%'
 order by 1, 2;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1B: the five score-table policies as they were before file 01
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
begin
    perform 'public.fv_owns_enrollment(uuid)'::regprocedure;
end
$guard$;

drop policy if exists score_same_class on public.score;
drop policy if exists score_via_enrollment on public.score;
create policy score_via_enrollment on public.score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists tag_score_same_class on public.tag_score;
drop policy if exists tag_score_via_enrollment on public.tag_score;
create policy tag_score_via_enrollment on public.tag_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_score_same_class on public.rubric_score;
drop policy if exists rubric_score_via_enrollment on public.rubric_score;
create policy rubric_score_via_enrollment on public.rubric_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_check_score_same_class on public.rubric_check_score;
drop policy if exists rubric_check_score_via_enrollment on public.rubric_check_score;
create policy rubric_check_score_via_enrollment on public.rubric_check_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists dibels_score_same_class on public.dibels_score;
drop policy if exists dibels_score_via_enrollment on public.dibels_score;
create policy dibels_score_via_enrollment on public.dibels_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: the full removal
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _def text;
    _strangers text;
    -- Every function Batch A made (PART 2 drops each by name, below) and the
    -- seven it patched.
    _known text[] := array[
            'public.fv_owns_rubric_check_cell(uuid,uuid,uuid)', 'public.fv_owns_rubric_score_cell(uuid,uuid,uuid)',
            'public.fv_owns_score_cell(uuid,uuid)', 'public.fv_owns_tag_score_cell(uuid,uuid,uuid)',
            'student_submit._card_lookup(text,text)', 'student_submit._card_refusal(uuid)',
            'student_submit._device_session(text)', 'student_submit._midnight(text)',
            'student_submit._returned_grade(uuid,uuid)', 'student_submit._session_class(text,uuid)',
            'student_submit._session_classes(uuid)', 'student_submit.card(text,text)',
            'student_submit.done(text,text)', 'student_submit.page(text,uuid,text)',
            'student_submit.seen(text,uuid,uuid[],text)', 'student_submit.verify_card(text,text,text,text,text,text,boolean)',
            'fv_private.grade_return_remap(uuid,jsonb,jsonb)', 'fv_private.restore_grade_returns(jsonb)',
            'public._cards_work_until(uuid)', 'public._fv_date(text)',
            'public._fv_timezone(text)', 'public._grade_copy(uuid,uuid)',
            'public._grade_copy_entry(integer,integer,text,text,boolean)', 'public._grade_copy_in_use(jsonb,uuid)',
            'public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb)', 'public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb)',
            'public._grade_return_apply(uuid,uuid,jsonb,jsonb)', 'public._grade_return_gone()',
            'public._grade_return_holds(uuid)', 'public._grade_return_lock(uuid)',
            'public._grade_return_lock_first(uuid)', 'public._grade_return_on_change()',
            'public._grade_return_one(uuid,uuid,timestamp with time zone)', 'public._grade_return_release()',
            'public._grade_return_repoint()', 'public._issue_student_card(uuid,text)',
            'public._student_card_json(uuid)', 'public.course_draft_count(uuid)',
            'public.issue_student_cards(uuid,uuid[],uuid)', 'public.list_course_grade_returns(uuid)',
            'public.list_student_cards(uuid)', 'public.mark_student_cards_printed(uuid[],uuid)',
            'public.reissue_student_card(uuid,uuid)', 'public.return_grades(uuid,uuid[],uuid)',
            'public.set_cards_work_until(uuid,date,uuid)', 'public.unlock_all_student_cards(uuid,uuid)',
            'public.unlock_student_card(uuid,uuid)', 'public.update_course(uuid,jsonb)',
            'public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', 'public.duplicate_course(uuid,uuid)',
            'public.import_json_restore(jsonb,uuid)', 'public._issue_access_code(uuid,uuid,timestamptz)',
            'public._issue_report_code(uuid,uuid,timestamptz)', 'student_submit.open(text,text)'
    ];
begin
    -- Anything built on Batch A since, which this script does not know and
    -- would leave broken: a trigger named grade_return_... that is not one of
    -- Batch A's 18, a table named grade_return_..., or a function that names
    -- grade_return and is neither one Batch A made nor one of the seven it
    -- patched. S0-M4b (2026110905, PR 989) is all three.
    select string_agg(what, ', ' order by what) into _strangers from (
        select 'trigger ' || t.tgname || ' on ' || t.tgrelid::regclass::text as what
          from pg_trigger t
         where not t.tgisinternal and t.tgname like 'grade\_return\_%'
           and t.tgname not in ('grade_return_delete', 'grade_return_insert', 'grade_return_update',
                                'grade_return_repoint', 'grade_return_gone', 'grade_return_release')
        union all
        select 'table ' || c.oid::regclass::text
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r' and n.nspname in ('public', 'fv_private', 'student_submit') and c.relname like 'grade\_return\_%'
        union all
        select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'fv_private', 'student_submit') and p.prosrc like '%grade_return%'
           and p.oid not in (select to_regprocedure(f) from unnest(_known) f where to_regprocedure(f) is not null)) x;
    if _strangers is not null then
        raise exception 'Something is built on top of Batch A that this script does not know. If it is S0-M4b (2026110905, PR 989), run S0-M4b''s undo first, then this. Found: %. Nothing was changed.', _strangers;
    end if;
    -- Each of the seven functions must be either the function Batch A left
    -- (it carries the line Batch A added) or already the one from before (a
    -- second run). Anything else: stop.
    for _f in
        select * from (values
            ('public.update_course(uuid,jsonb)', '8aacf4f24b0b7133352379e89978776b'),
            ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', '92f7ff4b840c1dd9fe473f8ecdee29b5'),
            ('public.duplicate_course(uuid,uuid)', '528aacf8cb9581682178b1914a32fc20'),
            ('public.import_json_restore(jsonb,uuid)', '58e48ae4f7ebcc05489b489a4f8906df'),
            ('public._issue_access_code(uuid,uuid,timestamptz)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('student_submit.open(text,text)', '91123d2f5a0d964be66b62ee8f91c047')
        ) as v(fn, was)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        if md5(_def) <> _f.was and not exists (
                select 1 from (values

                    ('public.update_course(uuid,jsonb)', $m$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
        student_page_enabled = case when p_patch ? 'student_page_enabled'
                                then coalesce((p_patch->>'student_page_enabled')::boolean, false)
                                else student_page_enabled end,
        return_grades    = case when p_patch ? 'return_grades'
                                then nullif(p_patch->>'return_grades', '')
                                else return_grades end,$m$),
                    ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', $m$    -- Draft and Returned: the updates below point scores at the copy's
    -- criteria and checkboxes. They are a rubric move, not a change to any
    -- grade, and the triggers read this flag to know it. Only a move to
    -- another rubric is one: a map that starts from a criterion or checkbox
    -- of the target rubric itself swaps levels inside one rubric, and that
    -- is a change like any other.
    perform set_config('fv.moving_rubric',
        case when exists (select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
                            join criterion c on c.id::text = m.key where c.rubric_id = p_rubric_id)
               or exists (select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
                            join criterion_check ck on ck.id::text = m.key
                            join criterion c on c.id = ck.criterion_id where c.rubric_id = p_rubric_id)
             then '' else 'on' end, true);

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$m$),
                    ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', $m$    -- The copies kept for students follow the scores to the new ids, also
    -- where the working copy no longer has the row.
    perform fv_private.grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);
    perform set_config('fv.moving_rubric', '', true);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$m$),
                    ('public.duplicate_course(uuid,uuid)', $m$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades)$m$),
                    ('public.duplicate_course(uuid,uuid)', $m$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades
$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,$m$),
                    ('public.import_json_restore(jsonb,uuid)', $m$    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform fv_private.restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);$m$),
                    ('public._issue_access_code(uuid,uuid,timestamptz)', $m$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$m$),
                    ('public._issue_report_code(uuid,uuid,timestamptz)', $m$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$m$),
                    ('student_submit.open(text,text)', $m$           and at > now() - interval '15 minutes') >= 300 then$m$)
                ) as e(fn, added) where e.fn = _f.fn and position(e.added in _def) > 0) then
            raise exception '% is neither the function Batch A left nor the one from before it (md5 %). Nothing was changed.',
                _f.fn, md5(_def);
        end if;
    end loop;
end
$guard$;

-- The triggers (PART 1).
drop trigger if exists grade_return_gone on public.assessment;
drop trigger if exists grade_return_release on public.course;
drop trigger if exists grade_return_gone on public.enrollment;
drop trigger if exists grade_return_delete on public.rubric_check_score;
drop trigger if exists grade_return_insert on public.rubric_check_score;
drop trigger if exists grade_return_repoint on public.rubric_check_score;
drop trigger if exists grade_return_update on public.rubric_check_score;
drop trigger if exists grade_return_delete on public.rubric_score;
drop trigger if exists grade_return_insert on public.rubric_score;
drop trigger if exists grade_return_repoint on public.rubric_score;
drop trigger if exists grade_return_update on public.rubric_score;
drop trigger if exists grade_return_delete on public.score;
drop trigger if exists grade_return_insert on public.score;
drop trigger if exists grade_return_update on public.score;
drop trigger if exists grade_return_delete on public.tag_score;
drop trigger if exists grade_return_insert on public.tag_score;
drop trigger if exists grade_return_repoint on public.tag_score;
drop trigger if exists grade_return_update on public.tag_score;

-- The five policies as they were (PART 1B), then file 01's four helpers.
drop policy if exists score_same_class on public.score;
drop policy if exists score_via_enrollment on public.score;
create policy score_via_enrollment on public.score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists tag_score_same_class on public.tag_score;
drop policy if exists tag_score_via_enrollment on public.tag_score;
create policy tag_score_via_enrollment on public.tag_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_score_same_class on public.rubric_score;
drop policy if exists rubric_score_via_enrollment on public.rubric_score;
create policy rubric_score_via_enrollment on public.rubric_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists rubric_check_score_same_class on public.rubric_check_score;
drop policy if exists rubric_check_score_via_enrollment on public.rubric_check_score;
create policy rubric_check_score_via_enrollment on public.rubric_check_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop policy if exists dibels_score_same_class on public.dibels_score;
drop policy if exists dibels_score_via_enrollment on public.dibels_score;
create policy dibels_score_via_enrollment on public.dibels_score
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));
drop function if exists public.fv_owns_rubric_check_cell(uuid,uuid,uuid);
drop function if exists public.fv_owns_rubric_score_cell(uuid,uuid,uuid);
drop function if exists public.fv_owns_score_cell(uuid,uuid);
drop function if exists public.fv_owns_tag_score_cell(uuid,uuid,uuid);

-- The seven patched functions: each edit made backwards, in the reverse of
-- the order Batch A made them.
do $unpatch$
declare
    _edits text[][] := array[
      -- function, the text Batch A put in, the text that was there
      array['public.update_course(uuid,jsonb)',
$s$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
        student_page_enabled = case when p_patch ? 'student_page_enabled'
                                then coalesce((p_patch->>'student_page_enabled')::boolean, false)
                                else student_page_enabled end,
        return_grades    = case when p_patch ? 'return_grades'
                                then nullif(p_patch->>'return_grades', '')
                                else return_grades end,$s$,
$s$        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,$s$],
      array['public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
$s$    -- Draft and Returned: the updates below point scores at the copy's
    -- criteria and checkboxes. They are a rubric move, not a change to any
    -- grade, and the triggers read this flag to know it. Only a move to
    -- another rubric is one: a map that starts from a criterion or checkbox
    -- of the target rubric itself swaps levels inside one rubric, and that
    -- is a change like any other.
    perform set_config('fv.moving_rubric',
        case when exists (select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
                            join criterion c on c.id::text = m.key where c.rubric_id = p_rubric_id)
               or exists (select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
                            join criterion_check ck on ck.id::text = m.key
                            join criterion c on c.id = ck.criterion_id where c.rubric_id = p_rubric_id)
             then '' else 'on' end, true);

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$s$,
$s$    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()$s$],
      array['public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
$s$    -- The copies kept for students follow the scores to the new ids, also
    -- where the working copy no longer has the row.
    perform fv_private.grade_return_remap(p_assessment_id, p_criterion_map, p_check_map);
    perform set_config('fv.moving_rubric', '', true);

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$,
$s$    _result := jsonb_build_object('scores', _moved, 'checks', _checks);$s$],
      array['public.duplicate_course(uuid,uuid)',
$s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades)$s$,
$s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally)$s$],
      array['public.duplicate_course(uuid,uuid)',
$s$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally, return_grades
$s$,
$s$           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally
$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)$s$,
$s$                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally)$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))$s$,
$s$                coalesce((_row->>'courses_count_equally')::boolean, false))$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,$s$,
$s$          courses_count_equally=excluded.courses_count_equally,$s$],
      array['public.import_json_restore(jsonb,uuid)',
$s$    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform fv_private.restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);$s$,
$s$    perform set_config('fv.restoring', '', true);$s$],
      array['public._issue_access_code(uuid,uuid,timestamptz)',
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$s$,
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));$s$],
      array['public._issue_report_code(uuid,uuid,timestamptz)',
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$s$,
$s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));$s$],
      array['student_submit.open(text,text)',
$s$           and at > now() - interval '15 minutes') >= 300 then$s$,
$s$           and at > now() - interval '15 minutes') >= 60 then$s$]
    ];
    _def  text;
    _hits int;
    i     int;
begin
    for i in reverse array_length(_edits, 1) .. 1 loop
        _def := pg_get_functiondef(_edits[i][1]::regprocedure);
        _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
        continue when _hits = 0;   -- already as it was
        if _hits <> 1 then
            raise exception '% has % matches for a line Batch A added, expected 1', _edits[i][1], _hits;
        end if;
        execute replace(_def, _edits[i][2], _edits[i][3]);
    end loop;
end
$unpatch$;

-- The functions of file 04, file 03 and file 02, before the tables: some
-- return a row of one.
drop function if exists student_submit._card_lookup(text,text);
drop function if exists student_submit._card_refusal(uuid);
drop function if exists student_submit._device_session(text);
drop function if exists student_submit._midnight(text);
drop function if exists student_submit._returned_grade(uuid,uuid);
drop function if exists student_submit._session_class(text,uuid);
drop function if exists student_submit._session_classes(uuid);
drop function if exists student_submit.card(text,text);
drop function if exists student_submit.done(text,text);
drop function if exists student_submit.page(text,uuid,text);
drop function if exists student_submit.seen(text,uuid,uuid[],text);
drop function if exists student_submit.verify_card(text,text,text,text,text,text,boolean);
drop function if exists fv_private.grade_return_remap(uuid,jsonb,jsonb);
drop function if exists fv_private.restore_grade_returns(jsonb);
drop function if exists public._cards_work_until(uuid);
drop function if exists public._fv_date(text);
drop function if exists public._fv_timezone(text);
drop function if exists public._grade_copy(uuid,uuid);
drop function if exists public._grade_copy_entry(integer,integer,text,text,boolean);
drop function if exists public._grade_copy_in_use(jsonb,uuid);
drop function if exists public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb);
drop function if exists public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb);
drop function if exists public._grade_return_apply(uuid,uuid,jsonb,jsonb);
drop function if exists public._grade_return_gone();
drop function if exists public._grade_return_holds(uuid);
drop function if exists public._grade_return_lock(uuid);
drop function if exists public._grade_return_lock_first(uuid);
drop function if exists public._grade_return_on_change();
drop function if exists public._grade_return_one(uuid,uuid,timestamp with time zone);
drop function if exists public._grade_return_release();
drop function if exists public._grade_return_repoint();
drop function if exists public._issue_student_card(uuid,text);
drop function if exists public._student_card_json(uuid);
drop function if exists public.course_draft_count(uuid);
drop function if exists public.issue_student_cards(uuid,uuid[],uuid);
drop function if exists public.list_course_grade_returns(uuid);
drop function if exists public.list_student_cards(uuid);
drop function if exists public.mark_student_cards_printed(uuid[],uuid);
drop function if exists public.reissue_student_card(uuid,uuid);
drop function if exists public.return_grades(uuid,uuid[],uuid);
drop function if exists public.set_cards_work_until(uuid,date,uuid);
drop function if exists public.unlock_all_student_cards(uuid,uuid);
drop function if exists public.unlock_student_card(uuid,uuid);


-- The tables, newest first (a later one points at an earlier one).
drop table if exists student_submit.device_session_enrollment;
drop table if exists student_submit.device_session;
drop table if exists public.student_card;
drop table if exists public.grade_return;
drop schema if exists fv_private;

-- The sign-in log takes 'open' and 'submit' again; its card rows go first.
do $attempt$
begin
    if exists (select 1 from pg_constraint where conrelid = 'student_submit.attempt'::regclass and conname = 'attempt_route_check'
                  and pg_get_constraintdef(oid) like '%card%') then
        delete from student_submit.attempt where route = 'card';
        alter table student_submit.attempt drop constraint attempt_route_check;
        alter table student_submit.attempt add constraint attempt_route_check
            check (route = any (array['open'::text, 'submit'::text]));
    end if;
end
$attempt$;

-- The three class settings.
alter table public.course drop constraint if exists course_return_grades_check;
alter table public.course drop column if exists cards_work_until;
alter table public.course drop column if exists return_grades;
alter table public.course drop column if exists student_page_enabled;

-- Last: each of the seven must now be exactly the function from before
-- Batch A. If one is not, the whole of PART 2 is undone.
do $check$
declare
    _f record;
begin
    for _f in
        select * from (values
            ('public.update_course(uuid,jsonb)', '8aacf4f24b0b7133352379e89978776b'),
            ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', '92f7ff4b840c1dd9fe473f8ecdee29b5'),
            ('public.duplicate_course(uuid,uuid)', '528aacf8cb9581682178b1914a32fc20'),
            ('public.import_json_restore(jsonb,uuid)', '58e48ae4f7ebcc05489b489a4f8906df'),
            ('public._issue_access_code(uuid,uuid,timestamptz)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('student_submit.open(text,text)', '91123d2f5a0d964be66b62ee8f91c047')
        ) as v(fn, was)
    loop
        if md5(pg_get_functiondef(_f.fn::regprocedure)) <> _f.was then
            raise exception '% did not come back as the function from before Batch A (md5 %, expected %). Nothing was changed.',
                _f.fn, md5(pg_get_functiondef(_f.fn::regprocedure)), _f.was;
        end if;
    end loop;
end
$check$;

notify pgrst, 'reload schema';

commit;
