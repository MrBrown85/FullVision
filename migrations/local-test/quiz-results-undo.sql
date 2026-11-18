-- Undo for migrations/2026111803_quiz_results.sql (2026-11-17).
--
-- ── PART 1, the stop that deletes nothing ────────────────────────────────────
-- Takes mark_quiz_answer, reopen_quiz and confirm_quiz away from teachers
-- (revokes execute from authenticated). Every given point, note, reopened
-- try and confirmed marking stays. To turn it back on, run the migration
-- file again (its grants are restated). Run PART 1 alone (from "PART 1
-- begins" to "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
-- Drops the three functions. It deletes no row: the columns they wrote are
-- 2026111802's and stay. Stops, with the functions kept, if one is not this
-- file's definition. Takes no lock on an existing table.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.
--
-- md5 of pg_get_functiondef (as the file leaves them):
--   public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)   77bd2789ea9f46790f6eef639a605c24
--   public.reopen_quiz(uuid,uuid,uuid)                     012bb9a8cb2a7034b90b14e2f5c20c87
--   public.confirm_quiz(uuid,jsonb,uuid)                   6f0684dffbf9ec9487feb212d81e7347

-- PART 1 begins
do $stop$
declare
    _sig text;
begin
    foreach _sig in array array['public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', 'public.reopen_quiz(uuid,uuid,uuid)',
                                'public.confirm_quiz(uuid,jsonb,uuid)'] loop
        if to_regprocedure(_sig) is not null then
            execute 'revoke execute on function ' || _sig || ' from authenticated';
        end if;
    end loop;
end
$stop$;
-- PART 1 ends

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in select * from (values
        ('public.mark_quiz_answer(uuid,uuid,numeric,text,uuid)', '77bd2789ea9f46790f6eef639a605c24'),
        ('public.reopen_quiz(uuid,uuid,uuid)', '012bb9a8cb2a7034b90b14e2f5c20c87'),
        ('public.confirm_quiz(uuid,jsonb,uuid)', '6f0684dffbf9ec9487feb212d81e7347')
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 <> _f.now then
            raise exception '% is not the definition 2026111803 left (md5 %). The functions are kept; if PART 1 ran before this, teachers are without them until the migration file is run again.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

drop function if exists public.mark_quiz_answer(uuid, uuid, numeric, text, uuid);
drop function if exists public.reopen_quiz(uuid, uuid, uuid);
drop function if exists public.confirm_quiz(uuid, jsonb, uuid);

commit;
