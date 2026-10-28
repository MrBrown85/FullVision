-- Single-point rubrics (grader plan PR 14).
--
-- A single-point rubric states only the Proficient standard for each
-- criterion. The teacher picks a level as on any rubric (it feeds grades
-- the same way) and writes two notes per criterion: Work On (kept in the
-- existing rubric_score.comment) and Went Beyond (new rubric_score.beyond).
--
-- 1. rubric.style allows 'single_point'; upsert_rubric accepts it.
-- 2. rubric_score gains beyond text.
-- 3. upsert_rubric_score gains p_beyond, with the comment's rule: null
--    keeps the saved note, '' clears it. A row with no level stays while
--    either note remains (20261027_score_comments). The six-argument
--    version is dropped so PostgREST has one function to call; fill_rubric
--    and older clients call it with fewer arguments and still match.
-- 4. get_class_bundle sends rubric_score.beyond as a seventh criterion
--    tuple element; get_withdrawn_student_records includes it.
--
-- No grade changes: a single-point rubric's level is scored like any
-- rubric's, and existing rubrics keep their style.

begin;

alter table public.rubric drop constraint rubric_style_check;
alter table public.rubric
  add constraint rubric_style_check check (style = any (array['standard', 'advanced', 'single_point']));

alter table public.rubric_score add column if not exists beyond text;

drop function if exists public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text);

create function public.upsert_rubric_score(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_criterion_id uuid,
  p_value integer,
  p_modifier smallint default 0,
  p_comment text default null,
  p_beyond text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
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

revoke all on function public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text) from public, anon;
grant execute on function public.upsert_rubric_score(uuid, uuid, uuid, integer, smallint, text, text)
  to authenticated, service_role;

-- 1 and 4: one exact edit to each live definition. Each must match once,
-- or the migration stops and nothing is changed.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text)',
          'p_style not in (''standard'', ''advanced'')',
          'p_style not in (''standard'', ''advanced'', ''single_point'')'],
    array['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text)',
          'p_style must be standard or advanced',
          'p_style must be standard, advanced or single_point'],
    array['public.get_class_bundle(uuid,bigint)',
          'jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment)',
          'jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond)'],
    array['public.get_class_bundle(uuid,bigint)',
          '-- [student, assessment, criterion, value, modifier, comment]',
          '-- [student, assessment, criterion, value, modifier, comment, beyond]'],
    array['public.get_withdrawn_student_records(uuid)',
          '''comment'', rs.comment)',
          '''comment'', rs.comment, ''beyond'', rs.beyond)']
  ];
  _def text;
  _hits int;
  i int;
begin
  for i in 1 .. array_length(_edits, 1) loop
    _def := pg_get_functiondef(_edits[i][1]::regprocedure);
    _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
    if _hits <> 1 then
      raise exception '% has % matches for "%", expected 1', _edits[i][1], _hits, _edits[i][2];
    end if;
    execute replace(_def, _edits[i][2], _edits[i][3]);
  end loop;
end
$migration$;

commit;
