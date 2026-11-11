-- HEADER-PLACEHOLDER
begin;

-- Give up after five seconds rather than queue behind a long transaction and
-- hold every teacher's saves up behind this one. If it gives up, nothing is
-- applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f     record;
    _md5   text;
    _first boolean := to_regclass('public.submission') is null;   -- true: nothing of this file is here yet
    _col   record;
begin
    -- Batch A, S0-M5, S0-M4b and S3-M1: the database this was tested on.
    if to_regclass('public.student_card') is null or to_regclass('student_submit.device_session') is null
       or to_regclass('public.grade_return') is null or to_regclass('public.course_sync_cursor') is null then
        raise exception 'Batch A is not all applied (2026110901 to 2026110904): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('public._grade_return_repair_class(uuid)') is null then
        raise exception 'S0-M4b is not applied (2026110905_grade_return_limits.sql): apply it, then this file. Nothing was changed.';
    end if;
    if exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)', 'public.fv_owns_assessment(uuid)',
                                          'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)']) x
                where to_regprocedure(x) is null
                   or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp']) then
        raise exception 'S0-M5 is not applied (2026111002_security_definer_search_path.sql): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null then
        raise exception 'S3-M1 is not applied (2026111003_card_codes_keyed.sql): apply it, then this file. Nothing was changed.';
    end if;
    perform 'public._fv_timezone(text)'::regprocedure, 'public._fv_date(text)'::regprocedure;

    -- The five functions a student's send leans on for who is asking and for
    -- the class's lock must be exactly the ones the tests ran against. (The
    -- ownership and idempotency helpers are compared before the apply, in
    -- migrations/local-test/batch-b-live-precheck.sql.)
    for _f in
        select * from (values
            ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit._device_session(text)',     'fa1e510e4ccd3bccbf91e29540a837bb'),
            ('student_submit._card_refusal(uuid)',       'cb88af0a6bf62c22ff6c636b291b1a25'),
            ('public._grade_return_lock(uuid)',          '530dca441198b1546a4ec4967cd83b9f'),
            ('public._grade_return_lock_first(uuid)',    '4d85813e08aaeb108cda95d85f3d66e4')
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;

    -- Supabase's storage tables: send_finish and the removal queue read
    -- storage.objects to see which files are really there.
    if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
       or (select count(*) from pg_attribute
            where attrelid = to_regclass('storage.objects') and not attisdropped
              and attname in ('bucket_id', 'name', 'metadata')) <> 3 then
        raise exception 'storage.objects is not there with bucket_id, name and metadata. Nothing was changed.';
    end if;
    -- storage.objects has row security and belongs to Supabase's storage
    -- role. The functions below run as the role applying this file; unless
    -- that role reads past row security they would see no file at all, and
    -- every send would be answered "missing pages".
    if not (select r.rolsuper or r.rolbypassrls from pg_roles r where r.rolname = current_user)
       and (select c.relowner::regrole::text from pg_class c where c.oid = to_regclass('storage.objects')) <> current_user then
        raise exception 'the role applying this file (%) cannot read storage.objects past its row security, so no upload could ever be confirmed. Nothing was changed.', current_user;
    end if;

    -- A first run: none of this file's names may be taken. A later run: every
    -- function must be exactly as this file leaves it. A later migration
    -- that replaces one of them (Batch C will) must not be undone by running
    -- this file again.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/submissions_fingerprints.py)
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
            ('public._work_object(text)',                                                           'e52420e0be52353b1208dbc395ae9e5c'),
            ('public._work_check_pages(jsonb)',                                                     '4f17b090aea75e8d9d9b296f99f0f5a8'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '57e75c6fa0bbbd12a04e11d21752bc5b'),
            ('public._work_files_state(uuid,jsonb)',                                                '975d75466b7b1dd7100240028441bea8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_json(uuid)',                                                       '2d20f60def0f309725f16b7b86477fab'),
            ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
            ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
            ('public._submission_file_removed()',                                                   '6baa9df0a3f31f3f7a55bb7771c4e8a9'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
            ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
            ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
            ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
            ('public.list_course_submissions(uuid)',                                                '8703f5ddc09b3c8dc92aa70878b5d7b1'),
            ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 'ef4590b75c38b428fcdb81b92a2407f3'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'd62a6e550d7535f123f58b17cfe838f2'),
            ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '1a966bceb2e46eb59107e2753e731bd4'),
            ('public.delete_submission(uuid,uuid)',                                                 '7da38ac3304aaf2f9639877b3fd0f81a'),
            ('public.rotate_submission_page(uuid,integer,uuid)',                                    'e684b853403b25a1706d29f02a581d5c'),
            ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_upload_allowed(text)',                                                '02b678a47cb50ef6bf233a0ff244b51c'),
            ('fv_private.work_read_allowed(text)',                                                  'd5462a39d4090cdd6c2d1e8df067729c'),
            ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '751249a78b6c05e4927d17805e5423fa'),
            ('student_submit.work(text,uuid,text)',                                                 '72233e7985f93eb6a150c1822ed69d14'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               '1b9663c49c49714ec7de2f43e872b0cd'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '719b3aef45f8946343138924b84a03e9'),
            ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
            ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _first and _md5 <> 'absent' then
            raise exception '% already exists, and public.submission does not: something else made it. Nothing was changed.', _f.fn;
        elsif not _first and _md5 <> _f.becomes then
            raise exception 'public.submission exists, so this file has been applied, but % is not as it leaves it (found %, expected %). A later migration may have replaced it: do not run this file again. Nothing was changed.',
                _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    if _first then
        if to_regclass('public.submission_file') is not null or to_regclass('public.submission_file_removal') is not null
           or to_regclass('student_submit.send_log') is not null then
            raise exception 'a table this file makes already exists, and public.submission does not. Nothing was changed.';
        end if;
        for _col in
            select c.oid::regclass::text as tbl, a.attname
              from pg_attribute a join pg_class c on c.oid = a.attrelid
             where not a.attisdropped
               and ((c.oid = 'public.course'::regclass and a.attname in ('send_work', 'keep_photos_until'))
                 or (c.oid = 'public.assessment'::regclass
                     and a.attname in ('students_send', 'after_due', 'accept_until', 'group_work', 'students_see_markup')))
        loop
            raise exception '%.% already exists, and public.submission does not: something else made it. Nothing was changed.', _col.tbl, _col.attname;
        end loop;
        -- CREATE OR REPLACE TRIGGER below would quietly take over a trigger
        -- of the same name.
        if exists (select 1 from pg_trigger t
                    where not t.tgisinternal and t.tgname in ('submission_gone', 'submission_truncate')
                      and t.tgrelid in ('public.assessment'::regclass, 'public.enrollment'::regclass)) then
            raise exception 'a trigger named submission_gone or submission_truncate is already on assessment or enrollment, and public.submission does not exist: something else made it. Nothing was changed.';
        end if;
    end if;
end
$guard$;

-- ── 1. The class's two settings ─────────────────────────────────────────────
alter table public.course
    add column if not exists send_work boolean not null default false,
    add column if not exists keep_photos_until text not null default 'end_of_year'
        constraint course_keep_photos_until_check check (keep_photos_until in ('end_of_year', 'end_of_term'));
comment on column public.course.send_work is
    'Send Work, in Class Settings, Student Page. Off: no student of the class can send work, whatever an assessment says.';
comment on column public.course.keep_photos_until is
    'Keep Photos Until: end_of_year or end_of_term. Stored here; the job that acts on it is a later migration (Batch D).';

-- ── 2. The assessment form's Student Work card ─ ──────────────────────────────
alter table public.assessment
    add column if not exists students_send text not null default 'nothing'
        constraint assessment_students_send_check check (students_send in ('nothing', 'photos', 'photos_files')),
    add column if not exists after_due text not null default 'keep'
        constraint assessment_after_due_check check (after_due in ('keep', 'until', 'stop')),
    add column if not exists accept_until date,
    add column if not exists group_work text not null default 'each'
        constraint assessment_group_work_check check (group_work in ('each', 'group')),
    add column if not exists students_see_markup boolean not null default true;
do $c$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.assessment'::regclass and conname = 'assessment_accept_until_check') then
        -- "Until a date" has its date, and no other choice keeps one.
        alter table public.assessment add constraint assessment_accept_until_check
            check ((after_due = 'until') = (accept_until is not null));
    end if;
end
$c$;
comment on column public.assessment.students_send is
    'Students Send: nothing, photos, or photos_files (a PDF may be chosen too; it arrives as JPEG pages either way).';
comment on column public.assessment.after_due is
    'After the Due Date: keep (Keep Accepting), until (accept_until is the last day), stop (the due date is the last day).';
comment on column public.assessment.accept_until is
    'The last day work is taken when after_due is until; null otherwise.';
comment on column public.assessment.group_work is
    'Group Work: each (Each Student) or group (One per Group). Stored here; one submission serving a group is a later migration (Batch C).';
comment on column public.assessment.students_see_markup is
    'Students See Your Mark Up. Stored here; Mark Up is a later migration (Batch C).';

-- ── 3. submission, submission_file ──────────────────────────────────────────
-- No foreign keys to assessment, enrollment, course or student_card, on
-- purpose, as grade_return has none (2026110902, "ONE LOCK PER CLASS"). A
-- cascade from assessment or enrollment would delete these rows before the
-- deleting transaction reached the class's lock, and a foreign-key check on
-- a new row would wait on an assessment that is being deleted: either is a
-- lock taken in the other order, and a deadlock with a send or a save in
-- the same class. Instead the triggers in 5 delete the rows, under the
-- lock, and nothing but the functions here can insert one.
create table if not exists public.submission (
    id            uuid        primary key default gen_random_uuid(),
    course_id     uuid        not null,
    assessment_id uuid        not null,
    enrollment_id uuid        not null,
    version       smallint    not null default 1 constraint submission_version_check check (version >= 1),
    -- sending: rows made and links handed out, nothing handed in yet. Only
    -- its sender ever sees it. sent: handed in.
    state         text        not null constraint submission_state_check check (state in ('sending', 'sent')),
    -- What a sending row will do when it is finished: become the piece's
    -- submission (new), take the place of the one sent (replace), or add its
    -- pages to the one sent (add). target_id is that sent submission.
    intent        text        not null default 'new' constraint submission_intent_check check (intent in ('new', 'replace', 'add')),
    target_id     uuid,
    sent_by       text        not null constraint submission_sent_by_check check (sent_by in ('student', 'teacher')),
    on_paper      boolean     not null default false,
    note          text        constraint submission_note_check check (char_length(note) <= 1000),
    followed_plan text        constraint submission_followed_plan_check check (followed_plan in ('yes', 'partly', 'no')),
    is_late       boolean     not null default false,
    card_id       uuid,       -- the card whose session sent it; history only
    request_id    uuid,       -- the sender's own id for the call that made the row
    created_at    timestamptz not null default now(),
    sent_at       timestamptz,
    updated_at    timestamptz not null default now(),
    constraint submission_sent_has_time check ((state = 'sent') = (sent_at is not null)),
    constraint submission_sent_is_plain check (state = 'sending' or (intent = 'new' and target_id is null)),
    constraint submission_target_with_intent check ((intent = 'new') = (target_id is null)),
    constraint submission_paper_is_teachers check (not on_paper or (sent_by = 'teacher' and state = 'sent'))
);
-- One submission handed in per student per assessment per version.
create unique index if not exists submission_one_sent on public.submission (assessment_id, enrollment_id, version) where state = 'sent';
-- One unfinished send per student per assessment from each side.
create unique index if not exists submission_one_sending on public.submission (assessment_id, enrollment_id, sent_by) where state = 'sending';
create index if not exists submission_enrollment_idx on public.submission (enrollment_id);
create index if not exists submission_course_idx on public.submission (course_id);
create index if not exists submission_target_idx on public.submission (target_id) where target_id is not null;
comment on table public.submission is
    'Work handed in for one assessment by one student: by the student from their page, or by the teacher (Add Work, Handed In on Paper). Read and written only through the functions of 2026111101, under the class''s lock.';

create table if not exists public.submission_file (
    id            uuid        primary key default gen_random_uuid(),
    submission_id uuid        not null references public.submission(id) on delete cascade,
    page          smallint    not null constraint submission_file_page_check check (page >= 1),
    -- Where the page and its thumbnail are in the bucket. Made once, from
    -- ids, and never changed: <course>/<assessment>/<enrollment>/<the
    -- submission it was first made for>/<this row's id>.jpg
    path          text        not null constraint submission_file_path_key unique,
    thumb_path    text        not null constraint submission_file_thumb_path_key unique,
    bytes         integer,    -- as storage holds them, read when the work is handed in
    thumb_bytes   integer,
    width         integer     constraint submission_file_width_check check (width between 1 and 20000),
    height        integer     constraint submission_file_height_check check (height between 1 and 20000),
    sha256        text        constraint submission_file_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
    rotation      smallint    not null default 0 constraint submission_file_rotation_check check (rotation in (0, 90, 180, 270)),
    created_at    timestamptz not null default now(),
    -- The file's name is the row's own id, so two rows can never share a
    -- file and a new row can never be given the name of a file that is
    -- waiting to be deleted.
    constraint submission_file_path_is_own check (path like '%/' || id::text || '.jpg'
                                                  and thumb_path = left(path, length(path) - 4) || '-thumb.jpg'),
    constraint submission_file_page_key unique (submission_id, page) deferrable initially immediate
);
comment on table public.submission_file is
    'One page of a submission: always a JPEG, with a thumbnail beside it. Deleting a row queues both files for deletion (submission_file_removal).';

-- ── 4. Files waiting to be deleted from storage ─────────────────────────────
-- SQL cannot delete a file's bytes: on Supabase a DELETE on storage.objects
-- is refused, and where it is not it leaves the bytes behind with nothing
-- pointing at them. Only the Storage API deletes a file. So every file whose
-- row goes is written here in the same transaction, by a trigger, and a
-- caller with the service key works the list down (student_submit.
-- removal_batch, removal_done).
create table if not exists public.submission_file_removal (
    id           bigint      generated always as identity primary key,
    bucket       text        not null,
    path         text        not null,
    course_id    uuid,       -- the path's first folder; the class itself may be gone
    reason       text        not null,
    queued_at    timestamptz not null default now(),
    -- The upload link made for this path stops working at about this time.
    -- Until then the file could be put back by whoever holds the link.
    link_dies_at timestamptz not null,
    tries        integer     not null default 0,
    last_try_at  timestamptz,
    removed_at   timestamptz,           -- when storage was last seen without it
    done         boolean     not null default false,  -- seen gone after its link died: nothing more to do
    constraint submission_file_removal_path_key unique (bucket, path)
);
create index if not exists submission_file_removal_todo on public.submission_file_removal (queued_at) where not done;
comment on table public.submission_file_removal is
    'Files to delete from storage, and the ones already deleted. Written by a trigger when a submission_file row goes; worked down by student_submit.removal_batch and removal_done. Owner only.';

-- How many upload links a card has been given, for the hourly limit. Kept
-- apart from the submissions so that unsending does not give the count back.
create table if not exists student_submit.send_log (
    id      bigint      generated always as identity primary key,
    card_id uuid        not null,
    at      timestamptz not null default now()
);
create index if not exists send_log_card_at on student_submit.send_log (card_id, at);
create index if not exists send_log_at on student_submit.send_log (at);
comment on table student_submit.send_log is
    'One row each time a card''s session is given upload links (send-start, replace). Rows older than a day are removed by the next call.';

alter table public.submission enable row level security;
alter table public.submission_file enable row level security;
alter table public.submission_file_removal enable row level security;
alter table student_submit.send_log enable row level security;
-- No policy and no grant: a teacher's browser reads through
-- list_course_submissions, and a student's page through the edge function.
revoke all on table public.submission, public.submission_file from public, anon, authenticated;
revoke all on table public.submission_file_removal from public, anon, authenticated, service_role;
revoke all on sequence public.submission_file_removal_id_seq from public, anon, authenticated, service_role;
revoke all on table student_submit.send_log from public, anon, authenticated;
revoke all on sequence student_submit.send_log_id_seq from public, anon, authenticated;

-- ── 5. Triggers ─────────────────────────────────────────────────────────────
-- The bucket, in one place.
create or replace function public._work_bucket()
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select 'student-photos'::text;
$function$;

-- The class a path belongs to: its first folder, when that is an id.
create or replace function fv_private.work_path_course(p_name text)
 returns uuid
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then split_part(p_name, '/', 1)::uuid end;
$function$;

-- A new submission is for a student and an assessment of one class, and
-- says which. Its student, assessment and class never change afterwards.
create or replace function public._submission_same_class()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if tg_op = 'UPDATE' then
        if new.course_id is distinct from old.course_id or new.assessment_id is distinct from old.assessment_id
           or new.enrollment_id is distinct from old.enrollment_id then
            raise exception 'a submission keeps its student, assessment and class' using errcode = '23514';
        end if;
        return new;
    end if;
    if not exists (select 1 from assessment a where a.id = new.assessment_id and a.course_id = new.course_id)
       or not exists (select 1 from enrollment e where e.id = new.enrollment_id and e.course_id = new.course_id) then
        raise exception 'the student and the assessment are not both in that class' using errcode = '23514';
    end if;
    return new;
end;
$function$;
create or replace trigger submission_same_class before insert or update on public.submission
    for each row execute function public._submission_same_class();

-- A page's row goes: both its files are queued for deletion, in the same
-- transaction, whoever deleted it and however (Unsend, Replace, a teacher's
-- delete, an assessment or a student being deleted, a class being purged).
create or replace function public._submission_file_removed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _why text := coalesce(nullif(current_setting('fv.work_removal_reason', true), ''), 'row_deleted');
begin
    insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
    select _work_bucket(), p, fv_private.work_path_course(p), _why, old.created_at + interval '2 hours 10 minutes'
      from unnest(array[old.path, old.thumb_path]) p
    on conflict (bucket, path) do nothing;
    return null;
end;
$function$;
create or replace trigger submission_file_removed after delete on public.submission_file
    for each row execute function public._submission_file_removed();

-- A sent submission goes: an unfinished send that was to replace it or add
-- to it goes with it.
create or replace function public._submission_target_gone()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    delete from submission where target_id = old.id;
    return null;
end;
$function$;
create or replace trigger submission_target_gone after delete on public.submission
    for each row execute function public._submission_target_gone();

-- A student or an assessment is deleted: its submissions go, under the class
-- lock like every other write to them. The trigger's name puts it after the
-- foreign-key cascades and after grade_return_gone, which takes the same
-- lock.
create or replace function public._submission_gone()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _grade_return_lock(old.course_id);
    if tg_table_name = 'enrollment' then
        delete from submission where enrollment_id = old.id;
    else
        delete from submission where assessment_id = old.id;
    end if;
    return null;
end;
$function$;
create or replace trigger submission_gone after delete on public.enrollment
    for each row execute function public._submission_gone();
create or replace trigger submission_gone after delete on public.assessment
    for each row execute function public._submission_gone();

-- TRUNCATE fires no row trigger: whatever is left without its student or
-- assessment goes (as grade_return_truncate does for grade_return).
create or replace function public._submission_truncated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    delete from submission s
     where not exists (select 1 from enrollment e where e.id = s.enrollment_id)
        or not exists (select 1 from assessment a where a.id = s.assessment_id);
    return null;
end;
$function$;
create or replace trigger submission_truncate after truncate on public.enrollment
    for each statement execute function public._submission_truncated();
create or replace trigger submission_truncate after truncate on public.assessment
    for each statement execute function public._submission_truncated();

-- ── 6. Shared pieces ────────────────────────────────────────────────────────
-- Is the file there? Read from Supabase's own table. Written to read both
-- shapes of it: where a bucket can keep old versions of a file, the current
-- one has no archived_at and is not a delete marker.
-- Returns its size and type as storage recorded them, or no row.
create or replace function public._work_object(p_path text)
 returns table (bytes bigint, mimetype text)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select nullif(o.metadata->>'size', '')::bigint, o.metadata->>'mimetype'
      from storage.objects o
     where o.bucket_id = public._work_bucket()
       -- compared as storage's own index on (bucket_id, name) is kept
       and o.name = p_path collate "C"
       and to_jsonb(o)->>'archived_at' is null
       and coalesce((to_jsonb(o)->>'is_delete_marker')::boolean, false) = false
     limit 1;
$function$;

-- The largest page storage may hold: the bucket's own limit (2 MB).
create or replace function public._work_max_bytes()
 returns bigint
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select 2097152::bigint;
$function$;

-- p_pages, as every start call takes it: a list of 1 to 30 pages, each
-- { width, height } or {}. Raises when it is anything else.
create or replace function public._work_check_pages(p_pages jsonb)
 returns void
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _p jsonb;
    _k text;
begin
    if p_pages is null or jsonb_typeof(p_pages) <> 'array' then
        raise exception 'pages must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_pages) not between 1 and 30 then
        raise exception 'between 1 and 30 pages' using errcode = '22023';
    end if;
    for _p in select x from jsonb_array_elements(p_pages) x loop
        if jsonb_typeof(_p) <> 'object' then
            raise exception 'a page is not an object' using errcode = '22023';
        end if;
        foreach _k in array array['width', 'height'] loop
            if _p ? _k and jsonb_typeof(_p->_k) <> 'null'
               and (jsonb_typeof(_p->_k) <> 'number' or (_p->>_k) !~ '^[0-9]{1,5}$' or (_p->>_k)::int not between 1 and 20000) then
                raise exception 'a page has a % that is not a whole number from 1 to 20000', _k using errcode = '22023';
            end if;
        end loop;
    end loop;
end;
$function$;

-- p_files, as every finish call takes it: the pages handed in, in order,
-- each { file_id, sha256 }. Raises when it is anything else.
create or replace function public._work_check_files(p_files jsonb)
 returns void
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _f jsonb;
begin
    if p_files is null or jsonb_typeof(p_files) <> 'array' then
        raise exception 'files must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_files) not between 1 and 30 then
        raise exception 'between 1 and 30 files' using errcode = '22023';
    end if;
    for _f in select x from jsonb_array_elements(p_files) x loop
        if jsonb_typeof(_f) <> 'object'
           or jsonb_typeof(_f->'file_id') is distinct from 'string'
           or _f->>'file_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           or jsonb_typeof(_f->'sha256') is distinct from 'string' or _f->>'sha256' !~ '^[0-9a-f]{64}$' then
            raise exception 'a file is not { file_id, sha256 }' using errcode = '22023';
        end if;
    end loop;
    if (select count(distinct lower(x->>'file_id')) from jsonb_array_elements(p_files) x) <> jsonb_array_length(p_files) then
        raise exception 'a file is named twice' using errcode = '22023';
    end if;
end;
$function$;

-- A new unfinished send with its page rows. The paths are made here, from
-- ids, and nowhere else.
create or replace function public._work_begin(
    p_course_id uuid, p_assessment_id uuid, p_enrollment_id uuid, p_sent_by text, p_intent text, p_target_id uuid,
    p_pages jsonb, p_note text, p_followed_plan text, p_is_late boolean, p_card_id uuid, p_request_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _id   uuid;
    _file uuid;
    _p    record;
    _path text;
begin
    insert into submission (course_id, assessment_id, enrollment_id, state, intent, target_id, sent_by,
                            note, followed_plan, is_late, card_id, request_id)
    values (p_course_id, p_assessment_id, p_enrollment_id, 'sending', p_intent, p_target_id, p_sent_by,
            nullif(btrim(p_note), ''), p_followed_plan, coalesce(p_is_late, false), p_card_id, p_request_id)
    returning id into _id;
    for _p in select t.x, t.ord from jsonb_array_elements(p_pages) with ordinality as t(x, ord) order by t.ord loop
        _file := gen_random_uuid();
        _path := p_course_id::text || '/' || p_assessment_id::text || '/' || p_enrollment_id::text || '/' || _id::text || '/' || _file::text;
        insert into submission_file (id, submission_id, page, path, thumb_path, width, height)
        values (_file, _id, _p.ord, _path || '.jpg', _path || '-thumb.jpg', (_p.x->>'width')::int, (_p.x->>'height')::int);
    end loop;
    return _id;
end;
$function$;

-- Which of a finish call's pages are not in storage yet (the page or its
-- thumbnail), and which are there but are larger than the bucket allows or
-- are not recorded as a JPEG. p_files has been checked to be files of
-- p_submission_id. (The bucket itself refuses both at upload; this is a
-- second look at what storage recorded. A file whose record has no size or
-- no type is taken as storage accepted it.)
create or replace function public._work_files_state(p_submission_id uuid, p_files jsonb)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
        'missing', coalesce(jsonb_agg(f.id order by t.ord) filter (where o.n = 0 or th.n = 0), '[]'::jsonb),
        'bad', coalesce(jsonb_agg(f.id order by t.ord) filter (where o.n > 0 and th.n > 0 and (
                            o.bytes > _work_max_bytes() or th.bytes > _work_max_bytes()
                            or o.mimetype <> 'image/jpeg' or th.mimetype <> 'image/jpeg')), '[]'::jsonb))
      from jsonb_array_elements(p_files) with ordinality as t(x, ord)
      join submission_file f on f.id = (t.x->>'file_id')::uuid and f.submission_id = p_submission_id
     cross join lateral (select count(*) as n, max(w.bytes) as bytes, max(w.mimetype) as mimetype from _work_object(f.path) w) o
     cross join lateral (select count(*) as n, max(w.bytes) as bytes, max(w.mimetype) as mimetype from _work_object(f.thumb_path) w) th;
$function$;

-- A finish call's pages become the submission's pages, in the order given:
-- a page left out is deleted (its files are queued), each page takes its
-- place, its hash and its size as storage holds it.
create or replace function public._work_settle_files(p_submission_id uuid, p_files jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _n int;
begin
    perform set_config('fv.work_removal_reason', 'page_removed', true);
    delete from submission_file f
     where f.submission_id = p_submission_id
       and f.id not in (select (x->>'file_id')::uuid from jsonb_array_elements(p_files) x);
    perform set_config('fv.work_removal_reason', '', true);
    update submission_file f
       set page = t.ord, sha256 = t.x->>'sha256',
           bytes = (select w.bytes from _work_object(f.path) w),
           thumb_bytes = (select w.bytes from _work_object(f.thumb_path) w)
      from jsonb_array_elements(p_files) with ordinality as t(x, ord)
     where f.submission_id = p_submission_id and f.id = (t.x->>'file_id')::uuid;
    get diagnostics _n = row_count;
    return _n;
end;
$function$;

-- One submission as the teacher's screens read it.
create or replace function public._submission_json(p_submission_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
               'id', s.id, 'assessment_id', s.assessment_id, 'enrollment_id', s.enrollment_id, 'version', s.version,
               'state', s.state, 'intent', s.intent, 'target_id', s.target_id,
               'sent_by', s.sent_by, 'on_paper', s.on_paper, 'is_late', s.is_late,
               'note', s.note, 'followed_plan', s.followed_plan,
               'created_at', s.created_at, 'sent_at', s.sent_at,
               'files', coalesce((
                   select jsonb_agg(jsonb_build_object(
                              'id', f.id, 'page', f.page, 'path', f.path, 'thumb_path', f.thumb_path,
                              'bytes', f.bytes, 'thumb_bytes', f.thumb_bytes, 'width', f.width, 'height', f.height,
                              'rotation', f.rotation, 'sha256', f.sha256) order by f.page, f.id)
                     from submission_file f where f.submission_id = s.id), '[]'::jsonb))
      from submission s
     where s.id = p_submission_id;
$function$;

-- The pages of an unfinished send, as the sender is told where to put them.
create or replace function public._work_upload_json(p_submission_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select coalesce(jsonb_agg(jsonb_build_object('file_id', f.id, 'page', f.page, 'path', f.path, 'thumb_path', f.thumb_path)
                              order by f.page, f.id), '[]'::jsonb)
      from submission_file f
     where f.submission_id = p_submission_id;
$function$;

-- ── 7. What the storage policies ask (2026111102) ───────────────────────────
-- May the signed-in teacher put a file at this path? Only a page, or its
-- thumbnail, of an upload that teacher has started and not finished.
create or replace function fv_private.work_upload_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from submission_file f
                     join submission s on s.id = f.submission_id
                    where (f.path = p_name or f.thumb_path = p_name)
                      and s.state = 'sending' and s.sent_by = 'teacher'
                      and fv_owns_course(s.course_id));
$function$;

-- May the signed-in teacher read this path? Any file under a class they own.
create or replace function fv_private.work_read_allowed(p_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select coalesce(fv_owns_course(fv_private.work_path_course(p_name)), false);
$function$;

-- ── 8. The teacher's RPCs ───────────────────────────────────────────────────
create or replace function public.set_course_send_work(p_course_id uuid, p_patch jsonb, p_idempotency_key uuid default null)
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
    _cached := fv_idem_check(p_idempotency_key, 'set_course_send_work');
    if _cached is not null then return _cached; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('send_work', 'keep_photos_until') then
            raise exception 'unknown setting %', _k using errcode = '22023';
        end if;
    end loop;
    if p_patch ? 'send_work' and jsonb_typeof(p_patch->'send_work') <> 'boolean' then
        raise exception 'send_work must be true or false' using errcode = '22023';
    end if;
    if p_patch ? 'keep_photos_until' and (jsonb_typeof(p_patch->'keep_photos_until') <> 'string'
                                          or p_patch->>'keep_photos_until' not in ('end_of_year', 'end_of_term')) then
        raise exception 'keep_photos_until must be end_of_year or end_of_term' using errcode = '22023';
    end if;
    -- Only what the patch names is written (DECISIONS, "Class settings on
    -- two computers" 3).
    update course
       set send_work = case when p_patch ? 'send_work' then (p_patch->>'send_work')::boolean else send_work end,
           keep_photos_until = case when p_patch ? 'keep_photos_until' then p_patch->>'keep_photos_until' else keep_photos_until end,
           updated_at = now()
     where id = p_course_id;
    select jsonb_build_object('send_work', c.send_work, 'keep_photos_until', c.keep_photos_until)
      into _cached from course c where c.id = p_course_id;
    perform fv_idem_store(p_idempotency_key, 'set_course_send_work', _cached);
    return _cached;
end;
$function$;

-- One assessment's Student Work settings, as they are read.
create or replace function public._assessment_work_json(p_assessment_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object('id', a.id, 'students_send', a.students_send, 'after_due', a.after_due,
                              'accept_until', a.accept_until, 'group_work', a.group_work,
                              'students_see_markup', a.students_see_markup)
      from assessment a
     where a.id = p_assessment_id;
$function$;

create or replace function public.set_assessment_student_work(p_assessment_id uuid, p_patch jsonb, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _k      text;
    _a      assessment%rowtype;
    _after  text;
    _until  date;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_assessment_student_work');
    if _cached is not null then return _cached; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'the patch must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_patch) loop
        if _k not in ('students_send', 'after_due', 'accept_until', 'group_work', 'students_see_markup') then
            raise exception 'unknown setting %', _k using errcode = '22023';
        end if;
    end loop;
    if p_patch ? 'students_send' and (jsonb_typeof(p_patch->'students_send') <> 'string'
                                      or p_patch->>'students_send' not in ('nothing', 'photos', 'photos_files')) then
        raise exception 'students_send must be nothing, photos or photos_files' using errcode = '22023';
    end if;
    if p_patch ? 'after_due' and (jsonb_typeof(p_patch->'after_due') <> 'string'
                                  or p_patch->>'after_due' not in ('keep', 'until', 'stop')) then
        raise exception 'after_due must be keep, until or stop' using errcode = '22023';
    end if;
    if p_patch ? 'group_work' and (jsonb_typeof(p_patch->'group_work') <> 'string'
                                   or p_patch->>'group_work' not in ('each', 'group')) then
        raise exception 'group_work must be each or group' using errcode = '22023';
    end if;
    if p_patch ? 'students_see_markup' and jsonb_typeof(p_patch->'students_see_markup') <> 'boolean' then
        raise exception 'students_see_markup must be true or false' using errcode = '22023';
    end if;
    if p_patch ? 'accept_until' and jsonb_typeof(p_patch->'accept_until') <> 'null'
       and (jsonb_typeof(p_patch->'accept_until') <> 'string' or _fv_date(p_patch->>'accept_until') is null) then
        raise exception 'accept_until must be a date, YYYY-MM-DD' using errcode = '22023';
    end if;

    select * into _a from assessment where id = p_assessment_id for update;
    _after := case when p_patch ? 'after_due' then p_patch->>'after_due' else _a.after_due end;
    -- The date is kept only with "until"; any other choice drops it.
    _until := case when _after <> 'until' then null
                   when p_patch ? 'accept_until' then _fv_date(p_patch->>'accept_until')
                   else _a.accept_until end;
    if _after = 'until' and _until is null then
        raise exception 'after_due until needs accept_until' using errcode = '22023';
    end if;
    if _after = 'until' and _a.due_date is not null and _until < _a.due_date then
        raise exception 'accept_until is before the due date' using errcode = '22023';
    end if;
    update assessment
       set students_send = case when p_patch ? 'students_send' then p_patch->>'students_send' else students_send end,
           after_due = _after,
           accept_until = _until,
           group_work = case when p_patch ? 'group_work' then p_patch->>'group_work' else group_work end,
           students_see_markup = case when p_patch ? 'students_see_markup' then (p_patch->>'students_see_markup')::boolean
                                      else students_see_markup end,
           updated_at = now()
     where id = p_assessment_id;
    _cached := _assessment_work_json(p_assessment_id);
    perform fv_idem_store(p_idempotency_key, 'set_assessment_student_work', _cached);
    return _cached;
end;
$function$;

-- Everything the teacher's screens need about work handed in for a class.
create or replace function public.list_course_submissions(p_course_id uuid)
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
        'bucket', _work_bucket(),
        'course', (select jsonb_build_object('send_work', c.send_work, 'keep_photos_until', c.keep_photos_until)
                     from course c where c.id = p_course_id),
        'assessments', coalesce((
            select jsonb_agg(_assessment_work_json(a.id) order by a.id)
              from assessment a where a.course_id = p_course_id), '[]'::jsonb),
        -- handed in: never one with a page missing
        'submissions', coalesce((
            select jsonb_agg(_submission_json(s.id) - 'intent' - 'target_id' order by s.sent_at, s.id)
              from submission s where s.course_id = p_course_id and s.state = 'sent'), '[]'::jsonb),
        -- the teacher's own uploads that are not finished
        'uploads', coalesce((
            select jsonb_agg(_submission_json(s.id) order by s.created_at, s.id)
              from submission s where s.course_id = p_course_id and s.state = 'sending' and s.sent_by = 'teacher'), '[]'::jsonb));
end;
$function$;

-- Add Work, first half: the rows and the paths. The teacher's browser then
-- uploads each page and thumbnail itself, signed in, and calls
-- finish_work_upload.
create or replace function public.start_work_upload(
    p_assessment_id uuid, p_enrollment_id uuid, p_pages jsonb, p_mode text default 'new', p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _sent   submission%rowtype;
    _id     uuid;
    _pages  int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    if not fv_owns_enrollment(p_enrollment_id)
       or not exists (select 1 from enrollment e
                       where e.id = p_enrollment_id and e.course_id = _course and e.withdrawn_at is null) then
        raise exception 'student not found' using errcode = 'P0002';
    end if;
    if coalesce(p_mode, '') not in ('new', 'add', 'replace') then
        raise exception 'mode must be new, add or replace' using errcode = '22023';
    end if;
    perform _work_check_pages(p_pages);
    _cached := fv_idem_check(p_idempotency_key, 'start_work_upload');
    if _cached is not null then return _cached; end if;

    perform _grade_return_lock_first(_course);
    if not exists (select 1 from assessment a where a.id = p_assessment_id)
       or not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null) then
        -- deleted while this call waited for the class
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    select * into _sent from submission
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'sent'
     order by version desc limit 1;
    if p_mode = 'new' and _sent.id is not null then
        -- The student, or another of the teacher's devices, got there first.
        -- Nothing is made; the screen offers Add as More Pages, Replace Them
        -- or Skip. Not remembered: a retry reads the piece again.
        return jsonb_build_object('result', 'already_sent', 'submission', _submission_json(_sent.id) - 'intent' - 'target_id');
    end if;
    if p_mode in ('add', 'replace') and _sent.id is null then
        return jsonb_build_object('result', 'nothing_sent');
    end if;
    -- Two more things the screen cannot know for sure when it asks (another
    -- device may have changed the piece): answers, not errors, and not
    -- remembered.
    if p_mode = 'add' and _sent.on_paper then
        -- nothing to add pages to: Replace Them is the way
        return jsonb_build_object('result', 'on_paper', 'submission', _submission_json(_sent.id) - 'intent' - 'target_id');
    end if;
    _pages := (select count(*) from submission_file f where f.submission_id = _sent.id);
    if p_mode = 'add' and _pages + jsonb_array_length(p_pages) > 30 then
        return jsonb_build_object('result', 'too_many_pages', 'room', 30 - _pages);
    end if;
    -- An upload this teacher started for the piece and never finished goes.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = p_assessment_id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'teacher';
    perform set_config('fv.work_removal_reason', '', true);
    _id := _work_begin(_course, p_assessment_id, p_enrollment_id, 'teacher', p_mode,
                       case when p_mode = 'new' then null else _sent.id end, p_pages, null, null, false, null, p_idempotency_key);
    _cached := jsonb_build_object('result', 'ready', 'submission_id', _id, 'mode', p_mode, 'bucket', _work_bucket(),
                                  'files', _work_upload_json(_id));
    perform fv_idem_store(p_idempotency_key, 'start_work_upload', _cached);
    return _cached;
end;
$function$;

-- Add Work, second half: every page must be in storage; then the work is
-- handed in, takes the place of what was sent, or its pages are added.
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
    _cached := fv_idem_check(p_idempotency_key, 'finish_work_upload');
    if _cached is not null then return _cached; end if;
    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);
    if _course is null then
        -- Never existed, another teacher's, or already finished and since
        -- replaced or deleted. The same answer for all of them.
        return jsonb_build_object('result', 'gone');
    end if;
    perform _grade_return_lock_first(_course);
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
        -- Its pages go on the end of what was sent, and the row that carried
        -- them goes (it has no pages left, so nothing is queued).
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

-- Handed In on Paper: the piece moves to Sent for these students, with no
-- photos. A student who already has work in is left as they are.
create or replace function public.mark_handed_in_paper(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _eid    uuid;
    _id     uuid;
    _made   uuid[] := '{}';
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'mark_handed_in_paper');
    if _cached is not null then return _cached; end if;
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    perform _grade_return_lock_first(_course);
    if not exists (select 1 from assessment a where a.id = p_assessment_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    for _eid in
        select e.id from enrollment e
         where e.id = any (coalesce(p_enrollment_ids, '{}')) and e.course_id = _course and e.withdrawn_at is null
           and not exists (select 1 from submission s
                            where s.assessment_id = p_assessment_id and s.enrollment_id = e.id and s.state = 'sent')
         order by e.id
    loop
        insert into submission (course_id, assessment_id, enrollment_id, state, sent_by, on_paper, sent_at, request_id)
        values (_course, p_assessment_id, _eid, 'sent', 'teacher', true, now(), p_idempotency_key)
        returning id into _id;
        _made := _made || _id;
    end loop;
    _cached := jsonb_build_object(
        'marked', cardinality(_made),
        'submissions', coalesce((select jsonb_agg(_submission_json(s.id) - 'intent' - 'target_id' order by s.enrollment_id)
                                   from submission s where s.id = any (_made)), '[]'::jsonb));
    perform fv_idem_store(p_idempotency_key, 'mark_handed_in_paper', _cached);
    return _cached;
end;
$function$;

-- The teacher removes work that was handed in (or an upload of their own
-- that is not finished). ITS PHOTOS ARE DELETED and cannot come back.
create or replace function public.delete_submission(p_submission_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _pages  int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'delete_submission');
    if _cached is not null then return _cached; end if;
    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    select count(*) into _pages from submission_file f join submission s on s.id = f.submission_id
     where s.id = p_submission_id and s.course_id = _course and (s.state = 'sent' or s.sent_by = 'teacher');
    perform set_config('fv.work_removal_reason', 'teacher', true);
    delete from submission s
     where s.id = p_submission_id and s.course_id = _course and (s.state = 'sent' or s.sent_by = 'teacher');
    -- One answer whether it was never there, is another teacher's, or was
    -- already deleted: a repeated call is not an error.
    _cached := jsonb_build_object('deleted', found, 'pages', case when found then _pages else 0 end);
    perform set_config('fv.work_removal_reason', '', true);
    perform fv_idem_store(p_idempotency_key, 'delete_submission', _cached);
    return _cached;
end;
$function$;

-- A page is turned in the grader. The file is not touched.
create or replace function public.rotate_submission_page(p_file_id uuid, p_rotation integer, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_rotation is null or p_rotation not in (0, 90, 180, 270) then
        raise exception 'rotation must be 0, 90, 180 or 270' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'rotate_submission_page');
    if _cached is not null then return _cached; end if;
    select s.course_id into _course
      from submission_file f join submission s on s.id = f.submission_id
     where f.id = p_file_id and fv_owns_course(s.course_id);
    if _course is null then
        raise exception 'page not found' using errcode = 'P0002';
    end if;
    perform _grade_return_lock_first(_course);
    update submission_file set rotation = p_rotation where id = p_file_id;
    if not found then
        raise exception 'page not found' using errcode = 'P0002';
    end if;
    _cached := jsonb_build_object('file_id', p_file_id, 'rotation', p_rotation);
    perform fv_idem_store(p_idempotency_key, 'rotate_submission_page', _cached);
    return _cached;
end;
$function$;

-- ── 9. What a student's send asks first ─────────────────────────────────────
-- Has the teacher started grading this piece for this student? True when the
-- piece holds a draft or a returned grade. It reads grade_return's two state
-- columns and nothing else: no score table, no copy of a grade. The only
-- function added here that names grade_return.
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
                        and not exists (select 1 from assessment a where a.id = p_assessment_id and a.score_mode = 'dibels')), false);
$function$;

-- One class of a session, for a call that sends or changes work: what page()
-- asks (_session_class), and the card must not be locked.
-- Returns { card_id, session_id, course_id, expires_at } or { error }.
create or replace function student_submit._send_session(p_session_token text, p_enrollment_id uuid)
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
        return _in;
    end if;
    if exists (select 1 from student_card k where k.id = (_in->>'card_id')::uuid and k.locked_at is not null) then
        return jsonb_build_object('error', 'card_locked');
    end if;
    return _in;
end;
$function$;

-- When an assessment takes work, by the class's own calendar.
--   listed     the student's page shows it (its date has come, or it has none)
--   closes_on  the last day work is taken, or null when there is none
--   open       today is not past that day
--   late       today is past the due date
create or replace function student_submit._work_window(p_assessment_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select jsonb_build_object(
               'listed', a.date_assigned is null or a.date_assigned <= d.today,
               'closes_on', case a.after_due when 'until' then a.accept_until when 'stop' then a.due_date end,
               'open', case a.after_due when 'until' then d.today <= a.accept_until
                                        when 'stop' then a.due_date is null or d.today <= a.due_date
                                        else true end,
               'late', a.due_date is not null and d.today > a.due_date)
      from assessment a
      join course c on c.id = a.course_id
     cross join lateral (select (now() at time zone public._fv_timezone(c.timezone))::date as today) d
     where a.id = p_assessment_id;
$function$;

-- ── 10. work: what the student's page shows about sending ───────────────────
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
                       -- a send of this student's that is not finished
                       'sending', case when u.id is null then null else jsonb_build_object(
                                      'submission_id', u.id, 'intent', u.intent, 'started_at', u.created_at,
                                      'pages', (select count(*) from submission_file f where f.submission_id = u.id)) end)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
             cross join lateral (select _work_window(a.id) as j) w
              left join lateral (select x.* from submission x
                                  where x.assessment_id = a.id and x.enrollment_id = p_enrollment_id and x.state = 'sent'
                                  order by x.version desc limit 1) s on true
              left join lateral (select x.* from submission x
                                  where x.assessment_id = a.id and x.enrollment_id = p_enrollment_id
                                    and x.state = 'sending' and x.sent_by = 'student' limit 1) u on true
             cross join lateral (select s.id is not null and _grading_started(p_enrollment_id, a.id) as started) g
             where a.course_id = _course.id
               and (w.j->>'listed')::boolean
               and (a.students_send <> 'nothing' or s.id is not null)), '[]'::jsonb));
end;
$function$;

-- ── 11. send_start and replace ──────────────────────────────────────────────
create or replace function student_submit._send_begin(
    p_intent text, p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb,
    p_note text, p_followed_plan text, p_request_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb;
    _course course%rowtype;
    _a      assessment%rowtype;
    _w      jsonb;
    _card   uuid;
    _sub    submission%rowtype;
    _sent   submission%rowtype;
    _n      int;
    _oldest timestamptz;
    _id     uuid;
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

    -- The same request again (the reply was lost): the same answer, and
    -- nothing new is made or counted.
    select * into _sub from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and sent_by = 'student' and request_id = p_request_id;
    if found then
        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,
                                  'bucket', public._work_bucket(), 'late', _sub.is_late,
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
    end if;

    -- Twenty sends an hour for one card (Colin, Nov 9). Counted when links
    -- are handed out, so unsending does not give a send back.
    delete from send_log where at < now() - interval '1 day';
    select count(*), min(at) into _n, _oldest from send_log where card_id = _card and at > now() - interval '1 hour';
    if _n >= 20 then
        return jsonb_build_object('ok', false, 'error', 'too_many',
                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));
    end if;
    insert into send_log (card_id) values (_card);

    -- A send this student started for the piece and never finished goes.
    perform set_config('fv.work_removal_reason', 'abandoned', true);
    delete from submission
     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';
    perform set_config('fv.work_removal_reason', '', true);

    _id := public._work_begin(_course.id, _a.id, p_enrollment_id, 'student', p_intent,
                              case when p_intent = 'replace' then _sent.id end,
                              p_pages, p_note, p_followed_plan, (_w->>'late')::boolean, _card, p_request_id);
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _id, 'state', 'sending',
                              'bucket', public._work_bucket(), 'late', (_w->>'late')::boolean,
                              'files', public._work_upload_json(_id));
end;
$function$;

create or replace function student_submit.send_start(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb,
    p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select student_submit._send_begin('new', p_session_token, p_enrollment_id, p_assessment_id, p_pages,
                                      p_note, p_followed_plan, p_request_id);
$function$;

create or replace function student_submit.replace(
    p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb,
    p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select student_submit._send_begin('replace', p_session_token, p_enrollment_id, p_assessment_id, p_pages,
                                      p_note, p_followed_plan, p_request_id);
$function$;

-- ── 12. send_finish ─────────────────────────────────────────────────────────
create or replace function student_submit.send_finish(
    p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_files jsonb, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb;
    _course course%rowtype;
    _sub    submission%rowtype;
    _target submission%rowtype;
    _a      assessment%rowtype;
    _state  jsonb;
    _pages  int;
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
    -- Send Work turned off, or the piece set to take nothing, since it was
    -- started. Whether it was open, and late, was settled when it started.
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = _sub.assessment_id;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    -- Its upload links have stopped working: start again.
    if _sub.created_at < now() - interval '2 hours' then
        return jsonb_build_object('ok', false, 'error', 'expired');
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
        -- Let go of what it replaces first: an unfinished send goes with
        -- its target, and this one is about to take its place.
        update submission set intent = 'new', target_id = null where id = _sub.id;
        perform set_config('fv.work_removal_reason', 'replace', true);
        delete from submission where id = _target.id;
        perform set_config('fv.work_removal_reason', '', true);
    elsif exists (select 1 from submission
                   where assessment_id = _sub.assessment_id and enrollment_id = p_enrollment_id and state = 'sent') then
        -- The teacher added this student's work while the pages were going up.
        perform set_config('fv.work_removal_reason', 'abandoned', true);
        delete from submission where id = _sub.id;
        perform set_config('fv.work_removal_reason', '', true);
        return jsonb_build_object('ok', false, 'error', 'already_sent');
    end if;

    _pages := public._work_settle_files(_sub.id, p_files);
    update submission
       set state = 'sent', intent = 'new', target_id = null, version = coalesce(_target.version, version),
           sent_at = now(), updated_at = now()
     where id = _sub.id
    returning * into _sub;
    return jsonb_build_object('ok', true, 'replayed', false, 'submission_id', _sub.id, 'sent_at', _sub.sent_at,
                              'late', _sub.is_late, 'pages', _pages);
end;
$function$;

-- ── 13. unsend ──────────────────────────────────────────────────────────────
-- THE STUDENT'S PHOTOS ARE DELETED and cannot come back.
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
        return jsonb_build_object('ok', true, 'unsent', false, 'cancelled', _cancelled > 0, 'pages', 0);
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

    select count(*) into _pages from submission_file f where f.submission_id = _sent.id;
    perform set_config('fv.work_removal_reason', 'unsend', true);
    delete from submission where id = _sent.id;
    perform set_config('fv.work_removal_reason', '', true);
    return jsonb_build_object('ok', true, 'unsent', true, 'cancelled', _cancelled > 0, 'pages', _pages);
end;
$function$;

-- ── 14. file_links: which files a student may be given links to ─────────────
-- The student's own pages for one piece, handed in. The edge function signs
-- a short-lived link for each path this returns, and for nothing else.
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
               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'), '[]'::jsonb));
end;
$function$;

-- ── 15. Working the removal queue down ──────────────────────────────────────
-- Files to delete now, for a caller that holds the service key. It deletes
-- them through the Storage API and then calls removal_done with the ids.
-- First the ones never tried, newest first (someone just pressed Unsend),
-- then the ones tried longest ago. A file that is gone but whose upload link
-- was still alive is offered once more after the link has died.
create or replace function student_submit.removal_batch(p_limit integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _ids bigint[];
begin
    select coalesce(array_agg(x.id), '{}') into _ids
      from (select r.id from submission_file_removal r
             where not r.done and (r.removed_at is null or r.link_dies_at <= now())
             order by (r.tries = 0) desc, case when r.tries = 0 then r.queued_at end desc, r.last_try_at, r.id
             limit greatest(1, least(coalesce(p_limit, 100), 1000))
               for update skip locked) x;
    update submission_file_removal set tries = tries + 1, last_try_at = now() where id = any (_ids);
    return jsonb_build_object(
        'ok', true,
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'bucket', r.bucket, 'path', r.path) order by r.id)
                             from submission_file_removal r where r.id = any (_ids)), '[]'::jsonb),
        'left', (select count(*) from submission_file_removal r
                  where not r.done and (r.removed_at is null or r.link_dies_at <= now()) and r.id <> all (_ids)));
end;
$function$;

-- The caller says it deleted these. Each is believed only if storage's own
-- table no longer has the file; one that is still there stays on the list.
create or replace function student_submit.removal_done(p_ids bigint[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _gone  int;
    _still jsonb;
begin
    update submission_file_removal r
       set removed_at = now(), done = now() >= r.link_dies_at
     where r.id = any (coalesce(p_ids, '{}')) and not r.done
       -- a path a page has since been given cannot happen (a file's name is
       -- its row's id); if it ever did, the file would not be marked gone
       and not exists (select 1 from submission_file f where f.path = r.path or f.thumb_path = r.path)
       and not exists (select 1 from public._work_object(r.path));
    get diagnostics _gone = row_count;
    select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into _still
      from submission_file_removal r
     where r.id = any (coalesce(p_ids, '{}')) and not r.done and r.removed_at is null;
    return jsonb_build_object('ok', true, 'gone', _gone, 'still_there', _still);
end;
$function$;

-- ── Who can run what ────────────────────────────────────────────────────────
-- The teacher's RPCs: signed-in teachers, through the API.
revoke all on function public.set_course_send_work(uuid, jsonb, uuid) from public, anon;
revoke all on function public.set_assessment_student_work(uuid, jsonb, uuid) from public, anon;
revoke all on function public.list_course_submissions(uuid) from public, anon;
revoke all on function public.start_work_upload(uuid, uuid, jsonb, text, uuid) from public, anon;
revoke all on function public.finish_work_upload(uuid, jsonb, uuid) from public, anon;
revoke all on function public.mark_handed_in_paper(uuid, uuid[], uuid) from public, anon;
revoke all on function public.delete_submission(uuid, uuid) from public, anon;
revoke all on function public.rotate_submission_page(uuid, integer, uuid) from public, anon;
grant execute on function public.set_course_send_work(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.set_assessment_student_work(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.list_course_submissions(uuid) to authenticated, service_role;
grant execute on function public.start_work_upload(uuid, uuid, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.finish_work_upload(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.mark_handed_in_paper(uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.delete_submission(uuid, uuid) to authenticated, service_role;
grant execute on function public.rotate_submission_page(uuid, integer, uuid) to authenticated, service_role;

-- Helpers in public: nobody is granted them, the service role included
-- (whatever the schema's defaults would have given). They are called by the
-- functions above, as their owner.
revoke all on function public._work_bucket() from public, anon, authenticated, service_role;
revoke all on function public._work_max_bytes() from public, anon, authenticated, service_role;
revoke all on function public._work_object(text) from public, anon, authenticated, service_role;
revoke all on function public._work_check_pages(jsonb) from public, anon, authenticated, service_role;
revoke all on function public._work_check_files(jsonb) from public, anon, authenticated, service_role;
revoke all on function public._work_begin(uuid, uuid, uuid, text, text, uuid, jsonb, text, text, boolean, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public._work_files_state(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._work_settle_files(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._work_upload_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public._submission_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public._assessment_work_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public._submission_same_class() from public, anon, authenticated, service_role;
revoke all on function public._submission_file_removed() from public, anon, authenticated, service_role;
revoke all on function public._submission_target_gone() from public, anon, authenticated, service_role;
revoke all on function public._submission_gone() from public, anon, authenticated, service_role;
revoke all on function public._submission_truncated() from public, anon, authenticated, service_role;

-- What the storage policies call. Storage asks as the signed-in teacher, so
-- that role must be able to run them; the schema is not served by the API,
-- so they cannot be called as RPCs.
revoke all on function fv_private.work_path_course(text) from public, anon;
revoke all on function fv_private.work_upload_allowed(text) from public, anon;
revoke all on function fv_private.work_read_allowed(text) from public, anon;
grant execute on function fv_private.work_path_course(text) to authenticated, service_role;
grant execute on function fv_private.work_upload_allowed(text) to authenticated, service_role;
grant execute on function fv_private.work_read_allowed(text) to authenticated, service_role;

-- The student's side: the service role only, as every function in the
-- schema is. The helpers are granted to nobody.
revoke all on function student_submit._grading_started(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function student_submit._send_session(text, uuid) from public, anon, authenticated, service_role;
revoke all on function student_submit._work_window(uuid) from public, anon, authenticated, service_role;
revoke all on function student_submit._send_begin(text, text, uuid, uuid, jsonb, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function student_submit.work(text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.send_start(text, uuid, uuid, jsonb, text, text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.replace(text, uuid, uuid, jsonb, text, text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.send_finish(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function student_submit.unsend(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.file_links(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.removal_batch(integer) from public, anon, authenticated;
revoke all on function student_submit.removal_done(bigint[]) from public, anon, authenticated;
grant execute on function student_submit.work(text, uuid, text) to service_role;
grant execute on function student_submit.send_start(text, uuid, uuid, jsonb, text, text, uuid, text) to service_role;
grant execute on function student_submit.replace(text, uuid, uuid, jsonb, text, text, uuid, text) to service_role;
grant execute on function student_submit.send_finish(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.unsend(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.file_links(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.removal_batch(integer) to service_role;
grant execute on function student_submit.removal_done(bigint[]) to service_role;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/submissions_fingerprints.py)
            ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
            ('public._work_max_bytes()',                                                            '1384cb1ea953d11cea982d60d87e5421'),
            ('public._work_object(text)',                                                           'e52420e0be52353b1208dbc395ae9e5c'),
            ('public._work_check_pages(jsonb)',                                                     '4f17b090aea75e8d9d9b296f99f0f5a8'),
            ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '57e75c6fa0bbbd12a04e11d21752bc5b'),
            ('public._work_files_state(uuid,jsonb)',                                                '975d75466b7b1dd7100240028441bea8'),
            ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
            ('public._submission_json(uuid)',                                                       '2d20f60def0f309725f16b7b86477fab'),
            ('public._assessment_work_json(uuid)',                                                  'e281660216f4186fe3f374eeacaf2fe6'),
            ('public._submission_same_class()',                                                     '301c53b36722954a92211ea582b7842a'),
            ('public._submission_file_removed()',                                                   '6baa9df0a3f31f3f7a55bb7771c4e8a9'),
            ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
            ('public._submission_gone()',                                                           '606be06c71d963805c12f23208b5c304'),
            ('public._submission_truncated()',                                                      '9abaa6530a1e7f7215951d9952675de0'),
            ('public.set_course_send_work(uuid,jsonb,uuid)',                                        '694863746b03f4be25263a5107f5b02e'),
            ('public.set_assessment_student_work(uuid,jsonb,uuid)',                                 'c58c518c44d32262b3713753b7aaac1f'),
            ('public.list_course_submissions(uuid)',                                                '8703f5ddc09b3c8dc92aa70878b5d7b1'),
            ('public.start_work_upload(uuid,uuid,jsonb,text,uuid)',                                 'ef4590b75c38b428fcdb81b92a2407f3'),
            ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'd62a6e550d7535f123f58b17cfe838f2'),
            ('public.mark_handed_in_paper(uuid,uuid[],uuid)',                                       '1a966bceb2e46eb59107e2753e731bd4'),
            ('public.delete_submission(uuid,uuid)',                                                 '7da38ac3304aaf2f9639877b3fd0f81a'),
            ('public.rotate_submission_page(uuid,integer,uuid)',                                    'e684b853403b25a1706d29f02a581d5c'),
            ('fv_private.work_path_course(text)',                                                   '7fb0272243ceef1cb6b42658d27664e3'),
            ('fv_private.work_upload_allowed(text)',                                                '02b678a47cb50ef6bf233a0ff244b51c'),
            ('fv_private.work_read_allowed(text)',                                                  'd5462a39d4090cdd6c2d1e8df067729c'),
            ('student_submit._grading_started(uuid,uuid)',                                          '720b9f044b853b5c57b04bec7f59010c'),
            ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
            ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',                '751249a78b6c05e4927d17805e5423fa'),
            ('student_submit.work(text,uuid,text)',                                                 '72233e7985f93eb6a150c1822ed69d14'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                               '1b9663c49c49714ec7de2f43e872b0cd'),
            ('student_submit.unsend(text,uuid,uuid,text)',                                          '719b3aef45f8946343138924b84a03e9'),
            ('student_submit.file_links(text,uuid,uuid,text)',                                      '99ef3b9e89574fae0a230c4464998baf'),
            ('student_submit.removal_batch(integer)',                                               '964eef99a747dc7180d4ad61bd19b1db'),
            ('student_submit.removal_done(bigint[])',                                               'de793c82a2b5aa59052994a82e80d166')
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
