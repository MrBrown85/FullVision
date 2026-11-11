"""Batch C's student routes (PR 1138): the refusals, on the real functions.
From the PR's independent security review. Every route's own statement, as
the edge sends it (text parameters, hashed address last), on a database
built as gradebook-prod is after C1, C2 and the send rules. It asks whether a
session can reach another student, and whether each refusal (withdrawn, in
the trash, page off, session expired, card past its date, reissued, locked)
holds on every route.

It runs on the database as it is after Batch D and Batch E (2026111140,
2026111150). Three checks were KNOWN gaps of the review (S3 and S4) until
Batch E closed them, and now check the fix: a piece the teacher re-dates
into the future after returning it is not served by markup or
group_file_links, and an Excused group-mate's marks do not reach the
group.

Run it on a throwaway PostgreSQL 17 built by batch_c_common.py, never against
gradebook-prod (see README.md, and the top of batch_c_common.py):

    PGPORT=<port> PGDATABASE=fv_bc python3 batch_c_common.py build
    PGPORT=<port> PGDATABASE=fv_bc python3 batch_c_route_refusals.py
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_c_common import *

ROOT = os.path.join(HERE, '..', '..', 'supabase', 'functions', 'student-submit')
def statements(fname):
    text = open(os.path.join(ROOT, fname)).read()
    block = text[text.index('export const SQL = {'):]
    block = block[:block.index('};')]
    return {n: ''.join(re.findall(r"'([^']*)'", b)) for n, b in re.findall(r"(\w+):\s*((?:'[^']*'\s*)+)", block)}
FB = statements('feedback-routes.ts'); RV = statements('revision-routes.ts'); SD = statements('send-routes.ts')
IP = 'cd' * 32
def edge(d, sql, *params):
    named = re.sub(r'\$(\d+)', lambda m: ':p' + m.group(1), sql)
    kw = {'p%d' % (i + 1): (None if v is None else str(v)) for i, v in enumerate(list(params) + [IP])}
    return d._as('service_role', None, named, kw)[0][0]

name, why = applied_template(with_c2=True); assert name, why
d = CDb('routes1138', template=name)
assert d.file('../2026111130_student_send_rules.sql') == 'ok'
for _rel in ('photo-lifecycle-stand-in.sql', '../2026111140_photo_lifecycle.sql', '../2026111150_student_page_last_changes.sql'):
    assert d.file(_rel) == 'ok', _rel
k = seed(d); lab = k['lab']
t1 = d.session(ENR1); t2 = d.session(ENR2, birthday='2012-06-16')

# Cece (ENR1) sends, is marked, graded, returned for revision; Stu2 (ENR2) too, and reflects.
sub1, files1 = d.send(t1, ENR1, lab, pages=1)
sub2, files2 = d.send(t2, ENR2, lab, pages=1)
d.save_markup(files1[0], marks('For Cece only')); d.save_markup(files2[0], marks('For Stu2 only'))
d.score(ENR1, lab, 6); d.score(ENR2, lab, 7)
d.return_work(lab, [ENR1, ENR2])
d.rfr(lab, ENR1, {'what_to_fix': 'Cece fix'}); d.rfr(lab, ENR2, {'what_to_fix': 'Stu2 fix'})
r2 = d.reflect(t2, ENR2, lab, {'makes_sense': 'not_sure', 'question': 'Stu2 question'})
assert r2['ok'], r2
rid2 = d.one('select id from feedback_reflection where enrollment_id = :e', e=ENR2)
d.rpc('answer_reflection(:r, :a, :k, false)', r=rid2, a='Stu2 answer', k=nid())
# Stu2 starts a revision (unfinished): its submission id is the target of the attacks below.
rs2 = edge(d, RV['revisionStart'], t2, ENR2, lab, json.dumps([{'width': 100, 'height': 100}]), None, nid())
ok('setup: Stu2 revision started', rs2.get('ok') and rs2['version'] == 2, rs2)
sub2r = rs2['submission_id']

def allstr(v): return json.dumps(v)

# 1. Cece's session naming Stu2's enrollment, on every route: not_found, nothing of Stu2's.
calls = {
    'feedback': (FB['feedback'], [t1, ENR2]),
    'markup': (FB['markup'], [t1, ENR2, lab]),
    'reflect': (FB['reflect'], [t1, ENR2, lab, json.dumps({'makes_sense': 'not_sure', 'question': 'x'})]),
    'reply': (FB['reply'], [t1, ENR2, lab, json.dumps({'sense_now': 'yes'})]),
    'answerSeen': (FB['answerSeen'], [t1, ENR2, '{%s}' % lab]),
    'groupWork': (FB['groupWork'], [t1, ENR2]),
    'revisionStart': (RV['revisionStart'], [t1, ENR2, lab, json.dumps([{'width': 1}]), None, nid()]),
    'revisionFinish': (RV['revisionFinish'], [t1, ENR2, sub2r, json.dumps([{'file_id': rs2['files'][0]['file_id'], 'sha256': 'ab' * 32}])]),
    'revisionUnsend': (RV['revisionUnsend'], [t1, ENR2, lab]),
    'groupFileLinks': (RV['groupFileLinks'], [t1, ENR2, lab]),
    'sendPaths': (SD['sendPaths'], [t1, ENR2, sub2r]),
}
for n, (sql, p) in calls.items():
    r = edge(d, sql, *p)
    ok('cross-student %s: not_found' % n, r == {'ok': False, 'error': 'not_found'}, r)

# 2. Cece's own session and enrollment, Stu2's ids where an id is taken.
r = edge(d, SD['sendPaths'], t1, ENR1, sub2r)
ok("send_paths: Stu2's revision send under Cece's own session is not_found", r == {'ok': False, 'error': 'not_found'}, r)
r = edge(d, RV['revisionFinish'], t1, ENR1, sub2r, json.dumps([{'file_id': rs2['files'][0]['file_id'], 'sha256': 'ab' * 32}]))
ok("revision_finish: Stu2's send under Cece's own session is not_found", r == {'ok': False, 'error': 'not_found'}, r)
ok("Stu2's revision send untouched", d.one("select state from submission where id = :s", s=sub2r) == 'sending')
r = edge(d, FB['reply'], t1, ENR1, lab, json.dumps({'sense_now': 'yes'}))
ok("reply: Cece has no reflection: not_found (Stu2's is not reached)", r == {'ok': False, 'error': 'not_found'}, r)
seen_before = d.one("select answer_seen_at from feedback_reflection where id = :r", r=rid2)
r = edge(d, FB['answerSeen'], t1, ENR1, '{%s}' % lab)
ok("answer_seen: Cece's call marks none of Stu2's", r == {'ok': True, 'seen': 0} and
   d.one("select answer_seen_at from feedback_reflection where id = :r", r=rid2) == seen_before, r)
m = edge(d, FB['markup'], t1, ENR1, lab)
ok("markup: Cece sees her own marks only", 'For Cece only' in allstr(m) and 'Stu2' not in allstr(m), m)
f = edge(d, FB['feedback'], t1, ENR1)
ok("feedback: Cece's has no word of Stu2's", 'Stu2' not in allstr(f) and 'Cece fix' in allstr(f), f)
g = edge(d, RV['groupFileLinks'], t1, ENR1, lab)
ok("group_file_links (not group work): Cece's own pages only", all(x['mine'] and ('/%s/' % ENR1) in x['path'] for x in g['files'])
   and ENR2 not in allstr(g), g)
r = edge(d, RV['groupFileLinks'], t1, ENR1, k['b_lab'])
ok("group_file_links: Teacher B's piece answers no file", r == {'ok': True, 'bucket': 'student-photos', 'files': []}, r)
r = edge(d, FB['markup'], t1, ENR1, k['b_lab'])
ok("markup: Teacher B's piece is not_found", r == {'ok': False, 'error': 'not_found'}, r)

# 3. Each state of the card, class or student, on every route.
ALL = lambda t: {
    'feedback': (FB['feedback'], [t, ENR1]),
    'markup': (FB['markup'], [t, ENR1, lab]),
    'reflect': (FB['reflect'], [t, ENR1, lab, json.dumps({'makes_sense': 'not_sure', 'question': 'x'})]),
    'reply': (FB['reply'], [t, ENR1, lab, json.dumps({'sense_now': 'yes'})]),
    'answerSeen': (FB['answerSeen'], [t, ENR1, '{}']),
    'groupWork': (FB['groupWork'], [t, ENR1]),
    'revisionStart': (RV['revisionStart'], [t, ENR1, lab, json.dumps([{'width': 1}]), None, nid()]),
    'revisionUnsend': (RV['revisionUnsend'], [t, ENR1, lab]),
    'groupFileLinks': (RV['groupFileLinks'], [t, ENR1, lab]),
    'sendPaths': (SD['sendPaths'], [t, ENR1, sub1]),
}
def every(label, t, want):
    for n, (sql, p) in ALL(t).items():
        d.run('savepoint s')
        r = edge(d, sql, *p)
        d.run('rollback to savepoint s')
        exp = want(n) if callable(want) else want
        ok('%s %s: %s' % (label, n, exp), r == {'ok': False, 'error': exp}, r)

d.begin()
d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1); every('withdrawn', t1, 'not_found'); d.rollback()
d.begin()
d.run('update course set deleted_at = now() where id = :c', c=COURSE_A); every('class in trash', t1, 'not_found'); d.rollback()
d.begin()
d.run('update course set student_page_enabled = false where id = :c', c=COURSE_A); every('page off', t1, 'closed'); d.rollback()
d.begin()
d.run("update student_submit.device_session set expires_at = now() - interval '1 second'"); every('session expired', t1, 'signed_out'); d.rollback()
d.begin()
d.run("update student_card set works_until = current_date - 2 where enrollment_id = :e", e=ENR1); every('card past its date', t1, 'card_expired'); d.rollback()
d.begin()
d.run("update student_card set locked_at = now() where enrollment_id = :e and stopped_at is null", e=ENR1)
WRITE = {'reflect', 'reply', 'revisionStart', 'revisionUnsend', 'sendPaths'}
for n, (sql, p) in ALL(t1).items():
    d.run('savepoint s'); r = edge(d, sql, *p); d.run('rollback to savepoint s')
    if n in WRITE: ok('locked %s: card_locked' % n, r == {'ok': False, 'error': 'card_locked'}, r)
    else: ok('locked %s: still answers' % n, r.get('ok') is True, r)
d.rollback()
# A reissued card: the old phone's session is refused.
d.make(ENR1)
d.begin(); every('reissued', t1, 'card_stopped'); d.rollback()
t1 = d.session(ENR1)

# 4. A piece the teacher hid (dated in the future) after the work and marks went in.
d.run("update assessment set date_assigned = current_date + 30 where id = :a", a=lab)
f = edge(d, FB['feedback'], t1, ENR1)
ok('hidden piece: feedback leaves it out', all(x['id'] != lab for x in f['assessments']), f)
m = edge(d, FB['markup'], t1, ENR1, lab)
ok('Batch E (S3): a hidden piece\'s marks are not given by markup', m == {'ok': False, 'error': 'not_found'}, m)
g = edge(d, RV['groupFileLinks'], t1, ENR1, lab)
ok('Batch E (S3): a hidden piece\'s pages are not named by group_file_links', g.get('ok') and g['files'] == [], g)
d.run("update assessment set date_assigned = null where id = :a", a=lab)

# 5. Group: Cece and Stu2 a group; a third student outside it.
enr3 = nid(); stu3 = nid()
d.run("insert into student (id, teacher_id, first_name, last_name, date_of_birth) values (:s, :t, 'Leo', 'Third', '2012-08-18')", s=stu3, t=A)
d.run("insert into enrollment (id, student_id, course_id) values (:e, :s, :c)", e=enr3, s=stu3, c=COURSE_A)
t3 = d.session(enr3, '2012-08-18')
d.run("""update assessment set group_work = 'group', collab_mode = 'groups',
           collab_config = jsonb_build_object('groups', jsonb_build_array(jsonb_build_array(:a::text, :b::text), jsonb_build_array(:c::text)))
         where id = :x""", a=ENR1, b=ENR2, c=enr3, x=lab)
g = edge(d, RV['groupFileLinks'], t1, ENR1, lab)
ok('group: Cece gets Stu2 pages too', any(not x['mine'] for x in g['files']), g)
ok("group: Stu2's revision still unfinished is not among them", sub2r not in allstr(g), g)
m = edge(d, FB['markup'], t1, ENR1, lab)
ok("group: Cece sees the teacher's note on Stu2's page (by design)", 'For Stu2 only' in allstr(m), m)
g3 = edge(d, RV['groupFileLinks'], t3, enr3, lab); m3 = edge(d, FB['markup'], t3, enr3, lab)
ok('group: the outsider gets none of the group\'s pages or marks', g3['files'] == [] and m3['files'] == [], (g3, m3))
# Stu2 Excused: do Stu2's marks still reach Cece?
d.run("insert into score (enrollment_id, assessment_id, status) values (:e, :a, 'EXC') on conflict (enrollment_id, assessment_id) do update set status = 'EXC'", e=ENR2, a=lab)
m = edge(d, FB['markup'], t1, ENR1, lab)
ok("Batch E (S4): Stu2 Excused, Cece no longer sees Stu2's marks (note), and still sees her own", 'For Stu2 only' not in allstr(m) and 'For Cece only' in allstr(m), m)
d.close()
admin('drop database if exists "%s" with (force)' % name)
finish()
