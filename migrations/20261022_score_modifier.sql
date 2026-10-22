-- An assessment's overall score takes + and − too.
--
-- What broke: a proficiency assessment linked to no competency is scored
-- once, on its Overall row, and that score lives in score.value. score had no
-- modifier column (tag_score and rubric_score do), so the app hid the + / −
-- buttons on the Overall row in Assignments, the gradebook and the phone. A
-- teacher could write 3+ on a competency or a rubric criterion but not on an
-- assessment scored as a whole (Colin, 2026-10-22: "the plus minus should be
-- consistent").
--
-- What it adds:
--   score.modifier smallint, -1 / 0 / 1, default 0 (as on tag_score).
--   upsert_score(p_enrollment_id, p_assessment_id, p_value, p_modifier)
--     keeps its first three arguments; p_modifier defaults to null, which
--     saves 0, so upsert_tag_score's call (points and Complete/Incomplete
--     work) and writes already waiting in a device's outbox work as before.
--     A change to the modifier alone is saved too.
--   get_class_bundle's score_rows gain the modifier as a sixth value
--     ([student, assessment, value, status, comment, modifier]); a client
--     that reads five ignores it.
--   get_withdrawn_student_records' scores gain the modifier, so the copy
--     before a permanent delete reads "3+".
-- Patched in place where noted; nothing else about them changes. No existing
-- data changes: every score gets modifier 0.

alter table public.score
  add column if not exists modifier smallint not null default 0
  constraint score_modifier_check check (modifier between -1 and 1);

drop function if exists public.upsert_score(uuid, uuid, numeric);
create function public.upsert_score(p_enrollment_id uuid, p_assessment_id uuid, p_value numeric, p_modifier smallint default null)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _id uuid; _old_v numeric; _old_s text; _old_m smallint;
    _m smallint := coalesce(p_modifier, 0);
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    insert into score (enrollment_id, assessment_id, value, modifier)
    values (p_enrollment_id, p_assessment_id, p_value, _m)
    on conflict (enrollment_id, assessment_id) do nothing
    returning id into _id;

    if _id is not null then
        perform _score_audit_diff(_id, null, p_value, null, null);
        return _id;
    end if;

    select id, value, status, modifier into _id, _old_v, _old_s, _old_m
      from score where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id
       for update;

    if _old_v is distinct from p_value or _old_m is distinct from _m then
        update score set value = p_value, modifier = _m, scored_at = now(), updated_at = now()
         where id = _id;
        if _old_v is distinct from p_value then
            perform _score_audit_diff(_id, _old_v, p_value, _old_s, _old_s);
        end if;
    end if;
    return _id;
end; $function$;
revoke all on function public.upsert_score(uuid, uuid, numeric, smallint) from public, anon;
grant execute on function public.upsert_score(uuid, uuid, numeric, smallint) to authenticated;

do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$-- [student, assessment, value, status, comment]$s$,
        $s$-- [student, assessment, value, status, comment, modifier]$s$);
    _new := replace(_new,
        $s$jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment)$s$,
        $s$jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment, s.modifier)$s$);
    if strpos(_new, 's.comment, s.modifier)') = 0 then
        raise exception 'get_class_bundle: score_rows not found';
    end if;
    execute _new;

    _def := pg_get_functiondef('public.get_withdrawn_student_records(uuid)'::regprocedure);
    _new := replace(_def,
        $s$'value', sc.value, 'status', sc.status$s$,
        $s$'value', sc.value, 'modifier', sc.modifier, 'status', sc.status$s$);
    if _new = _def then raise exception 'get_withdrawn_student_records: scores not found'; end if;
    execute _new;
end
$patch$;
