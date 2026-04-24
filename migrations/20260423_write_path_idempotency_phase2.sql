-- ============================================================================
-- migration: 20260423_write_path_idempotency_phase2
--
-- Phase 2 of the P5.6 idempotency retrofit. Pairs with
-- 20260423_write_path_idempotency.sql — that migration shipped the
-- fv_idempotency table + fv_idem_check/fv_idem_store helpers and retrofitted
-- 6 RPCs (create_observation, create_assessment, duplicate_assessment,
-- create_custom_tag, upsert_note, create_student_and_enroll).
--
-- This migration extends the same three-line pattern to the remaining
-- INSERT-shaped RPCs so an offline-queue retry after a network blip
-- (server committed, client missed the 200) cannot create duplicate rows.
--
-- Retrofitted here:
--   • create_course
--   • duplicate_course
--   • import_roster_csv
--   • import_teams_class
--   • import_json_restore
--   • upsert_observation_template
--   • upsert_category, upsert_module, upsert_rubric,
--     upsert_subject, upsert_competency_group, upsert_section, upsert_tag
--     (each: idempotency guard applies only to the null-p_id INSERT branch;
--     the UPDATE branch is already idempotent by primary key)
--
-- Retry-safety for UPSERTs: when a caller passes p_idempotency_key,
-- check/store only on the insert branch. An update with p_id is already
-- replay-safe by pk.
-- ============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_course
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function create_course(
    p_name              text,
    p_grade_level       text    default null,
    p_description       text    default null,
    p_color             text    default null,
    p_grading_system    text    default 'proficiency',
    p_calc_method       text    default 'average',
    p_decay_weight      numeric default null,
    p_timezone          text    default 'America/Vancouver',
    p_late_work_policy  text    default null,
    p_subjects          text[]  default null,
    p_idempotency_key   uuid    default null
) returns uuid
language plpgsql set search_path to 'public' as $$
declare
    _uid       uuid := (select auth.uid());
    _course_id uuid;
    _i         int;
    _cached    jsonb;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_course');
    if _cached is not null then
        return (_cached->>'id')::uuid;
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

    perform fv_idem_store(p_idempotency_key, 'create_course', jsonb_build_object('id', _course_id));
    return _course_id;
end;
$$;

grant execute on function create_course(
    text, text, text, text, text, text, numeric, text, text, text[], uuid
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- duplicate_course
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function duplicate_course(
    p_src_id            uuid,
    p_idempotency_key   uuid default null
) returns uuid
language plpgsql set search_path to 'public' as $$
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
    _cached     jsonb;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'duplicate_course');
    if _cached is not null then
        return (_cached->>'id')::uuid;
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
        values (
            _new_id, (_sect_map ->> _row.section_id::text)::uuid,
            _row.code, _row.label, _row.i_can_text, _row.display_order
        );
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

    perform fv_idem_store(p_idempotency_key, 'duplicate_course', jsonb_build_object('id', _new_course));
    return _new_course;
end;
$$;

grant execute on function duplicate_course(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- import_roster_csv
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function import_roster_csv(
    p_course_id         uuid,
    p_rows              jsonb,
    p_idempotency_key   uuid default null
) returns jsonb
language plpgsql set search_path to 'public' as $$
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
    _sn       text;
    _em       text;
    _fn       text;
    _ln       text;
    _cached   jsonb;
    _result   jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows must be an array' using errcode = '22023';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'import_roster_csv');
    if _cached is not null then
        return _cached;
    end if;

    for _row in select * from jsonb_array_elements(p_rows) loop
        _sid := null;
        _sn  := nullif(_row->>'student_number', '');
        _em  := nullif(_row->>'email', '');
        _fn  := nullif(_row->>'first_name', '');
        _ln  := nullif(_row->>'last_name', '');

        if _sn is not null then
            select id into _sid from student
             where teacher_id = _uid and student_number = _sn limit 1;
        end if;
        if _sid is null and _em is not null then
            select id into _sid from student
             where teacher_id = _uid and email = _em limit 1;
        end if;
        if _sid is null and _fn is not null then
            select id into _sid from student
             where teacher_id = _uid
               and first_name = _fn
               and coalesce(last_name, '') = coalesce(_ln, '') limit 1;
        end if;

        if _sid is null then
            insert into student (teacher_id, first_name, last_name, preferred_name,
                                 pronouns, student_number, email, date_of_birth)
            values (_uid, _fn, _ln,
                    nullif(_row->>'preferred_name', ''),
                    nullif(_row->>'pronouns', ''),
                    _sn, _em,
                    nullif(_row->>'date_of_birth', '')::date)
            returning id into _sid;
            _created := _created + 1;
        end if;

        _desig := '{}';
        if _row ? 'designations' and jsonb_typeof(_row->'designations') = 'array' then
            select array_agg(v #>> '{}') into _desig
              from jsonb_array_elements(_row->'designations') v;
        end if;

        select id, (withdrawn_at is not null) into _existed_id, _was_withdrawn
          from enrollment where student_id = _sid and course_id = p_course_id;

        if _existed_id is null then
            select coalesce(max(roster_position)+1, 0) into _next_pos
              from enrollment where course_id = p_course_id;

            insert into enrollment (student_id, course_id, designations, roster_position)
            values (_sid, p_course_id, coalesce(_desig, '{}'), _next_pos);
            _enrolled := _enrolled + 1;
        elsif _was_withdrawn then
            update enrollment set
                withdrawn_at = null,
                designations = coalesce(_desig, designations),
                updated_at   = now()
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

    _result := jsonb_build_object(
        'created',     _created,
        'enrolled',    _enrolled,
        'reactivated', _reactivated
    );
    perform fv_idem_store(p_idempotency_key, 'import_roster_csv', _result);
    return _result;
end;
$$;

grant execute on function import_roster_csv(uuid, jsonb, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- import_teams_class
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function import_teams_class(
    p_payload           jsonb,
    p_idempotency_key   uuid default null
) returns jsonb
language plpgsql set search_path to 'public' as $$
declare
    _uid          uuid := (select auth.uid());
    _course_id    uuid;
    _stu_created  int  := 0;
    _enr_created  int  := 0;
    _asm_created  int  := 0;
    _next_pos     int  := 0;
    _row          jsonb;
    _sid          uuid;
    _sn           text; _em text; _fn text; _ln text;
    _cached       jsonb;
    _result       jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'import_teams_class');
    if _cached is not null then
        return _cached;
    end if;

    insert into course (teacher_id, name, grade_level, timezone)
    values (_uid,
            coalesce(p_payload->>'class_name', 'Imported Class'),
            p_payload->>'grade_level',
            coalesce(p_payload->>'timezone', 'America/Vancouver'))
    returning id into _course_id;

    insert into report_config (course_id) values (_course_id);

    if p_payload ? 'students' and jsonb_typeof(p_payload->'students') = 'array' then
        for _row in select * from jsonb_array_elements(p_payload->'students') loop
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
                _stu_created := _stu_created + 1;
            end if;

            insert into enrollment (student_id, course_id, roster_position)
            values (_sid, _course_id, _next_pos)
            on conflict (student_id, course_id) do update set withdrawn_at = null, updated_at = now();
            _next_pos := _next_pos + 1;
            _enr_created := _enr_created + 1;
        end loop;
    end if;

    if p_payload ? 'assignments' and jsonb_typeof(p_payload->'assignments') = 'array' then
        for _row in select * from jsonb_array_elements(p_payload->'assignments') loop
            insert into assessment (course_id, title, description, date_assigned, due_date,
                                    score_mode, max_points, weight, display_order)
            values (_course_id,
                    coalesce(_row->>'title', 'Untitled'),
                    _row->>'description',
                    nullif(_row->>'date_assigned','')::date,
                    nullif(_row->>'due_date','')::date,
                    coalesce(_row->>'score_mode', 'proficiency'),
                    nullif(_row->>'max_points','')::numeric,
                    coalesce((_row->>'weight')::numeric, 1.0),
                    _asm_created);
            _asm_created := _asm_created + 1;
        end loop;
    end if;

    update teacher_preference set active_course_id = _course_id where teacher_id = _uid;

    _result := jsonb_build_object(
        'course_id', _course_id,
        'students_created', _stu_created,
        'enrollments_created', _enr_created,
        'assessments_created', _asm_created
    );
    perform fv_idem_store(p_idempotency_key, 'import_teams_class', _result);
    return _result;
end;
$$;

grant execute on function import_teams_class(jsonb, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- import_json_restore
-- (body unchanged; only wrapped with idempotency check+store)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function import_json_restore(
    p_payload           jsonb,
    p_idempotency_key   uuid default null
) returns jsonb
language plpgsql set search_path to 'public' as $$
declare
    _uid uuid := (select auth.uid());
    _row jsonb;
    _n_courses int := 0; _n_rc int := 0; _n_cat int := 0;
    _n_subj int := 0; _n_cg int := 0; _n_sect int := 0; _n_tag int := 0;
    _n_mod int := 0; _n_rub int := 0; _n_crit int := 0; _n_ct int := 0;
    _n_stu int := 0; _n_enr int := 0; _n_asm int := 0; _n_at int := 0;
    _n_scr int := 0; _n_rs int := 0; _n_ts int := 0;
    _n_note int := 0; _n_goal int := 0; _n_refl int := 0;
    _cached jsonb;
    _result jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'import_json_restore');
    if _cached is not null then
        return _cached;
    end if;

    if p_payload ? 'courses' then
      for _row in select * from jsonb_array_elements(p_payload->'courses') loop
        insert into course (id, teacher_id, name, grade_level, description, color,
                            is_archived, grading_system, calc_method, decay_weight,
                            timezone, late_work_policy)
        values ((_row->>'id')::uuid, _uid,
                coalesce(_row->>'name','Untitled'),
                _row->>'grade_level', _row->>'description', _row->>'color',
                coalesce((_row->>'is_archived')::boolean, false),
                coalesce(_row->>'grading_system','proficiency'),
                coalesce(_row->>'calc_method','average'),
                nullif(_row->>'decay_weight','')::numeric,
                coalesce(_row->>'timezone','America/Vancouver'),
                _row->>'late_work_policy')
        on conflict (id) do update set
          name=excluded.name, grade_level=excluded.grade_level,
          description=excluded.description, color=excluded.color,
          is_archived=excluded.is_archived, grading_system=excluded.grading_system,
          calc_method=excluded.calc_method, decay_weight=excluded.decay_weight,
          timezone=excluded.timezone, late_work_policy=excluded.late_work_policy,
          updated_at=now();
        _n_courses := _n_courses + 1;
      end loop;
    end if;

    if p_payload ? 'report_configs' then
      for _row in select * from jsonb_array_elements(p_payload->'report_configs') loop
        insert into report_config (course_id, preset, blocks_config)
        values ((_row->>'course_id')::uuid,
                coalesce(_row->>'preset','standard'),
                _row->'blocks_config')
        on conflict (course_id) do update set
          preset=excluded.preset, blocks_config=excluded.blocks_config, updated_at=now();
        _n_rc := _n_rc + 1;
      end loop;
    end if;

    if p_payload ? 'categories' then
      for _row in select * from jsonb_array_elements(p_payload->'categories') loop
        insert into category (id, course_id, name, weight, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'weight')::numeric, 0),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          name=excluded.name, weight=excluded.weight,
          display_order=excluded.display_order, updated_at=now();
        _n_cat := _n_cat + 1;
      end loop;
    end if;

    if p_payload ? 'subjects' then
      for _row in select * from jsonb_array_elements(p_payload->'subjects') loop
        insert into subject (id, course_id, name, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set name=excluded.name, display_order=excluded.display_order, updated_at=now();
        _n_subj := _n_subj + 1;
      end loop;
    end if;

    if p_payload ? 'competency_groups' then
      for _row in select * from jsonb_array_elements(p_payload->'competency_groups') loop
        insert into competency_group (id, course_id, name, color, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, updated_at=now();
        _n_cg := _n_cg + 1;
      end loop;
    end if;

    if p_payload ? 'sections' then
      for _row in select * from jsonb_array_elements(p_payload->'sections') loop
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                (_row->>'subject_id')::uuid,
                nullif(_row->>'competency_group_id','')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          subject_id=excluded.subject_id, competency_group_id=excluded.competency_group_id,
          name=excluded.name, display_order=excluded.display_order, updated_at=now();
        _n_sect := _n_sect + 1;
      end loop;
    end if;

    if p_payload ? 'tags' then
      for _row in select * from jsonb_array_elements(p_payload->'tags') loop
        insert into tag (id, section_id, code, label, i_can_text, display_order)
        values ((_row->>'id')::uuid, (_row->>'section_id')::uuid,
                _row->>'code', coalesce(_row->>'label',''), _row->>'i_can_text',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          code=excluded.code, label=excluded.label, i_can_text=excluded.i_can_text,
          display_order=excluded.display_order, updated_at=now();
        _n_tag := _n_tag + 1;
      end loop;
    end if;

    if p_payload ? 'modules' then
      for _row in select * from jsonb_array_elements(p_payload->'modules') loop
        insert into module (id, course_id, name, color, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, updated_at=now();
        _n_mod := _n_mod + 1;
      end loop;
    end if;

    if p_payload ? 'rubrics' then
      for _row in select * from jsonb_array_elements(p_payload->'rubrics') loop
        insert into rubric (id, course_id, name)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid, coalesce(_row->>'name',''))
        on conflict (id) do update set name=excluded.name, updated_at=now();
        _n_rub := _n_rub + 1;
      end loop;
    end if;

    if p_payload ? 'criteria' then
      for _row in select * from jsonb_array_elements(p_payload->'criteria') loop
        insert into criterion (id, rubric_id, name,
          level_4_descriptor, level_3_descriptor, level_2_descriptor, level_1_descriptor,
          level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order)
        values ((_row->>'id')::uuid, (_row->>'rubric_id')::uuid,
                coalesce(_row->>'name',''),
                _row->>'level_4_descriptor', _row->>'level_3_descriptor',
                _row->>'level_2_descriptor', _row->>'level_1_descriptor',
                coalesce((_row->>'level_4_value')::numeric, 4),
                coalesce((_row->>'level_3_value')::numeric, 3),
                coalesce((_row->>'level_2_value')::numeric, 2),
                coalesce((_row->>'level_1_value')::numeric, 1),
                coalesce((_row->>'weight')::numeric, 1.0),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          name=excluded.name,
          level_4_descriptor=excluded.level_4_descriptor, level_3_descriptor=excluded.level_3_descriptor,
          level_2_descriptor=excluded.level_2_descriptor, level_1_descriptor=excluded.level_1_descriptor,
          level_4_value=excluded.level_4_value, level_3_value=excluded.level_3_value,
          level_2_value=excluded.level_2_value, level_1_value=excluded.level_1_value,
          weight=excluded.weight, display_order=excluded.display_order, updated_at=now();
        _n_crit := _n_crit + 1;
      end loop;
    end if;

    if p_payload ? 'criterion_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'criterion_tags') loop
        insert into criterion_tag (criterion_id, tag_id)
        values ((_row->>'criterion_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    if p_payload ? 'students' then
      for _row in select * from jsonb_array_elements(p_payload->'students') loop
        insert into student (id, teacher_id, first_name, last_name, preferred_name,
                             pronouns, student_number, email, date_of_birth)
        values ((_row->>'id')::uuid, _uid,
                coalesce(_row->>'first_name',''),
                _row->>'last_name', _row->>'preferred_name', _row->>'pronouns',
                _row->>'student_number', _row->>'email',
                nullif(_row->>'date_of_birth','')::date)
        on conflict (id) do update set
          first_name=excluded.first_name, last_name=excluded.last_name,
          preferred_name=excluded.preferred_name, pronouns=excluded.pronouns,
          student_number=excluded.student_number, email=excluded.email,
          date_of_birth=excluded.date_of_birth, updated_at=now();
        _n_stu := _n_stu + 1;
      end loop;
    end if;

    if p_payload ? 'enrollments' then
      for _row in select * from jsonb_array_elements(p_payload->'enrollments') loop
        insert into enrollment (id, student_id, course_id, designations, roster_position,
                                is_flagged, withdrawn_at)
        values ((_row->>'id')::uuid, (_row->>'student_id')::uuid, (_row->>'course_id')::uuid,
                coalesce(array(select jsonb_array_elements_text(_row->'designations')), '{}'),
                coalesce((_row->>'roster_position')::int, 0),
                coalesce((_row->>'is_flagged')::boolean, false),
                nullif(_row->>'withdrawn_at','')::timestamptz)
        on conflict (id) do update set
          designations=excluded.designations, roster_position=excluded.roster_position,
          is_flagged=excluded.is_flagged, withdrawn_at=excluded.withdrawn_at, updated_at=now();
        _n_enr := _n_enr + 1;
      end loop;
    end if;

    if p_payload ? 'assessments' then
      for _row in select * from jsonb_array_elements(p_payload->'assessments') loop
        insert into assessment (id, course_id, category_id, title, description,
                                date_assigned, due_date, score_mode, max_points, weight,
                                evidence_type, rubric_id, module_id, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                nullif(_row->>'category_id','')::uuid,
                coalesce(_row->>'title',''), _row->>'description',
                nullif(_row->>'date_assigned','')::date,
                nullif(_row->>'due_date','')::date,
                coalesce(_row->>'score_mode','proficiency'),
                nullif(_row->>'max_points','')::numeric,
                coalesce((_row->>'weight')::numeric, 1.0),
                _row->>'evidence_type',
                nullif(_row->>'rubric_id','')::uuid,
                nullif(_row->>'module_id','')::uuid,
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          category_id=excluded.category_id, title=excluded.title, description=excluded.description,
          date_assigned=excluded.date_assigned, due_date=excluded.due_date,
          score_mode=excluded.score_mode, max_points=excluded.max_points, weight=excluded.weight,
          evidence_type=excluded.evidence_type, rubric_id=excluded.rubric_id,
          module_id=excluded.module_id, display_order=excluded.display_order, updated_at=now();
        _n_asm := _n_asm + 1;
      end loop;
    end if;

    if p_payload ? 'assessment_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'assessment_tags') loop
        insert into assessment_tag (assessment_id, tag_id)
        values ((_row->>'assessment_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_at := _n_at + 1;
      end loop;
    end if;

    if p_payload ? 'scores' then
      for _row in select * from jsonb_array_elements(p_payload->'scores') loop
        insert into score (id, enrollment_id, assessment_id, value, status, comment, scored_at)
        values ((_row->>'id')::uuid, (_row->>'enrollment_id')::uuid, (_row->>'assessment_id')::uuid,
                nullif(_row->>'value','')::numeric, _row->>'status', _row->>'comment',
                coalesce(nullif(_row->>'scored_at','')::timestamptz, now()))
        on conflict (enrollment_id, assessment_id) do update set
          value=excluded.value, status=excluded.status, comment=excluded.comment, updated_at=now();
        _n_scr := _n_scr + 1;
      end loop;
    end if;

    if p_payload ? 'rubric_scores' then
      for _row in select * from jsonb_array_elements(p_payload->'rubric_scores') loop
        insert into rubric_score (id, enrollment_id, assessment_id, criterion_id, value)
        values ((_row->>'id')::uuid, (_row->>'enrollment_id')::uuid,
                (_row->>'assessment_id')::uuid, (_row->>'criterion_id')::uuid,
                (_row->>'value')::int)
        on conflict (enrollment_id, assessment_id, criterion_id) do update set
          value=excluded.value, updated_at=now();
        _n_rs := _n_rs + 1;
      end loop;
    end if;

    if p_payload ? 'tag_scores' then
      for _row in select * from jsonb_array_elements(p_payload->'tag_scores') loop
        insert into tag_score (id, enrollment_id, assessment_id, tag_id, value)
        values ((_row->>'id')::uuid, (_row->>'enrollment_id')::uuid,
                (_row->>'assessment_id')::uuid, (_row->>'tag_id')::uuid,
                (_row->>'value')::int)
        on conflict (enrollment_id, assessment_id, tag_id) do update set
          value=excluded.value, updated_at=now();
        _n_ts := _n_ts + 1;
      end loop;
    end if;

    if p_payload ? 'notes' then
      for _row in select * from jsonb_array_elements(p_payload->'notes') loop
        insert into note (id, enrollment_id, body, created_at)
        values ((_row->>'id')::uuid, (_row->>'enrollment_id')::uuid,
                coalesce(_row->>'body',''),
                coalesce(nullif(_row->>'created_at','')::timestamptz, now()))
        on conflict (id) do update set body=excluded.body;
        _n_note := _n_note + 1;
      end loop;
    end if;

    if p_payload ? 'goals' then
      for _row in select * from jsonb_array_elements(p_payload->'goals') loop
        insert into goal (id, enrollment_id, section_id, body)
        values ((_row->>'id')::uuid, (_row->>'enrollment_id')::uuid,
                (_row->>'section_id')::uuid, coalesce(_row->>'body',''))
        on conflict (enrollment_id, section_id) do update set body=excluded.body, updated_at=now();
        _n_goal := _n_goal + 1;
      end loop;
    end if;

    if p_payload ? 'reflections' then
      for _row in select * from jsonb_array_elements(p_payload->'reflections') loop
        insert into reflection (id, enrollment_id, section_id, body, confidence)
        values ((_row->>'id')::uuid, (_row->>'enrollment_id')::uuid,
                (_row->>'section_id')::uuid, _row->>'body',
                nullif(_row->>'confidence','')::int)
        on conflict (enrollment_id, section_id) do update set
          body=excluded.body, confidence=excluded.confidence, updated_at=now();
        _n_refl := _n_refl + 1;
      end loop;
    end if;

    _result := jsonb_build_object(
      'courses', _n_courses, 'report_configs', _n_rc, 'categories', _n_cat,
      'subjects', _n_subj, 'competency_groups', _n_cg,
      'sections', _n_sect, 'tags', _n_tag,
      'modules', _n_mod, 'rubrics', _n_rub, 'criteria', _n_crit, 'criterion_tags', _n_ct,
      'students', _n_stu, 'enrollments', _n_enr,
      'assessments', _n_asm, 'assessment_tags', _n_at,
      'scores', _n_scr, 'rubric_scores', _n_rs, 'tag_scores', _n_ts,
      'notes', _n_note, 'goals', _n_goal, 'reflections', _n_refl
    );
    perform fv_idem_store(p_idempotency_key, 'import_json_restore', _result);
    return _result;
end;
$$;

grant execute on function import_json_restore(jsonb, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_observation_template
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_observation_template(
    p_id                     uuid,
    p_course_id              uuid,
    p_body                   text,
    p_default_sentiment      text    default null,
    p_default_context_type   text    default null,
    p_display_order          integer default null,
    p_idempotency_key        uuid    default null
) returns uuid
language plpgsql set search_path to 'public' as $$
declare
    _id uuid;
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_observation_template');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into observation_template (course_id, body, default_sentiment,
                                          default_context_type, is_seed, display_order)
        values (p_course_id, p_body, p_default_sentiment, p_default_context_type, false,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from observation_template where course_id = p_course_id)))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_observation_template', jsonb_build_object('id', _id));
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
end;
$$;

grant execute on function upsert_observation_template(
    uuid, uuid, text, text, text, integer, uuid
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_category (null-id insert branch only)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_category(
    p_id                uuid,
    p_course_id         uuid,
    p_name              text,
    p_weight            numeric,
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
        _cached := fv_idem_check(p_idempotency_key, 'upsert_category');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into category (course_id, name, weight, display_order)
        values (p_course_id, p_name, p_weight, coalesce(p_display_order, 0))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_category', jsonb_build_object('id', _id));
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

grant execute on function upsert_category(uuid, uuid, text, numeric, integer, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_module
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_module(
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
        _cached := fv_idem_check(p_idempotency_key, 'upsert_module');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into module (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color, coalesce(p_display_order, 0))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_module', jsonb_build_object('id', _id));
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

grant execute on function upsert_module(uuid, uuid, text, text, integer, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_rubric
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_rubric(
    p_id                uuid,
    p_course_id         uuid,
    p_name              text,
    p_criteria          jsonb,
    p_idempotency_key   uuid default null
) returns uuid
language plpgsql set search_path to 'public' as $$
declare
    _rubric_id uuid;
    _elem      jsonb;
    _crit_id   uuid;
    _kept_ids  uuid[] := '{}';
    _tag_id    uuid;
    _cached    jsonb;
    _is_insert boolean := false;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
        raise exception 'p_criteria must be a jsonb array' using errcode = '22023';
    end if;

    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_rubric');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;
        _is_insert := true;

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

    if _is_insert then
        perform fv_idem_store(p_idempotency_key, 'upsert_rubric', jsonb_build_object('id', _rubric_id));
    end if;
    return _rubric_id;
end;
$$;

grant execute on function upsert_rubric(uuid, uuid, text, jsonb, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_subject
-- ─────────────────────────────────────────────────────────────────────────────

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

grant execute on function upsert_subject(uuid, uuid, text, text, integer, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_competency_group
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_competency_group(
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
        _cached := fv_idem_check(p_idempotency_key, 'upsert_competency_group');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into competency_group (course_id, name, color, display_order)
        values (p_course_id, p_name, p_color,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from competency_group where course_id = p_course_id)))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_competency_group', jsonb_build_object('id', _id));
    else
        update competency_group set
            name          = p_name,
            color         = p_color,
            display_order = coalesce(p_display_order, display_order),
            updated_at    = now()
         where id = p_id
        returning id into _id;
        if _id is null then
            raise exception 'competency_group not found' using errcode = 'P0002';
        end if;
    end if;
    return _id;
end;
$$;

grant execute on function upsert_competency_group(uuid, uuid, text, text, integer, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_section
-- ─────────────────────────────────────────────────────────────────────────────

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

grant execute on function upsert_section(uuid, uuid, text, text, uuid, integer, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_tag
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function upsert_tag(
    p_id                uuid,
    p_section_id        uuid,
    p_label             text,
    p_code              text    default null,
    p_i_can_text        text    default null,
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
        _cached := fv_idem_check(p_idempotency_key, 'upsert_tag');
        if _cached is not null then
            return (_cached->>'id')::uuid;
        end if;

        insert into tag (section_id, code, label, i_can_text, display_order)
        values (p_section_id, p_code, p_label, p_i_can_text,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from tag where section_id = p_section_id)))
        returning id into _id;

        perform fv_idem_store(p_idempotency_key, 'upsert_tag', jsonb_build_object('id', _id));
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
        if _id is null then
            raise exception 'tag not found' using errcode = 'P0002';
        end if;
    end if;
    return _id;
end;
$$;

grant execute on function upsert_tag(uuid, uuid, text, text, text, integer, uuid) to authenticated;

commit;
