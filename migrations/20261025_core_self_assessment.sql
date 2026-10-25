-- Students' self-assessments of the BC Core Competencies, by term.
--
-- What broke: the Learner Profile's Core Competencies counted how often
-- each competency was tagged on a student's assessments, which describes
-- the teacher's assignments, not the student. BC's reporting policy has
-- students self-assess the Core Competencies and set goals from that each
-- year; teachers don't grade them. There was nowhere to keep either.
--
-- What it adds:
--   core_self_assessment: one row per (enrollment, core competency, term),
--     with the student's step on Beginning / Growing / Confident / Leading
--     (level 1–4), their words (body) and their goal. term_key is the
--     reporting term ('T1', 'T2', …) or '' for a class without terms.
--     RLS through fv_owns_enrollment, as goal and reflection.
--   upsert_core_self_assessment(...): saves a row, as upsert_reflection
--     does; idempotent on (enrollment, competency, term). Clearing every
--     field deletes the row.
--   list_course_core_self_assessments(p_course_id) -> {enrollment_id:
--     {term_key: {core_id: {level, text, goal, date}}}}.
-- No existing table or function changes; no data changes.

create table if not exists public.core_self_assessment (
  id            uuid        not null primary key default gen_random_uuid(),
  enrollment_id uuid        not null references public.enrollment(id) on delete cascade,
  core_id       text        not null
                constraint core_self_assessment_core_check
                check (core_id in ('COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR')),
  term_key      text        not null default '',
  level         integer
                constraint core_self_assessment_level_check check (level between 1 and 4),
  body          text,
  goal          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, core_id, term_key)
);

alter table public.core_self_assessment enable row level security;

drop policy if exists core_self_assessment_via_enrollment on public.core_self_assessment;
create policy core_self_assessment_via_enrollment on public.core_self_assessment
  for all
  using (fv_owns_enrollment(enrollment_id))
  with check (fv_owns_enrollment(enrollment_id));

grant select, insert, update, delete on public.core_self_assessment to authenticated;

create or replace function public.upsert_core_self_assessment(
  p_enrollment_id uuid,
  p_core_id       text,
  p_term_key      text,
  p_level         integer,
  p_body          text,
  p_goal          text
)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare _id uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_level is not null and (p_level < 1 or p_level > 4) then
        raise exception 'level must be 1..4' using errcode = '22023';
    end if;
    -- Nothing left to keep: the self-assessment goes.
    if p_level is null and coalesce(btrim(p_body), '') = '' and coalesce(btrim(p_goal), '') = '' then
        delete from core_self_assessment
         where enrollment_id = p_enrollment_id
           and core_id = p_core_id
           and term_key = coalesce(p_term_key, '');
        return null;
    end if;
    insert into core_self_assessment (enrollment_id, core_id, term_key, level, body, goal)
    values (p_enrollment_id, p_core_id, coalesce(p_term_key, ''), p_level,
            nullif(btrim(p_body), ''), nullif(btrim(p_goal), ''))
    on conflict (enrollment_id, core_id, term_key) do update
       set level = excluded.level, body = excluded.body, goal = excluded.goal, updated_at = now()
    returning id into _id;
    return _id;
end; $$;

create or replace function public.list_course_core_self_assessments(p_course_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(x.enrollment_id::text, x.terms), '{}'::jsonb)
    from (
      select t.enrollment_id, jsonb_object_agg(t.term_key, t.cores) as terms
        from (
          select c.enrollment_id, c.term_key,
                 jsonb_object_agg(c.core_id, jsonb_build_object(
                   'level', c.level, 'text', c.body, 'goal', c.goal, 'date', c.updated_at)) as cores
            from core_self_assessment c
            join enrollment e on e.id = c.enrollment_id
           where e.course_id = p_course_id
           group by c.enrollment_id, c.term_key
        ) t
       group by t.enrollment_id
    ) x;
$$;

revoke execute on function public.upsert_core_self_assessment(uuid, text, text, integer, text, text) from public, anon;
grant execute on function public.upsert_core_self_assessment(uuid, text, text, integer, text, text) to authenticated, service_role;
revoke execute on function public.list_course_core_self_assessments(uuid) from public, anon;
grant execute on function public.list_course_core_self_assessments(uuid) to authenticated, service_role;
