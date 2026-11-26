-- Read-only, after the apply of migrations/2026112602_score_rows_carry_their_class.sql (S0-M6): the class with
-- the most score rows, loaded as its own teacher through get_class_bundle as the app loads it. Returns counts
-- only (no names, no ids). The bundle's rows must equal the class's rows of active students on its pieces.
select set_config('request.jwt.claim.sub',
                  (select c.teacher_id::text from public.course c where c.deleted_at is null
                    order by (select count(*) from public.score s where s.course_id = c.id) desc, c.id limit 1), true);
with c as (
    select c.id from public.course c where c.deleted_at is null
     order by (select count(*) from public.score s where s.course_id = c.id) desc, c.id limit 1
),
b as (select public.get_class_bundle(c.id, null) as v from c)
select jsonb_array_length(b.v->'gradebook'->'score_rows') as bundle_scores,
       (select count(*) from public.score s join c on s.course_id = c.id) as table_scores,
       jsonb_array_length(b.v->'gradebook'->'tag_rows') as bundle_levels,
       (select count(*) from public.tag_score s join c on s.course_id = c.id) as table_levels,
       jsonb_array_length(b.v->'gradebook'->'criterion_rows') as bundle_criteria,
       (select count(*) from public.rubric_score s join c on s.course_id = c.id) as table_criteria,
       jsonb_array_length(b.v->'gradebook'->'check_rows') as bundle_ticks,
       (select count(*) from public.rubric_check_score s join c on s.course_id = c.id) as table_ticks
  from b;
