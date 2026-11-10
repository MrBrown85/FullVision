"""Exercise migrations/2026111001_assessment_created_at_in_bundle.sql (S0-M4)
on the local stand-in: get_class_bundle and get_gradebook each send every
assessment's created_at, and nothing else about either changes.

- both functions start as the definitions the migration was written against
  (get_class_bundle: the live fingerprint in live-function-md5.txt);
- after the migration every assessment in both payloads has created_at,
  equal to the table's, and the payloads are otherwise the same, key by key;
- Teacher B, no JWT and anon get what they got before;
- owner, grants, SECURITY DEFINER, volatility and search_path are unchanged,
  and each body differs from the old one by the added key alone;
- no row changes and no class's sync version moves; not_modified still works;
- a second run changes nothing; a different body stops the file with nothing
  changed.

One transaction, rolled back at the end.

PGPORT=54329 PGDATABASE=fv_bundle python3 run.py harness.sql score-prelude.sql score-tables.sql \\
    bundle-prelude.sql bundle-tables.sql
PGPORT=54329 PGDATABASE=fv_bundle python3 bundle_created_at.py
"""
import json, os, re, sys, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION = os.path.join(HERE, '..', '2026111001_assessment_created_at_in_bundle.sql')
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
BUNDLE = 'public.get_class_bundle(uuid,bigint)'; GRADEBOOK = 'public.get_gradebook(uuid)'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:400]))
c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))
def as_owner(): c.run('reset role')
def as_teacher(uid):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run('set local role authenticated')
def as_anon():
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', '', true)"); c.run('set local role anon')
def one(sql, **kw):
    as_owner(); r = c.run(sql, **kw); return r[0][0] if r else None
def rows(sql, **kw):
    as_owner(); return [list(r) for r in c.run(sql, **kw)]
def call(who, sql, **kw):
    """The result, or ('error', sqlstate, message) as that caller gets it."""
    c.run('savepoint call')
    try:
        if who == 'anon': as_anon()
        else: as_teacher(who)
        r = c.run('select ' + sql, **kw)[0][0]
        c.run('release savepoint call'); return r
    except pg.DatabaseError as e:
        c.run('rollback to savepoint call')
        return ('error', e.args[0].get('C'), e.args[0].get('M'))
nid = lambda: str(uuid.uuid4())
def statements():
    """The migration's statements, without its begin and commit: this script's transaction holds them."""
    return [s for s in split(open(MIGRATION).read()) if s.strip().lower() not in ('begin', 'commit')]
def apply():
    as_owner()
    for s in statements(): c.run(s)
def md5(fn): return one("select md5(pg_get_functiondef('%s'::regprocedure))" % fn)
def about(fn):
    """Everything about a function but its body."""
    return rows("""select p.proowner::regrole::text, p.prosecdef, p.provolatile, p.proconfig::text, coalesce(p.proacl::text, ''),
                          pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), p.prolang, p.proparallel
                     from pg_proc p where p.oid = '%s'::regprocedure""" % fn)[0]
def body(fn): return one("select prosrc from pg_proc where oid = '%s'::regprocedure" % fn)
def flat(v, path=''):
    """{path: leaf} for a JSON value, lists by position."""
    if isinstance(v, dict):
        out = {}
        for k, x in v.items(): out.update(flat(x, path + '.' + k))
        return out or {path: {}}
    if isinstance(v, list):
        out = {}
        for i, x in enumerate(v): out.update(flat(x, '%s[%d]' % (path, i)))
        return out or {path: []}
    return {path: v}

c.run('begin')

# ── The two functions are the ones the migration was written against ───
live = {}
for line in open(os.path.join(HERE, 'live-function-md5.txt')):
    if line.strip() and not line.startswith('#'): live[line.split()[0]] = line.split()[1]
guard = dict(re.findall(r"\('public\.(\w+)\([^']*\)',\s+'([0-9a-f]{32})'", open(MIGRATION).read()))
# The migration is applied on the live database now (2026-11-10), so
# live-function-md5.txt holds the definitions AFTER it. This script still
# starts from the ones before it, which bundle-prelude.sql rebuilds and the
# migration's own check expects, and ends at the live ones.
ok("get_class_bundle as loaded is the definition the migration's check expects (the live one before S0-M4)", md5(BUNDLE) == guard.get('get_class_bundle'), md5(BUNDLE))
ok("get_gradebook as loaded is the definition the migration's check expects (the live one before S0-M4)", md5(GRADEBOOK) == guard.get('get_gradebook'), md5(GRADEBOOK))

# ── A class with work in it ────────────────────────────────────────────
as_owner()
subj, sect, t1, t2, rub, c1, k1, cat, mod = (nid() for _ in range(9))
c.run("insert into subject (id, course_id, name) values (:s, :c, 'Science')", s=subj, c=COURSE_A)
c.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Questioning')", x=sect, c=COURSE_A, s=subj)
c.run("insert into tag (id, section_id, label, code) values (:a, :x, 'Ask questions', 'Q1'), (:b, :x, 'Plan a fair test', 'Q2')", a=t1, b=t2, x=sect)
c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report', 'advanced')", r=rub, c=COURSE_A)
c.run("insert into criterion (id, rubric_id, name) values (:x, :r, 'Method')", x=c1, r=rub)
c.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :x, 3, 'Lists every step')", k=k1, x=c1)
c.run("insert into category (id, course_id, name, weight) values (:i, :c, 'Tests', 100)", i=cat, c=COURSE_A)
c.run("insert into module (id, course_id, name) values (:i, :c, 'Unit 1')", i=mod, c=COURSE_A)
# Five pieces. Two share a date and a display order and were made a second
# apart; one was made first and sits last in display order; one has no date.
MADE = [('Quiz', 'points', 10, None, '2026-10-01', 2, '2026-10-01 09:00:00+00'),
        ('Lab', 'proficiency', None, rub, '2026-10-06', 1, '2026-10-06 17:30:00.123456+00'),
        ('Questions, first sitting', 'proficiency', None, None, '2026-10-06', 1, '2026-10-06 17:30:01+00'),
        ('Made first, shown last', 'proficiency', None, None, '2026-09-15', 9, '2026-09-01 08:00:00-07'),
        ('No date', 'points', 5, None, None, 0, '2026-11-09 23:59:59.999999+00')]
PIECES = {}
for title, mode, pts, r, date, order, made in MADE:
    a = nid(); PIECES[a] = title
    c.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id, date_assigned, display_order,
                                     category_id, module_id, created_at)
             values (:a, :c, :t, :m, :p, :r, :d::date, :o, :cat, :mod, :made::timestamptz)""",
          a=a, c=COURSE_A, t=title, m=mode, p=pts, r=r, d=date, o=order, cat=cat if mode == 'points' else None, mod=mod, made=made)
    if mode == 'proficiency' and not r:
        c.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :x), (:a, :y)', a=a, x=t1, y=t2)
by_title = {v: k for k, v in PIECES.items()}
c.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 7), (:f, :a, 9)', e=ENR1, f=ENR2, a=by_title['Quiz'])
c.run('insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 3)', e=ENR1, a=by_title['Questions, first sitting'], t=t1)
c.run('insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :x, 4)', e=ENR1, a=by_title['Lab'], x=c1)
c.run('insert into rubric_check_score (enrollment_id, assessment_id, check_id) values (:e, :a, :k)', e=ENR1, a=by_title['Lab'], k=k1)
other = nid()
c.run("insert into assessment (id, course_id, title) values (:a, :c, 'Another teacher''s')", a=other, c=COURSE_B)

def everything():
    """Every row of the tables the two functions read that this script fills, and every class's sync version."""
    return one("""select md5(coalesce((select string_agg(x::text, '|' order by x.id) from assessment x), '')
                           || coalesce((select string_agg(x::text, '|' order by x.course_id) from course_sync_cursor x), '')
                           || coalesce((select string_agg(x::text, '|' order by x::text) from score x), '')
                           || coalesce((select string_agg(x::text, '|' order by x.id) from course x), ''))""")
CALLS = [('Teacher A, her class, the bundle', A, 'get_class_bundle(:c)', COURSE_A),
         ('Teacher A, her class, get_gradebook', A, 'get_gradebook(:c)', COURSE_A),
         ("Teacher B, Teacher A's class, the bundle", B, 'get_class_bundle(:c)', COURSE_A),
         ("Teacher B, Teacher A's class, get_gradebook", B, 'get_gradebook(:c)', COURSE_A),
         ('no JWT, the bundle', None, 'get_class_bundle(:c)', COURSE_A),
         ('no JWT, get_gradebook', None, 'get_gradebook(:c)', COURSE_A),
         ('anon, the bundle', 'anon', 'get_class_bundle(:c)', COURSE_A),
         ('anon, get_gradebook', 'anon', 'get_gradebook(:c)', COURSE_A),
         ('Teacher A, a class that does not exist, the bundle', A, 'get_class_bundle(:c)', nid())]
before = {name: call(who, sql, c=cid) for name, who, sql, cid in CALLS}
bundle0, gb0 = before[CALLS[0][0]], before[CALLS[1][0]]
ok('before: the bundle lists the five pieces and none has created_at',
   isinstance(bundle0, dict) and len(bundle0['gradebook']['assessments']) == 5 and not any('created_at' in a for a in bundle0['gradebook']['assessments']),
   bundle0 if not isinstance(bundle0, dict) else [sorted(a) for a in bundle0['gradebook']['assessments']][:1])
ok('before: get_gradebook lists the five pieces and none has created_at',
   isinstance(gb0, dict) and len(gb0['assessments']) == 5 and not any('created_at' in a for a in gb0['assessments']), gb0 if not isinstance(gb0, dict) else '')
ok('before: Teacher B, no JWT and anon are each refused or shown nothing',
   all(isinstance(before[n], tuple) for n, who, sql, cid in CALLS[2:] if 'bundle' in n)
   and before[CALLS[3][0]][0] == 'error' and before[CALLS[7][0]][0] == 'error', {n: before[n] for n, *_ in CALLS[2:]})
about0 = {fn: about(fn) for fn in (BUNDLE, GRADEBOOK)}; body0 = {fn: body(fn) for fn in (BUNDLE, GRADEBOOK)}
rows0 = everything(); version0 = one('select version from course_sync_cursor where course_id = :c', c=COURSE_A)
c.run('savepoint clean')

# ── The migration ──────────────────────────────────────────────────────
apply()
ok('after the migration both are the live functions of today, byte for byte',
   md5(BUNDLE) == live['get_class_bundle'] and md5(GRADEBOOK) == live['get_gradebook'], (md5(BUNDLE), md5(GRADEBOOK)))
after = {name: call(who, sql, c=cid) for name, who, sql, cid in CALLS}
bundle1, gb1 = after[CALLS[0][0]], after[CALLS[1][0]]
table = {r[0]: r[1] for r in rows("select id::text, to_jsonb(created_at) #>> '{}' from assessment where course_id = :c", c=COURSE_A)}
for name, payload, lst in (('the bundle', bundle1, bundle1['gradebook']['assessments']), ('get_gradebook', gb1, gb1['assessments'])):
    ok('%s: every assessment has created_at' % name, len(lst) == 5 and all(a.get('created_at') for a in lst), [a.get('created_at') for a in lst])
    ok("%s: each is the table's created_at, to the microsecond" % name, all(a['created_at'] == table[a['id']] for a in lst),
       [(a['created_at'], table[a['id']]) for a in lst][:2])
    ok('%s: each reads as a time with its offset' % name,
       all(re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d:\d\d', a['created_at']) for a in lst), [a['created_at'] for a in lst])
for name, old, new, prefix in (('the bundle', bundle0, bundle1, '.gradebook.assessments['), ('get_gradebook', gb0, gb1, '.assessments[')):
    f0, f1 = flat(old), flat(new)
    added = sorted(set(f1) - set(f0)); gone = sorted(set(f0) - set(f1)); changed = sorted(k for k in f0 if k in f1 and f0[k] != f1[k])
    ok('%s: the only new keys are the five created_at' % name,
       len(added) == 5 and all(k.startswith(prefix) and k.endswith('].created_at') for k in added), added[:8])
    ok('%s: no key is gone and no other value changed, key by key (%d compared)' % (name, len(f0)), not gone and not changed, (gone[:3], changed[:3]))
ok('the bundle still lists the pieces by display order, then when they were made',
   [a['title'] for a in bundle1['gradebook']['assessments']]
   == ['No date', 'Lab', 'Questions, first sitting', 'Quiz', 'Made first, shown last'], [a['title'] for a in bundle1['gradebook']['assessments']])
two = {a['title']: a['created_at'] for a in bundle1['gradebook']['assessments']}
ok('two pieces with one date and one display order can be told apart by created_at', two['Lab'] < two['Questions, first sitting'], two)
for n, who, sql, cid in CALLS[2:]:
    ok('%s: as before' % n, after[n] == before[n], (before[n], after[n]))

# ── Nothing else about either function changed ─────────────────────────
for fn, old, new in ((BUNDLE, "'core_competency_ids', to_jsonb(asm.core_competency_ids)", "'created_at', asm.created_at"),
                     (GRADEBOOK, "'core_competency_ids', to_jsonb(a.core_competency_ids),", "'created_at', a.created_at,")):
    short = fn.split('.')[1].split('(')[0]
    ok('%s: owner, grants, SECURITY DEFINER, volatility, search_path, arguments and result are unchanged' % short, about(fn) == about0[fn], (about0[fn], about(fn)))
    b = body(fn)
    lines = [l for l in b.split('\n') if l not in body0[fn].split('\n')]
    ok('%s: the body holds the new key once, and the old body did not' % short, b.count(new) == 1 and body0[fn].count(new) == 0, lines)
    # Take the added key out again (with the comma and line break that came with it) and it is the old body.
    without = b.replace(new, '\x00')
    ok('%s: take the added key out and it is the old body, byte for byte' % short,
       body0[fn] in (re.sub(r',\n[ ]*\x00', '', without), re.sub(r'\n[ ]*\x00', '', without)), lines)
ok('no row changed and no class sync version moved', everything() == rows0)

# ── The saved copy's version check still works ─────────────────────────
r = call(A, 'get_class_bundle(:c, :v)', c=COURSE_A, v=version0)
ok('a browser that sends the version it holds is still told not_modified', r == {'not_modified': True, 'version': version0}, r)
ok('so it goes on without created_at until the class changes', one('select version from course_sync_cursor where course_id = :c', c=COURSE_A) == version0)
as_owner(); c.run("update assessment set title = 'Quiz 1' where id = :a", a=by_title['Quiz'])
r = call(A, 'get_class_bundle(:c, :v)', c=COURSE_A, v=version0)
ok('after any save to the class, the same request brings the whole bundle, with created_at',
   isinstance(r, dict) and not r.get('not_modified') and all(a.get('created_at') for a in r['gradebook']['assessments']), str(r)[:200])

# ── A second run, and a different body ─────────────────────────────────
m = (md5(BUNDLE), md5(GRADEBOOK))
apply()
ok('a second run changes nothing', (md5(BUNDLE), md5(GRADEBOOK)) == m)
c.run('rollback to savepoint clean')
ok('(back to the functions as they were)', md5(BUNDLE) == guard['get_class_bundle'] and md5(GRADEBOOK) == guard['get_gradebook'])
for fn, other_fn, edit in ((GRADEBOOK, BUNDLE, ("'due_date', a.due_date,", "'due_date',  a.due_date,")),
                           (BUNDLE, GRADEBOOK, ("'due_date', asm.due_date,", "'due_date',  asm.due_date,"))):
    c.run('savepoint guard'); as_owner()
    d = one("select pg_get_functiondef('%s'::regprocedure)" % fn)
    assert d.count(edit[0]) == 1
    c.run(d.replace(*edit))
    changed = md5(fn); other_md5 = md5(other_fn)
    try:
        apply(); err = None
    except pg.DatabaseError as e:
        err = e.args[0].get('M'); c.run('rollback to savepoint guard')
    short = fn.split('.')[1].split('(')[0]
    ok('a %s that is not the expected definition stops the file at its first check' % short,
       err is not None and 'is not the definition this migration was written against' in err and short in err, err)
    c.run('rollback to savepoint guard')

c.run('rollback')
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
