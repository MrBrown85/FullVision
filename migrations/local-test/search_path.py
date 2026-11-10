"""Exercise migrations/2026111002_security_definer_search_path.sql (S0-M5):
sixteen SECURITY DEFINER functions get pg_temp named last in their
search_path, and nothing else about them changes.

    python3 search_path.py build     load an EMPTY database in the order
                                     production will be in: the harness,
                                     Batch A's four files, S0-M4's file
    python3 search_path.py           the checks

`build` reads each file from this checkout, or, while PR 966 (Batch A) and
PR 985 (S0-M4) are not merged, from their branches with `git show` (it
prints which). The checks:

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
import json, os, subprocess, sys, threading, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
MIGRATION = '../2026111002_security_definer_search_path.sql'
BATCH_A = ['../2026110901_score_rows_same_class.sql', '../2026110902_grade_return.sql',
           '../2026110903_student_card.sql', '../2026110904_student_sessions_page.sql']
S0_M4 = '../2026111001_assessment_created_at_in_bundle.sql'
# Until they are merged, their files are read from here.
REFS = ['origin/batch-a-grade-return-cards-sessions', 'origin/s0-m4-bundle-sends-created-at']
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

def build():
    c = connect()
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run("select rolname from pg_roles")}
    made = set()
    for rel in BUILD:
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

if __name__ == '__main__' and sys.argv[1:] == ['build']:
    build(); sys.exit(0)
