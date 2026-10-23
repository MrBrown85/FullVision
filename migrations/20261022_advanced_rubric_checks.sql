-- Advanced Rubrics: checkboxes inside each level cell (2026-10-22, Rubric
-- Bank plan §5, PR 7).
--
-- An Advanced Rubric is a rubric whose level cells hold checkboxes as well as
-- a descriptor. While scoring, the teacher ticks what they saw and the client
-- suggests the level: the highest level whose boxes are all ticked. It is a
-- kind of rubric, not a new scoring mode: the chosen level still lands in
-- rubric_score, so calc.js, competencies, reports and the printed Overall are
-- untouched. Nothing records whether a level came from the checks or by hand;
-- the client compares the current level with the suggestion before the last
-- tick (shared/rubric-checks.js).
--
-- What it adds:
--   rubric.style                 'standard' | 'advanced', default 'standard'.
--                                A client reading an older bundle treats a
--                                missing style as 'standard'.
--   criterion_check              one checkbox: criterion, level 1..4, label,
--                                display_order within its level. Cascades
--                                with its criterion.
--   rubric_check_score           (enrollment, assessment, check): a row means
--                                ticked; unticking deletes it. Cascades with
--                                the enrollment, the assessment and the check.
--   set_rubric_check(p_enrollment_id, p_assessment_id, p_check_id, p_on)
--                                Idempotent the way upsert_rubric_score is:
--                                setting a tick that is set, or clearing one
--                                that is clear, changes nothing, so a retry
--                                after a lost 200 is harmless and it needs no
--                                p_idempotency_key. The check must belong to
--                                the assessment's rubric.
--   upsert_rubric                gains p_style; each criterion element may
--                                carry `checks: [{ id?, level, label,
--                                display_order }]`, replaced the way
--                                linked_tag_ids are. An element with no
--                                `checks` key leaves the criterion's checks
--                                alone, so an older client's save loses none.
--   get_class_bundle             rubrics gain `style`; the rubrics block gains
--                                `criterion_checks`; the gradebook block gains
--                                `check_index` and `check_rows`
--                                ([student, assessment, check]). bundle_schema
--                                stays 3: every field is additive.
--   duplicate_course             copies rubric.style and criterion_check rows
--                                with the criteria. (The desktop app's
--                                Duplicate Class copies on the client and does
--                                not call this RPC today; it is patched so the
--                                two stay in step.)
--
-- upsert_rubric and duplicate_course are rewritten in full from the bodies
-- live on gradebook-prod on 2026-10-22 (pg_get_functiondef), with the
-- additions above. get_class_bundle is patched in place from its live body at
-- apply time, as 20261022_score_modifier.sql does, so no part of it is copied
-- from an old migration.
--
-- Test with begin … rollback (or a Supabase branch) before applying to
-- gradebook-prod. No existing data changes: every rubric gets style
-- 'standard' and both new tables start empty.

-- ── rubric.style ─────────────────────────────────────────────────────────────
alter table public.rubric
  add column if not exists style text not null default 'standard'
  constraint rubric_style_check check (style in ('standard', 'advanced'));

comment on column public.rubric.style is
    'standard: one descriptor per level. advanced: checkboxes inside each level cell (criterion_check).';

-- ── criterion_check ──────────────────────────────────────────────────────────
create table if not exists public.criterion_check (
    id            uuid        primary key default gen_random_uuid(),
    criterion_id  uuid        not null references public.criterion(id) on delete cascade,
    level         smallint    not null constraint criterion_check_level_check check (level between 1 and 4),
    label         text        not null,
    display_order integer     not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists criterion_check_criterion_idx on public.criterion_check (criterion_id);

comment on table public.criterion_check is
    'One checkbox in a level cell of an Advanced Rubric criterion. display_order is within its level.';

alter table public.criterion_check enable row level security;

drop policy if exists criterion_check_via_parents on public.criterion_check;
create policy criterion_check_via_parents on public.criterion_check
    for all
    using (exists (select 1 from public.criterion cr join public.rubric r on r.id = cr.rubric_id
                    where cr.id = criterion_check.criterion_id and public.fv_owns_course(r.course_id)))
    with check (exists (select 1 from public.criterion cr join public.rubric r on r.id = cr.rubric_id
                         where cr.id = criterion_check.criterion_id and public.fv_owns_course(r.course_id)));

revoke all on table public.criterion_check from public, anon;
grant select, insert, update, delete on table public.criterion_check to authenticated;

-- A change to a checkbox is a change to the class's rubrics, like a
-- criterion_tag row: bump the class version so other devices reload.
drop trigger if exists course_sync_cursor_criterion_check_gradebook on public.criterion_check;
create trigger course_sync_cursor_criterion_check_gradebook
    after insert or delete or update on public.criterion_check
    for each row execute function public._touch_course_sync_cursor_from_trigger('gradebook', 'criterion');

-- ── rubric_check_score ───────────────────────────────────────────────────────
create table if not exists public.rubric_check_score (
    enrollment_id uuid        not null references public.enrollment(id) on delete cascade,
    assessment_id uuid        not null references public.assessment(id) on delete cascade,
    check_id      uuid        not null references public.criterion_check(id) on delete cascade,
    created_at    timestamptz not null default now(),
    primary key (enrollment_id, assessment_id, check_id)
);

create index if not exists rubric_check_score_assessment_idx on public.rubric_check_score (assessment_id);
create index if not exists rubric_check_score_check_idx on public.rubric_check_score (check_id);

comment on table public.rubric_check_score is
    'A ticked checkbox on one student''s rubric score. A row means ticked; unticking deletes it.';

alter table public.rubric_check_score enable row level security;

drop policy if exists rubric_check_score_via_enrollment on public.rubric_check_score;
create policy rubric_check_score_via_enrollment on public.rubric_check_score
    for all
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));

revoke all on table public.rubric_check_score from public, anon;
grant select, insert, update, delete on table public.rubric_check_score to authenticated;

-- Through the assessment, not the enrollment: the trigger's enrollment
-- branch also reads new.id, which this table has none of.
drop trigger if exists course_sync_cursor_rubric_check_score_gradebook on public.rubric_check_score;
create trigger course_sync_cursor_rubric_check_score_gradebook
    after insert or delete or update on public.rubric_check_score
    for each row execute function public._touch_course_sync_cursor_from_trigger('gradebook', 'assessment');

-- ── set_rubric_check ─────────────────────────────────────────────────────────
create or replace function public.set_rubric_check(
    p_enrollment_id uuid,
    p_assessment_id uuid,
    p_check_id      uuid,
    p_on            boolean
) returns boolean
language plpgsql set search_path to 'public' as $function$
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    -- The check must sit in the rubric the assessment uses. Row security on
    -- the joined tables keeps this to the teacher's own classes.
    if not exists (
        select 1
          from criterion_check ck
          join criterion c on c.id = ck.criterion_id
          join assessment a on a.rubric_id = c.rubric_id
         where ck.id = p_check_id and a.id = p_assessment_id
    ) then
        raise exception 'check % is not in the rubric of assessment %', p_check_id, p_assessment_id
            using errcode = '22023';
    end if;

    if coalesce(p_on, false) then
        insert into rubric_check_score (enrollment_id, assessment_id, check_id)
        values (p_enrollment_id, p_assessment_id, p_check_id)
        on conflict do nothing;
        return true;
    end if;

    delete from rubric_check_score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and check_id = p_check_id;
    return false;
end;
$function$;
revoke all on function public.set_rubric_check(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_rubric_check(uuid, uuid, uuid, boolean) to authenticated;

-- ── upsert_rubric, plus p_style and per-criterion checks ─────────────────────
-- The old signature is dropped first: two overloads differing by a defaulted
-- parameter make PostgREST reject calls as ambiguous. Body from gradebook-prod
-- (2026-10-22) with the style and checks additions.
drop function if exists public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid);

create function public.upsert_rubric(
    p_id                uuid,
    p_course_id         uuid,
    p_name              text,
    p_criteria          jsonb,
    p_copy_group        uuid default null,
    p_idempotency_key   uuid default null,
    p_style             text default null
) returns uuid
language plpgsql set search_path to 'public' as $function$
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

    if p_style is not null and p_style not in ('standard', 'advanced') then
        raise exception 'p_style must be standard or advanced' using errcode = '22023';
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

    if _is_insert then
        perform fv_idem_store(p_idempotency_key, 'upsert_rubric', jsonb_build_object('id', _rubric_id));
    end if;
    return _rubric_id;
end;
$function$;
revoke all on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.upsert_rubric(uuid, uuid, text, jsonb, uuid, uuid, text) to authenticated;

-- ── get_class_bundle: style, criterion_checks, check_index, check_rows ───────
-- Patched in place from the live body; each anchor must be found or the
-- migration stops here.
do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);

    -- The check index, beside the criterion index the score rows point into.
    _new := replace(_def,
        $s$asm_tags as ($s$,
        $s$ck as (
        select ck.id, (row_number() over (order by ck.id) - 1)::int as ix
          from public.criterion_check ck
          join public.criterion c on c.id = ck.criterion_id
          join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    asm_tags as ($s$);
    if _new = _def then raise exception 'get_class_bundle: asm_tags CTE not found'; end if;
    _def := _new;

    _new := replace(_def,
        $s$'criterion_index', coalesce((select jsonb_agg(cr.id order by cr.ix) from cr), '[]'::jsonb),$s$,
        $s$'criterion_index', coalesce((select jsonb_agg(cr.id order by cr.ix) from cr), '[]'::jsonb),
        'check_index', coalesce((select jsonb_agg(ck.id order by ck.ix) from ck), '[]'::jsonb),$s$);
    if _new = _def then raise exception 'get_class_bundle: criterion_index not found'; end if;
    _def := _new;

    -- Ticked checkboxes, after the criterion rows.
    _new := replace(_def,
        $s$join cr on cr.id = r.criterion_id), '[]'::jsonb)$s$,
        $s$join cr on cr.id = r.criterion_id), '[]'::jsonb),
        -- [student, assessment, check]: a ticked checkbox (rubric_check_score)
        'check_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, ck.ix))
              from public.rubric_check_score x
              join enr on enr.id = x.enrollment_id
              join asm on asm.id = x.assessment_id
              join ck on ck.id = x.check_id), '[]'::jsonb)$s$);
    if _new = _def then raise exception 'get_class_bundle: criterion_rows not found'; end if;
    _def := _new;

    -- The rubric's style, with its copy group.
    _new := replace(_def,
        $s$'copy_group', r.copy_group)$s$,
        $s$'copy_group', r.copy_group, 'style', r.style)$s$);
    if _new = _def then raise exception 'get_class_bundle: rubric copy_group not found'; end if;
    _def := _new;

    -- The checkboxes, after criterion_tags.
    _new := replace(_def,
        $s$'[]'::jsonb)
    ) into _rubrics;$s$,
        $s$'[]'::jsonb),
        'criterion_checks', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', ck.id, 'criterion_id', ck.criterion_id, 'level', ck.level,
                       'label', ck.label, 'display_order', ck.display_order
                   ) order by ck.display_order, ck.id)
              from public.criterion_check ck
              join public.criterion c on c.id = ck.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb)
    ) into _rubrics;$s$);
    if _new = _def then raise exception 'get_class_bundle: rubrics block end not found'; end if;

    execute _new;
end
$patch$;

-- ── duplicate_course: style and checks travel with the rubrics ──────────────
-- Body from gradebook-prod (2026-10-22) with rubric.style and the
-- criterion_check copy added.
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
        insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, display_order)
        values (_new_id, (_sect_map ->> _row.section_id::text)::uuid,
            _row.code, _row.label, _row.i_can_text, _row.i_can_statements, _row.source_text, _row.display_order);
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
revoke all on function public.duplicate_course(uuid, uuid) from public, anon;
grant execute on function public.duplicate_course(uuid, uuid) to authenticated;
