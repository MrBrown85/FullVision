"""A warning before the year runs out, and a restored class counts as opened:
migrations/2026111705_photo_expiry_warning.sql on a database rebuilt from the repo and proved equal to live
(scripts/db-rebuild.mjs --check; README.md, "A warning before the year runs out").

    PGPORT=<port> PGDATABASE=<db> python3 photo_expiry.py           every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 photo_expiry.py list      or some

The database named by PGDATABASE is only a template (it has 2026111704, as live does): every scenario runs on
its own copy, made and dropped here. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  list     list_course_photo_expiry as Teacher A: only A's own classes, not in the trash, with pages of sent
           work, unopened for 300 days or more; last_opened_at is the greater of the stamp and when the class
           was made (as _photo_keep_class judges it); photos counts pages of sent work only. Teacher B sees only
           B's. Signed out: no rows. A visitor cannot run it. Runs as its owner with a fixed search_path; reads
           nothing it may not (course_opened stays closed to teachers).
  restore  A class in the trash, last opened 340 days before: restored by the operator's one UPDATE, it is
           stamped now and the nightly job keeps its photos; without the file the same restore loses them
           that night (the gap, shown). Restored by a teacher's own update (the course_owner policy): stamped
           too. Restoring never moves a stamp back; a class with no stamp gets one. Moving a class to the
           trash, renaming it, or an update that leaves deleted_at null stamps nothing. The 30-day purge still
           runs, and the stamp goes with the class.
  apply    The guards stop with the catalog unchanged, and the pre-check names each; the file changes only
           what its header says; no existing row changes; the header's md5s; a second run; pre-check and
           post-check; lock timeout; the file's size.
  undo     On a database without the file it changes nothing; PART 0 alone drops the trigger and takes the
           function from teachers, nothing else; the full undo leaves the catalog and every row as before the
           file; a changed function stops it; a second run; the file applies again.
"""
import os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, refused, ok, finish, nid, connect, message, split, text_of
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111705_photo_expiry_warning.sql'
UNDO = 'photo-expiry-undo.sql'
PRE = 'photo-expiry-live-precheck.sql'
POST = 'photo-expiry-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
LIST = 'public.list_course_photo_expiry()'
TRIG = 'public._course_restored_opened()'
RELIED = ['public._photo_keep_class(uuid,timestamptz)', 'public.note_course_opened(uuid,uuid)',
          'public.photo_lifecycle_nightly()', 'public.fv_retention_cleanup()']
HEADER = text_of(FILE)

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def applied(d): return d.one("select to_regprocedure('public.list_course_photo_expiry()') is not null")
def header_new():
    return dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
def part0(): return text_of(UNDO).split('-- PART 0 begins')[1].split('-- PART 0 ends')[0]

class W: pass

def world(tag, with_file=True, classes=()):
    """Teachers A and B. Each class in `classes` is (key, teacher, days since opened or None for no stamp,
    days since made, pages of sent work, pages still sending (not yet sent), in the trash)."""
    d = Db('pe_' + tag)
    w = W(); w.d = d; w.c = {}
    if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into cron.job (jobname, schedule, command) values ('fv_photo_lifecycle_daily', '27 10 * * *', 'call public.photo_lifecycle_nightly()')")
    d.run("insert into storage.buckets (id, name) values ('student-photos', 'student-photos') on conflict do nothing")
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    for (k, who, opened, made, sent, draft, trash) in classes:
        c = str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", who, n='Class ' + k))
        w.c[k] = c
        e = str(T(d, "create_student_and_enroll(:c, 'Cece', :l, p_idempotency_key => gen_random_uuid())", who, c=c, l=k)['enrollment_id'])
        a = str(T(d, "create_assessment(p_course_id => :c, p_title => 'Lab', p_score_mode => 'points', p_max_points => 10, p_idempotency_key => gen_random_uuid())", who, c=c))
        for state, n in (('sent', sent), ('sending', draft)):
            if not n: continue
            s = d.one("""insert into submission (course_id, assessment_id, enrollment_id, state, sent_by, sent_at, created_at, updated_at)
                         values (:c, :a, :e, :st, 'student', case when :st::text = 'sent' then now() - interval '30 days' end,
                                 now() - interval '30 days', now() - interval '30 days')
                         returning id::text""", c=c, a=a, e=e, st=state)
            for page in range(1, n + 1):
                fid = nid(); base = '%s/%s/%s/%s/%s' % (c, a, e, s, fid)
                d.run("""insert into submission_file (id, submission_id, page, path, thumb_path, width, height, added_by, declared_bytes,
                                                      declared_thumb_bytes, created_at, link_dies_at)
                         values (:f, :s, :p, :path, :thumb, 1500, 2000, 'student', 300000, 20000, now() - interval '30 days', now() + interval '1 day')""",
                      f=fid, s=s, p=page, path=base + '.jpg', thumb=base + '-thumb.jpg')
                d.run("""insert into storage.objects (bucket_id, name, metadata, created_at)
                         select 'student-photos', p, '{"size": 1000, "mimetype": "image/jpeg"}'::jsonb, now() - interval '30 days'
                           from unnest(array[:a, :b]) p""", a=base + '.jpg', b=base + '-thumb.jpg')
        d.run("update course set created_at = now() - make_interval(days => :n) where id = :c", n=made, c=c)
        if opened is None:
            d.run('delete from course_opened where course_id = :c', c=c)
        else:
            d.run("""insert into course_opened (course_id, last_opened_at) values (:c, now() - make_interval(days => :n))
                     on conflict (course_id) do update set last_opened_at = excluded.last_opened_at""", c=c, n=opened)
        if trash: d.run("update course set deleted_at = now() - interval '2 days' where id = :c", c=c)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def pages(w, k): return w.d.one('select count(*) from submission_file f join submission s on s.id = f.submission_id where s.course_id = :c', c=w.c[k])
def stamp_age(w, k):
    """Days since the class's stamp, to one decimal, or None for no stamp."""
    v = w.d.one("select round((extract(epoch from now() - last_opened_at) / 86400)::numeric, 1)::text from course_opened where course_id = :c", c=w.c[k])
    return None if v is None else float(v)
def nightly(d):
    try:
        d.run('call public.photo_lifecycle_nightly()'); return 'ok'
    except Exception as e:
        return 'ERROR ' + message(e)

# ── list ──────────────────────────────────────────────────────────────────────────────────────────────
LIST_CLASSES = [
    ('recent', A, 10, 700, 2, 0, False),        # opened lately: not listed
    ('old', A, 340, 700, 2, 0, False),          # listed, 2 pages
    ('edge', A, 301, 700, 3, 0, False),         # just past 300: listed
    ('under', A, 299, 700, 3, 0, False),        # just under 300: not listed
    ('nophotos', A, 340, 700, 0, 0, False),     # no pages: not listed
    ('draftonly', A, 340, 700, 0, 2, False),    # only pages still sending: not listed
    ('mixed', A, 340, 700, 1, 2, False),        # sent and sending: listed, counts the sent page only
    ('trash', A, 340, 700, 2, 0, True),         # in the trash: the purge has it, not listed
    ('nostamp', A, None, 340, 2, 0, False),     # no stamp, made 340 days ago: listed from created_at
    ('newer_made', A, 400, 320, 2, 0, False),   # stamp older than created_at: judged from created_at
    ('bravo', B, 340, 700, 2, 0, False),        # Teacher B's
]

def listed(d, uid=A):
    rows = d.role('authenticated', 'select course_id::text, last_opened_at, photos from list_course_photo_expiry() order by 1', uid)
    return {str(r[0]): (r[1], r[2]) for r in rows}

def scen_list():
    w = world('list', classes=LIST_CLASSES); d = w.d
    try:
        got = listed(d, A)
        names = {v: k for k, v in w.c.items()}
        ok('list: Teacher A sees exactly old, edge, mixed, nostamp, newer_made',
           sorted(names[c] for c in got) == ['edge', 'mixed', 'newer_made', 'nostamp', 'old'], sorted(names.get(c, c) for c in got))
        ok('list: photos counts pages of sent work (old 2, edge 3, mixed 1 of 3)',
           (got[w.c['old']][1], got[w.c['edge']][1], got[w.c['mixed']][1]) == (2, 3, 1))
        same = lambda k: d.one("select greatest(o.last_opened_at, c.created_at) from course c left join course_opened o on o.course_id = c.id where c.id = :c", c=w.c[k])
        ok('list: last_opened_at is the stamp for old', got[w.c['old']][0] == same('old')
           and d.one('select last_opened_at from course_opened where course_id = :c', c=w.c['old']) == got[w.c['old']][0])
        ok('list: no stamp: last_opened_at is when the class was made',
           got[w.c['nostamp']][0] == d.one('select created_at from course where id = :c', c=w.c['nostamp']))
        ok('list: a stamp older than the class: when the class was made (as the nightly step judges)',
           got[w.c['newer_made']][0] == d.one('select created_at from course where id = :c', c=w.c['newer_made']))
        ok('list: Teacher B sees only B\'s class', list(listed(d, B)) == [w.c['bravo']], listed(d, B))
        ok('list: signed out: no rows', listed(d, '') == {})
        ok('list: a teacher with no classes: no rows', listed(d, nid()) == {})
        e = refused(d, lambda: d.role('anon', 'select * from list_course_photo_expiry()'))
        ok('list: a visitor cannot run it', e and 'permission denied' in e[0], e)
        e = refused(d, lambda: d.role('authenticated', 'select * from course_opened', A))
        ok('list: course_opened stays closed to teachers', e and 'permission denied' in e[0], e)
        ok('list: stable, runs as its owner with a fixed search_path; anon may not run it, a teacher may',
           d.all("select provolatile, prosecdef, proconfig::text from pg_proc where oid = to_regprocedure(:s)", s=LIST) == [['s', True, '{"search_path=public, pg_temp"}']]
           and not d.one("select has_function_privilege('anon', :s, 'execute')", s=LIST)
           and d.one("select has_function_privilege('authenticated', :s, 'execute')", s=LIST))
        ok('list: it writes nothing (the stamp of each listed class is as it was)',
           d.one('select last_opened_at from course_opened where course_id = :c', c=w.c['old']) == got[w.c['old']][0])
        # A class opened again leaves the list at once.
        T(d, 'note_course_opened(:c, gen_random_uuid())', c=w.c['old'])
        ok('list: once the teacher opens it, the class leaves the list', w.c['old'] not in listed(d, A))
        # The cutoff the app adds (365 days) agrees with the nightly step's.
        d.run("update course_opened set last_opened_at = now() - interval '364 days 23 hours' where course_id = :c", c=w.c['edge'])
        nightly(d)
        ok('list: a class unopened 364 days 23 hours keeps its photos tonight, and is still listed', pages(w, 'edge') == 3 and w.c['edge'] in listed(d, A))
        d.run("update course_opened set last_opened_at = now() - interval '365 days 1 hour' where course_id = :c", c=w.c['edge'])
        nightly(d)
        ok('list: past 365 days the nightly step takes them, and the class leaves the list', pages(w, 'edge') == 0 and w.c['edge'] not in listed(d, A))
    finally:
        d.close()

# ── restore ───────────────────────────────────────────────────────────────────────────────────────────
RESTORE_CLASSES = [
    ('op', A, 340, 700, 2, 0, True),          # restored by the operator
    ('teach', A, 340, 700, 2, 0, True),       # restored by the teacher's own update
    ('future', A, -1, 700, 2, 0, True),       # a stamp in the future: never moved back
    ('nostamp', A, None, 700, 2, 0, True),    # no stamp at all
    ('live', A, 300, 700, 2, 0, False),       # not in the trash: deleted, renamed, touched
    ('purged', A, 300, 700, 2, 0, True),      # 31 days in the trash: the purge
]

def scen_restore():
    w = world('restore', classes=RESTORE_CLASSES); d = w.d
    try:
        # 365 days pass for the class restored: a stamp 340 days old plus 26 days of the trash would be due.
        d.run("update course_opened set last_opened_at = now() - interval '366 days' where course_id in (:a, :b)", a=w.c['op'], b=w.c['teach'])
        d.run('update course set deleted_at = null where id = :c', c=w.c['op'])
        ok('restore: the operator\'s one UPDATE stamps the class now', stamp_age(w, 'op') == 0.0, stamp_age(w, 'op'))
        d.role('authenticated', 'update course set deleted_at = null where id = :c', A, c=w.c['teach'])
        ok('restore: a teacher\'s own update (course_owner) stamps it too', stamp_age(w, 'teach') == 0.0, stamp_age(w, 'teach'))
        d.run('update course set deleted_at = null where id = :c', c=w.c['future'])
        ok('restore: a stamp in the future is never moved back', stamp_age(w, 'future') == -1.0, stamp_age(w, 'future'))
        d.run('update course set deleted_at = null where id = :c', c=w.c['nostamp'])
        ok('restore: a class with no stamp gets one', stamp_age(w, 'nostamp') == 0.0, stamp_age(w, 'nostamp'))
        r = nightly(d)
        ok('restore: that night the restored classes keep their photos', r == 'ok' and all(pages(w, k) == 2 for k in ('op', 'teach', 'future', 'nostamp')),
           (r, {k: pages(w, k) for k in ('op', 'teach', 'future', 'nostamp')}))
        before = stamp_age(w, 'live')
        d.run("update course set name = 'Renamed' where id = :c", c=w.c['live'])
        d.run("update course set deleted_at = null where id = :c", c=w.c['live'])
        ok('restore: renaming a class, or setting deleted_at null on one not in the trash, stamps nothing', stamp_age(w, 'live') == before)
        d.run("update course set deleted_at = now() where id = :c", c=w.c['live'])
        ok('restore: moving a class to the trash stamps nothing', stamp_age(w, 'live') == before)
        d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c['purged'])
        d.run('select fv_retention_cleanup()')
        ok('restore: the 30-day purge still runs, and the stamp goes with the class',
           d.one('select count(*) from course where id = :c', c=w.c['purged']) == 0
           and d.one('select count(*) from course_opened where course_id = :c', c=w.c['purged']) == 0)
        ok('restore: the trigger function runs as its owner with a fixed search_path; nobody may call it',
           d.all("select prosecdef, proconfig::text from pg_proc where oid = to_regprocedure(:s)", s=TRIG) == [[True, '{"search_path=public, pg_temp"}']]
           and not any(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=TRIG) for r in ('anon', 'authenticated', 'service_role')))
    finally:
        d.close()
    w = world('restore_without', with_file=False, classes=[('op', A, 366, 700, 2, 0, True)]); d = w.d
    try:
        d.run('update course set deleted_at = null where id = :c', c=w.c['op'])
        nightly(d)
        ok('restore: without the file the same restore loses its photos that night (the gap): differs, as required', pages(w, 'op') == 0)
    finally:
        d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_apply():
    w = world('apply', with_file=False, classes=[('old', A, 340, 700, 2, 0, False), ('trash', A, 340, 700, 2, 0, True)]); d = w.d
    try:
        new = header_new()
        ok('apply: the header names the two new functions', sorted(new) == sorted([LIST, TRIG]), new)
        pre = d.file(PRE); ok('apply: the pre-check returns no row here', pre == 'ok' and d.rows == [], (pre, d.rows))
        cat0 = catalog(d.c)
        for sig in RELIED:
            body = d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
            marker = '$procedure$\n' if '$procedure$' in body else '$function$\n'
            d.run(body.replace(marker, marker + '-- someone changed this\n', 1))
            r = d.file(FILE)
            d.file(PRE); named = any(sig in row[0] for row in d.rows)
            ok('apply: %s changed since: stopped, and the pre-check names it' % sig.split('(')[0], r.startswith('STOPPED') and 'not the definition' in r and named, (r, d.rows))
            d.run(body)
        d.run("create function public.list_course_photo_expiry(p uuid) returns int language sql as 'select 1'")
        r = d.file(FILE); ok('apply: a list_course_photo_expiry with other arguments: stopped', r.startswith('STOPPED') and 'other arguments' in r, r)
        d.file(PRE); ok('apply: and the pre-check names it', any('list_course_photo_expiry' in row[0] for row in d.rows), d.rows)
        d.run('drop function public.list_course_photo_expiry(uuid)')
        d.run("create function public.list_course_photo_expiry() returns int language sql as 'select 1'")
        r = d.file(FILE); ok('apply: a list_course_photo_expiry() not this file\'s: stopped', r.startswith('STOPPED') and 'not the definition' in r, r)
        d.run('drop function public.list_course_photo_expiry()')
        d.run('alter table public.course_opened rename column last_opened_at to opened_at')
        r = d.file(FILE); ok('apply: a course_opened of another shape: stopped', r.startswith('STOPPED') and 'is not 2026111704' in r, r)
        d.file(PRE); ok('apply: and the pre-check names it', any('course_opened' in row[0] for row in d.rows), d.rows)
        d.run('alter table public.course_opened rename column opened_at to last_opened_at')
        d.run("create function public._x() returns trigger language plpgsql as 'begin return null; end'")
        d.run('create trigger course_restored_opened after update on public.course for each row execute function public._x()')
        r = d.file(FILE); ok('apply: a trigger course_restored_opened not this file\'s: stopped', r.startswith('STOPPED') and 'trigger course_restored_opened' in r, r)
        d.file(PRE); ok('apply: and the pre-check names the triggers on course', any('triggers on public.course' in row[0] for row in d.rows), d.rows)
        d.run('drop trigger course_restored_opened on public.course'); d.run('drop function public._x()')
        ok('apply: every stopped run left the catalog as it was', catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
        cols = table_columns(d.c)
        rows0 = row_checksums(d.c, cols)
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        cat1 = catalog(d.c); rows1 = row_checksums(d.c, cols)
        ok('apply: no existing row changed (on every column the tables had)', rows0 == rows1, [t for t in rows0 if rows0[t] != rows1.get(t)])
        gone, extra = differences(cat0, cat1)
        expected = re.compile(r'(list_course_photo_expiry|_course_restored_opened|course_restored_opened|pg_depend|^depends |comments on)')
        ok('apply: the catalog changes only in what the header names', all(expected.search(l) for l in gone + extra),
           [l for l in gone + extra if not expected.search(l)][:6])
        ok('apply: the two functions have the header\'s md5s', md5(d, LIST) == new[LIST] and md5(d, TRIG) == new[TRIG], (md5(d, LIST), md5(d, TRIG)))
        ok('apply: the relied-on functions are unchanged', [l for l in cat0 if any(s.split('(')[0].split('.')[1] + '(' in l for s in RELIED)] ==
           [l for l in cat1 if any(s.split('(')[0].split('.')[1] + '(' in l for s in RELIED)])
        post = d.file(POST); ok('apply: the post-check says ok on every row', post == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), d.rows)
        r2 = d.file(FILE)
        ok('apply: a second run changes nothing', r2 == 'ok' and catalog(d.c) == cat1 and row_checksums(d.c, cols) == rows1, (r2, differences(cat1, catalog(d.c))))
        pre = d.file(PRE); ok('apply: on the database after the file, the pre-check says so', pre == 'ok' and len(d.rows) > 0, d.rows)
        ok('apply: one transaction with a lock timeout', HEADER.count('\nbegin;') == 1 and HEADER.count('\ncommit;') == 1 and "set local lock_timeout = '5s';" in HEADER)
        size = len(HEADER.encode())
        ok('apply: the file is small enough to send whole (%d bytes, under 40 KB)' % size, size < 40000)
    finally:
        d.close()
    w = world('apply2', with_file=False, classes=[('old', A, 340, 700, 2, 0, False)]); d = w.d
    try:
        from photos_stay import Side
        s = Side(d); s.run('begin'); s.run('update course set updated_at = updated_at where id = :c', c=w.c['old'])
        cat_b = catalog(d.c)
        t0 = time.time(); r = d.file(FILE); t1 = time.time()
        s.run('rollback'); s.close()
        ok('apply: with a class being saved it stops after the lock timeout, nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < t1 - t0 < 15 and catalog(d.c) == cat_b, (r, t1 - t0))
    finally:
        d.close()

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', with_file=False, classes=[('old', A, 340, 700, 2, 0, False), ('trash', A, 340, 700, 2, 0, True)]); d = w.d
    try:
        cols = table_columns(d.c)
        cat0, rows0 = catalog(d.c), row_checksums(d.c, cols)
        ok('undo: on a database without the file it changes nothing', d.file(UNDO) == 'ok' and catalog(d.c) == cat0 and row_checksums(d.c, cols) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        cat1, rows1 = catalog(d.c), row_checksums(d.c, cols)
        body = d.one('select pg_get_functiondef(to_regprocedure(:s))', s=LIST)
        d.run(body.replace('$function$\n', '$function$\n-- someone changed this\n', 1))
        r = d.file(UNDO); ok('undo: a changed list_course_photo_expiry stops it, nothing changed', r.startswith('STOPPED') and 'neither' in r, r)
        d.run(body)
        ok('undo: (setup) back to the file applied', catalog(d.c) == cat1)
        r = d.statements(split(part0()))
        ok('undo: PART 0 alone runs', r == 'ok', r)
        gone, extra = differences(cat1, catalog(d.c))
        ok('undo: PART 0 drops the trigger and takes the function from teachers, nothing else',
           all(re.search(r'course_restored_opened|list_course_photo_expiry|pg_depend|^depends |internal triggers', l) for l in gone + extra)
           and not d.one("select has_function_privilege('authenticated', :s, 'execute')", s=LIST)
           and d.one("select count(*) from pg_trigger where tgname = 'course_restored_opened'") == 0, (gone, extra))
        ok('undo: PART 0 changes no row', row_checksums(d.c, cols) == rows1)
        e = refused(d, lambda: d.role('authenticated', 'select * from list_course_photo_expiry()', A))
        ok('undo: after PART 0 a teacher\'s call is refused (the app shows no line)', e and 'permission denied' in e[0], e)
        r = d.file(UNDO); cat2 = catalog(d.c); rows2 = row_checksums(d.c, cols)
        ok('undo: the full undo runs after PART 0', r == 'ok', r)
        ok('undo: the catalog is exactly as before the file', cat2 == cat0, differences(cat0, cat2))
        ok('undo: every row is as before the file', rows2 == rows0, [t for t in rows0 if rows0[t] != rows2.get(t)])
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and catalog(d.c) == cat2)
        ok('undo: and the file can be applied again', d.file(FILE) == 'ok' and applied(d))
        r = d.file(UNDO)
        ok('undo: run whole straight after an apply, it leaves the catalog as before the file', r == 'ok' and catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
    finally:
        d.close()

SCENARIOS = {'list': scen_list, 'restore': scen_restore, 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
