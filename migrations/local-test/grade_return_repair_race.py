"""The nightly repair against deletes that span two classes (S0-M4b,
migrations/2026110905_grade_return_limits.sql).

A transaction that holds many classes' locks deadlocks with one delete that
takes two classes in the other order: the retention purge and clear_data
delete whole classes, and deleting a student who is in two classes takes
both. The repair therefore works one class at a time and commits. Here three
threads keep making classes, grading in them through the RPCs, and deleting
them: two classes in one statement, highest id first; and a student who is
enrolled in two of them. All the while the nightly procedure runs again and
again, and so does the one-class repair on classes picked at random, some
of them already gone.

It must end with: no deadlock anywhere, no error from the procedure and
nothing in its log, no orphan row, no row that does not hold its grade, no
class left.

It COMMITS, so it wants a database of its own with 2026110905 loaded.
After the reviewer's race_class_delete.py (PR 989).

PGPORT=54331 PGDATABASE=fv_repair python3 grade_return_repair_race.py        # N=60 classes a thread by default
"""
import os, random, sys, threading, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'
N = int(os.environ.get('N', '60'))
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:700]))
def conn(teacher=False):
    c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                      database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
    c.run("set deadlock_timeout = '100ms'"); c.run("set statement_timeout = '60s'")
    if teacher:
        c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')
    return c
nid = lambda: str(uuid.uuid4())
done = threading.Event(); lock = threading.Lock(); errs = {}; calls = {}; made = []
def note(who, e):
    info = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
    k = (who, info.get('C', type(e).__name__), str(info.get('M', e))[:110])
    with lock: errs[k] = errs.get(k, 0) + 1

def churn(seed):
    """Make a class, grade in it, and delete classes: two in one statement, or through a student who is in two."""
    o = conn(); t = conn(True); rng = random.Random(seed); pending = []
    for i in range(N):
        try:
            cid, a = nid(), nid(); es = [nid() for _ in range(3)]; first_student = None
            o.run("insert into course (id, teacher_id, name, student_page_enabled, return_grades) values (:c, :t, 'Churn', true, 'on_return')", c=cid, t=A)
            with lock: made.append(cid)
            for e in es:
                s = o.run("insert into student (teacher_id, first_name) values (:t, 'Churn') returning id", t=A)[0][0]
                first_student = first_student or s
                o.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=e, s=s, c=cid)
            o.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Q', 'points', 10)", a=a, c=cid)
            for e in es: t.run('select upsert_score(:e, :a, :v)', e=e, a=a, v=rng.randint(0, 10))
            t.run('select return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ','.join(es[:2]), k=nid())
            t.run('select upsert_score(:e, :a, 3)', e=es[0], a=a)
            pending.append((cid, first_student))
            if len(pending) == 2:
                (c1, s1), (c2, _s2) = pending
                if i % 4 == 1:
                    # one student in both classes, deleted: one statement that takes rows of two classes
                    o.run('insert into enrollment (student_id, course_id) values (:s, :c)', s=s1, c=c2)
                    o.run('delete from student where id = :s', s=s1)
                # two classes in one statement, highest id first: the purge's shape
                o.run('delete from course where id = any (:ids::uuid[])', ids='{%s}' % ','.join(sorted((c1, c2), reverse=True)))
                pending = []
        except Exception as e:
            note('the deletes and saves', e)
            try: o.run('rollback')
            except Exception: pass
    if pending: o.run('delete from course where id = any (:ids::uuid[])', ids='{%s}' % ','.join(p[0] for p in pending))
    o.close(); t.close()
def nightly():
    c = conn(); n = 0
    while not done.is_set():
        try: c.run('call public.grade_return_repair_nightly()'); n += 1
        except Exception as e: note('the nightly procedure', e)
    with lock: calls['the nightly procedure'] = n
    c.close()
def one_class(seed):
    c = conn(); n = 0; rng = random.Random(seed)
    while not done.is_set():
        with lock: cid = rng.choice(made) if made else None
        if cid is None: continue
        try: c.run('select public._grade_return_repair_class(:c)', c=cid); n += 1
        except Exception as e: note('the one-class repair', e)
    with lock: calls['the one-class repair'] = n
    c.close()

o = conn()
if not o.run("select to_regprocedure('public._grade_return_repair_class(uuid)') is not null")[0][0]:
    sys.exit('this database does not have 2026110905')
o.run('delete from public.grade_return_repair_log')
t0 = time.time()
ws = [threading.Thread(target=churn, args=(s,)) for s in range(3)]
ls = [threading.Thread(target=nightly), threading.Thread(target=one_class, args=(7,))]
[x.start() for x in ws + ls]; [x.join() for x in ws]; done.set(); [x.join() for x in ls]
o.run("delete from student where first_name = 'Churn'")
print('%s on port %s: %d classes made, graded and deleted in %.0f s; the nightly procedure ran %d times and the one-class repair %d times'
      % (o.run('show server_version')[0][0], os.environ.get('PGPORT'), len(made), time.time() - t0, calls.get('the nightly procedure', 0), calls.get('the one-class repair', 0)))
for k, v in sorted(errs.items(), key=str): print('  ERROR', k, v)
ok('every class was made and the repairs ran many times beside the deletes', len(made) == 3 * N and calls.get('the nightly procedure', 0) > 5 and calls.get('the one-class repair', 0) > 50,
   (len(made), calls))
ok('no deadlock, for the deletes, the saves or the repair', not [k for k in errs if k[1] == '40P01'], [k for k in errs if k[1] == '40P01'])
ok('no error of any kind from the deletes and saves', not [k for k in errs if k[0] == 'the deletes and saves'], [k for k in errs if k[0] == 'the deletes and saves'])
ok('no error from the nightly procedure or the one-class repair', not [k for k in errs if k[0] != 'the deletes and saves'], [k for k in errs if k[0] != 'the deletes and saves'])
ok('nothing in the repair\'s log', o.run('select count(*) from public.grade_return_repair_log')[0][0] == 0,
   o.run('select course_id, sqlstate, message from public.grade_return_repair_log limit 3'))
ok('no orphan grade_return row is left', o.run("""select count(*) from grade_return g where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
                                                   or not exists (select 1 from assessment a where a.id = g.assessment_id)""")[0][0] == 0)
ok('every row left holds its grade', o.run('select count(*) from grade_return g where g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)')[0][0] == 0)
ok('no class of the run is left, and no lock row without its class',
   o.run("select count(*) from course where name = 'Churn'")[0][0] == 0
   and o.run('select count(*) from course_sync_cursor k where not exists (select 1 from course c where c.id = k.course_id)')[0][0] == 0)
o.close()
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
