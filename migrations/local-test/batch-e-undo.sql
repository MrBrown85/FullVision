-- BATCH E, UNDONE. Not a migration: the way back from
-- migrations/2026111150_student_page_last_changes.sql. Kept under
-- local-test/ so CI's drift check does not wait for it to be applied.
-- Proved by migrations/local-test/batch_e.py (scenario undo).
--
-- It puts each of the eleven functions the file replaced back word for word
-- (the bodies below are written by batch_e.py from the database the file
-- was tested on, never by hand), drops the seven it added, the table
-- student_submit.write_log (the per-card counts) and grade_return's two
-- columns (the kept notes: reports then print the current note again, as
-- before the file). It writes no grade, score or answer: questionnaire
-- answers sent from a card stay, as a slip's do.
-- It refuses, with nothing changed, unless every function is as the file
-- leaves it, or already back as before (a second run changes nothing).
begin;
set local lock_timeout = '5s';
do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/batch_e.py)
            ('student_submit.work(text,uuid,text)',                  '2ec445c5d5afadb7c3fc1699d9929e52', '9e237f6e19649807b64aa6dc870de3f3'),
            ('student_submit.send_paths(text,uuid,uuid,text)',       '2f36c08b8ace950b9c7eb905b320aa40', '25ced0f7757967dc79ab1a9ce465009d'),
            ('student_submit.markup(text,uuid,uuid,text)',           '6cc78118aa4e98252514826aabf957a9', '754e27d5088fd0053bac3edba94c445d'),
            ('student_submit.feedback(text,uuid,text)',              '4ee8ebfb4b2af25698d2fb3eafc7f9ea', '1b90f53ea0d838acae50da7639e8c935'),
            ('student_submit.group_file_links(text,uuid,uuid,text)', '1c034fa5647b5808209b0ef9b31e8e4d', '5f15b29dd67898c3339e57e694b42edd'),
            ('student_submit.file_links(text,uuid,uuid,text)',       '99ef3b9e89574fae0a230c4464998baf', '1bd03e7e959fc7ff127bc9602badc283'),
            ('student_submit.reflect(text,uuid,uuid,jsonb,text)',    '7a4e2ab29d369ef159dce65e1e1e8f77', '9e62c67308321d3dd4095db16e2ad8e1'),
            ('student_submit.reply(text,uuid,uuid,jsonb,text)',      '264a736a722cf19022c20c343ecb01fb', 'c62efad49630d212de8357e64a23088f'),
            ('student_submit.answer_seen(text,uuid,uuid[],text)',    'da85d013a0511618c989d7bb44eac2f3', '360aa4c1fe8e0e0d860284cb3809c943'),
            ('public.save_score_report_note(uuid,uuid,text,uuid)',   '7b230f6d11458a7660e23c80f8829b95', '0278137275a8a15e973648c855643447'),
            ('public.list_course_grade_returns(uuid)',               'bc5529a69303cdfe8d91604388dc927a', '0779f1e345fb278fd8702592163784c1')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is neither as the file leaves it nor as before it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/batch_e.py)
            ('student_submit._write_limit(uuid,text,integer)',   'c2edfa96402a2eb7a839db3c106e11a9'),
            ('fv_private.report_note_hold(uuid,uuid)',           'f3ded8cae1f22c24b15fa2f7ba55427f'),
            ('student_submit._card_listed(uuid,uuid)',           'a0dc2d9e540be764da89a98e83751260'),
            ('student_submit.forms(text,uuid,text)',             '40ae918432795a5effbdd4cf6efead15'),
            ('student_submit.form(text,uuid,uuid,text)',         '8a2fcc6954bd63425d9460dea9800f26'),
            ('student_submit.answer(text,uuid,uuid,jsonb,text)', 'd625cba1843c7b409a5cb8743c7471fd'),
            ('student_submit.report(text,uuid,uuid,text)',       'd009be8b73801173f816d9a5db036b42')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% is not as the file leaves it (found %): something else changed it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

-- UNDO-BODIES-BEGIN (written by migrations/local-test/batch_e.py)
CREATE OR REPLACE FUNCTION student_submit.work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'send_work', _course.send_work,
        'assessments', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', a.id,
                       'students_send', a.students_send,
                       -- can work be sent for it right now
                       'open', _course.send_work and a.students_send <> 'nothing' and (w.j->>'open')::boolean,
                       'closes_on', w.j->'closes_on',
                       'late_now', w.j->'late',
                       'sent', case when s.id is null then null else jsonb_build_object(
                                   'submission_id', s.id, 'sent_at', s.sent_at, 'sent_by', s.sent_by,
                                   'on_paper', s.on_paper, 'is_late', s.is_late, 'note', s.note,
                                   'pages', (select count(*) from submission_file f where f.submission_id = s.id),
                                   'grading', g.started,
                                   -- Unsend and Replace: the student's own send, not yet being graded, still open
                                   'can_change', s.sent_by = 'student' and not g.started and _course.send_work
                                                 and a.students_send <> 'nothing' and (w.j->>'open')::boolean,
                                   -- Ruling 107: the teacher's pages, not on paper, not yet being graded, no
                                   -- revision open, still open: a send (send_start) joins them
                                   'can_send', s.sent_by = 'teacher' and not s.on_paper and not g.started and _course.send_work
                                               and a.students_send <> 'nothing' and (w.j->>'open')::boolean
                                               and not exists (select 1 from revision_request r
                                                                where r.assessment_id = a.id and r.enrollment_id = p_enrollment_id
                                                                  and r.state = 'open')) end,
                       -- a send of this student's that is not finished and still holds its place
                       'sending', case when u.id is null then null else jsonb_build_object(
                                      'submission_id', u.id, 'intent', u.intent, 'started_at', u.created_at,
                                      'finish_by', u.created_at + public._work_hold(),
                                      'pages', (select count(*) from submission_file f where f.submission_id = u.id)) end)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
             cross join lateral (select _work_window(a.id) as j) w
              left join lateral (select x.* from submission x
                                  where x.assessment_id = a.id and x.enrollment_id = p_enrollment_id and x.state = 'sent'
                                  order by x.version desc limit 1) s on true
              left join lateral (select x.* from submission x
                                  where x.assessment_id = a.id and x.enrollment_id = p_enrollment_id
                                    and x.state = 'sending' and x.sent_by = 'student'
                                    and x.created_at >= now() - public._work_hold() limit 1) u on true
             cross join lateral (select s.id is not null and _grading_started(p_enrollment_id, a.id) as started) g
             where a.course_id = _course.id
               and (w.j->>'listed')::boolean
               and (a.students_send <> 'nothing' or s.id is not null)), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.send_paths(p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in  jsonb;
    _sub submission%rowtype;
begin
    if p_submission_id is null then
        raise exception 'a submission is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- This student's own send, not finished, in the session's class.
    select * into _sub from submission
     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = (_in->>'course_id')::uuid
       and sent_by = 'student' and state = 'sending';
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _sub.created_at < now() - public._work_hold() then
        -- It has lost its place; the next call that finishes or starts
        -- work in the class drops it.
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    return jsonb_build_object('ok', true, 'submission_id', _sub.id, 'assessment_id', _sub.assessment_id,
                              'version', _sub.version, 'finish_by', _sub.created_at + public._work_hold(),
                              'bucket', public._work_bucket(), 'files', public._work_upload_json(_sub.id));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.markup(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _a  assessment%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _a from assessment where id = p_assessment_id and course_id = (_in->>'course_id')::uuid;
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _a.students_see_markup
       or exists (select 1 from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = _a.id and s.status in ('NS', 'EXC')) then
        return jsonb_build_object('ok', true, 'files', '[]'::jsonb);
    end if;
    return jsonb_build_object('ok', true, 'files', coalesce((
        select jsonb_agg(jsonb_build_object('file_id', m.file_id, 'marks', m.given, 'given_at', m.given_at) order by m.file_id)
          from markup m
          join submission_file f on f.id = m.file_id
          join submission x on x.id = f.submission_id and x.state = 'sent'
         where m.assessment_id = _a.id and m.given is not null
           and m.enrollment_id = any (coalesce(_group_members(_a.id, p_enrollment_id), array[p_enrollment_id]))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.feedback(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'reflect_on_feedback', _course.reflect_on_feedback,
        'show_my_learning', _course.show_my_learning,
        'assessments', coalesce((
            select jsonb_agg(x.j order by x.ord1 nulls first, x.ord2, x.ord3, x.id)
              from (select a.id, a.date_assigned as ord1, a.display_order as ord2, a.created_at as ord3,
                           jsonb_build_object(
                               'id', a.id,
                               'marks', mk.j,
                               'revision', rv.j,
                               'reflection', rf.j) as j
                      from assessment a
                      left join score s on s.enrollment_id = p_enrollment_id and s.assessment_id = a.id
                      -- marks given on the student's own pages, and on their group's
                      left join lateral (
                          select case when count(*) = 0 then null else jsonb_build_object(
                                     'pages', count(*),
                                     -- every page of the work: each member's latest handed-in version
                                     'work_pages', (select count(*) from submission_file wf
                                                     where wf.submission_id in (
                                                         select distinct on (ws.enrollment_id) ws.id from submission ws
                                                          where ws.assessment_id = a.id and ws.state = 'sent'
                                                            and ws.enrollment_id = any (coalesce(_group_members(a.id, p_enrollment_id), array[p_enrollment_id]))
                                                          order by ws.enrollment_id, ws.version desc)),
                                     'notes', sum((select count(*) from jsonb_array_elements(coalesce(m.given->'marks', '[]'::jsonb)) k
                                                    where k->>'type' = 'note'))) end as j
                            from markup m
                           where m.assessment_id = a.id and m.given is not null
                             and m.enrollment_id = any (coalesce(_group_members(a.id, p_enrollment_id), array[p_enrollment_id]))
                             and jsonb_array_length(coalesce(m.given->'marks', '[]'::jsonb)) > 0
                             and a.students_see_markup and coalesce(s.status, '') not in ('NS', 'EXC')
                             and exists (select 1 from submission_file f join submission x on x.id = f.submission_id
                                          where f.id = m.file_id and x.state = 'sent')) mk on true
                      left join lateral (
                          select jsonb_build_object(
                                     'state', st->>'state', 'what_to_fix', r.what_to_fix, 'revise_by', r.revise_by,
                                     'criterion_ids', to_jsonb(r.criterion_ids), 'keep_grade', r.keep_grade,
                                     'grade_hidden', false,
                                     'first_version', r.first_version,
                                     'first_sent_at', (select x.sent_at from submission x where x.id = r.first_submission_id),
                                     -- the first version's grade as the student had it: not while Missing or
                                     -- Excused is on the piece
                                     'first_grade', case when coalesce(s.status, '') in ('NS', 'EXC') then null
                                                         else public._grade_copy_in_use(r.first_grade, a.id) end,
                                     'revision_version', st->'revision_version', 'revision_sent_at', st->'revision_sent_at',
                                     'revision_note', case when st->>'revision_sent_by' = 'student' then st->'revision_note' end,
                                     'revision_late', st->'revision_late',
                                     'asked_at', r.created_at) as j
                            from revision_request r
                           cross join lateral (select public._revision_state(r.id) as st) z
                           where r.assessment_id = a.id and r.enrollment_id = p_enrollment_id and r.state <> 'cancelled'
                           order by r.created_at desc limit 1) rv on true
                      left join lateral (
                          select jsonb_build_object(
                                     'makes_sense', f.makes_sense, 'question', f.question, 'plan', f.plan, 'went_well', f.went_well,
                                     'sent_at', f.sent_at,
                                     -- the teacher's Only Me notes (note, follow_up_note) are never read here
                                     'answer', f.answer, 'answered_at', f.answered_at,
                                     'sense_now', f.sense_now, 'follow_up', f.follow_up,
                                     'follow_up_answer', f.follow_up_answer, 'follow_up_answered_at', f.follow_up_answered_at,
                                     -- What Changed: an answer the page has not shown yet (answer_seen)
                                     'answer_new', (f.answer is not null and f.answer_seen_at is null)
                                                   or (f.follow_up_answer is not null and f.follow_up_answer_seen_at is null)) as j
                            from feedback_reflection f
                           where f.assessment_id = a.id and f.enrollment_id = p_enrollment_id
                             and _course.reflect_on_feedback) rf on true
                     where a.course_id = _course.id
                       and (a.date_assigned is null or a.date_assigned <= _today)
                       and (mk.j is not null or rv.j is not null or rf.j is not null)) x), '[]'::jsonb),
        'last_plan', (select jsonb_build_object('assessment_id', f.assessment_id, 'plan', f.plan, 'sent_at', f.plan_at)
                        from feedback_reflection f
                       where f.enrollment_id = p_enrollment_id and f.course_id = _course.id and f.plan is not null
                         and _course.reflect_on_feedback
                       order by f.plan_at desc, f.id limit 1));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.group_file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'files', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', f.id, 'submission_id', s.id, 'version', s.version, 'page', f.page,
                       'path', f.path, 'thumb_path', f.thumb_path,
                       'width', f.width, 'height', f.height, 'rotation', f.rotation,
                       'mine', s.enrollment_id = p_enrollment_id)
                     order by s.sent_at, s.id, f.page, f.id)
              from submission s
              join submission_file f on f.submission_id = s.id
             where s.assessment_id = p_assessment_id and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'
               and s.enrollment_id = any (coalesce(_group_members(p_assessment_id, p_enrollment_id), array[p_enrollment_id]))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'files', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', f.id, 'submission_id', s.id, 'version', s.version, 'page', f.page,
                       'path', f.path, 'thumb_path', f.thumb_path,
                       'width', f.width, 'height', f.height, 'rotation', f.rotation)
                     order by s.version, f.page, f.id)
              from submission s
              join submission_file f on f.submission_id = s.id
             where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id
               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.reflect(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reflection jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb;
    _course course%rowtype;
    _a      assessment%rowtype;
    _k      text;
    _sense  text;
    _q      text;
    _plan   text;
    _well   text;
    _f      feedback_reflection%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if p_reflection is null or jsonb_typeof(p_reflection) <> 'object' then
        raise exception 'the reflection must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_reflection) loop
        if _k not in ('makes_sense', 'question', 'plan', 'went_well') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
        if _k <> 'makes_sense' and jsonb_typeof(p_reflection->_k) not in ('string', 'null') then
            raise exception '% must be text', _k using errcode = '22023';
        end if;
    end loop;
    _sense := p_reflection->>'makes_sense';
    if _sense is null or _sense not in ('yes', 'not_sure') or jsonb_typeof(p_reflection->'makes_sense') <> 'string' then
        raise exception 'makes_sense must be yes or not_sure' using errcode = '22023';
    end if;
    _q := nullif(btrim(p_reflection->>'question'), '');
    _plan := nullif(btrim(p_reflection->>'plan'), '');
    _well := nullif(btrim(p_reflection->>'went_well'), '');
    if char_length(_q) > 1000 or char_length(_plan) > 1000 or char_length(_well) > 1000 then
        raise exception 'each answer is 1000 characters at most' using errcode = '22023';
    end if;
    if _sense = 'not_sure' and _q is null then
        raise exception 'not_sure needs a question' using errcode = '22023';
    end if;
    if _sense = 'yes' and _plan is null then
        raise exception 'yes needs a plan' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;
    if not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.reflect_on_feedback then
        return jsonb_build_object('ok', false, 'error', 'reflect_off');
    end if;
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date);
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not exists (select 1 from grade_return g
                    where g.enrollment_id = p_enrollment_id and g.assessment_id = _a.id and g.returned_at is not null) then
        return jsonb_build_object('ok', false, 'error', 'not_returned');
    end if;
    select * into _f from feedback_reflection where assessment_id = _a.id and enrollment_id = p_enrollment_id for update;
    if found and _f.answer is not null then
        return jsonb_build_object('ok', false, 'error', 'already_answered');
    end if;
    insert into feedback_reflection (course_id, assessment_id, enrollment_id, makes_sense, question, plan, plan_at, went_well)
    values (_course.id, _a.id, p_enrollment_id, _sense, _q, _plan, case when _plan is not null then now() end, _well)
    on conflict (assessment_id, enrollment_id) do update
       set makes_sense = excluded.makes_sense, question = excluded.question, plan = excluded.plan, went_well = excluded.went_well,
           plan_at = case when excluded.plan is null then null
                          when excluded.plan is not distinct from feedback_reflection.plan then feedback_reflection.plan_at
                          else now() end,
           sent_at = case when (feedback_reflection.makes_sense, feedback_reflection.question, feedback_reflection.plan, feedback_reflection.went_well)
                               is not distinct from (excluded.makes_sense, excluded.question, excluded.plan, excluded.went_well)
                          then feedback_reflection.sent_at else now() end,
           updated_at = now()
    returning * into _f;
    return jsonb_build_object('ok', true, 'reflection', jsonb_build_object(
        'makes_sense', _f.makes_sense, 'question', _f.question, 'plan', _f.plan, 'went_well', _f.went_well, 'sent_at', _f.sent_at));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.reply(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reply jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in    jsonb;
    _k     text;
    _sense text;
    _more  text;
    _plan  text;
    _f     feedback_reflection%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if p_reply is null or jsonb_typeof(p_reply) <> 'object' then
        raise exception 'the reply must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_reply) loop
        if _k not in ('sense_now', 'follow_up', 'plan') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
    end loop;
    _sense := p_reply->>'sense_now';
    if jsonb_typeof(p_reply->'sense_now') is distinct from 'string' or _sense not in ('yes', 'not_sure') then
        raise exception 'sense_now must be yes or not_sure' using errcode = '22023';
    end if;
    if p_reply ? 'follow_up' and jsonb_typeof(p_reply->'follow_up') not in ('string', 'null') then
        raise exception 'follow_up must be text' using errcode = '22023';
    end if;
    _more := nullif(btrim(p_reply->>'follow_up'), '');
    if _more is not null and (_sense <> 'not_sure' or char_length(_more) > 1000) then
        raise exception 'a follow_up of 1 to 1000 characters goes only with not_sure' using errcode = '22023';
    end if;
    if p_reply ? 'plan' and jsonb_typeof(p_reply->'plan') not in ('string', 'null') then
        raise exception 'plan must be text' using errcode = '22023';
    end if;
    _plan := nullif(btrim(p_reply->>'plan'), '');
    if _plan is not null and (_sense <> 'yes' or char_length(_plan) > 1000) then
        raise exception 'a plan of 1 to 1000 characters goes only with yes' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    if not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not (select c.reflect_on_feedback from course c where c.id = (_in->>'course_id')::uuid) then
        return jsonb_build_object('ok', false, 'error', 'reflect_off');
    end if;
    select * into _f from feedback_reflection
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and course_id = (_in->>'course_id')::uuid
       for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _f.answer is null then
        return jsonb_build_object('ok', false, 'error', 'not_answered');
    end if;
    if _more is not null and _f.follow_up is not null and _f.follow_up is distinct from _more then
        return jsonb_build_object('ok', false, 'error', 'already_asked');
    end if;
    update feedback_reflection
       set sense_now = _sense,
           sense_now_at = case when sense_now is distinct from _sense then now() else coalesce(sense_now_at, now()) end,
           follow_up = coalesce(follow_up, _more),
           plan_at = case when _plan is null then plan_at when _plan is distinct from plan then now() else plan_at end,
           plan = coalesce(_plan, plan),
           updated_at = now()
     where id = _f.id
    returning * into _f;
    return jsonb_build_object('ok', true, 'reflection', jsonb_build_object(
        'sense_now', _f.sense_now, 'follow_up', _f.follow_up, 'plan', _f.plan, 'answer', _f.answer,
        'follow_up_answer', _f.follow_up_answer));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.answer_seen(p_session_token text, p_enrollment_id uuid, p_assessment_ids uuid[], p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _n  int;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    update feedback_reflection f
       set answer_seen_at = case when f.answer is not null then coalesce(f.answer_seen_at, clock_timestamp())
                                 else f.answer_seen_at end,
           follow_up_answer_seen_at = case when f.follow_up_answer is not null
                                           then coalesce(f.follow_up_answer_seen_at, clock_timestamp())
                                           else f.follow_up_answer_seen_at end
     where f.enrollment_id = p_enrollment_id and f.course_id = (_in->>'course_id')::uuid
       and f.assessment_id = any (coalesce(p_assessment_ids, '{}'))
       and ((f.answer is not null and f.answer_seen_at is null)
            or (f.follow_up_answer is not null and f.follow_up_answer_seen_at is null));
    get diagnostics _n = row_count;
    return jsonb_build_object('ok', true, 'seen', _n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_score_report_note(p_enrollment_id uuid, p_assessment_id uuid, p_note text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _note text; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'save_score_report_note');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;
    _note := nullif(btrim(p_note), '');
    if char_length(_note) > 300 then
        raise exception 'report note must be 300 characters or fewer' using errcode = '22023';
    end if;
    select id into _id from score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is null then
        insert into score (enrollment_id, assessment_id, report_note)
        values (p_enrollment_id, p_assessment_id, _note)
        returning id into _id;
    else
        update score set report_note = _note, updated_at = now() where id = _id;
    end if;
    perform fv_idem_store(p_idempotency_key, 'save_score_report_note', jsonb_build_object('id', _id));
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public.list_course_grade_returns(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select coalesce(jsonb_object_agg(x.assessment_id::text, x.students), '{}'::jsonb)
      from (select g.assessment_id,
                   jsonb_object_agg(g.enrollment_id::text, jsonb_strip_nulls(jsonb_build_object(
                       'is_draft', g.is_draft, 'returned_at', g.returned_at, 'updated_at', g.updated_at,
                       'returned_copy', g.returned_copy, 'previous_copy', g.previous_copy))) as students
              from grade_return g
              join enrollment e on e.id = g.enrollment_id
              join assessment a on a.id = g.assessment_id
             where e.course_id = p_course_id
               -- a row with nothing to say (a grade cleared, a save in flight) is left out.
               -- seen_at is the student's own and is not sent to the teacher, and a DIBELS
               -- benchmark is not a grade that is returned (2026110905).
               and (g.is_draft or g.returned_at is not null)
               and a.score_mode <> 'dibels'
             group by g.assessment_id) x;
$function$;
-- UNDO-BODIES-END

drop function if exists student_submit.forms(text, uuid, text);
drop function if exists student_submit.form(text, uuid, uuid, text);
drop function if exists student_submit.answer(text, uuid, uuid, jsonb, text);
drop function if exists student_submit.report(text, uuid, uuid, text);
drop function if exists student_submit._card_listed(uuid, uuid);
drop function if exists student_submit._write_limit(uuid, text, integer);
drop function if exists fv_private.report_note_hold(uuid, uuid);
drop table if exists student_submit.write_log;
alter table public.grade_return drop column if exists held_note;
alter table public.grade_return drop column if exists held_note_at;
commit;
