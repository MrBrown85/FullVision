-- Questionnaire slips: two fixes to the identity check (2026-11-01).
--
-- What was wrong, found the day 20261101_questionnaire_identity_check.sql
-- went live:
-- 1. The phone chose what to ask from today's roster, not from what the slip
--    printed. A slip printed with a password for a student with no birthday
--    or number, then a roster import that added one, left the phone asking
--    for a birthday or number with no place for the password on the slip.
--    open() now says also_password when a password is on file, and the phone
--    offers it beside the birthday and number. A reprint for a student who
--    now has a birthday or number clears the stored password, since that
--    slip prints none.
-- 2. The limits told students the wrong thing: five misses locked a
--    session ("wait 15 minutes", though scanning again started over at once)
--    and ten locked the slip, so "4 tries left" could be untrue. Now one
--    count per slip: five wrong tries in all, tries_left counts down from it,
--    and the fifth says to ask for a new slip.

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
    _pw     boolean;
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
                when nullif(btrim(s.slip_password), '') is not null then 'password' end,
           nullif(btrim(s.slip_password), '') is not null
      into _name, _by, _pw
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
        -- A password printed before the teacher added a birthday or number
        -- still works, so the phone offers it beside them.
        'also_password', _by = 'identity' and _pw,
        'preview', student_submit._preview(_c.id));
end;
$function$;

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
    _misses int;
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

    -- Five wrong tries on a slip, across every time it was scanned, and the
    -- slip stops working: one count, so "tries left" is always true.
    select count(*) into _misses from attempt where code_id = _c.id and outcome = 'wrong_identity';
    if _misses >= 5 then
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
        if _misses + 1 >= 5 then
            return jsonb_build_object('ok', false, 'error', 'slip_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', 4 - _misses);
    end if;

    update session set checked_at = now() where id = _s.id;
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;
    perform _log('open', 'verified', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object('ok', true) || _payload(_c.id);
end;
$function$;

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
        -- The new slip prints no password, so an old one stops being offered.
        if _pw is not null then
            update student set slip_password = null where id = _sid;
        end if;
        return null;
    end if;
    if _pw is null then
        _pw := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 7))::bit(28)::int % 10000)::text, 4, '0');
        update student set slip_password = _pw where id = _sid;
    end if;
    return _pw;
end;
$function$;
