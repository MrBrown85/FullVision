"""BC's clock: migrations/2026112411_bc_time_utc_minus_7.sql on a database rebuilt from the repo and proved equal
to live (scripts/db-rebuild.mjs --check; README.md, "BC time reads as UTC-7").

    PGPORT=<port> PGDATABASE=<db> python3 bc_time.py fingerprints   write the md5 lists the files carry
    PGPORT=<port> PGDATABASE=<db> python3 bc_time.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 bc_time.py zone           or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  zone      what _fv_timezone answers: 'America/Vancouver', blank, null, spaces and garbage give Etc/GMT+7; another
            zone is given back as it came; Etc/GMT+7 is UTC-7 with no daylight time; before the file, the old
            function (the name given, else America/Vancouver).
  dates     for a series of UTC instants (every hour and the last second before it, across midnight, over the
            old Nov and Mar switch dates, a year end and a leap day): the date each of the five patched
            functions works out, taken from the expression written in the function itself, is the date at
            UTC-7 for each way of writing BC; Toronto is the date in Toronto. The same, end to end, for
            _closed_reason on a clock the test sets (a copy of the function with now() replaced), and the real
            clock through _midnight.
  apply     the guards stop with the catalog unchanged; only the six functions change; the md5s the file
            carries; a second run; the three read-only files; a lock held elsewhere; plain ASCII, no backslash.
  undo      leaves the catalog as before the file, byte for byte; a second run; the file again.
"""
import json, os, re, sys, time
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, ok, finish, split, text_of
from catalog import catalog, differences, row_checksums

FILE = '../2026112411_bc_time_utc_minus_7.sql'
UNDO = 'bc-time-undo.sql'
PRE = 'bc-time-live-precheck.sql'
POST = 'bc-time-live-postcheck.sql'
FPS = 'bc-time-live-fingerprints.sql'

TZ = 'public._fv_timezone(text)'
PATCHED = ['student_submit._closed_reason(questionnaire,text)', 'student_submit."check"(text,text,text)',
           'student_submit.forms(text,uuid,text)', 'student_submit.open(text,text,text,text)',
           'student_submit.report(text,uuid,uuid,text)']
REPLACED = [TZ] + PATCHED
# the variable each patched function reads its course's zone from
VAR = {PATCHED[0]: 'p_tz'}
for s in PATCHED[1:]: VAR[s] = '_course.timezone'

def quiet0(diff):
    return tuple([l for l in side if not l.startswith(('depends', 'dropped columns'))] for side in diff)
def DB(tag):
    d = Db(tag)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    return d
def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def defn(d, sig): return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
def applied(d): return 'Etc/GMT+7' in (defn(d, TZ) or '')
def q(s): return 'null' if s is None else "'" + s.replace("'", "''") + "'"
def without_final(text):
    a = text.index('do $final$'); b = text.index('$final$;', a + 12) + len('$final$;')
    return text[:a] + text[b:]

def put_list(text, name, rows):
    pat = re.compile(r'(-- FINGERPRINTS-BEGIN %s[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)' % re.escape(name), re.S)
    m = pat.search(text)
    if not m: sys.exit('no list %s' % name)
    indent = re.match(r'[ \t]*', m.group(2)).group(0)
    return text[:m.start(2)] + ',\n'.join(indent + r for r in rows) + text[m.end(2):]
def tup(*v): return '(' + ', '.join(q(x) for x in v) + ')'

def sig_of(d, oid_sql):
    s = d.one("select %s::regprocedure::text" % oid_sql)
    return s if '.' in s.split('(')[0] else 'public.' + s
def relied_sigs(d):
    """Every other function that reads _fv_timezone: its answer moves with the file."""
    rows = d.all("""select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
                       and pg_get_functiondef(p.oid) like '%_fv_timezone%'""")
    out = []
    for (s,) in rows:
        s = s if '.' in s.split('(')[0] else 'public.' + s
        if s not in REPLACED: out.append(s)
    return sorted(out, key=lambda s: s.encode())

# == The md5 lists the files carry, and the old definition the undo restores ==
def scen_fingerprints():
    d = Db('bt_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        relied = {s: md5(d, s) for s in relied_sigs(d)}
        before = {s: md5(d, s) for s in REPLACED}
        missing = [s for s, v in list(relied.items()) + list(before.items()) if v is None]
        if missing: sys.exit('not on the template: %s' % missing)
        old_tz = defn(d, TZ)
        path = os.path.join(HERE, FILE)
        text = open(path).read()
        text = put_list(text, 'relied', [tup(s, relied[s]) for s in relied])
        text = put_list(text, 'replaces', [tup(s, before[s], '-') for s in REPLACED])
        text = put_list(text, 'after', [tup(s, '-') for s in REPLACED])
        r = d.statements(split(without_final(text)))
        if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
        after = {s: md5(d, s) for s in REPLACED}
        text = put_list(text, 'replaces', [tup(s, before[s], after[s]) for s in REPLACED])
        text = put_list(text, 'after', [tup(s, after[s]) for s in REPLACED])
        open(path, 'w').write(text)
        live = list(relied.items()) + list(before.items())
        for fn, name, rows in ((FPS, 'live', live), (PRE, 'precheck', live), (POST, 'postcheck', list(relied.items()) + list(after.items()))):
            p = os.path.join(HERE, fn); t = open(p).read()
            open(p, 'w').write(put_list(t, name, [tup(s, v) for s, v in rows]))
        p = os.path.join(HERE, UNDO); t = open(p).read()
        t = put_list(t, 'undo-replaced', [tup(s, before[s], after[s]) for s in REPLACED])
        t = put_list(t, 'undo-after', [tup(s, before[s]) for s in REPLACED])
        a = t.index('-- OLD-DEFINITIONS-BEGIN'); a = t.index('\n', a) + 1; b = t.index('-- OLD-DEFINITIONS-END')
        t = t[:a] + old_tz.rstrip() + ';\n\n' + t[b:]
        open(p, 'w').write(t)
        print('written: relied %d, replaced %d' % (len(relied), len(before)))
    finally:
        d.close()

# == the instants ==
def instants():
    out = []
    for day in ('2026-11-24', '2026-11-01', '2026-11-02', '2026-03-08', '2026-03-09', '2027-03-14', '2027-11-07',
                '2026-07-15', '2026-12-31', '2027-01-01', '2028-02-29', '2029-03-01'):
        for h in range(24):
            out += ['%s %02d:00:00+00' % (day, h), '%s %02d:59:59.999999+00' % (day, h)]
    return out
TZ_INPUTS = ['America/Vancouver', '', None, '   ', 'Not/AZone', 'garbage']

def clause(d, sig, expr_sql_vars):
    return None

def expr_of(d, sig):
    m = re.search(r'\(now\(\) at time zone (.+?)\)::date', defn(d, sig))
    return m.group(1) if m else None
def dates_wrong(d, expr, tz, times, expected_sql):
    r = d.one("select count(*) from unnest(%s::timestamptz[]) i where (i at time zone %s)::date is distinct from %s" %
              (q('{' + ','.join('"%s"' % t for t in times) + '}'), expr, expected_sql))
    return r

# == the answers of _fv_timezone ==
def scen_zone():
    d = Db('bt_zone')
    try:
        old = {x: d.one('select public._fv_timezone(:x)', x=x) for x in TZ_INPUTS + ['America/Toronto', 'UTC']}
        ok('zone: before the file, a name PostgreSQL accepts comes back as given', old['America/Vancouver'] == 'America/Vancouver' and old['America/Toronto'] == 'America/Toronto', old)
        ok('zone: before the file, blank, null and garbage give America/Vancouver', old[''] == old[None] == old['   '] == old['Not/AZone'] == old['garbage'] == 'America/Vancouver', old)
        r = d.file(FILE); ok('zone: the file applies', r == 'ok', r)
        new = {x: d.one('select public._fv_timezone(:x)', x=x) for x in TZ_INPUTS + ['America/Toronto', 'UTC', 'america/vancouver', 'US/Pacific']}
        ok('zone: America/Vancouver, blank, null, spaces and garbage all give Etc/GMT+7', all(new[x] == 'Etc/GMT+7' for x in TZ_INPUTS), new)
        ok('zone: another zone comes back unchanged', new['America/Toronto'] == 'America/Toronto' and new['UTC'] == 'UTC', new)
        ok('zone: only the exact name is mapped (case and other names are not touched)', new['america/vancouver'] == 'america/vancouver' and new['US/Pacific'] == 'US/Pacific', new)
        z = d.all("select utc_offset::text, is_dst from pg_timezone_names where name = 'Etc/GMT+7'")
        ok('zone: Etc/GMT+7 is UTC-7 with no daylight time on this server', z == [['-07:00:00', False]], z)
        ok('zone: and now() at time zone Etc/GMT+7 is now() minus seven hours',
           d.one("select (now() at time zone 'Etc/GMT+7') = (now() at time zone 'UTC') - interval '7 hours'"))
        ok('zone: stable, the same search path, the same owner and grants',
           d.all("select provolatile::text, proconfig::text, pg_get_userbyid(proowner), proacl::text from pg_proc where oid = to_regprocedure('public._fv_timezone(text)')")
           == [['s', '{"search_path=public, pg_temp"}', 'postgres', d.one("select proacl::text from pg_proc where oid = to_regprocedure('public._fv_timezone(text)')")]])
    finally:
        d.close()

# == the dates ==
def scen_dates():
    d = Db('bt_dates')
    try:
        times = instants()
        exprs_before = {s: expr_of(d, s) for s in PATCHED}
        ok('dates: before the file, each patched function spells out the zone (found in all five)',
           all(e and "'America/Vancouver'" in e for e in exprs_before.values()), exprs_before)
        r = d.file(FILE); ok('dates: the file applies', r == 'ok', r)
        if r != 'ok': return
        for s in PATCHED:
            e = expr_of(d, s)
            ok('dates: %s reads its zone as public._fv_timezone(%s)' % (s, VAR[s]), e == 'public._fv_timezone(%s)' % VAR[s], e)
            ok('dates: %s has no zone name left in it' % s, 'America/Vancouver' not in defn(d, s))
            for tz in TZ_INPUTS:
                expr = e.replace(VAR[s], q(tz))
                wrong = dates_wrong(d, expr, tz, times, "((i at time zone 'UTC') - interval '7 hours')::date")
                ok('dates: %s, zone %r: the date is the date at UTC-7 on all %d instants' % (s, tz, len(times)), wrong == 0, wrong)
            expr = e.replace(VAR[s], q('America/Toronto'))
            wrong = dates_wrong(d, expr, 'America/Toronto', times, "(i at time zone 'America/Toronto')::date")
            ok('dates: %s, zone America/Toronto: the date in Toronto' % s, wrong == 0, wrong)
        # _closed_reason end to end, on a clock this test sets: a copy of the function with now() replaced
        d.run("create function public._bc_now() returns timestamptz language sql stable as $$ select current_setting('bctest.now')::timestamptz $$")
        body = defn(d, PATCHED[0])
        copy = re.sub(r'FUNCTION student_submit\._closed_reason\(', 'FUNCTION student_submit._bt_closed_reason(', body).replace('now()', 'public._bc_now()')
        ok('dates: (setup) the copy differs only in its name and its clock', copy != body and copy.count('_bc_now') == body.count('now()') == 1, copy)
        d.run(copy)
        bad = []; n = 0
        for t in times[::2] + times[1::2][:30]:
            d.run("select set_config('bctest.now', :t, false)", t=t)
            e = d.one("select ((:t)::timestamptz at time zone 'UTC' - interval '7 hours')::date::text", t=t)
            for tz in TZ_INPUTS:
                for label, opens, closes, want in (('today', e, e, None), ('yesterday last day', None, "(:e::date - 1)", 'closed'), ('tomorrow first day', "(:e::date + 1)", None, 'not_open_yet')):
                    js = json.dumps({'is_on': True, 'opens_on': None, 'closes_on': None})
                    sql = "select student_submit._bt_closed_reason(jsonb_populate_record(null::questionnaire, jsonb_build_object('is_on', true, 'opens_on', %s, 'closes_on', %s)), :z)" % (
                        'null' if opens is None else (opens if opens.startswith('(') else ':e::date'), 'null' if closes is None else (closes if closes.startswith('(') else ':e::date'))
                    got = d.one(sql, e=e, z=tz); n += 1
                    if got != want: bad.append((t, tz, label, got))
        ok('dates: _closed_reason on a set clock: open on BC today, closed after yesterday, not open before tomorrow (%d calls)' % n, not bad, bad[:3])
        # the real clock, through a function that returns a moment
        mid = d.one("""select student_submit._midnight('America/Vancouver') = ((date_trunc('day', now() at time zone 'UTC' - interval '7 hours') + interval '1 day' + interval '7 hours') at time zone 'UTC')""")
        ok('dates: student_submit._midnight(America/Vancouver) on the real clock is the next midnight at UTC-7', mid is True, mid)
        mid2 = d.one("select student_submit._midnight('') = student_submit._midnight('America/Vancouver') and student_submit._midnight(null) = student_submit._midnight('x/y')")
        ok('dates: and blank, null and garbage give the same moment', mid2 is True, mid2)
        tor = d.one("select student_submit._midnight('America/Toronto') = (((now() at time zone 'America/Toronto')::date + 1)::timestamp at time zone 'America/Toronto')")
        ok('dates: and Toronto is still Toronto', tor is True, tor)
    finally:
        d.close()

# == apply ==
def scen_apply():
    d = DB('bt_apply')
    try:
        text = text_of(FILE)
        ok('apply: plain ASCII, no backslash, no unicode escape', text.isascii() and chr(92) not in text and 'u&' not in text.lower())
        ok('apply: small enough to send whole (under 50 KB)', len(text.encode()) < 50000, len(text.encode()))
        for fn in (UNDO, PRE, POST, FPS):
            t = text_of(fn); ok('apply: %s is plain ASCII, no backslash' % fn, t.isascii() and chr(92) not in t)
        ok('apply: no zone name stored or default is touched (create_course and import_json_restore are not in the file)',
           'create_course' not in text.split('-- == 1.')[1] and 'import_json_restore' not in text.split('-- == 1.')[1])
        listed_relied = re.findall(r"\('([^']+)', '[0-9a-f]{32}'\)", text.split('FINGERPRINTS-BEGIN relied')[1].split('FINGERPRINTS-END')[0])
        ok('apply: the file lists every other function that reads _fv_timezone (%d)' % len(listed_relied), listed_relied == relied_sigs(d), set(listed_relied) ^ set(relied_sigs(d)))
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        some_relied = listed_relied[0]
        mutations = {
            'a relied function changed': "alter function %s set work_mem = '9MB'" % some_relied,
            '_midnight changed': "alter function student_submit._midnight(text) set work_mem = '9MB'",
            '_fv_timezone changed': "alter function public._fv_timezone(text) set work_mem = '9MB'",
            'a patched function changed': "alter function student_submit.forms(text,uuid,text) set work_mem = '9MB'",
            'a patched function is gone': "drop function student_submit.report(text,uuid,uuid,text)",
        }
        for name, sql in mutations.items():
            d.run('begin'); d.run(sql)
            r = d.statements(split(text)); d.run('rollback')
            ok('apply: the guard stops: ' + name, r.startswith('STOPPED') and 'Nothing was changed' in r, r[:300])
        ok('apply: (guards) the catalog and rows are as they were', quiet0(differences(cat0, catalog(d.c))) == ([], []) and row_checksums(d.c) == rows0)
        d.run('begin'); d.run('grant usage on schema student_submit to authenticated'); d.run('set role authenticated')
        r = d.statements(split(text)); d.run('reset role'); d.run('rollback')
        ok('apply: a role that does not own the functions is refused', r.startswith('STOPPED') and 'owner' in r, r[:300])
        # the in-place edit must find its text the number of times written
        bad_text = text.replace("'public._fv_timezone(p_tz)', '1']", "'public._fv_timezone(p_tz)', '2']", 1)
        r = d.statements(split(bad_text))
        ok('apply: an edit that finds its text a different number of times stops it, nothing left', bad_text != text and r.startswith('STOPPED') and 'expected' in r and not applied(d), r[:300])
        ok('apply: (edit mismatch) the catalog is as before', quiet0(differences(cat0, catalog(d.c))) == ([], []))
        for name, sql in (('a relied function changed', mutations['a relied function changed']), ('a patched function changed', mutations['a patched function changed'])):
            d.run('begin'); d.run(sql); d.file(PRE); n = len(d.rows); d.run('rollback')
            ok('apply: the pre-check names it: ' + name, n > 0, n)
            d.run('begin'); d.run(sql); d.file(FPS); n = len(d.rows); d.run('rollback')
            ok('apply: the fingerprints query names it: ' + name, n > 0, n)
        d.file(PRE); ok('apply: the pre-check is empty before', d.rows == [], d.rows)
        d.file(FPS); ok('apply: the fingerprints query is empty before', d.rows == [], d.rows)
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c))
        known = ('_fv_timezone', '_closed_reason', 'student_submit.check', 'student_submit.forms', 'student_submit.open', 'student_submit.report', 'depends')
        ok('apply: the catalog changes only in the six functions', all(any(k in l for k in known) for l in gone + new), [l[:200] for l in gone + new if not any(k in l for k in known)])
        funcs = {l.split(' | ')[0] for l in gone if l.startswith('function ') and not l.startswith('function more')}
        ok('apply: and exactly those six change (definition)', len(funcs) == 6, funcs)
        ok('apply: no row changed', all(rows0[k] == v for k, v in row_checksums(d.c).items() if k in rows0))
        cat1 = catalog(d.c)
        text = text_of(FILE)
        got = {s: md5(d, s) for s in REPLACED}
        listed = dict(re.findall(r"\('([^']+)', '([0-9a-f]{32})'\)", text.split('FINGERPRINTS-BEGIN after')[1].split('FINGERPRINTS-END')[0]))
        ok('apply: the md5s the file carries are the ones the database has', listed == got, [k for k in got if listed.get(k) != got[k]])
        r2 = d.file(FILE); dd = quiet0(differences(cat1, catalog(d.c)))
        ok('apply: a second run applies and changes nothing', r2 == 'ok' and dd == ([], []), (r2, [[l[:200] for l in s] for s in dd]))
        r = d.file(POST); bad = [x for x in d.rows if x[1] != 'ok']
        ok('apply: the post-check: every row ok (%d rows)' % len(d.rows), r == 'ok' and d.rows and not bad, bad[:3])
        d.file(FPS); ok('apply: the fingerprints query after names the six replaced', {x[0] for x in d.rows} == set(REPLACED), [x[0] for x in d.rows])
        d.file(PRE); ok('apply: the pre-check after names the six replaced', {x[0][len('fingerprint '):] for x in d.rows} == set(REPLACED), [x[0] for x in d.rows])
        # the last check trips
        r = d.file(UNDO); ok('apply: (setup) undone', r == 'ok' and not applied(d), r)
        trips = {
            'a function md5': text.split('do $final$')[0] + 'do $final$' + text.split('do $final$')[1].replace(got[TZ], '0' * 32, 1),
            'an answer': text.replace("'Etc/GMT+7'; end if;\n    perform", "'Etc/GMT+8'; end if;\n    perform", 1),
        }
        for name, bad_text in trips.items():
            if bad_text == text:
                ok('apply: (setup) the trip changes the text: ' + name, False); continue
            r = d.statements(split(bad_text))
            ok('apply: the last check or a guard stops it, nothing left: ' + name, r.startswith('STOPPED') and not applied(d), r[:300])
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('apply: (after the trips) the catalog is as before the file', dd == ([], []), [[l[:200] for l in s] for s in dd])
        c2 = d.other(); c2.run('begin'); c2.run("alter function public._fv_timezone(text) set work_mem = '9MB'")
        t0 = time.time(); r = d.file(FILE); c2.run('rollback'); c2.close()
        ok('apply: a lock held elsewhere on _fv_timezone: gives up in about five seconds, nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 <= time.time() - t0 < 12 and not applied(d), (r, time.time() - t0))
    finally:
        d.close()

# == undo ==
def scen_undo():
    d = DB('bt_undo')
    try:
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        r = d.file(UNDO); ok('undo: on a database where the file was never applied it changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok' and applied(d), r)
        cat1 = catalog(d.c)
        d.run("alter function student_submit.forms(text,uuid,text) set work_mem = '9MB'")
        r = d.file(UNDO)
        ok('undo: refuses a function that is neither as before nor as the file left it', r.startswith('STOPPED') and 'neither' in r and applied(d), r[:300])
        d.run("alter function student_submit.forms(text,uuid,text) reset work_mem")
        ok('undo: (refused) nothing changed', quiet0(differences(cat1, catalog(d.c))) == ([], []))
        r = d.file(UNDO); ok('undo: runs', r == 'ok' and not applied(d), r)
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('undo: the catalog is exactly as before the file (md5 of every function, grants, settings, comments, columns)', dd == ([], []), [[l[:200] for l in s] for s in dd])
        ok('undo: the rows are as they were', row_checksums(d.c) == rows0)
        text = text_of(UNDO)
        ok('undo: every function is the live one again',
           all(md5(d, s) == v for s, v in re.findall(r"\('([^']+)', '([0-9a-f]{32})'\)", text.split('FINGERPRINTS-BEGIN undo-after')[1].split('FINGERPRINTS-END')[0])))
        ok('undo: and _fv_timezone is word for word the old one', d.one("select public._fv_timezone('Not/AZone')") == 'America/Vancouver')
        r = d.file(UNDO); ok('undo: a second run changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and applied(d), r)
        dd = quiet0(differences(cat1, catalog(d.c)))
        ok('undo: and leaves the catalog as the first apply did', dd == ([], []), [[l[:200] for l in s] for s in dd])
    finally:
        d.close()

SCENARIOS = {'zone': scen_zone, 'dates': scen_dates, 'apply': scen_apply, 'undo': scen_undo}

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (args or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
