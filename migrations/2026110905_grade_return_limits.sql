-- Closes three known limits of Batch A's grade_return, sends created_at on
-- the student's page, keeps seen_at from the teacher, and leaves DIBELS work
-- out of Draft and Returned (2026-11-10). S0-M4b.
--
-- Apply right after Batch A (2026110901 to 2026110904). The owner chose to
-- apply Batch A exactly as it was verified and close these behind it. The
-- file's first step stops it, with nothing changed, unless Batch A is in.
--
-- ── What was wrong (the last verify pass on Batch A named a, b and c) ───────
-- a. The repair did not add a missing row. Batch A's file 02 ends with two
--    statements that remove grade_return rows whose student or assessment is
--    gone and bring every row's working_copy up to date. A grade first given
--    with the triggers switched off (a superuser's session_replication_role
--    = replica) has no grade_return row at all, and neither statement made
--    one. Until the whole file was run again the student was shown nothing
--    for it, and the first save to it would be compared with "no grade".
-- b. A hand-made restore could leave a draft where no draft should be. A
--    payload with grade_returns but no courses row, restored into a class
--    on As Soon As I Save, kept the drafts it named: the step that returns
--    drafts in a class that does not hold grades looked only at the classes
--    the payload names. (It already locked every class the payload names a
--    grade or a state in.) The app always sends the class row.
-- c. Orphan rows could be left behind. grade_return has no foreign keys (on
--    purpose: 2026110902, 4); a trigger on enrollment and assessment deletes
--    its rows. A row trigger does not fire for TRUNCATE, nor for a delete
--    made with triggers switched off, so either left rows whose student or
--    assessment was gone. The two read RPCs skip them, but a teacher
--    selecting from the table directly saw them, until someone remembered to
--    run the repair.
-- d. (New, not a limit of Batch A.) The owner ruled on Nov 10 that on the
--    same date the piece made later counts as later. The student's page
--    works its numbers out from what student_submit.page sends, and page
--    did not send when each piece was made, so a student's page and the
--    teacher's report could order two same-date pieces differently.
-- e. (New: the owner's ruling of Nov 10.) FullVision records when a student
--    opens each returned piece (grade_return.seen_at) for the student's own
--    page only: "3 Things Since You Last Looked" and the Updated mark. It is
--    not shown to teachers, and it is kept only as long as the grade itself.
--    Batch A's list_course_grade_returns sent it to the teacher's browser.
-- f. (New: the owner's ruling 15, "DIBELS numbers show at once. A benchmark
--    is a reading record, not a grade that is returned.") A benchmark's
--    numbers are in dibels_score, which Batch A's triggers do not watch, so
--    the numbers were never held. But a DIBELS piece can still hold a row in
--    the score tables (an Overall Comment saved on it, or a grade from
--    before its scoring was changed to DIBELS), and Batch A treated that
--    like any grade: the backfill made a grade_return row for it, a save to
--    it made a Draft in a class that holds grades, the settings screen
--    counted the draft, and Return returned it.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. _grade_return_repair_class(p_course_id) and grade_return_repair():
--    the repair as functions. For one class, under the class's lock (its
--    course_sync_cursor row, as every writer of grade_return takes it):
--      rows whose student or assessment is gone are deleted;
--      a graded cell with no row gets one, exactly as a save through the
--        triggers would have left it (_grade_return_apply with no grade
--        before): a Draft in a class that holds grades, so the student is
--        still shown nothing until the teacher returns it; Returned at once
--        in any other class;
--      every other row's working_copy is brought up to date, as before.
--    grade_return_repair() does every class, then the rows with neither a
--    student nor an assessment left (no class to lock; nothing else can
--    reach such a row). It returns what it did:
--      { classes, orphans_removed, dibels_rows_removed, rows_added,
--        working_copies_fixed }.
--    This file runs it once, last. On a database where every write went
--    through the triggers it finds nothing to do.
-- 2. A trigger AFTER TRUNCATE on enrollment and on assessment
--    (grade_return_truncate) that removes every grade_return row left
--    without its student or assessment. TRUNCATE ... CASCADE from course or
--    student truncates enrollment and assessment too, and fires it.
-- 3. grade_return_repair_nightly(), a procedure, and one pg_cron job that
--    calls it once a day (fv_grade_return_repair_daily, 10:47 UTC, which is
--    2:47 or 3:47 in the morning in British Columbia). It is the thing that
--    runs without anyone remembering to: nothing can make a trigger fire
--    for a delete made with triggers switched off, so those orphans, and a
--    working copy such a write left behind, are put right within a day.
--    It commits after each class, so no class is locked for longer than its
--    own repair takes. The job is scheduled only if pg_cron is installed
--    and the job is not there yet, as 20260423_write_path_idempotency.sql
--    schedules its own. To stop it: select cron.unschedule('fv_grade_return_repair_daily');
-- 4. fv_private.restore_grade_returns (Batch A's helper for
--    import_json_restore), patched in place: the step that returns drafts in
--    a class that does not hold grades now covers every class the payload
--    names a grade or a state in, the same classes it locks.
-- 5. student_submit.page (Batch A's function), patched in place: each object
--    in assessments gains "created_at", the assessment's own created_at as
--    jsonb prints a timestamptz ("2026-11-10T16:04:11.482913+00:00"), the
--    same key and form get_class_bundle and get_gradebook send
--    (2026111001). Nothing else in the reply changes; v stays 1.
-- 6. list_course_grade_returns (Batch A's function), patched in place: it no
--    longer sends seen_at, and a row that holds nothing but a seen_at is
--    left out like any other row with nothing to say. Everything else it
--    sends is unchanged. The server still has seen_at and still uses it:
--    the triggers' "Updated only if the student had seen it" rule
--    (2026110902, 4) reads the row, not the list, and student_submit.page
--    still sends a student their own seen_at. Two things follow for the
--    browser, neither of which this file can do: a backup made from the
--    list no longer carries seen_at, so a restore starts "since you last
--    looked" afresh; and the browser's own copy of the rule
--    (shared/grade-state.js) can no longer tell whether a student had seen
--    a grade, so after a save in an As Soon As I Save class it must take
--    previous_copy and updated_at from the server instead of working them
--    out.
-- 7. DIBELS work (assessment.score_mode = 'dibels') has no Draft and no
--    Returned: no grade_return row at all.
--      _grade_return_on_change (Batch A's trigger function on the four score
--        tables), patched in place: a save to a DIBELS piece makes no row
--        and changes none.
--      A trigger on assessment (grade_return_mode) for a piece whose scoring
--        is changed. To DIBELS: its grade_return rows are removed. From
--        DIBELS: each graded cell gets the row a save would have left (a
--        Draft in a class that holds grades, Returned at once in any other).
--        So a piece changed to DIBELS and back starts again: in a class that
--        holds grades its grades wait to be returned again.
--      return_grades, course_draft_count, list_course_grade_returns and
--        student_submit.seen, patched in place: each passes over a DIBELS
--        piece. A row that got there with the triggers switched off is not
--        returned, counted, listed or marked as seen.
--      The restore's helper removes any row it made for a DIBELS piece.
--      The repair (1) removes any it finds and adds none. This file's last
--        statement is the repair, so it removes the rows Batch A's backfill
--        made for DIBELS pieces, and says how many (dibels_rows_removed).
--    No score, level, comment or DIBELS number changes, and dibels_score is
--    not touched.
--
-- No function this file adds can be called through the API: all are for the
-- database owner and the nightly job.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Applied straight after Batch A: one thing. Batch A's backfill has just
-- made a row for every graded cell, so the repair finds no orphan, no
-- missing row and no working copy to fix; it removes the grade_return rows
-- of DIBELS pieces (7), if there are any. To count them before applying
-- Batch A (no row comes back if there are none):
--   select x.tbl, count(*) as score_rows, count(distinct (x.enrollment_id, x.assessment_id)) as cells
--     from (select 'score' as tbl, enrollment_id, assessment_id from public.score
--            where value is not null or nullif(btrim(comment), '') is not null
--           union all select 'tag_score', enrollment_id, assessment_id from public.tag_score
--            where value is not null or nullif(btrim(comment), '') is not null
--           union all select 'rubric_score', enrollment_id, assessment_id from public.rubric_score
--            where value is not null or nullif(btrim(comment), '') is not null or nullif(btrim(beyond), '') is not null
--           union all select 'rubric_check_score', enrollment_id, assessment_id from public.rubric_check_score) x
--     join public.assessment a on a.id = x.assessment_id and a.score_mode = 'dibels'
--    group by x.tbl;
-- Later runs change only grade_return, and only as described in 1 and 7. No
-- score, level, comment or tick ever changes.
--
-- ── Guards ──────────────────────────────────────────────────────────────────
-- The seven functions patched in place are Batch A's own, so their expected
-- fingerprints are what Batch A's files create (md5 of pg_get_functiondef),
-- not something read from the live database:
--   fv_private.restore_grade_returns(jsonb)      c43618c73751e036a2735ad246b35966
--   student_submit.page(text,uuid,text)          7af33e2114372833d7ad7fb97b56ebae
--   public.list_course_grade_returns(uuid)       6ccab9528aef0c2d6ec8bea1964edf81
--   public._grade_return_on_change()             c24d422823677e947f9d595a91ac5b1d
--   public.return_grades(uuid,uuid[],uuid)       1a403efc836b8d28b0fb56baf7b0926e
--   public.course_draft_count(uuid)              bcdfdc2537478ebe69f14ed9a893d7ad
--   student_submit.seen(text,uuid,uuid[],text)   dd6c76bf02bc627abcef5134a677288f
-- Anything else stops the file, unless the function already carries this
-- file's patch (a second run).
--
-- Can be run again: every statement replaces what it made, and the job is
-- scheduled once.
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
    _def text;
begin
    if to_regclass('public.grade_return') is null
       or not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'grade_return' and column_name = 'working_copy')
       or to_regprocedure('student_submit.page(text,uuid,text)') is null
       or to_regprocedure('fv_private.restore_grade_returns(jsonb)') is null then
        raise exception 'apply Batch A (2026110901 to 2026110904) first. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            ('fv_private.restore_grade_returns(jsonb)', 'c43618c73751e036a2735ad246b35966', '(2026110905)'),
            ('student_submit.page(text,uuid,text)',     '7af33e2114372833d7ad7fb97b56ebae', $s$'created_at', a.created_at$s$),
            ('public.list_course_grade_returns(uuid)',  '6ccab9528aef0c2d6ec8bea1964edf81', '(2026110905)'),
            ('public._grade_return_on_change()',        'c24d422823677e947f9d595a91ac5b1d', '(2026110905)'),
            ('public.return_grades(uuid,uuid[],uuid)',  '1a403efc836b8d28b0fb56baf7b0926e', '(2026110905)'),
            ('public.course_draft_count(uuid)',         'bcdfdc2537478ebe69f14ed9a893d7ad', '(2026110905)'),
            ('student_submit.seen(text,uuid,uuid[],text)', 'dd6c76bf02bc627abcef5134a677288f', '(2026110905)')
        ) as v(fn, was, mark)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        if position(_f.mark in _def) = 0 and md5(_def) <> _f.was then
            raise exception '% is not the definition this migration was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, md5(_def), _f.was;
        end if;
    end loop;
    perform 'public._grade_return_lock(uuid)'::regprocedure, 'public._grade_copy(uuid,uuid)'::regprocedure,
            'public._grade_return_apply(uuid,uuid,jsonb,jsonb)'::regprocedure;
end
$guard$;

-- ── 1. The repair, one class at a time ──────────────────────────────────────
create or replace function public._grade_return_repair_class(p_course_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _orphans integer := 0;
    _dibels  integer := 0;
    _added   integer := 0;
    _fixed   integer := 0;
    _c       record;
    _now     jsonb;
begin
    -- The class's lock first: grade_return is written only under it.
    perform _grade_return_lock(p_course_id);

    -- A DIBELS benchmark is a reading record, not a grade that is returned:
    -- it has no row.
    delete from grade_return g
     using assessment a
     where a.id = g.assessment_id and a.course_id = p_course_id and a.score_mode = 'dibels';
    get diagnostics _dibels = row_count;

    -- Rows whose student or assessment is gone. The one that is left says
    -- which class the row was in.
    delete from grade_return g
     where (exists (select 1 from enrollment e where e.id = g.enrollment_id and e.course_id = p_course_id)
            and not exists (select 1 from assessment a where a.id = g.assessment_id))
        or (exists (select 1 from assessment a where a.id = g.assessment_id and a.course_id = p_course_id)
            and not exists (select 1 from enrollment e where e.id = g.enrollment_id));
    get diagnostics _orphans = row_count;

    -- A graded cell with no row (a grade first given with the triggers
    -- off): what a save through the triggers would have left.
    for _c in
        select distinct x.enrollment_id, x.assessment_id
          from (select enrollment_id, assessment_id from score
                union all select enrollment_id, assessment_id from tag_score
                union all select enrollment_id, assessment_id from rubric_score
                union all select enrollment_id, assessment_id from rubric_check_score) x
          join enrollment e on e.id = x.enrollment_id and e.course_id = p_course_id
          join assessment a on a.id = x.assessment_id and a.course_id = p_course_id and a.score_mode <> 'dibels'
         where not exists (select 1 from grade_return g
                            where g.enrollment_id = x.enrollment_id and g.assessment_id = x.assessment_id)
         order by 1, 2
    loop
        _now := _grade_copy(_c.enrollment_id, _c.assessment_id);
        continue when _now is null;   -- a status or a Note for the Report alone is not a grade
        perform _grade_return_apply(_c.enrollment_id, _c.assessment_id, null, _now);
        update grade_return set working_copy = _now
         where enrollment_id = _c.enrollment_id and assessment_id = _c.assessment_id;
        _added := _added + 1;
    end loop;

    -- Every other row: the working copy the next save is compared with.
    update grade_return g
       set working_copy = _grade_copy(g.enrollment_id, g.assessment_id)
      from enrollment e
     where e.id = g.enrollment_id and e.course_id = p_course_id
       and exists (select 1 from assessment a where a.id = g.assessment_id)
       and g.working_copy is distinct from _grade_copy(g.enrollment_id, g.assessment_id);
    get diagnostics _fixed = row_count;

    return jsonb_build_object('orphans_removed', _orphans, 'dibels_rows_removed', _dibels,
                              'rows_added', _added, 'working_copies_fixed', _fixed);
end;
$function$;
revoke all on function public._grade_return_repair_class(uuid) from public, anon, authenticated;

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
revoke all on function public._grade_return_repair_lost() from public, anon, authenticated;

-- Every class, in one transaction. For the database owner, at any time.
create or replace function public.grade_return_repair()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _course  uuid;
    _r       jsonb;
    _classes integer := 0;
    _orphans integer := 0;
    _dibels  integer := 0;
    _added   integer := 0;
    _fixed   integer := 0;
begin
    for _course in select c.id from course c order by c.id loop
        _r := _grade_return_repair_class(_course);
        _classes := _classes + 1;
        _orphans := _orphans + (_r->>'orphans_removed')::int;
        _dibels  := _dibels  + (_r->>'dibels_rows_removed')::int;
        _added   := _added   + (_r->>'rows_added')::int;
        _fixed   := _fixed   + (_r->>'working_copies_fixed')::int;
    end loop;
    _orphans := _orphans + _grade_return_repair_lost();
    return jsonb_build_object('classes', _classes, 'orphans_removed', _orphans, 'dibels_rows_removed', _dibels,
                              'rows_added', _added, 'working_copies_fixed', _fixed);
end;
$function$;
revoke all on function public.grade_return_repair() from public, anon, authenticated;

-- ── 2. TRUNCATE takes its grade_return rows too ─────────────────────────────
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
revoke all on function public._grade_return_truncated() from public, anon, authenticated;
drop trigger if exists grade_return_truncate on public.enrollment;
create trigger grade_return_truncate after truncate on public.enrollment
    for each statement execute function public._grade_return_truncated();
drop trigger if exists grade_return_truncate on public.assessment;
create trigger grade_return_truncate after truncate on public.assessment
    for each statement execute function public._grade_return_truncated();

-- ── 2b. A piece's scoring is changed to DIBELS, or from it ──────────────────
-- Under the class's lock, like every other write to grade_return. To
-- DIBELS: the piece's rows go. From DIBELS: each graded cell gets the row a
-- save through the triggers would have left, as the repair adds one.
create or replace function public._grade_return_mode_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _e   uuid;
    _now jsonb;
begin
    -- import_json_restore sets the state itself when its rows are in.
    if current_setting('fv.restoring', true) = 'on' then return null; end if;
    perform _grade_return_lock(new.course_id);
    if new.score_mode = 'dibels' then
        delete from grade_return where assessment_id = new.id;
        return null;
    end if;
    for _e in
        select distinct x.enrollment_id
          from (select enrollment_id from score where assessment_id = new.id
                union all select enrollment_id from tag_score where assessment_id = new.id
                union all select enrollment_id from rubric_score where assessment_id = new.id
                union all select enrollment_id from rubric_check_score where assessment_id = new.id) x
          join enrollment e on e.id = x.enrollment_id and e.course_id = new.course_id
         where not exists (select 1 from grade_return g
                            where g.enrollment_id = x.enrollment_id and g.assessment_id = new.id)
         order by 1
    loop
        _now := _grade_copy(_e, new.id);
        continue when _now is null;
        perform _grade_return_apply(_e, new.id, null, _now);
        update grade_return set working_copy = _now
         where enrollment_id = _e and assessment_id = new.id;
    end loop;
    return null;
end;
$function$;
revoke all on function public._grade_return_mode_changed() from public, anon, authenticated;
drop trigger if exists grade_return_mode on public.assessment;
create trigger grade_return_mode
    after update of score_mode on public.assessment
    for each row
    when (old.score_mode is distinct from new.score_mode and (old.score_mode = 'dibels' or new.score_mode = 'dibels'))
    execute function public._grade_return_mode_changed();

-- ── 3. Once a day, without anyone remembering to ────────────────────────────
-- A procedure, so it can commit after each class: a class is locked only
-- while its own repair runs. (A procedure that commits can have neither
-- SECURITY DEFINER nor a search_path of its own, so every name in it is
-- schema-qualified; it runs as whoever calls it, which is the job's owner.)
create or replace procedure public.grade_return_repair_nightly()
 language plpgsql
as $procedure$
declare
    _course uuid;
begin
    for _course in select c.id from public.course c order by c.id loop
        perform public._grade_return_repair_class(_course);
        commit;
    end loop;
    perform public._grade_return_repair_lost();
    commit;
end;
$procedure$;
revoke all on procedure public.grade_return_repair_nightly() from public, anon, authenticated;

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

-- ── 4 to 7. Batch A's functions, patched in place ───────────────────────────
do $patch$
declare
    _edits text[][] := array[
      -- function, text only this edit leaves behind, text to find (exactly once), replacement
      array['fv_private.restore_grade_returns(jsonb)',
            '(2026110905)',
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
      array['fv_private.restore_grade_returns(jsonb)',
            $s$a.score_mode = 'dibels' and g.assessment_id = any (_as)$s$,
$s$    -- And the working copy the next save to each is compared with.$s$,
$s$    -- A DIBELS benchmark has no Draft or Returned: no row (2026110905).
    delete from grade_return g
     using assessment a
     where a.id = g.assessment_id and a.score_mode = 'dibels' and g.assessment_id = any (_as);

    -- And the working copy the next save to each is compared with.$s$],
      array['student_submit.page(text,uuid,text)',
            $s$'created_at', a.created_at$s$,
            $s$'rubric_id', a.rubric_id,$s$,
            $s$'rubric_id', a.rubric_id, 'created_at', a.created_at,$s$],
      array['public.list_course_grade_returns(uuid)',
            '(2026110905)',
            $s$'seen_at', g.seen_at, 'returned_copy', g.returned_copy,$s$,
            $s$'returned_copy', g.returned_copy,$s$],
      array['public.list_course_grade_returns(uuid)',
            '(2026110905)',
$s$               -- a row with nothing to say (a grade cleared, a save in flight) is left out
               and (g.is_draft or g.returned_at is not null or g.seen_at is not null)$s$,
$s$               -- a row with nothing to say (a grade cleared, a save in flight) is left out.
               -- seen_at is the student's own and is not sent to the teacher, and a DIBELS
               -- benchmark is not a grade that is returned (2026110905).
               and (g.is_draft or g.returned_at is not null)
               and a.score_mode <> 'dibels'$s$],
      array['public._grade_return_on_change()',
            '(2026110905)',
$s$        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id);$s$,
$s$        -- Or it is a DIBELS benchmark: a reading record, not a grade that is
        -- returned. A save to it makes no row and changes none (2026110905).
        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id and a.score_mode <> 'dibels');$s$],
      array['public.return_grades(uuid,uuid[],uuid)',
            '(2026110905)',
$s$           and e.course_id = _course
           and g.is_draft
         order by g.enrollment_id$s$,
$s$           and e.course_id = _course
           and g.is_draft
           -- a DIBELS benchmark is not a grade that is returned (2026110905)
           and not exists (select 1 from assessment a where a.id = g.assessment_id and a.score_mode = 'dibels')
         order by g.enrollment_id$s$],
      array['public.course_draft_count(uuid)',
            '(2026110905)',
$s$     where e.course_id = p_course_id and g.is_draft;$s$,
$s$     where e.course_id = p_course_id and g.is_draft
       -- a DIBELS benchmark is not a grade that is returned (2026110905)
       and a.score_mode <> 'dibels';$s$],
      array['student_submit.seen(text,uuid,uuid[],text)',
            '(2026110905)',
$s$     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid$s$,
$s$     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid
       -- a DIBELS benchmark is a reading record: nothing is returned, so nothing is seen (2026110905)
       and a.score_mode <> 'dibels'$s$]
    ];
    _def  text;
    _hits int;
    i     int;
begin
    for i in 1 .. array_length(_edits, 1) loop
        _def := pg_get_functiondef(_edits[i][1]::regprocedure);
        continue when position(_edits[i][2] in _def) > 0;  -- a second run
        _hits := (length(_def) - length(replace(_def, _edits[i][3], ''))) / length(_edits[i][3]);
        if _hits <> 1 then
            raise exception '% has % matches for the text this migration patches, expected 1', _edits[i][1], _hits;
        end if;
        execute replace(_def, _edits[i][3], _edits[i][4]);
    end loop;
end
$patch$;

-- ── Last: the repair, once ──────────────────────────────────────────────────
select public.grade_return_repair();

commit;
