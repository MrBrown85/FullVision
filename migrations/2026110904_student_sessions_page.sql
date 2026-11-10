-- Student sessions and the student's page (2026-11-09). Student page build
-- plan, S0-M3 (Batch A). docs/plans/student-page-build-plan.md 1.2 ("One
-- reader for students"), 1.5 and 1.8; DECISIONS, "Grades, photos and sign-in
-- on the student page" 13 and "Student page build answers" 7.
--
-- What is needed: a student scans their card, answers "Is This You?", and
-- reads their page for that class: the assignments and, for each, the grade
-- that was returned. Never a draft. The student-submit edge function calls
-- the functions below over its direct database connection, as it calls
-- open, verify, check and submit today. Those four, and every questionnaire
-- and phone-report slip, are untouched.
--
-- Nothing here is reachable through the API: the student_submit schema is
-- not exposed, every function is granted to service_role only, and anon
-- and authenticated get nothing.
--
-- ── Tables (schema student_submit) ──────────────────────────────────────────
--   device_session             a signed-in device. It belongs to the device,
--                              not to a card: token_hash (the phone holds the
--                              token), created_at, expires_at. Done deletes
--                              the row; the next card scan by anyone deletes
--                              every row past its midnight.
--   device_session_enrollment  the classes that session has opened, one row
--                              per card added: session_id, enrollment_id,
--                              card_id.
--   A session ends at the next midnight in the class's time zone
--   (course.timezone; the earliest, if its classes differ) or on Done.
--   attempt.route now also takes 'card'; for those rows attempt.code_id
--   holds the student_card id. The log still has no name, answer or IP, and
--   a card scan removes rows older than 30 days, as a slip's open() does.
--
-- ── Functions (all return jsonb; all take the caller's hashed address) ──────
-- Every failure is { "ok": false, "error": "<code>" }, plus the keys noted.
--
-- card(p_code text, p_ip_hash text)                           route `card`
--   Code in; who it says it is out. Nothing is opened yet.
--   -> { ok, kind: "card", student: { first_name }, course: { name, block },
--        check: "identity" | "password", also_password: bool }
--   or, for a code that is a live questionnaire or report slip's, not a
--   card's: { ok: true, kind: "slip" } and nothing else. The page then sends
--   the code to open(). A slip's code is not an unknown card code, so
--   scanning slips never counts toward the card limit below.
--   check says what "Is This You?" asks for: a birthday or student number,
--   or the card password when the student has neither on file.
--   also_password: a password printed before a birthday or number was added
--   still works, so offer it too.
--   Errors: not_found (no such live card, a reissued card, a withdrawn
--   student, a deleted class), closed (the class's student page is off),
--   card_locked (five wrong tries in a row; the teacher unlocks it),
--   card_expired (past Cards Work Until), reprint (nothing on file to check
--   against), locked (60 unknown codes from one address in 15 minutes).
--   There is no everyone-is-busy stop on the card routes (Colin, Nov 9:
--   per-address only); a slip's open() keeps its own.
--
-- verify_card(p_code text, p_birthday text, p_student_number text,
--             p_password text, p_session_token text, p_ip_hash text,
--             p_add boolean default false)
--                                         routes `verify` (for a card), `add-card`
--   The identity check, as a slip's: the birthday (YYYY-MM-DD), the student
--   number, or the card password; any one that matches what is on file. A
--   match sets the card's wrong tries back to 0.
--   p_add says which screen asked (Colin, Nov 9: "start fresh"):
--     false (route `verify`, the start screen): a new session, always. If
--       p_session_token names a live session, that session is ended first:
--       the last student on a shared device is signed out.
--     true (route `add-card`, Add Another Card): this class joins the live
--       session p_session_token names. With no live session it starts one.
--   A live token alone never joins a session.
--   -> { ok, session_token, expires_at, enrollment_id,
--        classes: [{ enrollment_id, student: { first_name }, course: { name, block } }] }
--   session_token is the new token when a session was started; null only
--   when p_add joined the session sent (keep using that token). The token
--   is 64 hex characters; only its SHA-256 is stored.
--   Errors: the ones card() gives (reprint too: nothing is counted against
--   a card that has nothing on file to check), and wrong_identity with
--   tries_left (4 down to 1). The fifth wrong try locks the card:
--   card_locked. A slip's code here is not_found.
--
-- page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)   route `page`
--   The student's whole page for one class in the session.
--   -> { ok, v: 1, expires_at,
--        student: { enrollment_id, first_name },
--        course: { name, block, grading_system, grading_scale, level_order, round_percent },
--        classes: [ as verify_card ],
--        tags:    { "<tag id>": { label, code } },
--        rubrics: [{ id, name, style, criteria: [{ id, name, weight,
--                    level_1_value .. level_4_value,
--                    level_1_descriptor .. level_4_descriptor,
--                    checks: [{ id, level, label }] }] }],
--        assessments: [{ id, title, date, due_date, score_mode, max_points,
--                        weight, rubric_id, tag_ids: [...],
--                        status, returned_at, updated_at, seen_at,
--                        grade, previous }] }
--   An assessment is listed once its date (assessment.date_assigned) has
--   come; one with no date is listed as soon as it exists (Colin, Nov 9).
--   Undated first, then oldest first. rubrics holds only the ones the
--   listed assessments use; tag_ids only competencies still on the class.
--   status is Missing, Excused or Late (NS, EXC, LATE) as it stands now: a
--   status is never a draft. grade is the returned grade as a copy
--   (migrations/2026110902_grade_return.sql, 3), or null: scores, not a
--   finished grade, because calc.js in the browser works that out.
--   previous is the copy the student had before the newest return, and
--   updated_at when it changed for them; both null unless it did.
--   Nothing says whether a draft exists: a piece with a draft and no
--   earlier return reads exactly as a piece never graded.
--   Errors: signed_out (no such session, past midnight, or Done),
--   not_found (the class is not in this session, or is deleted, or the
--   student was withdrawn), card_stopped (the card that opened it was
--   reissued), card_expired, closed.
--
-- seen(p_session_token text, p_enrollment_id uuid, p_assessment_ids uuid[],
--      p_ip_hash text)                                                route `seen`
--   The student opened these pieces. -> { ok, seen: <how many> }
--   Errors: as page().
--
-- done(p_session_token text, p_ip_hash text)                          route `done`
--   Ends the session: its row is deleted. -> { ok: true }, whatever the
--   token was.
--
-- _returned_grade(p_enrollment_id uuid, p_assessment_id uuid) -> jsonb
--   THE ONLY WAY a student-facing function reads a grade. No other function
--   in this schema may name score, tag_score, rubric_score,
--   rubric_check_score or grade_return's copies
--   (migrations/local-test/student_page.py fails if one does).
--   -> { status, returned_at, updated_at, seen_at, grade, previous }
--   grade and previous hold only the part of the copy the work's scoring
--   uses now (public._grade_copy_in_use, 2026110902 3b): the criteria and
--   ticks of the rubric it has, or its points or mark, or the levels of the
--   competencies it is linked to that are still on the class, or its
--   Overall level; and always the Overall Comment. A level for a competency
--   since removed from the class, or left from a rubric the work no longer
--   uses, is not sent. If that leaves nothing, grade is null and
--   returned_at still says the piece came back.
--   grade is null for a grade never returned, grade_return.returned_copy
--   while a draft sits on a returned grade, and the working copy otherwise.
--   status comes straight from score.status. Missing and Excused win at
--   once (Colin, Nov 9: "Missing wins at once"): while a piece is marked
--   Missing or Excused, grade and previous are null, though returned_copy
--   may still hold an old grade and returned_at still says when it came
--   back. Take the mark off before any Return and the returned grade is
--   sent again. Late hides nothing. The Note for the Report
--   (score.report_note) is never in it.
--
-- `add-card` and `done` belong to slice S3 and `seen` to S4; the session
-- tables make them a few lines each, so they are here and those slices need
-- no migration for them. Opening a questionnaire or a phone report from the
-- card's session (S4-F4) is NOT here.
--
-- Functions this file leaves callable through the API: none. Every function
-- here is for service_role, over the edge function's own connection.
--
-- No existing row changes. The file can be run again. Apply after 2026110902
-- and 2026110903; its first step stops it otherwise.
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
begin
    if to_regclass('public.grade_return') is null or to_regclass('public.student_card') is null
       or to_regclass('student_submit.attempt') is null then
        raise exception 'apply 2026110902_grade_return.sql and 2026110903_student_card.sql first. Nothing was changed.';
    end if;
    perform 'public._grade_copy_in_use(jsonb,uuid)'::regprocedure, 'public._fv_timezone(text)'::regprocedure,
            'student_submit._log(text,text,text,uuid,uuid)'::regprocedure, 'student_submit._norm(text)'::regprocedure;
end
$guard$;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists student_submit.device_session (
    id         uuid        primary key default gen_random_uuid(),
    token_hash text        not null constraint device_session_token_hash_key unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index if not exists device_session_expires on student_submit.device_session (expires_at);

create table if not exists student_submit.device_session_enrollment (
    session_id    uuid        not null references student_submit.device_session(id) on delete cascade,
    enrollment_id uuid        not null references public.enrollment(id) on delete cascade,
    card_id       uuid        not null references public.student_card(id) on delete cascade,
    added_at      timestamptz not null default clock_timestamp(),
    primary key (session_id, enrollment_id)
);
create index if not exists device_session_enrollment_enrollment on student_submit.device_session_enrollment (enrollment_id);
create index if not exists device_session_enrollment_card on student_submit.device_session_enrollment (card_id);

alter table student_submit.device_session enable row level security;
alter table student_submit.device_session_enrollment enable row level security;
revoke all on student_submit.device_session, student_submit.device_session_enrollment from public, anon, authenticated;

alter table student_submit.attempt drop constraint if exists attempt_route_check;
alter table student_submit.attempt add constraint attempt_route_check
    check (route = any (array['open'::text, 'submit'::text, 'card'::text]));

-- ── The one reader ──────────────────────────────────────────────────────────
create or replace function student_submit._returned_grade(p_enrollment_id uuid, p_assessment_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select jsonb_build_object(
               'status', s.status,
               'returned_at', g.returned_at,
               'updated_at', g.updated_at,
               'seen_at', g.seen_at,
               -- Missing and Excused win at once: no result is sent while
               -- either is on the piece, whatever was returned before.
               -- Otherwise only the part the work's scoring uses now, so the
               -- student page never sees a row the teacher's screens hide.
               'grade', case when s.status in ('NS', 'EXC') then null else public._grade_copy_in_use(
                            case when g.returned_at is null then null
                                 when g.is_draft then g.returned_copy
                                 else public._grade_copy(p_enrollment_id, p_assessment_id) end, p_assessment_id) end,
               'previous', case when s.status in ('NS', 'EXC') then null else public._grade_copy_in_use(
                            case when g.returned_at is not null then g.previous_copy end, p_assessment_id) end)
      from (select 1) one
      left join score s on s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id
      left join grade_return g on g.enrollment_id = p_enrollment_id and g.assessment_id = p_assessment_id;
$function$;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- The next midnight where the class is.
create or replace function student_submit._midnight(p_tz text)
 returns timestamptz
 language sql
 stable
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select (((now() at time zone public._fv_timezone(p_tz))::date + 1)::timestamp
            at time zone public._fv_timezone(p_tz));
$function$;

-- The live session a token names, or no row.
create or replace function student_submit._device_session(p_token text)
 returns student_submit.device_session
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select d.* from device_session d
     where coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
       and d.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       and d.expires_at > now();
$function$;

-- The classes a session has opened, as the phone lists them.
create or replace function student_submit._session_classes(p_session_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student', jsonb_build_object('first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name)),
               'course', jsonb_build_object('name', c.name, 'block', c.block)) order by x.added_at, e.id), '[]'::jsonb)
      from device_session_enrollment x
      join student_card k on k.id = x.card_id
      join enrollment e on e.id = x.enrollment_id
      join student s on s.id = e.student_id
      join course c on c.id = e.course_id
     where x.session_id = p_session_id
       and k.stopped_at is null and e.withdrawn_at is null and c.deleted_at is null and c.student_page_enabled;
$function$;

-- Why a card cannot be used right now, or null. The same answer for card,
-- verify_card and page.
create or replace function student_submit._card_refusal(p_card_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select case
               when k.stopped_at is not null then 'card_stopped'
               when c.deleted_at is not null or e.withdrawn_at is not null then 'not_found'
               when not c.student_page_enabled then 'closed'
               when (now() at time zone public._fv_timezone(c.timezone))::date > k.works_until then 'card_expired'
           end
      from student_card k
      join enrollment e on e.id = k.enrollment_id
      join course c on c.id = e.course_id
     where k.id = p_card_id;
$function$;

-- A code to its live card, behind the limits a slip's open() has. Returns
-- { card_id } or { error }.
create or replace function student_submit._card_lookup(p_code text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    _rows int;
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
           and at > now() - interval '15 minutes') >= 60 then
        perform _log('card', 'locked', p_ip_hash);
        return jsonb_build_object('error', 'locked');
    end if;
    if _code !~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$' then
        perform _log('card', 'bad_format', p_ip_hash);
        return jsonb_build_object('error', 'not_found');
    end if;

    -- Live cards only; each has its own salt. A reissued card is not live.
    select count(*) into _rows
      from student_card where stopped_at is null and code_hash = _access_code_hash(_code, salt);
    if _rows = 0 and exists (select 1 from student_access_code
                              where revoked_at is null and expires_at > now()
                                and code_hash = _access_code_hash(_code, salt)) then
        -- A live slip's code, typed or scanned where a card goes. Not a
        -- guess: it is logged as what it is and counts toward no limit.
        perform _log('card', 'slip', p_ip_hash);
        return jsonb_build_object('error', 'not_found', 'kind', 'slip');
    end if;
    if _rows <> 1 then
        perform _log('card', case when _rows = 0 then 'not_found' else 'ambiguous' end, p_ip_hash);
        return jsonb_build_object('error', 'not_found');
    end if;
    select * into _k
      from student_card where stopped_at is null and code_hash = _access_code_hash(_code, salt);

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

-- ── card ────────────────────────────────────────────────────────────────────
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
    if _found->>'kind' = 'slip' then
        return jsonb_build_object('ok', true, 'kind', 'slip');
    end if;
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

-- ── verify_card (also add-card) ─────────────────────────────────────────────
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
        -- Five wrong tries in a row lock it; a right answer starts the count
        -- again, so "tries left" is always true.
        update student_card
           set wrong_tries = wrong_tries + 1,
               locked_at = case when wrong_tries + 1 >= 5 then now() end
         where id = _k.id;
        perform _log('card', 'wrong_identity', p_ip_hash, _k.id, _course.id);
        if _k.wrong_tries + 1 >= 5 then
            return jsonb_build_object('ok', false, 'error', 'card_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', 4 - _k.wrong_tries);
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

-- One class of a session, checked. Returns { card_id, course_id } or { error }.
create or replace function student_submit._session_class(p_session_token text, p_enrollment_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _session device_session%rowtype;
    _card    uuid;
    _why     text;
begin
    select * into _session from _device_session(p_session_token);
    if _session.id is null then
        return jsonb_build_object('error', 'signed_out');
    end if;
    select x.card_id into _card from device_session_enrollment x
     where x.session_id = _session.id and x.enrollment_id = p_enrollment_id;
    if _card is null then
        return jsonb_build_object('error', 'not_found');
    end if;
    _why := _card_refusal(_card);
    if _why is not null then
        return jsonb_build_object('error', _why);
    end if;
    return jsonb_build_object('card_id', _card, 'session_id', _session.id, 'expires_at', _session.expires_at,
                              'course_id', (select e.course_id from enrollment e where e.id = p_enrollment_id));
end;
$function$;

-- ── page ────────────────────────────────────────────────────────────────────
create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
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
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code))
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
                           'rubric_id', a.rubric_id,
                           'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                  from assessment_tag x
                                                  join tag t on t.id = x.tag_id
                                                  join section s on s.id = t.section_id
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb))
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));
end;
$function$;

-- ── seen ────────────────────────────────────────────────────────────────────
create or replace function student_submit.seen(
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
    insert into grade_return (enrollment_id, assessment_id, seen_at)
    select p_enrollment_id, a.id, clock_timestamp()
      from assessment a
     where a.id = any (coalesce(p_assessment_ids, '{}')) and a.course_id = (_in->>'course_id')::uuid
    on conflict (enrollment_id, assessment_id) do update set seen_at = excluded.seen_at;
    get diagnostics _n = row_count;
    return jsonb_build_object('ok', true, 'seen', _n);
end;
$function$;

-- ── done ────────────────────────────────────────────────────────────────────
create or replace function student_submit.done(p_session_token text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
begin
    if coalesce(p_session_token, '') ~ '^[0-9a-f]{64}$' then
        delete from device_session
         where token_hash = encode(sha256(convert_to(p_session_token, 'UTF8')), 'hex');
    end if;
    return jsonb_build_object('ok', true);
end;
$function$;

-- Service role only, as open and submit are.
revoke all on function student_submit._returned_grade(uuid, uuid) from public, anon, authenticated;
revoke all on function student_submit._midnight(text) from public, anon, authenticated;
revoke all on function student_submit._device_session(text) from public, anon, authenticated;
revoke all on function student_submit._session_classes(uuid) from public, anon, authenticated;
revoke all on function student_submit._card_refusal(uuid) from public, anon, authenticated;
revoke all on function student_submit._card_lookup(text, text) from public, anon, authenticated;
revoke all on function student_submit._session_class(text, uuid) from public, anon, authenticated;
revoke all on function student_submit.card(text, text) from public, anon, authenticated;
revoke all on function student_submit.verify_card(text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function student_submit.page(text, uuid, text) from public, anon, authenticated;
revoke all on function student_submit.seen(text, uuid, uuid[], text) from public, anon, authenticated;
revoke all on function student_submit.done(text, text) from public, anon, authenticated;
grant execute on function student_submit.card(text, text) to service_role;
grant execute on function student_submit.verify_card(text, text, text, text, text, text, boolean) to service_role;
grant execute on function student_submit.page(text, uuid, text) to service_role;
grant execute on function student_submit.seen(text, uuid, uuid[], text) to service_role;
grant execute on function student_submit.done(text, text) to service_role;

commit;
