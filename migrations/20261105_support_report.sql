-- Report a Problem (2026-11-05).
--
-- The Help panel and the account menu open a Report a Problem form
-- (onboarding plan C5). A teacher describes the problem; the form attaches
-- the page's name, the app's build and the browser, and never student data.
-- Reports are read by the developer from the database, not by teachers.
--
-- What it adds:
--   support_report(id, teacher_id, page, message, browser, app_version,
--     created_at): one row per report. teacher_id is the signed-in teacher.
--   submit_support_report(p_page, p_message, p_browser, p_app_version,
--     p_idempotency_key): inserts one row for auth.uid() and returns its id.
--     Idempotent through fv_idem_check / fv_idem_store (CLAUDE.md rule 7),
--     so an outbox retry of a report that already landed returns the same id.
--
-- Access: teachers have no table privileges at all; the only way in is the
-- RPC, as for every write. RLS is on with an insert-own policy
-- (teacher_id = auth.uid()) as a backstop, and no select, update or delete
-- policy, so no path lets a teacher read a report back, theirs or anyone's.
-- anon has no table or function access. The RPC is SECURITY DEFINER because
-- the caller has no table privileges; it sets teacher_id from auth.uid()
-- itself and pins search_path.
-- Lengths are capped so a report can't be used to store bulk data.
-- Retention: rows go when the teacher's account is deleted (cascade).
--
-- Tested on a throwaway local Postgres 17 (PGlite) on top of
-- migrations/local-test/harness.sql, never on gradebook-prod: 22 checks as
-- Teacher A, Teacher B, no JWT and anon (submit, idempotent retry, no read,
-- update, delete or direct insert, no insert as another teacher, empty and
-- over-long fields, security definer with a pinned search_path, RLS on).

create table if not exists public.support_report (
  id           uuid        primary key default gen_random_uuid(),
  teacher_id   uuid        not null default auth.uid() references public.teacher(id) on delete cascade,
  page         text        not null default '' check (char_length(page) <= 200),
  message      text        not null check (char_length(message) <= 5000 and btrim(message) <> ''),
  browser      text        check (char_length(browser) <= 300),
  app_version  text        check (char_length(app_version) <= 100),
  created_at   timestamptz not null default now()
);

create index if not exists support_report_created_at_idx on public.support_report (created_at desc);

comment on table public.support_report is
  'Report a Problem: one row per report from a signed-in teacher. Teachers can insert their own rows and read none.';

alter table public.support_report enable row level security;

drop policy if exists support_report_insert_own on public.support_report;
create policy support_report_insert_own on public.support_report
  for insert to authenticated
  with check (teacher_id = (select auth.uid()));

revoke all on table public.support_report from public, anon, authenticated;

-- ── submit_support_report ─────────────────────────────────────────────────
create or replace function public.submit_support_report(
    p_page             text,
    p_message          text,
    p_browser          text default null,
    p_app_version      text default null,
    p_idempotency_key  uuid default null
) returns uuid
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

revoke all on function public.submit_support_report(text, text, text, text, uuid) from public, anon;
grant execute on function public.submit_support_report(text, text, text, text, uuid) to authenticated;
