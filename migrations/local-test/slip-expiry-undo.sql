-- Undo for migrations/2026112413_slip_expiry_bc_midnight.sql: puts the one line of student_submit.issue_slips
-- back as 2026112412 left it (md5 3fecf86d8b285c6f72072ab72b71e410 afterwards). One transaction; a second run
-- changes nothing.
begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $undo$
declare
  _fn   text := 'student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)';
  _from text := '((_q.closes_on + 1)::timestamp at time zone public._fv_timezone((select c.timezone from public.course c where c.id = _q.course_id)))';
  _to   text := '(_q.closes_on + 1)::timestamptz';
  _def  text := pg_get_functiondef(_fn::regprocedure);
begin
  if position(_from in _def) = 0 then
    return;   -- already undone
  end if;
  execute replace(_def, _from, _to);
  if md5(pg_get_functiondef(_fn::regprocedure)) <> '3fecf86d8b285c6f72072ab72b71e410' then
    raise exception 'issue_slips did not come back as 2026112412 left it. Nothing was changed.';
  end if;
end
$undo$;

commit;
