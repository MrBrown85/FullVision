"""Tests migrations/2026111730_drop_zero_data_publication.sql on a throwaway PostgreSQL 17
(wal_level = logical, port 54877, trust auth; never gradebook-prod). Needs pg8000 (PG8000_PATH).
Run: PG8000_PATH=<dir> python3 drop_zero_data.py ../2026111730_drop_zero_data_publication.sql
Result on 2026-11-17, PostgreSQL 17.11 (embedded-postgres): 16 of 16.
"""
import sys, os
sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
F = sys.argv[1]
sql = open(F).read()
def conn(): return pg.Connection('postgres', host='127.0.0.1', port=54877, database='postgres')
c = conn()
ok = 0; bad = 0
def check(name, cond):
    global ok, bad
    print(('ok   ' if cond else 'FAIL ') + name)
    if cond: ok += 1
    else: bad += 1
def pubs(): return sorted(r[0] for r in c.run("select pubname from pg_publication"))
def simple(s):
    k = conn()
    try:
        k.execute_simple(s); return None
    except Exception as e:
        try: k.execute_simple('rollback')
        except Exception: pass
        return str(e)
    finally:
        k.close()
c.run("create schema realtime"); c.run("create table realtime.messages (id int primary key)")
c.run("create table public.course_sync_cursor (id int primary key)")
c.run("create publication supabase_realtime for table public.course_sync_cursor")
c.run("create publication supabase_realtime_messages_publication for table realtime.messages")
c.run("create schema fv_backup"); c.run("create table fv_backup.nokey (v int)"); c.run("insert into fv_backup.nokey values (1),(2)")
c.run("create publication zero_data for all tables")
check('before: delete from a table with no key is refused', 'replica identity' in (simple("delete from fv_backup.nokey where v = 1") or ''))
# guard: a slot named for zero stops it
c.run("select pg_create_logical_replication_slot('zero_test', 'pgoutput')")
e = simple(sql); check('a slot named for zero stops it', e is not None and 'Nothing was changed' in e); check('  and the publication is still there', 'zero_data' in pubs())
c.run("select pg_drop_replication_slot('zero_test')")
# guard: a schema named for zero stops it
c.run("create schema zero_0")
e = simple(sql); check('a schema named for zero stops it', e is not None and 'Nothing was changed' in e); check('  and the publication is still there', 'zero_data' in pubs())
c.run("drop schema zero_0")
# final check: a missing realtime publication rolls everything back
c.run("drop publication supabase_realtime")
e = simple(sql); check('a missing Realtime publication stops it', e is not None); check('  and zero_data is still there (rolled back)', 'zero_data' in pubs())
c.run("create publication supabase_realtime for table public.course_sync_cursor")
before = c.run("select count(*) from pg_class")[0][0]
e = simple(sql); check('the file applies', e is None)
check('zero_data is gone', 'zero_data' not in pubs())
check("Realtime's two publications are untouched", pubs() == ['supabase_realtime', 'supabase_realtime_messages_publication'])
check('no table or other object changed', c.run("select count(*) from pg_class")[0][0] == before)
check('after: delete from a table with no key works', simple("delete from fv_backup.nokey where v = 1") is None)
check('rows otherwise untouched', c.run("select count(*) from fv_backup.nokey")[0][0] == 1)
e = simple(sql); check('a second run changes nothing and does not fail', e is None and 'zero_data' not in pubs())
check('undo puts it back', simple("create publication zero_data for all tables") is None and 'zero_data' in pubs())
e = simple(sql); check('and the file applies again after the undo', e is None and 'zero_data' not in pubs())
print(f'{ok} of {ok+bad}')
sys.exit(1 if bad else 0)
