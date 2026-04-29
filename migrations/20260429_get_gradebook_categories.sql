-- ============================================================================
-- migration: 20260429_get_gradebook_categories
--
-- get_gradebook is the single bootstrap RPC; everything that reads category
-- weights on the client (assignment form, gradebook, reports, calc.js) goes
-- through _cache.categories which is only populated from this payload. The
-- function did not return categories, so the cache was always empty after
-- sign-in, regardless of what's in the `category` table — and the
-- assignment-form dropdown showed only "No Category" even when categories
-- existed in the database.
--
-- This migration adds a `categories` field to the returned jsonb. The
-- existing course / students / assessments / cells / row_summaries SELECTs
-- are preserved verbatim from the prior definition; only the new
-- declaration, the new SELECT, and the additional jsonb_build_object line
-- are additions.
-- ============================================================================

create or replace function public.get_gradebook(p_course_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
    course_row course%rowtype;
    students jsonb;
    assessments jsonb;
    categories jsonb;
    cells jsonb;
    summaries jsonb;
begin
    select * into course_row from course where id = p_course_id;
    if not found then raise exception 'course not found or not owned'; end if;

    select jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id, 'student_id', s.id,
               'first_name', s.first_name, 'last_name', s.last_name,
               'roster_position', e.roster_position, 'is_flagged', e.is_flagged
           ) order by e.roster_position)
      into students
      from enrollment e join student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is null;

    select jsonb_agg(jsonb_build_object(
               'id', a.id, 'title', a.title, 'category_id', a.category_id,
               'score_mode', a.score_mode, 'max_points', a.max_points,
               'has_rubric', a.rubric_id is not null,
               'date_assigned', a.date_assigned, 'due_date', a.due_date,
               'display_order', a.display_order
           ) order by a.display_order)
      into assessments
      from assessment a where a.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', cat.id, 'name', cat.name,
               'weight', cat.weight, 'display_order', cat.display_order
           ) order by cat.display_order)
      into categories
      from category cat where cat.course_id = p_course_id;

    with pairs as (
        select e.id as eid, a.id as aid,
               fv_assessment_overall(e.id, a.id) as ov
          from enrollment e cross join assessment a
         where e.course_id = p_course_id and e.withdrawn_at is null
           and a.course_id = p_course_id
    )
    select jsonb_object_agg(eid, cells_per_student)
      into cells
      from (
        select eid, jsonb_object_agg(
                       aid,
                       jsonb_build_object(
                           'kind', (ov).kind, 'value', (ov).value,
                           'score', (
                               select jsonb_build_object('value', sc.value,
                                                         'status', sc.status,
                                                         'comment', sc.comment)
                                 from score sc
                                where sc.enrollment_id = p.eid
                                  and sc.assessment_id = p.aid
                           )
                       )
                   ) as cells_per_student
          from pairs p group by eid
      ) x;

    select jsonb_object_agg(
               e.id,
               jsonb_build_object(
                   'letter', case when course_row.grading_system in ('letter','both')
                       then fv_course_letter_pipeline(e.id, p_course_id) else null end,
                   'overall_proficiency', case when course_row.grading_system in ('proficiency','both')
                       then fv_overall_proficiency(e.id, p_course_id) else null end,
                   'counts', fv_status_counts(e.id, p_course_id)
               )
           )
      into summaries
      from enrollment e
     where e.course_id = p_course_id and e.withdrawn_at is null;

    return jsonb_build_object(
        'course', to_jsonb(course_row),
        'students', coalesce(students, '[]'::jsonb),
        'assessments', coalesce(assessments, '[]'::jsonb),
        'categories', coalesce(categories, '[]'::jsonb),
        'cells', coalesce(cells, '{}'::jsonb),
        'row_summaries', coalesce(summaries, '{}'::jsonb)
    );
end;
$function$;
