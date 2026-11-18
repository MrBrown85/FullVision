"""Quizzes, MQ1: migrations/2026111802_quizzes.sql and 2026111803_quiz_results.sql on a database rebuilt from the
repo and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "Quizzes"). The contract is
quizzes-contract.md.

    PGPORT=<port> PGDATABASE=<db> python3 quizzes.py           every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 quizzes.py save      or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped
here. Never against gradebook-prod: a throwaway PostgreSQL 17 only. The student's functions are MQ2's, not
built yet: where a scenario needs a try or an answer it inserts the rows directly, as postgres, taking the
locks the contract tells MQ2 to take.

  save      every kind; trimming; the key kept sorted; reorder; settings; removed with and without answers
            (deleted, archived, brought back); what may and may not change once answered; 40 refusals, each
            changing nothing; DIBELS and pair pieces; a Draft; removing the quiz.
  list      list_quiz with and without a quiz, the key included; read-only.
  tries     list_quiz_tries: sent tries only; an unsent try's answers, order, times and id in no reply; the
            two booleans; a withdrawn student left out; class-list order.
  mark      mark_quiz_answer: points and note, clearing, every refusal, nothing else written.
  reopen    reopen_quiz: a new try, an in-progress try marked, a second call changes nothing, refusals.
  confirm   confirm_quiz: marked stored, one confirmed try per student, null clears, refusals; NO row of score,
            tag_score, rubric_score or grade_return changes (counts and md5 before and after).
  draft     Unassign allowed before any try, refused (draft_has_work, P0001) once one exists, a restore let
            through, Assign never refused; both orders of a start, and of reopen_quiz, racing an Unassign on two
            connections.
  others    Teacher B reads and changes nothing through any function; a class in the trash; signed out is
            PT401; a visitor and the edge functions' role run none; no role reads or writes the five tables
            or calls the helper or trigger functions; no student_submit function names quiz_key.
  cascade   an assessment deleted, a withdrawn student deleted for good, a class purged; a competency taken
            off (and the form's delete-and-insert of the same ones); a competency deleted; same class.
  race      one key twice and from two connections at once; a student's save holding the quiz while the
            teacher removes that question (archived, not deleted); a delete racing a save, both orders.
  missing   a relied-on function missing altogether stops the file, named by the pre-check.
  defaults  with Supabase's default privileges in place the grants still come out exact.
  apply     the guards stop with the catalog unchanged; only the header's changes; no existing row changes;
            the tables start empty; md5s; pre-check, post-check; a second run; lock timeout; sizes.
  undo      PART 1 alone; the full removal refuses while a quiz exists or 2026111803 is there; a changed
            function stops it; catalog and rows as before; a second run; the files apply again.
"""
import json, os, re, sys, threading, time, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, ok, finish, nid, connect, message, sqlstate, split, text_of
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111802_quizzes.sql'; FILE2 = '../2026111803_quiz_results.sql'
UNDO = 'quizzes-undo.sql'; UNDO2 = 'quiz-results-undo.sql'
PRE = 'quizzes-live-precheck.sql'; PRE2 = 'quiz-results-live-precheck.sql'
POST = 'quizzes-live-postcheck.sql'; POST2 = 'quiz-results-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
TABLES = ['public.quiz', 'public.quiz_question', 'public.quiz_key', 'public.quiz_attempt', 'public.quiz_answer']
GRADES = ['public.score', 'public.tag_score', 'public.rubric_score', 'public.grade_return']
TEACHER_FNS = {'list_quiz': 'list_quiz(:a)', 'save_quiz': "save_quiz(:a, '{}'::jsonb, null)", 'list_quiz_tries': 'list_quiz_tries(:a)',
               'mark_quiz_answer': 'mark_quiz_answer(:t, :q, 1, null, null)', 'reopen_quiz': 'reopen_quiz(:a, :e, null)',
               'confirm_quiz': "confirm_quiz(:a, '[]'::jsonb, null)"}
PRIVATE = ['fv_private.quiz_json(uuid)', 'public._quiz_draft_guard()', 'public._quiz_tag_gone()', 'public._quiz_attempt_same_class()']
H1 = text_of(FILE); H2 = text_of(FILE2)

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def applied(d): return d.one("select to_regclass('public.quiz') is not null")
def header_md5s(h):
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', h, re.M))
    relied = dict(re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})$', h, re.M))
    return new, relied
def part1(f): return text_of(f).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]
def refusal(fn):
    """(sqlstate, message) of what fn raises, or None."""
    try: fn()
    except Exception as e: return (sqlstate(e), message(e))
    return None
def sums(d, only=None):
    s = row_checksums(d.c, table_columns(d.c))
    return {k: v for k, v in s.items() if only is None or k in only}
def u4(): return str(uuid.uuid4())

# ── Quizzes as the app would send them ───────────────────────────────────────
SETTINGS = dict(shuffle_questions=True, shuffle_choices=True, tries=1, counts='best', shows='answers', add_total=False,
                after_due='keep', accept_until=None)
def choice(prompt='Which is a producer?', texts=('Grass', 'Hawk', 'Fox'), right=(0,), multiple=False, points=1, tag=None, why=None, id=None):
    ch = [{'id': u4(), 'text': t} for t in texts]
    q = {'kind': 'choice', 'prompt': prompt, 'choices': ch, 'multiple': multiple, 'points': points, 'tag_id': tag,
         'key': {'answer': [ch[i]['id'] for i in right], 'why': why}}
    if id: q['id'] = id
    return q
def tf(prompt='Plants make food.', answer=True, tag=None, points=1):
    return {'kind': 'true_false', 'prompt': prompt, 'points': points, 'tag_id': tag, 'key': {'answer': answer}}
def num(prompt='Half of 7?', answer=3.5, tolerance=0.1, tag=None, points=2):
    return {'kind': 'number', 'prompt': prompt, 'points': points, 'tag_id': tag, 'key': {'answer': answer, 'tolerance': tolerance}}
def text(prompt='Explain why.', tag=None, points=3):
    return {'kind': 'text', 'prompt': prompt, 'points': points, 'tag_id': tag, 'key': {'answer': None, 'why': 'Light.'}}
def quiz(questions, **kw): return dict(SETTINGS, **kw, questions=questions)
def from_reply(r):
    """A reply's quiz back into a save_quiz payload, unchanged (a copy: changing it changes nothing in r)."""
    r = json.loads(json.dumps(r))
    out = {k: r['quiz'][k] for k in SETTINGS}
    out['questions'] = [{'id': q['id'], 'kind': q['kind'], 'prompt': q['prompt'], 'choices': q['choices'], 'multiple': q['multiple'],
                         'points': q['points'], 'tag_id': q['tag_id'], 'key': q['key']} for q in r['questions']]
    for q in out['questions']:
        if q['choices'] is None: del q['choices']
    return out

class W: pass

def world(tag, with_file=True):
    """Teacher A: a class of four students (the last withdrawn), three competencies, a proficiency piece with two
    of them, a points piece, a DIBELS piece, a pair piece, a Draft, a class in the trash with a piece. Teacher B:
    a class of one student, a piece with a quiz, a sent try and an answer."""
    d = Db('q1_' + tag)
    w = W(); w.d = d
    if applied(d):
        # Once the files are applied and the baseline refreshed, a rebuilt database already has them; the full
        # undo (scenario undo proves it leaves the catalog as before) gives the database from before.
        for f in (UNDO2, UNDO):
            r = d.file(f)
            if r != 'ok': sys.exit('could not take the template back to before the files: %s' % r)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    def course(name, uid=A):
        return str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    def student(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_idempotency_key => gen_random_uuid())", uid, c=c, f=first)['enrollment_id'])
    def tags(c, n, uid=A):
        subj = str(d.one('select id from subject where course_id = :c', c=c))
        sec = str(T(d, "upsert_section(null, :s, 'Questioning', p_idempotency_key => gen_random_uuid())", uid, s=subj))
        return [str(T(d, "upsert_tag(null, :s, :l, p_idempotency_key => gen_random_uuid())", uid, s=sec, l='Tag %d' % i)) for i in range(n)]
    def piece(c, title, uid=A, mode='proficiency', tags_=(), draft=False):
        return str(T(d, "create_assessment(:c, :t, p_score_mode => :m, p_max_points => case when :m = 'points' then 10 end, "
                        "p_tag_ids => cast(:g as uuid[]), p_is_draft => :dr)", uid, c=c, t=title, m=mode, g=list(tags_), dr=draft))
    w.c = course('Science 8'); w.e = [student(w.c, f) for f in ('Avery', 'Blake', 'Casey', 'Devon')]
    for n, e in enumerate(w.e): d.run('update enrollment set roster_position = :n where id = :e', n=n, e=e)
    w.gone = w.e[-1]; w.here = w.e[:-1]
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    w.t = tags(w.c, 3)
    w.a = piece(w.c, 'Food Webs Quiz', tags_=w.t[:2])
    w.a2 = piece(w.c, 'Second Quiz', tags_=w.t[:1])
    w.pts = piece(w.c, 'Points Quiz', mode='points', tags_=w.t[:1])
    w.dib = piece(w.c, 'Reading', mode='dibels')
    w.pair = piece(w.c, 'Pair Lab', tags_=w.t[:1])
    d.run("update assessment set collab_mode = 'pairs' where id = :a", a=w.pair)
    w.draft = piece(w.c, 'Draft Quiz', tags_=w.t[:1], draft=True)
    w.trash = course('In the Trash'); w.trash_a = piece(w.trash, 'Old Quiz')
    d.run("update course set deleted_at = now() - interval '1 day' where id = :c", c=w.trash)
    w.cb = course('Bravo Socials', B); w.eb = student(w.cb, 'Bailey', B); w.tb = tags(w.cb, 1, B); w.ab = piece(w.cb, 'Bravo Quiz', B, tags_=w.tb)
    if with_file:
        for f in (FILE, FILE2):
            r = d.file(f); ok('(setup %s) %s applies' % (tag, f), r == 'ok', r)
        rb = save(w, w.ab, quiz([choice('Bravo question', tag=w.tb[0]), text('Bravo text')]), uid=B)
        w.qb = [q['id'] for q in rb['questions']]
        w.tryb = start(d, w.ab, w.eb); answer(d, w.tryb, w.qb[1], 'Bravo answer'); send(d, w.tryb)
    return w

def save(w, a, q, uid=A, key=None):
    return T(w.d, 'save_quiz(:a, cast(:q as jsonb), :k)', uid, a=a, q=None if q is None else json.dumps(q), k=key)
def listed(w, a, uid=A): return T(w.d, 'list_quiz(:a)', uid, a=a)
def tries(w, a, uid=A): return T(w.d, 'list_quiz_tries(:a)', uid, a=a)
def mark(w, t, q, pts, note=None, uid=A, key=None):
    return T(w.d, 'mark_quiz_answer(:t, :q, :p, :n, :k)', uid, t=t, q=q, p=pts, n=note, k=key)
def reopen(w, a, e, uid=A, key=None): return T(w.d, 'reopen_quiz(:a, :e, :k)', uid, a=a, e=e, k=key)
def confirm(w, a, marks, uid=A, key=None): return T(w.d, 'confirm_quiz(:a, cast(:m as jsonb), :k)', uid, a=a, m=json.dumps(marks), k=key)

# ── MQ2's part, done here directly as postgres ──────────────────────────────
def start(d, a, e, reopened=False):
    """A try started as MQ2 will start it: the order made from the active questions."""
    order = {'questions': [str(r[0]) for r in d.run('select id from quiz_question where assessment_id = :a and archived_at is null order by position', a=a)],
             'choices': {str(r[0]): [c['id'] for c in r[1]] for r in d.run("select id, choices from quiz_question where assessment_id = :a and kind = 'choice'", a=a)}}
    return str(d.one("""insert into quiz_attempt (assessment_id, enrollment_id, try, question_order, started_at, reopened_at)
                        values (:a, :e, coalesce((select max(try) from quiz_attempt where assessment_id = :a and enrollment_id = :e), 0) + 1,
                                cast(:o as jsonb), now(), case when :r then now() end) returning id""", a=a, e=e, o=json.dumps(order), r=reopened))
def answer(d, t, q, value):
    d.run("""insert into quiz_answer (attempt_id, question_id, assessment_id, answer)
             values (:t, :q, (select assessment_id from quiz_attempt where id = :t), cast(:v as jsonb))
             on conflict (attempt_id, question_id) do update set answer = excluded.answer, saved_at = now()""", t=t, q=q, v=json.dumps(value))
def send(d, t): d.run('update quiz_attempt set sent_at = now() where id = :t', t=t)
def rows(d, t, where='true', **kw): return d.all('select to_jsonb(x)::text from %s x where %s order by 1' % (t, where), **kw)
def quiz_rows(d): return {t: rows(d, t) for t in TABLES}

def four(w):
    """The board's kinds, one each, on the two competencies and none."""
    return quiz([choice('  Which is a producer?  ', texts=(' Grass ', 'Hawk', 'Fox'), right=(0,), tag=w.t[0], why='  Grass makes food.  '),
                 tf(tag=w.t[1]), num(), text(tag=w.t[0])])

def scen_save():
    w = world('save'); d = w.d
    r = save(w, w.a, four(w))
    qs = r['questions']
    ok('save: answers the quiz with its settings', {k: r['quiz'][k] for k in SETTINGS} == SETTINGS and r['quiz']['assessment_id'] == w.a, r['quiz'])
    ok('save: four questions numbered 1 to 4 in the order sent', [q['position'] for q in qs] == [1, 2, 3, 4] and [q['kind'] for q in qs] == ['choice', 'true_false', 'number', 'text'], qs)
    ok('save: prompt and choice text are stored trimmed, why blank-trimmed', qs[0]['prompt'] == 'Which is a producer?' and qs[0]['choices'][0]['text'] == 'Grass'
       and qs[0]['key']['why'] == 'Grass makes food.', qs[0])
    ok('save: the choice key names the right choice', qs[0]['key']['answer'] == [qs[0]['choices'][0]['id']], qs[0]['key'])
    ok('save: true/false, number and text keys as sent', qs[1]['key']['answer'] is True and qs[2]['key'] == {'answer': 3.5, 'tolerance': 0.1, 'why': None}
       and qs[3]['key']['answer'] is None and qs[3]['key']['why'] == 'Light.', [q['key'] for q in qs])
    ok('save: competencies as sent, null for none', [q['tag_id'] for q in qs] == [w.t[0], w.t[1], None, w.t[0]], [q['tag_id'] for q in qs])
    ok('save: choices null on the other kinds; nothing answered; none archived', all(q['choices'] is None for q in qs[1:]) and not any(q['answered'] for q in qs)
       and r['archived'] == [], qs)
    ok('save: the question rows hold no key', all('key' not in json.loads(x[0]) and 'answer' not in json.loads(x[0]) for x in rows(d, 'public.quiz_question')))
    ok('save: list_quiz answers the same', listed(w, w.a) == r)
    # Several right, sorted key.
    m = choice('Which are producers?', texts=('Grass', 'Moss', 'Hawk'), right=(1, 0), multiple=True)
    r2 = save(w, w.a2, quiz([m]))
    ok('save: several right, the key kept sorted', r2['questions'][0]['multiple'] is True and r2['questions'][0]['key']['answer'] == sorted([m['choices'][0]['id'], m['choices'][1]['id']]), r2['questions'][0])
    # Reorder.
    p = from_reply(r); p['questions'].reverse()
    r3 = save(w, w.a, p)
    ok('save: reorder keeps every id and renumbers', [q['id'] for q in r3['questions']] == [q['id'] for q in reversed(qs)] and [q['position'] for q in r3['questions']] == [1, 2, 3, 4],
       [(q['id'], q['position']) for q in r3['questions']])
    # Settings.
    r4 = save(w, w.a, dict(from_reply(r3), tries=2, counts='latest', shows='grade', add_total=True, after_due='until', accept_until='2026-12-01',
                           shuffle_questions=False, shuffle_choices=False))
    ok('save: settings stored', {k: r4['quiz'][k] for k in SETTINGS} == dict(tries=2, counts='latest', shows='grade', add_total=True, after_due='until',
                                                                          accept_until='2026-12-01', shuffle_questions=False, shuffle_choices=False), r4['quiz'])
    ok('save: updated_at moves', r4['quiz']['updated_at'] >= r3['quiz']['updated_at'])
    r4 = save(w, w.a, dict(from_reply(r4), tries=0, after_due='stop', accept_until=None))
    ok('save: unlimited tries and stop at the due date', r4['quiz']['tries'] == 0 and r4['quiz']['after_due'] == 'stop' and r4['quiz']['accept_until'] is None, r4['quiz'])
    # A question removed with no answers is deleted with its key.
    p = from_reply(r4); gone = p['questions'].pop(0); r5 = save(w, w.a, p)
    ok('save: a question left out with no answer is deleted', gone['id'] not in [q['id'] for q in r5['questions'] + r5['archived']]
       and d.one('select count(*) from quiz_question where id = :q', q=gone['id']) == 0, r5)
    ok('save: and its key with it', d.one('select count(*) from quiz_key where question_id = :q', q=gone['id']) == 0)
    # Answered: archived, not deleted; brought back.
    t = start(d, w.a, w.here[0]); keep = r5['questions'][0]['id']; answer(d, t, keep, True if r5['questions'][0]['kind'] == 'true_false' else 1)
    p = from_reply(r5); kq = [q for q in p['questions'] if q['id'] == keep][0]; p['questions'] = [q for q in p['questions'] if q['id'] != keep]
    r6 = save(w, w.a, p)
    ok('save: a question left out that has an answer is archived', [x['id'] for x in r6['archived']] == [keep] and r6['archived'][0]['position'] is None
       and r6['archived'][0]['archived_at'] and r6['archived'][0]['answered'] is True, r6['archived'])
    ok('save: its key and the answer are kept', d.one('select count(*) from quiz_key where question_id = :q', q=keep) == 1
       and d.one('select count(*) from quiz_answer where question_id = :q', q=keep) == 1)
    ok('save: the others are renumbered from 1', [q['position'] for q in r6['questions']] == list(range(1, len(r6['questions']) + 1)))
    p['questions'].append(kq); r7 = save(w, w.a, p)
    ok('save: sent back with its id, an archived question comes back', r7['archived'] == [] and r7['questions'][-1]['id'] == keep and r7['questions'][-1]['archived_at'] is None)
    # What may change once answered, and what may not.
    cq = [q for q in r7['questions'] if q['kind'] == 'choice'][0]
    t2 = start(d, w.a, w.here[1]); answer(d, t2, cq['id'], [cq['choices'][1]['id']])
    before = listed(w, w.a)
    def changed(f):
        p = from_reply(before); q = [x for x in p['questions'] if x['id'] == cq['id']][0]; f(q); return p
    x = refusal(lambda: save(w, w.a, changed(lambda q: (q.update(kind='text', key={'answer': None}), q.pop('choices'), q.update(multiple=False)))))
    ok('save: kind cannot change once answered (kind_locked)', x == ('22023', 'kind_locked'), x)
    x = refusal(lambda: save(w, w.a, changed(lambda q: q.update(multiple=True))))
    ok('save: Several Right cannot change once answered (kind_locked)', x == ('22023', 'kind_locked'), x)
    x = refusal(lambda: save(w, w.a, changed(lambda q: q['choices'].append({'id': u4(), 'text': 'New'}))))
    ok('save: a choice cannot be added once answered (choices_locked)', x == ('22023', 'choices_locked'), x)
    x = refusal(lambda: save(w, w.a, changed(lambda q: q['choices'].pop(2))))
    ok('save: a choice cannot be removed once answered (choices_locked)', x == ('22023', 'choices_locked'), x)
    x = refusal(lambda: save(w, w.a, changed(lambda q: q['choices'][2].update(id=u4()))))
    ok('save: a choice id cannot change once answered (choices_locked)', x == ('22023', 'choices_locked'), x)
    ok('save: the refused saves changed nothing', listed(w, w.a) == before)
    def fix(q):
        q['choices'][0]['text'] = 'Green grass'; q['choices'].reverse(); q['prompt'] = 'Which one is a producer?'; q['points'] = 2
        q['tag_id'] = w.t[1]; q['key'] = {'answer': [q['choices'][0]['id']], 'why': 'Fixed.'}
    r8 = save(w, w.a, changed(fix)); q8 = [x for x in r8['questions'] if x['id'] == cq['id']][0]
    ok('save: once answered, choice text and order, prompt, points, competency and key may change',
       q8['prompt'] == 'Which one is a producer?' and q8['points'] == 2 and q8['tag_id'] == w.t[1] and q8['choices'][-1]['text'] == 'Green grass'
       and q8['key']['answer'] == [q8['choices'][0]['id']] and q8['key']['why'] == 'Fixed.', q8)
    ok('save: the raw answer is kept as it was', d.one('select answer::text from quiz_answer where attempt_id = :t', t=t2) == json.dumps([cq['choices'][1]['id']]))
    nq = [q for q in r8['questions'] if not q['answered']][0]
    p = from_reply(r8); [q for q in p['questions'] if q['id'] == nq['id']][0].update(kind='text', key={'answer': None}, multiple=False)
    for q in p['questions']:
        if q['id'] == nq['id']: q.pop('choices', None)
    r9 = save(w, w.a, p)
    ok('save: a question with no answer may change kind', [q['kind'] for q in r9['questions'] if q['id'] == nq['id']] == ['text'], r9)
    # Refusals: each bad_quiz unless named, and none changes anything.
    base = from_reply(r9); before = listed(w, w.a); sm = sums(d, TABLES)
    def bad(name, payload, word='bad_quiz', a=None):
        x = refusal(lambda: save(w, a or w.a, payload))
        ok('save refused: %s (%s)' % (name, word), x == ('22023', word), x)
    def with_q(f, q=None):
        p = json.loads(json.dumps(base)); qq = q if q is not None else choice(); f(qq); p['questions'].append(qq); return p
    p = dict(base); p.pop('add_total'); bad('a setting missing', p)
    bad('an unknown setting', dict(base, colour='red'))
    bad('tries 3', dict(base, tries=3)); bad('tries "1"', dict(base, tries='1'))
    bad('counts other', dict(base, counts='worst')); bad('shows other', dict(base, shows='all'))
    bad('after_due other', dict(base, after_due='never'))
    bad('until with no date', dict(base, after_due='until', accept_until=None))
    bad('until with a bad date', dict(base, after_due='until', accept_until='2026-02-30'))
    bad('a date without until', dict(base, after_due='keep', accept_until='2026-12-01'))
    bad('shuffle not a boolean', dict(base, shuffle_questions='yes'))
    bad('questions not a list', dict(base, questions={}))
    bad('a quiz that is not an object', [1])
    bad('101 questions', quiz([tf() for _ in range(101)]), 'too_many_questions')
    bad('a question with an unknown field', with_q(lambda q: q.update(hint='x')))
    bad('a question with no key', with_q(lambda q: q.pop('key')))
    bad('a question with no tag_id field', with_q(lambda q: q.pop('tag_id')))
    bad('a kind not known', with_q(lambda q: q.update(kind='rating')))
    bad('a blank prompt', with_q(lambda q: q.update(prompt='   ')))
    bad('a prompt of 1001', with_q(lambda q: q.update(prompt='x' * 1001)))
    bad('one choice', with_q(lambda q: q.update(choices=q['choices'][:1], key={'answer': [q['choices'][0]['id']]})))
    bad('21 choices', with_q(lambda q: None, choice(texts=['c%d' % i for i in range(21)])))
    bad('a choice id that is a word', with_q(lambda q: (q['choices'][1].update(id='right'))))
    bad('a choice id that is not version 4', with_q(lambda q: q['choices'][1].update(id=str(uuid.uuid1()))))
    bad('a choice id in capitals', with_q(lambda q: q['choices'][1].update(id=q['choices'][1]['id'].upper())))
    bad('two choices with one id', with_q(lambda q: q['choices'][2].update(id=q['choices'][1]['id'])))
    bad('a blank choice', with_q(lambda q: q['choices'][1].update(text='  ')))
    bad('a choice of 301', with_q(lambda q: q['choices'][1].update(text='x' * 301)))
    bad('a choice with an extra field', with_q(lambda q: q['choices'][1].update(right=True)))
    bad('choices on a true/false question', with_q(lambda q: q.update(choices=[{'id': u4(), 'text': 'a'}, {'id': u4(), 'text': 'b'}]), tf()))
    bad('Several Right on a true/false question', with_q(lambda q: q.update(multiple=True), tf()))
    bad('points below 0', with_q(lambda q: q.update(points=-1))); bad('points above 100', with_q(lambda q: q.update(points=101)))
    bad('points as text', with_q(lambda q: q.update(points='1'))); bad('points as a word', with_q(lambda q: q.update(points='abc')))
    bad('a tolerance as a word', with_q(lambda q: q['key'].update(tolerance='x'), num()))
    bad('a number key as a word that is not a number', with_q(lambda q: q['key'].update(answer='abc'), num()))
    bad('a competency id that is not a uuid', with_q(lambda q: q.update(tag_id='zzz')))
    bad('a competency id that is a number', with_q(lambda q: q.update(tag_id=5)))
    bad('a question that is a number', dict(base, questions=[5])); bad('a question that is a list', dict(base, questions=[[1]]))
    bad('a key that is a number', with_q(lambda q: q.update(key=5))); bad('a choice that is a word', with_q(lambda q: q['choices'].append('x')))
    bad('a choice key with a number in it', with_q(lambda q: q['key'].update(answer=[1])))
    bad('a prompt that is a number', with_q(lambda q: q.update(prompt=5)))
    bad('until with a word for a date', dict(base, after_due='until', accept_until='soon'))
    bad('tries 1.5', dict(base, tries=1.5))
    bad("a competency not on the piece", with_q(lambda q: q.update(tag_id=w.t[2])))
    bad('a competency that does not exist', with_q(lambda q: q.update(tag_id=u4())))
    bad('a key with an extra field', with_q(lambda q: q['key'].update(right=1)))
    bad('a choice key with none right', with_q(lambda q: q['key'].update(answer=[])))
    bad('a choice key with two right, not Several Right', with_q(lambda q: q['key'].update(answer=[c['id'] for c in q['choices'][:2]])))
    bad('a choice key naming another question\'s choice', with_q(lambda q: q['key'].update(answer=[u4()])))
    bad('a choice key naming one choice twice', with_q(lambda q: q['key'].update(answer=[q['choices'][0]['id']] * 2), choice(multiple=True)))
    bad('a true/false key that is a word', with_q(lambda q: q['key'].update(answer='true'), tf()))
    bad('a number key that is a word', with_q(lambda q: q['key'].update(answer='3.5'), num()))
    bad('a number key past 10^12', with_q(lambda q: q['key'].update(answer=1e13), num()))
    bad('a number with no key', with_q(lambda q: q['key'].update(answer=None), num()))
    bad('a text key with an answer', with_q(lambda q: q['key'].update(answer='Light'), text()))
    bad('a tolerance on true/false', with_q(lambda q: q['key'].update(tolerance=1), tf()))
    bad('a negative tolerance', with_q(lambda q: q['key'].update(tolerance=-0.5), num()))
    bad('a why of 501', with_q(lambda q: q['key'].update(why='x' * 501)))
    bad('an id that is not a uuid', with_q(lambda q: q.update(id='abc')))
    bad("an id of another piece's question", with_q(lambda q: q.update(id=r2['questions'][0]['id'])))
    bad("an id of Teacher B's question", with_q(lambda q: q.update(id=w.qb[0])))
    bad('one id twice', dict(base, questions=base['questions'] + [base['questions'][0]]))
    bad('a DIBELS piece', quiz([tf()]), 'not_offered', w.dib)
    bad('a pair piece', quiz([tf()]), 'not_offered', w.pair)
    ok('save: none of the refusals changed anything', listed(w, w.a) == before and sums(d, TABLES) == sm)
    ok('save: the DIBELS and pair pieces have no quiz', d.one('select count(*) from quiz where assessment_id in (:a, :b)', a=w.dib, b=w.pair) == 0)
    # A Draft, zero questions, a points piece.
    ok('save: allowed on a Draft', len(save(w, w.draft, quiz([tf()]))['questions']) == 1)
    ok('save: zero questions is a quiz with none', save(w, w.pts, quiz([]))['questions'] == [])
    # Removing a quiz.
    ok('save: null on a piece with no quiz answers an empty quiz', save(w, w.dib, None) == {'quiz': None, 'questions': [], 'archived': []})
    save(w, w.pts, quiz([tf(), choice()]))
    ok('save: null removes a quiz no student has started', save(w, w.pts, None) == {'quiz': None, 'questions': [], 'archived': []}
       and d.one('select count(*) from quiz_question where assessment_id = :a', a=w.pts) == 0)
    x = refusal(lambda: save(w, w.a, None))
    ok('save: null is refused once a student has a try (has_tries)', x == ('22023', 'has_tries') and listed(w, w.a)['quiz'] is not None, x)
    d.close()

def scen_list():
    w = world('list'); d = w.d
    ok('list: a piece with no quiz', listed(w, w.a) == {'quiz': None, 'questions': [], 'archived': []}, listed(w, w.a))
    r = save(w, w.a, four(w))
    cat = catalog(d.c); s = sums(d)
    l = listed(w, w.a)
    ok('list: the quiz, its questions and the key', l == r and all('key' in q for q in l['questions']) and l['questions'][0]['key']['answer'], l)
    ok('list: it writes nothing', catalog(d.c) == cat and sums(d) == s)
    d.run('insert into quiz (assessment_id) values (:a)', a=w.a2)
    z = d.one('select to_jsonb(z) from quiz z where assessment_id = :a', a=w.a2)
    ok('list: the table defaults are the contract\'s', {k: z[k] for k in SETTINGS} == SETTINGS, z)
    d.run("insert into quiz_question (assessment_id, position, kind, prompt) values (:a, 1, 'text', 'Q')", a=w.a2)
    ok('list: a question defaults to 1 point, not Several Right', d.all('select points::text, multiple from quiz_question where assessment_id = :a', a=w.a2) == [['1', False]])
    ok('list: list_quiz and list_quiz_tries are marked stable', d.one("select string_agg(provolatile::text, '' order by proname) from pg_proc where proname in ('list_quiz', 'list_quiz_tries')") == 'ss')
    d.close()

def scen_tries():
    w = world('tries'); d = w.d
    r = save(w, w.a, quiz([text('Q1'), tf(), choice()])); q = [x['id'] for x in r['questions']]
    ok('tries: with no tries every active student is listed, none sent', tries(w, w.a) == {'students': [
        {'enrollment_id': e, 'sent': 0, 'in_progress': False, 'reopened': False, 'tries': []} for e in w.here]}, tries(w, w.a))
    t1 = start(d, w.a, w.here[0]); answer(d, t1, q[0], 'SENT-ANSWER'); answer(d, t1, q[1], False); send(d, t1)
    t2 = start(d, w.a, w.here[0]); answer(d, t2, q[0], 'UNSENT-MARKER-ONE')
    t3 = start(d, w.a, w.here[1]); answer(d, t3, q[0], 'UNSENT-MARKER-TWO')
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone)
    tg = start(d, w.a, w.gone); answer(d, tg, q[0], 'WITHDRAWN-MARKER'); send(d, tg)
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    t4 = str(d.one('insert into quiz_attempt (assessment_id, enrollment_id, try, reopened_at) values (:a, :e, 1, now()) returning id', a=w.a, e=w.here[2]))
    got = tries(w, w.a); dump = json.dumps(got)
    st = {s['enrollment_id']: s for s in got['students']}
    ok('tries: the active students in class-list order, the withdrawn one left out', [s['enrollment_id'] for s in got['students']] == w.here, got)
    ok('tries: the withdrawn student\'s answer is in no reply', 'WITHDRAWN-MARKER' not in dump and w.gone not in dump)
    ok('tries: a student with one sent and one unsent: sent 1, in progress, only the sent try',
       st[w.here[0]]['sent'] == 1 and st[w.here[0]]['in_progress'] is True and [t['attempt_id'] for t in st[w.here[0]]['tries']] == [t1], st[w.here[0]])
    s1 = st[w.here[0]]['tries'][0]
    ok('tries: the sent try with its order, times and answers', s1['try'] == 1 and s1['sent_at'] and s1['started_at'] and s1['question_order']['questions'] == q
       and s1['marked'] is None and sorted(a['question_id'] for a in s1['answers']) == sorted(q[:2]), s1)
    ok('tries: an answer as stored, with no points or note yet', [a for a in s1['answers'] if a['question_id'] == q[0]][0] | {'saved_at': None}
       == {'question_id': q[0], 'answer': 'SENT-ANSWER', 'saved_at': None, 'given_points': None, 'note': None}, s1['answers'])
    ok('tries: an unsent try\'s answers are in no reply', 'UNSENT-MARKER' not in dump)
    ok('tries: an unsent try\'s id is in no reply', t2 not in dump and t3 not in dump and t4 not in dump)
    ok('tries: a student with only an unsent try: sent 0, in progress, no tries', st[w.here[1]] == {'enrollment_id': w.here[1], 'sent': 0, 'in_progress': True, 'reopened': False, 'tries': []}, st[w.here[1]])
    ok('tries: a reopened try not yet opened: reopened, not in progress', st[w.here[2]] == {'enrollment_id': w.here[2], 'sent': 0, 'in_progress': False, 'reopened': True, 'tries': []}, st[w.here[2]])
    send(d, t2)
    got = tries(w, w.a); s0 = [s for s in got['students'] if s['enrollment_id'] == w.here[0]][0]
    ok('tries: once sent, the second try is answered, by try', [t['try'] for t in s0['tries']] == [1, 2] and s0['sent'] == 2 and s0['in_progress'] is False
       and 'UNSENT-MARKER-ONE' in json.dumps(s0), s0)
    ok('tries: a piece with no quiz answers no students', tries(w, w.a2) == {'students': []})
    d.close()

def scen_mark():
    w = world('mark'); d = w.d
    r = save(w, w.a, quiz([text('Explain', points=3), tf()])); qt, qf = [x['id'] for x in r['questions']]
    t = start(d, w.a, w.here[0]); answer(d, t, qt, 'Because light'); answer(d, t, qf, True); send(d, t)
    u = start(d, w.a, w.here[1]); answer(d, u, qt, 'Not sent')
    grades = sums(d, GRADES)
    got = mark(w, t, qt, 1.5, '  Good start.  ')
    ok('mark: answers the points and the trimmed note', got == {'answer': {'attempt_id': t, 'question_id': qt, 'given_points': 1.5, 'note': 'Good start.'}}, got)
    ok('mark: the row holds them', d.all('select given_points::text, note from quiz_answer where attempt_id = :t and question_id = :q', t=t, q=qt) == [['1.5', 'Good start.']])
    ok('mark: the full points are allowed', mark(w, t, qt, 3)['answer']['given_points'] == 3)
    got = mark(w, t, qt, None, '   ')
    ok('mark: null points and a blank note take them away', got['answer']['given_points'] is None and got['answer']['note'] is None, got)
    before = rows(d, 'public.quiz_answer')
    for name, fn, want in (('points above the question\'s', lambda: mark(w, t, qt, 3.01), ('22023', 'bad_points')),
                           ('points below 0', lambda: mark(w, t, qt, -1), ('22023', 'bad_points')),
                           ('a note of 1001', lambda: mark(w, t, qt, 1, 'x' * 1001), ('22023', 'bad_note')),
                           ('a question that is not Text', lambda: mark(w, t, qf, 1), ('22023', 'not_text')),
                           ('an unsent try', lambda: mark(w, u, qt, 1), ('22023', 'not_sent')),
                           ("a question of another piece", lambda: mark(w, t, w.qb[1], 1), ('P0002', 'not found')),
                           ("Teacher B's try", lambda: mark(w, w.tryb, w.qb[1], 1), ('P0002', 'not found')),
                           ('a try that does not exist', lambda: mark(w, nid(), qt, 1), ('P0002', 'not found'))):
        x = refusal(fn)
        ok('mark refused: %s %s' % (name, want), x == want, x)
    ok('mark: those refusals changed nothing', rows(d, 'public.quiz_answer') == before)
    x = refusal(lambda: (d.run("insert into quiz_question (assessment_id, position, kind, prompt) values (:a, 9, 'text', 'Spare') ", a=w.a), mark(w, t, str(d.one("select id from quiz_question where prompt = 'Spare'")), 1)))
    ok('mark refused: a Text question with no answer in the try is not found', x == ('P0002', 'not found'), x)
    d.run("delete from quiz_question where prompt = 'Spare'")
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone)
    tg = start(d, w.a, w.gone); answer(d, tg, qt, 'w'); send(d, tg)
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    before = rows(d, 'public.quiz_answer')
    x = refusal(lambda: mark(w, tg, qt, 1)); ok("mark refused: a withdrawn student's try is not found", x == ('P0002', 'not found'), x)
    ok('mark: that refusal changed nothing', rows(d, 'public.quiz_answer') == before)
    key = nid(); first = mark(w, t, qt, 2, 'One', key=key); again = mark(w, t, qt, 0, 'Two', key=key)
    ok('mark: the same key again answers the first reply and writes nothing', again == first and d.one('select given_points from quiz_answer where attempt_id = :t and question_id = :q', t=t, q=qt) == 2)
    ok('mark: nothing else is written (marked, scores)', d.one('select count(*) from quiz_attempt where marked is not null') == 0 and sums(d, GRADES) == grades)
    d.close()

def scen_reopen():
    w = world('reopen'); d = w.d
    save(w, w.a, quiz([tf(), text()]))
    s0, s1, s2 = w.here
    t = start(d, w.a, s0); send(d, t)
    got = reopen(w, w.a, s0)
    att = got['attempt']
    ok('reopen: a student whose tries are used gets a new try, marked reopened, not started', got['made'] is True and att['try'] == 2 and att['reopened_at'] and att['started'] is False, got)
    ok('reopen: the new try has no order yet and is not sent', d.all('select question_order is null, started_at is null, sent_at is null from quiz_attempt where id = :t', t=att['attempt_id']) == [[True, True, True]])
    again = reopen(w, w.a, s0)
    ok('reopen: a second call changes nothing and answers the same try', again == {'attempt': att, 'made': False}, again)
    ip = start(d, w.a, s1)
    got = reopen(w, w.a, s1)
    ok('reopen: a try in progress is marked reopened, no new try', got['made'] is False and got['attempt']['attempt_id'] == ip and got['attempt']['started'] is True and got['attempt']['reopened_at'], got)
    ok('reopen: still one try for that student', d.one('select count(*) from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=s1) == 1)
    got = reopen(w, w.a, s2)
    ok('reopen: a student with no try gets try 1, reopened', got['made'] is True and got['attempt']['try'] == 1, got)
    save(w, w.draft, quiz([tf()]))
    before = quiz_rows(d)
    for name, fn, want in (('a Draft', lambda: reopen(w, w.draft, s0), ('22023', 'draft')),
                           ('a withdrawn student', lambda: reopen(w, w.a, w.gone), ('P0002', 'not found')),
                           ("Teacher B's student", lambda: reopen(w, w.a, w.eb), ('P0002', 'not found')),
                           ("Teacher B's piece", lambda: reopen(w, w.ab, w.eb), ('P0002', 'not found')),
                           ('a piece with no quiz', lambda: reopen(w, w.a2, s0), ('P0002', 'not found')),
                           ('a student that does not exist', lambda: reopen(w, w.a, nid()), ('P0002', 'not found'))):
        x = refusal(fn); ok('reopen refused: %s %s' % (name, want), x == want, x)
    ok('reopen: the refusals changed nothing', quiz_rows(d) == before)
    d.run('update quiz_attempt set question_order = \'{"questions": []}\', started_at = now(), sent_at = now() where id = :t', t=att['attempt_id'])
    key = nid(); a1 = reopen(w, w.a, s0, key=key); a2 = reopen(w, w.a, s0, key=key)
    ok('reopen: the same key again answers the first reply and makes one try', a1 == a2 and a1['made'] and a1['attempt']['try'] == 3
       and d.one('select count(*) from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=s0) == 3, (a1, a2))
    d.close()

def marks_for(qids, earned=1, result='right'):
    return {'earned': earned * len(qids), 'possible': len(qids), 'questions': {q: {'earned': earned, 'result': result} for q in qids}}

def scen_confirm():
    w = world('confirm'); d = w.d
    r = save(w, w.a, quiz([tf(), text()])); q = [x['id'] for x in r['questions']]
    # Grades exist in the class, so a write to them would show.
    T(d, 'upsert_tag_score(:e, :a, :t, 3, null, null)', e=w.here[0], a=w.a, t=w.t[0])
    T(d, 'upsert_score(:e, :a, 3, null)', e=w.here[1], a=w.a)
    t1 = start(d, w.a, w.here[0]); answer(d, t1, q[0], True); send(d, t1)
    t2 = start(d, w.a, w.here[1]); send(d, t2)
    u = start(d, w.a, w.here[2])
    grades = sums(d, GRADES); counts = {g: d.one('select count(*) from %s' % g) for g in GRADES}
    m1 = marks_for(q); m2 = marks_for(q[:1], 0, 'wrong')
    got = confirm(w, w.a, [{'attempt_id': t1, 'marked': m1}, {'attempt_id': t2, 'marked': m2}])
    ok('confirm: answers each try in order, with marked_at', [x['attempt_id'] for x in got['confirmed']] == [t1, t2]
       and [x['enrollment_id'] for x in got['confirmed']] == w.here[:2] and all(x['try'] == 1 and x['marked_at'] for x in got['confirmed']), got)
    ok('confirm: marked is stored exactly', d.one('select marked from quiz_attempt where id = :t', t=t1) == m1 and d.one('select marked from quiz_attempt where id = :t', t=t2) == m2)
    ok('confirm: no row of score, tag_score, rubric_score or grade_return changed (md5)', sums(d, GRADES) == grades, (grades, sums(d, GRADES)))
    ok('confirm: and their counts are the same', {g: d.one('select count(*) from %s' % g) for g in GRADES} == counts)
    t1b = start(d, w.a, w.here[0]); send(d, t1b)
    confirm(w, w.a, [{'attempt_id': t1b, 'marked': m2}])
    ok('confirm: one confirmed try per student: the other try loses its marked', d.all('select id::text, marked is not null from quiz_attempt where enrollment_id = :e order by try', e=w.here[0])
       == [[t1, False], [t1b, True]])
    got = confirm(w, w.a, [{'attempt_id': t1b, 'marked': None}])
    ok('confirm: null takes a try\'s marked away', got['confirmed'][0]['marked_at'] is None and d.one('select marked is null and marked_at is null from quiz_attempt where id = :t', t=t1b) is True)
    confirm(w, w.a, [{'attempt_id': t1, 'marked': m1}])
    ok('confirm: Undo of a later confirm puts the earlier marks back the same way', d.one('select marked from quiz_attempt where id = :t', t=t1) == m1)
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone)
    tg = start(d, w.a, w.gone); send(d, tg); d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    before = quiz_rows(d)
    one = lambda m=m1, t=t1: [{'attempt_id': t, 'marked': m}]
    for name, marks, want in (('an unsent try', one(t=u), ('22023', 'not_sent')),
                              ("Teacher B's try", one(t=w.tryb), ('P0002', 'not found')),
                              ("a withdrawn student's try", one(t=tg), ('P0002', 'not found')),
                              ('a try that does not exist', one(t=nid()), ('P0002', 'not found')),
                              ('not a list', {'attempt_id': t1}, ('22023', 'bad_marks')),
                              ('an empty list', [], ('22023', 'bad_marks')),
                              ('201 items', [{'attempt_id': nid(), 'marked': None} for _ in range(201)], ('22023', 'bad_marks')),
                              ('an item with an extra key', [{'attempt_id': t1, 'marked': None, 'x': 1}], ('22023', 'bad_marks')),
                              ('an item with no marked', [{'attempt_id': t1}], ('22023', 'bad_marks')),
                              ('an attempt id that is not a uuid', [{'attempt_id': 'x', 'marked': None}], ('22023', 'bad_marks')),
                              ('earned above possible', one(dict(m1, earned=3)), ('22023', 'bad_marks')),
                              ('possible above 10000', one(dict(m1, earned=1, possible=10001)), ('22023', 'bad_marks')),
                              ('marked with an extra key', one(dict(m1, level=3)), ('22023', 'bad_marks')),
                              ('a question of another piece', one(dict(m1, questions={w.qb[0]: {'earned': 1, 'result': 'right'}})), ('22023', 'bad_marks')),
                              ('a result not known', one(dict(m1, questions={q[0]: {'earned': 1, 'result': 'maybe'}})), ('22023', 'bad_marks')),
                              ('a question earning 101', one(dict(m1, questions={q[0]: {'earned': 101, 'result': 'right'}})), ('22023', 'bad_marks')),
                              ('a question with a level', one(dict(m1, questions={q[0]: {'earned': 1, 'result': 'right', 'level': 3}})), ('22023', 'bad_marks')),
                              ('one try twice', one() + one(), ('22023', 'bad_marks')),
                              ('earned as a word', one(dict(m1, earned='x')), ('22023', 'bad_marks')),
                              ('a question id that is not a uuid', one(dict(m1, questions={'zzz': {'earned': 1, 'result': 'right'}})), ('22023', 'bad_marks')),
                              ('a question earning a word', one(dict(m1, questions={q[0]: {'earned': 'x', 'result': 'right'}})), ('22023', 'bad_marks')),
                              ('an item that is a number', [5], ('22023', 'bad_marks')),
                              ('marked that is a list', one([1]), ('22023', 'bad_marks')),
                              ('questions that is a list', one(dict(m1, questions=[1])), ('22023', 'bad_marks'))):
        x = refusal(lambda: confirm(w, w.a, marks)); ok('confirm refused: %s %s' % (name, want), x == want, x)
    x = refusal(lambda: confirm(w, w.a2, one())); ok('confirm refused: a piece with no quiz is not found', x == ('P0002', 'not found'), x)
    ok('confirm: the refusals changed nothing', quiz_rows(d) == before)
    key = nid(); c1 = confirm(w, w.a, one(m2), key=key); c2 = confirm(w, w.a, one(m1), key=key)
    ok('confirm: the same key again answers the first reply and writes nothing', c1 == c2 and d.one('select marked from quiz_attempt where id = :t', t=t1) == m2)
    ok('confirm: after all of it, the grade tables are as they were', sums(d, GRADES) == grades)
    d.close()

class Conn:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()
    def as_teacher(self, uid=A):
        self.c.run("select set_config('request.jwt.claim.sub', :u, false)", u=uid); self.c.run('set role authenticated')

def unassign(w, a, uid=A): return T(w.d, "update_assessment(:a, '{\"is_draft\": true}'::jsonb)", uid, a=a)
def is_draft(d, a): return d.one('select is_draft from assessment where id = :a', a=a)

def scen_draft():
    w = world('draft'); d = w.d
    save(w, w.a, quiz([tf()]))
    unassign(w, w.a)
    ok('draft: Unassign allowed while no student has a try', is_draft(d, w.a) is True)
    T(d, "update_assessment(:a, '{\"is_draft\": false}'::jsonb)", a=w.a)
    ok('draft: Assign allowed', is_draft(d, w.a) is False)
    d.run('insert into quiz_attempt (assessment_id, enrollment_id, try, reopened_at) values (:a, :e, 1, now())', a=w.a, e=w.here[0])
    x = refusal(lambda: unassign(w, w.a))
    ok('draft: a reopened try not yet opened already refuses Unassign (draft_has_work, P0001)', x == ('P0001', 'draft_has_work'), x)
    d.run('delete from quiz_attempt')
    start(d, w.a, w.here[0])
    x = refusal(lambda: unassign(w, w.a))
    ok('draft: an unsent try refuses Unassign', x == ('P0001', 'draft_has_work') and is_draft(d, w.a) is False, x)
    try:
        d.run('update assessment set is_draft = true where id = :a', a=w.a); detail = None
    except Exception as e:
        detail = e.args[0].get('D') if e.args and isinstance(e.args[0], dict) else None
    ok("draft: a direct update is refused too, with the guard's sentence", detail == 'A student has started the quiz on this assessment, so it cannot go back to a Draft.', detail)
    d.run("select set_config('fv.restoring', 'on', false)"); d.run('update assessment set is_draft = true where id = :a', a=w.a)
    ok('draft: a restore (fv.restoring) is let through', is_draft(d, w.a) is True)
    d.run("select set_config('fv.restoring', '', false)"); d.run('update assessment set is_draft = false where id = :a', a=w.a)
    ok('draft: another piece of the class is not touched', (unassign(w, w.a2), is_draft(d, w.a2))[1] is True)
    T(d, "update_assessment(:a, '{\"is_draft\": false}'::jsonb)", a=w.a2)
    ok('draft: the existing guard is unchanged', md5(d, 'public._assessment_draft_guard()') == 'c18fcd8b805c83a2b75e8ca051792658')
    # The race, both orders, on the real definitions: a start (MQ2's locks) against an Unassign.
    START = """select 1 from assessment where id = :a and not is_draft for share"""
    for rnd in range(3):
        d.run('delete from quiz_attempt'); T(d, "update_assessment(:a, '{\"is_draft\": false}'::jsonb)", a=w.a)
        # 1. The start holds the row first; the Unassign waits, then sees the try.
        s = Conn(d); s.run('begin'); held = s.run(START, a=w.a)
        s.run("insert into quiz_attempt (assessment_id, enrollment_id, try, question_order, started_at) values (:a, :e, 1, '{}', now())", a=w.a, e=w.here[0])
        out = {}
        def un():
            c = Conn(d); c.as_teacher()
            try: c.run("select update_assessment(:a, '{\"is_draft\": true}'::jsonb)", a=w.a); out['r'] = 'ok'
            except Exception as e: out['r'] = (sqlstate(e), message(e))
            c.close()
        th = threading.Thread(target=un); th.start(); time.sleep(0.5)
        ok('draft race %d: the Unassign waits for the start' % rnd, held == [[1]] and 'r' not in out, out)
        s.run('commit'); s.close(); th.join()
        ok('draft race %d: then it is refused, the try seen' % rnd, out.get('r') == ('P0001', 'draft_has_work') and is_draft(d, w.a) is False, out)
        # 2. The Unassign holds the row first; the start waits, then finds a Draft and starts nothing.
        d.run('delete from quiz_attempt')
        u = Conn(d); u.as_teacher(); u.run('begin'); u.run("select update_assessment(:a, '{\"is_draft\": true}'::jsonb)", a=w.a)
        out = {}
        def st():
            c = Conn(d)
            try:
                c.run('begin'); r = c.run(START, a=w.a); out['rows'] = r
                if r: c.run("insert into quiz_attempt (assessment_id, enrollment_id, try, question_order, started_at) values (:a, :e, 1, '{}', now())", a=w.a, e=w.here[0])
                c.run('commit')
            except Exception as e: out['err'] = message(e)
            c.close()
        th = threading.Thread(target=st); th.start(); time.sleep(0.5)
        ok('draft race %d: the start waits for the Unassign' % rnd, out == {}, out)
        u.run('commit'); u.close(); th.join()
        ok('draft race %d: then it finds a Draft and starts no try' % rnd, out.get('rows') == [] and d.one('select count(*) from quiz_attempt') == 0 and is_draft(d, w.a) is True, out)
        d.run('update assessment set is_draft = false where id = :a', a=w.a)
    # reopen_quiz makes a try too: it waits for an Unassign in progress and then sees the Draft.
    d.run('delete from quiz_attempt')
    u = Conn(d); u.as_teacher(); u.run('begin'); u.run("select update_assessment(:a, '{\"is_draft\": true}'::jsonb)", a=w.a)
    out = {}
    def ro():
        c = Conn(d); c.as_teacher()
        try: out['r'] = c.run('select reopen_quiz(:a, :e, null)', a=w.a, e=w.here[0])[0][0]
        except Exception as e: out['r'] = (sqlstate(e), message(e))
        c.close()
    th = threading.Thread(target=ro); th.start(); time.sleep(0.5)
    ok('draft race: a reopen waits for an Unassign in progress', out == {}, out)
    u.run('commit'); u.close(); th.join()
    ok('draft race: then it is refused as a Draft and makes no try', out.get('r') == ('22023', 'draft') and d.one('select count(*) from quiz_attempt') == 0, out)
    d.run('update assessment set is_draft = false where id = :a', a=w.a)
    send(d, start(d, w.a, w.here[0]))
    r = Conn(d); r.as_teacher(); r.run('begin'); r.run('select reopen_quiz(:a, :e, null)', a=w.a, e=w.here[0])
    out = {}
    th = threading.Thread(target=un); th.start(); time.sleep(0.5)
    ok('draft race: an Unassign waits for a reopen in progress', 'r' not in out, out)
    r.run('commit'); r.close(); th.join()
    ok('draft race: then it is refused, the try seen', out.get('r') == ('P0001', 'draft_has_work') and is_draft(d, w.a) is False, out)
    d.close()

def scen_others():
    w = world('others'); d = w.d
    r = save(w, w.a, quiz([text(), tf()])); q = [x['id'] for x in r['questions']]
    t = start(d, w.a, w.here[0]); answer(d, t, q[0], 'Alpha answer'); send(d, t)
    s = sums(d)
    # Teacher B, with A's ids, through every function.
    calls = {'list_quiz': lambda: listed(w, w.a, B), 'save_quiz': lambda: save(w, w.a, quiz([tf()]), B),
             'save_quiz (remove)': lambda: save(w, w.a, None, B), 'list_quiz_tries': lambda: tries(w, w.a, B),
             'mark_quiz_answer': lambda: mark(w, t, q[0], 1, 'B', B), 'reopen_quiz': lambda: reopen(w, w.a, w.here[0], B),
             'reopen_quiz (B\'s piece, A\'s student)': lambda: reopen(w, w.ab, w.here[0], B),
             'confirm_quiz': lambda: confirm(w, w.a, [{'attempt_id': t, 'marked': None}], B),
             'confirm_quiz (B\'s piece, A\'s try)': lambda: confirm(w, w.ab, [{'attempt_id': t, 'marked': None}], B)}
    for name, fn in calls.items():
        x = refusal(fn); ok("others: Teacher B on A's rows, %s, is not found" % name, x == ('P0002', 'not found'), x)
    ok("others: none of it changed a row", sums(d) == s)
    ok("others: B reads B's own quiz and not A's", 'Alpha' not in json.dumps([listed(w, w.ab, B), tries(w, w.ab, B)]) and listed(w, w.ab, B)['questions'])
    x = refusal(lambda: listed(w, w.trash_a)); ok('others: a piece of a class in the trash is not found', x == ('P0002', 'not found'), x)
    x = refusal(lambda: save(w, w.trash_a, quiz([tf()]))); ok('others: no quiz is saved on a piece in the trash', x == ('P0002', 'not found'), x)
    x = refusal(lambda: listed(w, nid())); ok('others: an id that does not exist is not found', x == ('P0002', 'not found'), x)
    kw = dict(a=w.a, t=t, q=q[0], e=w.here[0])
    for name, call in TEACHER_FNS.items():
        x = refusal(lambda: d.role('authenticated', 'select ' + call, uid='', **kw)); ok('others: signed out, %s is PT401' % name, x and x[0] == 'PT401', x)
        x = refusal(lambda: d.role('anon', 'select ' + call, **kw)); ok('others: a visitor may not run %s' % name, x and x[0] == '42501', x)
        x = refusal(lambda: d.role('service_role', 'select ' + call, **kw)); ok("others: the edge functions' role may not run %s" % name, x and x[0] == '42501', x)
    for tbl in TABLES:
        for role in ('anon', 'authenticated', 'service_role'):
            uid = A if role == 'authenticated' else None
            for verb, sql in (('read', 'select count(*) from %s' % tbl), ('insert into', 'insert into %s default values' % tbl),
                              ('change', 'update %s set created_at = created_at' % tbl if tbl in ('public.quiz', 'public.quiz_question', 'public.quiz_attempt') else 'update %s set why = why' % tbl if tbl == 'public.quiz_key' else 'update %s set note = note' % tbl),
                              ('delete from', 'delete from %s' % tbl)):
                x = refusal(lambda: d.role(role, sql, uid=uid)); ok('others: %s cannot %s %s' % (role, verb, tbl), x and x[0] == '42501', x)
    for sig in PRIVATE:
        for role in ('anon', 'authenticated', 'service_role'):
            ok('others: %s cannot call %s' % (role, sig), d.one("select has_function_privilege(:r, :s, 'execute')", r=role, s=sig) is False)
    ok('others: no function of the student page names quiz_key', d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                                       where n.nspname = 'student_submit' and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like '%quiz_key%'""") == 0)
    ok('others: no function of the student page names any quiz table yet (MQ2 is not built)', d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                                       where n.nspname = 'student_submit' and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) ~ '\\mquiz'""") == 0)
    ok('others: only list_quiz and save_quiz name quiz_key (with the helper and the undo-free definitions)',
       sorted(x[0] for x in d.all("select p.oid::regprocedure::text from pg_proc p where (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like '%quiz_key%' and p.prokind = 'f'")) == ['fv_private.quiz_json(uuid)', 'save_quiz(uuid,jsonb,uuid)'],
       d.all("select p.oid::regprocedure::text from pg_proc p where (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like '%quiz_key%' and p.prokind = 'f'"))
    d.close()

def scen_cascade():
    w = world('cascade'); d = w.d
    r = save(w, w.a, quiz([choice(tag=w.t[0]), tf(tag=w.t[1]), text(tag=w.t[1])])); q = [x['id'] for x in r['questions']]
    r2 = save(w, w.a2, quiz([tf(tag=w.t[0])]))
    for e in w.here: t = start(d, w.a, e); answer(d, t, q[1], True); send(d, t)
    t2 = start(d, w.a2, w.here[0]); answer(d, t2, r2['questions'][0]['id'], False)
    tags = lambda a=w.a: [x['tag_id'] for x in listed(w, a)['questions']]
    # The form's delete-and-insert of the same competencies changes nothing.
    T(d, 'update_assessment(:a, :p::jsonb, cast(:g as uuid[]))', a=w.a, p=json.dumps({'title': 'Food Webs Quiz'}), g=w.t[:2])
    ok('cascade: the form saving the same competencies changes no question', tags() == [w.t[0], w.t[1], w.t[1]], tags())
    d.run('begin'); d.run('delete from assessment_tag where assessment_id = :a', a=w.a)
    d.run('insert into assessment_tag (assessment_id, tag_id) values (:a, :t), (:a, :u)', a=w.a, t=w.t[0], u=w.t[1]); d.run('commit')
    ok('cascade: delete and insert in one transaction changes nothing', tags() == [w.t[0], w.t[1], w.t[1]], tags())
    T(d, 'save_assessment_tags(:a, cast(:g as uuid[]))', a=w.a, g=[w.t[0]])
    ok('cascade: a competency taken off the piece is taken off its questions at commit', tags() == [w.t[0], None, None], tags())
    ok('cascade: the questions stay', len(listed(w, w.a)['questions']) == 3)
    ok('cascade: another piece keeps that competency', tags(w.a2) == [w.t[0]])
    T(d, 'delete_tag(:t)', t=w.t[0])
    ok('cascade: a competency deleted is taken off every question', tags() == [None, None, None] and tags(w.a2) == [None], (tags(), tags(w.a2)))
    x = refusal(lambda: d.run('insert into quiz_attempt (assessment_id, enrollment_id, try) values (:a, :e, 9)', a=w.a, e=w.eb))
    ok("cascade: a try for a student of another class is refused by the table (23514)", x and x[0] == '23514', x)
    x = refusal(lambda: d.run("insert into quiz_answer (attempt_id, question_id, assessment_id, answer) values (:t, :q, :a, 'true')", t=t2, q=q[0], a=w.a2))
    ok("cascade: an answer to another quiz's question is refused by the table (23503)", x and x[0] == '23503', x)
    # A withdrawn student deleted for good.
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone)
    tg = start(d, w.a, w.gone); answer(d, tg, q[1], False); send(d, tg)
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    T(d, 'delete_withdrawn_student(:e, gen_random_uuid())', e=w.gone)
    ok('cascade: a student deleted for good takes their tries and answers', d.one('select count(*) from quiz_attempt where enrollment_id = :e', e=w.gone) == 0
       and d.one('select count(*) from quiz_answer where attempt_id = :t', t=tg) == 0)
    ok('cascade: the others stay', d.one('select count(*) from quiz_attempt where assessment_id = :a', a=w.a) == 3)
    # An assessment deleted.
    T(d, 'delete_assessment(:a)', a=w.a)
    ok('cascade: an assessment deleted takes its quiz, questions, key, tries and answers',
       all(d.one('select count(*) from %s where %s' % (t, c), a=w.a, q=q) == 0 for t, c in
           (('quiz', 'assessment_id = :a'), ('quiz_question', 'assessment_id = :a'), ('quiz_key', 'question_id = any(cast(:q as uuid[]))'),
            ('quiz_attempt', 'assessment_id = :a'), ('quiz_answer', 'assessment_id = :a'))))
    ok('cascade: the other quiz stays', d.one('select count(*) from quiz_answer where assessment_id = :a', a=w.a2) == 1)
    # A class purged.
    d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c)
    d.run('select public.fv_retention_cleanup()')
    ok("cascade: a class purged takes everything of its quizzes", d.one('select count(*) from course where id = :c', c=w.c) == 0
       and all(d.one('select count(*) from %s' % t) == {'public.quiz': 1, 'public.quiz_question': 2, 'public.quiz_key': 2, 'public.quiz_attempt': 1, 'public.quiz_answer': 1}[t] for t in TABLES),
       {t: d.one('select count(*) from %s' % t) for t in TABLES})
    ok("cascade: Teacher B's quiz is all that is left", d.one('select assessment_id::text from quiz') == w.ab)
    d.close()

def scen_race():
    w = world('race'); d = w.d
    out = {}
    def call(name, sql, uid=A, **kw):
        c = Conn(d); c.as_teacher(uid)
        try: out[name] = c.run(sql, **kw)[0][0]
        except Exception as e: out[name] = ('ERROR', sqlstate(e), message(e))
        c.close()
    # One key twice, in order.
    key = nid(); payload = quiz([tf(), choice()])
    a1 = save(w, w.a, payload, key=key); a2 = save(w, w.a, quiz([text()]), key=key)
    ok('race: the same key again answers the first reply', a1 == a2)
    ok('race: and writes nothing', len(listed(w, w.a)['questions']) == 2)
    # One key from two connections at once.
    for rnd in range(3):
        key = nid(); out.clear(); qn = quiz([tf('Round %d' % rnd), text()])
        gate = Conn(d); gate.run('begin'); gate.run('select pg_advisory_xact_lock(hashtext(:u), hashtext(:k))', u=A, k=key)
        ts = [threading.Thread(target=call, args=(n, 'select save_quiz(:a, cast(:q as jsonb), :k)'), kwargs={'a': w.a2, 'q': json.dumps(qn), 'k': key}) for n in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5)
        ok('race %d: both saves with one key wait behind its lock' % rnd, out == {}, out)
        gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: one key from two connections saves once and both get one reply' % rnd, isinstance(out.get('one'), dict) and out['one'] == out.get('two')
           and d.one('select count(*) from quiz_question where assessment_id = :a', a=w.a2) == 2, out)
    for rnd in range(3):
        key = nid(); out.clear(); e = w.here[rnd]
        gate = Conn(d); gate.run('begin'); gate.run('select pg_advisory_xact_lock(hashtext(:u), hashtext(:k))', u=A, k=key)
        ts = [threading.Thread(target=call, args=(n, 'select reopen_quiz(:a, :e, :k)'), kwargs={'a': w.a, 'e': e, 'k': key}) for n in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5); gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: one reopen key from two connections makes one try' % rnd, isinstance(out.get('one'), dict) and out['one'] == out.get('two')
           and d.one('select count(*) from quiz_attempt where assessment_id = :a and enrollment_id = :e', a=w.a, e=e) == 1, out)
    # Two reopens without a key, at once: the student's lock gives one try between them.
    d.run('delete from quiz_attempt where assessment_id = :a', a=w.a)
    for rnd in range(3):
        out.clear(); e = w.here[0]; n0 = d.one('select count(*) from quiz_attempt where enrollment_id = :e', e=e)
        gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(:s))", s=w.a + ':' + e)
        ts = [threading.Thread(target=call, args=(n, 'select reopen_quiz(:a, :e, null)'), kwargs={'a': w.a, 'e': e}) for n in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5); gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: two reopens at once: one new try, the other answered it' % rnd, isinstance(out.get('one'), dict) and isinstance(out.get('two'), dict)
           and sorted([out['one']['made'], out['two']['made']]) == [False, True] and d.one('select count(*) from quiz_attempt where enrollment_id = :e', e=e) == n0 + 1, out)
        d.run("update quiz_attempt set question_order = '{}', started_at = now(), sent_at = now() where enrollment_id = :e and sent_at is null", e=e)
    # A student's save holds the quiz (MQ2's lock) while the teacher removes that question: archived, not deleted.
    r = listed(w, w.a); qid = r['questions'][0]['id']; t = start(d, w.a, w.here[1])
    s = Conn(d); s.run('begin'); s.run('select 1 from quiz where assessment_id = :a for key share', a=w.a)
    s.run("insert into quiz_answer (attempt_id, question_id, assessment_id, answer) values (:t, :q, :a, 'true')", t=t, q=qid, a=w.a)
    out.clear(); p = from_reply(r); p['questions'] = p['questions'][1:]
    th = threading.Thread(target=call, args=('save', 'select save_quiz(:a, cast(:q as jsonb), null)'), kwargs={'a': w.a, 'q': json.dumps(p)}); th.start(); time.sleep(0.5)
    ok("race: the teacher's save waits for the student's save", out == {}, out)
    s.run('commit'); s.close(); th.join()
    ok('race: then the question is archived, the answer kept', isinstance(out.get('save'), dict) and [x['id'] for x in out['save']['archived']] == [qid]
       and d.one('select count(*) from quiz_answer where question_id = :q', q=qid) == 1, out)
    # A delete racing a save, both orders: no deadlock, nothing left half made.
    for rnd in range(2):
        a = str(T(d, "create_assessment(:c, :t, p_tag_ids => cast(:g as uuid[]))", c=w.c, t='Race %d' % rnd, g=w.t[:1]))
        save(w, a, quiz([tf(), text()]))
        first, second = (('save', 'delete') if rnd == 0 else ('delete', 'save'))
        h = Conn(d); h.as_teacher(); h.run('begin')
        if first == 'save': h.run('select save_quiz(:a, cast(:q as jsonb), null)', a=a, q=json.dumps(quiz([tf(), choice(), text()])))
        else: h.run('select delete_assessment(:a)', a=a)
        out.clear()
        sql = 'select delete_assessment(:a)' if second == 'delete' else 'select save_quiz(:a, cast(:q as jsonb), null)'
        th = threading.Thread(target=call, args=(second, sql), kwargs={'a': a, 'q': json.dumps(quiz([tf()]))}); th.start(); time.sleep(0.5)
        ok('race: a %s waits for a %s in progress' % (second, first), out == {}, out)
        h.run('commit'); h.close(); th.join()
        res = out.get(second)
        ok('race: then the %s finishes without a deadlock (%s)' % (second, 'gone' if second == 'save' else 'deleted'),
           (res == ('ERROR', 'P0002', 'not found')) if second == 'save' else not (isinstance(res, tuple) and res[0] == 'ERROR'), res)
        ok('race: and no quiz row of that piece is left', all(d.one('select count(*) from %s where assessment_id = :a' % t, a=a) == 0 for t in TABLES if t != 'public.quiz_key'))
    d.close()

def catalog_of(d): return catalog(d.c)
def norm(lines):
    def acl(m): return '{' + ','.join(sorted(m.group(1).split(','))) + '}'
    return [re.sub(r'pg_attver=\d+', 'pg_attver=N', re.sub(r'\{([^{}]*=[^{}]*)\}', acl, l)) for l in lines]
def same(a, b): return norm(a) == norm(b)
# What the files may change in the catalog: their own tables, functions and triggers, and the counts that follow
# (the keys' internal triggers on assessment and enrollment, the comments, the dependency counts).
EXPECTED = re.compile(r'quiz|^comments on pg_(class|proc) \||^depends |pg_depend|^internal triggers (assessment|enrollment) \|')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog_of(d); s0 = sums(d)
    new1, relied1 = header_md5s(H1); new2, relied2 = header_md5s(H2)
    ok('apply: the first header names its seven new functions and three relied on', len(new1) == 7 and sorted(relied1) == ['public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)', 'public.fv_owns_assessment(uuid)'], (new1, relied1))
    ok('apply: the second names its three and four relied on', len(new2) == 3 and len(relied2) == 4 and relied2['public._quiz_attempt_same_class()'] == new1['public._quiz_attempt_same_class()'], (new2, relied2))
    ok("apply: the relied-on functions are the headers' on this database", all(md5(d, s) == relied1[s] for s in relied1), {s: md5(d, s) for s in relied1})
    pre = split(text_of(PRE))
    ok('apply: the pre-check returns no rows before', d.statements(pre) == 'ok' and d.rows == [], d.rows)
    r = d.file(FILE2)
    ok('apply guard: the second file before the first stops', r.startswith('STOPPED') and '_quiz_attempt_same_class' in r and catalog_of(d) == base, r)
    def guard(name, setup, undo, expect, f=FILE, precheck=True):
        d.run(setup); before = catalog_of(d)
        r = d.file(f)
        ok('apply guard: %s stops the file' % name, r.startswith('STOPPED') and expect in r, r)
        ok('apply guard: %s leaves the catalog as it was' % name, catalog_of(d) == before, differences(before, catalog_of(d)))
        if precheck: ok('apply guard: %s is named by the pre-check' % name, d.statements(pre) == 'ok' and d.rows != [], d.rows)
        d.run(undo)
    for sig in relied1:
        name = sig.split('(')[0]
        d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % sig)
        guard('a changed %s' % name, "do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed'); end $$" if 'idem' in sig
              else "do $$ begin execute replace((select def from kept), 'select exists', 'select  exists'); end $$",
              "do $$ begin execute (select def from kept); end $$", 'is not the definition this file was written against')
        d.run('drop table kept')
        ok('apply: %s is back as it was' % name, md5(d, sig) == relied1[sig])
    guard('a list_quiz with other arguments', 'create function public.list_quiz(text) returns int language sql as $$ select 1 $$',
          'drop function public.list_quiz(text)', 'other arguments or in another schema')
    guard('a save_quiz in another schema', 'create function fv_private.save_quiz(uuid, jsonb, uuid) returns int language sql as $$ select 1 $$',
          'drop function fv_private.save_quiz(uuid, jsonb, uuid)', 'other arguments or in another schema')
    guard("a list_quiz_tries that is not this file's", 'create function public.list_quiz_tries(uuid) returns jsonb language sql as $$ select null::jsonb $$',
          'drop function public.list_quiz_tries(uuid)', 'is not the definition this file was written against')
    guard("a quiz table that is not this file's", 'create table public.quiz (assessment_id uuid)', 'drop table public.quiz', 'exists and is not this file')
    guard("a quiz_answer table that is not this file's", 'create table public.quiz_answer (attempt_id uuid, answer text)', 'drop table public.quiz_answer', 'exists and is not this file')
    guard("a trigger named assessment_quiz_draft_guard that is not this file's",
          "create function pg_temp.t() returns trigger language plpgsql as $$ begin return new; end $$; create trigger assessment_quiz_draft_guard before update on public.assessment for each row execute function pg_temp.t()",
          'drop trigger assessment_quiz_draft_guard on public.assessment; drop function pg_temp.t()', 'is not this file')
    ok('apply: after the guards the catalog is the one before', catalog_of(d) == base, differences(base, catalog_of(d)))
    # Lock timeout: a transaction holding assessment makes the file give up, nothing applied.
    hold = Conn(d); hold.run('begin'); hold.run('lock table public.assessment in access exclusive mode')
    t0 = time.time(); r = d.file(FILE); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('apply: a held lock makes the file give up after about five seconds', r.startswith('STOPPED') and 'lock timeout' in r and 4 < took < 12, (r, took))
    ok('apply: and nothing was applied', catalog_of(d) == base, differences(base, catalog_of(d)))
    # The apply.
    r = d.file(FILE); ok('apply: the first file applies', r == 'ok', r)
    pre2 = split(text_of(PRE2))
    ok('apply: the second pre-check returns no rows between the files', d.statements(pre2) == 'ok' and d.rows == [], d.rows)
    mid = catalog_of(d)
    d.run('create function public.confirm_quiz(uuid) returns int language sql as $$ select 1 $$')
    r = d.file(FILE2); ok('apply guard: a confirm_quiz with other arguments stops the second file', r.startswith('STOPPED') and 'other arguments' in r, r)
    ok('apply guard: and it is named by the second pre-check', d.statements(pre2) == 'ok' and d.rows != [], d.rows)
    d.run('drop function public.confirm_quiz(uuid)')
    ok('apply guard: the second file stopping left the catalog as it was', catalog_of(d) == mid, differences(mid, catalog_of(d)))
    r = d.file(FILE2); ok('apply: the second file applies', r == 'ok', r)
    after = catalog_of(d); gone, came = differences(base, after)
    ok('apply: the catalog changes only in what the headers name', all(EXPECTED.search(l) for l in gone + came), [l for l in gone + came if not EXPECTED.search(l)][:8])
    ok('apply: nothing that existed is dropped or changed but counts', all(re.match(r'(depends |internal triggers |comments on )', l) for l in gone),
       [l for l in gone if not re.match(r'(depends |internal triggers |comments on )', l)])
    it = lambda ls, t: [l for l in ls if l.startswith('internal triggers %s |' % t)]
    ok("apply: the keys add two internal triggers each to assessment and enrollment, none to another existing table",
       all(len(it(gone, t)) == 1 and len(it(came, t)) == 1 and int(it(came, t)[0].split('|')[1]) == int(it(gone, t)[0].split('|')[1]) + 2 for t in ('assessment', 'enrollment'))
       and not [l for l in gone if l.startswith('internal triggers') and not re.match(r'internal triggers (assessment|enrollment) \|', l)], (gone, came))
    ok('apply: the two triggers on existing tables are there',
       any('assessment_quiz_draft_guard' in l for l in came) and any('quiz_tag_gone' in l for l in came), [l for l in came if 'trigger' in l][:6])
    ok('apply: no existing row changed', {k: v for k, v in sums(d).items() if k not in TABLES} == s0)
    ok('apply: the tables start empty', all(d.one('select count(*) from %s' % t) == 0 for t in TABLES))
    ok("apply: the new functions are the headers'", all(md5(d, s) == v for s, v in list(new1.items()) + list(new2.items())),
       {s: md5(d, s) for s in list(new1) + list(new2)})
    for f in (POST, POST2):
        r = d.statements(split(text_of(f)))
        ok('apply: %s says ok on every row' % f, r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    ok('apply: the pre-check now names what is there', d.statements(pre) == 'ok' and len(d.rows) >= 18, d.rows)
    save(w, w.a, quiz([tf(), text()])); t = start(d, w.a, w.here[0]); kept = quiz_rows(d)
    r = d.file(FILE); r2 = d.file(FILE2); ok('apply: a second run of each is ok', r == 'ok' and r2 == 'ok', (r, r2))
    ok('apply: a second run changes nothing', same(catalog_of(d), after) and quiz_rows(d) == kept, differences(norm(after), norm(catalog_of(d))))
    for f, n in ((FILE, 1), (FILE2, 2)):
        size = os.path.getsize(os.path.join(HERE, f))
        ok('apply: file %d is under 40 KB, to go whole through apply_migration (%d bytes)' % (n, size), size < 40960, size)
    ok('apply: the headers say not applied and name the tests and undo', 'NOT APPLIED' in H1 and 'NOT APPLIED' in H2 and 'quizzes.py' in H1
       and 'quizzes-undo.sql' in H1 and 'quiz-results-undo.sql' in H2)
    d.close()

def scen_missing():
    w = world('missing', with_file=False); d = w.d
    d.run('drop function public.fv_idem_store(uuid, text, jsonb)')
    before = catalog_of(d)
    r = d.file(FILE)
    ok('apply guard: a missing fv_idem_store stops the file', r.startswith('STOPPED') and 'none: the function is missing' in r, r)
    ok('apply guard: a missing fv_idem_store leaves the catalog as it was', catalog_of(d) == before, differences(before, catalog_of(d)))
    ok('apply guard: a missing fv_idem_store is named by the pre-check', d.statements(split(text_of(PRE))) == 'ok'
       and ['fingerprint public.fv_idem_store(uuid,text,jsonb)', 'absent'] in d.rows, d.rows)
    d.close()

def scen_defaults():
    w = world('defaults', with_file=False); d = w.d
    for s in ('public', 'fv_private'):
        d.run('alter default privileges in schema %s grant all on tables to anon, authenticated, service_role' % s)
        d.run('alter default privileges in schema %s grant all on functions to anon, authenticated, service_role' % s)
    for f in (FILE, FILE2):
        r = d.file(f); ok('defaults: %s applies' % f, r == 'ok', r)
    for f in (POST, POST2):
        r = d.statements(split(text_of(f)))
        ok('defaults: %s says ok on every row' % f, r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    x = refusal(lambda: d.role('anon', 'select list_quiz(:a)', a=w.a)); ok('defaults: a visitor still may not run list_quiz', x and x[0] == '42501', x)
    x = refusal(lambda: d.role('service_role', 'select confirm_quiz(:a, null, null)', a=w.a)); ok("defaults: the edge functions' role still may not run confirm_quiz", x and x[0] == '42501', x)
    x = refusal(lambda: d.role('authenticated', 'select count(*) from public.quiz_key', uid=A)); ok('defaults: a teacher still cannot read the key', x and x[0] == '42501', x)
    x = refusal(lambda: d.role('authenticated', 'select fv_private.quiz_json(:a)', uid=A, a=w.a)); ok('defaults: a teacher still cannot call the helper', x and x[0] == '42501', x)
    d.close()

def scen_undo():
    w = world('undo', with_file=False); d = w.d
    base = catalog_of(d); s0 = sums(d)
    for f in (UNDO2, UNDO):
        r = d.file(f); ok('undo: %s on a database without the files is ok' % f, r == 'ok', r)
    ok('undo: and changes nothing', catalog_of(d) == base, differences(base, catalog_of(d)))
    for f in (FILE, FILE2): d.file(f)
    withfile = catalog_of(d)
    save(w, w.a, quiz([tf(), text()])); t = start(d, w.a, w.here[0]); send(d, t); kept = quiz_rows(d)
    # PART 1 of each: the stop.
    for f in (UNDO2, UNDO):
        r = d.statements(split(part1(f))); ok('undo PART 1 of %s: runs' % f, r == 'ok', r)
    for name, call in TEACHER_FNS.items():
        x = refusal(lambda: d.role('authenticated', 'select ' + call, uid=A, a=w.a, t=t, q=nid(), e=w.here[0]))
        ok('undo PART 1: a teacher can no longer run %s' % name, x and x[0] == '42501', x)
    ok('undo PART 1: every quiz row is kept', quiz_rows(d) == kept)
    gone, came = differences(withfile, catalog_of(d))
    ok('undo PART 1: only the six grants changed', all('quiz' in l for l in gone + came) and len(gone) == 6, (gone, came))
    x = refusal(lambda: unassign(w, w.a)); ok('undo PART 1: the Unassign guard still holds', x == ('P0001', 'draft_has_work'), x)
    r = d.statements(split(part1(UNDO))); ok('undo PART 1: a second run is ok', r == 'ok', r)
    for f in (FILE, FILE2): d.file(f)
    ok('undo: the files again give the functions back', same(catalog_of(d), withfile), differences(norm(withfile), norm(catalog_of(d))))
    # The full removal of the first file refuses while 2026111803 is there, and while a quiz exists.
    r = d.file(UNDO); ok('undo: the full removal stops while the results functions are there', r.startswith('STOPPED') and 'quiz-results-undo.sql first' in r, r)
    ok('undo: and keeps everything', quiz_rows(d) == kept and md5(d, 'public.save_quiz(uuid,jsonb,uuid)'))
    d.run("grant execute on function public.list_quiz(uuid), public.save_quiz(uuid, jsonb, uuid), public.list_quiz_tries(uuid) to authenticated")
    # A changed function stops the results' removal.
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('public.confirm_quiz(uuid,jsonb,uuid)')) as def")
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.file(UNDO2); ok('undo: a results function changed since stops its removal', r.startswith('STOPPED') and 'is not the definition 2026111803 left' in r, r)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    r = d.file(UNDO2); ok('undo: the results removal runs', r == 'ok' and md5(d, 'public.confirm_quiz(uuid,jsonb,uuid)') is None, r)
    ok('undo: and deletes no row', quiz_rows(d) == kept)
    r = d.file(UNDO); ok('undo: the full removal stops while a quiz exists', r.startswith('STOPPED') and 'There are 1 quizzes' in r, r)
    ok('undo: and keeps every row', quiz_rows(d) == kept)
    d.run("grant execute on function public.list_quiz(uuid), public.save_quiz(uuid, jsonb, uuid), public.list_quiz_tries(uuid) to authenticated")
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('public.list_quiz(uuid)')) as def")
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    d.run('delete from quiz')
    r = d.file(UNDO); ok('undo: a function changed since stops the full removal', r.startswith('STOPPED') and 'is not the definition 2026111802 left' in r, r)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    r = d.file(UNDO); ok('undo: the full removal runs once no quiz is there', r == 'ok', r)
    ok('undo: the catalog is as before the files', catalog_of(d) == base, differences(base, catalog_of(d)))
    ok('undo: every other row is as before', sums(d) == s0)
    r = d.file(UNDO); ok('undo: a second run is ok and changes nothing', r == 'ok' and catalog_of(d) == base, r)
    for f in (FILE, FILE2): r = d.file(f); ok('undo: %s applies again' % f, r == 'ok', r)
    ok('undo: and the catalog is as with the files', same(catalog_of(d), withfile), differences(norm(withfile), norm(catalog_of(d))))
    d.close()

SCENARIOS = {'save': scen_save, 'list': scen_list, 'tries': scen_tries, 'mark': scen_mark, 'reopen': scen_reopen, 'confirm': scen_confirm,
             'draft': scen_draft, 'others': scen_others, 'cascade': scen_cascade, 'race': scen_race, 'missing': scen_missing,
             'defaults': scen_defaults, 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
