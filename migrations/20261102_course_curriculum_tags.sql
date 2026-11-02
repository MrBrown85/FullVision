-- A class's BC curriculum link is saved on the server (2026-11-02).
--
-- What broke: the BC Curriculum Link card's courses (course.curriculumTags,
-- e.g. ['HIST12']) were saved only in the browser. updateCourse never sent
-- them to update_course and list_teacher_courses never returned them, so a
-- class linked on one device showed no link on another, and Re-link there
-- had nothing to compare against. This is decision 13 of the curriculum
-- bank plan (the class's linked courses live on the server).
--
-- What changes:
--   - course.curriculum_tags text[]: the bank course keys the class is
--     linked to, in order. Null means never saved, which lets a device that
--     holds a link from before this migration send it up once.
--   - update_course accepts p_patch.curriculum_tags (a JSON array of
--     strings; null or [] clears the link). It still runs as the caller,
--     under the course RLS policy.
--   - list_teacher_courses returns curriculum_tags. Its return type changes,
--     so it is dropped and created again with the same grants.
-- get_class_bundle returns to_jsonb(course), so it carries the new column
-- with no change. No data changes.

begin;

alter table public.course add column if not exists curriculum_tags text[];

create or replace function public.update_course(p_course_id uuid, p_patch jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course set
        name             = coalesce(p_patch->>'name',             name),
        grade_level      = coalesce(p_patch->>'grade_level',      grade_level),
        description      = case when p_patch ? 'description'
                                then p_patch->>'description'
                                else description end,
        color            = case when p_patch ? 'color'
                                then p_patch->>'color'
                                else color end,
        block            = case when p_patch ? 'block'
                                then nullif(btrim(p_patch->>'block'), '')
                                else block end,
        grading_system   = coalesce(p_patch->>'grading_system',   grading_system),
        calc_method      = coalesce(p_patch->>'calc_method',      calc_method),
        decay_weight     = case when p_patch ? 'decay_weight'
                                then (p_patch->>'decay_weight')::numeric
                                else decay_weight end,
        timezone         = coalesce(p_patch->>'timezone',         timezone),
        late_work_policy = case when p_patch ? 'late_work_policy'
                                then p_patch->>'late_work_policy'
                                else late_work_policy end,
        grading_scale    = case when p_patch ? 'grading_scale'
                                then nullif(p_patch->'grading_scale', 'null'::jsonb)
                                else grading_scale end,
        category_weights = case when p_patch ? 'category_weights'
                                then nullif(p_patch->'category_weights', 'null'::jsonb)
                                else category_weights end,
        round_percent    = case when p_patch ? 'round_percent'
                                then (p_patch->>'round_percent')::boolean
                                else round_percent end,
        reporting_terms  = case when p_patch ? 'reporting_terms'
                                then nullif(p_patch->'reporting_terms', 'null'::jsonb)
                                else reporting_terms end,
        recent_score_limit = case when p_patch ? 'recent_score_limit'
                                then (p_patch->>'recent_score_limit')::smallint
                                else recent_score_limit end,
        level_order      = coalesce(p_patch->>'level_order',      level_order),
        curriculum_tags  = case when p_patch ? 'curriculum_tags'
                                then case when jsonb_typeof(p_patch->'curriculum_tags') = 'array'
                                          then array(select jsonb_array_elements_text(p_patch->'curriculum_tags'))
                                          else null end
                                else curriculum_tags end,
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;

drop function public.list_teacher_courses();

create function public.list_teacher_courses()
 returns table(id uuid, name text, grade_level text, description text, color text, is_archived boolean,
               display_order integer, grading_system text, calc_method text, decay_weight numeric,
               timezone text, late_work_policy text, created_at timestamp with time zone,
               updated_at timestamp with time zone, block text, curriculum_tags text[])
 language sql
 stable
 set search_path to 'public'
as $function$
    select c.id, c.name, c.grade_level, c.description, c.color,
           c.is_archived, c.display_order, c.grading_system, c.calc_method,
           c.decay_weight, c.timezone, c.late_work_policy,
           c.created_at, c.updated_at, c.block, c.curriculum_tags
      from course c
     where c.teacher_id = (select auth.uid())
       and c.deleted_at is null
     order by c.is_archived asc, c.display_order asc, c.created_at asc;
$function$;

revoke all on function public.list_teacher_courses() from public, anon;
grant execute on function public.list_teacher_courses() to authenticated, service_role;

commit;
