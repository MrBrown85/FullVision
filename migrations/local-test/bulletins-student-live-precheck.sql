-- Read-only pre-check, before the apply for migrations/2026111803_bulletins_student.sql (2026-11-17).
-- Run it after 2026111801_bulletins.sql (M1) is applied: before that, the M1 rows below are named.
-- SELECTs only, catalog facts only (no row of any table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready. Run it with public on the
-- search path (as Supabase's SQL editor does): an md5 of pg_get_functiondef depends on it.
with want(sig, md5) as (values
    -- What the file relies on, unchanged.
    ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._device_session(text)', 'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e'),
    ('student_submit._write_limit(uuid,text,integer)', 'c2edfa96402a2eb7a839db3c106e11a9'),
    ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('fv_private.bulletin_file_path(uuid,uuid,integer)', '382dc77b5c162295891790d42fb13763'),
    ('fv_private.bulletin_pinned_now(boolean,date,text)', '3d68484d7051fd8f380fe2a84c401546')),
cols(tab, col, typ) as (values
    ('bulletin', 'id', 'uuid'), ('bulletin', 'course_id', 'uuid'), ('bulletin', 'kind', 'text'), ('bulletin', 'body', 'text'),
    ('bulletin', 'link_url', 'text'), ('bulletin', 'link_title', 'text'), ('bulletin', 'pinned', 'boolean'),
    ('bulletin', 'pinned_until', 'date'), ('bulletin', 'assessment_id', 'uuid'), ('bulletin', 'reactions_on', 'boolean'),
    ('bulletin', 'shown_again_at', 'timestamp with time zone'), ('bulletin', 'posted_at', 'timestamp with time zone'),
    ('bulletin', 'edited_at', 'timestamp with time zone'),
    ('bulletin_file', 'id', 'uuid'), ('bulletin_file', 'course_id', 'uuid'), ('bulletin_file', 'bulletin_id', 'uuid'),
    ('bulletin_file', 'kind', 'text'), ('bulletin_file', 'title', 'text'), ('bulletin_file', 'page_count', 'integer'),
    ('bulletin_file', 'status', 'text'), ('bulletin_file', 'position', 'integer'),
    ('bulletin_seen', 'bulletin_id', 'uuid'), ('bulletin_seen', 'enrollment_id', 'uuid'), ('bulletin_seen', 'seen_at', 'timestamp with time zone'),
    ('bulletin_reaction', 'bulletin_id', 'uuid'), ('bulletin_reaction', 'enrollment_id', 'uuid'), ('bulletin_reaction', 'word', 'text'),
    ('bulletin_reaction', 'updated_at', 'timestamp with time zone')),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p where p.proname in ('_bulletin_visible', '_bulletin_session_enrollments', 'bulletins', 'bulletin_seen', 'bulletin_react', 'bulletin_file_links')
    union all
    select 'student_submit.write_log checks', coalesce(string_agg(pg_get_constraintdef(c.oid) || ' ' || c.conname || ' ' || c.convalidated::text, ' | '), 'none')
      from pg_constraint c where c.conrelid = to_regclass('student_submit.write_log') and c.contype = 'c'
    having coalesce(string_agg(pg_get_constraintdef(c.oid) || ' ' || c.conname || ' ' || c.convalidated::text, ' | '), 'none')
           <> 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text]))) write_log_kind_check true'
    union all
    select 'M1: public.' || c.tab || '.' || c.col, 'absent or another type'
      from cols c
     where not exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || c.tab) and a.attname = c.col
                         and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = c.typ)
    union all
    select 'M1: the key (bulletin_id, enrollment_id) on bulletin_seen and bulletin_reaction', 'absent'
     where (select count(*) from pg_constraint c
             where c.contype = 'p' and c.conrelid in (to_regclass('public.bulletin_seen'), to_regclass('public.bulletin_reaction'))
               and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                     where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['bulletin_id', 'enrollment_id']) <> 2
    union all
    select 'the edge function''s role may use the schema student_submit', 'no'
     where not has_schema_privilege('service_role', 'student_submit', 'usage')
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17)
select * from checks order by 1;
