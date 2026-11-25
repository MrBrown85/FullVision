"""A phone report link's last day, read in the class's BC day: migrations/2026112412_phone_report_expiry_bc_day.sql
on a database rebuilt from the repo (scripts/db-rebuild.mjs --check) with 2026112411 applied, as live is
(README.md, "Phone report last day in BC's day").

    PGPORT=<port> PGDATABASE=<db> python3 phone_report_expiry.py fingerprints   write the md5 lists the files carry
    PGPORT=<port> PGDATABASE=<db> python3 phone_report_expiry.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 phone_report_expiry.py clock         or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  clock     the clock pinned: a copy of each function with now() replaced by a clock the test sets. Before the
            file (with current_date read as a UTC session reads it): at 00:30 UTC on Nov 25 (5:30 p.m. Nov 24 BC)
            Nov 24 is refused, which is the fault. After: at that instant Nov 24 is accepted and Nov 23 refused;
            at 07:30 UTC Nov 25 (00:30 Nov 25 BC) Nov 24 is refused and Nov 25 accepted; the last second before
            and the first second after BC midnight; another class zone (Toronto), a blank and an unknown zone; both
            functions. The real clock and the real functions: BC's day accepted and the day before refused, in
            session time zones UTC, Vancouver and Pacific/Kiritimati.
  apply     the guards stop with the catalog unchanged (including 2026112411 not applied); only the two
            functions change, and _fv_timezone only by one grant (to authenticated: the teacher runs these); the md5s the file carries; a second run; the three read-only files; a lock
            held elsewhere; plain ASCII, no backslash.
  undo      leaves the catalog as before the file, byte for byte; a second run; the file again.
"""
import json, os, re, sys, time
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, ok, finish, split, text_of, A, B, nid
from catalog import catalog, differences, row_checksums

FILE = '../2026112412_phone_report_expiry_bc_day.sql'
PREV = '../2026112411_bc_time_utc_minus_7.sql'
PREV_UNDO = 'bc-time-undo.sql'
UNDO = 'phone-report-expiry-undo.sql'
PRE = 'phone-report-expiry-live-precheck.sql'
POST = 'phone-report-expiry-live-postcheck.sql'
FPS = 'phone-report-expiry-live-fingerprints.sql'

TZ = 'public._fv_timezone(text)'
CREATE = 'public.create_phone_report(uuid,integer,text,date,jsonb,uuid)'
UPDATE = 'public.update_phone_report(uuid,jsonb,date,uuid)'
ISSUE = 'student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'
REPLACED = [CREATE, UPDATE, ISSUE]

def DB(tag):
    d = Db(tag)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    return d
def quiet0(diff):
    return tuple([l for l in side if not l.startswith(('depends', 'dropped columns'))] for side in diff)
def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def defn(d, sig): return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
def applied(d): return 'current_date' not in defn(d, CREATE)
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
def lists(text, name):
    return re.findall(r"\('([^']+)', '([0-9a-f]{32})'\)", text.split('FINGERPRINTS-BEGIN ' + name)[1].split('FINGERPRINTS-END')[0])

# == The md5 lists the files carry ==
def scen_fingerprints():
    d = Db('pe_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        if 'Etc/GMT+7' not in defn(d, TZ): sys.exit('the template does not have 2026112411: apply it to the template first')
        relied = {TZ: md5(d, TZ)}
        before = {s: md5(d, s) for s in REPLACED}
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
        open(p, 'w').write(t)
        print('written: relied %d, replaced %d' % (len(relied), len(before)))
    finally:
        d.close()

COURSES = {'bc': ('aaaaaaaa-0000-0000-0000-0000000000b1', 'America/Vancouver'),
           'toronto': ('aaaaaaaa-0000-0000-0000-0000000000b2', 'America/Toronto'),
           'blank': ('aaaaaaaa-0000-0000-0000-0000000000b3', ''),
           'garbage': ('aaaaaaaa-0000-0000-0000-0000000000b4', 'Not/AZone')}
def seed(d):
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.teacher("bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", uid=A)
    d.teacher("bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", uid=B)
    for k, (cid, tz) in COURSES.items():
        d.run("insert into course (id, teacher_id, name, timezone) values (:c, :t, :n, :z)", c=cid, t=A, n='Class ' + k, z=tz)
def refused(fn):
    try:
        fn(); return None
    except Exception as e:
        return str(e.args[0].get('M') if e.args and isinstance(e.args[0], dict) else e), str(e.args[0].get('C') if e.args and isinstance(e.args[0], dict) else '')
MSG = 'the last day must be today or later'

def clock_copies(d, bug):
    """Copies of the two functions on a clock the test sets. bug=True reads current_date the way a UTC session does."""
    d.run("create or replace function public._bc_now() returns timestamptz language sql stable as $$ select current_setting('bctest.now')::timestamptz $$")
    d.run('grant execute on function public._bc_now() to public')
    for sig, name in ((CREATE, 'create_phone_report'), (UPDATE, 'update_phone_report')):
        body = defn(d, sig).replace('FUNCTION public.%s(' % name, 'FUNCTION public._bt_%s(' % name, 1)
        body = re.sub(r'(?<![\w.])now\(\)', 'public._bc_now()', body)
        if bug: body = body.replace('current_date', "(public._bc_now() at time zone 'UTC')::date")
        ok('clock: (setup) the copy of %s differs only in its name and its clock' % name,
           body != defn(d, sig) and ('current_date' not in body if not bug else True) and 'public._bc_now()' in body)
        d.run(body)
        d.run('grant execute on function public._bt_%s to authenticated' % name)
def at(d, t): d.run("select set_config('bctest.now', :t, false)", t=t)
def try_create(d, course, day):
    return refused(lambda: d.teacher("public._bt_create_phone_report(:c, 1, 'T', (:e)::date, '[]'::jsonb, null)", c=COURSES[course][0], e=day))
def try_update(d, rid, day):
    return refused(lambda: d.teacher("public._bt_update_phone_report(:r, '[]'::jsonb, (:e)::date, null)", r=rid, e=day))
def is_refusal(r): return r is not None and MSG in r[0] and r[1] == '22023'

def slip_world(d):
    """A student in the BC class, a report sent to them, and one code row for that report (as issue_slips leaves it)."""
    e = d.teacher("create_student_and_enroll(:c, 'Cece', 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())->>'enrollment_id'", c=COURSES['bc'][0])
    return e
def slip_expiry(d, rid, e):
    return d.one("select to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from student_access_code where phone_report_id = :r and enrollment_id = :e and revoked_at is null", r=rid, e=e)
def tag(): return (nid() + nid()).replace('-', '')[:64]
def issue(d, rid, e, tz):
    d.run("select set_config('timezone', :z, false)", z=tz)
    r = d.service("student_submit.issue_slips(:t, 'report', :r, :i::jsonb, 'abcd1234', :k)", t=A, r=rid,
                  i=json.dumps([{'enrollment_id': e, 'candidates': [{'code_hmac': tag(), 'pw_hmac': tag()}, {'code_hmac': tag(), 'pw_hmac': tag()}]}]), k=nid())
    return r

def scen_clock():
    d = Db('pe_clock')
    try:
        seed(d)
        T1 = '2026-11-25 00:30:00+00'     # 5:30 p.m. Nov 24 in BC
        T2 = '2026-11-25 07:30:00+00'     # 00:30 Nov 25 in BC
        # The card's end, before the file: midnight in the session's zone.
        enr = slip_world(d)
        today_bc = d.one("select (now() at time zone 'Etc/GMT+7')::date::text")
        last = d.one("select ((now() at time zone 'Etc/GMT+7')::date + 5)::text")
        nextday = d.one("select ((:l)::date + 1)::text", l=last)
        d.run("select set_config('timezone', 'UTC', false)")
        rid0 = d.teacher("create_phone_report(:c, 1, 'R', (:l)::date, :s::jsonb, null)->>'id'", c=COURSES['bc'][0], l=last, s=json.dumps([{'enrollment_id': enr, 'data': {}}]))
        issue(d, rid0, enr, 'UTC')
        before = slip_expiry(d, rid0, enr)
        ok('clock: BEFORE the file, a UTC session makes the card end at 00:00 UTC (5 p.m. BC) on the day after the last day (the fault)', before == nextday + ' 00:00', before)
        old_def = defn(d, CREATE)
        ok('clock: before the file, each function compares with current_date, once, and has no now()',
           old_def.count('current_date') == 1 and 'now()' not in old_def and defn(d, UPDATE).count('current_date') == 1)
        clock_copies(d, bug=True); at(d, T1)
        ok('clock: BEFORE the file, at 5:30 p.m. Nov 24 BC (00:30 UTC) create refuses Nov 24 (the fault)', is_refusal(try_create(d, 'bc', '2026-11-24')), try_create(d, 'bc', '2026-11-24'))
        ok('clock: and BEFORE, create accepts Nov 25', try_create(d, 'bc', '2026-11-25') is None)
        rid = d.teacher("public._bt_create_phone_report(:c, 1, 'T', '2026-12-31'::date, '[]'::jsonb, null)->>'id'", c=COURSES['bc'][0])
        ok('clock: BEFORE, update refuses Nov 24 at 5:30 p.m. Nov 24 BC (the fault)', is_refusal(try_update(d, rid, '2026-11-24')), try_update(d, rid, '2026-11-24'))
        d.run('drop function public._bt_create_phone_report(uuid,integer,text,date,jsonb,uuid)')
        d.run('drop function public._bt_update_phone_report(uuid,jsonb,date,uuid)')
        r = d.file(FILE); ok('clock: the file applies', r == 'ok' and applied(d), r)
        if r != 'ok': return
        clock_copies(d, bug=False)
        reports = {}
        for k in COURSES:
            at(d, '2026-11-01 12:00:00+00')
            reports[k] = d.teacher("public._bt_create_phone_report(:c, 1, 'T', '2027-01-31'::date, '[]'::jsonb, null)->>'id'", c=COURSES[k][0])
        def both(label, course, t, day, accept):
            at(d, t)
            rc = try_create(d, course, day); ru = try_update(d, reports[course], day)
            good = (rc is None and ru is None) if accept else (is_refusal(rc) and is_refusal(ru))
            ok('clock: %s: %s %s by create and by update' % (label, day, 'accepted' if accept else 'refused'), good, (rc, ru))
        both('00:30 UTC Nov 25 (5:30 p.m. Nov 24 BC)', 'bc', T1, '2026-11-24', True)
        both('00:30 UTC Nov 25 (5:30 p.m. Nov 24 BC)', 'bc', T1, '2026-11-23', False)
        both('00:30 UTC Nov 25 (5:30 p.m. Nov 24 BC)', 'bc', T1, '2026-11-25', True)
        both('07:30 UTC Nov 25 (00:30 Nov 25 BC)', 'bc', T2, '2026-11-24', False)
        both('07:30 UTC Nov 25 (00:30 Nov 25 BC)', 'bc', T2, '2026-11-25', True)
        both('06:59:59 UTC Nov 25 (11:59:59 p.m. Nov 24 BC)', 'bc', '2026-11-25 06:59:59+00', '2026-11-24', True)
        both('07:00:00 UTC Nov 25 (midnight BC)', 'bc', '2026-11-25 07:00:00+00', '2026-11-24', False)
        both('07:00:00 UTC Nov 25 (midnight BC)', 'bc', '2026-11-25 07:00:00+00', '2026-11-25', True)
        both('a summer day, 06:59 UTC Jul 15 (11:59 p.m. Jul 14 BC)', 'bc', '2026-07-15 06:59:00+00', '2026-07-14', True)
        both('a summer day, 07:00 UTC Jul 15 (midnight BC)', 'bc', '2026-07-15 07:00:00+00', '2026-07-14', False)
        both('class in America/Toronto, 00:30 UTC Nov 25 (7:30 p.m. Nov 24 there)', 'toronto', T1, '2026-11-24', True)
        both('class in America/Toronto, 05:30 UTC Nov 25 (00:30 Nov 25 there)', 'toronto', '2026-11-25 05:30:00+00', '2026-11-24', False)
        for k in ('blank', 'garbage'):
            both('class with a %s zone reads as BC, 00:30 UTC Nov 25' % k, k, T1, '2026-11-24', True)
            both('class with a %s zone reads as BC, 07:30 UTC Nov 25' % k, k, T2, '2026-11-24', False)
        # A teacher cannot reach another teacher's class by this: the ownership check still comes first.
        at(d, T1)
        e = refused(lambda: d.teacher("public._bt_create_phone_report(:c, 1, 'T', '2026-11-24'::date, '[]'::jsonb, null)", uid=B, c=COURSES['bc'][0]))
        ok("clock: another teacher's class is still 'course not found'", e is not None and 'course not found' in e[0], e)
        e = refused(lambda: d.teacher("public._bt_update_phone_report(:r, '[]'::jsonb, '2026-11-24'::date, null)", uid=B, r=reports['bc']))
        ok("clock: and another teacher's report is still 'report not found'", e is not None and 'report not found' in e[0], e)
        # What an accepted update does is unchanged: the report's day is stored as given.
        at(d, T1); d.teacher("public._bt_update_phone_report(:r, '[]'::jsonb, '2026-11-24'::date, null)", r=reports['bc'])
        ok('clock: an accepted update stores the day given', d.one('select expires_on::text from phone_report where id = :r', r=reports['bc']) == '2026-11-24')
        # The card's end, after the file: the start of the next BC day, 07:00 UTC, in any session zone.
        for z in ('UTC', 'America/Vancouver', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'):
            d.run("select set_config('timezone', :z, false)", z=z)
            rid = d.teacher("create_phone_report(:c, 1, 'R', (:l)::date, :s::jsonb, null)->>'id'", c=COURSES['bc'][0], l=last, s=json.dumps([{'enrollment_id': enr, 'data': {}}]))
            got = issue(d, rid, enr, z)['results'][0]
            ok('clock: session zone %s: issue_slips made the card' % z, got['result'] == 'made', got)
            ok('clock: session zone %s: the new card ends at 07:00 UTC the day after the last day (midnight BC)' % z, slip_expiry(d, rid, enr) == nextday + ' 07:00', slip_expiry(d, rid, enr))
            d.run("select set_config('timezone', :z, false)", z=z)
            newlast = d.one("select ((:l)::date + 2)::text", l=last)
            d.teacher("update_phone_report(:r, '[]'::jsonb, (:n)::date, null)", r=rid, n=newlast)
            want = d.one("select ((:n)::date + 1)::text", n=newlast) + ' 07:00'
            ok('clock: session zone %s: update_phone_report moves the card to 07:00 UTC the day after the new last day' % z, slip_expiry(d, rid, enr) == want, slip_expiry(d, rid, enr))
        # a Toronto class: midnight in Toronto, not BC
        d.run("select set_config('timezone', 'UTC', false)")
        etor = d.teacher("create_student_and_enroll(:c, 'Tor', 'Onto', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())->>'enrollment_id'", c=COURSES['toronto'][0])
        ridt = d.teacher("create_phone_report(:c, 1, 'R', (:l)::date, :s::jsonb, null)->>'id'", c=COURSES['toronto'][0], l=last, s=json.dumps([{'enrollment_id': etor, 'data': {}}]))
        issue(d, ridt, etor, 'UTC')
        want = d.one("select to_char(((:l)::date + 1)::timestamp at time zone 'America/Toronto' at time zone 'UTC', 'YYYY-MM-DD HH24:MI')", l=last)
        ok('clock: a Toronto class: the card ends at midnight Toronto (%s UTC)' % want, slip_expiry(d, ridt, etor) == want, slip_expiry(d, ridt, etor))
        d.run("select set_config('timezone', 'UTC', false)")
        # The real functions on the real clock, whatever time it is and whatever the session's zone.
        for z in ('UTC', 'America/Vancouver', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'):
            d.run("select set_config('timezone', :z, false)", z=z)
            today = d.one("select (now() at time zone 'Etc/GMT+7')::date::text")
            good = d.teacher("create_phone_report(:c, 1, 'R', (:t)::date, '[]'::jsonb, null)->>'id'", c=COURSES['bc'][0], t=today)
            ok('clock: real clock, session zone %s: create accepts BC today (%s)' % (z, today), bool(good))
            e = refused(lambda: d.teacher("create_phone_report(:c, 1, 'R', ((:t)::date - 1), '[]'::jsonb, null)", c=COURSES['bc'][0], t=today))
            ok('clock: real clock, session zone %s: create refuses the day before' % z, is_refusal(e), e)
            ok('clock: real clock, session zone %s: update accepts BC today' % z, refused(lambda: d.teacher("update_phone_report(:r, '[]'::jsonb, (:t)::date, null)", r=good, t=today)) is None)
            e = refused(lambda: d.teacher("update_phone_report(:r, '[]'::jsonb, ((:t)::date - 1), null)", r=good, t=today))
            ok('clock: real clock, session zone %s: update refuses the day before' % z, is_refusal(e), e)
        d.run("select set_config('timezone', 'UTC', false)")
    finally:
        d.close()

def scen_apply():
    d = DB('pe_apply')
    try:
        text = text_of(FILE)
        ok('apply: plain ASCII, no backslash, no unicode escape', text.isascii() and chr(92) not in text and 'u&' not in text.lower())
        ok('apply: small enough to send whole (under 50 KB)', len(text.encode()) < 50000, len(text.encode()))
        for fn in (UNDO, PRE, POST, FPS):
            t = text_of(fn); ok('apply: %s is plain ASCII, no backslash' % fn, t.isascii() and chr(92) not in t)
        ok('apply: the file reads and writes no row (no insert, update or delete outside the function text)',
           not re.search(r'(?im)^\s*(insert|delete|truncate)\b', text) and not re.search(r'(?im)^\s*update\s', text))
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        mutations = {
            '_fv_timezone changed': "alter function public._fv_timezone(text) set work_mem = '9MB'",
            'create_phone_report changed': "alter function public.create_phone_report(uuid,integer,text,date,jsonb,uuid) set work_mem = '9MB'",
            'update_phone_report changed': "alter function public.update_phone_report(uuid,jsonb,date,uuid) set work_mem = '9MB'",
            'issue_slips changed': "alter function student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid) set work_mem = '9MB'",
            'update_phone_report is gone': "drop function public.update_phone_report(uuid,jsonb,date,uuid)",
            'course has no timezone column': "alter table course rename column timezone to tz_gone",
        }
        for name, sql in mutations.items():
            d.run('begin'); d.run(sql)
            r = d.statements(split(text)); d.run('rollback')
            ok('apply: the guard stops: ' + name, r.startswith('STOPPED') and 'Nothing was changed' in r, r[:300])
        ok('apply: (guards) the catalog and rows are as they were', quiet0(differences(cat0, catalog(d.c))) == ([], []) and row_checksums(d.c) == rows0)
        d.run('begin'); d.run('grant usage on schema student_submit to authenticated'); d.run('set role authenticated')
        r = d.statements(split(text)); d.run('reset role'); d.run('rollback')
        ok('apply: a role that does not own the functions is refused', r.startswith('STOPPED') and 'owner' in r, r[:300])
        bad_text = text.replace("'p_expires_on < current_date',\n          'p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = p_course_id)))::date', '1']",
                                "'p_expires_on < current_date',\n          'p_expires_on < (now() at time zone public._fv_timezone((select c.timezone from public.course c where c.id = p_course_id)))::date', '2']", 1)
        r = d.statements(split(bad_text))
        ok('apply: an edit that finds its text a different number of times stops it, nothing left', bad_text != text and r.startswith('STOPPED') and 'expected' in r and not applied(d), r[:300])
        ok('apply: (edit mismatch) the catalog is as before', quiet0(differences(cat0, catalog(d.c))) == ([], []))
        # 2026112411 not applied: take it off a copy and the file stops, naming it
        d2 = Db('pe_prev')
        try:
            r0 = d2.file(PREV_UNDO); r = d2.statements(split(text))
            ok('apply: without 2026112411 the guard stops, naming it', r0 == 'ok' and r.startswith('STOPPED') and '2026112411' in r and not applied(d2), (r0, r[:300]))
        finally:
            d2.close()
        for name in ('create_phone_report changed', 'issue_slips changed', '_fv_timezone changed'):
            sql = mutations[name]
            d.run('begin'); d.run(sql); d.file(PRE); n = len(d.rows); d.run('rollback')
            ok('apply: the pre-check names it: ' + name, n > 0, n)
            d.run('begin'); d.run(sql); d.file(FPS); n = len(d.rows); d.run('rollback')
            ok('apply: the fingerprints query names it: ' + name, n > 0, n)
        d.file(PRE); ok('apply: the pre-check is empty before', d.rows == [], d.rows)
        d.file(FPS); ok('apply: the fingerprints query is empty before', d.rows == [], d.rows)
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c))
        known = ('create_phone_report', 'update_phone_report', 'issue_slips', '_fv_timezone', 'depends')
        ok('apply: the catalog changes only in the three functions and the grant on _fv_timezone', all(any(k in l for k in known) for l in gone + new), [l[:200] for l in gone + new if not any(k in l for k in known)])
        funcs = {l.split(' | ')[0] for l in gone if l.startswith('function ') and not l.startswith('function more')}
        ok('apply: and exactly those four change (the three definitions, and _fv_timezone only by its grant)', len(funcs) == 4, funcs)
        ok('apply: _fv_timezone itself is byte for byte as before (md5) and only authenticated was added to its grants',
           md5(d, TZ) == dict(lists(text, 'relied'))[TZ] and d.one("select proacl::text from pg_proc where oid = to_regprocedure('public._fv_timezone(text)')").count('authenticated=X/postgres') == 1
           and 'anon' not in d.one("select proacl::text from pg_proc where oid = to_regprocedure('public._fv_timezone(text)')"))
        ok('apply: no row changed', all(rows0[k] == v for k, v in row_checksums(d.c).items() if k in rows0))
        cat1 = catalog(d.c)
        got = {s: md5(d, s) for s in REPLACED}
        ok('apply: the md5s the file carries are the ones the database has', dict(lists(text, 'after')) == got, got)
        ok('apply: and the before md5s are the ones the file was tested against', [b for _, b, _ in re.findall(r"\('([^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)", text.split('FINGERPRINTS-BEGIN replaces')[1].split('FINGERPRINTS-END')[0])] != [])
        r2 = d.file(FILE); dd = quiet0(differences(cat1, catalog(d.c)))
        ok('apply: a second run applies and changes nothing', r2 == 'ok' and dd == ([], []), (r2, [[l[:200] for l in s] for s in dd]))
        r = d.file(POST); bad = [x for x in d.rows if x[1] != 'ok']
        ok('apply: the post-check: every row ok (%d rows)' % len(d.rows), r == 'ok' and d.rows and not bad, bad[:3])
        d.file(FPS); ok('apply: the fingerprints query after names the three replaced', {x[0] for x in d.rows} == set(REPLACED), [x[0] for x in d.rows])
        d.file(PRE); ok('apply: the pre-check after names the three replaced', {x[0][len('fingerprint '):] for x in d.rows} == set(REPLACED), [x[0] for x in d.rows])
        r = d.file(UNDO); ok('apply: (setup) undone', r == 'ok' and not applied(d), r)
        trips = {
            'a function md5': text.split('do $final$')[0] + 'do $final$' + text.split('do $final$')[1].replace(got[CREATE], '0' * 32, 1),
            'a grant': text.replace("'authenticated, service_role' then", "'authenticated' then", 1),
        }
        for name, bad_text in trips.items():
            if bad_text == text:
                ok('apply: (setup) the trip changes the text: ' + name, False); continue
            r = d.statements(split(bad_text))
            ok('apply: the last check stops it, nothing left: ' + name, r.startswith('STOPPED') and not applied(d), r[:300])
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('apply: (after the trips) the catalog is as before the file', dd == ([], []), [[l[:200] for l in s] for s in dd])
        c2 = d.other(); c2.run('begin'); c2.run("alter function public.update_phone_report(uuid,jsonb,date,uuid) set work_mem = '9MB'")
        t0 = time.time(); r = d.file(FILE); c2.run('rollback'); c2.close()
        ok('apply: a lock held elsewhere on update_phone_report: gives up in about five seconds, nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 <= time.time() - t0 < 12 and not applied(d), (r, time.time() - t0))
    finally:
        d.close()

def scen_undo():
    d = DB('pe_undo')
    try:
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        before = {s: md5(d, s) for s in REPLACED}
        r = d.file(UNDO); ok('undo: on a database where the file was never applied it changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok' and applied(d), r)
        cat1 = catalog(d.c)
        d.run("alter function public.update_phone_report(uuid,jsonb,date,uuid) set work_mem = '9MB'")
        r = d.file(UNDO)
        ok('undo: refuses a function that is neither as before nor as the file left it', r.startswith('STOPPED') and 'neither' in r and applied(d), r[:300])
        d.run("alter function public.update_phone_report(uuid,jsonb,date,uuid) reset work_mem")
        ok('undo: (refused) nothing changed', quiet0(differences(cat1, catalog(d.c))) == ([], []))
        r = d.file(UNDO); ok('undo: runs', r == 'ok' and not applied(d), r)
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('undo: the catalog is exactly as before the file (md5 of every function, grants, settings, comments, columns)', dd == ([], []), [[l[:200] for l in s] for s in dd])
        ok('undo: the rows are as they were', row_checksums(d.c) == rows0)
        ok('undo: both functions are byte for byte the ones before (md5)', {s: md5(d, s) for s in REPLACED} == before == dict(lists(text_of(UNDO), 'undo-after')))
        r = d.file(UNDO); ok('undo: a second run changes nothing', r == 'ok' and quiet0(differences(cat0, catalog(d.c))) == ([], []), r)
        r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and applied(d), r)
        dd = quiet0(differences(cat1, catalog(d.c)))
        ok('undo: and leaves the catalog as the first apply did', dd == ([], []), [[l[:200] for l in s] for s in dd])
    finally:
        d.close()

SCENARIOS = {'clock': scen_clock, 'apply': scen_apply, 'undo': scen_undo}

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (args or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
