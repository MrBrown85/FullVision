"""Prove batch-a-undo.sql: Batch A goes in, is used, and comes out, and the
database is what it was.

    python3 batch_a_undo.py build    load an EMPTY database with everything
                                     but Batch A's four files (README.md,
                                     "Batch A": the same list)
    python3 batch_a_undo.py          the proof

The database named by PGDATABASE is only ever a template: every scenario
runs on a copy of it (named <PGDATABASE>_<scenario>, made and dropped
here), so the proof can be run again and again. The scenarios commit, and
some run other scripts of this folder against their copy.

  main        Before anything: the catalog (catalog.py) and a checksum of
              every table's rows. The four files are applied; a teacher
              turns the student page on, saves, returns and issues cards; a
              student signs in. Then each part in turn:
              PART 1   Batch A's 18 triggers are gone and nothing else;
                       what a student is shown afterwards, case by case, in
                       a When I Return Them class and an As Soon As I Save
                       one; what turning the Student Page off does; what of
                       Batch A still runs; score_rpcs.py passes as with
                       Batch A loaded; a second run takes no lock.
              PART 1B  the five score-table policies are the ones from
                       before file 01.
              PART 2   the catalog is the one from before Batch A but for
                       the dropped-column slots on course and the migration
                       record (which the optional last statement clears);
                       rows compared with just before PART 2 and with before
                       Batch A; the suites from before Batch A pass; every
                       part runs again and changes nothing; the four files
                       apply again.
  apply-only  The four files, then PART 2, with nothing done in between:
              every row of every table is what it was before Batch A.
  partial     Only file 01, files 01-02, files 01-03 applied: PART 1, 1B
              and 2 in turn, and PART 2 alone, take each back out.
  back-on     PART 1, saves while it is off, then file 02 again: the
              triggers are back and grade_return holds every grade.
  half-way    PART 1 stopped after each of its seven tables, then run whole.
  s0-m4b      With PR 989's file on top: PART 1 leaves its three triggers
              and lists them; PART 2 stops, saying to undo S0-M4b first.
  notices     The catalog notices each kind of thing it claims to cover.

batch_a_undo_load.py runs PART 1 against looping saves.

PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo.py build
PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo.py
"""
import json, os, re, subprocess, sys, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split
from catalog import catalog, differences, row_checksums, table_columns

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
BASE_DB = os.environ.get('PGDATABASE', 'fv')
UNDO = 'batch-a-undo.sql'
FILES = ['2026110901_score_rows_same_class.sql', '2026110902_grade_return.sql', '2026110903_student_card.sql', '2026110904_student_sessions_page.sql']
RECORD = ['score_rows_same_class', 'grade_return', 'student_card', 'student_sessions_page']   # as apply_migration names them
S0_M4B = '2026110905_grade_return_limits.sql'
S0_M4B_REF = 'origin/s0-m4b-grade-return-limits'          # until PR 989 is merged
# The list under "Batch A" in README.md.
BASE = ['harness.sql', 'score-prelude.sql', 'score-tables.sql', 'bundle-prelude.sql', 'bundle-tables.sql',
        '../2026111001_assessment_created_at_in_bundle.sql', 'student-submit-prelude.sql',
        '../20261025_questionnaires_tables_and_functions.sql', '../20261025_questionnaires_templates.sql',
        '../20261025_student_submit.sql', '../20261025_student_submit_phone.sql',
        '../20261025_student_submit_token_80.sql', '../20261025_phone_reports.sql',
        '../20261101_questionnaire_identity_check.sql', '../20261101_questionnaire_slip_fixes.sql',
        '../20261103_slip_password_kept_for_live_slips.sql', 'batch-a-tables.sql', 'batch-a-prelude.sql',
        'class-writers-prelude.sql']
A = '11111111-1111-1111-1111-111111111111'
# Classes of their own, so the other scripts (which grade in Teacher A's seeded class) find theirs as they expect it.
COURSE = 'aaaaaaaa-0000-0000-0000-0000000000dd'      # When I Return Them
COURSE2 = 'aaaaaaaa-0000-0000-0000-0000000000de'     # As Soon As I Save
ENR1 = 'eeeeeeee-1111-0000-0000-0000000000d1'; ENR2 = 'eeeeeeee-1111-0000-0000-0000000000d2'
ENR3 = 'eeeeeeee-1111-0000-0000-0000000000d3'        # the first student again, in the second class
STU1 = 'aaaaaaaa-1111-0000-0000-0000000000d1'; STU2 = 'aaaaaaaa-1111-0000-0000-0000000000d2'
SCORE_TABLES = ['public.score', 'public.tag_score', 'public.rubric_score', 'public.rubric_check_score', 'public.dibels_score']
TRIGGERS = "select count(*) from pg_trigger where tgname like 'grade\\_return\\_%' and not tgisinternal"
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:700]))
nid = lambda: str(uuid.uuid4())

def connect(db):
    return pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                         database=db, password=os.environ.get('PGPASSWORD'))
def admin(sql):
    c = connect('postgres'); c.run(sql); c.close()
def message(e):
    return str(e.args[0].get('M') if e.args and isinstance(e.args[0], dict) else e)
def bare(st):
    """A statement without its comment lines."""
    return '\n'.join(l for l in st.splitlines() if not l.strip().startswith('--')).strip()

def sections(text=None):
    """{'PART 1': [statements], 'PART 1B': [...], 'PART 2': [...]} of the undo script."""
    text = text or open(os.path.join(HERE, UNDO)).read()
    marks = [(name, text.index('\n-- %s: ' % name)) for name in ('PART 1', 'PART 1B', 'PART 2')]
    out = {}
    for n, (name, at) in enumerate(marks):
        out[name] = split(text[at:marks[n + 1][1]] if n + 1 < len(marks) else text[at:])
    return out
def transactions(statements):
    """A part's statements, cut where each transaction ends."""
    out, cur = [], []
    for st in statements:
        cur.append(st)
        if bare(st).lower() == 'commit': out.append(cur); cur = []
    return out + ([cur] if cur else [])
def record_statement():
    """The optional statement in the script's header, between `-- record:` and `-- end record`."""
    body = open(os.path.join(HERE, UNDO)).read().split('-- record:\n')[1].split('-- end record')[0]
    return '\n'.join(l[2:] for l in body.splitlines()).strip().rstrip(';')
PARTS = sections()

class Db:
    """One scenario's own copy of the template."""
    def __init__(self, tag):
        self.name = '%s_%s' % (BASE_DB, tag)
        admin('drop database if exists "%s" with (force)' % self.name)
        admin('create database "%s" template "%s"' % (self.name, BASE_DB))
        self.c = connect(self.name); self.rows = []
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def one(self, sql, **kw):
        r = self.c.run(sql, **kw); return r[0][0] if r else None
    def teacher(self, sql, **kw):
        self.c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); self.c.run('set role authenticated')
        try: return self.c.run('select ' + sql, **kw)[0][0]
        finally: self.c.run('reset role')
    def service(self, sql, **kw):
        self.c.run('set role service_role')
        try: return self.c.run('select ' + sql, **kw)[0][0]
        finally: self.c.run('reset role')
    def statements(self, sts):
        """'ok', or 'STOPPED: <message>' with the open transaction rolled back. Keeps the rows of the last query."""
        try:
            for st in sts:
                r = self.c.run(st)
                if bare(st).lower().startswith('select'): self.rows = [list(x) for x in r]
            return 'ok'
        except Exception as e:
            self.c.run('rollback'); return 'STOPPED: ' + message(e)
    def part(self, name): return self.statements(PARTS[name])
    def file(self, name, ref=None):
        path = os.path.join(HERE, '..', name)
        if os.path.exists(path): text = open(path).read()
        else: text = subprocess.run(['git', '-C', ROOT, 'show', '%s:migrations/%s' % (ref, name)], capture_output=True, text=True, check=True).stdout
        return self.statements(split(text))
    def apply(self, n=4):
        """The first n of Batch A's files, and their lines in the migration record, as apply_migration writes them."""
        for i, f in enumerate(FILES[:n]):
            r = self.file(f)
            if r != 'ok': return r
            self.c.run("insert into supabase_migrations.schema_migrations (version, name) values (:v, :n)", v='2026111017000%d' % i, n=RECORD[i])
        return 'ok'
    def suite(self, script):
        """Another script of this folder, on this copy: its last line."""
        env = dict(os.environ, PGDATABASE=self.name)
        r = subprocess.run([sys.executable, os.path.join(HERE, script)], capture_output=True, text=True, env=env, cwd=HERE)
        return (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[-1]
    def close(self):
        self.c.close(); admin('drop database if exists "%s" with (force)' % self.name)

def build():
    c = connect(BASE_DB)
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run('select rolname from pg_roles')}
    for rel in BASE:
        n = 0
        for st in split(open(os.path.join(HERE, rel)).read()):
            words = st.split('\n')[-1].split()
            if rel == 'harness.sql' and words[:2] == ['create', 'role'] and words[2] in roles: continue   # roles belong to the whole server
            try: c.run(st)
            except Exception as e: sys.exit('FAILED in %s:\n%s\n-> %s' % (rel, st[:300], e))
            n += 1
        print('%s: %d statements' % (rel, n))
    c.close()

# ── What every scenario starts from ─────────────────────────────────────────
def seed(d):
    """Two classes of Teacher A's with two students, a grade saved the old
    way, and a stand-in for Supabase's migration record with earlier rows."""
    d.run("insert into course (id, teacher_id, name) values (:c, :t, 'Undo class'), (:c2, :t, 'Undo class two')", c=COURSE, c2=COURSE2, t=A)
    d.run("insert into student (id, teacher_id, first_name, last_name, date_of_birth) values (:a, :t, 'Una', 'Do', '2012-05-15'), (:b, :t, 'Dee', 'Do', null)", a=STU1, b=STU2, t=A)
    d.run("""insert into enrollment (id, student_id, course_id, roster_position) values (:e, :a, :c, 1), (:f, :b, :c, 2), (:g, :a, :c2, 1)""",
          e=ENR1, f=ENR2, g=ENR3, a=STU1, b=STU2, c=COURSE, c2=COURSE2)
    old = nid()
    d.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Old quiz', 'points', 10)", a=old, c=COURSE)
    d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=old); d.teacher("save_score_comment(:e, :a, 'From before')", e=ENR2, a=old)
    d.run('create schema supabase_migrations')
    d.run('create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)')
    d.run("""insert into supabase_migrations.schema_migrations (version, name) values ('20261108000001', 'teacher_outlives_sign_in'),
             ('20261109000001', 'fullvision_v2_grade_return_notes'), ('20261110131526', 'assessment_created_at_in_bundle')""")
    return old

def use(d):
    """A teacher and a student use Batch A. In the When I Return Them class:
    quiz    Returned 7 (and 9 for the second student)
    lab     a draft, never returned (4)
    essay   Returned 15, then changed to 16: a draft on a returned grade
    rubric  a rubric piece, Returned 3, then changed to 4
    In the As Soon As I Save class: one piece, 6. Cards for both classes and
    a signed-in phone for each."""
    k = {n: nid() for n in ('quiz', 'lab', 'essay', 'rubric', 'save_quiz', 'r1', 'r2', 'c1', 'c2')}
    d.run("""insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Undo quiz', 'points', 10),
             (:b, :c, 'Undo lab', 'points', 5), (:e, :c, 'Undo essay', 'points', 20), (:s, :c2, 'Save quiz', 'points', 10)""",
          a=k['quiz'], b=k['lab'], e=k['essay'], s=k['save_quiz'], c=COURSE, c2=COURSE2)
    d.run("insert into rubric (id, course_id, name, style) values (:a, :c, 'R1', 'advanced'), (:b, :c, 'R2', 'advanced')", a=k['r1'], b=k['r2'], c=COURSE)
    d.run("insert into criterion (id, rubric_id, name) values (:a, :r1, 'one'), (:b, :r2, 'one copy')", a=k['c1'], b=k['c2'], r1=k['r1'], r2=k['r2'])
    d.run("insert into assessment (id, course_id, title, score_mode, rubric_id) values (:a, :c, 'Undo rubric', 'proficiency', :r)", a=k['rubric'], c=COURSE, r=k['r1'])
    d.teacher("update_course(:c, :p::jsonb)", c=COURSE, p='{"student_page_enabled": true, "return_grades": "on_return"}')
    d.teacher("update_course(:c, :p::jsonb)", c=COURSE2, p='{"student_page_enabled": true, "return_grades": "on_save"}')
    d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=k['quiz']); d.teacher('upsert_score(:e, :a, 9)', e=ENR2, a=k['quiz'])
    d.teacher("save_score_comment(:e, :a, 'Good')", e=ENR1, a=k['quiz'])
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['quiz'], ids='{%s,%s}' % (ENR1, ENR2), k=nid())
    d.teacher('upsert_score(:e, :a, 4)', e=ENR1, a=k['lab'])
    d.teacher('upsert_score(:e, :a, 15)', e=ENR1, a=k['essay'])
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['essay'], ids='{%s}' % ENR1, k=nid())
    d.teacher('upsert_score(:e, :a, 16)', e=ENR1, a=k['essay'])
    d.teacher('upsert_rubric_score(:e, :a, :x, 3, 0::smallint, null, null)', e=ENR1, a=k['rubric'], x=k['c1'])
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['rubric'], ids='{%s}' % ENR1, k=nid())
    d.teacher('upsert_rubric_score(:e, :a, :x, 4, 0::smallint, null, null)', e=ENR1, a=k['rubric'], x=k['c1'])
    d.teacher('upsert_score(:e, :a, 6)', e=ENR3, a=k['save_quiz'])
    for course in (COURSE, COURSE2): d.teacher('issue_student_cards(:c, null, :k)', c=course, k=nid())
    d.teacher("set_cards_work_until(:c, '2027-06-30'::date, :k)", c=COURSE, k=nid())
    for enr, name in ((ENR1, 'token'), (ENR3, 'token2')):
        code = d.one('select code from student_card where enrollment_id = :e and stopped_at is null', e=enr)
        d.service("student_submit.card(:c, 'undo-ip')", c=code)
        k[name] = d.service("student_submit.verify_card(:c, '2012-05-15', null, null, null, 'undo-ip', false)", c=code)['session_token']
        k[name + '_code'] = code
    d.service("student_submit.seen(:t, :e, :ids::uuid[], 'undo-ip')", t=k['token'], e=ENR1, ids='{%s}' % k['quiz'])
    d.service("student_submit.card('AAA-AAA', 'undo-ip')")
    return k

def sees(d, token, enr):
    """What the student's page shows: {piece: its overall value, or None for no result}, or the refusal."""
    p = d.service("student_submit.page(:t, :e, 'undo-ip')", t=token, e=enr)
    if not p.get('ok'): return p
    return {a['title']: (a['grade']['value'] if a.get('grade') else None) for a in p['assessments']}
def grade_rows(d):
    return d.run("""select enrollment_id::text, assessment_id::text, is_draft, returned_at::text, returned_copy::text, previous_copy::text, updated_at::text,
                           seen_at::text, working_copy::text from grade_return order by 1, 2""")
def before(d):
    """The catalog and every table's rows."""
    cols = table_columns(d.c)
    return catalog(d.c), row_checksums(d.c, cols), cols
def trace(cat0, cat):
    """The differences from the first catalog, as (only before, only after)."""
    return differences(cat0, cat)
def no_attnum(lines): return [re.sub(r'^(column [^|]+\| )\d+ \| ', r'\1', l) for l in lines]
def dropped_only(cat0, cat, n):
    """Nothing differs but n dropped-column slots on course."""
    gone, new = trace(cat0, cat)
    return gone == [] and new == ['dropped columns public.course | %d' % n]

# ── main ────────────────────────────────────────────────────────────────────
def scen_main():
    d = Db('main'); old = seed(d)
    cat0, rows0, cols0 = before(d)
    LIVE = {}
    for line in open(os.path.join(HERE, 'live-function-md5.txt')):
        p = line.split()
        if p and not line.startswith('#'): LIVE[p[0]] = p[1]
    SEVEN = {'update_course': 'public.update_course(uuid,jsonb)', 'move_rubric_scores': 'public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
             'duplicate_course': 'public.duplicate_course(uuid,uuid)', 'import_json_restore': 'public.import_json_restore(jsonb,uuid)'}
    md5 = lambda fn: d.one("select md5(pg_get_functiondef('%s'::regprocedure))" % fn)
    ok('before: the four functions of the seven that have a live fingerprint on file carry it', all(md5(f) == LIVE[n] for n, f in SEVEN.items()))

    # ── Batch A in, and used ───────────────────────────────────────────
    ok('the four files apply', d.apply() == 'ok' and d.one(TRIGGERS) == 18)
    cat1 = catalog(d.c)
    ok('applying them changes no row of any table that was there (%d tables, compared with before Batch A)' % len(rows0),
       row_checksums(d.c, cols0) == rows0, sorted(t for t in rows0 if row_checksums(d.c, {t: cols0[t]})[t] != rows0[t]))
    k = use(d)
    used = {t: d.one('select count(*) from ' + t) for t in ('public.grade_return', 'public.student_card', 'student_submit.device_session')}
    ok('Batch A is in use: returned grades, drafts, a draft on a returned grade, cards, two signed-in phones, card rows in the sign-in log',
       used['public.grade_return'] >= 6 and used['public.student_card'] == 3 and used['student_submit.device_session'] == 2
       and d.one("select count(*) from student_submit.attempt where route = 'card'") >= 3, used)
    ok('the student sees what was returned: quiz 7, the essay as returned (15, not the 16 waiting), the rubric piece, and no result for the draft',
       sees(d, k['token'], ENR1) == {'Old quiz': 7, 'Undo quiz': 7, 'Undo lab': None, 'Undo essay': 15, 'Undo rubric': None}
       or {x: y for x, y in sees(d, k['token'], ENR1).items() if x != 'Undo rubric'} == {'Old quiz': 7, 'Undo quiz': 7, 'Undo lab': None, 'Undo essay': 15},
       sees(d, k['token'], ENR1))
    ok('and in the As Soon As I Save class, the grade as saved', sees(d, k['token2'], ENR3) == {'Save quiz': 6}, sees(d, k['token2'], ENR3))

    # ── PART 1: the fast stop ──────────────────────────────────────────
    ok('PART 1 runs', d.part('PART 1') == 'ok')
    ok('PART 1: none of Batch A\'s triggers is left, and its last query lists nothing', d.one(TRIGGERS) == 0 and d.rows == [], d.rows)
    gone, new = trace(cat1, catalog(d.c))
    ok('PART 1: nothing else of Batch A is touched: the only catalog lines that differ are its 18 triggers (and the count of what depends on triggers)',
       len([l for l in gone if l.startswith('trigger ')]) == 18 and all(l.startswith(('trigger ', 'depends pg_trigger ')) for l in gone)
       and all(l.startswith('depends pg_trigger ') for l in new), ([l for l in gone if not l.startswith('trigger ')], new))
    gr = grade_rows(d)

    # What a student is shown after it. When I Return Them:
    new_piece, save_new = nid(), nid()
    d.run("""insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Undo new', 'points', 10),
             (:b, :c2, 'Save new', 'points', 10)""", a=new_piece, b=save_new, c=COURSE, c2=COURSE2)
    d.teacher('upsert_score(:e, :a, 3)', e=ENR1, a=k['quiz'])      # was Returned 7
    d.teacher('upsert_score(:e, :a, 5)', e=ENR1, a=k['lab'])       # was a draft never returned (4)
    d.teacher('upsert_score(:e, :a, 18)', e=ENR1, a=k['essay'])    # was a draft (16) over a returned 15
    d.teacher('upsert_score(:e, :a, 8)', e=ENR1, a=new_piece)      # no grade before
    seen = sees(d, k['token'], ENR1)
    ok('PART 1, When I Return Them: a Returned grade the teacher changes (7 to 3) is shown to the student AT ONCE, not held as a draft', seen.get('Undo quiz') == 3, seen)
    ok('PART 1, When I Return Them: a first grade on a new piece is NOT shown at all', 'Undo new' in seen and seen['Undo new'] is None, seen)
    ok('PART 1, When I Return Them: a draft never returned stays hidden, whatever is saved on it', seen.get('Undo lab') is None, seen)
    ok('PART 1, When I Return Them: a draft on a returned grade stays as it was returned (15), whatever is saved on it (16, then 18)', seen.get('Undo essay') == 15, seen)
    # As Soon As I Save:
    d.teacher('upsert_score(:e, :a, 2)', e=ENR3, a=k['save_quiz'])
    d.teacher('upsert_score(:e, :a, 9)', e=ENR3, a=save_new)
    seen2 = sees(d, k['token2'], ENR3)
    ok('PART 1, As Soon As I Save: a grade the student already had, changed (6 to 2), is shown at once, as before', seen2.get('Save quiz') == 2, seen2)
    ok('PART 1, As Soon As I Save: a first grade on a new piece is NOT shown, though the class shows grades as they are saved', 'Save new' in seen2 and seen2['Save new'] is None, seen2)
    d.teacher("save_score_comment(:e, :a, 'After the stop')", e=ENR2, a=k['quiz']); d.teacher('clear_score(:e, :a)', e=ENR2, a=k['lab'])
    ok('PART 1: none of those saves, a comment or a clear changed a row of grade_return', grade_rows(d) == gr)

    # Turning the Student Page off is what stops students seeing anything.
    d.run('update course set student_page_enabled = false where id in (:c, :c2)', c=COURSE, c2=COURSE2)
    off = [sees(d, k['token'], ENR1), sees(d, k['token2'], ENR3), d.service("student_submit.card(:c, 'undo-ip')", c=k['token_code'])]
    ok('PART 1, then the Student Page turned off (one UPDATE of course): the signed-in page and a card scan are both refused',
       all(x.get('ok') is False for x in off), off)
    d.run('update course set student_page_enabled = true where id in (:c, :c2)', c=COURSE, c2=COURSE2)
    ok('... and turned on again, students see what they saw', sees(d, k['token'], ENR1) == seen and sees(d, k['token2'], ENR3) == seen2)

    # What of Batch A still runs after PART 1.
    ok('PART 1 leaves file 01\'s five same-class policies: they run on every save until PART 1B',
       d.one("select count(*) from pg_policies where policyname like '%\\_same\\_class'") == 5)
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['lab'], ids='{%s}' % ENR1, k=nid())
    ok('after PART 1, Return Grades still works: the draft is returned and the student sees it (5)',
       sees(d, k['token'], ENR1).get('Undo lab') == 5 and grade_rows(d) != gr, sees(d, k['token'], ENR1))
    gr = grade_rows(d)
    d.teacher("update_course(:c, :p::jsonb)", c=COURSE, p='{"return_grades": "on_save"}')
    ok('after PART 1, a class leaving When I Return Them no longer returns what was waiting: the essay stays as returned (15) and no row changes',
       sees(d, k['token'], ENR1).get('Undo essay') == 15 and grade_rows(d) == gr, sees(d, k['token'], ENR1))
    d.teacher("update_course(:c, :p::jsonb)", c=COURSE, p='{"return_grades": "on_return"}')
    row = lambda a: d.run("select returned_copy::text, working_copy::text from grade_return where enrollment_id = :e and assessment_id = :a", e=ENR1, a=a)[0]
    b4 = row(k['rubric'])
    d.run('update assessment set rubric_id = :r where id = :a', r=k['r2'], a=k['rubric'])
    d.teacher('move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=k['rubric'], r=k['r2'], m=json.dumps({k['c1']: k['c2']}), k='{}', key=nid())
    af = row(k['rubric'])
    ok('after PART 1, a rubric move still rewrites grade_return: the returned copy follows to the new criterion, the working copy keeps the old one',
       k['c1'] in b4[0] and k['c2'] in af[0] and k['c1'] not in af[0] and af[1] == b4[1] and k['c1'] in af[1], (b4, af))
    ids = {n: nid() for n in ('course', 's', 'e', 'a')}
    backup = {'courses': [{'id': ids['course'], 'name': 'Restored'}], 'students': [{'id': ids['s'], 'first_name': 'Ana'}],
              'enrollments': [{'id': ids['e'], 'student_id': ids['s'], 'course_id': ids['course']}],
              'assessments': [{'id': ids['a'], 'course_id': ids['course'], 'title': 'Quiz', 'score_mode': 'points', 'max_points': 10}],
              'scores': [{'enrollment_id': ids['e'], 'assessment_id': ids['a'], 'value': 8}]}
    d.teacher('import_json_restore(:p::jsonb, :k)', p=json.dumps(backup), k=nid())
    ok('after PART 1, a restore still calls Batch A\'s helper: the restored grade gets its grade_return row',
       d.one('select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id join course c on c.id = e.course_id where c.name = :n', n='Restored') == 1)
    d.service("student_submit.seen(:t, :e, :ids::uuid[], 'undo-ip')", t=k['token'], e=ENR1, ids='{%s}' % k['essay'])
    ok('after PART 1, the cards and the student\'s own functions go on working and writing: a new card, and "seen" on a piece',
       d.teacher('reissue_student_card(:id, :k)', id=str(d.one('select id from student_card where enrollment_id = :e and stopped_at is null', e=ENR2)), k=nid()) is not None
       and d.one('select seen_at is not null from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=k['essay']))
    d.run('delete from assessment where id = :a', a=k['lab'])
    ok('after PART 1, deleting a piece leaves its grade_return rows behind (PART 2 removes the table; file 02 again clears them)',
       d.one('select count(*) from grade_return where assessment_id = :a', a=k['lab']) == 1)
    r = d.suite('score_rpcs.py')
    ok('PART 1: score_rpcs.py passes as it does with Batch A loaded, 236 of 236 (every pin of today, and the same-class refusals file 01 still makes)', r == '236 passed, 0 failed', r)

    # A second run needs no lock: it goes through with every table locked by another session.
    again = catalog(d.c)
    holder = connect(d.name); holder.run('begin')
    holder.run('lock table public.score, public.tag_score, public.rubric_score, public.rubric_check_score, public.enrollment, public.assessment, public.course in access exclusive mode')
    t0 = time.time(); r = d.part('PART 1'); took = time.time() - t0
    holder.run('rollback'); holder.close()
    ok('PART 1 run again changes nothing and takes no lock (it ran while another session held all seven tables)', r == 'ok' and took < 2 and catalog(d.c) == again, (r, took))

    # ── PART 1B ────────────────────────────────────────────────────────
    ok('PART 1B runs', d.part('PART 1B') == 'ok')
    pol = lambda lines: [l for l in lines if l.startswith('policy ') and l.split(' | ')[0].split('.')[1] in ('score', 'tag_score', 'rubric_score', 'rubric_check_score', 'dibels_score')]
    ok('PART 1B: the five score-table policies are exactly the ones from before file 01', pol(catalog(d.c)) == pol(cat0) and len(pol(cat0)) == 5, trace(pol(cat0), pol(catalog(d.c))))
    again = catalog(d.c)
    ok('PART 1B run again changes nothing', d.part('PART 1B') == 'ok' and catalog(d.c) == again)

    # ── PART 2: the full removal ───────────────────────────────────────
    sums_before = row_checksums(d.c, cols0)
    d.run("create table public.undo_attempt as select * from student_submit.attempt where route <> 'card'")
    kept = d.run("select count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from public.undo_attempt x")[0]
    d.run('drop table public.undo_attempt')
    ok('PART 2 runs', d.part('PART 2') == 'ok')
    cat2 = catalog(d.c)
    gone, new = trace(cat0, cat2)
    ok('PART 2: the catalog is the one from before Batch A, line by line (%d lines), but for two things it says it leaves' % len(cat0),
       gone == [] and sorted(new) == sorted(['dropped columns public.course | 3'] + ['migration record 2026111017000%d | %s' % (i, n) for i, n in enumerate(RECORD)]),
       (gone[:6], new[:8]))
    ok('PART 2 leaves the migration record alone: it still lists the four files as applied', d.one("select count(*) from supabase_migrations.schema_migrations where name = any (cast(:n as text[]))", n=RECORD) == 4)
    d.run(record_statement())
    ok('the optional statement in the header takes those four rows out of the record and no other (three earlier rows stay)',
       dropped_only(cat0, catalog(d.c), 3) and d.one('select count(*) from supabase_migrations.schema_migrations') == 3, trace(cat0, catalog(d.c)))
    ok('what is left: three dropped-column slots on course, where the three class settings were (they hold nothing and nothing reads them)',
       d.one("select count(*) from pg_attribute where attrelid = 'public.course'::regclass and attisdropped") == 3)
    sums_after = row_checksums(d.c, cols0)
    changed = sorted(t for t in sums_before if sums_before[t] != sums_after[t])
    ok('PART 2: no row of any table that was there before Batch A changed, but the sign-in log (%d tables, compared with just before PART 2)' % len(sums_before),
       changed == ['student_submit.attempt'], changed)
    ok('PART 2: the five score tables are row for row what they were just before it', all(sums_before[t] == sums_after[t] for t in SCORE_TABLES)
       and sums_after['public.score'][0] > 0, {t: sums_after[t] for t in SCORE_TABLES})
    # Compared with before Batch A: only what the teacher's own work in between wrote.
    touched = sorted(t for t in rows0 if rows0[t] != sums_after[t])
    ok('PART 2: compared with BEFORE Batch A, the only tables whose rows differ are the ones the teacher\'s own saves, pieces, rubric move and restore wrote in between',
       touched == ['public.assessment', 'public.course', 'public.course_sync_cursor', 'public.criterion', 'public.enrollment', 'public.fv_idempotency',
                   'public.rubric', 'public.rubric_score', 'public.score', 'public.score_audit', 'public.student'], touched)
    left = d.run("select count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from student_submit.attempt x")[0]
    ok('PART 2: the sign-in log lost its card rows and nothing else', list(left) == list(kept) and d.one("select count(*) from student_submit.attempt where route = 'card'") == 0, (kept, left))
    ok('PART 2: the four of the seven with a live fingerprint on file carry it again', all(md5(f) == LIVE[n] for n, f in SEVEN.items()))
    ok('PART 2: grade_return, student_card, the session tables, fv_private and the three class settings are gone',
       d.one("""select to_regclass('public.grade_return') is null and to_regclass('public.student_card') is null
                       and to_regclass('student_submit.device_session') is null and to_regnamespace('fv_private') is null
                       and not exists (select 1 from information_schema.columns where table_name = 'course'
                                          and column_name in ('student_page_enabled', 'return_grades', 'cards_work_until'))"""))
    cat_after = catalog(d.c)
    ok('PART 2 run again changes nothing', d.part('PART 2') == 'ok' and catalog(d.c) == cat_after)
    ok('PART 1 and PART 1B run after it change nothing either', d.part('PART 1') == 'ok' and d.part('PART 1B') == 'ok' and catalog(d.c) == cat_after)

    # ── The suites from before Batch A ─────────────────────────────────
    # score_rpcs.py makes 176 checks on the score-only database and 183 on this one, which also loads the
    # five functions Batch A patches or copies, and get_class_bundle and get_gradebook, and compares each with
    # its live fingerprint.
    for script, want in (('score_rpcs.py', '183 passed, 0 failed'), ('student_submit.py', '79 passed, 0 failed'),
                         ('questionnaire_identity.py', '47 passed, 0 failed'), ('phone_reports.py', '37 passed, 0 failed'),
                         ('questionnaires.py', '42 passed, 0 failed')):
        r = d.suite(script)
        ok('after the undo, %s passes as before Batch A: %s' % (script, want.split(',')[0]), r == want, r)

    # ── Batch A goes in again ──────────────────────────────────────────
    ok('the four files apply again', d.apply() == 'ok')
    cat3 = [l for l in catalog(d.c) if not l.startswith(('dropped columns ', 'depends '))]
    first = [l for l in cat1 if not l.startswith('depends ')]
    ok('and give the same database as the first time (the three class settings are new columns again, so their position differs, and the three old slots remain)',
       no_attnum(cat3) == no_attnum(first), trace(no_attnum(first), no_attnum(cat3)))
    n = d.one('select count(*) from grade_return')
    ok('and the backfill makes every grade there is Returned again (the line between Draft and Returned was lost with the undo)',
       n == d.one("""select count(distinct (enrollment_id, assessment_id)) from (
                        select enrollment_id, assessment_id from score where value is not null or nullif(btrim(comment), '') is not null
                        union select enrollment_id, assessment_id from rubric_score union select enrollment_id, assessment_id from tag_score
                        union select enrollment_id, assessment_id from rubric_check_score) x""")
       and d.one('select count(*) from grade_return where is_draft') == 0 and n > 0, n)
    d.close()

# ── apply-only ──────────────────────────────────────────────────────────────
def scen_apply_only():
    d = Db('applyonly'); seed(d)
    cat0, rows0, cols0 = before(d)
    ok('apply-only: the four files, then PART 2 with nothing done in between', d.apply() == 'ok' and d.part('PART 2') == 'ok')
    d.run(record_statement())
    ok('apply-only: every row of every table is what it was before Batch A (%d tables; the backfill and its undoing included)' % len(rows0),
       row_checksums(d.c, cols0) == rows0 and table_columns(d.c) == cols0, sorted(t for t in rows0 if row_checksums(d.c, {t: cols0[t]})[t] != rows0[t]))
    ok('apply-only: and the catalog is the one from before but for the three dropped-column slots', dropped_only(cat0, catalog(d.c), 3), trace(cat0, catalog(d.c)))
    d.close()

# ── partial ─────────────────────────────────────────────────────────────────
def scen_partial():
    slots = {1: 0, 2: 2, 3: 3}     # file 02 adds two class settings, file 03 the third
    for n in (1, 2, 3):
        for label, parts in (('PART 1, PART 1B and PART 2 in turn', ('PART 1', 'PART 1B', 'PART 2')), ('PART 2 alone', ('PART 2',))):
            d = Db('partial'); seed(d)
            cat0, rows0, cols0 = before(d)
            applied = d.apply(n)
            got = [d.part(p) for p in parts]
            d.run(record_statement())
            gone, new = trace(cat0, catalog(d.c))
            ok('partial: only file%s 01%s applied, then %s: each runs, the catalog is the one from before%s, and no row of any table differs'
               % ('' if n == 1 else 's', '' if n == 1 else ' to 0%d' % n, label, ' but for %d dropped-column slots on course' % slots[n] if slots[n] else ''),
               applied == 'ok' and got == ['ok'] * len(parts) and gone == []
               and new == (['dropped columns public.course | %d' % slots[n]] if slots[n] else []) and row_checksums(d.c, cols0) == rows0,
               (applied, got, gone[:5], new[:5]))
            d.close()

# ── back-on: PART 1, then file 02 again ─────────────────────────────────────
def scen_back_on():
    d = Db('backon'); seed(d)
    ok('back-on: Batch A applied and in use', d.apply() == 'ok'); k = use(d)
    new_piece = nid()
    d.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Undo new', 'points', 10)", a=new_piece, c=COURSE)
    ok('back-on: PART 1', d.part('PART 1') == 'ok' and d.one(TRIGGERS) == 0)
    d.teacher('upsert_score(:e, :a, 3)', e=ENR1, a=k['quiz']); d.teacher('upsert_score(:e, :a, 5)', e=ENR1, a=k['lab'])
    d.teacher('upsert_score(:e, :a, 18)', e=ENR1, a=k['essay']); d.teacher('upsert_score(:e, :a, 8)', e=ENR1, a=new_piece)
    d.teacher('clear_score(:e, :a)', e=ENR2, a=k['quiz'])           # a returned 9, cleared while the triggers are off
    d.run('delete from assessment where id = :a', a=k['save_quiz'])  # a piece with a returned grade, deleted while they are off
    orphans = """select count(*) from grade_return g where not exists (select 1 from assessment a where a.id = g.assessment_id)
                                                        or not exists (select 1 from enrollment e where e.id = g.enrollment_id)"""
    left_behind = d.one(orphans)
    ok('back-on: file 02 runs again', d.file(FILES[1]) == 'ok' and d.one(TRIGGERS) == 18, d.one(TRIGGERS))
    stale = d.run("""select g.enrollment_id::text, g.assessment_id::text from grade_return g
                      where g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)""")
    ok('back-on: every grade_return row then holds the grade as the score tables have it', stale == [], stale)
    seen = sees(d, k['token'], ENR1)
    ok('back-on: the student then sees the changed Returned grade (3) and the first grade saved while it was off (8, made Returned by the backfill); the two drafts are still drafts (no result; 15)',
       {x: seen.get(x) for x in ('Undo quiz', 'Undo new', 'Undo lab', 'Undo essay')} == {'Undo quiz': 3, 'Undo new': 8, 'Undo lab': None, 'Undo essay': 15}, seen)
    d.teacher('upsert_score(:e, :a, 1)', e=ENR1, a=k['quiz'])
    ok('back-on: and the triggers work again: a change to a Returned grade waits as a draft (the student still sees 3)', sees(d, k['token'], ENR1).get('Undo quiz') == 3)
    ok('back-on: the grade_return row a piece deleted while it was off left behind is cleared by file 02 run again', left_behind == 1 and d.one(orphans) == 0, (left_behind, d.one(orphans)))
    d.close()

# ── half-way ────────────────────────────────────────────────────────────────
def scen_half_way():
    d = Db('halfway'); seed(d)
    ok('half-way: Batch A applied', d.apply() == 'ok')
    txs = transactions(PARTS['PART 1'])
    ok('PART 1 is seven transactions, one table each, and one closing query', len(txs) == 8 and all(bare(t[0]).lower() == 'begin' for t in txs[:7])
       and [len(re.findall(r'\bon public\.(\w+);', ' '.join(t))) for t in txs[:7]] == [3, 4, 4, 4, 1, 1, 1], len(txs))
    results = []
    for stop_after in range(1, 7):
        for t in txs[:stop_after]: d.statements(t)
        mid = d.one(TRIGGERS)
        results.append((stop_after, mid, d.part('PART 1'), d.one(TRIGGERS), d.file(FILES[1]), d.one(TRIGGERS)))
    ok('half-way: stopped after each of its first six tables, PART 1 run again from the top finishes the job (then file 02 puts the 18 back for the next try)',
       all(r[2] == 'ok' and r[3] == 0 and r[4] == 'ok' and r[5] == 18 for r in results)
       and [r[1] for r in results] == [15, 11, 7, 3, 2, 1], results)
    # A table it cannot get: it gives up on that table and says so; the tables before it are done.
    holder = connect(d.name); holder.run('begin'); holder.run('lock table public.rubric_score in access exclusive mode')
    t0 = time.time(); r = d.part('PART 1'); took = time.time() - t0
    left = d.one(TRIGGERS)
    holder.run('rollback'); holder.close()
    ok('half-way: a table held by another session for good: PART 1 tries 40 times (about twelve seconds), stops with a message naming it, and keeps what it had done',
       r.startswith('STOPPED: PART 1 could not get public.rubric_score in 40 tries') and left == 11 and 8 < took < 20, (r, left, round(took, 1)))
    ok('half-way: and run again once the table is free, it finishes', d.part('PART 1') == 'ok' and d.one(TRIGGERS) == 0)
    d.close()

# ── s0-m4b: PR 989 on top ───────────────────────────────────────────────────
def scen_s0_m4b():
    d = Db('m4b'); seed(d)
    ok('s0-m4b: Batch A, then 2026110905 (PR 989) on top', d.apply() == 'ok' and d.file(S0_M4B, S0_M4B_REF) == 'ok')
    theirs = [['assessment', 'grade_return_mode'], ['assessment', 'grade_return_truncate'], ['enrollment', 'grade_return_truncate']]
    ok('s0-m4b: PART 1 runs, drops Batch A\'s 18 and leaves S0-M4b\'s three triggers',
       d.part('PART 1') == 'ok' and d.run("select tgrelid::regclass::text, tgname from pg_trigger where tgname like 'grade\\_return\\_%' and not tgisinternal order by 1, 2") == theirs)
    ok('s0-m4b: and its last query lists those three, saying whose they are',
       [r[:2] for r in d.rows] == theirs and all('S0-M4b' in r[2] for r in d.rows), d.rows)
    ok('s0-m4b: PART 1B runs', d.part('PART 1B') == 'ok')
    d.close()
    # PART 2, with S0-M4b whole: it must stop. (A fresh copy: PART 1 above took Batch A's triggers.)
    d = Db('m4b'); seed(d)
    cat0, rows0, cols0 = before(d)
    d.apply(); d.file(S0_M4B, S0_M4B_REF)
    cat = catalog(d.c); r = d.part('PART 2')
    ok('s0-m4b: PART 2 stops before it changes anything, saying to run S0-M4b\'s undo first and naming what it found',
       r.startswith("STOPPED: Something is built on top of Batch A that this script does not know. If it is S0-M4b (2026110905, PR 989), run S0-M4b's undo first, then this. Found: ")
       and all(x in r for x in ('trigger grade_return_mode on assessment', 'trigger grade_return_truncate on enrollment', 'function public.'))
       and r.endswith('Nothing was changed.') and catalog(d.c) == cat, r)
    # The whole way back: S0-M4b's own undo (from its branch), then PART 2.
    theirs = d.file('local-test/s0-m4b-undo.sql', S0_M4B_REF)
    back = d.part('PART 2'); d.run(record_statement())
    ok('s0-m4b: after S0-M4b\'s own undo, PART 2 runs, and the catalog is the one from before Batch A but for the three dropped-column slots; no row of any table differs',
       theirs == 'ok' and back == 'ok' and dropped_only(cat0, catalog(d.c), 3) and row_checksums(d.c, cols0) == rows0, (theirs, back, trace(cat0, catalog(d.c))))
    d.close()

# ── notices: the catalog sees each kind of thing ────────────────────────────
def scen_notices():
    d = Db('notices'); seed(d)
    kinds = [
        ('a view', 'create view public.undo_v as select id from public.course', 'view '),
        ('a comment on a function', "comment on function public.fv_owns_course(uuid) is 'x'", 'function more '),
        ('a comment on a trigger', "comment on trigger course_sync_cursor_score_gradebook on public.score is 'x'", 'trigger comment '),
        ('an event trigger', """create function public.undo_evt() returns event_trigger language plpgsql as 'begin end';
                                create event trigger undo_evt on ddl_command_end execute function public.undo_evt()""", 'event trigger '),
        ('an extension', 'create extension citext', 'extension '),
        ('a publication', 'create publication undo_pub for table public.course', 'publication '),
        ('a row in the migration record', "insert into supabase_migrations.schema_migrations (version, name) values ('1', 'x')", 'migration record '),
        ('a cron job', """create schema cron; create table cron.job (jobname text, schedule text, command text, database text, username text, active boolean);
                          insert into cron.job values ('fv_x', '* * * * *', 'select 1', 'd', 'u', true)""", 'cron job '),
        ('a function\'s setting', 'alter function public.fv_owns_course(uuid) set search_path = public, pg_temp', 'function more '),
        ('a dropped column', 'alter table public.course add column undo_x int; alter table public.course drop column undo_x', 'dropped columns '),
        ('a sequence', 'create sequence public.undo_seq', 'sequence '),
        ('a rule', 'create rule undo_rule as on delete to public.report_config do also nothing', 'rule '),
        ('a grant on a table', 'grant select on public.course to anon', 'table '),
        ('a default privilege', 'alter default privileges in schema public grant select on tables to anon', 'default privileges '),
    ]
    cat0 = catalog(d.c); missed = []
    for what, sql, kind in kinds:
        d.run('begin')
        for st in sql.split(';'):
            if st.strip(): d.run(st)
        gone, new = trace(cat0, catalog(d.c))
        if not any(l.startswith(kind) for l in gone + new): missed.append(what)
        d.run('rollback')
    ok('the catalog notices each of %d kinds of thing made, changed or dropped: %s' % (len(kinds), ', '.join(k[0] for k in kinds)), missed == [], missed)
    d.close()

if __name__ == '__main__':
    if sys.argv[1:] == ['build']:
        build(); sys.exit(0)
    c = connect(BASE_DB); has = c.run("select to_regclass('public.grade_return') is not null")[0][0]; c.close()
    if has: sys.exit('this database already has Batch A: build one without the four migrations')
    ok('the undo script: PART 1 (seven transactions and a query), PART 1B and PART 2 (one transaction each)',
       [len(transactions(PARTS[p])) for p in ('PART 1', 'PART 1B', 'PART 2')] == [8, 1, 1])
    which = sys.argv[1:] or ['main', 'apply-only', 'partial', 'back-on', 'half-way', 's0-m4b', 'notices']
    for name in which:
        globals()['scen_' + name.replace('-', '_')]()
    print('\n'.join('PASS ' + p for p in passed))
    print('\n'.join('FAIL ' + f for f in failed))
    print(f'{len(passed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)
