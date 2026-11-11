-- Taking Batch C's first file (2026111120_markup_reflect_revise.sql) back
-- out. Not a migration: run one PART by hand on the owner's word. Proved by
-- batch_c_undo.py.
--
-- Take C2 out first (batch-c2-undo.sql): PART 2 refuses while it is in.
--
-- PART 1, THE FAST STOP. Deletes nothing and changes no row. Teachers can
-- no longer save marks, return for revision or answer a reflection, and
-- the student's page can no longer reach any Batch C function (each
-- answers a permission error, which the edge function turns into a server
-- error). Return (return_grades), sending work and every grade work as
-- before. PART 1b puts the permissions back.
--
-- PART 2, THE FULL REMOVAL. Everything C1 made goes: the three tables, the
-- two course columns, the four triggers, every function. IT DELETES
-- TEACHERS' MARKS, REVISION REQUESTS AND STUDENTS' REFLECTIONS. It refuses
-- while any of the three tables holds a row, unless the session first says
-- so:  set fv.batch_c_undo = 'discard';
-- A revision a student sent stays as Batch B's: a submission of version 2
-- or more, which Batch B's own screens list as the latest version.
-- The catalog afterwards is the one before C1, line for line, except the
-- two dropped columns' slots on course (a dropped column keeps its slot).

-- ── PART 1 ──────────────────────────────────────────────────────────────────
begin;
revoke execute on function public.set_course_feedback_options(uuid, jsonb, uuid) from authenticated, service_role;
revoke execute on function public.save_markup(uuid, jsonb, integer, uuid) from authenticated, service_role;
revoke execute on function public.list_assessment_markup(uuid) from authenticated, service_role;
revoke execute on function public.return_work(uuid, uuid[], uuid) from authenticated, service_role;
revoke execute on function public.return_for_revision(uuid, uuid, jsonb, uuid) from authenticated, service_role;
revoke execute on function public.set_revision_request(uuid, jsonb, uuid) from authenticated, service_role;
revoke execute on function public.cancel_revision(uuid, uuid) from authenticated, service_role;
revoke execute on function public.answer_reflection(uuid, text, uuid) from authenticated, service_role;
revoke execute on function public.list_course_feedback(uuid) from authenticated, service_role;
revoke execute on function student_submit.feedback(text, uuid, text) from service_role;
revoke execute on function student_submit.markup(text, uuid, uuid, text) from service_role;
revoke execute on function student_submit.reflect(text, uuid, uuid, jsonb, text) from service_role;
revoke execute on function student_submit.reply(text, uuid, uuid, jsonb, text) from service_role;
revoke execute on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text) from service_role;
revoke execute on function student_submit.revision_finish(text, uuid, uuid, jsonb, text) from service_role;
revoke execute on function student_submit.revision_unsend(text, uuid, uuid, text) from service_role;
revoke execute on function student_submit.group_work(text, uuid, text) from service_role;
revoke execute on function student_submit.group_file_links(text, uuid, uuid, text) from service_role;
notify pgrst, 'reload schema';
commit;

-- ── PART 1b: undo the fast stop ─────────────────────────────────────────────
begin;
grant execute on function public.set_course_feedback_options(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.save_markup(uuid, jsonb, integer, uuid) to authenticated, service_role;
grant execute on function public.list_assessment_markup(uuid) to authenticated, service_role;
grant execute on function public.return_work(uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function public.return_for_revision(uuid, uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.set_revision_request(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.cancel_revision(uuid, uuid) to authenticated, service_role;
grant execute on function public.answer_reflection(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.list_course_feedback(uuid) to authenticated, service_role;
grant execute on function student_submit.feedback(text, uuid, text) to service_role;
grant execute on function student_submit.markup(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.reflect(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.reply(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text) to service_role;
grant execute on function student_submit.revision_finish(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function student_submit.revision_unsend(text, uuid, uuid, text) to service_role;
grant execute on function student_submit.group_work(text, uuid, text) to service_role;
grant execute on function student_submit.group_file_links(text, uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;

-- ── PART 2 ──────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '5s';
do $guard$
begin
    if to_regclass('public.markup') is null then
        raise exception 'C1 is not applied: nothing to take out. Nothing was changed.';
    end if;
    if exists (select 1 from pg_trigger t where t.tgrelid = 'public.grade_return'::regclass
                and t.tgname in ('markup_given_on_insert', 'markup_given_on_return')) then
        raise exception 'C2 is applied: take it out first (batch-c2-undo.sql). Nothing was changed.';
    end if;
    if coalesce(current_setting('fv.batch_c_undo', true), '') <> 'discard'
       and (exists (select 1 from public.markup) or exists (select 1 from public.revision_request)
            or exists (select 1 from public.feedback_reflection)) then
        raise exception 'Batch C''s tables hold teachers'' marks, revision requests or students'' reflections. To delete them with the rest, run  set fv.batch_c_undo = ''discard'';  first. Nothing was changed.';
    end if;
end
$guard$;
drop trigger if exists work_feedback_gone on public.enrollment;
drop trigger if exists work_feedback_gone on public.assessment;
drop trigger if exists work_feedback_truncate on public.enrollment;
drop trigger if exists work_feedback_truncate on public.assessment;
drop function if exists student_submit.group_file_links(text, uuid, uuid, text);
drop function if exists student_submit.group_work(text, uuid, text);
drop function if exists student_submit.revision_unsend(text, uuid, uuid, text);
drop function if exists student_submit.revision_finish(text, uuid, uuid, jsonb, text);
drop function if exists student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text);
drop function if exists student_submit.reply(text, uuid, uuid, jsonb, text);
drop function if exists student_submit.reflect(text, uuid, uuid, jsonb, text);
drop function if exists student_submit.markup(text, uuid, uuid, text);
drop function if exists student_submit.feedback(text, uuid, text);
drop function if exists student_submit._group_members(uuid, uuid);
drop function if exists public.list_course_feedback(uuid);
drop function if exists public.answer_reflection(uuid, text, uuid);
drop function if exists public.cancel_revision(uuid, uuid);
drop function if exists public.set_revision_request(uuid, jsonb, uuid);
drop function if exists public.return_for_revision(uuid, uuid, jsonb, uuid);
drop function if exists public.return_work(uuid, uuid[], uuid);
drop function if exists public.list_assessment_markup(uuid);
drop function if exists public.save_markup(uuid, jsonb, integer, uuid);
drop function if exists public.set_course_feedback_options(uuid, jsonb, uuid);
drop function if exists public._reflection_json(uuid);
drop function if exists public._revision_json(uuid);
drop function if exists public._revision_state(uuid);
drop function if exists public._piece_latest(uuid, uuid);
drop function if exists public._revision_unhide_grade(uuid);
drop function if exists public._revision_hide_grade(uuid);
drop function if exists public._revision_hide_available();
drop function if exists public._markup_give(uuid, uuid);
drop function if exists public._markup_check(jsonb);
drop function if exists public._work_feedback_truncated();
drop function if exists public._work_feedback_gone();
drop table if exists public.feedback_reflection;
drop table if exists public.revision_request;
drop table if exists public.markup;
alter table public.course drop column if exists reflect_on_feedback, drop column if exists show_my_learning;
do $final$
begin
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where (n.nspname, p.proname) in (('public', 'save_markup'), ('student_submit', 'revision_start'), ('public', '_markup_give'))) then
        raise exception 'something of C1 is left. Nothing was changed.';
    end if;
end
$final$;
notify pgrst, 'reload schema';
commit;
