"""batch-a-undo.sql's PART 1 (the fast stop) while teachers are saving.

Six connections save in a loop as Teacher A (points, a rubric fill, one
rubric criterion, a comment, a clear, a change to the class itself: the
reviewer's mix, which also takes the course table). PART 1 is run
against them again and again, on a database with everything live has
(Batch A, S0-M5, S0-M4b: the trigger function is S0-M4b's); between runs the
saves are paused and file 02, then 2026110905, put everything back. Counted: saves that failed, by SQLSTATE (40P01 is a
save Postgres killed to break a deadlock), the slowest save, and PART 1 runs
that did not finish.

Twice over, at two speeds (each connection pausing about a quarter of a
second between saves, "a class at work", and not pausing at all, "flat
out"): PART 1 as it was first written (one transaction
holding all seven tables until it commits) and as it is now (one table at a
time, 200 ms lock timeout, retry). The first is only printed; the second is
checked: no save fails and every run finishes. Then PART 2, a few times,
printed: it is one transaction on purpose and is not for a busy moment.
(S0-M4b's own undo, which PART 2 needs first, is run with the saves paused:
how it does against saves is for its own tests.)

Needs the template database batch_a_undo.py uses; works on a copy.

PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo_load.py            # about three minutes
RUNS=160 PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo_load.py   # the long run
"""
import json, os, random, sys, threading, time
import batch_a_undo as U
from batch_a_undo import Db, ok, nid, connect, A, FILES, PARTS

RUNS = int(os.environ.get('RUNS', '40'))
# PART 1 as first written (commit 90fd9931): every drop in one transaction.
OLD_PART_1 = ['begin', "set local lock_timeout = '5s'"] + [
    'drop trigger if exists grade_return_%s on public.%s' % (kind, table)
    for table, kinds in (('assessment', ['gone']), ('course', ['release']), ('enrollment', ['gone']),
                         ('rubric_check_score', ['delete', 'insert', 'repoint', 'update']), ('rubric_score', ['delete', 'insert', 'repoint', 'update']),
                         ('score', ['delete', 'insert', 'update']), ('tag_score', ['delete', 'insert', 'repoint', 'update']))
    for kind in kinds] + ['commit']

d = Db('load'); U.seed(d)
assert d.apply() == 'ok'
d.run("insert into student (id, teacher_id, first_name, last_name) select gen_random_uuid(), :t, 'Load', 'S' || g from generate_series(1, 32) g", t=A)
d.run("insert into enrollment (id, student_id, course_id, roster_position) select gen_random_uuid(), s.id, :c, 100 from student s where s.first_name = 'Load'", c=U.COURSE)
rub, pts, rw = nid(), nid(), nid()
d.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Load', 'advanced')", r=rub, c=U.COURSE)
d.run("insert into criterion (id, rubric_id, name) select gen_random_uuid(), :r, 'C' || g from generate_series(1, 5) g", r=rub)
d.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id) values (:a, :c, 'Load points', 'points', 10, null),
         (:b, :c, 'Load rubric', 'proficiency', null, :r)""", a=pts, b=rw, c=U.COURSE, r=rub)
enr = [str(r[0]) for r in d.run("select e.id from enrollment e join student s on s.id = e.student_id where s.first_name = 'Load' order by 1")]
crit = [str(r[0]) for r in d.run('select id from criterion where rubric_id = :r order by 1', r=rub)]
d.run('analyze')

stop = threading.Event(); hold = threading.Event()
WRITERS = 6
idle = [threading.Event() for _ in range(WRITERS)]
stats = [dict(calls=0, errors={}, max_ms=0.0, slow=0) for _ in range(WRITERS)]
pause = [0.0]
def writer(i):
    w = connect(d.name)
    w.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); w.run('set role authenticated')
    mine = enr[i::WRITERS]; rnd = random.Random(i); st = stats[i]
    while not stop.is_set():
        if hold.is_set():
            idle[i].set(); time.sleep(0.005); continue
        idle[i].clear()
        e = rnd.choice(mine); v = rnd.randint(1, 4); op = rnd.random()
        t0 = time.perf_counter()
        try:
            if op < 0.35: w.run('select upsert_score(:e, :a, :v)', e=e, a=pts, v=v)
            elif op < 0.6: w.run('select fill_rubric(:e, :a, :v, 0::smallint)', e=e, a=rw, v=v)
            elif op < 0.8: w.run('select upsert_rubric_score(:e, :a, :x, :v)', e=e, a=rw, x=rnd.choice(crit), v=v)
            elif op < 0.9: w.run("select save_score_comment(:e, :a, 'x')", e=e, a=pts)
            elif op < 0.95: w.run('select clear_score(:e, :a)', e=e, a=rw)
            else: w.run('select update_course(:c, :p::jsonb)', c=U.COURSE, p=json.dumps({'name': 'Undo class %d' % rnd.randint(1, 9)}))
        except Exception as ex:
            code = ex.args[0].get('C') if ex.args and isinstance(ex.args[0], dict) else 'other'
            st['errors'][code] = st['errors'].get(code, 0) + 1
        ms = (time.perf_counter() - t0) * 1000
        st['calls'] += 1; st['max_ms'] = max(st['max_ms'], ms); st['slow'] += ms > 250
        if pause[0]: time.sleep(pause[0] * (0.5 + rnd.random()))
    w.close()
threads = [threading.Thread(target=writer, args=(i,)) for i in range(WRITERS)]
[t.start() for t in threads]

def quiet(fn):
    """Run fn with the saves paused (every one in flight finished first)."""
    hold.set()
    while not all(e.is_set() for e in idle): time.sleep(0.005)
    try: return fn()
    finally:
        for e in idle: e.clear()
        hold.clear()
def reset():
    for s in stats: s.update(calls=0, errors={}, max_ms=0.0, slow=0)
def totals():
    errs = {}
    for s in stats:
        for k, v in s['errors'].items(): errs[k] = errs.get(k, 0) + v
    return sum(s['calls'] for s in stats), errs, max(s['max_ms'] for s in stats), sum(s['slow'] for s in stats)

def measure(label, statements, runs, restore):
    """runs of `statements` against the saves; `restore` (run with the saves paused) puts back what it removed."""
    reset(); t0 = time.time(); done = 0; stopped = {}; took = []; paused = 0.0
    for _ in range(runs):
        t1 = time.perf_counter(); r = d.statements(statements); took.append((time.perf_counter() - t1) * 1000)
        if r == 'ok' and d.one(U.TRIGGERS) == 0: done += 1
        else: stopped[r[:70]] = stopped.get(r[:70], 0) + 1
        time.sleep(0.05)
        t2 = time.time(); quiet(restore); paused += time.time() - t2
        time.sleep(0.05)
    calls, errs, slowest, slow = totals(); secs = time.time() - t0 - paused
    took.sort()
    print('%-42s finished %3d of %3d runs (median %4.0f ms, longest %5.0f ms) | %6d saves, %5.1f a second | saves that FAILED: %s | slowest save %4.0f ms, over 250 ms: %d%s'
          % (label, done, runs, took[len(took) // 2], took[-1], calls, calls / secs, errs or 'none', slowest, slow,
             ' | stopped: %s' % stopped if stopped else ''))
    return done, errs, calls

restore_triggers = lambda: d.back_on()
def alone(speed, seconds=8):
    """The saves by themselves, nothing run against them: what they do to each other."""
    reset(); time.sleep(seconds); calls, errs, slowest, slow = totals()
    print('%-42s %6d saves, %5.1f a second | saves that FAILED: %s | slowest save %4.0f ms, over 250 ms: %d'
          % ('the saves alone, %s:' % speed, calls, calls / seconds, errs or 'none', slowest, slow))
for speed, p in (('a class at work', 0.25), ('flat out', 0.0)):
    pause[0] = p; time.sleep(0.5)
    alone(speed)
    runs = RUNS if p else max(20, RUNS // 2)
    measure('PART 1 as first written, %s:' % speed, OLD_PART_1, runs, restore_triggers)
    done, errs, calls = measure('PART 1 as it is now, %s:' % speed, PARTS['PART 1'], runs, restore_triggers)
    ok('PART 1 against saves, %s: every one of %d runs finished and dropped all 18 triggers' % (speed, runs), done == runs, done)
    ok('PART 1 against saves, %s: no save failed' % speed, errs == {} and calls > 0, errs)
def put_back():
    """Everything applied again, as on live, and S0-M4b's undo run, so that PART 2 can."""
    d.run("delete from supabase_migrations.schema_migrations where name = any (cast(:n as text[]))", n=U.RECORD)
    return d.apply() == 'ok' and d.s0_m4b_out()
assert quiet(d.s0_m4b_out) == 'ok'
for speed, p in (('a class at work', 0.25), ('flat out', 0.0)):
    pause[0] = p; time.sleep(0.5)
    measure('PART 2 (one transaction), %s:' % speed, PARTS['PART 2'], 10, put_back)
stop.set(); [t.join() for t in threads]
d.close()
print('\n'.join('PASS ' + p for p in U.passed))
print('\n'.join('FAIL ' + f for f in U.failed))
print(f'{len(U.passed)} passed, {len(U.failed)} failed')
sys.exit(1 if U.failed else 0)
