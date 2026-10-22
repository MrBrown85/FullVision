-- Sentence starters belong to the teacher, not the class.
--
-- What changes: a teacher kept one bank of starters per class, so a starter
-- added in Block A was missing in Block B, and Duplicate Class copied the
-- bank each time. Colin chose (2026-10-22) one list per teacher, "My
-- Sentence Starters", used in every class, with the most-used first.
--
-- observation_template
--   teacher_id (not null, the owner). course_id becomes null: a starter is
--   no longer tied to a class, and deleting a class keeps it.
--   Existing rows merge per teacher: one row per wording (trimmed, any case),
--   the first by class order kept, the rest deleted. Custom tags
--   ('tag:<label>' in default_dims) are dropped from starters, since each
--   class has its own custom tags; dispositions and Core Competencies stay.
--   RLS: a teacher sees and changes only their own starters.
--   The sync-cursor trigger touches every class of the teacher, so other
--   devices see a change on their next bundle check.
-- observation.template_id: the starter an observation was written from
--   (null when written by hand; set null if the starter is deleted). It is
--   what "Times Used" counts.
-- create_observation gains p_template_id (default null). A starter that is
--   not the caller's is ignored.
-- upsert_observation_template keeps its arguments; p_course_id is now
--   unused. New starters go to the end of the teacher's list.
-- get_class_bundle returns the teacher's starters, each with use_count.
-- duplicate_course no longer copies starters.
--
-- Data change: duplicate starters (same wording in two classes) are deleted
-- after the merge; on 2026-10-22 that is 24 rows → 6 for the one teacher with
-- starters. Their wording, type, context and tags survive in the kept row.

-- ── observation_template ───────────────────────────────────────────────
alter table public.observation_template
  add column if not exists teacher_id uuid references public.teacher(id) on delete cascade;
alter table public.observation_template alter column course_id drop not null;

update public.observation_template ot
   set teacher_id = c.teacher_id
  from public.course c
 where c.id = ot.course_id and ot.teacher_id is null;

-- One row per teacher and wording: keep the first by class order.
with ranked as (
  select ot.id,
         row_number() over (partition by ot.teacher_id, lower(btrim(ot.body))
                            order by ot.display_order, ot.created_at, ot.id) as rn
    from public.observation_template ot
)
delete from public.observation_template ot
 using ranked r
 where r.id = ot.id and r.rn > 1;

update public.observation_template
   set default_dims = array(select d from unnest(default_dims) with ordinality u(d, n)
                             where d not like 'tag:%' order by n),
       course_id = null;

-- Renumber each teacher's list 0, 1, 2…
with ordered as (
  select id, row_number() over (partition by teacher_id order by display_order, created_at, id) - 1 as pos
    from public.observation_template
)
update public.observation_template ot set display_order = o.pos from ordered o where o.id = ot.id;

delete from public.observation_template where teacher_id is null;
alter table public.observation_template alter column teacher_id set not null;
create index if not exists observation_template_teacher_idx on public.observation_template (teacher_id, display_order);

drop policy if exists observation_template_via_course on public.observation_template;
create policy observation_template_own on public.observation_template
  for all using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));

-- The bundle cursor: a starter change touches each of the teacher's classes.
create or replace function public._touch_teacher_sync_cursor_from_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _row record;
begin
    for _row in
        select c.id from public.course c
         where c.teacher_id = coalesce(new.teacher_id, old.teacher_id) and c.deleted_at is null
    loop
        perform public._touch_course_sync_cursor(_row.id, coalesce(tg_argv[0], 'student-records'));
    end loop;
    return coalesce(new, old);
end;
$function$;
revoke all on function public._touch_teacher_sync_cursor_from_trigger() from public, anon, authenticated;

drop trigger if exists course_sync_cursor_observation_template_student_records on public.observation_template;
create trigger teacher_sync_cursor_observation_template_student_records
  after insert or delete or update on public.observation_template
  for each row execute function public._touch_teacher_sync_cursor_from_trigger('student-records');

-- ── observation.template_id ────────────────────────────────────────────
alter table public.observation
  add column if not exists template_id uuid references public.observation_template(id) on delete set null;
create index if not exists observation_template_id_idx on public.observation (template_id) where template_id is not null;

-- ── upsert_observation_template: the teacher's list ────────────────────
create or replace function public.upsert_observation_template(p_id uuid, p_course_id uuid, p_body text, p_default_sentiment text default null::text, p_default_context_type text default null::text, p_display_order integer default null::integer, p_idempotency_key uuid default null::uuid, p_default_dims text[] default null::text[])
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
-- p_course_id is unused: starters belong to the teacher (20261022_teacher_sentence_starters.sql).
declare _id uuid; _cached jsonb; _me uuid := (select auth.uid());
begin
    if _me is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_id is null then
        _cached := fv_idem_check(p_idempotency_key, 'upsert_observation_template');
        if _cached is not null then return (_cached->>'id')::uuid; end if;
        insert into observation_template (teacher_id, course_id, body, default_sentiment,
                                          default_context_type, default_dims, is_seed, display_order)
        values (_me, null, p_body, p_default_sentiment, p_default_context_type,
                coalesce(p_default_dims, '{}'::text[]), false,
                coalesce(p_display_order,
                         (select coalesce(max(display_order)+1, 0) from observation_template where teacher_id = _me)))
        returning id into _id;
        perform fv_idem_store(p_idempotency_key, 'upsert_observation_template', jsonb_build_object('id', _id));
    else
        update observation_template set
            body = p_body, default_sentiment = p_default_sentiment,
            default_context_type = p_default_context_type,
            default_dims = coalesce(p_default_dims, default_dims),
            display_order = coalesce(p_display_order, display_order),
            updated_at = now()
         where id = p_id and is_seed = false
        returning id into _id;
        if _id is null then
            raise exception 'observation_template not found or is seed (immutable)' using errcode = 'P0002';
        end if;
    end if;
    return _id;
end; $function$;

-- ── create_observation: which starter it came from ─────────────────────
drop function if exists public.create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[], uuid, text[], smallint);
create function public.create_observation(p_course_id uuid, p_body text, p_sentiment text default null::text, p_context_type text default null::text, p_assessment_id uuid default null::uuid, p_enrollment_ids uuid[] default '{}'::uuid[], p_tag_ids uuid[] default '{}'::uuid[], p_custom_tag_ids uuid[] default '{}'::uuid[], p_idempotency_key uuid default null::uuid, p_dims text[] default null::text[], p_level smallint default null::smallint, p_template_id uuid default null::uuid)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _id     uuid;
    _x      uuid;
    _cached jsonb;
    _tpl    uuid;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    _cached := fv_idem_check(p_idempotency_key, 'create_observation');
    if _cached is not null then
        return (_cached->>'id')::uuid;
    end if;

    -- RLS hides other teachers' starters, so theirs reads as null.
    if p_template_id is not null then
        select id into _tpl from observation_template where id = p_template_id;
    end if;

    insert into observation (course_id, body, sentiment, context_type, assessment_id, dims, level, template_id)
    values (p_course_id, p_body, p_sentiment, p_context_type, p_assessment_id,
            array(select d from unnest(p_dims) with ordinality u(d, n) where nullif(d, '') is not null order by n),
            p_level, _tpl)
    returning id into _id;

    if p_enrollment_ids is not null then
        foreach _x in array p_enrollment_ids loop
            insert into observation_student (observation_id, enrollment_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_tag_ids is not null then
        foreach _x in array p_tag_ids loop
            insert into observation_tag (observation_id, tag_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;
    if p_custom_tag_ids is not null then
        foreach _x in array p_custom_tag_ids loop
            insert into observation_custom_tag (observation_id, custom_tag_id)
              values (_id, _x) on conflict do nothing;
        end loop;
    end if;

    perform fv_idem_store(p_idempotency_key, 'create_observation', jsonb_build_object('id', _id));
    return _id;
end; $function$;
revoke all on function public.create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[], uuid, text[], smallint, uuid) from public, anon;
grant execute on function public.create_observation(uuid, text, text, text, uuid, uuid[], uuid[], uuid[], uuid, text[], smallint, uuid) to authenticated;

-- ── The bundle and Duplicate Class, patched in place ───────────────────
do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$      from public.observation_template ot where ot.course_id = p_course_id;$s$,
        $s$      from public.observation_template ot where ot.teacher_id = (select auth.uid());$s$);
    _new := replace(_new,
        $s$               'display_order', ot.display_order
           ) order by ot.display_order$s$,
        $s$               'display_order', ot.display_order,
               'use_count', (select count(*) from public.observation o where o.template_id = ot.id)
           ) order by ot.display_order$s$);
    if (length(_new) - length(replace(_new, 'ot.teacher_id = (select auth.uid())', ''))) = 0
       or strpos(_new, '''use_count''') = 0 then
        raise exception 'get_class_bundle: observation templates not found';
    end if;
    execute _new;

    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$    insert into observation_template (course_id, body, default_sentiment,
                                      default_context_type, default_dims, is_seed, display_order)
    select _new_course, body, default_sentiment, default_context_type, default_dims, is_seed, display_order
    from observation_template where course_id = p_src_id;
$s$, '');
    if _new = _def then raise exception 'duplicate_course: starter copy not found'; end if;
    execute _new;
end
$patch$;
