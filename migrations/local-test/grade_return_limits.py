"""Exercise migrations/2026110905_grade_return_limits.sql (S0-M4b): the three
known limits of Batch A's grade_return, created_at on the student's page,
and seen_at kept from the teacher's list.

Run it against a database with Batch A loaded. It shows each limit as it is
with Batch A alone (checks named "today:"), applies the migration inside its
own transaction, and shows each closed. One transaction, rolled back.

Run against a database that already has the migration (its last part needs
that, because it commits): the nightly procedure, called as the job calls
it, on its own connection. That part cleans up after itself.

PGPORT=54329 PGDATABASE=fv_a python3 grade_return_limits.py        # Batch A alone
PGPORT=54329 PGDATABASE=fv_a4b python3 grade_return_limits.py      # with 2026110905 loaded too
"""
import json, os, re, sys
from batch_a_common import *
from run import split

MIGRATION = os.path.join(HERE, '..', '2026110905_grade_return_limits.sql')
FILE_02 = open(os.path.join(HERE, '..', '2026110902_grade_return.sql')).read()
LOADED = c.run("select to_regprocedure('public.grade_return_repair()') is not null")[0][0]
def statements():
    return [s for s in split(open(MIGRATION).read()) if s.strip().lower() not in ('begin', 'commit')]
def apply():
    as_owner()
    for s in statements(): c.run(s)
def md5(fn): return one("select md5(pg_get_functiondef('%s'::regprocedure))" % fn)
def kept_copy(e, a): return one('select working_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
def triggers_off(sql, **kw):
    """A write the triggers do not see, as a superuser can make one."""
    as_owner(); c.run("set local session_replication_role = replica"); c.run(sql, **kw); c.run("set local session_replication_role = origin")
DRIFT = 'select count(*) from grade_return g where g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)'
ORPHANS = """select count(*) from grade_return g where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
                                                     or not exists (select 1 from assessment a where a.id = g.assessment_id)"""
def flat(v, path=''):
    if isinstance(v, dict):
        out = {}
        for k, x in v.items(): out.update(flat(x, path + '.' + k))
        return out or {path: {}}
    if isinstance(v, list):
        out = {}
        for i, x in enumerate(v): out.update(flat(x, '%s[%d]' % (path, i)))
        return out or {path: []}
    return {path: v}

c.run('begin')
K = build_class()
ok('running against a database %s 2026110905' % ('with' if LOADED else 'without'), True)

# ── A class to work in, and a student signed in to it ──────────────────
as_owner()
c.run("update student set date_of_birth = '2012-05-15' where id = :s", s=STU1)
set_class(True, 'on_return')
p1 = new_assessment(K, 'points', title='Quiz', date_assigned='2026-10-01')
p2 = new_assessment(K, 'points', title='Same day, made later', date_assigned='2026-10-01')
as_owner(); c.run("update assessment set created_at = '2026-10-01 09:00:00+00' where id = :a", a=p1)
c.run("update assessment set created_at = '2026-10-01 09:00:01.5+00' where id = :a", a=p2)
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=p1); rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=p1, ids='{%s}' % ENR1, k=key())
rpc(A, 'issue_student_cards(:c, null, :k)', c=COURSE_A, k=key())
code = one('select code from student_card where enrollment_id = :e and stopped_at is null', e=ENR1)
token = svc("student_submit.verify_card(:c, '2012-05-15', null, null, null, 'ip-1', false)", c=code)['session_token']
def page(): return svc("student_submit.page(:t, :e, 'ip-1')", t=token, e=ENR1)
svc("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=token, e=ENR1, ids='{%s,%s}' % (p1, p2))   # opened: one returned piece, one with no grade
page0 = page()
list0 = rpc(A, 'list_course_grade_returns(:c)', c=COURSE_A)
restore0, page_md5 = md5('fv_private.restore_grade_returns(jsonb)'), md5('student_submit.page(text,uuid,text)')

# The limits as Batch A leaves them. Each block is undone before the migration.
if not LOADED:
    ok('today (e): the teacher\'s list sends seen_at, and lists a piece for no reason but that the student opened it',
       'seen_at' in list0[p1][ENR1] and list0.get(p2, {}).get(ENR1) == {'is_draft': False, 'seen_at': list0[p2][ENR1]['seen_at']}, list0)
    ok('today: the page lists the two pieces and sends no created_at', page0.get('ok') and len(page0['assessments']) == 2
       and not any('created_at' in a for a in page0['assessments']), page0)
    # a. A grade first given with the triggers off has no row, and the repair does not make one.
    sp()
    na = new_assessment(K, 'points')
    triggers_off('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 6)', e=ENR1, a=na)
    repair = [FILE_02[FILE_02.index(start):FILE_02.index(';', FILE_02.index(start))]
              for start in ('delete from public.grade_return g\n where not exists', 'update public.grade_return g\n   set working_copy')]
    as_owner()
    for x in repair: c.run(x)
    ok("today (a): Batch A's two repair statements leave a grade given with the triggers off without a grade_return row",
       len(repair) == 2 and state(ENR1, na) == 'none' and kept_copy(ENR1, na) is None and working_copy(ENR1, na)['value'] == 6)
    back()
    # b. A hand-made restore with grade_returns and no courses row, into an As Soon As I Save class.
    sp()
    set_class(True, 'on_save')
    nb = new_assessment(K, 'points')
    payload = {'scores': [{'enrollment_id': ENR2, 'assessment_id': nb, 'value': 5}],
               'grade_returns': [{'enrollment_id': ENR2, 'assessment_id': nb, 'is_draft': True}]}
    rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
    ok('today (b): such a restore leaves a draft in a class that does not hold grades',
       state(ENR2, nb) == 'draft' and rpc(A, 'course_draft_count(:c)', c=COURSE_A) == 1, state(ENR2, nb))
    back()
    # c. TRUNCATE, and a delete with the trigger off, leave orphan rows.
    for what in ('enrollment', 'assessment', 'course'):
        sp(); as_owner(); c.run('truncate public.%s cascade' % what)
        ok('today (c): truncate %s cascade leaves grade_return rows with no student or assessment' % what, one(ORPHANS) > 0, one(ORPHANS))
        back()
    sp(); as_owner()
    c.run('alter table public.assessment disable trigger grade_return_gone'); c.run('delete from assessment where id = :a', a=p1)
    c.run('alter table public.assessment enable trigger grade_return_gone')
    ok('today (c): an owner-level delete with the trigger off leaves the row, for a direct read to find',
       one(ORPHANS) == 1 and one('select count(*) from grade_return where assessment_id = :a', a=p1) == 1)
    back()

    # ── The guards ─────────────────────────────────────────────────────
    c.run('savepoint guard'); as_owner(); c.run('alter table public.grade_return rename to grade_return_elsewhere')
    expect_error('without Batch A the file stops at its first check', apply, 'apply Batch A')
    c.run('rollback to savepoint guard'); as_owner()
    d = one("select pg_get_functiondef('student_submit.page(text,uuid,text)'::regprocedure)")
    assert d.count("'title', a.title,") == 1
    c.run(d.replace("'title', a.title,", "'title',  a.title,"))
    expect_error('a page() that is not the one Batch A makes stops the file', apply, 'is not the definition this migration was written against')
    ok('and nothing of it exists', one("select to_regprocedure('public.grade_return_repair()') is null")
       and md5('fv_private.restore_grade_returns(jsonb)') == restore0
       and one("select count(*) from pg_trigger where tgname = 'grade_return_truncate'") == 0)
    c.run('rollback to savepoint guard'); as_owner()
    d = one("select pg_get_functiondef('fv_private.restore_grade_returns(jsonb)'::regprocedure)")
    assert d.count('_n      integer := 0;') == 1
    c.run(d.replace('_n      integer := 0;', '_n     integer := 0;'))
    expect_error("a restore helper that is not the one Batch A makes stops the file", apply, 'is not the definition this migration was written against')
    c.run('rollback to savepoint guard')
    ok('(back to Batch A as it was)', md5('fv_private.restore_grade_returns(jsonb)') == restore0 and md5('student_submit.page(text,uuid,text)') == page_md5)

    # ── The migration: first where there is no pg_cron, then with a stand-in for its table and function ──
    c.run('savepoint nocron')
    apply()
    ok('where pg_cron is not installed the file applies and schedules nothing',
       one("select to_regprocedure('public.grade_return_repair()') is not null and to_regclass('cron.job') is null"))
    c.run('rollback to savepoint nocron')
    as_owner()
    c.run('create schema cron')
    c.run('create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text)')
    c.run("""create function cron.schedule(text, text, text) returns bigint language sql
             as $f$ insert into cron.job (jobname, schedule, command) values ($1, $2, $3) returning jobid::bigint $f$""")
    before_rows = rows('select * from grade_return order by 1, 2'); before_scores = score_fingerprint()
    apply()
    ok('applied straight after Batch A it changes no grade_return row and no score',
       rows('select * from grade_return order by 1, 2') == before_rows and score_fingerprint() == before_scores)
    ok('the nightly job is scheduled once, at 10:47 UTC, to call the procedure',
       rows('select jobname, schedule, command from cron.job') == [['fv_grade_return_repair_daily', '47 10 * * *', 'call public.grade_return_repair_nightly()']])
    FNS = ('fv_private.restore_grade_returns(jsonb)', 'student_submit.page(text,uuid,text)', 'public.grade_return_repair()', 'public.list_course_grade_returns(uuid)')
    snap = [md5(f) for f in FNS]
    apply()
    ok('a second run changes nothing and schedules nothing more',
       snap == [md5(f) for f in FNS]
       and one('select count(*) from cron.job') == 1
       and one("select count(*) from pg_trigger where tgname = 'grade_return_truncate'") == 2)
    as_owner(); c.run('drop schema cron cascade')

# ── d. The student's page sends created_at ─────────────────────────────
page1 = page()
table = {r[0]: r[1] for r in rows("select id::text, to_jsonb(created_at) #>> '{}' from assessment where course_id = :c", c=COURSE_A)}
ok('page: every assessment has created_at, equal to the table\'s to the microsecond',
   page1.get('ok') and len(page1['assessments']) == 2 and all(a.get('created_at') == table[a['id']] for a in page1['assessments']),
   [(a.get('created_at'), table.get(a['id'])) for a in page1.get('assessments', [])])
ok('page: two pieces with one date can be told apart by it',
   {a['title']: a['created_at'] for a in page1['assessments']}['Quiz'] < {a['title']: a['created_at'] for a in page1['assessments']}['Same day, made later'])
f0, f1 = flat({k: v for k, v in page0.items()}), flat(page1)
added = sorted(set(f1) - set(f0)); changed = sorted(k for k in f0 if k not in f1 or f0[k] != f1[k])
if not LOADED:
    ok('page: the only new keys are the two created_at, and no other value changed (%d compared)' % len(f0),
       added == ['.assessments[0].created_at', '.assessments[1].created_at'] and not changed, (added, changed[:3]))
ok('page: v is still 1, and the returned grade still comes with the piece', page1['v'] == 1
   and [a['grade']['value'] if a['grade'] else None for a in page1['assessments']] == [7, None], page1['assessments'])
ok('page: a draft is still not sent, nor any sign of one',
   not any(k in a for a in page1['assessments'] for k in ('is_draft', 'returned_copy', 'working_copy')))

# ── e. seen_at is the student's own ────────────────────────────────────
list1 = rpc(A, 'list_course_grade_returns(:c)', c=COURSE_A)
ok("the teacher's list sends no seen_at for any student or piece", 'seen_at' not in json.dumps(list1), list1)
ok('and no longer lists a piece only because the student opened it', p2 not in list1 and p1 in list1, sorted(list1))
if not LOADED:
    stripped = {a: {e: {k: v for k, v in row.items() if k != 'seen_at'} for e, row in rows_.items()} for a, rows_ in list0.items() if a != p2}
    ok('everything else in the list is as it was: is_draft, returned_at, updated_at and the copies', list1 == stripped, (list1, stripped))
ok('the server still has it, and the student is still sent their own', one('select seen_at is not null from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=p1)
   and [a['seen_at'] is not None for a in page1['assessments']] == [True, True], page1['assessments'])
set_class(True, 'on_save')
rpc(A, 'upsert_score(:e, :a, 6)', e=ENR1, a=p1)
ok('and the server still uses it: a returned grade the student had opened is marked Updated when it changes under As Soon As I Save',
   returned_grade(ENR1, p1)['previous']['value'] == 7 and returned_grade(ENR1, p1)['updated_at'] is not None, returned_grade(ENR1, p1))
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=p1)
set_class(True, 'on_return')

# ── a. The repair adds the missing row, as a save would have left it ───
ok('before anything is broken the repair finds nothing to do',
   {k: v for k, v in one('select public.grade_return_repair()').items() if k != 'classes'} == {'orphans_removed': 0, 'rows_added': 0, 'working_copies_fixed': 0})
hold = new_assessment(K, 'points')
triggers_off('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 6)', e=ENR1, a=hold)
triggers_off("insert into score (enrollment_id, assessment_id, status) values (:e, :a, 'NS')", e=ENR2, a=hold)   # a status alone is not a grade
triggers_off('update score set value = 9 where enrollment_id = :e and assessment_id = :a', e=ENR1, a=p1)           # an existing row left behind
ok('a grade given with the triggers off has no row; a changed one has an old working copy',
   state(ENR1, hold) == 'none' and kept_copy(ENR1, p1)['value'] == 7 and one(DRIFT) == 1, one(DRIFT))
r = one('select public.grade_return_repair()')
ok('the repair adds the one row and fixes the one working copy', (r['rows_added'], r['working_copies_fixed'], r['orphans_removed']) == (1, 1, 0), r)
ok('in a class that holds grades the new row is a Draft: the student is still shown nothing until it is returned',
   state(ENR1, hold) == 'draft' and returned_grade(ENR1, hold)['grade'] is None and kept_copy(ENR1, hold) == working_copy(ENR1, hold))
ok('a status alone gets no row', state(ENR2, hold) == 'none' and one('select count(*) from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR2, a=hold) == 0)
ok('every grade_return row now holds the grade as the score tables have it', one(DRIFT) == 0)
rpc(A, 'upsert_score(:e, :a, 6)', e=ENR1, a=hold)
ok('the same save sent again afterwards changes nothing: the row knows the grade', state(ENR1, hold) == 'draft' and kept_copy(ENR1, hold)['value'] == 6)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=hold, ids='{%s}' % ENR1, k=key())
ok('and Return gives it to the student', returned_grade(ENR1, hold)['grade']['value'] == 6)
set_class(True, 'on_save')
soon = new_assessment(K, 'points')
triggers_off('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 4)', e=ENR1, a=soon)
r = one('select public.grade_return_repair()')
ok('in a class on As Soon As I Save the new row is Returned at once, as a save there is',
   r['rows_added'] == 1 and state(ENR1, soon) == 'returned' and returned_grade(ENR1, soon)['grade']['value'] == 4, (r, state(ENR1, soon)))

# ── b. The restore cannot leave a draft where none belongs ─────────────
nb = new_assessment(K, 'points')
payload = {'scores': [{'enrollment_id': ENR2, 'assessment_id': nb, 'value': 5}],
           'grade_returns': [{'enrollment_id': ENR2, 'assessment_id': nb, 'is_draft': True}]}
rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
ok('a restore with grade_returns and no courses row, into an As Soon As I Save class, leaves no draft: the grade is Returned',
   state(ENR2, nb) == 'returned' and rpc(A, 'course_draft_count(:c)', c=COURSE_A) == 0 and returned_grade(ENR2, nb)['grade']['value'] == 5,
   (state(ENR2, nb), rpc(A, 'course_draft_count(:c)', c=COURSE_A)))
set_class(True, 'on_return')
nb2 = new_assessment(K, 'points')
payload = {'scores': [{'enrollment_id': ENR2, 'assessment_id': nb2, 'value': 5}],
           'grade_returns': [{'enrollment_id': ENR2, 'assessment_id': nb2, 'is_draft': True}]}
rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
ok('the same restore into a class that holds grades keeps the draft, as before', state(ENR2, nb2) == 'draft')
payload['grade_returns'][0]['enrollment_id'] = ENR_B
before_b = rows('select * from grade_return g join enrollment e on e.id = g.enrollment_id where e.course_id = :c', c=COURSE_B)
rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
ok("a payload naming another teacher's student still touches nothing of theirs",
   rows('select * from grade_return g join enrollment e on e.id = g.enrollment_id where e.course_id = :c', c=COURSE_B) == before_b)

# ── c. No orphan rows ──────────────────────────────────────────────────
n_rows = one('select count(*) from grade_return')
for what in ('enrollment', 'assessment', 'course', 'student'):
    sp(); as_owner(); c.run('truncate public.%s cascade' % what)
    ok('truncate %s cascade leaves no grade_return row without its student or assessment' % what, n_rows > 0 and one(ORPHANS) == 0, one(ORPHANS))
    back()
sp(); as_owner()
c.run('truncate public.score cascade')
ok('truncating some other table takes no grade_return row', one('select count(*) from grade_return') == n_rows)
back()
as_owner()
c.run('alter table public.assessment disable trigger grade_return_gone'); c.run('delete from assessment where id = :a', a=soon)
c.run('alter table public.assessment enable trigger grade_return_gone')
triggers_off('insert into grade_return (enrollment_id, assessment_id, is_draft) values (gen_random_uuid(), gen_random_uuid(), true)')
ok('a delete with the trigger off still leaves its row, and a row can be planted with neither parent', one(ORPHANS) == 2)
ok('the read RPCs skip them', soon not in rpc(A, 'list_course_grade_returns(:c)', c=COURSE_A))
r = one('select public.grade_return_repair()')
ok('the repair removes both', r['orphans_removed'] == 2 and one(ORPHANS) == 0, r)

# ── Who can run what ───────────────────────────────────────────────────
as_owner()
ok('none of the new functions, nor the procedure, can be run by a teacher or anon',
   one("""select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('grade_return_repair', '_grade_return_repair_class', '_grade_return_repair_lost', '_grade_return_truncated', 'grade_return_repair_nightly')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))""") == 0
   and one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('grade_return_repair', '_grade_return_repair_class', '_grade_return_repair_lost', '_grade_return_truncated', 'grade_return_repair_nightly')") == 5)
def as_teacher_call():
    as_teacher(A); c.run('select public.grade_return_repair()')
expect_error('a teacher who calls the repair is refused', as_teacher_call, 'permission denied')
ok('at the end of all of this every grade_return row is right', one(DRIFT) == 0 and one(ORPHANS) == 0)
c.run('rollback')

# ── The nightly procedure, as the job calls it (commits) ───────────────
if LOADED:
    o = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                      database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
    a1, a2 = new_id(), new_id()
    try:
        o.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Nightly', 'points', 10), (:b, :c, 'Nightly 2', 'points', 10)", a=a1, b=a2, c=COURSE_A)
        o.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 3)', e=ENR1, a=a2)      # through the triggers
        o.run("set session_replication_role = replica")
        o.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 8)', e=ENR1, a=a1)      # no row
        o.run('update score set value = 5 where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a2)      # working copy left behind
        o.run('insert into grade_return (enrollment_id, assessment_id, is_draft) values (:e, gen_random_uuid(), true), (gen_random_uuid(), gen_random_uuid(), true)', e=ENR1)
        o.run("set session_replication_role = origin")
        broken = (o.run(ORPHANS)[0][0], o.run(DRIFT.replace('select count(*)', 'select count(*)'))[0][0],
                  o.run('select count(*) from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a1)[0][0])
        o.run('call public.grade_return_repair_nightly()')
        mended = (o.run(ORPHANS)[0][0], o.run(DRIFT)[0][0],
                  o.run('select count(*) from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a1)[0][0])
        ok('the nightly procedure, called as the job calls it: two orphans, one working copy left behind and one missing row before; none after',
           broken[0] == 2 and broken[1] >= 1 and broken[2] == 0 and mended == (0, 0, 1), (broken, mended))
        o.run('begin')
        try:
            o.run('call public.grade_return_repair_nightly()'); inside = None
        except pg.DatabaseError as e:
            inside = e.args[0].get('M')
        o.run('rollback')
        ok('it commits class by class, so it cannot be run inside another transaction', inside is not None and 'transaction' in inside, inside)
        ok('no class is left locked when it ends', o.run("select count(*) from pg_locks where locktype = 'transactionid' and pid <> pg_backend_pid() and not granted")[0][0] == 0)
    finally:
        o.run("set session_replication_role = origin")
        o.run('delete from assessment where id = any (:ids::uuid[])', ids='{%s,%s}' % (a1, a2))
        o.run('select public.grade_return_repair()')
        ok('(cleaned up: no row of the nightly check is left)', o.run('select count(*) from grade_return')[0][0] == 0 and o.run('select count(*) from score')[0][0] == 0)
        o.close()
else:
    print('NOTE the nightly procedure commits, so it is checked only on a database that has 2026110905 loaded')

print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
