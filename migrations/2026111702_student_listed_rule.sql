-- "Is this piece on the student's page?" in one function (2026-11-17).
--
-- THIS FILE CHANGES NO ROW AND NO ANSWER. It adds one function,
-- student_submit._listed, and makes the 10 student_submit functions that
-- spelled the rule out call it instead. What a student sees and can do is
-- the same as before, byte for byte.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- 2026111701 (Drafts) had to add "and not a.is_draft" beside "its Date
-- Assigned has come" in 12 places in 10 functions, and the file that
-- carried those functions whole, with 6 others, was 140 KB: too big to send
-- through Supabase's apply_migration. Colin, Nov 17: keep migrations small,
-- and put a rule that many functions repeat in one shared function. With
-- the rule here, the next change to it is one small function.
--
-- ── The rule ───────────────────────────────────────────────────────────────
--   student_submit._listed(p_assessment public.assessment, p_today date)
-- is true when the piece is not a Draft and its Date Assigned is empty or
-- on or before p_today. Each caller passes today in the class's own time
-- zone, (now() at time zone public._fv_timezone(<the class>.timezone))::date,
-- worked out exactly as it was before. The function reads no table
-- (immutable) and runs with an empty search_path. It is not strict: with no
-- Date Assigned and no p_today it gives what the spelled-out rule gave
-- (true for a piece that is not a Draft). Only the owner may run it; the
-- callers are SECURITY DEFINER functions, which run as the owner.
--
-- ── What it changes ────────────────────────────────────────────────────────
-- Each function is patched in place: the file reads its live definition,
-- swaps each copy of the rule (and the 2026111701 comment beside it) for
-- the call, checks the result has the md5 below, and runs it. Nothing else
-- in a definition changes: arguments, return type, owner, SECURITY DEFINER,
-- volatility, search_path and grants stay (create or replace keeps them).
-- Three E4 comments, "a piece dated in the future is not on the student's
-- page", now say "a piece not on the student's page (student_submit._listed)".
--   _session_classes (the to-do count), _work_window ('listed', which work,
--   send_start, replace, send_finish and unsend read), feedback, group_work,
--   page (3: the list, its rubrics, My Learning's rubric_tags), file_links,
--   group_file_links, handout_links, markup, reflect.
-- md5 of pg_get_functiondef on PostgreSQL 17 (function, live, as this file
-- leaves it):
--   student_submit._session_classes(uuid)                 f6751bf9a7803a84067df8efad66f490  35e766379278258651709e73b9f05940
--   student_submit._work_window(uuid)                     07e70e0c63675e895b1db9d6b4d8a472  904f6388c7f2b65bfb9f093f343100e4
--   student_submit.feedback(text,uuid,text)               0c01e9f5d2efee024e1592fb8a42b6d8  e093fd549255e5f938491066a5e2ea1c
--   student_submit.group_work(text,uuid,text)             6d1a251fdcc1261129e0c1025c977943  fd39a0807e49ab3e6f68860d0e78ee2f
--   student_submit.page(text,uuid,text)                   0508ea6a4e183bac79c18df4a1135917  b2781abd6d579e3dc72b3f5f801bb917
--   student_submit.file_links(text,uuid,uuid,text)        c977ce3010a3c849110c60195caf2f6e  cb91bac98d5d9b4fb27ba72769b1f211
--   student_submit.group_file_links(text,uuid,uuid,text)  f7a4bf32ea97c2d1dd11e28e7d9cf117  6d1929668e5c32090062fbd1025e0699
--   student_submit.handout_links(text,uuid,uuid,text)     822a5ed9b9433f6ef29af3b8e5856070  410877d7e4d5b860b8dadb4c1b185f3c
--   student_submit.markup(text,uuid,uuid,text)            3f4031af1d0bb67e15e27eaae7c275cf  2296aefc4e38f67aad5722a2637c2fb4
--   student_submit.reflect(text,uuid,uuid,jsonb,text)     c77950cbe4d79e1f0e73a46d720d9545  5f65a3ff02460ea810372d172b988b39
--   student_submit._listed(public.assessment,date) (new)  ee5745a778e8ac1cb56f013d1c3e034e
--
-- Left alone: no other function spells the rule out. seen, reply and the
-- revision functions check no date (2026111701 says why); no teacher
-- function uses it.
--
-- ── The checks it makes first ──────────────────────────────────────────────
-- It stops with nothing changed unless each of the 10 functions is the live
-- definition or this file's (a second run) and student_submit._listed is
-- missing or this file's. Read-only from gradebook-prod (17.6) on Nov 17:
-- all 344 functions in public, student_submit and fv_private equal a
-- database rebuilt from migrations/baseline; the 10 have the md5s above; no
-- _listed. Pre-check: student-listed-live-precheck.sql.
--
-- ── Rows ───────────────────────────────────────────────────────────────────
-- None changes, and nothing is newly hidden or refused, so there is nothing
-- to count first.
--
-- ── Order ──────────────────────────────────────────────────────────────────
-- After 2026111701, whose definitions it changes. The app needs nothing:
-- the answers are the same. To undo 2026111701 later, run this file's undo
-- first: 2026111701's undo stops, with nothing changed, while these
-- functions call _listed.
--
-- Tested on a throwaway PostgreSQL 17.11 rebuilt equal to live:
-- migrations/local-test/student_listed.py (README.md, "One student page
-- rule"). Undo: migrations/local-test/student-listed-undo.sql. After:
-- migrations/local-test/student-listed-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

-- ── 1. The checks, before anything changes ─────────────────────────────────
do $guard$
declare
    _f       record;
    _md5     text;
    _listed  text := md5(pg_get_functiondef(to_regprocedure('student_submit._listed(public.assessment,date)')));
    _others  int := (select count(*) from pg_proc where pronamespace = 'student_submit'::regnamespace and proname = '_listed');
    _done    int := 0;
begin
    if _others > 1 or (_others = 1 and _listed is null) then
        raise exception 'student_submit._listed exists with other arguments. Nothing was changed.';
    end if;
    if _listed is not null and _listed <> 'ee5745a778e8ac1cb56f013d1c3e034e' then
        raise exception 'student_submit._listed exists and is not this file''s (md5 %). Nothing was changed.', _listed;
    end if;
    for _f in select * from (values
        ('student_submit._session_classes(uuid)', 'f6751bf9a7803a84067df8efad66f490', '35e766379278258651709e73b9f05940'),
        ('student_submit._work_window(uuid)', '07e70e0c63675e895b1db9d6b4d8a472', '904f6388c7f2b65bfb9f093f343100e4'),
        ('student_submit.feedback(text,uuid,text)', '0c01e9f5d2efee024e1592fb8a42b6d8', 'e093fd549255e5f938491066a5e2ea1c'),
        ('student_submit.group_work(text,uuid,text)', '6d1a251fdcc1261129e0c1025c977943', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
        ('student_submit.page(text,uuid,text)', '0508ea6a4e183bac79c18df4a1135917', 'b2781abd6d579e3dc72b3f5f801bb917'),
        ('student_submit.file_links(text,uuid,uuid,text)', 'c977ce3010a3c849110c60195caf2f6e', 'cb91bac98d5d9b4fb27ba72769b1f211'),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 'f7a4bf32ea97c2d1dd11e28e7d9cf117', '6d1929668e5c32090062fbd1025e0699'),
        ('student_submit.handout_links(text,uuid,uuid,text)', '822a5ed9b9433f6ef29af3b8e5856070', '410877d7e4d5b860b8dadb4c1b185f3c'),
        ('student_submit.markup(text,uuid,uuid,text)', '3f4031af1d0bb67e15e27eaae7c275cf', '2296aefc4e38f67aad5722a2637c2fb4'),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 'c77950cbe4d79e1f0e73a46d720d9545', '5f65a3ff02460ea810372d172b988b39')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and _md5 is distinct from _f.now then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), _f.was;
        end if;
        _done := _done + (_md5 = _f.now)::int;
    end loop;
    if _done > 0 and _listed is null then
        raise exception 'a function already calls student_submit._listed, which is missing. Nothing was changed.';
    end if;
end
$guard$;

-- ── 2. The rule, once ──────────────────────────────────────────────────────
create or replace function student_submit._listed(p_assessment public.assessment, p_today date)
 returns boolean
 language sql
 immutable parallel safe
 set search_path to ''
as $function$
    select not p_assessment.is_draft
       and (p_assessment.date_assigned is null or p_assessment.date_assigned <= p_today)
$function$;

revoke all on function student_submit._listed(public.assessment, date) from public, anon, authenticated, service_role;

comment on function student_submit._listed(public.assessment, date) is
    'On the student page: not a Draft, and its Date Assigned is empty or has come (p_today: today in the class''s time zone).';

-- ── 3. Each function calls it: the live definition, each copy of the rule swapped ──
do $patch$
declare
    _f    record;
    _s    record;
    _def  text;
    _n    int;
begin
    for _f in select * from (values
        ('student_submit._session_classes(uuid)', 'f6751bf9a7803a84067df8efad66f490', '35e766379278258651709e73b9f05940'),
        ('student_submit._work_window(uuid)', '07e70e0c63675e895b1db9d6b4d8a472', '904f6388c7f2b65bfb9f093f343100e4'),
        ('student_submit.feedback(text,uuid,text)', '0c01e9f5d2efee024e1592fb8a42b6d8', 'e093fd549255e5f938491066a5e2ea1c'),
        ('student_submit.group_work(text,uuid,text)', '6d1a251fdcc1261129e0c1025c977943', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
        ('student_submit.page(text,uuid,text)', '0508ea6a4e183bac79c18df4a1135917', 'b2781abd6d579e3dc72b3f5f801bb917'),
        ('student_submit.file_links(text,uuid,uuid,text)', 'c977ce3010a3c849110c60195caf2f6e', 'cb91bac98d5d9b4fb27ba72769b1f211'),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 'f7a4bf32ea97c2d1dd11e28e7d9cf117', '6d1929668e5c32090062fbd1025e0699'),
        ('student_submit.handout_links(text,uuid,uuid,text)', '822a5ed9b9433f6ef29af3b8e5856070', '410877d7e4d5b860b8dadb4c1b185f3c'),
        ('student_submit.markup(text,uuid,uuid,text)', '3f4031af1d0bb67e15e27eaae7c275cf', '2296aefc4e38f67aad5722a2637c2fb4'),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 'c77950cbe4d79e1f0e73a46d720d9545', '5f65a3ff02460ea810372d172b988b39')
    ) as v(fn, was, now) loop
        _def := pg_get_functiondef(to_regprocedure(_f.fn));
        continue when md5(_def) = _f.now;
        for _s in select * from (values
        ('student_submit._session_classes(uuid)', 1,
         $o$and (a.date_assigned is null
                                 or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                            and not a.is_draft  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$o$,
         $n$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date)$n$),
        ('student_submit._work_window(uuid)', 1,
         $o$-- 2026111701: a Draft is not on the student's page until the teacher assigns it
               'listed', not a.is_draft and (a.date_assigned is null or a.date_assigned <= d.today),$o$,
         $n$'listed', student_submit._listed(a, d.today),$n$),
        ('student_submit.feedback(text,uuid,text)', 1,
         $o$(a.date_assigned is null or a.date_assigned <= _today) and not a.is_draft$o$,
         $n$student_submit._listed(a, _today)$n$),
        ('student_submit.group_work(text,uuid,text)', 1,
         $o$(a.date_assigned is null or a.date_assigned <= _today) and not a.is_draft$o$,
         $n$student_submit._listed(a, _today)$n$),
        ('student_submit.page(text,uuid,text)', 3,
         $o$(a.date_assigned is null or a.date_assigned <= _today) and not a.is_draft$o$,
         $n$student_submit._listed(a, _today)$n$),
        ('student_submit.file_links(text,uuid,uuid,text)', 1,
         $o$-- E4: a piece dated in the future is not on the student's page: no link for its pages$o$,
         $n$-- E4: a piece not on the student's page (student_submit._listed): no link for its pages$n$),
        ('student_submit.file_links(text,uuid,uuid,text)', 1,
         $o$and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                               and not a.is_draft)$o$,
         $n$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date))$n$),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 1,
         $o$-- E4: a piece dated in the future is not on the student's page: no link for its pages$o$,
         $n$-- E4: a piece not on the student's page (student_submit._listed): no link for its pages$n$),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 1,
         $o$and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                               and not a.is_draft)$o$,
         $n$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date))$n$),
        ('student_submit.handout_links(text,uuid,uuid,text)', 1,
         $o$and (a.date_assigned is null
            or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
       and not a.is_draft;  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$o$,
         $n$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date);$n$),
        ('student_submit.markup(text,uuid,uuid,text)', 1,
         $o$-- E4: a piece dated in the future is not on the student's page: nothing of it is served$o$,
         $n$-- E4: a piece not on the student's page (student_submit._listed): nothing of it is served$n$),
        ('student_submit.markup(text,uuid,uuid,text)', 1,
         $o$and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date)
       and not is_draft;  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$o$,
         $n$and student_submit._listed(assessment, (now() at time zone public._fv_timezone(_course.timezone))::date);$n$),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 1,
         $o$and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date)
       and not is_draft;  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$o$,
         $n$and student_submit._listed(assessment, (now() at time zone public._fv_timezone(_course.timezone))::date);$n$)
        ) as s(fn, times, find, put) where s.fn = _f.fn loop
            _n := (length(_def) - length(replace(_def, _s.find, ''))) / length(_s.find);
            if _n <> _s.times then
                raise exception '% holds the text to change % time(s), not %. Nothing was changed.', _f.fn, _n, _s.times;
            end if;
            _def := replace(_def, _s.find, _s.put);
        end loop;
        if md5(_def) <> _f.now then
            raise exception '% would not be the expected definition (md5 %, expected %). Nothing was changed.', _f.fn, md5(_def), _f.now;
        end if;
        execute _def;
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) <> _f.now then
            raise exception '% did not come out as expected. Nothing was changed.', _f.fn;
        end if;
    end loop;
end
$patch$;

commit;
