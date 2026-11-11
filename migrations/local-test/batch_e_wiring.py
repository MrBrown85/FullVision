"""Two questions from the student page's wiring, answered on the real functions
(everything through Batch E, 2026111150) with the edge's own statements from
send-routes.ts and revision-routes.ts, run as index.ts sends them.

  w1  after a revision (version 2), file-links still names the first
      version's pages, each with its version (1, then 2), and every path
      passes the edge's own checks (so the Before and After has both).
  w2  on a One per Group piece (groups, then pairs) a group-mate's send does
      not stop this student's own send: send-start answers ok with upload
      links, the send finishes, and both sends are in the group's links.

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

    PGDATABASE=<template> python3 batch_e_wiring.py
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import batch_e as be
from batch_e import *

ROOT = os.path.join(HERE, '..', '..', 'supabase', 'functions', 'student-submit')
def statements(fname):
    text = open(os.path.join(ROOT, fname)).read()
    block = text[text.index('export const SQL = {'):]
    block = block[:block.index('};')]
    return {n: ''.join(re.findall(r"'([^']*)'", b)) for n, b in re.findall(r"(\w+):\s*((?:'[^']*'\s*)+)", block)}
SD = statements('send-routes.ts')
RV = statements('revision-routes.ts')

def as_edge(d, sql, *params):
    named = re.sub(r'\$(\d+)', lambda m: ':p' + m.group(1), sql)
    kw = {'p%d' % (i + 1): (None if v is None else str(v)) for i, v in enumerate(list(params) + ['ab' * 32])}
    return d._as('service_role', None, named, kw)[0][0]

# _shared/storage-rest.ts PATH, and send-routes.ts fileLinks's per-file checks.
ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
PATH = re.compile(r'^(%s)/(%s)/(%s)/(%s)/(%s)(-thumb)?\.jpg$' % ((ID,) * 5))
def edge_accepts(files, e, a):
    for x in files:
        p, t = PATH.match(x['path'] or ''), PATH.match(x['thumb_path'] or '')
        if not p or not t or p.group(6) or not t.group(6): return False
        for q in (p, t):
            if q.group(3) != e or q.group(2) != a or q.group(5) != x['file_id'] or q.group(1) != p.group(1) or q.group(4) != p.group(4):
                return False
    return True

PAGES = lambda n: json.dumps([{'width': 900, 'height': 1200, 'bytes': 300000, 'thumb_bytes': 300000}] * n)

def scen_w1():
    d, k, t1, t2 = be.world('w1')
    try:
        lab = k['lab']
        sub1, files1 = d.send(t1, ENR1, lab, pages=2)
        d.save_markup(files1[0], marks('Look again at step 3'))
        d.score(ENR1, lab, 7)
        d.return_work(lab, [ENR1])
        req = d.rfr(lab, ENR1, {'what_to_fix': 'Add a third reason.', 'revise_by': None, 'criterion_ids': [], 'keep_grade': True})
        ok('(setup) revision asked', req.get('result') == 'made', req)
        st = as_edge(d, RV['revisionStart'], t1, ENR1, lab, PAGES(1), 'Fixed it.', nid())
        ok('(setup) revision_start is version 2', st.get('ok') and st['version'] == 2, st)
        d.upload(st['files'])
        done = as_edge(d, RV['revisionFinish'], t1, ENR1, st['submission_id'],
                       json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in st['files']]))
        ok('(setup) revision_finish', done.get('ok') and done['version'] == 2, done)
        fl = as_edge(d, SD['fileLinks'], t1, ENR1, lab)
        got = [(x['submission_id'], x['version'], x['page']) for x in fl.get('files', [])]
        ok('file_links still names the first version\'s two pages, version 1', [g for g in got if g[0] == sub1] == [(sub1, 1, 1), (sub1, 1, 2)], fl)
        ok('file_links names the revision\'s page, version 2', [g for g in got if g[0] == st['submission_id']] == [(st['submission_id'], 2, 1)], fl)
        ok('file_links: version 1 first, then version 2', [g[1] for g in got] == [1, 1, 2], got)
        ok('file_links: every file passes the edge\'s path checks (no TypeError, links for all three)', edge_accepts(fl['files'], ENR1, lab), fl)
        ok('(setup) the first send is still sent', d.one('select state from submission where id = :s', s=sub1) == 'sent')
    finally:
        d.close()

def scen_w2():
    for mode in ('groups', 'pairs'):
        d, k, t1, t2 = be.world('w2' + mode[0])
        try:
            lab = k['lab']
            d.run("""update assessment set group_work = 'group', collab_mode = :m::text,
                       collab_config = jsonb_build_object(:m::text, jsonb_build_array(jsonb_build_array(:a::text, :b::text)))
                     where id = :x""", m=mode, a=ENR1, b=ENR2, x=lab)
            sub2, _ = d.send(t2, ENR2, lab, pages=2)
            g = d.svc('group_work', t1, ENR1)
            ok('%s: (setup) group_work says the partner sent, not you' % mode,
               g.get('ok') and g['assessments'] and g['assessments'][0]['you_sent'] is False and g['assessments'][0]['pages'] == 2, g)
            s = as_edge(d, SD['sendStart'], t1, ENR1, lab, PAGES(1), None, None, nid())
            ok('%s: send-start takes her own page (ok, sending, one upload)' % mode,
               s.get('ok') is True and s.get('state') == 'sending' and len(s.get('files', [])) == 1, s)
            if s.get('ok'):
                d.upload(s['files'])
                f = d.service("student_submit.send_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=t1, e=ENR1, s=s['submission_id'],
                              f=json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in s['files']]))
                ok('%s: her send finishes' % mode, f.get('ok') is True, f)
                ok('%s: the partner\'s send is untouched' % mode, d.one('select state from submission where id = :s', s=sub2) == 'sent')
                gl = as_edge(d, RV['groupFileLinks'], t1, ENR1, lab)
                ok('%s: group links: her page (mine) and the partner\'s two' % mode,
                   sorted(x['mine'] for x in gl['files']) == [False, False, True], gl)
                again = as_edge(d, SD['sendStart'], t1, ENR1, lab, PAGES(1), None, None, nid())
                ok('%s: a second new send after her own is already_sent (Replace is the way)' % mode,
                   again == {'ok': False, 'error': 'already_sent'}, again)
        finally:
            d.close()

if __name__ == '__main__':
    print('statements:', [x for x in ('sendStart', 'fileLinks') if x in SD], [x for x in ('revisionStart', 'revisionFinish', 'groupFileLinks') if x in RV])
    try:
        scen_w1(); scen_w2()
    finally:
        be.drop_templates()
    finish()
