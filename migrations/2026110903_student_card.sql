-- Student cards (2026-11-09). Student page build plan, S0-M2 (Batch A).
-- docs/plans/student-page-build-plan.md 1.5 and S3; DECISIONS, "Student
-- cards" (2026-11-07), "Grades, photos and sign-in on the student page" 9
-- and 13, "Student page build answers" 7.
--
-- What is needed: one printed card per student per course. Its code opens
-- the student's page until a date the teacher sets, where a questionnaire
-- slip's code opens one questionnaire once. Nothing uses a card until the
-- sessions migration (2026110904) and the edge function are in.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- 1. student_card, one LIVE card per enrollment (a unique index on the rows
--    with no stopped_at):
--      code            the code as printed, K7M-4QX. Kept readable so the
--                      class's teacher can show or reprint a card without
--                      stopping it (Colin, Nov 9). Row security shows it to
--                      that teacher only.
--      code_hash, salt what the student path checks: the same alphabet,
--                      length and salted SHA-256 as a questionnaire slip
--                      (_new_access_code, _access_code_hash).
--      password        the four-digit card password printed on this card,
--                      for a student with no birthday and no student number
--                      when it was made; else null. It is the card's own, so
--                      it keeps working after a birthday or number is added
--                      and after other cards or slips are printed for the
--                      student (the Nov 3 slip fix, for cards).
--      created_at, printed_at, last_opened_at
--      wrong_tries     wrong answers to "Is This You?" in a row. A right
--                      answer sets it back to 0; the fifth in a row locks
--                      the card (Colin, Nov 9).
--      wrong_times     when each wrong answer of the last 7 days was given.
--                      The fifteenth inside 7 days locks the card whatever
--                      right answers came between (Colin, Nov 9: "add a
--                      slow lock"), so four wrong and one right, over and
--                      over, is not a way to keep guessing.
--      locked_at       when it locked. Unlock clears all three.
--      stopped_at      when it was reissued. A stopped card never opens
--                      again; its row stays as history.
--      works_until     the card's last day, written when it is made: the
--                      class's Cards Work Until then (2). It does not move
--                      by itself afterwards: a card keeps the day it was
--                      printed with when reporting dates are added later.
--    Teachers read their own rows (fv_owns_enrollment). Nobody writes the
--    table directly: only the functions below and the student path do.
--
-- 2. course.cards_work_until date, null. The class's Cards Work Until. Null
--    means the default: the class's last reporting date (the latest ends_on
--    in course.reporting_terms), or the next June 30 when the class has no
--    terms or its last reporting date has already passed (a card is never
--    made already expired by the default). The date is worked out when a
--    card is made, or when the teacher sets it, and written on the card; a
--    card works through that day in the class's time zone, so a card made
--    on June 30 with no reporting dates lasts that day only.
--    set_cards_work_until(c, null) rewrites every live card in the class to
--    the default as it works out that day. A class time zone or a term date that cannot be read
--    is treated as America/Vancouver, or left out: nothing a teacher saves
--    can make the student's route fail.
--
-- 3. Teacher RPCs. Each is SECURITY DEFINER with its own ownership check
--    and takes p_idempotency_key (fv_idem_check).
--      issue_student_cards(p_course_id, p_enrollment_ids, p_idempotency_key)
--        makes a card for every enrolled student in the class (or the
--        listed ones) who has no live card. A student who has one keeps it:
--        printing again never stops a card. A student with no birthday and
--        no student number gets a four-digit card password: the one their
--        slips print (_slip_password), copied onto the card. A student who
--        has either is not passed to _slip_password, so issuing a card
--        never clears a password an earlier slip or card printed.
--        Returns { issued, cards }.
--      list_student_cards(p_course_id)
--        the class's live cards for the Student Cards page and the print
--        sheet: [{ id, enrollment_id, code, created_at, printed_at,
--        last_opened_at, locked_at, wrong_tries, wrong_tries_7d,
--        works_until, check, password }]. wrong_tries_7d is how many wrong
--        answers the card has had in the last 7 days. check is 'identity' (birthday or student number on
--        file) or 'password'; password is the card password to print when
--        check is 'password', else null.
--      mark_student_cards_printed(p_card_ids, p_idempotency_key)
--        sets printed_at. Returns { printed }.
--      unlock_student_card(p_card_id, p_idempotency_key)
--        clears the lock and the wrong-try count. Returns the card.
--      unlock_all_student_cards(p_course_id, p_idempotency_key)
--        Unlock All: the same for every locked live card in the class.
--        Returns { unlocked }.
--      reissue_student_card(p_card_id, p_idempotency_key)
--        stops the card at once and makes a new one for the same student.
--        Everything the student sent stays: nothing points at a card but
--        the device sessions it opened, and those end. A new card for a
--        student with no birthday or number prints a NEW password, not the
--        lost card's. Returns the new card.
--      set_cards_work_until(p_course_id, p_date, p_idempotency_key)
--        sets the class's date (null = the default, worked out now) and
--        writes it on every live card in the class. Returns { works_until }.
--    Errors: PT401 not signed in; P0002 class or card not found (or not the
--    caller's); 22023 a card already stopped.
--
-- 4. A new slip avoids every live card's code (Colin, Nov 9: "check slips
--    too"), as a new card avoids every live slip's. _issue_access_code and
--    _issue_report_code are patched in place, two lines each (one of them a
--    comment): the draw also goes again when the code is a live card's. The
--    file stops, with nothing
--    changed, if either is not the body in the repo
--    (20261025_student_submit.sql, 20261025_phone_reports.sql).
--
-- Who else changes an enrollment: clear_data deletes the caller's classes and
-- students, and relink_student deletes a duplicate enrollment; the cards of
-- a deleted enrollment go with it. When relink_student moves an enrollment
-- to the real student record the enrollment keeps its id and its card, and
-- "Is This You?" then asks for that record's birthday or student number;
-- the card's own password still works.
--
-- Functions this file leaves callable by signed-in teachers through the API:
-- issue_student_cards, list_student_cards, mark_student_cards_printed,
-- unlock_student_card, unlock_all_student_cards, reissue_student_card and
-- set_cards_work_until.
--
-- No existing row changes. Every class gets cards_work_until = null. The
-- file can be run again.
--
-- One transaction: the file opens with begin and ends with commit, as
-- 20261027_score_comments.sql and 20261031_score_report_note.sql do, so it
-- is all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first, before anything
-- is created or changed.
begin;

-- Give up after five seconds rather than queue behind a long transaction and
-- hold every teacher's saves up behind this one. If it gives up, nothing is
-- applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _def text;
begin
    -- The two functions that draw slip codes must be the bodies in the repo
    -- (md5 of pg_get_functiondef), or already carry the patch (a second run).
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)', '020cb811d2214dd5866cc2cf4ab705eb')
        ) as v(fn, was)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        if position('live student card' in _def) = 0 and md5(_def) <> _f.was then
            raise exception '% is not the definition this migration was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, md5(_def), _f.was;
        end if;
    end loop;
    perform 'public._new_access_code()'::regprocedure, 'public._access_code_hash(text,text)'::regprocedure,
            'public._slip_password(uuid)'::regprocedure, 'public.fv_owns_course(uuid)'::regprocedure;
end
$guard$;

alter table public.course add column if not exists cards_work_until date;
comment on column public.course.cards_work_until is
    'The last day the class''s student cards work. Null: the class''s last reporting date.';

create table if not exists public.student_card (
    id             uuid        primary key default gen_random_uuid(),
    enrollment_id  uuid        not null references public.enrollment(id) on delete cascade,
    code           text        not null,
    code_hash      text        not null constraint student_card_code_hash_key unique,
    salt           text        not null,
    created_at     timestamptz not null default now(),
    printed_at     timestamptz,
    last_opened_at timestamptz,
    wrong_tries    integer     not null default 0 constraint student_card_wrong_tries_check check (wrong_tries >= 0),
    wrong_times    timestamptz[] not null default '{}',
    locked_at      timestamptz,
    stopped_at     timestamptz,
    works_until    date        not null,
    password       text
);
create unique index if not exists student_card_one_live on public.student_card (enrollment_id) where stopped_at is null;
-- No two live cards read the same: what _issue_student_card's draw relies on.
create unique index if not exists student_card_live_code on public.student_card (code) where stopped_at is null;
create index if not exists student_card_enrollment_idx on public.student_card (enrollment_id);
comment on table public.student_card is
    'A student''s printed card for one class. One live card per enrollment; a reissue stops the old one and keeps its row.';

alter table public.student_card enable row level security;
drop policy if exists student_card_read on public.student_card;
create policy student_card_read on public.student_card
    for select
    using (public.fv_owns_enrollment(enrollment_id));
revoke all on table public.student_card from public, anon, authenticated;
grant select on table public.student_card to authenticated;

-- ── Reading what a teacher saved without failing on it ──────────────────────
-- course.timezone is free text and update_course takes any. A zone Postgres
-- does not know reads as America/Vancouver.
create or replace function public._fv_timezone(p_tz text)
 returns text
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if nullif(btrim(p_tz), '') is null then return 'America/Vancouver'; end if;
    perform now() at time zone p_tz;
    return p_tz;
exception when others then
    return 'America/Vancouver';
end;
$function$;

-- A YYYY-MM-DD string as a date, or null when it is not one (2027-02-30).
create or replace function public._fv_date(p text)
 returns date
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
    return p::date;
exception when others then
    return null;
end;
$function$;
revoke all on function public._fv_timezone(text) from public, anon, authenticated;
revoke all on function public._fv_date(text) from public, anon, authenticated;

-- ── The class's Cards Work Until, as a date ─────────────────────────────────
create or replace function public._cards_work_until(p_course_id uuid)
 returns date
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select coalesce(
        c.cards_work_until,
        -- the last reporting date, unless it has already passed
        (select max(_fv_date(t->>'ends_on')) from jsonb_array_elements(
             case when jsonb_typeof(c.reporting_terms) = 'array' then c.reporting_terms else '[]'::jsonb end) t
         having max(_fv_date(t->>'ends_on')) >= (now() at time zone _fv_timezone(c.timezone))::date),
        -- No reporting date ahead: the next June 30, today included.
        (select make_date(extract(year from d.today)::int
                            + case when d.today > make_date(extract(year from d.today)::int, 6, 30) then 1 else 0 end, 6, 30)
           from (select (now() at time zone _fv_timezone(c.timezone))::date as today) d))
      from course c
     where c.id = p_course_id;
$function$;
revoke all on function public._cards_work_until(uuid) from public, anon, authenticated;

-- One card as the teacher's screens read it.
create or replace function public._student_card_json(p_card_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
               'id', k.id, 'enrollment_id', k.enrollment_id, 'code', k.code,
               'created_at', k.created_at, 'printed_at', k.printed_at, 'last_opened_at', k.last_opened_at,
               'locked_at', k.locked_at, 'wrong_tries', k.wrong_tries,
               'wrong_tries_7d', (select count(*) from unnest(k.wrong_times) t where t > now() - interval '7 days'),
               'works_until', k.works_until,
               'check', case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null
                             then 'identity' else 'password' end,
               'password', case when s.date_of_birth is null and nullif(btrim(s.student_number), '') is null
                                then k.password end)
      from student_card k
      join enrollment e on e.id = k.enrollment_id
      join student s on s.id = e.student_id
     where k.id = p_card_id;
$function$;
revoke all on function public._student_card_json(uuid) from public, anon, authenticated;

-- A new live card for one enrollment. The code reads like no other live
-- card and no live slip, so a typed code opens one thing.
create or replace function public._issue_student_card(p_enrollment_id uuid, p_not_password text default null)
 returns uuid
 language plpgsql
 volatile
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _code  text;
    _salt  text;
    _id    uuid;
    _pw    text;
    _until date;
begin
    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;
    -- A student with no birthday and no number on file needs a password to
    -- answer "Is This You?": the one their slips print, copied onto the
    -- card. A student who has either is not passed to _slip_password, which
    -- would clear a password an earlier slip or card printed.
    if exists (select 1 from enrollment e join student s on s.id = e.student_id
                where e.id = p_enrollment_id and s.date_of_birth is null
                  and nullif(btrim(s.student_number), '') is null) then
        _pw := _slip_password(p_enrollment_id);
        -- A reissue: whoever holds the lost card knows its password, so the
        -- new card gets one of its own.
        while p_not_password is not null and _pw = p_not_password loop
            _pw := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 7))::bit(28)::int % 10000)::text, 4, '0');
        end loop;
    end if;
    select _cards_work_until(e.course_id) into _until from enrollment e where e.id = p_enrollment_id;
    loop
        _code := _new_access_code();
        continue when exists (select 1 from student_card where stopped_at is null and code = _code)
                   or exists (select 1 from student_access_code
                               where revoked_at is null and expires_at > now()
                                 and code_hash = _access_code_hash(_code, salt));
        _salt := encode(uuid_send(gen_random_uuid()), 'hex');
        begin
            insert into student_card (enrollment_id, code, code_hash, salt, works_until, password)
            values (p_enrollment_id, _code, _access_code_hash(_code, _salt), _salt, _until, _pw)
            returning id into _id;
            return _id;
        exception when unique_violation then
            -- The student already has a live card (two issues at once): keep it.
            select id into _id from student_card where enrollment_id = p_enrollment_id and stopped_at is null;
            if _id is not null then return _id; end if;
            -- Otherwise the code or its hash is taken (two draws at once): draw again.
        end;
    end loop;
end;
$function$;
revoke all on function public._issue_student_card(uuid, text) from public, anon, authenticated;

-- ── A new slip avoids live card codes ───────────────────────────────────────
do $patch$
declare
    _f   record;
    _def text;
    _old constant text := $s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));$s$;
    _new constant text := $s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$s$;
begin
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)'),
            ('public._issue_report_code(uuid,uuid,timestamptz)')
        ) as v(fn)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        continue when position('live student card' in _def) > 0;  -- a second run
        if (length(_def) - length(replace(_def, _old, ''))) / length(_old) <> 1 then
            raise exception '% does not hold the draw this migration patches', _f.fn;
        end if;
        execute replace(_def, _old, _new);
    end loop;
end
$patch$;

-- ── The teacher's RPCs ──────────────────────────────────────────────────────
create or replace function public.list_student_cards(p_course_id uuid)
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
    return coalesce((
        select jsonb_agg(_student_card_json(k.id) order by e.roster_position nulls last, e.id)
          from student_card k
          join enrollment e on e.id = k.enrollment_id
         where e.course_id = p_course_id and k.stopped_at is null and e.withdrawn_at is null), '[]'::jsonb);
end;
$function$;

create or replace function public.issue_student_cards(
    p_course_id uuid, p_enrollment_ids uuid[] default null, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _eid    uuid;
    _n      int := 0;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    -- A replay issues nothing new by itself (a student with a live card is
    -- skipped), so it only needs the first call's count back.
    _cached := fv_idem_check(p_idempotency_key, 'issue_student_cards');
    if _cached is null then
        for _eid in
            select e.id from enrollment e
             where e.course_id = p_course_id and e.withdrawn_at is null
               and (p_enrollment_ids is null or e.id = any (p_enrollment_ids))
               and not exists (select 1 from student_card k where k.enrollment_id = e.id and k.stopped_at is null)
             order by e.roster_position nulls last, e.id
        loop
            perform _issue_student_card(_eid);
            _n := _n + 1;
        end loop;
        _cached := jsonb_build_object('issued', _n);
        perform fv_idem_store(p_idempotency_key, 'issue_student_cards', _cached);
    end if;
    return _cached || jsonb_build_object('cards', list_student_cards(p_course_id));
end;
$function$;

create or replace function public.mark_student_cards_printed(p_card_ids uuid[], p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _n      int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'mark_student_cards_printed');
    if _cached is not null then return _cached; end if;
    update student_card k set printed_at = now()
     where k.id = any (coalesce(p_card_ids, '{}')) and k.stopped_at is null and fv_owns_enrollment(k.enrollment_id);
    get diagnostics _n = row_count;
    _cached := jsonb_build_object('printed', _n);
    perform fv_idem_store(p_idempotency_key, 'mark_student_cards_printed', _cached);
    return _cached;
end;
$function$;

create or replace function public.unlock_student_card(p_card_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'unlock_student_card');
    if _cached is not null then return _cached; end if;
    update student_card k set locked_at = null, wrong_tries = 0, wrong_times = '{}'
     where k.id = p_card_id and fv_owns_enrollment(k.enrollment_id);
    if not found then
        raise exception 'card not found' using errcode = 'P0002';
    end if;
    _cached := _student_card_json(p_card_id);
    perform fv_idem_store(p_idempotency_key, 'unlock_student_card', _cached);
    return _cached;
end;
$function$;

create or replace function public.unlock_all_student_cards(p_course_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _n      int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'unlock_all_student_cards');
    if _cached is not null then return _cached; end if;
    update student_card k set locked_at = null, wrong_tries = 0, wrong_times = '{}'
      from enrollment e
     where e.id = k.enrollment_id and e.course_id = p_course_id
       and k.stopped_at is null and k.locked_at is not null;
    get diagnostics _n = row_count;
    _cached := jsonb_build_object('unlocked', _n);
    perform fv_idem_store(p_idempotency_key, 'unlock_all_student_cards', _cached);
    return _cached;
end;
$function$;

create or replace function public.reissue_student_card(p_card_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
    _k      student_card%rowtype;
    _new    uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'reissue_student_card');
    if _cached is not null then return _cached; end if;
    select * into _k from student_card k
     where k.id = p_card_id and fv_owns_enrollment(k.enrollment_id)
       for update;
    if not found then
        raise exception 'card not found' using errcode = 'P0002';
    end if;
    if _k.stopped_at is not null then
        raise exception 'that card was already reissued' using errcode = '22023';
    end if;
    -- The old code stops here, before the new card exists.
    update student_card set stopped_at = now() where id = _k.id;
    -- Two statements: the card must exist before it is read back.
    _new := _issue_student_card(_k.enrollment_id, coalesce(_k.password, ''));
    _cached := _student_card_json(_new);
    perform fv_idem_store(p_idempotency_key, 'reissue_student_card', _cached);
    return _cached;
end;
$function$;

create or replace function public.set_cards_work_until(p_course_id uuid, p_date date, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'set_cards_work_until');
    if _cached is not null then return _cached; end if;
    update course set cards_work_until = p_date, updated_at = now() where id = p_course_id;
    update student_card k set works_until = _cards_work_until(p_course_id)
      from enrollment e
     where e.id = k.enrollment_id and e.course_id = p_course_id and k.stopped_at is null;
    _cached := jsonb_build_object('works_until', _cards_work_until(p_course_id));
    perform fv_idem_store(p_idempotency_key, 'set_cards_work_until', _cached);
    return _cached;
end;
$function$;

revoke all on function public.list_student_cards(uuid) from public, anon;
revoke all on function public.issue_student_cards(uuid, uuid[], uuid) from public, anon;
revoke all on function public.mark_student_cards_printed(uuid[], uuid) from public, anon;
revoke all on function public.unlock_student_card(uuid, uuid) from public, anon;
revoke all on function public.unlock_all_student_cards(uuid, uuid) from public, anon;
revoke all on function public.reissue_student_card(uuid, uuid) from public, anon;
revoke all on function public.set_cards_work_until(uuid, date, uuid) from public, anon;
grant execute on function public.list_student_cards(uuid) to authenticated, service_role;
grant execute on function public.issue_student_cards(uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.mark_student_cards_printed(uuid[], uuid) to authenticated, service_role;
grant execute on function public.unlock_student_card(uuid, uuid) to authenticated, service_role;
grant execute on function public.unlock_all_student_cards(uuid, uuid) to authenticated, service_role;
grant execute on function public.reissue_student_card(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_cards_work_until(uuid, date, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
