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
--   fullvision_v2_fix_section_competency_group_fk_set_null (2026-04-19)
--   fullvision_v2_write_path_learning_map     (2026-04-19)
--   fullvision_v2_write_path_student_enrollment (2026-04-19)
--   fullvision_v2_fix_import_roster_csv_reenroll (2026-04-19)
--   fullvision_v2_write_path_assessment_crud  (2026-04-19)
--   fullvision_v2_write_path_scoring          (2026-04-19)
--   fullvision_v2_fix_score_audit_security_definer (2026-04-19)
--   fullvision_v2_write_path_observation      (2026-04-19)
--   fullvision_v2_write_path_student_records  (2026-04-19)
--   fullvision_v2_write_path_term_rating      (2026-04-19)
--   fullvision_v2_fix_save_term_rating_dim_audit (2026-04-19)
--   fullvision_v2_fix_report_config_add_custom_preset (2026-04-19)
--   fullvision_v2_write_path_prefs_report     (2026-04-19)
--   fullvision_v2_enable_pg_cron              (2026-04-19)
--   fullvision_v2_write_path_retention_cleanup (2026-04-19)
--   fullvision_v2_write_path_imports          (2026-04-19)

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


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.4 — Learning map RPCs (Subject, CompetencyGroup, Section, Tag + reorder)
-- ─────────────────────────────────────────────────────────────────────────────
-- NB: deployed alongside migration fullvision_v2_fix_section_competency_group_fk_set_null
-- which fixed a latent FK bug: the composite FK's ON DELETE SET NULL previously
-- nulled section.course_id (NOT NULL) in addition to competency_group_id. PG15+
-- column-list form `SET NULL (competency_group_id)` was used to restrict it.

create or replace function upsert_subject(
    p_id            uuid,
    p_course_id     uuid,
    p_name          text,
    p_display_order int default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_id is null then
        insert into subject (course_id, name, display_order)
        values (p_course_id, p_name,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from subject where course_id = p_course_id)))
        returning id into _id;
    else
        update subject set
            name          = p_name,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
         where id = p_id
        returning id into _id;
        if _id is null then raise exception 'subject not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $$;

create or replace function delete_subject(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from subject where id = p_id;
    if not found then raise exception 'subject not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function upsert_competency_group(
    p_id            uuid,
    p_course_id     uuid,
    p_name          text,
    p_color         text default null,
    p_display_order int  default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        insert into competency_group (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from competency_group where course_id = p_course_id)))
        returning id into _id;
    else
        update competency_group set
            name          = p_name,
            color         = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
         where id = p_id
        returning id into _id;
        if _id is null then raise exception 'competency_group not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $$;

create or replace function delete_competency_group(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from competency_group where id = p_id;
    if not found then raise exception 'competency_group not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function upsert_section(
    p_id                  uuid,
    p_subject_id          uuid,
    p_name                text,
    p_competency_group_id uuid  default null,
    p_display_order       int   default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _course_id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select course_id into _course_id from subject where id = p_subject_id;
    if _course_id is null then raise exception 'subject not found' using errcode = 'P0002'; end if;

    if p_id is null then
        insert into section (course_id, subject_id, competency_group_id, name, display_order)
        values (_course_id, p_subject_id, p_competency_group_id, p_name,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from section where subject_id = p_subject_id)))
        returning id into _id;
    else
        update section set
            subject_id          = p_subject_id,
            course_id           = _course_id,
            competency_group_id = p_competency_group_id,
            name                = p_name,
            display_order       = coalesce(p_display_order, display_order),
            updated_at          = now()
         where id = p_id
        returning id into _id;
        if _id is null then raise exception 'section not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $$;

create or replace function delete_section(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from section where id = p_id;
    if not found then raise exception 'section not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function upsert_tag(
    p_id            uuid,
    p_section_id    uuid,
    p_label         text,
    p_code          text default null,
    p_i_can_text    text default null,
    p_display_order int  default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        insert into tag (section_id, code, label, i_can_text, display_order)
        values (p_section_id, p_code, p_label, p_i_can_text,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from tag where section_id = p_section_id)))
        returning id into _id;
    else
        update tag set
            section_id    = p_section_id,
            code          = p_code,
            label         = p_label,
            i_can_text    = p_i_can_text,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
         where id = p_id
        returning id into _id;
        if _id is null then raise exception 'tag not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $$;

create or replace function delete_tag(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from tag where id = p_id;
    if not found then raise exception 'tag not found' using errcode = 'P0002'; end if;
end; $$;

-- Reorder family: rewrite display_order = array index. Ownership enforced via RLS.
create or replace function reorder_subjects(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update subject set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $$;

create or replace function reorder_competency_groups(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update competency_group set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $$;

create or replace function reorder_sections(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update section set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $$;

create or replace function reorder_tags(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update tag set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $$;

create or replace function reorder_modules(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update module set display_order = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $$;

grant execute on function upsert_subject(uuid, uuid, text, int) to authenticated;
grant execute on function delete_subject(uuid) to authenticated;
grant execute on function upsert_competency_group(uuid, uuid, text, text, int) to authenticated;
grant execute on function delete_competency_group(uuid) to authenticated;
grant execute on function upsert_section(uuid, uuid, text, uuid, int) to authenticated;
grant execute on function delete_section(uuid) to authenticated;
grant execute on function upsert_tag(uuid, uuid, text, text, text, int) to authenticated;
grant execute on function delete_tag(uuid) to authenticated;
grant execute on function reorder_subjects(uuid[]) to authenticated;
grant execute on function reorder_competency_groups(uuid[]) to authenticated;
grant execute on function reorder_sections(uuid[]) to authenticated;
grant execute on function reorder_tags(uuid[]) to authenticated;
grant execute on function reorder_modules(uuid[]) to authenticated;




-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.5 — Student + Enrollment RPCs
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function create_student_and_enroll(
    p_course_id      uuid,
    p_first_name     text,
    p_last_name      text    default null,
    p_preferred_name text    default null,
    p_pronouns       text    default null,
    p_student_number text    default null,
    p_email          text    default null,
    p_date_of_birth  date    default null,
    p_designations   text[]  default '{}',
    p_existing_student_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    _uid        uuid := (select auth.uid());
    _student_id uuid;
    _enroll_id  uuid;
    _next_pos   int;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_existing_student_id is not null then
        _student_id := p_existing_student_id;
    else
        insert into student (teacher_id, first_name, last_name, preferred_name,
                             pronouns, student_number, email, date_of_birth)
        values (_uid, p_first_name, p_last_name, p_preferred_name,
                p_pronouns, p_student_number, p_email, p_date_of_birth)
        returning id into _student_id;
    end if;

    select coalesce(max(roster_position)+1, 0) into _next_pos
      from enrollment where course_id = p_course_id;

    insert into enrollment (student_id, course_id, designations, roster_position)
    values (_student_id, p_course_id, coalesce(p_designations, '{}'), _next_pos)
    returning id into _enroll_id;

    return jsonb_build_object('student_id', _student_id, 'enrollment_id', _enroll_id);
end; $$;

create or replace function update_student(p_id uuid, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    update student set
        first_name     = coalesce(p_patch->>'first_name', first_name),
        last_name      = case when p_patch ? 'last_name'      then p_patch->>'last_name'      else last_name end,
        preferred_name = case when p_patch ? 'preferred_name' then p_patch->>'preferred_name' else preferred_name end,
        pronouns       = case when p_patch ? 'pronouns'       then p_patch->>'pronouns'       else pronouns end,
        student_number = case when p_patch ? 'student_number' then p_patch->>'student_number' else student_number end,
        email          = case when p_patch ? 'email'          then p_patch->>'email'          else email end,
        date_of_birth  = case when p_patch ? 'date_of_birth'  then (p_patch->>'date_of_birth')::date else date_of_birth end,
        updated_at     = now()
    where id = p_id;
    if not found then raise exception 'student not found' using errcode = 'P0002'; end if;
end; $$;

-- update_enrollment: patch keys designations (text[]), is_flagged, roster_position, withdrawn_at.
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

create or replace function withdraw_enrollment(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    update enrollment set withdrawn_at = now(), updated_at = now() where id = p_id;
    if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function reorder_roster(p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare _i int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_ids is null then return; end if;
    for _i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
        update enrollment set roster_position = _i - 1, updated_at = now() where id = p_ids[_i];
    end loop;
end; $$;

create or replace function bulk_apply_pronouns(p_student_ids uuid[], p_pronouns text) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_student_ids is null or array_length(p_student_ids, 1) is null then return 0; end if;
    update student set pronouns = p_pronouns, updated_at = now() where id = any(p_student_ids);
    get diagnostics _n = row_count;
    return _n;
end; $$;

-- import_roster_csv: match existing students by student_number → email → (first+last);
-- create new ones when no match. Existing active enrollment: update designations;
-- existing withdrawn: reactivate; no enrollment row: insert.
-- Returns { created, enrolled, reactivated }.
create or replace function import_roster_csv(p_course_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    _uid      uuid := (select auth.uid());
    _row      jsonb;
    _sid      uuid;
    _created  int := 0;
    _enrolled int := 0;
    _reactivated int := 0;
    _existed_id uuid;
    _was_withdrawn boolean;
    _next_pos int;
    _desig    text[];
    _sn       text; _em text; _fn text; _ln text;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows must be an array' using errcode = '22023';
    end if;

    for _row in select * from jsonb_array_elements(p_rows) loop
        _sid := null;
        _sn := nullif(_row->>'student_number', '');
        _em := nullif(_row->>'email', '');
        _fn := nullif(_row->>'first_name', '');
        _ln := nullif(_row->>'last_name', '');

        if _sn is not null then
            select id into _sid from student where teacher_id = _uid and student_number = _sn limit 1;
        end if;
        if _sid is null and _em is not null then
            select id into _sid from student where teacher_id = _uid and email = _em limit 1;
        end if;
        if _sid is null and _fn is not null then
            select id into _sid from student
             where teacher_id = _uid and first_name = _fn
               and coalesce(last_name, '') = coalesce(_ln, '') limit 1;
        end if;

        if _sid is null then
            insert into student (teacher_id, first_name, last_name, preferred_name,
                                 pronouns, student_number, email, date_of_birth)
            values (_uid, _fn, _ln,
                    nullif(_row->>'preferred_name',''),
                    nullif(_row->>'pronouns',''),
                    _sn, _em,
                    nullif(_row->>'date_of_birth','')::date)
            returning id into _sid;
            _created := _created + 1;
        end if;

        _desig := '{}';
        if _row ? 'designations' and jsonb_typeof(_row->'designations') = 'array' then
            select array_agg(v #>> '{}') into _desig from jsonb_array_elements(_row->'designations') v;
        end if;

        select id, (withdrawn_at is not null) into _existed_id, _was_withdrawn
          from enrollment where student_id = _sid and course_id = p_course_id;

        if _existed_id is null then
            select coalesce(max(roster_position)+1, 0) into _next_pos from enrollment where course_id = p_course_id;
            insert into enrollment (student_id, course_id, designations, roster_position)
            values (_sid, p_course_id, coalesce(_desig, '{}'), _next_pos);
            _enrolled := _enrolled + 1;
        elsif _was_withdrawn then
            update enrollment set withdrawn_at = null,
                                  designations = coalesce(_desig, designations),
                                  updated_at = now()
             where id = _existed_id;
            _reactivated := _reactivated + 1;
        else
            if _row ? 'designations' then
                update enrollment set designations = coalesce(_desig, '{}'), updated_at = now()
                 where id = _existed_id;
            end if;
            _reactivated := _reactivated + 1;
        end if;
    end loop;

    return jsonb_build_object('created', _created, 'enrolled', _enrolled, 'reactivated', _reactivated);
end; $$;

grant execute on function create_student_and_enroll(uuid, text, text, text, text, text, text, date, text[], uuid) to authenticated;
grant execute on function update_student(uuid, jsonb) to authenticated;
grant execute on function update_enrollment(uuid, jsonb) to authenticated;
grant execute on function withdraw_enrollment(uuid) to authenticated;
grant execute on function reorder_roster(uuid[]) to authenticated;
grant execute on function bulk_apply_pronouns(uuid[], text) to authenticated;
grant execute on function import_roster_csv(uuid, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.6 — Assessment CRUD (§8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fullvision_v2_write_path_assessment_crud (2026-04-19)

create or replace function create_assessment(
    p_course_id uuid, p_title text, p_category_id uuid default null,
    p_description text default null, p_date_assigned date default null,
    p_due_date date default null, p_score_mode text default 'proficiency',
    p_max_points numeric default null, p_weight numeric default 1.0,
    p_evidence_type text default null, p_rubric_id uuid default null,
    p_module_id uuid default null, p_tag_ids uuid[] default '{}'
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _next_pos int; _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select coalesce(max(display_order)+1, 0) into _next_pos
      from assessment where course_id = p_course_id and module_id is not distinct from p_module_id;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, display_order)
    values (p_course_id, p_category_id, p_title, p_description, p_date_assigned, p_due_date,
            p_score_mode, p_max_points, p_weight, p_evidence_type,
            p_rubric_id, p_module_id, _next_pos)
    returning id into _id;

    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (_id, _tag) on conflict do nothing;
        end loop;
    end if;
    return _id;
end; $$;

-- update_assessment: jsonb patch; when p_tag_ids is non-null, fully replaces tag set.
create or replace function update_assessment(
    p_id uuid, p_patch jsonb, p_tag_ids uuid[] default null
) returns void
language plpgsql security invoker set search_path = public as $$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    update assessment set
        title         = coalesce(p_patch->>'title', title),
        description   = case when p_patch ? 'description'   then p_patch->>'description'   else description end,
        category_id   = case when p_patch ? 'category_id'   then nullif(p_patch->>'category_id','')::uuid else category_id end,
        date_assigned = case when p_patch ? 'date_assigned' then nullif(p_patch->>'date_assigned','')::date else date_assigned end,
        due_date      = case when p_patch ? 'due_date'      then nullif(p_patch->>'due_date','')::date else due_date end,
        score_mode    = coalesce(p_patch->>'score_mode', score_mode),
        max_points    = case when p_patch ? 'max_points'    then nullif(p_patch->>'max_points','')::numeric else max_points end,
        weight        = coalesce((p_patch->>'weight')::numeric, weight),
        evidence_type = case when p_patch ? 'evidence_type' then p_patch->>'evidence_type' else evidence_type end,
        rubric_id     = case when p_patch ? 'rubric_id'     then nullif(p_patch->>'rubric_id','')::uuid else rubric_id end,
        module_id     = case when p_patch ? 'module_id'     then nullif(p_patch->>'module_id','')::uuid else module_id end,
        display_order = case when p_patch ? 'display_order' then (p_patch->>'display_order')::int else display_order end,
        updated_at    = now()
    where id = p_id;
    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    if p_tag_ids is not null then
        delete from assessment_tag where assessment_id = p_id;
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag) on conflict do nothing;
        end loop;
    end if;
end; $$;

create or replace function duplicate_assessment(p_src_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _new_id uuid; _course uuid; _module uuid; _next_pos int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select course_id, module_id into _course, _module from assessment where id = p_src_id;
    if _course is null then raise exception 'assessment not found' using errcode = 'P0002'; end if;
    select coalesce(max(display_order)+1, 0) into _next_pos
      from assessment where course_id = _course and module_id is not distinct from _module;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, collab_mode, collab_config, display_order)
    select course_id, category_id, title || ' (copy)', description, date_assigned, due_date,
           score_mode, max_points, weight, evidence_type,
           rubric_id, module_id, collab_mode, collab_config, _next_pos
      from assessment where id = p_src_id
    returning id into _new_id;

    insert into assessment_tag (assessment_id, tag_id)
    select _new_id, tag_id from assessment_tag where assessment_id = p_src_id;
    return _new_id;
end; $$;

create or replace function delete_assessment(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from assessment where id = p_id;
    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;
end; $$;

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

-- save_collab: sets collab_mode + collab_config atomically; null config when mode='none'.
create or replace function save_collab(p_id uuid, p_mode text, p_config jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_mode not in ('none','pairs','groups') then
        raise exception 'invalid collab_mode %', p_mode using errcode = '22023';
    end if;
    update assessment set
        collab_mode   = p_mode,
        collab_config = case when p_mode = 'none' then null else p_config end,
        updated_at    = now()
    where id = p_id;
    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;
end; $$;

grant execute on function create_assessment(uuid, text, uuid, text, date, date, text, numeric, numeric, text, uuid, uuid, uuid[]) to authenticated;
grant execute on function update_assessment(uuid, jsonb, uuid[]) to authenticated;
grant execute on function duplicate_assessment(uuid) to authenticated;
grant execute on function delete_assessment(uuid) to authenticated;
grant execute on function save_assessment_tags(uuid, uuid[]) to authenticated;
grant execute on function save_collab(uuid, text, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.7 — Scoring RPCs (§9) + ScoreAudit (Q28)
-- ─────────────────────────────────────────────────────────────────────────────
-- Migrations:
--   fullvision_v2_write_path_scoring (2026-04-19)
--   fullvision_v2_fix_score_audit_security_definer (2026-04-19) — audit helper
--     must be SECURITY DEFINER because rls-policies.sql reserves writes to
--     service_role (no INSERT policy on score_audit by design).

create or replace function _score_audit_diff(
    p_score_id uuid,
    p_old_value numeric, p_new_value numeric,
    p_old_status text,   p_new_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
    if p_old_value is distinct from p_new_value
       or p_old_status is distinct from p_new_status then
        insert into score_audit (score_id, changed_by, old_value, new_value, old_status, new_status)
        values (p_score_id, (select auth.uid()), p_old_value, p_new_value, p_old_status, p_new_status);
    end if;
end; $$;
revoke all on function _score_audit_diff(uuid, numeric, numeric, text, text) from public;
grant execute on function _score_audit_diff(uuid, numeric, numeric, text, text) to authenticated;

create or replace function upsert_score(
    p_enrollment_id uuid, p_assessment_id uuid, p_value numeric
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _old_v numeric; _old_s text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select id, value, status into _id, _old_v, _old_s
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is null then
        insert into score (enrollment_id, assessment_id, value)
        values (p_enrollment_id, p_assessment_id, p_value) returning id into _id;
        perform _score_audit_diff(_id, null, p_value, null, null);
    else
        update score set value = p_value, scored_at = now(), updated_at = now() where id = _id;
        perform _score_audit_diff(_id, _old_v, p_value, _old_s, _old_s);
    end if;
    return _id;
end; $$;

create or replace function set_score_status(
    p_enrollment_id uuid, p_assessment_id uuid, p_status text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _old_v numeric; _old_s text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_status is not null and p_status not in ('NS','EXC','LATE') then
        raise exception 'invalid status %', p_status using errcode = '22023';
    end if;
    select id, value, status into _id, _old_v, _old_s
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is null then
        insert into score (enrollment_id, assessment_id, status)
        values (p_enrollment_id, p_assessment_id, p_status) returning id into _id;
        perform _score_audit_diff(_id, null, null, null, p_status);
    else
        update score set status = p_status, updated_at = now() where id = _id;
        perform _score_audit_diff(_id, _old_v, _old_v, _old_s, p_status);
    end if;
    return _id;
end; $$;

-- save_score_comment is NOT audited (Q28 scope is value/status, not comment).
create or replace function save_score_comment(
    p_enrollment_id uuid, p_assessment_id uuid, p_comment text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select id into _id from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is null then
        insert into score (enrollment_id, assessment_id, comment)
        values (p_enrollment_id, p_assessment_id, p_comment) returning id into _id;
    else
        update score set comment = p_comment, updated_at = now() where id = _id;
    end if;
    return _id;
end; $$;

-- rubric_score / tag_score are unaudited (derivable from parent Score audit chain).
create or replace function upsert_rubric_score(
    p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid, p_value int
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value)
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value, updated_at = now()
    returning id into _id;
    return _id;
end; $$;

create or replace function upsert_tag_score(
    p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid, p_value int
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if (select rubric_id from assessment where id = p_assessment_id) is not null then
        raise exception 'tag_score is not used for rubric assessments' using errcode = '22023';
    end if;
    insert into tag_score (enrollment_id, assessment_id, tag_id, value)
    values (p_enrollment_id, p_assessment_id, p_tag_id, p_value)
    on conflict (enrollment_id, assessment_id, tag_id) do update
       set value = excluded.value, updated_at = now()
    returning id into _id;
    return _id;
end; $$;

-- fill_rubric: sets every criterion for (enrollment, assessment) to p_value (§9.6).
create or replace function fill_rubric(
    p_enrollment_id uuid, p_assessment_id uuid, p_value int
) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int := 0; _crit record; _rubric uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select rubric_id into _rubric from assessment where id = p_assessment_id;
    if _rubric is null then
        raise exception 'assessment % has no rubric', p_assessment_id using errcode = '22023';
    end if;
    for _crit in select id from criterion where rubric_id = _rubric loop
        perform upsert_rubric_score(p_enrollment_id, p_assessment_id, _crit.id, p_value);
        _n := _n + 1;
    end loop;
    return _n;
end; $$;

-- Clear variants (§9.7). Writes a deletion audit diff before removing rows.
-- (Cascade from score → score_audit still removes the history; acceptable since
-- a "clear" is a zero-out. Teachers needing historical recovery use the audit
-- chain, not the score table.)
create or replace function clear_score(p_enrollment_id uuid, p_assessment_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _old_v numeric; _old_s text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select id, value, status into _id, _old_v, _old_s
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if _id is not null then
        perform _score_audit_diff(_id, _old_v, null, _old_s, null);
    end if;
    delete from score        where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    delete from rubric_score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    delete from tag_score    where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
end; $$;

create or replace function clear_row_scores(p_enrollment_id uuid, p_course_id uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int := 0; _s record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    for _s in select s.id, s.value, s.status from score s
              join assessment a on a.id = s.assessment_id
              where s.enrollment_id = p_enrollment_id and a.course_id = p_course_id
    loop
        perform _score_audit_diff(_s.id, _s.value, null, _s.status, null);
        _n := _n + 1;
    end loop;
    delete from score
     where enrollment_id = p_enrollment_id
       and assessment_id in (select id from assessment where course_id = p_course_id);
    delete from rubric_score
     where enrollment_id = p_enrollment_id
       and assessment_id in (select id from assessment where course_id = p_course_id);
    delete from tag_score
     where enrollment_id = p_enrollment_id
       and assessment_id in (select id from assessment where course_id = p_course_id);
    return _n;
end; $$;

create or replace function clear_column_scores(p_assessment_id uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int := 0; _s record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    for _s in select id, value, status from score where assessment_id = p_assessment_id
    loop
        perform _score_audit_diff(_s.id, _s.value, null, _s.status, null);
        _n := _n + 1;
    end loop;
    delete from score        where assessment_id = p_assessment_id;
    delete from rubric_score where assessment_id = p_assessment_id;
    delete from tag_score    where assessment_id = p_assessment_id;
    return _n;
end; $$;

grant execute on function upsert_score(uuid, uuid, numeric) to authenticated;
grant execute on function set_score_status(uuid, uuid, text) to authenticated;
grant execute on function save_score_comment(uuid, uuid, text) to authenticated;
grant execute on function upsert_rubric_score(uuid, uuid, uuid, int) to authenticated;
grant execute on function upsert_tag_score(uuid, uuid, uuid, int) to authenticated;
grant execute on function fill_rubric(uuid, uuid, int) to authenticated;
grant execute on function clear_score(uuid, uuid) to authenticated;
grant execute on function clear_row_scores(uuid, uuid) to authenticated;
grant execute on function clear_column_scores(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.8 — Observation + Template + CustomTag (§10, §12)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function create_observation(
    p_course_id uuid, p_body text,
    p_sentiment text default null, p_context_type text default null,
    p_assessment_id uuid default null,
    p_enrollment_ids uuid[] default '{}',
    p_tag_ids uuid[] default '{}',
    p_custom_tag_ids uuid[] default '{}'
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid; _x uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into observation (course_id, body, sentiment, context_type, assessment_id)
    values (p_course_id, p_body, p_sentiment, p_context_type, p_assessment_id)
    returning id into _id;
    if p_enrollment_ids is not null then
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id) values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id) values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id) values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    return _id;
end; $$;

-- update_observation: passing null for a join-array param leaves that set alone.
-- Passing an empty array wipes it.
create or replace function update_observation(
    p_id uuid, p_patch jsonb,
    p_enrollment_ids uuid[] default null,
    p_tag_ids uuid[] default null,
    p_custom_tag_ids uuid[] default null
) returns void
language plpgsql security invoker set search_path = public as $$
declare _x uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    update observation set
        body          = coalesce(p_patch->>'body', body),
        sentiment     = case when p_patch ? 'sentiment'     then p_patch->>'sentiment'     else sentiment end,
        context_type  = case when p_patch ? 'context_type'  then p_patch->>'context_type'  else context_type end,
        assessment_id = case when p_patch ? 'assessment_id' then nullif(p_patch->>'assessment_id','')::uuid else assessment_id end,
        updated_at    = now()
    where id = p_id;
    if not found then raise exception 'observation not found' using errcode = 'P0002'; end if;

    if p_enrollment_ids is not null then
        delete from observation_student where observation_id = p_id;
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        delete from observation_tag where observation_id = p_id;
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        delete from observation_custom_tag where observation_id = p_id;
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
end; $$;

create or replace function delete_observation(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from observation where id = p_id;
    if not found then raise exception 'observation not found' using errcode = 'P0002'; end if;
end; $$;

-- Templates: seeds (is_seed=true) are immutable. Seeds come from migration-time
-- inserts, never from this RPC (it forces is_seed=false on create).
create or replace function upsert_observation_template(
    p_id uuid, p_course_id uuid, p_body text,
    p_default_sentiment text default null,
    p_default_context_type text default null,
    p_display_order int default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        insert into observation_template (course_id, body, default_sentiment,
                                          default_context_type, is_seed, display_order)
        values (p_course_id, p_body, p_default_sentiment, p_default_context_type, false,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from observation_template where course_id = p_course_id)))
        returning id into _id;
    else
        update observation_template set
            body                 = p_body,
            default_sentiment    = p_default_sentiment,
            default_context_type = p_default_context_type,
            display_order        = coalesce(p_display_order, display_order),
            updated_at           = now()
         where id = p_id and is_seed = false
        returning id into _id;
        if _id is null then
            raise exception 'observation_template not found or is seed (immutable)' using errcode = 'P0002';
        end if;
    end if;
    return _id;
end; $$;

create or replace function delete_observation_template(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare _n int;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from observation_template where id = p_id and is_seed = false;
    get diagnostics _n = row_count;
    if _n = 0 then
        raise exception 'observation_template not found or is seed (immutable)' using errcode = 'P0002';
    end if;
end; $$;

create or replace function create_custom_tag(p_course_id uuid, p_label text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into custom_tag (course_id, label) values (p_course_id, p_label) returning id into _id;
    return _id;
end; $$;

grant execute on function create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function update_observation(uuid, jsonb, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function delete_observation(uuid) to authenticated;
grant execute on function upsert_observation_template(uuid, uuid, text, text, text, int) to authenticated;
grant execute on function delete_observation_template(uuid) to authenticated;
grant execute on function create_custom_tag(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.9 — Student-scoped records (§11, §4.7)
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: immutable (add + delete only). Goal/Reflection/SectionOverride: upsert
-- per (enrollment_id, section_id). Attendance: bulk upsert per (enrollment, date).

create or replace function upsert_note(p_enrollment_id uuid, p_body text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into note (enrollment_id, body) values (p_enrollment_id, p_body) returning id into _id;
    return _id;
end; $$;

create or replace function delete_note(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from note where id = p_id;
    if not found then raise exception 'note not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function upsert_goal(p_enrollment_id uuid, p_section_id uuid, p_body text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into goal (enrollment_id, section_id, body)
    values (p_enrollment_id, p_section_id, p_body)
    on conflict (enrollment_id, section_id) do update
       set body = excluded.body, updated_at = now()
    returning id into _id;
    return _id;
end; $$;

create or replace function upsert_reflection(
    p_enrollment_id uuid, p_section_id uuid, p_body text, p_confidence int default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_confidence is not null and (p_confidence < 1 or p_confidence > 5) then
        raise exception 'confidence must be 1..5' using errcode = '22023';
    end if;
    insert into reflection (enrollment_id, section_id, body, confidence)
    values (p_enrollment_id, p_section_id, p_body, p_confidence)
    on conflict (enrollment_id, section_id) do update
       set body = excluded.body, confidence = excluded.confidence, updated_at = now()
    returning id into _id;
    return _id;
end; $$;

create or replace function upsert_section_override(
    p_enrollment_id uuid, p_section_id uuid, p_level int, p_reason text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_level < 1 or p_level > 4 then raise exception 'level must be 1..4' using errcode = '22023'; end if;
    insert into section_override (enrollment_id, section_id, level, reason)
    values (p_enrollment_id, p_section_id, p_level, p_reason)
    on conflict (enrollment_id, section_id) do update
       set level = excluded.level, reason = excluded.reason, updated_at = now()
    returning id into _id;
    return _id;
end; $$;

create or replace function clear_section_override(p_enrollment_id uuid, p_section_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from section_override where enrollment_id = p_enrollment_id and section_id = p_section_id;
end; $$;

create or replace function bulk_attendance(p_enrollment_ids uuid[], p_date date, p_status text) returns int
language plpgsql security invoker set search_path = public as $$
declare _n int := 0; _eid uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_enrollment_ids is null then return 0; end if;
    foreach _eid in array p_enrollment_ids loop
        insert into attendance (enrollment_id, attendance_date, status)
        values (_eid, p_date, p_status)
        on conflict (enrollment_id, attendance_date) do update
           set status = excluded.status, updated_at = now();
        _n := _n + 1;
    end loop;
    return _n;
end; $$;

grant execute on function upsert_note(uuid, text) to authenticated;
grant execute on function delete_note(uuid) to authenticated;
grant execute on function upsert_goal(uuid, uuid, text) to authenticated;
grant execute on function upsert_reflection(uuid, uuid, text, int) to authenticated;
grant execute on function upsert_section_override(uuid, uuid, int, text) to authenticated;
grant execute on function clear_section_override(uuid, uuid) to authenticated;
grant execute on function bulk_attendance(uuid[], date, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.10 — TermRating composite save + audit (§13, Q28)
-- ─────────────────────────────────────────────────────────────────────────────

-- Audit helper: SECURITY DEFINER, mirrors _score_audit_diff rationale.
create or replace function _term_rating_audit_field(
    p_tr_id uuid, p_field text, p_old text, p_new text
) returns void
language plpgsql security definer set search_path = public as $$
begin
    if p_old is distinct from p_new then
        insert into term_rating_audit (term_rating_id, changed_by, field_changed, old_value, new_value)
        values (p_tr_id, (select auth.uid()), p_field, p_old, p_new);
    end if;
end; $$;
revoke all on function _term_rating_audit_field(uuid, text, text, text) from public;
grant execute on function _term_rating_audit_field(uuid, text, text, text) to authenticated;

-- save_term_rating: see deployed function body in gradebook-prod for full SQL.
-- Payload shape (p_payload jsonb), all keys optional:
--   narrative_html      text
--   work_habits_rating  1..4
--   participation_rating 1..4
--   social_traits       text[]
--   dimensions          [{section_id uuid, rating 1..4}, ...]  (full replace)
--   strength_tags       [uuid, ...]                            (full replace)
--   growth_tags         [uuid, ...]                            (full replace)
--   mention_assessments [uuid, ...]                            (full replace)
--   mention_observations [uuid, ...]                           (full replace)
-- Omitting a key leaves that field/set alone.  Every field / membership change
-- emits a term_rating_audit row in the same transaction.

grant execute on function save_term_rating(uuid, int, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.11 — ReportConfig + TeacherPreference RPCs (§1.1, §14)
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration fullvision_v2_fix_report_config_add_custom_preset (2026-04-19)
-- added 'custom' to the preset CHECK (was brief/standard/detailed only).

create or replace function _report_preset_defaults(p_preset text) returns jsonb
language plpgsql immutable set search_path = public as $$
begin
    return case p_preset
        when 'brief'    then '{"header":true,"narrative":true,"grades":false,"competencies":false,"goals":false,"attendance":false}'::jsonb
        when 'standard' then '{"header":true,"narrative":true,"grades":true,"competencies":true,"goals":true,"attendance":false}'::jsonb
        when 'detailed' then '{"header":true,"narrative":true,"grades":true,"competencies":true,"goals":true,"attendance":true,"reflections":true,"strengths":true,"growth":true}'::jsonb
        else '{}'::jsonb
    end;
end; $$;

create or replace function apply_report_preset(p_course_id uuid, p_preset text) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_preset not in ('brief','standard','detailed') then
        raise exception 'preset must be brief|standard|detailed' using errcode = '22023';
    end if;
    insert into report_config (course_id, preset, blocks_config)
    values (p_course_id, p_preset, _report_preset_defaults(p_preset))
    on conflict (course_id) do update
       set preset = excluded.preset, blocks_config = excluded.blocks_config, updated_at = now();
end; $$;

-- Pass p_preset='custom' (or leave null → defaults to 'custom') when blocks_config
-- diverges from a named preset's defaults.
create or replace function save_report_config(
    p_course_id uuid, p_blocks_config jsonb, p_preset text default null
) returns void
language plpgsql security invoker set search_path = public as $$
declare _preset text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _preset := coalesce(p_preset, 'custom');
    if _preset not in ('brief','standard','detailed','custom') then
        raise exception 'invalid preset %', _preset using errcode = '22023';
    end if;
    insert into report_config (course_id, preset, blocks_config)
    values (p_course_id, _preset, p_blocks_config)
    on conflict (course_id) do update
       set preset = excluded.preset, blocks_config = excluded.blocks_config, updated_at = now();
end; $$;

create or replace function toggle_report_block(p_course_id uuid, p_block_key text, p_enabled boolean) returns void
language plpgsql security invoker set search_path = public as $$
declare _cur jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select blocks_config into _cur from report_config where course_id = p_course_id;
    _cur := coalesce(_cur, '{}'::jsonb) || jsonb_build_object(p_block_key, p_enabled);
    insert into report_config (course_id, preset, blocks_config)
    values (p_course_id, 'custom', _cur)
    on conflict (course_id) do update
       set preset = 'custom', blocks_config = _cur, updated_at = now();
end; $$;

-- save_teacher_preferences: partial jsonb patch; omitted keys unchanged.
create or replace function save_teacher_preferences(p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare _uid uuid := (select auth.uid());
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    insert into teacher_preference (teacher_id,
        active_course_id, view_mode, mobile_view_mode, mobile_sort_mode, card_widget_config)
    values (_uid,
        nullif(p_patch->>'active_course_id','')::uuid,
        nullif(p_patch->>'view_mode',''),
        nullif(p_patch->>'mobile_view_mode',''),
        nullif(p_patch->>'mobile_sort_mode',''),
        case when p_patch ? 'card_widget_config' then p_patch->'card_widget_config' else null end)
    on conflict (teacher_id) do update set
        active_course_id   = case when p_patch ? 'active_course_id'
                                  then nullif(p_patch->>'active_course_id','')::uuid
                                  else teacher_preference.active_course_id end,
        view_mode          = case when p_patch ? 'view_mode' then nullif(p_patch->>'view_mode','')
                                  else teacher_preference.view_mode end,
        mobile_view_mode   = case when p_patch ? 'mobile_view_mode' then nullif(p_patch->>'mobile_view_mode','')
                                  else teacher_preference.mobile_view_mode end,
        mobile_sort_mode   = case when p_patch ? 'mobile_sort_mode' then nullif(p_patch->>'mobile_sort_mode','')
                                  else teacher_preference.mobile_sort_mode end,
        card_widget_config = case when p_patch ? 'card_widget_config' then p_patch->'card_widget_config'
                                  else teacher_preference.card_widget_config end;
end; $$;

grant execute on function apply_report_preset(uuid, text) to authenticated;
grant execute on function save_report_config(uuid, jsonb, text) to authenticated;
grant execute on function toggle_report_block(uuid, text, boolean) to authenticated;
grant execute on function save_teacher_preferences(jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.12 — Retention cleanup (pg_cron scheduled job)
-- ─────────────────────────────────────────────────────────────────────────────
-- Migrations:
--   fullvision_v2_enable_pg_cron (2026-04-19) — extension enable
--   fullvision_v2_write_path_retention_cleanup (2026-04-19) — fn + schedule
--
-- Schedule: 'fv_retention_cleanup_daily' at 03:17 UTC daily.
-- Actions:
--   • Hard-delete teachers where deleted_at < now() - 30 days (Q29).
--     Cascades remove every owned row (course, student, score, observation, ...).
--   • Purge score_audit + term_rating_audit rows older than 2 years (Q28).
-- SECURITY DEFINER so the job bypasses RLS on teacher + audit tables.

create or replace function fv_retention_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    _teachers_purged int;
    _score_audit_purged int;
    _tr_audit_purged    int;
begin
    delete from teacher
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _teachers_purged = row_count;

    delete from score_audit where changed_at < now() - interval '2 years';
    get diagnostics _score_audit_purged = row_count;

    delete from term_rating_audit where changed_at < now() - interval '2 years';
    get diagnostics _tr_audit_purged = row_count;

    return jsonb_build_object(
        'teachers_purged', _teachers_purged,
        'score_audit_purged', _score_audit_purged,
        'term_rating_audit_purged', _tr_audit_purged,
        'ran_at', now()
    );
end; $$;
revoke all on function fv_retention_cleanup() from public;

-- Registered via cron.schedule(...) in the deploy migration. Job metadata:
--   jobname:  fv_retention_cleanup_daily
--   schedule: '17 3 * * *'
--   command:  select public.fv_retention_cleanup();


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4.9 backend — Imports (§15.2 Teams, §15.3 JSON restore)
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fullvision_v2_write_path_imports (2026-04-19)

-- import_teams_class(p_payload jsonb) → jsonb
--   Creates Course + ReportConfig + Students (match by SN→email→name) +
--   Enrollments + Assessments. Scores are NOT imported from Teams in this flow.
--   Returns { course_id, students_created, enrollments_created, assessments_created }.
--   Sets the new course as active_course_id on teacher_preference.

-- import_json_restore(p_payload jsonb) → jsonb
--   Full-data restore from a legacy export, FK-safe topological replay.
--   Courses → ReportConfig → Subject/CompetencyGroup → Section → Tag →
--   Module → Rubric → Criterion → CriterionTag → Student → Enrollment →
--   Assessment → AssessmentTag → Score/RubricScore/TagScore →
--   Note / Goal / Reflection.  Idempotent: UPSERT on UUID.
--   teacher_id on Course + Student is forced to auth.uid() regardless of
--   payload value — never trust the caller's ownership claim.

grant execute on function import_teams_class(jsonb) to authenticated;
grant execute on function import_json_restore(jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5.5 — Write-path completion
-- ─────────────────────────────────────────────────────────────────────────────
-- Deployed in migration fullvision_v2_write_path_student_delete_relink_clear
-- (2026-04-20).
--
-- delete_student(p_id)                                   — §4.5 full cascade
-- relink_student(ghost_student_id, canonical_student_id) — §15.4 post-import reconcile;
--                                                          same-course enrollments merge
--                                                          (designations unioned, withdrawn_at
--                                                          resets to null if either side active),
--                                                          cross-course enrollments move;
--                                                          ghost student deleted
-- clear_data()                                           — §16.2 self-service wipe;
--                                                          removes all courses + students owned
--                                                          by the calling teacher; Teacher +
--                                                          TeacherPreference rows preserved
--                                                          (active_course_id nulled)

create or replace function delete_student(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    delete from student where id = p_id;
    if not found then raise exception 'student not found' using errcode = 'P0002'; end if;
end; $$;
grant execute on function delete_student(uuid) to authenticated;

-- relink_student + clear_data bodies: see migration fullvision_v2_write_path_student_delete_relink_clear.
grant execute on function relink_student(uuid, uuid) to authenticated;
grant execute on function clear_data() to authenticated;
