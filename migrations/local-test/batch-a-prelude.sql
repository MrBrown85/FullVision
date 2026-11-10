-- The other live functions Batch A patches or tests, for the local harness:
-- update_course and import_json_restore (the grade_return migration patches
-- both in place), create_course, duplicate_course and duplicate_assessment
-- (its tests call them). No migration holds any of the five whole: each is
-- the migration that last wrote it in full, with every later in-place patch
-- applied in order (listed above each). live-function-md5.txt proves the
-- result: batch_a_live.py compares each with the live fingerprint.
-- Load after batch-a-tables.sql.

-- update_course: migrations/20261102_course_curriculum_tags.sql,
--   then the patch in migrations/20261102_folders_count_as_one.sql,
--   then the patch in migrations/20261102_courses_count_equally.sql
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
        folders_count_as_one = case when p_patch ? 'folders_count_as_one'
                                then coalesce((p_patch->>'folders_count_as_one')::boolean, true)
                                else folders_count_as_one end,
        courses_count_equally = case when p_patch ? 'courses_count_equally'
                                then coalesce((p_patch->>'courses_count_equally')::boolean, false)
                                else courses_count_equally end,
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

-- create_course: migrations/20261020_course_block.sql
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

-- duplicate_assessment: migrations/20261027_assessment_core_competencies.sql
create or replace function public.duplicate_assessment(p_src_id uuid, p_idempotency_key uuid default null)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _new_id   uuid;
    _course   uuid;
    _module   uuid;
    _next_pos int;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'duplicate_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select course_id, module_id into _course, _module
      from assessment
     where id = p_src_id;
    if _course is null then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = _course
       and module_id is not distinct from _module;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, collab_mode, collab_config, display_order,
                            core_competency_ids)
    select course_id, category_id, title || ' (copy)', description, date_assigned, due_date,
           score_mode, max_points, weight, evidence_type,
           rubric_id, module_id, collab_mode, collab_config, _next_pos,
           core_competency_ids
      from assessment
     where id = p_src_id
    returning id into _new_id;

    insert into assessment_tag (assessment_id, tag_id)
    select _new_id, tag_id from assessment_tag where assessment_id = p_src_id;

    perform fv_idem_store(p_idempotency_key, 'duplicate_assessment', jsonb_build_object('id', _new_id));
    return _new_id;
end; $function$;

-- duplicate_course: migrations/20261022_advanced_rubric_checks.sql,
--   then the patch in migrations/20261102_tag_bank_id.sql,
--   then the patch in migrations/20261102_folders_count_as_one.sql,
--   then the patch in migrations/20261102_courses_count_equally.sql,
--   then the patch in migrations/20261103_rubric_whole_competencies.sql
create or replace function public.duplicate_course(p_src_id uuid, p_idempotency_key uuid default null)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
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
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    _cached := fv_idem_check(p_idempotency_key, 'duplicate_course');
    if _cached is not null then return (_cached->>'id')::uuid; end if;
    if not exists (select 1 from course where id = p_src_id and teacher_id = _uid) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    insert into course (id, teacher_id, name, grade_level, description, color,
                        is_archived, display_order, grading_system, calc_method,
                        decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally)
    select _new_course, teacher_id, name || ' (copy)', grade_level, description, color,
           false, display_order, grading_system, calc_method,
           decay_weight, timezone, late_work_policy, folders_count_as_one, courses_count_equally
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
        insert into competency_group (id, course_id, name, color, display_order, counts_as_one)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order, _row.counts_as_one);
        _cgrp_map := _cgrp_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from section where course_id = p_src_id and removed_at is null loop
        _new_id := gen_random_uuid();
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order)
        values (_new_id, _new_course,
            (_subj_map ->> _row.subject_id::text)::uuid,
            case when _row.competency_group_id is not null
                 then (_cgrp_map ->> _row.competency_group_id::text)::uuid
                 else null end,
            _row.name, _row.display_order);
        _sect_map := _sect_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select t.* from tag t join section s on s.id = t.section_id where s.course_id = p_src_id and s.removed_at is null loop
        _new_id := gen_random_uuid();
        insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values (_new_id, (_sect_map ->> _row.section_id::text)::uuid,
            _row.code, _row.label, _row.i_can_text, _row.i_can_statements, _row.source_text, _row.bank_id, _row.display_order);
        _tag_map := _tag_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select * from module where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into module (id, course_id, name, color, display_order)
        values (_new_id, _new_course, _row.name, _row.color, _row.display_order);
    end loop;

    for _row in select * from rubric where course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into rubric (id, course_id, name, style) values (_new_id, _new_course, _row.name, _row.style);
        _rubric_map := _rubric_map || jsonb_build_object(_row.id::text, _new_id::text);
    end loop;

    for _row in select c.* from criterion c join rubric r on r.id = c.rubric_id where r.course_id = p_src_id loop
        _new_id := gen_random_uuid();
        insert into criterion (id, rubric_id, name,
            level_4_descriptor, level_3_descriptor, level_2_descriptor, level_1_descriptor,
            level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order)
        values (_new_id, (_rubric_map ->> _row.rubric_id::text)::uuid, _row.name,
            _row.level_4_descriptor, _row.level_3_descriptor,
            _row.level_2_descriptor, _row.level_1_descriptor,
            _row.level_4_value, _row.level_3_value, _row.level_2_value, _row.level_1_value,
            _row.weight, _row.display_order);
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

    -- Competencies a whole rubric scores.
    insert into rubric_tag (rubric_id, tag_id)
    select (_rubric_map ->> rt.rubric_id::text)::uuid,
           (_tag_map    ->> rt.tag_id::text)::uuid
    from rubric_tag rt
    join rubric r on r.id = rt.rubric_id
    where r.course_id = p_src_id
      and (_rubric_map ->> rt.rubric_id::text) is not null
      and (_tag_map    ->> rt.tag_id::text) is not null;

    -- Advanced Rubrics: the checkboxes go with their criteria. Ticks
    -- (rubric_check_score) stay with the source class, as rubric scores do.
    insert into criterion_check (criterion_id, level, label, display_order)
    select (_crit_map ->> ck.criterion_id::text)::uuid, ck.level, ck.label, ck.display_order
    from criterion_check ck
    join criterion c on c.id = ck.criterion_id
    join rubric r on r.id = c.rubric_id
    where r.course_id = p_src_id
      and (_crit_map ->> ck.criterion_id::text) is not null;

    insert into custom_tag (course_id, label)
    select _new_course, label from custom_tag where course_id = p_src_id;


    perform fv_idem_store(p_idempotency_key, 'duplicate_course', jsonb_build_object('id', _new_course));
    return _new_course;
end;
$function$;

-- import_json_restore: migrations/20261103_import_json_restore_full_class.sql,
--   then the patch in migrations/20261103_rubric_whole_competencies.sql,
--   then the patch in migrations/20261103_import_json_restore_owned_links.sql
create or replace function public.import_json_restore(p_payload jsonb, p_idempotency_key uuid default null::uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _uid uuid := (select auth.uid());
    _row jsonb;
    _id uuid;
    _sid uuid;
    _students jsonb := '{}'::jsonb;  -- payload student id → student id used
    _used jsonb := '{}'::jsonb;      -- existing student ids already matched
    _n_courses int := 0; _n_rc int := 0; _n_cat int := 0;
    _n_subj int := 0; _n_cg int := 0; _n_sect int := 0; _n_tag int := 0;
    _n_mod int := 0; _n_rub int := 0; _n_crit int := 0; _n_ct int := 0; _n_chk int := 0;
    _n_stu int := 0; _n_matched int := 0; _n_enr int := 0; _n_asm int := 0; _n_at int := 0;
    _n_scr int := 0; _n_rs int := 0; _n_ts int := 0; _n_rcs int := 0;
    _n_note int := 0; _n_goal int := 0; _n_refl int := 0; _n_ovr int := 0;
    _n_ctag int := 0; _n_obs int := 0; _n_tr int := 0;
    _cached jsonb; _result jsonb;
    _bad text;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'import_json_restore');
    if _cached is not null then return _cached; end if;
    perform set_config('fv.restoring', 'on', true);

    if p_payload ? 'courses' then
      for _row in select * from jsonb_array_elements(p_payload->'courses') loop
        insert into course (id, teacher_id, name, grade_level, description, color,
                            is_archived, grading_system, calc_method, decay_weight,
                            timezone, late_work_policy, grading_scale, category_weights,
                            round_percent, reporting_terms, block, recent_score_limit,
                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally)
        values ((_row->>'id')::uuid, _uid,
                coalesce(_row->>'name','Untitled'),
                _row->>'grade_level', _row->>'description', _row->>'color',
                coalesce((_row->>'is_archived')::boolean, false),
                coalesce(_row->>'grading_system','proficiency'),
                coalesce(_row->>'calc_method','average'),
                nullif(_row->>'decay_weight','')::numeric,
                coalesce(_row->>'timezone','America/Vancouver'),
                _row->>'late_work_policy',
                case when jsonb_typeof(_row->'grading_scale') = 'object' then _row->'grading_scale' end,
                case when jsonb_typeof(_row->'category_weights') = 'object' then _row->'category_weights' end,
                nullif(_row->>'round_percent','')::boolean,
                case when jsonb_typeof(_row->'reporting_terms') in ('object','array') then _row->'reporting_terms' end,
                nullif(_row->>'block',''),
                nullif(_row->>'recent_score_limit','')::smallint,
                coalesce(_row->>'level_order','desc'),
                case when jsonb_typeof(_row->'curriculum_tags') = 'array'
                     then array(select jsonb_array_elements_text(_row->'curriculum_tags')) end,
                coalesce((_row->>'folders_count_as_one')::boolean, true),
                coalesce((_row->>'courses_count_equally')::boolean, false))
        on conflict (id) do update set
          name=excluded.name, grade_level=excluded.grade_level,
          description=excluded.description, color=excluded.color,
          is_archived=excluded.is_archived, grading_system=excluded.grading_system,
          calc_method=excluded.calc_method, decay_weight=excluded.decay_weight,
          timezone=excluded.timezone, late_work_policy=excluded.late_work_policy,
          grading_scale=excluded.grading_scale, category_weights=excluded.category_weights,
          round_percent=excluded.round_percent, reporting_terms=excluded.reporting_terms,
          block=excluded.block, recent_score_limit=excluded.recent_score_limit,
          level_order=excluded.level_order, curriculum_tags=excluded.curriculum_tags,
          folders_count_as_one=excluded.folders_count_as_one,
          courses_count_equally=excluded.courses_count_equally,
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
        insert into category (id, course_id, name, weight, display_order, calc_mode)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'weight')::numeric, 0),
                coalesce((_row->>'display_order')::int, 0),
                coalesce(_row->>'calc_mode','points'))
        on conflict (id) do update set
          name=excluded.name, weight=excluded.weight,
          display_order=excluded.display_order, calc_mode=excluded.calc_mode, updated_at=now();
        _n_cat := _n_cat + 1;
      end loop;
    end if;

    if p_payload ? 'subjects' then
      for _row in select * from jsonb_array_elements(p_payload->'subjects') loop
        insert into subject (id, course_id, name, display_order, color)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), coalesce((_row->>'display_order')::int, 0),
                _row->>'color')
        on conflict (id) do update set name=excluded.name, display_order=excluded.display_order,
          color=excluded.color, updated_at=now();
        _n_subj := _n_subj + 1;
      end loop;
    end if;

    if p_payload ? 'competency_groups' then
      for _row in select * from jsonb_array_elements(p_payload->'competency_groups') loop
        insert into competency_group (id, course_id, name, color, display_order, counts_as_one)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0),
                coalesce((_row->>'counts_as_one')::boolean, true))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, counts_as_one=excluded.counts_as_one, updated_at=now();
        _n_cg := _n_cg + 1;
      end loop;
    end if;

    if p_payload ? 'sections' then
      for _row in select * from jsonb_array_elements(p_payload->'sections') loop
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order, color)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                (_row->>'subject_id')::uuid,
                nullif(_row->>'competency_group_id','')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'display_order')::int, 0),
                _row->>'color')
        on conflict (id) do update set
          subject_id=excluded.subject_id, competency_group_id=excluded.competency_group_id,
          name=excluded.name, display_order=excluded.display_order, color=excluded.color,
          updated_at=now();
        _n_sect := _n_sect + 1;
      end loop;
    end if;

    if p_payload ? 'tags' then
      for _row in select * from jsonb_array_elements(p_payload->'tags') loop
        insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values ((_row->>'id')::uuid, (_row->>'section_id')::uuid,
                _row->>'code', coalesce(_row->>'label',''), _row->>'i_can_text',
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'i_can_statements') = 'array'
                         then _row->'i_can_statements' else '[]'::jsonb end)), '{}'),
                _row->>'source_text', _row->>'bank_id',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          code=excluded.code, label=excluded.label, i_can_text=excluded.i_can_text,
          i_can_statements=case when _row ? 'i_can_statements' then excluded.i_can_statements else tag.i_can_statements end,
          source_text=case when _row ? 'source_text' then excluded.source_text else tag.source_text end,
          bank_id=case when _row ? 'bank_id' then excluded.bank_id else tag.bank_id end,
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
        insert into rubric (id, course_id, name, style)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid, coalesce(_row->>'name',''),
                coalesce(_row->>'style','standard'))
        on conflict (id) do update set name=excluded.name, style=excluded.style, updated_at=now();
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

    -- Competencies a whole rubric scores.
    if p_payload ? 'rubric_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'rubric_tags') loop
        insert into rubric_tag (rubric_id, tag_id)
        values ((_row->>'rubric_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    -- An Advanced Rubric's checkboxes.
    if p_payload ? 'criterion_checks' then
      for _row in select * from jsonb_array_elements(p_payload->'criterion_checks') loop
        insert into criterion_check (id, criterion_id, level, label, display_order)
        values ((_row->>'id')::uuid, (_row->>'criterion_id')::uuid,
                (_row->>'level')::smallint, coalesce(_row->>'label',''),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set level=excluded.level, label=excluded.label,
          display_order=excluded.display_order, updated_at=now();
        _n_chk := _n_chk + 1;
      end loop;
    end if;

    -- Students: one of the teacher's students with the same student number,
    -- else the backup's own student record, is used instead of a new one.
    -- RLS shows only the teacher's own students, so another teacher's
    -- backup always makes new records.
    if p_payload ? 'students' then
      for _row in select * from jsonb_array_elements(p_payload->'students') loop
        _sid := null;
        if nullif(btrim(_row->>'student_number'),'') is not null then
          select s.id into _sid from student s
           where s.teacher_id = _uid and s.student_number = btrim(_row->>'student_number')
             and not (_used ? s.id::text)
           order by s.created_at limit 1;
        end if;
        if _sid is null and nullif(_row->>'match_id','') is not null then
          select s.id into _sid from student s
           where s.teacher_id = _uid and s.id::text = _row->>'match_id'
             and not (_used ? s.id::text);
        end if;
        if _sid is not null then
          _n_matched := _n_matched + 1;
        else
          _sid := (_row->>'id')::uuid;
          insert into student (id, teacher_id, first_name, last_name, preferred_name,
                               pronouns, student_number, email, date_of_birth)
          values (_sid, _uid,
                  coalesce(_row->>'first_name',''),
                  _row->>'last_name', _row->>'preferred_name', _row->>'pronouns',
                  nullif(btrim(_row->>'student_number'),''), nullif(_row->>'email',''),
                  nullif(_row->>'date_of_birth','')::date)
          on conflict (id) do update set
            first_name=excluded.first_name, last_name=excluded.last_name,
            preferred_name=excluded.preferred_name, pronouns=excluded.pronouns,
            student_number=excluded.student_number, email=excluded.email,
            date_of_birth=excluded.date_of_birth, updated_at=now();
        end if;
        _used := _used || jsonb_build_object(_sid::text, true);
        _students := _students || jsonb_build_object(_row->>'id', _sid::text);
        _n_stu := _n_stu + 1;
      end loop;
    end if;

    if p_payload ? 'enrollments' then
      for _row in select * from jsonb_array_elements(p_payload->'enrollments') loop
        insert into enrollment (id, student_id, course_id, designations, roster_position,
                                is_flagged, withdrawn_at, enrolled_at)
        values ((_row->>'id')::uuid,
                coalesce(_students->>(_row->>'student_id'), _row->>'student_id')::uuid,
                (_row->>'course_id')::uuid,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'designations') = 'array'
                         then _row->'designations' else '[]'::jsonb end)), '{}'),
                coalesce((_row->>'roster_position')::int, 0),
                coalesce((_row->>'is_flagged')::boolean, false),
                nullif(_row->>'withdrawn_at','')::timestamptz,
                coalesce(nullif(_row->>'enrolled_at','')::timestamptz, now()))
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
                                evidence_type, rubric_id, module_id, display_order,
                                collab_mode, collab_config, core_competency_ids)
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
                coalesce((_row->>'display_order')::int, 0),
                coalesce(_row->>'collab_mode','none'),
                case when jsonb_typeof(_row->'collab_config') = 'object' then _row->'collab_config' end,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'core_competency_ids') = 'array'
                         then _row->'core_competency_ids' else '[]'::jsonb end)), '{}'))
        on conflict (id) do update set
          category_id=excluded.category_id, title=excluded.title, description=excluded.description,
          date_assigned=excluded.date_assigned, due_date=excluded.due_date,
          score_mode=excluded.score_mode, max_points=excluded.max_points, weight=excluded.weight,
          evidence_type=excluded.evidence_type, rubric_id=excluded.rubric_id,
          module_id=excluded.module_id, display_order=excluded.display_order,
          collab_mode=excluded.collab_mode, collab_config=excluded.collab_config,
          core_competency_ids=excluded.core_competency_ids, updated_at=now();
        _n_asm := _n_asm + 1;
      end loop;
    end if;

    if p_payload ? 'assessment_tags' then
      insert into assessment_tag (assessment_id, tag_id)
      select (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid from jsonb_array_elements(case when jsonb_typeof(p_payload->'assessment_tags') = 'array' then p_payload->'assessment_tags' else '[]'::jsonb end) r
      on conflict do nothing;
      get diagnostics _n_at = row_count;
    end if;

    if p_payload ? 'scores' then
      insert into score (id, enrollment_id, assessment_id, value, status, comment, scored_at,
                         modifier, report_note)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid,
             nullif(r->>'value','')::numeric, r->>'status', r->>'comment',
             coalesce(nullif(r->>'scored_at','')::timestamptz, now()),
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'report_note','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'scores') = 'array' then p_payload->'scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id) do update set
        value=excluded.value, status=excluded.status, comment=excluded.comment,
        modifier=excluded.modifier, report_note=excluded.report_note, updated_at=now();
      get diagnostics _n_scr = row_count;
    end if;

    if p_payload ? 'rubric_scores' then
      insert into rubric_score (id, enrollment_id, assessment_id, criterion_id, value,
                                modifier, comment, beyond)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'criterion_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'criterion_id')::uuid,
             (r->>'value')::int,
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'comment',''), nullif(r->>'beyond','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'rubric_scores') = 'array' then p_payload->'rubric_scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id, criterion_id) do update set
        value=excluded.value, modifier=excluded.modifier, comment=excluded.comment,
        beyond=excluded.beyond, updated_at=now();
      get diagnostics _n_rs = row_count;
    end if;

    if p_payload ? 'tag_scores' then
      insert into tag_score (id, enrollment_id, assessment_id, tag_id, value, modifier, comment)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid,
             (r->>'value')::int,
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'comment','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'tag_scores') = 'array' then p_payload->'tag_scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id, tag_id) do update set
        value=excluded.value, modifier=excluded.modifier, comment=excluded.comment, updated_at=now();
      get diagnostics _n_ts = row_count;
    end if;

    -- Ticked Advanced Rubric checkboxes.
    if p_payload ? 'rubric_check_scores' then
      insert into rubric_check_score (enrollment_id, assessment_id, check_id)
      select (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'check_id')::uuid
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'rubric_check_scores') = 'array' then p_payload->'rubric_check_scores' else '[]'::jsonb end) r
      on conflict do nothing;
      get diagnostics _n_rcs = row_count;
    end if;

    if p_payload ? 'notes' then
      insert into note (id, enrollment_id, body, created_at)
      select coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, coalesce(r->>'body',''),
             coalesce(nullif(r->>'created_at','')::timestamptz, now())
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'notes') = 'array' then p_payload->'notes' else '[]'::jsonb end) r
      on conflict (id) do update set body=excluded.body;
      get diagnostics _n_note = row_count;
    end if;

    if p_payload ? 'goals' then
      insert into goal (id, enrollment_id, section_id, body)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid, coalesce(r->>'body','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'goals') = 'array' then p_payload->'goals' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set body=excluded.body, updated_at=now();
      get diagnostics _n_goal = row_count;
    end if;

    if p_payload ? 'reflections' then
      insert into reflection (id, enrollment_id, section_id, body, confidence)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid, r->>'body',
             nullif(r->>'confidence','')::int
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'reflections') = 'array' then p_payload->'reflections' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set
        body=excluded.body, confidence=excluded.confidence, updated_at=now();
      get diagnostics _n_refl = row_count;
    end if;

    if p_payload ? 'section_overrides' then
      insert into section_override (id, enrollment_id, section_id, level, reason)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid,
             (r->>'level')::int, r->>'reason'
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'section_overrides') = 'array' then p_payload->'section_overrides' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set
        level=excluded.level, reason=excluded.reason, updated_at=now();
      get diagnostics _n_ovr = row_count;
    end if;

    if p_payload ? 'custom_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'custom_tags') loop
        insert into custom_tag (id, course_id, label)
        values (coalesce(nullif(_row->>'id','')::uuid, gen_random_uuid()),
                (_row->>'course_id')::uuid, _row->>'label')
        on conflict (id) do update set label=excluded.label;
        _n_ctag := _n_ctag + 1;
      end loop;
    end if;

    -- Observations, with their students and competency. A sentence starter
    -- the teacher no longer has is dropped from the link, not the note.
    if p_payload ? 'observations' then
      for _row in select * from jsonb_array_elements(p_payload->'observations') loop
        _id := (_row->>'id')::uuid;
        insert into observation (id, course_id, body, sentiment, context_type, assessment_id,
                                 created_at, dims, level, template_id)
        values (_id, (_row->>'course_id')::uuid, coalesce(_row->>'body',''),
                nullif(_row->>'sentiment',''), nullif(_row->>'context_type',''),
                nullif(_row->>'assessment_id','')::uuid,
                coalesce(nullif(_row->>'created_at','')::timestamptz, now()),
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'dims') = 'array'
                         then _row->'dims' else '[]'::jsonb end)), '{}'),
                nullif(_row->>'level','')::smallint,
                (select t.id from observation_template t
                  where t.id::text = nullif(_row->>'template_id','')))
        on conflict (id) do update set
          body=excluded.body, sentiment=excluded.sentiment, context_type=excluded.context_type,
          assessment_id=excluded.assessment_id, dims=excluded.dims, level=excluded.level,
          template_id=excluded.template_id, updated_at=now();
        insert into observation_student (observation_id, enrollment_id)
        select _id, e::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'enrollment_ids') = 'array' then _row->'enrollment_ids' else '[]'::jsonb end) e
        on conflict do nothing;
        insert into observation_tag (observation_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'tag_ids') = 'array' then _row->'tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        _n_obs := _n_obs + 1;
      end loop;
    end if;

    -- Term ratings, with the competencies, assessments and observations
    -- they name. After observations, which they can point to.
    if p_payload ? 'term_ratings' then
      for _row in select * from jsonb_array_elements(p_payload->'term_ratings') loop
        insert into term_rating (id, enrollment_id, term, narrative_html, work_habits_rating,
                                 participation_rating, social_traits, habits, approved_at,
                                 reporting_basis, ie_deadline, draft_meta, absences, lates)
        values (coalesce(nullif(_row->>'id','')::uuid, gen_random_uuid()),
                (_row->>'enrollment_id')::uuid, (_row->>'term')::int,
                _row->>'narrative_html',
                nullif(_row->>'work_habits_rating','')::int,
                nullif(_row->>'participation_rating','')::int,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'social_traits') = 'array'
                         then _row->'social_traits' else '[]'::jsonb end)), '{}'),
                case when jsonb_typeof(_row->'habits') = 'object' then _row->'habits' else '{}'::jsonb end,
                nullif(_row->>'approved_at','')::timestamptz,
                coalesce(nullif(_row->>'reporting_basis',''), 'grade'),
                nullif(_row->>'ie_deadline','')::date,
                case when jsonb_typeof(_row->'draft_meta') = 'object' then _row->'draft_meta' end,
                nullif(_row->>'absences','')::int,
                nullif(_row->>'lates','')::int)
        on conflict (enrollment_id, term) do update set
          narrative_html=excluded.narrative_html, work_habits_rating=excluded.work_habits_rating,
          participation_rating=excluded.participation_rating, social_traits=excluded.social_traits,
          habits=excluded.habits, approved_at=excluded.approved_at,
          reporting_basis=excluded.reporting_basis, ie_deadline=excluded.ie_deadline,
          draft_meta=excluded.draft_meta, absences=excluded.absences, lates=excluded.lates,
          updated_at=now()
        returning id into _id;
        insert into term_rating_strength (term_rating_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'strength_tag_ids') = 'array' then _row->'strength_tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        insert into term_rating_growth_area (term_rating_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'growth_tag_ids') = 'array' then _row->'growth_tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        insert into term_rating_assessment (term_rating_id, assessment_id)
        select _id, a::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'mention_assessment_ids') = 'array' then _row->'mention_assessment_ids' else '[]'::jsonb end) a
        on conflict do nothing;
        insert into term_rating_observation (term_rating_id, observation_id)
        select _id, o::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'mention_observation_ids') = 'array' then _row->'mention_observation_ids' else '[]'::jsonb end) o
        on conflict do nothing;
        _n_tr := _n_tr + 1;
      end loop;
    end if;

    -- Every other record a restored row names must be the teacher's own:
    -- RLS on each row checks only its own parent. A student is checked by
    -- teacher; any other record by whether RLS shows it. Each id is checked
    -- once: a class's thousands of scores name a few dozen records.
    select l.kind || ' ' || l.id into _bad
      from (
        select distinct v.kind,
               case when v.kind = 'student' then coalesce(_students->>n.id, n.id) else n.id end as id
          from (values
                  ('enrollments', 'student_id', 'student'),
                  ('sections', 'subject_id', 'subject'),
                  ('sections', 'competency_group_id', 'competency_group'),
                  ('assessments', 'category_id', 'category'),
                  ('assessments', 'rubric_id', 'rubric'),
                  ('assessments', 'module_id', 'module'),
                  ('assessment_tags', 'tag_id', 'tag'),
                  ('criterion_tags', 'tag_id', 'tag'),
                  ('rubric_tags', 'tag_id', 'tag'),
                  ('scores', 'assessment_id', 'assessment'),
                  ('rubric_scores', 'assessment_id', 'assessment'),
                  ('rubric_scores', 'criterion_id', 'criterion'),
                  ('tag_scores', 'assessment_id', 'assessment'),
                  ('tag_scores', 'tag_id', 'tag'),
                  ('rubric_check_scores', 'assessment_id', 'assessment'),
                  ('rubric_check_scores', 'check_id', 'criterion_check'),
                  ('goals', 'section_id', 'section'),
                  ('reflections', 'section_id', 'section'),
                  ('section_overrides', 'section_id', 'section'),
                  ('observations', 'assessment_id', 'assessment'),
                  ('observations', 'enrollment_ids', 'enrollment'),
                  ('observations', 'tag_ids', 'tag'),
                  ('term_ratings', 'strength_tag_ids', 'tag'),
                  ('term_ratings', 'growth_tag_ids', 'tag'),
                  ('term_ratings', 'mention_assessment_ids', 'assessment'),
                  ('term_ratings', 'mention_observation_ids', 'observation')
               ) v(arr, field, kind)
         cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(p_payload->v.arr) = 'array' then p_payload->v.arr else '[]'::jsonb end) r
         cross join lateral (
                 select nullif(r->>v.field, '') as id where jsonb_typeof(r->v.field) is distinct from 'array'
                 union all
                 select e from jsonb_array_elements_text(
                     case when jsonb_typeof(r->v.field) = 'array' then r->v.field else '[]'::jsonb end) e
               ) n
      ) l
     where l.id is not null
       and not case l.kind
             when 'student' then exists (select 1 from student x where x.id = l.id::uuid and x.teacher_id = _uid)
             when 'subject' then exists (select 1 from subject x where x.id = l.id::uuid)
             when 'competency_group' then exists (select 1 from competency_group x where x.id = l.id::uuid)
             when 'category' then exists (select 1 from category x where x.id = l.id::uuid)
             when 'rubric' then exists (select 1 from rubric x where x.id = l.id::uuid)
             when 'module' then exists (select 1 from module x where x.id = l.id::uuid)
             when 'tag' then exists (select 1 from tag x where x.id = l.id::uuid)
             when 'assessment' then exists (select 1 from assessment x where x.id = l.id::uuid)
             when 'criterion' then exists (select 1 from criterion x where x.id = l.id::uuid)
             when 'criterion_check' then exists (select 1 from criterion_check x where x.id = l.id::uuid)
             when 'section' then exists (select 1 from section x where x.id = l.id::uuid)
             when 'enrollment' then exists (select 1 from enrollment x where x.id = l.id::uuid)
             when 'observation' then exists (select 1 from observation x where x.id = l.id::uuid)
           end
     limit 1;
    if _bad is not null then
        raise exception 'import_json_restore: % not found', _bad using errcode = 'P0002';
    end if;

    -- One cursor bump per restored course, now the rows are in, through the
    -- course's own trigger (the teacher can't call _touch_course_sync_cursor).
    perform set_config('fv.restoring', '', true);
    if p_payload ? 'courses' then
      update course set updated_at = now()
       where id in (select (r->>'id')::uuid from jsonb_array_elements(p_payload->'courses') r);
    end if;

    _result := jsonb_build_object(
      'courses', _n_courses, 'report_configs', _n_rc, 'categories', _n_cat,
      'subjects', _n_subj, 'competency_groups', _n_cg,
      'sections', _n_sect, 'tags', _n_tag,
      'modules', _n_mod, 'rubrics', _n_rub, 'criteria', _n_crit, 'criterion_tags', _n_ct,
      'criterion_checks', _n_chk,
      'students', _n_stu, 'students_matched', _n_matched, 'student_ids', _students,
      'enrollments', _n_enr,
      'assessments', _n_asm, 'assessment_tags', _n_at,
      'scores', _n_scr, 'rubric_scores', _n_rs, 'tag_scores', _n_ts,
      'rubric_check_scores', _n_rcs,
      'notes', _n_note, 'goals', _n_goal, 'reflections', _n_refl,
      'section_overrides', _n_ovr, 'custom_tags', _n_ctag,
      'observations', _n_obs, 'term_ratings', _n_tr
    );
    perform fv_idem_store(p_idempotency_key, 'import_json_restore', _result);
    return _result;
end;
$function$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.update_course(uuid, jsonb),
  public.create_course(text, text, text, text, text, text, numeric, text, text, text[], uuid, text),
  public.duplicate_assessment(uuid, uuid), public.duplicate_course(uuid, uuid),
  public.import_json_restore(jsonb, uuid)
  to authenticated;
