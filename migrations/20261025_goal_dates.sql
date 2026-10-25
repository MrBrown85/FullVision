-- When each goal was set, for the student page's Goals tab.
--
-- What broke: the Goals tab is to show when a goal was set and the scores
-- on that competency since then (Student Page Audit, 2026-10-25). goal has
-- updated_at, but list_course_student_profiles sends goals as text only
-- ({section_id: body}), so the date never reached the app.
--
-- What it adds:
--   list_course_goal_dates(p_course_id) -> {enrollment_id: {section_id:
--     updated_at}}: when each goal was last saved. A read of its own, so
--     list_course_student_profiles and every client reading it stay as they
--     are. Security invoker: goal's RLS (fv_owns_enrollment) decides what a
--     teacher sees, as for every other read.
-- Nothing else changes; no data changes.

create or replace function public.list_course_goal_dates(p_course_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(x.enrollment_id::text, x.dates), '{}'::jsonb)
    from (
      select g.enrollment_id,
             jsonb_object_agg(g.section_id::text, g.updated_at) as dates
        from goal g
        join enrollment e on e.id = g.enrollment_id
       where e.course_id = p_course_id
       group by g.enrollment_id
    ) x;
$$;

revoke execute on function public.list_course_goal_dates(uuid) from public, anon;
grant execute on function public.list_course_goal_dates(uuid) to authenticated, service_role;
