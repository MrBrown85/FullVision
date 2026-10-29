-- A category's Calculation: Total Points or Average of Percentages (2026-10-29).
--
-- Rubric work counts as the sum of its criteria's points, so a 5-criterion
-- rubric (20 points) outweighed a 2-criterion one (8 points) 2.5 to 1 in the
-- same category. Easton Su's History 12 % was 66.2% (C) because his weakest
-- work, Current Events, had the most criteria; counted one assessment each it
-- is about 68% (C+). MyEd BC ("Categories Only") and Schoology ("Percentage")
-- let a category average each assessment's percent instead. Plan:
-- ~/fullvision-rubric-weight-plan.md, PR 2 (data); the math and the setting
-- come in PR 3.
--
--   category.calc_mode  'points'   points earned ÷ points possible, as now
--                       'percent'  each assessment's percent, averaged,
--                                  each counted its Factor times
--
-- Every existing category is 'points', so no grade moves.
--
-- save_categories reads an optional calc_mode on each row. Left out, a new
-- row is 'points' and an existing row keeps its mode, so a tab still running
-- the old client can't reset a teacher's choice. Anything else is refused.
-- list_categories returns it (its return type changes, so it is dropped and
-- made again with the same grants). get_class_bundle and get_gradebook
-- return it on each category; they are patched in place from their live
-- bodies, as 20261027_assessment_core_competencies.sql does, and each anchor
-- must be found once or the migration stops. bundle_schema stays 3 because
-- the field is additive. A category update already moves the class's sync
-- cursor (course_sync_cursor_category_gradebook), so other devices load it.

alter table public.category
    add column if not exists calc_mode text not null default 'points';
alter table public.category drop constraint if exists category_calc_mode_check;
alter table public.category
    add constraint category_calc_mode_check check (calc_mode in ('points', 'percent'));

-- ── save_categories ─────────────────────────────────────────────────────────
create or replace function public.save_categories(p_course_id uuid, p_categories jsonb)
 returns uuid[]
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _row jsonb;
    _id uuid;
    _name text;
    _mode text;
    _ids uuid[] := '{}';
    _keep uuid[];
    _ord int := 0;
    _total numeric;
    _count int;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_categories is null or jsonb_typeof(p_categories) <> 'array' then
        raise exception 'categories must be an array' using errcode = '22023';
    end if;

    perform 1 from course
     where id = p_course_id and teacher_id = (select auth.uid()) and deleted_at is null;
    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(coalesce((e->>'weight')::numeric, 0)), 0), count(*)
      into _total, _count
      from jsonb_array_elements(p_categories) e;
    if _count > 0 and _total <> 100 then
        raise exception 'category weights must total 100 (they total %)', _total
            using errcode = '23514';
    end if;

    select coalesce(array_agg((e->>'id')::uuid), '{}')
      into _keep
      from jsonb_array_elements(p_categories) e
     where nullif(e->>'id', '') is not null;

    if _count > 0 and exists (
        select 1 from category c
         where c.course_id = p_course_id
           and not (c.id = any (_keep))
           and exists (select 1 from assessment a where a.category_id = c.id)
    ) then
        raise exception 'category in use: move its assessments to another category first'
            using errcode = 'P0001';
    end if;

    delete from category c where c.course_id = p_course_id and not (c.id = any (_keep));

    for _row in select * from jsonb_array_elements(p_categories) loop
        _name := btrim(coalesce(_row->>'name', ''));
        if _name = '' then
            raise exception 'every category needs a name' using errcode = '22023';
        end if;
        _mode := nullif(_row->>'calc_mode', '');
        if _mode is not null and _mode not in ('points', 'percent') then
            raise exception 'calc_mode must be points or percent' using errcode = '22023';
        end if;
        _id := nullif(_row->>'id', '')::uuid;
        if _id is null then
            insert into category (course_id, name, weight, display_order, calc_mode)
            values (p_course_id, _name, coalesce((_row->>'weight')::numeric, 0), _ord,
                    coalesce(_mode, 'points'))
            returning id into _id;
        else
            update category set
                name = _name,
                weight = coalesce((_row->>'weight')::numeric, 0),
                display_order = _ord,
                calc_mode = coalesce(_mode, calc_mode),
                updated_at = now()
             where id = _id and course_id = p_course_id;
            if not found then
                raise exception 'category not found' using errcode = 'P0002';
            end if;
        end if;
        _ids := _ids || _id;
        _ord := _ord + 1;
    end loop;

    return _ids;
end;
$function$;

-- ── list_categories ─────────────────────────────────────────────────────────
drop function if exists public.list_categories(uuid);
create function public.list_categories(p_course_id uuid)
 returns table(id uuid, course_id uuid, name text, weight numeric, display_order integer,
               calc_mode text, created_at timestamp with time zone, updated_at timestamp with time zone)
 language sql
 set search_path to 'public'
as $function$
    select id, course_id, name, weight, display_order, calc_mode, created_at, updated_at
    from category
    where course_id = p_course_id
    order by display_order asc, created_at asc;
$function$;
revoke execute on function public.list_categories(uuid) from public, anon;
grant execute on function public.list_categories(uuid) to authenticated, service_role;

-- ── get_class_bundle and get_gradebook return calc_mode ────────────────────
do $patch$
declare
    _def text;
    _new text;
    _anchor text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _anchor := $s$'display_order', c.display_order) order by c.display_order)$s$;
    if (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
        raise exception 'get_class_bundle: category display_order anchor not found exactly once';
    end if;
    _new := replace(_def, _anchor,
        $s$'display_order', c.display_order, 'calc_mode', c.calc_mode) order by c.display_order)$s$);
    execute _new;

    _def := pg_get_functiondef('public.get_gradebook(uuid)'::regprocedure);
    _anchor := $s$'weight', cat.weight, 'display_order', cat.display_order$s$;
    if (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
        raise exception 'get_gradebook: category weight anchor not found exactly once';
    end if;
    _new := replace(_def, _anchor,
        $s$'weight', cat.weight, 'display_order', cat.display_order, 'calc_mode', cat.calc_mode$s$);
    execute _new;
end
$patch$;
