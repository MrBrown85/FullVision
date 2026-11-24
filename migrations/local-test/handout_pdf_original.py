"""A PDF handout's original: migrations/2026112408_handout_pdf_original.sql on a database rebuilt from the repo and
proved equal to live (scripts/db-rebuild.mjs --check; README.md, "A PDF handout's original"), which has 2026111706.

    PGPORT=<port> PGDATABASE=<db> python3 handout_pdf_original.py fingerprints   write the md5 lists the four files carry
    PGPORT=<port> PGDATABASE=<db> python3 handout_pdf_original.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 handout_pdf_original.py teacher        or some
    FV_ICU_DB, FV_C_DB   the two templates scenario collations uses (ICU en-US as live, and C)

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  teacher    start_handout_original and finish_handout_original: what each answers and refuses, a request sent
             twice, missing and bad files, the row's keys, the list, old PDFs answering exactly as before.
  storage    the policies for the one name of an original: when a teacher may write it, no overwrite, change or
             delete, who reads, the careless-policy test, the other names still as before.
  student    student_submit.handout_original: has_original false until ready, then path, size and title; the
             refusals handout_file makes; who may run it.
  lifecycle  Remove, delete_assessment, the purge of the class, an original never finished (dropped, queued,
             never restarted, the pages still open), the nightly job, a second drop; the worker's removal_done.
  apply      the guards stop with the catalog unchanged; only what the header names changes; no row; the md5s;
             a second run; pre-check, fingerprints and post-check; lock timeout; size; plain ASCII, no backslash.
  undo       PART 0, the stop; the full undo refuses while an original is held, then leaves the catalog and every
             row as before; a second run; the file again.
  collations the same on ICU en-US and on C.
"""
import hashlib, json, os, re, secrets, sys
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import card_codes_common as ccc
from card_codes_common import Db, refused, ok, finish, nid, split, text_of, code_tag, key_id, pw_tag, FAKE_KEY, connect, message
from catalog import catalog, differences, row_checksums

FILE = '../2026112408_handout_pdf_original.sql'
UNDO = 'handout-pdf-original-undo.sql'
PRE = 'handout-pdf-original-live-precheck.sql'
POST = 'handout-pdf-original-live-postcheck.sql'
FPS = 'handout-pdf-original-live-fingerprints.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
BUCKET = 'handout-files'
MAX = 20971520
OLD_TYPES = "array['text/html', 'text/plain', 'application/epub+zip']"

RELIED = ['public.fv_owns_assessment(uuid)', 'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
          'public._grade_return_lock_first(uuid)', 'public._fv_timezone(text)', 'public._work_bucket()', 'public._work_hold()',
          'public._handout_path(uuid,uuid,integer)', 'public._assessment_resource_same_class()', 'public._assessment_resource_gone()',
          'public._assessment_resource_truncated()', 'public.remove_assessment_resource(uuid,uuid)', 'public.list_course_resources(uuid)',
          'public.start_handout_upload(uuid,text,integer,uuid)', 'public.finish_handout_upload(uuid,uuid)',
          'public.start_handout_file(uuid,text,text,bigint,uuid)', 'public.finish_handout_file(uuid,uuid)',
          'public._handout_file_bucket()', 'public._handout_file_max_bytes()', 'public._handout_file_mime(text)',
          'public._handout_file_path(uuid,uuid,text)', 'public._handout_file_object(text)', 'fv_private.handout_file_path_parts(text)',
          'public._photo_keep_class(uuid,timestamp with time zone)', 'public._photo_strays(uuid,timestamp with time zone)',
          'public._photo_missing(uuid)', 'public._photo_stuck()', 'public._photo_log(uuid,text,integer,jsonb)',
          'public.delete_assessment(uuid)', 'public.fv_retention_cleanup()', 'student_submit._session_class(text,uuid)',
          'student_submit._listed(assessment,date)', 'student_submit.removal_batch(integer)', 'student_submit.removal_done(bigint[])',
          'student_submit.handout_links(text,uuid,uuid,text)', 'student_submit.handout_file(text,uuid,uuid,text)',
          'student_submit.page(text,uuid,text)']
REPLACES = ['public._assessment_resource_json(uuid)', 'public._assessment_resource_removed()', 'public._handout_drop_expired(uuid)',
            'public.photo_lifecycle_nightly()', 'fv_private.handout_file_upload_allowed(text)', 'fv_private.handout_file_read_allowed(text)']
NEW = ['public._handout_original_path(uuid,uuid)', 'fv_private.handout_original_parts(text)',
       'public.start_handout_original(uuid,bigint,uuid)', 'public.finish_handout_original(uuid,uuid)',
       'student_submit.handout_original(text,uuid,uuid,text)']
POLICIES = ['fv_handout_files_read', 'fv_handout_files_upload', 'fv_handout_files_teachers_only', 'fv_handout_files_fence']
SHAPE_SQL = """select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") from pg_constraint
                where conrelid = 'public.assessment_resource'::regclass
                  and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check')"""

# == 2026112401: the edge function hashes a device's token; verify_card is given the hash of a token it made ==
def _verify(self, code, birthday=None, number=None, password=None, token=None, ip='ip-1', add=False, key=FAKE_KEY):
    new = hashlib.sha256(secrets.token_hex(32).encode()).hexdigest()
    r = self.service('student_submit.verify_card(:h, :k, :b, :n, :p, :t, :i, :a, :s)', h=code_tag(code, key), k=key_id(key),
                     b=birthday, n=number, p=None if password is None else pw_tag(code, password, key), t=token, i=ip, a=add, s=new)
    if isinstance(r, dict) and r.get('ok'):
        r = dict(r, session_token=new if r.get('new_session') else token)
    return r
ccc.Db.verify = _verify

def quiet(diff):
    return tuple([l for l in side if not l.startswith('depends')] for side in diff)
def quiet0(diff):
    return tuple([l for l in side if not l.startswith(('depends', 'dropped columns'))] for side in diff)
def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def defn(d, sig): return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def S(d, sql, **kw): return d.service(sql, **kw)
def applied(d): return d.one("select to_regprocedure('public.start_handout_original(uuid,bigint,uuid)') is not null")
def obj(v): return json.loads(v) if isinstance(v, str) else v
def without_final(text):
    a = text.index('do $final$'); b = text.index('$final$;', a + 12) + len('$final$;')
    return text[:a] + text[b:]
def part0(): return text_of(UNDO).split('-- PART 0 begins')[1].split('-- PART 0 ends')[0]
def q(s): return "'" + s.replace("'", "''") + "'"

def put_list(text, name, rows):
    pat = re.compile(r'(-- FINGERPRINTS-BEGIN %s[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)' % re.escape(name), re.S)
    m = pat.search(text)
    if not m: sys.exit('no list %s' % name)
    indent = re.match(r'[ \t]*', m.group(2)).group(0)
    return text[:m.start(2)] + ',\n'.join(indent + r for r in rows) + text[m.end(2):]
def put_shape(text, marker, shape):
    pat = re.compile(r"(-- %s[^\n]*\n\s*)'(?:[^']|'')*'" % marker)
    if not pat.search(text): sys.exit('no shape ' + marker)
    return pat.sub(lambda m: m.group(1) + q(shape), text, count=1)

# == The md5 lists the four files carry ==
def scen_fingerprints():
    d = Db('hp_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        d.run("""insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
                 values ('handout-files', 'handout-files', false, 20971520, array['text/html', 'text/plain', 'application/epub+zip'])
                 on conflict do nothing""")
        relied ={s: md5(d, s) for s in RELIED}
        before = {s: md5(d, s) for s in REPLACES}
        old_defs = {s: defn(d, s) for s in REPLACES}
        shape_before = d.one(SHAPE_SQL)
        missing = [s for s, v in list(relied.items()) + list(before.items()) if v is None]
        if missing: sys.exit('not on the template: %s' % missing)
        path = os.path.join(HERE, FILE)
        text = open(path).read()
        text = put_list(text, 'relied', ['(%s, %s)' % (q(s), q(relied[s])) for s in RELIED])
        text = put_list(text, 'replaces', ['(%s, %s, %s)' % (q(s), q(before[s]), q('-')) for s in REPLACES])
        text = put_shape(text, 'SHAPE-BEFORE', shape_before)
        r = d.statements(split(without_final(text)))
        if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
        after = {s: md5(d, s) for s in REPLACES + NEW}
        shape_after = d.one(SHAPE_SQL)
        text = put_list(text, 'replaces', ['(%s, %s, %s)' % (q(s), q(before[s]), q(after[s])) for s in REPLACES])
        text = put_list(text, 'new', ['(%s, %s)' % (q(s), q(after[s])) for s in NEW])
        text = put_list(text, 'after', ['(%s, %s)' % (q(s), q(after[s])) for s in NEW + REPLACES])
        text = re.sub(r"(-- SHAPE-AFTER\n\s*)'(?:[^']|'')*'", lambda m: m.group(1) + q(shape_after), text)
        open(path, 'w').write(text)
        p = os.path.join(HERE, FPS); t = open(p).read()
        t = put_list(t, 'live', ['(%s, %s)' % (q(s), q(v)) for s, v in list(relied.items()) + list(before.items())])
        open(p, 'w').write(t)
        p = os.path.join(HERE, PRE); t = open(p).read()
        t = put_list(t, 'precheck', ['(%s, %s)' % (q(s), q(v)) for s, v in list(relied.items()) + list(before.items())])
        t = put_shape(t, 'SHAPE-BEFORE', shape_before)
        open(p, 'w').write(t)
        p = os.path.join(HERE, POST); t = open(p).read()
        t = put_list(t, 'postcheck', ['(%s, %s)' % (q(s), q(v)) for s, v in list(relied.items()) + [(s, after[s]) for s in REPLACES + NEW]])
        t = put_shape(t, 'SHAPE-AFTER', shape_after)
        open(p, 'w').write(t)
        p = os.path.join(HERE, UNDO); t = open(p).read()
        t = put_list(t, 'undo-new', ['(%s, %s)' % (q(s), q(after[s])) for s in NEW])
        t = put_list(t, 'undo-replaced', ['(%s, %s, %s)' % (q(s), q(before[s]), q(after[s])) for s in REPLACES])
        a = t.index('-- OLD-DEFINITIONS-BEGIN'); a = t.index('\n', a) + 1; b = t.index('-- OLD-DEFINITIONS-END')
        t = t[:a] + ''.join(old_defs[s].rstrip() + ';\n\n' for s in REPLACES) + t[b:]
        t = put_shape(t, 'SHAPE-AFTER', shape_after)
        open(p, 'w').write(t)
        print('written: relied %d, replaces %d, new %d' % (len(relied), len(before), len(NEW)))
    finally:
        d.close()

# == The world ==
class W: pass

def session(d, e, c, teacher=A):
    code, _pw, _row = d.make(e, c, teacher)
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

def world(tag, with_file=True):
    d = Db('hp_' + tag)
    w = W(); w.d = d
    if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run('grant select, insert, update, delete on storage.objects to anon, authenticated, service_role')
    d.run('grant select on storage.buckets to anon, authenticated, service_role')
    d.run("""insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('student-photos', 'student-photos', false, 2097152, array['image/jpeg']),
                    ('handout-files', 'handout-files', false, 20971520, array['text/html', 'text/plain', 'application/epub+zip'])
             on conflict do nothing""")
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=key_id(FAKE_KEY))
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    w.c = str(T(d, "create_course(p_name => 'Socials 10', p_subjects => array['Socials'], p_idempotency_key => gen_random_uuid())"))
    w.c2 = str(T(d, "create_course(p_name => 'Socials 10 B', p_subjects => array['Socials'], p_idempotency_key => gen_random_uuid())"))
    w.cb = str(T(d, "create_course(p_name => 'Bravo Science', p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", B))
    def enrol(c, first, uid=A):
        r = T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())", uid, c=c, f=first)
        return str(r['enrollment_id'])
    w.e1 = enrol(w.c, 'Cece'); w.e2 = enrol(w.c2, 'Dev'); w.eb = enrol(w.cb, 'Bravo Kid', B)
    d.run('update course set student_page_enabled = true where id = any (:ids)', ids=[w.c, w.c2, w.cb])
    w.a = str(T(d, "create_assessment(:c, 'Lesson 1.1', p_idempotency_key => gen_random_uuid())", c=w.c))
    w.a2 = str(T(d, "create_assessment(:c, 'Lesson 1.2', p_idempotency_key => gen_random_uuid())", c=w.c))
    w.ab = str(T(d, "create_assessment(:c, 'Bravo Lab', p_idempotency_key => gen_random_uuid())", B, c=w.cb))
    # A PDF (ready), a link and a handout file made before this file, as live has them.
    w.pdf = ready_pdf(w, 'Old PDF', 2, original=False, a=w.a)
    w.link = str(T(d, "add_assessment_link(:a, 'https://example.org/x', 'Old Link', gen_random_uuid())", a=w.a)['id'])
    w.t1 = session(d, w.e1, w.c)
    w.t2 = session(d, w.e2, w.c2)
    if os.environ.get('FV_NONSUPER'):
        # As live's postgres: not a superuser (quizzes_student.py as_live_postgres); it may use the storage tables, as live's does.
        if not d.one('select exists (select 1 from pg_roles where rolname = :r)', r=os.environ['FV_NONSUPER']):
            d.run('create role "%s" login nosuperuser createrole bypassrls' % os.environ['FV_NONSUPER'])
        d.run('alter table storage.buckets owner to "%s"' % os.environ['FV_NONSUPER'])
        d.run('alter table storage.objects owner to "%s"' % os.environ['FV_NONSUPER'])
        import quizzes_student as qs
        flags = qs.as_live_postgres(d)
        ok('(setup %s) runs as a role that is not a superuser' % tag, flags.startswith('false'), flags)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def put_object(w, path, size=1000, mime='application/pdf', bucket=BUCKET):
    w.d.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', :s::bigint, 'mimetype', :m::text))",
            b=bucket, n=path, s=size, m=mime)
def ready_pdf(w, title='A PDF', pages=2, original=False, a=None, size=1000):
    """A PDF handout made as the app makes it: start, every page stored, finish. With original: also the original."""
    d = w.d
    s = obj(T(d, "start_handout_upload(:a, :t, :n, gen_random_uuid())", a=a or w.a, t=title, n=pages))
    for p in s['paths']: put_object(w, p, 500, 'image/jpeg', 'student-photos')
    f = obj(T(d, "finish_handout_upload(:r, gen_random_uuid())", r=s['id']))
    assert f['status'] == 'ready', f
    if original:
        o = start_o(w, s['id'], size); put_object(w, o['original_path'], size)
        g = finish_o(w, s['id']); assert g['original'] == 'ready', g
    return s['id']
def start_o(w, rid, bytes_=1000, key=None, uid=A):
    return obj(T(w.d, "start_handout_original(:r, :b, :k)", uid, r=rid, b=bytes_, k=key or nid()))
def finish_o(w, rid, key=None, uid=A):
    return obj(T(w.d, "finish_handout_original(:r, :k)", uid, r=rid, k=key or nid()))
def queued(d, path): return d.all('select bucket, reason, done from submission_file_removal where path = :p', p=path)
def opath(w, rid, c=None): return '%s/%s.pdf' % (c or w.c, rid)
def as_teacher_insert(d, uid, name, bucket=BUCKET, mime='application/pdf'):
    e = refused(d, lambda: d.role('authenticated', "insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', 10, 'mimetype', :m::text))", uid, b=bucket, n=name, m=mime))
    return 'ok' if e is None else e[1]
def as_role_count(d, role, uid, name):
    return d.role(role, 'select count(*) from storage.objects where name = :n', uid, n=name)[0][0]
def row(d, rid): return d.all('select original_status, bytes, original_started_at is not null from assessment_resource where id = :r', r=rid)[0]

# == teacher ==
def scen_teacher():
    w = world('teacher', with_file=False); d = w.d
    try:
        pdf_before = obj(d.one('select _assessment_resource_json(:r)', r=w.pdf)); link_before = obj(d.one('select _assessment_resource_json(:r)', r=w.link))
        list_before = obj(T(d, 'list_course_resources(:c)', c=w.c))
        r = d.file(FILE); ok('teacher: (setup) the file applies', r == 'ok', r)
        ok('teacher: a PDF\'s and a link\'s rows answer exactly as before the file',
           obj(d.one('select _assessment_resource_json(:r)', r=w.pdf)) == pdf_before and obj(d.one('select _assessment_resource_json(:r)', r=w.link)) == link_before
           and obj(T(d, 'list_course_resources(:c)', c=w.c)) == list_before)
        ok('teacher: existing rows have no original', d.one('select count(*) from assessment_resource where original_status is not null or bytes is not null or original_started_at is not null') == 0)
        key = nid()
        s = start_o(w, w.pdf, 5000, key)
        ok('teacher: start answers the row, original uploading, with bucket, name, size and finish_by; the pages and status unchanged',
           s['original'] == 'uploading' and s['bucket'] == BUCKET and s['original_path'] == opath(w, w.pdf) and s['original_bytes'] == 5000
           and s.get('original_finish_by') and s['status'] == 'ready' and s['kind'] == 'pdf' and s['paths'] == pdf_before['paths'] and 'finish_by' not in s, s)
        ok('teacher: the same request sent twice is answered once', start_o(w, w.pdf, 5000, key) == s)
        s_again = start_o(w, w.pdf, 9999)
        ok('teacher: started again with another key: as it stands, not restarted', s_again['original_bytes'] == 5000 and row(d, w.pdf)[1] == 5000)
        for (b, want) in [(0, '20 MB'), (MAX + 1, '20 MB'), (None, '20 MB')]:
            p2 = ready_pdf(w, 'P', 1, a=w.a2)
            e = refused(d, lambda: T(d, "start_handout_original(:r, :b, gen_random_uuid())", r=p2, b=b))
            ok('teacher: start refuses %s bytes' % b, e and want in e[0] and e[1] == '22023', e)
        p3 = ready_pdf(w, 'Big', 1, a=w.a2)
        ok('teacher: 20 MB exactly is taken', start_o(w, p3, MAX)['original_bytes'] == MAX)
        e = refused(d, lambda: T(d, "start_handout_original(:r, 10, gen_random_uuid())", B, r=w.pdf))
        ok('teacher: another teacher\'s handout: not found', e and e[1] == 'P0002', e)
        e = refused(d, lambda: T(d, "start_handout_original(:r, 10, gen_random_uuid())", '', r=w.pdf))
        ok('teacher: signed out: refused', e and e[1] == 'PT401', e)
        e = refused(d, lambda: d.role('anon', "select start_handout_original(:r, 10, gen_random_uuid())", r=w.pdf))
        ok('teacher: a visitor cannot run it', e and 'permission denied' in e[0], e)
        e = refused(d, lambda: T(d, "start_handout_original(:r, 10, gen_random_uuid())", r=w.link))
        ok('teacher: a link: not found', e and e[1] == 'P0002', e)
        up = obj(T(d, "start_handout_upload(:a, 'Half', 1, gen_random_uuid())", a=w.a2))
        e = refused(d, lambda: T(d, "start_handout_original(:r, 10, gen_random_uuid())", r=up['id']))
        ok('teacher: pages not finished: refused', e and e[1] == '22023' and 'pages' in e[0], e)
        # finish: missing, bad, ready
        f = finish_o(w, w.pdf)
        ok('teacher: finish before the upload: missing', f.get('missing') is True and f['original'] == 'uploading', f)
        put_object(w, opath(w, w.pdf), 4800, 'text/html')
        f = finish_o(w, w.pdf); ok('teacher: a stored file of another type: bad', f.get('bad') is True and f['original'] == 'uploading', f)
        d.run("update storage.objects set metadata = jsonb_build_object('size', :s::bigint, 'mimetype', 'application/pdf') where name = :n", s=MAX + 1, n=opath(w, w.pdf))
        ok('teacher: a stored file over 20 MB: bad', finish_o(w, w.pdf).get('bad') is True)
        d.run("update storage.objects set metadata = jsonb_build_object('size', 4800, 'mimetype', 'application/pdf') where name = :n", n=opath(w, w.pdf))
        fk = nid(); f = finish_o(w, w.pdf, fk)
        ok('teacher: the file in storage: ready, bytes its stored size, no original_finish_by', f['original'] == 'ready' and f['original_bytes'] == 4800
           and 'original_finish_by' not in f and f['status'] == 'ready', f)
        ok('teacher: finish sent twice: the same answer', finish_o(w, w.pdf, fk) == f)
        ok('teacher: finish by another teacher: gone', finish_o(w, w.pdf, uid=B) == {'id': w.pdf, 'status': 'gone'})
        ok('teacher: finish of a link\'s id: gone', finish_o(w, w.link)['status'] == 'gone')
        ok('teacher: finish of a PDF that never started: the row, no original key', 'original' not in finish_o(w, p3 if False else ready_pdf(w, 'N', 1, a=w.a2)))
        mine = [x for x in obj(T(d, 'list_course_resources(:c)', c=w.c)) if x['id'] == w.pdf]
        ok('teacher: the list has it, with its original', mine and mine[0]['original'] == 'ready' and mine[0]['original_path'] == opath(w, w.pdf), mine)
        ok('teacher: the list of another teacher\'s class is refused', refused(d, lambda: T(d, 'list_course_resources(:c)', B, c=w.c)) is not None)
        ok('teacher: start after ready answers ready, nothing changes', start_o(w, w.pdf, 77)['original'] == 'ready' and row(d, w.pdf)[1] == 4800)
        for sql in ["insert into assessment_resource (assessment_id, course_id, kind, title, page_count, original_status, status, position) values (:a, :c, 'pdf', 'x', 2, 'ready', 'ready', 99)",
                    "insert into assessment_resource (assessment_id, course_id, kind, title, page_count, original_status, original_started_at, bytes, status, position) values (:a, :c, 'pdf', 'x', 2, 'bogus', now(), 5, 'ready', 99)",
                    "insert into assessment_resource (assessment_id, course_id, kind, title, url, original_status, original_started_at, bytes, status, position) values (:a, :c, 'link', 'x', 'https://x.y', 'ready', now(), 5, 'ready', 99)",
                    "insert into assessment_resource (assessment_id, course_id, kind, title, bytes, original_status, original_started_at, status, position) values (:a, :c, 'txt', 'x', 5, 'ready', now(), 'ready', 99)",
                    "insert into assessment_resource (assessment_id, course_id, kind, title, page_count, original_status, original_started_at, bytes, status, position) values (:a, :c, 'pdf', 'x', 2, 'dropped', now(), 5, 'ready', 99)",
                    "insert into assessment_resource (assessment_id, course_id, kind, title, page_count, original_status, original_started_at, bytes, status, position) values (:a, :c, 'pdf', 'x', 2, 'ready', now(), 5, 'uploading', 99)"]:
            ok('teacher: the shape check refuses: ' + sql[sql.index('values'):][:90], refused(d, lambda sql=sql: d.run(sql, a=w.a, c=w.c)) is not None)
        ok('teacher: a PDF with no original, a dropped one and a ready one are allowed by the check',
           refused(d, lambda: d.run("insert into assessment_resource (assessment_id, course_id, kind, title, page_count, original_status, original_started_at, status, position) values (:a, :c, 'pdf', 'x', 2, 'dropped', now(), 'ready', 99)", a=w.a, c=w.c)) is None)
    finally:
        d.close()

# == storage ==
def scen_storage():
    w = world('storage'); d = w.d
    try:
        ok('storage: the bucket takes the four types, still private and 20 MB',
           d.all("select public, file_size_limit, allowed_mime_types::text from storage.buckets where id = :b", b=BUCKET)
           == [[False, MAX, '{text/html,text/plain,application/epub+zip,application/pdf}']])
        ok('storage: the four policies are as 2026111706 made them (ten in all)',
           d.one("select string_agg(polname, ',' order by polname collate \"C\") from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'fv_handout_files%'")
           == ','.join(sorted(POLICIES)) and d.one("select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'fv_handout%'") == 6)
        rid = ready_pdf(w, 'P', 2); p = opath(w, rid)
        ok('storage: before the start, A cannot write the name', as_teacher_insert(d, A, p) == '42501')
        start_o(w, rid, 1000)
        ok('storage: Teacher B cannot write A\'s original\'s name', as_teacher_insert(d, B, p) == '42501')
        ok('storage: A cannot write another name: a second resource id', as_teacher_insert(d, A, opath(w, nid())) == '42501')
        ok('storage: A cannot write the name with another kind', as_teacher_insert(d, A, p[:-3] + 'html', mime='text/html') == '42501')
        ok('storage: A cannot write it into student-photos', as_teacher_insert(d, A, p, bucket='student-photos') == '42501')
        ok('storage: a visitor cannot write it', refused(d, lambda: d.role('anon', "insert into storage.objects (bucket_id, name) values (:b, :n)", b=BUCKET, n=p)) is not None)
        ok('storage: A cannot write a name in upper case', as_teacher_insert(d, A, p.upper()) == '42501')
        ok('storage: A writes exactly its name while it uploads', as_teacher_insert(d, A, p) == 'ok')
        ok('storage: A reads it; B and a visitor do not', as_role_count(d, 'authenticated', A, p) == 1 and as_role_count(d, 'authenticated', B, p) == 0
           and as_role_count(d, 'anon', None, p) == 0)
        ch = d.role('authenticated', "update storage.objects set metadata = '{}' where name = :n returning 1", A, n=p)
        de = d.role('authenticated', "delete from storage.objects where name = :n returning 1", A, n=p)
        ok('storage: A can neither change nor delete it', ch == [] and de == [] and d.one('select count(*) from storage.objects where name = :n', n=p) == 1, (ch, de))
        f = finish_o(w, rid); ok('storage: (setup) finished', f['original'] == 'ready', f)
        ok('storage: once ready the name cannot be written again', as_teacher_insert(d, A, p) == '42501')
        ok('storage: A still reads it once ready', as_role_count(d, 'authenticated', A, p) == 1)
        r2 = ready_pdf(w, 'Q', 1); start_o(w, r2, 10)
        d.run("update assessment_resource set original_started_at = now() - interval '2 hours 1 minute' where id = :r", r=r2)
        ok('storage: past its two hours the name cannot be written', as_teacher_insert(d, A, opath(w, r2)) == '42501')
        r3 = ready_pdf(w, 'R', 1); start_o(w, r3, 10)
        d.run("update assessment_resource set original_status = 'dropped', bytes = null where id = :r", r=r3)
        ok('storage: a dropped original\'s name cannot be written', as_teacher_insert(d, A, opath(w, r3)) == '42501')
        ok('storage: a handout file (html) is still written as before: one still uploading',
           as_teacher_insert(d, A, '%s/%s.html' % (w.c, obj(T(d, "start_handout_file(:a, 'x', 'html', 10, gen_random_uuid())", a=w.a))['id']), mime='text/html') == 'ok')
        su = d.other(); su.run("create policy careless on storage.objects for all to public using (true) with check (true)")
        try:
            ok('storage: with a careless policy, B still reads nothing of A\'s original, a visitor nothing',
               as_role_count(d, 'authenticated', B, p) == 0 and as_role_count(d, 'anon', None, p) == 0)
            ok('storage: with a careless policy, nobody writes an unissued original name',
               as_teacher_insert(d, B, opath(w, nid(), w.cb)) == '42501' and as_teacher_insert(d, A, opath(w, nid())) == '42501'
               and as_teacher_insert(d, A, opath(w, r3)) == '42501')
            de = d.role('authenticated', "delete from storage.objects where name = :n returning 1", B, n=p)
            ok('storage: with a careless policy, B still cannot delete A\'s original', de == [], de)
        finally:
            su.run('drop policy careless on storage.objects'); su.close()
        ok('storage: the new helpers are run by nobody; the policy helpers by a teacher, not a visitor',
           not any(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=x) for r in ('anon', 'authenticated', 'service_role', 'public')
                   for x in ('public._handout_original_path(uuid,uuid)', 'fv_private.handout_original_parts(text)'))
           and all(d.one("select has_function_privilege('authenticated', :s, 'execute') and not has_function_privilege('anon', :s, 'execute')", s=x)
                   for x in ('fv_private.handout_file_upload_allowed(text)', 'fv_private.handout_file_read_allowed(text)')))
    finally:
        d.close()

# == student ==
def scen_student():
    w = world('student'); d = w.d
    try:
        def H(rid, tok=None, enr=None): return obj(S(d, "student_submit.handout_original(:t, :e, :r, 'ip')", t=tok or w.t1, e=enr or w.e1, r=rid))
        old = w.pdf
        ok('student: an older PDF (no original): ok, has_original false, nothing else', H(old) == {'ok': True, 'has_original': False, 'resource_id': old}, H(old))
        rid = ready_pdf(w, 'Worksheet', 2)
        ok('student: a PDF whose original was not started: has_original false', H(rid)['has_original'] is False)
        start_o(w, rid, 1500)
        ok('student: while it uploads: has_original false', H(rid)['has_original'] is False)
        put_object(w, opath(w, rid), 1500); finish_o(w, rid)
        r = H(rid)
        ok('student: a ready original: bucket, path, size, title, ids',
           r == {'ok': True, 'has_original': True, 'bucket': BUCKET, 'resource_id': rid, 'assessment_id': w.a, 'title': 'Worksheet', 'bytes': 1500, 'path': opath(w, rid)}, r)
        d.run("update assessment_resource set original_status = 'dropped', bytes = null where id = :r", r=rid)
        ok('student: a dropped original: has_original false', H(rid)['has_original'] is False)
        d.run("update assessment_resource set original_status = 'ready', bytes = 1500 where id = :r", r=rid)
        ok('student: a link: not_found', H(w.link) == {'ok': False, 'error': 'not_found'})
        ok('student: an unknown id: not_found', H(nid())['error'] == 'not_found')
        ok('student: another class\'s session: not_found', H(rid, w.t2, w.e2)['error'] == 'not_found')
        bad = H(rid, 'x' * 80)
        ok('student: a bad session: its error, nothing else', bad.get('ok') is False and bad.get('error') not in (None, 'not_found') and 'path' not in bad, bad)
        ok('student: a classmate\'s enrollment with this session: refused', H(rid, w.t1, w.e2).get('ok') is False and 'path' not in H(rid, w.t1, w.e2))
        up = obj(T(d, "start_handout_upload(:a, 'Half', 1, gen_random_uuid())", a=w.a))
        ok('student: a PDF still uploading its pages: not_found', H(up['id'])['error'] == 'not_found')
        d.run("update assessment set date_assigned = current_date + 3 where id = :a", a=w.a)
        ok('student: a piece dated into the future: not_found', H(rid)['error'] == 'not_found')
        d.run("update assessment set date_assigned = null, is_draft = true where id = :a", a=w.a)
        ok('student: a Draft: not_found', H(rid)['error'] == 'not_found')
        d.run("update assessment set is_draft = false where id = :a", a=w.a)
        ok('student: restored: answers again', H(rid)['has_original'] is True)
        ok('student: who may run it: only service_role (and nobody else)',
           d.one("select has_function_privilege('service_role', :s, 'execute')", s=NEW[4]) and
           not any(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=NEW[4]) for r in ('anon', 'authenticated', 'public')))
        ok('student: stable, security definer, search_path pinned',
           d.all("select provolatile, prosecdef, proconfig::text from pg_proc where oid = to_regprocedure(:s)", s=NEW[4]) == [['s', True, '{"search_path=public, student_submit, pg_temp"}']])
        # the old routes unchanged: a PDF still opens with handout_links
        links = obj(S(d, "student_submit.handout_links(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=rid))
        ok('student: handout_links still answers the pages of the same PDF', links['ok'] and links['page_count'] == 2 and len(links['pages']) == 2, links)
        page = obj(S(d, "student_submit.page(:t, :e, 'ip')", t=w.t1, e=w.e1))
        res = [x for x in page['assessments'] if x['id'] == w.a][0]['resources']
        ok('student: page lists the PDF as before (kind pdf, no original key)', any(x['id'] == rid and x['kind'] == 'pdf' for x in res)
           and not any('original' in json.dumps(x) for x in res), res)
    finally:
        d.close()

# == lifecycle ==
def scen_lifecycle():
    w = world('life'); d = w.d
    try:
        rid = ready_pdf(w, 'Gone', 2, original=True); p = opath(w, rid)
        r = obj(T(d, 'remove_assessment_resource(:r, gen_random_uuid())', r=rid))
        ok('life: Remove queues the pages and the original, in their own buckets',
           r == {'removed': True} and queued(d, p) == [[BUCKET, 'handout_removed', False]]
           and d.one("select count(*) from submission_file_removal where bucket = 'student-photos' and path like :p", p='%/handouts/' + rid + '/%') == 2)
        old = ready_pdf(w, 'Old', 1, original=False); T(d, 'remove_assessment_resource(:r, gen_random_uuid())', r=old)
        ok('life: removing a PDF with no original queues no original', queued(d, opath(w, old)) == [])
        up = ready_pdf(w, 'Half', 1); start_o(w, up, 10); T(d, 'remove_assessment_resource(:r, gen_random_uuid())', r=up)
        ok('life: removing a PDF whose original is still uploading queues its name', len(queued(d, opath(w, up))) == 1)
        x = ready_pdf(w, 'Del', 1, original=True, a=w.a2)
        T(d, 'delete_assessment(:a)', a=w.a2)
        ok('life: delete_assessment queues the original', len(queued(d, opath(w, x))) == 1 and d.one('select count(*) from assessment_resource where id = :r', r=x) == 0)
        z = ready_pdf(w, 'Purged', 1, original=True)
        d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c)
        try: d.run('select fv_retention_cleanup()')
        except Exception as e: ok('life: (setup) purge ran', False, message(e))
        ok('life: the 30-day purge of the class queues the original', len(queued(d, opath(w, z))) == 1 and d.one('select count(*) from assessment_resource where id = :r', r=z) == 0, queued(d, opath(w, z)))
        d.run("update course set deleted_at = null where id = :c", c=w.c) if d.one('select count(*) from course where id = :c', c=w.c) else None
    finally:
        d.close()
    w = world('life2'); d = w.d
    try:
        ok_ = ready_pdf(w, 'Fine', 2, original=True)
        slow = ready_pdf(w, 'Slow', 2); start_o(w, slow, 1000)
        d.run("update assessment_resource set original_started_at = now() - interval '2 hours 1 minute' where id = :r", r=slow)
        n = d.one('select _handout_drop_expired(:c)', c=w.c)
        ok('life: an original not stored in two hours is dropped: the row stays, its size goes, its name is queued; the answer counts rows deleted (0)',
           n == 0 and row(d, slow)[0] == 'dropped' and row(d, slow)[1] is None and queued(d, opath(w, slow)) == [[BUCKET, 'handout_expired', False]]
           and d.one('select count(*) from assessment_resource where id = :r', r=slow) == 1, (n, row(d, slow)))
        ok('life: a ready original and an old PDF are not dropped', row(d, ok_)[0] == 'ready' and row(d, w.pdf)[0] is None)
        e = start_o(w, slow, 10)
        ok('life: a dropped original is never restarted: started again it answers dropped', e['original'] == 'dropped' and row(d, slow)[0] == 'dropped')
        ok('life: finish of a dropped original: dropped, no error', finish_o(w, slow)['original'] == 'dropped')
        ok('life: the pages of the dropped one still answer', len(obj(T(d, "list_course_resources(:c)", c=w.c)) and [x for x in obj(T(d, "list_course_resources(:c)", c=w.c)) if x['id'] == slow][0]['paths']) == 2)
        ok('life: a second drop queues nothing more', d.one('select _handout_drop_expired(:c)', c=w.c) == 0 and len(queued(d, opath(w, slow))) == 1)
        s = ready_pdf(w, 'Late', 1); start_o(w, s, 1000)
        d.run("update assessment_resource set original_started_at = now() - interval '2 hours 1 minute' where id = :r", r=s)
        ok('life: finish after two hours drops it too', finish_o(w, s)['original'] == 'dropped')
        # the nightly job visits a class that has nothing but an original still uploading
        t = ready_pdf(w, 'Nightly', 1); start_o(w, t, 1000)
        d.run("update assessment_resource set original_started_at = now() - interval '3 hours' where id = :r", r=t)
        try: d.run('call photo_lifecycle_nightly()')
        except Exception as e: ok('life: (setup) the nightly job ran', False, message(e))
        ok('life: the nightly job drops an unfinished original in a class with no photos', row(d, t)[0] == 'dropped' and len(queued(d, opath(w, t))) == 1, row(d, t))
        # the worker
        item = d.all("select id from submission_file_removal where path = :p", p=opath(w, slow))[0][0]
        d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute' where id = :i", i=item)
        put_object(w, opath(w, slow))
        r = obj(S(d, 'student_submit.removal_done(array[:i]::bigint[])', i=item))
        ok('life: removal_done asks handout-files: the original still stored is not done', r['gone'] == 0 and item in r['still_there'], r)
        d.run("delete from storage.objects where name = :n", n=opath(w, slow))
        r = obj(S(d, 'student_submit.removal_done(array[:i]::bigint[])', i=item))
        ok('life: gone from storage: done', r['gone'] == 1 and d.one('select done from submission_file_removal where id = :i', i=item), r)
    finally:
        d.close()

# == apply ==
def scen_apply():
    import time
    w = world('apply', with_file=False); d = w.d
    try:
        text = text_of(FILE)
        ok('apply: plain ASCII, no backslash, no unicode escape', text.isascii() and chr(92) not in text and 'u&' not in text.lower())
        ok('apply: small enough to send whole (under 50 KB, as 2026111706 was)', len(text.encode()) < 50000, len(text.encode()))
        d.run('create table pre_rows as select * from assessment_resource')
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        mutations = {
            'a relied function changed': "create or replace function public._work_hold() returns interval language sql immutable as $$ select interval '3 hours' $$",
            'a replaced function changed': "create or replace function public._handout_drop_expired(p_course_id uuid) returns integer language sql as $$ select 0 $$",
            'the file of 2026111706 not applied': 'drop function public.finish_handout_file(uuid, uuid)',
            'a function of this file\'s name with other arguments': "create function public.handout_original(x int) returns int language sql as $$ select 1 $$",
            'a column of this file\'s name of another type': 'alter table assessment_resource add column original_status int',
            'the bucket not as 2026111706 made it': "update storage.buckets set file_size_limit = 5 where id = 'handout-files'",
            'a pdf already in the bucket': "insert into storage.objects (bucket_id, name) values ('handout-files', 'x/y.pdf')",
            'a policy missing': 'drop policy fv_handout_files_fence on storage.objects',
            'the shape check as something else': "alter table assessment_resource drop constraint assessment_resource_shape_check, add constraint assessment_resource_shape_check check (true)",
        }
        for name, sql in mutations.items():
            d.run('begin'); d.run(sql)
            r = d.statements(split(text)); d.run('rollback')
            ok('apply: the guard stops: ' + name, r.startswith('STOPPED') and 'Nothing was changed' in r, r[:300])
        ok('apply: (guards) the catalog and rows are as they were', quiet(differences(cat0, catalog(d.c))) == ([], []) and row_checksums(d.c) == rows0)
        for name, sql in list(mutations.items())[:3] + list(mutations.items())[5:7]:
            d.run('begin'); d.run(sql); d.file(PRE); n = len(d.rows); d.run('rollback')
            ok('apply: the pre-check names it: ' + name, n > 0, n)
        d.file(PRE); ok('apply: the pre-check is empty before', d.rows == [], d.rows)
        d.file(FPS); ok('apply: the fingerprints query is empty before', d.rows == [], d.rows)
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c))
        known = ('original', 'assessment_resource', 'handout_file', 'drop_expired', 'nightly', 'handout-files', 'depends', 'comments')
        ok('apply: the catalog changes only in what the header names', all(any(k in l for k in known) for l in gone + new),
           [l[:200] for l in gone + new if not any(k in l for k in known)])
        ok('apply: no existing row changed or gained an original; no other table\'s rows changed',
           d.one('select count(*) from assessment_resource where original_status is not null or original_started_at is not null or bytes is not null') == 0
           and d.one('select count(*) from assessment_resource') == d.one('select count(*) from pre_rows')
           and all(rows0[k] == v for k, v in row_checksums(d.c).items() if k in rows0 and k not in ('public.assessment_resource', 'public.pre_rows', 'storage.buckets')))
        cat1 = catalog(d.c)
        got = {s: md5(d, s) for s in REPLACES + NEW}
        listed = dict(re.findall(r"\('([^']+)', '([0-9a-f]{32})'\)", text.split('FINGERPRINTS-BEGIN after')[1].split('FINGERPRINTS-END')[0]))
        ok('apply: the md5s the file carries are the ones the database has', listed == got, [k for k in got if listed.get(k) != got[k]])
        r2 = d.file(FILE); dd = quiet(differences(cat1, catalog(d.c)))
        ok('apply: a second run applies and changes nothing', r2 == 'ok' and dd == ([], []), (r2, [[l[:200] for l in s] for s in dd]))
        r = d.file(POST); bad = [x for x in d.rows if x[1] != 'ok']
        ok('apply: the post-check: every row ok (%d rows)' % len(d.rows), r == 'ok' and d.rows and not bad, bad[:3])
        d.file(FPS); ok('apply: the fingerprints query after names the six replaced functions only', {x[0] for x in d.rows} == set(REPLACES), [x[0] for x in d.rows])
        d.file(PRE); ok('apply: the pre-check after names what is already there', len(d.rows) > 0)
        r = d.file(UNDO); ok('apply: (setup) undone', r == 'ok' and not applied(d), r)
        trips = {
            'a function md5': text.split('do $final$')[0] + 'do $final$' + text.split('do $final$')[1].replace(got[NEW[0]], '0' * 32, 1),
            'the bucket types': text.split('do $final$')[0] + 'do $final$' + text.split('do $final$')[1].replace("'application/epub+zip', 'application/pdf']", "'application/epub+zip', 'application/zip']"),
        }
        for name, bad_text in trips.items():
            if bad_text == text:
                ok('apply: (setup) the trip changes the text: ' + name, False); continue
            r = d.statements(split(bad_text))
            ok('apply: the last check or a guard stops it, nothing left: ' + name, r.startswith('STOPPED') and not applied(d), r[:300])
        dd = quiet0(differences(cat0, catalog(d.c)))
        ok('apply: (after the trips) the catalog is as before the file', dd == ([], []), [[l[:200] for l in s] for s in dd])
        c2 = d.other(); c2.run('begin'); c2.run('lock table assessment_resource in access exclusive mode')
        t0 = time.time(); r = d.file(FILE); c2.run('rollback'); c2.close()
        ok('apply: a lock held elsewhere: gives up in about five seconds, nothing applied',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 <= time.time() - t0 < 12 and not applied(d), (r, time.time() - t0))
    finally:
        d.close()

# == undo ==
def scen_undo():
    w = world('undo', with_file=False); d = w.d
    try:
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        r = d.file(UNDO); ok('undo: on a database where the file was never applied, nothing changes', r == 'ok' and differences(cat0, catalog(d.c)) == ([], []), r)
        r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
        rid = ready_pdf(w, 'P', 2, original=True)
        r = d.file(UNDO)
        ok('undo: refuses while an original is held, nothing changed', r.startswith('STOPPED') and 'original' in r and applied(d), r)
        dp = ready_pdf(w, 'Dropped', 1); start_o(w, dp, 10)
        d.run("update assessment_resource set original_started_at = now() - interval '3 hours' where id = :r", r=dp)
        d.one('select _handout_drop_expired(:c)', c=w.c)
        ok('undo: (setup) one original dropped', row(d, dp)[0] == 'dropped')
        T(d, 'remove_assessment_resource(:r, gen_random_uuid())', r=rid)
        r = d.file(UNDO)
        ok('undo: refuses while a removal is not done', r.startswith('STOPPED') and applied(d), r)
        d.run("delete from submission_file_removal where path = any (:p)", p=[opath(w, rid), opath(w, dp)])
        d.run("delete from storage.objects where bucket_id = 'handout-files'")
        part = part0()
        r = d.statements(split('begin;\n' + part + '\ncommit;'))
        ok('undo: PART 0 alone takes the two writes from teachers and nothing else',
           r == 'ok' and not d.one("select has_function_privilege('authenticated', 'public.start_handout_original(uuid,bigint,uuid)', 'execute')")
           and not d.one("select has_function_privilege('authenticated', 'public.finish_handout_original(uuid,uuid)', 'execute')") and d.one("select has_function_privilege('service_role', 'student_submit.handout_original(text,uuid,uuid,text)', 'execute')"), r)
        r = d.file(UNDO)
        ok('undo: the full undo applies', r == 'ok' and not applied(d), r)
        cat2 = catalog(d.c)
        gone, new = differences(cat0, cat2)
        ok('undo: the catalog is as before the file, but two dropped-column slots and the bucket\'s types', not [l for l in gone + new if 'attisdropped' in l] and
           all('original' in l or 'assessment_resource' in l for l in gone + new), [l[:200] for l in gone + new][:6])
        ok('undo: the bucket takes the three types again', d.one("select allowed_mime_types = array['text/html', 'text/plain', 'application/epub+zip'] from storage.buckets where id = 'handout-files'"))
        ok('undo: a dropped original is cleared, its handout stays', d.one('select count(*) from assessment_resource where id = :r', r=dp) == 1)
        ok('undo: the old PDF row is as before', d.one("select count(*) from assessment_resource where id = :r and kind = 'pdf'", r=w.pdf) == 1)
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and differences(cat2, catalog(d.c)) == ([], []))
        r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and applied(d), r)
        rid = ready_pdf(w, 'P2', 1, original=True)
        ok('undo: and works again', row(d, rid)[0] == 'ready')
    finally:
        d.close()

# == collations ==
def scen_collations():
    import subprocess
    icu, c = os.environ.get('FV_ICU_DB'), os.environ.get('FV_C_DB')
    if not (icu and c): print('collations: set FV_ICU_DB and FV_C_DB'); return
    outs = {}
    for name in (icu, c):
        r = subprocess.run([sys.executable, os.path.join(HERE, 'handout_pdf_original.py'), 'collation_probe'], capture_output=True, text=True,
                           env=dict(os.environ, PGDATABASE=name), cwd=HERE)
        outs[name] = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:]
    ok('collations: the same post-check, md5s and answers under ICU en-US and under C', outs[icu] == outs[c] and 'ok' in outs[icu], outs)

def scen_collation_probe():
    w = world('probe'); d = w.d
    try:
        rid = ready_pdf(w, 'P', 2, original=True)
        d.file(POST); post = [tuple(x) for x in d.rows]
        s = obj(S(d, "student_submit.handout_original(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=rid))
        blob = json.dumps([post, s, {x: md5(d, x) for x in REPLACES + NEW}], sort_keys=True, default=str)
        blob = blob.replace(w.c, 'C').replace(rid, 'R').replace(w.a, 'A')
        print('ok', hashlib.md5(blob.encode()).hexdigest())
    finally:
        d.close()

SCENARIOS = {'teacher': scen_teacher, 'storage': scen_storage, 'student': scen_student, 'lifecycle': scen_lifecycle, 'apply': scen_apply,
             'undo': scen_undo, 'collations': scen_collations}
if __name__ == '__main__':
    args = sys.argv[1:]
    edge_role = os.environ.get('FV_EDGE_ROLE', 'yes') == 'yes'
    c0 = connect('postgres')
    if edge_role and not c0.run("select 1 from pg_roles where rolname = 'fv_student_submit'"): c0.run('create role fv_student_submit nologin')
    c0.close()
    if args == ['fingerprints']: scen_fingerprints(); sys.exit(0)
    if args == ['collation_probe']: scen_collation_probe(); sys.exit(0)
    for name in (args or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
