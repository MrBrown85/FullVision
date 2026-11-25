-- Undo for migrations/2026112411_bc_time_utc_minus_7.sql (2026-11-24).
--
-- == What it does ==
-- Puts _fv_timezone back word for word (the name given when PostgreSQL accepts it, else 'America/Vancouver'),
-- and reverses the five edits so student_submit._closed_reason, "check", forms, open and report spell out
-- coalesce(nullif(X, ''), 'America/Vancouver') again, then checks all six against the md5 live had before the
-- file. Dates the database works out in BC's time move back an hour, to what PostgreSQL's time zone data says
-- (Supabase's data on Nov 24 2026 still has BC at UTC-8 in winter). No row is read or written. Run it also when
-- Supabase's own time zone data has caught up and the name can be read as it is.
-- It stops with nothing changed if a function is neither as before the file nor as the file left it.
-- On a database where the file was never applied it changes nothing; a second run changes nothing.

begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-replaced
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
        ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389', 'd1d3d5270abdc21fa20651ab64ae4d6d'),
        ('student_submit."check"(text,text,text)', '99f1c611b868805f292dfadb6786ce08', '87c95addbfe06444c8350a774e8e984c'),
        ('student_submit.forms(text,uuid,text)', '40ae918432795a5effbdd4cf6efead15', 'e0445a5cb7018f27bdcdb1e0f2c2171d'),
        ('student_submit.open(text,text,text,text)', '32b368857d41bff77defa34c3fa0a5a0', '49d84f9a59520e5ae3b53716ae75f14d'),
        ('student_submit.report(text,uuid,uuid,text)', 'd009be8b73801173f816d9a5db036b42', '1e6beb102ac13d27c852f76075dbee86')
        -- FINGERPRINTS-END
    ) as v(fn, before, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.before and _md5 is distinct from _f.now then
            raise exception '% is neither as before the file nor as the file left it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

-- OLD-DEFINITIONS-BEGIN
CREATE OR REPLACE FUNCTION public._fv_timezone(p_tz text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if nullif(btrim(p_tz), '') is null then return 'America/Vancouver'; end if;
    perform now() at time zone p_tz;
    return p_tz;
exception when others then
    return 'America/Vancouver';
end;
$function$;

-- OLD-DEFINITIONS-END

do $migration$
declare
  _edits text[][] := array[
    -- function, text the file wrote, text live had, times
    array['student_submit._closed_reason(questionnaire,text)',
          'public._fv_timezone(p_tz)',
          'coalesce(nullif(p_tz, ''''), ''America/Vancouver'')', '1'],
    array['student_submit."check"(text,text,text)',
          'public._fv_timezone(_course.timezone)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')', '1'],
    array['student_submit.forms(text,uuid,text)',
          'public._fv_timezone(_course.timezone)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')', '1'],
    array['student_submit.open(text,text,text,text)',
          'public._fv_timezone(_course.timezone)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')', '1'],
    array['student_submit.report(text,uuid,uuid,text)',
          'public._fv_timezone(_course.timezone)',
          'coalesce(nullif(_course.timezone, ''''), ''America/Vancouver'')', '1']
  ];
  _def text;
  _hits int;
  i int;
  _fn text;
begin
  for i in 1 .. array_length(_edits, 1) loop
    _fn := _edits[i][1];
    _def := pg_get_functiondef(_fn::regprocedure);
    _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
    if _hits = 0 then
      continue;   -- already as live had it (a second run)
    end if;
    if _hits <> _edits[i][4]::int then
      raise exception '% has % matches for "%", expected %', _fn, _hits, _edits[i][2], _edits[i][4];
    end if;
    execute replace(_def, _edits[i][2], _edits[i][3]);
  end loop;
end
$migration$;

do $final$
declare
    _f   record;
    _md5 text;
    _bad text[] := '{}';
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-after
        ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
        ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389'),
        ('student_submit."check"(text,text,text)', '99f1c611b868805f292dfadb6786ce08'),
        ('student_submit.forms(text,uuid,text)', '40ae918432795a5effbdd4cf6efead15'),
        ('student_submit.open(text,text,text,text)', '32b368857d41bff77defa34c3fa0a5a0'),
        ('student_submit.report(text,uuid,uuid,text)', 'd009be8b73801173f816d9a5db036b42')
        -- FINGERPRINTS-END
    ) as v(fn, before) loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.before);
        end if;
    end loop;
    if cardinality(_bad) > 0 then
        raise exception 'Not as before the file (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
