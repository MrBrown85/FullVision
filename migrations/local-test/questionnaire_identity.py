"""Exercise migrations/20261101_questionnaire_identity_check.sql on the local
stand-in: a questionnaire slip opens to "who are you?", verify() matches a
birthday, student number or slip password, the lockouts, submit() refusing an
unchecked session, and the slip password issue_access_codes hands back. One
transaction, rolled back at the end.

PGPORT=54331 PGDATABASE=fv_ss python3 run.py harness.sql student-submit-prelude.sql \\
  ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql \\
  ../20261025_student_submit.sql ../20261025_student_submit_phone.sql \\
  ../20261025_student_submit_token_80.sql ../20261025_phone_reports.sql \\
  ../20261101_questionnaire_identity_check.sql ../20261101_questionnaire_slip_fixes.sql \\
  ../20261103_slip_password_kept_for_live_slips.sql
PGPORT=54331 PGDATABASE=fv_ss python3 questionnaire_identity.py
"""
import os, sys, json, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
COURSE_A = 'aaaaaaaa-0000-0000-0000-000000000001'
ENR1 = 'eeeeeeee-1111-0000-0000-000000000001'; ENR2 = 'eeeeeeee-1111-0000-0000-000000000002'
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
def one(sql, **kw):
    as_owner(); return c.run(sql, **kw)[0][0]
def open_(code, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.open(:c, :i)', c=code, i=ip)[0][0]
def verify(token, birthday=None, number=None, password=None, ip='ip-1'):
    as_role('service_role')
    return c.run('select student_submit.verify(:t, :b, :n, :p, :i)', t=token, b=birthday, n=number, p=password, i=ip)[0][0]
def submit(token, answers, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.submit(:t, :a::jsonb, :i)', t=token, a=json.dumps(answers), i=ip)[0][0]
STU2 = one('select student_id::text from enrollment where id = :e', e=ENR2)
today = one("select (now() at time zone 'America/Vancouver')::date::text")

# ENR1's student has a birthday and a student number; ENR2's has neither.
as_owner()
c.run("update student set date_of_birth = '2012-05-15', student_number = '0123 456' where id = :s", s=STU1)
c.run('update student set date_of_birth = null, student_number = null, slip_password = null where id = :s', s=STU2)

as_teacher(A)
q = c.run("select upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_report_period => 1, p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
          c=COURSE_A, d=today, k=key())[0][0]
qid = q['id']; helps = q['questions'][1]['id']
gc = c.run("select upsert_questionnaire(:c, 'goal_checkin', 'Goal Check-In', 'goal-checkin', p_parent_id => :p, p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
           c=COURSE_A, p=qid, d=today, k=key())[0][0]
codes = c.run('select issue_access_codes(:q, null, :k)', q=qid, k=key())[0][0]
by = {x['enrollment_id']: x for x in codes}

# ── The slip password ──────────────────────────────────────────────────
ok('no password for a student with a birthday or number', by[ENR1].get('password') is None, by[ENR1])
pw = by[ENR2].get('password')
ok('a four-digit password for a student with neither', isinstance(pw, str) and len(pw) == 4 and pw.isdigit(), by[ENR2])
ok('kept on the student', one('select slip_password from student where id = :s', s=STU2) == pw)
as_teacher(A)
again = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ENR2, k=key())[0][0][0]
ok('a reprint shows the same password', again.get('password') == pw, again)
code2 = again['code']; code1 = by[ENR1]['code']
sp(); as_teacher(B)
expect_error("Teacher B cannot make a password for A's student", lambda: c.run('select _slip_password(:e)', e=ENR2), 'not found')
sp(); as_role('anon')
expect_error('anon cannot make a password', lambda: c.run('select _slip_password(:e)', e=ENR2), 'permission denied')
for role in ('anon', 'authenticated'):
    sp(); as_role(role)
    expect_error(role + ' cannot run verify', lambda: c.run("select student_submit.verify('x', null, null, null, 'x')"), 'permission denied')

# ── open: who are you? ─────────────────────────────────────────────────
r = open_(code1)
ok('the slip opens to the identity check', r.get('ok') and r.get('check') == 'identity', r)
ok('with the first name, class and what the questions are called',
   r.get('student', {}).get('first_name') and [p['title'] for p in r.get('preview', [])] == ['November Reflection', 'Goal Check-In'], r)
ok('and no questions or context before the check', 'parts' not in r and 'context' not in r, list(r))
ok('opened_at waits for the check', one('select opened_at is null from student_access_code where enrollment_id = :e and revoked_at is null', e=ENR1))
tok1 = r['token']
r2 = open_(code2)
ok('a student with only a slip password is asked for it', r2.get('check') == 'password', r2)
tok2 = r2['token']
sp()
r = submit(tok1, {helps: 'no check'})
ok('submit refuses a session that has not matched', r == {'ok': False, 'error': 'expired'}, r)
back()

# ── verify ─────────────────────────────────────────────────────────────
r = verify(tok1, birthday='2012-05-16')
ok('a wrong birthday is refused, with tries left', r == {'ok': False, 'error': 'wrong_identity', 'tries_left': 4}, r)
r = verify(tok1, number='999')
ok('a wrong student number is refused', r.get('error') == 'wrong_identity' and r.get('tries_left') == 3, r)
r = verify(tok1)
ok('nothing given is a miss', r.get('error') == 'wrong_identity', r)
r = verify(tok1, password=pw)
ok("another student's password is no use", r.get('error') == 'wrong_identity', r)
ok('tries left count down across the slip', r.get('tries_left') == 1, r)
sp()
r = verify(tok1, birthday='not a date')
ok('the fifth miss locks the slip and says so', r == {'ok': False, 'error': 'slip_locked'}, r)
r = verify(open_(code1)['token'], birthday='2012-05-15')
ok('a fresh scan of a locked slip stays locked, even with the right birthday', r == {'ok': False, 'error': 'slip_locked'}, r)
back()
sp()
r = verify(open_(code1)['token'], number='555')
ok('a fresh scan does not reset the count', r == {'ok': False, 'error': 'slip_locked'}, r)
back()
ok('each miss is in the log as wrong_identity, with no value',
   one("select count(*) from student_submit.attempt where outcome = 'wrong_identity' and code_id = (select id from student_access_code where enrollment_id = :e and revoked_at is null)", e=ENR1) == 4)
as_owner(); c.run("delete from student_submit.attempt where code_id = (select id from student_access_code where enrollment_id = :e and revoked_at is null)", e=ENR1)

r = open_(code1); tok1 = r['token']
r = verify(tok1, number='0123-456')
ok('the student number matches whatever the spacing', r.get('ok') is True, r)
ok('and hands over the questions', [p['id'] for p in r.get('parts', [])] == [qid, gc['id']], r)
ok('opened_at is set once matched', one('select opened_at is not null from student_access_code where enrollment_id = :e and revoked_at is null', e=ENR1))
r = verify(tok1, birthday='1999-01-01')
ok('a matched session answers again without counting a miss', r.get('ok') is True and 'parts' in r, r)
r = submit(tok1, {helps: 'Matched by number.'})
ok('a matched session can submit', r.get('ok') is True, r)

sp()
r = open_(code2)
r = verify(r['token'], password=' ' + pw + ' ')
ok('the slip password matches', r.get('ok') is True and len(r.get('parts', [])) == 2, r)
back()
sp()
r = open_(code2)
r = verify(r['token'], birthday='2012-05-15', number='0123456')
ok("the other student's birthday and number are no use", r.get('error') == 'wrong_identity', r)
back()

# A birthday works too.
as_owner(); c.run("update student set student_number = null where id = :s", s=STU1)
as_teacher(A)
c1 = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ENR1, k=key())[0][0][0]
r = open_(c1['code'])
ok("a used slip's student, reissued: still identity", r.get('check') == 'identity', r)
r = verify(r['token'], birthday='2012-05-15')
ok('the birthday matches', r.get('ok') is True, r)

# ── Misses across several scans add up to the slip's five ──────────────
sp()
wrong = '0000' if pw != '0000' else '1111'
for i in range(2):
    verify(open_(code2)['token'], password=wrong)
r = verify(open_(code2)['token'], password=wrong)
ok('misses on separate scans count together', r.get('tries_left') == 2, r)
verify(open_(code2)['token'], password=wrong)
r = verify(open_(code2)['token'], password=wrong)
ok('the fifth across scans locks the slip', r == {'ok': False, 'error': 'slip_locked'}, r)
back()

# ── A password printed before a roster import still works ──────────────
sp()
as_owner(); c.run("update student set student_number = '7654321' where id = :s", s=STU2)
r = open_(code2)
ok('with a number added since, the phone asks for identity and offers the password', r.get('check') == 'identity' and r.get('also_password') is True, r)
r = verify(r['token'], number=pw, password=pw)
ok('the printed password still opens it', r.get('ok') is True, r)
as_teacher(A)
re = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ENR2, k=key())[0][0][0]
ok('a reprint for a student who now has a number prints no password', re.get('password') is None, re)
ok('and clears the stored one', one('select slip_password from student where id = :s', s=STU2) is None)
r = open_(re['code'])
ok('so the new slip is asked for identity only', r.get('check') == 'identity' and r.get('also_password') is False, r)
back()

# ── Printing another questionnaire's slip keeps a live slip's password ──
sp()
as_owner(); c.run("update student set student_number = '7654321' where id = :s", s=STU2)
# The Reflection slip was printed in an earlier request.
c.run("update student_access_code set created_at = now() - interval '1 day'")
as_teacher(A)
other = c.run("select upsert_questionnaire(:c, 'core_reflection', 'January Reflection', 'core-8-1', p_report_period => 2, p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
              c=COURSE_A, d=today, k=key())[0][0]
re = c.run('select issue_access_codes(:q, :ids::uuid[], :k)', q=other['id'], ids='{%s}' % ENR2, k=key())[0][0][0]
ok("another questionnaire's slip prints no password", re.get('password') is None, re)
ok('and keeps the stored one while the older slip is live', one('select slip_password from student where id = :s', s=STU2) == pw)
r = open_(code2)
ok('so the older slip still offers its password', r.get('check') == 'identity' and r.get('also_password') is True, r)
r = verify(r['token'], number=pw, password=pw)
ok('and accepts it', r.get('ok') is True, r)
back()
r = open_(c1['code'])
ok('a student who never had a password is not offered one', r.get('also_password') is False, r)

# ── A student with nothing to check against needs a new slip ───────────
sp()
as_owner(); c.run('update student set slip_password = null where id = :s', s=STU2)
r = open_(code2)
ok('no birthday, number or password: ask for a new slip', r == {'ok': False, 'error': 'reprint'}, r)
back()

# ── The log ────────────────────────────────────────────────────────────
as_owner()
outcomes = set(x[0] for x in c.run('select distinct outcome from student_submit.attempt'))
ok('the log records matches', 'verified' in outcomes, outcomes)
ok('no birthday, number or password is in the log',
   one("select count(*) from student_submit.attempt where row_to_json(attempt)::text ilike any(array['%2012-05%', '%0123%', :p])", p='%' + pw + '%') == 0)

c.run('rollback')
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
