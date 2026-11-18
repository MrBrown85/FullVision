"""Per-student options: migrations/2026111720_student_page_per_student.sql on a database rebuilt from the repo
and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "Per-student options").

    PGPORT=<port> PGDATABASE=<db> python3 per_student.py           every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 per_student.py pause     or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped
here. Never against gradebook-prod: a throwaway PostgreSQL 17 only. It uses the world of assessment_drafts.py
(Teacher A's History 12 with the student page on, Cece, Dev and Eli with cards; Teacher B's class).

  same     With no option set, every student route (all 25 session routes, the card scan, the card sign-in's
           class list) answers byte for byte as before the file, for two students.
  pause    A paused student's card scan and card sign-in answer closed, and so does every one of the 25 session
           routes on a session opened before the pause (none did before); the class list leaves the class out;
           classmates' routes and sign-in are unchanged; a second pause keeps its time; opening again gives
           every answer back, byte for byte; the class's own switch off still closes everyone.
  grade    Hidden: the student's page carries no My Learning block and no piece's category_id, and feedback
           says show_my_learning false, while a classmate's carry them; the hidden page is byte for byte the
           page that student gets with the class switch off. Show overrides a class that is off; class follows
           the class either way; each piece's result still goes.
  rpc      set_student_page_options and list_student_page_options: what each answers; every refusal (signed
           out, another teacher's class, a class in the trash, ids all skipped, a null id, no ids, 501 ids, both
           changes null, an unknown word) changes no row; duplicates; an id that is not an active student of the
           class (another teacher's, another class's, withdrawn, in the trash, never existed) is skipped, changes
           nothing and gets the same reply whatever it is; a key sent twice answers the first reply and writes
           nothing; only rows that change are written, and a change moves the class's sync cursor while a no-op
           does not; a visitor, public and service_role cannot run them.
  leak     No student route's answer names the columns; no student_submit function but the four patched reads
           them; the class bundle is the same with options set; withdraw, re-enrol, update_enrollment keep
           working; the two teacher functions that send the whole row (profiles) are the teacher's only.
  race     Two calls on the same students on connections of their own: the second waits, the student page is
           not held up meanwhile, no deadlock with the ids in the other order, the last change wins and a pause
           keeps the time it began (three rounds); twenty calls at once in random orders, no deadlock.
  defaults With Supabase's default privileges (every new function granted to anon, authenticated, service_role
           and public) in place, the grants still come out exact.
  apply    The guards stop with the catalog unchanged; the file changes only what its header says, no row; the
           header's md5s; pre-check and post-check; a second run; the lock timeout; the file's size.
  undo     (also: the full removal's lock cannot deadlock a transaction that read enrollment and then writes it;
           the weaker lock it replaced is shown to.) PART 1 alone puts the four functions back (students see what they saw before) and keeps the
           choices; the full undo stops while a choice is set; once cleared, it leaves the catalog as before
           but two dropped-column slots, and every row; a changed function stops it; a second run; without
           the file it changes nothing; the file applies again.
"""
import json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import split, tx, refused, ok, finish, nid, connect, message, sqlstate, text_of, catalog, differences, row_checksums
import card_codes_common as ccc
from assessment_drafts import world as drafts_world, session, md5, defn, T, S, Side, A, B

FILE = '../2026111720_student_page_per_student.sql'
UNDO = 'per-student-undo.sql'
PRE = 'per-student-live-precheck.sql'
POST = 'per-student-live-postcheck.sql'
SET = 'public.set_student_page_options(uuid,uuid[],text,boolean,uuid)'
LIST = 'public.list_student_page_options(uuid)'
PATCHED = ['student_submit._card_refusal(uuid)', 'student_submit._session_classes(uuid)',
           'student_submit.page(text,uuid,text)', 'student_submit.feedback(text,uuid,text)']
HEADER = text_of(FILE)

def header_md5s():
    rows = dict((m[0], (m[1], m[2])) for m in re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})  ([0-9a-f]{32})$', HEADER, re.M))
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    return rows, new
def bare_select(text): return '\n'.join(l for l in text.splitlines() if not l.startswith('--')).strip().rstrip(';')
def has_file(d): return d.one("select exists (select 1 from pg_attribute where attrelid = 'public.enrollment'::regclass and attname = 'page_paused_at' and not attisdropped)")
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]

def world(tag, applied=True):
    w = drafts_world('ps_' + tag, applied=False); d = w.d
    if has_file(d):
        r = d.file(UNDO)
        if r != 'ok' or has_file(d): sys.exit('could not take the template back to before the file: %s' % r)
    # fresh cards, so the codes are known: Cece (e1), Dev (e2), Eli (e3)
    w.t1, w.code1 = session(d, w.e1, w.c)
    w.t2, w.code2 = session(d, w.e2, w.c)
    w.t3, w.code3 = session(d, w.e3, w.c)
    w.sid1 = d.one('select session_id from student_submit.device_session_enrollment where enrollment_id = :e order by added_at desc limit 1', e=w.e1)
    # a student of Teacher A's other class, and one withdrawn from History 12
    w.e_other = str(T(d, "create_student_and_enroll(:c, 'Other', 'Tester', p_idempotency_key => gen_random_uuid())", c=w.c2)['enrollment_id'])
    w.e_gone = str(T(d, "create_student_and_enroll(:c, 'Gone', 'Tester', p_idempotency_key => gen_random_uuid())", c=w.c)['enrollment_id'])
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.e_gone)
    w.trash = str(T(d, "create_course(p_name => 'Trash', p_subjects => array['X'], p_idempotency_key => gen_random_uuid())"))
    w.e_trash = str(T(d, "create_student_and_enroll(:c, 'Tracy', 'Tester', p_idempotency_key => gen_random_uuid())", c=w.trash)['enrollment_id'])
    d.run("update course set deleted_at = now() where id = :c", c=w.trash)
    if applied:
        r = d.file(FILE); assert r == 'ok', r
    return w

def setopt(w, ids, grade=None, paused=None, uid=A, key=None, c=None):
    return T(w.d, 'set_student_page_options(:c, :i::uuid[], :g, :p, :k)', uid, c=c or w.c, i=ids, g=grade, p=paused, k=key)
def listopt(w, uid=A, c=None): return T(w.d, 'list_student_page_options(:c)', uid, c=c or w.c)

# ── every session route: (token, enrollment, the rest filled by type) ──
def route_sigs(d):
    return d.all("""select p.oid::regprocedure::text, p.proname, array_to_string(p.proargtypes::regtype[], ',')
                      from pg_proc p where p.pronamespace = 'student_submit'::regnamespace and p.proname !~ '^_'
                       and p.proargtypes[0] = 'text'::regtype and p.proargtypes[1] = 'uuid'::regtype order by 1""")

WRITES = ('reflect', 'send_start', 'replace', 'revision_start', 'reply', 'answer', 'unsend', 'revision_unsend', 'seen', 'answer_seen')
def routes(w, token, e):
    d = w.d
    fill = {'uuid': ':a', 'jsonb': """'{"makes_sense":"yes"}'::jsonb""", 'text': "'ip'", 'uuid[]': 'array[:a::uuid]', 'boolean': 'false'}
    out = {}
    for sig, name, types in route_sigs(d):
        rest = types.split(',')[2:]
        # valid arguments, so each route reaches its session check (a malformed one is refused first, as before)
        args = [':t', ':e'] + [('null' if t == 'text' and i < len(rest) - 1 else fill[t]) for i, t in enumerate(rest)]
        if name in ('send_start', 'replace', 'revision_start'):
            args[3] = """'[{"width":1500,"height":2000}]'::jsonb"""
        if name in ('send_finish', 'revision_finish'):
            args[3] = """jsonb_build_array(jsonb_build_object('file_id', gen_random_uuid(), 'sha256', repeat('a', 64)))"""
        if name == 'reflect':
            args[3] = """'{"makes_sense":"yes","plan":"Try again"}'::jsonb"""
        if name == 'reply':
            args[3] = """'{"sense_now":"yes"}'::jsonb"""
        sql = 'student_submit.%s(%s)' % ('"check"' if name == 'check' else name, ', '.join(args))
        a = w.res if name in ('handout_file', 'handout_links') else w.p
        def f(sql=sql, a=a, name=name):
            with tx(d):
                try: r = S(d, sql, t=token, e=e, a=a)
                except Exception as x: return json.dumps({'raised': sqlstate(x)})
                if isinstance(r, dict):
                    r = {k: v for k, v in r.items() if k not in ('expires_at', 'paths', 'upload', 'urls', 'links')}
                    # a write's reply carries new ids and times: only what it decided is compared
                    if name in WRITES: r = {k: r.get(k) for k in ('ok', 'error', 'replayed', 'state', 'late')}
                return json.dumps(r, sort_keys=True, default=str)
        out[name] = f
    return out

def scan(w, code):
    with tx(w.d): return w.d.card(code)
def sign_in(w, code):
    with tx(w.d):
        r = w.d.verify(code, birthday='2012-05-15')
        return {'ok': r.get('ok'), 'error': r.get('error'), 'classes': r.get('classes')}
def answers(w):
    out = {}
    for who, t, e, code in (('Cece', w.t1, w.e1, w.code1), ('Dev', w.t2, w.e2, w.code2)):
        for name, f in routes(w, t, e).items(): out[(who, name)] = f()
        out[(who, 'card scan')] = json.dumps({k: v for k, v in scan(w, code).items() if k != 'card_id'}, sort_keys=True)
        out[(who, 'sign-in')] = json.dumps(sign_in(w, code), sort_keys=True)
    return out
def error_of(text):
    try: return json.loads(text).get('error')
    except Exception: return None

# ── same ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_same():
    w = world('same', applied=False); d = w.d
    try:
        before = answers(w)
        ok('same: (setup) the file applies', d.file(FILE) == 'ok')
        after = answers(w)
        ok('same: 25 session routes, the card scan and the sign-in, for two students (%d answers)' % len(before),
           len(before) == 54 and set(before) == set(after), len(before))
        diff = sorted(k for k in before if before[k] != after[k])
        ok('same: with no option set every answer is byte for byte as before the file', diff == [], diff[:4])
        ok('same: (the page answers ok with My Learning, so the comparison means something)',
           json.loads(before[('Cece', 'page')]).get('show_my_learning') is True)
    finally:
        d.close()

# ── pause ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_pause():
    w = world('pause'); d = w.d
    try:
        before = answers(w)
        closed0 = [k for k, v in before.items() if error_of(v) == 'closed']
        ok('pause: (before) no route, scan or sign-in answers closed', closed0 == [], closed0)
        classes0 = d.one('select student_submit._session_classes(:s)', s=w.sid1)
        ok("pause: (before) Cece's session lists History 12", len(classes0) == 1, classes0)
        r = setopt(w, [w.e1], paused=True)
        at = d.one('select page_paused_at from enrollment where id = :e', e=w.e1)
        ok('pause: the reply names Cece, paused, grade following the class',
           r['ok'] is True and r['options'] == [{'enrollment_id': w.e1, 'show_overall_grade': 'class', 'paused_at': r['options'][0]['paused_at']}]
           and r['options'][0]['paused_at'] is not None, r)
        after = answers(w)
        cece = {k[1]: v for k, v in after.items() if k[0] == 'Cece'}
        not_closed = sorted(n for n, v in cece.items() if error_of(v) != 'closed')
        ok("pause: every one of Cece's 25 session routes (on a session opened before the pause), her card scan and her sign-in answer closed",
           len(cece) == 27 and not_closed == [], [(n, cece[n][:120]) for n in not_closed[:4]])
        ok("pause: her card scan answers exactly { ok: false, error: closed }", json.loads(cece['card scan']) == {'error': 'closed', 'ok': False}, cece['card scan'])
        ok("pause: the class list leaves her class out", d.one('select student_submit._session_classes(:s)', s=w.sid1) == [])
        dev = sorted(k for k in before if k[0] == 'Dev' and before[k] != after[k])
        ok("pause: Dev's 27 answers are byte for byte as before", dev == [], dev[:4])
        with tx(d):
            d.card(w.code1)
            logged = d.all("select outcome from student_submit.attempt where route = 'card' order by at desc, id desc limit 1")
        ok("pause: the refused scan is logged as closed, as for a class with its page off", logged == [['closed']], logged)
        time.sleep(0.01)
        setopt(w, [w.e1], paused=True)
        ok('pause: a second pause keeps the time it began', d.one('select page_paused_at from enrollment where id = :e', e=w.e1) == at)
        r = setopt(w, [w.e1], paused=False)
        ok('pause: opening again answers paused_at null', r['options'][0]['paused_at'] is None, r)
        again = answers(w)
        diff = sorted(k for k in before if before[k] != again[k])
        ok('pause: opened again, every answer for both students is byte for byte as before the pause', diff == [], diff[:4])
        # the class's own switch still closes everyone, paused or not
        setopt(w, [w.e1], paused=True)
        d.run('update course set student_page_enabled = false where id = :c', c=w.c)
        off = answers(w)
        ok('pause: with the class page off, every answer for both students is closed, as before the file',
           all(error_of(v) == 'closed' for v in off.values()), [k for k, v in off.items() if error_of(v) != 'closed'][:3])
        d.run('update course set student_page_enabled = true where id = :c', c=w.c)
        setopt(w, [w.e1], paused=False)
        ok('pause: class page back on and Cece open: as before', answers(w) == before)
        # a pause of several at once, and their sign-ins
        setopt(w, [w.e1, w.e2], paused=True)
        ok('pause: two paused at once: both scans closed, Eli still signs in',
           scan(w, w.code1).get('error') == 'closed' and scan(w, w.code2).get('error') == 'closed'
           and sign_in(w, w.code3)['ok'] is True and len(sign_in(w, w.code3)['classes']) == 1)
    finally:
        d.close()

# ── grade ─────────────────────────────────────────────────────────────────────────────────────────────
def page(w, t, e): return S(w.d, "student_submit.page(:t, :e, 'ip')", t=t, e=e)
def fb(w, t, e): return S(w.d, "student_submit.feedback(:t, :e, 'ip')", t=t, e=e)
def has_learning(p):
    return 'learning' in p or p.get('show_my_learning') is True or any('category_id' in a for a in p['assessments'])
def strip_v(p): return json.dumps({k: v for k, v in p.items() if k != 'expires_at'}, sort_keys=True)
def class_on(w, on): T(w.d, "set_course_feedback_options(:c, jsonb_build_object('show_my_learning', :o::boolean), null)", c=w.c, o=on)

def scen_grade():
    w = world('grade'); d = w.d
    try:
        # a category, so a piece has a category_id to send
        d.run("insert into category (id, course_id, name, weight, display_order) values (gen_random_uuid(), :c, 'Tests', 100, 0)", c=w.c)
        d.run('update assessment set category_id = (select id from category where course_id = :c) where course_id = :c', c=w.c)
        class_on(w, False)
        off1 = strip_v(page(w, w.t1, w.e1))
        class_on(w, True)
        p1, p2 = page(w, w.t1, w.e1), page(w, w.t2, w.e2)
        ok('grade: (class on, no option) both pages carry My Learning and category ids', has_learning(p1) and has_learning(p2)
           and 'learning' in p1 and all('category_id' in a for a in p1['assessments']))
        setopt(w, [w.e1], grade='hide')
        h1, h2 = page(w, w.t1, w.e1), page(w, w.t2, w.e2)
        ok("grade: hidden: Cece's page has no learning block, no show_my_learning and no piece's category_id",
           'learning' not in h1 and 'show_my_learning' not in h1 and not any('category_id' in a for a in h1['assessments']), list(h1))
        ok("grade: hidden: Cece's page is byte for byte her page with the class switch off", strip_v(h1) == off1)
        ok("grade: hidden: each piece's result still goes (her pieces and returned grades as with the class off)",
           len(h1['assessments']) == len(p1['assessments']) and h1['assessments'][0].get('returned_at', 'x') == p1['assessments'][0].get('returned_at', 'x'))
        ok("grade: hidden: Dev's page still carries My Learning, byte for byte as before", strip_v(h2) == strip_v(p2))
        ok("grade: hidden: Cece's feedback says show_my_learning false, Dev's true",
           fb(w, w.t1, w.e1)['show_my_learning'] is False and fb(w, w.t2, w.e2)['show_my_learning'] is True)
        # the class off; Cece shown
        class_on(w, False)
        setopt(w, [w.e1], grade='show')
        s1, s2 = page(w, w.t1, w.e1), page(w, w.t2, w.e2)
        ok("grade: show overrides a class that is off: Cece's page carries My Learning and category ids", 'learning' in s1
           and s1.get('show_my_learning') is True and all('category_id' in a for a in s1['assessments']))
        ok("grade: ... and her feedback says true", fb(w, w.t1, w.e1)['show_my_learning'] is True)
        ok("grade: Dev, following the class that is off, has none", not has_learning(s2) and fb(w, w.t2, w.e2)['show_my_learning'] is False)
        ok("grade: Cece shown with the class off is byte for byte her page with the class on",
           strip_v(s1) == strip_v(p1))
        setopt(w, [w.e1], grade='class')
        ok("grade: class follows the class (off)", not has_learning(page(w, w.t1, w.e1)) and fb(w, w.t1, w.e1)['show_my_learning'] is False)
        class_on(w, True)
        ok("grade: class follows the class (on): as before any option", strip_v(page(w, w.t1, w.e1)) == strip_v(p1)
           and fb(w, w.t1, w.e1)['show_my_learning'] is True)
        ok('grade: with Same as Class the list holds nothing for Cece', listopt(w)['options'] == [])
        # mutant: the page left unpatched would still send the hidden grade
        good = defn(d, 'student_submit.page(text,uuid,text)')
        d.run(good.replace('coalesce((select e.show_overall_grade from enrollment e where e.id = p_enrollment_id),', 'coalesce(null::boolean,', 1))
        setopt(w, [w.e1], grade='hide')
        ok("grade: (a page that ignores the student's choice is caught: it sends the learning block)", 'learning' in page(w, w.t1, w.e1))
        d.run(good)
        ok("grade: (the page back as the file made it)", 'learning' not in page(w, w.t1, w.e1))
    finally:
        d.close()

# ── rpc ───────────────────────────────────────────────────────────────────────────────────────────────
def enr_rows(d): return d.all('select id::text, show_overall_grade, page_paused_at, updated_at from enrollment order by id')
def cursor(d, c): return d.one('select version from course_sync_cursor where course_id = :c', c=c) or 0

def scen_rpc():
    w = world('rpc'); d = w.d
    try:
        r = setopt(w, [w.e2, w.e1, w.e1], grade='hide')
        ok('rpc: hide two (one id twice): both in class-list order, each once',
           [o['enrollment_id'] for o in r['options']] == [w.e1, w.e2] and all(o['show_overall_grade'] == 'hide' and o['paused_at'] is None for o in r['options']), r)
        ok('rpc: the reply is { ok, options, skipped: [] } with three keys an option', sorted(r) == ['ok', 'options', 'skipped'] and r['skipped'] == []
           and all(sorted(o) == ['enrollment_id', 'paused_at', 'show_overall_grade'] for o in r['options']))
        ok('rpc: the columns hold false', d.all('select show_overall_grade from enrollment where id = any (:i::uuid[]) order by id', i=[w.e1, w.e2]) == [[False], [False]])
        r = setopt(w, [w.e1], grade='show', paused=True)
        ok('rpc: both changes in one call', r['options'][0]['show_overall_grade'] == 'show' and r['options'][0]['paused_at'] is not None, r)
        r = setopt(w, [w.e2], grade='class')
        ok('rpc: class stores null', d.one('select show_overall_grade is null from enrollment where id = :e', e=w.e2) and r['options'][0]['show_overall_grade'] == 'class')
        L = listopt(w)
        ok('rpc: the list holds only students with an option set (Cece)', [o['enrollment_id'] for o in L['options']] == [w.e1]
           and L['ok'] is True and L['options'][0]['show_overall_grade'] == 'show', L)
        d.run('update enrollment set page_paused_at = now() where id = :e', e=w.e_gone)
        ok('rpc: a withdrawn student is not listed, even with an option set', [o['enrollment_id'] for o in listopt(w)['options']] == [w.e1])
        ok('rpc: an empty class answers an empty list', listopt(w, c=w.c2)['options'] == [])
        # refusals: nothing changes
        def refuses(name, fn, state):
            rows0 = enr_rows(d); cur0 = cursor(d, w.c)
            e = refused(d, fn)
            ok('rpc: refused (%s): %s, nothing changed' % (state, name), e is not None and e[1] == state and enr_rows(d) == rows0 and cursor(d, w.c) == cur0, e)
        refuses('signed out', lambda: T(d, "set_student_page_options(:c, array[:e::uuid], 'hide', null, null)", '', c=w.c, e=w.e1), 'PT401')
        refuses('list, signed out', lambda: T(d, 'list_student_page_options(:c)', '', c=w.c), 'PT401')
        refuses("another teacher's class", lambda: setopt(w, [w.e1], 'hide', uid=B), 'P0002')
        refuses("list, another teacher's class", lambda: listopt(w, uid=B), 'P0002')
        refuses("only another teacher's student", lambda: setopt(w, [w.eb], 'hide'), 'P0002')
        refuses('only a student of my other class', lambda: setopt(w, [w.e_other], 'hide'), 'P0002')
        refuses('only a withdrawn student', lambda: setopt(w, [w.e_gone], paused=True), 'P0002')
        refuses('only ids that do not exist', lambda: setopt(w, [nid(), nid()], 'hide'), 'P0002')
        refuses('only foreign ids of every kind', lambda: setopt(w, [w.eb, w.e_other, w.e_gone, w.e_trash, nid()], 'hide'), 'P0002')
        refuses('a class in the trash', lambda: setopt(w, [w.e_trash], 'hide', c=w.trash), 'P0002')
        refuses('list, a class in the trash', lambda: listopt(w, c=w.trash), 'P0002')
        refuses('a class that does not exist', lambda: setopt(w, [w.e1], 'hide', c=nid()), 'P0002')
        refuses('a null id', lambda: T(d, "set_student_page_options(:c, array[:e::uuid, null], 'hide', null, null)", c=w.c, e=w.e2), '22023')
        refuses('no ids', lambda: setopt(w, [], 'hide'), '22023')
        refuses('null ids', lambda: T(d, "set_student_page_options(:c, null, 'hide', null, null)", c=w.c), '22023')
        refuses('501 ids', lambda: setopt(w, [w.e2] * 501, 'hide'), '22023')
        refuses('both changes null', lambda: setopt(w, [w.e2]), '22023')
        refuses("an unknown word ('Hide')", lambda: setopt(w, [w.e2], 'Hide'), '22023')
        refuses("an unknown word ('')", lambda: setopt(w, [w.e2], ''), '22023')
        # skipped: a foreign id changes nothing and comes back as sent
        setopt(w, [w.e1, w.e2, w.e3], 'class', paused=False)
        ghost = nid()
        rows0 = {r[0]: r for r in enr_rows(d)}
        r = setopt(w, [w.eb, w.e2, w.e_other, w.e_gone, w.e2, ghost, w.e_trash, w.eb], 'hide', paused=True)
        rows1 = {r[0]: r for r in enr_rows(d)}
        ok('rpc: a call with foreign ids changes the one student of the class (Dev)', [o['enrollment_id'] for o in r['options']] == [w.e2]
           and r['options'][0]['show_overall_grade'] == 'hide' and r['options'][0]['paused_at'] is not None, r)
        ok('rpc: ... and skips every other id once each, in the order sent', r['skipped'] == [w.eb, w.e_other, w.e_gone, ghost, w.e_trash], r['skipped'])
        ok("rpc: ... no foreign student's row changes (another teacher's, my other class's, withdrawn, in the trash)",
           all(rows0[e] == rows1[e] for e in (w.eb, w.e_other, w.e_gone, w.e_trash)) and ghost not in rows1)
        ok('rpc: ... the skipped list carries ids only, nothing about them', all(isinstance(x, str) for x in r['skipped']))
        kinds = []
        for x in (w.eb, w.e_other, w.e_gone, w.e_trash, nid()):
            q = setopt(w, [w.e3, x], 'class')
            kinds.append(json.dumps(dict(q, skipped=['X' for _ in q['skipped']]), sort_keys=True))
        ok("rpc: another teacher's student, my other class's, a withdrawn one, one in the trash and one that never existed get the same reply",
           len(set(kinds)) == 1, kinds[:2])
        k3 = nid()
        r1 = setopt(w, [w.e3, w.eb], 'hide', key=k3)
        setopt(w, [w.e3], 'class')
        rows0 = enr_rows(d)
        r2 = setopt(w, [w.e3, w.eb], 'hide', key=k3)
        ok('rpc: a key sent twice with a skipped id answers the first reply, skipped included, and writes nothing',
           r1 == r2 and r1['skipped'] == [w.eb] and enr_rows(d) == rows0, (r1, r2))
        setopt(w, [w.e1, w.e2, w.e3], 'class', paused=False)
        ok('rpc: 500 ids (one student 500 times) is accepted', setopt(w, [w.e2] * 500, 'hide')['options'][0]['enrollment_id'] == w.e2)
        # idempotency
        k = nid()
        r1 = setopt(w, [w.e3], paused=True, key=k)
        setopt(w, [w.e3], paused=False)
        rows0 = enr_rows(d)
        r2 = setopt(w, [w.e3], paused=True, key=k)
        ok('rpc: the same key again answers the first reply and writes nothing', r2 == r1 and enr_rows(d) == rows0, (r1, r2))
        ok("rpc: ... another teacher's call with that key is not given it", refused(d, lambda: setopt(w, [w.e3], paused=True, uid=B, key=k)) is not None)
        r3 = setopt(w, [w.e3], paused=True, key=nid())
        ok('rpc: a new key writes', r3['options'][0]['paused_at'] is not None)
        k2 = nid()
        ok('rpc: a refused call stores no answer under its key (the key works once fixed)',
           refused(d, lambda: setopt(w, [w.e3, None], 'hide', key=k2)) is not None and setopt(w, [w.e3], 'hide', key=k2)['options'][0]['show_overall_grade'] == 'hide')
        # writes only what changes; the sync cursor
        c0 = cursor(d, w.c); u0 = d.one('select updated_at from enrollment where id = :e', e=w.e3)
        setopt(w, [w.e3], 'hide', paused=True)
        ok('rpc: a call that changes nothing writes no row and leaves the sync cursor', cursor(d, w.c) == c0
           and d.one('select updated_at from enrollment where id = :e', e=w.e3) == u0)
        setopt(w, [w.e3], 'show')
        ok("rpc: a change stamps the student's updated_at and moves the class's sync cursor (the teacher's other device reloads)",
           cursor(d, w.c) > c0 and d.one('select updated_at from enrollment where id = :e', e=w.e3) > u0, (c0, cursor(d, w.c)))
        # who may run them
        for role in ('anon', 'service_role'):
            for sql in ("set_student_page_options(:c, array[:e::uuid], 'hide', null, null)", 'list_student_page_options(:c)'):
                e = refused(d, lambda: d.role(role, 'select ' + sql, A, c=w.c, e=w.e1))
                ok('rpc: %s cannot run %s' % (role, sql.split('(')[0]), e is not None and 'permission denied' in e[0], e)
        ok('rpc: public holds no execute on either', d.one("""select count(*) from pg_proc p, aclexplode(p.proacl) x
                    where p.proname in ('set_student_page_options', 'list_student_page_options') and x.grantee = 0""") == 0)
        attrs = d.all("""select p.proname, p.prosecdef, p.provolatile, p.proconfig::text from pg_proc p
                          where p.proname in ('set_student_page_options', 'list_student_page_options') order by 1""")
        ok('rpc: both run as their owner with a fixed search_path; the list is stable',
           attrs == [['list_student_page_options', True, 's', '{"search_path=public, pg_temp"}'],
                     ['set_student_page_options', True, 'v', '{"search_path=public, pg_temp"}']], attrs)
    finally:
        d.close()

# ── leak ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_leak():
    w = world('leak'); d = w.d
    try:
        bundle0 = T(d, 'get_class_bundle(:c, null)', c=w.c)
        setopt(w, [w.e1], 'hide'); setopt(w, [w.e2], 'show', paused=True)
        text = ' '.join(f() for f in routes(w, w.t1, w.e1).values()) + json.dumps(sign_in(w, w.code3))
        ok('leak: no student answer names show_overall_grade or page_paused_at', 'show_overall_grade' not in text and 'page_paused_at' not in text)
        readers = d.all("""select p.oid::regprocedure::text from pg_proc p, lateral pg_get_functiondef(p.oid) x
                            where p.pronamespace = 'student_submit'::regnamespace
                              and x ~ '(show_overall_grade|page_paused_at)' order by 1""")
        ok('leak: no student_submit function but the four patched names the columns', sorted(r[0] for r in readers) == sorted(PATCHED), readers)
        whole = d.all("""select p.oid::regprocedure::text from pg_proc p, lateral pg_get_functiondef(p.oid) x
                          where p.pronamespace = 'student_submit'::regnamespace
                            and x ~* '(enrollment%rowtype|to_jsonb\\((e|en|enr)\\)|row_to_json|\\me\\.\\*|enrollment\\.\\*)'""")
        ok('leak: no student_submit function sends or copies a whole enrollment row', whole == [], whole)
        bundle1 = T(d, 'get_class_bundle(:c, null)', c=w.c)
        diff = sorted(k for k in set(bundle0) | set(bundle1) if bundle0.get(k) != bundle1.get(k))
        ok('leak: the class bundle is the same with options set but its version and profiles', diff == ['profiles', 'version'], diff)
        cut = lambda b: [dict(p, enrollment={k: v for k, v in p['enrollment'].items() if k not in ('show_overall_grade', 'page_paused_at', 'updated_at')})
                         for p in b['profiles']]
        ok("leak: ... profiles differ only in each enrollment row's two values (and updated_at): the teacher's other device gets them with the bundle",
           cut(bundle0) == cut(bundle1) and [p['enrollment']['show_overall_grade'] for p in bundle1['profiles'] if p['enrollment']['id'] == w.e1] == [False])
        prof = T(d, 'get_student_profile(:e)', e=w.e1)
        ok("leak: get_student_profile (the teacher's, under row security) carries the student's own values",
           prof['enrollment']['show_overall_grade'] is False)
        ok("leak: ... and Teacher B cannot read it", refused(d, lambda: T(d, 'get_student_profile(:e)', B, e=w.e1)) is not None)
        T(d, "update_enrollment(:e, jsonb_build_object('is_flagged', true))", e=w.e1)
        T(d, 'withdraw_student(:e, gen_random_uuid())', e=w.e2)
        got = {e: d.all('select is_flagged, show_overall_grade, withdrawn_at is not null, page_paused_at is not null from enrollment where id = :e', e=e)[0]
               for e in (w.e1, w.e2)}
        ok('leak: update_enrollment and withdraw work and keep the options',
           got[w.e1] == [True, False, False, False] and got[w.e2] == [False, True, True, True], got)
        ok('leak: a withdrawn student leaves the list', w.e2 not in [o['enrollment_id'] for o in listopt(w)['options']])
        T(d, 'reenrol_student(:e, gen_random_uuid())', e=w.e2)
        ok('leak: re-enrolled, the student comes back with the options they had', [o for o in listopt(w)['options'] if o['enrollment_id'] == w.e2][0]['show_overall_grade'] == 'show')
    finally:
        d.close()

# ── race ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_race():
    w = world('race'); d = w.d
    try:
        from assessment_drafts import in_thread, waiting
        SQL = "select public.set_student_page_options(:c, :i::uuid[], :g, :p, null)"
        for rnd in range(3):
            setopt(w, [w.e1, w.e2], 'class', paused=False)
            s1, s2 = Side(d), Side(d)
            s1.begin('authenticated', A); s1.run(SQL, c=w.c, i=[w.e1, w.e2], g='hide', p=True)
            t, box = in_thread(lambda: (s2.begin('authenticated', A), s2.run(SQL, c=w.c, i=[w.e2, w.e1], g='show', p=True), s2.run('commit')))
            ok('race %d: a second call on the same students waits for the first' % rnd, waiting(d))
            # a student route is not held up by the open change (it reads the row as it was)
            r = S(d, "student_submit.page(:t, :e, 'ip')", t=w.t1, e=w.e1)
            ok('race %d: meanwhile the student page answers, as before the change' % rnd, r.get('ok') is True and 'learning' in r)
            at1 = s1.run("select page_paused_at from enrollment where id = :e", e=w.e1)[0][0]
            s1.run('commit'); t.join(20)
            ok('race %d: the second call then finishes, no deadlock (ids in the other order)' % rnd, 'e' not in box, box.get('e'))
            row = d.all('select show_overall_grade, page_paused_at from enrollment where id = :e', e=w.e1)[0]
            ok('race %d: the last change wins (show), and the pause keeps the time the first call set' % rnd,
               row[0] is True and str(row[1]) == str(at1), (row, at1))
            s1.close(); s2.close()
        # twenty calls at once on connections of their own, ids in random orders: no deadlock
        import random, threading
        errs = []
        def one(i):
            c = Side(d)
            try:
                ids = [w.e1, w.e2, w.e3]; random.shuffle(ids)
                c.begin('authenticated', A); c.run(SQL, c=w.c, i=ids, g=random.choice(['hide', 'show', 'class']), p=random.choice([True, False])); c.run('commit')
            except Exception as e: errs.append(message(e))
            finally: c.close()
        ts = [threading.Thread(target=one, args=(i,)) for i in range(20)]
        for x in ts: x.start()
        for x in ts: x.join(60)
        ok('race: twenty calls at once, ids in random orders: every one finishes, no deadlock', errs == [], errs[:3])
    finally:
        d.close()

# ── defaults ──────────────────────────────────────────────────────────────────────────────────────────
def scen_defaults():
    w = world('defaults', applied=False); d = w.d
    try:
        d.run('alter default privileges in schema public grant all on functions to anon, authenticated, service_role')
        d.run('alter default privileges in schema public grant all on functions to public')
        ok('defaults: with Supabase-style default privileges in place the file applies', d.file(FILE) == 'ok')
        post = d.all(bare_select(text_of(POST)))
        ok('defaults: ... and the post-check still says ok on every line (the grants are exact)', all(v == 'ok' for _, v in post), [p for p in post if p[1] != 'ok'])
        e = refused(d, lambda: d.role('anon', 'select list_student_page_options(:c)', None, c=w.c))
        ok('defaults: a visitor still may not run list_student_page_options', e is not None and e[1] == '42501', e)
    finally:
        d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_apply():
    w = world('apply', applied=False); d = w.d
    try:
        H, NEW = header_md5s()
        live = {s: md5(d, s) for s in PATCHED}
        ok('apply: (before) the header lists the 4 patched functions with the md5 they have live', all(H[s][0] == live[s] for s in PATCHED), live)
        relied = dict(re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})$', HEADER, re.M))
        pre = d.all(bare_select(text_of(PRE)))
        ok('apply: the pre-check returns no row', pre == [], pre)
        size = len(text_of(FILE).encode())
        ok('apply: the file is small enough to send whole through apply_migration (under 30 KB: %d bytes)' % size, size < 30000)
        page_sig = 'student_submit.page(text,uuid,text)'
        body = defn(d, page_sig)
        def stops(name, setup, cleanup, want, pre_names=True):
            for st in setup: d.run(st)
            cat1 = catalog(d.c); rows1 = row_checksums(d.c)
            r = d.file(FILE)
            changed = differences(cat1, catalog(d.c))
            pre = d.all(bare_select(text_of(PRE)))
            ok('apply: stops when %s, with nothing changed%s' % (name, ', and the pre-check names it' if pre_names else ''),
               r.startswith('STOPPED') and want in r and changed == ([], []) and row_checksums(d.c) == rows1 and (not pre_names or pre != []), (r, changed, pre))
            for st in cleanup: d.run(st)
        stops('a patched function is some other definition', [body.replace("'ok', true, 'v', 1,", "'ok', true, 'v', 1, 'x', 1,", 1)], [body],
              'is not the definition this file was written against')
        own = defn(d, 'public.fv_owns_course(uuid)')
        stops('a function it relies on is some other definition', [own.replace('select exists', 'select  exists', 1)], [own], 'fv_owns_course')
        stops('set_student_page_options exists as something else',
              ["create function public.set_student_page_options(p_course_id uuid, p_enrollment_ids uuid[], p_show_overall_grade text, p_paused boolean, p_idempotency_key uuid) returns jsonb language sql as 'select null::jsonb'"],
              ['drop function public.set_student_page_options(uuid,uuid[],text,boolean,uuid)'], 'is not this file')
        stops('a list_student_page_options with other arguments exists',
              ["create function public.list_student_page_options(p uuid, q int) returns jsonb language sql as 'select null::jsonb'"],
              ['drop function public.list_student_page_options(uuid, int)'], 'other arguments')
        stops('enrollment has show_overall_grade as text', ['alter table enrollment add column show_overall_grade text'],
              ['alter table enrollment drop column show_overall_grade'], 'not as this file makes it')
        stops('enrollment has page_paused_at with a default', ['alter table enrollment add column page_paused_at timestamptz default now()'],
              ['alter table enrollment drop column page_paused_at'], 'not as this file makes it')
        ok('apply: (setup) the file applies', d.file(FILE) == 'ok')
        after = {s: defn(d, s) for s in PATCHED}
        r = d.file(UNDO); ok('apply: (setup) the undo runs', r == 'ok', r)
        d.run(after['student_submit.page(text,uuid,text)'])
        stops('a patched function reads the columns and they are missing', [], [], 'enrollment lacks one', pre_names=True)
        d.statements(split(part1()))   # puts _card_refusal back
        ok('apply: (setup) back to live', all(md5(d, s) == live[s] for s in PATCHED) and not has_file(d))
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        acl0 = {s: d.one('select coalesce(proacl::text, \'\') || proowner::regrole::text || prosecdef::text || provolatile::text || coalesce(proconfig::text, \'\') from pg_proc where oid = to_regprocedure(:s)', s=s) for s in PATCHED}
        ok('apply: the file applies', d.file(FILE) == 'ok')
        rows1 = row_checksums(d.c)
        same_rows = all(rows0[t] == rows1[t] for t in rows0 if t != 'public.enrollment')
        enr_same = d.one('select count(*) from enrollment where show_overall_grade is not null or page_paused_at is not null') == 0
        ok('apply: no row of any table changes; enrollment gains two columns, null on every row', same_rows and enr_same and set(rows0) == set(rows1))
        gone, new = differences(cat0, catalog(d.c))
        names = [s.split('(')[0] for s in PATCHED] + ['set_student_page_options', 'list_student_page_options', 'show_overall_grade', 'page_paused_at']
        stray = [l for l in gone + new if not any(n in l for n in names) and not l.startswith('depends ')
                 and not re.match(r'comments on (pg_proc|pg_class|columns) \| \d+$', l)]
        ok('apply: the catalog changes only in the four functions, the two new ones and the two columns', stray == [], stray[:6])
        ok("apply: the four functions' owner, grants, security, volatility and search_path stay",
           all(d.one('select coalesce(proacl::text, \'\') || proowner::regrole::text || prosecdef::text || provolatile::text || coalesce(proconfig::text, \'\') from pg_proc where oid = to_regprocedure(:s)', s=s) == acl0[s] for s in PATCHED))
        ok('apply: every function has the md5 the header records', all(md5(d, s) == H[s][1] for s in H)
           and md5(d, SET) == NEW[SET] and md5(d, LIST) == NEW[LIST], {s: md5(d, s) for s in H})
        ok('apply: the header records six relied-on functions, each with its live md5, unchanged by the file',
           len(relied) == 6 and all(md5(d, s) == m for s, m in relied.items()), relied)
        import difflib
        bad = []
        # each changed text: only lines the file names come in or go
        d.statements(split(part1())); before_bodies = {s: defn(d, s) for s in PATCHED}; d.file(FILE)
        for s in PATCHED:
            for l in difflib.ndiff(before_bodies[s].splitlines(), defn(d, s).splitlines()):
                if l.startswith('- ') and 'student_page_enabled' not in l: bad.append((s, l))
                if l.startswith('+ ') and not re.search(r'2026111720|page_paused_at|show_overall_grade|_course\.show_my_learning\);|show_my_learning below|student_page_enabled', l): bad.append((s, l))
        ok('apply: each function changes only where the file says (lines naming the new columns, and their comment)', bad == [], bad[:4])
        post = d.all(bare_select(text_of(POST)))
        ok('apply: the post-check says ok on every line', len(post) == 17 and all(v == 'ok' for _, v in post), [p for p in post if p[1] != 'ok'])
        pre2 = d.all(bare_select(text_of(PRE)))
        ok('apply: the pre-check on the applied database names the four patched functions, the two new ones and the two columns', len(pre2) == 8, pre2)
        cat2 = catalog(d.c)
        ok('apply: a second run succeeds and changes nothing', d.file(FILE) == 'ok' and differences(cat2, catalog(d.c)) == ([], []))
        # a transaction holding enrollment: the file gives up after the lock timeout
        d.file(UNDO)
        cat3 = catalog(d.c)
        s = Side(d); s.c.run('begin'); s.c.run('update enrollment set is_flagged = is_flagged where id = :e', e=w.e1)
        t0 = time.time(); r = d.file(FILE); dt = time.time() - t0
        s.c.run('rollback'); s.close()
        ok('apply: meeting a transaction that is writing enrollment, it gives up after the 5 s lock timeout with nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < dt < 15 and differences(cat3, catalog(d.c)) == ([], []), (r, dt))
        ok('apply: run again once that transaction ends, it applies', d.file(FILE) == 'ok' and has_file(d))
    finally:
        d.close()

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', applied=False); d = w.d
    try:
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        ans0 = answers(w)
        ok('undo: on a database without the file it succeeds and changes nothing',
           d.file(UNDO) == 'ok' and differences(cat0, catalog(d.c)) == ([], []) and row_checksums(d.c) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        setopt(w, [w.e1], 'hide', paused=True)
        ok('undo: (setup) Cece is paused', scan(w, w.code1).get('error') == 'closed')
        r = d.statements(split(part1()))
        H, _ = header_md5s()
        ok('undo: PART 1 alone puts the four functions back as live had them', r == 'ok' and all(md5(d, s) == H[s][0] for s in PATCHED), r)
        ok("undo: ... Cece's scan opens and her page carries My Learning again (the choices do nothing)",
           scan(w, w.code1).get('ok') is True and 'learning' in page(w, w.t1, w.e1))
        ok('undo: ... the choices and the teacher functions stay', listopt(w)['options'][0]['show_overall_grade'] == 'hide')
        ok('undo: the file again patches them and keeps the choices', d.file(FILE) == 'ok' and scan(w, w.code1).get('error') == 'closed')
        cat1 = catalog(d.c)
        r = d.file(UNDO)
        ok('undo: the full undo stops while a student has an option set, and says how many; PART 1 stays done',
           r.startswith('STOPPED') and '1 student(s) have an option set' in r and all(md5(d, s) == H[s][0] for s in PATCHED) and has_file(d), r)
        d.file(FILE)
        body = defn(d, 'student_submit.page(text,uuid,text)')
        d.run(body.replace("'ok', true, 'v', 1,", "'ok', true, 'v', 1, 'x', 1,", 1))
        cat2 = catalog(d.c)
        r = d.file(UNDO)
        ok('undo: stops when a function was changed since the file, nothing changed',
           r.startswith('STOPPED') and 'neither' in r and differences(cat2, catalog(d.c)) == ([], []), r)
        d.run(body)
        setopt(w, [w.e1], 'class', paused=False)
        ok('undo: once no option is set, it runs', d.file(UNDO) == 'ok')
        gone, extra = differences(cat0, catalog(d.c))
        # two more dropped-column slots on enrollment than before (on a baseline that has the file, the
        # template was taken back with this undo too, so it already has two)
        slots = lambda ls: [int(l.rsplit('| ', 1)[1]) for l in ls if l.startswith('dropped columns public.enrollment |')]
        ok('undo: the catalog is as before the file, but two more dropped-column slots on enrollment',
           [l for l in gone + extra if not l.startswith('dropped columns public.enrollment |')] == []
           and (slots(gone) or [0])[0] + 2 == slots(extra)[0], (gone[:3], extra[:3]))
        rows1 = row_checksums(d.c)
        changed = sorted(t for t in rows0 if rows0[t] != rows1.get(t))
        ok("undo: every row is as before but enrollment's updated_at for Cece, fv_idempotency's stored replies and the sync cursor",
           set(changed) <= {'public.enrollment', 'public.fv_idempotency', 'public.course_sync_cursor', 'public.course'}, changed)
        ans1 = answers(w)
        ok('undo: every student answer is as before the file, byte for byte', ans1 == ans0, sorted(k for k in ans0 if ans0[k] != ans1[k])[:4])
        cat3 = catalog(d.c)
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and differences(cat3, catalog(d.c)) == ([], []))
        ok('undo: the file applies again afterwards', d.file(FILE) == 'ok' and has_file(d))
        # the lock: a transaction that read enrollment and then writes it while the undo waits
        weak = text_of(UNDO).replace('in access exclusive mode', 'in share row exclusive mode')
        assert weak != text_of(UNDO)
        def reads_then_writes(undo_text):
            from assessment_drafts import in_thread
            x = Side(d); mon = connect(d.name)
            x.c.run('begin'); x.c.run('select count(*) from enrollment')
            t, box = in_thread(lambda: d.statements(split(undo_text)))
            end = time.time() + 10
            while time.time() < end and not mon.run("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")[0][0]:
                time.sleep(0.05)
            x_err = None
            try:
                x.c.run('update enrollment set is_flagged = is_flagged where id = :e', e=w.e1); x.c.run('commit')
            except Exception as e:
                x_err = message(e); x.c.run('rollback')
            t.join(30); x.close(); mon.close()
            return x_err, box.get('r'), box.get('e')
        x_err, r, e = reads_then_writes(weak)
        ok('undo: (the deadlock, reproduced) with the weaker lock first, a transaction that read enrollment and then writes it, or the undo, dies with deadlock detected',
           'deadlock detected' in ' '.join(str(v) for v in (x_err, r, e)), (x_err, r, e))
        ok('undo: (setup) the file is applied again', d.file(FILE) == 'ok' and has_file(d))
        x_err, r, e = reads_then_writes(text_of(UNDO))
        ok('undo: with the access exclusive lock, the same transaction writes and commits, and the undo then runs: no deadlock',
           x_err is None and r == 'ok' and e is None and not has_file(d), (x_err, r, e))
        ok('undo: (the file applies again)', d.file(FILE) == 'ok')
    finally:
        d.close()

SCEN = {'same': scen_same, 'pause': scen_pause, 'grade': scen_grade, 'rpc': scen_rpc, 'leak': scen_leak, 'race': scen_race, 'defaults': scen_defaults, 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCEN)):
        n = len(ccc.passed) + len(ccc.failed)
        try: SCEN[name]()
        except Exception as e:
            import traceback; traceback.print_exc(); ok('%s: ran to the end' % name, False, e)
        print('%-8s %d checks' % (name, len(ccc.passed) + len(ccc.failed) - n), file=sys.stderr)
    finish()
