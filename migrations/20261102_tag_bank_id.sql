-- Bank ids on the server (2026-11-02, curriculum bank stage 4, PR 1).
-- A competency imported from the BC curriculum bank had no record of which
-- bank competency it came from: the importer dropped comp.id, so Re-link
-- could only match by wording, code or title, and the competency card could
-- not show the Ministry path. tag.bank_id now holds the bank's stable id
-- (e.g. 'bc.draft10.cc.11'); null for hand-made competencies and for
-- classes built from the old bank.
--
-- upsert_tag takes p_bank_id; null keeps the stored value, so a client
-- that doesn't send it changes nothing. Its old signature is dropped here so
-- PostgREST has one function to choose (PGRST203,
-- migrations/20260428_drop_legacy_non_idempotent_overloads.sql).
-- get_learning_map, get_class_bundle and list_removed_sections return it;
-- duplicate_course copies it. tag already has a sync-cursor trigger.

alter table public.tag add column if not exists bank_id text;
comment on column public.tag.bank_id is
    'BC curriculum bank competency id this competency was imported from (data/bc-curriculum-source.json). Null when hand-made or from the old bank.';

drop function if exists public.upsert_tag(uuid, uuid, text, text, text, integer, uuid, text[], text);

create or replace function public.upsert_tag(
    p_id uuid,
    p_section_id uuid,
    p_label text,
    p_code text default null,
    p_i_can_text text default null,
    p_display_order integer default null,
    p_idempotency_key uuid default null,
    p_i_can_statements text[] default null,
    p_source_text text default null,
    p_bank_id text default null
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
        insert into tag (section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values (p_section_id, p_code, p_label, p_i_can_text, coalesce(p_i_can_statements, '{}'), p_source_text, p_bank_id,
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
            bank_id = coalesce(p_bank_id, bank_id),
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id returning id into _id;
        if _id is null then raise exception 'tag not found' using errcode = 'P0002'; end if;
    end if;
    return _id;
end; $function$;

revoke all on function public.upsert_tag(uuid, uuid, text, text, text, integer, uuid, text[], text, text) from public, anon;
grant execute on function public.upsert_tag(uuid, uuid, text, text, text, integer, uuid, text[], text, text) to authenticated, service_role;

do $patch$
declare
    _def text;
    _new text;
    _n int;
begin
    -- get_learning_map: the tags CTE and the tag object.
    _def := pg_get_functiondef('public.get_learning_map(uuid)'::regprocedure);
    _new := replace(_def,
        $s$select t.id, t.section_id, t.code, t.label, t.i_can_text, t.i_can_statements, t.source_text, t.display_order,$s$,
        $s$select t.id, t.section_id, t.code, t.label, t.i_can_text, t.i_can_statements, t.source_text, t.bank_id, t.display_order,$s$);
    if _new = _def then raise exception 'get_learning_map: tags_hydrated select not found'; end if;
    _def := _new;
    _new := replace(_def,
        $s$'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,
                 'display_order', t.display_order,$s$,
        $s$'i_can_text', t.i_can_text, 'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,
                 'bank_id', t.bank_id,
                 'display_order', t.display_order,$s$);
    if _new = _def then raise exception 'get_learning_map: tag object not found'; end if;
    execute _new;

    -- get_class_bundle: the tag object.
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$'source_text', t.source_text,
                   'display_order', t.display_order$s$,
        $s$'source_text', t.source_text, 'bank_id', t.bank_id,
                   'display_order', t.display_order$s$);
    if _new = _def then raise exception 'get_class_bundle: tag object not found'; end if;
    execute _new;

    -- list_removed_sections: the tag object, so Add Back keeps it.
    _def := pg_get_functiondef('public.list_removed_sections(uuid)'::regprocedure);
    _new := replace(_def,
        $s$'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text)$s$,
        $s$'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text,
                        'bank_id', t.bank_id)$s$);
    if _new = _def then raise exception 'list_removed_sections: tag object not found'; end if;
    execute _new;

    -- duplicate_course: copy it.
    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, display_order)
        values (_new_id, (_sect_map ->> _row.section_id::text)::uuid,
            _row.code, _row.label, _row.i_can_text, _row.i_can_statements, _row.source_text, _row.display_order);$s$,
        $s$insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values (_new_id, (_sect_map ->> _row.section_id::text)::uuid,
            _row.code, _row.label, _row.i_can_text, _row.i_can_statements, _row.source_text, _row.bank_id, _row.display_order);$s$);
    if _new = _def then raise exception 'duplicate_course: tag insert not found'; end if;
    execute _new;

    select count(*) into _n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_tag';
    if _n <> 1 then raise exception 'upsert_tag: expected 1 overload, found %', _n; end if;
end
$patch$;
