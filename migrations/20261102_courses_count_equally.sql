-- Each Course Counts Equally (2026-11-02, curriculum bank stage 4, PR 2).
-- A combined class (Humanities 8 = ELA 8 + SS 8) rolled every competency
-- into one overall, so the course with more competencies or folders
-- outweighed the other: ELA 8's 20 competencies were 71% of the overall with
-- Folders Count as One off, and SS 8's 8 were 80% with it on.
--
--   course.courses_count_equally   false: today's math (the default).
--                                  true: each course (subject) is rolled up
--                                  on its own, then the courses are
--                                  averaged.
--
-- Defaults false, so no grade changes. update_course takes it in its patch;
-- get_class_bundle returns the whole course row, so it comes with it;
-- duplicate_course copies it. course already has a sync-cursor trigger.

alter table public.course
  add column if not exists courses_count_equally boolean not null default false;
comment on column public.course.courses_count_equally is
    'Overall proficiency rolls up each course (subject) on its own, then averages the courses. False: one roll-up across every competency.';

do $patch$
declare
    _def text;
    _new text;
begin
    -- update_course: the class value.
    _def := pg_get_functiondef('public.update_course(uuid, jsonb)'::regprocedure);
    _new := replace(_def,
        $s$folders_count_as_one = case when p_patch ? 'folders_count_as_one'
                                then coalesce((p_patch->>'folders_count_as_one')::boolean, true)
                                else folders_count_as_one end,$s$,
        $s$folders_count_as_one = case when p_patch ? 'folders_count_as_one'
                                then coalesce((p_patch->>'folders_count_as_one')::boolean, true)
                                else folders_count_as_one end,
        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,$s$);
    if _new = _def then raise exception 'update_course: folders_count_as_one assignment not found'; end if;
    execute _new;

    -- duplicate_course: copy it.
    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$                        decay_weight, timezone, late_work_policy, folders_count_as_one)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy, folders_count_as_one$s$,
        $s$                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally$s$);
    if _new = _def then raise exception 'duplicate_course: course insert not found'; end if;
    execute _new;
end
$patch$;
