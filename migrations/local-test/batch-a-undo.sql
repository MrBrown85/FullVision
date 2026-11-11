-- BATCH A, UNDONE. Not a migration: the way back from Batch A
-- (migrations/2026110901 to 2026110904, PR 966), which was applied to
-- gradebook-prod on 2026-11-10. Written for the database as it is now:
-- Batch A, then S0-M5 (2026111002), then S0-M4b (2026110905, applied
-- 2026-11-10 17:12 UTC).
--
-- S3-M1 (2026111003_card_codes_keyed.sql: card codes the database cannot
-- read) STANDS ON BATCH A TOO, once it is applied: it changes Batch A's
-- student_card table and replaces its card functions. It has its own undo,
-- migrations/local-test/s3-m1-undo.sql. With S3-M1 applied:
--   PART 1, PART 1A and PART 1B here run as they are and touch nothing of
--     S3-M1 (it adds no trigger and no save runs its code);
--   PART 2 needs S3-M1's undo first, and refuses without it. The order is
--     S3-M1's undo, then S0-M4b's, then PART 2.
--
-- S0-M4b STANDS ON BATCH A and has its own undo,
-- migrations/local-test/s0-m4b-undo.sql. With it applied, as it is:
--   PART 1 and PART 1B here run as they are and touch nothing of S0-M4b;
--   PART 1A needs S0-M4b's PART 1 (its fast stop) first, and refuses
--     without it;
--   PART 2 needs the whole of S0-M4b's undo first, and refuses without it.
-- S0-M5 is left alone throughout (see below).
--
-- It lives under migrations/local-test/ on purpose: CI's drift check treats
-- every file in migrations/ as something to be applied, and this is only to
-- be run if Batch A has to come out.
--
-- Run it in the SQL editor (or psql), ONE PART AT A TIME, by pasting that
-- part from its banner to the next. Not through apply_migration: the parts
-- open and close their own transactions.
--
-- DO NOT PASTE THE WHOLE FILE. Pasted whole it runs every part in turn,
-- PART 2 included: the page goes off for every class and Batch A is removed.
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
-- PART 1, PART 1A and PART 1B remove nothing those call, so they need
-- nothing off.
--
-- ── PART 1: the fast stop ───────────────────────────────────────────────────
-- Drops Batch A's 18 triggers and nothing else: the 12 statement triggers
-- and 3 re-pointing triggers on score, tag_score, rubric_score and
-- rubric_check_score, the 2 on enrollment and assessment deletes, and the 1
-- on course settings.
--
-- With teachers working. It takes one table at a time, course first, each
-- in its own transaction: it waits at most 200 ms for the table, and if it
-- cannot have it, lets go and tries again, so it never holds two tables and
-- never outwaits Postgres's deadlock check (deadlock_timeout, 1s on
-- gradebook-prod, read 2026-11-10; it refuses to run if that is 400 ms or
-- less). Measured with six connections saving in a loop (points, a rubric
-- fill, one criterion, a comment, a clear, a change to the class itself;
-- batch_a_undo_load.py), four runs here on PostgreSQL 17.11 and two on
-- 18.6 (the last of each with S0-M4b applied, so with its trigger
-- function), and three by the independent reviewer:
--   a class at work (each connection saving about four times a second):
--       every run finished and no save failed. PART 1 took about 10 ms, at
--       most 0.5 s; the slowest save waited 0.4 s.
--   flat out (100 to 600 saves a second while it ran): every run finished
--       and no save failed, but it is not quick. PART 1 took about a second
--       as a rule and up to 8 s, and the slowest save waited anything from
--       0.3 s to 4.6 s.
-- So no save is refused; under heavy load one can wait seconds. (As first
-- written, in one transaction, the same test flat out finished 2 to 11 of
-- 20 runs and killed 72 to 146 saves.) If one table cannot be had in 40
-- tries it stops there and says which; run PART 1 again and it carries on
-- from that table.
--
-- DESTROYS: nothing.
--
-- What stops: an ordinary save, clear, comment, status or delete no longer
-- touches grade_return (which grades are Draft and which Returned).
--
-- What does NOT stop. Batch A's own functions all stay, and these still run:
--   file 01's five row-security policies, on every save, until PART 1B;
--   Return Grades: it still returns a draft that was waiting at the stop
--     (and finds nothing to return for a grade first saved after it, until
--     S0-M4b's repair has given that grade a row: below);
--   the teacher's own screens: list_course_grade_returns and
--     course_draft_count still answer, from what was there at the stop or
--     at the last repair (the draft count does not move when a new grade is
--     saved);
--   Duplicate Class (duplicate_course) still copies the Return Grades
--     setting; the slip-code functions still check card codes;
--   a rubric move (move_rubric_scores) still re-points, in grade_return,
--     the copy a student was given;
--   a restore (import_json_restore) still writes grade_return rows for the
--     class it restores;
--   the card functions and the student page's own functions: cards are
--     still issued, students still sign in, read and are marked as having
--     seen a piece;
--   update_course still stores the two class settings, but nothing reacts:
--     a class leaving When I Return Them no longer returns what was
--     waiting, and the repair does not return it either;
--   a deleted piece or student leaves its grade_return rows behind, until
--     the repair removes them;
--   S0-M4b's own: its three triggers (grade_return_mode on assessment,
--     grade_return_truncate on assessment and on enrollment; PART 1's last
--     query lists them) and its nightly job, fv_grade_return_repair_daily,
--     at 10:47 UTC. PART 1 of s0-m4b-undo.sql stops those. The two fast
--     stops can be run in either order (tested).
--
-- What students see after PART 1, in a class with the Student Page on.
-- grade_return no longer follows the grades as they are saved, and the page
-- reads it. S0-M4b's repair brings it up to date once a night (10:47 UTC),
-- or when it is called by hand: call public.grade_return_repair_nightly();
-- Between a save and the next repair:
--   a grade that was Returned, and the teacher then changes: the student
--     is shown the change AT ONCE. It does not wait to be returned. (In an
--     As Soon As I Save class that is what happens anyway.) At the repair,
--     in a When I Return Them class, the change becomes a draft: the student
--     is back to the grade they were given, having seen the new one.
--   a first grade on a piece that had none: NOT shown, in either kind of
--     class, and Return Grades answers "returned: 0", because there is no
--     row for it to return. The repair gives it its row: a Draft in a When
--     I Return Them class (still not shown; Return Grades then returns it),
--     Returned and shown in an As Soon As I Save class.
--   a draft that was waiting: stays hidden, whatever is saved on it, before
--     the repair and after. If the piece had been returned before, the
--     student keeps seeing that returned grade.
-- If S0-M4b's fast stop has been run as well, nothing repairs at night: the
-- first two stand until the repair is called by hand or Batch A is turned
-- back on.
-- So while PART 1 stands, a class with the page on shows students some
-- grades early and hides others, for up to a day. If any class has it on
-- and Batch A is not going straight back, run PART 1A. While no class has
-- the page on, none of this matters: nothing reads grade_return.
--
-- ── PART 1A: the Student Page off, for every class that has it on ───────────
-- ONLY AFTER BOTH FAST STOPS, this script's PART 1 and S0-M4b's: PART 1's
-- last query then lists no trigger at all. Either of two things would
-- otherwise hand students grades their teacher never returned:
--   grade_return_release on course (Batch A's) returns every waiting draft
--     when a class's page is turned off: that is Batch A's rule, and with
--     Batch A whole a plain UPDATE of the setting does exactly that;
--   S0-M4b's repair settles a grade saved since PART 1 as a save would in
--     the class as it is then, and a class with the page off holds nothing
--     back: a first grade, or a draft the teacher has changed, is made
--     Returned, and is shown when the page comes back on (tested).
-- So PART 1A refuses, with nothing changed, while any of Batch A's 18
-- triggers is left, or S0-M4b's nightly job is scheduled and active, or
-- its grade_return_mode trigger is there, and says which. Its UPDATE
-- carries the trigger conditions itself, so it cannot turn a class off
-- even if it is pasted without the check (S0-M4b's fast stop drops its
-- triggers and unschedules its job in one transaction). (PART 1 takes
-- course first, so the release trigger is the first thing gone.)
-- WHILE ITS CLASSES ARE OFF, DO NOT CALL grade_return_repair_nightly() BY
-- HAND: it would do what the nightly job would have.
-- It answers with the classes it turned off. KEEP THAT LIST: nothing else
-- remembers which classes had the page on; the statement to turn them on
-- again is beside PART 1A. After it the page and every card scan answer
-- "closed", no draft was returned, and nothing is shown early or hidden;
-- turned on again, students see what they saw (tested at every point of
-- PART 1). DESTROYS: nothing.
--
-- To turn Batch A back on after PART 1 (tested: the database is then, line
-- for line, what it is now):
--   0. if PART 1A was run, turn its classes on again first (the list);
--   1. call public.grade_return_repair_nightly();
--      Every grade saved in between gets the row a save would have made: a
--      first grade in a When I Return Them class is a Draft, a Returned
--      grade changed in between waits as a draft, rows left by deleted
--      pieces go.
--   2. 2026110902_grade_return.sql again. The 18 triggers are back. It also
--      puts five functions back as Batch A made them, without S0-M4b's
--      changes (_grade_return_on_change, return_grades, course_draft_count,
--      list_course_grade_returns, fv_private.restore_grade_returns), so,
--      straight after it:
--   3. 2026110905_grade_return_limits.sql again. S0-M4b's changes are back,
--      and its three triggers and its job if its fast stop had been run.
-- Without step 1, file 02's backfill makes a Returned row for every grade
-- first saved in between, and students see those at once; a grade first
-- saved between steps 1 and 2 goes that way too. Step 2 is one transaction
-- on all seven tables: a quiet moment.
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
-- Measured the same way, six sets of ten runs (the last two after S0-M4b's
-- undo, which was run with the saves paused). With a class at work 8 to 10
-- of 10 runs finished; in the four sets on 17.11 no save failed, and in the
-- two on 18.6 saves were killed by deadlocks (7, and 17). Flat out it is
-- the wrong tool: between 0
-- and 6 of 10 runs finished (the others were stopped by a deadlock or the
-- lock timeout, with nothing changed), 34 to 77 saves were killed in each
-- set of ten, and a save caught in flight can fail once with "column does
-- not exist". So a quiet moment means nobody saving. If it stops, nothing
-- was changed: run it again.
--
-- What stops PART 2 before it changes anything. It knows what Batch A made:
-- its 47 functions and the 7 it patched, by signature; its four tables with
-- their columns, indexes, constraints and policies; its three class
-- settings; its 18 triggers and file 01's five policies. It stops, and lists
-- every one, if anything else
--   depends on one of those in Postgres's own record (a view, a policy, a
--     trigger, a foreign key, an index on a class setting, a SQL-standard
--     function): Postgres would refuse the drop half-way, with a raw error;
--   sits on one of Batch A's four tables without being Batch A's (a column
--     or index a later migration added): it would go with the table, unseen;
--   is a function, in any schema, whose text names one of them (comments
--     left out; the everyday names card, done, page and seen count only as
--     student_submit.card and so on): Postgres records nothing for these,
--     and after PART 2 they would fail when next called, a trigger function
--     on score on every save;
--   is a pg_cron job whose command names one of them.
-- S0-M4b is such a thing, and it is applied: PART 2 stops, says so, and
-- lists what it found of S0-M4b apart from anything else it found. Run
-- S0-M4b's undo first (migrations/local-test/s0-m4b-undo.sql, both its
-- parts), then PART 2. Tested in that order on a database built as
-- gradebook-prod is now: it comes back as it was before Batch A, with
-- S0-M5 in place.
-- S3-M1 is such a thing as well, once it is applied: PART 2 stops, says so
-- first, and lists what it found of S3-M1 (its functions, its key-id table,
-- its columns, indexes and constraints on student_card). Run S3-M1's undo
-- (migrations/local-test/s3-m1-undo.sql), then S0-M4b's, then PART 2.
-- Tested in that order (batch_a_undo.py, scenario s3-m1).
-- The same list, read-only, to run before PART 2. Its first two rows say
-- whether S0-M4b and S3-M1 are on top of Batch A; every row after them is
-- something ELSE that would stop PART 2 (today there should be none). It
-- is PART 2's own query, and it reads pg_cron's cron.job, which
-- gradebook-prod has:
-- precheck:
--   with a as (select
--       string_to_array(   -- the 47 functions Batch A made
--           'public.fv_owns_rubric_check_cell(uuid,uuid,uuid) public.fv_owns_rubric_score_cell(uuid,uuid,uuid) '
--           'public.fv_owns_score_cell(uuid,uuid) public.fv_owns_tag_score_cell(uuid,uuid,uuid) '
--           'student_submit._card_lookup(text,text) student_submit._card_refusal(uuid) student_submit._device_session(text) '
--           'student_submit._midnight(text) student_submit._returned_grade(uuid,uuid) student_submit._session_class(text,uuid) '
--           'student_submit._session_classes(uuid) student_submit.card(text,text) student_submit.done(text,text) '
--           'student_submit.page(text,uuid,text) student_submit.seen(text,uuid,uuid[],text) '
--           'student_submit.verify_card(text,text,text,text,text,text,boolean) fv_private.grade_return_remap(uuid,jsonb,jsonb) '
--           'fv_private.restore_grade_returns(jsonb) public._cards_work_until(uuid) public._fv_date(text) public._fv_timezone(text) '
--           'public._grade_copy(uuid,uuid) public._grade_copy_entry(integer,integer,text,text,boolean) '
--           'public._grade_copy_in_use(jsonb,uuid) public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb) '
--           'public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb) public._grade_return_apply(uuid,uuid,jsonb,jsonb) '
--           'public._grade_return_gone() public._grade_return_holds(uuid) public._grade_return_lock(uuid) '
--           'public._grade_return_lock_first(uuid) public._grade_return_on_change() public._grade_return_one(uuid,uuid,timestamptz) '
--           'public._grade_return_release() public._grade_return_repoint() public._issue_student_card(uuid,text) '
--           'public._student_card_json(uuid) public.course_draft_count(uuid) public.issue_student_cards(uuid,uuid[],uuid) '
--           'public.list_course_grade_returns(uuid) public.list_student_cards(uuid) public.mark_student_cards_printed(uuid[],uuid) '
--           'public.reissue_student_card(uuid,uuid) public.return_grades(uuid,uuid[],uuid) '
--           'public.set_cards_work_until(uuid,date,uuid) public.unlock_all_student_cards(uuid,uuid) '
--           'public.unlock_student_card(uuid,uuid)', ' ') as made,
--       string_to_array(   -- the 7 it patched
--           'public.update_course(uuid,jsonb) public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid) '
--           'public.duplicate_course(uuid,uuid) public.import_json_restore(jsonb,uuid) '
--           'public._issue_access_code(uuid,uuid,timestamptz) public._issue_report_code(uuid,uuid,timestamptz) '
--           'student_submit.open(text,text)', ' ') as patched,
--       string_to_array(   -- what S0-M4b (2026110905) made, to tell it from anything else
--           'public._grade_return_settle(uuid,uuid) public._grade_return_repair_class(uuid) public._grade_return_repair_lost() '
--           'public._grade_return_truncated() public._grade_return_mode_changed() public.grade_return_repair_nightly()', ' ') as m4b,
--       string_to_array(   -- what S3-M1 (2026111003) made, to tell it from anything else: its functions,
--           'student_submit._card_lookup(text,text,text) student_submit.card(text,text,text) '
--           'student_submit.verify_card(text,text,text,text,text,text,text,boolean) '
--           'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid) student_submit._as_teacher(uuid) '
--           'student_submit._card_key_seen(text)', ' ') as m1,
--       string_to_array(   -- and what it put on Batch A's student_card: columns, indexes, constraints
--           'student_card.code_hmac student_card.pw_hmac student_card.key_id student_card.seq student_card_code_hmac_key '
--           'student_card_enrollment_seq student_card_code_hmac_check student_card_pw_hmac_check student_card_key_id_check '
--           'student_card_seq_check student_card_live_has_tag', ' ') as m1_on,
--       array['grade_return_delete', 'grade_return_insert', 'grade_return_update', 'grade_return_repoint', 'grade_return_gone', 'grade_return_release'] as trg,
--       string_to_array(   -- the columns of Batch A's four tables
--           'grade_return.enrollment_id grade_return.assessment_id grade_return.is_draft grade_return.returned_at '
--           'grade_return.returned_copy grade_return.previous_copy grade_return.updated_at grade_return.seen_at '
--           'grade_return.working_copy student_card.id student_card.enrollment_id student_card.code student_card.code_hash '
--           'student_card.salt student_card.created_at student_card.printed_at student_card.last_opened_at student_card.wrong_tries '
--           'student_card.wrong_times student_card.locked_at student_card.stopped_at student_card.works_until student_card.password '
--           'device_session.id device_session.token_hash device_session.created_at device_session.expires_at '
--           'device_session_enrollment.session_id device_session_enrollment.enrollment_id device_session_enrollment.card_id '
--           'device_session_enrollment.added_at', ' ') as cols,
--       string_to_array(   -- their indexes and constraints
--           'grade_return_assessment_idx grade_return_pkey student_card_code_hash_key student_card_enrollment_idx '
--           'student_card_live_code student_card_one_live student_card_pkey device_session_expires device_session_pkey '
--           'device_session_token_hash_key device_session_enrollment_card device_session_enrollment_enrollment '
--           'device_session_enrollment_pkey grade_return_copy_while_draft grade_return_previous_copy_object '
--           'grade_return_returned_copy_object grade_return_working_copy_object student_card_enrollment_id_fkey '
--           'student_card_wrong_tries_check device_session_enrollment_card_id_fkey device_session_enrollment_enrollment_id_fkey '
--           'device_session_enrollment_session_id_fkey', ' ') as names
--   ), fn as (select to_regprocedure(x)::oid as oid from a, unnest(a.made) x where to_regprocedure(x) is not null
--   ), known as (select oid from fn union select to_regprocedure(x)::oid from a, unnest(a.patched) x where to_regprocedure(x) is not null
--   ), theirs as (select to_regprocedure(x)::oid as oid from a, unnest(a.m4b) x where to_regprocedure(x) is not null
--   ), keyed as (select to_regprocedure(x)::oid as oid from a, unnest(a.m1) x where to_regprocedure(x) is not null
--   ), tbl as (select to_regclass(x)::oid as oid
--                from unnest(array['public.grade_return', 'public.student_card', 'student_submit.device_session', 'student_submit.device_session_enrollment']) x
--               where to_regclass(x) is not null
--   ), col as (select attrelid, attnum from pg_attribute
--               where attrelid = to_regclass('public.course') and not attisdropped and attname in ('student_page_enabled', 'return_grades', 'cards_work_until')
--   ), rx as (   -- a function or cron job names Batch A if its text has one of these words
--       select '\m(grade_return|student_card|device_session|device_session_enrollment|student_page_enabled|return_grades|cards_work_until|'
--              || (select string_agg(distinct split_part(split_part(x, '(', 1), '.', 2), '|') from a, unnest(a.made) x
--                   where split_part(split_part(x, '(', 1), '.', 2) not in ('card', 'done', 'page', 'seen'))
--              || ')\M|student_submit\.(card|done|page|seen)\M' as re
--   ), dep as (   -- what Postgres records as depending on a function, table or class setting of Batch A's, and the table it belongs to
--       select d.classid, d.objid, d.objsubid, o.kind,
--              case d.classid when 'pg_class'::regclass then coalesce((select indrelid from pg_index where indexrelid = d.objid), d.objid)
--                             when 'pg_rewrite'::regclass then (select ev_class from pg_rewrite where oid = d.objid)
--                             when 'pg_constraint'::regclass then (select nullif(conrelid, 0) from pg_constraint where oid = d.objid)
--                             when 'pg_trigger'::regclass then (select tgrelid from pg_trigger where oid = d.objid)
--                             when 'pg_policy'::regclass then (select polrelid from pg_policy where oid = d.objid)
--                             when 'pg_attrdef'::regclass then (select adrelid from pg_attrdef where oid = d.objid)
--                             when 'pg_type'::regclass then (select nullif(typrelid, 0) from pg_type where oid = d.objid) end as home,
--              case d.classid when 'pg_trigger'::regclass then (select tgname::text from pg_trigger where oid = d.objid)
--                             when 'pg_policy'::regclass then (select polname::text from pg_policy where oid = d.objid)
--                             when 'pg_constraint'::regclass then (select conname::text from pg_constraint where oid = d.objid) end as name
--         from pg_depend d
--         join (select 'pg_proc'::regclass as cls, oid, null::int as sub, 'function' as kind from fn
--               union all select 'pg_class'::regclass, oid, null, 'table' from tbl
--               union all select 'pg_class'::regclass, attrelid, attnum, 'setting' from col) o
--           on d.refclassid = o.cls and d.refobjid = o.oid and (o.sub is null or d.refobjsubid = o.sub)
--        where d.deptype in ('n', 'a')
--   ), found as (
--       -- 1. depends on something of Batch A's in Postgres's own record, and is not Batch A's
--       select case when coalesce(d.home = to_regclass('public.grade_return_repair_log'), false) or (d.classid = 'pg_proc'::regclass and d.objid in (select oid from theirs))
--                   then 'S0-M4b'
--                   when d.classid = 'pg_proc'::regclass and d.objid in (select oid from keyed) then 'S3-M1' else 'other' end as whose,
--              'depends on Batch A: ' || pg_describe_object(d.classid, d.objid, d.objsubid) as what
--         from dep d, a
--        where not (d.classid = 'pg_proc'::regclass and d.objid in (select oid from known))
--          and not coalesce(d.home in (select oid from tbl), false)                                -- on one of its own tables: 2
--          and not (d.classid = 'pg_constraint'::regclass and (select contype from pg_constraint where oid = d.objid) = 'n')   -- a column's own NOT NULL (Postgres 18)
--          and not (d.kind = 'function' and d.classid = 'pg_policy'::regclass and coalesce(d.name like '%\_same\_class', false))   -- file 01's five policies
--          and not (d.kind = 'function' and d.classid = 'pg_trigger'::regclass and coalesce(d.name = any (a.trg), false))          -- its 18 triggers
--          and not (d.kind = 'setting' and coalesce(   (d.classid = 'pg_constraint'::regclass and d.name = 'course_return_grades_check')
--                                                   or (d.classid = 'pg_attrdef'::regclass and d.home = to_regclass('public.course'))
--                                                   or (d.classid = 'pg_trigger'::regclass and d.name = 'grade_return_release'), false))
--       union all   -- 2. sits on one of Batch A's four tables and is not Batch A's
--       select case when (c.relname || '.' || t.attname) = any (a.m1_on) then 'S3-M1' else 'other' end,
--              'on Batch A''s table, not Batch A''s: column ' || c.relname || '.' || t.attname
--         from pg_attribute t join tbl on tbl.oid = t.attrelid join pg_class c on c.oid = t.attrelid, a
--        where t.attnum > 0 and not t.attisdropped and (c.relname || '.' || t.attname) <> all (a.cols)
--       union all
--       select case when c.relname::text = any (a.m1_on) then 'S3-M1' else 'other' end, 'on Batch A''s table, not Batch A''s: index ' || c.relname
--         from pg_index i join tbl on tbl.oid = i.indrelid join pg_class c on c.oid = i.indexrelid, a where c.relname::text <> all (a.names)
--       union all
--       select case when k.conname::text = any (a.m1_on) then 'S3-M1' else 'other' end, 'on Batch A''s table, not Batch A''s: constraint ' || k.conname
--         from pg_constraint k join tbl on tbl.oid = k.conrelid, a where k.contype <> 'n' and k.conname::text <> all (a.names)
--       union all
--       select 'other', 'on Batch A''s table, not Batch A''s: trigger ' || t.tgname || ' on ' || t.tgrelid::regclass::text
--         from pg_trigger t join tbl on tbl.oid = t.tgrelid where not t.tgisinternal
--       union all
--       select 'other', 'on Batch A''s table, not Batch A''s: policy ' || p.polname
--         from pg_policy p join tbl on tbl.oid = p.polrelid where p.polname not in ('grade_return_read', 'student_card_read')
--       union all   -- 3. a function, in any schema, whose text (comments left out) names something of Batch A's
--       select case when p.oid in (select oid from theirs) then 'S0-M4b' when p.oid in (select oid from keyed) then 'S3-M1' else 'other' end,
--              'names Batch A: function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace, rx
--        where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
--          and p.oid not in (select oid from known) and exists (select 1 from fn union all select 1 from tbl union all select 1 from col)
--          and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~ rx.re
--       union all   -- 4. by name: a grade_return_... trigger that is not Batch A's, a grade_return_... table, anything else in fv_private
--       select case when t.tgfoid in (select oid from theirs) then 'S0-M4b' else 'other' end, 'trigger ' || t.tgname || ' on ' || t.tgrelid::regclass::text
--         from pg_trigger t, a where not t.tgisinternal and t.tgname like 'grade\_return\_%' and t.tgname::text <> all (a.trg)
--       union all
--       select case when c.oid = to_regclass('public.grade_return_repair_log') then 'S0-M4b' else 'other' end, 'table ' || c.oid::regclass::text
--         from pg_class c where c.relkind = 'r' and c.relname like 'grade\_return\_%'
--          and c.relnamespace in (to_regnamespace('public'), to_regnamespace('fv_private'), to_regnamespace('student_submit'))
--       union all
--       select 'other', 'in fv_private, not Batch A''s: ' || pg_describe_object(x.cls, x.oid, 0)
--         from (select 'pg_proc'::regclass as cls, oid from pg_proc where pronamespace = to_regnamespace('fv_private')
--               union all select 'pg_class'::regclass, oid from pg_class where relnamespace = to_regnamespace('fv_private')) x
--        where x.oid not in (select oid from fn)
--       union all   -- 4b. S3-M1's own: its key-id table, and a helper that names nothing of Batch A's
--       select 'S3-M1', 'table student_submit.card_key' where to_regclass('student_submit.card_key') is not null
--       union all
--       select 'S3-M1', 'function ' || x from a, unnest(a.m1) x
--        where to_regprocedure(x) is not null and x in ('student_submit._card_key_seen(text)', 'student_submit._as_teacher(uuid)')
--       union all   -- 5. a pg_cron job whose command names something of Batch A's
--       select case when j.jobname = 'fv_grade_return_repair_daily' then 'S0-M4b' else 'other' end, 'names Batch A: cron job ' || j.jobname
--         from cron.job j, rx where to_regclass('public.grade_return') is not null and j.command ~ rx.re
--   )
--   select 0 as n, case when exists (select 1 from found where whose = 'S0-M4b')
--                       then 'S0-M4b is applied on top of Batch A (' || (select count(distinct what) from found where whose = 'S0-M4b')
--                            || ' of its objects found): PART 2 will stop until s0-m4b-undo.sql has been run. Any row below is something ELSE that would stop PART 2.'
--                       else 'S0-M4b is not on top of Batch A. Any row below is something that would stop PART 2.' end as part_2
--   union all
--   select 0, case when exists (select 1 from found where whose = 'S3-M1')
--                  then 'S3-M1 is applied on top of Batch A (' || (select count(distinct what) from found where whose = 'S3-M1')
--                       || ' of its objects found): PART 2 will stop until s3-m1-undo.sql has been run.'
--                  else 'S3-M1 is not on top of Batch A.' end
--   union all
--   select distinct 1, what from found where whose = 'other'
--   order by 1, 2;
-- end precheck
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
--     migrations/, which is then the truth. (S0-M4b's row, name
--     grade_return_limits, is not among them: it goes with S0-M4b's undo.)
-- record:
--   delete from supabase_migrations.schema_migrations
--    where name in ('score_rows_same_class', 'grade_return', 'student_card', 'student_sessions_page');
-- end record
--   The idempotency rows (fv_idempotency) of Batch A's own calls: Return
--     Grades and the card calls. They stay, a few rows a day's use; nothing
--     reads them again once their functions are gone, and the 24-hour
--     cleanup takes them.
--   pg_cron. Batch A schedules nothing. (S0-M4b does; its undo unschedules.)
--
-- After PART 2 the four files apply again cleanly. batch_a_undo.py proves
-- all of the above on PostgreSQL 17.11 and 18.6, on databases built as
-- gradebook-prod is now (Batch A, then S0-M5, then S0-M4b, with S0-M4b's
-- own undo run where PART 2 needs it): the whole catalog compared line by line
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
--
-- course goes first: its trigger (grade_return_release) is the one that
-- returns every waiting draft when a class's Student Page is turned off or
-- the class leaves When I Return Them. With it gone first, no half-way
-- state of PART 1 can hand students drafts their teacher never returned.

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

-- What is left with grade_return in its name. S0-M4b (2026110905) is
-- applied, so this lists its three, which PART 1 leaves alone:
-- grade_return_mode on assessment, and grade_return_truncate on assessment
-- and on enrollment. PART 1 of migrations/local-test/s0-m4b-undo.sql drops
-- them and unschedules its nightly job. No rows: both fast stops are done.
select t.tgrelid::regclass::text as on_table, t.tgname as trigger_still_there,
       case when t.tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_update',
                              'grade_return_repoint', 'grade_return_gone', 'grade_return_release')
            then 'Batch A''s: PART 1 did not finish. Run it again.'
            else 'Not Batch A''s (S0-M4b, 2026110905, adds these): left alone. Its own undo removes it.' end as whose
  from pg_trigger t
 where not t.tgisinternal and t.tgname like 'grade\_return\_%'
 order by 1, 2;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1A: the Student Page off, for every class that has it on
-- ════════════════════════════════════════════════════════════════════════════
-- Only after both fast stops: PART 1 here, and PART 1 of
-- migrations/local-test/s0-m4b-undo.sql. This refuses and changes nothing
--   while one of Batch A's triggers is left: with grade_return_release
--     still on course, turning the page off would RETURN every waiting
--     draft to the students;
--   while S0-M4b's repair still runs by itself (its nightly job, or its
--     grade_return_mode trigger): it settles a grade saved since PART 1 as
--     a save would in the class as it is then, and with the page off that
--     is Returned, shown when the page comes back on.
-- The UPDATE carries the trigger conditions itself, so it cannot do either
-- even if it is pasted without the check above it. While its classes are
-- off, do not call public.grade_return_repair_nightly() by hand.
-- It answers with the classes it turned off. KEEP THAT LIST: nothing else
-- remembers which classes had the page on. To turn them on again:
--     update public.course set student_page_enabled = true where id in ('...', '...');
do $guard$
declare
    _left text;
    _job  boolean := false;
    _mode boolean;
begin
    if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.course') and attname = 'student_page_enabled' and not attisdropped) then
        raise exception 'course has no student_page_enabled: Batch A is not applied. Nothing was changed.';
    end if;
    select string_agg(t.tgname || ' on ' || t.tgrelid::regclass::text, ', ' order by t.tgrelid::regclass::text, t.tgname) into _left
      from pg_trigger t
     where not t.tgisinternal
       and t.tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_update',
                        'grade_return_repoint', 'grade_return_gone', 'grade_return_release');
    if _left is not null then
        raise exception 'Batch A''s triggers are not all gone (%). With grade_return_release in place, turning the Student Page off returns every waiting draft to the students. Run PART 1 until its last query lists none of Batch A''s triggers, then this. Nothing was changed.', _left;
    end if;
    -- S0-M4b's repair. (cron.job is pg_cron's own table, named only inside
    -- EXECUTE: it must not be planned where pg_cron is missing.)
    if to_regclass('cron.job') is not null then
        execute 'select exists (select 1 from cron.job where jobname = ''fv_grade_return_repair_daily'' and active)' into _job;
    end if;
    _mode := exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname = 'grade_return_mode');
    if _job or _mode then
        raise exception 'S0-M4b''s repair still runs by itself (%). It settles a grade saved since PART 1 as a save would in the class as it is then: with the Student Page off that is Returned, so a grade the teacher was holding is shown when the page comes back on. Run PART 1 of migrations/local-test/s0-m4b-undo.sql (it unschedules the job and drops S0-M4b''s three triggers), then this. Nothing was changed.',
            concat_ws(' and ', case when _job then 'the nightly job fv_grade_return_repair_daily is scheduled' end,
                               case when _mode then 'the trigger grade_return_mode is in place' end);
    end if;
end
$guard$;

update public.course
   set student_page_enabled = false
 where student_page_enabled
   and not exists (select 1 from pg_trigger t
                    where not t.tgisinternal
                      and t.tgname in ('grade_return_delete', 'grade_return_insert', 'grade_return_update',
                                       'grade_return_repoint', 'grade_return_gone', 'grade_return_release',
                                       'grade_return_mode'))
returning id, name;

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
    _strangers text;   -- S0-M4b's objects
    _keyed text;       -- S3-M1's objects
    _others text;      -- anything else
    _re text;
    _job record;
begin
    -- What else stands on Batch A. PART 2 knows what Batch A made: its 47
    -- functions and the 7 it patched (by signature), its four tables with
    -- their columns, indexes, constraints and policies, its three class
    -- settings, its 18 triggers and file 01's five policies. Anything else
    -- that depends on one of those, sits on one of its tables, or is a
    -- function whose text names one of them, stops PART 2 here, before
    -- anything is dropped, with the whole list. It knows S0-M4b's own
    -- objects too (2026110905, applied to gradebook-prod on 2026-11-10), and
    -- S3-M1's (2026111003, card codes the database cannot read), only to
    -- say which it has found: each has its own undo, which goes first.
    with a as (select
        string_to_array(   -- the 47 functions Batch A made
            'public.fv_owns_rubric_check_cell(uuid,uuid,uuid) public.fv_owns_rubric_score_cell(uuid,uuid,uuid) '
            'public.fv_owns_score_cell(uuid,uuid) public.fv_owns_tag_score_cell(uuid,uuid,uuid) '
            'student_submit._card_lookup(text,text) student_submit._card_refusal(uuid) student_submit._device_session(text) '
            'student_submit._midnight(text) student_submit._returned_grade(uuid,uuid) student_submit._session_class(text,uuid) '
            'student_submit._session_classes(uuid) student_submit.card(text,text) student_submit.done(text,text) '
            'student_submit.page(text,uuid,text) student_submit.seen(text,uuid,uuid[],text) '
            'student_submit.verify_card(text,text,text,text,text,text,boolean) fv_private.grade_return_remap(uuid,jsonb,jsonb) '
            'fv_private.restore_grade_returns(jsonb) public._cards_work_until(uuid) public._fv_date(text) public._fv_timezone(text) '
            'public._grade_copy(uuid,uuid) public._grade_copy_entry(integer,integer,text,text,boolean) '
            'public._grade_copy_in_use(jsonb,uuid) public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb) '
            'public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb) public._grade_return_apply(uuid,uuid,jsonb,jsonb) '
            'public._grade_return_gone() public._grade_return_holds(uuid) public._grade_return_lock(uuid) '
            'public._grade_return_lock_first(uuid) public._grade_return_on_change() public._grade_return_one(uuid,uuid,timestamptz) '
            'public._grade_return_release() public._grade_return_repoint() public._issue_student_card(uuid,text) '
            'public._student_card_json(uuid) public.course_draft_count(uuid) public.issue_student_cards(uuid,uuid[],uuid) '
            'public.list_course_grade_returns(uuid) public.list_student_cards(uuid) public.mark_student_cards_printed(uuid[],uuid) '
            'public.reissue_student_card(uuid,uuid) public.return_grades(uuid,uuid[],uuid) '
            'public.set_cards_work_until(uuid,date,uuid) public.unlock_all_student_cards(uuid,uuid) '
            'public.unlock_student_card(uuid,uuid)', ' ') as made,
        string_to_array(   -- the 7 it patched
            'public.update_course(uuid,jsonb) public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid) '
            'public.duplicate_course(uuid,uuid) public.import_json_restore(jsonb,uuid) '
            'public._issue_access_code(uuid,uuid,timestamptz) public._issue_report_code(uuid,uuid,timestamptz) '
            'student_submit.open(text,text)', ' ') as patched,
        string_to_array(   -- what S0-M4b (2026110905) made, to tell it from anything else
            'public._grade_return_settle(uuid,uuid) public._grade_return_repair_class(uuid) public._grade_return_repair_lost() '
            'public._grade_return_truncated() public._grade_return_mode_changed() public.grade_return_repair_nightly()', ' ') as m4b,
        string_to_array(   -- what S3-M1 (2026111003) made, to tell it from anything else: its functions,
            'student_submit._card_lookup(text,text,text) student_submit.card(text,text,text) '
            'student_submit.verify_card(text,text,text,text,text,text,text,boolean) '
            'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid) student_submit._as_teacher(uuid) '
            'student_submit._card_key_seen(text)', ' ') as m1,
        string_to_array(   -- and what it put on Batch A's student_card: columns, indexes, constraints
            'student_card.code_hmac student_card.pw_hmac student_card.key_id student_card.seq student_card_code_hmac_key '
            'student_card_enrollment_seq student_card_code_hmac_check student_card_pw_hmac_check student_card_key_id_check '
            'student_card_seq_check student_card_live_has_tag', ' ') as m1_on,
        array['grade_return_delete', 'grade_return_insert', 'grade_return_update', 'grade_return_repoint', 'grade_return_gone', 'grade_return_release'] as trg,
        string_to_array(   -- the columns of Batch A's four tables
            'grade_return.enrollment_id grade_return.assessment_id grade_return.is_draft grade_return.returned_at '
            'grade_return.returned_copy grade_return.previous_copy grade_return.updated_at grade_return.seen_at '
            'grade_return.working_copy student_card.id student_card.enrollment_id student_card.code student_card.code_hash '
            'student_card.salt student_card.created_at student_card.printed_at student_card.last_opened_at student_card.wrong_tries '
            'student_card.wrong_times student_card.locked_at student_card.stopped_at student_card.works_until student_card.password '
            'device_session.id device_session.token_hash device_session.created_at device_session.expires_at '
            'device_session_enrollment.session_id device_session_enrollment.enrollment_id device_session_enrollment.card_id '
            'device_session_enrollment.added_at', ' ') as cols,
        string_to_array(   -- their indexes and constraints
            'grade_return_assessment_idx grade_return_pkey student_card_code_hash_key student_card_enrollment_idx '
            'student_card_live_code student_card_one_live student_card_pkey device_session_expires device_session_pkey '
            'device_session_token_hash_key device_session_enrollment_card device_session_enrollment_enrollment '
            'device_session_enrollment_pkey grade_return_copy_while_draft grade_return_previous_copy_object '
            'grade_return_returned_copy_object grade_return_working_copy_object student_card_enrollment_id_fkey '
            'student_card_wrong_tries_check device_session_enrollment_card_id_fkey device_session_enrollment_enrollment_id_fkey '
            'device_session_enrollment_session_id_fkey', ' ') as names
    ), fn as (select to_regprocedure(x)::oid as oid from a, unnest(a.made) x where to_regprocedure(x) is not null
    ), known as (select oid from fn union select to_regprocedure(x)::oid from a, unnest(a.patched) x where to_regprocedure(x) is not null
    ), theirs as (select to_regprocedure(x)::oid as oid from a, unnest(a.m4b) x where to_regprocedure(x) is not null
    ), keyed as (select to_regprocedure(x)::oid as oid from a, unnest(a.m1) x where to_regprocedure(x) is not null
    ), tbl as (select to_regclass(x)::oid as oid
                 from unnest(array['public.grade_return', 'public.student_card', 'student_submit.device_session', 'student_submit.device_session_enrollment']) x
                where to_regclass(x) is not null
    ), col as (select attrelid, attnum from pg_attribute
                where attrelid = to_regclass('public.course') and not attisdropped and attname in ('student_page_enabled', 'return_grades', 'cards_work_until')
    ), rx as (   -- a function or cron job names Batch A if its text has one of these words
        select '\m(grade_return|student_card|device_session|device_session_enrollment|student_page_enabled|return_grades|cards_work_until|'
               || (select string_agg(distinct split_part(split_part(x, '(', 1), '.', 2), '|') from a, unnest(a.made) x
                    where split_part(split_part(x, '(', 1), '.', 2) not in ('card', 'done', 'page', 'seen'))
               || ')\M|student_submit\.(card|done|page|seen)\M' as re
    ), dep as (   -- what Postgres records as depending on a function, table or class setting of Batch A's, and the table it belongs to
        select d.classid, d.objid, d.objsubid, o.kind,
               case d.classid when 'pg_class'::regclass then coalesce((select indrelid from pg_index where indexrelid = d.objid), d.objid)
                              when 'pg_rewrite'::regclass then (select ev_class from pg_rewrite where oid = d.objid)
                              when 'pg_constraint'::regclass then (select nullif(conrelid, 0) from pg_constraint where oid = d.objid)
                              when 'pg_trigger'::regclass then (select tgrelid from pg_trigger where oid = d.objid)
                              when 'pg_policy'::regclass then (select polrelid from pg_policy where oid = d.objid)
                              when 'pg_attrdef'::regclass then (select adrelid from pg_attrdef where oid = d.objid)
                              when 'pg_type'::regclass then (select nullif(typrelid, 0) from pg_type where oid = d.objid) end as home,
               case d.classid when 'pg_trigger'::regclass then (select tgname::text from pg_trigger where oid = d.objid)
                              when 'pg_policy'::regclass then (select polname::text from pg_policy where oid = d.objid)
                              when 'pg_constraint'::regclass then (select conname::text from pg_constraint where oid = d.objid) end as name
          from pg_depend d
          join (select 'pg_proc'::regclass as cls, oid, null::int as sub, 'function' as kind from fn
                union all select 'pg_class'::regclass, oid, null, 'table' from tbl
                union all select 'pg_class'::regclass, attrelid, attnum, 'setting' from col) o
            on d.refclassid = o.cls and d.refobjid = o.oid and (o.sub is null or d.refobjsubid = o.sub)
         where d.deptype in ('n', 'a')
    )
    select string_agg(what, '; ' order by what) filter (where whose = 'S0-M4b'),
           string_agg(what, '; ' order by what) filter (where whose = 'S3-M1'),
           string_agg(what, '; ' order by what) filter (where whose = 'other'),
           max(what) filter (where whose = 'rx')
      into _strangers, _keyed, _others, _re
      from (
        -- 1. depends on something of Batch A's in Postgres's own record, and is not Batch A's
        select case when coalesce(d.home = to_regclass('public.grade_return_repair_log'), false) or (d.classid = 'pg_proc'::regclass and d.objid in (select oid from theirs))
                    then 'S0-M4b'
                    when d.classid = 'pg_proc'::regclass and d.objid in (select oid from keyed) then 'S3-M1' else 'other' end as whose,
               'depends on Batch A: ' || pg_describe_object(d.classid, d.objid, d.objsubid) as what
          from dep d, a
         where not (d.classid = 'pg_proc'::regclass and d.objid in (select oid from known))
           and not coalesce(d.home in (select oid from tbl), false)                                -- on one of its own tables: 2
           and not (d.classid = 'pg_constraint'::regclass and (select contype from pg_constraint where oid = d.objid) = 'n')   -- a column's own NOT NULL (Postgres 18)
           and not (d.kind = 'function' and d.classid = 'pg_policy'::regclass and coalesce(d.name like '%\_same\_class', false))   -- file 01's five policies
           and not (d.kind = 'function' and d.classid = 'pg_trigger'::regclass and coalesce(d.name = any (a.trg), false))          -- its 18 triggers
           and not (d.kind = 'setting' and coalesce(   (d.classid = 'pg_constraint'::regclass and d.name = 'course_return_grades_check')
                                                    or (d.classid = 'pg_attrdef'::regclass and d.home = to_regclass('public.course'))
                                                    or (d.classid = 'pg_trigger'::regclass and d.name = 'grade_return_release'), false))
        union all   -- 2. sits on one of Batch A's four tables and is not Batch A's
        select case when (c.relname || '.' || t.attname) = any (a.m1_on) then 'S3-M1' else 'other' end,
               'on Batch A''s table, not Batch A''s: column ' || c.relname || '.' || t.attname
          from pg_attribute t join tbl on tbl.oid = t.attrelid join pg_class c on c.oid = t.attrelid, a
         where t.attnum > 0 and not t.attisdropped and (c.relname || '.' || t.attname) <> all (a.cols)
        union all
        select case when c.relname::text = any (a.m1_on) then 'S3-M1' else 'other' end, 'on Batch A''s table, not Batch A''s: index ' || c.relname
          from pg_index i join tbl on tbl.oid = i.indrelid join pg_class c on c.oid = i.indexrelid, a where c.relname::text <> all (a.names)
        union all
        select case when k.conname::text = any (a.m1_on) then 'S3-M1' else 'other' end, 'on Batch A''s table, not Batch A''s: constraint ' || k.conname
          from pg_constraint k join tbl on tbl.oid = k.conrelid, a where k.contype <> 'n' and k.conname::text <> all (a.names)
        union all
        select 'other', 'on Batch A''s table, not Batch A''s: trigger ' || t.tgname || ' on ' || t.tgrelid::regclass::text
          from pg_trigger t join tbl on tbl.oid = t.tgrelid where not t.tgisinternal
        union all
        select 'other', 'on Batch A''s table, not Batch A''s: policy ' || p.polname
          from pg_policy p join tbl on tbl.oid = p.polrelid where p.polname not in ('grade_return_read', 'student_card_read')
        union all   -- 3. a function, in any schema, whose text (comments left out) names something of Batch A's
        select case when p.oid in (select oid from theirs) then 'S0-M4b' when p.oid in (select oid from keyed) then 'S3-M1' else 'other' end,
               'names Batch A: function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace, rx
         where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
           and p.oid not in (select oid from known) and exists (select 1 from fn union all select 1 from tbl union all select 1 from col)
           and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~ rx.re
        union all   -- 4. by name: a grade_return_... trigger that is not Batch A's, a grade_return_... table, anything else in fv_private
        select case when t.tgfoid in (select oid from theirs) then 'S0-M4b' else 'other' end, 'trigger ' || t.tgname || ' on ' || t.tgrelid::regclass::text
          from pg_trigger t, a where not t.tgisinternal and t.tgname like 'grade\_return\_%' and t.tgname::text <> all (a.trg)
        union all
        select case when c.oid = to_regclass('public.grade_return_repair_log') then 'S0-M4b' else 'other' end, 'table ' || c.oid::regclass::text
          from pg_class c where c.relkind = 'r' and c.relname like 'grade\_return\_%'
           and c.relnamespace in (to_regnamespace('public'), to_regnamespace('fv_private'), to_regnamespace('student_submit'))
        union all
        select 'other', 'in fv_private, not Batch A''s: ' || pg_describe_object(x.cls, x.oid, 0)
          from (select 'pg_proc'::regclass as cls, oid from pg_proc where pronamespace = to_regnamespace('fv_private')
                union all select 'pg_class'::regclass, oid from pg_class where relnamespace = to_regnamespace('fv_private')) x
         where x.oid not in (select oid from fn)
        union all   -- 4b. S3-M1's own: its key-id table, and a helper that names nothing of Batch A's
        select 'S3-M1', 'table student_submit.card_key' where to_regclass('student_submit.card_key') is not null
        union all
        select 'S3-M1', 'function ' || x from a, unnest(a.m1) x
         where to_regprocedure(x) is not null and x in ('student_submit._card_key_seen(text)', 'student_submit._as_teacher(uuid)')
        union all select 'rx', re from rx
      ) found;
    -- A pg_cron job whose command names something of Batch A's. (cron.job is
    -- named only inside EXECUTE: it must not be planned where it is missing.)
    if to_regclass('cron.job') is not null and to_regclass('public.grade_return') is not null then
        for _job in execute 'select jobname from cron.job where command ~ $1 order by 1' using _re loop
            if _job.jobname = 'fv_grade_return_repair_daily' then
                _strangers := concat_ws('; ', _strangers, 'names Batch A: cron job ' || _job.jobname);
            else
                _others := concat_ws('; ', _others, 'names Batch A: cron job ' || _job.jobname);
            end if;
        end loop;
    end if;
    if _keyed is not null or _strangers is not null or _others is not null then
        raise exception '%', coalesce('S3-M1 (2026111003_card_codes_keyed.sql) is applied on top of Batch A. Run S3-M1''s undo first (migrations/local-test/s3-m1-undo.sql), then this. Found of it: ' || _keyed || '. ', '')
            || coalesce('S0-M4b (2026110905_grade_return_limits.sql) is applied on top of Batch A. Run S0-M4b''s undo first (migrations/local-test/s0-m4b-undo.sql, both its parts), then this. Found of it: ' || _strangers || '. ', '')
            || coalesce('Something else stands on Batch A, and PART 2 would break it or lose it: ' || _others || '. ', '')
            || 'Nothing was changed.';
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
