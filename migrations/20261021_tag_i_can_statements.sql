-- I Can statements, and the curriculum wording each competency started with.
--
-- A competency's I Can statements lived only in the browser: the tag table
-- had no column for them, so a class lost its statements on the next load
-- (none of the 126 saved competencies kept any, checked 2026-10-21) and the
-- report blocks and rubric drafts that print them came out empty.
-- tag.i_can_text has always held the competency's wording, despite its name,
-- and keeps that job.
--
-- source_text keeps the curriculum wording a competency was created with, so
-- the Class Management card can show that a teacher edited the wording and
-- restore the original. It is null for competencies made before this change
-- or added by hand.
--
-- upsert_tag gains two optional parameters. Null leaves the stored value
-- alone, so a browser still running the old code does not wipe statements.
-- get_class_bundle, get_learning_map and duplicate_course carry the two new
-- columns; they are patched in place so nothing else about them changes.
-- No existing data changes.

alter table public.tag
  add column if not exists i_can_statements text[] not null default '{}',
  add column if not exists source_text text;

drop function if exists public.upsert_tag(uuid, uuid, text, text, text, integer, uuid);

create function public.upsert_tag(
  p_id uuid,
  p_section_id uuid,
  p_label text,
  p_code text default null,
  p_i_can_text text default null,
  p_display_order integer default null,
  p_idempotency_key uuid default null,
  p_i_can_statements text[] default null,
  p_source_text text default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare _id uuid; _cached jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_tag');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into tag (section_id, code, label, i_can_text, i_can_statements, source_text, display_order)
        values (p_section_id, p_code, p_label, p_i_can_text, coalesce(p_i_can_statements, '{}'), p_source_text,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from tag where section_id = p_section_id)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_tag', jsonb_build_object('id', _id));
    else
        update tag set
            section_id = p_section_id, code = p_code, label = p_label,
            i_can_text = p_i_can_text,
            i_can_statements = coalesce(p_i_can_statements, i_can_statements),
            source_text = coalesce(p_source_text, source_text),
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'tag not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

revoke all on function public.upsert_tag(uuid, uuid, text, text, text, integer, uuid, text[], text) from public, anon;
grant execute on function public.upsert_tag(uuid, uuid, text, text, text, integer, uuid, text[], text) to authenticated, service_role;

-- Patch the three readers/copiers in place. Each replace must find its
-- target, or the migration stops before anything is half-changed.
do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$'i_can_text', t.i_can_text,$s$,
        $s$'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,$s$);
    if _new = _def then raise exception 'get_class_bundle: tag fields not found'; end if;
    execute _new;

    _def := pg_get_functiondef('public.get_learning_map(uuid)'::regprocedure);
    _new := replace(_def,
        $s$t.i_can_text, t.display_order,$s$,
        $s$t.i_can_text, t.i_can_statements, t.source_text, t.display_order,$s$);
    _new := replace(_new,
        $s$'i_can_text', t.i_can_text,$s$,
        $s$'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,$s$);
    if _new = _def or position('i_can_statements' in _new) = 0
       or (length(_new) - length(replace(_new, 'i_can_statements', ''))) / length('i_can_statements') < 3 then
        raise exception 'get_learning_map: tag fields not found';
    end if;
    execute _new;

    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$insert into tag (id, section_id, code, label, i_can_text, display_order)$s$,
        $s$insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, display_order)$s$);
    _new := replace(_new,
        $s$_row.code, _row.label, _row.i_can_text, _row.display_order);$s$,
        $s$_row.code, _row.label, _row.i_can_text, _row.i_can_statements, _row.source_text, _row.display_order);$s$);
    if (length(_new) - length(replace(_new, 'source_text', ''))) / length('source_text') <> 2 then
        raise exception 'duplicate_course: tag insert not found';
    end if;
    execute _new;
end
$patch$;
