"""What the card-code scripts share (card_codes.py, card_codes_undo.py). Not
a test itself.

- build(): loads an EMPTY database as gradebook-prod is since 2026-11-10
  17:12 UTC: the harness, S0-M4, Batch A's four files, S0-M5 and S0-M4b.
  That is the database 2026111003_card_codes_keyed.sql (S3-M1) meets.
- Db: one scenario's own copy of that database. The database named by
  PGDATABASE is only ever a template; every scenario runs on a copy
  (<PGDATABASE>_<scenario>, made and dropped here), so the scripts can be
  run again and again though they commit.
- The edge functions' part, done here in Python with a fixed FAKE key, so
  the database is given what the functions will give it and nothing more:
  a card's code drawn from the slip alphabet, its tag, its password's tag
  and the key's id, in the formats card-codes-contract.md fixes. The
  database never sees a code, a password or the key, and nothing in SQL
  could make a tag: that is the point of the migration.
"""
import hashlib, hmac as _hmac, json, os, re, secrets, subprocess, sys, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split
from catalog import catalog, differences, row_checksums, table_columns

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_DB = os.environ.get('PGDATABASE', 'fv')
MIGRATION = '2026111003_card_codes_keyed.sql'
UNDO = 's3-m1-undo.sql'
RECORD = 'card_codes_keyed'                      # as apply_migration will name it
# README.md, "Batch A" and "S0-M4b": the database as live is now.
BASE = ['harness.sql', 'score-prelude.sql', 'score-tables.sql', 'bundle-prelude.sql', 'bundle-tables.sql',
        '../2026111001_assessment_created_at_in_bundle.sql', 'student-submit-prelude.sql',
        '../20261025_questionnaires_tables_and_functions.sql', '../20261025_questionnaires_templates.sql',
        '../20261025_student_submit.sql', '../20261025_student_submit_phone.sql',
        '../20261025_student_submit_token_80.sql', '../20261025_phone_reports.sql',
        '../20261101_questionnaire_identity_check.sql', '../20261101_questionnaire_slip_fixes.sql',
        '../20261103_slip_password_kept_for_live_slips.sql', 'batch-a-tables.sql', 'batch-a-prelude.sql',
        'class-writers-prelude.sql', 'search-path-prelude.sql']
BATCH_A = ['../2026110901_score_rows_same_class.sql', '../2026110902_grade_return.sql', '../2026110903_student_card.sql',
           '../2026110904_student_sessions_page.sql']
LIVE = BASE + BATCH_A + ['../2026111002_security_definer_search_path.sql', '../2026110905_grade_return_limits.sql']

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
ENR_B = 'eeeeeeee-2222-0000-0000-000000000001'
STU1 = 'aaaaaaaa-1111-0000-0000-000000000001'; STU2 = 'aaaaaaaa-1111-0000-0000-000000000002'

passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:700]))
def finish():
    print('\n'.join('PASS ' + p for p in passed))
    print('\n'.join('FAIL ' + f for f in failed))
    print(f'{len(passed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)
nid = lambda: str(uuid.uuid4())

def connect(db=None):
    return pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                         database=db or BASE_DB, password=os.environ.get('PGPASSWORD'))
def admin(sql):
    c = connect('postgres'); c.run(sql); c.close()
def message(e):
    return str(e.args[0].get('M') if e.args and isinstance(e.args[0], dict) else e)
def sqlstate(e):
    return str(e.args[0].get('C') if e.args and isinstance(e.args[0], dict) else '')
def bare(st):
    """A statement without its comment lines."""
    return '\n'.join(l for l in st.splitlines() if not l.strip().startswith('--')).strip()
def text_of(rel):
    return open(os.path.join(HERE, rel)).read()
def plain(v): return str(v) if isinstance(v, uuid.UUID) else v

def build():
    c = connect(BASE_DB)
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run('select rolname from pg_roles')}
    for rel in LIVE:
        n = 0
        for st in split(text_of(rel)):
            words = st.split('\n')[-1].split()
            if rel == 'harness.sql' and words[:2] == ['create', 'role'] and words[2] in roles: continue   # roles belong to the whole server
            try: c.run(st)
            except Exception as e: sys.exit('FAILED in %s:\n%s\n-> %s' % (rel, st[:300], e))
            n += 1
        print('%s: %d statements' % (rel, n))
    c.close()

# ── The edge functions' part, with a fake key ───────────────────────────────
ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789'          # the slip alphabet (public._new_access_code)
FAKE_KEY = bytes.fromhex('00112233445566778899aabbccddeeff' * 2)   # never a real key: a test value
OTHER_KEY = bytes.fromhex('ffeeddccbbaa99887766554433221100' * 2)
def tidy(code): return re.sub(r'[^A-Za-z0-9]', '', code or '').upper()
def _tag(key, message): return _hmac.new(key, message.encode(), hashlib.sha256).hexdigest()
def code_tag(code, key=FAKE_KEY): return _tag(key, 'fv.card.code.v1\n' + tidy(code))
def pw_tag(code, digits, key=FAKE_KEY): return _tag(key, 'fv.card.pass.v1\n' + tidy(code) + '\n' + digits)
def key_id(key=FAKE_KEY): return _tag(key, 'fv.card.keyid.v1')[:8]
def draw_code(): return ''.join(secrets.choice(ALPHABET) for _ in range(8))
def draw_pw(): return '%04d' % secrets.randbelow(10000)
KEY_ID = key_id(); OTHER_KEY_ID = key_id(OTHER_KEY)

class Printed:
    """What teacher-cards would hold for one request: two drawn codes and passwords per student,
    and the items it sends to the database (tags only)."""
    def __init__(self, pairs, key=FAKE_KEY):
        self.drawn = {}; self.items = []
        for enrollment, replaces in pairs:
            cands = [(draw_code(), draw_pw()), (draw_code(), draw_pw())]
            self.drawn[enrollment] = cands
            self.items.append({'enrollment_id': enrollment, 'replaces': replaces,
                               'candidates': [{'code_hmac': code_tag(cd, key), 'pw_hmac': pw_tag(cd, pw, key)} for cd, pw in cands]})
    def json(self): return json.dumps(self.items)
    def codes(self, reply):
        """{enrollment: (code, password or None, result row)} for the cards the database says it made."""
        out = {}
        for r in reply['results']:
            if r['result'] == 'made':
                code, pw = self.drawn[r['enrollment_id']][r['candidate']]
                out[r['enrollment_id']] = (code, pw if r['has_password'] else None, r)
        return out

class Db:
    """One scenario's own copy of the template."""
    def __init__(self, tag, template=None):
        self.name = '%s_%s' % (BASE_DB, tag)
        admin('drop database if exists "%s" with (force)' % self.name)
        admin('create database "%s" template "%s"' % (self.name, template or BASE_DB))
        self.c = connect(self.name); self.rows = []; self.in_tx = False
    def other(self): return connect(self.name)
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def one(self, sql, **kw):
        r = self.c.run(sql, **kw); return plain(r[0][0]) if r else None
    def all(self, sql, **kw): return [[plain(v) for v in r] for r in self.c.run(sql, **kw)]
    def begin(self): self.c.run('begin'); self.in_tx = True
    def rollback(self): self.c.run('rollback'); self.in_tx = False
    def _as(self, role, uid, sql, kw):
        """Run one statement as a role (and, for a teacher, with their id as the API sets it), then be the owner again."""
        if self.in_tx: self.c.run('savepoint as_role')
        try:
            if uid is not None: self.c.run("select set_config('request.jwt.claim.sub', :u, false)", u=uid)
            self.c.run('set role ' + role)
            r = self.c.run(sql, **kw)
            self.c.run('reset role')
            if uid is not None: self.c.run("select set_config('request.jwt.claim.sub', '', false)")
            if self.in_tx: self.c.run('release savepoint as_role')
            return r
        except Exception:
            if self.in_tx: self.c.run('rollback to savepoint as_role')
            else:
                self.c.run('reset role'); self.c.run("select set_config('request.jwt.claim.sub', '', false)")
            raise
    def teacher(self, sql, uid=A, **kw):
        r = self._as('authenticated', uid or '', 'select ' + sql, kw); return plain(r[0][0]) if r else None
    def service(self, sql, **kw):
        """As the edge functions call it."""
        r = self._as('service_role', None, 'select ' + sql, kw); return r[0][0] if r else None
    def role(self, role, sql, uid=None, **kw): return self._as(role, uid, sql, kw)
    def statements(self, sts):
        """'ok', or 'STOPPED: <message>' with the open transaction rolled back. Keeps the rows of the last query,
        and which statement stopped it (self.at, from 0)."""
        self.rows = []; self.at = None
        try:
            for n, st in enumerate(sts):
                self.at = n
                r = self.c.run(st)
                if bare(st).lower().startswith(('select', 'with')): self.rows = [[plain(v) for v in x] for x in (r or [])]
            self.at = None
            return 'ok'
        except Exception as e:
            self.c.run('rollback'); return 'STOPPED: ' + message(e)
    def file(self, rel): return self.statements(split(text_of(rel)))
    def migrate(self): return self.file('../' + MIGRATION)
    def undo(self): return self.file(UNDO)
    def suite(self, script, *args):
        """Another script of this folder, on this copy: its last line."""
        r = subprocess.run([sys.executable, os.path.join(HERE, script)] + list(args), capture_output=True, text=True,
                           env=dict(os.environ, PGDATABASE=self.name), cwd=HERE)
        self.failures = [l[5:].split(' :: ')[0] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        return (r.stdout.strip().splitlines() or [r.stderr.strip()[-300:]])[-1]
    def close(self):
        try: self.c.close()
        except Exception: pass
        admin('drop database if exists "%s" with (force)' % self.name)
    # ── cards, as the two edge functions would ask ──
    def issue(self, pairs, course=COURSE_A, teacher=A, key=FAKE_KEY, idem=None, printed=None):
        """One request to teacher-cards: (the database's reply, the Printed that knows the codes)."""
        p = printed or Printed(pairs, key)
        reply = self.service('student_submit.issue_cards(:t, :c, :i::jsonb, :k, :d)', t=teacher, c=course, i=p.json(), k=key_id(key), d=idem)
        return reply, p
    def make(self, enrollment, course=COURSE_A, teacher=A, key=FAKE_KEY):
        """A new card for one student, replacing whatever card they have: (code, password or None, the result row)."""
        live = self.one('select id from student_card where enrollment_id = :e and stopped_at is null', e=enrollment)
        reply, p = self.issue([(enrollment, live)], course, teacher, key)
        return p.codes(reply)[enrollment]
    def card(self, code, ip='ip-1', key=FAKE_KEY):
        return self.service('student_submit.card(:h, :k, :i)', h=code_tag(code, key), k=key_id(key), i=ip)
    def verify(self, code, birthday=None, number=None, password=None, token=None, ip='ip-1', add=False, key=FAKE_KEY):
        return self.service('student_submit.verify_card(:h, :k, :b, :n, :p, :t, :i, :a)', h=code_tag(code, key), k=key_id(key), b=birthday, n=number,
                            p=None if password is None else pw_tag(code, password, key), t=token, i=ip, a=add)
    def page(self, token, e): return self.service("student_submit.page(:t, :e, 'ip-1')", t=token, e=e)
    def cards(self, course=COURSE_A): return {x['enrollment_id']: x for x in self.teacher('list_student_cards(:c)', c=course)}

class tx:
    """with tx(d): ... runs in a transaction that is rolled back."""
    def __init__(self, d): self.d = d
    def __enter__(self): self.d.begin(); return self.d
    def __exit__(self, *a): self.d.rollback(); return False

def refused(d, fn):
    """The error fn raises, as (message, SQLSTATE), or None if it raised none. Inside a transaction what fn did is undone."""
    if d.in_tx: d.run('savepoint refused')
    try:
        fn()
        if d.in_tx: d.run('release savepoint refused')
        return None
    except Exception as e:
        if d.in_tx: d.run('rollback to savepoint refused')
        return (message(e), sqlstate(e))

def fingerprints(d, names):
    """{signature: md5 of its definition, or None when it is not there}."""
    out = {}
    for n in names:
        r = d.run('select md5(pg_get_functiondef(to_regprocedure(:n))) where to_regprocedure(:n) is not null', n=n)
        out[n] = r[0][0] if r else None
    return out

if __name__ == '__main__':
    if sys.argv[1:] == ['build']: build()
