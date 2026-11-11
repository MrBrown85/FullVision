"""Exercise migrations/2026111103_student_page_fields.sql (S4-M1): what a
student's page can also be told. The file replaces two functions,
student_submit.page and student_submit._session_classes, and nothing else.

    python3 student_page_fields.py build          load an EMPTY database as gradebook-prod
                                                  is now: everything card_codes_common.LIVE
                                                  loads, then S3-M1. No S4-M1.
    python3 student_page_fields.py                every scenario
    python3 student_page_fields.py same todo      or only some
    python3 student_page_fields.py fingerprints   print the two fingerprints the file leaves,
                                                  measured here; with `write`, put them in
                                                  the files that carry them

The database named by PGDATABASE is only ever a template: each scenario
runs on a copy of it (<PGDATABASE>_<scenario>, made and dropped here), so
this can be run again and again though the scenarios commit.

HOW "NOTHING ABOUT GRADES CHANGES" IS SHOWN. Before the file is applied to
a scenario's copy, the two functions as live has them are kept beside the
new ones under other names (page_old, _session_classes_old: their
definitions as pg_get_functiondef prints them, with only the names
changed). After that, one statement asks both for the same page, and the
new reply with the new keys taken out must be the old reply: every key,
every value, a number compared as it is printed. A new key that is not
there fails the comparison.

  apply    The file's shape. The read-only queries written for the live
           database (s4-m1-live-precheck.sql, s4-m1-live-postcheck.sql),
           run here before and after, and what each notices. Each check
           stops the file with nothing changed. The apply on a database in
           use: the only catalog lines that differ are the two functions',
           no row of any table changes, a signed-in phone stays signed in.
           What it does when a table is held. A second run changes nothing;
           a run after one of the two functions was changed again stops.
  same     Old reply against new, and the To Do count three ways, on a class
           that uses every kind of work and every new key: after every step
           of every case in tests/fixtures/grade-state-cases.json, for both
           students; through 300 random saves, clears, returns, statuses
           and setting changes; with a returned piece's scoring changed and
           things deleted; and for every refusal. A class whose page is off
           is compared too (the switch is turned on for the comparison and
           put back).
  fields   Each new key: what it holds, when it is null or empty, and that a
           key reads only its own class.
  todo     The To Do count: what counts, that a draft never moves it, that it
           is the count shared/student-view.js gives (To Do plus Missing:
           the real file, run in node on the database's replies, here and
           for every page of `same`), and that it follows the class's own
           time zone.
  privacy  What the two functions read: the tables they name, the columns
           they must not, and that nothing a teacher keeps to themselves or
           that belongs to another student is anywhere in a reply.
  grants   Who can run the two functions, on a copy where a new function is
           runnable by everyone unless something says otherwise. Temporary
           tables cannot stand in for the real ones.
  batchb   With Batch B's two files (students send work) applied before
           this one, and after it. Needs those files: in this checkout once
           Batch B is merged, or in a checkout named by BATCH_B_DIR.
  suites   The older suites that run on a database with S3-M1, before the
           file and with it applied: the same result.
  cost     How long one page takes before and after, for a session of one,
           two and four classes. Printed, with a loose ceiling.

PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields.py build
PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields.py
"""
import copy, random, shutil, threading, time
from card_codes_common import *
import card_codes_common as cc

MIGRATION = '../2026111103_student_page_fields.sql'
# student_page_fields_mutate.py runs the suite against a changed copy of the file.
USED = os.environ.get('S4_M1_FILE') or MIGRATION
MUTATED = USED != MIGRATION
UNDO = 's4-m1-undo.sql'
PRECHECK_FILE = 's4-m1-live-precheck.sql'
POSTCHECK_FILE = 's4-m1-live-postcheck.sql'
LIVE_NOW = cc.LIVE + ['../2026111003_card_codes_keyed.sql']
PAGE = 'student_submit.page(text,uuid,text)'
CLASSES = 'student_submit._session_classes(uuid)'
READER = 'student_submit._returned_grade(uuid,uuid)'
SESSION_CLASS = 'student_submit._session_class(text,uuid)'
# As gradebook-prod has them. All four were on the list s3-m1-live-precheck.sql compared with the live
# database when the orchestrator ran it, read-only, on 2026-11-10, and none was among the three it
# listed as different (README, "S3-M1"); S3-M1 itself changed none of them.
LIVE_MD5 = {PAGE: 'e744f2a27bcfd6fef662bbddeb9659c7', CLASSES: '6ef848f90721affa406d2b7fef89d285',
            READER: '21706ae9eec783107d9da24e52e1855a', SESSION_CLASS: '1ae94981ff32f804d12079a24bd7b41a'}
# Where Batch B's files are: this checkout once it is merged, or another one.
B_DIR = os.environ.get('BATCH_B_DIR') or os.path.join(HERE, '..', '..')
B_FILES = [os.path.join(B_DIR, 'migrations', 'local-test', 'storage-stand-in.sql'),
           os.path.join(B_DIR, 'migrations', '2026111101_student_work_submissions.sql'),
           os.path.join(B_DIR, 'migrations', '2026111102_student_work_storage.sql')]
HAVE_B = all(os.path.exists(p) for p in B_FILES)

# The keys the file adds, by where they sit in a page reply.
NEW_COURSE = ['teacher_name']
NEW_CLASS = ['to_do']
NEW_TAG = ['i_can']
NEW_CRITERION = ['tag_ids']
NEW_ASSESSMENT = ['description', 'module_name', 'category_name', 'category_percent', 'core_competencies']
# And the keys a reply had before, which is all it may have besides.
OLD_TOP = {'ok', 'v', 'expires_at', 'student', 'course', 'classes', 'tags', 'rubrics', 'assessments'}
OLD_COURSE = {'name', 'block', 'grading_system', 'grading_scale', 'level_order', 'round_percent'}
OLD_CLASS = {'enrollment_id', 'student', 'course'}
OLD_TAG = {'label', 'code'}
OLD_RUBRIC = {'id', 'name', 'style', 'criteria'}
OLD_CRITERION = {'id', 'name', 'weight', 'checks'} | {'level_%d_%s' % (n, w) for n in (1, 2, 3, 4) for w in ('value', 'descriptor')}
OLD_ASSESSMENT = {'id', 'title', 'date', 'due_date', 'created_at', 'score_mode', 'max_points', 'weight', 'rubric_id', 'tag_ids',
                  'status', 'returned_at', 'updated_at', 'seen_at', 'grade', 'previous'}
CORE = [('COM', 'Communicating'), ('COL', 'Collaborating'), ('CT', 'Creative Thinking'), ('CRT', 'Critical & Reflective Thinking'),
        ('PPI', 'Personal & Cultural Identity'), ('PAR', 'Personal Awareness & Responsibility'), ('SAR', 'Social Awareness & Responsibility')]
ROW = re.compile(r"\('(student_submit\.[^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32}|@\w+@)'\)")

def build():
    c = connect(cc.BASE_DB)
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run('select rolname from pg_roles')}
    for rel in LIVE_NOW:
        n = 0
        for st in split(text_of(rel)):
            words = st.split('\n')[-1].split()
            if rel == 'harness.sql' and words[:2] == ['create', 'role'] and words[2] in roles: continue   # roles belong to the whole server
            if any(w in bare(st) for w in cc.NOT_IN_THE_STAND_IN.get(rel, ())): continue
            try: c.run(st)
            except Exception as e: sys.exit('FAILED in %s:\n%s\n-> %s' % (rel, st[:300], e))
            n += 1
        print('%s: %d statements' % (rel, n))
    c.close()

# ── The file's fingerprints ─────────────────────────────────────────────────
def recorded(text):
    """{signature: (as live has it, as the file leaves it)}, read from the file's first check."""
    return {m.group(1): (m.group(2), m.group(3)) for m in ROW.finditer(text)}

def measured(text):
    """{signature: md5} of the two functions as this text's own create statements make them, on a copy of the template."""
    d = Db('fp')
    try:
        for st in split(text):
            if bare(st).lower().startswith('create or replace function'): d.run(st)
        return fingerprints(d, [PAGE, CLASSES])
    finally:
        d.close()

def restamp(text, was, now):
    """The text with each fingerprint in `was` ({signature: md5}) replaced by the one in `now`."""
    for sig, old in was.items():
        if old != now[sig]: text = text.replace(old, now[sig])
    return text

TEXT = text_of(USED)
STATEMENTS = split(TEXT)
PRE1, PRE2 = split(text_of(PRECHECK_FILE))       # the two read-only queries for the live database, before
POST, = split(text_of(POSTCHECK_FILE))            # and the one after
BECOMES = {sig: v[1] for sig, v in recorded(TEXT).items()}
TODAY = None

# ── A scenario's copy ───────────────────────────────────────────────────────
def exact(text):
    """A reply as text, parsed with every number kept as it is printed (7 and 7.0 differ)."""
    return json.loads(text, parse_int=str, parse_float=str)

class PageDb(Db):
    def apply(self): return self.statements(STATEMENTS)
    def unapply(self): return self.file(UNDO)
    def keep_old(self):
        """The two functions as they are now, kept under other names. page_old calls _session_classes_old."""
        for sig, name in ((CLASSES, '_session_classes'), (PAGE, 'page')):
            text = self.one('select pg_get_functiondef(:s::regprocedure)', s=sig)
            head = 'FUNCTION student_submit.%s(' % name
            assert text.count(head) == 1, text[:200]
            text = text.replace(head, 'FUNCTION student_submit.%s_old(' % name)
            if name == 'page':
                call = "_session_classes((_in->>'session_id')::uuid)"
                assert text.count(call) == 1
                text = text.replace(call, call.replace('_session_classes(', '_session_classes_old('))
            self.run(text)
    def both(self, token, e):
        """(the new reply, the old reply) for one page, asked in one statement, each exactly as printed."""
        r = self.c.run("select student_submit.page(:t, :e, 'ip-1')::text, student_submit.page_old(:t, :e, 'ip-1')::text", t=token, e=e)[0]
        self.new_text = r[0]
        return exact(r[0]), exact(r[1])
    def session(self, enrollment, birthday='2012-05-15', course=COURSE_A, teacher=A, token=None, add=False):
        """A card made for the student and a phone signed in with it: the session token."""
        code, _pw, _row = self.make(enrollment, course, teacher)
        r = self.verify(code, birthday=birthday, token=token, add=add)
        assert r.get('ok'), r
        self.last_verify = r
        return r['session_token'] or token

def without_new(page):
    """A good reply with the keys this file adds taken out. A key that is not there is a failure, said in the result."""
    p = copy.deepcopy(page)
    try:
        for k in NEW_COURSE: p['course'].pop(k)
        for c in p['classes']:
            for k in NEW_CLASS: c.pop(k)
        for t in p['tags'].values():
            for k in NEW_TAG: t.pop(k)
        for r in p['rubrics']:
            for cr in r['criteria']:
                for k in NEW_CRITERION: cr.pop(k)
        for a in p['assessments']:
            for k in NEW_ASSESSMENT: a.pop(k)
    except KeyError as e:
        return {'a new key is missing': str(e)}
    return p

def waiting(page):
    """The To Do count as shared/student-view.js works it out from a reply: counts.toDo + counts.missing.
    build() leaves a DIBELS benchmark out; a piece is 'missing' when marked Missing, 'excused' when
    Excused, 'back' when it has a return date, and 'due' otherwise."""
    n = 0
    for a in page['assessments']:
        if a['score_mode'] == 'dibels': continue
        kind = 'missing' if a['status'] == 'NS' else 'excused' if a['status'] == 'EXC' else 'back' if a['returned_at'] else 'due'
        n += kind in ('due', 'missing')
    return n

def js_counts(texts):
    """What the real shared/student-view.js counts for each reply (texts: replies as the database printed
    them): build()'s { toDo, sent, back, missing }, from student_view_counts.mjs. None where there is no node."""
    node = shutil.which('node')
    if not node: return None
    r = subprocess.run([node, os.path.join(HERE, 'student_view_counts.mjs')], input='[' + ','.join(texts) + ']', capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit('student_view_counts.mjs failed: ' + r.stderr[-400:])
    return json.loads(r.stdout)

def js_agrees(queue, label):
    """queue: (where, a reply's text, the to_do the database sent for that reply's own class). One check:
    the real student-view.js counts To Do plus Missing as that to_do, for every one."""
    counts = js_counts([q[1] for q in queue])
    if counts is None:
        print('SKIPPED %s: node is not on the PATH, so shared/student-view.js itself was not run (the same rule, written out in this file, was)' % label); return
    wrong = [(q[0], q[2], c) for q, c in zip(queue, counts) if c['toDo'] + c['missing'] != q[2]]
    ok("%s: for each of those %d pages the real shared/student-view.js, run in node on the database's own reply, counts To Do plus Missing as the to_do the database sent"
       % (label, len(queue)), not wrong and len(counts) == len(queue) and len(queue) > 0, wrong[:3])

def from_tables(d, e):
    """The To Do count read straight from the tables, as the owner, not through any function under test:
    the listed pieces that take a grade, marked Missing or not Excused and never returned. A DIBELS
    piece is left out before its row is looked at, so its dormant row is not read."""
    return int(d.one("""
        select count(*) from enrollment en join course c on c.id = en.course_id join assessment a on a.course_id = c.id
         where en.id = :e and a.score_mode <> 'dibels'
           and (a.date_assigned is null or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
           and (coalesce((select s.status from score s where s.enrollment_id = en.id and s.assessment_id = a.id), '') = 'NS'
                or (coalesce((select s.status from score s where s.enrollment_id = en.id and s.assessment_id = a.id), '') <> 'EXC'
                    and not exists (select 1 from grade_return g where g.enrollment_id = en.id and g.assessment_id = a.id
                                       and g.returned_at is not null)))""", e=e))

class Compare:
    """One comparison, for each page of the session: the new reply with its new keys taken out is the
    old reply; and the To Do count beside the page's own class is the count student-view.js gives for
    that reply, and the count read straight from the tables. Counts what was compared and keeps the
    differences."""
    pages = 0; differences = 0                    # over the whole run
    queue = []                                    # every page compared, for the real student-view.js: js_agrees
    def __init__(self, d, sessions):
        self.d = d; self.sessions = sessions; self.n = 0; self.good = 0; self.opened = 0; self.bad = []
    def once(self, where):
        d = self.d
        for token, e in self.sessions:
            new, old = d.both(token, e)
            self.n += 1
            if new.get('ok') is not True:
                if new != old: self.bad.append((where, e[-4:], 'refusal', new, old))
                if new == old and new == {'ok': False, 'error': 'closed'}:
                    # The class's page is off: turn it on for the comparison alone, with every trigger asleep
                    # so that no grade's state moves, and put everything back.
                    d.run('savepoint closed')
                    d.run("set local session_replication_role = 'replica'")
                    d.run('update course set student_page_enabled = true')
                    new, old = d.both(token, e)
                    self.opened += 1
                    self._full(where + ' (page off)', e, new, old)
                    d.run('rollback to savepoint closed')
                continue
            self._full(where, e, new, old)
    def _full(self, where, e, new, old):
        if new.get('ok') is not True or old.get('ok') is not True:
            self.bad.append((where, e[-4:], 'not a page', new, old)); return
        self.good += 1; Compare.pages += 1; was = len(self.bad)
        cut = without_new(new)
        if cut != old:
            diff = [k for k in set(cut) | set(old) if cut.get(k) != old.get(k)]
            self.bad.append((where, e[-4:], 'differs in', diff, [(cut.get(k), old.get(k)) for k in diff][:1]))
        mine = [c for c in new['classes'] if c['enrollment_id'] == e]
        want = waiting(json.loads(json.dumps(new)))
        if len(mine) != 1 or mine[0]['to_do'] != str(want) or want != from_tables(self.d, e):
            self.bad.append((where, e[-4:], 'to_do', mine, want, from_tables(self.d, e)))
        Compare.queue.append((where, self.d.new_text, int(mine[0]['to_do']) if len(mine) == 1 else None))
        Compare.differences += len(self.bad) > was

# ── The class the scenarios use ─────────────────────────────────────────────
def build_class(d, course=COURSE_A):
    """batch_a_common.build_class: two competencies and a two-criterion Advanced Rubric, under the names
    the grade-state cases use. With what this file reads: I Can statements, and the competencies each
    criterion counts toward."""
    k = {n: nid() for n in ('subj', 'sect', 't1', 't2', 'r1', 'c1', 'c2', 'k1', 'k2')}
    d.run("insert into subject (id, course_id, name) values (:s, :c, 'Science')", s=k['subj'], c=course)
    d.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Questioning')", x=k['sect'], c=course, s=k['subj'])
    d.run("""insert into tag (id, section_id, label, code, i_can_text, i_can_statements, source_text) values
             (:t1, :x, 'Ask questions', 'Q1', 'WORDING-NOT-SENT', array['I can ask a question that can be tested.', 'I can say what I expect to happen.'], 'SOURCE-NOT-SENT'),
             (:t2, :x, 'Plan a fair test', 'Q2', null, '{}', null)""", t1=k['t1'], t2=k['t2'], x=k['sect'])
    d.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report', 'advanced')", r=k['r1'], c=course)
    d.run("insert into criterion (id, rubric_id, name, display_order) values (:c1, :r, 'Method', 0), (:c2, :r, 'Conclusion', 1)",
          c1=k['c1'], c2=k['c2'], r=k['r1'])
    d.run("insert into criterion_check (id, criterion_id, level, label) values (:k1, :c1, 3, 'Lists every step'), (:k2, :c2, 3, 'Answers the question')",
          k1=k['k1'], c1=k['c1'], k2=k['k2'], c2=k['c2'])
    d.run('insert into criterion_tag (criterion_id, tag_id) values (:c1, :t1), (:c1, :t2), (:c2, :t2)', c1=k['c1'], c2=k['c2'], t1=k['t1'], t2=k['t2'])
    return k

def new_assessment(d, k, work, course=COURSE_A, title=None, date_assigned=None, **more):
    """An assessment of one of the cases' kinds (competencies, rubric, points, dibels) or 'complete' or
    'overall'. more: any other column of assessment."""
    a = nid()
    mode = work if work in ('points', 'dibels', 'complete') else 'proficiency'
    d.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id, date_assigned)
             values (:a, :c, :t, :m, :p, :r, :d)""",
          a=a, c=course, t=title or (work.capitalize() + ' work'), m=mode, p=10 if work == 'points' else None,
          r=k['r1'] if work == 'rubric' else None, d=date_assigned)
    if work == 'competencies':
        d.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :t1), (:a, :t2)', a=a, t1=k['t1'], t2=k['t2'])
    for col, val in more.items():
        d.run('update assessment set %s = :v%s where id = :a' % (col, '::text[]' if col == 'core_competency_ids' else ''), v=val, a=a)
    return a

def set_class(d, student_page, return_grades, course=COURSE_A):
    d.run('update course set student_page_enabled = :s, return_grades = :r where id = :c', s=student_page, r=return_grades, c=course)

def state(d, e, a):
    r = d.all('select is_draft, returned_at from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
    if not r: return 'none'
    return 'draft' if r[0][0] else ('returned' if r[0][1] is not None else 'none')

def do(d, step, e, a, K, students):
    """One step of a grade-state case, as grade_return.py does it."""
    kind = step['do']
    if kind == 'level':
        d.teacher('upsert_tag_score(:e, :a, :t, :v, :m::smallint, :c)', e=e, a=a, t=K[step['tag']], v=step['value'], m=step.get('modifier', 0), c=step.get('comment'))
    elif kind == 'criterion':
        d.teacher('upsert_rubric_score(:e, :a, :x, :v, :m::smallint, :c, :b)', e=e, a=a, x=K[step['criterion']], v=step['value'],
                  m=step.get('modifier', 0), c=step.get('comment'), b=step.get('beyond'))
    elif kind == 'score':
        d.teacher('upsert_score(:e, :a, :v, :m::smallint)', e=e, a=a, v=step['value'], m=step.get('modifier', 0))
    elif kind == 'tick':
        d.teacher('set_rubric_check(:e, :a, :k, :on)', e=e, a=a, k=K[step['check']], on=step['on'])
    elif kind == 'comment':
        d.teacher('save_score_comment(:e, :a, :t)', e=e, a=a, t=step['text'])
    elif kind == 'note':
        d.teacher('save_score_report_note(:e, :a, :t, :k)', e=e, a=a, t=step['text'], k=nid())
    elif kind == 'status':
        d.teacher('set_score_status(:e, :a, :s)', e=e, a=a, s=step['status'])
    elif kind == 'clear':
        d.teacher('clear_score(:e, :a)', e=e, a=a)
    elif kind == 'return':
        who = [students[x] for x in step['students']] if 'students' in step else [e]
        d.teacher('return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ','.join(who), k=nid())
    elif kind == 'seen':
        d.run("""insert into grade_return (enrollment_id, assessment_id, seen_at) values (:e, :a, clock_timestamp())
                 on conflict (enrollment_id, assessment_id) do update set seen_at = excluded.seen_at""", e=e, a=a)
    elif kind == 'class':
        d.teacher('update_course(:c, :p::jsonb)', c=COURSE_A, p=json.dumps({'student_page_enabled': step['student_page'], 'return_grades': step['return_grades']}))
    elif kind == 'move_rubric':
        for n in ('r2', 'c3', 'c4', 'k3', 'k4'): K[n] = nid()
        d.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report (copy)', 'advanced')", r=K['r2'], c=COURSE_A)
        d.run("insert into criterion (id, rubric_id, name, display_order) values (:a, :r, 'Method', 0), (:b, :r, 'Conclusion', 1)", a=K['c3'], b=K['c4'], r=K['r2'])
        d.run("insert into criterion_check (id, criterion_id, level, label) values (:a, :x, 3, 'Lists every step'), (:b, :y, 3, 'Answers the question')",
              a=K['k3'], x=K['c3'], b=K['k4'], y=K['c4'])
        d.run('insert into criterion_tag (criterion_id, tag_id) values (:c3, :t1), (:c4, :t2)', c3=K['c3'], c4=K['c4'], t1=K['t1'], t2=K['t2'])
        d.run('update assessment set rubric_id = :r where id = :a', r=K['r2'], a=a)
        d.teacher('move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=a, r=K['r2'],
                  m=json.dumps({K['c1']: K['c3'], K['c2']: K['c4']}), k=json.dumps({K['k1']: K['k3'], K['k2']: K['k4']}), key=nid())
    elif kind == 'delete':
        table = {'criterion': 'criterion', 'tag': 'tag', 'check': 'criterion_check'}[step['what']]
        d.role('authenticated', 'delete from %s where id = :i' % table, uid=A, i=K[step['id']])
    else:
        raise ValueError(kind)

def seed(d):
    """Teacher A's Science 8 with the Student Page on, a Letter-and-Proficiency class with two weighted
    categories, two modules, a class of competencies and a rubric, and one piece of every kind. Both of
    its students can sign in. Teacher A's second class holds the first student too. Teacher B's class
    has things of its own that must never show in Teacher A's."""
    global TODAY
    TODAY = d.one("select (now() at time zone 'America/Vancouver')::date::text")
    d.run("update teacher set display_name = 'Ms. Okafor' where id = :t", t=A)
    d.run("update teacher set display_name = 'TEACHER-B-NAME' where id = :t", t=B)
    d.run("update student set preferred_name = 'CeCe', date_of_birth = '2012-05-15' where id = :s", s=STU1)
    d.run("update student set date_of_birth = '2012-06-16', student_number = '700123', email = 'marcus@example.com', pronouns = 'he/him' where id = :s", s=STU2)
    d.run("update student set date_of_birth = '2011-01-31' where teacher_id = :t", t=B)
    d.run("update course set student_page_enabled = true, return_grades = 'on_return'")
    d.run("update course set grading_system = 'both', block = 'C', description = 'COURSE-DESCRIPTION-NOT-SENT', late_work_policy = 'LATE-POLICY-NOT-SENT' where id = :c", c=COURSE_A)
    k = build_class(d)
    k.update({n: nid() for n in ('course2', 'enr_a2', 'tests', 'projects', 'unit1', 'unit2', 'sect_gone', 't_gone', 'b_cat', 'b_mod', 'b_subj', 'b_sect', 'b_tag')})
    d.run("insert into course (id, teacher_id, name, block, student_page_enabled, return_grades) values (:c, :t, 'Socials 8', 'B', true, 'on_return')", c=k['course2'], t=A)
    d.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=k['enr_a2'], s=STU1, c=k['course2'])
    d.run("insert into category (id, course_id, name, weight, display_order) values (:a, :c, 'Tests', 40, 0), (:b, :c, 'Projects', 60, 1)", a=k['tests'], b=k['projects'], c=COURSE_A)
    d.run("insert into module (id, course_id, name, display_order) values (:a, :c, 'Unit 1: Cells', 0), (:b, :c, 'Unit 2: Energy', 1)", a=k['unit1'], b=k['unit2'], c=COURSE_A)
    # A competency taken off the class: its section is removed, and it stays linked to work and to a criterion.
    d.run("insert into section (id, course_id, subject_id, name, removed_at) values (:x, :c, :s, 'Removed', now())", x=k['sect_gone'], c=COURSE_A, s=k['subj'])
    d.run("insert into tag (id, section_id, label, code, i_can_statements) values (:t, :x, 'REMOVED-COMPETENCY', 'RX', array['I CAN OF A REMOVED COMPETENCY'])", t=k['t_gone'], x=k['sect_gone'])
    d.run('insert into criterion_tag (criterion_id, tag_id) values (:c, :t)', c=k['c2'], t=k['t_gone'])
    # Teacher B's class: a category, a module and a competency of its own.
    d.run("insert into category (id, course_id, name, weight) values (:a, :c, 'TEACHER-B-CATEGORY', 100)", a=k['b_cat'], c=COURSE_B)
    d.run("insert into module (id, course_id, name) values (:a, :c, 'TEACHER-B-MODULE')", a=k['b_mod'], c=COURSE_B)
    d.run("insert into subject (id, course_id, name) values (:s, :c, 'Socials')", s=k['b_subj'], c=COURSE_B)
    d.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Evidence')", x=k['b_sect'], c=COURSE_B, s=k['b_subj'])
    d.run("insert into tag (id, section_id, label, code, i_can_statements) values (:t, :x, 'TEACHER-B-COMPETENCY', 'BX', array['TEACHER-B-I-CAN'])", t=k['b_tag'], x=k['b_sect'])
    day = lambda n: d.one('select (:d::date + :n::int)::text', d=TODAY, n=n)
    k['a_comp'] = new_assessment(d, k, 'competencies', title='Density Lab', date_assigned=day(-10), due_date=day(-8), category_id=k['tests'], module_id=k['unit1'],
                                 description='Find the density of three liquids.', core_competency_ids='{CT,COM}', display_order=3)
    k['a_rub'] = new_assessment(d, k, 'rubric', title='Lab Report', date_assigned=day(-5), category_id=k['projects'], module_id=k['unit2'], display_order=2,
                                evidence_type='EVIDENCE-TYPE-NOT-SENT', collab_mode='pairs', collab_config='{"groups": [["Marcus Lee", "Cece Adeyemi"]]}')
    k['a_pts'] = new_assessment(d, k, 'points', title='Quiz 1', date_assigned=day(-3), description='', display_order=1)
    k['a_done'] = new_assessment(d, k, 'complete', title='Safety Contract', date_assigned=day(-2), category_id=k['tests'], display_order=1)
    k['a_overall'] = new_assessment(d, k, 'overall', title='Class Discussion')                      # no date: listed as soon as it exists
    k['a_future'] = new_assessment(d, k, 'points', title='Pop Quiz', date_assigned=day(1), category_id=k['tests'])
    k['a_dibels'] = new_assessment(d, k, 'dibels', title='Fall Benchmark', date_assigned=day(-1), category_id=k['tests'], module_id=k['unit1'])
    k['a_same_day'] = new_assessment(d, k, 'points', title='Quiz 2', date_assigned=day(-3), display_order=0)   # the same date as Quiz 1, ordered before it
    d.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :t)', a=k['a_comp'], t=k['t_gone'])
    k['b_assess'] = nid()
    d.run("insert into assessment (id, course_id, title, description, category_id, module_id) values (:a, :c, 'TEACHER-B-ASSESSMENT', 'TEACHER-B-DESCRIPTION', :k, :m)",
          a=k['b_assess'], c=COURSE_B, k=k['b_cat'], m=k['b_mod'])
    k['c2_assess'] = nid()
    d.run("insert into assessment (id, course_id, title, date_assigned) values (:a, :c, 'Map Skills', :d)", a=k['c2_assess'], c=k['course2'], d=day(-1))
    return k

def sign_in(d, k):
    """Both students of Science 8 signed in, the first with Socials 8 added to the same session."""
    tok1 = d.session(ENR1)
    tok1 = d.session(k['enr_a2'], course=k['course2'], token=tok1, add=True)
    tok2 = d.session(ENR2, birthday='2012-06-16')
    return tok1, tok2

def ready(tag, old=True):
    """A copy with the class seeded, the old functions kept and the file applied."""
    d = PageDb(tag); k = seed(d)
    if old: d.keep_old()
    r = d.apply()
    if r != 'ok':
        d.close(); raise SystemExit('the file does not apply: ' + r)
    return d, k

def catalog_and_rows(d): return catalog(d.c), row_checksums(d.c)
def one_page(d, token, e): return json.loads(d.c.run("select student_submit.page(:t, :e, 'ip-1')::text", t=token, e=e)[0][0])
def by_id(page): return {a['id']: a for a in page['assessments']}

# ════════════════════════════════════════════════════════════════════════════
def scen_apply():
    lines = [bare(s).lower() for s in STATEMENTS]
    ok('apply: the file is one transaction: begin first, a five-second lock timeout next, commit last',
       lines[0] == 'begin' and lines[1] == "set local lock_timeout = '5s'" and lines[-1] == 'commit' and lines.count('begin') == 1 and lines.count('commit') == 1)
    ok('apply: its first step after that is the check, before anything is made', lines[2].startswith('do $guard$'))
    made = [l.split('(')[0].split()[-1] for l in lines if l.startswith('create')]
    ok('apply: it makes two functions and nothing else: no table, column, index, trigger or policy; it drops and deletes nothing',
       made == ['student_submit._session_classes', 'student_submit.page'] and all(l.startswith('create or replace function') for l in lines if l.startswith('create'))
       and not any(re.match(r'(drop|alter|delete|update|insert|truncate)\b', l) for l in lines), made)
    ok('apply: the fingerprints it carries for the two functions as live has them are the ones recorded from live',
       {s: v[0] for s, v in recorded(TEXT).items()} == {PAGE: LIVE_MD5[PAGE], CLASSES: LIVE_MD5[CLASSES]}, recorded(TEXT))

    d = PageDb('apply')
    try:
        k = seed(d)
        before_md5 = fingerprints(d, [PAGE, CLASSES, READER, SESSION_CLASS])
        ok('apply: the template has the four functions with the fingerprints gradebook-prod has', before_md5 == LIVE_MD5, before_md5)
        tok1, tok2 = sign_in(d, k)
        d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=k['a_pts'])
        d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_pts'], ids='{%s}' % ENR1, k=nid())
        d.teacher('upsert_score(:e, :a, 9)', e=ENR1, a=k['a_pts'])                       # a draft over the returned grade
        d.teacher('upsert_score(:e, :a, 4)', e=ENR2, a=k['a_pts'])                       # a draft, never returned
        page_before = d.page(tok1, ENR1)

        # ── The two read-only queries written for the live database ─────
        ok('apply: the pre-check lists nothing on the database as live is', d.all(PRE1) == [], d.all(PRE1))
        counts = d.all(PRE2)
        ok('apply: its second query answers with fourteen counts and nothing else: here 3 classes with the page on, none with an unnamed teacher, '
           '2 descriptions (both in classes with the page on), 6 pieces in a category of which 4 would carry a percent, no class off 100, 4 in a module, '
           '1 with Core Competencies, 2 competencies with an I Can statement and 1 without, 2 rubric rows linked, no link across classes, 2 phones signed in',
           counts == [[3, 0, 2, 2, 6, 4, 0, 4, 1, 2, 1, 2, 0, 2]], counts)
        # The columns and types the pre-check expects are the live snapshot's (docs/schema.generated.sql, which CI
        # compares with gradebook-prod), and the columns are the ones the file's own check names.
        listed = re.findall(r"\('(\w+)', '(\w+)', '([a-z\[\] ]+)'\)", PRE1.split('columns(tbl, col, type) as (values')[1].split(')\nselect')[0])
        snapshot = open(os.path.join(HERE, '..', '..', 'docs', 'schema.generated.sql')).read()
        def live_type(tbl, col):
            block = snapshot.split('\ntable public.%s ' % tbl)[1].split('\ntable ')[0]
            m = re.search(r'^  %s (.+?)(?: not null| default |$)' % re.escape(col), block, re.M)
            return m.group(1) if m else None
        guarded = re.findall(r"\('(\w+)', '(\w+)'\)", TEXT.split('from (values (')[1].split(') as x(tbl, col)')[0].join(['(', '']))
        ok('apply: the %d columns the pre-check lists are the ones the file itself checks for, each with the type the snapshot of the live database gives it' % len(listed),
           len(listed) == 20 and sorted((t, c) for t, c, _ in listed) == sorted(guarded) and all(live_type(t, c) == ty for t, c, ty in listed),
           [(t, c, ty, live_type(t, c)) for t, c, ty in listed if live_type(t, c) != ty] or (sorted(guarded), sorted((t, c) for t, c, _ in listed)))
        both_new = sorted(['function ' + PAGE, 'function ' + CLASSES])
        ok('apply: before the apply the post-check lists the two functions and nothing else', sorted(r[0] for r in d.all(POST)) == both_new, d.all(POST))

        # ── Each check stops it with nothing changed ────────────────────
        def on_copy(setup, look):
            """A copy of this database with one thing done to it: what `look` finds there."""
            c = PageDb('apply_guard', template=d.name)
            try:
                for st in setup: c.run(st)
                return look(c)
            finally:
                c.close()
        def stopped_by(setup, want):
            """On such a copy the file stops at its first check and changes nothing."""
            def look(c):
                cat, rows = catalog_and_rows(c)
                r = c.apply()
                return r.startswith('STOPPED') and want in r and c.at == 2 and catalog_and_rows(c) == (cat, rows), r
            return on_copy(setup, look)
        pre = lambda setup: on_copy(setup, lambda c: [[r[0], r[3][:3].strip()] for r in c.all(PRE1)])
        lang = {r[0]: r[1] for r in d.all("""select p.oid::regprocedure::text, l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
                                              join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('student_submit', 'public')""")}
        d.c.close()                                                                      # a template can have no session in it
        def retouched(sig):
            """One space more in a function's body: after the first begin of a PL/pgSQL one, the first select of an SQL one."""
            word = 'select' if lang[sig.replace('public.', '')] == 'sql' else 'begin'
            return ["""do $$ declare _d text := pg_get_functiondef('%s'::regprocedure);
                       begin execute regexp_replace(_d, '\\m%s\\M', '%s '); end $$""" % (sig, word, word)]
        for sig, word in ((PAGE, 'written against'), (CLASSES, 'written against'), (READER, 'tested against'), (SESSION_CLASS, 'tested against')):
            got = stopped_by(retouched(sig), '%s is not the definition this migration was %s' % (sig, word))
            ok('apply: with one space more in %s the file stops and nothing is changed' % sig, got[0], got[1])
            ok('apply: and the pre-check lists %s, and says the file would stop' % sig, pre(retouched(sig)) == [['function ' + sig, 'yes']], pre(retouched(sig)))
        got = pre(retouched('public._grade_copy(uuid,uuid)'))
        ok('apply: a function the reader of a grade calls, changed: the pre-check lists it and says the file would not stop', got == [['function public._grade_copy(uuid,uuid)', 'no']], got)
        got = pre(['alter table public.module alter column name type varchar(80)'])
        ok('apply: a column the new lines read, with another type: the pre-check lists it', got == [['column module.name', 'no']], got)
        got = pre(['alter table public.teacher rename column display_name to shown_name'])
        ok('apply: a column that is not there: the pre-check lists it and says the file would stop', got == [['column teacher.display_name', 'yes']], got)
        got = pre(['grant execute on function student_submit.page(text, uuid, text) to authenticated'])
        ok('apply: page runnable by signed-in teachers: the pre-check lists it', len(got) == 1 and got[0][0].startswith('who can run student_submit.page'), got)
        got = stopped_by(['drop function student_submit.page(text, uuid, text)'], 'found absent')
        ok('apply: with page missing it stops', got[0], got[1])
        got = stopped_by(['drop function student_submit.issue_cards(uuid, uuid, jsonb, text, uuid)'], 'S3-M1 is not applied')
        ok('apply: without S3-M1 it stops and says so', got[0], got[1])
        got = stopped_by(['drop procedure public.grade_return_repair_nightly()', 'drop function public._grade_return_repair_class(uuid) cascade'], 'S0-M4b is not applied')
        ok('apply: without S0-M4b it stops and says so', got[0], got[1])
        got = stopped_by(['alter function public.fv_owns_course(uuid) set search_path = public'], 'S0-M5 is not applied')
        ok('apply: without S0-M5 it stops and says so', got[0], got[1])
        got = stopped_by(['drop table student_submit.device_session_enrollment'], 'Batch A is not all applied')
        ok('apply: without Batch A it stops and says so', got[0], got[1])
        for tbl, col in (('teacher', 'display_name'), ('tag', 'i_can_statements'), ('assessment', 'core_competency_ids'), ('category', 'weight'), ('module', 'name')):
            got = stopped_by(['alter table public.%s rename column %s to %s_renamed' % (tbl, col, col)], 'a column the new lines read is not there: %s.%s' % (tbl, col))
            ok('apply: with %s.%s not there it stops and names it (page is PL/pgSQL: it would otherwise fail only when a student opened their page)' % (tbl, col), got[0], got[1])
        d.c = connect(d.name)

        # ── A table held whole by something else ────────────────────────
        o = d.other(); o.run('begin'); o.run('lock table public.assessment in access exclusive mode')
        t0 = time.time(); r = d.apply(); took = time.time() - t0
        ok('apply: while another session holds a table it names whole, the file gives up after five seconds with nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < took < 9 and fingerprints(d, [PAGE, CLASSES]) == {PAGE: LIVE_MD5[PAGE], CLASSES: LIVE_MD5[CLASSES]}, (r, took))
        o.run('rollback')
        o.run('begin'); o.run("update assessment set title = title where id = :a", a=k['a_pts'])     # an ordinary save, not committed

        # ── The apply ───────────────────────────────────────────────────
        d.keep_old()
        cat0, rows0 = catalog_and_rows(d)
        t0 = time.time(); r = d.apply(); took = time.time() - t0
        o.run('rollback'); o.close()
        ok('apply: the file applies, at once, while a teacher is in the middle of a save', r == 'ok' and took < 3, (r, took))
        cat1, rows1 = catalog_and_rows(d)
        gone, came = differences(cat0, cat1)
        names = lambda ls: sorted({l.split(' | ')[0] for l in ls})
        want = sorted(['function student_submit._session_classes(p_session_id uuid)', 'function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)',
                       'function more student_submit._session_classes(p_session_id uuid)', 'function more student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)'])
        ok('apply: of about %d catalog lines, the only ones that differ are the two functions\' own (their text): %d lines' % (len(cat0), len(came)),
           names(gone) == want and names(came) == want and len(gone) == 4 and len(came) == 4, (names(gone), names(came)))
        def but_text(line):
            f = line.split(' | ')
            if line.startswith('function more '): f[14] = '-'      # md5 of the body
            else: f[2] = '-'                                        # md5 of the definition
            return f
        ok('apply: and of those lines only the text differs: owner, grants, language, STABLE, SECURITY DEFINER, search_path, result and arguments are as they were',
           sorted(map(but_text, gone)) == sorted(map(but_text, came)), (gone, came))
        ok('apply: no row of any table changes', rows1 == rows0, [t for t in rows0 if rows0[t] != rows1.get(t)])
        after_md5 = fingerprints(d, [PAGE, CLASSES, READER, SESSION_CLASS])
        ok('apply: the reader of a grade and the session check are untouched', (after_md5[READER], after_md5[SESSION_CLASS]) == (LIVE_MD5[READER], LIVE_MD5[SESSION_CLASS]))
        if not MUTATED:
            ok('apply: the two functions have the fingerprints the file says it leaves', {PAGE: after_md5[PAGE], CLASSES: after_md5[CLASSES]} == BECOMES, (after_md5, BECOMES))
            ok('apply: those are the fingerprints its own create statements make on a clean copy of the template', measured(TEXT) == BECOMES)
        page_after = d.page(tok1, ENR1)
        ok('apply: a phone signed in before the apply is still signed in, and its page is what it was with the new keys added',
           page_after.get('ok') is True and without_new(page_after) == page_before, page_after if page_after.get('ok') is not True else '')
        ok('apply: the second student too', d.page(tok2, ENR2).get('ok') is True)
        if not MUTATED:
            ok('apply: after the apply the post-check lists nothing', d.all(POST) == [], d.all(POST))
            pre_after = [[r[0], r[3][:3].strip()] for r in d.all(PRE1)]
            ok('apply: run after the apply by mistake, the pre-check lists the two functions (it is for before)',
               sorted(pre_after) == sorted([['function ' + PAGE, 'yes'], ['function ' + CLASSES, 'yes']]), pre_after)
            d.c.close()
            post = lambda setup: on_copy(setup, lambda c: sorted(r[0] for r in c.all(POST)))
            got = post(['grant execute on function student_submit._session_classes(uuid) to service_role'])
            ok('apply: the post-check notices the helper opened to the service role', len(got) == 1 and got[0].startswith('who can run student_submit._session_classes'), got)
            got = post(['grant execute on function student_submit.page(text, uuid, text) to anon'])
            ok('apply: and page opened to anon (two lines: who can run it, and which functions of the schema anon can run)',
               len(got) == 2 and got[0].startswith('functions in student_submit that anon') and got[1].startswith('who can run student_submit.page'), got)
            got = post(retouched(PAGE) + retouched('student_submit.seen(text,uuid,uuid[],text)'))
            ok("apply: and a function changed since, the migration's own or one it left alone", got == sorted(['function ' + PAGE, 'function student_submit.seen(text,uuid,uuid[],text)']), got)
            got = post(['alter function student_submit.page(text, uuid, text) set search_path = public, student_submit'])
            ok('apply: and page without pg_temp in its search_path', len(got) == 3 and any(g.startswith('SECURITY DEFINER functions without') for g in got), got)
            d.c = connect(d.name)
            pairs = lambda text: re.findall(r"\('(student_submit\.(?:page\(text,uuid,text\)|_session_classes\(uuid\)))',\s*'([0-9a-f]{32})'", text)
            undo_first, undo_last = text_of(UNDO).split('do $final$')
            ok("apply: the pre-check carries the fingerprints live has for the two functions; the post-check and the undo's first check the ones this file leaves; the undo's last check live's again",
               dict(pairs(text_of(PRECHECK_FILE))) == {PAGE: LIVE_MD5[PAGE], CLASSES: LIVE_MD5[CLASSES]} and dict(pairs(text_of(POSTCHECK_FILE))) == BECOMES
               and dict(pairs(undo_first)) == BECOMES and dict(pairs(undo_last)) == {PAGE: LIVE_MD5[PAGE], CLASSES: LIVE_MD5[CLASSES]},
               (pairs(text_of(PRECHECK_FILE)), pairs(text_of(POSTCHECK_FILE)), pairs(undo_first), pairs(undo_last)))

        # ── A second run ────────────────────────────────────────────────
        r = d.apply()
        ok('apply: a second run applies', r == 'ok', r)
        ok('apply: and changes no catalog line and no row', catalog_and_rows(d) == (cat1, rows1))
        for st in retouched(PAGE): d.run(st)
        cat2 = catalog(d.c)
        r = d.apply()
        ok('apply: a run after page was changed again (a later migration, or by hand) stops and puts nothing back',
           r.startswith('STOPPED') and 'is not the definition this migration was written against' in r and catalog(d.c) == cat2, r)
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def decorate(d, k, a, n):
    """Give a case's piece the things the new keys read, a different mix each time."""
    cols = {'description': ['Show your steps.', '', None][n % 3], 'category_id': [k['tests'], k['projects'], None][n % 3],
            'module_id': [k['unit1'], None, k['unit2']][n % 3], 'core_competency_ids': ['{CT}', '{}', '{SAR,COM,PPI}', '{CRT,COL,PAR}'][n % 4]}
    for col, val in cols.items():
        d.run('update assessment set %s = :v%s where id = :a' % (col, '::text[]' if col == 'core_competency_ids' else ''), v=val, a=a)

def scen_same():
    d, k = ready('same')
    try:
        tok1, tok2 = sign_in(d, k)
        sessions = [(tok1, ENR1), (tok2, ENR2), (tok1, k['enr_a2'])]
        doc = json.load(open(os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'grade-state-cases.json')))
        ok('same: the cases file is format 1 and has cases', doc.get('format') == 1 and len(doc['cases']) >= 40, len(doc['cases']))
        students = {'s1': ENR1, 's2': ENR2}

        # ── The seeded class before any grade ───────────────────────────
        with tx(d):
            c = Compare(d, sessions); c.once('nothing graded')
            ok('same: on the seeded class, nothing graded, the new reply without its new keys is the old reply and each To Do count is right, for each of the three pages', not c.bad and c.good == 3, c.bad[:2])

        # ── Every case, every step, both students ───────────────────────
        total = Compare(d, sessions); ran = 0; dibels = 0
        for n, case in enumerate(doc['cases']):
            with tx(d):
                set_class(d, case['class']['student_page'], case['class']['return_grades'])
                d.run("update course set grading_system = :g where id = :c", g=['both', 'letter', 'proficiency'][n % 3], c=COURSE_A)
                K = build_class(d)
                a = new_assessment(d, K, case['work'], date_assigned=TODAY if n % 2 else None)
                decorate(d, k, a, n)
                c = Compare(d, sessions); c.once('start'); checks = 0
                for i, step in enumerate(case['steps']):
                    if 'do' in step:
                        do(d, step, students[step.get('student', 's1')], a, K, students)
                        c.once('step %d (%s)' % (i + 1, step['do']))
                    else:
                        # The case's own check, so this run is known to be in the state the case means.
                        e = students[step['expect'].get('for', 's1')]
                        checks += state(d, e, a) == step['expect']['state']
                expected = sum(1 for s in case['steps'] if 'expect' in s)
                ok('same: case: %s: after every step the old reply and the new one agree and the To Do count is right (%d comparisons, %d of them with the page turned on to look)'
                   % (case['name'], c.n + c.opened, c.opened), not c.bad and c.good >= 3 and checks == expected, (c.bad[:2], checks, expected))
                total.n += c.n; total.good += c.good; total.opened += c.opened; ran += 1; dibels += case['work'] == 'dibels'
        ok('same: all %d cases ran, the DIBELS one among them: %d comparisons of a whole page in all, none different' % (ran, total.good),
           ran == len(doc['cases']) and dibels >= 1 and total.good > 600, (ran, dibels, total.good))

        # ── A seeded random run (student_page.py's, on all three kinds of work) ──
        with tx(d):
            rng = random.Random(20261111)
            K = build_class(d)
            work = {'points': new_assessment(d, K, 'points', title='Run: points', date_assigned=TODAY),
                    'competencies': new_assessment(d, K, 'competencies', title='Run: competencies', date_assigned=TODAY),
                    'rubric': new_assessment(d, K, 'rubric', title='Run: rubric', date_assigned=TODAY)}
            for n, a in enumerate(work.values()): decorate(d, k, a, n)
            set_class(d, True, 'on_return')
            c = Compare(d, sessions); drafts = 0; returns = 0; hidden = 0
            for n in range(300):
                kind = rng.choice(list(work)); a = work[kind]; e = rng.choice([ENR1, ENR1, ENR2])
                act = rng.choice(['save', 'save', 'save', 'save', 'comment', 'clear', 'return', 'return', 'status', 'note', 'setting', 'seen', 'system', 'unlink'])
                if act == 'save' and kind == 'points':
                    d.teacher('upsert_score(:e, :a, :v)', e=e, a=a, v=rng.choice([None, 0, 4, 7, 10]))
                elif act == 'save' and kind == 'competencies':
                    d.teacher('upsert_tag_score(:e, :a, :t, :v, :m::smallint, :c)', e=e, a=a, t=rng.choice([K['t1'], K['t2']]), v=rng.choice([0, 1, 2, 3, 4]),
                              m=0, c=rng.choice([None, None, '', 'Say more']))
                elif act == 'save':
                    if rng.random() < 0.3:
                        d.teacher('set_rubric_check(:e, :a, :k, :on)', e=e, a=a, k=rng.choice([K['k1'], K['k2']]), on=rng.random() < 0.6)
                    else:
                        d.teacher('upsert_rubric_score(:e, :a, :x, :v, 0::smallint, :c, :b)', e=e, a=a, x=rng.choice([K['c1'], K['c2']]), v=rng.choice([0, 1, 2, 3, 4]),
                                  c=rng.choice([None, None, '', 'Work on this']), b=rng.choice([None, None, '', 'Went beyond']))
                elif act == 'comment':
                    d.teacher('save_score_comment(:e, :a, :t)', e=e, a=a, t=rng.choice(['', 'Good', 'See me', None]))
                elif act == 'clear':
                    d.teacher('clear_score(:e, :a)', e=e, a=a)
                elif act == 'return':
                    returns += state(d, e, a) == 'draft'
                    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % e, k=nid())
                elif act == 'status':
                    d.teacher('set_score_status(:e, :a, :s)', e=e, a=a, s=rng.choice(['NS', 'EXC', 'LATE', None]))
                elif act == 'note':
                    d.teacher('save_score_report_note(:e, :a, :t, :k)', e=e, a=a, t=rng.choice(['', 'a note']), k=nid())
                elif act == 'setting':
                    roll = rng.random()
                    if roll < 0.6: set_class(d, True, 'on_return')
                    elif roll < 0.75: set_class(d, False, 'on_return')
                    else: set_class(d, True, rng.choice(['on_save', None]))
                elif act == 'seen':
                    d.service("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=tok1 if e == ENR1 else tok2, e=e, ids='{%s}' % a)
                elif act == 'system':
                    d.run('update course set grading_system = :g where id = :c', g=rng.choice(['both', 'letter', 'proficiency']), c=COURSE_A)
                elif act == 'unlink':
                    # A competency taken off the class, or put back: what was returned for it stops being sent.
                    d.run('update section set removed_at = case when removed_at is null then now() end where id = :x', x=K['sect'])
                drafts += sum(state(d, x, y) == 'draft' for x in (ENR1, ENR2) for y in work.values())
                hidden += d.one("select count(*) from score where status in ('NS', 'EXC') and assessment_id = any (:a::uuid[])", a='{%s}' % ','.join(work.values()))
                c.once('random step %d (%s on %s)' % (n, act, kind))
            ok('same: through 300 random saves, comments, clears, returns, statuses, setting changes, opens, and competencies removed and put back, the old reply and the new one agree every time, and so does the To Do count (%d comparisons)'
               % (c.n + c.opened), not c.bad and c.good > 700, c.bad[:2])
            ok('same: the run really held drafts (%d seen waiting), returned grades (%d returns) and Missing or Excused marks (%d seen)' % (drafts, returns, hidden),
               drafts > 150 and returns > 10 and hidden > 50, (drafts, returns, hidden))

        # ── A piece whose scoring is changed after it was returned ──────
        with tx(d):
            K = build_class(d)
            c = Compare(d, sessions)
            whole = new_assessment(d, K, 'overall', title='Scored as a whole', date_assigned=TODAY, category_id=k['tests'])
            d.teacher('upsert_score(:e, :a, 3, 1::smallint)', e=ENR1, a=whole)
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=whole, ids='{%s}' % ENR1, k=nid()); c.once('an Overall level returned')
            d.run("update assessment set score_mode = 'points', max_points = 10 where id = :a", a=whole); c.once('then scored in points')
            d.run("update assessment set score_mode = 'dibels', max_points = null where id = :a", a=whole); c.once('then a DIBELS benchmark')
            d.run("update assessment set score_mode = 'complete' where id = :a", a=whole); c.once('then Complete or Incomplete')
            d.run("update assessment set score_mode = 'proficiency', rubric_id = :r where id = :a", r=K['r1'], a=whole); c.once('then on a rubric')
            d.run('delete from rubric where id = :r', r=K['r1']); c.once('and the rubric deleted')
            d.run('delete from category where id = :c', c=k['projects']); c.once('a category deleted')
            d.run('delete from module where id = :m', m=k['unit1']); c.once('a module deleted')
            d.run('delete from assessment where id = :a', a=k['a_comp']); c.once('a piece deleted')
            d.run("update student set preferred_name = '  ' where id = :s", s=STU1); c.once('a preferred name of spaces')
            ok('same: with a returned piece changed to points, to DIBELS, to Complete, to a rubric, the rubric then deleted, a category, a module and a piece deleted, and a blank preferred name: the old reply and the new one agree each time, and so does the To Do count (%d comparisons)' % c.n,
               not c.bad and c.good == 30, c.bad[:2])

        # ── Every refusal ───────────────────────────────────────────────
        with tx(d):
            def refusal(label, want, token=tok1, e=ENR1):
                new, old = d.both(token, e)
                ok('same: %s: both answer %s and nothing more' % (label, want), new == old == {'ok': False, 'error': want}, (new, old))
            refusal('a token that names no session', 'signed_out', token='f' * 64)
            refusal('a malformed token', 'signed_out', token='nope')
            refusal('no token', 'signed_out', token=None)
            refusal("a class that is not in this session (another student's)", 'not_found', e=ENR2)
            refusal("a class of another teacher's", 'not_found', e=ENR_B)
            refusal('no class', 'not_found', e=None)
            d.run('savepoint r'); d.run('update course set student_page_enabled = false where id = :c', c=COURSE_A)
            refusal("the class's Student Page turned off", 'closed'); d.run('rollback to savepoint r')
            d.run('savepoint r'); d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
            refusal('the student withdrawn', 'not_found'); d.run('rollback to savepoint r')
            d.run('savepoint r'); d.run('update course set deleted_at = now() where id = :c', c=COURSE_A)
            refusal('the class deleted', 'not_found'); d.run('rollback to savepoint r')
            d.run('savepoint r'); d.run("update student_card set works_until = current_date - 2 where enrollment_id = :e", e=ENR1)
            refusal('the card past its last day', 'card_expired'); d.run('rollback to savepoint r')
            d.run('savepoint r'); d.make(ENR1)
            refusal('the card replaced', 'card_stopped'); d.run('rollback to savepoint r')
            d.run('savepoint r'); d.run('update student_submit.device_session set expires_at = now() - interval \'1 second\'')
            refusal('past midnight', 'signed_out'); d.run('rollback to savepoint r')
            d.run('savepoint r'); d.service("student_submit.done(:t, 'ip-1')", t=tok1)
            refusal('after Done', 'signed_out'); d.run('rollback to savepoint r')
            # The classes list drops a class that has gone, as it did.
            d.run('savepoint r'); d.run('update course set student_page_enabled = false where id = :c', c=k['course2'])
            new, old = d.both(tok1, ENR1)
            ok("same: a second class whose page was turned off leaves the first class's list of classes, in the old reply and the new",
               [x['enrollment_id'] for x in new['classes']] == [ENR1] and without_new(new) == old, (new.get('classes'), old.get('classes')))
            d.run('rollback to savepoint r')
            d.run('savepoint r'); d.make(k['enr_a2'], course=k['course2'])
            new, old = d.both(tok1, ENR1)
            ok('same: a second class whose card was replaced leaves the list too, in both', [x['enrollment_id'] for x in new['classes']] == [ENR1] and without_new(new) == old)
            d.run('rollback to savepoint r')
            r = d.verify(d.make(ENR2)[0], birthday='2012-06-16')
            ok('same: in all, %d whole pages were compared, old against new, and %d differed' % (Compare.pages, Compare.differences),
               Compare.pages > 1500 and Compare.differences == 0)
            js_agrees(Compare.queue, 'same')
            ok("same: verify_card's list of classes is the page's own list, To Do count and all", r['classes'] == d.page(r['session_token'], ENR2)['classes']
               and set(r['classes'][0]) == OLD_CLASS | set(NEW_CLASS), r['classes'])
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_fields():
    d, k = ready('fields', old=False)
    try:
        tok1, tok2 = sign_in(d, k)
        with tx(d):
            p = one_page(d, tok1, ENR1); row = by_id(p)
            ok('fields: the reply has the keys it had and no other at the top; v is still 1', set(p) == OLD_TOP and p['v'] == 1, sorted(p))
            ok('fields: course gains teacher_name and nothing else', set(p['course']) == OLD_COURSE | set(NEW_COURSE), sorted(p['course']))
            ok('fields: each class in the list gains to_do and nothing else', all(set(c) == OLD_CLASS | set(NEW_CLASS) for c in p['classes']) and len(p['classes']) == 2, p['classes'])
            ok('fields: each competency gains i_can and nothing else', all(set(t) == OLD_TAG | set(NEW_TAG) for t in p['tags'].values()), p['tags'])
            ok('fields: each rubric is as it was, and each criterion gains tag_ids and nothing else',
               all(set(r) == OLD_RUBRIC for r in p['rubrics']) and all(set(c) == OLD_CRITERION | set(NEW_CRITERION) for r in p['rubrics'] for c in r['criteria']), p['rubrics'])
            ok('fields: each assessment gains description, module_name, category_name, category_percent and core_competencies, and nothing else',
               all(set(a) == OLD_ASSESSMENT | set(NEW_ASSESSMENT) for a in p['assessments']), sorted(p['assessments'][0]))
            ok('fields: the pieces listed and their order are as before: undated first, then oldest first, the class\'s own order within a day; the future piece is not there',
               [a['title'] for a in p['assessments']] == ['Class Discussion', 'Density Lab', 'Lab Report', 'Quiz 2', 'Quiz 1', 'Safety Contract', 'Fall Benchmark'], [a['title'] for a in p['assessments']])

            # ── teacher_name ────────────────────────────────────────────
            ok("fields: teacher_name is the class's teacher's display name", p['course']['teacher_name'] == 'Ms. Okafor', p['course'])
            for val, label in ((None, 'no display name'), ('', 'an empty display name')):
                d.run('savepoint f'); d.run('update teacher set display_name = :v where id = :t', v=val, t=A)
                ok('fields: with %s teacher_name is null, and the page still opens' % label, one_page(d, tok1, ENR1)['course']['teacher_name'] is None)
                d.run('rollback to savepoint f')
            d.run('savepoint f'); d.run("update teacher set display_name = '  Colin Brown ' where id = :t", t=A)
            ok('fields: the name is sent as it is stored, spaces and all', one_page(d, tok1, ENR1)['course']['teacher_name'] == '  Colin Brown ')
            d.run('rollback to savepoint f')
            ok("fields: nothing else of the teacher's is in the reply: not their email, not their id", 'a@example.com' not in json.dumps(p) and A not in json.dumps(p))

            # ── tags.<id>.i_can ─────────────────────────────────────────
            ok('fields: i_can is the list of I Can statements the class has for the competency, in its order',
               p['tags'][k['t1']] == {'label': 'Ask questions', 'code': 'Q1', 'i_can': ['I can ask a question that can be tested.', 'I can say what I expect to happen.']}, p['tags'][k['t1']])
            ok('fields: a competency with none has an empty list', p['tags'][k['t2']]['i_can'] == [])
            ok("fields: the competency's own wording and its curriculum text are not sent", 'WORDING-NOT-SENT' not in json.dumps(p) and 'SOURCE-NOT-SENT' not in json.dumps(p))
            ok('fields: a competency taken off the class is not in tags, nor is its I Can statement anywhere', k['t_gone'] not in p['tags'] and 'REMOVED' not in json.dumps(p))
            d.run('savepoint f'); d.run("update tag set i_can_statements = array['  padded  ', '', 'I can.'] where id = :t", t=k['t2'])
            ok('fields: the list is sent as it is stored: nothing trimmed, nothing dropped', one_page(d, tok1, ENR1)['tags'][k['t2']]['i_can'] == ['  padded  ', '', 'I can.'])
            d.run('rollback to savepoint f')

            # ── criteria[].tag_ids ──────────────────────────────────────
            crit = {c['id']: c for c in p['rubrics'][0]['criteria']}
            ok('fields: a criterion lists the competencies it counts toward, by id, in order', crit[k['c1']]['tag_ids'] == sorted([k['t1'], k['t2']]), crit[k['c1']]['tag_ids'])
            ok('fields: one linked to a competency since taken off the class does not list it', crit[k['c2']]['tag_ids'] == [k['t2']], crit[k['c2']]['tag_ids'])
            ok('fields: every id a criterion lists is a key of tags', all(t in p['tags'] for c in crit.values() for t in c['tag_ids']))
            d.run('savepoint f'); d.run('delete from criterion_tag where criterion_id = :c', c=k['c1'])
            ok('fields: a criterion linked to nothing has an empty list', {c['id']: c for c in one_page(d, tok1, ENR1)['rubrics'][0]['criteria']}[k['c1']]['tag_ids'] == [])
            d.run('rollback to savepoint f')
            d.run('savepoint f'); d.run('insert into criterion_tag (criterion_id, tag_id) values (:c, :t)', c=k['c1'], t=k['b_tag'])
            got = one_page(d, tok1, ENR1)
            ok("fields: a criterion linked (by a fault) to another class's competency does not list it, and nothing of that competency is sent",
               {c['id']: c for c in got['rubrics'][0]['criteria']}[k['c1']]['tag_ids'] == sorted([k['t1'], k['t2']]) and 'TEACHER-B' not in json.dumps(got))
            d.run('rollback to savepoint f')

            # ── description, module_name ────────────────────────────────
            ok('fields: description is what the teacher typed', row[k['a_comp']]['description'] == 'Find the density of three liquids.')
            ok('fields: an empty description and no description are both null', row[k['a_pts']]['description'] is None and row[k['a_rub']]['description'] is None)
            d.run('savepoint f'); d.run("update assessment set description = E'  two\\nlines  ' where id = :a", a=k['a_pts'])
            ok('fields: it is sent as it is stored, line breaks and spaces kept', by_id(one_page(d, tok1, ENR1))[k['a_pts']]['description'] == '  two\nlines  ')
            d.run('rollback to savepoint f')
            ok('fields: module_name is the module the piece is filed under, or null',
               [row[k[a]]['module_name'] for a in ('a_comp', 'a_rub', 'a_pts')] == ['Unit 1: Cells', 'Unit 2: Energy', None], [row[k[a]]['module_name'] for a in ('a_comp', 'a_rub', 'a_pts')])
            d.run('savepoint f'); d.run('update assessment set module_id = :m, category_id = :c where id = :a', m=k['b_mod'], c=k['b_cat'], a=k['a_pts'])
            got = one_page(d, tok1, ENR1)
            ok("fields: a piece pointing (by a fault) at another class's module and category names neither",
               by_id(got)[k['a_pts']]['module_name'] is None and by_id(got)[k['a_pts']]['category_name'] is None
               and by_id(got)[k['a_pts']]['category_percent'] is None and 'TEACHER-B' not in json.dumps(got))
            d.run('rollback to savepoint f')

            # ── category_name, category_percent ─────────────────────────
            cat = lambda page, a: (by_id(page)[k[a]]['category_name'], by_id(page)[k[a]]['category_percent'])
            ok('fields: in a Letter-and-Proficiency class a piece carries its category and what the category counts for: Tests 40, Projects 60',
               cat(p, 'a_comp') == ('Tests', 40) and cat(p, 'a_rub') == ('Projects', 60) and cat(p, 'a_done') == ('Tests', 40), (cat(p, 'a_comp'), cat(p, 'a_rub')))
            ok('fields: a piece with no category has no name and no percent', cat(p, 'a_pts') == (None, None) and cat(p, 'a_overall') == (None, None))
            ok('fields: a DIBELS benchmark carries its category name and no percent: it is not a grade', cat(p, 'a_dibels') == ('Tests', None))
            d.run('savepoint f'); d.run("update course set grading_system = 'letter' where id = :c", c=COURSE_A)
            ok('fields: a Letter class the same', cat(one_page(d, tok1, ENR1), 'a_comp') == ('Tests', 40))
            d.run('rollback to savepoint f')
            d.run('savepoint f'); d.run("update course set grading_system = 'proficiency' where id = :c", c=COURSE_A)
            got = one_page(d, tok1, ENR1)
            ok('fields: a Proficiency class has no course %, so a category that weighs something has a name and no percent', cat(got, 'a_comp') == ('Tests', None) and cat(got, 'a_rub') == ('Projects', None), cat(got, 'a_comp'))
            d.run('rollback to savepoint f')
            for system in ('both', 'letter', 'proficiency'):
                d.run('savepoint f')
                d.run("update course set grading_system = :g where id = :c", g=system, c=COURSE_A)
                d.run("update category set weight = case when id = :t then 0 else 100 end where course_id = :c", t=k['tests'], c=COURSE_A)
                got = one_page(d, tok1, ENR1)
                ok('fields: a category that weighs 0 counts toward nothing in a %s class: the percent is 0' % system.capitalize(),
                   cat(got, 'a_comp') == ('Tests', 0) and cat(got, 'a_rub') == ('Projects', None if system == 'proficiency' else 100), (cat(got, 'a_comp'), cat(got, 'a_rub')))
                ok('fields: and a DIBELS benchmark in it still has none (%s)' % system, cat(got, 'a_dibels') == ('Tests', None))
                d.run('rollback to savepoint f')
            d.run('savepoint f'); d.run("set local session_replication_role = 'replica'")
            d.run("update category set weight = 30 where course_id = :c", c=COURSE_A)
            got = one_page(d, tok1, ENR1)
            ok('fields: a class whose weights do not total 100 (one saved before the rule) gives no percent', cat(got, 'a_comp') == ('Tests', None) and cat(got, 'a_rub') == ('Projects', None), cat(got, 'a_comp'))
            d.run("update category set weight = 0 where course_id = :c", c=COURSE_A)
            got = one_page(d, tok1, ENR1)
            ok('fields: and one saved at 0 and 0 gives 0 for each: nothing in it counts', cat(got, 'a_comp') == ('Tests', 0) and cat(got, 'a_rub') == ('Projects', 0), cat(got, 'a_comp'))
            d.run('rollback to savepoint f')
            d.run('savepoint f'); d.run("update category set weight = case when id = :t then 12.5 else 87.5 end where course_id = :c", t=k['tests'], c=COURSE_A)
            text = d.c.run("select student_submit.page(:t, :e, 'ip-1')::text", t=tok1, e=ENR1)[0][0]
            ok('fields: a weight with a fraction is sent as the number it is', '"category_percent": 12.5' in text and '"category_percent": 87.5' in text)
            d.run('rollback to savepoint f')
            tok_b = d.session(ENR_B, birthday='2011-01-31', course=COURSE_B, teacher=B)
            d.run("update assessment set date_assigned = :d where id = :a", d=TODAY, a=k['b_assess'])
            pb = one_page(d, tok_b, ENR_B)
            ok("fields: Teacher B's class reads Teacher B's things: their name, their piece with its description, module and category; a Proficiency class, so no percent",
               pb['course']['teacher_name'] == 'TEACHER-B-NAME' and {x: pb['assessments'][0][x] for x in NEW_ASSESSMENT} ==
               {'description': 'TEACHER-B-DESCRIPTION', 'module_name': 'TEACHER-B-MODULE', 'category_name': 'TEACHER-B-CATEGORY', 'category_percent': None, 'core_competencies': []}
               and 'Okafor' not in json.dumps(pb), pb.get('assessments'))
            d.run("update course set grading_system = 'letter' where id = :c", c=COURSE_B)
            ok('fields: made a Letter class, its one category counts 100', one_page(d, tok_b, ENR_B)['assessments'][0]['category_percent'] == 100)

            # ── core_competencies ───────────────────────────────────────
            ok('fields: core_competencies is each Core Competency on the piece with its name, in the Ministry\'s order whatever order they were saved in',
               row[k['a_comp']]['core_competencies'] == [{'id': 'COM', 'name': 'Communicating'}, {'id': 'CT', 'name': 'Creative Thinking'}], row[k['a_comp']]['core_competencies'])
            ok('fields: a piece with none has an empty list', row[k['a_pts']]['core_competencies'] == [])
            d.run('savepoint f'); d.run("update assessment set core_competency_ids = '{SAR,PAR,PPI,CRT,CT,COL,COM,CT,COM}' where id = :a", a=k['a_pts'])
            ok('fields: all seven, each once though two were saved twice, named as shared/constants.js names them',
               by_id(one_page(d, tok1, ENR1))[k['a_pts']]['core_competencies'] == [{'id': i, 'name': n} for i, n in CORE])
            d.run('rollback to savepoint f')
            js = open(os.path.join(HERE, '..', '..', 'shared', 'constants.js')).read()
            block = js.split('const CORE_COMPETENCIES = [')[1].split('];')[0]
            ok('fields: and that list in shared/constants.js is these seven ids and labels, in this order',
               re.findall(r"id: '(\w+)', label: '([^']+)'", block) == CORE, re.findall(r"id: '(\w+)', label: '([^']+)'", block))

            # ── A class with nothing in it ──────────────────────────────
            p2 = one_page(d, tok1, k['enr_a2'])
            ok('fields: a class with no categories, modules, competencies or rubrics opens, with every new key empty or null',
               p2.get('ok') is True and p2['tags'] == {} and p2['rubrics'] == [] and len(p2['assessments']) == 1
               and {x: p2['assessments'][0][x] for x in NEW_ASSESSMENT} == {'description': None, 'module_name': None, 'category_name': None, 'category_percent': None, 'core_competencies': []}
               and p2['course']['teacher_name'] == 'Ms. Okafor', p2)
            d.run('savepoint f'); d.run('delete from assessment where course_id = :c', c=k['course2'])
            p2 = one_page(d, tok1, k['enr_a2'])
            ok('fields: and a class with no work at all', p2.get('ok') is True and p2['assessments'] == [] and [c['to_do'] for c in p2['classes'] if c['enrollment_id'] == k['enr_a2']] == [0])
            d.run('rollback to savepoint f')
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_todo():
    d, k = ready('todo', old=False)
    try:
        tok1, tok2 = sign_in(d, k)
        with tx(d):
            def counts(token=tok1, e=ENR1):
                """{enrollment: to_do} as the page for this class lists the session's classes."""
                return {c['enrollment_id']: c['to_do'] for c in one_page(d, token, e)['classes']}
            seen = []
            def mine(e=ENR1, token=None):
                p = one_page(d, token or (tok1 if e != ENR2 else tok2), e)
                got = [c['to_do'] for c in p['classes'] if c['enrollment_id'] == e][0]
                seen.append(('count %d' % (len(seen) + 1), json.dumps(p), got))
                return got if got == waiting(p) == from_tables(d, e) else ('DISAGREE', got, waiting(p), from_tables(d, e))
            grade = lambda e, a, v: d.teacher('upsert_score(:e, :a, :v)', e=e, a=a, v=v)
            give = lambda e, a: d.teacher('return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % e, k=nid())
            mark = lambda e, a, s: d.teacher('set_score_status(:e, :a, :s)', e=e, a=a, s=s)

            # Six pieces of Science 8 are on the page and take a grade: Class Discussion (undated), Density Lab,
            # Lab Report, Quiz 2, Quiz 1, Safety Contract. Fall Benchmark is DIBELS; Pop Quiz is dated tomorrow.
            ok('todo: with nothing graded, every piece on the page that takes a grade is waiting: 6, and 1 in the second class', counts() == {ENR1: 6, k['enr_a2']: 1}, counts())
            ok("todo: the count is a whole number, and it is the count shared/student-view.js gives for the same reply (To Do plus Missing), and the count read straight from the tables", mine() == 6, mine())
            ok("todo: a class's count is the same whichever class's page lists it", counts(e=k['enr_a2']) == counts())
            ok('todo: the other student has their own', mine(ENR2) == 6, mine(ENR2))

            # ── A draft never moves it ──────────────────────────────────
            grade(ENR1, k['a_pts'], 7)
            ok('todo: a grade saved and not returned is a draft, and the piece still waits', state(d, ENR1, k['a_pts']) == 'draft' and mine() == 6, mine())
            give(ENR1, k['a_pts'])
            ok('todo: returned, it stops waiting', mine() == 5, mine())
            grade(ENR1, k['a_pts'], 9)
            ok('todo: a draft saved over the returned grade leaves it returned', state(d, ENR1, k['a_pts']) == 'draft' and mine() == 5, mine())
            d.teacher('clear_score(:e, :a)', e=ENR1, a=k['a_pts'])
            ok('todo: so does clearing the score before any Return: the student still has the grade they were given', mine() == 5, mine())
            ok("todo: none of that moved the other student's count, or the second class's", mine(ENR2) == 6 and counts()[k['enr_a2']] == 1)
            # Formally: make every row a draft, then no row a draft, and ask again.
            before = (counts(), counts(tok2, ENR2))
            d.run('savepoint flip'); d.run("set local session_replication_role = 'replica'")
            d.run("""update grade_return g set is_draft = true,
                            returned_copy = case when g.returned_at is not null then coalesce(g.returned_copy, public._grade_copy(g.enrollment_id, g.assessment_id), '{"v": 1}'::jsonb) end""")
            n_drafts = d.one('select count(*) from grade_return where is_draft')
            all_drafts = (counts(), counts(tok2, ENR2))
            d.run('update grade_return set is_draft = false, returned_copy = null')
            no_drafts = (counts(), counts(tok2, ENR2))
            d.run('rollback to savepoint flip')
            ok('todo: with every grade row made a draft (%d of them), and then with none a draft, every count is what it was: whether a draft exists is not read' % n_drafts,
               all_drafts == before and no_drafts == before and n_drafts >= 1, (before, all_drafts, no_drafts))
            d.run('savepoint flip'); d.run("set local session_replication_role = 'replica'")
            for t in ('tag_score', 'rubric_score', 'rubric_check_score'): d.run('delete from ' + t)
            d.run('update score set value = null, comment = null')
            ok('todo: nor is the working copy: with every score wiped behind the triggers the counts are what they were', (counts(), counts(tok2, ENR2)) == before)
            d.run('rollback to savepoint flip')

            # ── Missing, Excused, Late ──────────────────────────────────
            mark(ENR1, k['a_pts'], 'NS')
            ok('todo: marked Missing, a piece that was returned waits again (Missing wins at once)', mine() == 6, mine())
            mark(ENR1, k['a_pts'], 'EXC')
            ok('todo: Excused, it does not wait', mine() == 5, mine())
            mark(ENR1, k['a_pts'], 'LATE')
            ok('todo: Late on a returned piece: it does not wait', mine() == 5, mine())
            mark(ENR1, k['a_pts'], None)
            ok('todo: with the mark off it is the returned piece it was', mine() == 5, mine())
            mark(ENR1, k['a_comp'], 'NS')
            ok('todo: Missing on a piece never graded: it waits, counted once', mine() == 5, mine())
            mark(ENR1, k['a_comp'], 'EXC')
            ok('todo: Excused on a piece never graded: it stops waiting', mine() == 4, mine())
            mark(ENR1, k['a_comp'], 'LATE')
            ok('todo: Late on a piece never graded: it waits', mine() == 5, mine())
            mark(ENR1, k['a_comp'], None)

            # ── What is and is not a piece that waits ───────────────────
            d.teacher("save_score_comment(:e, :a, 'Reads with expression')", e=ENR1, a=k['a_dibels'])
            mark(ENR1, k['a_dibels'], 'NS')
            ok('todo: a DIBELS benchmark never waits, marked Missing or not', mine() == 5, mine())
            d.run('update assessment set date_assigned = :d where id = :a', d=TODAY, a=k['a_future'])
            ok('todo: a piece waits from the day it is dated', mine() == 6, mine())
            d.run("update assessment set date_assigned = :d::date + 1 where id = :a", d=TODAY, a=k['a_future'])
            ok('todo: and not the day before', mine() == 5, mine())
            d.run("update assessment set score_mode = 'dibels' where id = :a", a=k['a_pts'])
            ok('todo: a returned piece changed to DIBELS is not counted either way', mine() == 5, mine())
            d.run("update assessment set score_mode = 'points' where id = :a", a=k['a_pts'])
            d.service("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=tok1, e=ENR1, ids='{%s,%s}' % (k['a_pts'], k['a_comp']))
            ok('todo: opening a piece changes no count (a row that only says it was seen is not a return)', mine() == 5, mine())
            # A piece returned whose every competency has since been taken off the class: nothing is left of
            # the grade to show, and it still came back.
            d.teacher('upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=k['a_comp'], t=k['t1']); give(ENR1, k['a_comp'])
            ok('todo: a competency piece returned stops waiting', mine() == 4, mine())
            d.run('update section set removed_at = now() where id = :x', x=k['sect'])
            got = by_id(one_page(d, tok1, ENR1))[k['a_comp']]
            ok('todo: when every competency it was graded on is taken off the class the grade sent is null, the piece still says it came back, and it does not wait',
               got['grade'] is None and got['returned_at'] is not None and mine() == 4, (got['grade'], got['returned_at'], mine()))
            d.run('update section set removed_at = null where id = :x', x=k['sect'])

            # ── As Soon As I Save ───────────────────────────────────────
            set_class(d, True, 'on_save')
            ok('todo: changing the class to As Soon As I Save returns what was waiting: Quiz 1, cleared after it was returned, is now a piece with no grade, and waits again',
               by_id(one_page(d, tok1, ENR1))[k['a_pts']]['returned_at'] is None and mine() == 5, mine())
            grade(ENR1, k['a_done'], 1)
            ok('todo: in a class on As Soon As I Save a grade is returned when it is saved, and the piece stops waiting', mine() == 4, mine())
            set_class(d, True, 'on_return')

            # ── The session's other class ───────────────────────────────
            d.teacher('upsert_score(:e, :a, 3)', e=k['enr_a2'], a=k['c2_assess'])
            ok("todo: a draft in the second class moves neither class's count", counts() == {ENR1: 4, k['enr_a2']: 1}, counts())
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['c2_assess'], ids='{%s}' % k['enr_a2'], k=nid())
            ok('todo: returned there, the second class has nothing waiting and the first is as it was', counts() == {ENR1: 4, k['enr_a2']: 0} and mine(k['enr_a2']) == 0, counts())
            ok("todo: one class's count never includes another's pieces", mine(ENR2) == 6, mine(ENR2))
            js_agrees(seen, 'todo')

        # ── The class's own time zone ───────────────────────────────────
        with tx(d):
            d.run("set local timezone = 'UTC'")
            for tz, label in (('Pacific/Kiritimati', 'fourteen hours ahead of UTC'), ('Pacific/Niue', 'eleven hours behind UTC')):
                d.run('savepoint z')
                d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
                there = d.one("select (now() at time zone :z)::date::text", z=tz)
                d.run('update assessment set date_assigned = :d where id = :a', d=there, a=k['a_future'])
                d.run("update assessment set date_assigned = :d::date + 1 where id = :a", d=there, a=k['a_same_day'])
                d.run('update student_card set works_until = :d::date + 30', d=there)
                p = one_page(d, tok1, ENR1)
                got = [c['to_do'] for c in p['classes'] if c['enrollment_id'] == ENR1][0]
                # Waiting: Class Discussion, Density Lab, Lab Report, Quiz 1 and Safety Contract as before, and Pop Quiz
                # (today there); not Quiz 2 (tomorrow there).
                ok('todo: in a class %s, a piece dated today where the class is waits and one dated tomorrow there does not: the count follows the page' % label,
                   'Pop Quiz' in [a['title'] for a in p['assessments']] and 'Quiz 2' not in [a['title'] for a in p['assessments']] and got == waiting(p) == 6, (got, waiting(p)))
                d.run('rollback to savepoint z')
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def code_only(src):
    """A function's body without its comments and without what is inside quotes: only names are left."""
    src = re.sub(r'--[^\n]*', '', src)
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    return re.sub(r"'(?:[^']|'')*'", "''", src)

def scen_privacy():
    d, k = ready('privacy', old=False)
    try:
        tok1, tok2 = sign_in(d, k)
        src = {r[0]: code_only(r[1]) for r in d.all("select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'")}
        relations = [r[0] for r in d.all("""select distinct c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                             where n.nspname in ('public', 'student_submit') and c.relkind in ('r', 'v', 'm', 'p')""")]
        named = lambda fn: sorted(r for r in relations if re.search(r'(?<![A-Za-z0-9_.])(?:public\.|student_submit\.)?%s(?![A-Za-z0-9_(])' % re.escape(r), src[fn]))
        want_page = sorted(['course', 'enrollment', 'student', 'teacher', 'tag', 'section', 'rubric', 'criterion', 'criterion_check', 'criterion_tag',
                            'assessment', 'assessment_tag', 'category', 'module'])
        want_classes = sorted(['device_session_enrollment', 'student_card', 'enrollment', 'student', 'course', 'assessment'])
        ok('privacy: of the %d tables and views in public and student_submit, page names these fourteen and no other' % len(relations), named('page') == want_page, named('page'))
        ok('privacy: and _session_classes these six and no other', named('_session_classes') == want_classes, named('_session_classes'))
        GRADES = re.compile(r'(?<![A-Za-z0-9_])(score|tag_score|rubric_score|rubric_check_score|dibels_score|grade_return|returned_copy|previous_copy|working_copy|is_draft|_grade_copy|_grade_copy_in_use)(?![A-Za-z0-9_])')
        ok('privacy: neither names a score table, grade_return, a stored copy, the draft flag or the copy makers: a grade is read only through _returned_grade',
           not GRADES.search(src['page']) and not GRADES.search(src['_session_classes']) and src['page'].count('_returned_grade(') == 1 and src['_session_classes'].count('_returned_grade(') == 1,
           (GRADES.findall(src['page']), GRADES.findall(src['_session_classes'])))
        readers = sorted(n for n, s in src.items() if re.search(r'(?<![A-Za-z0-9_])(score|tag_score|rubric_score|rubric_check_score|returned_copy|previous_copy|_grade_copy)(?![A-Za-z0-9_])', s))
        ok('privacy: in the whole schema it is still only _returned_grade that names a score table, a stored copy or _grade_copy (student_page.py\'s rule)', readers == ['_returned_grade'], readers)
        NOT_SHOWN = ['email', 'last_name', 'student_number', 'date_of_birth', 'slip_password', 'pronouns', 'designations', 'is_flagged', 'roster_position',
                     'report_note', 'evidence_type', 'collab_mode', 'collab_config', 'copy_group', 'late_work_policy', 'i_can_text', 'source_text', 'bank_id',
                     'calc_method', 'decay_weight', 'category_weights', 'reporting_terms', 'curriculum_tags', 'code_hmac', 'pw_hmac', 'key_id', 'wrong_tries',
                     'observation', 'note', 'goal', 'reflection', 'term_rating', 'section_override', 'attendance', 'guardian', 'score_audit', 'auth']
        found = [w for w in NOT_SHOWN for fn in ('page', '_session_classes') if re.search(r'(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])' % w, src[fn])]
        ok('privacy: neither names any of %d columns and tables a student is not shown (a last name, a student number, a birthday, an email, a designation, the Note for the Report, group lists, observations, notes, term ratings…)' % len(NOT_SHOWN),
           not found, found)
        raw_page = d.one("select p.prosrc from pg_proc p where p.oid = '%s'::regprocedure" % PAGE)
        ok("privacy: page names the teacher table once, in one line that reads display_name and nothing else of the row",
           "(select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)" in raw_page
           and len(re.findall(r'(?<![A-Za-z0-9_])teacher(?![A-Za-z0-9_])', src['page'])) == 1, re.findall(r'teacher\w*', src['page']))
        ok('privacy: both are still SECURITY DEFINER, STABLE, with public, student_submit, pg_temp as their search_path',
           d.one("""select count(*) from pg_proc p where p.oid in ('%s'::regprocedure, '%s'::regprocedure) and p.prosecdef and p.provolatile = 's'
                     and p.proconfig = array['search_path=public, student_submit, pg_temp']""" % (PAGE, CLASSES)) == 2)

        with tx(d):
            # ── Things only the teacher has, and things that are another student's ──
            d.teacher('upsert_score(:e, :a, 6)', e=ENR1, a=k['a_pts'])
            d.teacher("save_score_comment(:e, :a, 'RETURNED-COMMENT-MINE')", e=ENR1, a=k['a_pts'])
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_pts'], ids='{%s}' % ENR1, k=nid())
            d.teacher("save_score_comment(:e, :a, 'DRAFT-COMMENT-MINE')", e=ENR1, a=k['a_pts'])
            d.teacher("save_score_report_note(:e, :a, 'NOTE-FOR-THE-REPORT', :k)", e=ENR1, a=k['a_pts'], k=nid())
            d.teacher('upsert_tag_score(:e, :a, :t, 2, 0::smallint, :c)', e=ENR1, a=k['a_comp'], t=k['t1'], c='DRAFT-LEVEL-COMMENT-MINE')
            d.teacher('upsert_score(:e, :a, 10)', e=ENR2, a=k['a_pts'])
            d.teacher("save_score_comment(:e, :a, 'OTHER-STUDENT-COMMENT')", e=ENR2, a=k['a_pts'])
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_pts'], ids='{%s}' % ENR2, k=nid())
            d.run("insert into note (enrollment_id, body) values (:e, 'TEACHER-NOTE-ABOUT-ME')", e=ENR1)
            d.run("insert into goal (enrollment_id, section_id, body) values (:e, :x, 'GOAL-TEXT')", e=ENR1, x=k['sect'])
            d.run("insert into observation (course_id, body) values (:c, 'OBSERVATION-TEXT')", c=COURSE_A)
            p1 = one_page(d, tok1, ENR1); t1 = json.dumps(p1)
            p2 = one_page(d, tok2, ENR2); t2 = json.dumps(p2)
            ok('privacy: (the run is real: the first student is sent their returned comment, the second theirs)', 'RETURNED-COMMENT-MINE' in t1 and 'OTHER-STUDENT-COMMENT' in t2)
            leaks = [m for m in ('DRAFT-COMMENT-MINE', 'DRAFT-LEVEL-COMMENT-MINE', 'NOTE-FOR-THE-REPORT', 'OTHER-STUDENT-COMMENT', 'TEACHER-NOTE-ABOUT-ME', 'GOAL-TEXT', 'OBSERVATION-TEXT',
                                 'Marcus', 'Lee', 'Adeyemi', '700123', '2012-05-15', '2012-06-16', 'marcus@example.com', 'he/him', 'a@example.com', 'b@example.com',
                                 'TEACHER-B', 'NOT-SENT', 'REMOVED', ENR2, STU1, STU2, A, B, COURSE_A, COURSE_B) if m in t1]
            ok("privacy: nothing of a draft, the Note for the Report, a teacher's note, goal or observation, another student (name, number, birthday, email, grade, enrollment id), "
               "another teacher's class, the teacher's email, or any id of a teacher, student or class is anywhere in the first student's page", not leaks, leaks)
            leaks2 = [m for m in ('RETURNED-COMMENT-MINE', 'DRAFT-COMMENT-MINE', 'CeCe', 'Cece', 'Adeyemi', ENR1, k['enr_a2'], 'Socials 8') if m in t2]
            ok("privacy: and nothing of the first student, or of their other class, is in the second student's", not leaks2, leaks2)
            ok("privacy: the list of classes holds the session's own classes only", [c['enrollment_id'] for c in p1['classes']] == [ENR1, k['enr_a2']] and [c['enrollment_id'] for c in p2['classes']] == [ENR2])
            # No number about the class: the counts are this student's.
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_comp'], ids='{%s}' % ENR1, k=nid())
            ok("privacy: what one student has had returned moves no number in another's page",
               json.dumps(without_stamps(one_page(d, tok2, ENR2))) == json.dumps(without_stamps(p2)))
    finally:
        d.close()

def without_stamps(page):
    p = copy.deepcopy(page); p.pop('expires_at', None); return p

# ════════════════════════════════════════════════════════════════════════════
def scen_grants():
    """Who can run the two functions, where nothing else would hide a mistake: on this copy a new function
    is runnable by everyone by default and anon and signed-in teachers are let into the schema."""
    d = PageDb('grants')
    try:
        k = seed(d)
        d.run('alter default privileges for role postgres grant execute on functions to public')
        d.run('grant usage on schema student_submit to anon, authenticated')
        d.run("create function student_submit.probe() returns int language sql as $f$ select 1 $f$")
        ok('grants: on this copy a new function is runnable by everyone unless something revokes it',
           d.role('anon', 'select student_submit.probe()')[0][0] == 1 and d.role('authenticated', 'select student_submit.probe()')[0][0] == 1)
        d.run('drop function student_submit.probe()')
        def who():
            return {name: sorted(by) for name, by in d.all("""
                select p.proname, array(select r from unnest(array['public', 'anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))
                  from pg_proc p where p.oid in ('%s'::regprocedure, '%s'::regprocedure)""" % (PAGE, CLASSES))}
        acl = lambda: d.all("select p.proname, coalesce(p.proacl::text, '') from pg_proc p where p.oid in ('%s'::regprocedure, '%s'::regprocedure) order by 1" % (PAGE, CLASSES))
        was = who(); was_acl = acl()
        ok('grants: before the file, page is for the service role alone and _session_classes for nobody but its owner', was == {'page': ['service_role'], '_session_classes': []}, was)
        r = d.apply()
        ok('grants: the file applies', r == 'ok', r)
        ok('grants: afterwards the same, to the letter', who() == was and acl() == was_acl, (who(), acl()))
        tok1, tok2 = sign_in(d, k)
        ok('grants: the service role reads a page', d.page(tok1, ENR1).get('ok') is True)
        for role in ('anon', 'authenticated'):
            for name, sql in (('page', "select student_submit.page('%s', '%s', 'x')" % (tok1, ENR1)),
                              ('_session_classes', "select student_submit._session_classes('%s')" % nid())):
                e = refused(d, lambda: d.role(role, sql, uid=A if role == 'authenticated' else None))
                ok('grants: let into the schema, %s is still refused %s, by the function itself (the teacher here owns the class)' % (role, name),
                   e is not None and 'permission denied for function' in e[0], e)
        e = refused(d, lambda: d.role('service_role', "select student_submit._session_classes('%s')" % nid()))
        ok('grants: the service role cannot call _session_classes directly either', e is not None and 'permission denied for function' in e[0], e)
        ok('grants: no function in student_submit can be run by the public, anon or a signed-in teacher',
           d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'
                     and (has_function_privilege('public', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                          or has_function_privilege('authenticated', p.oid, 'execute'))""") == 0)
        # ── The file's own last check ───────────────────────────────────
        d.run('grant execute on function student_submit.page(text, uuid, text) to authenticated')
        r = d.apply()
        ok('grants: where a signed-in teacher has been let run page, the file takes that away again (it says who may run each, and its last step checks)',
           r == 'ok' and who() == was, (r, who()))

        # ── Temporary tables cannot stand in ────────────────────────────
        with tx(d):
            before = without_stamps(d.page(tok1, ENR1))
            d.c.run('savepoint temp'); d.c.run('set role service_role')
            e = None
            try:
                d.c.run('create temporary table teacher (id uuid, display_name text)')
                d.c.run("insert into teacher values (:t, 'A-TEMPORARY-TEACHER')", t=A)
                d.c.run('create temporary table category (id uuid, course_id uuid, name text, weight numeric)')
                d.c.run("insert into category values (:i, :c, 'A-TEMPORARY-CATEGORY', 100)", i=k['tests'], c=COURSE_A)
                d.c.run('create temporary table module (id uuid, course_id uuid, name text)')
                d.c.run("insert into module values (:i, :c, 'A-TEMPORARY-MODULE')", i=k['unit1'], c=COURSE_A)
                d.c.run('create temporary table assessment (id uuid, course_id uuid, date_assigned date, score_mode text)')
                got = d.c.run("select student_submit.page(:t, :e, 'ip-1')", t=tok1, e=ENR1)[0][0]
                d.c.run('reset role')
            except Exception as err:
                e = err; got = None; d.c.run('rollback to savepoint temp'); d.c.run('reset role')
            ok('grants: temporary tables named teacher, category, module and assessment, made by the caller, change nothing in the reply: pg_temp is searched last',
               e is None and got is not None and without_stamps(got) == before and 'TEMPORARY' not in json.dumps(got), e or [c for c in got['classes']])
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def b_statements(path):
    return split(open(path).read())

def scen_batchb():
    if not HAVE_B:
        print("SKIPPED batchb: Batch B's files are not in this checkout. Name one that has them: BATCH_B_DIR=<checkout of batch-b-submissions>")
        return
    b_functions = lambda d: {r[0]: r[1] for r in d.all("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                           where n.nspname in ('public', 'student_submit', 'fv_private') and p.prokind in ('f', 'p')""")}
    def apply_b(d):
        for path in B_FILES:
            r = d.statements(b_statements(path))
            if r != 'ok': return '%s: %s' % (os.path.basename(path), r)
        return 'ok'
    def works(d, k, label):
        tok1, tok2 = sign_in(d, k)
        with tx(d):
            c = Compare(d, [(tok1, ENR1), (tok2, ENR2), (tok1, k['enr_a2'])]); c.once('nothing graded')
            d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=k['a_pts']); c.once('a draft')
            d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_pts'], ids='{%s}' % ENR1, k=nid()); c.once('returned')
            d.teacher("set_score_status(:e, :a, 'NS')", e=ENR1, a=k['a_comp']); c.once('Missing')
            p = one_page(d, tok1, ENR1)
            ok('batchb: %s: a page opens with the new keys, the old reply and the new agree through a draft, a return and a Missing mark, and the To Do count is right' % label,
               not c.bad and c.good == 12 and set(p['assessments'][0]) == OLD_ASSESSMENT | set(NEW_ASSESSMENT)
               and [x['to_do'] for x in p['classes']] == [5, 1], (c.bad[:2], [x['to_do'] for x in p['classes']]))

    # ── Batch B first, then this file ───────────────────────────────────
    d = PageDb('b_first')
    try:
        k = seed(d)
        r = apply_b(d)
        ok("batchb: Batch B's two files apply to the database as live is (with the storage stand-in)", r == 'ok', r)
        ok('batchb: Batch B leaves the two functions this file replaces, and the two it leans on, exactly as live has them', fingerprints(d, list(LIVE_MD5)) == LIVE_MD5, fingerprints(d, list(LIVE_MD5)))
        ok('batchb: with Batch B applied the pre-check still lists nothing', d.all(PRE1) == [], d.all(PRE1))
        d.keep_old()
        fb = b_functions(d); cat0, rows0 = catalog_and_rows(d)
        r = d.apply()
        ok('batchb: this file applies after Batch B', r == 'ok', r)
        if not MUTATED: ok('batchb: and the post-check lists nothing', d.all(POST) == [], d.all(POST))
        fa = b_functions(d)
        differ = sorted(f for f in fa if fa[f] != fb.get(f))
        ok("batchb: and of the %d functions there, Batch B's 39 among them, the only two that differ are this file's" % len(fb), differ == sorted([PAGE, CLASSES]) and len(fa) == len(fb), differ)
        cat1, rows1 = catalog_and_rows(d)
        gone, came = differences(cat0, cat1)
        ok("batchb: no other catalog line differs (Batch B's tables, columns, triggers, policies and grants are untouched) and no row", len(gone) == 4 and len(came) == 4 and rows1 == rows0, (len(gone), len(came)))
        if not MUTATED: ok('batchb: the two functions have the fingerprints the file says it leaves', fingerprints(d, [PAGE, CLASSES]) == BECOMES)
        r = apply_b(d)
        ok("batchb: Batch B's files run again afterwards (their second-run check) and change nothing", r == 'ok' and catalog_and_rows(d) == (cat1, rows1), r)
        r = d.apply()
        ok('batchb: this file runs again and changes nothing', r == 'ok' and catalog_and_rows(d) == (cat1, rows1), r)
        works(d, k, 'Batch B first')
    finally:
        d.close()

    # ── This file first, then Batch B ───────────────────────────────────
    d = PageDb('b_second')
    try:
        k = seed(d)
        d.keep_old()
        r = d.apply()
        ok('batchb: this file applies to the database as live is', r == 'ok', r)
        mine = fingerprints(d, [PAGE, CLASSES])
        d.run('drop function student_submit.page_old(text, uuid, text)'); d.run('drop function student_submit._session_classes_old(uuid)')   # Batch B must meet only what live will have
        r = apply_b(d)
        ok("batchb: Batch B's two files apply after this one", r == 'ok', r)
        ok("batchb: and leave this file's two functions exactly as it left them", fingerprints(d, [PAGE, CLASSES]) == mine)
        if not MUTATED: ok('batchb: the post-check lists nothing this way round either', d.all(POST) == [], d.all(POST))
        cat1, rows1 = catalog_and_rows(d)
        r = d.apply()
        ok('batchb: this file runs again after Batch B and changes nothing', r == 'ok' and catalog_and_rows(d) == (cat1, rows1), r)
        r = d.unapply()
        ok("batchb: this file's undo runs with Batch B applied, puts the two functions back as live has them, and touches nothing of Batch B's",
           r == 'ok' and fingerprints(d, [PAGE, CLASSES]) == {PAGE: LIVE_MD5[PAGE], CLASSES: LIVE_MD5[CLASSES]}
           and len(differences(cat1, catalog(d.c))[0]) == 4 and row_checksums(d.c) == rows1, r)
        d.keep_old(); r = d.apply()
        ok('batchb: and it applies again', r == 'ok', r)
        works(d, k, 'this file first')
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_suites():
    """The older suites that can run on a database with S3-M1, before the file and with it applied."""
    d = PageDb('suites')
    try:
        scripts = ('student_submit.py', 'questionnaire_identity.py', 'phone_reports.py', 'questionnaires.py', 'grade_return.py', 'grade_return_limits.py', 'score_rpcs.py')
        before = {}
        for s in scripts:
            before[s] = (d.suite(s), list(d.failures))
        r = d.apply()
        ok('suites: the file applies to the database as built (nothing in it)', r == 'ok', r)
        for s in scripts:
            got = (d.suite(s), list(d.failures))
            ok('suites: %s gives the same result with the file applied as before it: %s' % (s, before[s][0]), got == before[s] and 'passed' in got[0], (got, before[s]))
        clean = [s for s in scripts if before[s][0].endswith(' 0 failed')]
        ok('suites: and that result is a clean pass for each (score_rpcs.py compares every function with docs/schema.generated.sql, the snapshot of live, and may be one short while that is behind)',
           sorted(clean) == sorted(scripts) or (sorted(clean) == sorted(s for s in scripts if s != 'score_rpcs.py') and before['score_rpcs.py'][0].endswith(' 1 failed')),
           {s: before[s][0] for s in scripts})
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_cost():
    """How long one page takes, before and after. The count beside each class asks the one reader of a
    grade once for every piece of every class in the session, so the page costs more the more classes
    and pieces there are. Three sizes, the last a full timetable late in a term."""
    d, k = ready('cost')
    try:
        d.run("insert into student (id, teacher_id, first_name) select gen_random_uuid(), :t, 'S' || g from generate_series(1, 28) g", t=A)
        def school(classes, pieces):
            """A session of `classes` new classes of 30 students, each with `pieces` pieces, two thirds of them returned."""
            made = []
            for n in range(classes):
                c = nid(); e = nid()
                d.run("insert into course (id, teacher_id, name, student_page_enabled, return_grades) values (:c, :t, :n, true, 'on_return')", c=c, t=A, n='Class %d' % n)
                d.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=e, s=STU1, c=c)
                d.run("insert into enrollment (student_id, course_id) select s.id, :c from student s where s.first_name like 'S%' and s.teacher_id = :t", c=c, t=A)
                d.run("""insert into assessment (course_id, title, score_mode, max_points, date_assigned)
                         select :c, 'Piece ' || g, 'points', 10, current_date - 70 + g from generate_series(1, :n::int) g""", c=c, n=pieces)
                made.append((c, e))
            d.run("set session_replication_role = 'replica'")
            d.run("""insert into score (enrollment_id, assessment_id, value) select e.id, a.id, 7 from enrollment e join assessment a on a.course_id = e.course_id
                      where a.course_id = any (:cs::uuid[]) and (substr(a.title, 7))::int <= :n::int""", cs='{%s}' % ','.join(c for c, e in made), n=pieces * 2 // 3)
            d.run("""insert into grade_return (enrollment_id, assessment_id, is_draft, returned_at, working_copy)
                     select s.enrollment_id, s.assessment_id, false, now(), public._grade_copy(s.enrollment_id, s.assessment_id) from score s
                     on conflict do nothing""")
            d.run("set session_replication_role = 'origin'")
            d.run('analyze')
            tok = d.session(made[0][1], course=made[0][0])
            for c, e in made[1:]: tok = d.session(e, course=c, token=tok, add=True)
            return tok, made[0][1]
        def ms(fn, tok, e, n=15):
            d.c.run("select student_submit.%s(:t, :e, 'ip-1')" % fn, t=tok, e=e)
            t0 = time.time()
            for _ in range(n): d.c.run("select student_submit.%s(:t, :e, 'ip-1')" % fn, t=tok, e=e)
            return (time.time() - t0) * 1000 / n
        worst = 0
        for classes, pieces in ((1, 30), (2, 30), (4, 60)):
            tok, e = school(classes, pieces)
            old = ms('page_old', tok, e); new = ms('page', tok, e); worst = max(worst, new)
            p = one_page(d, tok, e)
            print('COST a session of %d class%s of %d pieces each (two thirds returned): one page takes %.0f ms before, %.0f ms after' % (classes, '' if classes == 1 else 'es', pieces, old, new))
            ok('cost: %d class%s of %d pieces: every class in the list has its count (%d waiting in each)' % (classes, '' if classes == 1 else 'es', pieces, pieces - pieces * 2 // 3),
               [c['to_do'] for c in p['classes']] == [pieces - pieces * 2 // 3] * classes and len(p['assessments']) == pieces, p['classes'])
        ok('cost: the slowest of the three is under half a second on this machine', worst < 500, worst)
    finally:
        d.close()

SCENARIOS = {'apply': scen_apply, 'same': scen_same, 'fields': scen_fields, 'todo': scen_todo, 'privacy': scen_privacy, 'grants': scen_grants,
             'batchb': scen_batchb, 'suites': scen_suites, 'cost': scen_cost}
CARRIERS = [MIGRATION, UNDO, PRECHECK_FILE, POSTCHECK_FILE, 's4-m1-contract.md', 'README.md', '../../schema.sql']

if __name__ == '__main__':
    if sys.argv[1:] == ['build']:
        build(); sys.exit(0)
    if sys.argv[1:2] == ['fingerprints']:
        text = text_of(MIGRATION); now = measured(text); was = {s: v[1] for s, v in recorded(text).items()}
        for s in (PAGE, CLASSES): print('%-42s %s%s' % (s, now[s], '' if was[s] == now[s] else '   (the file says %s)' % was[s]))
        if sys.argv[2:] == ['write']:
            for rel in CARRIERS:
                path = os.path.join(HERE, rel)
                if not os.path.exists(path): continue
                old = open(path).read(); new = restamp(old, was, now)
                if new != old: open(path, 'w').write(new); print('rewritten: ' + rel)
        sys.exit(0 if was == now else 1)
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
