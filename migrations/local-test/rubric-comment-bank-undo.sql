-- Undo for migrations/2026112601_rubric_comment_bank.sql (2026-11-26).
--
-- == Which lever: PART 0 first ==
-- PART 0 deletes nothing. PART 1 deletes every banked comment, and refuses while one is kept.
--
-- == PART 0, the stop that deletes nothing (recommended) ==
-- Puts upsert_rubric's body back word for word as live had it before the file, under the ten-argument name
-- (it takes p_overall_comments and ignores it), so every rubric save is again exactly as before the file:
-- the "comments" key and p_overall_comments are ignored and the bank is left as it is. Add to Bank
-- (add_criterion_comment, add_rubric_overall_comment) is refused to teachers; the app's queued adds then
-- wait on the sync dot. The two columns, what they hold, and what get_class_bundle, duplicate_course and
-- import_json_restore do with them stay. Run PART 0 alone (from "PART 0 begins" to "PART 0 ends"). On a
-- database without the file it changes nothing; a second run changes nothing.
--
-- == PART 1, the full removal: the rest of this file ==
-- Brings back the nine-argument upsert_rubric as live had it (same grants), drops the ten-argument one, the
-- two Add to Bank functions and the rule for a list, puts get_class_bundle, duplicate_course and
-- import_json_restore back word for word (the edits reversed, then checked against the md5 live had), and
-- drops the two columns with their checks. Dropping a column leaves one dropped-column slot on its table.
-- It runs after PART 0 or without it. Run whole, the file is PART 0 and then PART 1.
--
-- == What PART 1 refuses ==
-- It stops with nothing changed while any criterion holds a comment or any rubric an overall comment:
-- dropping the columns would delete them. Teachers would lose what they wrote. Take a backup first; then,
-- only on purpose, empty the bank:
--     update public.criterion set comments = '[]'::jsonb where comments <> '[]'::jsonb;
--     update public.rubric set overall_comments = '[]'::jsonb where overall_comments <> '[]'::jsonb;
-- Each touched row moves its class's sync cursor, so open devices reload the class. No grade is touched.
-- It locks criterion and rubric (share row exclusive) before it counts, so nothing is written between the
-- count and the drop; a save waits for it, or it gives up after five seconds with nothing changed. It also
-- stops if a function is neither as before the file nor as the file (or PART 0) left it.
-- On a database where the file was never applied it changes nothing; a second run changes nothing.

-- PART 0 begins
begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $stop$
declare
    _f   record;
    _md5 text;
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-stop
        ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)', '9ee43afa5a004f1eb49c19ea066b4f09', '7ca85e457eb33b2e08f685608f5fafb8')
        -- FINGERPRINTS-END
    ) as v(fn, now, stopped) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is null then
            return;   -- the file was never applied, or is already removed
        end if;
        if _md5 is distinct from _f.now and _md5 is distinct from _f.stopped then
            raise exception '% is neither the file''s definition nor PART 0''s (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
        if _md5 = _f.now then
            execute $def$
-- STOPPED-DEFINITION-BEGIN
CREATE OR REPLACE FUNCTION public.upsert_rubric(p_id uuid, p_course_id uuid, p_name text, p_criteria jsonb, p_copy_group uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_style text DEFAULT NULL::text, p_linked_tag_ids jsonb DEFAULT NULL::jsonb, p_scale jsonb DEFAULT NULL::jsonb, p_overall_comments jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

    if p_scale is not null and (jsonb_typeof(p_scale) <> 'array'
                                 or jsonb_array_length(p_scale) not in (0, 2, 3, 4, 5, 6)) then
        raise exception 'p_scale must be an array of 2 to 6 levels, or empty' using errcode = '22023';
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

        insert into rubric (course_id, name, copy_group, style, scale)
        values (p_course_id, p_name, p_copy_group, coalesce(p_style, 'standard'),
                case when jsonb_array_length(coalesce(p_scale, '[]'::jsonb)) = 0 then null else p_scale end)
        returning id into _rubric_id;
    else
        -- A copy group is only ever set, never cleared, by a save. A save
        -- that names no style keeps the rubric's.
        update rubric set name = p_name, copy_group = coalesce(p_copy_group, copy_group),
                          style = coalesce(p_style, style),
                          scale = case when p_scale is null then scale
                                       when jsonb_array_length(p_scale) = 0 then null
                                       else p_scale end,
                          updated_at = now()
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
                level_5_descriptor = _elem->>'level_5_descriptor',
                level_6_descriptor = _elem->>'level_6_descriptor',
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
                weight, display_order, level_5_descriptor, level_6_descriptor
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
                coalesce((_elem->>'display_order')::int, 0),
                _elem->>'level_5_descriptor', _elem->>'level_6_descriptor'
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
                if _level is null or _level < 1
                   or _level > (case when (select scale from rubric where id = _rubric_id) is not null
                                     then 6 else 4 end) then
                    raise exception 'check level must be 1..4, or 1..6 on a rubric with its own levels' using errcode = '22023';
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
-- STOPPED-DEFINITION-END
$def$;
        end if;
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.stopped then
            raise exception '% did not come out as PART 0 writes it. Nothing was changed.', _f.fn;
        end if;
    end loop;
    revoke execute on function public.add_criterion_comment(uuid, smallint, text, uuid) from authenticated;
    revoke execute on function public.add_rubric_overall_comment(uuid, text, uuid) from authenticated;
end
$stop$;

commit;
-- PART 0 ends

-- PART 1 begins
begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

-- Held to the end: no comment is written between the count below and the drop.
lock table public.criterion, public.rubric in share row exclusive mode;

do $guard$
declare
    _f   record;
    _md5 text;
    _n   int;
    _m   int;
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-new
        ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)', '9ee43afa5a004f1eb49c19ea066b4f09', '7ca85e457eb33b2e08f685608f5fafb8'),
        ('public._rubric_comment_list(jsonb,integer)', '3c09d92742de880fac5cafa2657a6f99', '3c09d92742de880fac5cafa2657a6f99'),
        ('public.add_criterion_comment(uuid,smallint,text,uuid)', 'bb89f9e27e67e91b03606cd753b2a19a', 'bb89f9e27e67e91b03606cd753b2a19a'),
        ('public.add_rubric_overall_comment(uuid,text,uuid)', 'f39938dae40b2c981c43f76a1b934640', 'f39938dae40b2c981c43f76a1b934640')
        -- FINGERPRINTS-END
    ) as v(fn, now, alt) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.now and _md5 is distinct from _f.alt then
            raise exception '% is neither absent nor this file''s definition (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-dropped
        ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)', '8346ff56ec20239d3289f641597401d4')
        -- FINGERPRINTS-END
    ) as v(fn, before) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.before then
            raise exception '% is neither absent nor as live had it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-replaced
        ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311', '481cba076e47cf26dbd523cfe7943d2e'),
        ('public.duplicate_course(uuid,uuid)', '27a2bdb32de32b2c2eea29e45bd7186d', '07496e59952ea9fddc55373e21322b09'),
        ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976', 'c2943dda03581e9397b1d5e3e44ec5d6')
        -- FINGERPRINTS-END
    ) as v(fn, before, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.before and _md5 is distinct from _f.now then
            raise exception '% is neither as before the file nor as the file left it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    _n := 0; _m := 0;
    if exists (select 1 from pg_attribute where attrelid = 'public.criterion'::regclass and attname = 'comments' and not attisdropped) then
        execute 'select count(*) from public.criterion where comments <> ''[]''::jsonb' into _n;
    end if;
    if exists (select 1 from pg_attribute where attrelid = 'public.rubric'::regclass and attname = 'overall_comments' and not attisdropped) then
        execute 'select count(*) from public.rubric where overall_comments <> ''[]''::jsonb' into _m;
    end if;
    if _n > 0 or _m > 0 then
        raise exception '% criteria hold banked comments and % rubrics hold overall comments: dropping the columns would delete them. Back them up and empty them first (see the top of this file). Nothing was changed.', _n, _m;
    end if;
end
$guard$;

-- The nine-argument upsert_rubric as live had it, then the new functions go.
do $restore$
begin
    if to_regprocedure('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)') is null then
        execute $def$
-- OLD-DEFINITION-BEGIN
CREATE OR REPLACE FUNCTION public.upsert_rubric(p_id uuid, p_course_id uuid, p_name text, p_criteria jsonb, p_copy_group uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_style text DEFAULT NULL::text, p_linked_tag_ids jsonb DEFAULT NULL::jsonb, p_scale jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

    if p_scale is not null and (jsonb_typeof(p_scale) <> 'array'
                                 or jsonb_array_length(p_scale) not in (0, 2, 3, 4, 5, 6)) then
        raise exception 'p_scale must be an array of 2 to 6 levels, or empty' using errcode = '22023';
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

        insert into rubric (course_id, name, copy_group, style, scale)
        values (p_course_id, p_name, p_copy_group, coalesce(p_style, 'standard'),
                case when jsonb_array_length(coalesce(p_scale, '[]'::jsonb)) = 0 then null else p_scale end)
        returning id into _rubric_id;
    else
        -- A copy group is only ever set, never cleared, by a save. A save
        -- that names no style keeps the rubric's.
        update rubric set name = p_name, copy_group = coalesce(p_copy_group, copy_group),
                          style = coalesce(p_style, style),
                          scale = case when p_scale is null then scale
                                       when jsonb_array_length(p_scale) = 0 then null
                                       else p_scale end,
                          updated_at = now()
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
                level_5_descriptor = _elem->>'level_5_descriptor',
                level_6_descriptor = _elem->>'level_6_descriptor',
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
                weight, display_order, level_5_descriptor, level_6_descriptor
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
                coalesce((_elem->>'display_order')::int, 0),
                _elem->>'level_5_descriptor', _elem->>'level_6_descriptor'
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
                if _level is null or _level < 1
                   or _level > (case when (select scale from rubric where id = _rubric_id) is not null
                                     then 6 else 4 end) then
                    raise exception 'check level must be 1..4, or 1..6 on a rubric with its own levels' using errcode = '22023';
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
-- OLD-DEFINITION-END
$def$;
    end if;
end
$restore$;
revoke all on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb) to authenticated, service_role;
drop function if exists public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text, jsonb, jsonb, jsonb);
drop function if exists public.add_criterion_comment(uuid, smallint, text, uuid);
drop function if exists public.add_rubric_overall_comment(uuid, text, uuid);

-- The three patched in place: each edit reversed, in reverse order, each found exactly once. A function
-- already as live had it is skipped.
do $migration$
declare
  _edits text[][] := array[
    -- function, text the file wrote, text live had
    array['public.import_json_restore(jsonb,uuid)',
          'level_5_descriptor=excluded.level_5_descriptor, level_6_descriptor=excluded.level_6_descriptor,
          comments=excluded.comments,',
          'level_5_descriptor=excluded.level_5_descriptor, level_6_descriptor=excluded.level_6_descriptor,'],
    array['public.import_json_restore(jsonb,uuid)',
          '_row->>''level_5_descriptor'', _row->>''level_6_descriptor'',
                case when jsonb_typeof(_row->''comments'') = ''array''
                     then public._rubric_comment_list(_row->''comments'',
                              case when (select scale from rubric where id = (_row->>''rubric_id'')::uuid) is not null then 6 else 4 end)
                     else ''[]''::jsonb end)',
          '_row->>''level_5_descriptor'', _row->>''level_6_descriptor'')'],
    array['public.import_json_restore(jsonb,uuid)',
          'level_5_descriptor, level_6_descriptor, comments)',
          'level_5_descriptor, level_6_descriptor)'],
    array['public.import_json_restore(jsonb,uuid)',
          'scale=excluded.scale, overall_comments=excluded.overall_comments, updated_at=now();',
          'scale=excluded.scale, updated_at=now();'],
    array['public.import_json_restore(jsonb,uuid)',
          'case when jsonb_typeof(_row->''scale'') = ''array'' then _row->''scale'' end,
                case when jsonb_typeof(_row->''overall_comments'') = ''array''
                     then public._rubric_comment_list(_row->''overall_comments'', null) else ''[]''::jsonb end)',
          'case when jsonb_typeof(_row->''scale'') = ''array'' then _row->''scale'' end)'],
    array['public.import_json_restore(jsonb,uuid)',
          'insert into rubric (id, course_id, name, style, scale, overall_comments)',
          'insert into rubric (id, course_id, name, style, scale)'],
    array['public.duplicate_course(uuid,uuid)',
          '_row.level_5_descriptor, _row.level_6_descriptor, _row.comments);',
          '_row.level_5_descriptor, _row.level_6_descriptor);'],
    array['public.duplicate_course(uuid,uuid)',
          'level_5_descriptor, level_6_descriptor, comments)',
          'level_5_descriptor, level_6_descriptor)'],
    array['public.duplicate_course(uuid,uuid)',
          'insert into rubric (id, course_id, name, style, scale, overall_comments) values (_new_id, _new_course, _row.name, _row.style, _row.scale, _row.overall_comments);',
          'insert into rubric (id, course_id, name, style, scale) values (_new_id, _new_course, _row.name, _row.style, _row.scale);'],
    array['public.get_class_bundle(uuid,bigint)',
          '''weight'', c.weight, ''display_order'', c.display_order, ''comments'', c.comments
',
          '''weight'', c.weight, ''display_order'', c.display_order
'],
    array['public.get_class_bundle(uuid,bigint)',
          '''copy_group'', r.copy_group, ''style'', r.style, ''scale'', r.scale,
                                                ''overall_comments'', r.overall_comments)',
          '''copy_group'', r.copy_group, ''style'', r.style, ''scale'', r.scale)']  ];
  _def  text;
  _hits int;
  _fn   text := '';
  _skip boolean := false;
  i     int;
begin
  for i in 1 .. array_length(_edits, 1) loop
    if _edits[i][1] <> _fn then
      if _fn <> '' and not _skip then execute _def; end if;
      _fn := _edits[i][1];
      _def := pg_get_functiondef(_fn::regprocedure);
      _skip := md5(_def) = (select v.before from (values
          -- FINGERPRINTS-BEGIN undo-before
          ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311'),
          ('public.duplicate_course(uuid,uuid)', '27a2bdb32de32b2c2eea29e45bd7186d'),
          ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976')
          -- FINGERPRINTS-END
        ) as v(fn, before) where v.fn = _fn);
    end if;
    if not _skip then
      _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
      if _hits <> 1 then
        raise exception '% has % matches for "%", expected 1. Nothing was changed.', _fn, _hits, _edits[i][2];
      end if;
      _def := replace(_def, _edits[i][2], _edits[i][3]);
    end if;
  end loop;
  if not _skip then execute _def; end if;
end
$migration$;

drop function if exists public._rubric_comment_list(jsonb, integer);
alter table public.criterion drop constraint if exists criterion_comments_is_list;
alter table public.criterion drop column if exists comments;
alter table public.rubric drop constraint if exists rubric_overall_comments_is_list;
alter table public.rubric drop column if exists overall_comments;

do $final$
declare
    _f   record;
    _md5 text;
    _bad text[] := '{}';
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-after
        ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311'),
        ('public.duplicate_course(uuid,uuid)', '27a2bdb32de32b2c2eea29e45bd7186d'),
        ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976'),
        ('public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)', '8346ff56ec20239d3289f641597401d4')
        -- FINGERPRINTS-END
    ) as v(fn, before) loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.before);
        end if;
    end loop;
    if exists (select 1 from pg_attribute where attrelid = 'public.criterion'::regclass and attname = 'comments' and not attisdropped)
       or exists (select 1 from pg_attribute where attrelid = 'public.rubric'::regclass and attname = 'overall_comments' and not attisdropped)
       or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('add_criterion_comment', 'add_rubric_overall_comment', '_rubric_comment_list'))
       or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'upsert_rubric') <> 1 then
        _bad := _bad || 'something of the file is still there'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as before the file (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
-- PART 1 ends
