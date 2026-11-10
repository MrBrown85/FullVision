-- The two functions that send a class's assessments to the browser, for
-- bundle_created_at.py. Load after score-tables.sql and before
-- bundle-tables.sql (its policies call fv_owns_term_rating).
--
-- get_class_bundle and get_gradebook are not copied from any one migration:
-- none holds either whole. Each is the migration that last wrote it in full,
-- then every later in-place patch RUN as its migration wrote it, in file
-- order, and printed with pg_get_functiondef:
--   get_class_bundle  20261019_withdraw_students.sql, then the patches in
--                     20261021_tag_i_can_statements, 20261022_advanced_rubric_checks,
--                     20261022_score_modifier, 20261022_soft_remove_competency,
--                     20261022_teacher_sentence_starters,
--                     20261027_assessment_core_competencies, 20261027_score_comments,
--                     20261027_single_point_rubric, 20261028_term_rating_habits_approval,
--                     20261029_category_calc_mode, 20261031_score_report_note,
--                     20261031_term_rating_draft_meta,
--                     20261031_term_rating_reporting_basis,
--                     20261102_folders_count_as_one, 20261102_rubric_print,
--                     20261102_tag_bank_id, 20261103_rubric_whole_competencies.
--                     The result is the live function, byte for byte:
--                     live-function-md5.txt, 119165287207814181c5875d81451147.
--   get_gradebook     20260430_get_gradebook_include_modules.sql, then the
--                     patches in 20261013_proficiency_plus_minus,
--                     20261027_assessment_core_competencies and
--                     20261029_category_calc_mode. live-function-md5.txt says
--                     whether that is the live function.

-- Bodies are stored as written; the tables some of them name come later.
set check_function_bodies = off;

-- 20261012_course_soft_delete.sql, unchanged.
create or replace function public.fv_owns_term_rating(trid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (select 1 from term_rating tr join enrollment e on e.id = tr.enrollment_id
                   join course c on c.id = e.course_id
                   where tr.id = trid and c.teacher_id = (select auth.uid())
                     and c.deleted_at is null);
$function$;
grant execute on function public.fv_owns_term_rating(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_class_bundle(p_course_id uuid, p_if_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    _course public.course%rowtype;
    _version bigint;
    _gradebook jsonb;
    _learning_map jsonb;
    _rubrics jsonb;
    _observations jsonb;
    _profiles jsonb;
    _term_ratings jsonb;
    _report_config jsonb;
    _custom_tags jsonb;
    _observation_templates jsonb;
    _course_config jsonb;
    _withdrawn jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- The only access check: everything below reads by p_course_id.
    select * into _course from public.course
     where id = p_course_id and teacher_id = (select auth.uid()) and deleted_at is null;
    if not found then
        raise exception 'course not found or not owned' using errcode = 'P0002';
    end if;

    select coalesce((select version from public.course_sync_cursor where course_id = p_course_id), 0) into _version;
    if p_if_version is not null and p_if_version = _version then
        return jsonb_build_object('not_modified', true, 'version', _version);
    end if;

    -- ── Gradebook: get_gradebook's roster, assessments, categories and
    --    modules, with scores as compact rows instead of `cells`.
    with
    enr as (
        select e.*, s.first_name, s.last_name, s.preferred_name, s.pronouns,
               s.student_number, s.email, s.date_of_birth,
               (row_number() over (order by e.roster_position, s.last_name, s.first_name, e.id) - 1)::int as ix
          from public.enrollment e join public.student s on s.id = e.student_id
         where e.course_id = p_course_id and e.withdrawn_at is null
    ),
    asm as (
        select a.*, (row_number() over (order by a.display_order, a.created_at, a.id) - 1)::int as ix
          from public.assessment a where a.course_id = p_course_id
    ),
    tg as (
        select t.id, (row_number() over (order by t.id) - 1)::int as ix
          from public.tag t join public.section sec on sec.id = t.section_id
         where sec.course_id = p_course_id
    ),
    cr as (
        select c.id, (row_number() over (order by c.id) - 1)::int as ix
          from public.criterion c join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    ck as (
        select ck.id, (row_number() over (order by ck.id) - 1)::int as ix
          from public.criterion_check ck
          join public.criterion c on c.id = ck.criterion_id
          join public.rubric r on r.id = c.rubric_id
         where r.course_id = p_course_id
    ),
    asm_tags as (
        select at.assessment_id, jsonb_agg(at.tag_id order by t.display_order, t.label) as tag_ids
          from public.assessment_tag at
          join public.tag t on t.id = at.tag_id
          join asm on asm.id = at.assessment_id
         group by at.assessment_id
    )
    select jsonb_build_object(
        'course', to_jsonb(_course),
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'enrollment_id', enr.id, 'student_id', enr.student_id,
                       'first_name', enr.first_name, 'last_name', enr.last_name,
                       'preferred_name', enr.preferred_name, 'pronouns', enr.pronouns,
                       'student_number', enr.student_number, 'email', enr.email,
                       'date_of_birth', enr.date_of_birth, 'designations', enr.designations,
                       'enrolled_at', enr.enrolled_at, 'roster_position', enr.roster_position,
                       'is_flagged', enr.is_flagged
                   ) order by enr.ix)
              from enr), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', asm.id, 'title', asm.title, 'description', asm.description,
                       'category_id', asm.category_id, 'score_mode', asm.score_mode,
                       'max_points', asm.max_points, 'weight', asm.weight,
                       'evidence_type', asm.evidence_type, 'rubric_id', asm.rubric_id,
                       'module_id', asm.module_id, 'collab_mode', asm.collab_mode,
                       'collab_config', asm.collab_config, 'has_rubric', asm.rubric_id is not null,
                       'date_assigned', asm.date_assigned, 'due_date', asm.due_date,
                       'display_order', asm.display_order,
                       'tag_ids', coalesce(asm_tags.tag_ids, '[]'::jsonb),
                       'copy_group', asm.copy_group,
                       'core_competency_ids', to_jsonb(asm.core_competency_ids)
                   ) order by asm.ix)
              from asm left join asm_tags on asm_tags.assessment_id = asm.id), '[]'::jsonb),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                'display_order', c.display_order, 'calc_mode', c.calc_mode) order by c.display_order)
              from public.category c where c.course_id = p_course_id), '[]'::jsonb),
        'modules', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'course_id', m.course_id, 'name', m.name,
                                                'color', m.color, 'display_order', m.display_order,
                                                'created_at', m.created_at, 'updated_at', m.updated_at)
                             order by m.display_order)
              from public.module m where m.course_id = p_course_id), '[]'::jsonb),
        -- Positions in tag_rows and criterion_rows point into these.
        'tag_index', coalesce((select jsonb_agg(tg.id order by tg.ix) from tg), '[]'::jsonb),
        'criterion_index', coalesce((select jsonb_agg(cr.id order by cr.ix) from cr), '[]'::jsonb),
        'check_index', coalesce((select jsonb_agg(ck.id order by ck.ix) from ck), '[]'::jsonb),
        -- [student, assessment, value, status, comment, modifier, report_note]
        'score_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment, s.modifier, s.report_note))
              from public.score s
              join enr on enr.id = s.enrollment_id
              join asm on asm.id = s.assessment_id), '[]'::jsonb),
        -- [student, assessment, tag, value, modifier, comment]
        'tag_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, tg.ix, t.value, t.modifier, t.comment))
              from public.tag_score t
              join enr on enr.id = t.enrollment_id
              join asm on asm.id = t.assessment_id
              join tg on tg.id = t.tag_id), '[]'::jsonb),
        -- [student, assessment, criterion, value, modifier, comment, beyond]
        'criterion_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment, r.beyond))
              from public.rubric_score r
              join enr on enr.id = r.enrollment_id
              join asm on asm.id = r.assessment_id
              join cr on cr.id = r.criterion_id), '[]'::jsonb),
        -- [student, assessment, check]: a ticked checkbox (rubric_check_score)
        'check_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, ck.ix))
              from public.rubric_check_score x
              join enr on enr.id = x.enrollment_id
              join asm on asm.id = x.assessment_id
              join ck on ck.id = x.check_id), '[]'::jsonb),
        -- [student, assessment, printed_at, hash]: a printed rubric (rubric_print)
        'print_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, p.printed_at, p.content_hash))
              from public.rubric_print p
              join enr on enr.id = p.enrollment_id
              join asm on asm.id = p.assessment_id), '[]'::jsonb)
    ) into _gradebook;

    -- ── Learning map: same shape as get_learning_map, without the per-tag
    --    class_avg and coverage_count (the client computes its own).
    with
    sections_with_tags as (
        select s.id as section_id, s.subject_id, s.name, s.display_order, s.competency_group_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'code', t.code, 'label', t.label, 'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text, 'bank_id', t.bank_id,
                   'display_order', t.display_order
               ) order by t.display_order, t.label) filter (where t.id is not null), '[]'::jsonb) as tags
          from public.section s
          left join public.tag t on t.section_id = s.id
         where s.course_id = p_course_id and s.removed_at is null
         group by s.id, s.subject_id, s.name, s.display_order, s.competency_group_id
    ),
    subjects_with_sections as (
        select subj.id, subj.name, subj.display_order,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', sec.section_id, 'name', sec.name, 'display_order', sec.display_order,
                   'competency_group_id', sec.competency_group_id, 'tags', sec.tags
               ) order by sec.display_order, sec.name) filter (where sec.section_id is not null), '[]'::jsonb) as sections
          from public.subject subj
          left join sections_with_tags sec on sec.subject_id = subj.id
         where subj.course_id = p_course_id
         group by subj.id, subj.name, subj.display_order
    )
    select jsonb_build_object(
        'competency_groups', coalesce((
            select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                'display_order', cg.display_order,
                                                'counts_as_one', cg.counts_as_one)
                             order by cg.display_order, cg.name)
              from public.competency_group cg where cg.course_id = p_course_id), '[]'::jsonb),
        'subjects', coalesce((
            select jsonb_agg(jsonb_build_object('id', sws.id, 'name', sws.name,
                                                'display_order', sws.display_order, 'sections', sws.sections)
                             order by sws.display_order, sws.name)
              from subjects_with_sections sws), '[]'::jsonb)
    ) into _learning_map;

    -- ── Rubrics: the rows the client read from three tables.
    select jsonb_build_object(
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'created_at', r.created_at,
                                                'copy_group', r.copy_group, 'style', r.style)
                             order by r.created_at, r.id)
              from public.rubric r where r.course_id = p_course_id), '[]'::jsonb),
        'criteria', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'rubric_id', c.rubric_id, 'name', c.name,
                       'level_4_descriptor', c.level_4_descriptor, 'level_3_descriptor', c.level_3_descriptor,
                       'level_2_descriptor', c.level_2_descriptor, 'level_1_descriptor', c.level_1_descriptor,
                       'level_4_value', c.level_4_value, 'level_3_value', c.level_3_value,
                       'level_2_value', c.level_2_value, 'level_1_value', c.level_1_value,
                       'weight', c.weight, 'display_order', c.display_order
                   ) order by c.display_order, c.id)
              from public.criterion c join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_tags', coalesce((
            select jsonb_agg(jsonb_build_object('criterion_id', ct.criterion_id, 'tag_id', ct.tag_id))
              from public.criterion_tag ct
              join public.criterion c on c.id = ct.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'rubric_tags', coalesce((
            select jsonb_agg(jsonb_build_object('rubric_id', rt.rubric_id, 'tag_id', rt.tag_id))
              from public.rubric_tag rt
              join public.rubric r on r.id = rt.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb),
        'criterion_checks', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', ck.id, 'criterion_id', ck.criterion_id, 'level', ck.level,
                       'label', ck.label, 'display_order', ck.display_order
                   ) order by ck.display_order, ck.id)
              from public.criterion_check ck
              join public.criterion c on c.id = ck.criterion_id
              join public.rubric r on r.id = c.rubric_id
             where r.course_id = p_course_id), '[]'::jsonb)
    ) into _rubrics;

    -- ── Observations: the most recent 500, same row shape as
    --    get_observations, plus the total so the client knows what's older.
    with
    obs as (
        select o.* from public.observation o where o.course_id = p_course_id
         order by o.created_at desc limit 500
    ),
    os as (
        select observation_id, jsonb_agg(enrollment_id) as ids
          from public.observation_student where observation_id in (select id from obs) group by observation_id
    ),
    ot as (
        select observation_id, jsonb_agg(tag_id) as ids
          from public.observation_tag where observation_id in (select id from obs) group by observation_id
    ),
    oct as (
        select observation_id, jsonb_agg(custom_tag_id) as ids
          from public.observation_custom_tag where observation_id in (select id from obs) group by observation_id
    )
    select jsonb_build_object(
        'observations', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', obs.id, 'body', obs.body, 'sentiment', obs.sentiment,
                       'context_type', obs.context_type, 'assessment_id', obs.assessment_id,
                       'created_at', obs.created_at, 'updated_at', obs.updated_at,
                       'dims', to_jsonb(coalesce(obs.dims, '{}'::text[])),
                       'level', obs.level,
                       'enrollment_ids', coalesce(os.ids, '[]'::jsonb),
                       'tag_ids', coalesce(ot.ids, '[]'::jsonb),
                       'custom_tag_ids', coalesce(oct.ids, '[]'::jsonb)
                   ) order by obs.created_at desc)
              from obs
              left join os on os.observation_id = obs.id
              left join ot on ot.observation_id = obs.id
              left join oct on oct.observation_id = obs.id), '[]'::jsonb),
        'total', (select count(*) from public.observation o where o.course_id = p_course_id)
    ) into _observations;

    -- ── Profiles: same row shape as list_course_student_profiles, without the
    --    computed overall_proficiency / letter / counts and override
    --    'calculated', plus the notes it never returned.
    with
    enr as (
        select e.* from public.enrollment e where e.course_id = p_course_id and e.withdrawn_at is null
    ),
    g as (
        select enrollment_id, jsonb_object_agg(section_id::text, body) as v
          from public.goal where enrollment_id in (select id from enr) group by enrollment_id
    ),
    rf as (
        select enrollment_id, jsonb_object_agg(section_id::text, jsonb_build_object(
                   'confidence', confidence, 'text', body, 'date', updated_at)) as v
          from public.reflection where enrollment_id in (select id from enr) group by enrollment_id
    ),
    so as (
        select enrollment_id, jsonb_object_agg(section_id::text, jsonb_build_object(
                   'level', level, 'reason', reason, 'date', updated_at)) as v
          from public.section_override where enrollment_id in (select id from enr) group by enrollment_id
    ),
    nt as (
        select enrollment_id, jsonb_agg(jsonb_build_object('id', id, 'body', body, 'created_at', created_at)
                                        order by created_at) as v
          from public.note where enrollment_id in (select id from enr) group by enrollment_id
    ),
    recent as (
        select x.enrollment_id, jsonb_agg(jsonb_build_object(
                   'id', x.id, 'text', x.body, 'sentiment', x.sentiment, 'context', x.context_type,
                   'created_at', x.created_at, 'observed_at', x.created_at) order by x.created_at desc) as v
          from (
            select os.enrollment_id, o.id, o.body, o.sentiment, o.context_type, o.created_at,
                   row_number() over (partition by os.enrollment_id order by o.created_at desc) as rn
              from public.observation_student os
              join public.observation o on o.id = os.observation_id
             where o.course_id = p_course_id and os.enrollment_id in (select id from enr)
          ) x
         where x.rn <= 3
         group by x.enrollment_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'student', to_jsonb(s.*),
               'enrollment', to_jsonb(enr.*),
               'goals', coalesce(g.v, '{}'::jsonb),
               'reflections', coalesce(rf.v, '{}'::jsonb),
               'section_overrides', coalesce(so.v, '{}'::jsonb),
               'notes', coalesce(nt.v, '[]'::jsonb),
               'is_flagged', enr.is_flagged,
               'recent_observations', coalesce(recent.v, '[]'::jsonb)
           ) order by enr.roster_position, s.last_name, s.first_name), '[]'::jsonb)
      into _profiles
      from enr
      join public.student s on s.id = enr.student_id
      left join g on g.enrollment_id = enr.id
      left join rf on rf.enrollment_id = enr.id
      left join so on so.enrollment_id = enr.id
      left join nt on nt.enrollment_id = enr.id
      left join recent on recent.enrollment_id = enr.id;

    -- ── Term ratings, which the client never read back before.
    with
    tr as (
        select tr.* from public.term_rating tr
          join public.enrollment e on e.id = tr.enrollment_id
         where e.course_id = p_course_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', tr.enrollment_id, 'term', tr.term,
               'narrative_html', tr.narrative_html,
               'work_habits_rating', tr.work_habits_rating,
               'participation_rating', tr.participation_rating,
               'social_traits', to_jsonb(coalesce(tr.social_traits, '{}'::text[])),
               'habits', coalesce(tr.habits, '{}'::jsonb), 'approved_at', tr.approved_at,
               'reporting_basis', tr.reporting_basis, 'ie_deadline', tr.ie_deadline,
               'draft_meta', tr.draft_meta,
               'created_at', tr.created_at, 'updated_at', tr.updated_at,
               'strength_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_strength x
                                           where x.term_rating_id = tr.id), '[]'::jsonb),
               'growth_tags', coalesce((select jsonb_agg(x.tag_id) from public.term_rating_growth_area x
                                         where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_assessments', coalesce((select jsonb_agg(x.assessment_id) from public.term_rating_assessment x
                                                 where x.term_rating_id = tr.id), '[]'::jsonb),
               'mention_observations', coalesce((select jsonb_agg(x.observation_id) from public.term_rating_observation x
                                                  where x.term_rating_id = tr.id), '[]'::jsonb)
           )), '[]'::jsonb)
      into _term_ratings
      from tr;

    select to_jsonb(rc) into _report_config from public.report_config rc where rc.course_id = p_course_id;

    select coalesce(jsonb_agg(ct.label order by ct.label), '[]'::jsonb)
      into _custom_tags
      from public.custom_tag ct where ct.course_id = p_course_id;

    -- The class's sentence starters, in the teacher's order.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ot.id,
               'body', ot.body,
               'default_sentiment', ot.default_sentiment,
               'default_context_type', ot.default_context_type,
               'default_dims', ot.default_dims,
               'display_order', ot.display_order,
               'use_count', (select count(*) from public.observation o where o.template_id = ot.id)
           ) order by ot.display_order, ot.created_at, ot.id), '[]'::jsonb)
      into _observation_templates
      from public.observation_template ot where ot.teacher_id = (select auth.uid());

    -- Withdrawn students, newest first: who they are and when, nothing
    -- else. Their scores and records stay out of the bundle until re-enrol.
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id, 'student_id', e.student_id,
               'first_name', s.first_name, 'last_name', s.last_name,
               'preferred_name', s.preferred_name, 'pronouns', s.pronouns,
               'student_number', s.student_number, 'email', s.email,
               'date_of_birth', s.date_of_birth, 'designations', e.designations,
               'enrolled_at', e.enrolled_at, 'roster_position', e.roster_position,
               'is_flagged', e.is_flagged, 'withdrawn_at', e.withdrawn_at
           ) order by e.withdrawn_at desc, s.last_name, s.first_name, e.id), '[]'::jsonb)
      into _withdrawn
      from public.enrollment e join public.student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is not null;

    -- Null means the class never saved one.
    _course_config := jsonb_build_object(
        'grading_scale', _course.grading_scale,
        'category_weights', _course.category_weights
    );

    return jsonb_build_object(
        'bundle_schema', 3,
        'version', _version,
        'gradebook', _gradebook,
        'learning_map', _learning_map,
        'rubrics', _rubrics,
        'observations', _observations,
        'profiles', _profiles,
        'term_ratings', _term_ratings,
        'report_config', _report_config,
        'custom_tags', _custom_tags,
        'observation_templates', _observation_templates,
        'course_config', _course_config,
        'withdrawn_students', _withdrawn
    );
end;
$function$;
revoke execute on function public.get_class_bundle(uuid, bigint) from public, anon;
grant execute on function public.get_class_bundle(uuid, bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.get_gradebook(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
    course_row course%rowtype;
    students jsonb;
    assessments jsonb;
    categories jsonb;
    modules jsonb;
    cells jsonb;
    summaries jsonb;
begin
    select * into course_row from course where id = p_course_id;
    if not found then raise exception 'course not found or not owned'; end if;

    select jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student_id', s.id,
               'first_name', s.first_name,
               'last_name', s.last_name,
               'preferred_name', s.preferred_name,
               'pronouns', s.pronouns,
               'student_number', s.student_number,
               'email', s.email,
               'date_of_birth', s.date_of_birth,
               'designations', e.designations,
               'enrolled_at', e.enrolled_at,
               'roster_position', e.roster_position,
               'is_flagged', e.is_flagged
           ) order by e.roster_position, s.last_name, s.first_name)
      into students
      from enrollment e join student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is null;

    select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'title', a.title,
               'description', a.description,
               'category_id', a.category_id,
               'score_mode', a.score_mode,
               'max_points', a.max_points,
               'weight', a.weight,
               'evidence_type', a.evidence_type,
               'rubric_id', a.rubric_id,
               'module_id', a.module_id,
               'collab_mode', a.collab_mode,
               'collab_config', a.collab_config,
               'has_rubric', a.rubric_id is not null,
               'date_assigned', a.date_assigned,
               'due_date', a.due_date,
               'display_order', a.display_order,
               'core_competency_ids', to_jsonb(a.core_competency_ids),
               'tag_ids', coalesce((
                   select jsonb_agg(at.tag_id order by t.display_order, t.label)
                     from assessment_tag at
                     join tag t on t.id = at.tag_id
                    where at.assessment_id = a.id
               ), '[]'::jsonb)
           ) order by a.display_order, a.created_at)
      into assessments
      from assessment a where a.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', cat.id, 'name', cat.name,
               'weight', cat.weight, 'display_order', cat.display_order, 'calc_mode', cat.calc_mode
           ) order by cat.display_order)
      into categories
      from category cat where cat.course_id = p_course_id;

    select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'course_id', m.course_id,
               'name', m.name,
               'color', m.color,
               'display_order', m.display_order,
               'created_at', m.created_at,
               'updated_at', m.updated_at
           ) order by m.display_order)
      into modules
      from module m where m.course_id = p_course_id;

    with pairs as (
        select e.id as eid, a.id as aid,
               fv_assessment_overall(e.id, a.id) as ov
          from enrollment e cross join assessment a
         where e.course_id = p_course_id and e.withdrawn_at is null
           and a.course_id = p_course_id
    )
    select jsonb_object_agg(eid, cells_per_student)
      into cells
      from (
        select eid, jsonb_object_agg(
                       aid,
                       jsonb_build_object(
                           'kind', (ov).kind, 'value', (ov).value,
                           'score', (
                               select jsonb_build_object(
                                          'id', sc.id,
                                          'value', sc.value,
                                          'status', sc.status,
                                          'comment', sc.comment,
                                          'scored_at', sc.scored_at,
                                          'updated_at', sc.updated_at
                                      )
                                 from score sc
                                where sc.enrollment_id = p.eid
                                  and sc.assessment_id = p.aid
                           ),
                           'tag_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'tag_id', ts.tag_id,
                                          'value', ts.value, 'modifier', ts.modifier
                                      ) order by ts.tag_id)
                                 from tag_score ts
                                where ts.enrollment_id = p.eid
                                  and ts.assessment_id = p.aid
                           ), '[]'::jsonb),
                           'rubric_scores', coalesce((
                               select jsonb_agg(jsonb_build_object(
                                          'criterion_id', rs.criterion_id,
                                          'value', rs.value, 'modifier', rs.modifier
                                      ) order by rs.criterion_id)
                                 from rubric_score rs
                                where rs.enrollment_id = p.eid
                                  and rs.assessment_id = p.aid
                           ), '[]'::jsonb)
                       )
                   ) as cells_per_student
          from pairs p group by eid
      ) x;

    select jsonb_object_agg(
               e.id,
               jsonb_build_object(
                   'letter', case when course_row.grading_system in ('letter','both')
                       then fv_course_letter_pipeline(e.id, p_course_id) else null end,
                   'overall_proficiency', case when course_row.grading_system in ('proficiency','both')
                       then fv_overall_proficiency(e.id, p_course_id) else null end,
                   'counts', fv_status_counts(e.id, p_course_id)
               )
           )
      into summaries
      from enrollment e
     where e.course_id = p_course_id and e.withdrawn_at is null;

    return jsonb_build_object(
        'course', to_jsonb(course_row),
        'students', coalesce(students, '[]'::jsonb),
        'assessments', coalesce(assessments, '[]'::jsonb),
        'categories', coalesce(categories, '[]'::jsonb),
        'modules', coalesce(modules, '[]'::jsonb),
        'cells', coalesce(cells, '{}'::jsonb),
        'row_summaries', coalesce(summaries, '{}'::jsonb)
    );
end;
$function$;
grant execute on function public.get_gradebook(uuid) to authenticated;

-- STAND-INS, not the live functions: get_gradebook calls the server's old
-- grade calculation for its cells and row summaries. The migration under test
-- does not touch that part, so these only have to exist and answer. They
-- have the live signatures (docs/schema.generated.sql).
do $$ begin
    create type public.score_result as (kind text, value numeric);
exception when duplicate_object then null;
end $$;
create or replace function public.fv_assessment_overall(p_enrollment_id uuid, p_assessment_id uuid)
 returns public.score_result language sql stable set search_path to 'public'
as $function$ select row('not_yet_graded', null::numeric)::public.score_result $function$;
create or replace function public.fv_course_letter_pipeline(p_enrollment_id uuid, p_course_id uuid)
 returns jsonb language sql stable set search_path to 'public'
as $function$ select null::jsonb $function$;
create or replace function public.fv_overall_proficiency(p_enrollment_id uuid, p_course_id uuid)
 returns numeric language sql stable set search_path to 'public'
as $function$ select null::numeric $function$;
create or replace function public.fv_status_counts(p_enrollment_id uuid, p_course_id uuid)
 returns jsonb language sql stable set search_path to 'public'
as $function$ select '{}'::jsonb $function$;
grant execute on function public.fv_assessment_overall(uuid, uuid), public.fv_course_letter_pipeline(uuid, uuid),
    public.fv_overall_proficiency(uuid, uuid), public.fv_status_counts(uuid, uuid) to authenticated;

reset check_function_bodies;
