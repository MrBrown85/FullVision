-- Read-only pre-check, before the apply of migrations/2026111804_quizzes.sql and 2026111805_quiz_results.sql
-- (2026-11-17). SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that
-- differ from what the files were written and tested against: no rows means ready for both.
with want(sig, md5) as (values
    -- What the files rely on, unchanged.
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626')),
cols(tbl, col, typ) as (values
    -- The columns the functions and triggers read.
    ('public.assessment', 'id', 'uuid'), ('public.assessment', 'course_id', 'uuid'), ('public.assessment', 'score_mode', 'text'),
    ('public.assessment', 'collab_mode', 'text'), ('public.assessment', 'is_draft', 'boolean'),
    ('public.enrollment', 'id', 'uuid'), ('public.enrollment', 'course_id', 'uuid'),
    ('public.enrollment', 'roster_position', 'integer'), ('public.enrollment', 'withdrawn_at', 'timestamp with time zone'),
    ('public.assessment_tag', 'assessment_id', 'uuid'), ('public.assessment_tag', 'tag_id', 'uuid')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('list_quiz', 'save_quiz', 'list_quiz_tries', 'quiz_json', '_quiz_draft_guard', '_quiz_tag_gone',
                                         '_quiz_attempt_same_class', 'mark_quiz_answer', 'reopen_quiz', 'confirm_quiz')
    union all
    select 'already there: table ' || t, 'present'
      from unnest(array['public.quiz', 'public.quiz_question', 'public.quiz_key', 'public.quiz_attempt', 'public.quiz_answer']) t
     where to_regclass(t) is not null
    union all
    select 'already there: trigger ' || t.tgname, 'present'
      from pg_trigger t where t.tgname in ('assessment_quiz_draft_guard', 'quiz_tag_gone', 'quiz_attempt_same_class')
    union all
    select 'the schema fv_private', 'absent'
     where to_regnamespace('fv_private') is null
    union all
    select c.tbl || '.' || c.col, 'absent or another type'
      from cols c
     where not exists (select 1 from pg_attribute a where a.attrelid = c.tbl::regclass and a.attname = c.col
                         and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = c.typ)
    union all
    -- The existing Unassign guard, whose word (draft_has_work) the quiz's own raises; it is not changed.
    select 'trigger assessment_draft_guard on public.assessment', 'absent'
     where not exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and tgname = 'assessment_draft_guard')
    union all
    -- apply_migration runs as postgres, which on Supabase is not a superuser: it must be able to add the keys and
    -- triggers, and the functions it will own must be able to read and lock these rows.
    select 'the role applying it may not reference, add a trigger to, read or lock ' || t, current_user::text
      from unnest(array['public.assessment', 'public.enrollment', 'public.assessment_tag']) t
     where not (has_table_privilege(current_user, t, 'REFERENCES') and has_table_privilege(current_user, t, 'TRIGGER')
                and has_table_privilege(current_user, t, 'SELECT') and has_table_privilege(current_user, t, 'UPDATE'))
    union all
    select 'the role applying it may not create in schema ' || n, current_user::text
      from unnest(array['public', 'fv_private']) n
     where to_regnamespace(n) is not null and not has_schema_privilege(current_user, n, 'CREATE')
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by check_name collate "C";
