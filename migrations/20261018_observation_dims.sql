-- Observation tags survive a reload (2026-10-18).
--
-- What broke: an observation's tags are its `dims`, string keys the client
-- keeps per observation: disposition codes ('engagement', 'collaboration'),
-- Core Competencies ('cc:<id>') and the teacher's custom tags ('tag:<label>').
-- None of them reached the server. create_observation was sent empty tag
-- arrays, update_observation was sent nulls, and loading a class set every
-- observation's dims to []. So a tag added on the laptop was gone on the
-- phone, and gone on the laptop too as soon as the class reloaded.
--
-- Why a column and not the join tables: observation_tag points at the
-- learning-map `tag` table (curriculum competencies, not dispositions), and
-- custom_tag is the course's tag library. get_class_bundle returns every
-- custom_tag label as the teacher's tag list, so storing 'engagement' or
-- 'cc:3' there would put them in that list. The keys are short strings the
-- client already owns, so they go in observation.dims text[] as they are.
--
-- create_observation takes p_dims text[] (null or left out stores none).
-- update_observation reads 'dims' from p_patch: a JSON array replaces the
-- set, an absent key leaves it alone, so an older client keeps the tags.
-- get_observations and get_class_bundle return 'dims' on each row.
-- bundle_schema stays 3 because older clients ignore the extra field.
--
-- Deploy order: apply this before the client that sends p_dims, or
-- create_observation calls fail to resolve until it is applied.

alter table public.observation add column if not exists dims text[] not null default '{}'::text[];

-- ── create_observation: adds p_dims ──────────────────────────────────────
drop function if exists public.create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[], uuid);
create or replace function public.create_observation(
    p_course_id uuid, p_body text, p_sentiment text default null, p_context_type text default null,
    p_assessment_id uuid default null, p_enrollment_ids uuid[] default '{}'::uuid[],
    p_tag_ids uuid[] default '{}'::uuid[], p_custom_tag_ids uuid[] default '{}'::uuid[],
    p_idempotency_key uuid default null, p_dims text[] default null
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
    _id     uuid;
    _x      uuid;
    _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_observation');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    insert into observation (course_id, body, sentiment, context_type, assessment_id, dims)
    values (p_course_id, p_body, p_sentiment, p_context_type, p_assessment_id,
            array(select d from unnest(p_dims) with ordinality u(d, n) where nullif(d, '') is not null order by n))
    returning id into _id;

    if p_enrollment_ids is not null then
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_observation', jsonb_build_object('id', _id));
    return _id;
end; $function$;

revoke execute on function public.create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[], uuid, text[]) from public, anon;
grant execute on function public.create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[], uuid, text[]) to authenticated;

-- ── update_observation: reads 'dims' from p_patch ────────────────────────
create or replace function public.update_observation(
    p_id uuid, p_patch jsonb, p_enrollment_ids uuid[] default null,
    p_tag_ids uuid[] default null, p_custom_tag_ids uuid[] default null
) returns void
language plpgsql
set search_path to 'public'
as $function$
declare _x uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update observation set
        body          = coalesce(p_patch->>'body', body),
        sentiment     = case when p_patch ? 'sentiment'     then p_patch->>'sentiment'     else sentiment end,
        context_type  = case when p_patch ? 'context_type'  then p_patch->>'context_type'  else context_type end,
        assessment_id = case when p_patch ? 'assessment_id' then nullif(p_patch->>'assessment_id','')::uuid else assessment_id end,
        dims          = case when jsonb_typeof(p_patch->'dims') = 'array'
                             then array(select d from jsonb_array_elements_text(p_patch->'dims') with ordinality u(d, n)
                                         where nullif(d, '') is not null order by n)
                             else dims end,
        updated_at    = now()
    where id = p_id;
    if not found then raise exception 'observation not found' using errcode = 'P0002'; end if;

    if p_enrollment_ids is not null then
        delete from observation_student where observation_id = p_id;
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        delete from observation_tag where observation_id = p_id;
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        delete from observation_custom_tag where observation_id = p_id;
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id) values (p_id, _x) on conflict do nothing;
        end loop;
    end if;
end; $function$;

revoke execute on function public.update_observation(uuid, jsonb, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.update_observation(uuid, jsonb, uuid[], uuid[], uuid[]) to authenticated;

-- ── get_observations as live on 2026-10-18, plus 'dims' on each row ──────
create or replace function public.get_observations(
    p_course_id uuid, p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 50
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
    _filters jsonb := coalesce(p_filters, '{}'::jsonb);
    _page int := greatest(coalesce(p_page, 1), 1);
    _size int := least(greatest(coalesce(p_page_size, 50), 1), 200);
    _offset int := (_page - 1) * _size;
    _total bigint;
    _ids uuid[];
    _rows jsonb;
    _students_index jsonb;
    _tags_index jsonb;
    _ctags_index jsonb;
    _enr_filter uuid[];
    _sent_filter text[];
    _tag_filter uuid[];
    _ctag_filter uuid[];
    _asmt_filter uuid;
    _search text;
    _since timestamptz;
    _until timestamptz;
begin
    -- Unpack filters.
    if _filters ? 'enrollment_id' and nullif(_filters->>'enrollment_id','') is not null then
        _enr_filter := array[(_filters->>'enrollment_id')::uuid];
    end if;
    if _filters ? 'enrollment_ids' and jsonb_typeof(_filters->'enrollment_ids') = 'array' then
        select array_agg((v #>> '{}')::uuid) into _enr_filter
          from jsonb_array_elements(_filters->'enrollment_ids') v;
    end if;

    if _filters ? 'sentiment' and nullif(_filters->>'sentiment','') is not null then
        _sent_filter := array[_filters->>'sentiment'];
    end if;
    if _filters ? 'sentiments' and jsonb_typeof(_filters->'sentiments') = 'array' then
        select array_agg(v #>> '{}') into _sent_filter
          from jsonb_array_elements(_filters->'sentiments') v;
    end if;

    if _filters ? 'tag_ids' and jsonb_typeof(_filters->'tag_ids') = 'array' then
        select array_agg((v #>> '{}')::uuid) into _tag_filter
          from jsonb_array_elements(_filters->'tag_ids') v;
    end if;
    if _filters ? 'custom_tag_ids' and jsonb_typeof(_filters->'custom_tag_ids') = 'array' then
        select array_agg((v #>> '{}')::uuid) into _ctag_filter
          from jsonb_array_elements(_filters->'custom_tag_ids') v;
    end if;

    if _filters ? 'assessment_id' and nullif(_filters->>'assessment_id','') is not null then
        _asmt_filter := (_filters->>'assessment_id')::uuid;
    end if;
    _search := nullif(_filters->>'search', '');
    _since  := nullif(_filters->>'since', '')::timestamptz;
    _until  := nullif(_filters->>'until', '')::timestamptz;

    -- Find matching observation IDs.
    with
    base as (
      select o.id, o.created_at
        from observation o
       where o.course_id = p_course_id
         and (_sent_filter is null or o.sentiment = any(_sent_filter))
         and (_asmt_filter is null or o.assessment_id = _asmt_filter)
         and (_search     is null or o.body ilike '%' || _search || '%')
         and (_since      is null or o.created_at >= _since)
         and (_until      is null or o.created_at <= _until)
    ),
    filtered as (
      select b.id, b.created_at
        from base b
       where (_enr_filter is null or exists (
               select 1 from observation_student os
                where os.observation_id = b.id and os.enrollment_id = any(_enr_filter)))
         and (_tag_filter is null or exists (
               select 1 from observation_tag ot
                where ot.observation_id = b.id and ot.tag_id = any(_tag_filter)))
         and (_ctag_filter is null or exists (
               select 1 from observation_custom_tag oct
                where oct.observation_id = b.id and oct.custom_tag_id = any(_ctag_filter)))
    ),
    paged as (
      select id from filtered
       order by created_at desc
       offset _offset limit _size
    )
    select count(*) from filtered into _total;

    select array_agg(id) into _ids from (
      select id from observation o
       where o.course_id = p_course_id
         and (_sent_filter is null or o.sentiment = any(_sent_filter))
         and (_asmt_filter is null or o.assessment_id = _asmt_filter)
         and (_search     is null or o.body ilike '%' || _search || '%')
         and (_since      is null or o.created_at >= _since)
         and (_until      is null or o.created_at <= _until)
         and (_enr_filter is null or exists (
               select 1 from observation_student os
                where os.observation_id = o.id and os.enrollment_id = any(_enr_filter)))
         and (_tag_filter is null or exists (
               select 1 from observation_tag ot
                where ot.observation_id = o.id and ot.tag_id = any(_tag_filter)))
         and (_ctag_filter is null or exists (
               select 1 from observation_custom_tag oct
                where oct.observation_id = o.id and oct.custom_tag_id = any(_ctag_filter)))
       order by o.created_at desc
       offset _offset limit _size
    ) x;

    -- Hydrate rows.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id, 'body', o.body,
             'sentiment', o.sentiment, 'context_type', o.context_type,
             'assessment_id', o.assessment_id,
             'created_at', o.created_at, 'updated_at', o.updated_at,
             'dims', to_jsonb(coalesce(o.dims, '{}'::text[])),
             'enrollment_ids', coalesce((
                select jsonb_agg(os.enrollment_id)
                  from observation_student os where os.observation_id = o.id
             ), '[]'::jsonb),
             'tag_ids', coalesce((
                select jsonb_agg(ot.tag_id)
                  from observation_tag ot where ot.observation_id = o.id
             ), '[]'::jsonb),
             'custom_tag_ids', coalesce((
                select jsonb_agg(oct.custom_tag_id)
                  from observation_custom_tag oct where oct.observation_id = o.id
             ), '[]'::jsonb)
           ) order by o.created_at desc), '[]'::jsonb)
      into _rows
      from observation o
     where o.id = any(coalesce(_ids, '{}'::uuid[]));

    -- Students index: limited to the enrollments referenced by the page.
    select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
             'first_name', s.first_name,
             'last_name',  s.last_name,
             'preferred_name', s.preferred_name,
             'roster_position', e.roster_position
           )), '{}'::jsonb)
      into _students_index
      from enrollment e
      join student s on s.id = e.student_id
     where e.id in (
       select os.enrollment_id from observation_student os
        where os.observation_id = any(coalesce(_ids, '{}'::uuid[]))
     );

    -- Tags index: all tags referenced by the page.
    select coalesce(jsonb_object_agg(t.id, jsonb_build_object(
             'code', t.code, 'label', t.label, 'section_id', t.section_id
           )), '{}'::jsonb)
      into _tags_index
      from tag t
     where t.id in (
       select ot.tag_id from observation_tag ot
        where ot.observation_id = any(coalesce(_ids, '{}'::uuid[]))
     );

    select coalesce(jsonb_object_agg(ct.id, jsonb_build_object('label', ct.label)), '{}'::jsonb)
      into _ctags_index
      from custom_tag ct
     where ct.id in (
       select oct.custom_tag_id from observation_custom_tag oct
        where oct.observation_id = any(coalesce(_ids, '{}'::uuid[]))
     );

    return jsonb_build_object(
      'observations',  _rows,
      'total',         _total,
      'page',          _page,
      'page_size',     _size,
      'has_more',      _offset + _size < _total,
      'students_index',    _students_index,
      'tags_index',        _tags_index,
      'custom_tags_index', _ctags_index
    );
end; $function$;

revoke execute on function public.get_observations(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.get_observations(uuid, jsonb, integer, integer) to authenticated;

-- ── get_class_bundle as live on 2026-10-18 (20261018_rubric_score_comment.sql
--    plus the rubric copy_group), plus 'dims' on each observation row ───────────────────────────────────────────────
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
                       'tag_ids', coalesce(asm_tags.tag_ids, '[]'::jsonb),
                       'copy_group', asm.copy_group
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
        -- [student, assessment, criterion, value, modifier, comment]
        'criterion_rows', coalesce((
            select jsonb_agg(jsonb_build_array(enr.ix, asm.ix, cr.ix, r.value, r.modifier, r.comment))
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
            select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'created_at', r.created_at,
                                                'copy_group', r.copy_group)
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
                       'dims', to_jsonb(coalesce(obs.dims, '{}'::text[])),
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
