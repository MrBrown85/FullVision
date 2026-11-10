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

def do(step, e, a):
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
        rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % e, k=key())
    elif kind == 'seen':
        # What student_submit.seen does (student_page.py runs the real one).
        as_owner()
        c.run("""insert into grade_return (enrollment_id, assessment_id, seen_at) values (:e, :a, clock_timestamp())
                 on conflict (enrollment_id, assessment_id) do update set seen_at = excluded.seen_at""", e=e, a=a)
    elif kind == 'class':
        set_class(step['student_page'], step['return_grades'])
    else:
        raise ValueError(kind)

# ── The worked cases ────────────────────────────────────────────────────
doc = json.load(open(os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'grade-state-cases.json')))
ok('the cases file is format 1 and has cases', doc.get('format') == 1 and len(doc['cases']) >= 20, doc.get('format'))
for case in doc['cases']:
    set_class(case['class']['student_page'], case['class']['return_grades'])
    a = new_assessment(K, case['work'])
    n = 0
    for step in case['steps']:
        if 'do' in step:
            do(step, ENR1, a); continue
        n += 1
        want = step['expect']
        got_rg = returned_grade(ENR1, a)
        got = {'state': state(ENR1, a), 'student': symbols(got_rg['grade']), 'status': got_rg['status'],
               'previous': symbols(got_rg['previous']), 'updated': got_rg['updated_at'] is not None}
        ok('case: %s (check %d)' % (case['name'], n), got == want, {'got': got, 'want': want})
    ok('case: %s: the other student in the class is untouched' % case['name'], state(ENR2, a) == 'none')

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
ok('Duplicate Class: the copy is a new class (When I Return Them, student page off)',
   rows('select student_page_enabled, return_grades from course where id = :c', c=dup) == [[False, 'on_return']])
ok('Duplicate Class copies no grades: no grade_return row appears', one('select count(*) from grade_return') == before
   and one('select count(*) from rubric where course_id = :c', c=dup) == 1)
copy_of = rpc(A, 'duplicate_assessment(:a, :k)', a=a, k=key())
ok('Copy Assessment copies no grades: the copy has no score and no grade_return row',
   one('select (select count(*) from grade_return where assessment_id = :a) + (select count(*) from score where assessment_id = :a)', a=copy_of) == 0
   and one('select count(*) from grade_return') == before)

# ── The two server checks ──────────────────────────────────────────────
set_class(True, 'on_return')
as_owner()
other = {n: new_id() for n in ('r', 'c', 'k')}
c.run("insert into rubric (id, course_id, name) values (:r, :co, 'Poster')", r=other['r'], co=COURSE_A)
c.run("insert into criterion (id, rubric_id, name) values (:c, :r, 'Layout')", c=other['c'], r=other['r'])
rub = new_assessment(K, 'rubric'); comp = new_assessment(K, 'competencies'); pts = new_assessment(K, 'points')
expect_error("upsert_rubric_score refuses a level on a criterion that is not on the assessment's rubric",
             lambda: rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=rub, x=other['c']), 'is not in the rubric of assessment')
expect_error('and a note with no level', lambda: rpc(A, "upsert_rubric_score(:e, :a, :x, null, 0::smallint, 'a note')", e=ENR1, a=rub, x=other['c']), '22023')
expect_error('and a criterion on an assessment that has no rubric',
             lambda: rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=comp, x=C1), 'is not in the rubric of assessment')
r = rpc(A, 'upsert_rubric_score(:e, :a, :x, 0)', e=ENR1, a=rub, x=other['c'])
ok('a 0 for a criterion that is not on the rubric is let through and writes nothing (older clients send one after Edit a Copy)',
   r is None and one('select count(*) from rubric_score where assessment_id = :a', a=rub) == 0 and state(ENR1, rub) == 'none', r)
r = rpc(A, 'upsert_rubric_score(:e, :a, :x, null)', e=ENR1, a=rub, x=other['c'])
ok('so is a null level', r is None)
as_owner(); c.run('set local session_replication_role = replica')
c.run("insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :x, 2)", e=ENR1, a=rub, x=other['c'])
c.run('set local session_replication_role = origin')
rpc(A, 'upsert_rubric_score(:e, :a, :x, 0)', e=ENR1, a=rub, x=other['c'])
ok('and a 0 clears a stray row already there', one('select count(*) from rubric_score where assessment_id = :a', a=rub) == 0)
rpc(A, "upsert_rubric_score(:e, :a, :x, 3, 1::smallint, 'Number the steps', 'Drew it')", e=ENR1, a=rub, x=C1)
ok("a criterion on the assessment's rubric saves as before",
   rows('select value, modifier, comment, beyond from rubric_score where assessment_id = :a', a=rub) == [[3, 1, 'Number the steps', 'Drew it']])

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
as_owner(); c.run('update score set value = 3 where enrollment_id = :e and assessment_id = :a', e=ENR2, a=comp)
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=comp)
ok('Missing on work already marked Missing is taken, scored or not', one('select status from score where enrollment_id = :e and assessment_id = :a', e=ENR2, a=comp) == 'NS')
rpc(A, 'clear_score(:e, :a)', e=ENR1, a=comp); rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR1, a=comp)
ok('once the level is cleared, Missing is taken', one('select status from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=comp) == 'NS')
expect_error('an unknown status is still refused first', lambda: rpc(A, "set_score_status(:e, :a, 'missing')", e=ENR1, a=pts), 'invalid status')

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
ok('deleting a criterion under When I Return Them: its levels go, the grade waits as a draft and the student keeps the returned one',
   state(ENR1, dl) == 'draft' and C2 in returned_grade(ENR1, dl)['grade']['criteria'] and C2 not in working_copy(ENR1, dl)['criteria'])
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
n = rpc(A, '_restore_grade_returns(:p::jsonb)', p=json.dumps({'grade_returns': [{'enrollment_id': i['e2'], 'assessment_id': i['a1'], 'is_draft': False}]}))
ok('outside a restore the state helper does nothing, so it is no way to set a state by hand',
   n == 0 and rows('select * from grade_return order by 1, 2') == before, n)

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
                 ('_grade_return_apply', "'%s', '%s', null, null" % (ENR1, acc)),
                 ('_grade_copy_of', "1, 0, null, null, null, null"), ('_grade_copy_entry', "1, 0, null, null, false")):
    def call():
        as_teacher(A); c.run('select public.%s(%s)' % (fn, args))
    expect_error('a teacher cannot call %s' % fn, call, 'permission denied')
# The two helpers a SECURITY INVOKER RPC calls, so teachers can reach them.
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=acc, ids='{%s}' % ENR1, k=key())
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR1, a=acc)
before = rows('select * from grade_return order by 1, 2')
rpc(B, '_grade_return_remap(:a, :m::jsonb, :m::jsonb)', a=acc, m=json.dumps({C1: C2}))
rpc(B, '_restore_grade_returns(:p::jsonb)', p=json.dumps({'grade_returns': [{'enrollment_id': ENR1, 'assessment_id': acc, 'is_draft': False}]}))
ok("Teacher B's calls to the restore and move helpers change none of Teacher A's rows", rows('select * from grade_return order by 1, 2') == before)
for fn, args in (('_grade_return_remap', "'%s', '{}'::jsonb, '{}'::jsonb" % acc), ('_restore_grade_returns', "'{}'::jsonb")):
    def call():
        as_role('anon'); c.run('select public.%s(%s)' % (fn, args))
    expect_error('anon cannot call %s' % fn, call, 'permission denied')
ok("the same-class helpers say no for another teacher's cell",
   rpc(B, 'fv_owns_score_cell(:e, :a)', e=ENR1, a=acc) is False and rpc(A, 'fv_owns_score_cell(:e, :a)', e=ENR1, a=acc) is True)

as_owner()
ok('none of the trigger functions can be called by a teacher or anon',
   one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_grade_return_on_change', '_grade_return_repoint')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))""") == 0)
ok('every score table has its three statement triggers',
   one("select count(*) from pg_trigger where tgname in ('grade_return_insert', 'grade_return_update', 'grade_return_delete') and not tgisinternal") == 12)

finish()
