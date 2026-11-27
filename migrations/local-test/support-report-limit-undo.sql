-- Undo for migrations/2026112701_support_report_limit.sql: puts back
-- submit_support_report exactly as it was (no cap) and resets the two
-- nightly procedures' search path. Deletes nothing.

begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.submit_support_report(p_page text, p_message text, p_browser text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _uid    uuid := (select auth.uid());
    _cached jsonb;
    _id     uuid;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    if p_message is null or btrim(p_message) = '' then
        raise exception 'message is required' using errcode = '22023';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'submit_support_report');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    insert into public.support_report (teacher_id, page, message, browser, app_version)
    values (
        _uid,
        left(coalesce(p_page, ''), 200),
        left(p_message, 5000),
        left(p_browser, 300),
        left(p_app_version, 100)
    )
    returning id into _id;

    perform fv_idem_store(p_idempotency_key, 'submit_support_report', jsonb_build_object('id', _id));
    return _id;
end;
$function$;

alter procedure public.grade_return_repair_nightly() reset search_path;
alter procedure public.photo_lifecycle_nightly() reset search_path;

commit;
