-- Each class can name its block (A–E, X, or a short label such as "Lunch
-- club"), so two sections of the same course are told apart in every class
-- picker and on printed sheets. Before this, the class name was the only
-- clue, and Duplicate Class produced "Philosophy 12 (Copy)".
--
-- course.block is optional free text, 1–24 characters. update_course takes it
-- in the patch, create_course takes p_block, and list_teacher_courses returns
-- it. Bodies copied from the live database on 2026-10-19.

alter table public.course
  add column if not exists block text
  constraint course_block_len check (block is null or char_length(block) between 1 and 24);

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
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;

-- A new parameter and a new result column need drop + create.
drop function public.create_course(text, text, text, text, text, text, numeric, text, text, text[], uuid);

create function public.create_course(
    p_name text,
    p_grade_level text default null,
    p_description text default null,
    p_color text default null,
    p_grading_system text default 'proficiency',
    p_calc_method text default 'average',
    p_decay_weight numeric default null,
    p_timezone text default 'America/Vancouver',
    p_late_work_policy text default null,
    p_subjects text[] default null,
    p_idempotency_key uuid default null,
    p_block text default null)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _uid       uuid := (select auth.uid());
    _course_id uuid;
    _i         int;
    _cached    jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'create_course');
    if _cached is not null then return (_cached->>'id')::uuid; end if;

    insert into course (teacher_id, name, grade_level, description, color,
        grading_system, calc_method, decay_weight, timezone, late_work_policy, block)
    values (_uid, p_name, p_grade_level, p_description, p_color,
        p_grading_system, p_calc_method, p_decay_weight, p_timezone, p_late_work_policy,
        nullif(btrim(p_block), ''))
    returning id into _course_id;

    insert into report_config (course_id) values (_course_id);

    if p_subjects is not null then
        for _i in 1 .. array_length(p_subjects, 1) loop
            insert into subject (course_id, name, display_order)
            values (_course_id, p_subjects[_i], _i - 1);
        end loop;
    end if;

    insert into teacher_preference (teacher_id, active_course_id)
    values (_uid, _course_id)
    on conflict (teacher_id) do update set active_course_id = excluded.active_course_id;

    perform fv_idem_store(p_idempotency_key, 'create_course', jsonb_build_object('id', _course_id));
    return _course_id;
end;
$function$;

drop function public.list_teacher_courses();

create function public.list_teacher_courses()
 returns table(id uuid, name text, grade_level text, description text, color text, is_archived boolean,
               display_order integer, grading_system text, calc_method text, decay_weight numeric,
               timezone text, late_work_policy text, created_at timestamp with time zone,
               updated_at timestamp with time zone, block text)
 language sql
 stable
 set search_path to 'public'
as $function$
    select c.id, c.name, c.grade_level, c.description, c.color,
           c.is_archived, c.display_order, c.grading_system, c.calc_method,
           c.decay_weight, c.timezone, c.late_work_policy,
           c.created_at, c.updated_at, c.block
      from course c
     where c.teacher_id = (select auth.uid())
       and c.deleted_at is null
     order by c.is_archived asc, c.display_order asc, c.created_at asc;
$function$;

-- Same grants as before: authenticated only, never anon or public.
revoke all on function public.create_course(text, text, text, text, text, text, numeric, text, text, text[], uuid, text) from public, anon;
grant execute on function public.create_course(text, text, text, text, text, text, numeric, text, text, text[], uuid, text) to authenticated, service_role;
revoke all on function public.list_teacher_courses() from public, anon;
grant execute on function public.list_teacher_courses() to authenticated, service_role;
