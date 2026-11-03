-- import_json_restore links only to the teacher's own records (2026-11-03).
--
-- What was wrong (Nov 3 bug sweep, Database changes group 3): an enrollment
-- whose student_id was not among the payload's students fell back to the raw
-- id with no owner check. enrollment's RLS checks only the course, and the
-- foreign key does not check the owner, so a hand-edited restore request with
-- a student id from another teacher's shared backup enrolled that teacher's
-- student in the new class. get_class_bundle joins enrollment to student with
-- no owner filter, so the class then showed the other teacher's live record:
-- name, pronouns, student number, email and birthday, with later changes.
-- Other links have the same gap: RLS on each restored row checks only its own
-- course, enrollment, assessment, rubric, criterion, observation or term
-- rating, not the other ids it names (an assessment's category, rubric and
-- module; a section's subject and folder; the assessment, criterion,
-- competency and checkbox a score names; the competency a goal, reflection or
-- override names; an observation's assessment, students and competencies; a
-- term rating's competencies, assessments and observations).
--
-- Now, once every row is in, the restore checks each of those ids is one of
-- the teacher's own (a student with their teacher id; any other record
-- visible under RLS, which the restore runs under) and refuses the whole
-- restore otherwise, as it would a missing id. The app's own restore sends
-- only ids from the file, re-made fresh, and students it lists, so nothing it
-- sends changes.
--
-- Patched in place with pg_get_functiondef, as 20261103_rubric_whole_
-- competencies.sql did, so the rubric_tags restore it added is kept.

do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.import_json_restore(jsonb, uuid)'::regprocedure);

    _new := replace(_def,
        $s$    _cached jsonb; _result jsonb;$s$,
        $s$    _cached jsonb; _result jsonb;
    _bad text;$s$);
    if _new = _def then raise exception 'import_json_restore: declarations not found'; end if;
    _def := _new;

    _new := replace(_def,
        $s$    -- One cursor bump per restored course, now the rows are in, through the$s$,
        $s$    -- Every other record a restored row names must be the teacher's own:
    -- RLS on each row checks only its own parent. A student is checked by
    -- teacher; any other record by whether RLS shows it. Each id is checked
    -- once: a class's thousands of scores name a few dozen records.
    select l.kind || ' ' || l.id into _bad
      from (
        select distinct v.kind,
               case when v.kind = 'student' then coalesce(_students->>n.id, n.id) else n.id end as id
          from (values
                  ('enrollments', 'student_id', 'student'),
                  ('sections', 'subject_id', 'subject'),
                  ('sections', 'competency_group_id', 'competency_group'),
                  ('assessments', 'category_id', 'category'),
                  ('assessments', 'rubric_id', 'rubric'),
                  ('assessments', 'module_id', 'module'),
                  ('assessment_tags', 'tag_id', 'tag'),
                  ('criterion_tags', 'tag_id', 'tag'),
                  ('rubric_tags', 'tag_id', 'tag'),
                  ('scores', 'assessment_id', 'assessment'),
                  ('rubric_scores', 'assessment_id', 'assessment'),
                  ('rubric_scores', 'criterion_id', 'criterion'),
                  ('tag_scores', 'assessment_id', 'assessment'),
                  ('tag_scores', 'tag_id', 'tag'),
                  ('rubric_check_scores', 'assessment_id', 'assessment'),
                  ('rubric_check_scores', 'check_id', 'criterion_check'),
                  ('goals', 'section_id', 'section'),
                  ('reflections', 'section_id', 'section'),
                  ('section_overrides', 'section_id', 'section'),
                  ('observations', 'assessment_id', 'assessment'),
                  ('observations', 'enrollment_ids', 'enrollment'),
                  ('observations', 'tag_ids', 'tag'),
                  ('term_ratings', 'strength_tag_ids', 'tag'),
                  ('term_ratings', 'growth_tag_ids', 'tag'),
                  ('term_ratings', 'mention_assessment_ids', 'assessment'),
                  ('term_ratings', 'mention_observation_ids', 'observation')
               ) v(arr, field, kind)
         cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(p_payload->v.arr) = 'array' then p_payload->v.arr else '[]'::jsonb end) r
         cross join lateral (
                 select nullif(r->>v.field, '') as id where jsonb_typeof(r->v.field) is distinct from 'array'
                 union all
                 select e from jsonb_array_elements_text(
                     case when jsonb_typeof(r->v.field) = 'array' then r->v.field else '[]'::jsonb end) e
               ) n
      ) l
     where l.id is not null
       and not case l.kind
             when 'student' then exists (select 1 from student x where x.id = l.id::uuid and x.teacher_id = _uid)
             when 'subject' then exists (select 1 from subject x where x.id = l.id::uuid)
             when 'competency_group' then exists (select 1 from competency_group x where x.id = l.id::uuid)
             when 'category' then exists (select 1 from category x where x.id = l.id::uuid)
             when 'rubric' then exists (select 1 from rubric x where x.id = l.id::uuid)
             when 'module' then exists (select 1 from module x where x.id = l.id::uuid)
             when 'tag' then exists (select 1 from tag x where x.id = l.id::uuid)
             when 'assessment' then exists (select 1 from assessment x where x.id = l.id::uuid)
             when 'criterion' then exists (select 1 from criterion x where x.id = l.id::uuid)
             when 'criterion_check' then exists (select 1 from criterion_check x where x.id = l.id::uuid)
             when 'section' then exists (select 1 from section x where x.id = l.id::uuid)
             when 'enrollment' then exists (select 1 from enrollment x where x.id = l.id::uuid)
             when 'observation' then exists (select 1 from observation x where x.id = l.id::uuid)
           end
     limit 1;
    if _bad is not null then
        raise exception 'import_json_restore: % not found', _bad using errcode = 'P0002';
    end if;

    -- One cursor bump per restored course, now the rows are in, through the$s$);
    if _new = _def then raise exception 'import_json_restore: cursor bump not found'; end if;

    execute _new;
end
$patch$;
