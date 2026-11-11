"""What Batch C's scripts share (batch_c.py, batch_c_undo.py, batch_c_mutate.py,
batch_c_fingerprints.py). Not a test itself.

Batch C applies only after Batch B. Batch B's files are on their own
branches until they merge (PR 1024, and its review fixes, PR 1053), so this
harness reads them from BATCH_B_DIR: a folder holding
2026111101_student_work_submissions.sql, 2026111102_student_work_storage.sql,
2026111104_student_work_review_fixes.sql and local-test/storage-stand-in.sql.
Unset, it is this repository's migrations/ folder (where they will be once
Batch B merges). The fixes branch holds all four (its head 7f5f34e5 is
Batch B's 8c36fe48 plus the fixes file), so take them from it:

    mkdir -p /tmp/bb && git archive 7f5f34e5 migrations | tar -x -C /tmp/bb
    BATCH_B_DIR=/tmp/bb/migrations ...

- build(): loads an EMPTY database as gradebook-prod will be when Batch C is
  applied: everything card_codes_common.LIVE loads, then S3-M1 and S4-M1
  (both applied on live), Supabase's storage tables (Batch B's stand-in),
  Batch B's two files and its review fixes, in the apply order. That is
  the database Batch C's two files meet.
- CDb: one scenario's own copy of it, with the student's phone and the
  teacher's browser as Batch B's contract has them, and Batch C's files and
  undo scripts.
"""
import datetime, hashlib
from card_codes_common import *
import card_codes_common as cc

B_DIR = os.environ.get('BATCH_B_DIR') or os.path.join(HERE, '..')
B1 = os.path.join(B_DIR, '2026111101_student_work_submissions.sql')
B2 = os.path.join(B_DIR, '2026111102_student_work_storage.sql')
B_FIXES = os.path.join(B_DIR, '2026111104_student_work_review_fixes.sql')
STAND_IN = os.path.join(B_DIR, 'local-test', 'storage-stand-in.sql')
S4_M1 = '../2026111103_student_page_fields.sql'   # on main; applied on live
C1 = '../2026111120_markup_reflect_revise.sql'
C2 = '../2026111121_markup_revise_grade_changes.sql'
# batch_c_mutate.py runs the suite against a changed copy of either file.
C1_USED = os.environ.get('BATCH_C1') or C1
C2_USED = os.environ.get('BATCH_C2') or C2
UNDO_C1 = 'batch-c1-undo.sql'
UNDO_C2 = 'batch-c2-undo.sql'
BUCKET = 'student-photos'
HASH = 'ab' * 32
LIVE_AFTER_B = cc.LIVE + ['../2026111003_card_codes_keyed.sql', S4_M1, STAND_IN, B1, B2, B_FIXES]

def text_at(rel):
    """A file's text: a path relative to this folder, or an absolute one."""
    return open(rel if os.path.isabs(rel) else os.path.join(HERE, rel)).read()

def build():
    for f in (B1, B2, B_FIXES, STAND_IN):
        if not os.path.exists(f): sys.exit('Batch B is not at %s: set BATCH_B_DIR (see the top of batch_c_common.py)' % f)
    c = connect(cc.BASE_DB)
    if c.run("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")[0][0]:
        sys.exit('this database is not empty: build needs a new one')
    roles = {r[0] for r in c.run('select rolname from pg_roles')}
    for rel in LIVE_AFTER_B:
        n = 0
        for st in split(text_at(rel)):
            words = st.split('\n')[-1].split()
            if rel == 'harness.sql' and words[:2] == ['create', 'role'] and words[2] in roles: continue
            if os.path.basename(rel) == 'storage-stand-in.sql' and words[:2] == ['create', 'role'] and words[2] in roles: continue
            if any(w in bare(st) for w in cc.NOT_IN_THE_STAND_IN.get(rel, ())): continue
            try: c.run(st)
            except Exception as e: sys.exit('FAILED in %s:\n%s\n-> %s' % (rel, st[:300], e))
            n += 1
        print('%s: %d statements' % (os.path.basename(rel), n))
    c.close()

# Every function C1 makes, by signature, and the three C2 replaces.
C1_FUNCTIONS = [
    'public._work_feedback_gone()', 'public._work_feedback_truncated()', 'public._markup_check(jsonb)',
    'public._markup_give(uuid,uuid)', 'public._revision_hide_available()', 'public._revision_hide_grade(uuid)',
    'public._revision_unhide_grade(uuid)', 'public._piece_latest(uuid,uuid)', 'public._revision_state(uuid)',
    'public._revision_json(uuid)', 'public._reflection_json(uuid)',
    'public.set_course_feedback_options(uuid,jsonb,uuid)', 'public.save_markup(uuid,jsonb,integer,uuid)',
    'public.list_assessment_markup(uuid)', 'public.return_work(uuid,uuid[],uuid)',
    'public.return_for_revision(uuid,uuid,jsonb,uuid)', 'public.set_revision_request(uuid,jsonb,uuid)',
    'public.cancel_revision(uuid,uuid)', 'public.answer_reflection(uuid,text,uuid,boolean)', 'public.list_course_feedback(uuid)',
    'student_submit._group_members(uuid,uuid)', 'student_submit.feedback(text,uuid,text)',
    'student_submit.markup(text,uuid,uuid,text)', 'student_submit.reflect(text,uuid,uuid,jsonb,text)',
    'student_submit.reply(text,uuid,uuid,jsonb,text)', 'student_submit.answer_seen(text,uuid,uuid[],text)',
    'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
    'student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'student_submit.revision_unsend(text,uuid,uuid,text)',
    'student_submit.group_work(text,uuid,text)', 'student_submit.group_file_links(text,uuid,uuid,text)']
# The one existing function C1 replaces (Batch B's): a page with the teacher's marks counts as
# grading started (C1 section 2b; the owner has not decided it).
C1_REPLACES = ['student_submit._grading_started(uuid,uuid)']
C1_PUBLIC_RPCS = ['public.set_course_feedback_options(uuid,jsonb,uuid)', 'public.save_markup(uuid,jsonb,integer,uuid)',
                  'public.list_assessment_markup(uuid)', 'public.return_work(uuid,uuid[],uuid)',
                  'public.return_for_revision(uuid,uuid,jsonb,uuid)', 'public.set_revision_request(uuid,jsonb,uuid)',
                  'public.cancel_revision(uuid,uuid)', 'public.answer_reflection(uuid,text,uuid,boolean)', 'public.list_course_feedback(uuid)']
C1_STUDENT = ['student_submit.feedback(text,uuid,text)', 'student_submit.markup(text,uuid,uuid,text)',
              'student_submit.reflect(text,uuid,uuid,jsonb,text)', 'student_submit.reply(text,uuid,uuid,jsonb,text)',
              'student_submit.answer_seen(text,uuid,uuid[],text)',
              'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
              'student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'student_submit.revision_unsend(text,uuid,uuid,text)',
              'student_submit.group_work(text,uuid,text)', 'student_submit.group_file_links(text,uuid,uuid,text)']
C2_REPLACES = ['public._revision_hide_available()', 'public._revision_hide_grade(uuid)', 'public._revision_unhide_grade(uuid)']
C2_NEW = ['public._markup_on_return()']
# Existing functions the new ones call (or, for C2, that its trigger's
# work depends on), and so rely on.
C1_RELIED = ['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)', 'public.fv_owns_assessment(uuid)',
             'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
             'public._fv_timezone(text)', 'public._fv_date(text)',
             'public._grade_return_lock(uuid)', 'public._grade_return_lock_first(uuid)', 'public._grade_return_holds(uuid)',
             'public._grade_copy(uuid,uuid)', 'public._grade_copy_in_use(jsonb,uuid)', 'public.return_grades(uuid,uuid[],uuid)',
             'student_submit._session_class(text,uuid)', 'student_submit._device_session(text)', 'student_submit._card_refusal(uuid)',
             # Batch B
             'student_submit._send_session(text,uuid)', 'public._work_bucket()', 'public._work_hold()',
             'public._work_check_pages(jsonb)', 'public._work_check_files(jsonb)',
             'public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)',
             'public._work_drop_expired(uuid)', 'public._work_class_full(uuid,jsonb)', 'public._work_files_state(uuid,jsonb)',
             'public._work_settle_files(uuid,jsonb)', 'public._work_upload_json(uuid)',
             'public._submission_file_removed()', 'public._submission_target_gone()', 'public._submission_gone()',
             # Batch B's review fixes (2026111104): not called, but listed so C1 stops unless the
             # fixes are in first (the apply order is Batch B's two files, the fixes, then C1)
             'public.finish_work_upload(uuid,jsonb,uuid)', 'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
             'student_submit.unsend(text,uuid,uuid,text)']
C2_RELIED = ['public._grade_copy(uuid,uuid)', 'public._markup_give(uuid,uuid)', 'public.return_for_revision(uuid,uuid,jsonb,uuid)',
             'public.cancel_revision(uuid,uuid)', 'public._grade_return_apply(uuid,uuid,jsonb,jsonb)',
             'public._grade_return_one(uuid,uuid,timestamp with time zone)']

MARK = re.compile(r'(-- FINGERPRINTS-BEGIN[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def neutral(text):
    """The file with every list stood aside, so it applies whatever it holds."""
    def row(m):
        head = m.group(1)
        three = any(w in head for w in ('BEGIN new', 'BEGIN c2relied', 'BEGIN replaces'))
        return head + ("            ('public.no_such_function_at_all()', 'absent', 'absent')" if three
                       else "            ('public.no_such_function_at_all()', 'absent')") + m.group(3)
    return MARK.sub(row, text)

def sha(s): return hashlib.sha256(s.encode()).hexdigest()

class CDb(Db):
    """A scenario's copy, with Batch C's files, the phone and the browser."""
    def apply1(self): return self.file(C1_USED)
    def apply2(self): return self.file(C2_USED)
    def undo1(self): return self.file(UNDO_C1)
    def undo2(self): return self.file(UNDO_C2)
    def file(self, rel): return self.statements(split(text_at(rel)))
    def rpc(self, sql, uid=A, **kw): return self.teacher(sql, uid, **kw)
    # ── the student-submit edge function ──
    def session(self, enrollment, birthday='2012-05-15', course=COURSE_A, teacher=A):
        code, _pw, _row = self.make(enrollment, course, teacher)
        r = self.verify(code, birthday=birthday)
        assert r['ok'], r
        return r['session_token']
    def svc(self, fn, *args):
        """student_submit.<fn>(args..., 'ip-1') as the service role; args are (value, cast) or plain values."""
        names = {}; parts = []
        for i, a in enumerate(args):
            v, cast = a if isinstance(a, tuple) else (a, '')
            names['a%d' % i] = json.dumps(v) if cast == '::jsonb' and not isinstance(v, str) else v
            parts.append(':a%d%s' % (i, cast))
        return self.service('student_submit.%s(%s, \'ip-1\')' % (fn, ', '.join(parts)), **names)
    def put(self, path, size=300000, mime='image/jpeg'):
        """A file landing in storage, as the Storage service would put it there through a signed link."""
        self.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', :s::bigint, 'mimetype', :m::text))",
                 b=BUCKET, n=path, s=size, m=mime)
    def upload(self, files):
        for f in files:
            self.put(f['path']); self.put(f['thumb_path'])
    def send(self, token, e, a, pages=1, note=None):
        """A whole Batch B send: start, upload, finish. The finish's reply."""
        s = self.service("student_submit.send_start(:t, :e, :a, :p::jsonb, :n, null, :r, 'ip-1')", t=token, e=e, a=a,
                         p=json.dumps([{'width': 1500, 'height': 2000}] * pages), n=note, r=nid())
        assert s['ok'], s
        self.upload(s['files'])
        f = self.service("student_submit.send_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=token, e=e, s=s['submission_id'],
                         f=json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in s['files']]))
        assert f['ok'], f
        return s['submission_id'], [x['file_id'] for x in s['files']]
    def rev_start(self, token, e, a, pages=1, note=None, request=None):
        return self.service("student_submit.revision_start(:t, :e, :a, :p::jsonb, :n, :r, 'ip-1')", t=token, e=e, a=a,
                            p=json.dumps([{'width': 1500, 'height': 2000}] * pages), n=note, r=request or nid())
    def rev_finish(self, token, e, sub, files):
        return self.service("student_submit.revision_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=token, e=e, s=sub,
                            f=json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in files]))
    def revise(self, token, e, a, pages=1, note=None):
        s = self.rev_start(token, e, a, pages, note)
        if not s.get('ok'): return s, None
        self.upload(s['files'])
        return s, self.rev_finish(token, e, s['submission_id'], s['files'])
    def feedback(self, token, e): return self.service("student_submit.feedback(:t, :e, 'ip-1')", t=token, e=e)
    def marks(self, token, e, a): return self.service("student_submit.markup(:t, :e, :a, 'ip-1')", t=token, e=e, a=a)
    def reflect(self, token, e, a, r):
        return self.service("student_submit.reflect(:t, :e, :a, :r::jsonb, 'ip-1')", t=token, e=e, a=a, r=json.dumps(r))
    def reply(self, token, e, a, r):
        return self.service("student_submit.reply(:t, :e, :a, :r::jsonb, 'ip-1')", t=token, e=e, a=a, r=json.dumps(r))
    # ── the teacher's browser ──
    def save_markup(self, file_id, marks, base=None, uid=A, key=None):
        return self.rpc('save_markup(:f, :m::jsonb, :b, :k)', uid, f=file_id, m=json.dumps(marks), b=base, k=key or nid())
    def return_work(self, a, es, uid=A, key=None):
        return self.rpc('return_work(:a, :e, :k)', uid, a=a, e=es, k=key or nid())
    def rfr(self, a, e, req, uid=A, key=None):
        return self.rpc('return_for_revision(:a, :e, :r::jsonb, :k)', uid, a=a, e=e, r=json.dumps(req), k=key or nid())
    def score(self, e, a, value, uid=A):
        """A points save, through the live score RPC (its triggers keep grade_return)."""
        return self.rpc('upsert_score(:e, :a, :v)', uid, e=e, a=a, v=value)

def marks(*notes, pen=0):
    """Marks: one note per text given, and some pen strokes."""
    return {'v': 1, 'marks': [{'type': 'note', 'text': t, 'x': 0.4, 'y': 0.6} for t in notes]
                             + [{'type': 'pen', 'color': 'red', 'width': 0.004, 'points': [[0.1, 0.2], [0.3, 0.4]]} for _ in range(pen)]}

def seed(d, on_return=True, reflect=True):
    """Teacher A's class: Student Page on, Send Work on, Reflect on Feedback on. Cece (ENR1) and Stu2
    (ENR2) have birthdays. Assessments: lab (points, takes photos), rub (a rubric piece with two
    criteria, takes photos), dib (DIBELS), b_lab (Teacher B's). Returns their ids."""
    k = {'lab': nid(), 'rub': nid(), 'dib': nid(), 'b_lab': nid(), 'rubric': nid(), 'crit1': nid(), 'crit2': nid(),
         'other_rubric': nid(), 'other_crit': nid()}
    d.run("update student set preferred_name = 'CeCe', date_of_birth = '2012-05-15' where id = :s", s=STU1)
    d.run("update student set date_of_birth = '2012-06-16' where id = :s", s=STU2)
    d.run("update student set date_of_birth = '2012-07-17' where teacher_id = :t", t=B)
    d.run("update course set student_page_enabled = true, return_grades = :r, send_work = true",
          r='on_return' if on_return else 'on_save')
    if reflect: d.run('update course set reflect_on_feedback = true')
    d.run("insert into rubric (id, course_id, name) values (:r, :c, 'Lab Rubric'), (:o, :c, 'Other')",
          r=k['rubric'], o=k['other_rubric'], c=COURSE_A)
    d.run("insert into criterion (id, rubric_id, name) values (:a, :r, 'Plan'), (:b, :r, 'Write'), (:x, :o, 'Elsewhere')",
          a=k['crit1'], b=k['crit2'], x=k['other_crit'], r=k['rubric'], o=k['other_rubric'])
    d.run("""insert into assessment (id, course_id, title, score_mode, max_points, students_send, rubric_id) values
               (:a, :c, 'Cell Microscope Lab', 'points', 10, 'photos', null),
               (:r, :c, 'Letter', 'proficiency', null, 'photos', :rubric),
               (:d, :c, 'DIBELS', 'dibels', null, 'photos', null),
               (:b, :cb, 'Their Lab', 'points', 10, 'photos', null)""",
          a=k['lab'], r=k['rub'], d=k['dib'], b=k['b_lab'], c=COURSE_A, cb=COURSE_B, rubric=k['rubric'])
    return k

def fingerprint_rows(d):
    """Every row of the score tables, grade_return, submission and submission_file, as one hash."""
    return d.one("""select md5(coalesce((select string_agg(x::text, '|' order by x::text) from score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from tag_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from rubric_check_score x), '')
                          || coalesce((select string_agg(x::text, '|' order by x::text) from grade_return x), ''))""")

def applied_template(with_c2=False):
    """A copy of the template with C1 (and C2) applied, for scenarios to copy: its name, or (None, why)."""
    name = '%s_%s' % (cc.BASE_DB, 'c12' if with_c2 else 'c1')
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in ([C1_USED, C2_USED] if with_c2 else [C1_USED]):
        for st in split(text_at(rel)):
            try: c.run(st)
            except Exception as e:
                c.close(); return None, 'STOPPED in %s: %s' % (os.path.basename(rel), message(e))
    c.close()
    return name, 'ok'

if __name__ == '__main__':
    if sys.argv[1:] == ['build']: build()
