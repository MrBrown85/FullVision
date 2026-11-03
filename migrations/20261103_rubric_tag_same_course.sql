-- rubric_tag: a whole-rubric competency must belong to the rubric's class.
-- 20261103_rubric_whole_competencies.sql only checked that the teacher owns
-- the rubric, so upsert_rubric would link a tag from any other course (the
-- teacher's own, or another teacher's if its uuid was known). The client
-- never finds such a tag in the class, so the link was invisible.
-- Reading rows is unchanged; a write needs the tag in the same course.

drop policy if exists rubric_tag_via_parents on public.rubric_tag;
create policy rubric_tag_via_parents on public.rubric_tag
    using (exists (select 1 from public.rubric r
                    where r.id = rubric_tag.rubric_id and fv_owns_course(r.course_id)))
    with check (exists (select 1
                          from public.rubric r
                          join public.tag t on t.id = rubric_tag.tag_id
                          join public.section s on s.id = t.section_id
                         where r.id = rubric_tag.rubric_id
                           and s.course_id = r.course_id
                           and fv_owns_course(r.course_id)));
