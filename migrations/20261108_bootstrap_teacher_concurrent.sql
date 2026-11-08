-- Two sign-up setups at once no longer fail (2026-11-08).
--
-- What broke: a new teacher who clicked the confirmation link with the
-- Check Your Inbox tab still open got "This link has expired or was already
-- used." Both tabs sign in at the same moment (the inbox tab watches for the
-- confirmation and goes in by itself), and both call bootstrap_teacher. Each
-- found no teacher row and inserted one; the second insert hit teacher_pkey
-- (23505, seen in the logs at 2026-11-08 15:51:16), and the sign-in page
-- treated the error as a failed link. The account was fine: the next sign-in
-- went straight in.
--
--   bootstrap_teacher: the first-sign-in inserts are `on conflict do
--     nothing`, then the rows are read back, so a call that loses the race
--     returns the row the winner made. Under read committed the loser's
--     insert waits for the winner to commit, so the read-back sees it. The
--     email rules from 20261108_teacher_outlives_sign_in are unchanged: the
--     email still comes from the session token, an orphaned row is still
--     freed first, and a live teacher's email still can't be taken.

create or replace function public.bootstrap_teacher(p_email text, p_display_name text default null::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _uid        uuid := (select auth.uid());
    _email      text := coalesce(nullif(btrim(coalesce((select auth.jwt()) ->> 'email', '')), ''), p_email);
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
        -- A teacher row left by a deleted sign-in account may still hold
        -- this email; free it first (20261108_teacher_outlives_sign_in).
        perform _fv_release_orphan_teacher_email();

        -- Another tab may be making this same row right now; whichever
        -- commits second does nothing and reads the first one's row.
        insert into teacher (id, email, display_name)
        values (_uid, _email, p_display_name)
        on conflict (id) do nothing;

        select * into _teacher from teacher where id = _uid;
    end if;

    -- Also covers a partial bootstrap from an earlier failed transaction.
    insert into teacher_preference (teacher_id)
    values (_uid)
    on conflict (teacher_id) do nothing;

    select * into _prefs from teacher_preference where teacher_id = _uid;

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
