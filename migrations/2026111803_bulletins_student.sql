-- Bulletins, the student's side (2026-11-17). APPLIED to gradebook-prod on
-- 2026-11-18 as bulletins_student, after 2026111801_bulletins.sql (M1), and
-- before the student-submit edge function that calls these functions was deployed.
--
-- THIS FILE CHANGES ONE EXISTING THING: the check constraint on
-- student_submit.write_log.kind gains the word 'bulletin' (dropped and added
-- again in this one transaction). Every kind it allows today it still allows.
-- It changes no existing row, no other table, policy or function, and adds
-- no table. student_submit.page, _session_class, _session_classes and
-- _card_refusal are not changed.
--
-- == Why ==
-- Bulletins, slice B1b (docs/plans/bulletins-plan.md; the contract is
-- migrations/local-test/bulletins-contract.md, "For B1b"). A class's one-way
-- feed on the student's page: the teacher posts, the student reads, marks it
-- seen, and may answer Got It, Done or I Have a Question where the teacher
-- turned Reactions on. M1 made the tables and the teacher's functions; this
-- file gives the edge function (service_role) the four it calls for a
-- student.
--
-- == What it adds (all in student_submit, security definer, search_path
--    public, student_submit, pg_temp) ==
-- _bulletin_visible(p_bulletin_id, p_enrollment_id) -> boolean: the one rule
--   for "may this student see this bulletin": it exists, it is posted
--   (posted_at not null: every file finished), and it is in the student's
--   class. Every function below asks it; none repeats its test. No role may
--   call it.
-- _bulletin_session_enrollments(p_session_id) -> uuid[]: the enrolments a
--   device's session holds whose class it may name, in the order they were
--   added. It mirrors the tests of _session_classes exactly (card not
--   stopped, student not withdrawn and not paused, class not in the trash
--   and its Student Page on; an expired card's class is still named, as
--   _session_classes names it), without its to-do counts and names, which
--   the feed does not need. No role may call it.
-- bulletins(p_session_token, p_enrollment_id, p_ip_hash) -> { ok, bulletins,
--   new }: the session's class's visible bulletins, oldest first (one shown
--   again and not yet seen by this student sits at the new end), the newest
--   100 of that order, each with its ready files and this student's own
--   seen_at and reaction; and for each enrolment
--   _bulletin_session_enrollments names (this device's own classes, an
--   expired card's included), that student's count of visible bulletins not
--   yet seen. Read-only.
-- bulletin_seen(p_session_token, p_enrollment_id, p_bulletin_ids,
--   p_ip_hash) -> { ok, seen }: up to 100 ids; each one the student may see
--   is marked seen, the first time kept; any other id is skipped.
-- bulletin_react(p_session_token, p_enrollment_id, p_bulletin_id, p_word,
--   p_ip_hash) -> { ok, reaction }: got_it, done or question sets or
--   replaces the student's reaction; null takes it back. Refused where
--   Reactions is off.
-- bulletin_file_links(p_session_token, p_enrollment_id, p_bulletin_file_id,
--   p_ip_hash) -> { ok, bucket, file_id, bulletin_id, kind, title,
--   page_count, pages: [{ page, path }] }: a ready file of a bulletin the
--   student may see; the edge function signs 60-second links. Read-only.
-- Who runs the four: they are granted to service_role and to no other role;
--   a visitor (anon), a teacher (authenticated) and everyone (public) may
--   run none of them. The student-submit edge function signs in to the
--   database as its owner (docs/ROADMAP.md), which may run every function it
--   owns, grant or not: so the way to stop the four is to drop them (the
--   undo's PART 1), not to revoke a grant. Each begins with
--   _session_class, which refuses a signed-out session, a paused or
--   withdrawn student, a class with its page off or in the trash, and a
--   stopped or expired card, in the middle of a session too. The bulletins
--   read are the session's class's (its course_id); the counts in new also
--   read the bulletins of the device's other classes, and only that
--   device's own enrolments' seen marks. A student is sent only their own
--   class's bulletins and only their own seen and reaction: never a count
--   about other students, never a name, never another student's anything.
--   The two that write share the hourly limit per card: 120 (write_log kind
--   'bulletin'); the 121st is { ok: false, error: 'too_many', retry_after_s }.
--
-- md5 of pg_get_functiondef on PostgreSQL 17 (new functions, as this file
-- leaves them):
--   student_submit._bulletin_visible(uuid,uuid) (new)                     cab9dc514218ac1839b112895e2baa11
--   student_submit._bulletin_session_enrollments(uuid) (new)              dae16e59257af2443d0aeab273a71243
--   student_submit.bulletins(text,uuid,text) (new)                        634789519b2b2fdf18550c92691618e7
--   student_submit.bulletin_seen(text,uuid,uuid[],text) (new)             96185b2e8173c90ccd40f2a054ad5cc7
--   student_submit.bulletin_react(text,uuid,uuid,text,text) (new)         e86e2c4c9454186390ad1fe9a845d8c1
--   student_submit.bulletin_file_links(text,uuid,uuid,text) (new)         5e93daec794c4f5f5b936c385e4905ca
-- Relied on, unchanged (function, live; the last two from M1):
--   student_submit._session_class(text,uuid)                              1ae94981ff32f804d12079a24bd7b41a
--   student_submit._card_refusal(uuid)                                    4b982e451dbd5c9c68916c99d29d2d37
--   student_submit._device_session(text)                                  fa1e510e4ccd3bccbf91e29540a837bb
--   student_submit._session_classes(uuid)                                 92eb84de662304124deb198baa75111e
--   student_submit._write_limit(uuid,text,integer)                        c2edfa96402a2eb7a839db3c106e11a9
--   student_submit._listed(public.assessment,date)                        ee5745a778e8ac1cb56f013d1c3e034e
--   public._fv_timezone(text)                                             8dbcb5716f155e2441f47416a0b28527
--   fv_private.bulletin_file_path(uuid,uuid,integer)                      382dc77b5c162295891790d42fb13763
--   fv_private.bulletin_pinned_now(boolean,date,text)                     3d68484d7051fd8f380fe2a84c401546
-- (_session_classes is not called: _bulletin_session_enrollments mirrors its
-- tests, so a change to it stops this file until the mirror is checked.)
-- Each md5 is taken with public on the search path; the file sets its own.
-- Changed: the constraint student_submit.write_log.write_log_kind_check,
--   from  CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text])))
--   to    CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text])))
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the nine functions it relies on are
-- the definitions it was tested against; its own six are missing or this
-- file's (a second run); no function of those names exists with other
-- arguments or in another schema; write_log_kind_check is exactly the
-- 'from' above (or the 'to', a second run) and is write_log's only check;
-- M1's four tables have the columns and keys these functions read; the role
-- running it owns write_log and _session_class; and the server is PostgreSQL
-- 17. Nothing it compares depends on the database's collation (every text
-- order it aggregates is collate "C"), its time zone or the session's search
-- path (set below). Read-only from gradebook-prod: the query in
-- migrations/local-test/bulletins-student-live-precheck.sql.
--
-- == Rows ==
-- None changes and none is added. The constraint is checked again against
-- write_log's rows as it is added (at most a day of rate-limit counters,
-- each of a kind the new check allows).
--
-- == Locks ==
-- Swapping the constraint takes student_submit.write_log to itself for a
-- moment; students' writes that count against a limit wait behind it. If a
-- long transaction holds the table, the file gives up after five seconds
-- with nothing applied: run it again.
--
-- == Order ==
-- After 2026111801 (it reads M1's tables, fv_private.bulletin_file_path and
-- fv_private.bulletin_pinned_now).
-- Before the edge function with bulletin-routes.ts is deployed. The student
-- page released now calls none of these, so it is unchanged.
--
-- Tested on a throwaway PostgreSQL 17 rebuilt equal to live, with M1 applied:
-- migrations/local-test/bulletins_student.py (README.md, "Bulletins, the
-- student's side"). Undo: migrations/local-test/bulletins-student-undo.sql.
-- After: migrations/local-test/bulletins-student-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';
-- pg_get_functiondef names a type by its schema unless that schema is on the path, so every md5 below
-- is taken with public on it, whatever path the session sending this file has.
set local search_path = public, pg_temp;

-- == 1. The checks, before anything changes ==
do $guard$
declare
    _f    record;
    _md5  text;
    _def  text;
    _miss text;
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    -- Run as the role that owns write_log and the student functions (postgres on Supabase, not a superuser):
    -- swapping the check needs the table's owner, and the new functions must belong to the edge function's role.
    if (select relowner from pg_class where oid = to_regclass('student_submit.write_log')) is distinct from (select oid from pg_roles where rolname = current_user)
       or (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from (select oid from pg_roles where rolname = current_user)
       or not has_schema_privilege('student_submit', 'create') then
        raise exception 'Run this as the owner of student_submit.write_log and student_submit._session_class (% is not). Nothing was changed.', current_user;
    end if;
    for _f in select * from (values
        ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a', null),
        ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37', null),
        ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb', null),
        ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e', null),
        ('student_submit._write_limit(uuid,text,integer)', 'c2edfa96402a2eb7a839db3c106e11a9', null),
        ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e', null),
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', null),
        ('fv_private.bulletin_file_path(uuid,uuid,integer)', '382dc77b5c162295891790d42fb13763', null),
        ('fv_private.bulletin_pinned_now(boolean,date,text)', '3d68484d7051fd8f380fe2a84c401546', null),
        ('student_submit._bulletin_visible(uuid,uuid)', null, 'cab9dc514218ac1839b112895e2baa11'),
        ('student_submit._bulletin_session_enrollments(uuid)', null, 'dae16e59257af2443d0aeab273a71243'),
        ('student_submit.bulletins(text,uuid,text)', null, '634789519b2b2fdf18550c92691618e7'),
        ('student_submit.bulletin_seen(text,uuid,uuid[],text)', null, '96185b2e8173c90ccd40f2a054ad5cc7'),
        ('student_submit.bulletin_react(text,uuid,uuid,text,text)', null, 'e86e2c4c9454186390ad1fe9a845d8c1'),
        ('student_submit.bulletin_file_links(text,uuid,uuid,text)', null, '5e93daec794c4f5f5b936c385e4905ca')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and (_f.now is null or _md5 is distinct from _f.now) then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc
                where proname in ('_bulletin_visible', '_bulletin_session_enrollments', 'bulletins', 'bulletin_seen', 'bulletin_react', 'bulletin_file_links')
                  and oid not in (coalesce(to_regprocedure('student_submit._bulletin_visible(uuid,uuid)'), 0),
                                  coalesce(to_regprocedure('student_submit._bulletin_session_enrollments(uuid)'), 0),
                                  coalesce(to_regprocedure('student_submit.bulletins(text,uuid,text)'), 0),
                                  coalesce(to_regprocedure('student_submit.bulletin_seen(text,uuid,uuid[],text)'), 0),
                                  coalesce(to_regprocedure('student_submit.bulletin_react(text,uuid,uuid,text,text)'), 0),
                                  coalesce(to_regprocedure('student_submit.bulletin_file_links(text,uuid,uuid,text)'), 0))) then
        raise exception 'A function of this file''s names exists with other arguments or in another schema. Nothing was changed.';
    end if;
    -- write_log's kind check: today's, or this file's (a second run), and its only check.
    select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname collate "C", c.oid) into _def
      from pg_constraint c where c.conrelid = to_regclass('student_submit.write_log') and c.contype = 'c';
    if _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text])))'
       and _def is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text])))' then
        raise exception 'student_submit.write_log''s check is not the one this file was written against (%). Nothing was changed.', coalesce(_def, 'none');
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'student_submit.write_log'::regclass
                     and conname = 'write_log_kind_check' and contype = 'c' and convalidated) then
        raise exception 'student_submit.write_log has no validated check named write_log_kind_check. Nothing was changed.';
    end if;
    -- M1's tables, with the columns these functions read.
    select string_agg(t.tab || '.' || t.col, ', ' order by t.tab collate "C", t.col collate "C") into _miss
      from (values ('bulletin', 'id', 'uuid'), ('bulletin', 'course_id', 'uuid'), ('bulletin', 'kind', 'text'),
                   ('bulletin', 'body', 'text'), ('bulletin', 'link_url', 'text'), ('bulletin', 'link_title', 'text'),
                   ('bulletin', 'pinned', 'boolean'), ('bulletin', 'pinned_until', 'date'), ('bulletin', 'assessment_id', 'uuid'),
                   ('bulletin', 'reactions_on', 'boolean'), ('bulletin', 'shown_again_at', 'timestamp with time zone'),
                   ('bulletin', 'posted_at', 'timestamp with time zone'), ('bulletin', 'edited_at', 'timestamp with time zone'),
                   ('bulletin_file', 'id', 'uuid'), ('bulletin_file', 'course_id', 'uuid'), ('bulletin_file', 'bulletin_id', 'uuid'),
                   ('bulletin_file', 'kind', 'text'), ('bulletin_file', 'title', 'text'), ('bulletin_file', 'page_count', 'integer'),
                   ('bulletin_file', 'status', 'text'), ('bulletin_file', 'position', 'integer'),
                   ('bulletin_seen', 'bulletin_id', 'uuid'), ('bulletin_seen', 'enrollment_id', 'uuid'),
                   ('bulletin_seen', 'seen_at', 'timestamp with time zone'),
                   ('bulletin_reaction', 'bulletin_id', 'uuid'), ('bulletin_reaction', 'enrollment_id', 'uuid'),
                   ('bulletin_reaction', 'word', 'text'), ('bulletin_reaction', 'updated_at', 'timestamp with time zone')) t(tab, col, typ)
     where not exists (select 1 from pg_attribute a
                        where a.attrelid = to_regclass('public.' || t.tab) and a.attname = t.col and not a.attisdropped
                          and format_type(a.atttypid, a.atttypmod) = t.typ);
    if _miss is not null then
        raise exception 'M1 (2026111801_bulletins.sql) is not applied as this file expects: % missing or another type. Nothing was changed.', _miss;
    end if;
    -- The two keys bulletin_seen and bulletin_react write on.
    if (select count(*) from pg_constraint c
         where c.contype = 'p' and c.conrelid in (to_regclass('public.bulletin_seen'), to_regclass('public.bulletin_reaction'))
           and (select array_agg(a.attname::text order by a.attname::text collate "C") from pg_attribute a
                 where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['bulletin_id', 'enrollment_id']) <> 2 then
        raise exception 'bulletin_seen or bulletin_reaction lacks its key (bulletin_id, enrollment_id). Nothing was changed.';
    end if;
end
$guard$;

-- == 2. The write limit knows 'bulletin' ==
-- Dropped and added in one statement, inside this transaction: no moment
-- without a check. Only when it is still today's (a second run skips it).
do $kind$
begin
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       = 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text])))' then
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text]));
    end if;
end
$kind$;

-- == 3. The one rule: may this student see this bulletin ==
create or replace function student_submit._bulletin_visible(p_bulletin_id uuid, p_enrollment_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    -- It exists, it is posted (every file finished), and it is in the student's class.
    -- _session_class has already refused a student who may see nothing.
    select exists (select 1 from public.bulletin b
                     join public.enrollment e on e.course_id = b.course_id
                    where b.id = p_bulletin_id and e.id = p_enrollment_id and b.posted_at is not null);
$function$;

revoke all on function student_submit._bulletin_visible(uuid, uuid) from public, anon, authenticated, service_role;

-- The enrolments of a device's session whose class it may name, in the order they were added.
-- MIRRORS student_submit._session_classes (2026110904, as 2026111720 patched it): its joins and its
-- where clause, test for test, and its order. It leaves out what the feed does not need (the to-do
-- counts and the names). A change to _session_classes stops this file (its md5 is in the guard);
-- bulletins_student.py, scenario "mirror", proves both name the same enrolments.
create or replace function student_submit._bulletin_session_enrollments(p_session_id uuid)
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select coalesce(array_agg(e.id order by x.added_at, e.id), '{}')
      from device_session_enrollment x
      join student_card k on k.id = x.card_id
      join enrollment e on e.id = x.enrollment_id
      join student s on s.id = e.student_id
      join course c on c.id = e.course_id
     where x.session_id = p_session_id
       and k.stopped_at is null and e.withdrawn_at is null and c.deleted_at is null and c.student_page_enabled
       and e.page_paused_at is null;
$function$;

revoke all on function student_submit._bulletin_session_enrollments(uuid) from public, anon, authenticated, service_role;

-- == 4. The feed ==
create or replace function student_submit.bulletins(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in     jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _course uuid;
    _tz     text;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    _course := (_in->>'course_id')::uuid;
    select c.timezone, (now() at time zone public._fv_timezone(c.timezone))::date into _tz, _today from public.course c where c.id = _course;
    return jsonb_build_object(
        'ok', true,
        -- Oldest first; one shown again that this student has not seen sorts at its Show It Again time.
        -- The newest 100 of that order.
        'bulletins', coalesce((
            select jsonb_agg(x.item order by x.sort_at, x.id)
              from (select b.id,
                           coalesce(case when b.shown_again_at is not null and s.seen_at is null then b.shown_again_at end,
                                    b.posted_at) as sort_at,
                           jsonb_build_object(
                               'id', b.id, 'kind', b.kind, 'body', b.body,
                               'link_url', b.link_url, 'link_title', b.link_title,
                               -- Pinned as the teacher's list shows it (M1's rule): off once its last day has passed.
                               'pinned', fv_private.bulletin_pinned_now(b.pinned, b.pinned_until, _tz),
                               'pinned_until', b.pinned_until,
                               -- The linked piece only when the student's page lists it (not a draft, assigned).
                               'assessment_id', (select a.id from public.assessment a
                                                  where a.id = b.assessment_id and a.course_id = b.course_id
                                                    and student_submit._listed(a, _today)),
                               'reactions_on', b.reactions_on,
                               'posted_at', b.posted_at, 'edited_at', b.edited_at,
                               'files', coalesce((select jsonb_agg(jsonb_build_object(
                                                         'id', f.id, 'kind', f.kind, 'title', f.title,
                                                         'page_count', f.page_count, 'position', f.position)
                                                         order by f.position, f.id)
                                                    from public.bulletin_file f
                                                   where f.bulletin_id = b.id and f.status = 'ready'), '[]'::jsonb),
                               -- This student's own, and no one else's.
                               'seen_at', s.seen_at,
                               'reaction', r.word) as item
                      from public.bulletin b
                      left join public.bulletin_seen s on s.bulletin_id = b.id and s.enrollment_id = p_enrollment_id
                      left join public.bulletin_reaction r on r.bulletin_id = b.id and r.enrollment_id = p_enrollment_id
                     where b.course_id = _course and student_submit._bulletin_visible(b.id, p_enrollment_id)
                     order by sort_at desc, b.id desc
                     limit 100) x), '[]'::jsonb),
        -- For each class on this device, that student's own count of bulletins not yet seen.
        'new', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', k.enrollment_id,
                       'count', (select count(*) from public.bulletin b
                                   join public.enrollment e on e.id = k.enrollment_id and e.course_id = b.course_id
                                  where student_submit._bulletin_visible(b.id, k.enrollment_id)
                                    and not exists (select 1 from public.bulletin_seen s
                                                     where s.bulletin_id = b.id and s.enrollment_id = k.enrollment_id)))
                       order by k.n)
              from unnest(student_submit._bulletin_session_enrollments((_in->>'session_id')::uuid))
                   with ordinality as k(enrollment_id, n)), '[]'::jsonb));
end;
$function$;

-- == 5. Seen ==
create or replace function student_submit.bulletin_seen(p_session_token text, p_enrollment_id uuid, p_bulletin_ids uuid[], p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _no jsonb;
    _n  int;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    if coalesce(cardinality(p_bulletin_ids), 0) > 100 then
        return jsonb_build_object('ok', false, 'error', 'bad_request');
    end if;
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'bulletin', 120);
    if _no is not null then
        return _no;
    end if;
    -- The first time is kept: a second mark changes nothing. An id the student may not see is skipped.
    insert into public.bulletin_seen (bulletin_id, enrollment_id, seen_at)
    select d.id, p_enrollment_id, clock_timestamp()
      from (select distinct x.id from unnest(coalesce(p_bulletin_ids, '{}')) as x(id) where x.id is not null) d
     where student_submit._bulletin_visible(d.id, p_enrollment_id)
     order by d.id
    on conflict (bulletin_id, enrollment_id) do nothing;
    get diagnostics _n = row_count;
    return jsonb_build_object('ok', true, 'seen', _n);
end;
$function$;

-- == 6. A reaction ==
create or replace function student_submit.bulletin_react(p_session_token text, p_enrollment_id uuid, p_bulletin_id uuid, p_word text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _no jsonb;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    if p_word is not null and p_word not in ('got_it', 'done', 'question') then
        return jsonb_build_object('ok', false, 'error', 'bad_request');
    end if;
    if not student_submit._bulletin_visible(p_bulletin_id, p_enrollment_id) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not (select b.reactions_on from public.bulletin b where b.id = p_bulletin_id) then
        return jsonb_build_object('ok', false, 'error', 'reactions_off');
    end if;
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'bulletin', 120);
    if _no is not null then
        return _no;
    end if;
    if p_word is null then
        delete from public.bulletin_reaction where bulletin_id = p_bulletin_id and enrollment_id = p_enrollment_id;
    else
        insert into public.bulletin_reaction (bulletin_id, enrollment_id, word, updated_at)
        values (p_bulletin_id, p_enrollment_id, p_word, now())
        on conflict (bulletin_id, enrollment_id) do update set word = excluded.word, updated_at = excluded.updated_at;
    end if;
    return jsonb_build_object('ok', true, 'reaction', p_word);
end;
$function$;

-- == 7. A file's pages, for the edge function to sign ==
create or replace function student_submit.bulletin_file_links(p_session_token text, p_enrollment_id uuid, p_bulletin_file_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in jsonb := student_submit._session_class(p_session_token, p_enrollment_id);
    _f  public.bulletin_file%rowtype;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select f.* into _f from public.bulletin_file f
     where f.id = p_bulletin_file_id and f.status = 'ready'
       and student_submit._bulletin_visible(f.bulletin_id, p_enrollment_id);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', 'bulletin-files',
        'file_id', _f.id, 'bulletin_id', _f.bulletin_id, 'kind', _f.kind, 'title', _f.title, 'page_count', _f.page_count,
        'pages', (select jsonb_agg(jsonb_build_object('page', n, 'path', fv_private.bulletin_file_path(_f.course_id, _f.id, n)) order by n)
                    from generate_series(1, _f.page_count) n));
end;
$function$;

revoke all on function student_submit.bulletins(text, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.bulletins(text, uuid, text) to service_role;
revoke all on function student_submit.bulletin_seen(text, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function student_submit.bulletin_seen(text, uuid, uuid[], text) to service_role;
revoke all on function student_submit.bulletin_react(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function student_submit.bulletin_react(text, uuid, uuid, text, text) to service_role;
revoke all on function student_submit.bulletin_file_links(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.bulletin_file_links(text, uuid, uuid, text) to service_role;

-- == 8. What this file leaves is what it was tested as ==
do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('student_submit._bulletin_visible(uuid,uuid)', 'cab9dc514218ac1839b112895e2baa11'),
        ('student_submit._bulletin_session_enrollments(uuid)', 'dae16e59257af2443d0aeab273a71243'),
        ('student_submit.bulletins(text,uuid,text)', '634789519b2b2fdf18550c92691618e7'),
        ('student_submit.bulletin_seen(text,uuid,uuid[],text)', '96185b2e8173c90ccd40f2a054ad5cc7'),
        ('student_submit.bulletin_react(text,uuid,uuid,text,text)', 'e86e2c4c9454186390ad1fe9a845d8c1'),
        ('student_submit.bulletin_file_links(text,uuid,uuid,text)', '5e93daec794c4f5f5b936c385e4905ca')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
    if (select pg_get_constraintdef(oid) || ' ' || convalidated::text from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       is distinct from 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text]))) true' then
        raise exception 'write_log_kind_check did not come out as expected. Nothing was changed.';
    end if;
end
$after$;

commit;
