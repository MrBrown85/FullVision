-- A class's category weights must total exactly 100 (2026-10-16,
-- docs/grading-compliance-plan.md D1, as in Microsoft Teams).
--
-- The old rule was "at most 100", checked after every row, so a class could
-- run at 80% and the letter grade quietly renormalized. "Exactly 100" can't
-- be kept row by row: going from 50/50 to 60/40 passes through 110 or 90.
--
--   * save_categories writes a class's whole category list in one call:
--     rows with an id are updated, rows without one are inserted, and the
--     class's other categories are deleted. The list must total 100, or be
--     empty (a class with no categories counts all work by total points).
--     A category being deleted must have no assessments, unless every
--     category goes (delete_category's rule); the client moves work first.
--   * The weight-sum trigger becomes a deferred constraint trigger, checked
--     at commit, so save_categories can pass through 110 on the way.
--     It still enforces "at most 100", not "exactly 100": the client
--     deployed today saves one row at a time through upsert_category, and an
--     exact check would refuse its edits until the new client ships. Once it
--     has, a follow-up migration changes `total > 100` to `total <> 100`.
--     Renames and reorders don't change a weight and don't fire it.

create or replace function public.fv_check_category_weight_sum()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
    target_course uuid;
    total numeric;
    n int;
begin
    if tg_op = 'DELETE' then
        target_course := old.course_id;
    else
        target_course := new.course_id;
    end if;
    select coalesce(sum(weight), 0), count(*) into total, n from category where course_id = target_course;
    if n > 0 and total > 100 then
        raise exception 'category weights for course % total % (max 100)', target_course, total
            using errcode = '23514';  -- check_violation
    end if;
    return null;
end;
$function$;

drop trigger if exists category_weight_sum_check on public.category;
drop trigger if exists category_weight_sum_check_update on public.category;

create constraint trigger category_weight_sum_check
    after insert or delete on public.category
    deferrable initially deferred
    for each row execute function public.fv_check_category_weight_sum();

create constraint trigger category_weight_sum_check_update
    after update on public.category
    deferrable initially deferred
    for each row
    when (old.weight is distinct from new.weight or old.course_id is distinct from new.course_id)
    execute function public.fv_check_category_weight_sum();

-- p_categories: [{ id?: uuid, name: text, weight: numeric }, ...] in display
-- order. Returns the ids in the same order (new rows get theirs here).
create or replace function public.save_categories(p_course_id uuid, p_categories jsonb)
 returns uuid[]
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _row jsonb;
    _id uuid;
    _name text;
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
        _id := nullif(_row->>'id', '')::uuid;
        if _id is null then
            insert into category (course_id, name, weight, display_order)
            values (p_course_id, _name, coalesce((_row->>'weight')::numeric, 0), _ord)
            returning id into _id;
        else
            update category set
                name = _name,
                weight = coalesce((_row->>'weight')::numeric, 0),
                display_order = _ord,
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

revoke execute on function public.save_categories(uuid, jsonb) from public, anon;
grant execute on function public.save_categories(uuid, jsonb) to authenticated;
