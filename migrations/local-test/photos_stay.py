"""Photos stay with the class: migrations/2026111704_photos_stay_with_class.sql on a database rebuilt from the
repo and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "Photos stay with the class").

    PGPORT=<port> PGDATABASE=<db> python3 photos_stay.py           every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 photos_stay.py year      or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped
here. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  stamp    note_course_opened as Teacher A (stamps now, never moves back), with a key sent twice, on Teacher
           B's class, a class in the trash and one that is gone (false, nothing changed, no error), signed out
           (PT401) and as a visitor (permission denied); nobody reads or writes the table directly; a stamp
           does not move the class's sync cursor (no other device loads the class again).
  year     The nightly job (photo_lifecycle_nightly, as pg_cron calls it) on eight classes: opened 364 days ago
           kept, 366 days ago gone; archived and opened 366 days ago gone, archived and opened 10 days ago kept;
           in the trash and unopened for 400 days skipped; no stamp and made today kept, no stamp and made 400
           days ago gone; a Keep Photos Until day already passed and opened recently kept. Where photos go:
           every page row, both files of each queued with reason not_opened_a_year, the log line, Mark Up
           copied to markup_kept; the submission rows, scores, comments and the handout stay. A second night
           changes nothing.
  without  The same eight classes on the database without the file: the class opened 366 days ago keeps its
           photos (Keep Photos Until's June 30 has not come) and the passed Keep Photos Until day deletes. The
           checks that must differ do.
  oldapp   The app in teachers' browsers still sends set_course_send_work with keep_photos_until: accepted,
           stored, answered as before, and it deletes nothing.
  purge    fv_retention_cleanup purges a class 30 days in the trash: the class, its stamp and its pages go, its
           files are queued.
  race     The nightly step and an open on connections of their own, both orders: an open that commits first
           keeps the photos; one that comes during the step waits for it, then lands.
  apply    The guards stop with the catalog unchanged; the file changes only what its header says; no existing
           row changes and every class is stamped with the apply's time; a second run; the header's md5s;
           pre-check and post-check; lock timeout; the file's size.
  undo     PART 1 alone puts the old step back (the 366-day class keeps its photos again, stamps still land);
           the full undo leaves the catalog and every row as before the file; a second run; on a database
           without the file it changes nothing; the file applies again.
  levers   PART 0 alone deletes nothing: every class, the one unopened for 366 days and the one whose End of
           Term is ending included, keeps its photos through the nightly job, and stamps still land. PART 1
           after it brings Keep Photos Until's deleting back: the End of Term class loses its photos the night
           after its term ends, though it was opened today (so nobody runs PART 1 thinking it is harmless).
"""
import json, os, re, sys, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, refused, ok, finish, nid, connect, message, sqlstate, split, text_of
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111704_photos_stay_with_class.sql'
UNDO = 'photos-stay-undo.sql'
PRE = 'photos-stay-live-precheck.sql'
POST = 'photos-stay-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
KEEP = 'public._photo_keep_class(uuid,timestamptz)'
NOTE = 'public.note_course_opened(uuid,uuid)'
RELIED = ['public.photo_lifecycle_nightly()', 'public.fv_retention_cleanup()', 'public.set_course_send_work(uuid,jsonb,uuid)',
          'public.fv_owns_course(uuid)', 'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
          'public._grade_return_lock_first(uuid)', 'public._work_drop_expired(uuid)', 'public._photo_log(uuid,text,integer,jsonb)',
          'public._fv_timezone(text)', 'public._submission_file_removed()']
HEADER = text_of(FILE)

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def applied(d): return d.one("select to_regclass('public.course_opened') is not null")
def header_md5s():
    rows = dict((m[0], (m[1], m[2])) for m in re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})  ([0-9a-f]{32})$', HEADER, re.M))
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    return rows, new
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]
def part0(): return text_of(UNDO).split('-- PART 0 begins')[1].split('-- PART 0 ends')[0]

def term_ended_yesterday(d, c):
    """End of Term, with the class's one term ending yesterday on its own calendar: the old rule deletes tonight."""
    d.run("""update course set keep_photos_until = 'end_of_term',
               reporting_terms = jsonb_build_array(jsonb_build_object('ordinal', 1, 'label', 'Term 1',
                   'starts_on', ((now() at time zone 'America/Vancouver')::date - 60)::text,
                   'ends_on', ((now() at time zone 'America/Vancouver')::date - 1)::text))
             where id = :c""", c=c)

class W: pass
CLASSES = ['recent', 'old', 'arch_old', 'arch_recent', 'trash', 'nostamp_new', 'nostamp_old', 'keep_passed']

def world(tag, with_file=True, classes=CLASSES):
    d = Db('ps_' + tag)
    w = W(); w.d = d; w.c = {}; w.a = {}; w.e = {}; w.s = {}; w.f = {}; w.h = {}
    if applied(d):
        # The repo's baseline has the file since it was applied (Nov 17). The full undo, proven to leave the
        # catalog exactly as before the file (scenario undo, run on the baseline from before), gives that database.
        r = d.file(UNDO)
        if r != 'ok' or applied(d): sys.exit('could not take the template back to before the file: %s' % r)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into cron.job (jobname, schedule, command) values ('fv_photo_lifecycle_daily', '27 10 * * *', 'call public.photo_lifecycle_nightly()')")
    d.run("insert into storage.buckets (id, name) values ('student-photos', 'student-photos') on conflict do nothing")
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    w.cb = str(T(d, "create_course(p_name => 'Bravo Socials', p_subjects => array['Socials'], p_idempotency_key => gen_random_uuid())", B))
    for k in classes:
        c = str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", n='Class ' + k))
        w.c[k] = c
        e = str(T(d, "create_student_and_enroll(:c, 'Cece', :l, p_idempotency_key => gen_random_uuid())", c=c, l=k)['enrollment_id'])
        a = str(T(d, "create_assessment(p_course_id => :c, p_title => 'Lab', p_score_mode => 'points', p_max_points => 10, p_idempotency_key => gen_random_uuid())", c=c))
        d.run("update assessment set students_send = 'photos' where id = :a", a=a)
        d.run("update course set student_page_enabled = true, send_work = true where id = :c", c=c)
        T(d, "upsert_score(:e, :a, 7, null)", e=e, a=a)
        T(d, "save_score_comment(:e, :a, 'Clear diagram')", e=e, a=a)
        s = d.one("""insert into submission (course_id, assessment_id, enrollment_id, state, sent_by, sent_at, created_at, updated_at)
                     values (:c, :a, :e, 'sent', 'student', now() - interval '30 days', now() - interval '30 days', now() - interval '30 days')
                     returning id::text""", c=c, a=a, e=e)
        files = []
        for page in (1, 2):
            fid = nid(); base = '%s/%s/%s/%s/%s' % (c, a, e, s, fid)
            d.run("""insert into submission_file (id, submission_id, page, path, thumb_path, width, height, added_by, declared_bytes,
                                                  declared_thumb_bytes, created_at, link_dies_at)
                     values (:f, :s, :p, :path, :thumb, 1500, 2000, 'student', 300000, 20000, now() - interval '30 days', now() - interval '29 days')""",
                  f=fid, s=s, p=page, path=base + '.jpg', thumb=base + '-thumb.jpg')
            # Both files in the bucket, as an upload leaves them (else the job reports them missing).
            d.run("""insert into storage.objects (bucket_id, name, metadata, created_at)
                     select 'student-photos', p, '{"size": 1000, "mimetype": "image/jpeg"}'::jsonb, now() - interval '30 days'
                       from unnest(array[:a, :b]) p""", a=base + '.jpg', b=base + '-thumb.jpg')
            files.append(fid)
        d.run("""insert into markup (file_id, course_id, assessment_id, enrollment_id, working, working_rev, working_at)
                 values (:f, :c, :a, :e, '{"strokes": [1]}'::jsonb, 1, now() - interval '20 days')""", f=files[0], c=c, a=a, e=e)
        h = d.one("""insert into assessment_resource (assessment_id, course_id, kind, title, page_count, status, position)
                     values (:a, :c, 'pdf', 'Lab Handout', 2, 'ready', 0) returning id::text""", a=a, c=c)
        w.a[k], w.e[k], w.s[k], w.f[k], w.h[k] = a, e, s, files, h
    d.run("update course set is_archived = true where id in (:x, :y)", x=w.c.get('arch_old'), y=w.c.get('arch_recent'))
    if 'trash' in w.c: d.run("update course set deleted_at = now() - interval '1 day' where id = :c", c=w.c['trash'])
    if 'keep_passed' in w.c: term_ended_yesterday(d, w.c['keep_passed'])
    # Every class made two years ago, but the one made today: a stamp is judged against it (greatest).
    d.run("update course set created_at = now() - interval '730 days' where id = any(:c::uuid[])",
          c=[v for k, v in w.c.items() if k != 'nostamp_new'])
    if 'nostamp_old' in w.c: d.run("update course set created_at = now() - interval '400 days' where id = :c", c=w.c['nostamp_old'])
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
        opened = {'recent': 364, 'old': 366, 'arch_old': 366, 'arch_recent': 10, 'trash': 400, 'keep_passed': 3}
        for k, days in opened.items():
            if k in w.c: d.run("update course_opened set last_opened_at = now() - make_interval(days => :n) where course_id = :c", n=days, c=w.c[k])
        for k in ('nostamp_new', 'nostamp_old'):
            if k in w.c: d.run('delete from course_opened where course_id = :c', c=w.c[k])
    return w

def pages(w, k): return w.d.one('select count(*) from submission_file f join submission s on s.id = f.submission_id where s.course_id = :c', c=w.c[k])
def kept_marks(w, k): return w.d.one('select count(*) from markup_kept where course_id = :c', c=w.c[k])
def queued(w, k, reason=None):
    return w.d.one("select count(*) from submission_file_removal where course_id = :c and (:r::text is null or reason = :r)", c=w.c[k], r=reason)
def logged(w, k): return w.d.all("select kind, n, detail->>'rule' from photo_check_log where course_id = :c and kind <> 'expired' order by id", c=w.c[k])
def stays(w, k):
    """What must stay when a class's photos go: its submission, score, comment, handout."""
    d = w.d
    return [d.one('select count(*) from submission where id = :s', s=w.s[k]),
            d.one('select value::text from score where enrollment_id = :e and assessment_id = :a', e=w.e[k], a=w.a[k]),
            d.one('select comment from score where enrollment_id = :e and assessment_id = :a', e=w.e[k], a=w.a[k]),
            d.one('select count(*) from assessment_resource where id = :h', h=w.h[k])]
def nightly(d):
    try:
        d.run('call public.photo_lifecycle_nightly()'); return 'ok'
    except Exception as e:
        return 'ERROR ' + message(e)

# ── stamp ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_stamp():
    w = world('stamp', classes=['recent', 'trash']); d = w.d
    try:
        c = w.c['recent']
        at = lambda cid=c: d.one('select last_opened_at from course_opened where course_id = :c', c=cid)
        cursor = lambda cid=c: d.all('select version, gradebook_updated_at from course_sync_cursor where course_id = :c', c=cid)
        d.run("update course_opened set last_opened_at = now() - interval '200 days' where course_id = :c", c=c)
        cur0 = cursor(); old = at()
        ok('stamp: as the owner it answers true', T(d, 'note_course_opened(:c, gen_random_uuid())', c=c) is True)
        ok('stamp: and the class is stamped now', at() > old and d.one("select now() - last_opened_at < interval '1 minute' from course_opened where course_id = :c", c=c))
        ok('stamp: the class\'s sync cursor does not move (no other device loads the class again)', cur0 != [] and cursor() == cur0, (cur0, cursor()))
        key = nid()
        T(d, 'note_course_opened(:c, :k::uuid)', c=c, k=key)
        d.run("update course_opened set last_opened_at = now() - interval '5 days' where course_id = :c", c=c)
        again = T(d, 'note_course_opened(:c, :k::uuid)', c=c, k=key)
        ok('stamp: the same key sent again answers as before and writes nothing',
           again is True and d.one("select last_opened_at < now() - interval '4 days' from course_opened where course_id = :c", c=c))
        T(d, 'note_course_opened(:c, null)', c=c)
        ok('stamp: with no key it stamps too', d.one("select now() - last_opened_at < interval '1 minute' from course_opened where course_id = :c", c=c))
        d.run("update course_opened set last_opened_at = now() + interval '1 hour' where course_id = :c", c=c)
        T(d, 'note_course_opened(:c, gen_random_uuid())', c=c)
        ok('stamp: it never moves a stamp back', d.one("select last_opened_at > now() + interval '50 minutes' from course_opened where course_id = :c", c=c))
        d.run('delete from course_opened where course_id = :c', c=c)
        T(d, 'note_course_opened(:c, gen_random_uuid())', c=c)
        ok('stamp: a class with no row gets one', d.one('select count(*) from course_opened where course_id = :c', c=c) == 1)
        rows0 = row_checksums(d.c, {'public.course_opened': ['course_id', 'last_opened_at'], 'public.course': ['id', 'updated_at', 'deleted_at']})
        ok('stamp: Teacher B on A\'s class: false', T(d, 'note_course_opened(:c, gen_random_uuid())', B, c=c) is False)
        ok('stamp: Teacher A on B\'s class: false', T(d, 'note_course_opened(:c, gen_random_uuid())', c=w.cb) is False)
        ok('stamp: a class in the trash: false', T(d, 'note_course_opened(:c, gen_random_uuid())', c=w.c['trash']) is False)
        ok('stamp: a class that is gone: false', T(d, 'note_course_opened(:c, gen_random_uuid())', c=nid()) is False)
        ok('stamp: none of those changed a row', row_checksums(d.c, {'public.course_opened': ['course_id', 'last_opened_at'],
                                                                     'public.course': ['id', 'updated_at', 'deleted_at']}) == rows0)
        e = refused(d, lambda: d.role('authenticated', 'select note_course_opened(:c, gen_random_uuid())', '', c=c))
        ok('stamp: signed out it is refused (PT401)', e and e[1] == 'PT401', e)
        e = refused(d, lambda: d.role('anon', 'select note_course_opened(:c, gen_random_uuid())', c=c))
        ok('stamp: a visitor cannot run it', e and 'permission denied' in e[0], e)
        for sql in ('select * from course_opened', "insert into course_opened (course_id) values ('%s')" % c,
                    'update course_opened set last_opened_at = now()', 'delete from course_opened'):
            e = refused(d, lambda: d.role('authenticated', sql, A))
            ok('stamp: a teacher cannot %s the table directly' % sql.split()[0], e and 'permission denied' in e[0], e)
        ok('stamp: runs as its owner with a fixed search_path; anon may not run it',
           d.all("select prosecdef, proconfig::text from pg_proc where oid = to_regprocedure(:s)", s=NOTE) == [[True, '{"search_path=public, pg_temp"}']]
           and not d.one("select has_function_privilege('anon', :s, 'execute')", s=NOTE)
           and d.one("select has_function_privilege('authenticated', :s, 'execute')", s=NOTE))
        ok('stamp: a new class starts with no row and counts from when it was made',
           T(d, "create_course(p_name => 'Brand New', p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())") is not None
           and d.one("select count(*) from course c where c.name = 'Brand New' and not exists (select 1 from course_opened o where o.course_id = c.id)") == 1)
    finally:
        d.close()

# ── year ──────────────────────────────────────────────────────────────────────────────────────────────
GONE = ['old', 'arch_old', 'nostamp_old']
KEPT = ['recent', 'arch_recent', 'trash', 'nostamp_new', 'keep_passed']

def check_year(w, label, differs):
    """The checks after one night. differs: these must fail on the database without the file."""
    d = w.d
    for k in CLASSES:
        want_gone = k in GONE
        name = '%s: %s %s' % (label, k, 'loses its photos' if want_gone else 'keeps its photos')
        got = pages(w, k)
        ok(name, (got == 0) if want_gone else (got == 2), got)
    k = 'old'
    ok('%s: old: both files of each page queued, reason not_opened_a_year' % label, queued(w, k, 'not_opened_a_year') == 4, queued(w, k))
    ok('%s: old: one log line, kind keep_photos_until, rule not_opened_a_year' % label, logged(w, k) == [['keep_photos_until', 2, 'not_opened_a_year']], logged(w, k))
    ok('%s: old: Mark Up copied to markup_kept before its page went' % label,
       kept_marks(w, k) == 1 and d.one("select working->>'strokes' from markup_kept where course_id = :c", c=w.c[k]) == '[1]')
    for k in GONE:
        ok('%s: %s: submission, score, comment and handout stay' % (label, k), stays(w, k) == [1, '7', 'Clear diagram', 1], stays(w, k))
    for k in KEPT:
        ok('%s: %s: nothing queued, nothing logged' % (label, k), queued(w, k) == 0 and logged(w, k) == [], (queued(w, k), logged(w, k)))

def scen_year():
    w = world('year'); d = w.d
    try:
        r = nightly(d); ok('year: the nightly job runs clean', r == 'ok', r)
        check_year(w, 'year', [])
        snap = row_checksums(d.c, {'public.submission_file_removal': ['path', 'reason'], 'public.photo_check_log': ['course_id', 'kind', 'n'],
                                   'public.markup_kept': ['file_id'], 'public.submission_file': ['id']})
        r = nightly(d)
        ok('year: a second night changes nothing', r == 'ok' and row_checksums(d.c, {'public.submission_file_removal': ['path', 'reason'],
           'public.photo_check_log': ['course_id', 'kind', 'n'], 'public.markup_kept': ['file_id'], 'public.submission_file': ['id']}) == snap)
        ok('year: the step still keeps photo_keep_check current (for the undo)',
           d.one('select count(*) from photo_keep_check where checked_through = current_date - 1') >= 6)
        # a class opened today after its photos went: the next send stays
        d.run('update course_opened set last_opened_at = now() where course_id = :c', c=w.c['old'])
        ok('year: what the step answers names the stamp it judged', T(d, 'note_course_opened(:c, gen_random_uuid())', c=w.c['old']) is True
           and d.one("select (public._photo_keep_class(:c, now())->>'pages')::int", c=w.c['old']) == 0)
    finally:
        d.close()

def scen_without():
    w = world('without', with_file=False); d = w.d
    try:
        r = nightly(d); ok('without: the nightly job runs (live as it is)', r == 'ok', r)
        ok('without: the class opened 366 days ago keeps its photos (Keep Photos Until is June 30): differs, as required',
           pages(w, 'old') == 2)
        ok('without: a Keep Photos Until day already passed deletes: differs, as required', pages(w, 'keep_passed') == 0)
    finally:
        d.close()

# ── oldapp ────────────────────────────────────────────────────────────────────────────────────────────
def scen_oldapp():
    w = world('oldapp', classes=['recent']); d = w.d
    try:
        c = w.c['recent']
        r = T(d, "set_course_send_work(:c, '{\"keep_photos_until\": \"end_of_term\"}'::jsonb, gen_random_uuid())", c=c)
        ok('oldapp: set_course_send_work with keep_photos_until is accepted and answered as before',
           r == {'send_work': True, 'keep_photos_until': 'end_of_term'}, r)
        r = T(d, "set_course_send_work(:c, '{\"send_work\": false, \"keep_photos_until\": \"end_of_year\"}'::jsonb, gen_random_uuid())", c=c)
        ok('oldapp: both keys together, too', r == {'send_work': False, 'keep_photos_until': 'end_of_year'}, r)
        r = T(d, "set_course_send_work(:c, '{\"send_work\": true}'::jsonb, gen_random_uuid())", c=c)
        ok('oldapp: and the new app\'s send_work alone', r == {'send_work': True, 'keep_photos_until': 'end_of_year'}, r)
        term_ended_yesterday(d, c)
        r = nightly(d)
        ok('oldapp: Keep Photos Until set by the old app deletes nothing', r == 'ok' and pages(w, 'recent') == 2, (r, pages(w, 'recent')))
    finally:
        d.close()

# ── purge ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_purge():
    w = world('purge', classes=['recent', 'trash']); d = w.d
    try:
        c = w.c['trash']
        d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=c)
        files = d.all('select path from submission_file where id = any(:f::uuid[])', f=w.f['trash'])
        d.run('select fv_retention_cleanup()')
        ok('purge: the class 30 days in the trash is gone', d.one('select count(*) from course where id = :c', c=c) == 0)
        ok('purge: its stamp went with it (the cascade)', d.one('select count(*) from course_opened where course_id = :c', c=c) == 0)
        ok('purge: its pages went and every file is queued', d.one('select count(*) from submission_file where id = any(:f::uuid[])', f=w.f['trash']) == 0
           and d.one('select count(*) from submission_file_removal where path = any(:p)', p=[x[0] for x in files]) == 2
           and d.one("select count(*) from submission_file_removal where course_id = :c and path not like '%/handouts/%'", c=c) == 4,
           d.all('select path, reason from submission_file_removal where course_id = :c', c=c))
        ok('purge: the other class is untouched', pages(w, 'recent') == 2 and d.one('select count(*) from course_opened where course_id = :c', c=w.c['recent']) == 1)
    finally:
        d.close()

# ── race ──────────────────────────────────────────────────────────────────────────────────────────────
class Side:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()

def in_thread(fn):
    box = {}
    def go():
        try: box['r'] = fn()
        except Exception as e: box['e'] = (message(e), sqlstate(e))
    t = threading.Thread(target=go); t.start(); return t, box

def opener(d, c):
    s = Side(d)
    s.run('begin'); s.run("select set_config('request.jwt.claim.sub', :u, true)", u=A); s.run('set local role authenticated')
    return s

def scen_race():
    for rnd in range(3):
        w = world('race%d' % rnd, classes=['old']); d = w.d
        try:
            c = w.c['old']
            # An open that commits first: the step sees it and keeps the photos.
            s = opener(d, c); s.run('select note_course_opened(:c, gen_random_uuid())', c=c)
            j = Side(d); j.run('begin')
            t, box = in_thread(lambda: j.run('select public._photo_keep_class(:c, now())', c=c))
            time.sleep(0.4)
            waited = t.is_alive()
            s.run('commit'); t.join(10); j.run('commit')
            ok('race %d: the step waits for an open under way' % rnd, waited)
            ok('race %d: an open that commits first keeps the photos' % rnd, 'e' not in box and pages(w, 'old') == 2, (box, pages(w, 'old')))
            s.close(); j.close()
            # An open during the step: it waits, the photos go, then it lands.
            d.run("update course_opened set last_opened_at = now() - interval '366 days' where course_id = :c", c=c)
            j = Side(d); j.run('begin'); j.run('select public._photo_keep_class(:c, now())', c=c)
            s = opener(d, c)
            t, box = in_thread(lambda: s.run('select note_course_opened(:c, gen_random_uuid())', c=c))
            time.sleep(0.4)
            waited = t.is_alive()
            j.run('commit'); t.join(10); s.run('commit')
            ok('race %d: an open during the step waits for it' % rnd, waited)
            ok('race %d: then lands, after the photos went' % rnd, 'e' not in box and pages(w, 'old') == 0
               and d.one("select now() - last_opened_at < interval '1 minute' from course_opened where course_id = :c", c=c), box)
            s.close(); j.close()
        finally:
            d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
def catalog_of(d): return catalog(d.c)

def scen_apply():
    w = world('apply', with_file=False, classes=['recent', 'trash']); d = w.d
    try:
        rows, new = header_md5s()
        ok('apply: the header names the replaced and the new function', list(rows) == [KEEP] and list(new) == [NOTE], (rows, new))
        ok('apply: the header\'s "before" md5 is this database\'s (equal to live)', md5(d, KEEP) == rows[KEEP][0])
        pre = d.file(PRE); ok('apply: the pre-check returns no row here', pre == 'ok' and d.rows == [], (pre, d.rows))
        cat0 = catalog_of(d)
        for sig in [KEEP] + RELIED:
            body = d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
            marker = '$procedure$\n' if '$procedure$' in body else '$function$\n'
            d.run(body.replace(marker, marker + '-- someone changed this\n', 1))
            r = d.file(FILE)
            pre = d.file(PRE); named = any(sig in row[0] for row in d.rows)
            ok('apply: %s changed since: stopped, and the pre-check names it' % sig.split('(')[0], r.startswith('STOPPED') and 'not the definition' in r and named, (r, d.rows))
            d.run(body)
        d.run('create table public.course_opened (course_id uuid, opened date)')
        r = d.file(FILE); ok('apply: a course_opened of another shape: stopped', r.startswith('STOPPED') and 'is not this file' in r, r)
        d.file(PRE); ok('apply: and the pre-check names it', any('course_opened' in row[0] for row in d.rows), d.rows)
        d.run('drop table public.course_opened')
        d.run("create function public.note_course_opened(p uuid) returns boolean language sql as 'select true'")
        r = d.file(FILE); ok('apply: a note_course_opened with other arguments: stopped', r.startswith('STOPPED') and 'other arguments' in r, r)
        d.run('drop function public.note_course_opened(uuid)')
        ok('apply: every stopped run left the catalog as it was', catalog_of(d) == cat0, differences(cat0, catalog_of(d)))
        # the apply itself
        cols = table_columns(d.c)
        rows0 = row_checksums(d.c, cols)
        n_classes = d.one('select count(*) from course')
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        cat1 = catalog_of(d); rows1 = row_checksums(d.c, cols)
        ok('apply: no existing row changed (on every column the tables had)', rows0 == rows1, [t for t in rows0 if rows0[t] != rows1.get(t)])
        ok('apply: every class is stamped, the trashed one too, all with the apply\'s one time',
           d.one('select count(*) from course_opened') == n_classes and d.one('select count(distinct last_opened_at) from course_opened') == 1)
        gone, extra = differences(cat0, cat1)
        # The two functions, the table (its key adds two internal triggers on course), the two comments.
        expected = re.compile(r'(_photo_keep_class|note_course_opened|course_opened|comments on|pg_depend|^depends |'
                              r'^internal triggers course \||^relation public\.photo_keep_check \||'
                              r'^column more public\.course \| keep_photos_until \||^comment public\.course \| keep_photos_until \||'
                              r'^comment public\.photo_keep_check)')
        ok('apply: the catalog changes only in what the header names', all(expected.search(l) for l in gone + extra),
           [l for l in gone + extra if not expected.search(l)][:6])
        ok('apply: _photo_keep_class has the header\'s "after" md5, note_course_opened its md5', md5(d, KEEP) == rows[KEEP][1] and md5(d, NOTE) == new[NOTE])
        mine = lambda cat: [re.sub(r'[0-9a-f]{32}', 'X', l) for l in cat if l.startswith('function') and '_photo_keep_class(' in l]
        ok('apply: _photo_keep_class keeps its owner, grants, attributes and settings (only the body changes)',
           [re.sub(r'\| [0-9a-f]{32} \|', '|', l) for l in mine(cat0)] == [re.sub(r'\| [0-9a-f]{32} \|', '|', l) for l in mine(cat1)] and len(mine(cat0)) == 2,
           (mine(cat0), mine(cat1)))
        ok('apply: the relied-on functions are unchanged', all(md5(d, s) == md5(d, s) for s in RELIED) and
           [l for l in cat0 if any(s.split('(')[0].split('.')[1] + '(' in l for s in RELIED)] ==
           [l for l in cat1 if any(s.split('(')[0].split('.')[1] + '(' in l for s in RELIED)])
        ok('apply: the comments say the column and table are unused',
           'Unused since 2026111704' in (d.one("select col_description('public.course'::regclass, (select attnum from pg_attribute where attrelid = 'public.course'::regclass and attname = 'keep_photos_until'))") or '')
           and 'Unused since 2026111704' in (d.one("select obj_description('public.photo_keep_check'::regclass, 'pg_class')") or ''))
        post = d.file(POST); ok('apply: the post-check says ok on every row', post == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), d.rows)
        r2 = d.file(FILE); cat2, rows2 = catalog_of(d), row_checksums(d.c, table_columns(d.c))
        ok('apply: a second run changes nothing', r2 == 'ok' and cat2 == cat1 and rows2 == row_checksums(d.c, table_columns(d.c)), differences(cat1, cat2))
        pre = d.file(PRE); ok('apply: on the database after the file, the pre-check says so', pre == 'ok' and len(d.rows) > 0, d.rows)
        ok('apply: one transaction with a lock timeout', HEADER.count('\nbegin;') == 1 and HEADER.count('\ncommit;') == 1 and "set local lock_timeout = '5s';" in HEADER)
        size = len(HEADER.encode())
        ok('apply: the file is small enough to send whole (%d bytes, under 40 KB)' % size, size < 40000)
    finally:
        d.close()
    w = world('apply2', with_file=False, classes=['recent']); d = w.d
    try:
        s = Side(d); s.run('begin'); s.run("update course set updated_at = updated_at where id = :c", c=w.c['recent'])
        cat_b = catalog(d.c)
        t0 = time.time(); r = d.file(FILE); t1 = time.time()
        s.run('rollback'); s.close()
        ok('apply: with a class being saved it stops after the lock timeout, nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < t1 - t0 < 15 and catalog(d.c) == cat_b, (r, t1 - t0))
    finally:
        d.close()

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', with_file=False, classes=['old', 'recent']); d = w.d
    try:
        cols = table_columns(d.c)
        cat0, rows0 = catalog_of(d), row_checksums(d.c, cols)
        ok('undo: on a database without the file it changes nothing', d.file(UNDO) == 'ok' and catalog_of(d) == cat0 and row_checksums(d.c, cols) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        cat1 = catalog_of(d)
        body = d.one('select pg_get_functiondef(to_regprocedure(:s))', s=KEEP)
        d.run(body.replace('$function$\n', '$function$\n-- someone changed this\n', 1))
        r = d.file(UNDO); ok('undo: a changed _photo_keep_class stops it, nothing changed', r.startswith('STOPPED') and 'neither' in r, r)
        d.run(body)
        ok('undo: (setup) back to the file applied', catalog_of(d) == cat1)
        rows1 = row_checksums(d.c, table_columns(d.c))
        r = d.statements(split(part1()))
        ok('undo: PART 1 alone runs', r == 'ok', r)
        ok('undo: PART 1 puts the old step back, md5 for md5', md5(d, KEEP) == header_md5s()[0][KEEP][0])
        ok('undo: and changes nothing else', differences(cat1, catalog_of(d))[1] == [l for l in catalog_of(d) if l not in cat1]
           and all('_photo_keep_class' in l or 'pg_depend' in l for l in sum(differences(cat1, catalog_of(d)), [])),
           differences(cat1, catalog_of(d)))
        ok('undo: no row changed', row_checksums(d.c, table_columns(d.c)) == rows1)
        ok('undo: after PART 1 a stamp still lands', T(d, 'note_course_opened(:c, gen_random_uuid())', c=w.c['recent']) is True)
        d.run("update course_opened set last_opened_at = now() - interval '366 days' where course_id = :c", c=w.c['old'])
        d.run("select public._photo_keep_class(:c, now())", c=w.c['old'])
        ok('undo: after PART 1 a class unopened for 366 days keeps its photos again', pages(w, 'old') == 2)
        d.run("delete from photo_keep_check")   # the step just above wrote it; before the file it was empty
        rows_before = row_checksums(d.c, cols)
        r = d.file(UNDO); cat2 = catalog_of(d); rows2 = row_checksums(d.c, cols)
        ok('undo: the full undo runs', r == 'ok', r)
        ok('undo: the catalog is exactly as before the file', cat2 == cat0, differences(cat0, cat2))
        ok('undo: the full undo changed no row of the tables there were before', rows2 == rows_before)
        books = ('public.course_sync_cursor', 'public.fv_idempotency')   # the setup's own writes in between
        ok('undo: every row is as before the file, but the setup\'s own sync and idempotency bookkeeping',
           {t: v for t, v in rows2.items() if t not in books} == {t: v for t, v in rows0.items() if t not in books},
           [t for t in rows0 if t not in books and rows0[t] != rows2.get(t)])
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and catalog_of(d) == cat2)
        ok('undo: and the file can be applied again', d.file(FILE) == 'ok' and applied(d))
    finally:
        d.close()

# ── levers ────────────────────────────────────────────────────────────────────────────────────────────
def scen_levers():
    w = world('levers', classes=['old', 'recent', 'keep_passed']); d = w.d
    try:
        # End of Term, the class's one term ending today on its own calendar: the old rule deletes tomorrow night.
        d.run("""update course set keep_photos_until = 'end_of_term',
                   reporting_terms = jsonb_build_array(jsonb_build_object('ordinal', 1, 'label', 'Term 1',
                       'starts_on', ((now() at time zone 'America/Vancouver')::date - 60)::text,
                       'ends_on', (now() at time zone 'America/Vancouver')::date::text))
                 where id = :c""", c=w.c['keep_passed'])
        ok('levers: (setup) the class unopened for 366 days is due tonight under the year rule',
           d.one("select last_opened_at < now() - interval '365 days' from course_opened where course_id = :c", c=w.c['old']))
        cat0 = catalog(d.c)
        r = d.statements(split(part0()))
        ok('levers: PART 0 alone runs', r == 'ok', r)
        ok('levers: PART 0 changes no definition', catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
        ok('levers: PART 0 stamps every class now',
           d.one("select bool_and(now() - last_opened_at < interval '1 minute') and count(*) = (select count(*) from course) from course_opened"))
        r = nightly(d)
        ok('levers: after PART 0 the nightly job deletes nothing, the 366-day class and End of Term included',
           r == 'ok' and all(pages(w, k) == 2 for k in w.c) and d.one('select count(*) from submission_file_removal') == 0,
           (r, {k: pages(w, k) for k in w.c}))
        ok('levers: after PART 0 a stamp still lands', T(d, 'note_course_opened(:c, gen_random_uuid())', c=w.c['recent']) is True)
        # PART 1 run today, before the night after the term's last day (tomorrow's run, now() + 1 day).
        r = d.statements(split(part1()))
        ok('levers: PART 1 runs after PART 0', r == 'ok', r)
        n = d.one("select (public._photo_keep_class(:c, now() + interval '1 day')->>'pages')::int", c=w.c['keep_passed'])
        ok('levers: PART 1 brings Keep Photos Until back: the End of Term class, opened today, loses its photos the night after its term',
           n == 2 and pages(w, 'keep_passed') == 0
           and d.one("select count(*) from submission_file_removal where course_id = :c and reason = 'keep_photos_until'", c=w.c['keep_passed']) == 4,
           n)
        ok('levers: and the classes on End of Year keep theirs', pages(w, 'old') == 2 and pages(w, 'recent') == 2)
        ok('levers: the undo\'s header says PART 0 deletes nothing and PART 1 deletes photos',
           'PART 0, the stop that deletes nothing (recommended)' in text_of(UNDO) and 'PART 1, put the old nightly step back (DELETES PHOTOS)' in text_of(UNDO))
    finally:
        d.close()

SCENARIOS = {'stamp': scen_stamp, 'year': scen_year, 'without': scen_without, 'oldapp': scen_oldapp, 'purge': scen_purge,
             'race': scen_race, 'apply': scen_apply, 'undo': scen_undo, 'levers': scen_levers}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
