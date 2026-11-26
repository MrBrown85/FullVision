-- The owner list moves to public.fv_owner (2026-11-26).
--
-- THIS FILE DELETES NOTHING. It moves one table and rewrites one function's
-- body to name it. Its one row (the owner's account) moves with it.
--
-- Why: 2026112603_owner_health put the list of accounts allowed to read the
-- site-wide counts in fv_private.owner. The repository's record of the
-- database (scripts/schema-snapshot.sql, migrations/baseline/) covers tables
-- in public and student_submit only, so a database rebuilt from the repo had
-- fv_owner_health() without the table it reads, and the security rule tests
-- could not test it. In public the table is in the record and is tested like
-- every other table: as teacher A and as a visitor, nothing is read or
-- written (tests/db/table-owners.mjs, NO_TEACHER).
--
-- It stays unreachable: row security on with no policy, and no grant to
-- anon, authenticated or service_role (Supabase gives a new table in public
-- to all three by default; this takes them back). Only the database owner,
-- and fv_owner_health() running as that owner, read it.
--
-- Undo: migrations/local-test/owner-list-in-public-undo.sql moves it back.

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('fv_private.owner') is null or to_regclass('public.fv_owner') is not null then
    raise exception 'owner_list_in_public: fv_private.owner is not where 2026112603 put it, or public.fv_owner exists; nothing changed';
  end if;
end
$$;

alter table fv_private.owner set schema public;
alter table public.owner rename to fv_owner;
alter table public.fv_owner enable row level security;
revoke all on table public.fv_owner from public, anon, authenticated, service_role;

create or replace function public.fv_owner_health()
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
    if _uid is null or not exists (select 1 from public.fv_owner o where o.teacher_id = _uid) then
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

commit;
