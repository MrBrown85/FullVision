-- Read-only pre-check, before the apply for migrations/2026111720_student_page_per_student.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready.
with want(sig, md5) as (values
    -- The four the file patches, as live has them before it.
    ('student_submit._card_refusal(uuid)', 'cb88af0a6bf62c22ff6c636b291b1a25'),
    ('student_submit._session_classes(uuid)', '35e766379278258651709e73b9f05940'),
    ('student_submit.page(text,uuid,text)', 'b2781abd6d579e3dc72b3f5f801bb917'),
    ('student_submit.feedback(text,uuid,text)', 'e093fd549255e5f938491066a5e2ea1c'),
    -- What the file relies on, unchanged.
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_lookup(text,text,text)', 'b35a926e60a39330f8851d368acec7e6'),
    ('student_submit._send_session(text,uuid)', 'c39242f54850eeeada19945ac8123644')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('set_student_page_options', 'list_student_page_options')
    union all
    select 'already there: column public.enrollment.' || a.attname, format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
     where a.attrelid = 'public.enrollment'::regclass and not a.attisdropped
       and a.attname in ('show_overall_grade', 'page_paused_at')
    union all
    -- The columns the new functions read.
    select 'public.' || c.tbl || '.' || c.col, 'absent or another type'
      from (values ('enrollment', 'id', 'uuid'), ('enrollment', 'course_id', 'uuid'), ('enrollment', 'roster_position', 'integer'),
                   ('enrollment', 'withdrawn_at', 'timestamp with time zone'), ('enrollment', 'updated_at', 'timestamp with time zone'),
                   ('course', 'show_my_learning', 'boolean'), ('course', 'student_page_enabled', 'boolean')) c(tbl, col, typ)
     where not exists (select 1 from pg_attribute a where a.attrelid = ('public.' || c.tbl)::regclass and a.attname = c.col
                         and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = c.typ)
    union all
    -- The trigger that tells the teacher's other device the class changed.
    select 'trigger course_sync_cursor_enrollment_gradebook on public.enrollment', 'absent or disabled'
     where not exists (select 1 from pg_trigger where tgrelid = 'public.enrollment'::regclass
                         and tgname = 'course_sync_cursor_enrollment_gradebook' and tgenabled = 'O')
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by 1;
