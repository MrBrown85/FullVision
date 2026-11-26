-- Undo of migrations/2026112604_owner_list_in_public.sql: the owner list goes
-- back to fv_private.owner, with its row, and fv_owner_health() reads it there
-- again, exactly as 2026112603_owner_health left them.
begin;
set local lock_timeout = '5s';
alter table public.fv_owner rename to owner;
alter table public.owner set schema fv_private;
revoke all on table fv_private.owner from public, anon, authenticated, service_role;

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

commit;
