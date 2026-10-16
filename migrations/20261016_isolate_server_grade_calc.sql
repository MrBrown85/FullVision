-- Isolate the server's old grade calculation (2026-10-16).
--
-- Grades are calculated in the client (shared/calc.js), which now follows
-- docs/grading-compliance-plan.md. The server still had its own copy of the
-- old rules (level-to-% scale, rubric values capped at 4, a points 0 as
-- blank), and seven read RPCs returned its numbers: get_gradebook,
-- get_assessment_detail, get_class_dashboard, get_report,
-- get_student_profile, get_term_rating and list_course_student_profiles.
-- Since PR #171 no client view reads those numbers.
--
-- This keeps the old code but takes it out of reach:
--   * fv_legacy holds every old calculation function, unchanged, with a
--     search path that finds its own helpers first. No client role can use
--     the schema.
--   * The five functions the read RPCs call stay in public as stubs that
--     return null, so the RPCs keep their shape and get_gradebook stops
--     recalculating every cell.
--   * The six helpers only those five call move to fv_legacy outright.
--
-- To bring a calculation back, port it from fv_legacy deliberately; don't
-- point public at it.
create schema if not exists fv_legacy;
revoke all on schema fv_legacy from public, anon, authenticated;
comment on schema fv_legacy is
    'Retired server-side grade calculation, kept for reference. Grades are calculated in shared/calc.js. Not callable by clients.';

-- 1. Archive copies of the five functions the read RPCs call.
do $$
declare
    f regprocedure;
    d text;
begin
    foreach f in array array[
        'public.fv_assessment_overall(uuid,uuid)',
        'public.fv_course_letter_pipeline(uuid,uuid)',
        'public.fv_overall_proficiency(uuid,uuid)',
        'public.fv_section_proficiency(uuid,uuid)',
        'public.fv_q_to_percentage(numeric)'
    ]::regprocedure[] loop
        d := pg_get_functiondef(f);
        d := replace(d, 'CREATE OR REPLACE FUNCTION public.', 'CREATE OR REPLACE FUNCTION fv_legacy.');
        d := replace(d, $q$SET search_path TO 'public'$q$, $q$SET search_path TO 'fv_legacy', 'public'$q$);
        if position('fv_legacy.' in d) = 0 or position($q$'fv_legacy', 'public'$q$ in d) = 0 then
            raise exception 'unexpected definition for %', f;
        end if;
        execute d;
    end loop;
end $$;

-- 2. Move the helpers only those five call.
alter function public.fv_category_average(uuid, uuid) set schema fv_legacy;
alter function public.fv_decaying_avg(numeric[], date[], numeric) set schema fv_legacy;
alter function public.fv_group_rollup(uuid, uuid) set schema fv_legacy;
alter function public.fv_percentage_to_letter(numeric) set schema fv_legacy;
alter function public.fv_rubric_level_value(numeric, numeric, numeric, numeric, integer, smallint) set schema fv_legacy;
alter function public.fv_tag_score_for_assessment(uuid, uuid, uuid) set schema fv_legacy;

alter function fv_legacy.fv_category_average(uuid, uuid) set search_path = fv_legacy, public;
alter function fv_legacy.fv_decaying_avg(numeric[], date[], numeric) set search_path = fv_legacy, public;
alter function fv_legacy.fv_group_rollup(uuid, uuid) set search_path = fv_legacy, public;
alter function fv_legacy.fv_percentage_to_letter(numeric) set search_path = fv_legacy, public;
alter function fv_legacy.fv_rubric_level_value(numeric, numeric, numeric, numeric, integer, smallint)
    set search_path = fv_legacy, public;
alter function fv_legacy.fv_tag_score_for_assessment(uuid, uuid, uuid) set search_path = fv_legacy, public;

revoke all on all functions in schema fv_legacy from public, anon, authenticated;

-- 3. Stubs in public: same signatures, no calculation.
create or replace function public.fv_assessment_overall(p_enrollment_id uuid, p_assessment_id uuid)
 returns score_result language sql stable set search_path to 'public'
as $$ select null::score_result $$;

create or replace function public.fv_course_letter_pipeline(p_enrollment_id uuid, p_course_id uuid)
 returns jsonb language sql stable set search_path to 'public'
as $$ select null::jsonb $$;

create or replace function public.fv_overall_proficiency(p_enrollment_id uuid, p_course_id uuid)
 returns numeric language sql stable set search_path to 'public'
as $$ select null::numeric $$;

create or replace function public.fv_section_proficiency(p_enrollment_id uuid, p_section_id uuid)
 returns numeric language sql stable set search_path to 'public'
as $$ select null::numeric $$;

create or replace function public.fv_q_to_percentage(q numeric)
 returns numeric language sql immutable set search_path to 'public'
as $$ select null::numeric $$;

comment on function public.fv_assessment_overall(uuid, uuid) is
    'Stub: grades are calculated in shared/calc.js. The old body is fv_legacy.fv_assessment_overall.';
comment on function public.fv_course_letter_pipeline(uuid, uuid) is
    'Stub: grades are calculated in shared/calc.js. The old body is fv_legacy.fv_course_letter_pipeline.';
comment on function public.fv_overall_proficiency(uuid, uuid) is
    'Stub: grades are calculated in shared/calc.js. The old body is fv_legacy.fv_overall_proficiency.';
comment on function public.fv_section_proficiency(uuid, uuid) is
    'Stub: grades are calculated in shared/calc.js. The old body is fv_legacy.fv_section_proficiency.';
comment on function public.fv_q_to_percentage(numeric) is
    'Stub: grades are calculated in shared/calc.js. The old body is fv_legacy.fv_q_to_percentage.';
