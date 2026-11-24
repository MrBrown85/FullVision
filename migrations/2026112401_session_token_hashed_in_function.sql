-- A student's session token never reaches the database (2026-11-24).
--
-- A card's session token went to the database in the clear on every page
-- read, and the database hashed it there (ROADMAP 1.8): someone watching the
-- database live could catch one and open that student's page until
-- midnight. The database also made each new token, so it held every token
-- once, at sign-in.
--
-- Now the student-submit function hashes the device's token (SHA-256, hex)
-- before any statement and sends only the hash; the database compares
-- hashes. A new session's token is made in the function, and the database
-- is given only its hash. device_session.token_hash already holds SHA-256
-- of the token, so every live session keeps working: a hash sent by the new
-- function matches the row the old one made.
--
-- 1. _device_session(p_token): p_token is the token's hash, compared as is.
-- 2. done(p_session_token, p_ip_hash): the same.
-- 3. verify_card gains p_new_session_hash, the hash of the token the
--    function made, used when a new session starts; it answers new_session
--    (true or false) in place of session_token. The eight-argument version
--    is dropped.
--
-- The function and this migration go out back to back: between the two, a
-- page read finds no session (the student signs in again) and a card's
-- sign-in fails. Apply out of school hours, then deploy student-submit at
-- once. No data changes. Undo: restore the three old definitions from
-- migrations/baseline/30-functions.sql (drop the nine-argument
-- verify_card first) and redeploy the function from before this change.
--
-- Slips' tokens (open, verify, check, submit) are not changed here.

begin;

-- 1. A live session by its token's hash.
create or replace function student_submit._device_session(p_token text)
 returns student_submit.device_session
 language sql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select d.* from device_session d
     where coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
       and d.token_hash = p_token
       and d.expires_at > now();
$function$;

-- 2. Done: end the session the hash names.
create or replace function student_submit.done(p_session_token text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
begin
    if coalesce(p_session_token, '') ~ '^[0-9a-f]{64}$' then
        delete from device_session where token_hash = p_session_token;
    end if;
    return jsonb_build_object('ok', true);
end;
$function$;

-- 3. A card's identity check, with the new session's hash from the function.
drop function student_submit.verify_card(text, text, text, text, text, text, text, boolean);

create or replace function student_submit.verify_card(
    p_code_hmac text, p_key_id text, p_birthday text, p_student_number text, p_password_hmac text,
    p_session_token text, p_ip_hash text, p_add boolean, p_new_session_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _found   jsonb;
    _card    uuid;
    _k       student_card%rowtype;
    _course  course%rowtype;
    _dob     date;
    _num     text;
    _given   date;
    _session device_session%rowtype;
    _new     boolean := false;
    _ends    timestamptz;
    _row     int;
    _week    int;
begin
    -- The password arrives as its tag (made from the card's code and the
    -- four digits typed), or null when none was typed. Never the digits.
    if p_password_hmac is not null and p_password_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed password tag' using errcode = '22023';
    end if;
    -- The hash of a token the function made, always sent: the database never
    -- sees the token itself.
    if coalesce(p_new_session_hash, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed session hash' using errcode = '22023';
    end if;
    _found := _card_lookup(p_code_hmac, p_key_id, p_ip_hash);
    _card := (_found->>'card_id')::uuid;
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select * into _k from student_card where id = _card for update;
    if _k.locked_at is not null or _k.stopped_at is not null then
        -- Locked or replaced while this call waited for the row.
        return jsonb_build_object('ok', false, 'error', case when _k.stopped_at is not null then 'card_stopped' else 'card_locked' end);
    end if;
    select c.* into _course from enrollment e join course c on c.id = e.course_id where e.id = _k.enrollment_id;

    -- The card's own password: one printed on this card still works after a
    -- birthday or number is added, whatever is printed for the student later.
    select s.date_of_birth, nullif(_norm(s.student_number), '')
      into _dob, _num
      from enrollment e join student s on s.id = e.student_id
     where e.id = _k.enrollment_id;
    if _dob is null and _num is null and _k.pw_hmac is null then
        -- Nothing on file to check against: no try is counted. card() says the same.
        perform _log('card', 'no_identity', p_ip_hash, _k.id, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;

    if not coalesce((_dob is not null and _given is not null and _given = _dob)
                 or (_num is not null and _norm(p_student_number) = _num)
                 or (_k.pw_hmac is not null and p_password_hmac is not null and p_password_hmac = _k.pw_hmac), false) then
        -- Five wrong tries in a row lock it (a right answer starts that
        -- count again), and so do fifteen inside 7 days whatever came
        -- between. "Tries left" is the nearer of the two, so it is always true.
        update student_card
           set wrong_tries = wrong_tries + 1,
               wrong_times = array(select t from unnest(wrong_times) t where t > clock_timestamp() - interval '7 days')
                             || clock_timestamp()
         where id = _k.id
        returning wrong_tries, cardinality(wrong_times) into _row, _week;
        perform _log('card', 'wrong_identity', p_ip_hash, _k.id, _course.id);
        if _row >= 5 or _week >= 15 then
            update student_card set locked_at = now() where id = _k.id;
            return jsonb_build_object('ok', false, 'error', 'card_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', least(5 - _row, 15 - _week));
    end if;

    -- Matched. From the start screen that is a fresh session: whoever was
    -- signed in on this device is signed out. Only Add Another Card (p_add)
    -- joins the session the device has.
    _ends := _midnight(_course.timezone);
    select * into _session from _device_session(p_session_token);
    if _session.id is not null and not coalesce(p_add, false) then
        delete from device_session where id = _session.id;
        _session := null;
    end if;
    if _session.id is null then
        insert into device_session (token_hash, expires_at)
        values (p_new_session_hash, _ends)
        returning * into _session;
        _new := true;
    elsif _ends < _session.expires_at then
        update device_session set expires_at = _ends where id = _session.id returning * into _session;
    end if;
    insert into device_session_enrollment (session_id, enrollment_id, card_id)
    values (_session.id, _k.enrollment_id, _k.id)
    on conflict (session_id, enrollment_id) do update set card_id = excluded.card_id;
    update student_card set last_opened_at = now(), wrong_tries = 0 where id = _k.id;

    perform _log('card', 'verified', p_ip_hash, _k.id, _course.id);
    return jsonb_build_object(
        'ok', true, 'new_session', _new, 'expires_at', _session.expires_at,
        'enrollment_id', _k.enrollment_id, 'classes', _session_classes(_session.id));
end;
$function$;

-- As the eight-argument version had it: the owner and the service role only.
revoke all on function student_submit.verify_card(text, text, text, text, text, text, text, boolean, text)
    from public, anon, authenticated;
grant execute on function student_submit.verify_card(text, text, text, text, text, text, text, boolean, text)
    to service_role;
-- And to student-submit's own login, when 2026112402 has made it: DROP took its grant with it.
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
        grant execute on function student_submit.verify_card(text, text, text, text, text, text, text, boolean, text)
            to fv_student_submit;
    end if;
end $$;

commit;
