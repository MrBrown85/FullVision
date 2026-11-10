-- Closes three known limits of Batch A's grade_return, sends created_at on
-- the student's page, keeps seen_at from the teacher, and leaves DIBELS work
-- out of Draft and Returned (2026-11-10). S0-M4b.
--
-- Apply after Batch A (2026110901 to 2026110904). The file's first step
-- stops it, with nothing changed, unless Batch A is in and each of Batch A's
-- functions it patches is exactly as Batch A made it (or exactly as this
-- file leaves it: then the patch is skipped).
--
-- WHEN TO APPLY: at a quiet time, and not at 03:17 UTC (the retention purge
-- deletes whole classes then) nor at 10:47 UTC (this file's own nightly
-- job). It needs a short lock on enrollment and on assessment to add its
-- triggers; if a long transaction holds either it gives up after five
-- seconds with nothing applied, and can simply be run again.
--
-- WHAT YOU SEE WHEN IT IS PASTED: no rows, and no error. It does not run
-- the repair. To run the repair once by hand afterwards (the nightly job
-- does the same every night, so this is optional), run this as a statement
-- of its own, not inside begin/commit:
--     call public.grade_return_repair_nightly();
-- It returns nothing when every class was repaired, and ends with an error
-- naming how many classes it could not do if any failed (the rest are done
-- and kept). What failed is in public.grade_return_repair_log.
--
-- ── What was wrong (the last verify pass on Batch A named a, b and c) ───────
-- a. The repair did not add a missing row. Batch A's file 02 ends with two
--    statements that remove grade_return rows whose student or assessment is
--    gone and bring every row's working_copy up to date. A grade first given
--    with the triggers switched off (a superuser's session_replication_role
--    = replica) was left neither Draft nor Returned: with no row at all, or
--    with the empty row a student left by opening the piece, or a teacher
--    left by clearing it. The student was shown nothing for it and Return
--    did nothing.
-- b. A hand-made restore could leave a draft where no draft should be. A
--    payload with grade_returns but no courses row, restored into a class
--    on As Soon As I Save, kept the drafts it named: the step that returns
--    drafts in a class that does not hold grades looked only at the classes
--    the payload names. The app always sends the class row.
-- c. Orphan rows could be left behind. grade_return has no foreign keys (on
--    purpose: 2026110902, 4); a trigger on enrollment and assessment deletes
--    its rows. A row trigger does not fire for TRUNCATE, nor for a delete
--    made with triggers switched off, so either left rows whose student or
--    assessment was gone, for a direct read of the table to find.
-- d. (The owner's ruling of Nov 10.) On the same date the piece made later
--    counts as later. student_submit.page did not send when each piece was
--    made, so the student's page could not order two same-date pieces as
--    the teacher's reports do.
-- e. (The owner's ruling of Nov 10.) When a student opened a piece
--    (grade_return.seen_at) is for the student's own page only. Batch A's
--    list_course_grade_returns sent it to the teacher's browser.
-- f. (The owner's ruling 15: "DIBELS numbers show at once. A benchmark is a
--    reading record, not a grade that is returned.") A benchmark's numbers
--    are in dibels_score, which Batch A's triggers do not watch. But a
--    DIBELS piece can hold a row in the score tables (an Overall Comment
--    saved on it, or a grade from before its scoring was changed to
--    DIBELS), and Batch A treated that like any grade: a comment saved in a
--    class that holds grades became a Draft, the settings screen counted
--    it, and Return returned it.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. The repair, one class at a time: _grade_return_repair_class(course).
--    Under the class's lock (its course_sync_cursor row, as every writer of
--    grade_return takes it; taken with the lock that waits again if it is
--    picked as a deadlock victim while waiting):
--      rows whose student or assessment is gone are deleted;
--      then every cell of the class that has a grade in the score tables or
--      a row in grade_return is settled by the rule a save follows
--      (_grade_return_settle): the working copy the row holds is compared
--      with the grade as it is now, and if they differ the row is made or
--      changed exactly as a save of that change would have left it
--      (_grade_return_apply), and holds the new working copy.
--    So it decides from the scores and from what the row holds, not from
--    whether a row exists. A grade first written with the triggers off is a
--    Draft in a class that holds grades (the student is still shown nothing
--    until it is returned) and Returned at once in any other. A returned
--    grade changed with the triggers off becomes a draft of that change in
--    a class that holds grades: the student keeps the grade they were
--    given. It returns { orphans_removed, rows_added, rows_settled }.
--    A class that was deleted as the repair reached it has nothing to do.
--    There is no function that repairs every class in one transaction: one
--    transaction holding many classes' locks deadlocks with a delete that
--    spans two classes (a student enrolled in two; the retention purge).
-- 2. A trigger AFTER TRUNCATE on enrollment and on assessment
--    (grade_return_truncate) that removes every grade_return row left
--    without its student or assessment.
-- 3. grade_return_repair_nightly(), a procedure, and one pg_cron job that
--    calls it once a day (fv_grade_return_repair_daily, 10:47 UTC, which is
--    2:47 or 3:47 in the morning in British Columbia). For each class in
--    turn it runs the repair and commits, so it never holds more than one
--    class's lock. A class whose repair fails (a lock it could not get, any
--    other error) is written to public.grade_return_repair_log (when, which
--    class, the error) and the procedure goes on to the next class. If any
--    class failed it ends with an error saying how many, after everything
--    else is committed, so pg_cron's own record of the run
--    (cron.job_run_details) shows it failed. To read what failed:
--      select * from public.grade_return_repair_log order by at desc;
--    Rows older than 90 days are removed by the procedure. The job is
--    scheduled only if pg_cron is installed and the job is not there yet.
--    To stop it: select cron.unschedule('fv_grade_return_repair_daily');
-- 4. fv_private.restore_grade_returns (Batch A's helper for
--    import_json_restore), patched in place: the step that returns drafts in
--    a class that does not hold grades covers every class the payload names
--    a grade or a state in, the same classes it locks.
-- 5. student_submit.page (Batch A's), patched in place: each object in
--    assessments gains "created_at", the assessment's own, as jsonb prints a
--    timestamptz ("2026-11-10T16:04:11.482913+00:00"), the key and form
--    get_class_bundle and get_gradebook send (2026111001). v stays 1. (The
--    edge function has its own list of keys it passes on and does not pass
--    this one yet: students get it when that list is extended.)
-- 6. list_course_grade_returns (Batch A's), patched in place: it no longer
--    sends seen_at, and a row that holds nothing but a seen_at is left out.
--    The server still has seen_at and still uses it; student_submit.page
--    still sends a student their own.
-- 7. DIBELS work (assessment.score_mode = 'dibels') has no Draft and no
--    Returned. Its grade_return rows, if it has any, are DORMANT: kept, and
--    read or written by nothing, for as long as the piece is DIBELS.
--      _grade_return_on_change (Batch A's trigger function on the four score
--        tables), patched: a save to a DIBELS piece makes no row and changes
--        none.
--      return_grades, course_draft_count, list_course_grade_returns,
--        student_submit.seen and student_submit._returned_grade (so
--        student_submit.page), patched: each passes over a DIBELS piece.
--        Nothing counts, lists, returns, marks as seen or shows a student a
--        dormant row. page still lists the piece itself, with no grade.
--      The repair (1) leaves a DIBELS piece's rows alone and adds none.
--      A trigger on assessment (grade_return_mode) for a piece whose scoring
--        is changed FROM DIBELS: every cell of the piece is settled by the
--        same rule the repair uses. A cell whose grade is as it was when
--        the piece became DIBELS has its row exactly as it was: its state,
--        its returned copy, when the student saw it. A grade changed while
--        the piece was DIBELS is treated as that change saved now: in a
--        class that holds grades the student keeps the grade they were
--        given and the difference waits as a draft; in any other class it
--        is returned at once, and marked Updated if the student had seen
--        the earlier one. A cell first graded while it was DIBELS gets the
--        row a first save would leave. Changing a piece TO DIBELS touches
--        nothing.
--    One thing a dormant row is not kept from: when a class stops holding
--    grades, Batch A returns every draft in the class, dormant ones too.
--    Nothing shows that while the piece is DIBELS, and if it is changed
--    back the grade is Returned, as every grade in such a class is.
--    During an import_json_restore the trigger stands aside, as Batch A's
--    do; a hand-made restore that changes a piece from DIBELS leaves the
--    cells it does not name to the nightly repair.
--
-- Who can run what this file adds: the database owner, and so the nightly
-- job. Teachers (authenticated), anon and the service role are refused all
-- of it, and cannot read or write the log table.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing, when it is applied. It runs no repair and removes no row; the
-- rows Batch A's backfill made for DIBELS pieces, if there are any, stay
-- and are dormant. Afterwards the repair and the trigger change only
-- grade_return, and only as 1 and 7 say. No score, level, comment, tick or
-- DIBELS number ever changes.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- The eight functions patched in place are Batch A's own, so the
-- fingerprints are of what Batch A's files create and of what this file
-- makes of them (md5 of pg_get_functiondef), not read from the live
-- database. Each must be exactly one or the other:
--   function                                     as Batch A made it                as this file leaves it
--   fv_private.restore_grade_returns(jsonb)      c43618c73751e036a2735ad246b35966  66501afe2d758a938cfc8f1d4fc13a92
--   student_submit.page(text,uuid,text)          7af33e2114372833d7ad7fb97b56ebae  e744f2a27bcfd6fef662bbddeb9659c7
--   public.list_course_grade_returns(uuid)       6ccab9528aef0c2d6ec8bea1964edf81  bc5529a69303cdfe8d91604388dc927a
--   public._grade_return_on_change()             c24d422823677e947f9d595a91ac5b1d  250d2d680daa2bd3b54cd041285f1696
--   public.return_grades(uuid,uuid[],uuid)       1a403efc836b8d28b0fb56baf7b0926e  7f38e838fd64a648e230ab232c5cce28
--   public.course_draft_count(uuid)              bcdfdc2537478ebe69f14ed9a893d7ad  65c23f8cbce58587ebd640c7f40e1e89
--   student_submit.seen(text,uuid,uuid[],text)   dd6c76bf02bc627abcef5134a677288f  74a9d8ec7adf0d056ccb8294eea716de
--   student_submit._returned_grade(uuid,uuid)    7f4b12e98f53293cde192abd8e6c18a4  21706ae9eec783107d9da24e52e1855a
-- A function that is neither (changed by hand, or by an earlier draft of
-- this file) stops the file with nothing changed.
--
-- Can be run again: a second run changes nothing, takes no stronger lock
-- than the first and schedules nothing more.
--
-- The way back is migrations/local-test/s0-m4b-undo.sql (not a migration).
--
-- One transaction: the file opens with begin and ends with commit, so it is
-- all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first.
begin;

-- Give up after five seconds rather than queue behind a long transaction and
-- hold every teacher's saves up behind this one. If it gives up, nothing is
-- applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    if to_regclass('public.grade_return') is null
       or not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'grade_return' and column_name = 'working_copy')
       or to_regprocedure('student_submit.page(text,uuid,text)') is null
       or to_regprocedure('student_submit._returned_grade(uuid,uuid)') is null
       or to_regprocedure('student_submit.seen(text,uuid,uuid[],text)') is null
       or to_regprocedure('fv_private.restore_grade_returns(jsonb)') is null
       or to_regprocedure('public._grade_return_on_change()') is null then
        raise exception 'apply Batch A (2026110901 to 2026110904) first. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            ('fv_private.restore_grade_returns(jsonb)',    'c43618c73751e036a2735ad246b35966', '66501afe2d758a938cfc8f1d4fc13a92'),
            ('student_submit.page(text,uuid,text)',        '7af33e2114372833d7ad7fb97b56ebae', 'e744f2a27bcfd6fef662bbddeb9659c7'),
            ('public.list_course_grade_returns(uuid)',     '6ccab9528aef0c2d6ec8bea1964edf81', 'bc5529a69303cdfe8d91604388dc927a'),
            ('public._grade_return_on_change()',           'c24d422823677e947f9d595a91ac5b1d', '250d2d680daa2bd3b54cd041285f1696'),
            ('public.return_grades(uuid,uuid[],uuid)',     '1a403efc836b8d28b0fb56baf7b0926e', '7f38e838fd64a648e230ab232c5cce28'),
            ('public.course_draft_count(uuid)',            'bcdfdc2537478ebe69f14ed9a893d7ad', '65c23f8cbce58587ebd640c7f40e1e89'),
            ('student_submit.seen(text,uuid,uuid[],text)', 'dd6c76bf02bc627abcef5134a677288f', '74a9d8ec7adf0d056ccb8294eea716de'),
            ('student_submit._returned_grade(uuid,uuid)',  '7f4b12e98f53293cde192abd8e6c18a4', '21706ae9eec783107d9da24e52e1855a')
        ) as v(fn, was, becomes)
    loop
        _md5 := md5(pg_get_functiondef(_f.fn::regprocedure));
        if _md5 <> _f.was and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (md5 %; expected % as Batch A made it, or % as this file leaves it). Nothing was changed.',
                _f.fn, _md5, _f.was, _f.becomes;
        end if;
    end loop;
    perform 'public._grade_return_lock(uuid)'::regprocedure, 'public._grade_return_lock_first(uuid)'::regprocedure,
            'public._grade_copy(uuid,uuid)'::regprocedure, 'public._grade_return_apply(uuid,uuid,jsonb,jsonb)'::regprocedure;
end
$guard$;

-- ── 1. One cell, settled by the rule a save follows ─────────────────────────
-- The caller holds the class's lock. The working copy the row holds (none,
-- if there is no row) against the grade as the score tables have it now; if
-- they differ, the row is made or changed as a save of that change would
-- have left it. Returns 0 when there was nothing to do, 1 when the cell had
-- no row, 2 when it had one.
create or replace function public._grade_return_settle(p_enrollment_id uuid, p_assessment_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _has    boolean;
    _before jsonb;
    _now    jsonb;
begin
    select true, g.working_copy into _has, _before
      from grade_return g
     where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id;
    _has := coalesce(_has, false);
    _now := _grade_copy(p_enrollment_id, p_assessment_id);
    if _now is not distinct from _before then
        return 0;
    end if;
    perform _grade_return_apply(p_enrollment_id, p_assessment_id, _before, _now);
    update grade_return set working_copy = _now
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    return case when _has then 2 else 1 end;
end;
$function$;
revoke all on function public._grade_return_settle(uuid, uuid) from public, anon, authenticated, service_role;

-- ── 2. The repair, one class ────────────────────────────────────────────────
create or replace function public._grade_return_repair_class(p_course_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _orphans integer := 0;
    _added   integer := 0;
    _settled integer := 0;
    _c       record;
    _did     integer;
begin
    -- The class's lock first: grade_return is written only under it. The
    -- lock that waits again if it is picked as a deadlock victim while it
    -- waits. A class deleted as this reaches it has nothing to repair (the
    -- lock's own row cannot be made for a class that is going).
    begin
        perform _grade_return_lock_first(p_course_id);
    exception when foreign_key_violation then
        return jsonb_build_object('orphans_removed', 0, 'rows_added', 0, 'rows_settled', 0);
    end;
    if not exists (select 1 from course c where c.id = p_course_id) then
        return jsonb_build_object('orphans_removed', 0, 'rows_added', 0, 'rows_settled', 0);
    end if;

    -- Rows whose student or assessment is gone. The one that is left says
    -- which class the row was in.
    delete from grade_return g
     where (exists (select 1 from enrollment e where e.id = g.enrollment_id and e.course_id = p_course_id)
            and not exists (select 1 from assessment a where a.id = g.assessment_id))
        or (exists (select 1 from assessment a where a.id = g.assessment_id and a.course_id = p_course_id)
            and not exists (select 1 from enrollment e where e.id = g.enrollment_id));
    get diagnostics _orphans = row_count;

    -- Every cell of the class with a grade or a row, on work that is not
    -- DIBELS (a DIBELS piece's rows are dormant, and it gets none).
    for _c in
        select x.enrollment_id, x.assessment_id
          from (select enrollment_id, assessment_id from score
                union all select enrollment_id, assessment_id from tag_score
                union all select enrollment_id, assessment_id from rubric_score
                union all select enrollment_id, assessment_id from rubric_check_score
                union all select enrollment_id, assessment_id from grade_return) x
          join enrollment e on e.id = x.enrollment_id and e.course_id = p_course_id
          join assessment a on a.id = x.assessment_id and a.course_id = p_course_id and a.score_mode <> 'dibels'
         group by x.enrollment_id, x.assessment_id
         order by 1, 2
    loop
        _did := _grade_return_settle(_c.enrollment_id, _c.assessment_id);
        if _did = 1 then _added := _added + 1; elsif _did = 2 then _settled := _settled + 1; end if;
    end loop;

    return jsonb_build_object('orphans_removed', _orphans, 'rows_added', _added, 'rows_settled', _settled);
end;
$function$;
revoke all on function public._grade_return_repair_class(uuid) from public, anon, authenticated, service_role;

-- Rows with neither a student nor an assessment left. There is no class to
-- lock, and nothing else can reach such a row.
create or replace function public._grade_return_repair_lost()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _n integer;
begin
    delete from grade_return g
     where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
       and not exists (select 1 from assessment a where a.id = g.assessment_id);
    get diagnostics _n = row_count;
    return _n;
end;
$function$;
revoke all on function public._grade_return_repair_lost() from public, anon, authenticated, service_role;

-- ── 3. TRUNCATE takes its grade_return rows too ─────────────────────────────
create or replace function public._grade_return_truncated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    delete from grade_return g
     where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
        or not exists (select 1 from assessment a where a.id = g.assessment_id);
    return null;
end;
$function$;
revoke all on function public._grade_return_truncated() from public, anon, authenticated, service_role;
-- CREATE OR REPLACE, not DROP and CREATE: a second run then takes the lock a
-- first run takes (it blocks writes to the table for an instant, not reads).
create or replace trigger grade_return_truncate after truncate on public.enrollment
    for each statement execute function public._grade_return_truncated();
create or replace trigger grade_return_truncate after truncate on public.assessment
    for each statement execute function public._grade_return_truncated();

-- ── 4. A piece's scoring is changed from DIBELS ─────────────────────────────
-- Its rows were dormant while it was DIBELS. Under the class's lock, every
-- cell of the piece that has a grade or a row is settled by the rule a save
-- follows, as the repair does it.
create or replace function public._grade_return_mode_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _e uuid;
begin
    -- import_json_restore sets the state itself when its rows are in.
    if current_setting('fv.restoring', true) = 'on' then return null; end if;
    perform _grade_return_lock(new.course_id);
    for _e in
        select x.enrollment_id
          from (select enrollment_id from score where assessment_id = new.id
                union all select enrollment_id from tag_score where assessment_id = new.id
                union all select enrollment_id from rubric_score where assessment_id = new.id
                union all select enrollment_id from rubric_check_score where assessment_id = new.id
                union all select enrollment_id from grade_return where assessment_id = new.id) x
          join enrollment e on e.id = x.enrollment_id and e.course_id = new.course_id
         group by x.enrollment_id
         order by 1
    loop
        perform _grade_return_settle(_e, new.id);
    end loop;
    return null;
end;
$function$;
revoke all on function public._grade_return_mode_changed() from public, anon, authenticated, service_role;
create or replace trigger grade_return_mode
    after update of score_mode on public.assessment
    for each row
    when (old.score_mode = 'dibels' and new.score_mode is distinct from 'dibels')
    execute function public._grade_return_mode_changed();

-- ── 5. Once a day, without anyone remembering to ────────────────────────────
-- What a night's run could not do, to be read the next day.
create table if not exists public.grade_return_repair_log (
    id        bigint generated always as identity primary key,
    at        timestamptz not null default now(),
    course_id uuid,                 -- the class whose repair failed; null for the step after the last class
    sqlstate  text not null,
    message   text not null
);
alter table public.grade_return_repair_log enable row level security;
revoke all on table public.grade_return_repair_log from public, anon, authenticated, service_role;
revoke all on sequence public.grade_return_repair_log_id_seq from public, anon, authenticated, service_role;
comment on table public.grade_return_repair_log is
    'What public.grade_return_repair_nightly() could not repair: one row per class per run that failed. Owner only. Rows older than 90 days are removed by the procedure.';

-- A procedure, so it can commit after each class: it never holds more than
-- one class's lock. (A procedure that commits can have neither SECURITY
-- DEFINER nor a search_path of its own, so every name in it is
-- schema-qualified; it runs as whoever calls it, which is the job's owner.)
-- A class that fails is recorded and the next one is done.
create or replace procedure public.grade_return_repair_nightly()
 language plpgsql
as $procedure$
declare
    _course uuid;
    _failed integer := 0;
    _state  text;
    _msg    text;
begin
    delete from public.grade_return_repair_log where at < now() - interval '90 days';
    commit;
    for _course in select c.id from public.course c order by c.id loop
        begin
            perform public._grade_return_repair_class(_course);
        exception when others then
            get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            insert into public.grade_return_repair_log (course_id, sqlstate, message) values (_course, _state, _msg);
            _failed := _failed + 1;
        end;
        commit;
    end loop;
    begin
        perform public._grade_return_repair_lost();
    exception when others then
        get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
        insert into public.grade_return_repair_log (course_id, sqlstate, message) values (null, _state, _msg);
        _failed := _failed + 1;
    end;
    commit;
    -- Everything above is committed. This only marks the run as failed, for
    -- whoever called it and for pg_cron's record of the job.
    if _failed > 0 then
        raise exception 'grade_return_repair_nightly: % part(s) of this run failed and were skipped; the rest is done. See public.grade_return_repair_log.', _failed;
    end if;
end;
$procedure$;
revoke all on procedure public.grade_return_repair_nightly() from public, anon, authenticated, service_role;

do $cron$
begin
    -- cron.job is pg_cron's own table: no pg_cron, no job. (Two steps: the
    -- inner test names cron.job, and must not be planned where it is missing.)
    if to_regclass('cron.job') is not null then
        if not exists (select 1 from cron.job where jobname = 'fv_grade_return_repair_daily') then
            perform cron.schedule('fv_grade_return_repair_daily', '47 10 * * *',
                                  'call public.grade_return_repair_nightly()');
        end if;
    end if;
end
$cron$;

-- ── 6. Batch A's functions, patched in place ────────────────────────────────
-- A function already as this file leaves it is skipped. One as Batch A made
-- it gets its edits, each of which must find its text exactly once, and
-- must then be exactly what this file expects, or the file stops.
do $patch$
declare
    _fns text[][] := array[
      -- function, md5 as Batch A made it, md5 as this file leaves it
      array['fv_private.restore_grade_returns(jsonb)',    'c43618c73751e036a2735ad246b35966', '66501afe2d758a938cfc8f1d4fc13a92'],
      array['student_submit.page(text,uuid,text)',        '7af33e2114372833d7ad7fb97b56ebae', 'e744f2a27bcfd6fef662bbddeb9659c7'],
      array['public.list_course_grade_returns(uuid)',     '6ccab9528aef0c2d6ec8bea1964edf81', 'bc5529a69303cdfe8d91604388dc927a'],
      array['public._grade_return_on_change()',           'c24d422823677e947f9d595a91ac5b1d', '250d2d680daa2bd3b54cd041285f1696'],
      array['public.return_grades(uuid,uuid[],uuid)',     '1a403efc836b8d28b0fb56baf7b0926e', '7f38e838fd64a648e230ab232c5cce28'],
      array['public.course_draft_count(uuid)',            'bcdfdc2537478ebe69f14ed9a893d7ad', '65c23f8cbce58587ebd640c7f40e1e89'],
      array['student_submit.seen(text,uuid,uuid[],text)', 'dd6c76bf02bc627abcef5134a677288f', '74a9d8ec7adf0d056ccb8294eea716de'],
      array['student_submit._returned_grade(uuid,uuid)',  '7f4b12e98f53293cde192abd8e6c18a4', '21706ae9eec783107d9da24e52e1855a']
    ];
    _edits text[][] := array[
      -- function, text to find (exactly once), replacement
      array['fv_private.restore_grade_returns(jsonb)',
$s$      where g.is_draft and c.teacher_id = (select auth.uid())
        and c.id::text in (select r->>'id' from jsonb_array_elements(
                case when jsonb_typeof(p_payload->'courses') = 'array' then p_payload->'courses' else '[]'::jsonb end) r)
        and not (c.student_page_enabled and c.return_grades is not distinct from 'on_return');$s$,
$s$      where g.is_draft and c.teacher_id = (select auth.uid())
        and (c.id::text in (select r->>'id' from jsonb_array_elements(
                 case when jsonb_typeof(p_payload->'courses') = 'array' then p_payload->'courses' else '[]'::jsonb end) r)
             -- or a class the payload names a grade or a state in (2026110905)
             or c.id in (select e2.course_id from enrollment e2 where e2.id = any (_es)))
        and not (c.student_page_enabled and c.return_grades is not distinct from 'on_return');$s$],
      array['student_submit.page(text,uuid,text)',
            $s$'rubric_id', a.rubric_id,$s$,
            $s$'rubric_id', a.rubric_id, 'created_at', a.created_at,$s$],
      array['public.list_course_grade_returns(uuid)',
            $s$'seen_at', g.seen_at, 'returned_copy', g.returned_copy,$s$,
            $s$'returned_copy', g.returned_copy,$s$],
      array['public.list_course_grade_returns(uuid)',
$s$               -- a row with nothing to say (a grade cleared, a save in flight) is left out
               and (g.is_draft or g.returned_at is not null or g.seen_at is not null)$s$,
$s$               -- a row with nothing to say (a grade cleared, a save in flight) is left out.
               -- seen_at is the student's own and is not sent to the teacher, and a DIBELS
               -- benchmark is not a grade that is returned (2026110905).
               and (g.is_draft or g.returned_at is not null)
               and a.score_mode <> 'dibels'$s$],
      array['public._grade_return_on_change()',
$s$        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id);$s$,
$s$        -- Or it is a DIBELS benchmark: a reading record, not a grade that is
        -- returned. A save to it makes no row and changes none (2026110905).
        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id and a.score_mode <> 'dibels');$s$],
      array['public.return_grades(uuid,uuid[],uuid)',
$s$           and e.course_id = _course
           and g.is_draft
         order by g.enrollment_id$s$,
$s$           and e.course_id = _course
           and g.is_draft
           -- a DIBELS benchmark is not a grade that is returned (2026110905)
           and not exists (select 1 from assessment a where a.id = g.assessment_id and a.score_mode = 'dibels')
         order by g.enrollment_id$s$],
      array['public.course_draft_count(uuid)',
$s$     where e.course_id = p_course_id and g.is_draft;$s$,
$s$     where e.course_id = p_course_id and g.is_draft
       -- a DIBELS benchmark is not a grade that is returned (2026110905)
       and a.score_mode <> 'dibels';$s$],
      array['student_submit.seen(text,uuid,uuid[],text)',
$s$     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid$s$,
$s$     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid
       -- a DIBELS benchmark is a reading record: nothing is returned, so nothing is seen (2026110905)
       and a.score_mode <> 'dibels'$s$],
      array['student_submit._returned_grade(uuid,uuid)',
$s$      left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id;$s$,
$s$      left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
           -- a DIBELS benchmark is a reading record, not a grade that is returned: a row it
           -- has from before it was DIBELS is not read (2026110905)
           and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels');$s$]
    ];
    _def  text;
    _hits int;
    f     int;
    i     int;
begin
    for f in 1 .. array_length(_fns, 1) loop
        _def := pg_get_functiondef(_fns[f][1]::regprocedure);
        continue when md5(_def) = _fns[f][3];   -- already as this file leaves it
        if md5(_def) <> _fns[f][2] then
            raise exception '% is not the definition this migration was written against', _fns[f][1];
        end if;
        for i in 1 .. array_length(_edits, 1) loop
            continue when _edits[i][1] <> _fns[f][1];
            _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
            if _hits <> 1 then
                raise exception '% has % matches for the text this migration patches, expected 1', _fns[f][1], _hits;
            end if;
            _def := replace(_def, _edits[i][2], _edits[i][3]);
        end loop;
        if md5(_def) <> _fns[f][3] then
            raise exception '% patched does not come out as this migration expects (md5 %, expected %)', _fns[f][1], md5(_def), _fns[f][3];
        end if;
        execute _def;
    end loop;
end
$patch$;

commit;
