"""A line for one student under a criterion: migrations/2026112410_criterion_own_line.sql on a database rebuilt from
the repo and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "A line for one student under a
criterion"), which has 2026112408 and 2026112409.

    PGPORT=<port> PGDATABASE=<db> python3 criterion_own_line.py fingerprints   write the md5 lists the files carry
    PGPORT=<port> PGDATABASE=<db> python3 criterion_own_line.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 criterion_own_line.py upsert         or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  upsert    upsert_rubric_score with eight arguments: null keeps, '' clears, a row with no level stays while a
            comment, a Went Beyond or a line remains and goes when all three are gone; calls of four to seven
            arguments (positional and named) resolve to the one function; who may run it; another teacher's class.
  copy      _grade_copy_entry and _grade_copy: byte for byte what the old functions answered when no line is
            there (a grid of every kind of argument, then 400 random rows, then the stored copies); the key "own"
            when a line is; a row with only a line is not null.
  readers   get_class_bundle's eight-element tuple, get_withdrawn_student_records, import_json_restore, the draft
            guard, and what a student's page is given (own line only, never a group mate's).
  apply     the guards stop with the catalog unchanged; only what the header names changes; no row; the md5s; a
            second run; the three read-only files; lock timeout; size; plain ASCII, no backslash.
  undo      refuses while a line is held; then leaves the catalog and every row as before; a second run; the file
            again.
"""
import json, os, random, re, sys, time
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hashlib, secrets
import card_codes_common as ccc
from card_codes_common import Db, refused, ok, finish, nid, split, text_of, code_tag, key_id, pw_tag, FAKE_KEY, connect, message
from catalog import catalog, differences, row_checksums

FILE = '../2026112410_criterion_own_line.sql'
UNDO = 'criterion-own-line-undo.sql'
PRE = 'criterion-own-line-live-precheck.sql'
POST = 'criterion-own-line-live-postcheck.sql'
FPS = 'criterion-own-line-live-fingerprints.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'

RELIED = ['public._grade_copy_of(numeric,integer,text,jsonb,jsonb,jsonb)', 'public._grade_copy_in_use(jsonb,uuid)',
          'public._grade_copy_remap(jsonb,jsonb,jsonb,jsonb)', 'public.fill_rubric(uuid,uuid,integer,smallint)',
          'public.move_rubric_scores(uuid,uuid,jsonb,jsonb,uuid)', 'student_submit._returned_grade(uuid,uuid)',
          'fv_private.restore_grade_returns(jsonb)', 'public._grade_return_on_change()',
          'public.fv_owns_rubric_score_cell(uuid,uuid,uuid)']
PATCHED = ['public._grade_copy(uuid,uuid)', 'public.get_class_bundle(uuid,bigint)', 'public.get_withdrawn_student_records(uuid)',
           'public.import_json_restore(jsonb,uuid)', 'public._assessment_draft_guard()']
OLD = ['public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text)', 'public._grade_copy_entry(integer,integer,text,text,boolean)']
NEW = ['public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)', 'public._grade_copy_entry(integer,integer,text,text,boolean,text)']
UPSERT8 = NEW[0]

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
def applied(d): return d.one("select to_regprocedure('public.upsert_rubric_score(uuid,uuid,uuid,integer,smallint,text,text,text)') is not null")
def obj(v): return json.loads(v) if isinstance(v, str) else v
def without_final(text):
    a = text.index('do $final$'); b = text.index('$final$;', a + 12) + len('$final$;')
    return text[:a] + text[b:]
def q(s): return "'" + s.replace("'", "''") + "'"

def put_list(text, name, rows):
    pat = re.compile(r'(-- FINGERPRINTS-BEGIN %s[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)' % re.escape(name), re.S)
    m = pat.search(text)
    if not m: sys.exit('no list %s' % name)
    indent = re.match(r'[ \t]*', m.group(2)).group(0)
    return text[:m.start(2)] + ',\n'.join(indent + r for r in rows) + text[m.end(2):]
def tup(*v): return '(' + ', '.join(q(x) for x in v) + ')'

# == The md5 lists the files carry, and the old definitions the undo restores ==
def scen_fingerprints():
    d = Db('co_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        relied = {s: md5(d, s) for s in RELIED}
        before = {s: md5(d, s) for s in PATCHED}
        old = {s: md5(d, s) for s in OLD}
        old_defs = {s: defn(d, s) for s in OLD}
        missing = [s for s, v in list(relied.items()) + list(before.items()) + list(old.items()) if v is None]
        if missing: sys.exit('not on the template: %s' % missing)
        path = os.path.join(HERE, FILE)
        text = open(path).read()
        text = put_list(text, 'relied', [tup(s, relied[s]) for s in RELIED])
        text = put_list(text, 'replaces', [tup(s, before[s], '-') for s in PATCHED])
        text = put_list(text, 'dropped', [tup(s, old[s]) for s in OLD])
        text = put_list(text, 'new', [tup(s, '-') for s in NEW])
        text = put_list(text, 'after', [tup(s, '-') for s in PATCHED + NEW])
        r = d.statements(split(without_final(text)))
        if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
        after = {s: md5(d, s) for s in PATCHED + NEW}
        text = put_list(text, 'replaces', [tup(s, before[s], after[s]) for s in PATCHED])
        text = put_list(text, 'new', [tup(s, after[s]) for s in NEW])
        text = put_list(text, 'after', [tup(s, after[s]) for s in PATCHED + NEW])
        open(path, 'w').write(text)
        live = list(relied.items()) + list(before.items()) + list(old.items())
        for fn, name, rows in ((FPS, 'live', live), (PRE, 'precheck', live), (POST, 'postcheck', list(relied.items()) + list(after.items()))):
            p = os.path.join(HERE, fn); t = open(p).read()
            open(p, 'w').write(put_list(t, name, [tup(s, v) for s, v in rows]))
        p = os.path.join(HERE, UNDO); t = open(p).read()
        t = put_list(t, 'undo-new', [tup(s, after[s]) for s in NEW])
        t = put_list(t, 'undo-dropped', [tup(s, old[s]) for s in OLD])
        t = put_list(t, 'undo-replaced', [tup(s, before[s], after[s]) for s in PATCHED])
        t = put_list(t, 'undo-after', [tup(s, v) for s, v in list(before.items()) + list(old.items())])
        a = t.index('-- OLD-DEFINITIONS-BEGIN'); a = t.index('\n', a) + 1; b = t.index('-- OLD-DEFINITIONS-END')
        t = t[:a] + ''.join(old_defs[s].rstrip() + ';\n\n' for s in OLD) + t[b:]
        open(p, 'w').write(t)
        print('written: relied %d, patched %d, old %d, new %d' % (len(relied), len(before), len(old), len(NEW)))
    finally:
        d.close()

# == The world ==
class W: pass

def world(tag, apply=False, old_fns=False):
    d = Db('co_' + tag)
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
    w.es = [enrol(w.c, n) for n in ('Cece', 'Dev', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo')]
    w.eb = enrol(w.cb, 'Bravo Kid', B)
    d.run("update course set student_page_enabled = true, return_grades = 'on_return', show_my_learning = true where id = any (:ids)", ids=[w.c, w.cb])
    w.rub = str(T(d, """upsert_rubric(null, :c, 'Group Rubric', jsonb_build_array(
                          jsonb_build_object('name', 'Argument', 'level_3_descriptor', 'Meets'),
                          jsonb_build_object('name', 'Evidence', 'level_3_descriptor', 'Meets'),
                          jsonb_build_object('name', 'Voice', 'level_3_descriptor', 'Meets'),
                          jsonb_build_object('name', 'Form', 'level_3_descriptor', 'Meets'),
                          jsonb_build_object('name', 'Care', 'level_3_descriptor', 'Meets')),
                          null, gen_random_uuid(), 'standard', null)""", c=w.c))
    w.crits = [str(r[0]) for r in d.all('select id from criterion where rubric_id = :r order by display_order, id', r=w.rub)]
    w.asms = [str(T(d, "create_assessment(:c, :t, p_rubric_id => :r, p_idempotency_key => gen_random_uuid())", c=w.c, t='Piece %d' % i, r=w.rub)) for i in range(4)]
    w.rubb = str(T(d, "upsert_rubric(null, :c, 'Bravo Rubric', jsonb_build_array(jsonb_build_object('name', 'Lab', 'level_3_descriptor', 'Meets')), null, gen_random_uuid(), 'standard', null)", B, c=w.cb))
    w.critb = str(d.one('select id from criterion where rubric_id = :r', r=w.rubb))
    w.ab = str(T(d, "create_assessment(:c, 'Bravo Lab', p_rubric_id => :r, p_idempotency_key => gen_random_uuid())", B, c=w.cb, r=w.rubb))
    if old_fns:
        # The functions as live has them now, copied under another name, to compare answers.
        d.run('create schema oldfn')
        e = defn(d, OLD[1]).replace('public._grade_copy_entry(', 'oldfn._grade_copy_entry(', 1)
        c = defn(d, 'public._grade_copy(uuid,uuid)').replace('public._grade_copy(', 'oldfn._grade_copy(', 1)
        c = re.sub(r'(?<![\w.])_grade_copy_entry\(', 'oldfn._grade_copy_entry(', c)
        d.run(e); d.run(c)
    if apply:
        r = d.file(FILE); assert r == 'ok', r
    return w

def up(d, w, e, a, c, value, modifier=0, comment=None, beyond=None, own=None, uid=A, args=8):
    """upsert_rubric_score as a teacher, with as many arguments as asked (4 to 8)."""
    vals = [value, modifier, comment, beyond, own][:args - 3]
    names = ['p_value', 'p_modifier', 'p_comment', 'p_beyond', 'p_own_comment']
    kw = {'e': e, 'a': a, 'c': c}
    parts = ['p_value => :p_value'] if False else []
    sql = 'upsert_rubric_score(:e, :a, :c' + ''.join(', :v%d%s' % (i, '::smallint' if i == 1 else '') for i in range(len(vals))) + ')'
    for i, v in enumerate(vals): kw['v%d' % i] = v
    return T(d, sql, uid, **kw)
def row(d, e, a, c):
    r = d.all('select value, modifier, comment, beyond, own_comment from rubric_score where enrollment_id = :e and assessment_id = :a and criterion_id = :c', e=e, a=a, c=c)
    return r[0] if r else None

# == upsert ==
def scen_upsert():
    w = world('upsert', apply=True); d = w.d
    try:
        e1, e2, a, c1, c2, c3 = w.es[0], w.es[1], w.asms[0], w.crits[0], w.crits[1], w.crits[2]
        ok('upsert: exactly one function of the name, with eight arguments',
           d.one("select count(*) from pg_proc where proname = 'upsert_rubric_score'") == 1 and applied(d))
        up(d, w, e1, a, c1, 3, 0, 'Work on it', 'Beyond!', 'Cece only')
        ok('upsert: a level, a comment, a Went Beyond and a line are all kept', row(d, e1, a, c1) == [3, 0, 'Work on it', 'Beyond!', 'Cece only'], row(d, e1, a, c1))
        for n in (4, 5, 6, 7):
            up(d, w, e1, a, c1, 2 if n % 2 else 3, 0, None, None, None, args=n)
            ok('upsert: a call with %d arguments keeps the comment, the Went Beyond and the line' % n,
               row(d, e1, a, c1)[2:] == ['Work on it', 'Beyond!', 'Cece only'], row(d, e1, a, c1))
        up(d, w, e1, a, c1, 3, 0, 'Work on it', 'Beyond!', None)
        ok('upsert: null for the line keeps it (eight arguments)', row(d, e1, a, c1)[4] == 'Cece only', row(d, e1, a, c1))
        up(d, w, e1, a, c1, 3, 0, None, None, '')
        ok("upsert: '' clears only the line", row(d, e1, a, c1) == [3, 0, 'Work on it', 'Beyond!', None], row(d, e1, a, c1))
        up(d, w, e1, a, c1, 3, 0, None, None, 'again')
        up(d, w, e1, a, c1, 3, 0, '', None, None)
        ok("upsert: '' for the comment leaves the line", row(d, e1, a, c1) == [3, 0, None, 'Beyond!', 'again'], row(d, e1, a, c1))
        # named arguments, as PostgREST sends them
        T(d, "upsert_rubric_score(p_enrollment_id => :e, p_assessment_id => :a, p_criterion_id => :c, p_value => 4, p_own_comment => 'named')", e=e1, a=a, c=c2)
        ok('upsert: a call by name with only p_own_comment', row(d, e1, a, c2) == [4, 0, None, None, 'named'], row(d, e1, a, c2))
        T(d, "upsert_rubric_score(p_enrollment_id => :e, p_assessment_id => :a, p_criterion_id => :c, p_value => 2, p_comment => 'x', p_beyond => 'y')", e=e1, a=a, c=c3)
        ok('upsert: a call by name without p_own_comment (an old client)', row(d, e1, a, c3) == [2, 0, 'x', 'y', None], row(d, e1, a, c3))
        T(d, "upsert_rubric_score(:e, :a, :c, 3, 1::smallint, 'x', 'y')", e=e1, a=a, c=c3)
        ok('upsert: a seven-argument call with typed arguments resolves, and keeps the line (none)', row(d, e1, a, c3) == [3, 1, 'x', 'y', None], row(d, e1, a, c3))
        # a row with no level
        up(d, w, e1, a, c1, None, 0, None, None, None)
        ok('upsert: no level and nothing sent: the row stays levelless with its notes', row(d, e1, a, c1) == [None, 0, None, 'Beyond!', 'again'], row(d, e1, a, c1))
        up(d, w, e1, a, c1, 0, 0, None, '', None)
        ok('upsert: Went Beyond cleared: the line keeps the row alive', row(d, e1, a, c1) == [None, 0, None, None, 'again'], row(d, e1, a, c1))
        rid = up(d, w, e1, a, c1, None, 0, None, None, '')
        ok('upsert: the line cleared too: the row is deleted and null comes back', rid is None and row(d, e1, a, c1) is None, (rid, row(d, e1, a, c1)))
        r = up(d, w, e2, a, c1, None, 0, None, None, 'Dev only')
        ok('upsert: a line alone makes a levelless row and returns its id', r is not None and row(d, e2, a, c1) == [None, 0, None, None, 'Dev only'], row(d, e2, a, c1))
        up(d, w, e2, a, c1, 3, 0, None, None, None)
        ok('upsert: a level given to a row that has only a line keeps the line', row(d, e2, a, c1) == [3, 0, None, None, 'Dev only'], row(d, e2, a, c1))
        up(d, w, e2, a, c1, None, 0, 'only comment', None, None)
        ok('upsert: a level taken away keeps the line and the comment', row(d, e2, a, c1) == [None, 0, 'only comment', None, 'Dev only'], row(d, e2, a, c1))
        up(d, w, e2, a, c1, None, 0, '', None, None); up(d, w, e2, a, c1, None, 0, None, None, '')
        ok('upsert: the old rule still deletes a row with nothing left', row(d, e2, a, c1) is None)
        # a comment-only row, the old rule
        up(d, w, e2, a, c2, None, 0, 'c', None, None, args=6); up(d, w, e2, a, c2, None, 0, '', None, None, args=6)
        ok('upsert: (six arguments) a comment-only row is deleted when its comment goes', row(d, e2, a, c2) is None)
        # the line is not copied to anyone else by the database
        up(d, w, e1, a, c1, 3, 0, 'g', 'b', 'only Cece'); up(d, w, e2, a, c1, 3, 0, 'g', 'b', None)
        ok('upsert: a line on one student is on no other student', row(d, e2, a, c1)[4] is None and row(d, e1, a, c1)[4] == 'only Cece')
        ok('upsert: a second call changes the one row (no duplicate)', d.one('select count(*) from rubric_score where enrollment_id = :e and assessment_id = :a and criterion_id = :c', e=e1, a=a, c=c1) == 1)
        ok('upsert: fill_rubric still works and leaves the lines', T(d, 'fill_rubric(:e, :a, 2, 0::smallint)', e=e1, a=a) == 5 and row(d, e1, a, c1)[4] == 'only Cece' and row(d, e1, a, c1)[0] == 2, row(d, e1, a, c1))
        # who can
        ok('upsert: another teacher cannot write to this class', refused(d, lambda: T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, null, null, 'x')", B, e=e1, a=a, c=c1)) is not None
           and row(d, e1, a, c1)[4] == 'only Cece')
        ok('upsert: no sign-in is refused', refused(d, lambda: T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, null, null, 'x')", None, e=e1, a=a, c=c1)) is not None)
        ok('upsert: anon cannot run it; authenticated and service_role can',
           not d.one("select has_function_privilege('anon', :f, 'execute')", f=UPSERT8) and d.one("select has_function_privilege('authenticated', :f, 'execute')", f=UPSERT8)
           and d.one("select has_function_privilege('service_role', :f, 'execute')", f=UPSERT8) and not d.one("select has_function_privilege('public', :f, 'execute')", f=UPSERT8))
        ok('upsert: grants are as live had them on the old one', d.one('select proacl::text from pg_proc where oid = to_regprocedure(:f)', f=UPSERT8)
           == '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', d.one('select proacl::text from pg_proc where oid = to_regprocedure(:f)', f=UPSERT8))
    finally:
        d.close()

# == copy ==
POOL = [None, '', '   ', 'x', ' x ', 'Good work\ttab']
def scen_copy():
    w = world('copy', old_fns=True); d = w.d
    try:
        rnd = random.Random(2610)
        # rows as the app writes them, in a class that holds grades until they are returned
        rows = 0
        for e in w.es:
            for a in w.asms:
                for c in w.crits:
                    if rnd.random() < .35: continue
                    v = rnd.choice([None, 1, 2, 3, 4]); m = rnd.choice([-1, 0, 1])
                    if v == 1 and m == -1: m = 0
                    if v == 4 and m == 1: m = 0
                    if v is None: m = 0
                    d.run('insert into rubric_score (id, enrollment_id, assessment_id, criterion_id, value, modifier, comment, beyond) values (gen_random_uuid(), :e, :a, :c, :v, :m, :cm, :b)',
                          e=e, a=a, c=c, v=v, m=m, cm=rnd.choice(POOL), b=rnd.choice(POOL)); rows += 1
        pairs = [(e, a) for e in w.es for a in w.asms]
        # returned grades made by the old functions
        T(d, 'return_grades(:a, :es::uuid[], gen_random_uuid())', a=w.asms[0], es=w.es[:4])
        old = {p: d.one('select oldfn._grade_copy(:e, :a)::text', e=p[0], a=p[1]) for p in pairs}
        old_grid = {}
        grid = [(v, m, cm, b, cr) for v in (None, 1, 2, 3, 4) for m in (None, -1, 0, 1) for cm in POOL for b in POOL for cr in (True, False)]
        for g in grid: old_grid[g] = d.one('select oldfn._grade_copy_entry(:v, :m, :c, :b, :k)::text', v=g[0], m=g[1], c=g[2], b=g[3], k=g[4])
        stored_before = d.all('select enrollment_id::text, assessment_id::text, coalesce(returned_copy::text, \'\'), coalesce(previous_copy::text, \'\'), coalesce(working_copy::text, \'\') from grade_return order by 1, 2')
        r = d.file(FILE); ok('copy: the file applies', r == 'ok', r)
        ok('copy: %d rows, %d grade_return rows from the old functions' % (rows, len(stored_before)), rows > 100 and len(stored_before) > 0)
        # the entry, on a grid, with no line
        bad = []
        for g in grid:
            for own in ('NONE', None, '', '   '):
                if own == 'NONE':
                    new = d.one('select public._grade_copy_entry(:v, :m, :c, :b, :k)::text', v=g[0], m=g[1], c=g[2], b=g[3], k=g[4])
                else:
                    new = d.one('select public._grade_copy_entry(:v, :m, :c, :b, :k, :o)::text', v=g[0], m=g[1], c=g[2], b=g[3], k=g[4], o=own)
                if new != old_grid[g]: bad.append((g, own, new, old_grid[g]))
        ok('copy: _grade_copy_entry is byte for byte the old one on %d argument sets, with the line absent, null or blank' % len(grid), not bad, bad[:3])
        # with a line
        bad = []
        for g in grid[::7]:
            new = d.one("select public._grade_copy_entry(:v, :m, :c, :b, :k, ' Only me ')::jsonb", v=g[0], m=g[1], c=g[2], b=g[3], k=g[4])
            was = json.loads(old_grid[g]) if old_grid[g] else None
            if g[4]:
                exp = dict(was) if was else {'value': g[0], 'modifier': 0 if g[0] is None else (g[1] or 0), 'comment': None, 'beyond': None}
                exp['own'] = ' Only me '
                # an entry with nothing else: value null, comment and beyond null
                if new != exp: bad.append((g, new, exp))
            elif new != was: bad.append((g, new, was))
        ok('copy: with a line a criterion entry has "own" (even with no level, comment or Went Beyond); a competency entry is as before', not bad, bad[:3])
        ok('copy: an entry with only a line is not null',
           d.one("select public._grade_copy_entry(null, null, null, null, true, 'x')::text") == '{"own": "x", "value": null, "beyond": null, "comment": null, "modifier": 0}')
        ok('copy: the five-argument form still resolves (one function)', d.one("select public._grade_copy_entry(3, 0, 'a', 'b', true)::text") == d.one("select oldfn._grade_copy_entry(3, 0, 'a', 'b', true)::text"))
        ok('copy: one function of the name', d.one("select count(*) from pg_proc where proname = '_grade_copy_entry'") == 2)   # oldfn's and public's
        new = {p: d.one('select public._grade_copy(:e, :a)::text', e=p[0], a=p[1]) for p in pairs}
        diff = [p for p in pairs if (json.loads(new[p]) if new[p] else None) != (json.loads(old[p]) if old[p] else None)]
        ok('copy: _grade_copy answers as before on all %d (student, piece) pairs when no line is set' % len(pairs), not diff, diff[:3])
        ok('copy: and as text, byte for byte', all(new[p] == old[p] for p in pairs), [p for p in pairs if new[p] != old[p]][:3])
        stored_after = d.all('select enrollment_id::text, assessment_id::text, coalesce(returned_copy::text, \'\'), coalesce(previous_copy::text, \'\'), coalesce(working_copy::text, \'\') from grade_return order by 1, 2')
        ok('copy: the stored copies are untouched', stored_before == stored_after)
        eq = d.all('select count(*) from grade_return g where g.working_copy is not null and g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)')
        ok('copy: every stored working copy equals the copy made now', eq[0][0] == 0, eq)
        # lines on a random third of the rows
        d.run('create table copy_nulled as select enrollment_id, assessment_id, public._grade_copy(enrollment_id, assessment_id) as c from (select distinct enrollment_id, assessment_id from rubric_score) x')
        lines = {}
        for (e, a, c) in d.all('select enrollment_id::text, assessment_id::text, criterion_id::text from rubric_score'):
            if rnd.random() < .33:
                lines[(e, a, c)] = rnd.choice(['Hannah only: ask me', ' lead ', '   ', ''])
        for (e, a, c), v in lines.items():
            d.run('update rubric_score set own_comment = :o where enrollment_id = :e and assessment_id = :a and criterion_id = :c', o=v, e=e, a=a, c=c)
        bad = []
        for (e, a) in {(k[0], k[1]) for k in lines}:
            got = d.one('select public._grade_copy(:e, :a)', e=e, a=a)
            got = json.loads(got) if isinstance(got, str) else got
            exp0 = d.one('select c from copy_nulled where enrollment_id = :e and assessment_id = :a', e=e, a=a)
            exp0 = json.loads(exp0) if isinstance(exp0, str) else exp0
            crit = (got or {}).get('criteria', {})
            for c, ent in list(crit.items()):
                v = lines.get((e, a, c))
                has = v is not None and v.strip() != ''
                if has and ent.get('own') != v: bad.append(('own wrong', e, c, ent, v))
                if not has and 'own' in ent: bad.append(('own where none', e, c, ent))
            for (e2, a2, c), v in lines.items():
                if (e2, a2) == (e, a) and v.strip() != '' and c not in crit: bad.append(('entry missing', e, c))
            # remove the lines and compare with the copy made without them
            stripped = {}
            for c, ent in crit.items():
                ent = {k: x for k, x in ent.items() if k != 'own'}
                if ent['value'] is None and ent['comment'] is None and ent['beyond'] is None: continue
                stripped[c] = ent
            if got is not None:
                got = dict(got, criteria=stripped)
                if not (got['value'] is not None or got['comment'] is not None or got['tags'] or got['criteria'] or got['checks']): got = None
            if got != exp0: bad.append(('rest differs', e, a, got, exp0))
        ok('copy: with lines set (%d rows): own only on the row that has it, and the rest of every copy as before' % len(lines), not bad, bad[:2])
    finally:
        d.close()

# == readers ==
def session(d, e, c, teacher=A):
    code, _pw, _row = d.make(e, c, teacher)
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

def scen_readers():
    w = world('readers', apply=True); d = w.d
    try:
        e1, e2, e3, a, c1, c2 = w.es[0], w.es[1], w.es[2], w.asms[0], w.crits[0], w.crits[1]
        # a group of three: the same level and comment for all, a line for two of them, each their own
        for e, own in ((e1, 'ONLY-CECE-LINE'), (e2, 'ONLY-DEV-LINE'), (e3, None)):
            up(d, w, e, a, c1, 3, 0, 'GROUP-COMMENT', 'GROUP-BEYOND', own)
        up(d, w, e3, a, c2, None, 0, None, None, 'ONLY-ELI-LINE-ALONE')
        # the bundle
        b = obj(T(d, 'get_class_bundle(:c, null)', c=w.c))
        b = b.get('gradebook', b)
        rows = b['criterion_rows']
        ok('readers: get_class_bundle: every criterion row has eight elements', rows and all(len(r) == 8 for r in rows), [len(r) for r in rows][:5])
        ix = lambda lst, v: lst
        bycrit = {}
        by_own = sorted(str(r[7]) for r in rows)
        ok('readers: get_class_bundle: the eighth element is the line, or null', by_own == sorted(['ONLY-CECE-LINE', 'ONLY-DEV-LINE', 'None', 'ONLY-ELI-LINE-ALONE']), by_own)
        ok('readers: get_class_bundle: the first seven are as before', all(r[3:7] in ([3, 0, 'GROUP-COMMENT', 'GROUP-BEYOND'], [None, 0, None, None]) for r in rows), [r for r in rows][:3])
        ok('readers: another teacher gets nothing of this class from it', refused(d, lambda: T(d, 'get_class_bundle(:c, null)', B, c=w.c)) is not None)
        # withdrawn records
        d.run('update enrollment set withdrawn_at = now() where id = :e', e=e1)
        wr = obj(T(d, 'get_withdrawn_student_records(:e)', e=e1))
        ok('readers: get_withdrawn_student_records: each rubric score carries "own"',
           wr['rubric_scores'] and all('own' in r for r in wr['rubric_scores']) and wr['rubric_scores'][0]['own'] == 'ONLY-CECE-LINE', wr['rubric_scores'])
        d.run('update enrollment set withdrawn_at = null where id = :e', e=e1)
        # restore
        crow = d.all('select id::text from rubric_score where enrollment_id = :e and assessment_id = :a and criterion_id = :c', e=e2, a=a, c=c1)[0][0]
        def restore(own, with_key=True):
            r = {'id': crow, 'enrollment_id': e2, 'assessment_id': a, 'criterion_id': c1, 'value': 2, 'modifier': 0, 'comment': 'restored', 'beyond': 'rb'}
            if with_key: r['own_comment'] = own
            return T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps({'rubric_scores': [r]}))
        restore('RESTORED-LINE')
        ok('readers: import_json_restore: a backup with a line sets it (on conflict)', row(d, e2, a, c1) == [2, 0, 'restored', 'rb', 'RESTORED-LINE'], row(d, e2, a, c1))
        restore('')
        ok("readers: import_json_restore: '' reads as none", row(d, e2, a, c1)[4] is None, row(d, e2, a, c1))
        restore('X'); restore(None, with_key=False)
        ok('readers: import_json_restore: a backup made before the line sets it to none, as it does Went Beyond', row(d, e2, a, c1)[4] is None, row(d, e2, a, c1))
        new_crit = w.crits[3]
        T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps({'rubric_scores': [{'enrollment_id': e2, 'assessment_id': a, 'criterion_id': new_crit, 'value': 3, 'own_comment': 'NEWROW'}]}))
        ok('readers: import_json_restore: a new row gets the line on insert', row(d, e2, a, new_crit) == [3, 0, None, None, 'NEWROW'], row(d, e2, a, new_crit))
        ok('readers: import_json_restore: another teacher cannot restore into this class', refused(d, lambda: T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", B,
           p=json.dumps({'rubric_scores': [{'enrollment_id': e2, 'assessment_id': a, 'criterion_id': new_crit, 'value': 1, 'own_comment': 'EVIL'}]}))) is not None and row(d, e2, a, new_crit)[4] == 'NEWROW')
        up(d, w, e2, a, c1, 3, 0, 'GROUP-COMMENT', 'GROUP-BEYOND', 'ONLY-DEV-LINE')
        d.run('delete from rubric_score where assessment_id = :a and enrollment_id = :e and criterion_id = :c', a=a, e=e2, c=new_crit)
        # the draft guard
        a2 = w.asms[1]
        d.run('update assessment set is_draft = true where id = :a', a=a2)
        d.run('update assessment set is_draft = false where id = :a', a=a2)
        up(d, w, e1, a2, c1, None, 0, None, None, 'DRAFT-BLOCKER')
        r = refused(d, lambda: d.run('update assessment set is_draft = true where id = :a', a=a2))
        ok('readers: the draft guard counts a line: a piece with only a line cannot go back to a Draft', r is not None and 'draft_has_work' in r[0], r)
        up(d, w, e1, a2, c1, None, 0, None, None, '')
        r = refused(d, lambda: d.run('update assessment set is_draft = true where id = :a', a=a2))
        ok('readers: and it can once the line is gone', r is None, r)
        d.run('update assessment set is_draft = false where id = :a', a=a2)
        # what a student is given
        T(d, 'return_grades(:a, array[:e1::uuid, :e2::uuid, :e3::uuid], gen_random_uuid())', a=a, e1=e1, e2=e2, e3=e3)
        t1, t2 = session(d, e1, w.c), session(d, e2, w.c)
        p1 = json.dumps(d.page(t1, e1)); p2 = json.dumps(d.page(t2, e2))
        ok('readers: student_submit.page gives Cece her own line and Dev his', 'ONLY-CECE-LINE' in p1 and 'ONLY-DEV-LINE' in p2, (p1[:300], p2[:300]))
        ok("readers: it never gives a student a group mate's line, or one that is alone on another", 'ONLY-DEV-LINE' not in p1 and 'ONLY-ELI-LINE-ALONE' not in p1
           and 'ONLY-CECE-LINE' not in p2 and 'ONLY-ELI-LINE-ALONE' not in p2)
        ok('readers: the group comment reaches both (the page is working)', 'GROUP-COMMENT' in p1 and 'GROUP-COMMENT' in p2)
        ok("readers: a student cannot read another student's grade through the page", d.page(t1, e2) not in (None,) and 'ONLY-DEV-LINE' not in json.dumps(d.page(t1, e2)))
        ok('readers: _returned_grade for each student holds only that student\'s line',
           'ONLY-CECE-LINE' in d.one('select student_submit._returned_grade(:e, :a)::text', e=e1, a=a) and 'ONLY-DEV-LINE' not in d.one('select student_submit._returned_grade(:e, :a)::text', e=e1, a=a))
        # a draft: the student is given what was last returned, not the line made since
        d.run("update course set return_grades = 'on_return' where id = :c", c=w.c)
        up(d, w, e1, a, c1, 3, 0, 'GROUP-COMMENT', 'GROUP-BEYOND', 'CHANGED-AFTER-RETURN')
        p1b = json.dumps(d.page(t1, e1))
        ok('readers: a line saved after the grade was returned is not shown until it is returned again',
           'CHANGED-AFTER-RETURN' not in p1b and 'ONLY-CECE-LINE' in p1b, p1b[:300])
        # and the teacher's own readers that list columns
        ok('readers: get_gradebook and get_assessment_detail do not carry comments or lines',
           'ONLY-CECE-LINE' not in json.dumps(obj(T(d, 'get_gradebook(:c)', c=w.c))) and 'ONLY-CECE-LINE' not in json.dumps(obj(T(d, 'get_assessment_detail(:a)', a=a))))
    finally:
        d.close()

# == apply ==
def scen_apply():
    w = world('apply'); d = w.d
    try:
        text = text_of(FILE)
        ok('apply: plain ASCII, no backslash, no unicode escape', text.isascii() and chr(92) not in text and 'u&' not in text.lower())
        ok('apply: small enough to send whole (under 50 KB)', len(text.encode()) < 50000, len(text.encode()))
        for fn in (UNDO, PRE, POST, FPS):
            t = text_of(fn); ok('apply: %s is plain ASCII, no backslash' % fn, t.isascii() and chr(92) not in t)
        up(d, w, w.es[0], w.asms[0], w.crits[0], 3, 0, 'old', 'old', None, args=7) if False else T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'old', 'old')", e=w.es[0], a=w.asms[0], c=w.crits[0])
        d.run("insert into rubric_score (id, enrollment_id, assessment_id, criterion_id, value) values (gen_random_uuid(), :e, :a, :c, 2)", e=w.es[1], a=w.asms[0], c=w.crits[0])
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        mutations = {
            'a relied function changed': "create or replace function public._grade_copy_of(p_value numeric, p_modifier integer, p_comment text, p_tags jsonb, p_criteria jsonb, p_checks jsonb) returns jsonb language sql immutable as $$ select null::jsonb $$",
            'a patched function changed': "create or replace function public._assessment_draft_guard() returns trigger language plpgsql as $$ begin return new; end $$",
            'the bundle changed': "create or replace function public.get_class_bundle(p_course_id uuid, p_if_version bigint default null) returns jsonb language sql as $$ select null::jsonb $$",
            'the old upsert changed': "create or replace function public.upsert_rubric_score(p_enrollment_id uuid, p_assessment_id uuid, p_criterion_id uuid, p_value integer, p_modifier smallint default 0, p_comment text default null, p_beyond text default null) returns uuid language sql as $$ select null::uuid $$",
            'another upsert_rubric_score': "create function public.upsert_rubric_score(x int) returns int language sql as $$ select 1 $$",
            'another _grade_copy_entry': "create function public._grade_copy_entry(x int) returns int language sql as $$ select 1 $$",
            'a column of this file\'s name of another type': 'alter table rubric_score add column own_comment int',
            'a column the file does not know': 'alter table rubric_score add column surprise text',
        }
        for name, sql in mutations.items():
            d.run('begin'); d.run(sql)
            r = d.statements(split(text)); d.run('rollback')
            ok('apply: the guard stops: ' + name, r.startswith('STOPPED') and 'Nothing was changed' in r, r[:300])
        ok('apply: (guards) the catalog and rows are as they were', quiet0(differences(cat0, catalog(d.c))) == ([], []) and row_checksums(d.c) == rows0)
        for name, sql in list(mutations.items())[:4] + list(mutations.items())[7:]:
            d.run('begin'); d.run(sql); d.file(PRE); n = len(d.rows); d.run('rollback')
            ok('apply: the pre-check names it: ' + name, n > 0, n)
        d.file(PRE); ok('apply: the pre-check is empty before', d.rows == [], d.rows)
        d.file(FPS); ok('apply: the fingerprints query is empty before', d.rows == [], d.rows)
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c))
        known = ('rubric_score', 'own', '_grade_copy', 'get_class_bundle', 'get_withdrawn', 'import_json_restore', '_assessment_draft_guard', 'depends', 'comments')
        ok('apply: the catalog changes only in what the header names', all(any(k in l for k in known) for l in gone + new), [l[:200] for l in gone + new if not any(k in l for k in known)])
        ok('apply: no row changed; every own_comment is null',
           d.one('select count(*) from rubric_score where own_comment is not null') == 0 and
           all(rows0[k] == v for k, v in row_checksums(d.c).items() if k in rows0 and k != 'public.rubric_score'))
        ok('apply: the old rows read as they did', d.all('select value, modifier, comment, beyond from rubric_score order by value') == [[2, 0, None, None], [3, 0, 'old', 'old']])
        cat1 = catalog(d.c)
        text = text_of(FILE)
        got = {s: md5(d, s) for s in PATCHED + NEW}
        listed = dict(re.findall(r"\('([^']+)', '([0-9a-f]{32})'\)", text.split('FINGERPRINTS-BEGIN after')[1].split('FINGERPRINTS-END')[0]))
        ok('apply: the md5s the file carries are the ones the database has', listed == got, [k for k in got if listed.get(k) != got[k]])
        r2 = d.file(FILE); dd = quiet0(differences(cat1, catalog(d.c)))
        ok('apply: a second run applies and changes nothing', r2 == 'ok' and dd == ([], []), (r2, [[l[:200] for l in s] for s in dd]))
        r = d.file(POST); bad = [x for x in d.rows if x[1] != 'ok']
        ok('apply: the post-check: every row ok (%d rows)' % len(d.rows), r == 'ok' and d.rows and not bad, bad[:3])
        d.file(FPS); ok('apply: the fingerprints query after names the patched functions and the old signatures', {x[0] for x in d.rows} >= set(PATCHED + OLD) - set(), [x[0] for x in d.rows])
        d.file(PRE); ok('apply: the pre-check after names what is already there', len(d.rows) > 0)
        # the final check trips
        r = d.file(UNDO); ok('apply: (setup) undone', r == 'ok' and not applied(d), r)
        trips = {
            'a function md5': text.split('do $final$')[0] + 'do $final$' + text.split('do $final$')[1].replace(got[NEW[0]], '0' * 32, 1),
            'the grant': text.replace("to authenticated, service_role;\nrevoke all on function public._grade_copy_entry", "to authenticated;\nrevoke all on function public._grade_copy_entry", 1),
        }
        for name, bad_text in trips.items():
            if bad_text == text:
                ok('apply: (setup) the trip changes the text: ' + name, False); continue
            r = d.statements(split(bad_text))
            ok('apply: the last check or a guard stops it, nothing left: ' + name, r.startswith('STOPPED') and not applied(d), r[:300])
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('apply: (after the trips) the catalog is as before the file', dd == ([], []), [[l[:200] for l in s] for s in dd])
        c2 = d.other(); c2.run('begin'); c2.run('lock table rubric_score in access exclusive mode')
        t0 = time.time(); r = d.file(FILE); c2.run('rollback'); c2.close()
        ok('apply: a lock held elsewhere: gives up in about five seconds, nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 <= time.time() - t0 < 12 and not applied(d), (r, time.time() - t0))
        # a second connection writing while it is applied is not needed: add column is metadata only
        ok('apply: add column is nullable with no default (no rewrite)', 'add column if not exists own_comment text;' in text)
    finally:
        d.close()

# == undo ==
def scen_undo():
    w = world('undo'); d = w.d
    try:
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'old', 'old')", e=w.es[0], a=w.asms[0], c=w.crits[0])
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        r = d.file(UNDO); ok('undo: on a database where the file was never applied it changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
        cat1 = catalog(d.c)
        T(d, "upsert_rubric_score(:e, :a, :c, 3, 0::smallint, 'g', 'b', 'a line')", e=w.es[1], a=w.asms[0], c=w.crits[0])
        T(d, "upsert_rubric_score(:e, :a, :c, null, 0::smallint, null, null, 'a line alone')", e=w.es[2], a=w.asms[0], c=w.crits[0])
        cat2 = catalog(d.c)
        r = d.file(UNDO)
        ok('undo: refuses while a line is held, and says how many', r.startswith('STOPPED') and '2 line' in r and applied(d), r[:300])
        ok('undo: (refused) nothing changed', quiet0(differences(cat2, catalog(d.c))) == ([], []) and d.one('select count(*) from rubric_score where own_comment is not null') == 2)
        d.run('update rubric_score set own_comment = null where own_comment is not null')
        for e in (w.es[1], w.es[2]): d.run('delete from rubric_score where enrollment_id = :e', e=e)
        rows1 = row_checksums(d.c)
        r = d.file(UNDO); ok('undo: runs once the lines are cleared', r == 'ok' and not applied(d), r)
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('undo: the catalog is exactly as before the file (md5 of every function, grants, comments, columns)', dd == ([], []), [[l[:200] for l in s] for s in dd])
        ok('undo: the rows are as they were', all(rows1[k] == v for k, v in row_checksums(d.c).items() if k in rows1 and k != 'public.rubric_score'))
        ok('undo: the old rows read as before', d.all('select value, modifier, comment, beyond from rubric_score order by value') == [[3, 0, 'old', 'old']])
        for sig in OLD + PATCHED:
            pass
        ok('undo: every function is the live one again',
           all(md5(d, s) == v for s, v in re.findall(r"\('([^']+)', '([0-9a-f]{32})'\)", text_of(UNDO).split('FINGERPRINTS-BEGIN undo-after')[1].split('FINGERPRINTS-END')[0])))
        r = d.file(UNDO); ok('undo: a second run changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and applied(d), r)
        # the column comes back in a new slot (attnum 11, not 10: the dropped slot stays)
        dd = quiet0(differences(cat1, catalog(d.c)))
        dd = tuple([l for l in side if not l.startswith('column public.rubric_score | ') or 'own_comment' not in l] for side in dd)
        ok('undo: and leaves the catalog as the first apply did (the column in the next slot)', dd == ([], []), [[l[:200] for l in s] for s in dd])
        up(d, w, w.es[3], w.asms[0], w.crits[0], 3, 0, None, None, 'works again')
        ok('undo: and works', row(d, w.es[3], w.asms[0], w.crits[0])[4] == 'works again')
    finally:
        d.close()

SCENARIOS = {'upsert': scen_upsert, 'copy': scen_copy, 'readers': scen_readers, 'apply': scen_apply, 'undo': scen_undo}

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (args or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
