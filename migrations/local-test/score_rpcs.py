"""Pin what the score RPCs do today (plan S0-P1, the SQL half), before
Draft and Returned (Batch A) puts triggers under them: upsert_score,
upsert_tag_score, upsert_rubric_score, fill_rubric, set_rubric_check,
save_score_comment, save_score_report_note, set_score_status, clear_score,
clear_row_scores, clear_column_scores and move_rubric_scores, as Teacher A,
then as Teacher B, with no JWT and as anon. Rows are read back as the
database owner. One transaction, rolled back at the end.

"today:" in a check's name marks a gap this pins as it is, not as it should
be. Batch A closes one of them: a score row that names another class's
records (migrations/2026110901_score_rows_same_class.sql). Missing on
scored work and a criterion that is not on the assessment's rubric stay
accepted: Batch A changes no score RPC but move_rubric_scores.

The script runs against either database and says which it found: before
Batch A the cross-class rows are pinned as "today: accepted"; with Batch A
loaded they are "refused", and a section at the end tries every way in.

PGPORT=54329 PGDATABASE=fv_score python3 run.py harness.sql score-prelude.sql score-tables.sql
PGPORT=54329 PGDATABASE=fv_score python3 score_rpcs.py      # today
PGPORT=54329 PGDATABASE=fv_a python3 score_rpcs.py          # with Batch A (README.md, "Batch A")
"""
import os, re, sys, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
ENR_B = 'eeeeeeee-2222-0000-0000-000000000001'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:400]))

c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))

# ── The harness's tables are production's ──────────────────────────────
# scripts/schema-snapshot.sql is what CI runs against gradebook-prod to keep
# docs/schema.generated.sql true. Run here, it must print the same lines for
# every table score-tables.sql makes, and every function loaded must have a
# live twin with the same arguments, result and SECURITY DEFINER mark.
HERE = os.path.dirname(os.path.abspath(__file__))
def snapshot_blocks(text):
    out, cur = {'functions': []}, None
    for line in text.splitlines():
        if line.startswith('table '): cur = line.split(' ')[1]; out[cur] = [line]
        elif line.startswith('function '): cur = None; out['functions'].append(line)
        elif cur: out[cur].append(line)
    return out
# Postgres 18 lists NOT NULL as constraints and prints one nested AND flat;
# 17 (production) does neither. Neither changes what a table accepts.
def same_shape(lines):
    if BATCH_A:
        # Batch A replaces the score tables' policies and adds its triggers;
        # the snapshot changes when it is applied. Compare the rest.
        cut = next((n for n, l in enumerate(lines) if l.startswith('  policy ')), len(lines))
        lines = [l for l in lines[:cut] if 'grade_return_' not in l]
    return [re.sub(r'[()]', '', l) for l in lines if not re.match(r'  constraint \S+ NOT NULL ', l)]
BATCH_A = c.run("select to_regclass('public.grade_return') is not null")[0][0]
PATCHED = ['move_rubric_scores'] if BATCH_A else []
ok('running against a database %s Batch A' % ('with' if BATCH_A else 'without'), True)
c.run("set search_path = ''")
local = snapshot_blocks(c.run(open(os.path.join(HERE, '..', '..', 'scripts', 'schema-snapshot.sql')).read())[0][0])
c.run('reset search_path')
live = snapshot_blocks(open(os.path.join(HERE, '..', '..', 'docs', 'schema.generated.sql')).read())
SCORE_TABLES = ['course_sync_cursor', 'subject', 'competency_group', 'section', 'tag', 'category', 'module',
                'rubric', 'criterion', 'criterion_check', 'criterion_tag', 'rubric_tag', 'assessment',
                'assessment_tag', 'score', 'score_audit', 'tag_score', 'rubric_score', 'rubric_check_score']
differ = [t for t in SCORE_TABLES if same_shape(local.get('public.' + t, [])) != same_shape(live['public.' + t])]
ok('every score table matches the live snapshot: columns, constraints, indexes, triggers, policies', not differ, differ)
live_names = {f.split('(')[0] for f in live['functions']}
strangers = [f for f in local['functions'] if f not in set(live['functions']) and (not BATCH_A or f.split('(')[0] in live_names)]
ok('every function loaded has the live signature and security', not strangers, strangers)
RPCS = ['upsert_score', 'upsert_tag_score', 'upsert_rubric_score', 'fill_rubric', 'set_rubric_check',
        'save_score_comment', 'save_score_report_note', 'set_score_status', 'clear_score',
        'clear_row_scores', 'clear_column_scores', 'move_rubric_scores']
ok('all twelve score RPCs are loaded, one version each',
   all(sum(1 for f in local['functions'] if f.startswith('function public.' + r + '(')) == 1 for r in RPCS))
ok('none of them is SECURITY DEFINER: row security is their ownership check',
   not [f for f in local['functions'] if f.split('(')[0].split('.')[-1] in RPCS and 'security definer' in f])

# ── Every function is the live one, byte for byte ──────────────────────
# live-function-md5.txt holds md5(pg_get_functiondef) for 21 live functions.
# Postgres 18 prints these headers as 17 does, so the whole definition is
# compared, not only the body.
want = {}
for line in open(os.path.join(HERE, 'live-function-md5.txt')):
    if line.strip() and not line.startswith('#') and len(line.split()) == 3:   # a fourth word: grade_return_race.py's
        name, md5, _length = line.split(); want[name] = md5
got = {r[0]: r[1] for r in c.run("""select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p
                                     join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'""")}
for name in sorted(n for n in want if n in got and n not in PATCHED
                   and not (BATCH_A and n in ('update_course', 'import_json_restore', 'duplicate_course'))):
    ok('%s is the live function, byte for byte' % name, got[name] == want[name], got[name])
for name in PATCHED:
    ok('%s carries Batch A\'s patch (batch_a_apply.py shows it started as the live body)' % name, got[name] != want[name])
ok('all twelve score RPCs and the three ownership helpers were compared',
   all(n in want and n in got for n in RPCS + ['fv_owns_course', 'fv_owns_enrollment', 'fv_owns_assessment']))

c.run('begin')
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
def one(sql, **kw):
    as_owner(); r = c.run(sql, **kw); return r[0][0] if r else None
def rows(sql, **kw):
    as_owner(); return [list(r) for r in c.run(sql, **kw)]
def rpc(uid, sql, **kw):
    as_teacher(uid); r = c.run('select ' + sql, **kw); r = r[0][0] if r else None
    return str(r) if isinstance(r, uuid.UUID) else r
def num(v): return None if v is None else float(v)

# ── A class to score: competencies, two rubrics, four kinds of assessment ──
as_owner()
ids = {k: str(uuid.uuid4()) for k in (
    'subj', 'sect', 't1', 't2', 'r1', 'c1', 'c2', 'k1', 'k2', 'r2', 'cx', 'kx',
    'prof', 'pts', 'done', 'rub', 'plain',
    'b_subj', 'b_sect', 'b_tag', 'b_rub', 'b_crit', 'b_asm')}
c.run("insert into subject (id, course_id, name) values (:s, :c, 'Science'), (:bs, :cb, 'Socials')",
      s=ids['subj'], c=COURSE_A, bs=ids['b_subj'], cb=COURSE_B)
c.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Questioning'), (:bx, :cb, :bs, 'Inquiry')",
      x=ids['sect'], c=COURSE_A, s=ids['subj'], bx=ids['b_sect'], cb=COURSE_B, bs=ids['b_subj'])
c.run("insert into tag (id, section_id, label) values (:t1, :x, 'Ask questions'), (:t2, :x, 'Plan a fair test'), (:bt, :bx, 'Use evidence')",
      t1=ids['t1'], t2=ids['t2'], x=ids['sect'], bt=ids['b_tag'], bx=ids['b_sect'])
c.run("insert into rubric (id, course_id, name, style) values (:r1, :c, 'Lab Report', 'advanced'), (:r2, :c, 'Poster', 'advanced'), (:rb, :cb, 'Essay', 'standard')",
      r1=ids['r1'], r2=ids['r2'], c=COURSE_A, rb=ids['b_rub'], cb=COURSE_B)
c.run("insert into criterion (id, rubric_id, name, display_order) values (:c1, :r1, 'Method', 0), (:c2, :r1, 'Conclusion', 1), (:cx, :r2, 'Layout', 0), (:bc, :rb, 'Thesis', 0)",
      c1=ids['c1'], c2=ids['c2'], r1=ids['r1'], cx=ids['cx'], r2=ids['r2'], bc=ids['b_crit'], rb=ids['b_rub'])
c.run("insert into criterion_check (id, criterion_id, level, label) values (:k1, :c1, 3, 'Lists every step'), (:k2, :c2, 3, 'Answers the question'), (:kx, :cx, 3, 'Has a title')",
      k1=ids['k1'], c1=ids['c1'], k2=ids['k2'], c2=ids['c2'], kx=ids['kx'], cx=ids['cx'])
c.run("""insert into assessment (id, course_id, title, score_mode, max_points, rubric_id) values
         (:prof, :c, 'Density Lab', 'proficiency', null, null),
         (:pts, :c, 'Quiz 1', 'points', 10, null),
         (:done, :c, 'Safety Contract', 'complete', null, null),
         (:rub, :c, 'Lab Report', 'proficiency', null, :r1),
         (:plain, :c, 'Exit Slip', 'proficiency', null, null),
         (:basm, :cb, 'Essay', 'proficiency', null, null)""",
      prof=ids['prof'], pts=ids['pts'], done=ids['done'], rub=ids['rub'], plain=ids['plain'],
      r1=ids['r1'], c=COURSE_A, basm=ids['b_asm'], cb=COURSE_B)
c.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :t1), (:a, :t2)', a=ids['prof'], t1=ids['t1'], t2=ids['t2'])
PROF, PTS, DONE, RUB, PLAIN = ids['prof'], ids['pts'], ids['done'], ids['rub'], ids['plain']
T1, T2, C1, C2, CX, K1, K2, KX = (ids[k] for k in ('t1', 't2', 'c1', 'c2', 'cx', 'k1', 'k2', 'kx'))

def score_row(e, a):
    r = rows('select value, modifier, status, comment, report_note from score where enrollment_id = :e and assessment_id = :a', e=e, a=a)
    return None if not r else [num(r[0][0])] + r[0][1:]
def tag_row(e, a, t):
    r = rows('select value, modifier, comment from tag_score where enrollment_id = :e and assessment_id = :a and tag_id = :t', e=e, a=a, t=t)
    return r[0] if r else None
def crit_row(e, a, x):
    r = rows('select value, modifier, comment, beyond from rubric_score where enrollment_id = :e and assessment_id = :a and criterion_id = :x', e=e, a=a, x=x)
    return r[0] if r else None
def ticks(e, a):
    return sorted(r[0] for r in rows('select check_id::text from rubric_check_score where enrollment_id = :e and assessment_id = :a', e=e, a=a))
def audit(score_id):
    # In written order: changed_at is the same for every row of one transaction.
    return [[num(r[0]), num(r[1]), r[2], r[3]] for r in rows(
        'select old_value, new_value, old_status, new_status from score_audit where score_id = :s order by ctid', s=score_id)]
def audits(e, a):
    return one('select count(*) from score_audit sa join score s on s.id = sa.score_id where s.enrollment_id = :e and s.assessment_id = :a', e=e, a=a)
def version(): return one('select coalesce((select version from course_sync_cursor where course_id = :c), 0)', c=COURSE_A)
def everything():
    """A fingerprint of every score row in both classes."""
    return one("""select md5(coalesce((select string_agg(x::text, '|' order by x::text) from score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from tag_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_check_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from score_audit x), ''))""")

# ── upsert_score ───────────────────────────────────────────────────────
v0 = version()
sid = rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=PTS)
ok('upsert_score makes the row and returns its id', sid == one('select id::text from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=PTS), sid)
ok('a new score: the value, modifier 0, no status, comment or note', score_row(ENR1, PTS) == [7.0, 0, None, None, None], score_row(ENR1, PTS))
ok('the first value is audited as nothing to 7', audit(sid) == [[None, 7.0, None, None]], audit(sid))
ok("a score write moves the class's version", version() > v0, (v0, version()))
sid2 = rpc(A, 'upsert_score(:e, :a, 9)', e=ENR1, a=PTS)
ok('a second upsert_score overwrites the same row', sid2 == sid and score_row(ENR1, PTS)[0] == 9.0
   and one('select count(*) from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=PTS) == 1, score_row(ENR1, PTS))
ok('the change is audited as 7 to 9', audit(sid)[-1] == [7.0, 9.0, None, None], audit(sid))
rpc(A, 'upsert_score(:e, :a, 9)', e=ENR1, a=PTS)
ok('the same value again writes no audit row', len(audit(sid)) == 2, audit(sid))
rpc(A, 'upsert_score(:e, :a, 3, 1::smallint)', e=ENR1, a=PLAIN)
ok('upsert_score takes + and -', score_row(ENR1, PLAIN)[:2] == [3.0, 1], score_row(ENR1, PLAIN))
n = audits(ENR1, PLAIN)
rpc(A, 'upsert_score(:e, :a, 3, (-1)::smallint)', e=ENR1, a=PLAIN)
ok('a change to + or - alone is saved, with no audit row', score_row(ENR1, PLAIN)[:2] == [3.0, -1] and audits(ENR1, PLAIN) == n, score_row(ENR1, PLAIN))
rpc(A, 'upsert_score(:e, :a, 3)', e=ENR1, a=PLAIN)
ok('upsert_score with no modifier resets it to 0', score_row(ENR1, PLAIN)[:2] == [3.0, 0], score_row(ENR1, PLAIN))
expect_error('a modifier outside -1..1 is refused by the table', lambda: rpc(A, 'upsert_score(:e, :a, 3, 2::smallint)', e=ENR1, a=PLAIN), '23514')
rpc(A, 'upsert_score(:e, :a, null)', e=ENR1, a=PLAIN)
ok('upsert_score with a null value leaves the row with no value', score_row(ENR1, PLAIN) == [None, 0, None, None, None], score_row(ENR1, PLAIN))
rpc(A, 'upsert_score(:e, :a, 250)', e=ENR2, a=PTS)
ok('today: points over the assessment\'s maximum are accepted', score_row(ENR2, PTS)[0] == 250.0, score_row(ENR2, PTS))
if BATCH_A:
    expect_error("refused: a score for Teacher A's student on Teacher B's assessment",
                 lambda: rpc(A, 'upsert_score(:e, :a, 4)', e=ENR2, a=ids['b_asm']), 'row-level security')
else:
    rpc(A, 'upsert_score(:e, :a, 4)', e=ENR2, a=ids['b_asm'])
    ok("today: a score for Teacher A's student on Teacher B's assessment is accepted (row security checks the enrollment only)",
       score_row(ENR2, ids['b_asm']) == [4.0, 0, None, None, None], score_row(ENR2, ids['b_asm']))
    as_owner(); c.run('delete from score where assessment_id = :a', a=ids['b_asm'])

# ── upsert_tag_score ───────────────────────────────────────────────────
tid = rpc(A, "upsert_tag_score(:e, :a, :t, 3, 1::smallint, 'Clear question')", e=ENR1, a=PROF, t=T1)
ok('upsert_tag_score makes the row: level, +, comment', tag_row(ENR1, PROF, T1) == [3, 1, 'Clear question'] and tid is not None, tag_row(ENR1, PROF, T1))
ok('a competency level makes no score row', score_row(ENR1, PROF) is None, score_row(ENR1, PROF))
tid2 = rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR1, a=PROF, t=T1)
ok('a second upsert_tag_score overwrites the row; a null comment keeps the saved one; the modifier resets',
   tid2 == tid and tag_row(ENR1, PROF, T1) == [2, 0, 'Clear question'], tag_row(ENR1, PROF, T1))
rpc(A, "upsert_tag_score(:e, :a, :t, 2, 0::smallint, '')", e=ENR1, a=PROF, t=T1)
ok("an empty comment clears it", tag_row(ENR1, PROF, T1) == [2, 0, None], tag_row(ENR1, PROF, T1))
rpc(A, "upsert_tag_score(:e, :a, :t, 2, 0::smallint, 'Try a testable one')", e=ENR1, a=PROF, t=T1)
r = rpc(A, 'upsert_tag_score(:e, :a, :t, 0)', e=ENR1, a=PROF, t=T1)
ok('level 0 keeps the row for its comment, with no level', tag_row(ENR1, PROF, T1) == [None, 0, 'Try a testable one'] and r == tid, tag_row(ENR1, PROF, T1))
r = rpc(A, "upsert_tag_score(:e, :a, :t, null, 0::smallint, '')", e=ENR1, a=PROF, t=T1)
ok('no level and no comment deletes the row and returns null', tag_row(ENR1, PROF, T1) is None and r is None, (tag_row(ENR1, PROF, T1), r))
expect_error('a level above 4 is refused by the table', lambda: rpc(A, 'upsert_tag_score(:e, :a, :t, 5)', e=ENR1, a=PROF, t=T1), '23514')
expect_error('4+ is refused by the table', lambda: rpc(A, 'upsert_tag_score(:e, :a, :t, 4, 1::smallint)', e=ENR1, a=PROF, t=T1), '23514')
expect_error('1- is refused by the table', lambda: rpc(A, 'upsert_tag_score(:e, :a, :t, 1, (-1)::smallint)', e=ENR1, a=PROF, t=T1), '23514')
expect_error('upsert_tag_score is refused on a rubric assessment', lambda: rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=RUB, t=T1), 'not used for rubric')
r = rpc(A, 'upsert_tag_score(:e, :a, :t, 6, 1::smallint)', e=ENR1, a=PTS, t=T1)
ok('on points work upsert_tag_score writes score.value, drops the modifier and returns the score id',
   r == sid and score_row(ENR1, PTS)[:2] == [6.0, 0] and tag_row(ENR1, PTS, T1) is None, (r, score_row(ENR1, PTS)))
r = rpc(A, 'upsert_tag_score(:e, :a, :t, 1)', e=ENR1, a=DONE, t=T1)
ok('on Complete/Incomplete work it writes score.value too', score_row(ENR1, DONE)[0] == 1.0 and tag_row(ENR1, DONE, T1) is None, score_row(ENR1, DONE))
rpc(A, 'upsert_tag_score(:e, :a, :t, 0)', e=ENR1, a=DONE, t=T1)
ok('Incomplete is a stored 0, not a cleared score', score_row(ENR1, DONE)[0] == 0.0, score_row(ENR1, DONE))
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR2, a=PLAIN, t=T1)
ok('today: a competency the assessment is not linked to is accepted', tag_row(ENR2, PLAIN, T1) == [3, 0, None], tag_row(ENR2, PLAIN, T1))
if BATCH_A:
    expect_error("refused: Teacher B's competency on Teacher A's student",
                 lambda: rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR2, a=PLAIN, t=ids['b_tag']), 'row-level security')
else:
    rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR2, a=PLAIN, t=ids['b_tag'])
    ok("today: Teacher B's competency on Teacher A's student is accepted", tag_row(ENR2, PLAIN, ids['b_tag']) == [3, 0, None], tag_row(ENR2, PLAIN, ids['b_tag']))
as_owner(); c.run('delete from tag_score where enrollment_id = :e and assessment_id = :a', e=ENR2, a=PLAIN)

# ── upsert_rubric_score ────────────────────────────────────────────────
rid = rpc(A, "upsert_rubric_score(:e, :a, :x, 3, (-1)::smallint, 'Number the steps', 'Drew the set-up')", e=ENR1, a=RUB, x=C1)
ok('upsert_rubric_score makes the row: level, -, Work On, Went Beyond',
   crit_row(ENR1, RUB, C1) == [3, -1, 'Number the steps', 'Drew the set-up'] and rid is not None, crit_row(ENR1, RUB, C1))
ok('a criterion level makes no score row', score_row(ENR1, RUB) is None, score_row(ENR1, RUB))
rid2 = rpc(A, 'upsert_rubric_score(:e, :a, :x, 4)', e=ENR1, a=RUB, x=C1)
ok('a second upsert_rubric_score overwrites the row; null notes keep the saved ones; the modifier resets',
   rid2 == rid and crit_row(ENR1, RUB, C1) == [4, 0, 'Number the steps', 'Drew the set-up'], crit_row(ENR1, RUB, C1))
rpc(A, "upsert_rubric_score(:e, :a, :x, 4, 0::smallint, '', null)", e=ENR1, a=RUB, x=C1)
ok('an empty Work On clears it and leaves Went Beyond', crit_row(ENR1, RUB, C1) == [4, 0, None, 'Drew the set-up'], crit_row(ENR1, RUB, C1))
r = rpc(A, 'upsert_rubric_score(:e, :a, :x, null)', e=ENR1, a=RUB, x=C1)
ok('no level keeps the row while a note remains', r == rid and crit_row(ENR1, RUB, C1) == [None, 0, None, 'Drew the set-up'], crit_row(ENR1, RUB, C1))
r = rpc(A, "upsert_rubric_score(:e, :a, :x, 0, 0::smallint, null, '')", e=ENR1, a=RUB, x=C1)
ok('no level and no notes deletes the row and returns null', r is None and crit_row(ENR1, RUB, C1) is None, (r, crit_row(ENR1, RUB, C1)))
expect_error('a criterion level above 4 is refused by the table', lambda: rpc(A, 'upsert_rubric_score(:e, :a, :x, 5)', e=ENR1, a=RUB, x=C1), '23514')
# GAP 1, still open with Batch A: the criterion is not checked against the
# work's rubric. upsert_rubric_score is left exactly as live, because the
# outbox can send a score ahead of the update_assessment that changes the
# rubric; the check waits for the client to send the rubric change first.
rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR2, a=RUB, x=CX)
ok("today: accepted: a criterion that is not on the assessment's rubric", crit_row(ENR2, RUB, CX) == [3, 0, None, None], crit_row(ENR2, RUB, CX))
rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR2, a=PLAIN, x=C1)
ok('today: accepted: a criterion on an assessment with no rubric', crit_row(ENR2, PLAIN, C1) == [2, 0, None, None], crit_row(ENR2, PLAIN, C1))
if BATCH_A:
    expect_error("refused: Teacher B's criterion on Teacher A's student (a score row belongs to one class)",
                 lambda: rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR2, a=RUB, x=ids['b_crit']), 'row-level security')
else:
    rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR2, a=RUB, x=ids['b_crit'])
    ok("today: accepted: Teacher B's criterion on Teacher A's student", crit_row(ENR2, RUB, ids['b_crit']) == [2, 0, None, None], crit_row(ENR2, RUB, ids['b_crit']))
as_owner(); c.run('delete from rubric_score where enrollment_id = :e', e=ENR2)

# ── fill_rubric ────────────────────────────────────────────────────────
n = rpc(A, 'fill_rubric(:e, :a, 3, 1::smallint)', e=ENR2, a=RUB)
ok("fill_rubric sets every criterion on the assessment's rubric and returns how many",
   n == 2 and crit_row(ENR2, RUB, C1) == [3, 1, None, None] and crit_row(ENR2, RUB, C2) == [3, 1, None, None] and crit_row(ENR2, RUB, CX) is None, n)
rpc(A, "upsert_rubric_score(:e, :a, :x, 2, 0::smallint, 'Say what it shows')", e=ENR2, a=RUB, x=C2)
rpc(A, 'fill_rubric(:e, :a, 4)', e=ENR2, a=RUB)
ok('fill_rubric overwrites levels already there and keeps their notes', crit_row(ENR2, RUB, C2) == [4, 0, 'Say what it shows', None], crit_row(ENR2, RUB, C2))
expect_error('fill_rubric is refused on an assessment with no rubric', lambda: rpc(A, 'fill_rubric(:e, :a, 3)', e=ENR2, a=PLAIN), 'has no rubric')

# ── set_rubric_check ───────────────────────────────────────────────────
r = rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=K1)
ok('set_rubric_check ticks a checkbox', r is True and ticks(ENR1, RUB) == [K1], ticks(ENR1, RUB))
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=K1)
ok('ticking it again changes nothing', ticks(ENR1, RUB) == [K1], ticks(ENR1, RUB))
r = rpc(A, 'set_rubric_check(:e, :a, :k, false)', e=ENR1, a=RUB, k=K1)
ok('unticking deletes the row', r is False and ticks(ENR1, RUB) == [], ticks(ENR1, RUB))
r = rpc(A, 'set_rubric_check(:e, :a, :k, null)', e=ENR1, a=RUB, k=K1)
ok('a null tick is an untick', r is False and ticks(ENR1, RUB) == [], ticks(ENR1, RUB))
expect_error("a checkbox that is not on the assessment's rubric is refused", lambda: rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=KX), 'is not in the rubric')
expect_error('a checkbox on an assessment with no rubric is refused', lambda: rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=PLAIN, k=K1), 'is not in the rubric')

# ── save_score_comment ─────────────────────────────────────────────────
cid = rpc(A, "save_score_comment(:e, :a, 'Good start')", e=ENR2, a=PROF)
ok('save_score_comment makes a score row with no value', score_row(ENR2, PROF) == [None, 0, None, 'Good start', None] and cid is not None, score_row(ENR2, PROF))
ok('a comment is not audited', audit(cid) == [], audit(cid))
rpc(A, "save_score_comment(:e, :a, 'Careful work')", e=ENR1, a=PTS)
ok('save_score_comment on a scored row leaves the value', score_row(ENR1, PTS) == [6.0, 0, None, 'Careful work', None], score_row(ENR1, PTS))
rpc(A, "save_score_comment(:e, :a, '')", e=ENR1, a=PTS)
ok("today: an empty comment is stored as '', not null", score_row(ENR1, PTS)[3] == '', score_row(ENR1, PTS))
rpc(A, 'save_score_comment(:e, :a, null)', e=ENR1, a=PTS)
ok('a null comment clears it', score_row(ENR1, PTS)[3] is None, score_row(ENR1, PTS))

# ── save_score_report_note ─────────────────────────────────────────────
k1 = key()
nid = rpc(A, "save_score_report_note(:e, :a, '  linked the poster to the Act  ', :k)", e=ENR2, a=PTS, k=k1)
ok('save_score_report_note sets the note, trimmed, and leaves the value', score_row(ENR2, PTS) == [250.0, 0, None, None, 'linked the poster to the Act'], score_row(ENR2, PTS))
as_owner(); c.run("update score set report_note = 'changed since' where id = :i", i=nid)
r = rpc(A, "save_score_report_note(:e, :a, 'a retry of the first call', :k)", e=ENR2, a=PTS, k=k1)
ok('a replay with the same key returns the first id and writes nothing', r == nid and score_row(ENR2, PTS)[4] == 'changed since', score_row(ENR2, PTS))
rpc(A, "save_score_report_note(:e, :a, '   ', :k)", e=ENR2, a=PTS, k=key())
ok('a blank note is stored as null and the row stays', score_row(ENR2, PTS) == [250.0, 0, None, None, None], score_row(ENR2, PTS))
nid2 = rpc(A, "save_score_report_note(:e, :a, 'explained her method', :k)", e=ENR2, a=DONE, k=key())
ok('save_score_report_note makes a score row when there is none', score_row(ENR2, DONE) == [None, 0, None, None, 'explained her method'] and nid2 is not None, score_row(ENR2, DONE))
expect_error('a note over 300 characters is refused', lambda: rpc(A, 'save_score_report_note(:e, :a, :n, :k)', e=ENR2, a=DONE, n='x' * 301, k=key()), '300 characters')

# ── set_score_status ───────────────────────────────────────────────────
st = rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=PLAIN)
ok('set_score_status makes a score row with no value, marked Missing', score_row(ENR2, PLAIN) == [None, 0, 'NS', None, None] and st is not None, score_row(ENR2, PLAIN))
ok('the status is audited', audit(st) == [[None, None, None, 'NS']], audit(st))
rpc(A, "set_score_status(:e, :a, 'EXC')", e=ENR2, a=PLAIN)
ok('Excused replaces Missing on the same row', score_row(ENR2, PLAIN)[2] == 'EXC' and audit(st)[-1] == [None, None, 'NS', 'EXC'], audit(st))
rpc(A, "set_score_status(:e, :a, 'LATE')", e=ENR1, a=PTS)
ok('Late on scored work keeps the score', score_row(ENR1, PTS)[:3] == [6.0, 0, 'LATE'], score_row(ENR1, PTS))
rpc(A, 'set_score_status(:e, :a, null)', e=ENR2, a=PLAIN)
ok('a null status clears it; today the empty row stays behind', score_row(ENR2, PLAIN) == [None, 0, None, None, None], score_row(ENR2, PLAIN))
expect_error('a status that is not NS, EXC or LATE is refused', lambda: rpc(A, "set_score_status(:e, :a, 'missing')", e=ENR2, a=PLAIN), 'invalid status')
# GAP 2, still open with Batch A: Missing on work that has a score. The
# shipped app sends it on cells the server still holds a score for.
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=PTS)
ok('today: accepted: Missing on work that has points', score_row(ENR2, PTS)[:3] == [250.0, 0, 'NS'], score_row(ENR2, PTS))
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR2, a=PROF, t=T2)
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=PROF)
ok('today: accepted: Missing on work that has a competency level', score_row(ENR2, PROF)[2] == 'NS' and tag_row(ENR2, PROF, T2) == [3, 0, None], score_row(ENR2, PROF))
rpc(A, "set_score_status(:e, :a, 'NS')", e=ENR2, a=RUB)
ok('today: accepted: Missing on work that has criterion levels', score_row(ENR2, RUB)[2] == 'NS' and crit_row(ENR2, RUB, C1)[0] == 4, score_row(ENR2, RUB))
rpc(A, 'upsert_score(:e, :a, 5)', e=ENR2, a=PLAIN)
rpc(A, "set_score_status(:e, :a, 'EXC')", e=ENR2, a=PLAIN)
rpc(A, 'upsert_score(:e, :a, 8)', e=ENR2, a=PLAIN)
ok('today: accepted: a score on Excused work, and Excused on scored work', score_row(ENR2, PLAIN)[:3] == [8.0, 0, 'EXC'], score_row(ENR2, PLAIN))

# ── clear_score ────────────────────────────────────────────────────────
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=PROF, t=T1)
rpc(A, 'upsert_tag_score(:e, :a, :t, 2)', e=ENR1, a=PROF, t=T2)
rpc(A, 'upsert_score(:e, :a, 3)', e=ENR1, a=PROF)
rpc(A, 'clear_score(:e, :a)', e=ENR1, a=PROF)
ok('clear_score deletes a score row with nothing else on it, and the competency levels',
   score_row(ENR1, PROF) is None and tag_row(ENR1, PROF, T1) is None and tag_row(ENR1, PROF, T2) is None, score_row(ENR1, PROF))
rpc(A, 'clear_score(:e, :a)', e=ENR1, a=PROF)
ok('clear_score on an empty cell does nothing', score_row(ENR1, PROF) is None)
rpc(A, "save_score_comment(:e, :a, 'See me')", e=ENR1, a=PLAIN)
rpc(A, 'upsert_score(:e, :a, 2, 1::smallint)', e=ENR1, a=PLAIN)
rpc(A, 'clear_score(:e, :a)', e=ENR1, a=PLAIN)
ok('clear_score keeps a row that has an Overall Comment: value null, modifier 0', score_row(ENR1, PLAIN) == [None, 0, None, 'See me', None], score_row(ENR1, PLAIN))
rpc(A, 'clear_score(:e, :a)', e=ENR1, a=PTS)
ok('clear_score keeps a row that has a status: the mark stays', score_row(ENR1, PTS) == [None, 0, 'LATE', None, None], score_row(ENR1, PTS))
ok('clearing is audited as the value going to nothing, status unchanged', audit(sid)[-1] == [6.0, None, 'LATE', 'LATE'], audit(sid)[-3:])
rpc(A, 'clear_score(:e, :a)', e=ENR2, a=DONE)
ok('clear_score keeps a row that has a Note for the Report', score_row(ENR2, DONE) == [None, 0, None, None, 'explained her method'], score_row(ENR2, DONE))
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR2, a=RUB, k=K1)
rpc(A, 'clear_score(:e, :a)', e=ENR2, a=RUB)
ok('clear_score removes the criterion levels with their notes', crit_row(ENR2, RUB, C1) is None and crit_row(ENR2, RUB, C2) is None)
ok('today: clear_score leaves ticked checkboxes behind', ticks(ENR2, RUB) == [K1], ticks(ENR2, RUB))
ok('and leaves the Missing mark', score_row(ENR2, RUB) == [None, 0, 'NS', None, None], score_row(ENR2, RUB))

# ── clear_row_scores and clear_column_scores ───────────────────────────
rpc(A, 'fill_rubric(:e, :a, 2)', e=ENR1, a=RUB)
rpc(A, 'fill_rubric(:e, :a, 3)', e=ENR2, a=RUB)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=K2)
rpc(A, "save_score_comment(:e, :a, 'Redo the conclusion')", e=ENR1, a=RUB)
rpc(A, 'upsert_tag_score(:e, :a, :t, 4)', e=ENR1, a=PROF, t=T1)
before_e2 = rows('select assessment_id::text, value, status from score where enrollment_id = :e order by 1', e=ENR2)
n = rpc(A, 'clear_row_scores(:e, :c)', e=ENR1, c=COURSE_A)
ok("clear_row_scores deletes one student's score rows, comments and statuses included, and returns how many",
   n == 4 and one('select count(*) from score where enrollment_id = :e', e=ENR1) == 0, n)
ok('and their competency and criterion levels', one('select (select count(*) from tag_score where enrollment_id = :e) + (select count(*) from rubric_score where enrollment_id = :e)', e=ENR1) == 0)
ok('today: clear_row_scores leaves ticked checkboxes behind', ticks(ENR1, RUB) == [K2], ticks(ENR1, RUB))
ok("another student's scores are untouched", rows('select assessment_id::text, value, status from score where enrollment_id = :e order by 1', e=ENR2) == before_e2)
n = rpc(A, 'clear_column_scores(:a)', a=RUB)
ok("clear_column_scores deletes one assessment's score rows and criterion levels and returns the score rows deleted",
   n == 1 and one('select (select count(*) from score where assessment_id = :a) + (select count(*) from rubric_score where assessment_id = :a)', a=RUB) == 0, n)
ok('today: clear_column_scores leaves ticked checkboxes behind', one('select count(*) from rubric_check_score where assessment_id = :a', a=RUB) == 2)
ok("other assessments' scores are untouched", score_row(ENR2, PTS)[:3] == [250.0, 0, 'NS'], score_row(ENR2, PTS))

# ── move_rubric_scores ─────────────────────────────────────────────────
# Edit a Copy: the assessment moves to a copy of its rubric, whose criteria
# and checkboxes have new ids.
as_owner()
cp = {k: str(uuid.uuid4()) for k in ('r', 'c1', 'c2', 'k1', 'k2')}
c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Lab Report (copy)', 'advanced')", r=cp['r'], c=COURSE_A)
c.run("insert into criterion (id, rubric_id, name) values (:c1, :r, 'Method'), (:c2, :r, 'Conclusion')", c1=cp['c1'], c2=cp['c2'], r=cp['r'])
c.run("insert into criterion_check (id, criterion_id, level, label) values (:k1, :c1, 3, 'Lists every step'), (:k2, :c2, 3, 'Answers the question')",
      k1=cp['k1'], c1=cp['c1'], k2=cp['k2'], c2=cp['c2'])
c.run('delete from rubric_check_score where assessment_id = :a', a=RUB)
rpc(A, "upsert_rubric_score(:e, :a, :x, 3, 1::smallint, 'Number the steps', 'Drew the set-up')", e=ENR1, a=RUB, x=C1)
rpc(A, 'upsert_rubric_score(:e, :a, :x, 2)', e=ENR1, a=RUB, x=C2)
rpc(A, 'upsert_rubric_score(:e, :a, :x, 4)', e=ENR2, a=RUB, x=C1)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=K1)
rpc(A, 'upsert_rubric_score(:e, :a, :x, 1)', e=ENR1, a=PLAIN, x=C1)   # another assessment's row on the old criterion
cmap = '{"%s": "%s", "%s": "%s"}' % (C1, cp['c1'], C2, cp['c2']); kmap = '{"%s": "%s"}' % (K1, cp['k1'])
mk = key()
expect_error("move_rubric_scores refuses a rubric from another class",
             lambda: rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=ids['b_rub'], m=cmap, k=kmap, key=key()), 'is not in the class')
expect_error('move_rubric_scores refuses a target criterion that is not on the copy',
             lambda: rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m='{"%s": "%s"}' % (C1, CX), k='{}', key=key()), 'target criterion is not on rubric')
expect_error('move_rubric_scores refuses a target checkbox that is not on the copy',
             lambda: rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m=cmap, k='{"%s": "%s"}' % (K1, KX), key=key()), 'target check is not on rubric')
count_before = one('select count(*) from rubric_score')
r = rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m=cmap, k=kmap, key=mk)
ok('move_rubric_scores reports the rows it moved', r == {'scores': 3, 'checks': 1}, r)
ok('each score keeps its level, + or -, and both notes on the new criterion',
   crit_row(ENR1, RUB, cp['c1']) == [3, 1, 'Number the steps', 'Drew the set-up'] and crit_row(ENR1, RUB, cp['c2']) == [2, 0, None, None]
   and crit_row(ENR2, RUB, cp['c1']) == [4, 0, None, None], crit_row(ENR1, RUB, cp['c1']))
ok('nothing is left on the old criteria and no row is added or lost',
   crit_row(ENR1, RUB, C1) is None and crit_row(ENR1, RUB, C2) is None and one('select count(*) from rubric_score') == count_before)
ok('the tick moves to the new checkbox', ticks(ENR1, RUB) == [cp['k1']], ticks(ENR1, RUB))
ok("another assessment's score on the old criterion stays", crit_row(ENR1, PLAIN, C1) == [1, 0, None, None], crit_row(ENR1, PLAIN, C1))
ok('today: move_rubric_scores does not change assessment.rubric_id (the client sends that itself)',
   one('select rubric_id::text from assessment where id = :a', a=RUB) == ids['r1'])
r2 = rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m=cmap, k=kmap, key=mk)
ok('a replay with the same key returns the first answer', r2 == r, r2)
r3 = rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m=cmap, k=kmap, key=key())
ok('a second run with a new key moves nothing', r3 == {'scores': 0, 'checks': 0}, r3)
rpc(A, 'upsert_rubric_score(:e, :a, :x, 1)', e=ENR1, a=RUB, x=C1)   # a late write to the old criterion
r4 = rpc(A, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m=cmap, k=kmap, key=key())
ok('a score already on the new criterion is kept; the stray on the old one stays where it is',
   r4['scores'] == 0 and crit_row(ENR1, RUB, cp['c1'])[0] == 3 and crit_row(ENR1, RUB, C1)[0] == 1, r4)

# ── Teacher B, no JWT, anon ────────────────────────────────────────────
as_owner()
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=PTS)
rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=PROF, t=T1)
rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=K2)
CALLS = [
    ('upsert_score', 'upsert_score(:e, :a, 1)', dict(e=ENR1, a=PTS)),
    ('upsert_score on an empty cell', 'upsert_score(:e, :a, 1)', dict(e=ENR1, a=DONE)),
    ('upsert_tag_score', 'upsert_tag_score(:e, :a, :t, 1)', dict(e=ENR1, a=PROF, t=T1)),
    ('upsert_rubric_score', 'upsert_rubric_score(:e, :a, :x, 1)', dict(e=ENR1, a=RUB, x=cp['c1'])),
    ('fill_rubric', 'fill_rubric(:e, :a, 1)', dict(e=ENR1, a=RUB)),
    ('set_rubric_check', 'set_rubric_check(:e, :a, :k, true)', dict(e=ENR1, a=RUB, k=K1)),
    ('set_rubric_check off', 'set_rubric_check(:e, :a, :k, false)', dict(e=ENR1, a=RUB, k=K2)),
    ('save_score_comment', "save_score_comment(:e, :a, 'not mine')", dict(e=ENR1, a=PTS)),
    ('save_score_report_note', "save_score_report_note(:e, :a, 'not mine', :k)", dict(e=ENR1, a=PTS, k=key())),
    ('set_score_status', "set_score_status(:e, :a, 'EXC')", dict(e=ENR1, a=PTS)),
    ('clear_score', 'clear_score(:e, :a)', dict(e=ENR1, a=PTS)),
    ('clear_row_scores', 'clear_row_scores(:e, :c)', dict(e=ENR1, c=COURSE_A)),
    ('clear_column_scores', 'clear_column_scores(:a)', dict(a=PTS)),
    ('move_rubric_scores', 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', dict(a=RUB, r=ids['r1'], m='{"%s": "%s"}' % (cp['c1'], C1), k='{}', key=key())),
]
fingerprint = everything()
for name, sql, kw in CALLS:
    sp()
    try:
        rpc(B, sql, **kw); how = 'no error, nothing changed'
    except Exception as e:
        back(); how = 'refused'
    ok("Teacher B's %s leaves Teacher A's scores as they were" % name, everything() == fingerprint, how)
    c.run('rollback to savepoint sp')
expect_error("Teacher B's upsert_score on Teacher A's student is refused by row security", lambda: rpc(B, 'upsert_score(:e, :a, 1)', e=ENR1, a=DONE), 'row-level security')
expect_error("Teacher B's move_rubric_scores on Teacher A's assessment is refused", lambda: rpc(B, 'move_rubric_scores(:a, :r, :m::jsonb, :k::jsonb, :key)', a=RUB, r=cp['r'], m=cmap, k=kmap, key=key()), '42501')
for name, sql, kw in CALLS:
    if ' on an empty cell' in name or name.endswith(' off'): continue
    expect_error('no JWT: %s is refused' % name, lambda: rpc(None, sql, **kw), 'not authenticated')
    def anon_call():
        as_role('anon'); c.run('select ' + sql, **kw)
    expect_error('anon cannot run %s' % name, anon_call, 'permission denied')
for t in ('score', 'tag_score', 'rubric_score', 'rubric_check_score', 'score_audit'):
    def anon_read():
        as_role('anon'); c.run('select * from ' + t)
    expect_error('anon cannot read %s' % t, anon_read, 'permission denied')
    as_teacher(B)
    ok("Teacher B reads none of Teacher A's %s rows" % t, c.run('select count(*) from ' + t)[0][0] == 0)
    as_teacher(A)
    ok('Teacher A reads their own %s rows' % t, c.run('select count(*) from ' + t)[0][0] > 0)
def b_insert():
    as_teacher(B); c.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 1)', e=ENR1, a=DONE)
expect_error("Teacher B cannot insert a score for Teacher A's student straight into the table", b_insert, 'row-level security')
as_teacher(B); c.run('update score set value = 0'); c.run('delete from tag_score'); c.run('delete from rubric_check_score')
ok("Teacher B's table-wide update and deletes touch nothing of Teacher A's", everything() == fingerprint)
def audit_write():
    as_teacher(A); c.run("insert into score_audit (score_id, new_value) values (:s, 1)", s=sid)
expect_error('a teacher cannot write the change history directly', audit_write, 'row-level security')
as_teacher(B); c.run('select _score_audit_diff(:s, 1, 2, null, null)', s=sid)
ok("Teacher B's call to the audit helper for Teacher A's score writes nothing", everything() == fingerprint)

# ── With Batch A: a score row belongs to one class ─────────────────────
if BATCH_A:
    as_owner()
    c2 = {k: str(uuid.uuid4()) for k in ('course', 'enr', 'subj', 'sect', 'tag', 'rub', 'crit', 'chk', 'asm')}
    c.run("insert into course (id, teacher_id, name) values (:c, :t, 'Socials 8')", c=c2['course'], t=A)
    c.run("insert into enrollment (id, student_id, course_id) values (:e, 'aaaaaaaa-1111-0000-0000-000000000001', :c)", e=c2['enr'], c=c2['course'])
    c.run("insert into subject (id, course_id, name) values (:s, :c, 'Socials')", s=c2['subj'], c=c2['course'])
    c.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Evidence')", x=c2['sect'], c=c2['course'], s=c2['subj'])
    c.run("insert into tag (id, section_id, label) values (:t, :x, 'Use sources')", t=c2['tag'], x=c2['sect'])
    c.run("insert into rubric (id, course_id, name, style) values (:r, :c, 'Essay', 'advanced')", r=c2['rub'], c=c2['course'])
    c.run("insert into criterion (id, rubric_id, name) values (:x, :r, 'Thesis')", x=c2['crit'], r=c2['rub'])
    c.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :x, 3, 'States a claim')", k=c2['chk'], x=c2['crit'])
    c.run("insert into assessment (id, course_id, title, rubric_id) values (:a, :c, 'Essay', :r)", a=c2['asm'], c=c2['course'], r=c2['rub'])
    c.run("insert into criterion_check (id, criterion_id, level, label) values (:k, :x, 3, 'Has a thesis')", k=ids['b_subj'], x=ids['b_crit'])
    b_check = ids['b_subj']   # a checkbox on Teacher B's criterion (the id is only an id)
    c.run('update assessment set rubric_id = :r where id = :a', r=ids['b_rub'], a=ids['b_asm'])
    rpc(A, 'upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=PROF, t=T1)
    rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=ENR1, a=RUB, x=C1)
    rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=ENR1, a=RUB, k=K1)
    rpc(A, 'upsert_score(:e, :a, 5)', e=ENR1, a=DONE)
    fingerprint = everything()
    for whose, asm, tag, crit, chk in (("Teacher B's", ids['b_asm'], ids['b_tag'], ids['b_crit'], b_check),
                                       ("another of Teacher A's classes'", c2['asm'], c2['tag'], c2['crit'], c2['chk'])):
        THROUGH = [
            ('upsert_score', 'upsert_score(:e, :a, 3)', dict(e=ENR1, a=asm)),
            ('set_score_status', "set_score_status(:e, :a, 'LATE')", dict(e=ENR1, a=asm)),
            ('save_score_comment', "save_score_comment(:e, :a, 'x')", dict(e=ENR1, a=asm)),
            ('save_score_report_note', "save_score_report_note(:e, :a, 'x', :k)", dict(e=ENR1, a=asm, k=key())),
            ('upsert_tag_score (the assessment)', 'upsert_tag_score(:e, :a, :t, 3)', dict(e=ENR1, a=asm, t=T1)),
            ('upsert_tag_score (the competency)', 'upsert_tag_score(:e, :a, :t, 3)', dict(e=ENR1, a=PROF, t=tag)),
            ('upsert_rubric_score (the assessment)', 'upsert_rubric_score(:e, :a, :x, 3)', dict(e=ENR1, a=asm, x=crit)),
            ('upsert_rubric_score (the criterion)', 'upsert_rubric_score(:e, :a, :x, 3)', dict(e=ENR1, a=RUB, x=crit)),
            ('fill_rubric', 'fill_rubric(:e, :a, 3)', dict(e=ENR1, a=asm)),
            ('set_rubric_check (the assessment)', 'set_rubric_check(:e, :a, :k, true)', dict(e=ENR1, a=asm, k=chk)),
            ('set_rubric_check (the checkbox)', 'set_rubric_check(:e, :a, :k, true)', dict(e=ENR1, a=RUB, k=chk)),
        ]
        for name, sql, kw in THROUGH:
            expect_error("%s is refused for Teacher A's student against %s record" % (name, whose), lambda: rpc(A, sql, **kw))
        rpc(A, 'clear_score(:e, :a)', e=ENR1, a=asm)
        DIRECT = [
            ('score', 'insert into score (enrollment_id, assessment_id, value) values (:e, :a, 3)', dict(e=ENR1, a=asm)),
            ('dibels_score', "insert into dibels_score (enrollment_id, assessment_id, period) values (:e, :a, 'boy')", dict(e=ENR1, a=asm)),
            ('tag_score (the assessment)', 'insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 3)', dict(e=ENR1, a=asm, t=T1)),
            ('tag_score (the competency)', 'insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 3)', dict(e=ENR1, a=PROF, t=tag)),
            ('rubric_score (the assessment)', 'insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :x, 3)', dict(e=ENR1, a=asm, x=C1)),
            ('rubric_score (the criterion)', 'insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :x, 3)', dict(e=ENR1, a=RUB, x=crit)),
            ('rubric_check_score (the assessment)', 'insert into rubric_check_score (enrollment_id, assessment_id, check_id) values (:e, :a, :k)', dict(e=ENR1, a=asm, k=K1)),
            ('rubric_check_score (the checkbox)', 'insert into rubric_check_score (enrollment_id, assessment_id, check_id) values (:e, :a, :k)', dict(e=ENR1, a=RUB, k=chk)),
        ]
        for name, sql, kw in DIRECT:
            def go():
                as_teacher(A); c.run(sql, **kw)
            expect_error("a direct insert into %s is refused against %s record" % (name, whose), go, 'row-level security')
        MOVES = [
            ('score to the assessment', 'update score set assessment_id = :a where enrollment_id = :e and assessment_id = :own', dict(a=asm, e=ENR1, own=DONE)),
            ('tag_score to the assessment', 'update tag_score set assessment_id = :a where enrollment_id = :e', dict(a=asm, e=ENR1)),
            ('tag_score to the competency', 'update tag_score set tag_id = :t where enrollment_id = :e', dict(t=tag, e=ENR1)),
            ('rubric_score to the criterion', 'update rubric_score set criterion_id = :x where enrollment_id = :e and assessment_id = :own', dict(x=crit, e=ENR1, own=RUB)),
            ('rubric_check_score to the checkbox', 'update rubric_check_score set check_id = :k where enrollment_id = :e and assessment_id = :own', dict(k=chk, e=ENR1, own=RUB)),
        ]
        for name, sql, kw in MOVES:
            def go():
                as_teacher(A); c.run(sql, **kw)
            expect_error("a direct update of %s is refused against %s record" % (name, whose), go, 'row-level security')
        ok("after all of that against %s records, no score row changed" % whose, everything() == fingerprint)
    rpc(A, 'upsert_score(:e, :a, 4)', e=c2['enr'], a=c2['asm'])
    rpc(A, 'upsert_rubric_score(:e, :a, :x, 3)', e=c2['enr'], a=c2['asm'], x=c2['crit'])
    rpc(A, 'set_rubric_check(:e, :a, :k, true)', e=c2['enr'], a=c2['asm'], k=c2['chk'])
    ok("in Teacher A's second class, that class's own student, assessment, criterion and checkbox are taken as usual",
       score_row(c2['enr'], c2['asm'])[0] == 4.0 and crit_row(c2['enr'], c2['asm'], c2['crit'])[0] == 3 and ticks(c2['enr'], c2['asm']) == [c2['chk']])
    # A row from before the policies that names another class's records.
    as_owner()
    c.run('insert into score (enrollment_id, assessment_id, value) values (:e, :a, 2)', e=ENR2, a=ids['b_asm'])
    c.run('insert into tag_score (enrollment_id, assessment_id, tag_id, value) values (:e, :a, :t, 2)', e=ENR2, a=PLAIN, t=ids['b_tag'])
    as_teacher(A)
    ok("a row left on another teacher's assessment is no longer read by either teacher",
       c.run('select count(*) from score where assessment_id = :a', a=ids['b_asm'])[0][0] == 0)
    as_teacher(B)
    ok('(Teacher B never could read it: the enrollment is not theirs)', c.run('select count(*) from score where enrollment_id = :e', e=ENR2)[0][0] == 0)
    as_teacher(A)
    ok("a row in the right class that names another class's competency can still be read",
       c.run('select count(*) from tag_score where enrollment_id = :e and assessment_id = :a', e=ENR2, a=PLAIN)[0][0] == 1)
    def relevel():
        as_teacher(A); c.run('update tag_score set value = 4 where enrollment_id = :e and assessment_id = :a', e=ENR2, a=PLAIN)
    expect_error('its level cannot be changed', relevel, 'row-level security')
    rpc(A, 'upsert_tag_score(:e, :a, :t, 0)', e=ENR2, a=PLAIN, t=ids['b_tag'])
    ok('and it can be cleared', tag_row(ENR2, PLAIN, ids['b_tag']) is None)

c.run('rollback')
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
