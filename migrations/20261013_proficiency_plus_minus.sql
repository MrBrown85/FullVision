-- Proficiency + and − (2026-10-13).
--
-- Teachers can mark a proficiency level with + or −. A + or − is worth a
-- third of a level (3+ = 3.33, 3− = 2.67). Every level can take one except
-- 1− and 4+, so scores stay within 1–4.
--
-- Storage: tag_score and rubric_score keep their whole-number level in
-- `value` and gain `modifier` (−1, 0, +1). Everything that only shows the
-- level keeps working; everything that averages uses value + modifier / 3.
-- For rubric criteria with custom level values, + and − move a third of the
-- way toward the next level's value.
--
-- The write RPCs gain p_modifier (default 0). Their old signatures are
-- dropped in the same migration: two overloads differing only by a defaulted
-- parameter make PostgREST reject calls as ambiguous (the April 2026 outage).

-- ── Columns ────────────────────────────────────────────────────────────────
alter table public.tag_score add column if not exists modifier smallint not null default 0;
alter table public.tag_score drop constraint if exists tag_score_modifier_check;
alter table public.tag_score add constraint tag_score_modifier_check
    check (modifier between -1 and 1 and not (value = 1 and modifier = -1) and not (value = 4 and modifier = 1));

alter table public.rubric_score add column if not exists modifier smallint not null default 0;
alter table public.rubric_score drop constraint if exists rubric_score_modifier_check;
alter table public.rubric_score add constraint rubric_score_modifier_check
    check (modifier between -1 and 1 and not (value = 1 and modifier = -1) and not (value = 4 and modifier = 1));

-- ── Helpers ────────────────────────────────────────────────────────────────
-- A rubric level's value with its + or −: a third of the way toward the next
-- level's value (up for +, down for −).
create or replace function public.fv_rubric_level_value(
    l1 numeric, l2 numeric, l3 numeric, l4 numeric, p_value integer, p_modifier smallint
) returns numeric
language sql immutable
set search_path to 'public'
as $function$
    select case p_value when 1 then l1 when 2 then l2 when 3 then l3 when 4 then l4 end
         + case
               when coalesce(p_modifier, 0) > 0 then
                   (case p_value when 1 then l2 - l1 when 2 then l3 - l2 when 3 then l4 - l3 else 0 end) / 3.0
               when coalesce(p_modifier, 0) < 0 then
                   -(case p_value when 2 then l2 - l1 when 3 then l3 - l2 when 4 then l4 - l3 else 0 end) / 3.0
               else 0
           end;
$function$;

-- ── Writes ─────────────────────────────────────────────────────────────────
drop function if exists public.upsert_tag_score(uuid, uuid, uuid, integer);
create or replace function public.upsert_tag_score(
    p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid, p_value integer, p_modifier smallint default 0
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _rubric uuid; _mode text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select rubric_id, score_mode into _rubric, _mode from assessment where id = p_assessment_id;
    if _rubric is not null then
        raise exception 'tag_score is not used for rubric assessments' using errcode = '22023';
    end if;

    if _mode = 'points' then
        delete from tag_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        return upsert_score(p_enrollment_id, p_assessment_id, p_value);
    end if;

    if p_value is null or p_value = 0 then
        delete from tag_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        return null;
    end if;

    insert into tag_score (enrollment_id, assessment_id, tag_id, value, modifier)
    values (p_enrollment_id, p_assessment_id, p_tag_id, p_value, coalesce(p_modifier, 0))
    on conflict (enrollment_id, assessment_id, tag_id) do update
       set value = excluded.value, modifier = excluded.modifier, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

drop function if exists public.upsert_rubric_score(uuid, uuid, uuid, integer);
create or replace function public.upsert_rubric_score(
    p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid, p_value integer, p_modifier smallint default 0
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value, coalesce(p_modifier, 0))
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value, modifier = excluded.modifier, updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

drop function if exists public.fill_rubric(uuid, uuid, integer);
create or replace function public.fill_rubric(
    p_enrollment_id uuid, p_assessment_id uuid, p_value integer, p_modifier smallint default 0
) returns integer
language plpgsql
set search_path to 'public'
as $function$
declare _n int := 0; _crit record; _rubric uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select rubric_id into _rubric from assessment where id = p_assessment_id;
    if _rubric is null then
        raise exception 'assessment % has no rubric', p_assessment_id using errcode = '22023';
    end if;

    for _crit in select id from criterion where rubric_id = _rubric loop
        perform upsert_rubric_score(p_enrollment_id, p_assessment_id, _crit.id, p_value, p_modifier);
        _n := _n + 1;
    end loop;
    return _n;
end; $function$;

-- ── Calculations ───────────────────────────────────────────────────────────
create or replace function public.fv_tag_score_for_assessment(p_enrollment_id uuid, p_assessment_id uuid, p_tag_id uuid)
 returns score_result
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
    a assessment%rowtype;
    s score%rowtype;
    vals numeric[];
    v numeric;
begin
    select * into a from assessment where id = p_assessment_id;
    if not found then return ('not_yet_graded', null)::score_result; end if;

    select * into s from score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;
    if found then
        if s.status = 'EXC' then return ('excluded', null)::score_result; end if;
        if s.status = 'NS'  then return ('value', 0)::score_result; end if;
    else
        return ('not_yet_graded', null)::score_result;
    end if;

    if a.rubric_id is not null then
        select array_agg(
                   fv_rubric_level_value(c.level_1_value, c.level_2_value, c.level_3_value, c.level_4_value,
                                         rs.value, rs.modifier)
               )
          into vals
          from criterion c
          join criterion_tag ct on ct.criterion_id = c.id and ct.tag_id = p_tag_id
          left join rubric_score rs on rs.criterion_id = c.id
                and rs.enrollment_id = p_enrollment_id
                and rs.assessment_id = p_assessment_id
         where c.rubric_id = a.rubric_id;

        if vals is null or array_length(vals, 1) is null then
            return ('not_applicable', null)::score_result;
        end if;
        select avg(x) into v from unnest(vals) as x where x is not null;
        if v is null then return ('not_yet_graded', null)::score_result; end if;
        return ('value', v)::score_result;
    else
        select value + modifier / 3.0 into v from tag_score
         where enrollment_id = p_enrollment_id
           and assessment_id = p_assessment_id
           and tag_id = p_tag_id;
        if not found then return ('not_applicable', null)::score_result; end if;
        return ('value', v)::score_result;
    end if;
end;
$function$;

create or replace function public.fv_assessment_overall(p_enrollment_id uuid, p_assessment_id uuid)
 returns score_result
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
    a assessment%rowtype;
    s score%rowtype;
    weighted_sum numeric := 0;
    total_weight numeric := 0;
    cr record;
begin
    select * into a from assessment where id = p_assessment_id;
    if not found then return ('not_yet_graded', null)::score_result; end if;

    select * into s from score
     where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id;

    if found then
        if s.status = 'EXC' then return ('excluded', null)::score_result; end if;
        if s.status = 'NS'  then return ('value', 0)::score_result; end if;
    end if;

    if a.rubric_id is not null then
        for cr in
            select c.weight,
                   fv_rubric_level_value(c.level_1_value, c.level_2_value, c.level_3_value, c.level_4_value,
                                         rs.value, rs.modifier) as level_value
              from criterion c
              left join rubric_score rs on rs.criterion_id = c.id
                    and rs.enrollment_id = p_enrollment_id
                    and rs.assessment_id = p_assessment_id
             where c.rubric_id = a.rubric_id
        loop
            if cr.level_value is not null then
                weighted_sum := weighted_sum + cr.weight * cr.level_value;
                total_weight := total_weight + cr.weight;
            end if;
        end loop;
        if total_weight = 0 then return ('not_yet_graded', null)::score_result; end if;
        return ('value', weighted_sum / total_weight)::score_result;
    end if;

    if not found or s.value is null then
        return ('not_yet_graded', null)::score_result;
    end if;

    if a.score_mode = 'proficiency' then
        return ('value', s.value)::score_result;
    elsif a.score_mode = 'points' then
        if a.max_points is null or a.max_points = 0 then
            return ('not_yet_graded', null)::score_result;
        end if;
        return ('value', (s.value / a.max_points) * 4)::score_result;
    end if;

    return ('not_yet_graded', null)::score_result;
end;
$function$;

-- ── Reads ──────────────────────────────────────────────────────────────────
-- Targeted edits to the existing read functions: each one must change exactly
-- once, or the migration stops.
do $$
declare
    d text;
    edited text;
begin
    -- get_gradebook: send the modifier with each tag and rubric score.
    d := pg_get_functiondef('public.get_gradebook(uuid)'::regprocedure);
    edited := replace(d, $s$'value', ts.value$s$, $s$'value', ts.value, 'modifier', ts.modifier$s$);
    edited := replace(edited, $s$'value', rs.value$s$, $s$'value', rs.value, 'modifier', rs.modifier$s$);
    if edited = d or (length(edited) - length(d)) <> 2 * length($s$, 'modifier', ts.modifier$s$) then
        raise exception 'get_gradebook did not match the expected shape';
    end if;
    execute edited;

    -- get_assessment_detail: the same two lists.
    d := pg_get_functiondef('public.get_assessment_detail(uuid)'::regprocedure);
    edited := replace(d, $s$'value', rs.value)$s$, $s$'value', rs.value, 'modifier', rs.modifier)$s$);
    edited := replace(edited, $s$'value', ts.value)$s$, $s$'value', ts.value, 'modifier', ts.modifier)$s$);
    if (length(edited) - length(d)) <> 2 * length($s$, 'modifier', ts.modifier$s$) then
        raise exception 'get_assessment_detail did not match the expected shape';
    end if;
    execute edited;

    -- Class averages: average the effective value.
    d := pg_get_functiondef('public.get_class_dashboard(uuid)'::regprocedure);
    edited := replace(d, 'ts.enrollment_id, ts.tag_id, ts.value', 'ts.enrollment_id, ts.tag_id, ts.value + ts.modifier / 3.0 as value');
    if edited = d then raise exception 'get_class_dashboard did not match the expected shape'; end if;
    execute edited;

    d := pg_get_functiondef('public.get_learning_map(uuid)'::regprocedure);
    edited := replace(d, 'ts.enrollment_id, ts.tag_id, ts.value', 'ts.enrollment_id, ts.tag_id, ts.value + ts.modifier / 3.0 as value');
    if edited = d then raise exception 'get_learning_map did not match the expected shape'; end if;
    execute edited;

    d := pg_get_functiondef('public.get_student_profile(uuid)'::regprocedure);
    edited := replace(d, $s$ts.tag_id, ts.value
        from tag_score ts$s$, $s$ts.tag_id, ts.value + ts.modifier / 3.0 as value
        from tag_score ts$s$);
    if edited = d then raise exception 'get_student_profile did not match the expected shape'; end if;
    execute edited;
end $$;

notify pgrst, 'reload schema';
