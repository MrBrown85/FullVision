-- S4-M1, UNDONE. Not a migration: the way back from
-- migrations/2026111103_student_page_fields.sql (what a student's page can
-- also be told). It is kept under local-test/ so CI's drift check does not
-- wait for it to be applied. Run it only to take S4-M1 back out. Proved by
-- migrations/local-test/student_page_fields_undo.py.
--
-- Run it in the SQL editor (or psql), whole. One transaction: all of it or
-- none of it.
--
-- ── What it does ────────────────────────────────────────────────────────────
-- It puts back the two functions S4-M1 replaced, exactly as they were:
--   student_submit._session_classes(uuid)   as 2026110904 made it
--   student_submit.page(text, uuid, text)   as 2026110904 made it and
--                                           2026110905 left it (created_at)
-- and checks each by its fingerprint before it commits. Nothing else is
-- touched: no table, no row, no grant. S4-M1 made nothing else, so there is
-- nothing else to take out.
--
-- It refuses, with nothing changed, unless each of the two functions is
-- exactly as S4-M1 leaves it. So it refuses a second run, a database S4-M1
-- was never applied to, and a database where a later migration has replaced
-- either function (that migration's own undo goes first).
--
-- ── Order, among the undo scripts ───────────────────────────────────────────
-- This one goes before S0-M4b's (s0-m4b-undo.sql, PART 2) and Batch A's
-- (batch-a-undo.sql, PART 2): S0-M4b's puts page back as Batch A made it and
-- refuses while page is S4-M1's. It does not matter whether Batch B is
-- applied, and S3-M1's and Batch B's undo scripts do not touch these two
-- functions.
--
-- ── What a student sees ─────────────────────────────────────────────────────
-- The reply loses the keys S4-M1 added (the contract lists them:
-- migrations/local-test/s4-m1-contract.md). Every other key is as it is with
-- S4-M1 applied, so grades, statuses and what was returned read the same.
-- The edge function copies a reply key by key and leaves out what is not
-- there, so it needs no change either way. A page that has started to draw
-- the new keys must already cope with their absence (it does until the day
-- the edge function is extended); with the keys gone it shows no
-- description, module, category, Core Competency, I Can statement or
-- teacher's name, and no To Do count beside a class.
--
-- ── To stop the new keys reaching phones without this script ────────────────
-- Redeploy the student-submit edge function from before its lists were
-- extended: the database may keep sending the keys and no phone is given
-- them.
--
-- ── Optional, afterwards: the migration record ──────────────────────────────
-- If S4-M1 was applied through apply_migration, its row can be removed so a
-- later apply is recorded afresh. Not needed for anything to work.
-- record:
-- delete from supabase_migrations.schema_migrations where name = 'student_page_fields';
-- end record
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            ('student_submit.page(text,uuid,text)',   '034e6674a25f8a5e1abc067f50784ce6'),
            ('student_submit._session_classes(uuid)', '722d403571069e3e97516f432ed9de5c')
        ) as v(fn, applied)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.applied then
            raise exception '% is not as S4-M1 leaves it (found %, expected %): S4-M1 is not applied, or was undone already, or something has replaced the function since. Nothing was changed.',
                _f.fn, _md5, _f.applied;
        end if;
    end loop;
end
$guard$;

-- ── The classes a session has opened, as 2026110904 made it ─────────────────
create or replace function student_submit._session_classes(p_session_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id,
               'student', jsonb_build_object('first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name)),
               'course', jsonb_build_object('name', c.name, 'block', c.block)) order by x.added_at, e.id), '[]'::jsonb)
      from device_session_enrollment x
      join student_card k on k.id = x.card_id
      join enrollment e on e.id = x.enrollment_id
      join student s on s.id = e.student_id
      join course c on c.id = e.course_id
     where x.session_id = p_session_id
       and k.stopped_at is null and e.withdrawn_at is null and c.deleted_at is null and c.student_page_enabled;
$function$;

-- ── page, as 2026110904 made it and 2026110905 left it ──────────────────────
create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
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
        'expires_at', _in->'expires_at',
        'student', (select jsonb_build_object('enrollment_id', e.id,
                                              'first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name))
                      from enrollment e join student s on s.id = e.student_id where e.id = p_enrollment_id),
        'course', jsonb_build_object(
            'name', _course.name, 'block', _course.block, 'grading_system', _course.grading_system,
            'grading_scale', _course.grading_scale, 'level_order', _course.level_order,
            'round_percent', _course.round_percent),
        'classes', _session_classes((_in->>'session_id')::uuid),
        'tags', coalesce((
            select jsonb_object_agg(t.id::text, jsonb_build_object('label', t.label, 'code', t.code))
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
                                                 where x.assessment_id = a.id and s.removed_at is null), '[]'::jsonb))
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));
end;
$function$;

-- ── Both are what they were, and for whom they were ─────────────────────────
do $final$
declare
    _f   record;
    _md5 text;
begin
    for _f in
        select * from (values
            ('student_submit.page(text,uuid,text)',   'e744f2a27bcfd6fef662bbddeb9659c7'),
            ('student_submit._session_classes(uuid)', '6ef848f90721affa406d2b7fef89d285')
        ) as v(fn, was)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.was then
            raise exception '% did not come back as it was before S4-M1 (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.was;
        end if;
        if has_function_privilege('public', to_regprocedure(_f.fn), 'execute')
           or has_function_privilege('anon', to_regprocedure(_f.fn), 'execute')
           or has_function_privilege('authenticated', to_regprocedure(_f.fn), 'execute') then
            raise exception '% can be run by the public, anon or a signed-in teacher. Nothing was changed.', _f.fn;
        end if;
    end loop;
end
$final$;

commit;
