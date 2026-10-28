"""Exercise migrations/20261028_term_rating_habits_approval.sql on the local
stand-in (harness.sql + term-rating-prelude.sql): habits and approval through
save_term_rating as Teacher A, what Teacher B and no JWT can do, the audit
rows, and get_class_bundle's read-back. One transaction, rolled back.

PGPORT=54331 PGDATABASE=fv_tq python3 run.py harness.sql term-rating-prelude.sql ../20261028_term_rating_habits_approval.sql
PGPORT=54331 PGDATABASE=fv_tq python3 term_rating_habits.py
"""
import os, sys, json
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:300]))

c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))
c.run('begin')
def as_teacher(uid):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run('set role authenticated')
def sp(): c.run('savepoint sp')
def expect_error(name, fn, code=None):
    try:
        fn(); ok(name, False, 'no error raised')
    except Exception as e:
        msg = str(e); ok(name, (code in msg) if code else True, msg)
    finally:
        c.run('rollback to savepoint sp')
def save(enr, term, payload):
    return c.run('select save_term_rating(:e, :t, cast(:p as jsonb))', e=enr, t=term, p=json.dumps(payload))[0][0]
def row(enr, term):
    r = c.run('select habits, approved_at, narrative_html from term_rating where enrollment_id = :e and term = :t', e=enr, t=term)
    return r[0] if r else None
def audit(field):
    return c.run('select old_value, new_value from term_rating_audit where field_changed = :f order by changed_at, id', f=field)
def bundle_row(enr, term):
    b = c.run('select get_class_bundle(:c)', c=COURSE_A)[0][0]
    return next((r for r in b['term_ratings'] if r['enrollment_id'] == enr and r['term'] == term), None)

# ── The columns ────────────────────────────────────────────────────────
c.run('reset role')
cols = dict(c.run("select column_name, column_default from information_schema.columns where table_name = 'term_rating' and column_name in ('habits', 'approved_at')"))
ok('term_rating has habits with default {}', 'habits' in cols and "'{}'" in (cols['habits'] or ''), cols)
ok('term_rating has approved_at, no default', 'approved_at' in cols and cols['approved_at'] is None, cols)

# ── Habits ─────────────────────────────────────────────────────────────
as_teacher(A); sp()
save(ENR1, 2, {'narrative_html': 'Cece has had a steady term.'})
r = row(ENR1, 2)
ok('a row saved without habits has {} and no approval', r[0] == {} and r[1] is None, r)
save(ENR1, 2, {'habits': {'completes': 4, 'part': 3}})
ok('habits are stored as sent', row(ENR1, 2)[0] == {'completes': 4, 'part': 3}, row(ENR1, 2))
ok('saving habits leaves the narrative alone', row(ENR1, 2)[2] == 'Cece has had a steady term.', row(ENR1, 2))
save(ENR1, 2, {'habits': {'completes': 4, 'ready': 5}})
ok('habits replace the whole map (part is gone, Not Seen kept)', row(ENR1, 2)[0] == {'completes': 4, 'ready': 5}, row(ENR1, 2))
save(ENR1, 2, {'narrative_html': 'Cece has had a steady term. More.'})
ok('a narrative save leaves the habits alone', row(ENR1, 2)[0] == {'completes': 4, 'ready': 5}, row(ENR1, 2))
h = audit('habits')
ok('each habits change is audited, old and new', len(h) == 2 and json.loads(h[1][0]) == {'completes': 4, 'part': 3} and json.loads(h[1][1]) == {'completes': 4, 'ready': 5}, h)
sp(); expect_error('a habit outside 1..5 is refused', lambda: save(ENR1, 2, {'habits': {'completes': 6}}), '22023')
sp(); expect_error('a habit of 0 is refused', lambda: save(ENR1, 2, {'habits': {'completes': 0}}), '22023')
sp(); expect_error('a fractional habit is refused', lambda: save(ENR1, 2, {'habits': {'completes': 2.5}}), '22023')
sp(); expect_error('a habit as a string is refused', lambda: save(ENR1, 2, {'habits': {'completes': '3'}}), '22023')
sp(); expect_error('an unknown habit is refused', lambda: save(ENR1, 2, {'habits': {'kindness': 3}}), '22023')
sp(); expect_error('habits as an array is refused', lambda: save(ENR1, 2, {'habits': [3]}), '22023')
sp(); expect_error('habits as null is refused', lambda: save(ENR1, 2, {'habits': None}), '22023')
save(ENR1, 2, {'habits': {}})
ok('{} clears every habit', row(ENR1, 2)[0] == {}, row(ENR1, 2))
c.run('reset role')
sp(); expect_error('the column refuses a non-object', lambda: c.run("update term_rating set habits = '[]' where enrollment_id = :e", e=ENR1), 'term_rating_habits_object')
as_teacher(A)

# ── Approval ───────────────────────────────────────────────────────────
save(ENR1, 2, {'approved': True})
t1 = row(ENR1, 2)[1]
ok('approved true sets approved_at', t1 is not None, row(ENR1, 2))
save(ENR1, 2, {'approved': True, 'habits': {'completes': 4}})
ok('approving again keeps the first time', row(ENR1, 2)[1] == t1, (row(ENR1, 2)[1], t1))
ok('a habit change does not clear approval', row(ENR1, 2)[1] is not None, row(ENR1, 2))
save(ENR1, 2, {'narrative_html': 'Cece has had a steady term. More.'})
ok('saving the same narrative keeps approval', row(ENR1, 2)[1] is not None, row(ENR1, 2))
save(ENR1, 2, {'narrative_html': 'Cece has had a steady term. Edited.'})
ok('an edited narrative clears approval', row(ENR1, 2)[1] is None, row(ENR1, 2))
save(ENR1, 2, {'narrative_html': 'Cece has had a steady term. Final.', 'approved': True})
ok('a narrative saved with approved true is approved', row(ENR1, 2)[1] is not None, row(ENR1, 2))
save(ENR1, 2, {'approved': False})
ok('approved false clears it', row(ENR1, 2)[1] is None, row(ENR1, 2))
ap = audit('approved_at')
ok('approval changes are audited: two sets, two clears', len(ap) == 4 and sum(v[1] is None for v in ap) == 2 and sum(v[0] is None for v in ap) == 2, ap)
sp(); expect_error('approved as a string is refused', lambda: save(ENR1, 2, {'approved': 'yes'}), '22023')
save(ENR2, 1, {'approved': True})
ok('approving a student with no row makes one, approved', row(ENR2, 1) is not None and row(ENR2, 1)[1] is not None, row(ENR2, 1))

# ── The old fields still save ──────────────────────────────────────────
save(ENR1, 2, {'work_habits_rating': 3, 'social_traits': ['kind']})
r = c.run('select work_habits_rating, social_traits from term_rating where enrollment_id = :e and term = 2', e=ENR1)[0]
ok('work_habits_rating and social_traits still save', r[0] == 3 and r[1] == ['kind'], r)

# ── get_class_bundle ───────────────────────────────────────────────────
save(ENR1, 2, {'habits': {'completes': 4, 'devices': 2}, 'approved': True})
br = bundle_row(ENR1, 2)
ok('the bundle returns habits', br and br.get('habits') == {'completes': 4, 'devices': 2}, br)
ok('the bundle returns approved_at', br and br.get('approved_at'), br)
ok('the bundle still returns the old fields', br and br.get('narrative_html') == 'Cece has had a steady term. Final.' and br.get('social_traits') == ['kind'], br)
br2 = bundle_row(ENR2, 1)
ok('a row with no habits reads {} in the bundle', br2 and br2.get('habits') == {}, br2)
save(ENR1, 2, {'approved': False})
ok('a cleared approval reads null in the bundle', bundle_row(ENR1, 2).get('approved_at') is None, bundle_row(ENR1, 2))

# ── Who can ────────────────────────────────────────────────────────────
as_teacher(B); sp()
expect_error("Teacher B cannot save habits on A's student", lambda: save(ENR1, 2, {'habits': {'completes': 1}}), 'row-level security')
sp()
expect_error("Teacher B cannot read A's bundle", lambda: c.run('select get_class_bundle(:c)', c=COURSE_A), 'P0002')
as_teacher(None); sp()
expect_error('no JWT cannot save', lambda: save(ENR1, 2, {'approved': True}), 'PT401')
c.run('reset role')
ok("Teacher B's attempt changed nothing", row(ENR1, 2)[0] == {'completes': 4, 'devices': 2}, row(ENR1, 2))

c.run('rollback')
for p in passed: print('ok  ', p)
for f in failed: print('FAIL', f)
print(f'{len(passed)} of {len(passed) + len(failed)} pass')
sys.exit(1 if failed else 0)
