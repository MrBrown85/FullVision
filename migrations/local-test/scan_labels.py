"""Sticker codes: migrations/2026111710_scan_labels.sql on a database rebuilt from the repo and proved equal to
live (scripts/db-rebuild.mjs --check; README.md, "Sticker codes").

    PGPORT=<port> PGDATABASE=<db> python3 scan_labels.py           every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 scan_labels.py issue     or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped
here. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  issue    issue_scan_labels as Teacher A: every student not withdrawn gets one code, twelve characters of the
           alphabet, all different; a withdrawn student gets none; a second call adds nothing and answers the
           same codes; a student added later gets one on the next call and the others keep theirs; a key sent
           twice answers the first reply and writes nothing; an empty class answers an empty list.
  reissue  reissue_scan_label: the old code is retired, a new one is live, list shows both; a key sent twice
           makes one new code, not two; a student who never had a code gets a first one; a withdrawn student
           answers null and keeps the code as it was; issue after a reissue changes nothing.
  list     list_scan_labels: live and retired, in class-list order; a withdrawn student's code is listed; an
           empty class and a class with no codes answer an empty list; it writes nothing.
  others   Teacher B's class and student, a class in the trash and ids that do not exist: the three functions
           answer empty, change nothing and raise no error; signed out is PT401; a visitor may run none of
           them; a teacher and the edge functions' role can neither read nor write the table, nor call the
           code-drawing function; no function of the student page names the table.
  cascade  Deleting a withdrawn student for good, and purging a class from the trash, take their codes along;
           the other class's codes stay.
  taken    A code that is already taken is drawn again (the draw is forced to repeat); five in a row fail and
           add nothing; a student who already has a live code is answered that code and no second row is made;
           a code outside the alphabet or a second live code for one student is refused by the table itself;
           1,500 of the function's own draws all differ and every place shows all 32 characters.
  race     Two issue calls for one class on connections of their own: every student ends with exactly one live
           code and both calls answer the same codes. Two reissues for one student: one live code at the end.
  missing  A relied-on function that is missing altogether stops the file, catalog unchanged, named by the pre-check.
  defaults With Supabase's default privileges in place the file still leaves the grants exact.
  apply    The guards stop with the catalog unchanged; the file changes only what its header says; no existing
           row changes and the table starts empty; a second run; the header's md5s; pre-check and post-check;
           lock timeout; the file's size.
  undo     PART 1 alone takes the functions from teachers and keeps every code; the file again gives them back;
           the full undo leaves the catalog and every row as before the file; a changed function stops it; a
           second run; on a database without the file it changes nothing; the file applies again.
"""
import json, os, re, sys, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, ok, finish, nid, connect, message, sqlstate, split, text_of
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111710_scan_labels.sql'
UNDO = 'scan-labels-undo.sql'
PRE = 'scan-labels-live-precheck.sql'
POST = 'scan-labels-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
LIST = 'public.list_scan_labels(uuid)'; ISSUE = 'public.issue_scan_labels(uuid,uuid)'
REISSUE = 'public.reissue_scan_label(uuid,uuid)'; NEW = 'fv_private.scan_label_new(uuid)'
OURS = [LIST, ISSUE, REISSUE, NEW]
RELIED = ['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)', 'public.fv_idem_check(uuid,text)',
          'public.fv_idem_store(uuid,text,jsonb)']
CODE = re.compile(r'^[2-9A-HJ-NP-Z]{12}$')
HEADER = text_of(FILE)

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def applied(d): return d.one("select to_regclass('public.scan_label') is not null")
def header_md5s():
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    relied = dict(re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})$', HEADER, re.M))
    return new, relied
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]
def rows(d): return d.all('select enrollment_id::text, code, retired_at is not null from scan_label order by created_at, id')
def live(d, e): return d.all('select code from scan_label where enrollment_id = :e and retired_at is null', e=e)
def refusal(fn):
    """(sqlstate, message) of what fn raises, or None."""
    try: fn()
    except Exception as e: return (sqlstate(e), message(e))
    return None

class W: pass

def world(tag, with_file=True, students=('Avery', 'Blake', 'Casey', 'Devon')):
    """Teacher A with one class of four students (the last withdrawn), an empty class and a class in the
    trash; Teacher B with one class of one student."""
    d = Db('sl_' + tag)
    w = W(); w.d = d
    if applied(d):
        # Once the file is applied and the baseline refreshed, a rebuilt database already has it. The full
        # undo, proven by scenario undo to leave the catalog as before, gives the database from before.
        r = d.file(UNDO)
        if r != 'ok' or applied(d): sys.exit('could not take the template back to before the file: %s' % r)
    # The stand-in for pg_cron's table lacks three columns catalog.py reads.
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    def course(name, uid=A):
        return str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    def student(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_idempotency_key => gen_random_uuid())", uid, c=c, f=first)['enrollment_id'])
    w.c = course('Science 8'); w.e = [student(w.c, f) for f in students]
    for n, e in enumerate(w.e): d.run('update enrollment set roster_position = :n where id = :e', n=n, e=e)
    w.gone = w.e[-1]; w.here = w.e[:-1]
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    w.empty = course('Empty Class')
    w.trash = course('In the Trash'); w.et = student(w.trash, 'Tracy')
    w.cb = course('Bravo Socials', B); w.eb = student(w.cb, 'Bailey', B)
    d.run("update course set deleted_at = now() - interval '1 day' where id = :c", c=w.trash)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def issue(w, c=None, uid=A, key=None):
    return T(w.d, 'issue_scan_labels(:c, :k)', uid, c=c or w.c, k=key)['labels']
def reissue(w, e, uid=A, key=None):
    return T(w.d, 'reissue_scan_label(:e, :k)', uid, e=e, k=key)['label']
def listed(w, c=None, uid=A):
    return T(w.d, 'list_scan_labels(:c)', uid, c=c or w.c)['labels']

def scen_issue():
    w = world('issue'); d = w.d
    got = issue(w)
    ok('issue: one code for each student not withdrawn, in class-list order', [x['enrollment_id'] for x in got] == w.here, got)
    ok('issue: each code is twelve characters of the alphabet', all(CODE.match(x['code']) for x in got), got)
    ok('issue: every code is different', len({x['code'] for x in got}) == len(got), got)
    ok('issue: the reply holds only the student and the code', all(sorted(x) == ['code', 'enrollment_id'] for x in got), got)
    ok('issue: the withdrawn student gets none', live(d, w.gone) == [], live(d, w.gone))
    ok('issue: three rows, none retired', [r[2] for r in rows(d)] == [False] * 3, rows(d))
    before = rows(d)
    again = issue(w)
    ok('issue: a second call answers the same codes', again == got, again)
    ok('issue: a second call adds no row', rows(d) == before, rows(d))
    # A student added later.
    e5 = str(T(d, "create_student_and_enroll(:c, 'Emery', 'Tester', p_idempotency_key => gen_random_uuid())", c=w.c)['enrollment_id'])
    d.run('update enrollment set roster_position = 9 where id = :e', e=e5)
    third = issue(w)
    ok('issue: a student added later gets a code on the next call', [x['enrollment_id'] for x in third] == w.here + [e5], third)
    ok('issue: the others keep their codes', third[:3] == got, third)
    # A key sent twice.
    key = nid(); n = len(rows(d))
    d.run('update scan_label set retired_at = now() where enrollment_id = :e', e=w.here[0])   # so a real second run would add a row
    first = issue(w, key=key); n1 = len(rows(d))
    second = issue(w, key=key)
    ok('issue: a call that had work to do added one row', n1 == n + 1, (n, n1))
    ok('issue: the same key again answers the first reply', second == first, second)
    ok('issue: the same key again writes nothing', len(rows(d)) == n1, len(rows(d)))
    ok('issue: an empty class answers an empty list', issue(w, w.empty) == [], issue(w, w.empty))
    # A withdrawn student who comes back gets a code on the next call.
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone)
    back = issue(w)
    ok('issue: a student who comes back gets a code', w.gone in [x['enrollment_id'] for x in back], back)
    cur = lambda: row_checksums(d.c, table_columns(d.c)).get('public.course_sync_cursor')
    c0 = cur(); n0 = len(rows(d))
    d.run('update scan_label set retired_at = now() where enrollment_id = :e and retired_at is null', e=w.here[1])
    issue(w); reissue(w, w.here[2])
    ok('issue: (setup) that issue and reissue each made a code', len(rows(d)) == n0 + 2, (n0, len(rows(d))))
    ok('issue: no sync cursor moves (no other device loads the class again)', c0 is not None and cur() == c0, (c0, cur()))
    d.close()

def scen_reissue():
    w = world('reissue'); d = w.d
    got = {x['enrollment_id']: x['code'] for x in issue(w)}
    e = w.here[1]; old = got[e]
    new = reissue(w, e)
    ok('reissue: answers the student and a new code', new['enrollment_id'] == e and CODE.match(new['code']) and new['code'] != old, new)
    ok('reissue: the new code is the live one', live(d, e) == [[new['code']]], live(d, e))
    ok('reissue: the old code is kept, retired', d.one('select retired_at is not null from scan_label where code = :c', c=old) is True)
    ls = listed(w)
    ok('reissue: list shows the old code as retired and the new as live',
       {'enrollment_id': e, 'code': old, 'retired': True} in ls and {'enrollment_id': e, 'code': new['code'], 'retired': False} in ls, ls)
    ok('reissue: the other students keep their codes', all(live(d, x) == [[got[x]]] for x in w.here if x != e))
    # A key sent twice.
    key = nid(); n = len(rows(d))
    a = reissue(w, e, key=key); b = reissue(w, e, key=key)
    ok('reissue: the same key again answers the first reply', a == b and a['code'] != new['code'], (a, b))
    ok('reissue: the same key again makes one new code, not two', len(rows(d)) == n + 1, len(rows(d)))
    ok('reissue: still one live code', live(d, e) == [[a['code']]], live(d, e))
    # No key: each call is a new sheet.
    c1 = reissue(w, e); c2 = reissue(w, e)
    ok('reissue: with no key each call makes a new code', c1['code'] != c2['code'] and live(d, e) == [[c2['code']]], (c1, c2))
    # A student who never had a code.
    e5 = str(T(d, "create_student_and_enroll(:c, 'Emery', 'Tester', p_idempotency_key => gen_random_uuid())", c=w.c)['enrollment_id'])
    f = reissue(w, e5)
    ok('reissue: a student who never had a code gets a first one', f['enrollment_id'] == e5 and live(d, e5) == [[f['code']]], f)
    # Withdrawn.
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone); wd = reissue(w, w.gone)['code']
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone); before = rows(d)
    ok('reissue: a withdrawn student answers null', reissue(w, w.gone) is None)
    ok('reissue: and the code they had is left as it was', rows(d) == before and live(d, w.gone) == [[wd]])
    before = rows(d)
    after_issue = {x['enrollment_id']: x['code'] for x in issue(w)}
    ok('reissue: issue afterwards changes nothing and answers the new codes', rows(d) == before and after_issue[e] == c2['code'], after_issue)
    d.close()

def scen_list():
    w = world('list'); d = w.d
    ok('list: a class with no codes answers an empty list', listed(w) == [], listed(w))
    got = issue(w)
    r = reissue(w, w.here[0])
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone); gone = reissue(w, w.gone)
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    cat = catalog(d.c); sums = row_checksums(d.c, table_columns(d.c))
    ls = listed(w)
    want = [{'enrollment_id': w.here[0], 'code': got[0]['code'], 'retired': True},
            {'enrollment_id': w.here[0], 'code': r['code'], 'retired': False},
            {'enrollment_id': w.here[1], 'code': got[1]['code'], 'retired': False},
            {'enrollment_id': w.here[2], 'code': got[2]['code'], 'retired': False},
            {'enrollment_id': w.gone, 'code': gone['code'], 'retired': False}]
    ok('list: live and retired, in class-list order, the withdrawn student included', ls == want, ls)
    ok('list: an empty class answers an empty list', listed(w, w.empty) == [], listed(w, w.empty))
    ok('list: it writes nothing', catalog(d.c) == cat and row_checksums(d.c, table_columns(d.c)) == sums)
    ok('list: the function is marked read-only (stable)', d.one("select provolatile from pg_proc where oid = to_regprocedure(:s)", s=LIST) == 's')
    d.close()

def scen_others():
    w = world('others'); d = w.d
    issue(w); issue(w, w.cb, B)
    b_code = live(d, w.eb)[0][0]
    sums = row_checksums(d.c, table_columns(d.c))
    ok("others: list on B's class answers empty", listed(w, w.cb) == [], listed(w, w.cb))
    ok("others: issue on B's class answers empty", issue(w, w.cb) == [], issue(w, w.cb))
    ok("others: reissue on B's student answers null", reissue(w, w.eb) is None)
    ok("others: issue on B's class with a key answers empty and keeps no reply", issue(w, w.cb, key=nid()) == [])
    ok("others: B's code is not in anything A was answered", b_code not in json.dumps([listed(w), issue(w)]))
    ok('others: a class in the trash: list, issue and reissue answer empty',
       listed(w, w.trash) == [] and issue(w, w.trash) == [] and reissue(w, w.et) is None)
    ok('others: ids that do not exist answer empty, no error',
       listed(w, nid()) == [] and issue(w, nid()) == [] and reissue(w, nid()) is None)
    ok('others: null ids answer empty, no error', T(d, 'list_scan_labels(null)')['labels'] == [] and T(d, 'issue_scan_labels(null, null)')['labels'] == []
       and T(d, 'reissue_scan_label(null, null)')['label'] is None)
    ok('others: none of it changed a row', row_checksums(d.c, table_columns(d.c)) == sums)
    key = nid(); mine = issue(w, key=key); k2 = nid(); new = reissue(w, w.here[0], key=k2)
    ok("others: B sending A's issue key is answered nothing of A's", issue(w, w.c, B, key=key) == [] and issue(w, w.cb, B, key=key) != mine, issue(w, w.c, B, key=key))
    ok("others: B sending A's reissue key is answered null, and A's code stands", reissue(w, w.here[0], B, key=k2) is None and live(d, w.here[0]) == [[new['code']]])
    for name, call, kw in (('list', 'select list_scan_labels(:c)', {'c': w.c}), ('issue', 'select issue_scan_labels(:c, null)', {'c': w.c}),
                           ('reissue', 'select reissue_scan_label(:e, null)', {'e': w.here[0]})):
        r = refusal(lambda: d.role('service_role', call, **kw))
        ok('others: the edge functions\' role, with no teacher, is PT401 on %s' % name, r and r[0] == 'PT401', r)
    ok("others: B reads B's own and nothing of A's", [x['enrollment_id'] for x in listed(w, w.cb, B)] == [w.eb] and listed(w, w.c, B) == [])
    for name, call in (('list', 'list_scan_labels(:c)'), ('issue', 'issue_scan_labels(:c, null)')):
        r = refusal(lambda: d.role('authenticated', 'select ' + call, uid='', c=w.c))
        ok('others: signed out, %s is PT401' % name, r and r[0] == 'PT401', r)
        r = refusal(lambda: d.role('anon', 'select ' + call, c=w.c))
        ok('others: a visitor may not run %s' % name, r and r[0] == '42501', r)
    r = refusal(lambda: d.role('authenticated', 'select reissue_scan_label(:e, null)', uid='', e=w.here[0]))
    ok('others: signed out, reissue is PT401', r and r[0] == 'PT401', r)
    r = refusal(lambda: d.role('anon', 'select reissue_scan_label(:e, null)', e=w.here[0]))
    ok('others: a visitor may not run reissue', r and r[0] == '42501', r)
    for role in ('anon', 'authenticated', 'service_role'):
        uid = A if role == 'authenticated' else None
        r = refusal(lambda: d.role(role, 'select count(*) from public.scan_label', uid=uid))
        ok('others: %s cannot read the table' % role, r and r[0] == '42501', r)
        r = refusal(lambda: d.role(role, "insert into public.scan_label (enrollment_id, code) values (:e, 'ABCDEFGHJKLM')", uid=uid, e=w.here[0]))
        ok('others: %s cannot write the table' % role, r and r[0] == '42501', r)
        r = refusal(lambda: d.role(role, 'update public.scan_label set retired_at = null', uid=uid))
        ok('others: %s cannot change a row' % role, r and r[0] == '42501', r)
        r = refusal(lambda: d.role(role, 'delete from public.scan_label', uid=uid))
        ok('others: %s cannot delete a row' % role, r and r[0] == '42501', r)
        r = refusal(lambda: d.role(role, 'select fv_private.scan_label_new(:e)', uid=uid, e=w.here[0]))
        ok('others: %s cannot call the code-drawing function' % role, r and r[0] == '42501', r)
    ok('others: the edge functions may run the three (as every teacher function)',
       d.one("select has_function_privilege('service_role', :s, 'execute')", s=ISSUE) is True)
    ok('others: no function of the student page names the table',
       d.one("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit' and p.prosrc like '%scan_label%'") == 0)
    ok('others: a code is not a card code: no card or slip function reads the table',
       d.one("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosrc like '%scan_label%' and p.oid <> all(:o::oid[])",
             o=[d.one('select to_regprocedure(:s)::oid', s=s) for s in OURS]) == 0)
    d.close()

def scen_cascade():
    w = world('cascade'); d = w.d
    issue(w); issue(w, w.cb, B)
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.gone); reissue(w, w.gone)
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.gone)
    ok('cascade: (setup) four codes in the class, one for B', len(rows(d)) == 5, rows(d))
    T(d, 'delete_withdrawn_student(:e, gen_random_uuid())', e=w.gone)
    ok('cascade: deleting a withdrawn student for good takes their code', d.one('select count(*) from scan_label where enrollment_id = :e', e=w.gone) == 0)
    ok('cascade: the others stay', len(rows(d)) == 4, rows(d))
    d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c)
    d.run('select public.fv_retention_cleanup()')
    ok('cascade: a class purged from the trash takes its codes', d.one('select count(*) from course where id = :c', c=w.c) == 0
       and [r[0] for r in rows(d)] == [w.eb], rows(d))
    d.close()

def scen_taken():
    w = world('taken'); d = w.d
    got = issue(w)
    # The student already has a live code: scan_label_new answers it and adds nothing (as the owner; no role may call it).
    n = len(rows(d))
    ok('taken: a student with a live code is answered that code', d.one('select fv_private.scan_label_new(:e)', e=w.here[0]) == got[0]['code'])
    ok('taken: and no second row is made', len(rows(d)) == n)
    d.run('update scan_label set retired_at = now() where enrollment_id = :e', e=w.here[0])
    # Force the draw to repeat: a trigger rewrites the first drawn code to one that is already there. A
    # sequence counts the tries (a failed insert rolls a table's count back, never a sequence's).
    d.run('create sequence pg_temp.tries')
    d.run("""create function pg_temp.collide() returns trigger language plpgsql as $$
             begin
                 if nextval('pg_temp.tries') = 1 then new.code := (select code from public.scan_label order by created_at limit 1); end if;
                 return new;
             end $$""")
    d.run('create trigger collide before insert on public.scan_label for each row execute function pg_temp.collide()')
    code = d.one('select fv_private.scan_label_new(:e)', e=w.here[0])
    ok('taken: a draw that is already taken is drawn again', CODE.match(code or '') and live(d, w.here[0]) == [[code]] and d.one("select last_value from pg_temp.tries") == 2,
       (code, d.one('select last_value from pg_temp.tries')))
    # Five draws in a row taken: the call fails rather than loop for ever, and adds nothing.
    d.run('update scan_label set retired_at = now() where enrollment_id = :e and retired_at is null', e=w.here[0])
    d.run("""create or replace function pg_temp.collide() returns trigger language plpgsql as $$
             begin new.code := (select code from public.scan_label order by created_at limit 1); return new; end $$""")
    n = len(rows(d)); r = refusal(lambda: d.one('select fv_private.scan_label_new(:e)', e=w.here[0]))
    ok('taken: five taken draws in a row fail with the unique error, and add nothing', r and r[0] == '23505' and len(rows(d)) == n, r)
    d.run('drop trigger collide on public.scan_label')
    r = refusal(lambda: d.run("insert into scan_label (enrollment_id, code) values (:e, 'ABCDEFGHIJKL')", e=w.gone))
    ok('taken: a code with a letter outside the alphabet is refused by the table', r and r[0] == '23514', r)
    r = refusal(lambda: d.run("insert into scan_label (enrollment_id, code) values (:e, 'abcdefghjklm')", e=w.gone))
    ok('taken: small letters are refused', r and r[0] == '23514', r)
    r = refusal(lambda: d.run("insert into scan_label (enrollment_id, code) values (:e, 'ABCDEFGHJKL')", e=w.gone))
    ok('taken: eleven characters are refused', r and r[0] == '23514', r)
    r = refusal(lambda: d.run("insert into scan_label (enrollment_id, code) values (:e, 'ABCDEFGHJKLM')", e=w.here[1]))
    ok('taken: a second live code for one student is refused by the table', r and r[0] == '23505', r)
    r = refusal(lambda: d.run('insert into scan_label (enrollment_id, code) values (:e, :c)', e=w.gone, c=got[1]['code']))
    ok('taken: a code another student has is refused by the table', r and r[0] == '23505', r)
    # Spread, on the function's own draws: 1,500 codes, all different, and every one of the twelve places
    # shows all 32 characters (a place fed by the uuid's version byte could show only 16).
    d.run("""do $$ begin for i in 1..1500 loop
                 update public.scan_label set retired_at = now() where enrollment_id = '%s' and retired_at is null;
                 perform fv_private.scan_label_new('%s');
             end loop; end $$""" % (w.gone, w.gone))
    codes = [r[0] for r in d.all('select code from scan_label where enrollment_id = :e', e=w.gone)]
    ok('taken: 1,500 draws, all different', len(codes) == 1500 and len(set(codes)) == 1500, (len(codes), len(set(codes))))
    places = [len({c[i] for c in codes}) for i in range(12)]
    ok('taken: every one of the twelve places shows all 32 characters', places == [32] * 12, places)
    worst = max(max(abs(sum(1 for c in codes if c[i] == ch) - 1500 / 32) for ch in '23456789ABCDEFGHJKLMNPQRSTUVWXYZ') for i in range(12))
    ok('taken: no character is far from its share in any place (within 35 of 47)', worst < 35, worst)
    d.close()

class Conn:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()
    def as_teacher(self, uid=A):
        self.c.run("select set_config('request.jwt.claim.sub', :u, false)", u=uid); self.c.run('set role authenticated')

def scen_race():
    w = world('race', students=tuple('S%02d' % n for n in range(13))); d = w.d
    out = {}
    def call(name, sql, **kw):
        c = Conn(d); c.as_teacher()
        try: out[name] = c.run(sql, **kw)[0][0]
        except Exception as e: out[name] = 'ERROR ' + message(e)
        c.close()
    for rnd in range(3):
        d.run('delete from scan_label'); out.clear()
        # Hold the class's lock so both calls queue behind it, then let them go together.
        gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.scan_label'), hashtext(:c))", c=w.c)
        ts = [threading.Thread(target=call, args=(k, 'select issue_scan_labels(:c, null)'), kwargs={'c': w.c}) for k in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5); gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: neither issue failed' % rnd, all(isinstance(v, dict) for v in out.values()), out)
        per = d.all('select enrollment_id::text, count(*) from scan_label where retired_at is null group by 1')
        ok('race %d: every student not withdrawn has exactly one live code' % rnd, sorted(p[0] for p in per) == sorted(w.here) and all(p[1] == 1 for p in per), per)
        ok('race %d: no extra rows' % rnd, d.one('select count(*) from scan_label') == len(w.here))
        ok('race %d: both calls answer the same codes' % rnd, isinstance(out.get('one'), dict) and out['one'] == out.get('two'), out)
    e = w.here[0]
    for rnd in range(3):
        out.clear(); n = d.one('select count(*) from scan_label where enrollment_id = :e', e=e)
        gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.scan_label'), hashtext(:c))", c=w.c)
        ts = [threading.Thread(target=call, args=(k, 'select reissue_scan_label(:e, null)'), kwargs={'e': e}) for k in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5); gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: neither reissue failed' % rnd, all(isinstance(v, dict) and v['label'] for v in out.values()), out)
        ok('race %d: two reissues made two codes, one live at the end' % rnd,
           d.one('select count(*) from scan_label where enrollment_id = :e', e=e) == n + 2 and len(live(d, e)) == 1, live(d, e))
        ok('race %d: the live code is one of the two answered' % rnd, live(d, e)[0][0] in [v['label']['code'] for v in out.values() if isinstance(v, dict)], out)
    # The same key from two windows at once: both wait behind the key's own lock (held here so they
    # queue together), then one makes a code and the other is answered the first reply.
    for rnd in range(3):
        key = nid(); out.clear(); n = d.one('select count(*) from scan_label where enrollment_id = :e', e=e)
        gate = Conn(d); gate.run('begin'); gate.run('select pg_advisory_xact_lock(hashtext(:u), hashtext(:k))', u=A, k=key)
        ts = [threading.Thread(target=call, args=(k, 'select reissue_scan_label(:e, :k)'), kwargs={'e': e, 'k': key}) for k in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5)
        ok('race %d: both calls with one key wait behind its lock' % rnd, out == {} and d.one('select count(*) from scan_label where enrollment_id = :e', e=e) == n, out)
        gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: one key from two windows at once makes one new code and one reply' % rnd,
           d.one('select count(*) from scan_label where enrollment_id = :e', e=e) == n + 1 and isinstance(out.get('one'), dict) and out['one'] == out.get('two'), out)
    d.close()

def catalog_of(d): return catalog(d.c)
def norm(lines):
    """Catalog lines without what a re-made grant or table changes and means nothing: the order of a grant
    list, and the stamp a re-made table's columns carry."""
    def acl(m): return '{' + ','.join(sorted(m.group(1).split(','))) + '}'
    return [re.sub(r'pg_attver=\d+', 'pg_attver=N', re.sub(r'\{([^{}]*=[^{}]*)\}', acl, l)) for l in lines]
def same(a, b): return norm(a) == norm(b)
# What the file may change in the catalog: its own table and functions, and the counts that follow from them
# (the key's two internal triggers on enrollment, one comment, the dependency counts).
EXPECTED = re.compile(r'scan_label|^comments on pg_class \||^depends |pg_depend|^internal triggers enrollment \|')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog_of(d); sums = row_checksums(d.c, table_columns(d.c))
    new, relied = header_md5s()
    ok('apply: the header names its four new functions and the four it relies on', sorted(new) == sorted(OURS) and sorted(relied) == sorted(RELIED), (new, relied))
    ok('apply: the relied-on functions are the header\'s on this database', all(md5(d, s) == relied[s] for s in RELIED), {s: md5(d, s) for s in RELIED})
    pre = split(text_of(PRE))
    ok('apply: the pre-check returns no rows before', d.statements(pre) == 'ok' and d.rows == [], d.rows)
    # Guards: each stops the file with nothing changed.
    def guard(name, setup, undo, expect):
        d.run(setup); before = catalog_of(d)
        r = d.file(FILE)
        ok('apply guard: %s stops the file' % name, r.startswith('STOPPED') and expect in r, r)
        ok('apply guard: %s leaves the catalog as it was' % name, catalog_of(d) == before, differences(before, catalog_of(d)))
        ok('apply guard: %s is named by the pre-check' % name, d.statements(pre) == 'ok' and d.rows != [], d.rows)
        d.run(undo)
    for sig in RELIED:
        name = sig.split('(')[0]
        d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % sig)
        guard('a changed %s' % name, "do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed'); end $$" if 'idem' in sig
              else "do $$ begin execute replace((select def from kept), 'select exists', 'select  exists'); end $$",
              "do $$ begin execute (select def from kept); end $$", 'is not the definition this file was written against')
        d.run('drop table kept')
        ok('apply: %s is back as it was' % name, md5(d, sig) == relied[sig])
    guard('a list_scan_labels with other arguments', 'create function public.list_scan_labels(text) returns int language sql as $$ select 1 $$',
          'drop function public.list_scan_labels(text)', 'other arguments or in another schema')
    guard('an issue_scan_labels in another schema', 'create function fv_private.issue_scan_labels(uuid, uuid) returns int language sql as $$ select 1 $$',
          'drop function fv_private.issue_scan_labels(uuid, uuid)', 'other arguments or in another schema')
    guard('a scan_label_new in public', 'create function public.scan_label_new(uuid) returns int language sql as $$ select 1 $$',
          'drop function public.scan_label_new(uuid)', 'other arguments or in another schema')
    guard('a reissue_scan_label that is not this file\'s', 'create function public.reissue_scan_label(uuid, uuid) returns jsonb language sql as $$ select null::jsonb $$',
          'drop function public.reissue_scan_label(uuid, uuid)', 'is not the definition this file was written against')
    guard('a scan_label table that is not this file\'s', 'create table public.scan_label (id uuid, code text)',
          'drop table public.scan_label', 'exists and is not this file')
    ok('apply: after the guards the catalog is the one before', catalog_of(d) == base, differences(base, catalog_of(d)))
    # Lock timeout: a transaction holding enrollment makes the file give up, nothing applied.
    hold = Conn(d); hold.run('begin'); hold.run('lock table public.enrollment in access exclusive mode')
    t0 = time.time(); r = d.file(FILE); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('apply: a held lock makes the file give up after about five seconds', r.startswith('STOPPED') and 'lock timeout' in r and 4 < took < 12, (r, took))
    ok('apply: and nothing was applied', catalog_of(d) == base, differences(base, catalog_of(d)))
    # The apply.
    r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
    after = catalog_of(d); gone, came = differences(base, after)
    ok('apply: the catalog changes only in what the header names', all(EXPECTED.search(l) for l in gone + came), [l for l in gone + came if not EXPECTED.search(l)][:6])
    ok('apply: nothing that existed is dropped or changed but three counts', all(re.match(r'(depends |internal triggers enrollment )', l) for l in gone), [l for l in gone if not re.match(r'(depends |internal triggers enrollment )', l)])
    ok('apply: enrollment gains the key\'s two internal triggers and nothing else',
       [l for l in gone if l.startswith('internal triggers enrollment')] == ['internal triggers enrollment | 44'] and 'internal triggers enrollment | 46' in came, (gone, came))
    ok('apply: no existing row changed', {k: v for k, v in row_checksums(d.c, table_columns(d.c)).items() if k != 'public.scan_label'} == sums)
    ok('apply: the table starts empty', d.one('select count(*) from scan_label') == 0)
    ok('apply: the new functions are the header\'s', all(md5(d, s) == new[s] for s in OURS), {s: md5(d, s) for s in OURS})
    post = split(text_of(POST)); r = d.statements(post)
    ok('apply: the post-check says ok on every row', r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    ok('apply: the pre-check now names what is there', d.statements(pre) == 'ok' and len(d.rows) == 5, d.rows)
    issue(w); codes = rows(d)
    r = d.file(FILE); ok('apply: a second run is ok', r == 'ok', r)
    ok('apply: a second run changes nothing', catalog_of(d) == after and rows(d) == codes, differences(after, catalog_of(d)))
    ok('apply: row security is on and the table has no policy',
       d.one("select relrowsecurity from pg_class where oid = 'public.scan_label'::regclass") is True and d.one("select count(*) from pg_policy where polrelid = 'public.scan_label'::regclass") == 0)
    size = os.path.getsize(os.path.join(HERE, FILE))
    ok('apply: the file is small enough to send whole (%d KB)' % (size // 1024), size < 60000, size)
    ok('apply: the header says it is not applied or applied, and names its tests', 'scan_labels.py' in HEADER and 'scan-labels-undo.sql' in HEADER)
    d.close()

def scen_missing():
    """A relied-on function that is missing altogether stops the file (on a world of its own: nothing is put back)."""
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
    """With Supabase's default privileges in place (every new table and function in public granted to anon,
    authenticated and service_role), the file still leaves the grants exact: the post-check says ok."""
    w = world('defaults', with_file=False); d = w.d
    d.run('alter default privileges in schema public grant all on tables to anon, authenticated, service_role')
    d.run('alter default privileges in schema public grant all on functions to anon, authenticated, service_role')
    d.run('alter default privileges in schema fv_private grant all on functions to anon, authenticated, service_role')
    r = d.file(FILE); ok('defaults: the file applies', r == 'ok', r)
    r = d.statements(split(text_of(POST)))
    ok('defaults: the post-check says ok on every row', r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    x = refusal(lambda: d.role('anon', 'select list_scan_labels(:c)', c=w.c))
    ok('defaults: a visitor still may not run list', x and x[0] == '42501', x)
    x = refusal(lambda: d.role('authenticated', 'select count(*) from public.scan_label', uid=A))
    ok('defaults: a teacher still cannot read the table', x and x[0] == '42501', x)
    x = refusal(lambda: d.role('authenticated', 'select fv_private.scan_label_new(:e)', uid=A, e=w.here[0]))
    ok('defaults: a teacher still cannot call the code-drawing function', x and x[0] == '42501', x)
    d.close()

def scen_undo():
    w = world('undo', with_file=False); d = w.d
    base = catalog_of(d); sums = row_checksums(d.c, table_columns(d.c))
    r = d.file(UNDO); ok('undo: on a database without the file it is ok', r == 'ok', r)
    ok('undo: and changes nothing', catalog_of(d) == base, differences(base, catalog_of(d)))
    r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
    withfile = catalog_of(d)
    got = issue(w); reissue(w, w.here[0]); codes = rows(d)
    # PART 1: the stop.
    r = d.statements(split(part1())); ok('undo PART 1: runs', r == 'ok', r)
    for name, call, kw in (('list', 'select list_scan_labels(:c)', {'c': w.c}), ('issue', 'select issue_scan_labels(:c, null)', {'c': w.c}),
                           ('reissue', 'select reissue_scan_label(:e, null)', {'e': w.here[0]})):
        x = refusal(lambda: d.role('authenticated', call, uid=A, **kw))
        ok('undo PART 1: a teacher can no longer run %s' % name, x and x[0] == '42501', x)
    ok('undo PART 1: every code is kept', rows(d) == codes)
    gone, came = differences(withfile, catalog_of(d))
    ok('undo PART 1: only the three grants changed', all('scan_label' in l for l in gone + came) and len(gone) == 3, (gone, came))
    r = d.statements(split(part1())); ok('undo PART 1: a second run is ok', r == 'ok', r)
    r = d.file(FILE); ok('undo: the file again gives the functions back', r == 'ok' and same(catalog_of(d), withfile), differences(norm(withfile), norm(catalog_of(d))))
    ok('undo: and the codes are still there', rows(d) == codes and listed(w) != [])
    # A changed function stops the full undo.
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % LIST)
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.file(UNDO)
    ok('undo: a function changed since stops the removal', r.startswith('STOPPED') and 'is not the definition 2026111710 left' in r, r)
    ok('undo: and the table and codes are still there', applied(d) and rows(d) == codes)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    d.run("grant execute on function public.list_scan_labels(uuid), public.issue_scan_labels(uuid, uuid), public.reissue_scan_label(uuid, uuid) to authenticated")
    ok('undo: (setup) back to the file\'s state', same(catalog_of(d), withfile), differences(norm(withfile), norm(catalog_of(d))))
    # The full undo.
    r = d.file(UNDO); ok('undo: the full undo runs', r == 'ok', r)
    ok('undo: the catalog is as before the file', catalog_of(d) == base, differences(base, catalog_of(d)))
    ok('undo: every other row is as before', row_checksums(d.c, table_columns(d.c)) == sums)
    r = d.file(UNDO); ok('undo: a second run is ok and changes nothing', r == 'ok' and catalog_of(d) == base, r)
    r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and same(catalog_of(d), withfile), differences(norm(withfile), norm(catalog_of(d))))
    again = issue(w)
    ok('undo: after it, students get new codes (old sheets are not read)', len(again) == len(got) and not ({x['code'] for x in again} & {x['code'] for x in got}), again)
    d.close()

SCENARIOS = {'issue': scen_issue, 'reissue': scen_reissue, 'list': scen_list, 'others': scen_others, 'cascade': scen_cascade,
             'taken': scen_taken, 'race': scen_race, 'apply': scen_apply, 'missing': scen_missing, 'defaults': scen_defaults,
             'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
