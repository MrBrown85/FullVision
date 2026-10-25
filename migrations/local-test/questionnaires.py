"""Exercise migrations/20261025_questionnaires_tables_and_functions.sql and
_templates.sql on the local stand-in
(harness.sql): every function as Teacher A, what Teacher B, no JWT and anon
can do, and the constraints. One transaction, rolled back at the end.

PGPORT=54331 python3 run.py harness.sql ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql
PGPORT=54331 python3 questionnaires.py
"""
import os, sys, json, uuid, re
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:300]))

c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))
c.run('begin')
def as_teacher(uid):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run('set role authenticated')
def sp(): c.run('savepoint sp')
def expect_error(name, fn, code=None):
    try:
        fn(); ok(name, False, 'no error raised')
    except Exception as e:
        msg = str(e); ok(name, (code in msg) if code else True, msg)
    finally:
        c.run('rollback to savepoint sp')
def key(): return str(uuid.uuid4())

# ── Templates ──────────────────────────────────────────────────────────
as_teacher(A); sp()
t = c.run('select list_questionnaire_templates()')[0][0]
ok('18 templates: 15 reflections, About Me, Goal Check-In, Reply to Report', len(t) == 18, len(t))
g8 = [x for x in t if x['id'] == 'core-8-1'][0]
ok('Grade 8 November is Self-Awareness and Goal Setting with the Personal Shield',
   g8['theme'] == 'Self-Awareness and Goal Setting' and g8['questions'][0]['kind'] == 'short_set', g8)
ok('its self-assessment is on PAR and PPI', g8['questions'][-1]['core_ids'] == ['PAR', 'PPI'], g8['questions'][-1])
ok('every reflection ends with a scale4 question',
   all(x['questions'][-1]['kind'] == 'scale4' for x in t if x['kind'] == 'core_reflection'))

# ── upsert_questionnaire ───────────────────────────────────────────────
k = key()
q = c.run("select upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_report_period => 1, p_opens_on => '2026-11-03', p_closes_on => '2026-11-14', p_idempotency_key => :k)", c=COURSE_A, k=k)[0][0]
ok('a new questionnaire from a template copies its questions', len(q['questions']) == 3, q)
ok('and its theme and MyEd comment', q['theme'] == 'Self-Awareness and Goal Setting' and 'Self-Awareness' in (q['myed_comment'] or ''), q)
q2 = c.run("select upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_report_period => 1, p_idempotency_key => :k)", c=COURSE_A, k=k)[0][0]
ok('the same idempotency key replays', q2['id'] == q['id'], (q2['id'], q['id']))
qid = q['id']
ids = [x['id'] for x in q['questions']]

gc = c.run("select upsert_questionnaire(:c, 'goal_checkin', 'Goal Check-In', 'goal-checkin', p_parent_id => :p, p_idempotency_key => :k)", c=COURSE_A, p=qid, k=key())[0][0]
ok('a Goal Check-In rides on its reflection', gc['parent_id'] == qid and len(gc['questions']) == 5, gc)

# An answer on question 2 (inserted directly, as the edge function will).
c.run('reset role')
rid = c.run("insert into response (questionnaire_id, enrollment_id) values (:q, :e) returning id", q=qid, e=ENR1)[0][0]
c.run("insert into answer (response_id, question_id, value_text) values (:r, :x, 'Being curious helps me in labs')", r=str(rid), x=ids[1])
as_teacher(A)

# Edit: rename q1, drop answered q2 and unanswered q3, add one.
qs = [dict(q['questions'][0], prompt='Shield: one word or symbol each'), {'prompt': 'One more thing', 'kind': 'text'}]
q3 = c.run("select upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_theme => 'Self-Awareness and Goal Setting', p_report_period => 1, p_opens_on => '2026-11-03', p_closes_on => '2026-11-14', p_questions => :qs::jsonb, p_id => :id, p_idempotency_key => :k)",
           c=COURSE_A, qs=json.dumps(qs), id=qid, k=key())[0][0]
ok('editing keeps a listed question id and its new prompt',
   q3['questions'][0]['id'] == ids[0] and q3['questions'][0]['prompt'] == 'Shield: one word or symbol each', q3['questions'][0])
ok('a new question is added', len(q3['questions']) == 2 and q3['questions'][1]['prompt'] == 'One more thing', q3['questions'])
arch = c.run('select archived from question where id = :x', x=ids[1])
ok('a removed question with answers is archived, not deleted', arch and arch[0][0] is True, arch)
gone = c.run('select count(*) from question where id = :x', x=ids[2])[0][0]
ok('a removed question with no answers is deleted', gone == 0, gone)
kept = c.run('select count(*) from answer where question_id = :x', x=ids[1])[0][0]
ok("the student's answer is kept", kept == 1, kept)

sp()
expect_error('a bad question kind is refused',
             lambda: c.run("select upsert_questionnaire(:c, 'about_me', 'X', p_questions => '[{\"prompt\":\"x\",\"kind\":\"essay\"}]'::jsonb)", c=COURSE_A), 'question_kind_check')
expect_error('a close date before the open date is refused',
             lambda: c.run("select upsert_questionnaire(:c, 'about_me', 'X', p_opens_on => '2026-11-14', p_closes_on => '2026-11-03')", c=COURSE_A), 'check')
expect_error("another teacher's course is refused",
             lambda: c.run("select upsert_questionnaire(:c, 'about_me', 'X')", c=COURSE_B), 'course not found')

# ── set_questionnaire_on / delete ──────────────────────────────────────
r = c.run("select set_questionnaire_on(:q, false, :k)", q=gc['id'], k=key())[0][0]
ok('set_questionnaire_on turns it off', r['is_on'] is False, r)
sp()
expect_error('deleting an answered questionnaire is refused', lambda: c.run("select delete_questionnaire(:q)", q=qid), 'answered')
am = c.run("select upsert_questionnaire(:c, 'about_me', 'About Me', 'about-me', p_idempotency_key => :k)", c=COURSE_A, k=key())[0][0]
ok('About Me has the teacher-only private note',
   any(x['teacher_only'] for x in am['questions']) and len(am['questions']) == 8, am['questions'])
d = c.run("select delete_questionnaire(:q, :k)", q=am['id'], k=key())[0][0]
ok('an unanswered questionnaire can be deleted', d['deleted'] is True, d)

# ── issue_access_codes ─────────────────────────────────────────────────
k = key()
codes = c.run("select issue_access_codes(:q, null, :k)", q=qid, k=k)[0][0]
ok('one code per enrolled student', len(codes) == 2 and {x['enrollment_id'] for x in codes} == {ENR1, ENR2}, codes)
ok('codes look like K7M-4QX with no look-alike characters',
   all(re.fullmatch(r'[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}-[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}', x['code']) for x in codes), codes)
c.run('reset role')
stored = c.run("select code_hash, salt, expires_at from student_access_code where questionnaire_id = :q and revoked_at is null", q=qid)
plain = [x['code'] for x in codes]
ok('only salted hashes are stored', len(stored) == 2 and not any(p in json.dumps([s[0] for s in stored]) for p in plain), stored)
row = c.run("select code_hash, salt from student_access_code where questionnaire_id = :q and enrollment_id = :e and revoked_at is null", q=qid, e=codes[0]['enrollment_id'])[0]
typed = plain[0].lower().replace('-', '')
ok('a typed code matches its hash with or without the dash, in any case',
   c.run("select _access_code_hash(:t, :s)", t=typed, s=row[1])[0][0] == row[0]
   and c.run("select _access_code_hash(:t, :s)", t=plain[0], s=row[1])[0][0] == row[0], row)
exp = str(stored[0][2])
ok('codes expire the day after the close date', exp.startswith('2026-11-15'), exp)
as_teacher(A)
replay = c.run("select issue_access_codes(:q, null, :k)", q=qid, k=k)[0][0]
ok('a replayed key returns no plain codes', isinstance(replay, dict) and replay.get('replayed') is True and 'code' not in json.dumps(replay), replay)
again = c.run("select issue_access_codes(:q, :e::uuid[], :k)", q=qid, e='{' + ENR1 + '}', k=key())[0][0]
c.run('reset role')
live = c.run("select count(*) from student_access_code where enrollment_id = :e and questionnaire_id = :q and revoked_at is null", e=ENR1, q=qid)[0][0]
ok("reissuing revokes the student's earlier code", len(again) == 1 and live == 1, (again, live))
c.run("update enrollment set withdrawn_at = now() where id = :e", e=ENR2)
as_teacher(A)
w = c.run("select issue_access_codes(:q, null, :k)", q=qid, k=key())[0][0]
ok('withdrawn students get no code', [x['enrollment_id'] for x in w] == [ENR1], w)
c.run('reset role'); c.run("update enrollment set withdrawn_at = null where id = :e", e=ENR2); as_teacher(A)

# ── lists ──────────────────────────────────────────────────────────────
lst = c.run("select list_course_questionnaires(:c)", c=COURSE_A)[0][0]
mine = [x for x in lst if x['id'] == qid][0]
ok('list_course_questionnaires has questions and who answered',
   len(mine['questions']) == 2 and mine['answered'] == [ENR1], mine)
resp = c.run("select list_course_responses(:c)", c=COURSE_A)[0][0]
a = resp[qid][ENR1][0]['answers'][ids[1]]
ok("list_course_responses carries the student's words", a['text'] == 'Being curious helps me in labs', resp)

# ── Teacher B, no JWT, anon ────────────────────────────────────────────
as_teacher(B)
ok("Teacher B sees none of A's questionnaires", c.run("select list_course_questionnaires(:c)", c=COURSE_A)[0][0] == [])
ok("Teacher B sees none of A's responses", c.run("select list_course_responses(:c)", c=COURSE_A)[0][0] == {})
ok("Teacher B can read no access codes", c.run("select count(*) from student_access_code")[0][0] == 0)
sp()
expect_error("Teacher B can't issue codes for A's questionnaire", lambda: c.run("select issue_access_codes(:q)", q=qid), 'not found')
expect_error("Teacher B can't turn A's questionnaire off", lambda: c.run("select set_questionnaire_on(:q, false)", q=qid), 'not found')
ok('templates are readable by any teacher', len(c.run('select list_questionnaire_templates()')[0][0]) == 18)
as_teacher(None); sp()
expect_error('no JWT: upsert refused', lambda: c.run("select upsert_questionnaire(:c, 'about_me', 'X')", c=COURSE_A), 'not authenticated')
c.run('reset role'); c.run('set role anon'); sp()
for fn, args in [('list_questionnaire_templates', '()'), ('list_course_questionnaires', "('%s')" % COURSE_A),
                 ('issue_access_codes', "('%s')" % qid), ('upsert_questionnaire', "('%s', 'about_me', 'X')" % COURSE_A)]:
    expect_error('anon cannot run ' + fn, lambda fn=fn, args=args: c.run('select %s%s' % (fn, args)), 'permission denied')
expect_error('anon cannot read templates', lambda: c.run('select * from questionnaire_template'), 'permission denied')

c.run('rollback')
print('%d passed, %d failed' % (len(passed), len(failed)))
for f in failed: print('FAIL', f)
