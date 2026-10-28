-- DIBELS 8 benchmark scores (grader plan PR 18).
--
-- What it is for: ELA teachers give the DIBELS 8 reading benchmark three
-- times a year (Beginning, Middle and End of Year). Each time they record a
-- student's raw scores from the oral reading fluency passage (words read
-- correctly, errors) and the Maze (correct, incorrect). FullVision keeps the
-- raw numbers; accuracy, the adjusted Maze score and the benchmark levels are
-- worked out in the app (PR 19), and a DIBELS assessment counts toward no
-- grade.
--
-- What it adds:
--   assessment.score_mode allows 'dibels'.
--   dibels_score: one row per student, assessment and benchmark period
--     ('boy' | 'moy' | 'eoy'), the four raw scores, each null when not
--     entered and never negative. RLS through fv_owns_enrollment, like
--     rubric_score; rows go with their enrollment or assessment.
--   upsert_dibels_score(...): saves all four numbers for one student and
--     period; all four null deletes the row. Idempotent on (enrollment,
--     assessment, period). Only for an assessment scored as 'dibels'.
--   list_course_dibels(p_course_id): every DIBELS row in the class, a read
--     of its own so get_class_bundle stays as it is.
-- Missing and Excused use the assessment's existing status (score.status).
-- Security invoker: dibels_score's RLS decides access.
-- No existing function changes; no data changes.

begin;

alter table public.assessment drop constraint assessment_score_mode_check;
alter table public.assessment
  add constraint assessment_score_mode_check
  check (score_mode = any (array['proficiency', 'points', 'complete', 'dibels']));

create table if not exists public.dibels_score (
    id             uuid        not null default gen_random_uuid() primary key,
    enrollment_id  uuid        not null references public.enrollment(id) on delete cascade,
    assessment_id  uuid        not null references public.assessment(id) on delete cascade,
    period         text        not null constraint dibels_score_period_check check (period in ('boy', 'moy', 'eoy')),
    orf_wrc        integer     constraint dibels_score_orf_wrc_check check (orf_wrc >= 0),
    orf_errors     integer     constraint dibels_score_orf_errors_check check (orf_errors >= 0),
    maze_correct   integer     constraint dibels_score_maze_correct_check check (maze_correct >= 0),
    maze_incorrect integer     constraint dibels_score_maze_incorrect_check check (maze_incorrect >= 0),
    updated_at     timestamptz not null default now(),
    constraint dibels_score_unique unique (enrollment_id, assessment_id, period)
);
create index if not exists dibels_score_assessment_idx on public.dibels_score (assessment_id);

alter table public.dibels_score enable row level security;
drop policy if exists dibels_score_via_enrollment on public.dibels_score;
create policy dibels_score_via_enrollment on public.dibels_score
    for all
    using (public.fv_owns_enrollment(enrollment_id))
    with check (public.fv_owns_enrollment(enrollment_id));

revoke all on table public.dibels_score from public, anon;
grant select, insert, update, delete on table public.dibels_score to authenticated;

create or replace function public.upsert_dibels_score(
  p_enrollment_id  uuid,
  p_assessment_id  uuid,
  p_period         text,
  p_orf_wrc        integer,
  p_orf_errors     integer,
  p_maze_correct   integer,
  p_maze_incorrect integer
)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare _id uuid; _mode text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_period is null or p_period not in ('boy', 'moy', 'eoy') then
        raise exception 'p_period must be boy, moy or eoy' using errcode = '22023';
    end if;
    select score_mode into _mode from assessment where id = p_assessment_id;
    if _mode is distinct from 'dibels' then
        raise exception 'dibels_score is only for DIBELS assessments' using errcode = '22023';
    end if;

    if p_orf_wrc is null and p_orf_errors is null and p_maze_correct is null and p_maze_incorrect is null then
        delete from dibels_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and period = p_period;
        return null;
    end if;

    insert into dibels_score (enrollment_id, assessment_id, period, orf_wrc, orf_errors, maze_correct, maze_incorrect)
    values (p_enrollment_id, p_assessment_id, p_period, p_orf_wrc, p_orf_errors, p_maze_correct, p_maze_incorrect)
    on conflict (enrollment_id, assessment_id, period) do update
       set orf_wrc = excluded.orf_wrc,
           orf_errors = excluded.orf_errors,
           maze_correct = excluded.maze_correct,
           maze_incorrect = excluded.maze_incorrect,
           updated_at = now()
    returning id into _id;
    return _id;
end; $$;

create or replace function public.list_course_dibels(p_course_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrollment_id', d.enrollment_id,
           'assessment_id', d.assessment_id,
           'period', d.period,
           'orf_wrc', d.orf_wrc,
           'orf_errors', d.orf_errors,
           'maze_correct', d.maze_correct,
           'maze_incorrect', d.maze_incorrect
         ) order by d.assessment_id, d.enrollment_id, d.period), '[]'::jsonb)
    from dibels_score d
    join enrollment e on e.id = d.enrollment_id
   where e.course_id = p_course_id;
$$;

revoke execute on function public.upsert_dibels_score(uuid, uuid, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.upsert_dibels_score(uuid, uuid, text, integer, integer, integer, integer)
  to authenticated, service_role;
revoke execute on function public.list_course_dibels(uuid) from public, anon;
grant execute on function public.list_course_dibels(uuid) to authenticated, service_role;

commit;
