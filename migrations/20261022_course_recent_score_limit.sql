-- A class can count only each competency's most recent scores (2026-10-22,
-- the Grading tab's "Count Only the Most Recent": All Scores, 3 Scores or
-- 5 Scores). Older scores beyond the number are left out of the
-- proficiency for every calculation method but Most Recent Score.
--
--   recent_score_limit  1–20: count a competency's last N scored entries.
--                       null: count them all (the default, and "All Scores").
--
-- Written through update_course; a JSON null in the patch clears it.
-- get_class_bundle returns the whole course row (to_jsonb(_course)), so it
-- needs no change, and course already has a sync-cursor trigger, so a
-- change reaches other devices. update_course is patched in place; nothing
-- else about it changes. No existing data changes.

alter table public.course
  add column if not exists recent_score_limit smallint
  constraint course_recent_score_limit_range check (recent_score_limit is null or recent_score_limit between 1 and 20);

comment on column public.course.recent_score_limit is
    'Count only each competency''s last N scored entries (any method but Most Recent). Null: all scores.';

do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.update_course(uuid, jsonb)'::regprocedure);
    _new := replace(_def,
        $s$                                else reporting_terms end,
        updated_at       = now()$s$,
        $s$                                else reporting_terms end,
        recent_score_limit = case when p_patch ? 'recent_score_limit'
                                then (p_patch->>'recent_score_limit')::smallint
                                else recent_score_limit end,
        updated_at       = now()$s$);
    if _new = _def then raise exception 'update_course: reporting_terms assignment not found'; end if;
    execute _new;
end
$patch$;
