-- Quizzes, MQ1: the tables and the teacher's functions (2026-11-17). NOT APPLIED.
--
-- THIS FILE CHANGES NO EXISTING ROW, TABLE, POLICY, CONSTRAINT OR FUNCTION.
-- It adds five empty tables, list_quiz (with the key) and save_quiz for the
-- class's teacher, fv_private.quiz_json (no role may call it), and three
-- triggers: assessment_quiz_draft_guard (Unassign refused once a try exists),
-- quiz_tag_gone on assessment_tag (at commit, a competency off the piece is
-- off its questions), quiz_attempt_same_class. The rest of the teacher's
-- functions are 2026111805_quiz_results.sql. No grade math. Contract:
-- migrations/local-test/quizzes-contract.md (plan: docs/plans/quizzes-plan.md).
-- THE ANSWER KEY is kept only in quiz_key: save_quiz stores no copy of its
-- reply in fv_idempotency, only that the key was used.
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new functions, as this file
-- leaves them):
--   public.list_quiz(uuid) (new) 4b5a877bdade0126970b90acbfa613d7
--   public.save_quiz(uuid,jsonb,uuid) (new) 0bd413e5fa6ac1ddeaec29673c791be8
--   fv_private.quiz_json(uuid) (new) c1d41659890c23cb02d0f517cd5c037d
--   public._quiz_draft_guard() (new) 9e6ed6b0336305322b22c309161472f9
--   public._quiz_tag_gone() (new) 3cd4fba9441edaec432cc3322c654826
--   public._quiz_attempt_same_class() (new) 5b0045acab2f7eb94cf3d8ff75210e1f
-- Relied on, unchanged (function, live):
--   public.fv_owns_assessment(uuid) 9f4c680c35f9f3ac32e8290824707673
--   public.fv_idem_check(uuid,text) 1c7b546434bee4b774557e0e6b16024f
--   public.fv_idem_store(uuid,text,jsonb) 6d0b48c458d273a332db39e1a4b68626
--
-- Checks first: nothing changes unless the three it relies on are as tested,
-- its own six, five tables and two triggers on existing tables are missing
-- or its, and no function of those names is elsewhere. Read-only pre-check:
-- migrations/local-test/quizzes-live-precheck.sql.
--
-- Rows: none changes and none is added. Unassign is refused only on a piece
-- with a quiz try, and none has one until MQ2 is applied.
--
-- Locks: first, share row exclusive on enrollment, assessment and
-- assessment_tag, in that order; the triggers on those two go in before any
-- quiz table is touched, so a second run cannot hold a quiz table while it
-- waits for a teacher's save. Five seconds, then it gives up with nothing
-- applied. Cost to a teacher with no quiz: one empty indexed update at
-- commit per competency row a form save deletes; one trigger on Unassign.
--
-- The last check names each part not as tested: a function's md5 or grant,
-- a table's grants (relacl, attacl), row security or policy, a key's
-- cascade, a trigger's function, events, columns or condition.
--
-- After 2026111730 (needs nothing of Bulletins' 2026111801 to 03), before
-- the app that calls these. Tested on PostgreSQL 17, ICU en-US and C:
-- migrations/local-test/quizzes.py (README.md, "Quizzes"). Undo:
-- quizzes-undo.sql. After: quizzes-live-postcheck.sql.
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';
-- Existing tables first, always in this order (no deadlock with an import).
lock table public.enrollment, public.assessment, public.assessment_tag in share row exclusive mode;

-- == 1. The checks, before anything changes ==
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
        ('public.list_quiz(uuid)', null, '4b5a877bdade0126970b90acbfa613d7'),
        ('public.save_quiz(uuid,jsonb,uuid)', null, '0bd413e5fa6ac1ddeaec29673c791be8'),
        ('fv_private.quiz_json(uuid)', null, 'c1d41659890c23cb02d0f517cd5c037d'),
        ('public._quiz_draft_guard()', null, '9e6ed6b0336305322b22c309161472f9'),
        ('public._quiz_tag_gone()', null, '3cd4fba9441edaec432cc3322c654826'),
        ('public._quiz_attempt_same_class()', null, '5b0045acab2f7eb94cf3d8ff75210e1f')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname in ('list_quiz', 'save_quiz', 'quiz_json', '_quiz_draft_guard',
                                                        '_quiz_tag_gone', '_quiz_attempt_same_class')
                 and oid not in (select coalesce(to_regprocedure(x), 0) from unnest(array['public.list_quiz(uuid)', 'public.save_quiz(uuid,jsonb,uuid)',
                     'fv_private.quiz_json(uuid)', 'public._quiz_draft_guard()', 'public._quiz_tag_gone()',
                     'public._quiz_attempt_same_class()']) x)) then
        raise exception 'A quiz function exists with other arguments or in another schema. Nothing was changed.';
    end if;
    for _f in select * from (values
        ('public.quiz', 'assessment_id uuid, shuffle_questions boolean, shuffle_choices boolean, tries smallint, counts text, shows text, add_total boolean, after_due text, accept_until date, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_question', 'id uuid, assessment_id uuid, position integer, kind text, prompt text, choices jsonb, multiple boolean, points numeric, tag_id uuid, archived_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone'),
        ('public.quiz_key', 'question_id uuid, answer jsonb, tolerance numeric, why text'),
        ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone'),
        ('public.quiz_answer', 'attempt_id uuid, question_id uuid, assessment_id uuid, answer jsonb, saved_at timestamp with time zone, given_points numeric, note text')
    ) as v(t, cols) loop
        if to_regclass(_f.t) is not null then
            select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
              from pg_attribute where attrelid = _f.t::regclass and attnum > 0 and not attisdropped;
            if _cols is distinct from _f.cols then
                raise exception '% exists and is not this file''s (%). Nothing was changed.', _f.t, _cols;
            end if;
        end if;
    end loop;
    if exists (select 1 from pg_trigger t where not t.tgisinternal
                  and ((t.tgname = 'assessment_quiz_draft_guard' and (t.tgrelid <> 'public.assessment'::regclass
                         or t.tgfoid <> coalesce(to_regprocedure('public._quiz_draft_guard()'), 0)))
                    or (t.tgname = 'quiz_tag_gone' and (t.tgrelid <> 'public.assessment_tag'::regclass
                         or t.tgfoid <> coalesce(to_regprocedure('public._quiz_tag_gone()'), 0))))) then
        raise exception 'A trigger named assessment_quiz_draft_guard or quiz_tag_gone exists and is not this file''s. Nothing was changed.';
    end if;
end
$guard$;

-- == 2. The triggers on existing tables, before any quiz table ==
-- Unassign is refused once any student has a try, with the existing guard's
-- word. A start of a try (MQ2) holds the assessment's row for share, so an
-- Unassign waits for it and then sees the try.
create or replace function public._quiz_draft_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if coalesce(current_setting('fv.restoring', true), '') = 'on' then
        return new;
    end if;
    if exists (select 1 from quiz_attempt t where t.assessment_id = new.id) then
        raise exception 'draft_has_work' using errcode = 'P0001',
            detail = 'A student has started the quiz on this assessment, so it cannot go back to a Draft.';
    end if;
    return new;
end;
$function$;

-- At commit: a competency no longer on the piece is taken off its questions.
-- The form deletes and re-inserts every competency on each save; a pair that
-- is back by commit is left as it was.
create or replace function public._quiz_tag_gone()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    update quiz_question q set tag_id = null, updated_at = now()
     where q.assessment_id = old.assessment_id and q.tag_id = old.tag_id
       and not exists (select 1 from assessment_tag x where x.assessment_id = old.assessment_id and x.tag_id = old.tag_id);
    return null;
end;
$function$;

revoke all on function public._quiz_draft_guard(), public._quiz_tag_gone() from public, anon, authenticated, service_role;

create or replace trigger assessment_quiz_draft_guard
    before update of is_draft on public.assessment
    for each row when (new.is_draft and not old.is_draft)
    execute function public._quiz_draft_guard();
do $t$
begin
    if not exists (select 1 from pg_trigger where tgname = 'quiz_tag_gone' and tgrelid = 'public.assessment_tag'::regclass) then
        create constraint trigger quiz_tag_gone
            after delete or update of assessment_id, tag_id on public.assessment_tag
            deferrable initially deferred
            for each row execute function public._quiz_tag_gone();
    end if;
end
$t$;

-- == 3. The tables ==
create table if not exists public.quiz (
    assessment_id     uuid primary key references public.assessment(id) on delete cascade,
    shuffle_questions boolean not null default true,
    shuffle_choices   boolean not null default true,
    tries             smallint not null default 1 constraint quiz_tries_check check (tries in (0, 1, 2)),
    counts            text not null default 'best' constraint quiz_counts_check check (counts in ('best', 'latest')),
    shows             text not null default 'answers' constraint quiz_shows_check check (shows in ('grade', 'right', 'answers')),
    add_total         boolean not null default false,
    after_due         text not null default 'keep' constraint quiz_after_due_check check (after_due in ('keep', 'stop', 'until')),
    accept_until      date,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint quiz_accept_until_check check ((after_due = 'until') = (accept_until is not null))
);

create table if not exists public.quiz_question (
    id            uuid primary key default gen_random_uuid(),
    assessment_id uuid not null references public.quiz(assessment_id) on delete cascade,
    position      integer constraint quiz_question_position_check check (position between 1 and 100),
    kind          text not null constraint quiz_question_kind_check check (kind in ('choice', 'true_false', 'number', 'text')),
    prompt        text not null constraint quiz_question_prompt_check check (char_length(prompt) between 1 and 1000),
    choices       jsonb,
    multiple      boolean not null default false,
    points        numeric not null default 1 constraint quiz_question_points_check check (points >= 0 and points <= 100),
    tag_id        uuid,
    archived_at   timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint quiz_question_archived_check check ((archived_at is null) = (position is not null)),
    constraint quiz_question_choices_check check ((kind = 'choice') = (choices is not null) and (choices is null
        or (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 20))),
    constraint quiz_question_multiple_check check (not multiple or kind = 'choice'),
    constraint quiz_question_id_assessment_key unique (id, assessment_id),
    constraint quiz_question_position_key unique (assessment_id, position) deferrable initially deferred
);
create index if not exists quiz_question_tag_idx on public.quiz_question (assessment_id, tag_id) where tag_id is not null;

create table if not exists public.quiz_key (
    question_id uuid primary key references public.quiz_question(id) on delete cascade,
    answer      jsonb constraint quiz_key_answer_check check (answer is null or jsonb_typeof(answer) in ('array', 'boolean', 'number')),
    tolerance   numeric constraint quiz_key_tolerance_check check (tolerance >= 0),
    why         text constraint quiz_key_why_check check (char_length(why) between 1 and 500)
);

create table if not exists public.quiz_attempt (
    id             uuid primary key default gen_random_uuid(),
    assessment_id  uuid not null references public.quiz(assessment_id) on delete cascade,
    enrollment_id  uuid not null references public.enrollment(id) on delete cascade,
    try            integer not null constraint quiz_attempt_try_check check (try >= 1),
    question_order jsonb constraint quiz_attempt_order_check check (jsonb_typeof(question_order) = 'object'),
    started_at     timestamptz,
    sent_at        timestamptz,
    reopened_at    timestamptz,
    marked         jsonb,
    marked_at      timestamptz,
    created_at     timestamptz not null default now(),
    constraint quiz_attempt_started_check check ((started_at is null) = (question_order is null)),
    constraint quiz_attempt_sent_check check (sent_at is null or started_at is not null),
    constraint quiz_attempt_marked_check check ((marked is null) = (marked_at is null)
        and (marked is null or (sent_at is not null and jsonb_typeof(marked) = 'object'))),
    constraint quiz_attempt_try_key unique (assessment_id, enrollment_id, try),
    constraint quiz_attempt_id_assessment_key unique (id, assessment_id)
);
create unique index if not exists quiz_attempt_one_open_idx on public.quiz_attempt (assessment_id, enrollment_id) where sent_at is null;
create unique index if not exists quiz_attempt_one_marked_idx on public.quiz_attempt (assessment_id, enrollment_id) where marked is not null;
create index if not exists quiz_attempt_enrollment_idx on public.quiz_attempt (enrollment_id);

create table if not exists public.quiz_answer (
    attempt_id    uuid not null,
    question_id   uuid not null,
    assessment_id uuid not null,
    answer        jsonb not null constraint quiz_answer_answer_check check (jsonb_typeof(answer) in ('array', 'boolean', 'number')
                      or (jsonb_typeof(answer) = 'string' and char_length(answer #>> '{}') <= 5000)),
    saved_at      timestamptz not null default now(),
    given_points  numeric constraint quiz_answer_given_points_check check (given_points >= 0 and given_points <= 100),
    note          text constraint quiz_answer_note_check check (char_length(note) between 1 and 1000),
    primary key (attempt_id, question_id),
    constraint quiz_answer_attempt_fkey foreign key (attempt_id, assessment_id)
        references public.quiz_attempt(id, assessment_id) on delete cascade,
    constraint quiz_answer_question_fkey foreign key (question_id, assessment_id)
        references public.quiz_question(id, assessment_id) on delete cascade
);
create index if not exists quiz_answer_question_idx on public.quiz_answer (question_id);

alter table public.quiz enable row level security;
alter table public.quiz_question enable row level security;
alter table public.quiz_key enable row level security;
alter table public.quiz_attempt enable row level security;
alter table public.quiz_answer enable row level security;
revoke all on table public.quiz, public.quiz_question, public.quiz_key, public.quiz_attempt, public.quiz_answer
    from public, anon, authenticated, service_role;

comment on table public.quiz is 'A quiz on an assessment (Quizzes, MQ1): its settings. Read and written only through the quiz functions.';
comment on table public.quiz_key is 'The answer key, kept only here (not in fv_idempotency). No student_submit function reads it but the returned view (MQ3).';
comment on table public.quiz_attempt is 'One student''s try at a quiz. Until sent, only that student''s own session reads it; the teacher''s functions answer sent tries only.';

create or replace function public._quiz_attempt_same_class()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if not exists (select 1 from assessment a join enrollment e on e.course_id = a.course_id
                    where a.id = new.assessment_id and e.id = new.enrollment_id) then
        raise exception 'quiz_attempt: the student is not in the assessment''s class' using errcode = '23514';
    end if;
    return new;
end;
$function$;

revoke all on function public._quiz_attempt_same_class() from public, anon, authenticated, service_role;

create or replace trigger quiz_attempt_same_class
    before insert or update of assessment_id, enrollment_id on public.quiz_attempt
    for each row execute function public._quiz_attempt_same_class();

-- == 4. The quiz as the teacher's functions answer it ==
create or replace function fv_private.quiz_json(p_assessment_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    with q as (
        select x.position, x.archived_at, x.id,
               to_jsonb(x) - 'assessment_id' || jsonb_build_object(
                   'answered', exists (select 1 from quiz_answer a where a.question_id = x.id),
                   'key', jsonb_build_object('answer', k.answer, 'tolerance', k.tolerance, 'why', k.why)) as j
          from quiz_question x left join quiz_key k on k.question_id = x.id
         where x.assessment_id = p_assessment_id)
    select jsonb_build_object(
        'quiz', (select to_jsonb(z) from quiz z where z.assessment_id = p_assessment_id),
        'questions', coalesce((select jsonb_agg(j order by position) from q where archived_at is null), '[]'::jsonb),
        'archived', coalesce((select jsonb_agg(j order by archived_at, id) from q where archived_at is not null), '[]'::jsonb));
$function$;

revoke all on function fv_private.quiz_json(uuid) from public, anon, authenticated, service_role;

-- == 5. The teacher's functions ==
create or replace function public.list_quiz(p_assessment_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then raise exception 'not found' using errcode = 'P0002'; end if;
    return fv_private.quiz_json(p_assessment_id);
end;
$function$;

create or replace function public.save_quiz(p_assessment_id uuid, p_quiz jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _uuid4    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    -- White space at either end (ASCII's, the same under every collation).
    _ws       constant text := '^[[:space:]]+|[[:space:]]+$';
    _cached   jsonb;
    _made     int;
    _was      timestamptz;
    _prompt   text;
    _a        record;
    _answered boolean;
    _old_kind text;
    _old_mult boolean;
    _old_ch   jsonb;
    _q        jsonb;
    _k        jsonb;
    _n        int;
    _id       uuid;
    _bad      text;
    _choices  jsonb;
    _multiple boolean;
    _tag      uuid;
    _ans      jsonb;
    _tol      numeric;
    _why      text;
    _tags     uuid[];
    _keep     uuid[] := '{}';
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'save_quiz');
    if not fv_owns_assessment(p_assessment_id) then raise exception 'not found' using errcode = 'P0002'; end if;
    -- The stored reply holds no question or key: the same key again answers the quiz as it is now.
    if _cached is not null then
        return fv_private.quiz_json(p_assessment_id);
    end if;
    select a.score_mode, a.collab_mode into _a from assessment a where a.id = p_assessment_id for key share;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;

    -- Null: the quiz is removed, while no student has a try.
    if p_quiz is null or jsonb_typeof(p_quiz) = 'null' then
        perform 1 from quiz where assessment_id = p_assessment_id for update;
        if exists (select 1 from quiz_attempt where assessment_id = p_assessment_id) then
            raise exception 'has_tries' using errcode = '22023', detail = 'A student has started this quiz, so it cannot be removed.';
        end if;
        delete from quiz where assessment_id = p_assessment_id;
        perform fv_idem_store(p_idempotency_key, 'save_quiz', '{"saved": true}'::jsonb);
        return fv_private.quiz_json(p_assessment_id);
    end if;

    if _a.score_mode = 'dibels' or _a.collab_mode <> 'none' then
        raise exception 'not_offered' using errcode = '22023', detail = 'A quiz is not offered on a DIBELS, pair or group piece.';
    end if;
    if (case when jsonb_typeof(p_quiz) <> 'object' then true
             else (select array_agg(k order by k collate "C") from jsonb_object_keys(p_quiz) k) is distinct from
                  array['accept_until', 'add_total', 'after_due', 'counts', 'questions', 'shows', 'shuffle_choices', 'shuffle_questions',
                        'tries', 'updated_at'] end) then
        _bad := 'The quiz must have exactly its settings, updated_at and questions.';
    elsif coalesce(jsonb_typeof(p_quiz->'updated_at'), 'null') not in ('string', 'null')
       or (jsonb_typeof(p_quiz->'updated_at') = 'string' and (not pg_input_is_valid(p_quiz->>'updated_at', 'timestamptz')
           or p_quiz->>'updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+([+-][0-9:]+|Z)$')) then
        _bad := 'updated_at must be the quiz''s updated_at as last read, or null for a new quiz.';
    elsif jsonb_typeof(p_quiz->'shuffle_questions') <> 'boolean' or jsonb_typeof(p_quiz->'shuffle_choices') <> 'boolean'
       or jsonb_typeof(p_quiz->'add_total') <> 'boolean' then
        _bad := 'Shuffle and Add a Total must be true or false.';
    elsif jsonb_typeof(p_quiz->'tries') <> 'number' or p_quiz->>'tries' not in ('0', '1', '2') then
        _bad := 'Tries must be 0, 1 or 2.';
    elsif jsonb_typeof(p_quiz->'counts') <> 'string' or p_quiz->>'counts' not in ('best', 'latest') then
        _bad := 'Counts must be best or latest.';
    elsif jsonb_typeof(p_quiz->'shows') <> 'string' or p_quiz->>'shows' not in ('grade', 'right', 'answers') then
        _bad := 'Shows must be grade, right or answers.';
    elsif jsonb_typeof(p_quiz->'after_due') <> 'string' or p_quiz->>'after_due' not in ('keep', 'stop', 'until') then
        _bad := 'After the due date must be keep, stop or until.';
    elsif (case when p_quiz->>'after_due' = 'until'
                then jsonb_typeof(p_quiz->'accept_until') <> 'string' or p_quiz->>'accept_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     or not pg_input_is_valid(p_quiz->>'accept_until', 'date')
                else jsonb_typeof(p_quiz->'accept_until') <> 'null' end) then
        _bad := 'The last day must be a date (YYYY-MM-DD) with until, and null otherwise.';
    elsif jsonb_typeof(p_quiz->'questions') <> 'array' then
        _bad := 'Questions must be a list.';
    end if;
    if _bad is not null then
        raise exception 'bad_quiz' using errcode = '22023', detail = _bad;
    end if;
    if jsonb_array_length(p_quiz->'questions') > 100 then
        raise exception 'too_many_questions' using errcode = '22023', detail = 'A quiz has 100 questions at most.';
    end if;

    -- Locks, in the contract's order: the quiz's row, then the piece's competencies.
    insert into quiz (assessment_id) values (p_assessment_id) on conflict (assessment_id) do nothing;
    get diagnostics _made = row_count;
    select z.updated_at into _was from quiz z where z.assessment_id = p_assessment_id for update;
    -- Saved somewhere else since this was read (another tab, an old payload): nothing is written.
    if (case when _made = 1 then jsonb_typeof(p_quiz->'updated_at') = 'string'
             else (p_quiz->>'updated_at')::timestamptz is distinct from _was end) then
        raise exception 'stale' using errcode = '22023', detail = 'This quiz was changed somewhere else. Open it again before saving.';
    end if;
    perform 1 from assessment_tag where assessment_id = p_assessment_id for key share;
    select coalesce(array_agg(tag_id order by tag_id), '{}') into _tags
      from (select x.tag_id from assessment_tag x where x.assessment_id = p_assessment_id for key share) x;
    update quiz set shuffle_questions = (p_quiz->>'shuffle_questions')::boolean, shuffle_choices = (p_quiz->>'shuffle_choices')::boolean,
                    tries = (p_quiz->>'tries')::smallint, counts = p_quiz->>'counts', shows = p_quiz->>'shows',
                    add_total = (p_quiz->>'add_total')::boolean, after_due = p_quiz->>'after_due',
                    accept_until = (p_quiz->>'accept_until')::date, updated_at = now()
     where assessment_id = p_assessment_id;

    for _q, _n in select v, o from jsonb_array_elements(p_quiz->'questions') with ordinality x(v, o) loop
        _bad := null; _id := null; _answered := false; _choices := null; _tag := null; _ans := null; _tol := null; _why := null;
        _k := _q->'key';
        if (case when jsonb_typeof(_q) <> 'object' then true
                 else _q - 'id' - 'kind' - 'prompt' - 'choices' - 'multiple' - 'points' - 'tag_id' - 'key' <> '{}'::jsonb
                      or not (_q ? 'kind' and _q ? 'prompt' and _q ? 'points' and _q ? 'tag_id' and _q ? 'key') end) then
            _bad := 'its fields';
        elsif jsonb_typeof(_q->'id') = 'string' and not pg_input_is_valid(_q->>'id', 'uuid') then
            _bad := 'its id';
        elsif coalesce(jsonb_typeof(_q->'id'), 'null') not in ('string', 'null') then
            _bad := 'its id';
        end if;
        if _bad is null and jsonb_typeof(_q->'id') = 'string' then
            _id := (_q->>'id')::uuid;
            select x.kind, x.multiple, x.choices, exists (select 1 from quiz_answer a where a.question_id = x.id)
              into _old_kind, _old_mult, _old_ch, _answered from quiz_question x where x.id = _id and x.assessment_id = p_assessment_id;
            if not found or _id = any(_keep) then
                _bad := 'its id is not a question of this quiz, or is there twice';
            end if;
        end if;
        _multiple := case when jsonb_typeof(_q->'multiple') = 'boolean' then (_q->>'multiple')::boolean else false end;
        if _bad is not null then
            null;
        elsif jsonb_typeof(_q->'kind') is distinct from 'string' or _q->>'kind' not in ('choice', 'true_false', 'number', 'text') then
            _bad := 'its kind';
        elsif jsonb_typeof(_q->'prompt') is distinct from 'string'
              or char_length(regexp_replace((_q->>'prompt') collate "C", _ws, '', 'g')) not between 1 and 1000 then
            _bad := 'its question (1 to 1000 characters)';
        elsif coalesce(jsonb_typeof(_q->'multiple'), 'null') not in ('boolean', 'null') or (_multiple and _q->>'kind' <> 'choice') then
            _bad := 'Several Right (only on a choice question)';
        elsif jsonb_typeof(_q->'points') is distinct from 'number' or (_q->>'points')::numeric not between 0 and 100 then
            _bad := 'its points (0 to 100)';
        elsif jsonb_typeof(_q->'tag_id') = 'string' and (not pg_input_is_valid(_q->>'tag_id', 'uuid') or (_q->>'tag_id')::uuid <> all(_tags)) then
            _bad := 'its competency is not one of this piece''s';
        elsif coalesce(jsonb_typeof(_q->'tag_id'), 'null') not in ('string', 'null') then
            _bad := 'its competency';
        elsif _q->>'kind' = 'choice' then
            if jsonb_typeof(_q->'choices') is distinct from 'array' or jsonb_array_length(_q->'choices') not between 2 and 20 then
                _bad := 'its choices (2 to 20)';
            elsif exists (select 1 from jsonb_array_elements(_q->'choices') e
                           where case when jsonb_typeof(e) <> 'object' or e - 'id' - 'text' <> '{}'::jsonb then true
                                      when jsonb_typeof(e->'id') is distinct from 'string' or e->>'id' !~ _uuid4 then true
                                      when jsonb_typeof(e->'text') is distinct from 'string' then true
                                      else char_length(regexp_replace((e->>'text') collate "C", _ws, '', 'g')) not between 1 and 300 end)
               or (select count(distinct (e->>'id') collate "C") from jsonb_array_elements(_q->'choices') e) <> jsonb_array_length(_q->'choices') then
                _bad := 'its choices (each an id, a random version-4 UUID used once, and 1 to 300 characters)';
            else
                select jsonb_agg(jsonb_build_object('id', e->>'id', 'text', regexp_replace((e->>'text') collate "C", _ws, '', 'g')) order by o)
                  into _choices
                  from jsonb_array_elements(_q->'choices') with ordinality c(e, o);
            end if;
        elsif coalesce(jsonb_typeof(_q->'choices'), 'null') <> 'null' then
            _bad := 'its choices (only on a choice question)';
        end if;
        -- The key.
        if _bad is null then
            if (case when jsonb_typeof(_k) is distinct from 'object' then true else _k - 'answer' - 'tolerance' - 'why' <> '{}'::jsonb end) then
                _bad := 'its answer key';
            elsif coalesce(jsonb_typeof(_k->'why'), 'null') not in ('string', 'null')
                  or char_length(regexp_replace((_k->>'why') collate "C", _ws, '', 'g')) > 500 then
                _bad := 'its why line (500 characters at most)';
            elsif coalesce(jsonb_typeof(_k->'tolerance'), 'null') <> 'null' and (_q->>'kind' <> 'number'
                  or jsonb_typeof(_k->'tolerance') <> 'number' or (_k->>'tolerance')::numeric not between 0 and 1e12) then
                _bad := 'its tolerance (0 to 10^12, on a number question only)';
            elsif _q->>'kind' = 'choice' then
                if jsonb_typeof(_k->'answer') is distinct from 'array' or jsonb_array_length(_k->'answer') = 0
                   or (not _multiple and jsonb_array_length(_k->'answer') <> 1)
                   or exists (select 1 from jsonb_array_elements(_k->'answer') r
                               where jsonb_typeof(r) <> 'string' or not exists (select 1 from jsonb_array_elements(_choices) c where c->>'id' = r #>> '{}'))
                   or (select count(distinct r) from jsonb_array_elements(_k->'answer') r) <> jsonb_array_length(_k->'answer') then
                    _bad := 'its right answer (one of its choices, or with Several Right one or more)';
                else
                    select jsonb_agg(r order by (r #>> '{}') collate "C") into _ans from jsonb_array_elements(_k->'answer') r;
                end if;
            elsif _q->>'kind' = 'true_false' then
                if jsonb_typeof(_k->'answer') is distinct from 'boolean' then _bad := 'its right answer (true or false)'; else _ans := _k->'answer'; end if;
            elsif _q->>'kind' = 'number' then
                if jsonb_typeof(_k->'answer') is distinct from 'number' or abs((_k->>'answer')::numeric) > 1e12 then
                    _bad := 'its right answer (a number, -10^12 to 10^12)';
                else
                    _ans := _k->'answer';
                end if;
            elsif coalesce(jsonb_typeof(_k->'answer'), 'null') <> 'null' then
                _bad := 'its right answer (none on a text question)';
            end if;
        end if;
        if _bad is not null then
            raise exception 'bad_quiz' using errcode = '22023', detail = format('Question %s: %s.', _n, _bad);
        end if;
        _tag := case when jsonb_typeof(_q->'tag_id') = 'string' then (_q->>'tag_id')::uuid end;
        _tol := case when jsonb_typeof(_k->'tolerance') = 'number' then (_k->>'tolerance')::numeric end;
        _why := nullif(regexp_replace((_k->>'why') collate "C", _ws, '', 'g'), '');
        _prompt := regexp_replace((_q->>'prompt') collate "C", _ws, '', 'g');
        -- What may not change once a question has answers.
        if _answered then
            if _old_kind <> _q->>'kind' or _old_mult <> _multiple then
                raise exception 'kind_locked' using errcode = '22023',
                    detail = format('Question %s has answers, so its kind and Several Right cannot change.', _n);
            end if;
            if (select array_agg(c->>'id' order by (c->>'id') collate "C") from jsonb_array_elements(_old_ch) c)
               is distinct from (select array_agg(c->>'id' order by (c->>'id') collate "C") from jsonb_array_elements(_choices) c) then
                raise exception 'choices_locked' using errcode = '22023',
                    detail = format('Question %s has answers, so a choice cannot be added or removed.', _n);
            end if;
        end if;
        if _id is null then
            insert into quiz_question (assessment_id, position, kind, prompt, choices, multiple, points, tag_id)
            values (p_assessment_id, _n, _q->>'kind', _prompt, _choices, _multiple, (_q->>'points')::numeric, _tag)
            returning id into _id;
        else
            update quiz_question set position = _n, kind = _q->>'kind', prompt = _prompt, choices = _choices,
                                     multiple = _multiple, points = (_q->>'points')::numeric, tag_id = _tag,
                                     archived_at = null, updated_at = now()
             where id = _id;
        end if;
        insert into quiz_key (question_id, answer, tolerance, why) values (_id, _ans, _tol, _why)
            on conflict (question_id) do update set answer = excluded.answer, tolerance = excluded.tolerance, why = excluded.why;
        _keep := _keep || _id;
    end loop;

    -- Left out: archived when an answer names it, else deleted with its key.
    update quiz_question q set archived_at = now(), position = null, updated_at = now()
     where q.assessment_id = p_assessment_id and q.archived_at is null and q.id <> all(_keep)
       and exists (select 1 from quiz_answer a where a.question_id = q.id);
    delete from quiz_question q where q.assessment_id = p_assessment_id and q.archived_at is null and q.id <> all(_keep);

    perform fv_idem_store(p_idempotency_key, 'save_quiz', '{"saved": true}'::jsonb);
    return fv_private.quiz_json(p_assessment_id);
end;
$function$;

revoke all on function public.list_quiz(uuid), public.save_quiz(uuid, jsonb, uuid) from public, anon, service_role;
grant execute on function public.list_quiz(uuid), public.save_quiz(uuid, jsonb, uuid) to authenticated;

-- == 6. The last check: each part that is not as tested is named ==
do $after$
declare
    _bad text[] := '{}';
    _f   record;
    _got text;
    _who constant text := 'case when a.grantee = 0 then ''PUBLIC'' else a.grantee::regrole::text end';
begin
    for _f in select * from (values
        ('public.list_quiz(uuid)', '4b5a877bdade0126970b90acbfa613d7', 'authenticated'),
        ('public.save_quiz(uuid,jsonb,uuid)', '0bd413e5fa6ac1ddeaec29673c791be8', 'authenticated'),
        ('fv_private.quiz_json(uuid)', 'c1d41659890c23cb02d0f517cd5c037d', null),
        ('public._quiz_draft_guard()', '9e6ed6b0336305322b22c309161472f9', null),
        ('public._quiz_tag_gone()', '3cd4fba9441edaec432cc3322c654826', null),
        ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f', null)
    ) as v(fn, now, runs) loop
        _got := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _got is distinct from _f.now then
            _bad := _bad || format('function %s has md5 %s, not %s', _f.fn, coalesce(_got, 'none (missing)'), _f.now);
        end if;
        execute 'select string_agg(w, '', '' order by w collate "C") from (select distinct ' || _who || ' as w
                   from pg_proc p, aclexplode(coalesce(p.proacl, acldefault(''f'', p.proowner))) a
                  where p.oid = $1 and a.grantee <> p.proowner) x' into _got using to_regprocedure(_f.fn);
        if _got is distinct from _f.runs then
            _bad := _bad || format('grant: function %s may be run by %s, not %s', _f.fn, coalesce(_got, 'its owner only'), coalesce(_f.runs, 'its owner only'));
        end if;
    end loop;
    for _f in select t from unnest(array['public.quiz', 'public.quiz_question', 'public.quiz_key', 'public.quiz_attempt', 'public.quiz_answer']) t loop
        if to_regclass(_f.t) is null then
            _bad := _bad || format('table %s is missing', _f.t);
            continue;
        end if;
        if not (select relrowsecurity from pg_class where oid = to_regclass(_f.t)) then
            _bad := _bad || format('table %s has row security off', _f.t);
        end if;
        if exists (select 1 from pg_policy where polrelid = to_regclass(_f.t)) then
            _bad := _bad || format('table %s has a policy', _f.t);
        end if;
        execute 'select string_agg(w, '', '' order by w collate "C") from (select distinct ' || _who || ' as w
                   from pg_class c, aclexplode(coalesce(c.relacl, acldefault(''r'', c.relowner))) a
                  where c.oid = $1 and a.grantee <> c.relowner) x' into _got using to_regclass(_f.t);
        if _got is not null then
            _bad := _bad || format('grant: table %s may be read or written by %s, not its owner only', _f.t, _got);
        end if;
        if exists (select 1 from pg_attribute where attrelid = to_regclass(_f.t) and attacl is not null) then
            _bad := _bad || format('grant: table %s has a column grant', _f.t);
        end if;
    end loop;
    for _f in select * from (values ('public.quiz', 'public.assessment'), ('public.quiz_question', 'public.quiz'),
        ('public.quiz_key', 'public.quiz_question'), ('public.quiz_attempt', 'public.quiz'), ('public.quiz_attempt', 'public.enrollment'),
        ('public.quiz_answer', 'public.quiz_attempt'), ('public.quiz_answer', 'public.quiz_question')) as v(t, p) loop
        if not exists (select 1 from pg_constraint where conrelid = to_regclass(_f.t) and confrelid = to_regclass(_f.p)
                          and contype = 'f' and confdeltype = 'c' and convalidated) then
            _bad := _bad || format('key: %s to %s is missing or does not cascade', _f.t, _f.p);
        end if;
    end loop;
    -- Each trigger: its function, events (tgtype), columns and condition.
    for _f in select * from (values
        ('assessment_quiz_draft_guard', 'public.assessment', 'public._quiz_draft_guard()', false, 19, 'is_draft',
         '((new.is_draft AND (NOT old.is_draft)))'),
        ('quiz_tag_gone', 'public.assessment_tag', 'public._quiz_tag_gone()', true, 25, 'assessment_id,tag_id', ''),
        ('quiz_attempt_same_class', 'public.quiz_attempt', 'public._quiz_attempt_same_class()', false, 23, 'assessment_id,enrollment_id', '')
    ) as v(t, tbl, fn, deferred, ty, cols, qual) loop
        if not exists (select 1 from pg_trigger g where g.tgname = _f.t and g.tgrelid = to_regclass(_f.tbl) and g.tgfoid = to_regprocedure(_f.fn)
                          and g.tgenabled = 'O' and g.tgdeferrable = _f.deferred and g.tginitdeferred = _f.deferred and g.tgtype = _f.ty
                          and (select string_agg(a.attname, ',' order by a.attname collate "C") from pg_attribute a
                                where a.attrelid = g.tgrelid and a.attnum = any (g.tgattr)) = _f.cols
                          and split_part(split_part(pg_get_triggerdef(g.oid), ' WHEN ', 2), ' EXECUTE ', 1) = _f.qual) then
            _bad := _bad || format('trigger %s on %s is missing or not this file''s (function, events, columns or condition)', _f.t, _f.tbl);
        end if;
    end loop;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$after$;

commit;
