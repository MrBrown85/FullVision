"""What Batch B's scripts share (submissions.py, submissions_undo.py,
submissions_mutate.py, submissions_fingerprints.py). Not a test itself.

- build(): loads an EMPTY database as gradebook-prod is since 2026-11-11
  02:02 UTC: everything card_codes_common.LIVE loads (the harness, S0-M4,
  Batch A's four files, S0-M5, S0-M4b), then S3-M1, then a stand-in for
  Supabase's storage schema (storage-stand-in.sql). That is the database
  Batch B's two files meet.
- Db: one scenario's own copy of that database, as card_codes_common has it,
  with Batch B's two files and their undo.
- Storage: the Storage API's part, in Python. The database cannot upload,
  sign or delete a file; the Storage service does, and the stand-in schema
  has only its tables. This class does to those tables what the service's
  source does (github.com/supabase/storage, read 2026-11-10):
    a signed upload link is bound to one bucket and path and to a time; the
      upload it allows is done by the service as the tables' owner, so no
      policy is asked; the bucket's size limit and list of types are checked
      against what the upload says it is (the Content-Type header: the bytes
      are not looked at); a path that already holds a file is refused;
    an upload by a signed-in teacher is an INSERT as that teacher, so the
      policies decide; a read is a SELECT as that teacher;
    a removal sets storage.allow_delete_query for its transaction and
      deletes the rows (the service then deletes the bytes).
  So what is proven here is the database's side GIVEN that the service
  behaves as its source reads. The service itself is not run.
"""
import datetime
from card_codes_common import *
import card_codes_common as cc

M1 = '../2026111101_student_work_submissions.sql'
M2 = '../2026111102_student_work_storage.sql'
# submissions_mutate.py runs the suite against a changed copy of either file.
M1_USED = os.environ.get('BATCH_B_M1') or M1
M2_USED = os.environ.get('BATCH_B_M2') or M2
MUTATED = M1_USED != M1 or M2_USED != M2
UNDO_B = 'batch-b-undo.sql'
BUCKET = 'student-photos'
LIVE_NOW = cc.LIVE + ['../2026111003_card_codes_keyed.sql', 'storage-stand-in.sql']
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
HASH = 'ab' * 32

def build():
    c = connect(cc.BASE_DB)
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run('select rolname from pg_roles')}
    for rel in LIVE_NOW:
        n = 0
        for st in split(text_of(rel)):
            words = st.split('\n')[-1].split()
            if rel == 'harness.sql' and words[:2] == ['create', 'role'] and words[2] in roles: continue   # roles belong to the whole server
            if any(w in bare(st) for w in cc.NOT_IN_THE_STAND_IN.get(rel, ())): continue
            try: c.run(st)
            except Exception as e: sys.exit('FAILED in %s:\n%s\n-> %s' % (rel, st[:300], e))
            n += 1
        print('%s: %d statements' % (rel, n))
    c.close()

class StorageError(Exception):
    def __init__(self, status, why): super().__init__('%s %s' % (status, why)); self.status = status; self.why = why

class Storage:
    """The Storage API's part (see the top of this file)."""
    LINK_LIFE = datetime.timedelta(hours=2)
    def __init__(self, d): self.d = d
    def _now(self): return self.d.one('select clock_timestamp()')
    def _bucket(self, bucket):
        r = self.d.all('select public, file_size_limit, allowed_mime_types from storage.buckets where id = :b', b=bucket)
        if not r: raise StorageError(404, 'Bucket not found')
        return r[0]
    def _limits(self, bucket, size, mime):
        _public, limit, types = self._bucket(bucket)
        if types and mime not in types: raise StorageError(415, 'invalid_mime_type')
        if limit is not None and size > limit: raise StorageError(413, 'The object exceeded the maximum allowed size')
    # ── the service key (the edge functions) ──
    def sign_upload(self, path, bucket=BUCKET):
        """A signed upload link for one path. The service key is not subject to row security."""
        self._bucket(bucket)
        return {'bucket': bucket, 'path': path, 'exp': self._now() + self.LINK_LIFE}
    def put_signed(self, link, path=None, size=300000, mime='image/jpeg', at=None):
        """Use a link. path: where the caller tries to write (the link's own path unless a test says otherwise)."""
        path = link['path'] if path is None else path
        if path != link['path']: raise StorageError(400, 'InvalidSignature')
        if (at or self._now()) > link['exp']: raise StorageError(400, 'ExpiredSignature')
        self._limits(link['bucket'], size, mime)
        if self.d.in_tx: self.d.run('savepoint put')
        try:
            self.d.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', :s::bigint, 'mimetype', :m::text))",
                       b=link['bucket'], n=path, s=size, m=mime)
            if self.d.in_tx: self.d.run('release savepoint put')
        except Exception as e:
            if self.d.in_tx: self.d.run('rollback to savepoint put')
            raise StorageError(409, 'Duplicate') if sqlstate(e) == '23505' else e
    def sign_download(self, path, bucket=BUCKET):
        """A signed link to read one path: only for a file that is there."""
        if not self.d.one('select count(*) from storage.objects where bucket_id = :b and name = :n', b=bucket, n=path):
            raise StorageError(404, 'Object not found')
        return {'bucket': bucket, 'path': path}
    def remove(self, paths, bucket=BUCKET):
        """Delete files. How many were there."""
        if self.d.in_tx: self.d.run('savepoint rm')
        else: self.d.run('begin')
        self.d.run("select set_config('storage.allow_delete_query', 'true', true)")
        n = len(self.d.run('delete from storage.objects where bucket_id = :b and name = any(:p) returning 1', b=bucket, p=list(paths)))
        self.d.run("select set_config('storage.allow_delete_query', 'false', true)")
        if self.d.in_tx: self.d.run('release savepoint rm')
        else: self.d.run('commit')
        return n
    # ── a signed-in user (the teacher's browser), or nobody ──
    def put_as(self, role, uid, path, size=300000, mime='image/jpeg', bucket=BUCKET):
        self._limits(bucket, size, mime)
        try:
            self.d.role(role, "insert into storage.objects (bucket_id, name, owner, metadata) values (:b, :n, nullif(:o, '')::uuid, jsonb_build_object('size', :s::bigint, 'mimetype', :m::text))",
                        uid=uid, b=bucket, n=path, o=uid or '', s=size, m=mime)
        except Exception as e:
            if sqlstate(e) == '23505': raise StorageError(409, 'Duplicate')
            if sqlstate(e) == '42501': raise StorageError(403, 'new row violates row-level security policy')
            raise
    def can_read(self, role, uid, path, bucket=BUCKET):
        return self.d.role(role, 'select count(*) from storage.objects where bucket_id = :b and name = :n', uid=uid, b=bucket, n=path)[0][0] == 1
    def visible(self, role, uid, bucket=BUCKET):
        return sorted(r[0] for r in self.d.role(role, 'select name from storage.objects where bucket_id = :b', uid=uid, b=bucket))
    def change_as(self, role, uid, sql, **kw):
        """An UPDATE or DELETE on storage.objects as that user: how many rows it reached, or the error's SQLSTATE."""
        if self.d.in_tx: self.d.run('savepoint chg')
        try:
            n = len(self.d.role(role, sql + ' returning 1', uid=uid, **kw))
            if self.d.in_tx: self.d.run('release savepoint chg')
            return n
        except Exception as e:
            if self.d.in_tx: self.d.run('rollback to savepoint chg')
            return sqlstate(e)
    def names(self, bucket=BUCKET):
        return sorted(r[0] for r in self.d.run('select name from storage.objects where bucket_id = :b', b=bucket))

class WorkDb(Db):
    """A scenario's copy, with Batch B's files and the Storage API's part."""
    def __init__(self, tag, template=None):
        super().__init__(tag, template); self.storage = Storage(self)
    def apply_b(self):
        r = self.file(M1_USED)
        return r if r != 'ok' else self.file(M2_USED)
    def undo_b(self): return self.file(UNDO_B)
    # ── the teacher's browser ──
    def rpc(self, sql, uid=A, **kw): return self.teacher(sql, uid, **kw)
    # ── the student-submit edge function ──
    def session(self, enrollment, birthday='2012-05-15', course=COURSE_A, teacher=A, token=None, add=False):
        """A card made for the student and a phone signed in with it: (session token, code)."""
        code, _pw, _row = self.make(enrollment, course, teacher)
        r = self.verify(code, birthday=birthday, token=token, add=add)
        assert r['ok'], r
        return (r['session_token'] or token), code
    def work(self, token, e): return self.service("student_submit.work(:t, :e, 'ip-1')", t=token, e=e)
    def send_start(self, token, e, a, pages=1, note=None, plan=None, request=None, replace=False):
        return self.service("student_submit.%s(:t, :e, :a, :p::jsonb, :n, :f, :r, 'ip-1')" % ('replace' if replace else 'send_start'),
                            t=token, e=e, a=a, p=json.dumps(pages if isinstance(pages, list) else [{'width': 1500, 'height': 2000}] * pages),
                            n=note, f=plan, r=request or nid())
    def send_finish(self, token, e, submission, files):
        return self.service("student_submit.send_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=token, e=e, s=submission,
                            f=json.dumps([{'file_id': f['file_id'], 'sha256': f.get('sha256', HASH)} for f in files]))
    def unsend(self, token, e, a): return self.service("student_submit.unsend(:t, :e, :a, 'ip-1')", t=token, e=e, a=a)
    def file_links(self, token, e, a): return self.service("student_submit.file_links(:t, :e, :a, 'ip-1')", t=token, e=e, a=a)
    def upload(self, files, **kw):
        """What the edge function and the phone do between send-start and send-finish: a link for each
        page and thumbnail the database named, and a file put through each."""
        for f in files:
            for p in (f['path'], f['thumb_path']):
                self.storage.put_signed(self.storage.sign_upload(p), **kw)
    def send(self, token, e, a, pages=1, **kw):
        """A whole send: start, upload, finish. (the start's reply, the finish's reply)."""
        s = self.send_start(token, e, a, pages, **kw)
        if not s.get('ok'): return s, None
        self.upload(s['files'])
        return s, self.send_finish(token, e, s['submission_id'], s['files'])
    def drain(self, limit=100):
        """The removal worker's one pass: ask for a batch, delete each through the Storage API, say so."""
        b = self.service('student_submit.removal_batch(:n)', n=limit)
        if b['items']: self.storage.remove([i['path'] for i in b['items']])
        return b, self.service('student_submit.removal_done(:ids)', ids=[i['id'] for i in b['items']])
    # ── the teacher's Add Work, as the browser does it ──
    def teacher_upload(self, a, e, pages=1, mode='new', uid=A, key=None):
        s = self.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', uid, a=a, e=e,
                     p=json.dumps([{'width': 1500, 'height': 2000}] * pages), m=mode, k=key or nid())
        if s.get('result') != 'ready': return s, None
        for f in s['files']:
            for p in (f['path'], f['thumb_path']): self.storage.put_as('authenticated', uid, p)
        return s, self.rpc('finish_work_upload(:s, :f::jsonb, :k)', uid, s=s['submission_id'],
                           f=json.dumps([{'file_id': f['file_id'], 'sha256': HASH} for f in s['files']]), k=nid())

class Side(WorkDb):
    """Another connection to a scenario's copy, with everything a WorkDb can do: one for each thing
    that happens at the same time."""
    def __init__(self, d):
        self.name = d.name; self.c = d.other(); self.rows = []; self.in_tx = False; self.storage = Storage(self)
    def commit(self): self.c.run('commit'); self.in_tx = False
    def close(self):
        try: self.c.close()
        except Exception: pass

def attempt(fn):
    """What fn returns, or 'ERROR <SQLSTATE> <message>'."""
    try: return fn()
    except StorageError as e: return 'STORAGE %s' % e
    except Exception as e: return 'ERROR %s %s' % (sqlstate(e), message(e)[:160])

def seed_work(d, on_return=True):
    """Teacher A's class with the Student Page and Send Work on; Cece has a birthday. Three assessments:
    one that takes photos, one that takes nothing, one that takes photos in Teacher B's class.
    Returns their ids and the class's today."""
    k = {'takes': nid(), 'nothing': nid(), 'b_takes': nid()}
    k['today'] = d.one("select (now() at time zone 'America/Vancouver')::date")
    d.run("update student set preferred_name = 'CeCe', date_of_birth = '2012-05-15' where id = :s", s=STU1)
    d.run("update student set date_of_birth = '2012-06-16' where id = :s", s=STU2)
    d.run("update student set date_of_birth = '2012-07-17' where teacher_id = :t", t=B)
    d.run("update course set student_page_enabled = true, return_grades = :r, send_work = true", r='on_return' if on_return else 'on_save')
    d.run("""insert into assessment (id, course_id, title, score_mode, max_points, students_send) values
               (:a, :c, 'Cell Microscope Lab', 'points', 10, 'photos'),
               (:n, :c, 'Paper Quiz', 'points', 10, 'nothing'),
               (:b, :cb, 'Their Lab', 'points', 10, 'photos')""", a=k['takes'], n=k['nothing'], b=k['b_takes'], c=COURSE_A, cb=COURSE_B)
    return k

def score_fingerprint(d):
    """Every row of the four score tables and of grade_return, as one hash."""
    return d.one("""select md5(coalesce((select string_agg(x::text, '|' order by x::text) from score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from tag_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_check_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from grade_return x), ''))""")

# Every function Batch B's first file makes, by signature. submissions_fingerprints.py writes their
# fingerprints into the two files; submissions.py checks the files' lists against a fresh apply.
B_FUNCTIONS = [
    'public._work_bucket()', 'public._work_max_bytes()', 'public._work_object(text)',
    'public._work_hold()', 'public._work_class_max_pages()', 'public._work_class_max_bytes()', 'public._work_check_pages(jsonb)',
    'public._work_check_files(jsonb)',
    'public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)',
    'public._work_drop_expired(uuid)', 'public._work_class_full(uuid,jsonb)',
    'public._work_files_state(uuid,jsonb)', 'public._work_settle_files(uuid,jsonb)', 'public._work_upload_json(uuid)',
    'public._submission_json(uuid)', 'public._assessment_work_json(uuid)',
    'public._submission_same_class()', 'public._submission_file_removed()', 'public._submission_target_gone()',
    'public._submission_gone()', 'public._submission_truncated()',
    'public.set_course_send_work(uuid,jsonb,uuid)', 'public.set_assessment_student_work(uuid,jsonb,uuid)',
    'public.list_course_submissions(uuid)', 'public.start_work_upload(uuid,uuid,jsonb,text,uuid)',
    'public.finish_work_upload(uuid,jsonb,uuid)', 'public.mark_handed_in_paper(uuid,uuid[],uuid)',
    'public.delete_submission(uuid,uuid)', 'public.rotate_submission_page(uuid,integer,uuid)',
    'fv_private.work_path_course(text)', 'fv_private.work_upload_allowed(text)', 'fv_private.work_read_allowed(text)',
    'student_submit._grading_started(uuid,uuid)', 'student_submit._send_session(text,uuid)', 'student_submit._work_window(uuid)',
    'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
    'student_submit.work(text,uuid,text)', 'student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',
    'student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)', 'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
    'student_submit.unsend(text,uuid,uuid,text)', 'student_submit.file_links(text,uuid,uuid,text)',
    'student_submit.removal_batch(integer)', 'student_submit.removal_done(bigint[])']
POLICY_FUNCTIONS = ['fv_private.work_path_course(text)', 'fv_private.work_upload_allowed(text)', 'fv_private.work_read_allowed(text)']
# Live functions the new ones call, and so rely on.
RELIED_ON = ['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)', 'public.fv_owns_assessment(uuid)',
             'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
             'public._fv_timezone(text)', 'public._fv_date(text)',
             'public._grade_return_lock(uuid)', 'public._grade_return_lock_first(uuid)',
             'student_submit._session_class(text,uuid)', 'student_submit._device_session(text)', 'student_submit._card_refusal(uuid)']

MARK = re.compile(r'(-- FINGERPRINTS-BEGIN[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def fingerprint_lists(text):
    """The lists of (function, md5) a file carries between its markers."""
    return [re.findall(r"\('([^']+)',\s*'([0-9a-f]{32}|absent|none)'\)", m.group(2)) for m in MARK.finditer(text)]

def applied_template():
    """A copy of the template with Batch B's two files applied, for scenarios to copy: its name."""
    name = '%s_%s' % (cc.BASE_DB, 'm' if MUTATED else 'b')
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in (M1_USED, M2_USED):
        for st in split(text_of(rel)):
            try: c.run(st)
            except Exception as e:
                c.close(); return None, 'STOPPED in %s: %s' % (os.path.basename(rel), message(e))
    c.close()
    return name, 'ok'

if __name__ == '__main__':
    if sys.argv[1:] == ['build']: build()
