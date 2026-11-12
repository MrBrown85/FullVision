-- My Learning on a student's device reads as Preview as Student: the class's
-- grade level and the competencies a rubric scores as a whole (2026-11-12).
-- Apply after 2026111170_handouts_links.sql (live since Nov 12); its first
-- check stops it otherwise.
--
-- THIS FILE DELETES NOTHING AND WRITES NO ROW. It replaces one function,
-- student_submit.page, and adds two keys to the `learning` part of its
-- answer. `learning` is sent only while the class has Show My Learning on
-- (Batch E, E9), and no class has it on yet.
--
-- ── What broke, and why ─────────────────────────────────────────────────────
-- The independent review of PR 1264 compared My Learning on a student's own
-- device with Preview as Student, the teacher's view of the same student.
-- tests/my-learning-device-matches-preview.test.js (PR 1268) makes that
-- comparison over a matrix of classes. Two differences come from what page
-- does not send:
--
-- 1. The course % rounded differently. When a teacher never chose Round to
--    Whole Percent (course.round_percent is null), the teacher's app rounds
--    to a whole number in grades 10 to 12, from the class's grade level
--    (shared/calc.js getRoundWholePercent). page never sent the grade level,
--    so a grade 12 student's device showed "B 73.3%" where the teacher and
--    Preview show "B 73%".
--    Now: learning.course.grade_level, the course row's grade_level as it
--    is (text, or null).
--
-- 2. Work on a rubric that scores a competency as a whole (rubric_tag,
--    20261103_rubric_whole_competencies) counted toward no competency. page
--    sends each criterion's competencies (rubrics[].criteria[].tag_ids) but
--    not the whole rubric's, so that work fell out of the skill on the
--    device.
--    Now: learning.rubric_tags, { rubric id: [tag id, ...] }, for each rubric
--    page already lists (one used by work the page shows), with only the
--    competencies still on the class (section not removed), in id order. A
--    rubric with none is left out; a class with none sends {}.
--
-- Both are the class's own settings, the same for every student in it.
-- Nothing of another student, no teacher's note and no descriptor is added.
-- With Show My Learning off, page's answer is the same as before, byte for
-- byte. The review's two other findings needed no database change: the
-- rubric criteria and the reporting terms were already sent, and the device
-- now reads them (PR 1268).
--
-- ── The check it makes first ────────────────────────────────────────────────
-- It stops, with nothing changed, unless Handouts and Links is applied and
-- student_submit.page is the definition 2026111170 left (md5 of
-- pg_get_functiondef on PostgreSQL 17, 8d8e3f9aa91e43b0163cb3189430b758, as that file's own list
-- records it), or, on a second run, as this file leaves it (b460f6f2753ad24317ad2d1f2f4149ce).
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
--   select md5(pg_get_functiondef('student_submit.page(text,uuid,text)'::regprocedure));
-- Before: 8d8e3f9aa91e43b0163cb3189430b758. After: b460f6f2753ad24317ad2d1f2f4149ce.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/my-learning-rest-undo.sql puts page back word for
-- word as 2026111170 made it. It deletes nothing.
--
-- One transaction: all or nothing.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _md5 text := coalesce(md5(pg_get_functiondef(to_regprocedure('student_submit.page(text,uuid,text)'))), 'absent');
begin
    if to_regclass('public.assessment_resource') is null or to_regclass('public.rubric_tag') is null then
        raise exception 'Handouts and Links (2026111170_handouts_links.sql) is not applied: apply it first. Nothing was changed.';
    end if;
    -- md5 of pg_get_functiondef on PostgreSQL 17: page as 2026111170 left it (live), or as this file leaves it (a second run)
    if _md5 <> '8d8e3f9aa91e43b0163cb3189430b758' and _md5 <> 'b460f6f2753ad24317ad2d1f2f4149ce' then
        raise exception 'student_submit.page is not the definition this file was written against (found %, expected 8d8e3f9aa91e43b0163cb3189430b758). Nothing was changed.', _md5;
    end if;
end
$guard$;

-- student_submit.page, as 2026111170 made it, with two keys added to `learning`
-- (only while the class has Show My Learning on): learning.course.grade_level and
-- learning.rubric_tags. Nothing else in it changes.
create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _in      jsonb := _session_class(p_session_token, p_enrollment_id);
    _course  course%rowtype;
    _today   date;
    _weights numeric;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    -- What the class's category weights total: 100, or null with no categories.
    select sum(k.weight) into _weights from category k where k.course_id = _course.id;

    return jsonb_build_object(
        'ok', true, 'v', 1,
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent,
            -- The name the class's teacher signed up with, and nothing else of theirs.
            'teacher_name', (select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code,
                                                                   'i_can', to_jsonb(t.i_can_statements)))
              from tag t join section s on s.id = t.section_id
             where s.course_id = _course.id and s.removed_at is null), '{}'::jsonb),
        'rubrics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'name', r.name, 'style', r.style,
                       'criteria', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'id', cr.id, 'name', cr.name, 'weight', cr.weight,
                                      'level_1_value', cr.level_1_value, 'level_2_value', cr.level_2_value,
                                      'level_3_value', cr.level_3_value, 'level_4_value', cr.level_4_value,
                                      'level_1_descriptor', cr.level_1_descriptor, 'level_2_descriptor', cr.level_2_descriptor,
                                      'level_3_descriptor', cr.level_3_descriptor, 'level_4_descriptor', cr.level_4_descriptor,
                                      -- The competencies this row counts toward, only those still on the class.
                                      'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                             from criterion_tag x
                                                             join tag t on t.id = x.tag_id
                                                             join section s on s.id = t.section_id
                                                            where x.criterion_id = cr.id
                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),
                                      'checks', coalesce((
                                          select jsonb_agg(jsonb_build_object('id', ck.id, 'level', ck.level, 'label', ck.label)
                                                           order by ck.level, ck.display_order, ck.id)
                                            from criterion_check ck where ck.criterion_id = cr.id), '[]'::jsonb))
                                    order by cr.display_order, cr.id)
                             from criterion cr where cr.rubric_id = r.id), '[]'::jsonb)) order by r.id)
              from rubric r
             where r.course_id = _course.id
               and exists (select 1 from assessment a where a.rubric_id = r.id
                              and (a.date_assigned is null or a.date_assigned <= _today))), '[]'::jsonb),
        'assessments', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', a.id, 'title', a.title, 'date', a.date_assigned, 'due_date', a.due_date,
                           'score_mode', a.score_mode, 'max_points', a.max_points, 'weight', a.weight,
                           'rubric_id', a.rubric_id, 'created_at', a.created_at,
                           'tag_ids', coalesce((select jsonb_agg(x.tag_id order by x.tag_id)
                                                  from assessment_tag x
                                                  join tag t on t.id = x.tag_id
                                                  join section s on s.id = t.section_id
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb),
                           'description', nullif(a.description, ''),
                           'module_name', (select m.name from module m where m.id = a.module_id and m.course_id = _course.id),
                           'category_name', k.name,
                           -- What the category counts toward the course grade as the class is set
                           -- up, or null where no percent would be true (the header says when).
                           'category_percent', case when a.score_mode = 'dibels' then null
                                                    when k.weight = 0 then 0
                                                    when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight
                                               end,
                           -- The Ministry's seven, in its order, named as shared/constants.js names them.
                           'core_competencies', coalesce((
                               select jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.ord)
                                 from (values (1, 'COM', 'Communicating'),
                                              (2, 'COL', 'Collaborating'),
                                              (3, 'CT',  'Creative Thinking'),
                                              (4, 'CRT', 'Critical & Reflective Thinking'),
                                              (5, 'PPI', 'Personal & Cultural Identity'),
                                              (6, 'PAR', 'Personal Awareness & Responsibility'),
                                              (7, 'SAR', 'Social Awareness & Responsibility')) as cc(ord, id, name)
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb),
                           -- Handouts and Links (2026111170): what the teacher put on the piece, the
                           -- ready ones only, in the order added
                           'resources', coalesce((
                               select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title,
                                                                   'url', r.url, 'page_count', r.page_count)
                                                order by r.position, r.created_at, r.id)
                                 from assessment_resource r
                                where r.assessment_id = a.id and r.status = 'ready'), '[]'::jsonb))
                       -- E9: the piece's category id, only when Show My Learning is on
                       || case when _course.show_my_learning then jsonb_build_object('category_id', k.id) else '{}'::jsonb end
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
              left join category k on k.id = a.category_id and k.course_id = _course.id
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb))
        -- E9: Show My Learning on: the class's own settings, categories, folders and learning map
        -- (get_class_bundle's shapes; no tag source_text). Off: nothing is added.
        || case when _course.show_my_learning then jsonb_build_object(
               'show_my_learning', true,
               'learning', jsonb_build_object(
                   -- E9: the twelve calculation and grading-style columns of course, and no other
                   'course', jsonb_build_object(
                       'grading_system', _course.grading_system, 'calc_method', _course.calc_method,
                       'decay_weight', _course.decay_weight, 'recent_score_limit', _course.recent_score_limit,
                       'grading_scale', _course.grading_scale, 'category_weights', _course.category_weights,
                       'round_percent', _course.round_percent, 'level_order', _course.level_order,
                       'reporting_terms', _course.reporting_terms, 'timezone', _course.timezone,
                       'folders_count_as_one', _course.folders_count_as_one,
                       'courses_count_equally', _course.courses_count_equally,
                       -- 20261112: the class's grade level, so the device rounds the course % as the
                       -- teacher's app does when Round to Whole Percent was never chosen (grades 10-12)
                       'grade_level', _course.grade_level),
                   -- 20261112: the competencies each rubric scores as a whole (rubric_tag), for the
                   -- rubrics this page lists, only those still on the class; a rubric with none is left out
                   'rubric_tags', coalesce((
                       select jsonb_object_agg(w.rubric_id::text, w.tag_ids)
                         from (select rt.rubric_id, jsonb_agg(rt.tag_id order by rt.tag_id) as tag_ids
                                 from rubric_tag rt
                                 join rubric r on r.id = rt.rubric_id and r.course_id = _course.id
                                 join tag t on t.id = rt.tag_id
                                 join section s on s.id = t.section_id
                                where s.course_id = _course.id and s.removed_at is null
                                  and exists (select 1 from assessment a where a.rubric_id = r.id
                                                 and (a.date_assigned is null or a.date_assigned <= _today))
                                group by rt.rubric_id) w), '{}'::jsonb),
                   -- E9: every category of the class, as the bundle sends them
                   'categories', coalesce((
                       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'weight', c.weight,
                                                           'display_order', c.display_order, 'calc_mode', c.calc_mode)
                                        order by c.display_order, c.id)
                         from category c where c.course_id = _course.id), '[]'::jsonb),
                   -- E9: this student's own hand-set levels, as the bundle sends them, without the teacher's reason
                   'section_overrides', coalesce((
                       select jsonb_object_agg(o.section_id::text, jsonb_build_object('level', o.level, 'date', o.updated_at))
                         from section_override o where o.enrollment_id = p_enrollment_id), '{}'::jsonb),
                   -- E9: the class's folders, as the bundle sends them
                   'competency_groups', coalesce((
                       select jsonb_agg(jsonb_build_object('id', cg.id, 'name', cg.name, 'color', cg.color,
                                                           'display_order', cg.display_order,
                                                           'counts_as_one', cg.counts_as_one)
                                        order by cg.display_order, cg.name)
                         from competency_group cg where cg.course_id = _course.id), '[]'::jsonb),
                   -- E9: the learning map: subjects, their sections not removed, their tags, in the bundle's order
                   'subjects', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'id', subj.id, 'name', subj.name, 'display_order', subj.display_order,
                                  'sections', coalesce((
                                      select jsonb_agg(jsonb_build_object(
                                                 'id', sec.id, 'name', sec.name, 'display_order', sec.display_order,
                                                 'competency_group_id', sec.competency_group_id,
                                                 'tags', coalesce((
                                                     select jsonb_agg(jsonb_build_object(
                                                                'id', t.id, 'code', t.code, 'label', t.label,
                                                                'i_can_text', t.i_can_text,
                                                                'i_can_statements', to_jsonb(t.i_can_statements),
                                                                'bank_id', t.bank_id, 'display_order', t.display_order)
                                                            order by t.display_order, t.label)
                                                       from tag t where t.section_id = sec.id), '[]'::jsonb))
                                             order by sec.display_order, sec.name)
                                        from section sec
                                       where sec.subject_id = subj.id and sec.course_id = _course.id
                                         and sec.removed_at is null), '[]'::jsonb))
                                order by subj.display_order, subj.name)
                         from subject subj where subj.course_id = _course.id), '[]'::jsonb)))
           else '{}'::jsonb end;
end;
$function$;

-- Service role only, as before (create or replace keeps the grants; these lines
-- change nothing where they are as they should be).
revoke all on function student_submit.page(text, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.page(text, uuid, text) to service_role;

commit;
