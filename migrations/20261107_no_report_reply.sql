-- A report on a phone is for reading (2026-11-07).
--
-- What changed and why: 20261025_phone_reports.sql let a student reply to
-- their report once (Reply to Report). Colin's call: a report is a report.
-- Students aren't arguing with a grade or asking questions through it; they
-- can reflect in class. The reply goes.
--
-- Nothing is lost: on 2026-11-07 production had one phone report, its reply
-- questionnaire was already closed, and no student had replied (0 responses).
--
--   create_phone_report: no Reply to Report questionnaire.
--   update_phone_report, close_phone_report: nothing to move or close.
--   _phone_report_json: no replied_at per student.
--   student_submit.check: returns {ok, report}; no reply, no replied_at.
--   student_submit.submit: a report code has nothing to send ('closed').
--   The report-reply questionnaires (one, empty) and the report-reply
--   template are deleted, phone_report.reply_questionnaire_id is dropped,
--   and 'report_reply' leaves both kind checks.

-- ── Teacher functions ────────────────────────────────────────────────────
create or replace function public._phone_report_json(p_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select to_jsonb(r) || jsonb_build_object(
           'students', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'enrollment_id', s.enrollment_id,
                      'data', s.data,
                      'updated_at', s.updated_at,
                      'opened_at', (select min(c.opened_at) from student_access_code c
                                     where c.phone_report_id = r.id and c.enrollment_id = s.enrollment_id))
                    order by s.enrollment_id)
               from phone_report_student s where s.report_id = r.id), '[]'::jsonb))
    from phone_report r
   where r.id = p_id;
$function$;

create or replace function public.create_phone_report(p_course_id uuid, p_term integer, p_term_label text, p_expires_on date, p_students jsonb, p_idempotency_key uuid default null::uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _id     uuid;
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
    insert into phone_report (course_id, term, term_label, expires_on, created_by)
    values (p_course_id, p_term, _label, p_expires_on, (select auth.uid()))
    returning id into _id;
    perform _phone_report_put(_id, p_course_id, p_students);
    _cached := _phone_report_json(_id);
    perform fv_idem_store(p_idempotency_key, 'create_phone_report', _cached);
    return _cached;
end;
$function$;

create or replace function public.update_phone_report(p_id uuid, p_students jsonb default '[]'::jsonb, p_expires_on date default null::date, p_idempotency_key uuid default null::uuid)
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
        update student_access_code set expires_at = (p_expires_on + 1)::timestamptz
         where phone_report_id = _r.id and revoked_at is null;
    end if;
    update phone_report set updated_at = now() where id = _r.id;
    _cached := _phone_report_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'update_phone_report', _cached);
    return _cached;
end;
$function$;

create or replace function public.close_phone_report(p_id uuid, p_idempotency_key uuid default null::uuid)
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
    _cached := _phone_report_json(_r.id);
    perform fv_idem_store(p_idempotency_key, 'close_phone_report', _cached);
    return _cached;
end;
$function$;

-- ── Student functions (the edge function calls these) ───────────────────
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
    perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
    return jsonb_build_object('ok', true, 'report', coalesce(_data, '{}'::jsonb));
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
    -- A report code opens a report to read; there's nothing on it to send.
    if _c.phone_report_id is not null then
        perform _log('submit', 'closed', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'closed');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    -- The slip alone isn't enough: verify() has to have matched.
    if _s.checked_at is null then
        perform _log('submit', 'not_checked', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'expired');
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

    update student_access_code set used_at = _now where id = _c.id;
    _result := jsonb_build_object('ok', true, 'submitted_at', _now);
    update session set submitted_at = _now, result = _result where id = _s.id;
    perform _log('submit', 'ok', p_ip_hash, _c.id, _q.course_id);
    return _result;
end;
$function$;

-- ── The reply's data ─────────────────────────────────────────────────────
-- One questionnaire on 2026-11-07: closed, five questions, no responses,
-- no codes. Its questions go with it (on delete cascade).
delete from public.questionnaire where kind = 'report_reply';
delete from public.questionnaire_template where id = 'report-reply';

alter table public.phone_report drop column reply_questionnaire_id;

alter table public.questionnaire drop constraint questionnaire_kind_check;
alter table public.questionnaire add constraint questionnaire_kind_check
  check (kind = any (array['about_me', 'core_reflection', 'goal_checkin', 'curricular_self_assessment']));
alter table public.questionnaire_template drop constraint questionnaire_template_kind_check;
alter table public.questionnaire_template add constraint questionnaire_template_kind_check
  check (kind = any (array['about_me', 'core_reflection', 'goal_checkin', 'curricular_self_assessment']));
