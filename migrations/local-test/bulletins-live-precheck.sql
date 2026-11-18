-- Read-only pre-check, before the apply of migrations/2026111801_bulletins.sql (2026-11-17).
-- SELECTs only, catalog facts only (no row of any table is read but storage.buckets' one bucket id
-- and a count of files under that id). It returns ONLY the rows that differ from what the file was
-- written and tested against: no rows means ready. Run it with public on the search path (as
-- Supabase's SQL editor does): an md5 of pg_get_functiondef depends on it.
with relied(sig, md5) as (values
    ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527')),
cols(tbl, col, typ) as (values
    ('public.course', 'id', 'uuid'), ('public.course', 'teacher_id', 'uuid'), ('public.course', 'timezone', 'text'),
    ('public.course', 'deleted_at', 'timestamp with time zone'), ('public.course', 'student_page_enabled', 'boolean'),
    ('public.enrollment', 'id', 'uuid'), ('public.enrollment', 'course_id', 'uuid'), ('public.enrollment', 'roster_position', 'integer'),
    ('public.enrollment', 'withdrawn_at', 'timestamp with time zone'), ('public.enrollment', 'page_paused_at', 'timestamp with time zone'),
    ('public.student_card', 'enrollment_id', 'uuid'), ('public.student_card', 'stopped_at', 'timestamp with time zone'),
    ('public.student_card', 'works_until', 'date'),
    ('public.assessment', 'id', 'uuid'), ('public.assessment', 'course_id', 'uuid'),
    ('public.submission_file_removal', 'bucket', 'text'), ('public.submission_file_removal', 'path', 'text'),
    ('public.submission_file_removal', 'course_id', 'uuid'), ('public.submission_file_removal', 'reason', 'text'),
    ('public.submission_file_removal', 'link_dies_at', 'timestamp with time zone'),
    ('storage.buckets', 'id', 'text'), ('storage.buckets', 'name', 'text'), ('storage.buckets', 'public', 'boolean'),
    ('storage.buckets', 'file_size_limit', 'bigint'), ('storage.buckets', 'allowed_mime_types', 'text[]'),
    ('storage.objects', 'bucket_id', 'text'), ('storage.objects', 'name', 'text'), ('storage.objects', 'metadata', 'jsonb'),
    ('storage.objects', 'archived_at', 'timestamp with time zone'), ('storage.objects', 'is_delete_marker', 'boolean')),
checks(check_name, value) as (
    select 'fingerprint ' || r.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(r.sig))), 'absent')
      from relied r where md5(pg_get_functiondef(to_regprocedure(r.sig))) is distinct from r.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname ~ 'bulletin'
    union all
    select 'already there: table ' || c.oid::regclass::text, 'present'
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname ~ '^bulletin'
    union all
    select 'already there: bucket bulletin-files', 'present' where exists (select 1 from storage.buckets where id = 'bulletin-files')
    union all
    select 'files under bucket id bulletin-files', count(*)::text from storage.objects where bucket_id = 'bulletin-files' having count(*) > 0
    union all
    select 'column ' || c.tbl || '.' || c.col, 'absent or not ' || c.typ
      from cols c
     where not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(c.tbl) and a.attname = c.col
                         and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = c.typ)
    union all
    select 'unique (bucket, path) on public.submission_file_removal', 'absent'
     where not exists (select 1 from pg_constraint where conrelid = 'public.submission_file_removal'::regclass and contype = 'u'
                         and pg_get_constraintdef(oid) = 'UNIQUE (bucket, path)')
    union all
    select 'the policies on storage.objects', coalesce(string_agg(polname, ', ' order by polname collate "C"), 'none')
      from pg_policy where polrelid = 'storage.objects'::regclass
    having coalesce(string_agg(polname, ', ' order by polname collate "C"), '') <> 'fv_handout_files_fence, fv_handout_files_read, fv_handout_files_teachers_only, fv_handout_files_upload, fv_handouts_read, fv_handouts_upload, fv_student_photos_fence, fv_student_photos_read, fv_student_photos_teachers_only, fv_student_photos_upload'
    union all
    select 'row security on storage.objects', 'off' where not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass)
    union all
    select 'the schema fv_private', 'absent' where to_regnamespace('fv_private') is null
    union all
    select 'authenticated may use the schema fv_private', 'no' where not has_schema_privilege('authenticated', 'fv_private', 'usage')
    union all
    -- The route the file is sent through must hand PostgreSQL the text as written: one backslash kept
    -- as one character, two kept as two. (On Nov 18 it turned each backslash, small u and four hex
    -- digits into the real character, which changed a function's text. This row has none of those.)
    select 'the apply route changes backslashes', length('\x41') || ' ' || length('a\\b')
     where length('\x41') <> 4 or length('a\\b') <> 4
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by 1;
