-- Students answer on their phones (2026-10-25). docs/STUDENT-VOICE-PLAN.md,
-- PR 6 (Security).
--
-- A student scans their slip; the student-submit edge function (Supabase,
-- ca-central-1) calls the two functions below over a direct database
-- connection. Nothing here is reachable through the API: the schema is not
-- exposed, and anon and authenticated get nothing. The 2026-10-13 anon
-- revoke stays total.
--
--   student_submit.open(p_code, p_ip_hash) -> {ok, token, expires_at,
--     student {first_name}, course {name}, parts [{questionnaire + questions}]}
--     or {ok: false, error}. The code is checked against the salted hashes
--     of live codes; the token is good for 30 minutes and is the only thing
--     submit accepts.
--   student_submit.submit(p_token, p_answers, p_ip_hash) -> {ok, submitted_at}
--     or {ok: false, error[, question_id]}. Saves one response per part,
--     marks the code used, and copies self-assessments to
--     core_self_assessment so the Learner Profile shows them. A second submit
--     with the same token returns the first answer and saves nothing (a
--     double tap saves once).
--
-- Rules:
--   - A questionnaire code works once, only while its questionnaire is On
--     and today (in the class's time zone) is within its dates.
--   - Ten failed opens from one IP hash in 15 minutes lock it out for the
--     rest of that window; 500 failed opens across everyone in 10 minutes
--     pause opening (a guessing run); 120 submits a minute per class is the
--     ceiling. The edge function sends an HMAC of the IP, never the IP.
--   - student_submit.attempt records route, outcome, code id, class id and
--     time. Never answers or names. Rows older than 30 days are removed.
--   - Responses are append-only from this path.
--
-- Also: issue_access_codes now draws again when a new code would read the
-- same as another live code (each code has its own salt, so the unique
-- hash index can't catch that).

create schema if not exists student_submit;
revoke all on schema student_submit from public, anon, authenticated;
grant usage on schema student_submit to service_role;

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists student_submit.session (
  id           uuid        primary key default gen_random_uuid(),
  token_hash   text        not null unique,
  code_id      uuid        not null references public.student_access_code(id) on delete cascade,
  expires_at   timestamptz not null,
  submitted_at timestamptz,
  result       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists session_code on student_submit.session (code_id);

create table if not exists student_submit.attempt (
  id        bigint      generated always as identity primary key,
  at        timestamptz not null default now(),
  route     text        not null check (route in ('open', 'submit')),
  outcome   text        not null,
  ip_hash   text,
  code_id   uuid,
  course_id uuid
);
create index if not exists attempt_ip on student_submit.attempt (ip_hash, at);
create index if not exists attempt_course on student_submit.attempt (course_id, at);
create index if not exists attempt_at on student_submit.attempt (at);

alter table student_submit.session enable row level security;
alter table student_submit.attempt enable row level security;
revoke all on student_submit.session, student_submit.attempt from public, anon, authenticated;

-- The live codes, which open scans.
create index if not exists student_access_code_live on public.student_access_code (expires_at)
  where used_at is null and revoked_at is null;

-- ── Helpers ─────────────────────────────────────────────────────────────
create or replace function student_submit._log(
    p_route text, p_outcome text, p_ip_hash text, p_code_id uuid default null, p_course_id uuid default null
) returns void
 language sql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $$
  insert into student_submit.attempt (route, outcome, ip_hash, code_id, course_id)
  values (p_route, p_outcome, left(p_ip_hash, 128), p_code_id, p_course_id);
$$;

-- Is the questionnaire taking answers today, in the class's time zone?
-- null when it is, otherwise the reason.
create or replace function student_submit._closed_reason(p_q public.questionnaire, p_tz text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $$
declare
    _today date := (now() at time zone coalesce(nullif(p_tz, ''), 'America/Vancouver'))::date;
begin
    if not p_q.is_on then return 'closed'; end if;
    if p_q.opens_on is not null and _today < p_q.opens_on then return 'not_open_yet'; end if;
    if p_q.closes_on is not null and _today > p_q.closes_on then return 'closed'; end if;
    return null;
end;
$$;

-- A questionnaire as the phone sees it: no teacher fields, no archived
-- questions. teacher_only questions are shown (the student answers them);
-- the flag lets the page say only the teacher reads the answer.
create or replace function student_submit._part(p_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $$
  select jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'title', q.title, 'theme', q.theme, 'closes_on', q.closes_on,
           'questions', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', x.id, 'prompt', x.prompt, 'prompt_translations', x.prompt_translations,
                      'kind', x.kind, 'options', x.options, 'core_ids', to_jsonb(x.core_ids),
                      'teacher_only', x.teacher_only)
                    order by x.display_order, x.created_at)
               from question x
              where x.questionnaire_id = q.id and not x.archived), '[]'::jsonb))
    from questionnaire q
   where q.id = p_id;
$$;

-- ── open ────────────────────────────────────────────────────────────────
create or replace function student_submit.open(p_code text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    _rows   int;
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _child  questionnaire%rowtype;
    _course course%rowtype;
    _name   text;
    _why    text;
    _token  text;
    _exp    timestamptz := now() + interval '30 minutes';
    _parts  jsonb;
begin
    if random() < 0.02 then
        delete from attempt where at < now() - interval '30 days';
        delete from session where expires_at < now() - interval '1 day';
    end if;

    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'open' and outcome <> 'ok'
           and at > now() - interval '15 minutes') >= 10 then
        perform _log('open', 'locked', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if (select count(*) from attempt
         where route = 'open' and outcome in ('not_found', 'bad_format')
           and at > now() - interval '10 minutes') >= 500 then
        perform _log('open', 'busy', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    if _code !~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$' then
        perform _log('open', 'bad_format', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- Live (or used) codes only; each has its own salt.
    select count(*) into _rows
      from student_access_code
     where revoked_at is null and expires_at > now()
       and code_hash = _access_code_hash(_code, salt);
    if _rows <> 1 then
        perform _log('open', case when _rows = 0 then 'not_found' else 'ambiguous' end, p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _c
      from student_access_code
     where revoked_at is null and expires_at > now()
       and code_hash = _access_code_hash(_code, salt)
       for update;

    if _c.questionnaire_id is null then
        -- Report codes come with the phone report (PR 9).
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.used_at is not null then
        perform _log('open', 'used', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'used');
    end if;
    if _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('open', 'not_found', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        perform _log('open', _why, p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', _why, 'opens_on', _q.opens_on);
    end if;
    if (select count(*) from session where code_id = _c.id) >= 20 then
        perform _log('open', 'too_many_opens', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;

    _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
    insert into session (token_hash, code_id, expires_at)
    values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;

    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name) into _name
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;

    _parts := jsonb_build_array(_part(_q.id));
    -- A Goal Check-In rides on its reflection's slip.
    for _child in
        select * from questionnaire
         where parent_id = _q.id and kind = 'goal_checkin' and is_on
         order by created_at
    loop
        if _closed_reason(_child, _course.timezone) is null then
            _parts := _parts || jsonb_build_array(_part(_child.id));
        end if;
    end loop;

    perform _log('open', 'ok', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object(
        'ok', true, 'token', _token, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name),
        'parts', _parts);
end;
$function$;

-- ── submit ──────────────────────────────────────────────────────────────

-- One answer checked and tidied: {num, text, json} to store, or null when
-- it says nothing (skipped). Raises 'invalid' when it can't be right.
create or replace function student_submit._clean_answer(p_kind text, p_options jsonb, p_core_ids text[], p_value jsonb)
 returns jsonb
 language plpgsql
 immutable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $$
declare
    _t      text;
    _arr    jsonb := '[]'::jsonb;
    _e      jsonb;
    _k      text;
    _n      int;
    _levels jsonb := '{}'::jsonb;
begin
    if p_value is null or p_value = 'null'::jsonb then return null; end if;
    if p_kind = 'text' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := btrim(p_value #>> '{}');
        if _t = '' then return null; end if;
        if char_length(_t) > 2000 then raise exception 'invalid'; end if;
        return jsonb_build_object('text', _t);
    elsif p_kind = 'short_set' then
        if jsonb_typeof(p_value) <> 'array'
           or jsonb_array_length(p_value) > greatest(jsonb_array_length(coalesce(p_options->'labels', '[]')), 1) then
            raise exception 'invalid';
        end if;
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' or char_length(_e #>> '{}') > 300 then raise exception 'invalid'; end if;
            _arr := _arr || to_jsonb(btrim(_e #>> '{}'));
        end loop;
        if not exists (select 1 from jsonb_array_elements_text(_arr) v where v <> '') then return null; end if;
        return jsonb_build_object('json', _arr,
               'text', (select string_agg(v, ' · ') from jsonb_array_elements_text(_arr) v where v <> ''));
    elsif p_kind = 'choice' then
        if jsonb_typeof(p_value) = 'string' then p_value := jsonb_build_array(p_value); end if;
        if jsonb_typeof(p_value) <> 'array' then raise exception 'invalid'; end if;
        if jsonb_array_length(p_value) = 0 then return null; end if;
        if (p_options->>'multiple') = 'false' and jsonb_array_length(p_value) > 1 then raise exception 'invalid'; end if;
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' or not (coalesce(p_options->'choices', '[]') ? (_e #>> '{}')) then
                raise exception 'invalid';
            end if;
        end loop;
        return jsonb_build_object('json', p_value,
               'text', (select string_agg(v, ', ') from jsonb_array_elements_text(p_value) v));
    elsif p_kind = 'scale4' then
        -- {levels: {PAR: 3, PPI: 2}, why} on Core Competencies, or {level: 3, why}.
        if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid'; end if;
        _t := nullif(btrim(coalesce(p_value->>'why', '')), '');
        if char_length(coalesce(_t, '')) > 2000 then raise exception 'invalid'; end if;
        if cardinality(p_core_ids) > 0 then
            if jsonb_typeof(coalesce(p_value->'levels', '{}')) <> 'object' then raise exception 'invalid'; end if;
            for _k, _e in select * from jsonb_each(coalesce(p_value->'levels', '{}')) loop
                if not (_k = any(p_core_ids)) or jsonb_typeof(_e) <> 'number'
                   or (_e #>> '{}')::numeric not in (1, 2, 3, 4) then
                    raise exception 'invalid';
                end if;
                _levels := _levels || jsonb_build_object(_k, (_e #>> '{}')::int);
            end loop;
            if _levels = '{}'::jsonb and _t is null then return null; end if;
            return jsonb_build_object('json', jsonb_build_object('levels', _levels), 'text', _t);
        end if;
        if p_value ? 'level' then
            if jsonb_typeof(p_value->'level') <> 'number' or (p_value->>'level')::numeric not in (1, 2, 3, 4) then
                raise exception 'invalid';
            end if;
            _n := (p_value->>'level')::int;
        end if;
        if _n is null and _t is null then return null; end if;
        return jsonb_build_object('num', _n, 'text', _t);
    elsif p_kind = 'goal_status' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := p_value #>> '{}';
        select i into _n from jsonb_array_elements_text(coalesce(p_options->'choices', '[]')) with ordinality c(v, i)
         where v = _t;
        if _n is null then raise exception 'invalid'; end if;
        return jsonb_build_object('num', _n, 'text', _t);
    elsif p_kind = 'core_pick' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := p_value #>> '{}';
        if not (_t = any(case when cardinality(p_core_ids) > 0 then p_core_ids
                              else array['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR'] end)) then
            raise exception 'invalid';
        end if;
        return jsonb_build_object('text', _t);
    end if;
    raise exception 'invalid';
end;
$$;

create or replace function student_submit.submit(p_token text, p_answers jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s       session%rowtype;
    _c       student_access_code%rowtype;
    _q       questionnaire%rowtype;
    _course  course%rowtype;
    _why     text;
    _parts   uuid[];
    _qid     text;
    _val     jsonb;
    _x       question%rowtype;
    _clean   jsonb;
    _clean_by_part jsonb := '{}'::jsonb;
    _part    uuid;
    _rid     uuid;
    _term    text;
    _core    text;
    _lvl     jsonb;
    _now     timestamptz := now();
    _result  jsonb;
begin
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('submit', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       for update;
    if not found then
        perform _log('submit', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    -- A second tap: the first answer, nothing saved twice.
    if _s.submitted_at is not null then
        return _s.result;
    end if;
    if _s.expires_at < _now then
        perform _log('submit', 'expired', p_ip_hash, _s.code_id);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    select * into _c from student_access_code where id = _s.code_id for update;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.revoked_at is not null or _c.used_at is not null then
        perform _log('submit', case when _c.used_at is not null then 'used' else 'revoked' end,
                     p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', case when _c.used_at is not null then 'used' else 'not_found' end);
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null or _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('submit', coalesce(_why, 'closed'), p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', coalesce(_why, 'closed'));
    end if;
    if (select count(*) from attempt
         where course_id = _q.course_id and route = 'submit' and outcome = 'ok'
           and at > _now - interval '1 minute') >= 120 then
        perform _log('submit', 'busy', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    if jsonb_typeof(p_answers) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(p_answers)) > 80
       or octet_length(p_answers::text) > 100000 then
        perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    -- The parts the slip opened: the questionnaire and its open Goal Check-In.
    select array_agg(id) into _parts from (
        select _q.id as id
        union all
        select g.id from questionnaire g
         where g.parent_id = _q.id and g.kind = 'goal_checkin' and g.is_on
           and _closed_reason(g, _course.timezone) is null
    ) p;

    for _qid, _val in select * from jsonb_each(p_answers) loop
        if _qid !~ '^[0-9a-fA-F-]{36}$' then
            perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'invalid');
        end if;
        select * into _x from question
         where id = _qid::uuid and not archived and questionnaire_id = any(_parts);
        if not found then
            perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end if;
        begin
            _clean := _clean_answer(_x.kind, _x.options, _x.core_ids, _val);
        exception when others then
            perform _log('submit', 'invalid', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end;
        if _clean is not null then
            _clean_by_part := jsonb_set(_clean_by_part, array[_x.questionnaire_id::text],
                coalesce(_clean_by_part->(_x.questionnaire_id::text), '{}'::jsonb)
                  || jsonb_build_object(_x.id::text, _clean || jsonb_build_object('kind', _x.kind)));
        end if;
    end loop;
    if _clean_by_part = '{}'::jsonb then
        perform _log('submit', 'empty', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'empty');
    end if;

    -- The class's reporting term for self-assessments: 'T' + the period, or
    -- '' for a class without terms (as the client keys them).
    _term := case when _q.report_period is not null
                   and jsonb_typeof(_course.reporting_terms) = 'array'
                   and jsonb_array_length(_course.reporting_terms) > 0
                  then 'T' || _q.report_period else '' end;

    foreach _part in array _parts loop
        if not (_clean_by_part ? _part::text) then continue; end if;
        insert into response (questionnaire_id, enrollment_id, via, submitted_at)
        values (_part, _c.enrollment_id, 'link', _now)
        returning id into _rid;
        for _qid, _val in select * from jsonb_each(_clean_by_part->(_part::text)) loop
            insert into answer (response_id, question_id, value_num, value_text, value_json)
            values (_rid, _qid::uuid, (_val->>'num')::numeric, _val->>'text', _val->'json');
            if _val->>'kind' = 'scale4' and _val->'json' ? 'levels' then
                for _core, _lvl in select * from jsonb_each(_val->'json'->'levels') loop
                    insert into core_self_assessment (enrollment_id, core_id, term_key, level, body)
                    values (_c.enrollment_id, _core, _term, (_lvl #>> '{}')::int, _val->>'text')
                    on conflict (enrollment_id, core_id, term_key)
                    do update set level = excluded.level,
                                  body = coalesce(excluded.body, core_self_assessment.body),
                                  updated_at = now();
                end loop;
            end if;
        end loop;
    end loop;

    update student_access_code set used_at = _now where id = _c.id;
    _result := jsonb_build_object('ok', true, 'submitted_at', _now);
    update session set submitted_at = _now, result = _result where id = _s.id;
    perform _log('submit', 'ok', p_ip_hash, _c.id, _q.course_id);
    return _result;
end;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────
revoke all on all functions in schema student_submit from public, anon, authenticated;
grant execute on function student_submit.open(text, text) to service_role;
grant execute on function student_submit.submit(text, jsonb, text) to service_role;

-- ── issue_access_codes: no two live codes read the same ─────────────────
-- Draws a code no live code (any class's) already reads as, stores its
-- salted hash, and returns the plain code. Definer so the check sees past
-- the caller's RLS; it never says whether a given code exists, so it is no
-- help in guessing one.
create or replace function public._issue_access_code(
    p_enrollment_id uuid, p_questionnaire_id uuid, p_expires_at timestamptz
) returns text
 language plpgsql
 volatile
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _code text;
    _salt text;
begin
    if not exists (select 1 from questionnaire q join enrollment e on e.course_id = q.course_id
                    where q.id = p_questionnaire_id and e.id = p_enrollment_id
                      and fv_owns_course(q.course_id) and fv_owns_enrollment(e.id)) then
        raise exception 'questionnaire not found' using errcode = 'P0002';
    end if;
    loop
        _code := _new_access_code();
        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));
        _salt := encode(uuid_send(gen_random_uuid()), 'hex');
        begin
            insert into student_access_code (enrollment_id, questionnaire_id, code_hash, salt, expires_at)
            values (p_enrollment_id, p_questionnaire_id, _access_code_hash(_code, _salt), _salt, p_expires_at);
            return _code;
        exception when unique_violation then
            -- A hash collision: draw again.
        end;
    end loop;
end;
$function$;
revoke all on function public._issue_access_code(uuid, uuid, timestamptz) from public, anon;
grant execute on function public._issue_access_code(uuid, uuid, timestamptz) to authenticated;

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
        _out := _out || jsonb_build_object('enrollment_id', _eid, 'code', _issue_access_code(_eid, _q.id, _expires));
    end loop;

    perform fv_idem_store(p_idempotency_key, 'issue_access_codes',
                          jsonb_build_object('replayed', true, 'count', jsonb_array_length(_out)));
    return _out;
end;
$function$;
