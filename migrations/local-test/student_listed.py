"""One student page rule: migrations/2026111702_student_listed_rule.sql on a database rebuilt from the repo
and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "One student page rule").

    PGPORT=<port> PGDATABASE=<db> python3 student_listed.py            every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 student_listed.py same       or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and
dropped here. Never against gradebook-prod: a throwaway PostgreSQL 17 only. It uses the world and the
routes of assessment_drafts.py.

  rule   student_submit._listed gives what the spelled-out rule gave, in both orders the functions
         wrote it, null included, for every Draft / Date Assigned / today the rule can meet.
  same   Every route a student session reaches (page with its to-do count, rubrics and My Learning;
         work; feedback; group_work; file_links; group_file_links; handout_links; markup; reflect;
         send_start; replace; unsend; a card sign-in's class list) gives the same answer, byte for
         byte, before and after the file, for both pieces under test in 8 states (Draft or not; no
         Date Assigned, yesterday, today, tomorrow in the class's time zone) in 3 time zones
         (Vancouver, UTC+14, UTC-11). The states give different answers, so the comparison means
         something.
  apply  The guards (a function some other definition, _listed in another form or with other
         arguments, a function that calls a missing _listed) stop with the catalog unchanged; the file
         changes only the 10 functions and adds _listed, no row; each function's text differs only
         where the rule was, and its attributes and grants stay; the md5s the header records; the
         pre-check and post-check; a second run; the lock timeout; the file's size.
  undo   On a database without the file it changes nothing; after the file the catalog and every row
         are exactly as before, and every answer; a second run; a function changed since stops it;
         2026111701's undo stops while the file is applied and runs once this undo has.
"""
import difflib, json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import ok, finish, connect, text_of, catalog, differences, row_checksums, tx
import card_codes_common as ccc
from assessment_drafts import world, session, paths, bypass, S, md5, defn, Side, A

FILE = '../2026111702_student_listed_rule.sql'
UNDO = 'student-listed-undo.sql'
PRE = 'student-listed-live-precheck.sql'
POST = 'student-listed-live-postcheck.sql'
DRAFTS_UNDO = 'assessment-drafts-undo.sql'
LISTED = 'student_submit._listed(public.assessment,date)'
CHANGED = ['student_submit._session_classes(uuid)', 'student_submit._work_window(uuid)', 'student_submit.feedback(text,uuid,text)',
           'student_submit.group_work(text,uuid,text)', 'student_submit.page(text,uuid,text)',
           'student_submit.file_links(text,uuid,uuid,text)', 'student_submit.group_file_links(text,uuid,uuid,text)',
           'student_submit.handout_links(text,uuid,uuid,text)', 'student_submit.markup(text,uuid,uuid,text)',
           'student_submit.reflect(text,uuid,uuid,jsonb,text)']
HEADER = text_of(FILE)

def header_md5s():
    """{function: (before, after)} as the file's header records them, and _listed's md5."""
    rows = dict((m[0], (m[1], m[2])) for m in re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})  ([0-9a-f]{32})$', HEADER, re.M))
    listed = re.search(r'^--   student_submit\._listed\(public\.assessment,date\) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M).group(1)
    return rows, listed

def bare_select(text):
    return '\n'.join(l for l in text.splitlines() if not l.startswith('--')).strip().rstrip(';')

# ── rule ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_rule():
    w = world('rule', applied=False); d = w.d
    try:
        ok('rule: (setup) the file applies', d.file(FILE) == 'ok')
        rows = d.all("""
            with s as (select x.draft, x.k, t.today
                         from (values (false), (true)) x0(draft)
                        cross join lateral (select x0.draft, k from (values (null::int), (-1), (0), (1)) k(k)) x
                        cross join (values (null::date), (date '2026-11-17')) t(today)),
                 a as (select s.*, (select r from assessment r where r.id = :p) as r0 from s)
            select draft, k, today,
                   student_submit._listed(jsonb_populate_record(r0, jsonb_build_object('is_draft', draft,
                       'date_assigned', case when k is null then null else date '2026-11-17' + k end)), today) as listed,
                   ((case when k is null then null else date '2026-11-17' + k end) is null
                     or (case when k is null then null else date '2026-11-17' + k end) <= today) and not draft as spelled,
                   not draft and ((case when k is null then null else date '2026-11-17' + k end) is null
                     or (case when k is null then null else date '2026-11-17' + k end) <= today) as spelled_too
              from a""", p=w.p)
        ok('rule: 16 cases (Draft or not; no date, the day before, the day, the day after; today known or null)', len(rows) == 16)
        bad = [r for r in rows if not (r[3] is r[4] or r[3] == r[4]) or not (r[3] is r[5] or r[3] == r[5])]
        ok('rule: _listed is the spelled-out rule in every case, in both orders it was written, null included', bad == [], bad)
        ok('rule: no date and not a Draft is listed even with no today; a Draft never is',
           all(r[3] is True for r in rows if r[1] is None and not r[0]) and all(r[3] is not True for r in rows if r[0]))
        a = d.all("""select p.provolatile, p.proisstrict, p.prosecdef, p.proparallel, p.proconfig::text, p.proowner::regrole::text,
                            coalesce(p.proacl::text, ''), l.lanname
                       from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure(:s)""", s=LISTED)[0]
        ok("rule: _listed is immutable, not strict, not SECURITY DEFINER, parallel safe, search_path '', SQL, the owner's",
           a[:6] == ['i', False, False, 's', '{"search_path=\\"\\""}', 'postgres'] and a[7] == 'sql', a)
        ok('rule: nobody but the owner may run _listed (anon, authenticated, service_role, public)',
           not any(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=LISTED) for r in ('anon', 'authenticated', 'service_role', 'public')))
        def refused(role):
            try:
                d.role(role, "select student_submit._listed(a, current_date) from assessment a limit 1"); return False
            except Exception as e:
                return 'permission denied' in str(e)
        ok('rule: called as anon, authenticated or service_role it is refused', all(refused(r) for r in ('anon', 'authenticated', 'service_role')))
    finally:
        d.close()

# ── same ──────────────────────────────────────────────────────────────────────────────────────────────
ZONES = ['America/Vancouver', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']
STATES = [(draft, k) for draft in (False, True) for k in (None, -1, 0, 1)]

def routes(w, code3):
    fns = paths(w)
    d = w.d
    def sign_in():
        with tx(d):
            r = d.verify(code3, birthday='2012-05-15')
            return json.dumps({'ok': r.get('ok'), 'classes': r.get('classes')}, sort_keys=True)
    fns['card sign-in (class list)'] = sign_in
    return fns

def put(w, zone, draft, k):
    d = w.d
    d.run('update course set timezone = :z where id = :c', z=zone, c=w.c)
    date = 'null' if k is None else "(now() at time zone public._fv_timezone(:z))::date + %d" % k
    bypass(d, "update assessment set is_draft = :x, date_assigned = %s where id = any (:ids)" % date,
           x=draft, ids=[w.p, w.p2], **({} if k is None else {'z': zone}))

def answers(w, fns):
    out = {}
    for zone in ZONES:
        for draft, k in STATES:
            put(w, zone, draft, k)
            for name, f in fns.items():
                out[(zone, draft, k, name)] = f()
    return out

def scen_same():
    w = world('same', applied=False); d = w.d
    try:
        code3 = session(d, w.e3, w.c)[1]
        fns = routes(w, code3)
        before = answers(w, fns)
        ok('same: (setup) the file applies', d.file(FILE) == 'ok')
        after = answers(w, fns)
        ok('same: %d answers (%d routes, %d states, %d time zones)' % (len(before), len(fns), len(STATES), len(ZONES)),
           len(before) == len(after) == len(fns) * len(STATES) * len(ZONES))
        for name in fns:
            diff = [key[:3] for key in before if key[3] == name and before[key] != after[key]]
            ok('same: %s: every state, byte for byte' % name, diff == [], diff[:3])
        # the comparison means something: for each route but unsend, the states give at least two answers
        flat = [name for name in fns if name != 'unsend'
                and len({before[(z, x, k, name)] for z in ZONES for x, k in STATES}) < 2]
        ok('same: every route but unsend answers differently for a piece on the page and one kept off it', flat == [], flat)
        # and the day boundary is in the class's zone: dated today, the piece is on; tomorrow, off (page, in each zone)
        on = lambda z, x, k: w.p in json.dumps([a['id'] for a in json.loads(before[(z, x, k, 'page (Cece)')])['assessments']])
        ok("same: (before and after) dated today in the class's zone the piece is listed, tomorrow it is not, in every zone; a Draft never",
           all(on(z, False, 0) and on(z, False, -1) and on(z, False, None) and not on(z, False, 1) and not any(on(z, True, k) for k in (None, -1, 0, 1))
               for z in ZONES))
        ok('same: an answer before the file is the answer after it for the same state (spot check: page in UTC+14, today)',
           before[('Pacific/Kiritimati', False, 0, 'page (Cece)')] == after[('Pacific/Kiritimati', False, 0, 'page (Cece)')])
        # mutants: the comparison catches a rule a day late, or one that forgets Drafts
        good = defn(d, LISTED)
        for name, find, put_ in (('a day late (< for <=)', 'date_assigned <= p_today', 'date_assigned < p_today'),
                                 ('Drafts forgotten', 'select not p_assessment.is_draft\n       and', 'select')):
            assert find in good, name
            d.run(good.replace(find, put_))
            mut = answers(w, fns)
            ok('same: (a mutant _listed, %s, gives other answers)' % name, any(mut[k] != before[k] for k in before))
        d.run(good)
        ok('same: (setup) _listed back as the file made it', md5(d, LISTED) == header_md5s()[1])
    finally:
        d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
def attrs(d, sig):
    return d.all("""select p.prokind, p.prolang, p.provolatile, p.proisstrict, p.prosecdef, p.proleakproof, p.proparallel, p.procost,
                           p.prorows, p.proretset, coalesce(p.proconfig::text, ''), pg_get_function_result(p.oid),
                           pg_get_function_arguments(p.oid), p.proowner::regrole::text, coalesce(p.proacl::text, ''),
                           coalesce(obj_description(p.oid, 'pg_proc'), '')
                      from pg_proc p where p.oid = to_regprocedure(:s)""", s=sig)[0]

def scen_apply():
    w = world('apply', applied=False); d = w.d
    try:
        H, LMD5 = header_md5s()
        live = {s: md5(d, s) for s in CHANGED}
        ok('apply: (before) the header lists the 10 functions, and each has the md5 it records as live',
           sorted(H) == sorted(CHANGED) and all(H[s][0] == live[s] for s in CHANGED), live)
        pre = d.all(bare_select(text_of(PRE)))
        ok('apply: the pre-check says ok on every line', len(pre) == 11 and all(v == 'ok' for _, v in pre), pre)
        size = len(text_of(FILE).encode())
        ok('apply: the file is small enough to send whole through apply_migration (under 20 KB: %d bytes)' % size, size < 20000)
        bodies0 = {s: defn(d, s) for s in CHANGED}
        attrs0 = {s: attrs(d, s) for s in CHANGED}
        def stops(name, setup, cleanup, want):
            for st in setup: d.run(st)
            cat1 = catalog(d.c); rows1 = row_checksums(d.c)
            r = d.file(FILE)
            changed = differences(cat1, catalog(d.c))
            ok('apply: stops when %s, with nothing changed' % name,
               r.startswith('STOPPED') and want in r and changed == ([], []) and row_checksums(d.c) == rows1, (r, changed))
            for st in cleanup: d.run(st)
        page = 'student_submit.page(text,uuid,text)'
        wrong = bodies0[page].replace("'ok', true,", "'ok', true, 'x', 1,", 1)
        assert wrong != bodies0[page]
        stops('a function it changes is some other definition', [wrong], [bodies0[page]], 'is not the definition this file was written against')
        stops('_listed exists and is something else',
              ["create function student_submit._listed(p public.assessment, t date) returns boolean language sql as 'select true'"],
              ['drop function student_submit._listed(public.assessment, date)'], 'is not this file')
        stops('a _listed with other arguments exists',
              ["create function student_submit._listed(p uuid) returns boolean language sql as 'select true'"],
              ['drop function student_submit._listed(uuid)'], 'exists with other arguments')
        # a function that already calls _listed while _listed is missing: apply, take _listed out, run again
        ok('apply: (setup) the file applies', d.file(FILE) == 'ok')
        after_bodies = {s: defn(d, s) for s in CHANGED}
        listed_def = defn(d, LISTED)
        d.run('drop function student_submit._listed(public.assessment, date)')
        stops('a function calls _listed and _listed is missing', [], [], 'which is missing')
        d.run(listed_def)
        for s in CHANGED: d.run(bodies0[s])
        d.run('drop function student_submit._listed(public.assessment, date)')
        ok('apply: (setup) back to live', all(md5(d, s) == live[s] for s in CHANGED) and md5(d, LISTED) is None)

        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        ok('apply: the file applies', d.file(FILE) == 'ok')
        cat1 = catalog(d.c); rows1 = row_checksums(d.c)
        ok('apply: no row of any table changes', rows0 == rows1)
        gone, new = differences(cat0, cat1)
        names = [s.split('(')[0] for s in CHANGED]
        stray = [l for l in gone + new if not l.startswith('depends ')
                 and not any(n + '(' in l for n in names) and 'student_submit._listed(' not in l
                 and l not in ('comments on pg_proc | %d' % n for n in range(1000))]
        ok('apply: the catalog changes only in the 10 functions and _listed', stray == [], stray[:5])
        # 'function more' lines differ in md5(prosrc), the body, and in nothing else
        nosrc = lambda ls: sorted(' | '.join(x for i, x in enumerate(l.split(' | ')) if i != 14)
                                  for l in ls if l.startswith('function more') and any(n + '(' in l for n in names))
        ok("apply: the 10 functions' attributes do not change (catalog: language, volatility, strict, security, search_path, cost, result, arguments)",
           len(nosrc(gone)) == 10 and nosrc(gone) == nosrc(new), (nosrc(gone)[:1], nosrc(new)[:1]))
        ok('apply: ... nor their owner, grants and comment', all(attrs(d, s) == attrs0[s] for s in CHANGED),
           [s for s in CHANGED if attrs(d, s) != attrs0[s]])
        aft = {s: md5(d, s) for s in CHANGED}
        ok('apply: every function has the md5 the header records as after, and _listed too',
           all(H[s][1] == aft[s] for s in CHANGED) and md5(d, LISTED) == LMD5, aft)
        # each changed text: lines taken out hold the rule (or the comment beside it); lines put in call _listed or name it
        bad = []
        for s in CHANGED:
            a, b = bodies0[s].splitlines(), defn(d, s).splitlines()
            for l in difflib.ndiff(a, b):
                if l.startswith('- ') and not re.search(r'date_assigned|is_draft|E4: a piece dated|-- 2026111701: a Draft is not', l): bad.append((s, l))
                if l.startswith('+ ') and '_listed' not in l: bad.append((s, l))
        ok('apply: each function changes only where the rule was: out go its lines, in come calls to _listed', bad == [], bad[:4])
        left = [s for s in CHANGED if re.search(r'date_assigned\s*(<=|is null)|is_draft', defn(d, s))]
        ok('apply: no changed function spells the rule out any more', left == [], left)
        calls = {s: defn(d, s).count('student_submit._listed(') for s in CHANGED}
        ok('apply: 12 calls in all, page 3, each other function 1', sum(calls.values()) == 12 and calls[page] == 3
           and all(v == 1 for s, v in calls.items() if s != page), calls)
        # a sneaky change elsewhere in a body would show in the line check
        sneaky = defn(d, page).replace("'ok', true,", "'ok', true, 'x', 1,", 1)
        ok('apply: (the line check notices a change that is not the rule)',
           any(not l.startswith('  ') and '_listed' not in l and not re.search('date_assigned|is_draft', l)
               for l in difflib.ndiff(bodies0[page].splitlines(), sneaky.splitlines()) if l[:2] in ('- ', '+ ')))
        post = d.all(bare_select(text_of(POST)))
        ok('apply: the post-check says ok on every line', len(post) == 15 and all(v == 'ok' for _, v in post), [p for p in post if p[1] != 'ok'])
        pre2 = d.all(bare_select(text_of(PRE)))
        ok('apply: the pre-check on the applied database says NOT AS EXPECTED on every line',
           all(v.startswith('NOT') for _, v in pre2), pre2)
        cat2 = catalog(d.c)
        ok('apply: a second run succeeds and changes nothing', d.file(FILE) == 'ok' and differences(cat2, catalog(d.c)) == ([], []))
        # a transaction holding one of the functions: the file gives up after the 5 s lock timeout, nothing changed
        d.file(UNDO)
        cat3 = catalog(d.c)
        s = Side(d); s.c.run('begin'); s.c.run(bodies0[page])
        t0 = time.time(); r = d.file(FILE); dt = time.time() - t0
        s.c.run('rollback'); s.close()
        ok('apply: meeting a transaction that is changing student_submit.page, it gives up after the 5 s lock timeout with nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < dt < 15 and differences(cat3, catalog(d.c)) == ([], []), (r, dt))
        ok('apply: run again once that transaction ends, it applies', d.file(FILE) == 'ok' and md5(d, page) == H[page][1])
    finally:
        d.close()

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', applied=False); d = w.d
    try:
        code3 = session(d, w.e3, w.c)[1]
        fns = routes(w, code3)
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        ans0 = {k: f() for k, f in fns.items()}
        ok('undo: on a database without the file it succeeds and changes nothing',
           d.file(UNDO) == 'ok' and differences(cat0, catalog(d.c)) == ([], []) and row_checksums(d.c) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        cat1 = catalog(d.c)
        r = d.file(DRAFTS_UNDO)
        ok("undo: 2026111701's undo stops while the file is applied, nothing changed",
           r.startswith('STOPPED') and differences(cat1, catalog(d.c)) == ([], []), r)
        page = 'student_submit.page(text,uuid,text)'
        body = defn(d, page)
        d.run(body.replace("'ok', true,", "'ok', true, 'x', 1,", 1))
        cat2 = catalog(d.c)
        r = d.file(UNDO)
        ok('undo: stops when a function was changed since the file, nothing changed',
           r.startswith('STOPPED') and 'neither' in r and differences(cat2, catalog(d.c)) == ([], []), r)
        d.run(body)
        ok('undo: runs', d.file(UNDO) == 'ok')
        gone, new = differences(cat0, catalog(d.c))
        ok('undo: the catalog is exactly as before the file', (gone, new) == ([], []), (gone[:3], new[:3]))
        ok('undo: every row is as before the file', row_checksums(d.c) == rows0)
        ok('undo: every answer is as before the file, byte for byte', {k: f() for k, f in fns.items()} == ans0)
        cat3 = catalog(d.c)
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and differences(cat3, catalog(d.c)) == ([], []))
        ok('undo: the file applies again afterwards', d.file(FILE) == 'ok')
        ok("undo: after this undo, 2026111701's undo runs (no Drafts)", d.file(UNDO) == 'ok' and d.file(DRAFTS_UNDO) == 'ok')
    finally:
        d.close()

SCEN = {'rule': scen_rule, 'same': scen_same, 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCEN)):
        n = len(ccc.passed) + len(ccc.failed)
        try: SCEN[name]()
        except Exception as e:
            import traceback; traceback.print_exc(); ok('%s: ran to the end' % name, False, e)
        print('%-8s %d checks' % (name, len(ccc.passed) + len(ccc.failed) - n), file=sys.stderr)
    finish()
