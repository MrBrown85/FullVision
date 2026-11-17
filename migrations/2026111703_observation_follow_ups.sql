-- Observation follow-ups (2026-11-17). NOT APPLIED: needs Colin's OK (rule 1).
--
-- THIS FILE CHANGES NO EXISTING ROW. It adds two empty columns to
-- public.observation, two write functions, one rule, and changes three
-- readers so a follow-up is never read as an observation of its own.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Colin, Nov 17 ("Yes, as recommended"): a teacher can add follow-ups under
-- an observation (Called Home, Spoke With Student, Still Happening,
-- Resolved, or words of their own), each with its own date. A Concern with
-- a Resolved follow-up is closed. Follow-ups are teacher-only: never on a
-- report, never in a grade, never on the student page. His council: the
-- smallest step, one column on observation, not a new system.
--
-- ── What it adds ───────────────────────────────────────────────────────────
-- observation.follow_up_of uuid null, references observation(id) on delete
--   cascade: deleting an observation deletes its follow-ups. Indexed.
-- observation.follow_up_kind text null: called_home, spoke_with_student,
--   still_happening, resolved, or null; only a follow-up may have one.
-- fv_private.observation_follow_up_rule(), on observation and
--   observation_student. A follow-up's parent is in the same class and is
--   not itself a follow-up (one level). The link never changes after the
--   row is made, and a class never changes under a follow-up or its parent.
--   A follow-up has no students of its own: it is its parent's.
-- create_observation_follow_up(p_follow_up_of, p_body, p_kind,
--   p_idempotency_key) returns the new id; update_observation_follow_up(
--   p_id, p_body, p_kind, p_idempotency_key) changes the words and kind.
--   Both are idempotent through p_idempotency_key (CLAUDE.md rule 7), run
--   as the teacher (row security decides what they reach), and refuse an
--   unknown kind and a follow-up with neither a kind nor words. A follow-up
--   is deleted with delete_observation, as before.
--
-- Why a follow-up keeps no students: every reader that finds a student's
-- observations goes through observation_student (the Term Questionnaire's
-- picker in get_term_rating, a withdrawn student's records, the profile
-- lists in list_course_student_profiles and get_class_bundle, the student
-- filter of get_observations, delete_withdrawn_student). With no students a
-- follow-up is in none of them, so no report reader, old or new, can pick
-- one up; and there is no second copy of the students to keep in step.
-- Row security is unchanged: observation's policy is fv_owns_course
-- (course_id), and the rule holds a follow-up to its parent's class.
--
-- ── What it changes (patched in place, md5-checked before and after) ───────
--   get_class_bundle: its observations leave out follow-ups (the newest 500
--     and the total count parents only) and carry 'follow_ups', those of the
--     500. Old pages ignore the new key.
--   get_observations: leaves out follow-ups, and carries 'follow_ups' for
--     the page's observations.
--   import_json_restore: keeps follow_up_of and follow_up_kind on a restored
--     observation (the app sends a follow-up after its parent).
-- md5 of pg_get_functiondef on PostgreSQL 17 (function, live, as this file
-- leaves it):
--   public.get_class_bundle(uuid,bigint)                 62bd0c41564652e983ccfbcadaafc5a7  ed59fcd4ef9bc85c6e5bcc24c3fdd608
--   public.get_observations(uuid,jsonb,integer,integer)  b3e204a54b8b988061bcd62bb800aa30  184fc8e045969e593ea641901bf2f0c3
--   public.import_json_restore(jsonb,uuid)               2de65ba2bca9babf90d5efb9134190ab  1a201d1ab42337ebb572469c67e8fcfc
--   public.create_observation_follow_up(uuid,text,text,uuid) (new)   9dec66bdc1d9b34809f58746e14e4f10
--   public.update_observation_follow_up(uuid,text,text,uuid) (new)   00e70abda3f41746f89a96969ff33c48
--   fv_private.observation_follow_up_rule() (new)                    20e37bafa4e23be32d1943735c0ee277
--
-- Left alone, and why they need nothing: create_observation and
-- update_observation (no follow-up through them; the rule refuses students
-- on one), delete_observation (the cascade), delete_withdrawn_student (a
-- deleted parent takes its follow-ups), get_term_rating,
-- get_withdrawn_student_records and list_course_student_profiles (through
-- observation_student), every student_submit function (none reads
-- observations).
--
-- ── The checks it makes first ──────────────────────────────────────────────
-- It stops with nothing changed unless each of the three functions is the
-- live definition or this file's (a second run), and the columns, functions
-- and rule are missing or this file's. Read-only from gradebook-prod: the
-- query in migrations/local-test/observation-follow-ups-live-precheck.sql.
--
-- ── Rows ───────────────────────────────────────────────────────────────────
-- None changes: both columns start null on every row, which is "not a
-- follow-up". Nothing is hidden or refused that exists today.
--
-- ── Order ──────────────────────────────────────────────────────────────────
-- After 2026111702. Apply before the app that sends the new calls; the app
-- on teachers' pages now neither sends nor reads them, so it is unchanged.
--
-- Tested on a throwaway PostgreSQL 17 rebuilt equal to live:
-- migrations/local-test/observation_follow_ups.py (README.md, "Observation
-- follow-ups"). Undo: migrations/local-test/observation-follow-ups-undo.sql.
-- After: migrations/local-test/observation-follow-ups-live-postcheck.sql.
--
-- One transaction: all or nothing. Can be run again.

begin;

set local lock_timeout = '5s';

-- ── 1. The checks, before anything changes ─────────────────────────────────
do $guard$
declare
    _f    record;
    _md5  text;
    _cols int := (select count(*) from pg_attribute where attrelid = 'public.observation'::regclass
                    and attname in ('follow_up_of', 'follow_up_kind') and not attisdropped);
begin
    for _f in select * from (values
        ('public.get_class_bundle(uuid,bigint)', '62bd0c41564652e983ccfbcadaafc5a7', 'ed59fcd4ef9bc85c6e5bcc24c3fdd608'),
        ('public.get_observations(uuid,jsonb,integer,integer)', 'b3e204a54b8b988061bcd62bb800aa30', '184fc8e045969e593ea641901bf2f0c3'),
        ('public.import_json_restore(jsonb,uuid)', '2de65ba2bca9babf90d5efb9134190ab', '1a201d1ab42337ebb572469c67e8fcfc'),
        ('public.create_observation_follow_up(uuid,text,text,uuid)', null, '9dec66bdc1d9b34809f58746e14e4f10'),
        ('public.update_observation_follow_up(uuid,text,text,uuid)', null, '00e70abda3f41746f89a96969ff33c48'),
        ('fv_private.observation_follow_up_rule()', null, '20e37bafa4e23be32d1943735c0ee277')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and _md5 is distinct from _f.now then
            raise exception '% is not the definition this file was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing'), coalesce(_f.was, 'none');
        end if;
    end loop;
    if exists (select 1 from pg_proc where proname in ('create_observation_follow_up', 'update_observation_follow_up', 'observation_follow_up_rule')
                 and oid not in (coalesce(to_regprocedure('public.create_observation_follow_up(uuid,text,text,uuid)'), 0),
                                 coalesce(to_regprocedure('public.update_observation_follow_up(uuid,text,text,uuid)'), 0),
                                 coalesce(to_regprocedure('fv_private.observation_follow_up_rule()'), 0))) then
        raise exception 'A follow-up function exists with other arguments or in another schema. Nothing was changed.';
    end if;
    if _cols = 1 or (_cols = 2 and (
           (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.observation'::regclass and attname = 'follow_up_of') <> 'uuid'
        or (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.observation'::regclass and attname = 'follow_up_kind') <> 'text')) then
        raise exception 'public.observation has a follow-up column this file did not make. Nothing was changed.';
    end if;
end
$guard$;

-- ── 2. The columns, their key, check and index ─────────────────────────────
alter table public.observation add column if not exists follow_up_of uuid;
alter table public.observation add column if not exists follow_up_kind text;

do $keys$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.observation'::regclass and conname = 'observation_follow_up_of_fkey') then
        alter table public.observation add constraint observation_follow_up_of_fkey
            foreign key (follow_up_of) references public.observation(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.observation'::regclass and conname = 'observation_follow_up_kind_check') then
        alter table public.observation add constraint observation_follow_up_kind_check
            check (follow_up_kind is null or (follow_up_of is not null and follow_up_kind = any (array['called_home', 'spoke_with_student', 'still_happening', 'resolved'])));
    end if;
end
$keys$;

create index if not exists observation_follow_up_of_idx on public.observation using btree (follow_up_of) where (follow_up_of is not null);

comment on column public.observation.follow_up_of is
    'The observation this one follows up (one level, same class). Null for an observation of its own. A follow-up has no students of its own and is never on a report.';
comment on column public.observation.follow_up_kind is
    'A follow-up''s quick choice: called_home, spoke_with_student, still_happening or resolved (a Concern with a resolved follow-up is closed). Null otherwise.';

-- ── 3. The rule ────────────────────────────────────────────────────────────
create or replace function fv_private.observation_follow_up_rule()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
    _parent record;
begin
    if tg_table_name = 'observation_student' then
        if exists (select 1 from public.observation o where o.id = new.observation_id and o.follow_up_of is not null) then
            raise exception 'A follow-up has no students of its own: it is its observation''s.' using errcode = '23514';
        end if;
        return new;
    end if;
    if tg_op = 'UPDATE' then
        if new.follow_up_of is distinct from old.follow_up_of then
            raise exception 'A follow-up stays under the observation it was made for.' using errcode = '23514';
        end if;
        if new.course_id is distinct from old.course_id
           and (new.follow_up_of is not null or exists (select 1 from public.observation f where f.follow_up_of = new.id)) then
            raise exception 'A follow-up and its observation stay in their class.' using errcode = '23514';
        end if;
        return new;
    end if;
    if new.follow_up_of is null then
        return new;
    end if;
    select o.course_id, o.follow_up_of into _parent from public.observation o where o.id = new.follow_up_of;
    if not found then
        raise exception 'The observation to follow up was not found.' using errcode = '23503';
    end if;
    if _parent.course_id <> new.course_id then
        raise exception 'A follow-up is in its observation''s class.' using errcode = '23514';
    end if;
    if _parent.follow_up_of is not null then
        raise exception 'A follow-up cannot be followed up: add it to the observation.' using errcode = '23514';
    end if;
    return new;
end;
$function$;

revoke all on function fv_private.observation_follow_up_rule() from public, anon, authenticated, service_role;

drop trigger if exists observation_follow_up_rule on public.observation;
create trigger observation_follow_up_rule before insert or update of follow_up_of, course_id on public.observation
    for each row execute function fv_private.observation_follow_up_rule();
drop trigger if exists observation_follow_up_rule on public.observation_student;
create trigger observation_follow_up_rule before insert or update of observation_id on public.observation_student
    for each row execute function fv_private.observation_follow_up_rule();

-- ── 4. The two write functions ─────────────────────────────────────────────
create or replace function public.create_observation_follow_up(p_follow_up_of uuid, p_body text, p_kind text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _id     uuid;
    _cached jsonb;
    _course uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_observation_follow_up');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    if p_kind is not null and p_kind <> all (array['called_home', 'spoke_with_student', 'still_happening', 'resolved']) then
        raise exception 'unknown follow-up kind' using errcode = '22023';
    end if;
    if p_kind is null and nullif(btrim(coalesce(p_body, '')), '') is null then
        raise exception 'a follow-up needs a kind or some words' using errcode = '22023';
    end if;

    -- Row security hides another teacher's observation, so theirs reads as missing.
    select course_id into _course from observation where id = p_follow_up_of;
    if _course is null then raise exception 'observation not found' using errcode = 'P0002'; end if;

    insert into observation (course_id, body, follow_up_of, follow_up_kind)
    values (_course, coalesce(p_body, ''), p_follow_up_of, p_kind)
    returning id into _id;

    perform fv_idem_store(p_idempotency_key, 'create_observation_follow_up', jsonb_build_object('id', _id));
    return _id;
end; $function$;

create or replace function public.update_observation_follow_up(p_id uuid, p_body text, p_kind text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'update_observation_follow_up');
    if _cached is not null then
        return;
    end if;

    if p_kind is not null and p_kind <> all (array['called_home', 'spoke_with_student', 'still_happening', 'resolved']) then
        raise exception 'unknown follow-up kind' using errcode = '22023';
    end if;
    if p_kind is null and nullif(btrim(coalesce(p_body, '')), '') is null then
        raise exception 'a follow-up needs a kind or some words' using errcode = '22023';
    end if;

    update observation set body = coalesce(p_body, ''), follow_up_kind = p_kind, updated_at = now()
     where id = p_id and follow_up_of is not null;
    if not found then raise exception 'follow-up not found' using errcode = 'P0002'; end if;

    perform fv_idem_store(p_idempotency_key, 'update_observation_follow_up', jsonb_build_object('id', p_id));
end; $function$;

revoke all on function public.create_observation_follow_up(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_observation_follow_up(uuid, text, text, uuid) to authenticated, service_role;
revoke all on function public.update_observation_follow_up(uuid, text, text, uuid) from public, anon;
grant execute on function public.update_observation_follow_up(uuid, text, text, uuid) to authenticated, service_role;

-- ── 5. The three readers: the live definition, each change swapped in ──────
do $patch$
declare
    _f    record;
    _s    record;
    _def  text;
    _n    int;
begin
    for _f in select * from (values
        ('public.get_class_bundle(uuid,bigint)', '62bd0c41564652e983ccfbcadaafc5a7', 'ed59fcd4ef9bc85c6e5bcc24c3fdd608'),
        ('public.get_observations(uuid,jsonb,integer,integer)', 'b3e204a54b8b988061bcd62bb800aa30', '184fc8e045969e593ea641901bf2f0c3'),
        ('public.import_json_restore(jsonb,uuid)', '2de65ba2bca9babf90d5efb9134190ab', '1a201d1ab42337ebb572469c67e8fcfc')
    ) as v(fn, was, now) loop
        _def := pg_get_functiondef(to_regprocedure(_f.fn));
        continue when md5(_def) = _f.now;
        for _s in select * from (values
        ('public.get_class_bundle(uuid,bigint)', 1,
         $o$select o.* from public.observation o where o.course_id = p_course_id
         order by o.created_at desc limit 500$o$,
         $n$select o.* from public.observation o where o.course_id = p_course_id and o.follow_up_of is null
         order by o.created_at desc limit 500$n$),
        ('public.get_class_bundle(uuid,bigint)', 1,
         $o$'total', (select count(*) from public.observation o where o.course_id = p_course_id)$o$,
         $n$'total', (select count(*) from public.observation o where o.course_id = p_course_id and o.follow_up_of is null),
        -- Follow-ups of these observations (2026111703): never one of the observations above.
        'follow_ups', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', f.id, 'follow_up_of', f.follow_up_of, 'kind', f.follow_up_kind, 'body', f.body,
                       'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at)
              from public.observation f where f.follow_up_of in (select id from obs)), '[]'::jsonb)$n$),
        ('public.get_observations(uuid,jsonb,integer,integer)', 2,
         $o$where o.course_id = p_course_id
         and (_sent_filter is null$o$,
         $n$where o.course_id = p_course_id
         and o.follow_up_of is null
         and (_sent_filter is null$n$),
        ('public.get_observations(uuid,jsonb,integer,integer)', 1,
         $o$'custom_tags_index', _ctags_index
    );$o$,
         $n$'custom_tags_index', _ctags_index,
      -- Follow-ups of the page's observations (2026111703).
      'follow_ups', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'id', f.id, 'follow_up_of', f.follow_up_of, 'kind', f.follow_up_kind, 'body', f.body,
                  'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at)
           from observation f where f.follow_up_of = any(coalesce(_ids, '{}'::uuid[]))), '[]'::jsonb)
    );$n$),
        ('public.import_json_restore(jsonb,uuid)', 1,
         $o$created_at, dims, level, template_id)$o$,
         $n$created_at, dims, level, template_id, follow_up_of, follow_up_kind)$n$),
        ('public.import_json_restore(jsonb,uuid)', 1,
         $o$where t.id::text = nullif(_row->>'template_id','')))
        on conflict (id) do update set$o$,
         $n$where t.id::text = nullif(_row->>'template_id','')),
                nullif(_row->>'follow_up_of','')::uuid, nullif(_row->>'follow_up_kind',''))
        on conflict (id) do update set$n$),
        ('public.import_json_restore(jsonb,uuid)', 1,
         $o$template_id=excluded.template_id, updated_at=now();$o$,
         $n$template_id=excluded.template_id, follow_up_kind=excluded.follow_up_kind, updated_at=now();$n$)
        ) as s(fn, times, find, put) where s.fn = _f.fn loop
            _n := (length(_def) - length(replace(_def, _s.find, ''))) / length(_s.find);
            if _n <> _s.times then
                raise exception '% holds the text to change % time(s), not %. Nothing was changed.', _f.fn, _n, _s.times;
            end if;
            _def := replace(_def, _s.find, _s.put);
        end loop;
        if md5(_def) <> _f.now then
            raise exception '% would not be the expected definition (md5 %, expected %). Nothing was changed.', _f.fn, md5(_def), _f.now;
        end if;
        execute _def;
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) <> _f.now then
            raise exception '% did not come out as expected. Nothing was changed.', _f.fn;
        end if;
    end loop;
end
$patch$;

-- ── 6. The new functions are this file's ───────────────────────────────────
do $after$
declare
    _f record;
begin
    for _f in select * from (values
        ('public.create_observation_follow_up(uuid,text,text,uuid)', '9dec66bdc1d9b34809f58746e14e4f10'),
        ('public.update_observation_follow_up(uuid,text,text,uuid)', '00e70abda3f41746f89a96969ff33c48'),
        ('fv_private.observation_follow_up_rule()', '20e37bafa4e23be32d1943735c0ee277')
    ) as v(fn, now) loop
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) is distinct from _f.now then
            raise exception '% did not come out as expected (md5 %). Nothing was changed.', _f.fn, md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        end if;
    end loop;
end
$after$;

commit;
