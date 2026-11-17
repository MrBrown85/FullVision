"""Handout files: migrations/2026111706_handout_files.sql on a database rebuilt from the repo and proved
equal to live (scripts/db-rebuild.mjs --check; README.md, "Handout files").

    PGPORT=<port> PGDATABASE=<db> python3 handout_files.py fingerprints   write the md5 lists the four files carry
    PGPORT=<port> PGDATABASE=<db> python3 handout_files.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 handout_files.py teacher        or some

The database named by PGDATABASE is only a template (it has 2026111705, as live does): every scenario runs on
its own copy, made and dropped here. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  teacher   start_handout_file and finish_handout_file: what each answers and refuses (kind, size, name, 50 a
            piece, another teacher, signed out), a request sent twice, missing and bad files, the list, Remove;
            a PDF's and a link's rows answer exactly as before the file.
  storage   the four policies: the exact name a teacher may write and when, no overwrite, change or delete,
            who reads, a visitor, the other bucket untouched, and the two restricting policies against a
            careless policy.
  student   student_submit.handout_file for a ready file on a listed piece, and every refusal; page lists the
            file's kind; the old routes unchanged.
  lifecycle Remove, delete_assessment, the 30-day purge of the class and of the teacher, an upload never
            finished (dropped by the nightly job even in a class with no photos: differs without the file),
            Keep Photos Until a year on, the worker's removal_done for both buckets.
  apply     the guards stop with the catalog unchanged and the pre-check names them; only what the header
            names changes; no row; the md5s; a second run; pre-check and post-check; lock timeout; size.
  undo      PART 0, the stop; the full undo refuses while a file is held, then leaves the catalog and every
            row as before (but the bucket's row and a dropped-column slot); a second run; the file again.
"""
import json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, refused, ok, finish, nid, connect, message, sqlstate, split, text_of, KEY_ID
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111706_handout_files.sql'
UNDO = 'handout-files-undo.sql'
PRE = 'handout-files-live-precheck.sql'
POST = 'handout-files-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
BUCKET = 'handout-files'
MAX = 20971520

RELIED = ['public.fv_owns_assessment(uuid)', 'public.fv_owns_course(uuid)', 'public.fv_idem_check(uuid,text)',
          'public.fv_idem_store(uuid,text,jsonb)', 'public._grade_return_lock(uuid)', 'public._grade_return_lock_first(uuid)',
          'public._fv_timezone(text)', 'public._work_bucket()', 'public._work_hold()', 'public._handout_path(uuid,uuid,integer)',
          'public._assessment_resource_same_class()', 'public._assessment_resource_gone()', 'public._assessment_resource_truncated()',
          'public.remove_assessment_resource(uuid,uuid)', 'public.list_course_resources(uuid)',
          'public.start_handout_upload(uuid,text,integer,uuid)', 'public.finish_handout_upload(uuid,uuid)',
          'public._photo_keep_class(uuid,timestamp with time zone)', 'public._photo_strays(uuid,timestamp with time zone)',
          'public._photo_missing(uuid)', 'public._photo_stuck()', 'public._photo_log(uuid,text,integer,jsonb)',
          'public.delete_assessment(uuid)', 'public.fv_retention_cleanup()', 'student_submit._session_class(text,uuid)',
          'student_submit._listed(assessment,date)', 'student_submit.removal_batch(integer)',
          'student_submit.handout_links(text,uuid,uuid,text)', 'student_submit.page(text,uuid,text)']
REPLACES = ['public._assessment_resource_json(uuid)', 'public._assessment_resource_removed()', 'public._handout_drop_expired(uuid)',
            'student_submit.removal_done(bigint[])', 'public.photo_lifecycle_nightly()']
NEW = ['public._handout_file_bucket()', 'public._handout_file_max_bytes()', 'public._handout_file_mime(text)',
       'public._handout_file_path(uuid,uuid,text)', 'fv_private.handout_file_path_parts(text)', 'public._handout_file_object(text)',
       'fv_private.handout_file_upload_allowed(text)', 'fv_private.handout_file_read_allowed(text)',
       'public.start_handout_file(uuid,text,text,bigint,uuid)', 'public.finish_handout_file(uuid,uuid)',
       'student_submit.handout_file(text,uuid,uuid,text)']
POLICIES = ['fv_handout_files_read', 'fv_handout_files_upload', 'fv_handout_files_teachers_only', 'fv_handout_files_fence']
SHAPE_SQL = """select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint
                where conrelid = 'public.assessment_resource'::regclass
                  and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check')"""

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def defn(d, sig): return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def S(d, sql, **kw): return d.service(sql, **kw)
def applied(d): return d.one("select to_regprocedure('public.start_handout_file(uuid,text,text,bigint,uuid)') is not null")
def obj(v): return json.loads(v) if isinstance(v, str) else v
def without_final(text):
    a = text.index('do $final$'); b = text.index('$final$;', a + 12) + len('$final$;')
    return text[:a] + text[b:]
def part0(): return text_of(UNDO).split('-- PART 0 begins')[1].split('-- PART 0 ends')[0]

# ── The md5 lists the four files carry ───────────────────────────────────────────────────────────────
def put_list(text, name, rows):
    """Replace the lines between '-- FINGERPRINTS-BEGIN <name>' and the next '-- FINGERPRINTS-END' with rows."""
    pat = re.compile(r'(-- FINGERPRINTS-BEGIN %s[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)' % re.escape(name), re.S)
    m = pat.search(text)
    if not m: sys.exit('no list %s' % name)
    indent = re.match(r'[ \t]*', m.group(2)).group(0)
    body = (',\n').join(indent + r for r in rows)
    return text[:m.start(2)] + body + text[m.end(2):]

def q(s): return "'" + s.replace("'", "''") + "'"

def scen_fingerprints():
    d = Db('hf_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        relied = {s: md5(d, s) for s in RELIED}
        before = {s: md5(d, s) for s in REPLACES}
        old_defs = {s: defn(d, s) for s in REPLACES}
        shape_before = d.one(SHAPE_SQL)
        missing = [s for s, v in list(relied.items()) + list(before.items()) if v is None]
        if missing: sys.exit('not on the template: %s' % missing)
        path = os.path.join(HERE, FILE)
        text = open(path).read()
        text = put_list(text, 'relied', ['(%s, %s)' % (q(s), q(relied[s])) for s in RELIED])
        text = put_list(text, 'replaces', ['(%s, %s, %s)' % (q(s), q(before[s]), q('-')) for s in REPLACES])
        r = d.statements(split(without_final(text)))
        if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
        after = {s: md5(d, s) for s in REPLACES + NEW}
        shape_after = d.one(SHAPE_SQL)
        text = put_list(text, 'replaces', ['(%s, %s, %s)' % (q(s), q(before[s]), q(after[s])) for s in REPLACES])
        text = put_list(text, 'new', ['(%s, %s)' % (q(s), q(after[s])) for s in NEW])
        text = put_list(text, 'after', ['(%s, %s)' % (q(s), q(after[s])) for s in NEW + REPLACES])
        text = re.sub(r"(-- SHAPE-AFTER[^\n]*\n\s*)'(?:[^']|'')*'\) then", lambda m: m.group(1) + q(shape_after) + ') then', text, count=1, flags=re.S)
        open(path, 'w').write(text)
        # The pre-check: what live must still be; the post-check: what it must be after.
        p = os.path.join(HERE, PRE); t = open(p).read()
        t = put_list(t, 'precheck', ['(%s, %s)' % (q(s), q(v)) for s, v in list(relied.items()) + list(before.items())])
        t = re.sub(r"(-- SHAPE-BEFORE[^\n]*\n\s*)'(?:[^']|'')*'(\s*\)\s*select)", lambda m: m.group(1) + q(shape_before) + m.group(2), t, count=1, flags=re.S)
        open(p, 'w').write(t)
        p = os.path.join(HERE, POST); t = open(p).read()
        t = put_list(t, 'postcheck', ['(%s, %s)' % (q(s), q(v)) for s, v in list(relied.items()) + [(s, after[s]) for s in REPLACES + NEW]])
        t = re.sub(r"(-- SHAPE-AFTER[^\n]*\n\s*)'(?:[^']|'')*'(\s*then)", lambda m: m.group(1) + q(shape_after) + m.group(2), t, count=1, flags=re.S)
        open(p, 'w').write(t)
        # The undo: the md5s this file leaves, and the five definitions word for word.
        p = os.path.join(HERE, UNDO); t = open(p).read()
        t = put_list(t, 'undo-new', ['(%s, %s)' % (q(s), q(after[s])) for s in NEW])
        t = put_list(t, 'undo-replaced', ['(%s, %s, %s)' % (q(s), q(before[s]), q(after[s])) for s in REPLACES])
        a = t.index('-- OLD-DEFINITIONS-BEGIN'); a = t.index('\n', a) + 1; b = t.index('-- OLD-DEFINITIONS-END')
        t = t[:a] + ''.join(old_defs[s].rstrip() + ';\n\n' for s in REPLACES) + t[b:]
        t = re.sub(r"(-- SHAPE-AFTER[^\n]*\n\s*)'(?:[^']|'')*'(\s*then)", lambda m: m.group(1) + q(shape_after) + m.group(2), t, count=1, flags=re.S)
        open(p, 'w').write(t)
        print('written: relied %d, replaces %d, new %d' % (len(relied), len(before), len(NEW)))
    finally:
        d.close()

# ── The world ─────────────────────────────────────────────────────────────────────────────────────────
class W: pass

def session(d, e, c, teacher=A):
    code, _pw, _row = d.make(e, c, teacher)
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

def world(tag, with_file=True):
    d = Db('hf_' + tag)
    w = W(); w.d = d
    if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    # What Supabase gives every project: the storage tables open to the API roles, and the photos' bucket.
    d.run('grant select, insert, update, delete on storage.objects to anon, authenticated, service_role')
    d.run('grant select on storage.buckets to anon, authenticated, service_role')
    d.run("""insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('student-photos', 'student-photos', false, 2097152, array['image/jpeg']) on conflict do nothing""")
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=KEY_ID)
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
    # A PDF and a link made before the file, as live has them.
    w.pdf = str(T(d, "start_handout_upload(:a, 'Old PDF', 2, gen_random_uuid())", a=w.a)['id'])
    w.link = str(T(d, "add_assessment_link(:a, 'https://example.org/x', 'Old Link', gen_random_uuid())", a=w.a)['id'])
    w.t1 = session(d, w.e1, w.c)
    w.t2 = session(d, w.e2, w.c2)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def start(w, kind='html', bytes_=1000, title='Lesson Page', a=None, key=None, uid=A):
    return obj(T(w.d, "start_handout_file(:a, :t, :k, :b, :key)", uid, a=a or w.a, t=title, k=kind, b=bytes_, key=key or nid()))
def finish_(w, rid, key=None, uid=A):
    return obj(T(w.d, "finish_handout_file(:r, :key)", uid, r=rid, key=key or nid()))
MIME = {'html': 'text/html', 'txt': 'text/plain', 'epub': 'application/epub+zip'}
def put_file(w, path, kind='html', size=1000, mime=None, bucket=BUCKET):
    w.d.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', :s::bigint, 'mimetype', :m::text))",
            b=bucket, n=path, s=size, m=mime or MIME[kind])
def ready_file(w, kind='html', a=None, title='Lesson Page'):
    s = start(w, kind, a=a, title=title); put_file(w, s['path'], kind)
    f = finish_(w, s['id']); assert f['status'] == 'ready', f
    return s
def queued(d, path): return d.all('select bucket, reason, done from submission_file_removal where path = :p', p=path)
def as_teacher_insert(d, uid, name, bucket=BUCKET, mime='text/html'):
    e = refused(d, lambda: d.role('authenticated', "insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', 10, 'mimetype', :m::text))", uid, b=bucket, n=name, m=mime))
    return 'ok' if e is None else e[1]
def as_role_count(d, role, uid, name):
    return d.role(role, 'select count(*) from storage.objects where name = :n', uid, n=name)[0][0]

# ── teacher ───────────────────────────────────────────────────────────────────────────────────────────
def scen_teacher():
    w = world('teacher', with_file=False); d = w.d
    try:
        pdf_before = obj(d.one('select _assessment_resource_json(:r)', r=w.pdf)); link_before = obj(d.one('select _assessment_resource_json(:r)', r=w.link))
        list_before = obj(T(d, 'list_course_resources(:c)', c=w.c))
        r = d.file(FILE); ok('teacher: (setup) the file applies', r == 'ok', r)
        ok('teacher: a PDF\'s and a link\'s rows answer exactly as before the file',
           obj(d.one('select _assessment_resource_json(:r)', r=w.pdf)) == pdf_before and obj(d.one('select _assessment_resource_json(:r)', r=w.link)) == link_before
           and obj(T(d, 'list_course_resources(:c)', c=w.c)) == list_before)
        ok('teacher: existing rows have bytes null', d.one('select count(*) from assessment_resource where bytes is not null') == 0)
        key = nid()
        s = start(w, 'html', 5000, '  Lesson 1.1 Practice  ', key=key)
        ok('teacher: start answers the row, uploading, with bucket, path, bytes and finish_by',
           s['kind'] == 'html' and s['status'] == 'uploading' and s['bucket'] == BUCKET and s['path'] == '%s/%s.html' % (w.c, s['id'])
           and s['bytes'] == 5000 and s['title'] == 'Lesson 1.1 Practice' and s.get('finish_by') and s['page_count'] is None and s['url'] is None, s)
        ok('teacher: the same request sent twice is answered once', start(w, 'html', 5000, 'x', key=key) == s
           and d.one('select count(*) from assessment_resource where kind = :k', k='html') == 1)
        for (kind, b, t, want) in [('pdf', 10, 'x', 'web page'), ('exe', 10, 'x', 'web page'), (None, 10, 'x', 'web page'),
                                   ('txt', 0, 'x', '20 MB'), ('txt', MAX + 1, 'x', '20 MB'), ('txt', None, 'x', '20 MB'),
                                   ('epub', 10, 'x' * 201, '200 characters')]:
            e = refused(d, lambda: T(d, "start_handout_file(:a, :t, :k, :b, gen_random_uuid())", a=w.a, t=t, k=kind, b=b))
            ok('teacher: start refuses kind %s, %s bytes, a %d-letter name' % (kind, b, len(t)), e and want in e[0] and e[1] == '22023', e)
        ok('teacher: 20 MB exactly is taken', start(w, 'epub', MAX)['bytes'] == MAX)
        ok('teacher: no name is "Handout"', start(w, 'txt', 10, '   ')['title'] == 'Handout')
        e = refused(d, lambda: T(d, "start_handout_file(:a, 'x', 'html', 10, gen_random_uuid())", B, a=w.a))
        ok('teacher: another teacher\'s assessment: not found', e and e[1] == 'P0002', e)
        e = refused(d, lambda: T(d, "start_handout_file(:a, 'x', 'html', 10, gen_random_uuid())", '', a=w.a))
        ok('teacher: signed out: refused', e and e[1] == 'PT401', e)
        e = refused(d, lambda: d.role('anon', "select start_handout_file(:a, 'x', 'html', 10, gen_random_uuid())", a=w.a))
        ok('teacher: a visitor cannot run it', e and 'permission denied' in e[0], e)
        # missing, bad, ready
        f = finish_(w, s['id'])
        ok('teacher: finish before the upload: still uploading, missing', f['status'] == 'uploading' and f.get('missing') is True, f)
        put_file(w, s['path'], 'html', 4800, mime='text/plain')
        f = finish_(w, s['id']); ok('teacher: a stored file of another type: bad', f['status'] == 'uploading' and f.get('bad') is True, f)
        d.run("update storage.objects set metadata = jsonb_build_object('size', :s::bigint, 'mimetype', 'text/html') where name = :n", s=MAX + 1, n=s['path'])
        f = finish_(w, s['id']); ok('teacher: a stored file over 20 MB: bad', f.get('bad') is True, f)
        d.run("update storage.objects set metadata = jsonb_build_object('size', 4800, 'mimetype', 'text/html') where name = :n", n=s['path'])
        fk = nid(); f = finish_(w, s['id'], fk)
        ok('teacher: the file in storage: ready, bytes its stored size, no finish_by', f['status'] == 'ready' and f['bytes'] == 4800 and 'finish_by' not in f, f)
        ok('teacher: finish sent twice: the same answer', finish_(w, s['id'], fk) == f)
        ok('teacher: finish by another teacher: gone', finish_(w, s['id'], uid=B) == {'id': s['id'], 'status': 'gone'})
        ok('teacher: finish of a PDF\'s id: gone (a PDF finishes with finish_handout_upload)', finish_(w, w.pdf)['status'] == 'gone')
        lst = obj(T(d, 'list_course_resources(:c)', c=w.c))
        mine = [x for x in lst if x['id'] == s['id']]
        ok('teacher: the list has it, ready, with its path and size', mine and mine[0]['status'] == 'ready' and mine[0]['path'] == s['path'] and mine[0]['bytes'] == 4800, mine)
        ok('teacher: the list of another teacher\'s class is refused', refused(d, lambda: T(d, 'list_course_resources(:c)', B, c=w.c)) is not None)
        # 50 a piece, files counted
        n = d.one('select count(*) from assessment_resource where assessment_id = :a', a=w.a2)
        for i in range(50 - n): start(w, 'txt', 10, 'T%d' % i, a=w.a2)
        e = refused(d, lambda: start(w, 'txt', 10, 'one more', a=w.a2))
        ok('teacher: the 51st on one assessment is refused', e and '50' in e[0], e)
        r = obj(T(d, 'remove_assessment_resource(:r, gen_random_uuid())', r=s['id']))
        ok('teacher: Remove takes it, and its file is queued in handout-files', r == {'removed': True} and queued(d, s['path']) == [[BUCKET, 'handout_removed', False]], (r, queued(d, s['path'])))
        ok('teacher: the shape check refuses a file with pages or an address, or a PDF with bytes',
           all(refused(d, lambda sql=sql: d.run(sql, a=w.a, c=w.c)) for sql in [
               "insert into assessment_resource (assessment_id, course_id, kind, title, bytes, page_count, status, position) values (:a, :c, 'html', 'x', 5, 2, 'ready', 99)",
               "insert into assessment_resource (assessment_id, course_id, kind, title, bytes, url, status, position) values (:a, :c, 'txt', 'x', 5, 'https://x.y', 'ready', 99)",
               "insert into assessment_resource (assessment_id, course_id, kind, title, status, position) values (:a, :c, 'epub', 'x', 'ready', 99)",
               "insert into assessment_resource (assessment_id, course_id, kind, title, page_count, bytes, status, position) values (:a, :c, 'pdf', 'x', 2, 5, 'ready', 99)",
               "insert into assessment_resource (assessment_id, course_id, kind, title, bytes, status, position) values (:a, :c, 'docx', 'x', 5, 'ready', 99)"]))
    finally:
        d.close()

# ── storage ───────────────────────────────────────────────────────────────────────────────────────────
def scen_storage():
    w = world('storage'); d = w.d
    try:
        s = start(w, 'html'); p = s['path']
        ok('storage: the bucket is private, 20 MB, the three types',
           d.all("select public, file_size_limit, allowed_mime_types::text from storage.buckets where id = :b", b=BUCKET) == [[False, MAX, '{text/html,text/plain,application/epub+zip}']])
        ok('storage: Teacher B cannot write A\'s file\'s name', as_teacher_insert(d, B, p) == '42501')
        ok('storage: A cannot write another name: a second resource id', as_teacher_insert(d, A, '%s/%s.html' % (w.c, nid())) == '42501')
        ok('storage: A cannot write the name with another kind', as_teacher_insert(d, A, p[:-4] + 'epub') == '42501')
        ok('storage: A cannot write it into student-photos', as_teacher_insert(d, A, p, bucket='student-photos') == '42501')
        ok('storage: a visitor cannot write it', refused(d, lambda: d.role('anon', "insert into storage.objects (bucket_id, name) values (:b, :n)", b=BUCKET, n=p)) is not None)
        ok('storage: A writes exactly its name while it uploads', as_teacher_insert(d, A, p) == 'ok')
        ok('storage: A reads it; B and a visitor do not', as_role_count(d, 'authenticated', A, p) == 1 and as_role_count(d, 'authenticated', B, p) == 0
           and as_role_count(d, 'anon', None, p) == 0)
        ch = d.role('authenticated', "update storage.objects set metadata = '{}' where name = :n returning 1", A, n=p)
        de = d.role('authenticated', "delete from storage.objects where name = :n returning 1", A, n=p)
        ok('storage: A can neither change nor delete it', ch == [] and de == [] and d.one('select count(*) from storage.objects where name = :n', n=p) == 1, (ch, de))
        f = finish_(w, s['id']); ok('storage: (setup) finished', f['status'] == 'ready', f)
        s2 = start(w, 'txt')
        d.run("update assessment_resource set created_at = now() - interval '2 hours 1 minute' where id = :r", r=s2['id'])
        ok('storage: an upload past its two hours cannot be written', as_teacher_insert(d, A, s2['path'], mime='text/plain') == '42501')
        d.run("update assessment_resource set created_at = now() where id = :r", r=s2['id'])
        d.run("update assessment_resource set status = 'ready' where id = :r", r=s2['id'])
        ok('storage: a ready handout\'s name cannot be written (no overwrite)', as_teacher_insert(d, A, s2['path'], mime='text/plain') == '42501')
        # A careless policy added later does not open the bucket.
        d.run("create policy careless on storage.objects for all to public using (true) with check (true)")
        try:
            ok('storage: with a careless policy, B still reads nothing of A\'s, a visitor nothing',
               as_role_count(d, 'authenticated', B, p) == 0 and as_role_count(d, 'anon', None, p) == 0)
            ok('storage: with a careless policy, B still writes nothing, nor A an unissued name',
               as_teacher_insert(d, B, '%s/%s.html' % (w.cb, nid())) == '42501' and as_teacher_insert(d, A, '%s/%s.html' % (w.c, nid())) == '42501')
            de = d.role('authenticated', "delete from storage.objects where name = :n returning 1", B, n=p)
            ok('storage: with a careless policy, B still cannot delete A\'s file', de == [], de)
        finally:
            d.run('drop policy careless on storage.objects')
        # student-photos: a handout page of a PDF still uploads as before.
        pp = obj(d.one('select _assessment_resource_json(:r)', r=w.pdf))['paths'][0]
        ok('storage: student-photos is as before: a PDF page uploads', as_teacher_insert(d, A, pp, bucket='student-photos', mime='image/jpeg') == 'ok')
        ok('storage: the policy helpers: a teacher may run them, a visitor may not',
           all(d.one("select has_function_privilege('authenticated', :s, 'execute') and not has_function_privilege('anon', :s, 'execute')", s=x)
               for x in ('fv_private.handout_file_upload_allowed(text)', 'fv_private.handout_file_read_allowed(text)')))
        ok('storage: the helpers are run by nobody but their owner',
           not any(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=x) for r in ('anon', 'authenticated', 'service_role')
                   for x in NEW[:6]))
    finally:
        d.close()

# ── student ───────────────────────────────────────────────────────────────────────────────────────────
def scen_student():
    w = world('student'); d = w.d
    try:
        h = ready_file(w, 'html', title='Practice Page'); t = ready_file(w, 'txt', title='Notes'); e = ready_file(w, 'epub', title='The Book')
        up = start(w, 'html', title='Still Uploading')
        r = obj(S(d, "student_submit.handout_file(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=h['id']))
        ok('student: a ready file on a listed piece: its bucket, path, kind, size and title',
           r == {'ok': True, 'bucket': BUCKET, 'resource_id': h['id'], 'assessment_id': w.a, 'title': 'Practice Page', 'kind': 'html', 'bytes': 1000, 'path': h['path']}, r)
        ok('student: a TXT and an EPUB too', obj(S(d, "student_submit.handout_file(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=t['id']))['kind'] == 'txt'
           and obj(S(d, "student_submit.handout_file(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=e['id']))['kind'] == 'epub')
        def nf(rid, tok=w.t1, enr=w.e1): return obj(S(d, "student_submit.handout_file(:t, :e, :r, 'ip')", t=tok, e=enr, r=rid))
        ok('student: still uploading: not_found', nf(up['id']) == {'ok': False, 'error': 'not_found'})
        ok('student: a PDF or a link: not_found (a PDF opens with handout_links)', nf(w.pdf)['error'] == 'not_found' and nf(w.link)['error'] == 'not_found')
        ok('student: another class\'s session: not_found', nf(h['id'], w.t2, w.e2)['error'] == 'not_found')
        ok('student: an unknown id: not_found', nf(nid())['error'] == 'not_found')
        bad = nf(h['id'], 'x' * 80)
        ok('student: a bad session: its error, nothing else', bad.get('ok') is False and bad.get('error') not in (None, 'not_found') and 'path' not in bad, bad)
        d.run("update assessment set date_assigned = current_date + 3 where id = :a", a=w.a)
        ok('student: a piece dated into the future: not_found', nf(h['id'])['error'] == 'not_found')
        d.run("update assessment set date_assigned = null, is_draft = true where id = :a", a=w.a)
        ok('student: a Draft: not_found', nf(h['id'])['error'] == 'not_found')
        d.run("update assessment set is_draft = false where id = :a", a=w.a)
        page = obj(S(d, "student_submit.page(:t, :e, 'ip')", t=w.t1, e=w.e1))
        res = [x for x in page['assessments'] if x['id'] == w.a][0]['resources']
        ok('student: page lists the ready files with their kinds, in order, not the one uploading',
           [(x['kind'], x['title']) for x in res] == [('link', 'Old Link'), ('html', 'Practice Page'), ('txt', 'Notes'), ('epub', 'The Book')], res)
        ok('student: handout_links still answers a PDF only: a file is not_found there',
           obj(S(d, "student_submit.handout_links(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=h['id']))['error'] == 'not_found')
        ok('student: only the service role may run handout_file',
           d.one("select has_function_privilege('service_role', 'student_submit.handout_file(text,uuid,uuid,text)', 'execute')")
           and not d.one("select has_function_privilege('authenticated', 'student_submit.handout_file(text,uuid,uuid,text)', 'execute')")
           and not d.one("select has_function_privilege('anon', 'student_submit.handout_file(text,uuid,uuid,text)', 'execute')"))
    finally:
        d.close()

# ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────
def nightly(d):
    try:
        d.run('call public.photo_lifecycle_nightly()'); return 'ok'
    except Exception as e:
        return 'ERROR ' + message(e)

def scen_lifecycle():
    w = world('lifecycle'); d = w.d
    try:
        f1 = ready_file(w, 'html', a=w.a2)
        T(d, 'delete_assessment(:a)', a=w.a2)
        ok('lifecycle: deleting the assessment queues its file', queued(d, f1['path']) == [[BUCKET, 'handout_removed', False]], queued(d, f1['path']))
        f2 = ready_file(w, 'epub')
        # Keep Photos Until: a class unopened for a year keeps its handout file.
        d.run("insert into course_opened (course_id, last_opened_at) values (:c, now() - interval '400 days') on conflict (course_id) do update set last_opened_at = excluded.last_opened_at", c=w.c)
        d.run("update course set created_at = now() - interval '500 days' where id = :c", c=w.c)
        d.run("select _photo_keep_class(:c, now())", c=w.c)
        ok('lifecycle: Keep Photos Until a year unopened leaves a handout file and its row', d.one('select status from assessment_resource where id = :r', r=f2['id']) == 'ready' and queued(d, f2['path']) == [])
        # An upload never finished, in a class with no photos at all: dropped that night.
        s = start(w, 'txt', a=w.a)
        d.run("update assessment_resource set created_at = now() - interval '3 hours' where id = :r", r=s['id'])
        ok('lifecycle: (setup) the class has no submissions and no folder in student-photos',
           d.one('select count(*) from submission where course_id = :c', c=w.c) == 0 and d.one("select count(*) from storage.objects where bucket_id = 'student-photos'") == 0)
        r = nightly(d)
        ok('lifecycle: the nightly job drops an upload never finished and queues its file (reason handout_expired)',
           d.one('select count(*) from assessment_resource where id = :r', r=s['id']) == 0 and queued(d, s['path']) == [[BUCKET, 'handout_expired', False]], (r, queued(d, s['path'])))
        # The worker: removal_batch hands out the bucket; removal_done looks in that bucket.
        put_file(w, f1['path'], 'html')
        batch = obj(S(d, 'student_submit.removal_batch(100)'))
        item = [x for x in batch['items'] if x['path'] == f1['path']]
        ok('lifecycle: removal_batch hands the file out with its bucket', item and item[0]['bucket'] == BUCKET, batch)
        rid = item[0]['id']
        dn = obj(S(d, 'student_submit.removal_done(:i)', i='{%d}' % rid))
        ok('lifecycle: removal_done while the file is still in handout-files: not done', dn['gone'] == 0 and queued(d, f1['path'])[0][2] is False, dn)
        d.run('delete from storage.objects where name = :n', n=f1['path'])
        d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute' where id = :i", i=rid)
        dn = obj(S(d, 'student_submit.removal_done(:i)', i='{%d}' % rid))
        ok('lifecycle: once storage no longer has it: done', dn['gone'] == 1 and queued(d, f1['path'])[0][2] is True, dn)
        # The purge of a class, and of a teacher.
        f3 = ready_file(w, 'html', a=w.a)
        d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c)
        d.run('select fv_retention_cleanup()')
        ok('lifecycle: the 30-day purge of the class queues its files (the PDF\'s pages too)',
           queued(d, f3['path'])[0][0] == BUCKET and queued(d, f2['path'])[0][0] == BUCKET
           and d.one("select count(*) from submission_file_removal where path like :p", p='%/handouts/' + w.pdf + '/%') == 2)
        sb = start(w, 'epub', a=w.ab, uid=B)
        d.run("update teacher set deleted_at = now() - interval '31 days' where id = :b", b=B)
        d.run('select fv_retention_cleanup()')
        ok('lifecycle: the purge of a teacher queues their files', queued(d, sb['path'])[0][0] == BUCKET, queued(d, sb['path']))
        r = nightly(d)
        ok('lifecycle: the nightly job runs clean (a queued file not yet due is not stuck)', r == 'ok', r)
    finally:
        d.close()
    w = world('lifecycle_without', with_file=False); d = w.d
    try:
        d.run("""insert into assessment_resource (assessment_id, course_id, kind, title, page_count, status, position, created_at)
                 values (:a, :c, 'pdf', 'Never Finished', 1, 'uploading', 9, now() - interval '3 hours')""", a=w.a2, c=w.c)
        d.run("update assessment_resource set created_at = now() - interval '3 hours' where id = :r", r=w.pdf)
        nightly(d)
        ok('lifecycle: without the file the nightly job does not visit a class with no photos (the gap): differs, as required',
           d.one('select count(*) from assessment_resource where id = :r', r=w.pdf) == 1)
    finally:
        d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
HEADER = text_of(FILE)
def scen_apply():
    w = world('apply', with_file=False); d = w.d
    try:
        pre = d.file(PRE); ok('apply: the pre-check returns no row here', pre == 'ok' and d.rows == [], (pre, d.rows))
        cat0 = catalog(d.c)
        for sig in RELIED + REPLACES:
            body = defn(d, sig)
            marker = '$procedure$\n' if '$procedure$' in body else '$function$\n'
            d.run(body.replace(marker, marker + '-- someone changed this\n', 1))
            r = d.file(FILE)
            d.file(PRE); named = any(sig in row[0] for row in d.rows)
            ok('apply: %s changed since: stopped, and the pre-check names it' % sig.split('(')[0], r.startswith('STOPPED') and 'not the definition' in r and named, (r, d.rows))
            d.run(body)
        def stops(name, setup, cleanup, want, pre_word):
            for s in setup: d.run(s)
            try:
                r = d.file(FILE); d.file(PRE)
                ok('apply: %s: stopped, and the pre-check names it' % name, r.startswith('STOPPED') and want in r and any(pre_word in row[0] for row in d.rows), (r, d.rows))
            finally:
                for s in cleanup: d.run(s)
        stops('a start_handout_file not this file\'s', ["create function public.start_handout_file(a uuid, b text, c text, e bigint, f uuid) returns jsonb language sql as 'select null::jsonb'"],
              ['drop function public.start_handout_file(uuid,text,text,bigint,uuid)'], 'already exists', 'start_handout_file')
        stops('a handout_file with other arguments', ["create function student_submit.handout_file(a text) returns int language sql as 'select 1'"],
              ['drop function student_submit.handout_file(text)'], 'other arguments', 'handout_file')
        stops('a column of assessment_resource renamed', ['alter table public.assessment_resource rename column url to address'],
              ['alter table public.assessment_resource rename column address to url'], 'not as 2026111170 made it', 'assessment_resource columns')
        stops('a constraint changed', ["alter table public.assessment_resource drop constraint assessment_resource_kind_check, add constraint assessment_resource_kind_check check (kind in ('pdf', 'link', 'doc'))"],
              ["alter table public.assessment_resource drop constraint assessment_resource_kind_check, add constraint assessment_resource_kind_check check (kind in ('pdf', 'link'))"],
              'constraints on public.assessment_resource', 'assessment_resource constraints')
        stops('a bucket handout-files with other settings', ["insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('handout-files', 'handout-files', true, 20971520, array['text/html','text/plain','application/epub+zip'])"],
              ["delete from storage.buckets where id = 'handout-files'"], 'is not private', 'bucket handout-files')
        stops('a bucket handout-files that holds a file', ["insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('handout-files', 'handout-files', false, 20971520, array['text/html','text/plain','application/epub+zip'])",
                                                          "insert into storage.objects (bucket_id, name) values ('handout-files', 'x.html')"],
              ["delete from storage.objects where bucket_id = 'handout-files'", "delete from storage.buckets where id = 'handout-files'"], 'already holds files', 'bucket handout-files')
        stops('row security off on storage.objects', ['alter table storage.objects disable row level security'], ['alter table storage.objects enable row level security'],
              'row security turned off', 'storage.objects row security')
        stops('a policy of one of its names', ["create policy fv_handout_files_read on storage.objects for select to authenticated using (true)"],
              ['drop policy fv_handout_files_read on storage.objects'], 'not the six', 'policies on storage.objects')
        ok('apply: every stopped run left the catalog as it was', catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
        cols = table_columns(d.c); rows0 = row_checksums(d.c, cols)
        r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
        cat1 = catalog(d.c); rows1 = row_checksums(d.c, cols)
        changed = [t for t in rows0 if rows0[t] != rows1.get(t)]
        ok('apply: no existing row changed but the bucket\'s own row (on every column the tables had)', changed == ['storage.buckets'], changed)
        gone, extra = differences(cat0, cat1)
        expected = re.compile(r'(handout_file|_assessment_resource_json|_assessment_resource_removed|_handout_drop_expired|removal_done|photo_lifecycle_nightly'
                              r'|fv_handout_files|assessment_resource.*(bytes|kind_check|shape_check)|pg_depend|^depends |comments on)')
        ok('apply: the catalog changes only in what the header names', all(expected.search(l) for l in gone + extra),
           [l for l in gone + extra if not expected.search(l)][:6])
        ok('apply: the relied-on functions are unchanged', all(md5(d, s) == re.search(re.escape(q(s)) + r", '([0-9a-f]{32})'", HEADER).group(1) for s in RELIED))
        post = d.file(POST); ok('apply: the post-check says ok on every row', post == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'])
        r2 = d.file(FILE)
        ok('apply: a second run changes nothing', r2 == 'ok' and catalog(d.c) == cat1 and row_checksums(d.c, cols) == rows1, (r2, differences(cat1, catalog(d.c))))
        pre = d.file(PRE); ok('apply: on the database after the file, the pre-check says so', pre == 'ok' and len(d.rows) > 0, d.rows)
        ok('apply: one transaction with a lock timeout', HEADER.count('\nbegin;') == 1 and HEADER.count('\ncommit;') == 1 and "set local lock_timeout = '5s';" in HEADER)
        size = len(HEADER.encode())
        ok('apply: the file is small enough to send whole (%d bytes, under 52 KB)' % size, size < 52000)
    finally:
        d.close()
    w = world('apply2', with_file=False); d = w.d
    try:
        from photos_stay import Side
        s = Side(d); s.run('begin'); s.run("update assessment_resource set title = title where id = :r", r=w.pdf)
        cat_b = catalog(d.c)
        t0 = time.time(); r = d.file(FILE); t1 = time.time()
        s.run('rollback'); s.close()
        ok('apply: with a handout being saved it stops after the lock timeout, nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < t1 - t0 < 15 and catalog(d.c) == cat_b, (r, t1 - t0))
    finally:
        d.close()

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', with_file=False); d = w.d
    try:
        cols = table_columns(d.c)
        cat0, rows0 = catalog(d.c), row_checksums(d.c, cols)
        ok('undo: on a database without the file it changes nothing', d.file(UNDO) == 'ok' and catalog(d.c) == cat0 and row_checksums(d.c, cols) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        cat1 = catalog(d.c)
        f = ready_file(w, 'html')
        r = d.statements(split(part0())); ok('undo: PART 0 alone runs', r == 'ok', r)
        gone, extra = differences(cat1, catalog(d.c))
        ok('undo: PART 0 only takes start and finish from teachers', all(re.search(r'(start|finish)_handout_file', l) for l in gone + extra) and gone, (gone, extra))
        e = refused(d, lambda: start(w, 'txt'))
        ok('undo: after PART 0 a teacher cannot start a file', e and 'permission denied' in e[0], e)
        ok('undo: after PART 0 a ready file still opens for a student',
           obj(S(d, "student_submit.handout_file(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=f['id']))['ok'] is True)
        r = d.file(UNDO); ok('undo: the full undo refuses while a file\'s row is held', r.startswith('STOPPED') and 'still holds' in r, r)
        T(d, 'remove_assessment_resource(:r, gen_random_uuid())', r=f['id'])
        r = d.file(UNDO); ok('undo: and while a removed file is not yet gone from storage', r.startswith('STOPPED') and 'not yet' in r, r)
        d.run("update submission_file_removal set done = true, removed_at = now() where bucket = :b", b=BUCKET)
        d.run('delete from submission_file_removal where bucket = :b', b=BUCKET)
        d.run('delete from storage.objects where bucket_id = :b', b=BUCKET)
        body = defn(d, NEW[8])
        d.run(body.replace('$function$\n', '$function$\n-- someone changed this\n', 1))
        r = d.file(UNDO); ok('undo: a changed start_handout_file stops it, nothing changed', r.startswith('STOPPED') and 'neither' in r, r)
        d.run(body)
        r = d.file(UNDO); cat2 = catalog(d.c); rows2 = row_checksums(d.c, table_columns(d.c))
        ok('undo: the full undo runs', r == 'ok', r)
        gone, extra = differences(cat0, cat2)
        ok('undo: the catalog is as before the file, but a dropped-column slot on assessment_resource',
           all(re.search(r'^dropped columns public.assessment_resource \| 1$|pg_depend|^depends ', l) for l in gone + extra), (gone, extra))
        ok('undo: the five functions are back word for word', all(md5(d, s) == re.search(re.escape(q(s)) + r", '([0-9a-f]{32})'", HEADER).group(1) for s in REPLACES))
        changed = [t for t in rows0 if rows0[t] != rows2.get(t) and t not in ('public.fv_idempotency', 'public.submission_file_removal', 'public.course_sync_cursor')]
        ok('undo: no row changed but the bucket\'s (left for the Storage API) and this test\'s own writes', changed in (['storage.buckets'], ['public.assessment_resource', 'storage.buckets']) or changed == ['storage.buckets'], changed)
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and catalog(d.c) == cat2)
        ok('undo: and the file can be applied again', d.file(FILE) == 'ok' and applied(d))
    finally:
        d.close()

SCENARIOS = {'teacher': scen_teacher, 'storage': scen_storage, 'student': scen_student, 'lifecycle': scen_lifecycle,
             'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    if sys.argv[1:] == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
