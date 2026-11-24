-- Undo for migrations/2026112410_criterion_own_line.sql (2026-11-24).
--
-- There is no PART 0: nothing short of the full removal can stop a line being written without also stopping
-- every rubric save (the one function does both). The app's own switch is the stop; this file is the removal.
--
-- == What it does ==
-- Puts the five patched functions back word for word (the edits reversed, then checked against the md5 live
-- had), brings back the seven-argument upsert_rubric_score and the five-argument _grade_copy_entry as live had
-- them (same grants), drops the two new ones, and drops the column rubric_score.own_comment. Dropping the
-- column leaves one dropped-column slot on rubric_score.
--
-- == What it refuses ==
-- It stops with nothing changed while any row holds a line (rubric_score.own_comment not null): dropping the
-- column would delete those lines. Back them up, then clear them on purpose:
--     update public.rubric_score set own_comment = null where own_comment is not null;
-- That update is a change to each grade it touches, and the grade-return triggers treat it as one:
--   - in a class that returns grades at once, each touched grade is returned again without the line, and
--     its previous_copy keeps the line;
--   - in a class that holds grades until returned, each touched grade becomes a Draft. A returned_copy that
--     holds "own" never equals the copy made after the line is gone, so the grade stays a Draft until the
--     teacher returns it again (and the student keeps seeing the line until then).
-- The undo itself does not touch any grade copy. It also stops if a function is neither as before nor as
-- the file left it.
-- It locks rubric_score (share row exclusive) before it counts the lines, so no line can be written between
-- the count and the drop; a save waits for it, or it gives up after five seconds with nothing changed.
-- On a database where the file was never applied it changes nothing; a second run changes nothing.

begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

-- Held to the end: no line is written between the count below and the drop.
lock table public.rubric_score in share row exclusive mode;

do $guard$
declare
    _f   record;
    _md5 text;
    _n   int := 0;
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-new
        ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'dcd964d7880a6391f44de117f0002489'),
        ('public._grade_copy_entry(integer,integer,text,text,boolean,text)', '2826ff58262f52c9ac9103a8ef6138fc')
        -- FINGERPRINTS-END
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.now then
            raise exception '% is neither absent nor this file''s definition (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-dropped
        ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)', '969a701836ca6c50a92327e66efa0055'),
        ('public._grade_copy_entry(integer,integer,text,text,boolean)', '7d37c111f89850b78f69e4f1676ec255')
        -- FINGERPRINTS-END
    ) as v(fn, before) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.before then
            raise exception '% is neither absent nor as live had it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-replaced
        ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b', 'd6ae115df5d072e442a2a2a686e694f2'),
        ('public.get_class_bundle(uuid,bigint)', '837999a0468728ccdbf75f74ee2ca360', '1bf06bc81bcdae7f51bfdcd594f02311'),
        ('public.get_withdrawn_student_records(uuid)', '218afcff7d47714d89ee45848a30b211', 'c0938a84a84fbff35e983a2138f69414'),
        ('public.import_json_restore(jsonb,uuid)', 'ddc59b55cdc6185e871b9812335853d8', '313b640628406434ac900443f0e91976'),
        ('public._assessment_draft_guard()', 'c18fcd8b805c83a2b75e8ca051792658', '5d9bedb5d58db88a59471b836ce6991c')
        -- FINGERPRINTS-END
    ) as v(fn, before, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.before and _md5 is distinct from _f.now then
            raise exception '% is neither as before the file nor as the file left it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_attribute where attrelid = 'public.rubric_score'::regclass and attname = 'own_comment' and not attisdropped) then
        execute 'select count(*) from public.rubric_score where own_comment is not null' into _n;
        if _n > 0 then
            raise exception 'public.rubric_score holds % line(s) for one student: dropping the column would delete them. Back them up and clear them first (see the top of this file). Nothing was changed.', _n;
        end if;
    end if;
end
$guard$;

-- The two new signatures go first, so that the five-argument call in _grade_copy has one function to find;
-- then the two as live had them (before the file), then the edits reversed, then the column.
drop function if exists public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text, text);
drop function if exists public._grade_copy_entry(integer, integer, text, text, boolean, text);

-- OLD-DEFINITIONS-BEGIN
CREATE OR REPLACE FUNCTION public.upsert_rubric_score(p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid, p_value integer, p_modifier smallint DEFAULT 0, p_comment text DEFAULT NULL::text, p_beyond text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _id uuid; _note text; _beyond text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its notes.
        select comment, beyond into _note, _beyond from rubric_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
        if p_comment is not null then _note := nullif(p_comment, ''); end if;
        if p_beyond is not null then _beyond := nullif(p_beyond, ''); end if;
        if _note is null and _beyond is null then
            delete from rubric_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
            return null;
        end if;
        insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond)
        values (p_enrollment_id, p_assessment_id, p_criterion_id, null, 0, _note, _beyond)
        on conflict (enrollment_id, assessment_id, criterion_id) do update
           set value = null, modifier = 0, comment = _note, beyond = _beyond, updated_at = now()
        returning id into _id;
        return _id;
    end if;

    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value, coalesce(p_modifier, 0),
            nullif(p_comment, ''), nullif(p_beyond, ''))
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value,
           modifier = excluded.modifier,
           comment = case when p_comment is null then rubric_score.comment else nullif(p_comment, '') end,
           beyond = case when p_beyond is null then rubric_score.beyond else nullif(p_beyond, '') end,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

CREATE OR REPLACE FUNCTION public._grade_copy_entry(p_value integer, p_modifier integer, p_comment text, p_beyond text, p_criterion boolean)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select case
        when p_value is null and nullif(btrim(p_comment), '') is null and nullif(btrim(p_beyond), '') is null then null
        else jsonb_build_object(
                 'value', p_value,
                 'modifier', case when p_value is null then 0 else coalesce(p_modifier, 0) end,
                 'comment', case when nullif(btrim(p_comment), '') is null then null else p_comment end)
             || case when p_criterion
                     then jsonb_build_object('beyond', case when nullif(btrim(p_beyond), '') is null then null else p_beyond end)
                     else '{}'::jsonb end
    end;
$function$;

-- OLD-DEFINITIONS-END

revoke all on function public._grade_copy_entry(integer, integer, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public._grade_copy_entry(integer, integer, text, text, boolean) to service_role;
revoke all on function public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text) from public, anon, authenticated, service_role;
grant execute on function public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text) to authenticated, service_role;

do $migration$
declare
  _edits text[][] := array[
    -- function, text the file wrote, text live had, times
    array['public._grade_copy(uuid,uuid)',
          '_grade_copy_entry(r.value, r.modifier, r.comment, r.beyond, true, r.own_comment)',
          '_grade_copy_entry(r.value, r.modifier, r.comment, r.beyond, true)', '2'],
    array['public.get_class_bundle(uuid,bigint)',
          'jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond, r.own_comment)',
          'jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond)', '1'],
    array['public.get_class_bundle(uuid,bigint)',
          '-- [student, assessment, criterion, value, modifier, comment, beyond, own]',
          '-- [student, assessment, criterion, value, modifier, comment, beyond]', '1'],
    array['public.get_withdrawn_student_records(uuid)',
          '''comment'', rs.comment, ''beyond'', rs.beyond, ''own'', rs.own_comment)',
          '''comment'', rs.comment, ''beyond'', rs.beyond)', '1'],
    array['public.import_json_restore(jsonb,uuid)',
          'modifier, comment, beyond, own_comment)',
          'modifier, comment, beyond)', '1'],
    array['public.import_json_restore(jsonb,uuid)',
          'nullif(r->>''comment'',''''), nullif(r->>''beyond'',''''), nullif(r->>''own_comment'','''')',
          'nullif(r->>''comment'',''''), nullif(r->>''beyond'','''')', '1'],
    array['public.import_json_restore(jsonb,uuid)',
          'beyond=excluded.beyond, own_comment=excluded.own_comment, updated_at=now()',
          'beyond=excluded.beyond, updated_at=now()', '1'],
    array['public._assessment_draft_guard()',
          'or nullif(btrim(x.beyond), '''') is not null or nullif(btrim(x.own_comment), '''') is not null)',
          'or nullif(btrim(x.beyond), '''') is not null)', '1']
  ];
  _def text;
  _hits int;
  i int;
  _fn text;
begin
  for i in 1 .. array_length(_edits, 1) loop
    _fn := _edits[i][1];
    _def := pg_get_functiondef(_fn::regprocedure);
    _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
    if _hits = 0 then
      continue;   -- already as live had it (a second run)
    end if;
    if _hits <> _edits[i][4]::int then
      raise exception '% has % matches for "%", expected %', _fn, _hits, _edits[i][2], _edits[i][4];
    end if;
    execute replace(_def, _edits[i][2], _edits[i][3]);
  end loop;
end
$migration$;

alter table public.rubric_score drop column if exists own_comment;

do $final$
declare
    _f   record;
    _md5 text;
    _bad text[] := '{}';
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-after
        ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b'),
        ('public.get_class_bundle(uuid,bigint)', '837999a0468728ccdbf75f74ee2ca360'),
        ('public.get_withdrawn_student_records(uuid)', '218afcff7d47714d89ee45848a30b211'),
        ('public.import_json_restore(jsonb,uuid)', 'ddc59b55cdc6185e871b9812335853d8'),
        ('public._assessment_draft_guard()', 'c18fcd8b805c83a2b75e8ca051792658'),
        ('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)', '969a701836ca6c50a92327e66efa0055'),
        ('public._grade_copy_entry(integer,integer,text,text,boolean)', '7d37c111f89850b78f69e4f1676ec255')
        -- FINGERPRINTS-END
    ) as v(fn, before) loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before then
            _bad := _bad || format('%s has md5 %s, not %s', _f.fn, _md5, _f.before);
        end if;
    end loop;
    if exists (select 1 from pg_attribute where attrelid = 'public.rubric_score'::regclass and attname = 'own_comment' and not attisdropped)
       or to_regprocedure('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)') is not null
       or to_regprocedure('public._grade_copy_entry(integer,integer,text,text,boolean,text)') is not null then
        _bad := _bad || 'something of the file is still there'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'Not as before the file (% found): %. Nothing was changed.', cardinality(_bad), array_to_string(_bad, '; ');
    end if;
end
$final$;

commit;
