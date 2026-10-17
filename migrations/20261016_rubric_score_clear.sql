-- Clearing a rubric criterion score deletes it (2026-10-16, write-path audit
-- finding 15).
--
-- The client clears a criterion by sending value 0, as it does for a
-- competency (upsert_tag_score deletes on 0). upsert_rubric_score tried to
-- store the 0, which rubric_score_value_check (value between 1 and 4)
-- rejects, so the clear never reached the server and the old level came
-- back on the next load. A null or 0 now deletes the row; fill_rubric with
-- 0 clears every criterion the same way. Same signature, so no client
-- change is needed.
create or replace function public.upsert_rubric_score(
    p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid, p_value integer, p_modifier smallint default 0
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_value is null or p_value = 0 then
        delete from rubric_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
        return null;
    end if;

    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value, coalesce(p_modifier, 0))
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value, modifier = excluded.modifier, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

notify pgrst, 'reload schema';
