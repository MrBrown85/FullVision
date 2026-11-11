"""Exercise migrations/2026110905_grade_return_limits.sql (S0-M4b): the three
known limits of Batch A's grade_return, created_at on the student's page,
seen_at kept from the teacher's list, and DIBELS work left out of Draft and
Returned.

Run it against a database with Batch A loaded. It shows each limit as it is
with Batch A alone (checks named "today:"), checks the guards, applies the
migration inside its own transaction (twice), and shows each closed. One
transaction, rolled back.

Run against a database that already has the migration (its last part needs
that, because it commits): the nightly procedure, called as the job calls
it, on its own connections. That part cleans up after itself.

PGPORT=54331 PGDATABASE=fv_a python3 grade_return_limits.py        # Batch A alone
PGPORT=54331 PGDATABASE=fv_a4b python3 grade_return_limits.py      # with 2026110905 loaded too
"""
import json, os, re, sys, threading, time
from batch_a_common import *
from run import split

MIGRATION = os.path.join(HERE, '..', '2026110905_grade_return_limits.sql')
FILE_02 = open(os.path.join(HERE, '..', '2026110902_grade_return.sql')).read()
LOADED = c.run("select to_regprocedure('public._grade_return_repair_class(uuid)') is not null")[0][0]
# The header's table: function, md5 as Batch A made it, md5 as this file leaves it.
EXPECT = {m[0]: (m[1], m[2]) for m in re.findall(r'^--   (\S+\([^)]*\))\s+([0-9a-f]{32})\s+([0-9a-f]{32})$', open(MIGRATION).read(), re.M)}
NEW = ('_grade_return_settle', '_grade_return_repair_class', '_grade_return_repair_lost', '_grade_return_truncated',
       '_grade_return_mode_changed', 'grade_return_repair_nightly')
def statements():
    return [s for s in split(open(MIGRATION).read()) if s.strip().lower() not in ('begin', 'commit')]
def apply():
    as_owner()
    for s in statements(): c.run(s)
def md5(fn): return one("select md5(pg_get_functiondef('%s'::regprocedure))" % fn)
def kept_copy(e, a): return one('select working_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
def row(e, a):
    """The whole grade_return row, or None."""
    r = rows('select is_draft, returned_at, returned_copy, previous_copy, updated_at, seen_at, working_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
    return r[0] if r else None
def n_rows_of(a): return one('select count(*) from grade_return where assessment_id = :a', a=a)
def drafts(): return rpc(A, 'course_draft_count(:c)', c=COURSE_A)
def listed(): return rpc(A, 'list_course_grade_returns(:c)', c=COURSE_A)
def give_back(a, e=ENR1): return rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % e, k=key())['returned']
def given(e, a): return (returned_grade(e, a)['grade'] or {}).get('value')
def mode(a, m): rpc(A, 'update_assessment(:a, :p::jsonb)', a=a, p=json.dumps({'score_mode': m}))
def triggers_off(sql, **kw):
    """A write the triggers do not see, as a superuser can make one."""
    as_owner(); c.run("set local session_replication_role = replica"); c.run(sql, **kw); c.run("set local session_replication_role = origin")
def repair():
    """Every class in turn and then the rows with no class, as the nightly procedure does it, but inside this transaction."""
    total = {'orphans_removed': 0, 'rows_added': 0, 'rows_settled': 0}
    for (cid,) in rows('select id from course order by id'):
        for k, v in one('select public._grade_return_repair_class(:c)', c=cid).items(): total[k] = total.get(k, 0) + v
    total['orphans_removed'] += one('select public._grade_return_repair_lost()')
    return total
NOTHING = {'orphans_removed': 0, 'rows_added': 0, 'rows_settled': 0}
# A DIBELS piece's rows are dormant: nothing keeps their working copy up to date, on purpose.
DRIFT = """select count(*) from grade_return g join assessment a on a.id = g.assessment_id
            where a.score_mode <> 'dibels' and g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)"""
ORPHANS = """select count(*) from grade_return g where not exists (select 1 from enrollment e where e.id = g.enrollment_id)
                                                     or not exists (select 1 from assessment a where a.id = g.assessment_id)"""
STRONG = """select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
             where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
               and l.mode not in ('AccessShareLock', 'RowShareLock', 'RowExclusiveLock')"""
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
ok('the file\'s header lists the eight functions it patches, each with two fingerprints', len(EXPECT) == 8, sorted(EXPECT))

# ── A class to work in, and a student signed in to it ──────────────────
as_owner()
c.run("update student set date_of_birth = '2012-05-15' where id = :s", s=STU1)
set_class(True, 'on_return')
p1 = new_assessment(K, 'points', title='Quiz', date_assigned='2026-10-01')
p2 = new_assessment(K, 'points', title='Same day, made later', date_assigned='2026-10-01')
as_owner(); c.run("update assessment set created_at = '2026-10-01 09:00:00+00' where id = :a", a=p1)
c.run("update assessment set created_at = '2026-10-01 09:00:01.5+00' where id = :a", a=p2)
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=p1); give_back(p1)
token = card_session(ENR1, '2012-05-15')   # a card and a signed-in phone, however this database makes cards
def page(): return svc("student_submit.page(:t, :e, 'ip-1')", t=token, e=ENR1)
def on_page(a):
    x = [p for p in page()['assessments'] if p['id'] == a]
    return {k: x[0][k] for k in ('status', 'returned_at', 'updated_at', 'seen_at', 'grade', 'previous')} if x else 'NOT LISTED'
def seen(*a): return svc("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=token, e=ENR1, ids='{%s}' % ','.join(a))['seen']
seen(p1, p2)   # opened: one returned piece, one with no grade
page0 = page()
list0 = listed()
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
    old_repair = [FILE_02[FILE_02.index(start):FILE_02.index(';', FILE_02.index(start))]
                  for start in ('delete from public.grade_return g\n where not exists', 'update public.grade_return g\n   set working_copy')]
    as_owner()
    for x in old_repair: c.run(x)
    ok("today (a): Batch A's two repair statements leave a grade given with the triggers off without a grade_return row",
       len(old_repair) == 2 and state(ENR1, na) == 'none' and kept_copy(ENR1, na) is None and working_copy(ENR1, na)['value'] == 6)
    back()
    # b. A hand-made restore with grade_returns and no courses row, into an As Soon As I Save class.
    sp()
    set_class(True, 'on_save')
    nb = new_assessment(K, 'points')
    payload = {'scores': [{'enrollment_id': ENR2, 'assessment_id': nb, 'value': 5}],
               'grade_returns': [{'enrollment_id': ENR2, 'assessment_id': nb, 'is_draft': True}]}
    rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
    ok('today (b): such a restore leaves a draft in a class that does not hold grades',
       state(ENR2, nb) == 'draft' and drafts() == 1, state(ENR2, nb))
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
    # f. A DIBELS piece is treated like any grade.
    sp()
    df = new_assessment(K, 'dibels')
    rpc(A, 'save_score_comment(:e, :a, :t)', e=ENR1, a=df, t='Read with expression')
    was = (state(ENR1, df), drafts())
    ok('today (f): a comment saved on a DIBELS piece waits as a Draft, the settings screen counts it, and Return returns it',
       was == ('draft', 1) and give_back(df) == 1 and state(ENR1, df) == 'returned', was)
    back()

    # ── The guards ─────────────────────────────────────────────────────
    c.run('savepoint guard'); as_owner(); c.run('alter table public.grade_return rename to grade_return_elsewhere')
    expect_error('without Batch A the file stops at its first check', apply, 'apply Batch A')
    for fn, find, put in (('student_submit.page(text,uuid,text)', "'title', a.title,", "'title',  a.title,"),
                          ('fv_private.restore_grade_returns(jsonb)', '_n      integer := 0;', '_n     integer := 0;'),
                          ('public._grade_return_on_change()', '_before jsonb;', '_before  jsonb;'),
                          ('student_submit._returned_grade(uuid,uuid)', "'status', s.status,", "'status',  s.status,")):
        c.run('rollback to savepoint guard'); as_owner()
        d = one("select pg_get_functiondef('%s'::regprocedure)" % fn)
        assert d.count(find) == 1
        c.run(d.replace(find, put))
        expect_error('%s not as Batch A made it stops the file' % fn.split('(')[0], apply, 'is not the definition this migration was written against')
    ok('and nothing of it exists', one("select to_regprocedure('public._grade_return_repair_class(uuid)') is null")
       and one("select count(*) from pg_trigger where tgname in ('grade_return_truncate', 'grade_return_mode')") == 0
       and one("select to_regclass('public.grade_return_repair_log') is null"))
    # A function that carries this file's mark but is not what this file makes of it: an earlier draft's patch.
    c.run('rollback to savepoint guard'); as_owner()
    d = one("select pg_get_functiondef('public.list_course_grade_returns(uuid)'::regprocedure)")
    find = "               -- a row with nothing to say (a grade cleared, a save in flight) is left out\n"
    assert d.count(find) == 1
    c.run(d.replace(find, "               -- a row with nothing to say is left out (2026110905)\n"))
    expect_error("a function that carries this file's mark but not this file's patch stops the file too (an earlier draft of it is not taken for the real thing)",
                 apply, 'is not the definition this migration was written against')
    c.run('rollback to savepoint guard')
    ok('(back to Batch A as it was)', all(md5(fn) == was for fn, (was, _b) in EXPECT.items()), [fn for fn, (was, _b) in EXPECT.items() if md5(fn) != was])

    # ── The migration: first where there is no pg_cron, then with a stand-in for its table and function ──
    c.run('savepoint nocron')
    apply()
    ok('where pg_cron is not installed the file applies and schedules nothing',
       one("select to_regprocedure('public._grade_return_repair_class(uuid)') is not null and to_regclass('cron.job') is null"))
    c.run('rollback to savepoint nocron')
    as_owner()
    c.run('create schema cron')
    c.run('create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text)')
    c.run("""create function cron.schedule(text, text, text) returns bigint language sql
             as $f$ insert into cron.job (jobname, schedule, command) values ($1, $2, $3) returning jobid::bigint $f$""")
    dz = new_assessment(K, 'dibels')
    rpc(A, 'save_score_comment(:e, :a, :t)', e=ENR1, a=dz, t='Read with expression')   # Batch A makes a row for it, as its backfill does
    before_rows = rows('select * from grade_return order by 1, 2'); before_scores = score_fingerprint(); cursors = rows('select * from course_sync_cursor order by 1')
    c.run('savepoint first')
    apply()
    first_locks = sorted(set(map(tuple, rows(STRONG))))
    ok('applied after Batch A it changes no grade_return row (a DIBELS piece\'s row among them: %d rows), no score and no class\'s sync version' % len(before_rows),
       n_rows_of(dz) == 1 and rows('select * from grade_return order by 1, 2') == before_rows and score_fingerprint() == before_scores
       and rows('select * from course_sync_cursor order by 1') == cursors)
    ok('each of the eight functions is then exactly what the header says the file leaves',
       all(md5(fn) == becomes for fn, (_w, becomes) in EXPECT.items()), [fn for fn, (_w, b) in EXPECT.items() if md5(fn) != b])
    ok('the nightly job is scheduled once, at 10:47 UTC, to call the procedure',
       rows('select jobname, schedule, command from cron.job') == [['fv_grade_return_repair_daily', '47 10 * * *', 'call public.grade_return_repair_nightly()']])
    ok('it takes no lock on enrollment or assessment that stops a read: %s' % first_locks,
       not [l for l in first_locks if l[0] in ('enrollment', 'assessment') and l[1] == 'AccessExclusiveLock']
       and ('enrollment', 'ShareRowExclusiveLock') in first_locks and ('assessment', 'ShareRowExclusiveLock') in first_locks, first_locks)
    c.run('release savepoint first')
    snap = {r[0]: r[1] for r in rows("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                          where n.nspname in ('public', 'fv_private', 'student_submit') and p.prokind = 'f'""")}
    trig = rows("select tgrelid::regclass::text, tgname, pg_get_triggerdef(oid) from pg_trigger where tgname in ('grade_return_truncate', 'grade_return_mode') order by 1, 2")
    apply()
    ok('a second run changes nothing and schedules nothing more',
       snap == {r[0]: r[1] for r in rows("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                               where n.nspname in ('public', 'fv_private', 'student_submit') and p.prokind = 'f'""")}
       and one('select count(*) from cron.job') == 1 and len(trig) == 3
       and trig == rows("select tgrelid::regclass::text, tgname, pg_get_triggerdef(oid) from pg_trigger where tgname in ('grade_return_truncate', 'grade_return_mode') order by 1, 2")
       and rows('select * from grade_return order by 1, 2') == before_rows)
    ok('and the second run takes no table lock the first did not', sorted(set(map(tuple, rows(STRONG)))) == first_locks, sorted(set(map(tuple, rows(STRONG)))))
    as_owner(); c.run('drop schema cron cascade')
    rpc(A, 'clear_score(:e, :a)', e=ENR1, a=dz); as_owner(); c.run('delete from assessment where id = :a', a=dz)

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
list1 = listed()
ok("the teacher's list sends no seen_at for any student or piece", 'seen_at' not in json.dumps(list1), list1)
ok('and no longer lists a piece only because the student opened it', p2 not in list1 and p1 in list1, sorted(list1))
if not LOADED:
    stripped = {a: {e: {k: v for k, v in row_.items() if k != 'seen_at'} for e, row_ in rows_.items()} for a, rows_ in list0.items() if a != p2}
    ok('everything else in the list is as it was: is_draft, returned_at, updated_at and the copies', list1 == stripped, (list1, stripped))
ok('the server still has it, and the student is still sent their own', one('select seen_at is not null from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=p1)
   and [a['seen_at'] is not None for a in page1['assessments']] == [True, True], page1['assessments'])
set_class(True, 'on_save')
rpc(A, 'upsert_score(:e, :a, 6)', e=ENR1, a=p1)
ok('and the server still uses it: a returned grade the student had opened is marked Updated when it changes under As Soon As I Save',
   returned_grade(ENR1, p1)['previous']['value'] == 7 and returned_grade(ENR1, p1)['updated_at'] is not None, returned_grade(ENR1, p1))
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=p1)
set_class(True, 'on_return')

# ── a. The repair decides from the scores and from what the row holds ──
ok('before anything is broken the repair finds nothing to do', repair() == NOTHING)
# A grade first written with the triggers off, in a cell that (i) the student had opened, (ii) the teacher had graded
# and cleared, (iii) has no row at all. In a class that holds grades, then in one on As Soon As I Save.
for label, hold in (('holds grades', 'on_return'), ('is on As Soon As I Save', 'on_save')):
    set_class(True, hold)
    d0 = drafts()
    a1 = new_assessment(K, 'points', date_assigned='2026-10-03'); seen(a1)
    a2 = new_assessment(K, 'points'); rpc(A, 'upsert_score(:e, :a, 3)', e=ENR1, a=a2); rpc(A, 'clear_score(:e, :a)', e=ENR1, a=a2)
    a3 = new_assessment(K, 'points')
    ok('(%s) an opened piece and a cleared one each have an empty row; the third cell has none' % label,
       row(ENR1, a1) is not None and row(ENR1, a2) is not None and row(ENR1, a3) is None
       and (state(ENR1, a1), state(ENR1, a2)) == ('none', 'none'))
    for a in (a1, a2, a3):
        triggers_off('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 6) on conflict (enrollment_id, assessment_id) do update set value = 6', e=ENR1, a=a)
    r = repair()
    ok('(%s) the repair makes the one missing row and settles the two empty ones' % label, r == {'orphans_removed': 0, 'rows_added': 1, 'rows_settled': 2}, r)
    if hold == 'on_return':
        ok('where the class holds grades each of the three is a Draft: counted, in the teacher\'s list, and the student is still shown nothing',
           [state(ENR1, a) for a in (a1, a2, a3)] == ['draft'] * 3 and drafts() == d0 + 3 and all(a in listed() for a in (a1, a2, a3))
           and [given(ENR1, a) for a in (a1, a2, a3)] == [None] * 3, ([state(ENR1, a) for a in (a1, a2, a3)], drafts() - d0))
        ok('and Return gives each to the student', [give_back(a) for a in (a1, a2, a3)] == [1, 1, 1] and [given(ENR1, a) for a in (a1, a2, a3)] == [6, 6, 6])
    else:
        ok('where the class is on As Soon As I Save each of the three is Returned at once, as a save there is',
           [state(ENR1, a) for a in (a1, a2, a3)] == ['returned'] * 3 and drafts() == 0 and [given(ENR1, a) for a in (a1, a2, a3)] == [6, 6, 6],
           [state(ENR1, a) for a in (a1, a2, a3)])
    ok('(%s) the student\'s opening of the first piece is kept' % label, row(ENR1, a1)[5] is not None)
    ok('(%s) every row holds the grade as the score tables have it, and a second repair finds nothing to do' % label, one(DRIFT) == 0 and repair() == NOTHING)
set_class(True, 'on_return')
hold = new_assessment(K, 'points')
triggers_off("insert into score (enrollment_id, assessment_id, status) values (:e, :a, 'NS')", e=ENR2, a=hold)   # a status alone is not a grade
r = repair()
ok('a status alone gets no row', r == NOTHING and row(ENR2, hold) is None, r)
# A returned grade changed with the triggers off.
a4 = new_assessment(K, 'points'); rpc(A, 'upsert_score(:e, :a, 3)', e=ENR1, a=a4); give_back(a4)
triggers_off('update score set value = 9 where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a4)
r = repair()
ok('a returned grade changed with the triggers off becomes a draft of that change: the student keeps the grade they were given',
   r == {'orphans_removed': 0, 'rows_added': 0, 'rows_settled': 1} and state(ENR1, a4) == 'draft' and given(ENR1, a4) == 3
   and row(ENR1, a4)[2]['value'] == 3 and kept_copy(ENR1, a4)['value'] == 9, (r, state(ENR1, a4), given(ENR1, a4)))
rpc(A, 'upsert_score(:e, :a, 9)', e=ENR1, a=a4)
ok('the same save sent again afterwards changes nothing: the row knows the grade', state(ENR1, a4) == 'draft' and kept_copy(ENR1, a4)['value'] == 9)
ok('and Return gives it to the student, with the earlier grade kept as the one before', give_back(a4) == 1 and given(ENR1, a4) == 9
   and returned_grade(ENR1, a4)['previous']['value'] == 3)
ok('a class that is not there has nothing to repair', one('select public._grade_return_repair_class(gen_random_uuid())') == NOTHING)

# ── b. The restore cannot leave a draft where none belongs ─────────────
set_class(True, 'on_save')
nb = new_assessment(K, 'points')
payload = {'scores': [{'enrollment_id': ENR2, 'assessment_id': nb, 'value': 5}],
           'grade_returns': [{'enrollment_id': ENR2, 'assessment_id': nb, 'is_draft': True}]}
rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
ok('a restore with grade_returns and no courses row, into an As Soon As I Save class, leaves no draft: the grade is Returned',
   state(ENR2, nb) == 'returned' and drafts() == 0 and given(ENR2, nb) == 5, (state(ENR2, nb), drafts()))
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
give_back(nb2, ENR2)

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
gone = new_assessment(K, 'points'); rpc(A, 'upsert_score(:e, :a, 4)', e=ENR1, a=gone)
as_owner()
c.run('alter table public.assessment disable trigger grade_return_gone'); c.run('delete from assessment where id = :a', a=gone)
c.run('alter table public.assessment enable trigger grade_return_gone')
triggers_off('insert into grade_return (enrollment_id, assessment_id, is_draft) values (gen_random_uuid(), gen_random_uuid(), true)')
ok('a delete with the trigger off still leaves its row, and a row can be planted with neither parent', one(ORPHANS) == 2)
ok('the read RPCs skip them', gone not in listed())
r = repair()
ok('the repair removes both', r['orphans_removed'] == 2 and one(ORPHANS) == 0, r)

# ── f. DIBELS work has no Draft and no Returned; its rows are dormant ──
# The reviewer's case, in a class that holds grades. ENR1: returned 8, opened, then a draft of 5 on it.
# ENR2: returned 6 and (as far as the row can say) never opened.
set_class(True, 'on_return')
pm = new_assessment(K, 'points', title='Quiz 3', date_assigned='2026-10-04')
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR1, a=pm); give_back(pm); seen(pm); rpc(A, 'upsert_score(:e, :a, 5)', e=ENR1, a=pm)
rpc(A, 'upsert_score(:e, :a, 6)', e=ENR2, a=pm); give_back(pm, ENR2)
first = new_assessment(K, 'points', title='Not graded yet')
r1, r2, pg0, d0 = row(ENR1, pm), row(ENR2, pm), on_page(pm), drafts()
ok('(a points piece: one student has a draft on a returned grade they have opened, the other a returned grade)',
   (state(ENR1, pm), state(ENR2, pm)) == ('draft', 'returned') and pg0['grade']['value'] == 8 and pg0['seen_at'] is not None and pm in listed())
scores0 = score_fingerprint()
mode(pm, 'dibels'); mode(first, 'dibels')
ok('changing a piece to DIBELS changes none of its rows and none of its scores', (row(ENR1, pm), row(ENR2, pm)) == (r1, r2) and score_fingerprint() == scores0)
ok('while it is DIBELS its rows are dormant: the draft is not counted, the piece is not in the teacher\'s list, Return returns nothing',
   drafts() == d0 - 1 and pm not in listed() and give_back(pm) == 0 and give_back(pm, ENR2) == 0, (drafts(), d0))
ok('the student\'s page still lists the piece, with no grade, no returned date and no seen mark',
   on_page(pm) == {'status': None, 'returned_at': None, 'updated_at': None, 'seen_at': None, 'grade': None, 'previous': None}, on_page(pm))
ok('opening it marks nothing', seen(pm) == 0)
rpc(A, 'upsert_score(:e, :a, 9)', e=ENR2, a=pm)            # a returned grade changed while the piece is DIBELS
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=first)         # a cell graded for the first time while it is DIBELS
rpc(A, 'save_score_comment(:e, :a, :t)', e=ENR1, a=first, t='Read with expression')
ok('a save while it is DIBELS makes no row and changes none', (row(ENR1, pm), row(ENR2, pm)) == (r1, r2) and n_rows_of(first) == 0)
ok('the repair leaves a DIBELS piece\'s rows alone and adds none', repair() == NOTHING and (row(ENR1, pm), row(ENR2, pm)) == (r1, r2) and n_rows_of(first) == 0)
mode(pm, 'points'); mode(first, 'points')
ok('changed back, a cell whose grade did not change has its row exactly as it was: the draft, the returned copy, the day it was returned, the student\'s opening of it',
   row(ENR1, pm) == r1 and on_page(pm) == pg0, (row(ENR1, pm), r1))
after2 = row(ENR2, pm)
ok('a returned grade that was changed while the piece was DIBELS: the student keeps the grade they were given, and the change waits as a draft, as any change to a returned grade does',
   state(ENR2, pm) == 'draft' and given(ENR2, pm) == 6 and after2[2]['value'] == 6 and after2[1] == r2[1] and after2[6]['value'] == 9, after2)
ok('a cell first graded while the piece was DIBELS gets the row a first save would leave: a Draft, and the student is shown nothing',
   state(ENR1, first) == 'draft' and given(ENR1, first) is None and kept_copy(ENR1, first) == working_copy(ENR1, first))
ok('the class now counts the teacher\'s own draft and those two', drafts() == d0 + 2, (drafts(), d0))
ok('and Return gives the changed grade, with the earlier one kept as the one before',
   give_back(pm, ENR2) == 1 and given(ENR2, pm) == 9 and returned_grade(ENR2, pm)['previous']['value'] == 6)
mode(pm, 'complete')
ok('a change between two kinds that are not DIBELS touches no row', row(ENR1, pm) == r1)
mode(pm, 'points')
# The same under As Soon As I Save.
give_back(pm); give_back(first)
set_class(True, 'on_save')
ps = new_assessment(K, 'points', title='Quiz 4', date_assigned='2026-10-05')
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=ps); seen(ps); rpc(A, 'upsert_score(:e, :a, 4)', e=ENR2, a=ps)
s1, s2 = row(ENR1, ps), row(ENR2, ps)
mode(ps, 'dibels'); mode(ps, 'points')
ok('As Soon As I Save: to DIBELS and back with nothing changed leaves each row exactly as it was (the same returned date, the opening kept)',
   (row(ENR1, ps), row(ENR2, ps)) == (s1, s2) and s1[1] is not None and s1[5] is not None)
mode(ps, 'dibels'); rpc(A, 'upsert_score(:e, :a, 10)', e=ENR1, a=ps); mode(ps, 'points')
t1 = row(ENR1, ps)
ok('As Soon As I Save: a grade changed while the piece was DIBELS is returned when it is changed back, and marked Updated because the student had opened the earlier one',
   state(ENR1, ps) == 'returned' and given(ENR1, ps) == 10 and t1[3]['value'] == 7 and t1[4] is not None and t1[5] == s1[5] and row(ENR2, ps) == s2, t1)
# A piece that is DIBELS from the start.
set_class(True, 'on_return')
total = one('select count(*) from grade_return'); d0 = drafts()
db = new_assessment(K, 'dibels', title='Fall Benchmark', date_assigned='2026-10-02')
rpc(A, 'save_score_comment(:e, :a, :t)', e=ENR1, a=db, t='Read with expression')
as_owner(); c.run("insert into dibels_score (enrollment_id, assessment_id, period, orf_wrc, orf_errors) values (:e, :a, 'boy', 112, 3)", e=ENR1, a=db)
ok('a save to a DIBELS piece, its comment or its numbers, makes no grade_return row and changes none',
   n_rows_of(db) == 0 and one('select count(*) from grade_return') == total and state(ENR1, db) == 'none')
ok('the comment and the numbers are saved all the same',
   one('select comment from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=db) == 'Read with expression'
   and one('select orf_wrc from dibels_score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=db) == 112)
ok('it is not a draft: the settings screen counts none, Return returns nothing, the teacher\'s list leaves it out, opening it marks nothing',
   drafts() == d0 and give_back(db) == 0 and db not in listed() and seen(db) == 0 and n_rows_of(db) == 0)
sent = [a for a in page()['assessments'] if a['id'] == db]
ok('today: the student\'s page still lists the piece, with no grade and none of its numbers (the page code leaves DIBELS pieces out)',
   len(sent) == 1 and sent[0]['score_mode'] == 'dibels' and sent[0]['grade'] is None
   and not any('orf' in k or 'dibels' in k or 'maze' in k for k in sent[0]), sent)
triggers_off('insert into grade_return (enrollment_id, assessment_id, is_draft, returned_at) values (:e, :a, false, now())', e=ENR1, a=db)
ok('a row planted for it with the triggers off is dormant like any other: not counted, listed or returned, not shown to the student, and left by the repair',
   drafts() == d0 and db not in listed() and give_back(db) == 0 and on_page(db)['returned_at'] is None and repair() == NOTHING and n_rows_of(db) == 1)
payload = {'scores': [{'enrollment_id': ENR2, 'assessment_id': db, 'value': None, 'comment': 'Steady'}],
           'grade_returns': [{'enrollment_id': ENR2, 'assessment_id': db, 'is_draft': True}]}
rpc(A, 'import_json_restore(:p::jsonb, :k)', p=json.dumps(payload), k=key())
ok('a restore that names a state for a DIBELS piece shows nothing either', drafts() == d0 and db not in listed())
# The one thing a dormant row is not kept from (the header says so): the class stops holding grades.
dd = new_assessment(K, 'points'); rpc(A, 'upsert_score(:e, :a, 2)', e=ENR1, a=dd); mode(dd, 'dibels')
rpc(A, 'update_course(:c, :p::jsonb)', c=COURSE_A, p=json.dumps({'student_page_enabled': True, 'return_grades': 'on_save'}))
ok('when a class stops holding grades Batch A returns its drafts, a dormant one too; nothing shows it while the piece is DIBELS',
   row(ENR1, dd)[0] is False and dd not in listed() and drafts() == 0, row(ENR1, dd))
mode(dd, 'points')
ok('and changed back there, the grade is Returned, as every grade in such a class is', state(ENR1, dd) == 'returned' and given(ENR1, dd) == 2)
set_class(True, 'on_return')

# ── Who can run what ───────────────────────────────────────────────────
as_owner()
ok('none of the six new functions, nor the log, can be used by a teacher, anon or the service role',
   one("""select count(*) from pg_proc p, unnest(array['authenticated', 'anon', 'service_role']) r
           where p.pronamespace = 'public'::regnamespace and p.proname = any (:names) and has_function_privilege(r, p.oid, 'execute')""", names=list(NEW)) == 0
   and one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = any (:names)", names=list(NEW)) == 6
   and one("""select count(*) from unnest(array['authenticated', 'anon', 'service_role']) r
               where has_table_privilege(r, 'public.grade_return_repair_log', 'select, insert, update, delete')""") == 0
   and one("select relrowsecurity from pg_class where oid = 'public.grade_return_repair_log'::regclass"))
def as_teacher_call():
    as_teacher(A); c.run('select public._grade_return_repair_class(:c)', c=COURSE_A)
expect_error('a teacher who calls the repair is refused', as_teacher_call, 'permission denied')
def as_service_call():
    as_role('service_role'); c.run('call public.grade_return_repair_nightly()')
expect_error('so is the service role, calling the nightly procedure', as_service_call, 'permission denied')
ok('there is no function that repairs every class in one transaction', one("select to_regprocedure('public.grade_return_repair()') is null"))
ok('at the end of all of this every grade_return row is right', one(DRIFT) == 0 and one(ORPHANS) == 0, (one(DRIFT), one(ORPHANS)))
c.run('rollback')

# ── The nightly procedure, as the job calls it (commits) ───────────────
if LOADED:
    def conn():
        return pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')),
                             database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
    o = conn(); h = conn(); n = conn()
    a1, a2 = new_id(), new_id()
    THIRD = 'cccccccc-0000-0000-0000-00000000000c'; GOING = 'dddddddd-0000-0000-0000-00000000000d'
    try:
        o.run('delete from public.grade_return_repair_log')
        o.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:a, :c, 'Nightly', 'points', 10), (:b, :c, 'Nightly 2', 'points', 10)", a=a1, b=a2, c=COURSE_A)
        o.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 3)', e=ENR1, a=a2)      # through the triggers
        o.run("set session_replication_role = replica")
        o.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 8)', e=ENR1, a=a1)      # no row
        o.run('update score set value = 5 where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a2)      # working copy left behind
        o.run('insert into grade_return (enrollment_id, assessment_id, is_draft) values (:e, gen_random_uuid(), true), (gen_random_uuid(), gen_random_uuid(), true)', e=ENR1)
        o.run("set session_replication_role = origin")
        broken = (o.run(ORPHANS)[0][0], o.run(DRIFT)[0][0],
                  o.run('select count(*) from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a1)[0][0])
        o.run('call public.grade_return_repair_nightly()')
        mended = (o.run(ORPHANS)[0][0], o.run(DRIFT)[0][0],
                  o.run('select count(*) from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a1)[0][0])
        ok('the nightly procedure, called as the job calls it: two orphans, one working copy left behind and one missing row before; none after; nothing in the log',
           broken[0] == 2 and broken[1] >= 1 and broken[2] == 0 and mended == (0, 0, 1) and o.run('select count(*) from public.grade_return_repair_log')[0][0] == 0,
           (broken, mended))
        o.run('begin')
        try:
            o.run('call public.grade_return_repair_nightly()'); inside = None
        except pg.DatabaseError as e:
            inside = e.args[0].get('M')
        o.run('rollback')
        ok('it commits class by class, so it cannot be run inside another transaction', inside is not None and 'transaction' in inside, inside)

        # A class it cannot get: it goes on to the next, and says so afterwards.
        o.run("insert into course (id, teacher_id, name) values (:c, :t, 'Third class')", c=THIRD, t=A)
        ids = sorted(str(r[0]) for r in o.run('select id from course'))
        o.run("set session_replication_role = replica")
        for cid in ids:
            e = o.run('select id from enrollment where course_id = :c limit 1', c=cid)
            if not e:
                s = o.run("insert into student (teacher_id, first_name) values (:t, 'Nightly check') returning id", t=A)[0][0]
                e = o.run('insert into enrollment (student_id, course_id) values (:s, :c) returning id', s=s, c=cid)
            o.run('insert into grade_return (enrollment_id, assessment_id, is_draft) values (:e, gen_random_uuid(), true)', e=e[0][0])   # an orphan in each class
        o.run("set session_replication_role = origin")
        def orphans_by_class():
            return [o.run("""select count(*) from grade_return g join enrollment e on e.id = g.enrollment_id
                              where e.course_id = :c and not exists (select 1 from assessment a where a.id = g.assessment_id)""", c=cid)[0][0] for cid in ids]
        before = orphans_by_class()
        o.run('insert into course_sync_cursor (course_id) values (:c) on conflict do nothing', c=ids[1])
        h.run('begin'); h.run('select 1 from course_sync_cursor where course_id = :c for update', c=ids[1])    # someone holds the second class
        n.run("set lock_timeout = '400ms'")
        try:
            n.run('call public.grade_return_repair_nightly()'); said = None
        except pg.DatabaseError as e:
            said = e.args[0].get('M')
        after = orphans_by_class()
        log = [[str(r[0]), r[1]] for r in o.run('select course_id, sqlstate from public.grade_return_repair_log order by id')]
        ok('with the second of three classes locked by someone else, the procedure repairs the first and the third and skips only the second',
           len(ids) == 3 and before == [1, 1, 1] and after == [0, 1, 0], (before, after))
        ok('it ends with an error that says one part failed, and the log names the class and the error', said is not None and '1 part(s)' in said
           and log == [[ids[1], '55P03']], (said, log))
        h.run('rollback'); n.run('set lock_timeout = 0')
        n.run('call public.grade_return_repair_nightly()')
        ok('the next run, with the class free, repairs it', orphans_by_class() == [0, 0, 0])

        # A class hard-deleted as the repair reaches it.
        o.run("insert into course (id, teacher_id, name) values (:c, :t, 'Going')", c=GOING, t=A)
        o.run('delete from course_sync_cursor where course_id = :c', c=GOING)
        h.run('begin'); h.run('delete from course where id = :c', c=GOING)                                   # not committed yet
        out = {}
        def reach():
            try: out['r'] = n.run('select public._grade_return_repair_class(:c)', c=GOING)[0][0]
            except pg.DatabaseError as e: out['r'] = 'DIED: %s %s' % (e.args[0].get('C'), e.args[0].get('M'))
        th = threading.Thread(target=reach); th.start(); time.sleep(0.4)
        waiting = o.run("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%_grade_return_repair_class%' and pid <> pg_backend_pid()")[0][0]
        h.run('commit'); th.join()
        ok('a class deleted while the repair waits to lock it is nothing to do, not an error', waiting == 1 and out['r'] == NOTHING, (waiting, out))
        ok('no class is left locked when it ends', o.run("select count(*) from pg_locks where locktype = 'transactionid' and pid <> pg_backend_pid() and not granted")[0][0] == 0)
    finally:
        for x in (h, n):
            try: x.run('rollback')
            except Exception: pass
        o.run("set session_replication_role = origin")
        o.run('delete from assessment where id = any (:ids::uuid[])', ids='{%s,%s}' % (a1, a2))
        o.run('delete from course where id = any (:ids::uuid[])', ids='{%s,%s}' % (THIRD, GOING))
        o.run("delete from student where first_name = 'Nightly check'")
        o.run('delete from grade_return g where not exists (select 1 from assessment a where a.id = g.assessment_id) or not exists (select 1 from enrollment e where e.id = g.enrollment_id)')
        o.run('delete from public.grade_return_repair_log')
        ok('(cleaned up: no row of the nightly check is left)', o.run('select count(*) from grade_return')[0][0] == 0 and o.run('select count(*) from score')[0][0] == 0
           and o.run('select count(*) from course')[0][0] == 2)
        for x in (o, h, n): x.close()
else:
    print('NOTE the nightly procedure commits, so it is checked only on a database that has 2026110905 loaded')

print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
