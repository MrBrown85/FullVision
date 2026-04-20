-- FullVision v2 — Write-path RPCs (design artifact)
--
-- Mirror of what has been deployed to gradebook-prod.
-- Each section corresponds to one Phase 1.x task in HANDOFF.md.
-- Append new RPCs here as each phase lands.
--
-- Applied migrations (in order):
--   fullvision_v2_write_path_auth_bootstrap   (2026-04-19)
--   fullvision_v2_write_path_course_crud      (2026-04-19)
--   fullvision_v2_write_path_category_module_rubric (2026-04-19)

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.1 — Auth / bootstrap RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- bootstrap_teacher(p_email text, p_display_name text DEFAULT NULL) → jsonb
--
-- Called by the client on every sign-in. On first verified sign-in, creates:
--   • teacher row (id = auth.uid())
--   • teacher_preference row (defaults)
--   • "Welcome Class" course + report_config row
--     (Phase 5.1 will inject full demo-seed data into this course)
-- On subsequent sign-ins, returns existing teacher + preferences.
-- If teacher.deleted_at IS NOT NULL (soft-deleted, within 30-day grace window),
-- returns the teacher with deleted_at set so the client can prompt restoration.
--
-- Return shape:
--   {
--     id, email, display_name, created_at, deleted_at,
--     preferences: { active_course_id, view_mode, mobile_view_mode,
--                    mobile_sort_mode, card_widget_config }
--   }
create or replace function bootstrap_teacher(
    p_email        text,
    p_display_name text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid        uuid := (select auth.uid());
    _teacher    teacher%rowtype;
    _prefs      teacher_preference%rowtype;
    _course_id  uuid;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- Load existing teacher (including soft-deleted, within grace window).
    select * into _teacher from teacher where id = _uid;

    if not found then
        -- ── First verified sign-in ─────────────────────────────────────────
        insert into teacher (id, email, display_name)
        values (_uid, p_email, p_display_name)
        returning * into _teacher;

        insert into teacher_preference (teacher_id)
        values (_uid)
        returning * into _prefs;

        -- Welcome Class: bare course.  Phase 5.1 injects full demo-seed data.
        insert into course (teacher_id, name, grade_level, grading_system, calc_method, timezone)
        values (_uid, 'Welcome Class', '8', 'proficiency', 'average', 'America/Vancouver')
        returning id into _course_id;

        insert into report_config (course_id) values (_course_id);

        update teacher_preference
           set active_course_id = _course_id
         where teacher_id = _uid
        returning * into _prefs;

    else
        -- ── Returning sign-in ──────────────────────────────────────────────
        select * into _prefs from teacher_preference where teacher_id = _uid;

        -- Guard against partial bootstraps from a prior failed transaction.
        if not found then
            insert into teacher_preference (teacher_id)
            values (_uid)
            returning * into _prefs;
        end if;
    end if;

    return jsonb_build_object(
        'id',           _teacher.id,
        'email',        _teacher.email,
        'display_name', _teacher.display_name,
        'created_at',   _teacher.created_at,
        'deleted_at',   _teacher.deleted_at,
        'preferences',  jsonb_build_object(
            'active_course_id',   _prefs.active_course_id,
            'view_mode',          _prefs.view_mode,
            'mobile_view_mode',   _prefs.mobile_view_mode,
            'mobile_sort_mode',   _prefs.mobile_sort_mode,
            'card_widget_config', _prefs.card_widget_config
        )
    );
end;
$$;


-- soft_delete_teacher() → void
--
-- Marks the calling teacher's account for deletion (30-day grace window).
-- Called by the client after the teacher confirms deletion with their password.
-- The scheduled cleanup job (Phase 1.12) hard-deletes rows where
-- deleted_at < now() - interval '30 days', cascading through all owned data.
-- Idempotent: calling again within the grace window refreshes deleted_at.
create or replace function soft_delete_teacher()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update teacher
       set deleted_at = now()
     where id = _uid;

    if not found then
        raise exception 'teacher not found' using errcode = 'P0002';
    end if;
end;
$$;


-- restore_teacher() → void
--
-- Cancels a pending soft-delete within the 30-day grace window.
-- Called when the teacher confirms "Restore my account" after signing in and
-- seeing the deleted_at warning (Pass C §5).
create or replace function restore_teacher()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update teacher
       set deleted_at = null
     where id = _uid
       and deleted_at is not null;

    if not found then
        raise exception 'no pending deletion found for this teacher' using errcode = 'P0002';
    end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.2 — Course CRUD RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- create_course(p_name, p_grade_level, p_description, p_color, p_grading_system,
--               p_calc_method, p_decay_weight, p_timezone, p_late_work_policy,
--               p_subjects text[] DEFAULT NULL) → uuid
--
-- Plain variant (§2.1): p_subjects = NULL → Course + ReportConfig + active_course_id update.
-- Wizard variant (§2.2): p_subjects = ['Math','Science',...] → also inserts Subject rows.
create or replace function create_course(
    p_name            text,
    p_grade_level     text    default null,
    p_description     text    default null,
    p_color           text    default null,
    p_grading_system  text    default 'proficiency',
    p_calc_method     text    default 'average',
    p_decay_weight    numeric default null,
    p_timezone        text    default 'America/Vancouver',
    p_late_work_policy text   default null,
    p_subjects        text[]  default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid       uuid := (select auth.uid());
    _course_id uuid;
    _i         int;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    insert into course (
        teacher_id, name, grade_level, description, color,
        grading_system, calc_method, decay_weight, timezone, late_work_policy
    ) values (
        _uid, p_name, p_grade_level, p_description, p_color,
        p_grading_system, p_calc_method, p_decay_weight, p_timezone, p_late_work_policy
    ) returning id into _course_id;

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

    return _course_id;
end;
$$;


-- update_course(p_course_id, p_patch jsonb) → void
--
-- Partial update; accepted keys: name, grade_level, description, color,
-- grading_system, calc_method, decay_weight, timezone, late_work_policy.
-- Nullable fields use key-presence check (? operator) so NULL can be written
-- explicitly; non-nullable fields fall back to current value when key absent.
create or replace function update_course(
    p_course_id  uuid,
    p_patch      jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course set
        name             = coalesce(p_patch->>'name',           name),
        grade_level      = coalesce(p_patch->>'grade_level',    grade_level),
        description      = case when p_patch ? 'description'
                                then p_patch->>'description'   else description end,
        color            = case when p_patch ? 'color'
                                then p_patch->>'color'         else color end,
        grading_system   = coalesce(p_patch->>'grading_system', grading_system),
        calc_method      = coalesce(p_patch->>'calc_method',    calc_method),
        decay_weight     = case when p_patch ? 'decay_weight'
                                then (p_patch->>'decay_weight')::numeric
                                else decay_weight end,
        timezone         = coalesce(p_patch->>'timezone',       timezone),
        late_work_policy = case when p_patch ? 'late_work_policy'
                                then p_patch->>'late_work_policy'
                                else late_work_policy end,
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$$;


-- archive_course(p_course_id, p_archived) → void
--
-- Toggles Course.is_archived (§2.5). Pass false to unarchive.
create or replace function archive_course(
    p_course_id  uuid,
    p_archived   boolean
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course
       set is_archived = p_archived,
           updated_at  = now()
     where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$$;


-- duplicate_course(p_src_id) → uuid
--
-- Structure-only copy per Q27 (no enrollments, students, scores, observations).
-- Copies: Course, ReportConfig, Subject, CompetencyGroup, Section, Tag,
--         Module, Rubric, Criterion, CriterionTag, CustomTag, ObservationTemplate.
-- Uses jsonb maps for old→new ID remapping of cross-referenced entities.
create or replace function duplicate_course(p_src_id uuid) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid        uuid := (select auth.uid());
    _new_course uuid := gen_random_uuid();
    _new_id     uuid;
    _subj_map   jsonb := '{}';
    _cgrp_map   jsonb := '{}';
    _sect_map   jsonb := '{}';
    _tag_map    jsonb := '{}';
    _rubric_map jsonb := '{}';
    _crit_map   jsonb := '{}';
    _row        record;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if not exists (select 1 from course where id = p_src_id and teacher_id = _uid) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    insert into course (id, teacher_id, name, grade_level, description, color,
                        is_archived, display_order, grading_system, calc_method,
                        decay_weight, timezone, late_work_policy)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy
    from course where id = p_src_id;

    insert into report_config (course_id, preset, blocks_config)
    select _new_course, preset, blocks_config from report_config where course_id = p_src_id;

    for _row in select * from subject where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into subject (id, course_id, name, display_order)
        values (_new_id, _new_course, _row.name, _row.display_order);
        _subj_map := _subj_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from competency_group where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into competency_group (id, course_id, name, color, display_order)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order);
        _cgrp_map := _cgrp_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from section where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order)
        values (
            _new_id, _new_course,
            (_subj_map ->> _row.subject_id::text)::uuid,
            case when _row.competency_group_id is not null
                 then (_cgrp_map ->> _row.competency_group_id::text)::uuid
                 else null end,
            _row.name, _row.display_order
        );
        _sect_map := _sect_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in
        select t.* from tag t
        join section s on s.id = t.section_id
        where s.course_id = p_src_id
    loop
        _new_id := gen_random_uuid();
        insert into tag (id, section_id, code, label, i_can_text, display_order)
        values (_new_id, (_sect_map ->> _row.section_id::text)::uuid,
                _row.code, _row.label, _row.i_can_text, _row.display_order);
        _tag_map := _tag_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from module where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into module (id, course_id, name, color, display_order)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order);
    end loop;

    for _row in select * from rubric where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into rubric (id, course_id, name)
        values (_new_id, _new_course, _row.name);
        _rubric_map := _rubric_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in
        select c.* from criterion c
        join rubric r on r.id = c.rubric_id
        where r.course_id = p_src_id
    loop
        _new_id := gen_random_uuid();
        insert into criterion (id, rubric_id, name,
            level_4_descriptor, level_3_descriptor, level_2_descriptor, level_1_descriptor,
            level_4_value, level_3_value, level_2_value, level_1_value,
            weight, display_order)
        values (
            _new_id, (_rubric_map ->> _row.rubric_id::text)::uuid, _row.name,
            _row.level_4_descriptor, _row.level_3_descriptor,
            _row.level_2_descriptor, _row.level_1_descriptor,
            _row.level_4_value, _row.level_3_value, _row.level_2_value, _row.level_1_value,
            _row.weight, _row.display_order
        );
        _crit_map := _crit_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    insert into criterion_tag (criterion_id, tag_id)
    select (_crit_map ->> ct.criterion_id::text)::uuid,
           (_tag_map  ->> ct.tag_id::text)::uuid
    from criterion_tag ct
    join criterion c on c.id = ct.criterion_id
    join rubric r on r.id = c.rubric_id
    where r.course_id = p_src_id
      and (_crit_map ->> ct.criterion_id::text) is not null
      and (_tag_map  ->> ct.tag_id::text) is not null;

    insert into custom_tag (course_id, label)
    select _new_course, label from custom_tag where course_id = p_src_id;

    insert into observation_template (course_id, body, default_sentiment,
                                      default_context_type, is_seed, display_order)
    select _new_course, body, default_sentiment, default_context_type, is_seed, display_order
    from observation_template where course_id = p_src_id;

    return _new_course;
end;
$$;


-- delete_course(p_course_id) → void
--
-- Hard-delete; FK cascade removes all course-scoped data (§2.6).
-- Student rows are NOT deleted — only their Enrollment rows cascade.
create or replace function delete_course(p_course_id uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    delete from course where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.3 — Category + Module + Rubric RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- upsert_category(p_id, p_course_id, p_name, p_weight, p_display_order) → uuid
--
-- Insert (p_id null) or update a Category row. Per-course weight-cap
-- (sum(weight) ≤ 100) is enforced by the existing category_weight_cap trigger
-- — violations surface as a trigger-raised exception.
create or replace function upsert_category(
    p_id            uuid,
    p_course_id     uuid,
    p_name          text,
    p_weight        numeric,
    p_display_order int default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    _id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_id is null then
        insert into category (course_id, name, weight, display_order)
        values (p_course_id, p_name, p_weight, coalesce(p_display_order, 0))
        returning id into _id;
    else
        update category set
            name          = p_name,
            weight        = p_weight,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
        where id = p_id
        returning id into _id;

        if _id is null then
            raise exception 'category not found' using errcode = 'P0002';
        end if;
    end if;

    return _id;
end;
$$;


-- delete_category(p_id) → void
-- Hard-delete; assessment.category_id is ON DELETE SET NULL.
create or replace function delete_category(p_id uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    delete from category where id = p_id;
    if not found then
        raise exception 'category not found' using errcode = 'P0002';
    end if;
end;
$$;


-- upsert_module(p_id, p_course_id, p_name, p_color, p_display_order) → uuid
create or replace function upsert_module(
    p_id            uuid,
    p_course_id     uuid,
    p_name          text,
    p_color         text default null,
    p_display_order int  default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    _id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_id is null then
        insert into module (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color, coalesce(p_display_order, 0))
        returning id into _id;
    else
        update module set
            name          = p_name,
            color         = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
        where id = p_id
        returning id into _id;

        if _id is null then
            raise exception 'module not found' using errcode = 'P0002';
        end if;
    end if;

    return _id;
end;
$$;


-- delete_module(p_id) → void
-- assessment.module_id is ON DELETE SET NULL — assessments survive (§6).
create or replace function delete_module(p_id uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    delete from module where id = p_id;
    if not found then
        raise exception 'module not found' using errcode = 'P0002';
    end if;
end;
$$;


-- upsert_rubric(p_id, p_course_id, p_name, p_criteria jsonb) → uuid
--
-- Composite save per §7.1: rubric + criteria + criterion_tag in one transaction.
-- p_criteria shape:
--   [
--     {
--       id: uuid | null,           -- null = new criterion
--       name: text,
--       level_4_descriptor..level_1_descriptor: text,
--       level_4_value..level_1_value: numeric (defaults 4/3/2/1),
--       weight: numeric (default 1.0),
--       display_order: int (default 0),
--       linked_tag_ids: [uuid, ...]
--     }, ...
--   ]
-- Diff semantics: criteria present in payload are INSERTed (no id) or
-- UPDATEd (id given); criteria not in payload are DELETEd (cascades
-- CriterionTag + RubricScore). linked_tag_ids fully replace prior links.
create or replace function upsert_rubric(
    p_id         uuid,
    p_course_id  uuid,
    p_name       text,
    p_criteria   jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    _rubric_id uuid;
    _elem      jsonb;
    _crit_id   uuid;
    _kept_ids  uuid[] := '{}';
    _tag_id    uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
        raise exception 'p_criteria must be a jsonb array' using errcode = '22023';
    end if;

    if p_id is null then
        insert into rubric (course_id, name)
        values (p_course_id, p_name)
        returning id into _rubric_id;
    else
        update rubric set name = p_name, updated_at = now()
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
    end loop;

    delete from criterion
     where rubric_id = _rubric_id
       and id <> all (_kept_ids);

    return _rubric_id;
end;
$$;


-- delete_rubric(p_id) → void
-- assessment.rubric_id is ON DELETE SET NULL; criterion/criterion_tag/rubric_score cascade.
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

grant execute on function upsert_category(uuid, uuid, text, numeric, int) to authenticated;
grant execute on function delete_category(uuid) to authenticated;
grant execute on function upsert_module(uuid, uuid, text, text, int) to authenticated;
grant execute on function delete_module(uuid) to authenticated;
grant execute on function upsert_rubric(uuid, uuid, text, jsonb) to authenticated;
grant execute on function delete_rubric(uuid) to authenticated;
