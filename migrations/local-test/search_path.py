"""Exercise migrations/2026111002_security_definer_search_path.sql (S0-M5):
sixteen SECURITY DEFINER functions get pg_temp named last in their
search_path, and nothing else about them changes.

    python3 search_path.py build     load an EMPTY database in the order
                                     production will be in: the harness,
                                     Batch A's four files, S0-M4's file
    python3 search_path.py           the checks

`build` reads each file from this checkout, or, while PR 966 (Batch A) is
not merged, from its branch with `git show` (it prints which). The checks:

- the file's shape, and where the sixteen start;
- every caller gets what they got: Teacher A, Teacher B, no JWT and anon,
  the same calls before and after, answer for answer;
- the temporary-table trick, before and after, for each function;
- nothing else about a function changes (one row of pg_proc each, compared
  column by column), no other function, trigger or policy changes, and no
  row of any table changes;
- the apply path: each check that stops the file, the order it insists on,
  a lock it cannot get, a second run.

Every scenario runs on a connection of its own, in a transaction that is
rolled back, so each meets the functions as a new session would and the
database is left as `build` made it. Never point it at gradebook-prod.

PGPORT=54331 PGDATABASE=m5_pre python3 search_path.py build
PGPORT=54331 PGDATABASE=m5_pre python3 search_path.py
"""
import hashlib, json, os, re, subprocess, sys, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
MIGRATION = '../2026111002_security_definer_search_path.sql'
BATCH_A = ['../2026110901_score_rows_same_class.sql', '../2026110902_grade_return.sql',
           '../2026110903_student_card.sql', '../2026110904_student_sessions_page.sql']
S0_M4 = '../2026111001_assessment_created_at_in_bundle.sql'
# Until Batch A is merged, its files are read from here. (S0-M4's are on main.)
REFS = ['origin/batch-a-grade-return-cards-sessions']
# Batch A's list (README.md, "Batch A"), then what get_class_bundle needs
# (README.md, "The bundle sends created_at"), then the rest of the sixteen.
BUILD = ['harness.sql', 'score-prelude.sql', 'score-tables.sql', 'student-submit-prelude.sql',
         '../20261025_questionnaires_tables_and_functions.sql', '../20261025_questionnaires_templates.sql',
         '../20261025_student_submit.sql', '../20261025_student_submit_phone.sql',
         '../20261025_student_submit_token_80.sql', '../20261025_phone_reports.sql',
         '../20261101_questionnaire_identity_check.sql', '../20261101_questionnaire_slip_fixes.sql',
         '../20261103_slip_password_kept_for_live_slips.sql', 'batch-a-tables.sql', 'batch-a-prelude.sql',
         'class-writers-prelude.sql', 'bundle-prelude.sql', 'bundle-tables.sql', 'search-path-prelude.sql',
         *BATCH_A, S0_M4]
LIVE_BUNDLE_MD5 = '119165287207814181c5875d81451147'   # live-function-md5.txt, before S0-M4
LIVE_RLS_MD5 = '846ec2fbff751d24b890656d63c3a9bf'      # rls_auto_enable, read from gradebook-prod on 2026-11-10

def source(rel):
    """(text, where it came from) for a path relative to this folder."""
    path = os.path.normpath(os.path.join(HERE, rel))
    if os.path.exists(path):
        return open(path).read(), 'this checkout'
    in_repo = os.path.relpath(path, ROOT)
    for ref in REFS:
        got = subprocess.run(['git', '-C', ROOT, 'show', '%s:%s' % (ref, in_repo)], capture_output=True, text=True)
        if got.returncode == 0:
            return got.stdout, ref
    sys.exit('%s is not in this checkout or on %s' % (in_repo, ' or '.join(REFS)))

def connect():
    return pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                         port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                         password=os.environ.get('PGPASSWORD'))

def bare(statement):
    """A statement without the comment lines above it."""
    return '\n'.join(l for l in statement.splitlines() if not l.startswith('--')).strip()

def build(files=BUILD):
    c = connect()
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run("select rolname from pg_roles")}
    made = set()
    for rel in files:
        text, where = source(rel)
        ran = skipped = 0
        for st in split(text):
            words = st.split('\n')[-1].split()
            # Roles belong to the whole server: make only the ones it lacks.
            if rel == 'harness.sql' and words[:2] == ['create', 'role'] and words[2] in roles:
                skipped += 1; continue
            # bundle-tables.sql and batch-a-tables.sql are both written from
            # the live snapshot and share five tables: a statement that has
            # already run, word for word, is not run again.
            if rel == 'bundle-tables.sql' and bare(st) in made:
                skipped += 1; continue
            try:
                c.run(st)
            except Exception as e:
                sys.exit('FAILED in %s:\n%s\n-> %s' % (rel, st[:300], e))
            ran += 1
            if rel == 'batch-a-tables.sql': made.add(bare(st))
        print('%s: %d statements%s%s' % (rel, ran, ', %d skipped' % skipped if skipped else '',
                                         '' if where == 'this checkout' else '  (from %s)' % where))
        if rel == 'bundle-prelude.sql':
            got = c.run("select md5(pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure))")[0][0]
            if got != LIVE_BUNDLE_MD5:
                sys.exit('get_class_bundle is not the live function: md5 %s, live %s' % (got, LIVE_BUNDLE_MD5))
            print('  get_class_bundle is the live function, byte for byte (%s)' % got)
    c.close()

def wrong_order():
    """On an EMPTY database: this file's sixteen changes first, then Batch A,
    then S0-M4, to see what the wrong order does (the file's own check
    refuses it; here its ALTER statements are run by hand)."""
    build(BUILD[:BUILD.index(BATCH_A[0])])
    c = connect()
    for st in statements():
        if bare(st).lower().startswith('alter function'): c.run(st)
    print('the sixteen ALTER statements, run by hand before Batch A and S0-M4: ok')
    for rel in BATCH_A + [S0_M4]:
        try:
            for st in statements(rel, transaction=True): c.run(st)
            print('%s: applies' % rel)
        except pg.DatabaseError as e:
            c.run('rollback')
            print('%s: STOPS with nothing changed -> %s' % (rel, e.args[0].get('M')))
    c.close()

def alters_only():
    """For the smaller harness databases (score_rpcs.py's, the term rating
    ones), where the file's own checks rightly refuse to run: its ALTER
    statements alone, for the functions that database has."""
    c = connect(); ran = 0
    for st in statements():
        if not bare(st).lower().startswith('alter function'): continue
        name = bare(st).split()[2].split('(')[0]
        if c.run('select count(*) from pg_proc where oid = to_regproc(:n)', n=name)[0][0]:
            c.run(st); ran += 1
    print('%d of the sixteen are in this database; each now ends its search_path with pg_temp' % ran)
    c.close()

# ── The checks ──────────────────────────────────────────────────────────────
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
ORPHAN = '33333333-3333-3333-3333-333333333333'; GONE = '44444444-4444-4444-4444-444444444444'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
COURSE_A2 = 'aaaaaaaa-0000-0000-0000-000000000002'; COURSE_OLD = 'aaaaaaaa-0000-0000-0000-00000000000d'
STU1 = 'aaaaaaaa-1111-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
ENR_B = 'eeeeeeee-2222-0000-0000-000000000001'
def fixed(n): return 'cccccccc-0000-0000-0000-%012d' % n
(SUBJ, SECT, TAG1, TAG2, RUB, CR1, CR2, CK1, ASM_A, ASM_PTS, ASM_B, SCORE_A, SCORE_B, NOTE_A, TR_A, TR_B, OBS_A,
 CTAG, STU_OLD, ENR_OLD, KEY_A, KEY_B, KEY_NEW, SUBJ_B, SECT_B, GOAL_A, TMPL_A, COURSE_GONE, DECOY) = [fixed(n) for n in range(1, 30)]

# The sixteen: signature, search_path today, search_path after.
SIXTEEN = [
    ('public._fv_release_orphan_teacher_email()', 'public', 'public, pg_temp'),
    ('public._fv_teacher_sign_in_deleted()', 'public', 'public, pg_temp'),
    ('public._score_audit_diff(uuid,numeric,numeric,text,text)', 'public', 'public, pg_temp'),
    ('public._term_rating_audit_field(uuid,text,text,text)', 'public', 'public, pg_temp'),
    ('public._touch_course_sync_cursor(uuid,text)', 'public', 'public, pg_temp'),
    ('public._touch_course_sync_cursor_from_trigger()', 'public', 'public, pg_temp'),
    ('public._touch_teacher_sync_cursor_from_trigger()', 'public', 'public, pg_temp'),
    ('public.fv_idem_check(uuid,text)', 'public', 'public, pg_temp'),
    ('public.fv_idem_store(uuid,text,jsonb)', 'public', 'public, pg_temp'),
    ('public.fv_owns_assessment(uuid)', 'public', 'public, pg_temp'),
    ('public.fv_owns_course(uuid)', 'public', 'public, pg_temp'),
    ('public.fv_owns_enrollment(uuid)', 'public', 'public, pg_temp'),
    ('public.fv_owns_term_rating(uuid)', 'public', 'public, pg_temp'),
    ('public.fv_retention_cleanup()', 'public', 'public, pg_temp'),
    ('public.get_class_bundle(uuid,bigint)', '""', 'pg_catalog, pg_temp'),
    ('public.rls_auto_enable()', 'pg_catalog', 'pg_catalog, pg_temp'),
]
WITHOUT_PG_TEMP = """select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')
                      order by 1"""

passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:700]))

def last_line(st): return st.split('\n')[-1].strip().lower()
def statements(rel=MIGRATION, transaction=False):
    """A migration's statements; without its begin and commit unless asked."""
    sts = split(source(rel)[0])
    return sts if transaction else [s for s in sts if last_line(s) not in ('begin', 'commit')]
def header_query(name):
    """A query from the migration's header, between `-- name:` and `-- end name`."""
    body = source(MIGRATION)[0].split('-- %s:\n' % name)[1].split('-- end %s' % name)[0]
    return '\n'.join(l[2:] for l in body.splitlines()).strip().rstrip(';')

def plain(v):
    if isinstance(v, uuid.UUID): return str(v)
    if hasattr(v, 'isoformat'): return v.isoformat()
    if isinstance(v, (list, tuple)): return [plain(x) for x in v]
    return v
def code(result):
    """'ok', or the SQLSTATE a call failed with."""
    return result[1] if result and result[0] == 'error' else 'ok'
def value(result):
    """The one value a call returned, or 'error <sqlstate>'."""
    if result and result[0] == 'error': return 'error ' + str(result[1])
    return result[0][0] if result else None

class Session:
    """A new connection in a transaction that is rolled back: what a caller's
    own session sees. `applied` runs the migration first."""
    def __init__(self, applied=False, seeded=True):
        self.c = connect(); self.c.run('begin')
        if applied: self.apply()
        if seeded: seed(self)
    def apply(self, rel=MIGRATION):
        self.owner()
        for st in statements(rel): self.c.run(st)
    def owner(self):
        self.c.run('reset role')
    def become(self, who, email=None):
        """A or B: that teacher, signed in. None: the API role with no JWT. 'anon': not signed in."""
        self.c.run('reset role')
        self.c.run("select set_config('request.jwt.claim.sub', :u, true)", u=who if who not in (None, 'anon') else '')
        self.c.run("select set_config('request.jwt.claims', :j, true)", j=json.dumps({'email': email}) if email else '')
        self.c.run('set local role ' + ('anon' if who == 'anon' else 'authenticated'))
    def run(self, sql, **kw):
        """Rows, as whoever the session is now."""
        return [[plain(v) for v in r] for r in (self.c.run(sql, **kw) or [])]
    def rows(self, sql, **kw):
        self.owner(); return self.run(sql, **kw)
    def one(self, sql, **kw):
        r = self.rows(sql, **kw); return r[0][0] if r else None
    def attempt(self, who, sql, email=None, **kw):
        """What that caller gets: the rows, or ['error', sqlstate, message].
        who 'owner' is the database owner; 'as is' keeps the session's role."""
        self.c.run('savepoint attempt')
        try:
            if who == 'owner': self.owner()
            elif who != 'as is': self.become(who, email)
            r = self.run(sql, **kw)
            self.c.run('release savepoint attempt'); return r
        except pg.DatabaseError as e:
            self.c.run('rollback to savepoint attempt')
            return ['error', e.args[0].get('C'), e.args[0].get('M')]
        finally:
            if who != 'as is': self.owner()
    def close(self):
        self.c.run('rollback'); self.c.close()

def seed(s):
    """Two teachers with graded classes, a teacher row left behind by a
    deleted sign-in, a class and a teacher past the 30 days, and history old
    enough to purge."""
    s.owner(); c = s.c
    # As 20261108_teacher_outlives_sign_in.sql grants it (search-path-prelude.sql says why not there).
    c.run('grant execute on function public._fv_release_orphan_teacher_email() to authenticated')
    c.run("insert into auth.users (id, email) values (:a, 'a@example.com'), (:b, 'b@example.com')", a=A, b=B)
    c.run("""insert into teacher (id, email, display_name, deleted_at) values
             (:o, 'orphan@example.com', 'Left behind', null), (:g, 'gone@example.com', 'Gone', now() - interval '40 days')""", o=ORPHAN, g=GONE)
    c.run("""insert into course (id, teacher_id, name, deleted_at) values
             (:a2, :a, 'Science 9', null), (:old, :a, 'Old Class', now() - interval '31 days'), (:cg, :g, 'Gone Class', null)""",
          a2=COURSE_A2, old=COURSE_OLD, a=A, cg=COURSE_GONE, g=GONE)
    c.run("insert into student (id, teacher_id, first_name, last_name) values (:s, :a, 'Old', 'Student')", s=STU_OLD, a=A)
    c.run("insert into enrollment (id, student_id, course_id) values (:e, :s, :c)", e=ENR_OLD, s=STU_OLD, c=COURSE_OLD)
    c.run("insert into subject (id, course_id, name) values (:s, :c, 'Science'), (:sb, :cb, 'Socials')", s=SUBJ, c=COURSE_A, sb=SUBJ_B, cb=COURSE_B)
    c.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Questioning'), (:xb, :cb, :sb, 'Evidence')",
          x=SECT, c=COURSE_A, s=SUBJ, xb=SECT_B, cb=COURSE_B, sb=SUBJ_B)
    c.run("insert into tag (id, section_id, label, code) values (:t1, :x, 'Ask questions', 'Q1'), (:t2, :x, 'Plan a fair test', 'Q2')", t1=TAG1, t2=TAG2, x=SECT)
    c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report', 'advanced')", r=RUB, c=COURSE_A)
    c.run("insert into criterion (id, rubric_id, name, display_order) values (:c1, :r, 'Method', 0), (:c2, :r, 'Conclusion', 1)", c1=CR1, c2=CR2, r=RUB)
    c.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :c1, 3, 'Lists every step')", k=CK1, c1=CR1)
    c.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id, date_assigned) values
             (:a, :c, 'Lab Report', 'proficiency', null, :r, '2026-10-01'), (:p, :c, 'Quiz', 'points', 10, null, '2026-10-02'),
             (:b, :cb, 'Essay', 'points', 20, null, '2026-10-03')""", a=ASM_A, p=ASM_PTS, b=ASM_B, c=COURSE_A, cb=COURSE_B, r=RUB)
    c.run("insert into assessment_tag (assessment_id, tag_id) values (:a, :t1), (:a, :t2)", a=ASM_A, t1=TAG1, t2=TAG2)
    c.run("""insert into score (id, enrollment_id, assessment_id, value, comment) values
             (:sa, :e1, :p, 7, 'Good start'), (:sb, :eb, :b, 15, 'For B to read')""", sa=SCORE_A, e1=ENR1, p=ASM_PTS, sb=SCORE_B, eb=ENR_B, b=ASM_B)
    c.run("insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 3)", e=ENR1, a=ASM_A, t=TAG1)
    c.run("insert into rubric_score (enrollment_id, assessment_id, criterion_id, value, comment) values (:e, :a, :x, 3, 'Number the steps')", e=ENR2, a=ASM_A, x=CR1)
    c.run("insert into rubric_check_score (enrollment_id, assessment_id, check_id) values (:e, :a, :k)", e=ENR2, a=ASM_A, k=CK1)
    c.run("insert into note (id, enrollment_id, body) values (:n, :e, 'Family meeting on Friday')", n=NOTE_A, e=ENR1)
    c.run("insert into goal (id, enrollment_id, section_id, body) values (:g, :e, :x, 'Ask one question a day')", g=GOAL_A, e=ENR1, x=SECT)
    c.run("""insert into term_rating (id, enrollment_id, term, narrative_html) values
             (:a, :e1, 1, '<p>Cece asks sharp questions.</p>'), (:b, :eb, 1, '<p>Someone works steadily.</p>')""", a=TR_A, e1=ENR1, b=TR_B, eb=ENR_B)
    c.run("insert into term_rating_strength (term_rating_id, tag_id) values (:tr, :t)", tr=TR_A, t=TAG1)
    c.run("insert into observation (id, course_id, body, sentiment) values (:o, :c, 'Helped a partner', 'strength')", o=OBS_A, c=COURSE_A)
    c.run("insert into observation_student (observation_id, enrollment_id) values (:o, :e)", o=OBS_A, e=ENR1)
    c.run("insert into custom_tag (id, course_id, label) values (:t, :c, 'Lab')", t=CTAG, c=COURSE_A)
    c.run("insert into observation_template (id, teacher_id, body) values (:t, :a, 'Helped a partner')", t=TMPL_A, a=A)
    c.run("""insert into fv_idempotency (key, teacher_id, endpoint, result) values
             (:ka, :a, 'create_thing', '{"id": "made by A"}'), (:kb, :b, 'create_thing', '{"id": "made by B"}')""", ka=KEY_A, a=A, kb=KEY_B, b=B)
    c.run("insert into score_audit (score_id, changed_by, old_value, new_value, changed_at) values (:s, :a, 1, 2, now() - interval '3 years')", s=SCORE_A, a=A)
    c.run("""insert into term_rating_audit (term_rating_id, changed_by, field_changed, old_value, new_value, changed_at)
             values (:t, :a, 'narrative_html', 'x', 'y', now() - interval '3 years')""", t=TR_A, a=A)
    # Every class starts from a known version.
    c.run("insert into course_sync_cursor (course_id) select id from course on conflict (course_id) do nothing")
    c.run("update course_sync_cursor set version = 100, last_client = null")

CALLERS = [('Teacher A', A), ('Teacher B', B), ('no JWT', None), ('anon', 'anon')]

def versions(s):
    return {r[0]: r[1:] for r in s.rows("select course_id, version, last_client from public.course_sync_cursor where course_id in (:a, :a2, :b)",
                                        a=COURSE_A, a2=COURSE_A2, b=COURSE_B)}

def behaviour(s):
    """Every one of the sixteen, called or fired, by each kind of caller:
    {what: what came back}. Run before and after the migration in one
    transaction, each time from the same rows, so the two must be equal."""
    out = {}
    def fresh(fn):
        s.c.run('savepoint piece')
        try: return fn()
        finally: s.c.run('rollback to savepoint piece')
    for name, who in CALLERS:
        for fn, args in (('fv_owns_course', (COURSE_A, COURSE_B, COURSE_OLD)), ('fv_owns_enrollment', (ENR1, ENR_B, ENR_OLD)),
                         ('fv_owns_assessment', (ASM_A, ASM_B)), ('fv_owns_term_rating', (TR_A, TR_B))):
            for n, arg in enumerate(args):
                whose = ("A's", "B's", "a deleted class's")[n]
                out['%s: %s(%s)' % (name, fn, whose)] = value(s.attempt(who, 'select public.%s(:x)' % fn, x=arg))
        out[name + ": fv_idem_check, A's key"] = value(s.attempt(who, "select public.fv_idem_check(:k, 'create_thing')", k=KEY_A))
        out[name + ": fv_idem_check, B's key"] = value(s.attempt(who, "select public.fv_idem_check(:k, 'create_thing')", k=KEY_B))
        out[name + ': fv_idem_check, the same key for another endpoint'] = value(s.attempt(who, "select public.fv_idem_check(:k, 'other')", k=KEY_A))
        def store():
            r = code(s.attempt(who, """select public.fv_idem_store(:k, 'create_thing', '{"id": "new"}')""", k=KEY_NEW))
            return [r, s.rows("select teacher_id, endpoint, result from fv_idempotency where key = :k", k=KEY_NEW)]
        out[name + ': fv_idem_store, then the row'] = fresh(store)
        def audit(score):
            r = code(s.attempt(who, "select public._score_audit_diff(:s, 7, 9, null, 'LATE')", s=score))
            return [r, s.rows("""select score_id, changed_by, old_value, new_value, old_status, new_status from score_audit
                                  where changed_at > now() - interval '1 day' order by 1""")]
        out[name + ": _score_audit_diff on A's score, then the history"] = fresh(lambda: audit(SCORE_A))
        out[name + ": _score_audit_diff on B's score, then the history"] = fresh(lambda: audit(SCORE_B))
        def rating_audit(tr):
            r = code(s.attempt(who, "select public._term_rating_audit_field(:t, 'narrative_html', 'old', 'new')", t=tr))
            return [r, s.rows("""select term_rating_id, changed_by, field_changed, old_value, new_value from term_rating_audit
                                  where changed_at > now() - interval '1 day' order by 1""")]
        out[name + ": _term_rating_audit_field on A's rating, then the history"] = fresh(lambda: rating_audit(TR_A))
        out[name + ": _term_rating_audit_field on B's rating, then the history"] = fresh(lambda: rating_audit(TR_B))
        for label, course in (("A's class", COURSE_A), ("B's class", COURSE_B)):
            got = s.attempt(who, 'select public.get_class_bundle(:c, null)', c=course)
            out['%s: get_class_bundle, %s' % (name, label)] = got[0][0] if code(got) == 'ok' else got[:2]
        out[name + ': get_class_bundle, sending the version already held'] = value(s.attempt(who, 'select public.get_class_bundle(:c, 100)', c=COURSE_A))
        def release(email):
            r = code(s.attempt(who, 'select public._fv_release_orphan_teacher_email()', email=email))
            return [r, s.rows("select id, email, deleted_at is not null from teacher order by 1")]
        out[name + ': _fv_release_orphan_teacher_email with the email of the row left behind, then the teachers'] = fresh(lambda: release('Orphan@Example.com'))
        out[name + ': _fv_release_orphan_teacher_email with the email of a teacher who still has a sign-in'] = fresh(lambda: release('b@example.com'))
        # No caller may run these directly.
        out[name + ': _touch_course_sync_cursor called directly, then the versions'] = fresh(
            lambda: [code(s.attempt(who, "select public._touch_course_sync_cursor(:c, 'gradebook')", c=COURSE_A)), versions(s)])
        for fn in ('_touch_course_sync_cursor_from_trigger', '_touch_teacher_sync_cursor_from_trigger', '_fv_teacher_sign_in_deleted',
                   'fv_retention_cleanup', 'rls_auto_enable'):
            out['%s: %s called directly' % (name, fn)] = fresh(lambda: code(s.attempt(who, 'select public.%s()' % fn)))
    # The triggers, fired the way the app fires them.
    def save():
        s.become(A); s.c.run("""select set_config('request.headers', '{"x-fv-client": "tab-1"}', true)""")
        s.run('select public.upsert_score(:e, :a, 8)', e=ENR2, a=ASM_PTS)
        return [versions(s), s.rows("select value from score where enrollment_id = :e and assessment_id = :a", e=ENR2, a=ASM_PTS)]
    out["a save by Teacher A: the versions, and the score"] = fresh(save)
    def per_source():
        got = {}
        for label, sql in (('assessment_tag, found by its assessment', "delete from assessment_tag where assessment_id = '%s'" % ASM_A),
                           ('tag, by its section', "update tag set label = 'Ask good questions' where id = '%s'" % TAG1),
                           ('criterion, by its rubric', "update criterion set name = 'Steps' where id = '%s'" % CR1),
                           ('criterion_check, by its criterion', "update criterion_check set label = 'Every step' where id = '%s'" % CK1),
                           ('observation_student, by its observation', "delete from observation_student where observation_id = '%s'" % OBS_A),
                           ('term_rating_strength, by its term rating', "delete from term_rating_strength where term_rating_id = '%s'" % TR_A),
                           ('note, by its enrollment', "update note set body = 'Moved to Monday' where id = '%s'" % NOTE_A),
                           ('student, every class the student is in', "update student set first_name = 'Cecilia' where id = '%s'" % STU1),
                           ('course', "update course set name = 'Science Eight' where id = '%s'" % COURSE_A)):
            s.c.run('savepoint source'); s.become(A); s.run(sql); got[label] = versions(s); s.c.run('rollback to savepoint source')
        return got
    out["each table's change, as Teacher A: the versions after it"] = fresh(per_source)
    def starter():
        s.become(A); s.run("insert into observation_template (teacher_id, body) values (:a, 'Asked a question')", a=A)
        return versions(s)
    out['a new sentence starter, as Teacher A: the versions'] = fresh(starter)
    def restore():
        s.owner(); s.c.run("select set_config('fv.restoring', 'on', true)")
        s.run("update tag set label = 'During a restore' where id = :t", t=TAG1); return versions(s)
    out['a change while a restore is running: the versions'] = fresh(restore)
    def sign_in_deleted():
        s.owner(); s.run('delete from auth.users where id = :b', b=B)
        return s.rows("select id, deleted_at is not null from teacher order by 1")
    out['deleting the sign-in account of Teacher B: which teachers are soft-deleted'] = fresh(sign_in_deleted)
    def purge():
        s.owner(); report = s.run('select public.fv_retention_cleanup()')[0][0]; report.pop('ran_at', None)
        return [report, s.rows('select id from teacher order by 1'), s.rows('select id from course order by 1'),
                s.rows('select id from student order by 1'), s.one('select count(*) from score_audit'), s.one('select count(*) from term_rating_audit')]
    out['the purge, run by the owner: its report and what is left'] = fresh(purge)
    def new_tables():
        # What a later migration might run: each way of making a table.
        s.owner(); s.run('create table public.m5_probe (x int)'); s.run('create table student_submit.m5_probe (x int)')
        s.run('create table public.m5_probe_as as select 1 as x'); s.run('select 1 as x into public.m5_probe_into')
        s.run('create table public."m5 Probe, quoted" (x int)')
        s.run('create table public.m5_probe_parted (x int) partition by range (x)')
        s.run('create table public.m5_probe_part partition of public.m5_probe_parted for values from (0) to (10)')
        s.run('create temp table m5_probe_temp (x int)')
        s.become(A); s.run('create temp table m5_scratch (x int)')
        return s.rows("""select case when n.nspname like 'pg_temp%' then 'pg_temp' else n.nspname::text end, c.relname::text, c.relrowsecurity
                           from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where (c.relname like 'm5_probe%' or c.relname like 'm5 Probe%' or c.relname = 'm5_scratch') and c.relkind in ('r', 'p') order by 1, 2""")
    out['new tables, each way a migration can make one: which have row security'] = fresh(new_tables)
    return out

def catalog(s):
    """Everything the migration must leave alone, and the one thing it changes."""
    sixteen = {}
    for fn, _was, _becomes in SIXTEEN:
        sixteen[fn] = {'row': s.one("select to_jsonb(p) from pg_proc p where p.oid = to_regprocedure(:f)", f=fn),
                       'def': s.one("select pg_get_functiondef(to_regprocedure(:f))", f=fn)}
    oids = [r[0] for r in s.rows("select to_regprocedure(f)::oid from unnest(cast(:fns as text[])) f", fns=[f[0] for f in SIXTEEN])]
    others = s.rows("""select p.oid::text, to_jsonb(p)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname not in ('pg_catalog', 'information_schema') and p.oid <> all (cast(:skip as oid[])) order by 1""", skip=oids)
    triggers = s.rows("select t.oid::text, t.tgfoid::text, t.tgenabled::text, pg_get_triggerdef(t.oid) from pg_trigger t where not t.tgisinternal order by 1")
    event_triggers = s.rows("select evtname::text, evtevent::text, evtfoid::text, evtenabled::text, evttags::text from pg_event_trigger order by 1")
    policies = s.rows("""select polrelid::regclass::text, polname::text, polcmd::text, polroles::text, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
                          from pg_policy order by 1, 2""")
    tables = {}
    for schema, table in s.rows("""select n.nspname::text, c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                    where c.relkind = 'r' and n.nspname in ('public', 'student_submit', 'fv_private', 'auth') order by 1, 2"""):
        tables['%s.%s' % (schema, table)] = s.one("""select count(*) || ' rows ' || md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
                                                       from %s."%s" t""" % (schema, table))
    return {'sixteen': sixteen, 'others': others, 'triggers': triggers, 'event_triggers': event_triggers, 'policies': policies, 'tables': tables}

def settings(s):
    return {fn: s.one("select array_to_string(p.proconfig, '; ') from pg_proc p where p.oid = to_regprocedure(:f)", f=fn) for fn, _w, _b in SIXTEEN}

# ── The temporary-table trick ───────────────────────────────────────────────
# Each scenario is what one session with SQL of its own does, from its first
# statement: make temporary tables named like the real ones, then use the
# function. It returns what happened; the same scenario runs on a database
# without the migration and on one with it.
def shadow(s, table, extra=''):
    """A temporary table with a real table's name and columns, readable by
    every role (the function's owner has to be able to read it)."""
    s.run('create temp table %s (like public.%s including defaults%s)' % (table, table, extra))
    s.run('grant all on pg_temp.%s to public' % table)

def trick_owns_course(s):
    s.become(B); shadow(s, 'course')
    s.run("insert into pg_temp.course (id, teacher_id, name) values (:c, :b, 'Mine now')", c=COURSE_A, b=B)
    out = {'fv_owns_course says the class of Teacher A is B\'s': s.run('select public.fv_owns_course(:c)', c=COURSE_A)[0][0],
           'B reads the assessments of A': s.run('select title from public.assessment where course_id = :c order by 1', c=COURSE_A),
           'rows B changed': len(s.run("update public.assessment set title = 'Changed by B' where id = :a returning 1", a=ASM_A))}
    out['the title afterwards'] = s.one('select title from assessment where id = :a', a=ASM_A)
    return out

def trick_owns_enrollment(s):
    s.become(B); shadow(s, 'enrollment')
    s.run('insert into pg_temp.enrollment (id, student_id, course_id) values (:e, :s, :c)', e=ENR1, s=STU1, c=COURSE_B)
    out = {'fv_owns_enrollment says the student of Teacher A is B\'s': s.run('select public.fv_owns_enrollment(:e)', e=ENR1)[0][0],
           'B reads the note about the student': s.run('select body from public.note where enrollment_id = :e', e=ENR1),
           'B reads the report comment': s.run('select narrative_html from public.term_rating where enrollment_id = :e', e=ENR1),
           'B adds a note': code(s.attempt('as is', "insert into public.note (enrollment_id, body) values (:e, 'Written by B')", e=ENR1))}
    out['notes about the student afterwards'] = s.one('select count(*) from note where enrollment_id = :e', e=ENR1)
    return out

def trick_owns_assessment(s):
    s.become(B); shadow(s, 'assessment')
    s.run("insert into pg_temp.assessment (id, course_id, title) values (:a, :c, 'Mine now')", a=ASM_A, c=COURSE_B)
    out = {'fv_owns_assessment says the assessment of Teacher A is B\'s': s.run('select public.fv_owns_assessment(:a)', a=ASM_A)[0][0],
           'competency links B removed from it': len(s.run('delete from public.assessment_tag where assessment_id = :a returning 1', a=ASM_A))}
    out['its competency links afterwards'] = s.one('select count(*) from assessment_tag where assessment_id = :a', a=ASM_A)
    return out

def trick_owns_term_rating(s):
    s.become(B); shadow(s, 'term_rating')
    s.run('insert into pg_temp.term_rating (id, enrollment_id, term) values (:t, :e, 1)', t=TR_A, e=ENR_B)
    return {'fv_owns_term_rating says the report of Teacher A is B\'s': s.run('select public.fv_owns_term_rating(:t)', t=TR_A)[0][0],
            'B reads its strengths': len(s.run('select tag_id from public.term_rating_strength where term_rating_id = :t', t=TR_A)),
            'B reads its change history': len(s.run('select 1 from public.term_rating_audit where term_rating_id = :t', t=TR_A))}

def trick_score_audit(s):
    s.become(B); shadow(s, 'score')
    s.run('insert into pg_temp.score (id, enrollment_id, assessment_id) values (:s, :e, :a)', s=SCORE_A, e=ENR_B, a=ASM_B)
    s.run('select public._score_audit_diff(:s, 7, 1, null, null)', s=SCORE_A)
    return {'lines B wrote into the history of a score of A': s.one('select count(*) from score_audit where score_id = :s and changed_by = :b', s=SCORE_A, b=B)}

def trick_score_audit_divert(s):
    s.become(A); shadow(s, 'score_audit')
    s.run("select public._score_audit_diff(:s, 7, 9, null, 'LATE')", s=SCORE_A)
    return {'new lines in the real history': s.one("select count(*) from public.score_audit where changed_at > now() - interval '1 day'"),
            'lines in the temporary table': s.one('select count(*) from pg_temp.score_audit')}

def trick_rating_audit(s):
    s.become(B); shadow(s, 'term_rating')
    s.run('insert into pg_temp.term_rating (id, enrollment_id, term) values (:t, :e, 1)', t=TR_A, e=ENR_B)
    s.run("select public._term_rating_audit_field(:t, 'narrative_html', 'what A wrote', 'what B says A wrote')", t=TR_A)
    return {'lines B wrote into the history of a report of A': s.one('select count(*) from term_rating_audit where term_rating_id = :t and changed_by = :b', t=TR_A, b=B)}

def trick_rating_audit_divert(s):
    s.become(A); shadow(s, 'term_rating_audit')
    s.run("select public._term_rating_audit_field(:t, 'narrative_html', 'old', 'new')", t=TR_A)
    return {'new lines in the real history': s.one("select count(*) from public.term_rating_audit where changed_at > now() - interval '1 day'"),
            'lines in the temporary table': s.one('select count(*) from pg_temp.term_rating_audit')}

def trick_idempotency(s):
    s.become(B); shadow(s, 'fv_idempotency', ', primary key (key, teacher_id)')
    s.run("""insert into pg_temp.fv_idempotency (key, teacher_id, endpoint, result) values (:k, :b, 'create_thing', '{"id": "planted"}')""", k=KEY_NEW, b=B)
    out = {'fv_idem_check for a key the real table does not have': s.run("select public.fv_idem_check(:k, 'create_thing')", k=KEY_NEW)[0][0]}
    s.run("""select public.fv_idem_store(:k, 'create_thing', '{"id": "stored"}')""", k=DECOY)
    out['fv_idem_store: rows in the real table'] = s.one('select count(*) from public.fv_idempotency where key = :k', k=DECOY)
    out['fv_idem_store: rows in the temporary table'] = s.one('select count(*) from pg_temp.fv_idempotency where key = :k', k=DECOY)
    return out

def bundle_tables(s):
    """The tables get_class_bundle names, from its own body."""
    body = s.one("select prosrc from pg_proc where oid = 'public.get_class_bundle(uuid,bigint)'::regprocedure")
    names = sorted(set(re.findall(r'public\.(\w+)', body)))
    return [n for n in names if s.one('select to_regclass(:n) is not null', n='public.' + n)]

def trick_bundle_tables(s):
    tables = bundle_tables(s)
    s.owner()      # as the owner: row security does not get in the way of the tables
    for t in tables: shadow(s, t)
    s.run("insert into pg_temp.course (id, teacher_id, name) values (:c, :b, 'Mine now')", c=COURSE_A, b=B)
    shadowed = {who: s.attempt(uid, 'select public.get_class_bundle(:c, null)', c=COURSE_A) for who, uid in (('A', A), ('B', B))}
    s.owner()
    for t in tables: s.run('drop table pg_temp.%s' % t)
    plain_a = s.attempt(A, 'select public.get_class_bundle(:c, null)', c=COURSE_A)
    return {'tables it names, all shadowed': len(tables),
            'Teacher A gets the same class as with no temporary table': code(plain_a) == 'ok' and shadowed['A'] == plain_a,
            'Teacher B, whose temporary course says the class is theirs': code(shadowed['B'])}

# A temporary table also makes a TYPE of its name, and type names are looked
# up along the same list. (function, a type its body names, the caller, what
# the caller does, how to tell it worked.)
def after_release(s): return s.one("select deleted_at is not null from public.teacher where id = :o", o=ORPHAN)
def a_version(s): return s.one('select version from public.course_sync_cursor where course_id = :c', c=COURSE_A)
TYPE_TRICKS = [
    ('fv_idem_check', 'uuid', A, "select public.fv_idem_check('%s', 'create_thing')" % KEY_A, None, lambda s, r: value(r) == {'id': 'made by A'}),
    ('fv_idem_check', 'jsonb', A, "select public.fv_idem_check('%s', 'create_thing')" % KEY_A, None, lambda s, r: code(r) == 'ok'),
    ('fv_idem_check', 'text', A, "select public.fv_idem_check('%s', 'create_thing')" % KEY_A, None, lambda s, r: value(r) == {'id': 'made by A'}),
    ('fv_idem_store', 'uuid', A, """select public.fv_idem_store('%s', 'create_thing', '{"id": "new"}')""" % KEY_NEW, None,
     lambda s, r: s.one("select count(*) from public.fv_idempotency where key = '%s'" % KEY_NEW) == 1),
    ('_fv_release_orphan_teacher_email', 'uuid', A, 'select public._fv_release_orphan_teacher_email()', 'orphan@example.com', lambda s, r: after_release(s) is True),
    ('_fv_release_orphan_teacher_email', 'text', A, 'select public._fv_release_orphan_teacher_email()', 'orphan@example.com', lambda s, r: after_release(s) is True),
    ('_touch_course_sync_cursor', 'text', A, "update public.tag set label = 'Ask good questions' where id = '%s'" % TAG1, None, lambda s, r: a_version(s) == 101),
    ('_touch_course_sync_cursor_from_trigger', 'uuid', A, "update public.tag set label = 'Ask good questions' where id = '%s'" % TAG1, None, lambda s, r: a_version(s) == 101),
    ('_touch_course_sync_cursor_from_trigger', 'record', A, "update public.student set first_name = 'Cecilia' where id = '%s'" % STU1, None, lambda s, r: a_version(s) == 101),
    ('_touch_teacher_sync_cursor_from_trigger', 'record', A, "insert into public.observation_template (teacher_id, body) values ('%s', 'Asked a question')" % A, None,
     lambda s, r: a_version(s) == 101),
    ('fv_retention_cleanup', 'uuid', 'owner', 'select public.fv_retention_cleanup()', None,
     lambda s, r: code(r) == 'ok' and s.one("select count(*) from public.course where id = '%s'" % COURSE_OLD) == 0),
    ('get_class_bundle', 'jsonb', A, "select public.get_class_bundle('%s', null)" % COURSE_A, None, lambda s, r: code(r) == 'ok' and len(r[0][0]['gradebook']['assessments']) == 2),
    ('get_class_bundle', 'text', A, "select public.get_class_bundle('%s', null)" % COURSE_A, None, lambda s, r: code(r) == 'ok' and len(r[0][0]['gradebook']['assessments']) == 2),
]
def trick_type(s, fn, type_name, who, sql, email, worked):
    if type_name == 'record':
        # rls_auto_enable fires on every new table and would stop this one
        # being made (trick_rls): switched off, to look at this function alone.
        s.owner(); s.run('alter event trigger ensure_rls disable')
    # A session reads a function's declarations the first time it uses it,
    # and this session's seed has used the trigger functions. Writing each
    # function's row again (its cost, set to what it is) makes Postgres read
    # them afresh, as a session that starts with the temporary table would.
    s.owner()
    for f, _was, _becomes in SIXTEEN:
        s.run('alter function %s cost %s' % (f, s.one('select procost from pg_proc where oid = to_regprocedure(:f)', f=f)))
    if who == 'owner': s.owner()
    else: s.become(who, email)
    s.run("""select set_config('request.headers', '{"x-fv-client": "tab-1"}', true)""")   # as the app sends it
    made = s.attempt('as is', 'create temp table %s (x int)' % type_name)
    result = s.attempt('as is', sql)
    return {'made': code(made), 'call': code(result), 'worked': code(result) == 'ok' and bool(worked(s, result)),
            'message': result[2] if code(result) != 'ok' else ''}

def trick_cursor_tables(s):
    s.owner()      # as the owner: row security does not get in the way of the tables
    tables = ['course_sync_cursor', 'course', 'enrollment', 'assessment', 'section', 'rubric', 'criterion', 'observation', 'term_rating']
    for t in tables: shadow(s, t)
    s.run("update public.tag set label = 'Ask good questions' where id = :t", t=TAG1)
    s.run("insert into public.observation_template (teacher_id, body) values (:a, 'Asked a question')", a=A)
    return {'versions in the real table': versions(s), 'rows in the temporary course_sync_cursor': s.one('select count(*) from pg_temp.course_sync_cursor')}

def trick_purge(s):
    s.owner()
    for t in ('teacher', 'course', 'enrollment', 'student', 'score_audit', 'term_rating_audit'): shadow(s, t)
    s.run("insert into pg_temp.teacher (id, email, deleted_at) values (:d, 'decoy@example.com', now() - interval '40 days')", d=DECOY)
    report = s.run('select public.fv_retention_cleanup()')[0][0]; report.pop('ran_at', None)
    return {'report': report, 'the class 31 days deleted is still there': s.one('select count(*) from public.course where id = :c', c=COURSE_OLD) == 1,
            'rows left in the temporary teacher table': s.one('select count(*) from pg_temp.teacher'),
            'Teacher B may run it': code(s.attempt(B, 'select public.fv_retention_cleanup()'))}

def trick_sign_in_deleted(s):
    s.owner(); shadow(s, 'teacher')
    s.run("insert into pg_temp.teacher (id, email) values (:b, 'decoy@example.com')", b=B)
    s.run('delete from auth.users where id = :b', b=B)
    return {'the real teacher is soft-deleted': s.one('select deleted_at is not null from public.teacher where id = :b', b=B),
            'the temporary row is soft-deleted': s.one('select deleted_at is not null from pg_temp.teacher where id = :b', b=B)}

def trick_release(s):
    s.become(A, 'orphan@example.com'); shadow(s, 'teacher')
    s.run("insert into pg_temp.teacher (id, email) values (:d, 'orphan@example.com')", d=DECOY)
    s.run('select public._fv_release_orphan_teacher_email()')
    return {'the real row left behind is released': s.one('select deleted_at is not null from public.teacher where id = :o', o=ORPHAN),
            'the temporary row is released': s.one('select deleted_at is not null from pg_temp.teacher where id = :d', d=DECOY)}

def trick_rls(s, type_name='record', columns='x int'):
    """rls_auto_enable names two types, record and name, and one table,
    pg_catalog.pg_class, with its schema. It runs whenever the session makes
    a table, so the temporary table's own CREATE runs it too."""
    s.become(B)
    out = {'Teacher B makes the temporary table': code(s.attempt('as is', 'create temp table %s (%s)' % (type_name, columns)))}
    out['then Teacher B makes another temporary table'] = code(s.attempt('as is', 'create temp table m5_scratch (x int)'))
    out['then the owner, in that session, makes a table in public'] = code(s.attempt('owner', 'create table public.m5_probe (x int)'))
    out['and it has row security'] = s.one("select relrowsecurity from pg_class where oid = to_regclass('public.m5_probe')")
    return out
def trick_rls_name(s): return trick_rls(s, 'name', 'x text')
def trick_rls_pg_class(s):
    s.become(B); s.run('create temp table pg_class (like pg_catalog.pg_class)')
    out = {'the owner, in that session, makes a table in public': code(s.attempt('owner', 'create table public.m5_probe (x int)'))}
    out['and it has row security'] = s.one("select relrowsecurity from pg_catalog.pg_class where oid = to_regclass('public.m5_probe')")
    return out

def both(scenario, *args):
    """What a scenario gives without the migration, and with it."""
    got = []
    for applied in (False, True):
        s = Session(applied)
        try: got.append(scenario(s, *args))
        finally: s.close()
    return got

def trick(title, scenario, expected):
    """expected: {what was seen: (without the migration, with it)}."""
    before, after = both(scenario)
    for what, (was, now) in expected.items():
        ok('%s: %s: without the migration %s, with it %s' % (title, what, json.dumps(was), json.dumps(now)),
           before.get(what) == was and after.get(what) == now, (before.get(what), after.get(what)))

UNDO = 's0-m5-undo.sql'; S0_M4_UNDO = 's0-m4-undo.sql'

def refused(title, change, message, rel=MIGRATION, applied=False):
    """Make one thing differ from what a file expects, in a new session; the
    file must stop with `message`, having changed none of the sixteen."""
    s = Session(applied, seeded=False)
    try:
        s.owner()
        for st in change: s.run(st)
        before = settings(s)
        s.c.run('savepoint file')
        try:
            s.apply(rel); got = 'no error'
        except pg.DatabaseError as e:
            got = e.args[0].get('M'); s.c.run('rollback to savepoint file')
        ok('%s, saying so: %s' % ('stops' if rel == MIGRATION else 'the undo stops', title), message in got and 'Nothing was changed' in got, got)
        ok('... and none of the sixteen was changed', settings(s) == before)
    finally:
        s.close()

def main():
    md5 = lambda text: hashlib.md5(text.encode()).hexdigest()
    spaced = lambda text: text.replace(', ', ',').replace(',', ', ')

    # ── The file's shape ────────────────────────────────────────────────────
    sts = statements(transaction=True)
    kinds = ['do' if bare(st).lower().startswith('do $') else ' '.join(bare(st).lower().split()[:2]) for st in sts]
    ok('one transaction: begin first, commit last', kinds[0] == 'begin' and kinds[-1] == 'commit')
    ok('a five-second lock timeout, then its checks, before anything is changed',
       bare(sts[1]).lower() == "set local lock_timeout = '5s'" and kinds[2] == 'do' and '$guard$' in sts[2])
    ok('then sixteen ALTER FUNCTION statements, a last check, and nothing else',
       kinds[3:] == ['alter function'] * 16 + ['do', 'commit'], kinds)
    alters = [' '.join(bare(st).split()) for st in sts if bare(st).lower().startswith('alter function')]
    want = ['alter function %s set search_path = %s' % (fn, becomes) for fn, _was, becomes in SIXTEEN]
    ok('each ALTER sets one function\'s search_path, ending in pg_temp, and names all sixteen',
       sorted(spaced(a) for a in alters) == sorted(spaced(w) for w in want), alters)
    quiet = re.sub(r"\$s\$.*?\$s\$|'[^']*'", "''", re.sub(r'--[^\n]*', '', sts[2] + sts[19])).lower()
    ok('the two check blocks only read and raise: no create, alter, drop, grant, revoke, insert, update, delete or execute',
       not re.search(r'\b(create|alter|drop|grant|revoke|insert|update|delete|execute)\b', quiet), quiet[:300])

    # ── Where the sixteen start ─────────────────────────────────────────────
    s = Session(seeded=False)
    start = settings(s)
    for fn, was, _becomes in SIXTEEN:
        ok('%s is SECURITY DEFINER with search_path %s' % (fn, was),
           s.one('select prosecdef from pg_proc where oid = to_regprocedure(:f)', f=fn) is True and start[fn] == 'search_path=' + was, start[fn])
    lacking = [r[0] for r in s.rows(WITHOUT_PG_TEMP)]
    ok('they are the only SECURITY DEFINER functions in public, student_submit and fv_private without pg_temp last',
       len(lacking) == 16 and all(any(l.startswith(fn.split('(')[0] + '(') for l in lacking) for fn, _w, _b in SIXTEEN), lacking)
    live = {}
    for line in source('live-function-md5.txt')[0].splitlines():
        if line.strip() and not line.startswith('#') and len(line.split()) >= 3: live[line.split()[0]] = line.split()[1]
    for name in ('fv_owns_assessment', 'fv_owns_course', 'fv_owns_enrollment'):
        ok('%s is the live function, byte for byte (live-function-md5.txt)' % name,
           s.one("select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(:f)", f='public.%s(uuid)' % name) == live[name])
    bundle = s.one("select pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure)")
    ok('get_class_bundle is the live function with S0-M4\'s one key added, and nothing else',
       md5(bundle.replace(",\n                       'created_at', asm.created_at", '')) == live['get_class_bundle'])
    ok('rls_auto_enable is the live function, byte for byte (md5 %s, read from gradebook-prod on 2026-11-10)' % LIVE_RLS_MD5,
       s.one("select md5(pg_get_functiondef('public.rls_auto_enable()'::regprocedure))") == LIVE_RLS_MD5)
    ok('the header\'s "before the apply" query finds nothing: every one of the sixteen is as it was tested', s.rows(header_query('precheck')) == [],
       [r[:6] for r in s.rows(header_query('precheck'))])
    ok('the header\'s "after the apply" query lists all sixteen as not done yet', len(s.rows(header_query('postcheck'))) == 16)
    s.close()

    # ── Every caller gets what they got ─────────────────────────────────────
    # One session, one transaction: the calls, the migration, the calls again.
    s = Session()
    cat0 = catalog(s)
    s.c.run('savepoint calls'); before = behaviour(s); s.c.run('rollback to savepoint calls')
    ok('(the calls themselves leave nothing behind)', catalog(s) == cat0)
    s.apply()
    cat1 = catalog(s)
    s.c.run('savepoint calls'); after = behaviour(s); s.c.run('rollback to savepoint calls')
    # What "before" is, so that "the same" means something.
    b = before
    ok('before: each teacher owns their own class, student, assessment and report, and not the other\'s or a deleted class\'s',
       [b['Teacher A: fv_owns_course(%s)' % w] for w in ("A's", "B's", "a deleted class's")] == [True, False, False]
       and [b['Teacher B: fv_owns_enrollment(%s)' % w] for w in ("A's", "B's", "a deleted class's")] == [False, True, False]
       and [b['Teacher A: fv_owns_assessment(%s)' % w] for w in ("A's", "B's")] == [True, False]
       and [b['Teacher B: fv_owns_term_rating(%s)' % w] for w in ("A's", "B's")] == [False, True])
    ok('before: with no JWT every ownership answer is no; anon may not ask',
       all(v is False for k, v in b.items() if k.startswith('no JWT: fv_owns_'))
       and all(v == 'error 42501' for k, v in b.items() if k.startswith('anon: fv_owns_')))
    ok('before: a stored result is returned to the teacher who stored it and to no one else',
       b["Teacher A: fv_idem_check, A's key"] == {'id': 'made by A'} and b["Teacher B: fv_idem_check, A's key"] is None
       and b["no JWT: fv_idem_check, A's key"] is None and b['Teacher A: fv_idem_store, then the row'] == ['ok', [[A, 'create_thing', {'id': 'new'}]]]
       and b['no JWT: fv_idem_store, then the row'] == ['ok', []])
    ok('before: the audit writers add a line for the caller\'s own score and report only',
       len(b["Teacher A: _score_audit_diff on A's score, then the history"][1]) == 1 and b["Teacher B: _score_audit_diff on A's score, then the history"] == ['ok', []]
       and len(b["Teacher B: _term_rating_audit_field on B's rating, then the history"][1]) == 1
       and b["Teacher A: _term_rating_audit_field on B's rating, then the history"] == ['ok', []])
    mine = b["Teacher A: get_class_bundle, A's class"]
    ok('before: Teacher A loads the class (2 assessments with created_at, 2 students, a rubric, a term rating); B is told it is not found, no JWT 401, anon refused',
       isinstance(mine, dict) and len(mine['gradebook']['assessments']) == 2 and all(a.get('created_at') for a in mine['gradebook']['assessments'])
       and len(mine['rubrics']['rubrics']) == 1 and len(mine['profiles']) == 2 and len(mine['term_ratings']) >= 1
       and b["Teacher B: get_class_bundle, A's class"] == ['error', 'P0002'] and b["no JWT: get_class_bundle, A's class"] == ['error', 'PT401']
       and b["anon: get_class_bundle, A's class"] == ['error', '42501'], str(mine)[:300])
    ok('before: sending the version already held gets not_modified',
       b['Teacher A: get_class_bundle, sending the version already held'] == {'version': 100, 'not_modified': True})
    left = b['Teacher A: _fv_release_orphan_teacher_email with the email of the row left behind, then the teachers']
    ok('before: the row a deleted sign-in left behind is released for the caller with its email; a teacher with a sign-in is never touched',
       [r for r in left[1] if r[0] == ORPHAN][0][2] is True and '(sign-in removed' in [r for r in left[1] if r[0] == ORPHAN][0][1]
       and [r[2] for r in b['Teacher A: _fv_release_orphan_teacher_email with the email of a teacher who still has a sign-in'][1] if r[0] == B] == [False])
    ok('before: no caller may run the cursor functions, the sign-in trigger, the purge or rls_auto_enable directly',
       all((v[0] if isinstance(v, list) else v) == '42501' for k, v in b.items() if 'called directly' in k))
    saved = b['a save by Teacher A: the versions, and the score']
    ok('before: a save moves its own class\'s version, records the tab, and moves no other class',
       saved[0][COURSE_A] == [101, 'tab-1'] and saved[0][COURSE_A2] == [100, None] and saved[0][COURSE_B] == [100, None])
    ok('before: every table\'s change finds its class (nine lookups), and no other class moves',
       all(v[COURSE_A][0] > 100 and v[COURSE_B][0] == 100 for v in b["each table's change, as Teacher A: the versions after it"].values())
       and len(b["each table's change, as Teacher A: the versions after it"]) == 9)
    ok('before: a sentence starter moves every class of its teacher; a restore moves none',
       b['a new sentence starter, as Teacher A: the versions'] == {COURSE_A: [101, None], COURSE_A2: [101, None], COURSE_B: [100, None]}
       and all(v == [100, None] for v in b['a change while a restore is running: the versions'].values()))
    ok('before: deleting a sign-in account soft-deletes that teacher only',
       b['deleting the sign-in account of Teacher B: which teachers are soft-deleted'] == [[A, False], [B, True], [ORPHAN, False], [GONE, True]])
    purged = b['the purge, run by the owner: its report and what is left']
    ok('before: the purge removes the teacher and the class past 30 days, the student left with no class, and history past 2 years',
       purged[0] == {'teachers_purged': 1, 'courses_purged': 1, 'students_purged': 1, 'score_audit_purged': 1, 'term_rating_audit_purged': 1}
       and [GONE] not in purged[1] and [COURSE_OLD] not in purged[2] and [STU_OLD] not in purged[3], purged)
    made = {(r[0], r[1]): r[2] for r in b['new tables, each way a migration can make one: which have row security']}
    ok('before: every new table in public gets row security (CREATE TABLE, CREATE TABLE AS, SELECT INTO, a quoted name, a partitioned table and its partition); one in student_submit and temporary ones do not',
       made == {('public', 'm5_probe'): True, ('public', 'm5_probe_as'): True, ('public', 'm5_probe_into'): True, ('public', 'm5 Probe, quoted'): True,
                ('public', 'm5_probe_parted'): True, ('public', 'm5_probe_part'): True, ('student_submit', 'm5_probe'): False,
                ('pg_temp', 'm5_probe_temp'): False, ('pg_temp', 'm5_scratch'): False}, made)
    for what in before:
        ok('the same before and after: ' + what, before[what] == after.get(what), (before[what], after.get(what)))

    # ── Nothing else about a function changes ───────────────────────────────
    fingerprints = []
    for fn, was, becomes in SIXTEEN:
        old, new = cat0['sixteen'][fn], cat1['sixteen'][fn]
        differ = sorted(k for k in old['row'] if old['row'][k] != new['row'].get(k))
        named = ('prosrc', 'proowner', 'proacl', 'provolatile', 'prosecdef', 'proparallel', 'proargtypes', 'prorettype',
                 'proargnames', 'proargdefaults', 'prolang', 'proleakproof', 'proisstrict', 'proretset', 'prokind', 'pronamespace')
        ok('%s: of its row in pg_proc only proconfig differs (body, owner, grants, volatility, security, parallel, arguments, result: the same)' % fn,
           differ == ['proconfig'] and all(old['row'][k] == new['row'][k] for k in named) and old['row']['oid'] == new['row']['oid'], differ)
        ok('%s: search_path is now %s' % (fn, becomes), new['row']['proconfig'] == ['search_path=' + becomes], new['row']['proconfig'])
        a, z = old['def'].splitlines(), new['def'].splitlines()
        changed = [(x, y) for x, y in zip(a, z) if x != y]
        ok('%s: its printed definition differs in the SET search_path line alone' % fn,
           len(a) == len(z) and len(changed) == 1 and changed[0][0].startswith(' SET search_path TO ')
           and changed[0][1] == " SET search_path TO %s" % ', '.join("'%s'" % p for p in becomes.split(', ')), changed)
        fingerprints.append((fn, md5(old['def']), len(old['def']), md5(new['def']), len(new['def'])))
    ok('no other function changes (every other row of pg_proc outside the system schemas, column for column)', cat0['others'] == cat1['others'])
    ok('no trigger changes, and each still calls the function it called', cat0['triggers'] == cat1['triggers'] and len(cat0['triggers']) > 40, len(cat0['triggers']))
    ok('the event trigger still calls rls_auto_enable', cat0['event_triggers'] == cat1['event_triggers'] and len(cat0['event_triggers']) == 1)
    ok('no policy changes', cat0['policies'] == cat1['policies'] and len(cat0['policies']) > 40, len(cat0['policies']))
    ok('no row of any table changes (every table in public, student_submit, fv_private and auth, row for row)',
       cat0['tables'] == cat1['tables'] and len(cat0['tables']) > 50, len(cat0['tables']))
    ok('no SECURITY DEFINER function in public, student_submit or fv_private is left without pg_temp last', s.rows(WITHOUT_PG_TEMP) == [], s.rows(WITHOUT_PG_TEMP))
    ok('the header\'s "after the apply" query finds nothing: all sixteen have the setting and fingerprint it lists',
       s.rows(header_query('postcheck')) == [], s.rows(header_query('postcheck')))
    ok('the header\'s "before the apply" query now lists all sixteen as changed', len(s.rows(header_query('precheck'))) == 16)
    s.apply()
    ok('a second run changes nothing', catalog(s) == cat1)

    # ── Taking it back out: s0-m5-undo.sql, in the same session ─────────────
    undo = statements(UNDO, transaction=True)
    ok('the undo script: one transaction, a five-second lock timeout, its checks before anything is changed',
       last_line(undo[0]) == 'begin' and last_line(undo[-1]) == 'commit' and bare(undo[1]).lower() == "set local lock_timeout = '5s'"
       and '$guard$' in undo[2] and len([u for u in undo if bare(u).lower().startswith('alter function')]) == 16)
    def m4_undo():
        s.c.run('savepoint m4')
        try:
            s.apply(S0_M4_UNDO)
            return s.one("select md5(pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure))")
        except pg.DatabaseError as e:
            return e.args[0].get('M')
        finally:
            s.c.run('rollback to savepoint m4')
    ok('with S0-M5 applied, the undo script of S0-M4 stops with nothing changed (so S0-M5 is undone first)',
       m4_undo() == 'public.get_class_bundle(uuid,bigint) is neither the patched nor the original definition. Nothing was changed.', m4_undo())
    s.apply(UNDO)
    back = catalog(s)
    differ = [fn for fn in cat0['sixteen'] if back['sixteen'][fn] != cat0['sixteen'][fn]]
    ok('the undo puts all sixteen rows of pg_proc back as they were, column for column, and so all sixteen fingerprints', not differ, differ)
    ok('... and changes no other function, trigger, policy or row', back == cat0)
    ok('the header\'s "before the apply" query finds nothing again', s.rows(header_query('precheck')) == [])
    s.apply(UNDO)
    ok('a second run of the undo changes nothing', catalog(s) == cat0)
    ok('after it, the undo script of S0-M4 runs, and get_class_bundle is the live function again', m4_undo() == live['get_class_bundle'], m4_undo())
    s.apply()
    ok('S0-M5 applies again after its undo, to the same result', catalog(s) == cat1)
    s.close()
    s = Session(seeded=False)
    first = catalog(s); s.apply(UNDO)
    ok('the undo, run where S0-M5 was never applied, changes nothing', catalog(s) == first)
    s.close()
    s = Session(applied=True); s.apply(UNDO)
    ok('the undo reopens it: Teacher B with a temporary course is told the class of Teacher A is theirs again',
       trick_owns_course(s)["fv_owns_course says the class of Teacher A is B's"] is True)
    s.close()
    refused('a function is missing', ['drop function public.fv_retention_cleanup()'], 'public.fv_retention_cleanup() does not exist with these arguments', UNDO, True)
    refused('a function is not SECURITY DEFINER', ['alter function public.fv_idem_check(uuid, text) security invoker'],
            'public.fv_idem_check(uuid,text) is not SECURITY DEFINER', UNDO, True)
    refused('a function has a third search_path', ['alter function public.rls_auto_enable() set search_path = pg_catalog, public, pg_temp'],
            'public.rls_auto_enable() has the settings', UNDO, True)
    refused('a function whose fingerprint is on file has another body',
            ["""create or replace function public.fv_owns_course(cid uuid) returns boolean language sql stable security definer
                set search_path to 'public', 'pg_temp' as 'select false'"""],
            'public.fv_owns_course(uuid) is neither the S0-M5 definition nor the one before it', UNDO, True)

    # ── The temporary-table trick, without the migration and with it ────────
    trick('fv_owns_course, Teacher B with a temporary table called course', trick_owns_course, {
        "fv_owns_course says the class of Teacher A is B's": (True, False),
        'B reads the assessments of A': ([['Lab Report'], ['Quiz']], []),
        'rows B changed': (1, 0), 'the title afterwards': ('Changed by B', 'Lab Report')})
    trick('fv_owns_enrollment, Teacher B with a temporary enrollment', trick_owns_enrollment, {
        "fv_owns_enrollment says the student of Teacher A is B's": (True, False),
        'B reads the note about the student': ([['Family meeting on Friday']], []),
        'B reads the report comment': ([['<p>Cece asks sharp questions.</p>']], []),
        'B adds a note': ('ok', '42501'), 'notes about the student afterwards': (2, 1)})
    trick('fv_owns_assessment, Teacher B with a temporary assessment', trick_owns_assessment, {
        "fv_owns_assessment says the assessment of Teacher A is B's": (True, False),
        'competency links B removed from it': (2, 0), 'its competency links afterwards': (0, 2)})
    trick('fv_owns_term_rating, Teacher B with a temporary term_rating', trick_owns_term_rating, {
        "fv_owns_term_rating says the report of Teacher A is B's": (True, False),
        'B reads its strengths': (1, 0), 'B reads its change history': (1, 0)})
    trick('_score_audit_diff, Teacher B with a temporary score', trick_score_audit, {'lines B wrote into the history of a score of A': (1, 0)})
    trick('_score_audit_diff, a temporary score_audit', trick_score_audit_divert, {
        'new lines in the real history': (0, 1), 'lines in the temporary table': (1, 0)})
    trick('_term_rating_audit_field, Teacher B with a temporary term_rating', trick_rating_audit, {'lines B wrote into the history of a report of A': (1, 0)})
    trick('_term_rating_audit_field, a temporary term_rating_audit', trick_rating_audit_divert, {
        'new lines in the real history': (0, 1), 'lines in the temporary table': (1, 0)})
    trick('fv_idem_check and fv_idem_store, Teacher B with a temporary fv_idempotency', trick_idempotency, {
        'fv_idem_check for a key the real table does not have': ({'id': 'planted'}, None),
        'fv_idem_store: rows in the real table': (0, 1), 'fv_idem_store: rows in the temporary table': (1, 0)})
    trick('fv_retention_cleanup, the owner\'s session with temporary teacher, course, enrollment, student and audit tables', trick_purge, {
        'report': ({'teachers_purged': 1, 'courses_purged': 0, 'students_purged': 0, 'score_audit_purged': 0, 'term_rating_audit_purged': 0},
                   {'teachers_purged': 1, 'courses_purged': 1, 'students_purged': 1, 'score_audit_purged': 1, 'term_rating_audit_purged': 1}),
        'the class 31 days deleted is still there': (True, False), 'rows left in the temporary teacher table': (0, 1),
        'Teacher B may run it': ('42501', '42501')})
    trick('_fv_teacher_sign_in_deleted, a session with a temporary teacher', trick_sign_in_deleted, {
        'the real teacher is soft-deleted': (False, True), 'the temporary row is soft-deleted': (True, False)})
    trick('_fv_release_orphan_teacher_email, a caller with a temporary teacher', trick_release, {
        'the real row left behind is released': (False, True), 'the temporary row is released': (True, False)})
    # These three name every table with its schema: a temporary table never
    # stood in for one. It is the type names that were open (below).
    trick('get_class_bundle, every table it names shadowed', trick_bundle_tables, {
        'tables it names, all shadowed': (38, 38), 'Teacher A gets the same class as with no temporary table': (True, True),
        'Teacher B, whose temporary course says the class is theirs': ('P0002', 'P0002')})
    trick('the cursor functions, every table they name shadowed', trick_cursor_tables, {
        'versions in the real table': ({COURSE_A: [102, None], COURSE_A2: [101, None], COURSE_B: [100, None]},) * 2,
        'rows in the temporary course_sync_cursor': (0, 0)})
    # rls_auto_enable runs on every CREATE TABLE in the session, the temporary
    # table's own included. `record`: every later CREATE TABLE in the session
    # failed. `name`: the session's new table in public was left WITHOUT row
    # security, and the function logged that it had enabled it.
    trick('rls_auto_enable, a session with a temporary table called record', trick_rls, {
        'Teacher B makes the temporary table': ('42703', 'ok'), 'then Teacher B makes another temporary table': ('42809', 'ok'),
        'then the owner, in that session, makes a table in public': ('42809', 'ok'), 'and it has row security': (None, True)})
    trick('rls_auto_enable, a session with a temporary table called name', trick_rls_name, {
        'Teacher B makes the temporary table': ('ok', 'ok'), 'then Teacher B makes another temporary table': ('ok', 'ok'),
        'then the owner, in that session, makes a table in public': ('ok', 'ok'), 'and it has row security': (False, True)})
    trick('rls_auto_enable, a session with a temporary pg_class (it names pg_catalog.pg_class with its schema)', trick_rls_pg_class, {
        'the owner, in that session, makes a table in public': ('ok', 'ok'), 'and it has row security': (True, True)})
    for t in TYPE_TRICKS:
        before, after = both(trick_type, *t)
        ok('%s, a temporary table called %s: without the migration the call fails, with it it works as if the table were not there' % (t[0], t[1]),
           before['made'] == 'ok' and before['call'] != 'ok' and after == {'made': 'ok', 'call': 'ok', 'worked': True, 'message': ''}, (before, after))

    # ── The apply path ──────────────────────────────────────────────────────
    # rls_auto_enable is an event trigger's function. The harness's trigger
    # fires on the three ways of making a table; the live one's filter was
    # not read, so here it fires on every command, this file's own ALTERs
    # included.
    s = Session(seeded=False)
    s.run('drop event trigger ensure_rls')
    s.run('create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable()')
    got = 'applied'
    try: s.apply()
    except pg.DatabaseError as e: got = e.args[0].get('M')
    ok('with ensure_rls firing on every command, this file\'s ALTERs included, the file applies', got == 'applied' and s.rows(WITHOUT_PG_TEMP) == [], got)
    made = code(s.attempt('owner', 'create table public.m5_probe (x int)'))
    ok('... and a table made in public afterwards, in the same transaction, gets row security',
       made == 'ok' and s.one("select relrowsecurity from pg_class where oid = to_regclass('public.m5_probe')") is True, made)
    s.close()
    refused('a function is missing', ['drop function public.fv_retention_cleanup()'], 'public.fv_retention_cleanup() does not exist with these arguments')
    refused('a function has other arguments',
            ['drop function public.fv_idem_store(uuid, text, jsonb)',
             "create function public.fv_idem_store(p_key uuid, p_endpoint text, p_result json) returns void language sql security definer set search_path = public as 'select'"],
            'public.fv_idem_store(uuid,text,jsonb) does not exist with these arguments')
    refused('a function is not SECURITY DEFINER', ['alter function public.fv_owns_course(uuid) security invoker'], 'public.fv_owns_course(uuid) is not SECURITY DEFINER')
    refused('a function has another search_path',
            ['alter function public._score_audit_diff(uuid, numeric, numeric, text, text) set search_path = public, auth'],
            'public._score_audit_diff(uuid,numeric,numeric,text,text) has the settings')
    refused('a function has a second setting', ["alter function public.fv_owns_enrollment(uuid) set statement_timeout = '5s'"],
            'public.fv_owns_enrollment(uuid) has the settings')
    refused('Batch A file 01 is not applied', ['alter function public.fv_owns_score_cell(uuid, uuid) rename to m5_renamed'], 'Batch A is not all applied')
    refused('Batch A file 02 is not applied', ['alter table public.grade_return rename to m5_renamed'], 'Batch A is not all applied')
    refused('Batch A file 03 is not applied', ['alter table public.student_card rename to m5_renamed'], 'Batch A is not all applied')
    refused('Batch A file 04 is not applied', ['alter table student_submit.device_session rename to m5_renamed'], 'Batch A is not all applied')
    without_m4 = bundle.replace(",\n                       'created_at', asm.created_at", '')
    refused('S0-M4 is not applied (get_class_bundle as it is live today)', [without_m4], 'S0-M4 is not applied')
    refused('get_class_bundle is neither the definition S0-M4 leaves nor that with this setting',
            [bundle.replace('\ndeclare\n', '\ndeclare\n    -- another change\n', 1)],
            'public.get_class_bundle(uuid,bigint) is not the definition this file was written against')
    for where, make in (('public', "create function public.m5_seventeenth() returns int language sql security definer set search_path = public as 'select 1'"),
                        ('student_submit', "create function student_submit.m5_seventeenth() returns int language sql security definer as 'select 1'"),
                        ('fv_private', "create function fv_private.m5_seventeenth() returns int language sql security definer set search_path = pg_temp, public as 'select 1'")):
        refused('another SECURITY DEFINER function in %s lacks pg_temp last (the last check, after the sixteen ALTERs)' % where, [make],
                'SECURITY DEFINER without pg_temp last in its search_path: %s.m5_seventeenth()' % where)

    # What the wrong order would do: this file's change to get_class_bundle,
    # made by hand before S0-M4, stops S0-M4 at its first check.
    s = Session(seeded=False)
    s.run(without_m4)
    ok('(get_class_bundle put back to the live definition: md5 %s)' % live['get_class_bundle'],
       s.one("select md5(pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure))") == live['get_class_bundle'])
    s.run('alter function public.get_class_bundle(uuid, bigint) set search_path = pg_catalog, pg_temp')
    try:
        s.apply(S0_M4); got = 'no error'
    except pg.DatabaseError as e:
        got = e.args[0].get('M')
    ok('the wrong order: with this change made first, S0-M4 stops at its fingerprint check with nothing changed',
       'public.get_class_bundle(uuid,bigint) is not the definition this migration was written against' in got and 'Nothing was changed' in got, got)
    s.close()

    # The file as it will be run, begin and commit included, on a second
    # connection while another holds an uncommitted change to one function.
    holder = connect(); holder.run('begin'); holder.run('alter function public.fv_owns_term_rating(uuid) cost 99')
    applier = connect(); t0 = time.time(); got = None
    try:
        for st in sts: applier.run(st)
    except pg.DatabaseError as e:
        got = e.args[0].get('C')
    waited = time.time() - t0
    applier.run('rollback'); applier.close()
    s = Session(seeded=False); now = settings(s); s.close()
    holder.run('rollback'); holder.close()
    ok('a lock it cannot get: it gives up after five seconds (55P03, lock_not_available)', got == '55P03' and 4.5 < waited < 9, (got, round(waited, 2)))
    ok('... and none of the sixteen was changed', now == start, now)

    # It needs no table: with the busiest ones locked whole by another
    # session, it still runs straight through.
    holder = connect(); holder.run('begin')
    holder.run('lock table public.course, public.enrollment, public.assessment, public.score, public.course_sync_cursor, public.fv_idempotency in access exclusive mode')
    t0 = time.time(); got = 'applied'
    try:
        s = Session(applied=True, seeded=False); s.close()
    except pg.DatabaseError as e:
        got = e.args[0].get('M')
    waited = time.time() - t0
    holder.run('rollback'); holder.close()
    ok('it takes no lock on any table: with course, enrollment, assessment, score, course_sync_cursor and fv_idempotency locked whole by another session, it runs at once',
       got == 'applied' and waited < 2, (got, round(waited, 2)))

    # The same, stopped by its last check, with its own commit sent after the
    # error (a commit on a failed transaction is a rollback).
    c = connect(); c.run('begin')
    c.run("create function public.m5_seventeenth() returns int language sql security definer set search_path = public as 'select 1'")
    got = 'no error'
    for st in sts[1:]:
        try: c.run(st)
        except pg.DatabaseError as e:
            if got == 'no error': got = e.args[0].get('M')
        except pg.InterfaceError:
            pass   # pg8000's word for "that commit was a rollback"
    c.close()
    s = Session(seeded=False)
    ok('stopped by its last check after the sixteen ALTERs, then its own commit: none of the sixteen is changed and nothing is left',
       'SECURITY DEFINER without pg_temp last' in got and settings(s) == start and s.one("select to_regprocedure('public.m5_seventeenth()') is null"), got)
    ok('the database is as build left it: the sixteen as they started, no row from these checks',
       settings(s) == start and s.one('select count(*) from auth.users') == 0 and s.one("select count(*) from course") == 2)
    s.close()

    print('\n'.join('PASS ' + p for p in passed))
    print('\n'.join('FAIL ' + f for f in failed))
    print('\nFingerprints, md5(pg_get_functiondef) and length, before -> after:')
    for fn, old, old_len, new, new_len in fingerprints:
        print('  %-58s %s %5d -> %s %5d' % (fn, old, old_len, new, new_len))
    print('\n%d passed, %d failed' % (len(passed), len(failed)))
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    if sys.argv[1:] == ['build']: build()
    elif sys.argv[1:] == ['wrong-order']: wrong_order()
    elif sys.argv[1:] == ['alters']: alters_only()
    else: main()
