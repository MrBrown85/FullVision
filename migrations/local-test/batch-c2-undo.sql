-- Taking Batch C's second file (2026111121_markup_revise_grade_changes.sql)
-- back out. Not a migration: run by hand on the owner's word, as one
-- transaction. Proved by batch_c_undo.py (the catalog afterwards is the
-- catalog C1 alone leaves, line for line).
--
-- What it does, in order:
--   1. Every hide that is on now (grade_hidden: begun and not ended; at
--      most one per student and piece, on that piece's open request) is
--      given back to its student, exactly as C2's own Take Back gives it
--      (under each class's lock), and marked ended by the undo. A hide
--      that has ended is never read, so an old request can never give back
--      an old grade, whatever order the requests come in. No mark is given
--      (Take Back gives none). This writes those students' grade_return
--      rows: it is the reverse of what C2 did to them.
--   2. The two triggers on grade_return and their function go: marks are
--      again given only through return_work, or at once in a class that
--      does not hold grades.
--   3. C1's three stand-ins come back: hiding a grade answers
--      hide_not_available again.
-- Marks already given stay given. Requests keep their words.
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

-- 1. Hidden grades are given back.
do $unhide$
declare
    _r record;
begin
    for _r in select id, course_id from public.revision_request where grade_hidden order by course_id, id loop
        perform public._grade_return_lock_first(_r.course_id);
        if public._revision_unhide_grade(_r.id) then
            update public.revision_request set hide_ended_by = 'undone' where id = _r.id;
        end if;
    end loop;
end
$unhide$;

-- 2. The triggers.
drop trigger if exists markup_given_on_insert on public.grade_return;
drop trigger if exists markup_given_on_return on public.grade_return;
drop function if exists public._markup_on_return();

-- 3. C1's stand-ins, word for word.
create or replace function public._revision_hide_available()
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select false;
$function$;

create or replace function public._revision_hide_grade(p_request_id uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
    select false;
$function$;

create or replace function public._revision_unhide_grade(p_request_id uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
    select false;
$function$;
revoke all on function public._revision_hide_available() from public, anon, authenticated, service_role;
revoke all on function public._revision_hide_grade(uuid) from public, anon, authenticated, service_role;
revoke all on function public._revision_unhide_grade(uuid) from public, anon, authenticated, service_role;

do $final$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN c1stand (written by migrations/local-test/batch_c_fingerprints.py)
            ('public._revision_hide_available()',   'cd50f4c6493a73b3c42ae51f7580f970'),
            ('public._revision_hide_grade(uuid)',   '247080f6572bb45951cef807a2b849bd'),
            ('public._revision_unhide_grade(uuid)', '26d2861325edf27f95d090ebd590eb0f')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not as C1 leaves it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    if exists (select 1 from public.revision_request where grade_hidden) then
        raise exception 'a grade is still hidden. Nothing was changed.';
    end if;
end
$final$;

commit;
