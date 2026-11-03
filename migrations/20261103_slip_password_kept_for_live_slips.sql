-- Questionnaire slips: printing one slip no longer wipes the password on
-- another that is still live (2026-11-03).
--
-- What was wrong (Nov 3 bug sweep, Database changes group 2 / s/ group 2):
-- 20261101_questionnaire_slip_fixes.sql made _slip_password clear
-- student.slip_password whenever the student now has a birthday or student
-- number, "since that slip prints none". The password sits on the student,
-- so it is shared by every slip the student has, but issue_access_codes
-- revokes only the old slips of the questionnaire it prints. A student whose
-- Term 1 slip printed a password, and whose number a roster import added
-- later, lost that password as soon as slips were printed for another
-- questionnaire or another of the teacher's classes. Scanning the Term 1 slip
-- then asked only for a birthday or number, the printed password went in as
-- a student number, and each try counted toward the five-try lock. That broke
-- DECISIONS.md Student voice 2: a password printed before a roster import
-- added a birthday or number still works.
--
-- Now the password is cleared only when no other questionnaire slip for the
-- student is still live (not used, not revoked, not expired, in a class the
-- student is still in). The slip this print just made is left out: it was
-- made in this transaction, so its created_at is now(). While an older slip
-- is live the new slip's phone also offers the password box, which takes the
-- student's number as well.

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
revoke all on function public._slip_password(uuid) from public, anon;
grant execute on function public._slip_password(uuid) to authenticated;
