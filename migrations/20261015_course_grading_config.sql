-- A class's grading scale and category weights on the server (2026-10-15).
--
-- Both lived only in the browser's per-class course config: update_course
-- never carried them and no read returned them, so a scale or weighting set on
-- one device never reached another. They are now jsonb columns on course,
-- written through update_course and returned by get_class_bundle.
--
--   grading_scale     {boundaries: [{min, proficiency}, ...], labels: [...]}
--   category_weights  {summative: number, formative: number}
--
-- Null means the class has never saved one and the client uses its default.
-- "Reset to defaults" saves the default scale rather than null, so null always
-- means "never saved", and a device holding a value from before this
-- migration can send it up without undoing another device's reset.
--
-- No new trigger: course already has course_sync_cursor_course_gradebook, so
-- an update_course that changes either column bumps the class version and
-- other devices download the class again.
--
-- get_class_bundle returns them in a new course_config section.
-- bundle_schema goes to 3.

alter table public.course add column if not exists grading_scale jsonb;
alter table public.course add column if not exists category_weights jsonb;

alter table public.course drop constraint if exists course_grading_scale_is_object;
alter table public.course add constraint course_grading_scale_is_object
    check (grading_scale is null or jsonb_typeof(grading_scale) = 'object');
alter table public.course drop constraint if exists course_category_weights_is_object;
alter table public.course add constraint course_category_weights_is_object
    check (category_weights is null or jsonb_typeof(category_weights) = 'object');

-- As before, plus the two columns. A JSON null in the patch clears one.
create or replace function public.update_course(p_course_id uuid, p_patch jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update course set
        name             = coalesce(p_patch->>'name',             name),
        grade_level      = coalesce(p_patch->>'grade_level',      grade_level),
        description      = case when p_patch ? 'description'
                                then p_patch->>'description'
                                else description end,
        color            = case when p_patch ? 'color'
                                then p_patch->>'color'
                                else color end,
        grading_system   = coalesce(p_patch->>'grading_system',   grading_system),
        calc_method      = coalesce(p_patch->>'calc_method',      calc_method),
        decay_weight     = case when p_patch ? 'decay_weight'
                                then (p_patch->>'decay_weight')::numeric
                                else decay_weight end,
        timezone         = coalesce(p_patch->>'timezone',         timezone),
        late_work_policy = case when p_patch ? 'late_work_policy'
                                then p_patch->>'late_work_policy'
                                else late_work_policy end,
        grading_scale    = case when p_patch ? 'grading_scale'
                                then nullif(p_patch->'grading_scale', 'null'::jsonb)
                                else grading_scale end,
        category_weights = case when p_patch ? 'category_weights'
                                then nullif(p_patch->'category_weights', 'null'::jsonb)
                                else category_weights end,
        updated_at       = now()
    where id = p_course_id;

    if not found then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
end;
$function$;

-- get_class_bundle as in 20261015_get_class_bundle.sql, plus course_config.
create or replace function public.get_class_bundle(p_course_id uuid, p_if_version bigint default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
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
    _course_config jsonb;
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
                       'tag_ids', coalesce(asm_tags.tag_ids, '[]'::jsonb)
                   ) order by asm.ix)
              from asm left join asm_tags on asm_tags.assessment_id = asm.id), '[]'::jsonb),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                'display_order', c.display_order) order by c.display_order)
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
        -- [student, assessment, value, status, comment]
        'score_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, s.value, s.status, s.comment))
              from public.score s
              join enr on enr.id = s.enrollment_id
              join asm on asm.id = s.assessment_id), '[]'::jsonb),
        -- [student, assessment, tag, value, modifier]
        'tag_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, tg.ix, t.value, t.modifier))
              from public.tag_score t
              join enr on enr.id = t.enrollment_id
              join asm on asm.id = t.assessment_id
              join tg on tg.id = t.tag_id), '[]'::jsonb),
        -- [student, assessment, criterion, value, modifier]
        'criterion_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier))
              from public.rubric_score r
              join enr on enr.id = r.enrollment_id
              join asm on asm.id = r.assessment_id
              join cr on cr.id = r.criterion_id), '[]'::jsonb)
    ) into _gradebook;

    -- ── Learning map: same shape as get_learning_map, without the per-tag
    --    class_avg and coverage_count (the client computes its own).
    with
    sections_with_tags as (
        select s.id as section_id, s.subject_id, s.name, s.display_order, s.competency_group_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'code', t.code, 'label', t.label, 'i_can_text', t.i_can_text,
                   'display_order', t.display_order
               ) order by t.display_order, t.label) filter (where t.id is not null), '[]'::jsonb) as tags
          from public.section s
          left join public.tag t on t.section_id = s.id
         where s.course_id = p_course_id
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
                                                'display_order', cg.display_order)
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
            select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'created_at', r.created_at)
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
        'course_config', _course_config
    );
end;
$function$;

revoke execute on function public.get_class_bundle(uuid, bigint) from public, anon;
grant execute on function public.get_class_bundle(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
