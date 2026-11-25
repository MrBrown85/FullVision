-- A questionnaire slip's code ends at midnight BC time on the closing day (2026-11-24). APPLIED Nov 24 2026 on Colin's OK after review (final check passed).
-- student_submit.issue_slips gave a questionnaire's slip codes expires_at = (closes_on + 1)::timestamptz. The
-- session's time zone on live is UTC, so a questionnaire closing on Nov 24 stopped taking its slips at
-- 00:00 UTC Nov 25, which is 5 p.m. BC time on Nov 24, not midnight. The page's own check of the closing
-- day (student_submit._closed_reason) reads the BC day (2026112411), so for seven hours a slip was refused
-- while the questionnaire was still open. 2026112412 fixed the same line for phone report links.
--
-- == What it changes ==
-- One line of student_submit.issue_slips, patched in place behind its live md5 (as 2026112412 left it):
--   (_q.closes_on + 1)::timestamptz
-- becomes the start of the next day in the class's time zone, read through public._fv_timezone (BC = UTC-7):
--   ((_q.closes_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c
--     where c.id = _q.course_id)))
-- A questionnaire with no closing day keeps now() + 30 days. Nothing else changes: same security, search
-- path, volatility, owner and grants (checked at the end).
--
-- == What it does to existing rows ==
-- Nothing. Slip codes already issued keep the end they were given until the teacher issues the slips again.
--
-- == What applying it accepts ==
-- New slips for a questionnaire with a closing day work until midnight BC on that day (07:00 UTC the next
-- day), seven hours longer than before. Requires 2026112411 (checked: _fv_timezone's md5).
--
-- == How to apply ==
-- Only on the owner's OK, after review. One transaction, guards first, a five-second lock timeout; a second
-- run changes nothing. Undo: local-test/slip-expiry-undo.sql (the one line back, md5 checked).
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _md5 text;
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    if (select proowner from pg_proc where oid = to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'))
       is distinct from (select oid from pg_roles where rolname = current_user) then
        raise exception 'Run this as the owner of student_submit.issue_slips (% is not). Nothing was changed.', current_user;
    end if;
    _md5 := md5(pg_get_functiondef(to_regprocedure('public._fv_timezone(text)')));
    if _md5 is distinct from '028dfb6cb7ab9cf43e29b0267a65d8d6' then
        raise exception 'public._fv_timezone is not as 2026112411 left it (md5 %). Nothing was changed.', _md5;
    end if;
    -- issue_slips as 2026112412 left it.
    _md5 := md5(pg_get_functiondef(to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)')));
    if _md5 is distinct from '3fecf86d8b285c6f72072ab72b71e410'
       and pg_get_functiondef(to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'))
           not like '%((_q.closes_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _q.course_id)))%' then
        raise exception 'student_submit.issue_slips is not the definition this file was written against (md5 %). Nothing was changed.', _md5;
    end if;
end
$guard$;

do $migration$
declare
  _fn   text := 'student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)';
  _from text := '(_q.closes_on + 1)::timestamptz';
  _to   text := '((_q.closes_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _q.course_id)))';
  _def  text := pg_get_functiondef(_fn::regprocedure);
begin
  if position(_to in _def) > 0 then
    return;   -- already as this file leaves it (a second run)
  end if;
  if (length(_def) - length(replace(_def, _from, ''))) / length(_from) <> 1 then
    raise exception '% does not have exactly one "%". Nothing was changed.', _fn, _from;
  end if;
  execute replace(_def, _from, _to);
end
$migration$;

do $final$
declare
    _def text := pg_get_functiondef(to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'));
    _got text;
begin
    if _def ~ '[+] 1[)]::timestamptz' or _def not like '%_q.course_id)))%' then
        raise exception 'issue_slips still ends a slip in the session''s time zone. Nothing was changed.';
    end if;
    if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)')
                      and p.provolatile = 'v' and p.prosecdef
                      and p.proconfig::text = '{"search_path=public, student_submit, pg_temp"}') then
        raise exception 'issue_slips lost its volatility, security or search path. Nothing was changed.';
    end if;
    select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
      from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
              from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)')
               and a.grantee <> p.proowner and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x;
    if _got not in ('service_role', 'fv_teacher_cards, service_role') then
        raise exception 'issue_slips may be run by "%". Nothing was changed.', _got;
    end if;
    if ((date '2026-11-24' + 1)::timestamp at time zone public._fv_timezone('America/Vancouver')) is distinct from timestamptz '2026-11-25 07:00:00+00' then
        raise exception 'the start of the next BC day is not 07:00 UTC. Nothing was changed.';
    end if;
end
$final$;

commit;
