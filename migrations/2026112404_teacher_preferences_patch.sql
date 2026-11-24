-- A teacher-preferences save changes only what the teacher changed (2026-11-24).
--
-- THIS FILE DELETES NOTHING AND CHANGES NO EXISTING ROW. It adds one function,
-- public.patch_teacher_preferences. save_teacher_preferences is left exactly
-- as it is, for the released app and for saves it left waiting on a
-- computer.
--
-- What broke: every save of a teacher preference sent the browser's whole
-- copy. Switching class sent the view mode, the phone's card settings and
-- every dashboard and page-view choice this tab had loaded; changing one view
-- choice (the roster's Sort, Newest First) sent the whole dashboard_prefs
-- object, which save_teacher_preferences puts in whole. So a tab left open
-- since the morning put its morning copy back over a change made since on
-- another computer, with no sign (docs/ROADMAP.md, 1.7). Class settings had
-- the same fault and were fixed on 2026-11-10 (docs/DECISIONS.md, "Class
-- settings on two computers"): a save sends only what changed.
--
-- patch_teacher_preferences(p_patch jsonb, p_idempotency_key uuid):
--   - active_course_id, view_mode, mobile_view_mode, mobile_sort_mode,
--     card_widget_config: as in save_teacher_preferences. A key in the patch
--     sets that column (an empty or null value clears it); a key not in the
--     patch leaves it as it is.
--   - dashboard_prefs is merged, not replaced. Each key the patch gives
--     sets that key; the keys it does not give stay as the server has them.
--     When both the patch's value and the stored one are objects (view,
--     closedModules, helpRule), they are merged one level further, so a
--     choice under view sets that one choice only. A null dashboard_prefs
--     clears the column.
--   - Idempotent through p_idempotency_key (fv_idem_check / fv_idem_store):
--     a retry of a save the server already took does nothing, so it cannot
--     put the value back over a newer save made in between.
--   SECURITY INVOKER, like save_teacher_preferences: the teacher_preference
--   row is reached under its own RLS policy (teacher_id = auth.uid()).
--
-- The app from this change calls only patch_teacher_preferences, so this
-- must be applied before that app is merged (the drift check fails until it
-- is). Undo: drop function public.patch_teacher_preferences(jsonb, uuid);
-- the app before this change does not call it.

begin;

set local lock_timeout = '5s';

create or replace function public.patch_teacher_preferences(p_patch jsonb, p_idempotency_key uuid default null::uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _uid    uuid := (select auth.uid());
    _cached jsonb;
    _old    jsonb;
    _change jsonb;
    _dash   jsonb;
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'p_patch must be an object' using errcode = '22023';
    end if;
    if p_patch ? 'dashboard_prefs' and jsonb_typeof(p_patch->'dashboard_prefs') not in ('object', 'null') then
        raise exception 'dashboard_prefs must be an object or null' using errcode = '22023';
    end if;

    _cached := fv_idem_check(p_idempotency_key, 'patch_teacher_preferences');
    if _cached is not null then return; end if;

    insert into teacher_preference (teacher_id) values (_uid)
    on conflict (teacher_id) do nothing;

    select dashboard_prefs into _old from teacher_preference where teacher_id = _uid for update;

    _dash := _old;
    if p_patch ? 'dashboard_prefs' then
        _change := p_patch->'dashboard_prefs';
        if jsonb_typeof(_change) = 'null' then
            _dash := null;
        else
            if _old is null or jsonb_typeof(_old) <> 'object' then _old := '{}'::jsonb; end if;
            _dash := _old || coalesce((
                select jsonb_object_agg(c.key,
                    case when jsonb_typeof(c.value) = 'object' and jsonb_typeof(_old->c.key) = 'object'
                         then (_old->c.key) || c.value
                         else c.value end)
                  from jsonb_each(_change) c
            ), '{}'::jsonb);
        end if;
    end if;

    update teacher_preference set
        active_course_id   = case when p_patch ? 'active_course_id'
                                  then nullif(p_patch->>'active_course_id','')::uuid
                                  else active_course_id end,
        view_mode          = case when p_patch ? 'view_mode'
                                  then nullif(p_patch->>'view_mode','')
                                  else view_mode end,
        mobile_view_mode   = case when p_patch ? 'mobile_view_mode'
                                  then nullif(p_patch->>'mobile_view_mode','')
                                  else mobile_view_mode end,
        mobile_sort_mode   = case when p_patch ? 'mobile_sort_mode'
                                  then nullif(p_patch->>'mobile_sort_mode','')
                                  else mobile_sort_mode end,
        card_widget_config = case when p_patch ? 'card_widget_config'
                                  then nullif(p_patch->'card_widget_config', 'null'::jsonb)
                                  else card_widget_config end,
        dashboard_prefs    = _dash
     where teacher_id = _uid;

    perform fv_idem_store(p_idempotency_key, 'patch_teacher_preferences', jsonb_build_object('saved', true));
end; $function$;

revoke all on function public.patch_teacher_preferences(jsonb, uuid) from public, anon;
grant execute on function public.patch_teacher_preferences(jsonb, uuid) to authenticated, service_role;

comment on function public.patch_teacher_preferences(jsonb, uuid) is
    'Saves only the teacher preferences named in p_patch; dashboard_prefs is merged key by key (two levels). Replaces save_teacher_preferences for the app from 2026-11-24.';

commit;
