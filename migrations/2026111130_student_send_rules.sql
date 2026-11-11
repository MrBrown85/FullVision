-- Students send work: two of Colin's rulings of Nov 11, 2026 (106 and 107).
-- Apply AFTER, in this order: 2026111101_student_work_submissions.sql and
-- 2026111102_student_work_storage.sql (Batch B) and
-- 2026111104_student_work_review_fixes.sql (its review fixes), all three on
-- live, then Batch C's 2026111120_markup_reflect_revise.sql (C1) and
-- 2026111121_markup_revise_grade_changes.sql (C2), PR 1043 as of a682b559
-- (its review round 3).
-- None of those is changed. This file replaces three functions, adds one
-- (section 4, its own commit, approved by Colin on Nov 11), and changes
-- nothing else:
--   student_submit._send_begin(text, text, uuid, uuid, jsonb, text, text, uuid)
--                                   a student's send or Replace, first half
--   student_submit.send_finish(text, uuid, uuid, jsonb, text)
--                                   a student's send or Replace, handed in
--   student_submit.work(text, uuid, text)
--                                   what the student's page shows about sending
-- and adds
--   student_submit.send_paths(text, uuid, uuid, text)
--                                   the paths of this student's own unfinished send,
--                                   for the edge function's send-finish route
-- Each is the body it has after the files above (_send_begin and work are
-- Batch B's; send_finish is the fixes file's), with the lines under the
-- comments that say "ruling 106" or "ruling 107" added or changed and
-- nothing else. Owner, SECURITY DEFINER, search_path, volatility,
-- arguments and grants stay as they were (CREATE OR REPLACE keeps the owner
-- and the grants). Its only revoke and grant are send_paths' own: the
-- service role only, as every function in the schema.
--
-- GRADE MATH: none. DELETES DATA: no new path. A student's send onto the
-- teacher's pages deletes the teacher's work row once its pages have moved
-- (it then holds none), exactly as a Replace deletes the work it replaces;
-- no photo is deleted that a Replace would keep. No existing row is changed
-- and no table is touched.
--
-- ── What was wrong ──────────────────────────────────────────────────────────
-- 1. RULING 106 ("Let it finish and mark it late"). On a piece that stops
--    taking work on a date (After the Due Date set to Stop, or Until a
--    date), a send started on the last day and finished after midnight in
--    the class's time zone was refused (work_closed), though it was started
--    while the piece was taking work and the two hours it is given were not
--    up. The student lost the photos they had uploaded.
-- 2. RULING 107 ("I agree with the council"). After a student unsent work
--    the teacher had added pages to, the student's pages went, the teacher's
--    stayed, and the work stayed as the teacher's (sent_by teacher). From
--    then on the student could never send for that piece unless the teacher
--    deleted the work: a new send answered already_sent, a Replace and an
--    Unsend cannot_change. The same was true of work the teacher added
--    entirely with Add Work.
-- 3. A REVISION HANDED IN THROUGH THE WRONG DOOR (found in review, Nov 11;
--    so since C1). A revision's unfinished pages (version 2 or later, made
--    by Batch C's revision_start) given to send_finish instead of
--    revision_finish were handed in as ordinary work when nothing else was
--    in for the piece (the request stayed open and then read "being
--    graded"), and were dropped (already_sent) when version 1 was in.
--
-- ── What it does now ────────────────────────────────────────────────────────
-- 1. A SEND STARTED WHILE THE PIECE WAS OPEN CAN BE FINISHED WITHIN ITS TWO
--    HOURS, AND IS MARKED LATE (send_finish). A new send or a Replace.
--    How the database knows the send was started while the piece was open:
--    a student's unfinished send of version 1 is a row only _send_begin
--    makes (revision_start makes the others, version 2 and later, which
--    send_finish refuses: 3 below), and it
--    makes it only after _work_window said the piece was open, in the same
--    transaction, so the row's created_at (its first start; no function
--    changes it, a repeat of the start included) is a moment the piece was
--    open. That alone is not enough, because the teacher can change the
--    piece's dates while the send is uploading. So send_finish asks the
--    piece's dates as they are NOW about the day the send STARTED: the
--    calendar day of created_at in the class's time zone (the same
--    _fv_timezone(course.timezone) that _work_window uses) must not be
--    after the piece's last day (closes_on). Then:
--      - the last day ended while the photos went up: finished, Late;
--      - the teacher moved the last day to before the day the send
--        started: refused, work_closed, as before (the piece was closed on
--        that day by the teacher's own setting);
--      - a send started after the piece closed cannot exist (_send_begin
--        refuses it, work_closed, unchanged).
--    Everything else the finish asked is still asked, in the same order:
--    the session, the two hours (_work_hold from the first start, never
--    extended), the student not withdrawn, Send Work on, the piece taking
--    work, every page up, grading not started for a Replace, the 30 pages.
--    LATE: a send finished after the piece's last day is Late, whatever the
--    due date (on a piece set to stop on the due date the two are the same
--    day; on one taking work Until a date that is after the due date, it is
--    late already). Otherwise Late is what it was: finished after the due
--    date.
-- 2. A STUDENT CAN SEND PHOTOS THAT JOIN THE TEACHER'S PAGES (send_start,
--    then send_finish). When the work handed in for the piece is the
--    teacher's (left by an Unsend that kept the teacher's pages, or added
--    with Add Work) and is not Handed In on Paper, send_start no longer
--    answers already_sent: it starts a send, as for a piece with nothing
--    in. When it is finished, the student's new pages come first and the
--    teacher's follow, each keeping its file, in their order: the rule a
--    Replace follows (the teacher's pages are not the student's to remove).
--    The work is then the student's own, as after any send of theirs:
--    sent_by student, the student's note and Followed My Plan, Late or not
--    by the rule above, the card and request that sent it, and the version
--    of the work it joined. The teacher's pages stay marked as the
--    teacher's (added_by teacher), so a later Unsend or Replace removes
--    only the student's pages again. Asked at the start and again at the
--    finish, as for a Replace:
--      - grading started (ruling 83, and a page with the teacher's marks,
--        ruling 109, as Batch C's _grading_started has it): grading_started;
--      - the student's pages and the teacher's at most 30 (ruling 88):
--        too_many_pages, with the room left;
--      - Handed In on Paper: already_sent, as before (closed to the
--        student; Colin's ruling 107);
--      - a revision the teacher asked for is open (Batch C): already_sent,
--        as before. The student's way is Send My Revision, which keeps the
--        first version as it is.
--    The send is decided at the finish, not tied to the teacher's work at
--    the start (it is made as a new send, intent new, no target). So if the
--    teacher deletes their work meanwhile, the send is handed in as a
--    plain new send; if the teacher replaces their pages meanwhile (Replace
--    Them), the send joins the new pages; if the teacher marks it Handed In
--    on Paper meanwhile (after deleting it), the finish answers
--    already_sent and the pages are dropped, as before. The same holds for
--    a send started when nothing was in and finished after the teacher's
--    Add Work was handed in: it now joins the teacher's pages instead of
--    being dropped (already_sent). A teacher's unfinished Add as More Pages
--    on the work moves to the student's work, as after a Replace (the
--    fixes file); a teacher's unfinished Replace Them on it is dropped, as
--    after a Replace (Batch B, unchanged; a choice still open for Colin).
--    work() says so: sent.can_send is true when a send would be taken now.
--    A Replace (student_submit.replace) of the teacher's work still answers
--    cannot_change, and Unsend has nothing of the student's to remove: the
--    call is send_start.
-- 3. SEND_FINISH TAKES VERSION 1 ONLY. An unfinished send above version 1
--    is answered not_found (not one of send_finish's sends) before anything
--    else is asked, and nothing is changed: the send keeps its place and its
--    pages, and revision_finish (Send My Revision) can still hand it in. A
--    repeat of a finish that went through is answered replayed, as before.
--
-- What is the same, on purpose:
--   - The lock order: every call takes the class's lock first (_grade_return
--     _lock_first) and then only row locks under it; a repeated start with
--     the same request id makes nothing and gives the same send and the same
--     finish-by; a repeated finish answers replayed.
--   - Nobody, the teacher included, can open a student's unfinished send
--     (ruling 91): no function here hands its paths to anyone but the
--     edge function, for that student, and the storage policies are not
--     touched. A student can read the pages filed under their name, the
--     teacher's among them, as ruled (108).
--   - The teacher's side: Add Work, Add as More Pages, Replace Them,
--     Handed In on Paper and delete answer as they did. A teacher's Add
--     Work finished after a student's send is still answered already_sent.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless Batch C's revision_request table
-- exists and every function in the two lists below carries the fingerprint
-- (md5(pg_get_functiondef), PostgreSQL 17) it has once the files above are
-- applied: the three it replaces (or, on a second run, as this file leaves
-- them), the ones their new lines rely on, and six that pin Batch C as
-- tested, round 3 (C1's _revision_state, revision_start and revision_finish,
-- which decide what a version 2 is and when a revision is open; C1's
-- trigger function _revision_gone, which runs when send_finish's join
-- deletes a teacher's sent version 2 and then finds no open request to
-- settle; and C2's trigger functions _markup_on_return and
-- _markup_on_release; none is called here). So it stops on a database with
-- C1 and not C2, and on a Batch C other than the one tested.
-- The lists are written by
-- migrations/local-test/send_rules.py fingerprints, never by hand. Its last
-- step checks that the three are as this file leaves them, the others
-- untouched, and that every SECURITY DEFINER function in public,
-- student_submit and fv_private still names pg_temp last in its
-- search_path.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- None on any table. CREATE OR REPLACE FUNCTION waits only for another
-- uncommitted change to the same function; if it waits more than five
-- seconds the file gives up with nothing applied: run it again.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/send-rules-live-precheck.sql   expected: no rows.
-- migrations/local-test/send-rules-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/send-rules-undo.sql (not a migration; proved by
-- migrations/local-test/send_rules.py) puts the three functions back to the
-- bodies they had before this file, checked by fingerprint, drops
-- send_paths, and changes nothing else. It checks only those four, so it
-- runs with Batch C in or after Batch C's undo. Batch C's undo checks none
-- of this file's functions and drops revision_request, which the three
-- read: run in that order, the student's page fails until this undo runs.
-- So the order out is this undo first, then Batch C's, then the fixes',
-- then Batch B's (the fixes' undo and Batch B's PART 2 check fingerprints
-- of functions this file replaces, and refuse while it is applied).
-- Work handed in under this file stays as it is (a student's work holding
-- the teacher's pages is a shape a Replace already makes).
--
-- One transaction: the file opens with begin and ends with commit, so it is
-- all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first.
begin;

-- Give up after five seconds rather than queue behind a long call. If it
-- gives up, nothing is applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    if to_regclass('public.submission') is null or to_regclass('public.revision_request') is null then
        raise exception 'Batch B and Batch C are not both applied (public.submission, public.revision_request): apply them first. Nothing was changed.';
    end if;
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
            raise exception '% is not the definition this migration was written against (found %, expected %). Apply 2026111104, 2026111120 and 2026111121 first; a later migration may have replaced it. Nothing was changed.',
                _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- The one it adds: absent, or as this file leaves it (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/send_rules.py)
            ('student_submit.send_paths(text,uuid,uuid,text)', '2f36c08b8ace950b9c7eb905b320aa40')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists, and is not as this file leaves it (found %): something else made it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    -- What the new lines rely on, and Batch C as tested (C1's revision rules,
    -- C2's trigger function), as the files before this one leave it.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/send_rules.py)
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._grading_started(uuid,uuid)',                                          '13622bbca72904fdf877ce6b336dc6b4'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._session_class(text,uuid)',                                            '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '68665f35e1678f1bba64d30c082409d8'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'c8c5c26be1758ec2e07fe73a68731159'),
            ('public._fv_timezone(text)',                                                           '8dbcb5716f155e2441f47416a0b28527'),
            ('public._grade_return_lock_first(uuid)',                                               '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
            ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
            ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
            ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._revision_state(uuid)',                                                        '894bb53b0ad066e21f36c3a8038d5c6c'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',                  '43ca2e50ff067a4fb51762367895ee84'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',                           'a04e2d62a76b00a7f6ad03a76a0ede74'),
            ('public._revision_gone()',                                                             '13b5fb325c563a0475437829446ef089'),
            ('public._markup_on_return()',                                                          'ce8ceaa830617aa9caf935b161d7e379'),
            ('public._markup_on_release()',                                                         'a7e8838702d000c42621d72bf8621dfb')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;
end
$guard$;

-- ── 1. _send_begin ──────────────────────────────────────────────────────────
-- Batch B's body; a new send may start when the work in is the teacher's
-- and not on paper (ruling 107).
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
        -- Ruling 107: work the teacher handed in for the student (Add Work,
        -- or what an Unsend left of the teacher's pages) is not the end of
        -- the student's sending. Their new pages will join the teacher's, by
        -- the rule a Replace follows (send_finish). Closed as before: the
        -- student's own work (Replace is the way), work Handed In on Paper,
        -- and a piece with a revision open (Send My Revision is the way).
        if _sent.sent_by <> 'teacher' or _sent.on_paper
           or exists (select 1 from revision_request r
                       where r.assessment_id = _a.id and r.enrollment_id = p_enrollment_id and r.state = 'open') then
            return jsonb_build_object('ok', false, 'error', 'already_sent');
        end if;
        if _grading_started(p_enrollment_id, _a.id) then
            return jsonb_build_object('ok', false, 'error', 'grading_started');
        end if;
        -- The teacher's pages stay: with them the new pages must fit in 30.
        select count(*) into _theirs from submission_file f where f.submission_id = _sent.id and f.added_by = 'teacher';
        if _theirs + jsonb_array_length(p_pages) > 30 then
            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));
        end if;
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

-- ── 2. send_finish ──────────────────────────────────────────────────────────
-- The fixes file's body; a send started while the piece was open is taken
-- after its last day, marked Late (ruling 106); a new send joins the
-- teacher's pages (ruling 107).
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
    -- A revision's pages are Send My Revision's (revision_finish), never
    -- this function's. Only revision_start makes an unfinished send above
    -- version 1 (every send _send_begin makes is version 1 until it is
    -- handed in), so version is how it is told. Refused before anything else
    -- is asked, and nothing is changed: the send keeps its place and its
    -- pages, and revision_finish can still hand it in.
    if _sub.version <> 1 then
        return jsonb_build_object('ok', false, 'error', 'not_found');
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
    -- Ruling 106: a send started while the piece was open can be finished
    -- after its last day, within its two hours, and is marked Late below.
    -- "Started while open" is the piece's dates as they are now, asked of
    -- the day the send started (its first start, in the class's time zone,
    -- as _work_window counts days): a send started on the last day passes;
    -- a send the teacher closed under it, by moving the last day to before
    -- the day it started, does not.
    if not (_w->>'open')::boolean
       and ((_sub.created_at at time zone public._fv_timezone(_course.timezone))::date <= (_w->>'closes_on')::date) is not true then
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
    else
        -- Ruling 107: a new send for a piece whose work in is the teacher's
        -- (not on paper) joins the teacher's pages, by the rule a Replace
        -- follows, whether that work was there when the send started or
        -- was handed in while its pages went up. Every other work in is
        -- answered as before. (A revision's pages never come here: refused
        -- above.)
        select * into _target from submission
         where assessment_id = _sub.assessment_id and enrollment_id = p_enrollment_id and state = 'sent'
         order by version desc limit 1
           for update;
        if found then
            if _target.sent_by <> 'teacher' or _target.on_paper
               or exists (select 1 from revision_request r
                           where r.assessment_id = _sub.assessment_id and r.enrollment_id = p_enrollment_id and r.state = 'open') then
                -- The teacher added this student's work while the pages were going up.
                perform set_config('fv.work_removal_reason', 'abandoned', true);
                delete from submission where id = _sub.id;
                perform set_config('fv.work_removal_reason', '', true);
                return jsonb_build_object('ok', false, 'error', 'already_sent');
            end if;
            if _grading_started(p_enrollment_id, _sub.assessment_id) then
                -- As for a Replace: what was sent stays; the new pages are dropped.
                perform set_config('fv.work_removal_reason', 'abandoned', true);
                delete from submission where id = _sub.id;
                perform set_config('fv.work_removal_reason', '', true);
                return jsonb_build_object('ok', false, 'error', 'grading_started');
            end if;
            -- As for a Replace (ruling 88): with the teacher's pages, 30 at
            -- most. The send stays; finish it with fewer pages or start again.
            select count(*) into _theirs from submission_file f where f.submission_id = _target.id and f.added_by = 'teacher';
            if _theirs + jsonb_array_length(p_files) > 30 then
                return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));
            end if;
        end if;
    end if;

    _pages := public._work_settle_files(_sub.id, p_files);
    if _target.id is not null then
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
    -- Late: finished after the due date, or (ruling 106) after the piece's
    -- last day.
    update submission
       set state = 'sent', intent = 'new', target_id = null, version = coalesce(_target.version, version),
           is_late = (_w->>'late')::boolean or (_w->>'open')::boolean is false, sent_at = now(), updated_at = now()
     where id = _sub.id
    returning * into _sub;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _sub.id, 'sent_at', _sub.sent_at,
                              'late', _sub.is_late,
                              'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
end;
$function$;

-- ── 3. work ─────────────────────────────────────────────────────────────────
-- Batch B's body; sent.can_send says a send would join the teacher's pages
-- (ruling 107).
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

-- ── 4. send_paths (approved by Colin, Nov 11; its own commit) ──────────────
-- A read for the edge function's send-finish route, which must read every
-- page before it calls send_finish and may give Storage only paths the
-- database named in that request (batch-b-contract.md, duties 1 and 7).
-- send_finish names no path, and the phone is not trusted to say them; the
-- route's builder (PR 1086) got them by sending the start again. This gives
-- them without making or dropping anything: the pages of THIS student's OWN
-- unfinished send, by its id, exactly as _work_upload_json gives them to the
-- start ({ file_id, page, path, thumb_path }). Nothing for a send that is
-- another student's, the teacher's, handed in, or past its two hours, and
-- nothing for a session that may not send (_send_session: a locked card,
-- a class whose page is off). It writes nothing and takes no lock. The
-- service role only, as every function in the schema is.
--   { ok: true, submission_id, assessment_id, version, finish_by, bucket, files: [...] }
--   { ok: false, error: <a session error> | 'not_found' | 'expired' }
create or replace function student_submit.send_paths(
    p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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
revoke all on function student_submit.send_paths(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.send_paths(text, uuid, uuid, text) to service_role;

-- ── Everything is as the header says ────────────────────────────────────────
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
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/send_rules.py)
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._grading_started(uuid,uuid)',                                          '13622bbca72904fdf877ce6b336dc6b4'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._session_class(text,uuid)',                                            '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '68665f35e1678f1bba64d30c082409d8'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'c8c5c26be1758ec2e07fe73a68731159'),
            ('public._fv_timezone(text)',                                                           '8dbcb5716f155e2441f47416a0b28527'),
            ('public._grade_return_lock_first(uuid)',                                               '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
            ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
            ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
            ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._revision_state(uuid)',                                                        '894bb53b0ad066e21f36c3a8038d5c6c'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',                  '43ca2e50ff067a4fb51762367895ee84'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',                           'a04e2d62a76b00a7f6ad03a76a0ede74'),
            ('public._revision_gone()',                                                             '13b5fb325c563a0475437829446ef089'),
            ('public._markup_on_return()',                                                          'ce8ceaa830617aa9caf935b161d7e379'),
            ('public._markup_on_release()',                                                         'a7e8838702d000c42621d72bf8621dfb')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% changed while this migration ran (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/send_rules.py)
            ('student_submit.send_paths(text,uuid,uuid,text)', '2f36c08b8ace950b9c7eb905b320aa40')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
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
