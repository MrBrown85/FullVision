-- Photo lifecycle (Batch D, S8-M1), 2026-11-11. Student page build plan 1.7
-- and slice S8; DECISIONS, "Grades, photos and sign-in on the student page"
-- 5 and 6, "Student page build rulings (2026-11-10, late night)" 5, and
-- Colin's rulings 105 and 108 (Nov 11).
--
-- THIS FILE DELETES STUDENTS' PHOTOS ON A SCHEDULE (project rule 2: the
-- owner reviews it). Applying it deletes nothing that night by itself unless
-- a class's Keep Photos Until day has passed; from then on, every night:
--   - KEEP PHOTOS UNTIL. In the night after a class's Keep Photos Until day,
--     every page (photo or PDF page) and thumbnail of that class's handed-in
--     work sent before that day ended is deleted, for good (no second copy:
--     DECISIONS, "Grades, photos and sign-in" 6). Grades, comments, Mark Up
--     and the record that the work was handed in stay (section 3).
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
-- (2026111130). None of them is changed: THIS FILE REPLACES NO FUNCTION AND
-- CHANGES NO TRIGGER, POLICY OR GRANT THAT EXISTS. It adds three tables,
-- eight functions, one procedure and two pg_cron jobs.
--
-- ── 1. Keep Photos Until: which day ─────────────────────────────────────────
-- course.keep_photos_until (Batch B) is 'end_of_year' (the default) or
-- 'end_of_term'. The day is worked out exactly as the teacher's screen
-- works it out and shows it (teacher/cm-student-page.js keepPhotosDate,
-- PR 1083: "Photos of student work in this class are deleted on ..."),
-- on the class's own calendar day (_fv_timezone(course.timezone)):
--   End of Year   June 30 of the school year the class is in: from August
--                 on, next June 30; January to July, this June 30.
--   End of Term   the last day (ends_on) of the reporting term the class is
--                 in, else the next to end; when every term has ended, the
--                 last one (a day already gone); with no terms, June 30.
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
-- each run, for each class with work handed in:
--   today        the class's calendar day now;
--   due day      the latest day D, from the day after the last one this job
--                looked at for the class up to yesterday (400 days at most;
--                yesterday only on the class's first run), whose Keep
--                Photos Until day, as the screen showed it on D, was D or
--                earlier. That is: the date the teacher was shown has come
--                and gone.
--   cutoff       midnight at the start of the day after the due day, in
--                the class's time zone.
-- Every page of the class's work handed in (state sent, any version, sent
-- by the student or added by the teacher) whose row was made before the
-- cutoff is deleted. A page sent after the cutoff stays for the next date.
-- A night the job could not run is caught up the next night: the days in
-- between are looked at too (the state is public.photo_keep_check). The
-- rule asks each day with the setting and the terms as they are NOW; if
-- the teacher changes either during nights the job missed, those nights
-- are judged by the new setting.
-- What the teacher sees, kept true by this rule:
--   "Photos ... are deleted on June 30": kept all of June 30, gone that
--     night.
--   A choice whose day is already gone asks "Delete Photos Now? ... this
--     deletes the photos ... tonight" (ruling 102): gone that night.
--   Switching to End of Term in Term 2 shows Term 2's last day: nothing is
--     deleted before it. (The yesterday-only first run and the caught-up
--     nights are what keep a Term 1 day already looked at from coming back.)
-- July and August: End of Year's day is the June 30 just gone until August
-- starts, so work sent in July is deleted the night after it is sent (the
-- screen shows June 30, a day gone, and says so).
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
--          revision request and reflection: no function here names a score
--          table, grade_return, revision_request or feedback_reflection.
--   STAYS  the submission row: that the work was handed in, when, by whom,
--          Late, the student's note and Did You Do It?. It is left with no
--          pages, like work Handed In on Paper.
--   STAYS  Mark Up. A page's marks (markup) are deleted with the page by
--          Batch C's foreign key, so before the page goes each of its marks
--          rows is copied, whole, into public.markup_kept with the page's
--          number, size and rotation. markup_kept goes when its submission
--          goes (Unsend, Replace, delete, a student, piece or class
--          deleted). Nothing reads it yet: no screen shows marks without
--          their photo. (Decisions for Colin.)
--   The marks that counted as "grading started" (ruling 109) leave the
--   markup table with the page; a piece with marks and no grade is then no
--   longer locked against the student's Unsend or Replace. (Decisions.)
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
-- stray already deleted once and back again is queued again. Each class's
-- strays are queued under that class's lock.
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
--     five minutes, it reads two Vault secrets, fv_photo_sweep_url (the
--     function's address with ?forceFunctionRegion=ca-central-1) and
--     fv_photo_sweep_secret (64 hex characters), and posts
--     {route: 'scheduled-sweep', secret} to the function through pg_net.
--     The function checks the secret against its own PHOTO_SWEEP_SECRET and
--     runs the worker for up to 40 seconds (supabase/functions/student-
--     submit/send-routes.ts, in this PR: it needs a deploy).
--   When nothing is due, nothing is sent. Without the two secrets, a due
--   run fails, so pg_cron's record (cron.job_run_details) shows it, and the
--   files wait in the queue as they do today.
-- Why this way (the safest of the ways looked at): the database already
-- knows when a file is due and already runs pg_cron (fv_grade_return_
-- repair_daily); pg_net is Supabase's own extension for a call out of the
-- database and is what Supabase documents for scheduling an edge function;
-- the call carries a secret that can do one thing, run the worker that
-- deletes only what the database queued, so a leak of it cannot read or
-- delete anything else (it is not the service key). An outside scheduler
-- (GitHub Actions, a Netlify function) would keep a secret outside Canada's
-- region and outside the project, and fails quietly. Storage's own
-- lifecycle rules delete by age, not by what the database decided.
--
-- ── 7. The nightly job ──────────────────────────────────────────────────────
-- fv_photo_lifecycle_daily (pg_cron, 10:27 UTC) calls
-- public.photo_lifecycle_nightly(), a procedure that commits after each
-- class, so it never holds more than one class's lock; a class whose step
-- fails (a lock it waited 10 seconds for, any error) is written to
-- photo_check_log and the next class is done; that class is caught up the
-- next night. For each class with work: take the class's lock first; drop
-- expired sends; Keep Photos Until; strays under that class; the missing
-- check. Then the strays of classes that no longer exist and files with
-- other names, then the log's rows older than 90 days and the job state
-- of classes that no longer exist. If any part failed it ends with an error
-- after everything else is committed, so cron.job_run_details shows it.
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
-- its files (submission_file_removed). The stray check is the backstop for
-- any path not thought of.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless: Batch B, the fixes, C1, C2 and the
-- send rules are in at the fingerprints they were tested with (md5 of
-- pg_get_functiondef on PostgreSQL 17; the list below, written by
-- migrations/local-test/photo_lifecycle.py fingerprints); pg_cron (cron.job,
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
-- migrations/local-test/photo-lifecycle-live-precheck.sql   expected: no rows.
-- migrations/local-test/photo-lifecycle-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/photo-lifecycle-undo.sql (proved by
-- photo_lifecycle.py undo). PART 1 unschedules the two jobs: nothing more is
-- deleted on a schedule (queued files then wait for a student's route or a
-- sweep, as before). PART 2 drops what this file made; it refuses while
-- markup_kept holds a mark. A photo already deleted stays deleted: nothing
-- can bring it back. The order out: this undo first, then the send rules',
-- Batch C's, the fixes' and Batch B's (markup_kept's foreign key is on
-- submission, which Batch B's undo drops).
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
            ('student_submit._grading_started(uuid,uuid)',                           '13622bbca72904fdf877ce6b336dc6b4'),
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
    -- What it adds: absent, or as this file leaves it (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/photo_lifecycle.py)
            ('public._keep_photos_day(text,jsonb,date)',                 '568deb1608a96d645e698c767393c293'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', 'fa6aac4df967a762d06e92471d28315a'),
            ('public._photo_keep_class(uuid,timestamp with time zone)',  'e19b23b73cf9355855d2533dfaf510f7'),
            ('public._photo_strays(uuid,timestamp with time zone)',      'bf8e6db4222384f840bafa491cd1d08a'),
            ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
            ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
            ('public.photo_removal_call()',                              '73487154c0b63b16231b25f007031522')
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
    execute $q$select string_agg(jobname, ', ') from cron.job
                where (jobname = 'fv_photo_lifecycle_daily' and command <> 'call public.photo_lifecycle_nightly()')
                   or (jobname = 'fv_photo_removal' and command <> 'select public.photo_removal_call()')$q$ into _bad;
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
comment on table public.markup_kept is
    'Mark Up of pages whose photo Keep Photos Until deleted (2026111140): the markup row and its page''s number, size and rotation. Goes with its submission. Owner only; nothing reads it yet.';

-- The last calendar day (the class's) the nightly job looked at for a class.
create table if not exists public.photo_keep_check (
    course_id       uuid primary key,          -- no foreign key: rows of a class that is gone are removed by the job
    checked_through date not null,
    at              timestamptz not null default now()
);
comment on table public.photo_keep_check is
    'Keep Photos Until (2026111140): the last day of each class the nightly job has looked at, so a night it missed is caught up. Owner only.';

-- What the nightly job did and found.
create table if not exists public.photo_check_log (
    id        bigint generated always as identity primary key,
    at        timestamptz not null default now(),
    course_id uuid,
    -- keep_photos_until (pages deleted), expired (unfinished sends dropped),
    -- stray_queued, stray_other_name (reported only), missing_file (reported
    -- only), error (a step that failed: sqlstate and message in detail)
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
             when not exists (select 1 from e where e.d is not null) then j.june
             else coalesce((select min(e.d) from e where e.d >= p_on), (select max(e.d) from e))
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
    _tz    text;
    _today date;
    _from  date;
    _due   date;
begin
    select c.keep_photos_until, c.reporting_terms, c.timezone into _c from course c where c.id = p_course_id;
    if not found then return null; end if;
    _tz := _fv_timezone(_c.timezone);
    _today := (p_now at time zone _tz)::date;
    select greatest(coalesce(k.checked_through + 1, _today - 1), _today - 400) into _from
      from (select 1) x left join photo_keep_check k on k.course_id = p_course_id;
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
-- Keep Photos Until. Returns what it did.
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
    _tz      text;
begin
    -- The class's lock first, as every write to its work.
    perform _grade_return_lock_first(p_course_id);
    _expired := _work_drop_expired(p_course_id);
    if _expired > 0 then
        perform _photo_log(p_course_id, 'expired', _expired, null);
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
        on conflict (file_id) do nothing;
        get diagnostics _marks = row_count;
        -- The pages go; Batch B's trigger queues both files of each.
        perform set_config('fv.work_removal_reason', 'keep_photos_until', true);
        delete from submission_file f
         using submission s
         where s.id = f.submission_id and s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff;
        get diagnostics _pages = row_count;
        perform set_config('fv.work_removal_reason', '', true);
        if _pages > 0 then
            perform _photo_log(p_course_id, 'keep_photos_until', _pages, jsonb_build_object('before', _cutoff, 'marks_kept', _marks));
        end if;
    end if;
    select _fv_timezone(c.timezone) into _tz from course c where c.id = p_course_id;
    if _tz is not null then
        insert into photo_keep_check (course_id, checked_through, at)
        values (p_course_id, (p_now at time zone _tz)::date - 1, now())
        on conflict (course_id) do update
            set checked_through = greatest(photo_keep_check.checked_through, excluded.checked_through), at = now();
    end if;
    return jsonb_build_object('expired', _expired, 'pages', _pages, 'marks_kept', _marks, 'before', _cutoff);
end;
$function$;

-- Strays (section 4). p_course_id: the strays whose first folder is that
-- class, under its lock. Null: the strays whose first folder is no class
-- (a class that is gone), and files with any other name (reported only).
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
    end if;
    with s as (
        select o.name
          from storage.objects o
         where o.bucket_id = _work_bucket()
           and o.archived_at is null and not o.is_delete_marker
           and o.created_at < p_now - interval '24 hours'
           and o.name ~ _layout
           and case when p_course_id is not null
                    then fv_private.work_path_course(o.name) = p_course_id
                    else not exists (select 1 from course c where c.id = fv_private.work_path_course(o.name)) end
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
    if _queued > 0 then
        perform _photo_log(p_course_id, 'stray_queued', _queued, null);
    end if;
    if p_course_id is null then
        select count(*) into _other
          from storage.objects o
         where o.bucket_id = _work_bucket() and o.archived_at is null and not o.is_delete_marker
           and o.created_at < p_now - interval '24 hours' and o.name !~ _layout;
        if _other > 0 then
            perform _photo_log(null, 'stray_other_name', _other, null);
        end if;
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
begin
    if not public.photo_removal_due() then
        return null;
    end if;
    select s.decrypted_secret into _url from vault.decrypted_secrets s where s.name = 'fv_photo_sweep_url';
    select s.decrypted_secret into _secret from vault.decrypted_secrets s where s.name = 'fv_photo_sweep_secret';
    if _url is null or _secret is null then
        raise exception 'photo removal: the Vault secrets fv_photo_sweep_url and fv_photo_sweep_secret are not both set; queued files wait.';
    end if;
    if _url !~ '^https://[a-z0-9.-]+/functions/v1/student-submit\?forceFunctionRegion=ca-central-1$' then
        raise exception 'photo removal: fv_photo_sweep_url is not https://<project>/functions/v1/student-submit?forceFunctionRegion=ca-central-1.';
    end if;
    if _secret !~ '^[0-9a-f]{64}$' then
        raise exception 'photo removal: fv_photo_sweep_secret is not 64 lower-case hex characters.';
    end if;
    return net.http_post(url := _url,
                         body := jsonb_build_object('route', 'scheduled-sweep', 'secret', _secret),
                         params := '{}'::jsonb,
                         headers := '{"Content-Type": "application/json"}'::jsonb,
                         timeout_milliseconds := 10000);
end;
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
begin
    delete from public.photo_check_log where at < now() - interval '90 days';
    delete from public.photo_keep_check k where not exists (select 1 from public.course c where c.id = k.course_id);
    commit;
    for _course in select distinct s.course_id from public.submission s order by 1 loop
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
    if _failed > 0 then
        raise exception 'photo_lifecycle_nightly: % part(s) of this run failed and were skipped; the rest is done. See public.photo_check_log.', _failed;
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
revoke all on function public.photo_removal_due() from public, anon, authenticated, service_role;
revoke all on function public.photo_removal_call() from public, anon, authenticated, service_role;
revoke all on procedure public.photo_lifecycle_nightly() from public, anon, authenticated, service_role;

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
            ('public._keep_photos_day(text,jsonb,date)',                 '568deb1608a96d645e698c767393c293'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', 'fa6aac4df967a762d06e92471d28315a'),
            ('public._photo_keep_class(uuid,timestamp with time zone)',  'e19b23b73cf9355855d2533dfaf510f7'),
            ('public._photo_strays(uuid,timestamp with time zone)',      'bf8e6db4222384f840bafa491cd1d08a'),
            ('public._photo_missing(uuid)',                              'd099b00a7d1a2997ee287dfdbb528c43'),
            ('public._photo_log(uuid,text,integer,jsonb)',               '53859922b32f0e4f2da95052edc130e2'),
            ('public.photo_removal_due()',                               '3faf3499da0753407687386407c8b01f'),
            ('public.photo_removal_call()',                              '73487154c0b63b16231b25f007031522')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
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
