-- Student questionnaires: the tables and the teacher's functions
-- (2026-10-25). docs/STUDENT-VOICE-PLAN.md, PR 4. The ready-made forms are
-- seeded by 20261025_questionnaires_templates.sql.
--
-- What it adds:
--   questionnaire_template: the ready-made forms everyone starts from (About
--     Me, the Core Competency Reflection for each grade 8–12 and reporting
--     period, Goal Check-In, Reply to Report), seeded below from Colin's
--     "Core Competency Reflecting Brainstorm" (Nov 2024). Read-only.
--   questionnaire: a class's copy of a form, with its dates and On/Off.
--     A Goal Check-In rides on its reflection's slip (parent_id).
--   question: the form's questions, in order. A question that already has
--     answers is archived, never deleted, when a teacher removes it.
--   response, answer: a student's submission and its answers. Nothing in
--     this migration writes them; students submit through the
--     student-submit edge function (PR 6).
--   student_access_code: one per student per questionnaire (or issued
--     report). Only a salted SHA-256 of the code is stored; the plain code
--     exists on the printed slip and in issue_access_codes' answer.
--
--   list_questionnaire_templates() -> [template]
--   upsert_questionnaire(...) -> the questionnaire with its questions.
--     A new one from a template copies the template's questions.
--   set_questionnaire_on(p_id, p_is_on, key) -> {id, is_on}
--   delete_questionnaire(p_id, key) -> {id, deleted}; refused once any
--     student has answered.
--   issue_access_codes(p_questionnaire_id, p_enrollment_ids, key) ->
--     [{enrollment_id, code}]; revokes that student's earlier unused code.
--   list_course_questionnaires(p_course_id) -> [questionnaire + questions +
--     answered enrollment ids]
--   list_course_responses(p_course_id) -> {questionnaire_id: {enrollment_id:
--     [{id, submitted_at, via, answers: {question_id: {num, text, json}}}]}}
--
-- RLS through fv_owns_course / fv_owns_enrollment, as every class table.
-- No existing table or function changes. anon gets nothing.

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists public.questionnaire_template (
  id            text        primary key,
  kind          text        not null
                constraint questionnaire_template_kind_check
                check (kind in ('about_me', 'core_reflection', 'goal_checkin', 'curricular_self_assessment', 'report_reply')),
  grade         integer     check (grade is null or grade between 8 and 12),
  period        integer     check (period is null or period between 1 and 3),
  year          integer     not null default 2026,
  title         text        not null,
  theme         text,
  core_heading  text,
  myed_comment  text,
  questions     jsonb       not null default '[]'::jsonb
                check (jsonb_typeof(questions) = 'array'),
  updated_at    timestamptz not null default now()
);

create table if not exists public.questionnaire (
  id            uuid        primary key default gen_random_uuid(),
  course_id     uuid        not null references public.course(id) on delete cascade,
  template_id   text        references public.questionnaire_template(id) on delete set null,
  kind          text        not null
                constraint questionnaire_kind_check
                check (kind in ('about_me', 'core_reflection', 'goal_checkin', 'curricular_self_assessment', 'report_reply')),
  title         text        not null check (char_length(btrim(title)) between 1 and 120),
  theme         text,
  report_period integer     check (report_period is null or report_period between 1 and 6),
  parent_id     uuid        references public.questionnaire(id) on delete set null,
  opens_on      date,
  closes_on     date,
  is_on         boolean     not null default true,
  myed_comment  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (opens_on is null or closes_on is null or opens_on <= closes_on)
);
create index if not exists questionnaire_course on public.questionnaire (course_id);

create table if not exists public.question (
  id                  uuid        primary key default gen_random_uuid(),
  questionnaire_id    uuid        not null references public.questionnaire(id) on delete cascade,
  display_order       integer     not null default 0,
  prompt              text        not null check (char_length(btrim(prompt)) between 1 and 1000),
  prompt_translations jsonb       not null default '{}'::jsonb check (jsonb_typeof(prompt_translations) = 'object'),
  kind                text        not null
                      constraint question_kind_check
                      check (kind in ('text', 'short_set', 'scale4', 'choice', 'goal_status', 'core_pick')),
  options             jsonb       not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  core_ids            text[]      not null default '{}'
                      check (core_ids <@ array['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR']::text[]),
  repeated_key        text,
  teacher_only        boolean     not null default false,
  archived            boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists question_questionnaire on public.question (questionnaire_id, display_order);

create table if not exists public.response (
  id               uuid        primary key default gen_random_uuid(),
  questionnaire_id uuid        not null references public.questionnaire(id) on delete cascade,
  enrollment_id    uuid        not null references public.enrollment(id) on delete cascade,
  via              text        not null default 'link' check (via in ('link', 'paper', 'forms_csv')),
  submitted_at     timestamptz not null default now(),
  created_by       uuid
);
create index if not exists response_questionnaire on public.response (questionnaire_id, enrollment_id);

create table if not exists public.answer (
  id          uuid    primary key default gen_random_uuid(),
  response_id uuid    not null references public.response(id) on delete cascade,
  question_id uuid    not null references public.question(id) on delete cascade,
  value_num   numeric,
  value_text  text    check (value_text is null or char_length(value_text) <= 5000),
  value_json  jsonb,
  unique (response_id, question_id)
);

create table if not exists public.student_access_code (
  id               uuid        primary key default gen_random_uuid(),
  enrollment_id    uuid        not null references public.enrollment(id) on delete cascade,
  questionnaire_id uuid        references public.questionnaire(id) on delete cascade,
  report_issue_id  uuid,
  code_hash        text        not null unique,
  salt             text        not null,
  expires_at       timestamptz not null,
  opened_at        timestamptz,
  used_at          timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  check (questionnaire_id is not null or report_issue_id is not null)
);
create index if not exists student_access_code_enrollment on public.student_access_code (enrollment_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.questionnaire_template enable row level security;
alter table public.questionnaire enable row level security;
alter table public.question enable row level security;
alter table public.response enable row level security;
alter table public.answer enable row level security;
alter table public.student_access_code enable row level security;

drop policy if exists questionnaire_template_read on public.questionnaire_template;
create policy questionnaire_template_read on public.questionnaire_template
  for select using ((select auth.uid()) is not null);

drop policy if exists questionnaire_via_course on public.questionnaire;
create policy questionnaire_via_course on public.questionnaire
  for all using (fv_owns_course(course_id)) with check (fv_owns_course(course_id));

drop policy if exists question_via_questionnaire on public.question;
create policy question_via_questionnaire on public.question
  for all
  using (exists (select 1 from questionnaire q where q.id = questionnaire_id and fv_owns_course(q.course_id)))
  with check (exists (select 1 from questionnaire q where q.id = questionnaire_id and fv_owns_course(q.course_id)));

drop policy if exists response_via_enrollment on public.response;
create policy response_via_enrollment on public.response
  for all using (fv_owns_enrollment(enrollment_id)) with check (fv_owns_enrollment(enrollment_id));

drop policy if exists answer_via_response on public.answer;
create policy answer_via_response on public.answer
  for all
  using (exists (select 1 from response r where r.id = response_id and fv_owns_enrollment(r.enrollment_id)))
  with check (exists (select 1 from response r where r.id = response_id and fv_owns_enrollment(r.enrollment_id)));

drop policy if exists student_access_code_via_enrollment on public.student_access_code;
create policy student_access_code_via_enrollment on public.student_access_code
  for all using (fv_owns_enrollment(enrollment_id)) with check (fv_owns_enrollment(enrollment_id));

grant select on public.questionnaire_template to authenticated;
grant select, insert, update, delete on public.questionnaire, public.question, public.response, public.answer,
  public.student_access_code to authenticated;
revoke all on public.questionnaire_template, public.questionnaire, public.question, public.response,
  public.answer, public.student_access_code from anon;

-- ── Functions ───────────────────────────────────────────────────────────

-- A questionnaire as the client reads it: its fields and its live questions.
create or replace function public._questionnaire_json(p_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $$
  select to_jsonb(q) || jsonb_build_object(
           'questions', coalesce((
             select jsonb_agg(to_jsonb(x) order by x.display_order, x.created_at)
               from question x
              where x.questionnaire_id = q.id and not x.archived), '[]'::jsonb))
    from questionnaire q
   where q.id = p_id;
$$;

create or replace function public.list_questionnaire_templates()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.kind, t.grade nulls first, t.period nulls first), '[]'::jsonb)
    from questionnaire_template t;
$$;

-- Saves a questionnaire. p_questions is the whole list in order: each item
-- {id?, prompt, kind, options, core_ids, repeated_key, teacher_only,
-- prompt_translations}. A listed id is updated, an item without one is
-- added, and a question left out is deleted, or archived if a student has
-- answered it. A new questionnaire with p_questions null and a template
-- copies the template's questions, theme and MyEd comment.
create or replace function public.upsert_questionnaire(
    p_course_id uuid, p_kind text, p_title text, p_template_id text default null,
    p_theme text default null, p_report_period integer default null, p_parent_id uuid default null,
    p_opens_on date default null, p_closes_on date default null, p_is_on boolean default true,
    p_myed_comment text default null, p_questions jsonb default null, p_id uuid default null,
    p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _id     uuid;
    _tpl    questionnaire_template%rowtype;
    _qs     jsonb := p_questions;
    _keep   uuid[] := '{}';
    _item   jsonb;
    _qid    uuid;
    _n      integer := 0;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'upsert_questionnaire');
    if _cached is not null then
        return _cached;
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    if p_template_id is not null then
        select * into _tpl from questionnaire_template where id = p_template_id;
        if not found then
            raise exception 'template not found' using errcode = 'P0002';
        end if;
    end if;
    if p_parent_id is not null and not exists (
        select 1 from questionnaire where id = p_parent_id and course_id = p_course_id) then
        raise exception 'parent questionnaire not found' using errcode = 'P0002';
    end if;

    if p_id is null then
        insert into questionnaire (course_id, template_id, kind, title, theme, report_period, parent_id,
                                   opens_on, closes_on, is_on, myed_comment)
        values (p_course_id, p_template_id, p_kind, btrim(p_title),
                coalesce(p_theme, _tpl.theme), p_report_period, p_parent_id, p_opens_on, p_closes_on,
                coalesce(p_is_on, true), coalesce(p_myed_comment, _tpl.myed_comment))
        returning id into _id;
        if _qs is null and p_template_id is not null then
            _qs := _tpl.questions;
        end if;
    else
        update questionnaire
           set kind = p_kind, title = btrim(p_title), template_id = p_template_id, theme = p_theme,
               report_period = p_report_period, parent_id = p_parent_id, opens_on = p_opens_on,
               closes_on = p_closes_on, is_on = coalesce(p_is_on, true), myed_comment = p_myed_comment,
               updated_at = now()
         where id = p_id and course_id = p_course_id
        returning id into _id;
        if not found then
            raise exception 'questionnaire not found' using errcode = 'P0002';
        end if;
    end if;

    if _qs is not null then
        if jsonb_typeof(_qs) <> 'array' then
            raise exception 'questions must be an array' using errcode = '22023';
        end if;
        for _item in select value from jsonb_array_elements(_qs) loop
            _n := _n + 1;
            _qid := nullif(_item->>'id', '')::uuid;
            if _qid is not null then
                update question
                   set display_order = _n, prompt = btrim(_item->>'prompt'), kind = _item->>'kind',
                       options = coalesce(_item->'options', '{}'::jsonb),
                       core_ids = coalesce(array(select jsonb_array_elements_text(_item->'core_ids')), '{}'),
                       repeated_key = nullif(_item->>'repeated_key', ''),
                       teacher_only = coalesce((_item->>'teacher_only')::boolean, false),
                       prompt_translations = coalesce(_item->'prompt_translations', '{}'::jsonb),
                       archived = false, updated_at = now()
                 where id = _qid and questionnaire_id = _id;
                if not found then
                    _qid := null;
                end if;
            end if;
            if _qid is null then
                insert into question (questionnaire_id, display_order, prompt, kind, options, core_ids,
                                      repeated_key, teacher_only, prompt_translations)
                values (_id, _n, btrim(_item->>'prompt'), _item->>'kind', coalesce(_item->'options', '{}'::jsonb),
                        coalesce(array(select jsonb_array_elements_text(_item->'core_ids')), '{}'),
                        nullif(_item->>'repeated_key', ''), coalesce((_item->>'teacher_only')::boolean, false),
                        coalesce(_item->'prompt_translations', '{}'::jsonb))
                returning id into _qid;
            end if;
            _keep := _keep || _qid;
        end loop;
        -- Left out: archived if anyone answered it, otherwise gone.
        update question q set archived = true, updated_at = now()
         where q.questionnaire_id = _id and not (q.id = any(_keep)) and not q.archived
           and exists (select 1 from answer a where a.question_id = q.id);
        delete from question q
         where q.questionnaire_id = _id and not (q.id = any(_keep))
           and not exists (select 1 from answer a where a.question_id = q.id);
    end if;

    _cached := _questionnaire_json(_id);
    perform fv_idem_store(p_idempotency_key, 'upsert_questionnaire', _cached);
    return _cached;
end;
$function$;

create or replace function public.set_questionnaire_on(p_id uuid, p_is_on boolean, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_questionnaire_on');
    if _cached is not null then
        return _cached;
    end if;
    update questionnaire set is_on = coalesce(p_is_on, false), updated_at = now()
     where id = p_id and fv_owns_course(course_id);
    if not found then
        raise exception 'questionnaire not found' using errcode = 'P0002';
    end if;
    _cached := jsonb_build_object('id', p_id, 'is_on', coalesce(p_is_on, false));
    perform fv_idem_store(p_idempotency_key, 'set_questionnaire_on', _cached);
    return _cached;
end;
$function$;

-- Deleting would delete students' answers, so it's refused once anyone has
-- answered; turn it Off instead.
create or replace function public.delete_questionnaire(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'delete_questionnaire');
    if _cached is not null then
        return _cached;
    end if;
    if exists (select 1 from response where questionnaire_id = p_id) then
        raise exception 'students have answered this questionnaire' using errcode = '23503';
    end if;
    delete from questionnaire where id = p_id and fv_owns_course(course_id);
    if not found then
        raise exception 'questionnaire not found' using errcode = 'P0002';
    end if;
    _cached := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_questionnaire', _cached);
    return _cached;
end;
$function$;

-- A code like K7M-4QX: six characters from an alphabet with no 0/O, 1/I/L
-- or 5/S to misread, from the random bytes of a v4 UUID.
create or replace function public._new_access_code()
 returns text
 language plpgsql
 volatile
 set search_path to 'public'
as $$
declare
    _abc   constant text := 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
    _bytes bytea := uuid_send(gen_random_uuid());
    _out   text := '';
begin
    for i in 0..5 loop
        _out := _out || substr(_abc, (get_byte(_bytes, i + 9) % length(_abc)) + 1, 1);
    end loop;
    return substr(_out, 1, 3) || '-' || substr(_out, 4, 3);
end;
$$;

create or replace function public._access_code_hash(p_code text, p_salt text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $$
  select encode(sha256(convert_to(p_salt || ':' || upper(replace(btrim(p_code), '-', '')), 'UTF8')), 'hex');
$$;

-- New codes for a questionnaire's students (every enrolled, not withdrawn
-- student when p_enrollment_ids is null). A student's earlier unused code is revoked.
-- Codes expire at the end of closes_on, or in 30 days with no close date.
-- The plain codes are returned once and never stored; a replayed
-- idempotency key returns {replayed: true} without them, so the slips are
-- printed from the first answer (or the teacher issues again).
create or replace function public.issue_access_codes(
    p_questionnaire_id uuid, p_enrollment_ids uuid[] default null, p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached  jsonb;
    _q       questionnaire%rowtype;
    _expires timestamptz;
    _eid     uuid;
    _code    text;
    _salt    text;
    _out     jsonb := '[]'::jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'issue_access_codes');
    if _cached is not null then
        return _cached;
    end if;
    select * into _q from questionnaire where id = p_questionnaire_id and fv_owns_course(course_id);
    if not found then
        raise exception 'questionnaire not found' using errcode = 'P0002';
    end if;
    _expires := coalesce((_q.closes_on + 1)::timestamptz, now() + interval '30 days');

    for _eid in
        select e.id from enrollment e
         where e.course_id = _q.course_id
           and e.withdrawn_at is null
           and (p_enrollment_ids is null or e.id = any(p_enrollment_ids))
           and fv_owns_enrollment(e.id)
         order by e.roster_position nulls last, e.id
    loop
        update student_access_code set revoked_at = now()
         where enrollment_id = _eid and questionnaire_id = _q.id and used_at is null and revoked_at is null;
        loop
            _code := _new_access_code();
            _salt := encode(uuid_send(gen_random_uuid()), 'hex');
            begin
                insert into student_access_code (enrollment_id, questionnaire_id, code_hash, salt, expires_at)
                values (_eid, _q.id, _access_code_hash(_code, _salt), _salt, _expires);
                exit;
            exception when unique_violation then
                -- A hash collision: draw again.
            end;
        end loop;
        _out := _out || jsonb_build_object('enrollment_id', _eid, 'code', _code);
    end loop;

    perform fv_idem_store(p_idempotency_key, 'issue_access_codes',
                          jsonb_build_object('replayed', true, 'count', jsonb_array_length(_out)));
    return _out;
end;
$function$;

create or replace function public.list_course_questionnaires(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $$
  select coalesce(jsonb_agg(
           _questionnaire_json(q.id) || jsonb_build_object(
             'answered', coalesce((
               select jsonb_agg(distinct r.enrollment_id)
                 from response r where r.questionnaire_id = q.id), '[]'::jsonb))
           order by q.opens_on nulls first, q.created_at), '[]'::jsonb)
    from questionnaire q
   where q.course_id = p_course_id;
$$;

create or replace function public.list_course_responses(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(x.questionnaire_id::text, x.by_student), '{}'::jsonb)
    from (
      select y.questionnaire_id, jsonb_object_agg(y.enrollment_id::text, y.subs) as by_student
        from (
          select r.questionnaire_id, r.enrollment_id,
                 jsonb_agg(jsonb_build_object(
                   'id', r.id, 'submitted_at', r.submitted_at, 'via', r.via,
                   'answers', coalesce((
                     select jsonb_object_agg(a.question_id::text, jsonb_build_object(
                              'num', a.value_num, 'text', a.value_text, 'json', a.value_json))
                       from answer a where a.response_id = r.id), '{}'::jsonb))
                   order by r.submitted_at desc) as subs
            from response r
            join questionnaire q on q.id = r.questionnaire_id
           where q.course_id = p_course_id
           group by r.questionnaire_id, r.enrollment_id
        ) y
       group by y.questionnaire_id
    ) x;
$$;

revoke all on function public._questionnaire_json(uuid) from public, anon;
grant execute on function public._questionnaire_json(uuid) to authenticated, service_role;
revoke all on function public.list_questionnaire_templates() from public, anon;
grant execute on function public.list_questionnaire_templates() to authenticated, service_role;
revoke all on function public.upsert_questionnaire(uuid, text, text, text, text, integer, uuid, date, date, boolean, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.upsert_questionnaire(uuid, text, text, text, text, integer, uuid, date, date, boolean, text, jsonb, uuid, uuid) to authenticated;
revoke all on function public.set_questionnaire_on(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_questionnaire_on(uuid, boolean, uuid) to authenticated;
revoke all on function public.delete_questionnaire(uuid, uuid) from public, anon;
grant execute on function public.delete_questionnaire(uuid, uuid) to authenticated;
revoke all on function public._new_access_code() from public, anon;
grant execute on function public._new_access_code() to authenticated, service_role;
revoke all on function public._access_code_hash(text, text) from public, anon;
grant execute on function public._access_code_hash(text, text) to authenticated, service_role;
revoke all on function public.issue_access_codes(uuid, uuid[], uuid) from public, anon;
grant execute on function public.issue_access_codes(uuid, uuid[], uuid) to authenticated;
revoke all on function public.list_course_questionnaires(uuid) from public, anon;
grant execute on function public.list_course_questionnaires(uuid) to authenticated, service_role;
revoke all on function public.list_course_responses(uuid) from public, anon;
grant execute on function public.list_course_responses(uuid) to authenticated, service_role;
