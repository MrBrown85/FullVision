"""Prove batch-a-undo.sql: Batch A goes in, is used, and comes out, and the
database is what it was.

    python3 batch_a_undo.py build    load an EMPTY database with everything
                                     but Batch A's four files (README.md,
                                     "Batch A": the same list, and the rest
                                     of S0-M5's sixteen functions)
    python3 batch_a_undo.py          the proof

Live has Batch A, then S0-M5 (search_path, 2026111002), then S0-M4b
(2026110905, the nightly repair and the DIBELS rule, which stands on Batch A
and has its own undo, s0-m4b-undo.sql). That is what every scenario undoes:
"applied" below means the four files, then S0-M5's, then S0-M4b's.

The database named by PGDATABASE is only ever a template: every scenario
runs on a copy of it (named <PGDATABASE>_<scenario>, made and dropped
here), so the proof can be run again and again. The scenarios commit, and
some run other scripts of this folder against their copy.

  main        Before anything: the catalog (catalog.py) and a checksum of
              every table's rows. Everything is applied; a teacher turns the
              student page on, saves, returns and issues cards; a student
              signs in. Then each part in turn:
              PART 1   Batch A's 18 triggers are gone and nothing else;
                       S0-M4b's three are left and listed; what a student is
                       shown afterwards, case by case, in a When I Return
                       Them class and an As Soon As I Save one; what of
                       Batch A still runs; score_rpcs.py passes as with
                       Batch A loaded; a second run takes no lock.
              PART 1A  refused while S0-M4b's repair still runs by itself;
                       after S0-M4b's fast stop it turns the page off.
              PART 1B  the five score-table policies are the ones from
                       before file 01.
              PART 2   stops for S0-M4b, naming its objects, with nothing
                       changed; after S0-M4b's own undo it runs, and the
                       catalog is the one from before Batch A but for S0-M5
                       (left in place), the dropped-column slots on course
                       and the migration record (which the optional last
                       statement clears); rows compared with just before
                       PART 2 and with before Batch A; the suites from
                       before Batch A pass; every part runs again and
                       changes nothing; everything applies again.
  apply-only  Everything applied, then S0-M4b's undo and PART 2 with nothing
              done in between: every row of every table is what it was
              before Batch A. S0-M5's undo before or after.
  partial     Only file 01, files 01-02, files 01-03 applied: PART 1, 1B
              and 2 in turn, and PART 2 alone, take each back out.
  repair      What S0-M4b's nightly repair does to grades saved after
              PART 1, and why PART 1A waits for S0-M4b's fast stop.
  back-on     Both fast stops and PART 1A, saves while it is off, then the
              way back on: the classes on, the repair, file 02 again,
              2026110905 again. The database is line for line as live is.
              And the same without the repair.
  half-way    PART 1 stopped after each of its seven tables, with saves and
              a repair at each point, then run whole.
  page-off    PART 1A (the Student Page off) before PART 1 and at every
              point of it, and after it with S0-M4b's repair still running:
              refused each time.
  fooled      Fourteen things a later migration might build on Batch A:
              PART 2 stops for each before it changes anything, and the
              header's read-only pre-check lists the same; with S0-M4b on
              top and with it undone.
  without     The same script on a database without S0-M4b.
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
S0_M4B = '2026110905_grade_return_limits.sql'           # applied to gradebook-prod after S0-M5, on Nov 10
S0_M4B_UNDO = 'local-test/s0-m4b-undo.sql'
S0_M4B_REF = None                                         # merged (PR 989, f2ee492e): the file that was applied
REPAIR = 'call public.grade_return_repair_nightly()'      # S0-M4b's; what its nightly job runs
JOB = "select count(*) from cron.job where jobname = 'fv_grade_return_repair_daily'"
THEIRS = [['assessment', 'grade_return_mode'], ['assessment', 'grade_return_truncate'], ['enrollment', 'grade_return_truncate']]
S0_M5 = '2026111002_security_definer_search_path.sql'     # applied to gradebook-prod after Batch A, on Nov 10
S0_M5_UNDO = 'local-test/s0-m5-undo.sql'
S0_M5_REF = None                                          # merged (PR 991): its files are in this checkout
SIXTEEN = {'_fv_release_orphan_teacher_email', '_fv_teacher_sign_in_deleted', '_score_audit_diff', '_term_rating_audit_field',
           '_touch_course_sync_cursor', '_touch_course_sync_cursor_from_trigger', '_touch_teacher_sync_cursor_from_trigger',
           'fv_idem_check', 'fv_idem_store', 'fv_owns_assessment', 'fv_owns_course', 'fv_owns_enrollment', 'fv_owns_term_rating',
           'fv_retention_cleanup', 'get_class_bundle', 'rls_auto_enable'}
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
BATCH_A_CALLS = ['return_grades', 'issue_student_cards', 'mark_student_cards_printed', 'unlock_student_card', 'unlock_all_student_cards',
                 'reissue_student_card', 'set_cards_work_until']
TRIGGERS = """select count(*) from pg_trigger where not tgisinternal and tgname in ('grade_return_delete', 'grade_return_insert',
              'grade_return_update', 'grade_return_repoint', 'grade_return_gone', 'grade_return_release')"""     # Batch A's own
LEFT = "select tgrelid::regclass::text, tgname::text from pg_trigger where tgname like 'grade\\_return\\_%' and not tgisinternal order by 1, 2"
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

def text_of(name, ref=None):
    """A file under migrations/, from this checkout or, until its PR is merged, from its branch."""
    path = os.path.join(HERE, '..', name)
    if os.path.exists(path): return open(path).read()
    return subprocess.run(['git', '-C', ROOT, 'show', '%s:migrations/%s' % (ref, name)], capture_output=True, text=True, check=True).stdout

def sections(text=None):
    """{'PART 1': [statements], 'PART 1B': [...], 'PART 2': [...]} of the undo script."""
    text = text or open(os.path.join(HERE, UNDO)).read()
    marks = [(name, text.index('\n-- %s: ' % name)) for name in ('PART 1', 'PART 1A', 'PART 1B', 'PART 2')]
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
def precheck():
    """The read-only query in the script's header: a first row saying whether S0-M4b is on top of
    Batch A, then one row for anything else that would stop PART 2."""
    body = open(os.path.join(HERE, UNDO)).read().split('-- precheck:\n')[1].split('-- end precheck')[0]
    return '\n'.join(l[5:] if l.startswith('--   ') else '' for l in body.splitlines()).strip().rstrip(';')
def listed(d):
    """(what the pre-check says of S0-M4b, [everything else it lists])."""
    r = d.run(precheck())
    return r[0][1], [x[1] for x in r[1:]]
def their_fast_stop():
    """PART 1 of S0-M4b's own undo: its nightly job unscheduled, its three triggers dropped."""
    t = text_of(S0_M4B_UNDO, S0_M4B_REF)
    return split(t[t.index('\n-- PART 1: '):t.index('\n-- PART 2: ')])
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
        self.rows = []
        try:
            for st in sts:
                r = self.c.run(st)
                if bare(st).lower().startswith(('select', 'update')): self.rows = [list(x) for x in (r or [])]
            return 'ok'
        except Exception as e:
            self.c.run('rollback'); return 'STOPPED: ' + message(e)
    def part(self, name): return self.statements(PARTS[name])
    def file(self, name, ref=None):
        return self.statements(split(text_of(name, ref)))
    def apply(self, n=4, s0_m5=True, s0_m4b=True):
        """The first n of Batch A's files and, after all four, S0-M5's and then S0-M4b's, as live has
        them; and their lines in the migration record, as apply_migration writes them."""
        for i, f in enumerate(FILES[:n]):
            r = self.file(f)
            if r != 'ok': return r
            self.c.run("insert into supabase_migrations.schema_migrations (version, name) values (:v, :n)", v='2026111015280%d' % i, n=RECORD[i])
        if n == 4 and s0_m5:
            r = self.file(S0_M5, S0_M5_REF)
            if r != 'ok': return r
            self.c.run("insert into supabase_migrations.schema_migrations (version, name) values ('20261110153700', 'security_definer_search_path') on conflict do nothing")
        if n == 4 and s0_m4b:
            r = self.file(S0_M4B, S0_M4B_REF)
            if r != 'ok': return r
            self.c.run("insert into supabase_migrations.schema_migrations (version, name) values ('20261110171200', 'grade_return_limits') on conflict do nothing")
        return 'ok'
    def s0_m4b_out(self):
        """S0-M4b's own undo (both its parts), and its line out of the record."""
        r = self.file(S0_M4B_UNDO, S0_M4B_REF)
        self.c.run("delete from supabase_migrations.schema_migrations where name = 'grade_return_limits'")
        return r
    def s0_m5_out(self):
        """S0-M5's own undo, and its line out of the record."""
        r = self.file(S0_M5_UNDO, S0_M5_REF)
        self.c.run("delete from supabase_migrations.schema_migrations where name = 'security_definer_search_path'")
        return r
    def their_fast_stop(self): return self.statements(their_fast_stop())
    def back_on(self):
        """File 02 again (Batch A's triggers; it also puts five functions back as Batch A made
        them) and then S0-M4b's file again, as the header says to."""
        r = self.file(FILES[1])
        return r if r != 'ok' else self.file(S0_M4B, S0_M4B_REF)
    def suite(self, script):
        """Another script of this folder, on this copy: its last line."""
        r = subprocess.run([sys.executable, os.path.join(HERE, script)], capture_output=True, text=True, env=dict(os.environ, PGDATABASE=self.name), cwd=HERE)
        self.failures = [l[5:].split(' :: ')[0] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        return (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[-1]
    def close(self):
        self.c.close(); admin('drop database if exists "%s" with (force)' % self.name)

def build():
    c = connect(BASE_DB)
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run('select rolname from pg_roles')}
    for rel in BASE + ['search-path-prelude.sql']:      # the rest of S0-M5's sixteen functions
        n = 0
        for st in split(text_of('local-test/' + rel, S0_M5_REF)):
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
    # pg_cron, as much of it as S0-M4b and the checks here use: its job table, and scheduling by name.
    d.run('create schema cron')
    d.run('create table cron.job (jobname text primary key, schedule text, command text, database text, username text, active boolean default true)')
    d.run("""create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
             $$ insert into cron.job (jobname, schedule, command) values ($1, $2, $3) on conflict (jobname) do update set schedule = $2, command = $3 returning 1::bigint $$""")
    d.run("create function cron.unschedule(job_name text) returns boolean language sql as $$ with gone as (delete from cron.job where jobname = $1 returning 1) select exists (select 1 from gone) $$")
    d.run("insert into cron.job (jobname, schedule, command) values ('fv_retention_cleanup_daily', '0 9 * * *', 'select public.fv_retention_cleanup()')")
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
def s0_m5_and(cat0, cat, also):
    """Nothing differs but S0-M5 (the sixteen functions' definition and settings lines, and its line in
    the migration record) and the lines given."""
    gone, new = trace(cat0, cat)
    fn = lambda l: l.split(' | ')[0].split('(')[0].split('.')[-1]
    sixteen = lambda lines: sorted(fn(l) for l in lines if l.startswith(('function ', 'function more ')))
    rest = sorted(l for l in new if not l.startswith(('function ', 'function more ')))
    return (sixteen(gone) == sorted(list(SIXTEEN) * 2) and sixteen(new) == sorted(list(SIXTEEN) * 2)
            and [l for l in gone if not l.startswith(('function ', 'function more '))] == []
            and rest == sorted(also + ['migration record 20261110153700 | security_definer_search_path']))

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
    ok('the four files apply, then S0-M5 and S0-M4b on top of them, as on live: Batch A\'s 18 triggers, S0-M4b\'s three and its nightly job',
       d.apply() == 'ok' and d.one(TRIGGERS) == 18 and len(d.run(LEFT)) == 21 and d.one(JOB) == 1
       and d.one("select count(*) from pg_proc p where p.prosecdef and p.pronamespace::regnamespace::text in ('public', 'student_submit', 'fv_private') "
                 "and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ 'pg_temp$')") == 0)
    cat1 = catalog(d.c)
    ok('applying them changes no row of any table that was there (%d tables, compared with before Batch A; pg_cron\'s job table is in the catalog instead)' % len(rows0),
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
    ok('PART 1: none of Batch A\'s triggers is left; its last query lists S0-M4b\'s three, which it leaves, and says whose they are',
       d.one(TRIGGERS) == 0 and [r[:2] for r in d.rows] == THEIRS and all('S0-M4b' in r[2] for r in d.rows) and d.run(LEFT) == THEIRS and d.one(JOB) == 1, d.rows)
    gone, new = trace(cat1, catalog(d.c))
    ok('PART 1: nothing else of Batch A is touched: the only catalog lines that differ are its 18 triggers (and the count of what depends on triggers)',
       len([l for l in gone if l.startswith('trigger ')]) == 18 and all(l.startswith(('trigger ', 'depends pg_trigger ')) for l in gone)
       and all(l.startswith('depends pg_trigger ') for l in new), ([l for l in gone if not l.startswith('trigger ')], new))
    gr = grade_rows(d)
    drafts_at_stop = d.teacher('course_draft_count(:c)', c=COURSE)

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

    # Return Grades does not reach a first grade saved after PART 1: there is no row for it to return.
    r = d.teacher('return_grades(:a, :ids::uuid[], :k)', a=new_piece, ids='{%s}' % ENR1, k=nid())
    ok('PART 1: Return Grades on that first grade returns nothing (returned: 0) and the student still sees no result',
       r.get('returned') == 0 and sees(d, k['token'], ENR1).get('Undo new') is None and grade_rows(d) == gr, r)
    ok('PART 1: the teacher\'s draft count and Returned list answer from what was there at the stop: the count is what it was (%d) after four saves, and the list has no line for the new piece' % drafts_at_stop,
       d.teacher('course_draft_count(:c)', c=COURSE) == drafts_at_stop
       and new_piece not in json.dumps(d.teacher('list_course_grade_returns(:c)', c=COURSE)), d.teacher('course_draft_count(:c)', c=COURSE))

    # Turning the Student Page off is what stops students seeing anything: PART 1A. It waits for
    # S0-M4b's fast stop as well (the repair scenario shows why).
    flags = d.run('select id::text, student_page_enabled from course order by 1'); r = d.part('PART 1A')
    ok('PART 1A after PART 1 alone is refused: S0-M4b\'s repair still runs by itself (its nightly job and its grade_return_mode trigger are named); nothing is turned off',
       r.startswith("STOPPED: S0-M4b's repair still runs by itself (the nightly job fv_grade_return_repair_daily is scheduled and the trigger grade_return_mode is in place). ")
       and r.endswith('Nothing was changed.') and d.run('select id::text, student_page_enabled from course order by 1') == flags and grade_rows(d) == gr, r)
    ok('S0-M4b\'s own fast stop (PART 1 of s0-m4b-undo.sql) runs after this one: its job is unscheduled, its three triggers are gone, and PART 1\'s last query then lists nothing',
       d.their_fast_stop() == 'ok' and d.one(JOB) == 0 and d.run(LEFT) == [] and d.part('PART 1') == 'ok' and d.rows == [] and grade_rows(d) == gr, d.rows)
    ok('PART 1A runs once both fast stops are through, and answers with the two classes it turned off',
       d.part('PART 1A') == 'ok' and sorted(str(r[0]) for r in d.rows) == sorted([COURSE, COURSE2]), d.rows)
    off = [sees(d, k['token'], ENR1), sees(d, k['token2'], ENR3), d.service("student_submit.card(:c, 'undo-ip')", c=k['token_code'])]
    ok('PART 1, then PART 1A: the signed-in page and a card scan are both refused, no draft was returned and no row of grade_return changed',
       all(x.get('ok') is False for x in off) and grade_rows(d) == gr, off)
    d.run('update public.course set student_page_enabled = true where id in (:c, :c2)', c=COURSE, c2=COURSE2)
    ok('... and turned on again, students see what they saw', sees(d, k['token'], ENR1) == seen and sees(d, k['token2'], ENR3) == seen2)

    # What of Batch A still runs after PART 1.
    ok('PART 1 leaves file 01\'s five same-class policies: they run on every save until PART 1B',
       d.one("select count(*) from pg_policies where policyname like '%\\_same\\_class'") == 5)
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['lab'], ids='{%s}' % ENR1, k=nid())
    ok('after PART 1, Return Grades still returns a draft that was waiting at the stop: the student sees it (5)',
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
    copy = d.teacher('duplicate_course(:c, :k)', c=COURSE, k=nid())
    ok('after PART 1, Duplicate Class still copies the Return Grades setting, and the slip-code functions still check card codes',
       d.one('select return_grades from course where id = :c', c=str(copy['id'] if isinstance(copy, dict) else copy)) == 'on_return'
       and d.one("select count(*) from pg_proc where proname in ('_issue_access_code', '_issue_report_code') and prosrc like '%student_card%'") == 2, copy)
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
    sixteen_lines = lambda lines: [l for l in lines if l.startswith(('function ', 'function more ')) and l.split(' | ')[0].split('(')[0].split('.')[-1] in SIXTEEN]
    m5_before = sixteen_lines(catalog(d.c))
    idem = d.run("select endpoint from fv_idempotency where endpoint = any (cast(:e as text[])) order by 1", e=BATCH_A_CALLS)
    # S0-M4b is on top (its fast stop was run above; its functions, its changes and its log table are there).
    said, others = listed(d)
    ok('just before PART 2 the header\'s pre-check says S0-M4b is on top of Batch A, and lists nothing else',
       said.startswith('S0-M4b is applied on top of Batch A (') and 'PART 2 will stop until s0-m4b-undo.sql has been run' in said and others == [], (said, others))
    cat_m4b = catalog(d.c); r = d.part('PART 2')
    ok('PART 2 with S0-M4b on top stops before it changes anything: it says S0-M4b is applied and to run its undo first, names what it found of it, and names nothing else',
       r.startswith("STOPPED: S0-M4b (2026110905_grade_return_limits.sql) is applied on top of Batch A. Run S0-M4b's undo first (migrations/local-test/s0-m4b-undo.sql, both its parts), then this. Found of it: ")
       and all(x in r for x in ('names Batch A: function public._grade_return_settle(', 'names Batch A: function public._grade_return_repair_class(', 'table grade_return_repair_log'))
       and 'Something else' not in r and r.endswith('Nothing was changed.') and catalog(d.c) == cat_m4b and row_checksums(d.c, cols0) == sums_before, r)
    ok('S0-M4b\'s own undo runs (both its parts, after PART 1, 1A and 1B here), and the pre-check then says S0-M4b is not on top and lists nothing',
       d.s0_m4b_out() == 'ok' and listed(d) == ('S0-M4b is not on top of Batch A. Any row below is something that would stop PART 2.', []), listed(d))
    ok('S0-M4b\'s undo changed no row of any table that was there before Batch A', row_checksums(d.c, cols0) == sums_before,
       sorted(t for t in sums_before if row_checksums(d.c, {t: cols0[t]})[t] != sums_before[t]))
    m5_before = sixteen_lines(catalog(d.c))
    ok('PART 2 then runs, with S0-M5 applied on top of Batch A', d.part('PART 2') == 'ok')
    cat2 = catalog(d.c)
    ok('PART 2: the catalog is the one from before Batch A, line by line (%d lines), but for S0-M5, which it leaves, and two things it says it leaves' % len(cat0),
       s0_m5_and(cat0, cat2, ['dropped columns public.course | 3'] + ['migration record 2026111015280%d | %s' % (i, n) for i, n in enumerate(RECORD)]),
       trace(cat0, cat2))
    ok('PART 2 leaves S0-M5 exactly as it was: the sixteen functions are line for line what they were just before it, pg_temp last',
       sixteen_lines(cat2) == m5_before and len(m5_before) == 32)
    ok('PART 2 leaves the migration record alone: it still lists the four files as applied', d.one("select count(*) from supabase_migrations.schema_migrations where name = any (cast(:n as text[]))", n=RECORD) == 4)
    d.run(record_statement())
    ok('the optional statement in the header takes those four rows out of the record and no other (three earlier rows and S0-M5\'s stay)',
       s0_m5_and(cat0, catalog(d.c), ['dropped columns public.course | 3']) and d.one('select count(*) from supabase_migrations.schema_migrations') == 4, trace(cat0, catalog(d.c)))
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
    ok('PART 2 leaves the idempotency rows of Batch A\'s own calls (%d here: Return Grades, the card calls): the calls are gone, the rows are harmless' % len(idem),
       len(idem) >= 6 and d.run("select endpoint from fv_idempotency where endpoint = any (cast(:e as text[])) order by 1", e=BATCH_A_CALLS) == idem, idem)
    ok('PART 2: grade_return, student_card, the session tables, fv_private and the three class settings are gone',
       d.one("""select to_regclass('public.grade_return') is null and to_regclass('public.student_card') is null
                       and to_regclass('student_submit.device_session') is null and to_regnamespace('fv_private') is null
                       and not exists (select 1 from information_schema.columns where table_name = 'course'
                                          and column_name in ('student_page_enabled', 'return_grades', 'cards_work_until'))"""))
    cat_after = catalog(d.c)
    ok('PART 2 run again changes nothing', d.part('PART 2') == 'ok' and catalog(d.c) == cat_after)
    ok('PART 1 and PART 1B run after it change nothing either', d.part('PART 1') == 'ok' and d.part('PART 1B') == 'ok' and catalog(d.c) == cat_after)

    # ── The suites from before Batch A ─────────────────────────────────
    # score_rpcs.py makes 183 checks on this database (the score-only one has fewer: this one also loads
    # the functions Batch A patches or copies and the two bundle functions, each compared with its live
    # fingerprint). One of them now fails, and should: it compares the score tables with
    # docs/schema.generated.sql, which describes the live database WITH Batch A, and Batch A has just been
    # taken out. It is the schema snapshot check the header says must be regenerated after PART 2.
    r = d.suite('score_rpcs.py')
    ok('after the undo, score_rpcs.py: 182 of its 183 checks pass as before Batch A; the one that does not is the comparison with the schema snapshot, which still describes the database with Batch A',
       r == '182 passed, 1 failed' and d.failures == ['every score table matches the live snapshot: columns, constraints, indexes, triggers, policies'], (r, d.failures))
    for script, want in (('student_submit.py', '79 passed, 0 failed'),
                         ('questionnaire_identity.py', '47 passed, 0 failed'), ('phone_reports.py', '37 passed, 0 failed'),
                         ('questionnaires.py', '42 passed, 0 failed')):
        r = d.suite(script)
        ok('after the undo, %s passes as before Batch A: %s' % (script, want.split(',')[0]), r == want, r)

    # ── Batch A goes in again ──────────────────────────────────────────
    ok('the four files apply again, with S0-M5 still in place; S0-M5 can be run again after them, and S0-M4b applies again on top', d.apply() == 'ok' and d.one(JOB) == 1)
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
    ok('apply-only: everything applied as on live, then S0-M4b\'s undo and PART 2 with nothing done in between',
       d.apply() == 'ok' and d.part('PART 2').startswith('STOPPED: S0-M4b (') and d.s0_m4b_out() == 'ok' and d.part('PART 2') == 'ok')
    d.run(record_statement())
    ok('apply-only: every row of every table is what it was before Batch A (%d tables; the backfill and its undoing included)' % len(rows0),
       row_checksums(d.c, cols0) == rows0 and table_columns(d.c) == cols0, sorted(t for t in rows0 if row_checksums(d.c, {t: cols0[t]})[t] != rows0[t]))
    ok('apply-only: the catalog is the one from before but for S0-M5, left in place, and the three dropped-column slots',
       s0_m5_and(cat0, catalog(d.c), ['dropped columns public.course | 3']), trace(cat0, catalog(d.c)))
    ok('apply-only: S0-M5 can stay, or go afterwards: its own undo then runs, and the catalog is the one from before both but for the three slots',
       d.s0_m5_out() == 'ok' and dropped_only(cat0, catalog(d.c), 3), trace(cat0, catalog(d.c)))
    d.close()
    # The other order: S0-M5 out first, then Batch A.
    d = Db('applyonly'); seed(d)
    cat0, rows0, cols0 = before(d)
    ok('apply-only, the other order: S0-M5\'s undo first, then S0-M4b\'s, then PART 2: all three run, and the result is the same',
       d.apply() == 'ok' and d.s0_m5_out() == 'ok' and d.s0_m4b_out() == 'ok' and d.part('PART 2') == 'ok' and d.run(record_statement()) is not False
       and dropped_only(cat0, catalog(d.c), 3) and row_checksums(d.c, cols0) == rows0, trace(cat0, catalog(d.c)))
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

# ── repair: S0-M4b's nightly repair after PART 1 ────────────────────────────
ORPHANS = """select count(*) from grade_return g where not exists (select 1 from assessment a where a.id = g.assessment_id)
                                                     or not exists (select 1 from enrollment e where e.id = g.enrollment_id)"""
STALE = """select g.enrollment_id::text, g.assessment_id::text from grade_return g join assessment a on a.id = g.assessment_id
            where a.score_mode <> 'dibels' and g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)"""
def pieces(d, *titles, course=COURSE):
    ids = [nid() for _ in titles]
    for i, t in zip(ids, titles):
        d.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, :t, 'points', 10)", a=i, c=course, t=t)
    return ids
def scen_repair():
    d = Db('repair'); seed(d)
    ok('repair: everything applied and in use', d.apply() == 'ok'); k = use(d)
    gone, = pieces(d, 'Undo gone'); d.teacher('upsert_score(:e, :a, 1)', e=ENR1, a=gone)
    ok('repair: PART 1; S0-M4b\'s nightly job is still scheduled', d.part('PART 1') == 'ok' and d.one(TRIGGERS) == 0 and d.one(JOB) == 1)
    new_piece, = pieces(d, 'Undo new'); save_new, = pieces(d, 'Save new', course=COURSE2)
    d.teacher('upsert_score(:e, :a, 3)', e=ENR1, a=k['quiz']); d.teacher('upsert_score(:e, :a, 5)', e=ENR1, a=k['lab'])
    d.teacher('upsert_score(:e, :a, 18)', e=ENR1, a=k['essay']); d.teacher('upsert_score(:e, :a, 8)', e=ENR1, a=new_piece)
    d.teacher('upsert_score(:e, :a, 2)', e=ENR3, a=k['save_quiz']); d.teacher('upsert_score(:e, :a, 9)', e=ENR3, a=save_new)
    d.run('delete from assessment where id = :a', a=gone)
    drafts = d.teacher('course_draft_count(:c)', c=COURSE)
    pick = lambda seen, *t: {x: seen.get(x, 'no such piece') for x in t}
    b4 = pick(sees(d, k['token'], ENR1), 'Undo quiz', 'Undo new', 'Undo lab', 'Undo essay'); b4s = sees(d, k['token2'], ENR3)
    ok('repair, before it runs: the changed Returned grade is shown (3), the first grades are not, in either class, and the deleted piece left a row behind',
       b4 == {'Undo quiz': 3, 'Undo new': None, 'Undo lab': None, 'Undo essay': 15} and b4s == {'Save quiz': 2, 'Save new': None} and d.one(ORPHANS) == 1, (b4, b4s))
    try: d.run(REPAIR); r = 'ok'
    except Exception as e: r = message(e)
    af = pick(sees(d, k['token'], ENR1), 'Undo quiz', 'Undo new', 'Undo lab', 'Undo essay'); afs = sees(d, k['token2'], ENR3)
    ok('repair: S0-M4b\'s repair runs after PART 1 (what its job does at 10:47 UTC, called by hand here)', r == 'ok', r)
    ok('repair, When I Return Them: the changed Returned grade becomes a draft, so the student is back to the grade they were given (7, having seen 3); the first grade is a Draft, still not shown; the drafts stay hidden',
       af == {'Undo quiz': 7, 'Undo new': None, 'Undo lab': None, 'Undo essay': 15}, af)
    ok('repair, As Soon As I Save: the first grade is Returned and shown (9); the changed one stays as shown (2)', afs == {'Save quiz': 2, 'Save new': 9}, afs)
    ok('repair: the draft count moves by the two it made (the changed grade and the first grade), every working copy is up to date and the row the deleted piece left is gone',
       d.teacher('course_draft_count(:c)', c=COURSE) == drafts + 2 and d.run(STALE) == [] and d.one(ORPHANS) == 0, (drafts, d.teacher('course_draft_count(:c)', c=COURSE)))
    r = d.teacher('return_grades(:a, :ids::uuid[], :k)', a=new_piece, ids='{%s}' % ENR1, k=nid())
    ok('repair: Return Grades now reaches that first grade (returned: 1) and the student sees it (8)', r.get('returned') == 1 and sees(d, k['token'], ENR1).get('Undo new') == 8, r)
    gr = grade_rows(d)
    d.teacher("update_course(:c, :p::jsonb)", c=COURSE, p='{"return_grades": "on_save"}'); d.run(REPAIR)
    ok('repair: a class that leaves When I Return Them after PART 1 keeps its waiting drafts through the repair too: no row changes',
       grade_rows(d) == gr and sees(d, k['token'], ENR1).get('Undo essay') == 15, sees(d, k['token'], ENR1))
    d.teacher("update_course(:c, :p::jsonb)", c=COURSE, p='{"return_grades": "on_return"}')
    # Why PART 1A waits for S0-M4b's fast stop: the page off, and then the repair.
    held, = pieces(d, 'Undo held')
    d.teacher('upsert_score(:e, :a, 6)', e=ENR1, a=held)        # a first grade, in a class that holds grades
    d.teacher('upsert_score(:e, :a, 4)', e=ENR1, a=k['lab'])    # a draft never returned, changed
    d.run('update public.course set student_page_enabled = false where student_page_enabled'); d.run(REPAIR)
    d.run('update public.course set student_page_enabled = true where id in (:c, :c2)', c=COURSE, c2=COURSE2)
    shown = pick(sees(d, k['token'], ENR1), 'Undo held', 'Undo lab')
    ok('repair, why PART 1A is guarded: with the Student Page turned off by a plain UPDATE and the repair run while it is off, a first grade and a changed draft the teacher never returned are made Returned, and shown when the page comes back on (6 and 4)',
       shown == {'Undo held': 6, 'Undo lab': 4}, shown)
    d.close()

# ── back-on: both fast stops and PART 1A, then the way back on ──────────────
def scen_back_on():
    for repair in (True, False):
        d = Db('backon'); seed(d); tag = 'back-on' if repair else 'back-on, without the repair first'
        applied = d.apply(); k = use(d); as_live = catalog(d.c)
        new_piece, = pieces(d, 'Undo new')
        # The two fast stops in either order: this one first, then S0-M4b's first.
        stops = [d.part('PART 1'), d.their_fast_stop()] if repair else [d.their_fast_stop(), d.part('PART 1')]
        stops.append(d.part('PART 1A')); off = [str(r[0]) for r in d.rows]
        ok('%s: everything applied and in use; %s, then PART 1A' % (tag, 'PART 1, then S0-M4b\'s fast stop' if repair else 'S0-M4b\'s fast stop first, then PART 1'),
           applied == 'ok' and stops == ['ok'] * 3 and d.run(LEFT) == [] and d.one(JOB) == 0 and sorted(off) == sorted([COURSE, COURSE2]), stops)
        d.teacher('upsert_score(:e, :a, 3)', e=ENR1, a=k['quiz']); d.teacher('upsert_score(:e, :a, 5)', e=ENR1, a=k['lab'])
        d.teacher('upsert_score(:e, :a, 18)', e=ENR1, a=k['essay']); d.teacher('upsert_score(:e, :a, 8)', e=ENR1, a=new_piece)
        d.teacher('clear_score(:e, :a)', e=ENR2, a=k['quiz'])           # a returned 9, cleared while the triggers are off
        d.run('delete from assessment where id = :a', a=k['save_quiz'])  # a piece with a returned grade, deleted while they are off
        left_behind = d.one(ORPHANS)
        # 0. the classes on again; 1. the repair; 2. file 02 again; 3. 2026110905 again.
        d.run('update public.course set student_page_enabled = true where id = any (cast(:ids as uuid[]))', ids=off)
        if repair: d.run(REPAIR)
        ok('%s: file 02 runs again, and 2026110905 after it: Batch A\'s 18 triggers, S0-M4b\'s three and its job are back' % tag,
           d.back_on() == 'ok' and d.one(TRIGGERS) == 18 and len(d.run(LEFT)) == 21 and d.one(JOB) == 1, d.run(LEFT))
        ok('%s: the catalog is then line for line the one from just after everything was applied: the database is as live is now' % tag,
           differences(as_live, catalog(d.c)) == ([], []), differences(as_live, catalog(d.c)))
        ok('%s: every grade_return row holds the grade as the score tables have it, and the row the deleted piece left behind is gone' % tag,
           d.run(STALE) == [] and left_behind == 1 and d.one(ORPHANS) == 0, (d.run(STALE), left_behind, d.one(ORPHANS)))
        seen = {x: sees(d, k['token'], ENR1).get(x) for x in ('Undo quiz', 'Undo new', 'Undo lab', 'Undo essay')}
        if repair:
            ok('back-on: the student sees nothing the teacher did not return: the changed Returned grade waits as a draft (they see 7), the first grade saved while it was off is a Draft (no result), the two drafts are still drafts (no result; 15)',
               seen == {'Undo quiz': 7, 'Undo new': None, 'Undo lab': None, 'Undo essay': 15}, seen)
            r = d.teacher('return_grades(:a, :ids::uuid[], :k)', a=new_piece, ids='{%s}' % ENR1, k=nid())
            ok('back-on: and Return Grades returns that first grade (8)', r.get('returned') == 1 and sees(d, k['token'], ENR1).get('Undo new') == 8, r)
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['quiz'], ids='{%s}' % ENR1, k=nid())
        else:
            ok('back-on, without the repair first: file 02\'s backfill makes the first grade saved while it was off Returned, so the student sees it at once (8), and the changed Returned grade stays shown (3); the two drafts are still drafts',
               seen == {'Undo quiz': 3, 'Undo new': 8, 'Undo lab': None, 'Undo essay': 15}, seen)
        d.teacher('upsert_score(:e, :a, 1)', e=ENR1, a=k['quiz'])
        ok('%s: and the triggers work again: a change to a Returned grade waits as a draft (the student still sees 3)' % tag, sees(d, k['token'], ENR1).get('Undo quiz') == 3)
        d.close()

# ── half-way ────────────────────────────────────────────────────────────────
def scen_half_way():
    d = Db('halfway'); seed(d)
    ok('half-way: everything applied and in use', d.apply() == 'ok'); k = use(d)
    txs = transactions(PARTS['PART 1'])
    ok('PART 1 is seven transactions, one table each, course first, and one closing query', len(txs) == 8 and all(bare(t[0]).lower() == 'begin' for t in txs[:7])
       and [len(re.findall(r'\bon public\.(\w+);', ' '.join(t))) for t in txs[:7]] == [1, 3, 4, 4, 4, 1, 1]
       and 'public.course' in txs[0][2], len(txs))
    results = []; safe = []
    for stop_after in range(1, 7):
        for t in txs[:stop_after]: d.statements(t)
        mid = d.one(TRIGGERS)
        # Saves at this point, through every score table, by S0-M4b's _grade_return_on_change where a trigger is left.
        title = 'Half %d' % stop_after; np, = pieces(d, title); errors = []
        for call, kw in (('upsert_score(:e, :a, :v)', dict(e=ENR1, a=k['lab'], v=stop_after % 5)), ('upsert_score(:e, :a, 8)', dict(e=ENR1, a=np)),
                         ('upsert_rubric_score(:e, :a, :x, :v, 0::smallint, null, null)', dict(e=ENR1, a=k['rubric'], x=k['c1'], v=1 + stop_after % 4)),
                         ('fill_rubric(:e, :a, :v, 0::smallint)', dict(e=ENR2, a=k['rubric'], v=1 + stop_after % 4)),
                         ("save_score_comment(:e, :a, :t)", dict(e=ENR2, a=k['quiz'], t='half %d' % stop_after)), ('clear_score(:e, :a)', dict(e=ENR2, a=np)),
                         ("update_course(:c, :p::jsonb)", dict(c=COURSE, p=json.dumps({'name': 'Undo class'})))):
            try: d.teacher(call, **kw)
            except Exception as e: errors.append((call, message(e))); d.run('rollback'); d.run('reset role')
        seen = sees(d, k['token'], ENR1)
        try: d.run(REPAIR); repaired = 'ok'
        except Exception as e: repaired = message(e)
        after = sees(d, k['token'], ENR1)
        safe.append((stop_after, errors, [x.get('Undo lab', 'missing') for x in (seen, after)], [x.get(title, 'missing') for x in (seen, after)],
                     [x.get('Undo essay') for x in (seen, after)], repaired))
        results.append((stop_after, mid, d.part('PART 1'), d.one(TRIGGERS), d.back_on(), d.one(TRIGGERS)))
    ok('half-way: stopped after each of its first six tables, PART 1 run again from the top finishes the job (then file 02 and 2026110905 put everything back for the next try)',
       all(r[2] == 'ok' and r[3] == 0 and r[4] == 'ok' and r[5] == 18 for r in results)
       and [r[1] for r in results] == [17, 14, 10, 6, 2, 1], results)
    ok('half-way: at each of those six points every kind of save goes through (points, a rubric criterion, a rubric fill, a comment, a clear, a class setting), by S0-M4b\'s trigger function where a trigger is left',
       all(x[1] == [] for x in safe), [x[1] for x in safe])
    ok('half-way: and at each of them nothing a teacher is holding is shown: the draft never returned and a first grade on a new piece stay hidden, the essay stays as returned (15), before S0-M4b\'s repair and after it is run at that point',
       all(x[2] == [None, None] and x[3] == [None, None] and x[4] == [15, 15] and x[5] == 'ok' for x in safe), safe)
    # A table it cannot get: it gives up on that table and says so; the tables before it are done.
    holder = connect(d.name); holder.run('begin'); holder.run('lock table public.rubric_score in access exclusive mode')
    t0 = time.time(); r = d.part('PART 1'); took = time.time() - t0
    left = d.one(TRIGGERS)
    holder.run('rollback'); holder.close()
    ok('half-way: a table held by another session for good: PART 1 tries 40 times (about twelve seconds), stops with a message naming it, and keeps what it had done',
       r.startswith('STOPPED: PART 1 could not get public.rubric_score in 40 tries') and left == 10 and 8 < took < 20, (r, left, round(took, 1)))
    ok('half-way: and run again once the table is free, it finishes', d.part('PART 1') == 'ok' and d.one(TRIGGERS) == 0)
    # Pasted whole, as the SQL editor sends it: one message, many statements.
    # Its own begin and commit must still make seven transactions of it.
    text = open(os.path.join(HERE, UNDO)).read()
    whole = text[text.index('\n-- PART 1: '):text.index('\n-- PART 1A: ')]
    d.back_on()
    holder = connect(d.name); holder.run('begin'); holder.run('lock table public.rubric_score in access exclusive mode')
    try: d.run(whole); r = 'ok'
    except Exception as e: r = message(e); d.run('rollback')
    left = d.one(TRIGGERS)
    holder.run('rollback'); holder.close()
    ok('half-way: PART 1 sent as ONE message (a paste) is still seven transactions: stopped at the fourth table, the first three are done and stay done',
       r.startswith('PART 1 could not get public.rubric_score') and left == 10, (r, left))
    d.back_on()
    try: d.run(whole); r = 'ok'
    except Exception as e: r = message(e); d.run('rollback')
    ok('half-way: and sent as one message with nothing in its way, it drops all 18 and leaves S0-M4b\'s three', r == 'ok' and d.one(TRIGGERS) == 0 and d.run(LEFT) == THEIRS, r)
    d.close()

# ── without: a database that does not have S0-M4b ───────────────────────────
def scen_without():
    d = Db('without'); seed(d)
    cat0, rows0, cols0 = before(d)
    ok('without S0-M4b: Batch A and S0-M5 only (S0-M4b never applied, or its undo already run), in use', d.apply(s0_m4b=False) == 'ok' and d.one(JOB) == 0); k = use(d)
    ok('without S0-M4b: PART 1 runs and its last query lists nothing', d.part('PART 1') == 'ok' and d.rows == [] and d.run(LEFT) == [])
    ok('without S0-M4b: PART 1A runs straight after it (there is no repair to wait for) and turns the two classes off',
       d.part('PART 1A') == 'ok' and sorted(str(r[0]) for r in d.rows) == sorted([COURSE, COURSE2]), d.rows)
    ok('without S0-M4b: PART 1B runs, and the pre-check says S0-M4b is not on top and lists nothing',
       d.part('PART 1B') == 'ok' and listed(d) == ('S0-M4b is not on top of Batch A. Any row below is something that would stop PART 2.', []), listed(d))
    back = d.part('PART 2'); d.run(record_statement())
    ok('without S0-M4b: PART 2 runs, and the catalog is the one from before Batch A but for S0-M5 (left in place) and the three dropped-column slots',
       back == 'ok' and s0_m5_and(cat0, catalog(d.c), ['dropped columns public.course | 3']), (back, trace(cat0, catalog(d.c))))
    d.close()

# ── page-off: PART 1A at every point of PART 1 ──────────────────────────────
def scen_page_off():
    d = Db('pageoff'); seed(d)
    ok('page-off: everything applied and in use', d.apply() == 'ok'); k = use(d)
    txs = transactions(PARTS['PART 1'])
    drafts = "select count(*) from grade_return where is_draft"
    flags = "select id::text, student_page_enabled from course order by 1"
    check, bare_update = PARTS['PART 1A'][0], PARTS['PART 1A'][-1]
    n_drafts = d.one(drafts)
    # Why it matters: before PART 1, the plain statement returns every waiting draft.
    d.run('begin'); d.run('update public.course set student_page_enabled = false where student_page_enabled')
    returned = n_drafts - d.one(drafts); d.run('rollback')
    ok('page-off, why it is guarded: with Batch A whole, a plain UPDATE turning the page off returns every waiting draft (%d of %d here) to the students' % (returned, n_drafts),
       returned == n_drafts and n_drafts >= 3, (returned, n_drafts))
    stops = []
    for cut in range(0, 7):                       # PART 1 not started, then stopped after each of its first six tables
        for t in txs[:cut]: d.statements(t)
        gr = grade_rows(d); fl = d.run(flags); left = d.one(TRIGGERS)
        r = d.part('PART 1A')
        alone = d.statements([bare_update]); alone_rows = list(d.rows) if alone == 'ok' else alone
        d.run('begin'); d.run('update public.course set student_page_enabled = false where student_page_enabled')
        plain = n_drafts - d.one(drafts); d.run('rollback')
        stops.append((cut, left, r.startswith("STOPPED: Batch A's triggers are not all gone (") and r.endswith('Nothing was changed.'),
                      ('grade_return_release on course' in r) == (cut == 0), alone_rows == [], grade_rows(d) == gr and d.run(flags) == fl, plain))
        d.back_on()
    ok('page-off: with PART 1 not started, and stopped after each of its first six tables, PART 1A refuses, names the triggers that are left, and changes nothing',
       all(x[2] and x[3] and x[5] for x in stops) and [x[1] for x in stops] == [18, 17, 14, 10, 6, 2, 1], stops)
    ok('page-off: its UPDATE pasted alone, without the check above it, turns no class off at any of those points either', all(x[4] for x in stops), stops)
    ok('page-off: course goes first in PART 1, so from its first table on even a plain UPDATE returns no draft; only before PART 1 does it (%d)' % stops[0][6],
       stops[0][6] == n_drafts and all(x[6] == 0 for x in stops[1:]), [x[6] for x in stops])
    # After the whole of PART 1, S0-M4b's repair still runs by itself: its nightly job, its grade_return_mode trigger.
    ok('page-off: the whole of PART 1', d.part('PART 1') == 'ok' and d.one(TRIGGERS) == 0)
    gr = grade_rows(d); fl = d.run(flags)
    said = "STOPPED: S0-M4b's repair still runs by itself (%s). "
    r = d.part('PART 1A'); alone = d.statements([bare_update]); alone_rows = list(d.rows)
    ok('page-off: after PART 1 with S0-M4b\'s fast stop not run, PART 1A refuses, naming its nightly job and its trigger; its UPDATE pasted alone turns no class off; nothing changes',
       r.startswith(said % 'the nightly job fv_grade_return_repair_daily is scheduled and the trigger grade_return_mode is in place') and r.endswith('Nothing was changed.')
       and alone == 'ok' and alone_rows == [] and grade_rows(d) == gr and d.run(flags) == fl, (r, alone_rows))
    d.run("select cron.unschedule('fv_grade_return_repair_daily')")
    r = d.part('PART 1A'); alone = d.statements([bare_update]); alone_rows = list(d.rows)
    ok('page-off: with the job unscheduled by hand but S0-M4b\'s trigger left, it still refuses, naming the trigger alone, and its UPDATE alone turns no class off',
       r.startswith(said % 'the trigger grade_return_mode is in place') and alone_rows == [] and d.run(flags) == fl, (r, alone_rows))
    restored = d.file(S0_M4B, S0_M4B_REF); d.run('drop trigger grade_return_mode on public.assessment')
    r = d.statements([check])
    ok('page-off: with the trigger dropped by hand but the job scheduled, its check still refuses, naming the job alone',
       restored == 'ok' and d.one(JOB) == 1 and r.startswith(said % 'the nightly job fv_grade_return_repair_daily is scheduled') and d.run(flags) == fl, r)
    d.run("update cron.job set active = false where jobname = 'fv_grade_return_repair_daily'")
    ok('page-off: a job that is there but switched off (active false) does not stop it', d.statements([check]) == 'ok')
    d.run("update cron.job set active = true where jobname = 'fv_grade_return_repair_daily'"); d.file(S0_M4B, S0_M4B_REF)
    ok('page-off: after S0-M4b\'s fast stop, PART 1A turns the two classes off and lists them; no draft is returned and no row of grade_return changes',
       d.run(LEFT) == THEIRS and d.their_fast_stop() == 'ok' and d.part('PART 1A') == 'ok'
       and sorted(str(r[0]) for r in d.rows) == sorted([COURSE, COURSE2]) and d.one(drafts) == n_drafts and grade_rows(d) == gr, d.rows)
    ok('page-off: run again it turns nothing off and lists nothing', d.part('PART 1A') == 'ok' and d.rows == [])
    d.close()

# ── fooled: what else stands on Batch A ─────────────────────────────────────
def scen_fooled():
    """Each thing a later migration might have built on Batch A, one at a time: PART 2 must stop
    before it changes anything and name it, and the header's read-only pre-check must list the same."""
    d = Db('fooled'); seed(d)
    ok('fooled: everything applied and in use', d.apply() == 'ok'); k = use(d)
    cases = [
        ('a function that reads student_card and never names grade_return',
         ["create function public.zz_cards(c uuid) returns bigint language plpgsql as $$ begin return (select count(*) from public.student_card k join public.enrollment e on e.id = k.enrollment_id where e.course_id = c); end $$"],
         ['drop function public.zz_cards(uuid)'], 'names Batch A: function public.zz_cards(c uuid)'),
        ('a function that calls return_grades',
         ["create function public.zz_return_all(a uuid) returns jsonb language plpgsql as $$ begin return public.return_grades(a, null, gen_random_uuid()); end $$"],
         ['drop function public.zz_return_all(uuid)'], 'names Batch A: function public.zz_return_all(a uuid)'),
        ('a function that reads course.student_page_enabled',
         ["create function public.zz_on(c uuid) returns boolean language plpgsql as $$ begin return (select student_page_enabled from public.course where id = c); end $$"],
         ['drop function public.zz_on(uuid)'], 'names Batch A: function public.zz_on(c uuid)'),
        ('a trigger on score, named otherwise, whose function calls _grade_copy',
         ["create function public.zz_on_score() returns trigger language plpgsql as $$ begin perform public._grade_copy(new.enrollment_id, new.assessment_id); return null; end $$",
          "create trigger zz_on_score after insert or update on public.score for each row execute function public.zz_on_score()"],
         ['drop trigger zz_on_score on public.score', 'drop function public.zz_on_score()'], 'names Batch A: function public.zz_on_score()'),
        ('a function in another schema that calls student_submit.page',
         ["create schema zz", "create function zz.peek(t text, e uuid) returns jsonb language plpgsql as $$ begin return student_submit.page(t, e, 'x'); end $$"],
         ['drop schema zz cascade'], 'names Batch A: function zz.peek(t text, e uuid)'),
        ('a view over grade_return', ["create view public.zz_drafts as select enrollment_id, assessment_id from public.grade_return where is_draft"],
         ['drop view public.zz_drafts'], 'depends on Batch A: rule _RETURN on view zz_drafts'),
        ('a view over the class setting', ["create view public.zz_on_classes as select id from public.course where student_page_enabled"],
         ['drop view public.zz_on_classes'], 'depends on Batch A: rule _RETURN on view zz_on_classes'),
        ('a SQL-standard function over grade_return (Postgres keeps no text of it to search)',
         ["create function public.zz_n() returns bigint language sql begin atomic select count(*) from public.grade_return; end"],
         ['drop function public.zz_n()'], 'depends on Batch A: function zz_n()'),
        ('a policy on another table that calls fv_owns_score_cell',
         ["create policy zz_pol on public.score_audit for select using (public.fv_owns_score_cell(null, null))"],
         ['drop policy zz_pol on public.score_audit'], 'depends on Batch A: policy zz_pol on table score_audit'),
        ('a foreign key from another table to student_card', ["create table public.zz_fk (card uuid references public.student_card(id))"],
         ['drop table public.zz_fk'], 'depends on Batch A: constraint zz_fk_card_fkey on table zz_fk'),
        ('an index on a class setting', ["create index zz_rg on public.course (return_grades)"], ['drop index public.zz_rg'], 'depends on Batch A: index zz_rg'),
        ('a column added to grade_return and an index added to student_card',
         ["alter table public.grade_return add column zz_note text", "create index zz_card_idx on public.student_card (printed_at)"],
         ['alter table public.grade_return drop column zz_note', 'drop index public.zz_card_idx'], "on Batch A's table, not Batch A's: column grade_return.zz_note"),
        ('another function in fv_private', ["create function fv_private.zz_other() returns int language sql as 'select 1'"],
         ['drop function fv_private.zz_other()'], "in fv_private, not Batch A's: function fv_private.zz_other()"),
        ('a pg_cron job that calls something of Batch A (a stand-in cron.job)',
         ["insert into cron.job (jobname, schedule, command) values ('zz_nightly', '47 10 * * *', 'select public.course_draft_count(null)')"],
         ["delete from cron.job where jobname = 'zz_nightly'"], 'names Batch A: cron job zz_nightly'),
    ]
    for m4b in (True, False):
        # With S0-M4b on top, as live is, PART 2 says both things, each apart; then with S0-M4b undone.
        tag = 'with S0-M4b on top' if m4b else 'with S0-M4b undone'
        if not m4b: ok('fooled: S0-M4b\'s own undo runs', d.s0_m4b_out() == 'ok')
        for what, setup, cleanup, names in cases:
            for st in setup: d.run(st)
            said, others = listed(d)
            cat = catalog(d.c); r = d.part('PART 2')
            head = ("STOPPED: S0-M4b (2026110905_grade_return_limits.sql) is applied on top of Batch A. Run S0-M4b's undo first" if m4b
                    else 'STOPPED: Something else stands on Batch A, and PART 2 would break it or lose it: ')
            ok('fooled, %s: %s: PART 2 stops before it changes anything and names it, apart from S0-M4b, and the pre-check lists the same' % (tag, what),
               r.startswith(head) and r.endswith('Nothing was changed.') and names in r.split('Something else stands on Batch A, and PART 2 would break it or lose it: ')[-1]
               and names in others and all(x in r for x in others) and said.startswith('S0-M4b is applied on top' if m4b else 'S0-M4b is not on top')
               and not any('_grade_return_settle' in x or 'grade_return_repair' in x or 'grade_return_mode' in x or 'grade_return_truncate' in x for x in others)
               and catalog(d.c) == cat, (r[:300], said, others))
            for st in cleanup: d.run(st)
    # What must NOT stop it.
    d.run("create function public.zz_note() returns int language sql as $$ select 1 -- see the grade return notes, and grade_return too $$")
    d.run("create function public.zz_page(page int, done boolean, seen int, card text) returns int language sql as $$ select page + seen /* student_card */ $$")
    ok('fooled: functions that only mention Batch A in a comment, or use the words page, done, seen and card for their own things, are not listed', listed(d)[1] == [], listed(d))
    r = d.part('PART 2')
    ok('fooled: with every one of those taken away again, and the two harmless functions left, PART 2 runs', r == 'ok' and d.one("select to_regclass('public.grade_return') is null"), r)
    ok('fooled: and after it a save still works', d.teacher('upsert_score(:e, :a, 2)', e=ENR1, a=k['quiz']) is not None)
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
        ('a cron job', "insert into cron.job (jobname, schedule, command) values ('fv_x', '* * * * *', 'select 1')", 'cron job '),
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
    ok('the undo script: PART 1 (seven transactions and a query), PART 1A (a check and one UPDATE), PART 1B and PART 2 (one transaction each)',
       [len(transactions(PARTS[p])) for p in ('PART 1', 'PART 1B', 'PART 2')] == [8, 1, 1] and len(PARTS['PART 1A']) == 2
       and bare(PARTS['PART 1A'][1]).lower().startswith('update public.course'))
    which = sys.argv[1:] or ['main', 'apply-only', 'partial', 'repair', 'back-on', 'half-way', 'page-off', 'fooled', 'without', 'notices']
    for name in which:
        globals()['scen_' + name.replace('-', '_')]()
    print('\n'.join('PASS ' + p for p in passed))
    print('\n'.join('FAIL ' + f for f in failed))
    print(f'{len(passed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)
