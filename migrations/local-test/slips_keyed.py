"""Slips move to the card key (plan S3-S1, "E7"): migrations/2026111160_slips_keyed.sql,
applied after Batch E (2026111150), on the database Batch E's harness builds.

    PGDATABASE=sk python3 batch_c_common.py build        an EMPTY database: live with Batch B and its fixes
    PGDATABASE=sk python3 slips_keyed.py                 every scenario below
    PGDATABASE=sk python3 slips_keyed.py old new ...     or some
    PGDATABASE=sk python3 slips_keyed.py fingerprints [check]   write (or check) the lists the four files carry

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

Each scenario prints slips the way live has them until the apply (the old
teacher RPCs, issue_access_codes and issue_report_codes, on the database
before the file), applies the file to its own copy, and then acts as the
two edge functions do with a fixed FAKE key: student-submit tags what the
phone sent and asks once more with the plain code or password only when
the database says so (`fallback`); teacher-cards draws codes, tags them and
hands student_submit.issue_slips the tags. Every call's parameters are
recorded, so a check can say where a plain code or password went.

  new        a new slip opens by its tag; its password (a student with no birthday) by tags; Is This You
             and submit; no plain code or password reaches the database
  old        a slip printed before the file opens, converts (hash and salt gone, tag stored), opens again by
             tag with no fallback; its password works before and after its tag is stored; a page that sends no
             code still checks the plain password; the stored password goes once no slip needs it
  wrong      a wrong code is counted once (with and without a slip left to convert); a wrong password once
  revoked    a reprinted slip, a used one, a closed questionnaire, a slip past its date, a withdrawn student
  straggler  the end of the old slips: an unconverted slip no longer opens, no stored password is checked,
             converted and new slips carry on
  teacher    issue_slips and slip_roster as the teacher Auth named: another teacher's class, a student of
             another class, not a teacher, a replay, the second candidate, the shape checks, the grants
  report     a phone report's slips: made, opened by tag, checked by birthday; an old one converts; a closed
             report takes none
  card       Batch E's card answer still marks a slip used, and clears a stored password no slip needs
  copy       a copy of the database holds no slip code or password, after conversion and for new slips
  edge       the statements as the two edge functions write them (slip-routes.ts, teacher-cards/index.ts)
  apply      every guard; a database in use; what changes and what does not; a second run; the pre-check and
             post-check
  undo       the undo puts the functions back, keeps the tags, and the file applies again
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_c_common import *
import batch_c_common as bc
import card_codes_common as cc
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111160_slips_keyed.sql'
BATCH_E = '../2026111150_student_page_last_changes.sql'
SEND_RULES = '../2026111130_student_send_rules.sql'
BATCH_D = '../2026111140_photo_lifecycle.sql'
STAND = 'photo-lifecycle-stand-in.sql'
UNDO = 'slips-keyed-undo.sql'
PRE = 'slips-keyed-live-precheck.sql'
POST = 'slips-keyed-live-postcheck.sql'
LIST_FILES = [FILE, UNDO, PRE, POST]

RELIED = ['student_submit._log(text,text,text,uuid,uuid)', 'student_submit._closed_reason(questionnaire,text)',
          'student_submit._preview(uuid)', 'student_submit._payload(uuid)', 'student_submit._norm(text)',
          'student_submit._as_teacher(uuid)', 'public._access_code_hash(text,text)', 'public.fv_owns_course(uuid)',
          'public.fv_owns_enrollment(uuid)', 'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
          # Not changed, and relied on to stay as they are: they read a slip by its row, never by its code, and
          # mark it opened or used (the trigger then settles the stored password).
          'student_submit."check"(text,text,text)', 'student_submit.submit(text,jsonb,text)',
          'student_submit.answer(text,uuid,uuid,jsonb,text)', 'student_submit._card_listed(uuid,uuid)',
          'student_submit.forms(text,uuid,text)', 'student_submit.report(text,uuid,uuid,text)']
DROPS = ['student_submit.open(text,text)', 'student_submit.verify(text,text,text,text,text)',
         'public.issue_access_codes(uuid,uuid[],uuid)', 'public.issue_report_codes(uuid,uuid[],uuid)',
         'public._issue_access_code(uuid,uuid,timestamp with time zone)',
         'public._issue_report_code(uuid,uuid,timestamp with time zone)', 'public._new_access_code()',
         'public._slip_password(uuid)']
NEW = ['student_submit._slip_old_until()', 'public._slip_password_settle(uuid)', 'public._slip_password_on_change()',
       'student_submit.open(text,text,text,text)', 'student_submit.verify(text,text,text,text,text,text,text)',
       'student_submit.slip_roster(uuid,text,uuid)', 'student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)']

# ── the lists: written by script, never by hand ─────────────────────────────
LISTS = re.compile(r'(-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def neutral(text):
    """The text with every list stood aside, so it applies whatever the lists hold."""
    return LISTS.sub(lambda m: m.group(1) + "            ('public.no_such_function_at_all()', 'absent')" + m.group(4), text)
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

# ── the template: live as the file meets it (through Batch E) ───────────────
_TPL = {}
def template():
    if 'base' in _TPL: return _TPL['base']
    name = '%s_sk' % cc.BASE_DB
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in [C1, C2, SEND_RULES, STAND, BATCH_D, BATCH_E]:
        for st in split(text_at(rel)):
            try: c.run(st)
            except Exception as e:
                c.close(); ok('%s applies to the template' % os.path.basename(rel), False, message(e)); finish()
    c.close(); _TPL['base'] = name
    return name
def drop_templates():
    for name in _TPL.values(): admin('drop database if exists "%s" with (force)' % name)

# ── the edge functions' part, with the fake key ─────────────────────────────
SLIP = re.compile('^[%s]{6}$' % cc.ALPHABET)
def slip_tag(code, key=cc.FAKE_KEY): return cc._tag(key, 'fv.slip.code.v1\n' + cc.tidy(code))
def slip_pw_tag(code, digits, key=cc.FAKE_KEY): return cc._tag(key, 'fv.slip.pass.v1\n' + cc.tidy(code) + '\n' + cc.tidy(digits))
def draw_slip(): return ''.join(cc.secrets.choice(cc.ALPHABET) for _ in range(6))
def pretty(code): return code[:3] + '-' + code[3:]

class SDb(CDb):
    """A scenario's copy, with the two edge functions' calls recorded."""
    def __init__(self, tag, template=None):
        super().__init__(tag, template=template); self.calls = []
    def call(self, sql, **kw):
        self.calls.append(dict(kw)); return self.service(sql, **kw)
    # student-submit's open, as slip-routes.ts does it
    def open_slip(self, typed, ip='ip-1', key=cc.FAKE_KEY):
        code = cc.tidy(typed)
        tag = slip_tag(code, key) if SLIP.match(code) else None
        r = self.call('student_submit.open(:t, :k, :c, :i)', t=tag, k=cc.key_id(key), c=None, i=ip)
        if tag and r.get('fallback') is True:
            r = self.call('student_submit.open(:t, :k, :c, :i)', t=tag, k=cc.key_id(key), c=code, i=ip)
        r = dict(r); r.pop('fallback', None); return r
    # student-submit's verify for a slip: `code` is what the page opened with (None: a page that sends none)
    def verify_slip(self, token, code=None, birthday=None, number=None, password=None, ip='ip-1', key=cc.FAKE_KEY):
        c = cc.tidy(code) if code else ''
        is_slip = bool(SLIP.match(c))
        ctag = slip_tag(c, key) if is_slip else None
        ptag = slip_pw_tag(c, password, key) if is_slip and password is not None else None
        ask = lambda pw, pt: self.call('student_submit.verify(:t, :b, :n, :p, :ch, :ph, :i)', t=token, b=birthday, n=number,
                                       p=pw, ch=ctag, ph=pt, i=ip)
        if ptag:
            r = ask(None, ptag)
            if r.get('fallback') is True: r = ask(password, ptag)
        else:
            r = ask(password, None)
        r = dict(r); r.pop('fallback', None); return r
    def check_slip(self, token, birthday, ip='ip-1'):
        return self.service('student_submit."check"(:t, :b, :i)', t=token, b=birthday, i=ip)
    def submit_slip(self, token, answers, ip='ip-1'):
        return self.service('student_submit.submit(:t, :a::jsonb, :i)', t=token, a=json.dumps(answers), i=ip)
    # teacher-cards' slips route, as slips.ts does it
    def roster(self, kind, target, teacher=A):
        return self.service('student_submit.slip_roster(:t, :k, :g)', t=teacher, k=kind, g=target)
    def issue_new(self, kind, target, enrollments=None, teacher=A, idem=None, key=cc.FAKE_KEY, items=None):
        """(the database's reply, {enrollment: (code, password or None)} for the slips made)."""
        ids = enrollments if enrollments is not None else self.roster(kind, target, teacher)
        drawn = {}; built = []
        for e in ids:
            codes = [draw_slip(), draw_slip()]; pw = cc.draw_pw()
            drawn[e] = (codes, pw)
            built.append({'enrollment_id': e, 'candidates': [{'code_hmac': slip_tag(x, key), 'pw_hmac': slip_pw_tag(x, pw, key)} for x in codes]})
        if items is not None: built = items
        self.calls.append({'items': json.dumps(built)})
        r = self.service('student_submit.issue_slips(:t, :k, :g, :i::jsonb, :kid, :d)', t=teacher, k=kind, g=target,
                         i=json.dumps(built), kid=cc.key_id(key), d=idem or nid())
        made = {}
        for x in r['results']:
            if x['result'] == 'made' and 'candidate' in x:
                codes, pw = drawn[x['enrollment_id']]
                made[x['enrollment_id']] = (codes[x['candidate']], pw if x['has_password'] else None)
        return r, made
    def sent_plain(self, value):
        """The recorded calls that carried `value` (a code or a password) as a parameter."""
        return [c for c in self.calls if any(v is not None and str(v) == value for v in c.values())]

def questionnaire(d, title='November Reflection', opens=-1, closes=7, kind='core_reflection', tpl='core-8-1'):
    return d.rpc("upsert_questionnaire(:c, :kind, :t, :tpl, p_report_period => 1, p_opens_on => current_date + :o::int, "
                 "p_closes_on => current_date + :cl::int, p_idempotency_key => :k)", c=COURSE_A, kind=kind, t=title, tpl=tpl,
                 o=opens, cl=closes, k=nid())
def old_issue(d, qid, *enrollments):
    """Slips as live prints them until the apply: {enrollment: (code, password or None)}."""
    r = d.rpc('issue_access_codes(:q, :ids::uuid[], :k)', q=qid, ids='{%s}' % ','.join(enrollments), k=nid())
    return {x['enrollment_id']: (cc.tidy(x['code']), x.get('password')) for x in r}
def phone_report(d, title='Report 1', expires=30):
    data = [{'enrollment_id': ENR1, 'data': {'name': 'Cece Learner', 'overall': {'word': 'Proficient', 'text': 'Steady.', 'level': 3}}},
            {'enrollment_id': ENR2, 'data': {'name': 'Marcus Lee', 'overall': {'word': 'Developing', 'text': 'x', 'level': 2}}}]
    return d.rpc("create_phone_report(:c, 1, :t, current_date + :x::int, :s::jsonb, :k)", c=COURSE_A, t=title, x=expires,
                 s=json.dumps(data), k=nid())
def text_q(q): return [x['id'] for x in q['questions'] if x['kind'] == 'text'][0]
def has_file(d): return d.one("select to_regprocedure('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)') is not null")
def row_of(d, e, qid=None, rid=None):
    return d.all("""select id::text, code_hash is not null, salt is not null, code_hmac, pw_hmac, key_id, converted_at is not null,
                           revoked_at is not null, used_at is not null
                      from student_access_code where enrollment_id = :e and (questionnaire_id = :q or phone_report_id = :r)
                     order by created_at desc limit 1""", e=e, q=qid, r=rid)[0]
def attempts(d, outcome=None):
    return d.one("select count(*) from student_submit.attempt where route = 'open'" + (" and outcome = :o" if outcome else ''),
                 **({'o': outcome} if outcome else {}))
def stored_pw(d, stu): return d.one('select slip_password from student where id = :s', s=stu)

def world(tag, prep=None):
    """A copy of the template with Teacher A's class seeded; `prep(d, k)` runs before the file (old slips are
    printed there); then the file. Marcus (ENR2) has no birthday and no student number: his slips carry a password."""
    d = SDb('sk_' + tag, template=template()); k = seed(d)
    d.run('update student set date_of_birth = null, student_number = null where id = :s', s=STU2)
    k['before'] = prep(d, k) if prep else None
    r = d.file(FILE)
    if r != 'ok':
        ok('(setup) the file applies for %s' % tag, False, r); d.close(); finish()
    d.calls = []
    return d, k

SCENARIOS = {}
def scenario(name):
    def reg(f): SCENARIOS[name] = f; return f
    return reg

# ── new ─────────────────────────────────────────────────────────────────────
@scenario('new')
def scen_new():
    d, k = world('new')
    try:
        q = questionnaire(d)
        r, made = d.issue_new('questionnaire', q['id'])
        ok('issue_slips: a slip for each student of the class, in roster order',
           [x['enrollment_id'] for x in r['results']] == [ENR1, ENR2] and all(x['result'] == 'made' for x in r['results']), r)
        ok('a password only for the student with no birthday or number', made[ENR1][1] is None and made[ENR2][1] is not None, made)
        row = row_of(d, ENR2, q['id'])
        ok('the new row: a tag and a password tag, the key id, no hash, no salt',
           row[1] is False and row[2] is False and row[3] == slip_tag(made[ENR2][0]) and row[4] == slip_pw_tag(*made[ENR2])
           and row[5] == cc.KEY_ID, row)
        ok('Cece\'s row has no password tag', row_of(d, ENR1, q['id'])[4] is None)
        before = attempts(d); d.calls = []
        o = d.open_slip(pretty(made[ENR1][0]).lower())
        ok('a new slip opens by its tag (typed with a dash, in lower case)', o.get('ok') and o['kind'] == 'questionnaire'
           and o['student']['first_name'] == 'CeCe' and o['check'] == 'identity' and o['also_password'] is False, o)
        ok('...in one call: no fallback asked', len(d.calls) == 1 and d.calls[0]['c'] is None, d.calls)
        ok('...logged once, as ok', attempts(d) == before + 1 and attempts(d, 'ok') == 1)
        v = d.verify_slip(o['token'], code=made[ENR1][0], birthday='2012-05-15')
        ok('Is This You by birthday: the questions', v.get('ok') and v['parts'][0]['id'] == q['id'], v)
        s = d.submit_slip(o['token'], {text_q(q): 'I asked more questions.'})
        ok('submit: taken, and the slip is used', s.get('ok') and row_of(d, ENR1, q['id'])[8], s)
        ok('opened again: used', d.open_slip(made[ENR1][0]) == {'ok': False, 'error': 'used'})
        # Marcus: a password of the slip's own.
        o2 = d.open_slip(made[ENR2][0])
        ok('Marcus\'s slip asks for its password', o2.get('ok') and o2['check'] == 'password', o2)
        d.calls = []
        v2 = d.verify_slip(o2['token'], code=made[ENR2][0], password=made[ENR2][1])
        ok('his printed password matches by tags', v2.get('ok') is True, v2)
        ok('...in one call, with no typed password sent', len(d.calls) == 1 and d.calls[0]['p'] is None, d.calls)
        ok('the database never got a code or a password as a parameter',
           not d.sent_plain(made[ENR1][0]) and not d.sent_plain(made[ENR2][0]) and not d.sent_plain(made[ENR2][1]),
           (d.sent_plain(made[ENR2][1])))
        ok('nothing stored for him: slip_password stays empty', stored_pw(d, STU2) is None)
        # A reprint: a new code and a new password; the old slip stops.
        r2, made2 = d.issue_new('questionnaire', q['id'], [ENR2])
        ok('a reprint: a new code, a new password', made2[ENR2][0] != made[ENR2][0] and made2[ENR2][1] is not None, made2)
        ok('the reprinted slip no longer opens', d.open_slip(made[ENR2][0]) == {'ok': False, 'error': 'not_found'})
        o3 = d.open_slip(made2[ENR2][0])
        v3 = d.verify_slip(o3['token'], code=made2[ENR2][0], password=made[ENR2][1] if made[ENR2][1] != made2[ENR2][1] else '0000x')
        ok('the old password on the new slip is wrong', v3.get('error') == 'wrong_identity', v3)
        v4 = d.verify_slip(o3['token'], code=made2[ENR2][0], password=made2[ENR2][1])
        ok('the new one is right', v4.get('ok') is True, v4)
        # A page cached from before the change sends no code: a new slip's password cannot be checked then.
        o5 = d.open_slip(made2[ENR2][0]); d.submit_slip(o3['token'], {});
        v5 = d.verify_slip(o5['token'], code=None, password=made2[ENR2][1])
        ok('a page that sends no code cannot check a new slip\'s password (it is a tag only)', v5.get('error') == 'wrong_identity', v5)
    finally:
        d.close()

# ── old ─────────────────────────────────────────────────────────────────────
def print_old(d, k):
    q = questionnaire(d); q2 = questionnaire(d, title='Second Look')
    return {'q': q, 'q2': q2, 'slips': old_issue(d, q['id'], ENR1, ENR2), 'slips2': old_issue(d, q2['id'], ENR2)}

@scenario('old')
def scen_old():
    d, k = world('old', print_old)
    try:
        b = k['before']; q = b['q']; code1 = b['slips'][ENR1][0]; code2, pw2 = b['slips'][ENR2]
        ok('(setup) the old print gave Marcus a stored password, the same on both his slips',
           pw2 and stored_pw(d, STU2) == pw2 and b['slips2'][ENR2][1] == pw2, (pw2, stored_pw(d, STU2)))
        row = row_of(d, ENR1, q['id'])
        ok('before its first scan: an old slip keeps its hash and salt, and has no tag', row[1] and row[2] and row[3] is None, row)
        o = d.open_slip(code1)
        ok('an old printed slip opens', o.get('ok') and o['kind'] == 'questionnaire' and o['check'] == 'identity', o)
        ok('...by a second call with the plain code, asked for by the first',
           len(d.calls) == 2 and d.calls[0]['c'] is None and d.calls[1]['c'] == code1, d.calls)
        ok('...and the scan is logged once', attempts(d) == 1 and attempts(d, 'ok') == 1, attempts(d))
        row = row_of(d, ENR1, q['id'])
        ok('it converts: hash and salt gone, its tag and the key id stored, converted_at set',
           not row[1] and not row[2] and row[3] == slip_tag(code1) and row[5] == cc.KEY_ID and row[6], row)
        d.calls = []
        o2 = d.open_slip(code1)
        ok('it opens again by its tag, in one call, the plain code not sent',
           o2.get('ok') and len(d.calls) == 1 and d.calls[0]['c'] is None, (o2, d.calls))
        v = d.verify_slip(o2['token'], code=code1, birthday='2012-05-15')
        ok('Is This You by birthday', v.get('ok'), v)
        # Marcus: his printed password, before and after its tag is stored.
        o3 = d.open_slip(code2)
        ok('Marcus\'s old slip opens and asks for his password', o3.get('ok') and o3['check'] == 'password', o3)
        d.calls = []
        v3 = d.verify_slip(o3['token'], code=code2, password=pw2)
        ok('his printed password works (the stored one, compared once)', v3.get('ok') is True, v3)
        ok('...the typed password sent only on the second call, asked for by the first',
           len(d.calls) == 2 and d.calls[0]['p'] is None and d.calls[1]['p'] == pw2, d.calls)
        ok('...not counted as a wrong try', d.one("select count(*) from student_submit.attempt where outcome = 'wrong_identity'") == 0)
        row = row_of(d, ENR2, q['id'])
        ok('the slip now keeps its password\'s tag, bound to its code', row[4] == slip_pw_tag(code2, pw2), row)
        ok('the stored password stays: his other old slip still needs it', stored_pw(d, STU2) == pw2)
        o4 = d.open_slip(code2); d.calls = []
        v4 = d.verify_slip(o4['token'], code=code2, password=pw2)
        ok('after its tag is stored: the password matches by tags, in one call',
           v4.get('ok') is True and len(d.calls) == 1 and d.calls[0]['p'] is None, (v4, d.calls))
        o5 = d.open_slip(code2)
        v5 = d.verify_slip(o5['token'], code=None, password=pw2)
        ok('a page that sends no code: the plain password is still checked while it is stored', v5.get('ok') is True, v5)
        # The second slip: once its password has its tag, no live slip needs the stored one.
        code3 = b['slips2'][ENR2][0]
        o6 = d.open_slip(code3); v6 = d.verify_slip(o6['token'], code=code3, password=pw2)
        ok('his second old slip converts and takes its password\'s tag', v6.get('ok') and row_of(d, ENR2, b['q2']['id'])[4], v6)
        ok('then the stored password is cleared: no live slip needs it', stored_pw(d, STU2) is None)
        o7 = d.open_slip(code3); v7 = d.verify_slip(o7['token'], code=code3, password=pw2)
        ok('and the printed password still works, by tags', v7.get('ok') is True, v7)
        o8 = d.open_slip(code3); v8 = d.verify_slip(o8['token'], code=None, password=pw2)
        ok('a page that sends no code cannot check it any more (nothing plain is left)', v8.get('error') == 'wrong_identity', v8)
        # Two scans of one old slip at once: the second finds it converted.
        q3 = questionnaire(d, title='Third')
        if d.one("select to_regprocedure('public.issue_access_codes(uuid,uuid[],uuid)') is null"):
            ok('(the old issuer is gone after the file)', True)
    finally:
        d.close()

@scenario('race')
def scen_race():
    """Two scans of the same unconverted slip at once: both open it."""
    def prep(d, k):
        q = questionnaire(d); return {'q': q, 'slips': old_issue(d, q['id'], ENR1)}
    d, k = world('race', prep)
    try:
        code = k['before']['slips'][ENR1][0]; tag = slip_tag(code)
        other = d.other(); other.run('begin')
        other.run('set role service_role')
        r1 = other.run("select student_submit.open(:t, :k, :c, 'ip-2')", t=tag, k=cc.KEY_ID, c=code)[0][0]
        ok('(setup) the first scan converted it, not yet committed', r1.get('ok'), r1)
        import threading
        out = {}
        def second():
            c2 = connect(d.name); c2.run('set role service_role')
            out['r'] = c2.run("select student_submit.open(:t, :k, :c, 'ip-3')", t=tag, k=cc.KEY_ID, c=code)[0][0]; c2.close()
        t = threading.Thread(target=second); t.start(); t.join(1.0)
        other.run('commit'); other.close(); t.join(10)
        ok('the second scan, which waited, finds it by its tag and opens it', out.get('r', {}).get('ok') is True, out)
    finally:
        d.close()

# ── wrong ───────────────────────────────────────────────────────────────────
@scenario('wrong')
def scen_wrong():
    d, k = world('wrong', print_old)
    try:
        r = d.open_slip('ABC234')
        ok('a wrong code, while an old slip is left to convert: not_found', r == {'ok': False, 'error': 'not_found'}, r)
        ok('...two calls (the second with the code), and counted once', len(d.calls) == 2 and attempts(d, 'not_found') == 1, (d.calls, attempts(d)))
        r = d.open_slip('K7M-4Q')
        ok('not six characters of the alphabet: one call, no tag, counted once as a bad format',
           r == {'ok': False, 'error': 'not_found'} and d.calls[-1]['t'] is None and attempts(d, 'bad_format') == 1, r)
        # Convert every old slip; then a wrong code takes one call.
        for e, (code, _pw) in list(k['before']['slips'].items()) + list(k['before']['slips2'].items()):
            d.open_slip(code)
        ok('(setup) every old slip converted', d.one('select count(*) from student_access_code where code_hash is not null') == 0)
        d.calls = []; n = attempts(d, 'not_found')
        r = d.open_slip('ABC234')
        ok('no old slip left: a wrong code is answered in one call, the plain code never sent, counted once',
           r == {'ok': False, 'error': 'not_found'} and len(d.calls) == 1 and d.calls[0]['c'] is None
           and attempts(d, 'not_found') == n + 1, (r, d.calls))
        # Three hundred guesses from one address in 15 minutes lock it, as before.
        d.run("insert into student_submit.attempt (route, outcome, ip_hash) select 'open', 'not_found', 'ip-9' from generate_series(1, 300)")
        ok('300 wrong codes from one address: locked, as before', d.open_slip('ABC234', ip='ip-9') == {'ok': False, 'error': 'locked'})
        # A wrong password: counted once, though the stored one is asked for.
        q = k['before']['q']
        d2, k2 = world('wrong2', print_old)
        try:
            code2, pw2 = k2['before']['slips'][ENR2]
            o = d2.open_slip(code2); d2.calls = []
            wrong = '0000' if pw2 != '0000' else '1111'
            v = d2.verify_slip(o['token'], code=code2, password=wrong)
            ok('a wrong password: wrong_identity with four tries left', v == {'ok': False, 'error': 'wrong_identity', 'tries_left': 4}, v)
            ok('...two calls, counted once', len(d2.calls) == 2
               and d2.one("select count(*) from student_submit.attempt where outcome = 'wrong_identity'") == 1)
            ok('...and no tag stored for it', row_of(d2, ENR2, k2['before']['q']['id'])[4] is None)
            for _ in range(4): v = d2.verify_slip(o['token'], code=code2, password=wrong)
            ok('five wrong in all: the slip locks, as before', v == {'ok': False, 'error': 'slip_locked'}, v)
        finally:
            d2.close()
    finally:
        d.close()

# ── revoked ─────────────────────────────────────────────────────────────────
@scenario('revoked')
def scen_revoked():
    d, k = world('revoked', print_old)
    try:
        b = k['before']; q = b['q']; old1 = b['slips'][ENR1][0]
        r, made = d.issue_new('questionnaire', q['id'], [ENR1])
        ok('a reprint over an old unconverted slip takes the old one back', row_of(d, ENR1, q['id'])[7] is False
           and d.one('select revoked_at is not null from student_access_code where enrollment_id = :e and questionnaire_id = :q and code_hash is not null', e=ENR1, q=q['id']))
        ok('the old slip no longer opens (not converted, counted once)', d.open_slip(old1) == {'ok': False, 'error': 'not_found'}
           and attempts(d, 'not_found') == 1)
        new1 = made[ENR1][0]
        ok('the reprint opens', d.open_slip(new1).get('ok'))
        # A converted slip taken back by a reprint.
        code2 = b['slips'][ENR2][0]; d.open_slip(code2)
        d.issue_new('questionnaire', q['id'], [ENR2])
        ok('a converted slip taken back no longer opens, and the fallback is not asked for it',
           d.open_slip(code2) == {'ok': False, 'error': 'not_found'})
        # Past its date (by tag and by hash).
        d.run("update student_access_code set expires_at = now() - interval '1 minute' where enrollment_id = :e and questionnaire_id = :q and revoked_at is null", e=ENR1, q=q['id'])
        ok('a new slip past its date: not_found', d.open_slip(new1) == {'ok': False, 'error': 'not_found'})
        old2 = b['slips2'][ENR2][0]
        d.run("update student_access_code set expires_at = now() - interval '1 minute' where questionnaire_id = :q", q=b['q2']['id'])
        ok('an old slip past its date: not_found, not converted',
           d.open_slip(old2) == {'ok': False, 'error': 'not_found'} and row_of(d, ENR2, b['q2']['id'])[1])
        # Closed, not yet open, withdrawn.
        q4 = questionnaire(d, title='Later', opens=5, closes=9); r4, m4 = d.issue_new('questionnaire', q4['id'], [ENR1])
        o = d.open_slip(m4[ENR1][0])
        ok('not open yet: not_open_yet, as before', o.get('error') == 'not_open_yet', o)
        d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
        ok('a withdrawn student\'s slip: not_found', d.open_slip(m4[ENR1][0]).get('error') == 'not_found')
        r5, m5 = d.issue_new('questionnaire', q4['id'], [ENR1])
        ok('no slip is made for a withdrawn student', r5['results'] == [{'enrollment_id': ENR1, 'result': 'not_found'}], r5)
    finally:
        d.close()

# ── straggler ───────────────────────────────────────────────────────────────
@scenario('straggler')
def scen_straggler():
    d, k = world('straggler', print_old)
    try:
        ok('the end of the old slips is midnight starting July 1, 2027 in Vancouver (the end of June 30)',
           d.one("select student_submit._slip_old_until() = timestamptz '2027-07-01 00:00:00 America/Vancouver'")
           and d.one("select (student_submit._slip_old_until() at time zone 'America/Vancouver')::text") == '2027-07-01 00:00:00')
        b = k['before']; code1 = b['slips'][ENR1][0]; code2, pw2 = b['slips'][ENR2]; code3 = b['slips2'][ENR2][0]
        # Marcus's first slip converts, and its password's tag is stored, before the day.
        o = d.open_slip(code2); d.verify_slip(o['token'], code=code2, password=pw2)
        # The day comes: the constant is stood in for by one just past.
        d.run("create or replace function student_submit._slip_old_until() returns timestamptz language sql stable set search_path to '' "
              "as $f$ select now() - interval '1 second' $f$")
        d.calls = []
        r = d.open_slip(code1)
        ok('after it: an unconverted slip no longer opens', r == {'ok': False, 'error': 'not_found'}, r)
        ok('...in one call: the plain code is no longer asked for', len(d.calls) == 1 and d.calls[0]['c'] is None, d.calls)
        o2 = d.open_slip(code2)
        ok('a converted slip with its own password\'s tag still opens and asks for it', o2.get('ok') and o2['check'] == 'password', o2)
        v2 = d.verify_slip(o2['token'], code=code2, password=pw2)
        ok('...and its printed password still works, by tags', v2.get('ok') is True, v2)
        v3 = d.verify_slip(d.open_slip(code2)['token'], code=None, password=pw2)
        ok('the stored password is no longer checked (a page with no code)', v3.get('error') == 'wrong_identity', v3)
        ok('Marcus\'s second old slip, never scanned: not_found', d.open_slip(code3) == {'ok': False, 'error': 'not_found'})
        q = questionnaire(d, title='After'); r4, m4 = d.issue_new('questionnaire', q['id'])
        ok('new slips carry on', d.open_slip(m4[ENR2][0]).get('check') == 'password' and d.open_slip(m4[ENR1][0]).get('ok'))
        # The leftovers, as the file's header says to erase them after the day.
        d.run("update public.student_access_code set code_hash = null, salt = null, revoked_at = coalesce(revoked_at, now()) "
              "where code_hash is not null and now() >= student_submit._slip_old_until()")
        d.run("update public.student set slip_password = null where slip_password is not null and now() >= student_submit._slip_old_until()")
        ok('the cleanup in the header runs, and leaves no hash, salt or stored password',
           d.one('select count(*) from student_access_code where code_hash is not null or salt is not null') == 0
           and d.one('select count(*) from student where slip_password is not null') == 0)
        ok('after it, converted and new slips still open', d.open_slip(code2).get('ok') and d.open_slip(m4[ENR1][0]).get('ok'))
    finally:
        d.close()

# ── teacher ─────────────────────────────────────────────────────────────────
@scenario('teacher')
def scen_teacher():
    d, k = world('teacher')
    try:
        q = questionnaire(d)
        qb = d.rpc("upsert_questionnaire(:c, 'core_reflection', 'Theirs', 'core-8-1', p_report_period => 1, p_idempotency_key => :k)", B, c=COURSE_B, k=nid())
        e = refused(d, lambda: d.issue_new('questionnaire', q['id'], [ENR1], teacher=B))
        ok("another class's teacher cannot make slips for it: P0002", e and e[1] == 'P0002', e)
        e = refused(d, lambda: d.roster('questionnaire', q['id'], teacher=B))
        ok("...nor list its students", e and e[1] == 'P0002', e)
        e = refused(d, lambda: d.issue_new('questionnaire', q['id'], [ENR1], teacher=nid()))
        ok('not a teacher: PT401', e and e[1] == 'PT401', e)
        r, made = d.issue_new('questionnaire', q['id'], [ENR1, ENR_B])
        ok('a student of another class in the list: not_found for them, a slip for the rest',
           [x['result'] for x in r['results']] == ['made', 'not_found'], r)
        r2, m2 = d.issue_new('questionnaire', qb['id'], [ENR_B], teacher=B)
        ok('Teacher B makes slips for B\'s class', r2['results'][0]['result'] == 'made', r2)
        ok("a code from another class opens as that class's slip (B's student, B's course)",
           d.open_slip(m2[ENR_B][0]).get('course', {}).get('name') == 'Socials 10')
        ok('Teacher A\'s roster names A\'s students only', d.roster('questionnaire', q['id']) == [ENR1, ENR2])
        ok('the claims are put back after: nothing of the teacher is left in the session',
           d.one("select coalesce(current_setting('request.jwt.claim.sub', true), '')") == '')
        # A replay.
        key = nid()
        r3, m3 = d.issue_new('questionnaire', q['id'], [ENR2], idem=key)
        r4, m4 = d.issue_new('questionnaire', q['id'], [ENR2], idem=key)
        ok('a replay makes nothing and names no candidate', r4['replayed'] is True and not m4
           and all('candidate' not in x for x in r4['results'])
           and d.one('select count(*) from student_access_code where enrollment_id = :e and questionnaire_id = :q and revoked_at is null', e=ENR2, q=q['id']) == 1, r4)
        # The second candidate.
        taken = row_of(d, ENR2, q['id'])[3]
        items = [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': taken, 'pw_hmac': 'ab' * 32}, {'code_hmac': 'cd' * 32, 'pw_hmac': 'ef' * 32}]}]
        r5 = d.service('student_submit.issue_slips(:t, :k, :g, :i::jsonb, :kid, :d)', t=A, k='questionnaire', g=q['id'], i=json.dumps(items), kid=cc.KEY_ID, d=nid())
        ok('the first candidate is a slip\'s already: the second is stored', r5['results'][0].get('candidate') == 1
           and row_of(d, ENR1, q['id'])[3] == 'cd' * 32, r5)
        items = [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': taken, 'pw_hmac': 'ab' * 32}, {'code_hmac': 'cd' * 32, 'pw_hmac': 'ef' * 32}]}]
        live = row_of(d, ENR1, q['id'])
        r6 = d.service('student_submit.issue_slips(:t, :k, :g, :i::jsonb, :kid, :d)', t=A, k='questionnaire', g=q['id'], i=json.dumps(items), kid=cc.KEY_ID, d=nid())
        ok('both taken: failed, and the slip Cece holds is not taken back', r6['results'][0] == {'enrollment_id': ENR1, 'result': 'failed'}
           and row_of(d, ENR1, q['id']) == live, (r6, row_of(d, ENR1, q['id'])))
        for label, items in [('a code given where a tag goes', [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': 'K7M4QX', 'pw_hmac': 'ab' * 32}, {'code_hmac': 'cd' * 32, 'pw_hmac': 'ef' * 32}]}]),
                             ('one candidate', [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': '12' * 32, 'pw_hmac': 'ab' * 32}]}]),
                             ('a student twice', [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': '13' * 32, 'pw_hmac': 'ab' * 32}, {'code_hmac': '14' * 32, 'pw_hmac': 'ab' * 32}]}] * 2),
                             ('a tag twice', [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': '15' * 32, 'pw_hmac': 'ab' * 32}, {'code_hmac': '15' * 32, 'pw_hmac': 'ab' * 32}]}])]:
            e = refused(d, lambda: d.service('student_submit.issue_slips(:t, :k, :g, :i::jsonb, :kid, :d)', t=A, k='questionnaire', g=q['id'], i=json.dumps(items), kid=cc.KEY_ID, d=nid()))
            ok('refused whole, 22023: %s' % label, e and e[1] == '22023', e)
        e = refused(d, lambda: d.service("student_submit.issue_slips(:t, 'cards', :g, '[]'::jsonb, :kid, :d)", t=A, g=q['id'], kid=cc.KEY_ID, d=nid()))
        ok('refused whole: a kind that is neither', e and e[1] == '22023', e)
        n0 = attempts(d)
        e = refused(d, lambda: d.service("student_submit.open('K7M4QX', :k, null, 'ip-1')", k=cc.KEY_ID))
        ok('open refuses a code where a tag goes, and logs nothing', e and e[1] == '22023' and attempts(d) == n0, e)
        for role in ('anon', 'authenticated'):
            for fn in [f for f in NEW if f.startswith('student_submit.')] + ['public._slip_password_settle(uuid)', 'public._slip_password_on_change()']:
                ok('%s cannot run %s' % (role, fn), not d.one("select has_function_privilege(:r, :f, 'execute')", r=role, f=fn))
        ok('the service role runs open, verify, slip_roster and issue_slips, and none of the helpers',
           all(d.one("select has_function_privilege('service_role', :f, 'execute')", f=f) for f in NEW[3:])
           and not any(d.one("select has_function_privilege('service_role', :f, 'execute')", f=f) for f in NEW[:3]))
        ok('a teacher can no longer run the old hash', not d.one("select has_function_privilege('authenticated', 'public._access_code_hash(text,text)', 'execute')"))
        ok('the teacher RPCs that printed slips are gone', all(d.one('select to_regprocedure(:f) is null', f=f) for f in DROPS))
    finally:
        d.close()

# ── report ──────────────────────────────────────────────────────────────────
@scenario('report')
def scen_report():
    def prep(d, k):
        rep = phone_report(d)
        r = d.rpc('issue_report_codes(:r, null, :k)', r=rep['id'], k=nid())
        return {'rep': rep, 'slips': {x['enrollment_id']: cc.tidy(x['code']) for x in r}}
    d, k = world('report', prep)
    try:
        rep = k['before']['rep']; old1 = k['before']['slips'][ENR1]
        o = d.open_slip(old1)
        ok('an old report slip opens, to the birthday check', o.get('ok') and o['kind'] == 'report' and o['has_birthday'] is True, o)
        ok('...and converts', not row_of(d, ENR1, rid=rep['id'])[1] and row_of(d, ENR1, rid=rep['id'])[3] == slip_tag(old1))
        c = d.check_slip(o['token'], '2012-05-15')
        ok('check by birthday hands over the report', c.get('ok') and c['report']['name'] == 'Cece Learner', c)
        ok('Sent to Phones sees it opened', d.one('select opened_at is not null from student_access_code where phone_report_id = :r and enrollment_id = :e and revoked_at is null', r=rep['id'], e=ENR1))
        ok('it opens again by tag, as often as the student likes', d.open_slip(old1).get('ok') and d.open_slip(old1).get('ok'))
        ok('the roster of a report is the students it was sent to', d.roster('report', rep['id']) == [ENR1, ENR2])
        r, made = d.issue_new('report', rep['id'])
        ok('new report slips: one each, no password', [x['result'] for x in r['results']] == ['made', 'made']
           and all(x['has_password'] is False for x in r['results']), r)
        ok('the reprint takes the old one back', d.open_slip(old1) == {'ok': False, 'error': 'not_found'})
        o2 = d.open_slip(made[ENR2][0])
        ok('a new report slip opens by its tag', o2.get('ok') and o2['kind'] == 'report' and o2['has_birthday'] is False, o2)
        d.run('update phone_report set closed_at = now() where id = :r', r=rep['id'])
        ok('a closed report: its slips say report_closed', d.open_slip(made[ENR1][0]).get('error') == 'report_closed')
        e = refused(d, lambda: d.issue_new('report', rep['id'], [ENR1]))
        ok('a closed report takes no new slips: FVS01', e and e[1] == 'FVS01', e)
        e = refused(d, lambda: d.roster('report', rep['id']))
        ok('...nor lists its students for them', e and e[1] == 'FVS01', e)
    finally:
        d.close()

# ── card ────────────────────────────────────────────────────────────────────
@scenario('card')
def scen_card():
    d, k = world('card', print_old)
    try:
        b = k['before']; q = b['q']
        t2 = d.session(ENR2, birthday=None) if False else None
        # Marcus has no birthday: his card session needs a password; give him a birthday for the card only.
        d.run("update student set date_of_birth = '2012-06-16' where id = :s", s=STU2)
        t2 = d.session(ENR2, birthday='2012-06-16')
        d.run('update student set date_of_birth = null where id = :s', s=STU2)
        r = d.svc('answer', t2, ENR2, q['id'], (json.dumps({text_q(q): 'From my card.'}), '::jsonb'))
        ok("Batch E's card answer is taken", r.get('ok') is True, r)
        ok('...and still marks his printed slip for it used', row_of(d, ENR2, q['id'])[8])
        ok('the stored password stays while his other old slip is live', stored_pw(d, STU2) == b['slips'][ENR2][1])
        q2 = b['q2']
        r2 = d.svc('answer', t2, ENR2, q2['id'], (json.dumps({text_q(q2): 'Again.'}), '::jsonb'))
        ok('a second card answer uses his last old slip, and the stored password is cleared',
           r2.get('ok') and row_of(d, ENR2, q2['id'])[8] and stored_pw(d, STU2) is None, (r2, stored_pw(d, STU2)))
        ok('the old slip opens as used', d.open_slip(b['slips2'][ENR2][0]) == {'ok': False, 'error': 'used'})
        q3 = questionnaire(d, title='Keyed'); r3, m3 = d.issue_new('questionnaire', q3['id'], [ENR1])
        t1 = d.session(ENR1)
        d.svc('answer', t1, ENR1, q3['id'], (json.dumps({text_q(q3): 'Card.'}), '::jsonb'))
        ok('a new slip, answered from the card: used', d.open_slip(m3[ENR1][0]) == {'ok': False, 'error': 'used'})
        q4 = questionnaire(d, title='Slip First'); r4, m4 = d.issue_new('questionnaire', q4['id'], [ENR1])
        o = d.open_slip(m4[ENR1][0]); d.verify_slip(o['token'], code=m4[ENR1][0], birthday='2012-05-15')
        d.submit_slip(o['token'], {text_q(q4): 'Slip.'})
        r5 = d.svc('answer', t1, ENR1, q4['id'], (json.dumps({text_q(q4): 'Card.'}), '::jsonb'))
        ok('a new slip used first: the card\'s answer is already_sent', r5 == {'ok': False, 'error': 'already_sent'}, r5)
        f = d.svc('forms', t1, ENR1)
        ok("the card's Questionnaires tab lists a questionnaire issued by a new slip",
           any(x['id'] == q3['id'] for x in f['questionnaires']), f)
    finally:
        d.close()

# ── copy ────────────────────────────────────────────────────────────────────
def everything(d):
    """Every row of every table in public and student_submit, as text, in one string."""
    out = []
    for t, cols in table_columns(d.c).items():
        if t.split('.')[0] not in ('public', 'student_submit'): continue
        out.append(d.one("select coalesce(string_agg(to_jsonb(x)::text, '|'), '') from %s x" % t))
    return '\n'.join(out)

@scenario('copy')
def scen_copy():
    d, k = world('copy', print_old)
    try:
        b = k['before']
        codes = [v[0] for v in list(b['slips'].values()) + list(b['slips2'].values())]
        pw2 = b['slips'][ENR2][1]
        for code in codes:
            o = d.open_slip(code)
            if o.get('check') == 'password': d.verify_slip(o['token'], code=code, password=pw2)
        q = questionnaire(d, title='Keyed'); r, made = d.issue_new('questionnaire', q['id'])
        rep = phone_report(d, title='Report 2'); rr, rmade = d.issue_new('report', rep['id'])
        o = d.open_slip(made[ENR2][0]); d.verify_slip(o['token'], code=made[ENR2][0], password=made[ENR2][1])
        allcodes = codes + [v[0] for v in made.values()] + [v[0] for v in rmade.values()]
        text = everything(d)
        found = [c for c in allcodes if c in text or pretty(c) in text]
        ok('a copy of the database holds none of the slip codes, old (converted) or new, with or without a dash', not found, found)
        ok('no slip row keeps a hash or a salt once converted, and no new one ever had one',
           d.one('select count(*) from student_access_code where code_hash is not null or salt is not null') == 0)
        ok('no student keeps a stored slip password', d.one('select count(*) from student where slip_password is not null') == 0)
        pws = [pw2, made[ENR2][1]]
        cols = d.all("""select table_schema || '.' || table_name, column_name from information_schema.columns
                         where table_schema in ('public', 'student_submit') and data_type in ('text', 'character varying', 'jsonb')""")
        hits = []
        for t, col in cols:
            if d.one("select to_regclass(:t) is not null and exists (select 1 from pg_class c where c.oid = to_regclass(:t) and c.relkind = 'r')", t=t):
                n = d.one('select count(*) from %s where "%s"::text = any(:p) or "%s"::text like any(:l)' % (t, col, col),
                          p=pws, l=['%"' + p + '"%' for p in pws])
                if n: hits.append((t, col, n))
        ok('no column holds a printed password, as text or in JSON', not hits, hits)
        ok('the tags are all made with the key: none can be made in SQL (the file never names hmac)',
           not re.search(r'\bhmac\s*\(', bare(text_at(FILE)).lower()))
    finally:
        d.close()

# ── edge: the statements as written ─────────────────────────────────────────
ROOT = os.path.join(HERE, '..', '..', 'supabase', 'functions')
def student_statements():
    text = open(os.path.join(ROOT, 'student-submit', 'slip-routes.ts')).read()
    block = text[text.index('export const SLIP_SQL = {'):]; block = block[:block.index('};')]
    return dict(re.findall(r"(\w+):\s*'([^']*)'", block))
def teacher_statements():
    text = open(os.path.join(ROOT, 'teacher-cards', 'index.ts')).read()
    out = {}
    for name, body in re.findall(r'async (\w+)\([^)]*\) \{\s*const \[row\] = await sql`([^`]*)`', text):
        n = [0]
        def param(m):
            n[0] += 1; return ':p%d' % n[0] + m.group(2)
        out[name] = re.sub(r'\$\{([^}]*)\}(::\w+)', param, ' '.join(body.split()))
    return out

@scenario('edge')
def scen_edge():
    st = student_statements(); tt = teacher_statements()
    ok('slip-routes.ts names open and verify', sorted(st) == ['open', 'verify'], st)
    ok('teacher-cards/index.ts names issue, roster and slips', sorted(tt) == ['issue', 'roster', 'slips'], tt)
    d, k = world('edge', print_old)
    try:
        def edge(sql, *params):
            named = re.sub(r'\$(\d+)', lambda m: ':p' + m.group(1), sql)
            return d._as('service_role', None, named, {'p%d' % (i + 1): v for i, v in enumerate(params)})[0][0]
        def teacher(sql, *params):
            return d._as('service_role', None, sql, {'p%d' % (i + 1): v for i, v in enumerate(params)})[0][0]
        q = k['before']['q']; old1 = k['before']['slips'][ENR1][0]
        a = edge(st['open'], slip_tag(old1), cc.KEY_ID, None, 'ab' * 32)
        ok('open, as the edge sends it first: the fallback is asked for', a == {'ok': False, 'error': 'not_found', 'fallback': True}, a)
        a = edge(st['open'], slip_tag(old1), cc.KEY_ID, old1, 'ab' * 32)
        ok('open, as the edge sends it second: the slip opens', a.get('ok') is True, a)
        v = edge(st['verify'], a['token'], '2012-05-15', None, None, slip_tag(old1), None, 'ab' * 32)
        ok('verify, as the edge sends it', v.get('ok') is True, v)
        ids = teacher(tt['roster'], A, 'questionnaire', q['id'])
        ok('slip_roster, as teacher-cards sends it', ids == [ENR1, ENR2], ids)
        items = [{'enrollment_id': ENR1, 'candidates': [{'code_hmac': '21' * 32, 'pw_hmac': '22' * 32}, {'code_hmac': '23' * 32, 'pw_hmac': '24' * 32}]}]
        s = teacher(tt['slips'], A, 'questionnaire', q['id'], json.dumps(items), cc.KEY_ID, nid())
        ok('issue_slips, as teacher-cards sends it (the items as JSON text)', s['results'][0]['result'] == 'made', s)
    finally:
        d.close()

# ── apply ───────────────────────────────────────────────────────────────────
def procs(d):
    return d.all("""select n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')',
                           md5(pg_get_functiondef(p.oid))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'student_submit', 'fv_private') and p.prokind = 'f' order by 1""")

@scenario('apply')
def scen_apply():
    text = text_at(FILE); sts = split(text)
    ok('the file is one transaction: begin first, commit last', bare(sts[0]).lower() == 'begin' and bare(sts[-1]).lower() == 'commit')
    d = SDb('sk_apply', template=template()); k = seed(d)
    try:
        d.run('update student set date_of_birth = null, student_number = null where id = :s', s=STU2)
        # In use: old slips, one of them used up, a student whose slip is long past its date, a card.
        b = print_old(d, k)
        d.run("update student set slip_password = '7777' where teacher_id = :t", t=B)  # a password no live slip needs
        t1 = d.session(ENR1)
        pre = d.file(PRE)
        ok('the pre-check on the database as live will be: only the count of passwords to clear',
           pre == 'ok' and d.rows == [['slip passwords the file clears (no live printed slip needs them)', '0', '1']], (pre, d.rows))
        post = d.file(POST)
        ok('the post-check before the apply lists what is missing', post == 'ok' and len(d.rows) >= len(NEW), (post, len(d.rows)))
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
            ('with a relied-on function changed', ["create or replace function student_submit._norm(p text) returns text language sql immutable set search_path to '' as $f$ select upper(p) $f$"], 'is not the definition'),
            ('with a function it drops changed', ["create or replace function public._new_access_code() returns text language sql as $f$ select 'x' $f$"], 'is not the definition'),
            ('with a function of its name already there', ["create function student_submit._slip_old_until() returns timestamptz language sql as $f$ select now() $f$"], 'already exists'),
            ('with Batch E not applied', ['drop function student_submit.answer(text,uuid,uuid,jsonb,text)'], 'Batch E'),
            ('with one of the four columns already there', ['alter table student_access_code add column code_hmac text'], 'not all four'),
        ]:
            good, r = stopped(setup, want)
            ok('it stops, with nothing changed, %s' % label, good, r)
        cols = table_columns(d.c)
        before = dict(procs(d)); rows_before = row_checksums(d.c, cols)
        r = d.statements(sts)
        ok('it applies on a database in use', r == 'ok', r)
        after = dict(procs(d))
        changed = sorted(p for p in before if p in after and before[p] != after[p])
        added = sorted(set(after) - set(before)); gone = sorted(set(before) - set(after))
        ok('no existing function is changed', changed == [], changed)
        ok('it adds exactly its new functions', added == sorted(NEW), added)
        ok('it drops exactly the ones it says', gone == sorted(DROPS), gone)
        rows_after = row_checksums(d.c, cols)
        moved = [t for t in rows_before if rows_before[t] != rows_after.get(t)]
        ok('the only rows that change are in student (a stored password no slip needed) and the sync cursor its trigger bumps',
           moved == ['public.course_sync_cursor', 'public.student'], moved)
        ok('...that one password: the one no live slip needs; Marcus\'s stays, his slips need it',
           d.one('select count(*) from student where teacher_id = :t and slip_password is not null', t=B) == 0
           and stored_pw(d, STU2) == b['slips'][ENR2][1])
        ok('every slip row as it was, the four new columns empty',
           d.one('select count(*) from student_access_code where code_hmac is not null or pw_hmac is not null or key_id is not null or converted_at is not null') == 0)
        ok('the post-check after: no rows', d.file(POST) == 'ok' and d.rows == [], d.rows)
        cat1 = catalog(d.c)
        r2 = d.file(FILE)
        ok('a second run: applies, changes nothing', r2 == 'ok' and catalog(d.c) == cat1, (r2, differences(cat1, catalog(d.c))))
        ok('the card session from before still works', d.page(t1, ENR1).get('ok') is True)
        ok('Batch E\'s post-check now lists only the old open and verify as missing (expected)',
           d.file('batch-e-live-postcheck.sql') == 'ok' and sorted(r[0] for r in d.rows) == sorted(
               ['relied on: student_submit.open(text,text)', 'relied on: student_submit.verify(text,text,text,text,text)']), d.rows)
    finally:
        d.close()

# ── undo ────────────────────────────────────────────────────────────────────
@scenario('undo')
def scen_undo():
    d = SDb('sk_undo', template=template()); k = seed(d)
    try:
        d.run('update student set date_of_birth = null, student_number = null where id = :s', s=STU2)
        b = print_old(d, k)
        cat0 = catalog(d.c); p0 = procs(d)
        r0 = d.file(UNDO)
        ok('the undo where the file was never applied: runs, changes nothing', r0 == 'ok' and catalog(d.c) == cat0, (r0, differences(cat0, catalog(d.c))))
        ok('the file applies', d.file(FILE) == 'ok')
        code1 = b['slips'][ENR1][0]
        ok('(setup) an old slip converts', d.open_slip(code1).get('ok') and not row_of(d, ENR1, b['q']['id'])[1])
        q = questionnaire(d, title='New'); r, made = d.issue_new('questionnaire', q['id'])
        r = d.file(UNDO)
        ok('the undo runs with converted and new slips', r == 'ok', r)
        ok('every function as before', procs(d) == p0, differences([tuple(x) for x in p0], [tuple(x) for x in procs(d)]))
        cat = catalog(d.c)
        only0, only1 = differences(cat0, cat)
        ok('the catalog differs from before only in student_access_code (the kept columns, their check and indexes, '
           'and code_hash and salt left nullable)', all('student_access_code' in l or l.startswith(('comments on pg_class', 'depends '))
                                                       for l in only0 + only1) and only1, (only0, only1))
        ok('the tags are kept', d.one('select count(*) from student_access_code where code_hmac is not null') == 3)
        old2 = b['slips2'][ENR2][0]
        o = d.service('student_submit.open(:c, :i)', c=old2, i='ip-1')
        ok('while undone, an old slip not converted opens the old way', o.get('ok') is True, o)
        ok('while undone, a converted slip does not open (reprint it)', d.service('student_submit.open(:c, :i)', c=code1, i='ip-1').get('error') == 'not_found')
        old = d.rpc('issue_access_codes(:q, :ids::uuid[], :k)', q=q['id'], ids='{%s}' % ENR1, k=nid())
        ok('while undone, the old teacher RPC prints slips again', len(old) == 1 and old[0]['code'], old)
        r9 = d.file(UNDO)
        ok('the undo a second time: runs, changes nothing', r9 == 'ok' and catalog(d.c) == cat, r9)
        ok('the file applies again after the undo', d.file(FILE) == 'ok')
        d.calls = []
        ok('...and the slip converted before the undo opens by its tag again', d.open_slip(code1).get('ok') and len(d.calls) == 1)
        ok('...and a new slip made before the undo opens again', d.open_slip(made[ENR2][0]).get('ok'))
        ok('...and the slip printed while undone converts', d.open_slip(cc.tidy(old[0]['code'])).get('ok'))
        # With no slip converted or made, the undo puts code_hash and salt back to not null.
        d2 = SDb('sk_undo2', template=template()); seed(d2)
        try:
            c0 = catalog(d2.c)
            ok('(setup) the file applies to a fresh copy', d2.file(FILE) == 'ok')
            ok('the undo there', d2.file(UNDO) == 'ok')
            o0, o1 = differences(c0, catalog(d2.c))
            ok('with no slip converted or made since, only the kept columns and their check and indexes differ',
               all('student_access_code' in l or l.startswith(('comments on pg_class', 'depends ')) for l in o0 + o1)
               and not any('| code_hash |' in l or '| salt |' in l for l in o0 + o1), (o0, o1))
        finally:
            d2.close()
    finally:
        d.close()

# ── fingerprints ────────────────────────────────────────────────────────────
def cmd_fingerprints(check_only):
    d0 = SDb('sk_fp0', template=template())
    try:
        relied = fingerprints(d0, RELIED); drops = fingerprints(d0, DROPS)
        bodies = '\n'.join(d0.one('select pg_get_functiondef(to_regprocedure(:f))', f=f).rstrip() + ';\n' for f in DROPS)
        # Each one's grants in the order its ACL lists them, so the catalog comes back exactly.
        grants = '\n'.join(
            'revoke all on function %s from public, anon, authenticated, service_role;\n' % f
            + ''.join('grant execute on function %s to %s;\n' % (f, r[0]) for r in d0.all(
                "select a.grantee::regrole::text from pg_proc p, aclexplode(p.proacl) with ordinality a "
                "where p.oid = to_regprocedure(:f) and a.grantee <> p.proowner order by a.ordinality", f=f))
            for f in DROPS)
        r = d0.statements(split(neutral(text_at(FILE))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        new_ = fingerprints(d0, NEW)
    finally:
        d0.close()
    lists = {'relied': [(f, relied[f] or 'absent') for f in RELIED], 'drops': [(f, drops[f] or 'absent') for f in DROPS],
             'new': [(f, new_[f] or 'absent') for f in NEW]}
    stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel)
        if not os.path.exists(path): continue
        was = open(path).read(); now = write_lists(was, lists)
        if rel == UNDO:
            now = re.sub(r'(-- UNDO-BODIES-BEGIN[^\n]*\n).*?(-- UNDO-BODIES-END)', lambda m: m.group(1) + bodies + '\n' + grants + m.group(2), now, flags=re.S)
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
