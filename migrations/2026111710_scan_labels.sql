-- Sticker codes for scanned paper (2026-11-17). NOT APPLIED: needs Colin's OK (rule 1).
--
-- THIS FILE CHANGES NO EXISTING ROW, TABLE OR FUNCTION. It adds one empty
-- table and four functions. Until a teacher prints sticker sheets the table
-- stays empty.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Add Work for the Class, slice B4 (docs/plans/add-work-for-class-plan.md;
-- DECISIONS, "Add Work for the Class"). Each student keeps a sheet of small
-- stickers; one goes on the first page of each paper, and a scanned pile
-- names its own pieces. Colin, Nov 17: "finish all of the slices"; the plan's
-- decision 3 (how a sticker's code is kept) taken as recommended, a table of
-- its own, so a code is the same on every computer the teacher uses and a
-- lost sheet can be replaced with the old code retired.
--
-- ── What a code is ─────────────────────────────────────────────────────────
-- Twelve characters from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ, drawn at random
-- by the database (sixty random bits from gen_random_uuid(), PostgreSQL's
-- strong source). It says nothing about the student: no name, number, class
-- or order is in it. It is not a student card code (those are eight
-- characters and are never stored readable) and no function of the student
-- page (student_submit, the student-submit edge function) reads this table,
-- so a sticker cannot sign anyone in. The app prints it as a QR code and
-- reads it back in the teacher's own browser to find whose paper a scanned
-- page is. The code is stored readable because it opens nothing: it is a
-- name tag the teacher's own app matches against the teacher's own class.
--
-- ── What it adds ───────────────────────────────────────────────────────────
-- public.scan_label: id, enrollment_id (references enrollment on delete
--   cascade: a student or class that is deleted takes its codes along),
--   code (unique across every class, checked against the alphabet),
--   created_at, retired_at. One live code for a student at a time (a unique
--   index where retired_at is null). Row security on, no policy and no
--   grants: nobody reads or writes it but the three functions below.
-- fv_private.scan_label_new(p_enrollment_id) returns the new code: draws a
--   code and stores it; draws again if the code is taken; if the student
--   already has a live code it answers that one and adds nothing. No role
--   may call it.
-- public.list_scan_labels(p_course_id) returns { labels: [ { enrollment_id,
--   code, retired } ] }: every code of the class, live and retired, so the
--   app can say "this sticker is from a sheet that was replaced" and never
--   guess. Read-only.
-- public.issue_scan_labels(p_course_id, p_idempotency_key) gives a live code
--   to each student of the class who is not withdrawn and has none, and
--   returns { labels: [ { enrollment_id, code } ] }: the live codes of the
--   students not withdrawn. A second call changes nothing.
-- public.reissue_scan_label(p_enrollment_id, p_idempotency_key) retires the
--   student's live code and returns { label: { enrollment_id, code } } with
--   a new one (a lost sheet). { label: null } for a withdrawn student.
-- The three public functions run as their owner and check the class with
--   fv_owns_course / fv_owns_enrollment: another teacher's class or student,
--   a class in the trash, or one that is gone answers empty ({ labels: [] }
--   or { label: null }) and changes nothing, with no error. Signed out:
--   PT401. A visitor (anon) may not run them. The two that write are
--   idempotent through p_idempotency_key (CLAUDE.md rule 7): the same key
--   again answers what the first call answered and writes nothing.
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new functions, as this file
-- leaves them):
--   public.list_scan_labels(uuid) (new)              6e03772c7b669ba5bedceb1cd0bfcf02
--   public.issue_scan_labels(uuid,uuid) (new)        d2d083b6c33a2cf8991ca65234606169
--   public.reissue_scan_label(uuid,uuid) (new)       ff61b3bb56f7aae8b341937caacb4f55
--   fv_private.scan_label_new(uuid) (new)            09f8ff09c3fbd118697d0eeddbe93ba2
-- Relied on, unchanged (function, live):
--   public.fv_owns_course(uuid)                      e3afeca06043a6e907e6f4ae777c85da
--   public.fv_owns_enrollment(uuid)                  728526648388367393162be706f7f9ea
--   public.fv_idem_check(uuid,text)                  1c7b546434bee4b774557e0e6b16024f
--   public.fv_idem_store(uuid,text,jsonb)            6d0b48c458d273a332db39e1a4b68626
--
-- ── The checks it makes first ──────────────────────────────────────────────
-- It stops with nothing changed unless the four functions it relies on are
-- the definitions it was tested against, its own four are missing or this
-- file's (a second run), no function of those names exists with other
-- arguments or in another schema, and public.scan_label is missing or has
-- exactly this file's columns. Read-only from gradebook-prod: the query in
-- migrations/local-test/scan-labels-live-precheck.sql.
--
-- ── Rows ───────────────────────────────────────────────────────────────────
-- None changes and none is added: the table starts empty. Nothing that
-- exists today is hidden, refused or deleted.
--
-- ── Locks ──────────────────────────────────────────────────────────────────
-- The new table's foreign key takes a brief lock on public.enrollment. If a
-- long transaction holds it, the file gives up after five seconds with
-- nothing applied: run it again.
--
-- ── Order ──────────────────────────────────────────────────────────────────
-- After 2026111705. Apply before the app that calls the three functions; the
-- app on teachers' pages now does not call them, so it is unchanged.
--
-- Tested on a throwaway PostgreSQL 17 rebuilt equal to live:
-- migrations/local-test/scan_labels.py (README.md, "Sticker codes"). Undo:
-- migrations/local-test/scan-labels-undo.sql. After:
-- migrations/local-test/scan-labels-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

-- ── 1. The checks, before anything changes ─────────────────────────────────
do $guard$
declare
    _f    record;
    _md5  text;
    _cols text;
begin
    for _f in select * from (values
        ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da', null),
        ('public.fv_owns_enrollment(uuid)', '728526648388367393162be706f7f9ea', null),
        ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f', null),
        ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626', null),
        ('public.list_scan_labels(uuid)', null, '6e03772c7b669ba5bedceb1cd0bfcf02'),
        ('public.issue_scan_labels(uuid,uuid)', null, 'd2d083b6c33a2cf8991ca65234606169'),
        ('public.reissue_scan_label(uuid,uuid)', null, 'ff61b3bb56f7aae8b341937caacb4f55'),
        ('fv_private.scan_label_new(uuid)', null, '09f8ff09c3fbd118697d0eeddbe93ba2')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname in ('list_scan_labels', 'issue_scan_labels', 'reissue_scan_label', 'scan_label_new')
                 and oid not in (coalesce(to_regprocedure('public.list_scan_labels(uuid)'), 0),
                                 coalesce(to_regprocedure('public.issue_scan_labels(uuid,uuid)'), 0),
                                 coalesce(to_regprocedure('public.reissue_scan_label(uuid,uuid)'), 0),
                                 coalesce(to_regprocedure('fv_private.scan_label_new(uuid)'), 0))) then
        raise exception 'A sticker-code function exists with other arguments or in another schema. Nothing was changed.';
    end if;
    if to_regclass('public.scan_label') is not null then
        select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _cols
          from pg_attribute where attrelid = 'public.scan_label'::regclass and attnum > 0 and not attisdropped;
        if _cols is distinct from 'id uuid, enrollment_id uuid, code text, created_at timestamp with time zone, retired_at timestamp with time zone' then
            raise exception 'public.scan_label exists and is not this file''s (%). Nothing was changed.', _cols;
        end if;
    end if;
end
$guard$;

-- ── 2. The table ───────────────────────────────────────────────────────────
create table if not exists public.scan_label (
    id            uuid primary key default gen_random_uuid(),
    enrollment_id uuid not null references public.enrollment(id) on delete cascade,
    code          text not null,
    created_at    timestamptz not null default now(),
    retired_at    timestamptz,
    constraint scan_label_code_key unique (code),
    constraint scan_label_code_check check (code ~ '^[2-9A-HJ-NP-Z]{12}$')
);
create unique index if not exists scan_label_one_live_idx on public.scan_label using btree (enrollment_id) where (retired_at is null);
create index if not exists scan_label_enrollment_idx on public.scan_label using btree (enrollment_id);

alter table public.scan_label enable row level security;
revoke all on table public.scan_label from public, anon, authenticated, service_role;

comment on table public.scan_label is
    'A random code printed on a student''s sticker sheet, so a scanned paper names its student (Add Work for the Class). It says nothing about the student and signs no one in. One live code per student; a reprint retires the old one. Read and written only through list_scan_labels, issue_scan_labels and reissue_scan_label.';

-- ── 3. Drawing a code ──────────────────────────────────────────────────────
create or replace function fv_private.scan_label_new(p_enrollment_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
    _alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    _b    bytea;
    _code text;
    _try  int := 0;
begin
    loop
        _try := _try + 1;
        -- Twelve characters of five random bits each. gen_random_uuid() draws from
        -- the server's strong random source; its bytes 0 to 5 and 10 to 15 are
        -- random in every bit (bytes 6 and 8 carry the version and the variant).
        _b := uuid_send(gen_random_uuid());
        _code := '';
        for _i in 0..11 loop
            _code := _code || substr(_alphabet, (get_byte(_b, case when _i < 6 then _i else _i + 4 end) & 31) + 1, 1);
        end loop;
        begin
            insert into public.scan_label (enrollment_id, code) values (p_enrollment_id, _code);
            return _code;
        exception when unique_violation then
            -- The student already has a live code: that one is the answer.
            select l.code into _code from public.scan_label l
             where l.enrollment_id = p_enrollment_id and l.retired_at is null;
            if found then
                return _code;
            end if;
            -- Otherwise the code itself is taken (sixty random bits: it will not
            -- happen, and if it does, draw again).
            if _try >= 5 then
                raise;
            end if;
        end;
    end loop;
end;
$function$;

revoke all on function fv_private.scan_label_new(uuid) from public, anon, authenticated, service_role;

-- ── 4. The three functions the app calls ───────────────────────────────────
create or replace function public.list_scan_labels(p_course_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    -- Another teacher's class, one in the trash, or one that is gone: nothing.
    if not fv_owns_course(p_course_id) then
        return jsonb_build_object('labels', '[]'::jsonb);
    end if;
    return jsonb_build_object('labels', coalesce((
        select jsonb_agg(jsonb_build_object('enrollment_id', l.enrollment_id, 'code', l.code, 'retired', l.retired_at is not null)
                         order by e.roster_position, e.id, l.created_at, l.id)
          from scan_label l join enrollment e on e.id = l.enrollment_id
         where e.course_id = p_course_id), '[]'::jsonb));
end;
$function$;

create or replace function public.issue_scan_labels(p_course_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _e      uuid;
    _out    jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'issue_scan_labels');
    if _cached is not null then
        return _cached;
    end if;
    -- Another teacher's class, one in the trash, or one that is gone: nothing
    -- is made and nothing is said about it.
    if not fv_owns_course(p_course_id) then
        return jsonb_build_object('labels', '[]'::jsonb);
    end if;
    -- One call at a time for a class, so two windows printing at once give
    -- each student one code, not two.
    perform pg_advisory_xact_lock(hashtext('fv.scan_label'), hashtext(p_course_id::text));
    for _e in
        select e.id from enrollment e
         where e.course_id = p_course_id and e.withdrawn_at is null
           and not exists (select 1 from scan_label l where l.enrollment_id = e.id and l.retired_at is null)
         order by e.roster_position, e.id
    loop
        perform fv_private.scan_label_new(_e);
    end loop;
    _out := jsonb_build_object('labels', coalesce((
        select jsonb_agg(jsonb_build_object('enrollment_id', l.enrollment_id, 'code', l.code) order by e.roster_position, e.id)
          from scan_label l join enrollment e on e.id = l.enrollment_id
         where e.course_id = p_course_id and e.withdrawn_at is null and l.retired_at is null), '[]'::jsonb));
    perform fv_idem_store(p_idempotency_key, 'issue_scan_labels', _out);
    return _out;
end;
$function$;

create or replace function public.reissue_scan_label(p_enrollment_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _course uuid;
    _code   text;
    _out    jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'reissue_scan_label');
    if _cached is not null then
        return _cached;
    end if;
    -- Another teacher's student, a class in the trash, or a student who is
    -- gone: nothing changes.
    if not fv_owns_enrollment(p_enrollment_id) then
        return jsonb_build_object('label', null);
    end if;
    -- A withdrawn student gets no new sheet; the code they had is left as it is.
    select e.course_id into _course from enrollment e where e.id = p_enrollment_id and e.withdrawn_at is null;
    if _course is null then
        return jsonb_build_object('label', null);
    end if;
    perform pg_advisory_xact_lock(hashtext('fv.scan_label'), hashtext(_course::text));
    update scan_label set retired_at = now() where enrollment_id = p_enrollment_id and retired_at is null;
    _code := fv_private.scan_label_new(p_enrollment_id);
    _out := jsonb_build_object('label', jsonb_build_object('enrollment_id', p_enrollment_id, 'code', _code));
    perform fv_idem_store(p_idempotency_key, 'reissue_scan_label', _out);
    return _out;
end;
$function$;

revoke all on function public.list_scan_labels(uuid) from public, anon;
grant execute on function public.list_scan_labels(uuid) to authenticated, service_role;
revoke all on function public.issue_scan_labels(uuid, uuid) from public, anon;
grant execute on function public.issue_scan_labels(uuid, uuid) to authenticated, service_role;
revoke all on function public.reissue_scan_label(uuid, uuid) from public, anon;
grant execute on function public.reissue_scan_label(uuid, uuid) to authenticated, service_role;

-- ── 5. The new functions are this file's ───────────────────────────────────
do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('public.list_scan_labels(uuid)', '6e03772c7b669ba5bedceb1cd0bfcf02'),
        ('public.issue_scan_labels(uuid,uuid)', 'd2d083b6c33a2cf8991ca65234606169'),
        ('public.reissue_scan_label(uuid,uuid)', 'ff61b3bb56f7aae8b341937caacb4f55'),
        ('fv_private.scan_label_new(uuid)', '09f8ff09c3fbd118697d0eeddbe93ba2')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
end
$after$;

commit;
