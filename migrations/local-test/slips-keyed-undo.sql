-- SLIPS KEYED, UNDONE. Not a migration: the way back from
-- migrations/2026111160_slips_keyed.sql. Kept under local-test/ so CI's
-- drift check does not wait for it to be applied. Proved by
-- migrations/local-test/slips_keyed.py (scenario undo).
--
-- It puts back, word for word and with their grants, the eight functions
-- the file dropped (the bodies below are written by slips_keyed.py from the
-- database the file was tested on, never by hand), and drops the seven it
-- made and the password trigger. It KEEPS the four new columns, their
-- check and indexes and every tag in them, so applying the file again
-- brings back every slip converted or made since. While it is undone, such
-- a slip does not open (reprint it), and a cleared stored password does
-- not come back (the next print makes a new one). code_hash and salt go
-- back to not null only when no row lacks them.
-- It refuses, with nothing changed, unless every new function is as the
-- file leaves it or already gone (a second run changes nothing).
begin;
set local lock_timeout = '5s';
do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/slips_keyed.py)
            ('student_submit._slip_old_until()',                           '568527d9c8d239655dd55ab7c52009da'),
            ('public._slip_password_settle(uuid)',                         '9df7e6113498810271631c5a410b1554'),
            ('public._slip_password_on_change()',                          'e6f31871e265ff7c6eb480e60d22c149'),
            ('student_submit.open(text,text,text,text)',                   '1b0862066e6d8c546f3944f12248be26'),
            ('student_submit.verify(text,text,text,text,text,text,text)',  'b6b51a888f68aa5b54ffdf866756ee47'),
            ('student_submit.slip_roster(uuid,text,uuid)',                 '33954320e0812e4c22e5936bb2ee76a9'),
            ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% is not as the file leaves it (found %): something else changed it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN drops (written by migrations/local-test/slips_keyed.py)
            ('student_submit.open(text,text)',                                'd11b2e67cbf10cae4d44ae6082fd8e01'),
            ('student_submit.verify(text,text,text,text,text)',               '901e62bdb5d94a9ffcebe33563425ad7'),
            ('public.issue_access_codes(uuid,uuid[],uuid)',                   'c96c672abd7d81b00b59c8819c580c78'),
            ('public.issue_report_codes(uuid,uuid[],uuid)',                   'cdda4154e26cd4c2f9b1dd4648de959c'),
            ('public._issue_access_code(uuid,uuid,timestamp with time zone)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamp with time zone)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('public._new_access_code()',                                     '59989059b38fc77419052a42206c3aaa'),
            ('public._slip_password(uuid)',                                   'fc16d2f952f0a9f05ab49d7a1c16a5ea')
            -- FINGERPRINTS-END
        ) as v(fn, before)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.before then
            raise exception '% is there and is not as before the file (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

drop trigger if exists student_access_code_slip_password on public.student_access_code;
drop function if exists student_submit.open(text, text, text, text);
drop function if exists student_submit.verify(text, text, text, text, text, text, text);
drop function if exists student_submit.slip_roster(uuid, text, uuid);
drop function if exists student_submit.issue_slips(uuid, text, uuid, jsonb, text, uuid);
drop function if exists public._slip_password_on_change();
drop function if exists public._slip_password_settle(uuid);
drop function if exists student_submit._slip_old_until();

-- UNDO-BODIES-BEGIN (written by migrations/local-test/slips_keyed.py)
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
           and at > now() - interval '15 minutes') >= 300 then
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

CREATE OR REPLACE FUNCTION student_submit.verify(p_token text, p_birthday text, p_student_number text, p_password text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public.issue_report_codes(p_report_id uuid, p_enrollment_ids uuid[] DEFAULT NULL::uuid[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _cached jsonb;
    _r      phone_report%rowtype;
    _eid    uuid;
    _out    jsonb := '[]'::jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'issue_report_codes');
    if _cached is not null then
        return _cached;
    end if;
    select * into _r from phone_report where id = p_report_id and fv_owns_course(course_id);
    if not found then
        raise exception 'report not found' using errcode = 'P0002';
    end if;
    if _r.closed_at is not null then
        raise exception 'this report is closed' using errcode = '22023';
    end if;
    for _eid in
        select s.enrollment_id from phone_report_student s
          join enrollment e on e.id = s.enrollment_id
         where s.report_id = _r.id and e.withdrawn_at is null
           and (p_enrollment_ids is null or s.enrollment_id = any(p_enrollment_ids))
         order by e.roster_position nulls last, e.id
    loop
        update student_access_code set revoked_at = now()
         where enrollment_id = _eid and phone_report_id = _r.id and revoked_at is null;
        _out := _out || jsonb_build_object('enrollment_id', _eid,
                                           'code', _issue_report_code(_eid, _r.id, (_r.expires_on + 1)::timestamptz));
    end loop;
    perform fv_idem_store(p_idempotency_key, 'issue_report_codes',
                          jsonb_build_object('replayed', true, 'count', jsonb_array_length(_out)));
    return _out;
end;
$function$;

CREATE OR REPLACE FUNCTION public._issue_access_code(p_enrollment_id uuid, p_questionnaire_id uuid, p_expires_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public._issue_report_code(p_enrollment_id uuid, p_report_id uuid, p_expires_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _code text;
    _salt text;
begin
    if not exists (select 1 from phone_report r join enrollment e on e.course_id = r.course_id
                    where r.id = p_report_id and e.id = p_enrollment_id
                      and fv_owns_course(r.course_id) and fv_owns_enrollment(e.id)) then
        raise exception 'report not found' using errcode = 'P0002';
    end if;
    loop
        _code := _new_access_code();
        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));
        _salt := encode(uuid_send(gen_random_uuid()), 'hex');
        begin
            insert into student_access_code (enrollment_id, phone_report_id, code_hash, salt, expires_at)
            values (p_enrollment_id, p_report_id, _access_code_hash(_code, _salt), _salt, p_expires_at);
            return _code;
        exception when unique_violation then
            -- A hash collision: draw again.
        end;
    end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public._new_access_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._slip_password(p_enrollment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        -- The new slip prints no password. The stored one goes only once no
        -- slip printed before this one can still be scanned.
        if _pw is not null and not exists (
            select 1 from student_access_code c join enrollment e on e.id = c.enrollment_id
             where e.student_id = _sid and e.withdrawn_at is null
               and c.questionnaire_id is not null
               and c.used_at is null and c.revoked_at is null
               and c.expires_at > now()
               and c.created_at < now()) then
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

revoke all on function student_submit.open(text,text) from public, anon, authenticated, service_role;
grant execute on function student_submit.open(text,text) to service_role;

revoke all on function student_submit.verify(text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function student_submit.verify(text,text,text,text,text) to service_role;

revoke all on function public.issue_access_codes(uuid,uuid[],uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_access_codes(uuid,uuid[],uuid) to service_role;
grant execute on function public.issue_access_codes(uuid,uuid[],uuid) to authenticated;

revoke all on function public.issue_report_codes(uuid,uuid[],uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_report_codes(uuid,uuid[],uuid) to service_role;
grant execute on function public.issue_report_codes(uuid,uuid[],uuid) to authenticated;

revoke all on function public._issue_access_code(uuid,uuid,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public._issue_access_code(uuid,uuid,timestamp with time zone) to service_role;
grant execute on function public._issue_access_code(uuid,uuid,timestamp with time zone) to authenticated;

revoke all on function public._issue_report_code(uuid,uuid,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public._issue_report_code(uuid,uuid,timestamp with time zone) to service_role;
grant execute on function public._issue_report_code(uuid,uuid,timestamp with time zone) to authenticated;

revoke all on function public._new_access_code() from public, anon, authenticated, service_role;
grant execute on function public._new_access_code() to service_role;
grant execute on function public._new_access_code() to authenticated;

revoke all on function public._slip_password(uuid) from public, anon, authenticated, service_role;
grant execute on function public._slip_password(uuid) to service_role;
grant execute on function public._slip_password(uuid) to authenticated;
-- UNDO-BODIES-END

grant execute on function public._access_code_hash(text, text) to authenticated;

do $notnull$
begin
    if not exists (select 1 from public.student_access_code where code_hash is null or salt is null) then
        alter table public.student_access_code alter column code_hash set not null;
        alter table public.student_access_code alter column salt set not null;
    end if;
end
$notnull$;
commit;
