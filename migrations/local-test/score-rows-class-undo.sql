-- Undo for migrations/2026112602_score_rows_carry_their_class.sql (S0-M6, 2026-11-25).
--
-- Neither part deletes a grade or changes one. Both are all or nothing, take
-- their locks as the file does (all at once or none; a save waits for them,
-- or the part gives up after fifteen seconds with nothing changed), and change
-- nothing on a database that never had the file. A second run changes
-- nothing.
--
-- == PART 0, the fast stop ==
-- Drops the eight checking triggers: the three that check a level's
-- competency, criterion or checkbox (tag_score_class_parent,
-- rubric_score_class_parent, rubric_check_score_class_parent) and the five
-- that keep a section, rubric, competency, criterion or checkbox in its class
-- (section_class_fixed, rubric_class_fixed, tag_class_fixed,
-- criterion_class_fixed, criterion_check_class_fixed). Moving a section or a
-- competency to another class works again, as before the file. The column,
-- the triggers that fill it and the widened keys stay, so a score whose
-- assessment is in another class than its student is still refused. Run PART
-- 0 alone (from "PART 0 begins" to "PART 0 ends").
--
-- == PART 1, the full removal: the rest of this file ==
-- Puts the five tables back exactly as before the file: drops the triggers
-- that fill course_id and the eight of PART 0, puts back each table's two
-- one-column keys under their names (enrollment_id -> enrollment(id),
-- assessment_id -> assessment(id), on delete cascade), drops the two unique
-- (id, course_id) keys, the course_id columns and the three functions.
-- Dropping a column leaves one dropped-column slot on its table (invisible;
-- nothing reads it). The keys put back are new objects with the old names
-- and definitions; when one row breaks two keys at once, which of them is
-- named in the error may differ from before (the error code does not). Every score, level, tick and DIBELS row stays, with
-- every value and updated_at as it was; no sync version moves. It stops with
-- nothing changed if a key is neither the file's nor the one before it. It
-- runs after PART 0 or without it. Run whole, the file is PART 0 and then
-- PART 1.

-- PART 0 begins
begin;
set local lock_timeout = '5s';

do $locks$
declare
    _until timestamptz := clock_timestamp() + interval '15 seconds';
    _try   timestamptz;
    _left  double precision;
    _t     text;
begin
    if current_setting('deadlock_timeout')::interval < interval '500 milliseconds' then
        raise exception 'deadlock_timeout is %, under the 500 ms this was written for. Nothing was changed.',
            current_setting('deadlock_timeout');
    end if;
    -- Every lock, one table after another in this order, waiting its turn for each, but a whole try may take
    -- 0.4 s: past that it is undone, which lets go of every lock it had, and it tries again. While the file
    -- waits, no session waits behind a lock it holds for as long as PostgreSQL's deadlock check
    -- (deadlock_timeout, 1 s by default), and once it holds them all it waits for nothing; so no save or class
    -- load is ever cancelled as a deadlock, whatever order it reads these tables in.
    loop
        begin
            _try := clock_timestamp();
            foreach _t in array array['public.section',
                         'public.tag',
                         'public.rubric',
                         'public.criterion',
                         'public.criterion_check',
                         'public.tag_score',
                         'public.rubric_score',
                         'public.rubric_check_score'] loop
                _left := 400 - extract(epoch from clock_timestamp() - _try) * 1000;
                if _left < 1 then
                    raise exception 'a try took 0.4 s' using errcode = '55P03';
                end if;
                perform set_config('lock_timeout', ceil(_left)::int || 'ms', true);
                execute 'lock table ' || _t || ' in access exclusive mode';
            end loop;
            exit;
        exception when lock_not_available then
            if clock_timestamp() > _until then
                raise exception 'the tables were busy for fifteen seconds. Nothing was changed: run it again.'
                    using errcode = '55P03';
            end if;
        end;
    end loop;
    perform set_config('lock_timeout', '5s', true);
end
$locks$;

drop trigger if exists tag_score_class_parent on public.tag_score;
drop trigger if exists rubric_score_class_parent on public.rubric_score;
drop trigger if exists rubric_check_score_class_parent on public.rubric_check_score;
drop trigger if exists section_class_fixed on public.section;
drop trigger if exists rubric_class_fixed on public.rubric;
drop trigger if exists tag_class_fixed on public.tag;
drop trigger if exists criterion_class_fixed on public.criterion;
drop trigger if exists criterion_check_class_fixed on public.criterion_check;

commit;
-- PART 0 ends

-- PART 1 begins
begin;
set local lock_timeout = '5s';

do $locks$
declare
    _until timestamptz := clock_timestamp() + interval '15 seconds';
    _try   timestamptz;
    _left  double precision;
    _t     text;
begin
    if current_setting('deadlock_timeout')::interval < interval '500 milliseconds' then
        raise exception 'deadlock_timeout is %, under the 500 ms this was written for. Nothing was changed.',
            current_setting('deadlock_timeout');
    end if;
    -- Every lock, one table after another in this order, waiting its turn for each, but a whole try may take
    -- 0.4 s: past that it is undone, which lets go of every lock it had, and it tries again. While the file
    -- waits, no session waits behind a lock it holds for as long as PostgreSQL's deadlock check
    -- (deadlock_timeout, 1 s by default), and once it holds them all it waits for nothing; so no save or class
    -- load is ever cancelled as a deadlock, whatever order it reads these tables in.
    loop
        begin
            _try := clock_timestamp();
            foreach _t in array array['public.section',
                         'public.tag',
                         'public.rubric',
                         'public.criterion',
                         'public.criterion_check',
                         'public.assessment',
                         'public.enrollment',
                         'public.score',
                         'public.tag_score',
                         'public.rubric_score',
                         'public.rubric_check_score',
                         'public.dibels_score'] loop
                _left := 400 - extract(epoch from clock_timestamp() - _try) * 1000;
                if _left < 1 then
                    raise exception 'a try took 0.4 s' using errcode = '55P03';
                end if;
                perform set_config('lock_timeout', ceil(_left)::int || 'ms', true);
                execute 'lock table ' || _t || ' in access exclusive mode';
            end loop;
            exit;
        exception when lock_not_available then
            if clock_timestamp() > _until then
                raise exception 'the tables were busy for fifteen seconds. Nothing was changed: run it again.'
                    using errcode = '55P03';
            end if;
        end;
    end loop;
    perform set_config('lock_timeout', '5s', true);
end
$locks$;

do $undo$
declare
    _t   text;
    _key text;
    _def text;
begin
    foreach _t in array array['score', 'tag_score', 'rubric_score', 'rubric_check_score', 'dibels_score'] loop
        foreach _key in array array['enrollment', 'assessment'] loop
            -- pg_get_constraintdef leaves out "public." when public is on the search path: compare without it.
            select replace(pg_get_constraintdef(k.oid), 'public.', '') into _def
              from pg_constraint k
             where k.conrelid = ('public.' || _t)::regclass and k.conname = _t || '_' || _key || '_id_fkey';
            if _def is distinct from format('FOREIGN KEY (%s_id) REFERENCES %s(id) ON DELETE CASCADE', _key, _key)
               and _def is distinct from format('FOREIGN KEY (%s_id, course_id) REFERENCES %s(id, course_id) MATCH FULL ON DELETE CASCADE', _key, _key) then
                raise exception '%.%_%_id_fkey is neither the file''s nor the one before it (%). Nothing was changed.',
                    _t, _t, _key, coalesce(_def, 'missing');
            end if;
        end loop;
    end loop;

    foreach _t in array array['score', 'tag_score', 'rubric_score', 'rubric_check_score', 'dibels_score'] loop
        execute format('drop trigger if exists %I on public.%I', _t || '_class', _t);
        if _t in ('tag_score', 'rubric_score', 'rubric_check_score') then
            execute format('drop trigger if exists %I on public.%I', _t || '_class_parent', _t);
        end if;
        foreach _key in array array['enrollment', 'assessment'] loop
            -- Only a key that carries the class is put back; one already as before is left alone.
            if exists (select 1 from pg_constraint k
                        where k.conrelid = ('public.' || _t)::regclass and k.conname = _t || '_' || _key || '_id_fkey'
                          and array_length(k.conkey, 1) = 2) then
                execute format('alter table public.%I drop constraint %I', _t, _t || '_' || _key || '_id_fkey');
                execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I (id) on delete cascade',
                               _t, _t || '_' || _key || '_id_fkey', _key || '_id', _key);
            end if;
        end loop;
        execute format('alter table public.%I drop column if exists course_id', _t);
    end loop;
end
$undo$;

drop trigger if exists section_class_fixed on public.section;
drop trigger if exists rubric_class_fixed on public.rubric;
drop trigger if exists tag_class_fixed on public.tag;
drop trigger if exists criterion_class_fixed on public.criterion;
drop trigger if exists criterion_check_class_fixed on public.criterion_check;

alter table public.enrollment drop constraint if exists enrollment_id_course_uk;
alter table public.assessment drop constraint if exists assessment_id_course_uk;

drop function if exists public._score_row_class();
drop function if exists public._score_row_parent_class();
drop function if exists public._class_is_fixed();

notify pgrst, 'reload schema';

commit;
-- PART 1 ends
