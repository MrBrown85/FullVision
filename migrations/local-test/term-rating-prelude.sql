-- term_rating as live on 2026-10-28, for testing
-- 20261028_term_rating_habits_approval.sql: the table and its audit, the
-- link tables (without their foreign keys to section, tag, assessment and
-- observation, which the harness leaves out), fv_owns_term_rating,
-- _term_rating_audit_field, save_term_rating as live, and a get_class_bundle
-- stand-in whose term_ratings block is the live one word for word. Load after
-- harness.sql.

create table public.term_rating (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollment(id) on delete cascade,
  term integer not null check (term >= 1 and term <= 6),
  narrative_html text,
  work_habits_rating integer check (work_habits_rating >= 1 and work_habits_rating <= 4),
  participation_rating integer check (participation_rating >= 1 and participation_rating <= 4),
  social_traits text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  absences integer check (absences >= 0),
  lates integer check (lates >= 0),
  unique (enrollment_id, term)
);
create table public.term_rating_audit (
  id uuid primary key default gen_random_uuid(),
  term_rating_id uuid not null references term_rating(id) on delete cascade,
  changed_by uuid references teacher(id) on delete set null,
  field_changed text not null, old_value text, new_value text,
  changed_at timestamptz not null default now()
);
create table public.term_rating_dimension (
  id uuid primary key default gen_random_uuid(),
  term_rating_id uuid not null references term_rating(id) on delete cascade,
  section_id uuid not null, rating integer not null check (rating >= 1 and rating <= 4),
  unique (term_rating_id, section_id)
);
create table public.term_rating_strength (term_rating_id uuid not null references term_rating(id) on delete cascade, tag_id uuid not null, primary key (term_rating_id, tag_id));
create table public.term_rating_growth_area (term_rating_id uuid not null references term_rating(id) on delete cascade, tag_id uuid not null, primary key (term_rating_id, tag_id));
create table public.term_rating_assessment (term_rating_id uuid not null references term_rating(id) on delete cascade, assessment_id uuid not null, primary key (term_rating_id, assessment_id));
create table public.term_rating_observation (term_rating_id uuid not null references term_rating(id) on delete cascade, observation_id uuid not null, primary key (term_rating_id, observation_id));

create or replace function public.fv_owns_term_rating(trid uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
    select exists (select 1 from term_rating tr join enrollment e on e.id = tr.enrollment_id
                   join course c on c.id = e.course_id
                   where tr.id = trid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

alter table term_rating enable row level security;
alter table term_rating_audit enable row level security;
alter table term_rating_dimension enable row level security;
alter table term_rating_strength enable row level security;
alter table term_rating_growth_area enable row level security;
alter table term_rating_assessment enable row level security;
alter table term_rating_observation enable row level security;
create policy term_rating_via_enrollment on term_rating for all to authenticated using (fv_owns_enrollment(enrollment_id)) with check (fv_owns_enrollment(enrollment_id));
create policy term_rating_audit_read on term_rating_audit for select to authenticated using (fv_owns_term_rating(term_rating_id));
create policy term_rating_dimension_via_tr on term_rating_dimension for all to authenticated using (fv_owns_term_rating(term_rating_id)) with check (fv_owns_term_rating(term_rating_id));
create policy term_rating_strength_via_tr on term_rating_strength for all to authenticated using (fv_owns_term_rating(term_rating_id)) with check (fv_owns_term_rating(term_rating_id));
create policy term_rating_growth_area_via_tr on term_rating_growth_area for all to authenticated using (fv_owns_term_rating(term_rating_id)) with check (fv_owns_term_rating(term_rating_id));
create policy term_rating_assessment_via_tr on term_rating_assessment for all to authenticated using (fv_owns_term_rating(term_rating_id)) with check (fv_owns_term_rating(term_rating_id));
create policy term_rating_observation_via_tr on term_rating_observation for all to authenticated using (fv_owns_term_rating(term_rating_id)) with check (fv_owns_term_rating(term_rating_id));
grant select, insert, update, delete on term_rating, term_rating_dimension, term_rating_strength, term_rating_growth_area, term_rating_assessment, term_rating_observation to authenticated;
grant select on term_rating_audit to authenticated;
grant execute on function fv_owns_term_rating(uuid) to authenticated;

create or replace function public._term_rating_audit_field(p_tr_id uuid, p_field text, p_old text, p_new text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
    if p_old is distinct from p_new then
        insert into term_rating_audit (term_rating_id, changed_by, field_changed, old_value, new_value)
        values (p_tr_id, (select auth.uid()), p_field, p_old, p_new);
    end if;
end; $function$;

-- save_term_rating as live before the migration (narrative and the old
-- fields only), so the migration's replace is what the test runs.
create or replace function public.save_term_rating(p_enrollment_id uuid, p_term integer, p_payload jsonb)
 returns uuid language plpgsql set search_path to 'public'
as $function$
declare _tr_id uuid; _old term_rating%rowtype; _new_nar text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select * into _old from term_rating where enrollment_id = p_enrollment_id and term = p_term;
    _new_nar := case when p_payload ? 'narrative_html' then p_payload->>'narrative_html' else _old.narrative_html end;
    insert into term_rating (enrollment_id, term, narrative_html) values (p_enrollment_id, p_term, _new_nar)
    on conflict (enrollment_id, term) do update set narrative_html = excluded.narrative_html, updated_at = now()
    returning id into _tr_id;
    return _tr_id;
end; $function$;
grant execute on function public.save_term_rating(uuid, integer, jsonb) to authenticated;

-- get_class_bundle stand-in: the live access check and term_ratings block.
create or replace function public.get_class_bundle(p_course_id uuid, p_if_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    _course public.course%rowtype;
    _term_ratings jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    select * into _course from public.course
     where id = p_course_id and teacher_id = (select auth.uid()) and deleted_at is null;
    if not found then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    -- ── Term ratings, which the client never read back before.
    with
    tr as (
        select tr.* from public.term_rating tr
          join public.enrollment e on e.id = tr.enrollment_id
         where e.course_id = p_course_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', tr.enrollment_id, 'term', tr.term,
               'narrative_html', tr.narrative_html,
               'work_habits_rating', tr.work_habits_rating,
               'participation_rating', tr.participation_rating,
               'social_traits', to_jsonb(coalesce(tr.social_traits, '{}'::text[])),
               'created_at', tr.created_at, 'updated_at', tr.updated_at,
               'strength_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_strength x
                                           where x.term_rating_id = tr.id), '[]'::jsonb),
               'growth_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_growth_area x
                                         where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_assessments', coalesce((select jsonb_agg(x.assessment_id) from public.term_rating_assessment x
                                                 where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_observations', coalesce((select jsonb_agg(x.observation_id) from public.term_rating_observation x
                                                  where x.term_rating_id = tr.id), '[]'::jsonb)
           )), '[]'::jsonb)
      into _term_ratings
      from tr;

    return jsonb_build_object('term_ratings', _term_ratings);
end; $function$;
grant execute on function public.get_class_bundle(uuid, bigint) to authenticated;
