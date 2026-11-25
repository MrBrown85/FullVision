-- A phone report link's last day is read in BC's day, to the end of that day (2026-11-24). APPLIED Nov 24 2026 on Colin's OK after review (final check passed).
-- Two teacher functions refuse a last day before "today": public.create_phone_report (sending a report to
-- the phone) and public.update_phone_report (changing a link's last day). Both work out today with
-- current_date, which is the database session's day, and the session's time zone on live is UTC. So from 5 p.m.
-- to midnight BC time (UTC-7) current_date is already tomorrow, and a teacher who picks today as the last day
-- is told "the last day must be today or later". The student side already reads the last day in BC's day:
-- student_submit.report and student_submit.open compare (now() at time zone public._fv_timezone(course.timezone))::date
-- with expires_on. This file makes the two teacher functions work out today the same way, from the class's zone.
-- It also fixes the instant a card's code stops working: where a phone report link's card code gets its
-- expires_at from the last day, "(expires_on + 1)::timestamptz" reads midnight in the session's zone, which on
-- live is UTC, so a link set to expire on Nov 24 stopped at 5 p.m. BC time on Nov 24, not at
-- midnight. It is now the start of the next day in the class's zone: 07:00 UTC on Nov 25.
--
-- == What it changes ==
--   1. public.create_phone_report(uuid,integer,text,date,jsonb,uuid): the one check
--      "p_expires_on < current_date" becomes
--      "p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = p_course_id)))::date".
--      It runs after the ownership check, so the course is the teacher's own.
--   2. public.update_phone_report(uuid,jsonb,date,uuid): the one check "p_expires_on < current_date" becomes
--      the same with _r.course_id (the report's class, read just before, with the ownership check).
--   3. public._fv_timezone(text) may now be run by the role authenticated (the signed-in teacher) as well as
--      service_role. Both teacher functions above are security invoker, so they run as the teacher, and today the
--      teacher is refused the function ("permission denied for function _fv_timezone"): the fix cannot work
--      without it. The function is pure: it reads no table and returns a zone name. Its definition, owner,
--      volatility and search_path are not touched (md5 unchanged); the anon role still cannot run it.
--   4. student_submit.issue_slips (security definer; the edge function teacher-cards calls it through service_role):
--      for a report, "_expires := (_r.expires_on + 1)::timestamptz" becomes
--      "_expires := ((_r.expires_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))".
--      That is the instant a new card code for a phone report stops working. The questionnaire branch of the same
--      function (closes_on + 1) is the same kind of reading but is not a phone report, and is left alone.
--   And in update_phone_report a second edit: "set expires_at = (p_expires_on + 1)::timestamptz" becomes
--   "set expires_at = ((p_expires_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))",
--   which moves the codes already issued for the report to the new last day's end in BC.
--   Each of the functions is patched in place from the live definition behind its md5, the way 2026112411 patched its functions:
--   one exact edit, found exactly once; the rest of each function is word for word as live has it. Same
--   signature, language, volatility (volatile), security (invoker), search_path (public), owner and grants.
--   current_date is not used anywhere else in either function (checked on live; the edit count is 1 each).
--   Every function in public, student_submit and fv_private that sets student_access_code.expires_at from a phone
--   report's expires_on was listed on live on Nov 24 2026 (read-only): update_phone_report (the update above) and
--   student_submit.issue_slips (the insert above). create_phone_report and _phone_report_put do not set it; codes
--   are only made by issue_slips. Others that mention expires_at only compare it with now() (check, open, submit)
--   or write a session's own expires_at.
-- Left alone on purpose: nothing else on live uses current_date, now()::date or localtimestamp as a BC "today"
-- (read-only scan of public, student_submit and fv_private on Nov 24 2026). The student side already reads BC's day.
--
-- (Found by the test, not in the first plan: the contract said "same grants". The one grant added is item 3.)
--
-- == What it does to existing rows ==
-- Nothing. No row of any table is read or written when it applies. A report's stored expires_on and a card's
-- expires_at stay as they are: codes already issued keep their old instant (5 p.m. BC on the last day) until the
-- teacher changes the report's last day or issues the card again.
--
-- == What applying it accepts ==
-- From the moment it applies, a teacher may set a phone report link's last day to the class's BC day, at any hour
-- (before, from 5 p.m. to midnight BC time the day was refused). A last day before the class's BC day is still
-- refused, with the same message. A link's card codes made or moved after this work until the end of the last day
-- in BC (07:00 UTC the next day) instead of ending 7 hours earlier. Between 07:00 and 24:00 UTC (midnight to 5 p.m. BC) the day check gives the same answer as before. An
-- unknown or blank course zone reads as BC (UTC-7), as everywhere since 2026112411.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; 2026112411 is applied (public._fv_timezone is
-- the definition it left, md5 checked, and owned by the running role) and Etc/GMT+7 is a UTC-7 zone with no daylight time here; course has a
-- timezone column; the running role owns the functions it changes; each is the definition this file was tested against
-- (md5 of pg_get_functiondef, public on the search path), or, on a second run, as this file leaves it. Its last
-- step checks everything came out as written: no current_date left, the two md5s, volatility, security, search
-- path and grants.
--
-- == What it does not depend on ==
-- Collation, locale, time zone, search path and the applying role: no text is sorted but under collate "C";
-- the file sets its own search path and each function pins its own; the owner is checked and grants are read
-- from proacl. No backslash and no non-ASCII character is in the file.
--
-- == Locks ==
-- Only a brief lock on the four functions' catalog rows; it gives up after five seconds with nothing applied if
-- one is held: run it again. One transaction.
--
-- == How to apply ==
-- Only on the owner's OK. Tested on a throwaway PostgreSQL 17, ICU en-US and C (local-test/README.md, "Phone report
-- last day in BC's day").
--   0. local-test/phone-report-expiry-live-fingerprints.sql, read-only. Expected: no rows.
--   1. local-test/phone-report-expiry-live-precheck.sql, read-only. Expected: no rows.
--   2. This whole file as one migration named phone_report_expiry_bc_day.
--   3. local-test/phone-report-expiry-live-postcheck.sql. Every row ok.
-- Undo: local-test/phone-report-expiry-undo.sql. It puts both functions back word for word (md5 checked) and takes
-- the grant on _fv_timezone away again.
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f    record;
    _md5  text;
    _me   oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    if not exists (select 1 from pg_timezone_names where name = 'Etc/GMT+7' and utc_offset = interval '-7 hours' and not is_dst) then
        raise exception 'Etc/GMT+7 is not a UTC-7 zone with no daylight time here. Nothing was changed.';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course'
                    and column_name = 'timezone' and data_type = 'text') then
        raise exception 'public.course has no text column timezone. Nothing was changed.';
    end if;
    -- The two it replaces and _fv_timezone (whose grant it adds to) must exist and belong to the running role.
    if (select count(*) from pg_proc p
         where p.oid in (to_regprocedure('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'),
                         to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)'),
                         to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'),
                         to_regprocedure('public._fv_timezone(text)'))) <> 4
       or exists (select 1 from pg_proc p
                   where p.oid in (to_regprocedure('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'),
                                   to_regprocedure('public.update_phone_report(uuid,jsonb,date,uuid)'),
                                   to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'),
                                   to_regprocedure('public._fv_timezone(text)'))
                     and p.proowner <> _me) then
        raise exception 'Run this as the owner of the four functions this file changes (% is not, or one is missing). Nothing was changed.', current_user;
    end if;
    -- The function it relies on: as 2026112411 leaves it.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied
            ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %): has 2026112411 been applied? Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The two replaced: as live had them, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces
            ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', '55a852bc57853ac9b558b13b4dd965ff', 'ba3b0d2c4e47b3f517bf67648a90f8cf'),
            ('public.update_phone_report(uuid,jsonb,date,uuid)', 'd3d30f8a96ecfd8431c6e44683e6bebd', 'af3a4d8dceebd78e2757e15470767100'),
            ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448', '3fecf86d8b285c6f72072ab72b71e410')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
end
$guard$;

-- == 1. The signed-in teacher may run _fv_timezone ==
-- Without it the check below fails for the teacher with "permission denied for function _fv_timezone".
grant execute on function public._fv_timezone(text) to authenticated;

-- == 2. The last-day check reads the class's BC day ==
-- One exact edit to each live definition. Each must match the number of times written, or the migration stops
-- and nothing is changed. A function already as this file leaves it is skipped.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement, times it must be found
    array['public.create_phone_report(uuid,integer,text,date,jsonb,uuid)',
          'p_expires_on < current_date',
          'p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = p_course_id)))::date', '1'],
    array['public.update_phone_report(uuid,jsonb,date,uuid)',
          'p_expires_on < current_date',
          'p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))::date', '1'],
    array['public.update_phone_report(uuid,jsonb,date,uuid)',
          '(p_expires_on + 1)::timestamptz',
          '((p_expires_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))', '1'],
    array['student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)',
          '(_r.expires_on + 1)::timestamptz',
          '((_r.expires_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))', '1']
  ];
  _def text;
  _hits int;
  _have int;
  i int;
  _fn text;
begin
  for i in 1 .. array_length(_edits, 1) loop
    _fn := _edits[i][1];
    _def := pg_get_functiondef(_fn::regprocedure);
    -- How many times the replacement is already there, and the text to find.
    _have := (length(_def) - length(replace(_def, _edits[i][3], ''))) / length(_edits[i][3]);
    if _have = _edits[i][4]::int then
      continue;   -- already as this file leaves it (a second run)
    end if;
    if _have <> 0 then
      raise exception '% has % copies of "%", expected 0 or %', _fn, _have, _edits[i][3], _edits[i][4];
    end if;
    _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
    if _hits <> _edits[i][4]::int then
      raise exception '% has % matches for "%", expected %', _fn, _hits, _edits[i][2], _edits[i][4];
    end if;
    execute replace(_def, _edits[i][2], _edits[i][3]);
  end loop;
end
$migration$;

-- == Everything is as the header says ==
do $final$
declare
    _f    record;
    _md5  text;
    _bad  text[] := '{}';
    _got  text;
    _def  boolean;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN after
            ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', 'ba3b0d2c4e47b3f517bf67648a90f8cf'),
            ('public.update_phone_report(uuid,jsonb,date,uuid)', 'af3a4d8dceebd78e2757e15470767100'),
            ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', '3fecf86d8b285c6f72072ab72b71e410')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.becomes);
        end if;
        -- No session-day clock left, no midnight in the session's zone, and the zone is read through _fv_timezone.
        if pg_get_functiondef(to_regprocedure(_f.fn)) ~* 'current_date'
           or pg_get_functiondef(to_regprocedure(_f.fn)) ~ 'expires_on [+] 1[)]::timestamptz'
           or pg_get_functiondef(to_regprocedure(_f.fn)) not like '%public._fv_timezone((select c.timezone from public.course c where c.id = %))%' then
            _bad := _bad || format('%s does not read the last day in the class''s BC day', _f.fn);
        end if;
        -- Kept: volatility, security, search path and grants, as each had them (the role fv_student_submit,
        -- the server's, is left out of the grants as in 2026112411).
        _def := _f.fn like 'student_submit.%';
        if not exists (select 1 from pg_proc p where p.oid = to_regprocedure(_f.fn)
                          and p.provolatile = 'v' and p.prosecdef = _def
                          and p.proconfig::text = case when _def then '{"search_path=public, student_submit, pg_temp"}' else '{search_path=public}' end) then
            _bad := _bad || format('%s is not volatile with its security and search path as before', _f.fn);
        end if;
        select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
          from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(_f.fn) and a.grantee <> p.proowner
                   and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x;
        -- issue_slips: the edge functions' role, and on live also the teacher-cards role (a rebuilt database has no such role).
        if _got is distinct from 'authenticated, service_role' and not (_def and _got in ('service_role', 'fv_teacher_cards, service_role')) then
            _bad := _bad || format('grant: %s may be run by "%s"', _f.fn, _got);
        end if;
    end loop;
    -- _fv_timezone: stable and pinned as 2026112411 left it (its md5 is checked above), may be run by the
    -- teacher and the edge functions' role, and by no one else.
    select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
      from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
              from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('public._fv_timezone(text)') and a.grantee <> p.proowner
               and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x;
    if _got is distinct from 'authenticated, service_role' then
        _bad := _bad || format('grant: public._fv_timezone(text) may be run by "%s", not "authenticated, service_role"', _got);
    end if;
    -- BC's day from an instant, as the student side reads it: 00:30 UTC on Nov 25 is 5:30 p.m. on Nov 24.
    if ((timestamptz '2026-11-25 00:30:00+00' at time zone public._fv_timezone('America/Vancouver'))::date) is distinct from date '2026-11-24'
       or ((timestamptz '2026-11-25 07:30:00+00' at time zone public._fv_timezone('America/Vancouver'))::date) is distinct from date '2026-11-25' then
        _bad := _bad || 'an instant does not read as UTC-7'::text;
    end if;
    if ((date '2026-11-24' + 1)::timestamp at time zone public._fv_timezone('America/Vancouver')) is distinct from timestamptz '2026-11-25 07:00:00+00' then
        _bad := _bad || 'the start of the next BC day is not 07:00 UTC'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
