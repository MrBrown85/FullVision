-- Quizzes, MQ2: the student's side (2026-11-18). NOT APPLIED.
--
-- THIS FILE CHANGES ONE EXISTING THING: the check constraint on
-- student_submit.write_log.kind gains the word 'quiz' (dropped and added
-- again in this one transaction). Every kind it allows today it still allows.
-- It changes no existing row, no other table, policy or function, and adds
-- no table. The quiz tables are 2026111804's (MQ1); the teacher's functions
-- are not changed.
--
-- == Why ==
-- Quizzes, slice Q3a (docs/plans/quizzes-plan.md; the contract is
-- migrations/local-test/quizzes-contract.md, "The student's side (MQ2)").
-- A student opens a quiz on their page, saves each answer as they go, and
-- sends the try. This file gives the edge function (service_role) the three
-- functions it calls for that, and three private helpers.
--
-- == What it adds (all in student_submit, security definer, search_path
--    public, student_submit, pg_temp) ==
-- _quiz_window(assessment, course) -> the piece as a quiz this class's
--   students may open (in the class, listed today, not DIBELS, not a pair
--   or group piece, a quiz row):
--   { tries, open, closes_on }, open and closed read as _work_window reads
--   Student Work's, from the quiz's own after_due and accept_until; else null.
-- _quiz_new_order(assessment) -> a new question_order, shuffled as the quiz
--   says.
-- _quiz_questions(assessment, order) -> the active questions in that order,
--   numbered, each with id, number, kind, prompt, points, multiple and its
--   choices (id and text). No key, competency, position or archived question.
-- quiz(session, enrolment, assessment, ip_hash, new_try) -> opens the
--   student's try (the first open starts the first try; a later one only
--   with new_try), and answers the quiz, the try, the questions in this
--   student's order and that try's own answers.
-- quiz_save(session, enrolment, assessment, question, answer, ip_hash) ->
--   one answer, of the right shape for its question, to the student's own
--   open try; null clears it.
-- quiz_send(session, enrolment, assessment, ip_hash) -> closes the try. A
--   sent try is never changed by a student again.
-- NONE OF THE SIX READS quiz_key. Each of the three begins with
-- _session_class (a signed-out session, a paused or withdrawn student, a
-- class with its page off or in the trash, a stopped or expired card are
-- refused); a Draft or a piece not yet assigned is not_found; a closed quiz
-- (quiz_closed), a try beyond the number allowed (no_tries_left) and an
-- answer of the wrong shape (bad_answer) are refused. An unsent try is read
-- and written only through the session that holds its enrolment. Each takes
-- the quiz's row for key share, then the student's advisory lock (the
-- contract's order). Writes share 600 an hour per card (write_log 'quiz').
-- The three are granted to service_role only; the helpers to no role. The
-- edge function signs in as the owner, which runs every function it owns,
-- so the way to stop them is to drop them (the undo's PART 1).
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new functions, as this file
-- leaves them):
--   student_submit._quiz_window(uuid,uuid) (new)                          2eb5a1c0652415e1cd3923b79c22b101
--   student_submit._quiz_new_order(uuid) (new)                            60094583822902bdafa8b0623942e9ef
--   student_submit._quiz_questions(uuid,jsonb) (new)                      774274b707ad660b1d3f2d023edf13be
--   student_submit.quiz(text,uuid,uuid,text,boolean) (new)                0746b4af4f1cadd75b86cc20f49931d3
--   student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text) (new)        106de8942ce40ccc9d51c35d2e4e328a
--   student_submit.quiz_send(text,uuid,uuid,text) (new)                   ebd17424915013d30d69e83c50f1f7de
-- Relied on, unchanged (function, live):
--   student_submit._session_class(text,uuid)                              1ae94981ff32f804d12079a24bd7b41a
--   student_submit._card_refusal(uuid)                                    4b982e451dbd5c9c68916c99d29d2d37
--   student_submit._device_session(text)                                  fa1e510e4ccd3bccbf91e29540a837bb
--   student_submit._write_limit(uuid,text,integer)                        c2edfa96402a2eb7a839db3c106e11a9
--   student_submit._listed(public.assessment,date)                        ee5745a778e8ac1cb56f013d1c3e034e
--   student_submit._work_window(uuid)                                     904f6388c7f2b65bfb9f093f343100e4
--   public._fv_timezone(text)                                             8dbcb5716f155e2441f47416a0b28527
--   public.reopen_quiz(uuid,uuid,uuid)                                    daabc9bbdd81761d4ddfd72b773eca78
--   public._quiz_draft_guard()                                            9e6ed6b0336305322b22c309161472f9
--   public._quiz_attempt_same_class()                                     5b0045acab2f7eb94cf3d8ff75210e1f
-- (_work_window is not called: _quiz_window mirrors its reading of open and
-- closed; reopen_quiz makes tries under the same lock and tries rule.)
-- Each md5 is taken with public on the search path; the file sets its own.
-- Changed: the constraint student_submit.write_log.write_log_kind_check,
--   from  CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text])))
--   to    CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text, 'quiz'::text])))
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the
-- role running it owns write_log, _session_class and the quiz tables; the
-- ten functions it relies on are the definitions it was tested against; its
-- own six are missing or this file's; no function of those names is
-- elsewhere; write_log_kind_check is the 'from' above (or the 'to': a second
-- run) and write_log's only check; the quiz tables have 2026111804's
-- columns, quiz_answer its key and quiz_attempt its one-open-try index; and
-- assessment.collab_mode is still none, pairs or groups.
-- Nothing it compares depends on the database's collation (every text order
-- it aggregates is collate "C"), its time zone or the session's search path
-- (set below). Read-only pre-check: local-test/quizzes-student-live-precheck.sql.
--
-- == Rows ==
-- None changes and none is added. The constraint is checked again against
-- write_log's rows as it is added (a day of rate-limit counters at most).
--
-- == Locks ==
-- Swapping the constraint takes student_submit.write_log to itself for a
-- moment; students' writes that count against a limit wait behind it. After
-- five seconds of waiting the file gives up with nothing applied: run again.
--
-- == Order ==
-- After 2026111805 (MQ1) and 2026111803 (Bulletins M2: the check names its
-- kind). Before the edge function with quiz-routes.ts is deployed. The
-- student page released now calls none of these.
--
-- The last check names each part not as tested. Tested on PostgreSQL 17,
-- ICU en-US and C, and as a role that is not a superuser:
-- migrations/local-test/quizzes_student.py (README.md, "Quizzes, the
-- student's side"). Undo: local-test/quizzes-student-undo.sql. After:
-- local-test/quizzes-student-live-postcheck.sql.
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
    _def  text;
    _cols text;
    _me   oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    -- Run as the owner of write_log, the student functions and the quiz tables (postgres on Supabase, not a
    -- superuser): swapping the check needs the table's owner, and the new functions must belong to the edge
    -- function's role and read the quiz tables as their owner.
    if (select relowner from pg_class where oid = to_regclass('student_submit.write_log')) is distinct from _me
       or (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from _me
       or exists (select 1 from unnest(array['public.quiz', 'public.quiz_question', 'public.quiz_attempt', 'public.quiz_answer']) t
                   where (select relowner from pg_class where oid = to_regclass(t)) is distinct from _me)
       or not has_schema_privilege('student_submit', 'create') then
        raise exception 'Run this as the owner of student_submit.write_log, _session_class and the quiz tables (% is not). Nothing was changed.', current_user;
    end if;
    for _f in select * from (values
        ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a', null),
        ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37', null),
        ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb', null),
        ('student_submit._write_limit(uuid,text,integer)', 'c2edfa96402a2eb7a839db3c106e11a9', null),
        ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e', null),
        ('student_submit._work_window(uuid)', '904f6388c7f2b65bfb9f093f343100e4', null),
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', null),
        ('public.reopen_quiz(uuid,uuid,uuid)', 'daabc9bbdd81761d4ddfd72b773eca78', null),
        ('public._quiz_draft_guard()', '9e6ed6b0336305322b22c309161472f9', null),
        ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f', null),
        ('student_submit._quiz_window(uuid,uuid)', null, '2eb5a1c0652415e1cd3923b79c22b101'),
        ('student_submit._quiz_new_order(uuid)', null, '60094583822902bdafa8b0623942e9ef'),
        ('student_submit._quiz_questions(uuid,jsonb)', null, '774274b707ad660b1d3f2d023edf13be'),
        ('student_submit.quiz(text,uuid,uuid,text,boolean)', null, '0746b4af4f1cadd75b86cc20f49931d3'),
        ('student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)', null, '106de8942ce40ccc9d51c35d2e4e328a'),
        ('student_submit.quiz_send(text,uuid,uuid,text)', null, 'ebd17424915013d30d69e83c50f1f7de')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname in ('_quiz_window', '_quiz_new_order', '_quiz_questions', 'quiz', 'quiz_save', 'quiz_send')
                 and oid not in (select coalesce(to_regprocedure(x), 0) from unnest(array['student_submit._quiz_window(uuid,uuid)',
                     'student_submit._quiz_new_order(uuid)', 'student_submit._quiz_questions(uuid,jsonb)',
                     'student_submit.quiz(text,uuid,uuid,text,boolean)', 'student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)',
                     'student_submit.quiz_send(text,uuid,uuid,text)']) x)) then
        raise exception 'A function of this file''s names exists with other arguments or in another schema. Nothing was changed.';
    end if;
    -- write_log's kind check: today's (Bulletins' M2 applied), or this file's (a second run), and its only check.
    select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname collate "C", c.oid) into _def
      from pg_constraint c where c.conrelid = to_regclass('student_submit.write_log') and c.contype = 'c';
    if _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))'
       and _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text])))' then
        raise exception 'student_submit.write_log''s check is not the one this file was written against (%). Nothing was changed.', coalesce(_def, 'none');
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'student_submit.write_log'::regclass
                     and conname = 'write_log_kind_check' and contype = 'c' and convalidated) then
        raise exception 'student_submit.write_log has no validated check named write_log_kind_check. Nothing was changed.';
    end if;
    -- MQ1's tables, as 2026111804 made them.
    for _f in select * from (values
        ('public.quiz', 'assessment_id uuid, shuffle_questions boolean, shuffle_choices boolean, tries smallint, counts text, shows text, add_total boolean, after_due text, accept_until date, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_question', 'id uuid, assessment_id uuid, position integer, kind text, prompt text, choices jsonb, multiple boolean, points numeric, tag_id uuid, archived_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone'),
        ('public.quiz_answer', 'attempt_id uuid, question_id uuid, assessment_id uuid, answer jsonb, saved_at timestamp with time zone, given_points numeric, note text')
    ) as v(t, cols) loop
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
          from pg_attribute where attrelid = to_regclass(_f.t) and attnum > 0 and not attisdropped;
        if _cols is distinct from _f.cols then
            raise exception '% is not 2026111804''s (%). Apply 2026111804 and 2026111805 first. Nothing was changed.', _f.t, coalesce(_cols, 'missing');
        end if;
    end loop;
    -- The key quiz_save writes on, and the index that keeps one unsent try per student.
    if (select array_agg(a.attname::text order by a.attname::text collate "C") from pg_constraint c join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.conrelid = 'public.quiz_answer'::regclass and c.contype = 'p') is distinct from array['attempt_id', 'question_id']
       or not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.quiz_attempt_one_open_idx') and i.indisunique
                        and i.indrelid = 'public.quiz_attempt'::regclass) then
        raise exception 'quiz_answer lacks its key (attempt_id, question_id) or quiz_attempt its one-open-try index. Nothing was changed.';
    end if;
    -- A pair or group piece is never served as a quiz: _quiz_window serves collab_mode none only, so that word must
    -- still mean a piece of one student's own.
    if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.assessment'::regclass and conname = 'assessment_collab_mode_check')
       is distinct from 'CHECK ((collab_mode = ANY (ARRAY[''none''::text, ''pairs''::text, ''groups''::text])))' then
        raise exception 'assessment.collab_mode is not none, pairs or groups as this file was written against. Nothing was changed.';
    end if;
end
$guard$;

-- == 2. The write limit knows 'quiz' ==
-- Dropped and added in one statement, inside this transaction: no moment without a check. Only when it is
-- still today's (a second run skips it).
do $kind$
begin
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))' then
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check
                check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text, 'quiz'::text]));
    end if;
end
$kind$;

-- == 3. The helpers (no role may call them) ==
create or replace function student_submit._quiz_window(p_assessment_id uuid, p_course_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    -- The piece as a quiz this class's students may open, or null: in this class, listed today in the
    -- class's time zone (not a Draft, assigned), not DIBELS, not a pair or group piece (save_quiz refuses
    -- those, but the teacher may switch a quiz's piece to Pairs or Groups after), with a quiz. Open and
    -- closed are read as _work_window reads Student Work's, from the quiz's own after_due and accept_until.
    select jsonb_build_object(
               'tries', z.tries,
               'open', case z.after_due when 'until' then d.today <= z.accept_until
                                        when 'stop' then a.due_date is null or d.today <= a.due_date
                                        else true end,
               'closes_on', case z.after_due when 'until' then z.accept_until when 'stop' then a.due_date end)
      from assessment a
      join course c on c.id = a.course_id
      join quiz z on z.assessment_id = a.id
     cross join lateral (select (now() at time zone public._fv_timezone(c.timezone))::date as today) d
     where a.id = p_assessment_id and a.course_id = p_course_id and a.score_mode <> 'dibels'
       and a.collab_mode = 'none' and student_submit._listed(a, d.today);
$function$;

create or replace function student_submit._quiz_new_order(p_assessment_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    -- Every active question, shuffled when the quiz says so, else in position order; each choice question's
    -- choices, shuffled when the quiz says so, else in the teacher's order. Made once, when a try starts.
    select jsonb_build_object(
        'questions', coalesce((select jsonb_agg(x.id order by case when z.shuffle_questions then random() end, x.position, x.id)
                                 from quiz_question x where x.assessment_id = z.assessment_id and x.archived_at is null), '[]'::jsonb),
        'choices', coalesce((select jsonb_object_agg(x.id::text,
                                        (select jsonb_agg(e->'id' order by case when z.shuffle_choices then random() end, t)
                                           from jsonb_array_elements(x.choices) with ordinality c(e, t)))
                               from quiz_question x
                              where x.assessment_id = z.assessment_id and x.archived_at is null and x.kind = 'choice'), '{}'::jsonb))
      from quiz z where z.assessment_id = p_assessment_id;
$function$;

create or replace function student_submit._quiz_questions(p_assessment_id uuid, p_order jsonb)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    -- The active questions in this order: those it names, as it names them, then any added since, by position;
    -- within a question the choices it names, then any added since, in the teacher's order. Numbered 1, 2, ...
    -- Only what a student may see: no key, no competency, no position, nothing archived.
    with q as (
        select x.id, x.position, x.kind, x.prompt, x.points, x.multiple, x.choices,
               (select min(o.n) from jsonb_array_elements_text(p_order->'questions') with ordinality o(id, n)
                 where o.id = x.id::text collate "C") as n
          from quiz_question x where x.assessment_id = p_assessment_id and x.archived_at is null),
    k as (select q.*, row_number() over (order by q.n nulls last, q.position, q.id) as num from q)
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', k.id, 'number', k.num, 'kind', k.kind, 'prompt', k.prompt, 'points', k.points, 'multiple', k.multiple,
               'choices', (select jsonb_agg(jsonb_build_object('id', e->'id', 'text', e->'text')
                                            order by (select min(o.n) from jsonb_array_elements_text(p_order->'choices'->(k.id::text))
                                                                      with ordinality o(id, n) where o.id = (e->>'id') collate "C") nulls last, t)
                             from jsonb_array_elements(k.choices) with ordinality c(e, t)))
               order by k.num), '[]'::jsonb)
      from k;
$function$;

revoke all on function student_submit._quiz_window(uuid, uuid), student_submit._quiz_new_order(uuid),
    student_submit._quiz_questions(uuid, jsonb) from public, anon, authenticated, service_role;

-- == 4. Open the quiz ==
create or replace function student_submit.quiz(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text, p_new_try boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s    jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _w    jsonb;
    _t    quiz_attempt%rowtype;
    _open boolean;
    _ord  int;
    _all  int;
    _left int;
    _no   jsonb;
begin
    if _s ? 'error' then
        return jsonb_build_object('ok', false, 'error', _s->>'error');
    end if;
    -- Locks, in the contract's order: the piece for share (an Unassign waits for a try made here, or this sees
    -- the Draft), the quiz for key share, then the student's tries.
    perform 1 from assessment a where a.id = p_assessment_id and a.course_id = (_s->>'course_id')::uuid for share;
    perform 1 from quiz z where z.assessment_id = p_assessment_id
       and exists (select 1 from assessment a where a.id = z.assessment_id and a.course_id = (_s->>'course_id')::uuid) for key share;
    _w := student_submit._quiz_window(p_assessment_id, (_s->>'course_id')::uuid);
    if _w is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    perform pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(p_assessment_id::text || ':' || p_enrollment_id::text));
    _open := (_w->>'open')::boolean;
    select count(*) filter (where t.reopened_at is null), count(*) into _ord, _all
      from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id;
    select * into _t from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id and t.sent_at is null;
    if _t.id is not null and _t.question_order is null then
        -- A try the teacher's Reopen made: it starts now, in an order of its own.
        _no := student_submit._write_limit((_s->>'card_id')::uuid, 'quiz', 600);
        if _no is not null then
            return _no;
        end if;
        update quiz_attempt set question_order = student_submit._quiz_new_order(p_assessment_id), started_at = now()
         where id = _t.id returning * into _t;
    elsif _t.id is null and (_all = 0 or p_new_try) then
        _left := case when (_w->>'tries')::int = 0 then null else greatest((_w->>'tries')::int - _ord, 0) end;
        if _open and (_left is null or _left > 0) then
            _no := student_submit._write_limit((_s->>'card_id')::uuid, 'quiz', 600);
            if _no is not null then
                return _no;
            end if;
            insert into quiz_attempt (assessment_id, enrollment_id, try, question_order, started_at)
            values (p_assessment_id, p_enrollment_id,
                    coalesce((select max(t.try) from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id), 0) + 1,
                    student_submit._quiz_new_order(p_assessment_id), now())
            returning * into _t;
            _ord := _ord + 1;
        elsif p_new_try then
            return jsonb_build_object('ok', false, 'error', case when _open then 'no_tries_left' else 'quiz_closed' end);
        end if;
    end if;
    -- With no open try, the latest sent one.
    if _t.id is null then
        select * into _t from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id
           and t.sent_at is not null order by t.try desc limit 1;
    end if;
    _left := case when (_w->>'tries')::int = 0 then null else greatest((_w->>'tries')::int - _ord, 0) end;
    return jsonb_build_object(
        'ok', true,
        'quiz', jsonb_build_object('tries', _w->'tries', 'tries_left', _left, 'closed', not _open, 'closes_on', _w->'closes_on'),
        'try', case when _t.id is not null then jsonb_build_object(
                   'number', _t.try, 'sent', _t.sent_at is not null, 'started_at', _t.started_at, 'sent_at', _t.sent_at,
                   'reopened', _t.reopened_at is not null) end,
        'sent_tries', (select count(*) from quiz_attempt t
                        where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id and t.sent_at is not null),
        'can_answer', _t.id is not null and _t.sent_at is null and (_t.reopened_at is not null or _open),
        'can_try_again', (_t.id is null or _t.sent_at is not null) and _open and (_left is null or _left > 0),
        'questions', case when _t.id is null then '[]'::jsonb else student_submit._quiz_questions(p_assessment_id, _t.question_order) end,
        -- This try's own answers, to the questions it shows.
        'answers', coalesce((select jsonb_object_agg(a.question_id::text, a.answer)
                               from quiz_answer a join quiz_question x on x.id = a.question_id and x.archived_at is null
                              where a.attempt_id = _t.id), '{}'::jsonb));
end;
$function$;

-- == 5. Save one answer ==
create or replace function student_submit.quiz_save(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_question_id uuid, p_answer jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s  jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _w  jsonb;
    _t  quiz_attempt%rowtype;
    _q  quiz_question%rowtype;
    _a  jsonb;
    _at timestamptz;
    _no jsonb;
begin
    if _s ? 'error' then
        return jsonb_build_object('ok', false, 'error', _s->>'error');
    end if;
    -- The quiz for key share before an answer is written: a question cannot be deleted under it.
    perform 1 from quiz z where z.assessment_id = p_assessment_id
       and exists (select 1 from assessment a where a.id = z.assessment_id and a.course_id = (_s->>'course_id')::uuid) for key share;
    _w := student_submit._quiz_window(p_assessment_id, (_s->>'course_id')::uuid);
    if _w is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    perform pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(p_assessment_id::text || ':' || p_enrollment_id::text));
    select * into _t from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id and t.sent_at is null;
    if _t.id is null or _t.started_at is null then
        return jsonb_build_object('ok', false, 'error',
            case when exists (select 1 from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id
                                 and t.sent_at is not null) then 'sent' else 'not_found' end);
    end if;
    if _t.reopened_at is null and not (_w->>'open')::boolean then
        return jsonb_build_object('ok', false, 'error', 'quiz_closed');
    end if;
    select * into _q from quiz_question x where x.id = p_question_id and x.assessment_id = p_assessment_id and x.archived_at is null;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    -- The raw answer's shape for the question's kind; anything else is bad_answer. Null clears it.
    if p_answer is not null and jsonb_typeof(p_answer) <> 'null' then
        if _q.kind = 'choice' then
            if jsonb_typeof(p_answer) = 'array' then
                if jsonb_array_length(p_answer) between 1 and (case when _q.multiple then 20 else 1 end)
                   and not exists (select 1 from jsonb_array_elements(p_answer) r
                                    where not exists (select 1 from jsonb_array_elements(_q.choices) c where c->'id' = r))
                   and (select count(distinct r) from jsonb_array_elements(p_answer) r) = jsonb_array_length(p_answer) then
                    select jsonb_agg(r order by (r #>> '{}') collate "C") into _a from jsonb_array_elements(p_answer) r;
                end if;
            end if;
        elsif _q.kind = 'true_false' then
            if jsonb_typeof(p_answer) = 'boolean' then
                _a := p_answer;
            end if;
        elsif _q.kind = 'number' then
            if jsonb_typeof(p_answer) = 'number' then
                if abs((p_answer #>> '{}')::numeric) <= 1e12 then
                    _a := p_answer;
                end if;
            end if;
        elsif jsonb_typeof(p_answer) = 'string' then
            -- White space at either end trimmed (ASCII's, the same under every collation).
            _a := to_jsonb(regexp_replace((p_answer #>> '{}') collate "C", '^[[:space:]]+|[[:space:]]+$', '', 'g'));
            if char_length(_a #>> '{}') not between 1 and 5000 then
                _a := null;
            end if;
        end if;
        if _a is null then
            return jsonb_build_object('ok', false, 'error', 'bad_answer', 'question_id', _q.id);
        end if;
    end if;
    _no := student_submit._write_limit((_s->>'card_id')::uuid, 'quiz', 600);
    if _no is not null then
        return _no;
    end if;
    if _a is null then
        delete from quiz_answer where attempt_id = _t.id and question_id = _q.id;
        _at := clock_timestamp();
    else
        insert into quiz_answer (attempt_id, question_id, assessment_id, answer, saved_at)
        values (_t.id, _q.id, p_assessment_id, _a, clock_timestamp())
        on conflict (attempt_id, question_id) do update
            set answer = excluded.answer, saved_at = excluded.saved_at, given_points = null, note = null
        returning saved_at into _at;
    end if;
    return jsonb_build_object('ok', true, 'question_id', _q.id, 'saved_at', _at);
end;
$function$;

-- == 6. Send the try ==
create or replace function student_submit.quiz_send(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s    jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _w    jsonb;
    _t    quiz_attempt%rowtype;
    _left int;
    _no   jsonb;
begin
    if _s ? 'error' then
        return jsonb_build_object('ok', false, 'error', _s->>'error');
    end if;
    perform 1 from quiz z where z.assessment_id = p_assessment_id
       and exists (select 1 from assessment a where a.id = z.assessment_id and a.course_id = (_s->>'course_id')::uuid) for key share;
    _w := student_submit._quiz_window(p_assessment_id, (_s->>'course_id')::uuid);
    if _w is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    perform pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(p_assessment_id::text || ':' || p_enrollment_id::text));
    select * into _t from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id and t.sent_at is null;
    if _t.id is null or _t.started_at is null then
        return jsonb_build_object('ok', false, 'error',
            case when exists (select 1 from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id
                                 and t.sent_at is not null) then 'sent' else 'not_found' end);
    end if;
    if _t.reopened_at is null and not (_w->>'open')::boolean then
        return jsonb_build_object('ok', false, 'error', 'quiz_closed');
    end if;
    _no := student_submit._write_limit((_s->>'card_id')::uuid, 'quiz', 600);
    if _no is not null then
        return _no;
    end if;
    update quiz_attempt set sent_at = clock_timestamp() where id = _t.id returning * into _t;
    select case when (_w->>'tries')::int = 0 then null else greatest((_w->>'tries')::int - count(*), 0) end into _left
      from quiz_attempt t where t.assessment_id = p_assessment_id and t.enrollment_id = p_enrollment_id and t.reopened_at is null;
    return jsonb_build_object('ok', true, 'try', _t.try, 'sent_at', _t.sent_at, 'tries_left', _left,
                              'can_try_again', (_w->>'open')::boolean and (_left is null or _left > 0));
end;
$function$;

revoke all on function student_submit.quiz(text, uuid, uuid, text, boolean), student_submit.quiz_save(text, uuid, uuid, uuid, jsonb, text),
    student_submit.quiz_send(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.quiz(text, uuid, uuid, text, boolean), student_submit.quiz_save(text, uuid, uuid, uuid, jsonb, text),
    student_submit.quiz_send(text, uuid, uuid, text) to service_role;

-- == 7. The last check: each part that is not as tested is named ==
-- Grants are read from proacl itself, so default privileges show here.
do $after$
declare
    _bad text[] := '{}';
    _f   record;
    _got text;
begin
    for _f in select * from (values
        ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101', null),
        ('student_submit._quiz_new_order(uuid)', '60094583822902bdafa8b0623942e9ef', null),
        ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be', null),
        ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3', 'service_role'),
        ('student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)', '106de8942ce40ccc9d51c35d2e4e328a', 'service_role'),
        ('student_submit.quiz_send(text,uuid,uuid,text)', 'ebd17424915013d30d69e83c50f1f7de', 'service_role')
    ) as v(fn, now, runs) loop
        _got := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _got is distinct from _f.now then
            _bad := _bad || format('function %s has md5 %s, not %s', _f.fn, coalesce(_got, 'none (missing)'), _f.now);
        end if;
        select string_agg(w, ', ' order by w collate "C") into _got
          from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(_f.fn) and a.grantee <> p.proowner) x;
        if _got is distinct from _f.runs then
            _bad := _bad || format('grant: function %s may be run by %s, not %s', _f.fn, coalesce(_got, 'its owner only'), coalesce(_f.runs, 'its owner only'));
        end if;
        if (select proowner from pg_proc where oid = to_regprocedure(_f.fn))
           is distinct from (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) then
            _bad := _bad || format('owner: function %s is not owned by the owner of _session_class', _f.fn);
        end if;
    end loop;
    if (select string_agg(pg_get_constraintdef(c.oid) || ' ' || c.convalidated::text, ' | ' order by c.conname collate "C", c.oid)
          from pg_constraint c where c.conrelid = 'student_submit.write_log'::regclass and c.contype = 'c')
       is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text]))) true' then
        _bad := _bad || 'check: write_log_kind_check is not the six kinds, validated, as write_log''s only check'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$after$;

commit;
