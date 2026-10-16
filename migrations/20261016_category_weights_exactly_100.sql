-- The category weight-sum check becomes "exactly 100" (2026-10-16,
-- docs/grading-compliance-plan.md D1, follow-up to
-- 20261016_category_weights_total_100.sql).
--
-- That migration made the trigger deferred but kept "at most 100", because
-- the client live then saved one category row at a time. The client now
-- saves the whole list through save_categories, so the server backstop can
-- match: a class's weights total 100, or it has no categories.
--
-- The triggers are unchanged: inserts and deletes always fire, updates only
-- when a weight or course changes. A class saved under the old rule (on
-- 2026-10-16 only Humanities 8, at 0/0) can still be renamed and reordered,
-- and its next weight save has to reach 100.

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
    if n > 0 and total <> 100 then
        raise exception 'category weights for course % total % (must be 100)', target_course, total
            using errcode = '23514';  -- check_violation
    end if;
    -- A row that moved to another class leaves the old one changed too.
    if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
        select coalesce(sum(weight), 0), count(*) into total, n from category where course_id = old.course_id;
        if n > 0 and total <> 100 then
            raise exception 'category weights for course % total % (must be 100)', old.course_id, total
                using errcode = '23514';
        end if;
    end if;
    return null;
end;
$function$;
