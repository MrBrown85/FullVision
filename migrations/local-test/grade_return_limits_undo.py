"""Prove migrations/local-test/s0-m4b-undo.sql: the way back from
2026110905_grade_return_limits.sql (S0-M4b) to Batch A as applied.

It COMMITS, and runs other scripts on the same database between its steps,
so it wants a database of its own, built with Batch A and without the
migration:

PGPORT=54331 PGDATABASE=fv_undo4b python3 run.py $BASE $MIGRATIONS    # BASE and MIGRATIONS as under "Batch A" in the README
PGPORT=54331 PGDATABASE=fv_undo4b python3 grade_return_limits_undo.py

What it does: takes the whole catalog of the three schemas (every function
with its definition, owner and grants; every table, column, constraint,
index, trigger, policy, sequence and comment); applies the migration; uses
it (a piece to DIBELS and back, the nightly procedure, a row in the log);
runs PART 1 and then PART 2 of the undo, each twice; and compares.
"""
import json, os, subprocess, sys, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION = os.path.join(HERE, '..', '2026110905_grade_return_limits.sql')
UNDO = open(os.path.join(HERE, 's0-m4b-undo.sql')).read()
A = '11111111-1111-1111-1111-111111111111'
COURSE = 'aaaaaaaa-0000-0000-0000-0000000000f4'; STU = 'aaaaaaaa-1111-0000-0000-0000000000f4'; ENR = 'eeeeeeee-1111-0000-0000-0000000000f4'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:700]))
c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                  database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
if c.run("select to_regprocedure('public._grade_return_repair_class(uuid)') is not null")[0][0]:
    sys.exit('this database already has 2026110905: build one with Batch A alone')
def run_file(text):
    for s in split(text): c.run(s)
PART1 = UNDO[UNDO.index('-- PART 1: the fast stop'):UNDO.index('-- PART 2: the full removal')]
PART2 = UNDO[UNDO.index('-- PART 2: the full removal'):]
S = "('public', 'fv_private', 'student_submit')"
def catalog():
    out = []
    for q in ("""select 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), coalesce(p.proacl::text, '')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in %s and p.prokind in ('f', 'p')""" % S,
              """select 'column', table_schema || '.' || table_name, column_name, data_type || ' ' || coalesce(column_default, '') || ' ' || is_nullable || ' ' || coalesce(identity_generation, ''), ordinal_position::text
                   from information_schema.columns where table_schema in %s""" % S,
              """select 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(oid), '' from pg_constraint
                  where connamespace::regnamespace::text in %s and conrelid <> 0""" % S,
              """select 'trigger', t.tgrelid::regclass::text, t.tgname, pg_get_triggerdef(t.oid), t.tgenabled::text from pg_trigger t
                   join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace where not t.tgisinternal and n.nspname in %s""" % S,
              """select 'policy', schemaname || '.' || tablename, policyname, cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, ''), roles::text
                   from pg_policies where schemaname in %s""" % S,
              """select 'index', schemaname || '.' || tablename, indexname, indexdef, '' from pg_indexes where schemaname in %s""" % S,
              """select 'relation', n.nspname || '.' || k.relname, k.relkind::text, coalesce(k.relacl::text, ''), k.relrowsecurity::text || ' ' || pg_get_userbyid(k.relowner)
                   from pg_class k join pg_namespace n on n.oid = k.relnamespace where n.nspname in %s and k.relkind in ('r', 'S', 'v')""" % S,
              """select 'comment', d.objoid::regclass::text, d.objsubid::text, d.description, '' from pg_description d
                   join pg_class k on k.oid = d.objoid and d.classoid = 'pg_class'::regclass join pg_namespace n on n.oid = k.relnamespace where n.nspname in %s""" % S):
        out += [' | '.join(str(x) for x in r) for r in c.run(q)]
    return sorted(out)
def rows_sum():
    return c.run("""select md5(coalesce((select string_agg(x::text, '|' order by x::text) from grade_return x), '')
                            || coalesce((select string_agg(x::text, '|' order by x::text) from score x), '')
                            || coalesce((select string_agg(x::text, '|' order by x::text) from tag_score x), '')
                            || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_score x), '')
                            || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_check_score x), ''))""")[0][0]
def job(): return c.run("select count(*) from cron.job where jobname = 'fv_grade_return_repair_daily'")[0][0]
def teacher(sql, **kw):
    c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')
    try: return c.run('select ' + sql, **kw)[0][0]
    finally: c.run('reset role')
def state(a):
    r = c.run('select is_draft, returned_at is not null, working_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR, a=a)
    return r[0] if r else None
def suite(script):
    out = subprocess.run([sys.executable, os.path.join(HERE, script)], capture_output=True, text=True, env=os.environ).stdout.strip().split('\n')
    return out[-1]

# A stand-in for pg_cron's table and two functions, outside the three schemas the catalog covers.
def cron_stand_in():
    c.run('create schema if not exists cron')
    c.run('create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text)')
    c.run("""create or replace function cron.schedule(text, text, text) returns bigint language sql
             as $f$ insert into cron.job (jobname, schedule, command) values ($1, $2, $3) returning jobid::bigint $f$""")
    c.run("""create or replace function cron.unschedule(text) returns boolean language sql
             as $f$ with d as (delete from cron.job where jobname = $1 returning 1) select exists (select 1 from d) $f$""")
cron_stand_in()
try:
    # ── 1. Before: Batch A as applied ──────────────────────────────────
    before = catalog()
    ok('this database has Batch A and not S0-M4b (%d catalog lines)' % len(before), len(before) > 500 and job() == 0)

    # ── 2. Apply, and use it ───────────────────────────────────────────
    run_file(open(MIGRATION).read())
    applied = catalog()
    c.run("insert into course (id, teacher_id, name, student_page_enabled, return_grades) values (:c, :t, 'Undo class', true, 'on_return')", c=COURSE, t=A)
    c.run("insert into student (id, teacher_id, first_name) values (:s, :t, 'Una')", s=STU, t=A)
    c.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=ENR, s=STU, c=COURSE)
    quiz, bench = str(uuid.uuid4()), str(uuid.uuid4())
    c.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Quiz', 'points', 10), (:b, :c, 'Benchmark', 'dibels', null)", a=quiz, b=bench, c=COURSE)
    teacher('upsert_score(:e, :a, 7)', e=ENR, a=quiz); teacher('return_grades(:a, :ids::uuid[], :k)', a=quiz, ids='{%s}' % ENR, k=str(uuid.uuid4()))
    teacher("save_score_comment(:e, :a, 'Read with expression')", e=ENR, a=bench)
    teacher('update_assessment(:a, :p::jsonb)', a=quiz, p=json.dumps({'score_mode': 'dibels'}))
    teacher('upsert_score(:e, :a, 9)', e=ENR, a=quiz)
    dormant = state(quiz)
    teacher('update_assessment(:a, :p::jsonb)', a=quiz, p=json.dumps({'score_mode': 'points'}))
    c.run('call public.grade_return_repair_nightly()')
    c.run("insert into public.grade_return_repair_log (course_id, sqlstate, message) values (:c, '55P03', 'a stand-in for a night that failed')", c=COURSE)
    ok('S0-M4b is in use: the job is scheduled, a comment on a benchmark made no row, a piece went to DIBELS and back and its changed grade waits as a draft, the log holds a row',
       job() == 1 and state(bench) is None and dormant[0] is False and dormant[2]['value'] == 7 and state(quiz)[0] is True and state(quiz)[2]['value'] == 9, (dormant, state(quiz)))

    # ── 3. PART 1: the fast stop ───────────────────────────────────────
    sums = rows_sum()
    run_file(PART1)
    stopped = catalog()
    gone = [l for l in applied if l not in stopped]; new = [l for l in stopped if l not in applied]
    ok('PART 1: the job is unscheduled and the three triggers are dropped; nothing else in the catalog changes',
       job() == 0 and len(gone) == 3 and all(l.startswith('trigger') and ('grade_return_truncate' in l or 'grade_return_mode' in l) for l in gone) and not new, (gone, new))
    ok('PART 1 changes no row of grade_return or of a score table', rows_sum() == sums)
    teacher('upsert_score(:e, :a, 8)', e=ENR, a=quiz)
    ok('after it saves still work and DIBELS pieces still have no state', state(quiz)[2]['value'] == 8 and state(bench) is None)
    teacher('update_assessment(:a, :p::jsonb)', a=quiz, p=json.dumps({'score_mode': 'dibels'}))
    teacher('upsert_score(:e, :a, 3)', e=ENR, a=quiz)
    teacher('update_assessment(:a, :p::jsonb)', a=quiz, p=json.dumps({'score_mode': 'points'}))
    ok('and, as its header says, a piece changed back from DIBELS is no longer settled at once: its row is as it was', state(quiz)[2]['value'] == 8)
    c.run('call public.grade_return_repair_nightly()')
    ok('until the repair is run by hand', state(quiz)[2]['value'] == 3)
    run_file(PART1)
    ok('PART 1 run again changes nothing', catalog() == stopped)

    # ── 4. PART 2: the full removal ────────────────────────────────────
    c.run('begin')
    d = c.run("select pg_get_functiondef('public.course_draft_count(uuid)'::regprocedure)")[0][0]
    c.run(d.replace('select count(*)::int', 'select  count(*)::int'))
    try:
        for s in split(PART2):
            if s.strip().lower() not in ('begin', 'commit'): c.run(s)
        refused = None
    except pg.DatabaseError as e:
        refused = e.args[0].get('M')
    c.run('rollback')
    ok('PART 2 stops, with nothing changed, when one of the eight functions is neither as S0-M4b leaves it nor as Batch A made it',
       refused is not None and 'Nothing was changed' in refused and catalog() == stopped, refused)
    sums = rows_sum()
    run_file(PART2)
    after = catalog()
    ok('PART 2: the catalog is identical to before S0-M4b, line by line (%d lines)' % len(after), after == before,
       ([l for l in after if l not in before][:4], [l for l in before if l not in after][:4]))
    ok('PART 2 changes no row of grade_return or of a score table', rows_sum() == sums)
    ok('the log table and the job are gone', c.run("select to_regclass('public.grade_return_repair_log') is null")[0][0] and job() == 0)
    run_file(PART2)
    ok('PART 2 run again changes nothing', catalog() == before)
    run_file(PART1)
    ok('nor does PART 1 run after it', catalog() == before)

    # ── 5. It is Batch A again: its suites pass as they do on Batch A alone ──
    c.run('delete from course where id = :c', c=COURSE); c.run('delete from student where id = :s', s=STU)
    c.run('drop schema cron cascade')   # grade_return_limits.py makes its own stand-in
    for script, want in (('grade_return.py', '281 passed, 0 failed'), ('grade_return_limits.py', '92 passed, 0 failed'), ('student_page.py', '216 passed, 0 failed'),
                         ('score_rpcs.py', '236 passed, 0 failed')):
        got = suite(script)
        ok('after the undo %s passes as it does on Batch A alone: %s' % (script, want), got == want, got)

    # ── 6. And S0-M4b goes on again ────────────────────────────────────
    cron_stand_in()
    run_file(open(MIGRATION).read())
    ok('the migration applies again and gives the same catalog as the first time', catalog() == applied and job() == 1)
    run_file(PART2)
    ok('(left as Batch A alone)', catalog() == before)
finally:
    try: c.run('rollback')
    except Exception: pass
    c.run('reset role')
    c.run('delete from course where id = :c', c=COURSE); c.run('delete from student where id = :s', s=STU)
    c.run('drop schema if exists cron cascade')
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
