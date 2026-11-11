"""Batch B send rules: migrations/2026111130_student_send_rules.sql, applied
after Batch B's two files, its review fixes (2026111104) and Batch C's two
files (2026111120, 2026111121). Colin's rulings of Nov 11, 2026:

  ruling 106  a send started while a piece was taking work can be finished
              within its two hours after the piece's last day has ended,
              and is marked Late (it was refused, work_closed);
  ruling 107  after an Unsend that leaves the teacher's pages, and on work
              the teacher added with Add Work, the student can send again:
              their new pages join the teacher's, by the rule a Replace
              follows (it was refused, already_sent; for ever).

The base is batch_c_common's (live as it will be with Batch B and the fixes;
see the top of batch_c_common.py for BATCH_B_DIR), with C1 and C2 applied
here on top, in the apply order:

    PGDATABASE=sr python3 batch_c_common.py build   an EMPTY database: live with Batch B and the fixes
    PGDATABASE=sr python3 send_rules.py             every scenario below
    PGDATABASE=sr python3 send_rules.py rule106 ... or some
    PGDATABASE=sr python3 send_rules.py fingerprints [check]   write (or check) the lists the four files carry
    PGDATABASE=sr python3 send_rules.py mutate [n ...]          wrong versions of the file: are they noticed?

  rule106, rule107  Each rule, case by case. Checks marked "differs" must
                    fail without the file: rule106-without and
                    rule107-without run the same cases on the base and pass
                    only if each of them fails there and every other check
                    holds there too.
  interleave        Every order of a student's send or Replace with the
                    teacher's Add Work, Add as More Pages, Replace Them,
                    delete and Handed In on Paper that this harness can
                    make, one connection: after each, nothing handed in has
                    more than 30 pages and Batch B's invariants hold.
                    interleave-without: the first check of each case (the
                    one the file changes) must fail on the base.
  race              The same on connections of their own: the first holds
                    the class, the second is seen to wait.
  fuzz              Seeded random runs of the student's and the teacher's
                    calls on one piece: never more than 30 pages, Batch B's
                    invariants, and no teacher's page queued by a student.
  apply             The file's shape, its lists, each guard, a lock it
                    cannot get, the apply on a database in use (no row
                    changes; only the three functions' bodies change),
                    a second run, the files before it run again, the
                    read-only pre-check and post-check and what each notices.
  undo              send-rules-undo.sql: the three back, by fingerprint and
                    pg_proc column for column; nothing else changes; work in
                    progress; the order out with the undo files before it.

The database named by PGDATABASE is only a template: every scenario runs on
a copy.
"""
import difflib, random, threading, time
from contextlib import suppress
class Skip(Exception): pass
from submissions_common import WorkDb, Side, attempt, seed_work, Storage
from batch_c_common import *
import batch_c_common as bc
from submissions import sound, queued

FILE = '../2026111130_student_send_rules.sql'
FILE_USED = os.environ.get('SEND_RULES_FILE') or FILE
MUTATED = FILE_USED != FILE
UNDO = 'send-rules-undo.sql'
PRE = 'send-rules-live-precheck.sql'
POST = 'send-rules-live-postcheck.sql'
LIST_FILES = [FILE, UNDO, PRE, POST]
REPLACED = ['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
            'student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'student_submit.work(text,uuid,text)']
NEW = ['student_submit.send_paths(text,uuid,uuid,text)']   # section 4, approved by Colin Nov 11
RELIED = ['student_submit._work_window(uuid)', 'student_submit._grading_started(uuid,uuid)', 'student_submit._send_session(text,uuid)',
          'student_submit._session_class(text,uuid)', 'student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',
          'student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)', 'student_submit.unsend(text,uuid,uuid,text)',
          'public.finish_work_upload(uuid,jsonb,uuid)', 'public._fv_timezone(text)', 'public._grade_return_lock_first(uuid)',
          'public._work_hold()', 'public._work_bucket()', 'public._work_check_pages(jsonb)', 'public._work_check_files(jsonb)',
          'public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', 'public._work_drop_expired(uuid)',
          'public._work_class_full(uuid,jsonb)', 'public._work_files_state(uuid,jsonb)', 'public._work_settle_files(uuid,jsonb)',
          'public._work_upload_json(uuid)', 'public._submission_target_gone()',
          # Batch C as tested (round 3, a682b559): what makes a version 2 and when a request is open (C1), and C2's
          # trigger functions. The new lines call none of them; listed so the file stops unless C1 and C2 are both in,
          # as tested. C1's _revision_gone (round 3) runs when send_finish's join deletes a teacher's sent version 2;
          # C2's _markup_on_release (round 3) pins C2's third round.
          'public._revision_state(uuid)', 'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          'student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'public._revision_gone()',
          'public._markup_on_return()', 'public._markup_on_release()']
BEGIN = re.compile(r'^([ \t]*)-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*$', re.M)
LISTS = re.compile(r'-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*\n(.*?)\n[ \t]*-- FINGERPRINTS-END', re.S)
last = lambda st: st.split('\n')[-1].strip().lower()

def lists_of(text):
    """[(name, [(fn, md5, ...)])] for every list the text carries."""
    return [(m.group(1), [tuple(x) for x in re.findall(r"\('([^']+)',\s*'([0-9a-f]{32}|absent)'(?:,\s*'([0-9a-f]{32}|absent)')?\)", m.group(2))])
            for m in LISTS.finditer(text)]
def neutral(text):
    """The text with every list stood aside, so it applies whatever the lists hold."""
    def row(m):
        three = m.group(2) == 'replaces'
        return m.group(0).split('\n')[0] + '\n' + m.group(1) + ("('public.no_such_function_at_all()', 'absent', 'absent')" if three else "('public.no_such_function_at_all()', 'absent')")
    out = []; pos = 0
    for m in BEGIN.finditer(text):
        end = text.index('-- FINGERPRINTS-END', m.end()); end_line = text.rfind('\n', 0, end)
        out.append(text[pos:m.start()] + row(m)); pos = end_line
    return ''.join(out) + text[pos:]

# ── templates: the base (B, fixes, C1, C2), with or without this file ───────
_TPL = {}
def template(fixed):
    if fixed in _TPL: return _TPL[fixed]
    name = '%s_sr%s%d' % (cc.BASE_DB, 'm' if MUTATED else '', int(fixed))
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in [C1, C2] + ([FILE_USED] if fixed else []):
        text = text_at(rel)
        if rel == FILE_USED and MUTATED: text = neutral(text)
        for st in split(text):
            try: c.run(st)
            except Exception as e:
                c.close(); ok('%s applies to the template' % os.path.basename(rel), False, message(e)); finish()
    c.close(); _TPL[fixed] = name
    return name
def drop_templates():
    for name in _TPL.values(): admin('drop database if exists "%s" with (force)' % name)

def world(tag, fixed):
    d = WorkDb('sr_' + tag, template=template(fixed)); k = seed_work(d)
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
def tadd(x, a, e, n, mode='add'):
    """A teacher's whole upload: (start, finish)."""
    s = tstart(x, a, e, n, mode)
    if s.get('result') != 'ready': return s, None
    tput(x, s['files']); return s, tfinish(x, s['submission_id'], s['files'])
def most(x): return x.one("select coalesce(max(n), 0) from (select count(f.id) as n from submission s join submission_file f on f.submission_id = s.id where s.state = 'sent' group by s.id) z")
def pages(x, sid): return [tuple(r) for r in x.all('select page, added_by, id::text from submission_file where submission_id = :s order by page', s=sid)]
def who(x, sid): return [p[1] for p in pages(x, sid)]
def row(x, sid): return x.all('select state, intent, target_id::text, sent_by from submission where id = :s', s=sid)
def sent(x, e=ENR1): return x.all("select id::text, sent_by, on_paper, note, followed_plan, is_late, version, card_id::text, request_id::text from submission where enrollment_id = :e and state = 'sent' order by version", e=e)
def piece(x, tok, e, a): return next((w for w in (g(x.work(tok, e), 'assessments') or []) if w.get('id') == a), {})
def nocan(w):
    """can_send is false (without the file there is no can_send at all)."""
    return g(w, 'sent', 'can_send') is (False if MODE['fixed'] else None)
def snap(x):
    """Every row a send can touch: submissions, their pages, the revision requests, the delete queue."""
    return (x.all('select id::text, state, intent, target_id::text, version, sent_by, is_late from submission order by id'),
            x.all('select id::text, submission_id::text, page, added_by from submission_file order by id'),
            x.all('select id::text, state, revision_in_at::text, closed_at::text from revision_request order by id'), queued(x))
def card_of(x, e): return x.one('select id::text from student_card where enrollment_id = :e and stopped_at is null', e=e)
def draft(x, a, e=ENR1, v=5): return x.rpc('upsert_score(:e, :a, :v)', e=e, a=a, v=v)
def fresh(d):
    for st in ('delete from submission', 'delete from student_submit.send_log', 'delete from fv_idempotency', 'delete from grade_return',
               'delete from score', 'delete from markup', 'delete from revision_request'): d.run(st)
    d.storage.remove(d.storage.names()); d.run('delete from submission_file_removal')

def teacher_left(d, tok, a, mine=2, theirs=2, e=ENR1):
    """The student sends `mine` pages, the teacher adds `theirs` as More Pages, the student unsends: what is left is the
    teacher's. (the unsend's answer, the teacher's upload's start, the work's id)"""
    s, f = d.send(tok, e, a, mine)
    t, tf = tadd(d, a, e, theirs)
    u = d.unsend(tok, e, a)
    return u, t, s['submission_id']

def midnight(d):
    """A time zone in which it is now between midnight and one in the morning, today there (D), and that midnight as a
    timestamptz. Asked again in each transaction: now() is the transaction's start."""
    for n in range(-14, 13):
        tz = 'Etc/GMT%+d' % n
        if d.one('select extract(hour from now() at time zone :z)::int', z=tz) == 0:
            return tz, d.one('select (now() at time zone :z)::date', z=tz), d.one("select date_trunc('day', now() at time zone :z) at time zone :z", z=tz)
    raise RuntimeError('no zone at midnight')
def east_of(tz):
    n = int(tz[len('Etc/GMT'):]); return 'Etc/GMT%+d' % (n - 1)   # Etc/GMT-5 is five hours AHEAD of UTC
def started_at(d, sid, at): d.run('update submission set created_at = :t where id = :s', t=at, s=sid)
def day(dt, n=0): return str(dt + datetime.timedelta(days=n))

MODE = {'fixed': True}
def check(name, good, detail='', differs=False):
    """With the file: the check must hold. Without it (the base): a check marked differs must NOT hold, every other
    check must hold there too."""
    if MODE['fixed']: ok(name, bool(good), detail)
    elif differs: ok('WITHOUT the file this does not hold: ' + name, not good, 'it held')
    else: ok('without the file too: ' + name, bool(good), detail)

# ════════════════════════════════════════════════════════════════════════════
# Ruling 106
def scen_rule106(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('r106_%d' % fixed, fixed); a = k['takes']
    def closed_start(tz, D, closes='stop', due=None, until=None, pages_=1, replace=False, note=None):
        """A send started while the piece was open (its last day today), then the clock moved past that last day: the
        row's first start is put on the last day, one second before the midnight that just passed, and the piece's last
        day is yesterday. (the start's answer)"""
        d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
        d.run("update assessment set due_date = :d, after_due = 'stop', accept_until = null where id = :a", d=D, a=a)
        s = d.send_start(t1, ENR1, a, pages_, replace=replace, note=note)
        assert s.get('ok'), s
        d.upload(s['files'])
        if closes == 'stop': d.run("update assessment set due_date = :d where id = :a", d=day(D, -1), a=a)
        else: d.run("update assessment set due_date = :du, after_due = 'until', accept_until = :u where id = :a", du=due, u=until, a=a)
        return s
    try:
        # ── The midnight edge, the class's own time zone ────────────────
        with tx(d):
            tz, D, mid = midnight(d)
            s = closed_start(tz, D)
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            w = piece(d, t1, ENR1, a)
            check('a send started at 23:59:59 on the last day (the class\'s time zone) is still listed as unfinished after midnight, with its finish-by; the piece shows closed',
                  g(w, 'sending', 'submission_id') == s['submission_id'] and w.get('open') is False and w.get('closes_on') == day(D, -1), w)
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('finished after midnight, every page up: taken, and marked Late (ruling 106)', g(f, 'ok') is True and f.get('late') is True and f.get('pages') == 1, f, differs=True)
            check('it is handed in as the student\'s, Late, and nothing is queued for deletion',
                  [x[:7] for x in sent(d)] == [[s['submission_id'], 'student', False, None, None, True, 1]] and queued(d) == [],
                  (sent(d), queued(d)), differs=True)
            check('the student\'s page now shows it handed in and Late; Unsend and Replace are closed (the piece is closed)',
                  g(piece(d, t1, ENR1, a), 'sent', 'is_late') is True and g(piece(d, t1, ENR1, a), 'sent', 'can_change') is False, piece(d, t1, ENR1, a), differs=True)
            f2 = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('the same finish again: replayed, the same Late', g(f2, 'replayed') is True and f2.get('late') is True, f2, differs=True)
            check('everything that must always hold, holds', sound(d) == '', sound(d))
        for label, delta in (('exactly at midnight', 0), ('one second after midnight', 1)):
            with tx(d):
                tz, D, mid = midnight(d)
                s = closed_start(tz, D)
                started_at(d, s['submission_id'], mid + datetime.timedelta(seconds=delta))
                f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
                check('a send whose first start is %s, after the last day, is refused: work_closed with the day it closed; it stays unfinished, nothing queued' % label,
                      err(f) == 'work_closed' and f.get('closed_on') == day(D, -1) and row(d, s['submission_id']) == [['sending', 'new', None, 'student']] and queued(d) == [], f)
        with tx(d):
            tz, D, mid = midnight(d)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'stop' where id = :a", d=day(D, -1), a=a)
            r = d.send_start(t1, ENR1, a, 1)
            check('a send STARTED after the last day is refused, as before: work_closed, nothing made', err(r) == 'work_closed' and d.one('select count(*) from submission') == 0, r)
        with tx(d):
            tz, D, mid = midnight(d)
            s = closed_start(tz, D)
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            d.run('update course set timezone = :z where id = :c', z=east_of(tz), c=COURSE_A)
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('the same send in a class one hour east, where its first start was already 00:59:59 on the next day: work_closed (the day is the class\'s own)',
                  err(f) == 'work_closed', f)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            for zone in ('Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'):
                d.run("select set_config('TimeZone', :z, true)", z=zone)
                f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
                if g(f, 'ok'): break
            check('back in its own zone it is taken, Late, whatever time zone the calling connection is in (tried +14, -11, UTC)', g(f, 'ok') is True and f.get('late') is True, f, differs=True)
        # ── Until a date; the odd setting where it is before the due date ─
        with tx(d):
            tz, D, mid = midnight(d)
            s = closed_start(tz, D, closes='until', due=day(D, -7), until=day(D, -1))
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('Until a date: started on the last day, finished after midnight: taken, Late', g(f, 'ok') is True and f.get('late') is True, f, differs=True)
        with tx(d):
            tz, D, mid = midnight(d)
            s = closed_start(tz, D, closes='until', due=day(D, 3), until=day(D, -1))
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('Until a date that is BEFORE the due date (update_assessment can leave that): finished after the last day, before the due date: taken, and Late all the same',
                  g(f, 'ok') is True and f.get('late') is True, f, differs=True)
        with tx(d):
            tz, D, mid = midnight(d)
            s = closed_start(tz, D, closes='until', due=day(D, -7), until=day(D, -2))
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('the teacher moved Until to before the day the send started: work_closed (the teacher closed it under the send)', err(f) == 'work_closed' and f.get('closed_on') == day(D, -2), f)
        with tx(d):
            tz, D, mid = midnight(d)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'keep' where id = :a", d=D, a=a)
            s = d.send_start(t1, ENR1, a, 1); d.upload(s['files'])
            d.run("update assessment set due_date = :d where id = :a", d=day(D, -1), a=a)
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('Keep Accepting, as before: started on the due date (not late), finished after it: taken, Late', s['late'] is False and g(f, 'ok') is True and f['late'] is True, (s, f))
        with tx(d):
            tz, D, mid = midnight(d)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'stop' where id = :a", d=D, a=a)
            s = d.send_start(t1, ENR1, a, 1); d.upload(s['files'])
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('Stop, finished on the last day itself: taken, not Late, as before', g(f, 'ok') is True and f['late'] is False, f)
        # ── A Replace that crosses the last day ─────────────────────────
        with tx(d):
            tz, D, mid = midnight(d)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'stop' where id = :a", d=D, a=a)
            s1, f1 = d.send(t1, ENR1, a, 2)
            t, tf = tadd(d, a, ENR1, 1)
            s = closed_start(tz, D, pages_=3, replace=True, note='second try')
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check("a Replace started on the last day and finished after midnight: taken, Late; the student's 3 new pages, then the teacher's 1; the old pages queued as replaced",
                  g(f, 'ok') is True and f['late'] is True and who(d, s['submission_id']) == ['student'] * 3 + ['teacher']
                  and queued(d, 'replace') == fpaths(s1['files']) and sent(d)[0][3] == 'second try', (f, who(d, s['submission_id'])), differs=True)
            check('and the piece now refuses an Unsend (closed), as ruling 85 has it', err(d.unsend(t1, ENR1, a)) == 'work_closed')
        # ── Everything else is still asked at the finish ────────────────
        for label, setup, want in (
                ('Send Work was turned off', "update course set send_work = false where id = '%s'" % COURSE_A, 'send_off'),
                ('the piece was set to take nothing', "update assessment set students_send = 'nothing' where id = '{a}'", 'not_taking_work'),
                ('the student was withdrawn', "update enrollment set withdrawn_at = now() where id = '%s'" % ENR1, 'not_found'),
                ('the card was locked', "update student_card set locked_at = now() where enrollment_id = '%s' and stopped_at is null" % ENR1, 'card_locked')):
            with tx(d):
                tz, D, mid = midnight(d)
                s = closed_start(tz, D)
                started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
                d.run(setup.replace('{a}', a))
                f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
                check('after the last day, %s: %s, as before' % (label, want), err(f) == want, f)
        with tx(d):
            tz, D, mid = midnight(d)
            s1, _ = d.send(t1, ENR1, a, 1)
            s = closed_start(tz, D, replace=True)
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            draft(d, a)
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check("after the last day, a Replace while the teacher started grading: grading_started; what was sent stays", err(f) == 'grading_started' and sent(d)[0][0] == s1['submission_id'], f, differs=True)
        with tx(d):
            tz, D, mid = midnight(d)
            s = closed_start(tz, D, pages_=2)
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'][:1])
            check('after the last day, a send of 2 finished naming only its first page: taken with 1 page, the other queued (page_removed), as a finish always does',
                  g(f, 'ok') is True and f['pages'] == 1 and queued(d, 'page_removed') == fpaths(s['files'][1:]), f, differs=True)
        with tx(d):
            tz, D, mid = midnight(d)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'stop' where id = :a", d=D, a=a)
            s = d.send_start(t1, ENR1, a, 1)
            d.run("update assessment set due_date = :d where id = :a", d=day(D, -1), a=a)
            started_at(d, s['submission_id'], mid - datetime.timedelta(seconds=1))
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('after the last day, pages not up: missing_pages (not work_closed), the send kept', err(f) == 'missing_pages' and row(d, s['submission_id'])[0][0] == 'sending', f, differs=True)
        # ── The two hours, never extended ───────────────────────────────
        with tx(d):
            tz, D, mid = midnight(d)
            req = nid()
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'stop' where id = :a", d=D, a=a)
            s = d.send_start(t1, ENR1, a, 1, request=req); d.upload(s['files'])
            d.run("update assessment set due_date = :d where id = :a", d=day(D, -1), a=a)
            d.run("update submission set created_at = now() - interval '1 hour 59 minutes' where id = :s", s=s['submission_id'])
            again = d.send_start(t1, ENR1, a, 1, request=req)
            check('after the last day the same start again is a replay: the same send, the same finish-by (started 1 h 59 ago), nothing new',
                  g(again, 'replayed') is True and again['submission_id'] == s['submission_id'] and d.one("select :f::timestamptz = now() + interval '1 minute'", f=again['finish_by'])
                  and d.one('select count(*) from submission') == 1, again)
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('started 1 h 59 ago on the last day, finished now (after midnight): taken, Late', g(f, 'ok') is True and f['late'] is True, f, differs=True)
        with tx(d):
            tz, D, mid = midnight(d)
            d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
            d.run("update assessment set due_date = :d, after_due = 'stop' where id = :a", d=D, a=a)
            s = d.send_start(t1, ENR1, a, 1); d.upload(s['files'])
            d.run("update assessment set due_date = :d where id = :a", d=day(D, -1), a=a)
            d.run("update submission set created_at = now() - interval '2 hours 1 second' where id = :s", s=s['submission_id'])
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            check('started two hours and a second ago: expired, as before; its files queued as expired; nothing handed in',
                  err(f) == 'expired' and queued(d, 'expired') == fpaths(s['files']) and d.one('select count(*) from submission') == 0, f)
        with tx(d):
            ok('no function changes a send\'s first start (created_at) in this file', 'created_at =' not in re.sub(r'--[^\n]*', '', text_at(FILE)) and 'created_at=' not in text_at(FILE))
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
# Ruling 107
def scen_rule107(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('r107_%d' % fixed, fixed); a = k['takes']
    try:
        with suppress(Skip), tx(d):
            u, t, old = teacher_left(d, t1, a, 2, 2)
            check('as before: the Unsend leaves the teacher\'s 2 pages, the work now the teacher\'s, without the student\'s note',
                  g(u, 'kept') == 2 and [x[1:4] for x in sent(d)] == [['teacher', False, None]] and who(d, old) == ['teacher', 'teacher'], (u, sent(d)))
            w = piece(d, t1, ENR1, a)
            check("the student's page says a send would join them: sent.can_send true (can_change false: nothing of theirs to remove)",
                  g(w, 'sent', 'can_send') is True and g(w, 'sent', 'can_change') is False and g(w, 'sent', 'sent_by') == 'teacher', w, differs=True)
            req = nid()
            s = d.send_start(t1, ENR1, a, 3, note='my lab', plan='yes', request=req)
            check('send_start is taken (it was already_sent, for ever): a new send, intent new, no target, the usual finish-by',
                  g(s, 'ok') is True and row(d, s.get('submission_id')) == [['sending', 'new', None, 'student']], s, differs=True)
            if not MODE['fixed']: raise Skip
            again = d.send_start(t1, ENR1, a, 3, request=req)
            ok('the same start again: replayed, the same send and finish-by, nothing more made or counted',
               g(again, 'replayed') is True and again['submission_id'] == s['submission_id'] and again['finish_by'] == s['finish_by']
               and d.one("select count(*) from submission where state = 'sending'") == 1 and d.one('select count(*) from student_submit.send_log') == 2, again)
            vis = Storage(d).visible('authenticated', A)
            d.upload(s['files'])
            ok("nobody can open the unfinished send's photos, the teacher included (ruling 91): the teacher's view of storage gains nothing",
               Storage(d).visible('authenticated', A) == vis and not set(fpaths(s['files'])) & set(Storage(d).visible('authenticated', A))
               and not any(x.get('id') == s['submission_id'] for x in (d.rpc('list_course_submissions(:c)', c=COURSE_A) or {}).get('submissions', [])), vis)
            ok('and no student link names them before the finish', not set(fpaths(s['files'])) & {x.get('path') for x in (g(d.file_links(t1, ENR1, a), 'files') or [])})
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            ok('finished: taken, 5 pages, not Late', g(f, 'ok') is True and f['pages'] == 5 and f['late'] is False, f)
            want = [(1, 'student', ids(s['files'])[0]), (2, 'student', ids(s['files'])[1]), (3, 'student', ids(s['files'])[2]),
                    (4, 'teacher', ids(t['files'])[0]), (5, 'teacher', ids(t['files'])[1])]
            ok("the student's 3 new pages first, then the teacher's 2, each the same file, still marked the teacher's (the rule a Replace follows)",
               pages(d, s['submission_id']) == want, pages(d, s['submission_id']))
            ok("the work is what a student's own send is: sent by the student, their note and plan, not Late, version 1, their card and request",
               [x[1:] for x in sent(d)] == [['student', False, 'my lab', 'yes', False, 1, card_of(d, ENR1), req]] and sent(d)[0][0] == s['submission_id'], sent(d))
            ok("the teacher's row is gone (it held no page) and nothing more is queued: only the student's 2 unsent pages, as unsend",
               d.one('select count(*) from submission where id = :s', s=old) == 0 and queued(d) == queued(d, 'unsend') and len(queued(d)) == 4, queued(d))
            w = piece(d, t1, ENR1, a)
            ok("the student's page: handed in by the student, 5 pages, Unsend and Replace open, can_send false",
               g(w, 'sent', 'sent_by') == 'student' and g(w, 'sent', 'pages') == 5 and g(w, 'sent', 'can_change') is True and g(w, 'sent', 'can_send') is False, w)
            links = d.file_links(t1, ENR1, a)
            ok("the student's links: all 5 pages, the teacher's among them (ruling 108)", sorted(x.get('file_id') for x in (g(links, 'files') or [])) == sorted(ids(s['files']) + ids(t['files'])), links)
            lst = d.rpc('list_course_submissions(:c)', c=COURSE_A)
            mine = [x for x in lst.get('submissions', []) if x.get('id') == s['submission_id']]
            ok("the teacher's list: the student's work, the teacher's 2 pages marked added by the teacher",
               mine and [x['added_by'] for x in mine[0]['files']] == ['student'] * 3 + ['teacher'] * 2 and mine[0]['sent_by'] == 'student', mine)
            u2 = d.unsend(t1, ENR1, a)
            ok("a later Unsend removes only the student's 3 pages again; the teacher's 2 stay, as the teacher's work",
               u2 == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 3, 'kept': 2} and who(d, s['submission_id']) == ['teacher', 'teacher']
               and [x[1:4] for x in sent(d)] == [['teacher', False, None]] and set(fpaths(s['files'])) <= set(queued(d, 'unsend'))
               and not set(fpaths(t['files'])) & set(queued(d)), (u2, who(d, s['submission_id'])))
            s3, f3 = d.send(t1, ENR1, a, 1, note='third')
            ok('and the student can send again: 1 new page, then the teacher\'s 2', g(f3, 'ok') is True and who(d, s3['submission_id']) == ['student', 'teacher', 'teacher'], f3)
            r = d.send_start(t1, ENR1, a, 2, replace=True); d.upload(r['files']); fr = d.send_finish(t1, ENR1, r['submission_id'], r['files'])
            ok("a Replace of that work keeps the teacher's 2 after the student's new 2", g(fr, 'ok') is True and who(d, r['submission_id']) == ['student'] * 2 + ['teacher'] * 2, fr)
            ok('everything that must always hold, holds', sound(d) == '' and most(d) <= 30, sound(d))
        with tx(d):
            ts, tf = tadd(d, a, ENR1, 2, mode='new')
            check("work the teacher added entirely with Add Work: the student's page offers a send", g(piece(d, t1, ENR1, a), 'sent', 'can_send') is True, piece(d, t1, ENR1, a), differs=True)
            s, f = d.send(t1, ENR1, a, 1, note='mine')
            check("the student's send joins it: their page, then the teacher's 2; the work the student's, with their note",
                  g(f, 'ok') is True and who(d, s['submission_id']) == ['student', 'teacher', 'teacher'] and [x[1:4] for x in sent(d)] == [['student', False, 'mine']], (s, f), differs=True)
        with tx(d):
            u, t, old = teacher_left(d, t1, a, 1, 28)
            r = d.send_start(t1, ENR1, a, 3)
            check("with the teacher's 28 pages, 3 more is too many: too_many_pages, room 2, nothing made", r == {'ok': False, 'error': 'too_many_pages', 'room': 2}
                  and d.one("select count(*) from submission where state = 'sending'") == 0, r, differs=True)
            s, f = d.send(t1, ENR1, a, 2)
            check('2 fit: 30 pages', g(f, 'ok') is True and f['pages'] == 30 and most(d) == 30, f, differs=True)
        with tx(d):
            d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1], k=nid())
            check('Handed In on Paper stays closed to the student: already_sent, as before; can_send false',
                  err(d.send_start(t1, ENR1, a, 1)) == 'already_sent' and nocan(piece(d, t1, ENR1, a)), piece(d, t1, ENR1, a))
        with tx(d):
            u, t, old = teacher_left(d, t1, a)
            draft(d, a)
            r = d.send_start(t1, ENR1, a, 1)
            check('grading started on the teacher\'s work (a draft grade, ruling 83): grading_started; can_send false',
                  err(r) == 'grading_started' and nocan(piece(d, t1, ENR1, a)), r, differs=True)
        with tx(d):
            u, t, old = teacher_left(d, t1, a)
            m = d.rpc('save_markup(:f, :m::jsonb, :b, :k)', f=t['files'][0]['file_id'], m=json.dumps(bc.marks('see here')), b=None, k=nid())
            r = d.send_start(t1, ENR1, a, 1)
            check("a mark on one of the teacher's pages counts as grading started (ruling 109, Batch C): grading_started", g(m, 'result') in ('saved', None) and err(r) == 'grading_started', (m, r), differs=True)
            d.rpc('save_markup(:f, :m::jsonb, :b, :k)', f=t['files'][0]['file_id'], m=json.dumps({'v': 1, 'marks': []}), b=None, k=nid())
            r = d.send_start(t1, ENR1, a, 1)
            check('every mark erased: the send is taken again', g(r, 'ok') is True, r, differs=True)
        with tx(d):
            u, t, old = teacher_left(d, t1, a)
            rq = d.rpc('return_for_revision(:a, :e, :r::jsonb, :k)', a=a, e=ENR1, r=json.dumps({'what_to_fix': 'Label the diagram.'}), k=nid())
            r = d.send_start(t1, ENR1, a, 1)
            check('a revision open on the teacher\'s work: already_sent, as before (Send My Revision is the way); can_send false',
                  g(rq, 'result') == 'made' and err(r) == 'already_sent' and nocan(piece(d, t1, ENR1, a)), (rq, r))
            rv = d.rev_start(t1, ENR1, a, 1) if hasattr(d, 'rev_start') else d.service("student_submit.revision_start(:t, :e, :a, :p::jsonb, null, :r, 'ip-1')", t=t1, e=ENR1, a=a, p=json.dumps([{'width': 1, 'height': 1}]), r=nid())
            d.upload(rv['files'])
            d.rpc('cancel_revision(:r, :k)', r=rq['request']['id'], k=nid())
            b4 = snap(d)
            f = d.send_finish(t1, ENR1, rv['submission_id'], rv['files'])
            check("a revision's unfinished pages (version 2) given to send_finish after the request was taken back: not_found, nothing changed (review F2; it was already_sent and the pages dropped); the teacher's work untouched",
                  err(f) == 'not_found' and snap(d) == b4 and who(d, old) == ['teacher', 'teacher'] and [x[1] for x in sent(d)] == ['teacher'], (f, sent(d)), differs=True)
        for v1_in in (False, True):
            # Review F2: a revision's unfinished pages (version 2, made by revision_start) handed to send_finish
            # instead of revision_finish. Versions above 1 are revision_finish's only: refused, nothing changed.
            with suppress(Skip), tx(d):
                if v1_in: d.send(t1, ENR1, a, 1, note='first')
                rq = d.rpc('return_for_revision(:a, :e, :r::jsonb, :k)', a=a, e=ENR1, r=json.dumps({'what_to_fix': 'Do it.'}), k=nid())
                rv = d.service("student_submit.revision_start(:t, :e, :a, :p::jsonb, null, :r, 'ip-1')", t=t1, e=ENR1, a=a, p=json.dumps([{'width': 10, 'height': 10}] * 2), r=nid())
                d.upload(rv['files'])
                b4 = snap(d)
                f = d.send_finish(t1, ENR1, rv['submission_id'], rv['files'])
                check("F2, %s: a revision's unfinished pages (version 2) given to send_finish: not_found, and nothing changed (the send still unfinished with its 2 pages, nothing handed in, nothing queued, the request open)"
                      % ('the student\'s version 1 in' if v1_in else 'nothing handed in'),
                      g(rq, 'result') == 'made' and g(rv, 'version') == 2 and err(f) == 'not_found' and snap(d) == b4, (rq, rv.get('version'), f), differs=True)
                if not MODE['fixed']: raise Skip
                p = d.service("student_submit.send_paths(:t, :e, :s, 'ip-1')", t=t1, e=ENR1, s=rv['submission_id'])
                ok('F2: send_paths still gives its pages, and says version 2 (a route can refuse it before reading)', g(p, 'version') == 2 and ids(g(p, 'files')) == ids(rv['files']), p)
                fr = d.service("student_submit.revision_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=t1, e=ENR1, s=rv['submission_id'], f=json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in rv['files']]))
                st = d.one("select public._revision_state(id)->>'state' from revision_request where id = :r", r=rq['request']['id'])
                ok('F2: Send My Revision then hands it in: version 2 with its 2 pages, the request reads sent, its revision in',
                   g(fr, 'ok') is True and st == 'sent' and [x[6] for x in sent(d)] == ([1, 2] if v1_in else [2]) and len(pages(d, rv['submission_id'])) == 2
                   and d.one('select revision_in_at is not null from revision_request where id = :r', r=rq['request']['id']) is True and sound(d) == '', (fr, st, sent(d)))
        with tx(d):
            s0, f0 = d.send(t1, ENR1, a, 1)
            check("the student's own work in: send_start is already_sent, as before (Replace is the way); can_send false",
                  err(d.send_start(t1, ENR1, a, 1)) == 'already_sent' and nocan(piece(d, t1, ENR1, a))
                  and d.one("select count(*) from submission where state = 'sending'") == 0)
            rq = d.rpc('return_for_revision(:a, :e, :r::jsonb, :k)', a=a, e=ENR1, r=json.dumps({'what_to_fix': 'Label it.'}), k=nid())
            rv = d.service("student_submit.revision_start(:t, :e, :a, :p::jsonb, null, :r, 'ip-1')", t=t1, e=ENR1, a=a, p=json.dumps([{'width': 10, 'height': 10}]), r=nid())
            d.upload(rv['files'])
            d.service("student_submit.revision_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=t1, e=ENR1, s=rv['submission_id'], f=json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in rv['files']]))
            d.rpc('cancel_revision(:r, :k)', r=rq['request']['id'], k=nid())
            rt, rf = tadd(d, a, ENR1, 2, mode='replace')
            check("the teacher's work can be a version 2 (Replace Them on a revision whose request was taken back): it is the piece's latest", [x[1] for x in sent(d)] == ['student', 'teacher'] and sent(d)[1][6] == 2, sent(d))
            reqs = snap(d)[2]
            s, f = d.send(t1, ENR1, a, 1)
            check("the student's send onto it keeps its version, 2, beside version 1 (as a Replace of version 2 would); 1 + the teacher's 2",
                  g(f, 'ok') is True and [x[1] for x in sent(d)] == ['student', 'student'] and sent(d)[1][6] == 2 and sent(d)[1][0] == s['submission_id']
                  and who(d, s['submission_id']) == ['student', 'teacher', 'teacher'] and sound(d) == '', (f, sent(d)), differs=True)
            if MODE['fixed']:
                ok("the join deleted the teacher's sent version 2, so C1's revision_gone ran (round 3): no request is open, so it settled none; every request as it was",
                   snap(d)[2] == reqs and d.one("select count(*) from revision_request where enrollment_id = :e and state = 'open'", e=ENR1) == 0, (reqs, snap(d)[2]))
        with tx(d):
            u, t, old = teacher_left(d, t1, a)
            check('a Replace of the teacher\'s work still answers cannot_change (the call is send_start)', err(d.send_start(t1, ENR1, a, 1, replace=True)) == 'cannot_change')
            check('an Unsend of it still answers cannot_change', err(d.unsend(t1, ENR1, a)) == 'cannot_change')
            d.run('update course set send_work = false where id = :c', c=COURSE_A)
            check('Send Work off: send_off; can_send false', err(d.send_start(t1, ENR1, a, 1)) == 'send_off' and nocan(piece(d, t1, ENR1, a)))
            d.run('update course set send_work = true where id = :c', c=COURSE_A)
            d.run("update assessment set due_date = :d::date - 1, after_due = 'stop' where id = :a", d=k['today'], a=a)
            check('the piece closed: work_closed; can_send false', err(d.send_start(t1, ENR1, a, 1)) == 'work_closed' and nocan(piece(d, t1, ENR1, a)))
            d.run("update assessment set due_date = null, after_due = 'keep' where id = :a", a=a)
            check("another student cannot send onto this student's work: their own piece is untouched by it", g(d.send(t2, ENR2, a, 1)[1], 'ok') is True and who(d, old) == ['teacher', 'teacher'])
            check("the other student's page says nothing of it", g(piece(d, t2, ENR2, a), 'sent', 'sent_by') == 'student')
        with tx(d):
            u, t, old = teacher_left(d, t1, a)
            s = d.send_start(t1, ENR1, a, 1)
            if g(s, 'ok'):
                d.upload(s['files'])
                d.run("update submission set created_at = now() - interval '2 hours 1 second' where id = :s", s=s['submission_id'])
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files']) if g(s, 'ok') else s
            check("a send onto the teacher's pages finished two hours and a second after it started: expired; the teacher's work as it was, none of its files queued",
                  err(f) == 'expired' and who(d, old) == ['teacher', 'teacher'] and not set(fpaths(t['files'])) & set(queued(d)), f, differs=True)
        with tx(d):
            u, t, old = teacher_left(d, t1, a)
            d.run("update assessment set due_date = :d::date - 3 where id = :a", d=k['today'], a=a)
            s, f = d.send(t1, ENR1, a, 1)
            check('after the due date (Keep Accepting) the joined work is Late, as a send of the student\'s own would be', g(f, 'late') is True and sent(d)[0][5] is True, f, differs=True)
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
# Interleavings, one connection. Each case's first check is the one this file changes.
def scen_interleave(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('mix_%d' % fixed, fixed); a = k['takes']
    def after(label):
        check('%s: never more than 30 pages, and everything that must always hold, holds' % label, most(d) <= 30 and sound(d) == '', (most(d), sound(d)))
    cases = []
    def up(s):
        if g(s, 'ok'): d.upload(s['files'])
    def case(f): cases.append(f); return f

    @case
    def nothing_then_teacher_add_work():
        s = d.send_start(t1, ENR1, a, 2); up(s)
        ts, tf = tadd(d, a, ENR1, 3, mode='new')
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        check("a send started on nothing; the teacher's Add Work of 3 is handed in first; the student's finish joins it (was already_sent, pages dropped): 2 + 3",
              g(f, 'ok') is True and who(d, s['submission_id']) == ['student'] * 2 + ['teacher'] * 3, f, differs=True)
        if not MODE['fixed']: return
        ok("the teacher's upload's row is gone, none of its files queued", not set(fpaths(ts['files'])) & set(queued(d)) and len(sent(d)) == 1)
        after('nothing, then Add Work')
    @case
    def nothing_then_teacher_add_work_over_30():
        s = d.send_start(t1, ENR1, a, 20); up(s)
        ts, tf = tadd(d, a, ENR1, 15, mode='new')
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        check("the same with 20 and the teacher's 15: too_many_pages, room 15; the send kept, nothing queued", f == {'ok': False, 'error': 'too_many_pages', 'room': 15}
              and row(d, s['submission_id']) == [['sending', 'new', None, 'student']] and queued(d) == [], f, differs=True)
        if not MODE['fixed']: return
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'][:15])
        ok('finished with the 15 that fit: 30 pages, the 5 left out queued (page_removed)', g(f, 'ok') is True and most(d) == 30 and queued(d, 'page_removed') == fpaths(s['files'][15:]), f)
        after('nothing, then Add Work, over 30')
    @case
    def join_then_teacher_more_pages_first():
        u, t, old = teacher_left(d, t1, a, 1, 10)
        s = d.send_start(t1, ENR1, a, 15); up(s)
        check('a send onto the teacher\'s 10 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        t2_, tf2 = tadd(d, a, ENR1, 10)
        ok("the teacher's Add as More Pages of 10 is taken first: 20 pages of the teacher's", g(tf2, 'result') == 'sent' and who(d, old) == ['teacher'] * 20, tf2)
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok("the student's 15, finished second, are too many: too_many_pages, room 10; nothing changes", f == {'ok': False, 'error': 'too_many_pages', 'room': 10} and who(d, old) == ['teacher'] * 20 and queued(d) == queued(d, 'unsend'), f)
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'][:10])
        ok("with 10: 30 pages, the student's 10, then the teacher's 20 in their order", g(f, 'ok') is True and pages(d, s['submission_id'])[10:] == [(i + 11, 'teacher', x) for i, x in enumerate(ids(t['files']) + ids(t2_['files']))], f)
        after('a send onto the teacher\'s pages, the teacher adding more first')
    @case
    def join_then_teacher_more_pages_second():
        u, t, old = teacher_left(d, t1, a, 1, 10)
        s = d.send_start(t1, ENR1, a, 15); up(s)
        check('a send onto the teacher\'s 10 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        t2_ = tstart(d, a, ENR1, 10); tput(d, t2_['files'])
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok("the student's 15 finish first while the teacher's Add of 10 is uploading: 25 pages; the Add now adds to the student's work",
           g(f, 'ok') is True and f['pages'] == 25 and row(d, t2_['submission_id']) == [['sending', 'add', s['submission_id'], 'teacher']], (f, row(d, t2_['submission_id'])))
        r = tfinish(d, t2_['submission_id'], t2_['files'])
        ok("the teacher's Add, finished second: too_many_pages, room 5; kept", r == {'result': 'too_many_pages', 'room': 5} and row(d, t2_['submission_id'])[0][0] == 'sending', r)
        r = tfinish(d, t2_['submission_id'], t2_['files'][:5])
        ok("with 5: 30 pages, the student's 15, the teacher's 10, then the 5", g(r, 'result') == 'sent' and who(d, s['submission_id']) == ['student'] * 15 + ['teacher'] * 15, r)
        after('a send onto the teacher\'s pages, the teacher adding more second')
    @case
    def join_teacher_replace_them_first():
        u, t, old = teacher_left(d, t1, a, 1, 4)
        s = d.send_start(t1, ENR1, a, 2); up(s)
        check('a send onto the teacher\'s 4 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        rt, rf = tadd(d, a, ENR1, 3, mode='replace')
        ok("the teacher's Replace Them (3 pages) is handed in first; the student's send is not dropped (it was not tied to the old work)",
           g(rf, 'result') == 'sent' and row(d, s['submission_id']) == [['sending', 'new', None, 'student']], (rf, row(d, s['submission_id'])))
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok("finished: it joins the teacher's new 3 pages: 2 + 3; the teacher's old 4 queued as replaced by the teacher", g(f, 'ok') is True
           and pages(d, s['submission_id']) == [(1, 'student', ids(s['files'])[0]), (2, 'student', ids(s['files'])[1])] + [(i + 3, 'teacher', x) for i, x in enumerate(ids(rt['files']))]
           and queued(d, 'replace') == fpaths(t['files']), f)
        after("a send onto the teacher's pages, the teacher replacing them first")
    @case
    def join_teacher_replace_them_second():
        u, t, old = teacher_left(d, t1, a, 1, 4)
        s = d.send_start(t1, ENR1, a, 2); up(s)
        check('a send onto the teacher\'s 4 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        rt = tstart(d, a, ENR1, 3, mode='replace'); tput(d, rt['files'])
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        r = tfinish(d, rt['submission_id'], rt['files'])
        ok("the student finishes first while the teacher's Replace Them is uploading: 2 + the teacher's 4; the teacher's Replace Them is dropped (gone), as after a student's Replace (Batch B; open for Colin)",
           g(f, 'ok') is True and who(d, s['submission_id']) == ['student'] * 2 + ['teacher'] * 4 and r == {'result': 'gone'}
           and queued(d, 'replace') == fpaths(rt['files']) and not set(fpaths(t['files'])) & set(queued(d)), (f, r))
        after("a send onto the teacher's pages, the teacher replacing them second")
    @case
    def join_teacher_deletes():
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s = d.send_start(t1, ENR1, a, 2); up(s)
        check('a send onto the teacher\'s 2 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        d.rpc('delete_submission(:s, :k)', s=old, k=nid())
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok("the teacher deletes their work meanwhile: the send is handed in as a plain new send, 2 pages, the student's",
           g(f, 'ok') is True and who(d, s['submission_id']) == ['student', 'student'] and [x[1] for x in sent(d)] == ['student'], f)
        after('a send onto the teacher\'s pages, the teacher deleting them')
    @case
    def join_teacher_deletes_then_paper():
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s = d.send_start(t1, ENR1, a, 2); up(s)
        check('a send onto the teacher\'s 2 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        d.rpc('delete_submission(:s, :k)', s=old, k=nid()); d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1], k=nid())
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok("the teacher deletes it and marks it Handed In on Paper meanwhile: already_sent, the student's pages dropped (abandoned), as before",
           err(f) == 'already_sent' and queued(d, 'abandoned') == fpaths(s['files']) and [x[2] for x in sent(d)] == [True], f)
        after('a send onto the teacher\'s pages, on paper meanwhile')
    @case
    def nothing_then_paper():
        s = d.send_start(t1, ENR1, a, 1); up(s)
        d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1], k=nid())
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        check('a send started on nothing, marked Handed In on Paper meanwhile: already_sent, dropped, as before', err(f) == 'already_sent' and queued(d, 'abandoned') == fpaths(s['files']), f)
        after('nothing, then on paper')
    @case
    def join_grading_meanwhile():
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s = d.send_start(t1, ENR1, a, 2); up(s)
        check('a send onto the teacher\'s 2 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        draft(d, a)
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok('the teacher starts grading meanwhile: grading_started, the new pages dropped (abandoned), the teacher\'s work as it was',
           err(f) == 'grading_started' and queued(d, 'abandoned') == fpaths(s['files']) and who(d, old) == ['teacher', 'teacher'], f)
        after('a send onto the teacher\'s pages, grading meanwhile')
    @case
    def nothing_then_add_work_graded():
        s = d.send_start(t1, ENR1, a, 1); up(s)
        ts, tf = tadd(d, a, ENR1, 1, mode='new'); draft(d, a)
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        check("a send started on nothing; the teacher's Add Work handed in and graded meanwhile: grading_started (was already_sent), dropped either way",
              err(f) == 'grading_started' and queued(d, 'abandoned') == fpaths(s['files']), f, differs=True)
        after('nothing, then Add Work and a grade')
    @case
    def join_marks_meanwhile():
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s = d.send_start(t1, ENR1, a, 1); up(s)
        check('a send onto the teacher\'s 2 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        d.rpc('save_markup(:f, :m::jsonb, :b, :k)', f=t['files'][1]['file_id'], m=json.dumps(bc.marks('x')), b=None, k=nid())
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok("the teacher draws on one of their pages meanwhile: grading_started; the marked page and its marks stay", err(f) == 'grading_started'
           and d.one('select count(*) from markup where file_id = :f', f=t['files'][1]['file_id']) == 1, f)
        after('a send onto the teacher\'s pages, marks meanwhile')
    @case
    def join_twice():
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s = d.send_start(t1, ENR1, a, 2); up(s)
        check('a send onto the teacher\'s 2 pages starts', g(s, 'ok') is True, s, differs=True)
        if not MODE['fixed']: return
        s2 = d.send_start(t1, ENR1, a, 1); up(s2)
        f1 = d.send_finish(t1, ENR1, s['submission_id'], s['files']); f2 = d.send_finish(t1, ENR1, s2['submission_id'], s2['files'])
        ok('a second start (another tab) drops the first (abandoned), as before; the second joins: 1 + 2',
           err(f1) == 'not_found' and g(f2, 'ok') is True and who(d, s2['submission_id']) == ['student', 'teacher', 'teacher'] and queued(d, 'abandoned') == fpaths(s['files']), (f1, f2))
        after('two sends onto the teacher\'s pages')
    @case
    def replace_and_add_as_before():
        s1, _ = d.send(t1, ENR1, a, 1)
        t = tstart(d, a, ENR1, 29); tput(d, t['files'])
        r = d.send_start(t1, ENR1, a, 25, replace=True); d.upload(r['files'])
        f = d.send_finish(t1, ENR1, r['submission_id'], r['files']); tf = tfinish(d, t['submission_id'], t['files'])
        check("a student's Replace and the teacher's Add as More Pages, as the fixes file has them: 25 handed in, the Add told room 5", g(f, 'ok') is True and tf == {'result': 'too_many_pages', 'room': 5}, (f, tf))
        after('a Replace and an Add')
    @case
    def unsend_while_teacher_add_uploading():
        s1, _ = d.send(t1, ENR1, a, 2)
        t, tf = tadd(d, a, ENR1, 1)
        t2_ = tstart(d, a, ENR1, 2); tput(d, t2_['files'])
        u = d.unsend(t1, ENR1, a)
        s = d.send_start(t1, ENR1, a, 1); up(s)
        check("an Unsend that keeps the teacher's page while their second Add is uploading; the student sends again at once", g(s, 'ok') is True and g(u, 'kept') == 1, (u, s), differs=True)
        if not MODE['fixed']: return
        f = d.send_finish(t1, ENR1, s['submission_id'], s['files']); r = tfinish(d, t2_['submission_id'], t2_['files'])
        ok("the student's page, the teacher's first page, then the teacher's 2 when their Add is finished", g(f, 'ok') is True and g(r, 'result') == 'sent'
           and who(d, s['submission_id']) == ['student', 'teacher', 'teacher', 'teacher'] and pages(d, s['submission_id'])[1][2] == t['files'][0]['file_id'], (f, r))
        after('an Unsend, the teacher adding, the student sending again')
    try:
        for fn in cases:
            with tx(d):
                fresh(d); fn()
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
def scen_race(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('race_%d' % fixed, fixed); a = k['takes']
    def second_waits(first, second):
        h = Side(d); h.begin(); a1 = attempt(lambda: first(h))
        out = {}; o = Side(d)
        th = threading.Thread(target=lambda: out.setdefault('r', attempt(lambda: second(o)))); th.start(); time.sleep(0.6)
        waited = th.is_alive()
        h.commit(); th.join(20); h.close(); o.close()
        return waited, a1, out.get('r')
    def wipe():
        for st in ('delete from submission', 'delete from student_submit.send_log', 'delete from fv_idempotency', 'delete from grade_return', 'delete from score'): d.run(st)
        d.storage.remove(d.storage.names()); d.run('delete from submission_file_removal')
    try:
        for order in ('student first', 'teacher first'):
            wipe()
            u, t, old = teacher_left(d, t1, a, 1, 10)
            s = d.send_start(t1, ENR1, a, 15)
            if not g(s, 'ok'):
                check('race: a send onto the teacher\'s pages starts', False, s, differs=True); break
            d.upload(s['files'])
            tt = tstart(d, a, ENR1, 10); tput(d, tt['files'])
            stu = lambda x: x.send_finish(t1, ENR1, s['submission_id'], s['files'])
            tea = lambda x: tfinish(x, tt['submission_id'], tt['files'])
            waited, r1, r2 = second_waits(*((stu, tea) if order == 'student first' else (tea, stu)))
            if order == 'student first':
                check("race, the student's 15 onto the teacher's 10 and the teacher's Add of 10 at once, the student first: the Add waits, then room 5; 25 pages",
                      waited and g(r1, 'ok') is True and r2 == {'result': 'too_many_pages', 'room': 5} and most(d) == 25, (waited, r1, r2, most(d)), differs=True)
            else:
                check("race, the same with the teacher first: the student's finish waits, then too_many_pages, room 10; 20 pages",
                      waited and g(r1, 'result') == 'sent' and r2 == {'ok': False, 'error': 'too_many_pages', 'room': 10} and most(d) == 20, (waited, r1, r2), differs=True)
            check('race (%s): never more than 30, and everything holds' % order, most(d) <= 30 and sound(d) == '', (most(d), sound(d)))
        for order in ('delete first', 'student first'):
            wipe()
            u, t, old = teacher_left(d, t1, a, 1, 2)
            s = d.send_start(t1, ENR1, a, 1)
            if not g(s, 'ok'):
                check('race: a send onto the teacher\'s pages starts', False, s, differs=True); break
            d.upload(s['files'])
            stu = lambda x: x.send_finish(t1, ENR1, s['submission_id'], s['files'])
            dele = lambda x: x.rpc('delete_submission(:s, :k)', s=old, k=nid())
            waited, r1, r2 = second_waits(*((dele, stu) if order == 'delete first' else (stu, dele)))
            if order == 'delete first':
                check("race, the teacher deleting their work and the student's finish onto it, the delete first: the finish waits, then a plain send of 1 page",
                      waited and g(r1, 'deleted') is True and g(r2, 'ok') is True and who(d, s['submission_id']) == ['student'], (waited, r1, r2), differs=True)
            else:
                check("race, the same with the student first: the delete waits and finds nothing of that id (the work is now the student's, under another id); 3 pages kept",
                      waited and g(r1, 'ok') is True and g(r2, 'deleted') is False and who(d, s['submission_id']) == ['student', 'teacher', 'teacher'], (waited, r1, r2), differs=True)
            check('race (%s): everything holds' % order, sound(d) == '', sound(d))
        wipe()
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s = d.send_start(t1, ENR1, a, 1)
        if g(s, 'ok'):
            d.upload(s['files'])
            stu = lambda x: x.send_finish(t1, ENR1, s['submission_id'], s['files'])
            waited, r1, r2 = second_waits(stu, stu)
            check('race, the same finish twice at once (a double tap): the second waits, then answers replayed; one work of 3 pages',
                  waited and g(r1, 'replayed') is False and g(r2, 'replayed') is True and len(sent(d)) == 1 and most(d) == 3, (waited, r1, r2))
        else:
            check('race: a send onto the teacher\'s pages starts', False, s, differs=True)
        wipe()
        u, t, old = teacher_left(d, t1, a, 1, 2)
        req = nid()
        st = lambda x: x.send_start(t1, ENR1, a, 1, request=req)
        waited, r1, r2 = second_waits(st, st)
        check('race, the same start twice at once: the second waits, then is a replay of the first; one unfinished send, one counted',
              waited and g(r1, 'ok') is True and g(r2, 'replayed') is True and g(r1, 'submission_id') == g(r2, 'submission_id')
              and d.one("select count(*) from submission where state = 'sending'") == 1, (waited, r1, r2), differs=True)
    finally:
        d.close(); MODE['fixed'] = True

# ════════════════════════════════════════════════════════════════════════════
SIZES = [1, 1, 2, 3, 5, 8, 12, 15, 20, 25, 28, 29, 30]
def scen_fuzz(seeds=(1, 2, 3, 4), steps=250):
    d, k, t1, t2 = world('fuzz', True); a = k['takes']
    total = {'over_30': 0, 'teacher_file_queued_by_student': 0, 'unsound': 0, 'joined': 0, 'refused_at_finish': 0, 'sent': 0, 'stuck': 0}
    first_bad = []
    try:
        for seed in seeds:
            rnd = random.Random(seed); stu = None; tea = None; theirs = set()
            with tx(d):
                for step in range(steps):
                    op = rnd.choice(['s_start', 's_start', 's_finish', 's_finish', 's_unsend', 't_start', 't_start', 't_finish', 't_finish', 't_delete', 't_paper'])
                    held = {r[0] for r in d.all("select p from submission_file f join submission s on s.id = f.submission_id, unnest(array[f.path, f.thumb_path]) p where s.state = 'sent' and f.added_by = 'teacher'")} if op.startswith('s_') else set()
                    if op == 's_start':
                        d.run('delete from student_submit.send_log')
                        r = d.send_start(t1, ENR1, a, rnd.choice(SIZES), replace=rnd.random() < 0.4)
                        if g(r, 'ok'): d.upload(r['files']); stu = r
                    elif op == 's_finish' and stu:
                        n = len(stu['files']); pick = stu['files'][:rnd.randint(1, n)] if rnd.random() < 0.4 else stu['files']
                        onto = d.one("select count(*) from submission where state = 'sent' and sent_by = 'teacher' and not on_paper and enrollment_id = :e", e=ENR1)
                        r = d.send_finish(t1, ENR1, stu['submission_id'], pick)
                        if err(r) == 'too_many_pages': total['refused_at_finish'] += 1
                        elif g(r, 'ok'):
                            total['sent'] += 1; stu = None
                            if onto and 'teacher' in who(d, r['submission_id']): total['joined'] += 1
                        else: stu = None
                    elif op == 's_unsend':
                        d.unsend(t1, ENR1, a); stu = None
                    elif op == 't_start':
                        r = tstart(d, a, ENR1, rnd.choice(SIZES), mode=rnd.choice(['add', 'add', 'new', 'replace']))
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
                    elif op == 't_paper' and rnd.random() < 0.2:
                        d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1], k=nid())
                    m = most(d)
                    bad = d.one('select count(*) from submission_file_removal where path = any(:p)', p=list(held)) if held else 0
                    u = sound(d)
                    # Stuck: the teacher's work, not on paper, nothing graded, the piece open, and the student told already_sent.
                    w = piece(d, t1, ENR1, a)
                    if g(w, 'sent', 'sent_by') == 'teacher' and not g(w, 'sent', 'on_paper') and g(w, 'sent', 'can_send') is not True: total['stuck'] += 1
                    if m > 30: total['over_30'] += 1
                    if bad: total['teacher_file_queued_by_student'] += 1
                    if u: total['unsound'] += 1
                    if (m > 30 or bad or u) and len(first_bad) < 3: first_bad.append((seed, step, op, m, bad, u))
        print('# fuzz: %s' % total)
        n = len(seeds) * steps
        ok('fuzz: in %d random steps (seeds %s) no work handed in ever has more than 30 pages' % (n, list(seeds)), total['over_30'] == 0, (total, first_bad))
        ok("fuzz: no step of the student's (a start, a finish, an Unsend) ever queues a page the teacher had handed in", total['teacher_file_queued_by_student'] == 0, (total, first_bad))
        ok("fuzz: Batch B's own invariants hold after every step", total['unsound'] == 0, (total, first_bad))
        ok('fuzz: the student is never stuck behind the teacher\'s pages (can_send is true whenever the work in is the teacher\'s and not on paper, nothing graded, the piece open)', total['stuck'] == 0, total)
        ok('fuzz: the runs reached the new path: student sends that joined the teacher\'s pages', total['joined'] > 5, total)
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
# send_paths (approved by Colin, Nov 11): the paths of this student's own unfinished send, and nothing else.
def scen_paths():
    d, k, t1, t2 = world('paths', True); a = k['takes']
    P = lambda tok, e, sid: d.service("student_submit.send_paths(:t, :e, :s, 'ip-1')", t=tok, e=e, s=sid)
    try:
        with tx(d):
            s = d.send_start(t1, ENR1, a, 3); n0 = d.one('select count(*) from student_submit.send_log')
            cat0 = row_checksums(d.c, table_columns(d.c))
            r = P(t1, ENR1, s['submission_id'])
            ok("this student's own unfinished send: exactly the files the start named (_work_upload_json), its finish-by and the bucket",
               g(r, 'ok') is True and r['files'] == s['files'] and r['finish_by'] == s['finish_by'] and r['bucket'] == s['bucket']
               and r['submission_id'] == s['submission_id'] and r['assessment_id'] == a and r['version'] == 1, r)
            ok('it writes nothing: no row of any table changes, nothing is counted', row_checksums(d.c, table_columns(d.c)) == cat0 and d.one('select count(*) from student_submit.send_log') == n0)
            ok('the same files after they are uploaded, and the same again (a read)', (d.upload(s['files']), P(t1, ENR1, s['submission_id']))[1] == r)
            ok("another student's session asking for this send: not_found, no path", P(t2, ENR2, s['submission_id']) == {'ok': False, 'error': 'not_found'})
            ok("another student's session naming this student's enrollment: refused by the session check, no path", g(P(t2, ENR1, s['submission_id']), 'ok') is False
               and 'files' not in P(t2, ENR1, s['submission_id']))
            s2 = d.send_start(t2, ENR2, a, 1)
            ok("this student asking for another student's send: not_found", P(t1, ENR1, s2['submission_id']) == {'ok': False, 'error': 'not_found'})
            tt = tstart(d, a, ENR1, 2, mode='new')
            ok("the teacher's unfinished upload for this student: not_found (nobody but its sender sees an unfinished send's paths)", P(t1, ENR1, tt['submission_id']) == {'ok': False, 'error': 'not_found'})
            f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
            ok('once handed in: not_found (file_links is the way to read it)', g(f, 'ok') is True and P(t1, ENR1, s['submission_id']) == {'ok': False, 'error': 'not_found'})
            ok('a send that does not exist: not_found', P(t1, ENR1, nid()) == {'ok': False, 'error': 'not_found'})
            e = refused(d, lambda: P(t1, ENR1, None))
            ok('no submission: RAISES 22023', e is not None and e[1] == '22023', e)
        with tx(d):
            s = d.send_start(t1, ENR1, a, 1)
            d.run("update submission set created_at = now() - interval '2 hours 1 second' where id = :s", s=s['submission_id'])
            ok('past its two hours: expired, no path, nothing dropped by the read', P(t1, ENR1, s['submission_id']) == {'ok': False, 'error': 'expired'}
               and d.one('select count(*) from submission') == 1)
            d.run("update submission set created_at = now() - interval '1 hour 59 minutes' where id = :s", s=s['submission_id'])
            ok('at 1 h 59: its files', g(P(t1, ENR1, s['submission_id']), 'ok') is True)
        with tx(d):
            s1, _ = d.send(t1, ENR1, a, 1)
            r = d.send_start(t1, ENR1, a, 2, replace=True)
            ok("a Replace's unfinished pages: its own 2 files, none of the work it replaces", [x['file_id'] for x in P(t1, ENR1, r['submission_id'])['files']] == ids(r['files']))
            d.run("update student_card set locked_at = now() where enrollment_id = :e and stopped_at is null", e=ENR1)
            ok('a locked card: card_locked, no path', P(t1, ENR1, r['submission_id']) == {'ok': False, 'error': 'card_locked'})
        with tx(d):
            s = d.send_start(t1, ENR1, a, 1)
            ok('a session that is not one: refused, no path', 'files' not in (P('not-a-token', ENR1, s['submission_id']) or {}))
        fn = 'student_submit.send_paths(text,uuid,uuid,text)'
        ok('who can run it: the service role only (not anon, not a signed-in teacher)', run_by(d, fn) == ['service_role'], run_by(d, fn))
        ok('it is SECURITY DEFINER, stable, with pg_temp last in its search_path',
           d.one("select prosecdef and provolatile = 's' and proconfig = '{\"search_path=public, student_submit, pg_temp\"}' from pg_proc where oid = :f::regprocedure", f=fn))
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def procs(d, only=None):
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
def retouched(d, sig):
    return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig).replace('AS $function$\n', 'AS $function$\n\n', 1).replace('AS $function$', 'AS $function$ ', 1)
def stopped_at_guard(d, setup, want, sts):
    d.begin()
    try:
        for st in setup: d.run(st)
        try:
            for n, st in enumerate(sts):
                at = n
                if last(st) not in ('begin', 'commit'): d.run(st)
            return False, 'it ran'
        except Exception as e:
            return at == 2 and want in message(e) and 'Nothing was changed' in message(e), message(e)[:300]
    finally:
        d.rollback()
def body_of(t, name):
    i = t.index('create or replace function ' + name + '('); return t[i:t.index('$function$;\n', i) + len('$function$;')]
B1_T = lambda: text_at(bc.B1); FIX_T_ = lambda: text_at(bc.B_FIXES)
ORIGINAL = {'student_submit._send_begin': B1_T, 'student_submit.send_finish': FIX_T_, 'student_submit.work': B1_T}

def busy(d, k, t1, t2):
    """Work in every state, committed: the teacher's pages left by an Unsend; a student's send started on the last day of a
    piece that is now closed; another student's work with a teacher's page and an unfinished Add on it; a paper hand-in."""
    a = k['takes']
    teacher_left(d, t1, a, 1, 2)
    late = nid()
    d.run("insert into assessment (id, course_id, title, score_mode, max_points, students_send, due_date, after_due) values (:a, :c, 'Closing Lab', 'points', 10, 'photos', :d, 'stop')",
          a=late, c=COURSE_A, d=k['today'])
    s = d.send_start(t2, ENR2, late, 1); d.upload(s['files'])
    d.send(t2, ENR2, a, 1); tadd(d, a, ENR2, 1); t = tstart(d, a, ENR2, 1); tput(d, t['files'])
    d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['nothing'], e=[ENR2], k=nid())
    return {'late': late, 'late_send': s, 't': t}

def scen_apply():
    T = text_at(FILE); S = split(T)
    d, k, t1, t2 = world('apply', False)
    try:
        ok('the file is one transaction: begin first, commit last, only comments outside',
           last(S[0]) == 'begin' and last(S[-1]) == 'commit' and sum(last(s) in ('begin', 'commit') for s in S) == 2
           and all(l.strip() == '' or l.strip().startswith('--') for l in T.split('\nbegin;\n')[0].split('\n')) and T.rstrip().endswith('\ncommit;'))
        kinds = [re.sub(r'\s+', ' ', bare(s).strip().lower())[:26] for s in S[1:-1]]
        ok("between them: the lock timeout, its check, four CREATE OR REPLACE FUNCTION, send_paths' revoke and grant, its last check, the schema reload; nothing else",
           kinds[0].startswith('set local lock_timeout') and kinds[1].startswith('do $guard$') and sum(x.startswith('create or replace function') for x in kinds) == 4
           and kinds[-4].startswith('revoke all on function') and kinds[-3].startswith('grant execute on func')
           and kinds[-2].startswith('do $final$') and kinds[-1].startswith('notify pgrst') and len(kinds) == 10, kinds)
        made = [re.search(r'create or replace function ([\w.]+)\(', s).group(1) for s in S if bare(s).strip().lower().startswith('create or replace function')]
        ok('the three it replaces are _send_begin, send_finish and work, the one it adds send_paths, and the header names each', made == ['student_submit._send_begin', 'student_submit.send_finish', 'student_submit.work', 'student_submit.send_paths']
           and all(m in T.split('\nbegin;\n')[0] for m in made), made)
        tops = [bare(s) for s in S if not bare(s).strip().lower().startswith('create or replace function')]
        ok("no alter, drop or row change outside the function bodies; the only revoke and grant are send_paths' own, to the service role; no TODO",
           not re.search(r'^\s*(alter|drop|insert|update|delete|truncate)\b', '\n'.join(tops), re.I | re.M)
           and [t for t in tops if re.match(r'\s*(revoke|grant)\b', t, re.I)] == ['revoke all on function student_submit.send_paths(text, uuid, uuid, text) from public, anon, authenticated;'.rstrip(';'),
                                                                                    'grant execute on function student_submit.send_paths(text, uuid, uuid, text) to service_role;'.rstrip(';')]
           and 'TODO' not in T, [t for t in tops if re.match(r'\s*(revoke|grant)\b', t, re.I)])
        diffs = {}
        for m in made[:3]:
            old = body_of(ORIGINAL[m](), m).split('\n'); new = body_of(T, m).split('\n')
            diffs[m] = [l for l in difflib.unified_diff(old, new, lineterm='', n=0) if l[:1] in '+-' and l[:3] not in ('+++', '---')]
        print('# what changes in each body, comments aside:\n' + json.dumps({m: [l for l in v if not l[1:].strip().startswith('--')] for m, v in diffs.items()}, indent=1))
        removed = {m: [l for l in v if l.startswith('-') and not l[1:].strip().startswith('--')] for m, v in diffs.items()}
        ok("each body is the one before it with lines added; the only lines of code taken out or changed: in _send_begin the bare already_sent (now inside its if); in send_finish the closed check, the elsif that refused a new send (now else and its block), the move's if and the Late line; in work the end of can_change",
           removed['student_submit._send_begin'] == ["-        return jsonb_build_object('ok', false, 'error', 'already_sent');"]
           and len(removed['student_submit.send_finish']) == 9 and removed['student_submit.send_finish'][0] == "-    if not (_w->>'open')::boolean then"
           and removed['student_submit.send_finish'][-2:] == ["-    if _sub.intent = 'replace' then", "-           is_late = (_w->>'late')::boolean, sent_at = now(), updated_at = now()"]
           and len(removed['student_submit.work']) == 1, removed)
        lists = dict((n, l) for n, l in lists_of(T)[:3])
        ok('its lists: the three it replaces (before and after), the one it adds and the %d it relies on, the same in its first check and its last' % len(RELIED),
           [x[0] for x in lists['replaces']] == REPLACED and [x[0] for x in lists['new']] == NEW and [x[0] for x in lists['relied']] == RELIED
           and sorted(lists_of(T)[:3]) == sorted(lists_of(T)[3:]), [n for n, _ in lists_of(T)])
        ok("the 'before' fingerprints are the base's (Batch B, the fixes, C1, C2 applied)", fingerprints(d, REPLACED) == {x[0]: x[1] for x in lists['replaces']}
           and fingerprints(d, RELIED) == {x[0]: x[1] for x in lists['relied']})
        ok('the pre-check, on the base: no rows', read_only(d, PRE_Q) == [], read_only(d, PRE_Q))
        ok('the post-check, on the base: the four functions (send_paths absent, and how it is run), nothing else',
           sorted(x[0] for x in read_only(d, POST_Q)) == sorted(['function ' + f for f in REPLACED + NEW] + ['how ' + NEW[0] + ' is run']), read_only(d, POST_Q))
        # ── Each guard stops it, with nothing changed ───────────────────
        base = WorkDb('sr_apply_noc')
        try:
            r = base.file(FILE)
            ok('on a database with Batch B and the fixes but not Batch C, it stops at its first check, nothing changed', r.startswith('STOPPED') and base.at == 2 and 'not both applied' in r, r)
        finally:
            base.close()
        c2_out = [st for st in split(text_at(UNDO_C2)) if last(st) not in ('begin', 'commit')]
        good, said = stopped_at_guard(d, c2_out, 'public._markup_on_return()', S)
        ok("with C1 in and C2 taken out (C2's undo), it stops at its first check, naming C2's function, nothing changed", good, said)
        bad = []
        for fn in REPLACED + RELIED:
            good, said = stopped_at_guard(d, [retouched(d, fn)], fn, S)
            if not good: bad.append((fn, said))
        good, said = stopped_at_guard(d, ["create function student_submit.send_paths(text, uuid, uuid, text) returns jsonb language sql as $f$ select '{}'::jsonb $f$"], NEW[0], S)
        if not good: bad.append((NEW[0], said))
        ok('each of the %d functions in its lists with another body stops it at its first check, naming it, nothing changed' % (len(REPLACED) + len(RELIED)), bad == [], bad[:3])
        good, said = stopped_at_guard(d, ['drop function student_submit.work(text,uuid,text)'], 'student_submit.work', S)
        ok('one of the three missing: stops', good, said)
        h = Side(d); h.begin(); h.run(d.one("select pg_get_functiondef('student_submit.send_finish(text,uuid,uuid,jsonb,text)'::regprocedure)"))
        cat0 = catalog(d.c); t0 = time.time(); r = d.file(FILE); took = time.time() - t0
        h.c.run('rollback'); h.close()
        ok('while another session has replaced send_finish and not committed, the file gives up after five seconds with nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and 4.5 < took < 9 and catalog(d.c) == cat0, (r, took))
        # ── The apply, on a database in use ─────────────────────────────
        w = busy(d, k, t1, t2)
        cat0 = catalog(d.c); cols0 = table_columns(d.c); rows0 = row_checksums(d.c, cols0); p0 = procs(d)
        who0 = {fn: run_by(d, fn) for fn in REPLACED}
        r = d.file(FILE)
        ok('the file applies to a database in use', r == 'ok', r)
        ok('no row of any table changes', row_checksums(d.c, cols0) == rows0)
        gone, new = differences(cat0, catalog(d.c))
        dep = sorted(l for l in gone + new if l.startswith('depends '))
        ok('the only count lines that change are the dependencies of one more function: on its language and its schema',
           [l.rsplit(' | ', 1)[0] for l in dep] == ['depends pg_proc | pg_language | n', 'depends pg_proc | pg_language | n', 'depends pg_proc | pg_namespace | n', 'depends pg_proc | pg_namespace | n'], dep)
        gone = [l for l in gone if not l.startswith('depends ')]; new = [l for l in new if not l.startswith('depends ')]
        ok("in the whole catalog only the three functions' definitions differ, and send_paths is new", len(gone) in (3, 6) and len(new) > len(gone)
           and all(any(f.split('(')[0] in l for f in REPLACED) for l in gone)
           and all(any(f.split('(')[0] in l for f in REPLACED + NEW) for l in new), ([l[:90] for l in gone], [l[:90] for l in new]))
        p1 = procs(d)
        ok('each of the three keeps its oid, owner, grants, SECURITY DEFINER, search_path, volatility, arguments, result and language; only the body differs',
           all(p1[f][:-1] == p0[f][:-1] and p1[f][-1] != p0[f][-1] for f in REPLACED), {f: (p0[f][:6], p1[f][:6]) for f in REPLACED})
        ok('every other function in the database is untouched; the only new one is send_paths', {f: v for f, v in p1.items() if f not in REPLACED + NEW} == {f: v for f, v in p0.items() if f not in REPLACED}
           and set(p1) - set(p0) == set(NEW))
        ok('who may run the three is what it was: send_finish and work the service role only, _send_begin nobody (it is called by send_start and replace as their owner); anon and signed-in teachers nothing',
           {fn: run_by(d, fn) for fn in REPLACED} == who0 == {REPLACED[0]: [], REPLACED[1]: ['service_role'], REPLACED[2]: ['service_role']}, who0)
        ok("the three carry the 'after' fingerprints its list says", {f: p1[f][-1] for f in REPLACED} == {x[0]: x[2] for x in lists['replaces']})
        ok('the post-check, after it: no rows', read_only(d, POST_Q) == [], read_only(d, POST_Q))
        pre_now = read_only(d, PRE_Q)
        ok('the pre-check, after it: one row for each of the four, saying it is already applied (would not stop)',
           sorted((x[0], x[3]) for x in pre_now) == sorted(('function ' + f, 'no') for f in REPLACED + NEW), pre_now)
        # Work that was in progress when it was applied.
        tz, D, mid = midnight(d)
        d.run('update course set timezone = :z where id = :c', z=tz, c=COURSE_A)
        d.run("update assessment set due_date = :d where id = :a", d=day(D, -1), a=w['late'])
        started_at(d, w['late_send']['submission_id'], mid - datetime.timedelta(seconds=1))
        f = d.send_finish(t2, ENR2, w['late_send']['submission_id'], w['late_send']['files'])
        ok('a send started before the apply, on the last day of a piece that has since closed, is taken after it, Late', g(f, 'ok') is True and f['late'] is True, f)
        s, f = d.send(t1, ENR1, k['takes'], 1)
        ok("a student left behind the teacher's pages before the apply can send after it", g(f, 'ok') is True and who(d, s['submission_id']) == ['student', 'teacher', 'teacher'], f)
        ok('everything that must always hold, holds', sound(d) == '', sound(d))
        # ── A second run, and the files before it run again ─────────────
        cat2 = catalog(d.c); rows2 = row_checksums(d.c, cols0)
        r = d.file(FILE)
        ok('a second run applies and changes no catalog line and no row', r == 'ok' and (catalog(d.c), row_checksums(d.c, cols0)) == (cat2, rows2), r)
        r = d.file(C1)
        ok('C1 (2026111120) run again now stops at its first check, naming send_finish (it lists the fixes\' fingerprint), nothing changed',
           r.startswith('STOPPED') and 'student_submit.send_finish' in r and catalog(d.c) == cat2, r)
        r = d.file(bc.B_FIXES)
        ok('the fixes file run again stops at its first check, nothing changed', r.startswith('STOPPED') and catalog(d.c) == cat2, r)
        # ── Damage the post-check notices ───────────────────────────────
        for label, setup, want in (
                ('one of the three with another body', [retouched(d, REPLACED[1])], 'function ' + REPLACED[1]),
                ('one it relies on with another body', [retouched(d, 'student_submit._work_window(uuid)')], 'function student_submit._work_window(uuid)'),
                ('send_finish runnable by signed-in teachers', ['grant execute on function student_submit.send_finish(text,uuid,uuid,jsonb,text) to authenticated'], 'how ' + REPLACED[1] + ' is run'),
                ('work runnable by anon', ['grant execute on function student_submit.work(text,uuid,text) to anon'], 'how ' + REPLACED[2] + ' is run'),
                ('_send_begin made runnable by the service role', ['grant execute on function student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid) to service_role'], 'how ' + REPLACED[0] + ' is run'),
                ('work made volatile', ['alter function student_submit.work(text,uuid,text) volatile'], 'how ' + REPLACED[2] + ' is run'),
                ('send_finish made SECURITY INVOKER', ['alter function student_submit.send_finish(text,uuid,uuid,jsonb,text) security invoker'], 'how ' + REPLACED[1] + ' is run'),
                ('send_finish without pg_temp in its search_path', ['alter function student_submit.send_finish(text,uuid,uuid,jsonb,text) set search_path = public, student_submit'], 'SECURITY DEFINER without pg_temp last in its search_path'),
                ('work owned by another role', ['alter function student_submit.work(text,uuid,text) owner to service_role'], 'how ' + REPLACED[2] + ' is run')):
            d.begin()
            try:
                for st in setup: d.run(st)
                got = [x[0] for x in d.all(POST_Q)]
            finally:
                d.rollback()
            ok('the post-check notices %s' % label, want in got, got)
        # ── The pre-check notices ───────────────────────────────────────
        d2 = WorkDb('sr_apply_pre', template=template(False))
        try:
            for label, setup, want, stops in (
                    ('one it relies on with another body', [retouched(d2, 'public._work_settle_files(uuid,jsonb)')], 'function public._work_settle_files(uuid,jsonb)', 'yes'),
                    ('one of the three with another body', [retouched(d2, REPLACED[0])], 'function ' + REPLACED[0], 'yes'),
                    ('work runnable by anon', ['grant execute on function student_submit.work(text,uuid,text) to anon'], 'how ' + REPLACED[2] + ' is run', 'no')):
                d2.begin()
                try:
                    for st in setup: d2.run(st)
                    got = [(x[0], x[3]) for x in d2.all(PRE_Q)]
                finally:
                    d2.rollback()
                ok('the pre-check notices %s (stops: %s)' % (label, stops), (want, stops) in got, got)
        finally:
            d2.close()
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_undo():
    US = split(text_at(UNDO))
    d, k, t1, t2 = world('undo', False)
    try:
        ok('the undo is one transaction: begin, a lock timeout, its check, the three functions, its last check, commit',
           last(US[0]) == 'begin' and last(US[-1]) == 'commit' and US[1].strip().lower().endswith("set local lock_timeout = '5s'")
           and '$guard$' in US[2] and sum(bare(s).strip().lower().startswith('create or replace function') for s in US) == 3)
        ut = text_at(UNDO)
        ok("its three bodies are the ones before the file, character for character (_send_begin and work Batch B's, send_finish the fixes file's)",
           all(body_of(ORIGINAL[m](), m) in ut for m in ORIGINAL))
        ok("its lists are the file's", dict(lists_of(ut)) == dict(lists_of(text_at(FILE))))
        cat_b = catalog(d.c); p_b = procs(d)
        r = d.file(UNDO)
        ok('run where the file was never applied: it applies and changes nothing', r == 'ok' and catalog(d.c) == cat_b, r)
        ok('the file applies', d.file(FILE) == 'ok')
        a = k['takes']
        u, t, old = teacher_left(d, t1, a, 1, 2)
        s, f = d.send(t1, ENR1, a, 1)
        s2 = d.send_start(t2, ENR2, k['takes'], 1); d.upload(s2['files'])
        ts, tf = tadd(d, a, ENR2, 1, mode='new')
        cols = table_columns(d.c); rows1 = row_checksums(d.c, cols)
        r = d.file(UNDO)
        ok('the undo runs', r == 'ok', r)
        ok('send_paths is gone', d.one("select to_regprocedure('student_submit.send_paths(text,uuid,uuid,text)')") is None)
        ok('the three carry the fingerprints they had before the file', fingerprints(d, REPLACED) == {x[0]: x[1] for x in dict(lists_of(ut))['replaces']})
        ok('every function is as before the file, pg_proc column for column (the same oid, owner, grants, settings), and send_paths is gone', procs(d) == p_b)
        ok('the whole catalog is as before the file, line for line', catalog(d.c) == cat_b, differences(cat_b, catalog(d.c)))
        ok('no row of any table changed', row_checksums(d.c, cols) == rows1)
        ok("work handed in under the file stays as it is: the student's page, then the teacher's 2", who(d, s['submission_id']) == ['student', 'teacher', 'teacher'] and sound(d) == '')
        f2 = d.send_finish(t2, ENR2, s2['submission_id'], s2['files'])
        ok("a send started under the file onto the teacher's work is answered as before the file when finished after the undo: already_sent, dropped", err(f2) == 'already_sent', f2)
        ok("and a student behind the teacher's pages is refused again (already_sent)", err(d.send_start(t2, ENR2, a, 1)) == 'already_sent')
        ok("the post-check lists the four functions", sorted(x[0] for x in read_only(d, POST_Q)) == sorted(['function ' + f for f in REPLACED + NEW] + ['how ' + NEW[0] + ' is run']))
        ok('the pre-check is silent again', read_only(d, PRE_Q) == [], read_only(d, PRE_Q))
        cat3 = catalog(d.c)
        ok('the undo a second time: runs, changes nothing', d.file(UNDO) == 'ok' and catalog(d.c) == cat3)
        ok('the file applies again after the undo, and its post-check is silent', d.file(FILE) == 'ok' and read_only(d, POST_Q) == [])
        for fn in ('student_submit._work_window(uuid)', REPLACED[1]):
            good, said = stopped_at_guard(d, [retouched(d, fn)], fn, US)
            ok('the undo stops at its check, nothing changed, when %s has another body' % fn.split('(')[0], good, said)
        # ── The order out ───────────────────────────────────────────────
        d.run("delete from submission"); d.run("delete from submission_file_removal")
        cat4 = catalog(d.c)
        d.begin()
        try:
            for st in split(text_at(UNDO_C2)) + split(text_at(UNDO_C1)):
                if last(st) not in ('begin', 'commit'): d.run(st)
            e = refused(d, lambda: d.work(t1, ENR1))
            ok("WITH THE FILE IN, Batch C's undo (C2's, then C1's PART 2) runs, and then the student's page fails: work() names revision_request, which C1's undo drops. So the order out is this undo first",
               e is not None and 'revision_request' in e[0], e)
        finally:
            d.rollback()
        ok('(that was rolled back)', catalog(d.c) == cat4)
        good, said = stopped_at_guard(d, [st for st in split(text_at(UNDO_C2)) if last(st) not in ('begin', 'commit')], 'public._markup_on_return()', US)
        ok("after C2's undo, this undo stops at its check, naming C2's function, nothing changed: run it first", good, said)
        ok('(that was rolled back too)', catalog(d.c) == cat4)
        r0 = d.file(UNDO); r = d.file(UNDO_C2); r1 = d.file(UNDO_C1)
        w = d.work(t1, ENR1)
        ok("the order out: this undo, then C2's, then C1's: each runs, and the student's page works on Batch B and the fixes alone", (r0, r, r1) == ('ok', 'ok', 'ok') and g(w, 'ok') is True, (r0, r[:120], r1[:120], w))
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def write_lists(text, lists):
    out = []; pos = 0
    for m in BEGIN.finditer(text):
        which = m.group(2)
        if which not in lists: continue
        end = text.index('-- FINGERPRINTS-END', m.end()); end_line = text.rfind('\n', 0, end)
        rows = lists[which]; ind = m.group(1); width = max(len(x[0]) for x in rows) + 3
        body = ',\n'.join("%s(%s %s)" % (ind, ("'%s'," % x[0]).ljust(width), ', '.join("'%s'" % v for v in x[1:])) for x in rows)
        out.append(text[pos:m.end()] + '\n' + body); pos = end_line
    return ''.join(out) + text[pos:]

def cmd_fingerprints(check_only):
    d0 = WorkDb('sr_fp0', template=template(False))
    try:
        before = fingerprints(d0, REPLACED); relied = fingerprints(d0, RELIED)
        r = d0.statements(split(neutral(text_at(FILE))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        after_ = fingerprints(d0, REPLACED); new_ = fingerprints(d0, NEW)
    finally:
        d0.close()
    lists = {'replaces': [(f, before[f], after_[f]) for f in REPLACED], 'relied': [(f, relied[f]) for f in RELIED], 'new': [(f, new_[f]) for f in NEW]}
    stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel); was = open(path).read(); now = write_lists(was, lists)
        if now != was:
            stale.append(rel)
            if not check_only: open(path, 'w').write(now)
    print(json.dumps(lists['replaces'], indent=1))
    if check_only: print('stale: ' + ', '.join(stale) if stale else 'every list is current'); return 1 if stale else 0
    print('rewritten: ' + (', '.join(stale) or 'nothing (every list was current)')); return 0

# ── Wrong versions of the file: does this suite notice? ─────────────────────
MUTANTS = [
    # ruling 106
    ('106: the finish refuses after the last day, as before (the change taken out)',
     "       and ((_sub.created_at at time zone public._fv_timezone(_course.timezone))::date <= (_w->>'closes_on')::date) is not true then", '       then'),
    ('106: the finish never asks whether the piece is closed', "    if not (_w->>'open')::boolean\n       and ((_sub", "    if false and not (_w->>'open')::boolean\n       and ((_sub"),
    ('106: a send started on the last day itself is refused (< for <=)', "::date <= (_w->>'closes_on')::date) is not true", "::date < (_w->>'closes_on')::date) is not true"),
    ("106: the start's day is read in the connection's time zone, not the class's", "(_sub.created_at at time zone public._fv_timezone(_course.timezone))::date <=", "(_sub.created_at)::date <="),
    ("106: the day asked is today, not the start's", "(_sub.created_at at time zone public._fv_timezone(_course.timezone))::date <=", "(now() at time zone public._fv_timezone(_course.timezone))::date <="),
    ('106: the last day is always the due date (Until ignored)', "<= (_w->>'closes_on')::date) is not true", "<= _a.due_date) is not true"),
    ('106: a send finished after the last day is not marked Late unless after the due date', "is_late = (_w->>'late')::boolean or (_w->>'open')::boolean is false,", "is_late = (_w->>'late')::boolean,"),
    ('106: Late is the start\'s, not the finish\'s', "is_late = (_w->>'late')::boolean or (_w->>'open')::boolean is false,", "is_late = _sub.is_late,"),
    # ruling 107, the start
    ('107 start: already_sent as before (the change taken out)', "        if _sent.sent_by <> 'teacher' or _sent.on_paper\n", "        if true or _sent.on_paper\n"),
    ('107 start: work on paper is not excluded', "        if _sent.sent_by <> 'teacher' or _sent.on_paper\n", "        if _sent.sent_by <> 'teacher'\n"),
    ("107 start: the student's own work is not excluded", "        if _sent.sent_by <> 'teacher' or _sent.on_paper\n", "        if _sent.on_paper\n"),
    ('107 start: grading is not asked', "        if _grading_started(p_enrollment_id, _a.id) then\n            return jsonb_build_object('ok', false, 'error', 'grading_started');\n        end if;\n        -- The teacher's pages stay: with them the new pages must fit in 30.",
     "        -- The teacher's pages stay: with them the new pages must fit in 30."),
    ('107 start: the 30 is not asked', "        if _theirs + jsonb_array_length(p_pages) > 30 then\n            return jsonb_build_object('ok', false, 'error', 'too_many_pages', 'room', greatest(30 - _theirs, 0));", "        if false then\n            return null;"),
    ('107 start: an open revision is not excluded', "           or exists (select 1 from revision_request r\n                       where r.assessment_id = _a.id and r.enrollment_id = p_enrollment_id and r.state = 'open') then\n            return jsonb_build_object('ok', false, 'error', 'already_sent');",
     " then\n            return jsonb_build_object('ok', false, 'error', 'already_sent');"),
    # ruling 107, the finish
    ('107 finish: already_sent as before', "            if _target.sent_by <> 'teacher' or _target.on_paper\n", "            if true or _target.on_paper\n"),
    ('107 finish: the teacher\'s pages are not moved (deleted with their row)', "    if _target.id is not null then\n        -- The student's old pages go.", "    if _sub.intent = 'replace' then\n        -- The student's old pages go."),
    ("107 finish: the teacher's pages put first", "           set submission_id = _sub.id, page = _pages + x.rn", "           set submission_id = _sub.id, page = x.rn + 100"),
    ('107 finish: work on paper is joined', "            if _target.sent_by <> 'teacher' or _target.on_paper\n", "            if _target.sent_by <> 'teacher'\n"),
    ('107 finish: grading is not asked', "            if _grading_started(p_enrollment_id, _sub.assessment_id) then\n                -- As for a Replace", "            if false then\n                -- As for a Replace"),
    ('107 finish: the 30 is not asked', "            if _theirs + jsonb_array_length(p_files) > 30 then\n                return", "            if false then\n                return"),
    # review F2: a revision's pages (version 2 and later) are revision_finish's only
    ("F2: send_finish takes a revision's pages (the reviewed version: the check taken out)", "    if _sub.version <> 1 then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n", ''),
    ("F2: refused, but the revision's send is dropped", "    if _sub.version <> 1 then\n        return jsonb_build_object('ok', false, 'error', 'not_found');",
     "    if _sub.version <> 1 then\n        delete from submission where id = _sub.id;\n        return jsonb_build_object('ok', false, 'error', 'not_found');"),
    ("F2: refused only when something is in (as the reviewed file's join did)", "    if _sub.version <> 1 then\n        return",
     "    if _sub.version <> 1 and exists (select 1 from submission x where x.assessment_id = _sub.assessment_id and x.enrollment_id = p_enrollment_id and x.state = 'sent') then\n        return"),
    ("F2: only version 3 and later refused", "    if _sub.version <> 1 then\n        return", "    if _sub.version > 2 then\n        return"),
    ("107 finish: the teacher's unfinished Add is not moved", "        update submission set target_id = _sub.id\n         where target_id = _target.id and state = 'sending' and sent_by = 'teacher' and intent = 'add';\n", ''),
    ('107 finish: the work keeps the teacher\'s version', "version = coalesce(_target.version, version),", "version = version,"),
    # work()
    ('107 work: can_send ignores on paper', "'can_send', s.sent_by = 'teacher' and not s.on_paper and", "'can_send', s.sent_by = 'teacher' and"),
    ("107 work: can_send ignores grading", "'can_send', s.sent_by = 'teacher' and not s.on_paper and not g.started and", "'can_send', s.sent_by = 'teacher' and not s.on_paper and"),
    ('107 work: can_send ignores the piece being closed', "                                               and a.students_send <> 'nothing' and (w.j->>'open')::boolean\n                                               and not exists", "                                               and a.students_send <> 'nothing'\n                                               and not exists"),
    ('107 work: can_send is true for the student\'s own work', "'can_send', s.sent_by = 'teacher' and", "'can_send', s.sent_by in ('teacher', 'student') and"),
    # send_paths (section 4)
    ("paths: another student's send is answered", "     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = (_in->>'course_id')::uuid\n       and sent_by = 'student' and state = 'sending';",
     "     where id = p_submission_id\n       and sent_by = 'student' and state = 'sending';"),
    ("paths: the teacher's unfinished upload is answered", "       and sent_by = 'student' and state = 'sending';\n    if not found then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n    if _sub.created_at",
     "       and state = 'sending';\n    if not found then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n    if _sub.created_at"),
    ('paths: work handed in is answered', "       and sent_by = 'student' and state = 'sending';\n    if not found then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n    if _sub.created_at",
     "       and sent_by = 'student';\n    if not found then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n    if _sub.created_at"),
    ('paths: a send past its two hours is answered', "    if _sub.created_at < now() - public._work_hold() then\n        -- It has lost", "    if false then\n        -- It has lost"),
    ('paths: a locked card is answered (the page session, not the send session)', "    _in := _send_session(p_session_token, p_enrollment_id);\n    if _in ? 'error' then\n        return jsonb_build_object('ok', false, 'error', _in->>'error');\n    end if;\n    -- This student's own send, not finished",
     "    _in := _session_class(p_session_token, p_enrollment_id);\n    if _in ? 'error' then\n        return jsonb_build_object('ok', false, 'error', _in->>'error');\n    end if;\n    -- This student's own send, not finished"),
    ('paths: runnable by signed-in teachers', "grant execute on function student_submit.send_paths(text, uuid, uuid, text) to service_role;", "grant execute on function student_submit.send_paths(text, uuid, uuid, text) to service_role, authenticated;"),
]

def cmd_mutate(wanted):
    import subprocess, tempfile
    tmp = tempfile.mkdtemp(prefix='send-rules-mutate-'); text = text_at(FILE); unnoticed = []
    for n, (label, old, new) in enumerate(MUTANTS, 1):
        if wanted and n not in wanted: continue
        if text.count(old) != 1:
            print('%2d  CANNOT MAKE THIS CHANGE (its text is in the file %d times): %s' % (n, text.count(old), label)); unnoticed.append(n); continue
        path = os.path.join(tmp, 'm%d.sql' % n); open(path, 'w').write(text.replace(old, new))
        r = subprocess.run([sys.executable, os.path.join(HERE, 'send_rules.py'), 'rule106', 'rule107', 'interleave', 'paths'], capture_output=True, text=True, cwd=HERE,
                           env=dict(os.environ, SEND_RULES_FILE=path))
        fails = [l[5:].split(' :: ')[0] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        if fails: print('%2d  noticed by %3d checks  %s\n      first: %s' % (n, len(fails), label, fails[0][:170]))
        elif r.returncode != 0: print('%2d  noticed: the suite stopped  %s\n      %s' % (n, label, (r.stderr.strip().splitlines() or ['?'])[-1][:170]))
        else: print('%2d  NOT NOTICED  %s' % (n, label)); unnoticed.append(n)
        sys.stdout.flush()
    print('%d changes, %d not noticed%s' % (len(wanted) or len(MUTANTS), len(unnoticed), ': ' + ', '.join(map(str, unnoticed)) if unnoticed else ''))
    return 1 if unnoticed else 0

PRE_Q = split(text_at(PRE))[0] if os.path.exists(os.path.join(HERE, PRE)) else None
POST_Q = split(text_at(POST))[0] if os.path.exists(os.path.join(HERE, POST)) else None
SCENARIOS = {'rule106': scen_rule106, 'rule106-without': lambda: scen_rule106(False), 'rule107': scen_rule107, 'rule107-without': lambda: scen_rule107(False),
             'interleave': scen_interleave, 'interleave-without': lambda: scen_interleave(False), 'race': scen_race, 'race-without': lambda: scen_race(False),
             'fuzz': scen_fuzz, 'paths': scen_paths, 'apply': scen_apply, 'undo': scen_undo}
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
