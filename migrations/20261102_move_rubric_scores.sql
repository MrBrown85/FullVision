-- Edit a Copy on scored work (assessment form redesign PR 10).
-- The copy's criteria and checkboxes have new ids. This moves one
-- assessment's rubric scores (value, ±, comment, beyond) and ticked
-- checkboxes from the old criteria/checks to the copy's, in one transaction.
-- Nothing is deleted: rows are re-pointed. Other assessments are untouched.
create or replace function public.move_rubric_scores(
    p_assessment_id   uuid,
    p_rubric_id       uuid,
    p_criterion_map   jsonb,          -- { "<old criterion id>": "<new criterion id>" }
    p_check_map       jsonb default '{}'::jsonb,
    p_idempotency_key uuid default null
) returns jsonb
language plpgsql set search_path to 'public' as $function$
declare
    _cached  jsonb;
    _course  uuid;
    _moved   int := 0;
    _checks  int := 0;
    _result  jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if not fv_owns_assessment(p_assessment_id) then
        raise exception 'assessment % not found', p_assessment_id using errcode = '42501';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'move_rubric_scores');
    if _cached is not null then return _cached; end if;

    -- The copy must be a rubric in the assessment's class.
    select a.course_id into _course from assessment a where a.id = p_assessment_id;
    if not exists (select 1 from rubric r where r.id = p_rubric_id and r.course_id = _course) then
        raise exception 'rubric % is not in the class of assessment %', p_rubric_id, p_assessment_id
            using errcode = '22023';
    end if;
    -- Every target criterion is on that rubric; every target check on one of its criteria.
    if exists (
        select 1 from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
         where not exists (select 1 from criterion c where c.id = m.value::uuid and c.rubric_id = p_rubric_id)
    ) then
        raise exception 'a target criterion is not on rubric %', p_rubric_id using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_each_text(coalesce(p_check_map, '{}')) m
         where not exists (
            select 1 from criterion_check ck join criterion c on c.id = ck.criterion_id
             where ck.id = m.value::uuid and c.rubric_id = p_rubric_id)
    ) then
        raise exception 'a target check is not on rubric %', p_rubric_id using errcode = '22023';
    end if;

    update rubric_score rs
       set criterion_id = m.value::uuid, updated_at = now()
      from jsonb_each_text(coalesce(p_criterion_map, '{}')) m
     where rs.assessment_id = p_assessment_id
       and rs.criterion_id = m.key::uuid
       -- a score already on the new criterion (a retry) is left as it is
       and not exists (select 1 from rubric_score x
                        where x.enrollment_id = rs.enrollment_id and x.assessment_id = p_assessment_id
                          and x.criterion_id = m.value::uuid);
    get diagnostics _moved = row_count;

    update rubric_check_score cs
       set check_id = m.value::uuid
      from jsonb_each_text(coalesce(p_check_map, '{}')) m
     where cs.assessment_id = p_assessment_id
       and cs.check_id = m.key::uuid
       and not exists (select 1 from rubric_check_score x
                        where x.enrollment_id = cs.enrollment_id and x.assessment_id = p_assessment_id
                          and x.check_id = m.value::uuid);
    get diagnostics _checks = row_count;

    _result := jsonb_build_object('scores', _moved, 'checks', _checks);
    perform fv_idem_store(p_idempotency_key, 'move_rubric_scores', _result);
    return _result;
end;
$function$;
revoke all on function public.move_rubric_scores(uuid, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.move_rubric_scores(uuid, uuid, jsonb, jsonb, uuid) to authenticated;
