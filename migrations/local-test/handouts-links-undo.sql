-- HANDOUTS AND LINKS, UNDONE. Not a migration: the way back from
-- migrations/2026111170_handouts_links.sql. Kept under local-test/ so CI's
-- drift check does not wait for it to be applied. Proved by
-- migrations/local-test/handouts_links.py (scenario undo).
--
-- PART 1 (the fast stop) takes from signed-in teachers the right to run
-- add_assessment_link, start_handout_upload and finish_handout_upload. From
-- then on no link or handout can be added and no upload finished. An upload
-- already started can still write its pages for what is left of its two
-- hours, but it can never be made ready, so no student sees it, and the
-- nightly job drops it with its files once its time is up. What is already
-- ready still shows, to the teacher and on the student page, and can still
-- be removed. PART 1 changes no row. To turn adding back on, run the
-- migration again.
--
-- PART 2 puts back, word for word, student_submit.page and
-- public._photo_strays as they were before the file (the bodies below are
-- written by handouts_links.py from the database the file was tested on,
-- never by hand) and the policy fv_student_photos_fence as Batch B wrote
-- it, and drops everything else the file made: the two policies on
-- storage.objects, the two triggers on assessment, the table and the
-- sixteen functions. The catalog is then exactly as before the file.
-- It REFUSES, with nothing changed, while public.assessment_resource holds a
-- row: those are teachers' handouts and links, and dropping the table would
-- delete them and leave the handouts' pages in storage with no row to
-- delete them by. To go ahead anyway, first run (it deletes them for good,
-- and queues every handout page for deletion from storage):
--     delete from public.assessment_resource;
-- and let the removal worker run before PART 2. Rows the file's functions
-- wrote in other tables stay: the removal queue's rows for handout pages
-- (reasons handout_removed, handout_expired and stray: Batch B's table, and
-- the worker still deletes what they name) and the remembered answers in
-- fv_idempotency (its own job removes them after 24 hours).
-- It also refuses unless every function is as the file leaves it or, for
-- the two it replaced, already as before (a second run changes nothing).

-- ── PART 1 ──────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '5s';
do $stop$
begin
    if to_regprocedure('public.start_handout_upload(uuid,text,integer,uuid)') is not null then
        execute 'revoke execute on function public.add_assessment_link(uuid, text, text, uuid) from authenticated';
        execute 'revoke execute on function public.start_handout_upload(uuid, text, integer, uuid) from authenticated';
        execute 'revoke execute on function public.finish_handout_upload(uuid, uuid) from authenticated';
    end if;
end
$stop$;
commit;

-- ── PART 2 ──────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '5s';
do $guard$
declare
    _f     record;
    _md5   text;
    _rows  boolean := false;
    _fence record;
begin
    -- (named only inside execute: on a database without the file the table is not there)
    if to_regclass('public.assessment_resource') is not null then
        execute 'select exists (select 1 from public.assessment_resource)' into _rows;
    end if;
    if _rows then
        raise exception 'public.assessment_resource holds teachers'' handouts and links; dropping it would delete them. Delete them first if that is meant (delete from public.assessment_resource), and let the removal worker run. Nothing was changed.';
    end if;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new (written by migrations/local-test/handouts_links.py)
            ('public._handout_path(uuid,uuid,integer)',             '90e3c0e7b44ef1cc8fb3ad1b8b0bc222'),
            ('fv_private.handout_path_parts(text)',                 '9dd1528f2d0d1f49014b4b425b60492b'),
            ('public._assessment_resource_json(uuid)',              '216a6f09d7632edc558686e66a14d086'),
            ('public._assessment_resource_same_class()',            '1d661e6e1a34b6c2a82735f439fdc064'),
            ('public._assessment_resource_removed()',               '331dd8c1a4915e28e1a9ee2131991a93'),
            ('public._assessment_resource_gone()',                  'e7b0e2e222ddd148422248e7e96ce425'),
            ('public._assessment_resource_truncated()',             '5d4a8ca2dd10909f2d669927b2a5bba6'),
            ('public._handout_drop_expired(uuid)',                  'b73cf6fbb7b2b44d1c308d3cca1dfbaf'),
            ('fv_private.handout_upload_allowed(text)',             'b7a01941ecc710558b161f247c6cb413'),
            ('fv_private.handout_read_allowed(text)',               'c49416c21dea4d9ebdae95e1ca881b8c'),
            ('public.add_assessment_link(uuid,text,text,uuid)',     '4b72d1a6e5f2a56e2eb4d2f595be7f4d'),
            ('public.start_handout_upload(uuid,text,integer,uuid)', 'ac3c7d7c3a3f8d30eec287fed2c510ec'),
            ('public.finish_handout_upload(uuid,uuid)',             '03444c3bd55e4826285eeac20bdcfc40'),
            ('public.remove_assessment_resource(uuid,uuid)',        'ceaa38e29071d14b04ba0240c1a9589e'),
            ('public.list_course_resources(uuid)',                  'aedc2494e8d6236cc287a0c1afc9b412'),
            ('student_submit.handout_links(text,uuid,uuid,text)',   'bfb7707f3178d02e63317e3eca4c83c5')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% is not as the file leaves it (found %): something else changed it. Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces (written by migrations/local-test/handouts_links.py)
            ('student_submit.page(text,uuid,text)',                 '2f1795ba4c5416788d477a540b49fccb', '8d8e3f9aa91e43b0163cb3189430b758'),
            ('public._photo_strays(uuid,timestamp with time zone)', '21db626094c7be734d536357c91826c8', '54ffc47d26beeeb480a2430cd57f8f1e')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is neither as the file leaves it nor as before it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    select pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w into _fence
      from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'fv_student_photos_fence';
    if not found
       or not ((_fence.q = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name))'
                and _fence.w = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name))')
            or (_fence.q = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_read_allowed(name) OR fv_private.handout_read_allowed(name))'
                and _fence.w = '((bucket_id IS DISTINCT FROM ''student-photos''::text) OR fv_private.work_upload_allowed(name) OR fv_private.handout_upload_allowed(name))')) then
        raise exception 'the policy fv_student_photos_fence is neither as the file leaves it nor as Batch B wrote it. Nothing was changed.';
    end if;
end
$guard$;

-- The fence as Batch B wrote it (changed in place: the bucket is never
-- without it), then the two policies that needed the wider one.
alter policy fv_student_photos_fence on storage.objects
    using (bucket_id is distinct from 'student-photos' or fv_private.work_read_allowed(name))
    with check (bucket_id is distinct from 'student-photos' or fv_private.work_upload_allowed(name));
drop policy if exists fv_handouts_read on storage.objects;
drop policy if exists fv_handouts_upload on storage.objects;

-- The two functions as they were (create or replace keeps their grants).
-- UNDO-BODIES-BEGIN (written by migrations/local-test/handouts_links.py)
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
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb))
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
                       'courses_count_equally', _course.courses_count_equally),
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

CREATE OR REPLACE FUNCTION public._photo_strays(p_course_id uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _layout constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){4}(-thumb)?\.jpg$';
    _queued int := 0;
    _other  int := 0;
begin
    if p_course_id is not null then
        perform _grade_return_lock_first(p_course_id);
        -- '/' then '0' are next to each other: every name that starts "<class>/", and no other
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.name >= (p_course_id::text || '/') collate "C" and o.name < (p_course_id::text || '0') collate "C"
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _layout
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, p_course_id, 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
    else
        with s as (
            select o.name
              from storage.objects o
             where o.bucket_id = _work_bucket()
               and o.archived_at is null and not o.is_delete_marker
               and o.created_at < p_now - interval '24 hours'
               and o.name ~ _layout
               and not exists (select 1 from course c where c.id = fv_private.work_path_course(o.name))
               and not exists (select 1 from submission_file f where f.path = o.name)
               and not exists (select 1 from submission_file f where f.thumb_path = o.name)
               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)
        ), q as (
            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
            select _work_bucket(), s.name, fv_private.work_path_course(s.name), 'stray', now() from s
            on conflict (bucket, path) do update
                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',
                    queued_at = now(), link_dies_at = now()
              where submission_file_removal.done
            returning 1
        )
        select count(*) into _queued from q;
        select count(*) into _other
          from storage.objects o
         where o.bucket_id = _work_bucket() and o.archived_at is null and not o.is_delete_marker
           and o.created_at < p_now - interval '24 hours' and o.name !~ _layout;
        if _other > 0 then
            perform _photo_log(null, 'stray_other_name', _other, null);
        end if;
    end if;
    if _queued > 0 then
        perform _photo_log(p_course_id, 'stray_queued', _queued, null);
    end if;
    return jsonb_build_object('queued', _queued, 'other_name', _other);
end;
$function$;
-- UNDO-BODIES-END

drop trigger if exists assessment_resource_gone on public.assessment;
drop trigger if exists assessment_resource_truncate on public.assessment;
-- The table goes with its own two triggers, its policy and its indexes.
drop table if exists public.assessment_resource;
drop function if exists student_submit.handout_links(text, uuid, uuid, text);
drop function if exists public.list_course_resources(uuid);
drop function if exists public.remove_assessment_resource(uuid, uuid);
drop function if exists public.finish_handout_upload(uuid, uuid);
drop function if exists public.start_handout_upload(uuid, text, integer, uuid);
drop function if exists public.add_assessment_link(uuid, text, text, uuid);
drop function if exists fv_private.handout_read_allowed(text);
drop function if exists fv_private.handout_upload_allowed(text);
drop function if exists public._handout_drop_expired(uuid);
drop function if exists public._assessment_resource_truncated();
drop function if exists public._assessment_resource_gone();
drop function if exists public._assessment_resource_removed();
drop function if exists public._assessment_resource_same_class();
drop function if exists public._assessment_resource_json(uuid);
drop function if exists fv_private.handout_path_parts(text);
drop function if exists public._handout_path(uuid, uuid, integer);
commit;
