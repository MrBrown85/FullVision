"""Batch C's student routes (PR 1138): every statement the edge function sends,
taken from the route files themselves (feedback-routes.ts, revision-routes.ts,
and the three send-routes.ts statements revise-finish reads), run as written
as the service role with text parameters and the hashed address last, as
postgres.js sends them from index.ts, on a database built as gradebook-prod
is after Batch C (C1, C2), the send rules (2026111130), Batch D and Batch E. It checks every
signature and cast, the answer fields the routes read, the revision replay
path (send_paths, work, file_links), group links and the locked card.

Run it on a throwaway PostgreSQL 17 built by batch_c_common.py, never against
gradebook-prod (see README.md, and the top of batch_c_common.py):

    PGPORT=<port> PGDATABASE=fv_bc python3 batch_c_common.py build
    PGPORT=<port> PGDATABASE=fv_bc python3 batch_c_route_statements.py
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_c_common import *

ROOT = os.path.join(HERE, '..', '..', 'supabase', 'functions', 'student-submit')
def statements(fname):
    text = open(os.path.join(ROOT, fname)).read()
    block = text[text.index('export const SQL = {'):]
    block = block[:block.index('};')]
    out = {}
    for name, body in re.findall(r"(\w+):\s*((?:'[^']*'\s*)+)", block):
        out[name] = ''.join(re.findall(r"'([^']*)'", body))
    return out
FB = statements('feedback-routes.ts')
RV = statements('revision-routes.ts')
SD = statements('send-routes.ts')
print('statements:', sorted(FB), sorted(RV), [k for k in ('sendPaths', 'work', 'fileLinks') if k in SD])

HASH_IP = 'ab' * 32
def as_edge(d, sql, *params):
    """One statement as index.ts runs it: every parameter text or null, the hashed address last."""
    named = re.sub(r'\$(\d+)', lambda m: ':p' + m.group(1), sql)
    kw = {'p%d' % (i + 1): (None if v is None else str(v)) for i, v in enumerate(list(params) + [HASH_IP])}
    r = d._as('service_role', None, named, kw)
    return r[0][0]

name, why = applied_template(with_c2=True)
assert name, why
d = CDb('routes', template=name)
r = d.file('../2026111130_student_send_rules.sql')
# Then Batch D and Batch E, as live will be.
for _rel in ('photo-lifecycle-stand-in.sql', '../2026111140_photo_lifecycle.sql', '../2026111150_student_page_last_changes.sql'):
    assert d.file(_rel) == 'ok', _rel
ok('send rules apply over C1 and C2', r == 'ok', r)
k = seed(d)
lab = k['lab']
t1 = d.session(ENR1)
t2 = d.session(ENR2, birthday='2012-06-16')

# feedback, group_work: read routes with nothing yet
f = as_edge(d, FB['feedback'], t1, ENR1)
ok('feedback answers', f.get('ok') is True and f['assessments'] == [], f)
g = as_edge(d, FB['groupWork'], t1, ENR1)
ok('group_work answers', g == {'ok': True, 'assessments': []}, g)
ok('feedback: a session for another student is not_found', as_edge(d, FB['feedback'], t1, ENR2) == {'ok': False, 'error': 'not_found'})
ok('feedback: an unknown session is signed_out', as_edge(d, FB['feedback'], 'x' * 64, ENR1) == {'ok': False, 'error': 'signed_out'})

# A first send, marked, graded and returned.
sub1, files1 = d.send(t1, ENR1, lab, pages=1)
ok('save_markup', d.save_markup(files1[0], marks('Nice', pen=1))['result'] == 'saved')
d.score(ENR1, lab, 8)
d.return_work(lab, [ENR1])
m = as_edge(d, FB['markup'], t1, ENR1, lab)
ok('markup answers the given marks', m.get('ok') and len(m['files']) == 1 and m['files'][0]['marks']['marks'], m)
ok('markup: the fields are the contract\'s', set(m['files'][0]) == {'file_id', 'marks', 'given_at'}, m)

# reflect, as the edge rebuilds it
refl = json.dumps({'makes_sense': 'not_sure', 'question': ' What is a cell wall? '})
r = as_edge(d, FB['reflect'], t1, ENR1, lab, refl)
ok('reflect answers', r.get('ok') and set(r['reflection']) == {'makes_sense', 'question', 'plan', 'went_well', 'sent_at'}, r)
ok('reflect trims the question', r['reflection']['question'] == 'What is a cell wall?', r)
r = as_edge(d, FB['reflect'], t1, ENR1, k['rub'], json.dumps({'makes_sense': 'yes', 'plan': 'x'}))
ok('reflect on a piece not returned is not_returned', r == {'ok': False, 'error': 'not_returned'}, r)
r = as_edge(d, FB['reply'], t1, ENR1, lab, json.dumps({'sense_now': 'yes'}))
ok('reply before an answer is not_answered', r == {'ok': False, 'error': 'not_answered'}, r)

fb = d.rpc('list_course_feedback(:c)', c=COURSE_A)
rid = fb['reflections'][0]['id']
d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='Plants have them.', k=nid())
f = as_edge(d, FB['feedback'], t1, ENR1)
ok('feedback: answer_new after an answer', f['assessments'][0]['reflection']['answer_new'] is True, f)
s = as_edge(d, FB['answerSeen'], t1, ENR1, '{%s,%s}' % (lab, k['rub']))
ok('answer_seen marks one', s == {'ok': True, 'seen': 1}, s)
s = as_edge(d, FB['answerSeen'], t1, ENR1, '{}')
ok('answer_seen with no ids', s == {'ok': True, 'seen': 0}, s)
r = as_edge(d, FB['reply'], t1, ENR1, lab, json.dumps({'sense_now': 'not_sure', 'follow_up': 'Which paragraph?', 'plan': None}))
ok('reply answers', r.get('ok') and set(r['reflection']) == {'sense_now', 'follow_up', 'plan', 'answer', 'follow_up_answer'}, r)

# A revision: asked, started, uploaded, paths read, finished, read back, taken back.
req = d.rfr(lab, ENR1, {'what_to_fix': 'Add a third reason.', 'revise_by': None, 'criterion_ids': [], 'keep_grade': True})
ok('return_for_revision', req['result'] == 'made', req)
f = as_edge(d, FB['feedback'], t1, ENR1)
ok('feedback lists the revision', f['assessments'][0]['revision']['state'] == 'open', f)
request_id = nid()
pages = json.dumps([{'width': 900, 'height': 1200, 'bytes': 300000, 'thumb_bytes': 300000}] * 2)
st = as_edge(d, RV['revisionStart'], t1, ENR1, lab, pages, 'Fixed it.', request_id)
ok('revision_start answers', st.get('ok') and st['version'] == 2 and st['state'] == 'sending' and len(st['files']) == 2, st)
ok('revision_start names the bucket and paths', st.get('bucket') == BUCKET and all('path' in x and 'thumb_path' in x for x in st['files']), st)
again = as_edge(d, RV['revisionStart'], t1, ENR1, lab, pages, 'Fixed it.', request_id)
ok('revision_start replays by request id', again.get('replayed') is True and again['submission_id'] == st['submission_id'], again)
sp = as_edge(d, SD['sendPaths'], t1, ENR1, st['submission_id'])
ok('send_paths gives the revision\'s version and paths',
   sp.get('ok') and sp['version'] == 2 and [x['path'] for x in sp['files']] == [x['path'] for x in st['files']], sp)
d.upload(st['files'])
done = as_edge(d, RV['revisionFinish'], t1, ENR1, st['submission_id'],
               json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in st['files']]))
ok('revision_finish answers', done.get('ok') and done['version'] == 2 and done['pages'] == 2, done)
ok('revision_finish: the fields are the contract\'s', set(done) == {'ok', 'replayed', 'submission_id', 'version', 'sent_at', 'late', 'pages'}, done)
sp = as_edge(d, SD['sendPaths'], t1, ENR1, st['submission_id'])
ok('send_paths of a finished revision is not_found (revise-finish then reads work and file_links)', sp == {'ok': False, 'error': 'not_found'}, sp)
w = as_edge(d, SD['work'], t1, ENR1)
sent = [a['sent'] for a in w['assessments'] if a['id'] == lab][0]
ok('work says the revision is the latest send', sent['submission_id'] == st['submission_id'] and sent['sent_by'] == 'student', sent)
fl = as_edge(d, SD['fileLinks'], t1, ENR1, lab)
vs = {x['submission_id']: x['version'] for x in fl['files']}
ok('file_links gives each send\'s version', vs.get(st['submission_id']) == 2 and vs.get(sub1) == 1, fl)
gl = as_edge(d, RV['groupFileLinks'], t1, ENR1, lab)
ok('group_file_links (not group work): own pages only, all mine', gl.get('ok') and gl['bucket'] == BUCKET and all(x['mine'] for x in gl['files']) and len(gl['files']) == 3, gl)
ok('group_file_links: the fields the route reads', all({'file_id', 'submission_id', 'version', 'page', 'path', 'thumb_path', 'width', 'height', 'rotation', 'mine'} <= set(x) for x in gl['files']), gl)
un = as_edge(d, RV['revisionUnsend'], t1, ENR1, lab)
ok('revision_unsend answers', un == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 2}, un)

# A first send's request id given to revision_start is answered as that send (the edge refuses version 1).
req2 = nid()
s2 = d.service("student_submit.send_start(:t, :e, :a, :p::jsonb, null, null, :r, 'ip-1')", t=t1, e=ENR1, a=k['rub'],
               p=json.dumps([{'width': 900, 'height': 1200}]), r=req2)
ok('a first send starts', s2.get('ok'), s2)
rs = as_edge(d, RV['revisionStart'], t1, ENR1, k['rub'], pages, None, req2)
ok('revision_start with a first send\'s request id replays it as version 1', rs.get('ok') and rs.get('version') == 1, rs)

# Group work: Cece and Stu2 a pair on a One per Group piece.
d.run("update assessment set group_work = 'group', collab_mode = 'pairs', collab_config = jsonb_build_object('pairs', jsonb_build_array(jsonb_build_array(:a::text, :b::text))) where id = :x",
      a=ENR1, b=ENR2, x=k['rub'])
d.service("student_submit.unsend(:t, :e, :a, 'ip-1')", t=t1, e=ENR1, a=k['rub'])
d.send(t2, ENR2, k['rub'], pages=2)
g = as_edge(d, FB['groupWork'], t1, ENR1)
ok('group_work: counts for the pair', g.get('ok') and g['assessments'][0]['members'] == 2 and g['assessments'][0]['pages'] == 2 and g['assessments'][0]['you_sent'] is False, g)
ok('group_work: no other student\'s id', ENR2 not in json.dumps(g), g)
gl = as_edge(d, RV['groupFileLinks'], t1, ENR1, k['rub'])
ok('group_file_links: the partner\'s pages, not mine', len(gl['files']) == 2 and not any(x['mine'] for x in gl['files']), gl)
ok('group_file_links: a partner\'s path holds their folder', all(('/%s/' % ENR2) in x['path'] for x in gl['files']), gl)

# The locked card: reads answer, writes card_locked.
d.run('update student_card set locked_at = now() where enrollment_id = :e', e=ENR1)
ok('locked: feedback reads', as_edge(d, FB['feedback'], t1, ENR1).get('ok') is True)
ok('locked: reflect is card_locked', as_edge(d, FB['reflect'], t1, ENR1, lab, refl) == {'ok': False, 'error': 'card_locked'})
ok('locked: revision_start is card_locked', as_edge(d, RV['revisionStart'], t1, ENR1, lab, pages, None, nid()) == {'ok': False, 'error': 'card_locked'})
ok('locked: answer_seen reads', as_edge(d, FB['answerSeen'], t1, ENR1, '{}').get('ok') is True)

d.close()
admin('drop database if exists "%s" with (force)' % name)
finish()
