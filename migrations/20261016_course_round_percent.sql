-- A class can show its course % as a whole number (2026-10-16,
-- docs/grading-compliance-plan.md D6, like Schoology's rounding setting).
--
--   round_percent  true: whole number (86%), false: one decimal (85.9%),
--                  null: never chosen, so the client follows the grade
--                  level (whole numbers for grades 10–12, as BC report
--                  cards show).
--
-- Written through update_course; a JSON null in the patch clears it.
-- get_class_bundle already returns the whole course row (gradebook.course),
-- so it needs no change. course already has
-- course_sync_cursor_course_gradebook, so a change reaches other devices.

alter table public.course add column if not exists round_percent boolean;

comment on column public.course.round_percent is
    'Show the course % as a whole number. Null: not chosen; whole numbers for grades 10-12.';

-- As in 20261015_course_grading_config.sql, plus round_percent.
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
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;
