-- A teacher's own wording for each competency's rubric levels (2026-10-18).
--
-- "+ From competency" (shared/rubric-draft.js, PR #214) drafts a criterion's
-- four descriptors from the competency's I-can statements. A teacher who
-- rewrites them had to rewrite them again in the next class or the next
-- year. This keeps the rewritten text per teacher and competency, so the
-- next draft starts from it (JumpRope keeps descriptors on the standard in
-- the same way, for a whole district).
--
--   competency_descriptor  one row per teacher, competency and level (1-4).
--     competency_key  built by the client from the competency's short label
--                     and I-can text (RubricDraft.competencyKey), never a tag
--                     id: tag ids differ in every class, and the point is to
--                     reach the same competency in another class.
--     text            the teacher's descriptor, at most 2000 characters.
--
-- Nothing here touches rubrics, criteria or scores: a criterion keeps its own
-- descriptors, and this is only where a draft starts.
--
-- save_competency_descriptors(p_entries) takes [{ key, level, text }] and
-- upserts each; an empty text deletes that level. It is a natural-key upsert,
-- so a retry from the outbox writes the same rows (no idempotency key, as
-- upsert_rubric_score). list_competency_descriptors() returns the signed-in
-- teacher's rows. Both are SECURITY INVOKER behind the teacher_id policy, as
-- save_teacher_preferences is. anon has no grants.
--
-- Tested with begin … rollback before being applied to gradebook-prod.

create table if not exists public.competency_descriptor (
    teacher_id     uuid        not null references public.teacher(id) on delete cascade,
    competency_key text        not null check (char_length(competency_key) between 1 and 400),
    level          smallint    not null check (level between 1 and 4),
    text           text        not null check (char_length(text) between 1 and 2000),
    updated_at     timestamptz not null default now(),
    primary key (teacher_id, competency_key, level)
);

comment on table public.competency_descriptor is
    'A teacher''s own wording for a competency''s rubric levels; where "From competency" drafts start.';

alter table public.competency_descriptor enable row level security;

drop policy if exists competency_descriptor_self on public.competency_descriptor;
create policy competency_descriptor_self on public.competency_descriptor
    for all
    using (teacher_id = (select auth.uid()))
    with check (teacher_id = (select auth.uid()));

revoke all on table public.competency_descriptor from anon;

-- ── save_competency_descriptors ────────────────────────────────────────────
create or replace function public.save_competency_descriptors(p_entries jsonb)
 returns integer
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
    _uid   uuid := (select auth.uid());
    _e     jsonb;
    _key   text;
    _level smallint;
    _text  text;
    _n     integer := 0;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'p_entries must be a jsonb array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_entries) > 200 then
        raise exception 'too many entries' using errcode = '22023';
    end if;

    for _e in select * from jsonb_array_elements(p_entries) loop
        _key   := nullif(btrim(_e->>'key'), '');
        _level := (_e->>'level')::smallint;
        _text  := nullif(btrim(coalesce(_e->>'text', '')), '');
        if _key is null or _level is null or _level not between 1 and 4 then
            raise exception 'each entry needs a key and a level from 1 to 4' using errcode = '22023';
        end if;

        if _text is null then
            delete from competency_descriptor
             where teacher_id = _uid and competency_key = _key and level = _level;
        else
            insert into competency_descriptor (teacher_id, competency_key, level, text)
            values (_uid, _key, _level, _text)
            on conflict (teacher_id, competency_key, level) do update
               set text = excluded.text, updated_at = now();
        end if;
        _n := _n + 1;
    end loop;
    return _n;
end;
$function$;

revoke execute on function public.save_competency_descriptors(jsonb) from public, anon;
grant execute on function public.save_competency_descriptors(jsonb) to authenticated;

-- ── list_competency_descriptors ────────────────────────────────────────────
create or replace function public.list_competency_descriptors()
 returns table(competency_key text, level smallint, text text, updated_at timestamptz)
 language sql
 stable
 security invoker
 set search_path to 'public'
as $function$
    select d.competency_key, d.level, d.text, d.updated_at
      from competency_descriptor d
     where d.teacher_id = (select auth.uid())
     order by d.competency_key, d.level;
$function$;

revoke execute on function public.list_competency_descriptors() from public, anon;
grant execute on function public.list_competency_descriptors() to authenticated;

notify pgrst, 'reload schema';
