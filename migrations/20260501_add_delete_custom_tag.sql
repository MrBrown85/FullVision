-- ============================================================================
-- migration: 20260501_add_delete_custom_tag
--
-- Adds delete_custom_tag(p_id uuid) and delete_custom_tag_by_label
-- (p_course_id uuid, p_label text) RPCs for P6.3 (persistence audit
-- 2026-05-01): removeCustomTag was LS-only because
-- _persistCustomTagsToCanonical only iterated additions, never deletions.
-- With these RPCs + the corresponding client diff branch, deleted custom
-- tags disappear from the canonical store too, so they don't reappear on
-- reload.
--
-- Two flavors:
--   • delete_custom_tag(p_id uuid) — primary path. Used when the client
--     knows the tag's uuid (cached from create_custom_tag responses in the
--     same session).
--   • delete_custom_tag_by_label(p_course_id uuid, p_label text) — fallback
--     for cross-session deletes (LS only stores labels; if a tag was
--     created in a previous session, the client doesn't have the uuid).
--     Deletes every custom_tag row in the course matching the label, since
--     no unique constraint exists on (course_id, label).
--
-- Ownership: SECURITY INVOKER. The custom_tag_via_course RLS policy
-- (fv_owns_course(course_id), FOR ALL) already limits deletes to the
-- caller's own courses, so a tag in someone else's course is simply not
-- matched. EXECUTE is revoked from PUBLIC/anon; Postgres grants new
-- functions to PUBLIC by default.
--
-- Applied to gradebook-prod on 2026-10-12 (it had been written but never
-- applied, so custom-tag deletes failed and the tags returned on reload).
--
-- Idempotent: deletes are naturally idempotent (keyed by row id or label).
-- Calling twice returns success on the second call (0 rows affected). No
-- fv_idempotency entry needed.
--
-- Cascade: observation_custom_tag rows referencing this tag cascade-delete
-- via the existing FK (custom_tag_id references custom_tag(id) on delete
-- cascade — see schema.sql line 311). No explicit cleanup needed.
-- ============================================================================

begin;

create or replace function delete_custom_tag(p_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- RLS hides other teachers' tags; an already-deleted tag matches nothing.
    -- Both are a successful no-op.
    delete from custom_tag where id = p_id;
end; $$;

revoke execute on function delete_custom_tag(uuid) from public, anon;
grant execute on function delete_custom_tag(uuid) to authenticated;

create or replace function delete_custom_tag_by_label(p_course_id uuid, p_label text)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
    _deleted_count integer;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    delete from custom_tag where course_id = p_course_id and label = p_label;
    get diagnostics _deleted_count = row_count;
    return _deleted_count;
end; $$;

revoke execute on function delete_custom_tag_by_label(uuid, text) from public, anon;
grant execute on function delete_custom_tag_by_label(uuid, text) to authenticated;

commit;
