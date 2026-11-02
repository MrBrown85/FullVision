-- import_json_restore keeps a competency's I Can statements, curriculum
-- wording and bank id (2026-11-02, curriculum bank stage 4 follow-up).
-- Its tag insert predates tag.i_can_statements, tag.source_text and
-- tag.bank_id (migrations/20261102_tag_bank_id.sql), so it copied only
-- code, label, i_can_text and display_order: a class restored from a backup
-- lost its I Can statements, the wording Restore Original Wording goes back
-- to, and the link to the bank competency Re-link and the competency card use.
--
-- The tag insert now takes all three. A payload without them restores as
-- before: a new row gets i_can_statements '{}' and nulls, and an existing
-- row keeps what it has, so an older backup can't blank them. A payload that
-- has the key replaces the stored value, like every other column there.
-- Patched in place so the rest of the function stays as live.

do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.import_json_restore(jsonb, uuid)'::regprocedure);
    _new := replace(_def,
        $s$insert into tag (id, section_id, code, label, i_can_text, display_order)
        values ((_row->>'id')::uuid, (_row->>'section_id')::uuid,
                _row->>'code', coalesce(_row->>'label',''), _row->>'i_can_text',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          code=excluded.code, label=excluded.label, i_can_text=excluded.i_can_text,
          display_order=excluded.display_order, updated_at=now();$s$,
        $s$insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
        values ((_row->>'id')::uuid, (_row->>'section_id')::uuid,
                _row->>'code', coalesce(_row->>'label',''), _row->>'i_can_text',
                coalesce(array(select jsonb_array_elements_text(
                    case when jsonb_typeof(_row->'i_can_statements') = 'array'
                         then _row->'i_can_statements' else '[]'::jsonb end)), '{}'),
                _row->>'source_text', _row->>'bank_id',
                coalesce((_row->>'display_order')::int, 0))
        on conflict (id) do update set
          code=excluded.code, label=excluded.label, i_can_text=excluded.i_can_text,
          i_can_statements=case when _row ? 'i_can_statements' then excluded.i_can_statements else tag.i_can_statements end,
          source_text=case when _row ? 'source_text' then excluded.source_text else tag.source_text end,
          bank_id=case when _row ? 'bank_id' then excluded.bank_id else tag.bank_id end,
          display_order=excluded.display_order, updated_at=now();$s$);
    if _new = _def then raise exception 'import_json_restore: tag insert not found'; end if;
    execute _new;
end
$patch$;
