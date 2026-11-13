-- 2026-11-13: the signed-out and signed-in roles may no longer create
-- objects in schema public.
--
-- What was wrong. The roles the browser uses (anon when signed out,
-- authenticated when signed in) held CREATE on schema public, a grant from
-- the project's first setup. Nothing in FullVision uses it: the browser
-- reaches the database only through the API, which runs no CREATE, and no
-- function in public, student_submit or fv_private creates an object. The
-- security rule tests' read of the catalogs showed the grant.
--
-- Why it matters. A role that can create in public could, if it ever found
-- a way to run its own SQL, add a table or function beside the app's own.
-- Taking the grant away costs nothing and closes that door.
--
-- What it does. One revoke. USAGE stays, so every table, view and function
-- is reached as before. service_role (the edge functions' key) and the
-- owner are untouched. The checks below stop the migration if the revoke
-- did not take, or if it took more than CREATE.
--
-- Safe to run twice.
-- Undo: grant create on schema public to anon, authenticated;

revoke create on schema public from anon, authenticated;

do $$
begin
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'anon or authenticated can still create in schema public';
  end if;
  if not has_schema_privilege('anon', 'public', 'USAGE')
     or not has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'anon or authenticated lost USAGE on schema public';
  end if;
  if not has_schema_privilege('service_role', 'public', 'USAGE') then
    raise exception 'service_role lost USAGE on schema public';
  end if;
end
$$;
