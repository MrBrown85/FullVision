-- FullVision v2 — Write-path RPCs (design artifact)
--
-- Mirror of what has been deployed to gradebook-prod.
-- Each section corresponds to one Phase 1.x task in HANDOFF.md.
-- Append new RPCs here as each phase lands.
--
-- Applied migrations (in order):
--   fullvision_v2_write_path_auth_bootstrap  (2026-04-19)

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.1 — Auth / bootstrap RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- bootstrap_teacher(p_email text, p_display_name text DEFAULT NULL) → jsonb
--
-- Called by the client on every sign-in. On first verified sign-in, creates:
--   • teacher row (id = auth.uid())
--   • teacher_preference row (defaults)
--   • "Welcome Class" course + report_config row
--     (Phase 5.1 will inject full demo-seed data into this course)
-- On subsequent sign-ins, returns existing teacher + preferences.
-- If teacher.deleted_at IS NOT NULL (soft-deleted, within 30-day grace window),
-- returns the teacher with deleted_at set so the client can prompt restoration.
--
-- Return shape:
--   {
--     id, email, display_name, created_at, deleted_at,
--     preferences: { active_course_id, view_mode, mobile_view_mode,
--                    mobile_sort_mode, card_widget_config }
--   }
create or replace function bootstrap_teacher(
    p_email        text,
    p_display_name text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid        uuid := (select auth.uid());
    _teacher    teacher%rowtype;
    _prefs      teacher_preference%rowtype;
    _course_id  uuid;
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

        -- Welcome Class: bare course.  Phase 5.1 injects full demo-seed data.
        insert into course (teacher_id, name, grade_level, grading_system, calc_method, timezone)
        values (_uid, 'Welcome Class', '8', 'proficiency', 'average', 'America/Vancouver')
        returning id into _course_id;

        insert into report_config (course_id) values (_course_id);

        update teacher_preference
           set active_course_id = _course_id
         where teacher_id = _uid
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
$$;


-- soft_delete_teacher() → void
--
-- Marks the calling teacher's account for deletion (30-day grace window).
-- Called by the client after the teacher confirms deletion with their password.
-- The scheduled cleanup job (Phase 1.12) hard-deletes rows where
-- deleted_at < now() - interval '30 days', cascading through all owned data.
-- Idempotent: calling again within the grace window refreshes deleted_at.
create or replace function soft_delete_teacher()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update teacher
       set deleted_at = now()
     where id = _uid;

    if not found then
        raise exception 'teacher not found' using errcode = 'P0002';
    end if;
end;
$$;


-- restore_teacher() → void
--
-- Cancels a pending soft-delete within the 30-day grace window.
-- Called when the teacher confirms "Restore my account" after signing in and
-- seeing the deleted_at warning (Pass C §5).
create or replace function restore_teacher()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null then
        raise exception 'not authenticated' using errcode = 'PT401';
    end if;

    update teacher
       set deleted_at = null
     where id = _uid
       and deleted_at is not null;

    if not found then
        raise exception 'no pending deletion found for this teacher' using errcode = 'P0002';
    end if;
end;
$$;
