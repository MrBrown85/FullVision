-- Read-only pre-check, before the apply for migrations/2026111807_quizzes_student_list.sql (2026-11-18).
-- Run it after 2026111806 (MQ2) is applied. SELECTs only, catalog facts only (no row of any table is read).
-- It returns ONLY the rows that differ from what the file was written and tested against: no rows means
-- ready. Run it with public on the search path (as Supabase's SQL editor does): an md5 of
-- pg_get_functiondef depends on it.
with want(sig, md5) as (values
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527')),
tabs(t, cols) as (values
    ('public.quiz', 'assessment_id uuid, shuffle_questions boolean, shuffle_choices boolean, tries smallint, counts text, shows text, add_total boolean, after_due text, accept_until date, created_at timestamp with time zone, updated_at timestamp with time zone'),
    ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname = 'quiz_list'
    union all
    select 'MQ1: ' || t.t || ' columns', coalesce((select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
                                                  from pg_attribute where attrelid = to_regclass(t.t) and attnum > 0 and not attisdropped), 'absent')
      from tabs t
     where (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
              from pg_attribute where attrelid = to_regclass(t.t) and attnum > 0 and not attisdropped) is distinct from t.cols
    union all
    select 'the edge function''s role may use the schema student_submit', 'no'
     where not has_schema_privilege('service_role', 'student_submit', 'usage')
    union all
    -- Run as the role that will apply the file (postgres on Supabase): it must own these and may create in the schema.
    select 'the role running this owns student_submit._session_class and the quiz tables, and may create in student_submit', current_user::text
     where (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = to_regclass('public.quiz_attempt')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = to_regclass('public.quiz')) is distinct from (select oid from pg_roles where rolname = current_user)
        or not has_schema_privilege('student_submit', 'create')
    union all
    -- Guards the route the files are sent by: it must hand PostgreSQL the text as written. The tool that
    -- sends a migration was measured turning a backslash, u and four hex digits into the character itself;
    -- a backslash before x or before another backslash must arrive untouched (4 characters each, with
    -- standard_conforming_strings on, as on live). A row here means the route changes text: do not apply.
    select 'the route keeps backslashes as written', 'length of the two test strings: ' || length('\x41') || ', ' || length('a\\b')
     where length('\x41') <> 4 or length('a\\b') <> 4
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by check_name collate "C";
