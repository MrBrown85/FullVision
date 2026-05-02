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
-- Ownership: SECURITY DEFINER + explicit teacher_id check on the parent
-- course. Robust against missing/incomplete RLS delete policies on
-- custom_tag.
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
language plpgsql security definer set search_path = public as $$
declare
    _course_id uuid;
    _teacher_id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    select ct.course_id, c.teacher_id
      into _course_id, _teacher_id
      from custom_tag ct
      join course c on c.id = ct.course_id
     where ct.id = p_id;

    if _course_id is null then
        -- Tag doesn't exist (already deleted, or never existed).
        -- Treat as success for idempotency.
        return;
    end if;

    if _teacher_id is distinct from (select auth.uid()) then
        raise exception 'not authorized' using errcode = 'PT403';
    end if;

    delete from custom_tag where id = p_id;
end; $$;

grant execute on function delete_custom_tag(uuid) to authenticated;

create or replace function delete_custom_tag_by_label(p_course_id uuid, p_label text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
    _teacher_id uuid;
    _deleted_count integer;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    select c.teacher_id into _teacher_id from course c where c.id = p_course_id;

    if _teacher_id is null then
        -- Course doesn't exist; treat as success for idempotency.
        return 0;
    end if;

    if _teacher_id is distinct from (select auth.uid()) then
        raise exception 'not authorized' using errcode = 'PT403';
    end if;

    delete from custom_tag where course_id = p_course_id and label = p_label;
    get diagnostics _deleted_count = row_count;
    return _deleted_count;
end; $$;

grant execute on function delete_custom_tag_by_label(uuid, text) to authenticated;

commit;
