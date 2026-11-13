-- The database's baseline as loadable SQL, for migrations/baseline/
-- (docs/database-rebuild.md). Run by .github/workflows/db-baseline.yml as
-- the read-only fv_schema_reader role:
--
--   psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f scripts/db-baseline.sql -o db-baseline.out
--
-- It reads the system catalogs only, never a row of an app table. It prints
-- what docs/schema.generated.sql cannot give: function and procedure bodies,
-- types, sequences, views, policies (with permissive or restrictive), grants
-- to the client roles, event triggers, and the app's pieces outside its two
-- schemas. Tables, columns, keys, indexes and triggers come from
-- docs/schema.generated.sql (scripts/db-rebuild.mjs makes them).
--
-- Each part starts with a line "-- @file NAME". node scripts/db-rebuild.mjs
-- --import db-baseline.out writes each part to migrations/baseline/NAME.
-- Every part is in a fixed order, so the same database prints the same text.
--
-- The search path is pg_catalog alone, so every name prints with its schema
-- (public.course). That makes the SQL loadable anywhere, and it is how
-- docs/schema.generated.sql prints names too.
set search_path = pg_catalog;

-- Things this baseline does not rebuild, or that a reader should know are
-- there. Information only: nothing loads this part.
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit')),
lines as (
  select 'extension ' || e.extname || ' ' || e.extversion || ' in schema ' || n.nspname as line
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  union all
  select 'schema ' || n.nspname
  from pg_namespace n
  where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  union all
  select 'not loaded, routine of kind ' || p.prokind::text || ': ' || p.oid::regprocedure::text
  from pg_proc p join app on app.oid = p.pronamespace
  where p.prokind in ('a', 'w')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'function with a SQL-standard body (parsed when made): ' || p.oid::regprocedure::text
  from pg_proc p join app on app.oid = p.pronamespace
  where p.prosqlbody is not null
  union all
  select 'not loaded, identity or generated column: ' || c.oid::regclass::text || '.' || quote_ident(a.attname)
    || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
  from pg_attribute a join pg_class c on c.oid = a.attrelid join app on app.oid = c.relnamespace
  where a.attnum > 0 and not a.attisdropped and (a.attidentity <> '' or a.attgenerated <> '')
  union all
  select 'not loaded, relation of kind ' || c.relkind::text || ': ' || c.oid::regclass::text
  from pg_class c join app on app.oid = c.relnamespace
  where c.relkind in ('p', 'f')
  union all
  select 'not loaded, unlogged table: ' || c.oid::regclass::text
  from pg_class c join app on app.oid = c.relnamespace
  where c.relpersistence = 'u'
  union all
  select 'not loaded, type of kind ' || t.typtype::text || ': ' || t.oid::regtype::text
  from pg_type t join app on app.oid = t.typnamespace
  where t.typtype in ('r', 'm')
  union all
  select 'event trigger ' || quote_ident(e.evtname) || ' on ' || e.evtevent || ' runs ' || e.evtfoid::regprocedure::text
    || ' (enabled ' || e.evtenabled::text || ')'
  from pg_event_trigger e
  union all
  select 'policy outside the app schemas: ' || pol.polname || ' on ' || pol.polrelid::regclass::text
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relnamespace not in (select oid from app)
  union all
  select 'publication ' || p.pubname || ' has ' || pr.prrelid::regclass::text
    || case when pr.prqual is not null then ' (with a row filter)' else '' end
    || case when pr.prattrs is not null then ' (with a column list)' else '' end
  from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
  union all
  select 'publication ' || p.pubname || ' for all tables' from pg_publication p where p.puballtables
  union all
  select 'default privileges for role ' || r.rolname || coalesce(' in schema ' || n.nspname, '')
    || ' on ' || d.defaclobjtype::text || ': ' || d.defaclacl::text
  from pg_default_acl d join pg_roles r on r.oid = d.defaclrole left join pg_namespace n on n.oid = d.defaclnamespace
)
select '-- @file checks.txt' || E'\n' || coalesce(string_agg(line, E'\n' order by line), '') from lines;

-- Enums, then domains, then composite types: a domain may be over an enum,
-- and a composite type may use either.
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit')),
types as (
  select t.oid, t.typtype, app.nspname, t.typname, t.typrelid, t.typbasetype, t.typtypmod, t.typnotnull, t.typdefault
  from pg_type t join app on app.oid = t.typnamespace
  where (t.typtype in ('e', 'd') or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
    and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')
),
lines as (
  select 1 as ord, nspname, typname,
         format('create type %I.%I as enum (%s);', nspname, typname,
                (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)
                   from pg_enum e where e.enumtypid = types.oid)) as line
  from types where typtype = 'e'
  union all
  select 2, nspname, typname,
         format('create domain %I.%I as %s', nspname, typname, format_type(typbasetype, typtypmod))
           || coalesce(' default ' || typdefault, '')
           || case when typnotnull then ' not null' else '' end
           || coalesce((select string_agg(' constraint ' || quote_ident(co.conname) || ' ' || pg_get_constraintdef(co.oid), '' order by co.conname)
                          from pg_constraint co where co.contypid = types.oid), '')
           || ';'
  from types where typtype = 'd'
  union all
  select 3, nspname, typname,
         format('create type %I.%I as (%s);', nspname, typname,
                coalesce((select string_agg(E'\n  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
                            from pg_attribute a where a.attrelid = types.typrelid and a.attnum > 0 and not a.attisdropped) || E'\n', ''))
  from types where typtype = 'c'
)
select '-- @file 10-types.sql' || E'\n' || coalesce(string_agg(line, E'\n' order by ord, nspname, typname), '') from lines;

-- Sequences, except those an identity column makes for itself.
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit'))
select '-- @file 20-sequences.sql' || E'\n' || coalesce(string_agg(
         format('create sequence %I.%I as %s increment by %s minvalue %s maxvalue %s start with %s cache %s%s;',
                app.nspname, c.relname, format_type(s.seqtypid, null), s.seqincrement, s.seqmin, s.seqmax,
                s.seqstart, s.seqcache, case when s.seqcycle then ' cycle' else ' no cycle' end),
         E'\n' order by app.nspname, c.relname), '')
from pg_sequence s
join pg_class c on c.oid = s.seqrelid
join app on app.oid = c.relnamespace
where not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('i', 'e'));

-- Every function and procedure, whole. Aggregates and window functions are
-- listed in checks.txt instead (pg_get_functiondef cannot print them).
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit'))
select '-- @file 30-functions.sql' || E'\n'
       || E'-- Bodies are read when a routine runs, not when it is made, so the order\n'
       || E'-- below (by name) needs nothing else to exist first.\n'
       || E'set check_function_bodies = off;\n\n'
       || coalesce(string_agg(rtrim(pg_get_functiondef(p.oid), E'\n') || ';', E'\n\n'
                              order by app.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '')
from pg_proc p
join app on app.oid = p.pronamespace
where p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

-- One line per function and procedure, for the proof: its signature, the
-- md5 of pg_get_functiondef, and that text's length.
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit'))
select '-- @file function-md5.txt' || E'\n' || coalesce(string_agg(
         app.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
           || md5(pg_get_functiondef(p.oid)) || ' ' || length(pg_get_functiondef(p.oid)),
         E'\n' order by app.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '')
from pg_proc p
join app on app.oid = p.pronamespace
where p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

-- Views and materialized views, each after the views it reads.
with recursive app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit')),
views as (
  select c.oid, c.relkind, app.nspname, c.relname, c.reloptions
  from pg_class c join app on app.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
),
reads as (
  select distinct r.ev_class as view, d.refobjid as other
  from pg_rewrite r
  join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid and d.refclassid = 'pg_class'::regclass
  where r.ev_class in (select oid from views) and d.refobjid in (select oid from views) and d.refobjid <> r.ev_class
),
depth(oid, n) as (
  select oid, 0 from views
  union all
  select reads.view, depth.n + 1 from depth join reads on reads.other = depth.oid where depth.n < 50
)
select '-- @file 40-views.sql' || E'\n' || coalesce(string_agg(
         format('create %s %I.%I%s as%s%s;',
                case relkind when 'm' then 'materialized view' else 'view' end, nspname, relname,
                coalesce(' with (' || array_to_string(reloptions, ', ') || ')', ''),
                E'\n', regexp_replace(pg_get_viewdef(views.oid, true), ';\s*$', ''))
           || case relkind when 'm' then E'\n-- (made empty: refresh it to fill it)' else '' end,
         E'\n\n' order by d.n, nspname, relname), '')
from views join (select oid, max(n) as n from depth group by oid) d on d.oid = views.oid;

-- Policies, sequence owners, row security that binds owners too, the
-- realtime publication's app tables, and the app's pieces outside its two
-- schemas: triggers on others' tables (auth.users), policies on
-- storage.objects and storage.buckets, and event triggers.
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit')),
policies as (
  select pol.oid, c.relnamespace, pol.polrelid, pol.polname,
         format('create policy %I on %s as %s for %s to %s', pol.polname, pol.polrelid::regclass::text,
                case when pol.polpermissive then 'permissive' else 'restrictive' end,
                case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                                when 'd' then 'delete' else 'all' end,
                (select string_agg(case when r = 0 then 'public' else quote_ident((select rolname from pg_roles where oid = r)) end, ', ' order by 1)
                   from unnest(pol.polroles) r))
           || coalesce(E'\n  using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')', '')
           || coalesce(E'\n  with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')', '')
           || ';' as line
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
),
lines as (
  select 1 as ord, polrelid::regclass::text as k, polname::text as k2, line
  from policies where relnamespace in (select oid from app)
  union all
  select 2, c.oid::regclass::text, '',
         format('alter sequence %s owned by %s.%I;', c.oid::regclass::text, d.refobjid::regclass::text,
                (select attname from pg_attribute where attrelid = d.refobjid and attnum = d.refobjsubid))
  from pg_class c join app on app.oid = c.relnamespace
  join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'a'
                  and d.refclassid = 'pg_class'::regclass and d.refobjsubid > 0
  where c.relkind = 'S'
  union all
  select 3, c.oid::regclass::text, '', format('alter table %s force row level security;', c.oid::regclass::text)
  from pg_class c join app on app.oid = c.relnamespace
  where c.relforcerowsecurity
  union all
  select 4, pr.prrelid::regclass::text, '', format('alter publication %I add table %s;', p.pubname, pr.prrelid::regclass::text)
  from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
  join pg_class c on c.oid = pr.prrelid
  where p.pubname = 'supabase_realtime' and c.relnamespace in (select oid from app)
  union all
  -- Triggers on views in the app schemas, and on tables outside them that
  -- run an app function (auth.users).
  select 5, tg.tgrelid::regclass::text, tg.tgname::text, pg_get_triggerdef(tg.oid) || ';'
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_proc p on p.oid = tg.tgfoid
  where not tg.tgisinternal
    and ((c.relnamespace in (select oid from app) and c.relkind in ('v', 'm'))
         or (c.relnamespace not in (select oid from app) and p.pronamespace in (select oid from app)))
  union all
  select 6, polrelid::regclass::text, polname::text, line
  from policies
  -- By name, not 'storage.objects'::regclass: reading that would need a
  -- grant on the storage schema, which the reader role does not have.
  where polrelid in (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'storage' and c.relname in ('objects', 'buckets'))
  union all
  select 7, e.evtname::text, '',
         format('create event trigger %I on %s%s execute function %s();', e.evtname, e.evtevent,
                coalesce(' when tag in (' || (select string_agg(quote_literal(t), ', ' order by t) from unnest(e.evttags) t) || ')', ''),
                format('%I.%I', p_n.nspname, p.proname))
           || case e.evtenabled when 'D' then format(E'\nalter event trigger %I disable;', e.evtname) else '' end
  from pg_event_trigger e
  join pg_proc p on p.oid = e.evtfoid
  join pg_namespace p_n on p_n.oid = p.pronamespace
  where p.pronamespace in (select oid from app)
)
select '-- @file 50-policies-and-links.sql' || E'\n' || coalesce(string_agg(line, E'\n' order by ord, k, k2, line), '') from lines;

-- Grants to anon, authenticated, service_role and public, on the app's
-- schemas, tables, views, sequences, columns, routines and types. Where an
-- object's privileges were ever changed (its ACL is not empty), the part
-- first takes everything from public, then grants what the ACL lists. An
-- object never changed keeps PostgreSQL's defaults, as it would here.
-- Grants to other roles (postgres, Supabase's own) and owners are left out.
with app as (select oid, nspname from pg_namespace where nspname in ('public', 'student_submit')),
obj as (
  select 1 as ord, 'schema' as kind, quote_ident(n.nspname) as name, n.nspacl as acl, n.nspowner as owner
  from pg_namespace n where n.oid in (select oid from app)
  union all
  select 2, case c.relkind when 'S' then 'sequence' else 'table' end, c.oid::regclass::text, c.relacl, c.relowner
  from pg_class c
  where c.relnamespace in (select oid from app) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  union all
  select 3, 'routine', format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), p.proacl, p.proowner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.oid in (select oid from app) and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  union all
  select 4, 'type', t.oid::regtype::text, t.typacl, t.typowner
  from pg_type t
  where t.typnamespace in (select oid from app)
    and (t.typtype in ('e', 'd') or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
    and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')
),
grants as (
  select distinct o.ord, o.kind, o.name, case when a.grantee = 0 then 'public' else quote_ident(r.rolname) end as grantee,
         a.privilege_type, a.is_grantable
  from obj o
  cross join lateral aclexplode(o.acl) a
  left join pg_roles r on r.oid = a.grantee
  where o.acl is not null and a.grantee <> o.owner
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))
),
cols as (
  select distinct c.oid::regclass::text as name, a.attname, case when x.grantee = 0 then 'public' else quote_ident(r.rolname) end as grantee,
         x.privilege_type, x.is_grantable
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  cross join lateral aclexplode(a.attacl) x
  left join pg_roles r on r.oid = x.grantee
  where c.relnamespace in (select oid from app) and a.attacl is not null and a.attnum > 0 and not a.attisdropped
    and x.grantee <> c.relowner and (x.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))
),
lines as (
  select ord, name, 0 as sub, '' as k, format('revoke all on %s %s from public;', kind, name) as line
  from obj where acl is not null
  union all
  select ord, name, 1, grantee,
         format('grant %s on %s %s to %s%s;', string_agg(lower(privilege_type), ', ' order by lower(privilege_type)), kind, name, grantee,
                case when is_grantable then ' with grant option' else '' end)
  from grants group by ord, kind, name, grantee, is_grantable
  union all
  select 5, name, 1, attname || ' ' || grantee,
         format('grant %s (%I) on table %s to %s%s;', string_agg(lower(privilege_type), ', ' order by lower(privilege_type)), attname, name, grantee,
                case when is_grantable then ' with grant option' else '' end)
  from cols group by name, attname, grantee, is_grantable
)
select '-- @file 60-grants.sql' || E'\n' || coalesce(string_agg(line, E'\n' order by ord, name, sub, k, line), '') from lines;
