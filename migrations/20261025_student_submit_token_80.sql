-- A student's session lasts a class block (2026-10-25). Colin: 80 minutes,
-- the length of a block, rather than 30, so a student who opens the slip at
-- the start of class can answer through to the end without the page
-- renewing behind them. Only the token's lifetime in student_submit.open
-- changes; grants carry over (create or replace keeps them).

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
    _exp    timestamptz := now() + interval '80 minutes';
    _parts  jsonb;
    _ctx    jsonb := '{}'::jsonb;
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

    perform _log('open', 'ok', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object(
        'ok', true, 'token', _token, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'parts', _parts,
        'context', coalesce(_ctx, '{}'::jsonb));
end;
$function$;
