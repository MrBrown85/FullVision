-- Reports on students' phones (2026-10-25). docs/STUDENT-VOICE-PLAN.md,
-- PR 9; canvas screens R1–R4, T1, T2.
--
-- A teacher sends a reporting period's report to the class's phones. The
-- teacher's browser builds each student's phone copy (overall, skills,
-- the comment, their goal, their self-assessment, attendance) with the
-- same grade helpers the app shows, and the server keeps it fixed, so the
-- phone shows what was sent until the teacher updates it. Each student
-- gets a slip; the code opens a birthday check, and the birthday opens the
-- report. The student can reply once.
--
-- The plan put these codes on report_issue. That table holds the printed
-- sheets' HTML and needs a paper issue first; the phone copy is its own
-- small record instead.
--
-- What it adds:
--   phone_report(id, course_id, term, term_label, reply_questionnaire_id,
--     issued_at, updated_at, expires_on, closed_at, created_by)
--   phone_report_student(report_id, enrollment_id, data jsonb, updated_at)
--   student_access_code.phone_report_id: a report code. Report codes are
--     reusable until the report's last day; the code check now allows a
--     questionnaire, an issued report or a phone report.
--   student_submit.session.checked_at / check_fails: the birthday check.
--
--   create_phone_report(p_course_id, p_term, p_term_label, p_expires_on,
--     p_students [{enrollment_id, data}], key) -> the report, with its
--     Reply to Report questionnaire made from the report-reply template.
--   update_phone_report(p_id, p_students, p_expires_on, key): replaces the
--     listed students' copies ("Update Issued Copy"), and the last day.
--   close_phone_report(p_id, key): every link stops; the reply closes.
--   issue_report_codes(p_report_id, p_enrollment_ids, key) ->
--     [{enrollment_id, code}]; a student's earlier code for it is revoked.
--   list_phone_reports(p_course_id) -> newest first, each with its
--     students' opened_at and replied_at.
--
--   student_submit.open: a report code returns {kind: 'report', token,
--     student, course, report {title, expires_on}, has_birthday} and no
--     report.
--   student_submit.check(p_token, p_birthday, p_ip_hash): the birthday on
--     file opens the report {report: data, reply: {questions} | null,
--     replied_at}. Five wrong birthdays in a session, or ten on one code in
--     15 minutes, lock it.
--   student_submit.submit: a reply needs the birthday check, is saved once
--     per student, and leaves the code working for reading.
--
--   Also: the per-address lockout on open rises from 10 to 60 misses in 15
--     minutes and counts only codes not found. A school's students share
--     one address; ten typos in a class shouldn't lock everyone out. The
--     500-misses-everywhere pause still stops a guessing run.
--
-- RLS through the course; teacher functions are SECURITY INVOKER and
-- idempotent. anon gets nothing.

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists public.phone_report (
  id                     uuid        primary key default gen_random_uuid(),
  course_id              uuid        not null references public.course(id) on delete cascade,
  term                   integer     not null check (term between 1 and 6),
  term_label             text        check (term_label is null or char_length(term_label) <= 80),
  reply_questionnaire_id uuid        references public.questionnaire(id) on delete set null,
  issued_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  expires_on             date        not null,
  closed_at              timestamptz,
  created_by             uuid        references public.teacher(id) on delete set null
);
create index if not exists phone_report_course on public.phone_report (course_id, issued_at desc);

create table if not exists public.phone_report_student (
  report_id     uuid        not null references public.phone_report(id) on delete cascade,
  enrollment_id uuid        not null references public.enrollment(id) on delete cascade,
  data          jsonb       not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 60000),
  updated_at    timestamptz not null default now(),
  primary key (report_id, enrollment_id)
);

alter table public.student_access_code
  add column if not exists phone_report_id uuid references public.phone_report(id) on delete cascade;
alter table public.student_access_code drop constraint if exists student_access_code_check;
alter table public.student_access_code drop constraint if exists student_access_code_target;
alter table public.student_access_code add constraint student_access_code_target
  check (num_nonnulls(questionnaire_id, report_issue_id, phone_report_id) >= 1);

alter table student_submit.session add column if not exists checked_at timestamptz;
alter table student_submit.session add column if not exists check_fails integer not null default 0;

alter table public.phone_report enable row level security;
alter table public.phone_report_student enable row level security;
drop policy if exists phone_report_via_course on public.phone_report;
create policy phone_report_via_course on public.phone_report
  for all using (fv_owns_course(course_id)) with check (fv_owns_course(course_id));
drop policy if exists phone_report_student_via_report on public.phone_report_student;
create policy phone_report_student_via_report on public.phone_report_student
  for all
  using (exists (select 1 from phone_report r where r.id = report_id and fv_owns_course(r.course_id)))
  with check (exists (select 1 from phone_report r where r.id = report_id and fv_owns_course(r.course_id)));
grant select, insert, update, delete on public.phone_report, public.phone_report_student to authenticated;
revoke all on public.phone_report, public.phone_report_student from anon;

-- ── Teacher functions ───────────────────────────────────────────────────

-- A phone report as the teacher reads it: its fields, and per student the
-- copy that was sent, when they opened it (the birthday check passed) and
-- when they replied.
create or replace function public._phone_report_json(p_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $$
  select to_jsonb(r) || jsonb_build_object(
           'students', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'enrollment_id', s.enrollment_id,
                      'data', s.data,
                      'updated_at', s.updated_at,
                      'opened_at', (select min(c.opened_at) from student_access_code c
                                     where c.phone_report_id = r.id and c.enrollment_id = s.enrollment_id),
                      'replied_at', (select min(x.submitted_at) from response x
                                      where x.questionnaire_id = r.reply_questionnaire_id
                                        and x.enrollment_id = s.enrollment_id))
                    order by s.enrollment_id)
               from phone_report_student s where s.report_id = r.id), '[]'::jsonb))
    from phone_report r
   where r.id = p_id;
$$;

-- Saves the listed students' copies: [{enrollment_id, data}], each a
-- student of the report's class.
create or replace function public._phone_report_put(p_report_id uuid, p_course_id uuid, p_students jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $$
declare
    _item jsonb;
    _eid  uuid;
begin
    if jsonb_typeof(p_students) is distinct from 'array' then
        raise exception 'students must be an array' using errcode = '22023';
    end if;
    for _item in select * from jsonb_array_elements(p_students) loop
        _eid := (_item->>'enrollment_id')::uuid;
        if not exists (select 1 from enrollment e where e.id = _eid and e.course_id = p_course_id
                         and fv_owns_enrollment(e.id)) then
            raise exception 'enrollment not in this class' using errcode = 'P0002';
        end if;
        insert into phone_report_student (report_id, enrollment_id, data, updated_at)
        values (p_report_id, _eid, _item->'data', now())
        on conflict (report_id, enrollment_id) do update set data = excluded.data, updated_at = now();
    end loop;
end;
$$;

create or replace function public.create_phone_report(
    p_course_id uuid, p_term integer, p_term_label text, p_expires_on date, p_students jsonb,
    p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _id     uuid;
    _reply  jsonb;
    _label  text := nullif(btrim(coalesce(p_term_label, '')), '');
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'create_phone_report');
    if _cached is not null then
        return _cached;
    end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    if p_expires_on is null or p_expires_on < current_date then
        raise exception 'the last day must be today or later' using errcode = '22023';
    end if;
    -- The reply: the report-reply template's questions, open until the last day.
    _reply := upsert_questionnaire(p_course_id, 'report_reply',
                                   'Reply to ' || coalesce(_label, 'Report ' || p_term), 'report-reply',
                                   p_report_period => p_term, p_closes_on => p_expires_on);
    insert into phone_report (course_id, term, term_label, reply_questionnaire_id, expires_on, created_by)
    values (p_course_id, p_term, _label, (_reply->>'id')::uuid, p_expires_on, (select auth.uid()))
    returning id into _id;
    perform _phone_report_put(_id, p_course_id, p_students);
    _cached := _phone_report_json(_id);
    perform fv_idem_store(p_idempotency_key, 'create_phone_report', _cached);
    return _cached;
end;
$function$;

create or replace function public.update_phone_report(
    p_id uuid, p_students jsonb default '[]'::jsonb, p_expires_on date default null,
    p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _r      phone_report%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'update_phone_report');
    if _cached is not null then
        return _cached;
    end if;
    select * into _r from phone_report where id = p_id and fv_owns_course(course_id) for update;
    if not found then
        raise exception 'report not found' using errcode = 'P0002';
    end if;
    perform _phone_report_put(_r.id, _r.course_id, coalesce(p_students, '[]'::jsonb));
    if p_expires_on is not null then
        if p_expires_on < current_date then
            raise exception 'the last day must be today or later' using errcode = '22023';
        end if;
        update phone_report set expires_on = p_expires_on where id = _r.id;
        update questionnaire set closes_on = p_expires_on, updated_at = now() where id = _r.reply_questionnaire_id;
        update student_access_code set expires_at = (p_expires_on + 1)::timestamptz
         where phone_report_id = _r.id and revoked_at is null;
    end if;
    update phone_report set updated_at = now() where id = _r.id;
    _cached := _phone_report_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'update_phone_report', _cached);
    return _cached;
end;
$function$;

create or replace function public.close_phone_report(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _r      phone_report%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'close_phone_report');
    if _cached is not null then
        return _cached;
    end if;
    select * into _r from phone_report where id = p_id and fv_owns_course(course_id) for update;
    if not found then
        raise exception 'report not found' using errcode = 'P0002';
    end if;
    update phone_report set closed_at = coalesce(closed_at, now()), updated_at = now() where id = _r.id;
    update student_access_code set revoked_at = now() where phone_report_id = _r.id and revoked_at is null;
    update questionnaire set is_on = false, updated_at = now() where id = _r.reply_questionnaire_id;
    _cached := _phone_report_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'close_phone_report', _cached);
    return _cached;
end;
$function$;

-- Draws a report code no live code reads as (as _issue_access_code does for
-- questionnaires) and returns it.
create or replace function public._issue_report_code(
    p_enrollment_id uuid, p_report_id uuid, p_expires_at timestamptz
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
revoke all on function public._issue_report_code(uuid, uuid, timestamptz) from public, anon;
grant execute on function public._issue_report_code(uuid, uuid, timestamptz) to authenticated;

-- Slip codes for a phone report's students (every student with a copy when
-- p_enrollment_ids is null). Plain codes come back once; a replayed key
-- returns {replayed: true, count}.
create or replace function public.issue_report_codes(
    p_report_id uuid, p_enrollment_ids uuid[] default null, p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
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

create or replace function public.list_phone_reports(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $$
  select coalesce(jsonb_agg(_phone_report_json(r.id) order by r.issued_at desc), '[]'::jsonb)
    from phone_report r
   where r.course_id = p_course_id and fv_owns_course(r.course_id);
$$;

revoke all on function public._phone_report_json(uuid), public._phone_report_put(uuid, uuid, jsonb),
  public.create_phone_report(uuid, integer, text, date, jsonb, uuid),
  public.update_phone_report(uuid, jsonb, date, uuid), public.close_phone_report(uuid, uuid),
  public.issue_report_codes(uuid, uuid[], uuid), public.list_phone_reports(uuid) from public, anon;
grant execute on function public.create_phone_report(uuid, integer, text, date, jsonb, uuid),
  public.update_phone_report(uuid, jsonb, date, uuid), public.close_phone_report(uuid, uuid),
  public.issue_report_codes(uuid, uuid[], uuid), public.list_phone_reports(uuid),
  public._phone_report_json(uuid), public._phone_report_put(uuid, uuid, jsonb) to authenticated;

-- ── Student path ────────────────────────────────────────────────────────

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
    _r      phone_report%rowtype;
    _dob    date;
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
        'ok', true, 'kind', 'questionnaire', 'token', _token, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'parts', _parts,
        'context', coalesce(_ctx, '{}'::jsonb));
end;
$function$;

-- The birthday on file opens a phone report.
create or replace function student_submit.check(p_token text, p_birthday text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s      session%rowtype;
    _c      student_access_code%rowtype;
    _r      phone_report%rowtype;
    _course course%rowtype;
    _dob    date;
    _given  date;
    _data   jsonb;
    _reply  jsonb;
    _when   timestamptz;
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
    select * into _c from student_access_code where id = _s.code_id;
    if _c.phone_report_id is null or _c.revoked_at is not null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _r from phone_report where id = _c.phone_report_id;
    select * into _course from course where id = _r.course_id;
    if _r.closed_at is not null
       or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
        perform _log('open', 'closed', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'report_closed');
    end if;
    if _s.check_fails >= 5
       or (select count(*) from attempt
            where code_id = _c.id and outcome = 'wrong_birthday' and at > now() - interval '15 minutes') >= 10 then
        perform _log('open', 'locked', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    select s.date_of_birth into _dob
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    if _dob is null then
        perform _log('open', 'no_birthday', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'no_birthday');
    end if;
    begin
        _given := p_birthday::date;
    exception when others then
        _given := null;
    end;
    if _given is distinct from _dob then
        update session set check_fails = check_fails + 1 where id = _s.id;
        perform _log('open', 'wrong_birthday', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object('ok', false, 'error', 'wrong_birthday', 'tries_left', greatest(0, 4 - _s.check_fails));
    end if;

    update session set checked_at = coalesce(checked_at, now()) where id = _s.id;
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;
    select data into _data from phone_report_student
     where report_id = _r.id and enrollment_id = _c.enrollment_id;
    select min(submitted_at) into _when from response
     where questionnaire_id = _r.reply_questionnaire_id and enrollment_id = _c.enrollment_id;
    if _when is null and _r.reply_questionnaire_id is not null
       and exists (select 1 from questionnaire q where q.id = _r.reply_questionnaire_id and q.is_on) then
        _reply := _part(_r.reply_questionnaire_id);
    end if;
    perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
    return jsonb_build_object('ok', true, 'report', coalesce(_data, '{}'::jsonb), 'reply', _reply, 'replied_at', _when);
end;
$function$;

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

revoke all on function student_submit.check(text, text, text) from public, anon, authenticated;
grant execute on function student_submit.check(text, text, text) to service_role;
