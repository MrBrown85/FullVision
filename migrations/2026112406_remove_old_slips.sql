-- The last of the slips from before the card key goes (2026-11-24).
--
-- 2026111160 moved slips to keyed tags but kept two ways in for slips
-- printed before it, until 2027-07-01 (student_submit._slip_old_until):
--   - open took the plain code once, matched it against the old salted hash
--     (code_hash, salt) and converted the slip to a tag (converted_at);
--   - verify took the typed password once and matched it against the plain
--     password stored with the student (student.slip_password), and a
--     trigger cleared that password once no live slip needed it.
-- On 2026-11-24 no slip of the old kind is live (0 of 126; the newest slip
-- of any kind was made on 2026-11-14), 3 students still had a plain slip
-- password stored, and 104 dead slips still carried an old salted hash.
-- Colin approved ending the old slips early, on 2026-11-24.
--
-- THIS DELETES DATA: the 3 stored slip passwords (the student.slip_password
-- column) and the old hashes and salts on the 104 dead slips (the columns
-- code_hash, salt and converted_at). No live slip, card, answer or grade
-- is touched.
--
-- 1. open loses p_code and the old-slip path: a code is found by its tag or
--    not at all. It never answers `fallback` again.
-- 2. verify loses p_password and p_code_hmac: a password is checked only
--    by its tag (p_pw_hmac), bound to the slip's code by the function.
-- 3. The trigger and the helpers for the old slips are dropped:
--    _slip_password_on_change, _slip_password_settle, _slip_old_until and
--    _access_code_hash.
-- 4. student.slip_password, and student_access_code's code_hash, salt and
--    converted_at, are dropped; student_access_code_keyed is rebuilt
--    without them.
--
-- The student-submit function from the same pull request calls the new
-- open and verify: apply this and deploy it back to back (between the two,
-- a slip cannot open). Undo: the old definitions are in
-- migrations/baseline/30-functions.sql as of commit 5bbc2ba4; the dropped
-- data cannot come back.

begin;

-- 1. open: by its tag, or not found.
drop function student_submit.open(text, text, text, text, text);

create function student_submit.open(p_code_hmac text, p_key_id text, p_ip_hash text, p_new_token_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _course course%rowtype;
    _name   text;
    _why    text;
    _exp    timestamptz := now() + interval '80 minutes';
    _r      phone_report%rowtype;
    _dob    date;
    _by     text;
    _pw     boolean;
begin
    -- A tag is 64 lower-case hex characters, and a key id 8. Anything else is
    -- a bug in the caller, not a student's guess: fail, and log nothing.
    if p_code_hmac is not null and p_code_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed code tag' using errcode = '22023';
    end if;
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    -- The hash of a token the function made: the database never sees the token.
    if coalesce(p_new_token_hash, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed token hash' using errcode = '22023';
    end if;

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

    -- Not six characters of the slip alphabet: the edge sends no tag.
    if p_code_hmac is null then
        perform _log('open', 'bad_format', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- By its tag: live (or used) slips only, through the unique index on tags.
    select * into _c from student_access_code
     where code_hmac = p_code_hmac and revoked_at is null and expires_at > now()
       for update;
    if _c.id is null then
        perform _log('open', 'not_found', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

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
        -- The token is the function's; the database keeps only its hash.
        insert into session (token_hash, code_id, expires_at)
        values (p_new_token_hash, _c.id, _exp);
        select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name), s.date_of_birth into _name, _dob
          from enrollment e join student s on s.id = e.student_id
         where e.id = _c.enrollment_id;
        perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object(
            'ok', true, 'kind', 'report', 'new_token', true, 'expires_at', _exp,
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
    -- when the teacher entered one, else the password printed on the slip
    -- (its tag). A slip with neither has nothing to check against: they need
    -- a new slip.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when _c.pw_hmac is not null then 'password' end,
           _c.pw_hmac is not null
      into _name, _by, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    if _by is null then
        perform _log('open', 'no_identity', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;

    -- The token is the function's; the database keeps only its hash.
    insert into session (token_hash, code_id, expires_at)
    values (p_new_token_hash, _c.id, _exp);

    -- The questions wait for verify(); the slip alone shows only the first
    -- name and what the questions are called.
    perform _log('open', 'ok', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object(
        'ok', true, 'kind', 'questionnaire', 'new_token', true, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        -- A password printed before the teacher added a birthday or number
        -- still works, so the phone offers it beside them.
        'also_password', _by = 'identity' and _pw,
        'preview', student_submit._preview(_c.id));
end;
$function$;

-- 2. verify: a birthday, a student number, or the slip's password by its tag.
drop function student_submit.verify(text, text, text, text, text, text, text);

create function student_submit.verify(p_token text, p_birthday text, p_student_number text, p_pw_hmac text, p_ip_hash text)
 returns jsonb
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
    _given  date;
    _match  boolean := false;
    _misses int;
begin
    if p_pw_hmac is not null and p_pw_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed tag' using errcode = '22023';
    end if;
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = p_token
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

    select s.date_of_birth, nullif(_norm(s.student_number), '')
      into _dob, _num
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;

    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;
    _match := (_dob is not null and _given is not null and _given = _dob)
           or (_num is not null and _norm(p_student_number) = _num)
           or (_c.pw_hmac is not null and p_pw_hmac is not null and p_pw_hmac = _c.pw_hmac);

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

-- The owner, the service role and student-submit's own login, as before.
revoke all on function student_submit.open(text, text, text, text) from public, anon, authenticated;
revoke all on function student_submit.verify(text, text, text, text, text) from public, anon, authenticated;
grant execute on function student_submit.open(text, text, text, text) to service_role;
grant execute on function student_submit.verify(text, text, text, text, text) to service_role;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
        grant execute on function student_submit.open(text, text, text, text) to fv_student_submit;
        grant execute on function student_submit.verify(text, text, text, text, text) to fv_student_submit;
    end if;
end $$;

-- 3. The old slips' trigger and helpers.
drop trigger student_access_code_slip_password on public.student_access_code;
drop function public._slip_password_on_change();
drop function public._slip_password_settle(uuid);
drop function student_submit._slip_old_until();
drop function public._access_code_hash(text, text);

-- 4. Their data.
alter table public.student drop column slip_password;
alter table public.student_access_code drop constraint student_access_code_keyed;
alter table public.student_access_code drop column code_hash, drop column salt, drop column converted_at;
alter table public.student_access_code add constraint student_access_code_keyed check (
    (code_hmac is null or code_hmac ~ '^[0-9a-f]{64}$')
    and (pw_hmac is null or pw_hmac ~ '^[0-9a-f]{64}$')
    and (key_id is null or key_id ~ '^[0-9a-f]{8}$')
    and (code_hmac is null or key_id is not null)
    and (pw_hmac is null or code_hmac is not null));

-- Nothing left names what was dropped.
do $$
begin
    if exists (select 1 from pg_proc
                where pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
                  and prosrc ~ 'slip_password|code_hash|converted_at|_slip_old_until|_access_code_hash|_slip_password_settle') then
        raise exception 'a function still names an old-slip column or helper';
    end if;
end $$;

commit;
