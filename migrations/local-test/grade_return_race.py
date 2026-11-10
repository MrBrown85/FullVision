"""Calls at once, on several connections. Unlike the other scripts this one
commits: the connections must see each other's work. It makes what it needs
in Teacher A's class, and deletes it and puts the class back when it ends,
also when it fails.

With Batch A loaded:

1. Two saves on one grade, under When I Return Them: level 3 is returned, a
   box is ticked (a draft). Connection 1 raises the level to 4 and does not
   commit; connection 2 unticks the box, which puts its part back to what
   was returned. Connection 2 must wait for connection 1 and then see its
   level: the grade stays a draft and the student keeps 3. The class's
   sync-cursor triggers are switched off for this part, so the wait does not
   lean on them: it is Batch A's own (_grade_return_lock, in the statement
   trigger).
   Then three at once: a level is raised (not committed), a Return and a
   tick both wait for it. Whichever of the two goes first, the student must
   be given the raised level: the tick's trigger reads the grade as it was
   when it got the lock, not as it was when the tick was sent.

2. THE MATRIX. Every RPC that writes one of a class's tables (the list is
   SCENARIOS below; their definitions are score-prelude.sql,
   batch-a-prelude.sql, class-writers-prelude.sql and the Batch A files)
   is called RACE_CALLS times (300) on its own connection, aimed at the
   rows the other connections are using, three ways:
     against saves              two connections making score saves
     against returns            two connections calling return_grades
     against saves and returns  both
   and then all of them at once against saves and returns. The delete
   scenarios work down a pool of rows made for them while the saves and
   returns follow a few rows ahead, so a save meets the delete of its own
   assessment, competency, criterion, checkbox or student.
   A call that dies with 40P01 is a deadlock; the table the dead call was
   waiting on a row of is counted with it. A call that loses a race fairly
   is refused as it always was (the row is gone: 23503, P0002, 42501) and
   is counted apart. After every run each grade_return row must
   hold the grade as the score tables have it, in a state the table
   allows, with its student and assessment still there.

   The bar is no deadlock. Nine of the RPCs do not meet it against saves,
   and do not meet it without Batch A either (TODAY, below, says why): for
   those the run is counted and printed, and what is asserted is that no
   dead call was waiting on a grade_return row and that a Return was never
   the call that died. Against returns alone all of them are clean.

Without Batch A (the same database before the four migrations) only the
matrix runs, against saves alone, and nothing is asserted: it is the
baseline, the deadlocks the live functions have between themselves today.

PGPORT=54329 PGDATABASE=fv_a python3 grade_return_race.py
RACE_CALLS=300 RACE_ONLY=upsert_rubric,delete_tag RACE_JSON=/tmp/out.json ...
"""
import json, os, random, re, sys, threading, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
STU1 = 'aaaaaaaa-1111-0000-0000-000000000001'
SCORE_TABLES = ('score', 'tag_score', 'rubric_score', 'rubric_check_score')
CALLS = int(os.environ.get('RACE_CALLS', '300'))
ONLY = [x for x in os.environ.get('RACE_ONLY', '').split(',') if x]
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:400]))
def conn(role=None):
    """A connection as the owner, as Teacher A ('teacher') or as the edge function ('service')."""
    c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                      port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                      password=os.environ.get('PGPASSWORD'))
    # A deadlock is found after deadlock_timeout; the default second would make a bad run take minutes.
    c.run("set deadlock_timeout = '100ms'"); c.run("set statement_timeout = '60s'")
    if role == 'teacher':
        c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')
    elif role == 'service':
        c.run('set role service_role')
    return c
nid = lambda: str(uuid.uuid4())
arr = lambda ids: '{%s}' % ','.join(ids)
o = conn()
BATCH_A = o.run("select to_regclass('public.grade_return') is not null")[0][0]
START = o.run('select clock_timestamp()')[0][0]
KEEP = {t: [r[0] for r in o.run('select id from %s where course_id = :c' % t, c=COURSE_A)]
        for t in ('assessment', 'rubric', 'subject', 'competency_group', 'section', 'enrollment')}
KEEP['student'] = [r[0] for r in o.run('select id from student where teacher_id = :t', t=A)]
KEEP['course'] = [r[0] for r in o.run('select id from course where teacher_id = :t', t=A)]
course_before = o.run('select to_jsonb(c) from course c where id = :c', c=COURSE_A)[0][0]
dob_before = o.run('select date_of_birth from student where id = :s', s=STU1)[0][0]

def purge(keep):
    """Delete everything of Teacher A's that is not in keep ({table: [ids]})."""
    for t in ('assessment', 'rubric', 'section', 'subject', 'competency_group', 'enrollment'):
        o.run('delete from %s where course_id = :c and not (id = any (:k::uuid[]))' % t, c=COURSE_A, k=arr(map(str, keep[t])))
    o.run('delete from student where teacher_id = :t and not (id = any (:k::uuid[]))', t=A, k=arr(map(str, keep['student'])))
    o.run('delete from course where teacher_id = :t and not (id = any (:k::uuid[]))', t=A, k=arr(map(str, keep['course'])))

def cleanup():
    for t in SCORE_TABLES:
        o.run('alter table public.%s enable trigger course_sync_cursor_%s_gradebook' % (t, t))
    if BATCH_A:
        o.run('delete from student_card k using enrollment e where e.id = k.enrollment_id and e.course_id = :c', c=COURSE_A)
        o.run('delete from student_submit.device_session where created_at >= :s', s=START)
        o.run('delete from student_submit.attempt where at >= :s', s=START)
    purge(KEEP)
    o.run('delete from score s using enrollment e where e.id = s.enrollment_id and e.course_id = :c', c=COURSE_A)
    o.run('delete from fv_idempotency where teacher_id = :t and created_at >= :s', t=A, s=START)
    o.run('update student set date_of_birth = :d where id = :s', d=dob_before, s=STU1)
    sets = ', '.join('%s = (:j::jsonb->>%r)::%s' % (k, k, ty) for k, ty in (
        [('name', 'text')] + ([('student_page_enabled', 'boolean'), ('return_grades', 'text'), ('cards_work_until', 'date')] if BATCH_A else [])))
    o.run('update course set %s where id = :c' % sets, j=json.dumps(course_before, default=str), c=COURSE_A)

# ── 1. Two saves on one grade, and three at once ────────────────────────
def one_rubric(label):
    r, c1, k1, a = nid(), nid(), nid(), nid()
    o.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Race', 'advanced')", r=r, c=COURSE_A)
    o.run("insert into criterion (id, rubric_id, name) values (:x, :r, 'Method')", x=c1, r=r)
    o.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :x, 3, 'Lists every step')", k=k1, x=c1)
    o.run("insert into assessment (id, course_id, title, score_mode, rubric_id) values (:a, :c, :t, 'proficiency', :r)", a=a, c=COURSE_A, t=label, r=r)
    return a, c1, k1

def two_saves():
    """Returns (connection 2 waited, is_draft, the level the student is given)."""
    a, c1, k1 = one_rubric('Race of two')
    t1 = conn('teacher'); t2 = conn('teacher')
    t1.run('select upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=a, x=c1)
    t1.run('select return_grades(:a, :ids::uuid[], :k)', a=a, ids=arr([ENR1]), k=nid())
    t1.run('select set_rubric_check(:e, :a, :k, true)', e=ENR1, a=a, k=k1)                     # a draft on the returned grade
    t1.run('begin'); t1.run('select upsert_rubric_score(:e, :a, :x, 4)', e=ENR1, a=a, x=c1)   # not committed
    th = threading.Thread(target=lambda: t2.run('select set_rubric_check(:e, :a, :k, false)', e=ENR1, a=a, k=k1))
    th.start(); time.sleep(1.0)
    waited = th.is_alive()
    t1.run('commit'); th.join(); t1.close(); t2.close()
    is_draft = o.run('select is_draft from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)[0][0]
    given = o.run('select student_submit._returned_grade(:e, :a)', e=ENR1, a=a)[0][0]['grade']['criteria'][c1]['value']
    return waited, is_draft, given

def three_at_once():
    a, c1, k1 = one_rubric('Race of three')
    t1 = conn('teacher'); t2 = conn('teacher'); t3 = conn('teacher')
    t1.run('select upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=a, x=c1)
    t1.run('select return_grades(:a, :ids::uuid[], :k)', a=a, ids=arr([ENR1]), k=nid())       # returned: level 3
    t1.run('begin'); t1.run('select upsert_rubric_score(:e, :a, :x, 4)', e=ENR1, a=a, x=c1)   # level 4, not committed
    ret = threading.Thread(target=lambda: t3.run('select return_grades(:a, :ids::uuid[], :k)', a=a, ids=arr([ENR1]), k=nid()))
    tick = threading.Thread(target=lambda: t2.run('select set_rubric_check(:e, :a, :k, true)', e=ENR1, a=a, k=k1))
    ret.start(); time.sleep(0.5); tick.start(); time.sleep(0.5)
    both_wait = ret.is_alive() and tick.is_alive()
    t1.run('commit'); ret.join(); tick.join(); t1.close(); t2.close(); t3.close()
    g = o.run('select is_draft, working_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)[0]
    given = o.run('select student_submit._returned_grade(:e, :a)', e=ENR1, a=a)[0][0]['grade']
    now = o.run('select public._grade_copy(:e, :a)', e=ENR1, a=a)[0][0]
    return both_wait, g[0], given['criteria'][c1]['value'], given['checks'], g[1] == now

# ── 2. The matrix ───────────────────────────────────────────────────────
class World:
    """What the connections aim at. T is read by every connection and
    changed by the scenario that is running, as its pool moves."""
    def __init__(self):
        self.hot = [ENR1, ENR2]
        for n in range(2):
            s, e = nid(), nid()
            o.run("insert into student (id, teacher_id, first_name, last_name) values (:s, :t, 'Race', :n)", s=s, t=A, n='Hot %d' % n)
            o.run('insert into enrollment (id, student_id, course_id, roster_position) values (:e, :s, :c, :p)', e=e, s=s, c=COURSE_A, p=10 + n)
            self.hot.append(e)
        self.subj, self.group, self.sect = nid(), nid(), nid()
        o.run("insert into subject (id, course_id, name) values (:s, :c, 'Race subject')", s=self.subj, c=COURSE_A)
        o.run("insert into competency_group (id, course_id, name) values (:g, :c, 'Race folder')", g=self.group, c=COURSE_A)
        o.run("insert into section (id, course_id, subject_id, competency_group_id, name) values (:x, :c, :s, :g, 'Race section')",
              x=self.sect, c=COURSE_A, s=self.subj, g=self.group)
        self.tags = [nid() for _ in range(3)]
        for n, t in enumerate(self.tags):
            o.run("insert into tag (id, section_id, label, code) values (:t, :x, :l, :k)", t=t, x=self.sect, l='Race competency %d' % n, k='R%d' % n)
        self.r1, self.c1, self.k1 = self.rubric('Race rubric')
        self.r2, self.c2, self.k2 = self.rubric('Race rubric (copy)')
        self.P = self.assessment('points'); self.C = self.assessment('comp'); self.Rb = self.assessment('rubric'); self.Mv = self.assessment('rubric')
        self.seed([self.P, self.C, self.Rb, self.Mv], self.hot)
        self.keep = {t: KEEP[t] + [r[0] for r in o.run('select id from %s where course_id = :c' % t, c=COURSE_A)]
                     for t in ('assessment', 'rubric', 'subject', 'competency_group', 'section', 'enrollment')}
        self.keep['student'] = [r[0] for r in o.run('select id from student where teacher_id = :t', t=A)]
        self.keep['course'] = KEEP['course']
        self.default()
    def rubric(self, name, criteria=3):
        r = nid(); cs = [nid() for _ in range(criteria)]; ks = [nid() for _ in range(criteria)]
        o.run("insert into rubric (id, course_id, name, style) values (:r, :c, :n, 'advanced')", r=r, c=COURSE_A, n=name)
        for n, (x, k) in enumerate(zip(cs, ks)):
            o.run("insert into criterion (id, rubric_id, name, display_order) values (:x, :r, :n, :d)", x=x, r=r, n='Criterion %d' % n, d=n)
            o.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :x, 3, 'A box')", k=k, x=x)
        return r, cs, ks
    def assessment(self, kind, title='Race work', rubric=None, tags=None):
        a = nid()
        o.run("insert into assessment (id, course_id, title, score_mode, max_points, rubric_id) values (:a, :c, :t, :m, :p, :r)", a=a, c=COURSE_A,
              t='%s (%s)' % (title, kind), m='points' if kind == 'points' else 'proficiency', p=10 if kind == 'points' else None,
              r=(rubric or self.r1) if kind == 'rubric' else None)
        if kind == 'comp':
            o.run('insert into assessment_tag (assessment_id, tag_id) select :a, unnest(:t::uuid[])', a=a, t=arr(tags or self.tags))
        return a
    def seed(self, assessments, enrollments, tags=None):
        """A row in every score table for each student on each of these, so a save meets a row that is there."""
        a, e = arr(assessments), arr(enrollments)
        o.run("""insert into score (enrollment_id, assessment_id, value) select e, a.id, case when a.score_mode = 'points' then 5 end
                   from unnest(:e::uuid[]) e, assessment a where a.id = any (:a::uuid[]) on conflict do nothing""", a=a, e=e)
        o.run("""insert into tag_score (enrollment_id, assessment_id, tag_id, value) select e, t.assessment_id, t.tag_id, 2
                   from unnest(:e::uuid[]) e, assessment_tag t where t.assessment_id = any (:a::uuid[])
                    and (:t::uuid[] is null or t.tag_id = any (:t::uuid[])) on conflict do nothing""", a=a, e=e, t=arr(tags) if tags else None)
        o.run("""insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) select e, a.id, c.id, 3
                   from unnest(:e::uuid[]) e, assessment a join criterion c on c.rubric_id = a.rubric_id where a.id = any (:a::uuid[])
                 on conflict do nothing""", a=a, e=e)
        o.run("""insert into rubric_check_score (enrollment_id, assessment_id, check_id) select e, a.id, k.id
                   from unnest(:e::uuid[]) e, assessment a join criterion c on c.rubric_id = a.rubric_id join criterion_check k on k.criterion_id = c.id
                  where a.id = any (:a::uuid[]) on conflict do nothing""", a=a, e=e)
    def default(self):
        self.T = {'enr': list(self.hot), 'points': [self.P], 'comp': [(self.C, list(self.tags))],
                  'rubric': [(self.Rb, list(self.c1), list(self.k1))]}
    def reset(self):
        """Between scenarios: what the last one made is gone, the class holds grades again and the standing rows are as they began."""
        purge(self.keep)
        o.run('delete from tag t using section x where x.id = t.section_id and x.id = :x and not (t.id = any (:k::uuid[]))', x=self.sect, k=arr(self.tags))
        if BATCH_A:
            o.run("update course set student_page_enabled = true, return_grades = 'on_return', name = 'Science 8' where id = :c", c=COURSE_A)
        o.run('update section set removed_at = null where id = :x', x=self.sect)
        o.run('update enrollment set withdrawn_at = null where id = any (:e::uuid[])', e=arr(self.hot))
        o.run('update assessment set rubric_id = :r where id = :a and rubric_id is distinct from :r', r=self.r1, a=self.Rb)
        o.run('insert into assessment_tag (assessment_id, tag_id) select :a, unnest(:t::uuid[]) on conflict do nothing', a=self.C, t=arr(self.tags))
        self.default()

W = None
def save_call(rng):
    """One score save, as a teacher's screen makes them, on a row the scenario is using."""
    T = W.T; e = rng.choice(T['enr']); kinds = [k for k in ('points', 'comp', 'rubric') if T[k]]
    kind = rng.choice(kinds); pick = rng.random()
    if kind == 'points':
        a = rng.choice(T['points'])
        if pick < 0.6: return 'upsert_score(:e, :a, :v)', dict(e=e, a=a, v=rng.randint(0, 10))
        if pick < 0.75: return 'save_score_comment(:e, :a, :t)', dict(e=e, a=a, t=rng.choice(['Good', 'See me', '']))
        if pick < 0.9: return 'set_score_status(:e, :a, :s)', dict(e=e, a=a, s=rng.choice(['LATE', 'NS', None]))
        return 'save_score_report_note(:e, :a, :t, :k)', dict(e=e, a=a, t=rng.choice(['For the report', '']), k=nid())
    if kind == 'comp':
        a, tags = rng.choice(T['comp'])
        if not tags or pick < 0.15: return 'upsert_score(:e, :a, :v)', dict(e=e, a=a, v=rng.randint(0, 4))
        return 'upsert_tag_score(:e, :a, :t, :v)', dict(e=e, a=a, t=rng.choice(tags), v=rng.randint(0, 4))
    a, crit, checks = rng.choice(T['rubric'])
    if checks and pick < 0.4: return 'set_rubric_check(:e, :a, :k, :on)', dict(e=e, a=a, k=rng.choice(checks), on=rng.random() < 0.5)
    if not crit: return 'upsert_score(:e, :a, :v)', dict(e=e, a=a, v=rng.randint(0, 4))
    return 'upsert_rubric_score(:e, :a, :x, :v)', dict(e=e, a=a, x=rng.choice(crit), v=rng.randint(0, 4))
def return_call(rng):
    T = W.T; every = T['points'] + [x[0] for x in T['comp']] + [x[0] for x in T['rubric']]
    return 'return_grades(:a, :ids::uuid[], :k)', dict(a=rng.choice(every), ids=arr(T['enr']), k=nid())

def pool_assessments(n, kind='points'):
    """n assessments with scores on them, to be deleted one at a time."""
    ids = [nid() for _ in range(n)]
    o.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id)
             select x, :c, 'Race pool', :m, :p, :r from unnest(:ids::uuid[]) x""", c=COURSE_A, ids=arr(ids),
          m='points' if kind == 'points' else 'proficiency', p=10 if kind == 'points' else None, r=None)
    if kind == 'comp':
        o.run('insert into assessment_tag (assessment_id, tag_id) select x, :t from unnest(:ids::uuid[]) x', ids=arr(ids), t=W.tags[0])
    W.seed(ids, W.hot)
    return ids
def pool_units(n):
    """n subjects, each with a folder, a section and a competency that the standing competency work is linked to and scored on."""
    u = [dict(subj=nid(), group=nid(), sect=nid(), tag=nid()) for _ in range(n)]
    col = lambda k: arr([x[k] for x in u])
    o.run("insert into subject (id, course_id, name) select x, :c, 'Race pool' from unnest(:s::uuid[]) x", c=COURSE_A, s=col('subj'))
    o.run("insert into competency_group (id, course_id, name) select x, :c, 'Race pool' from unnest(:g::uuid[]) x", c=COURSE_A, g=col('group'))
    o.run("""insert into section (id, course_id, subject_id, competency_group_id, name)
             select x, :c, s, g, 'Race pool' from unnest(:x::uuid[], :s::uuid[], :g::uuid[]) u(x, s, g)""", c=COURSE_A, x=col('sect'), s=col('subj'), g=col('group'))
    o.run("insert into tag (id, section_id, label) select t, x, 'Race pool' from unnest(:t::uuid[], :x::uuid[]) u(t, x)", t=col('tag'), x=col('sect'))
    o.run('insert into assessment_tag (assessment_id, tag_id) select :a, t from unnest(:t::uuid[]) t', a=W.C, t=col('tag'))
    W.seed([W.C], W.hot)
    return u
def pool_students(n):
    """n withdrawn students with scores on the standing work."""
    ss = [nid() for _ in range(n)]; es = [nid() for _ in range(n)]
    o.run("insert into student (id, teacher_id, first_name, last_name) select x, :t, 'Race', 'Pool' from unnest(:s::uuid[]) x", t=A, s=arr(ss))
    o.run("""insert into enrollment (id, student_id, course_id, roster_position, withdrawn_at)
             select e, s, :c, 100, now() from unnest(:e::uuid[], :s::uuid[]) u(e, s)""", c=COURSE_A, e=arr(es), s=arr(ss))
    W.seed([W.P, W.C, W.Rb], es, tags=W.tags)
    return es
def window(pool, i, width=3): return pool[i:i + width] or pool[-1:]

def scenarios():
    """name -> (setup() or None, call(i, rng, state) -> (sql, params), after(i, state) or None, role).
    setup returns the scenario's state. Every call is one RPC, as the app sends it."""
    S = {}
    def add(name, call, setup=None, after=None, role='teacher', batch_a=False):
        if batch_a and not BATCH_A: return
        S[name] = (setup, call, after, role)
    hot = lambda rng: rng.choice(W.hot)
    # The score RPCs, on the same cells the saves use.
    add('upsert_score', lambda i, rng, st: ('upsert_score(:e, :a, :v)', dict(e=hot(rng), a=W.P, v=i % 11)))
    add('upsert_tag_score', lambda i, rng, st: ('upsert_tag_score(:e, :a, :t, :v)', dict(e=hot(rng), a=W.C, t=rng.choice(W.tags), v=i % 5)))
    add('upsert_rubric_score', lambda i, rng, st: ('upsert_rubric_score(:e, :a, :x, :v)', dict(e=hot(rng), a=W.Rb, x=rng.choice(W.c1), v=i % 5)))
    add('set_rubric_check', lambda i, rng, st: ('set_rubric_check(:e, :a, :k, :on)', dict(e=hot(rng), a=W.Rb, k=rng.choice(W.k1), on=i % 2 == 0)))
    add('save_score_comment', lambda i, rng, st: ('save_score_comment(:e, :a, :t)', dict(e=hot(rng), a=rng.choice([W.P, W.C, W.Rb]), t='Comment %d' % (i % 3))))
    add('save_score_report_note', lambda i, rng, st: ('save_score_report_note(:e, :a, :t, :k)', dict(e=hot(rng), a=rng.choice([W.P, W.C, W.Rb]), t='Note %d' % (i % 3), k=nid())))
    add('set_score_status', lambda i, rng, st: ('set_score_status(:e, :a, :s)', dict(e=hot(rng), a=rng.choice([W.P, W.C, W.Rb]), s=[None, 'NS', 'EXC', 'LATE'][i % 4])))
    add('clear_score', lambda i, rng, st: ('clear_score(:e, :a)', dict(e=hot(rng), a=rng.choice([W.P, W.C, W.Rb]))))
    add('clear_row_scores', lambda i, rng, st: ('clear_row_scores(:e, :c)', dict(e=hot(rng), c=COURSE_A)))
    add('clear_column_scores', lambda i, rng, st: ('clear_column_scores(:a)', dict(a=rng.choice([W.P, W.C, W.Rb]))))
    add('fill_rubric', lambda i, rng, st: ('fill_rubric(:e, :a, :v, 0::smallint)', dict(e=hot(rng), a=W.Rb, v=1 + i % 4)))
    add('return_grades', lambda i, rng, st: return_call(rng), batch_a=True)
    # The class and its assessments.
    patches = (['{"return_grades": "on_save"}', '{"return_grades": "on_return"}', '{"student_page_enabled": false}', '{"student_page_enabled": true}']
               if BATCH_A else []) + ['{"name": "Science 8"}', '{"description": "Race"}']
    add('update_course', lambda i, rng, st: ('update_course(:c, :p::jsonb)', dict(c=COURSE_A, p=patches[i % len(patches)])))
    add('create_assessment', lambda i, rng, st: (
        "create_assessment(p_course_id => :c, p_title => 'Race made', p_score_mode => :m, p_max_points => :p, p_tag_ids => :t::uuid[], p_idempotency_key => :k)",
        dict(c=COURSE_A, m='points' if i % 2 else 'proficiency', p=10 if i % 2 else None, t=arr(W.tags if i % 2 == 0 else []), k=nid())))
    def update_assessment(i, rng, st):
        which = i % 5
        if which == 0: return 'update_assessment(:a, :p::jsonb)', dict(a=W.P, p=json.dumps({'title': 'Race work %d' % i, 'max_points': 10 + i % 3}))
        if which == 1: return 'update_assessment(:a, :p::jsonb, :t::uuid[])', dict(a=W.C, p='{}', t=arr(W.tags[:2]))
        if which == 2: return 'update_assessment(:a, :p::jsonb, :t::uuid[])', dict(a=W.C, p='{}', t=arr(W.tags))
        if which == 3: return 'update_assessment(:a, :p::jsonb)', dict(a=W.Rb, p=json.dumps({'rubric_id': None}))
        return 'update_assessment(:a, :p::jsonb)', dict(a=W.Rb, p=json.dumps({'rubric_id': W.r1}))
    add('update_assessment', update_assessment)
    add('save_assessment_tags', lambda i, rng, st: ('save_assessment_tags(:a, :t::uuid[])', dict(a=W.C, t=arr(W.tags[:1 + i % 3]))))
    add('duplicate_assessment', lambda i, rng, st: ('duplicate_assessment(:a, :k)', dict(a=[W.P, W.C, W.Rb][i % 3], k=nid())))
    def del_assessment_setup():
        pool = pool_assessments(CALLS, 'comp')
        return dict(pool=pool)
    def del_assessment(i, rng, st):
        near = window(st['pool'], i)
        W.T = {'enr': list(W.hot), 'points': [], 'comp': [(a, [W.tags[0]]) for a in near], 'rubric': []}
        return 'delete_assessment(:a)', dict(a=st['pool'][i])
    add('delete_assessment', del_assessment, setup=del_assessment_setup)
    # The rubric: criteria and checkboxes edited, dropped and added by a rubric save.
    def rubric_now(st):
        rows_ = o2().run("""select c.id::text, coalesce((select array_agg(k.id::text) from criterion_check k where k.criterion_id = c.id), '{}')
                              from criterion c where c.rubric_id = :r order by c.display_order, c.created_at, c.id""", r=st['r'])
        st['crit'] = [(r[0], list(r[1])) for r in rows_]
        W.T = dict(W.T, rubric=[(st['a'], [c for c, _ in st['crit']], [k for _, ks in st['crit'] for k in ks])])
    def upsert_rubric_setup():
        r, cs, ks = W.rubric('Race rubric (edited)', criteria=5)
        st = {'r': r, 'a': W.assessment('rubric', rubric=r)}
        W.seed([st['a']], W.hot); rubric_now(st); return st
    def upsert_rubric_kept(i, rng, st):
        # Every criterion and box is sent back with its id: names, descriptors and links change, no row goes.
        out = [{'id': cid, 'name': 'Criterion %d.%d' % (n, i), 'display_order': n, 'level_3_descriptor': 'Does it %d' % i,
                'linked_tag_ids': W.tags[:i % 3], 'checks': [{'id': k, 'level': 3, 'label': 'Box %d' % i} for k in checks]}
               for n, (cid, checks) in enumerate(st['crit'])]
        return ('upsert_rubric(:r, :c, :n, :cr::jsonb, null, null, null, :t::jsonb)',
                dict(r=st['r'], c=COURSE_A, n='Race rubric %d' % i, cr=json.dumps(out), t=json.dumps(W.tags[:i % 3]) if i % 4 == 0 else None))
    add('upsert_rubric (nothing removed)', upsert_rubric_kept, setup=upsert_rubric_setup)
    def upsert_rubric_cut(i, rng, st):
        crit = st['crit']; out = []
        for n, (cid, checks) in enumerate(crit):
            if n == 3 and len(crit) > 3 and i % 2 == 0: continue          # a criterion is dropped, with its levels and ticks
            el = {'id': cid, 'name': 'Criterion %d.%d' % (n, i), 'display_order': n}
            if i % 3 == 0: el['checks'] = [{'level': 3, 'label': 'A new box'}]     # its old boxes are dropped, with their ticks
            elif i % 3 == 1: el['checks'] = [{'id': k, 'level': 3, 'label': 'Box %d' % i} for k in checks]
            out.append(el)
        if len(out) < 6: out.append({'name': 'Extra %d' % i, 'display_order': 9, 'checks': [{'level': 2, 'label': 'A box'}]})
        return ('upsert_rubric(:r, :c, :n, :cr::jsonb, null, null, null, null)', dict(r=st['r'], c=COURSE_A, n='Race rubric %d' % i, cr=json.dumps(out)))
    add('upsert_rubric (criteria and boxes removed)', upsert_rubric_cut, setup=upsert_rubric_setup, after=lambda i, st: rubric_now(st))
    def del_rubric_setup():
        made = [W.rubric('Race pool', criteria=1) for _ in range(CALLS)]
        work = [nid() for _ in made]
        o.run("""insert into assessment (id, course_id, title, score_mode, rubric_id)
                 select a, :c, 'Race pool (rubric)', 'proficiency', r from unnest(:a::uuid[], :r::uuid[]) u(a, r)""",
              c=COURSE_A, a=arr(work), r=arr([m[0] for m in made]))
        W.seed(work, W.hot)
        return dict(pool=[(a, r, cs, ks) for a, (r, cs, ks) in zip(work, made)])
    def del_rubric(i, rng, st):
        W.T = {'enr': list(W.hot), 'points': [], 'comp': [], 'rubric': [(a, cs, ks) for a, r, cs, ks in window(st['pool'], i)]}
        return 'delete_rubric(:r)', dict(r=st['pool'][i][1])
    add('delete_rubric', del_rubric, setup=del_rubric_setup)
    # Edit a Copy, as the app does it: the assessment is pointed at the other
    # rubric (update_assessment), then its levels and ticks are moved across.
    def move_setup():
        on = o.run('select rubric_id::text from assessment where id = :a', a=W.Mv)[0][0]
        return dict(on=on)
    def move(i, rng, st):
        to = W.r2 if st['on'] == W.r1 else W.r1
        a, b = (W.c1, W.c2) if to == W.r2 else (W.c2, W.c1); ka, kb = (W.k1, W.k2) if to == W.r2 else (W.k2, W.k1)
        if i % 2 == 0:
            W.T = dict(W.T, rubric=[(W.Mv, list(a) + list(b), list(kb))])
            return 'update_assessment(:a, :p::jsonb)', dict(a=W.Mv, p=json.dumps({'rubric_id': to}))
        st['on'] = to
        return ('move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)',
                dict(a=W.Mv, r=to, m=json.dumps(dict(zip(a, b))), k=json.dumps(dict(zip(ka, kb))), key=nid()))
    add('update_assessment + move_rubric_scores', move, setup=move_setup)
    # Subjects, folders, sections and competencies.
    add('upsert_subject', lambda i, rng, st: ('upsert_subject(:id, :c, :n, null, null, :k)',
                                              dict(id=W.subj if i % 2 else None, c=COURSE_A, n='Race subject %d' % i, k=nid())))
    add('upsert_competency_group', lambda i, rng, st: ('upsert_competency_group(:id, :c, :n, null, null, :k, :one)',
                                                       dict(id=W.group if i % 2 else None, c=COURSE_A, n='Race folder %d' % i, k=nid(), one=i % 4 == 1)))
    add('upsert_section', lambda i, rng, st: ('upsert_section(:id, :s, :n, null, :g, null, :k)',
                                              dict(id=W.sect if i % 2 else None, s=W.subj, n='Race section %d' % i, g=W.group, k=nid())))
    add('upsert_tag', lambda i, rng, st: ('upsert_tag(:id, :x, :l, :code, null, null, :k)',
                                          dict(id=W.tags[i % 3] if i % 2 else None, x=W.sect, l='Race competency %d' % i, code='R%d' % (i % 3), k=nid())))
    add('remove_section', lambda i, rng, st: (('remove_section(:x, :k)' if i % 2 == 0 else 'restore_section(:x, :k)'), dict(x=W.sect, k=nid())))
    def units_setup(): return dict(pool=pool_units(CALLS))
    def unit_delete(fn, part):
        def call(i, rng, st):
            W.T = {'enr': list(W.hot), 'points': [], 'rubric': [], 'comp': [(W.C, [u['tag'] for u in window(st['pool'], i)])]}
            return fn + '(:id)', dict(id=st['pool'][i][part])
        return call
    add('delete_tag', unit_delete('delete_tag', 'tag'), setup=units_setup)
    add('delete_section', unit_delete('delete_section', 'sect'), setup=units_setup)
    add('delete_subject', unit_delete('delete_subject', 'subj'), setup=units_setup)
    add('delete_competency_group', unit_delete('delete_competency_group', 'group'), setup=units_setup)
    # Students.
    add('create_student_and_enroll', lambda i, rng, st: (
        "create_student_and_enroll(p_course_id => :c, p_first_name => 'Race', p_last_name => :n, p_idempotency_key => :k)", dict(c=COURSE_A, n='Made %d' % i, k=nid())))
    add('update_enrollment', lambda i, rng, st: ('update_enrollment(:e, :p::jsonb)', dict(e=hot(rng), p=json.dumps({'is_flagged': i % 2 == 0, 'roster_position': i % 7}))))
    add('withdraw_student', lambda i, rng, st: (('withdraw_student(:e, :k)' if i % 2 == 0 else 'reenrol_student(:e, :k)'), dict(e=W.hot[(i // 2) % len(W.hot)], k=nid())))
    def del_student_setup(): return dict(pool=pool_students(CALLS))
    def del_student(i, rng, st):
        W.T = dict(W.T, enr=window(st['pool'], i))
        return 'delete_withdrawn_student(:e, :k)', dict(e=st['pool'][i], k=nid())
    add('delete_withdrawn_student', del_student, setup=del_student_setup)
    # The restore: a hand-made backup that names this class and grades in it
    # (the app's own restore always makes a new class, which meets nobody).
    def restore(i, rng, st):
        e = hot(rng); other = hot(rng)
        p = {'courses': [dict(course_before, name='Science 8', **({'student_page_enabled': True, 'return_grades': 'on_return'} if BATCH_A else {}))],
             'scores': [{'enrollment_id': e, 'assessment_id': W.P, 'value': i % 11}],
             'tag_scores': [{'enrollment_id': e, 'assessment_id': W.C, 'tag_id': W.tags[i % 3], 'value': 1 + i % 4}],
             'rubric_scores': [{'enrollment_id': other, 'assessment_id': W.Rb, 'criterion_id': W.c1[i % 3], 'value': 1 + i % 4}]}
        if BATCH_A and i % 2:
            p['grade_returns'] = [{'enrollment_id': e, 'assessment_id': W.P, 'is_draft': i % 4 == 1}]
        return 'import_json_restore(:p::jsonb, :k)', dict(p=json.dumps(p, default=str), k=nid())
    add('import_json_restore', restore)
    # Cards and the student page (Batch A's own).
    def live_card(st, e):
        r = o2().run('select id::text from student_card where enrollment_id = :e and stopped_at is null', e=e)
        return r[0][0] if r else nid()
    add('issue_student_cards', lambda i, rng, st: ('issue_student_cards(:c, null, :k)', dict(c=COURSE_A, k=nid())), batch_a=True)
    add('set_cards_work_until', lambda i, rng, st: ('set_cards_work_until(:c, :d::date, :k)', dict(c=COURSE_A, d='2027-06-%02d' % (1 + i % 28), k=nid())), batch_a=True)
    add('mark_student_cards_printed', lambda i, rng, st: ('mark_student_cards_printed(:ids::uuid[], :k)', dict(ids=arr([live_card(st, hot(rng))]), k=nid())), batch_a=True)
    add('unlock_student_card', lambda i, rng, st: ('unlock_student_card(:i, :k)', dict(i=live_card(st, hot(rng)), k=nid())), batch_a=True)
    add('unlock_all_student_cards', lambda i, rng, st: ('unlock_all_student_cards(:c, :k)', dict(c=COURSE_A, k=nid())), batch_a=True)
    add('reissue_student_card', lambda i, rng, st: ('reissue_student_card(:i, :k)', dict(i=live_card(st, hot(rng)), k=nid())), batch_a=True)
    def session_setup():
        """A card for the first student, and a session opened with it."""
        o.run("update student set date_of_birth = '2012-05-15' where id = :s", s=STU1)
        t = conn('teacher'); t.run('select issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid()); t.close()
        code = o.run('select code from student_card where enrollment_id = :e and stopped_at is null', e=ENR1)[0][0]
        s = conn('service')
        r = s.run("select student_submit.verify_card(:c, '2012-05-15', null, null, null, 'race-ip', false)", c=code)[0][0]; s.close()
        assert r.get('ok') and r.get('session_token'), r
        return dict(code=code, token=r['session_token'])
    def every(): return [W.P, W.C, W.Rb, W.Mv]
    add('student: seen', lambda i, rng, st: ("student_submit.seen(:t, :e, :ids::uuid[], 'race-ip')", dict(t=st['token'], e=ENR1, ids=arr(rng.sample(every(), 1 + i % 4)))),
        setup=session_setup, role='service', batch_a=True)
    add('student: page', lambda i, rng, st: ("student_submit.page(:t, :e, 'race-ip')", dict(t=st['token'], e=ENR1)), setup=session_setup, role='service', batch_a=True)
    add('student: card and verify_card', lambda i, rng, st: (
        ("student_submit.card(:c, 'race-ip')", dict(c=st['code'])) if i % 2 else
        ("student_submit.verify_card(:c, :b, null, null, null, 'race-ip', false)", dict(c=st['code'], b='2012-05-16' if i % 100 == 50 else '2012-05-15'))),
        setup=session_setup, role='service', batch_a=True)
    return S

_owner = threading.local()
def o2():
    """An owner connection of the calling thread's own, for a scenario that must read what it just made."""
    if not hasattr(_owner, 'c'): _owner.c = conn()
    return _owner.c

def code_of(err):
    a = err.args[0] if err.args else None
    return a.get('C', '?') if isinstance(a, dict) else type(err).__name__
def run(xs, savers, returners, seed):
    """xs: [(name, scenario, state)]. Each x makes CALLS calls on its own connection; the saves and returns go on until every x has finished.
    Returns {actor: {'calls': n, 'errors': {sqlstate: n}, 'first': {sqlstate: message}, 'waits': {table: n}}}."""
    stats = {}; lock = threading.Lock(); done = threading.Event()
    def tally(name, calls, errors, first, waits):
        with lock:
            s = stats.setdefault(name, {'calls': 0, 'errors': {}, 'first': {}, 'waits': {}})
            s['calls'] += calls
            for k, v in errors.items(): s['errors'][k] = s['errors'].get(k, 0) + v
            for k, v in waits.items(): s['waits'][k] = s['waits'].get(k, 0) + v
            for k, v in first.items(): s['first'].setdefault(k, v)
    def worker(name, role, call, n, after=None):
        c = conn(role); errors = {}; first = {}; waits = {}; i = 0
        while (i < n) if n else not done.is_set():
            sql, kw = call(i)
            try: c.run('select ' + sql, **kw)
            except Exception as err:
                k = code_of(err); errors[k] = errors.get(k, 0) + 1
                info = err.args[0] if err.args and isinstance(err.args[0], dict) else {}
                first.setdefault(k, str(info.get('M', err))[:140])
                if k == '40P01':
                    # CONTEXT: while updating tuple (0,5) in relation "score" ...
                    m = re.search(r'in relation "(\w+)"', info.get('W', '') or '')
                    where = m.group(1) if m else 'a transaction'
                    waits[where] = waits.get(where, 0) + 1
            if after: after(i)
            i += 1
        c.close(); tally(name, i, errors, first, waits)
    threads = []; xthreads = []
    for n_, (name, (setup, call, after, role), st) in enumerate(xs):
        rng = random.Random(seed * 1000 + n_)
        xthreads.append(threading.Thread(target=worker, args=(name, role, (lambda i, call=call, rng=rng, st=st: call(i, rng, st)), CALLS,
                                                              (lambda i, after=after, st=st: after(i, st)) if after else None)))
    for n_ in range(savers):
        rng = random.Random(seed * 1000 + 500 + n_)
        threads.append(threading.Thread(target=worker, args=('saves', 'teacher', (lambda i, rng=rng: save_call(rng)), None)))
    for n_ in range(returners):
        rng = random.Random(seed * 1000 + 700 + n_)
        threads.append(threading.Thread(target=worker, args=('returns', 'teacher', (lambda i, rng=rng: return_call(rng)), None)))
    [t.start() for t in threads + xthreads]; [t.join() for t in xthreads]; done.set(); [t.join() for t in threads]
    return stats

CHECKS = {
    'drift': """select count(*) from grade_return g where g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)""",
    'state': """select count(*) from grade_return g
                 where (g.returned_copy is not null) <> (g.is_draft and g.returned_at is not null)
                    or (g.is_draft and g.returned_copy = g.working_copy) or (g.is_draft and g.returned_at is null and g.working_copy is null)""",
    'orphans': """select count(*) from grade_return g where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
                                                           or not exists (select 1 from assessment a where a.id = g.assessment_id)""",
    'held': """select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id join course c on c.id = e.course_id
                where g.is_draft and not (c.student_page_enabled and c.return_grades is not distinct from 'on_return')""",
}
def after_run():
    return {k: o.run(q)[0][0] for k, q in CHECKS.items()} if BATCH_A else {}

results = []      # {'x':, 'versus':, 'calls':, 'dead':, 'refused': {code: n}, 'checks': {}}
def record(x, versus, stats, checks):
    dead = sum(s['errors'].get('40P01', 0) for s in stats.values())
    refused = {}; first = {}; waits = {}
    for s in stats.values():
        for k, v in s['errors'].items():
            if k != '40P01': refused[k] = refused.get(k, 0) + v
        for k, v in s['waits'].items(): waits[k] = waits.get(k, 0) + v
        for k, v in s['first'].items(): first.setdefault(k, v)
    r = {'x': x, 'versus': versus, 'calls': sum(s['calls'] for s in stats.values()), 'x_calls': {n: s['calls'] for n, s in stats.items()}, 'dead': dead,
         'dead_by': {n: s['errors']['40P01'] for n, s in stats.items() if s['errors'].get('40P01')}, 'dead_waiting_on': waits,
         'refused': refused, 'first': first, 'checks': checks}
    results.append(r)
    return r

EXPECTED = {'23503', 'P0002', '42501', '23505', '55000', '23514', '22023', 'P0001'}   # the row is gone, or the call is refused by its own rule
# RPCs that deadlock with a score save today, with no Batch A loaded (run
# this script on the database without the four migrations to see them). A
# save locks its score row and then the class's sync-cursor row. Each of
# these holds the cursor row already when it goes for a score row: the
# cursor triggers fire after every statement, and after the first level of
# a cascade.
TODAY = {
    'clear_score': 'four deletes, one table after another',
    'clear_row_scores': 'four deletes, one table after another',
    'clear_column_scores': 'four deletes, one table after another',
    'fill_rubric': 'one save after another',
    'upsert_rubric (criteria and boxes removed)': 'the rubric is updated, then criteria and boxes are deleted with their levels and ticks',
    'delete_rubric': 'a cascade two tables deep: criteria, then their levels',
    'update_assessment + move_rubric_scores': 'levels are moved, then ticks',
    'delete_section': 'a cascade two tables deep: competencies, then their levels',
    'delete_subject': 'a cascade three tables deep',
}
OURS = ('returns', 'return_grades', 'student: seen')     # these wait again if they are picked while waiting in line
def judge(r, name, versus):
    """The checks on one run of the matrix, with Batch A."""
    label = '%s against %s' % (name, versus)
    if name in TODAY and 'saves' in versus:
        ok('today: %s deadlocks without Batch A too (%s); here %d of %d calls. None was waiting on a grade_return row, and no Return or seen() died'
           % (label, TODAY[name], r['dead'], r['calls']),
           'grade_return' not in r['dead_waiting_on'] and not any(n in r['dead_by'] for n in OURS), (r['dead_by'], r['dead_waiting_on']))
    else:
        ok('%s: no deadlock in %d calls' % (label, r['calls']), r['dead'] == 0, (r['dead_by'], r['dead_waiting_on']))
    ok('%s: every grade_return row is right afterwards' % label, not any(r['checks'].values()), r['checks'])
    odd = {k: v for k, v in r['refused'].items() if k not in EXPECTED}
    ok('%s: the only calls refused lost a race for a row that was deleted' % label, not odd, {k: r['first'][k] for k in odd})
try:
    if BATCH_A:
        o.run("update course set student_page_enabled = true, return_grades = 'on_return' where id = :c", c=COURSE_A)
        if not ONLY:
            for t in SCORE_TABLES:
                o.run('alter table public.%s disable trigger course_sync_cursor_%s_gradebook' % (t, t))
            waited, is_draft, given = two_saves()
            ok('with the lock, the second save waits for the first', waited, waited)
            ok('and then sees it: the grade is still a draft and the student is still given the returned 3', is_draft is True and given == 3, (is_draft, given))
            for t in SCORE_TABLES:
                o.run('alter table public.%s enable trigger course_sync_cursor_%s_gradebook' % (t, t))
            both_wait, is_draft, level, ticks, kept = three_at_once()
            ok('a Return and a tick both wait for a level that is being saved', both_wait)
            ok('and the student is given the raised level 4 whichever went first (the Return first: no tick, a draft; the tick first: the tick, returned)',
               level == 4 and ((is_draft and ticks == []) or (not is_draft and len(ticks) == 1)), (is_draft, level, ticks))
            ok('and grade_return holds the grade as the score tables have it', kept)

    W = World()
    S = scenarios()
    names = [n for n in S if not ONLY or n in ONLY]
    VERSUS = [('saves', 2, 0), ('returns', 0, 2), ('saves and returns', 2, 1)] if BATCH_A else [('saves', 2, 0)]
    for seed, name in enumerate(names):
        for versus, savers, returners in VERSUS:
            try:
                W.reset()
                st = S[name][0]() if S[name][0] else {}
                stats = run([(name, S[name], st)], savers, returners, seed)
            except Exception as err:
                ok('%s against %s ran' % (name, versus), False, err); continue
            r = record(name, versus, stats, after_run())
            if BATCH_A: judge(r, name, versus)
    # All at once, twice: first the RPCs that are clean against saves today,
    # then every one. The RPCs also meet each other here, and some of those
    # pairs deadlock today as well (update_assessment and save_assessment_tags
    # both rewrite one assessment's links), so neither run can be asked for
    # no deadlock: both are counted, beside the baseline's.
    for label, group in (('all that are clean against saves, at once', [n for n in names if n not in TODAY]), ('all at once', names)):
        if ONLY and len(ONLY) < 2: break
        try:
            W.reset()
            mixed = [(n, S[n], S[n][0]() if S[n][0] else {}) for n in group]
            W.default()
            stats = run(mixed, 3, 2 if BATCH_A else 0, 99)
        except Exception as err:
            ok('%s ran' % label, False, err); continue
        r = record('%s (%d)' % (label, len(group)), 'saves and returns' if BATCH_A else 'saves', stats, after_run())
        if BATCH_A:
            ok('today: %s: RPCs that deadlock with each other without Batch A do here too, %d of %d calls. None was waiting on a grade_return row, and no Return or seen() died'
               % (label, r['dead'], r['calls']),
               'grade_return' not in r['dead_waiting_on'] and not any(n in r['dead_by'] for n in OURS), (r['dead_by'], r['dead_waiting_on']))
            ok('%s: every grade_return row is right afterwards' % label, not any(r['checks'].values()), r['checks'])
finally:
    cleanup()

print('\n'.join('PASS ' + p for p in passed))
print('%-34s %-18s %7s %9s  %s' % ('RPC', 'against', 'calls', 'deadlocks', 'refused (SQLSTATE: calls)'))
for r in results:
    print('%-34s %-18s %7d %9d  %s%s' % (r['x'][:34], r['versus'], r['calls'], r['dead'], ', '.join('%s: %d' % kv for kv in sorted(r['refused'].items())) or '-',
                                          ('   [dead while waiting on ' + ', '.join('%s: %d' % kv for kv in sorted(r['dead_waiting_on'].items())) + ']') if r['dead'] else ''))
print('deadlocks in all: %d of %d calls%s' % (sum(r['dead'] for r in results), sum(r['calls'] for r in results),
                                            '' if BATCH_A else ' (the baseline: no Batch A, nothing asserted)'))
if os.environ.get('RACE_JSON'):
    json.dump({'batch_a': BATCH_A, 'calls': CALLS, 'results': results}, open(os.environ['RACE_JSON'], 'w'), indent=1)
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
