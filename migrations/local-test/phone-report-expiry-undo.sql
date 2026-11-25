-- Undo for migrations/2026112412_phone_report_expiry_bc_day.sql (2026-11-24).
--
-- == What it does ==
-- Reverses the edits: the one in public.create_phone_report and the two in public.update_phone_report (so each
-- again refuses a last day before current_date, the database session's day, UTC on live, and a card's end is
-- again midnight in the session's zone), and the one in student_submit.issue_slips, then checks all three
-- against the md5 live had before the file, and takes the grant of public._fv_timezone to authenticated away again
-- (the role service_role keeps it). A teacher can then no longer set today as the last day from
-- 5 p.m. to midnight BC time. No row is read or written.
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
        ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', '55a852bc57853ac9b558b13b4dd965ff', 'ba3b0d2c4e47b3f517bf67648a90f8cf'),
        ('public.update_phone_report(uuid,jsonb,date,uuid)', 'd3d30f8a96ecfd8431c6e44683e6bebd', 'af3a4d8dceebd78e2757e15470767100'),
        ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448', '3fecf86d8b285c6f72072ab72b71e410')
        -- FINGERPRINTS-END
    ) as v(fn, before, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.before and _md5 is distinct from _f.now then
            raise exception '% is neither as before the file nor as the file left it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

revoke execute on function public._fv_timezone(text) from authenticated;

do $migration$
declare
  _edits text[][] := array[
    -- function, text the file wrote, text live had, times
    array['public.create_phone_report(uuid,integer,text,date,jsonb,uuid)',
          'p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = p_course_id)))::date',
          'p_expires_on < current_date', '1'],
    array['public.update_phone_report(uuid,jsonb,date,uuid)',
          'p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))::date',
          'p_expires_on < current_date', '1'],
    array['public.update_phone_report(uuid,jsonb,date,uuid)',
          '((p_expires_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))',
          '(p_expires_on + 1)::timestamptz', '1'],
    array['student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)',
          '((_r.expires_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _r.course_id)))',
          '(_r.expires_on + 1)::timestamptz', '1']
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
        ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', '55a852bc57853ac9b558b13b4dd965ff'),
        ('public.update_phone_report(uuid,jsonb,date,uuid)', 'd3d30f8a96ecfd8431c6e44683e6bebd'),
        ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
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
