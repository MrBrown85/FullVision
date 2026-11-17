-- Read-only post-check, after the apply for migrations/2026111704_photos_stay_with_class.sql (2026-11-17).
-- SELECTs only. Every row says ok. The counts read how many classes there are, never what they hold.
with want(sig, after_md5) as (values
    ('public._photo_keep_class(uuid,timestamptz)', '67d1ae88eeacd34543cc0a80f1055991'),
    ('public.note_course_opened(uuid,uuid)', '0c9431bb6ff130f8de2715f8315838f1'),
    ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26'),
    ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39'),
    ('public.set_course_send_work(uuid,jsonb,uuid)', '694863746b03f4be25263a5107f5b02e'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'table public.course_opened: course_id uuid, last_opened_at timestamptz, row security on',
       case when (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attnum)
                    from pg_attribute where attrelid = 'public.course_opened'::regclass and attnum > 0 and not attisdropped)
                 = 'course_id uuid, last_opened_at timestamp with time zone'
             and (select relrowsecurity from pg_class where oid = 'public.course_opened'::regclass) then 'ok' else 'NOT AS EXPECTED' end
union all select 'its key goes with the class (on delete cascade)',
       case when exists (select 1 from pg_constraint where conrelid = 'public.course_opened'::regclass and contype = 'f'
                           and confrelid = 'public.course'::regclass and confdeltype = 'c' and convalidated) then 'ok' else 'NOT AS EXPECTED' end
union all select 'no client role may read or write the table',
       case when not has_table_privilege('anon', 'public.course_opened', 'select,insert,update,delete')
             and not has_table_privilege('authenticated', 'public.course_opened', 'select,insert,update,delete') then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher may run note_course_opened; a visitor may not',
       case when has_function_privilege('authenticated', 'public.note_course_opened(uuid,uuid)', 'execute')
             and not has_function_privilege('anon', 'public.note_course_opened(uuid,uuid)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'every class has a stamp (' || (select count(*) from public.course) || ' classes)',
       case when not exists (select 1 from public.course c where not exists (select 1 from public.course_opened o where o.course_id = c.id))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'no class is due tonight (none unopened for 365 days)',
       case when not exists (select 1 from public.course c join public.course_opened o on o.course_id = c.id
                              where c.deleted_at is null and greatest(o.last_opened_at, c.created_at) < now() - interval '365 days')
            then 'ok' else 'NOT AS EXPECTED' end;
