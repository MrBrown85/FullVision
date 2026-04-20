-- FullVision v2 — Read-path primitives + RPCs (design artifact)
--
-- Generated 2026-04-19. Applied AFTER schema.sql and rls-policies.sql.
--
-- Scope
-- ─────
-- Translates the pure-function computations in read-paths.md §1 into
-- Postgres functions, and the read surfaces in §2 into RPCs that return
-- jsonb payloads.
--
-- All functions are SECURITY INVOKER so RLS applies to their internal
-- selects — a teacher calling getGradebook(course_id) can only aggregate
-- over their own rows because every underlying select is scoped by RLS.
--
-- Sentinels: the pure functions return numeric or null. To encode the four
-- states (value / EXCLUDED / NOT_YET_GRADED / NOT_APPLICABLE) we use a
-- composite return: (kind text, value numeric). The kind is one of
-- 'value' | 'excluded' | 'not_yet_graded' | 'not_applicable'. Callers pattern-match.
--
-- Performance note: these RPCs prioritize correctness and clarity. If/when
-- a surface gets slow, rewrite the hot one as a set-oriented SQL query
-- that composes scores inline. Do not introduce denormalized caches.

-- ────────────────────────────────────────────────────────────────────────────
-- Composite type for tri-state score results
-- ────────────────────────────────────────────────────────────────────────────

do $$ begin
    create type score_result as (
        kind  text,      -- 'value' | 'excluded' | 'not_yet_graded' | 'not_applicable'
        value numeric    -- meaningful only when kind = 'value'
    );
exception when duplicate_object then null;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.1 Assessment overall score
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_assessment_overall(
    p_enrollment_id uuid,
    p_assessment_id uuid
) returns score_result
language plpgsql
stable
as $$
declare
    a              assessment%rowtype;
    s              score%rowtype;
    weighted_sum   numeric := 0;
    total_weight   numeric := 0;
    cr             record;
begin
    select * into a from assessment where id = p_assessment_id;
    if not found then
        return ('not_yet_graded', null)::score_result;
    end if;

    select * into s from score
     where enrollment_id = p_enrollment_id
       and assessment_id = p_assessment_id;

    -- Status short-circuits
    if found then
        if s.status = 'EXC' then
            return ('excluded', null)::score_result;
        elsif s.status = 'NS' then
            return ('value', 0)::score_result;
        end if;
    end if;

    -- Rubric-based path
    if a.rubric_id is not null then
        for cr in
            select c.weight,
                   case rs.value
                       when 1 then c.level_1_value
                       when 2 then c.level_2_value
                       when 3 then c.level_3_value
                       when 4 then c.level_4_value
                   end as level_value
              from criterion c
              left join rubric_score rs
                     on rs.criterion_id = c.id
                    and rs.enrollment_id = p_enrollment_id
                    and rs.assessment_id = p_assessment_id
             where c.rubric_id = a.rubric_id
        loop
            if cr.level_value is not null then
                weighted_sum := weighted_sum + cr.weight * cr.level_value;
                total_weight := total_weight + cr.weight;
            end if;
        end loop;

        if total_weight = 0 then
            return ('not_yet_graded', null)::score_result;
        end if;
        return ('value', weighted_sum / total_weight)::score_result;
    end if;

    -- Direct-scored path
    if not found or s.value is null then
        return ('not_yet_graded', null)::score_result;
    end if;

    if a.score_mode = 'proficiency' then
        return ('value', s.value)::score_result;
    elsif a.score_mode = 'points' then
        if a.max_points is null or a.max_points = 0 then
            return ('not_yet_graded', null)::score_result;
        end if;
        return ('value', (s.value / a.max_points) * 4)::score_result;
    end if;

    return ('not_yet_graded', null)::score_result;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.2 Tag score for an assessment
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_tag_score_for_assessment(
    p_enrollment_id uuid,
    p_assessment_id uuid,
    p_tag_id        uuid
) returns score_result
language plpgsql
stable
as $$
declare
    a   assessment%rowtype;
    s   score%rowtype;
    vals numeric[];
    v   numeric;
begin
    select * into a from assessment where id = p_assessment_id;
    if not found then
        return ('not_yet_graded', null)::score_result;
    end if;

    select * into s from score
     where enrollment_id = p_enrollment_id
       and assessment_id = p_assessment_id;

    if found then
        if s.status = 'EXC' then
            return ('excluded', null)::score_result;
        elsif s.status = 'NS' then
            return ('value', 0)::score_result;
        end if;
    else
        return ('not_yet_graded', null)::score_result;
    end if;

    if a.rubric_id is not null then
        -- Average the level-values of criteria linking to this tag that have been scored
        select array_agg(
                   case rs.value
                       when 1 then c.level_1_value
                       when 2 then c.level_2_value
                       when 3 then c.level_3_value
                       when 4 then c.level_4_value
                   end
               )
          into vals
          from criterion c
          join criterion_tag ct on ct.criterion_id = c.id and ct.tag_id = p_tag_id
          left join rubric_score rs
                 on rs.criterion_id = c.id
                and rs.enrollment_id = p_enrollment_id
                and rs.assessment_id = p_assessment_id
         where c.rubric_id = a.rubric_id;

        if vals is null or array_length(vals, 1) is null then
            return ('not_applicable', null)::score_result;  -- no criteria link this tag
        end if;

        -- Remove nulls (unscored criteria)
        select avg(x) into v
          from unnest(vals) as x where x is not null;

        if v is null then
            return ('not_yet_graded', null)::score_result;
        end if;
        return ('value', v)::score_result;
    else
        -- Non-rubric: direct TagScore
        select value into v from tag_score
         where enrollment_id = p_enrollment_id
           and assessment_id = p_assessment_id
           and tag_id = p_tag_id;
        if not found then
            return ('not_applicable', null)::score_result;
        end if;
        return ('value', v)::score_result;
    end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.3 Category average
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_category_average(
    p_enrollment_id uuid,
    p_category_id   uuid
) returns numeric
language plpgsql
stable
as $$
declare
    a_id uuid;
    r    score_result;
    acc  numeric[] := '{}';
begin
    for a_id in
        select id from assessment where category_id = p_category_id
    loop
        r := fv_assessment_overall(p_enrollment_id, a_id);
        if r.kind = 'value' then
            acc := acc || r.value;
        end if;
    end loop;

    if array_length(acc, 1) is null then
        return null;
    end if;
    return (select avg(x) from unnest(acc) as x);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.4 helper functions: Q→R and R→letter
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_q_to_percentage(q numeric)
returns numeric
language sql
immutable
as $$
    select case
        when q is null then null
        when q <= 0 then 0
        when q <= 2 then 55 + (q - 1) * 13
        when q <= 3 then 68 + (q - 2) * 14
        else             82 + (q - 3) * 14
    end;
$$;

create or replace function fv_percentage_to_letter(r numeric)
returns text
language sql
immutable
as $$
    select case
        when r is null then null
        when r >= 86 then 'A'
        when r >= 73 then 'B'
        when r >= 67 then 'C+'
        when r >= 60 then 'C'
        when r >= 50 then 'C-'
        else              'F'
    end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.4 Course letter/percentage pipeline (Q → R → S)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_course_letter_pipeline(
    p_enrollment_id uuid,
    p_course_id     uuid
) returns jsonb
language plpgsql
stable
as $$
declare
    cat_count     int;
    q             numeric;
    r             numeric;
    s             text;
    weighted_sum  numeric := 0;
    weight_total  numeric := 0;
    acc           numeric[] := '{}';
    rec           record;
    a_id          uuid;
    ares          score_result;
begin
    select count(*) into cat_count from category where course_id = p_course_id;

    if cat_count = 0 then
        -- Fallback: no categories → equal-weight all assessments
        for a_id in select id from assessment where course_id = p_course_id
        loop
            ares := fv_assessment_overall(p_enrollment_id, a_id);
            if ares.kind = 'value' then
                acc := acc || ares.value;
            end if;
        end loop;
        if array_length(acc, 1) is null then
            return jsonb_build_object('Q', null, 'R', null, 'S', null);
        end if;
        q := (select avg(x) from unnest(acc) as x);
    else
        for rec in select id, weight from category where course_id = p_course_id
        loop
            declare
                avg_v numeric := fv_category_average(p_enrollment_id, rec.id);
            begin
                if avg_v is not null then
                    weighted_sum := weighted_sum + rec.weight * avg_v;
                    weight_total := weight_total + rec.weight;
                end if;
            end;
        end loop;
        if weight_total = 0 then
            return jsonb_build_object('Q', null, 'R', null, 'S', null);
        end if;
        q := weighted_sum / weight_total;
    end if;

    r := fv_q_to_percentage(q);
    s := fv_percentage_to_letter(r);
    return jsonb_build_object('Q', q, 'R', r, 'S', s);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.5 Section proficiency (calc_method dispatch)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_decaying_avg(vals numeric[], dates date[], dw numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
    idx  int[];
    acc  numeric;
    j    int;
    n    int;
begin
    if vals is null or array_length(vals, 1) is null then
        return null;
    end if;
    n := array_length(vals, 1);
    -- Indexed sort: use a fresh loop variable k in the subquery to avoid
    -- ambiguity with plpgsql-declared names (caught by smoke test).
    select array_agg(k order by dates[k] nulls first, k)
      into idx
      from generate_series(1, n) as k;

    acc := vals[idx[1]];
    for j in 2..n loop
        acc := acc * (1 - dw) + vals[idx[j]] * dw;
    end loop;
    return acc;
end;
$$;

create or replace function fv_section_proficiency(
    p_enrollment_id uuid,
    p_section_id    uuid
) returns numeric
language plpgsql
stable
as $$
declare
    course_row    course%rowtype;
    course_id_v   uuid;
    ov            section_override%rowtype;
    contribs_v    numeric[] := '{}';
    contribs_d    date[] := '{}';
    rec           record;
    tag_row       record;
    tres          score_result;
    tag_vals      numeric[];
    mean_v        numeric;
begin
    select s.course_id into course_id_v from section s where s.id = p_section_id;
    if course_id_v is null then
        return null;
    end if;
    select * into course_row from course where id = course_id_v;

    -- Override short-circuits
    select * into ov from section_override
      where enrollment_id = p_enrollment_id and section_id = p_section_id;
    if found and ov.level > 0 then
        return ov.level;
    end if;

    -- Find all assessments covering any tag in this section.
    -- Direct via AssessmentTag, or indirect via Rubric→Criterion→CriterionTag.
    for rec in
        select distinct a.id as assessment_id, a.date_assigned
          from assessment a
         where a.course_id = course_id_v
           and (
                 exists (
                     select 1 from assessment_tag at
                     join tag t on t.id = at.tag_id
                     where at.assessment_id = a.id and t.section_id = p_section_id
                 )
              or (a.rubric_id is not null and exists (
                     select 1 from criterion c
                     join criterion_tag ct on ct.criterion_id = c.id
                     join tag t on t.id = ct.tag_id
                     where c.rubric_id = a.rubric_id and t.section_id = p_section_id
                 ))
               )
    loop
        tag_vals := '{}';
        for tag_row in select id from tag where section_id = p_section_id
        loop
            tres := fv_tag_score_for_assessment(p_enrollment_id, rec.assessment_id, tag_row.id);
            if tres.kind = 'value' then
                tag_vals := tag_vals || tres.value;
            end if;
        end loop;
        if array_length(tag_vals, 1) is not null then
            select avg(x) into mean_v from unnest(tag_vals) as x;
            contribs_v := contribs_v || mean_v;
            contribs_d := contribs_d || rec.date_assigned;
        end if;
    end loop;

    if array_length(contribs_v, 1) is null then
        return null;
    end if;

    return case course_row.calc_method
        when 'average'     then (select avg(x)      from unnest(contribs_v) as x)
        when 'median'      then (select percentile_cont(0.5) within group (order by x)
                                   from unnest(contribs_v) as x)
        when 'highest'     then (select max(x)      from unnest(contribs_v) as x)
        when 'mode'        then (select mode() within group (order by x)
                                   from unnest(contribs_v) as x)
        when 'mostRecent'  then (
            -- Pick the value whose matching date is greatest; null dates
            -- sort to the earliest. Alias the generate_series loop var as
            -- `k` (not `i`) to avoid ambiguity with plpgsql variables.
            select v from (
                select contribs_v[k] as v, contribs_d[k] as d
                  from generate_series(1, array_length(contribs_v, 1)) as k
            ) x order by d desc nulls last limit 1
        )
        when 'decayingAvg' then fv_decaying_avg(contribs_v, contribs_d, coalesce(course_row.decay_weight, 0.65))
    end;
end;
$$;

-- 'mostRecent' note — resolved. The branch above now explicitly selects the
-- value whose date is max; order-of-iteration no longer matters.

-- ────────────────────────────────────────────────────────────────────────────
-- §1.6 Competency-group rollup
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_group_rollup(
    p_enrollment_id uuid,
    p_group_id      uuid
) returns numeric
language sql
stable
as $$
    select avg(v) from (
        select fv_section_proficiency(p_enrollment_id, s.id) as v
          from section s
         where s.competency_group_id = p_group_id
    ) x where v is not null;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.7 Overall proficiency
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_overall_proficiency(
    p_enrollment_id uuid,
    p_course_id     uuid
) returns numeric
language plpgsql
stable
as $$
declare
    grp_count int;
begin
    select count(*) into grp_count from competency_group where course_id = p_course_id;
    if grp_count = 0 then
        return (
            select avg(v) from (
                select fv_section_proficiency(p_enrollment_id, s.id) as v
                  from section s
                 where s.course_id = p_course_id
            ) x where v is not null
        );
    end if;

    return (
        select avg(v) from (
            select fv_group_rollup(p_enrollment_id, g.id) as v
              from competency_group g
             where g.course_id = p_course_id
        ) x where v is not null
    );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §1.8 Status counts
-- ────────────────────────────────────────────────────────────────────────────

create or replace function fv_status_counts(
    p_enrollment_id uuid,
    p_course_id     uuid
) returns jsonb
language plpgsql
stable
as $$
declare
    graded         int := 0;
    ns_cnt         int := 0;
    excused        int := 0;
    late_cnt       int := 0;
    not_yet_graded int := 0;
    a              record;
    s              score%rowtype;
begin
    for a in select id from assessment where course_id = p_course_id
    loop
        select * into s from score
          where enrollment_id = p_enrollment_id and assessment_id = a.id;

        if not found then
            not_yet_graded := not_yet_graded + 1;
        elsif s.status = 'NS' then
            ns_cnt := ns_cnt + 1;
        elsif s.status = 'EXC' then
            excused := excused + 1;
        elsif s.status = 'LATE' then
            late_cnt := late_cnt + 1;
            if s.value is not null then
                graded := graded + 1;
            else
                not_yet_graded := not_yet_graded + 1;
            end if;
        elsif s.value is not null then
            graded := graded + 1;
        else
            not_yet_graded := not_yet_graded + 1;
        end if;
    end loop;

    return jsonb_build_object(
        'graded', graded,
        'ns', ns_cnt,
        'excused', excused,
        'late', late_cnt,
        'not_yet_graded', not_yet_graded
    );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- §2 Read surfaces (example RPCs)
-- ────────────────────────────────────────────────────────────────────────────
-- Implementing all 8 surfaces here would balloon the file. The two most
-- important are drafted below; the rest follow the same pattern: fetch
-- rows with RLS-scoped selects, compose jsonb, return. Skeletons at the
-- bottom mark what each remaining RPC should return.

-- ── Course list (boot-time read for app shell) ────────────────────────────
-- Deployed in migration fullvision_v2_read_path_list_teacher_courses (Phase 3.2).
-- Returns the calling teacher's courses (RLS-scoped on course.teacher_id).
-- Columns returned are the v2 course schema directly — the client maps them
-- to its in-memory blob shape (shared/data.js _canonicalCoursesToBlob).
create or replace function list_teacher_courses()
returns table (
    id             uuid,
    name           text,
    grade_level    text,
    description    text,
    color          text,
    is_archived    boolean,
    display_order  int,
    grading_system text,
    calc_method    text,
    decay_weight   numeric,
    timezone       text,
    late_work_policy text,
    created_at     timestamptz,
    updated_at     timestamptz
)
language sql security invoker stable set search_path = public as $$
    select c.id, c.name, c.grade_level, c.description, c.color,
           c.is_archived, c.display_order, c.grading_system, c.calc_method,
           c.decay_weight, c.timezone, c.late_work_policy,
           c.created_at, c.updated_at
      from course c
     where c.teacher_id = (select auth.uid())
     order by c.is_archived asc, c.display_order asc, c.created_at asc;
$$;
grant execute on function list_teacher_courses() to authenticated;

-- ── §2.1 Gradebook grid ────────────────────────────────────────────────────
create or replace function get_gradebook(p_course_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
    course_row  course%rowtype;
    students    jsonb;
    assessments jsonb;
    cells       jsonb;
    summaries   jsonb;
begin
    select * into course_row from course where id = p_course_id;
    if not found then
        raise exception 'course not found or not owned';
    end if;

    select jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student_id', s.id,
               'first_name', s.first_name,
               'last_name', s.last_name,
               'roster_position', e.roster_position,
               'is_flagged', e.is_flagged
           ) order by e.roster_position)
      into students
      from enrollment e
      join student s on s.id = e.student_id
     where e.course_id = p_course_id and e.withdrawn_at is null;

    select jsonb_agg(jsonb_build_object(
               'id', a.id, 'title', a.title, 'category_id', a.category_id,
               'score_mode', a.score_mode, 'max_points', a.max_points,
               'has_rubric', a.rubric_id is not null,
               'date_assigned', a.date_assigned, 'due_date', a.due_date,
               'display_order', a.display_order
           ) order by a.display_order)
      into assessments
      from assessment a
     where a.course_id = p_course_id;

    -- Cells: nested { enrollment_id -> { assessment_id -> cell } }
    with pairs as (
        select e.id as eid, a.id as aid,
               fv_assessment_overall(e.id, a.id) as ov
          from enrollment e
          cross join assessment a
         where e.course_id = p_course_id
           and e.withdrawn_at is null
           and a.course_id = p_course_id
    )
    select jsonb_object_agg(eid, cells_per_student)
      into cells
      from (
        select eid, jsonb_object_agg(
                       aid,
                       jsonb_build_object(
                           'kind', (ov).kind,
                           'value', (ov).value,
                           'score', (
                               select jsonb_build_object('value', sc.value,
                                                         'status', sc.status,
                                                         'comment', sc.comment)
                                 from score sc
                                where sc.enrollment_id = p.eid
                                  and sc.assessment_id = p.aid
                           )
                       )
                   ) as cells_per_student
          from pairs p
         group by eid
      ) x;

    -- Row summaries: per-student Q/R/S + overall proficiency + counts
    select jsonb_object_agg(
               e.id,
               jsonb_build_object(
                   'letter', case
                       when course_row.grading_system in ('letter','both')
                       then fv_course_letter_pipeline(e.id, p_course_id)
                       else null
                   end,
                   'overall_proficiency', case
                       when course_row.grading_system in ('proficiency','both')
                       then fv_overall_proficiency(e.id, p_course_id)
                       else null
                   end,
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
        'cells', coalesce(cells, '{}'::jsonb),
        'row_summaries', coalesce(summaries, '{}'::jsonb)
    );
end;
$$;

-- ── §2.2 Student profile ───────────────────────────────────────────────────
-- Stub — returns the overall numbers + status counts + notes/goals/reflections.
-- Full competency-tree composition left to the implementation pass.
create or replace function get_student_profile(p_enrollment_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
    enr         enrollment%rowtype;
    stu         student%rowtype;
    course_row  course%rowtype;
begin
    select * into enr from enrollment where id = p_enrollment_id;
    if not found then
        raise exception 'enrollment not found or not owned';
    end if;
    select * into stu from student where id = enr.student_id;
    select * into course_row from course where id = enr.course_id;

    return jsonb_build_object(
        'student', to_jsonb(stu),
        'enrollment', to_jsonb(enr),
        'course', to_jsonb(course_row),
        'overall_proficiency',
            case when course_row.grading_system in ('proficiency','both')
                 then fv_overall_proficiency(p_enrollment_id, enr.course_id)
                 else null end,
        'letter',
            case when course_row.grading_system in ('letter','both')
                 then fv_course_letter_pipeline(p_enrollment_id, enr.course_id)
                 else null end,
        'counts', fv_status_counts(p_enrollment_id, enr.course_id),
        'notes', (
            select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
              from note n where n.enrollment_id = p_enrollment_id
        ),
        'goals', (
            select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
              from goal g where g.enrollment_id = p_enrollment_id
        ),
        'reflections', (
            select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
              from reflection r where r.enrollment_id = p_enrollment_id
        ),
        'competency_tree', null  -- TODO: compose groups→sections→tags with per-node proficiency
    );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Remaining read surfaces — skeletons
-- ────────────────────────────────────────────────────────────────────────────
--
--   §2.3 get_class_dashboard(course_id)
--        - class_avg_Q, class_avg_proficiency
--        - histogram of Qs / proficiencies
--        - per-competency class average
--        - per-assessment class average
--        - at-risk list: students where
--              overall_proficiency < 2.0 OR letter.R < 60
--        - flagged count
--
--   §2.4 get_learning_map(course_id)
--        - full tree: subjects → groups → sections → tags
--        - per-tag: class_avg of most recent tag_score; coverage count
--
--   §2.5 get_term_rating(enrollment_id, term)
--        - term_rating row + all join tables
--        - pickers: sections, tags, assessments, observations
--        - context: overall_proficiency, per-section proficiency, counts
--        - suggested_dim_defaults = round(section_proficiency) per section
--
--   §2.6 get_report(enrollment_id)
--        - iterate blocks_config from report_config
--        - for each enabled block, fetch/compute the block's data
--        - return blocks: [{ type, data }, …]
--
--   §2.7 get_observations(course_id, filters jsonb, page int, page_size int)
--        - JOIN observation + observation_student + observation_tag
--        - apply filters
--        - return observations[], students_index, tags_index
--
--   §2.8 get_assessment_detail(assessment_id)
--        - assessment, rubric + criteria (if any), linked_tags, roster, scores
--
-- Each of these is straightforward SELECT + jsonb composition using the §1
-- primitives already defined above. Implement per-surface as the UI needs them.

-- ────────────────────────────────────────────────────────────────────────────
-- Follow-ups
-- ────────────────────────────────────────────────────────────────────────────
--
--  * Performance: fv_section_proficiency is O(assessments × tags × criteria)
--    per call, and get_gradebook invokes it indirectly per-student. A class
--    with 30 students × 50 assessments × 200 tags is ~300k inner iterations.
--    This is fine in the low-thousands range but warrants benchmarking. If
--    slow, rewrite as a set-oriented query that joins Score/RubricScore/
--    TagScore once per course and composes via window functions.
--
--  * `mostRecent` calc_method now picks by max date (fixed 2026-04-19).
--
--  * Add pg_typeof checks or a small test harness: for a seeded class,
--    assert fv_course_letter_pipeline matches a hand-computed value.


-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5.4 — Read-path completion
-- ─────────────────────────────────────────────────────────────────────────────
-- Deployed in migrations:
--   fullvision_v2_read_path_get_learning_map              (2026-04-20)
--   fullvision_v2_read_path_get_class_dashboard           (2026-04-20)
--   fullvision_v2_read_path_get_term_rating               (2026-04-20)
--   fullvision_v2_read_path_get_observations              (2026-04-20)
--   fullvision_v2_read_path_get_assessment_detail         (2026-04-20)
--   fullvision_v2_read_path_get_report                    (2026-04-20)
--   fullvision_v2_get_student_profile_competency_tree     (2026-04-20)
--
-- get_learning_map(p_course_id)            → full tree + per-tag class_avg + coverage_count
-- get_class_dashboard(p_course_id)         → class_avg, prof histogram, letter histogram,
--                                            per_assessment_avg, per_competency_group_avg,
--                                            at_risk list, flagged_count
-- get_term_rating(p_enrollment_id, p_term) → existing state + course-scoped pickers +
--                                            context numbers + suggested_dim_defaults
-- get_observations(p_course_id, p_filters, p_page, p_page_size) → filtered + paginated
-- get_assessment_detail(p_assessment_id)   → assessment + rubric + criteria + linked tags +
--                                            per-cell state for every active enrollment
-- get_report(p_enrollment_id, p_term?)     → block-by-block report composition per ReportConfig
-- get_student_profile.competency_tree      → backfilled (was stub-null in the original §2.2 RPC)
--
-- Full bodies live on gradebook-prod; see migrations for source.
