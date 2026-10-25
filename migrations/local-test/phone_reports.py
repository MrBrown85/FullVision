"""Exercise migrations/20261025_phone_reports.sql on the local stand-in:
the teacher's functions (as Teacher A, Teacher B, anon), report codes, the
birthday check, the reply, update and close. One transaction, rolled back.

PGPORT=54331 PGDATABASE=fv_ss python3 run.py harness.sql student-submit-prelude.sql \\
  ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql \\
  ../20261025_student_submit.sql ../20261025_student_submit_phone.sql \\
  ../20261025_student_submit_token_80.sql ../20261025_phone_reports.sql
PGPORT=54331 PGDATABASE=fv_ss python3 phone_reports.py
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
def one(sql, **kw):
    as_owner(); return c.run(sql, **kw)[0][0]
def open_(code, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.open(:c, :i)', c=code, i=ip)[0][0]
def check(token, bday, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.check(:t, :b, :i)', t=token, b=bday, i=ip)[0][0]
def submit(token, answers, ip='ip-1'):
    as_role('service_role'); return c.run('select student_submit.submit(:t, :a::jsonb, :i)', t=token, a=json.dumps(answers), i=ip)[0][0]

today = one("select (now() at time zone 'America/Vancouver')::date::text")
DATA1 = {'v': 1, 'first': 'Cece', 'overall': {'text': '3.0', 'level': 3, 'word': 'Proficient'}, 'comment': ['Cece is curious.']}
DATA2 = {'v': 1, 'first': 'Marcus', 'overall': {'text': '2.0', 'level': 2, 'word': 'Developing'}}
STUDENTS = json.dumps([{'enrollment_id': ENR1, 'data': DATA1}, {'enrollment_id': ENR2, 'data': DATA2}])

# ── Who can do what ────────────────────────────────────────────────────
sp(); as_role('anon')
expect_error('anon cannot send a report', lambda: c.run("select create_phone_report(:c, 1, 'Report 1', current_date + 30, '[]'::jsonb)", c=COURSE_A), 'permission denied')
sp(); as_teacher(B)
expect_error("Teacher B cannot send a report for A's class", lambda: c.run("select create_phone_report(:c, 1, 'Report 1', current_date + 30, '[]'::jsonb)", c=COURSE_A), 'not found')
sp(); as_teacher(A)
expect_error("a student from another class is refused",
             lambda: c.run("select create_phone_report(:c, 1, 'Report 1', current_date + 30, :s::jsonb)", c=COURSE_A,
                           s=json.dumps([{'enrollment_id': ENR_B, 'data': {}}])), 'not in this class')
sp(); as_teacher(A)
expect_error('a last day in the past is refused',
             lambda: c.run("select create_phone_report(:c, 1, 'Report 1', current_date - 1, '[]'::jsonb)", c=COURSE_A), 'today or later')

# ── Sending ────────────────────────────────────────────────────────────
as_teacher(A)
k = key()
rep = c.run("select create_phone_report(:c, 1, 'Report 1', (:d::date + 30), :s::jsonb, :k)", c=COURSE_A, d=today, s=STUDENTS, k=k)[0][0]
rid = rep['id']
ok('the report holds both students', sorted(x['enrollment_id'] for x in rep['students']) == sorted([ENR1, ENR2]), rep)
ok('nobody has opened or replied yet', all(x['opened_at'] is None and x['replied_at'] is None for x in rep['students']), rep['students'])
again = c.run("select create_phone_report(:c, 1, 'Report 1', (:d::date + 30), :s::jsonb, :k)", c=COURSE_A, d=today, s=STUDENTS, k=k)[0][0]
ok('the same key replays', again['id'] == rid)
reply_q = one('select reply_questionnaire_id::text from phone_report where id = :r', r=rid)
rq = one("select jsonb_build_object('kind', kind, 'title', title, 'n', (select count(*) from question where questionnaire_id = q.id), 'closes', closes_on::text) from questionnaire q where id = :q", q=reply_q)
ok('a Reply to Report questionnaire comes with it', rq['kind'] == 'report_reply' and rq['title'] == 'Reply to Report 1' and rq['n'] == 5, rq)
as_teacher(B)
ok("Teacher B's list doesn't show it", c.run('select list_phone_reports(:c)', c=COURSE_A)[0][0] == [])
as_teacher(A)
ok("Teacher A's list shows it", [x['id'] for x in c.run('select list_phone_reports(:c)', c=COURSE_A)[0][0]] == [rid])

k = key()
codes = c.run('select issue_report_codes(:r, null, :k)', r=rid, k=k)[0][0]
code = {x['enrollment_id']: x['code'] for x in codes}
ok('a slip code for each student', set(code) == {ENR1, ENR2}, codes)
ok('a replayed key gives no codes', c.run('select issue_report_codes(:r, null, :k)', r=rid, k=k)[0][0] == {'replayed': True, 'count': 2})
exp = one('select expires_at::date::text from student_access_code where phone_report_id = :r and revoked_at is null limit 1', r=rid)
ok('codes last through the last day', exp == one("select ((:d::date + 31))::text", d=today), exp)

# ── Opening: the birthday check ────────────────────────────────────────
r = open_(code[ENR2])
ok('a report code opens to the check, not the report', r.get('kind') == 'report' and 'report' in r and 'data' not in r['report']
   and r['report']['title'] == 'Report 1' and r['has_birthday'] is False, r)
r2 = check(r['token'], '2012-05-15')
ok('no birthday on file: the student is told to ask the teacher', r2 == {'ok': False, 'error': 'no_birthday'}, r2)

as_owner(); c.run("update student set date_of_birth = '2012-05-15' where id = :s", s=STU1)
r = open_(code[ENR1])
tok = r['token']
ok('a birthday on file', r['has_birthday'] is True, r)
r2 = check(tok, '2012-05-16')
ok('a wrong birthday says how many tries are left', r2 == {'ok': False, 'error': 'wrong_birthday', 'tries_left': 4}, r2)
ok('a wrong birthday opens nothing', one('select opened_at is null from student_access_code where enrollment_id = :e and phone_report_id = :r', e=ENR1, r=rid))
r2 = check(tok, 'not a date')
ok('a malformed birthday is a wrong one', r2.get('error') == 'wrong_birthday', r2)
for i in range(3): check(tok, '2011-01-01')
r2 = check(tok, '2012-05-15')
ok('after five wrong birthdays the session is locked, even with the right one', r2 == {'ok': False, 'error': 'locked'}, r2)

r = open_(code[ENR1])
tok = r['token']
sp()
r2 = submit(tok, {})
ok('a reply before the birthday check is refused', r2 == {'ok': False, 'error': 'expired'}, r2)
back()
r2 = check(tok, '2012-05-15')
ok('the right birthday opens the report as it was sent', r2.get('ok') is True and r2['report'] == DATA1, r2)
ok('with the reply questions, not yet replied', r2['reply'] and len(r2['reply']['questions']) == 5 and r2['replied_at'] is None, r2.get('reply'))
ok('opened is recorded', one('select opened_at is not null from student_access_code where enrollment_id = :e and phone_report_id = :r and revoked_at is null', e=ENR1, r=rid))

# ── Replying ───────────────────────────────────────────────────────────
qs = {x['prompt']: x['id'] for x in r2['reply']['questions']}
answers = {
    qs['What are you most proud of?']: 'my biodiversity journal',
    qs['Your goal: keep it or change it?']: ['Keep It'],
    qs['One thing you will do before the next report']: 'start the data table at lunch',
}
r3 = submit(tok, answers)
ok('the reply is saved', r3.get('ok') is True, r3)
ok('as a response to the reply questionnaire', one('select count(*) from response where questionnaire_id = :q and enrollment_id = :e', q=reply_q, e=ENR1) == 1)
ok('the code still works for reading', one('select used_at is null from student_access_code where enrollment_id = :e and phone_report_id = :r and revoked_at is null', e=ENR1, r=rid))
r = open_(code[ENR1])
r4 = check(r['token'], '2012-05-15')
ok('reopened, the report shows and the reply is done', r4.get('ok') and r4['reply'] is None and r4['replied_at'], r4)
r5 = submit(r['token'], answers)
ok('a second reply is refused', r5 == {'ok': False, 'error': 'used'}, r5)
as_teacher(A)
st = {x['enrollment_id']: x for x in c.run('select list_phone_reports(:c)', c=COURSE_A)[0][0][0]['students']}
ok('the list shows who opened and replied', st[ENR1]['opened_at'] and st[ENR1]['replied_at'] and st[ENR2]['opened_at'] is None, st)

# ── Update and close ───────────────────────────────────────────────────
as_teacher(A)
DATA1b = dict(DATA1, comment=['Cece is curious and kind.'])
u = c.run("select update_phone_report(:r, :s::jsonb, (:d::date + 40), :k)", r=rid,
          s=json.dumps([{'enrollment_id': ENR1, 'data': DATA1b}]), d=today, k=key())[0][0]
ok('Update Issued Copy replaces the copy', one('select data from phone_report_student where report_id = :r and enrollment_id = :e', r=rid, e=ENR1) == DATA1b)
ok('and moves the last day for the report, its reply and its codes',
   u['expires_on'] == one("select (:d::date + 40)::text", d=today)
   and one('select closes_on::text from questionnaire where id = :q', q=reply_q) == u['expires_on']
   and one('select bool_and(expires_at::date = (:d::date + 41)) from student_access_code where phone_report_id = :r and revoked_at is null', r=rid, d=today))
sp()
as_owner(); c.run("update phone_report set expires_on = (now() at time zone 'America/Vancouver')::date - 1 where id = :r", r=rid)
r = open_(code[ENR2])
ok('after the last day the report is closed', r == {'ok': False, 'error': 'report_closed'}, r)
back()
as_teacher(A)
c.run('select close_phone_report(:r, :k)', r=rid, k=key())
r = open_(code[ENR1])
ok('Close All Links stops every code', r == {'ok': False, 'error': 'not_found'}, r)
ok('and turns the reply off', one('select is_on from questionnaire where id = :q', q=reply_q) is False)
sp(); as_teacher(A)
expect_error('no new slips for a closed report', lambda: c.run('select issue_report_codes(:r, null, :k)', r=rid, k=key()), 'closed')

# ── Questionnaire codes are unchanged ──────────────────────────────────
as_teacher(A)
q = c.run("select upsert_questionnaire(:c, 'about_me', 'About Me', 'about-me', p_idempotency_key => :k)", c=COURSE_A, k=key())[0][0]
qc = c.run('select issue_access_codes(:q, null, :k)', q=q['id'], k=key())[0][0][0]['code']
r = open_(qc)
ok('a questionnaire code still opens straight to its questions', r.get('kind') == 'questionnaire' and len(r['parts']) == 1, r)

c.run('rollback')
print('\n'.join('PASS ' + p for p in passed))
print('\n'.join('FAIL ' + f for f in failed))
print(f'{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
