-- Questionnaire slips: prove it's you (2026-11-01).
--
-- What was wrong: a questionnaire slip's code was the only credential.
-- Anyone holding a student's slip could answer as that student, and open()
-- handed the questions back at once, with the course goal the student had
-- written earlier, before anything was checked.
--
-- Now open() returns only the first name, the class and what the questions
-- are called. The student proves who they are in verify(): their birthday or
-- student number when the teacher entered one, otherwise a four-digit
-- password the slip prints (student.slip_password, made the first time a
-- slip is issued for a student with neither). A match hands over the
-- questions; submit() refuses a session that hasn't matched. Five misses
-- lock a session, ten on one code lock the slip. Phone reports keep their
-- birthday check (check()), unchanged.

alter table public.student add column if not exists slip_password text;

-- ── Normalized for comparing: letters and digits, upper case ─────────────
create or replace function student_submit._norm(p text) returns text
 language sql immutable
as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- ── What the slip opens, before the check: titles and question counts ────
create or replace function student_submit._preview(p_code_id uuid) returns jsonb
 language sql stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $$
    select coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'count',
               (select count(*) from question x where x.questionnaire_id = q.id and not x.archived
                  and not coalesce(x.teacher_only, false)))
             order by q.parent_id nulls first, q.created_at), '[]'::jsonb)
      from student_access_code c
      join questionnaire p on p.id = c.questionnaire_id
      join course co on co.id = p.course_id
      join questionnaire q on q.id = p.id
         or (q.parent_id = p.id and q.kind = 'goal_checkin' and q.is_on
             and student_submit._closed_reason(q, co.timezone) is null)
     where c.id = p_code_id
$$;

-- ── The questions and their context, once the student has matched ───────
create or replace function student_submit._payload(p_code_id uuid) returns jsonb
 language plpgsql stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _child  questionnaire%rowtype;
    _course course%rowtype;
    _parts  jsonb;
    _ctx    jsonb := '{}'::jsonb;
begin
    select * into _c from student_access_code where id = p_code_id;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;

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

    -- The Goal Check-In shows the course goal the student last wrote in About
    -- Me (their own words, back to the holder of their own slip).
    if exists (select 1 from jsonb_array_elements(_parts) p where p->>'kind' = 'goal_checkin') then
        select jsonb_build_object('course_goal', jsonb_build_object('text', a.value_text, 'at', r.submitted_at))
          into _ctx
          from answer a
          join question x on x.id = a.question_id
          join response r on r.id = a.response_id
          join questionnaire q2 on q2.id = r.questionnaire_id
         where r.enrollment_id = _c.enrollment_id and q2.course_id = _q.course_id
           and x.repeated_key = 'better_at' and nullif(btrim(a.value_text), '') is not null
         order by r.submitted_at desc
         limit 1;
    end if;

    return jsonb_build_object('parts', _parts, 'context', coalesce(_ctx, '{}'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.open(p_code text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
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
    _exp    timestamptz := now() + interval '80 minutes';
    _parts  jsonb;
    _ctx    jsonb := '{}'::jsonb;
    _r      phone_report%rowtype;
    _dob    date;
    _by     text;
begin
    if random() < 0.02 then
        delete from attempt where at < now() - interval '30 days';
        delete from session where expires_at < now() - interval '1 day';
    end if;

    -- A school's students share one address, so the limit is generous and
    -- counts only codes that weren't found (a guess), not closed forms,
    -- used slips or wrong birthdays.
    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'open' and outcome in ('not_found', 'bad_format', 'ambiguous')
           and at > now() - interval '15 minutes') >= 60 then
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

    -- A phone report's code opens to the birthday check, not the report:
    -- check() hands the report over once the birthday matches. It works
    -- until the report's last day or until the teacher closes it, as often
    -- as the student likes.
    if _c.phone_report_id is not null then
        select * into _r from phone_report where id = _c.phone_report_id;
        select * into _course from course where id = _r.course_id;
        if _course.deleted_at is not null
           or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
            perform _log('open', 'not_found', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if _r.closed_at is not null
           or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
            perform _log('open', 'closed', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'report_closed');
        end if;
        if (select count(*) from session where code_id = _c.id) >= 200 then
            perform _log('open', 'too_many_opens', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'locked');
        end if;
        _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
        insert into session (token_hash, code_id, expires_at)
        values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);
        select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name), s.date_of_birth into _name, _dob
          from enrollment e join student s on s.id = e.student_id
         where e.id = _c.enrollment_id;
        perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object(
            'ok', true, 'kind', 'report', 'token', _token, 'expires_at', _exp,
            'student', jsonb_build_object('first_name', _name),
            'course', jsonb_build_object('name', _course.name, 'block', _course.block),
            'report', jsonb_build_object('title', coalesce(_r.term_label, 'Report ' || _r.term), 'expires_on', _r.expires_on),
            'has_birthday', _dob is not null);
    end if;
    if _c.questionnaire_id is null then
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

    -- Who the student must prove they are: their birthday or student number
    -- when the teacher entered one, else the password printed on the slip.
    -- A slip printed before passwords existed, for a student with neither,
    -- has nothing to check against: they need a new slip.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when nullif(btrim(s.slip_password), '') is not null then 'password' end
      into _name, _by
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    if _by is null then
        perform _log('open', 'no_identity', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;

    _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
    insert into session (token_hash, code_id, expires_at)
    values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);

    -- The questions wait for verify(); the slip alone shows only the first
    -- name and what the questions are called.
    perform _log('open', 'ok', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object(
        'ok', true, 'kind', 'questionnaire', 'token', _token, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        'preview', student_submit._preview(_c.id));
end;
$function$;

-- ── verify: the birthday, student number or slip password ────────────────
create or replace function student_submit.verify(
    p_token text, p_birthday text, p_student_number text, p_password text, p_ip_hash text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s      session%rowtype;
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _course course%rowtype;
    _why    text;
    _dob    date;
    _num    text;
    _pw     text;
    _given  date;
    _match  boolean := false;
begin
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       for update;
    if not found or _s.expires_at < now() then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _c from student_access_code where id = _s.code_id for update;
    if _c.questionnaire_id is null or _c.revoked_at is not null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.used_at is not null then
        perform _log('open', 'used', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'used');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null or _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('open', coalesce(_why, 'closed'), p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', coalesce(_why, 'closed'), 'opens_on', _q.opens_on);
    end if;

    -- Matched already (a second tap, or the page reloaded): the questions again.
    if _s.checked_at is not null then
        return jsonb_build_object('ok', true) || _payload(_c.id);
    end if;

    -- Five misses on this session, or ten on this slip ever, and it stops.
    if _s.check_fails >= 5 then
        perform _log('open', 'locked', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if (select count(*) from attempt where code_id = _c.id and outcome = 'wrong_identity') >= 10 then
        perform _log('open', 'locked', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'slip_locked');
    end if;

    select s.date_of_birth, nullif(_norm(s.student_number), ''), nullif(_norm(s.slip_password), '')
      into _dob, _num, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;

    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;
    _match := (_dob is not null and _given is not null and _given = _dob)
           or (_num is not null and _norm(p_student_number) = _num)
           or (_pw is not null and _norm(p_password) = _pw);

    if not _match then
        update session set check_fails = check_fails + 1 where id = _s.id;
        perform _log('open', 'wrong_identity', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', greatest(0, 4 - _s.check_fails));
    end if;

    update session set checked_at = now() where id = _s.id;
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;
    perform _log('open', 'verified', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object('ok', true) || _payload(_c.id);
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.submit(p_token text, p_answers jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
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
    _r       phone_report%rowtype;
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
    if _c.phone_report_id is not null then
        -- A reply to a phone report: only after the birthday check, once per
        -- student, while the report is open. The code keeps working for
        -- reading.
        select * into _r from phone_report where id = _c.phone_report_id;
        if _s.checked_at is null then
            perform _log('submit', 'not_checked', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'expired');
        end if;
        select * into _q from questionnaire where id = _r.reply_questionnaire_id;
        if not found or _r.closed_at is not null then
            perform _log('submit', 'closed', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'closed');
        end if;
        if exists (select 1 from response where questionnaire_id = _q.id and enrollment_id = _c.enrollment_id) then
            perform _log('submit', 'used', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'used');
        end if;
    else
        select * into _q from questionnaire where id = _c.questionnaire_id;
        -- The slip alone isn't enough: verify() has to have matched.
        if _s.checked_at is null then
            perform _log('submit', 'not_checked', p_ip_hash, _c.id, _q.course_id);
            return jsonb_build_object('ok', false, 'error', 'expired');
        end if;
    end if;
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

    -- The parts the slip opened: the questionnaire and its open Goal Check-In
    -- (a report reply has only itself).
    select array_agg(id) into _parts from (
        select _q.id as id
        union all
        select g.id from questionnaire g
         where _c.phone_report_id is null
           and g.parent_id = _q.id and g.kind = 'goal_checkin' and g.is_on
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
                    values (_c.enrollment_id, _core, _term, (_lvl #>> '{}')::int,
                            case when jsonb_typeof(_val->'json'->'why') = 'object'
                                 then _val->'json'->'why'->>_core
                                 else _val->'json'->>'why' end)
                    on conflict (enrollment_id, core_id, term_key)
                    do update set level = excluded.level,
                                  body = coalesce(excluded.body, core_self_assessment.body),
                                  updated_at = now();
                end loop;
            end if;
        end loop;
    end loop;

    if _c.phone_report_id is null then
        update student_access_code set used_at = _now where id = _c.id;
    end if;
    _result := jsonb_build_object('ok', true, 'submitted_at', _now);
    update session set submitted_at = _now, result = _result where id = _s.id;
    perform _log('submit', 'ok', p_ip_hash, _c.id, _q.course_id);
    return _result;
end;
$function$;

-- ── The slip password: made once for a student with no birthday or number ─
-- Four digits, kept on the student so a reprint shows the same one. Null
-- when the student has a birthday or student number (the slip asks for
-- those instead). Definer so it can fill the column; it checks ownership.
create or replace function public._slip_password(p_enrollment_id uuid) returns text
 language plpgsql
 volatile
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _sid uuid;
    _dob date;
    _num text;
    _pw  text;
begin
    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;
    select s.id, s.date_of_birth, nullif(btrim(s.student_number), ''), nullif(btrim(s.slip_password), '')
      into _sid, _dob, _num, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = p_enrollment_id;
    if _dob is not null or _num is not null then
        return null;
    end if;
    if _pw is null then
        _pw := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 7))::bit(28)::int % 10000)::text, 4, '0');
        update student set slip_password = _pw where id = _sid;
    end if;
    return _pw;
end;
$function$;
revoke all on function public._slip_password(uuid) from public, anon;
grant execute on function public._slip_password(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.issue_access_codes(p_questionnaire_id uuid, p_enrollment_ids uuid[] DEFAULT NULL::uuid[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
        _out := _out || jsonb_build_object('enrollment_id', _eid, 'code', _issue_access_code(_eid, _q.id, _expires),
                                           'password', _slip_password(_eid));
    end loop;

    perform fv_idem_store(p_idempotency_key, 'issue_access_codes',
                          jsonb_build_object('replayed', true, 'count', jsonb_array_length(_out)));
    return _out;
end;
$function$;

revoke all on function student_submit._norm(text) from public;
revoke all on function student_submit._preview(uuid) from public;
revoke all on function student_submit._payload(uuid) from public;
revoke all on function student_submit.verify(text, text, text, text, text) from public, anon, authenticated;
grant execute on function student_submit.verify(text, text, text, text, text) to service_role;
