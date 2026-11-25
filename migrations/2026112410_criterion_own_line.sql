-- A line for one student under a criterion's group comment (2026-11-24). APPLIED Nov 24 2026 on Colin's OK (pre-check no rows; post-check all 21 ok).
-- On pair and group work the teacher grades the group once and the app copies each criterion's level, comment
-- and Went Beyond to every member (shared/data.js _syncGroupFrom). This adds one more note per criterion that
-- belongs to ONE student and is never copied to the group mates ("Hannah only: ..."). It prints on that
-- student's rubric handout and shows on that student's page once the grade is returned, as the comment does.
-- Same shape as 20261027_single_point_rubric.sql, which added rubric_score.beyond.
--
-- == What it adds ==
--   1. public.rubric_score.own_comment text, null on every row. The line for this student alone on pair or
--      group work; never copied to group mates; null when none.
--   2. public.upsert_rubric_score gains p_own_comment (last, default null) with the rule of p_comment and
--      p_beyond: null keeps the saved line, '' clears it. A row with no level stays while its comment, its
--      Went Beyond or its own line remains, and is deleted when all three are gone. The seven-argument
--      version is dropped in the same transaction so PostgREST has one function to call; fill_rubric, older
--      browsers and queued offline writes call it with four to seven arguments and still match.
--   3. public._grade_copy_entry gains p_own (last, default null); the five-argument version is dropped in the
--      same transaction. Whenever p_own is null or blank its answer is byte for byte what it is today (so a
--      returned-grade copy already stored still compares equal to the copy made now). When the entry is a
--      criterion and p_own is not blank, the entry also carries the key "own". An entry with no level, no
--      comment and no Went Beyond but a line of its own is not null: it has "own".
--
-- == What it changes that exists ==
-- Five functions, each patched in place from the live definition behind its md5 (migrations/baseline), the
-- way 20261027 patched get_class_bundle:
--   _grade_copy                     passes r.own_comment to _grade_copy_entry for rubric_score rows (both calls);
--                                   the tag_score calls are unchanged
--   get_class_bundle                criterion_rows gains an eighth element r.own_comment:
--                                   [student, assessment, criterion, value, modifier, comment, beyond, own]
--   get_withdrawn_student_records   each rubric_scores object gains "own"
--   import_json_restore             rubric_scores rows read own_comment on insert and on conflict
--   _assessment_draft_guard         its rubric_score check also counts a non-blank own_comment
-- A copy kept for a student (grade_return.returned_copy, previous_copy, working_copy) is jsonb that
-- _grade_copy_in_use, _grade_copy_remap and fv_private.grade_return_remap pass through whole, so "own" travels
-- with it; none of them is changed. student_submit._returned_grade reads only the session's own enrollment.
-- The edge function student-submit (supabase/functions/student-submit/card-routes.ts gradeCopy) keeps only the
-- keys it names for a criterion (value, modifier, comment, beyond): it must also name "own" before a student
-- can see the line. That is a code change, not part of this file.
--
-- == What it does to existing rows ==
-- Nothing: every existing rubric_score row gets own_comment null. No stored grade copy changes (the new
-- _grade_copy_entry answers as the old one when there is no line). No row of any other table is touched.
--
-- == What applying it accepts ==
-- A browser still on the old app that reads get_class_bundle gets an eighth tuple element it ignores. Until
-- the app is released nothing writes a line. The backup restore (import_json_restore) sets own_comment to
-- null on a row of a backup made before this file, as it does for beyond. After the app writes a line, the
-- full undo drops the column and the lines with it: take a backup first.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the running role owns rubric_score and
-- the functions it changes; every function it relies on or replaces is the one it was tested against (md5 of
-- pg_get_functiondef, public on the search path), or, on a second run, as this file leaves it; rubric_score
-- has the columns live has (or those and own_comment text); and no function of the two replaced names has
-- another signature. Its last step checks everything came out as written.
--
-- == What it does not depend on ==
-- Collation, locale, time zone, search path and the applying role: no text is sorted but under collate "C";
-- the file sets its own search path and each function pins its own; the owner is checked and grants are read
-- from proacl. No backslash and no non-ASCII character is in the file.
--
-- == Locks ==
-- rubric_score for a moment (add column, nullable, no default: no rewrite); it gives up after five seconds
-- with nothing applied if a long transaction holds it: run it again. One transaction.
--
-- == How to apply ==
-- Only on the owner's OK. Tested on a throwaway PostgreSQL 17, ICU en-US and C (local-test/README.md,
-- "A line for one student under a criterion").
--   0. local-test/criterion-own-line-live-fingerprints.sql, read-only. Expected: no rows.
--   1. local-test/criterion-own-line-live-precheck.sql, read-only. Expected: no rows.
--   2. This whole file as one migration named criterion_own_line.
--   3. local-test/criterion-own-line-live-postcheck.sql. Every row ok.
-- Undo: local-test/criterion-own-line-undo.sql. It has no fast stop (the one function is both every rubric
-- save and the line's write); it puts everything back, and refuses while any line is held (its header says
-- what clearing them does to returned grades).
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f    record;
    _md5  text;
    _c    text;
    _me   oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    if (select relowner from pg_class where oid = to_regclass('public.rubric_score')) is distinct from _me then
        raise exception 'Run this as the owner of public.rubric_score (% is not). Nothing was changed.', current_user;
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied
            ('public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb)', 'c19affb3ec09f6782c41139a44208ac8'),
            ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd'),
            ('public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb)', '9c161107ce8c9b37c7f7b785f8359d2d'),
            ('public.fill_rubric(uuid,uuid,integer,smallint)', '59c53fb566c6d47fbf0030586a18113c'),
            ('public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', 'eb9e161daa032f3b272435ec52a0bc7a'),
            ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
            ('fv_private.restore_grade_returns(jsonb)', '66501afe2d758a938cfc8f1d4fc13a92'),
            ('public._grade_return_on_change()', '250d2d680daa2bd3b54cd041285f1696'),
            ('public.fv_owns_rubric_score_cell(uuid,uuid,uuid)', '524e48c2997c6bf4867e3cd7ffa838d2')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- The five patched in place: as live had them, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces
            ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b', 'd6ae115df5d072e442a2a2a686e694f2'),
            ('public.get_class_bundle(uuid,bigint)', '837999a0468728ccdbf75f74ee2ca360', '1bf06bc81bcdae7f51bfdcd594f02311'),
            ('public.get_withdrawn_student_records(uuid)', '218afcff7d47714d89ee45848a30b211', 'c0938a84a84fbff35e983a2138f69414'),
            ('public.import_json_restore(jsonb,uuid)', 'ddc59b55cdc6185e871b9812335853d8', '313b640628406434ac900443f0e91976'),
            ('public._assessment_draft_guard()', 'c18fcd8b805c83a2b75e8ca051792658', '5d9bedb5d58db88a59471b836ce6991c')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- The two that change signature: the old one as live had it, or gone; the new one absent or as written.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN dropped
            ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)', '969a701836ca6c50a92327e66efa0055'),
            ('public._grade_copy_entry(integer,integer,text,text,boolean)', '7d37c111f89850b78f69e4f1676ec255')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new
            ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'dcd964d7880a6391f44de117f0002489'),
            ('public._grade_copy_entry(integer,integer,text,text,boolean,text)', '2826ff58262f52c9ac9103a8ef6138fc')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists and is not as this file leaves it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in ('upsert_rubric_score', '_grade_copy_entry')
                  and p.oid not in (select coalesce(to_regprocedure(s)::oid, 0) from unnest(array[
                      'public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)',
                      'public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)',
                      'public._grade_copy_entry(integer,integer,text,text,boolean)',
                      'public._grade_copy_entry(integer,integer,text,text,boolean,text)']) s)) then
        raise exception 'a function named upsert_rubric_score or _grade_copy_entry with other arguments is there. Nothing was changed.';
    end if;
    select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum) into _c
      from pg_attribute where attrelid = 'public.rubric_score'::regclass and attnum > 0 and not attisdropped;
    if _c not in ('id uuid, enrollment_id uuid, assessment_id uuid, criterion_id uuid, value integer, updated_at timestamp with time zone, modifier smallint, comment text, beyond text',
                  'id uuid, enrollment_id uuid, assessment_id uuid, criterion_id uuid, value integer, updated_at timestamp with time zone, modifier smallint, comment text, beyond text, own_comment text') then
        raise exception 'public.rubric_score is not as 20261027 left it (found %). Nothing was changed.', _c;
    end if;
end
$guard$;

-- == 1. The column ==
alter table public.rubric_score add column if not exists own_comment text;
comment on column public.rubric_score.own_comment is
    'The line for this student alone on pair or group work (2026112410); never copied to group mates; null when none.';

-- == 2. _grade_copy_entry: a sixth argument, the line for this student alone ==
-- The five-argument version goes first so a five-argument call has one function to find. With p_own null or
-- blank every answer is what the old function gave.
drop function if exists public._grade_copy_entry(integer, integer, text, text, boolean);

create or replace function public._grade_copy_entry(p_value integer, p_modifier integer, p_comment text, p_beyond text, p_criterion boolean, p_own text default null::text)
 returns jsonb
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
    select case
        when p_value is null and nullif(btrim(p_comment), '') is null and nullif(btrim(p_beyond), '') is null
             and not (coalesce(p_criterion, false) and nullif(btrim(p_own), '') is not null) then null
        else jsonb_build_object(
                 'value', p_value,
                 'modifier', case when p_value is null then 0 else coalesce(p_modifier, 0) end,
                 'comment', case when nullif(btrim(p_comment), '') is null then null else p_comment end)
             || case when p_criterion
                     then jsonb_build_object('beyond', case when nullif(btrim(p_beyond), '') is null then null else p_beyond end)
                     else '{}'::jsonb end
             || case when coalesce(p_criterion, false) and nullif(btrim(p_own), '') is not null
                     then jsonb_build_object('own', p_own)
                     else '{}'::jsonb end
    end;
$function$;

-- == 3. upsert_rubric_score: p_own_comment, with the rule of p_comment and p_beyond ==
drop function if exists public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text);

create or replace function public.upsert_rubric_score(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_criterion_id uuid,
  p_value integer,
  p_modifier smallint default 0,
  p_comment text default null,
  p_beyond text default null,
  p_own_comment text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _note text; _beyond text; _own text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its notes.
        select comment, beyond, own_comment into _note, _beyond, _own from rubric_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
        if p_comment is not null then _note := nullif(p_comment, ''); end if;
        if p_beyond is not null then _beyond := nullif(p_beyond, ''); end if;
        if p_own_comment is not null then _own := nullif(p_own_comment, ''); end if;
        if _note is null and _beyond is null and _own is null then
            delete from rubric_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
            return null;
        end if;
        insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond, own_comment)
        values (p_enrollment_id, p_assessment_id, p_criterion_id, null, 0, _note, _beyond, _own)
        on conflict (enrollment_id, assessment_id, criterion_id) do update
           set value = null, modifier = 0, comment = _note, beyond = _beyond, own_comment = _own, updated_at = now()
        returning id into _id;
        return _id;
    end if;

    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond, own_comment)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value, coalesce(p_modifier, 0),
            nullif(p_comment, ''), nullif(p_beyond, ''), nullif(p_own_comment, ''))
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value,
           modifier = excluded.modifier,
           comment = case when p_comment is null then rubric_score.comment else nullif(p_comment, '') end,
           beyond = case when p_beyond is null then rubric_score.beyond else nullif(p_beyond, '') end,
           own_comment = case when p_own_comment is null then rubric_score.own_comment else nullif(p_own_comment, '') end,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

-- == 4. Who can run what ==
-- As live has them: the teacher's own session and the service role run upsert_rubric_score; only the service
-- role runs the copy helper.
revoke all on function public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text, text) to authenticated, service_role;
revoke all on function public._grade_copy_entry(integer, integer, text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public._grade_copy_entry(integer, integer, text, text, boolean, text) to service_role;

-- == 5. The five patched in place ==
-- One exact edit to each live definition. Each must match the number of times written, or the migration stops
-- and nothing is changed. A function already as this file leaves it is skipped.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement, times it must be found
    array['public._grade_copy(uuid,uuid)',
          '_grade_copy_entry(r.value, r.modifier, r.comment, r.beyond, true)',
          '_grade_copy_entry(r.value, r.modifier, r.comment, r.beyond, true, r.own_comment)', '2'],
    array['public.get_class_bundle(uuid,bigint)',
          'jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond)',
          'jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond, r.own_comment)', '1'],
    array['public.get_class_bundle(uuid,bigint)',
          '-- [student, assessment, criterion, value, modifier, comment, beyond]',
          '-- [student, assessment, criterion, value, modifier, comment, beyond, own]', '1'],
    array['public.get_withdrawn_student_records(uuid)',
          '''comment'', rs.comment, ''beyond'', rs.beyond)',
          '''comment'', rs.comment, ''beyond'', rs.beyond, ''own'', rs.own_comment)', '1'],
    array['public.import_json_restore(jsonb,uuid)',
          'modifier, comment, beyond)',
          'modifier, comment, beyond, own_comment)', '1'],
    array['public.import_json_restore(jsonb,uuid)',
          'nullif(r->>''comment'',''''), nullif(r->>''beyond'','''')',
          'nullif(r->>''comment'',''''), nullif(r->>''beyond'',''''), nullif(r->>''own_comment'','''')', '1'],
    array['public.import_json_restore(jsonb,uuid)',
          'beyond=excluded.beyond, updated_at=now()',
          'beyond=excluded.beyond, own_comment=excluded.own_comment, updated_at=now()', '1'],
    array['public._assessment_draft_guard()',
          'or nullif(btrim(x.beyond), '''') is not null)',
          'or nullif(btrim(x.beyond), '''') is not null or nullif(btrim(x.own_comment), '''') is not null)', '1']
  ];
  _def text;
  _hits int;
  _have int;
  i int;
  _fn text;
begin
  for i in 1 .. array_length(_edits, 1) loop
    _fn := _edits[i][1];
    _def := pg_get_functiondef(_fn::regprocedure);
    -- How many times the replacement is already there, and the text to find.
    _have := (length(_def) - length(replace(_def, _edits[i][3], ''))) / length(_edits[i][3]);
    if _have = _edits[i][4]::int then
      continue;   -- already as this file leaves it (a second run)
    end if;
    if _have <> 0 then
      raise exception '% has % copies of "%", expected 0 or %', _fn, _have, _edits[i][3], _edits[i][4];
    end if;
    _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
    if _hits <> _edits[i][4]::int then
      raise exception '% has % matches for "%", expected %', _fn, _hits, _edits[i][2], _edits[i][4];
    end if;
    execute replace(_def, _edits[i][2], _edits[i][3]);
  end loop;
end
$migration$;

-- == Everything is as the header says ==
do $final$
declare
    _f    record;
    _md5  text;
    _bad  text[] := '{}';
    _got  text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN after
            ('public._grade_copy(uuid,uuid)', 'd6ae115df5d072e442a2a2a686e694f2'),
            ('public.get_class_bundle(uuid,bigint)', '1bf06bc81bcdae7f51bfdcd594f02311'),
            ('public.get_withdrawn_student_records(uuid)', 'c0938a84a84fbff35e983a2138f69414'),
            ('public.import_json_restore(jsonb,uuid)', '313b640628406434ac900443f0e91976'),
            ('public._assessment_draft_guard()', '5d9bedb5d58db88a59471b836ce6991c'),
            ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'dcd964d7880a6391f44de117f0002489'),
            ('public._grade_copy_entry(integer,integer,text,text,boolean,text)', '2826ff58262f52c9ac9103a8ef6138fc')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.becomes);
        end if;
    end loop;
    if to_regprocedure('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)') is not null
       or to_regprocedure('public._grade_copy_entry(integer,integer,text,text,boolean)') is not null then
        _bad := _bad || 'an old signature is still there'::text;
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('upsert_rubric_score', '_grade_copy_entry')) <> 2 then
        _bad := _bad || 'upsert_rubric_score and _grade_copy_entry do not have one signature each'::text;
    end if;
    if not exists (select 1 from pg_attribute where attrelid = 'public.rubric_score'::regclass and attname = 'own_comment'
                    and atttypid = 'text'::regtype and not attisdropped) then
        _bad := _bad || 'rubric_score.own_comment is not a text column'::text;
    end if;
    -- Grants are read from proacl itself, so default privileges show here.
    for _f in
        select * from (values
            ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'authenticated, service_role'),
            ('public._grade_copy_entry(integer,integer,text,text,boolean,text)', 'service_role')
        ) as v(fn, who)
    loop
        select coalesce(string_agg(w, ', ' order by w collate "C"), '') into _got
          from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as w
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure(_f.fn) and a.grantee <> p.proowner
                   and (a.grantee = 0 or a.grantee::regrole::text <> 'fv_student_submit')) x;
        if _got is distinct from _f.who then
            _bad := _bad || format('grant: %s may be run by "%s", not "%s"', _f.fn, _got, _f.who);
        end if;
    end loop;
    if (select provolatile from pg_proc where oid = to_regprocedure('public._grade_copy_entry(integer,integer,text,text,boolean,text)')) is distinct from 'i' then
        _bad := _bad || '_grade_copy_entry is not immutable'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as tested (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
