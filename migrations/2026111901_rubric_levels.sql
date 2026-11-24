-- Rubric levels: a rubric's own columns, and the BC six-point scale (2026-11-19).
--
-- Teachers asked to add level columns to a rubric, as other gradebooks
-- allow, and BC English teachers score writing on the Ministry's six-point
-- scale. A rubric may now have 2 to 6 level columns of its own
-- (rubric.scale), each with a name and the FullVision level and +/- it counts
-- as; the English 12 scoring guides are ready-made rubrics with six. A
-- score on such a rubric is stored as the level and +/- its column counts as
-- (shared/rubric-scale.js), so rubric_score and every grade function are
-- unchanged.
--
-- 1. rubric gains scale jsonb: null = the four FullVision levels, as
--    every rubric has today; else [{ k: 1..6, name, level: 1..4,
--    mod: -1|0|1 }], one per column, k the column's slot.
-- 2. criterion gains level_5_descriptor and level_6_descriptor.
-- 3. criterion_check.level allows 1..6; upsert_rubric refuses 5 or 6 on a
--    rubric with no scale.
-- 4. upsert_rubric gains p_scale (null keeps the scale, [] clears it, an
--    array of 2 to 6 sets it) and saves the two descriptors; the
--    eight-argument version is dropped so PostgREST has one to call.
--    get_class_bundle and student_submit.page send scale and the two
--    descriptors; duplicate_course and import_json_restore copy them.
--
-- No grade changes, no data changes: every existing rubric keeps a null
-- scale and reads as before. Undo: drop the new upsert_rubric and restore
-- the old definition from migrations/baseline, drop the three columns, put
-- the check constraint back to 1..4, re-run the other four edits in reverse.

begin;

alter table public.rubric add column if not exists scale jsonb;
alter table public.rubric
  add constraint rubric_scale_check
  check (scale is null or (jsonb_typeof(scale) = 'array' and jsonb_array_length(scale) between 2 and 6));

alter table public.criterion add column if not exists level_5_descriptor text;
alter table public.criterion add column if not exists level_6_descriptor text;

alter table public.criterion_check drop constraint if exists criterion_check_level_check;
alter table public.criterion_check
  add constraint criterion_check_level_check check (level between 1 and 6);

-- One exact edit to each live definition. Each must match once, or the
-- migration stops and nothing is changed.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'p_linked_tag_ids jsonb DEFAULT NULL::jsonb)',
          'p_linked_tag_ids jsonb DEFAULT NULL::jsonb, p_scale jsonb DEFAULT NULL::jsonb)'],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'if p_linked_tag_ids is not null and jsonb_typeof(p_linked_tag_ids) <> ''array'' then',
          'if p_scale is not null and (jsonb_typeof(p_scale) <> ''array''
                                 or jsonb_array_length(p_scale) not in (0, 2, 3, 4, 5, 6)) then
        raise exception ''p_scale must be an array of 2 to 6 levels, or empty'' using errcode = ''22023'';
    end if;

    if p_linked_tag_ids is not null and jsonb_typeof(p_linked_tag_ids) <> ''array'' then'],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'insert into rubric (course_id, name, copy_group, style)
        values (p_course_id, p_name, p_copy_group, coalesce(p_style, ''standard''))',
          'insert into rubric (course_id, name, copy_group, style, scale)
        values (p_course_id, p_name, p_copy_group, coalesce(p_style, ''standard''),
                case when jsonb_array_length(coalesce(p_scale, ''[]''::jsonb)) = 0 then null else p_scale end)'],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'style = coalesce(p_style, style), updated_at = now()',
          'style = coalesce(p_style, style),
                          scale = case when p_scale is null then scale
                                       when jsonb_array_length(p_scale) = 0 then null
                                       else p_scale end,
                          updated_at = now()'],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'level_1_descriptor = _elem->>''level_1_descriptor'',',
          'level_1_descriptor = _elem->>''level_1_descriptor'',
                level_5_descriptor = _elem->>''level_5_descriptor'',
                level_6_descriptor = _elem->>''level_6_descriptor'','],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'weight, display_order
            ) values (',
          'weight, display_order, level_5_descriptor, level_6_descriptor
            ) values ('],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'coalesce((_elem->>''display_order'')::int, 0)
            ) returning id into _crit_id;',
          'coalesce((_elem->>''display_order'')::int, 0),
                _elem->>''level_5_descriptor'', _elem->>''level_6_descriptor''
            ) returning id into _crit_id;'],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb)',
          'if _level is null or _level < 1 or _level > 4 then
                    raise exception ''check level must be 1..4'' using errcode = ''22023'';',
          'if _level is null or _level < 1
                   or _level > (case when (select scale from rubric where id = _rubric_id) is not null
                                     then 6 else 4 end) then
                    raise exception ''check level must be 1..4, or 1..6 on a rubric with its own levels'' using errcode = ''22023'';'],
    array['public.get_class_bundle(uuid,bigint)',
          '''copy_group'', r.copy_group, ''style'', r.style)',
          '''copy_group'', r.copy_group, ''style'', r.style, ''scale'', r.scale)'],
    array['public.get_class_bundle(uuid,bigint)',
          '''level_2_descriptor'', c.level_2_descriptor, ''level_1_descriptor'', c.level_1_descriptor,',
          '''level_2_descriptor'', c.level_2_descriptor, ''level_1_descriptor'', c.level_1_descriptor,
                       ''level_5_descriptor'', c.level_5_descriptor, ''level_6_descriptor'', c.level_6_descriptor,'],
    array['student_submit.page(text,uuid,text)',
          '''id'', r.id, ''name'', r.name, ''style'', r.style,',
          '''id'', r.id, ''name'', r.name, ''style'', r.style, ''scale'', r.scale,'],
    array['student_submit.page(text,uuid,text)',
          '''level_3_descriptor'', cr.level_3_descriptor, ''level_4_descriptor'', cr.level_4_descriptor,',
          '''level_3_descriptor'', cr.level_3_descriptor, ''level_4_descriptor'', cr.level_4_descriptor,
                                      ''level_5_descriptor'', cr.level_5_descriptor, ''level_6_descriptor'', cr.level_6_descriptor,'],
    array['public.duplicate_course(uuid,uuid)',
          'insert into rubric (id, course_id, name, style) values (_new_id, _new_course, _row.name, _row.style);',
          'insert into rubric (id, course_id, name, style, scale) values (_new_id, _new_course, _row.name, _row.style, _row.scale);'],
    array['public.duplicate_course(uuid,uuid)',
          'level_1_value, weight, display_order)
        values (_new_id, (_rubric_map ->> _row.rubric_id::text)::uuid, _row.name,',
          'level_1_value, weight, display_order,
            level_5_descriptor, level_6_descriptor)
        values (_new_id, (_rubric_map ->> _row.rubric_id::text)::uuid, _row.name,'],
    array['public.duplicate_course(uuid,uuid)',
          '_row.weight, _row.display_order);
        _crit_map := _crit_map',
          '_row.weight, _row.display_order,
            _row.level_5_descriptor, _row.level_6_descriptor);
        _crit_map := _crit_map'],
    array['public.import_json_restore(jsonb,uuid)',
          'insert into rubric (id, course_id, name, style)
        values ((_row->>''id'')::uuid, (_row->>''course_id'')::uuid, coalesce(_row->>''name'',''''),
                coalesce(_row->>''style'',''standard''))
        on conflict (id) do update set name=excluded.name, style=excluded.style, updated_at=now();',
          'insert into rubric (id, course_id, name, style, scale)
        values ((_row->>''id'')::uuid, (_row->>''course_id'')::uuid, coalesce(_row->>''name'',''''),
                coalesce(_row->>''style'',''standard''),
                case when jsonb_typeof(_row->''scale'') = ''array'' then _row->''scale'' end)
        on conflict (id) do update set name=excluded.name, style=excluded.style, scale=excluded.scale, updated_at=now();'],
    array['public.import_json_restore(jsonb,uuid)',
          'level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order)
        values ((_row->>''id'')::uuid, (_row->>''rubric_id'')::uuid,',
          'level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order,
          level_5_descriptor, level_6_descriptor)
        values ((_row->>''id'')::uuid, (_row->>''rubric_id'')::uuid,'],
    array['public.import_json_restore(jsonb,uuid)',
          'coalesce((_row->>''level_1_value'')::numeric, 1),
                coalesce((_row->>''weight'')::numeric, 1.0),
                coalesce((_row->>''display_order'')::int, 0))
        on conflict (id) do update set',
          'coalesce((_row->>''level_1_value'')::numeric, 1),
                coalesce((_row->>''weight'')::numeric, 1.0),
                coalesce((_row->>''display_order'')::int, 0),
                _row->>''level_5_descriptor'', _row->>''level_6_descriptor'')
        on conflict (id) do update set'],
    array['public.import_json_restore(jsonb,uuid)',
          'level_2_descriptor=excluded.level_2_descriptor, level_1_descriptor=excluded.level_1_descriptor,',
          'level_2_descriptor=excluded.level_2_descriptor, level_1_descriptor=excluded.level_1_descriptor,
          level_5_descriptor=excluded.level_5_descriptor, level_6_descriptor=excluded.level_6_descriptor,']
  ];
  _def text;
  _hits int;
  _fn text := '';
  i int;
begin
  -- Edits to one function are applied to its text together, then the
  -- function is replaced once.
  for i in 1 .. array_length(_edits, 1) loop
    if _edits[i][1] <> _fn then
      if _fn <> '' then execute _def; end if;
      _fn := _edits[i][1];
      _def := pg_get_functiondef(_fn::regprocedure);
    end if;
    _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
    if _hits <> 1 then
      raise exception '% has % matches for "%", expected 1', _edits[i][1], _hits, _edits[i][2];
    end if;
    _def := replace(_def, _edits[i][2], _edits[i][3]);
  end loop;
  execute _def;
end
$migration$;

-- The new upsert_rubric has p_scale; the eight-argument one goes, so
-- PostgREST has one function to call. Older clients name no p_scale and
-- still match the new one.
drop function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb);
revoke all on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb)
  to authenticated, service_role;

commit;
