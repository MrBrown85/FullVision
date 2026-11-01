-- The database's shape as text, for docs/schema.generated.sql
-- (scripts/schema-snapshot.mjs). Reads the system catalogs only, so the
-- read-only fv_schema_reader role can run it and every role gets the same
-- answer. Function bodies are left out; signatures, SECURITY DEFINER,
-- tables, columns, constraints, indexes, triggers and RLS policies are in.
with t as (
  select n.nspname, c.relname, c.oid, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'student_submit') and c.relkind in ('r', 'p')
),
lines as (
  select 1 as sec, t.nspname || '.' || t.relname as k, 0 as sub, '' as k2,
         'table ' || t.nspname || '.' || t.relname || case when t.relrowsecurity then ' (rls on)' else '' end as line
  from t
  union all
  select 1, t.nspname || '.' || t.relname, 1, lpad(a.attnum::text, 5, '0'),
         '  ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' not null' else '' end
           || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
  from t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
  union all
  select 1, t.nspname || '.' || t.relname, 2, co.conname,
         '  constraint ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
  from t join pg_constraint co on co.conrelid = t.oid
  union all
  select 1, t.nspname || '.' || t.relname, 3, ic.relname,
         '  ' || pg_get_indexdef(i.indexrelid)
  from t
  join pg_index i on i.indrelid = t.oid
  join pg_class ic on ic.oid = i.indexrelid
  union all
  select 1, t.nspname || '.' || t.relname, 4, tg.tgname,
         '  ' || pg_get_triggerdef(tg.oid)
  from t join pg_trigger tg on tg.tgrelid = t.oid and not tg.tgisinternal
  union all
  select 1, t.nspname || '.' || t.relname, 5, pol.polname,
         '  policy ' || pol.polname || ' for '
           || case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                              when 'd' then 'delete' else 'all' end
           || ' to ' || coalesce((select string_agg(case when r = 0 then 'public' else (select rolname from pg_roles where oid = r) end, ', ' order by 1)
                                  from unnest(pol.polroles) r), 'public')
           || coalesce(' using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')', '')
           || coalesce(' with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')', '')
  from t join pg_policy pol on pol.polrelid = t.oid
  union all
  select 2, n.nspname || '.' || p.proname, 0, pg_get_function_identity_arguments(p.oid),
         'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') returns '
           || pg_get_function_result(p.oid)
           || case when p.prosecdef then ' security definer' else '' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'student_submit')
    and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
)
select string_agg(line, E'\n' order by sec, k, sub, k2) from lines;
