-- The database reads BC's clock as UTC-7 all year (2026-11-24). APPLIED Nov 24 2026 on Colin's OK (pre-check no rows; final check passed; the database then read 5:51 p.m. at 5:51 p.m. BC time).
-- British Columbia moved to UTC-7 all year. The time zone data in Supabase's PostgreSQL is older than that
-- change: on gradebook-prod today (Nov 24 2026) select utc_offset from pg_timezone_names where name =
-- 'America/Vancouver' says -08:00, while every browser says -07:00. So every date the database works out "in
-- BC" is an hour behind: work and quizzes that close at midnight close at 1 a.m., a student's "today" is still
-- yesterday from 11 p.m. to midnight, and Bulletins days, card expiry and the photo-keeping cutoff move with it.
-- All 18 courses on live have course.timezone = 'America/Vancouver'. Supabase's time zone data cannot be
-- updated by us, so this file changes how the database reads that name, not the name stored.
--
-- == What it changes ==
--   1. public._fv_timezone(p_tz text) answers 'Etc/GMT+7' (a fixed UTC-7, no daylight time: in the zone
--      names "GMT+7" means seven hours behind) for a blank or null name, for a name PostgreSQL does not
--      accept, and for the name 'America/Vancouver' (compared exactly). Any other name PostgreSQL accepts is
--      answered as it was given. Today it answers the name given when PostgreSQL accepts it, else
--      'America/Vancouver'. Same signature, language, volatility (stable), search_path, owner and grants.
--      Every function that works out a date "in the class's time zone" calls it, so all of them (listed under
--      "relied" below) now work out BC's date and time from UTC-7.
--   2. Five functions work out BC's date without going through _fv_timezone: student_submit._closed_reason,
--      student_submit."check", student_submit.forms, student_submit.open and student_submit.report each have
--      coalesce(nullif(X, ''), 'America/Vancouver') after "at time zone". Each is patched in place from the
--      live definition behind its md5 to public._fv_timezone(X), the way 2026112410 patched its functions.
--      Nothing else in them changes.
-- Also changed, through a call, and not fingerprinted on purpose (none does date arithmetic of its own; review,
-- Nov 24): through _closed_reason, student_submit._payload, _preview, answer, form, submit and verify; through
-- _midnight, verify_card; through bulletin_pinned_now, bulletin_json and list_bulletins.
-- Left alone on purpose: public.create_course's default and public.import_json_restore's default, which store
-- the name 'America/Vancouver'. The stored name is right; only how the database reads it changes.
-- When Supabase's time zone data has BC's change (America/Vancouver at -07:00 all year), _fv_timezone can go
-- back to answering the name it is given (this file's undo, or a new file); nothing else needs to change.
--
-- == What it does to existing rows ==
-- Nothing. No row of any table is read or written. Nothing stored is moved: closes_on, opens_on, expires_on,
-- revise_by, works_until, pinned_until and the like are dates the teacher chose and stay as they are.
--
-- == What applying it accepts ==
-- Every date the database computes in BC's time moves one hour, to BC's real time, from the moment it applies:
-- between 11 p.m. and midnight a student's "today" is today (it was yesterday), and a closing date's midnight is
-- at midnight BC time (it was 1 a.m.). So a Send Work window or quiz whose last day is today closes an hour
-- earlier than it did yesterday, as intended. A date already stored from the old reading is not changed. The
-- browsers already read UTC-7, so after this file the page and the database agree.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the running role owns the six functions it
-- replaces; Etc/GMT+7 is a zone name here at UTC-7 with no daylight time; every function it replaces or relies
-- on is the one it was tested against (md5 of pg_get_functiondef, public on the search path), or, on a second
-- run, as this file leaves it. Its last step checks everything came out as written, and what _fv_timezone
-- answers for blank, null, garbage, 'America/Vancouver' and another zone.
--
-- == What it does not depend on ==
-- Collation, locale, time zone, search path and the applying role: no text is sorted but under collate "C";
-- the file sets its own search path and each function pins its own; the owner is checked and grants are read
-- from proacl. No backslash and no non-ASCII character is in the file.
--
-- == Locks ==
-- Only a brief lock on each of the six functions' catalog rows; it gives up after five seconds with nothing
-- applied if one is held: run it again. One transaction.
--
-- == How to apply ==
-- Only on the owner's OK. Tested on a throwaway PostgreSQL 17, ICU en-US and C (local-test/README.md, "BC time").
--   0. local-test/bc-time-live-fingerprints.sql, read-only. Expected: no rows.
--   1. local-test/bc-time-live-precheck.sql, read-only. Expected: no rows.
--   2. This whole file as one migration named bc_time_utc_minus_7.
--   3. local-test/bc-time-live-postcheck.sql. Every row ok.
-- Undo: local-test/bc-time-undo.sql. It puts all six functions back word for word (md5 checked); run it too when
-- Supabase's own time zone data has caught up and the name can be read as it is.
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
    -- The six it replaces must belong to the running role.
    if exists (select 1 from pg_proc p
                where p.oid in (to_regprocedure('public._fv_timezone(text)'),
                                to_regprocedure('student_submit._closed_reason(questionnaire,text)'),
                                to_regprocedure('student_submit."check"(text,text,text)'),
                                to_regprocedure('student_submit.forms(text,uuid,text)'),
                                to_regprocedure('student_submit.open(text,text,text,text)'),
                                to_regprocedure('student_submit.report(text,uuid,uuid,text)'))
                  and p.proowner <> _me)
       or (select count(*) from pg_proc p
            where p.oid in (to_regprocedure('public._fv_timezone(text)'),
                            to_regprocedure('student_submit._closed_reason(questionnaire,text)'),
                            to_regprocedure('student_submit."check"(text,text,text)'),
                            to_regprocedure('student_submit.forms(text,uuid,text)'),
                            to_regprocedure('student_submit.open(text,text,text,text)'),
                            to_regprocedure('student_submit.report(text,uuid,uuid,text)'))) <> 6 then
        raise exception 'Run this as the owner of the six functions this file replaces (% is not, or one is missing). Nothing was changed.', current_user;
    end if;
    -- Every other function that reads _fv_timezone: it must be as tested, because its answer now moves.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied
            ('fv_private.bulletin_audience(uuid)', '0cd8d6cc98739a5b53af1916ac0d0be3'),
            ('fv_private.bulletin_patched(bulletin,jsonb,boolean)', 'c89216a349964fc16d39033a365ccaf6'),
            ('fv_private.bulletin_pinned_now(boolean,date,text)', '3d68484d7051fd8f380fe2a84c401546'),
            ('public._cards_work_until(uuid)', '258317511f7b190e41f62a9570c9b7b7'),
            ('public._photo_keep_class(uuid,timestamp with time zone)', '67d1ae88eeacd34543cc0a80f1055991'),
            ('public._photo_keep_cutoff(uuid,timestamp with time zone)', '57f0aac3911eb4657447a951232bed4a'),
            ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
            ('student_submit._midnight(text)', 'bf7920f2b31724bd007c66f729ac5edb'),
            ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
            ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e'),
            ('student_submit._work_window(uuid)', '904f6388c7f2b65bfb9f093f343100e4'),
            ('student_submit.bulletins(text,uuid,text)', '4753e0fa8727403e1311be6c224fd025'),
            ('student_submit.feedback(text,uuid,text)', '73b78adc4b6661bc99ca0eaebf2e81bb'),
            ('student_submit.file_links(text,uuid,uuid,text)', 'cb91bac98d5d9b4fb27ba72769b1f211'),
            ('student_submit.group_file_links(text,uuid,uuid,text)', '6d1929668e5c32090062fbd1025e0699'),
            ('student_submit.group_work(text,uuid,text)', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
            ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511'),
            ('student_submit.handout_links(text,uuid,uuid,text)', '410877d7e4d5b860b8dadb4c1b185f3c'),
            ('student_submit.handout_original(text,uuid,uuid,text)', '65e00c70081b1234c60679087c117fbe'),
            ('student_submit.markup(text,uuid,uuid,text)', '2296aefc4e38f67aad5722a2637c2fb4'),
            ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa'),
            ('student_submit.reflect(text,uuid,uuid,jsonb,text)', '5f65a3ff02460ea810372d172b988b39'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84'),
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', '340cb72444d555a9cef594b543e2674c')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The six replaced: as live had them, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces
            ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
            ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389', 'd1d3d5270abdc21fa20651ab64ae4d6d'),
            ('student_submit."check"(text,text,text)', '99f1c611b868805f292dfadb6786ce08', '87c95addbfe06444c8350a774e8e984c'),
            ('student_submit.forms(text,uuid,text)', '40ae918432795a5effbdd4cf6efead15', 'e0445a5cb7018f27bdcdb1e0f2c2171d'),
            ('student_submit.open(text,text,text,text)', '32b368857d41bff77defa34c3fa0a5a0', '49d84f9a59520e5ae3b53716ae75f14d'),
            ('student_submit.report(text,uuid,uuid,text)', 'd009be8b73801173f816d9a5db036b42', '1e6beb102ac13d27c852f76075dbee86')
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

-- == 1. _fv_timezone: BC's name reads as a fixed UTC-7 ==
-- As live has it but for the first and last answers. Blank, null, garbage and 'America/Vancouver' all give
-- 'Etc/GMT+7'; any other zone PostgreSQL accepts is given back as it came.
create or replace function public._fv_timezone(p_tz text)
 returns text
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
begin
    if nullif(btrim(p_tz), '') is null or p_tz = 'America/Vancouver' then return 'Etc/GMT+7'; end if;
    perform now() at time zone p_tz;
    return p_tz;
exception when others then
    return 'Etc/GMT+7';
end;
$function$;

-- == 2. The five that did their own coalesce, patched in place ==
-- One exact edit to each live definition. Each must match the number of times written, or the migration stops
-- and nothing is changed. A function already as this file leaves it is skipped.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement, times it must be found
    array['student_submit._closed_reason(questionnaire,text)',
          'coalesce(nullif(p_tz, ''''), ''America/Vancouver'')',
          'public._fv_timezone(p_tz)', '1'],
    array['student_submit."check"(text,text,text)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')',
          'public._fv_timezone(_course.timezone)', '1'],
    array['student_submit.forms(text,uuid,text)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')',
          'public._fv_timezone(_course.timezone)', '1'],
    array['student_submit.open(text,text,text,text)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')',
          'public._fv_timezone(_course.timezone)', '1'],
    array['student_submit.report(text,uuid,uuid,text)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')',
          'public._fv_timezone(_course.timezone)', '1']
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
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN after
            ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
            ('student_submit._closed_reason(questionnaire,text)', 'd1d3d5270abdc21fa20651ab64ae4d6d'),
            ('student_submit."check"(text,text,text)', '87c95addbfe06444c8350a774e8e984c'),
            ('student_submit.forms(text,uuid,text)', 'e0445a5cb7018f27bdcdb1e0f2c2171d'),
            ('student_submit.open(text,text,text,text)', '49d84f9a59520e5ae3b53716ae75f14d'),
            ('student_submit.report(text,uuid,uuid,text)', '1e6beb102ac13d27c852f76075dbee86')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.becomes);
        end if;
    end loop;
    -- No BC zone name is spelled out in a patched function any more.
    for _f in
        select * from (values
            ('student_submit._closed_reason(questionnaire,text)'), ('student_submit."check"(text,text,text)'),
            ('student_submit.forms(text,uuid,text)'), ('student_submit.open(text,text,text,text)'),
            ('student_submit.report(text,uuid,uuid,text)')
        ) as v(fn)
    loop
        if pg_get_functiondef(to_regprocedure(_f.fn)) like '%America/Vancouver%'
           or pg_get_functiondef(to_regprocedure(_f.fn)) not like '%public._fv_timezone(%' then
            _bad := _bad || format('%s does not read its zone through _fv_timezone', _f.fn);
        end if;
    end loop;
    -- What _fv_timezone answers.
    if public._fv_timezone('America/Vancouver') is distinct from 'Etc/GMT+7'
       or public._fv_timezone(null) is distinct from 'Etc/GMT+7'
       or public._fv_timezone('') is distinct from 'Etc/GMT+7'
       or public._fv_timezone('   ') is distinct from 'Etc/GMT+7'
       or public._fv_timezone('Not/AZone') is distinct from 'Etc/GMT+7'
       or public._fv_timezone('America/Toronto') is distinct from 'America/Toronto'
       or public._fv_timezone('UTC') is distinct from 'UTC' then
        _bad := _bad || '_fv_timezone does not answer as written'::text;
    end if;
    -- BC's date from an instant: 06:59 UTC is still the day before, 07:00 UTC is midnight, in winter and in summer.
    if (timestamptz '2026-11-24 06:59:00+00' at time zone public._fv_timezone('America/Vancouver')) is distinct from timestamp '2026-11-23 23:59:00'
       or (timestamptz '2026-11-24 07:00:00+00' at time zone public._fv_timezone('America/Vancouver')) is distinct from timestamp '2026-11-24 00:00:00'
       or (timestamptz '2026-07-15 06:59:00+00' at time zone public._fv_timezone('America/Vancouver')) is distinct from timestamp '2026-07-14 23:59:00'
       or (timestamptz '2026-07-15 07:00:00+00' at time zone public._fv_timezone('America/Vancouver')) is distinct from timestamp '2026-07-15 00:00:00' then
        _bad := _bad || 'an instant does not read as UTC-7'::text;
    end if;
    -- Kept: stable, the same search path, and the grants (read from proacl itself, so default privileges show here;
    -- the role fv_student_submit is left out, as in 2026112410, because it is the server's, not this file's).
    if (select provolatile from pg_proc where oid = to_regprocedure('public._fv_timezone(text)')) is distinct from 's'
       or (select proconfig::text from pg_proc where oid = to_regprocedure('public._fv_timezone(text)')) is distinct from '{"search_path=public, pg_temp"}' then
        _bad := _bad || '_fv_timezone is not stable with its search path'::text;
    end if;
    for _f in
        select * from (values
            ('public._fv_timezone(text)', 'service_role'),
            ('student_submit._closed_reason(questionnaire,text)', ''),
            ('student_submit."check"(text,text,text)', 'service_role'),
            ('student_submit.forms(text,uuid,text)', 'service_role'),
            ('student_submit.open(text,text,text,text)', 'service_role'),
            ('student_submit.report(text,uuid,uuid,text)', 'service_role')
        ) as v(fn, who)
    loop
        select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
          from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(_f.fn) and a.grantee <> p.proowner
                   and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x;
        if _got is distinct from _f.who then
            _bad := _bad || format('grant: %s may be run by "%s", not "%s"', _f.fn, _got, _f.who);
        end if;
    end loop;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
