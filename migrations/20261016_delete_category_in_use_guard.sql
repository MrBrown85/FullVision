-- A category can't be deleted while assessments still use it, unless it is
-- the class's last category (2026-10-16, docs/grading-compliance-plan.md 1.4).
--
-- `assessment.category_id` is `on delete set null`, so deleting a category
-- left its work with no category. In a class that still has categories that
-- work counts toward no letter grade. Schoology blocks the delete until the
-- work is moved; the client now moves it first, and this guard stops an
-- older client (or a lost move) from orphaning work. Deleting the last
-- category is fine: a class with none counts all work by total points.
create or replace function public.delete_category(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _course uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    select course_id into _course from category where id = p_id;
    if _course is not null
       and exists (select 1 from assessment where category_id = p_id)
       and exists (select 1 from category where course_id = _course and id <> p_id) then
        raise exception 'category in use: move its assessments to another category first'
            using errcode = 'P0001';
    end if;

    delete from category where id = p_id;
    if not found then
        raise exception 'category not found' using errcode = 'P0002';
    end if;
end;
$function$;
