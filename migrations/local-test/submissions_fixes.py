"""Batch B's review fixes: migrations/2026111104_student_work_review_fixes.sql,
applied after Batch B's two files (2026111101, 2026111102, as reviewed at
8c36fe48). Batch B's second review, section (b), items 5 and 6:

  ruling 88  a submission could pass 30 pages when the teacher added pages
             while the student's Replace was still uploading (the review
             made 59);
  ruling 92  a student's Unsend, or a finished Replace, dropped the
             teacher's Add as More Pages that was uploaded and not yet
             finished, and queued its files for deletion.

    python3 submissions_common.py build      an EMPTY database as live is, no Batch B
    python3 submissions_fixes.py             every scenario below
    python3 submissions_fixes.py faults race or only some
    python3 submissions_fixes.py fingerprints [check]   write (or check) the lists the files carry
    python3 submissions_fixes.py mutate [n ...]          wrong versions of the two fixes: are they noticed?

  faults          The two faults, case by case: the review's probes B and
                  C first, then each order a send, a Replace, an Unsend and
                  an Add can be finished in. Checks marked "differs" must
                  fail without the file: faults-without runs the same cases
                  on Batch B alone and passes only if each of them fails
                  there (and every other check holds there too).
  race            The same interleavings on connections of their own, the
                  first holding the class so the second is seen to wait.
                  race-without: the same on Batch B alone.
  fuzz            Seeded random runs of sends, Replaces, Unsends and Adds
                  on one student's piece: after every step no work handed
                  in has more than 30 pages, nothing a teacher uploaded is
                  queued by a student's Unsend or Replace, and Batch B's own
                  invariants hold. fuzz-without: the same on Batch B alone,
                  where both are broken.
  apply           The file's shape, its lists, each guard, a lock it cannot
                  get, the apply on a database in use (no row changes; only
                  the three functions' bodies change; owner, grants,
                  SECURITY DEFINER, search_path, volatility, oid kept), a
                  second run, Batch B's first file run again, file 1 alone,
                  the read-only pre-check and post-check and the damage
                  each notices.
  undo            batch-b-fixes-undo.sql: the three functions back to their
                  8c36fe48 bodies, proved by fingerprint and by pg_proc
                  column for column; nothing else changes; work in progress
                  can still be finished; the order out with Batch B's own
                  undo; the way back of its PART 1B.

The database named by PGDATABASE is only a template: every scenario runs on
a copy. Batch B's own suites run with this file applied by setting
BATCH_B_WITH_FIXES=1 (see submissions_common.py).
"""
import difflib, random, threading, time
from submissions_common import *
import submissions_common as sc
from submissions import sound, queued, live_paths, retouched

FIX_T = text_of(FIXES_USED); FIX_S = split(FIX_T)
REPLACED = ['public.finish_work_upload(uuid,jsonb,uuid)', 'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
            'student_submit.unsend(text,uuid,uuid,text)']
LIST_FILES = [FIXES, UNDO_FIXES, 'batch-b-fixes-live-precheck.sql', 'batch-b-fixes-live-postcheck.sql']
BEGIN = re.compile(r'^([ \t]*)-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*$', re.M)
BATCHB = dict(fingerprint_lists(text_of(M1))[0])      # Batch B's 44 as 8c36fe48 leaves them (its own list)
last = lambda st: st.split('\n')[-1].strip().lower()

# ── templates: Batch B, with or without the fixes ───────────────────────────
_TPL = {}
def template(fixed, only_m1=False):
    key = (fixed, only_m1)
    if key in _TPL: return _TPL[key]
    name = '%s_fx%s%d%s' % (cc.BASE_DB, 'm' if MUTATED else '', int(fixed), 'o' if only_m1 else '')
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in [M1_USED] + ([] if only_m1 else [M2_USED]) + ([FIXES_USED] if fixed else []):
        for st in split(text_of(rel)):
            try: c.run(st)
            except Exception as e:
                c.close(); ok('%s applies to the template' % os.path.basename(rel), False, message(e)); finish()
    c.close(); _TPL[key] = name
    return name
def drop_templates():
    for name in _TPL.values(): admin('drop database if exists "%s" with (force)' % name)

def world(tag, fixed):
    d = WorkDb(tag, template=template(fixed)); k = seed_work(d)
    t1, _ = d.session(ENR1); t2, _ = d.session(ENR2, birthday='2012-06-16')
    return d, k, t1, t2

# ── small helpers ───────────────────────────────────────────────────────────
def g(r, *ks):
    for k in ks:
        r = r.get(k) if isinstance(r, dict) else None
    return r
def err(r): return None if not isinstance(r, dict) or r.get('ok') else r.get('error')
def fpaths(files): return sorted(p for f in (files or []) for p in (f['path'], f['thumb_path']))
def ids(files): return [f['file_id'] for f in (files or [])]
def tstart(x, a, e, n, mode='add', key=None):
    return x.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=e, p=json.dumps([{'width': 1500, 'height': 2000}] * n), m=mode, k=key or nid())
def tput(x, files):
    for f in files or []:
        for p in (f['path'], f['thumb_path']): x.storage.put_as('authenticated', A, p)
def tfinish(x, sid, files, key=None):
    return x.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=sid, f=json.dumps([{'file_id': f['file_id'], 'sha256': HASH} for f in files]), k=key or nid())
def most(x): return x.one("select coalesce(max(n), 0) from (select count(f.id) as n from submission s join submission_file f on f.submission_id = s.id where s.state = 'sent' group by s.id) z")
def pages(x, sid): return [tuple(r) for r in x.all('select page, added_by, id::text from submission_file where submission_id = :s order by page', s=sid)]
def row(x, sid): return x.all('select state, intent, target_id::text, sent_by from submission where id = :s', s=sid)
def piece(x, tok, e, a): return next((w for w in (g(x.work(tok, e), 'assessments') or []) if w.get('id') == a), {})
def wipe(d):
    for st in ('delete from submission', 'delete from student_submit.send_log', 'delete from fv_idempotency', 'delete from grade_return'): d.run(st)
    d.storage.remove(d.storage.names()); d.run('delete from submission_file_removal')

MODE = {'fixed': True}
def check(name, good, detail='', differs=False):
    """With the fixes: the check must hold. Without them (Batch B alone): a check marked differs must NOT hold
    (that is the fault, or the answer the fix changes); every other check must hold there too."""
    if MODE['fixed']: ok(name, bool(good), detail)
    elif differs: ok('WITHOUT the fix this does not hold, as the review found: ' + name, not good, 'it held')
    else: ok('without the fix too: ' + name, bool(good), detail)

# ════════════════════════════════════════════════════════════════════════════
# The cases, one transaction each, rolled back.
def case_probe_b(d, k, t1, t2):
    a = k['takes']
    s1, f1 = d.send(t1, ENR1, a, 1); old = s1['submission_id']
    s2 = d.send_start(t1, ENR1, a, 30, replace=True); d.upload(s2['files']); new = s2['submission_id']
    t, tf = d.teacher_upload(a, ENR1, 29, mode='add')
    check("probe B, 1: while the student's Replace of 30 pages uploads, the teacher's Add as More Pages of 29 onto the work's 1 page is taken: 30 pages",
          g(tf, 'result') == 'sent' and len(g(tf, 'submission', 'files') or []) == 30, tf)
    f2 = d.send_finish(t1, ENR1, new, s2['files'])
    check("probe B, 2 (review (b) 5): the Replace, finished second, is refused: too_many_pages, room for 1", f2 == {'ok': False, 'error': 'too_many_pages', 'room': 1}, f2, differs=True)
    check('probe B, 3: no work handed in has more than 30 pages (the review made 59)', most(d) <= 30, most(d), differs=True)
    check("probe B, 4: what is handed in is as it was: the student's page, then the teacher's 29, still the student's work",
          [p[1] for p in pages(d, old)] == ['student'] + ['teacher'] * 29 and row(d, old) == [['sent', 'new', None, 'student']], row(d, old), differs=True)
    check('probe B, 5: the refused Replace is not dropped: still unfinished, still replacing that work, its 30 pages its own, none of its files queued',
          row(d, new) == [['sending', 'replace', old, 'student']] and len(pages(d, new)) == 30 and not set(fpaths(s2['files'])) & set(queued(d)), row(d, new), differs=True)
    check('probe B, 6: and nothing at all is queued for deletion', queued(d) == [], queued(d), differs=True)
    check("probe B, 7: the student's page still shows the Replace in progress, with the finish-by it was given at the start",
          g(piece(d, t1, ENR1, a), 'sending', 'submission_id') == new, piece(d, t1, ENR1, a), differs=True)
    f2b = d.send_finish(t1, ENR1, new, s2['files'][:2])
    check('probe B, 7b: naming two of its pages is still one too many: too_many_pages, room for 1, nothing changes',
          f2b == {'ok': False, 'error': 'too_many_pages', 'room': 1} and row(d, new) == [['sending', 'replace', old, 'student']] and queued(d) == [], f2b, differs=True)
    f3 = d.send_finish(t1, ENR1, new, s2['files'][:1])
    check("probe B, 8: the student finishes it with the one page that fits: handed in, 30 pages, the new page first, then the teacher's 29",
          g(f3, 'ok') is True and g(f3, 'pages') == 30 and g(f3, 'replayed') is False
          and pages(d, new) == [(1, 'student', s2['files'][0]['file_id'])] + [(i, 'teacher', t['files'][i - 2]['file_id']) for i in range(2, 31)], (f3, pages(d, new)[:3]), differs=True)
    check("probe B, 9: the 29 pages left out of that finish are queued (page_removed), the student's old page as replaced, and no file of the teacher's",
          queued(d, 'page_removed') == fpaths(s2['files'][1:]) and queued(d, 'replace') == fpaths(s1['files']) and not set(fpaths(t['files'])) & set(queued(d)), queued(d)[:4], differs=True)
    check('probe B, 10: everything that must always hold, holds, and nothing handed in passed 30', sound(d) == '' and most(d) == 30, (sound(d), most(d)), differs=True)

def case_add_second(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1); old = s1['submission_id']
    t = tstart(d, a, ENR1, 29); tput(d, t.get('files')); tid = t.get('submission_id')
    check("the teacher's Add of 29 onto the work's 1 page starts (the 30 is asked at the start too)", t.get('result') == 'ready', t)
    s2 = d.send_start(t1, ENR1, a, 25, replace=True); d.upload(s2['files']); new = s2['submission_id']
    f2 = d.send_finish(t1, ENR1, new, s2['files'])
    check("the student's Replace of 25 is handed in while the teacher's Add is still uploading: 25 pages", g(f2, 'ok') is True and g(f2, 'pages') == 25, f2)
    check("that Replace does not drop the teacher's unfinished Add: it now adds to the new work, and none of its files is queued",
          row(d, tid) == [['sending', 'add', new, 'teacher']] and not set(fpaths(t['files'])) & set(queued(d)), (row(d, tid), queued(d)[:2]), differs=True)
    key = nid()
    r = tfinish(d, tid, t['files'], key)
    check("the teacher's Add, finished second, is refused: too_many_pages, room for 5; the work keeps its 25 pages; the upload stays, none of its files queued",
          r == {'result': 'too_many_pages', 'room': 5} and len(pages(d, new)) == 25 and row(d, tid) == [['sending', 'add', new, 'teacher']]
          and not set(fpaths(t['files'])) & set(queued(d)), r, differs=True)
    r1b = tfinish(d, tid, t['files'][:6], key)
    check("naming six of its pages is one too many: too_many_pages, room for 5, nothing changes",
          r1b == {'result': 'too_many_pages', 'room': 5} and len(pages(d, new)) == 25 and len(pages(d, tid)) == 29, r1b, differs=True)
    r2 = tfinish(d, tid, t['files'][:5], key)
    check("that answer is not remembered: the same request, sent again naming five of its pages, is handed in: 30 pages, the student's 25, then the teacher's 5",
          g(r2, 'result') == 'sent' and [x['added_by'] for x in g(r2, 'submission', 'files') or []] == ['student'] * 25 + ['teacher'] * 5
          and [x['id'] for x in (g(r2, 'submission', 'files') or [])[25:]] == ids(t['files'][:5]) and g(r2, 'submission', 'id') == new, r2, differs=True)
    check("the teacher's 24 pages left out are queued (page_removed), the student's old page as replaced; the work never passed 30",
          queued(d, 'page_removed') == fpaths(t['files'][5:]) and queued(d, 'replace') == fpaths(s1['files']) and most(d) == 30 and sound(d) == '', (queued(d)[:2], most(d), sound(d)), differs=True)

def case_replace_fits(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 2); old = s1['submission_id']
    t0, t0f = d.teacher_upload(a, ENR1, 1, mode='add')
    t = tstart(d, a, ENR1, 2); tput(d, t.get('files')); tid = t.get('submission_id')
    s2 = d.send_start(t1, ENR1, a, 3, replace=True); d.upload(s2['files']); new = s2['submission_id']
    f2 = d.send_finish(t1, ENR1, new, s2['files'])
    check("a Replace of 3 on work that holds the teacher's 1 page, while the teacher's Add of 2 more uploads: handed in, 4 pages", g(f2, 'ok') is True and g(f2, 'pages') == 4, f2)
    check("the teacher's unfinished Add now adds to the new work", row(d, tid) == [['sending', 'add', new, 'teacher']], row(d, tid), differs=True)
    r = tfinish(d, tid, t['files'])
    want = [(1, 'student', ids(s2['files'])[0]), (2, 'student', ids(s2['files'])[1]), (3, 'student', ids(s2['files'])[2]),
            (4, 'teacher', ids(t0['files'])[0]), (5, 'teacher', ids(t['files'])[0]), (6, 'teacher', ids(t['files'])[1])]
    check("the teacher's Add is finished onto it: 6 pages, the student's 3 new, the teacher's earlier page, then the teacher's 2 new",
          g(r, 'result') == 'sent' and g(r, 'submission', 'id') == new and pages(d, new) == want, (r, pages(d, new)), differs=True)
    check("only the student's old pages were ever queued (replace); no file of the teacher's", queued(d) == fpaths(s1['files']) and sound(d) == '', queued(d), differs=True)

def case_replace_30_on_more(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 5)
    s2 = d.send_start(t1, ENR1, a, 30, replace=True); d.upload(s2['files'])
    f2 = d.send_finish(t1, ENR1, s2['submission_id'], s2['files'])
    check("a Replace of 30 on a student's own work of 5 is handed in: the old pages do not count against it", g(f2, 'ok') is True and g(f2, 'pages') == 30, f2)

def case_probe_c(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1); old = s1['submission_id']
    t = tstart(d, a, ENR1, 1); tput(d, t.get('files')); tid = t.get('submission_id')
    u = d.unsend(t1, ENR1, a)
    check("probe C, 1: the student's Unsend answers as before: one page unsent, none kept", u == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 1, 'kept': 0}, u)
    check("probe C, 2 (review (b) 6): only the student's two files are queued, as unsent; neither of the teacher's",
          queued(d) == fpaths(s1['files']) and queued(d, 'unsend') == fpaths(s1['files']), queued(d), differs=True)
    check("probe C, 3: the teacher's upload is still there, no longer pointing at the work that went (new, no target)", row(d, tid) == [['sending', 'new', None, 'teacher']], row(d, tid), differs=True)
    check('probe C, 4: the teacher can still read the two files they uploaded, and storage still has them',
          all(d.storage.can_read('authenticated', A, p) for p in fpaths(t['files'])) and set(fpaths(t['files'])) <= set(d.storage.names()), differs=True)
    lst = d.rpc('list_course_submissions(:c)', c=COURSE_A)
    check('probe C, 5: the list shows it among the teacher\'s unfinished uploads, with the finish-by it was given at its start',
          [(x['id'], x['finish_by']) for x in lst['uploads']] == [(tid, t['finish_by'])] and lst['submissions'] == [], lst['uploads'], differs=True)
    r = tfinish(d, tid, t['files'])
    check("probe C, 6: the teacher's finish hands it in: the piece's work, sent by the teacher, with the teacher's page",
          g(r, 'result') == 'sent' and g(r, 'submission', 'sent_by') == 'teacher' and pages(d, tid) == [(1, 'teacher', ids(t['files'])[0])], r, differs=True)
    w = piece(d, t1, ENR1, a)
    check("probe C, 7: the student's page then shows it handed in by the teacher, one page, not the student's to change",
          (g(w, 'sent', 'sent_by'), g(w, 'sent', 'pages'), g(w, 'sent', 'can_change')) == ('teacher', 1, False), w, differs=True)
    check("probe C, 8: the student's Unsend and Replace are refused (cannot_change), a new send already_sent",
          err(d.unsend(t1, ENR1, a)) == 'cannot_change' and err(d.send_start(t1, ENR1, a, replace=True)) == 'cannot_change' and err(d.send_start(t1, ENR1, a)) == 'already_sent', differs=True)
    check('probe C, 9: everything that must always hold, holds', sound(d) == '' and queued(d) == fpaths(s1['files']), (sound(d), queued(d)), differs=True)

def case_unsend_kept(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 2); old = s1['submission_id']
    t0, _ = d.teacher_upload(a, ENR1, 1, mode='add')
    t = tstart(d, a, ENR1, 2); tput(d, t.get('files')); tid = t.get('submission_id')
    u = d.unsend(t1, ENR1, a)
    check("an Unsend of work that holds a page of the teacher's, while the teacher's Add of 2 more uploads: the student's 2 pages go, 1 kept",
          u == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 2, 'kept': 1}, u)
    check("the work stays, as the teacher's, and the teacher's unfinished Add still adds to it", row(d, old) == [['sent', 'new', None, 'teacher']] and row(d, tid) == [['sending', 'add', old, 'teacher']])
    r = tfinish(d, tid, t['files'])
    check("the teacher's Add is finished onto it: 3 pages, all the teacher's", g(r, 'result') == 'sent' and [p[1] for p in pages(d, old)] == ['teacher'] * 3, r)
    check("only the student's four files are queued", queued(d) == fpaths(s1['files']) and sound(d) == '', queued(d))

def case_resend_first(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1)
    t = tstart(d, a, ENR1, 1); tput(d, t.get('files')); tid = t.get('submission_id')
    d.unsend(t1, ENR1, a)
    s3, f3 = d.send(t1, ENR1, a, 2)
    check('after that Unsend the student may send the piece again, and it is handed in', g(f3, 'ok') is True, f3)
    r = tfinish(d, tid, t['files'])
    check("left as Batch B has it: if the student's new send is handed in before the teacher finishes, the teacher's finish is told already_sent and its pages "
          "are dropped (abandoned), as for any new upload a student's send beat (without the fix the Unsend had already dropped it: gone)",
          r == {'result': 'already_sent'} and queued(d, 'abandoned') == fpaths(t['files']), r, differs=True)

def case_replace_them(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1)
    t = tstart(d, a, ENR1, 1, mode='replace'); tput(d, t.get('files'))
    d.unsend(t1, ENR1, a)
    r = tfinish(d, t['submission_id'], t['files'])
    check("left as Batch B has it: a teacher's unfinished Replace Them is still dropped by the student's Unsend (its files queued); its finish answers gone",
          r == {'result': 'gone'} and set(fpaths(t['files'])) <= set(queued(d)), r)
    wipe_tx(d)
    s1, _ = d.send(t1, ENR1, a, 1)
    t = tstart(d, a, ENR1, 1, mode='replace'); tput(d, t.get('files'))
    s2 = d.send_start(t1, ENR1, a, 1, replace=True); d.upload(s2['files']); d.send_finish(t1, ENR1, s2['submission_id'], s2['files'])
    r = tfinish(d, t['submission_id'], t['files'])
    check("and by the student's finished Replace", r == {'result': 'gone'} and set(fpaths(t['files'])) <= set(queued(d)) and len(pages(d, s2['submission_id'])) == 1, r)

def wipe_tx(d):
    """Inside a case's transaction: empty the tables (the transaction is rolled back afterwards anyway)."""
    for st in ('delete from submission', 'delete from student_submit.send_log', 'delete from submission_file_removal'): d.run(st)
    d.storage.remove(d.storage.names()); d.run('delete from submission_file_removal')

def case_two_hours(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1)
    t = tstart(d, a, ENR1, 1); tput(d, t.get('files')); tid = t.get('submission_id')
    d.run("update submission set created_at = created_at - interval '1 hour 59 minutes' where id = :s", s=tid)
    began = d.one('select created_at::text from submission where id = :s', s=tid)
    s2 = d.send_start(t1, ENR1, a, 1, replace=True); d.upload(s2['files']); d.send_finish(t1, ENR1, s2['submission_id'], s2['files'])
    check("an Add moved to the new work by a Replace keeps its first start: one minute left, not given longer",
          row(d, tid) == [['sending', 'add', s2['submission_id'], 'teacher']] and d.one('select created_at::text from submission where id = :s', s=tid) == began, row(d, tid), differs=True)
    d.run("update submission set created_at = created_at - interval '2 minutes' where id = :s", s=tid)
    r = tfinish(d, tid, t['files'])
    check("past its two hours it cannot be finished (gone) and its files are queued as expired, as for any upload",
          r == {'result': 'gone'} and queued(d, 'expired') == fpaths(t['files']), (r, queued(d, 'expired')), differs=True)

def case_two_hours_unsend(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1)
    t = tstart(d, a, ENR1, 1); tput(d, t.get('files')); tid = t.get('submission_id')
    d.run("update submission set created_at = created_at - interval '1 hour 59 minutes' where id = :s", s=tid)
    began = d.one('select created_at::text from submission where id = :s', s=tid)
    d.unsend(t1, ENR1, a)
    check("an Add let go by an Unsend keeps its first start: one minute left, not given longer",
          row(d, tid) == [['sending', 'new', None, 'teacher']] and d.one('select created_at::text from submission where id = :s', s=tid) == began, row(d, tid), differs=True)
    d.run("update submission set created_at = created_at - interval '2 minutes' where id = :s", s=tid)
    r = tfinish(d, tid, t['files'])
    check("past its two hours it cannot be finished (gone) and its files are queued as expired",
          r == {'result': 'gone'} and queued(d, 'expired') == fpaths(t['files']), (r, queued(d, 'expired')), differs=True)

def case_rest_of_upload(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1)
    t = tstart(d, a, ENR1, 2); tput(d, (t.get('files') or [])[:1]); tid = t.get('submission_id')
    d.unsend(t1, ENR1, a)
    put = attempt(lambda: tput(d, t['files'][1:]))
    check("after the Unsend the teacher's browser can still upload the rest of the Add's pages (storage's policy still lets it)", put is None, put, differs=True)
    r = tfinish(d, tid, t['files'])
    check('and finish it: the piece\'s work, the teacher\'s 2 pages', g(r, 'result') == 'sent' and len(pages(d, tid)) == 2, r, differs=True)

def case_other_student(d, k, t1, t2):
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 1); s9, _ = d.send(t2, ENR2, a, 1)
    t = tstart(d, a, ENR2, 1); tput(d, t.get('files')); tid = t.get('submission_id')
    d.unsend(t1, ENR1, a)
    s2 = d.send(t1, ENR1, a, 1)
    check("one student's Unsend and send leave the teacher's Add on another student's work exactly as it was", row(d, tid) == [['sending', 'add', s9['submission_id'], 'teacher']], row(d, tid))

CASES = [case_probe_b, case_add_second, case_replace_fits, case_replace_30_on_more, case_probe_c, case_unsend_kept, case_resend_first,
         case_replace_them, case_two_hours, case_two_hours_unsend, case_rest_of_upload, case_other_student]

def scen_faults(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('fx_faults%d' % fixed, fixed)
    try:
        for case in CASES:
            with tx(d):
                try: case(d, k, t1, t2)
                except Exception as e:
                    ok('%s: the case ran to its end%s' % (case.__name__, '' if fixed else ' (without the fix)'), False, 'ERROR %s %s' % (sqlstate(e), message(e)[:300]))
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
def scen_race(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('fx_race%d' % fixed, fixed); a = k['takes']
    def second_waits(first, second):
        h = Side(d); h.begin(); a1 = attempt(lambda: first(h))
        out = {}; o = Side(d)
        th = threading.Thread(target=lambda: out.setdefault('r', attempt(lambda: second(o)))); th.start(); time.sleep(0.6)
        waited = th.is_alive()
        h.commit(); th.join(20); h.close(); o.close()
        return waited, a1, out.get('r')
    try:
        for order in ('replace first', 'add first'):
            wipe(d)
            s1, _ = d.send(t1, ENR1, a, 1)
            t = tstart(d, a, ENR1, 29); tput(d, t['files'])
            s2 = d.send_start(t1, ENR1, a, 30, replace=True); d.upload(s2['files'])
            rep = lambda x: x.send_finish(t1, ENR1, s2['submission_id'], s2['files'])
            add = lambda x: tfinish(x, t['submission_id'], t['files'])
            if order == 'replace first':
                waited, r1, r2 = second_waits(rep, add)
                check("race, a Replace of 30 and an Add of 29 at once, the Replace first: the Add waits for the class, then is refused too_many_pages, room 0; 30 pages handed in",
                      waited and g(r1, 'ok') is True and r2 == {'result': 'too_many_pages', 'room': 0} and most(d) == 30, (waited, r1, r2, most(d)), differs=True)
                check('and the Add is still there, adding to the new work, none of its files queued',
                      row(d, t['submission_id']) == [['sending', 'add', s2['submission_id'], 'teacher']] and not set(fpaths(t['files'])) & set(queued(d)), differs=True)
            else:
                waited, r1, r2 = second_waits(add, rep)
                check("race, the same with the Add first: the Replace waits, then is refused too_many_pages, room 1; 30 pages handed in",
                      waited and g(r1, 'result') == 'sent' and r2 == {'ok': False, 'error': 'too_many_pages', 'room': 1} and most(d) == 30, (waited, r1, r2, most(d)), differs=True)
                check('and the Replace is still there, unfinished, none of its files queued',
                      row(d, s2['submission_id']) == [['sending', 'replace', s1['submission_id'], 'student']] and queued(d) == [], differs=True)
            check('race (%s): everything that must always hold, holds' % order, sound(d) == '', sound(d))
        for order in ('unsend first', 'add first'):
            wipe(d)
            s1, _ = d.send(t1, ENR1, a, 1)
            t = tstart(d, a, ENR1, 1); tput(d, t['files'])
            un = lambda x: x.unsend(t1, ENR1, a)
            add = lambda x: tfinish(x, t['submission_id'], t['files'])
            if order == 'unsend first':
                waited, r1, r2 = second_waits(un, add)
                check("race, an Unsend and the teacher's Add at once, the Unsend first: the Add waits, then is handed in as the teacher's work; only the student's files are queued",
                      waited and g(r1, 'kept') == 0 and g(r2, 'result') == 'sent' and g(r2, 'submission', 'sent_by') == 'teacher' and queued(d) == fpaths(s1['files']),
                      (waited, r1, r2, queued(d)), differs=True)
            else:
                waited, r1, r2 = second_waits(add, un)
                check("race, the same with the Add first: the Unsend waits, then removes the student's page and keeps the teacher's",
                      waited and g(r1, 'result') == 'sent' and r2 == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 1, 'kept': 1} and queued(d) == fpaths(s1['files']),
                      (waited, r1, r2))
            check('race (%s): everything that must always hold, holds' % order, sound(d) == '', sound(d))
        for order in ('replace first', 'add first'):
            wipe(d)
            s1, _ = d.send(t1, ENR1, a, 2)
            t = tstart(d, a, ENR1, 2); tput(d, t['files'])
            s2 = d.send_start(t1, ENR1, a, 3, replace=True); d.upload(s2['files'])
            rep = lambda x: x.send_finish(t1, ENR1, s2['submission_id'], s2['files'])
            add = lambda x: tfinish(x, t['submission_id'], t['files'])
            waited, r1, r2 = second_waits(*((rep, add) if order == 'replace first' else (add, rep)))
            got = [p[1] for p in pages(d, s2['submission_id'])]
            check("race, a Replace of 3 and an Add of 2 that fit, %s: the second waits; the work ends with the student's 3 new pages and the teacher's 2; only the student's old files queued" % order,
                  waited and got == ['student'] * 3 + ['teacher'] * 2 and queued(d) == fpaths(s1['files']) and sound(d) == '', (waited, r1, r2, got), differs=(order == 'replace first'))
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
SIZES = [1, 1, 2, 3, 5, 8, 12, 15, 20, 25, 28, 29, 30]
def scen_fuzz(fixed=True, seeds=(1, 2, 3, 4), steps=250):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('fx_fuzz%d' % fixed, fixed); a = k['takes']
    total = {'over_30': 0, 'teacher_file_queued_by_student': 0, 'unsound': 0, 'refused_at_finish': 0, 'carried': 0, 'sent': 0}
    first_bad = []
    try:
        for seed in seeds:
            rnd = random.Random(seed); stu = None; tea = None; theirs = set()
            with tx(d):
                for step in range(steps):
                    op = rnd.choice(['s_start', 's_start', 's_finish', 's_finish', 's_unsend', 't_start', 't_start', 't_finish', 't_finish', 't_delete'])
                    if op == 's_start':
                        d.run('delete from student_submit.send_log')
                        r = d.send_start(t1, ENR1, a, rnd.choice(SIZES), replace=rnd.random() < 0.6)
                        if g(r, 'ok'): d.upload(r['files']); stu = r
                    elif op == 's_finish' and stu:
                        n = len(stu['files']); pick = stu['files'][:rnd.randint(1, n)] if rnd.random() < 0.4 else stu['files']
                        had_add = d.one("select count(*) from submission where state = 'sending' and sent_by = 'teacher' and intent = 'add'")
                        r = d.send_finish(t1, ENR1, stu['submission_id'], pick)
                        if err(r) == 'too_many_pages': total['refused_at_finish'] += 1
                        elif g(r, 'ok'):
                            total['sent'] += 1; stu = None
                            if had_add and d.one("select count(*) from submission where state = 'sending' and sent_by = 'teacher' and intent = 'add'"): total['carried'] += 1
                        else: stu = None
                    elif op == 's_unsend':
                        had_add = d.one("select count(*) from submission where state = 'sending' and sent_by = 'teacher'")
                        d.unsend(t1, ENR1, a); stu = None
                        if had_add and d.one("select count(*) from submission where state = 'sending' and sent_by = 'teacher'"): total['carried'] += 1
                    elif op == 't_start':
                        r = tstart(d, a, ENR1, rnd.choice(SIZES), mode=rnd.choice(['add', 'add', 'new']))
                        if r.get('result') == 'ready':
                            tput(d, r['files']); tea = r; theirs |= set(fpaths(r['files']))
                    elif op == 't_finish' and tea:
                        n = len(tea['files']); pick = tea['files'][:rnd.randint(1, n)] if rnd.random() < 0.4 else tea['files']
                        r = tfinish(d, tea['submission_id'], pick)
                        if r.get('result') == 'too_many_pages': total['refused_at_finish'] += 1
                        else:
                            tea = None
                            if r.get('result') == 'sent': total['sent'] += 1
                    elif op == 't_delete' and rnd.random() < 0.3:
                        sid = d.one("select id from submission where state = 'sent' limit 1")
                        if sid: d.rpc('delete_submission(:s, :k)', s=sid, k=nid())
                    m = most(d)
                    bad = d.one("select count(*) from submission_file_removal where reason in ('unsend', 'replace') and path = any(:p)", p=list(theirs))
                    u = sound(d)
                    if m > 30: total['over_30'] += 1
                    if bad: total['teacher_file_queued_by_student'] += 1
                    if u: total['unsound'] += 1
                    if (m > 30 or bad or u) and len(first_bad) < 3: first_bad.append((seed, step, op, m, bad, u))
        print('# fuzz%s: %s' % ('' if fixed else ' WITHOUT the fix', total))
        n = len(seeds) * steps
        check('fuzz: in %d random steps (seeds %s) no work handed in ever has more than 30 pages' % (n, list(seeds)), total['over_30'] == 0, (total, first_bad), differs=True)
        check("fuzz: no file of a page the teacher uploaded is ever queued by a student's Unsend or Replace", total['teacher_file_queued_by_student'] == 0, (total, first_bad), differs=True)
        check("fuzz: Batch B's own invariants hold after every step", total['unsound'] == 0, (total, first_bad))
        if fixed:
            ok('fuzz: the runs reached the new paths: finishes refused for 30 pages, and teacher uploads carried across an Unsend or Replace',
               total['refused_at_finish'] > 0 and total['carried'] > 0 and total['sent'] > 20, total)
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
def procs(d, only=None):
    """pg_proc, column for column, of every function in the app's schemas (or of `only`)."""
    rows = d.all("""select n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ' ', '') || ')',
                           p.oid::bigint, p.proowner::regrole::text, coalesce(p.proacl::text, ''), p.prosecdef, coalesce(p.proconfig::text, ''),
                           p.provolatile::text, p.proargtypes::text, p.prorettype::regtype::text, p.proparallel::text, p.procost::text, p.prolang::bigint,
                           p.prokind::text, p.proisstrict, p.proleakproof, p.proretset, md5(pg_get_functiondef(p.oid))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'student_submit', 'fv_private', 'auth', 'storage')""")
    out = {r[0]: tuple(r[1:]) for r in rows}
    return {s: out[s] for s in only} if only else out
def run_by(d, fn):
    return [r for r in ('anon', 'authenticated', 'public', 'service_role') if d.one("select has_function_privilege(:r, :f::regprocedure, 'execute')", r=r, f=fn)]
def read_only(d, sql):
    d.begin(); d.run('set transaction read only')
    try: return d.all(sql)
    finally: d.rollback()
def stopped_at_guard(d, setup, want, sts=None):
    """The file run after `setup`, all of it undone afterwards: (stopped at its guard saying `want`, the message)."""
    d.begin()
    try:
        for st in setup: d.run(st)
        try:
            for n, st in enumerate(sts or FIX_S):
                at = n
                if last(st) not in ('begin', 'commit'): d.run(st)
            return False, 'it ran'
        except Exception as e:
            return at == 2 and want in message(e) and 'Nothing was changed' in message(e), message(e)[:300]
    finally:
        d.rollback()
def busy(d, k, t1, t2):
    """Work in every state, committed: a student's work with a page of the teacher's, the student's unfinished Replace of
    it, the teacher's unfinished Add on it, another student's unfinished send, a paper hand-in."""
    a = k['takes']
    s1, _ = d.send(t1, ENR1, a, 2); d.teacher_upload(a, ENR1, 1, mode='add')
    rep = d.send_start(t1, ENR1, a, 2, replace=True); d.upload(rep['files'])
    t = tstart(d, a, ENR1, 1); tput(d, t['files'])
    s2 = d.send_start(t2, ENR2, a, 1); d.upload(s2['files'])
    d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['nothing'], e=[ENR2], k=nid())
    return {'rep': rep, 't': t, 's1': s1, 's2': s2}

PRE = split(text_of('batch-b-fixes-live-precheck.sql'))[0]
POST = split(text_of('batch-b-fixes-live-postcheck.sql'))[0]
B_POST = split(text_of('batch-b-live-postcheck.sql'))[0]
LATER = ('assessments that take work', 'classes with Send Work on')     # rows Batch B's post-check expects once teachers use it
def b_post(d): return [x for x in read_only(d, B_POST) if x[0] not in LATER]
B_UNDO = split(text_of(UNDO_B))
def parts(sts):
    """A script's transactions, each a list of its statements (begin and commit included)."""
    out, cur = [], None
    for st in sts:
        if last(st) == 'begin': cur = [st]
        elif cur is not None:
            cur.append(st)
            if last(st) == 'commit': out.append(cur); cur = None
    return out

def scen_apply():
    d, k, t1, t2 = world('fx_apply', False)
    try:
        # ── The file's shape ────────────────────────────────────────────
        ok('the file is one transaction: begin first, commit last, and only comments outside them',
           last(FIX_S[0]) == 'begin' and last(FIX_S[-1]) == 'commit' and sum(last(s) in ('begin', 'commit') for s in FIX_S) == 2
           and all(l.strip() == '' or l.strip().startswith('--') for l in FIX_T.split('\nbegin;\n')[0].split('\n'))
           and FIX_T.rstrip().endswith('\ncommit;'), [last(s) for s in FIX_S][:3])
        ok('it sets a lock timeout, then runs its check before it changes anything',
           FIX_S[1].strip().lower().endswith("set local lock_timeout = '5s'") and '$guard$' in FIX_S[2] and 'create ' not in bare(FIX_S[2]).lower())
        kinds = [re.sub(r'\s+', ' ', bare(s).strip().lower())[:26] for s in FIX_S[1:-1]]
        ok('between them only: the lock timeout, two checks (do), three CREATE OR REPLACE FUNCTION and the schema reload',
           kinds[0].startswith('set local lock_timeout') and sum(x.startswith('do ') for x in kinds) == 2
           and sum(x.startswith('create or replace function') for x in kinds) == 3 and kinds[-1].startswith('notify pgrst') and len(kinds) == 7, kinds)
        ok('no revoke, grant, alter, drop, insert, update of a table outside the function bodies, no TODO',
           not re.search(r'^\s*(revoke|grant|alter|drop|insert|update|delete|truncate)\b', '\n'.join(bare(s) for s in FIX_S if not bare(s).strip().lower().startswith('create or replace function')), re.I | re.M)
           and 'TODO' not in FIX_T and 'PLACEHOLDER' not in FIX_T)
        made = [re.search(r'create or replace function ([\w.]+)\(', s).group(1) for s in FIX_S if bare(s).strip().lower().startswith('create or replace function')]
        ok('the three it replaces are finish_work_upload, send_finish and unsend, and the header names each', made == ['public.finish_work_upload', 'student_submit.send_finish', 'student_submit.unsend']
           and all(m in FIX_T.split('\nbegin;\n')[0] for m in made), made)
        # Each body is Batch B's with lines added and none taken away or changed.
        M1_T = text_of(M1)
        def body(t, name):
            i = t.index('create or replace function ' + name + '('); return t[i:t.index('$function$;\n', i)].split('\n')
        diffs = {m: [l for l in difflib.unified_diff(body(M1_T, m), body(FIX_T, m), lineterm='', n=0) if l[:1] in '+-' and l[:3] not in ('+++', '---')] for m in made}
        ok("each of the three is Batch B's own body with lines added only: no line of it taken out or changed",
           all(diffs[m] and all(l.startswith('+') for l in diffs[m]) for m in made), {m: [l for l in v if l.startswith('-')] for m, v in diffs.items()})
        added = {m: [l[1:].strip() for l in diffs[m] if not l[1:].strip().startswith('--')] for m in made}
        print('# the lines each fix adds, comments aside: %s' % json.dumps(added, indent=1))
        lists = fingerprint_lists(FIX_T)
        ok("its lists: Batch B's 44 as 8c36fe48 leaves them (the first file's own list), and the three as it leaves them, in its first check and its last",
           len(lists) == 4 and dict(lists[0]) == BATCHB and lists[0] == lists[2] and lists[1] == lists[3] and [f for f, _ in lists[1]] == REPLACED
           and list(dict(lists[0])) == B_FUNCTIONS, [len(x) for x in lists])
        # ── The read-only pre-check, on Batch B as live will have it ────
        ok('the pre-check, on a database with Batch B as reviewed: no rows', read_only(d, PRE) == [], read_only(d, PRE))
        # ── Each guard stops it, with nothing changed ───────────────────
        base = WorkDb('fx_base')
        try:
            r = base.apply_fixes()
            ok('on a database without Batch B the file stops at its first check and says so, nothing changed', r.startswith('STOPPED') and base.at == 2 and 'Batch B is not applied' in r, r)
        finally:
            base.close()
        good_n = 0; bad = []
        for fn in B_FUNCTIONS:
            new = retouched(d, fn)
            if new == d.one('select pg_get_functiondef(to_regprocedure(:s))', s=fn):
                new = d.one('select pg_get_functiondef(to_regprocedure(:s))', s=fn).replace('AS $function$\n', 'AS $function$\n\n', 1)
            good, said = stopped_at_guard(d, [new], fn)
            if good: good_n += 1
            else: bad.append((fn, said))
        ok('each of Batch B\'s 44 functions with another body (a space or a line more) stops the file at its first check, naming it, nothing changed', good_n == 44, bad[:3])
        good, said = stopped_at_guard(d, ['drop function student_submit.file_links(text,uuid,uuid,text)'], 'student_submit.file_links')
        ok('one of them missing: stops', good, said)
        # A lock it cannot get: another session is replacing send_finish and has not committed.
        h = Side(d); h.begin(); h.run(d.one("select pg_get_functiondef('student_submit.send_finish(text,uuid,uuid,jsonb,text)'::regprocedure)"))
        cat0 = catalog(d.c); t0 = time.time(); r = d.apply_fixes(); took = time.time() - t0
        h.c.run('rollback'); h.close()
        ok('while another session holds one of the three functions, the file gives up after five seconds with nothing applied', r.startswith('STOPPED') and 'lock timeout' in r and 4.5 < took < 9 and catalog(d.c) == cat0, (r, took))
        # ── The apply, on a database in use ─────────────────────────────
        w = busy(d, k, t1, t2)
        cat0 = catalog(d.c); cols0 = table_columns(d.c); rows0 = row_checksums(d.c, cols0); p0 = procs(d)
        who0 = {fn: run_by(d, fn) for fn in REPLACED}
        r = d.apply_fixes()
        ok('the file applies to a database in use', r == 'ok', r)
        ok('no row of any table changes', row_checksums(d.c, cols0) == rows0)
        gone, new = differences(cat0, catalog(d.c))
        ok('in the whole catalog only the three functions\' definitions differ: two lines each, the whole definition and its source', len(gone) == 6 and len(new) == 6
           and all(any((' ' + f.split('(')[0] + '(') in l.split(' | ')[0] for f in REPLACED) for l in gone + new), (gone, new))
        p1 = procs(d)
        ok('each of the three keeps its oid, owner, grants, SECURITY DEFINER, search_path, volatility, arguments, result, language and the rest of pg_proc; only the body differs',
           all(p1[f][:-1] == p0[f][:-1] and p1[f][-1] != p0[f][-1] for f in REPLACED), {f: (p0[f][:6], p1[f][:6]) for f in REPLACED})
        ok('every other function in the database is untouched', {f: v for f, v in p1.items() if f not in REPLACED} == {f: v for f, v in p0.items() if f not in REPLACED})
        ok('who may run the three is what it was: finish_work_upload signed-in teachers and the service role, send_finish and unsend the service role only; anon gains nothing',
           {fn: run_by(d, fn) for fn in REPLACED} == who0 == {REPLACED[0]: ['authenticated', 'service_role'], REPLACED[1]: ['service_role'], REPLACED[2]: ['service_role']}, who0)
        ok("the three carry the fingerprints its list says, and the other 41 Batch B's", {f: p1[f][-1] for f in B_FUNCTIONS} == dict(BATCHB, **dict(lists[1])))
        ok('the post-check, after it: no rows', read_only(d, POST) == [], read_only(d, POST))
        got = b_post(d)
        ok("Batch B's own post-check now lists the three functions it replaced, and nothing else", sorted(r_[0] for r_ in got) == sorted('function ' + f for f in REPLACED), got)
        pre_now = read_only(d, PRE)
        ok('the pre-check, after it: one row for each of the three, saying it is already applied, that the file would not stop on',
           sorted((x[0], x[3]) for x in pre_now) == sorted(('function ' + f, 'no') for f in REPLACED) and all('already as 2026111104' in x[2] for x in pre_now), pre_now)
        # Work that was in progress when it was applied.
        f = d.send_finish(t1, ENR1, w['rep']['submission_id'], w['rep']['files'])
        ok("a student's Replace started before the apply is handed in after it, and the teacher's Add started before it now adds to the new work",
           g(f, 'ok') is True and row(d, w['t']['submission_id']) == [['sending', 'add', w['rep']['submission_id'], 'teacher']], (f, row(d, w['t']['submission_id'])))
        ok('everything that must always hold, holds', sound(d) == '', sound(d))
        # ── A second run, and Batch B's first file again ────────────────
        cat2 = catalog(d.c); rows2 = row_checksums(d.c, cols0)
        r = d.apply_fixes()
        ok('a second run applies and changes no catalog line and no row', r == 'ok' and (catalog(d.c), row_checksums(d.c, cols0)) == (cat2, rows2), r)
        r = d.file(M1)
        ok("Batch B's first file run again now stops at its first check (\"do not run this file again\"), naming one of the three, nothing changed",
           r.startswith('STOPPED') and d.at == 2 and 'do not run this file again' in r and any(f in r for f in REPLACED) and catalog(d.c) == cat2, r)
        r = d.file(M2)
        ok("Batch B's second file run again still applies (it compares only the three policy functions)", r == 'ok' and catalog(d.c) == cat2, r)
        # ── Damage the post-check notices ───────────────────────────────
        for label, setup, want in (
                ('one of the three with another body', [retouched(d, REPLACED[1])], 'function ' + REPLACED[1]),
                ('one of the other 41 with another body', [retouched(d, 'student_submit._grading_started(uuid,uuid)')], 'function student_submit._grading_started(uuid,uuid)'),
                ('send_finish runnable by signed-in teachers', ['grant execute on function student_submit.send_finish(text,uuid,uuid,jsonb,text) to authenticated'], 'how ' + REPLACED[1] + ' is run'),
                ('finish_work_upload taken from signed-in teachers', ['revoke execute on function public.finish_work_upload(uuid,jsonb,uuid) from authenticated'], 'how ' + REPLACED[0] + ' is run'),
                ('unsend made SECURITY INVOKER', ['alter function student_submit.unsend(text,uuid,uuid,text) security invoker'], 'how ' + REPLACED[2] + ' is run'),
                ('unsend without pg_temp in its search_path', ['alter function student_submit.unsend(text,uuid,uuid,text) set search_path = public, student_submit'], 'SECURITY DEFINER without pg_temp last in its search_path'),
                ('unsend owned by another role', ['alter function student_submit.unsend(text,uuid,uuid,text) owner to service_role'], 'how ' + REPLACED[2] + ' is run'),
                ('work handed in with 31 pages', ["""insert into submission_file (id, submission_id, page, path, thumb_path, added_by, declared_bytes, declared_thumb_bytes, link_dies_at)
                                                     select f.id, s.id, 100 + g, s.course_id || '/x/' || f.id || '.jpg', s.course_id || '/x/' || f.id || '-thumb.jpg', 'teacher', 1, 1, now()
                                                       from submission s cross join generate_series(1, 31) g cross join lateral (select gen_random_uuid() as id, g as n) f
                                                      where s.state = 'sent' and not s.on_paper"""], 'handed-in work with more than 30 pages')):
            d.begin()
            try:
                for st in setup: d.run(st)
                got = [x[0] for x in d.all(POST)]
            finally:
                d.rollback()
            ok('the post-check notices %s' % label, want in got, got)
        # ── The pre-check notices ───────────────────────────────────────
        d2 = WorkDb('fx_apply_pre', template=template(False))
        try:
            for label, setup, want, stops in (
                    ('one of the 41 with another body', [retouched(d2, 'public._work_class_full(uuid,jsonb)')], 'function public._work_class_full(uuid,jsonb)', 'yes'),
                    ('one of the three with another body', [retouched(d2, REPLACED[0])], 'function ' + REPLACED[0], 'yes'),
                    ('unsend runnable by anon', ['grant execute on function student_submit.unsend(text,uuid,uuid,text) to anon'], 'how ' + REPLACED[2] + ' is run', 'no')):
                d2.begin()
                try:
                    for st in setup: d2.run(st)
                    got = [(x[0], x[3]) for x in d2.all(PRE)]
                finally:
                    d2.rollback()
                ok('the pre-check notices %s (stops: %s)' % (label, stops), (want, stops) in got, got)
            k2 = seed_work(d2); tk, _ = d2.session(ENR1)
            d2.begin()
            s = d2.send_start(tk, ENR1, k2['takes'], 30, replace=False); d2.upload(s['files']); d2.send_finish(tk, ENR1, s['submission_id'], s['files'])
            tt = tstart(d2, k2['takes'], ENR2, 1, mode='new')
            d2.run("update submission_file set submission_id = (select id from submission where state = 'sent'), page = 31 where submission_id = :s", s=tt['submission_id'])
            got = d2.all(PRE); d2.rollback()
            ok('the pre-check lists work already handed in with more than 30 pages (the fix changes no existing row, so it would stay)',
               [x[0] for x in got] == ['handed-in work with more than 30 pages'] and '31 pages' in got[0][2], got)
        finally:
            d2.close()
        # ── The first file alone (Batch B's safe state) ─────────────────
        d3 = WorkDb('fx_apply_m1', template=template(False, only_m1=True))
        try:
            r = d3.apply_fixes()
            ok("with only Batch B's first file in (its safe state, no bucket) the file applies too", r == 'ok' and read_only(d3, POST) == [], r)
        finally:
            d3.close()
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_undo():
    UNDO_S = split(text_of(UNDO_FIXES))
    d, k, t1, t2 = world('fx_undo', False)
    try:
        ok('the undo is one transaction: begin first, commit last, a lock timeout, its check, the three functions, its last check',
           last(UNDO_S[0]) == 'begin' and last(UNDO_S[-1]) == 'commit' and UNDO_S[1].strip().lower().endswith("set local lock_timeout = '5s'")
           and '$guard$' in UNDO_S[2] and sum(bare(s).strip().lower().startswith('create or replace function') for s in UNDO_S) == 3)
        M1_T = text_of(M1)
        ok("its three bodies are the first file's, character for character", all(
            M1_T[M1_T.index('create or replace function ' + m + '('):M1_T.index('$function$;\n', M1_T.index('create or replace function ' + m + '('))] in text_of(UNDO_FIXES)
            for m in ('public.finish_work_upload', 'student_submit.send_finish', 'student_submit.unsend')))
        lists = fingerprint_lists(text_of(UNDO_FIXES))
        ok('its lists are the file\'s', dict(lists[0]) == BATCHB and lists[1] == fingerprint_lists(FIX_T)[1] and lists[2] == lists[0], len(lists))
        cat_b = catalog(d.c); p_b = procs(d)
        r = d.file(UNDO_FIXES)
        ok('run where the fix was never applied: it applies and changes nothing', r == 'ok' and catalog(d.c) == cat_b, r)
        ok('the file applies', d.apply_fixes() == 'ok')
        # Work in progress across the undo: an Add the fix carried across an Unsend, another across a Replace.
        a = k['takes']
        s1, _ = d.send(t1, ENR1, a, 1); ta = tstart(d, a, ENR1, 1); tput(d, ta['files']); d.unsend(t1, ENR1, a)
        s2, _ = d.send(t2, ENR2, a, 1); tb = tstart(d, a, ENR2, 1); tput(d, tb['files'])
        rp = d.send_start(t2, ENR2, a, 1, replace=True); d.upload(rp['files']); d.send_finish(t2, ENR2, rp['submission_id'], rp['files'])
        cols = table_columns(d.c); rows1 = row_checksums(d.c, cols)
        r = d.file(UNDO_FIXES)
        ok('the undo runs', r == 'ok', r)
        ok("the three carry Batch B's fingerprints again, and all 44 are as 8c36fe48 left them", fingerprints(d, B_FUNCTIONS) == BATCHB)
        ok('every function in the database is as before the fix, pg_proc column for column (the same oid, owner, grants, settings)', procs(d) == p_b)
        ok('the whole catalog is as before the fix, line for line', catalog(d.c) == cat_b, differences(cat_b, catalog(d.c)))
        ok('no row of any table changed', row_checksums(d.c, cols) == rows1)
        ok("Batch B's own post-check is silent again (but for the two rows it expects once a class sends work)", b_post(d) == [], b_post(d))
        ok('the fix\'s post-check lists the three functions', sorted(x[0] for x in read_only(d, POST)) == sorted('function ' + f for f in REPLACED))
        ra = tfinish(d, ta['submission_id'], ta['files']); rb = tfinish(d, tb['submission_id'], tb['files'])
        ok('work in progress is not lost: with the old bodies the Add carried across the Unsend is handed in as the teacher\'s, the one carried across the Replace onto the new work',
           g(ra, 'result') == 'sent' and g(ra, 'submission', 'sent_by') == 'teacher' and g(rb, 'result') == 'sent' and g(rb, 'submission', 'id') == rp['submission_id'] and sound(d) == '', (ra, rb))
        cat3 = catalog(d.c)
        r = d.file(UNDO_FIXES)
        ok('the undo a second time: runs, changes nothing', r == 'ok' and catalog(d.c) == cat3, r)
        ok('the file applies again after the undo, and its post-check is silent', d.apply_fixes() == 'ok' and read_only(d, POST) == [])
        for fn in ('student_submit._work_window(uuid)', REPLACED[2]):
            good, said = stopped_at_guard(d, [retouched(d, fn)], fn, sts=UNDO_S)
            ok('the undo stops at its check, nothing changed, when %s has another body' % fn.split('(')[0], good, said)
        base = WorkDb('fx_undo_base')
        try:
            r = base.file(UNDO_FIXES)
            ok('the undo on a database without Batch B stops and says so', r.startswith('STOPPED') and 'Batch B is not applied' in r, r)
        finally:
            base.close()
        # ── The order out, and Batch B's PART 1B way back ───────────────
        P1, P1B, P2 = parts(B_UNDO)
        wipe(d)
        d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute'")
        r = d.statements(P2)
        ok("with the fix applied, Batch B's own undo PART 2 refuses at its first check, nothing changed (it wants Batch B's bodies)",
           r.startswith('STOPPED') and 'is not as Batch B leaves it' in r and any(f in r for f in REPLACED), r)
        r = d.statements(P1); r2 = d.statements(P1B)
        ok("PART 1 and PART 1B of Batch B's undo run with the fix applied", r == 'ok' and r2 == 'ok', (r, r2))
        r = d.file(M1)
        ok("PART 1B's way back (the first file run again) stops while the fix is applied", r.startswith('STOPPED') and 'do not run this file again' in r, r)
        r = d.file(UNDO_FIXES); r2 = d.file(M1); r3 = d.apply_fixes()
        ok('the way back with the fix in: its undo, then the first file (the four triggers back), then the fix again', r == r2 == r3 == 'ok'
           and d.one("select count(*) from pg_trigger where tgname in ('submission_gone', 'submission_truncate')") == 4 and read_only(d, POST) == [], (r, r2, r3))
        r = d.file(UNDO_FIXES); r2 = d.statements(P2)
        ok("the order out: the fix's undo, then Batch B's PART 2 runs", r == 'ok' and r2 == 'ok' and d.one("select to_regclass('public.submission')") is None, (r, r2))
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def write_lists(text, lists):
    out = []; pos = 0
    for m in BEGIN.finditer(text):
        which = m.group(2)
        if which not in lists: continue
        end = text.index('-- FINGERPRINTS-END', m.end()); end_line = text.rfind('\n', 0, end)
        rows = lists[which]; ind = m.group(1); width = max(len(x) for x in rows) + 3
        body = ',\n'.join("%s(%s '%s')" % (ind, ("'%s'," % x).ljust(width), v) for x, v in rows.items())
        out.append(text[pos:m.end()] + '\n' + body); pos = end_line
    return ''.join(out) + text[pos:]

def cmd_fingerprints(check_only):
    d = WorkDb('fx_fp', template=template(False))
    try:
        r = d.statements(split(MARK.sub(lambda m: m.group(1) + "            ('public.no_such_function_at_all()', 'absent')" + m.group(3), text_of(FIXES))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        fixes = fingerprints(d, REPLACED)
    finally:
        d.close()
    lists = {'batchb': BATCHB, 'fixes': fixes}; stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel); was = open(path).read(); now = write_lists(was, lists)
        if now != was:
            stale.append(rel)
            if not check_only: open(path, 'w').write(now)
    print(json.dumps(fixes, indent=1))
    if check_only: print('stale: ' + ', '.join(stale) if stale else 'every list is current'); return 1 if stale else 0
    print('rewritten: ' + (', '.join(stale) or 'nothing (every list was current)')); return 0

# ── Wrong versions of the two fixes: does this suite notice? ────────────────
F = FIXES
MUTANTS = [
    ('a Replace is not asked the 30 again at its finish', F,
     "        if _theirs + jsonb_array_length(p_files) > 30 then\n            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));\n        end if;\n", ''),
    ("a Replace's finish allows 31", F, '        if _theirs + jsonb_array_length(p_files) > 30 then', '        if _theirs + jsonb_array_length(p_files) > 31 then'),
    ("a Replace's finish counts the student's old pages too", F,
     "where f.submission_id = _target.id and f.added_by = 'teacher';\n        if _theirs", "where f.submission_id = _target.id;\n        if _theirs"),
    ('a Replace refused for 30 pages is dropped', F,
     "        if _theirs + jsonb_array_length(p_files) > 30 then\n            return",
     "        if _theirs + jsonb_array_length(p_files) > 30 then\n            delete from submission where id = _sub.id;\n            return"),
    ("an Add is not asked the 30 again at its finish", F,
     "        if _pages + jsonb_array_length(p_files) > 30 then\n            return jsonb_build_object('result', 'too_many_pages', 'room', greatest(30 - _pages, 0));\n        end if;\n", ''),
    ("an Add's finish refuses exactly 30", F, '        if _pages + jsonb_array_length(p_files) > 30 then', '        if _pages + jsonb_array_length(p_files) >= 30 then'),
    ("an Add's finish counts only the teacher's pages on the work", F,
     "_pages := (select count(*) from submission_file f where f.submission_id = _target.id);",
     "_pages := (select count(*) from submission_file f where f.submission_id = _target.id and f.added_by = 'teacher');"),
    ("an Add's too_many_pages is remembered", F,
     "            return jsonb_build_object('result', 'too_many_pages', 'room', greatest(30 - _pages, 0));",
     "            perform fv_idem_store(p_idempotency_key, 'finish_work_upload', jsonb_build_object('result', 'too_many_pages', 'room', greatest(30 - _pages, 0)));\n            return jsonb_build_object('result', 'too_many_pages', 'room', greatest(30 - _pages, 0));"),
    ("a Replace's finish drops the teacher's unfinished Add again (not moved)", F,
     "        update submission set target_id = _sub.id\n         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';\n", ''),
    ("a Replace's finish moves the teacher's unfinished Replace Them too", F,
     "         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';",
     "         where target_id = _target.id and state = 'sending' and sent_by = 'teacher';"),
    ("a Replace's finish moves the Add only after the old work is deleted (too late)", F,
     "        update submission set target_id = _sub.id\n         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';\n        perform set_config('fv.work_removal_reason', 'replace', true);\n        delete from submission where id = _target.id;\n",
     "        perform set_config('fv.work_removal_reason', 'replace', true);\n        delete from submission where id = _target.id;\n        update submission set target_id = _sub.id\n         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';\n"),
    ("an Unsend drops the teacher's unfinished Add again (not let go)", F,
     "        update submission set intent = 'new', target_id = null\n         where target_id = _sent.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';\n", ''),
    ("an Unsend lets the teacher's unfinished Replace Them go free too", F,
     "         where target_id = _sent.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';\n        delete from submission where id = _sent.id;",
     "         where target_id = _sent.id and state = 'sending' and sent_by = 'teacher';\n        delete from submission where id = _sent.id;"),
    ("an Unsend lets the Add go free but moves its start (more than two hours)", F,
     "        update submission set intent = 'new', target_id = null\n         where target_id = _sent.id",
     "        update submission set intent = 'new', target_id = null, created_at = now()\n         where target_id = _sent.id"),
]

def cmd_mutate(wanted):
    import subprocess, tempfile
    tmp = tempfile.mkdtemp(prefix='batch-b-fixes-mutate-'); text = text_of(FIXES); unnoticed = []
    for n, (label, which, old, new) in enumerate(MUTANTS, 1):
        if wanted and n not in wanted: continue
        if text.count(old) != 1:
            print('%2d  CANNOT MAKE THIS CHANGE (its text is in the file %d times): %s' % (n, text.count(old), label)); unnoticed.append(n); continue
        body = MARK.sub(lambda m: m.group(1) + "            ('public.no_such_function_at_all()', 'absent')" + m.group(3), text.replace(old, new))
        path = os.path.join(tmp, 'm%d.sql' % n); open(path, 'w').write(body)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'submissions_fixes.py'), 'faults', 'race', 'fuzz'], capture_output=True, text=True, cwd=HERE,
                           env=dict(os.environ, BATCH_B_FIXES_FILE=path))
        fails = [l[5:].split(' :: ')[0] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        if fails: print('%2d  noticed by %3d checks  %s\n      first: %s' % (n, len(fails), label, fails[0][:170]))
        elif r.returncode != 0: print('%2d  noticed: the suite stopped  %s\n      %s' % (n, label, (r.stderr.strip().splitlines() or ['?'])[-1][:170]))
        else: print('%2d  NOT NOTICED  %s' % (n, label)); unnoticed.append(n)
        sys.stdout.flush()
    print('%d changes, %d not noticed%s' % (len(wanted) or len(MUTANTS), len(unnoticed), ': ' + ', '.join(map(str, unnoticed)) if unnoticed else ''))
    return 1 if unnoticed else 0

SCENARIOS = {'faults': scen_faults, 'faults-without': lambda: scen_faults(False), 'race': scen_race, 'race-without': lambda: scen_race(False),
             'fuzz': scen_fuzz, 'fuzz-without': lambda: scen_fuzz(False), 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    import traceback
    args = sys.argv[1:]
    if args[:1] == ['fingerprints']:
        try: sys.exit(cmd_fingerprints(args[1:] == ['check']))
        finally: drop_templates()
    if args[:1] == ['mutate']:
        sys.exit(cmd_mutate([int(x) for x in args[1:]]))
    try:
        for name in (args or list(SCENARIOS)):
            try: SCENARIOS[name]()
            except Exception:
                ok('the %s scenario ran to its end' % name, False, ' | '.join(traceback.format_exc().strip().splitlines()[-3:]))
    finally:
        drop_templates()
    finish()
