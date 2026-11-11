-- Taking Batch C's second file (2026111121_markup_revise_grade_changes.sql)
-- back out. Not a migration: run by hand on the owner's word, as one
-- transaction. Proved by batch_c_undo.py (the catalog afterwards is the
-- catalog C1 alone leaves, line for line, and no row changes).
--
-- What it does: the two triggers on grade_return and their function go.
-- Marks are again given only through return_work, or at once in a class
-- that does not hold grades; a finished revision request is again stored
-- as done at the next Batch C call. No row is written: marks already given
-- stay given, requests stored done stay done, and no grade row is touched
-- (C2 never wrote one).
begin;

set local lock_timeout = '5s';

do $guard$
begin
    if not exists (select 1 from pg_trigger t
                    where t.tgrelid = 'public.grade_return'::regclass and t.tgname = 'markup_given_on_return') then
        raise exception 'C2 is not applied: nothing to take back. Nothing was changed.';
    end if;
end
$guard$;

drop trigger if exists markup_given_on_insert on public.grade_return;
drop trigger if exists markup_given_on_return on public.grade_return;
drop function if exists public._markup_on_return();

commit;
