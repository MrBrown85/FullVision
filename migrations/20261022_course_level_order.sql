-- Rubric Levels: each class decides whether the four proficiency levels run
-- Extending → Emerging or Emerging → Extending everywhere the class draws
-- them (scoring cards, the rubric editor, printed rubrics, reports, the
-- phone). Before this, desktop scoring cards and printed rubrics ran
-- Extending first while the phone grading tab, observation capture and the
-- report questionnaire ran Emerging first, so a teacher saw both orders in
-- one class.
--
-- course.level_order: 'desc' = Extending first (left or top), today's look
-- and the default; 'asc' = Emerging first. update_course takes it in the
-- patch. get_class_bundle already returns the course row with to_jsonb, so
-- the column reaches the client without a change there; the client reads a
-- missing level_order as 'desc'. update_course body copied from the live
-- database on 2026-10-22.

alter table public.course
  add column if not exists level_order text not null default 'desc'
  constraint course_level_order_check check (level_order in ('asc', 'desc'));

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
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;
