-- Reporting periods (2026-10-17, docs/ROADMAP.md 1.2, docs/DECISIONS.md
-- "Reporting periods").
--
-- BC schools report several times a year, and until now every grade in
-- FullVision was all-time. A class can now carry up to six reporting terms
-- with dates. The gradebook, dashboard and student pages can show one term,
-- and the report questionnaires' Report 1..6 line up with term ordinals 1..6.
--
--   reporting_terms  jsonb array, null or empty when the class has none:
--                    [{"ordinal": 1, "label": "Term 1",
--                      "starts_on": "2026-09-01", "ends_on": "2026-11-15"}, …]
--                    ordinal is 1..6 and unique in the array; label is
--                    non-empty; both dates are YYYY-MM-DD with
--                    starts_on <= ends_on. Overlap is a client rule only.
--
-- Written through update_course like category_weights; a JSON null in the
-- patch clears it. get_class_bundle already returns the whole course row
-- (gradebook.course), so it needs no change, and course already has
-- course_sync_cursor_course_gradebook, so a change reaches other devices.
--
-- Tested with begin … rollback, never applied by hand to gradebook-prod.

create or replace function public.fv_check_reporting_terms(p jsonb)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
    _t jsonb;
    _n int;
begin
    if p is null then return true; end if;
    if jsonb_typeof(p) <> 'array' then return false; end if;
    if jsonb_array_length(p) > 6 then return false; end if;

    for _t in select * from jsonb_array_elements(p) loop
        if jsonb_typeof(_t) <> 'object' then return false; end if;
        if jsonb_typeof(_t->'ordinal') <> 'number' then return false; end if;
        _n := (_t->>'ordinal')::numeric;
        if _n::numeric <> (_t->>'ordinal')::numeric or _n < 1 or _n > 6 then return false; end if;
        if coalesce(btrim(_t->>'label'), '') = '' then return false; end if;
        if (_t->>'starts_on') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
        if (_t->>'ends_on')   !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
        if (_t->>'starts_on')::date > (_t->>'ends_on')::date then return false; end if;
    end loop;

    -- ordinals unique
    if (select count(*) from jsonb_array_elements(p) e)
       <> (select count(distinct e->>'ordinal') from jsonb_array_elements(p) e) then
        return false;
    end if;
    return true;
exception when others then
    return false;
end;
$function$;

revoke execute on function public.fv_check_reporting_terms(jsonb) from public, anon;
grant execute on function public.fv_check_reporting_terms(jsonb) to authenticated;

alter table public.course add column if not exists reporting_terms jsonb;

alter table public.course drop constraint if exists course_reporting_terms_check;
alter table public.course add constraint course_reporting_terms_check
    check (public.fv_check_reporting_terms(reporting_terms));

comment on column public.course.reporting_terms is
    'Up to six reporting terms: [{ordinal 1..6, label, starts_on, ends_on}]. Null: the class has none.';

-- As in 20261016_course_round_percent.sql, plus reporting_terms.
create or replace function public.update_course(p_course_id uuid, p_patch jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course set
        name             = coalesce(p_patch->>'name',             name),
        grade_level      = coalesce(p_patch->>'grade_level',      grade_level),
        description      = case when p_patch ? 'description'
                                then p_patch->>'description'
                                else description end,
        color            = case when p_patch ? 'color'
                                then p_patch->>'color'
                                else color end,
        grading_system   = coalesce(p_patch->>'grading_system',   grading_system),
        calc_method      = coalesce(p_patch->>'calc_method',      calc_method),
        decay_weight     = case when p_patch ? 'decay_weight'
                                then (p_patch->>'decay_weight')::numeric
                                else decay_weight end,
        timezone         = coalesce(p_patch->>'timezone',         timezone),
        late_work_policy = case when p_patch ? 'late_work_policy'
                                then p_patch->>'late_work_policy'
                                else late_work_policy end,
        grading_scale    = case when p_patch ? 'grading_scale'
                                then nullif(p_patch->'grading_scale', 'null'::jsonb)
                                else grading_scale end,
        category_weights = case when p_patch ? 'category_weights'
                                then nullif(p_patch->'category_weights', 'null'::jsonb)
                                else category_weights end,
        round_percent    = case when p_patch ? 'round_percent'
                                then (p_patch->>'round_percent')::boolean
                                else round_percent end,
        reporting_terms  = case when p_patch ? 'reporting_terms'
                                then nullif(p_patch->'reporting_terms', 'null'::jsonb)
                                else reporting_terms end,
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;
