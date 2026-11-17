-- Read-only post-check, after the apply for migrations/2026111705_photo_expiry_warning.sql (2026-11-17).
-- SELECTs only, catalog facts only. Every row says ok.
with want(sig, after_md5) as (values
    ('public.list_course_photo_expiry()', '09fea36f5f757a3de2508a25f9460376'),
    ('public._course_restored_opened()', 'a345459a8b66ded92f8aad90e01b4f63'),
    ('public._photo_keep_class(uuid,timestamptz)', '67d1ae88eeacd34543cc0a80f1055991'),
    ('public.note_course_opened(uuid,uuid)', '0c9431bb6ff130f8de2715f8315838f1'),
    ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26'),
    ('public.fv_retention_cleanup()', 'a8da46d6664ba5956f4215ba3b2ada39'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'a teacher may run list_course_photo_expiry; a visitor may not',
       case when has_function_privilege('authenticated', 'public.list_course_photo_expiry()', 'execute')
             and not has_function_privilege('anon', 'public.list_course_photo_expiry()', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'nobody may call _course_restored_opened directly',
       case when not has_function_privilege('anon', 'public._course_restored_opened()', 'execute')
             and not has_function_privilege('authenticated', 'public._course_restored_opened()', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'both run as their owner with a fixed search_path',
       case when (select bool_and(prosecdef and proconfig::text = '{"search_path=public, pg_temp"}') and count(*) = 2 from pg_proc
                   where oid in (to_regprocedure('public.list_course_photo_expiry()'), to_regprocedure('public._course_restored_opened()')))
            then 'ok' else 'NOT AS EXPECTED' end
union all select 'the trigger course_restored_opened is on public.course, enabled',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.course'::regclass and tgname = 'course_restored_opened' and tgenabled = 'O'
                           and replace(pg_get_triggerdef(oid), 'FUNCTION public._course', 'FUNCTION _course') =
                               'CREATE TRIGGER course_restored_opened AFTER UPDATE OF deleted_at ON public.course FOR EACH ROW WHEN (((old.deleted_at IS NOT NULL) AND (new.deleted_at IS NULL))) EXECUTE FUNCTION _course_restored_opened()')
            then 'ok' else 'NOT AS EXPECTED' end;
