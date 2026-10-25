-- Attendance totals on the Term Questionnaire, for the report card.
--
-- What it is for: teachers take attendance in MyEd BC (or on paper), not in
-- FullVision. At report time they copy each student's totals to date from
-- MyEd into the questionnaire: classes absent and times late, for the year
-- so far. Each report's numbers are totals to date, never "this term only",
-- so the teacher types what MyEd shows; FullVision works out the change
-- since the last report (Colin, 2026-10-24).
--
-- What it adds:
--   term_rating.absences, term_rating.lates: totals to date at that report;
--     null = not entered. Never negative.
--   save_term_attendance(p_enrollment_id, p_term, p_absences, p_lates):
--     saves both numbers on that report's term_rating row (made if missing),
--     idempotent on (enrollment, term), each change audited as the
--     questionnaire's other fields are. Passing null clears a number.
--   list_course_term_attendance(p_course_id) -> {enrollment_id: {term:
--     {absences, lates}}}: a read of its own, so get_class_bundle and
--     save_term_rating stay as they are.
-- Security invoker: term_rating's RLS (fv_owns_enrollment) decides access.
-- No existing function changes; no data changes.

alter table public.term_rating
  add column if not exists absences integer
    constraint term_rating_absences_check check (absences >= 0),
  add column if not exists lates integer
    constraint term_rating_lates_check check (lates >= 0);

create or replace function public.save_term_attendance(
  p_enrollment_id uuid,
  p_term          integer,
  p_absences      integer,
  p_lates         integer
)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare _tr_id uuid; _old term_rating%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_term < 1 or p_term > 6 then raise exception 'term must be 1..6' using errcode = '22023'; end if;
    if (p_absences is not null and p_absences < 0) or (p_lates is not null and p_lates < 0) then
        raise exception 'attendance totals cannot be negative' using errcode = '22023';
    end if;

    select * into _old from term_rating where enrollment_id = p_enrollment_id and term = p_term;

    insert into term_rating (enrollment_id, term, absences, lates)
    values (p_enrollment_id, p_term, p_absences, p_lates)
    on conflict (enrollment_id, term) do update
       set absences = excluded.absences, lates = excluded.lates, updated_at = now()
    returning id into _tr_id;

    perform _term_rating_audit_field(_tr_id, 'absences', _old.absences::text, p_absences::text);
    perform _term_rating_audit_field(_tr_id, 'lates', _old.lates::text, p_lates::text);
    return _tr_id;
end; $$;

create or replace function public.list_course_term_attendance(p_course_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(x.enrollment_id::text, x.terms), '{}'::jsonb)
    from (
      select tr.enrollment_id,
             jsonb_object_agg(tr.term::text, jsonb_build_object('absences', tr.absences, 'lates', tr.lates)) as terms
        from term_rating tr
        join enrollment e on e.id = tr.enrollment_id
       where e.course_id = p_course_id
         and (tr.absences is not null or tr.lates is not null)
       group by tr.enrollment_id
    ) x;
$$;

revoke execute on function public.save_term_attendance(uuid, integer, integer, integer) from public, anon;
grant execute on function public.save_term_attendance(uuid, integer, integer, integer) to authenticated, service_role;
revoke execute on function public.list_course_term_attendance(uuid) from public, anon;
grant execute on function public.list_course_term_attendance(uuid) to authenticated, service_role;
