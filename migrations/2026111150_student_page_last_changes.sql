-- Batch E, the last database change of the student page build (2026-11-11).
-- Student page build plan S2, S4-F4, S9 to S12; DECISIONS, "Student page
-- build rulings (2026-11-10, night)" 2; the reviews of PR 1086 (M2) and PR
-- 1138 (S1, S3, S4). Colin, Nov 11: "'waiting for a database change' is
-- very frustrating. Can't you just make those changes?"
--
-- THIS FILE DELETES NOTHING. It writes no grade, score, comment or Mark Up
-- row on the apply. It adds two columns to grade_return, one table, seven
-- functions, and replaces twelve.
--
-- What changes, for a teacher or a student:
--
-- E1  The student page knows whether a class has Reflect on Feedback on
--     without asking for it: student_submit.work also says
--     reflect_on_feedback. The page then asks for feedback when Send Work
--     or Reflect is on, and a class with Reflect on and Send Work off gets
--     its Reflect button.
--
-- E2  Questionnaires and phone reports open from the student's card (plan
--     S4-F4). A card's Questionnaires and My Reports tabs list, for that
--     class:
--       - each questionnaire the teacher issued this student a slip for
--         (a slip not taken back) or that they have answered, while it is
--         open, not yet open, or answered (a closed one never answered is
--         left out);
--       - each phone report the teacher sent this student (Sent to Phones),
--         until it is closed or past its last day.
--     Four functions, each for the card's own session and class only:
--       student_submit.forms   the two lists (read-only)
--       student_submit.form    the questionnaire to answer, as a slip's
--                              verify gives it (read-only)
--       student_submit.answer  the answers, written as a slip's submit
--                              writes them; once: a second send is
--                              already_sent, and the student's unused slips
--                              for it are marked used
--       student_submit.report  the phone report, as a slip's check gives it;
--                              marks it opened for Sent to Phones
--     The slip's own functions (open, verify, check, submit) are not
--     touched: printed slips work as before. A slip used first makes the
--     card's answer already_sent, and an answer from the card makes the slip
--     used.
--
-- E3  A Note for the Report waits with its grade (DECISIONS, rulings of
--     2026-11-10, night, 2). Under When I Return Them, while a regrade of a
--     returned grade is open (a draft), reports print the note the returned
--     grade went out with; the new note prints once the regrade is
--     returned. grade_return gains held_note and held_note_at: the first
--     note change while such a draft is open keeps the note as it was,
--     with the returned date it belongs to (fv_private.report_note_hold,
--     called by save_score_report_note before it writes). The kept note
--     counts only while the row is a draft and its returned date is still
--     that one, so a Return ends it without writing anything: no trigger
--     and no grade function changes. list_course_grade_returns sends it
--     then. Students never see a Note for the Report (unchanged). No grade
--     math changes; calc.js is not touched.
--
-- E4  A piece the teacher returned and then dated into the future (hidden
--     from students) stops serving its marks and its page links:
--     student_submit.markup answers not_found, and file_links and
--     group_file_links name no page, as feedback and page already leave it
--     out. By the class's own calendar.
--
-- E5  Group work: a group-mate who is Missing or Excused on the piece has
--     their marks (and the teacher's notes on their pages) kept from the
--     rest of the group, in markup and in feedback's counts. Their pages
--     still show; the student's own marks are as before.
--
-- E6  Limits, per card, counted in student_submit.write_log before the
--     class's lock is taken: thirty reflect and reply writes an hour, sixty
--     answer_seen, ten questionnaire answers, and twenty finishes an hour
--     (send_paths counts each send-finish or revise-finish that will read
--     the pages: the cross-call count review M2 asked for). Past one, the
--     answer is too_many with retry_after_s, as the send limit's is. Rows
--     older than a day are cleared by the next call.
--
-- E7  (slips moving to the card key, plan S3-S1) is its own migration and
--     PR (2026111160), applied after this one: it replaces the four live slip
--     functions and moves slip printing to an edge function.
-- E8  (links of 60 seconds) is the edge function's alone: nothing here.
--
-- E9  My Learning on the student's own device (plan S13-W1;
--     my-learning-contract.md). When a class has Show My Learning on,
--     student_submit.page also sends show_my_learning: true and learning:
--     the class's calculation settings and grading style (twelve course
--     columns), its categories with their weights, its folders and its
--     learning map (sections not removed, each skill with its I Can text
--     and bank id), in get_class_bundle's shapes; and each piece its
--     category_id, and this student's own hand-set levels (section
--     overrides: level and date, not the teacher's reason). The student's
--     returned grades are already on the page.
--     Nothing of another student, no draft, no teacher-only note. With it
--     off the answer is the same as before, byte for byte.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless Batch D is applied and every
-- function it relies on or replaces is the definition it was tested
-- against (md5 of pg_get_functiondef on PostgreSQL 17; the lists below,
-- written by migrations/local-test/batch_e.py fingerprints), or, on a
-- second run, as this file leaves it; and none of its new names is taken by
-- something else.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- Adding the two columns to grade_return takes its lock for an instant (no
-- rewrite: both are null). If a long transaction holds it, the file gives up
-- after five seconds with nothing applied: run it again.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/batch-e-live-precheck.sql   expected: no rows.
-- migrations/local-test/batch-e-live-postcheck.sql  expected: no rows.
-- After this file, Batch D's post-check lists student_submit.work and
-- send_paths as changed (this file replaces them), and C1's lists the
-- student functions it replaces: expected, not a fault.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/batch-e-undo.sql (proved by batch_e.py undo) puts
-- every replaced function back word for word and drops what this file made,
-- the two columns and write_log included (the kept notes and the counts go
-- with them; no grade or answer does). Answers sent from a card stay: they
-- are the student's answers, as a slip's are.
--
-- One transaction: all or nothing. Every check that can stop it runs first.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    if to_regprocedure('public.photo_removal_call()') is null or to_regclass('public.markup_kept') is null then
        raise exception 'Batch D (2026111140_photo_lifecycle.sql) is not applied: apply it first. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/batch_e.py)
            ('student_submit._session_class(text,uuid)',              '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit._send_session(text,uuid)',               'c39242f54850eeeada19945ac8123644'),
            ('student_submit._group_members(uuid,uuid)',              'b38b1af6f2dc142c94ce1cca454fd0fb'),
            ('student_submit._grading_started(uuid,uuid)',            '586a6a0b5910e6c153b72e73a5b672bc'),
            ('student_submit._work_window(uuid)',                     '767795b7835e3c4d6cb628c76df8e6eb'),
            ('public._grade_return_lock_first(uuid)',                 '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._fv_timezone(text)',                             '8dbcb5716f155e2441f47416a0b28527'),
            ('public._work_hold()',                                   'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_bucket()',                                 '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_upload_json(uuid)',                        '63982ca7888b11ce9b80e962f674c98a'),
            ('public._revision_state(uuid)',                          '894bb53b0ad066e21f36c3a8038d5c6c'),
            ('public._grade_copy_in_use(jsonb,uuid)',                 'befe9f034ce927b2abdf8c8825c402bd'),
            ('student_submit._closed_reason(questionnaire,text)',     '118a059d7d73c56cc15bf07ff17c9389'),
            ('student_submit._part(uuid)',                            'b008fc4bee310de623de95e0296678f7'),
            ('student_submit._clean_answer(text,jsonb,text[],jsonb)', '0f8377c8b45d14bc5c1b93c04852e49d'),
            ('public.fv_owns_enrollment(uuid)',                       '728526648388367393162be706f7f9ea'),
            ('public.fv_idem_check(uuid,text)',                       '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)',                 '6d0b48c458d273a332db39e1a4b68626'),
            ('student_submit.open(text,text)',                        'd11b2e67cbf10cae4d44ae6082fd8e01'),
            ('student_submit.verify(text,text,text,text,text)',       '901e62bdb5d94a9ffcebe33563425ad7'),
            ('student_submit."check"(text,text,text)',                'cc54e80ca585024c65926cb5e73f3f43'),
            ('student_submit.submit(text,jsonb,text)',                '90ace3c164dab19f6a77ba7dfb19e40e'),
            ('student_submit._payload(uuid)',                         '7382a387265a87a32c6e4f22f0b1a898')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). A later migration may have replaced it. Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;
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
            ('public.list_course_grade_returns(uuid)',               'bc5529a69303cdfe8d91604388dc927a', '0779f1e345fb278fd8702592163784c1'),
            ('student_submit.page(text,uuid,text)',                  '034e6674a25f8a5e1abc067f50784ce6', '2f1795ba4c5416788d477a540b49fccb')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
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
            raise exception '% already exists, and is not as this file leaves it (found %): something else made it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if (select count(*) from pg_attribute where attrelid = 'public.grade_return'::regclass and not attisdropped
         and attname in ('held_note', 'held_note_at')) = 1 then
        raise exception 'grade_return has one of held_note and held_note_at, not both: something else made it. Nothing was changed.';
    end if;
end
$guard$;

-- ── Tables ──────────────────────────────────────────────────────────────────
-- E6: one row each time a card is counted for a limit.
create table if not exists student_submit.write_log (
    id      bigint      generated always as identity primary key,
    card_id uuid        not null,
    kind    text        not null check (kind in ('reflect', 'seen', 'finish', 'answer')),
    at      timestamptz not null default now()
);
create index if not exists write_log_card_kind_at on student_submit.write_log (card_id, kind, at);
create index if not exists write_log_at on student_submit.write_log (at);
comment on table student_submit.write_log is
    'One row each time a card is counted for a per-card limit (Batch E, E6): reflect and reply, answer_seen, a finish opened by send_paths, a questionnaire answer. Rows older than a day are removed by the next call.';
alter table student_submit.write_log enable row level security;
revoke all on table student_submit.write_log from public, anon, authenticated;
revoke all on sequence student_submit.write_log_id_seq from public, anon, authenticated;

-- E3: the Note for the Report a returned grade went out with, kept while a regrade is open.
alter table public.grade_return add column if not exists held_note text;
alter table public.grade_return add column if not exists held_note_at timestamptz;
comment on column public.grade_return.held_note is
    'Batch E, E3: the Note for the Report as it was when a regrade of the returned grade began (null: no note). Counts only while is_draft and held_note_at = returned_at.';
comment on column public.grade_return.held_note_at is
    'Batch E, E3: the returned_at held_note belongs to.';

-- ── Functions ───────────────────────────────────────────────────────────────

-- ── E6: the per-card count ────────────────────────────────────────────────────
create or replace function student_submit._write_limit(p_card_id uuid, p_kind text, p_per_hour integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _n      int;
    _oldest timestamptz;
begin
    delete from write_log where at < now() - interval '1 day';
    select count(*), min(at) into _n, _oldest
      from write_log where card_id = p_card_id and kind = p_kind and at > now() - interval '1 hour';
    if _n >= p_per_hour then
        return jsonb_build_object('ok', false, 'error', 'too_many',
                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));
    end if;
    insert into write_log (card_id, kind) values (p_card_id, p_kind);
    return null;
end;
$function$;

-- ── E1: work says whether Reflect on Feedback is on ───────────────────────────
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
        -- E1: the page asks feedback when Send Work or Reflect on Feedback is on
        'reflect_on_feedback', _course.reflect_on_feedback,
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

-- ── E6: send_paths counts each finish it opens ────────────────────────────────
create or replace function student_submit.send_paths(
    p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in  jsonb;
    _sub submission%rowtype;
    _no  jsonb;
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
    -- E6: each finish the function will read files for counts, twenty an
    -- hour for a card (send-finish and revise-finish together).
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'finish', 20);
    if _no is not null then
        return _no;
    end if;
    return jsonb_build_object('ok', true, 'submission_id', _sub.id, 'assessment_id', _sub.assessment_id,
                              'version', _sub.version, 'finish_by', _sub.created_at + public._work_hold(),
                              'bucket', public._work_bucket(), 'files', public._work_upload_json(_sub.id));
end;
$function$;

-- ── E4 and E5: markup ─────────────────────────────────────────────────────────
create or replace function student_submit.markup(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _a      assessment%rowtype;
    _course course%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- E4: a piece dated in the future is not on the student's page: nothing of it is served
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date);
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
           and m.enrollment_id = any (coalesce(_group_members(_a.id, p_enrollment_id), array[p_enrollment_id]))
           -- E5: a group-mate who is Missing or Excused on the piece: their marks are not the group's
           and (m.enrollment_id = p_enrollment_id
                or not exists (select 1 from score s where s.enrollment_id = m.enrollment_id and s.assessment_id = _a.id
                                                       and s.status in ('NS', 'EXC')))), '[]'::jsonb));
end;
$function$;

-- ── E5: feedback's counts ─────────────────────────────────────────────────────
create or replace function student_submit.feedback(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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
                             -- E5: a group-mate who is Missing or Excused on the piece: their marks are not the group's
                             and (m.enrollment_id = p_enrollment_id
                                  or not exists (select 1 from score gs where gs.enrollment_id = m.enrollment_id
                                                                       and gs.assessment_id = a.id and gs.status in ('NS', 'EXC')))
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

-- ── E4: group_file_links ──────────────────────────────────────────────────────
create or replace function student_submit.group_file_links(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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
               and s.enrollment_id = any (coalesce(_group_members(p_assessment_id, p_enrollment_id), array[p_enrollment_id]))
               -- E4: a piece dated in the future is not on the student's page: no link for its pages
               and exists (select 1 from assessment a join course c on c.id = a.course_id
                             where a.id = p_assessment_id
                               and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date))), '[]'::jsonb));
end;
$function$;

-- ── E4: file_links ────────────────────────────────────────────────────────────
create or replace function student_submit.file_links(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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
               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'
               -- E4: a piece dated in the future is not on the student's page: no link for its pages
               and exists (select 1 from assessment a join course c on c.id = a.course_id
                             where a.id = p_assessment_id
                               and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date))), '[]'::jsonb));
end;
$function$;

-- ── E6: reflect ───────────────────────────────────────────────────────────────
create or replace function student_submit.reflect(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reflection jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _no    jsonb;
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
    -- E6: thirty reflections and replies an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'reflect', 30);
    if _no is not null then
        return _no;
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

-- ── E6: reply ─────────────────────────────────────────────────────────────────
create or replace function student_submit.reply(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reply jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _no    jsonb;
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
    -- E6: thirty reflections and replies an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'reflect', 30);
    if _no is not null then
        return _no;
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

-- ── E6: answer_seen ───────────────────────────────────────────────────────────
create or replace function student_submit.answer_seen(
    p_session_token text, p_enrollment_id uuid, p_assessment_ids uuid[], p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _n  int;
    _no jsonb;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- E6: sixty an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'seen', 60);
    if _no is not null then
        return _no;
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

-- ── E3: the kept note ─────────────────────────────────────────────────────────
create or replace function fv_private.report_note_hold(p_enrollment_id uuid, p_assessment_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    update grade_return g
       set held_note = (select s.report_note from score s
                         where s.enrollment_id = g.enrollment_id and s.assessment_id = g.assessment_id),
           held_note_at = g.returned_at
     where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
       and g.is_draft and g.returned_at is not null
       and g.held_note_at is distinct from g.returned_at
       and fv_owns_enrollment(p_enrollment_id);
$function$;

-- ── E3: save_score_report_note keeps it first ─────────────────────────────────
create or replace function public.save_score_report_note(p_enrollment_id uuid, p_assessment_id uuid, p_note text, p_idempotency_key uuid default null::uuid)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
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
    -- E3: a regrade of a returned grade is open (a draft): the note the
    -- returned grade went out with is kept beside it before this change, so
    -- reports print that one until the regrade is returned.
    perform fv_private.report_note_hold(p_enrollment_id, p_assessment_id);
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

-- ── E3: list_course_grade_returns sends it ────────────────────────────────────
create or replace function public.list_course_grade_returns(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
    select coalesce(jsonb_object_agg(x.assessment_id::text, x.students), '{}'::jsonb)
      from (select g.assessment_id,
                   jsonb_object_agg(g.enrollment_id::text, jsonb_strip_nulls(jsonb_build_object(
                       'is_draft', g.is_draft, 'returned_at', g.returned_at, 'updated_at', g.updated_at,
                       'returned_copy', g.returned_copy, 'previous_copy', g.previous_copy,
                       -- E3: the Note for the Report the returned grade went out with, while a
                       -- regrade of it is open (sent only then; held_note null is an empty note)
                       'held_note_at', case when g.is_draft and g.returned_at is not null and g.held_note_at = g.returned_at
                                            then g.held_note_at end,
                       'held_note', case when g.is_draft and g.returned_at is not null and g.held_note_at = g.returned_at
                                         then g.held_note end))) as students
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

-- ── E2: questionnaires and phone reports from the card ────────────────────────
-- Whether a questionnaire is this student's: the teacher issued them a slip
-- for it (one not taken back), or they have answered it.
create or replace function student_submit._card_listed(p_questionnaire_id uuid, p_enrollment_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select exists (select 1 from student_access_code c
                    where c.questionnaire_id = p_questionnaire_id and c.enrollment_id = p_enrollment_id
                      and c.revoked_at is null)
        or exists (select 1 from response r
                    where r.questionnaire_id = p_questionnaire_id and r.enrollment_id = p_enrollment_id);
$function$;

-- The Questionnaires and My Reports tabs for one class of the session (E2,
-- plan S4-F4). Read-only.
--   questionnaires: each of this student's (_card_listed) that is open, not
--     yet open, or answered. A questionnaire closed and never answered is
--     left out.
--   reports: each phone report the teacher sent this student (Sent to
--     Phones) that is not closed and not past its last day, with what the
--     slip's report shows on the tab: the overall result and the comment.
create or replace function student_submit.forms(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'questionnaires', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', x.id, 'title', x.title, 'description', x.theme, 'minutes', null,
                       'state', x.state, 'opens_on', x.opens_on, 'closes_on', x.closes_on, 'sent_at', x.sent_at)
                     order by x.opens_on nulls first, x.created_at, x.id)
              from (select q.id, q.title, q.theme, q.opens_on, q.closes_on, q.created_at, r.sent_at,
                           case when r.sent_at is not null then 'sent'
                                when _closed_reason(q, _course.timezone) is null then 'open'
                                when _closed_reason(q, _course.timezone) = 'not_open_yet' then 'not_open_yet' end as state
                      from questionnaire q
                      cross join lateral (select max(x.submitted_at) as sent_at from response x
                                           where x.questionnaire_id = q.id and x.enrollment_id = p_enrollment_id) r
                     where q.course_id = _course.id and q.parent_id is null and q.kind <> 'goal_checkin'
                       and _card_listed(q.id, p_enrollment_id)) x
             where x.state is not null), '[]'::jsonb),
        'reports', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'title', coalesce(r.term_label, 'Report ' || r.term),
                       'issued_at', r.issued_at, 'expires_on', r.expires_on,
                       'opened_at', (select min(c.opened_at) from student_access_code c
                                      where c.phone_report_id = r.id and c.enrollment_id = p_enrollment_id),
                       'overall', s.data->'overall', 'comment', s.data->'comment')
                     order by r.issued_at desc, r.id)
              from phone_report r
              join phone_report_student s on s.report_id = r.id and s.enrollment_id = p_enrollment_id
             where r.course_id = _course.id and r.closed_at is null and _today <= r.expires_on), '[]'::jsonb));
end;
$function$;

-- Start a questionnaire from the card (E2): what the slip's verify gives,
-- the questionnaire and its open Goal Check-In, for this student only.
-- Answers { ok, parts, context }; not_found (not this student's, or not
-- this class's), already_sent, closed, not_open_yet (with opens_on). A
-- locked card may not (card_locked), as it may not send.
create or replace function student_submit.form(p_session_token text, p_enrollment_id uuid, p_questionnaire_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb;
    _course course%rowtype;
    _q      questionnaire%rowtype;
    _child  questionnaire%rowtype;
    _why    text;
    _parts  jsonb;
    _ctx    jsonb;
begin
    if p_questionnaire_id is null then
        raise exception 'a questionnaire is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    select * into _q from questionnaire
     where id = p_questionnaire_id and course_id = _course.id and parent_id is null and kind <> 'goal_checkin';
    if _q.id is null or not _card_listed(_q.id, p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if exists (select 1 from response r where r.questionnaire_id = _q.id and r.enrollment_id = p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        return jsonb_build_object('ok', false, 'error', _why, 'opens_on', _q.opens_on);
    end if;
    -- As _payload builds them for a slip.
    _parts := jsonb_build_array(_part(_q.id));
    for _child in
        select * from questionnaire
         where parent_id = _q.id and kind = 'goal_checkin' and is_on
         order by created_at
    loop
        if _closed_reason(_child, _course.timezone) is null then
            _parts := _parts || jsonb_build_array(_part(_child.id));
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(_parts) p where p->>'kind' = 'goal_checkin') then
        select jsonb_build_object('course_goal', jsonb_build_object('text', a.value_text, 'at', r.submitted_at))
          into _ctx
          from answer a
          join question x on x.id = a.question_id
          join response r on r.id = a.response_id
          join questionnaire q2 on q2.id = r.questionnaire_id
         where r.enrollment_id = p_enrollment_id and q2.course_id = _q.course_id
           and x.repeated_key = 'better_at' and nullif(btrim(a.value_text), '') is not null
         order by r.submitted_at desc
         limit 1;
    end if;
    return jsonb_build_object('ok', true, 'parts', _parts, 'context', coalesce(_ctx, '{}'::jsonb));
end;
$function$;

-- Send a questionnaire's answers from the card (E2). The checks and the
-- writes are submit's for a slip: the parts the questionnaire opens now,
-- each answer cleaned by _clean_answer, a response per part (via 'link',
-- as the student's own device), Core Competency levels kept for the term.
-- Once: a second send answers already_sent, and any slip of this student's
-- for it still unused is marked used, so a printed slip cannot send it a
-- second time either. Ten an hour for a card.
-- Answers { ok, submitted_at }; the session refusals and card_locked;
-- not_found; already_sent; closed; not_open_yet; invalid (with
-- question_id where one question is wrong); empty; too_many.
create or replace function student_submit.answer(
    p_session_token text, p_enrollment_id uuid, p_questionnaire_id uuid, p_answers jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb;
    _no      jsonb;
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
begin
    if p_questionnaire_id is null then
        raise exception 'a questionnaire is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'answer', 10);
    if _no is not null then
        return _no;
    end if;
    -- One send at a time for this student: a second tap waits, then finds the first.
    perform 1 from enrollment where id = p_enrollment_id for update;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    select * into _q from questionnaire
     where id = p_questionnaire_id and course_id = _course.id and parent_id is null and kind <> 'goal_checkin';
    if _q.id is null or not _card_listed(_q.id, p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if exists (select 1 from response r where r.questionnaire_id = _q.id and r.enrollment_id = p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        return jsonb_build_object('ok', false, 'error', _why);
    end if;
    if jsonb_typeof(p_answers) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(p_answers)) > 80
       or octet_length(p_answers::text) > 100000 then
        return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;

    -- From here, submit's own checks and writes, word for word but for the slip.
    select array_agg(id) into _parts from (
        select _q.id as id
        union all
        select g.id from questionnaire g
         where g.parent_id = _q.id and g.kind = 'goal_checkin' and g.is_on
           and _closed_reason(g, _course.timezone) is null
    ) p;

    for _qid, _val in select * from jsonb_each(p_answers) loop
        if _qid !~ '^[0-9a-fA-F-]{36}$' then
            return jsonb_build_object('ok', false, 'error', 'invalid');
        end if;
        select * into _x from question
         where id = _qid::uuid and not archived and questionnaire_id = any(_parts);
        if not found then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end if;
        begin
            _clean := _clean_answer(_x.kind, _x.options, _x.core_ids, _val);
        exception when others then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'question_id', _qid);
        end;
        if _clean is not null then
            _clean_by_part := jsonb_set(_clean_by_part, array[_x.questionnaire_id::text],
                coalesce(_clean_by_part->(_x.questionnaire_id::text), '{}'::jsonb)
                  || jsonb_build_object(_x.id::text, _clean || jsonb_build_object('kind', _x.kind)));
        end if;
    end loop;
    if _clean_by_part = '{}'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'empty');
    end if;

    _term := case when _q.report_period is not null
                   and jsonb_typeof(_course.reporting_terms) = 'array'
                   and jsonb_array_length(_course.reporting_terms) > 0
                  then 'T' || _q.report_period else '' end;

    foreach _part in array _parts loop
        if not (_clean_by_part ? _part::text) then continue; end if;
        insert into response (questionnaire_id, enrollment_id, via, submitted_at)
        values (_part, p_enrollment_id, 'link', _now)
        returning id into _rid;
        for _qid, _val in select * from jsonb_each(_clean_by_part->(_part::text)) loop
            insert into answer (response_id, question_id, value_num, value_text, value_json)
            values (_rid, _qid::uuid, (_val->>'num')::numeric, _val->>'text', _val->'json');
            if _val->>'kind' = 'scale4' and _val->'json' ? 'levels' then
                for _core, _lvl in select * from jsonb_each(_val->'json'->'levels') loop
                    insert into core_self_assessment (enrollment_id, core_id, term_key, level, body)
                    values (p_enrollment_id, _core, _term, (_lvl #>> '{}')::int,
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

    -- A slip of this student's for it, not yet used, can no longer send it.
    update student_access_code set used_at = _now
     where questionnaire_id = _q.id and enrollment_id = p_enrollment_id and used_at is null and revoked_at is null;
    return jsonb_build_object('ok', true, 'submitted_at', _now);
end;
$function$;

-- See Your Report from the card (E2): the phone report the teacher sent
-- this student, as the slip's check gives it once the birthday matches; the
-- card's identity check stands in for the birthday. Marks it opened on the
-- student's slips for it (Sent to Phones reads opened from those). A
-- locked card may read it, as it may read its page.
-- Answers { ok, report }; the session refusals; not_found; report_closed.
create or replace function student_submit.report(p_session_token text, p_enrollment_id uuid, p_report_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _r      phone_report%rowtype;
    _course course%rowtype;
    _data   jsonb;
begin
    if p_report_id is null then
        raise exception 'a report is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _r from phone_report where id = p_report_id and course_id = (_in->>'course_id')::uuid;
    select data into _data from phone_report_student where report_id = _r.id and enrollment_id = p_enrollment_id;
    if _r.id is null or _data is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _course from course where id = _r.course_id;
    if _r.closed_at is not null
       or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
        return jsonb_build_object('ok', false, 'error', 'report_closed');
    end if;
    update student_access_code set opened_at = coalesce(opened_at, now())
     where phone_report_id = _r.id and enrollment_id = p_enrollment_id;
    return jsonb_build_object('ok', true, 'report', _data);
end;
$function$;

-- ── E9: page sends My Learning when the class shows it ────────────────────────
-- As 2026111103 made it, with E9 (plan S13-W1; my-learning-contract.md): when
-- the class has Show My Learning on, page also sends show_my_learning: true
-- and learning (the class's calculation settings, categories, folders and
-- learning map, in get_class_bundle's shapes, without a tag's source_text),
-- and each assessments[] item its category_id. With it off nothing is added:
-- the answer is the same jsonb as before. Every other line is as it was.
create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb := _session_class(p_session_token, p_enrollment_id);
    _course  course%rowtype;
    _today   date;
    _weights numeric;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    -- What the class's category weights total: 100, or null with no categories.
    select sum(k.weight) into _weights from category k where k.course_id = _course.id;

    return jsonb_build_object(
        'ok', true, 'v', 1,
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent,
            -- The name the class's teacher signed up with, and nothing else of theirs.
            'teacher_name', (select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code,
                                                                   'i_can', to_jsonb(t.i_can_statements)))
              from tag t join section s on s.id = t.section_id
             where s.course_id = _course.id and s.removed_at is null), '{}'::jsonb),
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'name', r.name, 'style', r.style,
                       'criteria', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'id', cr.id, 'name', cr.name, 'weight', cr.weight,
                                      'level_1_value', cr.level_1_value, 'level_2_value', cr.level_2_value,
                                      'level_3_value', cr.level_3_value, 'level_4_value', cr.level_4_value,
                                      'level_1_descriptor', cr.level_1_descriptor, 'level_2_descriptor', cr.level_2_descriptor,
                                      'level_3_descriptor', cr.level_3_descriptor, 'level_4_descriptor', cr.level_4_descriptor,
                                      -- The competencies this row counts toward, only those still on the class.
                                      'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                             from criterion_tag x
                                                             join tag t on t.id = x.tag_id
                                                             join section s on s.id = t.section_id
                                                            where x.criterion_id = cr.id
                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),
                                      'checks', coalesce((
                                          select jsonb_agg(jsonb_build_object('id', ck.id, 'level', ck.level, 'label', ck.label)
                                                           order by ck.level, ck.display_order, ck.id)
                                            from criterion_check ck where ck.criterion_id = cr.id), '[]'::jsonb))
                                    order by cr.display_order, cr.id)
                             from criterion cr where cr.rubric_id = r.id), '[]'::jsonb)) order by r.id)
              from rubric r
             where r.course_id = _course.id
               and exists (select 1 from assessment a where a.rubric_id = r.id
                              and (a.date_assigned is null or a.date_assigned <= _today))), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', a.id, 'title', a.title, 'date', a.date_assigned, 'due_date', a.due_date,
                           'score_mode', a.score_mode, 'max_points', a.max_points, 'weight', a.weight,
                           'rubric_id', a.rubric_id, 'created_at', a.created_at,
                           'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                  from assessment_tag x
                                                  join tag t on t.id = x.tag_id
                                                  join section s on s.id = t.section_id
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb),
                           'description', nullif(a.description, ''),
                           'module_name', (select m.name from module m where m.id = a.module_id and m.course_id = _course.id),
                           'category_name', k.name,
                           -- What the category counts toward the course grade as the class is set
                           -- up, or null where no percent would be true (the header says when).
                           'category_percent', case when a.score_mode = 'dibels' then null
                                                    when k.weight = 0 then 0
                                                    when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight
                                               end,
                           -- The Ministry's seven, in its order, named as shared/constants.js names them.
                           'core_competencies', coalesce((
                               select jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.ord)
                                 from (values (1, 'COM', 'Communicating'),
                                              (2, 'COL', 'Collaborating'),
                                              (3, 'CT',  'Creative Thinking'),
                                              (4, 'CRT', 'Critical & Reflective Thinking'),
                                              (5, 'PPI', 'Personal & Cultural Identity'),
                                              (6, 'PAR', 'Personal Awareness & Responsibility'),
                                              (7, 'SAR', 'Social Awareness & Responsibility')) as cc(ord, id, name)
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb))
                       -- E9: the piece's category id, only when Show My Learning is on
                       || case when _course.show_my_learning then jsonb_build_object('category_id', k.id) else '{}'::jsonb end
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
              left join category k on k.id = a.category_id and k.course_id = _course.id
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb))
        -- E9: Show My Learning on: the class's own settings, categories, folders and learning map
        -- (get_class_bundle's shapes; no tag source_text). Off: nothing is added.
        || case when _course.show_my_learning then jsonb_build_object(
               'show_my_learning', true,
               'learning', jsonb_build_object(
                   -- E9: the twelve calculation and grading-style columns of course, and no other
                   'course', jsonb_build_object(
                       'grading_system', _course.grading_system, 'calc_method', _course.calc_method,
                       'decay_weight', _course.decay_weight, 'recent_score_limit', _course.recent_score_limit,
                       'grading_scale', _course.grading_scale, 'category_weights', _course.category_weights,
                       'round_percent', _course.round_percent, 'level_order', _course.level_order,
                       'reporting_terms', _course.reporting_terms, 'timezone', _course.timezone,
                       'folders_count_as_one', _course.folders_count_as_one,
                       'courses_count_equally', _course.courses_count_equally),
                   -- E9: every category of the class, as the bundle sends them
                   'categories', coalesce((
                       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                           'display_order', c.display_order, 'calc_mode', c.calc_mode)
                                        order by c.display_order, c.id)
                         from category c where c.course_id = _course.id), '[]'::jsonb),
                   -- E9: this student's own hand-set levels, as the bundle sends them, without the teacher's reason
                   'section_overrides', coalesce((
                       select jsonb_object_agg(o.section_id::text, jsonb_build_object('level', o.level, 'date', o.updated_at))
                         from section_override o where o.enrollment_id = p_enrollment_id), '{}'::jsonb),
                   -- E9: the class's folders, as the bundle sends them
                   'competency_groups', coalesce((
                       select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                           'display_order', cg.display_order,
                                                           'counts_as_one', cg.counts_as_one)
                                        order by cg.display_order, cg.name)
                         from competency_group cg where cg.course_id = _course.id), '[]'::jsonb),
                   -- E9: the learning map: subjects, their sections not removed, their tags, in the bundle's order
                   'subjects', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'id', subj.id, 'name', subj.name, 'display_order', subj.display_order,
                                  'sections', coalesce((
                                      select jsonb_agg(jsonb_build_object(
                                                 'id', sec.id, 'name', sec.name, 'display_order', sec.display_order,
                                                 'competency_group_id', sec.competency_group_id,
                                                 'tags', coalesce((
                                                     select jsonb_agg(jsonb_build_object(
                                                                'id', t.id, 'code', t.code, 'label', t.label,
                                                                'i_can_text', t.i_can_text,
                                                                'i_can_statements', to_jsonb(t.i_can_statements),
                                                                'bank_id', t.bank_id, 'display_order', t.display_order)
                                                            order by t.display_order, t.label)
                                                       from tag t where t.section_id = sec.id), '[]'::jsonb))
                                             order by sec.display_order, sec.name)
                                        from section sec
                                       where sec.subject_id = subj.id and sec.course_id = _course.id
                                         and sec.removed_at is null), '[]'::jsonb))
                                order by subj.display_order, subj.name)
                         from subject subj where subj.course_id = _course.id), '[]'::jsonb)))
           else '{}'::jsonb end;
end;
$function$;

-- Service role only for page, as before (create or replace keeps its grants;
-- these two lines change nothing where they are as they should be).
revoke all on function student_submit.page(text, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.page(text, uuid, text) to service_role;

-- ── Who can run what ────────────────────────────────────────────────────────
-- The student's side: the service role only (the edge function). Replaced
-- functions keep their grants. The helpers are granted to nobody.
revoke all on function student_submit.forms(text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.form(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.answer(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function student_submit.report(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.forms(text, uuid, text) to service_role;
grant execute on function student_submit.form(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.answer(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.report(text, uuid, uuid, text) to service_role;
revoke all on function student_submit._write_limit(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function student_submit._card_listed(uuid, uuid) from public, anon, authenticated, service_role;
-- save_score_report_note runs as the signed-in teacher and calls this; fv_private is not on the API.
revoke all on function fv_private.report_note_hold(uuid, uuid) from public, anon;
grant execute on function fv_private.report_note_hold(uuid, uuid) to authenticated, service_role;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
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
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
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
            ('public.list_course_grade_returns(uuid)',               'bc5529a69303cdfe8d91604388dc927a', '0779f1e345fb278fd8702592163784c1'),
            ('student_submit.page(text,uuid,text)',                  '034e6674a25f8a5e1abc067f50784ce6', '2f1795ba4c5416788d477a540b49fccb')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
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

commit;
