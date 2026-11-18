-- Per-student options on the Student Page tab (2026-11-17). APPLIED to
-- gradebook-prod on 2026-11-17 on Colin's OK ("Apply it"), through
-- apply_migration as student_page_per_student; post-check all ok.
--
-- THIS FILE CHANGES NO EXISTING ROW. It adds two empty columns to
-- enrollment, two functions for the teacher, and patches four student_submit
-- functions so they read the new columns. Until a teacher sets an option,
-- every student sees exactly what they see today.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Colin, Nov 17: "i should be able to show/hide grades for individual
-- students, thiings like that." The contract is
-- docs/plans/per-student-options-plan.md ("The contract"); this file is its
-- database half.
--
-- ── What it adds ───────────────────────────────────────────────────────────
-- enrollment.show_overall_grade boolean: null follows the class's Show
--   Overall Grade (course.show_my_learning); true shows it to this student;
--   false hides it from this student.
-- enrollment.page_paused_at timestamptz: null, the card opens the page; set,
--   paused since then: no card of the student's opens anything, and a page
--   already open stops on its next call.
-- Both nullable with no default: adding them rewrites nothing. No reason is
-- stored for either (a reason would hold sensitive notes).
-- public.set_student_page_options(p_course_id, p_enrollment_ids,
--   p_show_overall_grade, p_paused, p_idempotency_key) returns
--   { ok: true, options: [ { enrollment_id, show_overall_grade, paused_at } ],
--   skipped: [ enrollment_id ] }. p_show_overall_grade: 'class' (null),
--   'show' (true), 'hide' (false), or null for no change. p_paused: true
--   pauses (page_paused_at stays when already set), false opens, null no
--   change. options: the students of the class who are not withdrawn, in
--   class-list order. skipped: every other id given (withdrawn, gone,
--   another class's or another teacher's), once each in the order given;
--   nothing changes for it and nothing more is said about it, so one stale
--   id in a bulk change does not drop the rest. Refused with nothing changed
--   (an error, as set_course_feedback_options does): signed out (PT401); a
--   class the caller does not own, in the trash or gone, or no id left once
--   the skipped are taken out (P0002); no ids, a null id, more than 500,
--   both changes null, an unknown word (22023). The same key again answers
--   what the first call answered and writes nothing.
-- public.list_student_page_options(p_course_id) returns { ok, options } for
--   every student of the class who is not withdrawn and has either option
--   set. Owner only, as above.
-- In both replies show_overall_grade is the word, 'class', 'show' or 'hide',
-- and paused_at is the time or null. Both run as their owner with
-- fv_owns_course, granted to authenticated only (not anon, not public, not
-- service_role: no edge function calls them).
--
-- ── What it changes ────────────────────────────────────────────────────────
-- Each function is patched in place: the file reads its live definition,
-- swaps the text below (counted), checks the result has the md5 below, and
-- runs it. Arguments, return type, owner, SECURITY DEFINER, volatility,
-- search_path and grants stay (create or replace keeps them).
--   student_submit._card_refusal(uuid): a paused student is refused as
--     'closed', the code a class with its page off already gets. Every card
--     scan (_card_lookup) and every session route (_session_class, and
--     _send_session through it) asks this one function, so a pause takes
--     effect on the next call, mid-session too. The student reads "The
--     student page is turned off for this class. Ask your teacher."
--   student_submit._session_classes(uuid): leaves a paused student's class
--     out of the card sign-in's class list.
--   student_submit.page and student_submit.feedback: right after reading the
--     class, each sets its copy of show_my_learning to the student's own
--     value, coalesce(enrollment.show_overall_grade, course.show_my_learning),
--     so every read below it (page: the pieces' category_id and the whole
--     My Learning block; feedback: the key it sends) is this student's. The
--     key sent stays show_my_learning. Hide sends exactly what the class
--     switch off sends: the overall grade is not sent (no My Learning
--     block, no piece's category_id); each piece's result, weight and
--     category_percent still go, as they do today with the class switch off.
-- No other function reads show_my_learning for a student (live, Nov 17:
-- only page and feedback in student_submit; list_course_feedback and
-- set_course_feedback_options are the teacher's). What a paused student can
-- still reach, as for a class whose page is off: a questionnaire slip
-- already printed (open, verify, submit) and a phone report's single-use
-- code (open, check); neither asks about the student page. Live on Nov 17:
-- 1 live slip, 0 live report codes.
-- md5 of pg_get_functiondef on PostgreSQL 17 (function, live, as this file
-- leaves it):
--   student_submit._card_refusal(uuid)        cb88af0a6bf62c22ff6c636b291b1a25  4b982e451dbd5c9c68916c99d29d2d37
--   student_submit._session_classes(uuid)     35e766379278258651709e73b9f05940  92eb84de662304124deb198baa75111e
--   student_submit.page(text,uuid,text)       b2781abd6d579e3dc72b3f5f801bb917  9e16e8aaa8f1379beca4f64d4111fa1d
--   student_submit.feedback(text,uuid,text)   e093fd549255e5f938491066a5e2ea1c  73b78adc4b6661bc99ca0eaebf2e81bb
--   public.set_student_page_options(uuid,uuid[],text,boolean,uuid) (new)  1578d29d0af1a5cf25818878d811e5c1
--   public.list_student_page_options(uuid) (new)                          6913c1c295727391000044c2f7098b88
-- Relied on, unchanged (function, live):
--   public.fv_owns_course(uuid)                       e3afeca06043a6e907e6f4ae777c85da
--   public.fv_idem_check(uuid,text)                   1c7b546434bee4b774557e0e6b16024f
--   public.fv_idem_store(uuid,text,jsonb)             6d0b48c458d273a332db39e1a4b68626
--   student_submit._session_class(text,uuid)          1ae94981ff32f804d12079a24bd7b41a
--   student_submit._card_lookup(text,text,text)       b35a926e60a39330f8851d368acec7e6
--   student_submit._send_session(text,uuid)           c39242f54850eeeada19945ac8123644
--
-- ── Left alone, and why nothing breaks ─────────────────────────────────────
-- Every function that writes enrollment names its columns (restore, Teams
-- and roster import, create_student_and_enroll, update_enrollment,
-- withdraw, reenrol, relink, reorder): a restored or imported student starts
-- with both null. Withdraw and re-enrol keep the options. Four teacher
-- functions send the whole enrollment row and so also carry the two values
-- to the class's own teacher: get_class_bundle (each profiles[].enrollment;
-- its roster names its columns and is unchanged), get_student_profile,
-- list_course_student_profiles and get_term_rating (the last three run as
-- the teacher under row security).
-- No student_submit function sends or copies an enrollment row. An option
-- change is an update of enrollment, so the trigger
-- course_sync_cursor_enrollment_gradebook moves the class's sync cursor
-- (gradebook): the teacher's other device sees the class changed and reloads
-- its bundle, which carries the values; the app reads the options from
-- list_student_page_options on its own.
--
-- ── The checks it makes first ──────────────────────────────────────────────
-- It stops with nothing changed unless the four patched functions are the
-- live definition or this file's (a second run), the six it relies on are
-- the live ones, the two new functions are missing or this file's with no
-- other function of their names, and each new column is missing or exactly
-- this file's (type, nullable, no default). A patched function that is this
-- file's while a column is missing stops it too. Read-only from
-- gradebook-prod (17.6) on Nov 17: all 366 functions in public,
-- student_submit and fv_private equal a database rebuilt from
-- migrations/baseline. Pre-check: per-student-live-precheck.sql.
--
-- ── Rows ───────────────────────────────────────────────────────────────────
-- None changes. Both columns start null on every row, which is today's
-- behaviour, so there is nothing newly hidden or refused to count first.
--
-- Tested on a throwaway PostgreSQL 17.11 rebuilt equal to live:
-- migrations/local-test/per_student.py (README.md, "Per-student options").
-- Undo: migrations/local-test/per-student-undo.sql. After:
-- migrations/local-test/per-student-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

-- ── 1. The checks, before anything changes ─────────────────────────────────
do $guard$
declare
    _f     record;
    _md5   text;
    _done  int := 0;
    _cols  int;
begin
    for _f in select * from (values
        ('student_submit._card_refusal(uuid)', 'cb88af0a6bf62c22ff6c636b291b1a25', '4b982e451dbd5c9c68916c99d29d2d37'),
        ('student_submit._session_classes(uuid)', '35e766379278258651709e73b9f05940', '92eb84de662304124deb198baa75111e'),
        ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917', '9e16e8aaa8f1379beca4f64d4111fa1d'),
        ('student_submit.feedback(text,uuid,text)', 'e093fd549255e5f938491066a5e2ea1c', '73b78adc4b6661bc99ca0eaebf2e81bb'),
        ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da', 'e3afeca06043a6e907e6f4ae777c85da'),
        ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f', '1c7b546434bee4b774557e0e6b16024f'),
        ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626', '6d0b48c458d273a332db39e1a4b68626'),
        ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a', '1ae94981ff32f804d12079a24bd7b41a'),
        ('student_submit._card_lookup(text,text,text)', 'b35a926e60a39330f8851d368acec7e6', 'b35a926e60a39330f8851d368acec7e6'),
        ('student_submit._send_session(text,uuid)', 'c39242f54850eeeada19945ac8123644', 'c39242f54850eeeada19945ac8123644')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and _md5 is distinct from _f.now then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), _f.was;
        end if;
        _done := _done + (_md5 = _f.now and _f.now <> _f.was)::int;
    end loop;
    for _f in select * from (values
        ('public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', 'set_student_page_options', '1578d29d0af1a5cf25818878d811e5c1'),
        ('public.list_student_page_options(uuid)', 'list_student_page_options', '6913c1c295727391000044c2f7098b88')
    ) as v(fn, name, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% exists and is not this file''s (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
        if (select count(*) from pg_proc where proname = _f.name) > (_md5 is not null)::int then
            raise exception 'a function named % exists with other arguments or in another schema. Nothing was changed.', _f.name;
        end if;
    end loop;
    if exists (select 1 from pg_attribute a
                where a.attrelid = 'public.enrollment'::regclass and not a.attisdropped
                  and a.attname in ('show_overall_grade', 'page_paused_at')
                  and (format_type(a.atttypid, a.atttypmod) <> case a.attname when 'show_overall_grade' then 'boolean'
                                                                            else 'timestamp with time zone' end
                       or a.attnotnull or a.atthasdef or a.attgenerated <> '' or a.attidentity <> '')) then
        raise exception 'enrollment has show_overall_grade or page_paused_at, and not as this file makes it. Nothing was changed.';
    end if;
    _cols := (select count(*) from pg_attribute a
               where a.attrelid = 'public.enrollment'::regclass and not a.attisdropped
                 and a.attname in ('show_overall_grade', 'page_paused_at'));
    if _done > 0 and _cols < 2 then
        raise exception 'a student function already reads the new columns, and enrollment lacks one. Nothing was changed.';
    end if;
end
$guard$;

-- ── 2. The two columns, null on every row ──────────────────────────────────
alter table public.enrollment
    add column if not exists show_overall_grade boolean,
    add column if not exists page_paused_at timestamptz;

comment on column public.enrollment.show_overall_grade is
    'Show Overall Grade for this student: null follows the class (course.show_my_learning), true shown, false hidden.';
comment on column public.enrollment.page_paused_at is
    'Set: the student page is paused for this student since then (their card opens nothing). Null: open.';

-- ── 3. The student functions read them: the live definition, the text swapped ──
do $patch$
declare
    _f    record;
    _s    record;
    _def  text;
    _n    int;
begin
    for _f in select * from (values
        ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
        ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e'),
        ('student_submit.page(text,uuid,text)', '9e16e8aaa8f1379beca4f64d4111fa1d'),
        ('student_submit.feedback(text,uuid,text)', '73b78adc4b6661bc99ca0eaebf2e81bb')
    ) as v(fn, now) loop
        _def := pg_get_functiondef(to_regprocedure(_f.fn));
        continue when md5(_def) = _f.now;
        for _s in select * from (values
        ('student_submit._card_refusal(uuid)',
         $o$               when not c.student_page_enabled then 'closed'
$o$,
         $n$               -- 2026111720: a student whose page the teacher paused is refused as a class with its page off
               when not c.student_page_enabled or e.page_paused_at is not null then 'closed'
$n$),
        ('student_submit._session_classes(uuid)',
         $o$and c.deleted_at is null and c.student_page_enabled;
$o$,
         $n$and c.deleted_at is null and c.student_page_enabled
       and e.page_paused_at is null;  -- 2026111720: a class whose page the teacher paused for this student is left out
$n$),
        ('student_submit.page(text,uuid,text)',
         $o$    select * into _course from course where id = (_in->>'course_id')::uuid;
$o$,
         $n$    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- 2026111720: Show Overall Grade as this student has it (their own, or the class's when they have none).
    -- Every read of _course.show_my_learning below is this student's value.
    _course.show_my_learning := coalesce((select e.show_overall_grade from enrollment e where e.id = p_enrollment_id),
                                         _course.show_my_learning);
$n$),
        ('student_submit.feedback(text,uuid,text)',
         $o$    select * into _course from course where id = (_in->>'course_id')::uuid;
$o$,
         $n$    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- 2026111720: Show Overall Grade as this student has it (their own, or the class's when they have none).
    _course.show_my_learning := coalesce((select e.show_overall_grade from enrollment e where e.id = p_enrollment_id),
                                         _course.show_my_learning);
$n$)
        ) as s(fn, find, put) where s.fn = _f.fn loop
            _n := (length(_def) - length(replace(_def, _s.find, ''))) / length(_s.find);
            if _n <> 1 then
                raise exception '% holds the text to change % time(s), not once. Nothing was changed.', _f.fn, _n;
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

-- ── 4. The teacher's two functions ─────────────────────────────────────────
create or replace function public.set_student_page_options(p_course_id uuid, p_enrollment_ids uuid[], p_show_overall_grade text, p_paused boolean, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached  jsonb;
    _ids     uuid[];
    _skipped jsonb;
    _out     jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_student_page_options');
    if _cached is not null then return _cached; end if;
    if p_show_overall_grade is null and p_paused is null then
        raise exception 'nothing to change' using errcode = '22023';
    end if;
    if p_show_overall_grade not in ('class', 'show', 'hide') then
        raise exception 'show_overall_grade must be class, show or hide' using errcode = '22023';
    end if;
    if coalesce(cardinality(p_enrollment_ids), 0) = 0 then
        raise exception 'no students given' using errcode = '22023';
    end if;
    if cardinality(p_enrollment_ids) > 500 then
        raise exception 'at most 500 students at a time' using errcode = '22023';
    end if;
    if array_position(p_enrollment_ids, null) is not null then
        raise exception 'a student id is missing' using errcode = '22023';
    end if;
    -- The students of this class who are not withdrawn. Any other id (withdrawn, gone, another class's or
    -- another teacher's) is skipped: nothing changes for it, and it comes back in skipped as it was sent,
    -- with nothing said about why.
    _ids := array(select e.id from enrollment e
                   where e.id = any (p_enrollment_ids) and e.course_id = p_course_id and e.withdrawn_at is null);
    _skipped := coalesce((select jsonb_agg(x.id order by x.n)
                            from (select u.id, min(u.n) as n from unnest(p_enrollment_ids) with ordinality u(id, n)
                                   where u.id <> all (_ids) group by u.id) x), '[]'::jsonb);
    if cardinality(_ids) = 0 then
        raise exception 'no student of this class given' using errcode = 'P0002';
    end if;
    -- Only the rows that change are written (a pause keeps the time it began).
    update enrollment e
       set show_overall_grade = case p_show_overall_grade when 'class' then null when 'show' then true
                                                          when 'hide' then false else e.show_overall_grade end,
           page_paused_at = case when p_paused then coalesce(e.page_paused_at, now())
                                 when not p_paused then null else e.page_paused_at end,
           updated_at = now()
     where e.id = any (_ids) and e.course_id = p_course_id and e.withdrawn_at is null
       and (e.show_overall_grade is distinct from case p_show_overall_grade when 'class' then null when 'show' then true
                                                                            when 'hide' then false else e.show_overall_grade end
            or e.page_paused_at is distinct from case when p_paused then coalesce(e.page_paused_at, now())
                                                      when not p_paused then null else e.page_paused_at end);
    _out := jsonb_build_object('ok', true, 'options', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'enrollment_id', e.id,
                   'show_overall_grade', case e.show_overall_grade when true then 'show' when false then 'hide' else 'class' end,
                   'paused_at', e.page_paused_at) order by e.roster_position, e.id)
          from enrollment e where e.id = any (_ids)), '[]'::jsonb),
        'skipped', _skipped);
    perform fv_idem_store(p_idempotency_key, 'set_student_page_options', _out);
    return _out;
end;
$function$;

create or replace function public.list_student_page_options(p_course_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('ok', true, 'options', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'enrollment_id', e.id,
                   'show_overall_grade', case e.show_overall_grade when true then 'show' when false then 'hide' else 'class' end,
                   'paused_at', e.page_paused_at) order by e.roster_position, e.id)
          from enrollment e
         where e.course_id = p_course_id and e.withdrawn_at is null
           and (e.show_overall_grade is not null or e.page_paused_at is not null)), '[]'::jsonb));
end;
$function$;

revoke all on function public.set_student_page_options(uuid, uuid[], text, boolean, uuid) from public, anon, service_role;
grant execute on function public.set_student_page_options(uuid, uuid[], text, boolean, uuid) to authenticated;
revoke all on function public.list_student_page_options(uuid) from public, anon, service_role;
grant execute on function public.list_student_page_options(uuid) to authenticated;

-- ── 5. The new functions are this file's ───────────────────────────────────
do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('public.set_student_page_options(uuid,uuid[],text,boolean,uuid)', '1578d29d0af1a5cf25818878d811e5c1'),
        ('public.list_student_page_options(uuid)', '6913c1c295727391000044c2f7098b88')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
end
$after$;

commit;
