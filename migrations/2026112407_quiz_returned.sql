-- Quizzes, MQ3: the returned view on the student's side (2026-11-24). NOT APPLIED.
--
-- THIS FILE CHANGES NO EXISTING ROW, TABLE, POLICY, CONSTRAINT OR FUNCTION.
-- It adds one read-only function, student_submit.quiz_result, for the
-- student-submit edge function (service_role) only.
--
-- == Why ==
-- Quizzes, slice Q5a (docs/plans/quizzes-plan.md, "The answer key" and
-- "Q5"; the contract is migrations/local-test/quizzes-contract.md, "MQ3,
-- the returned view"). Once a quiz comes back, the student's page shows the
-- grade and, as the quiz's When Returned Students See setting says, which
-- questions were right and the right answers. quiz_result is the one
-- function of the student page that reads the answer key (public.quiz_key).
--
-- == What it adds (in student_submit, security definer, stable, search_path
--    public, student_submit, pg_temp) ==
-- quiz_result(p_session_token, p_enrollment_id, p_assessment_id, p_ip_hash)
--   It begins with _session_class (a signed-out session, a paused or
--   withdrawn student, a class with its page off or in the trash, a stopped
--   or expired card are refused, as on every route). The piece is taken as
--   quiz takes it (_quiz_window): a Draft, a piece not yet assigned, a pair
--   or group piece, a DIBELS piece, a piece with no quiz and another class's
--   piece all answer the same not_found.
--   It answers { ok: true, returned: false } and nothing else unless ALL of:
--   1. Returned to this student: a grade_return row with returned_at, and
--      _returned_grade has a grade (Missing, Excused, a Draft never returned
--      and a cleared grade have none).
--   2. The student can no longer answer: no unsent try (a Reopen's try
--      counts, opened or not), and the quiz is closed or no tries are left
--      (tries counted as quiz counts them).
--   3. A confirmed try (marked not null; there is at most one), returned
--      after it was confirmed. In a class that keeps changes until Return
--      (_grade_return_holds), its marked_at is not after returned_at: a
--      marking confirmed since the last Return waits for the next one. In a
--      class that returns every save at once there are no drafts
--      (_grade_return_release returns them all when the setting changes), so
--      the time is not compared, only that no draft is waiting: there the
--      scores and the marking are two writes the app sends side by side, and
--      either may land first. The contract, "MQ3", says why, path by path,
--      and names four paths in a class that keeps changes (a re-confirm that
--      changes no score, an Undo after Return, a Return before the marking
--      lands, a switch from At Once) that stay false until the grade next
--      changes and is Returned: they fail safe.
--   4. The quiz's shows: grade sends no questions; right sends each question
--      with result and the student's own answer; answers adds the key's
--      answer and why line. total (marked's earned and possible) only with
--      add_total.
--   Questions are in this student's order, the confirmed try's
--   question_order read by _quiz_questions; archived ones are left out.
--   It writes nothing: no row, no lock, no write_log row (it is marked
--   stable, which PostgreSQL holds to). Reading spends none of the 600
--   quiz writes an hour, as quiz_list spends none.
-- Granted to service_role only. The edge function signs in as the owner,
-- which runs every function it owns, so the way to stop it is to drop it
-- (the undo's PART 1).
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new function, as this file
-- leaves it):
--   student_submit.quiz_result(text,uuid,uuid,text) (new)                 8ad540cf01444c8126910300f95dc7d4
-- Relied on, unchanged (function, live):
--   student_submit._session_class(text,uuid)                              1ae94981ff32f804d12079a24bd7b41a
--   student_submit._card_refusal(uuid)                                    4b982e451dbd5c9c68916c99d29d2d37
--   student_submit._device_session(text)                                  86d4747f0dd055fa4a61945046ca64d3
--   student_submit._listed(public.assessment,date)                        ee5745a778e8ac1cb56f013d1c3e034e
--   student_submit._quiz_window(uuid,uuid)                                2eb5a1c0652415e1cd3923b79c22b101
--   student_submit._quiz_questions(uuid,jsonb)                            774274b707ad660b1d3f2d023edf13be
--   student_submit._returned_grade(uuid,uuid)                             21706ae9eec783107d9da24e52e1855a
--   student_submit.quiz(text,uuid,uuid,text,boolean)                      0746b4af4f1cadd75b86cc20f49931d3
--   public._fv_timezone(text)                                             8dbcb5716f155e2441f47416a0b28527
--   public._grade_copy(uuid,uuid)                                         3a8e0dfbc873176692a1160150a8d43b
--   public._grade_copy_in_use(jsonb,uuid)                                 befe9f034ce927b2abdf8c8825c402bd
--   public._grade_return_holds(uuid)                                      51d6525109333424405e826bbc303b90
--   public._grade_return_apply(uuid,uuid,jsonb,jsonb)                     89899f9dbc1569f7f1cc4216e252eb32
--   public._grade_return_one(uuid,uuid,timestamp with time zone)          99e3165d005b5b2020ec40dcf307c689
--   public._grade_return_release()                                        81222b025ca3625612b1bcd3ff9e2431
--   public.confirm_quiz(uuid,jsonb,uuid)                                  ee23f2910b1484f18a41ea76b08f0846
-- (quiz, _grade_return_apply, _grade_return_one, _grade_return_release and
-- confirm_quiz are not called: quiz_result counts tries as quiz counts them,
-- and rule 3 rests on how the other four move returned_at, is_draft and
-- marked_at, so a change to any of them stops this file until the rule is
-- checked again. _grade_copy and _grade_copy_in_use are what
-- _returned_grade reads the grade with.)
-- Each md5 is taken with public on the search path; the file sets its own.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the
-- role running it owns _session_class, _returned_grade and the quiz tables
-- it reads, and may create in student_submit; the sixteen functions it
-- relies on are the definitions it was tested against; its own is missing
-- or this file's; no function named quiz_result is elsewhere; the tables it
-- reads have the columns it was tested with.
--
-- == What it does not depend on ==
-- Collation: nothing is sorted as text but the last check's grantees, which
-- sort collate "C"; questions come in _quiz_questions' order (a whole
-- number); ids are compared as uuid; text is only tested for equality
-- (md5s, column lists, names), which is byte by byte under any
-- deterministic collation. Locale and time zone: two timestamptz values are
-- compared as values, never as text, and no date or time is printed or
-- parsed; the day a quiz closes is _quiz_window's, in the class's own time
-- zone. Version: the
-- guard stops on anything but 17. Search path: the file sets its own, and
-- the function has its path pinned. The applying role: it must be the owner
-- of what it reads (checked), and grants are read from proacl itself, so
-- default privileges show in the last check.
--
-- == Rows and locks ==
-- None changes and none is added. It takes no lock on any table (one
-- function created). Five seconds of waiting for anything and it gives up.
--
-- == Order ==
-- After 2026111807 (none of the quiz files is touched). Before the edge
-- function with the quiz-result route is deployed. The student page
-- released now calls nothing of it.
--
-- The last check names each part not as tested. Tested on PostgreSQL 17,
-- ICU en-US and C, and as a role that is not a superuser:
-- migrations/local-test/quiz_returned.py (README.md, "Quizzes, the
-- returned view"). Undo: local-test/quiz-returned-undo.sql. Before:
-- local-test/quiz-returned-live-precheck.sql. After:
-- local-test/quiz-returned-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';
-- pg_get_functiondef names a type by its schema unless that schema is on the path, so every md5 below
-- is taken with public on it, whatever path the session sending this file has.
set local search_path = public, pg_temp;

-- == 1. The checks, before anything changes ==
do $guard$
declare
    _f    record;
    _md5  text;
    _cols text;
    _me   oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    -- Run as the owner of the student functions and the quiz tables (postgres on Supabase, not a superuser): the
    -- new function must belong to the edge function's role and read what it reads as their owner.
    if (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from _me
       or (select proowner from pg_proc where oid = to_regprocedure('student_submit._returned_grade(uuid,uuid)')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.quiz')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.quiz_attempt')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.quiz_key')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.quiz_answer')) is distinct from _me
       or not has_schema_privilege('student_submit', 'create') then
        raise exception 'Run this as the owner of student_submit._session_class, _returned_grade and the quiz tables (% is not). Nothing was changed.', current_user;
    end if;
    for _f in select * from (values
        ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a', null),
        ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37', null),
        ('student_submit._device_session(text)', '86d4747f0dd055fa4a61945046ca64d3', null),
        ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e', null),
        ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101', null),
        ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be', null),
        ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a', null),
        ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3', null),
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', null),
        ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b', null),
        ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd', null),
        ('public._grade_return_holds(uuid)', '51d6525109333424405e826bbc303b90', null),
        ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)', '89899f9dbc1569f7f1cc4216e252eb32', null),
        ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689', null),
        ('public._grade_return_release()', '81222b025ca3625612b1bcd3ff9e2431', null),
        ('public.confirm_quiz(uuid,jsonb,uuid)', 'ee23f2910b1484f18a41ea76b08f0846', null),
        ('student_submit.quiz_result(text,uuid,uuid,text)', null, '8ad540cf01444c8126910300f95dc7d4')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname = 'quiz_result'
                 and oid <> coalesce(to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)'), 0)) then
        raise exception 'A function named quiz_result exists with other arguments or in another schema. Nothing was changed.';
    end if;
    for _f in select * from (values
        ('public.quiz', 'assessment_id uuid, shuffle_questions boolean, shuffle_choices boolean, tries smallint, counts text, shows text, add_total boolean, after_due text, accept_until date, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone'),
        ('public.quiz_key', 'question_id uuid, answer jsonb, tolerance numeric, why text'),
        ('public.quiz_answer', 'attempt_id uuid, question_id uuid, assessment_id uuid, answer jsonb, saved_at timestamp with time zone, given_points numeric, note text')
    ) as v(t, cols) loop
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
          from pg_attribute where attrelid = to_regclass(_f.t) and attnum > 0 and not attisdropped;
        if _cols is distinct from _f.cols then
            raise exception '% is not 2026111804''s (%). Nothing was changed.', _f.t, coalesce(_cols, 'missing');
        end if;
    end loop;
    -- grade_return: only the four columns read, by name and type (the table has others this file does not read).
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
      from pg_attribute where attrelid = to_regclass('public.grade_return') and attnum > 0 and not attisdropped
       and attname in ('enrollment_id', 'assessment_id', 'is_draft', 'returned_at');
    if _cols is distinct from 'enrollment_id uuid, assessment_id uuid, is_draft boolean, returned_at timestamp with time zone' then
        raise exception 'public.grade_return does not have the columns this file reads (%). Nothing was changed.', coalesce(_cols, 'missing');
    end if;
end
$guard$;

-- == 2. The returned view ==
create or replace function student_submit.quiz_result(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s     jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _w     jsonb;
    _z     quiz%rowtype;
    _t     quiz_attempt%rowtype;
    _at    timestamptz;
    _draft boolean;
    _left  int;
begin
    if _s ? 'error' then
        return jsonb_build_object('ok', false, 'error', _s->>'error');
    end if;
    -- The piece as quiz opens it (_quiz_window): anything else is not_found, the same answer for each.
    _w := student_submit._quiz_window(p_assessment_id, (_s->>'course_id')::uuid);
    if _w is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _z from quiz z where z.assessment_id = p_assessment_id;
    select g.returned_at, g.is_draft into _at, _draft
      from grade_return g where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id;
    -- The one confirmed try (quiz_attempt_one_marked_idx).
    select * into _t from quiz_attempt t
     where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id and t.marked is not null;
    _left := case when _z.tries = 0 then null
                  else greatest(_z.tries - (select count(*) from quiz_attempt t where t.assessment_id = p_assessment_id
                                              and t.enrollment_id = p_enrollment_id and t.reopened_at is null), 0)::int end;
    -- Nothing about right and wrong unless all of these hold (the header, and the contract's "MQ3").
    if not coalesce(
           -- 1. Returned to this student, with a grade the student page shows.
           _at is not null
           and (student_submit._returned_grade(p_enrollment_id, p_assessment_id)->>'grade') is not null
           -- 2. The student can no longer answer.
           and not exists (select 1 from quiz_attempt t where t.assessment_id = p_assessment_id
                             and t.enrollment_id = p_enrollment_id and t.sent_at is null)
           and (not (_w->>'open')::boolean or _left = 0)
           -- 3. One try confirmed, and returned since: by the time where saves wait for Return, else no draft waiting.
           and _t.id is not null
           and case when public._grade_return_holds(p_enrollment_id) then _t.marked_at <= _at else not _draft end,
           false) then
        return jsonb_build_object('ok', true, 'returned', false);
    end if;
    -- 4. What the quiz shows.
    return jsonb_build_object('ok', true, 'returned', true, 'shows', _z.shows)
        || case when _z.add_total
                then jsonb_build_object('total', jsonb_build_object('earned', _t.marked->'earned', 'possible', _t.marked->'possible'))
                else '{}'::jsonb end
        || case when _z.shows in ('right', 'answers') then jsonb_build_object('questions', coalesce((
               select jsonb_agg(q.e
                          || jsonb_build_object(
                                 'your_answer', (select n.answer from quiz_answer n
                                                  where n.attempt_id = _t.id and n.question_id = (q.e->>'id')::uuid),
                                 'result', (select m.v->'result' from jsonb_each(_t.marked->'questions') m(k, v)
                                             where case when pg_input_is_valid(m.k, 'uuid') then m.k::uuid end = (q.e->>'id')::uuid
                                             limit 1))
                          || case when _z.shows = 'answers' then jsonb_build_object('answer', k.answer, 'why', k.why)
                                  else '{}'::jsonb end
                          order by q.n)
                 from jsonb_array_elements(student_submit._quiz_questions(p_assessment_id, _t.question_order)) with ordinality q(e, n)
                 left join quiz_key k on k.question_id = (q.e->>'id')::uuid), '[]'::jsonb))
                else '{}'::jsonb end;
end;
$function$;

revoke all on function student_submit.quiz_result(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.quiz_result(text, uuid, uuid, text) to service_role;

-- == 3. The last check: each part that is not as tested is named ==
-- Grants are read from proacl itself, so default privileges show here.
do $after$
declare
    _bad text[] := '{}';
    _got text;
begin
    _got := md5(pg_get_functiondef(to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')));
    if _got is distinct from '8ad540cf01444c8126910300f95dc7d4' then
        _bad := _bad || format('function student_submit.quiz_result(text,uuid,uuid,text) has md5 %s, not %s', coalesce(_got, 'none (missing)'), '8ad540cf01444c8126910300f95dc7d4');
    end if;
    select string_agg(w, ', ' order by w collate "C") into _got
      from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
              from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)') and a.grantee <> p.proowner) x;
    if _got is distinct from 'service_role' then
        _bad := _bad || format('grant: function student_submit.quiz_result(text,uuid,uuid,text) may be run by %s, not service_role', coalesce(_got, 'its owner only'));
    end if;
    if (select proowner from pg_proc where oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)'))
       is distinct from (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) then
        _bad := _bad || 'owner: student_submit.quiz_result is not owned by the owner of _session_class'::text;
    end if;
    if (select provolatile from pg_proc where oid = to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)')) is distinct from 's' then
        _bad := _bad || 'read-only: student_submit.quiz_result is not marked stable'::text;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'student_submit' and p.proname <> 'quiz_result'
                  and strpos(case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end, 'quiz_key') > 0) then
        _bad := _bad || 'the key: a student_submit function other than quiz_result names quiz_key'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$after$;

commit;
