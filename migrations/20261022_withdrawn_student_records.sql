-- A withdrawn student's records, read-only, for "Keep a copy first".
--
-- Class Management's permanent delete (delete_withdrawn_student) offers a
-- CSV of the student's scores and observations before it deletes them. On the
-- device that withdrew them the browser still holds those records, but after
-- a reload it does not: get_class_bundle leaves withdrawn enrollments out of
-- the scores and observations and lists only their names. So the download
-- reads them from here.
--
-- get_withdrawn_student_records(p_enrollment_id) returns
--   { scores:       [{ assessment, date, score_mode, max_points, value, status, comment }],
--     tag_scores:   [{ assessment, date, code, competency, value, modifier }],
--     rubric_scores:[{ assessment, date, criterion, value, modifier, comment }],
--     observations: [{ date, sentiment, context, body }] }
-- It only reads. It refuses an enrollment that is not withdrawn, so it is no
-- second way to export an active student. SECURITY INVOKER: the enrollment,
-- score and observation RLS (fv_owns_enrollment / fv_owns_course) decides
-- who can read, and an enrollment that isn't the caller's reads as not found.
-- No existing data changes.

create or replace function public.get_withdrawn_student_records(p_enrollment_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  _withdrawn_at timestamptz;
begin
  select e.withdrawn_at into _withdrawn_at from public.enrollment e where e.id = p_enrollment_id;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'P0002';
  end if;
  if _withdrawn_at is null then
    raise exception 'enrollment % is not withdrawn', p_enrollment_id using errcode = '22023';
  end if;

  return jsonb_build_object(
    'scores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assessment', a.title, 'date', coalesce(a.due_date, a.date_assigned),
               'score_mode', a.score_mode, 'max_points', a.max_points,
               'value', sc.value, 'status', sc.status, 'comment', sc.comment)
             order by coalesce(a.due_date, a.date_assigned), a.title)
        from public.score sc
        join public.assessment a on a.id = sc.assessment_id
       where sc.enrollment_id = p_enrollment_id), '[]'::jsonb),
    'tag_scores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assessment', a.title, 'date', coalesce(a.due_date, a.date_assigned),
               'code', t.code, 'competency', t.label,
               'value', ts.value, 'modifier', ts.modifier)
             order by coalesce(a.due_date, a.date_assigned), a.title, t.label)
        from public.tag_score ts
        join public.assessment a on a.id = ts.assessment_id
        join public.tag t on t.id = ts.tag_id
       where ts.enrollment_id = p_enrollment_id), '[]'::jsonb),
    'rubric_scores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assessment', a.title, 'date', coalesce(a.due_date, a.date_assigned),
               'criterion', c.name, 'value', rs.value, 'modifier', rs.modifier, 'comment', rs.comment)
             order by coalesce(a.due_date, a.date_assigned), a.title, c.display_order)
        from public.rubric_score rs
        join public.assessment a on a.id = rs.assessment_id
        join public.criterion c on c.id = rs.criterion_id
       where rs.enrollment_id = p_enrollment_id), '[]'::jsonb),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', o.created_at, 'sentiment', o.sentiment, 'context', o.context_type, 'body', o.body)
             order by o.created_at)
        from public.observation o
        join public.observation_student os on os.observation_id = o.id
       where os.enrollment_id = p_enrollment_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_withdrawn_student_records(uuid) from public, anon;
grant execute on function public.get_withdrawn_student_records(uuid) to authenticated;
