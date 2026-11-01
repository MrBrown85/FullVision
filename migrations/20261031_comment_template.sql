-- A teacher's own comment sentences (Generate plan, PR 10).
--
-- What is needed: after a class's comments are approved, "Suggested for Your
-- Bank" offers sentences from them with the student's details swapped for
-- slots ("Amelia → student’s name"). The ones the teacher keeps become that
-- teacher's personal bank: they rank above the shared bank when their
-- condition holds and show as "Yours" in Browse Sentences, in every class and
-- on every device. Nothing stores them today.
--
-- What it adds:
--   comment_template(id, teacher_id, text, slots, condition, uses,
--     created_at, updated_at): one row per kept sentence.
--       text       the template with slot markers, 1–400 characters (the
--                  client's filters already hold it to 6–20 words)
--       slots      jsonb array of the slot names the text uses
--       condition  jsonb object: the facts that were true when it was kept
--       uses       how many approved comments have used it
--     Unique per teacher by text (case and outer spaces ignored). No student,
--     enrollment or course column: a template belongs to the teacher only,
--     and the client's filters keep names out of the text.
--   RLS: a teacher reads and writes only rows where teacher_id is theirs.
--   save_comment_template(p_text, p_slots, p_condition, p_id, p_uses,
--     p_idempotency_key): inserts, or updates the teacher's row p_id; with no
--     p_id an existing row with the same text takes the new slots and
--     condition. p_uses null keeps the count. Returns the row as jsonb.
--   delete_comment_template(p_id, p_idempotency_key): deletes the teacher's
--     row; returns {id, deleted: true}.
--   list_comment_templates(): the teacher's rows, most used first.
-- Both writes are idempotent by key through fv_idem_check (rule 7). All three
-- are SECURITY INVOKER behind RLS, like the report_template library.
--
-- Why a list RPC and not get_class_bundle: the bank is the teacher's, not a
-- class's, like report_template (list_report_templates). The bundle is per
-- class and cached by course_sync_cursor version; carrying the bank there
-- would need a teacher-wide cursor trigger (as observation_template has),
-- so every kept sentence would force a full bundle reload in every class.
-- The bank is only read on the review screen, so one small call there is
-- enough.
-- No data changes: a new, empty table.

begin;

create table if not exists public.comment_template (
  id          uuid        primary key default gen_random_uuid(),
  teacher_id  uuid        not null references public.teacher(id) on delete cascade,
  text        text        not null check (char_length(btrim(text)) between 1 and 400),
  slots       jsonb       not null default '[]'::jsonb check (jsonb_typeof(slots) = 'array'),
  condition   jsonb       not null default '{}'::jsonb check (jsonb_typeof(condition) = 'object'),
  uses        integer     not null default 0 check (uses >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists comment_template_teacher_text
  on public.comment_template (teacher_id, lower(btrim(text)));

alter table public.comment_template enable row level security;

drop policy if exists comment_template_self on public.comment_template;
create policy comment_template_self on public.comment_template
  for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

-- ── save_comment_template ─────────────────────────────────────────────────
create or replace function public.save_comment_template(
    p_text text,
    p_slots jsonb default '[]'::jsonb,
    p_condition jsonb default '{}'::jsonb,
    p_id uuid default null,
    p_uses integer default null,
    p_idempotency_key uuid default null
) returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _row    comment_template%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'save_comment_template');
    if _cached is not null then
        return _cached;
    end if;

    if p_uses is not null and p_uses < 0 then
        raise exception 'uses must be 0 or more' using errcode = '22023';
    end if;

    if p_id is not null then
        update comment_template
           set text = btrim(p_text),
               slots = coalesce(p_slots, '[]'::jsonb),
               condition = coalesce(p_condition, '{}'::jsonb),
               uses = coalesce(p_uses, uses),
               updated_at = now()
         where id = p_id and teacher_id = (select auth.uid())
        returning * into _row;
        if not found then
            raise exception 'comment template not found' using errcode = 'P0002';
        end if;
    else
        insert into comment_template (teacher_id, text, slots, condition, uses)
        values ((select auth.uid()), btrim(p_text), coalesce(p_slots, '[]'::jsonb),
                coalesce(p_condition, '{}'::jsonb), coalesce(p_uses, 0))
        on conflict (teacher_id, lower(btrim(text))) do update
           set slots = excluded.slots,
               condition = excluded.condition,
               uses = coalesce(p_uses, comment_template.uses),
               updated_at = now()
        returning * into _row;
    end if;

    _cached := to_jsonb(_row);
    perform fv_idem_store(p_idempotency_key, 'save_comment_template', _cached);
    return _cached;
end;
$function$;

revoke all on function public.save_comment_template(text, jsonb, jsonb, uuid, integer, uuid) from public, anon;
grant execute on function public.save_comment_template(text, jsonb, jsonb, uuid, integer, uuid) to authenticated, service_role;

-- ── list_comment_templates ────────────────────────────────────────────────
create or replace function public.list_comment_templates()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
    select coalesce(jsonb_agg(to_jsonb(t) order by t.uses desc, t.created_at, t.id), '[]'::jsonb)
      from comment_template t
     where t.teacher_id = (select auth.uid());
$function$;

revoke all on function public.list_comment_templates() from public, anon;
grant execute on function public.list_comment_templates() to authenticated, service_role;

-- ── delete_comment_template ───────────────────────────────────────────────
create or replace function public.delete_comment_template(p_id uuid, p_idempotency_key uuid default null)
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

    _cached := fv_idem_check(p_idempotency_key, 'delete_comment_template');
    if _cached is not null then
        return _cached;
    end if;

    delete from comment_template where id = p_id and teacher_id = (select auth.uid());
    if not found then
        raise exception 'comment template not found' using errcode = 'P0002';
    end if;

    _result := jsonb_build_object('id', p_id, 'deleted', true);
    perform fv_idem_store(p_idempotency_key, 'delete_comment_template', _result);
    return _result;
end;
$function$;

revoke all on function public.delete_comment_template(uuid, uuid) from public, anon;
grant execute on function public.delete_comment_template(uuid, uuid) to authenticated, service_role;

commit;
