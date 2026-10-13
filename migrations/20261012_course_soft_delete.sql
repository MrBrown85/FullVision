-- Course soft-delete and retention purge (2026-10-12).
--
-- 1. delete_course hard-deleted the class and everything under it, while the
--    UI promised "hidden immediately and permanently removed after 30 days".
--    It now sets course.deleted_at. The design was in
--    docs/backend-design/write-paths.sql but had never been applied.
-- 2. A soft-deleted class is hidden everywhere by the ownership helpers:
--    every child-table RLS policy goes through fv_owns_course /
--    fv_owns_enrollment / fv_owns_assessment / fv_owns_term_rating, so adding
--    "deleted_at is null" there blocks reads and writes on the class's data.
--    list_teacher_courses filters it too. The course_owner policy is left
--    alone so a class can still be restored with one UPDATE:
--        update course set deleted_at = null where id = '<course id>';
-- 3. fv_retention_cleanup purges classes deleted more than 30 days ago, then
--    deletes the students of those classes who are left with no enrollment.
--    Students are teacher-owned and used to survive class deletes; nothing in
--    the app shows a student without an enrollment, so they became
--    unreachable personal data. Students enrolled in another class, and
--    withdrawn students (who keep their enrollment row), are untouched.
--
-- Students already orphaned by earlier hard deletes are handled separately in
-- 20261012_orphan_student_cleanup.sql.

alter table public.course add column if not exists deleted_at timestamptz;

create index if not exists course_deleted_at_idx on public.course (deleted_at) where deleted_at is not null;

create or replace function public.fv_owns_course(cid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (select 1 from course c
                   where c.id = cid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.fv_owns_enrollment(eid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (select 1 from enrollment e join course c on c.id = e.course_id
                   where e.id = eid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.fv_owns_assessment(aid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (select 1 from assessment a join course c on c.id = a.course_id
                   where a.id = aid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.fv_owns_term_rating(trid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (select 1 from term_rating tr join enrollment e on e.id = tr.enrollment_id
                   join course c on c.id = e.course_id
                   where tr.id = trid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;

create or replace function public.list_teacher_courses()
 returns table(id uuid, name text, grade_level text, description text, color text, is_archived boolean, display_order integer, grading_system text, calc_method text, decay_weight numeric, timezone text, late_work_policy text, created_at timestamp with time zone, updated_at timestamp with time zone)
 language sql
 stable
 set search_path to 'public'
as $function$
    select c.id, c.name, c.grade_level, c.description, c.color,
           c.is_archived, c.display_order, c.grading_system, c.calc_method,
           c.decay_weight, c.timezone, c.late_work_policy,
           c.created_at, c.updated_at
      from course c
     where c.teacher_id = (select auth.uid())
       and c.deleted_at is null
     order by c.is_archived asc, c.display_order asc, c.created_at asc;
$function$;

create or replace function public.delete_course(p_course_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course
       set deleted_at = now(),
           updated_at = now()
     where id = p_course_id
       and teacher_id = _uid
       and deleted_at is null;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;

    update teacher_preference
       set active_course_id = null
     where teacher_id = _uid
       and active_course_id = p_course_id;
end;
$function$;

create or replace function public.fv_retention_cleanup()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _teachers_purged int;
    _courses_purged int;
    _students_purged int;
    _purge_students uuid[];
    _score_audit_purged int;
    _tr_audit_purged    int;
begin
    -- Hard-delete teachers whose soft-delete passed the 30-day grace window.
    -- Cascades: teacher → student/enrollment/score/observation/term_rating/etc.
    delete from teacher
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _teachers_purged = row_count;

    -- Hard-delete classes whose soft-delete passed the 30-day grace window.
    -- Cascades through enrollment, assessment, observation, etc. Remember
    -- their students first so the ones left with no class go too.
    select coalesce(array_agg(distinct e.student_id), '{}')
      into _purge_students
      from enrollment e
      join course c on c.id = e.course_id
     where c.deleted_at is not null
       and c.deleted_at < now() - interval '30 days';

    delete from course
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _courses_purged = row_count;

    delete from student s
     where s.id = any(_purge_students)
       and not exists (select 1 from enrollment e where e.student_id = s.id);
    get diagnostics _students_purged = row_count;

    -- Audit retention: 2 years.
    delete from score_audit where changed_at < now() - interval '2 years';
    get diagnostics _score_audit_purged = row_count;

    delete from term_rating_audit where changed_at < now() - interval '2 years';
    get diagnostics _tr_audit_purged = row_count;

    return jsonb_build_object(
        'teachers_purged',     _teachers_purged,
        'courses_purged',      _courses_purged,
        'students_purged',     _students_purged,
        'score_audit_purged',  _score_audit_purged,
        'term_rating_audit_purged', _tr_audit_purged,
        'ran_at', now()
    );
end; $function$;

revoke execute on function public.fv_retention_cleanup() from public, anon, authenticated;

notify pgrst, 'reload schema';
