"""Exercise migrations/20261025_student_submit.sql on the local stand-in:
open and submit as the edge function calls them (service_role), what
anon, authenticated and Teacher B can reach, the code rules (single use,
dates, revoked, withdrawn), the token (expiry, double tap), answer checks,
the self-assessment copy, the rate limits, and what the log keeps. One
transaction, rolled back at the end.

PGPORT=54331 PGDATABASE=fv_ss python3 run.py harness.sql student-submit-prelude.sql \\
  ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql \\
  ../20261025_student_submit.sql ../20261025_student_submit_phone.sql
PGPORT=54331 PGDATABASE=fv_ss python3 student_submit.py
"""
import os, sys, json, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B = 'bbbbbbbb-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
ENR_B = 'eeeeeeee-2222-0000-0000-000000000001'
STU1 = 'aaaaaaaa-1111-0000-0000-000000000001'
passed = []; failed = []
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: ' + str(detail)[:400]))

c = pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'),
                  port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'),
                  password=os.environ.get('PGPASSWORD'))
c.run('begin')
def as_teacher(uid):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run('set role authenticated')
def as_role(role):
    c.run('reset role'); c.run("select set_config('request.jwt.claim.sub', '', true)"); c.run('set role ' + role)
def as_owner(): c.run('reset role')
def sp(): c.run('savepoint sp')
def back(): c.run('rollback to savepoint sp')
def expect_error(name, fn, code=None):
    try:
        fn(); ok(name, False, 'no error raised')
    except Exception as e:
        msg = str(e); ok(name, (code in msg) if code else True, msg)
    finally:
        back()
def key(): return str(uuid.uuid4())
def open_(code, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.open(:c, :i)', c=code, i=ip)[0][0]
def submit(token, answers, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.submit(:t, :a::jsonb, :i)', t=token, a=json.dumps(answers), i=ip)[0][0]
def one(sql, **kw):
    as_owner(); return c.run(sql, **kw)[0][0]

as_owner()
c.run("update student set preferred_name = 'CeCe' where id = :s", s=STU1)
today = one("select (now() at time zone 'America/Vancouver')::date::text")

# ── A reflection with its Goal Check-In, and codes ─────────────────────
as_teacher(A)
q = c.run("select upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_report_period => 1, p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
          c=COURSE_A, d=today, k=key())[0][0]
qid = q['id']; qs = q['questions']
gc = c.run("select upsert_questionnaire(:c, 'goal_checkin', 'Goal Check-In', 'goal-checkin', p_parent_id => :p, p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
           c=COURSE_A, p=qid, d=today, k=key())[0][0]
gqs = gc['questions']
codes = c.run('select issue_access_codes(:q, null, :k)', q=qid, k=key())[0][0]
code = {x['enrollment_id']: x['code'] for x in codes}
ok('codes for both of A\'s students', set(code) == {ENR1, ENR2}, codes)
ok('codes read like K7M-4QX', all(len(x) == 7 and x[3] == '-' for x in code.values()), code)
ok('no two live codes read the same', len(set(code.values())) == 2, code)

# ── Who can reach what ─────────────────────────────────────────────────
for role in ('anon', 'authenticated'):
    sp(); as_role(role)
    expect_error(role + ' cannot run open', lambda: c.run("select student_submit.open('AAA-AAA', 'x')"), 'permission denied')
    sp(); as_role(role)
    expect_error(role + ' cannot run submit', lambda: c.run("select student_submit.submit('x', '{}'::jsonb, 'x')"), 'permission denied')
    sp(); as_role(role)
    expect_error(role + ' cannot read sessions', lambda: c.run('select * from student_submit.session'), 'permission denied')
    sp(); as_role(role)
    expect_error(role + ' cannot read attempts', lambda: c.run('select * from student_submit.attempt'), 'permission denied')
sp(); as_role('anon')
expect_error('anon cannot issue a code', lambda: c.run('select _issue_access_code(:e, :q, now())', e=ENR1, q=qid), 'permission denied')
sp(); as_teacher(B)
expect_error("Teacher B cannot issue a code for A's student", lambda: c.run('select _issue_access_code(:e, :q, now() + interval \'1 day\')', e=ENR1, q=qid), 'not found')
sp(); as_teacher(B)
expect_error("Teacher B cannot issue codes for A's questionnaire", lambda: c.run('select issue_access_codes(:q, null, :k)', q=qid, k=key()), 'not found')
sp(); as_teacher(A)
expect_error("Teacher A cannot attach B's student to A's questionnaire", lambda: c.run('select _issue_access_code(:e, :q, now() + interval \'1 day\')', e=ENR_B, q=qid), 'not found')

# ── open ───────────────────────────────────────────────────────────────
r = open_('not a code')
ok('a malformed code is not found', r == {'ok': False, 'error': 'not_found'}, r)
r = open_('ZZZ-ZZZ')
ok('an unknown code is not found', r == {'ok': False, 'error': 'not_found'}, r)
r = open_(code[ENR1].lower().replace('-', ' '))
ok('a good code opens, in any case and with any separator', r.get('ok') is True, r)
tok1 = r['token']
ok('the token is 64 hex characters', len(tok1) == 64 and all(ch in '0123456789abcdef' for ch in tok1), tok1)
ok('the preferred name is the first name shown', r['student'] == {'first_name': 'CeCe'}, r['student'])
ok('the class name and block', r['course'] == {'name': 'Science 8', 'block': None}, r['course'])
ok('two parts: the reflection and its Goal Check-In',
   [p['id'] for p in r['parts']] == [qid, gc['id']], [p['id'] for p in r['parts']])
ok('no teacher fields reach the phone',
   not any(k in r['parts'][0] for k in ('myed_comment', 'course_id', 'is_on', 'template_id')), list(r['parts'][0]))
ok('questions carry only what the phone needs',
   set(r['parts'][0]['questions'][0]) == {'id', 'prompt', 'prompt_translations', 'kind', 'options', 'core_ids', 'teacher_only'},
   r['parts'][0]['questions'][0])
ok('the token is stored only as a hash',
   one('select count(*) from student_submit.session where token_hash = :t', t=tok1) == 0
   and one("select count(*) from student_submit.session where token_hash = encode(sha256(convert_to(:t, 'UTF8')), 'hex')", t=tok1) == 1)
ok('opened_at is set', one('select opened_at is not null from student_access_code where enrollment_id = :e and revoked_at is null', e=ENR1))
r = open_(code[ENR1])
tok1b = r.get('token')
ok('opening again before submitting gives a new token', r.get('ok') and tok1b != tok1, r)

# ── submit: checks ─────────────────────────────────────────────────────
shield, helps, scale = qs[0]['id'], qs[1]['id'], qs[2]['id']
gstatus, gnext, gpick = gqs[0]['id'], gqs[1]['id'], gqs[2]['id']
sp()
r = submit('f' * 64, {helps: 'x'})
ok('an unknown token is refused as expired', r == {'ok': False, 'error': 'expired'}, r)
r = submit('not-hex', {helps: 'x'})
ok('a malformed token is refused', r == {'ok': False, 'error': 'expired'}, r)
other_q = str(uuid.uuid4())
r = submit(tok1, {other_q: 'x'})
ok("a question not on this slip is refused", r.get('error') == 'invalid' and r.get('question_id') == other_q, r)
r = submit(tok1, {scale: {'levels': {'PAR': 5}}})
ok('a self-assessment step outside 1–4 is refused', r.get('error') == 'invalid', r)
r = submit(tok1, {scale: {'levels': {'COM': 2}}})
ok('a competency the question does not ask about is refused', r.get('error') == 'invalid', r)
r = submit(tok1, {gstatus: 'Finished!'})
ok('a goal status not on the list is refused', r.get('error') == 'invalid', r)
r = submit(tok1, {gpick: 'XYZ'})
ok('an unknown Core Competency is refused', r.get('error') == 'invalid', r)
r = submit(tok1, {helps: 'x' * 2001})
ok('an answer over 2,000 characters is refused', r.get('error') == 'invalid', r)
r = submit(tok1, {shield: ['a', 'b', 'c', 'd', 'e']})
ok('more short answers than labels is refused', r.get('error') == 'invalid', r)
r = submit(tok1, {helps: '   ', shield: ['', '']})
ok('nothing but blanks is refused as empty', r == {'ok': False, 'error': 'empty'}, r)
r = submit(tok1, [1, 2])
ok('answers that are not an object are refused', r.get('error') == 'invalid', r)
ok('none of that saved anything', one('select count(*) from response') == 0)
c.run('release savepoint sp')

# ── submit: a good one ─────────────────────────────────────────────────
answers = {
    shield: ['Curious', 'Soccer', 'Read more', 'Kind'],
    helps: '  Being curious helps me ask questions in labs.  ',
    scale: {'levels': {'PAR': 3, 'PPI': 2}, 'why': 'I plan my work but forget sometimes.'},
    gstatus: 'Working On It', gnext: 'Finish my lab notes on time.', gpick: 'COL',
}
r = submit(tok1, answers)
ok('a good submit is saved', r.get('ok') is True and r.get('submitted_at'), r)
ok('one response for each part', one('select count(*) from response where enrollment_id = :e', e=ENR1) == 2)
ok("the responses are the student's own, via link",
   one("select bool_and(via = 'link' and created_by is null) from response where enrollment_id = :e", e=ENR1))
ok('every answer stored', one('select count(*) from answer') == 6)
ok('text is trimmed', one('select value_text from answer where question_id = :x', x=helps) == 'Being curious helps me ask questions in labs.')
ok('short answers keep their order', one('select value_json from answer where question_id = :x', x=shield) == ['Curious', 'Soccer', 'Read more', 'Kind'])
ok('goal status stores its step', one('select value_num::int from answer where question_id = :x', x=gstatus) == 2)
csa = c.run("select core_id, term_key, level, body from core_self_assessment where enrollment_id = :e order by core_id", e=ENR1)
ok('the self-assessment is copied for each competency (no terms: term key empty)',
   csa == [['PAR', '', 3, 'I plan my work but forget sometimes.'], ['PPI', '', 2, 'I plan my work but forget sometimes.']], csa)
ok('the code is used', one('select used_at is not null from student_access_code where enrollment_id = :e and revoked_at is null', e=ENR1))
r2 = submit(tok1, answers)
ok('a double tap returns the first answer', r2 == r, (r, r2))
ok('and saves nothing twice', one('select count(*) from response where enrollment_id = :e', e=ENR1) == 2)
r = submit(tok1b, answers)
ok("the other open token can't submit again", r == {'ok': False, 'error': 'used'}, r)
r = open_(code[ENR1])
ok('the used code no longer opens', r == {'ok': False, 'error': 'used'}, r)

# A class with reporting terms keys the self-assessment to the period.
as_owner()
c.run("update course set reporting_terms = '[{\"ordinal\":1,\"label\":\"Term 1\"}]'::jsonb where id = :c", c=COURSE_A)
r = open_(code[ENR2])
r = submit(r['token'], {scale: {'levels': {'PAR': 4}}})
ok('with terms, the self-assessment lands on T1',
   one("select level from core_self_assessment where enrollment_id = :e and core_id = 'PAR' and term_key = 'T1'", e=ENR2) == 4, r)

# ── The code rules ─────────────────────────────────────────────────────
as_teacher(A)
codes2 = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ENR1, k=key())[0][0]
new1 = codes2[0]['code']
sp(); as_owner()
c.run('update questionnaire set closes_on = :d::date - 1, opens_on = :d::date - 3 where id = :q', d=today, q=qid)
r = open_(new1)
ok('after the closing date: closed', r.get('error') == 'closed', r)
back(); sp(); as_owner()
c.run('update questionnaire set opens_on = :d::date + 1 where id = :q', d=today, q=qid)
r = open_(new1)
ok('before the opening date: not open yet, with the date', r.get('error') == 'not_open_yet' and r.get('opens_on'), r)
back(); sp(); as_owner()
c.run('update questionnaire set is_on = false where id = :q', q=qid)
r = open_(new1)
ok('turned off: closed', r.get('error') == 'closed', r)
back(); sp(); as_owner()
# A zone whose date differs from Vancouver's right now: Kiritimati (UTC+14)
# is a day ahead from 3 a.m. Vancouver time, Etc/GMT+12 a day behind before 5 a.m.
ahead = one("select (now() at time zone 'Pacific/Kiritimati')::date > (now() at time zone 'America/Vancouver')::date")
if ahead:
    c.run("update course set timezone = 'Pacific/Kiritimati' where id = :c", c=COURSE_A)
    c.run("update questionnaire set closes_on = (now() at time zone 'America/Vancouver')::date where id = :q", q=qid)
else:
    c.run("update course set timezone = 'Etc/GMT+12' where id = :c", c=COURSE_A)
    c.run("update questionnaire set opens_on = (now() at time zone 'America/Vancouver')::date where id = :q", q=qid)
r = open_(new1)
ok("the class's time zone decides the day", r.get('error') == ('closed' if ahead else 'not_open_yet'), r)
back(); sp(); as_owner()
c.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
r = open_(new1)
ok('a withdrawn student: not found', r.get('error') == 'not_found', r)
back(); sp()
r = open_(new1)
tok = r['token']
as_owner(); c.run("update questionnaire set closes_on = :d::date - 1, opens_on = :d::date - 3 where id = :q", d=today, q=qid)
r = submit(tok, {helps: 'late'})
ok('submitting after it closes is refused', r.get('error') == 'closed', r)
back(); sp()
r = open_(new1)
as_owner(); c.run("update student_submit.session set expires_at = now() - interval '1 second' where code_id = (select id from student_access_code where enrollment_id = :e and revoked_at is null and used_at is null)", e=ENR1)
r = submit(r['token'], {helps: 'slow'})
ok('an expired token is refused', r == {'ok': False, 'error': 'expired'}, r)
back(); sp()
r = open_(new1)
as_teacher(A); c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ENR1, k=key())
r2 = open_(new1)
ok('a reissued slip revokes the old code', r2.get('error') == 'not_found', r2)
r3 = submit(r['token'], {helps: 'old slip'})
ok("and the old code's open token can't submit", r3.get('error') == 'not_found', r3)
back()

# ── Rate limits ────────────────────────────────────────────────────────
sp()
for i in range(10): open_('ZZZ-ZZZ', ip='ip-guess')
r = open_(new1, ip='ip-guess')
ok('ten misses from one IP lock it out, even with a good code', r == {'ok': False, 'error': 'locked'}, r)
r = open_(new1, ip='ip-other')
ok('another IP is unaffected', r.get('ok') is True, r)
back(); sp(); as_owner()
c.run("insert into student_submit.attempt (route, outcome, ip_hash) select 'open', 'not_found', 'ip-' || g from generate_series(1, 500) g")
r = open_(new1, ip='ip-fresh')
ok('500 misses across everyone in ten minutes pause opening', r == {'ok': False, 'error': 'busy'}, r)
back(); sp()
r = open_(new1)
as_owner()
c.run("insert into student_submit.attempt (route, outcome, course_id) select 'submit', 'ok', :c from generate_series(1, 120)", c=COURSE_A)
r = submit(r['token'], {helps: 'busy?'})
ok('120 submits a minute in one class is the ceiling', r == {'ok': False, 'error': 'busy'}, r)
back()

# ── For the phone page (20261025_student_submit_phone.sql) ─────────────
sp()
as_teacher(A)
am = c.run("select upsert_questionnaire(:c, 'about_me', 'About Me', 'about-me', p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
           c=COURSE_A, d=today, k=key())[0][0]
amq = {x['prompt']: x for x in am['questions']}
langs = amq['What languages do you speak at home?']['id']
learn = amq['I learn best when I work…']['id']
better = [x for x in am['questions'] if x['repeated_key'] == 'better_at'][0]['id']
amcode = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=am['id'], ids='{%s}' % ENR2, k=key())[0][0][0]['code']
r = open_(amcode)
ok('About Me opens with no course goal context', r.get('context') == {}, r.get('context'))
tok = r['token']
r = submit(tok, {langs: ['English', 'x' * 61]})
ok('a typed-in language over 60 characters is refused', r.get('error') == 'invalid', r)
r = submit(tok, {learn: ['On a boat']})
ok('a typed-in answer is refused where the question allows no other', r.get('error') == 'invalid', r)
r = submit(tok, {langs: ['English', ' Igbo ', 'Igbo', ''], better: 'Hand in labs on time by finishing my data table in class.'})
ok('a typed-in language is kept, trimmed and not doubled', r.get('ok') is True
   and one('select value_json from answer where question_id = :x', x=langs) == ['English', 'Igbo'], r)

as_teacher(A)
codes3 = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ENR2, k=key())[0][0]
r = open_(codes3[0]['code'])
ok('the reflection carries its grade', r['parts'][0].get('grade') == 8, r['parts'][0].get('grade'))
ok("the Goal Check-In shows the student's own course goal",
   (r.get('context') or {}).get('course_goal', {}).get('text') == 'Hand in labs on time by finishing my data table in class.', r.get('context'))
r = submit(r['token'], {scale: {'levels': {'PAR': 2, 'PPI': 3}, 'why': {'PAR': 'I forget to check my goals.', 'PPI': 'I know what I value.'}}})
bodies = dict((x[0], x[1]) for x in c.run("select core_id, body from core_self_assessment where enrollment_id = :e and term_key = 'T1'", e=ENR2))
ok('each competency keeps its own why', bodies == {'PAR': 'I forget to check my goals.', 'PPI': 'I know what I value.'}, bodies)
back()
sp()
r = open_(new1)
r = submit(r['token'], {scale: {'levels': {'PAR': 2}, 'why': {'COM': 'not asked'}}})
ok('a why for a competency the question does not ask about is refused', r.get('error') == 'invalid', r)
back()

# ── What the log keeps ─────────────────────────────────────────────────
as_owner()
cols = [x[0] for x in c.run("select column_name from information_schema.columns where table_schema = 'student_submit' and table_name = 'attempt' order by ordinal_position")]
ok('the log has no answer, name or IP column', cols == ['id', 'at', 'route', 'outcome', 'ip_hash', 'code_id', 'course_id'], cols)
outcomes = set(x[0] for x in c.run('select distinct outcome from student_submit.attempt'))
ok('the log records outcomes', {'ok', 'not_found', 'bad_format', 'invalid', 'empty', 'used'} <= outcomes, outcomes)
ok('nothing a student wrote is in the log',
   one("select count(*) from student_submit.attempt where row_to_json(attempt)::text ilike any(array['%curious%', '%CeCe%', '%lab notes%'])") == 0)

c.run('rollback')
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
