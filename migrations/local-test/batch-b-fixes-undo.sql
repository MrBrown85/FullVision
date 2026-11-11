-- BATCH B REVIEW FIXES, UNDONE. Not a migration: the way back from
-- migrations/2026111104_student_work_review_fixes.sql. It is kept under
-- local-test/ so CI's drift check does not wait for it to be applied.
-- Proved by migrations/local-test/submissions_fixes.py (scenario undo).
--
-- It puts the three functions that file replaced back to their bodies as
-- Batch B (8c36fe48) made them, word for word:
--   public.finish_work_upload(uuid, jsonb, uuid)
--   student_submit.send_finish(text, uuid, uuid, jsonb, text)
--   student_submit.unsend(text, uuid, uuid, text)
-- and changes nothing else: no row, no table, no grant (CREATE OR REPLACE
-- keeps the owner and the grants). Its last step proves each of the three
-- carries Batch B's fingerprint again and the other 41 are untouched.
-- Afterwards the two faults the file fixed are back (a submission can pass
-- 30 pages; a student's Unsend or Replace drops the teacher's unfinished
-- Add as More Pages and queues its files for deletion).
--
-- WORK IN PROGRESS WHEN IT IS RUN: nothing is lost by the undo itself. A
-- teacher's Add that the fixed Replace moved to the new work, or that the
-- fixed Unsend let go free (intent 'new'), stays as it is and can still be
-- finished with the old bodies: onto the new work, or as the teacher's new
-- work for the piece.
--
-- WHEN IT IS NEEDED BEFORE BATCH B'S OWN WAY BACK. batch-b-undo.sql PART 2
-- checks that every one of Batch B's functions is as Batch B left it, and
-- refuses while the fix is applied. So the order out is: this file, then
-- batch-b-undo.sql. PART 1 and PART 1B of batch-b-undo.sql run either way.
-- The same holds for running 2026111101_student_work_submissions.sql again
-- (PART 1B's way back, to put its four triggers back): with the fix in, the
-- first file stops at its first check ("do not run this file again"). Run
-- this undo, then the first file, then 2026111104 again.
--
-- It stops, with nothing changed, unless Batch B is in and each of its 44
-- functions is as 8c36fe48 left it, except that the three may be as
-- 2026111104 left them. Run on a database where the fix was never applied
-- (or already undone), it changes nothing. One transaction: all or none.
begin;
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
    _fix text;
begin
    if to_regclass('public.submission') is null or to_regclass('public.submission_file') is null then
        raise exception 'Batch B is not applied: there is nothing to undo. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN batchb (Batch B's 44 functions as 8c36fe48 leaves them; written by submissions_fixes.py)
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
            ('public._work_object(text)',                                                           '1c78c7884df1e02c326b06989da25c5c'),
            ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_class_max_pages()',                                                      'b8ccccd702ef8a8260bd7cf54bc9982a'),
            ('public._work_class_max_bytes()',                                                      '3c5df6fb4a11ae55005ec87362fdf95e'),
            ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
            ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
            ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
            ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_json(uuid)',                                                       'a1933b27974307aeae814ce98714c18f'),
            ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
            ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
            ('public._submission_file_removed()',                                                   'edc99e4c04baefcf83b9ce3c94723023'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
            ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
            ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
            ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
            ('public.list_course_submissions(uuid)',                                                '525db92cdf4129afb9e2bc15aa7d4725'),
            ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 '538ffab506d6c20344c07662837fe714'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'a6b8abb071daf36993e1318c07b42085'),
            ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '6a3caf6c0bfad3398bbb33a8ac1aa79a'),
            ('public.delete_submission(uuid,uuid)',                                                 'c1f98e77a7fb756e75af4334d520f5fc'),
            ('public.rotate_submission_page(uuid,integer,uuid)',                                    '2c08eb9198d7dc2b50a81caf18e08365'),
            ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_upload_allowed(text)',                                                'b53e85108b1e870a16e717055c63f2dc'),
            ('fv_private.work_read_allowed(text)',                                                  '3ea2b37a835c7a86a881ed743b95d1c9'),
            ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '595e0a34dc67e23ca9fadc478c2ab9b7'),
            ('student_submit.work(text,uuid,text)',                                                 '64d016d3d102327917e987b24e811129'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               'fe147af22bb706b08193504b72de223d'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '3161f6b51e8a8e4e54e2d01033a20848'),
            ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
            ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
            -- FINGERPRINTS-END
        ) as v(fn, was)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        _fix := (select w.becomes from (values
            -- FINGERPRINTS-BEGIN fixes (as 2026111104 leaves them; written by submissions_fixes.py)
            ('public.finish_work_upload(uuid,jsonb,uuid)',            'c8c5c26be1758ec2e07fe73a68731159'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', '286e463dca1842c2586a93c77fb93456'),
            ('student_submit.unsend(text,uuid,uuid,text)',            '68665f35e1678f1bba64d30c082409d8')
            -- FINGERPRINTS-END
        ) as w(fn, becomes) where w.fn = _f.fn);
        if _md5 <> _f.was and _md5 is distinct from _fix then
            raise exception '% is neither as Batch B (8c36fe48) left it nor as 2026111104 left it (found %): something else has changed it. Nothing was changed.',
                _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

-- The three, exactly as 2026111101_student_work_submissions.sql has them.
create or replace function public.finish_work_upload(p_submission_id uuid, p_files jsonb, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _sub    submission%rowtype;
    _target submission%rowtype;
    _state  jsonb;
    _last   int;
    _result uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    perform _work_check_files(p_files);
    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock): the same request
    -- sent twice at once waits above, and the second is answered as a repeat.
    _cached := fv_idem_check(p_idempotency_key, 'finish_work_upload');
    if _cached is not null then return _cached; end if;
    if _course is null then
        -- Never existed, another teacher's, or already finished and since
        -- replaced or deleted. The same answer for all of them.
        return jsonb_build_object('result', 'gone');
    end if;
    -- An upload that has lost its place is dropped here, with the class's others.
    perform _work_drop_expired(_course);
    -- The teacher's own upload, and never a student's unfinished send.
    select * into _sub from submission where id = p_submission_id and sent_by = 'teacher' for update;
    if not found then
        return jsonb_build_object('result', 'gone');
    end if;
    if _sub.state = 'sent' then
        return jsonb_build_object('result', 'sent', 'submission', _submission_json(_sub.id) - 'intent' - 'target_id');
    end if;
    if exists (select 1 from jsonb_array_elements(p_files) x
                where not exists (select 1 from submission_file f
                                   where f.submission_id = _sub.id and f.id = (x->>'file_id')::uuid)) then
        raise exception 'a file is not one of this upload''s' using errcode = '22023';
    end if;
    _state := _work_files_state(_sub.id, p_files);
    if _state->'missing' <> '[]'::jsonb then
        -- Not remembered: the next try looks again.
        return jsonb_build_object('result', 'missing_pages', 'missing', _state->'missing');
    end if;
    if _state->'bad' <> '[]'::jsonb then
        return jsonb_build_object('result', 'bad_file', 'files', _state->'bad');
    end if;

    if _sub.intent <> 'new' then
        select * into _target from submission where id = _sub.target_id and state = 'sent' for update;
        if not found then
            -- cannot happen: an unfinished upload goes with the work it was for
            return jsonb_build_object('result', 'gone');
        end if;
    end if;
    perform _work_settle_files(_sub.id, p_files);
    if _sub.intent = 'add' then
        -- Its pages go on the end of what was sent, each still marked as the
        -- teacher's, and the row that carried them goes (it has no pages
        -- left, so nothing is queued).
        select coalesce(max(f.page), 0) into _last from submission_file f where f.submission_id = _target.id;
        update submission_file set submission_id = _target.id, page = page + _last where submission_id = _sub.id;
        delete from submission where id = _sub.id;
        update submission set updated_at = now() where id = _target.id;
        _result := _target.id;
    else
        if _sub.intent = 'replace' then
            -- Let go of what it replaces first: an unfinished upload goes
            -- with its target, and this one is about to take its place.
            update submission set intent = 'new', target_id = null where id = _sub.id;
            perform set_config('fv.work_removal_reason', 'replace', true);
            delete from submission where id = _target.id;
            perform set_config('fv.work_removal_reason', '', true);
        elsif exists (select 1 from submission
                       where assessment_id = _sub.assessment_id and enrollment_id = _sub.enrollment_id and state = 'sent') then
            -- The student sent while the teacher's pages were going up.
            perform set_config('fv.work_removal_reason', 'abandoned', true);
            delete from submission where id = _sub.id;
            perform set_config('fv.work_removal_reason', '', true);
            return jsonb_build_object('result', 'already_sent');
        end if;
        update submission
           set state = 'sent', intent = 'new', target_id = null, version = coalesce(_target.version, version),
               sent_at = now(), updated_at = now()
         where id = _sub.id;
        _result := _sub.id;
    end if;
    _cached := jsonb_build_object('result', 'sent', 'submission', _submission_json(_result) - 'intent' - 'target_id');
    perform fv_idem_store(p_idempotency_key, 'finish_work_upload', _cached);
    return _cached;
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

create or replace function student_submit.unsend(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in        jsonb;
    _course    course%rowtype;
    _a         assessment%rowtype;
    _w         jsonb;
    _sent      submission%rowtype;
    _cancelled int;
    _pages     int;
    _kept      int;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- The lock a grade's save takes. An Unsend and the first level saved for
    -- the piece take turns: whichever is second sees what the first did.
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;
    perform public._work_drop_expired(_course.id);
    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- A send of the student's own that is not finished is theirs to drop,
    -- always.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';
    get diagnostics _cancelled = row_count;
    perform set_config('fv.work_removal_reason', '', true);

    select * into _sent from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sent'
     order by version desc limit 1
       for update;
    if not found then
        -- Nothing is handed in: also the answer to an Unsend sent twice.
        return jsonb_build_object('ok', true, 'unsent', false, 'cancelled', _cancelled > 0, 'pages', 0, 'kept', 0);
    end if;
    if _sent.sent_by <> 'student' then
        return jsonb_build_object('ok', false, 'error', 'cannot_change');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    _w := _work_window(_a.id);
    if not (_w->>'open')::boolean then
        -- Unsent now, it could not be sent again.
        return jsonb_build_object('ok', false, 'error', 'work_closed', 'closed_on', _w->'closes_on');
    end if;
    if _grading_started(p_enrollment_id, _a.id) then
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;

    select count(*) filter (where f.added_by = 'student'), count(*) filter (where f.added_by = 'teacher')
      into _pages, _kept
      from submission_file f where f.submission_id = _sent.id;
    perform set_config('fv.work_removal_reason', 'unsend', true);
    if _kept = 0 then
        delete from submission where id = _sent.id;
    else
        -- The teacher added pages to this work. They are not the student's
        -- to remove: the student's own pages go, the teacher's close up to
        -- pages 1, 2, 3, and the work stays as the teacher's, without the
        -- student's note.
        delete from submission_file where submission_id = _sent.id and added_by = 'student';
        update submission_file f
           set page = x.rn
          from (select t.id, row_number() over (order by t.page, t.id) as rn
                  from submission_file t where t.submission_id = _sent.id) x
         where f.id = x.id;
        update submission
           set sent_by = 'teacher', note = null, followed_plan = null, card_id = null, request_id = null, updated_at = now()
         where id = _sent.id;
    end if;
    perform set_config('fv.work_removal_reason', '', true);
    return jsonb_build_object('ok', true, 'unsent', true, 'cancelled', _cancelled > 0, 'pages', _pages, 'kept', _kept);
end;
$function$;

do $final$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN batchb (Batch B's 44 functions as 8c36fe48 leaves them; written by submissions_fixes.py)
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
            ('public._work_object(text)',                                                           '1c78c7884df1e02c326b06989da25c5c'),
            ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_class_max_pages()',                                                      'b8ccccd702ef8a8260bd7cf54bc9982a'),
            ('public._work_class_max_bytes()',                                                      '3c5df6fb4a11ae55005ec87362fdf95e'),
            ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
            ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
            ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
            ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_json(uuid)',                                                       'a1933b27974307aeae814ce98714c18f'),
            ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
            ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
            ('public._submission_file_removed()',                                                   'edc99e4c04baefcf83b9ce3c94723023'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
            ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
            ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
            ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
            ('public.list_course_submissions(uuid)',                                                '525db92cdf4129afb9e2bc15aa7d4725'),
            ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 '538ffab506d6c20344c07662837fe714'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'a6b8abb071daf36993e1318c07b42085'),
            ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '6a3caf6c0bfad3398bbb33a8ac1aa79a'),
            ('public.delete_submission(uuid,uuid)',                                                 'c1f98e77a7fb756e75af4334d520f5fc'),
            ('public.rotate_submission_page(uuid,integer,uuid)',                                    '2c08eb9198d7dc2b50a81caf18e08365'),
            ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_upload_allowed(text)',                                                'b53e85108b1e870a16e717055c63f2dc'),
            ('fv_private.work_read_allowed(text)',                                                  '3ea2b37a835c7a86a881ed743b95d1c9'),
            ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '595e0a34dc67e23ca9fadc478c2ab9b7'),
            ('student_submit.work(text,uuid,text)',                                                 '64d016d3d102327917e987b24e811129'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               'fe147af22bb706b08193504b72de223d'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '3161f6b51e8a8e4e54e2d01033a20848'),
            ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
            ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
            -- FINGERPRINTS-END
        ) as v(fn, was)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.was then
            raise exception '% is not as Batch B left it after the undo (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.was;
        end if;
    end loop;
end
$final$;

notify pgrst, 'reload schema';

commit;
