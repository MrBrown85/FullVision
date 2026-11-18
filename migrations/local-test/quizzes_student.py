"""Quizzes, the student's side: migrations/2026111806_quizzes_student.sql (MQ2) on a database rebuilt from the repo
and proved equal to live (scripts/db-rebuild.mjs --check), which has MQ1 (2026111804, 2026111805) and Bulletins' M2
(2026111803) already (README.md, "Quizzes, the student's side"). The contract is quizzes-contract.md, "The student's
side (MQ2)".

    PGPORT=<port> PGDATABASE=<db> python3 quizzes_student.py          every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 quizzes_student.py open     or some
    FV_NONSUPER=<role>       every scenario as a role that is not a superuser, with live's default privileges
    FV_ICU_DB, FV_C_DB       the two templates scenario collations uses (ICU en-US as live, and C)

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only. Quizzes are made through the teacher's own
save_quiz; tries are made only through the three functions under test (and reopen_quiz).

  open      quiz: the first open starts try 1 in an order kept on the try (the same on every call and on a second
            device); shuffled or in position order as the quiz says, choices too; a question added later at the end,
            an archived one left out, a choice added later at the end of its question; the keys at every level are
            the contract's; a second open makes nothing and spends no write; new_try with a try open makes nothing;
            a quiz closed before the first open answers try null and makes nothing.
  save      quiz_save: every kind; choice ids stored in byte order, text trimmed; replaced by a later save; cleared
            by SQL null and by JSON null; 24 wrong shapes each bad_answer naming the question, writing nothing and
            spending no write; an archived question, another quiz's and a made-up one are not_found.
  send      quiz_send closes the try; a second send and a save after it are sent; nothing changes on a sent try.
  tries     one try: no_tries_left; two: Try Again then no_tries_left; unlimited: tries_left null, tries 1 to 4;
            the number lowered by the teacher after two tries; can_try_again and can_answer each way.
  closed    stop with the due date passed, until with its last day passed and on it, keep; read in the class's time
            zone (a day apart at UTC+14 and UTC-11); quiz_closed on save, send and new_try; can_answer false on an
            open ordinary try once closed.
  reopen    reopen_quiz after a sent try: the next open starts it in an order of its own and it is answerable after
            the quiz closes; a save before that open is sent; an in-progress try reopened while closed can be
            answered; reopen before any try: the first open is that try.
  refused   On all three: a paused, withdrawn, page-off, trash, stopped-card, expired-card, unknown-session,
            expired-session, classmate's and made-up enrolment, each refused with its code and nothing written
            (not the write limit). A Draft, a piece assigned next week, a piece with no quiz, a DIBELS piece,
            another teacher's piece and the student's other class's piece are not_found.
  access    The rule for unfinished answers: list_quiz_tries answers no unsent answer, order, time or id; another
            student's session is not_found for this one's enrolment and sees only its own; the student's other
            class on the same device is not_found; a second device carries on in the same try, order and answers.
  leak      The key's marker values (a why line, a number key, a tolerance), the competencies' ids, a teacher's
            note and given points, and marked, appear in no reply of any function at any stage (not started, part
            way, sent, tries left, reopened, confirmed but not returned); no function of the six names quiz_key;
            over 300 new orders the right choice sits in every place about as often.
  limit     600 writes an hour per card across the three: the 601st is too_many with a wait and writes nothing;
            another card is not counted; an open that starts nothing is not counted; every kind write_log held
            before still passes the widened check.
  race      Two saves of one answer at once (one row, the later kept); two first opens at once (one try); a save
            racing a send; a save holding the quiz while the teacher removes that question (archived); a Reopen
            racing an open; three rounds each.
  released  The released app's writes (page, seen, answer_seen, bulletin_seen, bulletin_react, save_quiz, list_quiz,
            reopen_quiz, list_quiz_tries, mark_quiz_answer, confirm_quiz, Unassign, delete_assessment, done) answer
            the same and leave the same rows with and without the file.
  others    anon, authenticated and public run none of the six; service_role runs the three and not the helpers;
            every function runs as its owner with the path pinned; no grant on any table changed.
  defaults  With wide default privileges in place the file still leaves the grants exact.
  apply     The guards stop with the catalog unchanged (each relied-on function changed, the check changed, a second
            check, the check unvalidated or renamed, an MQ1 column missing, quiz_answer's key, a function of these
            names elsewhere, the wrong role); the pre-check names each; a relied-on function missing; the lock
            timeout; only the header's changes; no row changed; the header's md5s; post-check; a second run; size;
            plain ASCII with no backslash.
  lastcheck Each part the last check reads (a function's md5, its grant, its owner, the check) tripped alone and two
            at once: the message names exactly those parts and nothing is left behind.
  undo      PART 1 drops the three (a revoke would stop nothing), every try and answer kept; the file gives them back;
            a changed function stops both parts; the full undo puts the check back exactly, deleting only write_log's
            quiz rows; a second run; on a database without the file nothing changes; sent whole, PART 1 stays when
            PART 2 refuses; the file applies again.
  undolock  The full undo takes write_log before it deletes: a student's write arriving between waits and goes
            through (the old order is shown to deadlock).
  collations On ICU en-US and on C: the pre-check is empty, the file applies, runs again, passes its post-check,
            undoes and applies again; the fingerprints, the post-check's rows and a stored choice answer whose ids
            sort differently by collation are the same under both.
"""
import json, os, re, sys, threading, time
if os.environ.get("PG8000_PATH"): sys.path.insert(0, os.environ["PG8000_PATH"])
import pg8000.native
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, tx, ok, finish, nid, connect, message, sqlstate, split, text_of, KEY_ID
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111806_quizzes_student.sql'
UNDO = 'quizzes-student-undo.sql'
PRE = 'quizzes-student-live-precheck.sql'
POST = 'quizzes-student-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
WINDOW = 'student_submit._quiz_window(uuid,uuid)'; NEWORDER = 'student_submit._quiz_new_order(uuid)'
QUESTIONS = 'student_submit._quiz_questions(uuid,jsonb)'
QUIZ = 'student_submit.quiz(text,uuid,uuid,text,boolean)'; SAVE = 'student_submit.quiz_save(text,uuid,uuid,uuid,jsonb,text)'
SEND = 'student_submit.quiz_send(text,uuid,uuid,text)'
HELPERS = [WINDOW, NEWORDER, QUESTIONS]; ROUTES = [QUIZ, SAVE, SEND]; OURS = HELPERS + ROUTES
RELIED = ['student_submit._session_class(text,uuid)', 'student_submit._card_refusal(uuid)', 'student_submit._device_session(text)',
          'student_submit._write_limit(uuid,text,integer)', 'student_submit._listed(public.assessment,date)', 'student_submit._work_window(uuid)',
          'public._fv_timezone(text)', 'public.reopen_quiz(uuid,uuid,uuid)', 'public._quiz_draft_guard()', 'public._quiz_attempt_same_class()']
KINDS5 = "ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text]"
OLD_CHECK = 'CHECK ((kind = ANY (%s)))' % KINDS5
NEW_CHECK = "CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text, 'quiz'::text])))"
OLD_ADD = "check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text]))"
TABLES = ['public.quiz', 'public.quiz_question', 'public.quiz_key', 'public.quiz_attempt', 'public.quiz_answer']
HEADER = text_of(FILE)
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
# The key's marker values: none may reach a student before MQ3's returned view.
MARK_WHY = 'ZQX-KEY-MARKER'; MARK_NUM = 31415.9265; MARK_TOL = 0.0271828; MARK_NOTE = 'ZQX-NOTE-MARKER'
# The contract's keys, level by level ("The student's side (MQ2)").
K_QUIZ = {'ok', 'quiz', 'try', 'sent_tries', 'can_answer', 'can_try_again', 'questions', 'answers'}
K_INFO = {'tries', 'tries_left', 'closed', 'closes_on'}
K_TRY = {'number', 'sent', 'started_at', 'sent_at', 'reopened'}
K_QUESTION = {'id', 'number', 'kind', 'prompt', 'points', 'multiple', 'choices'}
K_CHOICE = {'id', 'text'}
K_SAVE = {'ok', 'question_id', 'saved_at'}
K_SEND = {'ok', 'try', 'sent_at', 'tries_left', 'can_try_again'}
SQLNULL = object()

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def S(d, sql, **kw): return d.service(sql, **kw)
def applied(d): return d.one("select to_regprocedure('student_submit.quiz(text,uuid,uuid,text,boolean)') is not null")
def kind_check(d): return d.all("select pg_get_constraintdef(oid), convalidated from pg_constraint where conrelid = 'student_submit.write_log'::regclass and contype = 'c'")
def header_md5s():
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    relied = dict(re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})$', HEADER, re.M))
    return new, relied
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]
def part2(): return text_of(UNDO).split('-- PART 1 ends')[1]
def log_rows(d, kind=None):
    return d.one('select count(*) from student_submit.write_log' + (" where kind = '%s'" % kind if kind else ''))
def refusal(fn):
    try: fn()
    except Exception as e: return (sqlstate(e), message(e))
    return None
def sums(d): return row_checksums(d.c, table_columns(d.c))
def quiz_rows(d): return {t: d.all('select to_jsonb(x)::text from %s x order by to_jsonb(x)::text collate "C"' % t) for t in TABLES}
def u4():
    import uuid; return str(uuid.uuid4())

# ── Quizzes as the teacher's app sends them (save_quiz, MQ1) ──────────────────
SETTINGS = dict(shuffle_questions=True, shuffle_choices=True, tries=1, counts='best', shows='answers', add_total=False,
                after_due='keep', accept_until=None)
def choice(prompt='Which is a producer?', texts=('Grass', 'Hawk', 'Fox'), right=(0,), multiple=False, points=1, tag=None, why=None):
    ch = [{'id': u4(), 'text': t} for t in texts]
    return {'kind': 'choice', 'prompt': prompt, 'choices': ch, 'multiple': multiple, 'points': points, 'tag_id': tag,
            'key': {'answer': [ch[i]['id'] for i in right], 'why': why}}
def tf(prompt='Plants make food.', answer=True, tag=None): return {'kind': 'true_false', 'prompt': prompt, 'points': 1, 'tag_id': tag, 'key': {'answer': answer}}
def num(prompt='Half of 7?', answer=3.5, tolerance=0.1, tag=None):
    return {'kind': 'number', 'prompt': prompt, 'points': 2, 'tag_id': tag, 'key': {'answer': answer, 'tolerance': tolerance}}
def textq(prompt='Explain why.', tag=None, why=None): return {'kind': 'text', 'prompt': prompt, 'points': 3, 'tag_id': tag, 'key': {'answer': None, 'why': why}}
def payload(questions, **kw): return dict(SETTINGS, **kw, questions=questions)
def last_read(d, a): return d.one("select to_jsonb(updated_at) #>> '{}' from quiz where assessment_id = :a", a=a)
def tsave(w, a, q, uid=A):
    """save_quiz as an app that has just read the quiz."""
    if isinstance(q, dict): q = dict(q, updated_at=last_read(w.d, a))
    return T(w.d, 'save_quiz(:a, cast(:q as jsonb), null)', uid, a=a, q=json.dumps(q))
def as_sent(r):
    """A save_quiz answer back into its payload, unchanged (to edit and save again)."""
    r = json.loads(json.dumps(r))
    out = {k: r['quiz'][k] for k in SETTINGS}
    out['questions'] = [{'id': q['id'], 'kind': q['kind'], 'prompt': q['prompt'], 'choices': q['choices'], 'multiple': q['multiple'],
                         'points': q['points'], 'tag_id': q['tag_id'], 'key': q['key']} for q in r['questions']]
    for q in out['questions']:
        if q['choices'] is None: del q['choices']
    return out
def settings(w, a, **kw):
    r = T(w.d, 'list_quiz(:a)', a=a); p = as_sent(r); p.update(kw); return tsave(w, a, p)

class W: pass

def world(tag, with_file=True, template=None):
    """Teacher A: Science 8 (page on; Cece, Dev and Eli with cards; Wes withdrawn) and Socials 9 (page on; Cecily with a
    card, on Cece's device too); Teacher B: Bravo 10 (page on; Bea with a card). Science 8 has three competencies and
    these pieces: a (one try, shuffled, the five kinds, the key's markers), a2 (two tries, in order), au (unlimited),
    draft (a Draft with a quiz), later (assigned next week, with a quiz), plain (no quiz), dib (DIBELS, a quiz row put in
    as the owner). Socials 9 and Bravo 10 have a quiz each."""
    d = Db('q3a_' + tag, template)
    w = W(); w.d = d
    if applied(d):
        r = d.file(UNDO)
        if r != 'ok' or applied(d): sys.exit('could not take the template back to before the file: %s' % r)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=KEY_ID)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    def course(name, uid=A):
        return str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    def enrol(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())",
                     uid, c=c, f=first)['enrollment_id'])
    def tags(c, n, uid=A):
        subj = str(d.one('select id from subject where course_id = :c', c=c))
        sec = str(T(d, "upsert_section(null, :s, 'Questioning', p_idempotency_key => gen_random_uuid())", uid, s=subj))
        return [str(T(d, "upsert_tag(null, :s, :l, p_idempotency_key => gen_random_uuid())", uid, s=sec, l='Tag %d' % i)) for i in range(n)]
    def piece(c, title, uid=A, mode='proficiency', tags_=(), draft=False):
        return str(T(d, "create_assessment(:c, :t, p_score_mode => :m, p_max_points => case when :m = 'points' then 10 end, "
                        "p_tag_ids => cast(:g as uuid[]), p_is_draft => :dr)", uid, c=c, t=title, m=mode, g=list(tags_), dr=draft))
    w.c = course('Science 8'); w.c2 = course('Socials 9'); w.cb = course('Bravo 10', B)
    d.run('update course set student_page_enabled = true where id = any (:ids)', ids=[w.c, w.c2, w.cb])
    w.cece, w.dev, w.eli, w.wes = (enrol(w.c, n) for n in ('Cece', 'Dev', 'Eli', 'Wes'))
    w.cece2 = enrol(w.c2, 'Cecily'); w.bea = enrol(w.cb, 'Bea', B)
    w.card = {}; w.tok = {}
    for e, c, uid in ((w.cece, w.c, A), (w.dev, w.c, A), (w.eli, w.c, A), (w.wes, w.c, A), (w.cece2, w.c2, A), (w.bea, w.cb, B)):
        code, _pw, _row = d.make(e, c, uid)
        w.card[e] = code
    w.tok[w.cece] = sign_in(d, w.card[w.cece])
    r = d.verify(w.card[w.cece2], birthday='2012-05-15', token=w.tok[w.cece], add=True); assert r['ok'], r
    w.tok[w.cece2] = w.tok[w.cece]
    for e in (w.dev, w.eli, w.wes, w.bea): w.tok[e] = sign_in(d, w.card[e])
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.wes)
    w.t = tags(w.c, 3)
    w.a = piece(w.c, 'Food Webs Quiz', tags_=w.t)
    r = tsave(w, w.a, payload([choice(tag=w.t[0], why='Because ' + MARK_WHY), tf(tag=w.t[1]), num(answer=MARK_NUM, tolerance=MARK_TOL, tag=w.t[2]),
                               textq(tag=w.t[0], why=MARK_WHY + ' text'),
                               choice('Which are consumers?', texts=('Hawk', 'Grass', 'Fox', 'Moss'), right=(0, 2), multiple=True, tag=w.t[1])]))
    w.q = [x['id'] for x in r['questions']]; w.qs = r['questions']
    w.a2 = piece(w.c, 'Two Tries', tags_=w.t[:1])
    r = tsave(w, w.a2, payload([choice(tag=w.t[0]), tf(), textq()], tries=2, shuffle_questions=False, shuffle_choices=False))
    w.q2 = [x['id'] for x in r['questions']]; w.qs2 = r['questions']
    w.au = piece(w.c, 'Unlimited', tags_=w.t[:1])
    w.qu = [x['id'] for x in tsave(w, w.au, payload([tf(), num()], tries=0))['questions']]
    w.draft = piece(w.c, 'Draft Quiz', tags_=w.t[:1], draft=True); tsave(w, w.draft, payload([tf()]))
    w.later = piece(w.c, 'Next Week'); tsave(w, w.later, payload([tf()]))
    d.run('update assessment set date_assigned = current_date + 7 where id = :a', a=w.later)
    w.plain = piece(w.c, 'No Quiz')
    w.dib = piece(w.c, 'Reading', mode='dibels')
    d.run('insert into public.quiz (assessment_id) values (:a)', a=w.dib)
    w.soc = piece(w.c2, 'Socials Quiz'); w.qsoc = [x['id'] for x in tsave(w, w.soc, payload([tf()]))['questions']]
    w.ab = piece(w.cb, 'Bravo Quiz', B); w.qb = [x['id'] for x in tsave(w, w.ab, payload([tf()]), uid=B)['questions']]
    if NONSUPER:
        flags = as_live_postgres(d)
        ok('(setup %s) every later statement is a role that is not a superuser, as live\'s postgres' % tag, flags == 'falsetruetrue', flags)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def sign_in(d, code):
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

# FV_NONSUPER=<role>: the world is made as the superuser; then this copy's app schemas and everything in them are
# given to that role, which, like live's postgres, is not a superuser, may create roles and bypass row security,
# reads every table (pg_read_all_data), sees every session (pg_monitor), acts as anon, authenticated and service_role,
# and has live's default privileges for what it creates (live-database-facts). Every later statement on d's
# connection is that role's, the file's apply and undo included.
NONSUPER = os.environ.get('FV_NONSUPER')
def as_live_postgres(d):
    role = NONSUPER
    if not d.one('select exists (select 1 from pg_roles where rolname = :r)', r=role):
        d.run('create role "%s" login nosuperuser createrole bypassrls' % role)
    d.run('grant pg_read_all_data, pg_monitor, anon, authenticated, service_role to "%s"' % role)
    d.run("""do $own$ declare r record; begin
      for r in select nspname from pg_namespace where nspname in ('public', 'student_submit', 'fv_private') loop
        execute format('alter schema %%I owner to %%I', r.nspname, '%(r)s'); end loop;
      for r in select c.oid::regclass::text t, c.relkind k from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname in ('public', 'student_submit', 'fv_private') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
                  and not exists (select 1 from pg_depend dp where dp.objid = c.oid and dp.classid = 'pg_class'::regclass and dp.deptype in ('a', 'i'))
      loop execute format('alter %%s %%s owner to %%I', case r.k when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view'
                                                         when 'f' then 'foreign table' else 'table' end, r.t, '%(r)s'); end loop;
      for r in select p.oid::regprocedure::text s, p.prokind k from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'student_submit', 'fv_private')
      loop execute format('alter %%s %%s owner to %%I', case r.k when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, r.s, '%(r)s'); end loop;
      for r in select t.oid::regtype::text s from pg_type t join pg_namespace n on n.oid = t.typnamespace
                where n.nspname in ('public', 'student_submit', 'fv_private') and t.typtype in ('d', 'e')
      loop execute format('alter type %%s owner to %%I', r.s, '%(r)s'); end loop;
    end $own$""" % {'r': role})
    d.run('alter default privileges for role "%s" revoke execute on functions from public' % role)
    d.run('alter default privileges for role "%s" in schema public grant execute on functions to authenticated, service_role' % role)
    d.run('alter default privileges for role "%s" in schema public grant select, insert, update, delete on tables to authenticated' % role)
    d.run('alter default privileges for role "%s" in schema public grant select, usage on sequences to authenticated' % role)
    d.c.close()
    d.c = pg8000.native.Connection(role, host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')), database=d.name)
    return d.one('select rolsuper::text || rolcreaterole::text || rolbypassrls::text from pg_roles where rolname = current_user')

# ── The three, as the edge function calls them ───────────────────────────────
def Q(w, e=None, a=None, new_try=False, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.quiz(:t, :e, :a, 'ip', :n)", t=tok or w.tok.get(e), e=e, a=a or w.a, n=new_try)
def SV(w, q, ans, e=None, a=None, tok=None):
    e = e or w.cece
    v = None if ans is SQLNULL else json.dumps(ans)
    return S(w.d, "student_submit.quiz_save(:t, :e, :a, :q, cast(:v as jsonb), 'ip')", t=tok or w.tok.get(e), e=e, a=a or w.a, q=q, v=v)
def SD(w, e=None, a=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.quiz_send(:t, :e, :a, 'ip')", t=tok or w.tok.get(e), e=e, a=a or w.a)
def attempts(d, a, e):
    return d.all('select try, sent_at is not null, reopened_at is not null, started_at is not null from quiz_attempt '
                 'where assessment_id = :a and enrollment_id = :e order by try', a=a, e=e)
def answers_of(d, a, e, tr=None):
    return {str(x[0]): x[1] for x in d.c.run('select n.question_id, n.answer from quiz_answer n join quiz_attempt t on t.id = n.attempt_id '
                                             'where t.assessment_id = :a and t.enrollment_id = :e and (cast(:tr as int) is null or t.try = :tr)', a=a, e=e, tr=tr)}
def ids(r): return [x['id'] for x in r['questions']]
def course_today(d, c): return d.one("select (now() at time zone public._fv_timezone(timezone))::date::text from course where id = :c", c=c)

def keys_exact(label, r):
    """Every level of a quiz answer has exactly the contract's keys."""
    ok('%s: the answer has exactly the contract\'s keys' % label, set(r) == K_QUIZ, sorted(r))
    ok('%s: quiz has exactly its four' % label, set(r['quiz']) == K_INFO, r['quiz'])
    ok('%s: try is null or has exactly its five' % label, r['try'] is None or set(r['try']) == K_TRY, r['try'])
    ok('%s: each question has exactly its seven' % label, all(set(q) == K_QUESTION for q in r['questions']), [sorted(q) for q in r['questions']][:1])
    ok('%s: each choice has exactly id and text; choices is null on every other kind' % label,
       all((q['choices'] is None) == (q['kind'] != 'choice') and all(set(c) == K_CHOICE for c in (q['choices'] or [])) for q in r['questions']))
    ok('%s: answers are by a question id shown' % label, set(r['answers']) <= set(ids(r)), (r['answers'], ids(r)))

# ── Scenarios ────────────────────────────────────────────────────────────────
def scen_open():
    w = world('open'); d = w.d
    n0 = log_rows(d, 'quiz')
    r = Q(w)
    keys_exact('open', r)
    ok('open: the first open starts try 1', r['try']['number'] == 1 and r['try']['sent'] is False and r['try']['started_at'] and r['try']['sent_at'] is None
       and r['try']['reopened'] is False and attempts(d, w.a, w.cece) == [[1, False, False, True]], r['try'])
    ok('open: quiz says one try, none left, open, no last day', r['quiz'] == {'tries': 1, 'tries_left': 0, 'closed': False, 'closes_on': None}, r['quiz'])
    ok('open: can answer, cannot try again, none sent, no answers', r['can_answer'] is True and r['can_try_again'] is False and r['sent_tries'] == 0 and r['answers'] == {})
    ok('open: starting spent one write', log_rows(d, 'quiz') == n0 + 1)
    ok('open: every active question, numbered 1 to 5', sorted(ids(r)) == sorted(w.q) and [q['number'] for q in r['questions']] == [1, 2, 3, 4, 5])
    order = d.one('select question_order from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=w.cece)
    ok('open: in the order stored on the try', ids(r) == order['questions'], (ids(r), order))
    by = {q['id']: q for q in r['questions']}
    ok('open: each choice question in its stored choice order, with the teacher\'s texts',
       all([c['id'] for c in by[k]['choices']] == v for k, v in order['choices'].items())
       and {c['text'] for c in by[w.q[0]]['choices']} == {'Grass', 'Hawk', 'Fox'})
    ok('open: kind, prompt, points and multiple as the teacher set them',
       [(by[k]['kind'], by[k]['prompt'], by[k]['points'], by[k]['multiple']) for k in w.q] ==
       [('choice', 'Which is a producer?', 1, False), ('true_false', 'Plants make food.', 1, False), ('number', 'Half of 7?', 2, False),
        ('text', 'Explain why.', 3, False), ('choice', 'Which are consumers?', 1, True)], [(by[k]['kind'], by[k]['points']) for k in w.q])
    sums0 = sums(d)
    again = [Q(w) for _ in range(3)] + [Q(w, new_try=True)]
    ok('open: a second open, and new_try with a try open, answer the same try in the same order', all(x == r for x in again), again[-1])
    ok('open: and make nothing, write nothing, spend no write', sums(d) == sums0 and log_rows(d, 'quiz') == n0 + 1)
    # Shuffled: over twelve students' worth of new orders the questions come in more than one order; in order otherwise.
    orders = {json.dumps(d.one('select student_submit._quiz_new_order(:a)', a=w.a)['questions']) for _ in range(12)}
    ok('open: with Shuffle Questions on, students get different orders', len(orders) > 1, len(orders))
    r2 = Q(w, a=w.a2)
    ok('open: with Shuffle Questions off, position order; Shuffle Choices off, the teacher\'s order',
       ids(r2) == w.q2 and [c['id'] for c in r2['questions'][0]['choices']] == [c['id'] for c in w.qs2[0]['choices']], ids(r2))
    # The teacher adds a question and a choice (no answers yet), and removes one with an answer (archived).
    SV(w, w.q2[2], 'Light, because.', a=w.a2)
    p = as_sent(T(d, 'list_quiz(:a)', a=w.a2))
    p['questions'][0]['choices'].append({'id': u4(), 'text': 'Moss'})
    p['questions'] = [p['questions'][1], p['questions'][0], tf('Added later.')]
    tsave(w, w.a2, p)
    r3 = Q(w, a=w.a2)
    added = [x['id'] for x in T(d, 'list_quiz(:a)', a=w.a2)['questions']][2]
    ok('open: a question removed is left out; one added later comes at the end; the rest keep the student\'s order',
       ids(r3) == [w.q2[0], w.q2[1], added] and [q['number'] for q in r3['questions']] == [1, 2, 3], ids(r3))
    ok('open: a choice added later comes at the end of its question', [c['text'] for c in r3['questions'][0]['choices']][-1] == 'Moss'
       and len(r3['questions'][0]['choices']) == 4, r3['questions'][0]['choices'])
    ok("open: the archived question's answer is not sent", r3['answers'] == {}, r3['answers'])
    # Closed before the first open: nothing is made.
    settings(w, w.au, after_due='until', accept_until='2020-01-01')
    s1 = sums(d); n1 = log_rows(d, 'quiz')
    r4 = Q(w, a=w.au)
    ok('open: a quiz closed before the first open answers try null and nothing to show',
       r4['try'] is None and r4['questions'] == [] and r4['answers'] == {} and r4['quiz']['closed'] is True and r4['can_answer'] is False
       and r4['can_try_again'] is False and r4['quiz']['closes_on'] == '2020-01-01' and r4['quiz']['tries_left'] is None, r4)
    keys_exact('open closed', r4)
    ok('open: and makes nothing, spends nothing', sums(d) == s1 and log_rows(d, 'quiz') == n1)
    vol = sorted(d.all("select p.oid::regprocedure::text, p.provolatile from pg_proc p where p.oid = any(cast(:s as regprocedure[]))", s=OURS))
    ok('open: quiz is not marked read-only (it starts tries); the helpers that only read are', vol == sorted([[x, v] for x, v in zip(OURS, ['s', 'v', 's', 'v', 'v', 'v'])]), vol)
    d.close()

def scen_save():
    w = world('save'); d = w.d
    r = Q(w); n = log_rows(d, 'quiz')
    ch = [c['id'] for c in w.qs[0]['choices']]; mch = [c['id'] for c in w.qs[4]['choices']]
    good = [(w.q[0], [ch[1]], [ch[1]]), (w.q[1], False, False), (w.q[2], 3.5, 3.5), (w.q[2], -1e12, -1e12),
            (w.q[3], '  \tPlants need light.\n ', 'Plants need light.'), (w.q[4], [mch[3], mch[0]], sorted([mch[3], mch[0]])),
            (w.q[3], 'x' * 5000, 'x' * 5000), (w.q[3], ' ' + chr(160) + 'kept' + chr(160) + ' ', chr(160) + 'kept' + chr(160))]
    for q, sent, stored in good:
        x = SV(w, q, sent)
        ok('save: %r on a %s question is ok' % (str(sent)[:30], [y['kind'] for y in w.qs if y['id'] == q][0]),
           x.get('ok') is True and set(x) == K_SAVE and x['question_id'] == q, x)
        ok('save: and is stored as %r' % str(stored)[:30], answers_of(d, w.a, w.cece)[q] == stored, answers_of(d, w.a, w.cece).get(q))
    ok('save: each spent one write', log_rows(d, 'quiz') == n + len(good))
    ok('save: choice ids are stored in byte order, whatever order they were ticked', answers_of(d, w.a, w.cece)[w.q[4]] == sorted([mch[0], mch[3]]))
    t1 = d.one('select saved_at from quiz_answer where question_id = :q', q=w.q[0])
    x = SV(w, w.q[0], [ch[2]]); t2 = d.one('select saved_at from quiz_answer where question_id = :q', q=w.q[0])
    ok('save: a later save replaces the earlier, and its time is later', answers_of(d, w.a, w.cece)[w.q[0]] == [ch[2]] and t2 > t1
       and d.one('select count(*) from quiz_answer where question_id = :q', q=w.q[0]) == 1)
    r = Q(w)
    ok('save: quiz answers what was saved', r['answers'] == answers_of(d, w.a, w.cece), r['answers'])
    x = SV(w, w.q[1], SQLNULL)
    ok('save: SQL null clears the answer', x.get('ok') is True and w.q[1] not in answers_of(d, w.a, w.cece), x)
    x = SV(w, w.q[2], None)
    ok('save: JSON null clears it too', x.get('ok') is True and w.q[2] not in answers_of(d, w.a, w.cece), x)
    ok('save: clearing what is not there is ok', SV(w, w.q[2], None).get('ok') is True)
    bad = [(0, 'not a list'), (0, []), (0, [ch[0], ch[1]]), (0, [ch[0], ch[0]]), (0, [u4()]), (0, [mch[0]]), (0, [1]), (0, {'id': ch[0]}),
           (0, ch[0]), (4, []), (4, [mch[0], mch[0]]), (4, mch + [u4()]), (4, [mch[0], 'x']), (4, [[mch[0]]]),
           (1, 'true'), (1, 1), (1, [True]), (2, '3.5'), (2, 1e13), (2, -1.000001e12), (2, True),
           (3, '   '), (3, 'x' * 5001), (3, 42), (3, ['words'])]
    s0 = sums(d); n0 = log_rows(d, 'quiz')
    for i, v in bad:
        x = SV(w, w.q[i], v)
        ok('save: %r on question %d is bad_answer naming it' % (str(v)[:40], i + 1), x == {'ok': False, 'error': 'bad_answer', 'question_id': w.q[i]}, x)
    ok('save: the %d refusals wrote nothing and spent no write' % len(bad), sums(d) == s0 and log_rows(d, 'quiz') == n0)
    # Not a question of this quiz now.
    p = as_sent(T(d, 'list_quiz(:a)', a=w.a)); p['questions'] = p['questions'][1:]; tsave(w, w.a, p)
    ok('(setup) question 1, with an answer, is archived', d.one('select archived_at is not null from quiz_question where id = :q', q=w.q[0]))
    s0 = sums(d); n0 = log_rows(d, 'quiz')
    for label, q in (('an archived question', w.q[0]), ("another quiz's question", w.q2[0]), ('a made-up id', u4()), ('a null id', None)):
        x = SV(w, q, True)
        ok('save: %s is not_found' % label, x == {'ok': False, 'error': 'not_found'}, x)
    ok('save: and wrote nothing', sums(d) == s0 and log_rows(d, 'quiz') == n0)
    ok('save: the archived answer is kept', answers_of(d, w.a, w.cece)[w.q[0]] == [ch[2]])
    ok('save: given points and note stay null on an unsent try', d.one('select count(*) from quiz_answer where given_points is not null or note is not null') == 0)
    d.close()

def scen_send():
    w = world('send'); d = w.d
    Q(w); SV(w, w.q[1], True)
    n = log_rows(d, 'quiz')
    x = SD(w)
    ok('send: the try is sent', x.get('ok') is True and set(x) == K_SEND and x['try'] == 1 and x['sent_at'] and x['tries_left'] == 0
       and x['can_try_again'] is False, x)
    ok('send: it spent one write and set sent_at only', log_rows(d, 'quiz') == n + 1 and attempts(d, w.a, w.cece) == [[1, True, False, True]])
    s0 = sums(d); n0 = log_rows(d, 'quiz')
    ok('send: a second send is sent', SD(w) == {'ok': False, 'error': 'sent'})
    ok('send: a save after it is sent', SV(w, w.q[1], False) == {'ok': False, 'error': 'sent'})
    ok('send: a clear after it is sent', SV(w, w.q[1], None) == {'ok': False, 'error': 'sent'})
    ok('send: and nothing changed, no write spent', sums(d) == s0 and log_rows(d, 'quiz') == n0)
    r = Q(w)
    ok('send: quiz shows the sent try, read-only, with its answers', r['try']['sent'] is True and r['try']['number'] == 1 and r['can_answer'] is False
       and r['can_try_again'] is False and r['sent_tries'] == 1 and r['answers'] == {w.q[1]: True}, r)
    ok('send: Try Again with no tries left is no_tries_left', Q(w, new_try=True) == {'ok': False, 'error': 'no_tries_left'})
    ok('send: and nothing was made', sums(d) == s0)
    ok("send: a student with no try sending is not_found", SD(w, e=w.dev) == {'ok': False, 'error': 'not_found'})
    ok("send: a student with no try saving is not_found", SV(w, w.q[1], True, e=w.dev) == {'ok': False, 'error': 'not_found'})
    d.close()

def scen_tries():
    w = world('tries'); d = w.d
    r = Q(w, a=w.a2); SD(w, a=w.a2)
    r = Q(w, a=w.a2)
    ok('tries: two tries, one sent: Try Again offered, the sent try shown', r['can_try_again'] is True and r['quiz']['tries_left'] == 1
       and r['try']['sent'] is True and r['can_answer'] is False, r)
    ok('tries: an open without new_try starts nothing', attempts(d, w.a2, w.cece) == [[1, True, False, True]])
    r = Q(w, a=w.a2, new_try=True)
    ok('tries: new_try starts try 2', r['try']['number'] == 2 and r['try']['sent'] is False and r['can_answer'] is True
       and r['quiz']['tries_left'] == 0 and r['answers'] == {} and r['sent_tries'] == 1, r)
    x = SD(w, a=w.a2)
    ok('tries: try 2 sent: none left', x['try'] == 2 and x['tries_left'] == 0 and x['can_try_again'] is False, x)
    ok('tries: a third is no_tries_left', Q(w, a=w.a2, new_try=True) == {'ok': False, 'error': 'no_tries_left'})
    ok('tries: two tries in all', attempts(d, w.a2, w.cece) == [[1, True, False, True], [2, True, False, True]])
    # The teacher lowers it to one after Dev has two: tries_left is 0, never below.
    Q(w, e=w.dev, a=w.a2); SD(w, e=w.dev, a=w.a2); Q(w, e=w.dev, a=w.a2, new_try=True); SD(w, e=w.dev, a=w.a2)
    settings(w, w.a2, tries=1)
    r = Q(w, e=w.dev, a=w.a2)
    ok('tries: lowered to one after two: tries_left 0, no Try Again', r['quiz']['tries'] == 1 and r['quiz']['tries_left'] == 0 and r['can_try_again'] is False, r['quiz'])
    settings(w, w.a2, tries=2)
    # Unlimited.
    for i in range(1, 5):
        r = Q(w, a=w.au, new_try=(i > 1))
        ok('tries: unlimited, try %d starts' % i, r['try']['number'] == i and r['quiz']['tries_left'] is None and r['quiz']['tries'] == 0, r)
        x = SD(w, a=w.au)
        ok('tries: unlimited, try %d sent, Try Again still offered' % i, x['tries_left'] is None and x['can_try_again'] is True, x)
    # One try.
    Q(w); SD(w)
    ok('tries: one try: a second is no_tries_left', Q(w, new_try=True) == {'ok': False, 'error': 'no_tries_left'})
    ok('tries: each student counts their own', Q(w, e=w.eli)['try']['number'] == 1)
    d.close()

def scen_closed():
    w = world('closed'); d = w.d
    Q(w); SV(w, w.q[1], True)
    today = course_today(d, w.c)
    d.run("update assessment set due_date = cast(:t as date) - 1 where id = :a", a=w.a, t=today)
    settings(w, w.a, after_due='stop')
    s0 = sums(d); n0 = log_rows(d, 'quiz')
    r = Q(w)
    ok('closed: Stop at the due date, the day after: closed, the open try not answerable', r['quiz']['closed'] is True and r['can_answer'] is False
       and r['try']['sent'] is False and r['quiz']['closes_on'] == d.one('select due_date::text from assessment where id = :a', a=w.a), r)
    ok('closed: a save is quiz_closed', SV(w, w.q[1], False) == {'ok': False, 'error': 'quiz_closed'})
    ok('closed: a send is quiz_closed', SD(w) == {'ok': False, 'error': 'quiz_closed'})
    ok("closed: a student who never opened it: try null", Q(w, e=w.dev)['try'] is None)
    ok('closed: Try Again is quiz_closed', Q(w, e=w.dev, new_try=True) == {'ok': False, 'error': 'quiz_closed'})
    ok('closed: nothing was written, no write spent', sums(d) == s0 and log_rows(d, 'quiz') == n0)
    d.run("update assessment set due_date = cast(:t as date) where id = :a", a=w.a, t=today)
    ok('closed: Stop on the due date itself: open', Q(w)['can_answer'] is True and SV(w, w.q[1], False)['ok'] is True)
    d.run("update assessment set due_date = null where id = :a", a=w.a)
    ok('closed: Stop with no due date: open', Q(w)['quiz']['closed'] is False)
    settings(w, w.a, after_due='until', accept_until=today)
    ok('closed: Until, on its last day: open', Q(w)['quiz'] == {'tries': 1, 'tries_left': 0, 'closed': False, 'closes_on': today})
    d.run("update quiz set accept_until = accept_until - 1 where assessment_id = :a", a=w.a)
    ok('closed: Until, the day after: closed', Q(w)['quiz']['closed'] is True and SV(w, w.q[1], True) == {'ok': False, 'error': 'quiz_closed'})
    settings(w, w.a, after_due='keep', accept_until=None)
    ok('closed: Keep: open whatever the due date', Q(w)['quiz']['closed'] is False)
    # The class's time zone decides the day: the same last day is open east of the date line and closed west of it on
    # some hours, so set the last day to the date in one zone and read it in the other.
    east = d.one("select (now() at time zone 'Pacific/Kiritimati')::date::text"); west = d.one("select (now() at time zone 'Pacific/Pago_Pago')::date::text")
    ok('(setup) Kiritimati is a day ahead of Pago Pago', east != west, (east, west))
    settings(w, w.a, after_due='until', accept_until=west)
    d.run("update course set timezone = 'Pacific/Pago_Pago' where id = :c", c=w.c)
    ok('closed: on its last day in the class\'s zone (UTC-11): open', Q(w)['quiz']['closed'] is False)
    d.run("update course set timezone = 'Pacific/Kiritimati' where id = :c", c=w.c)
    ok('closed: the same day is past in a class at UTC+14: closed', Q(w)['quiz']['closed'] is True)
    d.run("update course set timezone = 'Not/AZone' where id = :c", c=w.c)
    van = d.one("select (now() at time zone 'America/Vancouver')::date::text")
    ok("closed: a zone that is not one reads as Vancouver's, as every route reads it", Q(w)['quiz']['closed'] is (van > west))
    d.close()

def scen_reopen():
    w = world('reopen'); d = w.d
    Q(w); SV(w, w.q[1], True); SD(w)
    settings(w, w.a, after_due='until', accept_until='2020-01-01')
    r = T(d, 'reopen_quiz(:a, :e, null)', a=w.a, e=w.cece)
    ok('(setup) reopen_quiz made try 2', r['made'] is True and r['attempt']['try'] == 2 and r['attempt']['started'] is False, r)
    ok('reopen: before it is opened a save is sent (call quiz)', SV(w, w.q[1], False) == {'ok': False, 'error': 'sent'})
    ok('reopen: and a send is sent', SD(w) == {'ok': False, 'error': 'sent'})
    n = log_rows(d, 'quiz')
    r = Q(w)
    ok('reopen: the next open starts it, though the quiz is closed', r['try'] == {'number': 2, 'sent': False, 'started_at': r['try']['started_at'], 'sent_at': None, 'reopened': True}
       and r['try']['started_at'] and r['can_answer'] is True and r['quiz']['closed'] is True and r['answers'] == {} and r['sent_tries'] == 1, r)
    ok('reopen: opening it spent one write; its order is its own', log_rows(d, 'quiz') == n + 1
       and d.one('select question_order is not null from quiz_attempt where assessment_id = :a and enrollment_id = :e and try = 2', a=w.a, e=w.cece))
    ok('reopen: it can be answered and sent while closed', SV(w, w.q[1], False)['ok'] is True and SD(w)['try'] == 2)
    r = Q(w)
    ok('reopen: then nothing more: closed, no Try Again', r['can_try_again'] is False and r['can_answer'] is False and r['try']['number'] == 2, r)
    # An in-progress try, closed, reopened: it can be answered again.
    Q(w, e=w.dev, a=w.a2)
    d.run("update quiz set after_due = 'until', accept_until = '2020-01-01' where assessment_id = :a", a=w.a2)
    ok('(setup) Dev\'s open try is closed to him', SV(w, w.q2[1], True, e=w.dev, a=w.a2) == {'ok': False, 'error': 'quiz_closed'})
    T(d, 'reopen_quiz(:a, :e, null)', a=w.a2, e=w.dev)
    r = Q(w, e=w.dev, a=w.a2)
    ok('reopen: Dev\'s in-progress try, reopened, is answerable while closed', r['can_answer'] is True and r['try']['reopened'] is True and r['try']['number'] == 1, r)
    ok('reopen: and keeps its order', ids(r) == w.q2)
    ok('reopen: he saves and sends it', SV(w, w.q2[1], True, e=w.dev, a=w.a2)['ok'] is True and SD(w, e=w.dev, a=w.a2)['ok'] is True)
    # Reopen before any try: the first open is that try, and the quiz's own tries are still there.
    d.run("update quiz set after_due = 'keep', accept_until = null where assessment_id = :a", a=w.a2)
    T(d, 'reopen_quiz(:a, :e, null)', a=w.a2, e=w.eli)
    r = Q(w, e=w.eli, a=w.a2)
    ok("reopen: before any try, Eli's first open is the reopened try 1", r['try']['number'] == 1 and r['try']['reopened'] is True and r['quiz']['tries_left'] == 2, r)
    SD(w, e=w.eli, a=w.a2)
    ok('reopen: after it, his two ordinary tries are left', Q(w, e=w.eli, a=w.a2)['can_try_again'] is True and Q(w, e=w.eli, a=w.a2, new_try=True)['try']['number'] == 2)
    d.close()

def scen_refused():
    w = world('refused'); d = w.d
    Q(w, e=w.dev)
    calls = {'quiz': lambda e, t: Q(w, e=e, tok=t), 'quiz_save': lambda e, t: SV(w, w.q[1], True, e=e, tok=t), 'quiz_send': lambda e, t: SD(w, e=e, tok=t)}
    cases = (
        ('a student paused in the middle of a session', 'update enrollment set page_paused_at = now() where id = :e', 'update enrollment set page_paused_at = null where id = :e', 'closed'),
        ('a withdrawn student', 'update enrollment set withdrawn_at = now() where id = :e', 'update enrollment set withdrawn_at = null where id = :e', 'not_found'),
        ('a class with its Student Page off', 'update course set student_page_enabled = false where id = (select course_id from enrollment where id = :e)',
         'update course set student_page_enabled = true where id = (select course_id from enrollment where id = :e)', 'closed'),
        ('a class in the trash', 'update course set deleted_at = now() where id = (select course_id from enrollment where id = :e)',
         'update course set deleted_at = null where id = (select course_id from enrollment where id = :e)', 'not_found'),
        ('a stopped card', 'update student_card set stopped_at = now() where enrollment_id = :e', 'update student_card set stopped_at = null where enrollment_id = :e', 'card_stopped'),
        ('an expired card', 'update student_card set works_until = current_date - 3 where enrollment_id = :e',
         "update student_card set works_until = current_date + 300 where enrollment_id = :e", 'card_expired'),
        ('an expired session', "update student_submit.device_session set expires_at = now() - interval '1 minute' where id in (select session_id from student_submit.device_session_enrollment where enrollment_id = :e)",
         "update student_submit.device_session set expires_at = now() + interval '1 day' where id in (select session_id from student_submit.device_session_enrollment where enrollment_id = :e)", 'signed_out'),
    )
    for label, do, undo, want in cases:
        d.run(do, e=w.dev)
        before = sums(d); n = log_rows(d)
        for name, call in calls.items():
            r = call(w.dev, w.tok[w.dev])
            ok('refused: %s on %s is %s' % (label, name, want), r == {'ok': False, 'error': want}, r)
        ok('refused: %s: nothing written, not even the write limit' % label, sums(d) == before and log_rows(d) == n)
        d.run(undo, e=w.dev)
        ok('refused: (setup) %s put back: Dev opens again' % label, Q(w, e=w.dev).get('ok') is True)
    for label, e, t, want in (('an unknown session', w.dev, 'f' * 64, 'signed_out'), ('a token of the wrong shape', w.dev, 'x', 'signed_out'),
                              ("an enrolment not on this session (a classmate's)", w.eli, w.tok[w.dev], 'not_found'),
                              ('an enrolment that is not there', nid(), w.tok[w.dev], 'not_found'), ('a withdrawn student with a card', w.wes, w.tok[w.wes], 'not_found')):
        n = log_rows(d); before = sums(d)
        for name, call in calls.items():
            r = call(e, t)
            ok('refused: %s on %s is %s' % (label, name, want), r == {'ok': False, 'error': want}, r)
        ok('refused: %s: nothing written' % label, log_rows(d) == n and sums(d) == before)
    r = S(d, "student_submit.quiz(null, null, null, null)")
    ok('refused: all nulls is signed_out', r == {'ok': False, 'error': 'signed_out'}, r)
    # The piece.
    for label, a in (('a Draft', w.draft), ('a piece assigned next week', w.later), ('a piece with no quiz', w.plain), ('a DIBELS piece', w.dib),
                     ("another teacher's piece", w.ab), ("the student's other class's piece", w.soc), ('an id that is not there', nid())):
        n = log_rows(d); before = sums(d)
        for name, call in (('quiz', lambda: Q(w, a=a)), ('quiz_save', lambda: SV(w, w.q[1], True, a=a)), ('quiz_send', lambda: SD(w, a=a)),
                           ('quiz with new_try', lambda: Q(w, a=a, new_try=True))):
            r = call()
            ok('refused: %s on %s is not_found' % (label, name), r == {'ok': False, 'error': 'not_found'}, r)
        ok('refused: %s: nothing written' % label, log_rows(d) == n and sums(d) == before)
    ok("refused: the other class's piece opens through its own enrolment on the same device", Q(w, e=w.cece2, a=w.soc)['ok'] is True)
    d.run("update assessment set date_assigned = current_date where id = :a", a=w.later)
    ok('refused: a piece assigned today opens', Q(w, a=w.later)['ok'] is True)
    T(d, "update_assessment(:a, '{\"is_draft\": false}'::jsonb)", a=w.draft)
    ok('refused: a Draft once assigned opens', Q(w, a=w.draft)['ok'] is True)
    x = refusal(lambda: T(d, "update_assessment(:a, '{\"is_draft\": true}'::jsonb)", a=w.draft))
    ok('refused: and once a student has started it cannot go back to a Draft (MQ1\'s guard)', x == ('P0001', 'draft_has_work'), x)
    d.run('update student_card set locked_at = now() where enrollment_id = :e', e=w.dev)
    ok('refused: a locked card still works on an open session', Q(w, e=w.dev).get('ok') is True)
    d.close()

def scen_access():
    w = world('access'); d = w.d
    r = Q(w); SV(w, w.q[1], True); SV(w, w.q[3], 'Cece unfinished words')
    t = T(d, 'list_quiz_tries(:a)', a=w.a)
    me = [s for s in t['students'] if s['enrollment_id'] == w.cece][0]
    tid = d.one('select id::text from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=w.cece)
    blob = json.dumps(t)
    ok("access: the teacher's list_quiz_tries answers no unsent try", me == {'enrollment_id': w.cece, 'sent': 0, 'in_progress': True, 'reopened': False, 'tries': []}, me)
    ok("access: and no unsent answer, order, time or attempt id anywhere in it", 'Cece unfinished words' not in blob and tid not in blob
       and r['try']['started_at'] not in blob, blob[:300])
    ok("access: list_quiz says the question is answered (as kind_locked follows), and nothing else of it",
       [q['answered'] for q in T(d, 'list_quiz(:a)', a=w.a)['questions']][1] is True and 'Cece unfinished words' not in json.dumps(T(d, 'list_quiz(:a)', a=w.a)))
    ok("access: Dev's session naming Cece's enrolment is not_found", Q(w, e=w.cece, tok=w.tok[w.dev]) == {'ok': False, 'error': 'not_found'})
    ok("access: and cannot save into her try", SV(w, w.q[1], False, e=w.cece, tok=w.tok[w.dev]) == {'ok': False, 'error': 'not_found'}
       and answers_of(d, w.a, w.cece)[w.q[1]] is True)
    ok("access: nor send it", SD(w, e=w.cece, tok=w.tok[w.dev]) == {'ok': False, 'error': 'not_found'} and attempts(d, w.a, w.cece)[0][1] is False)
    rd = Q(w, e=w.dev)
    ok("access: Dev's own open is his own try, with none of her answers", rd['answers'] == {} and 'Cece unfinished words' not in json.dumps(rd)
       and d.one('select count(*) from quiz_attempt where assessment_id = :a', a=w.a) == 2)
    ok("access: Cece's other class on her device is not_found for this piece", Q(w, e=w.cece2) == {'ok': False, 'error': 'not_found'})
    ok("access: a student of another teacher is not_found", Q(w, e=w.bea) == {'ok': False, 'error': 'not_found'})
    # A second device: the same card signed in again.
    tok2 = sign_in(d, w.card[w.cece])
    ok('(setup) the second device has its own session', tok2 != w.tok[w.cece])
    r2 = Q(w, tok=tok2)
    ok('access: a second device carries on in the same try, the same order, the same answers', r2 == Q(w) and r2['try']['number'] == 1
       and ids(r2) == ids(r) and r2['answers'] == {w.q[1]: True, w.q[3]: 'Cece unfinished words'}, r2)
    SV(w, w.q[1], False, tok=tok2)
    ok('access: a save on the second device is what the first reads', Q(w)['answers'][w.q[1]] is False)
    ok('access: the first device sends it', SD(w)['ok'] is True)
    ok('access: the second device then reads it sent, and its save is sent', Q(w, tok=tok2)['try']['sent'] is True
       and SV(w, w.q[1], True, tok=tok2) == {'ok': False, 'error': 'sent'})
    t = T(d, 'list_quiz_tries(:a)', a=w.a)
    me = [s for s in t['students'] if s['enrollment_id'] == w.cece][0]
    ok('access: once sent the teacher reads it', me['sent'] == 1 and len(me['tries']) == 1 and {x['question_id']: x['answer'] for x in me['tries'][0]['answers']}
       == {w.q[1]: False, w.q[3]: 'Cece unfinished words'}, me)
    d.close()

def scen_leak():
    w = world('leak'); d = w.d
    replies = []
    def keep(label, r): replies.append((label, r)); return r
    def everyone(label):
        for e in (w.cece, w.dev, w.eli):
            keep(label + ' open', Q(w, e=e))
            keep(label + ' open again', Q(w, e=e, new_try=True))
            for q in w.q:
                keep(label + ' save', SV(w, q, True, e=e))
    everyone('not started')
    keep('part way', SV(w, w.q[1], True)); keep('part way', SV(w, w.q[2], 3.5)); keep('part way', SV(w, w.q[3], 'my words'))
    keep('part way', SV(w, w.q[0], [w.qs[0]['choices'][0]['id']]))
    keep('part way', Q(w)); everyone('part way')
    keep('sent', SD(w)); keep('sent', SD(w, e=w.dev)); everyone('sent')
    # Tries left on a two-try quiz, the teacher's marks, notes and confirm on a sent try: still nothing reaches a student.
    keep('two tries', Q(w, a=w.a2)); keep('two tries', SD(w, a=w.a2)); keep('tries left', Q(w, a=w.a2))
    tid = d.one('select id::text from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=w.cece)
    T(d, 'mark_quiz_answer(:t, :q, 2, :n, null)', t=tid, q=w.q[3], n=MARK_NOTE)
    marks = {'earned': 4.25, 'possible': 8, 'questions': {w.q[1]: {'earned': 1, 'result': 'right'}, w.q[3]: {'earned': 2, 'result': 'partly'}}}
    T(d, 'confirm_quiz(:a, cast(:m as jsonb), null)', a=w.a, m=json.dumps([{'attempt_id': tid, 'marked': marks}]))
    keep('confirmed', Q(w)); everyone('confirmed')
    T(d, 'reopen_quiz(:a, :e, null)', a=w.a, e=w.cece)
    keep('reopened', Q(w)); keep('reopened', SV(w, w.q[2], 3.5)); keep('reopened', SD(w)); keep('reopened', Q(w))
    ok('leak: (setup) %d replies, every one ok or a refusal' % len(replies), all(isinstance(r, dict) and 'ok' in r for _, r in replies))
    blob = json.dumps([r for _, r in replies])
    for label, needle in (("the key's why line", MARK_WHY), ("the number key", str(MARK_NUM)), ('the tolerance', str(MARK_TOL)),
                          ("the teacher's note", MARK_NOTE), ('the confirmed total', '4.25'), ('a result word', 'partly'),
                          ('the key word', '"key"'), ('a tolerance key', 'tolerance'), ('a why key', '"why"'), ('a competency key', 'tag_id'),
                          ('a position key', 'position'), ('marked', 'marked'), ('given points', 'given_points'), ('a note key', '"note"'),
                          ('archived', 'archived'), ('answered', '"answered"'), ('earned', 'earned'), ('possible', 'possible')):
        ok('leak: %s is in no reply' % label, needle not in blob, [l for l, r in replies if needle in json.dumps(r)][:3])
    for t in w.t:
        ok('leak: competency %s is in no reply' % t[:8], t not in blob)
    ok('leak: no reply names another student', w.dev not in json.dumps([r for l, r in replies if 'open' in l and r.get('ok')][:1]))
    ok("leak: no reply names Dev's or Eli's enrolment or attempt", all(x not in json.dumps([r for _, r in replies[:2]]) for x in (w.dev, w.eli)))
    ok('leak: the six never name quiz_key', all('quiz_key' not in d.one('select pg_get_functiondef(to_regprocedure(:s))', s=s) for s in OURS))
    ok('leak: no student_submit function names quiz_key', d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'student_submit' and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like '%quiz_key%'""") == 0)
    # The right choice is first in the teacher's list. Over 300 orders it lands in each of the three places.
    right = d.one('select answer->>0 from quiz_key where question_id = :q', q=w.q[0])
    places = [0, 0, 0]
    for _ in range(300):
        places[d.one('select student_submit._quiz_new_order(:a)', a=w.a)['choices'][w.q[0]].index(right)] += 1
    ok('leak: shuffled, the right choice sits in each place about as often (%s of 300)' % places, all(p >= 60 for p in places), places)
    ok("leak: the multiple-right question says only that several may be right", [q['multiple'] for q in Q(w, e=w.eli)['questions'] if q['id'] == w.q[4]] == [True])
    d.close()

def scen_limit():
    w = world('limit'); d = w.d
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    Q(w)
    d.run("insert into student_submit.write_log (card_id, kind) select :c, 'quiz' from generate_series(1, 597)", c=card)
    ok('(setup) 598 quiz writes this hour for the card', log_rows(d, 'quiz') == 598)
    ok('limit: the 599th (a save) is ok', SV(w, w.q[1], True)['ok'] is True)
    ok('limit: opening again starts nothing and spends nothing', Q(w)['ok'] is True and log_rows(d, 'quiz') == 599)
    ok('limit: the 600th (a save) is ok', SV(w, w.q[1], False)['ok'] is True)
    s0 = sums(d); n0 = log_rows(d)
    for label, call in (('a save', lambda: SV(w, w.q[1], True)), ('a send', lambda: SD(w)), ('a clear', lambda: SV(w, w.q[1], None))):
        r = call()
        ok('limit: the next, %s, is too_many with a wait' % label, r.get('ok') is False and r.get('error') == 'too_many' and 1 <= r.get('retry_after_s', 0) <= 3600
           and set(r) == {'ok', 'error', 'retry_after_s'}, r)
    SD(w, e=w.dev)
    ok('limit: the refusals wrote nothing', sums(d) == s0 and log_rows(d) == n0)
    ok("limit: a classmate's card is not counted", Q(w, e=w.dev)['ok'] is True and SV(w, w.q[1], True, e=w.dev)['ok'] is True)
    d.run("update student_submit.write_log set at = at - interval '61 minutes' where card_id = :c", c=card)
    ok('limit: an hour on, writes go again', SV(w, w.q[1], True)['ok'] is True and answers_of(d, w.a, w.cece)[w.q[1]] is True)
    d.run("insert into student_submit.write_log (card_id, kind) select :c, 'quiz' from generate_series(1, 599)", c=card)
    r = Q(w, a=w.au)
    ok('limit: an open that would start a try is too_many and starts nothing', r.get('error') == 'too_many' and attempts(d, w.au, w.cece) == [], r)
    ok("limit: bulletins' kind is counted apart", d.one("select student_submit._write_limit(:c, 'bulletin', 120)", c=card) is None)
    for k in ('reflect', 'seen', 'finish', 'answer', 'bulletin', 'quiz'):
        r = refusal(lambda: d.run('insert into student_submit.write_log (card_id, kind) values (:c, :k)', c=card, k=k))
        ok('limit: write_log takes kind %s' % k, r is None, r)
    r = refusal(lambda: d.run("insert into student_submit.write_log (card_id, kind) values (:c, 'other')", c=card))
    ok('limit: and refuses any other word', r and r[0] == '23514', r)
    d.close()

class Conn:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()

def together(d, gate_sql, calls):
    """Run calls (name, sql, kw) on connections of their own, held behind a lock until all wait, then let go."""
    out = {}
    def call(name, sql, kw):
        c = Conn(d); c.run('set role service_role') if sql.lstrip().startswith('select student_submit') else None
        try: out[name] = c.run(sql, **kw)[0][0]
        except Exception as e: out[name] = 'ERROR %s %s' % (sqlstate(e), message(e))
        c.close()
    gate = Conn(d); gate.run('begin'); gate.run(gate_sql)
    ts = [threading.Thread(target=call, args=c) for c in calls]
    [t.start() for t in ts]; time.sleep(0.6)
    held = d.one("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")
    gate.run('commit'); gate.close(); [t.join() for t in ts]
    return out, held

def scen_race():
    w = world('race'); d = w.d
    saveq = "select student_submit.quiz_save(:t, :e, :a, :q, cast(:v as jsonb), 'ip')"
    openq = "select student_submit.quiz(:t, :e, :a, 'ip', false)"
    sendq = "select student_submit.quiz_send(:t, :e, :a, 'ip')"
    base = dict(t=w.tok[w.cece], e=w.cece, a=w.a)
    # The gate: the quiz row held for update (as save_quiz holds it); every student call waits on its key share.
    gate = 'select 1 from public.quiz where assessment_id = \'%s\' for update' % w.a
    for rnd in range(3):
        d.run('delete from quiz_attempt where enrollment_id = :e and assessment_id = :a', e=w.cece, a=w.a)
        out, held = together(d, gate, [('one', openq, base), ('two', openq, base)])
        ok('race %d: two first opens waited together' % rnd, held == 2, held)
        ok('race %d: both answered the same one try' % rnd, all(isinstance(v, dict) and v.get('ok') for v in out.values())
           and out['one']['try'] == out['two']['try'] and attempts(d, w.a, w.cece) == [[1, False, False, True]], out)
        out, held = together(d, gate, [('a', saveq, dict(base, q=w.q[1], v='true')), ('b', saveq, dict(base, q=w.q[1], v='false'))])
        rows = d.all('select answer from quiz_answer where question_id = :q', q=w.q[1])
        ok('race %d: two saves of one answer waited together' % rnd, held == 2, held)
        ok('race %d: both ok, one row' % rnd, all(isinstance(v, dict) and v.get('ok') for v in out.values()) and len(rows) == 1, (out, rows))
        later = max(out.values(), key=lambda v: v['saved_at'])
        ok('race %d: the row is the save that came last' % rnd, rows[0][0] == (later is out['a']), (rows, out))
        out, held = together(d, gate, [('save', saveq, dict(base, q=w.q[2], v='2')), ('send', sendq, base)])
        ok('race %d: a save and a send waited together' % rnd, held == 2, held)
        ok('race %d: the send went; the save went before it or was told sent' % rnd, out['send'].get('ok') is True
           and (out['save'].get('ok') is True and answers_of(d, w.a, w.cece).get(w.q[2]) == 2 or out['save'] == {'ok': False, 'error': 'sent'}), out)
    # A student's save and the teacher removing that question, both orders: the answer is kept, the question archived.
    for rnd, first in enumerate(('student', 'teacher', 'student')):
        d.run('delete from quiz_attempt where enrollment_id = :e and assessment_id = :a2', e=w.dev, a2=w.a2)
        Q(w, e=w.dev, a=w.a2)
        full = as_sent(T(d, 'list_quiz(:a)', a=w.a2)); tsave(w, w.a2, full)
        less = as_sent(T(d, 'list_quiz(:a)', a=w.a2)); less['questions'] = [q for q in less['questions'] if q['id'] != w.q2[1]]
        less['updated_at'] = last_read(d, w.a2)
        hold = Conn(d); hold.run('begin')
        if first == 'student':
            hold.run('set role service_role')
            r1 = hold.run(saveq, t=w.tok[w.dev], e=w.dev, a=w.a2, q=w.q2[1], v='true')[0][0]
            hold.run('reset role')
            out = {}
            c2 = Conn(d); c2.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); c2.run('set role authenticated')
            def teach():
                try: out['t'] = c2.run('select save_quiz(:a, cast(:q as jsonb), null)', a=w.a2, q=json.dumps(less))[0][0]
                except Exception as e: out['t'] = 'ERROR ' + message(e)
            th = threading.Thread(target=teach); th.start(); time.sleep(0.5)
            waited = th.is_alive()
            hold.run('commit'); th.join(); c2.close()
            ok('race q%d: the teacher\'s save waited for the student\'s' % rnd, waited and r1.get('ok') is True)
            ok('race q%d: then archived the question, its answer kept' % rnd, isinstance(out['t'], dict)
               and d.one('select archived_at is not null from quiz_question where id = :q', q=w.q2[1]) and answers_of(d, w.a2, w.dev).get(w.q2[1]) is True, out)
        else:
            hold.run("select set_config('request.jwt.claim.sub', :u, false)", u=A); hold.run('set role authenticated')
            hold.run('select save_quiz(:a, cast(:q as jsonb), null)', a=w.a2, q=json.dumps(less)); hold.run('reset role')
            out = {}
            def stud():
                c = Conn(d); c.run('set role service_role')
                out['s'] = c.run(saveq, t=w.tok[w.dev], e=w.dev, a=w.a2, q=w.q2[1], v='true')[0][0]; c.close()
            th = threading.Thread(target=stud); th.start(); time.sleep(0.5)
            waited = th.is_alive()
            hold.run('commit'); hold.close(); th.join()
            ok("race q%d: the student's save waited for the teacher's" % rnd, waited, out)
            ok('race q%d: then found the question gone: not_found, nothing written' % rnd, out.get('s') == {'ok': False, 'error': 'not_found'}
               and w.q2[1] not in answers_of(d, w.a2, w.dev), out)
        if first == 'student': hold.close()
        p = as_sent(T(d, 'list_quiz(:a)', a=w.a2))
        if w.q2[1] not in [q['id'] for q in p['questions']]:
            arch = [q for q in T(d, 'list_quiz(:a)', a=w.a2)['archived'] if q['id'] == w.q2[1]]
            if arch:
                q = arch[0]; p['questions'].insert(1, {'id': q['id'], 'kind': q['kind'], 'prompt': q['prompt'], 'multiple': q['multiple'],
                                                       'points': q['points'], 'tag_id': q['tag_id'], 'key': q['key']})
            else:
                p['questions'].insert(1, tf())
        w.q2[1] = [q['id'] for q in tsave(w, w.a2, p)['questions']][1]
    # A first open racing an Unassign, both orders: the open holds the piece for share, so the Unassign waits and is
    # refused (a try exists); an Unassign first makes the open wait and then find a Draft.
    for rnd, first in enumerate(('student', 'teacher')):
        a = str(T(d, "create_assessment(:c, :t, p_tag_ids => cast(:g as uuid[]))", c=w.c, t='Race %d' % rnd, g=w.t[:1]))
        tsave(w, a, payload([tf()]))
        out = {}
        hold = Conn(d); hold.run('begin')
        unassign = "select update_assessment('%s', '{\"is_draft\": true}'::jsonb)" % a
        claim = "select set_config('request.jwt.claim.sub', '%s', false)" % A
        if first == 'student':
            hold.run('set role service_role'); r1 = hold.run(openq, t=w.tok[w.cece], e=w.cece, a=a)[0][0]
            def other():
                c = Conn(d); c.run(claim); c.run('set role authenticated')
                try: out['o'] = c.run(unassign)[0][0]
                except Exception as e: out['o'] = 'ERROR %s %s' % (sqlstate(e), message(e))
                c.close()
        else:
            hold.run(claim); hold.run('set role authenticated'); r1 = hold.run(unassign)[0][0]
            def other():
                c = Conn(d); c.run('set role service_role'); out['o'] = c.run(openq, t=w.tok[w.cece], e=w.cece, a=a)[0][0]; c.close()
        th = threading.Thread(target=other); th.start(); time.sleep(0.5)
        waited = th.is_alive()
        hold.run('commit'); hold.close(); th.join()
        ok('race u%d: the second (%s first) waited for the first' % (rnd, first), waited, out)
        if first == 'student':
            ok('race u%d: the open made try 1; the Unassign after it is refused draft_has_work' % rnd, r1.get('ok') is True
               and str(out['o']).startswith('ERROR P0001 draft_has_work') and not d.one('select is_draft from assessment where id = :a', a=a), (r1, out))
        else:
            ok('race u%d: the Unassign went; the open after it found a Draft: not_found, no try' % rnd,
               out['o'] == {'ok': False, 'error': 'not_found'} and attempts(d, a, w.cece) == [], out)
    # Reopen racing an open: one try made, never two, never an error.
    for rnd in range(3):
        d.run('delete from quiz_attempt where enrollment_id = :e and assessment_id = :a', e=w.eli, a=w.a)
        Q(w, e=w.eli); SD(w, e=w.eli)
        c = Conn(d); c.run("select set_config('request.jwt.claim.sub', :u, false)", u=A)
        out, held = together(d, gate, [('open', openq, dict(t=w.tok[w.eli], e=w.eli, a=w.a)),
                                      ('reopen', "select set_config('request.jwt.claim.sub', '%s', false), reopen_quiz('%s', '%s', null)" % (A, w.a, w.eli), {})])
        c.close()
        ok('race r%d: an open and a Reopen at once: no error' % rnd, all(not str(v).startswith('ERROR') for v in out.values()), out)
        ok('race r%d: try 2 made once' % rnd, [x[0] for x in attempts(d, w.a, w.eli)] == [1, 2], attempts(d, w.a, w.eli))
    d.close()

def norm_ids(x, names):
    """A reply with every id the world made replaced by its name there, any other id by UUID, and times and tokens
    by a word (two worlds have different ids); then with its keys, and its lists of words, sorted."""
    s = json.dumps(x)
    s = re.sub(r'\d{4}-\d{2}-\d{2}T[0-9:.]+[+-]\d{2}:\d{2}', 'TIME', s)
    s = UUID_RE.sub(lambda m: names.get(m.group(0), 'UUID'), s)
    s = re.sub(r'"[0-9a-f]{64}"', '"TOKEN"', s)
    # A list of ids (tag_ids) comes in id order, which differs between the two worlds: sorted by name here.
    def tidy(v):
        if isinstance(v, list): return sorted(v) if v and all(isinstance(i, str) for i in v) else [tidy(i) for i in v]
        if isinstance(v, dict): return {k: tidy(i) for k, i in v.items()}
        return v
    return json.dumps(tidy(json.loads(s)), sort_keys=True)
def world_names(w):
    out = {}
    for k, v in vars(w).items():
        for i, x in enumerate(v if isinstance(v, list) else [v]):
            if isinstance(x, str) and UUID_RE.fullmatch(x): out[x] = '%s%d' % (k, i)
    return out

def scen_released():
    """The released app's writes answer the same and leave the same rows with and without the file."""
    got = {}
    for tag, with_file in (('without', False), ('with', True)):
        w = world('released_' + tag, with_file=with_file); d = w.d
        names = world_names(w); out = []
        def say(label, fn):
            try: r = fn()
            except Exception as e: r = 'ERROR %s %s' % (sqlstate(e), message(e))
            out.append((label, norm_ids(r, names)))
        b = str(d.one("insert into public.bulletin (course_id, kind, body, created_at, posted_at, reactions_on) values (:c, 'announcement', 'Hi', now(), now(), true) returning id", c=w.c))
        say('page', lambda: d.page(w.tok[w.cece], w.cece))
        say('seen', lambda: S(d, "student_submit.seen(:t, :e, cast(:i as uuid[]), 'ip')", t=w.tok[w.cece], e=w.cece, i=[w.a, w.a2]))
        say('answer_seen', lambda: S(d, "student_submit.answer_seen(:t, :e, cast(:i as uuid[]), 'ip')", t=w.tok[w.cece], e=w.cece, i=[w.a]))
        say('bulletin_seen', lambda: S(d, "student_submit.bulletin_seen(:t, :e, cast(:i as uuid[]), 'ip')", t=w.tok[w.cece], e=w.cece, i=[b]))
        say('bulletin_react', lambda: S(d, "student_submit.bulletin_react(:t, :e, :b, 'done', 'ip')", t=w.tok[w.cece], e=w.cece, b=b))
        say('list_quiz', lambda: T(d, 'list_quiz(:a)', a=w.a2))
        say('save_quiz', lambda: settings(w, w.a2, tries=0))
        say('reopen_quiz', lambda: T(d, 'reopen_quiz(:a, :e, null)', a=w.a2, e=w.dev))
        say('reopen_quiz again', lambda: T(d, 'reopen_quiz(:a, :e, null)', a=w.a2, e=w.dev))
        # A sent try, made as the owner the same way in both (the released app cannot make one).
        tid = str(d.one("""insert into quiz_attempt (assessment_id, enrollment_id, try, question_order, started_at, sent_at)
                            values (:a, :e, 1, '{"questions": [], "choices": {}}', now(), now()) returning id""", a=w.a2, e=w.eli))
        d.run("insert into quiz_answer (attempt_id, question_id, assessment_id, answer) values (:t, :q, :a, '\"words\"')", t=tid, q=w.q2[2], a=w.a2)
        say('list_quiz_tries', lambda: T(d, 'list_quiz_tries(:a)', a=w.a2))
        say('mark_quiz_answer', lambda: T(d, "mark_quiz_answer(:t, :q, 2, 'Good', null)", t=tid, q=w.q2[2]))
        say('confirm_quiz', lambda: T(d, 'confirm_quiz(:a, cast(:m as jsonb), null)', a=w.a2,
                                      m=json.dumps([{'attempt_id': tid, 'marked': {'earned': 2, 'possible': 5, 'questions': {}}}])))
        say('unassign', lambda: T(d, "update_assessment(:a, '{\"is_draft\": true}'::jsonb)", a=w.a2))
        say('unassign without tries', lambda: T(d, "update_assessment(:a, '{\"is_draft\": true}'::jsonb)", a=w.au))
        say('delete_assessment', lambda: T(d, 'delete_assessment(:a)', a=w.a2))
        say('page again', lambda: d.page(w.tok[w.cece], w.cece))
        say('done', lambda: S(d, "student_submit.done(:t, 'ip')", t=w.tok[w.dev]))
        counts = {k: v[0] for k, v in sums(d).items()}
        got[tag] = (out, counts, d.all('select kind, count(*) from student_submit.write_log group by kind order by kind collate "C"'))
        d.close()
    a, b = got['without'], got['with']
    ok('released: (setup) %d writes, none an error but the Unassign refused by MQ1' % len(a[0]), sum('ERROR' in x for _, x in a[0]) == 1, [x for x in a[0] if 'ERROR' in x[1]])
    for (la, ra), (lb, rb) in zip(a[0], b[0]):
        at = next((i for i, (x, y) in enumerate(zip(ra, rb)) if x != y), min(len(ra), len(rb)))
        ok('released: %s answers the same with the file' % la, ra == rb, (ra[max(0, at - 80):at + 120], rb[max(0, at - 80):at + 120]))
    ok('released: every table holds as many rows with the file as without', a[1] == b[1], {k: (a[1].get(k), b[1].get(k)) for k in set(a[1]) | set(b[1]) if a[1].get(k) != b[1].get(k)})
    ok('released: the write limit counted the same', a[2] == b[2], (a[2], b[2]))

def scen_others():
    w = world('others'); d = w.d
    for role in ('anon', 'authenticated'):
        uid = A if role == 'authenticated' else None
        for sig, call, kw in ((QUIZ, "select student_submit.quiz(:t, :e, :a, 'ip', false)", dict(t=w.tok[w.cece], e=w.cece, a=w.a)),
                              (SAVE, "select student_submit.quiz_save(:t, :e, :a, :a, null, 'ip')", dict(t=w.tok[w.cece], e=w.cece, a=w.a)),
                              (SEND, "select student_submit.quiz_send(:t, :e, :a, 'ip')", dict(t=w.tok[w.cece], e=w.cece, a=w.a)),
                              (WINDOW, 'select student_submit._quiz_window(:a, :c)', dict(a=w.a, c=w.c)),
                              (NEWORDER, 'select student_submit._quiz_new_order(:a)', dict(a=w.a)),
                              (QUESTIONS, "select student_submit._quiz_questions(:a, '{}')", dict(a=w.a))):
            r = refusal(lambda: d.role(role, call, uid=uid, **kw))
            ok('others: %s may not run %s' % (role, sig.split('(')[0]), r and r[0] == '42501', r)
    owner = d.one("select proowner::regrole::text from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')")
    for sig in OURS:
        ok('others: public (everyone) has no grant on %s' % sig.split('(')[0],
           d.one("select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = to_regprocedure(:s) and x.grantee = 0", s=sig) == 0)
        ok('others: %s runs as its owner with the path pinned' % sig.split('(')[0],
           d.one("select prosecdef and proconfig = array['search_path=public, student_submit, pg_temp'] from pg_proc where oid = to_regprocedure(:s)", s=sig) is True)
        ok('others: %s is owned by the owner of _session_class' % sig.split('(')[0], d.one('select proowner::regrole::text from pg_proc where oid = to_regprocedure(:s)', s=sig) == owner)
    for sig in ROUTES:
        ok('others: %s is granted to service_role and its owner alone' % sig.split('(')[0],
           d.one('select proacl::text from pg_proc where oid = to_regprocedure(:s)', s=sig) == '{%s=X/%s,service_role=X/%s}' % (owner, owner, owner))
    for sig, call, kw in ((WINDOW, 'select student_submit._quiz_window(:a, :c)', dict(a=w.a, c=w.c)), (NEWORDER, 'select student_submit._quiz_new_order(:a)', dict(a=w.a)),
                          (QUESTIONS, "select student_submit._quiz_questions(:a, '{}')", dict(a=w.a))):
        r = refusal(lambda: d.role('service_role', call, **kw))
        ok('others: service_role may not call %s directly' % sig.split('(')[0], r and r[0] == '42501', r)
        ok('others: %s is granted to its owner alone' % sig.split('(')[0], d.one('select proacl::text from pg_proc where oid = to_regprocedure(:s)', s=sig) == '{%s=X/%s}' % (owner, owner))
    for role in ('anon', 'authenticated', 'service_role'):
        for t in TABLES + ['student_submit.write_log']:
            ok('others: %s cannot read or write %s' % (role, t), d.one("select has_table_privilege(:r, :t, 'select,insert,update,delete')", r=role, t=t) is False)
    d.close()

def scen_defaults():
    w = world('defaults', with_file=False); d = w.d
    d.run('alter default privileges in schema student_submit grant all on functions to anon, authenticated, service_role')
    d.run('alter default privileges in schema public grant all on functions to anon, authenticated, service_role')
    r = d.file(FILE); ok('defaults: the file applies', r == 'ok', r)
    r = d.file(POST)
    ok('defaults: the post-check says ok on every row', r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    x = refusal(lambda: d.role('anon', "select student_submit.quiz(:t, :e, :a, 'ip', false)", t=w.tok[w.cece], e=w.cece, a=w.a))
    ok('defaults: a visitor still may not run quiz', x and x[0] == '42501', x)
    x = refusal(lambda: d.role('service_role', 'select student_submit._quiz_new_order(:a)', a=w.a))
    ok('defaults: the edge function still may not call a helper', x and x[0] == '42501', x)
    d.close()

def norm(lines):
    def acl(m): return '{' + ','.join(sorted(m.group(1).split(','))) + '}'
    return [re.sub(r'\{([^{}]*=[^{}]*)\}', acl, l) for l in lines]
def same(a, b): return norm(a) == norm(b)
EXPECTED = re.compile(r'_quiz_window|_quiz_new_order|_quiz_questions|student_submit\.quiz\(|student_submit\.quiz_save|student_submit\.quiz_send|write_log_kind_check|^depends |pg_depend|^comments on ')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog(d.c)
    new, relied = header_md5s()
    ok('apply: the header names its six new functions and the ten it relies on', sorted(new) == sorted(OURS) and sorted(relied) == sorted(RELIED), (new, relied))
    ok("apply: the relied-on functions are the header's on this database", all(md5(d, s) == relied[s] for s in RELIED), {s: md5(d, s) for s in RELIED})
    ok('apply: the header names the check before and after', OLD_CHECK in HEADER and NEW_CHECK in HEADER)
    ok("apply: write_log has today's check", kind_check(d) == [[OLD_CHECK, True]], kind_check(d))
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
        name = sig.split('(')[0]
        d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % sig)
        guard('a changed %s' % name, "do $$ begin execute regexp_replace((select def from kept), '\\$function\\$', '$function$ ', ''); end $$",
              "do $$ begin execute (select def from kept); end $$", 'is not the definition this file was written against')
        d.run('drop table kept')
        ok('apply: %s is back as it was' % name, md5(d, sig) == relied[sig])
    guard("a write_log check that is not today's (Bulletins' M2 not applied)",
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text]))",
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check " + OLD_ADD,
          "write_log's check is not the one")
    guard('a second check on write_log', "alter table student_submit.write_log add constraint write_log_extra check (kind <> 'x')",
          'alter table student_submit.write_log drop constraint write_log_extra', "write_log's check is not the one")
    guard('the check not validated',
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check " + OLD_ADD + " not valid",
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check " + OLD_ADD,
          "write_log's check is not the one")
    guard('the check under another name', 'alter table student_submit.write_log rename constraint write_log_kind_check to write_log_kind',
          'alter table student_submit.write_log rename constraint write_log_kind to write_log_kind_check', 'no validated check named write_log_kind_check')
    guard('an MQ1 column missing', 'alter table public.quiz_attempt rename column reopened_at to reopened',
          'alter table public.quiz_attempt rename column reopened to reopened_at', "is not 2026111804's")
    guard("quiz_answer's key not (attempt_id, question_id)", 'alter table public.quiz_answer drop constraint quiz_answer_pkey, add primary key (attempt_id, question_id, assessment_id)',
          'alter table public.quiz_answer drop constraint quiz_answer_pkey, add constraint quiz_answer_pkey primary key (attempt_id, question_id)', 'lacks its key')
    guard('the one-open-try index missing', 'alter index public.quiz_attempt_one_open_idx rename to quiz_attempt_open_idx',
          'alter index public.quiz_attempt_open_idx rename to quiz_attempt_one_open_idx', 'one-open-try index')
    guard('a quiz function with other arguments', 'create function student_submit.quiz(text) returns int language sql as $$ select 1 $$',
          'drop function student_submit.quiz(text)', 'other arguments or in another schema')
    guard('a quiz_save in public', 'create function public.quiz_save(uuid) returns int language sql as $$ select 1 $$',
          'drop function public.quiz_save(uuid)', 'other arguments or in another schema')
    guard("a quiz_send that is not this file's", "create function student_submit.quiz_send(text, uuid, uuid, text) returns jsonb language sql as $$ select null::jsonb $$",
          'drop function student_submit.quiz_send(text, uuid, uuid, text)', 'is not the definition this file was written against')
    d.run('set role service_role'); r = d.file(FILE); d.run('reset role')
    ok('apply guard: a run as a role that does not own write_log stops the file', r.startswith('STOPPED') and 'Run this as the owner' in r, r)
    d.run('set role service_role'); r = d.file(PRE); rows_ = d.rows; d.run('reset role')
    ok('apply guard: and the pre-check, run as that role, names it', r == 'ok' and any(x[0].startswith('the role running this') for x in rows_), (r, rows_))
    ok('apply: after the guards the catalog is the one before', catalog(d.c) == base, differences(base, catalog(d.c)))
    # A relied-on function missing altogether.
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('student_submit._work_window(uuid)')) as def")
    d.run('drop function student_submit._work_window(uuid)')
    before = catalog(d.c); r = d.file(FILE)
    ok('apply guard: a missing _work_window stops the file', r.startswith('STOPPED') and 'none: the function is missing' in r, r)
    ok('apply guard: and leaves the catalog as it was', catalog(d.c) == before)
    ok('apply guard: the pre-check names it absent', d.statements(pre) == 'ok' and ['fingerprint student_submit._work_window(uuid)', 'absent'] in d.rows, d.rows)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    d.run('revoke all on function student_submit._work_window(uuid) from public, anon, authenticated, service_role')
    ok('(setup) _work_window is back with its grants', same(catalog(d.c), base), differences(norm(base), norm(catalog(d.c))))
    # Lock timeout.
    hold = Conn(d); hold.run('begin'); hold.run('lock table student_submit.write_log in access exclusive mode')
    t0 = time.time(); r = d.file(FILE); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('apply: a held lock makes the file give up after about five seconds', r.startswith('STOPPED') and 'lock timeout' in r and 4 < took < 12, (r, took))
    ok('apply: and nothing was applied', same(catalog(d.c), base))
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    for k in ('reflect', 'seen', 'finish', 'answer', 'bulletin'):
        d.run('insert into student_submit.write_log (card_id, kind) values (:c, :k)', c=card, k=k)
    rows0 = sums(d)
    r = d.file(FILE); ok('apply: the file applies over rows of every kind there was', r == 'ok', r)
    after = catalog(d.c); gone, came = differences(norm(base), norm(after))
    ok('apply: the catalog changes only in what the header names', all(EXPECTED.search(l) for l in gone + came), [l for l in gone + came if not EXPECTED.search(l)][:6])
    ok("apply: the only thing that existed and changed is write_log's check (and counts)",
       all(re.search(r'write_log_kind_check|^depends |pg_depend|^comments on ', l) for l in gone), gone)
    ok("apply: the check is the header's, validated", kind_check(d) == [[NEW_CHECK, True]], kind_check(d))
    ok('apply: no row changed', sums(d) == rows0)
    ok("apply: the new functions are the header's", all(md5(d, s) == new[s] for s in OURS), {s: md5(d, s) for s in OURS})
    r = d.file(POST)
    ok('apply: the post-check says ok on every row', r == 'ok' and len(d.rows) == 27 and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or (r, len(d.rows)))
    ok('apply: the pre-check now names the six as there, and the check as changed', d.statements(pre) == 'ok' and len(d.rows) == 7, d.rows)
    Q(w); SV(w, w.q[1], True); rows_now = sums(d)
    r = d.file(FILE); ok('apply: a second run is ok', r == 'ok', r)
    ok('apply: a second run changes nothing', catalog(d.c) == after and sums(d) == rows_now, differences(after, catalog(d.c)))
    raw = open(os.path.join(HERE, FILE), 'rb').read()
    ok('apply: the file is under 40 KB (%d bytes)' % len(raw), len(raw) < 40960, len(raw))
    for f in (FILE, UNDO, POST):
        b = open(os.path.join(HERE, f), 'rb').read()
        ok('apply: %s is plain ASCII with no backslash at all' % f, all(c == 10 or 32 <= c <= 126 for c in b) and b'\\' not in b)
    b = open(os.path.join(HERE, PRE), 'rb').read()
    ok("apply: the pre-check's only backslashes are the route row's two test strings",
       all(c == 10 or 32 <= c <= 126 for c in b) and b.count(b'\\') == 6 and b.count(b"'\\x41'") == 2 and b.count(b"'a\\\\b'") == 2)
    ok('apply: the header names its tests, undo and checks', 'quizzes_student.py' in HEADER and 'quizzes-student-undo.sql' in HEADER
       and 'quizzes-student-live-precheck.sql' in HEADER and 'quizzes-student-live-postcheck.sql' in HEADER)
    d.close()

def mutant(extra=None, replace=None):
    t = text_of(FILE)
    if replace:
        assert replace[0] in t, replace[0]; t = t.replace(replace[0], replace[1], 1)
    if extra:
        i = t.index('-- == 7. The last check'); t = t[:i] + extra + '\n' + t[i:]
    return t

def scen_lastcheck():
    w = world('lastcheck', with_file=False); d = w.d
    base = catalog(d.c)
    cases = (
        ('a function body', None, ("'quiz_closed' end);", "'quiz_closed' end) ;"),
         ['function student_submit.quiz(text,uuid,uuid,text,boolean) has md5']),
        ('a grant to anon', 'grant execute on function student_submit.quiz_send(text, uuid, uuid, text) to anon;', None,
         ['grant: function student_submit.quiz_send(text,uuid,uuid,text) may be run by anon, service_role, not service_role']),
        ('a helper granted to service_role', 'grant execute on function student_submit._quiz_window(uuid, uuid) to service_role;', None,
         ['grant: function student_submit._quiz_window(uuid,uuid) may be run by service_role, not its owner only']),
        ('the check', "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind in ('quiz', 'reflect'));", None,
         ['check: write_log_kind_check is not the six kinds']),
        ('a grant and the check at once', "grant execute on function student_submit._quiz_new_order(uuid) to public; alter table student_submit.write_log add constraint wl_x check (kind <> 'x');", None,
         ['grant: function student_submit._quiz_new_order(uuid) may be run by PUBLIC, not its owner only', 'check: write_log_kind_check']),
    )
    for label, extra, rep, want in cases:
        r = d.statements(split(mutant(extra, rep)))
        ok('lastcheck: %s changed: the file stops' % label, r.startswith('STOPPED') and 'Not as tested (%d found)' % len(want) in r, r)
        ok('lastcheck: %s: the message names exactly that part' % label, all(x in r for x in want), r)
        ok('lastcheck: %s: nothing is left behind' % label, catalog(d.c) == base, differences(base, catalog(d.c)))
    # Default privileges that would grant a new function to a teacher (not live's in student_submit, but a change to
    # them must not slip through): the file's revoke takes it away; without that revoke the last check names it.
    d.run('alter default privileges in schema student_submit grant execute on functions to authenticated')
    r = d.statements(split(mutant(None, ('    student_submit.quiz_send(text, uuid, uuid, text) from public, anon, authenticated;',
                                         '    student_submit.quiz_send(text, uuid, uuid, text) from public, anon;'))))
    ok('lastcheck: with a default grant to authenticated and no revoke of it, the last check names quiz_send\'s grant',
       r.startswith('STOPPED') and 'grant: function student_submit.quiz_send(text,uuid,uuid,text) may be run by authenticated, service_role' in r, r)
    r = d.file(FILE)
    ok('lastcheck: with that default grant the file as written applies, its revoke taking it away', r == 'ok', r)
    d.close()

def scen_undo():
    w = world('undo', with_file=False); d = w.d
    base = catalog(d.c); s0 = sums(d)
    r = d.file(UNDO); ok('undo: on a database without the file it is ok', r == 'ok', r)
    ok('undo: and changes nothing', catalog(d.c) == base and sums(d) == s0, differences(base, catalog(d.c)))
    r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
    withfile = catalog(d.c)
    Q(w); SV(w, w.q[1], True); SD(w); Q(w, e=w.dev); SV(w, w.q[3], 'Dev words', e=w.dev)
    kept = quiz_rows(d)
    owner = d.one("select proowner::regrole::text from pg_proc where oid = to_regprocedure(:s)", s=QUIZ)
    ok("undo: (setup) this connection is the functions' owner", d.one('select current_user::text') == owner, owner)
    call = "select student_submit.quiz(:t, :e, :a, 'ip', false)"
    with tx(d):
        d.run('revoke execute on function %s from service_role' % ', '.join(ROUTES))
        ok('undo: a revoke would stop nothing: the owner still runs quiz', d.one(call, t=w.tok[w.cece], e=w.cece, a=w.a)['ok'] is True)
    r = d.statements(split(part1())); ok('undo PART 1: runs', r == 'ok', r)
    for sig, c in ((QUIZ, call), (SAVE, "select student_submit.quiz_save(:t, :e, :a, :a, null, 'ip')"), (SEND, "select student_submit.quiz_send(:t, :e, :a, 'ip')")):
        x = refusal(lambda: d.one(c, t=w.tok[w.cece], e=w.cece, a=w.a))
        ok('undo PART 1: the owner (the edge function) can no longer run %s: it is gone' % sig.split('(')[0], x and x[0] == '42883', x)
    ok('undo PART 1: every try and answer is kept', quiz_rows(d) == kept)
    ok("undo PART 1: the three helpers and write_log's check are kept", all(md5(d, s) for s in HELPERS) and kind_check(d) == [[NEW_CHECK, True]])
    gone, came = differences(withfile, catalog(d.c))
    three = re.compile(r'student_submit\.quiz\(|student_submit\.quiz_save\(|student_submit\.quiz_send\(|^depends |pg_depend|^comments on ')
    ok('undo PART 1: only the three went', gone and all(three.search(l) for l in gone) and all(re.search(r'^depends |pg_depend|^comments on ', l) for l in came), (gone[:4], came))
    r = d.statements(split(part1())); ok('undo PART 1: a second run is ok', r == 'ok', r)
    r = d.file(FILE); ok('undo: the file again gives them back', r == 'ok' and same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    ok('undo: and Dev carries on where he was', Q(w, e=w.dev)['answers'] == {w.q[3]: 'Dev words'})
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % SEND)
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.statements(split(part1()))
    ok('undo PART 1: a function changed since stops it, dropping nothing', r.startswith('STOPPED') and 'is not the definition 2026111806 left' in r and applied(d), r)
    r = d.file(UNDO)
    ok('undo: and stops the removal', r.startswith('STOPPED') and 'is not the definition 2026111806 left' in r, r)
    ok('undo: the functions and the check are still there', applied(d) and kind_check(d) == [[NEW_CHECK, True]])
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    ok("undo: (setup) back to the file's state", same(catalog(d.c), withfile))
    # Sent whole, PART 2 refusing: PART 1 stays.
    d.run("alter table student_submit.write_log add constraint wl_extra check (kind <> 'x')")
    r = d.file(UNDO)
    ok('undo: sent whole with PART 2 refusing (a second check), it stops', r.startswith('STOPPED') and 'neither 2026111806' in r, r)
    ok('undo: and PART 1 has stayed: the three are gone, the helpers kept', not applied(d) and all(md5(d, s) for s in HELPERS))
    d.run('alter table student_submit.write_log drop constraint wl_extra')
    r = d.file(FILE); ok('undo: (setup) the file again', r == 'ok', r)
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    for k in ('reflect', 'seen', 'finish', 'answer', 'bulletin'):
        d.run('insert into student_submit.write_log (card_id, kind) values (:c, :k)', c=card, k=k)
    others = d.all("select id, kind from student_submit.write_log where kind <> 'quiz' order by id")
    ok('undo: (setup) there are quiz rows in write_log', log_rows(d, 'quiz') > 0)
    r = d.file(UNDO); ok('undo: the full undo runs', r == 'ok', r)
    ok("undo: write_log's check is back exactly, validated", kind_check(d) == [[OLD_CHECK, True]], kind_check(d))
    ok('undo: the catalog is as before the file', catalog(d.c) == base, differences(base, catalog(d.c)))
    ok('undo: the quiz rows of write_log are gone, every other kind kept', log_rows(d, 'quiz') == 0
       and d.all('select id, kind from student_submit.write_log order by id') == others)
    ok("undo: every try and answer is kept (MQ1's tables are MQ1's undo's)", quiz_rows(d) == kept)
    r = d.file(UNDO); ok('undo: a second run is ok and changes nothing', r == 'ok' and catalog(d.c) == base, r)
    r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    ok('undo: and the quiz answers', Q(w)['ok'] is True)
    d.close()

def scen_undolock():
    """The full undo takes write_log before it deletes, so a student's write that arrives between waits."""
    w = world('undolock'); d = w.d
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    d.run("""create function public.q3a_test_pause() returns trigger language plpgsql as $$
             begin if current_setting('q3a.pause', true) = 'on' then perform pg_sleep(1.5); end if; return null; end $$""")
    d.run('create trigger q3a_test_pause after delete on student_submit.write_log for each statement execute function public.q3a_test_pause()')
    def old_rows():
        d.run('delete from student_submit.write_log')
        d.run("insert into student_submit.write_log (card_id, kind, at) select :c, 'quiz', now() - interval '2 days' from generate_series(1, 5)", c=card)
    def race(undo_sql):
        out = {}
        def undo():
            d.run("select set_config('q3a.pause', 'on', false)")
            out['undo'] = d.statements(split(undo_sql))
            d.run("select set_config('q3a.pause', '', false)")
        t = threading.Thread(target=undo); t.start(); time.sleep(0.5)
        s = Conn(d); t0 = time.time()
        try: out['student'] = s.run("select student_submit._write_limit(:c, 'seen', 60)", c=card)[0][0] or 'ok'
        except Exception as e: out['student'] = 'ERROR %s %s' % (sqlstate(e), message(e))
        out['waited'] = time.time() - t0
        s.close(); t.join()
        return out
    old_rows()
    bad = race("""do $x$ begin
        delete from student_submit.write_log where kind = 'quiz';
        alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check %s;
        end $x$""" % OLD_ADD)
    ok('undolock: (the old order) deleting first and locking after deadlocks with a student write',
       '40P01' in str(bad.get('student')) or 'deadlock' in str(bad.get('undo')), bad)
    if kind_check(d) != [[NEW_CHECK, True]]:
        d.run("alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text, 'quiz'::text]))")
    old_rows()
    good = race(part2())
    ok('undolock: the full undo runs', good.get('undo') == 'ok', good)
    ok("undolock: the student's write arriving between waited and went through, no deadlock", good.get('student') == 'ok' and good.get('waited') > 0.5, good)
    ok('undolock: the check is back as before', kind_check(d) == [[OLD_CHECK, True]], kind_check(d))
    ok("undolock: the student's write is counted; the quiz rows are gone", d.all('select kind from student_submit.write_log order by id') == [['seen']])
    d.run('drop trigger q3a_test_pause on student_submit.write_log'); d.run('drop function public.q3a_test_pause()')
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
        r = d.file(FILE); ok('collations %s: the file applies' % tag, r == 'ok', r)
        r = d.file(FILE); ok('collations %s: a second run is ok' % tag, r == 'ok', r)
        r = d.file(POST); post = d.rows
        ok('collations %s: the post-check says ok on every row' % tag, r == 'ok' and post and all(x[1] == 'ok' for x in post), [x for x in post if x[1] != 'ok'] or r)
        fp = {s: md5(d, s) for s in OURS + RELIED}; fp['check'] = kind_check(d)
        # Choice ids that sort one way by byte and another by ICU: capitals' and digits' places differ.
        mid = ['00000000-0000-4000-8000-00000000000%s' % c for c in 'abcdef']
        q = {'kind': 'choice', 'prompt': 'Sort', 'multiple': True, 'points': 1, 'tag_id': None,
             'choices': [{'id': i, 'text': t} for i, t in zip(mid, ('_x', '-x', 'B', 'a', 'Z', '1'))], 'key': {'answer': [mid[0]]}}
        tsave(w, w.au, payload([q], tries=0))
        qid = T(d, 'list_quiz(:a)', a=w.au)['questions'][0]['id']
        Q(w, a=w.au); x = SV(w, qid, list(reversed(mid)), a=w.au)
        stored = answers_of(d, w.au, w.cece)[qid]
        ok('collations %s: a choice answer is stored in byte order' % tag, x['ok'] is True and stored == sorted(mid), stored)
        r = d.file(UNDO); ok('collations %s: the undo runs' % tag, r == 'ok' and kind_check(d) == [[OLD_CHECK, True]] and not applied(d), r)
        r = d.file(FILE); ok('collations %s: the file applies again' % tag, r == 'ok' and applied(d), r)
        new, relied = header_md5s()
        ok("collations %s: every fingerprint is the header's" % tag, all(fp[s] == new[s] for s in OURS) and all(fp[s] == relied[s] for s in RELIED))
        seen[tag] = (fp, post, stored)
        d.close()
    ok('collations: the fingerprints are the same under ICU en-US and under C', seen['icu'][0] == seen['c'][0])
    ok("collations: the post-check's rows are the same under both", seen['icu'][1] == seen['c'][1])
    ok('collations: the stored answer is the same under both', seen['icu'][2] == seen['c'][2])

SCENARIOS = {'open': scen_open, 'save': scen_save, 'send': scen_send, 'tries': scen_tries, 'closed': scen_closed, 'reopen': scen_reopen,
             'refused': scen_refused, 'access': scen_access, 'leak': scen_leak, 'limit': scen_limit, 'race': scen_race,
             'released': scen_released, 'others': scen_others, 'defaults': scen_defaults, 'apply': scen_apply, 'lastcheck': scen_lastcheck,
             'undo': scen_undo, 'undolock': scen_undolock, 'collations': scen_collations}
if __name__ == '__main__':
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
