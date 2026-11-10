"""Everything this database holds outside the system schemas, one line each,
for comparing two states of it line by line.

In every schema but pg_* and information_schema: schemas; functions and
procedures (md5 of the whole definition, owner, grants, and separately
language, volatility, SECURITY DEFINER, settings, cost, result, argument
defaults and comment); tables (owner, grants, row security); every other
relation (views, sequences, materialized views: kind, options, comment);
view definitions and rules; columns (type, default, null, and separately
identity, storage, collation, comment); how many dropped-column slots each
table carries; constraints; indexes; triggers and how many internal ones;
policies; types; sequences; statistics objects; inheritance.

Database-wide: default privileges; how many comments there are on each
kind of object; event triggers; extensions; publications and their tables;
user-made casts, operators, aggregates and collations; foreign servers;
large objects; the database's own grants; the shape of pg_depend. Where
they exist: pg_cron's jobs (cron.job) and the migration record
(supabase_migrations.schema_migrations).

NOT here, because they belong to the whole server and other sessions on a
shared test server change them: roles, role memberships, per-role settings.
Batch A makes none.

  from catalog import catalog, row_checksums, differences
  catalog(connection)                 -> [lines]
  differences(before, after)          -> ([lines only before], [lines only after])
  row_checksums(connection, tables)   -> {table: (rows, md5 of every row)}

PGPORT=54329 PGDATABASE=fv_a python3 catalog.py > /tmp/catalog.txt
"""
import os, sys
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

NS = "n.nspname !~ '^pg_' and n.nspname <> 'information_schema'"
ROW_SCHEMAS = "n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'cron', 'supabase_migrations')"

def catalog(c):
    out = []
    def add(kind, sql):
        for r in c.run(sql): out.append(kind + ' ' + ' | '.join('' if v is None else str(v) for v in r))
    add('schema', f"""select n.nspname, n.nspowner::regrole::text, coalesce(n.nspacl::text, ''), coalesce(obj_description(n.oid, 'pg_namespace'), '')
                        from pg_namespace n where {NS} order by 1""")
    add('function', f"""select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.prokind,
                               md5(pg_get_functiondef(p.oid)), p.proowner::regrole::text, coalesce(p.proacl::text, '')
                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where {NS} and p.prokind in ('f', 'p') order by 1""")
    add('function more', f"""select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.prokind, l.lanname,
                               p.provolatile, p.proisstrict, p.prosecdef, p.proleakproof, p.proparallel, p.procost, p.prorows, p.proretset,
                               coalesce(p.proconfig::text, ''), pg_get_function_result(p.oid), md5(pg_get_function_arguments(p.oid)),
                               md5(p.prosrc), p.prosupport::text, coalesce(obj_description(p.oid, 'pg_proc'), '')
                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
                         where {NS} order by 1""")
    add('table', f"""select n.nspname || '.' || c.relname, c.relowner::regrole::text, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity
                       from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where {NS} and c.relkind = 'r' order by 1""")
    add('relation', f"""select n.nspname || '.' || c.relname, c.relkind, c.relpersistence, c.relowner::regrole::text, coalesce(c.relacl::text, ''),
                               c.relreplident, coalesce(c.reloptions::text, ''), c.relispartition, coalesce(obj_description(c.oid, 'pg_class'), '')
                          from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where {NS} and c.relkind not in ('i', 'I') order by 1""")
    add('view', f"""select n.nspname || '.' || c.relname, c.relkind, pg_get_viewdef(c.oid)
                      from pg_class c join pg_namespace n on n.oid = c.relnamespace where {NS} and c.relkind in ('v', 'm') order by 1""")
    add('rule', f"""select n.nspname || '.' || c.relname, r.rulename, r.ev_type, pg_get_ruledef(r.oid)
                      from pg_rewrite r join pg_class c on c.oid = r.ev_class join pg_namespace n on n.oid = c.relnamespace
                     where {NS} order by 1, 2""")
    add('column', f"""select n.nspname || '.' || c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                             coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')
                        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                       where {NS} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by 1, 3""")
    add('column more', f"""select n.nspname || '.' || c.relname, a.attname, c.relkind, a.attidentity, a.attgenerated, a.attstorage,
                             a.attcollation::regcollation::text, coalesce(a.attoptions::text, ''), coalesce(a.attstattarget::text, ''),
                             coalesce(col_description(c.oid, a.attnum), '')
                        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                       where {NS} and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped order by 1, 2""")
    # A dropped column keeps its slot in the table for good (it reads as
    # null and takes no room in new rows). The one trace PART 2 leaves.
    add('dropped columns', f"""select n.nspname || '.' || c.relname, count(*)
                                 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                                where {NS} and c.relkind in ('r', 'p') and a.attnum > 0 and a.attisdropped group by 1 order by 1""")
    add('constraint', f"""select conrelid::regclass::text, conname, contype, pg_get_constraintdef(oid) from pg_constraint
                           where connamespace::regnamespace::text !~ '^pg_' and connamespace::regnamespace::text <> 'information_schema'
                             and conrelid <> 0 and contype <> 'n' order by 1, 2""")
    add('constraint more', f"""select n.nspname, coalesce(nullif(co.conrelid, 0)::regclass::text, ''), coalesce(nullif(co.contypid, 0)::regtype::text, ''),
                                 co.conname, co.contype, co.condeferrable, co.condeferred, co.convalidated,
                                 coalesce(obj_description(co.oid, 'pg_constraint'), '')
                            from pg_constraint co join pg_namespace n on n.oid = co.connamespace
                           where {NS} and co.contype <> 'n' order by 1, 2, 3, 4""")
    add('index', f"""select schemaname || '.' || tablename, indexname, indexdef from pg_indexes
                      where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2""")
    add('index more', f"""select n.nspname || '.' || c.relname, i.indisunique, i.indisprimary, i.indisvalid, i.indisready, i.indisclustered,
                                 i.indisreplident, coalesce(c.reloptions::text, ''), coalesce(obj_description(c.oid, 'pg_class'), '')
                            from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
                           where {NS} order by 1""")
    add('trigger', f"""select t.tgrelid::regclass::text, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) from pg_trigger t
                         join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                        where not t.tgisinternal and {NS} order by 1, 2""")
    add('trigger comment', f"""select t.tgrelid::regclass::text, t.tgname, obj_description(t.oid, 'pg_trigger') from pg_trigger t
                                 join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                                where not t.tgisinternal and {NS} and obj_description(t.oid, 'pg_trigger') is not null order by 1, 2""")
    add('internal triggers', f"""select t.tgrelid::regclass::text, count(*) from pg_trigger t
                                   join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                                  where t.tgisinternal and {NS} group by 1 order by 1""")
    add('policy', f"""select schemaname || '.' || tablename, policyname, permissive, roles::text, cmd, coalesce(qual, ''), coalesce(with_check, '')
                        from pg_policies where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2""")
    add('policy comment', """select p.polrelid::regclass::text, p.polname, obj_description(p.oid, 'pg_policy') from pg_policy p
                              where obj_description(p.oid, 'pg_policy') is not null order by 1, 2""")
    add('type', f"""select n.nspname || '.' || t.typname, t.typtype from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where {NS} and t.typtype in ('c', 'e', 'd')
                       and not exists (select 1 from pg_class c where c.reltype = t.oid and c.relkind <> 'c') order by 1""")
    add('type more', f"""select n.nspname || '.' || t.typname, t.typtype, t.typowner::regrole::text, coalesce(t.typacl::text, ''),
                                coalesce(nullif(t.typbasetype, 0)::regtype::text, ''), t.typnotnull,
                                coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')
                           from pg_type t join pg_namespace n on n.oid = t.typnamespace
                          where {NS} and t.typtype in ('c', 'e', 'd', 'r', 'm') and t.typrelid = 0 order by 1""")
    add('default privileges', """select defaclrole::regrole::text, coalesce(defaclnamespace::regnamespace::text, ''), defaclobjtype, defaclacl::text
                                   from pg_default_acl order by 1, 2, 3""")
    add('comment', f"""select c.relnamespace::regnamespace::text || '.' || c.relname, coalesce(a.attname, ''), d.description
                         from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
                         left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
                        where c.relnamespace::regnamespace::text !~ '^pg_' and c.relnamespace::regnamespace::text <> 'information_schema' order by 1, 2""")
    # Every comment on anything made here, by the kind of thing it is on.
    add('comments on', "select classoid::regclass::text, count(*) from pg_description where objoid >= 16384 group by 1 order by 1")
    add('sequence', f"select schemaname || '.' || sequencename from pg_sequences where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1")
    add('sequence more', f"""select n.nspname || '.' || c.relname, s.seqtypid::regtype::text, s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcycle
                               from pg_sequence s join pg_class c on c.oid = s.seqrelid join pg_namespace n on n.oid = c.relnamespace
                              where {NS} order by 1""")
    add('statistics', "select stxnamespace::regnamespace::text, stxname, stxrelid::regclass::text from pg_statistic_ext order by 1, 2")
    add('inherits', "select inhrelid::regclass::text, inhparent::regclass::text from pg_inherits order by 1, 2")
    add('event trigger', """select evtname, evtevent, evtowner::regrole::text, evtfoid::regproc::text, evtenabled, coalesce(evttags::text, '')
                              from pg_event_trigger order by 1""")
    add('extension', "select extname, extversion, extnamespace::regnamespace::text from pg_extension order by 1")
    add('publication', "select pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate from pg_publication order by 1")
    add('publication table', """select p.pubname, r.prrelid::regclass::text from pg_publication_rel r join pg_publication p on p.oid = r.prpubid order by 1, 2""")
    add('made here', """select 'casts', count(*) from pg_cast where oid >= 16384
                        union all select 'operators', count(*) from pg_operator where oid >= 16384
                        union all select 'aggregates', count(*) from pg_aggregate where aggfnoid >= 16384
                        union all select 'collations', count(*) from pg_collation where oid >= 16384
                        union all select 'foreign servers', count(*) from pg_foreign_server
                        union all select 'foreign data wrappers', count(*) from pg_foreign_data_wrapper
                        union all select 'user mappings', count(*) from pg_user_mapping
                        union all select 'large objects', count(*) from pg_largeobject_metadata
                        union all select 'security labels', count(*) from pg_seclabel
                        union all select 'initial privileges', count(*) from pg_init_privs where objoid >= 16384 order by 1""")
    add('database', "select coalesce(datacl::text, ''), datconnlimit from pg_database where datname = current_database()")
    add('depends', """select classid::regclass::text, refclassid::regclass::text, deptype, count(*) from pg_depend
                       where objid >= 16384 group by 1, 2, 3 order by 1, 2, 3""")
    if c.run("select to_regclass('cron.job') is not null")[0][0]:
        add('cron job', "select jobname, schedule, command, database, username, active from cron.job order by 1, 2, 3")
    if c.run("select to_regclass('supabase_migrations.schema_migrations') is not null")[0][0]:
        add('migration record', "select version, name from supabase_migrations.schema_migrations order by 1")
    return out

def differences(before, after):
    """The lines only the first has, and the lines only the second has."""
    a, b = set(before), set(after)
    return [l for l in before if l not in b], [l for l in after if l not in a]

def row_checksums(c, columns=None):
    """{schema.table: [row count, md5 of every row]} for every table (the migration record and
    pg_cron's own tables apart: catalog() lists those), or only for the tables and columns given
    as {schema.table: [column, ...]} (rows compared on those columns alone). Columns go by name,
    so a column's position does not matter."""
    if columns is None:
        columns = table_columns(c)
    out = {}
    for t, cols in sorted(columns.items()):
        if not c.run('select to_regclass(:t) is not null', t=t)[0][0]:
            out[t] = None; continue
        row = "jsonb_build_array(" + ', '.join('to_jsonb(x.%s)' % ('"%s"' % col) for col in sorted(cols)) + ")::text"
        out[t] = list(c.run(f"select count(*), coalesce(md5(string_agg({row}, '|' order by {row})), '') from {t} x")[0])
    return out

def table_columns(c):
    """{schema.table: [column, ...]} for every table row_checksums covers."""
    columns = {}
    for t, col in c.run(f"""select n.nspname || '.' || c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
                              join pg_namespace n on n.oid = c.relnamespace
                             where {ROW_SCHEMAS} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by 1, a.attnum"""):
        columns.setdefault(t, []).append(col)
    return columns

if __name__ == '__main__':
    c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                      database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
    print('\n'.join(catalog(c)))
