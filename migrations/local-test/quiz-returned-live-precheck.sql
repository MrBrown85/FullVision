-- Read-only pre-check, before the apply for migrations/2026112407_quiz_returned.sql (2026-11-24).
-- Run it after 2026111807. SELECTs only, catalog facts only (no row of any table is read).
-- It returns ONLY the rows that differ from what the file was written and tested against: no rows means
-- ready. Run it with public on the search path (as Supabase's SQL editor does): an md5 of
-- pg_get_functiondef depends on it.
with want(sig, md5) as (values
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', '86d4747f0dd055fa4a61945046ca64d3'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
    ('student_submit._quiz_questions(uuid,jsonb)', '774274b707ad660b1d3f2d023edf13be'),
    ('student_submit._returned_grade(uuid,uuid)', '21706ae9eec783107d9da24e52e1855a'),
    ('student_submit.quiz(text,uuid,uuid,text,boolean)', '0746b4af4f1cadd75b86cc20f49931d3'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('public._grade_copy(uuid,uuid)', '3a8e0dfbc873176692a1160150a8d43b'),
    ('public._grade_copy_in_use(jsonb,uuid)', 'befe9f034ce927b2abdf8c8825c402bd'),
    ('public._grade_return_holds(uuid)', '51d6525109333424405e826bbc303b90'),
    ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)', '89899f9dbc1569f7f1cc4216e252eb32'),
    ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689'),
    ('public._grade_return_release()', '81222b025ca3625612b1bcd3ff9e2431'),
    ('public.confirm_quiz(uuid,jsonb,uuid)', 'ee23f2910b1484f18a41ea76b08f0846')),
tabs(t, cols) as (values
    ('public.quiz', 'assessment_id uuid, shuffle_questions boolean, shuffle_choices boolean, tries smallint, counts text, shows text, add_total boolean, after_due text, accept_until date, created_at timestamp with time zone, updated_at timestamp with time zone'),
    ('public.quiz_attempt', 'id uuid, assessment_id uuid, enrollment_id uuid, try integer, question_order jsonb, started_at timestamp with time zone, sent_at timestamp with time zone, reopened_at timestamp with time zone, marked jsonb, marked_at timestamp with time zone, created_at timestamp with time zone'),
    ('public.quiz_key', 'question_id uuid, answer jsonb, tolerance numeric, why text'),
    ('public.quiz_answer', 'attempt_id uuid, question_id uuid, assessment_id uuid, answer jsonb, saved_at timestamp with time zone, given_points numeric, note text')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname = 'quiz_result'
    union all
    select 'MQ1: ' || t.t || ' columns', coalesce((select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
                                                  from pg_attribute where attrelid = to_regclass(t.t) and attnum > 0 and not attisdropped), 'absent')
      from tabs t
     where (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
              from pg_attribute where attrelid = to_regclass(t.t) and attnum > 0 and not attisdropped) is distinct from t.cols
    union all
    select 'public.grade_return: the four columns read', coalesce((select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
                                                                     from pg_attribute where attrelid = to_regclass('public.grade_return') and attnum > 0 and not attisdropped
                                                                      and attname in ('enrollment_id', 'assessment_id', 'is_draft', 'returned_at')), 'absent')
     where (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
              from pg_attribute where attrelid = to_regclass('public.grade_return') and attnum > 0 and not attisdropped
               and attname in ('enrollment_id', 'assessment_id', 'is_draft', 'returned_at'))
           is distinct from 'enrollment_id uuid, assessment_id uuid, is_draft boolean, returned_at timestamp with time zone'
    union all
    -- Before the file, no student_submit function names the answer key (MQ2 and MQ2b hold to this).
    select 'a student_submit function already names quiz_key: ' || p.oid::regprocedure::text, 'present'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'student_submit' and p.proname <> 'quiz_result'
       and strpos(case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end, 'quiz_key') > 0
    union all
    select 'the edge function''s role may use the schema student_submit', 'no'
     where not has_schema_privilege('service_role', 'student_submit', 'usage')
    union all
    -- Run as the role that will apply the file (postgres on Supabase): it must own these and may create in the schema.
    select 'the role running this owns student_submit._session_class, _returned_grade and the quiz tables, and may create in student_submit', current_user::text
     where (select proowner from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select proowner from pg_proc where oid = to_regprocedure('student_submit._returned_grade(uuid,uuid)')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = to_regclass('public.quiz')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = to_regclass('public.quiz_attempt')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = to_regclass('public.quiz_key')) is distinct from (select oid from pg_roles where rolname = current_user)
        or (select relowner from pg_class where oid = to_regclass('public.quiz_answer')) is distinct from (select oid from pg_roles where rolname = current_user)
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
