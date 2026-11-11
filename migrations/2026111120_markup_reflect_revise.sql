-- Mark Up, Reflect on Feedback, Revisions, group work and the My Learning
-- switch: the part that only adds (2026-11-11). Student page build plan,
-- Batch C, first file (C1): S9-M1, S10-M1, S11-M1, S12-M1 and S13's column.
-- docs/plans/student-page-build-plan.md 1.6 and slices S9 to S13;
-- DECISIONS, "Grades, photos and sign-in on the student page" 4, 10 and 11.
-- Hiding a grade during a revision ("Student page build answers" 6) is not
-- in Batch C (Colin, Nov 11: it comes later as its own change); Return for
-- Revision keeps the grade. What the edge routes and the browser code against is
-- migrations/local-test/batch-c-contract.md.
--
-- BATCH C APPLIES ONLY AFTER BATCH B (2026111101, 2026111102): it builds
-- on submission and submission_file and calls Batch B's helpers. Its first
-- check stops it, with nothing changed, if Batch B is not there or not the
-- version it was tested with.
--
-- The second file, 2026111121_markup_revise_grade_changes.sql (C2), adds a
-- trigger inside every Return: it gives the marks and stores a finished
-- revision request as done whatever path returned the grade. It waits for
-- the owner's review. This file works without it: marks reach a student
-- only when the teacher's screen returns work through return_work (or
-- saves them in a class that returns grades as soon as they are saved).
-- With either file a request for Hide (keep_grade false) answers
-- hide_not_available and changes nothing.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. Two class switches, each off: course.reflect_on_feedback (Reflect on
--    Feedback) and course.show_my_learning (Show My Learning), written
--    through set_course_feedback_options. Students See Your Mark Up and
--    Group Work are Batch B's columns (assessment.students_see_markup,
--    assessment.group_work); they start doing something here.
-- 2. public.markup: one row per page of handed-in work that the teacher has
--    drawn on. working is the teacher's copy (what save_markup writes);
--    given is the copy the student was given, set only when the work is
--    returned. The photo is never changed: marks are data over it. A page's
--    row goes with its page (a foreign key to submission_file, on delete
--    cascade), so a page the student unsent takes its marks with it.
-- 3. public.revision_request: Return for Revision. What to Fix, Revise By,
--    which criteria, Keep the grade (always, in Batch C), the version it was asked of,
--    and that version's grade as the student had it (for Before and
--    After). A revision is the next version of the piece's submission
--    (Batch B's version column): version 2, then 3. A request is closed
--    as done, a stored fact, once its revision's grade is returned, or
--    once the teacher returns the student's work with the revision in
--    (return_work), even at the same grade; nothing done to the work or
--    the grade afterwards opens it again (_revision_settle).
-- 4. public.feedback_reflection: Reflect on Feedback. Does the feedback make
--    sense, the question, the plan, what went well; the teacher's answer;
--    Does It Make Sense Now, and one follow-up question and its answer.
--    The teacher's Only Me notes (note, follow_up_note) are kept apart
--    from the answers: no function a student calls reads them, and a real
--    answer can still be sent after one.
-- 5. Triggers on assessment and enrollment, as Batch B has: when one is
--    deleted, its revision requests and reflections go, under the class's
--    lock. (Marks go with their pages, which Batch B's triggers delete.)
--    None of the three tables has a foreign key to assessment, enrollment
--    or course, for the reason grade_return and submission have none
--    (2026110902, "ONE LOCK PER CLASS").
-- 6. The teacher's RPCs (public; signed-in teachers; each checks the caller
--    owns the class; each write takes p_idempotency_key and asks for its
--    remembered answer under the class's lock, except the class switches,
--    which take no class lock: see set_course_feedback_options):
--      set_course_feedback_options(course, patch, key)
--      save_markup(page, marks, base_rev, key)
--      list_assessment_markup(assessment)
--      return_work(assessment, enrollments, key)
--        return_grades, unchanged, then the marks: Return, Return and Next,
--        Return N Graded, once Mark Up is on screen.
--      return_for_revision(assessment, enrollment, request, key)
--      set_revision_request(request id, patch, key)
--      cancel_revision(request id, key)
--      answer_reflection(reflection id, answer, key, only_me)
--      list_course_feedback(course)
-- 7. The student's side (schema student_submit; service_role only; the
--    student-submit edge function calls them):
--      feedback(session, enrollment, address)        what the page shows
--      markup(session, enrollment, assessment, address)  the given marks
--      reflect(session, enrollment, assessment, reflection, address)
--      reply(session, enrollment, assessment, reply, address)
--      answer_seen(session, enrollment, assessments, address)
--      revision_start(session, enrollment, assessment, pages, note,
--                     request id, address)
--      revision_finish(session, enrollment, submission, files, address)
--      revision_unsend(session, enrollment, assessment, address)
--      group_work(session, enrollment, address)
--      group_file_links(session, enrollment, assessment, address)
--    A STUDENT ACTS ONLY through a live session of their own card (Batch
--    A's and Batch B's checks: signed_out, not_found, card_stopped,
--    card_expired, closed, and card_locked for a write), only for their own
--    enrollment, and never reads a draft, the teacher's working marks, or
--    another student's name. Marks and the teacher's answer reach them only
--    as given: marks once the work is returned, an answer once it is sent.
--
-- ── What a student is never sent ────────────────────────────────────────────
-- markup.working (only markup.given); a reflection's answer before the
-- teacher sends it, or the teacher's Only Me notes, or that there is one;
-- another student's name; another student's enrollment
-- id as a field (a group-mate's page path, which the edge function turns
-- into a link, has that student's enrollment id in it: an opaque id, never
-- a name); a grade other than their own returned one
-- (revision_request.first_grade is the copy they were given, cut to what
-- the work's scoring uses now).
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing. Every class gets Reflect on Feedback and Show My Learning off.
-- No existing row of any table changes, no row is deleted, and no existing
-- function (but _grading_started, below), trigger, policy or grant changes
-- (migrations/local-test/batch_c.py proves both on a database built as live
-- is, with Batch B applied and in use).
--
-- ── What it changes in what exists ──────────────────────────────────────────
-- ONE EXISTING FUNCTION IS REPLACED: Batch B's student_submit._grading_started
-- (section 2b; Colin decided it, ruling 109): a page carrying the teacher's
-- marks counts as grading started, so the student can no longer Unsend or
-- Replace it. Batch B's text is kept and one condition added.
-- course gains two columns (a constant default: no rewrite). assessment and
-- enrollment gain two triggers each (work_feedback_gone after a row is
-- deleted, work_feedback_truncate after a truncate). For a class with no
-- revision request and no reflection those triggers take the lock
-- grade_return_gone has just taken and delete no row.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless:
--   Batch A, S0-M4b, S0-M5, S3-M1, Batch B and Batch B's review fixes are
--     applied (apply order: 2026111101, 2026111102, 2026111104, then this);
--   every existing function the new ones call is exactly the definition the
--     tests ran against (md5 of pg_get_functiondef on PostgreSQL 17; the
--     "relied" list below, written by migrations/local-test/
--     batch_c_fingerprints.py from a database built as live is on
--     2026-11-11, S4-M1 included, plus Batch B at 8c36fe48 and its fixes
--     file at 7f5f34e5; the three functions the fixes file replaces are on
--     the list, so this file stops if the fixes are not in first; if Batch
--     B changes before it is applied the list is written again);
--   on a first run, none of its names is taken.
-- ON A LATER RUN (public.markup exists) every function this file makes must
-- be as it leaves it, or as the second file (C2) leaves the three C2
-- replaces; otherwise it stops. Running this file again after C2 changes
-- nothing of C2.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- Adding the columns takes course whole for an instant; adding the triggers
-- takes assessment and enrollment against writes for an instant. If a long
-- transaction holds one of them the file gives up after five seconds with
-- nothing applied: run it again.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/batch-c1-live-precheck.sql   expected: no rows.
-- migrations/local-test/batch-c1-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/batch-c1-undo.sql (not a migration; proved by
-- batch_c_undo.py). PART 1 stops every Batch C function, the teachers'
-- and the student page's (each answers a permission error); it deletes
-- nothing and changes no row. PART 1b puts them back. PART 2 removes everything this file made. It refuses while C2 is
-- applied, and while the three tables hold a row unless the session says
-- the rows may go (they are teachers' marks and students' reflections).
--
-- One transaction: the file opens with begin and ends with commit. Every
-- check that can stop it runs first.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f     record;
    _md5   text;
    _first boolean := to_regclass('public.markup') is null;   -- true: nothing of this file is here yet
    _col   record;
begin
    if to_regclass('public.grade_return') is null or to_regclass('student_submit.device_session') is null
       or to_regclass('public.student_card') is null or to_regclass('public.course_sync_cursor') is null then
        raise exception 'Batch A is not all applied (2026110901 to 2026110904): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('public._grade_return_repair_class(uuid)') is null then
        raise exception 'S0-M4b is not applied (2026110905_grade_return_limits.sql): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null then
        raise exception 'S3-M1 is not applied (2026111003_card_codes_keyed.sql): apply it, then this file. Nothing was changed.';
    end if;
    if to_regclass('public.submission') is null or to_regclass('public.submission_file') is null
       or to_regclass('student_submit.send_log') is null then
        raise exception 'Batch B is not applied (2026111101 and 2026111102): apply it, then this file. Nothing was changed.';
    end if;

    -- Every existing function the new ones call must be the definition the
    -- tests ran against.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/batch_c_fingerprints.py)
            ('public.fv_owns_course(uuid)',                                                         'e3afeca06043a6e907e6f4ae777c85da'),
            ('public.fv_owns_enrollment(uuid)',                                                     '728526648388367393162be706f7f9ea'),
            ('public.fv_owns_assessment(uuid)',                                                     '9f4c680c35f9f3ac32e8290824707673'),
            ('public.fv_idem_check(uuid,text)',                                                     '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)',                                               '6d0b48c458d273a332db39e1a4b68626'),
            ('public._fv_timezone(text)',                                                           '8dbcb5716f155e2441f47416a0b28527'),
            ('public._fv_date(text)',                                                               '0dcf865b5254cf0f9535df0fac1cb8a4'),
            ('public._grade_return_lock(uuid)',                                                     '530dca441198b1546a4ec4967cd83b9f'),
            ('public._grade_return_lock_first(uuid)',                                               '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._grade_return_holds(uuid)',                                                    '51d6525109333424405e826bbc303b90'),
            ('public._grade_copy(uuid,uuid)',                                                       '3a8e0dfbc873176692a1160150a8d43b'),
            ('public._grade_copy_in_use(jsonb,uuid)',                                               'befe9f034ce927b2abdf8c8825c402bd'),
            ('public.return_grades(uuid,uuid[],uuid)',                                              '7f38e838fd64a648e230ab232c5cce28'),
            ('student_submit._session_class(text,uuid)',                                            '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit._device_session(text)',                                                'fa1e510e4ccd3bccbf91e29540a837bb'),
            ('student_submit._card_refusal(uuid)',                                                  'cb88af0a6bf62c22ff6c636b291b1a25'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
            ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
            ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
            ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_file_removed()',                                                   'edc99e4c04baefcf83b9ce3c94723023'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'c8c5c26be1758ec2e07fe73a68731159'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               '286e463dca1842c2586a93c77fb93456'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '68665f35e1678f1bba64d30c082409d8')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;

    -- A first run: none of this file's names may be taken. A later run:
    -- each function is as this file leaves it (C2 replaces none of them).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._work_feedback_gone()',                                       '5c760a38a7675c1d49ef95ab994b76e5', '5c760a38a7675c1d49ef95ab994b76e5'),
            ('public._work_feedback_truncated()',                                  '450e3b27b73c51d01f4c431adb402bbd', '450e3b27b73c51d01f4c431adb402bbd'),
            ('public._markup_check(jsonb)',                                        'd5fac66f176bf8f23391a7c6c19b053a', 'd5fac66f176bf8f23391a7c6c19b053a'),
            ('public._markup_give(uuid,uuid)',                                     'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
            ('public._piece_latest(uuid,uuid)',                                    'fee319ef4d87447eeac9b4d53a1f1b50', 'fee319ef4d87447eeac9b4d53a1f1b50'),
            ('public._revision_state(uuid)',                                       '808f6944ea937a32576729e48115e58d', '808f6944ea937a32576729e48115e58d'),
            ('public._revision_settle(uuid,uuid,boolean)',                         '5abc02afbaa29294cdb317838657b37c', '5abc02afbaa29294cdb317838657b37c'),
            ('public._revision_json(uuid)',                                        '4ea85d4b58243fc0d6512b31ac6d165e', '4ea85d4b58243fc0d6512b31ac6d165e'),
            ('public._reflection_json(uuid)',                                      'f089277294adaf7d7834b41a1e93d5fa', 'f089277294adaf7d7834b41a1e93d5fa'),
            ('public.set_course_feedback_options(uuid,jsonb,uuid)',                '1954af2eef430d63baa91d38e74106d2', '1954af2eef430d63baa91d38e74106d2'),
            ('public.save_markup(uuid,jsonb,integer,uuid)',                        '808290a14511b137bc5c1a4574016429', '808290a14511b137bc5c1a4574016429'),
            ('public.list_assessment_markup(uuid)',                                '5e64579a923a0f0c02791b6428e54d98', '5e64579a923a0f0c02791b6428e54d98'),
            ('public.return_work(uuid,uuid[],uuid)',                               '13f1d5ec77567d5909c49c493ad77b64', '13f1d5ec77567d5909c49c493ad77b64'),
            ('public.return_for_revision(uuid,uuid,jsonb,uuid)',                   '0f3cc087f25815ba377919f68b870f36', '0f3cc087f25815ba377919f68b870f36'),
            ('public.set_revision_request(uuid,jsonb,uuid)',                       '6f9fb14cc1c8ced04cca7e0302c40b13', '6f9fb14cc1c8ced04cca7e0302c40b13'),
            ('public.cancel_revision(uuid,uuid)',                                  '15fb7d84333ed19b362e778b6667f377', '15fb7d84333ed19b362e778b6667f377'),
            ('public.answer_reflection(uuid,text,uuid,boolean)',                   '3dc0da991f10c092ae0a80202310d56f', '3dc0da991f10c092ae0a80202310d56f'),
            ('public.list_course_feedback(uuid)',                                  '7fbe6b367a0c28fd4dd2b894f0dc7711', '7fbe6b367a0c28fd4dd2b894f0dc7711'),
            ('student_submit._group_members(uuid,uuid)',                           'b38b1af6f2dc142c94ce1cca454fd0fb', 'b38b1af6f2dc142c94ce1cca454fd0fb'),
            ('student_submit.feedback(text,uuid,text)',                            '4ee8ebfb4b2af25698d2fb3eafc7f9ea', '4ee8ebfb4b2af25698d2fb3eafc7f9ea'),
            ('student_submit.markup(text,uuid,uuid,text)',                         '6cc78118aa4e98252514826aabf957a9', '6cc78118aa4e98252514826aabf957a9'),
            ('student_submit.reflect(text,uuid,uuid,jsonb,text)',                  '7a4e2ab29d369ef159dce65e1e1e8f77', '7a4e2ab29d369ef159dce65e1e1e8f77'),
            ('student_submit.reply(text,uuid,uuid,jsonb,text)',                    '264a736a722cf19022c20c343ecb01fb', '264a736a722cf19022c20c343ecb01fb'),
            ('student_submit.answer_seen(text,uuid,uuid[],text)',                  'da85d013a0511618c989d7bb44eac2f3', 'da85d013a0511618c989d7bb44eac2f3'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84', '43ca2e50ff067a4fb51762367895ee84'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',          'a04e2d62a76b00a7f6ad03a76a0ede74', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
            ('student_submit.revision_unsend(text,uuid,uuid,text)',                '73ac162e56dde98d11ffcd03aa4b5ffa', '73ac162e56dde98d11ffcd03aa4b5ffa'),
            ('student_submit.group_work(text,uuid,text)',                          '1db83448b1b3d7ae998870bdb07c4f36', '1db83448b1b3d7ae998870bdb07c4f36'),
            ('student_submit.group_file_links(text,uuid,uuid,text)',               '1c034fa5647b5808209b0ef9b31e8e4d', '1c034fa5647b5808209b0ef9b31e8e4d')
            -- FINGERPRINTS-END
        ) as v(fn, becomes, or_c2)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _first and _md5 <> 'absent' then
            raise exception '% already exists, and public.markup does not: something else made it. Nothing was changed.', _f.fn;
        elsif not _first and _md5 <> _f.becomes and _md5 <> _f.or_c2 then
            raise exception 'public.markup exists, so this file has been applied, but % is not as it or the second file leaves it (found %). Do not run this file again. Nothing was changed.',
                _f.fn, _md5;
        end if;
    end loop;
    -- The one existing function this file replaces (Batch B's
    -- student_submit._grading_started, section 2b): on a first run it must be
    -- Batch B's; on a later run, this file's.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/batch_c_fingerprints.py)
            ('student_submit._grading_started(uuid,uuid)', '720b9f044b853b5c57b04bec7f59010c', '13622bbca72904fdf877ce6b336dc6b4')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _first and _md5 <> _f.before then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.before;
        elsif not _first and _md5 <> _f.becomes then
            raise exception 'public.markup exists, so this file has been applied, but % is not as it leaves it (found %). Do not run this file again. Nothing was changed.',
                _f.fn, _md5;
        end if;
    end loop;
    if _first then
        if to_regclass('public.revision_request') is not null or to_regclass('public.feedback_reflection') is not null then
            raise exception 'a table this file makes already exists, and public.markup does not. Nothing was changed.';
        end if;
        for _col in
            select a.attname from pg_attribute a
             where a.attrelid = 'public.course'::regclass and not a.attisdropped
               and a.attname in ('reflect_on_feedback', 'show_my_learning')
        loop
            raise exception 'course.% already exists, and public.markup does not: something else made it. Nothing was changed.', _col.attname;
        end loop;
        if exists (select 1 from pg_trigger t
                    where not t.tgisinternal and t.tgname in ('work_feedback_gone', 'work_feedback_truncate')
                      and t.tgrelid in ('public.assessment'::regclass, 'public.enrollment'::regclass)) then
            raise exception 'a trigger named work_feedback_gone or work_feedback_truncate is already on assessment or enrollment, and public.markup does not exist. Nothing was changed.';
        end if;
    end if;
end
$guard$;

-- ── 1. The two class switches ───────────────────────────────────────────────
alter table public.course
    add column if not exists reflect_on_feedback boolean not null default false,
    add column if not exists show_my_learning boolean not null default false;
comment on column public.course.reflect_on_feedback is
    'Reflect on Feedback, in Class Settings, Student Page. On: after work is returned, a student can say if the feedback made sense, ask a question and make a plan.';
comment on column public.course.show_my_learning is
    'Show My Learning, in Class Settings, Student Page. On: the student page shows the student their own skills and grade, from returned work only.';

-- ── 2. markup ───────────────────────────────────────────────────────────────
create table if not exists public.markup (
    -- The page it is drawn on. The row goes with the page (Unsend, Replace,
    -- a teacher's delete, a class purge): a foreign key to submission_file
    -- is safe here, as submission_file's own to submission is, because a
    -- page is only ever deleted under the class's lock.
    file_id       uuid        primary key references public.submission_file(id) on delete cascade,
    -- The piece, for lookups: the page's submission's class, assessment and
    -- student. A page never moves to another piece (Batch B moves a page
    -- only between two submissions of one student and one assessment).
    course_id     uuid        not null,
    assessment_id uuid        not null,
    enrollment_id uuid        not null,
    -- The teacher's copy: { "v": 1, "marks": [ ... ] } (public._markup_check
    -- says what a mark is). Never sent to a student.
    working       jsonb,
    working_rev   integer     not null default 0,
    working_at    timestamptz,
    -- The copy the student was given, and the working_rev it was given at.
    -- Null until the work is first returned with marks.
    given         jsonb,
    given_rev     integer,
    given_at      timestamptz,
    created_at    timestamptz not null default now(),
    constraint markup_working_object check (working is null or jsonb_typeof(working) = 'object'),
    constraint markup_given_object check (given is null or jsonb_typeof(given) = 'object'),
    constraint markup_given_has_rev check ((given_rev is null) = (given_at is null))
);
create index if not exists markup_piece_idx on public.markup (assessment_id, enrollment_id);
create index if not exists markup_enrollment_idx on public.markup (enrollment_id);
create index if not exists markup_course_idx on public.markup (course_id);
comment on table public.markup is
    'Mark Up: drawing data over one page of handed-in work. working is the teacher''s; given is what the student was given when the work was returned. Read and written only through the functions of 2026111120.';

-- ── 2b. Marks count as grading started ──────────────────────────────────────
-- COLIN DECIDED THIS ON NOV 11 (ruling 109) (it is the one replaced function in this
-- file; the commit that adds it can be taken out on its own). Batch B's
-- student_submit._grading_started (2026111101) says the teacher has
-- started grading a student's work when the piece holds a draft or a
-- returned grade (ruling 83, made before Mark Up existed). Without this, a
-- student could Unsend or Replace a page the teacher has drawn on, and the
-- marks would go with the page. With it, a page of that student's work for
-- the piece that carries at least one of the teacher's marks (in the
-- working copy: given or not) also counts, so Unsend, Replace and a
-- finishing send answer grading_started, as they do for a draft. A page
-- whose marks were all erased does not count. Marks on a group-mate's
-- pages do not count for this student. Batch B's text, unchanged, then one
-- more condition; everything that calls it (Batch B's work, send_start,
-- send_finish, unsend, replace) follows without change.
create or replace function student_submit._grading_started(p_enrollment_id uuid, p_assessment_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select coalesce((select g.is_draft or g.returned_at is not null
                       from grade_return g
                      where g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id
                        -- a DIBELS benchmark has no Draft and no Returned (2026110905)
                        and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels')), false)
        -- Mark Up (2026111120): the teacher's marks on a page of this student's work for the piece
        or exists (select 1 from markup m
                    where m.enrollment_id = p_enrollment_id and m.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) > 0);
$function$;

-- ── 3. revision_request ─────────────────────────────────────────────────────
create table if not exists public.revision_request (
    id            uuid        primary key default gen_random_uuid(),
    course_id     uuid        not null,
    assessment_id uuid        not null,
    enrollment_id uuid        not null,
    -- open: waiting for a revision, or one is in and its grade is not yet
    -- returned (which of the two is read from the submissions, not kept).
    -- done: the revision's grade was returned, kept as a stored fact
    -- (_revision_settle) so nothing done to the work or the grade later
    -- opens it again. cancelled: the teacher took the request back.
    state         text        not null default 'open' constraint revision_request_state_check check (state in ('open', 'done', 'cancelled')),
    what_to_fix   text        not null constraint revision_request_what_to_fix_check check (char_length(what_to_fix) between 1 and 2000),
    revise_by     date,
    criterion_ids uuid[]      not null default '{}',
    -- Keep this grade while the student revises. Always true in Batch C:
    -- a request to hide it is refused (hide_not_available). The column
    -- keeps the request's shape for a later change that adds Hide.
    keep_grade    boolean     not null default true constraint revision_request_keep_grade_check check (keep_grade),
    -- The version it was asked of: the piece's latest handed-in submission
    -- then (null when nothing was handed in: work on paper, graded as such).
    first_submission_id uuid,
    first_version smallint    not null default 1,
    -- That version's grade as the student had it when the request was
    -- made (a copy in 2026110902's format; null when there was none), and
    -- when it had been returned. Before and After reads it.
    first_grade   jsonb,
    first_returned_at timestamptz,
    -- md5 of grade_return.working_copy when the revision was handed in:
    -- grading of the revision has started once the working copy differs.
    -- A fingerprint only: no grade is kept here.
    grade_mark    text,
    -- When the revision now in came in (revision_finish; cleared by
    -- revision_unsend), and the grade_return row's returned_at as it was
    -- then, both written under the class's lock. Every Return writes
    -- returned_at under that lock too, so a Return after the revision came
    -- in is one that has changed returned_at since: no two clocks are
    -- compared. A grade so returned has returned the revision, even once
    -- the revision's photos are deleted.
    revision_in_at timestamptz,
    in_returned_at timestamptz,
    created_by    uuid,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    closed_at     timestamptz,
    constraint revision_request_first_grade_object check (first_grade is null or jsonb_typeof(first_grade) = 'object'),
    constraint revision_request_closed_has_time check ((state = 'open') = (closed_at is null))
);
-- One open request per student per piece.
create unique index if not exists revision_request_one_open on public.revision_request (assessment_id, enrollment_id) where state = 'open';
create index if not exists revision_request_assessment_idx on public.revision_request (assessment_id);
create index if not exists revision_request_enrollment_idx on public.revision_request (enrollment_id);
create index if not exists revision_request_course_idx on public.revision_request (course_id);
comment on table public.revision_request is
    'Return for Revision: what to fix, by when, which criteria, and the first version''s grade for Before and After. Read and written only through the functions of 2026111120 (and closed as done by 2026111121''s trigger).';

-- ── 4. feedback_reflection ──────────────────────────────────────────────────
create table if not exists public.feedback_reflection (
    id            uuid        primary key default gen_random_uuid(),
    course_id     uuid        not null,
    assessment_id uuid        not null,
    enrollment_id uuid        not null,
    -- The student's own words. The teacher cannot change them.
    makes_sense   text        not null constraint feedback_reflection_makes_sense_check check (makes_sense in ('yes', 'not_sure')),
    question      text        constraint feedback_reflection_question_check check (char_length(question) <= 1000),
    plan          text        constraint feedback_reflection_plan_check check (char_length(plan) <= 1000),
    -- When the plan was last written: with the reflection, or later with
    -- Make My Plan (reply). Your Plan From Last Time is the newest.
    plan_at       timestamptz,
    went_well     text        constraint feedback_reflection_went_well_check check (char_length(went_well) <= 1000),
    sent_at       timestamptz not null default now(),
    -- The teacher's answer (Send Answer): always sent to the student.
    answer        text        constraint feedback_reflection_answer_check check (char_length(answer) <= 2000),
    answered_at   timestamptz,
    -- The teacher's Only Me note on the reflection: theirs alone. It is
    -- never sent, and no function a student calls reads it, so nothing a
    -- student is told differs for a reflection with a note. It is not an
    -- answer: a real answer can still be sent, and the student can still
    -- change their reflection. It clears the question from the teacher's
    -- list until the student changes the reflection (sent_at after
    -- noted_at).
    note          text        constraint feedback_reflection_note_check check (char_length(note) <= 2000),
    noted_at      timestamptz,
    -- When the student's page showed the answer (answer_seen: What Changed's
    -- "answered your question" until then).
    answer_seen_at timestamptz,
    -- Does It Make Sense Now?, and one more question if not.
    sense_now     text        constraint feedback_reflection_sense_now_check check (sense_now in ('yes', 'not_sure')),
    sense_now_at  timestamptz,
    follow_up     text        constraint feedback_reflection_follow_up_check check (char_length(follow_up) <= 1000),
    follow_up_answer text     constraint feedback_reflection_follow_up_answer_check check (char_length(follow_up_answer) <= 2000),
    follow_up_answered_at timestamptz,
    -- The teacher's Only Me note on the follow-up, as note is on the reflection.
    follow_up_note text       constraint feedback_reflection_follow_up_note_check check (char_length(follow_up_note) <= 2000),
    follow_up_noted_at timestamptz,
    follow_up_answer_seen_at timestamptz,
    updated_at    timestamptz not null default now(),
    constraint feedback_reflection_plan_has_time check ((plan is null) = (plan_at is null)),
    constraint feedback_reflection_answer_has_time check ((answer is null) = (answered_at is null)),
    constraint feedback_reflection_follow_up_answer_has_time check ((follow_up_answer is null) = (follow_up_answered_at is null)),
    constraint feedback_reflection_follow_up_after_answer check (follow_up is null or answer is not null),
    constraint feedback_reflection_note_has_time check ((note is null) = (noted_at is null)),
    constraint feedback_reflection_follow_up_note_has_time check ((follow_up_note is null) = (follow_up_noted_at is null)),
    constraint feedback_reflection_follow_up_note_after_follow_up check (follow_up_note is null or follow_up is not null),
    constraint feedback_reflection_one unique (assessment_id, enrollment_id)
);
create index if not exists feedback_reflection_enrollment_idx on public.feedback_reflection (enrollment_id);
create index if not exists feedback_reflection_course_idx on public.feedback_reflection (course_id);
comment on table public.feedback_reflection is
    'Reflect on Feedback: one per student per piece. The student''s words, the teacher''s answer, Does It Make Sense Now. Read and written only through the functions of 2026111120.';

alter table public.markup enable row level security;
alter table public.revision_request enable row level security;
alter table public.feedback_reflection enable row level security;
-- No policy and no grant: a teacher's browser reads through the list RPCs,
-- a student's page through the edge function.
revoke all on table public.markup, public.revision_request, public.feedback_reflection from public, anon, authenticated;

-- ── 5. When a student or an assessment is deleted ───────────────────────────
-- Its revision requests and reflections go, under the class lock, like
-- every other write to them. The trigger's name puts it after
-- grade_return_gone and submission_gone, which take the same lock.
create or replace function public._work_feedback_gone()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _grade_return_lock(old.course_id);
    if tg_table_name = 'enrollment' then
        delete from revision_request where enrollment_id = old.id;
        delete from feedback_reflection where enrollment_id = old.id;
    else
        delete from revision_request where assessment_id = old.id;
        delete from feedback_reflection where assessment_id = old.id;
    end if;
    return null;
end;
$function$;
create or replace trigger work_feedback_gone after delete on public.enrollment
    for each row execute function public._work_feedback_gone();
create or replace trigger work_feedback_gone after delete on public.assessment
    for each row execute function public._work_feedback_gone();

-- TRUNCATE fires no row trigger: whatever is left without its student or
-- assessment goes.
create or replace function public._work_feedback_truncated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    delete from revision_request r
     where not exists (select 1 from enrollment e where e.id = r.enrollment_id)
        or not exists (select 1 from assessment a where a.id = r.assessment_id);
    delete from feedback_reflection r
     where not exists (select 1 from enrollment e where e.id = r.enrollment_id)
        or not exists (select 1 from assessment a where a.id = r.assessment_id);
    return null;
end;
$function$;
create or replace trigger work_feedback_truncate after truncate on public.enrollment
    for each statement execute function public._work_feedback_truncated();
create or replace trigger work_feedback_truncate after truncate on public.assessment
    for each statement execute function public._work_feedback_truncated();

-- ── 6. Shared pieces ────────────────────────────────────────────────────────
-- Marks, as save_markup takes them: { "v": 1, "marks": [ mark, ... ] }, 500
-- marks at most, 256 KB at most. A place is a fraction of the page from its
-- top left: x and y from 0 to 1 (as the screens and Demo Mode store them,
-- shared/markup-draw.js). A mark is one of
--   { "id"?, "type": "pen" | "highlight", "color"?, "width"?, "points": [[x, y], ...] }
--       1 to 5000 points; width a fraction of the page's width, above 0, at most 0.2
--   { "id"?, "type": "note", "x", "y", "text" }   text 1 to 500 characters
--   { "id"?, "type": "tick" | "cross", "x", "y", "color"? }
-- with color one of red, green, blue and id a string of 1 to 64 characters.
-- No other key. The Eraser removes marks; it is not one. Raises 22023 when
-- it is anything else.
create or replace function public._markup_check(p_marks jsonb)
 returns void
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _m jsonb;
begin
    if p_marks is null or jsonb_typeof(p_marks) <> 'object' or jsonb_typeof(p_marks->'marks') is distinct from 'array'
       or p_marks->'v' is distinct from '1'::jsonb
       or exists (select 1 from jsonb_object_keys(p_marks) k where k not in ('v', 'marks')) then
        raise exception 'marks must be { "v": 1, "marks": [ ... ] }' using errcode = '22023';
    end if;
    if octet_length(p_marks::text) > 262144 then
        raise exception 'marks are over 256 KB' using errcode = '22023';
    end if;
    if jsonb_array_length(p_marks->'marks') > 500 then
        raise exception 'more than 500 marks on a page' using errcode = '22023';
    end if;
    for _m in select x from jsonb_array_elements(p_marks->'marks') x loop
        if jsonb_typeof(_m) <> 'object' or jsonb_typeof(_m->'type') is distinct from 'string'
           or _m->>'type' not in ('pen', 'highlight', 'note', 'tick', 'cross') then
            raise exception 'a mark is not one of pen, highlight, note, tick or cross' using errcode = '22023';
        end if;
        if _m->>'type' = 'note' and (jsonb_typeof(_m->'text') is distinct from 'string'
                                     or char_length(btrim(_m->>'text')) not between 1 and 500) then
            raise exception 'a note needs a text of 1 to 500 characters' using errcode = '22023';
        end if;
        if exists (select 1 from jsonb_object_keys(_m) k
                    where k not in ('id', 'type', 'color')
                      and not (k in ('x', 'y') and _m->>'type' in ('note', 'tick', 'cross'))
                      and not (k = 'text' and _m->>'type' = 'note')
                      and not (k in ('points', 'width') and _m->>'type' in ('pen', 'highlight'))) then
            raise exception 'a mark has a key its type does not take' using errcode = '22023';
        end if;
        if _m ? 'id' and (jsonb_typeof(_m->'id') <> 'string' or char_length(_m->>'id') not between 1 and 64) then
            raise exception 'a mark''s id is 1 to 64 characters' using errcode = '22023';
        end if;
        if _m ? 'color' and (jsonb_typeof(_m->'color') <> 'string' or _m->>'color' not in ('red', 'green', 'blue')) then
            raise exception 'a mark''s color is red, green or blue' using errcode = '22023';
        end if;
        if _m->>'type' in ('note', 'tick', 'cross')
           and (jsonb_typeof(_m->'x') is distinct from 'number' or jsonb_typeof(_m->'y') is distinct from 'number'
                or (_m->>'x')::numeric not between 0 and 1 or (_m->>'y')::numeric not between 0 and 1) then
            raise exception 'a note, tick or cross needs x and y, each from 0 to 1' using errcode = '22023';
        end if;
        if _m->>'type' in ('pen', 'highlight') then
            if jsonb_typeof(_m->'points') is distinct from 'array'
               or jsonb_array_length(_m->'points') not between 1 and 5000
               or exists (select 1 from jsonb_array_elements(_m->'points') pt
                           where jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
                              or jsonb_typeof(pt->0) <> 'number' or jsonb_typeof(pt->1) <> 'number'
                              or (pt->>0)::numeric not between 0 and 1 or (pt->>1)::numeric not between 0 and 1) then
                raise exception 'a pen or highlight needs 1 to 5000 points [x, y], each from 0 to 1' using errcode = '22023';
            end if;
            if _m ? 'width' and (jsonb_typeof(_m->'width') <> 'number'
                                 or (_m->>'width')::numeric <= 0 or (_m->>'width')::numeric > 0.2) then
                raise exception 'a stroke''s width is above 0 and at most 0.2 of the page' using errcode = '22023';
            end if;
        end if;
    end loop;
end;
$function$;

-- Give the student the teacher's marks on every page of one piece: given
-- := working wherever the two differ. Called under the class's lock by
-- return_work, by save_markup in a class that does not hold grades, and by
-- the second file's trigger when a grade is returned by any path. Returns
-- how many pages changed. An erased mark is gone from working, so it is
-- never given. A page never given whose marks were all erased has nothing
-- to give and is passed over (it is not waiting either).
create or replace function public._markup_give(p_enrollment_id uuid, p_assessment_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _n int;
begin
    update markup
       set given = working, given_rev = working_rev, given_at = clock_timestamp()
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       and given_rev is distinct from working_rev
       and not (given is null and jsonb_array_length(coalesce(working->'marks', '[]'::jsonb)) = 0);
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

-- The student's handed-in work for one piece: the latest version first.
-- (Batch B's tables; versions above 1 are revisions.)
create or replace function public._piece_latest(p_assessment_id uuid, p_enrollment_id uuid)
 returns public.submission
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select s.* from submission s
     where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id and s.state = 'sent'
     order by s.version desc limit 1;
$function$;

-- Where a revision request stands:
--   cancelled  the teacher took it back (stored)
--   returned   kept as done (stored: _revision_settle), or a grade was
--              returned after the revision came in: returned_at is not
--              what it was when the revision came in (in_returned_at,
--              stored then under the class's lock, so a revision whose
--              photos are deleted afterwards is still read as returned)
--   open       nothing newer than the version it was asked of is in
--   sent       the revision is in; grading it has not started
--   grading    the revision is in and the grade has changed since, or the
--              teacher's marks are on one of its pages (section 2b's rule)
-- The last three are read live from the submissions and grade_return, so
-- a grade saved by any path is read right.
create or replace function public._revision_state(p_request_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
               'state', case when r.state = 'cancelled' then 'cancelled'
                             when r.state = 'done' then 'returned'
                             -- returned since the revision came in (a draft on it since does not take that back)
                             when r.revision_in_at is not null and g.returned_at is not null
                                  and g.returned_at is distinct from r.in_returned_at then 'returned'
                             when v.id is null then 'open'
                             when md5(coalesce(g.working_copy::text, '')) is distinct from r.grade_mark then 'grading'
                             when exists (select 1 from markup m join submission_file f on f.id = m.file_id
                                           where f.submission_id = v.id
                                             and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) > 0) then 'grading'
                             else 'sent' end,
               'revision_submission_id', v.id, 'revision_version', v.version, 'revision_sent_at', v.sent_at,
               'revision_note', v.note, 'revision_late', v.is_late, 'revision_sent_by', v.sent_by)
      from revision_request r
      left join lateral (select s.* from submission s
                          where s.assessment_id = r.assessment_id and s.enrollment_id = r.enrollment_id and s.state = 'sent'
                            and s.version > r.first_version
                          order by s.version desc limit 1) v on true
      left join grade_return g on g.enrollment_id = r.enrollment_id and g.assessment_id = r.assessment_id
     where r.id = p_request_id;
$function$;

-- A request whose revision's grade has been returned is closed as done, a
-- stored fact: whatever is done to the work or the grade afterwards (its
-- photos deleted, the grade cleared and that returned), it stays done.
-- Called under the class's lock by every Batch C function that writes a
-- piece's requests or returns its work, and by the second file's trigger
-- each time a grade is returned by any path.
-- p_returned: the teacher has just returned this student's work on the
-- piece (return_work: Return, Return and Next, Return N Graded). Then a
-- request whose revision is in is done too, even when its grade did not
-- change: the teacher read the revision and returned it as it was.
-- Returns how many requests it closed (0 or 1).
create or replace function public._revision_settle(p_enrollment_id uuid, p_assessment_id uuid, p_returned boolean)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _n int;
begin
    update revision_request r
       set state = 'done', closed_at = now(), updated_at = now()
     where r.assessment_id = p_assessment_id and r.enrollment_id = p_enrollment_id and r.state = 'open'
       and _revision_state(r.id)->>'state' in ('returned', case when p_returned then 'sent' end, case when p_returned then 'grading' end);
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

-- One revision request as the teacher's screens read it.
create or replace function public._revision_json(p_request_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
               'id', r.id, 'assessment_id', r.assessment_id, 'enrollment_id', r.enrollment_id,
               'what_to_fix', r.what_to_fix, 'revise_by', r.revise_by, 'criterion_ids', to_jsonb(r.criterion_ids),
               'keep_grade', r.keep_grade, 'grade_hidden', false,
               'first_submission_id', r.first_submission_id, 'first_version', r.first_version,
               'first_grade', r.first_grade, 'first_returned_at', r.first_returned_at,
               'created_at', r.created_at, 'updated_at', r.updated_at, 'closed_at', r.closed_at)
           || _revision_state(r.id)
      from revision_request r where r.id = p_request_id;
$function$;

-- One reflection as the teacher's screens read it. waiting: a question has
-- no answer yet (what the dashboard's Questions From Students, the
-- gradebook's mark and the profile's mark count).
create or replace function public._reflection_json(p_reflection_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
               'id', f.id, 'assessment_id', f.assessment_id, 'enrollment_id', f.enrollment_id,
               'makes_sense', f.makes_sense, 'question', f.question, 'plan', f.plan, 'plan_at', f.plan_at, 'went_well', f.went_well,
               'sent_at', f.sent_at, 'answer', f.answer, 'answered_at', f.answered_at, 'note', f.note, 'noted_at', f.noted_at,
               'answer_seen_at', f.answer_seen_at,
               'sense_now', f.sense_now, 'sense_now_at', f.sense_now_at,
               'follow_up', f.follow_up, 'follow_up_answer', f.follow_up_answer, 'follow_up_answered_at', f.follow_up_answered_at,
               'follow_up_note', f.follow_up_note, 'follow_up_noted_at', f.follow_up_noted_at,
               'follow_up_answer_seen_at', f.follow_up_answer_seen_at,
               'waiting', (f.question is not null and f.answer is null and (f.noted_at is null or f.noted_at < f.sent_at))
                          or (f.follow_up is not null and f.follow_up_answer is null and f.follow_up_note is null))
      from feedback_reflection f where f.id = p_reflection_id;
$function$;

-- ── 7. The teacher's RPCs ───────────────────────────────────────────────────
-- Reflect on Feedback and Show My Learning. Only what the patch names is
-- written (DECISIONS, "Class settings on two computers" 3). No class lock,
-- as Batch B's set_course_send_work takes none: this writes only the course
-- row, and a writer that took the class's cursor row before the course row
-- would take the two in the opposite order to update_course and could
-- deadlock with it. Two copies of the same request at once both write the
-- same values; the second's remembered answer is the first's.
create or replace function public.set_course_feedback_options(p_course_id uuid, p_patch jsonb, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _k      text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_course_feedback_options');
    if _cached is not null then return _cached; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('reflect_on_feedback', 'show_my_learning') then
            raise exception 'unknown setting %', _k using errcode = '22023';
        end if;
        if jsonb_typeof(p_patch->_k) <> 'boolean' then
            raise exception '% must be true or false', _k using errcode = '22023';
        end if;
    end loop;
    update course
       set reflect_on_feedback = case when p_patch ? 'reflect_on_feedback' then (p_patch->>'reflect_on_feedback')::boolean else reflect_on_feedback end,
           show_my_learning = case when p_patch ? 'show_my_learning' then (p_patch->>'show_my_learning')::boolean else show_my_learning end,
           updated_at = now()
     where id = p_course_id;
    select jsonb_build_object('reflect_on_feedback', c.reflect_on_feedback, 'show_my_learning', c.show_my_learning)
      into _cached from course c where c.id = p_course_id;
    perform fv_idem_store(p_idempotency_key, 'set_course_feedback_options', _cached);
    return _cached;
end;
$function$;

-- Mark Up: the teacher's copy of one page's marks. p_base_rev is the rev
-- the screen last read (0 for a page never marked); when another device
-- has saved since, nothing is written and the answer is changed, with what
-- is there now. Null skips that check. In a class that does not hold
-- grades (its Student Page off, or As Soon As I Save, or no choice made)
-- the marks are given to the student at once, as a grade is there; in a
-- class that holds grades they wait for the work to be returned.
create or replace function public.save_markup(p_file_id uuid, p_marks jsonb, p_base_rev integer default null, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _s      submission%rowtype;
    _m      markup%rowtype;
    _given  int := 0;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    perform _markup_check(p_marks);
    if p_base_rev is not null and p_base_rev < 0 then
        raise exception 'base_rev must be 0 or more' using errcode = '22023';
    end if;
    select s.course_id into _course
      from submission_file f join submission s on s.id = f.submission_id
     where f.id = p_file_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock).
    _cached := fv_idem_check(p_idempotency_key, 'save_markup');
    if _cached is not null then return _cached; end if;
    -- Only a page of handed-in work, of a class the teacher owns. Read
    -- again under the lock: it may have been unsent while this call waited.
    select s.* into _s
      from submission_file f join submission s on s.id = f.submission_id
     where f.id = p_file_id and s.course_id = _course and s.state = 'sent';
    if _s.id is null then
        raise exception 'page not found' using errcode = 'P0002';
    end if;
    select * into _m from markup where file_id = p_file_id for update;
    if p_base_rev is not null and coalesce(_m.working_rev, 0) <> p_base_rev then
        -- Not remembered: the screen reads what is there and decides.
        return jsonb_build_object('result', 'changed', 'file_id', p_file_id, 'rev', coalesce(_m.working_rev, 0), 'marks', _m.working);
    end if;
    insert into markup (file_id, course_id, assessment_id, enrollment_id, working, working_rev, working_at)
    values (p_file_id, _s.course_id, _s.assessment_id, _s.enrollment_id, p_marks, 1, clock_timestamp())
    on conflict (file_id) do update
       set working = excluded.working, working_rev = markup.working_rev + 1, working_at = excluded.working_at
    returning * into _m;
    if not _grade_return_holds(_s.enrollment_id) then
        _given := _markup_give(_s.enrollment_id, _s.assessment_id);
    end if;
    -- given_rev and waiting as list_assessment_markup has them (given, there,
    -- is the student's copy of the marks; it is not repeated here).
    select jsonb_build_object('result', 'saved', 'file_id', p_file_id, 'rev', m.working_rev, 'given_rev', m.given_rev,
                              'waiting', m.given_rev is distinct from m.working_rev
                                         and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0)
                                         and a.students_see_markup)
      into _cached
      from markup m join assessment a on a.id = m.assessment_id where m.file_id = p_file_id;
    perform fv_idem_store(p_idempotency_key, 'save_markup', _cached);
    return _cached;
end;
$function$;

-- Every page's marks on one assessment, both copies, for the grader.
create or replace function public.list_assessment_markup(p_assessment_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'file_id', m.file_id, 'enrollment_id', m.enrollment_id, 'rev', m.working_rev, 'marks', m.working,
                   'saved_at', m.working_at, 'given', m.given, 'given_rev', m.given_rev, 'given_at', m.given_at,
                   'waiting', m.given_rev is distinct from m.working_rev
                              and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0)
                              and a.students_see_markup) order by m.enrollment_id, m.file_id)
          from markup m join assessment a on a.id = m.assessment_id
         where m.assessment_id = p_assessment_id), '[]'::jsonb);
end;
$function$;

-- Return, once marks are on screen: return_grades as it is (the listed
-- students' drafts are returned), then each listed student of the class is
-- given the marks on their pages of the piece. A student with no draft and
-- no marks waiting is passed over, as return_grades passes them over.
-- Returns return_grades' answer with marks_given (pages) and
-- marks_enrollment_ids: the pages waiting when it began that the student
-- has now, however they were given (here, or by the second file's trigger
-- inside return_grades).
create or replace function public.return_work(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _r       jsonb;
    _e       uuid;
    _pages   int := 0;
    _who     uuid[] := '{}';
    _waiting uuid[];
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    perform _grade_return_lock_first(_course);
    -- Asked under the lock: the same request twice at once waits above.
    _cached := fv_idem_check(p_idempotency_key, 'return_work');
    if _cached is not null then return _cached; end if;
    -- return_grades, unchanged. It asks who is signed in and whether they
    -- own the assessment again, and takes the lock this call holds. No key:
    -- this call remembers the whole answer under its own.
    -- A revision returned since by another path is closed first, so this
    -- Return cannot read it as anything else.
    perform _revision_settle(e.id, p_assessment_id, false)
       from enrollment e where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course;
    -- The listed students' pages with marks waiting (as _markup_give reads
    -- them), counted at the end once given.
    select coalesce(array_agg(m.file_id), '{}') into _waiting
      from markup m join enrollment e on e.id = m.enrollment_id
     where m.assessment_id = p_assessment_id and e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course
       and m.given_rev is distinct from m.working_rev
       and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0);
    _r := return_grades(p_assessment_id, p_enrollment_ids, null);
    -- Then Return ends each listed student's request whose revision is in,
    -- graded or left at the same grade.
    perform _revision_settle(e.id, p_assessment_id, true)
       from enrollment e where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course;
    for _e in
        select e.id from enrollment e
         where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course
           and not exists (select 1 from grade_return g
                            where g.enrollment_id = e.id and g.assessment_id = p_assessment_id and g.is_draft)
         order by e.id
    loop
        perform _markup_give(_e, p_assessment_id);
    end loop;
    select count(*)::int, coalesce(array_agg(distinct m.enrollment_id order by m.enrollment_id), '{}')
      into _pages, _who
      from markup m
     where m.file_id = any (_waiting) and m.given_rev = m.working_rev;
    _cached := _r || jsonb_build_object('marks_given', _pages, 'marks_enrollment_ids', to_jsonb(_who));
    perform fv_idem_store(p_idempotency_key, 'return_work', _cached);
    return _cached;
end;
$function$;

-- Return for Revision: the student's work is returned (as return_work
-- returns it) and a revision is asked for. p_request:
--   { "what_to_fix": "...",           1 to 2000 characters, required
--     "revise_by": "YYYY-MM-DD"|null,
--     "criterion_ids": [ ... ],       criteria of the piece's rubric; may be empty
--     "keep_grade": true|false }      false (hide the grade) is not in Batch C
-- Answers (not errors; only made is remembered):
--   made               { result, request, returned, hidden } (hidden: false)
--   already_open       an open request exists for the piece: { result, request }
--   hide_not_available keep_grade false: Hide is not in Batch C. Nothing is
--                      written. (A later change that adds Hide answers here.)
--   not_for_dibels     a DIBELS benchmark is not revised
-- Raises P0002 for an assessment or a student that is not the teacher's, a
-- student of another class or a withdrawn one; 22023 for a wrong shape.
create or replace function public.return_for_revision(
    p_assessment_id uuid, p_enrollment_id uuid, p_request jsonb, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached  jsonb;
    _course  uuid;
    _a       assessment%rowtype;
    _k       text;
    _fix     text;
    _by      date;
    _crit    uuid[] := '{}';
    _keep    boolean := true;
    _open    revision_request%rowtype;
    _sub     submission%rowtype;
    _g       grade_return%rowtype;
    _ret     jsonb;
    _id      uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select * into _a from assessment where id = p_assessment_id;
    _course := _a.course_id;
    if not fv_owns_enrollment(p_enrollment_id)
       or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.course_id = _course and e.withdrawn_at is null) then
        raise exception 'student not found' using errcode = 'P0002';
    end if;
    -- The request's shape, before anything is written.
    if p_request is null or jsonb_typeof(p_request) <> 'object' then
        raise exception 'the request must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_request) loop
        if _k not in ('what_to_fix', 'revise_by', 'criterion_ids', 'keep_grade') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
    end loop;
    if jsonb_typeof(p_request->'what_to_fix') is distinct from 'string'
       or char_length(btrim(p_request->>'what_to_fix')) not between 1 and 2000 then
        raise exception 'what_to_fix must be 1 to 2000 characters' using errcode = '22023';
    end if;
    _fix := btrim(p_request->>'what_to_fix');
    if p_request ? 'revise_by' and jsonb_typeof(p_request->'revise_by') <> 'null' then
        if jsonb_typeof(p_request->'revise_by') <> 'string' or _fv_date(p_request->>'revise_by') is null then
            raise exception 'revise_by must be a date, YYYY-MM-DD' using errcode = '22023';
        end if;
        _by := _fv_date(p_request->>'revise_by');
    end if;
    if p_request ? 'keep_grade' then
        if jsonb_typeof(p_request->'keep_grade') <> 'boolean' then
            raise exception 'keep_grade must be true or false' using errcode = '22023';
        end if;
        _keep := (p_request->>'keep_grade')::boolean;
    end if;
    if p_request ? 'criterion_ids' then
        if jsonb_typeof(p_request->'criterion_ids') <> 'array'
           or exists (select 1 from jsonb_array_elements(p_request->'criterion_ids') x
                       where jsonb_typeof(x) <> 'string'
                          or x #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
            raise exception 'criterion_ids must be a list of ids' using errcode = '22023';
        end if;
        select coalesce(array_agg(distinct (x #>> '{}')::uuid), '{}') into _crit from jsonb_array_elements(p_request->'criterion_ids') x;
        if exists (select 1 from unnest(_crit) c
                    where not exists (select 1 from criterion cr where cr.id = c and cr.rubric_id = _a.rubric_id)) then
            raise exception 'a criterion is not on this assessment''s rubric' using errcode = '22023';
        end if;
    end if;

    perform _grade_return_lock_first(_course);
    -- Asked under the lock.
    _cached := fv_idem_check(p_idempotency_key, 'return_for_revision');
    if _cached is not null then return _cached; end if;
    if not exists (select 1 from assessment a where a.id = p_assessment_id)
       or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null) then
        -- deleted or withdrawn while this call waited for the class
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    if _a.score_mode = 'dibels' then
        return jsonb_build_object('result', 'not_for_dibels');
    end if;
    -- A request whose revision's grade has since been returned is done.
    perform _revision_settle(p_enrollment_id, p_assessment_id, false);
    select * into _open from revision_request
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'open';
    if found then
        return jsonb_build_object('result', 'already_open', 'request', _revision_json(_open.id));
    end if;
    if not _keep then
        return jsonb_build_object('result', 'hide_not_available');
    end if;

    -- The work is returned first, as Return would return it.
    _ret := return_work(p_assessment_id, array[p_enrollment_id], null);
    _sub := _piece_latest(p_assessment_id, p_enrollment_id);
    select * into _g from grade_return where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    insert into revision_request (course_id, assessment_id, enrollment_id, what_to_fix, revise_by, criterion_ids, keep_grade,
                                  first_submission_id, first_version, first_grade, first_returned_at, created_by)
    values (_course, p_assessment_id, p_enrollment_id, _fix, _by, _crit, _keep,
            _sub.id, coalesce(_sub.version, 1),
            -- What the student has now: just returned, so not a draft.
            case when _g.returned_at is not null and not _g.is_draft then _grade_copy(p_enrollment_id, p_assessment_id) end,
            case when _g.returned_at is not null and not _g.is_draft then _g.returned_at end,
            (select auth.uid()))
    returning id into _id;
    _cached := jsonb_build_object('result', 'made', 'request', _revision_json(_id), 'returned', _ret, 'hidden', false);
    perform fv_idem_store(p_idempotency_key, 'return_for_revision', _cached);
    return _cached;
end;
$function$;

-- Change an open request: any of what_to_fix, revise_by, criterion_ids.
-- keep_grade is not changed here.
-- Answers { result: 'saved', request } or { result: 'not_open', request }.
create or replace function public.set_revision_request(p_request_id uuid, p_patch jsonb, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _r      revision_request%rowtype;
    _k      text;
    _crit   uuid[];
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('what_to_fix', 'revise_by', 'criterion_ids') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
    end loop;
    if p_patch ? 'what_to_fix' and (jsonb_typeof(p_patch->'what_to_fix') is distinct from 'string'
                                    or char_length(btrim(p_patch->>'what_to_fix')) not between 1 and 2000) then
        raise exception 'what_to_fix must be 1 to 2000 characters' using errcode = '22023';
    end if;
    if p_patch ? 'revise_by' and jsonb_typeof(p_patch->'revise_by') <> 'null'
       and (jsonb_typeof(p_patch->'revise_by') <> 'string' or _fv_date(p_patch->>'revise_by') is null) then
        raise exception 'revise_by must be a date, YYYY-MM-DD' using errcode = '22023';
    end if;
    if p_patch ? 'criterion_ids' and (jsonb_typeof(p_patch->'criterion_ids') <> 'array'
           or exists (select 1 from jsonb_array_elements(p_patch->'criterion_ids') x
                       where jsonb_typeof(x) <> 'string'
                          or x #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then
        raise exception 'criterion_ids must be a list of ids' using errcode = '22023';
    end if;
    select r.course_id into _course from revision_request r where r.id = p_request_id and fv_owns_course(r.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_revision_request');
    if _cached is not null then return _cached; end if;
    select * into _r from revision_request where id = p_request_id and course_id = _course for update;
    if not found then
        raise exception 'revision request not found' using errcode = 'P0002';
    end if;
    if _r.state <> 'open' then
        return jsonb_build_object('result', 'not_open', 'request', _revision_json(_r.id));
    end if;
    if p_patch ? 'criterion_ids' then
        select coalesce(array_agg(distinct (x #>> '{}')::uuid), '{}') into _crit from jsonb_array_elements(p_patch->'criterion_ids') x;
        if exists (select 1 from unnest(_crit) c
                    where not exists (select 1 from criterion cr join assessment a on a.rubric_id = cr.rubric_id
                                       where cr.id = c and a.id = _r.assessment_id)) then
            raise exception 'a criterion is not on this assessment''s rubric' using errcode = '22023';
        end if;
    end if;
    update revision_request
       set what_to_fix = case when p_patch ? 'what_to_fix' then btrim(p_patch->>'what_to_fix') else what_to_fix end,
           revise_by = case when p_patch ? 'revise_by' then _fv_date(p_patch->>'revise_by') else revise_by end,
           criterion_ids = case when p_patch ? 'criterion_ids' then _crit else criterion_ids end,
           updated_at = now()
     where id = _r.id;
    _cached := jsonb_build_object('result', 'saved', 'request', _revision_json(_r.id));
    perform fv_idem_store(p_idempotency_key, 'set_revision_request', _cached);
    return _cached;
end;
$function$;

-- Take a request back. A revision already sent stays, as a later version of
-- the work. No grade row is written (unhidden: always false; no grade is
-- hidden in Batch C).
-- Answers { result: 'cancelled', request, unhidden } or { result: 'not_open', request }.
create or replace function public.cancel_revision(p_request_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached   jsonb;
    _course   uuid;
    _r        revision_request%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select r.course_id into _course from revision_request r where r.id = p_request_id and fv_owns_course(r.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'cancel_revision');
    if _cached is not null then return _cached; end if;
    select * into _r from revision_request where id = p_request_id and course_id = _course for update;
    if not found then
        raise exception 'revision request not found' using errcode = 'P0002';
    end if;
    if _r.state <> 'open' then
        return jsonb_build_object('result', 'not_open', 'request', _revision_json(_r.id));
    end if;
    update revision_request set state = 'cancelled', closed_at = now(), updated_at = now() where id = _r.id;
    _cached := jsonb_build_object('result', 'cancelled', 'request', _revision_json(_r.id), 'unhidden', false);
    perform fv_idem_store(p_idempotency_key, 'cancel_revision', _cached);
    return _cached;
end;
$function$;

-- Send Answer. It answers what is open: the question (or, with none, the
-- reflection itself) until it has an answer, then the follow-up once the
-- student asks one. 1 to 2000 characters. p_only_me true (Only Me): the
-- text is the teacher's own note on what is open (note, or follow_up_note;
-- a second note takes the place of the first), never sent to the student,
-- and nothing a student calls tells them there is one. A note is not an
-- answer: it clears the question from the teacher's list, and a real
-- answer can still be sent after it.
-- Answers { result: 'answered', reflection } (remembered),
-- { result: 'already_answered', reflection }, or { result: 'reflect_off' }
-- while the class has Reflect on Feedback off.
create or replace function public.answer_reflection(p_reflection_id uuid, p_answer text, p_idempotency_key uuid default null,
                                                    p_only_me boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _f      feedback_reflection%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_answer is null or char_length(btrim(p_answer)) not between 1 and 2000 then
        raise exception 'the answer must be 1 to 2000 characters' using errcode = '22023';
    end if;
    if p_only_me is null then
        raise exception 'only_me must be true or false' using errcode = '22023';
    end if;
    select f.course_id into _course from feedback_reflection f where f.id = p_reflection_id and fv_owns_course(f.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'answer_reflection');
    if _cached is not null then return _cached; end if;
    select * into _f from feedback_reflection where id = p_reflection_id and course_id = _course for update;
    if not found then
        raise exception 'reflection not found' using errcode = 'P0002';
    end if;
    if not (select c.reflect_on_feedback from course c where c.id = _course) then
        return jsonb_build_object('result', 'reflect_off');
    end if;
    if _f.answer is null and p_only_me then
        update feedback_reflection set note = btrim(p_answer), noted_at = now(), updated_at = now() where id = _f.id;
    elsif _f.answer is null then
        update feedback_reflection set answer = btrim(p_answer), answered_at = now(), updated_at = now() where id = _f.id;
    elsif _f.follow_up is not null and _f.follow_up_answer is null and p_only_me then
        update feedback_reflection set follow_up_note = btrim(p_answer), follow_up_noted_at = now(), updated_at = now() where id = _f.id;
    elsif _f.follow_up is not null and _f.follow_up_answer is null then
        update feedback_reflection set follow_up_answer = btrim(p_answer), follow_up_answered_at = now(), updated_at = now()
         where id = _f.id;
    else
        return jsonb_build_object('result', 'already_answered', 'reflection', _reflection_json(_f.id));
    end if;
    _cached := jsonb_build_object('result', 'answered', 'reflection', _reflection_json(_f.id));
    perform fv_idem_store(p_idempotency_key, 'answer_reflection', _cached);
    return _cached;
end;
$function$;

-- Everything the teacher's screens need about Mark Up, revisions and
-- reflections in one class. Marks are counted here; list_assessment_markup
-- has the drawings. waiting on a page: the student would be given a change
-- at the next Return (To Return counts a student with a draft or such a
-- page). Reflections are listed only while Reflect on Feedback is on (they
-- are kept, and come back when it is turned on again).
create or replace function public.list_course_feedback(p_course_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
        'course', (select jsonb_build_object('reflect_on_feedback', c.reflect_on_feedback, 'show_my_learning', c.show_my_learning)
                     from course c where c.id = p_course_id),
        'markup', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', m.file_id, 'assessment_id', m.assessment_id, 'enrollment_id', m.enrollment_id,
                       'rev', m.working_rev, 'given_rev', m.given_rev, 'given_at', m.given_at,
                       'waiting', m.given_rev is distinct from m.working_rev
                                  and not (m.given is null and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) = 0)
                                  and a.students_see_markup) order by m.assessment_id, m.enrollment_id, m.file_id)
              from markup m join assessment a on a.id = m.assessment_id where m.course_id = p_course_id), '[]'::jsonb),
        'revisions', coalesce((
            select jsonb_agg(_revision_json(r.id) order by r.created_at, r.id)
              from revision_request r where r.course_id = p_course_id), '[]'::jsonb),
        'reflections', coalesce((
            select jsonb_agg(_reflection_json(f.id) order by f.sent_at, f.id)
              from feedback_reflection f join course c on c.id = f.course_id
             where f.course_id = p_course_id and c.reflect_on_feedback), '[]'::jsonb));
end;
$function$;

-- ── 8. The student's side ───────────────────────────────────────────────────
-- The members of the student's group for a piece set to One per Group, the
-- student included, or null when the piece is not group work or the
-- student is in no group. Groups are the ones the teacher made on the
-- assessment (collab_config: pairs for Pairs, groups for Groups), whose
-- members are enrollment ids. Only students of the class who are not
-- withdrawn count.
create or replace function student_submit._group_members(p_assessment_id uuid, p_enrollment_id uuid)
 returns uuid[]
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select (select array_agg(e.id order by e.id)
              from jsonb_array_elements_text(g.grp) m
              join enrollment e on e.id::text = lower(m) and e.course_id = a.course_id and e.withdrawn_at is null)
      from assessment a
     cross join lateral (
         select x as grp
           from jsonb_array_elements(case when jsonb_typeof(a.collab_config->(case a.collab_mode when 'pairs' then 'pairs' else 'groups' end)) = 'array'
                                          then a.collab_config->(case a.collab_mode when 'pairs' then 'pairs' else 'groups' end)
                                          else '[]'::jsonb end) x
          where jsonb_typeof(x) = 'array'
            and exists (select 1 from jsonb_array_elements_text(x) m where lower(m) = p_enrollment_id::text)
          limit 1) g
     where a.id = p_assessment_id and a.group_work = 'group' and a.collab_mode in ('pairs', 'groups');
$function$;

-- What the student's page shows about feedback, for one class: the two
-- switches; for each piece on the page that has marks given, a revision
-- asked, or a reflection: how many pages carry marks, how many pages the
-- work has, and how many notes (only when the work was returned with marks,
-- the piece shows marks, and no Missing or Excused is on it), the revision
-- request, and the reflection with the teacher's answer once sent (never
-- an Only Me note, nor that there is one) and whether the student has seen it;
-- and the last plan the student made in the class (Your Plan From Last
-- Time). Reflections and the last plan only while Reflect on Feedback is
-- on. Read-only.
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

-- The marks the student was given on one piece, page by page: their own
-- pages and their group's. Only markup.given, never the teacher's working
-- copy; nothing when the piece is set not to show marks, or Missing or
-- Excused is on it. Read-only.
create or replace function student_submit.markup(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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

-- Reflect on Feedback. p_reflection:
--   { "makes_sense": "yes" | "not_sure",
--     "question": "...",    required with not_sure; 1000 characters at most
--     "plan": "...",        required with yes
--     "went_well": "..." }  optional
-- Only on returned work (a grade has been returned for the piece), only
-- while Reflect on Feedback is on. Sent again before the teacher answers,
-- it takes the place of the first; once answered it cannot change (reply
-- is for that). The same reflection sent twice is the same reflection.
-- Answers: ok with the reflection; reflect_off, not_found, not_returned,
-- already_answered. A wrong shape raises 22023.
create or replace function student_submit.reflect(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reflection jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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

-- Does It Make Sense Now?, and Make My Plan. p_reply:
--   { "sense_now": "yes" | "not_sure",
--     "follow_up": "...",   1 to 1000 characters, only with not_sure, once
--     "plan": "..." }       1 to 1000 characters, only with yes: Make My
--                           Plan (it takes the place of a plan made before)
-- Only after the teacher answered (an Only Me note is not an answer), only
-- while Reflect on Feedback is on. The same reply
-- twice is the same reply. Answers: ok with the reflection; reflect_off,
-- not_found, not_answered, already_asked (a second follow-up). A wrong
-- shape raises 22023.
create or replace function student_submit.reply(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reply jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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

-- The student's page showed the teacher's answers on these pieces (What
-- Changed stops saying "answered your question"), as Batch A's seen does
-- for a returned grade: only answers sent to the student, only their own,
-- only their class's pieces. A locked card may still say so (a read).
-- Answers { ok, seen } (how many reflections it marked).
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

-- Send My Revision, first half: make the rows and name the paths, as
-- Batch B's send_start does, for the next version of the piece. While a
-- revision is in and grading it has not started, a new one takes its place
-- when finished (Replace). The arguments are send_start's, without
-- followed_plan.
-- Answers as send_start's, plus no_revision (no open request), and
-- grading_started (the revision in is being graded or was returned).
-- Revise By does not close it: a revision sent after it is marked late.
create or replace function student_submit.revision_start(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb,
    p_note text, p_request_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb;
    _card    uuid;
    _course  course%rowtype;
    _a       assessment%rowtype;
    _r       revision_request%rowtype;
    _st      jsonb;
    _sub     submission%rowtype;
    _expired boolean;
    _version smallint;
    _n       int;
    _oldest  timestamptz;
    _late    boolean;
    _id      uuid;
begin
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

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _card := (_in->>'card_id')::uuid;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;

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
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if _expired then
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- The same request again: the same answer, nothing new made or counted.
    select * into _sub from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and sent_by = 'student' and request_id = p_request_id;
    if found then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,
                                  'version', _sub.version, 'bucket', public._work_bucket(), 'late', _sub.is_late,
                                  'finish_by', case when _sub.state = 'sending' then _sub.created_at + public._work_hold() end,
                                  'files', case when _sub.state = 'sending' then public._work_upload_json(_sub.id) else '[]'::jsonb end);
    end if;

    perform public._revision_settle(p_enrollment_id, _a.id, false);
    select * into _r from revision_request where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'open';
    if _r.id is null then
        return jsonb_build_object('ok', false, 'error', 'no_revision');
    end if;
    _st := public._revision_state(_r.id);
    if _st->>'state' in ('grading', 'returned') then
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;
    -- A revision in and not yet graded is replaced at the finish, and keeps
    -- its version; otherwise this is the next version.
    _version := coalesce((_st->>'revision_version')::smallint,
                         (select max(s.version) from submission s
                           where s.assessment_id = _a.id and s.enrollment_id = p_enrollment_id and s.state = 'sent') + 1,
                         _r.first_version + 1);

    -- Twenty sends an hour for one card, counted as Batch B counts them.
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
    if public._work_class_full(_course.id, p_pages) is not null then
        return jsonb_build_object('ok', false, 'error', 'class_full');
    end if;

    _late := _r.revise_by is not null and (now() at time zone public._fv_timezone(_course.timezone))::date > _r.revise_by;
    insert into send_log (card_id) values (_card);
    _id := public._work_begin(_course.id, _a.id, p_enrollment_id, 'student', 'new', null,
                              p_pages, p_note, null, _late, _card, p_request_id);
    update submission set version = _version where id = _id;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _id, 'state', 'sending', 'version', _version,
                              'bucket', public._work_bucket(), 'late', _late,
                              'finish_by', now() + public._work_hold(),
                              'files', public._work_upload_json(_id));
end;
$function$;

-- Send My Revision, second half: every page must be in storage; then the
-- revision is handed in, taking the place of a revision in that is not yet
-- being graded. The arguments are send_finish's.
-- Answers as send_finish's, plus no_revision (the request was taken back
-- or is done: the pages are dropped), grading_started (the revision in
-- began to be graded while these pages went up: they are dropped) and
-- request_changed (the request was taken back and asked again while these
-- pages went up, so they are not the version it now takes: they are
-- dropped, and a fresh send is the next version).
create or replace function student_submit.revision_finish(
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
    _r       revision_request%rowtype;
    _st      jsonb;
    _state   jsonb;
    _expired boolean;
    _old     uuid;
    _version smallint;
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

    _expired := exists (select 1 from submission
                         where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id
                           and sent_by = 'student' and state = 'sending' and created_at < now() - public._work_hold());
    perform public._work_drop_expired(_course.id);
    if _expired then
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- This student's own revision send (a version above 1), and no one else's.
    select * into _sub from submission
     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id
       and sent_by = 'student' and version > 1
       for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _sub.state = 'sent' then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'version', _sub.version,
                                  'sent_at', _sub.sent_at, 'late', _sub.is_late,
                                  'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
    end if;
    if not exists (select 1 from enrollment e
                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    if (select a.students_send from assessment a where a.id = _sub.assessment_id) = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if exists (select 1 from jsonb_array_elements(p_files) x
                where not exists (select 1 from submission_file f
                                   where f.submission_id = _sub.id and f.id = (x->>'file_id')::uuid)) then
        raise exception 'a file is not one of this send''s' using errcode = '22023';
    end if;
    perform public._revision_settle(p_enrollment_id, _sub.assessment_id, false);
    select * into _r from revision_request
     where assessment_id = _sub.assessment_id and enrollment_id = p_enrollment_id and state = 'open';
    _st := case when _r.id is null then null else public._revision_state(_r.id) end;
    if _r.id is null or _st->>'state' in ('grading', 'returned') then
        perform set_config('fv.work_removal_reason', 'abandoned', true);
        delete from submission where id = _sub.id;
        perform set_config('fv.work_removal_reason', '', true);
        return jsonb_build_object('ok', false, 'error', case when _r.id is null then 'no_revision' else 'grading_started' end);
    end if;
    -- The version this request takes now, as revision_start reckons it: the
    -- revision in (replaced), else the next. A send begun under a request
    -- taken back and asked again is not it: dropped, with an answer.
    _version := coalesce((_st->>'revision_version')::smallint,
                         (select max(s.version) from submission s
                           where s.assessment_id = _sub.assessment_id and s.enrollment_id = p_enrollment_id and s.state = 'sent') + 1,
                         _r.first_version + 1);
    if _sub.version <> _version then
        perform set_config('fv.work_removal_reason', 'abandoned', true);
        delete from submission where id = _sub.id;
        perform set_config('fv.work_removal_reason', '', true);
        return jsonb_build_object('ok', false, 'error', 'request_changed');
    end if;

    _state := public._work_files_state(_sub.id, p_files);
    if _state->'missing' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'missing_pages', 'missing', _state->'missing');
    end if;
    if _state->'bad' <> '[]'::jsonb then
        return jsonb_build_object('ok', false, 'error', 'bad_file', 'files', _state->'bad');
    end if;

    perform public._work_settle_files(_sub.id, p_files);
    -- The revision it replaces, if one is in: the student's own pages go;
    -- pages the teacher added to it move to the new one, after its pages.
    _old := (_st->>'revision_submission_id')::uuid;
    if _old is not null then
        if (select s.sent_by from submission s where s.id = _old) <> 'student' then
            perform set_config('fv.work_removal_reason', 'abandoned', true);
            delete from submission where id = _sub.id;
            perform set_config('fv.work_removal_reason', '', true);
            return jsonb_build_object('ok', false, 'error', 'cannot_change');
        end if;
        update submission_file f
           set submission_id = _sub.id,
               page = (select count(*) from submission_file t where t.submission_id = _sub.id) + x.rn
          from (select t.id, row_number() over (order by t.page, t.id) as rn
                  from submission_file t where t.submission_id = _old and t.added_by = 'teacher') x
         where f.id = x.id;
        perform set_config('fv.work_removal_reason', 'replace', true);
        delete from submission where id = _old;
        perform set_config('fv.work_removal_reason', '', true);
    end if;
    update submission
       set state = 'sent', sent_at = now(), updated_at = now(),
           is_late = _r.revise_by is not null and (now() at time zone public._fv_timezone(_course.timezone))::date > _r.revise_by
     where id = _sub.id
    returning * into _sub;
    -- Grading of the revision starts when the grade next changes; it is
    -- returned by the next Return that gives a grade (returned_at as it is
    -- now, read under the class's lock: a Return that held the class while
    -- this send waited came before it).
    update revision_request
       set grade_mark = (select md5(coalesce(g.working_copy::text, '')) from (select 1) one
                           left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = _sub.assessment_id),
           revision_in_at = _sub.sent_at,
           in_returned_at = (select g.returned_at from grade_return g
                              where g.enrollment_id = p_enrollment_id and g.assessment_id = _sub.assessment_id),
           updated_at = now()
     where id = _r.id;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _sub.id, 'version', _sub.version,
                              'sent_at', _sub.sent_at, 'late', _sub.is_late,
                              'pages', (select count(*) from submission_file f where f.submission_id = _sub.id));
end;
$function$;

-- Take a revision back, before grading it starts. THE STUDENT'S PHOTOS OF
-- IT ARE DELETED. The first version and its grade are untouched; the
-- request is open again. A send of the student's revision that is not
-- finished is dropped too.
-- Answers { ok, unsent, cancelled, pages }; grading_started; cannot_change
-- (the teacher added pages to it); not_found.
create or replace function student_submit.revision_unsend(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in        jsonb;
    _course    uuid;
    _r         revision_request%rowtype;
    _st        jsonb;
    _old       uuid;
    _cancelled int;
    _pages     int;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _course := (_in->>'course_id')::uuid;
    perform public._grade_return_lock_first(_course);
    perform public._work_drop_expired(_course);
    if not exists (select 1 from assessment a where a.id = p_assessment_id and a.course_id = _course) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'sending'
       and sent_by = 'student' and version > 1;
    get diagnostics _cancelled = row_count;
    perform set_config('fv.work_removal_reason', '', true);

    perform public._revision_settle(p_enrollment_id, p_assessment_id, false);
    select * into _r from revision_request where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'open';
    _st := case when _r.id is null then null else public._revision_state(_r.id) end;
    _old := (_st->>'revision_submission_id')::uuid;
    if _r.id is null
       and (select r.state from revision_request r where r.assessment_id = p_assessment_id and r.enrollment_id = p_enrollment_id
             order by r.created_at desc, r.id limit 1) = 'done'
       and exists (select 1 from submission s
                    where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id and s.state = 'sent' and s.version > 1) then
        -- the revision was returned: it is the teacher's now, as a graded first version is
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;
    if _old is null then
        return jsonb_build_object('ok', true, 'unsent', false, 'cancelled', _cancelled > 0, 'pages', 0);
    end if;
    if _st->>'state' <> 'sent' then
        return jsonb_build_object('ok', false, 'error', 'grading_started');
    end if;
    if (select s.sent_by from submission s where s.id = _old) <> 'student'
       or exists (select 1 from submission_file f where f.submission_id = _old and f.added_by = 'teacher') then
        return jsonb_build_object('ok', false, 'error', 'cannot_change');
    end if;
    select count(*) into _pages from submission_file f where f.submission_id = _old;
    perform set_config('fv.work_removal_reason', 'unsend', true);
    delete from submission where id = _old;
    perform set_config('fv.work_removal_reason', '', true);
    update revision_request set grade_mark = null, revision_in_at = null, in_returned_at = null, updated_at = now() where id = _r.id;
    return jsonb_build_object('ok', true, 'unsent', true, 'cancelled', _cancelled > 0, 'pages', _pages);
end;
$function$;

-- Group work on the student's page: for each piece set to One per Group
-- that the student's group is on and that is on the page, how many are in
-- the group, whether the group's work is in, how many pages, and whether
-- the student sent some of it. No other student's name or id. Read-only.
create or replace function student_submit.group_work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
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
    return jsonb_build_object('ok', true, 'assessments', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', a.id,
                   'members', cardinality(m.ids),
                   'sent', w.subs > 0,
                   'pages', w.pages,
                   'you_sent', w.mine > 0,
                   'first_sent_at', w.first_at)
                 order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
          from assessment a
         cross join lateral (select _group_members(a.id, p_enrollment_id) as ids) m
         cross join lateral (
             select count(distinct s.id) as subs, count(f.id) as pages,
                    count(distinct s.id) filter (where s.enrollment_id = p_enrollment_id) as mine,
                    min(s.sent_at) as first_at
               from submission s left join submission_file f on f.submission_id = s.id
              where s.assessment_id = a.id and s.state = 'sent' and s.enrollment_id = any (m.ids)) w
         where a.course_id = _course.id and m.ids is not null
           and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));
end;
$function$;

-- The group's pages for one piece, handed in, for the edge function to make
-- short-lived links to: the student's own and their group's. mine says
-- which the student sent. A piece that is not group work, or a student in
-- no group, gets their own pages only (as Batch B's file_links). Read-only.
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
               and s.enrollment_id = any (coalesce(_group_members(p_assessment_id, p_enrollment_id), array[p_enrollment_id]))), '[]'::jsonb));
end;
$function$;

-- ── Who can run what ────────────────────────────────────────────────────────
-- The teacher's RPCs: signed-in teachers, through the API.
revoke all on function public.set_course_feedback_options(uuid, jsonb, uuid) from public, anon;
revoke all on function public.save_markup(uuid, jsonb, integer, uuid) from public, anon;
revoke all on function public.list_assessment_markup(uuid) from public, anon;
revoke all on function public.return_work(uuid, uuid[], uuid) from public, anon;
revoke all on function public.return_for_revision(uuid, uuid, jsonb, uuid) from public, anon;
revoke all on function public.set_revision_request(uuid, jsonb, uuid) from public, anon;
revoke all on function public.cancel_revision(uuid, uuid) from public, anon;
revoke all on function public.answer_reflection(uuid, text, uuid, boolean) from public, anon;
revoke all on function public.list_course_feedback(uuid) from public, anon;
grant execute on function public.set_course_feedback_options(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.save_markup(uuid, jsonb, integer, uuid) to authenticated, service_role;
grant execute on function public.list_assessment_markup(uuid) to authenticated, service_role;
grant execute on function public.return_work(uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.return_for_revision(uuid, uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.set_revision_request(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.cancel_revision(uuid, uuid) to authenticated, service_role;
grant execute on function public.answer_reflection(uuid, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.list_course_feedback(uuid) to authenticated, service_role;

-- Helpers in public: nobody is granted them, the service role included.
revoke all on function public._work_feedback_gone() from public, anon, authenticated, service_role;
revoke all on function public._work_feedback_truncated() from public, anon, authenticated, service_role;
revoke all on function public._markup_check(jsonb) from public, anon, authenticated, service_role;
revoke all on function public._markup_give(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public._piece_latest(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public._revision_state(uuid) from public, anon, authenticated, service_role;
revoke all on function public._revision_settle(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public._revision_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public._reflection_json(uuid) from public, anon, authenticated, service_role;

-- Batch B's _grading_started, replaced in 2b, stays granted to nobody.
revoke all on function student_submit._grading_started(uuid, uuid) from public, anon, authenticated, service_role;

-- The student's side: the service role only. The helpers are granted to nobody.
revoke all on function student_submit._group_members(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function student_submit.feedback(text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.markup(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.reflect(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function student_submit.reply(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function student_submit.answer_seen(text, uuid, uuid[], text) from public, anon, authenticated;
revoke all on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.revision_finish(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function student_submit.revision_unsend(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.group_work(text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.group_file_links(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.feedback(text, uuid, text) to service_role;
grant execute on function student_submit.markup(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.reflect(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.reply(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.answer_seen(text, uuid, uuid[], text) to service_role;
grant execute on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text) to service_role;
grant execute on function student_submit.revision_finish(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.revision_unsend(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.group_work(text, uuid, text) to service_role;
grant execute on function student_submit.group_file_links(text, uuid, uuid, text) to service_role;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._work_feedback_gone()',                                       '5c760a38a7675c1d49ef95ab994b76e5', '5c760a38a7675c1d49ef95ab994b76e5'),
            ('public._work_feedback_truncated()',                                  '450e3b27b73c51d01f4c431adb402bbd', '450e3b27b73c51d01f4c431adb402bbd'),
            ('public._markup_check(jsonb)',                                        'd5fac66f176bf8f23391a7c6c19b053a', 'd5fac66f176bf8f23391a7c6c19b053a'),
            ('public._markup_give(uuid,uuid)',                                     'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
            ('public._piece_latest(uuid,uuid)',                                    'fee319ef4d87447eeac9b4d53a1f1b50', 'fee319ef4d87447eeac9b4d53a1f1b50'),
            ('public._revision_state(uuid)',                                       '808f6944ea937a32576729e48115e58d', '808f6944ea937a32576729e48115e58d'),
            ('public._revision_settle(uuid,uuid,boolean)',                         '5abc02afbaa29294cdb317838657b37c', '5abc02afbaa29294cdb317838657b37c'),
            ('public._revision_json(uuid)',                                        '4ea85d4b58243fc0d6512b31ac6d165e', '4ea85d4b58243fc0d6512b31ac6d165e'),
            ('public._reflection_json(uuid)',                                      'f089277294adaf7d7834b41a1e93d5fa', 'f089277294adaf7d7834b41a1e93d5fa'),
            ('public.set_course_feedback_options(uuid,jsonb,uuid)',                '1954af2eef430d63baa91d38e74106d2', '1954af2eef430d63baa91d38e74106d2'),
            ('public.save_markup(uuid,jsonb,integer,uuid)',                        '808290a14511b137bc5c1a4574016429', '808290a14511b137bc5c1a4574016429'),
            ('public.list_assessment_markup(uuid)',                                '5e64579a923a0f0c02791b6428e54d98', '5e64579a923a0f0c02791b6428e54d98'),
            ('public.return_work(uuid,uuid[],uuid)',                               '13f1d5ec77567d5909c49c493ad77b64', '13f1d5ec77567d5909c49c493ad77b64'),
            ('public.return_for_revision(uuid,uuid,jsonb,uuid)',                   '0f3cc087f25815ba377919f68b870f36', '0f3cc087f25815ba377919f68b870f36'),
            ('public.set_revision_request(uuid,jsonb,uuid)',                       '6f9fb14cc1c8ced04cca7e0302c40b13', '6f9fb14cc1c8ced04cca7e0302c40b13'),
            ('public.cancel_revision(uuid,uuid)',                                  '15fb7d84333ed19b362e778b6667f377', '15fb7d84333ed19b362e778b6667f377'),
            ('public.answer_reflection(uuid,text,uuid,boolean)',                   '3dc0da991f10c092ae0a80202310d56f', '3dc0da991f10c092ae0a80202310d56f'),
            ('public.list_course_feedback(uuid)',                                  '7fbe6b367a0c28fd4dd2b894f0dc7711', '7fbe6b367a0c28fd4dd2b894f0dc7711'),
            ('student_submit._group_members(uuid,uuid)',                           'b38b1af6f2dc142c94ce1cca454fd0fb', 'b38b1af6f2dc142c94ce1cca454fd0fb'),
            ('student_submit.feedback(text,uuid,text)',                            '4ee8ebfb4b2af25698d2fb3eafc7f9ea', '4ee8ebfb4b2af25698d2fb3eafc7f9ea'),
            ('student_submit.markup(text,uuid,uuid,text)',                         '6cc78118aa4e98252514826aabf957a9', '6cc78118aa4e98252514826aabf957a9'),
            ('student_submit.reflect(text,uuid,uuid,jsonb,text)',                  '7a4e2ab29d369ef159dce65e1e1e8f77', '7a4e2ab29d369ef159dce65e1e1e8f77'),
            ('student_submit.reply(text,uuid,uuid,jsonb,text)',                    '264a736a722cf19022c20c343ecb01fb', '264a736a722cf19022c20c343ecb01fb'),
            ('student_submit.answer_seen(text,uuid,uuid[],text)',                  'da85d013a0511618c989d7bb44eac2f3', 'da85d013a0511618c989d7bb44eac2f3'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84', '43ca2e50ff067a4fb51762367895ee84'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',          'a04e2d62a76b00a7f6ad03a76a0ede74', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
            ('student_submit.revision_unsend(text,uuid,uuid,text)',                '73ac162e56dde98d11ffcd03aa4b5ffa', '73ac162e56dde98d11ffcd03aa4b5ffa'),
            ('student_submit.group_work(text,uuid,text)',                          '1db83448b1b3d7ae998870bdb07c4f36', '1db83448b1b3d7ae998870bdb07c4f36'),
            ('student_submit.group_file_links(text,uuid,uuid,text)',               '1c034fa5647b5808209b0ef9b31e8e4d', '1c034fa5647b5808209b0ef9b31e8e4d')
            -- FINGERPRINTS-END
        ) as v(fn, becomes, or_c2)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes and _md5 <> _f.or_c2 then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/batch_c_fingerprints.py)
            ('student_submit._grading_started(uuid,uuid)', '720b9f044b853b5c57b04bec7f59010c', '13622bbca72904fdf877ce6b336dc6b4')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    -- S0-M5's check: every SECURITY DEFINER function in the app's three
    -- schemas names pg_temp last in its search_path.
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
