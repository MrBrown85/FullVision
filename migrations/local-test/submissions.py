"""Exercise Batch B: migrations/2026111101_student_work_submissions.sql (S5-M1)
and migrations/2026111102_student_work_storage.sql (S5-M2). Students send
work; teachers add it; where the files live and who can touch them.

    python3 submissions_common.py build   load an EMPTY database as
                                          gradebook-prod is now, with a
                                          stand-in for Supabase's storage
                                          schema. No Batch B.
    python3 submissions.py                every scenario
    python3 submissions.py student race   or only some

The database named by PGDATABASE is only ever a template: each scenario
runs on a copy (<PGDATABASE>_<scenario>, made and dropped here). The
Storage API's part is played in Python (submissions_common.Storage), written
from the service's source: the service itself is not run.

  apply    The two files meet a database in use. Their shape; each guard
           stops them with nothing changed; the apply (no existing row and
           no existing function changes); the read-only checks written for
           the live database; a second run; a second run after a later
           migration replaced a function.
  teacher  The eight RPCs: the two settings, the list, Add Work in its
           three modes, Handed In on Paper, delete, rotate. Ownership,
           shapes, replays.
  student  work, send_start, send_finish, replace, unsend, file_links as
           the student-submit function calls them: every refusal, every
           happy path, replays, the hourly limit, grading, and that no
           grade is read or written.
  storage  The bucket and its four policies, as a teacher, another teacher,
           nobody and the service key; one careless policy added on top;
           the removal queue from every way a row can go; that SQL cannot
           delete a file.
  race     On connections of their own: two sends at once, Unsend during a
           send, Unsend against a grade being saved, Replace during
           grading, a send against its assessment being deleted, the hourly
           limit under a burst, and a mix of everything.
  grants   The files' own revokes and grants, on a copy where a new
           function is runnable by everyone unless the file says otherwise.
  suites   The older suites, untouched, with the two files applied.

PGPORT=54341 PGDATABASE=bb python3 submissions_common.py build
PGPORT=54341 PGDATABASE=bb python3 submissions.py
"""
import threading, time
from submissions_common import *

T1 = text_of(M1_USED); T2 = text_of(M2_USED)
S1 = split(T1); S2 = split(T2)
TEMPLATE_B = None
PATH_RE = re.compile(r'^([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f-]{36})(-thumb)?\.jpg$')

def applied(tag, on_return=True):
    """A copy with Batch B applied and a class that sends work: (the copy, the seeded ids)."""
    global TEMPLATE_B
    if TEMPLATE_B is None:
        TEMPLATE_B, r = applied_template()
        if TEMPLATE_B is None:
            ok('the two files apply to the database as live has it', False, r); finish()
    d = WorkDb(tag, template=TEMPLATE_B)
    return d, seed_work(d, on_return)

def err(r): return None if r is None or r.get('ok') else r.get('error')
def live_paths(d): return sorted(p for r in d.all('select path, thumb_path from submission_file') for p in r)
def queued(d, reason=None):
    return sorted(r[0] for r in d.all('select path from submission_file_removal where :r::text is null or reason = :r', r=reason))
def sound(d):
    """What must hold whatever happened. '' or what is wrong.
    No file of a live page is waiting to be deleted; no two pages share a file; one submission handed in
    per student per assessment per version; an unfinished send that replaces or adds has its target; every
    page handed in is in storage; no submission is left without its student or its assessment."""
    wrong = []
    if d.one('select count(*) from submission_file f join submission_file_removal r on r.path in (f.path, f.thumb_path)'): wrong.append('a live page is queued for deletion')
    if d.one("select count(*) from (select 1 from submission where state = 'sent' group by assessment_id, enrollment_id, version having count(*) > 1) x"): wrong.append('two handed in for one piece')
    if d.one("select count(*) from submission s where s.intent <> 'new' and not exists (select 1 from submission t where t.id = s.target_id and t.state = 'sent')"): wrong.append('a send whose target is gone')
    if d.one("""select count(*) from submission_file f join submission s on s.id = f.submission_id where s.state = 'sent'
                 and (not exists (select 1 from storage.objects o where o.bucket_id = 'student-photos' and o.name = f.path)
                      or not exists (select 1 from storage.objects o where o.bucket_id = 'student-photos' and o.name = f.thumb_path))"""): wrong.append('a page handed in is not in storage')
    if d.one("""select count(*) from submission s where not exists (select 1 from enrollment e where e.id = s.enrollment_id and e.course_id = s.course_id)
                 or not exists (select 1 from assessment a where a.id = s.assessment_id and a.course_id = s.course_id)"""): wrong.append('a submission without its student or assessment')
    if d.one("select count(*) from submission s where s.state = 'sent' and not s.on_paper and not exists (select 1 from submission_file f where f.submission_id = s.id)"): wrong.append('handed in with no page and not on paper')
    return ', '.join(wrong)

# ════════════════════════════════════════════════════════════════════════════
def scen_teacher():
    d, k = applied('teacher')
    try:
        a = k['takes']; g0 = score_fingerprint(d)
        with tx(d):
            # ── The class's two settings ────────────────────────────────
            d.run('update course set send_work = false where id = :c', c=COURSE_A)
            r = d.rpc("set_course_send_work(:c, '{\"send_work\": true}'::jsonb, :k)", c=COURSE_A, k=nid())
            ok('set_course_send_work turns Send Work on and returns both settings', r == {'send_work': True, 'keep_photos_until': 'end_of_year'}, r)
            r = d.rpc("set_course_send_work(:c, '{\"keep_photos_until\": \"end_of_term\"}'::jsonb, :k)", c=COURSE_A, k=nid())
            ok('a patch writes only what it names: Keep Photos Until changes and Send Work stays on',
               r == {'send_work': True, 'keep_photos_until': 'end_of_term'}, r)
            same = nid()
            first = d.rpc("set_course_send_work(:c, '{\"send_work\": false}'::jsonb, :k)", c=COURSE_A, k=same)
            d.run('update course set send_work = true where id = :c', c=COURSE_A)
            again = d.rpc("set_course_send_work(:c, '{\"send_work\": false}'::jsonb, :k)", c=COURSE_A, k=same)
            ok('the same key again returns the first answer and writes nothing', first == again and d.one('select send_work from course where id = :c', c=COURSE_A) is True, again)
            ok('the class row says when it was changed, and its other settings are as they were',
               d.one("select student_page_enabled and return_grades = 'on_return' and updated_at >= now() - interval '1 minute' from course where id = :c", c=COURSE_A))
            for label, patch in (('an unknown setting', '{"student_page_enabled": true}'), ('send_work that is not true or false', '{"send_work": "yes"}'),
                                 ('a Keep Photos Until that is no choice', '{"keep_photos_until": "forever"}'), ('a patch that is a list', '[]')):
                e = refused(d, lambda: d.rpc('set_course_send_work(:c, :p::jsonb, :k)', c=COURSE_A, p=patch, k=nid()))
                ok('set_course_send_work refuses %s (22023)' % label, e is not None and e[1] == '22023', e)
            e = refused(d, lambda: d.rpc("set_course_send_work(:c, '{\"send_work\": false}'::jsonb, :k)", uid=B, c=COURSE_A, k=nid()))
            ok("another teacher's class: course not found (P0002), nothing changed", e is not None and e[1] == 'P0002' and d.one('select send_work from course where id = :c', c=COURSE_A) is True, e)
            e = refused(d, lambda: d.rpc("set_course_send_work(:c, '{\"send_work\": false}'::jsonb, :k)", uid=None, c=COURSE_A, k=nid()))
            ok('nobody signed in: not authenticated (PT401)', e is not None and e[1] == 'PT401', e)
            e = refused(d, lambda: d.role('anon', "select set_course_send_work('%s', '{}'::jsonb, null)" % COURSE_A))
            ok('anon cannot run it at all', e is not None and 'permission denied' in e[0], e)

            # ── An assessment's Student Work card ───────────────────────
            n = k['nothing']
            r = d.rpc("set_assessment_student_work(:a, '{\"students_send\": \"photos_files\"}'::jsonb, :k)", a=n, k=nid())
            ok('set_assessment_student_work sets Students Send and returns the five settings',
               r == {'id': n, 'students_send': 'photos_files', 'after_due': 'keep', 'accept_until': None, 'group_work': 'each', 'students_see_markup': True}, r)
            e = refused(d, lambda: d.rpc("set_assessment_student_work(:a, '{\"after_due\": \"until\"}'::jsonb, :k)", a=n, k=nid()))
            ok('Until a date with no date is refused (22023)', e is not None and e[1] == '22023', e)
            r = d.rpc("set_assessment_student_work(:a, '{\"after_due\": \"until\", \"accept_until\": \"2027-01-15\"}'::jsonb, :k)", a=n, k=nid())
            ok('Until a date keeps its date', (r['after_due'], r['accept_until']) == ('until', '2027-01-15'), r)
            r = d.rpc("set_assessment_student_work(:a, '{\"group_work\": \"group\", \"students_see_markup\": false}'::jsonb, :k)", a=n, k=nid())
            ok('a later patch leaves the date alone and stores Group Work and Students See Your Mark Up',
               (r['after_due'], r['accept_until'], r['group_work'], r['students_see_markup'], r['students_send']) == ('until', '2027-01-15', 'group', False, 'photos_files'), r)
            r = d.rpc("set_assessment_student_work(:a, '{\"after_due\": \"stop\"}'::jsonb, :k)", a=n, k=nid())
            ok('choosing Stop drops the date', (r['after_due'], r['accept_until']) == ('stop', None), r)
            d.run("update assessment set due_date = '2027-01-20' where id = :a", a=n)
            e = refused(d, lambda: d.rpc("set_assessment_student_work(:a, '{\"after_due\": \"until\", \"accept_until\": \"2027-01-15\"}'::jsonb, :k)", a=n, k=nid()))
            ok('a last day before the due date is refused (22023)', e is not None and e[1] == '22023', e)
            for label, patch in (('an unknown setting', '{"title": "x"}'), ('a Students Send that is no choice', '{"students_send": "videos"}'),
                                 ('an After the Due Date that is no choice', '{"after_due": "never"}'), ('a date that is not one', '{"after_due": "until", "accept_until": "2027-02-30"}'),
                                 ('a Group Work that is no choice', '{"group_work": "pairs"}'), ('a Mark Up choice that is not true or false', '{"students_see_markup": 1}')):
                e = refused(d, lambda: d.rpc('set_assessment_student_work(:a, :p::jsonb, :k)', a=n, p=patch, k=nid()))
                ok('set_assessment_student_work refuses %s (22023)' % label, e is not None and e[1] == '22023', e)
            e = refused(d, lambda: d.rpc("set_assessment_student_work(:a, '{\"students_send\": \"photos\"}'::jsonb, :k)", uid=B, a=n, k=nid()))
            ok("another teacher's assessment: not found (P0002)", e is not None and e[1] == 'P0002', e)
            e = refused(d, lambda: d.run("update assessment set after_due = 'until' where id = :a", a=n))
            ok('the table itself refuses Until with no date, whoever writes it', e is not None and 'assessment_accept_until_check' in e[0], e)
            ok('the assessment says when it was changed, and its title, scoring and dates are as they were',
               d.one("select title = 'Paper Quiz' and score_mode = 'points' and max_points = 10 and updated_at >= now() - interval '1 minute' from assessment where id = :a", a=n))

        # ── Add Work: a new submission ──────────────────────────────────
        with tx(d):
            key = nid()
            s = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{"width": 1500, "height": 2000}, {}]', m='new', k=key)
            ok('start_work_upload makes the rows and names two paths for each page, in order',
               s['result'] == 'ready' and s['bucket'] == 'student-photos' and [f['page'] for f in s['files']] == [1, 2]
               and all(PATH_RE.match(f['path']) and f['thumb_path'] == f['path'][:-4] + '-thumb.jpg' for f in s['files']), s)
            m = PATH_RE.match(s['files'][0]['path'])
            ok('a path is the class, the assessment, the student, the submission and the page, all ids the server made',
               m.groups()[:5] == (COURSE_A, a, ENR1, s['submission_id'], s['files'][0]['file_id']), m.groups())
            ok('the same key again returns the same rows and makes nothing',
               d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}, {}]', m='new', k=key) == s
               and d.one('select count(*) from submission') == 1 and d.one('select count(*) from submission_file') == 2)
            lst = d.rpc('list_course_submissions(:c)', c=COURSE_A)
            ok('until it is finished the list shows it only as an upload of the teacher\'s own, never as work handed in',
               lst['submissions'] == [] and [u['id'] for u in lst['uploads']] == [s['submission_id']], lst)
            files = json.dumps([{'file_id': f['file_id'], 'sha256': HASH} for f in s['files']])
            fkey = nid()
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=files, k=fkey)
            ok('finish_work_upload before any file is up: missing_pages, naming both pages; nothing is handed in',
               r == {'result': 'missing_pages', 'missing': [f['file_id'] for f in s['files']]} and d.one("select count(*) from submission where state = 'sent'") == 0, r)
            for f in s['files']:
                d.storage.put_as('authenticated', A, f['path']); d.storage.put_as('authenticated', A, f['thumb_path'], size=20000)
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=files, k=fkey)
            sub = r.get('submission') or {}
            ok('with every file up, the same call (same key: a missing page was not remembered) hands the work in',
               r['result'] == 'sent' and sub['state'] == 'sent' and sub['sent_by'] == 'teacher' and sub['on_paper'] is False and sub['version'] == 1
               and [(f['page'], f['bytes'], f['thumb_bytes'], f['sha256'], f['rotation']) for f in sub['files']] == [(1, 300000, 20000, HASH, 0), (2, 300000, 20000, HASH, 0)], r)
            ok('the page sizes are the ones storage recorded, and the first page keeps the width and height it was started with',
               (sub['files'][0]['width'], sub['files'][0]['height'], sub['files'][1]['width']) == (1500, 2000, None), sub['files'])
            ok('finishing again with the same key returns the same answer', d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=files, k=fkey) == r)
            ok('finishing again with a new key says sent too, and changes nothing',
               d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=files, k=nid())['result'] == 'sent' and d.one('select count(*) from submission') == 1)
            lst = d.rpc('list_course_submissions(:c)', c=COURSE_A)
            ok('the list now shows it as handed in, with its pages, and no upload waiting',
               [x['id'] for x in lst['submissions']] == [s['submission_id']] and lst['uploads'] == [] and len(lst['submissions'][0]['files']) == 2
               and 'intent' not in lst['submissions'][0], lst)
            ok('the list carries the class\'s two settings and every assessment\'s Student Work settings',
               lst['course'] == {'send_work': True, 'keep_photos_until': 'end_of_year'} and lst['bucket'] == 'student-photos'
               and sorted((x['id'], x['students_send']) for x in lst['assessments']) == sorted([(a, 'photos'), (k['nothing'], 'nothing')]), lst['assessments'])

            # ── already there: the three choices ────────────────────────
            r2 = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='new', k=nid())
            ok('a second new upload for a student whose work is in makes nothing and says already_sent, with what is there',
               r2['result'] == 'already_sent' and r2['submission']['id'] == s['submission_id'] and d.one('select count(*) from submission') == 1, r2)
            before = live_paths(d)
            add, done = d.teacher_upload(a, ENR1, 2, mode='add')
            pages = d.all('select page, path from submission_file where submission_id = :s order by page', s=s['submission_id'])
            ok('Add as More Pages: the new pages go on the end of the same submission, 3 and 4, and the first two are untouched',
               done['result'] == 'sent' and done['submission']['id'] == s['submission_id'] and [p[0] for p in pages] == [1, 2, 3, 4]
               and [p[1] for p in pages[:2]] == [f['path'] for f in s['files']] and [p[1] for p in pages[2:]] == [f['path'] for f in add['files']], (done, pages))
            ok('the row that carried them is gone, no file was queued for deletion, and every file is still in storage',
               d.one('select count(*) from submission') == 1 and queued(d) == [] and set(before) <= set(d.storage.names()) and len(d.storage.names()) == 8)
            rep, done = d.teacher_upload(a, ENR1, 1, mode='replace')
            ok('Replace Them: a new submission takes its place, version 1, with only the new page',
               done['result'] == 'sent' and done['submission']['id'] == rep['submission_id'] and done['submission']['version'] == 1
               and d.one('select count(*) from submission') == 1 and len(done['submission']['files']) == 1, done)
            ok('the four old pages (eight files) are queued for deletion as replaced; the new page is not; storage still holds all ten until the worker runs',
               len(queued(d, 'replace')) == 8 and set(queued(d)) == set(p for row in pages for p in (row[1], row[1][:-4] + '-thumb.jpg'))
               and len(d.storage.names()) == 10 and sound(d) == '', (len(queued(d)), sound(d)))
            ok('nothing a teacher did here touched a grade', score_fingerprint(d) == g0)

        with tx(d):
            # ── what Add Work refuses ───────────────────────────────────
            r = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='add', k=nid())
            ok('Add as More Pages with nothing handed in: nothing_sent, nothing made', r == {'result': 'nothing_sent'} and d.one('select count(*) from submission') == 0, r)
            r = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='replace', k=nid())
            ok('Replace Them with nothing handed in: nothing_sent', r == {'result': 'nothing_sent'}, r)
            for label, sql, kw, code in (
                    ("another teacher's assessment", 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=k['b_takes'], e=ENR1, p='[{}]', m='new'), 'P0002'),
                    ("another teacher's student", 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR_B, p='[{}]', m='new'), 'P0002'),
                    ('a mode that is none of the three', 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR1, p='[{}]', m='append'), '22023'),
                    ('no pages', 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR1, p='[]', m='new'), '22023'),
                    ('31 pages', 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR1, p=json.dumps([{}] * 31), m='new'), '22023'),
                    ('pages that are not a list', 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR1, p='{"0": {}}', m='new'), '22023'),
                    ('a page with a width that is not a number', 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR1, p='[{"width": "wide"}]', m='new'), '22023'),
                    ('a page with a width of 0', 'start_work_upload(:a, :e, :p::jsonb, :m, :k)', dict(a=a, e=ENR1, p='[{"width": 0}]', m='new'), '22023')):
                e = refused(d, lambda: d.rpc(sql, k=nid(), **kw))
                ok('start_work_upload refuses %s (%s)' % (label, code), e is not None and e[1] == code, e)
            e = refused(d, lambda: d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', uid=B, a=a, e=ENR1, p='[{}]', m='new', k=nid()))
            ok("Teacher B cannot add work in Teacher A's class (P0002)", e is not None and e[1] == 'P0002', e)
            other = nid(); d.run("insert into course (id, teacher_id, name) values (:c, :t, 'Another Block')", c=other, t=A)
            oe = nid(); d.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=oe, s=STU1, c=other)
            e = refused(d, lambda: d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=oe, p='[{}]', m='new', k=nid()))
            ok("a student of the teacher's own in another of their classes is not this assessment's student (P0002)", e is not None and e[1] == 'P0002', e)
            d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR2)
            e = refused(d, lambda: d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR2, p='[{}]', m='new', k=nid()))
            ok('a withdrawn student: not found (P0002)', e is not None and e[1] == 'P0002', e)
            ok('none of those refusals made a row', d.one('select count(*) from submission') == 0)
            e = refused(d, lambda: d.run("""insert into submission (course_id, assessment_id, enrollment_id, state, sent_by) values (:c, :a, :e, 'sending', 'teacher')""",
                                         c=COURSE_A, a=k['b_takes'], e=ENR1))
            ok('the table itself refuses a submission whose student and assessment are in different classes, whoever writes it', e is not None and e[1] == '23514', e)
            s = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}, {}]', m='new', k=nid())
            e = refused(d, lambda: d.run('update submission set enrollment_id = :e where id = :s', e=ENR2, s=s['submission_id']))
            ok('and a submission cannot be moved to another student', e is not None and e[1] == '23514', e)
            # finish: shapes, strangers, bad files
            good = [{'file_id': f['file_id'], 'sha256': HASH} for f in s['files']]
            for label, files in (('no files', []), ('a file with no hash', [{'file_id': good[0]['file_id']}]), ('a hash that is not 64 hex', [{'file_id': good[0]['file_id'], 'sha256': 'ABC'}]),
                                 ('the same file twice', [good[0], good[0]]), ('a file id that is not an id', [{'file_id': 'page-1', 'sha256': HASH}]),
                                 ('a file of no upload', [{'file_id': nid(), 'sha256': HASH}])):
                e = refused(d, lambda: d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps(files), k=nid()))
                ok('finish_work_upload refuses %s (22023)' % label, e is not None and e[1] == '22023', e)
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', uid=B, s=s['submission_id'], f=json.dumps(good), k=nid())
            ok("Teacher B finishing Teacher A's upload: gone, nothing changed", r == {'result': 'gone'} and d.one("select state from submission where id = :s", s=s['submission_id']) == 'sending', r)
            ok('an upload that never was: gone', d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=nid(), f=json.dumps(good), k=nid()) == {'result': 'gone'})
            for f in s['files']: d.storage.put_as('authenticated', A, f['thumb_path'], size=20000)
            d.storage.put_as('authenticated', A, s['files'][0]['path'])
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps(good), k=nid())
            ok('one page up and one not: missing_pages names the one that is not', r == {'result': 'missing_pages', 'missing': [s['files'][1]['file_id']]}, r)
            # a file storage recorded as too large or as another type (the bucket refuses both; this is the second look)
            d.run("insert into storage.objects (bucket_id, name, metadata) values ('student-photos', :n, '{\"size\": 3000000, \"mimetype\": \"image/jpeg\"}')", n=s['files'][1]['path'])
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps(good), k=nid())
            ok('a file storage holds at 3 MB is not taken: bad_file names it, nothing is handed in', r == {'result': 'bad_file', 'files': [s['files'][1]['file_id']]}, r)
            d.run("update storage.objects set metadata = '{\"size\": 300000, \"mimetype\": \"application/pdf\"}' where name = :n", n=s['files'][1]['path'])
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps(good), k=nid())
            ok('nor one storage holds as a PDF: bad_file', r == {'result': 'bad_file', 'files': [s['files'][1]['file_id']]}, r)
            # leave a page out: Remove the Page
            r = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps(good[:1]), k=nid())
            ok('finishing with only the first page hands in one page; the page left out is deleted and its two files queued',
               r['result'] == 'sent' and len(r['submission']['files']) == 1 and queued(d, 'page_removed') == sorted([s['files'][1]['path'], s['files'][1]['thumb_path']]), (r, queued(d)))

        with tx(d):
            # ── an upload started again; pages over the limit ───────────
            s1 = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='new', k=nid())
            d.storage.put_as('authenticated', A, s1['files'][0]['path'])
            s2 = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='new', k=nid())
            ok("a second upload started for the same student drops the first, unfinished one; its files are queued as abandoned",
               s2['result'] == 'ready' and d.one('select count(*) from submission') == 1 and queued(d, 'abandoned') == sorted([s1['files'][0]['path'], s1['files'][0]['thumb_path']]), queued(d))
            ok('finishing the dropped one: gone', d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s1['submission_id'],
                                                         f=json.dumps([{'file_id': s1['files'][0]['file_id'], 'sha256': HASH}]), k=nid()) == {'result': 'gone'})
            d.teacher_upload(a, ENR2, 29)
            r = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR2, p='[{}, {}]', m='add', k=nid())
            ok('adding two pages to a submission of 29: too_many_pages, room for one, nothing made (30 at most)', r == {'result': 'too_many_pages', 'room': 1}, r)
            ok('adding one is taken', d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR2, p='[{}]', m='add', k=nid())['result'] == 'ready')

        # ── Handed In on Paper ──────────────────────────────────────────
        with tx(d):
            d.teacher_upload(a, ENR1, 1)
            pkey = nid()
            r = d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1, ENR2, ENR_B, nid()], k=pkey)
            ok('mark_handed_in_paper marks the student with nothing in, and leaves the one with photos, the stranger and the unknown id alone',
               r['marked'] == 1 and [(x['enrollment_id'], x['on_paper'], x['sent_by'], x['state'], x['files']) for x in r['submissions']] == [(ENR2, True, 'teacher', 'sent', [])]
               and d.one('select count(*) from submission') == 2, r)
            ok('the same key again returns the same answer and marks nobody', d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1, ENR2], k=pkey) == r and d.one('select count(*) from submission') == 2)
            ok('a second call with a new key marks nobody: both have work in', d.rpc('mark_handed_in_paper(:a, :e, :k)', a=a, e=[ENR1, ENR2], k=nid())['marked'] == 0)
            ok('it works on an assessment set to take nothing: the paper pile', d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['nothing'], e=[ENR1], k=nid())['marked'] == 1)
            e = refused(d, lambda: d.rpc('mark_handed_in_paper(:a, :e, :k)', uid=B, a=a, e=[ENR1], k=nid()))
            ok("another teacher's assessment: not found (P0002)", e is not None and e[1] == 'P0002', e)
            r = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR2, p='[{}]', m='add', k=nid())
            ok('pages cannot be added to a paper hand-in: on_paper, nothing made; Replace Them is the way', r['result'] == 'on_paper' and r['submission']['on_paper'] is True and d.one('select count(*) from submission') == 3, r)
            rep, done = d.teacher_upload(a, ENR2, 1, mode='replace')
            ok('Replace Them on a paper hand-in puts photos in its place', done['result'] == 'sent' and done['submission']['on_paper'] is False and queued(d) == [], done)
            e = refused(d, lambda: d.run("insert into submission (course_id, assessment_id, enrollment_id, state, sent_by, on_paper, sent_at) values (:c, :a, :e, 'sent', 'student', true, now())",
                                         c=COURSE_A, a=k['nothing'], e=ENR2))
            ok('the table refuses a paper hand-in said to be from a student', e is not None and 'submission_paper_is_teachers' in e[0], e)

        # ── delete, rotate ──────────────────────────────────────────────
        with tx(d):
            s, done = d.teacher_upload(a, ENR1, 2)
            fid = s['files'][0]['file_id']
            r = d.rpc('rotate_submission_page(:f, 90, :k)', f=fid, k=nid())
            ok('rotate_submission_page turns one page; the file and the other page are not touched',
               r == {'file_id': fid, 'rotation': 90} and d.all('select rotation from submission_file where submission_id = :s order by page', s=s['submission_id']) == [[90], [0]], r)
            e = refused(d, lambda: d.rpc('rotate_submission_page(:f, 45, :k)', f=fid, k=nid()))
            ok('a turn of 45 is refused (22023)', e is not None and e[1] == '22023', e)
            e = refused(d, lambda: d.rpc('rotate_submission_page(:f, 180, :k)', uid=B, f=fid, k=nid()))
            ok("another teacher's page: not found (P0002), not turned", e is not None and e[1] == 'P0002' and d.one('select rotation from submission_file where id = :f', f=fid) == 90, e)
            r = d.rpc('delete_submission(:s, :k)', uid=B, s=s['submission_id'], k=nid())
            ok("Teacher B deleting Teacher A's submission: deleted false, nothing gone", r == {'deleted': False, 'pages': 0} and d.one('select count(*) from submission') == 1, r)
            dkey = nid()
            r = d.rpc('delete_submission(:s, :k)', s=s['submission_id'], k=dkey)
            ok('delete_submission removes the work; its four files are queued for deletion as the teacher\'s',
               r == {'deleted': True, 'pages': 2} and d.one('select count(*) from submission') == 0 and len(queued(d, 'teacher')) == 4, (r, queued(d)))
            ok('the same key again: the same answer', d.rpc('delete_submission(:s, :k)', s=s['submission_id'], k=dkey) == r)
            ok('a new key: deleted false, and that is not an error', d.rpc('delete_submission(:s, :k)', s=s['submission_id'], k=nid()) == {'deleted': False, 'pages': 0})
            ok('every queued path carries its class, so it can be counted after the class is gone',
               d.all('select distinct course_id from submission_file_removal') == [[COURSE_A]])
            ok('nothing a teacher did here touched a grade', score_fingerprint(d) == g0)
        with tx(d):
            e = refused(d, lambda: d.rpc('list_course_submissions(:c)', uid=B, c=COURSE_A))
            ok("list_course_submissions refuses another teacher's class (P0002)", e is not None and e[1] == 'P0002', e)
            e = refused(d, lambda: d.rpc('list_course_submissions(:c)', uid=None, c=COURSE_A))
            ok('and nobody signed in (PT401)', e is not None and e[1] == 'PT401', e)
            for role in ('anon', 'authenticated'):
                for t in ('public.submission', 'public.submission_file', 'public.submission_file_removal'):
                    e = refused(d, lambda: d.role(role, 'select * from ' + t, uid=A if role == 'authenticated' else None))
                    ok('%s cannot read %s straight from the table' % (role, t), e is not None and 'permission denied' in e[0], e)
            e = refused(d, lambda: d.role('service_role', 'select * from public.submission_file_removal'))
            ok('not even the service role reads the removal queue as a table: it has the two functions', e is not None and 'permission denied' in e[0], e)
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_student():
    d, k = applied('student')
    try:
        a = k['takes']
        tok, code = d.session(ENR1)
        tok2, code2 = d.session(ENR2, birthday='2012-06-16')
        tokb, codeb = d.session(ENR_B, birthday='2012-07-17', course=COURSE_B, teacher=B)
        log0 = d.one('select count(*) from student_submit.attempt')
        calls = {
            'work': lambda t, e, x: d.work(t, e),
            'send_start': lambda t, e, x: d.send_start(t, e, x),
            'replace': lambda t, e, x: d.send_start(t, e, x, replace=True),
            'send_finish': lambda t, e, x: d.send_finish(t, e, nid(), [{'file_id': nid()}]),
            'unsend': lambda t, e, x: d.unsend(t, e, x),
            'file_links': lambda t, e, x: d.file_links(t, e, x)}
        WRITES = ('send_start', 'replace', 'send_finish', 'unsend')

        # ── Who is asking ───────────────────────────────────────────────
        with tx(d):
            for name, call in calls.items():
                ok('%s with no session: signed_out' % name, err(call(None, ENR1, a)) == 'signed_out')
                ok('%s with a token that was never issued: signed_out' % name, err(call('ab' * 32, ENR1, a)) == 'signed_out')
                ok("%s for another student's enrollment in the same class: not_found (Cece's session is not Marcus's)" % name, err(call(tok, ENR2, a)) == 'not_found')
                ok("%s for a student of another teacher's class: not_found" % name, err(call(tok, ENR_B, a)) == 'not_found')
            ok('none of those made a row or asked storage for anything', d.one('select count(*) from submission') == 0 and d.one('select count(*) from student_submit.send_log') == 0)
            ok("send_start for an assessment of another teacher's class, with Cece's own session and enrollment: not_found", err(d.send_start(tok, ENR1, k['b_takes'])) == 'not_found')
            ok("and with that class's own student, an assessment of Teacher A's: not_found", err(d.send_start(tokb, ENR_B, a)) == 'not_found')
            ok('unsend and file_links for an assessment of another class answer not_found and nothing',
               err(d.unsend(tok, ENR1, k['b_takes'])) == 'not_found' and d.file_links(tok, ENR1, k['b_takes'])['files'] == [])
        for label, setup, want in (
                ("the class's Student Page is turned off", "update course set student_page_enabled = false where id = '%s'" % COURSE_A, 'closed'),
                ('the student is withdrawn', "update enrollment set withdrawn_at = now() where id = '%s'" % ENR1, 'not_found'),
                ('the class is deleted', "update course set deleted_at = now() where id = '%s'" % COURSE_A, 'not_found'),
                ('the card was replaced', "update student_card set stopped_at = now() where enrollment_id = '%s' and stopped_at is null" % ENR1, 'card_stopped'),
                ('the card is past its last day', "update student_card set works_until = current_date - 30 where enrollment_id = '%s' and stopped_at is null" % ENR1, 'card_expired'),
                ('the session is past its midnight', "update student_submit.device_session set expires_at = now() - interval '1 second'", 'signed_out')):
            with tx(d):
                d.run(setup)
                got = {name: err(call(tok, ENR1, a)) for name, call in calls.items()}
                ok('%s: every one of the six answers %s' % (label, want), set(got.values()) == {want}, got)
        with tx(d):
            d.run("update student_card set locked_at = now() where enrollment_id = :e and stopped_at is null", e=ENR1)
            got = {name: err(calls[name](tok, ENR1, a)) for name in WRITES}
            ok('the card is locked (wrong tries on another device): the four that send or change work answer card_locked', set(got.values()) == {'card_locked'}, got)
            ok('none of them made a row', d.one('select count(*) from submission') == 0)
        with tx(d):
            d.service("student_submit.done(:t, 'ip-1')", t=tok)
            got = {name: err(call(tok, ENR1, a)) for name, call in calls.items()}
            ok('after Done: every one answers signed_out', set(got.values()) == {'signed_out'}, got)

        # ── What the assessment and the class allow ─────────────────────
        with tx(d):
            ok('an assessment set to take nothing: not_taking_work', err(d.send_start(tok, ENR1, k['nothing'])) == 'not_taking_work')
            d.run('update course set send_work = false where id = :c', c=COURSE_A)
            ok('Send Work off for the class: send_off, though the assessment takes photos', err(d.send_start(tok, ENR1, a)) == 'send_off')
            w = d.work(tok, ENR1)
            ok('work says so too: send_work false, and the assessment not open', w['send_work'] is False and [x['open'] for x in w['assessments']] == [False], w)
        with tx(d):
            d.run("update assessment set date_assigned = :d::date + 1 where id = :a", d=k['today'], a=a)
            ok('an assessment whose date has not come is not on the page, and cannot be sent to: not_found', err(d.send_start(tok, ENR1, a)) == 'not_found' and d.work(tok, ENR1)['assessments'] == [])
            d.run("update assessment set date_assigned = :d::date where id = :a", d=k['today'], a=a)
            ok('on its date it can', d.send_start(tok, ENR1, a)['ok'] is True)
        for label, setup, open_, late, closes in (
                ('Keep Accepting, due yesterday', "due_date = :d::date - 1, after_due = 'keep'", True, True, None),
                ('Keep Accepting, due today', "due_date = :d::date, after_due = 'keep'", True, False, None),
                ('Keep Accepting, no due date', "due_date = null, after_due = 'keep'", True, False, None),
                ('Stop, due today', "due_date = :d::date, after_due = 'stop'", True, False, 0),
                ('Stop, due yesterday', "due_date = :d::date - 1, after_due = 'stop'", False, True, -1),
                ('Stop, no due date', "due_date = null, after_due = 'stop'", True, False, None),
                ('Until today, due last week', "due_date = :d::date - 7, after_due = 'until', accept_until = :d::date", True, True, 0),
                ('Until yesterday, due last week', "due_date = :d::date - 7, after_due = 'until', accept_until = :d::date - 1", False, True, -1)):
            with tx(d):
                d.run('update assessment set %s where id = :a' % setup, d=k['today'], a=a)
                day = None if closes is None else str(k['today'] + datetime.timedelta(days=closes))
                w = d.work(tok, ENR1)['assessments'][0]
                s = d.send_start(tok, ENR1, a)
                ok('%s: %s' % (label, 'open' + (', and marked late' if late else '') if open_ else 'work_closed, with the day it closed'),
                   (w['open'], w['late_now'], w['closes_on']) == (open_, late, day)
                   and ((s.get('ok') is True and s['late'] is late) if open_ else (err(s) == 'work_closed' and s['closed_on'] == day)), (w, s))
        with tx(d):
            d.run("update course set timezone = 'Pacific/Kiritimati' where id = :c", c=COURSE_A)   # 14 hours ahead of UTC: already tomorrow there
            there = d.one("select (now() at time zone 'Pacific/Kiritimati')::date")
            d.run("update assessment set due_date = :d::date - 1, after_due = 'stop' where id = :a", d=there, a=a)
            ok("the last day is judged by the class's own time zone, not the server's", err(d.send_start(tok, ENR1, a)) == 'work_closed')

        # ── A wrong shape is the caller's bug: the call fails ───────────
        with tx(d):
            for label, fn in (
                    ('no request id', lambda: d.service("student_submit.send_start(:t, :e, :a, '[{}]'::jsonb, null, null, null, 'ip')", t=tok, e=ENR1, a=a)),
                    ('no assessment', lambda: d.service("student_submit.send_start(:t, :e, null, '[{}]'::jsonb, null, null, :r, 'ip')", t=tok, e=ENR1, r=nid())),
                    ('no pages', lambda: d.send_start(tok, ENR1, a, pages=[])),
                    ('31 pages', lambda: d.send_start(tok, ENR1, a, pages=31)),
                    ('pages that are not a list', lambda: d.service("student_submit.send_start(:t, :e, :a, '{}'::jsonb, null, null, :r, 'ip')", t=tok, e=ENR1, a=a, r=nid())),
                    ('a page that is not an object', lambda: d.send_start(tok, ENR1, a, pages=['page'])),
                    ('a height of 30000', lambda: d.send_start(tok, ENR1, a, pages=[{'height': 30000}])),
                    ('a note of 1001 characters', lambda: d.send_start(tok, ENR1, a, note='x' * 1001)),
                    ('a Did You Do It? that is none of the three', lambda: d.send_start(tok, ENR1, a, plan='maybe')),
                    ('a finish with no submission', lambda: d.service("student_submit.send_finish(:t, :e, null, '[]'::jsonb, 'ip')", t=tok, e=ENR1)),
                    ('a finish with no files', lambda: d.send_finish(tok, ENR1, nid(), [])),
                    ('a finish whose hash is not 64 hex', lambda: d.send_finish(tok, ENR1, nid(), [{'file_id': nid(), 'sha256': 'zz'}])),
                    ('an unsend with no assessment', lambda: d.service("student_submit.unsend(:t, :e, null, 'ip')", t=tok, e=ENR1))):
                e = refused(d, fn)
                ok('%s: the call fails (22023)' % label, e is not None and e[1] == '22023', e)
            ok('a note of exactly 1000 characters is taken', d.send_start(tok, ENR1, a, note='x' * 1000)['ok'] is True)

        # ── Sending ─────────────────────────────────────────────────────
        with tx(d):
            g0 = score_fingerprint(d)
            w0 = d.work(tok, ENR1)
            ok('work before anything is sent: the one assessment that takes work, open, nothing sent',
               w0 == {'ok': True, 'v': 1, 'send_work': True, 'assessments': [{'id': a, 'students_send': 'photos', 'open': True, 'closes_on': None,
                                                                              'late_now': False, 'sent': None, 'sending': None}]}, w0)
            req = nid()
            s = d.send_start(tok, ENR1, a, pages=[{'width': 1500, 'height': 2000}, {'width': 2000, 'height': 1500}, {}], note='  I was away Thursday.  ', plan='partly', request=req)
            ok('send_start: three pages, each with a path and a thumbnail path made from server ids',
               s['ok'] is True and s['replayed'] is False and s['state'] == 'sending' and s['bucket'] == 'student-photos' and s['late'] is False
               and [f['page'] for f in s['files']] == [1, 2, 3] and all(PATH_RE.match(f['path']).groups()[:5] == (COURSE_A, a, ENR1, s['submission_id'], f['file_id'])
                                                                        and f['thumb_path'] == f['path'][:-4] + '-thumb.jpg' for f in s['files']), s)
            ok('the reply gives nothing but ids, paths and the late mark', sorted(s) == ['bucket', 'files', 'late', 'ok', 'replayed', 'state', 'submission_id']
               and sorted(s['files'][0]) == ['file_id', 'page', 'path', 'thumb_path'], sorted(s))
            again = d.send_start(tok, ENR1, a, pages=3, request=req)
            ok('the same request id again (the reply was lost): the same submission and the same paths, marked replayed; nothing new is made or counted',
               again['replayed'] is True and (again['submission_id'], again['files']) == (s['submission_id'], s['files'])
               and d.one('select count(*) from submission') == 1 and d.one('select count(*) from student_submit.send_log') == 1, again)
            w = d.work(tok, ENR1)['assessments'][0]
            ok('work shows it as a send of the student\'s that is not finished, and nothing sent yet',
               w['sent'] is None and w['sending'] is not None and (w['sending']['submission_id'], w['sending']['intent'], w['sending']['pages']) == (s['submission_id'], 'new', 3), w)
            ok('the teacher does not see it: nothing is handed in until every page is up',
               d.rpc('list_course_submissions(:c)', c=COURSE_A)['submissions'] == [] and d.rpc('list_course_submissions(:c)', c=COURSE_A)['uploads'] == [])
            r = d.send_finish(tok, ENR1, s['submission_id'], s['files'])
            ok('send_finish with nothing uploaded: missing_pages, naming all three', r == {'ok': False, 'error': 'missing_pages', 'missing': [f['file_id'] for f in s['files']]}, r)
            d.upload(s['files'][:2])
            d.storage.put_signed(d.storage.sign_upload(s['files'][2]['path']))
            r = d.send_finish(tok, ENR1, s['submission_id'], s['files'])
            ok('with only the third page\'s thumbnail missing: missing_pages names the third page', r == {'ok': False, 'error': 'missing_pages', 'missing': [s['files'][2]['file_id']]}, r)
            ok('still nothing handed in', d.one("select count(*) from submission where state = 'sent'") == 0)
            d.storage.put_signed(d.storage.sign_upload(s['files'][2]['thumb_path']), size=15000)
            hashes = [dict(f, sha256=('%02x' % n) * 32) for n, f in enumerate(s['files'])]
            r = d.send_finish(tok, ENR1, s['submission_id'], hashes)
            ok('send_finish with every file up hands it in',
               r['ok'] is True and r['replayed'] is False and r['submission_id'] == s['submission_id'] and r['pages'] == 3 and r['late'] is False and r['sent_at'], r)
            row = d.all('select state, intent, sent_by, on_paper, note, followed_plan, is_late, version, card_id is not null, sent_at is not null from submission')[0]
            ok('the row: handed in by the student, the note trimmed, Did You Do It? as given, version 1, the card that sent it',
               row == ['sent', 'new', 'student', False, 'I was away Thursday.', 'partly', False, 1, True, True], row)
            ok('each page has the hash the finish call gave, its size as storage recorded it, and the size it was started with',
               d.all('select page, sha256, bytes, thumb_bytes, width, height from submission_file order by page')
               == [[1, '00' * 32, 300000, 300000, 1500, 2000], [2, '01' * 32, 300000, 300000, 2000, 1500], [3, '02' * 32, 300000, 15000, None, None]])
            ok('the same finish again: ok, marked replayed, nothing changed', (lambda x: x['ok'] and x['replayed'] and x['pages'] == 3)(d.send_finish(tok, ENR1, s['submission_id'], hashes)))
            ok('the same send_start again after it is handed in: replayed, state sent, no paths',
               (lambda x: x['replayed'] and x['state'] == 'sent' and x['files'] == [])(d.send_start(tok, ENR1, a, pages=3, request=req)))
            w = d.work(tok, ENR1)['assessments'][0]
            ok('work: sent, by the student, three pages, the note, not being graded, can be changed',
               w['sending'] is None and (w['sent']['submission_id'], w['sent']['sent_by'], w['sent']['pages'], w['sent']['note'], w['sent']['grading'], w['sent']['can_change'], w['sent']['on_paper'])
               == (s['submission_id'], 'student', 3, 'I was away Thursday.', False, True, False), w)
            lst = d.rpc('list_course_submissions(:c)', c=COURSE_A)['submissions']
            ok('the teacher now sees it, with the note and the three pages', len(lst) == 1 and lst[0]['note'] == 'I was away Thursday.' and [f['page'] for f in lst[0]['files']] == [1, 2, 3], lst)
            fl = d.file_links(tok, ENR1, a)
            ok("file_links: the student's own three pages, with their paths and thumbnails, in order",
               fl['ok'] and fl['bucket'] == 'student-photos' and [(f['file_id'], f['page'], f['path'], f['thumb_path']) for f in fl['files']]
               == [(f['file_id'], f['page'], f['path'], f['thumb_path']) for f in s['files']], fl)
            ok("another student, signed in with their own card, is given none of them", d.file_links(tok2, ENR2, a) == {'ok': True, 'bucket': 'student-photos', 'files': []})
            ok("and work for that student shows nothing sent", d.work(tok2, ENR2)['assessments'][0]['sent'] is None)
            ok('a second send for the piece: already_sent', err(d.send_start(tok, ENR1, a)) == 'already_sent')
            ok('nothing here read or wrote a grade: the four score tables and grade_return are byte for byte what they were', score_fingerprint(d) == g0)
            ok('and nothing was written to the sign-in log', d.one('select count(*) from student_submit.attempt') == log0)
            ok('every rule that must always hold, holds', sound(d) == '', sound(d))

            # ── Unsend ──────────────────────────────────────────────────
            paths = live_paths(d)
            r = d.unsend(tok, ENR1, a)
            ok('unsend: the submission and its pages are gone', r == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 3} and d.one('select count(*) from submission') == 0
               and d.one('select count(*) from submission_file') == 0, r)
            ok('all six files are queued for deletion, as unsent, in the same transaction', queued(d, 'unsend') == paths and len(paths) == 6, queued(d))
            ok('the database deleted no file itself: storage still holds all six until the worker removes them', d.storage.names() == paths)
            ok('unsend again: ok, nothing was sent, and that is not an error', d.unsend(tok, ENR1, a) == {'ok': True, 'unsent': False, 'cancelled': False, 'pages': 0})
            ok('the piece is back to nothing sent, and can be sent again', d.work(tok, ENR1)['assessments'][0]['sent'] is None and d.send_start(tok, ENR1, a)['ok'] is True)
            b, done = d.drain()
            ok('the worker: one batch of six, each removed through the Storage API, and then believed',
               len(b['items']) == 6 and done == {'ok': True, 'gone': 6, 'still_there': []} and d.storage.names() == [], (b, done))

        # ── One Page Didn't Send: Remove the Page; pages in a new order ─
        with tx(d):
            s = d.send_start(tok, ENR1, a, pages=3)
            d.upload([s['files'][0], s['files'][2]])
            r = d.send_finish(tok, ENR1, s['submission_id'], [s['files'][2], s['files'][0]])
            ok('finishing with pages 3 and 1 only, in that order: two pages handed in, in the order given',
               r['ok'] and r['pages'] == 2 and d.all('select id, page from submission_file order by page') == [[s['files'][2]['file_id'], 1], [s['files'][0]['file_id'], 2]], r)
            ok('the page left out is deleted and its two files are queued', queued(d, 'page_removed') == sorted([s['files'][1]['path'], s['files'][1]['thumb_path']]))
            e = refused(d, lambda: d.send_finish(tok, ENR1, d.send_start(tok2, ENR2, a)['submission_id'], [s['files'][0]]))
            ok("a finish naming another student's submission is not_found", err(d.send_finish(tok, ENR1, d.one("select id from submission where enrollment_id = :e", e=ENR2), [s['files'][0]])) == 'not_found')
            s2 = d.one("select id from submission where enrollment_id = :e", e=ENR2)
            e = refused(d, lambda: d.send_finish(tok2, ENR2, s2, [s['files'][0]]))
            ok("a finish naming a page of another student's submission fails (22023)", e is not None and e[1] == '22023', e)

        # ── Starting again; an expired send ─────────────────────────────
        with tx(d):
            s1 = d.send_start(tok, ENR1, a, pages=2)
            d.upload(s1['files'][:1])
            s2 = d.send_start(tok, ENR1, a, pages=1)
            ok('a new send started while one is unfinished: the first is dropped, and its four file paths are queued as abandoned (one was uploaded, one never was)',
               s2['ok'] and s2['submission_id'] != s1['submission_id'] and d.one('select count(*) from submission') == 1
               and queued(d, 'abandoned') == sorted(p for f in s1['files'] for p in (f['path'], f['thumb_path'])), queued(d))
            ok('finishing the dropped one: not_found', err(d.send_finish(tok, ENR1, s1['submission_id'], s1['files'])) == 'not_found')
            d.run("update submission set created_at = now() - interval '2 hours 1 minute' where id = :s", s=s2['submission_id'])
            d.upload(s2['files'])
            ok('a send whose upload links have stopped working cannot be finished: expired', err(d.send_finish(tok, ENR1, s2['submission_id'], s2['files'])) == 'expired')
            ok('unsend drops a send that is not finished, whatever else', d.unsend(tok, ENR1, a) == {'ok': True, 'unsent': False, 'cancelled': True, 'pages': 0}
               and d.one('select count(*) from submission') == 0)

        # ── The switches change between start and finish ────────────────
        with tx(d):
            s = d.send_start(tok, ENR1, a); d.upload(s['files'])
            d.run("update assessment set due_date = :d::date - 1, after_due = 'stop' where id = :a", d=k['today'], a=a)
            ok('a send started while the piece was open is taken though it closed before the pages were up (open and late are settled when it starts)',
               d.send_finish(tok, ENR1, s['submission_id'], s['files'])['ok'] is True)
        with tx(d):
            s = d.send_start(tok, ENR1, a); d.upload(s['files'])
            d.run("update assessment set students_send = 'nothing' where id = :a", a=a)
            ok('the teacher set the piece to take nothing meanwhile: not_taking_work', err(d.send_finish(tok, ENR1, s['submission_id'], s['files'])) == 'not_taking_work')
            d.run("update assessment set students_send = 'photos' where id = :a", a=a); d.run('update course set send_work = false')
            ok('Send Work was turned off meanwhile: send_off', err(d.send_finish(tok, ENR1, s['submission_id'], s['files'])) == 'send_off')

        # ── Replace ─────────────────────────────────────────────────────
        with tx(d):
            ok('replace with nothing sent: nothing_sent', err(d.send_start(tok, ENR1, a, replace=True)) == 'nothing_sent')
            s, f = d.send(tok, ENR1, a, 2, note='first try')
            old = live_paths(d)
            d.run("update assessment set due_date = :d::date - 1 where id = :a", d=k['today'], a=a)
            r = d.send_start(tok, ENR1, a, pages=1, note='second try', replace=True)
            ok('replace hands out paths for the new pages; what was sent is still sent and still whole',
               r['ok'] and r['state'] == 'sending' and len(r['files']) == 1 and d.work(tok, ENR1)['assessments'][0]['sent']['submission_id'] == s['submission_id']
               and d.work(tok, ENR1)['assessments'][0]['sending']['intent'] == 'replace' and queued(d) == [], r)
            ok('the teacher still sees the first, whole', [x['id'] for x in d.rpc('list_course_submissions(:c)', c=COURSE_A)['submissions']] == [s['submission_id']])
            r2 = d.send_finish(tok, ENR1, r['submission_id'], r['files'])
            ok('finishing before the new page is up: missing_pages, and the first is still there', err(r2) == 'missing_pages' and d.one("select count(*) from submission where state = 'sent' and id = :s", s=s['submission_id']) == 1)
            d.upload(r['files'])
            r2 = d.send_finish(tok, ENR1, r['submission_id'], r['files'])
            row = d.all('select id, state, intent, target_id, version, note, is_late from submission')
            ok('finishing with it up: the new submission takes the place of the old in one step',
               r2['ok'] and r2['pages'] == 1 and row == [[r['submission_id'], 'sent', 'new', None, 1, 'second try', True]], row)
            ok('the replacement was started after the due date, so it is marked late', r2['late'] is True)
            ok("the old pages' four files are queued for deletion as replaced; the new page's are not", queued(d, 'replace') == old and len(queued(d)) == 4 and sound(d) == '', (queued(d), sound(d)))
            ok('file_links gives the new page only', [f['file_id'] for f in d.file_links(tok, ENR1, a)['files']] == [r['files'][0]['file_id']])
        with tx(d):
            d.teacher_upload(a, ENR1, 1)
            ok("work the teacher added cannot be replaced by the student: cannot_change", err(d.send_start(tok, ENR1, a, replace=True)) == 'cannot_change')
            ok('nor unsent: cannot_change, and it is still there', err(d.unsend(tok, ENR1, a)) == 'cannot_change' and d.one('select count(*) from submission') == 1)
            w = d.work(tok, ENR1)['assessments'][0]
            ok('work shows it as sent by the teacher, with no change offered; the student can still be given links to its pages',
               (w['sent']['sent_by'], w['sent']['can_change']) == ('teacher', False) and len(d.file_links(tok, ENR1, a)['files']) == 1, w)
            d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['nothing'], e=[ENR1], k=nid())
            w = d.work(tok, ENR1)['assessments']
            ok('a piece handed in on paper shows on the page though the assessment takes nothing: sent, on paper, no pages, no change offered',
               [(x['id'], x['open'], x['sent']['on_paper'], x['sent']['pages'], x['sent']['can_change']) for x in w if x['id'] == k['nothing']] == [(k['nothing'], False, True, 0, False)], w)
            ok('unsend on it: cannot_change', err(d.unsend(tok, ENR1, k['nothing'])) == 'cannot_change')
        with tx(d):
            s, f = d.send(tok, ENR1, a)
            d.run("update assessment set due_date = :d::date - 1, after_due = 'stop' where id = :a", d=k['today'], a=a)
            ok('once the piece has closed, Unsend is refused (it could not be sent again): work_closed', err(d.unsend(tok, ENR1, a)) == 'work_closed' and d.one('select count(*) from submission') == 1)
            ok('and Replace: work_closed', err(d.send_start(tok, ENR1, a, replace=True)) == 'work_closed')
            ok('work offers no change', d.work(tok, ENR1)['assessments'][0]['sent']['can_change'] is False)
            d.run("update assessment set after_due = 'keep' where id = :a", a=a); d.run('update course set send_work = false')
            ok('with Send Work off, Unsend is refused: send_off', err(d.unsend(tok, ENR1, a)) == 'send_off')

        # ── Grading ─────────────────────────────────────────────────────
        for mode, on_return in (('When I Return Them', True), ('As Soon As I Save', False)):
            with tx(d):
                d.run("update course set return_grades = :r where id = :c", r='on_return' if on_return else 'on_save', c=COURSE_A)
                s, f = d.send(tok, ENR1, a)
                d.rpc('upsert_score(:e, :a, 7)', e=ENR1, a=a)
                state = d.all('select is_draft, returned_at is not null from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)
                ok('%s: the teacher saves a score, which is %s' % (mode, 'a draft' if on_return else 'returned at once'), state == [[on_return, not on_return]], state)
                ok('%s: Unsend is now refused: grading_started; the work and its files stay' % mode,
                   err(d.unsend(tok, ENR1, a)) == 'grading_started' and d.one('select count(*) from submission') == 1 and queued(d) == [])
                ok('%s: Replace is refused: grading_started' % mode, err(d.send_start(tok, ENR1, a, replace=True)) == 'grading_started')
                w = d.work(tok, ENR1)['assessments'][0]['sent']
                ok('%s: work says it is being graded and offers no change' % mode, (w['grading'], w['can_change']) == (True, False), w)
                g1 = score_fingerprint(d)
                d.unsend(tok, ENR1, a); d.send_start(tok, ENR1, a, replace=True); d.work(tok, ENR1); d.file_links(tok, ENR1, a)
                ok('%s: none of those calls changed the grade or its Draft or Returned state' % mode, score_fingerprint(d) == g1)
                d.rpc('clear_score(:e, :a)', e=ENR1, a=a)
                gone = d.all('select is_draft, returned_at is not null from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a)
                ok('%s: the teacher clears the score: no draft and nothing returned, so the student can change the work again' % mode,
                   gone in ([[False, False]], []) and d.work(tok, ENR1)['assessments'][0]['sent']['can_change'] is True and d.unsend(tok, ENR1, a)['unsent'] is True, gone)
        with tx(d):
            s, f = d.send(tok, ENR1, a)
            d.rpc("set_score_status(:e, :a, 'LATE')", e=ENR1, a=a)
            ok('a Late mark alone is not grading: the student can still unsend', d.work(tok, ENR1)['assessments'][0]['sent']['grading'] is False and d.unsend(tok, ENR1, a)['unsent'] is True)
            s, f = d.send(tok, ENR1, a)
            d.rpc("save_score_comment(:e, :a, 'Good start.')", e=ENR1, a=a)
            ok('an Overall Comment alone is grading: Unsend is refused', err(d.unsend(tok, ENR1, a)) == 'grading_started')
        with tx(d):
            d.rpc('upsert_score(:e, :a, 7)', e=ENR2, a=a)
            w0 = d.work(tok2, ENR2)
            ok('a draft on a piece the student has not sent shows nowhere in work: the assessment reads exactly as one never graded',
               w0['assessments'] == [{'id': a, 'students_send': 'photos', 'open': True, 'closes_on': None, 'late_now': False, 'sent': None, 'sending': None}], w0)
            s, f = d.send(tok2, ENR2, a)
            ok('work can still be sent for a piece the teacher has begun grading; once sent it reads as being graded',
               f['ok'] is True and d.work(tok2, ENR2)['assessments'][0]['sent']['grading'] is True and err(d.unsend(tok2, ENR2, a)) == 'grading_started')
        with tx(d):
            # Replace started, then grading starts, then the new pages are finished.
            s, f = d.send(tok, ENR1, a, 2); old = live_paths(d)
            r = d.send_start(tok, ENR1, a, pages=1, replace=True); d.upload(r['files'])
            d.rpc('upsert_score(:e, :a, 7)', e=ENR1, a=a)
            r2 = d.send_finish(tok, ENR1, r['submission_id'], r['files'])
            ok('Replace during grading: the new pages are refused (grading_started); what the teacher is grading stays, whole',
               err(r2) == 'grading_started' and d.all("select id, state from submission") == [[s['submission_id'], 'sent']] and live_paths(d) == old, r2)
            ok("the new page's two files are queued as abandoned, and none of the old ones", queued(d) == sorted([r['files'][0]['path'], r['files'][0]['thumb_path']]) and sound(d) == '', queued(d))
        with tx(d):
            d.run("update assessment set score_mode = 'dibels', max_points = null where id = :a", a=a)
            d.run("insert into grade_return (enrollment_id, assessment_id, is_draft) values (:e, :a, true)", e=ENR1, a=a)
            s, f = d.send(tok, ENR1, a)
            ok('a DIBELS piece has no Draft and no Returned: a row left from before it was DIBELS does not count as grading', d.work(tok, ENR1)['assessments'][0]['sent']['grading'] is False)

        # ── The teacher adds work while a student's send is unfinished ──
        with tx(d):
            s = d.send_start(tok, ENR1, a); d.upload(s['files'])
            t, done = d.teacher_upload(a, ENR1, 1)
            r = d.send_finish(tok, ENR1, s['submission_id'], s['files'])
            ok("the teacher added the student's work while their pages were going up: the student's finish answers already_sent and its pages are dropped",
               done['result'] == 'sent' and err(r) == 'already_sent' and d.all('select id from submission') == [[t['submission_id']]]
               and queued(d, 'abandoned') == sorted([s['files'][0]['path'], s['files'][0]['thumb_path']]) and sound(d) == '', (r, queued(d)))

        # ── Twenty sends an hour for one card ───────────────────────────
        with tx(d):
            got = [d.send_start(tok, ENR1, a) for _ in range(20)]
            ok('twenty send_starts in an hour are all given links', all(x.get('ok') for x in got) and d.one('select count(*) from student_submit.send_log') == 20)
            r = d.send_start(tok, ENR1, a)
            ok('the twenty-first: too_many, with how long to wait; nothing made', err(r) == 'too_many' and 0 < r['retry_after_s'] <= 3600 and d.one('select count(*) from submission') == 1, r)
            ok('replace counts the same: too_many', (lambda: (d.upload(got[-1]['files']), d.send_finish(tok, ENR1, got[-1]['submission_id'], got[-1]['files']),
                                                               err(d.send_start(tok, ENR1, a, replace=True)))[-1])() == 'too_many')
            ok('unsending does not give a send back', d.unsend(tok, ENR1, a)['unsent'] is True and err(d.send_start(tok, ENR1, a)) == 'too_many')
            ok("another student's card is not held back by it", d.send_start(tok2, ENR2, a)['ok'] is True)
            ok('a refusal is not counted (twenty-one rows: twenty for Cece, one for Marcus)', d.one('select count(*) from student_submit.send_log') == 21)
            d.run("update student_submit.send_log set at = at - interval '61 minutes' where id = (select min(id) from student_submit.send_log)")
            ok('once the oldest is over an hour old, one more is given', d.send_start(tok, ENR1, a)['ok'] is True and err(d.send_start(tok, ENR1, a)) == 'too_many')
            d.run("update student_submit.send_log set at = at - interval '2 days'")
            d.send_start(tok, ENR1, a)
            ok('rows older than a day are cleared by the next call', d.one('select count(*) from student_submit.send_log') == 1)
            # a new card for the same student starts its own count; the old one's session is dead anyway
            tok_new, _ = d.session(ENR1)
            ok('the limit is per card: a new card starts at none', d.send_start(tok_new, ENR1, a)['ok'] is True)

        # ── Two classes in one session (Switching Classes) ──────────────
        with tx(d):
            other = nid(); oe = nid(); oa = nid()
            d.run("insert into course (id, teacher_id, name, student_page_enabled, return_grades, send_work) values (:c, :t, 'Socials 8', true, 'on_return', true)", c=other, t=A)
            d.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=oe, s=STU1, c=other)
            d.run("insert into assessment (id, course_id, title, score_mode, max_points, students_send) values (:a, :c, 'Map', 'points', 5, 'photos')", a=oa, c=other)
            tok_two, _ = d.session(oe, token=tok, add=True, course=other)
            ok('one session, two classes: each class sends to its own assessments',
               d.send_start(tok_two, oe, oa)['ok'] is True and d.send_start(tok_two, ENR1, a)['ok'] is True)
            ok("and never across them: this class's enrollment with the other class's assessment is not_found, either way",
               err(d.send_start(tok_two, ENR1, oa)) == 'not_found' and err(d.send_start(tok_two, oe, a)) == 'not_found')

        # ── No student function reads or writes a grade ─────────────────
        src = {r[0]: r[1] for r in d.all("select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'")}
        new_fns = sorted(s.split('.')[1].split('(')[0] for s in B_FUNCTIONS if s.startswith('student_submit.'))
        code_only = lambda s: re.sub(r'--[^\n]*', '', s)
        GRADES = re.compile(r'\b(score|tag_score|rubric_score|rubric_check_score|returned_copy|previous_copy|working_copy|_grade_copy\w*|_returned_grade|score_audit|dibels_score)\b')
        ok('the twelve functions this file adds to student_submit name no score table, no copy of a grade and not the one reader of grades',
           len(new_fns) == 12 and not [n for n in new_fns if GRADES.search(code_only(src[n]))], [n for n in new_fns if GRADES.search(code_only(src[n]))])
        ok('exactly one of them names grade_return, and it reads its two state columns only',
           [n for n in new_fns if 'grade_return' in code_only(src[n]).replace('_grade_return_lock', '')] == ['_grading_started']
           and re.findall(r'\bg\.(\w+)', code_only(src['_grading_started'])) == ['is_draft', 'returned_at', 'enrollment_id', 'assessment_id'], src['_grading_started'])
        ok('none of them writes to any table but the submissions and the send count (no insert, update or delete names another)',
           all(set(re.findall(r'(?:insert\s+into|(?<!for )update|delete\s+from)\s+([a-z_.]+)', code_only(src[n]))) <= {'submission', 'send_log', 'submission_file_removal'} for n in new_fns),
           {n: set(re.findall(r'(?:insert\s+into|(?<!for )update|delete\s+from)\s+([a-z_.]+)', code_only(src[n]))) for n in new_fns})
        pub = {r[0]: r[1] for r in d.all("""select p.oid::regprocedure::text, p.prosrc from pg_proc p where p.oid = any(:f::regprocedure[])""",
                                         f=[s for s in B_FUNCTIONS if not s.startswith('student_submit.')])}
        ok("nor do the teacher's functions and the helpers (27 of them) name a score table or a copy of a grade", len(pub) == 27 and not [n for n, s in pub.items() if GRADES.search(code_only(s)) or 'grade_return ' in code_only(s)],
           [n for n, s in pub.items() if GRADES.search(code_only(s))])
        ok("student_submit still has one reader of grades: of every function in the schema only _returned_grade names a score table or a stored copy",
           sorted(n for n, s in src.items() if re.search(r'\b(score|tag_score|rubric_score|rubric_check_score|returned_copy|previous_copy|_grade_copy)\b', code_only(s))) == ['_returned_grade'])
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_storage():
    d, k = applied('storage')
    try:
        a = k['takes']; st = d.storage
        tok, _ = d.session(ENR1); tokb, _ = d.session(ENR_B, birthday='2012-07-17', course=COURSE_B, teacher=B)
        ok('the bucket: private, 2 MB a file, JPEG only',
           d.all("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'student-photos'") == [[False, 2097152, ['image/jpeg']]])
        ok('one bucket, and four policies on storage.objects, two that allow and two that restrict',
           d.one('select count(*) from storage.buckets') == 1
           and d.all("select polname, polcmd, polpermissive, polroles::regrole[]::text from pg_policy where polrelid = 'storage.objects'::regclass order by 1")
           == [['fv_student_photos_fence', '*', False, '{authenticated}'], ['fv_student_photos_read', 'r', True, '{authenticated}'],
               ['fv_student_photos_teachers_only', '*', False, '{-}'], ['fv_student_photos_upload', 'a', True, '{authenticated}']])

        # ── A student's upload link (the Storage API's part, as modelled) ──
        with tx(d):
            s = d.send_start(tok, ENR1, a, pages=1); f = s['files'][0]
            link = st.sign_upload(f['path'])
            for label, kw, status in (('another path', dict(path=f['thumb_path']), 400), ("another student's folder", dict(path=f['path'].replace(ENR1, ENR2)), 400),
                                      ('a file over 2 MB', dict(size=2097153), 413), ('a PNG', dict(mime='image/png'), 415), ('a PDF', dict(mime='application/pdf'), 415),
                                      ('after its two hours', dict(at=link['exp'] + datetime.timedelta(seconds=1)), 400)):
                try: st.put_signed(link, **kw); got = 'taken'
                except StorageError as e: got = e.status
                ok('a link used for %s is refused (%d), and nothing is stored' % (label, status), got == status and st.names() == [], got)
            st.put_signed(link, size=2097152)
            ok('a JPEG of exactly 2 MB through its own link is stored, at the one path the database named', st.names() == [f['path']])
            try: st.put_signed(link); got = 'taken'
            except StorageError as e: got = e.status
            ok('the same link a second time is refused (409): a link writes one file once', got == 409 and st.names() == [f['path']], got)
            st.put_signed(st.sign_upload(f['thumb_path']), size=20000)
            ok('a download link is only made for a file that is there', st.sign_download(f['path'])['path'] == f['path'])
            try: st.sign_download(f['path'].replace('.jpg', '-other.jpg')); got = 'made'
            except StorageError as e: got = e.status
            ok('and not for one that is not (404)', got == 404, got)

        # ── What a signed-in teacher's browser can do, by the policies ──
        with tx(d):
            sa, _ = d.send(tok, ENR1, a, 1); sb, _ = d.send(tokb, ENR_B, k['b_takes'], 1)
            pa = sa['files'][0]['path']; pb = sb['files'][0]['path']
            ok("Teacher A reads their own class's file and not Teacher B's", st.can_read('authenticated', A, pa) and not st.can_read('authenticated', A, pb))
            ok("Teacher B reads their own class's file and not Teacher A's", st.can_read('authenticated', B, pb) and not st.can_read('authenticated', B, pa))
            ok("listing the bucket shows each teacher only their own classes' files (two each: a page and its thumbnail)",
               st.visible('authenticated', A) == sorted([pa, sa['files'][0]['thumb_path']]) and st.visible('authenticated', B) == sorted([pb, sb['files'][0]['thumb_path']]))
            ok('nobody signed in (the anonymous key) sees nothing', st.visible('anon', None) == [])
            ok('a signed-in session with no teacher id sees nothing', st.visible('authenticated', None) == [])
            ok("the service role, as this harness makes it (subject to row security), sees none of the bucket: the policies let in signed-in teachers and nobody else",
               st.visible('service_role', None) == [])
            d.run('alter role service_role bypassrls')   # undone with this block
            ok('the service role as Supabase makes it (it passes row security) sees every file: it is the key the edge functions hold', len(st.visible('service_role', None)) == 4)
            ok("a teacher of a deleted class reads none of its files", (lambda: (d.run("update course set deleted_at = now() where id = :c", c=COURSE_A), st.visible('authenticated', A))[-1])() == [])
        with tx(d):
            folder = '%s/%s/%s/%s' % (COURSE_A, a, ENR1, nid())
            def put(role, uid, path):
                try: st.put_as(role, uid, path); return 'stored'
                except StorageError as e: return e.status
            ok("a teacher cannot put a file of their choosing into their own class's folder (403): only a path the database named", put('authenticated', A, folder + '/' + nid() + '.jpg') == 403)
            s = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='new', k=nid()); f = s['files'][0]
            ok("Teacher B cannot write the path Teacher A's upload was given (403)", put('authenticated', B, f['path']) == 403)
            ok('nobody signed in cannot (403)', put('anon', None, f['path']) == 403)
            ok('a path that differs by one character is refused (403)', put('authenticated', A, f['path'][:-5] + ('0' if f['path'][-5] != '0' else '1') + '.jpg') == 403)
            ok('Teacher A can write it, and its thumbnail', put('authenticated', A, f['path']) == 'stored' and put('authenticated', A, f['thumb_path']) == 'stored')
            ok('a second file at the same path is refused (409)', put('authenticated', A, f['path']) == 409)
            st2 = d.send_start(tok, ENR1, a, pages=1)
            ok("a teacher cannot write a path that was named for a student's send (403): that goes through the student's link", put('authenticated', A, st2['files'][0]['path']) == 403)
            d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps([{'file_id': f['file_id'], 'sha256': HASH}]), k=nid())
            st.remove([f['path']])
            ok('once the upload is finished its paths are closed: a file removed afterwards cannot be put back by the teacher (403)', put('authenticated', A, f['path']) == 403)
            st.put_signed(st.sign_upload(f['path']))   # put it back, as the service
            # change, move, delete
            d.run("select set_config('storage.allow_delete_query', 'true', true)")   # so that only row security is being tested
            ok("a teacher's browser cannot delete a file: the delete reaches no row", st.change_as('authenticated', A, "delete from storage.objects where bucket_id = 'student-photos'") == 0 and len(st.names()) == 2)
            ok('nor change one (its record, its name, its bucket): the update reaches no row',
               st.change_as('authenticated', A, "update storage.objects set metadata = '{}'::jsonb where bucket_id = 'student-photos'") == 0
               and st.change_as('authenticated', A, "update storage.objects set name = name || 'x' where bucket_id = 'student-photos'") == 0)
            ok('nor can nobody', st.change_as('anon', None, "delete from storage.objects where bucket_id = 'student-photos'") == 0
               and st.change_as('anon', None, "update storage.objects set metadata = '{}'::jsonb") == 0)
            d.run("select set_config('storage.allow_delete_query', 'false', true)")
            for role, uid in (('authenticated', A), ('anon', None)):
                ok('%s cannot read or change the bucket\'s own settings through row security' % role,
                   d.role(role, 'select count(*) from storage.buckets', uid=uid)[0][0] == 0
                   and st.change_as(role, uid, "update storage.buckets set public = true where id = 'student-photos'") == 0)
            ok('the bucket is still private', d.one("select public from storage.buckets where id = 'student-photos'") is False)

        # ── One careless policy added later does not open the bucket ────
        with tx(d):
            sa, _ = d.send(tok, ENR1, a, 1); pa = sa['files'][0]['path']
            d.run("insert into storage.buckets (id, name, public) values ('handouts', 'handouts', false)")
            d.run("insert into storage.objects (bucket_id, name) values ('handouts', 'week1.pdf')")
            d.run('create policy anyone_does_anything on storage.objects for all to public using (true) with check (true)')
            ok('with a policy that lets every role do everything to storage.objects: the other bucket is wide open, as that policy says',
               st.visible('anon', None, bucket='handouts') == ['week1.pdf'] and st.visible('authenticated', B, bucket='handouts') == ['week1.pdf'])
            ok('and the anonymous role is not asked to run any function of ours to get there (it can run none)', st.can_read('anon', None, 'week1.pdf', bucket='handouts'))
            ok("but student-photos stays shut: nobody signed in sees nothing, and Teacher B sees none of Teacher A's files",
               st.visible('anon', None) == [] and st.visible('authenticated', B) == [] and len(st.visible('authenticated', A)) == 2)
            try: st.put_as('authenticated', A, '%s/%s/%s/%s/%s.jpg' % (COURSE_A, a, ENR1, nid(), nid())); got = 'stored'
            except StorageError as e: got = e.status
            ok('a teacher still cannot put a file of their choosing there (403)', got == 403, got)
            try: st.put_as('anon', None, pa.replace('.jpg', 'x.jpg')); got = 'stored'
            except StorageError as e: got = e.status
            ok('nor can nobody (403)', got == 403, got)
            d.run("select set_config('storage.allow_delete_query', 'true', true)")
            ok('a delete or an update by Teacher B or by nobody reaches no file of the bucket',
               st.change_as('authenticated', B, "delete from storage.objects where bucket_id = 'student-photos'") == 0
               and st.change_as('anon', None, "delete from storage.objects where bucket_id = 'student-photos'") == 0
               and st.change_as('anon', None, "update storage.objects set name = name || 'x' where bucket_id = 'student-photos'") == 0)
            ok("nor can a file be moved into the bucket from the open one", st.change_as('authenticated', B, "update storage.objects set bucket_id = 'student-photos' where bucket_id = 'handouts'") in ('42501', 0)
               and st.change_as('anon', None, "update storage.objects set bucket_id = 'student-photos' where bucket_id = 'handouts'") in ('42501', 0)
               and len(st.names()) == 2)
            got = st.change_as('authenticated', A, "delete from storage.objects where bucket_id = 'student-photos'")
            ok("(that careless policy does let the class's own teacher delete their class's files: a restrictive policy narrows what others allow, it cannot stop the owner being allowed)", got == 2, got)
            d.run("select set_config('storage.allow_delete_query', 'false', true)")

        # ── SQL cannot delete a file ────────────────────────────────────
        with tx(d):
            sa, _ = d.send(tok, ENR1, a, 1)
            e = refused(d, lambda: d.run("delete from storage.objects where bucket_id = 'student-photos'"))
            ok("a DELETE on storage.objects from SQL is refused by storage's own trigger (42501), even for the database owner", e is not None and e[1] == '42501' and 'Storage API' in e[0], e)
            e = refused(d, lambda: d.run("delete from storage.buckets where id = 'student-photos'"))
            ok('and on storage.buckets', e is not None and e[1] == '42501', e)
            d.unsend(tok, ENR1, a)
            ok("so Unsend deletes rows and queues files, and no function here ever issues that DELETE (it would have failed)", len(st.names()) == 2 and len(queued(d)) == 2)
            body = '\n'.join(bare(x) for x in S1 + S2).lower()
            ok('neither file names storage.allow_delete_query or deletes from a storage table', 'allow_delete_query' not in body and not re.search(r'delete\s+from\s+storage\.', body))

        # ── The removal queue ───────────────────────────────────────────
        with tx(d):
            sa, _ = d.send(tok, ENR1, a, 2); paths = live_paths(d)
            d.unsend(tok, ENR1, a)
            b = d.service('student_submit.removal_batch(2)')
            ok('removal_batch(2) offers two of the four and says two are left', len(b['items']) == 2 and b['left'] == 2 and all(i['bucket'] == 'student-photos' for i in b['items']), b)
            r = d.service('student_submit.removal_done(:ids)', ids=[i['id'] for i in b['items']])
            ok('removal_done is not believed while storage still holds the files: none gone, both still there',
               r == {'ok': True, 'gone': 0, 'still_there': [i['id'] for i in b['items']]}, r)
            st.remove([b['items'][0]['path']])
            r = d.service('student_submit.removal_done(:ids)', ids=[i['id'] for i in b['items']])
            ok('with one really removed: one gone, one still there', r == {'ok': True, 'gone': 1, 'still_there': [b['items'][1]['id']]}, r)
            ok('a file removed while its upload link is still alive is gone but not finished with',
               d.all('select removed_at is not null, done from submission_file_removal where id = :i', i=b['items'][0]['id']) == [[True, False]])
            b2 = d.service('student_submit.removal_batch(100)')
            ok('the next batch offers the three not yet removed, and not the one that is gone (its link is still alive)',
               sorted(i['path'] for i in b2['items']) == sorted(set(paths) - {b['items'][0]['path']}) and b2['left'] == 0, b2)
            st.remove([i['path'] for i in b2['items']]); d.service('student_submit.removal_done(:ids)', ids=[i['id'] for i in b2['items']])
            ok('all four files are out of storage; none is finished with until its link has died', st.names() == [] and d.one('select count(*) from submission_file_removal where done') == 0
               and d.service('student_submit.removal_batch(100)')['items'] == [])
            # the link is used again after the removal: the file comes back
            st.put_signed(st.sign_upload(paths[0]))
            ok('whoever still holds the upload link puts the file back: storage has it again, with no row pointing at it', st.names() == [paths[0]] and live_paths(d) == [])
            d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute'")
            b3 = d.service('student_submit.removal_batch(100)')
            ok('once the links have died every path is offered one last time', len(b3['items']) == 4, b3)
            st.remove([i['path'] for i in b3['items']])
            r = d.service('student_submit.removal_done(:ids)', ids=[i['id'] for i in b3['items']])
            ok('the file that came back is removed again, and now all four are finished with: nothing is left behind',
               r['gone'] == 4 and st.names() == [] and d.one('select count(*) from submission_file_removal where not done') == 0
               and d.service('student_submit.removal_batch(100)') == {'ok': True, 'items': [], 'left': 0}, r)
            ok('the queue keeps what was deleted, when and why', d.all('select reason, count(*), bool_and(removed_at is not null) from submission_file_removal group by 1') == [['unsend', 4, True]])
        with tx(d):
            # newest first for what was never tried
            d.send(tok, ENR1, a, 1); d.unsend(tok, ENR1, a)
            d.run("update submission_file_removal set queued_at = now() - interval '3 days', tries = 4, last_try_at = now() - interval '1 hour'")
            s2, _ = d.send(tok, ENR1, a, 1); d.unsend(tok, ENR1, a)
            b = d.service('student_submit.removal_batch(2)')
            ok('files queued a moment ago (someone just pressed Unsend) are offered before ones that have failed for days',
               sorted(i['path'] for i in b['items']) == sorted([s2['files'][0]['path'], s2['files'][0]['thumb_path']]), b)
            ok('each offer is counted', d.all('select tries from submission_file_removal order by id') == [[4], [4], [1], [1]])
            e = refused(d, lambda: d.role('authenticated', 'select student_submit.removal_batch(10)', uid=A))
            ok('a signed-in teacher cannot run the worker\'s functions', e is not None and 'permission denied' in e[0], e)

        # ── Every way a row can go queues its files ─────────────────────
        with tx(d):
            sa, _ = d.send(tok, ENR1, a, 2); d.teacher_upload(a, ENR2, 1); paths = live_paths(d)
            d.rpc('delete_assessment(:a)', a=a)
            ok('the teacher deletes the assessment: its submissions go with it, and all six files are queued',
               d.one('select count(*) from submission') == 0 and queued(d) == paths and len(paths) == 6 and d.one("select count(*) from submission_file_removal where reason = 'row_deleted'") == 6, queued(d))
            ok('queued with their class', d.all('select distinct course_id from submission_file_removal') == [[COURSE_A]])
        with tx(d):
            d.send(tok, ENR1, a, 1); d.teacher_upload(a, ENR2, 1); d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['nothing'], e=[ENR1], k=nid())
            mine = sorted(p for r in d.all('select f.path, f.thumb_path from submission_file f join submission s on s.id = f.submission_id where s.enrollment_id = :e', e=ENR1) for p in r)
            d.rpc('withdraw_student(:e, :k)', e=ENR1, k=nid())
            ok('withdrawing a student keeps their work and its files', d.one('select count(*) from submission where enrollment_id = :e', e=ENR1) == 2 and queued(d) == [])
            d.rpc('delete_withdrawn_student(:e, :k)', e=ENR1, k=nid())
            ok("permanently deleting the withdrawn student: their submissions go, their two files are queued, and the other student's are untouched",
               d.one('select count(*) from submission where enrollment_id = :e', e=ENR1) == 0 and queued(d) == mine and d.one('select count(*) from submission') == 1 and sound(d) == '', (queued(d), sound(d)))
        with tx(d):
            d.send(tok, ENR1, a, 1); sb, _ = d.send(tokb, ENR_B, k['b_takes'], 1); paths = sorted(p for p in live_paths(d) if p.startswith(COURSE_A))
            d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=COURSE_A)
            d.run('select public.fv_retention_cleanup()')
            ok("the 30-day purge of a deleted class: the class and its submissions are gone, its files are queued with the class's id, and the other class is untouched",
               d.one('select count(*) from course where id = :c', c=COURSE_A) == 0 and d.one('select count(*) from submission where course_id = :c', c=COURSE_A) == 0
               and queued(d) == paths and d.all('select distinct course_id from submission_file_removal') == [[COURSE_A]]
               and d.one('select count(*) from submission where course_id = :c', c=COURSE_B) == 1, queued(d))
            b, done = d.drain()
            ok('the worker then removes them though the class no longer exists', done['gone'] == 2 and [n for n in d.storage.names() if n.startswith(COURSE_A)] == [])
        with tx(d):
            d.send(tok, ENR1, a, 1); paths = live_paths(d)
            d.run('delete from submission_file')
            ok('a page row deleted by hand, with no function: its files are still queued (the queue is fed by a trigger, not by each function)', queued(d, 'row_deleted') == paths)
        with tx(d):
            d.send(tok, ENR1, a, 1); paths = live_paths(d)
            d.run('truncate public.assessment cascade')
            ok('TRUNCATE of assessment fires no row trigger: the submissions left without an assessment are removed and their files queued',
               d.one('select count(*) from submission') == 0 and queued(d) == paths, queued(d))

        # ── Nothing is deleted that should stay ─────────────────────────
        with tx(d):
            keep, _ = d.send(tok, ENR1, a, 2)
            d.teacher_upload(a, ENR2, 2); t2, _ = d.teacher_upload(a, ENR2, 1, mode='replace'); d.teacher_upload(a, ENR2, 1, mode='add')
            sb, _ = d.send(tokb, ENR_B, k['b_takes'], 1); d.unsend(tokb, ENR_B, k['b_takes'])
            stay = live_paths(d)
            while d.drain()[0]['items']: pass
            d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute'")
            while d.drain()[0]['items']: pass
            ok('after a replace, an add, an unsend and the worker run to the end: storage holds exactly the files of the pages that are handed in, no more and no fewer',
               d.storage.names() == stay and len(stay) == 8 and sound(d) == '' and d.one('select count(*) from submission_file_removal where not done') == 0, (len(d.storage.names()), len(stay), sound(d)))
            e = refused(d, lambda: d.run("insert into submission_file (id, submission_id, page, path, thumb_path) values (:i, :s, 9, :p, :t)",
                                         i=nid(), s=keep['submission_id'], p=keep['files'][0]['path'].replace(keep['files'][0]['file_id'], nid()), t='x'))
            ok("a page row cannot be given a file name that is not its own id (so it can never be given a queued file's name)", e is not None and 'submission_file_path_is_own' in e[0], e)
            e = refused(d, lambda: d.run("insert into submission_file (submission_id, page, path, thumb_path) select submission_id, 9, path, thumb_path from submission_file limit 1"))
            ok('nor the path of another page', e is not None and e[1] in ('23505', '23514'), e)
            # a queued path that a page holds (cannot happen; if it did) is never said to be gone
            d.run("insert into submission_file_removal (bucket, path, reason, link_dies_at) values ('student-photos', :p, 'test', now())", p=stay[0])
            b = d.service('student_submit.removal_batch(10)'); st.remove([])
            r = d.service('student_submit.removal_done(:ids)', ids=[i['id'] for i in b['items']])
            ok('and a queue row that names a live page\'s file is never marked gone', r['gone'] == 0 and r['still_there'] == [i['id'] for i in b['items']], r)

        # ── Storage's newer shape: several versions of one name ─────────
        with tx(d):
            d.run('alter table storage.objects add column archived_at timestamptz, add column is_delete_marker boolean not null default false')
            d.run('drop index storage.bucketid_objname')
            s = d.send_start(tok, ENR1, a, pages=1); f = s['files'][0]
            d.run("insert into storage.objects (bucket_id, name, metadata, archived_at) values ('student-photos', :n, '{\"size\": 5}', now())", n=f['path'])
            d.run("insert into storage.objects (bucket_id, name, metadata, is_delete_marker) values ('student-photos', :n, null, true)", n=f['thumb_path'])
            ok('where storage keeps old versions: an archived version alone, or a delete marker, is not the file being there (missing_pages)',
               err(d.send_finish(tok, ENR1, s['submission_id'], s['files'])) == 'missing_pages')
            d.run("insert into storage.objects (bucket_id, name, metadata) values ('student-photos', :n, '{\"size\": 300000, \"mimetype\": \"image/jpeg\"}')", n=f['path'])
            d.run("delete from storage.objects where is_delete_marker") if False else d.run("update storage.objects set is_delete_marker = false, metadata = '{\"size\": 9000, \"mimetype\": \"image/jpeg\"}' where name = :n", n=f['thumb_path'])
            ok('and the current version is', d.send_finish(tok, ENR1, s['submission_id'], s['files'])['ok'] is True
               and d.all('select bytes, thumb_bytes from submission_file') == [[300000, 9000]])
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_race():
    d, k = applied('race')
    sides = []
    def side():
        x = Side(d); sides.append(x); return x
    def second_waits(first, second):
        """first() runs in an open transaction on its own connection; second() is then started on another.
        Returns (did the second wait, the first's answer, the second's answer), the first committed in between."""
        h = side(); h.begin(); a1 = attempt(lambda: first(h))
        out = {}; o = side()
        t = threading.Thread(target=lambda: out.setdefault('r', attempt(lambda: second(o)))); t.start(); time.sleep(0.6)
        waited = t.is_alive(); h.commit(); t.join(15)
        return waited, a1, out.get('r')
    try:
        a = k['takes']
        tok, _ = d.session(ENR1); tok2, _ = d.session(ENR2, birthday='2012-06-16')
        def clear():
            """Back to an empty class: no work, no files, nothing queued, no grades."""
            for st_ in ('delete from submission', 'delete from student_submit.send_log', 'delete from grade_return', 'delete from score'): d.run(st_)
            d.storage.remove(d.storage.names()); d.run('delete from submission_file_removal')

        # ── Two phones send for the same piece at once ──────────────────
        waited, s1, s2 = second_waits(lambda x: x.send_start(tok, ENR1, a), lambda x: x.send_start(tok, ENR1, a))
        ok("two sends started at once for one piece: the second waits for the first, then takes its place; one unfinished send, the first one's paths queued",
           waited and s1['ok'] and s2['ok'] and d.all("select id from submission where state = 'sending'") == [[s2['submission_id']]]
           and queued(d, 'abandoned') == sorted(p for f in s1['files'] for p in (f['path'], f['thumb_path'])), (waited, s1, s2))
        d.upload(s1['files']); d.upload(s2['files'])
        r1 = d.send_finish(tok, ENR1, s1['submission_id'], s1['files']); r2 = d.send_finish(tok, ENR1, s2['submission_id'], s2['files'])
        ok("the first phone's finish is not_found; the second's hands the work in; one submission", (err(r1), r2['ok']) == ('not_found', True) and d.one('select count(*) from submission') == 1, (r1, r2))
        clear()
        # the same request twice at once
        req = nid()
        waited, s1, s2 = second_waits(lambda x: x.send_start(tok, ENR1, a, request=req), lambda x: x.send_start(tok, ENR1, a, request=req))
        ok("the same request sent twice at once: the second waits and is given the first's answer; one row, counted once",
           waited and s2['replayed'] is True and s2['submission_id'] == s1['submission_id'] and d.one('select count(*) from submission') == 1
           and d.one('select count(*) from student_submit.send_log') == 1, (s1, s2))
        # two finishes of one send at once
        d.upload(s1['files'])
        waited, f1, f2 = second_waits(lambda x: x.send_finish(tok, ENR1, s1['submission_id'], s1['files']), lambda x: x.send_finish(tok, ENR1, s1['submission_id'], s1['files']))
        ok('two finishes of one send at once: the second waits, then is told it is already handed in', waited and f1['ok'] and f1['replayed'] is False and f2['replayed'] is True, (f1, f2))

        # ── Unsend during a send ────────────────────────────────────────
        waited, u, f = second_waits(lambda x: x.unsend(tok, ENR1, a), lambda x: x.send_start(tok, ENR1, a, replace=True))
        ok('Unsend and Replace pressed at once on two phones, Unsend first: Replace waits, then finds nothing sent', waited and u['unsent'] is True and err(f) == 'nothing_sent', (u, f))
        s = d.send_start(tok, ENR1, a); d.upload(s['files'])
        waited, f, u = second_waits(lambda x: x.send_finish(tok, ENR1, s['submission_id'], s['files']), lambda x: x.unsend(tok, ENR1, a))
        ok('Unsend while the send is being finished, the finish first: Unsend waits, then unsends what was just handed in; its files are queued',
           waited and f['ok'] and u == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 1} and d.one('select count(*) from submission') == 0 and sound(d) == '', (f, u))
        s = d.send_start(tok, ENR1, a); d.upload(s['files'])
        waited, u, f = second_waits(lambda x: x.unsend(tok, ENR1, a), lambda x: x.send_finish(tok, ENR1, s['submission_id'], s['files']))
        ok('the other way round, Unsend first: it drops the unfinished send; the finish waits, then is not_found; nothing is handed in',
           waited and u['cancelled'] is True and err(f) == 'not_found' and d.one('select count(*) from submission') == 0 and sound(d) == '', (u, f))
        clear()

        # ── Unsend against a grade being saved ──────────────────────────
        d.send(tok, ENR1, a)
        waited, g, u = second_waits(lambda x: x.rpc('upsert_score(:e, :a, 7)', e=ENR1, a=a), lambda x: x.unsend(tok, ENR1, a))
        ok("the teacher's first score is being saved when the student presses Unsend: Unsend waits for the save, then is refused (grading_started); the work stays",
           waited and err(u) == 'grading_started' and d.one('select count(*) from submission') == 1 and queued(d, 'unsend') == [], (g, u))
        clear()
        d.send(tok, ENR1, a)
        waited, u, g = second_waits(lambda x: x.unsend(tok, ENR1, a), lambda x: x.rpc('upsert_score(:e, :a, 7)', e=ENR1, a=a))
        ok('the other way round, Unsend first: the save waits for it, then goes through as a save always does; the work is unsent and the grade is a draft',
           waited and u['unsent'] is True and not str(g).startswith('ERROR') and d.one('select count(*) from submission') == 0
           and d.one('select is_draft from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=a) is True, (u, g))
        clear()

        # ── Replace during grading ──────────────────────────────────────
        s0, _ = d.send(tok, ENR1, a, 2); old = live_paths(d)
        r = d.send_start(tok, ENR1, a, replace=True); d.upload(r['files'])
        waited, g, f = second_waits(lambda x: x.rpc('upsert_score(:e, :a, 7)', e=ENR1, a=a), lambda x: x.send_finish(tok, ENR1, r['submission_id'], r['files']))
        ok("the new pages of a Replace are finished while the teacher's first score is being saved: the finish waits, then is refused (grading_started)",
           waited and err(f) == 'grading_started', (g, f))
        ok("what the teacher graded is still there, whole, and in storage; only the new page's files are queued",
           d.all("select id, state from submission") == [[s0['submission_id'], 'sent']] and live_paths(d) == old and set(old) <= set(d.storage.names())
           and queued(d, 'abandoned') == sorted([r['files'][0]['path'], r['files'][0]['thumb_path']]) and sound(d) == '', (queued(d), sound(d)))
        clear()
        s0, _ = d.send(tok, ENR1, a, 2)
        r = d.send_start(tok, ENR1, a, replace=True); d.upload(r['files'])
        waited, f, g = second_waits(lambda x: x.send_finish(tok, ENR1, r['submission_id'], r['files']), lambda x: x.rpc('upsert_score(:e, :a, 7)', e=ENR1, a=a))
        ok('the other way round, the Replace first: the save waits for it, and the grade lands on the new pages', waited and f['ok'] and not str(g).startswith('ERROR')
           and d.all("select id, state from submission") == [[r['submission_id'], 'sent']] and sound(d) == '', (f, g))
        clear()

        # ── The teacher adds work as the student sends ──────────────────
        s = d.send_start(tok, ENR1, a); d.upload(s['files'])
        t = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR1, p='[{}]', m='new', k=nid())
        for f_ in t['files']:
            for p_ in (f_['path'], f_['thumb_path']): d.storage.put_as('authenticated', A, p_)
        tf = json.dumps([{'file_id': t['files'][0]['file_id'], 'sha256': HASH}])
        waited, f, g = second_waits(lambda x: x.send_finish(tok, ENR1, s['submission_id'], s['files']),
                                    lambda x: x.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=t['submission_id'], f=tf, k=nid()))
        ok("the student's finish and the teacher's Add Work for the same piece at once: one is handed in, the other is told already_sent, never two",
           waited and f['ok'] and g == {'result': 'already_sent'} and d.one("select count(*) from submission where state = 'sent'") == 1 and sound(d) == '', (f, g))
        clear()

        # ── A send against its assessment being deleted ─────────────────
        def new_assessment():
            x = nid(); d.run("insert into assessment (id, course_id, title, score_mode, max_points, students_send) values (:a, :c, 'Quick Check', 'points', 5, 'photos')", a=x, c=COURSE_A); return x
        x = new_assessment()
        waited, g, s = second_waits(lambda h: h.rpc('delete_assessment(:a)', a=x), lambda o: o.send_start(tok, ENR1, x))
        ok('the teacher is deleting the assessment when a student starts a send to it: the send waits, then is not_found; no row is left behind',
           waited and err(s) == 'not_found' and d.one('select count(*) from submission where assessment_id = :a', a=x) == 0, (g, s))
        x = new_assessment()
        waited, s, g = second_waits(lambda h: h.send_start(tok, ENR1, x), lambda o: o.rpc('delete_assessment(:a)', a=x))
        ok('the other way round, the send first: the delete waits, then takes the unfinished send with it and queues its files',
           waited and s['ok'] and not str(g).startswith('ERROR') and d.one('select count(*) from submission where assessment_id = :a', a=x) == 0
           and set(p for f in s['files'] for p in (f['path'], f['thumb_path'])) <= set(queued(d)), (s, g))
        bad = []
        for n in range(30):
            x = new_assessment(); out = {}
            def student(o=side(), x=x, out=out):
                s = attempt(lambda: o.send_start(tok, ENR1, x))
                if isinstance(s, dict) and s.get('ok'):
                    out['up'] = attempt(lambda: o.upload(s['files'])); out['fin'] = attempt(lambda: o.send_finish(tok, ENR1, s['submission_id'], s['files']))
                out['start'] = s
            def teacher(o=side(), x=x, out=out): out['del'] = attempt(lambda: o.rpc('delete_assessment(:a)', a=x))
            ts = [threading.Thread(target=f) for f in ((student, teacher) if n % 2 else (teacher, student))]
            for t_ in ts: t_.start()
            for t_ in ts: t_.join(20)
            errors = [v for v in out.values() if isinstance(v, str) and v.startswith('ERROR')]
            if errors or d.one('select count(*) from submission where assessment_id = :a', a=x) or sound(d): bad.append((n, errors, sound(d)))
            d.run('delete from student_submit.send_log')
        ok('30 rounds of a whole send racing the delete of its assessment: no error, no deadlock, and never a submission left for an assessment that is gone', not bad, bad[:2])
        clear()

        # ── The hourly limit under a burst ──────────────────────────────
        out = []
        def burst(o): out.append(attempt(lambda: o.send_start(tok, ENR1, a)))
        ts = [threading.Thread(target=burst, args=(side(),)) for _ in range(30)]
        for t_ in ts: t_.start()
        for t_ in ts: t_.join(30)
        kinds = sorted('ok' if isinstance(v, dict) and v.get('ok') else (v.get('error') if isinstance(v, dict) else v) for v in out)
        ok('30 send_starts at once from one card: exactly 20 are given links and 10 are told too_many; one unfinished send is left',
           kinds == ['ok'] * 20 + ['too_many'] * 10 and d.one('select count(*) from student_submit.send_log') == 20 and d.one('select count(*) from submission') == 1, kinds)
        clear()

        # ── Everything at once ──────────────────────────────────────────
        a2 = k['nothing']; d.run("update assessment set students_send = 'photos_files' where id = :a", a=a2)
        stop = time.time() + 12; errors = []; counts = {}
        def note(name, r):
            counts[name] = counts.get(name, 0) + 1
            if isinstance(r, str) and r.startswith(('ERROR', 'STORAGE')): errors.append((name, r))
        def student_loop(tk, e, o):
            n = 0
            while time.time() < stop:
                n += 1; x = a if n % 3 else a2
                s = attempt(lambda: o.send_start(tk, e, x, pages=1 + n % 3, replace=(n % 5 == 0))); note('send_start', s)
                if isinstance(s, dict) and s.get('ok'):
                    note('upload', attempt(lambda: o.upload(s['files'])))
                    note('send_finish', attempt(lambda: o.send_finish(tk, e, s['submission_id'], s['files'])))
                if n % 2: note('unsend', attempt(lambda: o.unsend(tk, e, x)))
                note('work', attempt(lambda: o.work(tk, e))); note('file_links', attempt(lambda: o.file_links(tk, e, x)))
        def grade_loop(o):
            n = 0
            while time.time() < stop:
                n += 1; e = (ENR1, ENR2)[n % 2]; x = (a, a2)[(n // 2) % 2]
                note('upsert_score', attempt(lambda: o.rpc('upsert_score(:e, :a, :v)', e=e, a=x, v=n % 10)))
                if n % 3 == 0: note('return_grades', attempt(lambda: o.rpc('return_grades(:a, :e, :k)', a=x, e=[ENR1, ENR2], k=nid())))
                if n % 4 == 0: note('clear_score', attempt(lambda: o.rpc('clear_score(:e, :a)', e=e, a=x)))
        def add_work_loop(o):
            n = 0
            while time.time() < stop:
                n += 1; e = (ENR1, ENR2)[n % 2]; x = (a2, a)[n % 4 == 0]
                note('teacher_upload', attempt(lambda: add_work(o, x, e, ('new', 'add', 'replace')[n % 3])))
                if n % 5 == 0: note('mark_handed_in_paper', attempt(lambda: o.rpc('mark_handed_in_paper(:a, :e, :k)', a=x, e=[ENR1, ENR2], k=nid())))
                if n % 4 == 0:
                    sid = attempt(lambda: o.one("select id from submission where state = 'sent' order by random() limit 1"))
                    if sid and not str(sid).startswith('ERROR'): note('delete_submission', attempt(lambda: o.rpc('delete_submission(:s, :k)', s=sid, k=nid())))
                note('list_course_submissions', attempt(lambda: o.rpc('list_course_submissions(:c)', c=COURSE_A)))
        def add_work(o, x, e, mode):
            """Add Work as the browser does it. An upload can be dropped under it (the work it was adding to or replacing
            was unsent or deleted meanwhile): storage then refuses the file (403) and the finish must answer gone."""
            s = o.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=x, e=e, p='[{}]', m=mode, k=nid())
            if s['result'] != 'ready': return s['result']
            dropped = False
            for f in s['files']:
                for p in (f['path'], f['thumb_path']):
                    try: o.storage.put_as('authenticated', A, p)
                    except StorageError as ex:
                        if ex.status != 403: raise
                        dropped = True
            r = o.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=s['submission_id'], f=json.dumps([{'file_id': f['file_id'], 'sha256': HASH} for f in s['files']]), k=nid())
            if dropped and r['result'] != 'gone': return 'ERROR storage refused a file of an upload that was still there: %s' % r['result']
            return r['result']
        def come_and_go_loop(o, o2):
            while time.time() < stop:
                x = attempt(lambda: (lambda i: (o.run("insert into assessment (id, course_id, title, score_mode, max_points, students_send) values (:a, :c, 'Quick Check', 'points', 5, 'photos')", a=i, c=COURSE_A), i)[1])(nid()))
                s = attempt(lambda: o2.send_start(tok2, ENR2, x)); note('send_start (short-lived piece)', s)
                note('delete_assessment', attempt(lambda: o.rpc('delete_assessment(:a)', a=x)))
        def worker_loop(o):
            while time.time() < stop:
                note('drain', attempt(lambda: o.drain(50))); attempt(lambda: o.run('delete from student_submit.send_log')); time.sleep(0.05)
        ts = [threading.Thread(target=student_loop, args=(tok, ENR1, side())), threading.Thread(target=student_loop, args=(tok2, ENR2, side())),
              threading.Thread(target=grade_loop, args=(side(),)), threading.Thread(target=add_work_loop, args=(side(),)),
              threading.Thread(target=come_and_go_loop, args=(side(), side())), threading.Thread(target=worker_loop, args=(side(),)), threading.Thread(target=worker_loop, args=(side(),))]
        for t_ in ts: t_.start()
        for t_ in ts: t_.join(60)
        total = sum(counts.values())
        ok('twelve seconds of everything at once in one class (two students sending, replacing and unsending; scores saved, cleared and returned; Add Work in its three modes, paper, deletes; '
           'assessments made and deleted under a send; two removal workers): no error of any kind and no deadlock, in several hundred calls', not errors and total > 300, (errors[:3], counts))
        print('# the mix made %d calls: %s' % (total, ', '.join('%s %d' % kv for kv in sorted(counts.items()))))
        ok('afterwards every rule that must always hold, holds', sound(d) == '', sound(d))
        ok("and Batch A's own bookkeeping is undisturbed: every grade_return row holds the grade as the score tables have it",
           d.one('select count(*) from grade_return g where g.working_copy is distinct from public._grade_copy(g.enrollment_id, g.assessment_id)') == 0)
        d.run("delete from submission where state = 'sending'")
        d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute'")
        while d.drain()[0]['items']: pass
        ok('with the unfinished sends dropped and the worker run to the end, storage holds exactly the files of the pages handed in',
           d.storage.names() == live_paths(d) and d.one('select count(*) from submission_file_removal where not done') == 0, (len(d.storage.names()), len(live_paths(d))))
    finally:
        for x in sides: x.close()
        d.close()

SCENARIOS = {'teacher': scen_teacher, 'student': scen_student, 'storage': scen_storage, 'race': scen_race}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
