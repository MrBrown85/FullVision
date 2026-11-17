-- Undo for migrations/2026111701_assessment_drafts.sql (2026-11-16).
--
-- Puts every function the file replaced back, word for word as live had it
-- on Nov 16, puts create_assessment back to its one old signature, drops
-- the trigger and its function, and drops assessment.is_draft. Every other
-- row is left as it is. A dropped column keeps an empty slot in the table
-- that nothing reads (the catalog shows one dropped-column slot on
-- assessment).
--
-- Release the app's revert FIRST: after this, a create that sends
-- p_is_draft fails (no such function) and becomes a dead letter.
--
-- It STOPS with nothing changed while any assessment is a Draft: dropping
-- the column would put every Draft on its students' pages at once. To go
-- ahead anyway, the teacher assigns them first, or (Colin's call: it shows
-- them to students) run this first, in the same session:
--     update public.assessment set is_draft = false where is_draft;
-- It also stops if a function is neither the file's definition nor the
-- live one (a later change would be lost), and changes nothing on a
-- database where the file was never applied, or a second time.
--
-- Read-only check first: assessment-drafts-live-postcheck.sql (drafts row).
--
-- ── PART 1, the fast stop: one statement, on its own ─────────────────────────
-- If Unassign's check itself misbehaves (it refuses what it should not, or a
-- save waits on it), run only this. Unassign is then no longer checked;
-- everything else, Drafts and what students see included, stays as the
-- file made it. Run the file again to put the check back.
--
--     drop trigger if exists assessment_draft_guard on public.assessment;
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
    _old text := md5(pg_get_functiondef(to_regprocedure('public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid)')));
    _new text := md5(pg_get_functiondef(to_regprocedure('public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)')));
    _n   bigint;
begin
    for _f in select * from (values
        ('student_submit._session_classes(uuid)', '722d403571069e3e97516f432ed9de5c', 'f6751bf9a7803a84067df8efad66f490'),
        ('student_submit._work_window(uuid)', '767795b7835e3c4d6cb628c76df8e6eb', '07e70e0c63675e895b1db9d6b4d8a472'),
        ('student_submit.feedback(text,uuid,text)', '1b90f53ea0d838acae50da7639e8c935', '0c01e9f5d2efee024e1592fb8a42b6d8'),
        ('student_submit.group_work(text,uuid,text)', '1db83448b1b3d7ae998870bdb07c4f36', '6d1a251fdcc1261129e0c1025c977943'),
        ('student_submit.page(text,uuid,text)', 'b460f6f2753ad24317ad2d1f2f4149ce', '0508ea6a4e183bac79c18df4a1135917'),
        ('student_submit.file_links(text,uuid,uuid,text)', '1bd03e7e959fc7ff127bc9602badc283', 'c977ce3010a3c849110c60195caf2f6e'),
        ('student_submit.group_file_links(text,uuid,uuid,text)', '5f15b29dd67898c3339e57e694b42edd', 'f7a4bf32ea97c2d1dd11e28e7d9cf117'),
        ('student_submit.handout_links(text,uuid,uuid,text)', 'bfb7707f3178d02e63317e3eca4c83c5', '822a5ed9b9433f6ef29af3b8e5856070'),
        ('student_submit.markup(text,uuid,uuid,text)', '754e27d5088fd0053bac3edba94c445d', '3f4031af1d0bb67e15e27eaae7c275cf'),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', '9e62c67308321d3dd4095db16e2ad8e1', 'c77950cbe4d79e1f0e73a46d720d9545'),
        ('public.get_class_bundle(uuid,bigint)', '116294a41f043458e3ddec694520cf0d', '62bd0c41564652e983ccfbcadaafc5a7'),
        ('public.get_gradebook(uuid)', 'beec0fae104cd7f4a0e96364130f267d', '08d83934dcacbf14ddfce6ec6cf9068b'),
        ('public.duplicate_assessment(uuid,uuid)', '248a2de149b71e8d99f4fa27a569e7a7', '91fb43611f5a93739c32e2ee8cbcc7d2'),
        ('public.import_json_restore(jsonb,uuid)', '77018c1c88cb9176daee71e2c93d1d9b', '2de65ba2bca9babf90d5efb9134190ab'),
        ('public.import_teams_class(jsonb,uuid)', 'e785413204a6f91827496f9923b845e5', 'f15548a3b9fb9c6b46680fdff5d0a3cd'),
        ('public.update_assessment(uuid,jsonb,uuid[])', '523f9491dc3b689dc3d6473e411e4876', 'c48044d5e0d902e3e5a6fef63cb74049')) v(sig, live, mine)
    loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.sig)));
        if _md5 is null or (_md5 <> _f.live and _md5 <> _f.mine) then
            raise exception '% is neither the file''s definition nor the one before it (found %). Nothing was changed.',
                _f.sig, coalesce(_md5, 'absent');
        end if;
    end loop;
    if not ((_old is null and _new = '2852ea5862f02785711a2d8125b5fadf') or (_old = 'b3f6055028ea0ea1bdcb2f481959d9cf' and _new is null)) then
        raise exception 'create_assessment is not as the file or the database before it had it (old %, new %). Nothing was changed.',
            coalesce(_old, 'absent'), coalesce(_new, 'absent');
    end if;
    if exists (select 1 from pg_attribute where attrelid = 'public.assessment'::regclass and attname = 'is_draft' and not attisdropped) then
        execute 'select count(*) from public.assessment where is_draft' into _n;
        if _n > 0 then
            raise exception '% assessment(s) are Drafts: dropping the column would show them to students. Assign them first. Nothing was changed.', _n;
        end if;
    end if;
end
$guard$;

-- The functions, as they were (they no longer name is_draft, so the column can go).
CREATE OR REPLACE FUNCTION student_submit._session_classes(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student', jsonb_build_object('first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name)),
               'course', jsonb_build_object('name', c.name, 'block', c.block),
               'to_do', (select count(*)
                           from assessment a
                          cross join lateral _returned_grade(e.id, a.id) as g(r)
                          where a.course_id = c.id
                            and (a.date_assigned is null
                                 or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                            and a.score_mode <> 'dibels'
                            and (coalesce(g.r->>'status', '') = 'NS'
                                 or (coalesce(g.r->>'status', '') <> 'EXC' and g.r->>'returned_at' is null)))
               ) order by x.added_at, e.id), '[]'::jsonb)
      from device_session_enrollment x
      join student_card k on k.id = x.card_id
      join enrollment e on e.id = x.enrollment_id
      join student s on s.id = e.student_id
      join course c on c.id = e.course_id
     where x.session_id = p_session_id
       and k.stopped_at is null and e.withdrawn_at is null and c.deleted_at is null and c.student_page_enabled;
$function$;

CREATE OR REPLACE FUNCTION student_submit._work_window(p_assessment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select jsonb_build_object(
               'listed', a.date_assigned is null or a.date_assigned <= d.today,
               'closes_on', case a.after_due when 'until' then a.accept_until when 'stop' then a.due_date end,
               'open', case a.after_due when 'until' then d.today <= a.accept_until
                                        when 'stop' then a.due_date is null or d.today <= a.due_date
                                        else true end,
               'late', a.due_date is not null and d.today > a.due_date)
      from assessment a
      join course c on c.id = a.course_id
     cross join lateral (select (now() at time zone public._fv_timezone(c.timezone))::date as today) d
     where a.id = p_assessment_id;
$function$;

CREATE OR REPLACE FUNCTION student_submit.feedback(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    return jsonb_build_object(
        'ok', true, 'v', 1,
        'reflect_on_feedback', _course.reflect_on_feedback,
        'show_my_learning', _course.show_my_learning,
        'assessments', coalesce((
            select jsonb_agg(x.j order by x.ord1 nulls first, x.ord2, x.ord3, x.id)
              from (select a.id, a.date_assigned as ord1, a.display_order as ord2, a.created_at as ord3,
                           jsonb_build_object(
                               'id', a.id,
                               'marks', mk.j,
                               'revision', rv.j,
                               'reflection', rf.j) as j
                      from assessment a
                      left join score s on s.enrollment_id = p_enrollment_id and s.assessment_id = a.id
                      -- marks given on the student's own pages, and on their group's
                      left join lateral (
                          select case when count(*) = 0 then null else jsonb_build_object(
                                     'pages', count(*),
                                     -- every page of the work: each member's latest handed-in version
                                     'work_pages', (select count(*) from submission_file wf
                                                     where wf.submission_id in (
                                                         select distinct on (ws.enrollment_id) ws.id from submission ws
                                                          where ws.assessment_id = a.id and ws.state = 'sent'
                                                            and ws.enrollment_id = any (coalesce(_group_members(a.id, p_enrollment_id), array[p_enrollment_id]))
                                                          order by ws.enrollment_id, ws.version desc)),
                                     'notes', sum((select count(*) from jsonb_array_elements(coalesce(m.given->'marks', '[]'::jsonb)) k
                                                    where k->>'type' = 'note'))) end as j
                            from markup m
                           where m.assessment_id = a.id and m.given is not null
                             and m.enrollment_id = any (coalesce(_group_members(a.id, p_enrollment_id), array[p_enrollment_id]))
                             -- E5: a group-mate who is Missing or Excused on the piece: their marks are not the group's
                             and (m.enrollment_id = p_enrollment_id
                                  or not exists (select 1 from score gs where gs.enrollment_id = m.enrollment_id
                                                                       and gs.assessment_id = a.id and gs.status in ('NS', 'EXC')))
                             and jsonb_array_length(coalesce(m.given->'marks', '[]'::jsonb)) > 0
                             and a.students_see_markup and coalesce(s.status, '') not in ('NS', 'EXC')
                             and exists (select 1 from submission_file f join submission x on x.id = f.submission_id
                                          where f.id = m.file_id and x.state = 'sent')) mk on true
                      left join lateral (
                          select jsonb_build_object(
                                     'state', st->>'state', 'what_to_fix', r.what_to_fix, 'revise_by', r.revise_by,
                                     'criterion_ids', to_jsonb(r.criterion_ids), 'keep_grade', r.keep_grade,
                                     'grade_hidden', false,
                                     'first_version', r.first_version,
                                     'first_sent_at', (select x.sent_at from submission x where x.id = r.first_submission_id),
                                     -- the first version's grade as the student had it: not while Missing or
                                     -- Excused is on the piece
                                     'first_grade', case when coalesce(s.status, '') in ('NS', 'EXC') then null
                                                         else public._grade_copy_in_use(r.first_grade, a.id) end,
                                     'revision_version', st->'revision_version', 'revision_sent_at', st->'revision_sent_at',
                                     'revision_note', case when st->>'revision_sent_by' = 'student' then st->'revision_note' end,
                                     'revision_late', st->'revision_late',
                                     'asked_at', r.created_at) as j
                            from revision_request r
                           cross join lateral (select public._revision_state(r.id) as st) z
                           where r.assessment_id = a.id and r.enrollment_id = p_enrollment_id and r.state <> 'cancelled'
                           order by r.created_at desc limit 1) rv on true
                      left join lateral (
                          select jsonb_build_object(
                                     'makes_sense', f.makes_sense, 'question', f.question, 'plan', f.plan, 'went_well', f.went_well,
                                     'sent_at', f.sent_at,
                                     -- the teacher's Only Me notes (note, follow_up_note) are never read here
                                     'answer', f.answer, 'answered_at', f.answered_at,
                                     'sense_now', f.sense_now, 'follow_up', f.follow_up,
                                     'follow_up_answer', f.follow_up_answer, 'follow_up_answered_at', f.follow_up_answered_at,
                                     -- What Changed: an answer the page has not shown yet (answer_seen)
                                     'answer_new', (f.answer is not null and f.answer_seen_at is null)
                                                   or (f.follow_up_answer is not null and f.follow_up_answer_seen_at is null)) as j
                            from feedback_reflection f
                           where f.assessment_id = a.id and f.enrollment_id = p_enrollment_id
                             and _course.reflect_on_feedback) rf on true
                     where a.course_id = _course.id
                       and (a.date_assigned is null or a.date_assigned <= _today)
                       and (mk.j is not null or rv.j is not null or rf.j is not null)) x), '[]'::jsonb),
        'last_plan', (select jsonb_build_object('assessment_id', f.assessment_id, 'plan', f.plan, 'sent_at', f.plan_at)
                        from feedback_reflection f
                       where f.enrollment_id = p_enrollment_id and f.course_id = _course.id and f.plan is not null
                         and _course.reflect_on_feedback
                       order by f.plan_at desc, f.id limit 1));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.group_work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _today  date;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;
    return jsonb_build_object('ok', true, 'assessments', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', a.id,
                   'members', cardinality(m.ids),
                   'sent', w.subs > 0,
                   'pages', w.pages,
                   'you_sent', w.mine > 0,
                   'first_sent_at', w.first_at)
                 order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
          from assessment a
         cross join lateral (select _group_members(a.id, p_enrollment_id) as ids) m
         cross join lateral (
             select count(distinct s.id) as subs, count(f.id) as pages,
                    count(distinct s.id) filter (where s.enrollment_id = p_enrollment_id) as mine,
                    min(s.sent_at) as first_at
               from submission s left join submission_file f on f.submission_id = s.id
              where s.assessment_id = a.id and s.state = 'sent' and s.enrollment_id = any (m.ids)) w
         where a.course_id = _course.id and m.ids is not null
           and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION student_submit.file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'files', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', f.id, 'submission_id', s.id, 'version', s.version, 'page', f.page,
                       'path', f.path, 'thumb_path', f.thumb_path,
                       'width', f.width, 'height', f.height, 'rotation', f.rotation)
                     order by s.version, f.page, f.id)
              from submission s
              join submission_file f on f.submission_id = s.id
             where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id
               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'
               -- E4: a piece dated in the future is not on the student's page: no link for its pages
               and exists (select 1 from assessment a join course c on c.id = a.course_id
                             where a.id = p_assessment_id
                               and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.group_file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'files', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'file_id', f.id, 'submission_id', s.id, 'version', s.version, 'page', f.page,
                       'path', f.path, 'thumb_path', f.thumb_path,
                       'width', f.width, 'height', f.height, 'rotation', f.rotation,
                       'mine', s.enrollment_id = p_enrollment_id)
                     order by s.sent_at, s.id, f.page, f.id)
              from submission s
              join submission_file f on f.submission_id = s.id
             where s.assessment_id = p_assessment_id and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'
               and s.enrollment_id = any (coalesce(_group_members(p_assessment_id, p_enrollment_id), array[p_enrollment_id]))
               -- E4: a piece dated in the future is not on the student's page: no link for its pages
               and exists (select 1 from assessment a join course c on c.id = a.course_id
                             where a.id = p_assessment_id
                               and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.handout_links(p_session_token text, p_enrollment_id uuid, p_resource_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in jsonb := _session_class(p_session_token, p_enrollment_id);
    _r  assessment_resource%rowtype;
begin
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select r.* into _r
      from assessment_resource r
      join assessment a on a.id = r.assessment_id
      join course c on c.id = a.course_id
     where r.id = p_resource_id and r.kind = 'pdf' and r.status = 'ready'
       and r.course_id = (_in->>'course_id')::uuid and a.course_id = r.course_id
       and (a.date_assigned is null
            or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object(
        'ok', true, 'bucket', public._work_bucket(),
        'resource_id', _r.id, 'assessment_id', _r.assessment_id, 'title', _r.title, 'page_count', _r.page_count,
        'pages', (select jsonb_agg(jsonb_build_object('page', n, 'path', public._handout_path(_r.course_id, _r.id, n)) order by n)
                    from generate_series(1, _r.page_count) n));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.markup(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _a      assessment%rowtype;
    _course course%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    -- E4: a piece dated in the future is not on the student's page: nothing of it is served
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date);
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _a.students_see_markup
       or exists (select 1 from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = _a.id and s.status in ('NS', 'EXC')) then
        return jsonb_build_object('ok', true, 'files', '[]'::jsonb);
    end if;
    return jsonb_build_object('ok', true, 'files', coalesce((
        select jsonb_agg(jsonb_build_object('file_id', m.file_id, 'marks', m.given, 'given_at', m.given_at) order by m.file_id)
          from markup m
          join submission_file f on f.id = m.file_id
          join submission x on x.id = f.submission_id and x.state = 'sent'
         where m.assessment_id = _a.id and m.given is not null
           and m.enrollment_id = any (coalesce(_group_members(_a.id, p_enrollment_id), array[p_enrollment_id]))
           -- E5: a group-mate who is Missing or Excused on the piece: their marks are not the group's
           and (m.enrollment_id = p_enrollment_id
                or not exists (select 1 from score s where s.enrollment_id = m.enrollment_id and s.assessment_id = _a.id
                                                       and s.status in ('NS', 'EXC')))), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.reflect(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_reflection jsonb, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _no    jsonb;
    _in     jsonb;
    _course course%rowtype;
    _a      assessment%rowtype;
    _k      text;
    _sense  text;
    _q      text;
    _plan   text;
    _well   text;
    _f      feedback_reflection%rowtype;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if p_reflection is null or jsonb_typeof(p_reflection) <> 'object' then
        raise exception 'the reflection must be an object' using errcode = '22023';
    end if;
    for _k in select jsonb_object_keys(p_reflection) loop
        if _k not in ('makes_sense', 'question', 'plan', 'went_well') then
            raise exception 'unknown field %', _k using errcode = '22023';
        end if;
        if _k <> 'makes_sense' and jsonb_typeof(p_reflection->_k) not in ('string', 'null') then
            raise exception '% must be text', _k using errcode = '22023';
        end if;
    end loop;
    _sense := p_reflection->>'makes_sense';
    if _sense is null or _sense not in ('yes', 'not_sure') or jsonb_typeof(p_reflection->'makes_sense') <> 'string' then
        raise exception 'makes_sense must be yes or not_sure' using errcode = '22023';
    end if;
    _q := nullif(btrim(p_reflection->>'question'), '');
    _plan := nullif(btrim(p_reflection->>'plan'), '');
    _well := nullif(btrim(p_reflection->>'went_well'), '');
    if char_length(_q) > 1000 or char_length(_plan) > 1000 or char_length(_well) > 1000 then
        raise exception 'each answer is 1000 characters at most' using errcode = '22023';
    end if;
    if _sense = 'not_sure' and _q is null then
        raise exception 'not_sure needs a question' using errcode = '22023';
    end if;
    if _sense = 'yes' and _plan is null then
        raise exception 'yes needs a plan' using errcode = '22023';
    end if;

    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    -- E6: thirty reflections and replies an hour for a card, counted before the class's lock is taken
    _no := student_submit._write_limit((_in->>'card_id')::uuid, 'reflect', 30);
    if _no is not null then
        return _no;
    end if;
    perform public._grade_return_lock_first((_in->>'course_id')::uuid);
    select * into _course from course where id = (_in->>'course_id')::uuid;
    if not exists (select 1 from enrollment e where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not _course.reflect_on_feedback then
        return jsonb_build_object('ok', false, 'error', 'reflect_off');
    end if;
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date);
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not exists (select 1 from grade_return g
                    where g.enrollment_id = p_enrollment_id and g.assessment_id = _a.id and g.returned_at is not null) then
        return jsonb_build_object('ok', false, 'error', 'not_returned');
    end if;
    select * into _f from feedback_reflection where assessment_id = _a.id and enrollment_id = p_enrollment_id for update;
    if found and _f.answer is not null then
        return jsonb_build_object('ok', false, 'error', 'already_answered');
    end if;
    insert into feedback_reflection (course_id, assessment_id, enrollment_id, makes_sense, question, plan, plan_at, went_well)
    values (_course.id, _a.id, p_enrollment_id, _sense, _q, _plan, case when _plan is not null then now() end, _well)
    on conflict (assessment_id, enrollment_id) do update
       set makes_sense = excluded.makes_sense, question = excluded.question, plan = excluded.plan, went_well = excluded.went_well,
           plan_at = case when excluded.plan is null then null
                          when excluded.plan is not distinct from feedback_reflection.plan then feedback_reflection.plan_at
                          else now() end,
           sent_at = case when (feedback_reflection.makes_sense, feedback_reflection.question, feedback_reflection.plan, feedback_reflection.went_well)
                               is not distinct from (excluded.makes_sense, excluded.question, excluded.plan, excluded.went_well)
                          then feedback_reflection.sent_at else now() end,
           updated_at = now()
    returning * into _f;
    return jsonb_build_object('ok', true, 'reflection', jsonb_build_object(
        'makes_sense', _f.makes_sense, 'question', _f.question, 'plan', _f.plan, 'went_well', _f.went_well, 'sent_at', _f.sent_at));
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_class_bundle(p_course_id uuid, p_if_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
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
                       'core_competency_ids', to_jsonb(asm.core_competency_ids),
                       'created_at', asm.created_at
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
               'created_at', a.created_at,
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

CREATE OR REPLACE FUNCTION public.duplicate_assessment(p_src_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _new_id   uuid;
    _course   uuid;
    _module   uuid;
    _next_pos int;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'duplicate_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select course_id, module_id into _course, _module
      from assessment
     where id = p_src_id;
    if _course is null then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = _course
       and module_id is not distinct from _module;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, collab_mode, collab_config, display_order,
                            core_competency_ids)
    select course_id, category_id, title || ' (copy)', description, date_assigned, due_date,
           score_mode, max_points, weight, evidence_type,
           rubric_id, module_id, collab_mode, collab_config, _next_pos,
           core_competency_ids
      from assessment
     where id = p_src_id
    returning id into _new_id;

    insert into assessment_tag (assessment_id, tag_id)
    select _new_id, tag_id from assessment_tag where assessment_id = p_src_id;

    perform fv_idem_store(p_idempotency_key, 'duplicate_assessment', jsonb_build_object('id', _new_id));
    return _new_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.import_json_restore(p_payload jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _row jsonb;
    _id uuid;
    _sid uuid;
    _students jsonb := '{}'::jsonb;  -- payload student id → student id used
    _used jsonb := '{}'::jsonb;      -- existing student ids already matched
    _n_courses int := 0; _n_rc int := 0; _n_cat int := 0;
    _n_subj int := 0; _n_cg int := 0; _n_sect int := 0; _n_tag int := 0;
    _n_mod int := 0; _n_rub int := 0; _n_crit int := 0; _n_ct int := 0; _n_chk int := 0;
    _n_stu int := 0; _n_matched int := 0; _n_enr int := 0; _n_asm int := 0; _n_at int := 0;
    _n_scr int := 0; _n_rs int := 0; _n_ts int := 0; _n_rcs int := 0;
    _n_note int := 0; _n_goal int := 0; _n_refl int := 0; _n_ovr int := 0;
    _n_ctag int := 0; _n_obs int := 0; _n_tr int := 0;
    _cached jsonb; _result jsonb;
    _bad text;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'import_json_restore');
    if _cached is not null then return _cached; end if;
    perform set_config('fv.restoring', 'on', true);

    if p_payload ? 'courses' then
      for _row in select * from jsonb_array_elements(p_payload->'courses') loop
        insert into course (id, teacher_id, name, grade_level, description, color,
                            is_archived, grading_system, calc_method, decay_weight,
                            timezone, late_work_policy, grading_scale, category_weights,
                            round_percent, reporting_terms, block, recent_score_limit,
                            level_order, curriculum_tags, folders_count_as_one,
                            courses_count_equally, student_page_enabled, return_grades)
        values ((_row->>'id')::uuid, _uid,
                coalesce(_row->>'name','Untitled'),
                _row->>'grade_level', _row->>'description', _row->>'color',
                coalesce((_row->>'is_archived')::boolean, false),
                coalesce(_row->>'grading_system','proficiency'),
                coalesce(_row->>'calc_method','average'),
                nullif(_row->>'decay_weight','')::numeric,
                coalesce(_row->>'timezone','America/Vancouver'),
                _row->>'late_work_policy',
                case when jsonb_typeof(_row->'grading_scale') = 'object' then _row->'grading_scale' end,
                case when jsonb_typeof(_row->'category_weights') = 'object' then _row->'category_weights' end,
                nullif(_row->>'round_percent','')::boolean,
                case when jsonb_typeof(_row->'reporting_terms') in ('object','array') then _row->'reporting_terms' end,
                nullif(_row->>'block',''),
                nullif(_row->>'recent_score_limit','')::smallint,
                coalesce(_row->>'level_order','desc'),
                case when jsonb_typeof(_row->'curriculum_tags') = 'array'
                     then array(select jsonb_array_elements_text(_row->'curriculum_tags')) end,
                coalesce((_row->>'folders_count_as_one')::boolean, true),
                coalesce((_row->>'courses_count_equally')::boolean, false),
                -- A backup from before Draft and Returned has neither: the
                -- student page is off and no choice is made (works as on_save).
                coalesce((_row->>'student_page_enabled')::boolean, false),
                nullif(_row->>'return_grades', ''))
        on conflict (id) do update set
          name=excluded.name, grade_level=excluded.grade_level,
          description=excluded.description, color=excluded.color,
          is_archived=excluded.is_archived, grading_system=excluded.grading_system,
          calc_method=excluded.calc_method, decay_weight=excluded.decay_weight,
          timezone=excluded.timezone, late_work_policy=excluded.late_work_policy,
          grading_scale=excluded.grading_scale, category_weights=excluded.category_weights,
          round_percent=excluded.round_percent, reporting_terms=excluded.reporting_terms,
          block=excluded.block, recent_score_limit=excluded.recent_score_limit,
          level_order=excluded.level_order, curriculum_tags=excluded.curriculum_tags,
          folders_count_as_one=excluded.folders_count_as_one,
          courses_count_equally=excluded.courses_count_equally,
          student_page_enabled=excluded.student_page_enabled, return_grades=excluded.return_grades,
          updated_at=now();
        _n_courses := _n_courses + 1;
      end loop;
    end if;

    if p_payload ? 'report_configs' then
      for _row in select * from jsonb_array_elements(p_payload->'report_configs') loop
        insert into report_config (course_id, preset, blocks_config)
        values ((_row->>'course_id')::uuid,
                coalesce(_row->>'preset','standard'),
                _row->'blocks_config')
        on conflict (course_id) do update set
          preset=excluded.preset, blocks_config=excluded.blocks_config, updated_at=now();
        _n_rc := _n_rc + 1;
      end loop;
    end if;

    if p_payload ? 'categories' then
      for _row in select * from jsonb_array_elements(p_payload->'categories') loop
        insert into category (id, course_id, name, weight, display_order, calc_mode)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'weight')::numeric, 0),
                coalesce((_row->>'display_order')::int, 0),
                coalesce(_row->>'calc_mode','points'))
        on conflict (id) do update set
          name=excluded.name, weight=excluded.weight,
          display_order=excluded.display_order, calc_mode=excluded.calc_mode, updated_at=now();
        _n_cat := _n_cat + 1;
      end loop;
    end if;

    if p_payload ? 'subjects' then
      for _row in select * from jsonb_array_elements(p_payload->'subjects') loop
        insert into subject (id, course_id, name, display_order, color)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), coalesce((_row->>'display_order')::int, 0),
                _row->>'color')
        on conflict (id) do update set name=excluded.name, display_order=excluded.display_order,
          color=excluded.color, updated_at=now();
        _n_subj := _n_subj + 1;
      end loop;
    end if;

    if p_payload ? 'competency_groups' then
      for _row in select * from jsonb_array_elements(p_payload->'competency_groups') loop
        insert into competency_group (id, course_id, name, color, display_order, counts_as_one)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0),
                coalesce((_row->>'counts_as_one')::boolean, true))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, counts_as_one=excluded.counts_as_one, updated_at=now();
        _n_cg := _n_cg + 1;
      end loop;
    end if;

    if p_payload ? 'sections' then
      for _row in select * from jsonb_array_elements(p_payload->'sections') loop
        insert into section (id, course_id, subject_id, competency_group_id, name, display_order, color)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                (_row->>'subject_id')::uuid,
                nullif(_row->>'competency_group_id','')::uuid,
                coalesce(_row->>'name',''),
                coalesce((_row->>'display_order')::int, 0),
                _row->>'color')
        on conflict (id) do update set
          subject_id=excluded.subject_id, competency_group_id=excluded.competency_group_id,
          name=excluded.name, display_order=excluded.display_order, color=excluded.color,
          updated_at=now();
        _n_sect := _n_sect + 1;
      end loop;
    end if;

    if p_payload ? 'tags' then
      for _row in select * from jsonb_array_elements(p_payload->'tags') loop
        insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values ((_row->>'id')::uuid, (_row->>'section_id')::uuid,
                _row->>'code', coalesce(_row->>'label',''), _row->>'i_can_text',
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'i_can_statements') = 'array'
                         then _row->'i_can_statements' else '[]'::jsonb end)), '{}'),
                _row->>'source_text', _row->>'bank_id',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          code=excluded.code, label=excluded.label, i_can_text=excluded.i_can_text,
          i_can_statements=case when _row ? 'i_can_statements' then excluded.i_can_statements else tag.i_can_statements end,
          source_text=case when _row ? 'source_text' then excluded.source_text else tag.source_text end,
          bank_id=case when _row ? 'bank_id' then excluded.bank_id else tag.bank_id end,
          display_order=excluded.display_order, updated_at=now();
        _n_tag := _n_tag + 1;
      end loop;
    end if;

    if p_payload ? 'modules' then
      for _row in select * from jsonb_array_elements(p_payload->'modules') loop
        insert into module (id, course_id, name, color, display_order)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                coalesce(_row->>'name',''), _row->>'color',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set name=excluded.name, color=excluded.color,
          display_order=excluded.display_order, updated_at=now();
        _n_mod := _n_mod + 1;
      end loop;
    end if;

    if p_payload ? 'rubrics' then
      for _row in select * from jsonb_array_elements(p_payload->'rubrics') loop
        insert into rubric (id, course_id, name, style)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid, coalesce(_row->>'name',''),
                coalesce(_row->>'style','standard'))
        on conflict (id) do update set name=excluded.name, style=excluded.style, updated_at=now();
        _n_rub := _n_rub + 1;
      end loop;
    end if;

    if p_payload ? 'criteria' then
      for _row in select * from jsonb_array_elements(p_payload->'criteria') loop
        insert into criterion (id, rubric_id, name,
          level_4_descriptor, level_3_descriptor, level_2_descriptor, level_1_descriptor,
          level_4_value, level_3_value, level_2_value, level_1_value, weight, display_order)
        values ((_row->>'id')::uuid, (_row->>'rubric_id')::uuid,
                coalesce(_row->>'name',''),
                _row->>'level_4_descriptor', _row->>'level_3_descriptor',
                _row->>'level_2_descriptor', _row->>'level_1_descriptor',
                coalesce((_row->>'level_4_value')::numeric, 4),
                coalesce((_row->>'level_3_value')::numeric, 3),
                coalesce((_row->>'level_2_value')::numeric, 2),
                coalesce((_row->>'level_1_value')::numeric, 1),
                coalesce((_row->>'weight')::numeric, 1.0),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          name=excluded.name,
          level_4_descriptor=excluded.level_4_descriptor, level_3_descriptor=excluded.level_3_descriptor,
          level_2_descriptor=excluded.level_2_descriptor, level_1_descriptor=excluded.level_1_descriptor,
          level_4_value=excluded.level_4_value, level_3_value=excluded.level_3_value,
          level_2_value=excluded.level_2_value, level_1_value=excluded.level_1_value,
          weight=excluded.weight, display_order=excluded.display_order, updated_at=now();
        _n_crit := _n_crit + 1;
      end loop;
    end if;

    if p_payload ? 'criterion_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'criterion_tags') loop
        insert into criterion_tag (criterion_id, tag_id)
        values ((_row->>'criterion_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    -- Competencies a whole rubric scores.
    if p_payload ? 'rubric_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'rubric_tags') loop
        insert into rubric_tag (rubric_id, tag_id)
        values ((_row->>'rubric_id')::uuid, (_row->>'tag_id')::uuid)
        on conflict do nothing;
        _n_ct := _n_ct + 1;
      end loop;
    end if;

    -- An Advanced Rubric's checkboxes.
    if p_payload ? 'criterion_checks' then
      for _row in select * from jsonb_array_elements(p_payload->'criterion_checks') loop
        insert into criterion_check (id, criterion_id, level, label, display_order)
        values ((_row->>'id')::uuid, (_row->>'criterion_id')::uuid,
                (_row->>'level')::smallint, coalesce(_row->>'label',''),
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set level=excluded.level, label=excluded.label,
          display_order=excluded.display_order, updated_at=now();
        _n_chk := _n_chk + 1;
      end loop;
    end if;

    -- Students: one of the teacher's students with the same student number,
    -- else the backup's own student record, is used instead of a new one.
    -- RLS shows only the teacher's own students, so another teacher's
    -- backup always makes new records.
    if p_payload ? 'students' then
      for _row in select * from jsonb_array_elements(p_payload->'students') loop
        _sid := null;
        if nullif(btrim(_row->>'student_number'),'') is not null then
          select s.id into _sid from student s
           where s.teacher_id = _uid and s.student_number = btrim(_row->>'student_number')
             and not (_used ? s.id::text)
           order by s.created_at limit 1;
        end if;
        if _sid is null and nullif(_row->>'match_id','') is not null then
          select s.id into _sid from student s
           where s.teacher_id = _uid and s.id::text = _row->>'match_id'
             and not (_used ? s.id::text);
        end if;
        if _sid is not null then
          _n_matched := _n_matched + 1;
        else
          _sid := (_row->>'id')::uuid;
          insert into student (id, teacher_id, first_name, last_name, preferred_name,
                               pronouns, student_number, email, date_of_birth)
          values (_sid, _uid,
                  coalesce(_row->>'first_name',''),
                  _row->>'last_name', _row->>'preferred_name', _row->>'pronouns',
                  nullif(btrim(_row->>'student_number'),''), nullif(_row->>'email',''),
                  nullif(_row->>'date_of_birth','')::date)
          on conflict (id) do update set
            first_name=excluded.first_name, last_name=excluded.last_name,
            preferred_name=excluded.preferred_name, pronouns=excluded.pronouns,
            student_number=excluded.student_number, email=excluded.email,
            date_of_birth=excluded.date_of_birth, updated_at=now();
        end if;
        _used := _used || jsonb_build_object(_sid::text, true);
        _students := _students || jsonb_build_object(_row->>'id', _sid::text);
        _n_stu := _n_stu + 1;
      end loop;
    end if;

    if p_payload ? 'enrollments' then
      for _row in select * from jsonb_array_elements(p_payload->'enrollments') loop
        insert into enrollment (id, student_id, course_id, designations, roster_position,
                                is_flagged, withdrawn_at, enrolled_at)
        values ((_row->>'id')::uuid,
                coalesce(_students->>(_row->>'student_id'), _row->>'student_id')::uuid,
                (_row->>'course_id')::uuid,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'designations') = 'array'
                         then _row->'designations' else '[]'::jsonb end)), '{}'),
                coalesce((_row->>'roster_position')::int, 0),
                coalesce((_row->>'is_flagged')::boolean, false),
                nullif(_row->>'withdrawn_at','')::timestamptz,
                coalesce(nullif(_row->>'enrolled_at','')::timestamptz, now()))
        on conflict (id) do update set
          designations=excluded.designations, roster_position=excluded.roster_position,
          is_flagged=excluded.is_flagged, withdrawn_at=excluded.withdrawn_at, updated_at=now();
        _n_enr := _n_enr + 1;
      end loop;
    end if;

    if p_payload ? 'assessments' then
      for _row in select * from jsonb_array_elements(p_payload->'assessments') loop
        insert into assessment (id, course_id, category_id, title, description,
                                date_assigned, due_date, score_mode, max_points, weight,
                                evidence_type, rubric_id, module_id, display_order,
                                collab_mode, collab_config, core_competency_ids)
        values ((_row->>'id')::uuid, (_row->>'course_id')::uuid,
                nullif(_row->>'category_id','')::uuid,
                coalesce(_row->>'title',''), _row->>'description',
                nullif(_row->>'date_assigned','')::date,
                nullif(_row->>'due_date','')::date,
                coalesce(_row->>'score_mode','proficiency'),
                nullif(_row->>'max_points','')::numeric,
                coalesce((_row->>'weight')::numeric, 1.0),
                _row->>'evidence_type',
                nullif(_row->>'rubric_id','')::uuid,
                nullif(_row->>'module_id','')::uuid,
                coalesce((_row->>'display_order')::int, 0),
                coalesce(_row->>'collab_mode','none'),
                case when jsonb_typeof(_row->'collab_config') = 'object' then _row->'collab_config' end,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'core_competency_ids') = 'array'
                         then _row->'core_competency_ids' else '[]'::jsonb end)), '{}'))
        on conflict (id) do update set
          category_id=excluded.category_id, title=excluded.title, description=excluded.description,
          date_assigned=excluded.date_assigned, due_date=excluded.due_date,
          score_mode=excluded.score_mode, max_points=excluded.max_points, weight=excluded.weight,
          evidence_type=excluded.evidence_type, rubric_id=excluded.rubric_id,
          module_id=excluded.module_id, display_order=excluded.display_order,
          collab_mode=excluded.collab_mode, collab_config=excluded.collab_config,
          core_competency_ids=excluded.core_competency_ids, updated_at=now();
        _n_asm := _n_asm + 1;
      end loop;
    end if;

    if p_payload ? 'assessment_tags' then
      insert into assessment_tag (assessment_id, tag_id)
      select (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid from jsonb_array_elements(case when jsonb_typeof(p_payload->'assessment_tags') = 'array' then p_payload->'assessment_tags' else '[]'::jsonb end) r
      on conflict do nothing;
      get diagnostics _n_at = row_count;
    end if;

    if p_payload ? 'scores' then
      insert into score (id, enrollment_id, assessment_id, value, status, comment, scored_at,
                         modifier, report_note)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid,
             nullif(r->>'value','')::numeric, r->>'status', r->>'comment',
             coalesce(nullif(r->>'scored_at','')::timestamptz, now()),
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'report_note','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'scores') = 'array' then p_payload->'scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id) do update set
        value=excluded.value, status=excluded.status, comment=excluded.comment,
        modifier=excluded.modifier, report_note=excluded.report_note, updated_at=now();
      get diagnostics _n_scr = row_count;
    end if;

    if p_payload ? 'rubric_scores' then
      insert into rubric_score (id, enrollment_id, assessment_id, criterion_id, value,
                                modifier, comment, beyond)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'criterion_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'criterion_id')::uuid,
             (r->>'value')::int,
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'comment',''), nullif(r->>'beyond','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'rubric_scores') = 'array' then p_payload->'rubric_scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id, criterion_id) do update set
        value=excluded.value, modifier=excluded.modifier, comment=excluded.comment,
        beyond=excluded.beyond, updated_at=now();
      get diagnostics _n_rs = row_count;
    end if;

    if p_payload ? 'tag_scores' then
      insert into tag_score (id, enrollment_id, assessment_id, tag_id, value, modifier, comment)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'tag_id')::uuid,
             (r->>'value')::int,
             coalesce((r->>'modifier')::smallint, 0),
             nullif(r->>'comment','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'tag_scores') = 'array' then p_payload->'tag_scores' else '[]'::jsonb end) r
      on conflict (enrollment_id, assessment_id, tag_id) do update set
        value=excluded.value, modifier=excluded.modifier, comment=excluded.comment, updated_at=now();
      get diagnostics _n_ts = row_count;
    end if;

    -- Ticked Advanced Rubric checkboxes.
    if p_payload ? 'rubric_check_scores' then
      insert into rubric_check_score (enrollment_id, assessment_id, check_id)
      select (r->>'enrollment_id')::uuid, (r->>'assessment_id')::uuid, (r->>'check_id')::uuid
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'rubric_check_scores') = 'array' then p_payload->'rubric_check_scores' else '[]'::jsonb end) r
      on conflict do nothing;
      get diagnostics _n_rcs = row_count;
    end if;

    if p_payload ? 'notes' then
      insert into note (id, enrollment_id, body, created_at)
      select coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, coalesce(r->>'body',''),
             coalesce(nullif(r->>'created_at','')::timestamptz, now())
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'notes') = 'array' then p_payload->'notes' else '[]'::jsonb end) r
      on conflict (id) do update set body=excluded.body;
      get diagnostics _n_note = row_count;
    end if;

    if p_payload ? 'goals' then
      insert into goal (id, enrollment_id, section_id, body)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid, coalesce(r->>'body','')
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'goals') = 'array' then p_payload->'goals' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set body=excluded.body, updated_at=now();
      get diagnostics _n_goal = row_count;
    end if;

    if p_payload ? 'reflections' then
      insert into reflection (id, enrollment_id, section_id, body, confidence)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid, r->>'body',
             nullif(r->>'confidence','')::int
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'reflections') = 'array' then p_payload->'reflections' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set
        body=excluded.body, confidence=excluded.confidence, updated_at=now();
      get diagnostics _n_refl = row_count;
    end if;

    if p_payload ? 'section_overrides' then
      insert into section_override (id, enrollment_id, section_id, level, reason)
      select distinct on ((r->>'enrollment_id')::uuid, (r->>'section_id')::uuid)
             coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
             (r->>'enrollment_id')::uuid, (r->>'section_id')::uuid,
             (r->>'level')::int, r->>'reason'
        from jsonb_array_elements(case when jsonb_typeof(p_payload->'section_overrides') = 'array' then p_payload->'section_overrides' else '[]'::jsonb end) r
      on conflict (enrollment_id, section_id) do update set
        level=excluded.level, reason=excluded.reason, updated_at=now();
      get diagnostics _n_ovr = row_count;
    end if;

    if p_payload ? 'custom_tags' then
      for _row in select * from jsonb_array_elements(p_payload->'custom_tags') loop
        insert into custom_tag (id, course_id, label)
        values (coalesce(nullif(_row->>'id','')::uuid, gen_random_uuid()),
                (_row->>'course_id')::uuid, _row->>'label')
        on conflict (id) do update set label=excluded.label;
        _n_ctag := _n_ctag + 1;
      end loop;
    end if;

    -- Observations, with their students and competency. A sentence starter
    -- the teacher no longer has is dropped from the link, not the note.
    if p_payload ? 'observations' then
      for _row in select * from jsonb_array_elements(p_payload->'observations') loop
        _id := (_row->>'id')::uuid;
        insert into observation (id, course_id, body, sentiment, context_type, assessment_id,
                                 created_at, dims, level, template_id)
        values (_id, (_row->>'course_id')::uuid, coalesce(_row->>'body',''),
                nullif(_row->>'sentiment',''), nullif(_row->>'context_type',''),
                nullif(_row->>'assessment_id','')::uuid,
                coalesce(nullif(_row->>'created_at','')::timestamptz, now()),
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'dims') = 'array'
                         then _row->'dims' else '[]'::jsonb end)), '{}'),
                nullif(_row->>'level','')::smallint,
                (select t.id from observation_template t
                  where t.id::text = nullif(_row->>'template_id','')))
        on conflict (id) do update set
          body=excluded.body, sentiment=excluded.sentiment, context_type=excluded.context_type,
          assessment_id=excluded.assessment_id, dims=excluded.dims, level=excluded.level,
          template_id=excluded.template_id, updated_at=now();
        insert into observation_student (observation_id, enrollment_id)
        select _id, e::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'enrollment_ids') = 'array' then _row->'enrollment_ids' else '[]'::jsonb end) e
        on conflict do nothing;
        insert into observation_tag (observation_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'tag_ids') = 'array' then _row->'tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        _n_obs := _n_obs + 1;
      end loop;
    end if;

    -- Term ratings, with the competencies, assessments and observations
    -- they name. After observations, which they can point to.
    if p_payload ? 'term_ratings' then
      for _row in select * from jsonb_array_elements(p_payload->'term_ratings') loop
        insert into term_rating (id, enrollment_id, term, narrative_html, work_habits_rating,
                                 participation_rating, social_traits, habits, approved_at,
                                 reporting_basis, ie_deadline, draft_meta, absences, lates)
        values (coalesce(nullif(_row->>'id','')::uuid, gen_random_uuid()),
                (_row->>'enrollment_id')::uuid, (_row->>'term')::int,
                _row->>'narrative_html',
                nullif(_row->>'work_habits_rating','')::int,
                nullif(_row->>'participation_rating','')::int,
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'social_traits') = 'array'
                         then _row->'social_traits' else '[]'::jsonb end)), '{}'),
                case when jsonb_typeof(_row->'habits') = 'object' then _row->'habits' else '{}'::jsonb end,
                nullif(_row->>'approved_at','')::timestamptz,
                coalesce(nullif(_row->>'reporting_basis',''), 'grade'),
                nullif(_row->>'ie_deadline','')::date,
                case when jsonb_typeof(_row->'draft_meta') = 'object' then _row->'draft_meta' end,
                nullif(_row->>'absences','')::int,
                nullif(_row->>'lates','')::int)
        on conflict (enrollment_id, term) do update set
          narrative_html=excluded.narrative_html, work_habits_rating=excluded.work_habits_rating,
          participation_rating=excluded.participation_rating, social_traits=excluded.social_traits,
          habits=excluded.habits, approved_at=excluded.approved_at,
          reporting_basis=excluded.reporting_basis, ie_deadline=excluded.ie_deadline,
          draft_meta=excluded.draft_meta, absences=excluded.absences, lates=excluded.lates,
          updated_at=now()
        returning id into _id;
        insert into term_rating_strength (term_rating_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'strength_tag_ids') = 'array' then _row->'strength_tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        insert into term_rating_growth_area (term_rating_id, tag_id)
        select _id, t::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'growth_tag_ids') = 'array' then _row->'growth_tag_ids' else '[]'::jsonb end) t
        on conflict do nothing;
        insert into term_rating_assessment (term_rating_id, assessment_id)
        select _id, a::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'mention_assessment_ids') = 'array' then _row->'mention_assessment_ids' else '[]'::jsonb end) a
        on conflict do nothing;
        insert into term_rating_observation (term_rating_id, observation_id)
        select _id, o::uuid from jsonb_array_elements_text(
          case when jsonb_typeof(_row->'mention_observation_ids') = 'array' then _row->'mention_observation_ids' else '[]'::jsonb end) o
        on conflict do nothing;
        _n_tr := _n_tr + 1;
      end loop;
    end if;

    -- Every other record a restored row names must be the teacher's own:
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

    -- One cursor bump per restored course, now the rows are in, through the
    -- course's own trigger (the teacher can't call _touch_course_sync_cursor).
    -- Draft and Returned: the state in the backup, or Returned for a
    -- backup that has none. The score-table triggers stood aside above.
    perform fv_private.restore_grade_returns(p_payload);

    perform set_config('fv.restoring', '', true);
    if p_payload ? 'courses' then
      update course set updated_at = now()
       where id in (select (r->>'id')::uuid from jsonb_array_elements(p_payload->'courses') r);
    end if;

    _result := jsonb_build_object(
      'courses', _n_courses, 'report_configs', _n_rc, 'categories', _n_cat,
      'subjects', _n_subj, 'competency_groups', _n_cg,
      'sections', _n_sect, 'tags', _n_tag,
      'modules', _n_mod, 'rubrics', _n_rub, 'criteria', _n_crit, 'criterion_tags', _n_ct,
      'criterion_checks', _n_chk,
      'students', _n_stu, 'students_matched', _n_matched, 'student_ids', _students,
      'enrollments', _n_enr,
      'assessments', _n_asm, 'assessment_tags', _n_at,
      'scores', _n_scr, 'rubric_scores', _n_rs, 'tag_scores', _n_ts,
      'rubric_check_scores', _n_rcs,
      'notes', _n_note, 'goals', _n_goal, 'reflections', _n_refl,
      'section_overrides', _n_ovr, 'custom_tags', _n_ctag,
      'observations', _n_obs, 'term_ratings', _n_tr
    );
    perform fv_idem_store(p_idempotency_key, 'import_json_restore', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_teams_class(p_payload jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _uid uuid := (select auth.uid());
    _course_id uuid;
    _stu_created int := 0; _enr_created int := 0; _asm_created int := 0; _next_pos int := 0;
    _row jsonb; _sid uuid;
    _sn text; _em text; _fn text; _ln text;
    _cached jsonb; _result jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'p_payload must be an object' using errcode = '22023';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'import_teams_class');
    if _cached is not null then return _cached; end if;

    insert into course (teacher_id, name, grade_level, timezone)
    values (_uid,
            coalesce(p_payload->>'class_name', 'Imported Class'),
            p_payload->>'grade_level',
            coalesce(p_payload->>'timezone', 'America/Vancouver'))
    returning id into _course_id;
    insert into report_config (course_id) values (_course_id);

    if p_payload ? 'students' and jsonb_typeof(p_payload->'students') = 'array' then
        for _row in select * from jsonb_array_elements(p_payload->'students') loop
            _sid := null;
            _sn := nullif(_row->>'student_number', '');
            _em := nullif(_row->>'email', '');
            _fn := nullif(_row->>'first_name', '');
            _ln := nullif(_row->>'last_name', '');
            if _sn is not null then
                select id into _sid from student where teacher_id = _uid and student_number = _sn limit 1;
            end if;
            if _sid is null and _em is not null then
                select id into _sid from student where teacher_id = _uid and email = _em limit 1;
            end if;
            if _sid is null and _fn is not null then
                select id into _sid from student where teacher_id = _uid and first_name = _fn
                   and coalesce(last_name, '') = coalesce(_ln, '') limit 1;
            end if;
            if _sid is null then
                insert into student (teacher_id, first_name, last_name, preferred_name,
                                     pronouns, student_number, email, date_of_birth)
                values (_uid, _fn, _ln,
                        nullif(_row->>'preferred_name',''),
                        nullif(_row->>'pronouns',''),
                        _sn, _em,
                        nullif(_row->>'date_of_birth','')::date)
                returning id into _sid;
                _stu_created := _stu_created + 1;
            end if;
            insert into enrollment (student_id, course_id, roster_position)
            values (_sid, _course_id, _next_pos)
            on conflict (student_id, course_id) do update set withdrawn_at = null, updated_at = now();
            _next_pos := _next_pos + 1;
            _enr_created := _enr_created + 1;
        end loop;
    end if;

    if p_payload ? 'assignments' and jsonb_typeof(p_payload->'assignments') = 'array' then
        for _row in select * from jsonb_array_elements(p_payload->'assignments') loop
            insert into assessment (course_id, title, description, date_assigned, due_date,
                                    score_mode, max_points, weight, display_order)
            values (_course_id,
                    coalesce(_row->>'title', 'Untitled'),
                    _row->>'description',
                    nullif(_row->>'date_assigned','')::date,
                    nullif(_row->>'due_date','')::date,
                    coalesce(_row->>'score_mode', 'proficiency'),
                    nullif(_row->>'max_points','')::numeric,
                    coalesce((_row->>'weight')::numeric, 1.0),
                    _asm_created);
            _asm_created := _asm_created + 1;
        end loop;
    end if;

    update teacher_preference set active_course_id = _course_id where teacher_id = _uid;

    _result := jsonb_build_object('course_id', _course_id,
        'students_created', _stu_created,
        'enrollments_created', _enr_created,
        'assessments_created', _asm_created);
    perform fv_idem_store(p_idempotency_key, 'import_teams_class', _result);
    return _result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_assessment(p_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update assessment set
        title         = coalesce(p_patch->>'title', title),
        description   = case when p_patch ? 'description'   then p_patch->>'description'   else description end,
        category_id   = case when p_patch ? 'category_id'
                             then nullif(p_patch->>'category_id','')::uuid else category_id end,
        date_assigned = case when p_patch ? 'date_assigned'
                             then nullif(p_patch->>'date_assigned','')::date else date_assigned end,
        due_date      = case when p_patch ? 'due_date'
                             then nullif(p_patch->>'due_date','')::date else due_date end,
        score_mode    = coalesce(p_patch->>'score_mode', score_mode),
        max_points    = case when p_patch ? 'max_points'
                             then nullif(p_patch->>'max_points','')::numeric else max_points end,
        weight        = coalesce((p_patch->>'weight')::numeric, weight),
        evidence_type = case when p_patch ? 'evidence_type' then p_patch->>'evidence_type' else evidence_type end,
        rubric_id     = case when p_patch ? 'rubric_id'
                             then nullif(p_patch->>'rubric_id','')::uuid else rubric_id end,
        module_id     = case when p_patch ? 'module_id'
                             then nullif(p_patch->>'module_id','')::uuid else module_id end,
        display_order = case when p_patch ? 'display_order'
                             then (p_patch->>'display_order')::int else display_order end,
        copy_group    = case when p_patch ? 'copy_group'
                             then nullif(p_patch->>'copy_group','')::uuid else copy_group end,
        core_competency_ids = case
                             when not (p_patch ? 'core_competency_ids') then core_competency_ids
                             when jsonb_typeof(p_patch->'core_competency_ids') = 'array'
                             then array(select distinct c
                                          from jsonb_array_elements_text(p_patch->'core_competency_ids') c
                                         order by c)
                             else '{}' end,
        updated_at    = now()
    where id = p_id;

    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    if p_tag_ids is not null then
        delete from assessment_tag where assessment_id = p_id;
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag)
            on conflict do nothing;
        end loop;
    end if;
end; $function$;

drop trigger if exists assessment_draft_guard on public.assessment;
drop function if exists public._assessment_draft_guard();

drop function if exists public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean);
CREATE OR REPLACE FUNCTION public.create_assessment(p_course_id uuid, p_title text, p_category_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_date_assigned date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_score_mode text DEFAULT 'proficiency'::text, p_max_points numeric DEFAULT NULL::numeric, p_weight numeric DEFAULT 1.0, p_evidence_type text DEFAULT NULL::text, p_rubric_id uuid DEFAULT NULL::uuid, p_module_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT '{}'::uuid[], p_copy_group uuid DEFAULT NULL::uuid, p_core_competency_ids text[] DEFAULT '{}'::text[], p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    _id       uuid;
    _next_pos int;
    _tag      uuid;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = p_course_id
       and module_id is not distinct from p_module_id;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, display_order, copy_group, core_competency_ids)
    values (p_course_id, p_category_id, p_title, p_description, p_date_assigned, p_due_date,
            p_score_mode, p_max_points, p_weight, p_evidence_type,
            p_rubric_id, p_module_id, _next_pos, p_copy_group,
            array(select distinct c from unnest(coalesce(p_core_competency_ids, '{}')) c order by c))
    returning id into _id;

    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id)
              values (_id, _tag) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_assessment', jsonb_build_object('id', _id));
    return _id;
end; $function$;
revoke all on function public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid) from public, anon;
grant execute on function public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid) to authenticated, service_role;

alter table public.assessment drop column if exists is_draft;

commit;
