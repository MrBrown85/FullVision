"""Quizzes, the returned view: migrations/2026112407_quiz_returned.sql (MQ3) on a database rebuilt from the repo and
proved equal to live (scripts/db-rebuild.mjs --check), which has MQ1, MQ2 and MQ2b (2026111804 to 2026111807) and the
session-token change (2026112401) already (README.md, "Quizzes, the returned view"). The contract is
quizzes-contract.md, "MQ3, the returned view". The world, the teacher's quizzes and the student functions are
quizzes_student.py's; a card's sign-in is made as the edge function makes it since 2026112401 (the database is given
only the hash of a token the function made).

    PGPORT=<port> PGDATABASE=<db> python3 quiz_returned.py          every scenario below
    FV_NONSUPER=<role>       every scenario as a role that is not a superuser, with live's default privileges
    FV_ICU_DB, FV_C_DB       the two templates scenario collations uses (ICU en-US as live, and C)

Never against gradebook-prod: a throwaway PostgreSQL 17 only. Scores are written with the teacher's own
upsert_tag_score, returned with return_grades, marked Missing and Excused with set_score_status, and a marking is
stored with confirm_quiz, in each order the app's outbox can deliver them (it sends a score and a marking side by side).

  stages    In a class that keeps changes until Return: not started, part way, sent with none left, confirmed but not
            returned (a draft), the piece put back to a Draft, returned, Missing, Excused, Missing taken off, the grade
            changed after return (a draft over a returned grade), returned again. At every stage every student route
            (quiz-list, quiz, quiz-save, quiz-send, quiz-result) is called, the writing ones in a transaction rolled
            back: the key's markers are in no reply until the piece is returned and closed to that student, and then
            only under a question's answer and why, and only with Grade, Which Were Right and the Answers. Another
            student's session naming her is not_found at every stage and his own result says returned false.
  shows     grade: no questions; right: each question with your_answer and result, no answer or why; answers: also
            the key's answer and why, only for a question in the marking (one added after Return: all four null, its
            key in no reply under any shows); total only with Add a Total; the keys at every level exactly the contract's; the
            questions in her own order (shuffled), numbered 1, 2, ...; an archived question left out; a question with
            no answer and none marked is null in both.
  tries     two tries, one sent, confirmed and returned: false while a try is left and the quiz open; true once it
            closes; try 2 started and never sent: false while open, true (try 1's) once closed, false again reopened; unlimited: false while open, true closed; a Reopen after return: false (not opened, part way),
            then the try sent: the earlier marking again, then the new one confirmed: false until Returned, then the
            new try's answers.
  order     In a class that keeps changes: a re-confirm whose marking lands before its scores is false in between;
            Return before the marking lands, and a re-confirm that changes no score, stay false (the known limit).
  undo      Undo of a Confirm: before Return (false, and Return finds nothing); of a first Confirm after Return
            (false); of a later Confirm after Return in a class that keeps changes (false: the earlier marking comes
            back with a new marked_at, the contract's known limit) and in a class that returns at once (true, the
            earlier marking).
  atonce    A class that returns every save at once: scores before the marking (marked_at after returned_at: true),
            the marking before the scores (false until the scores land), the grade changed after return, Missing,
            Excused, Reopen; switched from When I Return Them with a draft waiting (released: true); switched back
            (a marking after the last return turns false).
  notfound  A Draft, next week's piece, a piece with no quiz, a DIBELS piece, a pair and a group piece, another
            teacher's, the student's other class's: not_found, the same answer, nothing sent.
  refused   A paused, withdrawn, page-off, trash, stopped-card, expired-card, expired-session, unknown-session student,
            a classmate's and a made-up enrolment, each refused with its code, on a returned quiz.
  nowrite   It writes nothing: no row, no write_log row, no lock left on a quiz row, not after 700 calls (no
            too_many); stable; a quiz row held for update by the teacher does not make it wait.
  others    anon, authenticated and public may not run it; service_role may; owner, path pinned, stable; no
            student_submit function but quiz_result names quiz_key, and quiz_result does.
  apply     The guards stop with the catalog unchanged (each relied-on function changed, one missing, a quiz_result
            elsewhere, a column of each table read missing, the wrong role); the pre-check names each; only the
            header's change; no row changed; the header's md5s; post-check; a second run; size; plain ASCII, no
            backslash.
  lastcheck Each part the last check reads (md5, grant, owner, stable, the key named elsewhere) tripped alone and two at
            once: named, nothing left.
  undofile  PART 1 alone drops it (a revoke would stop nothing); the other quiz routes still work; the file gives it
            back; a changed function stops it; sent whole; a second run; on a database without the file nothing changes.
  collations On ICU en-US and on C: pre-check empty, apply, second run, post-check, a returned view, undo, apply
            again; the same md5s, post-check rows and returned view under both.
"""
import copy, hashlib, json, os, re, secrets, sys, time
if os.environ.get("PG8000_PATH"): sys.path.insert(0, os.environ["PG8000_PATH"])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import card_codes_common as ccc
from card_codes_common import ok, finish, nid, split, text_of, tx, code_tag, key_id, pw_tag, FAKE_KEY
from catalog import catalog, differences
import quizzes_student as qs
from quizzes_student import (T, S, Q, SV, SD, md5, sums, log_rows, refusal, payload, settings, tf, num, choice, textq, tsave,
                             norm, same, Conn, MARK_WHY, MARK_NUM, MARK_TOL, MARK_NOTE, A, B)

FILE = '../2026112407_quiz_returned.sql'
UNDO = 'quiz-returned-undo.sql'
PRE = 'quiz-returned-live-precheck.sql'
POST = 'quiz-returned-live-postcheck.sql'
RESULT = 'student_submit.quiz_result(text,uuid,uuid,text)'
RELIED = ['student_submit._session_class(text,uuid)', 'student_submit._card_refusal(uuid)', 'student_submit._device_session(text)',
          'student_submit._listed(public.assessment,date)', 'student_submit._quiz_window(uuid,uuid)',
          'student_submit._quiz_questions(uuid,jsonb)', 'student_submit._returned_grade(uuid,uuid)',
          'student_submit.quiz(text,uuid,uuid,text,boolean)', 'public._fv_timezone(text)', 'public._grade_copy(uuid,uuid)',
          'public._grade_copy_in_use(jsonb,uuid)', 'public._grade_return_holds(uuid)', 'public._grade_return_apply(uuid,uuid,jsonb,jsonb)',
          'public._grade_return_one(uuid,uuid,timestamp with time zone)', 'public._grade_return_release()', 'public.confirm_quiz(uuid,jsonb,uuid)']
HEADER = text_of(FILE)
NOT_RETURNED = {'ok': True, 'returned': False}
K_QUESTION = ['id', 'number', 'kind', 'prompt', 'points', 'multiple', 'choices']
K_RIGHT = set(K_QUESTION) | {'your_answer', 'result'}
K_ANSWERS = K_RIGHT | {'answer', 'why'}

# == 2026112401: the edge function hashes a device's token before any statement, and verify_card is given the hash
# of a token the function made (p_new_session_hash). The world signs in the same way: w.tok holds what the function
# sends the database, the token's SHA-256. ==
def _verify(self, code, birthday=None, number=None, password=None, token=None, ip='ip-1', add=False, key=FAKE_KEY):
    new = hashlib.sha256(secrets.token_hex(32).encode()).hexdigest()
    r = self.service('student_submit.verify_card(:h, :k, :b, :n, :p, :t, :i, :a, :s)', h=code_tag(code, key), k=key_id(key),
                     b=birthday, n=number, p=None if password is None else pw_tag(code, password, key), t=token, i=ip, a=add, s=new)
    if isinstance(r, dict) and r.get('ok'):
        r = dict(r, session_token=new if r.get('new_session') else token)
    return r
ccc.Db.verify = _verify

def applied(d): return d.one("select to_regprocedure('student_submit.quiz_result(text,uuid,uuid,text)') is not null")
def header_md5s():
    new = dict(re.findall(r'^--   (\S+\(.*?\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    relied = dict(re.findall(r'^--   (\S+\((?:[^()]*)\))\s+([0-9a-f]{32})$', HEADER, re.M))
    return new, relied
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]

def world(tag, with_file=True, template=None):
    """quizzes_student.py's world on a template that already has MQ2 and MQ2b (as live has them); then this file."""
    keep = qs.applied
    qs.applied = lambda d: False
    try:
        w = qs.world('r_' + tag, with_file=False, template=template)
    finally:
        qs.applied = keep
    d = w.d
    if applied(d):
        r = d.file(UNDO); ok('(setup %s) the template goes back to before the file' % tag, r == 'ok' and not applied(d), r)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

# == The student's calls ==
def R(w, e=None, a=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.quiz_result(:t, :e, :a, 'ip')", t=tok or w.tok.get(e), e=e, a=a or w.a)
def L(w, e=None):
    e = e or w.cece
    return S(w.d, "student_submit.quiz_list(:t, :e, 'ip')", t=w.tok.get(e), e=e)

# == The teacher's ==
def new_piece(w, title, mode='proficiency', **quiz):
    """A piece of Science 8 with the three competencies and a quiz of the five kinds, the key's markers in it."""
    d = w.d
    a = str(T(d, "create_assessment(:c, :t, p_score_mode => :m, p_max_points => case when :m = 'points' then 10 end, "
                 "p_tag_ids => cast(:g as uuid[]), p_is_draft => false)", c=w.c, t=title, m=mode, g=list(w.t)))
    r = tsave(w, a, payload([choice(tag=w.t[0], why='Because ' + MARK_WHY), tf(tag=w.t[1]), num(answer=MARK_NUM, tolerance=MARK_TOL, tag=w.t[2]),
                             textq(tag=w.t[0], why=MARK_WHY + ' text'),
                             choice('Which are consumers?', texts=('Hawk', 'Grass', 'Fox', 'Moss'), right=(0, 2), multiple=True, tag=w.t[1])],
                            **quiz))
    return a, r['questions']
def answer_all(w, a, qs_, e=None, send=True, again=False):
    """Answers every question but the True or False one (a wrong choice, a wrong number, words, two choices), then sends.
    again: Try Again (a second ordinary try)."""
    e = e or w.cece
    r = Q(w, e=e, a=a, new_try=again); assert r['ok'] and r['can_answer'], r
    SV(w, qs_[0]['id'], [qs_[0]['choices'][1]['id']], e=e, a=a)
    SV(w, qs_[2]['id'], 3.0, e=e, a=a)
    SV(w, qs_[3]['id'], 'Plants need light, ' + e[:4], e=e, a=a)
    SV(w, qs_[4]['id'], [qs_[4]['choices'][0]['id'], qs_[4]['choices'][2]['id']], e=e, a=a)
    if send: assert SD(w, e=e, a=a)['ok']
def try_id(d, a, e, n=None):
    return d.one('select id::text from quiz_attempt where assessment_id = :a and enrollment_id = :e and sent_at is not null '
                 'and (cast(:n as int) is null or try = :n) order by try desc limit 1', a=a, e=e, n=n)
def marking(qs_, earned, results):
    qq = {q['id']: {'earned': x[0], 'result': x[1]} for q, x in zip(qs_, results) if x is not None}
    return {'earned': earned, 'possible': 9, 'questions': qq}
M1 = lambda qs_: marking(qs_, 4.5, [(0, 'wrong'), None, (0, 'wrong'), (2, 'partly'), (2.5, 'right')])
M2 = lambda qs_: marking(qs_, 6, [(1, 'right'), (1, 'right'), (0, 'wrong'), (3, 'right'), (1, 'partly')])
def confirm(w, a, items):
    """confirm_quiz with [(attempt id, marked or None)]."""
    return T(w.d, 'confirm_quiz(:a, cast(:m as jsonb), null)', a=a, m=json.dumps([{'attempt_id': t, 'marked': m} for t, m in items]))
def levels(w, a, e, vals):
    for tag, v in zip(w.t, vals): T(w.d, 'upsert_tag_score(:e, :a, :t, :v)', e=e, a=a, t=tag, v=v)
def give_back(w, a, e): return T(w.d, 'return_grades(:a, cast(:e as uuid[]), null)', a=a, e=[e])
def status(w, a, e, s): return T(w.d, 'set_score_status(:e, :a, :s)', e=e, a=a, s=s)
def at_once(w, on=True):
    w.d.run('update course set return_grades = :m where id = :c', m='on_save' if on else 'on_return', c=w.c)
def gr(w, a, e):
    """(is_draft, returned) of the student's grade_return row, or None."""
    x = w.d.all('select is_draft, returned_at is not null from grade_return where assessment_id = :a and enrollment_id = :e', a=a, e=e)
    return tuple(x[0]) if x else None
def times(w, a, e):
    """(marked_at > returned_at) for the confirmed try, or None."""
    return w.d.one('select t.marked_at > g.returned_at from quiz_attempt t join grade_return g on g.assessment_id = t.assessment_id '
                   'and g.enrollment_id = t.enrollment_id where t.assessment_id = :a and t.enrollment_id = :e and t.marked is not null', a=a, e=e)
def key_of(w, a):
    return {q['id']: q['key'] for q in T(w.d, 'list_quiz(:a)', a=a)['questions']}
def her_order(w, a, e, t):
    return [q['id'] for q in w.d.one('select student_submit._quiz_questions(:a, question_order) from quiz_attempt where id = :t', a=a, t=t)]

# == What may be in a reply ==
def blob(x): return json.dumps(x, default=str, sort_keys=True)
MARKERS = (('the why line', MARK_WHY), ('the number key', str(MARK_NUM)), ('the tolerance', str(MARK_TOL)), ("a teacher's note", MARK_NOTE))
def without_key(r):
    r = copy.deepcopy(r)
    for q in (r.get('questions') or []) if isinstance(r, dict) else []:
        if isinstance(q, dict): q.pop('answer', None); q.pop('why', None)
    return r
def no_marker(label, r, allow_key=False):
    b = blob(without_key(r) if allow_key else r)
    hit = [n for n, m in MARKERS if m in b]
    ok('%s: no key marker%s' % (label, ' outside answer and why' if allow_key else ''), not hit, (hit, b[:300]))

def sweep(w, a, label, want, e=None):
    """Every student route for e (Cece) on piece a at this stage. The writing ones run in a transaction that is rolled
    back, so the stage is as it was. want: None (returned false), or the shows the result must have."""
    e = e or w.cece; d = w.d
    r = R(w, e=e, a=a)
    if want is None:
        ok('%s: quiz-result is exactly returned false' % label, r == NOT_RETURNED, r)
    else:
        ok('%s: quiz-result is returned, %s' % (label, want), r.get('returned') is True and r.get('shows') == want, r)
    no_marker('%s: quiz-result' % label, r, allow_key=(want == 'answers'))
    if want != 'answers':
        ok('%s: quiz-result has no answer or why key' % label, not re.search('"(answer|why)":', blob(r)), r)
    s0 = sums(d)
    with tx(d):
        got = {'quiz-list': L(w, e)}
        got['quiz'] = Q(w, e=e, a=a)
        qid = got['quiz']['questions'][0]['id'] if got['quiz'].get('ok') and got['quiz']['questions'] else nid()
        got['quiz-save'] = SV(w, qid, True, e=e, a=a)
        got['quiz-send'] = SD(w, e=e, a=a)
    ok('%s: (setup) the stage is as it was after the sweep' % label, sums(d) == s0)
    for k, v in got.items(): no_marker('%s: %s' % (label, k), v)
    # Another student's session: naming her, not_found; his own, nothing of hers.
    o = R(w, e=e, a=a, tok=w.tok[w.dev])
    ok('%s: Dev\'s session naming her enrolment is not_found' % label, o == {'ok': False, 'error': 'not_found'}, o)
    mine = R(w, e=w.dev, a=a)
    ok('%s: Dev\'s own result says returned false' % label, mine == NOT_RETURNED, mine)
    return r

def check_view(w, a, e, r, shows, marked, add_total):
    """A returned view against the rows: keys, order, answers, results and key, exactly."""
    t = d_try = w.d.one('select id::text from quiz_attempt where assessment_id = :a and enrollment_id = :e and marked is not null', a=a, e=e)
    want_keys = {'ok', 'returned', 'shows'} | ({'total'} if add_total else set()) | (set() if shows == 'grade' else {'questions'})
    ok('view %s: the top keys are exactly %s' % (shows, sorted(want_keys)), set(r) == want_keys, sorted(r))
    if add_total:
        ok('view %s: total is marked\'s earned and possible' % shows, r['total'] == {'earned': marked['earned'], 'possible': marked['possible']}, r.get('total'))
    if shows == 'grade': return
    order = her_order(w, a, e, t)
    ok('view %s: the questions are hers, in her order, archived left out' % shows, [q['id'] for q in r['questions']] == order, ([q['id'][:4] for q in r['questions']], [x[:4] for x in order]))
    ok('view %s: numbered 1, 2, ...' % shows, [q['number'] for q in r['questions']] == list(range(1, len(order) + 1)))
    ks = K_ANSWERS if shows == 'answers' else K_RIGHT
    ok('view %s: each question has exactly the contract\'s keys' % shows, all(set(q) == ks for q in r['questions']), [sorted(q) for q in r['questions']][:1])
    mine = {str(x[0]): x[1] for x in w.d.c.run('select question_id, answer from quiz_answer where attempt_id = :t', t=t)}
    ok('view %s: your_answer is her own saved answer, null with none' % shows, all(q['your_answer'] == mine.get(q['id']) for q in r['questions']),
       [(q['id'][:4], q['your_answer'], mine.get(q['id'])) for q in r['questions']])
    ok('view %s: result is what the teacher confirmed, null where none' % shows,
       all(q['result'] == (marked['questions'].get(q['id']) or {}).get('result') for q in r['questions']))
    if shows == 'answers':
        key = key_of(w, a)
        # The key only for a question in the marking; one added since has answer and why null.
        want = lambda q, f: key[q['id']].get(f) if q['id'] in marked['questions'] else None
        ok('view answers: answer and why are the key\'s, for each question in the marking, null for any other',
           all(q['answer'] == want(q, 'answer') and q['why'] == want(q, 'why') for q in r['questions']),
           [(q['answer'], want(q, 'answer')) for q in r['questions']])
    ok('view %s: no tolerance, competency, position, points given or note' % shows, not re.search('tolerance|tag_id|position|given_points|"note"|marked', blob(r)))

# == Scenarios ==
def scen_stages():
    w = world('stages'); d = w.d
    a, qq = new_piece(w, 'Stages', add_total=True)
    sweep(w, a, 'not started', None)
    r = Q(w, a=a); SV(w, qq[0]['id'], [qq[0]['choices'][1]['id']], a=a); SV(w, qq[2]['id'], 3.0, a=a)
    sweep(w, a, 'part way', None)
    SV(w, qq[3]['id'], 'Plants need light', a=a); SD(w, a=a)
    sweep(w, a, 'sent, none left, not confirmed', None)
    t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))])
    ok('(setup) confirmed, its grade a draft waiting for Return', gr(w, a, w.cece) == (True, False), gr(w, a, w.cece))
    sweep(w, a, 'confirmed but not returned (a draft)', None)
    give_back(w, a, w.cece)
    ok('(setup) returned', gr(w, a, w.cece) == (False, True))
    r = sweep(w, a, 'returned', 'answers'); check_view(w, a, w.cece, r, 'answers', M1(qq), True)
    ok('returned, answers: the why line and the number key are sent, under answer and why', MARK_WHY in blob(r) and str(MARK_NUM) in blob(r))
    with tx(d):
        d.run("select set_config('fv.restoring', 'on', true)")
        d.run('update assessment set is_draft = true where id = :a', a=a)
        x = R(w, a=a)
        ok('the piece put back to a Draft (a restore lets it): not_found, nothing sent', x == {'ok': False, 'error': 'not_found'}, x)
        ok('the piece a Draft: quiz is not_found too', Q(w, a=a) == {'ok': False, 'error': 'not_found'})
    for code, label in (('NS', 'Missing'), ('EXC', 'Excused')):
        status(w, a, w.cece, code)
        sweep(w, a, 'returned, then marked %s' % label, None)
        status(w, a, w.cece, None)
        ok('%s taken off: returned again, as before' % label, R(w, a=a) == r, R(w, a=a))
    levels(w, a, w.cece, [4, 4, 4])
    ok('(setup) the grade changed after return: a draft over the returned grade', gr(w, a, w.cece) == (True, True), gr(w, a, w.cece))
    x = sweep(w, a, 'grade changed after return, not returned yet', 'answers')
    ok('grade changed after return: the same returned view (the marking was returned with the grade she sees)', x == r, x)
    give_back(w, a, w.cece)
    x = sweep(w, a, 'the changed grade returned', 'answers')
    ok('the changed grade returned: the same view', x == r)
    d.close()

def scen_shows():
    w = world('shows'); d = w.d
    a, qq = new_piece(w, 'Shows', shuffle_questions=True)
    answer_all(w, a, qq)
    t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))]); give_back(w, a, w.cece)
    for shows in ('grade', 'right', 'answers'):
        for total in (False, True):
            settings(w, a, shows=shows, add_total=total)
            r = sweep(w, a, 'shows %s, add_total %s' % (shows, total), shows)
            check_view(w, a, w.cece, r, shows, M1(qq), total)
            if shows == 'grade': ok('shows grade: no questions key', 'questions' not in r)
    # A question added after Return (never marked, never returned): in her view at the end, its answer, result,
    # and the key's answer and why all null; its key is in no reply.
    p = qs.as_sent(T(d, 'list_quiz(:a)', a=a)); p['questions'].append(choice('Added later.', why='ZQX-ADDED-MARKER'))
    r2 = tsave(w, a, p)
    added = [q for q in r2['questions'] if q['prompt'] == 'Added later.'][0]
    v = sweep(w, a, 'a question added after Return', 'answers')
    last = v['questions'][-1]
    ok('shows: a question added after Return is last, your_answer, result, answer and why null', last['id'] == added['id']
       and last['your_answer'] is None and last['result'] is None and last['answer'] is None and last['why'] is None, last)
    ok("shows: the added question's key (its right choice, its why line) is in no reply",
       'ZQX-ADDED' not in blob(v) and not any(q.get('answer') == added['key']['answer'] for q in v['questions']), last)
    check_view(w, a, w.cece, v, 'answers', M1(qq), True)
    for shows in ('right', 'grade'):
        settings(w, a, shows=shows)
        ok('shows %s: the added question\'s key is in no reply' % shows, 'ZQX-ADDED' not in blob(R(w, a=a)))
    settings(w, a, shows='answers')
    # The text question taken out of the quiz (it has an answer, so it is archived): left out, renumbered.
    p = qs.as_sent(T(d, 'list_quiz(:a)', a=a)); p['questions'] = [q for q in p['questions'] if q['kind'] != 'text']; tsave(w, a, p)
    ok('(setup) the text question is archived, not deleted', d.one('select archived_at is not null from quiz_question where id = :q', q=qq[3]['id']) is True)
    v = R(w, a=a)
    ok('shows: an archived question is left out and the rest numbered 1, 2, ...', qq[3]['id'] not in [q['id'] for q in v['questions']]
       and [q['number'] for q in v['questions']] == list(range(1, len(v['questions']) + 1)) and MARK_WHY + ' text' not in blob(v), [q['id'][:4] for q in v['questions']])
    d.close()

def scen_tries():
    w = world('tries'); d = w.d
    # Two tries: sent once, confirmed, returned. A try is left and the quiz is open: nothing.
    a, qq = new_piece(w, 'Two Tries', tries=2)
    answer_all(w, a, qq); t1 = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t1, M1(qq))]); give_back(w, a, w.cece)
    sweep(w, a, 'two tries, one sent and returned, open: sent with tries left', None)
    settings(w, a, after_due='until', accept_until='2020-01-01')
    r = sweep(w, a, 'two tries, one sent, the quiz closed', 'answers'); check_view(w, a, w.cece, r, 'answers', M1(qq), False)
    # Two tries: try 1 returned, try 2 started (Try Again) and never sent. Open: she may still answer it, so nothing.
    # Then the quiz closes: MQ2 no longer lets her answer that try, so the returned view shows try 1.
    b, qb = new_piece(w, 'Started Then Closed', tries=2)
    answer_all(w, b, qb); tb = try_id(d, b, w.cece)
    levels(w, b, w.cece, [3, 2, 4]); confirm(w, b, [(tb, M1(qb))]); give_back(w, b, w.cece)
    x = Q(w, a=b, new_try=True); ok('(setup) Try Again starts try 2', x['try']['number'] == 2 and x['can_answer'] is True, x.get('try'))
    SV(w, qb[1]['id'], True, a=b)
    sweep(w, b, 'two tries, try 1 returned, try 2 started, open', None)
    settings(w, b, after_due='until', accept_until='2020-01-01')
    x = Q(w, a=b)
    ok('(setup) closed: MQ2 refuses the unsent ordinary try', x['can_answer'] is False and x['try']['sent'] is False
       and SV(w, qb[1]['id'], False, a=b) == {'ok': False, 'error': 'quiz_closed'}, x.get('can_answer'))
    r = sweep(w, b, 'two tries, try 1 returned, try 2 never sent, the quiz closed', 'answers')
    check_view(w, b, w.cece, r, 'answers', M1(qb), False)
    ok("that view is try 1's: your_answer is try 1's, not the unsent try's", [q for q in r['questions'] if q['id'] == qb[1]['id']][0]['your_answer'] is None)
    T(d, 'reopen_quiz(:a, :e, null)', a=b, e=w.cece)
    sweep(w, b, 'that unsent try reopened while closed (she may answer it again)', None)
    # Unlimited: never out of tries, so only closed shows it.
    u, qu = new_piece(w, 'Unlimited', tries=0)
    answer_all(w, u, qu); tu = try_id(d, u, w.cece)
    levels(w, u, w.cece, [3, 2, 4]); confirm(w, u, [(tu, M1(qu))]); give_back(w, u, w.cece)
    sweep(w, u, 'unlimited, sent and returned, open', None)
    settings(w, u, after_due='stop'); d.run('update assessment set due_date = current_date - 5 where id = :a', a=u)
    sweep(w, u, 'unlimited, the due date passed (stop)', 'answers')
    # One try, returned; then the teacher's Reopen.
    o, qo = new_piece(w, 'Reopened', tries=1)
    answer_all(w, o, qo); to = try_id(d, o, w.cece)
    levels(w, o, w.cece, [3, 2, 4]); confirm(w, o, [(to, M1(qo))]); give_back(w, o, w.cece)
    first = sweep(w, o, 'one try, returned', 'answers')
    T(d, 'reopen_quiz(:a, :e, null)', a=o, e=w.cece)
    sweep(w, o, 'reopened after return, not opened', None)
    Q(w, a=o); SV(w, qo[1]['id'], False, a=o)
    sweep(w, o, 'reopened after return, part way', None)
    SD(w, a=o)
    x = sweep(w, o, 'the reopened try sent, not confirmed', 'answers')
    ok('the reopened try sent: the marking returned before, as it was', x == first, x)
    t2 = try_id(d, o, w.cece, 2)
    levels(w, o, w.cece, [4, 3, 4]); confirm(w, o, [(t2, M2(qo))])
    sweep(w, o, 'the second try confirmed, not returned (a draft)', None)
    give_back(w, o, w.cece)
    r = sweep(w, o, 'the second try returned', 'answers'); check_view(w, o, w.cece, r, 'answers', M2(qo), False)
    ok('the second try returned: your_answer is the second try\'s', [q for q in r['questions'] if q['id'] == qo[1]['id']][0]['your_answer'] is False)
    d.close()

def scen_order():
    w = world('order'); d = w.d
    # A re-confirm whose marking lands before its scores (Reopen, a second try): false in between, false as a draft,
    # then the new marking once Returned.
    a, qq = new_piece(w, 'Marking First')
    answer_all(w, a, qq); t1 = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t1, M1(qq))]); give_back(w, a, w.cece)
    T(d, 'reopen_quiz(:a, :e, null)', a=a, e=w.cece); Q(w, a=a); SV(w, qq[1]['id'], True, a=a); SD(w, a=a)
    t2 = try_id(d, a, w.cece, 2)
    confirm(w, a, [(t2, M2(qq))])
    ok('(setup) the new marking is in, the scores not yet: no draft, the return older than the marking', gr(w, a, w.cece) == (False, True) and times(w, a, w.cece) is True)
    sweep(w, a, 'a re-confirm, its marking landed before its scores', None)
    levels(w, a, w.cece, [4, 4, 4])
    sweep(w, a, 'and then its scores (a draft)', None)
    give_back(w, a, w.cece)
    r = sweep(w, a, 'and then Returned', 'answers'); check_view(w, a, w.cece, r, 'answers', M2(qq), False)
    # Return before the marking lands: the marking is after the last return, and Return has no draft left to give.
    b, qb = new_piece(w, 'Return First')
    answer_all(w, b, qb); tb = try_id(d, b, w.cece)
    levels(w, b, w.cece, [3, 2, 4]); give_back(w, b, w.cece); confirm(w, b, [(tb, M1(qb))])
    sweep(w, b, 'Return before the marking landed (the known limit)', None)
    ok('Return before the marking: a second Return finds no draft', give_back(w, b, w.cece)['returned'] == 0 and R(w, a=b) == NOT_RETURNED)
    levels(w, b, w.cece, [3, 3, 4]); give_back(w, b, w.cece)
    sweep(w, b, 'and the next grade change, Returned, shows it', 'answers')
    # A re-confirm that changes no score: the new marking is after the return, and nothing is a draft.
    c, qc = new_piece(w, 'Same Scores')
    answer_all(w, c, qc); tc = try_id(d, c, w.cece)
    levels(w, c, w.cece, [3, 2, 4]); confirm(w, c, [(tc, M1(qc))]); give_back(w, c, w.cece)
    sweep(w, c, 'returned', 'answers')
    confirm(w, c, [(tc, M2(qc))])
    sweep(w, c, 'a re-confirm with the same scores (the known limit)', None)
    d.close()

def scen_undo():
    w = world('undo'); d = w.d
    # Undo before Return: the scores taken off and the marking cleared, as Grader.undoConfirmQuiz sends them.
    a, qq = new_piece(w, 'Undo Before')
    answer_all(w, a, qq); t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))])
    levels(w, a, w.cece, [0, 0, 0]); confirm(w, a, [(t, None)])
    sweep(w, a, 'Undo before Return', None)
    ok('Undo before Return: Return then finds nothing', give_back(w, a, w.cece)['returned'] == 0 and R(w, a=a) == NOT_RETURNED)
    # Undo of a first Confirm after Return: the scores go (a draft over the returned grade) and the marking with them.
    b, qb = new_piece(w, 'Undo First')
    answer_all(w, b, qb); tb = try_id(d, b, w.cece)
    levels(w, b, w.cece, [3, 2, 4]); confirm(w, b, [(tb, M1(qb))]); give_back(w, b, w.cece)
    sweep(w, b, 'returned', 'answers')
    confirm(w, b, [(tb, None)]); levels(w, b, w.cece, [0, 0, 0])
    sweep(w, b, 'Undo of the first Confirm after Return', None)
    # Undo of a later Confirm after Return, in a class that keeps changes: the earlier marking comes back with a new
    # marked_at, after the return that showed it.
    c, qc = new_piece(w, 'Undo Later', tries=2)
    answer_all(w, c, qc); t1 = try_id(d, c, w.cece)
    levels(w, c, w.cece, [3, 2, 4]); confirm(w, c, [(t1, M1(qc))])
    answer_all(w, c, qc, again=True); t2 = try_id(d, c, w.cece, 2)
    give_back(w, c, w.cece)
    settings(w, c, after_due='until', accept_until='2020-01-01')
    first = sweep(w, c, 'two tries sent, the first confirmed, returned, closed', 'answers')
    levels(w, c, w.cece, [4, 4, 4]); confirm(w, c, [(t2, M2(qc))])
    sweep(w, c, 'the second try confirmed after Return (a draft)', None)
    levels(w, c, w.cece, [3, 2, 4]); confirm(w, c, [(t1, M1(qc))])
    ok('(setup) Undo put the returned grade back (no draft) and the first marking, now later than the return',
       gr(w, c, w.cece) == (False, True) and times(w, c, w.cece) is True, (gr(w, c, w.cece), times(w, c, w.cece)))
    sweep(w, c, 'Undo of a later Confirm after Return, keeping changes (the known limit)', None)
    ok('and Return finds no draft to give', give_back(w, c, w.cece)['returned'] == 0)
    levels(w, c, w.cece, [3, 3, 4]); give_back(w, c, w.cece)
    x = sweep(w, c, 'the next grade change, Returned', 'answers')
    ok('then the first marking again', [q['result'] for q in x['questions']] == [q['result'] for q in first['questions']])
    # The same in a class that returns every save at once (its own world: the switch returns every draft of the class).
    w2 = world('undo_at_once'); d2 = w2.d; at_once(w2)
    e, qe = new_piece(w2, 'Undo Later At Once', tries=2)
    answer_all(w2, e, qe); u1 = try_id(d2, e, w2.cece)
    answer_all(w2, e, qe, again=True); u2 = try_id(d2, e, w2.cece, 2)
    levels(w2, e, w2.cece, [3, 2, 4]); confirm(w2, e, [(u1, M1(qe))])
    first = sweep(w2, e, 'at once: two tries sent, the first confirmed', 'answers')
    levels(w2, e, w2.cece, [4, 4, 4]); confirm(w2, e, [(u2, M2(qe))])
    sweep(w2, e, 'at once: the second confirmed', 'answers')
    levels(w2, e, w2.cece, [3, 2, 4]); confirm(w2, e, [(u1, M1(qe))])
    x = sweep(w2, e, 'at once: Undo of the second Confirm', 'answers')
    ok('at once: Undo shows the first marking again', [q['result'] for q in x['questions']] == [q['result'] for q in first['questions']], x)
    d.close(); d2.close()

def scen_atonce():
    w = world('atonce'); d = w.d
    # A draft waiting under When I Return Them, then the class switched to As Soon As I Save: released.
    p, qp = new_piece(w, 'Switched')
    answer_all(w, p, qp); tp = try_id(d, p, w.cece)
    levels(w, p, w.cece, [3, 2, 4]); confirm(w, p, [(tp, M1(qp))])
    sweep(w, p, 'keeping changes: confirmed, a draft', None)
    at_once(w)
    ok('(setup) the switch returned the draft', gr(w, p, w.cece) == (False, True))
    sweep(w, p, 'switched to At Once: the draft is released', 'answers')
    # Scores before the marking: returned_at is older than marked_at, and that is no draft here.
    a, qq = new_piece(w, 'Scores First')
    answer_all(w, a, qq); t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4])
    sweep(w, a, 'at once: scores in, no marking yet', None)
    confirm(w, a, [(t, M1(qq))])
    ok('(setup) the marking is later than the return', times(w, a, w.cece) is True)
    r = sweep(w, a, 'at once: scores, then the marking', 'answers'); check_view(w, a, w.cece, r, 'answers', M1(qq), False)
    # The marking before the scores.
    b, qb = new_piece(w, 'Marking First')
    answer_all(w, b, qb); tb = try_id(d, b, w.cece)
    confirm(w, b, [(tb, M1(qb))])
    sweep(w, b, 'at once: the marking in, no score yet', None)
    levels(w, b, w.cece, [3, 2, 4])
    sweep(w, b, 'at once: then the scores', 'answers')
    levels(w, b, w.cece, [4, 4, 4])
    sweep(w, b, 'at once: the grade changed after return', 'answers')
    for code, label in (('NS', 'Missing'), ('EXC', 'Excused')):
        status(w, b, w.cece, code); sweep(w, b, 'at once: %s' % label, None); status(w, b, w.cece, None)
    sweep(w, b, 'at once: Missing and Excused taken off', 'answers')
    T(d, 'reopen_quiz(:a, :e, null)', a=b, e=w.cece)
    sweep(w, b, 'at once: reopened', None)
    Q(w, a=b); SD(w, a=b)
    sweep(w, b, 'at once: the reopened try sent', 'answers')
    # The reopened try confirmed: its own answers and marking, at once.
    g, qg = new_piece(w, 'Reopened At Once')
    answer_all(w, g, qg); tg = try_id(d, g, w.cece)
    levels(w, g, w.cece, [3, 2, 4]); confirm(w, g, [(tg, M1(qg))])
    T(d, 'reopen_quiz(:a, :e, null)', a=g, e=w.cece); Q(w, a=g); SV(w, qg[1]['id'], False, a=g); SD(w, a=g)
    tg2 = try_id(d, g, w.cece, 2)
    levels(w, g, w.cece, [4, 3, 4]); confirm(w, g, [(tg2, M2(qg))])
    x = sweep(w, g, 'at once: the reopened try confirmed', 'answers'); check_view(w, g, w.cece, x, 'answers', M2(qg), False)
    # A re-confirm that changes no score: shown at once.
    c, qc = new_piece(w, 'Same Scores At Once')
    answer_all(w, c, qc); tc = try_id(d, c, w.cece)
    levels(w, c, w.cece, [3, 2, 4]); confirm(w, c, [(tc, M1(qc))]); confirm(w, c, [(tc, M2(qc))])
    x = sweep(w, c, 'at once: a re-confirm with the same scores', 'answers'); check_view(w, c, w.cece, x, 'answers', M2(qc), False)
    # Undo of a first Confirm: the scores cleared take the return with them.
    e, qe = new_piece(w, 'Undo First At Once')
    answer_all(w, e, qe); te = try_id(d, e, w.cece)
    levels(w, e, w.cece, [3, 2, 4]); confirm(w, e, [(te, M1(qe))])
    sweep(w, e, 'at once: confirmed', 'answers')
    levels(w, e, w.cece, [0, 0, 0]); confirm(w, e, [(te, None)])
    sweep(w, e, 'at once: Undo of the first Confirm', None)
    # Tries left and closed, the same rule at once.
    f, qf = new_piece(w, 'Two Tries At Once', tries=2)
    answer_all(w, f, qf); tf_ = try_id(d, f, w.cece)
    levels(w, f, w.cece, [3, 2, 4]); confirm(w, f, [(tf_, M1(qf))])
    sweep(w, f, 'at once: two tries, one sent and confirmed, open', None)
    settings(w, f, after_due='until', accept_until='2020-01-01')
    sweep(w, f, 'at once: two tries, one sent and confirmed, closed', 'answers')
    u, qu = new_piece(w, 'Unlimited At Once', tries=0)
    answer_all(w, u, qu); tu = try_id(d, u, w.cece)
    levels(w, u, w.cece, [3, 2, 4]); confirm(w, u, [(tu, M1(qu))])
    sweep(w, u, 'at once: unlimited, sent and confirmed, open', None)
    settings(w, u, after_due='until', accept_until='2020-01-01')
    sweep(w, u, 'at once: unlimited, closed', 'answers')
    # Switched back to When I Return Them: a marking later than the last return is not shown until a Return.
    at_once(w, False)
    sweep(w, a, 'switched back: the marking that landed after its scores waits for a Return', None)
    sweep(w, b, 'switched back: the marking that landed before its scores is still returned', 'answers')
    d.close()

def scen_notfound():
    w = world('notfound'); d = w.d
    for label, a in (('a Draft', w.draft), ("next week's piece", w.later), ('a piece with no quiz', w.plain), ('a DIBELS piece', w.dib),
                     ("another teacher's piece", w.ab), ("her other class's piece", w.soc), ('a made-up piece', nid())):
        r = R(w, a=a)
        ok('notfound: %s is not_found' % label, r == {'ok': False, 'error': 'not_found'}, r)
    a, qq = new_piece(w, 'Paired Later')
    answer_all(w, a, qq); t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))]); give_back(w, a, w.cece)
    ok('(setup) returned', R(w, a=a)['returned'] is True)
    for mode in ('pairs', 'groups'):
        T(d, 'save_collab(:a, :m, null)', a=a, m=mode)
        r = R(w, a=a)
        ok('notfound: the returned quiz switched to %s is not_found, nothing of the key' % mode, r == {'ok': False, 'error': 'not_found'}, r)
    T(d, "save_collab(:a, 'none', null)", a=a)
    ok('notfound: switched back, returned again', R(w, a=a)['returned'] is True)
    ok("notfound: her other class's session entry on the same device cannot reach this piece",
       S(d, "student_submit.quiz_result(:t, :e, :a, 'ip')", t=w.tok[w.cece2], e=w.cece2, a=a) == {'ok': False, 'error': 'not_found'})
    d.close()

def scen_refused():
    w = world('refused'); d = w.d
    a, qq = new_piece(w, 'Refused')
    answer_all(w, a, qq, e=w.dev); t = try_id(d, a, w.dev)
    levels(w, a, w.dev, [3, 2, 4]); confirm(w, a, [(t, M1(qq))]); give_back(w, a, w.dev)
    ok('(setup) Dev\'s is returned', R(w, e=w.dev, a=a)['returned'] is True)
    import quizzes_student_list as ql
    for label, do, undo, want in ql.qs_cases():
        d.run(do, e=w.dev); n = log_rows(d); s0 = sums(d)
        r = R(w, e=w.dev, a=a)
        ok('refused: %s is %s' % (label, want), r == {'ok': False, 'error': want}, r)
        ok('refused: %s: nothing written' % label, log_rows(d) == n and sums(d) == s0)
        d.run(undo, e=w.dev)
        ok('refused: (setup) %s put back' % label, R(w, e=w.dev, a=a).get('returned') is True)
    for label, e, tok, want in (('an unknown session', w.dev, 'f' * 64, 'signed_out'), ('a token of the wrong shape', w.dev, 'x', 'signed_out'),
                                ('the token itself, not its hash', w.dev, 'not-a-hash', 'signed_out'),
                                ("an enrolment not on this session (a classmate's)", w.dev, w.tok[w.eli], 'not_found'),
                                ('an enrolment that is not there', nid(), w.tok[w.dev], 'not_found'), ('a null enrolment', None, w.tok[w.dev], 'not_found'),
                                ('a withdrawn student with a card', w.wes, w.tok[w.wes], 'not_found')):
        r = S(d, "student_submit.quiz_result(:t, :e, :a, 'ip')", t=tok, e=e, a=a)
        ok('refused: %s is %s' % (label, want), r == {'ok': False, 'error': want}, r)
    d.close()

def scen_nowrite():
    w = world('nowrite'); d = w.d
    a, qq = new_piece(w, 'No Write')
    answer_all(w, a, qq); t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))]); give_back(w, a, w.cece)
    s0 = sums(d); n0 = log_rows(d)
    xmax = d.all('select assessment_id::text, xmax::text from quiz order by 1')
    for _ in range(700): r = R(w, a=a)
    ok('nowrite: 700 calls in an hour: still returned, never too_many', r.get('returned') is True, r)
    ok('nowrite: no row changed or added, no write_log row', sums(d) == s0 and log_rows(d) == n0)
    ok('nowrite: no lock was taken on a quiz row (xmax unchanged)', d.all('select assessment_id::text, xmax::text from quiz order by 1') == xmax)
    ok('nowrite: it is marked stable', d.one("select provolatile from pg_proc where oid = to_regprocedure(:s)", s=RESULT) == 's')
    hold = Conn(d); hold.run('begin'); hold.run("select 1 from public.quiz where assessment_id = '%s' for update" % a)
    t0 = time.time(); r = R(w, a=a); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('nowrite: with the teacher holding the quiz for a save, it answers at once', r.get('returned') is True and took < 1, took)
    d.close()

def scen_others():
    w = world('others'); d = w.d
    for role in ('anon', 'authenticated'):
        r = refusal(lambda: d.role(role, "select student_submit.quiz_result(:t, :e, :a, 'ip')", uid=A if role == 'authenticated' else None,
                                   t=w.tok[w.cece], e=w.cece, a=w.a))
        ok('others: %s may not run quiz_result' % role, r and r[0] == '42501', r)
    owner = d.one("select proowner::regrole::text from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')")
    ok('others: granted to service_role and its owner alone', d.one('select proacl::text from pg_proc where oid = to_regprocedure(:s)', s=RESULT)
       == '{%s=X/%s,service_role=X/%s}' % (owner, owner, owner))
    ok('others: owned by the owner of _session_class, path pinned, security definer, stable',
       d.one("select proowner::regrole::text = :o and prosecdef and provolatile = 's' and proconfig = array['search_path=public, student_submit, pg_temp'] "
             "from pg_proc where oid = to_regprocedure(:s)", s=RESULT, o=owner) is True)
    ok('others: service_role runs it', R(w).get('ok') is True)
    named = d.all("select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                  "where n.nspname = 'student_submit' and strpos(case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end, 'quiz_key') > 0 "
                  "order by 1")
    ok('others: the catalog: quiz_result is the only student_submit function that names quiz_key', named == [[RESULT]], named)
    total = d.one("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'")
    ok('others: (that check read every student_submit function: %d)' % total, total > 70)
    d.close()

EXPECTED = re.compile(r'quiz_result|^depends |pg_depend|^comments on ')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog(d.c); s0 = sums(d)
    new, relied = header_md5s()
    ok('apply: the header names its new function and the sixteen it relies on', sorted(new) == [RESULT] and sorted(relied) == sorted(RELIED), (new, sorted(relied)))
    ok("apply: the relied-on functions are the header's here", all(md5(d, s) == relied[s] for s in RELIED), {s: md5(d, s) for s in RELIED if md5(d, s) != relied.get(s)})
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
    guard('a quiz_result with other arguments', 'create function student_submit.quiz_result(text) returns int language sql as $$ select 1 $$',
          'drop function student_submit.quiz_result(text)', 'other arguments or in another schema')
    guard('a quiz_result in public', 'create function public.quiz_result(uuid) returns int language sql as $$ select 1 $$',
          'drop function public.quiz_result(uuid)', 'other arguments or in another schema')
    guard("a quiz_result that is not this file's", "create function student_submit.quiz_result(text, uuid, uuid, text) returns jsonb language sql as $$ select null::jsonb $$",
          'drop function student_submit.quiz_result(text, uuid, uuid, text)', 'is not the definition this file was written against')
    for t, col, other in (('quiz_attempt', 'marked_at', 'marked_when'), ('quiz', 'shows', 'show'), ('quiz_key', 'why', 'why_line'),
                          ('quiz_answer', 'answer', 'raw'), ('grade_return', 'is_draft', 'draft')):
        guard('a %s column missing (%s)' % (t, col), 'alter table public.%s rename column %s to %s' % (t, col, other),
              'alter table public.%s rename column %s to %s' % (t, other, col), 'Nothing was changed')
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('student_submit._quiz_questions(uuid,jsonb)')) as def")
    d.run('drop function student_submit._quiz_questions(uuid, jsonb)')
    before = catalog(d.c); r = d.file(FILE)
    ok('apply guard: _quiz_questions missing stops the file', r.startswith('STOPPED') and 'none: the function is missing' in r, r)
    ok('apply guard: and the pre-check names it absent', d.statements(pre) == 'ok' and ['fingerprint student_submit._quiz_questions(uuid,jsonb)', 'absent'] in d.rows, d.rows)
    ok('apply guard: and leaves the catalog as it was', catalog(d.c) == before)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    d.run('revoke all on function student_submit._quiz_questions(uuid, jsonb) from public, anon, authenticated, service_role')
    ok('(setup) _quiz_questions is back with its grants', same(catalog(d.c), base), differences(norm(base), norm(catalog(d.c))))
    d.run('set role service_role'); r = d.file(FILE); d.run('reset role')
    ok('apply guard: a run as a role that does not own the quiz tables stops the file', r.startswith('STOPPED') and 'Run this as the owner' in r, r)
    d.run('set role service_role'); r = d.file(PRE); rows_ = d.rows; d.run('reset role')
    ok('apply guard: and the pre-check, run as that role, names it', r == 'ok' and any(x[0].startswith('the role running this') for x in rows_), (r, rows_))
    ok('apply: after the guards the catalog is the one before', same(catalog(d.c), base))
    a, qq = new_piece(w, 'Apply'); answer_all(w, a, qq); s0 = sums(d)
    r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
    after = catalog(d.c); gone, came = differences(norm(base), norm(after))
    ok('apply: the catalog changes only in the new function', all(EXPECTED.search(l) for l in gone + came) and not [l for l in gone if 'quiz_result' in l],
       [l for l in gone + came if not EXPECTED.search(l)][:6])
    ok('apply: no row changed', sums(d) == s0)
    ok("apply: the function is the header's", md5(d, RESULT) == new[RESULT], md5(d, RESULT))
    r = d.file(POST)
    ok('apply: the post-check says ok on all 22 rows', r == 'ok' and len(d.rows) == 22 and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or (r, len(d.rows)))
    ok('apply: the pre-check now names it as there', d.statements(pre) == 'ok' and d.rows == [['already there: function student_submit.quiz_result(text,uuid,uuid,text)', 'present']], d.rows)
    r = d.file(FILE); ok('apply: a second run is ok and changes nothing', r == 'ok' and catalog(d.c) == after and sums(d) == s0, r)
    raw = open(os.path.join(HERE, FILE), 'rb').read()
    ok('apply: the file is under 40 KB (%d bytes)' % len(raw), len(raw) < 40960)
    for f in (FILE, UNDO, POST):
        b = open(os.path.join(HERE, f), 'rb').read()
        ok('apply: %s is plain ASCII with no backslash at all' % f, all(c == 10 or 32 <= c <= 126 for c in b) and b'\\' not in b)
    b = open(os.path.join(HERE, PRE), 'rb').read()
    ok("apply: the pre-check's only backslashes are the route row's", all(c == 10 or 32 <= c <= 126 for c in b) and b.count(b'\\') == 6)
    ok('apply: the header names its tests, undo and checks', all(x in HEADER for x in ('quiz_returned.py', UNDO, PRE, POST)))
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
    body = ("order by q.n)", "order by q.n desc)")
    keyed = ("create or replace function student_submit.quiz_x() returns int language sql stable as "
             "$x$ select count(*)::int from public.quiz_key $x$;")
    for label, extra, rep, want in (
        ('the body', None, body, ['function student_submit.quiz_result(text,uuid,uuid,text) has md5']),
        ('a grant to anon', 'grant execute on function student_submit.quiz_result(text, uuid, uuid, text) to anon;', None,
         ['grant: function student_submit.quiz_result(text,uuid,uuid,text) may be run by anon, service_role, not service_role']),
        ('volatile', None, (' stable security definer\n set search_path', ' volatile security definer\n set search_path'),
         ['has md5', 'read-only: student_submit.quiz_result is not marked stable']),
        ('another student_submit function naming quiz_key', keyed, None, ['the key: a student_submit function other than quiz_result names quiz_key']),
        ('a grant to PUBLIC and the body at once', 'grant execute on function student_submit.quiz_result(text, uuid, uuid, text) to public;', body,
         ['grant: function student_submit.quiz_result(text,uuid,uuid,text) may be run by PUBLIC, service_role', 'has md5']),
    ) + (() if qs.NONSUPER else (
        ('the owner', 'alter function student_submit.quiz_result(text, uuid, uuid, text) owner to service_role;', None,
         ['grant: function student_submit.quiz_result(text,uuid,uuid,text) may be run by its owner only, not service_role',
          'owner: student_submit.quiz_result is not owned by the owner of _session_class']),)):
        r = d.statements(split(mutant(extra, rep)))
        ok('lastcheck: %s changed: the file stops' % label, r.startswith('STOPPED') and 'Not as tested (%d found)' % len(want) in r, r)
        ok('lastcheck: %s: the message names exactly that part' % label, all(x in r for x in want), r)
        ok('lastcheck: %s: nothing is left behind' % label, catalog(d.c) == base, differences(base, catalog(d.c)))
    d.close()

def scen_undofile():
    w = world('undofile', with_file=False); d = w.d
    base = catalog(d.c); s0 = sums(d)
    r = d.file(UNDO); ok('undo: on a database without the file it is ok and changes nothing', r == 'ok' and catalog(d.c) == base and sums(d) == s0, r)
    r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
    withfile = catalog(d.c)
    a, qq = new_piece(w, 'Undo File'); answer_all(w, a, qq); t = try_id(d, a, w.cece)
    levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))]); give_back(w, a, w.cece); s1 = sums(d)
    with tx(d):
        d.run('revoke execute on function student_submit.quiz_result(text, uuid, uuid, text) from service_role')
        ok('undo: a revoke would stop nothing: the owner still runs it',
           d.one("select student_submit.quiz_result(:t, :e, :a, 'ip')", t=w.tok[w.cece], e=w.cece, a=a)['returned'] is True)
    r = d.statements(split(part1())); ok('undo PART 1: runs', r == 'ok', r)
    x = refusal(lambda: d.one("select student_submit.quiz_result(:t, :e, :a, 'ip')", t=w.tok[w.cece], e=w.cece, a=a))
    ok('undo PART 1: the owner can no longer run it: it is gone', x and x[0] == '42883', x)
    ok('undo PART 1: no row changed; the catalog is as before the file', sums(d) == s1 and catalog(d.c) == base, differences(base, catalog(d.c)))
    ok("undo PART 1: the other quiz routes still work", Q(w, a=a)['ok'] is True and L(w)['ok'] is True)
    r = d.file(FILE); ok('undo: the file gives it back', r == 'ok' and same(catalog(d.c), withfile) and R(w, a=a)['returned'] is True, r)
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % RESULT)
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.statements(split(part1()))
    ok('undo PART 1: a function changed since stops it, dropping nothing', r.startswith('STOPPED') and 'is not the definition 2026112407 left' in r and applied(d), r)
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
        fp = {s: md5(d, s) for s in [RESULT] + RELIED}
        a, qq = new_piece(w, 'Collations', shuffle_questions=False, shuffle_choices=False)
        answer_all(w, a, qq); t = try_id(d, a, w.cece)
        levels(w, a, w.cece, [3, 2, 4]); confirm(w, a, [(t, M1(qq))]); give_back(w, a, w.cece)
        v = R(w, a=a)
        ok('collations %s: a returned view' % tag, v.get('returned') is True and len(v['questions']) == 5, v)
        shape = [(q['number'], q['kind'], q['result'], q['why']) for q in v['questions']]
        r = d.file(UNDO); ok('collations %s: the undo runs' % tag, r == 'ok' and not applied(d), r)
        r = d.file(FILE); ok('collations %s: the file applies again' % tag, r == 'ok' and applied(d), r)
        seen[tag] = (fp, post, shape)
        d.close()
    ok('collations: the fingerprints are the same under ICU en-US and under C', seen['icu'][0] == seen['c'][0])
    ok("collations: the post-check's rows are the same under both", seen['icu'][1] == seen['c'][1])
    ok('collations: the returned view is the same under both (order, kinds, results, why lines)', seen['icu'][2] == seen['c'][2], seen)

SCENARIOS = {'stages': scen_stages, 'shows': scen_shows, 'tries': scen_tries, 'order': scen_order, 'undo': scen_undo,
             'atonce': scen_atonce, 'notfound': scen_notfound, 'refused': scen_refused, 'nowrite': scen_nowrite,
             'others': scen_others, 'apply': scen_apply, 'lastcheck': scen_lastcheck, 'undofile': scen_undofile,
             'collations': scen_collations}
if __name__ == '__main__':
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
