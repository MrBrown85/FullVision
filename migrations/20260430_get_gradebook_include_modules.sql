-- migration: 20260430_get_gradebook_include_modules
-- Purpose:
--   Include the course's module list in get_gradebook so login/hydration
--   restores modules after sign-out wipes localStorage. Module writes
--   already round-trip to Supabase via upsert_module/delete_module, but
--   the read path was never wired — modules survived only in localStorage,
--   so signOut() effectively destroyed them.

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
    modules jsonb;
    cells jsonb;
    summaries jsonb;
begin
    select * into course_row from course where id = p_course_id;
    if not found then raise exception 'course not found or not owned'; end if;

    select jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student_id', s.id,
               'first_name', s.first_name,
               'last_name', s.last_name,
               'preferred_name', s.preferred_name,
               'pronouns', s.pronouns,
               'student_number', s.student_number,
               'email', s.email,
               'date_of_birth', s.date_of_birth,
               'designations', e.designations,
               'enrolled_at', e.enrolled_at,
               'roster_position', e.roster_position,
               'is_flagged', e.is_flagged
           ) order by e.roster_position, s.last_name, s.first_name)
      into students
      from enrollment e join student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is null;

    select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'title', a.title,
               'description', a.description,
               'category_id', a.category_id,
               'score_mode', a.score_mode,
               'max_points', a.max_points,
               'weight', a.weight,
               'evidence_type', a.evidence_type,
               'rubric_id', a.rubric_id,
               'module_id', a.module_id,
               'collab_mode', a.collab_mode,
               'collab_config', a.collab_config,
               'has_rubric', a.rubric_id is not null,
               'date_assigned', a.date_assigned,
               'due_date', a.due_date,
               'display_order', a.display_order,
               'tag_ids', coalesce((
                   select jsonb_agg(at.tag_id order by t.display_order, t.label)
                     from assessment_tag at
                     join tag t on t.id = at.tag_id
                    where at.assessment_id = a.id
               ), '[]'::jsonb)
           ) order by a.display_order, a.created_at)
      into assessments
      from assessment a where a.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', cat.id, 'name', cat.name,
               'weight', cat.weight, 'display_order', cat.display_order
           ) order by cat.display_order)
      into categories
      from category cat where cat.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'course_id', m.course_id,
               'name', m.name,
               'color', m.color,
               'display_order', m.display_order,
               'created_at', m.created_at,
               'updated_at', m.updated_at
           ) order by m.display_order)
      into modules
      from module m where m.course_id = p_course_id;

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
                               select jsonb_build_object(
                                          'id', sc.id,
                                          'value', sc.value,
                                          'status', sc.status,
                                          'comment', sc.comment,
                                          'scored_at', sc.scored_at,
                                          'updated_at', sc.updated_at
                                      )
                                 from score sc
                                where sc.enrollment_id = p.eid
                                  and sc.assessment_id = p.aid
                           ),
                           'tag_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'tag_id', ts.tag_id,
                                          'value', ts.value
                                      ) order by ts.tag_id)
                                 from tag_score ts
                                where ts.enrollment_id = p.eid
                                  and ts.assessment_id = p.aid
                           ), '[]'::jsonb),
                           'rubric_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'criterion_id', rs.criterion_id,
                                          'value', rs.value
                                      ) order by rs.criterion_id)
                                 from rubric_score rs
                                where rs.enrollment_id = p.eid
                                  and rs.assessment_id = p.aid
                           ), '[]'::jsonb)
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
        'modules', coalesce(modules, '[]'::jsonb),
        'cells', coalesce(cells, '{}'::jsonb),
        'row_summaries', coalesce(summaries, '{}'::jsonb)
    );
end;
$function$;
