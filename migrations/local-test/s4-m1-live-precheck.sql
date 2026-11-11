-- S4-M1, BEFORE THE APPLY. Read-only: two queries for gradebook-prod, to run
-- just before migrations/2026111103_student_page_fields.sql is applied.
-- Neither changes anything. Run each by itself (QUERY 1, then QUERY 2).
-- migrations/local-test/student_page_fields.py runs both on the local
-- stand-in.
--
-- ── QUERY 1: is the database what the migration was tested on? ──────────────
-- Expected: NO ROWS. Each row is one thing that differs, with what was
-- tested, what was found, and whether the migration would stop on it:
--   stops = 'yes'  the migration's own first check refuses it, with nothing
--                  changed. Do not apply; find out why it differs.
--   stops = 'no'   the migration would still apply, but something it relies
--                  on is not what the tests ran against. Read it before
--                  applying.
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11, built as gradebook-prod is: Batch A, S0-M4b, S0-M5
-- and S3-M1. The column types are the harness's, which come from
-- docs/schema.generated.sql (the snapshot of the live database).
-- With Batch B applied first (2026111101 and 2026111102) the answer is the
-- same: Batch B replaces none of these functions and changes none of these
-- columns.
with expected(fn, md5, stops) as (values
    -- the two functions the migration replaces
    ('student_submit.page(text,uuid,text)',                                   'e744f2a27bcfd6fef662bbddeb9659c7', 'yes'),
    ('student_submit._session_classes(uuid)',                                 '6ef848f90721affa406d2b7fef89d285', 'yes'),
    -- the two the new lines lean on, which it also checks
    ('student_submit._returned_grade(uuid,uuid)',                             '21706ae9eec783107d9da24e52e1855a', 'yes'),
    ('student_submit._session_class(text,uuid)',                              '1ae94981ff32f804d12079a24bd7b41a', 'yes'),
    -- what those call, and what calls the classes list: not checked by the
    -- migration, and what the tests ran with
    ('public._grade_copy(uuid,uuid)',                                         '3a8e0dfbc873176692a1160150a8d43b', 'no'),
    ('public._grade_copy_in_use(jsonb,uuid)',                                 'befe9f034ce927b2abdf8c8825c402bd', 'no'),
    ('public._fv_timezone(text)',                                             '8dbcb5716f155e2441f47416a0b28527', 'no'),
    ('student_submit._device_session(text)',                                  'fa1e510e4ccd3bccbf91e29540a837bb', 'no'),
    ('student_submit._card_refusal(uuid)',                                    'cb88af0a6bf62c22ff6c636b291b1a25', 'no'),
    ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)', 'add37c8bb49f28472972920561401580', 'no')
), columns(tbl, col, type) as (values
    -- every column the new lines read, with the type the tests ran with
    ('teacher', 'display_name', 'text'), ('course', 'teacher_id', 'uuid'), ('course', 'grading_system', 'text'), ('course', 'timezone', 'text'),
    ('tag', 'i_can_statements', 'text[]'), ('criterion_tag', 'criterion_id', 'uuid'), ('criterion_tag', 'tag_id', 'uuid'),
    ('section', 'course_id', 'uuid'), ('section', 'removed_at', 'timestamp with time zone'),
    ('assessment', 'description', 'text'), ('assessment', 'module_id', 'uuid'), ('assessment', 'category_id', 'uuid'),
    ('assessment', 'core_competency_ids', 'text[]'), ('assessment', 'score_mode', 'text'), ('assessment', 'date_assigned', 'date'),
    ('module', 'name', 'text'), ('module', 'course_id', 'uuid'),
    ('category', 'name', 'text'), ('category', 'weight', 'numeric'), ('category', 'course_id', 'uuid')
)
select 'function ' || e.fn as what, e.md5 as tested,
       coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') as found, e.stops
  from expected e
 where coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') <> e.md5
union all
select 'function ' || e.fn || ' is owned by', 'postgres', p.proowner::regrole::text, 'yes (the role that applies must own what it replaces)'
  from expected e join pg_proc p on p.oid = to_regprocedure(e.fn)
 where e.stops = 'yes' and e.fn in ('student_submit.page(text,uuid,text)', 'student_submit._session_classes(uuid)')
   and p.proowner::regrole::text <> 'postgres'
union all
select 'column ' || c.tbl || '.' || c.col, c.type,
       coalesce((select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                  where a.attrelid = to_regclass('public.' || c.tbl) and a.attname = c.col and not a.attisdropped), 'absent'),
       case when exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || c.tbl) and a.attname = c.col and not a.attisdropped)
            then 'no (it is there with another type: the new lines were not tested with it)' else 'yes' end
  from columns c
 where coalesce((select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                  where a.attrelid = to_regclass('public.' || c.tbl) and a.attname = c.col and not a.attisdropped), 'absent') <> c.type
union all
select 'who can run ' || x.fn || ' (of the public, anon, signed-in teachers, the service role)', x.want,
       coalesce((select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                  where has_function_privilege(r, to_regprocedure(x.fn), 'execute')), 'nobody'),
       'no (the migration keeps whatever grants a function has, and takes away the public''s, anon''s and signed-in teachers'')'
  from (values ('student_submit.page(text,uuid,text)', 'service_role'), ('student_submit._session_classes(uuid)', 'nobody')) as x(fn, want)
 where to_regprocedure(x.fn) is not null
   and coalesce((select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                  where has_function_privilege(r, to_regprocedure(x.fn), 'execute')), 'nobody') <> x.want
union all
select 'earlier migrations', 'Batch A, S0-M4b, S0-M5 and S3-M1 applied', v.missing, 'yes'
  from (select concat_ws(', ',
                 case when to_regclass('public.student_card') is null or to_regclass('student_submit.device_session') is null
                           or to_regclass('student_submit.device_session_enrollment') is null or to_regclass('public.grade_return') is null then 'Batch A is not all there' end,
                 case when to_regprocedure('public._grade_return_repair_class(uuid)') is null then 'S0-M4b is not there' end,
                 case when exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)']) x
                                    where to_regprocedure(x) is null
                                       or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp'])
                      then 'S0-M5 is not there' end,
                 case when to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null then 'S3-M1 is not there' end) as missing) v
 where v.missing <> ''
union all
select 'SECURITY DEFINER functions without pg_temp last in their search_path', 'none',
       string_agg(n.nspname || '.' || p.proname, ', ' order by 1), 'yes (its last check refuses, whichever function it is)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')
having count(*) > 0
union all
select 'PostgreSQL version', '17 (tested on 17.11)', current_setting('server_version'), 'no'
 where current_setting('server_version_num')::int / 10000 <> 17
order by 1;

-- ── QUERY 2: what the new keys would carry, as counts ───────────────────────
-- Nothing here stops the migration. It counts rows; it reads no name, no
-- text and no grade. Read it before deciding: it says how much of what
-- teachers have typed would become readable by students once the edge
-- function passes the new keys on (until then no phone is sent any of it).
--   classes_with_page_on        classes whose students can open a page now
--   their_teachers_unnamed      of those classes, how many have a teacher with
--                               no display name: teacher_name is null there
--   descriptions                assessments with something in Description
--   descriptions_page_on        of them, in a class whose page is on: what a
--                               student of that class could read. If a
--                               teacher has used the box for notes to
--                               themselves, this is where it shows.
--   in_a_category               assessments filed under a category
--   percent_shown               of them, how many would carry a percent
--   classes_weights_not_100     classes with categories whose weights do not
--                               total 100: no percent is sent for them,
--                               except 0 for a category that weighs 0
--   in_a_module                 assessments filed under a module
--   with_core_competencies      assessments linked to a Core Competency
--   competencies_with_i_can     competencies on a class with an I Can statement
--   competencies_without        and without one
--   criteria_with_competencies  rubric rows linked to a competency
--   links_across_classes        an assessment pointing at another class's
--                               category or module, or a rubric row at another
--                               class's competency. Expected 0; the new lines
--                               send nothing for one.
--   live_sessions               phones signed in right now. None is signed
--                               out by the apply.
select
  (select count(*) from public.course where student_page_enabled and deleted_at is null) as classes_with_page_on,
  (select count(*) from public.course c join public.teacher t on t.id = c.teacher_id
    where c.student_page_enabled and c.deleted_at is null and nullif(t.display_name, '') is null) as their_teachers_unnamed,
  (select count(*) from public.assessment where nullif(description, '') is not null) as descriptions,
  (select count(*) from public.assessment a join public.course c on c.id = a.course_id
    where nullif(a.description, '') is not null and c.student_page_enabled and c.deleted_at is null) as descriptions_page_on,
  (select count(*) from public.assessment where category_id is not null) as in_a_category,
  (select count(*) from public.assessment a join public.category k on k.id = a.category_id and k.course_id = a.course_id
     join public.course c on c.id = a.course_id
    where a.score_mode <> 'dibels'
      and (k.weight = 0 or (c.grading_system in ('letter', 'both')
                            and (select sum(w.weight) from public.category w where w.course_id = c.id) = 100))) as percent_shown,
  (select count(*) from (select course_id from public.category group by course_id having sum(weight) <> 100) x) as classes_weights_not_100,
  (select count(*) from public.assessment where module_id is not null) as in_a_module,
  (select count(*) from public.assessment where core_competency_ids <> '{}') as with_core_competencies,
  (select count(*) from public.tag t join public.section s on s.id = t.section_id
    where s.removed_at is null and t.i_can_statements <> '{}') as competencies_with_i_can,
  (select count(*) from public.tag t join public.section s on s.id = t.section_id
    where s.removed_at is null and t.i_can_statements = '{}') as competencies_without,
  (select count(distinct criterion_id) from public.criterion_tag) as criteria_with_competencies,
  (select count(*) from public.assessment a join public.category k on k.id = a.category_id where k.course_id <> a.course_id)
  + (select count(*) from public.assessment a join public.module m on m.id = a.module_id where m.course_id <> a.course_id)
  + (select count(*) from public.criterion_tag x join public.criterion cr on cr.id = x.criterion_id join public.rubric r on r.id = cr.rubric_id
       join public.tag t on t.id = x.tag_id join public.section s on s.id = t.section_id where s.course_id <> r.course_id) as links_across_classes,
  (select count(*) from student_submit.device_session where expires_at > now()) as live_sessions;
