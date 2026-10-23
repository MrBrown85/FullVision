-- The dashboard's settings follow the teacher, not the browser.
--
-- What changes: the Who Needs Help rule (below which proficiency, and how
-- many scores a competency needs) and the Students view (Cards or Grid) were
-- kept in the browser, so a teacher lost them on another device or after
-- clearing site data. Colin chose (2026-10-22) to keep them with the
-- teacher's other preferences.
--
-- teacher_preference.dashboard_prefs jsonb:
--   { "studentView": "cards" | "grid", "helpRule": { "below": 2 | 3, "min": 1-5 } }
--   Null until the teacher changes one; the app fills in the defaults.
-- save_teacher_preferences: a 'dashboard_prefs' key in the patch replaces it;
--   no key leaves it as it is (the rule for every other column).
-- bootstrap_teacher: returns it under preferences.dashboard_prefs.
-- Both function bodies are the live ones (2026-10-22) with only these lines
-- added. Table grants already cover the new column; RLS is per row.

alter table teacher_preference add column if not exists dashboard_prefs jsonb;

create or replace function public.save_teacher_preferences(p_patch jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _uid uuid := (select auth.uid());
begin
    if _uid is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;

    insert into teacher_preference (teacher_id,
        active_course_id, view_mode, mobile_view_mode, mobile_sort_mode, card_widget_config, dashboard_prefs)
    values (_uid,
        nullif(p_patch->>'active_course_id','')::uuid,
        nullif(p_patch->>'view_mode',''),
        nullif(p_patch->>'mobile_view_mode',''),
        nullif(p_patch->>'mobile_sort_mode',''),
        case when p_patch ? 'card_widget_config' then p_patch->'card_widget_config' else null end,
        case when p_patch ? 'dashboard_prefs' then p_patch->'dashboard_prefs' else null end)
    on conflict (teacher_id) do update set
        active_course_id   = case when p_patch ? 'active_course_id'
                                  then nullif(p_patch->>'active_course_id','')::uuid
                                  else teacher_preference.active_course_id end,
        view_mode          = case when p_patch ? 'view_mode'
                                  then nullif(p_patch->>'view_mode','')
                                  else teacher_preference.view_mode end,
        mobile_view_mode   = case when p_patch ? 'mobile_view_mode'
                                  then nullif(p_patch->>'mobile_view_mode','')
                                  else teacher_preference.mobile_view_mode end,
        mobile_sort_mode   = case when p_patch ? 'mobile_sort_mode'
                                  then nullif(p_patch->>'mobile_sort_mode','')
                                  else teacher_preference.mobile_sort_mode end,
        card_widget_config = case when p_patch ? 'card_widget_config'
                                  then p_patch->'card_widget_config'
                                  else teacher_preference.card_widget_config end,
        dashboard_prefs    = case when p_patch ? 'dashboard_prefs'
                                  then p_patch->'dashboard_prefs'
                                  else teacher_preference.dashboard_prefs end;
end; $function$;

create or replace function public.bootstrap_teacher(p_email text, p_display_name text default null::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _uid        uuid := (select auth.uid());
    _teacher    teacher%rowtype;
    _prefs      teacher_preference%rowtype;
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    -- Load existing teacher (including soft-deleted, within grace window).
    select * into _teacher from teacher where id = _uid;

    if not found then
        -- ── First verified sign-in ─────────────────────────────────────────
        insert into teacher (id, email, display_name)
        values (_uid, p_email, p_display_name)
        returning * into _teacher;

        insert into teacher_preference (teacher_id)
        values (_uid)
        returning * into _prefs;
    else
        -- ── Returning sign-in ──────────────────────────────────────────────
        select * into _prefs from teacher_preference where teacher_id = _uid;

        -- Guard against partial bootstraps from a prior failed transaction.
        if not found then
            insert into teacher_preference (teacher_id)
            values (_uid)
            returning * into _prefs;
        end if;
    end if;

    return jsonb_build_object(
        'id',           _teacher.id,
        'email',        _teacher.email,
        'display_name', _teacher.display_name,
        'created_at',   _teacher.created_at,
        'deleted_at',   _teacher.deleted_at,
        'preferences',  jsonb_build_object(
            'active_course_id',   _prefs.active_course_id,
            'view_mode',          _prefs.view_mode,
            'mobile_view_mode',   _prefs.mobile_view_mode,
            'mobile_sort_mode',   _prefs.mobile_sort_mode,
            'card_widget_config', _prefs.card_widget_config,
            'dashboard_prefs',    _prefs.dashboard_prefs
        )
    );
end;
$function$;
