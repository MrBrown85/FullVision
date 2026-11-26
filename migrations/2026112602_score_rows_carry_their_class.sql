-- Score rows carry their class, so the database itself refuses a row that
-- names another class, whoever writes it (S0-M6, written 2026-11-10,
-- brought up to date 2026-11-25). NOT APPLIED: it waits for Colin's OK.
--
-- == What was wrong ==========================================================
-- A score row names a student's enrollment and an assessment, and a level
-- row names a competency, a criterion or a checkbox as well. All of them
-- must be in one class. Two rules hold that today, and neither holds it for
-- every writer:
--   * Row security (2026110901, the *_same_class policies) checks that
--     they are in one class, but only for a signed-in teacher. It does not
--     bind the service role, the table owner, or a SECURITY DEFINER
--     function.
--   * The same_teacher triggers (2026111301) bind every writer, but check
--     only that every id belongs to the same teacher.
-- So a SECURITY DEFINER function (the only way the service role or a
-- nightly job reaches these tables: they have no grants on them) could file
-- one class's grade under a student of another class of the same teacher,
-- and nothing in the database would stop it. No function does
-- that today (every one is checked in migrations/local-test/
-- score_rows_class.py); this makes it impossible, not just absent.
--
-- == What it adds ============================================================
-- 1. course_id on score, tag_score, rubric_score, rubric_check_score and
--    dibels_score: the class the row belongs to. The database fills it, on
--    every insert, from the row's enrollment (trigger <table>_class, BEFORE
--    INSERT OR UPDATE OF enrollment_id, course_id). Whatever a caller sends
--    in that column is thrown away, and an update that names it puts back
--    the enrollment's class. So it is never anything else.
-- 2. The two foreign keys each of the five tables has, to enrollment and to
--    assessment, now carry the class with them:
--      (enrollment_id, course_id) -> enrollment (id, course_id)
--      (assessment_id, course_id) -> assessment (id, course_id)
--    A row whose assessment is not in its enrollment's class has no
--    assessment to point at, and is refused with the foreign-key error
--    (23503), for every writer. The keys keep their names and ON DELETE
--    CASCADE, so a deleted student or assessment still takes its rows. They
--    are the same two keys, widened: not two more. (Two keys to one parent,
--    one that cascades and one that only checks, can refuse a delete
--    depending on which fires first; two that both cascade would run every
--    cascade twice, and every statement trigger on these tables with it.)
--    For the pairs to be keys, enrollment and assessment each get a unique
--    (id, course_id), named as subject's and competency_group's already
--    are: enrollment_id_course_uk, assessment_id_course_uk.
--    The keys are MATCH FULL and course_id is left nullable, on purpose. A
--    row whose enrollment does not exist gets no class from the trigger and
--    is refused by the key with 23503, the same error code as today (the
--    message is MATCH FULL's). NOT NULL would answer first with another code. No stored row can have a
--    null course_id: enrollment_id and assessment_id are NOT NULL (the
--    file checks that first), and MATCH FULL refuses a key that is part
--    null.
--    An enrollment or an assessment that has score rows can no longer be
--    moved to another class (ON UPDATE NO ACTION). No function does that.
-- 3. The third thing a row can name: tag_score's competency, rubric_score's
--    criterion, rubric_check_score's checkbox. A trigger after the insert,
--    and after an update that names the id, the student or the class
--    (<table>_class_parent), checks that it resolves to the row's class
--    (tag -> section, criterion -> rubric, criterion_check -> criterion ->
--    rubric) and refuses the row with 23503 if not. It runs after row
--    security, so a teacher is still refused by the policy first, as now.
--    Why a trigger and not keys here too: keys would need a course_id
--    column, a trigger to fill it and a unique (id, course_id) on tag,
--    criterion and criterion_check as well, three more tables changed, to
--    save one primary-key lookup per level saved.
-- 4. So that check cannot go stale, the class of a section, a competency, a
--    rubric, a criterion and a checkbox can no longer change:
--      section.course_id and rubric.course_id cannot be changed;
--      tag.section_id, criterion.rubric_id and criterion_check.criterion_id
--        can change only within the class.
--    THIS STOPS TWO THINGS THAT WORK TODAY and that the app never asks for:
--    upsert_section can move a section to a subject in another of the
--    teacher's classes, and upsert_tag can move a competency to a section
--    in another of their classes. Both are now refused (23503). A move into
--    another teacher's class is refused as row security refuses it today
--    (42501, the same words), so the trigger, which runs first, tells no one
--    whether the other teacher's id exists. The app
--    saves each class's learning map with that class's own subjects and
--    sections (shared/data.js), so it never sends either. Refusing only
--    when a level would be left behind was the other choice; it needs row
--    locks on the competency and its section in every save, and those
--    collide with ordinary edits to the learning map.
--
-- No existing function, policy or grant is changed, and none needs to be:
-- every writer names its columns, so the new one is filled for it. One
-- reader shows it: get_assessment_detail sends each student's score row
-- whole (to_jsonb), so its "score" object gains "course_id", the class the
-- teacher asked about. The app reads that object's fields by name
-- (shared/data.js) and ignores the new one. No other reader sends it: each
-- names its columns (get_class_bundle, get_gradebook, the student page and
-- the returned-grade copies were checked).
--
-- == What it does to existing rows ===========================================
-- Every row of the five tables gets its course_id: on gradebook-prod on
-- 2026-11-26 (UTC; the read-only pre-check) 2,876 score, 1,220 tag_score,
-- 7,173 rubric_score and 1,876 rubric_check_score rows, and no dibels_score
-- rows. Nothing else in any row changes: not a score, not updated_at. While it fills the column the
-- file switches the tables' own triggers off (ALTER TABLE ... DISABLE
-- TRIGGER USER) and on again, inside its one transaction, so the sync
-- version of no class moves and the returned-grade triggers do not take
-- every row for a changed grade. The tables are locked against every other
-- session from the file's first step to its commit, so no save can
-- slip past while they are off.
--
-- Once it has its locks, the file counts every row that names a class other
-- than its student's (an assessment, a competency, a criterion or a
-- checkbox), and stops, with nothing changed, unless every count is 0: such
-- a row could not be given a class that fits both its student and what it
-- names. It stops too if a key, a column or a trigger is not as it was
-- written for. The same counts, read-only, are
-- migrations/local-test/score-rows-class-live-precheck.sql.
--
-- == Locks and time ==========================================================
-- The first step takes every lock the file needs, ACCESS EXCLUSIVE, on
-- section, tag, rubric, criterion, criterion_check, assessment, enrollment
-- and the five score tables, one after another, waiting its turn for each;
-- but a whole try may take 0.4 s, after which it lets go of everything it
-- took and tries again, for up to fifteen seconds. So a save or class load that
-- waits behind it while it is still waiting itself never reaches
-- PostgreSQL's one-second deadlock check, and once it holds every lock it
-- waits for nothing: no save is ever cancelled as a deadlock. (A plain LOCK,
-- which waits as long as it takes, deadlocked with class loads and saves in
-- the race test and cancelled one or the other; LOCK ... NOWAIT never got
-- its turn under heavy load; and a limit on each table's wait rather than
-- on the whole try still let a save be cancelled, found by the review.) All
-- are held to the commit: every save, and every class load, waits that
-- long: 0.15 to 0.5 s at production size, 2.2 to 6.3 s at 20 times it
-- (score_rows_class.py, scenario timing, the whole file in one transaction,
-- PostgreSQL 17). If it has not got them all within fifteen seconds it
-- stops with nothing changed (55P03), and may be run again. (Five seconds
-- was too short once in ten rounds of four connections saving without a
-- break.)
--
-- == What a save pays ========================================================
-- On each insert, one read of the enrollment by primary key (the trigger
-- that fills the class); the two key checks it already made, each now on
-- two columns; and for a level or a tick, one more read by primary key
-- across two or three tables. An update that does not name the class, the
-- student or the competency (a changed level, a comment) fires none of the
-- new triggers. None of the new code takes a row lock.
--
-- Can be run again: every statement replaces what it made, and a second run
-- changes no row.
--
-- Undo: migrations/local-test/score-rows-class-undo.sql (PART 0, the fast
-- stop: moves allowed again, the rest kept; PART 1, the full removal: the
-- tables exactly as before, no grade touched).
--
-- One transaction: the file opens with begin and ends with commit, so it is
-- all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first.
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

do $guard$
declare
    _n    bigint;
    _bad  text;
    _t    text;
    _key  text;
    _def  text;
begin
    -- enrollment_id and assessment_id must be NOT NULL on all five (see 2 above).
    select string_agg(c.relname || '.' || a.attname, ', ' order by c.relname collate "C", a.attname collate "C") into _bad
      from pg_class c join pg_attribute a on a.attrelid = c.oid
     where c.oid in ('public.score'::regclass, 'public.tag_score'::regclass, 'public.rubric_score'::regclass,
                     'public.rubric_check_score'::regclass, 'public.dibels_score'::regclass)
       and a.attname in ('enrollment_id', 'assessment_id') and not a.attnotnull;
    if _bad is not null then
        raise exception '% can be null; this file was written for NOT NULL. Nothing was changed.', _bad;
    end if;

    -- The keys it widens must be the ones it was written for: today's one-column keys, or its own
    -- two-column ones from an earlier run. Anything else stops it.
    foreach _t in array array['score', 'tag_score', 'rubric_score', 'rubric_check_score', 'dibels_score'] loop
        foreach _key in array array['enrollment', 'assessment'] loop
            -- pg_get_constraintdef leaves out "public." when public is on the search path: compare without it.
            select replace(pg_get_constraintdef(k.oid), 'public.', '') into _def
              from pg_constraint k
             where k.conrelid = ('public.' || _t)::regclass and k.conname = _t || '_' || _key || '_id_fkey';
            if _def is distinct from format('FOREIGN KEY (%s_id) REFERENCES %s(id) ON DELETE CASCADE', _key, _key)
               and _def is distinct from format('FOREIGN KEY (%s_id, course_id) REFERENCES %s(id, course_id) MATCH FULL ON DELETE CASCADE', _key, _key) then
                raise exception '%.%_%_id_fkey is not what this file was written for (%). Nothing was changed.',
                    _t, _t, _key, coalesce(_def, 'missing');
            end if;
        end loop;
        if exists (select 1 from pg_constraint k
                    where k.conrelid = ('public.' || _t)::regclass and k.contype = 'f'
                      and k.confrelid in ('public.enrollment'::regclass, 'public.assessment'::regclass)
                      and k.conname not in (_t || '_enrollment_id_fkey', _t || '_assessment_id_fkey')) then
            raise exception '% has another key to enrollment or assessment. Nothing was changed.', _t;
        end if;
        if exists (select 1 from pg_attribute a
                    where a.attrelid = ('public.' || _t)::regclass and a.attname = 'course_id' and not a.attisdropped
                      and (a.atttypid <> 'uuid'::regtype or a.attnotnull)) then
            raise exception '%.course_id is there already and is not a nullable uuid. Nothing was changed.', _t;
        end if;
    end loop;

    -- A trigger someone switched off on purpose would be switched back on by the backfill.
    select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', ' order by t.tgrelid::regclass::text collate "C", t.tgname collate "C") into _bad
      from pg_trigger t
     where t.tgrelid in ('public.score'::regclass, 'public.tag_score'::regclass, 'public.rubric_score'::regclass,
                         'public.rubric_check_score'::regclass, 'public.dibels_score'::regclass)
       and not t.tgisinternal and t.tgenabled <> 'O';
    if _bad is not null then
        raise exception 'these triggers are not in their normal state: %. Nothing was changed.', _bad;
    end if;

    select (select count(*) from public.score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.tag_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.rubric_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.rubric_check_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
         + (select count(*) from public.dibels_score x join public.enrollment e on e.id = x.enrollment_id
              join public.assessment a on a.id = x.assessment_id where a.course_id <> e.course_id)
      into _n;
    if _n > 0 then
        raise exception '% score rows name an assessment in another class than their student''s. Nothing was changed.', _n;
    end if;

    select (select count(*) from public.tag_score x join public.enrollment e on e.id = x.enrollment_id
              join public.tag t on t.id = x.tag_id join public.section s on s.id = t.section_id
             where s.course_id <> e.course_id)
         + (select count(*) from public.rubric_score x join public.enrollment e on e.id = x.enrollment_id
              join public.criterion c on c.id = x.criterion_id join public.rubric r on r.id = c.rubric_id
             where r.course_id <> e.course_id)
         + (select count(*) from public.rubric_check_score x join public.enrollment e on e.id = x.enrollment_id
              join public.criterion_check k on k.id = x.check_id join public.criterion c on c.id = k.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id <> e.course_id)
      into _n;
    if _n > 0 then
        raise exception '% rows name a competency, criterion or checkbox of another class than their student''s. Nothing was changed.', _n;
    end if;
end
$guard$;

-- == 1. The column, and every row's class ====================================
alter table public.score              add column if not exists course_id uuid;
alter table public.tag_score          add column if not exists course_id uuid;
alter table public.rubric_score       add column if not exists course_id uuid;
alter table public.rubric_check_score add column if not exists course_id uuid;
alter table public.dibels_score       add column if not exists course_id uuid;

-- The tables' own triggers stand aside while the column is filled: nothing
-- about a grade changes, so no sync version should move and the
-- returned-grade triggers have nothing to settle. The tables are locked
-- (the first statement), so no other session writes while they are off. A
-- second run finds no row to change.
alter table public.score              disable trigger user;
alter table public.tag_score          disable trigger user;
alter table public.rubric_score       disable trigger user;
alter table public.rubric_check_score disable trigger user;
alter table public.dibels_score       disable trigger user;

update public.score x              set course_id = e.course_id from public.enrollment e
 where e.id = x.enrollment_id and x.course_id is distinct from e.course_id;
update public.tag_score x          set course_id = e.course_id from public.enrollment e
 where e.id = x.enrollment_id and x.course_id is distinct from e.course_id;
update public.rubric_score x       set course_id = e.course_id from public.enrollment e
 where e.id = x.enrollment_id and x.course_id is distinct from e.course_id;
update public.rubric_check_score x set course_id = e.course_id from public.enrollment e
 where e.id = x.enrollment_id and x.course_id is distinct from e.course_id;
update public.dibels_score x       set course_id = e.course_id from public.enrollment e
 where e.id = x.enrollment_id and x.course_id is distinct from e.course_id;

alter table public.score              enable trigger user;
alter table public.tag_score          enable trigger user;
alter table public.rubric_score       enable trigger user;
alter table public.rubric_check_score enable trigger user;
alter table public.dibels_score       enable trigger user;

comment on column public.score.course_id is
    'The class this row belongs to: its enrollment''s. Filled by the database (trigger score_class); a value sent by a caller is thrown away.';
comment on column public.tag_score.course_id is
    'The class this row belongs to: its enrollment''s. Filled by the database (trigger tag_score_class); a value sent by a caller is thrown away.';
comment on column public.rubric_score.course_id is
    'The class this row belongs to: its enrollment''s. Filled by the database (trigger rubric_score_class); a value sent by a caller is thrown away.';
comment on column public.rubric_check_score.course_id is
    'The class this row belongs to: its enrollment''s. Filled by the database (trigger rubric_check_score_class); a value sent by a caller is thrown away.';
comment on column public.dibels_score.course_id is
    'The class this row belongs to: its enrollment''s. Filled by the database (trigger dibels_score_class); a value sent by a caller is thrown away.';

-- == 2. The class fills itself ===============================================
-- SECURITY DEFINER so it reads enrollment past row security: it must give
-- the same answer for every writer, and it tells a caller nothing (the row
-- is theirs to write or it is refused afterwards). An enrollment that does
-- not exist leaves the class null, and the foreign key refuses the row.
create or replace function public._score_row_class()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
    new.course_id := (select e.course_id from enrollment e where e.id = new.enrollment_id);
    return new;
end;
$function$;
revoke all on function public._score_row_class() from public, anon, authenticated, service_role;

drop trigger if exists score_class on public.score;
create trigger score_class before insert or update of enrollment_id, course_id on public.score
    for each row execute function public._score_row_class();
drop trigger if exists tag_score_class on public.tag_score;
create trigger tag_score_class before insert or update of enrollment_id, course_id on public.tag_score
    for each row execute function public._score_row_class();
drop trigger if exists rubric_score_class on public.rubric_score;
create trigger rubric_score_class before insert or update of enrollment_id, course_id on public.rubric_score
    for each row execute function public._score_row_class();
drop trigger if exists rubric_check_score_class on public.rubric_check_score;
create trigger rubric_check_score_class before insert or update of enrollment_id, course_id on public.rubric_check_score
    for each row execute function public._score_row_class();
drop trigger if exists dibels_score_class on public.dibels_score;
create trigger dibels_score_class before insert or update of enrollment_id, course_id on public.dibels_score
    for each row execute function public._score_row_class();

-- == 3. The student and the assessment are in that class =====================
do $keys$
begin
    if not exists (select 1 from pg_constraint where conname = 'enrollment_id_course_uk' and conrelid = 'public.enrollment'::regclass) then
        alter table public.enrollment add constraint enrollment_id_course_uk unique (id, course_id);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'assessment_id_course_uk' and conrelid = 'public.assessment'::regclass) then
        alter table public.assessment add constraint assessment_id_course_uk unique (id, course_id);
    end if;
end
$keys$;

-- The same two keys on each table, under the same names, now with the
-- class. The enrollment's is made first on each.
alter table public.score
    drop constraint if exists score_enrollment_id_fkey,
    drop constraint if exists score_assessment_id_fkey;
alter table public.score
    add constraint score_enrollment_id_fkey foreign key (enrollment_id, course_id)
        references public.enrollment (id, course_id) match full on delete cascade;
alter table public.score
    add constraint score_assessment_id_fkey foreign key (assessment_id, course_id)
        references public.assessment (id, course_id) match full on delete cascade;

alter table public.tag_score
    drop constraint if exists tag_score_enrollment_id_fkey,
    drop constraint if exists tag_score_assessment_id_fkey;
alter table public.tag_score
    add constraint tag_score_enrollment_id_fkey foreign key (enrollment_id, course_id)
        references public.enrollment (id, course_id) match full on delete cascade;
alter table public.tag_score
    add constraint tag_score_assessment_id_fkey foreign key (assessment_id, course_id)
        references public.assessment (id, course_id) match full on delete cascade;

alter table public.rubric_score
    drop constraint if exists rubric_score_enrollment_id_fkey,
    drop constraint if exists rubric_score_assessment_id_fkey;
alter table public.rubric_score
    add constraint rubric_score_enrollment_id_fkey foreign key (enrollment_id, course_id)
        references public.enrollment (id, course_id) match full on delete cascade;
alter table public.rubric_score
    add constraint rubric_score_assessment_id_fkey foreign key (assessment_id, course_id)
        references public.assessment (id, course_id) match full on delete cascade;

alter table public.rubric_check_score
    drop constraint if exists rubric_check_score_enrollment_id_fkey,
    drop constraint if exists rubric_check_score_assessment_id_fkey;
alter table public.rubric_check_score
    add constraint rubric_check_score_enrollment_id_fkey foreign key (enrollment_id, course_id)
        references public.enrollment (id, course_id) match full on delete cascade;
alter table public.rubric_check_score
    add constraint rubric_check_score_assessment_id_fkey foreign key (assessment_id, course_id)
        references public.assessment (id, course_id) match full on delete cascade;

alter table public.dibels_score
    drop constraint if exists dibels_score_enrollment_id_fkey,
    drop constraint if exists dibels_score_assessment_id_fkey;
alter table public.dibels_score
    add constraint dibels_score_enrollment_id_fkey foreign key (enrollment_id, course_id)
        references public.enrollment (id, course_id) match full on delete cascade;
alter table public.dibels_score
    add constraint dibels_score_assessment_id_fkey foreign key (assessment_id, course_id)
        references public.assessment (id, course_id) match full on delete cascade;

-- == 4. The competency, the criterion and the checkbox are in that class =====
create or replace function public._score_row_parent_class()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _ok   boolean;
    _what text;
begin
    if tg_table_name = 'tag_score' then
        _what := 'competency';
        _ok := exists (select 1 from tag t join section s on s.id = t.section_id
                        where t.id = new.tag_id and s.course_id = new.course_id);
    elsif tg_table_name = 'rubric_score' then
        _what := 'criterion';
        _ok := exists (select 1 from criterion c join rubric r on r.id = c.rubric_id
                        where c.id = new.criterion_id and r.course_id = new.course_id);
    elsif tg_table_name = 'rubric_check_score' then
        _what := 'checkbox';
        _ok := exists (select 1 from criterion_check k join criterion c on c.id = k.criterion_id
                         join rubric r on r.id = c.rubric_id
                        where k.id = new.check_id and r.course_id = new.course_id);
    else
        raise exception '_score_row_parent_class() is not for table %', tg_table_name;
    end if;
    if not _ok then
        raise exception 'insert or update on table "%" names a % that is not in the row''s class', tg_table_name, _what
            using errcode = '23503', table = tg_table_name, constraint = tg_name;
    end if;
    return null;
end;
$function$;
revoke all on function public._score_row_parent_class() from public, anon, authenticated, service_role;

drop trigger if exists tag_score_class_parent on public.tag_score;
create trigger tag_score_class_parent after insert or update of tag_id, enrollment_id, course_id on public.tag_score
    for each row execute function public._score_row_parent_class();
drop trigger if exists rubric_score_class_parent on public.rubric_score;
create trigger rubric_score_class_parent after insert or update of criterion_id, enrollment_id, course_id on public.rubric_score
    for each row execute function public._score_row_parent_class();
drop trigger if exists rubric_check_score_class_parent on public.rubric_check_score;
create trigger rubric_check_score_class_parent after insert or update of check_id, enrollment_id, course_id on public.rubric_check_score
    for each row execute function public._score_row_parent_class();

-- == 5. And none of them can change class afterwards =========================
create or replace function public._class_is_fixed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _was uuid;
    _now uuid;
begin
    if tg_table_name in ('section', 'rubric') then
        _was := old.course_id; _now := new.course_id;
    elsif tg_table_name = 'tag' then
        _was := (select s.course_id from section s where s.id = old.section_id);
        _now := (select s.course_id from section s where s.id = new.section_id);
    elsif tg_table_name = 'criterion' then
        _was := (select r.course_id from rubric r where r.id = old.rubric_id);
        _now := (select r.course_id from rubric r where r.id = new.rubric_id);
    elsif tg_table_name = 'criterion_check' then
        _was := (select r.course_id from criterion c join rubric r on r.id = c.rubric_id where c.id = old.criterion_id);
        _now := (select r.course_id from criterion c join rubric r on r.id = c.rubric_id where c.id = new.criterion_id);
    else
        raise exception '_class_is_fixed() is not for table %', tg_table_name;
    end if;
    -- A parent that does not exist is the foreign key's to refuse.
    if _now is not null and _now is distinct from _was then
        -- Into another teacher's class: the answer row security gives a teacher today, word for word, so this
        -- trigger (which runs before row security) tells no one whether the other teacher's id exists.
        if (select c.teacher_id from course c where c.id = _now) is distinct from (select c.teacher_id from course c where c.id = _was) then
            raise exception 'new row violates row-level security policy for table "%"', tg_table_name
                using errcode = '42501';
        end if;
        raise exception 'a % cannot be moved to another class', tg_argv[0]
            using errcode = '23503', table = tg_table_name, constraint = tg_name;
    end if;
    return new;
end;
$function$;
revoke all on function public._class_is_fixed() from public, anon, authenticated, service_role;

drop trigger if exists section_class_fixed on public.section;
create trigger section_class_fixed before update of course_id on public.section
    for each row when (old.course_id is distinct from new.course_id)
    execute function public._class_is_fixed('section');
drop trigger if exists rubric_class_fixed on public.rubric;
create trigger rubric_class_fixed before update of course_id on public.rubric
    for each row when (old.course_id is distinct from new.course_id)
    execute function public._class_is_fixed('rubric');
drop trigger if exists tag_class_fixed on public.tag;
create trigger tag_class_fixed before update of section_id on public.tag
    for each row when (old.section_id is distinct from new.section_id)
    execute function public._class_is_fixed('competency');
drop trigger if exists criterion_class_fixed on public.criterion;
create trigger criterion_class_fixed before update of rubric_id on public.criterion
    for each row when (old.rubric_id is distinct from new.rubric_id)
    execute function public._class_is_fixed('criterion');
drop trigger if exists criterion_check_class_fixed on public.criterion_check;
create trigger criterion_check_class_fixed before update of criterion_id on public.criterion_check
    for each row when (old.criterion_id is distinct from new.criterion_id)
    execute function public._class_is_fixed('checkbox');

notify pgrst, 'reload schema';

commit;
