-- Core Competencies on an assessment are stored (2026-10-27).
--
-- The Core Competency chips on the assessment form (Communicating,
-- Collaborating, Creative Thinking, …) were never sent to the server. They
-- lived only in the browser's copy of the class, so the next class load
-- replaced them with nothing and another device never saw them. The
-- dashboard, the student page and the Core Competencies report block read
-- them, so those showed only what had been ticked since the last load.
--
--   assessment.core_competency_ids  text[] of the BC Core Competency codes
--                                   (COM COL CT CRT PPI PAR SAR, as in
--                                   CORE_COMPETENCIES in shared/constants.js
--                                   and core_self_assessment.core_id). Empty
--                                   for an assessment with none.
--
-- create_assessment takes p_core_competency_ids. Its old signature is dropped
-- first: two overloads differing by a defaulted parameter make PostgREST
-- reject calls as ambiguous (the April 2026 outage). Callers that leave it
-- out get an empty list, as before. p_idempotency_key stays last and works
-- as before.
-- update_assessment accepts a core_competency_ids key (a JSON array) in
-- p_patch. Left out, the stored list is untouched; [] or null clears it.
-- duplicate_assessment copies the list.
-- get_class_bundle and get_gradebook return core_competency_ids on each
-- assessment; bundle_schema stays 3 because the field is additive. They are
-- patched in place from their live bodies at apply time, as
-- 20261022_advanced_rubric_checks.sql does. get_assessment_detail returns
-- to_jsonb(assessment), so it carries the column with no change.
--
-- The RPCs store each list without duplicates. An unknown code fails the
-- check constraint, so a bad call is refused instead of half saved.
--
-- No existing data changes: every assessment gets an empty list.
-- Test with begin … rollback (or a Supabase branch) before applying to
-- gradebook-prod.

-- ── assessment.core_competency_ids ──────────────────────────────────────────
alter table public.assessment
  add column if not exists core_competency_ids text[] not null default '{}'
  constraint assessment_core_competency_ids_check
    check (core_competency_ids <@ array['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR']::text[]);

comment on column public.assessment.core_competency_ids is
    'BC Core Competency codes the assessment gives evidence of (COM COL CT CRT PPI PAR SAR). Empty: none.';

-- ── create_assessment, plus p_core_competency_ids ───────────────────────────
-- Body from gradebook-prod (2026-10-27) with the new parameter added.
drop function if exists public.create_assessment(
    uuid, text, uuid, text, date, date, text, numeric, numeric, text, uuid, uuid, uuid[], uuid, uuid
);

create function public.create_assessment(
    p_course_id             uuid,
    p_title                 text,
    p_category_id           uuid    default null,
    p_description           text    default null,
    p_date_assigned         date    default null,
    p_due_date              date    default null,
    p_score_mode            text    default 'proficiency',
    p_max_points            numeric default null,
    p_weight                numeric default 1.0,
    p_evidence_type         text    default null,
    p_rubric_id             uuid    default null,
    p_module_id             uuid    default null,
    p_tag_ids               uuid[]  default '{}',
    p_copy_group            uuid    default null,
    p_core_competency_ids   text[]  default '{}',
    p_idempotency_key       uuid    default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
    _id       uuid;
    _next_pos int;
    _tag      uuid;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = p_course_id
       and module_id is not distinct from p_module_id;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, display_order, copy_group, core_competency_ids)
    values (p_course_id, p_category_id, p_title, p_description, p_date_assigned, p_due_date,
            p_score_mode, p_max_points, p_weight, p_evidence_type,
            p_rubric_id, p_module_id, _next_pos, p_copy_group,
            array(select distinct c from unnest(coalesce(p_core_competency_ids, '{}')) c order by c))
    returning id into _id;

    if p_tag_ids is not null then
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id)
              values (_id, _tag) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_assessment', jsonb_build_object('id', _id));
    return _id;
end; $$;

revoke execute on function public.create_assessment(
    uuid, text, uuid, text, date, date, text, numeric, numeric, text, uuid, uuid, uuid[], uuid, text[], uuid
) from public, anon;
grant execute on function public.create_assessment(
    uuid, text, uuid, text, date, date, text, numeric, numeric, text, uuid, uuid, uuid[], uuid, text[], uuid
) to authenticated;

-- ── update_assessment, plus core_competency_ids ─────────────────────────────
-- Body from gradebook-prod (2026-10-27) with the new patch key added.
create or replace function public.update_assessment(p_id uuid, p_patch jsonb, p_tag_ids uuid[] default null)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _tag uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    update assessment set
        title         = coalesce(p_patch->>'title', title),
        description   = case when p_patch ? 'description'   then p_patch->>'description'   else description end,
        category_id   = case when p_patch ? 'category_id'
                             then nullif(p_patch->>'category_id','')::uuid else category_id end,
        date_assigned = case when p_patch ? 'date_assigned'
                             then nullif(p_patch->>'date_assigned','')::date else date_assigned end,
        due_date      = case when p_patch ? 'due_date'
                             then nullif(p_patch->>'due_date','')::date else due_date end,
        score_mode    = coalesce(p_patch->>'score_mode', score_mode),
        max_points    = case when p_patch ? 'max_points'
                             then nullif(p_patch->>'max_points','')::numeric else max_points end,
        weight        = coalesce((p_patch->>'weight')::numeric, weight),
        evidence_type = case when p_patch ? 'evidence_type' then p_patch->>'evidence_type' else evidence_type end,
        rubric_id     = case when p_patch ? 'rubric_id'
                             then nullif(p_patch->>'rubric_id','')::uuid else rubric_id end,
        module_id     = case when p_patch ? 'module_id'
                             then nullif(p_patch->>'module_id','')::uuid else module_id end,
        display_order = case when p_patch ? 'display_order'
                             then (p_patch->>'display_order')::int else display_order end,
        copy_group    = case when p_patch ? 'copy_group'
                             then nullif(p_patch->>'copy_group','')::uuid else copy_group end,
        core_competency_ids = case
                             when not (p_patch ? 'core_competency_ids') then core_competency_ids
                             when jsonb_typeof(p_patch->'core_competency_ids') = 'array'
                             then array(select distinct c
                                          from jsonb_array_elements_text(p_patch->'core_competency_ids') c
                                         order by c)
                             else '{}' end,
        updated_at    = now()
    where id = p_id;

    if not found then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    if p_tag_ids is not null then
        delete from assessment_tag where assessment_id = p_id;
        foreach _tag in array p_tag_ids loop
            insert into assessment_tag (assessment_id, tag_id) values (p_id, _tag)
            on conflict do nothing;
        end loop;
    end if;
end; $function$;

-- ── duplicate_assessment copies the list ────────────────────────────────────
-- Body from gradebook-prod (2026-10-27) with core_competency_ids added.
create or replace function public.duplicate_assessment(p_src_id uuid, p_idempotency_key uuid default null)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _new_id   uuid;
    _course   uuid;
    _module   uuid;
    _next_pos int;
    _cached   jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'duplicate_assessment');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    select course_id, module_id into _course, _module
      from assessment
     where id = p_src_id;
    if _course is null then raise exception 'assessment not found' using errcode = 'P0002'; end if;

    select coalesce(max(display_order) + 1, 0) into _next_pos
      from assessment
     where course_id = _course
       and module_id is not distinct from _module;

    insert into assessment (course_id, category_id, title, description, date_assigned, due_date,
                            score_mode, max_points, weight, evidence_type,
                            rubric_id, module_id, collab_mode, collab_config, display_order,
                            core_competency_ids)
    select course_id, category_id, title || ' (copy)', description, date_assigned, due_date,
           score_mode, max_points, weight, evidence_type,
           rubric_id, module_id, collab_mode, collab_config, _next_pos,
           core_competency_ids
      from assessment
     where id = p_src_id
    returning id into _new_id;

    insert into assessment_tag (assessment_id, tag_id)
    select _new_id, tag_id from assessment_tag where assessment_id = p_src_id;

    perform fv_idem_store(p_idempotency_key, 'duplicate_assessment', jsonb_build_object('id', _new_id));
    return _new_id;
end; $function$;

-- ── get_class_bundle and get_gradebook return the list ──────────────────────
-- Patched in place from the live bodies; each anchor must be found or the
-- migration stops here.
do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$'copy_group', asm.copy_group$s$,
        $s$'copy_group', asm.copy_group,
                       'core_competency_ids', to_jsonb(asm.core_competency_ids)$s$);
    if _new = _def then raise exception 'get_class_bundle: assessment copy_group not found'; end if;
    execute _new;

    _def := pg_get_functiondef('public.get_gradebook(uuid)'::regprocedure);
    _new := replace(_def,
        $s$'display_order', a.display_order,$s$,
        $s$'display_order', a.display_order,
               'core_competency_ids', to_jsonb(a.core_competency_ids),$s$);
    if _new = _def then raise exception 'get_gradebook: assessment display_order not found'; end if;
    execute _new;
end
$patch$;
