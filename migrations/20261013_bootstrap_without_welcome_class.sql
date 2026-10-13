-- Stop creating a Welcome Class on first sign-in (2026-10-13).
--
-- New teachers start with no classes and see the class manager's
-- "Create a Class" prompt. Sample data lives in Demo Mode only. Existing
-- Welcome Class rows are left alone; a teacher can delete them like any class.

create or replace function public.bootstrap_teacher(p_email text, p_display_name text default null)
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
            'card_widget_config', _prefs.card_widget_config
        )
    );
end;
$function$;
