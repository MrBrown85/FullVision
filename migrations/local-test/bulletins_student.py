"""Bulletins, the student's side: migrations/2026111803_bulletins_student.sql on a database rebuilt from the
repo and proved equal to live (scripts/db-rebuild.mjs --check), with M1 (2026111801_bulletins.sql) applied
first (README.md, "Bulletins, the student's side").

    PGPORT=<port> PGDATABASE=<db> python3 bulletins_student.py          every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 bulletins_student.py feed     or some
    FV_M1=<path to M1>                                                  M1 from elsewhere (default ../2026111801_bulletins.sql)

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped
here. Never against gradebook-prod: a throwaway PostgreSQL 17 only. Rows are put straight into M1's tables
as the owner, so these scenarios test M2 alone, not the teacher's functions.

  feed     bulletins: the class's visible bulletins oldest first; one shown again and not seen by this student
           at its new place, and back in its own place once seen; a bulletin with a file still uploading is not
           sent; another class's are not; a student of another class gets nothing of this one's; pinned is off
           once its last day has passed; the linked piece only when the student's page lists it (a draft, a
           piece not yet assigned and another class's piece are null); files ready, in position order; the
           newest 100 of the order; it writes nothing and is marked read-only.
  new      new: one count for each class on the device, the student's own unseen visible bulletins, in the
           order the device added them; a class whose page is paused for that student, or whose card is
           stopped, is left out; seeing a bulletin brings its class's count down.
  seen     bulletin_seen keeps the first time; skips an id of another class, one not yet visible, one that
           does not exist and a null; a repeat changes nothing; 100 ids taken, 101 bad_request with nothing
           written; duplicates count once; null or empty is ok with 0.
  react    bulletin_react sets, replaces and takes back; refused reactions_off where Reactions is off (taking
           back too) and not_found for a bulletin the student may not see; another word is bad_request; each
           refusal writes nothing.
  links    bulletin_file_links for a ready file: its pages' paths in the bulletin-files layout; not_found for an
           uploading file, another class's, one of a bulletin not yet visible, and an id that is not there.
  refused  On all four functions: a paused student (paused in the middle of a session), a withdrawn student, a
           class with its Student Page off, a class in the trash, a stopped card, an expired card, an unknown
           session, an expired session and an enrolment not on the session are each refused with its code, in
           the middle of a session, and nothing is written (not even the write limit).
  limit    The two write routes share 120 writes an hour per card: the 121st is too_many with a wait; another
           card is not counted; the refusal writes nothing; every kind write_log held before still passes.
  leak     For every function's answer the keys at every level are exactly the contract's; a classmate's seen
           and reaction rows (and those of a student of another class) never show: not their enrolment id, not
           their time, not a count, not a name; nothing of the teacher's (bytes, keys, created_at, updated_at,
           shown_again_at) is sent.
  others   anon, authenticated and public run none of the five; service_role runs the four and not the shared
           rule; no grant on the tables changed; every function runs as its owner with the path pinned.
  race     Two bulletin_seen for the same ids on connections of their own, held to start together: one row each,
           the first time kept, the counts add up; a reaction set and taken back at once: no error, one row or
           none (three rounds each).
  defaults With Supabase's default privileges in place the file still leaves the grants exact.
  apply    The guards stop with the catalog unchanged (each relied-on function changed or missing, the check
           changed or a second check added, an M1 column missing, a function of these names elsewhere); the
           pre-check names each; the lock timeout; the file changes only what its header says and no row; the
           header's md5s; post-check; a second run changes nothing; the file's size.
  undo     A revoke would stop nothing (the edge function signs in as the owner, which still runs them); PART 1
           drops the four, so the owner can no longer run them, and keeps every row, both helpers and the check;
           the file again gives them back; a changed function stops both parts with everything kept; the full
           undo puts write_log's check back exactly (validated) and leaves the catalog as before; a second run;
           on a database without the file it changes nothing; the file applies again.
  mirror   _bulletin_session_enrollments names exactly the enrolments _session_classes lists, in its order, for a
           device with a class whose page is off, one in the trash, a paused one, a withdrawn enrolment, an
           expired card and a stopped card; an expired card's class is named and gets its count.
  undolock The full undo takes write_log before it deletes: a student's write arriving between waits and goes
           through (the old order, delete then lock, is shown to deadlock, so the race is real).
"""
import json, os, re, sys, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, tx, refused, ok, finish, nid, connect, message, sqlstate, split, text_of, KEY_ID
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111803_bulletins_student.sql'
M1 = os.environ.get('FV_M1') or os.path.join(HERE, '../2026111801_bulletins.sql')
UNDO = 'bulletins-student-undo.sql'
PRE = 'bulletins-student-live-precheck.sql'
POST = 'bulletins-student-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
VIS = 'student_submit._bulletin_visible(uuid,uuid)'
FEED = 'student_submit.bulletins(text,uuid,text)'; SEEN = 'student_submit.bulletin_seen(text,uuid,uuid[],text)'
REACT = 'student_submit.bulletin_react(text,uuid,uuid,text,text)'; LINKS = 'student_submit.bulletin_file_links(text,uuid,uuid,text)'
ENROL = 'student_submit._bulletin_session_enrollments(uuid)'
ROUTES = [FEED, SEEN, REACT, LINKS]; OURS = [VIS, ENROL] + ROUTES
RELIED = ['student_submit._session_class(text,uuid)', 'student_submit._card_refusal(uuid)', 'student_submit._device_session(text)',
          'student_submit._session_classes(uuid)', 'student_submit._write_limit(uuid,text,integer)',
          'student_submit._listed(public.assessment,date)', 'public._fv_timezone(text)', 'fv_private.bulletin_file_path(uuid,uuid,integer)',
          'fv_private.bulletin_pinned_now(boolean,date,text)']
OLD_CHECK = "CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text])))"
NEW_CHECK = "CHECK ((kind = ANY (ARRAY['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text])))"
HEADER = text_of(FILE)
ID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
# The contract's keys, level by level (bulletins-contract.md, "For B1b").
K_FEED = {'ok', 'bulletins', 'new'}
K_BULLETIN = {'id', 'kind', 'body', 'link_url', 'link_title', 'pinned', 'pinned_until', 'assessment_id', 'reactions_on',
              'posted_at', 'edited_at', 'files', 'seen_at', 'reaction'}
K_FILE = {'id', 'kind', 'title', 'page_count', 'position'}
K_NEW = {'enrollment_id', 'count'}
K_LINKS = {'ok', 'bucket', 'file_id', 'bulletin_id', 'kind', 'title', 'page_count', 'pages'}
K_PAGE = {'page', 'path'}

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def S(d, sql, **kw): return d.service(sql, **kw)
def applied(d): return d.one("select to_regprocedure('student_submit.bulletins(text,uuid,text)') is not null")
def m1_applied(d): return d.one("select to_regclass('public.bulletin') is not null")
def kind_check(d): return d.all("select pg_get_constraintdef(oid), convalidated from pg_constraint where conrelid = 'student_submit.write_log'::regclass and contype = 'c'")
def header_md5s():
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    relied = dict(re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})$', HEADER, re.M))
    return new, relied
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]
def log_rows(d): return d.one('select count(*) from student_submit.write_log')
def refusal(fn):
    try: fn()
    except Exception as e: return (sqlstate(e), message(e))
    return None

class W: pass

def world(tag, with_file=True):
    """Teacher A: Science 8 (page on; Cece, Dev and Eli with cards; Wes withdrawn) and Socials 9 (page on; Cece2
    with a card, on Cece's device too); Teacher B: Bravo 10 (page on; Bea with a card). Bulletins in Science 8
    and Bravo 10, made below as the owner."""
    d = Db('b1b_' + tag)
    w = W(); w.d = d
    if applied(d):
        r = d.file(UNDO)
        if r != 'ok' or applied(d): sys.exit('could not take the template back to before the file: %s' % r)
    if not m1_applied(d):
        if not os.path.exists(M1): sys.exit('M1 is needed first: put 2026111801_bulletins.sql at %s or name it in FV_M1' % M1)
        r = d.statements(split(open(M1).read()))
        if r != 'ok': sys.exit('M1 did not apply: %s' % r)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=KEY_ID)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    def course(name, uid=A):
        return str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    def enrol(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())",
                     uid, c=c, f=first)['enrollment_id'])
    w.c = course('Science 8'); w.c2 = course('Socials 9'); w.cb = course('Bravo 10', B)
    d.run('update course set student_page_enabled = true where id = any (:ids)', ids=[w.c, w.c2, w.cb])
    w.cece, w.dev, w.eli, w.wes = (enrol(w.c, n) for n in ('Cece', 'Dev', 'Eli', 'Wes'))
    w.cece2 = enrol(w.c2, 'Cecily'); w.bea = enrol(w.cb, 'Bea', B)
    w.card = {}; w.tok = {}
    for e, c, uid in ((w.cece, w.c, A), (w.dev, w.c, A), (w.eli, w.c, A), (w.cece2, w.c2, A), (w.bea, w.cb, B)):
        code, _pw, _row = d.make(e, c, uid)
        w.card[e] = code
    w.tok[w.cece] = sign_in(d, w.card[w.cece])
    # Cece's second class joins her device's session (Add Another Card).
    r = d.verify(w.card[w.cece2], birthday='2012-05-15', token=w.tok[w.cece], add=True); assert r['ok'], r
    w.tok[w.cece2] = w.tok[w.cece]
    for e in (w.dev, w.eli, w.bea): w.tok[e] = sign_in(d, w.card[e])
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.wes)
    # Pieces: one listed, one a draft, one assigned next week, one in Socials 9.
    w.a_listed = str(T(d, "create_assessment(:c, 'Lab Write-Up', p_idempotency_key => gen_random_uuid())", c=w.c))
    w.a_draft = str(T(d, "create_assessment(:c, 'SECRET-DRAFT', p_idempotency_key => gen_random_uuid())", c=w.c))
    d.run('update assessment set is_draft = true where id = :a', a=w.a_draft)
    w.a_later = str(T(d, "create_assessment(:c, 'Next Week', p_idempotency_key => gen_random_uuid())", c=w.c))
    d.run("update assessment set date_assigned = current_date + 7 where id = :a", a=w.a_later)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def sign_in(d, code):
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

def post(w, course=None, minutes_ago=60, **kw):
    """A bulletin, as the owner: visible (posted) unless posted=False."""
    b = nid(); posted = kw.pop('posted', True)
    cols = {'id': b, 'course_id': course or w.c, 'kind': kw.pop('kind', 'announcement'), 'body': kw.pop('body', 'Words ' + b[:4])}
    cols.update(kw)
    names = ', '.join(cols) + ', created_at' + (', posted_at' if posted else '')
    vals = ', '.join(':' + k for k in cols) + ", now() - make_interval(mins => :m)" + (", now() - make_interval(mins => :m)" if posted else '')
    w.d.run('insert into public.bulletin (%s) values (%s)' % (names, vals), m=minutes_ago, **cols)
    return b

def add_file(w, b, kind='photo', pages=1, ready=True, position=1, title=None):
    f = nid()
    course = w.d.one('select course_id from public.bulletin where id = :b', b=b)
    w.d.run("""insert into public.bulletin_file (id, course_id, bulletin_id, kind, title, page_count, bytes, status, position)
               values (:f, :c, :b, :k, :t, :n, :y, :s, :p)""", f=f, c=course, b=b, k=kind, t=title or kind.upper(), n=pages,
            y=(1000 * pages) if ready else None, s='ready' if ready else 'uploading', p=position)
    return f

def feed(w, e=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.bulletins(:t, :e, 'ip')", t=tok or w.tok[e], e=e)
def seen(w, ids, e=None):
    e = e or w.cece
    return S(w.d, "student_submit.bulletin_seen(:t, :e, :i::uuid[], 'ip')", t=w.tok[e], e=e, i=ids)
def react(w, b, word, e=None):
    e = e or w.cece
    return S(w.d, "student_submit.bulletin_react(:t, :e, :b, :w, 'ip')", t=w.tok[e], e=e, b=b, w=word)
def links(w, f, e=None):
    e = e or w.cece
    return S(w.d, "student_submit.bulletin_file_links(:t, :e, :f, 'ip')", t=w.tok[e], e=e, f=f)
def ids_of(r): return [x['id'] for x in r['bulletins']]

def scen_feed():
    w = world('feed'); d = w.d
    ok('feed: a class with no bulletins answers an empty list', feed(w)['bulletins'] == [] and feed(w)['ok'] is True, feed(w))
    old = post(w, minutes_ago=300); mid = post(w, minutes_ago=200); new = post(w, minutes_ago=100)
    up = post(w, minutes_ago=50, posted=False); add_file(w, up, 'pdf', 3, ready=False)
    other = post(w, course=w.cb, minutes_ago=10, body='BRAVO-ONLY')
    socials = post(w, course=w.c2, minutes_ago=10, body='SOCIALS-ONLY')
    r = feed(w)
    ok('feed: oldest first', ids_of(r) == [old, mid, new], ids_of(r))
    ok('feed: a bulletin with a file still uploading is not sent', up not in json.dumps(r), ids_of(r))
    ok("feed: another class's bulletins are not sent", other not in json.dumps(r) and socials not in json.dumps(r) and 'ONLY' not in json.dumps(r))
    rb = feed(w, w.bea)
    ok("feed: a student of another class gets nothing of this class's", ids_of(rb) == [other] and old not in json.dumps(rb), ids_of(rb))
    # Shown again: the old one moves to the new end for a student who has not seen it, stays for one who has.
    seen(w, [old], w.dev)
    d.run("update public.bulletin set shown_again_at = now() - interval '5 minutes' where id = :b", b=old)
    ok('feed: one shown again and not seen sits at the new end', ids_of(feed(w)) == [mid, new, old], ids_of(feed(w)))
    ok('feed: for a student who had seen it, it stays in its place', ids_of(feed(w, w.dev)) == [old, mid, new], ids_of(feed(w, w.dev)))
    seen(w, [old])
    ok('feed: once seen, it goes back to its own place', ids_of(feed(w)) == [old, mid, new], ids_of(feed(w)))
    # Two at the same time: by id.
    t1 = post(w, minutes_ago=1); d.run('update public.bulletin set posted_at = (select posted_at from public.bulletin where id = :a) where id = :b', a=new, b=t1)
    want = [old, mid] + sorted([new, t1])
    ok('feed: two posted at the same moment are in id order', ids_of(feed(w)) == want, (ids_of(feed(w)), want))
    d.run('delete from public.bulletin where id = :b', b=t1)
    # Pinned, and its last day.
    d.run("update public.bulletin set kind = 'reminder', pinned = true, pinned_until = current_date + 3 where id = :b", b=mid)
    ok('feed: a pinned reminder within its days is pinned', [x for x in feed(w)['bulletins'] if x['id'] == mid][0]['pinned'] is True)
    d.run("update public.bulletin set pinned_until = current_date - 3 where id = :b", b=mid)
    x = [x for x in feed(w)['bulletins'] if x['id'] == mid][0]
    ok('feed: past its last day it is not pinned, and its last day is sent as stored', x['pinned'] is False and x['pinned_until'] is not None, x)
    d.run("update public.bulletin set kind = 'announcement', pinned = true, pinned_until = null where id = :b", b=mid)
    ok('feed: a pinned announcement is pinned', [x for x in feed(w)['bulletins'] if x['id'] == mid][0]['pinned'] is True)
    # The linked piece.
    for a, want, name in ((w.a_listed, w.a_listed, 'a listed piece'), (w.a_draft, None, 'a draft'), (w.a_later, None, 'a piece assigned next week')):
        d.run('update public.bulletin set assessment_id = :a where id = :b', a=a, b=new)
        got = [x for x in feed(w)['bulletins'] if x['id'] == new][0]['assessment_id']
        ok('feed: the linked piece is sent for %s as %s' % (name, 'its id' if want else 'null'), got == want, got)
    d.run('update assessment set is_draft = false where id = :a', a=w.a_draft)
    d.run('update public.bulletin set assessment_id = :a where id = :b', a=w.a_draft, b=new)
    ok('feed: the same piece, published, is sent', [x for x in feed(w)['bulletins'] if x['id'] == new][0]['assessment_id'] == w.a_draft)
    # Files: ready ones, in position order.
    f2 = add_file(w, new, 'pdf', 2, position=2); f1 = add_file(w, new, 'photo', 1, position=1)
    got = [x for x in feed(w)['bulletins'] if x['id'] == new][0]['files']
    ok('feed: files in position order, ready, with their kind, title, pages and position',
       got == [{'id': f1, 'kind': 'photo', 'title': 'PHOTO', 'page_count': 1, 'position': 1},
               {'id': f2, 'kind': 'pdf', 'title': 'PDF', 'page_count': 2, 'position': 2}], got)
    # The newest 100.
    many = [post(w, minutes_ago=5000 - i) for i in range(105)]
    got = ids_of(feed(w))
    ok('feed: at most 100, the newest of the order, still oldest first', len(got) == 100 and got[-3:] == [old, mid, new] and got[0] == many[8], (len(got), got[:2]))
    ok('feed: every bulletin carries the contract\'s keys',
       all(set(x) == K_BULLETIN for x in feed(w)['bulletins']))
    sums = row_checksums(d.c, table_columns(d.c)); n = log_rows(d)
    feed(w); feed(w, w.dev)
    ok('feed: it writes nothing (not even the write limit)', row_checksums(d.c, table_columns(d.c)) == sums and log_rows(d) == n)
    ok('feed: marked read-only (stable)', d.one("select provolatile from pg_proc where oid = to_regprocedure(:s)", s=FEED) == 's')
    d.close()

def scen_new():
    w = world('new'); d = w.d
    a = post(w, minutes_ago=30); b = post(w, minutes_ago=20); post(w, minutes_ago=10, posted=False)
    s1 = post(w, course=w.c2, minutes_ago=5); post(w, course=w.cb, minutes_ago=5)
    r = feed(w)
    ok('new: one count for each class on the device, in the order added', r['new'] == [{'enrollment_id': w.cece, 'count': 2}, {'enrollment_id': w.cece2, 'count': 1}], r['new'])
    r2 = feed(w, w.cece2)
    ok('new: the same counts asked from the second class; its bulletins are its own', r2['new'] == r['new'] and ids_of(r2) == [s1], (r2['new'], ids_of(r2)))
    ok("new: a classmate's device knows only its own class", feed(w, w.dev)['new'] == [{'enrollment_id': w.dev, 'count': 2}], feed(w, w.dev)['new'])
    seen(w, [a])
    ok('new: seeing a bulletin brings its count down', feed(w)['new'][0] == {'enrollment_id': w.cece, 'count': 1}, feed(w)['new'])
    seen(w, [a, b], w.dev)
    ok("new: a classmate's seen marks do not change it", feed(w)['new'][0]['count'] == 1)
    d.run('update enrollment set page_paused_at = now() where id = :e', e=w.cece2)
    ok('new: a class whose page is paused for that student is left out', feed(w)['new'] == [{'enrollment_id': w.cece, 'count': 1}], feed(w)['new'])
    d.run('update enrollment set page_paused_at = null where id = :e', e=w.cece2)
    d.run('update student_card set stopped_at = now() where enrollment_id = :e', e=w.cece2)
    ok('new: a class whose card is stopped is left out', feed(w)['new'] == [{'enrollment_id': w.cece, 'count': 1}], feed(w)['new'])
    d.close()

def scen_seen():
    w = world('seen'); d = w.d
    a = post(w); b = post(w, minutes_ago=30); up = post(w, posted=False); x = post(w, course=w.cb); y = post(w, course=w.c2)
    r = seen(w, [a, b, x, y, up, nid()])
    ok('seen: only the bulletins the student may see are marked', r == {'ok': True, 'seen': 2}, r)
    rows = d.all('select bulletin_id::text, enrollment_id::text from public.bulletin_seen order by 1')
    ok('seen: rows for those two only, this student\'s', sorted(rows) == sorted([[a, w.cece], [b, w.cece]]), rows)
    first = d.one('select seen_at from public.bulletin_seen where bulletin_id = :b and enrollment_id = :e', b=a, e=w.cece)
    time.sleep(0.05)
    r = seen(w, [a])
    ok('seen: a repeat adds nothing', r == {'ok': True, 'seen': 0}, r)
    ok('seen: the first time is kept', d.one('select seen_at from public.bulletin_seen where bulletin_id = :b and enrollment_id = :e', b=a, e=w.cece) == first)
    many = [post(w, minutes_ago=1000 + i) for i in range(101)]
    n = d.one('select count(*) from public.bulletin_seen'); logs = log_rows(d)
    r = seen(w, many)
    ok('seen: 101 ids is bad_request', r == {'ok': False, 'error': 'bad_request'}, r)
    ok('seen: and nothing is written, not even the write limit', d.one('select count(*) from public.bulletin_seen') == n and log_rows(d) == logs)
    r = seen(w, many[:100])
    ok('seen: 100 ids are taken', r == {'ok': True, 'seen': 100}, r)
    c = post(w)
    ok('seen: an id twice counts once', seen(w, [c, c]) == {'ok': True, 'seen': 1})
    ok('seen: null answers ok with 0', S(d, "student_submit.bulletin_seen(:t, :e, null, 'ip')", t=w.tok[w.cece], e=w.cece) == {'ok': True, 'seen': 0})
    ok('seen: an empty list answers ok with 0', seen(w, []) == {'ok': True, 'seen': 0})
    ok('seen: a null in the list is skipped', S(d, "student_submit.bulletin_seen(:t, :e, array[null, :b]::uuid[], 'ip')", t=w.tok[w.cece], e=w.cece, b=post(w)) == {'ok': True, 'seen': 1})
    d.run('update public.bulletin set posted_at = now() where id = :b', b=up)
    ok('seen: once it is visible it can be seen', seen(w, [up]) == {'ok': True, 'seen': 1})
    d.close()

def scen_react():
    w = world('react'); d = w.d
    b = post(w, reactions_on=True); off = post(w, reactions_on=False); up = post(w, posted=False, reactions_on=True)
    x = post(w, course=w.cb, reactions_on=True)
    def mine(b): return d.all('select word from public.bulletin_reaction where bulletin_id = :b and enrollment_id = :e', b=b, e=w.cece)
    ok('react: sets', react(w, b, 'got_it') == {'ok': True, 'reaction': 'got_it'} and mine(b) == [['got_it']])
    t1 = d.one('select updated_at from public.bulletin_reaction where bulletin_id = :b', b=b)
    ok('react: replaces', react(w, b, 'question') == {'ok': True, 'reaction': 'question'} and mine(b) == [['question']])
    ok('react: the time moves on a change', d.one('select updated_at from public.bulletin_reaction where bulletin_id = :b', b=b) >= t1)
    ok('react: the feed shows the student\'s own reaction', [y for y in feed(w)['bulletins'] if y['id'] == b][0]['reaction'] == 'question')
    ok('react: takes back', react(w, b, None) == {'ok': True, 'reaction': None} and mine(b) == [])
    ok('react: taking back what is not there is ok', react(w, b, None) == {'ok': True, 'reaction': None})
    ok('react: done', react(w, b, 'done') == {'ok': True, 'reaction': 'done'})
    n = d.one('select count(*) from public.bulletin_reaction'); logs = log_rows(d)
    for name, call, want in (
            ('Reactions off', lambda: react(w, off, 'got_it'), 'reactions_off'),
            ('Reactions off, taking back', lambda: react(w, off, None), 'reactions_off'),
            ('a bulletin not yet visible', lambda: react(w, up, 'got_it'), 'not_found'),
            ("another class's bulletin", lambda: react(w, x, 'got_it'), 'not_found'),
            ('a bulletin that is not there', lambda: react(w, nid(), 'got_it'), 'not_found'),
            ('another word', lambda: react(w, b, 'love'), 'bad_request'),
            ('a word in capitals', lambda: react(w, b, 'DONE'), 'bad_request'),
            ('an empty word', lambda: react(w, b, ''), 'bad_request')):
        r = call()
        ok('react: %s is %s' % (name, want), r == {'ok': False, 'error': want}, r)
    ok('react: the refusals wrote nothing, not even the write limit', d.one('select count(*) from public.bulletin_reaction') == n and log_rows(d) == logs)
    d.run('update public.bulletin set reactions_on = false where id = :b', b=b)
    ok('react: Reactions turned off later: a change is refused and the reaction stays', react(w, b, 'got_it') == {'ok': False, 'error': 'reactions_off'} and mine(b) == [['done']])
    d.close()

def scen_links():
    w = world('links'); d = w.d
    b = post(w); f = add_file(w, b, 'pdf', 3, title='Field Trip Form')
    r = links(w, f)
    ok('links: a ready file answers its pages in the bulletin-files layout',
       r == {'ok': True, 'bucket': 'bulletin-files', 'file_id': f, 'bulletin_id': b, 'kind': 'pdf', 'title': 'Field Trip Form', 'page_count': 3,
             'pages': [{'page': n, 'path': '%s/%s/%d.jpg' % (w.c, f, n)} for n in (1, 2, 3)]}, r)
    ok('links: the paths are what M1 names (fv_private.bulletin_file_path)',
       [p['path'] for p in r['pages']] == [d.one('select fv_private.bulletin_file_path(:c, :f, :n)', c=w.c, f=f, n=n) for n in (1, 2, 3)])
    b2 = post(w); up = add_file(w, b2, ready=False)
    bu = post(w, posted=False); hidden = add_file(w, bu)
    bx = post(w, course=w.cb); other = add_file(w, bx)
    for name, fid in (('an uploading file', up), ('a file of a bulletin not yet visible', hidden), ("another class's file", other), ('an id that is not there', nid())):
        r = links(w, fid)
        ok('links: %s is not_found' % name, r == {'ok': False, 'error': 'not_found'}, r)
    ok("links: Bea gets her own class's file", links(w, other, w.bea)['ok'] is True)
    ok("links: and not Cece's", links(w, f, w.bea) == {'ok': False, 'error': 'not_found'})
    ok('links: marked read-only (stable)', d.one("select provolatile from pg_proc where oid = to_regprocedure(:s)", s=LINKS) == 's')
    d.close()

def scen_refused():
    w = world('refused'); d = w.d
    b = post(w, reactions_on=True); f = add_file(w, b)
    calls = {
        'bulletins': lambda e, t: S(d, "student_submit.bulletins(:t, :e, 'ip')", t=t, e=e),
        'bulletin_seen': lambda e, t: S(d, "student_submit.bulletin_seen(:t, :e, array[:b]::uuid[], 'ip')", t=t, e=e, b=b),
        'bulletin_react': lambda e, t: S(d, "student_submit.bulletin_react(:t, :e, :b, 'done', 'ip')", t=t, e=e, b=b),
        'bulletin_file_links': lambda e, t: S(d, "student_submit.bulletin_file_links(:t, :e, :f, 'ip')", t=t, e=e, f=f),
    }
    for name, call in calls.items():
        ok('refused: (setup) %s answers ok for Dev first' % name, call(w.dev, w.tok[w.dev]).get('ok') is True)
    d.run('delete from public.bulletin_seen; delete from public.bulletin_reaction')
    cases = (
        ('a student paused in the middle of a session', 'update enrollment set page_paused_at = now() where id = :e', 'update enrollment set page_paused_at = null where id = :e', 'closed'),
        ('a withdrawn student', 'update enrollment set withdrawn_at = now() where id = :e', 'update enrollment set withdrawn_at = null where id = :e', 'not_found'),
        ('a class with its Student Page off', 'update course set student_page_enabled = false where id = (select course_id from enrollment where id = :e)',
         'update course set student_page_enabled = true where id = (select course_id from enrollment where id = :e)', 'closed'),
        ('a class in the trash', 'update course set deleted_at = now() where id = (select course_id from enrollment where id = :e)',
         'update course set deleted_at = null where id = (select course_id from enrollment where id = :e)', 'not_found'),
        ('a stopped card', 'update student_card set stopped_at = now() where enrollment_id = :e', 'update student_card set stopped_at = null where enrollment_id = :e', 'card_stopped'),
        ('an expired card', 'update student_card set works_until = current_date - 3 where enrollment_id = :e',
         "update student_card set works_until = current_date + 300 where enrollment_id = :e", 'card_expired'),
        ('an expired session', "update student_submit.device_session set expires_at = now() - interval '1 minute' where id in (select session_id from student_submit.device_session_enrollment where enrollment_id = :e)",
         "update student_submit.device_session set expires_at = now() + interval '1 day' where id in (select session_id from student_submit.device_session_enrollment where enrollment_id = :e)", 'signed_out'),
    )
    for label, do, undo, want in cases:
        d.run(do, e=w.dev)
        before = row_checksums(d.c, table_columns(d.c)); n = log_rows(d)
        for name, call in calls.items():
            r = call(w.dev, w.tok[w.dev])
            ok('refused: %s on %s is %s' % (label, name, want), r == {'ok': False, 'error': want}, r)
        ok('refused: %s: nothing written, not even the write limit' % label, row_checksums(d.c, table_columns(d.c)) == before and log_rows(d) == n)
        d.run(undo, e=w.dev)
        ok('refused: (setup) %s put back: Dev reads again' % label, calls['bulletins'](w.dev, w.tok[w.dev]).get('ok') is True)
    for label, e, t, want in (('an unknown session', w.dev, 'f' * 64, 'signed_out'), ('a token of the wrong shape', w.dev, 'x', 'signed_out'),
                              ('no token', w.dev, None, 'signed_out'), ("an enrolment not on this session (a classmate's)", w.eli, w.tok[w.dev], 'not_found'),
                              ('an enrolment that is not there', nid(), w.tok[w.dev], 'not_found'),
                              ('a null enrolment', None, w.tok[w.dev], 'not_found')):
        n = log_rows(d)
        for name, call in calls.items():
            r = call(e, t)
            ok('refused: %s on %s is %s' % (label, name, want), r == {'ok': False, 'error': want}, r)
        ok('refused: %s: nothing written (no seen mark, no reaction, not the write limit)' % label,
           log_rows(d) == n and d.one('select count(*) from public.bulletin_seen') == 0 and d.one('select count(*) from public.bulletin_reaction') == 0)
    # A locked card (too many wrong tries) is not refused: _card_refusal does not refuse it and an open
    # session keeps working, as the contract says.
    d.run('update student_card set locked_at = now() where enrollment_id = :e', e=w.dev)
    for name, call in calls.items():
        r = call(w.dev, w.tok[w.dev])
        ok('refused: a locked card still works on %s' % name, r.get('ok') is True, r)
    d.close()

def scen_limit():
    w = world('limit'); d = w.d
    b = post(w, reactions_on=True); c = post(w)
    words = ['got_it', 'done', 'question', None]
    out = []
    for i in range(120):
        out.append(react(w, b, words[i % 4]) if i % 2 else seen(w, [c]))
    ok('limit: 120 writes in an hour, both routes counted together, all ok', all(r.get('ok') is True for r in out), [r for r in out if not r.get('ok')][:2])
    ok('limit: each counted once, as bulletin', d.one("select count(*) from student_submit.write_log where kind = 'bulletin'") == 120)
    n = log_rows(d); reacted = d.all('select word from public.bulletin_reaction')
    r = react(w, b, 'got_it')
    ok('limit: the 121st (a reaction) is too_many with a wait', r.get('ok') is False and r.get('error') == 'too_many' and 1 <= r.get('retry_after_s', 0) <= 3600 and set(r) == {'ok', 'error', 'retry_after_s'}, r)
    r = seen(w, [post(w)])
    ok('limit: the 122nd (a seen mark) is too_many too', r.get('error') == 'too_many', r)
    ok('limit: the refusals wrote nothing', log_rows(d) == n and d.all('select word from public.bulletin_reaction') == reacted
       and d.one('select count(*) from public.bulletin_seen') == 1)
    ok("limit: a classmate's card is not counted", react(w, b, 'done', w.dev) == {'ok': True, 'reaction': 'done'})
    ok('limit: reading is not limited', feed(w).get('ok') is True and links(w, add_file(w, c)).get('ok') is True)
    d.run("update student_submit.write_log set at = at - interval '61 minutes' where kind = 'bulletin'")
    ok('limit: an hour on, writes go again', react(w, b, 'got_it').get('ok') is True)
    # Every kind write_log held before still passes the widened check.
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    for k in ('reflect', 'seen', 'finish', 'answer', 'bulletin'):
        r = refusal(lambda: d.run('insert into student_submit.write_log (card_id, kind) values (:c, :k)', c=card, k=k))
        ok('limit: write_log still takes kind %s' % k, r is None, r)
    r = refusal(lambda: d.run("insert into student_submit.write_log (card_id, kind) values (:c, 'other')", c=card))
    ok('limit: and refuses any other word', r and r[0] == '23514', r)
    d.close()

def scen_leak():
    w = world('leak'); d = w.d
    b = post(w, reactions_on=True, link_url='https://www.example.ca/', link_title='Example')
    d.run("update public.bulletin set shown_again_at = now(), edited_at = now(), idempotency_key = :k where id = :b", k=nid(), b=b)
    f = add_file(w, b, 'pdf', 2)
    # Classmates' rows, and a row of a student of another class on that class's bulletin.
    seen(w, [b], w.dev); react(w, b, 'question', w.dev); seen(w, [b], w.eli); react(w, b, 'done', w.eli)
    d.run('update enrollment set withdrawn_at = null where id = :e', e=w.wes)
    d.run("insert into public.bulletin_seen (bulletin_id, enrollment_id, seen_at) values (:b, :e, now() - interval '3 days')", b=b, e=w.wes)
    d.run("insert into public.bulletin_reaction (bulletin_id, enrollment_id, word) values (:b, :e, 'got_it')", b=b, e=w.wes)
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.wes)
    bx = post(w, course=w.cb, reactions_on=True); seen(w, [bx], w.bea); react(w, bx, 'got_it', w.bea)
    theirs = [w.dev, w.eli, w.wes, w.bea]
    # As the answers would write them (jsonb's text of a timestamptz), to the microsecond.
    times = [t[0] for t in d.all("select to_jsonb(seen_at) #>> '{}' from public.bulletin_seen where enrollment_id <> :e "
                                 "union all select to_jsonb(updated_at) #>> '{}' from public.bulletin_reaction where enrollment_id <> :e", e=w.cece)]
    names = ['Dev', 'Eli', 'Wes', 'Bea', 'Tester', 'Alpha', 'Bravo']
    stored = d.all('select id::text, bytes from public.bulletin_file where id = :f', f=f)
    answers = {'bulletins': feed(w), 'bulletin_seen': seen(w, [b]), 'bulletin_react': react(w, b, 'got_it'), 'bulletin_file_links': links(w, f)}
    fd = feed(w)
    ok('leak: bulletins: top level is ok, bulletins, new', set(fd) == K_FEED, sorted(fd))
    ok('leak: bulletins: each bulletin has exactly the contract\'s keys', fd['bulletins'] and all(set(x) == K_BULLETIN for x in fd['bulletins']), [sorted(x) for x in fd['bulletins']])
    ok('leak: bulletins: each file has exactly the contract\'s keys', all(set(y) == K_FILE for x in fd['bulletins'] for y in x['files']) and fd['bulletins'][0]['files'])
    ok('leak: bulletins: each count has exactly enrollment_id and count', fd['new'] and all(set(x) == K_NEW for x in fd['new']), fd['new'])
    ok('leak: bulletins: the student\'s own reaction and seen time only', fd['bulletins'][0]['reaction'] == 'got_it' and fd['bulletins'][0]['seen_at'] is not None)
    ok('leak: bulletin_seen: exactly ok and seen', set(answers['bulletin_seen']) == {'ok', 'seen'}, answers['bulletin_seen'])
    ok('leak: bulletin_react: exactly ok and reaction', set(answers['bulletin_react']) == {'ok', 'reaction'}, answers['bulletin_react'])
    lk = answers['bulletin_file_links']
    ok('leak: bulletin_file_links: exactly the contract\'s keys, and each page page and path', set(lk) == K_LINKS and all(set(p) == K_PAGE for p in lk['pages']), lk)
    for e in (w.dev, w.eli, w.bea):
        r = S(d, "student_submit.bulletins(:t, :e, 'ip')", t=w.tok[e], e=e)
        ok('leak: a classmate\'s own feed has the same keys', set(r) == K_FEED and all(set(x) == K_BULLETIN for x in r['bulletins']))
    text = json.dumps(answers, default=str) + json.dumps(fd, default=str)
    ok("leak: no classmate's or other student's enrolment id appears in any answer", not any(e in text for e in theirs), [e for e in theirs if e in text])
    ok("leak: (setup) the other students' times are of the answers' form", len(times) == 8 and all('T' in t for t in times), times)
    ok("leak: no other student's seen or reaction time appears", not any(t in text for t in times), [t for t in times if t in text])
    ok('leak: no name appears', not any(n in text for n in names), [n for n in names if n in text])
    ok('leak: no count about others: no key seen, can_see, reactions, not_seen anywhere',
       not re.search(r'"(can_see|reactions|not_seen|no_card|paused|names?|count_[a-z_]+)"', text) and '"seen": 1' not in json.dumps(fd), text[:200])
    ok("leak: nothing of the teacher's: bytes, idempotency_key, created_at, updated_at, shown_again_at, status",
       not re.search(r'"(bytes|idempotency_key|created_at|updated_at|shown_again_at|status|visible|course_id)"', text) and str(stored[0][1]) not in text, text[:200])
    ids = set(re.findall(ID, text))
    allowed = {w.cece, w.cece2, b, f, w.c}
    ok('leak: every id in the answers is the student\'s own enrolments, the bulletin, its file, or the class in a path', ids <= allowed, ids - allowed)
    d.close()

def scen_others():
    w = world('others'); d = w.d
    b = post(w, reactions_on=True)
    for role in ('anon', 'authenticated'):
        uid = A if role == 'authenticated' else None
        for sig, call in ((FEED, "select student_submit.bulletins(:t, :e, 'ip')"), (SEEN, "select student_submit.bulletin_seen(:t, :e, array[:b]::uuid[], 'ip')"),
                          (REACT, "select student_submit.bulletin_react(:t, :e, :b, 'done', 'ip')"), (LINKS, "select student_submit.bulletin_file_links(:t, :e, :b, 'ip')"),
                          (VIS, 'select student_submit._bulletin_visible(:b, :e)'),
                          (ENROL, 'select student_submit._bulletin_session_enrollments(:b)')):
            kw = dict(t=w.tok[w.cece], e=w.cece, b=b)
            if sig == VIS: kw = dict(b=b, e=w.cece)
            if sig == ENROL: kw = dict(b=b)
            r = refusal(lambda: d.role(role, call, uid=uid, **kw))
            ok('others: %s may not run %s' % (role, sig.split('(')[0]), r and r[0] == '42501', r)
    for sig in OURS:
        ok('others: public (everyone) has no grant on %s' % sig.split('(')[0],
           d.one('select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault(\'f\', p.proowner))) x where p.oid = to_regprocedure(:s) and x.grantee = 0', s=sig) == 0)
        ok('others: %s runs as its owner with the path pinned' % sig.split('(')[0],
           d.one("select prosecdef and proconfig = array['search_path=public, student_submit, pg_temp'] from pg_proc where oid = to_regprocedure(:s)", s=sig) is True)
    owner = d.one("select proowner::regrole::text from pg_proc where oid = to_regprocedure('student_submit._session_class(text,uuid)')")
    for sig in ROUTES:
        ok('others: service_role is granted %s, and the owner (the role the edge function signs in as) alone besides' % sig.split('(')[0],
           d.one('select proacl::text from pg_proc where oid = to_regprocedure(:s)', s=sig) == '{%s=X/%s,service_role=X/%s}' % (owner, owner, owner))
    for sig, call, kw in ((VIS, 'select student_submit._bulletin_visible(:b, :e)', dict(b=b, e=w.cece)),
                          (ENROL, 'select student_submit._bulletin_session_enrollments(:b)', dict(b=b))):
        r = refusal(lambda: d.role('service_role', call, **kw))
        ok('others: service_role may not call %s directly' % sig.split('(')[0], r and r[0] == '42501', r)
        ok('others: %s is granted to its owner alone' % sig.split('(')[0],
           d.one('select proacl::text from pg_proc where oid = to_regprocedure(:s)', s=sig) == '{%s=X/%s}' % (owner, owner))
    ok('others: the six are owned by the owner of _session_class', all(d.one('select proowner::regrole::text from pg_proc where oid = to_regprocedure(:s)', s=s) == owner for s in OURS))
    for role in ('anon', 'authenticated', 'service_role'):
        for t in ('bulletin', 'bulletin_file', 'bulletin_seen', 'bulletin_reaction'):
            ok('others: %s cannot read or write public.%s' % (role, t), d.one("select has_table_privilege(:r, :t, 'select,insert,update,delete')", r=role, t='public.' + t) is False)
    d.close()

class Conn:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()

def scen_race():
    w = world('race'); d = w.d
    out = {}
    def call(name, sql, **kw):
        c = Conn(d); c.run('set role service_role')
        try: out[name] = c.run(sql, **kw)[0][0]
        except Exception as e: out[name] = 'ERROR ' + message(e)
        c.close()
    for rnd in range(3):
        ids = [post(w, minutes_ago=10 + i) for i in range(5)]
        out.clear()
        gate = Conn(d); gate.run('begin'); gate.run('lock table public.bulletin_seen in share mode')
        sql = "select student_submit.bulletin_seen(:t, :e, :i::uuid[], 'ip')"
        ts = [threading.Thread(target=call, args=(k, sql), kwargs={'t': w.tok[w.cece], 'e': w.cece, 'i': ids}) for k in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5)
        held = d.one("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")
        gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: both seen calls waited together' % rnd, held == 2, held)
        ok('race %d: neither seen call failed' % rnd, all(isinstance(v, dict) and v.get('ok') for v in out.values()), out)
        ok('race %d: one row for each id' % rnd, d.one('select count(*) from public.bulletin_seen where bulletin_id = any (:i::uuid[]) and enrollment_id = :e', i=ids, e=w.cece) == 5)
        ok('race %d: the counts add up to the ids' % rnd, sum(v['seen'] for v in out.values() if isinstance(v, dict)) == 5, out)
    b = post(w, reactions_on=True)
    for rnd in range(3):
        out.clear()
        react(w, b, 'done')
        gate = Conn(d); gate.run('begin'); gate.run('lock table public.bulletin_reaction in share mode')
        ts = [threading.Thread(target=call, args=('set', "select student_submit.bulletin_react(:t, :e, :b, 'question', 'ip')"), kwargs={'t': w.tok[w.cece], 'e': w.cece, 'b': b}),
              threading.Thread(target=call, args=('back', "select student_submit.bulletin_react(:t, :e, :b, null, 'ip')"), kwargs={'t': w.tok[w.cece], 'e': w.cece, 'b': b})]
        [t.start() for t in ts]; time.sleep(0.5)
        held = d.one("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")
        gate.run('commit'); gate.close(); [t.join() for t in ts]
        rows = d.all('select word from public.bulletin_reaction where bulletin_id = :b and enrollment_id = :e', b=b, e=w.cece)
        ok('race %d: the set and the take-back waited together' % rnd, held == 2, held)
        ok('race %d: neither reaction call failed' % rnd, out.get('set') == {'ok': True, 'reaction': 'question'} and out.get('back') == {'ok': True, 'reaction': None}, out)
        ok('race %d: one row with the word, or none' % rnd, rows in ([], [['question']]), rows)
    d.close()

def scen_defaults():
    w = world('defaults', with_file=False); d = w.d
    d.run('alter default privileges in schema student_submit grant all on functions to anon, authenticated, service_role')
    d.run('alter default privileges in schema public grant all on functions to anon, authenticated, service_role')
    r = d.file(FILE); ok('defaults: the file applies', r == 'ok', r)
    r = d.statements(split(text_of(POST)))
    ok('defaults: the post-check says ok on every row', r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    x = refusal(lambda: d.role('anon', "select student_submit.bulletins(:t, :e, 'ip')", t=w.tok[w.cece], e=w.cece))
    ok('defaults: a visitor still may not run bulletins', x and x[0] == '42501', x)
    x = refusal(lambda: d.role('service_role', 'select student_submit._bulletin_visible(:b, :e)', b=nid(), e=w.cece))
    ok('defaults: the edge function still may not call the shared rule', x and x[0] == '42501', x)
    d.close()

def norm(lines):
    def acl(m): return '{' + ','.join(sorted(m.group(1).split(','))) + '}'
    return [re.sub(r'\{([^{}]*=[^{}]*)\}', acl, l) for l in lines]
def same(a, b): return norm(a) == norm(b)
# What the file may change in the catalog: its five functions, write_log's check, and the counts that follow.
EXPECTED = re.compile(r'bulletin|write_log_kind_check|^depends |pg_depend|^comments on ')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog(d.c); sums = row_checksums(d.c, table_columns(d.c))
    new, relied = header_md5s()
    ok('apply: the header names its five new functions and the nine it relies on', sorted(new) == sorted(OURS) and sorted(relied) == sorted(RELIED), (new, relied))
    ok("apply: the relied-on functions are the header's on this database", all(md5(d, s) == relied[s] for s in RELIED), {s: md5(d, s) for s in RELIED})
    ok('apply: the header names the check before and after', OLD_CHECK in HEADER and NEW_CHECK in HEADER)
    ok('apply: write_log has today\'s check', kind_check(d) == [[OLD_CHECK, True]], kind_check(d))
    pre = split(text_of(PRE))
    ok('apply: the pre-check returns no rows before', d.statements(pre) == 'ok' and d.rows == [], d.rows)
    def guard(name, setup, undo, expect):
        d.run(setup); before = catalog(d.c)
        r = d.file(FILE)
        ok('apply guard: %s stops the file' % name, r.startswith('STOPPED') and expect in r, r)
        ok('apply guard: %s leaves the catalog as it was' % name, catalog(d.c) == before, differences(before, catalog(d.c)))
        ok('apply guard: %s is named by the pre-check' % name, d.statements(pre) == 'ok' and d.rows != [], d.rows)
        d.run(undo)
    for sig in RELIED:
        name = sig.split('(')[0]
        d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % sig)
        guard('a changed %s' % name, "do $$ begin execute regexp_replace((select def from kept), '\\$function\\$', '$function$ ', ''); end $$",
              "do $$ begin execute (select def from kept); end $$", 'is not the definition this file was written against')
        d.run('drop table kept')
        ok('apply: %s is back as it was' % name, md5(d, sig) == relied[sig])
    guard('a write_log check that is not today\'s',
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind in ('reflect', 'seen', 'finish'))",
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text]))",
          "write_log's check is not the one")
    guard('a second check on write_log', "alter table student_submit.write_log add constraint write_log_extra check (kind <> 'x')",
          'alter table student_submit.write_log drop constraint write_log_extra', "write_log's check is not the one")
    guard('the check not validated',
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text])) not valid",
          "alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text]))",
          "write_log's check is not the one")
    guard('the check under another name',
          "alter table student_submit.write_log rename constraint write_log_kind_check to write_log_kind",
          "alter table student_submit.write_log rename constraint write_log_kind to write_log_kind_check",
          'no validated check named write_log_kind_check')
    guard('an M1 column missing', 'alter table public.bulletin rename column shown_again_at to shown_at',
          'alter table public.bulletin rename column shown_at to shown_again_at', 'M1 (2026111801_bulletins.sql) is not applied')
    guard('a bulletins function with other arguments', 'create function student_submit.bulletins(text) returns int language sql as $$ select 1 $$',
          'drop function student_submit.bulletins(text)', 'other arguments or in another schema')
    guard('a bulletin_react in public', 'create function public.bulletin_react(uuid) returns int language sql as $$ select 1 $$',
          'drop function public.bulletin_react(uuid)', 'other arguments or in another schema')
    guard("a bulletin_seen that is not this file's", "create function student_submit.bulletin_seen(text, uuid, uuid[], text) returns jsonb language sql as $$ select null::jsonb $$",
          'drop function student_submit.bulletin_seen(text, uuid, uuid[], text)', 'is not the definition this file was written against')
    ok('apply: after the guards the catalog is the one before', catalog(d.c) == base, differences(base, catalog(d.c)))
    # Lock timeout: a transaction holding write_log makes the file give up, nothing applied.
    hold = Conn(d); hold.run('begin'); hold.run('lock table student_submit.write_log in access exclusive mode')
    t0 = time.time(); r = d.file(FILE); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('apply: a held lock makes the file give up after about five seconds', r.startswith('STOPPED') and 'lock timeout' in r and 4 < took < 12, (r, took))
    ok('apply: and nothing was applied', catalog(d.c) == base, differences(base, catalog(d.c)))
    # The apply, with rate-limit rows of every kind already there.
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    for k in ('reflect', 'seen', 'finish', 'answer'):
        d.run('insert into student_submit.write_log (card_id, kind) values (:c, :k)', c=card, k=k)
    sums = row_checksums(d.c, table_columns(d.c))
    r = d.file(FILE); ok('apply: the file applies over rows of every kind there was', r == 'ok', r)
    after = catalog(d.c); gone, came = differences(base, after)
    ok('apply: the catalog changes only in what the header names', all(EXPECTED.search(l) for l in gone + came), [l for l in gone + came if not EXPECTED.search(l)][:6])
    ok('apply: the only thing that existed and changed is write_log\'s check (and counts)',
       all(re.search(r'write_log_kind_check|^depends |pg_depend|^comments on ', l) for l in gone), gone)
    ok('apply: the check is the header\'s, validated', kind_check(d) == [[NEW_CHECK, True]], kind_check(d))
    ok('apply: no row changed', row_checksums(d.c, table_columns(d.c)) == sums)
    ok('apply: the new functions are the header\'s', all(md5(d, s) == new[s] for s in OURS), {s: md5(d, s) for s in OURS})
    post_ = split(text_of(POST)); r = d.statements(post_)
    ok('apply: the post-check says ok on every row', r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    ok('apply: the pre-check now names what is there', d.statements(pre) == 'ok' and len(d.rows) == 7, d.rows)
    b = post(w, reactions_on=True); react(w, b, 'done'); rows_now = row_checksums(d.c, table_columns(d.c))
    r = d.file(FILE); ok('apply: a second run is ok', r == 'ok', r)
    ok('apply: a second run changes nothing', catalog(d.c) == after and row_checksums(d.c, table_columns(d.c)) == rows_now, differences(after, catalog(d.c)))
    size = os.path.getsize(os.path.join(HERE, FILE))
    ok('apply: the file is 40 KB at most (%d bytes)' % size, size <= 40960, size)
    ok('apply: the header says it is not applied, and names its tests', 'NOT APPLIED' in HEADER and 'bulletins_student.py' in HEADER and UNDO in HEADER)
    d.close()

def scen_missing():
    w = world('missing', with_file=False); d = w.d
    d.run('drop function fv_private.bulletin_file_path(uuid, uuid, integer) cascade')
    before = catalog(d.c)
    r = d.file(FILE)
    ok('apply guard: a missing bulletin_file_path stops the file', r.startswith('STOPPED') and 'none: the function is missing' in r, r)
    ok('apply guard: and leaves the catalog as it was', catalog(d.c) == before, differences(before, catalog(d.c)))
    ok('apply guard: the pre-check names it', d.statements(split(text_of(PRE))) == 'ok'
       and ['fingerprint fv_private.bulletin_file_path(uuid,uuid,integer)', 'absent'] in d.rows, d.rows)
    d.close()

def scen_undo():
    w = world('undo', with_file=False); d = w.d
    base = catalog(d.c); sums = row_checksums(d.c, table_columns(d.c))
    r = d.file(UNDO); ok('undo: on a database without the file it is ok', r == 'ok', r)
    ok('undo: and changes nothing', catalog(d.c) == base and row_checksums(d.c, table_columns(d.c)) == sums, differences(base, catalog(d.c)))
    r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
    withfile = catalog(d.c)
    b = post(w, reactions_on=True); seen(w, [b]); react(w, b, 'done'); seen(w, [b], w.dev)
    kept = d.all('select bulletin_id::text, enrollment_id::text, word from public.bulletin_reaction')
    marks = d.all('select bulletin_id::text, enrollment_id::text from public.bulletin_seen order by 2')
    # The edge function signs in as the database's owner. This connection is that owner: every call below
    # is made as the edge function really makes it.
    calls = ((FEED, "select student_submit.bulletins(:t, :e, 'ip')"), (SEEN, "select student_submit.bulletin_seen(:t, :e, array[:b]::uuid[], 'ip')"),
             (REACT, "select student_submit.bulletin_react(:t, :e, :b, 'done', 'ip')"), (LINKS, "select student_submit.bulletin_file_links(:t, :e, :b, 'ip')"))
    owner = d.one("select proowner::regrole::text from pg_proc where oid = to_regprocedure(:s)", s=FEED)
    ok('undo: (setup) this connection is the functions\' owner', d.one('select current_user') == owner, owner)
    # Why PART 1 drops rather than revokes: with service_role's grant taken away, the owner still runs them.
    with tx(d):
        d.run('revoke execute on function %s from service_role' % ', '.join(ROUTES))
        ok('undo: a revoke would stop nothing: the owner still runs bulletins', d.one(calls[0][1], t=w.tok[w.cece], e=w.cece, b=b)['ok'] is True)
    # PART 1: the stop.
    r = d.statements(split(part1())); ok('undo PART 1: runs', r == 'ok', r)
    for sig, call in calls:
        x = refusal(lambda: d.one(call, t=w.tok[w.cece], e=w.cece, b=b))
        ok('undo PART 1: the owner (the edge function) can no longer run %s: it is gone' % sig.split('(')[0], x and x[0] == '42883', x)
    ok('undo PART 1: every seen mark and reaction is kept',
       d.all('select bulletin_id::text, enrollment_id::text, word from public.bulletin_reaction') == kept
       and d.all('select bulletin_id::text, enrollment_id::text from public.bulletin_seen order by 2') == marks)
    ok('undo PART 1: the two helpers and write_log\'s check are kept',
       md5(d, VIS) is not None and md5(d, ENROL) is not None and kind_check(d) == [[NEW_CHECK, True]])
    gone, came = differences(withfile, catalog(d.c))
    four = re.compile(r'bulletins\(|bulletin_seen\(|bulletin_react\(|bulletin_file_links\(|^depends |pg_depend|^comments on ')
    ok('undo PART 1: only the four functions went', gone and all(four.search(l) for l in gone) and all(re.search(r'^depends |pg_depend|^comments on ', l) for l in came), (gone[:4], came))
    r = d.statements(split(part1())); ok('undo PART 1: a second run is ok', r == 'ok', r)
    r = d.file(FILE); ok('undo: the file again gives them back', r == 'ok' and same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    ok('undo: and Cece reads her feed again', feed(w)['bulletins'][0]['reaction'] == 'done')
    # A changed function stops the full undo.
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % FEED)
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.file(UNDO)
    ok('undo: a function changed since stops the removal', r.startswith('STOPPED') and 'is not the definition 2026111803 left' in r, r)
    ok('undo: and the functions and the check are still there', applied(d) and kind_check(d) == [[NEW_CHECK, True]])
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    ok("undo: (setup) back to the file's state", same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    # The full undo, with bulletin rate-limit rows in write_log and rows of every other kind.
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    for k in ('reflect', 'seen', 'finish', 'answer'):
        d.run('insert into student_submit.write_log (card_id, kind) values (:c, :k)', c=card, k=k)
    others = d.all("select id, kind from student_submit.write_log where kind <> 'bulletin' order by id")
    ok('undo: (setup) there are bulletin rows in write_log', d.one("select count(*) from student_submit.write_log where kind = 'bulletin'") > 0)
    r = d.file(UNDO); ok('undo: the full undo runs', r == 'ok', r)
    ok('undo: write_log\'s check is back exactly, validated', kind_check(d) == [[OLD_CHECK, True]], kind_check(d))
    ok('undo: the catalog is as before the file', catalog(d.c) == base, differences(base, catalog(d.c)))
    ok('undo: the bulletin rows of write_log are gone, every other kind kept',
       d.one("select count(*) from student_submit.write_log where kind = 'bulletin'") == 0
       and d.all("select id, kind from student_submit.write_log order by id") == others)
    ok('undo: every seen mark and reaction is kept (M1\'s tables are M1\'s undo\'s)',
       d.all('select bulletin_id::text, enrollment_id::text, word from public.bulletin_reaction') == kept)
    r = d.file(UNDO); ok('undo: a second run is ok and changes nothing', r == 'ok' and catalog(d.c) == base, r)
    r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    ok('undo: and the feed answers', feed(w)['ok'] is True)
    d.close()

def scen_mirror():
    """_bulletin_session_enrollments names exactly the enrolments _session_classes lists, in its order."""
    w = world('mirror'); d = w.d
    sid = d.one('select session_id from student_submit.device_session_enrollment where enrollment_id = :e', e=w.cece)
    def lists(): return [x['enrollment_id'] for x in d.one('select student_submit._session_classes(:s)', s=sid)]
    def mine(): return [str(x) for x in d.one('select student_submit._bulletin_session_enrollments(:s)', s=sid)]
    # Six more classes on Cece's device, each added while it could still be (Add Another Card), then each
    # put in one state.
    extra = {}
    for state in ('page off', 'in the trash', 'paused', 'withdrawn', 'card expired', 'card stopped'):
        c = str(T(d, "create_course(p_name => :n, p_subjects => array['X'], p_idempotency_key => gen_random_uuid())", n='Class ' + state))
        d.run('update course set student_page_enabled = true where id = :c', c=c)
        e = str(T(d, "create_student_and_enroll(:c, 'Cece', 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())", c=c)['enrollment_id'])
        code, _pw, _row = d.make(e, c, A)
        r = d.verify(code, birthday='2012-05-15', token=w.tok[w.cece], add=True); assert r['ok'], r
        post(w, course=c)
        extra[state] = (c, e)
    ok('mirror: (setup) eight classes on the device, all listed', len(lists()) == 8 and mine() == lists(), (lists(), mine()))
    for state, sql in (('page off', 'update course set student_page_enabled = false where id = :c'),
                       ('in the trash', 'update course set deleted_at = now() where id = :c'),
                       ('paused', 'update enrollment set page_paused_at = now() where id = :e'),
                       ('withdrawn', 'update enrollment set withdrawn_at = now() where id = :e'),
                       ('card expired', 'update student_card set works_until = current_date - 3 where enrollment_id = :e'),
                       ('card stopped', 'update student_card set stopped_at = now() where enrollment_id = :e')):
        c, e = extra[state]
        d.run(sql, c=c, e=e)
        ok('mirror: with a class %s, the helper names exactly what _session_classes lists, in its order' % state, mine() == lists(), (mine(), lists()))
    got = mine()
    ok('mirror: left out: page off, in the trash, paused, withdrawn, card stopped',
       not any(extra[s][1] in got for s in ('page off', 'in the trash', 'paused', 'withdrawn', 'card stopped')), got)
    ok("mirror: an expired card's class is still named, as _session_classes names it", extra['card expired'][1] in got, got)
    r = feed(w)
    ok('mirror: the feed counts exactly those, in that order', [x['enrollment_id'] for x in r['new']] == got, r['new'])
    ok("mirror: the expired card's class still gets its own count", {'enrollment_id': extra['card expired'][1], 'count': 1} in r['new'], r['new'])
    ok('mirror: an unknown session names nothing', d.one('select student_submit._bulletin_session_enrollments(:s)', s=nid()) == [])
    d.close()

def part2(): return text_of(UNDO).split('-- PART 1 ends')[1]

def scen_undolock():
    """The full undo takes write_log before it deletes, so a student's write that arrives between waits."""
    w = world('undolock'); d = w.d
    card = d.one('select id from student_card where enrollment_id = :e', e=w.cece)
    # A pause between the undo's delete and its next step, only in the undo's own session.
    d.run("""create function public.b1b_test_pause() returns trigger language plpgsql as $$
             begin if current_setting('b1b.pause', true) = 'on' then perform pg_sleep(1.5); end if; return null; end $$""")
    d.run('create trigger b1b_test_pause after delete on student_submit.write_log for each statement execute function public.b1b_test_pause()')
    def old_rows():
        d.run("delete from student_submit.write_log")
        # A day old: the student's own call deletes them too, so the two meet on the same rows.
        d.run("insert into student_submit.write_log (card_id, kind, at) select :c, 'bulletin', now() - interval '2 days' from generate_series(1, 5)", c=card)
    def race(undo_sql):
        out = {}
        def undo():
            d.run("select set_config('b1b.pause', 'on', false)")
            out['undo'] = d.statements(split(undo_sql))
            d.run("select set_config('b1b.pause', '', false)")
        t = threading.Thread(target=undo); t.start(); time.sleep(0.5)
        s = Conn(d)
        t0 = time.time()
        try: out['student'] = s.run("select student_submit._write_limit(:c, 'seen', 60)", c=card)[0][0] or 'ok'
        except Exception as e: out['student'] = 'ERROR %s %s' % (sqlstate(e), message(e))
        out['waited'] = time.time() - t0
        s.close(); t.join()
        return out
    # The order before the fix (delete, then lock): shown to deadlock, so the race below is a real one.
    old_rows()
    bad = race("""do $x$ begin
        delete from student_submit.write_log where kind = 'bulletin';
        alter table student_submit.write_log drop constraint write_log_kind_check,
            add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text]));
        end $x$""")
    ok('undolock: (the old order) deleting first and locking after deadlocks with a student write',
       '40P01' in str(bad.get('student')) or 'deadlock' in str(bad.get('undo')), bad)
    if kind_check(d) != [[NEW_CHECK, True]]:
        d.run("alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text]))")
    # The undo as written.
    old_rows()
    good = race(part2())
    ok('undolock: the full undo runs', good.get('undo') == 'ok', good)
    ok("undolock: the student's write arriving between waited and went through, no deadlock", good.get('student') == 'ok' and good.get('waited') > 0.5, good)
    ok('undolock: the check is back as before', kind_check(d) == [[OLD_CHECK, True]], kind_check(d))
    ok("undolock: the student's write is counted; the bulletin rows are gone",
       d.all("select kind from student_submit.write_log order by id") == [['seen']], d.all('select kind from student_submit.write_log'))
    d.run('drop trigger b1b_test_pause on student_submit.write_log'); d.run('drop function public.b1b_test_pause()')
    d.close()

SCENARIOS = {'feed': scen_feed, 'new': scen_new, 'seen': scen_seen, 'react': scen_react, 'links': scen_links, 'refused': scen_refused,
             'limit': scen_limit, 'leak': scen_leak, 'others': scen_others, 'race': scen_race, 'defaults': scen_defaults,
             'apply': scen_apply, 'missing': scen_missing, 'undo': scen_undo, 'mirror': scen_mirror, 'undolock': scen_undolock}
if __name__ == '__main__':
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
