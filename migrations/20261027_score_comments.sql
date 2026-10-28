-- Feedback on a competency, and a criterion or competency comment saved
-- before a level is picked (grader plan PR 12; decision 6, 2026-10-27).
--
-- What broke: a teacher's feedback under a criterion could not reach the
-- server until a level was chosen (rubric_score.value was NOT NULL), and
-- clearing the level deleted the row and the feedback with it. Competencies
-- (tag_score) had no comment column at all.
--
-- 1. tag_score gains comment; tag_score.value and rubric_score.value may
--    be null. A null value means "no level yet": the row only carries its
--    comment. The value and modifier checks already pass on null.
-- 2. upsert_rubric_score and upsert_tag_score: p_value null or 0 keeps the
--    row as comment-only while a comment remains (the new one, or the saved
--    one when p_comment is null) and deletes it otherwise. p_comment null
--    leaves the saved comment; '' clears it. upsert_tag_score gains
--    p_comment (the old five-argument version is dropped so PostgREST has
--    one function to call).
-- 3. Readers that take a student's most recent tag_score per competency
--    (get_class_dashboard, get_learning_map, get_student_profile) skip
--    comment-only rows, so a comment never displaces a real score.
-- 4. get_class_bundle sends tag_score.comment as a sixth tuple element.
--
-- No grade changes: rows with a value are read exactly as before; the
-- client counts entries with no level as unscored, as it does today.

begin;

alter table public.tag_score add column if not exists comment text;
alter table public.tag_score alter column value drop not null;
alter table public.rubric_score alter column value drop not null;

create or replace function public.upsert_rubric_score(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_criterion_id uuid,
  p_value integer,
  p_modifier smallint default 0,
  p_comment text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _note text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its comment.
        if p_comment is null then
            select comment into _note from rubric_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
        else
            _note := nullif(p_comment, '');
        end if;
        if _note is null then
            delete from rubric_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and criterion_id = p_criterion_id;
            return null;
        end if;
        insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment)
        values (p_enrollment_id, p_assessment_id, p_criterion_id, null, 0, _note)
        on conflict (enrollment_id, assessment_id, criterion_id) do update
           set value = null, modifier = 0, comment = _note, updated_at = now()
        returning id into _id;
        return _id;
    end if;

    insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, modifier, comment)
    values (p_enrollment_id, p_assessment_id, p_criterion_id, p_value, coalesce(p_modifier, 0), nullif(p_comment, ''))
    on conflict (enrollment_id, assessment_id, criterion_id) do update
       set value = excluded.value,
           modifier = excluded.modifier,
           comment = case when p_comment is null then rubric_score.comment else nullif(p_comment, '') end,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

drop function if exists public.upsert_tag_score(uuid, uuid, uuid, integer, smallint);

create function public.upsert_tag_score(
  p_enrollment_id uuid,
  p_assessment_id uuid,
  p_tag_id uuid,
  p_value integer,
  p_modifier smallint default 0,
  p_comment text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _rubric uuid; _mode text; _note text;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    select rubric_id, score_mode into _rubric, _mode from assessment where id = p_assessment_id;
    if _rubric is not null then
        raise exception 'tag_score is not used for rubric assessments' using errcode = '22023';
    end if;

    if _mode in ('points', 'complete') then
        delete from tag_score
         where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        return upsert_score(p_enrollment_id, p_assessment_id, p_value);
    end if;

    if p_value is null or p_value = 0 then
        -- No level: keep the row only for its comment.
        if p_comment is null then
            select comment into _note from tag_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
        else
            _note := nullif(p_comment, '');
        end if;
        if _note is null then
            delete from tag_score
             where enrollment_id = p_enrollment_id and assessment_id = p_assessment_id and tag_id = p_tag_id;
            return null;
        end if;
        insert into tag_score (enrollment_id, assessment_id, tag_id, value, modifier, comment)
        values (p_enrollment_id, p_assessment_id, p_tag_id, null, 0, _note)
        on conflict (enrollment_id, assessment_id, tag_id) do update
           set value = null, modifier = 0, comment = _note, updated_at = now()
        returning id into _id;
        return _id;
    end if;

    insert into tag_score (enrollment_id, assessment_id, tag_id, value, modifier, comment)
    values (p_enrollment_id, p_assessment_id, p_tag_id, p_value, coalesce(p_modifier, 0), nullif(p_comment, ''))
    on conflict (enrollment_id, assessment_id, tag_id) do update
       set value = excluded.value,
           modifier = excluded.modifier,
           comment = case when p_comment is null then tag_score.comment else nullif(p_comment, '') end,
           updated_at = now()
    returning id into _id;
    return _id;
end; $function$;

revoke all on function public.upsert_tag_score(uuid, uuid, uuid, integer, smallint, text) from public, anon;
grant execute on function public.upsert_tag_score(uuid, uuid, uuid, integer, smallint, text) to authenticated, service_role;

-- 3 and 4: one exact edit to each live definition. Each must match once,
-- or the migration stops and nothing is changed.
do $migration$
declare
  _edits text[][] := array[
    -- function, text to find, replacement
    array['public.get_class_dashboard(uuid)',
          'from tag_score ts',
          'from (select * from tag_score where value is not null) ts'],
    array['public.get_learning_map(uuid)',
          'from tag_score ts',
          'from (select * from tag_score where value is not null) ts'],
    array['public.get_student_profile(uuid)',
          'from tag_score ts',
          'from (select * from tag_score where value is not null) ts'],
    array['public.get_class_bundle(uuid,bigint)',
          'jsonb_build_array(enr.ix, asm.ix, tg.ix, t.value, t.modifier)',
          'jsonb_build_array(enr.ix, asm.ix, tg.ix, t.value, t.modifier, t.comment)'],
    array['public.get_class_bundle(uuid,bigint)',
          '-- [student, assessment, tag, value, modifier]',
          '-- [student, assessment, tag, value, modifier, comment]']
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
