"""Reflections from the card, and reflections a teacher builds:
migrations/2026111620_reflect_from_the_card.sql, applied after Slips Keyed
(2026111160), on the database slips_keyed.py's harness builds.

    PGDATABASE=rc python3 batch_c_common.py build           an EMPTY database: live with Batch B and its fixes
    PGDATABASE=rc python3 reflect_from_card.py              every scenario below
    PGDATABASE=rc python3 reflect_from_card.py listed ...   or some
    PGDATABASE=rc python3 reflect_from_card.py fingerprints [check]   write (or check) the lists the four files carry

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  live       the two functions the file patches, and the four that call them, are on this stand-in the ones
             gradebook-prod has (md5s read from live, read-only, on 2026-11-16; the other functions relied on
             are compared with live by the pre-check)
  listed     the fault, before the file: a questionnaire that is on, with no slip, is not on the card. After:
             it is, for every student of the class; off, closed, not open yet, answered; form and answer from a
             card with no slip; another class, another student's session, a withdrawn student; a slip still
             opens and sends, and a card answer still uses up a slip
  custom     a teacher saves a reflection of their own with every kind of question (refused before the file);
             another teacher cannot; a student answers it from the card and each answer is kept as the contract
             says
  answers    _clean_answer, kind by kind: what it takes, what it refuses, what it keeps
  same       every old kind's answers come out of _clean_answer exactly as before the file, refusals included
  apply      every guard; a database in use; what changes and what does not; a second run; the pre-check and
             post-check
  undo       the undo puts both functions and both checks back; with a teacher's reflection in place it keeps
             the checks wide and deletes nothing; the file applies again
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_c_common import *
import batch_c_common as bc
import card_codes_common as cc
import slips_keyed as sk
from slips_keyed import SDb, questionnaire, text_q, write_lists
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111620_reflect_from_the_card.sql'
UNDO = 'reflect-from-card-undo.sql'
PRE = 'reflect-from-card-live-precheck.sql'
POST = 'reflect-from-card-live-postcheck.sql'
LIST_FILES = [FILE, UNDO, PRE, POST]

PATCHED = ['student_submit._card_listed(uuid,uuid)', 'student_submit._clean_answer(text,jsonb,text[],jsonb)']
RELIED = ['student_submit.forms(text,uuid,text)', 'student_submit.form(text,uuid,uuid,text)',
          'student_submit.answer(text,uuid,uuid,jsonb,text)', 'student_submit.submit(text,jsonb,text)',
          'student_submit._closed_reason(questionnaire,text)', 'student_submit._session_class(text,uuid)',
          'student_submit._send_session(text,uuid)', 'student_submit._card_refusal(uuid)', 'student_submit._part(uuid)']
# md5(pg_get_functiondef(...)) on gradebook-prod, read-only, 2026-11-16 (PostgreSQL 17.6).
LIVE = {'student_submit._card_listed(uuid,uuid)': 'a0dc2d9e540be764da89a98e83751260',
        'student_submit._clean_answer(text,jsonb,text[],jsonb)': '0f8377c8b45d14bc5c1b93c04852e49d',
        'student_submit.forms(text,uuid,text)': '40ae918432795a5effbdd4cf6efead15',
        'student_submit.form(text,uuid,uuid,text)': '8a2fcc6954bd63425d9460dea9800f26',
        'student_submit.answer(text,uuid,uuid,jsonb,text)': 'd625cba1843c7b409a5cb8743c7471fd',
        'student_submit.submit(text,jsonb,text)': '90ace3c164dab19f6a77ba7dfb19e40e'}
NEW_KINDS = ['rating', 'date', 'ranking', 'likert', 'section']

LISTS = re.compile(r'(-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def neutral(text):
    """The text with every list stood aside, so it applies whatever the lists hold."""
    def row(m):
        cols = 3 if m.group(2) == 'functions' else 2
        return m.group(1) + "            ('public.no_such_function_at_all()', %s)" % ', '.join(["'absent'"] * (cols - 1)) + m.group(4)
    return LISTS.sub(row, text)
def fingerprints(d, fns):
    return {f: d.one('select md5(pg_get_functiondef(to_regprocedure(:f)))', f=f) for f in fns}

# ── the template: live as the file meets it (through Slips Keyed) ───────────
_TPL = {}
def template():
    if 'base' in _TPL: return _TPL['base']
    name = '%s_rf' % cc.BASE_DB
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, sk.template()))
    c = connect(name)
    for st in split(text_at(sk.FILE)):
        try: c.run(st)
        except Exception as e:
            c.close(); ok('Slips Keyed applies to the template', False, message(e)); finish()
    c.close(); _TPL['base'] = name
    return name
def drop_templates():
    for name in _TPL.values(): admin('drop database if exists "%s" with (force)' % name)
    sk.drop_templates()

def world(tag, with_file=True):
    """A copy of the template with Teacher A's class seeded and, unless told not to, the file applied."""
    d = SDb('rf_' + tag, template=template()); k = seed(d)
    if with_file:
        r = d.file(FILE)
        if r != 'ok':
            ok('(setup) the file applies for %s' % tag, False, r); d.close(); finish()
    return d, k

SCENARIOS = {}
def scenario(name):
    def reg(f): SCENARIOS[name] = f; return f
    return reg

def titles(f): return {x['title']: x['state'] for x in f['questionnaires']}
def card_answer(d, t, e, qid, answers): return d.svc('answer', t, e, qid, (json.dumps(answers), '::jsonb'))
def clean(d, kind, options, value, core=None):
    """_clean_answer as the owner: its answer, or 'invalid' when it raises."""
    try:
        return d.one("select student_submit._clean_answer(:k, :o::jsonb, :c::text[], :v::jsonb)", k=kind, o=json.dumps(options),
                     c='{%s}' % ','.join(core or []), v=json.dumps(value))
    except Exception:
        return 'invalid'   # submit and answer turn any raise from it into `invalid`

CUSTOM_QS = [
    {'prompt': 'What is one thing you understand better?', 'kind': 'text', 'options': {'required': True}},
    {'prompt': 'How confident are you?', 'kind': 'rating', 'options': {'levels': 5, 'low': 'Not Yet', 'high': 'Could Teach It'}},
    {'prompt': 'Which helped most?', 'kind': 'choice', 'options': {'choices': ['Labs', 'Notes'], 'multiple': False, 'other': True}},
    {'prompt': 'When did you finish?', 'kind': 'date', 'options': {}},
    {'prompt': 'Put these in order.', 'kind': 'ranking', 'options': {'choices': ['Labs', 'Notes', 'Practice']}},
    {'prompt': 'How often?', 'kind': 'likert', 'options': {'statements': ['I asked', 'I checked'], 'choices': ['Never', 'Sometimes', 'Always']}},
    {'prompt': 'Looking Ahead', 'kind': 'section', 'options': {'subtitle': 'Two more.'}},
]
def custom(d, title='Unit 2 Exit Reflection', uid=A, course=COURSE_A, on=True):
    return d.rpc("upsert_questionnaire(:c, 'custom', :t, p_theme => 'A few questions.', p_is_on => :on, p_questions => :q::jsonb, "
                 "p_idempotency_key => :k)", uid, c=course, t=title, on=on, q=json.dumps(CUSTOM_QS), k=nid())
def qid_of(q, kind): return [x['id'] for x in q['questions'] if x['kind'] == kind][0]

# ── live ────────────────────────────────────────────────────────────────────
@scenario('live')
def scen_live():
    d = SDb('rf_live', template=template())
    try:
        got = fingerprints(d, list(LIVE))
        for f, want in LIVE.items():
            ok('as gradebook-prod has it: %s' % f, got[f] == want, (got[f], want))
        ok('this is PostgreSQL 17', d.one("select current_setting('server_version_num')::int / 10000") == 17)
    finally:
        d.close()

# ── listed ──────────────────────────────────────────────────────────────────
@scenario('listed')
def scen_listed():
    # The fault, before the file.
    d, k = world('listed0', with_file=False)
    try:
        t1 = d.session(ENR1)
        q = questionnaire(d)
        ok('BEFORE the file (the fault): a questionnaire that is on, with no slip, is not on the card',
           titles(d.svc('forms', t1, ENR1)) == {}, d.svc('forms', t1, ENR1))
        ok('...and cannot be opened from it', d.svc('form', t1, ENR1, q['id']) == {'ok': False, 'error': 'not_found'})
    finally:
        d.close()
    d, k = world('listed')
    try:
        t1 = d.session(ENR1); t2 = d.session(ENR2, birthday='2012-06-16')
        q_on = questionnaire(d)
        q_off = questionnaire(d, title='Turned Off'); d.rpc('set_questionnaire_on(:q, false, :k)', q=q_off['id'], k=nid())
        q_soon = questionnaire(d, title='March Reflection', opens=30, closes=40)
        q_gone = questionnaire(d, title='Gone By', opens=-20, closes=-10)
        q_open = d.rpc("upsert_questionnaire(:c, 'about_me', 'No Dates', 'about-me', p_idempotency_key => :k)", c=COURSE_A, k=nid())
        q_b = d.rpc("upsert_questionnaire(:c, 'about_me', 'Theirs', 'about-me', p_idempotency_key => :k)", B, c=COURSE_B, k=nid())
        ok('no slip was printed for anyone', d.one('select count(*) from student_access_code') == 0)
        want = {'November Reflection': 'open', 'March Reflection': 'not_open_yet', 'No Dates': 'open'}
        f1 = d.svc('forms', t1, ENR1)
        ok('forms: every questionnaire of her class that is on and open or not open yet; not one off, not one closed, '
           'not another class\'s', titles(f1) == want, f1)
        ok('forms: the same for the other student of the class', titles(d.svc('forms', t2, ENR2)) == want)
        ok('forms: each with the fields the tab reads, and nothing else',
           all(set(x) == {'id', 'title', 'description', 'minutes', 'state', 'opens_on', 'closes_on', 'sent_at'} for x in f1['questionnaires']), f1)
        ok('forms: another student\'s session for her enrollment is not_found', d.svc('forms', t2, ENR1) == {'ok': False, 'error': 'not_found'})
        fm = d.svc('form', t1, ENR1, q_on['id'])
        ok('form: opens with no slip, the questionnaire\'s parts', fm.get('ok') and fm['parts'][0]['id'] == q_on['id'], fm)
        for label, qid, want_err in [('one turned off', q_off['id'], 'closed'), ('not yet open', q_soon['id'], 'not_open_yet'),
                                     ('past its date', q_gone['id'], 'closed'), ('another class\'s', q_b['id'], 'not_found'),
                                     ('one that does not exist', nid(), 'not_found')]:
            r = d.svc('form', t1, ENR1, qid)
            ok('form: %s is %s' % (label, want_err), r.get('error') == want_err, r)
            r = card_answer(d, t1, ENR1, qid, {nid(): 'x'})
            ok('answer: %s is %s' % (label, want_err), r.get('error') == want_err, r)
        r = card_answer(d, t1, ENR1, q_on['id'], {text_q(q_on): 'From my card, no slip.'})
        ok('answer: taken with no slip', r.get('ok') is True, r)
        ok('...one response, from her', d.all('select enrollment_id::text from response where questionnaire_id = :q', q=q_on['id']) == [[ENR1]])
        ok('answer: a second one is already_sent', card_answer(d, t1, ENR1, q_on['id'], {text_q(q_on): 'Again.'}) == {'ok': False, 'error': 'already_sent'})
        ok('forms: hers now reads sent; his still open',
           titles(d.svc('forms', t1, ENR1))['November Reflection'] == 'sent' and titles(d.svc('forms', t2, ENR2))['November Reflection'] == 'open')
        d.rpc('set_questionnaire_on(:q, false, :k)', q=q_on['id'], k=nid())
        ok('turned off: it leaves his list, and stays on hers as sent',
           'November Reflection' not in titles(d.svc('forms', t2, ENR2)) and titles(d.svc('forms', t1, ENR1))['November Reflection'] == 'sent')
        d.rpc('set_questionnaire_on(:q, true, :k)', q=q_on['id'], k=nid())
        ok('turned on again: back on his list', titles(d.svc('forms', t2, ENR2)).get('November Reflection') == 'open')
        # A goal check-in rides on its reflection and is never listed by itself.
        child = d.rpc("upsert_questionnaire(:c, 'goal_checkin', 'Goal Check-In', 'goal-checkin', p_parent_id => :p, p_idempotency_key => :k)",
                      c=COURSE_A, p=q_on['id'], k=nid())
        ok('a Goal Check-In is not listed by itself, and comes as a part of its reflection',
           'Goal Check-In' not in titles(d.svc('forms', t2, ENR2))
           and [p['kind'] for p in d.svc('form', t2, ENR2, q_on['id'])['parts']] == ['core_reflection', 'goal_checkin'])
        ok('form: a Goal Check-In asked for by itself is not_found', d.svc('form', t2, ENR2, child['id']).get('error') == 'not_found')
        # Withdrawn: the session answers for the class no more.
        d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR2)
        r = d.svc('forms', t2, ENR2)
        ok('a withdrawn student\'s card lists nothing', r.get('ok') is not True, r)
        d.run('update enrollment set withdrawn_at = null where id = :e', e=ENR2)
        # Slips still work, and a card answer still uses one up.
        q5 = questionnaire(d, title='Slip And Card'); r5, made = d.issue_new('questionnaire', q5['id'])
        o = d.open_slip(made[ENR1][0])
        ok('a printed slip still opens', o.get('ok') is True, o)
        d.verify_slip(o['token'], code=made[ENR1][0], birthday='2012-05-15')
        ok('...and still sends', d.submit_slip(o['token'], {text_q(q5): 'By slip.'}).get('ok') is True)
        ok('...and the card then says already_sent', card_answer(d, t1, ENR1, q5['id'], {text_q(q5): 'x'}) == {'ok': False, 'error': 'already_sent'})
        ok('a card answer still uses up his slip for it',
           card_answer(d, t2, ENR2, q5['id'], {text_q(q5): 'By card.'}).get('ok') is True
           and d.open_slip(made[ENR2][0]) == {'ok': False, 'error': 'used'})
    finally:
        d.close()

# ── custom ──────────────────────────────────────────────────────────────────
@scenario('custom')
def scen_custom():
    d, k = world('custom0', with_file=False)
    try:
        try:
            custom(d); ok('BEFORE the file: a reflection of kind custom is refused', False, 'it was taken')
        except Exception as e:
            ok('BEFORE the file: a reflection of kind custom is refused by the check', sqlstate(e) == '23514', message(e))
    finally:
        d.close()
    d, k = world('custom')
    try:
        q = custom(d)
        ok('a teacher saves a reflection of their own, with every kind of question',
           q['kind'] == 'custom' and [x['kind'] for x in q['questions']] == [x['kind'] for x in CUSTOM_QS] and q['theme'] == 'A few questions.', q)
        try:
            custom(d, uid=B); ok('another teacher cannot save one into this class', False, 'it was taken')
        except Exception as e:
            ok('another teacher cannot save one into this class', sqlstate(e) == 'P0002', message(e))
        try:
            d.rpc("upsert_questionnaire(:c, 'survey', 'x', p_idempotency_key => :k)", c=COURSE_A, k=nid()); ok('a kind nobody named is refused', False)
        except Exception as e:
            ok('a kind nobody named is still refused', sqlstate(e) == '23514', message(e))
        try:
            d.rpc("upsert_questionnaire(:c, 'custom', 'x', p_questions => :q::jsonb, p_idempotency_key => :k)", c=COURSE_A,
                  q=json.dumps([{'prompt': 'p', 'kind': 'stars', 'options': {}}]), k=nid()); ok('a question kind nobody named is refused', False)
        except Exception as e:
            ok('a question kind nobody named is still refused', sqlstate(e) == '23514', message(e))
        t1 = d.session(ENR1); t2 = d.session(ENR2, birthday='2012-06-16')
        f = d.svc('forms', t1, ENR1)
        ok('it is on her card, with its description', [(x['title'], x['description'], x['state']) for x in f['questionnaires']]
           == [('Unit 2 Exit Reflection', 'A few questions.', 'open')], f)
        fm = d.svc('form', t1, ENR1, q['id'])
        part = fm['parts'][0]
        ok('form: one part of kind custom, its questions in order with their options',
           part['kind'] == 'custom' and [x['kind'] for x in part['questions']] == [x['kind'] for x in CUSTOM_QS]
           and part['questions'][1]['options'] == CUSTOM_QS[1]['options'] and part['theme'] == 'A few questions.', part)
        a = {qid_of(q, 'text'): 'Why the numbers in front change.', qid_of(q, 'rating'): 4, qid_of(q, 'choice'): ['the video'],
             qid_of(q, 'date'): '2026-11-16', qid_of(q, 'ranking'): ['Notes', 'Practice', 'Labs'],
             qid_of(q, 'likert'): {'I asked': 'Sometimes', 'I checked': 'Always'}}
        r = card_answer(d, t1, ENR1, q['id'], a)
        ok('a student answers every kind from her card', r.get('ok') is True, r)
        kept = {x[0]: x[1:] for x in d.all("""select x.kind, a.value_num::text, a.value_text, a.value_json::text from answer a
                    join question x on x.id = a.question_id join response r on r.id = a.response_id
                   where r.questionnaire_id = :q and r.enrollment_id = :e""", q=q['id'], e=ENR1)}
        ok('rating: kept as a number', kept['rating'] == ['4', None, None], kept.get('rating'))
        ok('date: kept as text', kept['date'] == [None, '2026-11-16', None], kept.get('date'))
        ok('ranking: the order kept, and as words', kept['ranking'][1] == '1. Notes · 2. Practice · 3. Labs'
           and json.loads(kept['ranking'][2]) == ['Notes', 'Practice', 'Labs'], kept.get('ranking'))
        ok('likert: each statement with its choice, and as words in the question\'s order',
           json.loads(kept['likert'][2]) == {'I asked': 'Sometimes', 'I checked': 'Always'}
           and kept['likert'][1] == 'I asked: Sometimes · I checked: Always', kept.get('likert'))
        ok('choice with Other: the typed answer kept', kept['choice'][1] == 'the video', kept.get('choice'))
        ok('nothing is kept for the section heading', 'section' not in kept and len(kept) == 6, sorted(kept))
        r = card_answer(d, t2, ENR2, q['id'], {qid_of(q, 'section'): 'x'})
        ok('an answer sent for a section heading is invalid, and names it', r == {'ok': False, 'error': 'invalid', 'question_id': qid_of(q, 'section')}, r)
        r = card_answer(d, t2, ENR2, q['id'], {qid_of(q, 'rating'): 6})
        ok('a rating past the question\'s levels is invalid, and nothing is kept', r.get('error') == 'invalid'
           and d.one('select count(*) from response where enrollment_id = :e', e=ENR2) == 0, r)
        r = card_answer(d, t2, ENR2, q['id'], {qid_of(q, 'ranking'): []})
        ok('only empty answers: empty', r == {'ok': False, 'error': 'empty'}, r)
        r = card_answer(d, t2, ENR2, q['id'], {qid_of(q, 'rating'): 1})
        ok('a required question left out is not refused here (the student page checks it)', r.get('ok') is True, r)
        ok('the teacher reads the answers back', sorted(d.rpc('list_course_responses(:c)', c=COURSE_A).get(q['id'], {})) == [ENR1, ENR2])
        ok('no core self-assessment is written by a rating', d.one('select count(*) from core_self_assessment') == 0)
        try:
            d.rpc('delete_questionnaire(:q, :k)', q=q['id'], k=nid()); ok('an answered reflection cannot be deleted', False, 'it was deleted')
        except Exception as e:
            ok('an answered reflection cannot be deleted (turn it off instead)', sqlstate(e) == '23503', message(e))
        q2 = custom(d, title='Nobody Answered')
        ok('(setup) a second one, on the card', 'Nobody Answered' in titles(d.svc('forms', t1, ENR1)))
        d.rpc('delete_questionnaire(:q, :k)', q=q2['id'], k=nid())
        ok('one nobody answered is deleted, and leaves the card', 'Nobody Answered' not in titles(d.svc('forms', t1, ENR1)))
    finally:
        d.close()

# ── answers ─────────────────────────────────────────────────────────────────
@scenario('answers')
def scen_answers():
    d, k = world('answers')
    try:
        R5 = {'levels': 5}
        for label, opts, v, want in [
            ('rating 1 of 5', R5, 1, {'num': 1}), ('rating 5 of 5', R5, 5, {'num': 5}), ('rating 0', R5, 0, 'invalid'),
            ('rating 6 of 5', R5, 6, 'invalid'), ('rating 2.5', R5, 2.5, 'invalid'), ('rating "3"', R5, '3', 'invalid'),
            ('rating -1', R5, -1, 'invalid'), ('rating 10 of 10', {'levels': 10}, 10, {'num': 10}),
            ('rating 3 of 2', {'levels': 2}, 3, 'invalid'), ('rating 2 of 2', {'levels': 2}, 2, {'num': 2}),
            ('rating 5 with no levels named', {}, 5, {'num': 5}), ('rating 6 with no levels named', {}, 6, 'invalid'),
            ('rating 6 where levels is 99 (read as 5)', {'levels': 99}, 6, 'invalid'), ('rating 5 where levels is a word', {'levels': 'x'}, 5, {'num': 5}),
            ('rating 4 where levels is 4.5 (read as 5)', {'levels': 4.5}, 4, {'num': 4}), ('rating an object', R5, {'level': 3}, 'invalid'),
            ('rating a huge number', R5, 1e30, 'invalid'), ('rating null', R5, None, None),
        ]:
            got = clean(d, 'rating', opts, v)
            ok('%s -> %s' % (label, want), got == want, got)
        for label, v, want in [('a day', '2026-11-16', {'text': '2026-11-16'}), ('with spaces around', ' 2026-11-16 ', {'text': '2026-11-16'}),
                               ('a leap day', '2028-02-29', {'text': '2028-02-29'}), ('February 30', '2026-02-30', 'invalid'),
                               ('February 29 in a common year', '2026-02-29', 'invalid'), ('month 13', '2026-13-01', 'invalid'),
                               ('day 00', '2026-11-00', 'invalid'), ('year 0000', '0000-01-01', 'invalid'),
                               ('not a date', 'tomorrow', 'invalid'), ('a time too', '2026-11-16T10:00', 'invalid'),
                               ('slashes', '2026/11/16', 'invalid'), ('a number', 20261116, 'invalid'), ('empty', '', None), ('blank', '   ', None)]:
            got = clean(d, 'date', {}, v)
            ok('date %s -> %s' % (label, want), got == want, got)
        RK = {'choices': ['A', 'B', 'C']}
        for label, opts, v, want in [
            ('every choice once', RK, ['C', 'A', 'B'], {'json': ['C', 'A', 'B'], 'text': '1. C · 2. A · 3. B'}),
            ('one missing', RK, ['C', 'A'], 'invalid'), ('one twice', RK, ['C', 'A', 'A'], 'invalid'),
            ('one unknown', RK, ['C', 'A', 'Z'], 'invalid'), ('one too many', RK, ['C', 'A', 'B', 'A'], 'invalid'),
            ('not all strings', RK, ['C', 'A', 1], 'invalid'), ('not an array', RK, 'C', 'invalid'), ('empty', RK, [], None),
            ('no choices on the question', {}, ['A'], 'invalid'), ('choices not a list', {'choices': 'A'}, ['A'], 'invalid'),
            ('a choice listed twice counts once', {'choices': ['A', 'A', 'B']}, ['B', 'A'], {'json': ['B', 'A'], 'text': '1. B · 2. A'}),
        ]:
            got = clean(d, 'ranking', opts, v)
            ok('ranking %s -> %s' % (label, want), got == want, got)
        LK = {'statements': ['S1', 'S2', 'S3'], 'choices': ['Never', 'Always']}
        for label, opts, v, want in [
            ('every statement', LK, {'S1': 'Never', 'S2': 'Always', 'S3': 'Never'},
             {'json': {'S1': 'Never', 'S2': 'Always', 'S3': 'Never'}, 'text': 'S1: Never · S2: Always · S3: Never'}),
            ('some statements, in the question\'s order', LK, {'S3': 'Always', 'S1': 'Never'},
             {'json': {'S1': 'Never', 'S3': 'Always'}, 'text': 'S1: Never · S3: Always'}),
            ('an unknown statement', LK, {'S9': 'Never'}, 'invalid'), ('an unknown choice', LK, {'S1': 'Often'}, 'invalid'),
            ('a choice that is a number', LK, {'S1': 1}, 'invalid'), ('a choice that is null', LK, {'S1': None}, 'invalid'),
            ('an array', LK, ['Never'], 'invalid'), ('a string', LK, 'Never', 'invalid'), ('none answered', LK, {}, None),
            ('no statements on the question', {'choices': ['Never']}, {'S1': 'Never'}, 'invalid'),
            ('statements not a list', {'statements': {'S1': 1}, 'choices': ['Never']}, {'S1': 'Never'}, 'invalid'),
            ('a statement listed twice is written once', {'statements': ['S1', 'S1'], 'choices': ['Never']}, {'S1': 'Never'},
             {'json': {'S1': 'Never'}, 'text': 'S1: Never'}),
        ]:
            got = clean(d, 'likert', opts, v)
            ok('likert %s -> %s' % (label, want), got == want, got)
        long10 = ['c%d ' % i + 'x' * 600 for i in range(10)]
        ok('a ranking whose words pass 5,000 characters is invalid, not a server error', clean(d, 'ranking', {'choices': long10}, long10) == 'invalid')
        long_s = ['s%d ' % i + 'y' * 190 for i in range(30)]
        ok('a likert whose words pass 5,000 characters is invalid, not a server error',
           clean(d, 'likert', {'statements': long_s, 'choices': ['Never']}, {x: 'Never' for x in long_s}) == 'invalid')
        ok('...and one just under is kept', isinstance(clean(d, 'likert', {'statements': long_s[:20], 'choices': ['Never']}, {x: 'Never' for x in long_s[:20]}), dict))
        ok('a section takes no answer', clean(d, 'section', {}, 'x') == 'invalid' and clean(d, 'section', {}, None) is None)
        ok('a kind nobody named is invalid', clean(d, 'stars', {}, 3) == 'invalid')
    finally:
        d.close()

# ── same ────────────────────────────────────────────────────────────────────
OLD_CASES = [
    ('text', {}, [], v) for v in ['hello', '  spaced  ', '', '   ', 'x' * 2000, 'x' * 2001, 5, ['a'], None, {'a': 1}]
] + [
    ('short_set', {'labels': ['a', 'b']}, [], v) for v in [['x', 'y'], ['x'], ['', ''], ['x', 'y', 'z'], 'x', [1], ['x' * 301], None]
] + [
    ('choice', o, [], v) for o in [{'choices': ['A', 'B']}, {'choices': ['A', 'B'], 'multiple': False}, {'choices': ['A'], 'other': True}]
    for v in ['A', ['A'], ['A', 'B'], ['Z'], ['A', 'A'], [], [''], ['x' * 61], [1], {'a': 1}, None]
] + [
    ('scale4', {}, c, v) for c in [[], ['PAR', 'PPI']]
    for v in [{'level': 3}, {'level': 5}, {'level': 3, 'why': 'because'}, {'levels': {'PAR': 2}}, {'levels': {'PAR': 9}},
              {'levels': {'COM': 2}}, {'levels': {'PAR': 2}, 'why': {'PAR': 'x'}}, {'why': {'ZZ': 'x'}}, {'why': 'x' * 2001}, {}, 3, 'x', None]
] + [
    ('goal_status', {'choices': ['On track', 'Stuck']}, [], v) for v in ['On track', 'Stuck', 'Nope', 1, None]
] + [
    ('core_pick', {}, c, v) for c in [[], ['COM']] for v in ['COM', 'PAR', 'ZZ', 1, None]
]
@scenario('same')
def scen_same():
    before, k = world('same0', with_file=False); after, k2 = world('same')
    try:
        differ = []
        for kind, opts, core, v in OLD_CASES:
            a = clean(before, kind, opts, v, core); b = clean(after, kind, opts, v, core)
            if a != b: differ.append((kind, opts, core, v, a, b))
        ok('every old kind\'s answers come out exactly as before the file, refusals included (%d cases)' % len(OLD_CASES), differ == [], differ[:3])
        ok('...and the cases do refuse some and take some',
           sum(1 for c in OLD_CASES if clean(after, c[0], c[1], c[3], c[2]) == 'invalid') > 20
           and sum(1 for c in OLD_CASES if isinstance(clean(after, c[0], c[1], c[3], c[2]), dict)) > 20)
        for kind in NEW_KINDS:
            ok('BEFORE the file a %s answer is invalid' % kind, clean(before, kind, {}, 1) == 'invalid')
    finally:
        before.close(); after.close()

# ── apply ───────────────────────────────────────────────────────────────────
def attrs(d):
    return d.all("""select p.oid::regprocedure::text, p.prosecdef, p.proconfig::text, p.provolatile::text, p.proowner::regrole::text, p.proacl::text,
                           p.prolang::regclass::text, p.proparallel::text, p.proleakproof
                      from pg_proc p where p.oid = any(:f::regprocedure[]) order by 1""", f='{%s}' % ','.join('"%s"' % x for x in PATCHED))

def procs(d):
    return [[r[0], r[1]] for r in d.all("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'student_submit', 'fv_private') and p.prokind = 'f'
              order by 1""")]

@scenario('apply')
def scen_apply():
    text = text_at(FILE); sts = split(text)
    ok('the file is one transaction: begin first, commit last', bare(sts[0]).lower() == 'begin' and bare(sts[-1]).lower() == 'commit')
    ok('it waits five seconds at most for a lock', bare(sts[1]).lower() == "set local lock_timeout = '5s'", sts[1])
    d = SDb('rf_apply', template=template()); k = seed(d)
    try:
        # In use: a questionnaire on with no slip, one with slips, an answer, a card session.
        q = questionnaire(d); q2 = questionnaire(d, title='With Slips'); r2, made = d.issue_new('questionnaire', q2['id'], [ENR1])
        q3 = questionnaire(d, title='March Reflection', opens=30, closes=40); questionnaire(d, title='Gone By', opens=-20, closes=-10)
        t1 = d.session(ENR1); t2 = d.session(ENR2, birthday='2012-06-16')
        d.svc('answer', t1, ENR1, q2['id'], (json.dumps({text_q(q2): 'In.'}), '::jsonb'))
        pre = d.file(PRE)
        want_pre = [['students with a card: 2', 'of them, seeing it for the first time: 2'],   # March Reflection (not open yet)
                    ['students with a card: 2', 'of them, seeing it for the first time: 2'],   # November Reflection
                    ['students with a card: 2', 'of them, seeing it for the first time: 1']]   # With Slips
        ok('the pre-check on the database as live is: only what will show (one not open yet too; not one past its date), '
           'with who sees it for the first time',
           pre == 'ok' and [r[0].split(' / ')[-1] for r in d.rows] == ['March Reflection', 'November Reflection', 'With Slips']
           and all(r[0].startswith('shows in Reflect on the apply: ') for r in d.rows) and [r[1:] for r in d.rows] == want_pre, (pre, d.rows))
        post = d.file(POST)
        ok('the post-check before the apply lists both functions and both checks', post == 'ok' and len(d.rows) == 4, (post, d.rows))
        def stopped(setup, want):
            d.begin()
            try:
                for s in setup: d.run(s)
                r = d.statements(split(text))
            finally:
                try: d.rollback()
                except Exception: pass
            return r.startswith('STOPPED') and want in r, r
        for label, setup, want in [
            ('with _card_listed changed', ["create or replace function student_submit._card_listed(p_questionnaire_id uuid, p_enrollment_id uuid) "
                                           "returns boolean language sql stable security definer set search_path to 'public', 'student_submit', 'pg_temp' "
                                           "as $f$ select false $f$"], 'is not the definition'),
            ('with _clean_answer gone', ['drop function student_submit._clean_answer(text,jsonb,text[],jsonb)'], 'is not the definition'),
            ('with the questionnaire check changed', ["alter table questionnaire drop constraint questionnaire_kind_check, "
                                                      "add constraint questionnaire_kind_check check (kind <> '')"], 'does not read as'),
            ('with the question check gone', ['alter table question drop constraint question_kind_check'], 'does not read as'),
            ('with a function it relies on changed', ["create or replace function student_submit._card_refusal(p_card_id uuid) returns text "
                                                      "language sql stable security definer set search_path to 'public', 'student_submit', 'pg_temp' "
                                                      "as $f$ select null::text $f$"], 'is relied on'),
            ('with forms changed', ["create or replace function student_submit.forms(p_session_token text, p_enrollment_id uuid, p_ip_hash text) "
                                    "returns jsonb language sql stable security definer set search_path to 'public', 'student_submit', 'pg_temp' "
                                    "as $f$ select '{}'::jsonb $f$"], 'is relied on'),
        ]:
            good, r = stopped(setup, want)
            ok('it stops, with nothing changed, %s' % label, good, r)
        cols = table_columns(d.c)
        before = dict(procs(d)); rows_before = row_checksums(d.c, cols); cat0 = catalog(d.c); attrs0 = attrs(d)
        old_body = d.one("select pg_get_functiondef('student_submit._clean_answer(text,jsonb,text[],jsonb)'::regprocedure)")
        r = d.statements(sts)
        ok('it applies on a database in use', r == 'ok', r)
        after = dict(procs(d))
        ok('the only functions changed are its two', sorted(p for p in before if before[p] != after.get(p)) == sorted(PATCHED),
           sorted(p for p in before if before[p] != after.get(p)))
        ok('it adds and drops no function', set(before) == set(after))
        only0, only1 = differences(cat0, catalog(d.c))
        ok('the catalog differs only in those two functions and the two checks',
           all(any(w in l for w in ('_card_listed', '_clean_answer', 'questionnaire_kind_check', 'question_kind_check')) or l.startswith('depends ')
               for l in only0 + only1) and only1, (only0, only1))
        ok('who may run the two functions is as before', not any('grant' in l.lower() or 'acl' in l.lower() for l in only0 + only1), (only0, only1))
        ok('each is still SECURITY DEFINER, with its search_path, volatility, owner and grants', attrs(d) == attrs0, (attrs0, attrs(d)))
        ok('_card_listed by itself: true for her class\'s, false for another class\'s and for one that does not exist',
           d.one('select student_submit._card_listed(:q, :e)', q=q['id'], e=ENR1) is True
           and d.one('select student_submit._card_listed(:q, :e)', q=q['id'], e=ENR_B) is False
           and d.one('select student_submit._card_listed(:q, :e)', q=nid(), e=ENR1) is False)
        new_body = d.one("select pg_get_functiondef('student_submit._clean_answer(text,jsonb,text[],jsonb)'::regprocedure)").split('\n')
        it = iter(new_body)
        missing = [l for l in old_body.split('\n') if not any(l == x for x in it)]
        ok('every line of the old _clean_answer is in the new one, in order: nothing of the old kinds was changed', missing == [], missing[:3])
        rows_after = row_checksums(d.c, cols)
        ok('no row of any table changes', [t for t in rows_before if rows_before[t] != rows_after.get(t)] == [],
           [t for t in rows_before if rows_before[t] != rows_after.get(t)])
        ok('the post-check after: no rows', d.file(POST) == 'ok' and d.rows == [], d.rows)
        ok('the pre-check after the apply: nothing "would stop"; the same reflections',
           d.file(PRE) == 'ok' and len(d.rows) == 3 and all(r[0].startswith('shows in Reflect') for r in d.rows), d.rows)
        d.run('update course set student_page_enabled = false where id = :c', c=COURSE_A)
        ok('...and with the class\'s Student Page off, it counts no card', d.file(PRE) == 'ok' and all(r[1] == 'students with a card: 0' for r in d.rows), d.rows)
        d.run('update course set student_page_enabled = true where id = :c', c=COURSE_A)
        cat1 = catalog(d.c)
        r2 = d.file(FILE)
        ok('a second run: applies, changes nothing', r2 == 'ok' and catalog(d.c) == cat1, (r2, differences(cat1, catalog(d.c))))
        ok('the card sessions from before still work, and now list the one with no slip',
           titles(d.svc('forms', t2, ENR2)) == {'November Reflection': 'open', 'With Slips': 'open', 'March Reflection': 'not_open_yet'}
           and titles(d.svc('forms', t1, ENR1)) == {'November Reflection': 'open', 'With Slips': 'sent', 'March Reflection': 'not_open_yet'},
           d.svc('forms', t2, ENR2))
        for role in ('anon', 'authenticated'):
            for fn, args in [('_card_listed', "'%s'::uuid, '%s'::uuid" % (q['id'], ENR1)), ('_clean_answer', "'text', '{}'::jsonb, '{}'::text[], '\"x\"'::jsonb")]:
                try:
                    d.role(role, 'select student_submit.%s(%s)' % (fn, args)); ok('%s cannot run %s' % (role, fn), False, 'it ran')
                except Exception as e:
                    ok('%s cannot run %s' % (role, fn), sqlstate(e) == '42501', message(e))
    finally:
        d.close()

# ── undo ────────────────────────────────────────────────────────────────────
@scenario('undo')
def scen_undo():
    d = SDb('rf_undo', template=template()); k = seed(d)
    try:
        q = questionnaire(d)
        t1 = d.session(ENR1)
        cat0 = catalog(d.c); p0 = procs(d)
        r0 = d.file(UNDO)
        ok('the undo where the file was never applied: runs, changes nothing', r0 == 'ok' and catalog(d.c) == cat0, (r0, differences(cat0, catalog(d.c))))
        ok('the file applies', d.file(FILE) == 'ok')
        ok('(setup) on the card with no slip', titles(d.svc('forms', t1, ENR1)) == {'November Reflection': 'open'})
        cols = table_columns(d.c); rows1 = row_checksums(d.c, cols)
        r = d.file(UNDO)
        ok('the undo runs', r == 'ok', r)
        ok('every function as before', procs(d) == p0)
        ok('the catalog is as before the file, line for line', catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
        ok('no row of any table changes', row_checksums(d.c, cols) == rows1)
        ok('while undone, a card lists a questionnaire only by its slip again', titles(d.svc('forms', t1, ENR1)) == {})
        ok('the undo a second time: runs, changes nothing', d.file(UNDO) == 'ok' and catalog(d.c) == cat0)
        ok('the file applies again after the undo', d.file(FILE) == 'ok')
        c = custom(d)
        a = card_answer(d, t1, ENR1, c['id'], {qid_of(c, 'rating'): 3})
        ok('(setup) a teacher\'s reflection, answered', a.get('ok') is True, a)
        rows2 = row_checksums(d.c, cols)
        r = d.file(UNDO)
        ok('the undo with a teacher\'s reflection in place runs', r == 'ok', r)
        ok('...both functions back', dict(procs(d)) == dict(p0))
        ok('...both checks left wide, since rows use the new kinds',
           'custom' in d.one("select pg_get_constraintdef(oid) from pg_constraint where conname = 'questionnaire_kind_check'")
           and 'likert' in d.one("select pg_get_constraintdef(oid) from pg_constraint where conname = 'question_kind_check'"))
        ok('...and it deletes nothing: the reflection, its questions and the answer are all there', row_checksums(d.c, cols) == rows2)
        ok('the file applies again over that', d.file(FILE) == 'ok' and d.file(POST) == 'ok' and d.rows == [], d.rows)
        # The fast stop: only the first function.
        fast = [s for s in split(text_at(UNDO)) if 'function student_submit._card_listed' in s.lower()]
        ok('the fast stop is one statement', len(fast) == 1)
        d.run(fast[0])
        ok('the fast stop: the slip rule is back and answers to the new kinds are still checked',
           titles(d.svc('forms', t1, ENR1)) == {'Unit 2 Exit Reflection': 'sent'} and clean(d, 'rating', {}, 3) == {'num': 3},
           d.svc('forms', t1, ENR1))
    finally:
        d.close()

# ── fingerprints ────────────────────────────────────────────────────────────
def cmd_fingerprints(check_only):
    d0 = SDb('rf_fp0', template=template())
    try:
        live = fingerprints(d0, PATCHED); relied = fingerprints(d0, RELIED)
        bodies = '\n'.join(d0.one('select pg_get_functiondef(to_regprocedure(:f))', f=f).rstrip() + ';\n' for f in PATCHED)
        r = d0.statements(split(neutral(text_at(FILE))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        becomes = fingerprints(d0, PATCHED)
        relied_after = fingerprints(d0, RELIED)
        if relied_after != relied: sys.exit('the file changes a function it only relies on')
    finally:
        d0.close()
    for f in PATCHED:
        if live[f] != LIVE[f]: sys.exit('%s on the stand-in is not the live definition (%s, live %s)' % (f, live[f], LIVE[f]))
    lists = {'functions': [(f, live[f], becomes[f]) for f in PATCHED], 'relied': [(f, relied[f] or 'absent') for f in RELIED]}
    stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel)
        was = open(path).read(); now = write_lists(was, lists)
        if rel == UNDO:
            now = re.sub(r'(-- UNDO-BODIES-BEGIN[^\n]*\n).*?(-- UNDO-BODIES-END)', lambda m: m.group(1) + bodies + m.group(2), now, flags=re.S)
        if now != was:
            stale.append(rel)
            if not check_only: open(path, 'w').write(now)
    if check_only: print('stale: ' + ', '.join(stale) if stale else 'every list is current'); return 1 if stale else 0
    print('rewritten: ' + (', '.join(stale) or 'nothing (every list was current)')); return 0

if __name__ == '__main__':
    args = sys.argv[1:]
    try:
        if args[:1] == ['fingerprints']:
            sys.exit(cmd_fingerprints(args[1:] == ['check']))
        for n in args or list(SCENARIOS):
            SCENARIOS[n]()
    finally:
        drop_templates()
    finish()
