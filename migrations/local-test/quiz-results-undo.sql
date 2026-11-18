-- Undo for migrations/2026111805_quiz_results.sql (2026-11-17).
--
-- == PART 1, the stop that deletes nothing ==
-- TO STOP, SEND PART 1 ALONE (from "PART 1 begins" to "PART 1 ends"): it is
-- its own transaction. It takes list_quiz_tries, mark_quiz_answer,
-- reopen_quiz and confirm_quiz away from teachers (revokes execute from
-- authenticated). Every given point, note, reopened try and confirmed
-- marking stays. To turn it back on, run the migration file again (its
-- grants are restated).
--
-- == PART 2, the full removal: the rest of this file ==
-- Drops the four functions. It deletes no row: the columns they wrote are
-- 2026111804's and stay. Stops, with the functions kept, if one is not this
-- file's definition. Takes no lock on an existing table.
--
-- Sent whole as one text, PART 1 commits first, then PART 2 runs in a
-- transaction of its own; when PART 2 stops, PART 1's stop stays.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   public.list_quiz_tries(uuid)                           e929cbfe0aa1130741bd2b3af1615a2d
--   public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)   1222e55ae9915bc81c6194abb8b9050e
--   public.reopen_quiz(uuid,uuid,uuid)                     daabc9bbdd81761d4ddfd72b773eca78
--   public.confirm_quiz(uuid,jsonb,uuid)                   ee23f2910b1484f18a41ea76b08f0846

-- PART 1 begins
begin;

do $stop$
declare
    _sig text;
begin
    foreach _sig in array array['public.list_quiz_tries(uuid)', 'public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', 'public.reopen_quiz(uuid,uuid,uuid)',
                                'public.confirm_quiz(uuid,jsonb,uuid)'] loop
        if to_regprocedure(_sig) is not null then
            execute 'revoke execute on function ' || _sig || ' from authenticated';
        end if;
    end loop;
end
$stop$;

commit;
-- PART 1 ends

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in select * from (values
        ('public.list_quiz_tries(uuid)', 'e929cbfe0aa1130741bd2b3af1615a2d'),
        ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', '1222e55ae9915bc81c6194abb8b9050e'),
        ('public.reopen_quiz(uuid,uuid,uuid)', 'daabc9bbdd81761d4ddfd72b773eca78'),
        ('public.confirm_quiz(uuid,jsonb,uuid)', 'ee23f2910b1484f18a41ea76b08f0846')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111805 left (md5 %). The functions are kept; if PART 1 ran before this, teachers are without them until the migration file is run again.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

drop function if exists public.list_quiz_tries(uuid);
drop function if exists public.mark_quiz_answer(uuid, uuid, numeric, text, uuid);
drop function if exists public.reopen_quiz(uuid, uuid, uuid);
drop function if exists public.confirm_quiz(uuid, jsonb, uuid);

commit;
