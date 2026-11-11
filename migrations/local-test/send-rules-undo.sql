-- BATCH B SEND RULES, UNDONE. Not a migration: the way back from
-- migrations/2026111130_student_send_rules.sql. It is kept under local-test/
-- so CI's drift check does not wait for it to be applied. Proved by
-- migrations/local-test/send_rules.py (scenario undo).
--
-- It puts the three functions that file replaced back to the bodies they
-- had before it, word for word:
--   student_submit._send_begin(text, text, uuid, uuid, jsonb, text, text, uuid)   Batch B's (2026111101)
--   student_submit.send_finish(text, uuid, uuid, jsonb, text)                     the fixes file's (2026111104)
--   student_submit.work(text, uuid, text)                                         Batch B's (2026111101)
-- drops the one it added,
--   student_submit.send_paths(text, uuid, uuid, text)
-- and changes nothing else: no row, no table, no grant (CREATE OR REPLACE
-- keeps the owner and the grants). Its last step proves each of the three
-- carries its fingerprint from before 2026111130 again and send_paths is
-- gone. Afterwards rulings 106 and 107 are undone: a
-- send that crosses the piece's last day is refused (work_closed), and a
-- student behind the teacher's pages is told already_sent.
--
-- WORK IN PROGRESS WHEN IT IS RUN: nothing is deleted by the undo itself.
-- Work handed in under 2026111130 stays as it is (a student's work holding
-- the teacher's pages after their own is what a Replace already makes, and
-- the old bodies read it so). A student's send started under 2026111130
-- onto the teacher's work and not yet finished is a plain new send; finished
-- after the undo it is answered already_sent and its pages are dropped, as
-- before the file.
--
-- BEFORE OR AFTER BATCH C'S UNDO: either. The bodies it restores (Batch
-- B's _send_begin and work, the fixes file's send_finish) never read
-- revision_request or anything Batch C adds, and every function they call
-- is there with or without Batch C. So it runs with Batch C in, and also
-- after batch-c2-undo.sql and batch-c1-undo.sql have run (which do not
-- check this file's functions: C1's PART 2 drops revision_request, which
-- 2026111130's three read, so until this undo runs the student's page
-- fails; running this undo then puts the page right). The usual order out
-- is still this file first, then Batch C's undo, then the fixes', then
-- Batch B's: the undo of the fixes file, Batch B's undo PART 2, and running
-- 2026111104, 2026111120 or 2026111101 again each check fingerprints of
-- functions this file replaces, and refuse while it is applied.
--
-- It stops, with nothing changed, unless each of the three is as
-- 2026111130 leaves it or as it was before (then it changes nothing), and
-- send_paths is absent or as 2026111130 leaves it. It checks nothing else,
-- so it does not stop on Batch C being in or out. One transaction: all or
-- none.
begin;
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    -- The three this file replaces: as the files before it leave them, or
    -- as this file leaves them (a second run, which changes nothing).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/send_rules.py)
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '595e0a34dc67e23ca9fadc478c2ab9b7', '6cad6dd40eb1c33451a5dcf4f60e7624'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                '286e463dca1842c2586a93c77fb93456', '340cb72444d555a9cef594b543e2674c'),
            ('student_submit.work(text,uuid,text)',                                  '64d016d3d102327917e987b24e811129', '2ec445c5d5afadb7c3fc1699d9929e52')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). It is neither as 2026111130 leaves it nor as it was before: something else replaced it, and this undo would lose that. Nothing was changed.',
                _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- The one 2026111130 adds: absent, or as that file leaves it.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/send_rules.py)
            ('student_submit.send_paths(text,uuid,uuid,text)', '2f36c08b8ace950b9c7eb905b320aa40')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% is not as 2026111130 leaves it (found %): something else made it, and this undo would drop it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

create or replace function student_submit._send_begin(
    p_intent text, p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb,
    p_note text, p_followed_plan text, p_request_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb;
    _course  course%rowtype;
    _a       assessment%rowtype;
    _w       jsonb;
    _card    uuid;
    _sub     submission%rowtype;
    _sent    submission%rowtype;
    _expired boolean;
    _n       int;
    _oldest  timestamptz;
    _theirs  int;
    _full    jsonb;
    _id      uuid;
begin
    -- The request's shape, before anything is read. A wrong shape is the
    -- caller's bug, not something a student did: the call fails.
    if p_request_id is null then
        raise exception 'a request id is needed' using errcode = '22023';
    end if;
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    perform public._work_check_pages(p_pages);
    if char_length(coalesce(p_note, '')) > 1000 then
        raise exception 'the note is over 1000 characters' using errcode = '22023';
    end if;
    if p_followed_plan is not null and p_followed_plan not in ('yes', 'partly', 'no') then
        raise exception 'followed_plan must be yes, partly or no' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _card := (_in->>'card_id')::uuid;

    -- The class's lock, first: this call has written nothing yet. Every
    -- change to a submission is made under it, so two sends, an Unsend, the
    -- teacher's Add Work and a grade being saved take turns.
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

    -- Is this a repeat of a send that has lost its place? Looked at before
    -- the class's expired sends are dropped, this one among them.
    _expired := exists (select 1 from submission
                         where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and sent_by = 'student'
                           and request_id = p_request_id and state = 'sending'
                           and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);

    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;
    _w := _work_window(_a.id);
    if _a.id is null or not (_w->>'listed')::boolean then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if _expired then
        -- Started more than _work_hold ago and never finished: it is gone,
        -- and its files are queued. A new send needs a new request id.
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- The same request again (the reply was lost): the same answer, and
    -- nothing new is made or counted. It does not give the send any longer:
    -- it still has to be finished within _work_hold of its first start.
    select * into _sub from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and sent_by = 'student' and request_id = p_request_id;
    if found then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,
                                  'bucket', public._work_bucket(), 'late', _sub.is_late,
                                  'finish_by', case when _sub.state = 'sending' then _sub.created_at + public._work_hold() end,
                                  'files', case when _sub.state = 'sending' then public._work_upload_json(_sub.id) else '[]'::jsonb end);
    end if;

    if not (_w->>'open')::boolean then
        return jsonb_build_object('ok', false, 'error', 'work_closed', 'closed_on', _w->'closes_on');
    end if;
    select * into _sent from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sent'
     order by version desc limit 1;
    if p_intent = 'new' and _sent.id is not null then
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;
    if p_intent = 'replace' then
        if _sent.id is null then
            return jsonb_build_object('ok', false, 'error', 'nothing_sent');
        end if;
        if _sent.sent_by <> 'student' then
            -- the teacher added it, or marked it handed in on paper
            return jsonb_build_object('ok', false, 'error', 'cannot_change');
        end if;
        if _grading_started(p_enrollment_id, _a.id) then
            return jsonb_build_object('ok', false, 'error', 'grading_started');
        end if;
        -- Pages the teacher added to it stay when the student's are
        -- replaced: with them the new pages must still fit in 30.
        select count(*) into _theirs from submission_file f where f.submission_id = _sent.id and f.added_by = 'teacher';
        if _theirs + jsonb_array_length(p_pages) > 30 then
            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', 30 - _theirs);
        end if;
    end if;

    -- Twenty sends an hour for one card (Colin, Nov 9). Counted when links
    -- are handed out, so unsending does not give a send back.
    delete from send_log where at < now() - interval '1 day';
    select count(*), min(at) into _n, _oldest from send_log where card_id = _card and at > now() - interval '1 hour';
    if _n >= 20 then
        return jsonb_build_object('ok', false, 'error', 'too_many',
                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));
    end if;

    -- A send this student started for the piece and never finished goes.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';
    perform set_config('fv.work_removal_reason', '', true);

    -- The class may hold only so much (pages and bytes, handed in and
    -- unfinished together).
    _full := public._work_class_full(_course.id, p_pages);
    if _full is not null then
        return jsonb_build_object('ok', false, 'error', 'class_full');
    end if;

    insert into send_log (card_id) values (_card);
    _id := public._work_begin(_course.id, _a.id, p_enrollment_id, 'student', p_intent,
                              case when p_intent = 'replace' then _sent.id end,
                              p_pages, p_note, p_followed_plan, (_w->>'late')::boolean, _card, p_request_id);
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _id, 'state', 'sending',
                              'bucket', public._work_bucket(), 'late', (_w->>'late')::boolean,
                              'finish_by', now() + public._work_hold(),
                              'files', public._work_upload_json(_id));
end;
$function$;

create or replace function student_submit.send_finish(
    p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_files jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb;
    _course  course%rowtype;
    _sub     submission%rowtype;
    _target  submission%rowtype;
    _a       assessment%rowtype;
    _w       jsonb;
    _state   jsonb;
    _expired boolean;
    _pages   int;
    _theirs  int;
begin
    if p_submission_id is null then
        raise exception 'a submission is needed' using errcode = '22023';
    end if;
    perform public._work_check_files(p_files);
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

    -- Has this send lost its place? Looked at before the class's expired
    -- sends are dropped, this one among them.
    _expired := exists (select 1 from submission
                         where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id
                           and sent_by = 'student' and state = 'sending' and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);
    if _expired then
        -- It could be finished for _work_hold after its first start and no
        -- longer. It is gone and its files are queued: start again.
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- This student's own send, and no one else's.
    select * into _sub from submission
     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id and sent_by = 'student'
       for update;
    if not found then
        -- never there, or dropped: a newer send took its place, or the
        -- piece's work was changed under it
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _sub.state = 'sent' then
        -- the same finish again
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'sent_at', _sub.sent_at,
                                  'late', _sub.is_late,
                                  'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
    end if;
    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    -- Everything a start asks is asked again now, at the moment of handing
    -- in: Send Work, the piece still taking work, still open; and late is
    -- what it is now, not what it was when the send started.
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = _sub.assessment_id;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    _w := _work_window(_a.id);
    if not (_w->>'open')::boolean then
        return jsonb_build_object('ok', false, 'error', 'work_closed', 'closed_on', _w->'closes_on');
    end if;
    if exists (select 1 from jsonb_array_elements(p_files) x
                where not exists (select 1 from submission_file f
                                   where f.submission_id = _sub.id and f.id = (x->>'file_id')::uuid)) then
        raise exception 'a file is not one of this send''s' using errcode = '22023';
    end if;

    -- Nothing is handed in until every page is up (Colin, Nov 9): each page
    -- and its thumbnail must be in storage, read from storage's own table.
    _state := public._work_files_state(_sub.id, p_files);
    if _state->'missing' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'missing_pages', 'missing', _state->'missing');
    end if;
    if _state->'bad' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'bad_file', 'files', _state->'bad');
    end if;

    if _sub.intent = 'replace' then
        select * into _target from submission where id = _sub.target_id and state = 'sent' for update;
        if not found then
            -- cannot happen: an unfinished send goes with the work it was to replace
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if _grading_started(p_enrollment_id, _sub.assessment_id) then
            -- The teacher started grading while the new pages were going
            -- up. What was sent stays; the new pages are dropped.
            perform set_config('fv.work_removal_reason', 'abandoned', true);
            delete from submission where id = _sub.id;
            perform set_config('fv.work_removal_reason', '', true);
            return jsonb_build_object('ok', false, 'error', 'grading_started');
        end if;
        -- 30 pages at most in one submission (ruling 88), asked again now:
        -- the teacher may have added pages to the old work since the start
        -- asked, and they stay. The send stays too: finish it with fewer
        -- pages (the ones left out are deleted) or start again.
        select count(*) into _theirs from submission_file f where f.submission_id = _target.id and f.added_by = 'teacher';
        if _theirs + jsonb_array_length(p_files) > 30 then
            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));
        end if;
    elsif exists (select 1 from submission
                   where assessment_id = _sub.assessment_id and enrollment_id = p_enrollment_id and state = 'sent') then
        -- The teacher added this student's work while the pages were going up.
        perform set_config('fv.work_removal_reason', 'abandoned', true);
        delete from submission where id = _sub.id;
        perform set_config('fv.work_removal_reason', '', true);
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;

    _pages := public._work_settle_files(_sub.id, p_files);
    if _sub.intent = 'replace' then
        -- The student's old pages go. Pages the teacher added to the old
        -- work are not the student's to remove: they move to the new work,
        -- after the new pages, each keeping its file.
        update submission_file f
           set submission_id = _sub.id, page = _pages + x.rn
          from (select t.id, row_number() over (order by t.page, t.id) as rn
                  from submission_file t where t.submission_id = _target.id and t.added_by = 'teacher') x
         where f.id = x.id;
        -- Let go of what it replaces first: an unfinished send goes with
        -- its target, and this one is about to take its place.
        update submission set intent = 'new', target_id = null where id = _sub.id;
        -- An Add as More Pages the teacher has started on the old work and
        -- not finished is not the student's to drop (ruling 92): it now adds
        -- to this work, and is finished onto it.
        update submission set target_id = _sub.id
         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';
        perform set_config('fv.work_removal_reason', 'replace', true);
        delete from submission where id = _target.id;
        perform set_config('fv.work_removal_reason', '', true);
    end if;
    update submission
       set state = 'sent', intent = 'new', target_id = null, version = coalesce(_target.version, version),
           is_late = (_w->>'late')::boolean, sent_at = now(), updated_at = now()
     where id = _sub.id
    returning * into _sub;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _sub.id, 'sent_at', _sub.sent_at,
                              'late', _sub.is_late,
                              'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
end;
$function$;

create or replace function student_submit.work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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
                                                 and a.students_send <> 'nothing' and (w.j->>'open')::boolean) end,
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

drop function if exists student_submit.send_paths(text, uuid, uuid, text);

do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/send_rules.py)
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '595e0a34dc67e23ca9fadc478c2ab9b7', '6cad6dd40eb1c33451a5dcf4f60e7624'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                '286e463dca1842c2586a93c77fb93456', '340cb72444d555a9cef594b543e2674c'),
            ('student_submit.work(text,uuid,text)',                                  '64d016d3d102327917e987b24e811129', '2ec445c5d5afadb7c3fc1699d9929e52')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before then
            raise exception '% is not as it was before 2026111130 (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    if to_regprocedure('student_submit.send_paths(text,uuid,uuid,text)') is not null then
        raise exception 'student_submit.send_paths is still there. Nothing was changed.';
    end if;
    -- S0-M5's check: no SECURITY DEFINER function in the app's three schemas
    -- is left without pg_temp last in its search_path.
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                        where s ~ '^search_path=(.*, )?pg_temp$');
    if _left is not null then
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. Nothing was changed.', _left;
    end if;
end
$final$;

notify pgrst, 'reload schema';

commit;
