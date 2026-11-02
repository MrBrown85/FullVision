-- Folders Count as One (2026-11-02). A class's overall proficiency averages
-- each folder (competency_group) first and counts it as one competency.
-- Teachers can now turn that off for the class, or for one folder:
--
--   course.folders_count_as_one          true: folders count as one (the
--                                        default, and today's math).
--                                        false: the overall is the plain mean
--                                        of every competency.
--   competency_group.counts_as_one       used while the class is on. true:
--                                        this folder is averaged first.
--                                        false: its competencies count one
--                                        by one.
--
-- Both default true, so no grade changes. update_course takes the class
-- value in its patch. upsert_competency_group takes p_counts_as_one; null
-- keeps the folder's value, so a client that doesn't send it changes
-- nothing. Its old signature is dropped here so PostgREST has one function
-- to choose (PGRST203, migrations/20260428_drop_legacy_non_idempotent_overloads.sql).
-- get_learning_map and get_class_bundle return the folder value;
-- get_class_bundle returns the whole course row, so the class value comes
-- with it. duplicate_course copies both. Both tables already have
-- sync-cursor triggers.

alter table public.course
  add column if not exists folders_count_as_one boolean not null default true;
comment on column public.course.folders_count_as_one is
    'Overall proficiency averages each folder first and counts it as one competency. False: the plain mean of every competency.';

alter table public.competency_group
  add column if not exists counts_as_one boolean not null default true;
comment on column public.competency_group.counts_as_one is
    'While the class counts folders as one: true averages this folder first; false counts its competencies one by one.';

drop function if exists public.upsert_competency_group(uuid, uuid, text, text, integer, uuid);

create or replace function public.upsert_competency_group(
    p_id uuid,
    p_course_id uuid,
    p_name text,
    p_color text default null,
    p_display_order integer default null,
    p_idempotency_key uuid default null,
    p_counts_as_one boolean default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_competency_group');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into competency_group (course_id, name, color, display_order, counts_as_one)
        values (p_course_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from competency_group where course_id = p_course_id)),
                coalesce(p_counts_as_one, true))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_competency_group', jsonb_build_object('id', _id));
    else
        update competency_group set name = p_name, color = p_color,
            display_order = coalesce(p_display_order, display_order),
            counts_as_one = coalesce(p_counts_as_one, counts_as_one),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'competency_group not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

revoke all on function public.upsert_competency_group(uuid, uuid, text, text, integer, uuid, boolean) from public, anon;
grant execute on function public.upsert_competency_group(uuid, uuid, text, text, integer, uuid, boolean) to authenticated, service_role;

do $patch$
declare
    _def text;
    _new text;
    _n int;
begin
    -- update_course: the class value.
    _def := pg_get_functiondef('public.update_course(uuid, jsonb)'::regprocedure);
    _new := replace(_def,
        $s$        level_order      = coalesce(p_patch->>'level_order',      level_order),$s$,
        $s$        level_order      = coalesce(p_patch->>'level_order',      level_order),
        folders_count_as_one = case when p_patch ? 'folders_count_as_one'
                                then coalesce((p_patch->>'folders_count_as_one')::boolean, true)
                                else folders_count_as_one end,$s$);
    if _new = _def then raise exception 'update_course: level_order assignment not found'; end if;
    execute _new;

    -- get_learning_map: the folder value.
    _def := pg_get_functiondef('public.get_learning_map(uuid)'::regprocedure);
    _new := replace(_def,
        $s$'display_order', cg.display_order
           ) order by cg.display_order, cg.name)$s$,
        $s$'display_order', cg.display_order,
             'counts_as_one', cg.counts_as_one
           ) order by cg.display_order, cg.name)$s$);
    if _new = _def then raise exception 'get_learning_map: competency_groups object not found'; end if;
    execute _new;

    -- get_class_bundle: the folder value.
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$'display_order', cg.display_order)
                             order by cg.display_order, cg.name)$s$,
        $s$'display_order', cg.display_order,
                                                'counts_as_one', cg.counts_as_one)
                             order by cg.display_order, cg.name)$s$);
    if _new = _def then raise exception 'get_class_bundle: competency_groups object not found'; end if;
    execute _new;

    -- duplicate_course: both values.
    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$                        decay_weight, timezone, late_work_policy)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy$s$,
        $s$                        decay_weight, timezone, late_work_policy, folders_count_as_one)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy, folders_count_as_one$s$);
    if _new = _def then raise exception 'duplicate_course: course insert not found'; end if;
    _def := _new;
    _new := replace(_def,
        $s$        insert into competency_group (id, course_id, name, color, display_order)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order);$s$,
        $s$        insert into competency_group (id, course_id, name, color, display_order, counts_as_one)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order, _row.counts_as_one);$s$);
    if _new = _def then raise exception 'duplicate_course: competency_group insert not found'; end if;
    execute _new;

    select count(*) into _n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_competency_group';
    if _n <> 1 then raise exception 'upsert_competency_group: expected 1 overload, found %', _n; end if;
end
$patch$;
