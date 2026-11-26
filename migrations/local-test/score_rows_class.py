"""S0-M6, score rows carry their class: migrations/2026112602_score_rows_carry_their_class.sql on a database rebuilt
from the repo and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "S0-M6: score rows carry their class").

    PGPORT=<port> PGDATABASE=<db> python3 score_rows_class.py            every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 score_rows_class.py apply undo  or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  today     without the file: the service role and the table owner can write a row that names another class of the
            same teacher (16 kinds); another teacher's ids are refused already (same_teacher, 2026111301); a teacher
            is refused by row security; upsert_section and upsert_tag move a section or a competency to another class.
  guards    each check the file makes stops it with the catalog and every row unchanged, and the read-only pre-check
            names the same thing: a cross-class row (two kinds), a trigger switched off, a key not as written for,
            another key to enrollment, a nullable enrollment_id, a course_id column of another type.
  apply     the catalog changes in exactly the lines expected and no others; no function that was there changes;
            every row of every table reads as before but for the new column (so no sync version and no returned
            grade moved); every row has its student's class; the pre-check before (only the count rows) and the
            post-check after (every row ok); a second run changes nothing; ASCII only, no backslash-u, size.
  refused   with the file: the 32 cross-class rows (another class of the same teacher, another teacher's class) are
            refused for the service role and the table owner and leave no row; a teacher is still refused by row
            security first; a class sent with a row is thrown away; an update cannot change it, nor re-point a row
            to a student, assessment, competency, criterion or checkbox of another class; within the class it can.
  moves     moving a section, competency, rubric, criterion or checkbox to another class is refused (upsert_section,
            upsert_tag, the owner); the same moves within a class and renames work; an enrollment or assessment with
            score rows cannot change class.
  paths     every function that writes the five tables, and the deletes that cascade into them, run the same story
            on a copy with the file and one without: the same replies, the same rows (course_id aside), the same
            returned grades and sync versions, step by step; with the file every row has its class. The readers
            (bundle, gradebook, detail, dashboard, learning map, profile, returned grades) answer the same, with
            course_id only in get_assessment_detail's score objects.
  race      (1) the file applied while four connections save and load the class: it waits for them and applies, no
            save fails, every row has its class; five rounds. (2) a save held open for more than fifteen seconds stops
            the file with nothing changed; one held for less is waited for. (3) every writer at once on eight
            connections, with and without the file: no error with the file that is not there without it.
  chain     the review's case: six sessions hold six of the file's tables and let go 170 ms apart while a teacher's
            session holds dibels_score and asks for section: the teacher is not cancelled and the file applies.
  owner     the file, the post-check and both parts of the undo as a table owner that is not a superuser, as live
            applies them.
  timing    how long the file holds its locks at production size (gradebook-prod, 2026-11-26) and at 20 times it.
  fingerprints  (run alone) writes the tested md5 of the twelve tables the file touches, and of get_assessment_detail,
            into score-rows-class-live-fingerprints.sql; then the file returns no rows here.
  undo      PART 0 alone (moves work again; the keys still refuse a cross-class score); PART 1 leaves the catalog as
            before the file but five dropped-column slots and every row as before; a second run; on a database
            without the file it changes nothing; a key not as expected stops it; the file applies again after it.
"""
import json, os, re, sys, threading, time, random, uuid as _uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, refused, ok, finish, split, text_of, key_id, FAKE_KEY, message, sqlstate, connect, admin, BASE_DB
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026112602_score_rows_carry_their_class.sql'
UNDO = 'score-rows-class-undo.sql'
PRE = 'score-rows-class-live-precheck.sql'
POST = 'score-rows-class-live-postcheck.sql'
FPS = 'score-rows-class-live-fingerprints.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
TABLES = ['score', 'tag_score', 'rubric_score', 'rubric_check_score', 'dibels_score']
PROD = {'score': 2876, 'tag_score': 1220, 'rubric_score': 7173, 'rubric_check_score': 1876, 'dibels_score': 0}   # 2026-11-26, read-only
RESULTS = {}

def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def key(): return str(_uuid.uuid4())
def applied(d): return d.one("select to_regprocedure('public._score_row_class()') is not null")
def part(text, n):
    a = text.index('-- PART %d begins' % n); b = text.index('-- PART %d ends' % n)
    return text[a:b]
def undo0(d): return d.statements(split(part(text_of(UNDO), 0)))
def undo1(d): return d.statements(split(part(text_of(UNDO), 1)))
def precheck(d): d.file(PRE); return [r for r in d.rows if not r[0].startswith('count: ')]
def postcheck(d): d.file(POST); return [r for r in d.rows if r[1] != 'ok'], len(d.rows)
def rows_but_class(d):
    """Every row of every table, the five tables' course_id left out."""
    cols = table_columns(d.c)
    for t in TABLES:
        cols['public.' + t] = [c for c in cols['public.' + t] if c != 'course_id']
    return row_checksums(d.c, cols)
def wrong_class(d):
    return d.one(' + '.join('(select count(*) from public.%s x left join public.enrollment e on e.id = x.enrollment_id '
                            'where x.course_id is distinct from e.course_id)' % t for t in TABLES).join(('select (', ')::int')))
def counts(d): return [d.one('select count(*)::int from public.' + t) for t in TABLES]
DRIFT = ('select count(*)::int from grade_return g where g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)')

# == The world: Teacher A's two classes, Teacher B's one ==
class W: pass
def crit(name, checks=()):
    return {'name': name, 'level_1_descriptor': 'Starting', 'level_2_descriptor': 'Close', 'level_3_descriptor': 'Meets',
            'level_4_descriptor': 'Beyond', 'checks': [{'level': 3, 'label': c} for c in checks]}
def ur(d, rid, cid, name, crits, uid=A):
    return str(T(d, "upsert_rubric(p_id => :id::uuid, p_course_id => :c::uuid, p_name => :n, p_criteria => :cr::jsonb, p_copy_group => null, "
                    "p_idempotency_key => gen_random_uuid(), p_style => 'advanced', p_linked_tag_ids => null)",
                 uid, id=rid, c=cid, n=name, cr=json.dumps(crits)))
def klass(d, uid, name):
    k = W(); k.uid = uid
    k.c = str(T(d, "create_course(p_name => :n, p_subjects => array['Inquiry'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    d.run("update course set return_grades = 'on_return' where id = :c", c=k.c)
    k.subj = d.one('select id::text from subject where course_id = :c', c=k.c)
    k.sect = str(T(d, "upsert_section(null, :s, 'Questioning')", uid, s=k.subj))
    k.t1 = str(T(d, "upsert_tag(null, :x, 'Ask questions')", uid, x=k.sect))
    k.t2 = str(T(d, "upsert_tag(null, :x, 'Plan a test')", uid, x=k.sect))
    k.rub = ur(d, None, k.c, 'Lab Rubric', [crit('Method', ['Labels', 'Units']), crit('Analysis', ['Graph'])], uid)
    k.crits = [r[0] for r in d.all('select id::text from criterion where rubric_id = :r order by display_order', r=k.rub)]
    k.checks = [r[0] for r in d.all('select k.id::text from criterion_check k join criterion c on c.id = k.criterion_id '
                                    'where c.rubric_id = :r order by c.display_order, k.display_order', r=k.rub)]
    def piece(title, **kw):
        extra = ''.join(', p_%s => :%s' % (n, n) for n in kw)
        return str(T(d, "create_assessment(p_course_id => :c, p_title => :t%s, p_idempotency_key => gen_random_uuid())" % extra, uid,
                     c=k.c, t=title, **kw))
    k.pts = piece('Quiz', score_mode='points', max_points=10)
    k.comp = piece('Inquiry Task', tag_ids=[k.t1, k.t2])
    k.rubp = piece('Lab Report', rubric_id=k.rub)
    k.dib = piece('Reading Check', score_mode='dibels')
    def enrol(first):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', "
                        "p_idempotency_key => gen_random_uuid())", uid, c=k.c, f=first)['enrollment_id'])
    k.e1, k.e2 = enrol('Cece'), enrol('Dev')
    return k

def build_world(d):
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=key_id(FAKE_KEY))
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    w = W(); w.k1 = klass(d, A, 'Science 9'); w.k2 = klass(d, A, 'Science 10'); w.kb = klass(d, B, 'Bravo Science')
    k = w.k1
    T(d, 'upsert_score(:e, :a, 7)', e=k.e1, a=k.pts); T(d, 'upsert_score(:e, :a, 9)', e=k.e2, a=k.pts)
    T(d, 'upsert_tag_score(:e, :a, :t, 3)', e=k.e1, a=k.comp, t=k.t1)
    T(d, 'upsert_rubric_score(:e, :a, :x, 3)', e=k.e1, a=k.rubp, x=k.crits[0])
    T(d, 'set_rubric_check(:e, :a, :k, true)', e=k.e1, a=k.rubp, k=k.checks[0])
    T(d, "upsert_dibels_score(:e, :a, 'boy', 101, 2, null, null)", e=k.e1, a=k.dib)
    T(d, 'upsert_score(:e, :a, 5)', e=w.k2.e1, a=w.k2.pts)
    T(d, 'upsert_score(:e, :a, 6)', e=w.kb.e1, a=w.kb.pts, uid=B)
    T(d, 'return_grades(:a, array[:e]::uuid[], gen_random_uuid())', a=k.rubp, e=k.e1)
    return w

WORLD = None
def world():
    global WORLD
    if WORLD is None:
        d = Db('m6_world')
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        WORLD = build_world(d)
        d.c.close()                                  # kept as the template for every scenario
    return WORLD
def copy(tag):
    world(); return Db('m6_' + tag, template=BASE_DB + '_m6_world')
def drop_world():
    admin('drop database if exists "%s_m6_world" with (force)' % BASE_DB)

def cross(other, mine):
    """Every way a row for student mine.e2 can name the class other."""
    return [
        ('a score on an assessment of %s' % other.label, 'insert into public.score (enrollment_id, assessment_id, value) values (:e, :a, 4)', dict(e=mine.e2, a=other.pts)),
        ('a competency level on an assessment of %s' % other.label, 'insert into public.tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 3)', dict(e=mine.e2, a=other.comp, t=other.t1)),
        ('a criterion level on an assessment of %s' % other.label, 'insert into public.rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :x, 3)', dict(e=mine.e2, a=other.rubp, x=other.crits[0])),
        ('a tick on an assessment of %s' % other.label, 'insert into public.rubric_check_score (enrollment_id, assessment_id, check_id) values (:e, :a, :k)', dict(e=mine.e2, a=other.rubp, k=other.checks[0])),
        ('a DIBELS row on an assessment of %s' % other.label, "insert into public.dibels_score (enrollment_id, assessment_id, period, orf_wrc) values (:e, :a, 'moy', 90)", dict(e=mine.e2, a=other.dib)),
        ('a level for a competency of %s, on the student\'s own assessment' % other.label, 'insert into public.tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 3)', dict(e=mine.e2, a=mine.comp, t=other.t1)),
        ('a level for a criterion of %s, on the student\'s own assessment' % other.label, 'insert into public.rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :x, 3)', dict(e=mine.e2, a=mine.rubp, x=other.crits[0])),
        ('a tick for a checkbox of %s, on the student\'s own assessment' % other.label, 'insert into public.rubric_check_score (enrollment_id, assessment_id, check_id) values (:e, :a, :k)', dict(e=mine.e2, a=mine.rubp, k=other.checks[0])),
    ]
def crosses(w):
    w.k2.label = 'another class of the same teacher'; w.kb.label = "another teacher's class"
    return cross(w.k2, w.k1), cross(w.kb, w.k1)
WRITERS = ('a SECURITY DEFINER function the service role runs', 'the table owner')
def lit(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
def inline(sql, kw):
    return re.sub(r'(?<!:):(\w+)', lambda m: lit(kw[m.group(1)]) if m.group(1) in kw else m.group(0), sql)
def definer(d):
    """A stand-in for a SECURITY DEFINER function written tomorrow: runs what it is given as the owner. This copy only."""
    d.run("""create or replace function public._m6_test_exec(p_sql text) returns void language plpgsql security definer
             set search_path = public, pg_temp as $f$ begin execute p_sql; end $f$""")
    d.run('revoke all on function public._m6_test_exec(text) from public, anon, authenticated')
    d.run('grant execute on function public._m6_test_exec(text) to service_role')
def write_as(d, who, sql, **kw):
    if who == 'the table owner': return d.run(sql, **kw)
    return d.role('service_role', 'select public._m6_test_exec(:s)', s=inline(sql, kw))

# == today ==
def scen_today():
    d = copy('today'); w = world()
    try:
        definer(d)
        same, other = crosses(w)
        for who in WRITERS:
            d.begin()
            took = [n for n, sql, kw in same if refused(d, lambda: write_as(d, who, sql, **kw)) is None]
            d.rollback()
            ok('today: as %s, each of the %d rows naming another class of the same teacher is accepted' % (who, len(same)),
               took == [n for n, _s, _k in same], took)
            d.begin()
            errs = [refused(d, lambda: write_as(d, who, sql, **kw)) for n, sql, kw in other]
            d.rollback()
            ok('today: as %s, each of the %d naming another teacher\'s class is refused already (same_teacher, 42501)' % (who, len(other)),
               all(e and e[1] == '42501' for e in errs), errs)
        d.begin()
        e = refused(d, lambda: d.role('authenticated', same[0][1], uid=A, **same[0][2]))
        d.rollback()
        ok('today: a teacher writing one is refused by row security', e and e[1] == '42501' and 'row-level security' in e[0], e)
        k, k2 = w.k1, w.k2
        d.begin()
        T(d, "upsert_section(:x, :s, 'Questioning')", x=k.sect, s=k2.subj)
        ok('today: upsert_section moves a section to another of the teacher\'s classes, and a level is left on a competency of another class',
           d.one('select course_id::text from section where id = :x', x=k.sect) == k2.c
           and d.one('select count(*)::int from tag_score x join enrollment e on e.id = x.enrollment_id join tag t on t.id = x.tag_id '
                     'join section s on s.id = t.section_id where s.course_id <> e.course_id') == 1)
        d.rollback(); d.begin()
        T(d, "upsert_tag(:t, :x, 'Ask questions')", t=k.t1, x=k2.sect)
        ok('today: upsert_tag moves a competency to a section of another of the teacher\'s classes',
           d.one('select section_id::text from tag where id = :t', t=k.t1) == k2.sect)
        d.rollback()
    finally:
        d.close()

# == guards ==
def scen_guards():
    d = copy('guards'); w = world()
    try:
        same, _o = crosses(w)
        cat0, rows0 = catalog(d.c), rows_but_class(d)
        cases = [
            ('a score row already on another class\'s assessment', [(same[0][1], same[0][2])], 'name an assessment in another class', 'cross-class: score, assessment'),
            ('a level already on another class\'s competency', [(same[5][1], same[5][2])], 'competency, criterion or checkbox of another class', 'cross-class: tag_score, competency'),
            ('a trigger switched off', [('alter table public.score disable trigger grade_return_insert', {})], 'not in their normal state', 'trigger not in its normal state'),
            ('a key not as the file was written for', [('alter table public.score drop constraint score_enrollment_id_fkey', {}),
                                                        ('alter table public.score add constraint score_enrollment_id_fkey foreign key (enrollment_id) references public.enrollment (id)', {})],
             'is not what this file was written for', 'key score_enrollment_id_fkey'),
            ('another key to enrollment', [('alter table public.tag_score add constraint tag_score_extra_fk foreign key (enrollment_id) references public.enrollment (id)', {})],
             'has another key to enrollment', 'another key to enrollment or assessment'),
            ('a nullable enrollment_id', [('alter table public.dibels_score alter column enrollment_id drop not null', {})], 'can be null', 'can be null: dibels_score.enrollment_id'),
            ('a course_id column of another type', [('alter table public.rubric_score add column course_id text', {})], 'is there already and is not a nullable uuid', 'already there: column rubric_score.course_id'),
        ]
        for name, setup, says, pre in cases:
            d.run('begin')
            for sql, kw in setup: d.run(sql, **kw)
            pre_rows = precheck(d) if True else []
            d.run('savepoint before_file')
            r = 'ok'
            try:
                for st in split(text_of(FILE)):
                    if st.strip().lower() in ('begin', 'commit'): continue
                    d.run(st)
            except Exception as e:
                r = 'STOPPED: ' + message(e)
            d.run('rollback to savepoint before_file')
            changed = differences(cat0, catalog(d.c))
            d.run('rollback')
            ok('guard: %s stops the file (%s)' % (name, says), r.startswith('STOPPED') and says in r, r)
            ok('guard: %s: the pre-check names it' % name, any(x[0].startswith(pre) for x in pre_rows), pre_rows)
        ok('guards: after all of them the catalog and every row are as before', catalog(d.c) == cat0 and rows_but_class(d) == rows0)
        ok('guards: on the world itself the pre-check returns only the five count rows', precheck(d) == [] and len(d.rows) == 5, d.rows)
    finally:
        d.close()

# == apply ==
_T = '|'.join(TABLES)
EXPECT_GONE = [r'^constraint (%s) \| \1_(enrollment|assessment)_id_fkey \| f \| FOREIGN KEY \(\2_id\) REFERENCES \2\(id\) ON DELETE CASCADE$' % _T,
               r'^depends ']
EXPECT_NEW = [r'^constraint (%s) \| \1_(enrollment|assessment)_id_fkey \| f \| FOREIGN KEY \(\2_id, course_id\) REFERENCES \2\(id, course_id\) MATCH FULL ON DELETE CASCADE$' % _T,
              r'^constraint (enrollment|assessment) \| \1_id_course_uk \| u \| UNIQUE \(id, course_id\)$',
              r'^constraint more public \| (enrollment|assessment) \|  \| \1_id_course_uk \| u \| ',
              r'^index public\.(enrollment|assessment) \| \1_id_course_uk \| CREATE UNIQUE INDEX \1_id_course_uk ON public\.\1 USING btree \(id, course_id\)$',
              r'^index more public\.(enrollment|assessment)_id_course_uk \| ',
              r'^column public\.(%s) \| \d+ \| course_id \| uuid \| False \|  \| $' % _T,
              r'^column more public\.(%s) \| course_id \| ' % _T,
              r'^comment public\.(%s) \| course_id \| The class this row belongs to' % _T,
              r'^trigger (%s) \| \1_class(_parent)? \| O \| ' % _T,
              r'^trigger (section|rubric|tag|criterion|criterion_check) \| \1_class_fixed \| O \| ',
              r'^function (more )?public\.(_score_row_class|_score_row_parent_class|_class_is_fixed)\(\) ',
              r'^depends ', r'^comments on pg_class \| ']
def explained(lines, pats): return [l for l in lines if not any(re.match(p, l) for p in pats)]

def scen_apply():
    d = copy('apply')
    try:
        text = text_of(FILE)
        ok('apply: the file is plain ASCII with no backslash-u, and under 40 KB (%d bytes)' % len(text.encode()),
           all(ord(ch) < 128 for ch in text) and '\\u' not in text and len(text.encode()) < 40000)
        ok('apply: the pre-check returns only the five count rows', precheck(d) == [] and len(d.rows) == 5, d.rows)
        cat0, rows0, n0 = catalog(d.c), rows_but_class(d), counts(d)
        fns0 = {l.split(' | ')[0]: l for l in cat0 if l.startswith('function ')}
        r = d.file(FILE)
        ok('apply: the file applies', r == 'ok', r)
        cat1 = catalog(d.c)
        gone, new = differences(cat0, cat1)
        RESULTS['catalog'] = (gone, new)
        ok('apply: every catalog line it takes away is one of the ten one-column keys (or a count)', not explained(gone, EXPECT_GONE), explained(gone, EXPECT_GONE)[:4])
        ok('apply: every catalog line it adds is one the header names', not explained(new, EXPECT_NEW), explained(new, EXPECT_NEW)[:4])
        need = {'ten widened keys': (r'^constraint .*MATCH FULL', 10), 'two unique keys': (r'^constraint \w+ \| \w+_id_course_uk \| u', 2),
                'five columns': (r'^column public\.\w+ \| \d+ \| course_id ', 5), 'thirteen triggers': (r'^trigger \w+ \| \w+_class', 13),
                'three functions': (r'^function public\.', 3)}
        for what, (p, n) in need.items():
            ok('apply: the catalog gains %s' % what, len([l for l in new if re.match(p, l)]) == n, [l for l in new if re.match(p, l)])
        fns1 = {l.split(' | ')[0]: l for l in cat1 if l.startswith('function ')}
        ok('apply: no function that was there changed (body, owner, grants)', all(fns1.get(f) == v for f, v in fns0.items()))
        ok('apply: no client role may run the three new functions',
           d.one("""select count(*)::int from pg_proc p where p.proname in ('_class_is_fixed', '_score_row_class', '_score_row_parent_class')
                     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                          or has_function_privilege('service_role', p.oid, 'execute'))""") == 0)
        ok('apply: every row of every table reads as before but for the new column: no grade, no updated_at, no sync version, no returned grade moved',
           rows_but_class(d) == rows0)
        ok('apply: every row of the five tables has its student\'s class (%s rows)' % n0, wrong_class(d) == 0 and counts(d) == n0 and sum(n0) >= 8)
        ok('apply: every trigger on the five tables is switched on again',
           d.one("""select count(*)::int from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'O'
                     and t.tgrelid = any (array['public.score', 'public.tag_score', 'public.rubric_score', 'public.rubric_check_score', 'public.dibels_score']::regclass[])""") == 0)
        bad, n = postcheck(d)
        ok('apply: the post-check says ok on every row (%d)' % n, bad == [] and n == 39, bad)
        snap = [d.all('select * from public.%s order by 1, 2, 3' % t) for t in TABLES]
        r = d.file(FILE)
        ok('apply: a second run applies and changes nothing (catalog, every row)',
           r == 'ok' and catalog(d.c) == cat1 and [d.all('select * from public.%s order by 1, 2, 3' % t) for t in TABLES] == snap and rows_but_class(d) == rows0, r)
        d.run('set search_path = public, pg_temp')
        r = d.file(FILE); bad2, _n = postcheck(d)
        d.run('reset search_path')
        ok('apply: with public on the search path (as Supabase\'s tools run it) a run applies too, and the post-check agrees', r == 'ok' and bad2 == [], (r, bad2))
    finally:
        d.close()

# == refused ==
def scen_refused():
    d = copy('refused'); w = world()
    try:
        definer(d)
        r = d.file(FILE); assert r == 'ok', r
        same, other = crosses(w); k, k2, kb = w.k1, w.k2, w.kb
        n0 = counts(d)
        for who in WRITERS:
            for name, sql, kw in same:
                e = refused(d, lambda: write_as(d, who, sql, **kw))
                ok('refused: as %s, %s (23503)' % (who, name), e and e[1] == '23503', e)
            for name, sql, kw in other:
                e = refused(d, lambda: write_as(d, who, sql, **kw))
                ok('refused: as %s, %s (same_teacher first, 42501, as before)' % (who, name), e and e[1] == '42501', e)
        ok('refused: none of those left a row', counts(d) == n0)
        e = refused(d, lambda: d.role('authenticated', same[0][1], uid=A, **same[0][2]))
        ok('refused: a teacher is still refused by row security first, as before', e and e[1] == '42501' and 'row-level security' in e[0], e)
        def cls(t, e, a): return d.one('select course_id::text from public.%s where enrollment_id = :e and assessment_id = :a' % t, e=e, a=a)
        for who in WRITERS:
            d.begin()
            write_as(d, who, 'insert into public.score (enrollment_id, assessment_id, value, course_id) values (:e, :a, 4, :c)', e=k.e2, a=k.comp, c=k2.c)
            ok('refused: as %s, a class sent with a row is thrown away; the row gets its student\'s' % who, cls('score', k.e2, k.comp) == k.c)
            write_as(d, who, 'update public.score set course_id = :c where enrollment_id = :e and assessment_id = :a', c=k2.c, e=k.e2, a=k.comp)
            write_as(d, who, 'update public.score set course_id = null, value = 3 where enrollment_id = :e and assessment_id = :a', e=k.e2, a=k.comp)
            ok('refused: as %s, an update that names the class leaves it, and keeps the rest of the update' % who,
               cls('score', k.e2, k.comp) == k.c and d.one('select value::int from score where enrollment_id = :e and assessment_id = :a', e=k.e2, a=k.comp) == 3)
            e = refused(d, lambda: write_as(d, who, 'insert into public.score (enrollment_id, assessment_id, value, course_id) values (:e, :a, 4, :c)', e=k.e2, a=k2.pts, c=k2.c))
            ok('refused: as %s, claiming the assessment\'s class does not get a cross-class row in' % who, e and e[1] == '23503', e)
            for what, sql, kw in (
                    ('a student of another class', 'update public.score set enrollment_id = :n where enrollment_id = :e and assessment_id = :a', dict(n=k2.e1, e=k.e1, a=k.pts)),
                    ('an assessment of another class', 'update public.score set assessment_id = :n where enrollment_id = :e and assessment_id = :a', dict(n=k2.pts, e=k.e1, a=k.pts)),
                    ('a competency of another class', 'update public.tag_score set tag_id = :n where enrollment_id = :e and assessment_id = :a', dict(n=k2.t1, e=k.e1, a=k.comp)),
                    ('a criterion of another class', 'update public.rubric_score set criterion_id = :n where enrollment_id = :e and assessment_id = :a', dict(n=k2.crits[0], e=k.e1, a=k.rubp)),
                    ('a checkbox of another class', 'update public.rubric_check_score set check_id = :n where enrollment_id = :e and assessment_id = :a', dict(n=k2.checks[0], e=k.e1, a=k.rubp))):
                e = refused(d, lambda: write_as(d, who, sql, **kw))
                ok('refused: as %s, a row cannot be re-pointed to %s (23503)' % (who, what), e and e[1] == '23503', e)
            d.rollback()
        d.begin()
        d.run('update public.tag_score set tag_id = :n where enrollment_id = :e and assessment_id = :a', n=k.t2, e=k.e1, a=k.comp)
        d.run('update public.tag_score set enrollment_id = :n where enrollment_id = :e and assessment_id = :a', n=k.e2, e=k.e1, a=k.comp)
        d.run('update public.rubric_score set criterion_id = :n where enrollment_id = :e and assessment_id = :a', n=k.crits[1], e=k.e1, a=k.rubp)
        d.run('update public.rubric_check_score set check_id = :n where enrollment_id = :e and assessment_id = :a', n=k.checks[1], e=k.e1, a=k.rubp)
        ok('refused: within the class a row can still be re-pointed: another competency, student, criterion, checkbox',
           d.one('select count(*)::int from tag_score where enrollment_id = :e and assessment_id = :a and tag_id = :t and course_id = :c', e=k.e2, a=k.comp, t=k.t2, c=k.c) == 1
           and wrong_class(d) == 0)
        d.rollback()
        e = refused(d, lambda: d.run('insert into public.score (enrollment_id, assessment_id, value) values (gen_random_uuid(), :a, 4)', a=k.pts))
        ok('refused: a row for a student who does not exist is refused with the foreign-key error, as before', e and e[1] == '23503', e)
    finally:
        d.close()

# == moves ==
def scen_moves():
    d = copy('moves'); w = world()
    try:
        definer(d)
        r = d.file(FILE); assert r == 'ok', r
        k, k2 = w.k1, w.k2
        moves = [
            ('a section to a subject of another class (upsert_section)', lambda: T(d, "upsert_section(:x, :s, 'Questioning')", x=k.sect, s=k2.subj)),
            ('a competency to a section of another class (upsert_tag)', lambda: T(d, "upsert_tag(:t, :x, 'Ask questions')", t=k.t1, x=k2.sect)),
            ('a section\'s class, as the table owner', lambda: d.run('update section set course_id = :c, subject_id = :s where id = :x', c=k2.c, s=k2.subj, x=k.sect)),
            ('a rubric\'s class', lambda: d.run('update rubric set course_id = :c where id = :r', c=k2.c, r=k.rub)),
            ('a criterion to a rubric of another class', lambda: d.run('update criterion set rubric_id = :r where id = :x', r=k2.rub, x=k.crits[0])),
            ('a checkbox to a criterion of another class', lambda: d.run('update criterion_check set criterion_id = :x where id = :k', x=k2.crits[0], k=k.checks[0])),
            ('a competency with no levels to another class, from a SECURITY DEFINER function', lambda: write_as(d, WRITERS[0], 'update public.tag set section_id = :x where id = :t', x=k2.sect, t=k.t2)),
        ]
        for name, go in moves:
            e = refused(d, go)
            ok('moves: moving %s is refused' % name, e and e[1] == '23503' and 'cannot be moved to another class' in e[0], e)
        kb = w.kb
        e_other = refused(d, lambda: T(d, "upsert_tag(:t, :x, 'Ask questions')", t=k.t1, x=kb.sect))
        e_none = refused(d, lambda: T(d, "upsert_tag(:t, gen_random_uuid(), 'Ask questions')", t=k.t1))
        ok('moves: a teacher moving a competency to another teacher\'s section gets exactly the answer a made-up section gets '
           '(row security\'s, 42501), so nothing tells them the id exists', e_other == e_none and e_other and e_other[1] == '42501', (e_other, e_none))
        e_s = refused(d, lambda: T(d, "upsert_section(:x, :s, 'Questioning')", x=k.sect, s=kb.subj))
        e_sn = refused(d, lambda: T(d, "upsert_section(:x, gen_random_uuid(), 'Questioning')", x=k.sect))
        ok('moves: and a section moved to another teacher\'s subject gets what a made-up subject gets (%s)' % (e_s,), e_s == e_sn and e_s, (e_s, e_sn))
        for what, sql, kw in (('a competency', 'update public.tag set section_id = :x where id = :t', dict(x=kb.sect, t=k.t1)),
                              ('a criterion', 'update public.criterion set rubric_id = :r where id = :x', dict(r=kb.rub, x=k.crits[0])),
                              ('a checkbox', 'update public.criterion_check set criterion_id = :x where id = :k', dict(x=kb.crits[0], k=k.checks[0]))):
            for who in WRITERS:
                e = refused(d, lambda: write_as(d, who, sql, **kw))
                ok('moves: %s moved into another teacher\'s class by %s is refused (42501)' % (what, who), e and e[1] == '42501', e)
        d.begin()
        subj2 = str(T(d, "upsert_subject(null, :c, 'Socials')", c=k.c))
        sect2 = str(T(d, "upsert_section(null, :s, 'Evidence')", s=subj2))
        rub2 = ur(d, None, k.c, 'Essay', [crit('Thesis', ['Claim'])])
        crit2 = d.one('select id::text from criterion where rubric_id = :r', r=rub2)
        T(d, "upsert_section(:x, :s, 'Questioning')", x=k.sect, s=subj2)
        T(d, "upsert_tag(:t, :x, 'Plan a fair test')", t=k.t2, x=sect2)
        d.run('update criterion set rubric_id = :r where id = :x', r=rub2, x=k.crits[1])
        d.run('update criterion_check set criterion_id = :x where id = :k', x=crit2, k=k.checks[1])
        ok('moves: within the class all four still move: a section to another subject, a competency to another section, '
           'a criterion to another rubric, a checkbox to another criterion',
           d.one('select subject_id::text from section where id = :x', x=k.sect) == subj2 and d.one('select section_id::text from tag where id = :t', t=k.t2) == sect2
           and d.one('select rubric_id::text from criterion where id = :x', x=k.crits[1]) == rub2
           and d.one('select criterion_id::text from criterion_check where id = :k', k=k.checks[1]) == crit2)
        T(d, "upsert_section(:x, :s, 'Asking')", x=k.sect, s=subj2)
        T(d, "upsert_tag(:t, :x, 'Ask good questions')", t=k.t1, x=k.sect)
        ok('moves: a section and a competency are renamed as before', d.one('select name from section where id = :x', x=k.sect) == 'Asking'
           and d.one('select label from tag where id = :t', t=k.t1) == 'Ask good questions')
        d.rollback()
        for what, sql, kw in (('an enrollment', 'update enrollment set course_id = :c where id = :e', dict(c=k2.c, e=k.e1)),
                              ('an assessment', 'update assessment set course_id = :c where id = :a', dict(c=k2.c, a=k.pts))):
            e = refused(d, lambda: d.run(sql, **kw))
            ok('moves: %s that has score rows cannot be moved to another class' % what, e and e[1] == '23503', e)
        d.begin()
        empty = str(T(d, "create_assessment(p_course_id => :c, p_title => 'Empty', p_idempotency_key => gen_random_uuid())", c=k.c))
        d.run('update assessment set course_id = :c where id = :a', c=k2.c, a=empty)
        ok('moves: an assessment with no score rows can still be (no function does it)', d.one('select course_id::text from assessment where id = :a', a=empty) == k2.c)
        d.rollback()
    finally:
        d.close()

# == paths: the same story with and without the file ==
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
TS_RE = re.compile(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?|Z)?')
class Norm:
    """A reply as text: the world's ids by name, timestamps as <ts>. The two copies make the same new ids (same_ids)."""
    def __init__(self, known): self.map = {v: n for n, v in known.items()}
    def __call__(self, v):
        t = v if isinstance(v, str) else json.dumps(v, sort_keys=True, default=str)
        return TS_RE.sub('<ts>', UUID_RE.sub(lambda m: '<' + self.map.get(m.group(0), m.group(0)) + '>', t))

def same_ids(d):
    """gen_random_uuid() made to count, in this copy only, so two copies running the same story make the same ids."""
    d.run('create sequence public._m6_ids')
    d.run('grant usage on sequence public._m6_ids to public')
    d.run('set allow_system_table_mods = on')
    d.run("""create or replace function pg_catalog.gen_random_uuid() returns uuid language sql volatile
             as $f$ select md5('m6' || nextval('public._m6_ids'))::uuid $f$""")
    d.run('reset allow_system_table_mods')
def strip_class(v, path=()):
    """v without course_id inside get_assessment_detail's score objects; returns (v, how many were taken out)."""
    n = 0
    if isinstance(v, dict):
        out = {}
        for k2, x in v.items():
            if k2 == 'course_id' and path and path[-1] == 'score':
                n += 1; continue
            out[k2], m = strip_class(x, path + (k2,)); n += m
        return out, n
    if isinstance(v, list):
        out = []
        for x in v:
            y, m = strip_class(x, path); out.append(y); n += m
        return out, n
    return v, 0

def story(d, w):
    """Every writer, then every reader, as Teacher A. Yields (step, reply or error)."""
    k, k2 = w.k1, w.k2
    def call(sql, uid=A, **kw):
        try: return T(d, sql, uid, **kw)
        except Exception as e: return {'error': sqlstate(e), 'message': message(e)}
    def own(sql, **kw):
        try: d.run(sql, **kw); return 'ok'
        except Exception as e: return {'error': sqlstate(e), 'message': message(e)}
    steps = []
    s = lambda name, v: steps.append((name, v))
    s('upsert_score', call('upsert_score(:e, :a, 8)', e=k.e2, a=k.pts))
    s('upsert_score, again', call('upsert_score(:e, :a, 6, 1::smallint)', e=k.e2, a=k.pts))
    s('upsert_tag_score', call('upsert_tag_score(:e, :a, :t, 4)', e=k.e2, a=k.comp, t=k.t1))
    s('upsert_tag_score, a comment', call("upsert_tag_score(:e, :a, :t, 3, 0::smallint, 'Good start')", e=k.e2, a=k.comp, t=k.t2))
    s('upsert_rubric_score', call("upsert_rubric_score(:e, :a, :x, 2, 0::smallint, 'Check units', null, null)", e=k.e2, a=k.rubp, x=k.crits[1]))
    s('fill_rubric', call('fill_rubric(:e, :a, 3)', e=k.e2, a=k.rubp))
    s('set_rubric_check on', call('set_rubric_check(:e, :a, :k, true)', e=k.e2, a=k.rubp, k=k.checks[1]))
    s('set_rubric_check off', call('set_rubric_check(:e, :a, :k, false)', e=k.e1, a=k.rubp, k=k.checks[0]))
    s('save_score_comment', call("save_score_comment(:e, :a, 'Clear method')", e=k.e2, a=k.rubp))
    s('save_score_report_note', call("save_score_report_note(:e, :a, 'Ready for the report', gen_random_uuid())", e=k.e1, a=k.comp))
    s('set_score_status', call("set_score_status(:e, :a, 'LATE')", e=k.e1, a=k.dib))
    s('upsert_dibels_score', call("upsert_dibels_score(:e, :a, 'moy', 110, 1, 12, 2)", e=k.e2, a=k.dib))
    s('upsert_dibels_score, again', call("upsert_dibels_score(:e, :a, 'moy', 112, 1, 12, 2)", e=k.e2, a=k.dib))
    s('return_grades', call('return_grades(:a, array[:e1, :e2]::uuid[], gen_random_uuid())', a=k.rubp, e1=k.e1, e2=k.e2))
    s('upsert_rubric_score after return', call("upsert_rubric_score(:e, :a, :x, 4, 0::smallint, null, null, null)", e=k.e1, a=k.rubp, x=k.crits[0]))
    s('list_course_grade_returns', call('list_course_grade_returns(:c)', c=k.c))
    copyr = call("upsert_rubric(p_id => null, p_course_id => :c, p_name => 'Lab Rubric 2', p_criteria => :cr::jsonb, p_copy_group => null, "
                 "p_idempotency_key => gen_random_uuid(), p_style => 'advanced', p_linked_tag_ids => null)",
                 c=k.c, cr=json.dumps([crit('Method', ['Labels', 'Units']), crit('Analysis', ['Graph'])]))
    s('upsert_rubric, a copy', copyr)
    if isinstance(copyr, (str, _uuid.UUID)):
        nc = [r[0] for r in d.all('select id::text from criterion where rubric_id = :r order by display_order', r=str(copyr))]
        nk = [r[0] for r in d.all('select k.id::text from criterion_check k join criterion c on c.id = k.criterion_id where c.rubric_id = :r '
                                  'order by c.display_order, k.display_order', r=str(copyr))]
        s('move_rubric_scores', call('move_rubric_scores(:a, :r, :m::jsonb, :n::jsonb, gen_random_uuid())', a=k.rubp, r=str(copyr),
                                     m=json.dumps(dict(zip(k.crits, nc))), n=json.dumps(dict(zip(k.checks, nk)))))
        s('update_assessment to the copy', own('update assessment set rubric_id = :r where id = :a', r=str(copyr), a=k.rubp))
        s('upsert_rubric_score on the copy', call("upsert_rubric_score(:e, :a, :x, 2, 0::smallint, null, null, null)", e=k.e2, a=k.rubp, x=nc[0]))
    s('duplicate_assessment', call('duplicate_assessment(:a, gen_random_uuid())', a=k.comp))
    dup = steps[-1][1]
    if isinstance(dup, (str, _uuid.UUID)):
        s('upsert_tag_score on the copy', call('upsert_tag_score(:e, :a, :t, 2)', e=k.e1, a=str(dup), t=k.t1))
    s('duplicate_course', call('duplicate_course(:c, gen_random_uuid())', c=k.c))
    pts2 = str(call("create_assessment(p_course_id => :c, p_title => 'Restored', p_score_mode => 'points', p_max_points => 10, "
                    "p_idempotency_key => gen_random_uuid())", c=k.c))
    payload = {'scores': [{'enrollment_id': k.e1, 'assessment_id': pts2, 'value': 6, 'course_id': k2.c}],
               'tag_scores': [{'enrollment_id': k.e1, 'assessment_id': k.comp, 'tag_id': k.t2, 'value': 2, 'course_id': k2.c}],
               'rubric_scores': [{'enrollment_id': k.e1, 'assessment_id': k.rubp, 'criterion_id': k.crits[1], 'value': 1}],
               'rubric_check_scores': [{'enrollment_id': k.e1, 'assessment_id': k.rubp, 'check_id': k.checks[2]}]}
    s('import_json_restore', call('import_json_restore(:p::jsonb, gen_random_uuid())', p=json.dumps(payload)))
    bad = {'scores': [{'enrollment_id': k.e1, 'assessment_id': k2.pts, 'value': 6}]}
    s('import_json_restore, a score on another class', call('import_json_restore(:p::jsonb, gen_random_uuid())', p=json.dumps(bad)))
    s('get_class_bundle', call('get_class_bundle(:c, null)', c=k.c))
    s('get_gradebook', call('get_gradebook(:c)', c=k.c))
    for a in (k.pts, k.comp, k.rubp, k.dib):
        s('get_assessment_detail', call('get_assessment_detail(:a)', a=a))
    s('get_class_dashboard', call('get_class_dashboard(:c)', c=k.c))
    s('get_learning_map', call('get_learning_map(:c)', c=k.c))
    s('get_student_profile', call('get_student_profile(:e)', e=k.e1))
    s('clear_score', call('clear_score(:e, :a)', e=k.e2, a=k.comp))
    s('clear_row_scores', call('clear_row_scores(:e, :c)', e=k.e2, c=k.c))
    s('clear_column_scores', call('clear_column_scores(:a)', a=k.pts))
    s('delete_tag', call('delete_tag(:t)', t=k.t2))
    s('delete_rubric', call('delete_rubric(:r)', r=k.rub))
    s('delete_assessment', call('delete_assessment(:a)', a=k.dib))
    s('withdraw_student', call('withdraw_student(:e, gen_random_uuid())', e=k.e2))
    s('delete_withdrawn_student', call('delete_withdrawn_student(:e, gen_random_uuid())', e=k.e2))
    s('delete_section', call('delete_section(:x)', x=k.sect))
    s('delete_course', call('delete_course(:c)', c=k.c))
    s('the purge deletes the class', own('delete from course where id = :c', c=k.c))
    return steps

def dump(d, norm):
    """The five tables (course_id aside), grade_return and the sync cursors, normalised, sorted."""
    out = {}
    for t in TABLES + ['grade_return', 'course_sync_cursor']:
        rows = d.all("select to_jsonb(x) - 'course_id' - 'updated_at' - 'scored_at' - 'created_at' from public.%s x" % t)
        out[t] = sorted(norm(r[0]) for r in rows)
    return out

def scen_paths():
    w = world()
    known = {}
    for name, k in (('k1', w.k1), ('k2', w.k2), ('kb', w.kb)):
        for a in ('c', 'subj', 'sect', 't1', 't2', 'rub', 'pts', 'comp', 'rubp', 'dib', 'e1', 'e2'):
            known['%s.%s' % (name, a)] = getattr(k, a)
        for i, x in enumerate(k.crits): known['%s.crit%d' % (name, i)] = x
        for i, x in enumerate(k.checks): known['%s.check%d' % (name, i)] = x
    known['A'] = A; known['B'] = B
    out = {}
    for label, with_file in (('without', False), ('with', True)):
        d = copy('paths_' + label)
        try:
            if with_file:
                r = d.file(FILE); assert r == 'ok', r
            same_ids(d)
            nrm = Norm(known)
            steps = story(d, w)
            removed = 0; cleaned = []
            for name, v in steps:
                v2, n = strip_class(v) if with_file and name == 'get_assessment_detail' else (v, 0)
                removed += n; cleaned.append((name, nrm(v2)))
            out[label] = dict(steps=cleaned, dump=dump(d, Norm(known)), removed=removed, wrong=wrong_class(d) if with_file else 0,
                              drift=d.one(DRIFT), errors=[(n, v) for n, v in steps if isinstance(v, dict) and 'error' in v])
        finally:
            d.close()
    a, b = out['without'], out['with']
    def at(x, y):
        i = next((i for i in range(min(len(x), len(y))) if x[i] != y[i]), min(len(x), len(y)))
        return x[max(0, i - 120):i + 120], y[max(0, i - 120):i + 120]
    diff = [(x[0],) + at(x[1], y[1]) for x, y in zip(a['steps'], b['steps']) if x[1] != y[1]]
    ok('paths: %d steps, every reply the same with the file as without it (course_id aside)' % len(a['steps']),
       len(a['steps']) == len(b['steps']) and not diff, diff[:3])
    ok('paths: with the file get_assessment_detail\'s score objects carry course_id (%d), the only change in any reply: '
       'with it taken out there, every reply is the same as without the file (above)' % b['removed'], b['removed'] >= 4)
    ok('paths: after the story, the five tables, the returned grades and the sync cursors hold the same rows with the file as without',
       a['dump'] == b['dump'], [t for t in a['dump'] if a['dump'][t] != b['dump'][t]])
    ok('paths: with the file every row has its class, and every returned grade matches the scores', b['wrong'] == 0 and b['drift'] == 0 and a['drift'] == 0, (b['wrong'], b['drift']))
    ok('paths: the only refusal in the story is the restore of a score on another class, the same on both (%s)' % [n for n, _v in b['errors']],
       [n for n, _v in a['errors']] == [n for n, _v in b['errors']] == ['import_json_restore, a score on another class'], (a['errors'], b['errors']))

# == race ==
def teacher_conn(db):
    c = connect(db)
    c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')
    return c

def scen_race():
    w = world(); k = w.k1
    d = copy('race')
    try:
        stop = threading.Event(); errors = []; calls = [0]
        def saver(n):
            c = teacher_conn(d.name); rnd = random.Random(n)
            try:
                while not stop.is_set():
                    which = rnd.randrange(5)
                    try:
                        if which == 0: c.run('select upsert_score(:e, :a, :v)', e=rnd.choice([k.e1, k.e2]), a=k.pts, v=rnd.randrange(11))
                        elif which == 1: c.run('select upsert_tag_score(:e, :a, :t, :v)', e=rnd.choice([k.e1, k.e2]), a=k.comp, t=rnd.choice([k.t1, k.t2]), v=rnd.randrange(1, 5))
                        elif which == 2: c.run('select upsert_rubric_score(:e, :a, :x, :v)', e=rnd.choice([k.e1, k.e2]), a=k.rubp, x=rnd.choice(k.crits), v=rnd.randrange(1, 5))
                        elif which == 3: c.run('select set_rubric_check(:e, :a, :k, :on)', e=rnd.choice([k.e1, k.e2]), a=k.rubp, k=rnd.choice(k.checks), on=rnd.random() < .5)
                        else: c.run('select get_class_bundle(:c, null)', c=k.c)
                        calls[0] += 1
                    except Exception as e:
                        errors.append((which, sqlstate(e), message(e)[:120]))
            finally:
                c.close()
        rounds = []
        for rnd_ in range(5):
            stop.clear(); errors.clear(); calls[0] = 0
            ts = [threading.Thread(target=saver, args=(i + 10 * rnd_,)) for i in range(4)]
            for t in ts: t.start()
            time.sleep(0.4)
            t0 = time.time(); r = d.file(FILE); took = time.time() - t0
            time.sleep(0.4); stop.set()
            for t in ts: t.join()
            rounds.append((r, round(took, 2), calls[0], list(errors), wrong_class(d) if applied(d) else None, d.one(DRIFT)))
            print('round', rnd_, rounds[-1][:3], len(errors), errors[:3], file=sys.stderr)
            if rnd_ < 4 and applied(d):
                u = undo1(d); assert u == 'ok', u
        RESULTS['race_apply'] = [(x[0], x[1], x[2], len(x[3])) for x in rounds]
        ok('race: five rounds of the file applied while four connections save and load: it applies every time %s' % [(x[1], x[2]) for x in rounds],
           all(x[0] == 'ok' for x in rounds), [x[0] for x in rounds])
        ok('race: and no save or load failed in any round', all(not x[3] for x in rounds), [x[3][:3] for x in rounds])
        ok('race: after each round every row has its class and every returned grade matches', all(x[4] == 0 and x[5] == 0 for x in rounds), [(x[4], x[5]) for x in rounds])
    finally:
        d.close()
    for hold, expect in ((16.5, 'stops'), (2.0, 'applies')):
        d = copy('race_hold')
        try:
            c = teacher_conn(d.name); c.run('begin'); c.run('select upsert_score(:e, :a, 3)', e=k.e1, a=k.pts)
            cat0 = catalog(d.c)
            def let_go():
                time.sleep(hold); c.run('commit')
            t = threading.Thread(target=let_go); t.start()
            t0 = time.time(); r = d.file(FILE); took = time.time() - t0
            t.join(); c.close()
            if expect == 'stops':
                ok('race: a save held open for %.1f s stops the file after fifteen seconds of trying (%.1f s), with nothing changed' % (hold, took),
                   r.startswith('STOPPED') and 'busy for fifteen seconds' in r and catalog(d.c) == cat0 and 14.5 < took < 16.5, (r, took))
            else:
                ok('race: a save held open for %.1f s is waited for, then the file applies (%.1f s)' % (hold, took),
                   r == 'ok' and wrong_class(d) == 0 and 1.5 < took < 4, (r, took))
        finally:
            d.close()
    # every writer at once, with and without the file
    seen = {'without': [], 'with': []}
    reps = int(os.environ.get('RACE_REPS', '4'))
    for rep in range(reps):
        for label, with_file in (('without', False), ('with', True)):
            d = copy('race_all_' + label)
            try:
                if with_file:
                    r = d.file(FILE); assert r == 'ok', r
                ops = matrix_ops(w); res = {}; waits = set(); lock = threading.Lock()
                def worker(n):
                    c = teacher_conn(d.name); rnd = random.Random(1000 * rep + n)
                    try:
                        for _ in range(int(os.environ.get('RACE_CALLS', '150'))):
                            name, sql, kw = rnd.choice(ops)
                            try:
                                c.run('select ' + sql, **kw(rnd)); st = 'ok'
                            except Exception as e:
                                st = sqlstate(e)
                                if st == '40P01':
                                    detail = e.args[0].get('D', '') if e.args and isinstance(e.args[0], dict) else ''
                                    with lock: waits.update(re.findall(r'waits for (\w+) on (transaction|tuple \([0-9,]+\) of relation \d+|relation \d+)', detail))
                            with lock: res.setdefault(name, {}).setdefault(st, 0); res[name][st] += 1
                    finally:
                        c.close()
                ts = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
                for t in ts: t.start()
                for t in ts: t.join()
                names = {}
                for lk, what in waits:
                    m = re.search(r'relation (\d+)', what)
                    names['a row of ' + d.one('select :o::oid::regclass::text', o=int(m.group(1))) if m and what.startswith('tuple')
                          else ('the table ' + d.one('select :o::oid::regclass::text', o=int(m.group(1))) if m else 'a transaction')] = 1
                seen[label].append(dict(res=res, waits=sorted(names), wrong=wrong_class(d) if with_file else 0, drift=d.one(DRIFT)))
            finally:
                d.close()
    dead = lambda runs: [sum(v.get('40P01', 0) for v in r['res'].values()) for r in runs]
    kinds = lambda runs: {(n, st) for r in runs for n in r['res'] for st in r['res'][n] if st not in ('ok', '40P01')}
    waits = lambda runs: {x for r in runs for x in r['waits']}
    RESULTS['race_all'] = dict(deadlocks_without=dead(seen['without']), deadlocks_with=dead(seen['with']),
                               waits_without=sorted(waits(seen['without'])), waits_with=sorted(waits(seen['with'])),
                               kinds_without=sorted(kinds(seen['without'])), kinds_with=sorted(kinds(seen['with'])))
    ok('race: every writer at once on eight connections, %d runs each: no error with the file that is not there without it' % reps,
       kinds(seen['with']) <= kinds(seen['without']), sorted(kinds(seen['with']) - kinds(seen['without'])))
    ok('race: today\'s functions deadlock with each other without the file too (%s); with it (%s) every deadlock waits on '
       'a row of a score table or of the sync cursor, or a transaction, as without it (%s), never a table lock or a row of '
       'enrollment, assessment or the learning map: %s' % (dead(seen['without']), dead(seen['with']), sorted(waits(seen['without'])),
                                                            sorted(waits(seen['with']))),
       waits(seen['with']) <= ALLOWED_WAITS and waits(seen['without']) <= ALLOWED_WAITS, sorted(waits(seen['with']) - ALLOWED_WAITS))
    ok('race: afterwards every row has its class and every returned grade matches, in every run',
       all(r['wrong'] == 0 and r['drift'] == 0 for r in seen['with']) and all(r['drift'] == 0 for r in seen['without']))

ALLOWED_WAITS = {'a transaction', 'a row of course_sync_cursor', 'a row of grade_return'} | {'a row of ' + t for t in TABLES}

def matrix_ops(w):
    k = w.k1
    e = lambda r: r.choice([k.e1, k.e2])
    return [
        ('upsert_score', 'upsert_score(:e, :a, :v)', lambda r: dict(e=e(r), a=k.pts, v=r.randrange(11))),
        ('upsert_tag_score', 'upsert_tag_score(:e, :a, :t, :v)', lambda r: dict(e=e(r), a=k.comp, t=r.choice([k.t1, k.t2]), v=r.randrange(1, 5))),
        ('upsert_rubric_score', 'upsert_rubric_score(:e, :a, :x, :v)', lambda r: dict(e=e(r), a=k.rubp, x=r.choice(k.crits), v=r.randrange(1, 5))),
        ('fill_rubric', 'fill_rubric(:e, :a, :v)', lambda r: dict(e=e(r), a=k.rubp, v=r.randrange(1, 5))),
        ('set_rubric_check', 'set_rubric_check(:e, :a, :k, :on)', lambda r: dict(e=e(r), a=k.rubp, k=r.choice(k.checks), on=r.random() < .5)),
        ('save_score_comment', "save_score_comment(:e, :a, 'Note')", lambda r: dict(e=e(r), a=k.comp)),
        ('set_score_status', "set_score_status(:e, :a, :s)", lambda r: dict(e=e(r), a=k.pts, s=r.choice(['LATE', 'NS', None]))),
        ('upsert_dibels_score', "upsert_dibels_score(:e, :a, 'boy', :v, 0, 0, 0)", lambda r: dict(e=e(r), a=k.dib, v=r.randrange(200))),
        ('clear_score', 'clear_score(:e, :a)', lambda r: dict(e=e(r), a=r.choice([k.pts, k.comp, k.rubp]))),
        ('clear_row_scores', 'clear_row_scores(:e, :c)', lambda r: dict(e=e(r), c=k.c)),
        ('clear_column_scores', 'clear_column_scores(:a)', lambda r: dict(a=r.choice([k.pts, k.comp, k.rubp]))),
        ('return_grades', 'return_grades(:a, array[:e]::uuid[], gen_random_uuid())', lambda r: dict(a=k.rubp, e=e(r))),
        ('upsert_section', "upsert_section(:x, :s, 'Questioning')", lambda r: dict(x=k.sect, s=k.subj)),
        ('upsert_tag', "upsert_tag(:t, :x, 'Ask questions')", lambda r: dict(t=r.choice([k.t1, k.t2]), x=k.sect)),
        ('get_class_bundle', 'get_class_bundle(:c, null)', lambda r: dict(c=k.c)),
        ('get_assessment_detail', 'get_assessment_detail(:a)', lambda r: dict(a=r.choice([k.pts, k.comp, k.rubp]))),
    ]

# == timing ==
def inflate(d, w, factor):
    """Adds students, pieces and rows by hand (as the owner) to reach factor x production. Test rows only: the five
    tables' own triggers are off while they go in (a sync bump per row is what makes it slow), and on again after."""
    k = w.k1
    for t in TABLES: d.run('alter table public.%s disable trigger user' % t)
    n_stu = 32 * factor
    d.run("""insert into student (id, teacher_id, first_name) select gen_random_uuid(), :t, 'S' || g from generate_series(1, :n) g""", t=A, n=n_stu)
    d.run("""insert into enrollment (student_id, course_id) select s.id, :c from student s where s.first_name ~ '^S[0-9]+$'""", c=k.c)
    enr = n_stu
    def pieces(kind, n, **cols):
        d.run("""insert into assessment (course_id, title, score_mode, max_points, rubric_id) select :c, :p || g, :m, :mp, :r from generate_series(1, :n) g""",
              c=k.c, p=kind, m=cols.get('mode', 'proficiency'), mp=cols.get('mp'), r=cols.get('rub'), n=n)
        return [r[0] for r in d.all('select id::text from assessment where course_id = :c and title ~ :pat', c=k.c, pat='^' + kind + '[0-9]+$')]
    need_s = PROD['score'] * factor; need_t = PROD['tag_score'] * factor
    need_r = PROD['rubric_score'] * factor; need_k = PROD['rubric_check_score'] * factor
    ps = pieces('P', -(-need_s // enr), mode='points', mp=10)
    ts = pieces('C', -(-need_t // (enr * 2)))
    rs = pieces('R', -(-need_r // (enr * 2)), rub=k.rub)
    d.run("""insert into score (enrollment_id, assessment_id, value) select e.id, a.id, 5 from enrollment e cross join unnest(:p::uuid[]) a(id)
              where e.course_id = :c limit :n""", p=ps, c=k.c, n=need_s)
    d.run("""insert into tag_score (enrollment_id, assessment_id, tag_id, value) select e.id, a.id, t.id, 3 from enrollment e
              cross join unnest(:p::uuid[]) a(id) cross join unnest(:t::uuid[]) t(id) where e.course_id = :c limit :n""", p=ts, t=[k.t1, k.t2], c=k.c, n=need_t)
    d.run("""insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) select e.id, a.id, x.id, 3 from enrollment e
              cross join unnest(:p::uuid[]) a(id) cross join unnest(:x::uuid[]) x(id) where e.course_id = :c limit :n""", p=rs, x=k.crits, c=k.c, n=need_r)
    d.run("""insert into rubric_check_score (enrollment_id, assessment_id, check_id) select e.id, a.id, x.id from enrollment e
              cross join unnest(:p::uuid[]) a(id) cross join unnest(:x::uuid[]) x(id) where e.course_id = :c
              on conflict do nothing""", p=rs, x=k.checks, c=k.c)
    d.run("""delete from rubric_check_score where ctid in (select ctid from rubric_check_score offset :n)""", n=need_k)
    for t in TABLES: d.run('alter table public.%s enable trigger user' % t)
    d.run('analyze')

def scen_timing():
    w = world(); out = []
    for factor in (1, 20):
        base = copy('timing_base')
        inflate(base, w, factor); n = counts(base); base.c.close()
        times = []
        try:
            for run in range(3):
                d = Db('m6_timing', template=base.name)
                try:
                    t0 = time.time(); r = d.file(FILE); took = time.time() - t0
                    assert r == 'ok', r
                    times.append(took)
                    if run == 0: ok('timing: x%d, the file applies on %s rows and every row has its class' % (factor, n), wrong_class(d) == 0)
                finally:
                    d.close()
        finally:
            admin('drop database if exists "%s" with (force)' % base.name)
        out.append((factor, n, round(min(times), 2), round(max(times), 2)))
    RESULTS['timing'] = out
    ok('timing: the whole file, three runs each (factor, rows, fastest s, slowest s): %s' % out, out[0][3] < 2.0, out)

# == undo ==
def scen_undo():
    w = world(); k, k2 = w.k1, w.k2
    d = copy('undo')
    try:
        definer(d)
        cat0, rows0 = catalog(d.c), rows_but_class(d)
        r = undo0(d); r1 = undo1(d)
        ok('undo: on a database without the file both parts run and change nothing', r == 'ok' and r1 == 'ok' and catalog(d.c) == cat0, (r, r1))
        r = d.file(FILE); assert r == 'ok', r
        cat1 = catalog(d.c)
        r = undo0(d)
        ok('undo: PART 0 runs', r == 'ok', r)
        gone, new = differences(cat1, catalog(d.c))
        ok('undo: PART 0 takes away exactly the eight checking triggers', all(l.startswith('depends ') for l in new) and len([l for l in gone if l.startswith('trigger ')]) == 8
           and all(re.match(r'^(trigger |depends |internal triggers )', l) for l in gone), (gone, new))
        d.begin()
        T(d, "upsert_tag(:t, :x, 'Ask questions')", t=k.t1, x=k2.sect)
        ok('undo: after PART 0 a competency moves to another class again', d.one('select section_id::text from tag where id = :t', t=k.t1) == k2.sect)
        d.rollback()
        e = refused(d, lambda: write_as(d, WRITERS[0], 'insert into public.score (enrollment_id, assessment_id, value) values (:e, :a, 4)', e=k.e2, a=k2.pts))
        ok('undo: after PART 0 a score on another class\'s assessment is still refused (the keys stay)', e and e[1] == '23503', e)
        ok('undo: a second PART 0 changes nothing', undo0(d) == 'ok' and differences(cat1, catalog(d.c)) == (gone, new))
        T(d, 'upsert_score(:e, :a, 2)', e=k.e2, a=k.pts)
        rows_mid = rows_but_class(d)
        r = undo1(d)
        ok('undo: PART 1 runs', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c))
        ok('undo: after PART 1 the catalog is as before the file but five dropped-column slots', not gone
           and all(l.startswith(('dropped columns ', 'depends ')) for l in new) and len([l for l in new if l.startswith('dropped columns ')]) == 5, (gone, new))
        ok('undo: and every row of every table is as before PART 1 (a score saved in between kept)', rows_but_class(d) == rows_mid)
        cat2 = catalog(d.c)
        ok('undo: a second PART 1 changes nothing', undo1(d) == 'ok' and catalog(d.c) == cat2)
        e = refused(d, lambda: write_as(d, WRITERS[0], 'insert into public.score (enrollment_id, assessment_id, value) values (:e, :a, 4)', e=k.e2, a=k2.pts))
        ok('undo: after PART 1 a cross-class row is accepted again from a SECURITY DEFINER function, as before the file', e is None, e)
        d.run('delete from score where enrollment_id = :e and assessment_id = :a', e=k.e2, a=k2.pts)
        r = d.file(FILE)
        ok('undo: the file applies again after the undo', r == 'ok' and wrong_class(d) == 0, r)
        d.run('alter table public.tag_score drop constraint tag_score_assessment_id_fkey')
        d.run('alter table public.tag_score add constraint tag_score_assessment_id_fkey foreign key (assessment_id) references public.assessment (id)')
        cat3 = catalog(d.c)
        r = undo1(d)
        ok('undo: a key that is neither the file\'s nor the one before stops PART 1 with nothing changed', r.startswith('STOPPED') and 'neither' in r and catalog(d.c) == cat3, r)
        ok('undo: whole, the file is PART 0 then PART 1', text_of(UNDO).index('-- PART 0 ends') < text_of(UNDO).index('-- PART 1 begins'))
    finally:
        d.close()
    d = copy('undo_whole')
    try:
        cat0, rows0 = catalog(d.c), rows_but_class(d)
        r = d.file(FILE); assert r == 'ok', r
        r = d.file(UNDO)
        gone, new = differences(cat0, catalog(d.c))
        ok('undo: the whole undo file straight after the apply leaves the catalog as before (but the slots) and every row as before',
           r == 'ok' and not gone and all(l.startswith(('dropped columns ', 'depends ')) for l in new) and rows_but_class(d) == rows0, (r, gone, new))
    finally:
        d.close()


# == chain: the review's deadlock, built on purpose ==
OLD_LOCKS = '''do $locks$
begin
    loop
        begin
            perform set_config('lock_timeout', '200ms', true);
            lock table public.section, public.tag, public.rubric, public.criterion, public.criterion_check,
                       public.assessment, public.enrollment,
                       public.score, public.tag_score, public.rubric_score, public.rubric_check_score, public.dibels_score
                in access exclusive mode;
            exit;
        exception when lock_not_available then
        end;
    end loop;
    perform set_config('lock_timeout', '5s', true);
end
$locks$;'''
def scen_chain():
    chain_once(FILE, 'the file', True)
    text = text_of(FILE); a = text.index('do $locks$'); b = text.index('$locks$;', a + 12) + len('$locks$;')
    p = os.path.join(HERE, '_m6_chain_mutant.sql'); open(p, 'w').write(text[:a] + OLD_LOCKS + text[b:])
    try:
        seen = []
        for _ in range(3):                           # timing: the cycle forms on most tries, not on every one
            seen.append(chain_once('_m6_chain_mutant.sql', None, False))
            if seen[-1].startswith('40P01'): break
        ok('chain: with a copy with the lock step the review found (0.2 s for each table, not for the try) the teacher is '
           'cancelled as a deadlock, so the test can see one: %s' % seen, seen[-1].startswith('40P01'), seen)
    finally:
        os.remove(p)
def chain_once(rel, label, expect_ok):
    """Six sessions hold six of the file's tables and let go 170 ms apart (each wait under 0.2 s, 1.02 s in all); a
    seventh, a teacher's, holds dibels_score and asks for section 120 ms after the file starts, so its one deadlock
    check (1 s later) falls while the old lock step waits on dibels_score. With the lock step the review found, the
    teacher was cancelled as a deadlock."""
    d = copy('chain')
    try:
        held = ['public.criterion_check', 'public.assessment', 'public.enrollment', 'public.score', 'public.tag_score', 'public.rubric_score']
        conns = [connect(d.name) for _ in held]
        for c, t in zip(conns, held): c.run('begin'); c.run('select 1 from %s limit 1' % t)
        teacher = connect(d.name); teacher.run('begin'); teacher.run('select 1 from public.dibels_score limit 1')
        out = {}
        def release():
            for c in conns: time.sleep(0.17); c.run('commit')
        def teach():
            time.sleep(0.12)
            try:
                teacher.run('select 1 from public.section limit 1'); time.sleep(0.05); teacher.run('commit'); out['teacher'] = 'ok'
            except Exception as e:
                out['teacher'] = sqlstate(e) + ' ' + message(e); teacher.run('rollback')
        ts = [threading.Thread(target=release), threading.Thread(target=teach)]
        for t in ts: t.start()
        t0 = time.time(); r = d.file(rel); took = time.time() - t0
        for t in ts: t.join()
        for c in conns + [teacher]: c.close()
        if expect_ok:
            ok('chain: with %s the teacher waiting in the middle of a chain of held tables is not cancelled: %s' % (label, out.get('teacher')), out.get('teacher') == 'ok', out)
            ok('chain: and the file applies (%.2f s)' % took, r == 'ok' and wrong_class(d) == 0, r)
        return str(out.get('teacher', ''))
    finally:
        d.close()

# == owner: as live applies it, a table owner that is not a superuser ==
def scen_owner():
    d = copy('owner'); w = world(); k, k2 = w.k1, w.k2
    try:
        d.run("do $r$ begin if not exists (select 1 from pg_roles where rolname = 'm6_owner') then create role m6_owner nologin; end if; end $r$")
        for t in TABLES + ['enrollment', 'assessment', 'section', 'tag', 'rubric', 'criterion', 'criterion_check', 'course']:
            d.run('alter table public.%s owner to m6_owner' % t)
        d.run('grant usage, create on schema public to m6_owner')
        ok('owner: m6_owner is not a superuser and owns the twelve tables (and course)',
           d.one("select not rolsuper from pg_roles where rolname = 'm6_owner'") and
           d.one("select count(*)::int from pg_class where relowner = 'm6_owner'::regrole and relkind = 'r'") == 13)
        rows0 = rows_but_class(d)
        d.run('set role m6_owner'); r = d.file(FILE); d.run('reset role')
        ok('owner: the file applies as that owner', r == 'ok', r)
        bad, n = postcheck(d)
        ok('owner: the post-check says ok on every row (%d)' % n, bad == [] and n == 39, bad)
        ok('owner: every row has its class and reads as before', wrong_class(d) == 0 and rows_but_class(d) == rows0)
        e = refused(d, lambda: T(d, "upsert_tag(:t, :x, 'Ask questions')", t=k.t1, x=k2.sect))
        ok('owner: its triggers work: a move to another class is refused', e and e[1] == '23503', e)
        T(d, 'upsert_score(:e, :a, 4)', e=k.e2, a=k.pts)
        ok('owner: a save fills its class', wrong_class(d) == 0)
        d.run('set role m6_owner'); r0 = undo0(d); r1 = undo1(d); d.run('reset role')
        ok('owner: both parts of the undo run as that owner', r0 == 'ok' and r1 == 'ok', (r0, r1))
        ok('owner: and leave no course_id column', d.one("select count(*)::int from information_schema.columns where table_schema = 'public' "
                                                         "and column_name = 'course_id' and table_name = any (:t)", t=TABLES) == 0)
    finally:
        d.close()

# == fingerprints: the tested shape of every table the file touches, written into the read-only file ==
def fp_rows(d):
    d.run('set search_path = public, pg_temp')
    text = text_of(FPS)
    r = d.statements(split(text))
    d.run('reset search_path')
    assert r == 'ok', r
    return d.rows
def scen_fingerprints():
    d = Db('m6_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        p = os.path.join(HERE, FPS)
        def put(rows):
            t = open(p).read()
            a = t.index('-- FINGERPRINTS-BEGIN tables\n') + len('-- FINGERPRINTS-BEGIN tables\n'); b = t.index('    -- FINGERPRINTS-END')
            open(p, 'w').write(t[:a] + ',\n'.join("    ('%s', '%s')" % x for x in rows) + '\n' + t[b:])
        put([('none', 'none')])                      # an empty list: every row comes back with its value
        have = sorted((w, live) for w, live, _t in fp_rows(d) if w != 'none')
        put(have)
        ok('fingerprints: written for %d tables and get_assessment_detail' % (len(have) - 1), len(have) == 14, have)
        ok('fingerprints: on the template itself the file then returns no rows', fp_rows(d) == [])
    finally:
        d.close()

SCENARIOS = ['today', 'guards', 'apply', 'refused', 'moves', 'paths', 'chain', 'owner', 'race', 'timing', 'undo']
if __name__ == '__main__':
    pick = sys.argv[1:] or SCENARIOS
    try:
        for s in pick:
            t0 = time.time(); globals()['scen_' + s](); print('-- %s: %.1f s' % (s, time.time() - t0), file=sys.stderr)
    finally:
        drop_world()
        if RESULTS and os.environ.get('M6_RESULTS'):
            open(os.environ['M6_RESULTS'], 'w').write(json.dumps(RESULTS, default=str, indent=1))
    finish()
