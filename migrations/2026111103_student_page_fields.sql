-- What a student's page can also be told (2026-11-11). Student page build
-- plan, S4-M1. docs/plans/student-page-build-plan.md 1.2 ("One reader for
-- students"), 1.5, 1.8 and slice S4.
--
-- The page's boards show things student_submit.page did not send: what an
-- assignment says, where it is filed, what it counts for, which Core
-- Competencies it is about, each competency's I Can statements, which
-- competencies a rubric row counts toward, the teacher's name, and how many
-- pieces wait in each of the student's classes. This file adds those, to
-- read, for the session's own student and class. It changes nothing about
-- grades.
--
-- TWO FUNCTIONS ARE REPLACED, and nothing else is made, dropped or changed:
-- no table, column, row, trigger or policy. Who may run the two is said
-- again, as it was.
--   student_submit.page(text, uuid, text)
--   student_submit._session_classes(uuid)   (the `classes` list that page and
--                                            verify_card both send)
--
-- ── What is new in the reply ────────────────────────────────────────────────
-- The whole contract, with a worked example, is
-- migrations/local-test/s4-m1-contract.md. In short (v stays 1):
--   course.teacher_name       teacher.display_name of the class's teacher: the
--                             name they signed up with. null when it is null
--                             or empty.
--   tags.<id>.i_can           the competency's I Can statements as the class
--                             has them (tag.i_can_statements): a list of
--                             text, [] when it has none.
--   rubrics[].criteria[].tag_ids
--                             the competencies the criterion counts toward
--                             (criterion_tag), only those still on the class,
--                             so every id is a key of tags. Ordered by id.
--   assessments[].description assessment.description. null when it is null or
--                             empty.
--   assessments[].module_name the name of the module the teacher filed it
--                             under (assessment.module_id), or null.
--   assessments[].category_name
--                             the name of its category, or null when it has
--                             none.
--   assessments[].category_percent
--                             what its category counts toward the course
--                             grade, as the class's Grading setup has it, or
--                             null when no percent would be true. See below.
--   assessments[].core_competencies
--                             [{ id, name }] for assessment.core_competency_ids,
--                             each once, in the Ministry's order: the order of
--                             CORE_COMPETENCIES in shared/constants.js, whose
--                             labels the names are
--                             (tests/student-page-fields.test.js fails if the
--                             two lists differ).
--   classes[].to_do           how many pieces wait for the student in that
--                             class. See below. verify_card's `classes` is
--                             the same list and gains it too.
--
-- category_percent. A class's category weights are stored on public.category
-- (weight, 0 to 100; a class's weights total 100, or it has no categories:
-- fv_check_category_weight_sum). shared/calc.js works the course % out as
-- each category's % times its weight, over the weights of the categories the
-- student has a % in (getCourseLetterData), and only for a class whose
-- grading style shows a % (Letter or Both; assessmentCourseWorth). So:
--   0       the category's weight is 0: work in it counts toward nothing, in
--           every grading style (calc.js, countsTowardGrades);
--   weight  the class's grading style is Letter or Both and its category
--           weights total 100: "Tests count 40% of your grade" is what the
--           teacher set;
--   null    a DIBELS benchmark (it is not a grade); a Proficiency class and a
--           category that weighs something (there is no course % for it to be
--           a share of); a class whose weights do not total 100 (one saved
--           before 2026-10-16 could be).
-- It is the class's setup, not the student's own arithmetic: while one
-- category holds no graded work for a student, calc.js shares the grade
-- among the others, so early in a term a category can carry more than its
-- figure. A piece with no category has no category_name and no percent.
--
-- to_do. Pieces that take a grade, are on the student's page, and have none
-- returned: the count shared/student-view.js gives as counts.toDo plus
-- counts.missing (the owner's ruling: To Do counts Missing work too). A piece
-- is counted when it is listed (its date has come, or it has none), is not a
-- DIBELS benchmark, and either is marked Missing, or is not Excused and has
-- never been returned. Whether it was returned is asked of
-- student_submit._returned_grade, the one reader, exactly as page asks it:
-- its status and its returned_at. A draft is not looked at and cannot move
-- the count: a piece with a draft and no earlier return counts as a piece
-- never graded does, and a draft saved over a returned grade leaves the
-- piece returned.
--
-- ── What does not change ────────────────────────────────────────────────────
-- Every key the reply had before has the same value as before: the old
-- function's reply and the new one's with the new keys taken out are equal,
-- for every state the tests reach (migrations/local-test/student_page_fields.py
-- keeps the old function beside the new one and compares them after every
-- step of every case in tests/fixtures/grade-state-cases.json, and on a
-- class that uses every kind of work). The refusals are the same. Which
-- pieces are listed, their order, the grade, the previous grade, status,
-- returned_at, updated_at and seen_at are the same lines as before.
--
-- ── What it reads ───────────────────────────────────────────────────────────
-- page: course, enrollment, student, teacher (display_name only), tag,
-- section, rubric, criterion, criterion_check, criterion_tag, assessment,
-- assessment_tag, category, module. _session_classes: device_session_enrollment,
-- student_card, enrollment, student, course, assessment. Neither names a
-- score table or grade_return: a grade is still read only through
-- _returned_grade. Neither reads another student's row, an observation, a
-- note, a goal, a term rating, a Note for the Report, or how a class did.
-- The suite fails if either names any other table, or a column on its list
-- of ones a student is not shown.
--
-- Functions this file leaves callable through the API: none. student_submit
-- is not served by the API, and both functions keep the grants they had:
-- page for the service role, _session_classes for its owner alone.
--
-- THE EDGE FUNCTION DOES NOT PASS THE NEW KEYS ON YET. student-submit copies
-- a reply field by field (supabase/functions/student-submit/card-routes.ts)
-- and leaves behind what its lists do not name, so until those lists are
-- extended and the function redeployed, a phone is sent exactly what it is
-- sent today. Applying this file changes nothing a student sees.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless:
--   Batch A, S0-M4b (2026110905), S0-M5 (2026111002) and S3-M1 (2026111003)
--     are applied: the database this was tested on;
--   each of the two functions it replaces is exactly the definition it was
--     written against, or exactly the one it leaves (a second run). md5 of
--     pg_get_functiondef on PostgreSQL 17, from the local harness built as
--     gradebook-prod is, to be compared with the live database, read-only,
--     before the apply (migrations/local-test/s4-m1-live-precheck.sql):
--       function                                  as live has it                    as this file leaves it
--       student_submit.page(text,uuid,text)       e744f2a27bcfd6fef662bbddeb9659c7  034e6674a25f8a5e1abc067f50784ce6
--       student_submit._session_classes(uuid)     6ef848f90721affa406d2b7fef89d285  722d403571069e3e97516f432ed9de5c
--   the two functions the new lines lean on are the ones the tests ran
--     against:
--       student_submit._returned_grade(uuid,uuid) 21706ae9eec783107d9da24e52e1855a
--       student_submit._session_class(text,uuid)  1ae94981ff32f804d12079a24bd7b41a
--   every column the new lines read is there (page is PL/pgSQL, which does
--     not look at a query until it runs).
-- Its last step checks the two fingerprints again, that neither function can
-- be run by the public, anon or a signed-in teacher, and that every SECURITY
-- DEFINER function in public, student_submit and fv_private still names
-- pg_temp last in its search_path (S0-M5's check).
--
-- Can be run again: a second run changes nothing. If a later migration has
-- replaced either function, a run of this file stops rather than put the
-- older one back.
--
-- Batch B (2026111101 and 2026111102, students send work) neither replaces
-- nor checks these two functions, and this file touches nothing of Batch
-- B's. The two can be applied in either order (tested both ways).
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- No table is changed. _session_classes is an SQL function, and making one
-- reads the definitions of the tables it names (device_session_enrollment,
-- student_card, enrollment, student, course, assessment): a shared lock on
-- each until the file commits, an instant later, which waits only for
-- something that holds a table whole, such as another migration. A save, a card scan or a page being
-- read does not hold it up and is not held up. If one of those tables is
-- held whole for more than five seconds the file gives up with nothing
-- applied: run it again. A page being read while the file commits gets the
-- old function or the new one, whole.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/s4-m1-live-precheck.sql   expected: no rows from its
--   first query; its second gives counts to read before deciding.
-- migrations/local-test/s4-m1-live-postcheck.sql  expected: no rows.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/s4-m1-undo.sql (not a migration; proved by
-- student_page_fields_undo.py) puts the two functions back exactly as they
-- were, by fingerprint. No row is touched either way.
--
-- One transaction: the file opens with begin and ends with commit, so it is
-- all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first, before anything
-- is changed.
begin;

-- Give up after five seconds rather than queue behind a long transaction.
-- If it gives up, nothing is applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    -- Batch A, S0-M4b, S0-M5 and S3-M1: the database this was tested on.
    if to_regclass('public.student_card') is null or to_regclass('student_submit.device_session') is null
       or to_regclass('student_submit.device_session_enrollment') is null or to_regclass('public.grade_return') is null then
        raise exception 'Batch A is not all applied (2026110901 to 2026110904): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('public._grade_return_repair_class(uuid)') is null then
        raise exception 'S0-M4b is not applied (2026110905_grade_return_limits.sql): apply it, then this file. Nothing was changed.';
    end if;
    if exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)']) x
                where to_regprocedure(x) is null
                   or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp']) then
        raise exception 'S0-M5 is not applied (2026111002_security_definer_search_path.sql): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null then
        raise exception 'S3-M1 is not applied (2026111003_card_codes_keyed.sql): apply it, then this file. Nothing was changed.';
    end if;
    perform 'public._fv_timezone(text)'::regprocedure;

    -- The two functions this file replaces: each the definition it was
    -- written against, or the one it leaves (a second run).
    for _f in
        select * from (values
            ('student_submit.page(text,uuid,text)',   'e744f2a27bcfd6fef662bbddeb9659c7', '034e6674a25f8a5e1abc067f50784ce6'),
            ('student_submit._session_classes(uuid)', '6ef848f90721affa406d2b7fef89d285', '722d403571069e3e97516f432ed9de5c')
        ) as v(fn, was, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.was and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %; expected % as live has it, or % as this file leaves it). Nothing was changed.',
                _f.fn, _md5, _f.was, _f.becomes;
        end if;
    end loop;
    -- The two the new lines lean on: the one reader of a grade, and the
    -- check that a class is in the session.
    for _f in
        select * from (values
            ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
            ('student_submit._session_class(text,uuid)',  '1ae94981ff32f804d12079a24bd7b41a')
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.md5;
        end if;
    end loop;

    -- Every column the new lines read. page is PL/pgSQL: a column that was
    -- not there would be found only when a student opened their page.
    select string_agg(x.tbl || '.' || x.col, ', ' order by x.tbl, x.col)
      into _left
      from (values ('teacher', 'display_name'), ('course', 'teacher_id'), ('course', 'grading_system'), ('course', 'timezone'),
                   ('tag', 'i_can_statements'), ('criterion_tag', 'criterion_id'), ('criterion_tag', 'tag_id'),
                   ('section', 'course_id'), ('section', 'removed_at'),
                   ('assessment', 'description'), ('assessment', 'module_id'), ('assessment', 'category_id'),
                   ('assessment', 'core_competency_ids'), ('assessment', 'score_mode'), ('assessment', 'date_assigned'),
                   ('module', 'name'), ('module', 'course_id'),
                   ('category', 'name'), ('category', 'weight'), ('category', 'course_id')) as x(tbl, col)
     where not exists (select 1 from pg_attribute a
                        where a.attrelid = to_regclass('public.' || x.tbl) and a.attname = x.col and not a.attisdropped);
    if _left is not null then
        raise exception 'a column the new lines read is not there: %. Nothing was changed.', _left;
    end if;
end
$guard$;

-- ── The classes a session has opened, each with its To Do count ─────────────
-- As the phone lists them (Switching Classes). to_do: the pieces of that
-- class that are on the student's page (dated today or earlier where the
-- class is, or undated), take a grade (not a DIBELS benchmark), and are
-- either marked Missing, or are not Excused and were never returned. The
-- status and the return date come from _returned_grade, the one reader, as
-- page reads them; whether a draft exists is never asked.
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

-- ── page ────────────────────────────────────────────────────────────────────
-- As 2026110904 made it and 2026110905 left it (created_at), with the keys
-- the header lists. The lines that list the pieces, order them and read
-- each grade are the same lines.
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
                                where cc.id = any (a.core_competency_ids)), '[]'::jsonb))
                       || _returned_grade(p_enrollment_id, a.id)
                     order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)
              from assessment a
              left join category k on k.id = a.category_id and k.course_id = _course.id
             where a.course_id = _course.id
               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));
end;
$function$;

-- Service role only for page, as before; the helper for its owner alone. A
-- replaced function keeps the grants it had: these say so again and change
-- nothing.
revoke all on function student_submit._session_classes(uuid) from public, anon, authenticated;
revoke all on function student_submit.page(text, uuid, text) from public, anon, authenticated;
grant execute on function student_submit.page(text, uuid, text) to service_role;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            ('student_submit.page(text,uuid,text)',   '034e6674a25f8a5e1abc067f50784ce6'),
            ('student_submit._session_classes(uuid)', '722d403571069e3e97516f432ed9de5c')
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
        if has_function_privilege('public', to_regprocedure(_f.fn), 'execute')
           or has_function_privilege('anon', to_regprocedure(_f.fn), 'execute')
           or has_function_privilege('authenticated', to_regprocedure(_f.fn), 'execute') then
            raise exception '% can be run by the public, anon or a signed-in teacher. Nothing was changed.', _f.fn;
        end if;
    end loop;
    -- S0-M5's check: no SECURITY DEFINER function in the app's three schemas
    -- is left without pg_temp last in its search_path.
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                        where s ~ '^search_path=(.*, )?pg_temp$');
    if _left is not null then
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. Nothing was changed.', _left;
    end if;
end
$final$;

commit;
