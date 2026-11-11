-- S3-M1, UNDONE. Not a migration: the way back from
-- migrations/2026111003_card_codes_keyed.sql (card codes the database
-- cannot read). It is kept under local-test/ so CI's drift check does not
-- wait for it to be applied. Run it only to take S3-M1 back out. It leaves
-- the database as it was before S3-M1: Batch A, S0-M5 and S0-M4b, with
-- cards whose codes the database can read. Proved by
-- migrations/local-test/card_codes_undo.py.
--
-- Run it in the SQL editor (or psql), whole. One transaction: all of it or
-- none of it.
--
-- ── IT CANNOT BRING A CODE BACK ─────────────────────────────────────────────
-- S3-M1 erased the old cards' codes, and a card made since never had its
-- code in the database. So after this script NO CARD WORKS: every card is
-- left stopped, students are signed out of nothing but can open nothing,
-- and each teacher presses Make Cards and prints again.
--
-- ── To stop cards at once, without this script ──────────────────────────────
-- S3-M1 adds no trigger and touches no save, so there is nothing in the
-- database to switch off. Cards stop the moment either of these is done:
--   the key is unset (supabase secrets unset STUDENT_CARD_KEY): the card
--     routes answer a server error; slips and signed-in pages carry on;
--   a class's Student Page is turned off: its cards answer "closed".
-- Neither loses anything. This script is for taking the change itself out.
--
-- ── BEFORE IT ───────────────────────────────────────────────────────────────
-- Nothing here turns off what calls S3-M1's functions. First:
--   the student-submit edge function is put back to the version from before
--     S3-M1's (it calls card(code, address) and verify_card with the code);
--     the teacher-cards function is left unused or removed;
--   the site is a release from before the card screens changed (it calls
--     issue_student_cards). The release that goes with S3-M1 calls
--     teacher-cards, which would find student_submit.issue_cards gone.
-- Until both are done cards fail with an error either way; slips are not
-- affected by any of it.
--
-- ── What it does ────────────────────────────────────────────────────────────
-- It refuses, with nothing changed, unless the database is exactly as S3-M1
-- leaves it: each of S3-M1's functions by its fingerprint, the old ones
-- absent, student_card with exactly S3-M1's columns, indexes and
-- constraints, and no function it does not know naming student_card or
-- card_key (something built on S3-M1 since would break). Then:
--   1. every live card is stopped, and the last query says how many;
--   2. S3-M1's six functions and its key-id table are dropped;
--   3. student_card is made again as Batch A made it (code, code_hash, salt
--      and password are back; code_hmac, pw_hmac, key_id and seq are gone),
--      with its indexes, its read policy for the class's teacher and the
--      SELECT grant to signed-in teachers. Every card row is kept, stopped,
--      with a stand-in where its code, hash and salt were ("undone:" and
--      the card's id) and no password;
--   4. Batch A's functions are created again from Batch A's own files:
--      _student_card_json, _issue_student_card, issue_student_cards,
--      reissue_student_card, and student_submit's _card_lookup, card and
--      verify_card with their old arguments;
--   5. Batch A's patch to the two functions that draw slip codes is made
--      again (a new slip avoids a live card's code);
--   6. every function it restored is checked against its fingerprint from
--      before S3-M1, and the whole script is undone if one differs.
--
-- ── What is different afterwards from before S3-M1 ──────────────────────────
-- The catalog (every table, column, index, constraint, policy, grant and
-- function) is identical, line for line: card_codes_undo.py compares all of
-- it with catalog.py. The rows are identical except:
--   student_card   every card is stopped (stopped_at); code, code_hash and
--                  salt hold stand-ins and password is empty, on every row;
--                  cards made while S3-M1 was applied are there too, stopped;
--   fv_idempotency the remembered answers S3-M1 deleted (issue_student_cards,
--                  reissue_student_card, unlock_student_card) stay deleted;
--                  the remembered answers of issue_cards stay until the
--                  24-hour cleanup takes them (they hold no code and no tag);
--   and whatever was written while S3-M1 was applied: sessions, the sign-in
--   log, a card's printed and last-opened times.
-- NOT touched: scores, grades, Draft and Returned, slips, classes, students.
--
-- ── What it leaves, and does not do ─────────────────────────────────────────
--   The migration record. supabase_migrations.schema_migrations still lists
--     S3-M1 as applied, so CI's "never applied" check goes on passing though
--     it is no longer in the database, and CI's schema snapshot check fails
--     until docs/schema.generated.sql is regenerated. To make the record
--     true as well, run this separately afterwards (look first with a select
--     of the same row); CI then asks for the file to be applied again or to
--     leave migrations/:
-- record:
--   delete from supabase_migrations.schema_migrations where name = 'card_codes_keyed';
-- end record
--   The key. STUDENT_CARD_KEY stays in the edge functions' settings; nothing
--     reads it once the previous function is back.
--
-- After it, S3-M1 applies again cleanly and gives the same database as the
-- first time (tested). Batch A's own undo (batch-a-undo.sql, PART 2) needs
-- this script first, then S0-M4b's (s0-m4b-undo.sql).
--
-- It cannot be run twice: the second time the database is no longer as
-- S3-M1 leaves it, and it says so and changes nothing.

begin;

-- Give up after five seconds rather than queue behind a long transaction.
-- If it gives up, nothing is changed: run it again.
set local lock_timeout = '5s';

do $guard$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    if to_regclass('public.student_card') is null or to_regclass('student_submit.device_session_enrollment') is null then
        raise exception 'student_card is not there: Batch A is not applied. Nothing was changed.';
    end if;
    -- Nothing else may use the cards or the sessions that point at them
    -- while the table is made again.
    -- (The cards first, then the sessions: the order a card check takes them in.)
    lock table public.student_card, student_submit.device_session_enrollment in access exclusive mode;
    if exists (select 1 from pg_attribute where attrelid = 'public.student_card'::regclass and attname = 'code' and not attisdropped) then
        raise exception 'student_card has its code column: S3-M1 (2026111003_card_codes_keyed.sql) is not applied, or this script has already run. Nothing was changed.';
    end if;

    -- Every function exactly as S3-M1 leaves it; 'absent' means it must not
    -- be there.
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)',   '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)',   '020cb811d2214dd5866cc2cf4ab705eb'),
            ('public._issue_student_card(uuid,text)',              'absent'),
            ('public.issue_student_cards(uuid,uuid[],uuid)',       'absent'),
            ('public.reissue_student_card(uuid,uuid)',             'absent'),
            ('public._student_card_json(uuid)',                    'bba8282f322ad6913ecca134c24d5cfa'),
            ('student_submit._card_lookup(text,text)',             'absent'),
            ('student_submit.card(text,text)',                     'absent'),
            ('student_submit.verify_card(text,text,text,text,text,text,boolean)', 'absent'),
            ('student_submit._as_teacher(uuid)',                   'a478e6e00d91742951036fcec250ae0d'),
            ('student_submit._card_key_seen(text)',                '455da128c868ae4c67f9ef1ee2c0a125'),
            ('student_submit._card_lookup(text,text,text)',        'b35a926e60a39330f8851d368acec7e6'),
            ('student_submit.card(text,text,text)',                '253b34cd5da404aca98806f6d334f277'),
            ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                                                                   'add37c8bb49f28472972920561401580'),
            ('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)',
                                                                   '3662c2827078922670b5347ca37c685e')
        ) as v(fn, s3_m1)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.s3_m1 then
            raise exception '% is not as S3-M1 leaves it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.s3_m1;
        end if;
    end loop;

    -- The table exactly as S3-M1 leaves it: anything a later change put on
    -- it would be lost when the table is made again.
    select concat_ws('; ',
        (select 'columns: ' || string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
          where a.attrelid = 'public.student_card'::regclass and a.attnum > 0 and not a.attisdropped
         having array_agg(a.attname::text order by a.attname::text) <> array['code_hmac', 'created_at', 'enrollment_id', 'id', 'key_id', 'last_opened_at',
                    'locked_at', 'printed_at', 'pw_hmac', 'seq', 'stopped_at', 'works_until', 'wrong_times', 'wrong_tries']),
        (select 'an index S3-M1 did not make: ' || string_agg(c.relname, ', ' order by c.relname) from pg_index i join pg_class c on c.oid = i.indexrelid
          where i.indrelid = 'public.student_card'::regclass
            and c.relname not in ('student_card_pkey', 'student_card_one_live', 'student_card_enrollment_idx', 'student_card_code_hmac_key', 'student_card_enrollment_seq')),
        (select 'a constraint S3-M1 did not make: ' || string_agg(k.conname, ', ' order by k.conname) from pg_constraint k
          where k.conrelid = 'public.student_card'::regclass and k.contype <> 'n'
            and k.conname not in ('student_card_pkey', 'student_card_enrollment_id_fkey', 'student_card_wrong_tries_check', 'student_card_code_hmac_check',
                                  'student_card_pw_hmac_check', 'student_card_key_id_check', 'student_card_seq_check', 'student_card_live_has_tag')),
        (select 'a foreign key to it: ' || string_agg(k.conname || ' on ' || k.conrelid::regclass::text, ', ' order by k.conname) from pg_constraint k
          where k.confrelid = 'public.student_card'::regclass and k.conname <> 'device_session_enrollment_card_id_fkey'),
        (select 'a trigger: ' || string_agg(t.tgname, ', ' order by t.tgname) from pg_trigger t
          where t.tgrelid = 'public.student_card'::regclass and not t.tgisinternal),
        (select 'a policy: ' || string_agg(p.polname, ', ' order by p.polname) from pg_policy p where p.polrelid = 'public.student_card'::regclass),
        (select 'a view or rule: ' || string_agg(distinct r.ev_class::regclass::text, ', ') from pg_depend d join pg_rewrite r on r.oid = d.objid
          where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
            and d.refobjid in ('public.student_card'::regclass, to_regclass('student_submit.card_key'))))
      into _left;
    if nullif(_left, '') is not null then
        raise exception 'student_card is not as S3-M1 leaves it, and making the table again would lose this: %. Nothing was changed.', _left;
    end if;

    -- No function this script does not know names student_card or card_key
    -- (comments left out): one built on S3-M1 since would break.
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
       and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~ '\m(student_card|card_key)\M'
       and p.oid not in (
           select to_regprocedure(x)::oid
             from unnest(array[
                 'public._student_card_json(uuid)', 'public.list_student_cards(uuid)', 'public.mark_student_cards_printed(uuid[],uuid)',
                 'public.unlock_student_card(uuid,uuid)', 'public.unlock_all_student_cards(uuid,uuid)',
                 'public.set_cards_work_until(uuid,date,uuid)', 'student_submit._card_refusal(uuid)',
                 'student_submit._session_classes(uuid)', 'student_submit._card_key_seen(text)',
                 'student_submit._card_lookup(text,text,text)', 'student_submit.card(text,text,text)',
                 'student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                 'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)']) x
            where to_regprocedure(x) is not null);
    if _left is not null then
        raise exception 'a function this script does not know names student_card or card_key: %. It was built on S3-M1 and would break. Nothing was changed.', _left;
    end if;
end
$guard$;

-- ── 1. Every live card stops; S3-M1's functions and key-id table go ─────────
-- No code can be put back, so no card can be left live: after this script a
-- live card would have a stand-in for a code and open for nobody, while
-- showing as a working card in the teacher's list.
update public.student_card set stopped_at = now() where stopped_at is null;

drop function student_submit.issue_cards(uuid, uuid, jsonb, text, uuid);
drop function student_submit.verify_card(text, text, text, text, text, text, text, boolean);
drop function student_submit.card(text, text, text);
drop function student_submit._card_lookup(text, text, text);
drop function student_submit._as_teacher(uuid);
drop function student_submit._card_key_seen(text);
drop table student_submit.card_key;

-- ── 2. The table as Batch A made it ─────────────────────────────────────────
-- The card rows are set aside, the table is dropped and made again by Batch
-- A's own statements (2026110903), and the rows are put back. Made again,
-- not altered, so the table is exactly the one from before: the same
-- columns in the same order, no left-over slots, and no tag left in its
-- file. The scratch table holds nothing secret (no tag is copied into it)
-- and is gone before the transaction ends.
create table public.student_card_s3m1_undo as
    select id, enrollment_id, created_at, printed_at, last_opened_at, wrong_tries, wrong_times, locked_at, stopped_at, works_until
      from public.student_card;
alter table student_submit.device_session_enrollment drop constraint device_session_enrollment_card_id_fkey;
drop table public.student_card;

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

-- Every card comes back stopped, with stand-ins where its code, hash and
-- salt were. A stand-in is longer than any code and no stopped card is ever
-- looked up, so it can never match what a student types.
insert into public.student_card (id, enrollment_id, code, code_hash, salt, created_at, printed_at, last_opened_at,
                                 wrong_tries, wrong_times, locked_at, stopped_at, works_until, password)
select id, enrollment_id, 'undone:' || id::text, 'undone:' || id::text, 'undone', created_at, printed_at, last_opened_at,
       wrong_tries, wrong_times, locked_at, stopped_at, works_until, null
  from public.student_card_s3m1_undo;
drop table public.student_card_s3m1_undo;
alter table student_submit.device_session_enrollment
    add constraint device_session_enrollment_card_id_fkey foreign key (card_id) references public.student_card(id) on delete cascade;

-- ── 3. Batch A's functions, as its files made them ──────────────────────────
-- Copied whole from 2026110903_student_card.sql and
-- 2026110904_student_sessions_page.sql; the last step checks each against
-- its fingerprint from before S3-M1.
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

revoke all on function public._student_card_json(uuid) from public, anon, authenticated;
revoke all on function public._issue_student_card(uuid, text) from public, anon, authenticated;
revoke all on function public.issue_student_cards(uuid, uuid[], uuid) from public, anon;
revoke all on function public.reissue_student_card(uuid, uuid) from public, anon;
grant execute on function public.issue_student_cards(uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.reissue_student_card(uuid, uuid) to authenticated, service_role;

create or replace function student_submit._card_lookup(p_code text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    _k    student_card%rowtype;
    _why  text;
begin
    -- Housekeeping on every scan, each an index range that is nearly always
    -- empty: sessions past their midnight, and log rows past 30 days (a
    -- slip's open() does the same for the log, one scan in fifty).
    delete from device_session where expires_at < now();
    delete from attempt where at < now() - interval '30 days';

    -- A school's students share one address, so the limit is generous and
    -- counts only codes that were not found (a guess).
    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'card' and outcome in ('not_found', 'bad_format', 'ambiguous')
           and at > now() - interval '15 minutes') >= 300 then
        perform _log('card', 'locked', p_ip_hash);
        return jsonb_build_object('error', 'locked');
    end if;
    if _code !~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$' then
        perform _log('card', 'bad_format', p_ip_hash);
        return jsonb_build_object('error', 'not_found');
    end if;

    -- The live card with this code, found through the index on live codes
    -- (one row read, however many cards there are), then checked against
    -- its salted hash. A reissued card is not live.
    select * into _k
      from student_card
     where stopped_at is null and code = substr(_code, 1, 3) || '-' || substr(_code, 4, 3);
    if _k.id is null or _k.code_hash is distinct from _access_code_hash(_code, _k.salt) then
        -- Not a card. A live slip's code, typed or scanned where a card
        -- goes, is not a guess: it is logged as what it is and counts toward
        -- no limit. The answer is the same either way.
        perform _log('card', case when exists (select 1 from student_access_code
                                                 where revoked_at is null and expires_at > now()
                                                   and code_hash = _access_code_hash(_code, salt))
                                  then 'slip' else 'not_found' end, p_ip_hash);
        return jsonb_build_object('error', 'not_found');
    end if;

    _why := _card_refusal(_k.id);
    if _why is not null then
        perform _log('card', _why, p_ip_hash, _k.id,
                     (select e.course_id from enrollment e where e.id = _k.enrollment_id));
        return jsonb_build_object('error', _why);
    end if;
    if _k.locked_at is not null then
        perform _log('card', 'card_locked', p_ip_hash, _k.id,
                     (select e.course_id from enrollment e where e.id = _k.enrollment_id));
        return jsonb_build_object('error', 'card_locked');
    end if;
    return jsonb_build_object('card_id', _k.id);
end;
$function$;

create or replace function student_submit.card(p_code text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _found  jsonb := _card_lookup(p_code, p_ip_hash);
    _card   uuid := (_found->>'card_id')::uuid;
    _course course%rowtype;
    _name   text;
    _by     text;
    _pw     boolean;
begin
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select c.* into _course
      from student_card k join enrollment e on e.id = k.enrollment_id join course c on c.id = e.course_id
     where k.id = _card;
    -- What the student must prove, as a questionnaire slip asks it.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when nullif(btrim(k.password), '') is not null then 'password' end,
           nullif(btrim(k.password), '') is not null
      into _name, _by, _pw
      from student_card k join enrollment e on e.id = k.enrollment_id join student s on s.id = e.student_id
     where k.id = _card;
    if _by is null then
        perform _log('card', 'no_identity', p_ip_hash, _card, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    perform _log('card', 'ok', p_ip_hash, _card, _course.id);
    return jsonb_build_object(
        'ok', true, 'kind', 'card',
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        'also_password', _by = 'identity' and _pw);
end;
$function$;

create or replace function student_submit.verify_card(
    p_code text, p_birthday text, p_student_number text, p_password text, p_session_token text, p_ip_hash text,
    p_add boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _found   jsonb := _card_lookup(p_code, p_ip_hash);
    _card    uuid := (_found->>'card_id')::uuid;
    _k       student_card%rowtype;
    _course  course%rowtype;
    _dob     date;
    _num     text;
    _pw      text;
    _given   date;
    _session device_session%rowtype;
    _token   text;
    _ends    timestamptz;
    _row     int;
    _week    int;
begin
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select * into _k from student_card where id = _card for update;
    if _k.locked_at is not null or _k.stopped_at is not null then
        -- Locked or reissued while this call waited for the row.
        return jsonb_build_object('ok', false, 'error', case when _k.stopped_at is not null then 'not_found' else 'card_locked' end);
    end if;
    select c.* into _course from enrollment e join course c on c.id = e.course_id where e.id = _k.enrollment_id;

    -- The card's own password: one printed on this card still works after a
    -- birthday or number is added, whatever is printed for the student later.
    select s.date_of_birth, nullif(_norm(s.student_number), ''), nullif(_norm(_k.password), '')
      into _dob, _num, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _k.enrollment_id;
    if _dob is null and _num is null and _pw is null then
        -- Nothing on file to check against: no try is counted. card() says the same.
        perform _log('card', 'no_identity', p_ip_hash, _k.id, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;

    if not coalesce((_dob is not null and _given is not null and _given = _dob)
                 or (_num is not null and _norm(p_student_number) = _num)
                 or (_pw is not null and _norm(p_password) = _pw), false) then
        -- Five wrong tries in a row lock it (a right answer starts that
        -- count again), and so do fifteen inside 7 days whatever came
        -- between. "Tries left" is the nearer of the two, so it is always true.
        update student_card
           set wrong_tries = wrong_tries + 1,
               wrong_times = array(select t from unnest(wrong_times) t where t > clock_timestamp() - interval '7 days')
                             || clock_timestamp()
         where id = _k.id
        returning wrong_tries, cardinality(wrong_times) into _row, _week;
        perform _log('card', 'wrong_identity', p_ip_hash, _k.id, _course.id);
        if _row >= 5 or _week >= 15 then
            update student_card set locked_at = now() where id = _k.id;
            return jsonb_build_object('ok', false, 'error', 'card_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', least(5 - _row, 15 - _week));
    end if;

    -- Matched. From the start screen that is a fresh session: whoever was
    -- signed in on this device is signed out. Only Add Another Card (p_add)
    -- joins the session the device has.
    _ends := _midnight(_course.timezone);
    select * into _session from _device_session(p_session_token);
    if _session.id is not null and not coalesce(p_add, false) then
        delete from device_session where id = _session.id;
        _session := null;
    end if;
    if _session.id is null then
        _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
        insert into device_session (token_hash, expires_at)
        values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _ends)
        returning * into _session;
    elsif _ends < _session.expires_at then
        update device_session set expires_at = _ends where id = _session.id returning * into _session;
    end if;
    insert into device_session_enrollment (session_id, enrollment_id, card_id)
    values (_session.id, _k.enrollment_id, _k.id)
    on conflict (session_id, enrollment_id) do update set card_id = excluded.card_id;
    update student_card set last_opened_at = now(), wrong_tries = 0 where id = _k.id;

    perform _log('card', 'verified', p_ip_hash, _k.id, _course.id);
    return jsonb_build_object(
        'ok', true, 'session_token', _token, 'expires_at', _session.expires_at,
        'enrollment_id', _k.enrollment_id, 'classes', _session_classes(_session.id));
end;
$function$;

revoke all on function student_submit._card_lookup(text, text) from public, anon, authenticated;
revoke all on function student_submit.card(text, text) from public, anon, authenticated;
revoke all on function student_submit.verify_card(text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function student_submit.card(text, text) to service_role;
grant execute on function student_submit.verify_card(text, text, text, text, text, text, boolean) to service_role;

-- ── 4. A new slip avoids live card codes again ──────────────────────────────
-- Batch A's own patch to the two functions that draw slip codes
-- (2026110903), made again.
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

-- ── 5. Everything is as it was before S3-M1 ─────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)',   '42c79553ae6e6900e0e37832ba935405'),
            ('public._issue_report_code(uuid,uuid,timestamptz)',   '3b565e62a12f2a94c90cc59478696e83'),
            ('public._issue_student_card(uuid,text)',              'ceba59edd2d1cfa8e7f9d7d00fb28a2b'),
            ('public.issue_student_cards(uuid,uuid[],uuid)',       'c232b59d73face32b8cc49dcbc5c6048'),
            ('public.reissue_student_card(uuid,uuid)',             '4633758e69cddd816214f165b62fb550'),
            ('public._student_card_json(uuid)',                    '1daf8f4df98a9fc57fa71a161b490e21'),
            ('student_submit._card_lookup(text,text)',             '5ff7456a4b6f33a9cb444f78b1f3f19b'),
            ('student_submit.card(text,text)',                     '54c166d2ca9b032712bbec0f1f9923c5'),
            ('student_submit.verify_card(text,text,text,text,text,text,boolean)',
                                                                   '57a97ea23e11f6768e32f371242ddfb4'),
            ('student_submit._as_teacher(uuid)',                   'absent'),
            ('student_submit._card_key_seen(text)',                'absent'),
            ('student_submit._card_lookup(text,text,text)',        'absent'),
            ('student_submit.card(text,text,text)',                'absent'),
            ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)', 'absent'),
            ('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)', 'absent')
        ) as v(fn, before)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before then
            raise exception '% is not what it was before S3-M1 (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    if exists (select 1 from public.student_card where stopped_at is null) then
        raise exception 'a card was left live. Nothing was changed.';
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

-- What it did: how many cards there are (all stopped now), and how many of
-- them were live until this script stopped them.
select count(*) as cards, count(*) filter (where stopped_at = now()) as stopped_by_this_script
  from public.student_card;

commit;
