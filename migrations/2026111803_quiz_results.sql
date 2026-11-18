-- Quizzes, MQ1 part 2: the results functions (2026-11-17). NOT APPLIED.
--
-- THIS FILE CHANGES NO EXISTING ROW, TABLE, POLICY, CONSTRAINT OR FUNCTION.
-- It adds three functions a teacher may run, on the tables of
-- 2026111802_quizzes.sql, which must be applied first. Split from it to keep
-- each file under 40 KB. The contract: migrations/local-test/quizzes-contract.md.
--
-- public.mark_quiz_answer  the teacher's points for a Text answer (0 to the
--                          question's points) and a note, on a sent try only.
-- public.reopen_quiz       one more try for one student: beyond the quiz's
--                          number, answerable after the quiz closes.
-- public.confirm_quiz      stores what the teacher's app confirmed (marked)
--                          on each named sent try, one confirmed try per
--                          student. WRITES NO SCORE, tag score, rubric score
--                          or returned grade; it checks only shape and owner.
-- The class's teacher only (fv_owns_assessment), authenticated only,
-- idempotent (fv_idem_check / fv_idem_store). No grade math.
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new functions, as this file
-- leaves them):
--   public.mark_quiz_answer(uuid,uuid,numeric,text,uuid) (new)   77bd2789ea9f46790f6eef639a605c24
--   public.reopen_quiz(uuid,uuid,uuid) (new)                     daabc9bbdd81761d4ddfd72b773eca78
--   public.confirm_quiz(uuid,jsonb,uuid) (new)                   8380e8fa33795295b97e17623376414f
-- Relied on, unchanged (function, live, and 2026111802's):
--   public.fv_owns_assessment(uuid)                              9f4c680c35f9f3ac32e8290824707673
--   public.fv_idem_check(uuid,text)                              1c7b546434bee4b774557e0e6b16024f
--   public.fv_idem_store(uuid,text,jsonb)                        6d0b48c458d273a332db39e1a4b68626
--   public._quiz_attempt_same_class()                            5b0045acab2f7eb94cf3d8ff75210e1f
--
-- Checks first: it stops with nothing changed unless the four functions it
-- relies on are as tested (the last says 2026111802 is applied), its own
-- three are missing or this file's, no function of those names is elsewhere,
-- and the three tables it writes have 2026111802's columns. Read-only
-- pre-check: migrations/local-test/quiz-results-live-precheck.sql.
--
-- Rows: none changes. Locks: none on an existing table (functions only).
-- Tested with 2026111802 by migrations/local-test/quizzes.py. Undo:
-- quiz-results-undo.sql. After: quiz-results-live-postcheck.sql.
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f    record;
    _md5  text;
    _cols text;
begin
    for _f in select * from (values
        ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673', null),
        ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f', null),
        ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626', null),
        ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f', null),
        ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', null, '77bd2789ea9f46790f6eef639a605c24'),
        ('public.reopen_quiz(uuid,uuid,uuid)', null, 'daabc9bbdd81761d4ddfd72b773eca78'),
        ('public.confirm_quiz(uuid,jsonb,uuid)', null, '8380e8fa33795295b97e17623376414f')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname in ('mark_quiz_answer', 'reopen_quiz', 'confirm_quiz')
                 and oid not in (select coalesce(to_regprocedure(x), 0) from unnest(array['public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)',
                     'public.reopen_quiz(uuid,uuid,uuid)', 'public.confirm_quiz(uuid,jsonb,uuid)']) x)) then
        raise exception 'A quiz results function exists with other arguments or in another schema. Nothing was changed.';
    end if;
    for _f in select * from (values
        ('public.quiz_question', 'id uuid, assessment_id uuid, position integer, kind text, prompt text, choices jsonb, multiple boolean, points numeric, tag_id uuid, archived_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone'),
        ('public.quiz_answer', 'attempt_id uuid, question_id uuid, assessment_id uuid, answer jsonb, saved_at timestamp with time zone, given_points numeric, note text')
    ) as v(t, cols) loop
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
          from pg_attribute where attrelid = to_regclass(_f.t) and attnum > 0 and not attisdropped;
        if _cols is distinct from _f.cols then
            raise exception '% is not 2026111802''s (%). Apply 2026111802_quizzes.sql first. Nothing was changed.', _f.t, coalesce(_cols, 'missing');
        end if;
    end loop;
end
$guard$;

create or replace function public.mark_quiz_answer(p_attempt_id uuid, p_question_id uuid, p_points numeric, p_note text, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _t      record;
    _q      record;
    _note   text := nullif(btrim(p_note), '');
    _out    jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'mark_quiz_answer');
    if _cached is not null then
        return _cached;
    end if;
    select t.assessment_id, t.sent_at into _t from quiz_attempt t join enrollment e on e.id = t.enrollment_id
     where t.id = p_attempt_id and e.withdrawn_at is null;
    if not found or not fv_owns_assessment(_t.assessment_id) then raise exception 'not found' using errcode = 'P0002'; end if;
    perform 1 from assessment where id = _t.assessment_id for key share;
    perform 1 from quiz where assessment_id = _t.assessment_id for key share;
    select x.kind, x.points into _q from quiz_question x where x.id = p_question_id and x.assessment_id = _t.assessment_id;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    if _t.sent_at is null then
        raise exception 'not_sent' using errcode = '22023', detail = 'This try has not been sent.';
    end if;
    if _q.kind <> 'text' then
        raise exception 'not_text' using errcode = '22023', detail = 'Only a text answer is given points by hand.';
    end if;
    if p_points < 0 or p_points > _q.points then
        raise exception 'bad_points' using errcode = '22023', detail = format('Points are 0 to %s on this question.', _q.points);
    end if;
    if char_length(_note) > 1000 then
        raise exception 'bad_note' using errcode = '22023', detail = 'A note is 1000 characters at most.';
    end if;
    update quiz_answer set given_points = p_points, note = _note
     where attempt_id = p_attempt_id and question_id = p_question_id
    returning jsonb_build_object('answer', jsonb_build_object('attempt_id', attempt_id, 'question_id', question_id,
                                                             'given_points', given_points, 'note', note)) into _out;
    if _out is null then raise exception 'not found' using errcode = 'P0002'; end if;
    perform fv_idem_store(p_idempotency_key, 'mark_quiz_answer', _out);
    return _out;
end;
$function$;

create or replace function public.reopen_quiz(p_assessment_id uuid, p_enrollment_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _a      record;
    _t      quiz_attempt%rowtype;
    _made   boolean := false;
    _out    jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'reopen_quiz');
    if _cached is not null then
        return _cached;
    end if;
    if not fv_owns_assessment(p_assessment_id) then raise exception 'not found' using errcode = 'P0002'; end if;
    -- For share, as a student's start of a try: an Unassign waits for this try, or this sees the Draft.
    select a.course_id, a.is_draft into _a from assessment a where a.id = p_assessment_id for share;
    perform 1 from quiz where assessment_id = p_assessment_id for key share;
    if not found or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.course_id = _a.course_id and e.withdrawn_at is null) then
        raise exception 'not found' using errcode = 'P0002';
    end if;
    if _a.is_draft then
        raise exception 'draft' using errcode = '22023', detail = 'This piece is a Draft: students cannot see it yet.';
    end if;
    perform pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(p_assessment_id::text || ':' || p_enrollment_id::text));
    select * into _t from quiz_attempt where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and sent_at is null;
    if found then
        if _t.reopened_at is null then
            update quiz_attempt set reopened_at = now() where id = _t.id returning * into _t;
        end if;
    else
        insert into quiz_attempt (assessment_id, enrollment_id, try, reopened_at)
        values (p_assessment_id, p_enrollment_id,
                coalesce((select max(try) from quiz_attempt where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id), 0) + 1, now())
        returning * into _t;
        _made := true;
    end if;
    _out := jsonb_build_object('attempt', jsonb_build_object('attempt_id', _t.id, 'try', _t.try, 'reopened_at', _t.reopened_at,
                                                             'started', _t.started_at is not null), 'made', _made);
    perform fv_idem_store(p_idempotency_key, 'reopen_quiz', _out);
    return _out;
end;
$function$;

create or replace function public.confirm_quiz(p_assessment_id uuid, p_marks jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _it     jsonb;
    _m      jsonb;
    _e      uuid;
    _t      quiz_attempt%rowtype;
    _bad    text;
    _ids    uuid[];
    _done   jsonb := '[]'::jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'confirm_quiz');
    if _cached is not null then
        return _cached;
    end if;
    if not fv_owns_assessment(p_assessment_id) then raise exception 'not found' using errcode = 'P0002'; end if;
    perform 1 from assessment where id = p_assessment_id for key share;
    perform 1 from quiz where assessment_id = p_assessment_id for key share;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    -- The shape, all of it, before anything is written. Writes no score.
    if jsonb_typeof(p_marks) is distinct from 'array' or jsonb_array_length(p_marks) not between 1 and 200 then
        _bad := 'Marks must be a list of 1 to 200 tries.';
    else
        for _it in select v from jsonb_array_elements(p_marks) v loop
            _m := _it->'marked';
            if (case when jsonb_typeof(_it) <> 'object' then true
                     else _it - 'attempt_id' - 'marked' <> '{}'::jsonb or not (_it ? 'attempt_id' and _it ? 'marked')
                          or jsonb_typeof(_it->'attempt_id') <> 'string' or not pg_input_is_valid(_it->>'attempt_id', 'uuid') end) then
                _bad := 'Each item is an attempt_id and marked.';
            elsif jsonb_typeof(_m) = 'null' then
                null;
            elsif (case when jsonb_typeof(_m) <> 'object' then true else _m - 'earned' - 'possible' - 'questions' <> '{}'::jsonb end)
                  or jsonb_typeof(_m->'earned') is distinct from 'number' or jsonb_typeof(_m->'possible') is distinct from 'number'
                  or jsonb_typeof(_m->'questions') is distinct from 'object' then
                _bad := 'Marked is earned, possible and questions.';
            elsif (_m->>'earned')::numeric < 0 or (_m->>'earned')::numeric > (_m->>'possible')::numeric or (_m->>'possible')::numeric > 10000 then
                _bad := 'Earned is 0 to possible, and possible 10000 at most.';
            elsif (select count(*) from jsonb_object_keys(_m->'questions')) > 200
                  or exists (select 1 from jsonb_each(_m->'questions') j(k, v)
                              where case when not pg_input_is_valid(k, 'uuid') then true
                                         when not exists (select 1 from quiz_question q where q.id = k::uuid and q.assessment_id = p_assessment_id) then true
                                         when jsonb_typeof(v) <> 'object' or v - 'earned' - 'result' <> '{}'::jsonb then true
                                         when jsonb_typeof(v->'earned') is distinct from 'number' or v->>'result' is null
                                              or v->>'result' not in ('right', 'partly', 'wrong', 'waiting') then true
                                         else (v->>'earned')::numeric not between 0 and 100 end) then
                _bad := 'Each question is one of this quiz''s, with earned (0 to 100) and result (right, partly, wrong or waiting).';
            end if;
            exit when _bad is not null;
        end loop;
    end if;
    if _bad is null then
        select array_agg((v->>'attempt_id')::uuid) into _ids from jsonb_array_elements(p_marks) v;
        if (select count(distinct x) from unnest(_ids) x) <> cardinality(_ids) then
            _bad := 'Each try is named once.';
        end if;
    end if;
    if _bad is not null then
        raise exception 'bad_marks' using errcode = '22023', detail = _bad;
    end if;
    -- One student's tries at a time, in one order.
    for _e in select distinct t.enrollment_id from quiz_attempt t where t.id = any(_ids) and t.assessment_id = p_assessment_id order by 1 loop
        perform pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(p_assessment_id::text || ':' || _e::text));
    end loop;
    if (select count(*) from quiz_attempt t join enrollment e on e.id = t.enrollment_id
         where t.id = any(_ids) and t.assessment_id = p_assessment_id and e.withdrawn_at is null) <> cardinality(_ids) then
        raise exception 'not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from quiz_attempt t where t.id = any(_ids) and t.sent_at is null) then
        raise exception 'not_sent' using errcode = '22023', detail = 'Only a sent try can be confirmed.';
    end if;
    for _it in select v from jsonb_array_elements(p_marks) v loop
        _m := nullif(_it->'marked', 'null'::jsonb);
        select * into _t from quiz_attempt where id = (_it->>'attempt_id')::uuid;
        if _m is not null then
            update quiz_attempt set marked = null, marked_at = null
             where assessment_id = p_assessment_id and enrollment_id = _t.enrollment_id and id <> _t.id and marked is not null;
        end if;
        update quiz_attempt set marked = _m, marked_at = case when _m is null then null else now() end
         where id = _t.id returning * into _t;
        _done := _done || jsonb_build_object('attempt_id', _t.id, 'enrollment_id', _t.enrollment_id, 'try', _t.try, 'marked_at', _t.marked_at);
    end loop;
    perform fv_idem_store(p_idempotency_key, 'confirm_quiz', jsonb_build_object('confirmed', _done));
    return jsonb_build_object('confirmed', _done);
end;
$function$;

revoke all on function public.mark_quiz_answer(uuid, uuid, numeric, text, uuid), public.reopen_quiz(uuid, uuid, uuid),
    public.confirm_quiz(uuid, jsonb, uuid) from public, anon, service_role;
grant execute on function public.mark_quiz_answer(uuid, uuid, numeric, text, uuid), public.reopen_quiz(uuid, uuid, uuid),
    public.confirm_quiz(uuid, jsonb, uuid) to authenticated;

do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', '77bd2789ea9f46790f6eef639a605c24'),
        ('public.reopen_quiz(uuid,uuid,uuid)', 'daabc9bbdd81761d4ddfd72b773eca78'),
        ('public.confirm_quiz(uuid,jsonb,uuid)', '8380e8fa33795295b97e17623376414f')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
end
$after$;

commit;
