"""Batch E, the last database change of the student page build:
migrations/2026111150_student_page_last_changes.sql, applied after Batch B,
its fixes, Batch C (C1, C2), the send rules and Batch D (2026111140), with
Supabase's pg_cron, pg_net and Vault stood in for (photo-lifecycle-stand-in.sql,
as Batch D needs them).

    PGDATABASE=be python3 batch_c_common.py build     an EMPTY database: live with Batch B and its fixes
    PGDATABASE=be python3 batch_e.py                  every scenario below, with the file and (for the
                                                      checks marked differs) without it
    PGDATABASE=be python3 batch_e.py e4 e5 ...        or some
    PGDATABASE=be python3 batch_e.py fingerprints [check]   write (or check) the lists the four files carry

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  e1     work says whether Reflect on Feedback is on.
  e4     a piece returned and then dated into the future: markup, file_links
         and group_file_links serve nothing of it; feedback leaves it out.
  e5     a group-mate Missing or Excused: their marks (and notes) are not
         sent to the rest of the group, by markup or feedback's counts; the
         student's own and the other members' are.
  e6     per-card limits: thirty reflect and reply writes an hour, sixty
         answer_seen, twenty finishes opened by send_paths; the answer is
         too_many with a wait; another card is not counted; the limit is
         counted before the class's lock.
  apply  every guard; a second run; grants; the pre-check and post-check.
  undo   the undo puts the catalog back exactly, and the file applies again.

A check marked differs must FAIL on the database without the file (run with
`-without`): it shows the file is what makes it hold.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_c_common import *
import batch_c_common as bc
from catalog import catalog, differences, row_checksums

FILE = '../2026111150_student_page_last_changes.sql'
SEND_RULES = '../2026111130_student_send_rules.sql'
BATCH_D = '../2026111140_photo_lifecycle.sql'
STAND = 'photo-lifecycle-stand-in.sql'
UNDO = 'batch-e-undo.sql'
PRE = 'batch-e-live-precheck.sql'
POST = 'batch-e-live-postcheck.sql'
LIST_FILES = [FILE, UNDO, PRE, POST]

# What the file replaces, adds, and relies on, by signature.
REPLACES = ['student_submit.work(text,uuid,text)', 'student_submit.send_paths(text,uuid,uuid,text)',
            'student_submit.markup(text,uuid,uuid,text)', 'student_submit.feedback(text,uuid,text)',
            'student_submit.group_file_links(text,uuid,uuid,text)', 'student_submit.file_links(text,uuid,uuid,text)',
            'student_submit.reflect(text,uuid,uuid,jsonb,text)', 'student_submit.reply(text,uuid,uuid,jsonb,text)',
            'student_submit.answer_seen(text,uuid,uuid[],text)',
            'public.save_score_report_note(uuid,uuid,text,uuid)', 'public.list_course_grade_returns(uuid)']
NEW = ['student_submit._write_limit(uuid,text,integer)', 'fv_private.report_note_hold(uuid,uuid)',
       'student_submit._card_listed(uuid,uuid)', 'student_submit.forms(text,uuid,text)',
       'student_submit.form(text,uuid,uuid,text)', 'student_submit.answer(text,uuid,uuid,jsonb,text)',
       'student_submit.report(text,uuid,uuid,text)']
RELIED = ['student_submit._session_class(text,uuid)', 'student_submit._send_session(text,uuid)',
          'student_submit._group_members(uuid,uuid)', 'student_submit._grading_started(uuid,uuid)',
          'student_submit._work_window(uuid)', 'public._grade_return_lock_first(uuid)', 'public._fv_timezone(text)',
          'public._work_hold()', 'public._work_bucket()', 'public._work_upload_json(uuid)',
          'public._revision_state(uuid)', 'public._grade_copy_in_use(jsonb,uuid)',
          'student_submit._closed_reason(questionnaire,text)', 'student_submit._part(uuid)',
          'student_submit._clean_answer(text,jsonb,text[],jsonb)', 'public.fv_owns_enrollment(uuid)',
          'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
          # The slip's own: not changed, and relied on to stay as they are (a slip used first makes the card's
          # answer already_sent; the card's answer marks the slip used).
          'student_submit.open(text,text)', 'student_submit.verify(text,text,text,text,text)',
          'student_submit."check"(text,text,text)', 'student_submit.submit(text,jsonb,text)',
          'student_submit._payload(uuid)']
TABLES = ['student_submit.write_log']

# ── the lists: written by script, never by hand ─────────────────────────────
LISTS = re.compile(r'(-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def neutral(text):
    """The text with every list stood aside, so it applies whatever the lists hold."""
    return LISTS.sub(lambda m: m.group(1) + ("            ('public.no_such_function_at_all()', 'absent', 'absent')" if m.group(2) == 'replaces'
                                             else "            ('public.no_such_function_at_all()', 'absent')") + m.group(4), text)
def write_lists(text, lists):
    def row(m):
        items = lists.get(m.group(2))
        if items is None: return m.group(0)
        indent = re.match(r'[ \t]*', m.group(3)).group(0) or '            '
        w = max(len(x[0]) for x in items) + 3
        body = ',\n'.join("%s(%s %s)" % (indent, ("'%s'," % x[0]).ljust(w), ', '.join("'%s'" % h for h in x[1:])) for x in items)
        return m.group(1) + body + m.group(4)
    return LISTS.sub(row, text)
def fingerprints(d, fns):
    return {f: d.one('select md5(pg_get_functiondef(to_regprocedure(:f)))', f=f) for f in fns}

# ── the template: live as the file meets it ─────────────────────────────────
_TPL = {}
def template(with_file):
    key = bool(with_file)
    if key in _TPL: return _TPL[key]
    name = '%s_be%d' % (cc.BASE_DB, int(key))
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in [C1, C2, SEND_RULES, STAND, BATCH_D] + ([FILE] if key else []):
        for st in split(text_at(rel)):
            try: c.run(st)
            except Exception as e:
                c.close(); ok('%s applies to the template' % os.path.basename(rel), False, message(e)); finish()
    c.close(); _TPL[key] = name
    return name
def drop_templates():
    for name in _TPL.values(): admin('drop database if exists "%s" with (force)' % name)

MODE = {'fixed': True}
def check(name, good, detail='', differs=False):
    """A check. Without the file (MODE fixed false) a check marked differs must FAIL, and every other must hold."""
    if MODE['fixed']: ok(name, good, detail)
    elif differs: ok('[without the file this fails] ' + name, not good, 'it held without the file')
    else: ok('[without the file] ' + name, good, detail)

def world(tag):
    d = CDb('be_' + tag, template=template(MODE['fixed'])); k = seed(d)
    t1 = d.session(ENR1); t2 = d.session(ENR2, birthday='2012-06-16')
    return d, k, t1, t2

def has_file(d): return d.one("select to_regprocedure('student_submit._write_limit(uuid,text,integer)') is not null")

SCENARIOS = {}
def scenario(name, without=True):
    def reg(f): SCENARIOS[name] = (f, without); return f
    return reg

def returned_with_marks(d, k, t, e, a, text):
    """A send by e, a mark with `text` on its page, a grade, returned. The send's id and file ids."""
    sub, files = d.send(t, e, a, pages=1)
    d.save_markup(files[0], marks(text))
    d.score(e, a, 7)
    d.return_work(a, [e])
    return sub, files

def group(d, a, *members):
    d.run("""update assessment set group_work = 'group', collab_mode = 'groups',
               collab_config = jsonb_build_object('groups', jsonb_build_array(to_jsonb(:m::text[])))
             where id = :a""", m=list(members), a=a)

# ── e1 ──────────────────────────────────────────────────────────────────────
@scenario('e1')
def scen_e1():
    d, k, t1, t2 = world('e1')
    try:
        w = d.svc('work', t1, ENR1)
        check('work says Reflect on Feedback is on', w.get('reflect_on_feedback') is True, w, differs=True)
        d.run('update course set reflect_on_feedback = false where id = :c', c=COURSE_A)
        w = d.svc('work', t1, ENR1)
        check('work says Reflect on Feedback is off', w.get('reflect_on_feedback') is False, w, differs=True)
        check('work keeps every field it had', {'ok', 'v', 'send_work', 'assessments'} <= set(w), w)
    finally:
        d.close()

# ── e4 ──────────────────────────────────────────────────────────────────────
@scenario('e4')
def scen_e4():
    d, k, t1, t2 = world('e4')
    try:
        lab = k['lab']
        returned_with_marks(d, k, t1, ENR1, lab, 'Look again at step 3')
        group(d, lab, ENR1, ENR2)
        check('(setup) on the page: markup serves the marks', len(d.svc('markup', t1, ENR1, lab).get('files', [])) == 1)
        check('(setup) file_links and group_file_links serve the page',
              len(d.svc('file_links', t1, ENR1, lab)['files']) == 1 and len(d.svc('group_file_links', t1, ENR1, lab)['files']) == 1)
        d.run('update assessment set date_assigned = current_date + 30 where id = :a', a=lab)
        m = d.svc('markup', t1, ENR1, lab)
        check('dated into the future: markup is not_found', m == {'ok': False, 'error': 'not_found'}, m, differs=True)
        f = d.svc('file_links', t1, ENR1, lab)
        check('dated into the future: file_links names no page', f.get('ok') and f['files'] == [], f, differs=True)
        g = d.svc('group_file_links', t1, ENR1, lab)
        check('dated into the future: group_file_links names no page', g.get('ok') and g['files'] == [], g, differs=True)
        fb = d.svc('feedback', t1, ENR1)
        check('dated into the future: feedback leaves it out', all(x['id'] != lab for x in fb['assessments']), fb)
        d.run('update assessment set date_assigned = current_date where id = :a', a=lab)
        check('dated today again: all three serve it',
              len(d.svc('markup', t1, ENR1, lab)['files']) == 1 and len(d.svc('file_links', t1, ENR1, lab)['files']) == 1
              and len(d.svc('group_file_links', t1, ENR1, lab)['files']) == 1)
        d.run("update course set timezone = 'Pacific/Kiritimati' where id = :c", c=COURSE_A)
        d.run("update assessment set date_assigned = (now() at time zone 'Pacific/Kiritimati')::date where id = :a", a=lab)
        check("the date is the class's own: today where the class is serves it",
              len(d.svc('markup', t1, ENR1, lab)['files']) == 1)
    finally:
        d.close()

# ── e5 ──────────────────────────────────────────────────────────────────────
@scenario('e5')
def scen_e5():
    d, k, t1, t2 = world('e5')
    try:
        lab = k['lab']
        returned_with_marks(d, k, t1, ENR1, lab, 'For Cece')
        returned_with_marks(d, k, t2, ENR2, lab, 'For Stu2')
        group(d, lab, ENR1, ENR2)
        m = json.dumps(d.svc('markup', t1, ENR1, lab))
        check('(setup) in a group, Cece sees Stu2\'s marks', 'For Stu2' in m and 'For Cece' in m, m)
        for status in ('EXC', 'NS'):
            d.run("insert into score (enrollment_id, assessment_id, status) values (:e, :a, :s) "
                  "on conflict (enrollment_id, assessment_id) do update set status = excluded.status", e=ENR2, a=lab, s=status)
            m = json.dumps(d.svc('markup', t1, ENR1, lab))
            check('Stu2 %s: Cece no longer gets Stu2\'s marks or note' % status, 'For Stu2' not in m, m, differs=True)
            check('Stu2 %s: Cece still gets her own' % status, 'For Cece' in m, m)
            fb = d.svc('feedback', t1, ENR1)
            mk = [x['marks'] for x in fb['assessments'] if x['id'] == lab][0]
            check('Stu2 %s: feedback counts Cece\'s pages and notes only' % status, mk and mk['pages'] == 1 and mk['notes'] == 1, mk, differs=True)
            m2 = d.svc('markup', t2, ENR2, lab)
            check('Stu2 %s: Stu2 sees no marks at all (as before)' % status, m2 == {'ok': True, 'files': []}, m2)
        d.run('update score set status = null where enrollment_id = :e and assessment_id = :a', e=ENR2, a=lab)
        m = json.dumps(d.svc('markup', t1, ENR1, lab))
        check('Stu2 no longer Excused: the group sees Stu2\'s marks again', 'For Stu2' in m, m)
    finally:
        d.close()

# ── e6 ──────────────────────────────────────────────────────────────────────
def card_of(d, e): return d.one('select id from student_card where enrollment_id = :e and stopped_at is null', e=e)

@scenario('e6')
def scen_e6():
    d, k, t1, t2 = world('e6')
    try:
        lab = k['lab']
        returned_with_marks(d, k, t1, ENR1, lab, 'x')
        refl = {'makes_sense': 'yes', 'plan': 'Read it twice.'}
        r = [d.reflect(t1, ENR1, lab, dict(refl, plan='p%d' % i)) for i in range(30)]
        check('thirty reflections in an hour are taken', all(x.get('ok') for x in r), r[-1])
        r = d.reflect(t1, ENR1, lab, refl)
        check('the thirty-first is too_many, with a wait', r.get('error') == 'too_many' and 1 <= r.get('retry_after_s', 0) <= 3600, r, differs=True)
        r = d.reply(t1, ENR1, lab, {'sense_now': 'yes'})
        check('reply shares the count', r.get('error') == 'too_many', r, differs=True)
        r = d.reflect(t2, ENR2, lab, {'makes_sense': 'yes', 'plan': 'x'})
        check("another card is not counted (Stu2's own reflection is judged on its own)", r.get('error') != 'too_many', r)
        if has_file(d):
            d.run("update student_submit.write_log set at = at - interval '61 minutes' where kind = 'reflect'")
            r = d.reflect(t1, ENR1, lab, refl)
            check('an hour later it is taken again', r.get('ok') is True, r)
        seen = [d.svc('answer_seen', t1, ENR1, ('{%s}' % lab, '::uuid[]')) for _ in range(60)]
        check('sixty answer_seen in an hour are taken', all(x.get('ok') for x in seen), seen[-1])
        r = d.svc('answer_seen', t1, ENR1, ('{%s}' % lab, '::uuid[]'))
        check('the sixty-first answer_seen is too_many', r.get('error') == 'too_many', r, differs=True)
        # The limit is counted before the class's lock: a call refused for it does not wait for a held lock.
        if has_file(d):
            other = d.other(); other.run('begin'); other.run('select public._grade_return_lock(:c)', c=COURSE_A)
            d.run("set lock_timeout = '1s'")
            try:
                r = d.svc('answer_seen', t1, ENR1, ('{%s}' % lab, '::uuid[]'))
                check('refused for the limit while another holds the class: answered at once', r.get('error') == 'too_many', r)
            except Exception as e:
                check('refused for the limit while another holds the class: answered at once', False, message(e))
            finally:
                d.run('reset lock_timeout'); other.run('rollback'); other.close()
        # Finishes: send_paths counts each one it opens.
        s = d.service("student_submit.send_start(:t, :e, :a, :p::jsonb, null, null, :r, 'ip-1')", t=t1, e=ENR1, a=k['rub'],
                      p=json.dumps([{'width': 900, 'height': 1200}]), r=nid())
        check('(setup) a send started', s.get('ok'), s)
        r = [d.svc('send_paths', t1, ENR1, s['submission_id']) for _ in range(20)]
        check('twenty finishes in an hour are opened', all(x.get('ok') for x in r), r[-1])
        r = d.svc('send_paths', t1, ENR1, s['submission_id'])
        check('the twenty-first is too_many, with a wait', r.get('error') == 'too_many' and r.get('retry_after_s', 0) >= 1, r, differs=True)
        r = d.svc('send_paths', t1, ENR1, nid())
        check('a send that is not hers is not_found, and not counted', r == {'ok': False, 'error': 'not_found'}, r)
        if has_file(d):
            n = d.one("select count(*) from student_submit.write_log where kind = 'finish'")
            check('only the finishes opened were counted', n == 20, n)
            d.run("insert into student_submit.write_log (card_id, kind, at) values (:c, 'finish', now() - interval '2 days')", c=card_of(d, ENR1))
            d.svc('send_paths', t1, ENR1, s['submission_id'])
            check('rows older than a day are cleared by the next call',
                  d.one("select count(*) from student_submit.write_log where at < now() - interval '1 day'") == 0)
    finally:
        d.close()

# ── e2 ──────────────────────────────────────────────────────────────────────
def questionnaire(d, title='November Reflection', opens=-1, closes=7, kind='core_reflection', template='core-8-1'):
    return d.rpc("upsert_questionnaire(:c, :kind, :t, :tpl, p_report_period => 1, p_opens_on => current_date + :o::int, "
                 "p_closes_on => current_date + :cl::int, p_idempotency_key => :k)", c=COURSE_A, kind=kind, t=title, tpl=template,
                 o=opens, cl=closes, k=nid())
def issue(d, qid, *enrollments):
    return d.rpc('issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ','.join(enrollments), k=nid())
def text_q(q): return [x['id'] for x in q['questions'] if x['kind'] == 'text'][0]
def card_answer(d, t, e, qid, answers): return d.svc('answer', t, e, qid, (json.dumps(answers), '::jsonb'))

@scenario('e2', without=False)
def scen_e2():
    d, k, t1, t2 = world('e2')
    try:
        q1 = questionnaire(d); issue(d, q1['id'], ENR1, ENR2)
        q2 = questionnaire(d, title='Not Sent'); # on, but no slip issued to anyone
        q3 = questionnaire(d, title='March Reflection', opens=30, closes=40); issue(d, q3['id'], ENR1)
        q4 = questionnaire(d, title='Gone By', opens=-20, closes=-10); issue(d, q4['id'], ENR1)
        f = d.svc('forms', t1, ENR1)
        got = {x['title']: x['state'] for x in f['questionnaires']}
        ok('forms: the questionnaires issued to her, open or not yet open; not one never sent her, not one closed',
           got == {'November Reflection': 'open', 'March Reflection': 'not_open_yet'}, f)
        ok('forms: each with the fields the tab reads, and nothing else',
           all(set(x) == {'id', 'title', 'description', 'minutes', 'state', 'opens_on', 'closes_on', 'sent_at'} for x in f['questionnaires']), f)
        ok('forms: another student\'s session for her class is not_found', d.svc('forms', t2, ENR1) == {'ok': False, 'error': 'not_found'})
        fm = d.svc('form', t1, ENR1, q1['id'])
        ok('form: the questionnaire\'s parts, as a slip\'s verify gives them', fm.get('ok') and fm['parts'][0]['id'] == q1['id']
           and len(fm['parts'][0]['questions']) == 3 and 'context' in fm, fm)
        for label, qid, want in [('one never sent her', q2['id'], 'not_found'), ('not yet open', q3['id'], 'not_open_yet'),
                                 ('closed', q4['id'], 'closed'), ('another class\'s id', nid(), 'not_found')]:
            r = d.svc('form', t1, ENR1, qid)
            ok('form: %s is %s' % (label, want), r.get('error') == want, r)
        r = card_answer(d, t1, ENR1, q1['id'], {text_q(q1): 'I listened more in group work.'})
        ok('answer: taken', r.get('ok') is True and r.get('submitted_at'), r)
        ok('answer: one response, via link, for her', d.all("select via, enrollment_id::text from response where questionnaire_id = :q", q=q1['id']) == [['link', ENR1]])
        ok('answer: her answer is stored as typed (trimmed)',
           d.one("select a.value_text from answer a join response r on r.id = a.response_id where r.questionnaire_id = :q", q=q1['id']) == 'I listened more in group work.')
        ok('answer: her printed slip for it is now used', d.one("select used_at is not null from student_access_code where questionnaire_id = :q and enrollment_id = :e", q=q1['id'], e=ENR1))
        ok('answer: Stu2\'s slip is untouched', d.one("select used_at is null from student_access_code where questionnaire_id = :q and enrollment_id = :e", q=q1['id'], e=ENR2))
        r = card_answer(d, t1, ENR1, q1['id'], {text_q(q1): 'again'})
        ok('answer: a second send is already_sent, nothing written', r == {'ok': False, 'error': 'already_sent'}
           and d.one('select count(*) from response where questionnaire_id = :q', q=q1['id']) == 1, r)
        ok('form after the answer: already_sent', d.svc('form', t1, ENR1, q1['id']) == {'ok': False, 'error': 'already_sent'})
        f = d.svc('forms', t1, ENR1)
        sent = [x for x in f['questionnaires'] if x['id'] == q1['id']][0]
        ok('forms: now Sent, with when', sent['state'] == 'sent' and sent['sent_at'], sent)
        for label, ans, want in [('an id that is no question', {nid(): 'x'}, 'invalid'), ('a question of another questionnaire', {text_q(q3): 'x'}, 'invalid'),
                                 ('nothing said', {text_q(q1): '  '}, 'empty'), ('not an object', ['x'], 'invalid')]:
            r = card_answer(d, t2, ENR2, q1['id'], ans)
            ok('answer: %s is %s, nothing written' % (label, want), r.get('error') == want
               and d.one('select count(*) from response where enrollment_id = :e', e=ENR2) == 0, r)
        r = card_answer(d, t2, ENR1, q1['id'], {text_q(q1): 'x'})
        ok('answer: Stu2\'s session naming Cece is not_found', r == {'ok': False, 'error': 'not_found'}, r)
        # A slip used first: the card's answer is already_sent.
        code = issue(d, q3['id'], ENR2)[0]['code']
        d.run('update questionnaire set opens_on = current_date - 1 where id = :q', q=q3['id'])
        o = d.service("student_submit.open(:c, 'ip-1')", c=code)
        v = d.service("student_submit.verify(:t, '2012-06-16', null, null, 'ip-1')", t=o['token'])
        s = d.service("student_submit.submit(:t, :a::jsonb, 'ip-1')", t=o['token'], a=json.dumps({text_q(q3): 'by slip'}))
        ok('(setup) Stu2 answers March by slip', s.get('ok'), (o, v, s))
        r = card_answer(d, t2, ENR2, q3['id'], {text_q(q3): 'by card'})
        ok('a slip used first: the card\'s answer is already_sent', r == {'ok': False, 'error': 'already_sent'}, r)
        # The card answers first: the slip opens as used.
        q5 = questionnaire(d, title='December'); code5 = issue(d, q5['id'], ENR2)[0]['code']
        ok('(setup) card answers December', card_answer(d, t2, ENR2, q5['id'], {text_q(q5): 'card'}).get('ok'))
        ok('the card answered first: the printed slip opens as used', d.service("student_submit.open(:c, 'ip-1')", c=code5).get('error') == 'used')
        # Locked card: cannot open or send a questionnaire; may still read the lists.
        d.run('update student_card set locked_at = now() where enrollment_id = :e and stopped_at is null', e=ENR1)
        ok('a locked card: form and answer are card_locked; forms still reads',
           d.svc('form', t1, ENR1, q3['id']).get('error') == 'card_locked'
           and card_answer(d, t1, ENR1, q3['id'], {text_q(q3): 'x'}).get('error') == 'card_locked'
           and d.svc('forms', t1, ENR1).get('ok') is True)
        d.run('update student_card set locked_at = null where enrollment_id = :e', e=ENR1)
        # Ten answers an hour for a card.
        d.run("insert into student_submit.write_log (card_id, kind) select :c, 'answer' from generate_series(1, 10)",
              c=d.one('select id from student_card where enrollment_id = :e and stopped_at is null', e=ENR1))
        r = card_answer(d, t1, ENR1, q3['id'], {text_q(q3): 'x'})
        ok('the eleventh answer in an hour is too_many', r.get('error') == 'too_many' and r.get('retry_after_s', 0) >= 1, r)

        # Phone reports.
        data1 = {'name': 'Cece Learner', 'overall': {'word': 'Proficient', 'text': 'Cece is steady.', 'level': 3}, 'comment': ['Keep reading.']}
        data2 = {'name': 'Stu Two', 'overall': {'word': 'Developing', 'text': 'x', 'level': 2}, 'comment': ['y']}
        rep = d.rpc("create_phone_report(:c, 1, 'Report 1', current_date + 30, :s::jsonb, :k)", c=COURSE_A,
                    s=json.dumps([{'enrollment_id': ENR1, 'data': data1}, {'enrollment_id': ENR2, 'data': data2}]), k=nid())
        d.rpc('issue_report_codes(:r, null, :k)', r=rep['id'], k=nid())
        f = d.svc('forms', t1, ENR1)
        ok('forms: the phone report sent her, with its result and comment, not opened',
           len(f['reports']) == 1 and f['reports'][0]['overall'] == data1['overall'] and f['reports'][0]['comment'] == data1['comment']
           and f['reports'][0]['opened_at'] is None and f['reports'][0]['title'] == 'Report 1', f)
        ok('forms: nothing of Stu2\'s report in hers', 'Stu Two' not in json.dumps(f) and 'Developing' not in json.dumps(f))
        r = d.svc('report', t1, ENR1, rep['id'])
        ok('report: her copy, as the slip\'s check gives it', r == {'ok': True, 'report': data1}, r)
        ok('report: marked opened for Sent to Phones', d.one("select opened_at is not null from student_access_code where phone_report_id = :r and enrollment_id = :e", r=rep['id'], e=ENR1)
           and d.one("select opened_at is null from student_access_code where phone_report_id = :r and enrollment_id = :e", r=rep['id'], e=ENR2))
        ok('report: another class\'s or no report is not_found', d.svc('report', t1, ENR1, nid()) == {'ok': False, 'error': 'not_found'})
        ok('report: Stu2\'s session naming Cece is not_found', d.svc('report', t2, ENR1, rep['id']) == {'ok': False, 'error': 'not_found'})
        d.run('update phone_report set closed_at = now() where id = :r', r=rep['id'])
        ok('report: closed is report_closed, and forms leaves it out',
           d.svc('report', t1, ENR1, rep['id']) == {'ok': False, 'error': 'report_closed'} and d.svc('forms', t1, ENR1)['reports'] == [])
        # Withdrawn: every route is not_found.
        d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
        ok('withdrawn: forms, form, answer and report are not_found',
           all(x.get('error') == 'not_found' for x in [d.svc('forms', t1, ENR1), d.svc('form', t1, ENR1, q3['id']),
                                                      card_answer(d, t1, ENR1, q3['id'], {text_q(q3): 'x'}), d.svc('report', t1, ENR1, rep['id'])]))
    finally:
        d.close()

# ── edge: the four new routes' statements, as forms-routes.ts writes them ──
def edge_statements():
    text = open(os.path.join(HERE, '..', '..', 'supabase', 'functions', 'student-submit', 'forms-routes.ts')).read()
    block = text[text.index('export const SQL = {'):]
    block = block[:block.index('};')]
    return {n: ''.join(re.findall(r"'([^']*)'", b)) for n, b in re.findall(r"(\w+):\s*((?:'[^']*'\s*)+)", block)}
def as_edge(d, sql, *params):
    named = re.sub(r'\$(\d+)', lambda m: ':p' + m.group(1), sql)
    kw = {'p%d' % (i + 1): (None if v is None else str(v)) for i, v in enumerate(list(params) + ['ab' * 32])}
    return d._as('service_role', None, named, kw)[0][0]

@scenario('edge', without=False)
def scen_edge():
    st = edge_statements()
    ok("forms-routes.ts names the four statements", sorted(st) == ['answer', 'form', 'forms', 'report'], st)
    d, k, t1, t2 = world('edge')
    try:
        q = questionnaire(d); issue(d, q['id'], ENR1)
        f = as_edge(d, st['forms'], t1, ENR1)
        ok('forms, as the edge sends it', f.get('ok') and [x['id'] for x in f['questionnaires']] == [q['id']], f)
        fm = as_edge(d, st['form'], t1, ENR1, q['id'])
        ok('form, as the edge sends it', fm.get('ok') and fm['parts'][0]['id'] == q['id'], fm)
        a = as_edge(d, st['answer'], t1, ENR1, q['id'], json.dumps({text_q(q): 'From the card.'}))
        ok('answer, as the edge sends it (the answers as JSON text)', a.get('ok') is True, a)
        r = as_edge(d, st['report'], t1, ENR1, nid())
        ok('report, as the edge sends it', r == {'ok': False, 'error': 'not_found'}, r)
    finally:
        d.close()

# ── e3 ──────────────────────────────────────────────────────────────────────
def note(d, e, a, text, uid=A): return d.rpc('save_score_report_note(:e, :a, :n, :k)', uid, e=e, a=a, n=text, k=nid())
def row(d, a, e):
    r = d.rpc('list_course_grade_returns(:c)', c=COURSE_A)
    return (r.get(a) or {}).get(e)

@scenario('e3')
def scen_e3():
    d, k, t1, t2 = world('e3')
    try:
        lab = k['lab']
        d.score(ENR1, lab, 7); note(d, ENR1, lab, 'Strong labelling.'); d.return_work(lab, [ENR1])
        r = row(d, lab, ENR1)
        check('(setup) returned, no draft: nothing held', r and not r.get('is_draft') and 'held_note_at' not in r, r)
        note(d, ENR1, lab, 'Strong labelling, and units.')
        r = row(d, lab, ENR1)
        check('a note changed with no regrade open is not held: it shows at once', 'held_note_at' not in r, r)
        d.score(ENR1, lab, 8)
        r = row(d, lab, ENR1)
        check('(setup) a regrade: a draft on a returned grade', r['is_draft'] and r.get('returned_at'), r)
        check('no note changed yet: nothing held', 'held_note_at' not in r, r)
        note(d, ENR1, lab, 'Now explains the method.')
        r = row(d, lab, ENR1)
        check('the first note change during the regrade holds the note the returned grade went out with',
              r.get('held_note') == 'Strong labelling, and units.' and r.get('held_note_at') == r['returned_at'], r, differs=True)
        note(d, ENR1, lab, 'Now explains the method well.')
        r = row(d, lab, ENR1)
        check('a second change keeps the first held note', r.get('held_note') == 'Strong labelling, and units.', r, differs=True)
        check('the working note is the newest', d.one('select report_note from score where enrollment_id = :e and assessment_id = :a', e=ENR1, a=lab) == 'Now explains the method well.')
        d.return_work(lab, [ENR1])
        r = row(d, lab, ENR1)
        check('returned: nothing held is sent (the new note prints now)', 'held_note_at' not in r and 'held_note' not in r, r)
        d.score(ENR1, lab, 9)
        r = row(d, lab, ENR1)
        check('the next regrade: the old hold does not come back', 'held_note_at' not in r, r)
        note(d, ENR1, lab, 'Next.')
        r = row(d, lab, ENR1)
        check('the next regrade holds the note of its own returned grade', r.get('held_note') == 'Now explains the method well.', r, differs=True)
        # No note before: the held note is empty (held_note_at only).
        ess = k['rub']
        d.run("update assessment set score_mode = 'points', max_points = 10 where id = :a", a=ess)
        d.score(ENR2, ess, 5); d.return_work(ess, [ENR2]); d.score(ENR2, ess, 6); note(d, ENR2, ess, 'A first note.')
        r = row(d, ess, ENR2)
        check('no note when it was returned: held as empty (held_note_at, no held_note)', r.get('held_note_at') == r.get('returned_at') and 'held_note' not in r, r, differs=True)
        # A class that does not hold grades never has a draft, so never a hold.
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        d.score(ENR1, lab, 6); note(d, ENR1, lab, 'At once.')
        r = row(d, lab, ENR1)
        check('a class that returns at once: nothing held', r and 'held_note_at' not in r, r)
        # Another teacher cannot make a hold on Teacher A's student.
        d.run("update course set return_grades = 'on_return' where id = :c", c=COURSE_A)
        if has_file(d):
            d.score(ENR1, lab, 5)
            d.run('update grade_return set held_note = null, held_note_at = null')
            d.teacher('fv_private.report_note_hold(:e, :a)', B, e=ENR1, a=lab)
            check("Teacher B's call holds nothing on Teacher A's student", d.one('select count(*) from grade_return where held_note_at is not null') == 0)
        check('no grade, score or copy is written by a note save beyond the note itself (no new draft)',
              d.one("select count(*) from grade_return where is_draft and returned_at is null") == 0)
    finally:
        d.close()

# ── apply ───────────────────────────────────────────────────────────────────
def procs(d):
    return d.all("""select n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')',
                           md5(pg_get_functiondef(p.oid))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'student_submit', 'fv_private') order by 1""")

@scenario('apply', without=False)
def scen_apply():
    text = text_at(FILE)
    sts = split(text)
    ok('the file is one transaction: begin first, commit last', bare(sts[0]).lower() == 'begin' and bare(sts[-1]).lower() == 'commit')
    d = CDb('be_apply', template=template(False)); k = seed(d)
    try:
        t1 = d.session(ENR1)
        returned_with_marks(d, k, t1, ENR1, k['lab'], 'x')
        pre = d.file(PRE)
        ok('the pre-check on the database as live will be: no rows', pre == 'ok' and d.rows == [], (pre, d.rows))
        post = d.file(POST)
        ok('the post-check before the apply lists what is missing', post == 'ok' and len(d.rows) >= len(NEW) + len(REPLACES), (post, len(d.rows)))
        def stopped(setup, want):
            d.begin()
            try:
                for st in setup: d.run(st)
                r = d.statements(split(text))
            finally:
                try: d.rollback()
                except Exception: pass
            return r.startswith('STOPPED') and want in r, r
        for label, setup, want in [
            ('with a relied-on function changed', ["create or replace function public._work_bucket() returns text language sql immutable as $f$ select 'x' $f$"], 'is not the definition'),
            ('with a function it replaces changed', ["create or replace function student_submit.work(p_session_token text, p_enrollment_id uuid, p_ip_hash text) returns jsonb language sql as $f$ select '{}'::jsonb $f$"], 'is not the definition'),
            ('with a function of its name already there', ["create function student_submit._write_limit(uuid, text, integer) returns jsonb language sql as $f$ select null::jsonb $f$"], 'already exists'),
            ('with Batch D not applied', ['drop function public.photo_removal_call()'], 'Batch D'),
        ]:
            good, r = stopped(setup, want)
            ok('it stops, with nothing changed, %s' % label, good, r)
        before = dict(procs(d)); rows_before = row_checksums(d.c)
        r = d.statements(sts)
        ok('it applies on a database in use', r == 'ok', r)
        after = dict(procs(d))
        changed = sorted(p for p in before if before[p] != after.get(p))
        added = sorted(set(after) - set(before))
        ok('the only existing functions changed are the ones it replaces', changed == sorted(REPLACES), changed)
        ok('it adds exactly its new functions', added == sorted(NEW), added)
        rows_after = row_checksums(d.c)
        moved = [t for t in rows_before if rows_before[t] != rows_after.get(t) and t != 'public.grade_return']
        ok('no existing row changes (grade_return gains two columns, checked next)', not moved, moved)
        ok('grade_return: the same rows, the two new columns empty on every one',
           d.one('select count(*) from grade_return where held_note is not null or held_note_at is not null') == 0
           and d.one('select count(*) from grade_return') >= 1)
        ok('the post-check after: no rows', d.file(POST) == 'ok' and d.rows == [], d.rows)
        cat1 = catalog(d.c)
        r2 = d.file(FILE)
        ok('a second run: applies, changes nothing', r2 == 'ok' and catalog(d.c) == cat1, (r2, differences(cat1, catalog(d.c))))
        student = [f for f in REPLACES + NEW if f.startswith('student_submit.')]
        for role in ('anon', 'authenticated'):
            for fn in student:
                can = d.one("select has_function_privilege(:r, :f, 'execute')", r=role, f=fn)
                ok('%s cannot run %s' % (role, fn), not can)
        for fn in ['public.save_score_report_note(uuid,uuid,text,uuid)', 'public.list_course_grade_returns(uuid)',
                   'fv_private.report_note_hold(uuid,uuid)']:
            ok('%s: the signed-in teacher can run it, anon cannot' % fn,
               d.one("select has_function_privilege('authenticated', :f, 'execute')", f=fn)
               and not d.one("select has_function_privilege('anon', :f, 'execute')", f=fn))
        ok('the service role runs the student functions, and not _write_limit',
           all(d.one("select has_function_privilege('service_role', :f, 'execute')", f=f) for f in REPLACES)
           and not d.one("select has_function_privilege('service_role', 'student_submit._write_limit(uuid,text,integer)', 'execute')"))
        ok('write_log: row security on, no grant to the API roles',
           d.one("select relrowsecurity from pg_class where oid = 'student_submit.write_log'::regclass")
           and not any(d.one("select has_table_privilege(:r, 'student_submit.write_log', 'select')", r=r) for r in ('anon', 'authenticated')))
    finally:
        d.close()

# ── undo ────────────────────────────────────────────────────────────────────
@scenario('undo', without=False)
def scen_undo():
    d = CDb('be_undo', template=template(False)); k = seed(d)
    try:
        cat0 = catalog(d.c); p0 = procs(d)
        r0 = d.file(UNDO)
        ok('the undo where the file was never applied: runs, changes nothing', r0 == 'ok' and catalog(d.c) == cat0, (r0, differences(cat0, catalog(d.c))))
        ok('the file applies', d.file(FILE) == 'ok')
        t1 = d.session(ENR1)
        returned_with_marks(d, k, t1, ENR1, k['lab'], 'x')
        d.reflect(t1, ENR1, k['lab'], {'makes_sense': 'yes', 'plan': 'p'})
        r = d.file(UNDO)
        ok('the undo runs with rows in write_log', r == 'ok', r)
        cat = catalog(d.c)
        diff = differences(cat0, cat)
        # Postgres keeps a dropped column's slot (attisdropped): the catalog differs only by that.
        ok('the catalog is as before the file, but for the two dropped columns\' slots in grade_return',
           diff == ([], ['dropped columns public.grade_return | 2']) or cat == cat0, diff)
        ok('every function as before', procs(d) == p0)
        r9 = d.file(UNDO)
        ok('the undo a second time: runs, changes nothing', r9 == 'ok' and catalog(d.c) == cat, r9)
        ok('the file applies again after the undo', d.file(FILE) == 'ok')
    finally:
        d.close()

# ── fingerprints ────────────────────────────────────────────────────────────
def cmd_fingerprints(check_only):
    d0 = CDb('be_fp0', template=template(False))
    try:
        relied = fingerprints(d0, RELIED); before = fingerprints(d0, REPLACES)
        r = d0.statements(split(neutral(text_at(FILE))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        new_ = fingerprints(d0, NEW); after_ = fingerprints(d0, REPLACES)
    finally:
        d0.close()
    lists = {'relied': [(f, relied[f] or 'absent') for f in RELIED], 'new': [(f, new_[f] or 'absent') for f in NEW],
             'replaces': [(f, before[f] or 'absent', after_[f] or 'absent') for f in REPLACES]}
    # The undo's bodies: each replaced function as the database before the file has it, word for word.
    d1 = CDb('be_fp1', template=template(False))
    try:
        bodies = '\n'.join(d1.one('select pg_get_functiondef(to_regprocedure(:f))', f=f).rstrip() + ';\n' for f in REPLACES)
    finally:
        d1.close()
    stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel)
        if not os.path.exists(path): continue
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
        names = args or list(SCENARIOS)
        for n in names:
            base = n[:-len('-without')] if n.endswith('-without') else n
            f, without = SCENARIOS[base]
            if n.endswith('-without'):
                MODE['fixed'] = False; f(); MODE['fixed'] = True
            else:
                f()
                if without and not args: MODE['fixed'] = False; f(); MODE['fixed'] = True
    finally:
        drop_templates()
    finish()
