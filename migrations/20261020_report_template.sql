-- A teacher's library of report forms (2026-10-20).
--
-- Edit Layout saves a class's form to "Your Library" so another class can
-- use it. Today the library is localStorage on one device
-- (gb-report-templates). This table makes it the teacher's, on every device.
--
-- What it adds:
--   report_template(id, teacher_id, name, form jsonb, created_at, updated_at),
--   one row per saved form, unique by name per teacher (case-insensitive).
--   save_report_template(p_name, p_form, p_id, p_idempotency_key) inserts, or
--   updates the row p_id when it is the teacher's; returns the row as jsonb.
--   list_report_templates() returns the teacher's forms, newest first.
--   delete_report_template(p_id, p_idempotency_key) deletes the teacher's row.
--
-- The form's shape is checked only loosely here (an object with a front
-- array); the client's ReportSheets.normalizeForm makes any saved form whole
-- on read, as it does for report_config.blocks_config. All three RPCs are
-- SECURITY INVOKER behind RLS on teacher_id.

create table if not exists public.report_template (
  id          uuid        primary key default gen_random_uuid(),
  teacher_id  uuid        not null references public.teacher(id) on delete cascade,
  name        text        not null check (char_length(btrim(name)) between 1 and 60),
  form        jsonb       not null check (jsonb_typeof(form) = 'object' and coalesce(jsonb_typeof(form->'front'), '') = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists report_template_teacher_name
  on public.report_template (teacher_id, lower(btrim(name)));

alter table public.report_template enable row level security;

drop policy if exists report_template_self on public.report_template;
create policy report_template_self on public.report_template
  for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

-- ── save_report_template ─────────────────────────────────────────────────
create or replace function public.save_report_template(
    p_name text, p_form jsonb, p_id uuid default null, p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _row    report_template%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'save_report_template');
    if _cached is not null then
        return _cached;
    end if;

    if p_id is not null then
        update report_template
           set name = btrim(p_name), form = p_form, updated_at = now()
         where id = p_id and teacher_id = (select auth.uid())
        returning * into _row;
        if not found then
            raise exception 'report template not found' using errcode = 'P0002';
        end if;
    else
        insert into report_template (teacher_id, name, form)
        values ((select auth.uid()), btrim(p_name), p_form)
        on conflict (teacher_id, lower(btrim(name))) do update
           set form = excluded.form, updated_at = now()
        returning * into _row;
    end if;

    _cached := to_jsonb(_row);
    perform fv_idem_store(p_idempotency_key, 'save_report_template', _cached);
    return _cached;
end;
$function$;

revoke all on function public.save_report_template(text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.save_report_template(text, jsonb, uuid, uuid) to authenticated;

-- ── list_report_templates ────────────────────────────────────────────────
create or replace function public.list_report_templates()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
    select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb)
      from report_template t
     where t.teacher_id = (select auth.uid());
$function$;

revoke all on function public.list_report_templates() from public, anon;
grant execute on function public.list_report_templates() to authenticated;

-- ── delete_report_template ───────────────────────────────────────────────
create or replace function public.delete_report_template(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'delete_report_template');
    if _cached is not null then
        return _cached;
    end if;

    delete from report_template where id = p_id and teacher_id = (select auth.uid());
    if not found then
        raise exception 'report template not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_report_template', _result);
    return _result;
end;
$function$;

revoke all on function public.delete_report_template(uuid, uuid) from public, anon;
grant execute on function public.delete_report_template(uuid, uuid) to authenticated;
