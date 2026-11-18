"""Quizzes, the student page's list: migrations/2026111807_quizzes_student_list.sql on a database rebuilt from the repo
and proved equal to live (scripts/db-rebuild.mjs --check), which has MQ1 and MQ2 (2026111804 to 2026111806) already
(README.md, "Quizzes, the student page's list"). The contract is quizzes-contract.md, "The student's side (MQ2)",
"quiz_list". The world, the teacher's quizzes and the three student functions are quizzes_student.py's.

    PGPORT=<port> PGDATABASE=<db> python3 quizzes_student_list.py          every scenario below
    FV_NONSUPER=<role>       every scenario as a role that is not a superuser, with live's default privileges
    FV_ICU_DB, FV_C_DB       the two templates scenario collations uses (ICU en-US as live, and C)

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  list      Exactly the pieces quiz would open (listed, not a Draft, not next week's, not DIBELS, not a pair or group
            piece, a quiz row, this class), in id order; each entry's keys are the contract's; tries_left, can_answer,
            closed and has_open_try at every stage: not opened, opened, sent (one try, two, unlimited), closed with an
            open try, reopened while closed, reopened and not yet opened; it agrees with what quiz answers then.
  nowrite   It writes nothing: no try, no row, no lock left on a quiz row, no write_log row, not after 700 calls (no
            too_many); it is marked stable and a stable function cannot write; a quiz row held for update by the
            teacher does not make it wait.
  leak      The key's markers, the competencies, the questions' words, another student's tries: none in any reply.
  refused   A paused, withdrawn, page-off, trash, stopped-card, expired-card, unknown-session and expired-session
            student, a classmate's and a made-up enrolment, each refused with its code; another student's session
            sees only their own tries; the student's other class on the same device lists only that class's quizzes.
  others    anon, authenticated and public may not run it; service_role may; owner, path pinned, stable.
  apply     The guards stop with the catalog unchanged (each relied-on function changed, one missing, a quiz_list
            elsewhere, a quiz_attempt column missing, the wrong role); the pre-check names each; only the header's
            change; no row changed; the header's md5s; post-check; a second run; size; plain ASCII, no backslash.
  lastcheck Each part the last check reads (md5, grant, owner, stable) tripped alone and two at once: named, nothing left.
  undo      PART 1 alone drops it (a revoke would stop nothing); MQ2's routes still work; the file gives it back; a
            changed function stops it; sent whole; a second run; on a database without the file nothing changes.
  collations On ICU en-US and on C: pre-check empty, apply, second run, post-check, undo, apply again; same md5s.
"""
import json, os, re, sys, threading, time
if os.environ.get("PG8000_PATH"): sys.path.insert(0, os.environ["PG8000_PATH"])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import ok, finish, nid, message, sqlstate, split, text_of, tx
from catalog import catalog, differences
import quizzes_student as qs
from quizzes_student import (T, S, Q, SV, SD, md5, sums, log_rows, refusal, tsave, payload, settings, tf, attempts, norm, same,
                             Conn, MARK_WHY, MARK_NUM, MARK_TOL, MARK_NOTE, A)

FILE = '../2026111807_quizzes_student_list.sql'
UNDO = 'quizzes-student-list-undo.sql'
PRE = 'quizzes-student-list-live-precheck.sql'
POST = 'quizzes-student-list-live-postcheck.sql'
LIST = 'student_submit.quiz_list(text,uuid,text)'
RELIED = ['student_submit._session_class(text,uuid)', 'student_submit._card_refusal(uuid)', 'student_submit._device_session(text)',
          'student_submit._listed(public.assessment,date)', 'student_submit._quiz_window(uuid,uuid)',
          'student_submit.quiz(text,uuid,uuid,text,boolean)', 'public._fv_timezone(text)']
HEADER = text_of(FILE)
K_LIST = {'ok', 'quizzes'}
K_ENTRY = {'assessment_id', 'tries_left', 'can_answer', 'closed', 'has_open_try'}

def applied(d): return d.one("select to_regprocedure('student_submit.quiz_list(text,uuid,text)') is not null")
def header_md5s():
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    relied = dict(re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})$', HEADER, re.M))
    return new, relied
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]

def world(tag, with_file=True, template=None):
    """quizzes_student.py's world, with MQ2 kept (the template has it, or it is applied again: a second run changes
    nothing); then this file."""
    qs_applied = qs.applied
    qs.applied = lambda d: False
    try:
        w = qs.world('l_' + tag, with_file=True, template=template)
    finally:
        qs.applied = qs_applied
    d = w.d
    if applied(d):
        r = d.file(UNDO); ok('(setup %s) the template goes back to before the file' % tag, r == 'ok' and not applied(d), r)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def L(w, e=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.quiz_list(:t, :e, 'ip')", t=tok or w.tok.get(e), e=e)
def entry(r, a):
    got = [x for x in r['quizzes'] if x['assessment_id'] == a]
    return got[0] if got else None

def scen_list():
    w = world('list'); d = w.d
    r = L(w)
    ok('list: the answer has exactly ok and quizzes', set(r) == K_LIST and r['ok'] is True, r)
    ok("list: each entry has exactly the contract's five keys", all(set(x) == K_ENTRY for x in r['quizzes']), r['quizzes'][:1])
    want = sorted([w.a, w.a2, w.au])
    ok('list: exactly the quizzes Cece may open, in id order (no Draft, next week, DIBELS, no-quiz piece, other class)',
       [x['assessment_id'] for x in r['quizzes']] == want, [x['assessment_id'] for x in r['quizzes']])
    ok('list: not opened: one try left, can answer, open, no open try',
       entry(r, w.a) == {'assessment_id': w.a, 'tries_left': 1, 'can_answer': True, 'closed': False, 'has_open_try': False}, entry(r, w.a))
    ok('list: unlimited: tries_left null', entry(r, w.au)['tries_left'] is None and entry(r, w.au)['can_answer'] is True)
    ok('list: two tries: two left', entry(r, w.a2)['tries_left'] == 2)
    Q(w)
    ok('list: opened: an open try, can answer, no tries left', entry(L(w), w.a) == {'assessment_id': w.a, 'tries_left': 0, 'can_answer': True,
                                                                                       'closed': False, 'has_open_try': True})
    SD(w)
    ok('list: one try sent: nothing to answer, no open try', entry(L(w), w.a) == {'assessment_id': w.a, 'tries_left': 0, 'can_answer': False,
                                                                                    'closed': False, 'has_open_try': False})
    Q(w, a=w.a2); SD(w, a=w.a2)
    e2 = entry(L(w), w.a2); q2 = Q(w, a=w.a2)
    ok('list: two tries, one sent: one left, can answer (Try Again), as quiz says', e2['tries_left'] == 1 and e2['can_answer'] is True
       and e2['has_open_try'] is False and q2['can_try_again'] is True, (e2, q2['can_try_again']))
    Q(w, a=w.au); SD(w, a=w.au)
    ok('list: unlimited, one sent: can answer again', entry(L(w), w.au)['can_answer'] is True and entry(L(w), w.au)['tries_left'] is None)
    # Closed with an ordinary try open: closed, cannot answer, the try is open.
    Q(w, e=w.dev)
    settings(w, w.a, after_due='until', accept_until='2020-01-01')
    e = entry(L(w, e=w.dev), w.a)
    ok('list: closed with an open ordinary try: closed, cannot answer, has an open try',
       e == {'assessment_id': w.a, 'tries_left': 0, 'can_answer': False, 'closed': True, 'has_open_try': True} and Q(w, e=w.dev)['can_answer'] is False, e)
    T(d, 'reopen_quiz(:a, :e, null)', a=w.a, e=w.dev)
    e = entry(L(w, e=w.dev), w.a)
    ok('list: that try reopened: answerable though closed', e['can_answer'] is True and e['closed'] is True and e['has_open_try'] is True, e)
    T(d, 'reopen_quiz(:a, :e, null)', a=w.a, e=w.cece)
    n = d.one('select count(*) from quiz_attempt where assessment_id = :a and enrollment_id = :e and started_at is null', a=w.a, e=w.cece)
    e = entry(L(w), w.a)
    ok('list: Cece reopened after her sent try: an open try not yet opened, answerable, and listing it does not open it',
       e['has_open_try'] is True and e['can_answer'] is True and n == 1
       and d.one('select count(*) from quiz_attempt where assessment_id = :a and enrollment_id = :e and started_at is null', a=w.a, e=w.cece) == 1, e)
    ok('list: and quiz then opens it, as the list said', Q(w)['can_answer'] is True)
    # A closed quiz not opened: closed, nothing to answer.
    ok("list: closed, Eli never opened it: closed, cannot answer, no open try",
       entry(L(w, e=w.eli), w.a) == {'assessment_id': w.a, 'tries_left': 1, 'can_answer': False, 'closed': True, 'has_open_try': False})
    # Pair and group: gone from the list, as quiz refuses them.
    for mode in ('pairs', 'groups'):
        T(d, 'save_collab(:a, :m, null)', a=w.a2, m=mode)
        ok('list: a quiz switched to %s is not listed, and quiz says not_found' % mode, entry(L(w), w.a2) is None
           and Q(w, a=w.a2) == {'ok': False, 'error': 'not_found'})
    T(d, "save_collab(:a, 'none', null)", a=w.a2)
    ok('list: switched back, listed again', entry(L(w), w.a2) is not None)
    # Next week's piece, once assigned today; a Draft once assigned.
    d.run('update assessment set date_assigned = current_date where id = :a', a=w.later)
    T(d, "update_assessment(:a, '{\"is_draft\": false}'::jsonb)", a=w.draft)
    ok('list: a piece assigned today and a Draft once assigned are listed', entry(L(w), w.later) is not None and entry(L(w), w.draft) is not None)
    d.run('update assessment set date_assigned = current_date + 7 where id = :a', a=w.later)
    ok('list: put back to next week, not listed', entry(L(w), w.later) is None)
    # The list agrees with quiz for every piece and student.
    for e_ in (w.cece, w.dev, w.eli):
        for x in L(w, e=e_)['quizzes']:
            n0 = log_rows(d)
            had = attempts(d, x['assessment_id'], e_)
            if not had: continue
            q = Q(w, e=e_, a=x['assessment_id'])
            ok('list: for %s on %s it says what quiz says' % (e_[:4], x['assessment_id'][:4]),
               x['closed'] == q['quiz']['closed'] and x['tries_left'] == q['quiz']['tries_left']
               and x['can_answer'] == (q['can_answer'] or q['can_try_again']), (x, q['quiz'], q['can_answer'], q['can_try_again']))
    ok("list: another teacher's student lists only her class's quiz; Cece's other class on the device only its own", L(w, e=w.bea) == {'ok': True, 'quizzes': [{'assessment_id': w.ab, 'tries_left': 1,
                                                                                                         'can_answer': True, 'closed': False, 'has_open_try': False}]}
       and S(d, "student_submit.quiz_list(:t, :e, 'ip')", t=w.tok[w.cece2], e=w.cece2)['quizzes'][0]['assessment_id'] == w.soc)
    T(d, 'save_quiz(:a, null, null)', qs.B, a=w.ab)
    ok('list: a class with no quiz answers an empty list', L(w, e=w.bea) == {'ok': True, 'quizzes': []}, L(w, e=w.bea))
    d.close()

def scen_nowrite():
    w = world('nowrite'); d = w.d
    Q(w); SV(w, w.q[1], True)
    s0 = sums(d); n0 = log_rows(d)
    xmax = d.all('select assessment_id::text, xmax::text from quiz order by 1')
    for _ in range(700): r = L(w)
    ok('nowrite: 700 lists in an hour: still ok, never too_many', r.get('ok') is True, r)
    ok('nowrite: no row changed or added, no write_log row', sums(d) == s0 and log_rows(d) == n0)
    ok('nowrite: no lock was taken on a quiz row (xmax unchanged)', d.all('select assessment_id::text, xmax::text from quiz order by 1') == xmax)
    ok('nowrite: it is marked stable', d.one("select provolatile from pg_proc where oid = to_regprocedure(:s)", s=LIST) == 's')
    x = refusal(lambda: d.run("""do $$ begin perform student_submit.quiz_list('x', null, 'ip'); end $$"""))
    ok('(setup) the call itself runs', x is None, x)
    # A quiz row held for update by the teacher (save_quiz) does not make the list wait.
    hold = Conn(d); hold.run('begin'); hold.run("select 1 from public.quiz where assessment_id = '%s' for update" % w.a)
    t0 = time.time(); r = L(w); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('nowrite: with the teacher holding the quiz for a save, the list answers at once', r.get('ok') is True and took < 1, took)
    d.close()

def scen_leak():
    w = world('leak'); d = w.d
    replies = [L(w), L(w, e=w.dev)]
    Q(w); SV(w, w.q[3], 'Cece words'); SD(w); Q(w, e=w.dev); SV(w, w.q[3], 'Dev words', e=w.dev)
    tid = d.one('select id::text from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=w.cece)
    T(d, 'mark_quiz_answer(:t, :q, 2, :n, null)', t=tid, q=w.q[3], n=MARK_NOTE)
    T(d, 'confirm_quiz(:a, cast(:m as jsonb), null)', a=w.a, m=json.dumps([{'attempt_id': tid, 'marked': {'earned': 4.25, 'possible': 8, 'questions': {}}}]))
    for e in (w.cece, w.dev, w.eli): replies.append(L(w, e=e))
    blob = json.dumps(replies)
    for label, needle in (("the key's why line", MARK_WHY), ('the number key', str(MARK_NUM)), ('the tolerance', str(MARK_TOL)),
                          ("a teacher's note", MARK_NOTE), ('a confirmed total', '4.25'), ("a question's words", 'producer'),
                          ("an answer", 'words'), ('a question id', w.q[0]), ('an attempt id', tid), ('marked', 'marked'),
                          ('a competency key', 'tag_id'), ('earned', 'earned')):
        ok('leak: %s is in no reply' % label, needle not in blob)
    for t in w.t: ok('leak: competency %s is in no reply' % t[:8], t not in blob)
    ok("leak: Dev's list says nothing of Cece's sent try", entry(replies[-2], w.a)['has_open_try'] is True and entry(replies[-2], w.a)['tries_left'] == 0
       and entry(replies[-1], w.a)['has_open_try'] is False and entry(replies[-1], w.a)['tries_left'] == 1)
    ok('leak: the function never names quiz_key, quiz_question or quiz_answer',
       not re.search('quiz_key|quiz_question|quiz_answer', d.one('select pg_get_functiondef(to_regprocedure(:s))', s=LIST)))
    d.close()

def scen_refused():
    w = world('refused'); d = w.d
    cases = qs_cases()
    for label, do, undo, want in cases:
        d.run(do, e=w.dev); n = log_rows(d); s0 = sums(d)
        r = L(w, e=w.dev)
        ok('refused: %s is %s' % (label, want), r == {'ok': False, 'error': want}, r)
        ok('refused: %s: nothing written' % label, log_rows(d) == n and sums(d) == s0)
        d.run(undo, e=w.dev)
        ok('refused: (setup) %s put back' % label, L(w, e=w.dev).get('ok') is True)
    for label, e, t, want in (('an unknown session', w.dev, 'f' * 64, 'signed_out'), ('a token of the wrong shape', w.dev, 'x', 'signed_out'),
                              ("an enrolment not on this session (a classmate's)", w.eli, w.tok[w.dev], 'not_found'),
                              ('an enrolment that is not there', nid(), w.tok[w.dev], 'not_found'), ('a null enrolment', None, w.tok[w.dev], 'not_found'),
                              ('a withdrawn student with a card', w.wes, w.tok[w.wes], 'not_found')):
        r = L(w, e=e, tok=t)
        ok('refused: %s is %s' % (label, want), r == {'ok': False, 'error': want}, r)
    Q(w); SD(w)
    ok("refused: Dev's own session lists his own tries, not Cece's", entry(L(w, e=w.dev), w.a)['tries_left'] == 1)
    ok("refused: Cece's other class on her device lists only its own quiz", [x['assessment_id'] for x in L(w, e=w.cece2)['quizzes']] == [w.soc])
    d.close()

def qs_cases():
    return (
        ('a student paused in the middle of a session', 'update enrollment set page_paused_at = now() where id = :e', 'update enrollment set page_paused_at = null where id = :e', 'closed'),
        ('a withdrawn student', 'update enrollment set withdrawn_at = now() where id = :e', 'update enrollment set withdrawn_at = null where id = :e', 'not_found'),
        ('a class with its Student Page off', 'update course set student_page_enabled = false where id = (select course_id from enrollment where id = :e)',
         'update course set student_page_enabled = true where id = (select course_id from enrollment where id = :e)', 'closed'),
        ('a class in the trash', 'update course set deleted_at = now() where id = (select course_id from enrollment where id = :e)',
         'update course set deleted_at = null where id = (select course_id from enrollment where id = :e)', 'not_found'),
        ('a stopped card', 'update student_card set stopped_at = now() where enrollment_id = :e', 'update student_card set stopped_at = null where enrollment_id = :e', 'card_stopped'),
        ('an expired card', 'update student_card set works_until = current_date - 3 where enrollment_id = :e',
         'update student_card set works_until = current_date + 300 where enrollment_id = :e', 'card_expired'),
        ('an expired session', "update student_submit.device_session set expires_at = now() - interval '1 minute' where id in (select session_id from student_submit.device_session_enrollment where enrollment_id = :e)",
         "update student_submit.device_session set expires_at = now() + interval '1 day' where id in (select session_id from student_submit.device_session_enrollment where enrollment_id = :e)", 'signed_out'),
    )

def scen_others():
    w = world('others'); d = w.d
    for role in ('anon', 'authenticated'):
        r = refusal(lambda: d.role(role, "select student_submit.quiz_list(:t, :e, 'ip')", uid=A if role == 'authenticated' else None, t=w.tok[w.cece], e=w.cece))
        ok('others: %s may not run quiz_list' % role, r and r[0] == '42501', r)
    owner = d.one("select proowner::regrole::text from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')")
    ok('others: granted to service_role and its owner alone', d.one('select proacl::text from pg_proc where oid = to_regprocedure(:s)', s=LIST)
       == '{%s=X/%s,service_role=X/%s}' % (owner, owner, owner))
    ok('others: owned by the owner of _session_class, path pinned, security definer, stable',
       d.one("select proowner::regrole::text = :o and prosecdef and provolatile = 's' and proconfig = array['search_path=public, student_submit, pg_temp'] from pg_proc where oid = to_regprocedure(:s)", s=LIST, o=owner) is True)
    ok('others: service_role runs it', L(w).get('ok') is True)
    d.close()

EXPECTED = re.compile(r'quiz_list|^depends |pg_depend|^comments on ')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog(d.c); s0 = sums(d)
    new, relied = header_md5s()
    ok('apply: the header names its new function and the seven it relies on', sorted(new) == [LIST] and sorted(relied) == sorted(RELIED), (new, relied))
    ok("apply: the relied-on functions are the header's here", all(md5(d, s) == relied[s] for s in RELIED), {s: md5(d, s) for s in RELIED})
    pre = split(text_of(PRE))
    ok('apply: the pre-check returns no rows before', d.statements(pre) == 'ok' and d.rows == [], d.rows)
    def guard(name, setup, undo, expect):
        d.run(setup); before = catalog(d.c)
        r = d.file(FILE)
        ok('apply guard: %s stops the file' % name, r.startswith('STOPPED') and expect in r, r)
        ok('apply guard: %s leaves the catalog as it was' % name, catalog(d.c) == before, differences(before, catalog(d.c)))
        ok('apply guard: %s is named by the pre-check' % name, d.statements(pre) == 'ok' and d.rows != [], d.rows)
        d.run(undo)
    for sig in RELIED:
        d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % sig)
        guard('a changed %s' % sig.split('(')[0], "do $$ begin execute regexp_replace((select def from kept), '\\$function\\$', '$function$ ', ''); end $$",
              "do $$ begin execute (select def from kept); end $$", 'is not the definition this file was written against')
        d.run('drop table kept')
        ok('apply: %s is back as it was' % sig.split('(')[0], md5(d, sig) == relied[sig])
    guard('a quiz_list with other arguments', 'create function student_submit.quiz_list(text) returns int language sql as $$ select 1 $$',
          'drop function student_submit.quiz_list(text)', 'other arguments or in another schema')
    guard('a quiz_list in public', 'create function public.quiz_list(uuid) returns int language sql as $$ select 1 $$',
          'drop function public.quiz_list(uuid)', 'other arguments or in another schema')
    guard("a quiz_list that is not this file's", "create function student_submit.quiz_list(text, uuid, text) returns jsonb language sql as $$ select null::jsonb $$",
          'drop function student_submit.quiz_list(text, uuid, text)', 'is not the definition this file was written against')
    guard('a quiz_attempt column missing', 'alter table public.quiz_attempt rename column reopened_at to reopened',
          'alter table public.quiz_attempt rename column reopened to reopened_at', "is not 2026111804's")
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('student_submit._quiz_window(uuid,uuid)')) as def")
    d.run('drop function student_submit._quiz_window(uuid, uuid) cascade')
    before = catalog(d.c); r = d.file(FILE)
    ok('apply guard: _quiz_window missing (MQ2 not applied) stops the file', r.startswith('STOPPED') and 'none: the function is missing' in r, r)
    ok('apply guard: and the pre-check names it absent', d.statements(pre) == 'ok' and ['fingerprint student_submit._quiz_window(uuid,uuid)', 'absent'] in d.rows, d.rows)
    ok('apply guard: and leaves the catalog as it was', catalog(d.c) == before)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    d.run('revoke all on function student_submit._quiz_window(uuid, uuid) from public, anon, authenticated, service_role')
    ok('(setup) _quiz_window is back with its grants', same(catalog(d.c), base), differences(norm(base), norm(catalog(d.c))))
    d.run('set role service_role'); r = d.file(FILE); d.run('reset role')
    ok('apply guard: a run as a role that does not own the quiz tables stops the file', r.startswith('STOPPED') and 'Run this as the owner' in r, r)
    d.run('set role service_role'); r = d.file(PRE); rows_ = d.rows; d.run('reset role')
    ok('apply guard: and the pre-check, run as that role, names it', r == 'ok' and any(x[0].startswith('the role running this') for x in rows_), (r, rows_))
    ok('apply: after the guards the catalog is the one before', same(catalog(d.c), base))
    Q(w); SV(w, w.q[1], True); s0 = sums(d)
    r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
    after = catalog(d.c); gone, came = differences(norm(base), norm(after))
    ok('apply: the catalog changes only in the new function', all(EXPECTED.search(l) for l in gone + came) and not [l for l in gone if 'quiz_list' in l],
       [l for l in gone + came if not EXPECTED.search(l)][:6])
    ok('apply: no row changed', sums(d) == s0)
    ok("apply: the function is the header's", md5(d, LIST) == new[LIST], md5(d, LIST))
    r = d.file(POST)
    ok('apply: the post-check says ok on all 13 rows', r == 'ok' and len(d.rows) == 13 and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or (r, len(d.rows)))
    ok('apply: the pre-check now names it as there', d.statements(pre) == 'ok' and d.rows == [['already there: function student_submit.quiz_list(text,uuid,text)', 'present']], d.rows)
    r = d.file(FILE); ok('apply: a second run is ok and changes nothing', r == 'ok' and catalog(d.c) == after and sums(d) == s0, r)
    raw = open(os.path.join(HERE, FILE), 'rb').read()
    ok('apply: the file is under 40 KB (%d bytes)' % len(raw), len(raw) < 40960)
    for f in (FILE, UNDO, POST):
        b = open(os.path.join(HERE, f), 'rb').read()
        ok('apply: %s is plain ASCII with no backslash at all' % f, all(c == 10 or 32 <= c <= 126 for c in b) and b'\\' not in b)
    b = open(os.path.join(HERE, PRE), 'rb').read()
    ok("apply: the pre-check's only backslashes are the route row's", all(c == 10 or 32 <= c <= 126 for c in b) and b.count(b'\\') == 6)
    ok('apply: the header names its tests, undo and checks', all(x in HEADER for x in ('quizzes_student_list.py', UNDO, PRE, POST)))
    d.close()

def mutant(extra=None, replace=None):
    t = text_of(FILE)
    if replace:
        assert replace[0] in t, replace[0]; t = t.replace(replace[0], replace[1], 1)
    if extra:
        i = t.index('-- == 3. The last check'); t = t[:i] + extra + '\n' + t[i:]
    return t

def scen_lastcheck():
    w = world('lastcheck', with_file=False); d = w.d
    base = catalog(d.c)
    for label, extra, rep, want in (
        ('the body', None, ("order by x.id)", "order by x.id desc)"), ['function student_submit.quiz_list(text,uuid,text) has md5']),
        ('a grant to anon', 'grant execute on function student_submit.quiz_list(text, uuid, text) to anon;', None,
         ['grant: function student_submit.quiz_list(text,uuid,text) may be run by anon, service_role, not service_role']),
        ('volatile', None, (' stable security definer\n', ' volatile security definer\n'), ['has md5', 'read-only: student_submit.quiz_list is not marked stable']),
        ('a grant to PUBLIC and the body at once', 'grant execute on function student_submit.quiz_list(text, uuid, text) to public;', ("order by x.id)", "order by x.id desc)"),
         ['grant: function student_submit.quiz_list(text,uuid,text) may be run by PUBLIC, service_role', 'has md5']),
    ) + (() if qs.NONSUPER else (
        # Only a superuser may hand a function to a role that cannot create in the schema.
        ('the owner', 'alter function student_submit.quiz_list(text, uuid, text) owner to service_role;', None,
         # service_role then owns it, so its grant is the owner's own and the last check names that too.
         ['grant: function student_submit.quiz_list(text,uuid,text) may be run by its owner only, not service_role',
          'owner: student_submit.quiz_list is not owned by the owner of _session_class']),)):
        r = d.statements(split(mutant(extra, rep)))
        ok('lastcheck: %s changed: the file stops' % label, r.startswith('STOPPED') and 'Not as tested (%d found)' % len(want) in r, r)
        ok('lastcheck: %s: the message names exactly that part' % label, all(x in r for x in want), r)
        ok('lastcheck: %s: nothing is left behind' % label, catalog(d.c) == base, differences(base, catalog(d.c)))
    d.close()

def scen_undo():
    w = world('undo', with_file=False); d = w.d
    base = catalog(d.c); s0 = sums(d)
    r = d.file(UNDO); ok('undo: on a database without the file it is ok and changes nothing', r == 'ok' and catalog(d.c) == base and sums(d) == s0, r)
    r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
    withfile = catalog(d.c)
    Q(w); SV(w, w.q[1], True); s1 = sums(d)
    with tx(d):
        d.run('revoke execute on function student_submit.quiz_list(text, uuid, text) from service_role')
        ok('undo: a revoke would stop nothing: the owner still runs it', d.one("select student_submit.quiz_list(:t, :e, 'ip')", t=w.tok[w.cece], e=w.cece)['ok'] is True)
    r = d.statements(split(part1())); ok('undo PART 1: runs', r == 'ok', r)
    x = refusal(lambda: d.one("select student_submit.quiz_list(:t, :e, 'ip')", t=w.tok[w.cece], e=w.cece))
    ok('undo PART 1: the owner can no longer run it: it is gone', x and x[0] == '42883', x)
    ok('undo PART 1: no row changed; the catalog is as before the file', sums(d) == s1 and catalog(d.c) == base, differences(base, catalog(d.c)))
    ok("undo PART 1: MQ2's routes still work", Q(w)['ok'] is True and SV(w, w.q[1], False)['ok'] is True)
    r = d.file(FILE); ok('undo: the file gives it back', r == 'ok' and same(catalog(d.c), withfile), r)
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % LIST)
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.statements(split(part1()))
    ok('undo PART 1: a function changed since stops it, dropping nothing', r.startswith('STOPPED') and 'is not the definition 2026111807 left' in r and applied(d), r)
    r = d.file(UNDO); ok('undo: and stops the whole undo', r.startswith('STOPPED') and applied(d), r)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    r = d.file(UNDO); ok('undo: sent whole it runs', r == 'ok' and not applied(d) and catalog(d.c) == base, r)
    r = d.file(UNDO); ok('undo: a second run is ok and changes nothing', r == 'ok' and catalog(d.c) == base, r)
    r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and same(catalog(d.c), withfile), r)
    d.close()

def scen_collations():
    names = {'icu': os.environ.get('FV_ICU_DB'), 'c': os.environ.get('FV_C_DB')}
    want = {'icu': ['i', 'en-US', 'en_US.UTF-8', 'en_US.UTF-8'], 'c': ['c', None, 'C', 'C']}
    ok('collations: (setup) FV_ICU_DB and FV_C_DB name the two templates', all(names.values()), names)
    if not all(names.values()): return
    seen = {}
    for tag, template in names.items():
        w = world('coll_' + tag, with_file=False, template=template); d = w.d
        loc = d.all('select datlocprovider::text, datlocale, datcollate, datctype from pg_database where datname = current_database()')[0]
        ok('collations: the %s copy is %s' % (tag, want[tag]), loc == want[tag], loc)
        r = d.file(PRE); ok('collations %s: the pre-check returns no rows' % tag, r == 'ok' and d.rows == [], d.rows)
        for step in ('applies', 'runs again'):
            r = d.file(FILE); ok('collations %s: the file %s' % (tag, step), r == 'ok', r)
        r = d.file(POST); post = d.rows
        ok('collations %s: the post-check says ok on every row' % tag, r == 'ok' and post and all(x[1] == 'ok' for x in post), post)
        fp = {s: md5(d, s) for s in [LIST] + RELIED}
        lst = L(w)
        r = d.file(UNDO); ok('collations %s: the undo runs' % tag, r == 'ok' and not applied(d), r)
        r = d.file(FILE); ok('collations %s: the file applies again' % tag, r == 'ok' and applied(d), r)
        seen[tag] = (fp, post, [x['assessment_id'] == y for x, y in zip(lst['quizzes'], sorted([w.a, w.a2, w.au]))])
        d.close()
    ok('collations: the fingerprints are the same under ICU en-US and under C', seen['icu'][0] == seen['c'][0])
    ok("collations: the post-check's rows are the same under both", seen['icu'][1] == seen['c'][1])
    ok('collations: the list is in id order under both', all(seen['icu'][2]) and all(seen['c'][2]) and len(seen['c'][2]) == 3)

SCENARIOS = {'list': scen_list, 'nowrite': scen_nowrite, 'leak': scen_leak, 'refused': scen_refused, 'others': scen_others,
             'apply': scen_apply, 'lastcheck': scen_lastcheck, 'undo': scen_undo, 'collations': scen_collations}
if __name__ == '__main__':
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
