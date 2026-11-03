-- Whole-rubric competencies (2026-11-03, rubric starts PR 6).
-- A rubric can link a competency to the whole rubric instead of to one
-- criterion: the competency then gets one combined score per student per
-- assessment (the rubric's weighted average, read through the class's
-- Points to Proficiency table, in shared/calc.js). rubric_tag holds those
-- links, as criterion_tag holds a criterion's. Grades are worked out on the
-- client; this table only stores the links.
--
-- upsert_rubric takes p_linked_tag_ids: null keeps the stored links (a
-- client that doesn't send it changes nothing), an array replaces them. Its
-- old signature is dropped so PostgREST has one function to choose
-- (PGRST203). get_class_bundle returns the rows; duplicate_course and
-- import_json_restore copy them. delete_rubric needs nothing: the rows
-- cascade with the rubric.

create table if not exists public.rubric_tag (
    rubric_id uuid not null references public.rubric(id) on delete cascade,
    tag_id    uuid not null references public.tag(id) on delete cascade,
    primary key (rubric_id, tag_id)
);
comment on table public.rubric_tag is
    'Competencies a whole rubric scores: one combined score per student per assessment. A competency is linked to the whole rubric or to its criteria (criterion_tag), never both.';
create index if not exists rubric_tag_tag_idx on public.rubric_tag (tag_id);

alter table public.rubric_tag enable row level security;
drop policy if exists rubric_tag_via_parents on public.rubric_tag;
create policy rubric_tag_via_parents on public.rubric_tag
    using (exists (select 1 from public.rubric r
                    where r.id = rubric_tag.rubric_id and fv_owns_course(r.course_id)))
    with check (exists (select 1 from public.rubric r
                         where r.id = rubric_tag.rubric_id and fv_owns_course(r.course_id)));

revoke all on public.rubric_tag from public, anon, service_role;
grant select, insert, update, delete on public.rubric_tag to authenticated;

drop trigger if exists course_sync_cursor_rubric_tag_gradebook on public.rubric_tag;
create trigger course_sync_cursor_rubric_tag_gradebook
    after insert or delete or update on public.rubric_tag
    for each row execute function _touch_course_sync_cursor_from_trigger('gradebook', 'rubric');

drop function if exists public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text);

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

revoke all on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb) to authenticated, service_role;

do $patch$
declare
    _def text;
    _new text;
    _n int;
begin
    -- get_class_bundle: the rubric_tag rows, beside criterion_tags.
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$        'criterion_checks', coalesce(($s$,
        $s$        'rubric_tags', coalesce((
            select jsonb_agg(jsonb_build_object('rubric_id', rt.rubric_id, 'tag_id', rt.tag_id))
              from public.rubric_tag rt
              join public.rubric r on r.id = rt.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_checks', coalesce(($s$);
    if _new = _def then raise exception 'get_class_bundle: criterion_checks block not found'; end if;
    execute _new;

    -- duplicate_course: copy them with the rubric and tag maps.
    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$    -- Advanced Rubrics: the checkboxes go with their criteria.$s$,
        $s$    -- Competencies a whole rubric scores.
    insert into rubric_tag (rubric_id, tag_id)
    select (_rubric_map ->> rt.rubric_id::text)::uuid,
           (_tag_map    ->> rt.tag_id::text)::uuid
    from rubric_tag rt
    join rubric r on r.id = rt.rubric_id
    where r.course_id = p_src_id
      and (_rubric_map ->> rt.rubric_id::text) is not null
      and (_tag_map    ->> rt.tag_id::text) is not null;

    -- Advanced Rubrics: the checkboxes go with their criteria.$s$);
    if _new = _def then raise exception 'duplicate_course: checkbox copy not found'; end if;
    execute _new;

    -- import_json_restore: restore them from the payload's rubric_tags.
    _def := pg_get_functiondef('public.import_json_restore(jsonb, uuid)'::regprocedure);
    _new := replace(_def,
        $s$    -- An Advanced Rubric's checkboxes.$s$,
        $s$    -- Competencies a whole rubric scores.
    if p_payload ? 'rubric_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'rubric_tags') loop
        insert into rubric_tag (rubric_id, tag_id)
        values ((_row->>'rubric_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    -- An Advanced Rubric's checkboxes.$s$);
    if _new = _def then raise exception 'import_json_restore: checkbox restore not found'; end if;
    execute _new;

    select count(*) into _n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_rubric';
    if _n <> 1 then raise exception 'upsert_rubric: expected 1 overload, found %', _n; end if;
end
$patch$;
