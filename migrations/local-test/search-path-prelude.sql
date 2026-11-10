-- The rest of the sixteen SECURITY DEFINER functions that
-- ../2026111002_security_definer_search_path.sql changes, for search_path.py.
-- The other harness files load nine of them (named in README.md, "S0-M5");
-- this file adds the seven that none loads and replaces the two that
-- harness.sql keeps in a shortened form. Each body is copied, text unchanged,
-- from the migration named above it: the one that last defined it.
-- Load after bundle-tables.sql (term_rating_audit points at term_rating).
--
-- All of them are the live functions: the migration's "Before the apply"
-- query, which carries the fingerprint of each as loaded here, was run
-- read-only on gradebook-prod on 2026-11-10 and found no difference
-- (rls_auto_enable was a stand-in then, and is now the live body it printed).

set check_function_bodies = off;

-- ── What Supabase provides and harness.sql leaves out ───────────────────────
-- auth.users, as much of it as the two sign-in functions read; auth.jwt()
-- from request.jwt.claims, as PostgREST sets it.
create table auth.users (id uuid primary key, email text);
create or replace function auth.jwt() returns jsonb
 language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- ── fv_idem_check, fv_idem_store ────────────────────────────────────────────
-- harness.sql has both on a few lines, and fv_idem_check without its lock.
-- migrations/20261016_idempotency_key_lock.sql
create or replace function fv_idem_check(p_key uuid, p_endpoint text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
    _r   jsonb;
begin
    if _uid is null or p_key is null then
        return null;
    end if;
    -- Held until the calling RPC's transaction ends. A concurrent call with
    -- the same key blocks here, then sees the result the first one stored.
    perform pg_advisory_xact_lock(hashtext(_uid::text), hashtext(p_key::text));
    select result into _r
      from fv_idempotency
     where key = p_key
       and teacher_id = _uid
       and endpoint = p_endpoint;
    return _r;
end;
$$;

-- migrations/20260423_write_path_idempotency.sql
create or replace function fv_idem_store(p_key uuid, p_endpoint text, p_result jsonb)
    returns void
    language plpgsql
    security definer
    set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
begin
    if _uid is null or p_key is null then
        return;
    end if;
    insert into fv_idempotency (key, teacher_id, endpoint, result)
      values (p_key, _uid, p_endpoint, p_result)
      on conflict (key, teacher_id) do nothing;
end;
$$;

revoke all on function fv_idem_check(uuid, text) from public;
revoke all on function fv_idem_store(uuid, text, jsonb) from public;
grant execute on function fv_idem_check(uuid, text) to authenticated;
grant execute on function fv_idem_store(uuid, text, jsonb) to authenticated;

-- ── The sign-in functions ───────────────────────────────────────────────────
-- migrations/20261108_teacher_outlives_sign_in.sql
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

create trigger fv_teacher_sign_in_deleted
    after delete on auth.users
    for each row execute function public._fv_teacher_sign_in_deleted();

-- migrations/20261108_teacher_outlives_sign_in.sql
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

-- The migration also grants it to authenticated. search_path.py does that in
-- its own transaction, not here: Batch A's grade_return.py counts every
-- function named _fv_ that a signed-in teacher may run, and expects its own.
revoke all on function public._fv_release_orphan_teacher_email() from public, anon, authenticated;

-- ── The term rating's change history ────────────────────────────────────────
-- The table is docs/schema.generated.sql's, line for line.
create table public.term_rating_audit (
  id uuid not null default gen_random_uuid(),
  term_rating_id uuid not null,
  changed_by uuid,
  field_changed text not null,
  old_value text,
  new_value text,
  changed_at timestamp with time zone not null default now()
);
alter table public.term_rating_audit add constraint term_rating_audit_pkey PRIMARY KEY (id);
alter table public.term_rating_audit add constraint term_rating_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.teacher(id) ON DELETE SET NULL;
alter table public.term_rating_audit add constraint term_rating_audit_term_rating_id_fkey FOREIGN KEY (term_rating_id) REFERENCES public.term_rating(id) ON DELETE CASCADE;
CREATE INDEX term_rating_audit_changed_at_idx ON public.term_rating_audit USING btree (changed_at);
CREATE INDEX term_rating_audit_changed_by_idx ON public.term_rating_audit USING btree (changed_by);
CREATE INDEX term_rating_audit_parent_idx ON public.term_rating_audit USING btree (term_rating_id, changed_at DESC);
alter table public.term_rating_audit enable row level security;
create policy term_rating_audit_read on public.term_rating_audit for select to public using (public.fv_owns_term_rating(term_rating_id));

-- migrations/20261102_audit_helpers_owner_check.sql
create or replace function public._term_rating_audit_field(
    p_tr_id uuid, p_field text, p_old text, p_new text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if not fv_owns_term_rating(p_tr_id) then
        return;
    end if;
    if p_old is distinct from p_new then
        insert into term_rating_audit (term_rating_id, changed_by, field_changed, old_value, new_value)
        values (p_tr_id, (select auth.uid()), p_field, p_old, p_new);
    end if;
end; $function$;

-- docs/backend-design/write-paths.sql: both audit writers are called by
-- SECURITY INVOKER RPCs, so signed-in teachers keep EXECUTE.
revoke all on function public._term_rating_audit_field(uuid, text, text, text) from public;
grant execute on function public._term_rating_audit_field(uuid, text, text, text) to authenticated;
revoke all on function public._score_audit_diff(uuid, numeric, numeric, text, text) from public;
grant execute on function public._score_audit_diff(uuid, numeric, numeric, text, text) to authenticated;

-- ── A sentence starter changes every one of its teacher's classes ───────────
-- migrations/20261022_teacher_sentence_starters.sql. The trigger is the one
-- make-score-tables.py leaves out of observation_template.
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

CREATE TRIGGER teacher_sync_cursor_observation_template_student_records AFTER INSERT OR DELETE OR UPDATE ON public.observation_template FOR EACH ROW EXECUTE FUNCTION public._touch_teacher_sync_cursor_from_trigger('student-records');

-- migrations/20261015_course_sync_version.sql: no caller runs either cursor
-- function directly.
revoke execute on function public._touch_course_sync_cursor_from_trigger() from public, anon, authenticated;
revoke execute on function public._touch_course_sync_cursor(uuid, text) from public, anon, authenticated;

-- ── The 30-day purge ────────────────────────────────────────────────────────
-- migrations/20261012_course_soft_delete.sql
create or replace function public.fv_retention_cleanup()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _teachers_purged int;
    _courses_purged int;
    _students_purged int;
    _purge_students uuid[];
    _score_audit_purged int;
    _tr_audit_purged    int;
begin
    -- Hard-delete teachers whose soft-delete passed the 30-day grace window.
    -- Cascades: teacher → student/enrollment/score/observation/term_rating/etc.
    delete from teacher
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _teachers_purged = row_count;

    -- Hard-delete classes whose soft-delete passed the 30-day grace window.
    -- Cascades through enrollment, assessment, observation, etc. Remember
    -- their students first so the ones left with no class go too.
    select coalesce(array_agg(distinct e.student_id), '{}')
      into _purge_students
      from enrollment e
      join course c on c.id = e.course_id
     where c.deleted_at is not null
       and c.deleted_at < now() - interval '30 days';

    delete from course
     where deleted_at is not null
       and deleted_at < now() - interval '30 days';
    get diagnostics _courses_purged = row_count;

    delete from student s
     where s.id = any(_purge_students)
       and not exists (select 1 from enrollment e where e.student_id = s.id);
    get diagnostics _students_purged = row_count;

    -- Audit retention: 2 years.
    delete from score_audit where changed_at < now() - interval '2 years';
    get diagnostics _score_audit_purged = row_count;

    delete from term_rating_audit where changed_at < now() - interval '2 years';
    get diagnostics _tr_audit_purged = row_count;

    return jsonb_build_object(
        'teachers_purged',     _teachers_purged,
        'courses_purged',      _courses_purged,
        'students_purged',     _students_purged,
        'score_audit_purged',  _score_audit_purged,
        'term_rating_audit_purged', _tr_audit_purged,
        'ran_at', now()
    );
end; $function$;

revoke execute on function public.fv_retention_cleanup() from public, anon, authenticated;

-- ── rls_auto_enable ─────────────────────────────────────────────────────────
-- The repo has no migration for it: it came with the Supabase project ("turn
-- row security on for every new table in public"). This is the live
-- definition, exactly as pg_get_functiondef printed it on gradebook-prod on
-- 2026-11-10 (read by the orchestrator; md5 846ec2fbff751d24b890656d63c3a9bf,
-- length 1223, which search_path.py checks). Live, it is the function of the
-- event trigger ensure_rls, on ddl_command_end.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

create event trigger ensure_rls on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    execute function public.rls_auto_enable();
