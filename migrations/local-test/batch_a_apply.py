"""Apply Batch A's four migrations to a database that has scores but not the
migrations, the way they will meet gradebook-prod, and check what that does
to existing rows:

- every function the batch patches or copies starts as the live one, byte
  for byte (live-function-md5.txt), and the patch refuses any other body;
- the backfill: every existing grade reads as Returned, a status or a Note
  for the Report alone is not a grade, and not one score row changes (a
  checksum of the four score tables before and after);
- every existing class has the student page off and no Return Grades choice;
- the files can be run a second time and change nothing;
- how long a rubric fill for 30 students takes before the batch, with the
  same-class policies, and with the Draft and Returned triggers.

Needs a database built WITHOUT the four migrations (README.md, "Batch A").
One transaction, rolled back at the end, so it can be run again.

PGPORT=54329 PGDATABASE=fv_a_pre python3 batch_a_apply.py
"""
import importlib.util, time
from batch_a_common import *

spec = importlib.util.spec_from_file_location('run', os.path.join(HERE, 'run.py'))
run = importlib.util.module_from_spec(spec); spec.loader.exec_module(run)
MIGRATIONS = ['2026110901_score_rows_same_class.sql', '2026110902_grade_return.sql',
              '2026110903_student_card.sql', '2026110904_student_sessions_page.sql']
def statements(name):
    return run.split(open(os.path.join(HERE, '..', name)).read())
def apply(name):
    # Each file is its own transaction (begin ... commit). Here the script's
    # one transaction stands in for it, so everything can be rolled back.
    as_owner()
    for st in statements(name):
        if st.split('\n')[-1].strip().lower() not in ('begin', 'commit'):
            c.run(st)
def last_line(st): return st.split('\n')[-1].strip().lower()

for m in MIGRATIONS:
    sts = statements(m)
    ok('%s is one transaction: begin first, commit last' % m, last_line(sts[0]) == 'begin' and last_line(sts[-1]) == 'commit')
    ok("%s sets a lock timeout, then runs its checks before it creates or changes anything" % m,
       sts[1].strip().lower().endswith("set local lock_timeout = '5s'") and '$guard$' in sts[2]
       and not any(w in ' '.join(sts[:2]).lower() for w in ('create table', 'alter table', 'create or replace')), sts[1][-60:])

ok('this database does not have Batch A yet', one("select to_regclass('public.grade_return') is null"))

# ── Every function is the live one before the batch touches it ─────────
want = live_md5()
got = {r[0]: r[1] for r in rows("""select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p
                                    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'""")}
for name in sorted(want):
    if name == 'get_class_bundle':
        continue  # not loaded: the batch does not touch it
    ok('%s is the live function, byte for byte' % name, got.get(name) == want[name], got.get(name))

c.run('begin')
K = build_class(); KB = build_class(COURSE_B)
T1, T2, C1, C2, K1 = K['t1'], K['t2'], K['c1'], K['c2'], K['k1']

# ── Scores as they are today, in both teachers' classes ────────────────
pts = new_assessment(K, 'points'); comp = new_assessment(K, 'competencies'); rub = new_assessment(K, 'rubric')
only_status = new_assessment(K, 'points'); only_note = new_assessment(K, 'points'); only_comment = new_assessment(K, 'competencies')
b_pts = new_assessment(KB, 'points', COURSE_B)
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=pts); rpc(A, 'upsert_score(:e, :a, 0)', e=ENR2, a=pts)
rpc(A, "set_score_status(:e, :a, 'LATE')", e=ENR1, a=pts)
rpc(A, "upsert_tag_score(:e, :a, :t, 3, 1::smallint, 'Clear question')", e=ENR1, a=comp, t=T1)
rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR1, a=comp, t=T2)
rpc(A, "upsert_rubric_score(:e, :a, :x, 3, 0::smallint, 'Number the steps', 'Drew it')", e=ENR2, a=rub, x=C1)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR2, a=rub, k=K1)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=rub, k=K1)                       # ticks only
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR1, a=only_status)                         # a status only
rpc(A, "save_score_report_note(:e, :a, 'explained her method', :k)", e=ENR1, a=only_note, k=key())  # a note only
rpc(A, "save_score_comment(:e, :a, 'See me')", e=ENR2, a=only_comment)                  # a comment only
rpc(A, "save_score_comment(:e, :a, '')", e=ENR1, a=only_comment)                        # a blank comment
rpc(B, 'upsert_score(:e, :a, 9)', e=ENR_B, a=b_pts)
as_owner(); c.run("update score set updated_at = '2026-10-01 09:00+00', scored_at = '2026-09-30 09:00+00' where assessment_id = :a and enrollment_id = :e", a=pts, e=ENR1)
graded = [(ENR1, pts), (ENR2, pts), (ENR1, comp), (ENR2, rub), (ENR1, rub), (ENR2, only_comment), (ENR_B, b_pts)]
ungraded = [(ENR1, only_status), (ENR1, only_note), (ENR1, only_comment)]

# ── A rubric fill for 30 students, before the batch ────────────────────
as_owner()
fill_enr = []
for n in range(30):
    s, e = new_id(), new_id()
    c.run("insert into student (id, teacher_id, first_name) values (:s, :t, :n)", s=s, t=A, n='Fill %d' % n)
    c.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=e, s=s, c=COURSE_A)
    fill_enr.append(e)
c.run("insert into criterion (id, rubric_id, name) values (gen_random_uuid(), :r, 'Three'), (gen_random_uuid(), :r, 'Four'), (gen_random_uuid(), :r, 'Five')", r=K['r1'])
def fill_time():
    a = new_assessment(K, 'rubric')
    as_teacher(A); t0 = time.time()
    for e in fill_enr:
        c.run('select fill_rubric(:e, :a, 3)', e=e, a=a)
    took = time.time() - t0
    as_owner(); c.run('delete from assessment where id = :a', a=a)
    return took * 1000
fill_time(); t_before = min(fill_time() for _ in range(3))

slip_before = {r[0]: r[1] for r in rows("""select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                           where n.nspname = 'public' and p.proname in ('_issue_access_code', '_issue_report_code')""")}
open_before = one("select pg_get_functiondef('student_submit.open(text,text)'::regprocedure)")
before = score_fingerprint()
counts = rows('select (select count(*) from score), (select count(*) from tag_score), (select count(*) from rubric_score), (select count(*) from rubric_check_score)')[0]

# ── Apply: the same-class policies first ───────────────────────────────
apply(MIGRATIONS[0])
ok('the same-class policies change no score row', score_fingerprint() == before)
fill_time(); t_policies = min(fill_time() for _ in range(3))
for t, name in (('score', 'score_same_class'), ('tag_score', 'tag_score_same_class'), ('rubric_score', 'rubric_score_same_class'),
                ('rubric_check_score', 'rubric_check_score_same_class'), ('dibels_score', 'dibels_score_same_class')):
    ok('%s has one policy, %s' % (t, name), rows("select polname from pg_policy where polrelid = ('public.' || :t)::regclass", t=t) == [[name]])
as_teacher(A); mine = c.run('select count(*) from score')[0][0]
as_teacher(B); theirs = c.run('select count(*) from score')[0][0]
ok('each teacher still reads every score row of their own', mine + theirs == counts[0] and theirs == 1, (mine, theirs, counts))

# ── Then Draft and Returned, cards and sessions ────────────────────────
apply(MIGRATIONS[1])
ok('the backfill changes no score row: the checksum of the four tables is the same', score_fingerprint() == before)
ok('and adds or removes none', rows('select (select count(*) from score), (select count(*) from tag_score), (select count(*) from rubric_score), (select count(*) from rubric_check_score)')[0] == counts)
ok('one grade_return row for every student and assessment that has a grade', one('select count(*) from grade_return') == len(graded),
   rows('select enrollment_id, assessment_id from grade_return'))
ok('none of them a draft, none with a copy, each with a returned date',
   one('select count(*) from grade_return where is_draft or returned_copy is not null or previous_copy is not null or returned_at is null or seen_at is not null or updated_at is not null') == 0)
for e, a in graded:
    ok('an existing grade is Returned (%s)' % one('select title from assessment where id = :a', a=a), state(e, a) == 'returned')
ok('ticks alone are a grade', state(ENR1, rub) == 'returned')
ok('a comment alone is a grade', state(ENR2, only_comment) == 'returned')
ok('a status alone is not: no row', state(ENR1, only_status) == 'none')
ok('a Note for the Report alone is not: no row', state(ENR1, only_note) == 'none')
ok('a blank comment is not: no row', state(ENR1, only_comment) == 'none')
ok('returned_at is when the grade was last saved, not when the migration ran',
   one("select returned_at = '2026-10-01 09:00+00' from grade_return where enrollment_id = :e and assessment_id = :a", e=ENR1, a=pts))
ok('every class has the student page off, no Return Grades choice',
   rows('select distinct student_page_enabled, return_grades from course') == [[False, None]])
apply(MIGRATIONS[2]); apply(MIGRATIONS[3])
ok('and no Cards Work Until date', rows('select distinct cards_work_until from course') == [[None]])
ok('cards and sessions change no score row', score_fingerprint() == before)
for e, a in graded:
    ok('the student would read exactly the working copy (%s)' % one('select title from assessment where id = :a', a=a),
       returned_grade(e, a)['grade'] == working_copy(e, a) and working_copy(e, a) is not None)
for e, a in ungraded:
    ok('nothing is read where there is no grade (%s)' % one('select title from assessment where id = :a', a=a), returned_grade(e, a)['grade'] is None)
ok('a status still shows', returned_grade(ENR1, only_status)['status'] == 'NS' and returned_grade(ENR1, pts)['status'] == 'LATE')
ok('no student card and no session exists', one('select (select count(*) from student_card) + (select count(*) from student_submit.device_session)') == 0)
fill_time(); t_all = min(fill_time() for _ in range(3))
ok('a rubric fill for 30 students, 5 criteria: %.0f ms before, %.0f ms with the same-class policies, %.0f ms with the triggers too'
   % (t_before, t_policies, t_all), t_all < 2000)

# ── With the switch off, a save is returned at once, as before ─────────
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR1, a=pts)
ok('with the student page off a change to an existing grade is returned at once', state(ENR1, pts) == 'returned' and returned_grade(ENR1, pts)['grade']['value'] == 8)

# ── The files can be run again ─────────────────────────────────────────
snap = rows('select * from grade_return order by 1, 2')
defs = rows("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'student_submit') and p.prokind = 'f' order by 1""")
for m in MIGRATIONS: apply(m)
ok('a second run of all four files changes no grade_return row', rows('select * from grade_return order by 1, 2') == snap)
ok('and no score row', score_fingerprint() != before and one('select value from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=pts) == 8)
ok('and no function: each patch went in once',
   rows("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'student_submit') and p.prokind = 'f' order by 1""") == defs)

# ── The patches start from the live bodies, and only from them ─────────
got = {r[0]: r[1] for r in rows("""select p.proname, pg_get_functiondef(p.oid) from pg_proc p
                                    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'""")}
ok('seven functions carry a patch', all(mark in got[fn] for fn, mark in (
    ('set_score_status', 'cannot be marked Missing'),
    ('update_course', 'student_page_enabled'), ('move_rubric_scores', 'fv.moving_rubric'),
    ('import_json_restore', 'restore_grade_returns'), ('duplicate_course', 'courses_count_equally, return_grades'),
    ('_issue_access_code', 'live student card'), ('_issue_report_code', 'live student card'))))
open_after = one("select pg_get_functiondef('student_submit.open(text,text)'::regprocedure)")
ok("a slip's open() is its old body with one number changed: 60 unknown codes per address became 300",
   open_after != open_before and open_after.replace("interval '15 minutes') >= 300 then", "interval '15 minutes') >= 60 then") == open_before
   and open_after.count('>= 500 then') == 1 and open_after.count('>= 20 then') == 1 and open_after.count('>= 200 then') == 1)
# Each patch is the live body with only the added lines: take them out again and it is the live function.
PATCHES = {r[0]: r[1] for r in rows("""select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                        where n.nspname = 'public' and p.proname in ('_issue_access_code', '_issue_report_code')""")}
ok('the two slip functions are their old bodies plus two lines',
   all(d.replace("""salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);""", 'salt));') == slip_before[n] for n, d in PATCHES.items()))
ok('create_course, duplicate_assessment, upsert_rubric_score and the other score RPCs are still the live bodies',
   all(md5 == want[name] for name, md5 in rows("""select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'""")
       if name in want and name not in ('set_score_status', 'update_course', 'move_rubric_scores', 'import_json_restore', 'duplicate_course')))
c.run('rollback'); c.run('begin')
as_owner()
live_def = one("select pg_get_functiondef('public.set_score_status(uuid,uuid,text)'::regprocedure)")
c.run(live_def.replace("raise exception 'invalid status %', p_status", "raise exception 'not a status %', p_status"))
def guarded():
    # Statement by statement, with no transaction to save it: the third
    # statement is the check, and it must be what stops the file.
    sts = statements(MIGRATIONS[1])
    c.run(sts[1].split('\n')[-1]); c.run(sts[2])
expect_error('the migration stops at its first check on a function that is not the one it was written against', guarded,
             'is not the definition this migration was written against')
ok('and nothing of it exists: no table, no column, no trigger', one("select to_regclass('public.grade_return') is null and to_regclass('public.grade_return_before') is null")
   and one("select count(*) from information_schema.columns where table_name = 'course' and column_name in ('student_page_enabled', 'return_grades')") == 0
   and one("select count(*) from pg_trigger where tgname like 'grade_return%'") == 0)
c.run('rollback'); c.run('begin'); as_owner()
c.run("insert into assessment (id, course_id, title) values ('77777777-0000-0000-0000-000000000001', :c, 'Other class work')", c=COURSE_B)
c.run("set local session_replication_role = replica")
c.run("insert into score (enrollment_id, assessment_id, value) values (:e, '77777777-0000-0000-0000-000000000001', 3)", e=ENR1)
c.run("set local session_replication_role = origin")
def first_file():
    sts = statements(MIGRATIONS[0])
    c.run(sts[2])
expect_error("the same-class file stops at its first check when a score row names another class's assessment", first_file, 'Nothing was changed')
def out_of_order():
    c.run(statements(MIGRATIONS[3])[2])
expect_error('the sessions file stops at its first check when the two before it are not applied', out_of_order, 'Nothing was changed')
c.run('rollback'); c.run('begin')
apply(MIGRATIONS[1]); apply(MIGRATIONS[2])
as_owner(); c.run(open_before.replace("perform _log('open', 'locked', p_ip_hash);", "perform _log('open', 'locked' , p_ip_hash);", 1))
expect_error("and at its first check when a slip's open() is not the body it was written against", out_of_order,
             'student_submit.open(text,text) is not the definition this migration was written against')

finish()
