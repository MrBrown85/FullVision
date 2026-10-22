-- Removing a competency keeps its scores.
--
-- What broke: Class Management's "Remove from Class…" said "Existing scores
-- are kept", but it called delete_section / delete_tag, and the cascade
-- deleted every tag_score, assessment link, observation link, goal,
-- reflection and override tied to that competency. Colin chose (2026-10-22)
-- that removing a competency hides it from the class and keeps everything, so
-- it can come back.
--
-- What it adds:
--   section.removed_at. A removed section (and the tag under it) stays in
--   the database with all its links; the learning map leaves it out.
--   remove_section(p_id, p_idempotency_key) sets removed_at (kept if already
--   set). restore_section(p_id, p_idempotency_key) clears it. Both return
--   { section_id, removed_at } and are idempotent through fv_idem_check /
--   fv_idem_store. list_removed_sections(p_course_id) returns the class's
--   removed sections with their tags, newest first, for Re-link's review
--   ("You removed this from the class earlier") and for putting one back.
--   get_class_bundle, get_learning_map and get_student_profile leave removed
--   sections out of the learning map / competency tree; duplicate_course
--   leaves them out of the copy. They are patched in place; nothing else
--   about them changes. Scores of a removed competency still load with the
--   class (the client simply has no column for them), so restoring one shows
--   them again.
--
-- No existing data changes. All three new functions are SECURITY INVOKER:
-- section RLS (fv_owns_course) decides who can touch a section.

alter table public.section add column if not exists removed_at timestamptz;

create or replace function public.remove_section(p_id uuid, p_idempotency_key uuid default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _cached jsonb;
    _at     timestamptz;
    _result jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;
    _cached := fv_idem_check(p_idempotency_key, 'remove_section');
    if _cached is not null then
        return _cached;
    end if;
    update section set removed_at = coalesce(removed_at, now()) where id = p_id returning removed_at into _at;
    if not found then
        raise exception 'section not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('section_id', p_id, 'removed_at', _at);
    perform fv_idem_store(p_idempotency_key, 'remove_section', _result);
    return _result;
end;
$function$;

create or replace function public.restore_section(p_id uuid, p_idempotency_key uuid default null)
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
    _cached := fv_idem_check(p_idempotency_key, 'restore_section');
    if _cached is not null then
        return _cached;
    end if;
    update section set removed_at = null where id = p_id;
    if not found then
        raise exception 'section not found' using errcode = 'P0002';
    end if;
    _result := jsonb_build_object('section_id', p_id, 'removed_at', null);
    perform fv_idem_store(p_idempotency_key, 'restore_section', _result);
    return _result;
end;
$function$;

create or replace function public.list_removed_sections(p_course_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'subject_id', s.subject_id,
             'competency_group_id', s.competency_group_id, 'removed_at', s.removed_at,
             'tags', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', t.id, 'code', t.code, 'label', t.label, 'i_can_text', t.i_can_text,
                        'i_can_statements', to_jsonb(t.i_can_statements), 'source_text', t.source_text)
                      order by t.display_order, t.label)
                 from tag t where t.section_id = s.id), '[]'::jsonb)
           ) order by s.removed_at desc), '[]'::jsonb)
      from section s
     where s.course_id = p_course_id and s.removed_at is not null;
$function$;

revoke all on function public.remove_section(uuid, uuid) from public, anon;
revoke all on function public.restore_section(uuid, uuid) from public, anon;
revoke all on function public.list_removed_sections(uuid) from public, anon;
grant execute on function public.remove_section(uuid, uuid) to authenticated;
grant execute on function public.restore_section(uuid, uuid) to authenticated;
grant execute on function public.list_removed_sections(uuid) to authenticated;

-- Patch the readers and the copier in place. Each replace must find its
-- target, or the migration stops before anything is half-changed.
do $patch$
declare
    _def text;
    _new text;
begin
    _def := pg_get_functiondef('public.get_class_bundle(uuid, bigint)'::regprocedure);
    _new := replace(_def,
        $s$          left join public.tag t on t.section_id = s.id
         where s.course_id = p_course_id
$s$,
        $s$          left join public.tag t on t.section_id = s.id
         where s.course_id = p_course_id and s.removed_at is null
$s$);
    if _new = _def then raise exception 'get_class_bundle: learning map sections not found'; end if;
    execute _new;

    _def := pg_get_functiondef('public.get_learning_map(uuid)'::regprocedure);
    _new := replace(_def,
        $s$        left join tags_hydrated t on t.section_id = s.id
       where s.course_id = p_course_id
$s$,
        $s$        left join tags_hydrated t on t.section_id = s.id
       where s.course_id = p_course_id and s.removed_at is null
$s$);
    if _new = _def then raise exception 'get_learning_map: sections not found'; end if;
    execute _new;

    _def := pg_get_functiondef('public.get_student_profile(uuid)'::regprocedure);
    _new := replace(_def,
        $s$        left join tag_rows t on t.section_id = s.id
       where s.course_id = enr.course_id
$s$,
        $s$        left join tag_rows t on t.section_id = s.id
       where s.course_id = enr.course_id and s.removed_at is null
$s$);
    if _new = _def then raise exception 'get_student_profile: competency tree sections not found'; end if;
    execute _new;

    _def := pg_get_functiondef('public.duplicate_course(uuid, uuid)'::regprocedure);
    _new := replace(_def,
        $s$for _row in select * from section where course_id = p_src_id loop$s$,
        $s$for _row in select * from section where course_id = p_src_id and removed_at is null loop$s$);
    _new := replace(_new,
        $s$join section s on s.id = t.section_id where s.course_id = p_src_id loop$s$,
        $s$join section s on s.id = t.section_id where s.course_id = p_src_id and s.removed_at is null loop$s$);
    if (length(_new) - length(replace(_new, 'removed_at is null', ''))) / length('removed_at is null') <> 2 then
        raise exception 'duplicate_course: section and tag loops not found';
    end if;
    execute _new;
end
$patch$;
