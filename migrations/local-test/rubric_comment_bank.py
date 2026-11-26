"""Comment Bank per Rubric: migrations/2026112601_rubric_comment_bank.sql on a database rebuilt from the repo and
proved equal to live (scripts/db-rebuild.mjs --check; README.md, "Comment Bank per Rubric").

    PGPORT=<port> PGDATABASE=<db> python3 rubric_comment_bank.py fingerprints   write the md5 lists the files carry
    PGPORT=<port> PGDATABASE=<db> python3 rubric_comment_bank.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 rubric_comment_bank.py upsert         or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  upsert    upsert_rubric with ten arguments: a save as the app in teachers' browsers sends it (named arguments,
            no "comments" key, no p_overall_comments) keeps what is stored; a "comments" list or
            p_overall_comments replaces; null keeps; a new criterion gets []; every refusal (level, text,
            length, count, shape) changes nothing; repeats collapse; another teacher's rubric is refused.
  add       add_criterion_comment and add_rubric_overall_comment: append, a repeat is a no-op, the cap of 40,
            another teacher, a visitor, no sign-in, the idempotency key replays, the sync cursor moves (and
            get_class_bundle with the old version gives the new comment), a no-op does not move it.
  scales    a six-level rubric's level 5 and 6 comments after it goes back to four levels: save back, add,
            Duplicate Class and a backup restore all work; rubrics of two to five levels take levels 1 to 6.
  table     a teacher's direct write to criterion or rubric past any limit is refused by the tables' checks;
            the largest list the rule allows fills each byte cap exactly.
  readers   get_class_bundle carries comments and overall_comments and nothing else new; duplicate_course and
            import_json_restore carry both (missing means []); the student page carries neither, nor any
            banked text; get_assessment_detail (teacher only) now shows them too.
  race      two connections: every function that writes criterion or rubric (upsert_rubric, delete_rubric,
            import_json_restore, duplicate_course, the two new ones) against an add, in both orders; an old
            app's save never loses a comment added meanwhile; the order that would deadlock over the sync
            cursor does not (and does, with the rubric lock taken out); a grade save is not held up.
  apply     a save in flight: waited for, or the file stops on the lock timeout; no deadlock with a save
            that goes on to its criteria; the guards stop with the catalog unchanged; only what the header names changes; every existing row
            reads as before with [] in the new columns; the md5s; a second run; the three read-only files; lock
            timeout; size; plain ASCII, no backslash.
  undo      PART 0 (saves as before, Add to Bank refused, the bank kept); the full removal refuses while a
            comment is kept, then leaves the catalog and every row as before; a second run; the file again.
"""
import json, os, re, sys, threading, time
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hashlib, secrets
import card_codes_common as ccc
from card_codes_common import Db, refused, ok, finish, split, text_of, code_tag, key_id, pw_tag, FAKE_KEY, message, sqlstate
from catalog import catalog, differences, row_checksums

FILE = '../2026112601_rubric_comment_bank.sql'
UNDO = 'rubric-comment-bank-undo.sql'
PRE = 'rubric-comment-bank-live-precheck.sql'
POST = 'rubric-comment-bank-live-postcheck.sql'
FPS = 'rubric-comment-bank-live-fingerprints.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'

# What the new code calls, what the tests run against it, and what reads the two tables.
RELIED = ['public.fv_owns_course(uuid)', 'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
          'public._touch_course_sync_cursor(uuid,text)', 'public._touch_course_sync_cursor_from_trigger()',
          'fv_private.same_teacher()', 'public.delete_rubric(uuid)', 'public.get_assessment_detail(uuid)',
          'student_submit.page(text,uuid,text)']
PATCHED = ['public.get_class_bundle(uuid,bigint)', 'public.duplicate_course(uuid,uuid)', 'public.import_json_restore(jsonb,uuid)']
OLD = ['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb)']
NEW = ['public.upsert_rubric(uuid,uuid,text,jsonb,uuid,uuid,text,jsonb,jsonb,jsonb)', 'public._rubric_comment_list(jsonb,boolean)',
       'public.add_criterion_comment(uuid,smallint,text,uuid)', 'public.add_rubric_overall_comment(uuid,text,uuid)']
UPSERT10 = NEW[0]
STOPPED_UPSERT = 'stopped'   # the ten-argument upsert_rubric as PART 0 of the undo leaves it

# == 2026112401: the edge function hashes a device's token; verify_card is given the hash of a token it made ==
def _verify(self, code, birthday=None, number=None, password=None, token=None, ip='ip-1', add=False, key=FAKE_KEY):
    new = hashlib.sha256(secrets.token_hex(32).encode()).hexdigest()
    r = self.service('student_submit.verify_card(:h, :k, :b, :n, :p, :t, :i, :a, :s)', h=code_tag(code, key), k=key_id(key),
                     b=birthday, n=number, p=None if password is None else pw_tag(code, password, key), t=token, i=ip, a=add, s=new)
    if isinstance(r, dict) and r.get('ok'):
        r = dict(r, session_token=new if r.get('new_session') else token)
    return r
ccc.Db.verify = _verify

def quiet0(diff):
    return tuple([l for l in side if not l.startswith(('depends', 'dropped columns'))] for side in diff)
def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def defn(d, sig): return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def applied(d): return d.one("select to_regprocedure('public.add_criterion_comment(uuid,smallint,text,uuid)') is not null")
def obj(v): return json.loads(v) if isinstance(v, str) else v
def without_final(text):
    a = text.index('do $final$'); b = text.index('$final$;', a + 12) + len('$final$;')
    return text[:a] + text[b:]
def q(s): return "'" + s.replace("'", "''") + "'"
def listed(text, name):
    return dict(re.findall(r"\('([^']+)', '([0-9a-f]{32})'", text.split('FINGERPRINTS-BEGIN ' + name)[1].split('FINGERPRINTS-END')[0]))

def put_list(text, name, rows):
    pat = re.compile(r'(-- FINGERPRINTS-BEGIN %s[^\n]*\n)(.*?)([ \t]*-- FINGERPRINTS-END)' % re.escape(name), re.S)
    m = pat.search(text)
    if not m: sys.exit('no list %s' % name)
    indent = re.match(r'[ \t]*', m.group(3)).group(0)
    return text[:m.start(2)] + ',\n'.join(indent + r for r in rows) + '\n' + text[m.start(3):]
def tup(*v): return '(' + ', '.join(q(x) for x in v) + ')'

def stopped_def(old_def):
    """PART 0's upsert_rubric: the nine-argument body as live had it, under the ten-argument name (p_overall_comments
    taken and ignored)."""
    a = 'p_scale jsonb DEFAULT NULL::jsonb)'
    assert old_def.count(a) == 1
    return old_def.replace(a, 'p_scale jsonb DEFAULT NULL::jsonb, p_overall_comments jsonb DEFAULT NULL::jsonb)')

# == The md5 lists the files carry, and the old definitions the undo restores ==
def scen_fingerprints():
    d = Db('cb_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        relied = {s: md5(d, s) for s in RELIED}
        before = {s: md5(d, s) for s in PATCHED}
        old = {s: md5(d, s) for s in OLD}
        old_def = defn(d, OLD[0])
        missing = [s for s, v in list(relied.items()) + list(before.items()) + list(old.items()) if v is None]
        if missing: sys.exit('not on the template: %s' % missing)
        path = os.path.join(HERE, FILE)
        text = open(path).read()
        text = put_list(text, 'relied', [tup(s, relied[s]) for s in RELIED])
        text = put_list(text, 'replaces', [tup(s, before[s], '-') for s in PATCHED])
        text = put_list(text, 'becomes', [tup(s, '-') for s in PATCHED])
        text = put_list(text, 'dropped', [tup(s, old[s]) for s in OLD])
        text = put_list(text, 'new', [tup(s, '-') for s in NEW])
        text = put_list(text, 'after', [tup(s, '-') for s in PATCHED + NEW])
        r = d.statements(split(without_final(text)))
        if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
        after = {s: md5(d, s) for s in PATCHED + NEW}
        # PART 0's upsert_rubric, made here to read its md5
        d.run(stopped_def(old_def))
        stopped = md5(d, UPSERT10)
        text = put_list(text, 'replaces', [tup(s, before[s], after[s]) for s in PATCHED])
        text = put_list(text, 'becomes', [tup(s, after[s]) for s in PATCHED])
        text = put_list(text, 'new', [tup(s, after[s]) for s in NEW])
        text = put_list(text, 'after', [tup(s, after[s]) for s in PATCHED + NEW])
        open(path, 'w').write(text)
        live = list(relied.items()) + list(before.items()) + list(old.items())
        for fn, name, rows in ((FPS, 'live', live), (PRE, 'precheck', live), (POST, 'postcheck', list(relied.items()) + list(after.items()))):
            p = os.path.join(HERE, fn); t = open(p).read()
            open(p, 'w').write(put_list(t, name, [tup(s, v) for s, v in rows]))
        p = os.path.join(HERE, UNDO); t = open(p).read()
        t = put_list(t, 'undo-stop', [tup(UPSERT10, after[UPSERT10], stopped)])
        t = put_list(t, 'undo-new', [tup(s, after[s], stopped if s == UPSERT10 else after[s]) for s in NEW])
        t = put_list(t, 'undo-dropped', [tup(s, old[s]) for s in OLD])
        t = put_list(t, 'undo-replaced', [tup(s, before[s], after[s]) for s in PATCHED])
        t = put_list(t, 'undo-before', [tup(s, before[s]) for s in PATCHED])
        t = put_list(t, 'undo-after', [tup(s, v) for s, v in list(before.items()) + list(old.items())])
        for mark, body in (('STOPPED-DEFINITION', stopped_def(old_def)), ('OLD-DEFINITION', old_def)):
            a = t.index('-- %s-BEGIN' % mark); a = t.index('\n', a) + 1; b = t.index('-- %s-END' % mark)
            t = t[:a] + body.rstrip() + ';\n' + t[b:]
        open(p, 'w').write(t)
        print('written: relied %d, patched %d, old %d, new %d' % (len(relied), len(before), len(old), len(NEW)))
    finally:
        d.close()

# == The world ==
class W: pass

def crit(name, **kw):
    o = {'name': name, 'level_1_descriptor': 'Starting', 'level_2_descriptor': 'Close', 'level_3_descriptor': 'Meets', 'level_4_descriptor': 'Beyond'}
    o.update(kw); return o

def world(tag, apply=False):
    d = Db('cb_' + tag)
    w = W(); w.d = d
    if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=key_id(FAKE_KEY))
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    w.c = str(T(d, "create_course(p_name => 'Socials 10', p_subjects => array['Socials'], p_idempotency_key => gen_random_uuid())"))
    w.cb = str(T(d, "create_course(p_name => 'Bravo Science', p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", B))
    def enrol(c, first, uid=A):
        r = T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())", uid, c=c, f=first)
        return str(r['enrollment_id'])
    w.es = [enrol(w.c, n) for n in ('Cece', 'Dev')]
    w.eb = enrol(w.cb, 'Bravo Kid', B)
    d.run("update course set student_page_enabled = true, return_grades = 'on_return', show_my_learning = true where id = any (:ids)", ids=[w.c, w.cb])
    w.rub = str(ur(d, None, w.c, 'Essay Rubric', [crit('Argument'), crit('Evidence'), crit('Voice')]))
    w.crits = crit_ids(d, w.rub)
    w.asm = str(T(d, "create_assessment(:c, 'Essay One', p_rubric_id => :r, p_idempotency_key => gen_random_uuid())", c=w.c, r=w.rub))
    six = [{'k': i, 'name': 'L%d' % i, 'level': min(4, max(1, i - 1)), 'mod': 0} for i in range(1, 7)]
    w.rub6 = str(ur(d, None, w.c, 'Six Point', [crit('Ideas', level_5_descriptor='Five', level_6_descriptor='Six')], scale=six))
    w.crit6 = crit_ids(d, w.rub6)[0]
    w.rubb = str(ur(d, None, w.cb, 'Bravo Rubric', [crit('Lab')], uid=B))
    w.critb = crit_ids(d, w.rubb)[0]
    if apply:
        r = d.file(FILE); assert r == 'ok', r
    return w

MISSING = object()
def ur(d, rid, cid, name, crits, uid=A, overall=MISSING, scale=MISSING, style='standard', key='new', conn=None):
    """upsert_rubric as the app calls it through PostgREST: named arguments, p_overall_comments only when given."""
    kw = {'id': rid, 'c': cid, 'n': name, 'cr': json.dumps(crits), 's': style}
    sql = ("upsert_rubric(p_id => :id::uuid, p_course_id => :c::uuid, p_name => :n, p_criteria => :cr::jsonb, p_copy_group => null, "
           "p_idempotency_key => %s, p_style => :s, p_linked_tag_ids => null" % ('gen_random_uuid()' if key == 'new' else 'null'))
    if scale is not MISSING: sql += ', p_scale => :sc::jsonb'; kw['sc'] = None if scale is None else json.dumps(scale)
    if overall is not MISSING: sql += ', p_overall_comments => :o::jsonb'; kw['o'] = None if overall is None else json.dumps(overall)
    sql += ')'
    if conn is not None:
        return conn.run('select ' + sql, **kw)[0][0]
    return T(d, sql, uid, **kw)
def crit_ids(d, rid): return [str(r[0]) for r in d.all('select id from criterion where rubric_id = :r order by display_order, created_at, id', r=rid)]
def crit_rows(d, rid):
    """[{id, name, level_3_descriptor, ...}] as the editor would send them back."""
    out = []
    for r in d.all("select id::text, name, level_1_descriptor, level_2_descriptor, level_3_descriptor, level_4_descriptor, display_order "
                   "from criterion where rubric_id = :r order by display_order, created_at, id", r=rid):
        out.append({'id': r[0], 'name': r[1], 'level_1_descriptor': r[2], 'level_2_descriptor': r[3], 'level_3_descriptor': r[4],
                    'level_4_descriptor': r[5], 'display_order': r[6]})
    return out
def comments(d, cid): return obj(d.one('select comments from criterion where id = :c', c=cid))
def overall(d, rid): return obj(d.one('select overall_comments from rubric where id = :r', r=rid))
def version(d, course): return d.one('select coalesce((select version from course_sync_cursor where course_id = :c), 0)', c=course)
def add(d, cid, level, text, uid=A, key=None):
    return obj(T(d, 'add_criterion_comment(:c::uuid, :l::smallint, :t, :k::uuid)', uid, c=cid, l=level, t=text, k=key))
def add_o(d, rid, text, uid=A, key=None):
    return obj(T(d, 'add_rubric_overall_comment(:r::uuid, :t, :k::uuid)', uid, r=rid, t=text, k=key))
def C(level, text): return {'level': level, 'text': text}

# == upsert ==
def scen_upsert():
    w = world('upsert', apply=True); d = w.d
    try:
        c1, c2, c3 = w.crits
        ok('upsert: exactly one upsert_rubric, with ten arguments',
           d.one("select count(*) from pg_proc where proname = 'upsert_rubric'") == 1 and md5(d, UPSERT10) is not None)
        ok('upsert: every existing criterion and rubric reads [] in the new columns',
           d.one("select count(*) from criterion where comments <> '[]'::jsonb") == 0 and d.one("select count(*) from rubric where overall_comments <> '[]'::jsonb") == 0)
        rows = crit_rows(d, w.rub)
        rows[0]['comments'] = [C(3, '  Clear claim, [Name].  '), C(2, 'Say more.'), C(3, 'Clear claim, [Name].'), C(4, 'Clear claim, [Name].'), C('1', 'Start here.')]
        ur(d, w.rub, w.c, 'Essay Rubric', rows, overall=['Well argued.', ' Well argued. ', 'See me.'])
        ok('upsert: a "comments" list is kept trimmed, in order, a repeat of level and text once (a level as text is read as checks read it)',
           comments(d, c1) == [C(3, 'Clear claim, [Name].'), C(2, 'Say more.'), C(4, 'Clear claim, [Name].'), C(1, 'Start here.')], comments(d, c1))
        ok('upsert: p_overall_comments is kept trimmed, in order, a repeat once', overall(d, w.rub) == ['Well argued.', 'See me.'], overall(d, w.rub))
        ok('upsert: criteria with no "comments" key keep [] ', comments(d, c2) == [] and comments(d, c3) == [])
        kept = comments(d, c1)
        # the app in teachers' browsers: no "comments" key, no p_overall_comments, nine named arguments
        rows = crit_rows(d, w.rub); rows[0]['name'] = 'Argument (renamed)'
        v0 = version(d, w.c)
        ur(d, w.rub, w.c, 'Essay Rubric v2', rows, scale=None)
        ok("upsert: a save as today's app sends it (nine named arguments, no comments) keeps every comment",
           comments(d, c1) == kept and overall(d, w.rub) == ['Well argued.', 'See me.'], (comments(d, c1), overall(d, w.rub)))
        ok('upsert: (and the rest of the save is made)', d.one('select name from criterion where id = :c', c=c1) == 'Argument (renamed)'
           and d.one('select name from rubric where id = :r', r=w.rub) == 'Essay Rubric v2' and version(d, w.c) > v0)
        # positional, eight and nine arguments, as an old queued write might be
        T(d, "upsert_rubric(:r::uuid, :c::uuid, 'Essay Rubric v3', :cr::jsonb, null, null, 'standard', null)", r=w.rub, c=w.c, cr=json.dumps(crit_rows(d, w.rub)))
        T(d, "upsert_rubric(:r::uuid, :c::uuid, 'Essay Rubric v3', :cr::jsonb, null, null, 'standard', null, null)", r=w.rub, c=w.c, cr=json.dumps(crit_rows(d, w.rub)))
        ok('upsert: eight and nine positional arguments resolve to the one function and keep every comment',
           comments(d, c1) == kept and overall(d, w.rub) == ['Well argued.', 'See me.'])
        rows = crit_rows(d, w.rub); rows[0]['comments'] = None
        ur(d, w.rub, w.c, 'Essay Rubric', rows, overall=None)
        ok('upsert: "comments": null and p_overall_comments null keep', comments(d, c1) == kept and overall(d, w.rub) == ['Well argued.', 'See me.'])
        rows = crit_rows(d, w.rub); rows[0]['comments'] = [C(3, 'Only this one.')]
        ur(d, w.rub, w.c, 'Essay Rubric', rows, overall=['Only overall.'])
        ok('upsert: a list replaces', comments(d, c1) == [C(3, 'Only this one.')] and overall(d, w.rub) == ['Only overall.'])
        rows = crit_rows(d, w.rub); rows[0]['comments'] = []
        ur(d, w.rub, w.c, 'Essay Rubric', rows, overall=[])
        ok('upsert: [] empties', comments(d, c1) == [] and overall(d, w.rub) == [])
        # a new criterion
        rows = crit_rows(d, w.rub) + [crit('New One'), crit('New Two', comments=[C(2, 'Fresh.')])]
        ur(d, w.rub, w.c, 'Essay Rubric', rows)
        new = {r[0]: obj(r[1]) for r in d.all("select name, comments from criterion where rubric_id = :r and name like 'New%'", r=w.rub)}
        ok('upsert: a new criterion with no "comments" gets [], with a list gets it', new == {'New One': [], 'New Two': [C(2, 'Fresh.')]}, new)
        # a new rubric with overall comments, and the idempotency of a first save
        k = d.one('select gen_random_uuid()::text')
        sql = "upsert_rubric(p_id => null, p_course_id => :c::uuid, p_name => 'Keyed', p_criteria => :cr::jsonb, p_idempotency_key => :k::uuid, p_overall_comments => :o::jsonb)"
        r1 = T(d, sql, c=w.c, cr=json.dumps([crit('K', comments=[C(1, 'k')])]), k=k, o=json.dumps(['ov']))
        r2 = T(d, sql, c=w.c, cr=json.dumps([crit('K', comments=[C(1, 'k')])]), k=k, o=json.dumps(['ov']))
        ok('upsert: a new rubric keeps its overall comments and criterion comments; its key replays',
           r1 == r2 and overall(d, str(r1)) == ['ov'] and comments(d, crit_ids(d, str(r1))[0]) == [C(1, 'k')]
           and d.one("select count(*) from rubric where name = 'Keyed'") == 1)
        # refusals: each changes nothing
        rows = crit_rows(d, w.rub); rows[0]['comments'] = [C(2, 'Good.')]
        ur(d, w.rub, w.c, 'Essay Rubric', rows, overall=['Fine.'])
        snap = (d.all('select id, name, comments from criterion order by id'), d.all('select id, name, overall_comments from rubric order by id'), version(d, w.c))
        long500 = 'x' * 500; long501 = 'x' * 501
        bad = {
            'level 0': [C(0, 'a')], 'level 7': [C(7, 'a')], 'no level': [{'text': 'a'}], 'level null': [C(None, 'a')],
            'level 2.5': [C(2.5, 'a')], 'level 3.0': [C(3.0, 'a')], 'level true': [C(True, 'a')], 'level 10**20': [C(10 ** 20, 'a')],
            'level " 3"': [C(' 3', 'a')], 'level as words': [C('three', 'a')], 'empty text': [C(3, '')], 'spaces only': [C(3, ' \t\n ')],
            '501 characters': [C(3, long501)], 'text not text': [C(3, 7)], 'no text': [{'level': 3}], 'a bare string': ['a'],
            'not a list (object)': {'level': 3, 'text': 'a'}, 'not a list (string)': 'a', '41 different': [C(3, 'c%d' % i) for i in range(41)],
        }
        for name, val in bad.items():
            rows = crit_rows(d, w.rub); rows[0]['name'] = 'CHANGED'; rows[0]['comments'] = val
            r = refused(d, lambda: ur(d, w.rub, w.c, 'CHANGED', rows))
            ok('upsert: refused with 22023, nothing changed: ' + name, r is not None and r[1] == '22023' and
               (d.all('select id, name, comments from criterion order by id'), d.all('select id, name, overall_comments from rubric order by id'), version(d, w.c)) == snap, r)
        for name, val in {'overall: a number': [3], 'overall: an object': [{'text': 'a'}], 'overall: empty': [''], 'overall: 501': [long501],
                          'overall: 41 different': ['o%d' % i for i in range(41)], 'overall: not a list': 'a', 'overall: json null': 'JSONNULL'}.items():
            if val == 'JSONNULL':
                r = refused(d, lambda: T(d, "upsert_rubric(p_id => :r::uuid, p_course_id => :c::uuid, p_name => 'CHANGED', p_criteria => :cr::jsonb, p_overall_comments => 'null'::jsonb)",
                                        r=w.rub, c=w.c, cr=json.dumps(crit_rows(d, w.rub))))
            else:
                r = refused(d, lambda: ur(d, w.rub, w.c, 'CHANGED', crit_rows(d, w.rub), overall=val))
            ok('upsert: refused, nothing changed: ' + name, r is not None and r[1] == '22023' and
               (d.all('select id, name, comments from criterion order by id'), d.all('select id, name, overall_comments from rubric order by id'), version(d, w.c)) == snap, r)
        r = refused(d, lambda: ur(d, w.rub, w.c, 'x', crit_rows(d, w.rub)))
        rows = crit_rows(d, w.rub); rows[0]['comments'] = [C(3, long500), C(3, 'e' * 500), C(3, chr(0x1F600) * 500)] + [C(3, 'c%d' % i) for i in range(37)] + [C(3, 'c0')]
        ur(d, w.rub, w.c, 'Essay Rubric', rows, overall=['o%d' % i for i in range(40)] + ['o0'])
        ok('upsert: 500 characters (any letters) and 40 comments, after a repeat collapses, are taken',
           len(comments(d, w.crits[0])) == 40 and len(overall(d, w.rub)) == 40 and comments(d, w.crits[0])[2]['text'] == chr(0x1F600) * 500)
        # six levels
        rows = crit_rows(d, w.rub6); rows[0]['comments'] = [C(5, 'five'), C(6, 'six')]
        ur(d, w.rub6, w.c, 'Six Point', rows)
        ok('upsert: levels 5 and 6 on a rubric with its own levels', comments(d, w.crit6) == [C(5, 'five'), C(6, 'six')])
        rows[0]['comments'] = [C(7, 'seven')]
        r = refused(d, lambda: ur(d, w.rub6, w.c, 'Six Point', rows))
        ok('upsert: level 7 is refused there', r is not None and r[1] == '22023' and comments(d, w.crit6) == [C(5, 'five'), C(6, 'six')], r)
        rows = crit_rows(d, w.rub)
        rows[0]['comments'] = [C(5, 'five on four'), C(6, 'six on four'), C('2', 'two as text')]
        ur(d, w.rub, w.c, 'Essay Rubric', rows)
        ok('upsert: levels 1 to 6 on a four-level rubric too (as a checkbox level); a digit as text is stored as a number',
           comments(d, w.crits[0]) == [C(5, 'five on four'), C(6, 'six on four'), C(2, 'two as text')], comments(d, w.crits[0]))
        # another teacher
        rows = crit_rows(d, w.rub); rows[0]['comments'] = [C(3, 'EVIL')]
        r = refused(d, lambda: ur(d, w.rub, w.c, 'EVIL', rows, uid=B, overall=['EVIL']))
        ok("upsert: another teacher's save of this rubric is refused and changes nothing", r is not None and 'EVIL' not in json.dumps(d.all('select comments from criterion')) + json.dumps(d.all('select overall_comments from rubric')), r)
        # who may run it
        r = refused(d, lambda: d.role('anon', "select upsert_rubric(null, null, 'x', '[]'::jsonb)"))
        ok('upsert: a visitor may not run it', r is not None and 'permission denied' in r[0], r)
        ok('upsert: the rule for a list: a teacher and the service role may run it, a visitor may not',
           d.one("select has_function_privilege('authenticated', 'public._rubric_comment_list(jsonb,boolean)', 'execute') and has_function_privilege('service_role', 'public._rubric_comment_list(jsonb,boolean)', 'execute') and not has_function_privilege('anon', 'public._rubric_comment_list(jsonb,boolean)', 'execute')"))
        ok('upsert: the rule for a list is immutable and reads no table', d.one("select provolatile from pg_proc where oid = to_regprocedure('public._rubric_comment_list(jsonb,boolean)')") == 'i'
           and set(re.findall(r'(?i)\bfrom\s+(\w+)', re.sub(r'--[^\n]*', '', defn(d, NEW[1])))) == {'jsonb_array_elements'})
    finally:
        d.close()

# == add ==
def scen_add():
    w = world('add', apply=True); d = w.d
    try:
        c1, c2, _ = w.crits
        v0 = version(d, w.c); u0 = d.one('select updated_at from criterion where id = :c', c=c1)
        r = add(d, c1, 3, '  Clear claim, [Name]. ')
        ok('add: appends, trimmed, and returns the whole list', r == [C(3, 'Clear claim, [Name].')] and comments(d, c1) == r, r)
        ok('add: the sync cursor moves and updated_at with it', version(d, w.c) > v0 and d.one('select updated_at from criterion where id = :c', c=c1) > u0)
        b = obj(T(d, 'get_class_bundle(:c, :v)', c=w.c, v=v0))
        crow = [x for x in b['rubrics']['criteria'] if x['id'] == c1]
        ok('add: get_class_bundle with the version from before gives the new comment (another device sees it)',
           not b.get('not_modified') and crow and crow[0]['comments'] == [C(3, 'Clear claim, [Name].')], b.get('not_modified'))
        ok('add: and with the version now, "not modified"', obj(T(d, 'get_class_bundle(:c, :v)', c=w.c, v=version(d, w.c))).get('not_modified') is True)
        v1 = version(d, w.c)
        r = add(d, c1, 3, 'Clear claim, [Name].')
        ok('add: the same level and text again is a no-op: same list, the cursor does not move', r == [C(3, 'Clear claim, [Name].')] and version(d, w.c) == v1, r)
        r = add(d, c1, 4, 'Clear claim, [Name].'); r = add(d, c1, 1, 'Start here.')
        ok('add: the same text at another level is another comment; order kept',
           r == [C(3, 'Clear claim, [Name].'), C(4, 'Clear claim, [Name].'), C(1, 'Start here.')], r)
        ok('add: the other criteria are untouched', comments(d, c2) == [])
        before = comments(d, c1)
        for name, (lv, tx, st) in {'level 0': (0, 'a', '22023'), 'level 7': (7, 'a', '22023'), 'level -1': (-1, 'a', '22023'), 'no level': (None, 'a', '22023'),
                                    'no text': (3, None, '22023'), 'blank text': (3, '   ', '22023'), '501 characters': (3, 'y' * 501, '22023')}.items():
            r = refused(d, lambda: add(d, c1, lv, tx))
            ok('add: refused, nothing changed: ' + name, r is not None and r[1] == st and comments(d, c1) == before, r)
        ok('add: level 6 on a rubric with its own levels', add(d, w.crit6, 6, 'six') == [C(6, 'six')])
        ok('add: and level 5 on a four-level rubric', add(d, c2, 5, 'five on four') == [C(5, 'five on four')])
        d.run("update criterion set comments = '[]' where id = :c", c=c2)
        # another teacher, a visitor, nobody
        r = refused(d, lambda: add(d, c1, 3, 'EVIL', uid=B))
        ok("add: another teacher is refused (as not found) and nothing changes", r is not None and r[1] == 'P0002' and comments(d, c1) == before, r)
        r = refused(d, lambda: add(d, w.critb, 3, 'EVIL'))
        ok("add: nor can this teacher add to the other's", r is not None and comments(d, w.critb) == [], r)
        r = refused(d, lambda: d.role('anon', "select add_criterion_comment(:c::uuid, 3::smallint, 'EVIL')", c=c1))
        ok('add: a visitor may not run it', r is not None and 'permission denied' in r[0], r)
        r = refused(d, lambda: d.role('authenticated', "select add_criterion_comment(:c::uuid, 3::smallint, 'EVIL')", c=c1))
        ok('add: nor anyone not signed in', r is not None and r[1] == 'PT401', r)
        r = refused(d, lambda: add(d, '00000000-0000-0000-0000-000000000000', 3, 'x'))
        ok('add: a criterion that is not there: not found', r is not None and r[1] == 'P0002', r)
        d.run('update course set deleted_at = now() where id = :c', c=w.c)
        r = refused(d, lambda: add(d, c1, 3, 'into a deleted class'))
        d.run('update course set deleted_at = null where id = :c', c=w.c)
        ok('add: a class in the bin is refused', r is not None and r[1] == 'P0002' and comments(d, c1) == before, r)
        # the idempotency key
        k = d.one('select gen_random_uuid()::text')
        r1 = add(d, c1, 2, 'Keyed one.', key=k)
        add(d, c1, 2, 'Unkeyed after.')
        r2 = add(d, c1, 2, 'Keyed one.', key=k)
        ok('add: a replay with the same key gives the first answer and adds nothing', r1 == r2 and comments(d, c1)[-1] == C(2, 'Unkeyed after.')
           and sum(1 for x in comments(d, c1) if x['text'] == 'Keyed one.') == 1, (r1, r2))
        r3 = add(d, c1, 2, 'Other text, same key.', key=k)
        ok('add: a key is one call: a different comment with a used key is not added (the app makes a key per call)', r3 == r1 and not any(x['text'] == 'Other text, same key.' for x in comments(d, c1)))
        r = refused(d, lambda: add(d, c1, 2, 'B with A key', uid=B, key=k))
        ok("add: another teacher's call with the same key is not given the cached answer", r is not None and r[1] == 'P0002', r)
        # the cap
        n = len(comments(d, c1))
        for i in range(40 - n): add(d, c1, 3, 'fill %d' % i)
        ok('add: (setup) 40 comments', len(comments(d, c1)) == 40)
        r = refused(d, lambda: add(d, c1, 3, 'the forty-first'))
        ok('add: the 41st is refused with a plain message', r is not None and r[1] == '22023' and '40' in r[0] and len(comments(d, c1)) == 40, r)
        ok('add: a repeat at 40 is still a no-op, not a refusal', add(d, c1, 3, 'fill 0') == comments(d, c1))
        # overall
        v0 = version(d, w.c)
        r = add_o(d, w.rub, ' Well argued, [Name]. ')
        ok('overall: appends, trimmed, returns the list; the cursor moves', r == ['Well argued, [Name].'] and overall(d, w.rub) == r and version(d, w.c) > v0, r)
        b = obj(T(d, 'get_class_bundle(:c, :v)', c=w.c, v=v0))
        ok('overall: get_class_bundle from before has it', [x['overall_comments'] for x in b['rubrics']['rubrics'] if x['id'] == w.rub] == [['Well argued, [Name].']])
        v1 = version(d, w.c)
        ok('overall: a repeat is a no-op; the cursor stays', add_o(d, w.rub, 'Well argued, [Name].') == ['Well argued, [Name].'] and version(d, w.c) == v1)
        for name, tx in {'no text': None, 'blank': '\n\t ', '501': 'z' * 501}.items():
            r = refused(d, lambda: add_o(d, w.rub, tx))
            ok('overall: refused, nothing changed: ' + name, r is not None and r[1] == '22023' and overall(d, w.rub) == ['Well argued, [Name].'], r)
        r = refused(d, lambda: add_o(d, w.rub, 'EVIL', uid=B))
        ok('overall: another teacher is refused', r is not None and r[1] == 'P0002' and overall(d, w.rub) == ['Well argued, [Name].'], r)
        r = refused(d, lambda: d.role('anon', "select add_rubric_overall_comment(:r::uuid, 'EVIL')", r=w.rub))
        ok('overall: a visitor may not run it', r is not None and 'permission denied' in r[0], r)
        k = d.one('select gen_random_uuid()::text')
        r1 = add_o(d, w.rub, 'Keyed.', key=k); add_o(d, w.rub, 'After.'); r2 = add_o(d, w.rub, 'Keyed.', key=k)
        ok('overall: the key replays', r1 == r2 == ['Well argued, [Name].', 'Keyed.'] and overall(d, w.rub) == ['Well argued, [Name].', 'Keyed.', 'After.'])
        for i in range(37): add_o(d, w.rub, 'o%d' % i)
        r = refused(d, lambda: add_o(d, w.rub, 'one too many'))
        ok('overall: the 41st is refused', r is not None and r[1] == '22023' and len(overall(d, w.rub)) == 40, r)
        # who may run them
        for fn in NEW[2:]:
            ok('add: %s: a teacher and the service role, never a visitor; not security definer' % fn.split('(')[0],
               d.one("select has_function_privilege('authenticated', :f, 'execute') and has_function_privilege('service_role', :f, 'execute') "
                     "and not has_function_privilege('anon', :f, 'execute') and not (select prosecdef from pg_proc where oid = to_regprocedure(:f))", f=fn))
    finally:
        d.close()

# == readers ==
def session(d, e, c, teacher=A):
    code, _pw, _row = d.make(e, c, teacher)
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

CRIT_KEYS = {'id', 'rubric_id', 'name', 'level_4_descriptor', 'level_3_descriptor', 'level_2_descriptor', 'level_1_descriptor',
             'level_5_descriptor', 'level_6_descriptor', 'level_4_value', 'level_3_value', 'level_2_value', 'level_1_value', 'weight', 'display_order'}
RUB_KEYS = {'id', 'name', 'created_at', 'copy_group', 'style', 'scale'}

def scen_readers():
    w = world('readers'); d = w.d
    try:
        c1, c2, c3 = w.crits
        T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'GIVEN-TO-CECE')", e=w.es[0], a=w.asm, c=c1)
        old_bundle = obj(T(d, 'get_class_bundle(:c, null)', c=w.c))
        r = d.file(FILE); ok('readers: (setup) the file applies', r == 'ok', r)
        add(d, c1, 3, 'BANKED-SECRET-ONE'); add(d, c2, 2, 'BANKED-SECRET-TWO'); add_o(d, w.rub, 'OVERALL-SECRET')
        b = obj(T(d, 'get_class_bundle(:c, null)', c=w.c))
        crits = {x['id']: x for x in b['rubrics']['criteria']}
        rubs = {x['id']: x for x in b['rubrics']['rubrics']}
        ok('readers: get_class_bundle: each criteria row has exactly the old keys and "comments"', all(set(x) == CRIT_KEYS | {'comments'} for x in crits.values()), [sorted(x) for x in crits.values()][:1])
        ok('readers: get_class_bundle: each rubrics row has exactly the old keys and "overall_comments"', all(set(x) == RUB_KEYS | {'overall_comments'} for x in rubs.values()), [sorted(x) for x in rubs.values()][:1])
        ok('readers: get_class_bundle: the values', crits[c1]['comments'] == [C(3, 'BANKED-SECRET-ONE')] and crits[c3]['comments'] == []
           and rubs[w.rub]['overall_comments'] == ['OVERALL-SECRET'] and rubs[w.rub6]['overall_comments'] == [])
        def strip(bb):
            bb = json.loads(json.dumps(bb))
            for x in bb['rubrics']['criteria']: x.pop('comments', None)
            for x in bb['rubrics']['rubrics']: x.pop('overall_comments', None)
            bb.pop('version', None)
            return bb
        ok('readers: get_class_bundle: nothing else in the bundle changes (every other key and value as before the file)', strip(b) == strip(old_bundle),
           [k for k in b if b.get(k) != old_bundle.get(k)])
        ok('readers: another teacher gets nothing of this class from it', refused(d, lambda: T(d, 'get_class_bundle(:c, null)', B, c=w.c)) is not None)
        # duplicate_course
        r = T(d, 'duplicate_course(:c, gen_random_uuid())', c=w.c)
        nc = str(r)
        nr = d.one("select id::text from rubric where course_id = :c and name = 'Essay Rubric'", c=nc)
        ok('readers: duplicate_course copies the overall comments', nr is not None and overall(d, nr) == ['OVERALL-SECRET'], (r, nr))
        ncs = {x[0]: obj(x[1]) for x in d.all('select name, comments from criterion where rubric_id = :r', r=nr)} if nr else {}
        src = {x[0]: obj(x[1]) for x in d.all('select name, comments from criterion where rubric_id = :r', r=w.rub)}
        ok('readers: duplicate_course copies each criterion\'s comments', ncs == src and sorted(json.dumps(v, sort_keys=True) for v in src.values()) == sorted(json.dumps(v, sort_keys=True) for v in [[C(3, 'BANKED-SECRET-ONE')], [C(2, 'BANKED-SECRET-TWO')], []]), (ncs, src))
        ok('readers: and the copy is its own: adding to it leaves the first alone',
           nr is not None and add_o(d, nr, 'only on the copy') == ['OVERALL-SECRET', 'only on the copy'] and overall(d, w.rub) == ['OVERALL-SECRET'])
        # import_json_restore
        rid = d.one('select gen_random_uuid()::text'); cid1 = d.one('select gen_random_uuid()::text'); cid2 = d.one('select gen_random_uuid()::text')
        def restore(rub, crits, uid=A):
            return T(d, 'import_json_restore(:p::jsonb, gen_random_uuid())', uid, p=json.dumps({'rubrics': [rub], 'criteria': crits}))
        restore({'id': rid, 'course_id': w.c, 'name': 'Restored', 'style': 'standard', 'overall_comments': [' r1 ', 'r1', 'r2']},
                [dict(crit('RA', comments=[C(4, ' x '), C(4, 'x')]), id=cid1, rubric_id=rid), dict(crit('RB'), id=cid2, rubric_id=rid)])
        ok('readers: import_json_restore takes overall_comments and comments, by the same rule (trimmed, repeats once)',
           overall(d, rid) == ['r1', 'r2'] and comments(d, cid1) == [C(4, 'x')], (overall(d, rid), comments(d, cid1)))
        ok('readers: import_json_restore: a criteria row with no comments gets []', comments(d, cid2) == [])
        restore({'id': rid, 'course_id': w.c, 'name': 'Restored again', 'style': 'standard'}, [dict(crit('RA'), id=cid1, rubric_id=rid)])
        ok('readers: import_json_restore over the same ids: a backup made before this file (no keys) leaves []',
           overall(d, rid) == [] and comments(d, cid1) == [] and d.one('select name from rubric where id = :r', r=rid) == 'Restored again')
        restore({'id': rid, 'course_id': w.c, 'name': 'R3', 'style': 'standard', 'overall_comments': 'not a list'},
                [dict(crit('RA', comments={'not': 'a list'}), id=cid1, rubric_id=rid)])
        ok('readers: import_json_restore: a value that is not a list reads as []', overall(d, rid) == [] and comments(d, cid1) == [])
        snap = (d.all('select id, name, comments from criterion order by id'), d.all('select id, name, overall_comments from rubric order by id'))
        r = refused(d, lambda: restore({'id': rid, 'course_id': w.c, 'name': 'BAD', 'style': 'standard'}, [dict(crit('RA', comments=[C(9, 'bad level')]), id=cid1, rubric_id=rid)]))
        ok('readers: import_json_restore: a list that breaks the rule stops the restore, nothing changed',
           r is not None and r[1] == '22023' and (d.all('select id, name, comments from criterion order by id'), d.all('select id, name, overall_comments from rubric order by id')) == snap, r)
        rid6 = d.one('select gen_random_uuid()::text'); cid6 = d.one('select gen_random_uuid()::text')
        restore({'id': rid6, 'course_id': w.c, 'name': 'R6', 'style': 'standard', 'scale': [{'k': i, 'name': str(i), 'level': 1, 'mod': 0} for i in range(1, 7)]},
                [dict(crit('R6A', comments=[C(6, 'six')]), id=cid6, rubric_id=rid6)])
        ok('readers: import_json_restore: level 6 on a restored rubric with its own levels', comments(d, cid6) == [C(6, 'six')])
        r = refused(d, lambda: restore({'id': rid, 'course_id': w.c, 'name': 'EVIL', 'style': 'standard', 'overall_comments': ['EVIL']}, [], uid=B))
        ok('readers: import_json_restore: another teacher cannot restore into this class', r is not None and 'EVIL' not in json.dumps(d.all('select overall_comments from rubric')), r)
        # the student page
        t1 = session(d, w.es[0], w.c)
        T(d, 'return_grades(:a, array[:e::uuid], gen_random_uuid())', a=w.asm, e=w.es[0])
        page = d.page(t1, w.es[0]); p = json.dumps(page)
        ok('readers: (the page is working) it lists the rubric and its criteria, and the comment given to Cece',
           'Argument' in p and 'Evidence' in p and 'GIVEN-TO-CECE' in p, p[:400])
        def keys(v, out):
            if isinstance(v, dict):
                for k2, x in v.items(): out.add(k2); keys(x, out)
            elif isinstance(v, list):
                for x in v: keys(x, out)
            return out
        ks = keys(obj(page), set())
        ok('readers: student_submit.page carries no "comments" or "overall_comments" key anywhere', 'comments' not in ks and 'overall_comments' not in ks, sorted(ks))
        ok('readers: and no banked text', all(s not in p for s in ('BANKED-SECRET-ONE', 'BANKED-SECRET-TWO', 'OVERALL-SECRET', 'only on the copy')))
        ok('readers: student_submit.page is the definition it was before the file', md5(d, 'student_submit.page(text,uuid,text)') == listed(text_of(FILE), 'relied')['student_submit.page(text,uuid,text)'])
        det = json.dumps(obj(T(d, 'get_assessment_detail(:a)', a=w.asm)))
        ok('readers: get_assessment_detail (a teacher reader that sends whole rows) now shows the bank too; teacher only',
           'BANKED-SECRET-ONE' in det and 'OVERALL-SECRET' in det and 'permission denied' in (refused(d, lambda: d.role('anon', 'select get_assessment_detail(:a)', a=w.asm)) or ('',))[0]
           and 'BANKED' not in json.dumps(refused(d, lambda: T(d, 'get_assessment_detail(:a)', B, a=w.asm)) or obj(T(d, 'get_assessment_detail(:a)', B, a=w.asm))))
    finally:
        d.close()

# == race ==
class Conn:
    """A second (third) session, as a teacher, for the race tests."""
    def __init__(self, d, uid=A):
        self.c = d.other(); self.pid = self.c.run('select pg_backend_pid()')[0][0]
        self.c.run("select set_config('request.jwt.claim.sub', :u, false)", u=uid); self.c.run('set role authenticated')
        self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self):
        try: self.c.close()
        except Exception: pass

def bg(fn):
    box = {}
    def go():
        try: box['r'] = fn()
        except Exception as e: box['e'] = e
    t = threading.Thread(target=go); t.start(); return t, box

def waiting(d, pid, secs=5):
    """True once the session pid waits for a lock."""
    end = time.time() + secs
    while time.time() < end:
        if d.one("select wait_event_type = 'Lock' from pg_stat_activity where pid = :p", p=pid): return True
        time.sleep(0.05)
    return False

def race(d, first, second, holds=None):
    """first runs in an open transaction on one session; second starts on another and must wait; then first commits.
    Returns (second's answer or error, whether it waited)."""
    a, b = Conn(d), Conn(d)
    try:
        a.run('begin'); first(a)
        if holds: holds(a)
        t, box = bg(lambda: second(b))
        w = waiting(d, b.pid)
        a.run('commit'); t.join(30)
        return box, w
    finally:
        a.close(); b.close()

def sel(conn, sql, **kw): return obj(conn.run('select ' + sql, **kw)[0][0])

def scen_race():
    w = world('race', apply=True); d = w.d
    try:
        c1, c2, _ = w.crits
        add(d, c1, 3, 'kept before')
        old_rows = crit_rows(d, w.rub)   # what an old tab holds: no comments
        # an old tab's save first, an add meanwhile
        box, waited = race(d, lambda a: ur(d, w.rub, w.c, 'Old tab', old_rows, conn=a),
                           lambda b: sel(b, "add_criterion_comment(:c::uuid, 2::smallint, 'added meanwhile')", c=c1))
        ok('race: an add waits for a rubric save, then appends to what the save left', waited and 'e' not in box and comments(d, c1) == [C(3, 'kept before'), C(2, 'added meanwhile')], (waited, box))
        # an add first, an old tab's save meanwhile
        box, waited = race(d, lambda a: sel(a, "add_criterion_comment(:c::uuid, 4::smallint, 'added first')", c=c1),
                           lambda b: ur(d, w.rub, w.c, 'Old tab again', old_rows, conn=b))
        ok("race: an old tab's save waits for an add and does not lose it", waited and 'e' not in box
           and comments(d, c1) == [C(3, 'kept before'), C(2, 'added meanwhile'), C(4, 'added first')], (waited, box, comments(d, c1)))
        # a new editor's save with a list first, an add meanwhile: the add lands after it
        rows = crit_rows(d, w.rub); rows[0]['comments'] = [C(3, 'from the editor')]
        box, waited = race(d, lambda a: ur(d, w.rub, w.c, 'Editor', rows, conn=a),
                           lambda b: sel(b, "add_criterion_comment(:c::uuid, 3::smallint, 'add after editor')", c=c1))
        ok('race: an editor save that replaces the list, then an add: both kept, in that order', waited and comments(d, c1) == [C(3, 'from the editor'), C(3, 'add after editor')], (waited, box))
        # two adds
        box, waited = race(d, lambda a: sel(a, "add_criterion_comment(:c::uuid, 1::smallint, 'one')", c=c2),
                           lambda b: sel(b, "add_criterion_comment(:c::uuid, 1::smallint, 'two')", c=c2))
        ok('race: two adds to one criterion: the second waits, both kept', waited and comments(d, c2) == [C(1, 'one'), C(1, 'two')] and box.get('r') == [C(1, 'one'), C(1, 'two')], (waited, box))
        box, waited = race(d, lambda a: sel(a, "add_criterion_comment(:c::uuid, 1::smallint, 'same')", c=c2),
                           lambda b: sel(b, "add_criterion_comment(:c::uuid, 1::smallint, 'same')", c=c2))
        ok('race: the same comment from two devices at once is kept once', waited and [x['text'] for x in comments(d, c2)].count('same') == 1, (waited, box))
        box, waited = race(d, lambda a: sel(a, "add_rubric_overall_comment(:r::uuid, 'o-one')", r=w.rub),
                           lambda b: sel(b, "add_rubric_overall_comment(:r::uuid, 'o-two')", r=w.rub))
        ok('race: two overall adds: both kept', waited and overall(d, w.rub) == ['o-one', 'o-two'], (waited, box))
        box, waited = race(d, lambda a: ur(d, w.rub, w.c, 'Old tab', crit_rows(d, w.rub), conn=a),
                           lambda b: sel(b, "add_rubric_overall_comment(:r::uuid, 'o-three')", r=w.rub))
        ok('race: an overall add waits for a rubric save; an old save keeps the overall list', waited and overall(d, w.rub) == ['o-one', 'o-two', 'o-three'], (waited, box))
        now_rows = crit_rows(d, w.rub)   # read here: a session is used by one thread at a time
        box, waited = race(d, lambda a: sel(a, "add_rubric_overall_comment(:r::uuid, 'o-four')", r=w.rub),
                           lambda b: ur(d, w.rub, w.c, 'Old tab', now_rows, conn=b))
        ok('race: an old save waits for an overall add and keeps it', waited and overall(d, w.rub)[-1] == 'o-four', (waited, box))
        # the order that would deadlock: a save has the rubric (and the class's sync cursor) when the add starts,
        # then goes on to the criterion
        def deadlock_try(fn_sql):
            now_rows = crit_rows(d, w.rub)
            a, b = Conn(d), Conn(d)
            try:
                a.run('begin'); a.run('update rubric set updated_at = now() where id = :r', r=w.rub)
                t, box = bg(lambda: b.run(fn_sql, c=c1))
                waited = waiting(d, b.pid)
                t2, box2 = bg(lambda: ur(d, w.rub, w.c, 'Old tab', now_rows, conn=a))
                t2.join(30)
                if 'e' in box2:
                    a.run('rollback')
                else:
                    a.run('commit')
                t.join(30)
                return waited, box, box2
            finally:
                a.close(); b.close()
        waited, box, box2 = deadlock_try("select add_criterion_comment(:c::uuid, 1::smallint, 'no deadlock')")
        ok('race: a save holding the rubric and the sync cursor, an add, then the save writes the criterion: no deadlock, both land',
           waited and 'e' not in box and 'e' not in box2 and C(1, 'no deadlock') in comments(d, c1), (waited, box, box2))
        # the same without the rubric lock: proves the test above can see a deadlock
        src = defn(d, NEW[2])
        assert src.count('for no key update of r;') == 1
        d.run('create schema nolock')
        d.run(src.replace('public.add_criterion_comment(', 'nolock.add_criterion_comment(', 1).replace('for no key update of r;', ';'))
        d.run('grant usage on schema nolock to authenticated'); d.run('grant execute on all functions in schema nolock to authenticated')
        waited, box, box2 = deadlock_try("select nolock.add_criterion_comment(:c::uuid, 1::smallint, 'would deadlock')")
        errs = [message(x['e']) for x in (box, box2) if 'e' in x]
        ok('race: (the check bites) without the rubric lock that order deadlocks', any('deadlock' in e for e in errs), (waited, errs))
        d.run('drop schema nolock cascade')
        # delete_rubric first
        rid = str(ur(d, None, w.c, 'To delete', [crit('Gone')])); gc = crit_ids(d, rid)[0]
        box, waited = race(d, lambda a: a.run('select delete_rubric(:r)', r=rid),
                           lambda b: sel(b, "add_criterion_comment(:c::uuid, 1::smallint, 'too late')", c=gc))
        ok('race: delete_rubric first: the add waits, then finds nothing', waited and 'e' in box and sqlstate(box['e']) == 'P0002', (waited, box))
        rid = str(ur(d, None, w.c, 'To delete 2', [crit('Gone')])); gc = crit_ids(d, rid)[0]
        box, waited = race(d, lambda a: sel(a, "add_criterion_comment(:c::uuid, 1::smallint, 'just in time')", c=gc),
                           lambda b: b.run('select delete_rubric(:r)', r=rid))
        ok('race: an add first: delete_rubric waits, then deletes it with its comments', waited and 'e' not in box and d.one('select count(*) from criterion where id = :c', c=gc) == 0, (waited, box))
        # import_json_restore first
        rows_r = [dict(crit('Argument', comments=[C(3, 'restored')]), id=c1, rubric_id=w.rub)]
        payload = json.dumps({'rubrics': [{'id': w.rub, 'course_id': w.c, 'name': 'Essay Rubric', 'style': 'standard', 'overall_comments': ['restored overall']}], 'criteria': rows_r})
        box, waited = race(d, lambda a: a.run('select import_json_restore(:p::jsonb, gen_random_uuid())', p=payload),
                           lambda b: sel(b, "add_criterion_comment(:c::uuid, 3::smallint, 'after restore')", c=c1))
        ok('race: a restore first: the add waits, then appends to the restored list', waited and comments(d, c1) == [C(3, 'restored'), C(3, 'after restore')], (waited, box, comments(d, c1)))
        box, waited = race(d, lambda a: sel(a, "add_rubric_overall_comment(:r::uuid, 'before restore')", r=w.rub),
                           lambda b: b.run('select import_json_restore(:p::jsonb, gen_random_uuid())', p=payload))
        ok('race: an add first: the restore waits, then puts its own list (a restore is the whole class as it was)',
           waited and 'e' not in box and overall(d, w.rub) == ['restored overall'], (waited, box))
        # duplicate_course reads; it does not wait for an add and copies what is committed
        box, waited = race(d, lambda a: sel(a, "add_criterion_comment(:c::uuid, 2::smallint, 'uncommitted while copying')", c=c1),
                           lambda b: b.run('select duplicate_course(:c, gen_random_uuid())', c=w.c))
        ok('race: duplicate_course does not wait for an add', not waited and 'e' not in box, (waited, box))
        # a grade save is not held up by the lock an add takes on the criterion
        a, b = Conn(d), Conn(d)
        try:
            a.run('begin'); a.run('select 1 from rubric r join criterion c on c.rubric_id = r.id where c.id = :c for no key update of r', c=c1)
            a.run('select 1 from criterion where id = :c for no key update', c=c1)
            b.run("set lock_timeout = '2s'")
            r = refused(d, lambda: b.run("select upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'graded meanwhile')", e=w.es[1], a=w.asm, c=c1))
            a.run('rollback')
        finally:
            a.close(); b.close()
        ok("race: the add's row locks do not hold up a grade being saved on that criterion", r is None and
           d.one('select comment from rubric_score where enrollment_id = :e and criterion_id = :c', e=w.es[1], c=c1) == 'graded meanwhile', r)
    finally:
        d.close()

# == scales ==
def scale_of(n): return [{'k': i, 'name': 'L%d' % i, 'level': min(4, max(1, i - (n - 4))), 'mod': 0} for i in range(1, n + 1)]

def scen_scales():
    w = world('scales', apply=True); d = w.d
    try:
        # the story: a six-level rubric banks a level-6 comment, then goes back to four levels
        add(d, w.crit6, 6, 'Top of six.'); add(d, w.crit6, 5, 'Five of six.')
        ur(d, w.rub6, w.c, 'Six Point', crit_rows(d, w.rub6), scale=[])
        ok('scales: back to four levels (p_scale []): the save works and keeps the level 5 and 6 comments',
           d.one('select scale from rubric where id = :r', r=w.rub6) is None and comments(d, w.crit6) == [C(6, 'Top of six.'), C(5, 'Five of six.')], comments(d, w.crit6))
        rows = crit_rows(d, w.rub6); rows[0]['comments'] = comments(d, w.crit6) + [C(4, 'Four.')]
        r = refused(d, lambda: ur(d, w.rub6, w.c, 'Six Point', rows))
        ok('scales: the editor sends the list back, levels 5 and 6 in it: the save works', r is None and len(comments(d, w.crit6)) == 3, r)
        r = refused(d, lambda: add(d, w.crit6, 6, 'Another six.'))
        ok('scales: Add to Bank at level 6 on it works', r is None and C(6, 'Another six.') in comments(d, w.crit6), r)
        nc = str(T(d, 'duplicate_course(:c, gen_random_uuid())', c=w.c))
        copied = obj(d.one("select c.comments from criterion c join rubric r on r.id = c.rubric_id where r.course_id = :c and r.name = 'Six Point'", c=nc))
        ok('scales: Duplicate Class copies it', copied == comments(d, w.crit6), copied)
        payload = {'rubrics': [{'id': w.rub6, 'course_id': w.c, 'name': 'Six Point', 'style': 'standard', 'scale': None, 'overall_comments': []}],
                   'criteria': [dict(crit('Ideas'), id=w.crit6, rubric_id=w.rub6, comments=comments(d, w.crit6))]}
        r = refused(d, lambda: T(d, 'import_json_restore(:p::jsonb, gen_random_uuid())', p=json.dumps(payload)))
        ok('scales: a backup of the class restores, levels 5 and 6 and all', r is None and len(comments(d, w.crit6)) == 4, r)
        # rubrics of two to five levels: every level 1 to 6 is taken, by a save and by Add to Bank
        for n in (2, 3, 4, 5):
            rid = str(ur(d, None, w.c, 'Scale %d' % n, [crit('Only', comments=[C(lv, 'saved %d' % lv) for lv in range(1, 7)])],
                         scale=scale_of(n) if n != 4 else None))
            cid = crit_ids(d, rid)[0]
            got = [add(d, cid, lv, 'added %d' % lv) for lv in range(1, 7)][-1]
            r7 = refused(d, lambda: add(d, cid, 7, 'seven'))
            ok('scales: a rubric of %d levels takes levels 1 to 6 (save and add), refuses 7' % n,
               len(got) == 12 and {x['level'] for x in got} == set(range(1, 7)) and r7 is not None and r7[1] == '22023', (got, r7))
    finally:
        d.close()

# == table ==
def direct(d, sql, **kw):
    """A teacher's own write straight to the table, as authenticated may (row security lets them update their rows)."""
    return refused(d, lambda: d.role('authenticated', sql, uid=A, **kw))

def worst(n, overall=False):
    """n distinct texts of 500 control characters (each a 6-byte escape in jsonb's text), at level 6."""
    ctrl = [c for c in range(1, 32) if c not in (8, 9, 10, 12, 13)]   # the five with a two-byte escape left out
    texts = [chr(ctrl[i % len(ctrl)]) + chr(ctrl[i // len(ctrl)]) + chr(1) * 498 for i in range(n)]
    return texts if overall else [C(6, x) for x in texts]

def scen_table():
    w = world('table', apply=True); d = w.d
    try:
        c1 = w.crits[0]
        add(d, c1, 3, 'kept'); add_o(d, w.rub, 'kept overall')
        before = (comments(d, c1), overall(d, w.rub))
        cases = {
            'level 99, 100 KB': [{'level': 99, 'text': 'x' * 100000}],
            'level 99': [C(99, 'x')],
            '41 items': [C(3, 'c%d' % i) for i in range(41)],
            'a text of 501 characters': [C(3, 'y' * 501)],
            'an untrimmed text': [C(3, ' padded ')],
            'a repeat': [C(3, 'same'), C(3, 'same')],
            'a level as text': [C('3', 'stored as text')],
            'an extra key': [{'level': 3, 'text': 'x', 'extra': 1}],
            'not a list': {'level': 3, 'text': 'x'},
            '200 KB in one item': [C(3, 'z' * 200000)],
        }
        for name, val in cases.items():
            r = direct(d, 'update criterion set comments = :v::jsonb where id = :c', v=json.dumps(val), c=c1)
            ok('table: a direct write is refused: ' + name, r is not None and r[1] in ('23514', '22023') and comments(d, c1) == before[0], r)
        for name, val in {'41': ['o%d' % i for i in range(41)], 'a number': [3], 'untrimmed': [' x '], '200 KB': ['z' * 200000]}.items():
            r = direct(d, 'update rubric set overall_comments = :v::jsonb where id = :r', v=json.dumps(val), r=w.rub)
            ok('table: a direct overall write is refused: ' + name, r is not None and r[1] in ('23514', '22023') and overall(d, w.rub) == before[1], r)
        r = direct(d, 'update criterion set comments = :v::jsonb where id = :c', v=json.dumps([C(2, 'direct and fine')]), c=c1)
        ok('table: a direct write that keeps the rule is taken', r is None and comments(d, c1) == [C(2, 'direct and fine')], r)
        # the byte caps are the most the rule allows, exactly
        big, bigo = worst(40), worst(40, overall=True)
        ok('table: (setup) the rule takes forty 500-character control-character comments at level 6',
           obj(d.one('select _rubric_comment_list(:v::jsonb, true)', v=json.dumps(big))) == big)
        r = direct(d, 'update criterion set comments = :v::jsonb where id = :c', v=json.dumps(big), c=c1)
        n = d.one('select octet_length(comments::text) from criterion where id = :c', c=c1)
        ok('table: the largest list the rule allows fits the criterion cap, which it fills exactly (121,040 bytes)', r is None and n == 121040, (r, n))
        r = direct(d, 'update rubric set overall_comments = :v::jsonb where id = :r', v=json.dumps(bigo), r=w.rub)
        n = d.one('select octet_length(overall_comments::text) from rubric where id = :r', r=w.rub)
        ok('table: and the overall cap (120,160 bytes)', r is None and n == 120160, (r, n))
        r = direct(d, 'update criterion set comments = :v::jsonb where id = :c', v=json.dumps([C(3, chr(0x1F600) * 500)] * 1), c=c1)
        ok('table: four-byte letters are well inside it', r is None)
        con = {x[0]: x[1] for x in d.all("select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.criterion'::regclass, 'public.rubric'::regclass) and conname like '%comments%' order by 1")}
        ok('table: the six checks', sorted(con) == ['criterion_comments_is_list', 'criterion_comments_rule', 'criterion_comments_size',
                                                    'rubric_overall_comments_is_list', 'rubric_overall_comments_rule', 'rubric_overall_comments_size'], con)
    finally:
        d.close()

# == apply ==
def scen_apply():
    w = world('apply'); d = w.d
    try:
        text = text_of(FILE)
        ok('apply: plain ASCII, no backslash, no unicode escape', text.isascii() and chr(92) not in text and 'u&' not in text.lower())
        ok('apply: small enough to send whole (under 60 KB)', len(text.encode()) < 60000, len(text.encode()))
        for fn in (UNDO, PRE, POST, FPS):
            t = text_of(fn); ok('apply: %s is plain ASCII, no backslash' % fn, t.isascii() and chr(92) not in t)
        T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'old')", e=w.es[0], a=w.asm, c=w.crits[0])
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        old_crit = d.all('select * from criterion order by id'); old_rub = d.all('select * from rubric order by id')
        mutations = {
            'a relied function changed': "create or replace function public.fv_owns_course(cid uuid) returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$ select true $$",
            'the student page changed': "comment on schema public is 'x'; select 1",
            'a patched function changed': "create or replace function public.duplicate_course(p_src_id uuid, p_idempotency_key uuid default null) returns uuid language sql as $$ select null::uuid $$",
            'the old upsert_rubric changed': "create or replace function public.upsert_rubric(p_id uuid, p_course_id uuid, p_name text, p_criteria jsonb, p_copy_group uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_style text DEFAULT NULL::text, p_linked_tag_ids jsonb DEFAULT NULL::jsonb, p_scale jsonb DEFAULT NULL::jsonb) returns uuid language sql as $$ select null::uuid $$",
            'another upsert_rubric': "create function public.upsert_rubric(x int) returns int language sql as $$ select 1 $$",
            'another add_criterion_comment': "create function public.add_criterion_comment(x int) returns int language sql as $$ select 1 $$",
            'a new function already there, not as the file makes it': "create function public.add_rubric_overall_comment(p_rubric_id uuid, p_text text, p_idempotency_key uuid default null) returns jsonb language sql as $$ select null::jsonb $$",
            "a column of the file's name of another type": 'alter table criterion add column comments text',
            'a column the file does not know': 'alter table rubric add column surprise text',
        }
        mutations['the student page changed'] = defn(d, 'student_submit.page(text,uuid,text)').replace("'id', r.id, 'name', r.name,", "'id', r.id, 'name', r.name, 'overall_comments', null,", 1)
        assert mutations['the student page changed'] != defn(d, 'student_submit.page(text,uuid,text)')
        for name, sql in mutations.items():
            d.run('begin'); d.run(sql)
            r = d.statements(split(text)); d.run('rollback')
            ok('apply: the guard stops: ' + name, r.startswith('STOPPED') and 'Nothing was changed' in r, r[:300])
        ok('apply: (guards) the catalog and rows are as they were', quiet0(differences(cat0, catalog(d.c))) == ([], []) and row_checksums(d.c) == rows0)
        for name, sql in mutations.items():
            if name.startswith('another upsert') or name.startswith('another add'): continue
            d.run('begin'); d.run(sql); d.file(PRE); n = len(d.rows); d.run('rollback')
            ok('apply: the pre-check names it: ' + name, n > 0, n)
        d.file(PRE); ok('apply: the pre-check before: only its two count rows', [x[0] for x in d.rows] == ['count: criteria', 'count: rubrics'], d.rows)
        d.file(FPS); ok('apply: the fingerprints query is empty before', d.rows == [], d.rows)
        v0 = d.all('select course_id, version from course_sync_cursor order by 1')
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c))
        known = ('criterion', 'rubric', 'get_class_bundle', 'duplicate_course', 'import_json_restore', 'add_criterion_comment', 'add_rubric_overall_comment',
                 '_rubric_comment_list', 'upsert_rubric', 'depends', 'comments')
        ok('apply: the catalog changes only in what the header names', all(any(k in l for k in known) for l in gone + new), [l[:200] for l in gone + new if not any(k in l for k in known)])
        ok('apply: every other table\'s rows are as they were; no class\'s sync cursor moved',
           all(rows0[k] == v for k, v in row_checksums(d.c).items() if k in rows0 and k not in ('public.criterion', 'public.rubric'))
           and d.all('select course_id, version from course_sync_cursor order by 1') == v0)
        ok('apply: every criterion and rubric row is as it was, with [] in the new column',
           [r[:-1] for r in d.all('select * from criterion order by id')] == old_crit and all(r[-1] == [] or r[-1] == '[]' for r in d.all('select comments from criterion'))
           and [r[:-1] for r in d.all('select * from rubric order by id')] == old_rub and all(obj(r[0]) == [] for r in d.all('select overall_comments from rubric')))
        cat1 = catalog(d.c)
        got = {s: md5(d, s) for s in PATCHED + NEW}
        ok('apply: the md5s the file carries are the ones the database has', listed(text, 'after') == got, [k for k in got if listed(text, 'after').get(k) != got[k]])
        r2 = d.file(FILE); dd = quiet0(differences(cat1, catalog(d.c)))
        ok('apply: a second run applies and changes nothing', r2 == 'ok' and dd == ([], []), (r2, [[l[:200] for l in s] for s in dd]))
        r = d.file(POST); bad = [x for x in d.rows if x[1] != 'ok']
        ok('apply: the post-check: every row ok (%d rows)' % len(d.rows), r == 'ok' and d.rows and not bad, bad[:3])
        d.file(FPS); ok('apply: the fingerprints query after names the patched functions and the old upsert_rubric', {x[0] for x in d.rows} == set(PATCHED + OLD), [x[0] for x in d.rows])
        d.file(PRE); ok('apply: the pre-check after names what is already there', len(d.rows) > 2)
        # the final check trips
        r = d.file(UNDO); ok('apply: (setup) undone', r == 'ok' and not applied(d), r)
        trips = {
            'a function md5': text.split('do $final$')[0] + 'do $final$' + text.split('do $final$')[1].replace(got[NEW[2]], '0' * 32, 1),
            'the grant': text.replace('grant execute on function public.add_rubric_overall_comment(uuid, text, uuid) to authenticated, service_role;',
                                      'grant execute on function public.add_rubric_overall_comment(uuid, text, uuid) to authenticated, service_role, anon;', 1),
            'an edit that no longer matches once': text.replace("array['public.duplicate_course(uuid,uuid)',\n          'level_5_descriptor, level_6_descriptor)',",
                                                                 "array['public.duplicate_course(uuid,uuid)',\n          'level_6_descriptor',", 1),
        }
        for name, bad_text in trips.items():
            if bad_text == text:
                ok('apply: (setup) the trip changes the text: ' + name, False); continue
            r = d.statements(split(bad_text))
            ok('apply: the last check or a guard stops it, nothing left: ' + name, r.startswith('STOPPED') and not applied(d), r[:300])
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('apply: (after the trips) the catalog is as before the file', dd == ([], []), [[l[:200] for l in s] for s in dd])
        c2 = d.other(); c2.run('begin'); c2.run('lock table criterion in access share mode')
        t0 = time.time(); r = d.file(FILE); c2.run('rollback'); c2.close()
        ok('apply: a reader holding criterion: gives up in about five seconds, nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 <= time.time() - t0 < 12 and not applied(d), (r, time.time() - t0))
        # a teacher's save in flight: it holds the rubric row (and so the table) while it writes
        wr = Conn(d); wr.run('begin'); wr.run('update rubric set name = name where id = :r', r=w.rub)
        t0 = time.time(); r = d.file(FILE); wr.run('rollback'); wr.close()
        ok('apply: a save holding a rubric row past five seconds: the file gives up, nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and not applied(d), r[:200])
        wr = Conn(d); wr.run('begin')
        ur(d, w.rub, w.c, 'Saved while applying', crit_rows(d, w.rub), conn=wr)
        t, box = bg(lambda: d.file(FILE))
        time.sleep(1); still = t.is_alive(); wr.run('commit'); wr.close(); t.join(30)
        ok('apply: a save in flight that ends within five seconds: the file waits for it, then applies; the save is kept',
           still and box.get('r') == 'ok' and applied(d) and d.one('select name from rubric where id = :r', r=w.rub) == 'Saved while applying', box)
        r = d.file(UNDO); ok('apply: (setup) undone again', r == 'ok' and not applied(d), r)
        a = Conn(d); a.run('begin'); a.run('update rubric set updated_at = now() where id = :r', r=w.rub)
        t, box = bg(lambda: d.file(FILE))
        time.sleep(0.5); still = t.is_alive()
        t2, box2 = bg(lambda: a.run('update criterion set updated_at = now() where rubric_id = :r', r=w.rub))
        t2.join(10); a.run('commit'); a.close(); t.join(30)
        ok('apply: a save that has the rubric and then writes its criteria while the file waits: no deadlock, both finish',
           still and 'e' not in box2 and box.get('r') == 'ok' and applied(d), (box, box2))
        r = d.file(UNDO); ok('apply: (setup) undone once more', r == 'ok' and not applied(d), r)
        ok('apply: a constant default (no rewrite): the criterion table keeps its file', (lambda f0: (d.file(FILE), d.one("select pg_relation_filenode('public.criterion')") == f0)[1])(d.one("select pg_relation_filenode('public.criterion')")))
    finally:
        d.close()

# == undo ==
def undo_part(n):
    t = text_of(UNDO)
    a = t.index('-- PART %d begins' % n); b = t.index('-- PART %d ends' % n)
    return t[a:b]

KEEP_COLS = {'public.criterion': ['id', 'rubric_id', 'name', 'level_1_descriptor', 'level_2_descriptor', 'level_3_descriptor', 'level_4_descriptor',
                                   'level_5_descriptor', 'level_6_descriptor', 'level_1_value', 'level_2_value', 'level_3_value', 'level_4_value',
                                   'weight', 'display_order', 'created_at'],
             'public.rubric': ['id', 'course_id', 'name', 'created_at', 'copy_group', 'style', 'scale']}

def scen_undo():
    w = world('undo'); d = w.d
    try:
        T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'old')", e=w.es[0], a=w.asm, c=w.crits[0])
        cat0 = catalog(d.c); rows0 = row_checksums(d.c); keep0 = row_checksums(d.c, KEEP_COLS)
        r = d.file(UNDO); ok('undo: on a database where the file was never applied it changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.statements(split(undo_part(0)))
        ok('undo: PART 0 alone on a database without the file changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
        add(d, w.crits[0], 3, 'kept in the bank'); add_o(d, w.rub, 'kept overall')
        # PART 0
        r = d.statements(split(undo_part(0))); ok('undo: PART 0 runs', r == 'ok', r)
        rows = crit_rows(d, w.rub); rows[0]['comments'] = [C(1, 'should be ignored')]
        ur(d, w.rub, w.c, 'After stop', rows, overall=['ignored too'])
        ok('undo: after PART 0 a save keeps the bank as it is, whatever it sends (saves are as before the file)',
           comments(d, w.crits[0]) == [C(3, 'kept in the bank')] and overall(d, w.rub) == ['kept overall'] and d.one('select name from rubric where id = :r', r=w.rub) == 'After stop')
        r1 = refused(d, lambda: add(d, w.crits[0], 3, 'x')); r2 = refused(d, lambda: add_o(d, w.rub, 'x'))
        ok('undo: after PART 0 Add to Bank is refused for a teacher', r1 is not None and r2 is not None and 'permission denied' in r1[0], (r1, r2))
        ok('undo: after PART 0 the bank still reads in the bundle', any(x['comments'] for x in obj(T(d, 'get_class_bundle(:c, null)', c=w.c))['rubrics']['criteria']))
        cat_stop = catalog(d.c)
        r = d.statements(split(undo_part(0))); ok('undo: PART 0 a second time changes nothing', r == 'ok' and quiet0(differences(cat_stop, catalog(d.c))) == ([], []), r)
        # the full removal refuses while anything is kept
        r = d.file(UNDO)
        ok('undo: the removal refuses while a comment is kept, and says how many', r.startswith('STOPPED') and '1 criteria' in r and '1 rubrics' in r and applied(d), r[:300])
        ok('undo: (refused) nothing changed', quiet0(differences(cat_stop, catalog(d.c))) == ([], []) and comments(d, w.crits[0]) == [C(3, 'kept in the bank')])
        d.run("update criterion set comments = '[]' where comments <> '[]'")
        r = d.file(UNDO)
        ok('undo: still refuses while an overall comment is kept', r.startswith('STOPPED') and 'overall' in r, r[:300])
        d.run("update rubric set overall_comments = '[]' where overall_comments <> '[]'")
        d.run("update rubric set name = 'Essay Rubric' where id = :r", r=w.rub)
        rows1 = row_checksums(d.c)
        r = d.file(UNDO); ok('undo: runs once the bank is empty', r == 'ok' and not applied(d), r)
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('undo: the catalog is exactly as before the file (md5 of every function, grants, comments, columns, checks)', dd == ([], []), [[l[:200] for l in s] for s in dd])
        ok('undo: every other table\'s rows are as they were', all(rows1[k] == v for k, v in row_checksums(d.c).items() if k in rows1 and k not in ('public.criterion', 'public.rubric')))
        now = row_checksums(d.c, KEEP_COLS)
        ok('undo: criterion and rubric rows are as before the file (every column but updated_at, which the saves in this test moved)',
           now == keep0, (now, keep0))
        ok('undo: every function is the live one again', all(md5(d, s) == v for s, v in listed(text_of(UNDO), 'undo-after').items()))
        r = d.file(UNDO); ok('undo: a second run changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and applied(d), r)
        ok('undo: and works', add(d, w.crits[0], 2, 'works again') == [C(2, 'works again')])
        r = d.statements(split(undo_part(0)))
        d.run("update criterion set comments = '[]'")
        r = d.file(UNDO); ok('undo: the removal also runs after PART 0', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
    finally:
        d.close()

SCENARIOS = {'upsert': scen_upsert, 'add': scen_add, 'scales': scen_scales, 'table': scen_table, 'readers': scen_readers, 'race': scen_race,
             'apply': scen_apply, 'undo': scen_undo}

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (args or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
