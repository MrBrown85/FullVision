-- The returned quiz reaches the student again (2026-11-24). APPLIED Nov 24 2026.
--
-- What broke: 2026112402 moved the student-submit edge function onto its own
-- narrow login, fv_student_submit, and granted it EXECUTE on each
-- student_submit function that existed then. 2026112407 added
-- student_submit.quiz_result afterwards and granted it to service_role only,
-- so the quiz-result route is refused on the live site: a student whose quiz
-- comes back never sees See Your Quiz (the page says nothing, by design).
--
-- What this does: grants EXECUTE on that one function to fv_student_submit,
-- as 2026112402 did for the others. Nothing else changes; no row is touched.
--
-- Checks first: it stops with nothing changed unless the function and the
-- login both exist. Re-runnable: granting twice is the same as once.
-- Nothing here depends on collation, locale, time zone or search path.
-- Undo: revoke execute on function student_submit.quiz_result(text, uuid, uuid, text) from fv_student_submit;

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)') is null then
    raise exception 'student_submit.quiz_result(text,uuid,uuid,text) is not there: apply 2026112407 first';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
    raise exception 'the login fv_student_submit is not there: apply 2026112402 first';
  end if;
end
$$;

grant execute on function student_submit.quiz_result(text, uuid, uuid, text) to fv_student_submit;

do $$
begin
  if not has_function_privilege('fv_student_submit', 'student_submit.quiz_result(text,uuid,uuid,text)', 'execute') then
    raise exception 'fv_student_submit still cannot run student_submit.quiz_result';
  end if;
end
$$;

commit;
