"""What Batch A's test scripts share: the connection, acting as a teacher or
a role, the check list, and a class to grade in. Not a test itself."""
import os, sys, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
ENR_B = 'eeeeeeee-2222-0000-0000-000000000001'
STU1 = 'aaaaaaaa-1111-0000-0000-000000000001'; STU2 = 'aaaaaaaa-1111-0000-0000-000000000002'
HERE = os.path.dirname(os.path.abspath(__file__))
passed = []; failed = []

def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:500]))

c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))

def as_teacher(uid):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run('set role authenticated')
def as_role(role):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', '', true)"); c.run('set role ' + role)
def as_owner(): c.run('reset role')
def sp(): c.run('savepoint sp')
def back(): c.run('rollback to savepoint sp')
def expect_error(name, fn, code=None):
    sp()
    try:
        fn(); ok(name, False, 'no error raised')
    except Exception as e:
        msg = str(e); ok(name, (code in msg) if code else True, msg)
    finally:
        back()
def key(): return str(uuid.uuid4())
def new_id(): return str(uuid.uuid4())
def plain(v): return str(v) if isinstance(v, uuid.UUID) else v
def one(sql, **kw):
    as_owner(); r = c.run(sql, **kw); return plain(r[0][0]) if r else None
def rows(sql, **kw):
    as_owner(); return [[plain(v) for v in r] for r in c.run(sql, **kw)]
def rpc(uid, sql, **kw):
    as_teacher(uid); r = c.run('select ' + sql, **kw); return plain(r[0][0]) if r else None
def svc(sql, **kw):
    """As the edge function calls it."""
    as_role('service_role'); r = c.run('select ' + sql, **kw); return r[0][0] if r else None

def finish():
    c.run('rollback')
    print('\n'.join('PASS ' + p for p in passed))
    print('\n'.join('FAIL ' + f for f in failed))
    print(f'{len(passed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)

def build_class(course=COURSE_A):
    """Two competencies and a two-criterion Advanced Rubric in the class.
    Returns their ids under the names the grade-state cases use."""
    as_owner()
    k = {n: new_id() for n in ('subj', 'sect', 't1', 't2', 'r1', 'c1', 'c2', 'k1', 'k2')}
    c.run("insert into subject (id, course_id, name) values (:s, :c, 'Science')", s=k['subj'], c=course)
    c.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Questioning')", x=k['sect'], c=course, s=k['subj'])
    c.run("insert into tag (id, section_id, label, code) values (:t1, :x, 'Ask questions', 'Q1'), (:t2, :x, 'Plan a fair test', 'Q2')",
          t1=k['t1'], t2=k['t2'], x=k['sect'])
    c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report', 'advanced')", r=k['r1'], c=course)
    c.run("insert into criterion (id, rubric_id, name, display_order) values (:c1, :r, 'Method', 0), (:c2, :r, 'Conclusion', 1)",
          c1=k['c1'], c2=k['c2'], r=k['r1'])
    c.run("insert into criterion_check (id, criterion_id, level, label) values (:k1, :c1, 3, 'Lists every step'), (:k2, :c2, 3, 'Answers the question')",
          k1=k['k1'], c1=k['c1'], k2=k['k2'], c2=k['c2'])
    return k

def new_assessment(k, work, course=COURSE_A, title=None, date_assigned=None):
    """An assessment of one of the cases' kinds: competencies, rubric, points or dibels."""
    as_owner()
    a = new_id()
    c.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id, date_assigned)
             values (:a, :c, :t, :m, :p, :r, :d)""",
          a=a, c=course, t=title or (work.capitalize() + ' work'), m=work if work in ('points', 'dibels') else 'proficiency',
          p=10 if work == 'points' else None, r=k['r1'] if work == 'rubric' else None, d=date_assigned)
    if work == 'competencies':
        c.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :t1), (:a, :t2)', a=a, t1=k['t1'], t2=k['t2'])
    return a

def set_class(student_page, return_grades, course=COURSE_A):
    as_owner()
    c.run('update course set student_page_enabled = :s, return_grades = :r where id = :c', s=student_page, r=return_grades, c=course)

def state(e, a):
    """none, draft or returned, as the grade-state cases name it."""
    r = rows('select is_draft, returned_at from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
    if not r: return 'none'
    return 'draft' if r[0][0] else ('returned' if r[0][1] is not None else 'none')

def returned_grade(e, a):
    return one('select student_submit._returned_grade(:e, :a)', e=e, a=a)

def working_copy(e, a):
    return one('select public._grade_copy(:e, :a)', e=e, a=a)

def score_fingerprint():
    """Every row of the four score tables, as one hash."""
    return one("""select md5(coalesce((select string_agg(x::text, '|' order by x::text) from score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from tag_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_check_score x), ''))""")

def keyed_cards():
    """True when 2026111003_card_codes_keyed.sql (S3-M1) is applied: cards are made and found by tag."""
    return one("select to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is not null")

def card_session(enrollment=ENR1, birthday='2012-05-15', course=COURSE_A, teacher=A):
    """A card for one student and a phone signed in with it, the way this database makes cards: Batch A's
    (the code is read back from the table), or by tag once S3-M1 is applied (card_codes_common.py plays
    the edge functions, with its fake key). Returns the session token."""
    if not keyed_cards():
        rpc(teacher, 'issue_student_cards(:c, null, :k)', c=course, k=key())
        code = one('select code from student_card where enrollment_id = :e and stopped_at is null', e=enrollment)
        return svc("student_submit.verify_card(:c, :b, null, null, null, 'ip-1', false)", c=code, b=birthday)['session_token']
    import card_codes_common as cc
    p = cc.Printed([(enrollment, one('select id from student_card where enrollment_id = :e and stopped_at is null', e=enrollment))])
    reply = svc('student_submit.issue_cards(:t, :c, :i::jsonb, :k, null)', t=teacher, c=course, i=p.json(), k=cc.KEY_ID)
    code = p.codes(reply)[enrollment][0]
    return svc("student_submit.verify_card(:h, :k, :b, null, null, null, 'ip-1', false)", h=cc.code_tag(code), k=cc.KEY_ID, b=birthday)['session_token']

def live_md5(before_s0_m5=False):
    """name -> md5 of the live function. before_s0_m5: as the four that S0-M5 changed were before it (the file's marked lines)."""
    want = {}; before = {}
    for line in open(os.path.join(HERE, 'live-function-md5.txt')):
        if line.startswith('#before-s0-m5 '):
            _mark, name, md5, _length = line.split(); before[name] = md5
        elif line.strip() and not line.startswith('#') and len(line.split()) == 3:   # a fourth word: grade_return_race.py's
            name, md5, _length = line.split(); want[name] = md5
    if before_s0_m5: want.update(before)
    return want
