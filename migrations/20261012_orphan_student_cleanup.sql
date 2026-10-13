-- One-time cleanup of students orphaned by class hard deletes before
-- 20261012_course_soft_delete.sql. On 2026-10-12 there were 72, all in one
-- account, created 2026-04-29/30. Nothing in the app shows a student with no
-- enrollment. Rows are copied to fv_backup first.
--
-- NOT YET APPLIED: waiting for the owner's confirmation.

create table if not exists fv_backup.orphan_student_20261012 as
    select s.* from public.student s
     where not exists (select 1 from public.enrollment e where e.student_id = s.id);

delete from public.student s
 where s.id in (select id from fv_backup.orphan_student_20261012)
   and not exists (select 1 from public.enrollment e where e.student_id = s.id);
