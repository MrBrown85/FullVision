-- Photo lifecycle (Batch D, S8-M1), 2026-11-11. Student page build plan 1.7
-- and slice S8; DECISIONS, "Grades, photos and sign-in on the student page"
-- 5 and 6, "Student page build rulings (2026-11-10, late night)" 5, and
-- Colin's rulings 105, 106, 108 and 109 (Nov 11). Revised after its
-- independent review (batch-d-review.md, NOT READY: M1 to M4 and the
-- should-fix points, all built here).
--
-- THIS FILE DELETES STUDENTS' PHOTOS ON A SCHEDULE (project rule 2: the
-- owner reviews it). Applying it deletes nothing that night by itself unless
-- a class's Keep Photos Until day has passed (the pre-check lists, class by
-- class, the day and how many pages are before it); from then on, every
-- night:
--   - KEEP PHOTOS UNTIL. In the night after a class's Keep Photos Until day,
--     every page (photo or PDF page) and thumbnail of that class's handed-in
--     work that was handed in by the end of that day is deleted, for good (no
--     second copy: DECISIONS, "Grades, photos and sign-in" 6). Work handed
--     in after midnight stays for the next date, a send started before
--     midnight and finished after it included (ruling 106). Grades,
--     comments, Mark Up and the record that the work was handed in stay
--     (section 3). A class in the trash is skipped.
--   - STRAYS. A file in the student-photos bucket that no page row names,
--     more than 24 hours old, is deleted (Colin accepted 24 hours).
--   - EXPIRED SENDS. A send or an upload not finished within its two hours
--     is dropped and its files deleted, in a class nobody has used since
--     (Batch B already does this for a class in use).
-- And every ten minutes, files already queued for deletion are deleted from
-- storage (section 6): until now that waited for a student's route or a
-- teacher's sweep.
-- A page row whose file is missing is REPORTED, never deleted (section 5).
--
-- Apply AFTER, all on live: Batch B (2026111101, 2026111102), its fixes
-- (2026111104), Batch C (2026111120, 2026111121) and the send rules
-- (2026111130). It REPLACES ONE FUNCTION, student_submit._grading_started
-- (C1's), adding one condition: Mark Up kept after its photos went still
-- counts as grading started (section 3). It changes no trigger, policy or
-- grant that exists. It adds three tables, nine functions, one procedure and
-- two pg_cron jobs.
--
-- ── 1. Keep Photos Until: which day ─────────────────────────────────────────
-- course.keep_photos_until (Batch B) is 'end_of_year' (the default) or
-- 'end_of_term'. The day is worked out exactly as the teacher's screen
-- works it out and shows it (teacher/cm-student-page.js keepPhotosDate,
-- changed in this PR to match: "Photos of student work in this class are
-- deleted on ..."), on the class's own calendar day
-- (_fv_timezone(course.timezone)):
--   End of Year   June 30 of the school year the class is in: from August
--                 on, next June 30; January to July, this June 30.
--   End of Term   the last day (ends_on) of the reporting term the class is
--                 in, else the next to end; with no term end ahead (every
--                 term has ended, or there are none) it is End of Year's
--                 June 30. So after the last term the photos are kept to
--                 June 30, not deleted night by night.
-- The terms are course.reporting_terms, the class's own (Class Settings'
-- terms editor; the school presets of shared/reporting-term-presets.js are
-- copied into it). A day that is not a real date is skipped (_fv_date).
-- public._keep_photos_day is that rule, and the only place it is written.
--
-- ── 2. Keep Photos Until: when ──────────────────────────────────────────────
-- The photos are kept THROUGH the day and deleted in the night after it,
-- when this file's nightly job runs (10:27 UTC: 3:27 in the morning in
-- British Columbia by the time zone data this was tested with, which keeps
-- BC on one clock all year; 2:27 in winter if the clocks still change). On
-- each run, for each class with work handed in that is not in the trash:
--   today        the class's calendar day now;
--   days looked at  from the day after the last one this job looked at for
--                the class, up to yesterday (400 days at most). Yesterday
--                only on the class's first night, and yesterday only when
--                the class's Keep Photos Until or its terms are not what the
--                job last judged with (public.photo_keep_check keeps both):
--                a day the job missed is judged only by the setting the
--                teacher saw on it.
--   due day      the latest day looked at whose Keep Photos Until day, as
--                the screen showed it on that day, was that day or earlier.
--   cutoff       midnight at the start of the day after the due day, in
--                the class's time zone.
-- A page of the class's handed-in work (state sent, any version, sent by
-- the student or added by the teacher) is deleted when its row was made
-- before the cutoff, EXCEPT a page whose send started within its two-hour
-- hold before the cutoff (_work_hold) on work handed in or added to at or
-- after the cutoff (submission.sent_at or updated_at): that was handed in
-- after the day (ruling 106 marks it Late) and stays for the next date. The
-- exception errs toward keeping: work touched after midnight for another
-- reason (a page rotated) keeps a page started in the last two hours too.
-- A night the job could not run is caught up the next night.
-- What the teacher sees, kept true by this rule:
--   "Photos ... are deleted on June 30": kept all of June 30, gone that
--     night.
--   A choice whose day is already gone asks "Delete Photos Now? ... this
--     deletes the photos ... tonight" (ruling 102): gone that night.
--   Switching to End of Term in Term 2 shows Term 2's last day: nothing is
--     deleted before it, even when the switch falls in nights the job
--     missed.
-- July: End of Year's day is the June 30 just gone until August starts, so
-- work sent in July is deleted the night after it is sent (the screen shows
-- June 30, a day gone, and says so).
--
-- ── 3. What is kept and what goes (the owner's rule: "Grades, comments
--       and Mark Up stay; the photos and files are deleted") ──────────────
--   GOES   each page's row (submission_file) and so both its files: the
--          trigger Batch B put on the table queues the page and its
--          thumbnail for deletion in the same transaction, reason
--          keep_photos_until. From then on no screen lists the page, no
--          link is made for it, and the files leave storage at the next
--          removal run (section 6). Pages whose row is gone are exactly what
--          every function already reads right (Unsend, Replace and delete
--          make the same shape).
--   STAYS  every grade, comment, Overall Comment, Note for the Report,
--          revision request and reflection: no function here writes a
--          score table, grade_return, revision_request or
--          feedback_reflection.
--   STAYS  the submission row: that the work was handed in, when, by whom,
--          Late, the student's note and Did You Do It?. It is left with no
--          pages, like work Handed In on Paper.
--   STAYS  Mark Up. A page's marks (markup) are deleted with the page by
--          Batch C's foreign key, so before the page goes each of its marks
--          rows is copied, whole, into public.markup_kept with the page's
--          number, size and rotation. markup_kept goes when its submission
--          goes (a teacher's delete, a student, piece or class deleted).
--          Nothing reads it but the lock below: no screen shows marks
--          without their photo.
--   LOCK   Kept marks still count as grading started (ruling 109):
--          student_submit._grading_started gains one condition, a
--          markup_kept row of the student's work for the piece with at
--          least one mark in its working copy. So a student's Unsend or
--          Replace cannot delete kept marks after the photos go.
--
-- ── 4. Strays (a file with no row) ──────────────────────────────────────────
-- Every night: a current file in the student-photos bucket whose name is no
-- page's path or thumbnail path, made more than 24 hours ago, not already
-- waiting in the queue, is queued for deletion (reason stray). Only names in
-- the bucket's layout (<class>/<piece>/<student>/<submission>/<id>.jpg or
-- -thumb.jpg, lower-case ids: the only names the edge function's worker
-- deletes) are queued; a file with any other name is counted and reported,
-- not queued. A path a page row holds is never queued: a page's path is
-- made from its own new id before any upload link for it exists, and its
-- upload links are dead 4 hours 10 minutes after its send started, so a
-- file 24 hours old with no row cannot belong to a page still to come. A
-- stray already deleted once and back again is queued again.
-- Every class is visited that has work OR whose folder is in the bucket
-- (a class whose students or pieces were all deleted still has its strays
-- found). Each class's strays are queued under that class's lock, read by a
-- name range on storage's own (bucket_id, name) index, so the lock is held
-- only for that class's own files. Files of classes that no longer exist,
-- and files of other names, are found once a night outside any lock.
--
-- ── 5. Rows whose file is missing ───────────────────────────────────────────
-- Every night, for each class: pages of handed-in work whose page or
-- thumbnail is not in storage (as send_finish reads it, _work_object) are
-- counted and REPORTED in public.photo_check_log (kind missing_file, the
-- page ids, never a name), and nothing is changed. Read it with:
--   select at, course_id, kind, n, detail from public.photo_check_log
--    where kind in ('missing_file', 'stray_other_name', 'error') order by at desc;
--
-- ── 6. The removal timer: pg_cron, pg_net and the edge function ─────────────
-- SQL cannot delete a file (Batch B, section 4): only the Storage API can,
-- and only the student-submit edge function's worker calls it. So:
--   fv_photo_removal (pg_cron, every 10 minutes) runs
--     public.photo_removal_call(): when a queued file is due (as
--     removal_batch would hand it out) and none was handed out in the last
--     five minutes, it reads two Vault secrets, fv_photo_sweep_url (exactly
--     https://novsfeqjhbleyyaztmlh.supabase.co/functions/v1/student-submit
--     ?forceFunctionRegion=ca-central-1: this project's own address) and
--     fv_photo_sweep_secret (64 lower-case hex characters), and posts
--     {route: 'scheduled-sweep', secret} to the function through pg_net.
--     The function checks the secret against its own PHOTO_SWEEP_SECRET and
--     runs the worker for up to 40 seconds (supabase/functions/student-
--     submit/send-routes.ts, in this PR: it needs a deploy).
--   When nothing is due, nothing is sent. Without the two secrets, or with a
--   wrong address, a due run fails, so pg_cron's record shows it.
-- A CALL THAT FAILS IS SEEN. pg_net sends after the run has ended, so the
-- run cannot know whether the function answered (a wrong secret, a function
-- not deployed, sign-in checking turned on, a timeout). What it can know is
-- that files stay due: a file due for more than 6 hours (queued, not
-- deleted, its upload links dead) means the calls are not working. Then:
--   photo_removal_call writes an error row to photo_check_log (once an
--     hour at most) and still posts the call;
--   the nightly job writes one too and ENDS IN AN ERROR, so
--     cron.job_run_details shows the night's run as failed until the files
--     go.
-- Why this way (the safest of the ways looked at): the database already
-- knows when a file is due and already runs pg_cron (fv_grade_return_
-- repair_daily); pg_net is Supabase's own extension for a call out of the
-- database and is what Supabase documents for scheduling an edge function;
-- the call carries a secret that can do one thing, run the worker that
-- deletes only what the database queued, so a leak of it cannot read or
-- delete anything else (it is not the service key), and it is only ever
-- sent to this project's own address. An outside scheduler (GitHub Actions,
-- a Netlify function) would keep a secret outside Canada's region and
-- outside the project, and fails quietly. Storage's own lifecycle rules
-- delete by age, not by what the database decided.
-- pg_cron keeps a row in cron.job_run_details for every run (144 a day for
-- this job) and never removes them; that is pg_cron's own table.
--
-- ── 7. The nightly job ──────────────────────────────────────────────────────
-- fv_photo_lifecycle_daily (pg_cron, 10:27 UTC) calls
-- public.photo_lifecycle_nightly(), a procedure that commits after each
-- class, so it never holds more than one class's lock; a class whose step
-- fails (a lock it waited 10 seconds for, any error) is written to
-- photo_check_log and the next class is done; that class is caught up the
-- next night. For each class with work or a folder in the bucket: take the
-- class's lock first; drop expired sends; Keep Photos Until (not for a class
-- in the trash: its photos go with the 30-day purge, or are judged as usual
-- from the night after it is restored); strays under that class; the
-- missing check. Then the strays of classes that no longer exist and files
-- with other names; the stuck-queue check (section 6); the log's rows older
-- than 90 days and the job state of classes that no longer exist. If any
-- part failed it ends with an error after everything else is committed, so
-- cron.job_run_details shows it.
--
-- ── 8. Every other way a row goes (ruling 105: "the files go when their
--       row goes, by whatever path") ──────────────────────────────────────
-- Checked in the harness (photo_lifecycle.py, scenario paths), no change
-- needed: deleting an assessment, permanently deleting a withdrawn student,
-- deleting a student record, the 30-day class purge and the 30-day purge of
-- a deleted teacher account (fv_retention_cleanup), a stand-in for
-- clear_data() (its body is not in this repository: it deletes the
-- caller's classes and students), and TRUNCATE. Each reaches submission
-- through Batch B's triggers on enrollment and assessment
-- (submission_gone, submission_truncate) and each page row's delete queues
-- its files (submission_file_removed). The stray check (section 4) finds a
-- file any other path leaves behind, in every class.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless: Batch B, the fixes, C1, C2 and the
-- send rules are in at the fingerprints they were tested with (md5 of
-- pg_get_functiondef on PostgreSQL 17; the lists below, written by
-- migrations/local-test/photo_lifecycle.py fingerprints), the one function
-- it replaces as C1 left it or as this file leaves it; pg_cron (cron.job,
-- cron.schedule), pg_net (net.http_post) and Vault (vault.decrypted_secrets)
-- are installed; none of its names is taken (or, on a second run, each
-- function is as this file leaves it); no pg_cron job of either name runs
-- something else.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- Making the tables and functions takes no lock on an existing table but
-- submission, for an instant (markup_kept's foreign key). If a long
-- transaction holds it, the file gives up after five seconds with nothing
-- applied: run it again.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/photo-lifecycle-live-precheck.sql
--   first query: expected no rows; second query: one row per class with
--   photos, its Keep Photos Until day and how many pages are before it.
-- migrations/local-test/photo-lifecycle-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/photo-lifecycle-undo.sql (proved by
-- photo_lifecycle.py undo). PART 1 unschedules the two jobs: nothing more is
-- deleted on a schedule (queued files then wait for a student's route or a
-- sweep, as before). A run already going is not stopped by it. PART 2 puts
-- C1's _grading_started back and drops what this file made; it refuses
-- while markup_kept holds a mark. A photo already deleted stays deleted:
-- nothing can bring it back. The order out: this undo first, then the send
-- rules', Batch C's, the fixes' and Batch B's (markup_kept's foreign key is
-- on submission, which Batch B's undo drops).
--
-- One transaction: all or nothing. Every check that can stop it runs first.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    if to_regclass('public.submission') is null or to_regclass('public.markup') is null
       or to_regclass('public.revision_request') is null then
        raise exception 'Batch B and Batch C are not both applied (public.submission, public.markup, public.revision_request): apply them first. Nothing was changed.';
    end if;
    -- Batch B, its fixes, C1, C2 and the send rules, as tested.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/photo_lifecycle.py)
            ('public._grade_return_lock(uuid)',                                      '530dca441198b1546a4ec4967cd83b9f'),
            ('public._grade_return_lock_first(uuid)',                                '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._fv_timezone(text)',                                            '8dbcb5716f155e2441f47416a0b28527'),
            ('public._fv_date(text)',                                                '0dcf865b5254cf0f9535df0fac1cb8a4'),
            ('public._work_bucket()',                                                '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_object(text)',                                            '1c78c7884df1e02c326b06989da25c5c'),
            ('public._work_hold()',                                                  'e0479f5f0ab703fd3cd77f677ec34eb2'),
            ('public._work_drop_expired(uuid)',                                      '417711d4dadba3966d0358baee0214f0'),
            ('public._submission_file_removed()',                                    'edc99e4c04baefcf83b9ce3c94723023'),
            ('public._submission_gone()',                                            '606be06c71d963805c12f23208b5c304'),
            ('public._submission_truncated()',                                       '9abaa6530a1e7f7215951d9952675de0'),
            ('public._submission_target_gone()',                                     'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('student_submit.removal_batch(integer)',                                '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                                'de793c82a2b5aa59052994a82e80d166'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                '340cb72444d555a9cef594b543e2674c'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '6cad6dd40eb1c33451a5dcf4f60e7624'),
            ('student_submit.work(text,uuid,text)',                                  '2ec445c5d5afadb7c3fc1699d9929e52'),
            ('student_submit.send_paths(text,uuid,uuid,text)',                       '2f36c08b8ace950b9c7eb905b320aa40'),
            ('fv_private.work_path_course(text)',                                    '7fb0272243ceef1cb6b42658d27664e3'),
            ('public._revision_gone()',                                              '13b5fb325c563a0475437829446ef089'),
            ('public._markup_on_return()',                                           'ce8ceaa830617aa9caf935b161d7e379'),
            ('public._markup_on_release()',                                          'a7e8838702d000c42621d72bf8621dfb')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Apply Batch B, its fixes, Batch C and the send rules first; a later migration may have replaced it. Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The one it replaces: as C1 left it, or as this file leaves it (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/photo_lifecycle.py)
            ('student_submit._grading_started(uuid,uuid)', '13622bbca72904fdf877ce6b336dc6b4', '586a6a0b5910e6c153b72e73a5b672bc')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- What it adds: absent, or as this file leaves it (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/photo_lifecycle.py)
            ('public._keep_photos_day(text,jsonb,date)',                 'ad345bdd6eadab44296ed32ef7870be6'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', '57f0aac3911eb4657447a951232bed4a'),
            ('public._photo_keep_class(uuid,timestamp with time zone)',  'fb78dde9520f84f0f58faa1bebf98c23'),
            ('public._photo_strays(uuid,timestamp with time zone)',      '21db626094c7be734d536357c91826c8'),
            ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
            ('public._photo_stuck()',                                    '8f35709beffa04b59f36840e2d4e2fa0'),
            ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
            ('public.photo_removal_call()',                              '08b22d449cc3312b31b975ee057fbc08')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists, and is not as this file leaves it (found %): something else made it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if to_regclass('public.markup_kept') is null and (to_regclass('public.photo_keep_check') is not null
                                                      or to_regclass('public.photo_check_log') is not null) then
        raise exception 'photo_keep_check or photo_check_log already exists, and markup_kept does not: something else made it. Nothing was changed.';
    end if;
    -- pg_cron, pg_net and Vault (section 6).
    if to_regclass('cron.job') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
        raise exception 'pg_cron is not installed (cron.job, cron.schedule): the timer needs it. Nothing was changed.';
    end if;
    if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
        raise exception 'pg_net is not installed (net.http_post): turn it on (Database, Extensions, pg_net), then run this file. Nothing was changed.';
    end if;
    if to_regclass('vault.decrypted_secrets') is null then
        raise exception 'Vault is not installed (vault.decrypted_secrets). Nothing was changed.';
    end if;
end
$guard$;

-- A job of either name that runs something else is not this file's to take
-- over. (cron.job is named only inside execute, so this is planned only
-- where pg_cron is.)
do $jobs$
declare
    _bad text;
begin
    execute 'select string_agg(jobname, '', '') from cron.job'
         || ' where (jobname = ''fv_photo_lifecycle_daily'' and command <> ''call public.photo_lifecycle_nightly()'')'
         || '    or (jobname = ''fv_photo_removal'' and command <> ''select public.photo_removal_call()'')' into _bad;
    if _bad is not null then
        raise exception 'a pg_cron job named % runs something else. Nothing was changed.', _bad;
    end if;
end
$jobs$;

-- ── Tables ──────────────────────────────────────────────────────────────────
-- Mark Up of a page Keep Photos Until removed (section 3): the markup row,
-- whole, and the page it was drawn on. Goes with its submission. No
-- foreign key to anything but submission, for the reason submission has
-- none (one lock per class, taken first; a submission is only deleted under
-- it, so the cascade here takes no lock in the other order).
create table if not exists public.markup_kept (
    file_id       uuid        primary key,      -- the page's id, as it was
    submission_id uuid        not null references public.submission(id) on delete cascade,
    course_id     uuid        not null,
    assessment_id uuid        not null,
    enrollment_id uuid        not null,
    page          smallint    not null,
    width         integer,
    height        integer,
    rotation      smallint    not null,
    added_by      text        not null,
    working       jsonb,
    working_rev   integer     not null,
    working_at    timestamptz,
    given         jsonb,
    given_rev     integer,
    given_at      timestamptz,
    marked_at     timestamptz not null,       -- markup.created_at
    photo_removed_at timestamptz not null default now()
);
create index if not exists markup_kept_submission_idx on public.markup_kept (submission_id);
create index if not exists markup_kept_course_idx on public.markup_kept (course_id);
-- what _grading_started asks
create index if not exists markup_kept_piece_idx on public.markup_kept (assessment_id, enrollment_id);
comment on table public.markup_kept is
    'Mark Up of pages whose photo Keep Photos Until deleted (2026111140): the markup row and its page''s number, size and rotation. Goes with its submission. Owner only; read by student_submit._grading_started.';

-- What the nightly job last judged each class by: the last calendar day (the
-- class's) it looked at, and the Keep Photos Until choice and terms it
-- looked at them with (section 2).
create table if not exists public.photo_keep_check (
    course_id       uuid primary key,          -- no foreign key: rows of a class that is gone are removed by the job
    checked_through date not null,
    judged_choice   text,
    judged_terms    jsonb,
    at              timestamptz not null default now()
);
comment on table public.photo_keep_check is
    'Keep Photos Until (2026111140): the last day of each class the nightly job has looked at, and the choice and terms it looked with, so a night it missed is caught up only under the setting the teacher saw. Owner only.';

-- What the nightly job did and found.
create table if not exists public.photo_check_log (
    id        bigint generated always as identity primary key,
    at        timestamptz not null default now(),
    course_id uuid,
    -- keep_photos_until (pages deleted), expired (unfinished sends dropped),
    -- stray_queued, stray_other_name (reported only), missing_file (reported
    -- only), error (a step that failed, or files stuck in the queue)
    kind      text not null constraint photo_check_log_kind_check
              check (kind in ('keep_photos_until', 'expired', 'stray_queued', 'stray_other_name', 'missing_file', 'error')),
    n         integer not null,
    detail    jsonb
);
create index if not exists photo_check_log_at on public.photo_check_log (at);
comment on table public.photo_check_log is
    'What public.photo_lifecycle_nightly() deleted, queued and found (2026111140). Ids and counts only, never a name. Owner only. Rows older than 90 days are removed by the procedure.';

alter table public.markup_kept enable row level security;
alter table public.photo_keep_check enable row level security;
alter table public.photo_check_log enable row level security;
revoke all on table public.markup_kept, public.photo_keep_check, public.photo_check_log from public, anon, authenticated, service_role;
revoke all on sequence public.photo_check_log_id_seq from public, anon, authenticated, service_role;

-- ── Functions ───────────────────────────────────────────────────────────────
-- The Keep Photos Until day for a choice and a class's terms, as the screen
-- shows it on day p_on (section 1; teacher/cm-student-page.js keepPhotosDate).
create or replace function public._keep_photos_day(p_choice text, p_terms jsonb, p_on date)
 returns date
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    with j as (
        select make_date(extract(year from p_on)::int + case when extract(month from p_on) >= 8 then 1 else 0 end, 6, 30) as june
    ), e as (
        select public._fv_date(t->>'ends_on') as d
          from jsonb_array_elements(case when jsonb_typeof(p_terms) = 'array' then p_terms else '[]'::jsonb end) t
    )
    select case
             when p_choice is distinct from 'end_of_term' then j.june
             -- the term the class is in, else the next to end; none ahead: End of Year's day
             else coalesce((select min(e.d) from e where e.d >= p_on), j.june)
           end
      from j;
$function$;

-- The moment before which a class's photos go tonight (section 2), or null
-- when none go. p_now is the run's time (the nightly job passes now()).
create or replace function public._photo_keep_cutoff(p_course_id uuid, p_now timestamptz)
 returns timestamptz
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _c     record;
    _k     record;
    _tz    text;
    _today date;
    _from  date;
    _due   date;
begin
    select c.keep_photos_until, c.reporting_terms, c.timezone into _c from course c where c.id = p_course_id;
    if not found then return null; end if;
    _tz := _fv_timezone(_c.timezone);
    _today := (p_now at time zone _tz)::date;
    select k.checked_through, k.judged_choice, k.judged_terms into _k from photo_keep_check k where k.course_id = p_course_id;
    if not found or _k.judged_choice is distinct from _c.keep_photos_until or _k.judged_terms is distinct from _c.reporting_terms then
        -- A first night, or a setting the job has not judged with: yesterday only.
        _from := _today - 1;
    else
        _from := greatest(_k.checked_through + 1, _today - 400);
    end if;
    select max(g.d::date) into _due
      from generate_series(_from, _today - 1, interval '1 day') g(d)
     where _keep_photos_day(_c.keep_photos_until, _c.reporting_terms, g.d::date) <= g.d::date;
    if _due is null then return null; end if;
    return (_due + 1)::timestamp at time zone _tz;
end;
$function$;

-- One row of the job's log.
create or replace function public._photo_log(p_course_id uuid, p_kind text, p_n integer, p_detail jsonb)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    insert into photo_check_log (course_id, kind, n, detail) values (p_course_id, p_kind, p_n, p_detail);
$function$;

-- One class's night (section 7), under its lock: expired sends dropped, then
-- Keep Photos Until (not in the trash). Returns what it did.
create or replace function public._photo_keep_class(p_course_id uuid, p_now timestamptz)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _expired int;
    _cutoff  timestamptz;
    _marks   int := 0;
    _pages   int := 0;
    _c       record;
begin
    -- The class's lock first, as every write to its work.
    perform _grade_return_lock_first(p_course_id);
    _expired := _work_drop_expired(p_course_id);
    if _expired > 0 then
        perform _photo_log(p_course_id, 'expired', _expired, null);
    end if;
    select c.timezone, c.deleted_at, c.keep_photos_until, c.reporting_terms into _c from course c where c.id = p_course_id;
    if not found or _c.deleted_at is not null then
        -- Gone, or in the trash: Keep Photos Until waits (section 7).
        return jsonb_build_object('expired', _expired, 'pages', 0, 'marks_kept', 0, 'before', null, 'skipped', found);
    end if;
    _cutoff := _photo_keep_cutoff(p_course_id, p_now);
    if _cutoff is not null then
        -- Mark Up stays (section 3): copied before its page goes.
        insert into markup_kept (file_id, submission_id, course_id, assessment_id, enrollment_id, page, width, height, rotation,
                                 added_by, working, working_rev, working_at, given, given_rev, given_at, marked_at)
        select m.file_id, f.submission_id, m.course_id, m.assessment_id, m.enrollment_id, f.page, f.width, f.height, f.rotation,
               f.added_by, m.working, m.working_rev, m.working_at, m.given, m.given_rev, m.given_at, m.created_at
          from markup m
          join submission_file f on f.id = m.file_id
          join submission s on s.id = f.submission_id
         where s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
           -- handed in after the day (ruling 106): stays
           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff)
        on conflict (file_id) do nothing;
        get diagnostics _marks = row_count;
        -- The pages go; Batch B's trigger queues both files of each.
        perform set_config('fv.work_removal_reason', 'keep_photos_until', true);
        delete from submission_file f
         using submission s
         where s.id = f.submission_id and s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff
           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff);
        get diagnostics _pages = row_count;
        perform set_config('fv.work_removal_reason', '', true);
        if _pages > 0 then
            perform _photo_log(p_course_id, 'keep_photos_until', _pages, jsonb_build_object('before', _cutoff, 'marks_kept', _marks));
        end if;
    end if;
    insert into photo_keep_check (course_id, checked_through, judged_choice, judged_terms, at)
    values (p_course_id, (p_now at time zone _fv_timezone(_c.timezone))::date - 1, _c.keep_photos_until, _c.reporting_terms, now())
    on conflict (course_id) do update
        set checked_through = greatest(photo_keep_check.checked_through, excluded.checked_through),
            judged_choice = excluded.judged_choice, judged_terms = excluded.judged_terms, at = now();
    return jsonb_build_object('expired', _expired, 'pages', _pages, 'marks_kept', _marks, 'before', _cutoff);
end;
$function$;

-- Strays (section 4). p_course_id: the strays in that class's folder, under
-- its lock, read by a name range on storage's (bucket_id, name) index. Null:
-- the strays whose first folder is no class (a class that is gone), and
-- files with any other name (reported only), outside any lock.
create or replace function public._photo_strays(p_course_id uuid, p_now timestamptz)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _layout constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){4}(-thumb)?\.jpg$';
    _queued int := 0;
    _other  int := 0;
begin
    if p_course_id is not null then
        perform _grade_return_lock_first(p_course_id);
        -- '/' then '0' are next to each other: every name that starts "<class>/", and no other
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.name >= (p_course_id::text || '/') collate "C" and o.name < (p_course_id::text || '0') collate "C"
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _layout
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, p_course_id, 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
    else
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _layout
               and not exists (select 1 from course c where c.id = fv_private.work_path_course(o.name))
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, fv_private.work_path_course(s.name), 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
        select count(*) into _other
          from storage.objects o
         where o.bucket_id = _work_bucket() and o.archived_at is null and not o.is_delete_marker
           and o.created_at < p_now - interval '24 hours' and o.name !~ _layout;
        if _other > 0 then
            perform _photo_log(null, 'stray_other_name', _other, null);
        end if;
    end if;
    if _queued > 0 then
        perform _photo_log(p_course_id, 'stray_queued', _queued, null);
    end if;
    return jsonb_build_object('queued', _queued, 'other_name', _other);
end;
$function$;

-- Pages of a class's handed-in work whose page or thumbnail is not in
-- storage (section 5). Read-only; the caller logs it. Never changes a row.
create or replace function public._photo_missing(p_course_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    with m as (
        select f.id
          from submission s
          join submission_file f on f.submission_id = s.id
         where s.course_id = p_course_id and s.state = 'sent'
           and (not exists (select 1 from _work_object(f.path)) or not exists (select 1 from _work_object(f.thumb_path)))
    )
    select jsonb_build_object('n', (select count(*) from m),
                              'file_ids', coalesce((select jsonb_agg(x.id order by x.id) from (select id from m order by id limit 50) x), '[]'::jsonb));
$function$;

-- Is a queued file due for the worker (as removal_batch hands them out),
-- with none handed out in the last five minutes?
create or replace function public.photo_removal_due()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select exists (select 1 from submission_file_removal r
                    where not r.done and (r.removed_at is null or r.link_dies_at <= now()))
       and not exists (select 1 from submission_file_removal r
                        where not r.done and r.last_try_at > now() - interval '5 minutes');
$function$;

-- Files due for the worker for more than 6 hours (section 6): the calls are
-- not working. { n, due_since } (the oldest), n 0 when none.
create or replace function public._photo_stuck()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object('n', count(*), 'due_since', min(x.since))
      from (select case when r.removed_at is null then r.queued_at else r.link_dies_at end as since
              from submission_file_removal r
             where not r.done and (r.removed_at is null or r.link_dies_at <= now())) x
     where x.since < now() - interval '6 hours';
$function$;

-- The timer's one step (section 6): when a file is due, ask the edge
-- function's worker to run. Returns pg_net's request id, or null when
-- nothing was due. Never puts the secret in a message.
create or replace function public.photo_removal_call()
 returns bigint
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _url    text;
    _secret text;
    _stuck  jsonb;
begin
    if not public.photo_removal_due() then
        return null;
    end if;
    select s.decrypted_secret into _url from vault.decrypted_secrets s where s.name = 'fv_photo_sweep_url';
    select s.decrypted_secret into _secret from vault.decrypted_secrets s where s.name = 'fv_photo_sweep_secret';
    if _url is null or _secret is null then
        raise exception 'photo removal: the Vault secrets fv_photo_sweep_url and fv_photo_sweep_secret are not both set; queued files wait.';
    end if;
    if _url <> 'https://novsfeqjhbleyyaztmlh.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1' then
        raise exception 'photo removal: fv_photo_sweep_url is not this project''s student-submit address with ?forceFunctionRegion=ca-central-1; nothing was sent.';
    end if;
    if _secret !~ '^[0-9a-f]{64}$' then
        raise exception 'photo removal: fv_photo_sweep_secret is not 64 lower-case hex characters.';
    end if;
    -- Files due for hours: the calls are not working. Said once an hour, and the call is still made.
    _stuck := public._photo_stuck();
    if (_stuck->>'n')::int > 0
       and not exists (select 1 from public.photo_check_log l
                        where l.kind = 'error' and l.detail ? 'stuck_files' and l.at > now() - interval '1 hour') then
        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));
    end if;
    return net.http_post(url := _url,
                         body := jsonb_build_object('route', 'scheduled-sweep', 'secret', _secret),
                         params := '{}'::jsonb,
                         headers := '{"Content-Type": "application/json"}'::jsonb,
                         timeout_milliseconds := 10000);
end;
$function$;

-- Kept marks count as grading started (section 3). C1's body, unchanged,
-- then one more condition: a markup_kept row of this student's work for the
-- piece with at least one mark, read as C1 reads markup.
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
                      and jsonb_array_length(coalesce(m.working->'marks', '[]'::jsonb)) > 0)
        -- Mark Up kept after Keep Photos Until took its photos (2026111140)
        or exists (select 1 from markup_kept k
                    where k.enrollment_id = p_enrollment_id and k.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(k.working->'marks', '[]'::jsonb)) > 0);
$function$;

-- ── The nightly job (section 7) ─────────────────────────────────────────────
-- A procedure, so it can commit after each class. (A procedure that commits
-- can have neither SECURITY DEFINER nor a search_path of its own, so every
-- name in it is schema-qualified; it runs as the job's owner.)
create or replace procedure public.photo_lifecycle_nightly()
 language plpgsql
as $procedure$
declare
    _course uuid;
    _failed integer := 0;
    _state  text;
    _msg    text;
    _miss   jsonb;
    _stuck  jsonb;
begin
    delete from public.photo_check_log where at < now() - interval '90 days';
    delete from public.photo_keep_check k where not exists (select 1 from public.course c where c.id = k.course_id);
    commit;
    -- Every class with work, and every class that has a folder in the bucket (section 4).
    for _course in
        select s.course_id from public.submission s
        union
        select c.id from public.course c
         where c.id in (select distinct fv_private.work_path_course(o.name) from storage.objects o
                         where o.bucket_id = public._work_bucket() and o.archived_at is null and not o.is_delete_marker)
        order by 1
    loop
        begin
            perform set_config('lock_timeout', '10s', true);
            perform public._photo_keep_class(_course, now());
            perform public._photo_strays(_course, now());
            _miss := public._photo_missing(_course);
            if (_miss->>'n')::int > 0 then
                perform public._photo_log(_course, 'missing_file', (_miss->>'n')::int, _miss->'file_ids');
            end if;
        exception when others then
            get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            perform public._photo_log(_course, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
            _failed := _failed + 1;
        end;
        commit;
    end loop;
    begin
        perform set_config('lock_timeout', '10s', true);
        perform public._photo_strays(null, now());
    exception when others then
        get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
        perform public._photo_log(null, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
        _failed := _failed + 1;
    end;
    commit;
    -- Files due for hours: the calls to the edge function are not working (section 6).
    _stuck := public._photo_stuck();
    if (_stuck->>'n')::int > 0 then
        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));
        _failed := _failed + 1;
    end if;
    commit;
    if _failed > 0 then
        raise exception 'photo_lifecycle_nightly: % part(s) of this run failed or found files stuck in the queue; the rest is done. See public.photo_check_log.', _failed;
    end if;
end;
$procedure$;

-- ── Who can run what: nobody but the owner (and pg_cron, as the owner) ──────
revoke all on function public._keep_photos_day(text, jsonb, date) from public, anon, authenticated, service_role;
revoke all on function public._photo_keep_cutoff(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public._photo_keep_class(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public._photo_strays(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public._photo_missing(uuid) from public, anon, authenticated, service_role;
revoke all on function public._photo_log(uuid, text, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._photo_stuck() from public, anon, authenticated, service_role;
revoke all on function public.photo_removal_due() from public, anon, authenticated, service_role;
revoke all on function public.photo_removal_call() from public, anon, authenticated, service_role;
revoke all on procedure public.photo_lifecycle_nightly() from public, anon, authenticated, service_role;
-- _grading_started keeps C1's grants (CREATE OR REPLACE keeps them): nobody.

-- ── The two jobs ────────────────────────────────────────────────────────────
do $cron$
begin
    if not exists (select 1 from cron.job where jobname = 'fv_photo_lifecycle_daily') then
        perform cron.schedule('fv_photo_lifecycle_daily', '27 10 * * *', 'call public.photo_lifecycle_nightly()');
    end if;
    if not exists (select 1 from cron.job where jobname = 'fv_photo_removal') then
        perform cron.schedule('fv_photo_removal', '*/10 * * * *', 'select public.photo_removal_call()');
    end if;
end
$cron$;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/photo_lifecycle.py)
            ('public._keep_photos_day(text,jsonb,date)',                 'ad345bdd6eadab44296ed32ef7870be6'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', '57f0aac3911eb4657447a951232bed4a'),
            ('public._photo_keep_class(uuid,timestamp with time zone)',  'fb78dde9520f84f0f58faa1bebf98c23'),
            ('public._photo_strays(uuid,timestamp with time zone)',      '21db626094c7be734d536357c91826c8'),
            ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
            ('public._photo_stuck()',                                    '8f35709beffa04b59f36840e2d4e2fa0'),
            ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
            ('public.photo_removal_call()',                              '08b22d449cc3312b31b975ee057fbc08')
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
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/photo_lifecycle.py)
            ('student_submit._grading_started(uuid,uuid)', '13622bbca72904fdf877ce6b336dc6b4', '586a6a0b5910e6c153b72e73a5b672bc')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    if (select count(*) from cron.job where jobname in ('fv_photo_lifecycle_daily', 'fv_photo_removal')) <> 2 then
        raise exception 'the two pg_cron jobs are not both scheduled. Nothing was changed.';
    end if;
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
