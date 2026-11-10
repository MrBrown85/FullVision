"""Prove batch-a-undo.sql: Batch A goes in, is used, and comes out, and the
database is what it was.

Unlike most scripts here this one COMMITS, and it runs other scripts against
the same database between its steps, so give it a database built for it
(without the four migrations; README.md, "Batch A: the way back") and
nothing else. It leaves the database with Batch A applied again.

  1. the catalog (catalog.py: every function with its md5, every table,
     column, constraint, index, trigger, policy, grant, comment) and a
     checksum of every table's rows, before anything;
  2. the four files are applied; a teacher turns the student page on, saves,
     returns and issues cards; a student signs in with a card;
  3. PART 1: Batch A's triggers are gone, saves go on working and
     grade_return stops changing; score_rpcs.py passes as it does with
     Batch A loaded (same-class refusals included: file 01's policies stay);
  4. PART 1B: the five score-table policies are the ones from before;
  5. PART 2: the catalog is identical to step 1, line by line; no row of any
     table that was there before has changed, but the sign-in log's card
     rows; the seven patched functions carry their live fingerprints;
  6. the suites from before Batch A pass on it: score_rpcs.py,
     student_submit.py, questionnaire_identity.py, phone_reports.py,
     questionnaires.py;
  7. every part can be run again and changes nothing;
  8. the four files apply again, cleanly, and give the same database as in
     step 2.

PGPORT=54329 PGDATABASE=fv_undo python3 batch_a_undo.py
"""
import os, re, subprocess, sys, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg
from run import split
from catalog import catalog, row_checksums

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['2026110901_score_rows_same_class.sql', '2026110902_grade_return.sql', '2026110903_student_card.sql', '2026110904_student_sessions_page.sql']
A = '11111111-1111-1111-1111-111111111111'
# A class of its own, so the other scripts (which grade in Teacher A's seeded class) find theirs as they expect it.
COURSE_A = 'aaaaaaaa-0000-0000-0000-0000000000dd'
ENR1 = 'eeeeeeee-1111-0000-0000-0000000000d1'; ENR2 = 'eeeeeeee-1111-0000-0000-0000000000d2'
STU1 = 'aaaaaaaa-1111-0000-0000-0000000000d1'; STU2 = 'aaaaaaaa-1111-0000-0000-0000000000d2'
SCORE_TABLES = ['public.score', 'public.tag_score', 'public.rubric_score', 'public.rubric_check_score', 'public.dibels_score']
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:600]))
c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                  database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
nid = lambda: str(uuid.uuid4())
def teacher(sql, **kw):
    c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')
    try: return c.run('select ' + sql, **kw)[0][0]
    finally: c.run('reset role')
def service(sql, **kw):
    c.run('set role service_role')
    try: return c.run('select ' + sql, **kw)[0][0]
    finally: c.run('reset role')
def run_file(path):
    for s in split(open(path).read()): c.run(s)
def parts():
    """The undo's three transactions, each a list of statements with its begin and commit."""
    out, cur = [], None
    for s in split(open(os.path.join(HERE, 'batch-a-undo.sql')).read()):
        word = '\n'.join(l for l in s.splitlines() if not l.strip().startswith('--')).strip().lower()   # comments ride along with a statement
        if word == 'begin': cur = []
        if cur is not None: cur.append(s)
        if word == 'commit': out.append(cur); cur = None
    return out
def run_part(n):
    try:
        for s in PARTS[n]: c.run(s)
    except Exception:
        c.run('rollback'); raise
def suite(script):
    """Another script of this folder, on this database: its last line."""
    r = subprocess.run([sys.executable, os.path.join(HERE, script)], capture_output=True, text=True, env=os.environ, cwd=HERE)
    return (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[-1]
def differ(a, b): return [l for l in a if l not in set(b)][:6] + ['|'] + [l for l in b if l not in set(a)][:6]
def no_attnum(lines): return [re.sub(r'^(column [^|]+\| )\d+ \| ', r'\1', l) for l in lines]
PARTS = parts()
ok('the undo script is three transactions', len(PARTS) == 3, len(PARTS))

# ── 1. Before anything ─────────────────────────────────────────────────
if c.run("select to_regclass('public.grade_return') is not null")[0][0]:
    sys.exit('this database already has Batch A: build one without the four migrations')
c.run("insert into course (id, teacher_id, name) values (:c, :t, 'Undo class') on conflict do nothing", c=COURSE_A, t=A)
c.run("insert into student (id, teacher_id, first_name, last_name) values (:a, :t, 'Una', 'Do'), (:b, :t, 'Dee', 'Do') on conflict do nothing", a=STU1, b=STU2, t=A)
c.run("insert into enrollment (id, student_id, course_id, roster_position) values (:e, :a, :c, 1), (:f, :b, :c, 2) on conflict do nothing", e=ENR1, f=ENR2, a=STU1, b=STU2, c=COURSE_A)
cat0 = catalog(c)
cols0 = {}
for t, col in c.run("""select n.nspname || '.' || k.relname, a.attname from pg_attribute a join pg_class k on k.oid = a.attrelid
                         join pg_namespace n on n.oid = k.relnamespace
                        where n.nspname in ('public', 'student_submit') and k.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by 1, a.attnum"""):
    cols0.setdefault(t, []).append(col)
LIVE = {}
for line in open(os.path.join(HERE, 'live-function-md5.txt')):
    p = line.split()
    if p and not line.startswith('#'): LIVE[p[0]] = p[1]
SEVEN = {'update_course': 'public.update_course(uuid,jsonb)', 'move_rubric_scores': 'public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)',
         'duplicate_course': 'public.duplicate_course(uuid,uuid)', 'import_json_restore': 'public.import_json_restore(jsonb,uuid)'}
def md5(fn): return c.run("select md5(pg_get_functiondef('%s'::regprocedure))" % fn)[0][0]
ok('before: the four functions of the seven that have a live fingerprint on file carry it', all(md5(f) == LIVE[n] for n, f in SEVEN.items()))

# ── 2. Batch A in, and used ────────────────────────────────────────────
for f in FILES: run_file(os.path.join(HERE, '..', f))
cat1 = catalog(c)
ok('the four files apply', cat1 != cat0 and c.run("select count(*) from pg_trigger where tgname like 'grade\\_return\\_%' and not tgisinternal")[0][0] == 18)
quiz, lab = nid(), nid()
c.run("update student set date_of_birth = '2012-05-15' where id = :s", s=STU1)
c.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Undo quiz', 'points', 10), (:b, :c, 'Undo lab', 'points', 5)", a=quiz, b=lab, c=COURSE_A)
teacher("update_course(:c, :p::jsonb)", c=COURSE_A, p='{"student_page_enabled": true, "return_grades": "on_return"}')
teacher('upsert_score(:e, :a, 7)', e=ENR1, a=quiz); teacher('upsert_score(:e, :a, 9)', e=ENR2, a=quiz)
teacher("save_score_comment(:e, :a, 'Good')", e=ENR1, a=quiz)
teacher('return_grades(:a, :ids::uuid[], :k)', a=quiz, ids='{%s,%s}' % (ENR1, ENR2), k=nid())
teacher('upsert_score(:e, :a, 8)', e=ENR1, a=quiz)                                # a draft on a returned grade
teacher('upsert_score(:e, :a, 4)', e=ENR1, a=lab)                                 # a draft never returned
teacher('issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid())
teacher("set_cards_work_until(:c, '2027-06-30'::date, :k)", c=COURSE_A, k=nid())
code = c.run('select code from student_card where enrollment_id = :e and stopped_at is null', e=ENR1)[0][0]
service("student_submit.card(:c, 'undo-ip')", c=code)
token = service("student_submit.verify_card(:c, '2012-05-15', null, null, null, 'undo-ip', false)", c=code)['session_token']
page = service("student_submit.page(:t, :e, 'undo-ip')", t=token, e=ENR1)
service("student_submit.seen(:t, :e, :ids::uuid[], 'undo-ip')", t=token, e=ENR1, ids='{%s}' % quiz)
service("student_submit.card('AAA-AAA', 'undo-ip')")
used = {t: c.run('select count(*) from ' + t)[0][0] for t in ('public.grade_return', 'public.student_card', 'student_submit.device_session')}
ok('Batch A is in use: a returned grade with a draft on it, a draft, cards, a signed-in phone, card rows in the sign-in log',
   page.get('ok') and used['public.grade_return'] == 3 and used['public.student_card'] == 2 and used['student_submit.device_session'] == 1
   and c.run("select count(*) from student_submit.attempt where route = 'card'")[0][0] >= 2
   # by id: the two pieces have one date and may have been made in the same instant, so their order is not fixed
   and {a['id']: a['grade']['value'] if a['grade'] else None for a in page['assessments']} == {quiz: 7, lab: None}, (used, page))

# ── 3. PART 1: the fast stop ───────────────────────────────────────────
run_part(0)
ok('PART 1: none of Batch A\'s triggers is left', c.run("select count(*) from pg_trigger where tgname like 'grade\\_return\\_%' and not tgisinternal")[0][0] == 0)
ok('PART 1: nothing else of Batch A is touched: tables, columns, functions and policies are as they were',
   [l for l in catalog(c) if not l.startswith('trigger ')] == [l for l in cat1 if not l.startswith('trigger ')])
gr = row_checksums(c, {'public.grade_return': ['enrollment_id', 'assessment_id', 'is_draft', 'returned_at', 'returned_copy', 'previous_copy', 'updated_at', 'seen_at', 'working_copy']})
teacher('upsert_score(:e, :a, 3)', e=ENR2, a=lab); teacher('upsert_score(:e, :a, 10)', e=ENR1, a=quiz)
teacher('clear_score(:e, :a)', e=ENR2, a=quiz); teacher("update_course(:c, :p::jsonb)", c=COURSE_A, p='{"return_grades": "on_save"}')
c.run("delete from assessment where id = :a", a=lab)
ok('PART 1: saves, a clear, a setting change and a delete go on working',
   c.run('select value from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=quiz)[0][0] == 10
   and c.run('select count(*) from score where assessment_id = :a', a=lab)[0][0] == 0)
ok('PART 1: and grade_return no longer changes', row_checksums(c, {'public.grade_return': ['enrollment_id', 'assessment_id', 'is_draft', 'returned_at', 'returned_copy', 'previous_copy', 'updated_at', 'seen_at', 'working_copy']}) == gr)
r = suite('score_rpcs.py')
ok('PART 1: score_rpcs.py passes as it does with Batch A loaded, 236 of 236 (every pin of today, and the same-class refusals file 01 still makes)', r == '236 passed, 0 failed', r)
before_again = catalog(c); run_part(0)
ok('PART 1 run again changes nothing', catalog(c) == before_again)

# ── 4. PART 1B: the five policies ──────────────────────────────────────
run_part(1)
pol = lambda lines: [l for l in lines if l.startswith('policy ') and l.split(' | ')[0].split('.')[1] in ('score', 'tag_score', 'rubric_score', 'rubric_check_score', 'dibels_score')]
ok('PART 1B: the five score-table policies are exactly the ones from before file 01', pol(catalog(c)) == pol(cat0) and len(pol(cat0)) == 5, differ(pol(cat0), pol(catalog(c))))
before_again = catalog(c); run_part(1)
ok('PART 1B run again changes nothing', catalog(c) == before_again)

# ── 5. PART 2: the full removal ────────────────────────────────────────
sums_before = row_checksums(c, cols0)
slip_rows = row_checksums(c, {'student_submit.attempt': cols0['student_submit.attempt']})  # all rows, card rows included
c.run("create temp table undo_attempt as select * from student_submit.attempt where route <> 'card'")
kept = c.run("select count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from undo_attempt x")[0]
run_part(2)
cat2 = catalog(c)
ok('PART 2: the catalog is identical to before Batch A, line by line (%d lines)' % len(cat0), cat2 == cat0, differ(cat0, cat2))
sums_after = row_checksums(c, cols0)
changed = sorted(t for t in sums_before if sums_before[t] != sums_after[t])
ok('PART 2: no row of any table that was there before Batch A changed, but the sign-in log (%d tables compared)' % len(sums_before),
   changed == ['student_submit.attempt'], changed)
ok('PART 2: the five score tables are row for row what they were just before it', all(sums_before[t] == sums_after[t] for t in SCORE_TABLES)
   and sums_after['public.score'][0] > 0, {t: sums_after[t] for t in SCORE_TABLES})
left = c.run("select count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from student_submit.attempt x")[0]
ok("PART 2: the sign-in log lost its card rows and nothing else", list(left) == list(kept) and c.run("select count(*) from student_submit.attempt where route = 'card'")[0][0] == 0, (kept, left))
c.run('drop table undo_attempt')
ok('PART 2: the four of the seven with a live fingerprint on file carry it again', all(md5(f) == LIVE[n] for n, f in SEVEN.items()))
ok('PART 2: grade_return, student_card, the session tables, fv_private and the three class settings are gone',
   c.run("""select to_regclass('public.grade_return') is null and to_regclass('public.student_card') is null
                   and to_regclass('student_submit.device_session') is null and to_regnamespace('fv_private') is null
                   and not exists (select 1 from information_schema.columns where table_name = 'course'
                                      and column_name in ('student_page_enabled', 'return_grades', 'cards_work_until'))""")[0][0])
run_part(2)
ok('PART 2 run again changes nothing', catalog(c) == cat0)
run_part(0); run_part(1)
ok('PART 1 and PART 1B run after it change nothing either', catalog(c) == cat0)

# ── 6. The suites from before Batch A ──────────────────────────────────
# score_rpcs.py makes 176 checks on the score-only database and 183 on this one, which also loads the
# five functions Batch A patches or copies, and get_class_bundle and get_gradebook, and compares each with
# its live fingerprint.
for script, want in (('score_rpcs.py', '183 passed, 0 failed'), ('student_submit.py', '79 passed, 0 failed'),
                     ('questionnaire_identity.py', '47 passed, 0 failed'), ('phone_reports.py', '37 passed, 0 failed'),
                     ('questionnaires.py', '42 passed, 0 failed')):
    r = suite(script)
    ok('after the undo, %s passes as before Batch A: %s' % (script, want.split(',')[0]), r == want, r)

# ── 8. Batch A goes in again ───────────────────────────────────────────
for f in FILES: run_file(os.path.join(HERE, '..', f))
cat3 = catalog(c)
ok('the four files apply again, and give the same database as the first time (the three class settings are new columns again, so their position differs)',
   no_attnum(cat3) == no_attnum(cat1), differ(no_attnum(cat1), no_attnum(cat3)))
n = c.run('select count(*) from grade_return')[0][0]
ok('and the backfill makes every grade there is Returned again (the line between Draft and Returned was lost with the undo)',
   n == c.run("""select count(distinct (enrollment_id, assessment_id)) from score where value is not null or nullif(btrim(comment), '') is not null""")[0][0]
   and c.run('select count(*) from grade_return where is_draft')[0][0] == 0 and n > 0, n)

print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
