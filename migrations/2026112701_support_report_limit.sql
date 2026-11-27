-- A cap on support reports, and a fixed search path for the two nightly jobs (2026-11-27).
--
-- THIS FILE DELETES NOTHING and changes no grade, score or student row.
--
-- Why (the function audit of 2026-11-27):
--
-- 1. submit_support_report (Report a Problem) had no limit, so any signed-in
--    account could fill public.support_report with as many rows as it liked.
--    It now refuses an eleventh report from the same teacher within an hour
--    (errcode 54000, "too many reports"). A retry of a report already sent,
--    with the same idempotency key, still returns that report: the cap is
--    checked after the cached answer. Teachers cannot insert into the table
--    directly (no grant), so the function is the only way in.
--    Live, before this change (2026-11-27): no report has ever been sent
--    (0 rows), so the cap stops no one today (see the pre-check below).
--
-- 2. grade_return_repair_nightly and photo_lifecycle_nightly are the only
--    routines in public without a fixed search path (Supabase's security
--    advisor, lint 0011). Both run from cron as the database owner and are
--    revoked from public, so no user can call them; they now name the same
--    path as every other routine ('public', 'pg_temp'), the one they already
--    ran with. Their bodies do not change.
--
-- Pre-check, run read-only on live before applying (most reports any teacher
-- sent within one hour, ever):
--   select coalesce(max(n), 0) from (
--     select count(*) as n from public.support_report a
--       join public.support_report b on b.teacher_id = a.teacher_id
--        and b.created_at > a.created_at - interval '1 hour' and b.created_at <= a.created_at
--     group by a.id) x;
--
-- Undo: migrations/local-test/support-report-limit-undo.sql puts the old
-- function back exactly and resets the two search paths.

begin;

set local lock_timeout = '5s';

-- Stop with nothing changed unless live is what this file was written against.
do $$
begin
  if md5(pg_get_functiondef('public.submit_support_report(text, text, text, text, uuid)'::regprocedure))
       is distinct from 'd417bb92da948ecbb0001c33cc18620a' then
    raise exception 'support_report_limit: submit_support_report is not the expected version; nothing changed';
  end if;
  if to_regprocedure('public.grade_return_repair_nightly()') is null
     or to_regprocedure('public.photo_lifecycle_nightly()') is null then
    raise exception 'support_report_limit: a nightly procedure is missing; nothing changed';
  end if;
end
$$;

create or replace function public.submit_support_report(p_page text, p_message text, p_browser text default null::text, p_app_version text default null::text, p_idempotency_key uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

    -- At most 10 reports from one teacher in any hour (2026112701).
    if (select count(*) from public.support_report r
         where r.teacher_id = _uid and r.created_at > now() - interval '1 hour') >= 10 then
        raise exception 'too many reports' using errcode = '54000';
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

alter procedure public.grade_return_repair_nightly() set search_path to 'public', 'pg_temp';
alter procedure public.photo_lifecycle_nightly() set search_path to 'public', 'pg_temp';

commit;
