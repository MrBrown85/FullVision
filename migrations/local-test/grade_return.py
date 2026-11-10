"""Exercise migrations/2026110902_grade_return.sql (S0-M1, Draft and
Returned) on the local stand-in:

- every case in tests/fixtures/grade-state-cases.json, run through the score
  RPCs, the triggers and student_submit._returned_grade (the same file runs
  through shared/grade-state.js);
- the two server checks (a criterion off the rubric; Missing on scored work);
- return_grades, list_course_grade_returns, the two class settings;
- each bulk path by name: the restore (a new backup and an old one),
  move_rubric_scores, Duplicate Class, Copy Assessment, the two bulk clears,
  and deleting an assessment, a criterion and a student;
- what Teacher B, no JWT, anon and a teacher going straight at the table get.

One transaction, rolled back at the end. Build the database as README.md,
"Batch A", says, then:

PGPORT=54329 PGDATABASE=fv_a python3 grade_return.py
"""
import json, os, time, uuid
from batch_a_common import *

c.run('begin')
K = build_class()
T1, T2, C1, C2, K1, K2 = (K[n] for n in ('t1', 't2', 'c1', 'c2', 'k1', 'k2'))
SYMBOL = {K[n]: n for n in ('t1', 't2', 'c1', 'c2', 'k1', 'k2')}

def symbols(copy):
    """A copy with its ids replaced by the cases' names."""
    if copy is None: return None
    return dict(copy, tags={SYMBOL.get(i, i): v for i, v in copy['tags'].items()},
                criteria={SYMBOL.get(i, i): v for i, v in copy['criteria'].items()},
                checks=sorted(SYMBOL.get(i, i) for i in copy['checks']))

def do(step, e, a, K):
    kind = step['do']
    if kind == 'level':
        rpc(A, 'upsert_tag_score(:e, :a, :t, :v, :m::smallint, :c)', e=e, a=a, t=K[step['tag']], v=step['value'],
            m=step.get('modifier', 0), c=step.get('comment'))
    elif kind == 'criterion':
        rpc(A, 'upsert_rubric_score(:e, :a, :x, :v, :m::smallint, :c, :b)', e=e, a=a, x=K[step['criterion']], v=step['value'],
            m=step.get('modifier', 0), c=step.get('comment'), b=step.get('beyond'))
    elif kind == 'score':
        rpc(A, 'upsert_score(:e, :a, :v, :m::smallint)', e=e, a=a, v=step['value'], m=step.get('modifier', 0))
    elif kind == 'tick':
        rpc(A, 'set_rubric_check(:e, :a, :k, :on)', e=e, a=a, k=K[step['check']], on=step['on'])
    elif kind == 'comment':
        rpc(A, 'save_score_comment(:e, :a, :t)', e=e, a=a, t=step['text'])
    elif kind == 'note':
        rpc(A, 'save_score_report_note(:e, :a, :t, :k)', e=e, a=a, t=step['text'], k=key())
    elif kind == 'status':
        rpc(A, 'set_score_status(:e, :a, :s)', e=e, a=a, s=step['status'])
    elif kind == 'clear':
        rpc(A, 'clear_score(:e, :a)', e=e, a=a)
    elif kind == 'return':
        who = [STUDENT[x] for x in step['students']] if 'students' in step else [e]
        rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ','.join(who), k=key())
    elif kind == 'seen':
        # What student_submit.seen does (student_page.py runs the real one).
        as_owner()
        c.run("""insert into grade_return (enrollment_id, assessment_id, seen_at) values (:e, :a, clock_timestamp())
                 on conflict (enrollment_id, assessment_id) do update set seen_at = excluded.seen_at""", e=e, a=a)
    elif kind == 'class':
        rpc(A, 'update_course(:c, :p::jsonb)', c=COURSE_A,
            p=json.dumps({'student_page_enabled': step['student_page'], 'return_grades': step['return_grades']}))
    elif kind == 'move_rubric':
        # Edit a Copy: the work moves to a copy of its rubric, whose criteria
        # and checkboxes have new ids (c3, c4, k3, k4).
        as_owner()
        for n in ('r2', 'c3', 'c4', 'k3', 'k4'): K[n] = new_id(); SYMBOL[K[n]] = n
        c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report (copy)', 'advanced')", r=K['r2'], c=COURSE_A)
        c.run("insert into criterion (id, rubric_id, name, display_order) values (:a, :r, 'Method', 0), (:b, :r, 'Conclusion', 1)", a=K['c3'], b=K['c4'], r=K['r2'])
        c.run("insert into criterion_check (id, criterion_id, level, label) values (:a, :x, 3, 'Lists every step'), (:b, :y, 3, 'Answers the question')",
              a=K['k3'], x=K['c3'], b=K['k4'], y=K['c4'])
        c.run('update assessment set rubric_id = :r where id = :a', r=K['r2'], a=a)
        rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=a, r=K['r2'],
            m=json.dumps({K['c1']: K['c3'], K['c2']: K['c4']}), k=json.dumps({K['k1']: K['k3'], K['k2']: K['k4']}), key=key())
    elif kind == 'delete':
        table = {'criterion': 'criterion', 'tag': 'tag', 'check': 'criterion_check'}[step['what']]
        as_teacher(A); c.run('delete from %s where id = :i' % table, i=K[step['id']])
    else:
        raise ValueError(kind)

# ── The worked cases ────────────────────────────────────────────────────
doc = json.load(open(os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'grade-state-cases.json')))
ok('the cases file is format 1 and has cases', doc.get('format') == 1 and len(doc['cases']) >= 40, len(doc['cases']))
STUDENT = {'s1': ENR1, 's2': ENR2}
for case in doc['cases']:
    set_class(case['class']['student_page'], case['class']['return_grades'])
    K = build_class()   # a class of its own, so a case can delete from it
    SYMBOL = {K[n]: n for n in ('t1', 't2', 'c1', 'c2', 'k1', 'k2')}
    a = new_assessment(K, case['work'])
    n = 0; last_returned = {}
    for step in case['steps']:
        e = STUDENT[step.get('student', 's1')] if 'do' in step else STUDENT[step['expect'].get('for', 's1')]
        if 'do' in step:
            do(step, e, a, K); continue
        n += 1
        want = dict(step['expect']); want.pop('for', None)
        got_rg = returned_grade(e, a)
        got = {'state': state(e, a), 'student': symbols(got_rg['grade']), 'status': got_rg['status'],
               'previous': symbols(got_rg['previous']), 'updated': got_rg['updated_at'] is not None}
        if 'returned_at' in want:
            got['returned_at'] = 'unchanged' if got_rg['returned_at'] == last_returned.get(e) else 'changed'
        last_returned[e] = got_rg['returned_at']
        ok('case: %s (check %d)' % (case['name'], n), got == want, {'got': got, 'want': want})
    if not any(step.get('student') == 's2' or step.get('students') for step in case['steps'] if 'do' in step):
        ok('case: %s: the other student in the class is untouched' % case['name'], state(ENR2, a) == 'none')
K = build_class()
T1, T2, C1, C2, K1, K2 = (K[n] for n in ('t1', 't2', 'c1', 'c2', 'k1', 'k2'))
SYMBOL = {K[n]: n for n in ('t1', 't2', 'c1', 'c2', 'k1', 'k2')}

# ── More of the rule than the cases hold ───────────────────────────────
set_class(True, 'on_return')
a = new_assessment(K, 'competencies')
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=a, t=T1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR1, k=key())
first = one('select returned_at from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=a, t=T1)
ok('a save that changes nothing leaves returned_at alone',
   one('select returned_at from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a) == first)
rpc(A, 'upsert_tag_score(:e, :a, :t, 4)', e=ENR1, a=a, t=T1)
row = rows('select is_draft, returned_at, returned_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)[0]
ok('a draft on a returned grade keeps returned_at and the returned copy', row[0] is True and row[1] == first
   and symbols(row[2])['tags'] == {'t1': {'value': 3, 'modifier': 0, 'comment': None}}, row)
ok('the working copy holds the draft; the student is given the returned copy',
   symbols(working_copy(ENR1, a))['tags']['t1']['value'] == 4 and symbols(returned_grade(ENR1, a)['grade'])['tags']['t1']['value'] == 3)
ok('the table keeps a returned copy only while a draft sits on a returned grade',
   one('select count(*) from grade_return where (returned_copy is not null) <> (is_draft and returned_at is not null)') == 0)
def bad_row():
    as_owner(); c.run("update grade_return set returned_copy = '{}'::jsonb where is_draft = false")
expect_error('and refuses a row that says otherwise', bad_row, 'grade_return_copy_while_draft')

# ── return_grades ───────────────────────────────────────────────────────
a = new_assessment(K, 'points')
rpc(A, 'upsert_score(:e, :a, 6)', e=ENR1, a=a); rpc(A, 'upsert_score(:e, :a, 9)', e=ENR2, a=a)
v0 = one('select version from course_sync_cursor where course_id = :c', c=COURSE_A)
k1 = key()
r = rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR1, k=k1)
ok('return_grades returns the listed student only', r['returned'] == 1 and r['enrollment_ids'] == [ENR1]
   and state(ENR1, a) == 'returned' and state(ENR2, a) == 'draft', r)
ok("it moves the class's version once, so other devices reload",
   one('select version from course_sync_cursor where course_id = :c', c=COURSE_A) == v0 + 1)
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=a)
r2 = rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR1, k=k1)
ok('a replay with the same key returns the first answer and returns nothing new', r2 == r and state(ENR1, a) == 'draft', r2)
r = rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s,%s}' % (ENR1, ENR2), k=key())
ok('Return N Graded: many at once', r['returned'] == 2 and state(ENR1, a) == 'returned' and state(ENR2, a) == 'returned', r)
v1 = one('select version from course_sync_cursor where course_id = :c', c=COURSE_A)
r = rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s,%s}' % (ENR1, ENR2), k=key())
ok('returning grades that are not drafts does nothing', r['returned'] == 0, r)
ok("and does not move the class's version", one('select version from course_sync_cursor where course_id = :c', c=COURSE_A) == v1)
r = rpc(A, 'return_grades(:a, null, :k)', a=a, k=key())
ok('no students listed returns nothing', r['returned'] == 0, r)
rpc(A, 'upsert_score(:e, :a, 2)', e=ENR1, a=a)
r = rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR_B, k=key())
ok("another class's student in the list is skipped", r['returned'] == 0 and state(ENR1, a) == 'draft', r)
lst = rpc(A, 'list_course_grade_returns(:c)', c=COURSE_A)
ok("list_course_grade_returns gives the class's rows by assessment, then student",
   lst[a][ENR1]['is_draft'] is True and lst[a][ENR1]['returned_copy']['value'] == 7
   and lst[a][ENR2]['is_draft'] is False and 'returned_at' in lst[a][ENR2], lst[a])
ok('with nulls left out', 'seen_at' not in lst[a][ENR2] and 'returned_copy' not in lst[a][ENR2], lst[a][ENR2])

# ── The two class settings ─────────────────────────────────────────────
set_class(False, None)
rpc(A, "update_course(:c, :p::jsonb)", c=COURSE_A, p=json.dumps({'student_page_enabled': True, 'return_grades': 'on_return'}))
ok('update_course writes both settings', rows('select student_page_enabled, return_grades from course where id = :c', c=COURSE_A) == [[True, 'on_return']])
rpc(A, "update_course(:c, :p::jsonb)", c=COURSE_A, p=json.dumps({'name': 'Science 8'}))
ok('a patch that names neither leaves both', rows('select student_page_enabled, return_grades from course where id = :c', c=COURSE_A) == [[True, 'on_return']])
rpc(A, "update_course(:c, :p::jsonb)", c=COURSE_A, p=json.dumps({'return_grades': None, 'student_page_enabled': False}))
ok('return_grades can go back to no choice made', rows('select student_page_enabled, return_grades from course where id = :c', c=COURSE_A) == [[False, None]])
expect_error('a value that is not on_return or on_save is refused',
             lambda: rpc(A, "update_course(:c, :p::jsonb)", c=COURSE_A, p=json.dumps({'return_grades': 'sometimes'})), 'course_return_grades_check')
ok('an existing class has no choice made and the student page off',
   rows('select student_page_enabled, return_grades from course where id = :c', c=COURSE_B) == [[False, None]])
made = rpc(A, "create_course('Humanities 8', p_idempotency_key => :k)", k=key())
ok('a class made now starts on When I Return Them, student page off',
   rows('select student_page_enabled, return_grades from course where id = :c', c=made) == [[False, 'on_return']])
before = one('select count(*) from grade_return')
dup = rpc(A, 'duplicate_course(:c, :k)', c=COURSE_A, k=key())
ok("Duplicate Class copies the original's Return Grades choice as it is (here none made), with the student page off",
   rows('select student_page_enabled, return_grades from course where id = :c', c=dup) == [[False, None]])
set_class(True, 'on_save')
dup2 = rpc(A, 'duplicate_course(:c, :k)', c=COURSE_A, k=key())
ok('a copy of an As Soon As I Save class with its page on: As Soon As I Save, page off',
   rows('select student_page_enabled, return_grades from course where id = :c', c=dup2) == [[False, 'on_save']])
set_class(True, 'on_return')
dup3 = rpc(A, 'duplicate_course(:c, :k)', c=COURSE_A, k=key())
ok('a copy of a When I Return Them class: When I Return Them, page off',
   rows('select student_page_enabled, return_grades from course where id = :c', c=dup3) == [[False, 'on_return']])
ok('Duplicate Class copies no grades: no grade_return row appears', one('select count(*) from grade_return') == before
   and one('select count(*) from rubric where course_id = :c', c=dup) == one('select count(*) from rubric where course_id = :c', c=COURSE_A))
copy_of = rpc(A, 'duplicate_assessment(:a, :k)', a=a, k=key())
ok('Copy Assessment copies no grades: the copy has no score and no grade_return row',
   one('select (select count(*) from grade_return where assessment_id = :a) + (select count(*) from score where assessment_id = :a)', a=copy_of) == 0
   and one('select count(*) from grade_return') == before)

# ── The Missing check, and upsert_rubric_score left as it is ───────────
set_class(True, 'on_return')
as_owner()
other = {n: new_id() for n in ('r', 'c', 'k')}
c.run("insert into rubric (id, course_id, name) values (:r, :co, 'Poster')", r=other['r'], co=COURSE_A)
c.run("insert into criterion (id, rubric_id, name) values (:c, :r, 'Layout')", c=other['c'], r=other['r'])
rub = new_assessment(K, 'rubric'); comp = new_assessment(K, 'competencies'); pts = new_assessment(K, 'points')
# Batch A does not touch upsert_rubric_score: the outbox can send a score
# ahead of the update_assessment that changes the work's rubric.
off = new_assessment(K, 'rubric', title='Changing rubric')
rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=off, x=other['c'])
rpc(A, "upsert_rubric_score(:e, :a, :x, null, 0::smallint, 'Check the units')", e=ENR2, a=off, x=other['c'])
ok('a level and a comment for a criterion of another rubric in the class are saved, as before the batch',
   rows('select value, comment from rubric_score where assessment_id = :a order by value nulls last', a=off) == [[3, None], [None, 'Check the units']])
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=off, ids='{%s}' % ENR1, k=key())
ok('the student is not sent it while the work is on its old rubric', returned_grade(ENR1, off)['grade'] is None and state(ENR1, off) == 'returned')
as_owner(); c.run('update assessment set rubric_id = :r where id = :a', r=other['r'], a=off)
ok('and is sent it once the rubric change lands', returned_grade(ENR1, off)['grade']['criteria'][other['c']]['value'] == 3)
rpc(A, "upsert_rubric_score(:e, :a, :x, 3, 1::smallint, 'Number the steps', 'Drew it')", e=ENR1, a=rub, x=C1)

rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=pts)
expect_error('set_score_status refuses Missing on work that has points',
             lambda: rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR1, a=pts), 'cannot be marked Missing')
rpc(A, 'upsert_score(:e, :a, 0)', e=ENR2, a=pts)
expect_error('a points 0 is a score too', lambda: rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=pts), '22023')
rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR1, a=comp, t=T1)
expect_error('and on work that has a competency level', lambda: rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR1, a=comp), 'cannot be marked Missing')
expect_error('and on work that has a criterion level', lambda: rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR1, a=rub), 'cannot be marked Missing')
rpc(A, "set_score_status(:e, :a, 'EXC')", e=ENR1, a=pts); rpc(A, "set_score_status(:e, :a, 'LATE')", e=ENR1, a=pts)
ok('Excused and Late on scored work are still taken', one('select status from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=pts) == 'LATE')
rpc(A, "save_score_comment(:e, :a, 'See me')", e=ENR2, a=comp)
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=comp)
ok('Missing on work with only a comment is taken: a comment is not a score', one('select status from score where enrollment_id = :e and assessment_id = :a', e=ENR2, a=comp) == 'NS')
already = new_assessment(K, 'points')
as_owner(); c.run("insert into score (enrollment_id, assessment_id, value, status) values (:e, :a, 5, 'NS')", e=ENR2, a=already)
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=already)
ok('Missing on work already marked Missing is taken, scored or not', one('select status from score where enrollment_id = :e and assessment_id = :a', e=ENR2, a=already) == 'NS')

# Only what the app shows as a score counts: the rows the work's scoring uses now.
def missing_ok(a, e=ENR1):
    rpc(A, "set_score_status(:e, :a, 'NS')", e=e, a=a)
    return one('select status from score where enrollment_id = :e and assessment_id = :a', e=e, a=a) == 'NS'
m1 = new_assessment(K, 'rubric')
rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=m1, x=C1)
as_owner(); c.run('update assessment set rubric_id = :r where id = :a', r=other['r'], a=m1)
ok('Missing is taken on work whose rubric was changed: a different rubric starts unscored', missing_ok(m1))
m2 = new_assessment(K, 'competencies')
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=m2, t=T1)
as_owner(); c.run("update assessment set score_mode = 'points', max_points = 10 where id = :a", a=m2)
ok('Missing is taken on work changed to points that still has an old competency level: the app drops those', missing_ok(m2))
m3 = new_assessment(K, 'competencies')
rpc(A, 'upsert_score(:e, :a, 0)', e=ENR1, a=m3)
ok('Missing is taken on competency work that holds a stray score of 0 (clearing an orphan sends one)', missing_ok(m3))
rpc(A, 'upsert_score(:e, :a, 3)', e=ENR2, a=m3)
expect_error('competency work that holds only an Overall level is scored: the app shows that level under its first competency, so Missing is refused',
             lambda: rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=m3), 'cannot be marked Missing')
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=m3, ids='{%s}' % ENR2, k=key())
ok('and the student is sent that level', returned_grade(ENR2, m3)['grade']['value'] == 3, returned_grade(ENR2, m3))
m6 = new_assessment(K, 'competencies')
rpc(A, 'upsert_score(:e, :a, 3)', e=ENR2, a=m6); rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR2, a=m6, t=T1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=m6, ids='{%s}' % ENR2, k=key())
ok('beside a competency level the same score.value is hidden, as the app hides it', returned_grade(ENR2, m6)['grade']['value'] is None
   and returned_grade(ENR2, m6)['grade']['tags'][T1]['value'] == 2)
m4 = new_assessment(K, 'competencies')
as_owner(); c.run('delete from assessment_tag where assessment_id = :a', a=m4)
rpc(A, 'upsert_score(:e, :a, 0)', e=ENR1, a=m4)
ok('on work scored as a whole an Overall level of 0 is no score: Missing is taken', missing_ok(m4))
rpc(A, 'upsert_score(:e, :a, 3)', e=ENR2, a=m4)
expect_error('and a real Overall level is a score: Missing is refused', lambda: rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=m4), 'cannot be marked Missing')
m5 = new_assessment(K, 'competencies')
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=m5, t=T1)
as_owner(); c.run('delete from assessment_tag where assessment_id = :a and tag_id = :t', a=m5, t=T1)
ok('a level on a competency the work is no longer linked to does not count', missing_ok(m5))
rpc(A, 'clear_score(:e, :a)', e=ENR1, a=comp); rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR1, a=comp)
ok('once the level is cleared, Missing is taken', one('select status from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=comp) == 'NS')
expect_error('an unknown status is still refused first', lambda: rpc(A, "set_score_status(:e, :a, 'missing')", e=ENR1, a=pts), 'invalid status')

# ── The copy kept before a change is this transaction's own ─────────────
pl = new_assessment(K, 'points')
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=pl); rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=pl, ids='{%s}' % ENR1, k=key())
ok('between statements the scratch table is empty', one('select count(*) from grade_return_before') == 0)
as_owner()
c.run("""insert into grade_return_before (enrollment_id, assessment_id, txid, at, tbl, copy)
         values (:e, :a, txid_current(), now() - interval '1 hour', 'score',
                 '{"v": 1, "value": 2, "modifier": 0, "comment": "planted", "tags": {}, "criteria": {}, "checks": []}'::jsonb)""", e=ENR1, a=pl)
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR1, a=pl)
got = returned_grade(ENR1, pl)['grade']
ok('a row left in the scratch table with this transaction\'s id but another start time is not trusted: the student keeps the returned 7, not the planted 2',
   state(ENR1, pl) == 'draft' and got['value'] == 7 and got['comment'] is None, got)
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR1, a=pl)                    # a save that changes nothing
rpc(A, "set_score_status(:e, :a, 'LATE')", e=ENR1, a=pl)           # a status
rpc(A, 'set_rubric_check(:e, :a, :k, false)', e=ENR1, a=rub, k=K1) # an untick of nothing
rpc(A, 'upsert_tag_score(:e, :a, :t, 0)', e=ENR1, a=new_assessment(K, 'competencies'), t=T1)
ok('a save that changes nothing, a status and a clear of nothing leave no row in the scratch table', one('select count(*) from grade_return_before') == 0,
   rows('select tbl, enrollment_id, assessment_id from grade_return_before'))

# ── Bulk path: move_rubric_scores keeps the state ──────────────────────
mv = new_assessment(K, 'rubric')
rpc(A, "upsert_rubric_score(:e, :a, :x, 3, 0::smallint, 'Number the steps')", e=ENR1, a=mv, x=C1)
rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR1, a=mv, x=C2)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=mv, k=K1)
rpc(A, 'upsert_rubric_score(:e, :a, :x, 4)', e=ENR2, a=mv, x=C1)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR2, a=mv, k=K2)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=mv, ids='{%s,%s}' % (ENR1, ENR2), k=key())
rpc(A, 'upsert_rubric_score(:e, :a, :x, 1)', e=ENR2, a=mv, x=C1)          # ENR2: a draft on a returned grade
rpc(A, 'set_rubric_check(:e, :a, :k, false)', e=ENR2, a=mv, k=K2)
as_owner()
cp = {n: new_id() for n in ('r', 'c1', 'c2', 'k1', 'k2')}
c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report (copy)', 'advanced')", r=cp['r'], c=COURSE_A)
c.run("insert into criterion (id, rubric_id, name) values (:c1, :r, 'Method'), (:c2, :r, 'Conclusion')", c1=cp['c1'], c2=cp['c2'], r=cp['r'])
c.run("insert into criterion_check (id, criterion_id, level, label) values (:k1, :c1, 3, 'Lists every step'), (:k2, :c2, 3, 'Answers the question')",
      k1=cp['k1'], c1=cp['c1'], k2=cp['k2'], c2=cp['c2'])
c.run('update assessment set rubric_id = :r where id = :a', r=cp['r'], a=mv)
r = rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=mv, r=cp['r'],
        m=json.dumps({C1: cp['c1'], C2: cp['c2']}), k=json.dumps({K1: cp['k1'], K2: cp['k2']}), key=key())
ok('move_rubric_scores moves the scores and the tick', r == {'scores': 3, 'checks': 1}, r)
ok('a returned grade is still returned after the move', state(ENR1, mv) == 'returned')
got = returned_grade(ENR1, mv)['grade']
ok('and the student reads it under the new criteria and checkbox',
   got['criteria'] == {cp['c1']: {'value': 3, 'modifier': 0, 'comment': 'Number the steps', 'beyond': None},
                       cp['c2']: {'value': 2, 'modifier': 0, 'comment': None, 'beyond': None}} and got['checks'] == [cp['k1']], got)
ok('a draft is still a draft after the move', state(ENR2, mv) == 'draft')
got = returned_grade(ENR2, mv)['grade']
ok('and its returned copy points at the new criterion and checkbox, though the draft unticked that box: the student still reads what was returned',
   got['criteria'] == {cp['c1']: {'value': 4, 'modifier': 0, 'comment': None, 'beyond': None}} and got['checks'] == [cp['k2']], got)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=mv, ids='{%s}' % ENR2, k=key())
got = returned_grade(ENR2, mv)
ok('returned again, the previous copy is under the new ids too',
   got['grade']['criteria'][cp['c1']]['value'] == 1 and got['previous']['criteria'][cp['c1']]['value'] == 4
   and got['previous']['checks'] == [cp['k2']], got)

# A map inside one rubric is not Edit a Copy: it is a change.
sw = new_assessment(K, 'rubric')
rpc(A, 'upsert_rubric_score(:e, :a, :x, 4)', e=ENR1, a=sw, x=C1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=sw, ids='{%s}' % ENR1, k=key())
rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=sw, r=K['r1'], m=json.dumps({C1: C2}), k='{}', key=key())
got = returned_grade(ENR1, sw)['grade']
ok('move_rubric_scores with a map from one criterion to another of the same rubric is a change: the grade waits as a draft and the student keeps the level where it was',
   state(ENR1, sw) == 'draft' and got['criteria'] == {C1: {'value': 4, 'modifier': 0, 'comment': None, 'beyond': None}}, got)

# ── Bulk path: the two bulk clears ─────────────────────────────────────
bc = new_assessment(K, 'competencies')
for e in (ENR1, ENR2):
    rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=e, a=bc, t=T1); rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=e, a=bc, t=T2)
    rpc(A, "save_score_comment(:e, :a, 'Good')", e=e, a=bc)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=bc, ids='{%s,%s}' % (ENR1, ENR2), k=key())
n = rpc(A, 'clear_column_scores(:a)', a=bc)
ok('clear_column_scores under When I Return Them: every returned grade becomes a draft, and each student keeps theirs',
   state(ENR1, bc) == 'draft' and state(ENR2, bc) == 'draft'
   and symbols(returned_grade(ENR2, bc)['grade']) == {'v': 1, 'value': None, 'modifier': 0, 'comment': 'Good',
       'tags': {'t1': {'value': 3, 'modifier': 0, 'comment': None}, 't2': {'value': 2, 'modifier': 0, 'comment': None}},
       'criteria': {}, 'checks': []}, returned_grade(ENR2, bc))
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=bc, ids='{%s,%s}' % (ENR1, ENR2), k=key())
ok('returned, the cleared column is no grade for anyone', state(ENR1, bc) == 'none' and returned_grade(ENR2, bc)['grade'] is None)
set_class(True, 'on_save')
rc = new_assessment(K, 'points')
rpc(A, 'upsert_score(:e, :a, 5)', e=ENR1, a=rc); rpc(A, 'upsert_score(:e, :a, 6)', e=ENR2, a=rc)
rpc(A, 'clear_row_scores(:e, :c)', e=ENR1, c=COURSE_A)
ok("clear_row_scores under As Soon As I Save: that student's grades are gone at once, the other student's stay",
   state(ENR1, rc) == 'none' and returned_grade(ENR1, rc)['grade'] is None and returned_grade(ENR2, rc)['grade']['value'] == 6)
ok('no grade_return row is left saying returned for a cell with nothing in it',
   one("""select count(*) from grade_return g where not g.is_draft and g.returned_at is not null
            and public._grade_copy(g.enrollment_id, g.assessment_id) is null""") == 0)

# ── Deleting what a grade hangs on ─────────────────────────────────────
set_class(True, 'on_return')
dl = new_assessment(K, 'rubric')
rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=dl, x=C1); rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR1, a=dl, x=C2)
rpc(A, 'upsert_score(:e, :a, 3)', e=ENR1, a=dl); rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=dl, k=K1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=dl, ids='{%s}' % ENR1, k=key())
as_teacher(A); c.run('delete from criterion where id = :x', x=C2)
ok('deleting a criterion under When I Return Them: its levels go, the grade waits as a draft and the returned copy keeps them',
   state(ENR1, dl) == 'draft' and C2 not in working_copy(ENR1, dl)['criteria']
   and C2 in one('select returned_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=dl)['criteria'])
as_teacher(A); c.run('delete from assessment where id = :a', a=dl)
ok('deleting an assessment takes its scores and its grade_return rows, with no error from the triggers',
   one('select (select count(*) from grade_return where assessment_id = :a) + (select count(*) from score where assessment_id = :a)', a=dl) == 0)
gone = one('select count(*) from grade_return where enrollment_id = :e', e=ENR2)
as_owner(); c.run('delete from enrollment where id = :e', e=ENR2)
ok('deleting a student takes their grade_return rows', gone > 0 and one('select count(*) from grade_return where enrollment_id = :e', e=ENR2) == 0)

# ── Bulk path: the restore ─────────────────────────────────────────────
def backup(new, with_state, settings=None):
    """A one-class backup with fresh ids: two students, a competency, a
    rubric with one criterion and one checkbox, three assessments."""
    i = {n: new_id() for n in ('course', 's1', 's2', 'e1', 'e2', 'subj', 'sect', 'tag', 'rub', 'crit', 'chk', 'a1', 'a2', 'a3')}
    course = {'id': i['course'], 'name': 'Restored'}
    course.update(settings or {})
    p = {
        'courses': [course],
        'subjects': [{'id': i['subj'], 'course_id': i['course'], 'name': 'Science'}],
        'sections': [{'id': i['sect'], 'course_id': i['course'], 'subject_id': i['subj'], 'name': 'Questioning'}],
        'tags': [{'id': i['tag'], 'section_id': i['sect'], 'label': 'Ask questions'}],
        'rubrics': [{'id': i['rub'], 'course_id': i['course'], 'name': 'Lab', 'style': 'advanced'}],
        'criteria': [{'id': i['crit'], 'rubric_id': i['rub'], 'name': 'Method'}],
        'criterion_checks': [{'id': i['chk'], 'criterion_id': i['crit'], 'level': 3, 'label': 'Lists every step'}],
        'students': [{'id': i['s1'], 'first_name': 'Ana'}, {'id': i['s2'], 'first_name': 'Ben'}],
        'enrollments': [{'id': i['e1'], 'student_id': i['s1'], 'course_id': i['course']},
                        {'id': i['e2'], 'student_id': i['s2'], 'course_id': i['course']}],
        'assessments': [{'id': i['a1'], 'course_id': i['course'], 'title': 'Quiz', 'score_mode': 'points', 'max_points': 10},
                        {'id': i['a2'], 'course_id': i['course'], 'title': 'Lab', 'rubric_id': i['rub']},
                        {'id': i['a3'], 'course_id': i['course'], 'title': 'Questions'}],
        'assessment_tags': [{'assessment_id': i['a3'], 'tag_id': i['tag']}],
        'scores': [{'enrollment_id': i['e1'], 'assessment_id': i['a1'], 'value': 8},
                   {'enrollment_id': i['e2'], 'assessment_id': i['a1'], 'value': 6},
                   {'enrollment_id': i['e2'], 'assessment_id': i['a3'], 'status': 'NS'}],
        'rubric_scores': [{'enrollment_id': i['e1'], 'assessment_id': i['a2'], 'criterion_id': i['crit'], 'value': 4}],
        'rubric_check_scores': [{'enrollment_id': i['e1'], 'assessment_id': i['a2'], 'check_id': i['chk']}],
        'tag_scores': [{'enrollment_id': i['e1'], 'assessment_id': i['a3'], 'tag_id': i['tag'], 'value': 2}],
    }
    if with_state:
        returned = {'v': 1, 'value': None, 'modifier': 0, 'comment': None, 'tags': {}, 'checks': [i['chk']],
                    'criteria': {i['crit']: {'value': 3, 'modifier': 0, 'comment': None, 'beyond': None}}}
        p['grade_returns'] = [
            {'enrollment_id': i['e1'], 'assessment_id': i['a1'], 'is_draft': True},                                  # a draft never returned
            {'enrollment_id': i['e2'], 'assessment_id': i['a1'], 'is_draft': False, 'returned_at': '2026-11-03T17:00:00Z',
             'previous_copy': {'v': 1, 'value': 5, 'modifier': 0, 'comment': None, 'tags': {}, 'criteria': {}, 'checks': []},
             'updated_at': '2026-11-03T17:00:00Z', 'seen_at': '2026-11-02T17:00:00Z'},                               # returned, was updated
            {'enrollment_id': i['e1'], 'assessment_id': i['a2'], 'is_draft': True, 'returned_at': '2026-11-01T17:00:00Z',
             'returned_copy': returned},                                                                              # a draft on a returned grade
            # a3 / e1 is left out: a grade the backup says nothing about
            {'enrollment_id': ENR_B, 'assessment_id': i['a1'], 'is_draft': True},                                     # not this teacher's student
        ]
    return i, p

i, p = backup(True, False)
t0 = time.time()
res = rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(p), k=key())
ok('an older backup restores', res['scores'] == 3 and res['rubric_scores'] == 1 and res['tag_scores'] == 1, res)
ok('its class has no choice made and the student page off',
   rows('select student_page_enabled, return_grades from course where id = :c', c=i['course']) == [[False, None]])
ok('an older backup restores every grade as Returned',
   [state(i['e1'], i['a1']), state(i['e2'], i['a1']), state(i['e1'], i['a2']), state(i['e1'], i['a3'])] == ['returned'] * 4)
ok('a status alone is not a grade: no row', state(i['e2'], i['a3']) == 'none' and returned_grade(i['e2'], i['a3'])['status'] == 'NS')
ok('and the student reads the restored grades',
   returned_grade(i['e1'], i['a1'])['grade']['value'] == 8 and returned_grade(i['e1'], i['a2'])['grade']['checks'] == [i['chk']])

i, p = backup(True, True, {'student_page_enabled': True, 'return_grades': 'on_return'})
res = rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(p), k=key())
ok('a backup made after Draft and Returned restores its class settings',
   rows('select student_page_enabled, return_grades from course where id = :c', c=i['course']) == [[True, 'on_return']])
ok('a draft in the backup restores as a draft: the student is given nothing',
   state(i['e1'], i['a1']) == 'draft' and returned_grade(i['e1'], i['a1'])['grade'] is None)
got = returned_grade(i['e2'], i['a1'])
ok('a returned grade restores as Returned, with its dates and previous copy',
   state(i['e2'], i['a1']) == 'returned' and got['grade']['value'] == 6 and got['previous']['value'] == 5
   and str(got['returned_at']).startswith('2026-11-03') and str(got['seen_at']).startswith('2026-11-02'), got)
got = returned_grade(i['e1'], i['a2'])
ok('a draft on a returned grade restores with its returned copy: the student reads that, not the working copy',
   state(i['e1'], i['a2']) == 'draft' and got['grade']['criteria'][i['crit']]['value'] == 3
   and working_copy(i['e1'], i['a2'])['criteria'][i['crit']]['value'] == 4, got)
ok('a grade the backup says nothing about restores as Returned', state(i['e1'], i['a3']) == 'returned')
ok("a row naming another teacher's student is left out", one('select count(*) from grade_return where enrollment_id = :e', e=ENR_B) == 0)
rpc(A, 'upsert_score(:e, :a, 9)', e=i['e2'], a=i['a1'])
ok('after the restore the triggers are back: a change in the restored class waits as a draft', state(i['e2'], i['a1']) == 'draft')
before = rows('select * from grade_return order by 1, 2')
n = rpc(A, 'fv_private.restore_grade_returns(:p::jsonb)', p=json.dumps({'grade_returns': [{'enrollment_id': i['e2'], 'assessment_id': i['a1'], 'is_draft': False}]}))
i2, p2 = backup(True, True, {'student_page_enabled': False, 'return_grades': 'on_return'})
rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(p2), k=key())
ok('a backup with drafts restored into a class that does not hold grades: the drafts are returned, none is left waiting unseen',
   one('select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id where e.course_id = :c and g.is_draft', c=i2['course']) == 0
   and returned_grade(i2['e1'], i2['a1'])['grade']['value'] == 8 and returned_grade(i2['e1'], i2['a2'])['previous'] is not None)
before = rows('select * from grade_return order by 1, 2')
ok('outside a restore the state helper does nothing: a restore is the only way it sets a state',
   n == 0 and rows('select * from grade_return order by 1, 2') == before, n)

# A hand-made restore over a class that already exists (the app always
# restores as a new class): it leaves no draft stranded.
rpc(A, 'upsert_score(:e, :a, 9)', e=i['e1'], a=i['a1'])
left = one('select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id where e.course_id = :c and g.is_draft', c=i['course'])
rpc(A, 'import_json_restore(:p::jsonb, :k)', k=key(),
    p=json.dumps({'courses': [{'id': i['course'], 'name': 'Restored', 'student_page_enabled': False, 'return_grades': 'on_return'}]}))
ok('a restore that turns the student page off on a class that has %d drafts returns every one of them' % left, left >= 3
   and one('select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id where e.course_id = :c and g.is_draft', c=i['course']) == 0
   and rows('select student_page_enabled, return_grades from course where id = :c', c=i['course']) == [[False, 'on_return']])

# A whole class at once: 30 students, 40 assessments, 3 competencies each.
i, p = backup(True, False)
studs = [new_id() for _ in range(30)]; enrs = [new_id() for _ in range(30)]; asms = [new_id() for _ in range(40)]
tags = [new_id() for _ in range(3)]
p['students'] = [{'id': s, 'first_name': 'S%d' % n} for n, s in enumerate(studs)]
p['enrollments'] = [{'id': e, 'student_id': s, 'course_id': i['course']} for e, s in zip(enrs, studs)]
p['tags'] = [{'id': t, 'section_id': i['sect'], 'label': 'T'} for t in tags]
p['assessments'] = [{'id': x, 'course_id': i['course'], 'title': 'A'} for x in asms]
p['assessment_tags'] = []; p['rubric_scores'] = []; p['rubric_check_scores'] = []
p['scores'] = [{'enrollment_id': e, 'assessment_id': x, 'comment': 'ok'} for e in enrs for x in asms]
p['tag_scores'] = [{'enrollment_id': e, 'assessment_id': x, 'tag_id': t, 'value': 3} for e in enrs for x in asms for t in tags]
as_teacher(A); t0 = time.time()
res = c.run('select import_json_restore(:p::jsonb, :k)', p=json.dumps(p), k=key())[0][0]
took = time.time() - t0
ok('a 30 by 40 class (4,800 score rows) restores with one Returned row per graded cell',
   res['tag_scores'] == 3600 and one('select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id where e.course_id = :c and not g.is_draft and g.returned_at is not null', c=i['course']) == 1200, res)
ok('in well under the 8 second statement limit (took %.2f s here)' % took, took < 4, took)

# ── The copy the student keeps does not depend on the order of deletes ──
def lab():
    """A fresh two-criterion rubric (a box on each) and an assessment on it,
    graded and returned for ENR1: x1 = 3 with its box ticked, x2 = 2."""
    as_owner()
    g = {n: new_id() for n in ('r', 'x1', 'x2', 'y1', 'y2', 'a')}
    c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab', 'advanced')", r=g['r'], c=COURSE_A)
    c.run("insert into criterion (id, rubric_id, name, display_order) values (:x1, :r, 'Method', 0), (:x2, :r, 'Conclusion', 1)", x1=g['x1'], x2=g['x2'], r=g['r'])
    c.run("insert into criterion_check (id, criterion_id, level, label) values (:y1, :x1, 3, 'Lists every step'), (:y2, :x2, 3, 'Answers it')", y1=g['y1'], x1=g['x1'], y2=g['y2'], x2=g['x2'])
    c.run("insert into assessment (id, course_id, title, rubric_id) values (:a, :c, 'Lab', :r)", a=g['a'], c=COURSE_A, r=g['r'])
    rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=g['a'], x=g['x1'])
    rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR1, a=g['a'], x=g['x2'])
    rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=g['a'], k=g['y1'])
    rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=g['a'], ids='{%s}' % ENR1, k=key())
    return g
def kept(a, e=ENR1):
    return one('select returned_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
def given(g):
    return {'v': 1, 'value': None, 'modifier': 0, 'comment': None, 'tags': {}, 'checks': [g['y1']],
            'criteria': {g['x1']: {'value': 3, 'modifier': 0, 'comment': None, 'beyond': None},
                         g['x2']: {'value': 2, 'modifier': 0, 'comment': None, 'beyond': None}}}
set_class(True, 'on_return')
FLIPS = [('as the tables stand', None),
         ('with the checkbox cascade re-added, so it fires last', ('criterion_check', 'criterion_check_criterion_id_fkey', 'foreign key (criterion_id) references public.criterion(id) on delete cascade')),
         ('with the level cascade re-added, so it fires last', ('rubric_score', 'rubric_score_criterion_id_fkey', 'foreign key (criterion_id) references public.criterion(id) on delete cascade'))]
for label, flip in FLIPS:
    if flip:
        as_owner()
        c.run('alter table public.%s drop constraint %s' % flip[:2]); c.run('alter table public.%s add constraint %s %s' % flip)
    g = lab()
    as_teacher(A); c.run('delete from criterion where id = :x', x=g['x1'])
    ok('deleting a criterion that has a ticked box, %s: the grade waits as a draft and the copy kept is exactly what was returned, level and tick' % label,
       state(ENR1, g['a']) == 'draft' and kept(g['a']) == given(g), kept(g['a']))
    ok('and the working copy has lost both (%s)' % label, working_copy(ENR1, g['a'])['criteria'].keys() == {g['x2']} and working_copy(ENR1, g['a'])['checks'] == [])
    ok("the student's page drops the deleted criterion at once, since there is no name left to show it under, and keeps the rest (%s)" % label,
       returned_grade(ENR1, g['a'])['grade']['criteria'] == {g['x2']: {'value': 2, 'modifier': 0, 'comment': None, 'beyond': None}}
       and returned_grade(ENR1, g['a'])['grade']['checks'] == [])
g = lab()
as_teacher(A); c.run('delete from criterion_check where id = :k', k=g['y1'])
ok('deleting a ticked checkbox: a draft, and the copy kept still has the tick', state(ENR1, g['a']) == 'draft' and kept(g['a']) == given(g), kept(g['a']))
g = lab()
as_teacher(A); c.run('delete from rubric where id = :r', r=g['r'])
ok('deleting the whole rubric: a draft, the copy kept is the whole returned grade, and the work has no rubric',
   state(ENR1, g['a']) == 'draft' and kept(g['a']) == given(g) and one('select rubric_id is null from assessment where id = :a', a=g['a']), kept(g['a']))
ok('the student is then sent nothing for it: the work is no longer scored by that rubric', returned_grade(ENR1, g['a'])['grade'] is None)
g = lab()
as_owner(); c.run('update assessment set rubric_id = :r where id = :a', r=other['r'], a=g['a'])
ok('swapping the rubric on scored work changes no state and no row: still Returned, nothing kept, the levels still in the working copy',
   state(ENR1, g['a']) == 'returned' and kept(g['a']) is None and working_copy(ENR1, g['a']) == given(g))
ok('and the student is sent none of the old rubric\'s levels', returned_grade(ENR1, g['a'])['grade'] is None)
as_owner()
tx = new_id(); c.run("insert into tag (id, section_id, label) values (:t, :x, 'Record data')", t=tx, x=K['sect'])
ta = new_assessment(K, 'competencies'); c.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :t)', a=ta, t=tx)
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=ta, t=tx); rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR1, a=ta, t=T1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=ta, ids='{%s}' % ENR1, k=key())
as_teacher(A); c.run('delete from tag where id = :t', t=tx)
ok('deleting a competency that has a returned level: a draft, the copy kept has both levels, the student is sent the one that is left',
   state(ENR1, ta) == 'draft' and set(kept(ta)['tags']) == {tx, T1} and set(returned_grade(ENR1, ta)['grade']['tags']) == {T1}, kept(ta))

# ── One statement that adds and changes rows of one grade ───────────────
ms = new_assessment(K, 'competencies')
rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR1, a=ms, t=T1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=ms, ids='{%s}' % ENR1, k=key())
as_teacher(A)
c.run("""insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t1, 4), (:e, :a, :t2, 4)
         on conflict (enrollment_id, assessment_id, tag_id) do update set value = excluded.value""", e=ENR1, a=ms, t1=T1, t2=T2)
ok('one statement that changes a returned level and adds a new one: the copy kept is the grade before the statement, with nothing of the new level in it',
   state(ENR1, ms) == 'draft' and kept(ms)['tags'] == {T1: {'value': 2, 'modifier': 0, 'comment': None}}
   and returned_grade(ENR1, ms)['grade']['tags'] == {T1: {'value': 2, 'modifier': 0, 'comment': None}}, kept(ms))

# ── Pointing a row at another criterion by hand is a change ─────────────
g = lab()
as_teacher(A); c.run('update rubric_score set criterion_id = :n where assessment_id = :a and criterion_id = :o', n=other['c'], a=g['a'], o=g['x1'])
ok('an UPDATE of a criterion id outside move_rubric_scores is a change like any other: a draft, and the student keeps the returned grade',
   state(ENR1, g['a']) == 'draft' and kept(g['a']) == given(g) and returned_grade(ENR1, g['a'])['grade']['criteria'][g['x1']]['value'] == 3, kept(g['a']))
g = lab()
as_teacher(A); c.run('update rubric_check_score set check_id = :n where assessment_id = :a', n=g['y2'], a=g['a'])
ok('so is an UPDATE of a tick to another checkbox', state(ENR1, g['a']) == 'draft' and kept(g['a']) == given(g) and returned_grade(ENR1, g['a'])['grade']['checks'] == [g['y1']], kept(g['a']))
tp = new_assessment(K, 'competencies')
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=tp, t=T1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=tp, ids='{%s}' % ENR1, k=key())
as_teacher(A); c.run('update tag_score set tag_id = :n where assessment_id = :a', n=T2, a=tp)
ok('and of a level to another competency', state(ENR1, tp) == 'draft' and set(kept(tp)['tags']) == {T1} and set(returned_grade(ENR1, tp)['grade']['tags']) == {T1}, kept(tp))

# ── The student is sent only what the work's scoring uses now ───────────
h1 = new_assessment(K, 'competencies')
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=h1, t=T1); rpc(A, 'upsert_score(:e, :a, 2)', e=ENR1, a=h1)
rpc(A, "save_score_comment(:e, :a, 'Good thinking')", e=ENR1, a=h1)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=h1, ids='{%s}' % ENR1, k=key())
got = returned_grade(ENR1, h1)['grade']
ok('competency work: its levels and the Overall Comment are sent; a stray score.value the gradebook hides is not',
   got['tags'] == {T1: {'value': 3, 'modifier': 0, 'comment': None}} and got['value'] is None and got['comment'] == 'Good thinking', got)
ok('the stored working copy is still complete', working_copy(ENR1, h1)['value'] == 2)
as_owner(); c.run("update assessment set score_mode = 'points', max_points = 10 where id = :a", a=h1)
got = returned_grade(ENR1, h1)['grade']
ok('the same work changed to points: the points are sent and the old competency level is not', got['value'] == 2 and got['tags'] == {}, got)
h2 = new_assessment(K, 'rubric')
rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=h2, x=C1); rpc(A, 'upsert_tag_score(:e, :a, :t, 4)', e=ENR1, a=new_assessment(K, 'competencies'), t=T1)
as_owner(); c.run('set local session_replication_role = replica')
c.run('insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 4)', e=ENR1, a=h2, t=T1)
c.run('set local session_replication_role = origin')
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=h2, ids='{%s}' % ENR1, k=key())
got = returned_grade(ENR1, h2)['grade']
ok('rubric work: its criterion levels are sent; a competency level left on it is not', set(got['criteria']) == {C1} and got['tags'] == {}, got)

# ── Leaving When I Return Them returns what was waiting ─────────────────
as_owner()
ENR3 = new_id()   # ENR2 was deleted above
c.run("insert into student (id, teacher_id, first_name) values (:s, :t, 'Dana')", s=ENR3, t=A)
c.run('insert into enrollment (id, student_id, course_id) values (:e, :e, :c)', e=ENR3, c=COURSE_A)
def two_drafts():
    a = new_assessment(K, 'points')
    rpc(A, 'upsert_score(:e, :a, 6)', e=ENR1, a=a)                       # a draft never returned
    rpc(A, 'upsert_score(:e, :a, 7)', e=ENR3, a=a)
    rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR3, k=key())
    rpc(A, 'upsert_score(:e, :a, 9)', e=ENR3, a=a)                       # a draft on a returned grade
    return a
set_class(True, 'on_return')
as_owner(); c.run("update grade_return g set is_draft = false, returned_copy = null, returned_at = coalesce(returned_at, now()) from enrollment e where e.id = g.enrollment_id and e.course_id = :c and g.is_draft", c=COURSE_A)
for label, patch in (('Return Grades changed to As Soon As I Save', {'return_grades': 'on_save'}),
                     ('the student page turned off', {'student_page_enabled': False}),
                     ('Return Grades set back to no choice', {'return_grades': None})):
    set_class(True, 'on_return')
    a = two_drafts()
    ok('before: two drafts waiting, and the class can be asked how many', rpc(A, 'course_draft_count(:c)', c=COURSE_A) == 2 and [state(ENR1, a), state(ENR3, a)] == ['draft', 'draft'])
    rpc(A, 'update_course(:c, :p::jsonb)', c=COURSE_A, p=json.dumps(patch))
    g1, g2 = returned_grade(ENR1, a), returned_grade(ENR3, a)
    ok('%s: both drafts are returned in the same call' % label, [state(ENR1, a), state(ENR3, a)] == ['returned', 'returned']
       and rpc(A, 'course_draft_count(:c)', c=COURSE_A) == 0)
    ok('each as Return would leave it: the new grade, and for the one returned before, the old grade as previous and Updated (%s)' % label,
       g1['grade']['value'] == 6 and g1['previous'] is None and g1['updated_at'] is None
       and g2['grade']['value'] == 9 and g2['previous']['value'] == 7 and g2['updated_at'] is not None, (g1, g2))
    rpc(A, 'update_course(:c, :p::jsonb)', c=COURSE_A, p=json.dumps({'student_page_enabled': True, 'return_grades': 'on_return'}))
    ok('turning When I Return Them back on leaves them returned (%s)' % label, [state(ENR1, a), state(ENR3, a)] == ['returned', 'returned'])
set_class(True, 'on_return')
a = two_drafts()
rpc(A, 'update_course(:c, :p::jsonb)', c=COURSE_A, p=json.dumps({'name': 'Science 8', 'return_grades': 'on_return', 'student_page_enabled': True}))
ok('a save of the settings that leaves the class on When I Return Them returns nothing', [state(ENR1, a), state(ENR3, a)] == ['draft', 'draft'])
ok("Teacher B cannot ask how many drafts Teacher A's class has", rpc(B, 'course_draft_count(:c)', c=COURSE_A) == 0)
def anon_count():
    as_role('anon'); c.run('select course_draft_count(:c)', c=COURSE_A)
expect_error('anon cannot run course_draft_count', anon_count, 'permission denied')
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s,%s}' % (ENR1, ENR3), k=key())

# ── Who can reach what ──────────────────────────────────────────────────
set_class(True, 'on_return')
acc = new_assessment(K, 'points')
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=acc)
for role in ('anon',):
    def read():
        as_role(role); c.run('select * from grade_return')
    expect_error('anon cannot read grade_return', read, 'permission denied')
    def ret():
        as_role(role); c.run('select return_grades(:a, :ids::uuid[], :k)', a=acc, ids='{%s}' % ENR1, k=key())
    expect_error('anon cannot run return_grades', ret, 'permission denied')
    def lst_():
        as_role(role); c.run('select list_course_grade_returns(:c)', c=COURSE_A)
    expect_error('anon cannot run list_course_grade_returns', lst_, 'permission denied')
expect_error('no JWT: return_grades is refused', lambda: rpc(None, 'return_grades(:a, :ids::uuid[], :k)', a=acc, ids='{%s}' % ENR1, k=key()), 'not authenticated')
ok('no JWT: list_course_grade_returns gives nothing', rpc(None, 'list_course_grade_returns(:c)', c=COURSE_A) == {})
as_teacher(None); ok('no JWT: no grade_return row can be read', c.run('select count(*) from grade_return')[0][0] == 0)
as_teacher(B); ok("Teacher B reads none of Teacher A's grade_return rows", c.run('select count(*) from grade_return')[0][0] == 0)
as_teacher(A); ok('Teacher A reads their own', c.run('select count(*) from grade_return')[0][0] > 0)
ok("Teacher B's list of Teacher A's class is empty", rpc(B, 'list_course_grade_returns(:c)', c=COURSE_A) == {})
expect_error("Teacher B cannot return Teacher A's grades", lambda: rpc(B, 'return_grades(:a, :ids::uuid[], :k)', a=acc, ids='{%s}' % ENR1, k=key()), 'assessment not found')
ok('and the grade is still a draft', state(ENR1, acc) == 'draft')
for what, sql in (('insert into', "insert into grade_return (enrollment_id, assessment_id, is_draft) values ('%s', '%s', false)" % (ENR1, new_assessment(K, 'points'))),
                  ('update', 'update grade_return set is_draft = false'), ('delete from', 'delete from grade_return')):
    def direct():
        as_teacher(A); c.run(sql)
    expect_error('a teacher cannot %s grade_return directly, even their own rows' % what, direct, 'permission denied')
for fn, args in (('_grade_copy', "'%s', '%s'" % (ENR1, acc)), ('_grade_return_holds', "'%s'" % ENR1),
                 ('_grade_return_apply', "'%s', '%s', null, null" % (ENR1, acc)), ('_grade_return_one', "'%s', '%s', now()" % (ENR1, acc)),
                 ('_grade_copy_in_use', "null, '%s'" % acc), ('_grade_return_lock', "'%s'" % COURSE_A),
                 ('_grade_copy_of', "1, 0, null, null, null, null"), ('_grade_copy_entry', "1, 0, null, null, false")):
    def call():
        as_teacher(A); c.run('select public.%s(%s)' % (fn, args))
    expect_error('a teacher cannot call %s' % fn, call, 'permission denied')
# The helpers SECURITY INVOKER RPCs call live in fv_private, which the API
# does not serve, and do nothing outside the RPC that calls them.
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=acc, ids='{%s}' % ENR1, k=key())
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR1, a=acc)
before = rows('select * from grade_return order by 1, 2')
for who in (A, B):
    rpc(who, 'fv_private.grade_return_remap(:a, :m::jsonb, :m::jsonb)', a=acc, m=json.dumps({C1: C2}))
    rpc(who, 'fv_private.restore_grade_returns(:p::jsonb)', p=json.dumps({'grade_returns': [{'enrollment_id': ENR1, 'assessment_id': acc, 'is_draft': False}]}))
ok('called by hand, by Teacher A or Teacher B, the restore and move helpers change nothing', rows('select * from grade_return order by 1, 2') == before)
ok("Teacher B is told nothing about Teacher A's work", rpc(B, 'fv_private.work_is_scored(:e, :a)', e=ENR1, a=acc) is False
   and rpc(A, 'fv_private.work_is_scored(:e, :a)', e=ENR1, a=acc) is True)
for fn, args in (('grade_return_remap', "'%s', '{}'::jsonb, '{}'::jsonb" % acc), ('restore_grade_returns', "'{}'::jsonb"), ('work_is_scored', "'%s', '%s'" % (ENR1, acc))):
    def call():
        as_role('anon'); c.run('select fv_private.%s(%s)' % (fn, args))
    expect_error('anon cannot call fv_private.%s' % fn, call, 'permission denied')
as_owner()
callable_ = sorted(r[0] for r in rows("""select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'fv_private', 'student_submit') and has_function_privilege('authenticated', p.oid, 'execute')
       and (p.proname ~ 'grade_return|return_grades|student_card|cards_work|draft_count|_cell$|work_is_scored|_fv_|_grade_copy'
            or n.nspname in ('fv_private', 'student_submit'))"""))
ok('what Batch A leaves a signed-in teacher able to run: 15 RPCs and policy helpers in public, 3 helpers outside the API',
   callable_ == sorted(['public.return_grades', 'public.list_course_grade_returns', 'public.course_draft_count',
                        'public.fv_owns_score_cell', 'public.fv_owns_tag_score_cell', 'public.fv_owns_rubric_score_cell', 'public.fv_owns_rubric_check_cell',
                        'public.issue_student_cards', 'public.list_student_cards', 'public.mark_student_cards_printed', 'public.unlock_student_card',
                        'public.unlock_all_student_cards', 'public.reissue_student_card', 'public.set_cards_work_until',
                        'fv_private.grade_return_remap', 'fv_private.restore_grade_returns', 'fv_private.work_is_scored']), callable_)
ok("the same-class helpers say no for another teacher's cell",
   rpc(B, 'fv_owns_score_cell(:e, :a)', e=ENR1, a=acc) is False and rpc(A, 'fv_owns_score_cell(:e, :a)', e=ENR1, a=acc) is True)

as_owner()
ok('none of the trigger functions can be called by a teacher or anon',
   one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_grade_return_on_change', '_grade_return_repoint', '_grade_return_before', '_grade_return_release')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))""") == 0)
ok('every score table has its row trigger before and its three statement triggers after',
   one("select count(*) from pg_trigger where tgname in ('grade_return_before', 'grade_return_insert', 'grade_return_update', 'grade_return_delete') and not tgisinternal") == 16)
def scratch():
    as_teacher(A); c.run('select * from grade_return_before')
expect_error('the scratch table of copies kept before a change cannot be read by a teacher', scratch, 'permission denied')

as_owner()
ok('at the end of all of this the scratch table is empty', one('select count(*) from grade_return_before') == 0)

finish()
