-- The owner's health page reads counts across every class (2026-11-26).
--
-- THIS FILE DELETES NOTHING AND CHANGES NO EXISTING ROW OR FUNCTION. It adds
-- one table, fv_private.owner, and one function, public.fv_owner_health().
--
-- Why: Colin asked for a page on fullvision.ca he can open to see how the
-- app is used (fullvision.ca/health, health.html). Row security lets a
-- teacher read only their own classes, so the page cannot count across
-- teachers by itself, and no key that reads everything may sit in a browser
-- or on Netlify (Colin, Nov 17 and Nov 26: no new secret). This function
-- answers only to the accounts listed in fv_private.owner, and only with
-- counts: no name, email, grade, comment or id leaves it.
--
-- fv_private.owner: one row per account allowed to read the counts. The file
-- leaves it empty; the owner's row is added by hand after it is applied, so
-- no account id is written into the repository. Nobody but the database
-- owner can read or change it (no grants; row security on, no policies).
--
-- fv_owner_health() returns one jsonb object:
--   teachers                 accounts not deleted
--   teachers_with_classes    teachers with a class not archived or deleted
--   teachers_with_students   of those, teachers with an enrolled student
--   classes                  classes not archived or deleted
--   students                 students enrolled and not withdrawn, once each
--   teachers_opened_7d       teachers with a class opened in the last 7 days
--   classes_opened_7d        classes opened in the last 7 days
--   weekly                   the last ten weeks (Monday, UTC), each
--                            {week, pieces, teachers}: one student on one
--                            assessment given a score, competency level or
--                            rubric row that week, counted once
--   at                       the server's time
-- Anyone else gets error 42501 ('owner only'). A visitor who is not signed in
-- cannot run it at all.
--
-- The counts cross every teacher's rows because the function runs as its
-- owner, the role that applies this file, which must pass row security
-- (postgres on Supabase does). The file refuses any role that does not, so
-- the counts can never quietly shrink to one teacher's classes. Nothing else
-- depends on the applying role, collation or locale. Weeks are
-- cut by date_trunc on timestamptz, which follows the session's time zone, so
-- the function sets its own: UTC.
--
-- Undo (migrations/local-test/owner-health-undo.sql):
--   drop function public.fv_owner_health(); drop table fv_private.owner;

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('fv_private.owner') is not null
     or to_regprocedure('public.fv_owner_health()') is not null then
    raise exception 'owner_health: already applied; nothing changed';
  end if;
  if not (select r.rolsuper or r.rolbypassrls from pg_roles r where r.rolname = current_user) then
    raise exception 'owner_health: % does not pass row security, so the counts would cover only some classes; nothing changed', current_user;
  end if;
end
$$;

create table fv_private.owner (
  teacher_id uuid not null primary key references public.teacher(id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table fv_private.owner enable row level security;
revoke all on table fv_private.owner from public, anon, authenticated;

create function public.fv_owner_health()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
 set timezone to 'UTC'
as $function$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null or not exists (select 1 from fv_private.owner o where o.teacher_id = _uid) then
        raise exception 'owner only' using errcode = '42501';
    end if;

    return jsonb_build_object(
        'teachers', (select count(*) from teacher where deleted_at is null),
        'teachers_with_classes', (
            select count(distinct c.teacher_id) from course c
             where c.deleted_at is null and not c.is_archived),
        'teachers_with_students', (
            select count(distinct c.teacher_id) from course c
              join enrollment e on e.course_id = c.id and e.withdrawn_at is null
             where c.deleted_at is null and not c.is_archived),
        'classes', (select count(*) from course where deleted_at is null and not is_archived),
        'students', (
            select count(distinct e.student_id) from enrollment e
              join course c on c.id = e.course_id
             where e.withdrawn_at is null and c.deleted_at is null and not c.is_archived),
        'teachers_opened_7d', (
            select count(distinct c.teacher_id) from course_opened o
              join course c on c.id = o.course_id
             where o.last_opened_at > now() - interval '7 days' and c.deleted_at is null),
        'classes_opened_7d', (
            select count(*) from course_opened o
              join course c on c.id = o.course_id
             where o.last_opened_at > now() - interval '7 days' and c.deleted_at is null),
        'weekly', (
            with marks as (
                select enrollment_id, assessment_id, updated_at as at from score
                union all select enrollment_id, assessment_id, updated_at from tag_score
                union all select enrollment_id, assessment_id, updated_at from rubric_score
            ), weekly as (
                select date_trunc('week', m.at) as wk,
                       count(distinct (m.enrollment_id, m.assessment_id)) as pieces,
                       count(distinct c.teacher_id) as teachers
                  from marks m
                  join enrollment e on e.id = m.enrollment_id
                  join course c on c.id = e.course_id
                 where m.at >= date_trunc('week', now()) - interval '9 weeks'
                   and c.deleted_at is null
                 group by 1
            )
            select coalesce(jsonb_agg(jsonb_build_object(
                       'week', to_char(w.week, 'YYYY-MM-DD'),
                       'pieces', coalesce(x.pieces, 0),
                       'teachers', coalesce(x.teachers, 0)) order by w.week), '[]'::jsonb)
              from generate_series(date_trunc('week', now()) - interval '9 weeks',
                                   date_trunc('week', now()), interval '1 week') as w(week)
              left join weekly x on x.wk = w.week),
        'at', now()
    );
end;
$function$;

revoke all on function public.fv_owner_health() from public, anon;
grant execute on function public.fv_owner_health() to authenticated;

commit;
