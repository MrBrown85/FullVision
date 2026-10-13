-- Complete/Incomplete scoring (2026-10-13).
--
-- A third score mode beside proficiency and points. It is scored like a
-- 1-point assessment: Complete = 1 (100%), Incomplete = 0 (0%), and no value
-- means not yet marked. Like points, the value lives on score.value, not on
-- tag scores. The client sets max_points = 1; the calculation falls back to
-- 1 if it is missing.

alter table public.assessment drop constraint if exists assessment_score_mode_check;
alter table public.assessment add constraint assessment_score_mode_check
    check (score_mode = any (array['proficiency'::text, 'points'::text, 'complete'::text]));

do $$
declare
    d text;
    edited text;
begin
    -- A tag score sent for a Complete/Incomplete assessment goes to the
    -- assessment's single value, as it does for points.
    d := pg_get_functiondef('public.upsert_tag_score(uuid, uuid, uuid, integer, smallint)'::regprocedure);
    edited := replace(d, $s$if _mode = 'points' then$s$, $s$if _mode in ('points', 'complete') then$s$);
    if edited = d then raise exception 'upsert_tag_score did not match the expected shape'; end if;
    execute edited;

    -- The overall value: Complete = 4, Incomplete = 0, as points at 100% / 0%.
    d := pg_get_functiondef('public.fv_assessment_overall(uuid, uuid)'::regprocedure);
    edited := replace(d,
        $s$    elsif a.score_mode = 'points' then$s$,
        $s$    elsif a.score_mode = 'complete' then
        return ('value', (s.value / coalesce(nullif(a.max_points, 0), 1)) * 4)::score_result;
    elsif a.score_mode = 'points' then$s$);
    if edited = d then raise exception 'fv_assessment_overall did not match the expected shape'; end if;
    execute edited;
end $$;

notify pgrst, 'reload schema';
