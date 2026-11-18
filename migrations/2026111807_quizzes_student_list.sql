-- Quizzes, MQ2b: the student page lists which pieces are quizzes (2026-11-18). NOT APPLIED.
--
-- THIS FILE CHANGES NO EXISTING ROW, TABLE, POLICY, CONSTRAINT OR FUNCTION.
-- It adds one read-only function, student_submit.quiz_list, for the
-- student-submit edge function (service_role) only. student_submit.page, the
-- released student page's own function, and its reply are not changed.
--
-- == Why ==
-- Quizzes, slice Q3a (docs/plans/quizzes-plan.md; the contract is
-- migrations/local-test/quizzes-contract.md, "The student's side (MQ2)",
-- "quiz_list"). The student's quiz screen (Q3b) must know which pieces on
-- the student's page are quizzes, and opening one with quiz (2026111806)
-- starts a try. quiz_list says which are, and how each stands, without
-- starting or writing anything.
--
-- == What it adds (in student_submit, security definer, stable, search_path
--    public, student_submit, pg_temp) ==
-- quiz_list(p_session_token, p_enrollment_id, p_ip_hash) -> { ok, quizzes:
--   [{ assessment_id, tries_left, can_answer, closed, has_open_try }] }: for
--   the session's class, every piece the student may open as a quiz, by the
--   one rule quiz itself follows (_quiz_window: in the class, listed today,
--   not a Draft, not DIBELS, not a pair or group piece, a quiz row), in
--   assessment id order; for each, this student's own tries as quiz would
--   count them. It begins with _session_class (a signed-out session, a paused
--   or withdrawn student, a class with its page off or in the trash, a
--   stopped or expired card are refused, as on every route). IT DOES NOT READ
--   quiz_key, quiz_question or quiz_answer, and sends nothing of another
--   student. It writes nothing: no try, no row lock, no write_log row (it is
--   marked stable, which PostgreSQL holds to: a stable function cannot take
--   a row lock or write). It takes no lock on the quiz row: the contract's
--   key-share rule is for a function that writes an answer, and this one
--   writes nothing a delete could meet.
-- Granted to service_role only. The edge function signs in as the owner,
-- which runs every function it owns, so the way to stop it is to drop it
-- (the undo's PART 1).
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new function, as this file
-- leaves it):
--   student_submit.quiz_list(text,uuid,text) (new)                        51453e03b4293ff17eb598ab653dc0f2
-- Relied on, unchanged (function, live):
--   student_submit._session_class(text,uuid)                              1ae94981ff32f804d12079a24bd7b41a
--   student_submit._card_refusal(uuid)                                    4b982e451dbd5c9c68916c99d29d2d37
--   student_submit._device_session(text)                                  fa1e510e4ccd3bccbf91e29540a837bb
--   student_submit._listed(public.assessment,date)                        ee5745a778e8ac1cb56f013d1c3e034e
--   student_submit._quiz_window(uuid,uuid)                                2eb5a1c0652415e1cd3923b79c22b101
--   student_submit.quiz(text,uuid,uuid,text,boolean)                      0746b4af4f1cadd75b86cc20f49931d3
--   public._fv_timezone(text)                                             8dbcb5716f155e2441f47416a0b28527
-- (quiz is not called: quiz_list counts tries as quiz counts them, so a change
-- to quiz stops this file until the two are checked to agree.)
-- Each md5 is taken with public on the search path; the file sets its own.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the
-- role running it owns _session_class and public.quiz_attempt and may create
-- in student_submit; the seven functions it relies on are the definitions it
-- was tested against; its own is missing or this file's; no function named
-- quiz_list is elsewhere; quiz and quiz_attempt have 2026111804's columns.
-- Nothing it compares depends on the database's collation, time zone or the
-- session's search path (set below). Read-only pre-check:
-- local-test/quizzes-student-list-live-precheck.sql.
--
-- == Rows and locks ==
-- None changes and none is added. It takes no lock on any table (one
-- function created). Five seconds of waiting for anything and it gives up.
--
-- == Order ==
-- After 2026111806 (MQ2: it reads _quiz_window). Before the edge function
-- with the quiz-list route is deployed. The student page released now calls
-- nothing of it.
--
-- The last check names each part not as tested. Tested on PostgreSQL 17,
-- ICU en-US and C, and as a role that is not a superuser:
-- migrations/local-test/quizzes_student_list.py (README.md, "Quizzes, the
-- student page's list"). Undo: local-test/quizzes-student-list-undo.sql.
-- After: local-test/quizzes-student-list-live-postcheck.sql.
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
    -- new function must belong to the edge function's role and read the quiz tables as their owner.
    if (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.quiz_attempt')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('public.quiz')) is distinct from _me
       or not has_schema_privilege('student_submit', 'create') then
        raise exception 'Run this as the owner of student_submit._session_class and the quiz tables (% is not). Nothing was changed.', current_user;
    end if;
    for _f in select * from (values
        ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a', null),
        ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37', null),
        ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb', null),
        ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e', null),
        ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101', null),
        ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3', null),
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', null),
        ('student_submit.quiz_list(text,uuid,text)', null, '51453e03b4293ff17eb598ab653dc0f2')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname = 'quiz_list'
                 and oid <> coalesce(to_regprocedure('student_submit.quiz_list(text,uuid,text)'), 0)) then
        raise exception 'A function named quiz_list exists with other arguments or in another schema. Nothing was changed.';
    end if;
    for _f in select * from (values
        ('public.quiz', 'assessment_id uuid, shuffle_questions boolean, shuffle_choices boolean, tries smallint, counts text, shows text, add_total boolean, after_due text, accept_until date, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone')
    ) as v(t, cols) loop
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
          from pg_attribute where attrelid = to_regclass(_f.t) and attnum > 0 and not attisdropped;
        if _cols is distinct from _f.cols then
            raise exception '% is not 2026111804''s (%). Apply 2026111804 to 2026111806 first. Nothing was changed.', _f.t, coalesce(_cols, 'missing');
        end if;
    end loop;
end
$guard$;

-- == 2. Which pieces are quizzes, and how each stands for this student ==
create or replace function student_submit.quiz_list(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
begin
    if _s ? 'error' then
        return jsonb_build_object('ok', false, 'error', _s->>'error');
    end if;
    -- Every piece of the session's class that quiz would open (the one rule, _quiz_window), and this student's
    -- own tries, counted as quiz counts them. Nothing of the questions, the key or the answers is read.
    return jsonb_build_object('ok', true, 'quizzes', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'assessment_id', x.id,
                   'tries_left', x.left_,
                   'can_answer', case when x.open_try then x.reopened or x.open
                                      else x.open and (x.left_ is null or x.left_ > 0) end,
                   'closed', not x.open,
                   'has_open_try', x.open_try)
                   order by x.id)
          from (select z.assessment_id as id, (w.w->>'open')::boolean as open,
                       case when z.tries = 0 then null
                            else greatest(z.tries - (select count(*) from quiz_attempt t
                                                      where t.assessment_id = z.assessment_id and t.enrollment_id = p_enrollment_id
                                                        and t.reopened_at is null), 0)::int end as left_,
                       o.id is not null as open_try, o.reopened_at is not null as reopened
                  from quiz z
                  join assessment a on a.id = z.assessment_id and a.course_id = (_s->>'course_id')::uuid
                 cross join lateral (select student_submit._quiz_window(z.assessment_id, a.course_id) as w) w
                  left join quiz_attempt o on o.assessment_id = z.assessment_id and o.enrollment_id = p_enrollment_id
                                          and o.sent_at is null
                 where w.w is not null) x), '[]'::jsonb));
end;
$function$;

revoke all on function student_submit.quiz_list(text, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.quiz_list(text, uuid, text) to service_role;

-- == 3. The last check: each part that is not as tested is named ==
-- Grants are read from proacl itself, so default privileges show here.
do $after$
declare
    _bad text[] := '{}';
    _got text;
begin
    _got := md5(pg_get_functiondef(to_regprocedure('student_submit.quiz_list(text,uuid,text)')));
    if _got is distinct from '51453e03b4293ff17eb598ab653dc0f2' then
        _bad := _bad || format('function student_submit.quiz_list(text,uuid,text) has md5 %s, not %s', coalesce(_got, 'none (missing)'), '51453e03b4293ff17eb598ab653dc0f2');
    end if;
    select string_agg(w, ', ' order by w collate "C") into _got
      from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
              from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)') and a.grantee <> p.proowner) x;
    if _got is distinct from 'service_role' then
        _bad := _bad || format('grant: function student_submit.quiz_list(text,uuid,text) may be run by %s, not service_role', coalesce(_got, 'its owner only'));
    end if;
    if (select proowner from pg_proc where oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)'))
       is distinct from (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) then
        _bad := _bad || 'owner: student_submit.quiz_list is not owned by the owner of _session_class'::text;
    end if;
    if (select provolatile from pg_proc where oid = to_regprocedure('student_submit.quiz_list(text,uuid,text)')) is distinct from 's' then
        _bad := _bad || 'read-only: student_submit.quiz_list is not marked stable'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$after$;

commit;
