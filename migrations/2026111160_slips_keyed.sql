-- Slips move to the card key (2026-11-11). Student page build plan S3-S1
-- ("E7"); DECISIONS, "Card codes the database cannot read" 2: questionnaire
-- and phone-report slips get the fix cards got in
-- 2026111003_card_codes_keyed.sql, in their own change.
--
-- Applies after Batch E (2026111150_student_page_last_changes.sql).
--
-- THIS FILE DELETES DATA (project rule 2). It clears student.slip_password
-- for every student no live printed slip still needs, it drops the two
-- teacher RPCs that printed slips (issue_access_codes, issue_report_codes)
-- and their helpers, and from now on a slip's salted hash is erased the
-- first time the slip is scanned. It deletes no slip row, answer, report,
-- grade or score. No slip stops working on the apply.
--
-- What changes, for a teacher and a student:
--
--   1. A new slip's code is never in the database. teacher-cards (the edge
--      function that makes cards) now makes slips too: it draws each
--      six-character code, and a four-digit password for a student with no
--      birthday or student number, makes their tags with STUDENT_CARD_KEY
--      (supabase/functions/_shared/card-key.ts: "fv.slip.code.v1" and
--      "fv.slip.pass.v1"), and hands only the tags to
--      student_submit.issue_slips. The codes and passwords go back to the
--      teacher's browser once, to print. A slip's password is its own,
--      bound to its code; a reprint for a student with no birthday or
--      number prints a NEW password, since the database cannot read the old
--      one.
--   2. A slip printed before this file still opens, and the first scan
--      converts it: student-submit tags the code, student_submit.open finds
--      no tag, asks once for the plain code, finds the row by its old
--      salted hash, and stores the tag in place of the hash and salt. From
--      then on that slip opens by its tag. Its printed password is checked
--      against student.slip_password one last time, and its tag is stored
--      on the slip (verify), so the next check compares tags.
--   3. student.slip_password is cleared once no live printed slip of the
--      student's still needs it (a trigger on the slip, and once on the
--      apply).
--   4. Stragglers: a slip printed before this file and never scanned by the
--      end of June 30, 2027 (the last day of this school year, Vancouver
--      time) stops opening, and no stored password is checked after it
--      (student_submit._slip_old_until). Nothing has to run on that day for
--      this to hold. To erase the leftovers after it, one statement, by
--      hand or as a nightly job (read-only until then: it changes nothing
--      before the date):
--        update public.student_access_code set code_hash = null, salt = null,
--               revoked_at = coalesce(revoked_at, now())
--         where code_hash is not null and now() >= student_submit._slip_old_until();
--        update public.student set slip_password = null
--         where slip_password is not null and now() >= student_submit._slip_old_until();
--      Dropping the two columns and _access_code_hash is a later migration
--      that also takes the fallback out of student_submit.open.
--
-- Where the database still sees a plain code or password, and only there:
--   - open's fallback, for a slip printed before this file and not yet
--     converted: the edge sends the plain code only on a second call, after
--     the database said no slip has the tag and an unconverted one may
--     still be live. It is compared with the old salted hashes, never
--     stored and never logged.
--   - verify's fallback, for a slip whose password has no tag yet: the edge
--     sends the typed password only on a second call, after the database
--     said the tags did not match and the plain password is still on file.
--     A phone page cached from before this change sends no code, so it
--     cannot make tags and sends the password as today.
--   A wrong code or password is counted once: the first call of the pair
--   counts and logs nothing when it asks for the second.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless Batch E is applied and every
-- function it relies on or drops is the definition it was tested against
-- (md5 of pg_get_functiondef on PostgreSQL 17; the lists below, written by
-- migrations/local-test/slips_keyed.py fingerprints), or, on a second run,
-- as this file leaves it; and none of its new names is taken by something
-- else.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- The new columns, constraint and indexes take student_access_code's lock
-- for a moment (a few hundred rows; nothing is rewritten). If a long
-- transaction holds it, the file gives up after five seconds with nothing
-- applied: run it again.
--
-- ── The deploy order ────────────────────────────────────────────────────────
-- STUDENT_CARD_KEY is already set on both functions. Deploy student-submit
-- and teacher-cards first: until this file is applied, student-submit sees
-- the new open and verify missing and calls the old ones, so slips keep
-- working; teacher-cards' slip route answers a server error. Then this
-- file. Then the release (shared/data.js prints slips through
-- teacher-cards).
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/slips-keyed-live-precheck.sql   expected: no rows.
-- migrations/local-test/slips-keyed-live-postcheck.sql  expected: no rows.
-- After this file, Batch E's post-check lists student_submit.open and
-- verify as missing (this file replaces them with new signatures):
-- expected, not a fault.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/slips-keyed-undo.sql (proved by slips_keyed.py undo)
-- puts the dropped functions back word for word and drops what this file
-- made. It keeps the new columns and their tags, so applying this file
-- again brings every converted and new slip back; while it is undone, a
-- slip printed or converted since the apply does not open (reprint it),
-- and a cleared slip password does not come back (the next print makes a
-- new one).
--
-- One transaction: all or nothing. Every check that can stop it runs first.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
    _n   int;
begin
    if to_regprocedure('student_submit.answer(text,uuid,uuid,jsonb,text)') is null then
        raise exception 'Batch E (2026111150_student_page_last_changes.sql) is not applied: apply it first. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/slips_keyed.py)
            ('student_submit._log(text,text,text,uuid,uuid)',     '6737ebb0cb553bf22434d703d666f178'),
            ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389'),
            ('student_submit._preview(uuid)',                     '336c6ed6f0b914a04ca678fa24137333'),
            ('student_submit._payload(uuid)',                     '7382a387265a87a32c6e4f22f0b1a898'),
            ('student_submit._norm(text)',                        '276ee00aa8e488d789af9e2016714c94'),
            ('student_submit._as_teacher(uuid)',                  'a478e6e00d91742951036fcec250ae0d'),
            ('public._access_code_hash(text,text)',               '6795d47c7db1537c7409409c354282a8'),
            ('public.fv_owns_course(uuid)',                       'e3afeca06043a6e907e6f4ae777c85da'),
            ('public.fv_owns_enrollment(uuid)',                   '728526648388367393162be706f7f9ea'),
            ('public.fv_idem_check(uuid,text)',                   '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)',             '6d0b48c458d273a332db39e1a4b68626'),
            ('student_submit."check"(text,text,text)',            'cc54e80ca585024c65926cb5e73f3f43'),
            ('student_submit.submit(text,jsonb,text)',            '90ace3c164dab19f6a77ba7dfb19e40e'),
            ('student_submit.answer(text,uuid,uuid,jsonb,text)',  'd625cba1843c7b409a5cb8743c7471fd'),
            ('student_submit._card_listed(uuid,uuid)',            'a0dc2d9e540be764da89a98e83751260'),
            ('student_submit.forms(text,uuid,text)',              '40ae918432795a5effbdd4cf6efead15'),
            ('student_submit.report(text,uuid,uuid,text)',        'd009be8b73801173f816d9a5db036b42')
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
            -- FINGERPRINTS-BEGIN drops (written by migrations/local-test/slips_keyed.py)
            ('student_submit.open(text,text)',                                'd11b2e67cbf10cae4d44ae6082fd8e01'),
            ('student_submit.verify(text,text,text,text,text)',               '901e62bdb5d94a9ffcebe33563425ad7'),
            ('public.issue_access_codes(uuid,uuid[],uuid)',                   'c96c672abd7d81b00b59c8819c580c78'),
            ('public.issue_report_codes(uuid,uuid[],uuid)',                   'cdda4154e26cd4c2f9b1dd4648de959c'),
            ('public._issue_access_code(uuid,uuid,timestamp with time zone)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamp with time zone)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('public._new_access_code()',                                     '59989059b38fc77419052a42206c3aaa'),
            ('public._slip_password(uuid)',                                   'fc16d2f952f0a9f05ab49d7a1c16a5ea')
            -- FINGERPRINTS-END
        ) as v(fn, before)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> 'absent' then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/slips_keyed.py)
            ('student_submit._slip_old_until()',                           '568527d9c8d239655dd55ab7c52009da'),
            ('public._slip_password_settle(uuid)',                         '9df7e6113498810271631c5a410b1554'),
            ('public._slip_password_on_change()',                          'e6f31871e265ff7c6eb480e60d22c149'),
            ('student_submit.open(text,text,text,text)',                   '1b0862066e6d8c546f3944f12248be26'),
            ('student_submit.verify(text,text,text,text,text,text,text)',  'b6b51a888f68aa5b54ffdf866756ee47'),
            ('student_submit.slip_roster(uuid,text,uuid)',                 '33954320e0812e4c22e5936bb2ee76a9'),
            ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists, and is not as this file leaves it (found %): something else made it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    select count(*) into _n from pg_attribute
     where attrelid = 'public.student_access_code'::regclass and not attisdropped
       and attname in ('code_hmac', 'pw_hmac', 'key_id', 'converted_at');
    if _n not in (0, 4) then
        raise exception 'student_access_code has % of code_hmac, pw_hmac, key_id and converted_at, not all four: something else made them. Nothing was changed.', _n;
    end if;
end
$guard$;

-- ── The slip's columns ──────────────────────────────────────────────────────
alter table public.student_access_code add column if not exists code_hmac text;
alter table public.student_access_code add column if not exists pw_hmac text;
alter table public.student_access_code add column if not exists key_id text;
alter table public.student_access_code add column if not exists converted_at timestamptz;
-- A slip made from now on has no hash and no salt; a converted one loses them.
alter table public.student_access_code alter column code_hash drop not null;
alter table public.student_access_code alter column salt drop not null;
alter table public.student_access_code drop constraint if exists student_access_code_keyed;
alter table public.student_access_code add constraint student_access_code_keyed check (
        (code_hmac is null or code_hmac ~ '^[0-9a-f]{64}$')
    and (pw_hmac is null or pw_hmac ~ '^[0-9a-f]{64}$')
    and (key_id is null or key_id ~ '^[0-9a-f]{8}$')
    -- never a tag and a hash at once: converting erases the hash
    and (code_hash is null or code_hmac is null)
    and ((code_hash is null) = (salt is null))
    and (code_hmac is null or key_id is not null)
    and (pw_hmac is null or code_hmac is not null)
    and (converted_at is null or code_hmac is not null));
-- One row per tag, live or not: a slip's tag is never reused. Also the index open looks up by.
create unique index if not exists student_access_code_code_hmac
    on public.student_access_code (code_hmac) where code_hmac is not null;
-- The slips still waiting to be converted: open asks for the plain code only while one is live.
create index if not exists student_access_code_unconverted
    on public.student_access_code (expires_at) where code_hash is not null and revoked_at is null;
comment on column public.student_access_code.code_hmac is
    'S3-S1: HMAC-SHA-256 of "fv.slip.code.v1\n" + the six characters, made by an edge function with STUDENT_CARD_KEY. The database never has the key or the code.';
comment on column public.student_access_code.pw_hmac is
    'S3-S1: the slip''s password as a tag, "fv.slip.pass.v1\n" + code + "\n" + digits. Set for a new slip of a student with no birthday or number, or on the first match of a printed slip''s password.';
comment on column public.student_access_code.key_id is
    'S3-S1: the first 8 hex characters of the HMAC of "fv.card.keyid.v1" with the key: which key made the tags.';
comment on column public.student_access_code.converted_at is
    'S3-S1: when a slip printed before 2026111160 was first scanned and its salted hash replaced by its tag. Null for a slip made since (it never had a hash) and for one not yet scanned.';

-- ── Functions ───────────────────────────────────────────────────────────────

-- The end of the old slips: midnight at the start of July 1, 2027 in
-- Vancouver (PDT, UTC-7), the end of June 30, the last day of the 2026-27
-- school year. From then on no slip opens by its old salted hash and no
-- student's stored password is checked. A constant, so nothing has to run
-- on the day.
create or replace function student_submit._slip_old_until()
 returns timestamp with time zone
 language sql
 immutable
 set search_path to ''
as $function$ select timestamptz '2027-07-01 07:00:00+00' $function$;

-- Clears a student's stored slip password once no live slip printed with it
-- can still be checked against it: a questionnaire slip made before this
-- file (it has a hash, or was converted), with no password tag of its own,
-- not used, not taken back, not past its date, for an enrollment not
-- withdrawn, before the end of the old slips. A slip made since never uses
-- the stored password. The rule of 20261103_slip_password_kept_for_live_slips
-- ("kept for live slips"), for the slips that still read it.
create or replace function public._slip_password_settle(p_student_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    update student s set slip_password = null
     where s.id = p_student_id
       and s.slip_password is not null
       and not exists (
           select 1 from student_access_code c join enrollment e on e.id = c.enrollment_id
            where e.student_id = s.id and e.withdrawn_at is null
              and c.questionnaire_id is not null
              and c.pw_hmac is null
              and (c.code_hash is not null or c.converted_at is not null)
              and c.used_at is null and c.revoked_at is null
              and c.expires_at > now()
              and now() < student_submit._slip_old_until());
$function$;

-- After a questionnaire slip is used, taken back or given its password's
-- tag: its student's stored password may no longer be needed.
create or replace function public._slip_password_on_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    perform _slip_password_settle(e.student_id) from enrollment e where e.id = new.enrollment_id;
    return null;
end;
$function$;

create or replace trigger student_access_code_slip_password
    after update of used_at, revoked_at, pw_hmac on public.student_access_code
    for each row when (new.questionnaire_id is not null)
    execute function public._slip_password_on_change();

-- A slip scanned. p_code_hmac is the tag of the six characters the phone
-- sent, tidied (null when they are not six characters of the slip
-- alphabet); p_key_id the key's id; p_code is null on the first call. The
-- reply is the one the slip's open always gave, but for `fallback`, which
-- only the edge function reads.
create or replace function student_submit.open(p_code_hmac text, p_key_id text, p_code text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _until  constant timestamptz := _slip_old_until();
    _code   text;
    _ids    uuid[];
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _course course%rowtype;
    _name   text;
    _why    text;
    _token  text;
    _exp    timestamptz := now() + interval '80 minutes';
    _r      phone_report%rowtype;
    _dob    date;
    _by     text;
    _pw     boolean;
begin
    -- A tag is 64 lower-case hex characters, and a key id 8. Anything else is
    -- a bug in the caller, not a student's guess: fail, and log nothing.
    if p_code_hmac is not null and p_code_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed code tag' using errcode = '22023';
    end if;
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;

    if random() < 0.02 then
        delete from attempt where at < now() - interval '30 days';
        delete from session where expires_at < now() - interval '1 day';
    end if;

    -- A school's students share one address, so the limit is generous and
    -- counts only codes that weren't found (a guess), not closed forms,
    -- used slips or wrong birthdays.
    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'open' and outcome in ('not_found', 'bad_format', 'ambiguous')
           and at > now() - interval '15 minutes') >= 300 then
        perform _log('open', 'locked', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if (select count(*) from attempt
         where route = 'open' and outcome in ('not_found', 'bad_format')
           and at > now() - interval '10 minutes') >= 500 then
        perform _log('open', 'busy', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'busy');
    end if;

    -- Not six characters of the slip alphabet: the edge sends no tag.
    if p_code_hmac is null then
        perform _log('open', 'bad_format', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- 1. By its tag: a slip made since this file, or one already converted.
    --    Live (or used) slips only, through the unique index on tags.
    select * into _c from student_access_code
     where code_hmac = p_code_hmac and revoked_at is null and expires_at > now()
       for update;

    -- 2. A slip printed before this file and not yet converted. THE PLAIN
    --    CODE IS USED HERE AND NOWHERE ELSE, and only against rows that still
    --    have a salted hash (code_hash is not null): it is never compared
    --    with a converted or a new slip, never stored and never logged.
    if _c.id is null then
        if now() >= _until
           or not exists (select 1 from student_access_code
                           where code_hash is not null and revoked_at is null and expires_at > now()) then
            -- No unconverted slip can be live: a miss is a miss.
            perform _log('open', 'not_found', p_ip_hash);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if p_code is null then
            -- Ask the edge for the plain code. Nothing is counted or logged:
            -- the second call counts this code, once.
            return jsonb_build_object('ok', false, 'error', 'not_found', 'fallback', true);
        end if;
        _code := _norm(p_code);
        if _code !~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$' then
            perform _log('open', 'bad_format', p_ip_hash);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        -- Each old slip has its own salt, so each is hashed with the code.
        select array_agg(m.id) into _ids from (
            select x.id from student_access_code x
             where x.code_hash is not null and x.revoked_at is null and x.expires_at > now()
               and x.code_hash = _access_code_hash(_code, x.salt)
               for update) m;
        if coalesce(cardinality(_ids), 0) = 0 then
            -- Another scan of the same slip may have converted it just now
            -- (the row it locked no longer has a hash): by its tag, again.
            select * into _c from student_access_code
             where code_hmac = p_code_hmac and revoked_at is null and expires_at > now()
               for update;
            if _c.id is null then
                perform _log('open', 'not_found', p_ip_hash);
                return jsonb_build_object('ok', false, 'error', 'not_found');
            end if;
        elsif cardinality(_ids) > 1 then
            perform _log('open', 'ambiguous', p_ip_hash);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        else
            -- Converted on the spot: the tag in place of the hash and salt.
            begin
                update student_access_code
                   set code_hmac = p_code_hmac, key_id = p_key_id, converted_at = now(), code_hash = null, salt = null
                 where id = _ids[1];
            exception when unique_violation then
                -- That tag is already a slip's (taken back, or past its
                -- date): this one keeps its hash and opens as before.
                null;
            end;
            select * into _c from student_access_code where id = _ids[1];
        end if;
    end if;

    -- From here, as the slip's open always was, but for which password counts.

    -- A phone report's code opens to the birthday check, not the report:
    -- check() hands the report over once the birthday matches. It works
    -- until the report's last day or until the teacher closes it, as often
    -- as the student likes.
    if _c.phone_report_id is not null then
        select * into _r from phone_report where id = _c.phone_report_id;
        select * into _course from course where id = _r.course_id;
        if _course.deleted_at is not null
           or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
            perform _log('open', 'not_found', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'not_found');
        end if;
        if _r.closed_at is not null
           or (now() at time zone coalesce(nullif(_course.timezone, ''), 'America/Vancouver'))::date > _r.expires_on then
            perform _log('open', 'closed', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'report_closed');
        end if;
        if (select count(*) from session where code_id = _c.id) >= 200 then
            perform _log('open', 'too_many_opens', p_ip_hash, _c.id, _r.course_id);
            return jsonb_build_object('ok', false, 'error', 'locked');
        end if;
        _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
        insert into session (token_hash, code_id, expires_at)
        values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);
        select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name), s.date_of_birth into _name, _dob
          from enrollment e join student s on s.id = e.student_id
         where e.id = _c.enrollment_id;
        perform _log('open', 'ok', p_ip_hash, _c.id, _r.course_id);
        return jsonb_build_object(
            'ok', true, 'kind', 'report', 'token', _token, 'expires_at', _exp,
            'student', jsonb_build_object('first_name', _name),
            'course', jsonb_build_object('name', _course.name, 'block', _course.block),
            'report', jsonb_build_object('title', coalesce(_r.term_label, 'Report ' || _r.term), 'expires_on', _r.expires_on),
            'has_birthday', _dob is not null);
    end if;
    if _c.questionnaire_id is null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.used_at is not null then
        perform _log('open', 'used', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'used');
    end if;
    if _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('open', 'not_found', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null then
        perform _log('open', _why, p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', _why, 'opens_on', _q.opens_on);
    end if;
    if (select count(*) from session where code_id = _c.id) >= 20 then
        perform _log('open', 'too_many_opens', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'locked');
    end if;

    -- Who the student must prove they are: their birthday or student number
    -- when the teacher entered one, else the password printed on the slip:
    -- the slip's own (its tag), or, for a slip printed before this file and
    -- until the end of the old slips, the one stored with the student. A
    -- slip with neither has nothing to check against: they need a new slip.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when _c.pw_hmac is not null
                     or (now() < _until and nullif(btrim(s.slip_password), '') is not null) then 'password' end,
           _c.pw_hmac is not null or (now() < _until and nullif(btrim(s.slip_password), '') is not null)
      into _name, _by, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    if _by is null then
        perform _log('open', 'no_identity', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;

    _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
    insert into session (token_hash, code_id, expires_at)
    values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _c.id, _exp);

    -- The questions wait for verify(); the slip alone shows only the first
    -- name and what the questions are called.
    perform _log('open', 'ok', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object(
        'ok', true, 'kind', 'questionnaire', 'token', _token, 'expires_at', _exp,
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        -- A password printed before the teacher added a birthday or number
        -- still works, so the phone offers it beside them.
        'also_password', _by = 'identity' and _pw,
        'preview', student_submit._preview(_c.id));
end;
$function$;

-- Is this you? for a questionnaire slip. p_code_hmac is the tag of the code
-- the phone opened the slip with, p_pw_hmac the tag of the password typed,
-- bound to that code (both null from a page that sends no code).
-- p_password is the typed password itself, sent only on the edge's second
-- call or from such a page: it is compared only with student.slip_password,
-- the password a slip printed before this file carries, and only until the
-- end of the old slips. It is never stored and never logged.
create or replace function student_submit.verify(p_token text, p_birthday text, p_student_number text, p_password text,
                                                 p_code_hmac text, p_pw_hmac text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _s      session%rowtype;
    _c      student_access_code%rowtype;
    _q      questionnaire%rowtype;
    _course course%rowtype;
    _why    text;
    _dob    date;
    _num    text;
    _pw     text;
    _plain  boolean;
    _given  date;
    _match  boolean := false;
    _by_pw  boolean := false;
    _misses int;
begin
    if (p_code_hmac is not null and p_code_hmac !~ '^[0-9a-f]{64}$')
       or (p_pw_hmac is not null and p_pw_hmac !~ '^[0-9a-f]{64}$') then
        raise exception 'malformed tag' using errcode = '22023';
    end if;
    if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _s from session
     where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       for update;
    if not found or _s.expires_at < now() then
        perform _log('open', 'bad_token', p_ip_hash);
        return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    select * into _c from student_access_code where id = _s.code_id for update;
    if _c.questionnaire_id is null or _c.revoked_at is not null then
        perform _log('open', 'not_found', p_ip_hash, _c.id);
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into _q from questionnaire where id = _c.questionnaire_id;
    select * into _course from course where id = _q.course_id;
    if _c.used_at is not null then
        perform _log('open', 'used', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'used');
    end if;
    _why := _closed_reason(_q, _course.timezone);
    if _why is not null or _course.deleted_at is not null
       or exists (select 1 from enrollment e where e.id = _c.enrollment_id and e.withdrawn_at is not null) then
        perform _log('open', coalesce(_why, 'closed'), p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', coalesce(_why, 'closed'), 'opens_on', _q.opens_on);
    end if;

    -- Matched already (a second tap, or the page reloaded): the questions again.
    if _s.checked_at is not null then
        return jsonb_build_object('ok', true) || _payload(_c.id);
    end if;

    -- Five wrong tries on a slip, across every time it was scanned, and the
    -- slip stops working: one count, so "tries left" is always true.
    select count(*) into _misses from attempt where code_id = _c.id and outcome = 'wrong_identity';
    if _misses >= 5 then
        perform _log('open', 'locked', p_ip_hash, _c.id, _q.course_id);
        return jsonb_build_object('ok', false, 'error', 'slip_locked');
    end if;

    select s.date_of_birth, nullif(_norm(s.student_number), ''), nullif(_norm(s.slip_password), '')
      into _dob, _num, _pw
      from enrollment e join student s on s.id = e.student_id
     where e.id = _c.enrollment_id;
    -- The stored password counts only until the end of the old slips.
    _plain := _pw is not null and now() < _slip_old_until();

    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;
    _by_pw := _plain and p_password is not null and _norm(p_password) = _pw;
    _match := (_dob is not null and _given is not null and _given = _dob)
           or (_num is not null and _norm(p_student_number) = _num)
           or (_c.pw_hmac is not null and p_pw_hmac is not null and p_pw_hmac = _c.pw_hmac)
           or _by_pw;

    if not _match and p_password is null and p_pw_hmac is not null and _c.pw_hmac is null and _plain then
        -- This slip's password has no tag yet and the stored one is on file:
        -- ask the edge for the typed password. Nothing is counted or logged:
        -- the second call counts this try, once.
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'fallback', true);
    end if;

    if not _match then
        update session set check_fails = check_fails + 1 where id = _s.id;
        perform _log('open', 'wrong_identity', p_ip_hash, _c.id, _q.course_id);
        if _misses + 1 >= 5 then
            return jsonb_build_object('ok', false, 'error', 'slip_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', 4 - _misses);
    end if;

    -- The printed password matched the stored one: keep its tag on this
    -- slip, bound to this slip's own code (the phone opened it with that
    -- code), so the next check compares tags. Once no live slip needs the
    -- stored password, the trigger clears it.
    if _by_pw and _c.pw_hmac is null and p_pw_hmac is not null
       and _c.code_hmac is not null and p_code_hmac = _c.code_hmac then
        update student_access_code set pw_hmac = p_pw_hmac where id = _c.id;
    end if;

    update session set checked_at = now() where id = _s.id;
    update student_access_code set opened_at = coalesce(opened_at, now()) where id = _c.id;
    perform _log('open', 'verified', p_ip_hash, _c.id, _q.course_id);
    return jsonb_build_object('ok', true) || _payload(_c.id);
end;
$function$;

-- The students a print of slips covers when the teacher names none: every
-- student of the questionnaire's class, or every student the phone report
-- was sent to, not withdrawn, in roster order. As the signed-in teacher
-- (the id Supabase Auth gave teacher-cards). Reads only.
create or replace function student_submit.slip_roster(p_teacher_id uuid, p_kind text, p_target_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
    _course  uuid;
    _closed  timestamptz;
    _ids     jsonb;
begin
    if p_kind is null or p_kind not in ('questionnaire', 'report') then
        raise exception 'kind must be questionnaire or report' using errcode = '22023';
    end if;
    perform _as_teacher(p_teacher_id);
    if p_kind = 'questionnaire' then
        select q.course_id into _course from questionnaire q where q.id = p_target_id and fv_owns_course(q.course_id);
    else
        select r.course_id, r.closed_at into _course, _closed from phone_report r where r.id = p_target_id and fv_owns_course(r.course_id);
    end if;
    if _course is null then
        raise exception 'not found' using errcode = 'P0002';
    end if;
    if _closed is not null then
        raise exception 'this report is closed' using errcode = 'FVS01';
    end if;
    select coalesce(jsonb_agg(e.id order by e.roster_position nulls last, e.id), '[]'::jsonb) into _ids
      from enrollment e
     where e.course_id = _course and e.withdrawn_at is null and fv_owns_enrollment(e.id)
       and (p_kind = 'questionnaire'
            or exists (select 1 from phone_report_student s where s.report_id = p_target_id and s.enrollment_id = e.id));
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
    return _ids;
end;
$function$;

-- New slips, for teacher-cards: one per student named, each with two
-- candidate codes as tags (the database cannot be asked "is this code
-- taken?" without being shown it, so it is handed two and uses the second
-- if the first is a slip's already), and a password's tag for each
-- candidate. The password is stored only for a student with no birthday
-- and no student number. As the signed-in teacher (the id Supabase Auth
-- gave teacher-cards), with the ownership and idempotency helpers every
-- teacher RPC uses. A new slip takes the place of the student's earlier
-- one for the same questionnaire (if unused) or report, as
-- issue_access_codes and issue_report_codes did. A replay makes nothing and
-- says which candidate nobody: the codes were never here.
--
-- A new code can be the same six characters as a slip printed before this
-- file that is not converted yet (its hash cannot be checked without the
-- code): about one in a million slips while old ones are live. The new slip
-- then opens by its tag first, and the old slip's holder meets the new
-- slip's student's "Is this you?", which they cannot pass.
create or replace function student_submit.issue_slips(p_teacher_id uuid, p_kind text, p_target_id uuid, p_items jsonb,
                                                      p_key_id text, p_idempotency_key uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    _hex64   constant text := '^[0-9a-f]{64}$';
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
    _cached  jsonb;
    _item    record;
    _cand    jsonb;
    _q       questionnaire%rowtype;
    _r       phone_report%rowtype;
    _course  uuid;
    _expires timestamptz;
    _has_pw  boolean;
    _made    uuid;
    _pick    int;
    _con     text;
    _one     jsonb;
    _results jsonb := '[]'::jsonb;
begin
    -- The request's shape, before anything is read or changed. A tag is 64
    -- lower-case hex characters and nothing else: a code can never arrive
    -- where a tag goes.
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    if p_kind is null or p_kind not in ('questionnaire', 'report') then
        raise exception 'kind must be questionnaire or report' using errcode = '22023';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'items must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_items) > 250 then
        raise exception 'at most 250 students in one request' using errcode = '22023';
    end if;
    for _item in select t.i, t.ord from jsonb_array_elements(p_items) with ordinality as t(i, ord) loop
        if jsonb_typeof(_item.i) <> 'object'
           or jsonb_typeof(_item.i->'enrollment_id') is distinct from 'string' or _item.i->>'enrollment_id' !~ _uuid
           or jsonb_typeof(_item.i->'candidates') is distinct from 'array' then
            raise exception 'item % is malformed', _item.ord using errcode = '22023';
        end if;
        if jsonb_array_length(_item.i->'candidates') <> 2 then
            raise exception 'item % must have exactly two candidates', _item.ord using errcode = '22023';
        end if;
        for _cand in select c from jsonb_array_elements(_item.i->'candidates') c loop
            if jsonb_typeof(_cand) <> 'object'
               or jsonb_typeof(_cand->'code_hmac') is distinct from 'string' or _cand->>'code_hmac' !~ _hex64
               or jsonb_typeof(_cand->'pw_hmac') is distinct from 'string' or _cand->>'pw_hmac' !~ _hex64 then
                raise exception 'item % has a candidate that is not two tags', _item.ord using errcode = '22023';
            end if;
        end loop;
    end loop;
    if (select count(distinct lower(i->>'enrollment_id')) from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
        raise exception 'a student is named twice' using errcode = '22023';
    end if;
    if (select count(distinct c->>'code_hmac') from jsonb_array_elements(p_items) i, jsonb_array_elements(i->'candidates') c)
       <> 2 * jsonb_array_length(p_items) then
        raise exception 'a code tag is given twice' using errcode = '22023';
    end if;

    perform _as_teacher(p_teacher_id);
    if p_kind = 'questionnaire' then
        select * into _q from questionnaire where id = p_target_id and fv_owns_course(course_id);
        if _q.id is null then
            raise exception 'questionnaire not found' using errcode = 'P0002';
        end if;
        _course := _q.course_id;
        _expires := coalesce((_q.closes_on + 1)::timestamptz, now() + interval '30 days');
    else
        select * into _r from phone_report where id = p_target_id and fv_owns_course(course_id);
        if _r.id is null then
            raise exception 'report not found' using errcode = 'P0002';
        end if;
        if _r.closed_at is not null then
            raise exception 'this report is closed' using errcode = 'FVS01';
        end if;
        _course := _r.course_id;
        _expires := (_r.expires_on + 1)::timestamptz;
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'issue_slips');
    if _cached is not null then
        perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
        return jsonb_build_object('replayed', true, 'results', _cached->'results');
    end if;

    for _item in
        select (t.i->>'enrollment_id')::uuid as enrollment_id, t.i->'candidates' as candidates
          from jsonb_array_elements(p_items) with ordinality as t(i, ord)
         order by t.ord
    loop
        _one := jsonb_build_object('enrollment_id', _item.enrollment_id);
        if not exists (select 1 from enrollment e
                        where e.id = _item.enrollment_id and e.course_id = _course and e.withdrawn_at is null
                          and fv_owns_enrollment(e.id))
           or (p_kind = 'report' and not exists (select 1 from phone_report_student s
                                                  where s.report_id = _r.id and s.enrollment_id = _item.enrollment_id)) then
            -- not in this class (or not sent this report), or withdrawn
            _results := _results || jsonb_build_array(_one || jsonb_build_object('result', 'not_found'));
            continue;
        end if;
        -- All or nothing for the student: if no new slip can be stored, the
        -- old one is not taken back either.
        begin
            if p_kind = 'questionnaire' then
                update student_access_code set revoked_at = now()
                 where enrollment_id = _item.enrollment_id and questionnaire_id = _q.id
                   and used_at is null and revoked_at is null;
                _has_pw := exists (select 1 from enrollment e join student s on s.id = e.student_id
                                    where e.id = _item.enrollment_id and s.date_of_birth is null
                                      and nullif(btrim(s.student_number), '') is null);
            else
                update student_access_code set revoked_at = now()
                 where enrollment_id = _item.enrollment_id and phone_report_id = _r.id and revoked_at is null;
                _has_pw := false;
            end if;
            _made := null;
            for _try in 0..1 loop
                begin
                    insert into student_access_code (enrollment_id, questionnaire_id, phone_report_id,
                                                     code_hmac, pw_hmac, key_id, expires_at)
                    values (_item.enrollment_id, _q.id, _r.id, _item.candidates->_try->>'code_hmac',
                            case when _has_pw then _item.candidates->_try->>'pw_hmac' end, p_key_id, _expires)
                    returning id into _made;
                    _pick := _try;   -- which candidate was stored: the edge returns its code
                    exit;
                exception when unique_violation then
                    get stacked diagnostics _con = constraint_name;
                    if _con is distinct from 'student_access_code_code_hmac' then
                        raise;
                    end if;
                    -- That tag is a slip's already: try the other candidate.
                end;
            end loop;
            if _made is null then
                raise exception 'both candidates are taken' using errcode = 'FVS02';
            end if;
            _one := _one || jsonb_build_object('result', 'made', 'slip_id', _made, 'candidate', _pick,
                                               'has_password', _has_pw);
        exception when sqlstate 'FVS02' then
            _one := jsonb_build_object('enrollment_id', _item.enrollment_id, 'result', 'failed');
        end;
        _results := _results || jsonb_build_array(_one);
    end loop;

    -- What a replay returns: the same, without which candidate was used.
    perform fv_idem_store(p_idempotency_key, 'issue_slips',
                          jsonb_build_object('results', (select coalesce(jsonb_agg(r - 'candidate' order by n), '[]'::jsonb)
                                                           from jsonb_array_elements(_results) with ordinality as x(r, n))));
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
    return jsonb_build_object('replayed', false, 'results', _results);
end;
$function$;

-- ── What goes ───────────────────────────────────────────────────────────────
-- The slip's open and verify as they were (new signatures above), and the
-- teacher RPCs that made a slip's code in the database, with their helpers.
-- A teacher could call _slip_password directly and make a readable
-- password; it goes with them.
drop function if exists student_submit.open(text, text);
drop function if exists student_submit.verify(text, text, text, text, text);
drop function if exists public.issue_access_codes(uuid, uuid[], uuid);
drop function if exists public.issue_report_codes(uuid, uuid[], uuid);
drop function if exists public._issue_access_code(uuid, uuid, timestamp with time zone);
drop function if exists public._issue_report_code(uuid, uuid, timestamp with time zone);
drop function if exists public._new_access_code();
drop function if exists public._slip_password(uuid);

-- ── Who can run what ────────────────────────────────────────────────────────
-- The student's side and teacher-cards: the service role only (the edge
-- functions). The helpers are granted to nobody. A teacher no longer needs
-- the old hash.
revoke all on function student_submit.open(text, text, text, text) from public, anon, authenticated;
revoke all on function student_submit.verify(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function student_submit.slip_roster(uuid, text, uuid) from public, anon, authenticated;
revoke all on function student_submit.issue_slips(uuid, text, uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function student_submit.open(text, text, text, text) to service_role;
grant execute on function student_submit.verify(text, text, text, text, text, text, text) to service_role;
grant execute on function student_submit.slip_roster(uuid, text, uuid) to service_role;
grant execute on function student_submit.issue_slips(uuid, text, uuid, jsonb, text, uuid) to service_role;
revoke all on function student_submit._slip_old_until() from public, anon, authenticated, service_role;
revoke all on function public._slip_password_settle(uuid) from public, anon, authenticated, service_role;
revoke all on function public._slip_password_on_change() from public, anon, authenticated, service_role;
revoke all on function public._access_code_hash(text, text) from public, anon, authenticated;

-- ── The stored passwords no printed slip needs ──────────────────────────────
-- (DELETES DATA.) Once, for every student: the rule the trigger keeps from
-- now on.
do $settle$
begin
    perform public._slip_password_settle(s.id) from public.student s where s.slip_password is not null;
end
$settle$;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/slips_keyed.py)
            ('student_submit._slip_old_until()',                           '568527d9c8d239655dd55ab7c52009da'),
            ('public._slip_password_settle(uuid)',                         '9df7e6113498810271631c5a410b1554'),
            ('public._slip_password_on_change()',                          'e6f31871e265ff7c6eb480e60d22c149'),
            ('student_submit.open(text,text,text,text)',                   '1b0862066e6d8c546f3944f12248be26'),
            ('student_submit.verify(text,text,text,text,text,text,text)',  'b6b51a888f68aa5b54ffdf866756ee47'),
            ('student_submit.slip_roster(uuid,text,uuid)',                 '33954320e0812e4c22e5936bb2ee76a9'),
            ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
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
            -- FINGERPRINTS-BEGIN drops (written by migrations/local-test/slips_keyed.py)
            ('student_submit.open(text,text)',                                'd11b2e67cbf10cae4d44ae6082fd8e01'),
            ('student_submit.verify(text,text,text,text,text)',               '901e62bdb5d94a9ffcebe33563425ad7'),
            ('public.issue_access_codes(uuid,uuid[],uuid)',                   'c96c672abd7d81b00b59c8819c580c78'),
            ('public.issue_report_codes(uuid,uuid[],uuid)',                   'cdda4154e26cd4c2f9b1dd4648de959c'),
            ('public._issue_access_code(uuid,uuid,timestamp with time zone)', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamp with time zone)', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('public._new_access_code()',                                     '59989059b38fc77419052a42206c3aaa'),
            ('public._slip_password(uuid)',                                   'fc16d2f952f0a9f05ab49d7a1c16a5ea')
            -- FINGERPRINTS-END
        ) as v(fn, before)
    loop
        if to_regprocedure(_f.fn) is not null then
            raise exception '% is still there. Nothing was changed.', _f.fn;
        end if;
    end loop;
    if to_regclass('public.student_access_code_code_hmac') is null
       or not exists (select 1 from pg_trigger where tgname = 'student_access_code_slip_password'
                         and tgrelid = 'public.student_access_code'::regclass) then
        raise exception 'the tag index or the password trigger is missing. Nothing was changed.';
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
