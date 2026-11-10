-- Closes three known limits of Batch A's grade_return, sends created_at on
-- the student's page, and keeps seen_at from the teacher (2026-11-10). S0-M4b.
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
--      { classes, orphans_removed, rows_added, working_copies_fixed }.
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
--
-- No function this file adds can be called through the API: all are for the
-- database owner and the nightly job.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Applied straight after Batch A: nothing. Batch A's backfill has just made
-- a row for every graded cell, so the repair finds no orphan, no missing
-- row and no working copy to fix. Later runs change only grade_return, and
-- only as described in 1. No score, level, comment or tick ever changes.
--
-- ── Guards ──────────────────────────────────────────────────────────────────
-- The three functions patched in place are Batch A's own, so their expected
-- fingerprints are what Batch A's files create (md5 of pg_get_functiondef),
-- not something read from the live database:
--   fv_private.restore_grade_returns(jsonb)   c43618c73751e036a2735ad246b35966
--   student_submit.page(text,uuid,text)       7af33e2114372833d7ad7fb97b56ebae
--   public.list_course_grade_returns(uuid)    6ccab9528aef0c2d6ec8bea1964edf81
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
            ('public.list_course_grade_returns(uuid)',  '6ccab9528aef0c2d6ec8bea1964edf81', '(2026110905)')
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
    _added   integer := 0;
    _fixed   integer := 0;
    _c       record;
    _now     jsonb;
begin
    -- The class's lock first: grade_return is written only under it.
    perform _grade_return_lock(p_course_id);

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
          join assessment a on a.id = x.assessment_id and a.course_id = p_course_id
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

    return jsonb_build_object('orphans_removed', _orphans, 'rows_added', _added, 'working_copies_fixed', _fixed);
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
    _added   integer := 0;
    _fixed   integer := 0;
begin
    for _course in select c.id from course c order by c.id loop
        _r := _grade_return_repair_class(_course);
        _classes := _classes + 1;
        _orphans := _orphans + (_r->>'orphans_removed')::int;
        _added   := _added   + (_r->>'rows_added')::int;
        _fixed   := _fixed   + (_r->>'working_copies_fixed')::int;
    end loop;
    _orphans := _orphans + _grade_return_repair_lost();
    return jsonb_build_object('classes', _classes, 'orphans_removed', _orphans,
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

-- ── 4, 5 and 6. The restore's helper, the student's page and the teacher's list, patched in place ──
do $patch$
declare
    _edits text[][] := array[
      -- function, a line only the patch adds, text to find (exactly once), replacement
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
               -- seen_at is the student's own and is not sent to the teacher (2026110905).
               and (g.is_draft or g.returned_at is not null)$s$]
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
