"""Exercise migrations/20261102_term_rating_reapprove_date.sql on the local
stand-in: when save_term_rating sets, keeps and clears approved_at. Earlier
approvals are backdated by hand, since now() is fixed inside the one
transaction (rolled back).

PGPORT=54331 PGDATABASE=fv_tq python3 run.py harness.sql term-rating-prelude.sql \
  ../20261028_term_rating_habits_approval.sql ../20261031_term_rating_reporting_basis.sql \
  ../20261031_term_rating_draft_meta.sql ../20261102_term_rating_reapprove_date.sql
PGPORT=54331 PGDATABASE=fv_tq python3 term_rating_reapprove.py
"""
import os, sys, json
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'
OLD = '2026-10-28 09:00:00+00'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:300]))

c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))
c.run('begin')
def as_teacher(uid):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run('set role authenticated')
def save(payload):
    c.run('select save_term_rating(:e, 1, cast(:p as jsonb))', e=ENR1, p=json.dumps(payload))
def approved():
    return c.run("select approved_at = now(), approved_at = cast(:o as timestamptz), approved_at is null "
                 "from term_rating where enrollment_id = :e and term = 1", e=ENR1, o=OLD)[0]
def backdate():
    c.run('reset role')
    c.run('update term_rating set approved_at = cast(:o as timestamptz) where enrollment_id = :e and term = 1', o=OLD, e=ENR1)
    as_teacher(A)

as_teacher(A)
save({'narrative_html': 'A steady term.', 'approved': True})
ok('first approval is dated now', approved()[0], approved())
backdate()
save({'narrative_html': 'A steady term.', 'approved': True})
ok('re-approve with the same narrative keeps the old date', approved()[1], approved())
save({'approved': True})
ok('re-approve with no narrative key keeps the old date', approved()[1], approved())
save({'habits': {'completes': 4}})
ok('an edit that leaves the narrative alone keeps the date', approved()[1], approved())
save({'narrative_html': 'A steady term. More.', 'approved': True})
ok('re-approve with a changed narrative is dated now', approved()[0], approved())
c.run('reset role')
a = c.run("select old_value, new_value from term_rating_audit where field_changed = 'approved_at' order by changed_at, id")
ok('the new date is audited', len(a) >= 2 and a[-1][1] is not None and a[-1][0] != a[-1][1], a)
as_teacher(A)
save({'approved': False})
ok('approved: false clears the date', approved()[2], approved())
save({'approved': True})
ok('approving after a clear is dated now', approved()[0], approved())
backdate()
save({'narrative_html': 'A steady term. Edited.'})
ok('an edit with no approved key clears the date', approved()[2], approved())

c.run('rollback')
for p in passed: print('ok  ', p)
for f in failed: print('FAIL', f)
print(f'{len(passed)} of {len(passed) + len(failed)} pass')
sys.exit(1 if failed else 0)
