"""Everything the schema holds, one line each, for comparing two states of a
database line by line: schemas, functions and procedures (md5 of the whole
definition, owner, grants), tables (grants, row security), columns (type,
default, null), constraints, indexes, triggers, policies, types, default
privileges and comments, in public, fv_private, student_submit and cron.

  from catalog import catalog, row_checksums
  catalog(connection)                 -> [lines]
  row_checksums(connection, tables)   -> {table: (rows, md5 of every row)}

PGPORT=54329 PGDATABASE=fv_a python3 catalog.py > /tmp/catalog.txt
"""
import os, sys
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

SCHEMAS = "('public', 'fv_private', 'student_submit')"

def catalog(c):
    out = []
    def add(kind, sql):
        for r in c.run(sql): out.append(kind + ' ' + ' | '.join('' if v is None else str(v) for v in r))
    add('schema', f"select nspname, nspowner::regrole::text, coalesce(nspacl::text, '') from pg_namespace where nspname in {SCHEMAS} order by 1")
    add('function', f"""select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.prokind,
                               md5(pg_get_functiondef(p.oid)), p.proowner::regrole::text, coalesce(p.proacl::text, '')
                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname in {SCHEMAS} and p.prokind in ('f', 'p') order by 1""")
    add('table', f"""select n.nspname || '.' || c.relname, c.relowner::regrole::text, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity
                       from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname in {SCHEMAS} and c.relkind = 'r' order by 1""")
    add('column', f"""select n.nspname || '.' || c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                             coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')
                        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                       where n.nspname in {SCHEMAS} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by 1, 3""")
    add('constraint', f"""select conrelid::regclass::text, conname, contype, pg_get_constraintdef(oid) from pg_constraint
                           where connamespace::regnamespace::text in {SCHEMAS} and conrelid <> 0 and contype <> 'n' order by 1, 2""")
    add('index', f"select schemaname || '.' || tablename, indexname, indexdef from pg_indexes where schemaname in {SCHEMAS} order by 1, 2")
    add('trigger', f"""select t.tgrelid::regclass::text, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) from pg_trigger t
                         join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                        where not t.tgisinternal and n.nspname in {SCHEMAS} order by 1, 2""")
    add('policy', f"""select schemaname || '.' || tablename, policyname, permissive, roles::text, cmd, coalesce(qual, ''), coalesce(with_check, '')
                        from pg_policies where schemaname in {SCHEMAS} order by 1, 2""")
    add('type', f"""select n.nspname || '.' || t.typname, t.typtype from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname in {SCHEMAS} and t.typtype in ('c', 'e', 'd')
                       and not exists (select 1 from pg_class c where c.reltype = t.oid and c.relkind <> 'c') order by 1""")
    add('default privileges', """select defaclrole::regrole::text, coalesce(defaclnamespace::regnamespace::text, ''), defaclobjtype, defaclacl::text
                                   from pg_default_acl order by 1, 2, 3""")
    add('comment', f"""select c.relnamespace::regnamespace::text || '.' || c.relname, coalesce(a.attname, ''), d.description
                         from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
                         left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
                        where c.relnamespace::regnamespace::text in {SCHEMAS} order by 1, 2""")
    add('sequence', f"select schemaname || '.' || sequencename from pg_sequences where schemaname in {SCHEMAS} order by 1")
    return out

def row_checksums(c, columns=None):
    """{schema.table: [row count, md5 of every row]} for every table, or only for the tables and
    columns given as {schema.table: [column, ...]} (rows compared on those columns alone)."""
    if columns is None:
        columns = {}
        for t, col in c.run(f"""select n.nspname || '.' || c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
                                  join pg_namespace n on n.oid = c.relnamespace
                                 where n.nspname in {SCHEMAS} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by 1, a.attnum"""):
            columns.setdefault(t, []).append(col)
    out = {}
    for t, cols in sorted(columns.items()):
        if not c.run('select to_regclass(:t) is not null', t=t)[0][0]:
            out[t] = None; continue
        row = "jsonb_build_array(" + ', '.join('to_jsonb(x.%s)' % ('"%s"' % col) for col in cols) + ")::text"
        out[t] = list(c.run(f"select count(*), coalesce(md5(string_agg({row}, '|' order by {row})), '') from {t} x")[0])
    return out

if __name__ == '__main__':
    c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                      database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
    print('\n'.join(catalog(c)))
