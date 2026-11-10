-- GENERATED: the other RPCs that write a class's tables, for grade_return_race.py.
-- Each is copied whole and unchanged from the migration that last defined it.
-- Four have no migration (they date from the April design and were applied by
-- hand): those are copied from docs/backend-design/write-paths.sql and are NOT
-- checked against gradebook-prod. None of these is in live-function-md5.txt;
-- README.md, "Batch A", has the query that would fingerprint them.
-- Load after batch-a-prelude.sql.

-- create_assessment: migrations/20261027_assessment_core_competencies.sql
create function public.create_assessment(
    p_course_id             uuid,
    p_title                 text,
    p_category_id           uuid    default null,
    p_description           text    default null,
    p_date_assigned         date    default null,
    p_due_date              date    default null,
    p_score_mode            text    default 'proficiency',
    p_max_points            numeric default null,
    p_weight                numeric default 1.0,
    p_evidence_type         text    default null,
    p_rubric_id             uuid    default null,
    p_module_id             uuid    default null,
    p_tag_ids               uuid[]  default '{}',
    p_copy_group            uuid    default null,
    p_core_competency_ids   text[]  default '{}',
    p_idempotency_key       uuid    default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
    _id       uuid;
    _next_pos int;
    _tag      uuid;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = p_course_id
       and module_id is not distinct from p_module_id;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, display_order, copy_group, core_competency_ids)
    values (p_course_id, p_category_id, p_title, p_description, p_date_assigned, p_due_date,
            p_score_mode, p_max_points, p_weight, p_evidence_type,
            p_rubric_id, p_module_id, _next_pos, p_copy_group,
            array(select distinct c from unnest(coalesce(p_core_competency_ids, '{}')) c order by c))
    returning id into _id;

    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id)
              values (_id, _tag) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_assessment', jsonb_build_object('id', _id));
    return _id;
end; $$;

-- update_assessment: migrations/20261027_assessment_core_competencies.sql
create or replace function public.update_assessment(p_id uuid, p_patch jsonb, p_tag_ids uuid[] default null)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update assessment set
        title         = coalesce(p_patch->>'title', title),
        description   = case when p_patch ? 'description'   then p_patch->>'description'   else description end,
        category_id   = case when p_patch ? 'category_id'
                             then nullif(p_patch->>'category_id','')::uuid else category_id end,
        date_assigned = case when p_patch ? 'date_assigned'
                             then nullif(p_patch->>'date_assigned','')::date else date_assigned end,
        due_date      = case when p_patch ? 'due_date'
                             then nullif(p_patch->>'due_date','')::date else due_date end,
        score_mode    = coalesce(p_patch->>'score_mode', score_mode),
        max_points    = case when p_patch ? 'max_points'
                             then nullif(p_patch->>'max_points','')::numeric else max_points end,
        weight        = coalesce((p_patch->>'weight')::numeric, weight),
        evidence_type = case when p_patch ? 'evidence_type' then p_patch->>'evidence_type' else evidence_type end,
        rubric_id     = case when p_patch ? 'rubric_id'
                             then nullif(p_patch->>'rubric_id','')::uuid else rubric_id end,
        module_id     = case when p_patch ? 'module_id'
                             then nullif(p_patch->>'module_id','')::uuid else module_id end,
        display_order = case when p_patch ? 'display_order'
                             then (p_patch->>'display_order')::int else display_order end,
        copy_group    = case when p_patch ? 'copy_group'
                             then nullif(p_patch->>'copy_group','')::uuid else copy_group end,
        core_competency_ids = case
                             when not (p_patch ? 'core_competency_ids') then core_competency_ids
                             when jsonb_typeof(p_patch->'core_competency_ids') = 'array'
                             then array(select distinct c
                                          from jsonb_array_elements_text(p_patch->'core_competency_ids') c
                                         order by c)
                             else '{}' end,
        updated_at    = now()
    where id = p_id;

    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    if p_tag_ids is not null then
        delete from assessment_tag where assessment_id = p_id;
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag)
            on conflict do nothing;
        end loop;
    end if;
end; $function$;

-- delete_assessment: docs/backend-design/write-paths.sql
create or replace function delete_assessment(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from assessment where id = p_id;
    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;
end; $$;

-- save_assessment_tags: docs/backend-design/write-paths.sql
create or replace function save_assessment_tags(p_id uuid, p_tag_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not exists (select 1 from assessment where id = p_id) then
        raise exception 'assessment not found' using errcode = 'P0002';
    end if;
    delete from assessment_tag where assessment_id = p_id;
    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag) on conflict do nothing;
        end loop;
    end if;
end; $$;

-- upsert_rubric: migrations/20261103_rubric_whole_competencies.sql
create or replace function public.upsert_rubric(
    p_id uuid,
    p_course_id uuid,
    p_name text,
    p_criteria jsonb,
    p_copy_group uuid default null,
    p_idempotency_key uuid default null,
    p_style text default null,
    p_linked_tag_ids jsonb default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
    _rubric_id   uuid;
    _elem        jsonb;
    _crit_id     uuid;
    _kept_ids    uuid[] := '{}';
    _tag_id      uuid;
    _cached      jsonb;
    _is_insert   boolean := false;
    _check       jsonb;
    _check_id    uuid;
    _kept_checks uuid[];
    _level       int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
        raise exception 'p_criteria must be a jsonb array' using errcode = '22023';
    end if;

    if p_style is not null and p_style not in ('standard', 'advanced', 'single_point') then
        raise exception 'p_style must be standard, advanced or single_point' using errcode = '22023';
    end if;

    if p_linked_tag_ids is not null and jsonb_typeof(p_linked_tag_ids) <> 'array' then
        raise exception 'p_linked_tag_ids must be a jsonb array' using errcode = '22023';
    end if;

    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_rubric');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;
        _is_insert := true;

        insert into rubric (course_id, name, copy_group, style)
        values (p_course_id, p_name, p_copy_group, coalesce(p_style, 'standard'))
        returning id into _rubric_id;
    else
        -- A copy group is only ever set, never cleared, by a save. A save
        -- that names no style keeps the rubric's.
        update rubric set name = p_name, copy_group = coalesce(p_copy_group, copy_group),
                          style = coalesce(p_style, style), updated_at = now()
         where id = p_id
        returning id into _rubric_id;

        if _rubric_id is null then
            raise exception 'rubric not found' using errcode = 'P0002';
        end if;
    end if;

    for _elem in select * from jsonb_array_elements(p_criteria) loop
        if _elem ? 'id' and nullif(_elem->>'id','') is not null then
            _crit_id := (_elem->>'id')::uuid;

            update criterion set
                name               = _elem->>'name',
                level_4_descriptor = _elem->>'level_4_descriptor',
                level_3_descriptor = _elem->>'level_3_descriptor',
                level_2_descriptor = _elem->>'level_2_descriptor',
                level_1_descriptor = _elem->>'level_1_descriptor',
                level_4_value      = coalesce((_elem->>'level_4_value')::numeric, 4),
                level_3_value      = coalesce((_elem->>'level_3_value')::numeric, 3),
                level_2_value      = coalesce((_elem->>'level_2_value')::numeric, 2),
                level_1_value      = coalesce((_elem->>'level_1_value')::numeric, 1),
                weight             = coalesce((_elem->>'weight')::numeric, 1.0),
                display_order      = coalesce((_elem->>'display_order')::int, 0),
                updated_at         = now()
            where id = _crit_id and rubric_id = _rubric_id;

            if not found then
                raise exception 'criterion % not in rubric %', _crit_id, _rubric_id
                    using errcode = 'P0002';
            end if;
        else
            insert into criterion (
                rubric_id, name,
                level_4_descriptor, level_3_descriptor,
                level_2_descriptor, level_1_descriptor,
                level_4_value, level_3_value, level_2_value, level_1_value,
                weight, display_order
            ) values (
                _rubric_id,
                _elem->>'name',
                _elem->>'level_4_descriptor', _elem->>'level_3_descriptor',
                _elem->>'level_2_descriptor', _elem->>'level_1_descriptor',
                coalesce((_elem->>'level_4_value')::numeric, 4),
                coalesce((_elem->>'level_3_value')::numeric, 3),
                coalesce((_elem->>'level_2_value')::numeric, 2),
                coalesce((_elem->>'level_1_value')::numeric, 1),
                coalesce((_elem->>'weight')::numeric, 1.0),
                coalesce((_elem->>'display_order')::int, 0)
            ) returning id into _crit_id;
        end if;

        _kept_ids := _kept_ids || _crit_id;

        delete from criterion_tag where criterion_id = _crit_id;
        if _elem ? 'linked_tag_ids' and jsonb_typeof(_elem->'linked_tag_ids') = 'array' then
            for _tag_id in
                select (v #>> '{}')::uuid
                  from jsonb_array_elements(_elem->'linked_tag_ids') v
            loop
                insert into criterion_tag (criterion_id, tag_id)
                values (_crit_id, _tag_id)
                on conflict do nothing;
            end loop;
        end if;

        -- Advanced Rubrics: the checkboxes in each level cell. A known id is
        -- updated so its ticks (rubric_check_score) survive a relabel; any
        -- other is a new row; rows left out are deleted with their ticks.
        if _elem ? 'checks' and jsonb_typeof(_elem->'checks') = 'array' then
            _kept_checks := '{}';
            for _check in select * from jsonb_array_elements(_elem->'checks') loop
                _level := (_check->>'level')::int;
                if _level is null or _level < 1 or _level > 4 then
                    raise exception 'check level must be 1..4' using errcode = '22023';
                end if;
                _check_id := null;
                if _check ? 'id' and nullif(_check->>'id','') is not null then
                    update criterion_check set
                        level         = _level,
                        label         = coalesce(_check->>'label', ''),
                        display_order = coalesce((_check->>'display_order')::int, 0),
                        updated_at    = now()
                     where id = (_check->>'id')::uuid and criterion_id = _crit_id
                    returning id into _check_id;
                end if;
                if _check_id is null then
                    insert into criterion_check (criterion_id, level, label, display_order)
                    values (_crit_id, _level, coalesce(_check->>'label', ''),
                            coalesce((_check->>'display_order')::int, 0))
                    returning id into _check_id;
                end if;
                _kept_checks := _kept_checks || _check_id;
            end loop;
            delete from criterion_check
             where criterion_id = _crit_id
               and id <> all (_kept_checks);
        end if;
    end loop;

    delete from criterion
     where rubric_id = _rubric_id
       and id <> all (_kept_ids);

    -- Competencies the whole rubric scores. Null keeps them; an array
    -- replaces them.
    if p_linked_tag_ids is not null then
        delete from rubric_tag where rubric_id = _rubric_id;
        insert into rubric_tag (rubric_id, tag_id)
        select _rubric_id, (v #>> '{}')::uuid
          from jsonb_array_elements(p_linked_tag_ids) v
        on conflict do nothing;
    end if;

    if _is_insert then
        perform fv_idem_store(p_idempotency_key, 'upsert_rubric', jsonb_build_object('id', _rubric_id));
    end if;
    return _rubric_id;
end;
$function$;

-- delete_rubric: docs/backend-design/write-paths.sql
create or replace function delete_rubric(p_id uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    delete from rubric where id = p_id;
    if not found then
        raise exception 'rubric not found' using errcode = 'P0002';
    end if;
end;
$$;

-- upsert_subject: migrations/20260423_write_path_idempotency_phase2.sql
create or replace function upsert_subject(
    p_id                uuid,
    p_course_id         uuid,
    p_name              text,
    p_color             text    default null,
    p_display_order     integer default null,
    p_idempotency_key   uuid    default null
) returns uuid
language plpgsql set search_path to 'public' as $$
declare
    _id uuid;
    _cached jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_subject');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into subject (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from subject where course_id = p_course_id)))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_subject', jsonb_build_object('id', _id));
    else
        update subject set
            name          = p_name,
            color         = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
         where id = p_id
        returning id into _id;
        if _id is null then raise exception 'subject not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end;
$$;

-- delete_subject: migrations/20261012_fix_score_writes_and_deletes.sql
create or replace function public.delete_subject(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from subject where id = p_id;
end; $function$;

-- upsert_competency_group: migrations/20261102_folders_count_as_one.sql
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

-- delete_competency_group: migrations/20261012_fix_score_writes_and_deletes.sql
create or replace function public.delete_competency_group(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    -- section.competency_group_id is ON DELETE SET NULL (composite FK, match simple).
    delete from competency_group where id = p_id;
end; $function$;

-- upsert_section: migrations/20260423_write_path_idempotency_phase2.sql
create or replace function upsert_section(
    p_id                     uuid,
    p_subject_id             uuid,
    p_name                   text,
    p_color                  text    default null,
    p_competency_group_id    uuid    default null,
    p_display_order          integer default null,
    p_idempotency_key        uuid    default null
) returns uuid
language plpgsql set search_path to 'public' as $$
declare
    _id        uuid;
    _course_id uuid;
    _cached    jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select course_id into _course_id from subject where id = p_subject_id;
    if _course_id is null then raise exception 'subject not found' using errcode = 'P0002'; end if;

    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_section');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into section (course_id, subject_id, competency_group_id, name, color, display_order)
        values (_course_id, p_subject_id, p_competency_group_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from section where subject_id = p_subject_id)))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_section', jsonb_build_object('id', _id));
    else
        update section set
            subject_id          = p_subject_id,
            course_id           = _course_id,
            competency_group_id = p_competency_group_id,
            name                = p_name,
            color               = p_color,
            display_order       = coalesce(p_display_order, display_order),
            updated_at          = now()
         where id = p_id
        returning id into _id;
        if _id is null then raise exception 'section not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end;
$$;

-- delete_section: migrations/20261012_fix_score_writes_and_deletes.sql
create or replace function public.delete_section(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from section where id = p_id;
end; $function$;

-- remove_section: migrations/20261022_soft_remove_competency.sql
create or replace function public.remove_section(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _at     timestamptz;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'remove_section');
    if _cached is not null then
        return _cached;
    end if;
    update section set removed_at = coalesce(removed_at, now()) where id = p_id returning removed_at into _at;
    if not found then
        raise exception 'section not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('section_id', p_id, 'removed_at', _at);
    perform fv_idem_store(p_idempotency_key, 'remove_section', _result);
    return _result;
end;
$function$;

-- restore_section: migrations/20261022_soft_remove_competency.sql
create or replace function public.restore_section(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'restore_section');
    if _cached is not null then
        return _cached;
    end if;
    update section set removed_at = null where id = p_id;
    if not found then
        raise exception 'section not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('section_id', p_id, 'removed_at', null);
    perform fv_idem_store(p_idempotency_key, 'restore_section', _result);
    return _result;
end;
$function$;

-- upsert_tag: migrations/20261102_tag_bank_id.sql
create or replace function public.upsert_tag(
    p_id uuid,
    p_section_id uuid,
    p_label text,
    p_code text default null,
    p_i_can_text text default null,
    p_display_order integer default null,
    p_idempotency_key uuid default null,
    p_i_can_statements text[] default null,
    p_source_text text default null,
    p_bank_id text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_tag');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into tag (section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values (p_section_id, p_code, p_label, p_i_can_text, coalesce(p_i_can_statements, '{}'), p_source_text, p_bank_id,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from tag where section_id = p_section_id)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_tag', jsonb_build_object('id', _id));
    else
        update tag set
            section_id = p_section_id, code = p_code, label = p_label,
            i_can_text = p_i_can_text,
            i_can_statements = coalesce(p_i_can_statements, i_can_statements),
            source_text = coalesce(p_source_text, source_text),
            bank_id = coalesce(p_bank_id, bank_id),
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'tag not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

-- delete_tag: migrations/20261012_fix_score_writes_and_deletes.sql
create or replace function public.delete_tag(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    delete from tag where id = p_id;
end; $function$;

-- create_student_and_enroll: migrations/20260423_write_path_idempotency.sql
create or replace function create_student_and_enroll(
    p_course_id             uuid,
    p_first_name            text,
    p_last_name             text    default null,
    p_preferred_name        text    default null,
    p_pronouns              text    default null,
    p_student_number        text    default null,
    p_email                 text    default null,
    p_date_of_birth         date    default null,
    p_designations          text[]  default '{}',
    p_existing_student_id   uuid    default null,
    p_idempotency_key       uuid    default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    _uid        uuid := (select auth.uid());
    _student_id uuid;
    _enroll_id  uuid;
    _next_pos   int;
    _cached     jsonb;
    _result     jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_student_and_enroll');
    if _cached is not null then
        return _cached;
    end if;

    if p_existing_student_id is not null then
        _student_id := p_existing_student_id;
    else
        insert into student (teacher_id, first_name, last_name, preferred_name,
                             pronouns, student_number, email, date_of_birth)
        values (_uid, p_first_name, p_last_name, p_preferred_name,
                p_pronouns, p_student_number, p_email, p_date_of_birth)
        returning id into _student_id;
    end if;

    select coalesce(max(roster_position) + 1, 0) into _next_pos
      from enrollment
     where course_id = p_course_id;

    insert into enrollment (student_id, course_id, designations, roster_position)
    values (_student_id, p_course_id, coalesce(p_designations, '{}'), _next_pos)
    returning id into _enroll_id;

    _result := jsonb_build_object('student_id', _student_id, 'enrollment_id', _enroll_id);
    perform fv_idem_store(p_idempotency_key, 'create_student_and_enroll', _result);
    return _result;
end; $$;

-- update_enrollment: docs/backend-design/write-paths.sql
create or replace function update_enrollment(p_id uuid, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare _desig text[];
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_patch ? 'designations' and jsonb_typeof(p_patch->'designations') = 'array' then
        select array_agg(v #>> '{}') into _desig from jsonb_array_elements(p_patch->'designations') v;
    end if;
    update enrollment set
        designations    = case when p_patch ? 'designations'    then coalesce(_desig, '{}') else designations end,
        is_flagged      = case when p_patch ? 'is_flagged'      then (p_patch->>'is_flagged')::boolean else is_flagged end,
        roster_position = case when p_patch ? 'roster_position' then (p_patch->>'roster_position')::int else roster_position end,
        withdrawn_at    = case when p_patch ? 'withdrawn_at'
                               then nullif(p_patch->>'withdrawn_at', '')::timestamptz
                               else withdrawn_at end,
        updated_at      = now()
    where id = p_id;
    if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
end; $$;

-- withdraw_student: migrations/20261019_withdraw_students.sql
create or replace function public.withdraw_student(p_enrollment_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _at     timestamptz;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'withdraw_student');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    update enrollment
       set withdrawn_at = coalesce(withdrawn_at, now()),
           updated_at = now()
     where id = p_enrollment_id
    returning withdrawn_at into _at;

    if not found then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('enrollment_id', p_enrollment_id, 'withdrawn_at', _at);
    perform fv_idem_store(p_idempotency_key, 'withdraw_student', _result);
    return _result;
end;
$function$;

-- reenrol_student: migrations/20261019_withdraw_students.sql
create or replace function public.reenrol_student(p_enrollment_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'reenrol_student');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    update enrollment
       set withdrawn_at = null,
           updated_at = now()
     where id = p_enrollment_id;

    if not found then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('enrollment_id', p_enrollment_id);
    perform fv_idem_store(p_idempotency_key, 'reenrol_student', _result);
    return _result;
end;
$function$;

-- delete_withdrawn_student: migrations/20261019_withdraw_students.sql
create or replace function public.delete_withdrawn_student(p_enrollment_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached       jsonb;
    _student_id   uuid;
    _withdrawn_at timestamptz;
    _obs_ids      uuid[];
    _obs_deleted  int := 0;
    _student_gone boolean := false;
    _result       jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_withdrawn_student');
    if _cached is not null then
        return _cached;
    end if;

    if not fv_owns_enrollment(p_enrollment_id) then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;

    select student_id, withdrawn_at into _student_id, _withdrawn_at
      from enrollment where id = p_enrollment_id
       for update;
    if not found then
        raise exception 'enrollment not found' using errcode = 'P0002';
    end if;
    if _withdrawn_at is null then
        raise exception 'withdraw the student before deleting them' using errcode = '55000';
    end if;

    -- Observations about this student; the ones left about no one go too.
    select coalesce(array_agg(observation_id), '{}') into _obs_ids
      from observation_student where enrollment_id = p_enrollment_id;

    delete from enrollment where id = p_enrollment_id;

    delete from observation o
     where o.id = any(_obs_ids)
       and not exists (select 1 from observation_student os where os.observation_id = o.id);
    get diagnostics _obs_deleted = row_count;

    delete from student s
     where s.id = _student_id
       and not exists (select 1 from enrollment e where e.student_id = s.id);
    _student_gone := found;

    _result := jsonb_build_object(
        'enrollment_id', p_enrollment_id,
        'student_deleted', _student_gone,
        'observations_deleted', _obs_deleted
    );
    perform fv_idem_store(p_idempotency_key, 'delete_withdrawn_student', _result);
    return _result;
end;
$function$;

-- As their migrations grant them.
grant execute on function public.create_assessment to authenticated;
grant execute on function public.update_assessment to authenticated;
grant execute on function public.delete_assessment to authenticated;
grant execute on function public.save_assessment_tags to authenticated;
grant execute on function public.upsert_rubric to authenticated;
grant execute on function public.delete_rubric to authenticated;
grant execute on function public.upsert_subject to authenticated;
grant execute on function public.delete_subject to authenticated;
grant execute on function public.upsert_competency_group to authenticated;
grant execute on function public.delete_competency_group to authenticated;
grant execute on function public.upsert_section to authenticated;
grant execute on function public.delete_section to authenticated;
grant execute on function public.remove_section to authenticated;
grant execute on function public.restore_section to authenticated;
grant execute on function public.upsert_tag to authenticated;
grant execute on function public.delete_tag to authenticated;
grant execute on function public.create_student_and_enroll to authenticated;
grant execute on function public.update_enrollment to authenticated;
grant execute on function public.withdraw_student to authenticated;
grant execute on function public.reenrol_student to authenticated;
grant execute on function public.delete_withdrawn_student to authenticated;
