"""Exercise migrations/2026110903_student_card.sql and
2026110904_student_sessions_page.sql (S0-M2, S0-M3) on the local stand-in:

- the teacher's card RPCs as Teacher A, Teacher B, no JWT and anon;
- card, verify_card, page, seen and done as the edge function calls them
  (service_role): the identity check, five wrong tries, Unlock, Reissue (the
  old code stops at once and the student's work stays), Cards Work Until,
  one session holding two classes, midnight in the class's time zone, Done,
  the rate limits, and what the log keeps;
- a draft never comes back from page: by hand, then for a seeded random run
  of saves, edits, clears, returns and setting changes, page always gives
  the grade at the last return;
- no function in student_submit but _returned_grade reads a score table.

One transaction, rolled back at the end. Build the database as README.md,
"Batch A", says, then:

PGPORT=54329 PGDATABASE=fv_a python3 student_page.py
"""
import json, random, re
from batch_a_common import *

c.run('begin')
K = build_class()
T1, T2, C1, C2, K1, K2 = (K[n] for n in ('t1', 't2', 'c1', 'c2', 'k1', 'k2'))
as_owner()
COURSE_A2 = new_id(); ENR_A2 = new_id()
c.run("insert into course (id, teacher_id, name, block) values (:c, :t, 'Socials 8', 'B')", c=COURSE_A2, t=A)
c.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=ENR_A2, s=STU1, c=COURSE_A2)
c.run("update student set preferred_name = 'CeCe', date_of_birth = '2012-05-15' where id = :s", s=STU1)
c.run("update course set student_page_enabled = true, return_grades = 'on_return' where teacher_id = :t", t=A)
today = one("select (now() at time zone 'America/Vancouver')::date::text")

def card(code, ip='ip-1'): return svc('student_submit.card(:c, :i)', c=code, i=ip)
def verify(code, birthday=None, number=None, password=None, token=None, ip='ip-1'):
    return svc('student_submit.verify_card(:c, :b, :n, :p, :t, :i)', c=code, b=birthday, n=number, p=password, t=token, i=ip)
def page(token, e): return svc("student_submit.page(:t, :e, 'ip-1')", t=token, e=e)
def cards(course=COURSE_A): return {x['enrollment_id']: x for x in rpc(A, 'list_student_cards(:c)', c=course)}

# ── Issuing cards ───────────────────────────────────────────────────────
k1 = key()
r = rpc(A, 'issue_student_cards(:c, null, :k)', c=COURSE_A, k=k1)
ok('issue_student_cards makes a card for each enrolled student', r['issued'] == 2 and {x['enrollment_id'] for x in r['cards']} == {ENR1, ENR2}, r)
mine = cards()
code1, code2 = mine[ENR1]['code'], mine[ENR2]['code']
ok('codes read like a slip code, K7M-4QX', all(re.fullmatch(r'[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}-[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}', x) for x in (code1, code2)) and code1 != code2, (code1, code2))
ok('the student path checks a salted hash, the same way a slip does',
   one('select bool_and(code_hash = _access_code_hash(code, salt) and length(salt) = 32) from student_card'))
ok('a student with a birthday is checked by identity and prints no password', mine[ENR1]['check'] == 'identity' and mine[ENR1]['password'] is None, mine[ENR1])
ok('a student with no birthday or number gets a four-digit card password', mine[ENR2]['check'] == 'password' and re.fullmatch(r'\d{4}', mine[ENR2]['password'] or ''), mine[ENR2])
ok('a card works until June 30 of the school year when the class has no reporting terms', mine[ENR1]['works_until'] in ('2027-06-30',) or mine[ENR1]['works_until'].endswith('-06-30'), mine[ENR1])
r2 = rpc(A, 'issue_student_cards(:c, null, :k)', c=COURSE_A, k=k1)
ok('a replay with the same key issues nothing new', r2['issued'] == 2 and one('select count(*) from student_card') == 2, r2)
r3 = rpc(A, 'issue_student_cards(:c, null, :k)', c=COURSE_A, k=key())
ok('issuing again keeps every card: printing never stops one', r3['issued'] == 0 and cards()[ENR1]['code'] == code1, r3)
as_owner(); c.run("""update course set reporting_terms = '[{"ordinal":1,"label":"Term 1","starts_on":"2026-09-08","ends_on":"2026-11-20"},{"ordinal":2,"label":"Term 2","starts_on":"2026-11-23","ends_on":"2027-01-29"}]'::jsonb where id = :c""", c=COURSE_A)
ok("with reporting terms, a card works until the class's last reporting date", cards()[ENR1]['works_until'] == '2027-01-29', cards()[ENR1])
r = rpc(A, "set_cards_work_until(:c, '2026-11-20', :k)", c=COURSE_A, k=key())
ok('set_cards_work_until sets the date for the class', r == {'works_until': '2026-11-20'} and cards()[ENR2]['works_until'] == '2026-11-20', r)
r = rpc(A, 'set_cards_work_until(:c, null, :k)', c=COURSE_A, k=key())
ok('and null puts it back to the last reporting date', r == {'works_until': '2027-01-29'}, r)
r = rpc(A, 'mark_student_cards_printed(:ids::uuid[], :k)', ids='{%s}' % mine[ENR1]['id'], k=key())
ok('mark_student_cards_printed sets printed_at on the cards named', r == {'printed': 1} and cards()[ENR1]['printed_at'] is not None and cards()[ENR2]['printed_at'] is None, r)
as_owner(); c.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR_A2)
r = rpc(A, 'issue_student_cards(:c, null, :k)', c=COURSE_A2, k=key())
ok('a withdrawn student gets no card', r['issued'] == 0, r)
as_owner(); c.run('update enrollment set withdrawn_at = null where id = :e', e=ENR_A2)
r = rpc(A, 'issue_student_cards(:c, :ids::uuid[], :k)', c=COURSE_A2, ids='{%s}' % ENR_A2, k=key())
code_a2 = r['cards'][0]['code']
ok('cards can be issued for the students named', r['issued'] == 1, r)

# ── Who can reach the teacher's side ────────────────────────────────────
card1 = mine[ENR1]['id']
TEACHER_CALLS = [
    ('list_student_cards', 'list_student_cards(:c)', dict(c=COURSE_A)),
    ('issue_student_cards', 'issue_student_cards(:c, null, :k)', dict(c=COURSE_A, k=key())),
    ('unlock_student_card', 'unlock_student_card(:i, :k)', dict(i=card1, k=key())),
    ('reissue_student_card', 'reissue_student_card(:i, :k)', dict(i=card1, k=key())),
    ('set_cards_work_until', "set_cards_work_until(:c, '2027-01-01', :k)", dict(c=COURSE_A, k=key())),
]
for name, sql, kw in TEACHER_CALLS:
    expect_error("Teacher B's %s on Teacher A's class is refused" % name, lambda: rpc(B, sql, **kw), 'not found')
    expect_error('no JWT: %s is refused' % name, lambda: rpc(None, sql, **kw), 'not authenticated')
    def anon_call():
        as_role('anon'); c.run('select ' + sql, **kw)
    expect_error('anon cannot run %s' % name, anon_call, 'permission denied')
r = rpc(B, 'mark_student_cards_printed(:ids::uuid[], :k)', ids='{%s}' % mine[ENR2]['id'], k=key())
ok("Teacher B's mark printed touches none of Teacher A's cards", r == {'printed': 0} and cards()[ENR2]['printed_at'] is None, r)
as_teacher(B); ok("Teacher B reads none of Teacher A's cards, so none of the codes", c.run('select count(*) from student_card')[0][0] == 0)
as_teacher(A); ok('Teacher A reads their own, code included', c.run('select count(*) from student_card where code is not null')[0][0] == 3)
def anon_read():
    as_role('anon'); c.run('select * from student_card')
expect_error('anon cannot read student_card', anon_read, 'permission denied')
for what, sql in (('insert into', "insert into student_card (enrollment_id, code, code_hash, salt) values ('%s', 'AAA-AAA', 'x', 'y')" % ENR1),
                  ('update', "update student_card set wrong_tries = 0"), ('delete from', 'delete from student_card')):
    def direct():
        as_teacher(A); c.run(sql)
    expect_error('a teacher cannot %s student_card directly' % what, direct, 'permission denied')

# ── Who can reach the student's side ────────────────────────────────────
for role in ('anon', 'authenticated'):
    for name, sql in (('card', "student_submit.card('AAA-AAA', 'x')"), ('verify_card', "student_submit.verify_card('AAA-AAA', null, null, null, null, 'x')"),
                      ('page', "student_submit.page('x', '%s', 'x')" % ENR1), ('seen', "student_submit.seen('x', '%s', '{}', 'x')" % ENR1),
                      ('done', "student_submit.done('x', 'x')"), ('_returned_grade', "student_submit._returned_grade('%s', '%s')" % (ENR1, ENR1))):
        def call():
            as_role(role); c.run('select ' + sql)
        expect_error('%s cannot run %s' % (role, name), call, 'permission denied')
    for t in ('device_session', 'device_session_enrollment'):
        def read():
            as_role(role); c.run('select * from student_submit.' + t)
        expect_error('%s cannot read %s' % (role, t), read, 'permission denied')
as_owner()
ok('no function in student_submit can be run by anon or a signed-in teacher',
   one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'
           and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))""") == 0)

# ── card ────────────────────────────────────────────────────────────────
r = card(code1.lower().replace('-', ' '))
ok('a good code says who it is, in any case and with any separator',
   r == {'ok': True, 'kind': 'card', 'student': {'first_name': 'CeCe'}, 'course': {'name': 'Science 8', 'block': None},
         'check': 'identity', 'also_password': False}, r)
ok('a card whose student has no birthday or number asks for the card password', card(code2).get('check') == 'password')
ok('an unknown code is not found', card('ZZZ-ZZZ') == {'ok': False, 'error': 'not_found'})
ok('a malformed code is not found', card('not a code') == {'ok': False, 'error': 'not_found'})
ok('card opens no session', one('select count(*) from student_submit.device_session') == 0)
sp(); as_owner(); c.run('update course set student_page_enabled = false where id = :c', c=COURSE_A)
ok("a class whose student page is off: closed", card(code1) == {'ok': False, 'error': 'closed'})
back(); sp(); as_owner(); c.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
ok('a withdrawn student: not found', card(code1) == {'ok': False, 'error': 'not_found'})
back(); sp(); as_owner(); c.run('update course set deleted_at = now() where id = :c', c=COURSE_A)
ok('a deleted class: not found', card(code1) == {'ok': False, 'error': 'not_found'})
back()

# ── verify_card: the identity check and the lock ────────────────────────
r = verify(code1, birthday='2012-05-16')
ok('a wrong birthday is refused, with the tries left', r == {'ok': False, 'error': 'wrong_identity', 'tries_left': 4}, r)
for left in (3, 2, 1):
    r = verify(code1, number='nope')
    ok('wrong try: %d left' % left, r == {'ok': False, 'error': 'wrong_identity', 'tries_left': left}, r)
r = verify(code1, birthday='not a date')
ok('the fifth wrong try locks the card', r == {'ok': False, 'error': 'card_locked'}, r)
ok('a locked card says so, even with the right birthday',
   card(code1) == {'ok': False, 'error': 'card_locked'} and verify(code1, birthday='2012-05-15') == {'ok': False, 'error': 'card_locked'})
ok('the Student Cards list shows the lock and the count', cards()[ENR1]['locked_at'] is not None and cards()[ENR1]['wrong_tries'] == 5)
ok('no session was opened by any of that', one('select count(*) from student_submit.device_session') == 0)
r = rpc(A, 'unlock_student_card(:i, :k)', i=card1, k=key())
ok('Unlock clears the lock and the count', r['locked_at'] is None and r['wrong_tries'] == 0 and r['code'] == code1, r)
r = verify(code1, birthday='2012-05-15')
tok = r.get('session_token')
ok('the right birthday opens a session', r.get('ok') is True and r['enrollment_id'] == ENR1 and re.fullmatch(r'[0-9a-f]{64}', tok or ''), r)
ok('the session lists the class', r['classes'] == [{'enrollment_id': ENR1, 'student': {'first_name': 'CeCe'}, 'course': {'name': 'Science 8', 'block': None}}], r['classes'])
ok('the token is stored only as a hash',
   one('select count(*) from student_submit.device_session where token_hash = :t', t=tok) == 0
   and one("select count(*) from student_submit.device_session where token_hash = encode(sha256(convert_to(:t, 'UTF8')), 'hex')", t=tok) == 1)
ok('the session ends at the next midnight in Vancouver',
   one("""select expires_at = (((now() at time zone 'America/Vancouver')::date + 1)::timestamp at time zone 'America/Vancouver')
            from student_submit.device_session"""))
ok('last opened is recorded', cards()[ENR1]['last_opened_at'] is not None)
as_owner(); c.run("update student set student_number = 'S-1002' where id = :s", s=STU1)
ok('the student number opens it too, spaces and case aside', verify(code1, number='s 1002').get('ok') is True)
ok('a wrong try after a right one still counts: 4 left', verify(code1, number='S-9999').get('tries_left') == 4)
pw = mine[ENR2]['password']
r = verify(code2, password=pw)
ok('the card password opens a card with nothing else on file', r.get('ok') is True and r['enrollment_id'] == ENR2, r)
tok2 = r['session_token']
ok('a wrong password is a wrong try', verify(code2, password='0000' if pw != '0000' else '1111').get('error') == 'wrong_identity')

# ── page ────────────────────────────────────────────────────────────────
a_pts = new_assessment(K, 'points', title='Quiz 1', date_assigned=today)
a_comp = new_assessment(K, 'competencies', title='Density Lab')
a_rub = new_assessment(K, 'rubric', title='Lab Report', date_assigned=today)
a_future = new_assessment(K, 'points', title='Pop Quiz')
as_owner(); c.run('update assessment set date_assigned = (:d::date + 1) where id = :a', d=today, a=a_future)
p = page(tok, ENR1)
ok('page gives the student, the class and what the page needs to show a grade',
   p.get('ok') is True and p['student']['first_name'] == 'CeCe' and p['course']['name'] == 'Science 8'
   and set(p['course']) == {'name', 'block', 'grading_system', 'grading_scale', 'level_order', 'round_percent'}, p.get('course'))
titles = [x['title'] for x in p['assessments']]
ok('it lists the assignments already assigned, undated first', titles[0] == 'Density Lab' and set(titles) >= {'Quiz 1', 'Density Lab', 'Lab Report'}, titles)
ok('an assignment dated tomorrow is not listed', 'Pop Quiz' not in titles, titles)
row = {x['id']: x for x in p['assessments']}
ok('an assignment carries its dates, kind, competencies and rubric',
   set(row[a_comp]) == {'id', 'title', 'date', 'due_date', 'score_mode', 'max_points', 'weight', 'rubric_id', 'tag_ids',
                        'status', 'returned_at', 'updated_at', 'seen_at', 'grade', 'previous'}
   and sorted(row[a_comp]['tag_ids']) == sorted([T1, T2]) and row[a_rub]['rubric_id'] == K['r1'], row[a_comp])
ok("the rubric comes with its criteria, their level values and checkboxes",
   [r['id'] for r in p['rubrics']] == [K['r1']] and [x['name'] for x in p['rubrics'][0]['criteria']] == ['Method', 'Conclusion']
   and p['rubrics'][0]['criteria'][0]['checks'] == [{'id': K1, 'level': 3, 'label': 'Lists every step'}]
   and [float(p['rubrics'][0]['criteria'][0][k]) for k in ('weight', 'level_1_value', 'level_4_value')] == [1.0, 1.0, 4.0], p['rubrics'])
ok('and the competencies with their names', p['tags'][T1] == {'label': 'Ask questions', 'code': 'Q1'}, p['tags'])
ok('nothing is graded yet: every grade is null', all(x['grade'] is None and x['status'] is None for x in p['assessments']))
ok('the reply names its version and the enrollment', p['v'] == 1 and p['student'] == {'enrollment_id': ENR1, 'first_name': 'CeCe'})
ok('nothing in it says whether a draft exists', not any(k in json.dumps(p) for k in ('draft', 'returned_copy', 'previous_copy')))
ok('no teacher field reaches the phone', not any(k in json.dumps(p) for k in ('report_note', 'teacher_id', 'student_number', 'date_of_birth', 'slip_password')))

def result(token, e, a):
    return {x['id']: x for x in page(token, e)['assessments']}[a]
rpc(A, 'upsert_score(:e, :a, 7)', e=ENR1, a=a_pts)
rpc(A, "save_score_report_note(:e, :a, 'guessed on the last three', :k)", e=ENR1, a=a_pts, k=key())
ok('a draft never comes back from page', result(tok, ENR1, a_pts)['grade'] is None and result(tok, ENR1, a_pts)['returned_at'] is None)
rpc(A, "set_score_status(:e, :a, 'LATE')", e=ENR1, a=a_pts)
ok('a status shows at once, the grade still a draft', result(tok, ENR1, a_pts)['status'] == 'LATE' and result(tok, ENR1, a_pts)['grade'] is None)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a_pts, ids='{%s}' % ENR1, k=key())
got = result(tok, ENR1, a_pts)
ok('once returned, page gives the grade', got['grade'] == {'v': 1, 'value': 7, 'modifier': 0, 'comment': None, 'tags': {}, 'criteria': {}, 'checks': []}
   and got['returned_at'] is not None and got['previous'] is None, got)
ok('the Note for the Report is never in it', 'guessed' not in json.dumps(page(tok, ENR1)))
rpc(A, 'upsert_score(:e, :a, 9)', e=ENR1, a=a_pts); rpc(A, "save_score_comment(:e, :a, 'Recounted')", e=ENR1, a=a_pts)
got = result(tok, ENR1, a_pts)
ok('a change to a returned grade does not come back until it is returned again', got['grade']['value'] == 7 and got['grade']['comment'] is None, got)
rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a_pts, ids='{%s}' % ENR1, k=key())
got = result(tok, ENR1, a_pts)
ok('returned again: the new grade, the one before it, and when it changed',
   got['grade']['value'] == 9 and got['grade']['comment'] == 'Recounted' and got['previous']['value'] == 7 and got['updated_at'] is not None, got)
ok("another student's page shows none of it", result(tok2, ENR2, a_pts)['grade'] is None)
ok('a class that is not in the session: not found', page(tok, ENR2) == {'ok': False, 'error': 'not_found'} and page(tok2, ENR1) == {'ok': False, 'error': 'not_found'})
ok('an unknown or malformed token: signed out', page('f' * 64, ENR1) == {'ok': False, 'error': 'signed_out'} and page('nope', ENR1) == {'ok': False, 'error': 'signed_out'})

# ── seen ────────────────────────────────────────────────────────────────
b_asm = one("insert into assessment (course_id, title) values (:c, 'Essay') returning id", c=COURSE_B)
r = svc("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=tok, e=ENR1, ids='{%s,%s,%s}' % (a_pts, a_comp, b_asm))
ok("seen records what the student opened, and skips another class's assignment", r == {'ok': True, 'seen': 2}, r)
ok('seen_at comes back on the page', result(tok, ENR1, a_pts)['seen_at'] is not None and result(tok, ENR1, a_rub)['seen_at'] is None)
ok('seeing an ungraded piece makes no grade', state(ENR1, a_comp) == 'none' and result(tok, ENR1, a_comp)['grade'] is None)
ok('seen needs the session', svc("student_submit.seen('nope', :e, :ids::uuid[], 'ip-1')", e=ENR1, ids='{%s}' % a_pts) == {'ok': False, 'error': 'signed_out'})
set_class(True, 'on_save')
rpc(A, 'upsert_score(:e, :a, 10)', e=ENR1, a=a_pts)
got = result(tok, ENR1, a_pts)
ok('As Soon As I Save: a change to a grade the student has seen shows at once, marked with what it was',
   got['grade']['value'] == 10 and got['previous']['value'] == 9 and got['updated_at'] is not None, got)
set_class(True, 'on_return')

# ── One session, two classes ────────────────────────────────────────────
sessions = one('select count(*) from student_submit.device_session')
r = verify(code_a2, birthday='2012-05-15', token=tok)
ok('Add Another Card: a second class joins the session the device has',
   r.get('ok') is True and r['session_token'] is None and [x['course']['name'] for x in r['classes']] == ['Science 8', 'Socials 8'], r)
ok('no new session was made', one('select count(*) from student_submit.device_session') == sessions
   and one("select count(*) from student_submit.device_session_enrollment x join student_submit.device_session d on d.id = x.session_id where d.token_hash = encode(sha256(convert_to(:t, 'UTF8')), 'hex')", t=tok) == 2)
ok('page opens either class with the one token', page(tok, ENR1).get('ok') is True and page(tok, ENR_A2)['course'] == dict(page(tok, ENR_A2)['course'], name='Socials 8', block='B'))
ok('each page lists both classes for switching', [x['enrollment_id'] for x in page(tok, ENR_A2)['classes']] == [ENR1, ENR_A2])
r = verify(code2, password=pw, token=tok)
ok('another student can share the device: their class joins too', r.get('ok') is True and len(r['classes']) == 3, r)

# ── Midnight, in the class's time zone ──────────────────────────────────
sp(); as_owner()
ahead = one("select (now() at time zone 'Pacific/Kiritimati')::date > (now() at time zone 'America/Vancouver')::date")
c.run("update course set timezone = :z where id = :c", z='Etc/GMT+12' if ahead else 'Pacific/Kiritimati', c=COURSE_A2)
other_tz = 'Etc/GMT+12' if ahead else 'Pacific/Kiritimati'
r = verify(code_a2, birthday='2012-05-15')
ok("a session started in a class in another time zone ends at that zone's midnight",
   one("select :x::timestamptz = (((now() at time zone :z)::date + 1)::timestamp at time zone :z)", x=r['expires_at'], z=other_tz), r['expires_at'])
vancouver = one("select (((now() at time zone 'America/Vancouver')::date + 1)::timestamp at time zone 'America/Vancouver')")
both = verify(code1, birthday='2012-05-15', token=r['session_token'])
ok('with classes in two zones the session ends at the earlier midnight',
   one("select :x::timestamptz = least(:v::timestamptz, (((now() at time zone :z)::date + 1)::timestamp at time zone :z))", x=both['expires_at'], v=vancouver, z=other_tz), both['expires_at'])
back()
sp(); as_owner()
c.run("update student_submit.device_session set expires_at = now() - interval '1 second' where token_hash = encode(sha256(convert_to(:t, 'UTF8')), 'hex')", t=tok)
ok('after midnight the session is over: signed out', page(tok, ENR1) == {'ok': False, 'error': 'signed_out'})
r = verify(code1, birthday='2012-05-15', token=tok)
ok('and the card starts a new one', r.get('ok') is True and re.fullmatch(r'[0-9a-f]{64}', r['session_token'] or '') and r['session_token'] != tok, r)
back()

# ── Cards Work Until ────────────────────────────────────────────────────
sp()
rpc(A, 'set_cards_work_until(:c, (:d::date - 1), :k)', c=COURSE_A, d=today, k=key())
ok('a card past its date is refused', card(code1) == {'ok': False, 'error': 'card_expired'} and verify(code1, birthday='2012-05-15') == {'ok': False, 'error': 'card_expired'})
ok('and a session it opened stops showing that class', page(tok, ENR1) == {'ok': False, 'error': 'card_expired'} and page(tok, ENR_A2).get('ok') is True)
rpc(A, 'set_cards_work_until(:c, :d::date, :k)', c=COURSE_A, d=today, k=key())
ok('a card works through its last day', card(code1).get('ok') is True)
back()

# ── Reissue ─────────────────────────────────────────────────────────────
work_before = rows("""select (select count(*) from score where enrollment_id = :e), (select count(*) from grade_return where enrollment_id = :e),
                             (select value from score where enrollment_id = :e and assessment_id = :a)""", e=ENR1, a=a_pts)
kr = key()
new = rpc(A, 'reissue_student_card(:i, :k)', i=card1, k=kr)
ok('Reissue gives the student a new card with a new code', new['enrollment_id'] == ENR1 and new['code'] != code1 and new['id'] != card1, new)
ok('the old code stops at once', card(code1) == {'ok': False, 'error': 'not_found'} and verify(code1, birthday='2012-05-15') == {'ok': False, 'error': 'not_found'})
ok('and the session it opened stops showing that class, while the other classes stay',
   page(tok, ENR1) == {'ok': False, 'error': 'card_stopped'} and page(tok, ENR_A2).get('ok') is True
   and ENR1 not in [x['enrollment_id'] for x in page(tok, ENR_A2)['classes']])
ok("everything the student has stays: their scores and returned grades are as they were",
   rows("""select (select count(*) from score where enrollment_id = :e), (select count(*) from grade_return where enrollment_id = :e),
                  (select value from score where enrollment_id = :e and assessment_id = :a)""", e=ENR1, a=a_pts) == work_before)
ok('the old card is kept, stopped', one('select stopped_at is not null from student_card where id = :i', i=card1) and one('select count(*) from student_card where enrollment_id = :e and stopped_at is null', e=ENR1) == 1)
r = verify(new['code'], birthday='2012-05-15', token=tok)
ok('the new card opens the same page, grades and all', r.get('ok') is True and result(tok, ENR1, a_pts)['grade']['value'] == 10, r)
ok('a replay of the reissue with the same key returns the same new card', rpc(A, 'reissue_student_card(:i, :k)', i=card1, k=kr) == new)
expect_error('a card already reissued cannot be reissued again', lambda: rpc(A, 'reissue_student_card(:i, :k)', i=card1, k=key()), 'already reissued')
code1, card1 = new['code'], new['id']

# ── Done ────────────────────────────────────────────────────────────────
r = verify(code_a2, birthday='2012-05-15')
t3 = r['session_token']
ok('Done ends the session', svc("student_submit.done(:t, 'ip-1')", t=t3) == {'ok': True} and page(t3, ENR_A2) == {'ok': False, 'error': 'signed_out'})
ok('Done on a session that is already over, or on nonsense, is still ok', svc("student_submit.done(:t, 'ip-1')", t=t3) == {'ok': True} and svc("student_submit.done('nope', 'ip-1')") == {'ok': True})
ok('the other device is still signed in', page(tok, ENR_A2).get('ok') is True)

# ── A draft never comes back: a seeded random run ───────────────────────
rng = random.Random(20261109)
work = {'points': new_assessment(K, 'points', title='Run: points', date_assigned=today),
        'competencies': new_assessment(K, 'competencies', title='Run: competencies', date_assigned=today),
        'rubric': new_assessment(K, 'rubric', title='Run: rubric', date_assigned=today)}
last = {a: None for a in work.values()}
holds = True; set_class(True, 'on_return')
bad = []; drafts_seen = 0; returns = 0; steps = 0
for n in range(300):
    kind = rng.choice(list(work)); a = work[kind]
    before = working_copy(ENR1, a); was = state(ENR1, a)
    act = rng.choice(['save', 'save', 'save', 'save', 'comment', 'clear', 'return', 'return', 'status', 'note', 'setting', 'seen', 'again'])
    sp()
    try:
        if act == 'save' and kind == 'points':
            rpc(A, 'upsert_score(:e, :a, :v)', e=ENR1, a=a, v=rng.choice([None, 0, 4, 7, 10]))
        elif act == 'save' and kind == 'competencies':
            rpc(A, 'upsert_tag_score(:e, :a, :t, :v, :m::smallint, :c)', e=ENR1, a=a, t=rng.choice([T1, T2]), v=rng.choice([0, 1, 2, 3, 4]),
                m=0, c=rng.choice([None, None, '', 'Say more']))
        elif act == 'save':
            if rng.random() < 0.3:
                rpc(A, 'set_rubric_check(:e, :a, :k, :on)', e=ENR1, a=a, k=rng.choice([K1, K2]), on=rng.random() < 0.6)
            else:
                rpc(A, 'upsert_rubric_score(:e, :a, :x, :v, 0::smallint, :c, :b)', e=ENR1, a=a, x=rng.choice([C1, C2]), v=rng.choice([0, 1, 2, 3, 4]),
                    c=rng.choice([None, None, '', 'Work on this']), b=rng.choice([None, None, '', 'Went beyond']))
        elif act == 'again' and kind == 'points' and before is not None:
            rpc(A, 'upsert_score(:e, :a, :v, :m::smallint)', e=ENR1, a=a, v=before['value'], m=before['modifier'])   # the same save again
        elif act == 'comment':
            rpc(A, 'save_score_comment(:e, :a, :t)', e=ENR1, a=a, t=rng.choice(['', 'Good', 'See me', None]))
        elif act == 'clear':
            rpc(A, 'clear_score(:e, :a)', e=ENR1, a=a)
        elif act == 'return':
            rpc(A, 'return_grades(:a, :ids::uuid[], :k)', a=a, ids='{%s}' % ENR1, k=key())
        elif act == 'status':
            rpc(A, 'set_score_status(:e, :a, :s)', e=ENR1, a=a, s=rng.choice(['NS', 'EXC', 'LATE', None]))
        elif act == 'note':
            rpc(A, 'save_score_report_note(:e, :a, :t, :k)', e=ENR1, a=a, t=rng.choice(['', 'a note']), k=key())
        elif act == 'setting':
            holds = rng.random() < 0.7; set_class(True, 'on_return' if holds else rng.choice(['on_save', None]))
        elif act == 'seen':
            svc("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=tok, e=ENR1, ids='{%s}' % a)
        c.run('release savepoint sp')
    except Exception as err:
        back()   # a refused write (Missing on scored work) changes nothing
        if 'cannot be marked Missing' not in str(err): raise
    after = working_copy(ENR1, a)
    # The model: what the student has is what the working copy was at the
    # last return; under As Soon As I Save every real change is a return.
    if act == 'return':
        if was == 'draft': last[a] = after; returns += 1
    elif not holds and after != before:
        last[a] = after
    steps += 1
    shown = {x['id']: x for x in page(tok, ENR1)['assessments']}
    for kind2, a2 in work.items():
        if shown[a2]['grade'] != last[a2]:
            bad.append((n, act, kind2, shown[a2]['grade'], last[a2]))
        if state(ENR1, a2) == 'draft':
            drafts_seen += 1
            if shown[a2]['grade'] == working_copy(ENR1, a2):
                bad.append((n, act, kind2, 'a draft came back'))
ok('for %d random saves, edits, clears, returns and setting changes, page always gave the grade at the last return' % steps, not bad, bad[:3])
ok('the run really held drafts (%d checks while one was waiting) and returned grades (%d returns)' % (drafts_seen, returns), drafts_seen > 100 and returns > 10, (drafts_seen, returns))
ok('and never left a returned copy off a draft, or a draft that equals what was returned',
   one("""select count(*) from grade_return g where (g.returned_copy is not null) <> (g.is_draft and g.returned_at is not null)
             or (g.is_draft and g.returned_copy = public._grade_copy(g.enrollment_id, g.assessment_id))""") == 0)

# ── Rate limits ─────────────────────────────────────────────────────────
sp()
for n in range(59): card('ZZZ-ZZZ', ip='ip-guess')
ok('59 unknown codes from one address still let a good card through', card(code1, ip='ip-guess').get('ok') is True)
card('ZZZ-ZZZ', ip='ip-guess')
ok('the 60th locks that address out, even with a good code', card(code1, ip='ip-guess') == {'ok': False, 'error': 'locked'}
   and verify(code1, birthday='2012-05-15', ip='ip-guess') == {'ok': False, 'error': 'locked'})
ok('another address is unaffected', card(code1, ip='ip-other').get('ok') is True)
ok("a slip's open() from the locked address still answers: the two keep separate counts",
   svc("student_submit.open('ZZZ-ZZZ', 'ip-guess')") == {'ok': False, 'error': 'not_found'})
back(); sp(); as_owner()
c.run("insert into student_submit.attempt (route, outcome, ip_hash) select 'card', 'not_found', 'ip-' || g from generate_series(1, 500) g")
ok('500 unknown codes across everyone in ten minutes pause the card route', card(code1, ip='ip-fresh') == {'ok': False, 'error': 'busy'})
back()

# ── What the log keeps ──────────────────────────────────────────────────
as_owner()
cols = [x[0] for x in c.run("select column_name from information_schema.columns where table_schema = 'student_submit' and table_name = 'attempt' order by ordinal_position")]
ok('the log still has no answer, name or IP column', cols == ['id', 'at', 'route', 'outcome', 'ip_hash', 'code_id', 'course_id'], cols)
outcomes = set(x[0] for x in c.run("select distinct outcome from student_submit.attempt where route = 'card'"))
ok('it records card outcomes', {'ok', 'not_found', 'bad_format', 'wrong_identity', 'verified', 'card_locked'} <= outcomes, outcomes)
ok('nothing about the student is in it',
   one("select count(*) from student_submit.attempt where row_to_json(attempt)::text ilike any(array['%CeCe%', '%2012-05%', '%1002%', '%' || :p || '%'])", p=code1.replace('-', '')) == 0)

# ── One reader ──────────────────────────────────────────────────────────
src = {r[0]: r[1] for r in rows("""select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'student_submit'""")}
def code_only(s): return re.sub(r'--[^\n]*', '', s)
NAMES = re.compile(r'\b(score|tag_score|rubric_score|rubric_check_score|returned_copy|previous_copy|_grade_copy)\b')
readers = sorted(n for n, s in src.items() if NAMES.search(code_only(s)))
ok('student_submit has %d functions; only _returned_grade names a score table, a stored copy or _grade_copy' % len(src), readers == ['_returned_grade'], readers)
ok("page reaches a grade only through it", '_returned_grade(' in src['page'] and 'grade_return' not in code_only(src['page']))
ok("today's slip functions (open, verify, check, submit and their helpers) read no score table at all: a phone report is a copy the teacher's browser sent",
   not [n for n in ('open', 'verify', 'check', 'submit', '_payload', '_preview', '_part', '_clean_answer', '_closed_reason', '_log', '_norm') if NAMES.search(code_only(src[n]))])
ok('every function in the schema is SECURITY DEFINER with its search_path set, or reads nothing',
   one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'student_submit' and p.proname not in ('_norm', '_midnight')
             and (not p.prosecdef or p.proconfig is null)""") == 0)

finish()
