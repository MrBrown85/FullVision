-- The way back from migrations/2026110905_grade_return_limits.sql (S0-M4b).
-- NOT a migration: it is kept under local-test/ so the drift check does not
-- wait for it to be applied. Run it only to take S0-M4b back out. It leaves
-- the database as Batch A's four files made it ("Batch A as applied").
-- Written by a script from the migration itself, so the edits it makes
-- backwards are the migration's own; tested by
-- migrations/local-test/grade_return_limits_undo.py.
--
-- Two parts, each one transaction with its checks first, each safe to run
-- again. Run the part you need, on its own.
--
-- PART 1, the fast stop. It stops everything of S0-M4b that runs by itself:
-- the nightly job is unscheduled and the three triggers are dropped (after
-- TRUNCATE on enrollment and on assessment; on a piece whose scoring is
-- changed from DIBELS). Nothing else changes. What that leaves:
--   - the repair no longer runs at night; it can still be called by hand
--     (call public.grade_return_repair_nightly(););
--   - TRUNCATE leaves orphan grade_return rows again, as with Batch A alone;
--   - DIBELS pieces still have no Draft or Returned, but a piece changed
--     back from DIBELS is no longer settled at once: its rows are as they
--     were when it became DIBELS until the repair is run by hand.
--
-- PART 2, the full removal. Batch A's eight functions are put back exactly
-- as Batch A made them, each by making this file's edits backwards and then
-- checked against its fingerprint from before; the three triggers, the six
-- functions, the job and the log table (with whatever it holds) are
-- dropped. It stops, with nothing changed, if any of the eight functions is
-- neither as S0-M4b leaves it nor as Batch A made it.
-- What comes back with Batch A alone:
--   - the three limits (a grade written with triggers off is not given a
--     row by Batch A's repair statements; a hand-made restore can leave a
--     draft in a class that does not hold grades; TRUNCATE leaves orphans);
--   - student_submit.page sends no created_at; the teacher's list sends
--     seen_at again;
--   - a DIBELS piece is treated like any grade again. Its rows wake as they
--     were when it became DIBELS. If a grade on such a piece was changed
--     while it was DIBELS, the row's working copy is behind until the next
--     save to that cell; this counts them (none, if no piece was changed
--     to DIBELS after it had grades):
--       select count(*) from grade_return g join assessment a on a.id = g.assessment_id
--        where a.score_mode = 'dibels'
--          and g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id);
-- NO PART CHANGES A ROW of grade_return or of any score table.
--
-- Batch A's own undo (migrations/local-test/batch-a-undo.sql) comes after
-- this one: run PART 2 here first.

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: the fast stop
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
do $cron$
begin
    -- cron.job is pg_cron's own table: no pg_cron, no job. (Two steps: the
    -- inner test names cron.job, and must not be planned where it is missing.)
    if to_regclass('cron.job') is not null then
        if exists (select 1 from cron.job where jobname = 'fv_grade_return_repair_daily') then
            perform cron.unschedule('fv_grade_return_repair_daily');
        end if;
    end if;
end
$cron$;
drop trigger if exists grade_return_mode on public.assessment;
drop trigger if exists grade_return_truncate on public.assessment;
drop trigger if exists grade_return_truncate on public.enrollment;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: the full removal, back to Batch A as applied
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            ('fv_private.restore_grade_returns(jsonb)', 'c43618c73751e036a2735ad246b35966', '66501afe2d758a938cfc8f1d4fc13a92'),
            ('student_submit.page(text,uuid,text)', '7af33e2114372833d7ad7fb97b56ebae', 'e744f2a27bcfd6fef662bbddeb9659c7'),
            ('public.list_course_grade_returns(uuid)', '6ccab9528aef0c2d6ec8bea1964edf81', 'bc5529a69303cdfe8d91604388dc927a'),
            ('public._grade_return_on_change()', 'c24d422823677e947f9d595a91ac5b1d', '250d2d680daa2bd3b54cd041285f1696'),
            ('public.return_grades(uuid,uuid[],uuid)', '1a403efc836b8d28b0fb56baf7b0926e', '7f38e838fd64a648e230ab232c5cce28'),
            ('public.course_draft_count(uuid)', 'bcdfdc2537478ebe69f14ed9a893d7ad', '65c23f8cbce58587ebd640c7f40e1e89'),
            ('student_submit.seen(text,uuid,uuid[],text)', 'dd6c76bf02bc627abcef5134a677288f', '74a9d8ec7adf0d056ccb8294eea716de'),
            ('student_submit._returned_grade(uuid,uuid)', '7f4b12e98f53293cde192abd8e6c18a4', '21706ae9eec783107d9da24e52e1855a')
        ) as v(fn, batch_a, s0_m4b)
    loop
        if to_regprocedure(_f.fn) is null then
            raise exception '% is not there: is Batch A applied? Nothing was changed.', _f.fn;
        end if;
        _md5 := md5(pg_get_functiondef(_f.fn::regprocedure));
        if _md5 <> _f.batch_a and _md5 <> _f.s0_m4b then
            raise exception '% is neither as S0-M4b leaves it nor as Batch A made it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

do $unpatch$
declare
    _fns text[][] := array[
      -- function, md5 as Batch A made it, md5 as S0-M4b leaves it
      array['fv_private.restore_grade_returns(jsonb)', 'c43618c73751e036a2735ad246b35966', '66501afe2d758a938cfc8f1d4fc13a92'],
      array['student_submit.page(text,uuid,text)', '7af33e2114372833d7ad7fb97b56ebae', 'e744f2a27bcfd6fef662bbddeb9659c7'],
      array['public.list_course_grade_returns(uuid)', '6ccab9528aef0c2d6ec8bea1964edf81', 'bc5529a69303cdfe8d91604388dc927a'],
      array['public._grade_return_on_change()', 'c24d422823677e947f9d595a91ac5b1d', '250d2d680daa2bd3b54cd041285f1696'],
      array['public.return_grades(uuid,uuid[],uuid)', '1a403efc836b8d28b0fb56baf7b0926e', '7f38e838fd64a648e230ab232c5cce28'],
      array['public.course_draft_count(uuid)', 'bcdfdc2537478ebe69f14ed9a893d7ad', '65c23f8cbce58587ebd640c7f40e1e89'],
      array['student_submit.seen(text,uuid,uuid[],text)', 'dd6c76bf02bc627abcef5134a677288f', '74a9d8ec7adf0d056ccb8294eea716de'],
      array['student_submit._returned_grade(uuid,uuid)', '7f4b12e98f53293cde192abd8e6c18a4', '21706ae9eec783107d9da24e52e1855a']
    ];
    _edits text[][] := array[
      -- function, text S0-M4b put in (found exactly once), text that was there
      array['student_submit._returned_grade(uuid,uuid)',
$s$      left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
           -- a DIBELS benchmark is a reading record, not a grade that is returned: a row it
           -- has from before it was DIBELS is not read (2026110905)
           and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels');$s$,
$s$      left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id;$s$],
      array['student_submit.seen(text,uuid,uuid[],text)',
$s$     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid
       -- a DIBELS benchmark is a reading record: nothing is returned, so nothing is seen (2026110905)
       and a.score_mode <> 'dibels'$s$,
$s$     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid$s$],
      array['public.course_draft_count(uuid)',
$s$     where e.course_id = p_course_id and g.is_draft
       -- a DIBELS benchmark is not a grade that is returned (2026110905)
       and a.score_mode <> 'dibels';$s$,
$s$     where e.course_id = p_course_id and g.is_draft;$s$],
      array['public.return_grades(uuid,uuid[],uuid)',
$s$           and e.course_id = _course
           and g.is_draft
           -- a DIBELS benchmark is not a grade that is returned (2026110905)
           and not exists (select 1 from assessment a where a.id = g.assessment_id and a.score_mode = 'dibels')
         order by g.enrollment_id$s$,
$s$           and e.course_id = _course
           and g.is_draft
         order by g.enrollment_id$s$],
      array['public._grade_return_on_change()',
$s$        -- Or it is a DIBELS benchmark: a reading record, not a grade that is
        -- returned. A save to it makes no row and changes none (2026110905).
        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id and a.score_mode <> 'dibels');$s$,
$s$        continue when not exists (select 1 from enrollment e where e.id = _c.enrollment_id)
                   or not exists (select 1 from assessment a where a.id = _c.assessment_id);$s$],
      array['public.list_course_grade_returns(uuid)',
$s$               -- a row with nothing to say (a grade cleared, a save in flight) is left out.
               -- seen_at is the student's own and is not sent to the teacher, and a DIBELS
               -- benchmark is not a grade that is returned (2026110905).
               and (g.is_draft or g.returned_at is not null)
               and a.score_mode <> 'dibels'$s$,
$s$               -- a row with nothing to say (a grade cleared, a save in flight) is left out
               and (g.is_draft or g.returned_at is not null or g.seen_at is not null)$s$],
      array['public.list_course_grade_returns(uuid)',
$s$'returned_copy', g.returned_copy,$s$,
$s$'seen_at', g.seen_at, 'returned_copy', g.returned_copy,$s$],
      array['student_submit.page(text,uuid,text)',
$s$'rubric_id', a.rubric_id, 'created_at', a.created_at,$s$,
$s$'rubric_id', a.rubric_id,$s$],
      array['fv_private.restore_grade_returns(jsonb)',
$s$      where g.is_draft and c.teacher_id = (select auth.uid())
        and (c.id::text in (select r->>'id' from jsonb_array_elements(
                 case when jsonb_typeof(p_payload->'courses') = 'array' then p_payload->'courses' else '[]'::jsonb end) r)
             -- or a class the payload names a grade or a state in (2026110905)
             or c.id in (select e2.course_id from enrollment e2 where e2.id = any (_es)))
        and not (c.student_page_enabled and c.return_grades is not distinct from 'on_return');$s$,
$s$      where g.is_draft and c.teacher_id = (select auth.uid())
        and c.id::text in (select r->>'id' from jsonb_array_elements(
                case when jsonb_typeof(p_payload->'courses') = 'array' then p_payload->'courses' else '[]'::jsonb end) r)
        and not (c.student_page_enabled and c.return_grades is not distinct from 'on_return');$s$]
    ];
    _def  text;
    _hits int;
    f     int;
    i     int;
begin
    for f in 1 .. array_length(_fns, 1) loop
        _def := pg_get_functiondef(_fns[f][1]::regprocedure);
        continue when md5(_def) = _fns[f][2];   -- already as Batch A made it
        for i in 1 .. array_length(_edits, 1) loop
            continue when _edits[i][1] <> _fns[f][1];
            _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
            if _hits <> 1 then
                raise exception '% has % matches for the text S0-M4b put in, expected 1', _fns[f][1], _hits;
            end if;
            _def := replace(_def, _edits[i][2], _edits[i][3]);
        end loop;
        if md5(_def) <> _fns[f][2] then
            raise exception '% does not come back as Batch A made it (md5 %, expected %)', _fns[f][1], md5(_def), _fns[f][2];
        end if;
        execute _def;
    end loop;
end
$unpatch$;

do $cron$
begin
    -- cron.job is pg_cron's own table: no pg_cron, no job. (Two steps: the
    -- inner test names cron.job, and must not be planned where it is missing.)
    if to_regclass('cron.job') is not null then
        if exists (select 1 from cron.job where jobname = 'fv_grade_return_repair_daily') then
            perform cron.unschedule('fv_grade_return_repair_daily');
        end if;
    end if;
end
$cron$;
drop trigger if exists grade_return_mode on public.assessment;
drop trigger if exists grade_return_truncate on public.assessment;
drop trigger if exists grade_return_truncate on public.enrollment;
drop function if exists public._grade_return_mode_changed();
drop function if exists public._grade_return_truncated();
drop procedure if exists public.grade_return_repair_nightly();
drop function if exists public._grade_return_repair_class(uuid);
drop function if exists public._grade_return_repair_lost();
drop function if exists public._grade_return_settle(uuid, uuid);
drop table if exists public.grade_return_repair_log;
commit;
