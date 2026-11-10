-- A teacher record no longer outlives its sign-in account (2026-11-08).
--
-- What broke: deleting a user on Supabase's Users page removed the sign-in
-- account but not its teacher row, because teacher.id has no foreign key to
-- auth.users. The row kept its email. When the same address signed in again
-- (with Google, or a new email sign-up), bootstrap_teacher's insert hit
-- teacher_email_key (23505), and the sign-in page treated the error as "not
-- signed in": the teacher stayed on Sign In with no message. Colin hit this
-- testing Google sign-in on 2026-11-07, after deleting his test account.
--
--   _fv_teacher_sign_in_deleted, a trigger on auth.users: deleting a sign-in
--     account soft-deletes its teacher row, so fv_retention_cleanup purges it
--     after 30 days, as the privacy page says.
--   _fv_release_orphan_teacher_email: frees the caller's own email from a
--     teacher row whose sign-in account is gone. That row is soft-deleted if
--     it wasn't already, and its email gets " (sign-in removed …)" appended
--     so it can't collide. Its classes stay until the purge, so the operator
--     can still recover them by hand within 30 days. It acts only on the
--     email in the caller's own session token, and never on a row whose
--     sign-in account still exists.
--   bootstrap_teacher: frees the email before a first insert, and takes the
--     email from the session token rather than the client's p_email, so a
--     client can't create a teacher row under someone else's address.

-- ── Deleting a sign-in account soft-deletes its teacher ──────────────────
create or replace function public._fv_teacher_sign_in_deleted()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    update teacher
       set deleted_at = coalesce(deleted_at, now())
     where id = old.id;
    return old;
end;
$function$;

revoke all on function public._fv_teacher_sign_in_deleted() from public, anon, authenticated;

drop trigger if exists fv_teacher_sign_in_deleted on auth.users;
create trigger fv_teacher_sign_in_deleted
    after delete on auth.users
    for each row execute function public._fv_teacher_sign_in_deleted();

-- ── Free the caller's email from a teacher left without a sign-in ────────
create or replace function public._fv_release_orphan_teacher_email()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _uid   uuid := (select auth.uid());
    _email text := nullif(btrim(coalesce((select auth.jwt()) ->> 'email', '')), '');
begin
    if _uid is null or _email is null then
        return;
    end if;

    update teacher t
       set deleted_at = coalesce(t.deleted_at, now()),
           email      = t.email || ' (sign-in removed ' || to_char(now(), 'YYYY-MM-DD')
                        || ', ' || left(t.id::text, 8) || ')'
     where lower(t.email) = lower(_email)
       and t.id <> _uid
       and not exists (select 1 from auth.users u where u.id = t.id);
end;
$function$;

revoke all on function public._fv_release_orphan_teacher_email() from public, anon;
grant execute on function public._fv_release_orphan_teacher_email() to authenticated;

-- ── bootstrap_teacher ────────────────────────────────────────────────────
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
        -- this email; free it first (see the header).
        perform _fv_release_orphan_teacher_email();

        insert into teacher (id, email, display_name)
        values (_uid, _email, p_display_name)
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
