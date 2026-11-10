"""Two saves at once, and saves against returns, on a database with Batch A
loaded. Unlike the other scripts this one commits: it needs several
connections that see each other's work. It makes its own assessments, puts
the class settings back and deletes what it made, also when it fails.

1. One student's rubric grade, under When I Return Them: level 3 is
   returned, a box is ticked (a draft). Connection 1 raises the level to 4
   and does not commit; connection 2 unticks the box, which puts its part
   back to what was returned. Connection 2 must wait for connection 1 and
   then see its level: the grade stays a draft and the student keeps 3.
   The class's sync-cursor triggers are switched off for this part, so the
   wait does not lean on them: it is Batch A's own (the class lock,
   _grade_return_lock, and the row the BEFORE trigger keeps).
2. Two connections save one class's scores again and again while a third
   returns them, 150 calls each. No call may fail.
3. The same with a fourth connection changing the class's settings (Return
   Grades, the student page, a rename), a fifth filling a rubric and a
   sixth making card calls. Run first as a control with the release trigger
   renamed so it fires after the sync-cursor trigger: a setting change then
   takes the sync-cursor row before the class lock, a save takes them the
   other way, and they deadlock (40P01).
4. A level saved for a criterion while that criterion is being deleted,
   150 times: no deadlock.

PGPORT=54329 PGDATABASE=fv_a python3 grade_return_race.py
"""
import os, sys, threading, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
SCORE_TABLES = ('score', 'tag_score', 'rubric_score', 'rubric_check_score')
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:400]))
def conn():
    return pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                         port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                         password=os.environ.get('PGPASSWORD'))
def teacher(c):
    c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')
nid = lambda: str(uuid.uuid4())
o = conn()
before = o.run('select student_page_enabled, return_grades from course where id = :c', c=COURSE_A)[0]
real_lock = o.run("select pg_get_functiondef('public._grade_return_lock(uuid)'::regprocedure)")[0][0]
made = {'assessment': [], 'rubric': []}

def one_cell(label):
    """Returns (connection 2 waited, is_draft, the level the student is given)."""
    r, c1, k1, a = nid(), nid(), nid(), nid()
    made['assessment'].append(a); made['rubric'].append(r)
    o.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Race', 'advanced')", r=r, c=COURSE_A)
    o.run("insert into criterion (id, rubric_id, name) values (:x, :r, 'Method')", x=c1, r=r)
    o.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :x, 3, 'Lists every step')", k=k1, x=c1)
    o.run("insert into assessment (id, course_id, title, score_mode, rubric_id) values (:a, :c, :t, 'proficiency', :r)", a=a, c=COURSE_A, t=label, r=r)
    t1 = conn(); t2 = conn(); teacher(t1); teacher(t2)
    t1.run('select upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=a, x=c1)
    t1.run('select return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR1, k=nid())
    t1.run('select set_rubric_check(:e, :a, :k, true)', e=ENR1, a=a, k=k1)          # a draft on the returned grade
    t1.run('begin'); t1.run('select upsert_rubric_score(:e, :a, :x, 4)', e=ENR1, a=a, x=c1)   # not committed
    th = threading.Thread(target=lambda: t2.run('select set_rubric_check(:e, :a, :k, false)', e=ENR1, a=a, k=k1))
    th.start(); time.sleep(1.0)
    waited = th.is_alive()
    t1.run('commit'); th.join(); t1.close(); t2.close()
    is_draft = o.run('select is_draft from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)[0][0]
    given = o.run('select student_submit._returned_grade(:e, :a)', e=ENR1, a=a)[0][0]['grade']['criteria'][c1]['value']
    return waited, is_draft, given

try:
    o.run("update course set student_page_enabled = true, return_grades = 'on_return' where id = :c", c=COURSE_A)

    # ── 1. Two saves on one grade ──────────────────────────────────────
    for t in SCORE_TABLES:
        o.run('alter table public.%s disable trigger course_sync_cursor_%s_gradebook' % (t, t))
    waited, is_draft, given = one_cell('Race')
    ok('with the lock, the second save waits for the first', waited, waited)
    ok('and then sees it: the grade is still a draft and the student is still given the returned 3', is_draft is True and given == 3, (is_draft, given))
    for t in SCORE_TABLES:
        o.run('alter table public.%s enable trigger course_sync_cursor_%s_gradebook' % (t, t))

    # ── 2. Saves against returns ───────────────────────────────────────
    def stress(label):
        a = nid(); made['assessment'].append(a)
        o.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, :t, 'points', 10)", a=a, c=COURSE_A, t=label)
        N = 150; errs = {'save': [], 'return': []}
        def call(c, kind, sql, **kw):
            try:
                c.run('begin'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=A); c.run('set local role authenticated')
                c.run(sql, **kw); c.run('commit')
            except Exception as e:
                errs[kind].append(str(e)[:160]); c.run('rollback')
        def saver(enr):
            c = conn()
            for i in range(N): call(c, 'save', 'select upsert_score(:e, :a, :v)', e=enr, a=a, v=i % 10)
            c.close()
        def returner():
            c = conn()
            for i in range(N): call(c, 'return', 'select return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s,%s}' % (ENR1, ENR2), k=nid())
            c.close()
        ts = [threading.Thread(target=saver, args=(ENR1,)), threading.Thread(target=saver, args=(ENR2,)), threading.Thread(target=returner)]
        [t.start() for t in ts]; [t.join() for t in ts]
        bad = o.run("""select count(*) from grade_return g where g.assessment_id = :a
                          and ((g.returned_copy is not null) <> (g.is_draft and g.returned_at is not null)
                            or (g.is_draft and g.returned_copy = public._grade_copy(g.enrollment_id, g.assessment_id)))""", a=a)[0][0]
        return N, errs, bad
    N, errs, bad = stress('Deadlock work')
    ok('%d saves on each of two students against %d returns, at once: no save fails' % (N, N), not errs['save'], sorted(set(errs['save']))[:2])
    ok('and no return fails: no deadlock', not errs['return'], sorted(set(errs['return']))[:2])
    ok('every grade is left in a state the table allows, and none is a draft that equals what was returned', bad == 0, bad)

    # ── 3. Saves, returns, fills and card calls against setting changes ──
    def run_threads(jobs, n):
        """jobs: [(name, fn(i) -> (sql, params))]. Each runs n calls on its own connection, one transaction a call."""
        errs = []
        def worker(name, fn):
            c = conn()
            for i in range(n):
                sql, kw = fn(i)
                try:
                    c.run('begin'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=A); c.run('set local role authenticated')
                    c.run(sql, **kw); c.run('commit')
                except Exception as e:
                    errs.append((name, str(e)[:200])); c.run('rollback')
            c.close()
        ts = [threading.Thread(target=worker, args=j) for j in jobs]
        [t.start() for t in ts]; [t.join() for t in ts]
        return errs
    def settings_run(label):
        o.run("update course set student_page_enabled = true, return_grades = 'on_return' where id = :c", c=COURSE_A)
        a = nid(); made['assessment'].append(a)
        o.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, :t, 'points', 10)", a=a, c=COURSE_A, t=label)
        r, ra = nid(), nid(); made['rubric'].append(r); made['assessment'].append(ra)
        o.run("insert into rubric (id, course_id, name) values (:r, :c, 'Stress')", r=r, c=COURSE_A)
        o.run("insert into criterion (id, rubric_id, name) select gen_random_uuid(), :r, 'C' || g from generate_series(1, 3) g", r=r)
        o.run("insert into assessment (id, course_id, title, rubric_id) values (:a, :c, :t, :r)", a=ra, c=COURSE_A, t=label + ' (rubric)', r=r)
        PATCHES = ['{"return_grades": "on_save"}', '{"return_grades": "on_return"}', '{"student_page_enabled": false}',
                   '{"student_page_enabled": true}', '{"name": "Science 8"}']
        jobs = [
            ('save', lambda i: ('select upsert_score(:e, :a, :v)', dict(e=ENR1, a=a, v=i % 10))),
            ('save', lambda i: ('select upsert_score(:e, :a, :v)', dict(e=ENR2, a=a, v=i % 10))),
            ('return', lambda i: ('select return_grades(:a, :ids::uuid[], :k)', dict(a=a, ids='{%s,%s}' % (ENR1, ENR2), k=nid()))),
            ('setting', lambda i: ('select update_course(:c, :p::jsonb)', dict(c=COURSE_A, p=PATCHES[i % 5]))),
            ('fill', lambda i: ('select fill_rubric(:e, :a, :v)', dict(e=ENR1, a=ra, v=1 + i % 4))),
            ('cards', lambda i: ('select set_cards_work_until(:c, :d::date, :k)', dict(c=COURSE_A, d='2027-06-%02d' % (1 + i % 28), k=nid()))
                                 if i % 2 else ('select issue_student_cards(:c, null, :k)', dict(c=COURSE_A, k=nid()))),
        ]
        errs = run_threads(jobs, 150)
        return [e for e in errs if '40P01' in e[1]], errs
    o.run('alter trigger a_grade_return_release on public.course rename to grade_return_release')
    dead, errs = settings_run('Settings stress (control)')
    ok('control, with the release trigger under a name that fires after the sync cursor: setting changes deadlock with saves (%d of 900 calls died with 40P01)' % len(dead), len(dead) > 0, errs[:2])
    o.run('alter trigger grade_return_release on public.course rename to a_grade_return_release')
    dead, errs = settings_run('Settings stress')
    ok('saves, returns, fills and card calls against Return Grades, the student page and a rename changing, 150 calls each: no call fails', not errs, sorted(set(errs))[:3])

    # ── 4. A save against a criterion being deleted ────────────────────
    r, a = nid(), nid(); made['rubric'].append(r); made['assessment'].append(a)
    o.run("update course set student_page_enabled = true, return_grades = 'on_return' where id = :c", c=COURSE_A)
    o.run("insert into rubric (id, course_id, name) values (:r, :c, 'Delete stress')", r=r, c=COURSE_A)
    o.run("insert into assessment (id, course_id, title, rubric_id) values (:a, :c, 'Delete stress', :r)", a=a, c=COURSE_A, r=r)
    crit = [nid() for _ in range(150)]
    for x in crit: o.run("insert into criterion (id, rubric_id, name) values (:x, :r, 'C')", x=x, r=r)
    jobs = [('save', lambda i: ('select upsert_rubric_score(:e, :a, :x, 3)', dict(e=ENR1, a=a, x=crit[i]))),
            ('save', lambda i: ('select upsert_rubric_score(:e, :a, :x, 2)', dict(e=ENR2, a=a, x=crit[i]))),
            ('delete', lambda i: ('delete from criterion where id = :x', dict(x=crit[i])))]
    errs = run_threads(jobs, 150)
    dead = [e for e in errs if '40P01' in e[1]]
    ok('a level saved for a criterion while the criterion is being deleted, 150 times: no deadlock (a save that loses the race is refused, as before)',
       not dead, sorted(set(dead))[:2])
    ok('and the only refusals are for the criterion being gone', all('23503' in e[1] or '42501' in e[1] for e in errs), sorted(set(errs))[:3])
finally:
    try: o.run('alter trigger grade_return_release on public.course rename to a_grade_return_release')
    except Exception: pass
    o.run('delete from student_card k using enrollment e where e.id = k.enrollment_id and e.course_id = :c', c=COURSE_A)
    o.run('update course set cards_work_until = null where id = :c', c=COURSE_A)
    o.run("delete from fv_idempotency where endpoint in ('set_cards_work_until', 'issue_student_cards')")
    o.run(real_lock)
    for t in SCORE_TABLES:
        o.run('alter table public.%s enable trigger course_sync_cursor_%s_gradebook' % (t, t))
    for a in made['assessment']: o.run('delete from assessment where id = :a', a=a)
    for r in made['rubric']: o.run('delete from rubric where id = :r', r=r)
    o.run('delete from fv_idempotency where endpoint = :e', e='return_grades')
    o.run('update course set student_page_enabled = :s, return_grades = :r where id = :c', s=before[0], r=before[1], c=COURSE_A)

print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
