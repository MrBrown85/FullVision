"""What Batch A costs, measured: one quiet call each on a production-sized
class (32 students, 70 pieces), as a signed-in teacher, on whatever database
it is pointed at. Run it on a database without the four migrations and on
one with them and compare. It asserts nothing; it prints milliseconds.

It COMMITS the class it makes and leaves it there, so give it a database
built for it (README.md, "Batch A"). The class has to be committed: inside
one long transaction every write would add a dead version of the class's
sync-cursor row that cannot be cleaned up until the end, and every later
call would be timed walking them. A call that destroys what the next one
needs (a clear, a delete) runs in a short transaction of its own that is
rolled back.

PGPORT=54331 PGDATABASE=fv_cost_pre python3 batch_a_cost.py     # without Batch A
PGPORT=54331 PGDATABASE=fv_cost python3 batch_a_cost.py         # with
"""
import os, sys, time, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; COURSE = 'aaaaaaaa-0000-0000-0000-000000000001'
c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                  database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
nid = lambda: str(uuid.uuid4())
BATCH_A = c.run("select to_regclass('public.grade_return') is not null")[0][0]
def owner(): c.run('reset role')
def teacher():
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c.run('set role authenticated')

if c.run("select count(*) from student where first_name = 'Cost'")[0][0]:
    sys.exit('this database already holds the class: build a fresh one')
# ── A class of production size: 32 students, 70 pieces ─────────────────
c.run("insert into student (id, teacher_id, first_name, last_name) select gen_random_uuid(), :t, 'Cost', 'S' || g from generate_series(1, 30) g", t=A)
c.run("""insert into enrollment (id, student_id, course_id, roster_position)
         select gen_random_uuid(), s.id, :c, 100 from student s where s.first_name = 'Cost'""", c=COURSE)
subj, sect, sect2, rub = nid(), nid(), nid(), nid()
c.run("insert into subject (id, course_id, name) values (:s, :c, 'Cost')", s=subj, c=COURSE)
c.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Cost'), (:y, :c, :s, 'Cost, to delete')", x=sect, y=sect2, c=COURSE, s=subj)
c.run("insert into tag (id, section_id, label) select gen_random_uuid(), :x, 'T' || g from generate_series(1, 3) g", x=sect)
c.run("insert into tag (id, section_id, label) select gen_random_uuid(), :x, 'D' || g from generate_series(1, 3) g", x=sect2)
c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Cost', 'advanced')", r=rub, c=COURSE)
c.run("insert into criterion (id, rubric_id, name) select gen_random_uuid(), :r, 'C' || g from generate_series(1, 5) g", r=rub)
c.run("insert into criterion_check (id, criterion_id, level, label) select gen_random_uuid(), id, 3, 'k' from criterion where rubric_id = :r", r=rub)
# 70 pieces: 23 on points, 24 on the rubric, 23 on competencies (three of them on the section to delete).
c.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id)
         select gen_random_uuid(), :c, 'Cost ' || g, case when g % 3 = 0 then 'points' else 'proficiency' end,
                case when g % 3 = 0 then 10 end, case when g % 3 = 1 then :r::uuid end from generate_series(1, 70) g""", c=COURSE, r=rub)
c.run("""insert into assessment_tag (assessment_id, tag_id)
         select a.id, t.id from assessment a join tag t on t.section_id = :x
          where a.course_id = :c and a.title like 'Cost %' and a.score_mode = 'proficiency' and a.rubric_id is null""", x=sect, c=COURSE)
c.run("""insert into assessment_tag (assessment_id, tag_id)
         select a.id, t.id from (select id from assessment where course_id = :c and title like 'Cost %' and score_mode = 'proficiency' and rubric_id is null limit 3) a
           join tag t on t.section_id = :x""", x=sect2, c=COURSE)
c.run("""insert into score (enrollment_id, assessment_id, value) select e.id, a.id, 7 from enrollment e join assessment a on a.course_id = e.course_id
          where e.course_id = :c and a.score_mode = 'points'""", c=COURSE)
c.run("""insert into tag_score (enrollment_id, assessment_id, tag_id, value) select e.id, t.assessment_id, t.tag_id, 3
           from enrollment e join assessment a on a.course_id = e.course_id join assessment_tag t on t.assessment_id = a.id where e.course_id = :c""", c=COURSE)
c.run("""insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) select e.id, a.id, cr.id, 3
           from enrollment e join assessment a on a.course_id = e.course_id join criterion cr on cr.rubric_id = a.rubric_id where e.course_id = :c""", c=COURSE)
c.run("""insert into rubric_check_score (enrollment_id, assessment_id, check_id) select e.id, a.id, k.id
           from enrollment e join assessment a on a.course_id = e.course_id join criterion cr on cr.rubric_id = a.rubric_id
           join criterion_check k on k.criterion_id = cr.id where e.course_id = :c""", c=COURSE)
c.run('analyze')
size = c.run("""select (select count(*) from enrollment where course_id = :c), (select count(*) from assessment where course_id = :c),
                       (select count(*) from score), (select count(*) from tag_score), (select count(*) from rubric_score), (select count(*) from rubric_check_score)""", c=COURSE)[0]
enr = [str(r[0]) for r in c.run('select id from enrollment where course_id = :c order by id', c=COURSE)]
pts = str(c.run("select id from assessment where course_id = :c and score_mode = 'points' and title like 'Cost %' limit 1", c=COURSE)[0][0])
rwork = str(c.run("select id from assessment where course_id = :c and rubric_id = :r limit 1", c=COURSE, r=rub)[0][0])
crit, check = [str(v) for v in c.run("select cr.id, k.id from criterion cr join criterion_check k on k.criterion_id = cr.id where cr.rubric_id = :r limit 1", r=rub)[0]]
tag = str(c.run("select id from tag where section_id = :x limit 1", x=sect)[0][0])
cwork = str(c.run("select assessment_id from assessment_tag where tag_id = :t limit 1", t=tag)[0][0])

def each(sql, n, warm=20, **kw):
    """Milliseconds a call: n calls that can follow one another."""
    teacher()
    for i in range(warm): c.run(sql, v=1 + i % 4, **kw) if ':v' in sql else c.run(sql, **kw)
    t0 = time.perf_counter()
    for i in range(n): c.run(sql, v=1 + i % 4, **kw) if ':v' in sql else c.run(sql, **kw)
    return (time.perf_counter() - t0) / n * 1000
def undone(sql, n, **kw):
    """Milliseconds a call for one that destroys what the next needs: each in its own transaction, rolled back."""
    teacher(); total = 0
    for i in range(n + 2):
        c.run('begin'); t0 = time.perf_counter(); c.run(sql, **kw); dt = time.perf_counter() - t0
        c.run('rollback')
        if i >= 2: total += dt
    return total / n * 1000
def fill30():
    teacher(); total = 0
    for i in range(6):
        t0 = time.perf_counter()
        for e in enr[:30]: c.run('select fill_rubric(:e, :a, :v, 0::smallint)', e=e, a=rwork, v=1 + i % 4)
        dt = time.perf_counter() - t0
        if i >= 1: total += dt
    return total / 5 * 1000

rows = []
rows.append(('select 1 (the round trip)', each('select 1', 2000)))
rows.append(('fv_owns_enrollment (today\'s helper)', each('select fv_owns_enrollment(:e)', 2000, e=enr[0])))
if BATCH_A:
    rows.append(('fv_owns_score_cell', each('select fv_owns_score_cell(:e, :a)', 2000, e=enr[0], a=pts)))
    rows.append(('fv_owns_tag_score_cell', each('select fv_owns_tag_score_cell(:e, :a, :t)', 2000, e=enr[0], a=cwork, t=tag)))
    rows.append(('fv_owns_rubric_score_cell', each('select fv_owns_rubric_score_cell(:e, :a, :x)', 2000, e=enr[0], a=rwork, x=crit)))
    rows.append(('fv_owns_rubric_check_cell', each('select fv_owns_rubric_check_cell(:e, :a, :k)', 2000, e=enr[0], a=rwork, k=check)))
    owner()
    for label, sql, kw in (('_grade_copy, a rubric grade', 'select public._grade_copy(:e, :a)', dict(e=enr[0], a=rwork)),
                           ('_grade_copy, a points grade', 'select public._grade_copy(:e, :a)', dict(e=enr[0], a=pts)),
                           ('_grade_return_holds', 'select public._grade_return_holds(:e)', dict(e=enr[0])),
                           ('student_submit._returned_grade, a rubric grade', 'select student_submit._returned_grade(:e, :a)', dict(e=enr[0], a=rwork))):
        for i in range(20): c.run(sql, **kw)
        t0 = time.perf_counter()
        for i in range(1000): c.run(sql, **kw)
        rows.append((label, (time.perf_counter() - t0)))
    owner()
rows.append(('-', None))
rows.append(('upsert_score', each('select upsert_score(:e, :a, :v)', 1000, e=enr[0], a=pts)))
rows.append(('upsert_tag_score', each('select upsert_tag_score(:e, :a, :t, :v)', 1000, e=enr[0], a=cwork, t=tag)))
rows.append(('upsert_rubric_score', each('select upsert_rubric_score(:e, :a, :x, :v)', 1000, e=enr[0], a=rwork, x=crit)))
rows.append(('clear_score on one rubric grade', undone('select clear_score(:e, :a)', 30, e=enr[1], a=rwork)))
rows.append(('fill_rubric, 5 criteria', each('select fill_rubric(:e, :a, :v, 0::smallint)', 500, e=enr[0], a=rwork)))
rows.append(('clear_row_scores, one student', undone('select clear_row_scores(:e, :c)', 10, e=enr[2], c=COURSE)))
rows.append(('clear_column_scores, 32 students', undone('select clear_column_scores(:a)', 10, a=rwork)))
rows.append(('deleting a section', undone('select delete_section(:x)', 6, x=sect2)))
rows.append(('deleting a rubric used by 24 pieces', undone('select delete_rubric(:r)', 4, r=rub)))
rows.append(('a fill for 30 students, 5 criteria (30 calls)', fill30()))
owner()
ver = c.run('show server_version')[0][0]
print('Postgres %s, %s Batch A; %d students, %d pieces; score rows %d, tag %d, rubric %d, ticks %d' % ((ver, 'with' if BATCH_A else 'without') + tuple(size)))
for label, ms in rows:
    if ms is None: print(); continue
    print('  %-48s %8.3f ms' % (label, ms))
