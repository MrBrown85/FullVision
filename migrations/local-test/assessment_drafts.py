"""Assessment drafts: migrations/2026111701_assessment_drafts.sql on a database rebuilt from the repo and
proved equal to live (scripts/db-rebuild.mjs --check; docs/database-rebuild.md).

    DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/<db> node scripts/db-rebuild.mjs --check
    PGPORT=<port> PGDATABASE=<db> python3 assessment_drafts.py            every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 assessment_drafts.py student    or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and
dropped here. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  student   A Draft is exactly as invisible as a piece whose Date Assigned has not come: every
            student_submit read and write a session reaches (page with its to-do count, rubrics and
            My Learning; work; feedback; group_work; file_links; group_file_links; handout_links;
            markup; reflect; send_start; replace; unsend) gives the same answer, byte for byte, for a
            Draft as for the same piece dated in the future, and neither names the piece; assigned
            again, it is back. Checks marked (before) run on the database without the file.
  create    create_assessment with p_is_draft true, false, null and left out; the old named and
            positional calls; one overload; idempotency replays (a replay with another p_is_draft
            gives the first id and changes nothing).
  update    Assign, Unassign, a patch without is_draft, is_draft as a non-boolean, true on a Draft,
            false on an assigned piece with work; the refusal for each kind of student result or work
            (draft_has_work, P0001, nothing of the patch applied), what does not block, a write to
            the table through the API, linked copies (copy_group) untouched.
  copies    get_class_bundle and get_gradebook send is_draft; duplicate_assessment copies it;
            import_teams_class and import_json_restore take it from the row, else false.
  rls       Teacher B cannot read, change, Unassign, Assign or copy Teacher A's piece; nobody signed in
            and anon can run nothing; the trigger function is the owner's alone.
  race      On connections of their own: Unassign against a grade being saved and a send being started,
            each order. No deadlock; the Draft never ends up with a student's work it did not see.
  apply     The guards (each wrong definition, a second overload, a wrong column, a taken trigger name)
            stop with the catalog unchanged; a second run; every replaced function differs from live
            only by is_draft lines and keeps its attributes and grants; the md5s the header records;
            the pre-check and post-check.
  undo      Refuses while a Draft exists; otherwise the catalog and every row are as before the file
            (but one dropped-column slot on assessment); a second run; on a database without the file
            it changes nothing; page answers as before the file.
"""
import difflib, json, os, re, sys, threading, time, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import (Db, tx, refused, ok, finish, nid, connect, admin, message, sqlstate, KEY_ID, split, text_of,
                               catalog, differences, row_checksums)
import card_codes_common as ccc

FILE = '../2026111701_assessment_drafts.sql'
UNDO = 'assessment-drafts-undo.sql'
PRE = 'assessment-drafts-live-precheck.sql'
POST = 'assessment-drafts-live-postcheck.sql'
OLD_CA = 'public.create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid)'
NEW_CA = OLD_CA[:-1] + ',boolean)'
GUARD = 'public._assessment_draft_guard()'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
REPLACED = ['student_submit._session_classes(uuid)', 'student_submit._work_window(uuid)', 'student_submit.feedback(text,uuid,text)',
            'student_submit.group_work(text,uuid,text)', 'student_submit.page(text,uuid,text)',
            'student_submit.file_links(text,uuid,uuid,text)', 'student_submit.group_file_links(text,uuid,uuid,text)',
            'student_submit.handout_links(text,uuid,uuid,text)', 'student_submit.markup(text,uuid,uuid,text)',
            'student_submit.reflect(text,uuid,uuid,jsonb,text)', 'public.get_class_bundle(uuid,bigint)', 'public.get_gradebook(uuid)',
            'public.duplicate_assessment(uuid,uuid)', 'public.import_json_restore(jsonb,uuid)', 'public.import_teams_class(jsonb,uuid)',
            'public.update_assessment(uuid,jsonb,uuid[])']
HEADER = text_of(FILE)
def header_md5s():
    """{function name: (before, after)} from the header's table, and the three single lines."""
    out = {}
    for name, b, a in re.findall(r'^--   ([\w.]+)\s+([0-9a-f]{32})  ([0-9a-f]{32})$', HEADER, re.M): out[name] = (b, a)
    out['old_ca'] = re.search(r'create_assessment \(old signature, dropped\)\s+([0-9a-f]{32})', HEADER).group(1)
    out['new_ca'] = re.search(r'create_assessment \(with p_is_draft\)\s+([0-9a-f]{32})', HEADER).group(1)
    out['guard'] = re.search(r'_assessment_draft_guard \(new\)\s+([0-9a-f]{32})', HEADER).group(1)
    return out

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def defn(d, sig): return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
def has_file(d): return d.one("select exists (select 1 from pg_attribute where attrelid = 'public.assessment'::regclass and attname = 'is_draft' and not attisdropped)")
def bypass(d, sql, **kw):
    """A write as the owner with the trigger's restore exception on (as import_json_restore runs): how a test
    puts a Draft that has work, which the app cannot make."""
    d.run("select set_config('fv.restoring', 'on', false)")
    try: d.run(sql, **kw)
    finally: d.run("select set_config('fv.restoring', '', false)")
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def S(d, sql, **kw): return d.service(sql, **kw)
def err(d, fn): return refused(d, fn)

# ── The world: two teachers, Teacher A's class with the student page on, two students with cards ──────
class W: pass
def world(tag, applied=True):
    d = Db('d_' + tag)
    w = W(); w.d = d
    # catalog.py reads pg_cron's columns; the rebuild's stand-in for cron.job has fewer (it runs nothing either way)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=KEY_ID)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    w.c = str(T(d, "create_course(p_name => 'History 12', p_subjects => array['History'], p_grading_system => 'both', p_idempotency_key => gen_random_uuid())"))
    w.c2 = str(T(d, "create_course(p_name => 'History 12 B', p_subjects => array['History'], p_idempotency_key => gen_random_uuid())"))
    w.cb = str(T(d, "create_course(p_name => 'Bravo Socials', p_subjects => array['Socials'], p_idempotency_key => gen_random_uuid())", B))
    def enrol(c, first, uid=A):
        r = T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())", uid, c=c, f=first)
        return str(r['enrollment_id'])
    w.e1, w.e2, w.e3 = enrol(w.c, 'Cece'), enrol(w.c, 'Dev'), enrol(w.c, 'Eli')
    w.eb = enrol(w.cb, 'Bravo Kid', B)
    d.run("""update course set student_page_enabled = true, send_work = true, reflect_on_feedback = true, show_my_learning = true
              where id = any (:ids)""", ids=[w.c, w.cb])
    # a competency and a rubric used only by the piece under test
    subj = str(d.one('select id from subject where course_id = :c', c=w.c))
    w.sec = str(T(d, "upsert_section(null, :s, 'Evidence', '#336699', null, 0, gen_random_uuid())", s=subj))
    w.tag = str(T(d, "upsert_tag(null, :s, 'Use evidence', 'E1', 'I can use evidence', 0, gen_random_uuid())", s=w.sec))
    w.rub = str(T(d, """upsert_rubric(null, :c, 'Draft-Only Rubric', jsonb_build_array(jsonb_build_object('name', 'Argument',
                          'level_3_descriptor', 'Meets', 'checks', jsonb_build_array(jsonb_build_object('level', 3, 'label', 'Thesis')))),
                          null, gen_random_uuid(), 'advanced', jsonb_build_array(:t::uuid))""", c=w.c, t=w.tag))
    w.crit = str(d.one('select id from criterion where rubric_id = :r', r=w.rub))
    w.chk = str(d.one('select id from criterion_check where criterion_id = :c', c=w.crit))
    # Q: an ordinary piece the students always see. P: the piece under test, with work on it. P2: fresh, takes photos.
    w.q = str(T(d, "create_assessment(:c, 'Visible Essay', p_idempotency_key => gen_random_uuid())", c=w.c))
    w.p = str(T(d, "create_assessment(:c, 'SECRET-DRAFT-TITLE', p_rubric_id => :r, p_tag_ids => array[:t::uuid], p_idempotency_key => gen_random_uuid())",
                c=w.c, r=w.rub, t=w.tag))
    w.p2 = str(T(d, "create_assessment(:c, 'SECRET-FRESH-TITLE', p_idempotency_key => gen_random_uuid())", c=w.c))
    d.run("""update assessment set students_send = 'photos', group_work = 'group', collab_mode = 'pairs',
                    collab_config = jsonb_build_object('pairs', jsonb_build_array(jsonb_build_array(:e1::text, :e2::text)))
              where id = :p""", p=w.p, e1=w.e1, e2=w.e2)
    d.run("update assessment set students_send = 'photos' where id = any (:ids)", ids=[w.p2, w.q])
    # On P: a grade returned, a page sent with marks given on it, a reflection, a handout.
    T(d, "upsert_rubric_score(:e, :a, :c, 3, null, 'Good', null)", e=w.e1, a=w.p, c=w.crit)
    T(d, "return_grades(:a, array[:e::uuid], gen_random_uuid())", a=w.p, e=w.e1)
    w.sub = nid(); w.file = nid()
    d.run("""insert into submission (id, course_id, assessment_id, enrollment_id, version, state, intent, sent_by, sent_at)
             values (:s, :c, :a, :e, 1, 'sent', 'new', 'student', now())""", s=w.sub, c=w.c, a=w.p, e=w.e1)
    d.run("""insert into submission_file (id, submission_id, page, path, thumb_path, bytes, thumb_bytes, declared_bytes, declared_thumb_bytes,
                                          width, height, sha256, rotation, added_by, link_dies_at)
             values (:f, :s, 1, :path, :thumb, 1000, 100, 1000, 100,
                     800, 600, repeat('a', 64), 0, 'student', now() + interval '1 day')""", f=w.file, s=w.sub,
          path='%s/%s/%s.jpg' % (w.c, w.sub, w.file), thumb='%s/%s/%s-thumb.jpg' % (w.c, w.sub, w.file))
    d.run("""insert into markup (file_id, course_id, assessment_id, enrollment_id, working, working_rev, working_at, given, given_rev, given_at)
             values (:f, :c, :a, :e, '{"marks":[{"type":"note","text":"n"}]}', 1, now(), '{"marks":[{"type":"note","text":"n"}]}', 1, now())""",
          f=w.file, c=w.c, a=w.p, e=w.e1)
    d.run("""insert into feedback_reflection (course_id, assessment_id, enrollment_id, makes_sense, question, sent_at)
             values (:c, :a, :e, 'yes', 'Why?', now())""", c=w.c, a=w.p, e=w.e1)
    w.res = nid()
    d.run("""insert into assessment_resource (id, assessment_id, course_id, kind, title, page_count, status, position)
             values (:r, :a, :c, 'pdf', 'SECRET-HANDOUT', 2, 'ready', 1)""", r=w.res, a=w.p, c=w.c)
    w.t1, _ = session(d, w.e1, w.c)
    w.t2, _ = session(d, w.e2, w.c)
    if applied:
        r = d.file(FILE); assert r == 'ok', r
    return w

def session(d, e, c, teacher=A):
    code, _pw, _row = d.make(e, c, teacher)
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token'], code

# ── student ───────────────────────────────────────────────────────────────────────────────────────────
def paths(w):
    """Every route a student session reaches that reads or writes a piece: {name: function giving text}."""
    d = w.d
    def q(sql, **kw): return lambda: json.dumps(S(d, sql, **kw), sort_keys=True)
    def wr(sql, keys=None, **kw):
        def f():
            with tx(d):
                r = S(d, sql, **kw)
                # a send's reply carries a new id and now() + two hours: only what it decided is compared
                return json.dumps({k: r.get(k) for k in keys} if keys else r, sort_keys=True)
        return f
    rq = nid()
    return {
        'page (Cece)': q("student_submit.page(:t, :e, 'ip')", t=w.t1, e=w.e1),
        'page (Dev)': q("student_submit.page(:t, :e, 'ip')", t=w.t2, e=w.e2),
        'work': q("student_submit.work(:t, :e, 'ip')", t=w.t1, e=w.e1),
        'feedback': q("student_submit.feedback(:t, :e, 'ip')", t=w.t1, e=w.e1),
        'group_work': q("student_submit.group_work(:t, :e, 'ip')", t=w.t2, e=w.e2),
        'file_links': q("student_submit.file_links(:t, :e, :a, 'ip')", t=w.t1, e=w.e1, a=w.p),
        'group_file_links': q("student_submit.group_file_links(:t, :e, :a, 'ip')", t=w.t2, e=w.e2, a=w.p),
        'handout_links': q("student_submit.handout_links(:t, :e, :r, 'ip')", t=w.t1, e=w.e1, r=w.res),
        'markup': q("student_submit.markup(:t, :e, :a, 'ip')", t=w.t1, e=w.e1, a=w.p),
        'reflect': wr("""student_submit.reflect(:t, :e, :a, '{"makes_sense":"yes","plan":"Try again"}'::jsonb, 'ip')""", t=w.t2, e=w.e2, a=w.p),
        'send_start (fresh piece)': wr("""student_submit.send_start(:t, :e, :a, '[{"width":1500,"height":2000}]'::jsonb, null, null, :r, 'ip')""",
                                       keys=('ok', 'error', 'replayed', 'state', 'late'), t=w.t1, e=w.e1, a=w.p2, r=rq),
        'replace': wr("""student_submit.replace(:t, :e, :a, '[{"width":1500,"height":2000}]'::jsonb, null, null, :r, 'ip')""",
                      keys=('ok', 'error', 'replayed', 'state', 'late'), t=w.t1, e=w.e1, a=w.p, r=rq),
        'unsend': wr("student_submit.unsend(:t, :e, :a, 'ip')", t=w.t1, e=w.e1, a=w.p),
    }
SECRETS = ('SECRET-DRAFT-TITLE', 'SECRET-FRESH-TITLE', 'SECRET-HANDOUT')

def set_state(w, state):
    """assigned / draft / future for both pieces under test (P with work, P2 fresh)."""
    draft = state == 'draft'
    date = "current_date + 3" if state == 'future' else 'null'
    if has_file(w.d):
        bypass(w.d, "update assessment set is_draft = :x, date_assigned = %s where id = any (:ids)" % date, x=draft, ids=[w.p, w.p2])
    else:
        w.d.run("update assessment set date_assigned = %s where id = any (:ids)" % date, ids=[w.p, w.p2])

def scen_student():
    # (before) on the database without the file: the future-dated piece is hidden and the routes see the piece once dated today
    w = world('student_before', applied=False)
    try:
        fns = paths(w)
        set_state(w, 'assigned'); seen = {k: f() for k, f in fns.items()}
        set_state(w, 'future'); fut = {k: f() for k, f in fns.items()}
        # unsend reads no date (today, as before): a student may take back their own work on a piece
        # dated in the future; with the grade started it says grading_started either way
        ok('(before) every route but unsend answers differently for the piece assigned and dated in the future',
           all(seen[k] != fut[k] for k in fns if k != 'unsend') and seen['unsend'] == fut['unsend'],
           [k for k in fns if seen[k] == fut[k]])
    finally:
        w.d.close()
    w = world('student')
    try:
        d = w.d; fns = paths(w)
        set_state(w, 'assigned'); seen = {k: f() for k, f in fns.items()}
        set_state(w, 'future'); fut = {k: f() for k, f in fns.items()}
        set_state(w, 'draft'); dr = {k: f() for k, f in fns.items()}
        for k in fns:
            ok('student: %s: a Draft gets the answer a piece dated in the future gets, byte for byte' % k, dr[k] == fut[k], (dr[k][:300], fut[k][:300]))
            if k != 'unsend':
                ok('student: %s: the Draft is not the assigned answer' % k, dr[k] != seen[k], dr[k][:200])
        allout = ' '.join(dr.values())
        ok('student: no answer names the Draft, its title, its handout or its rubric',
           not any(s in allout for s in SECRETS) and w.p not in allout and w.p2 not in allout and w.rub not in allout and w.res not in allout)
        pg = json.loads(dr['page (Cece)'])
        ok('student: page lists only the visible piece; the rubric only a Draft uses is not sent; My Learning rubric_tags has none',
           [a['id'] for a in pg['assessments']] == [w.q] and pg['rubrics'] == [] and pg['learning'].get('rubric_tags') == {}, pg['assessments'])
        pgs = json.loads(seen['page (Cece)'])
        ok("student: page's to-do count leaves the Draft out (assigned: 2 to do, Draft: 1)",
           pgs['classes'][0]['to_do'] == 2 and pg['classes'][0]['to_do'] == 1, (pgs['classes'], pg['classes']))
        ok('student: a send to the Draft is refused as not_found, as one to a future-dated piece',
           json.loads(dr['send_start (fresh piece)']).get('error') == 'not_found' and json.loads(seen['send_start (fresh piece)']).get('ok') is True)
        ok('student: handout_links, markup and reflect on the Draft: not_found',
           all(json.loads(dr[k]).get('error') == 'not_found' for k in ('handout_links', 'markup', 'reflect')))
        ok('student: file_links and group_file_links for the Draft: no files',
           json.loads(dr['file_links'])['files'] == [] and json.loads(dr['group_file_links'])['files'] == [])
        # Assigned again (through the app: update_assessment), it is all back, byte for byte
        bypass(d, "update assessment set is_draft = true, date_assigned = null where id = any (:ids)", ids=[w.p, w.p2])
        for a in (w.p, w.p2): T(d, """update_assessment(:a, '{"is_draft": false}'::jsonb)""", a=a)
        back = {k: f() for k, f in fns.items()}
        ok('student: Assigned again, every route gives the assigned answer again', all(back[k] == seen[k] for k in fns),
           [k for k in fns if back[k] != seen[k]])
        # A Draft dated in the past is still hidden; Date Assigned and Draft add up
        bypass(d, "update assessment set is_draft = true, date_assigned = current_date - 5 where id = any (:ids)", ids=[w.p, w.p2])
        past = {k: f() for k, f in fns.items()}
        ok('student: a Draft dated in the past is hidden all the same', all(past[k] == fut[k] for k in fns), [k for k in fns if past[k] != fut[k]])
        # card sign-in's class list (verify_card reads _session_classes)
        code = session(d, w.e3, w.c)[1]
        r = d.verify(code, birthday='2012-05-15')
        ok("student: a card sign-in's to-do count leaves out the Draft (Eli: only the visible piece)",
           r['ok'] and r['classes'][0]['to_do'] == 1, r.get('classes'))
    finally:
        w.d.close()

# ── create ────────────────────────────────────────────────────────────────────────────────────────────
def scen_create():
    w = world('create'); d = w.d
    try:
        def draft(a): return d.one('select is_draft from assessment where id = :a', a=a)
        a1 = T(d, "create_assessment(:c, 'D1', p_is_draft => true, p_idempotency_key => gen_random_uuid())", c=w.c)
        a2 = T(d, "create_assessment(:c, 'D2', p_idempotency_key => gen_random_uuid())", c=w.c)
        a3 = T(d, "create_assessment(:c, 'D3', p_is_draft => false)", c=w.c)
        a4 = T(d, "create_assessment(:c, 'D4', p_is_draft => null)", c=w.c)
        ok('create: p_is_draft true makes a Draft', draft(a1) is True)
        ok('create: p_is_draft left out, false or null: assigned', (draft(a2), draft(a3), draft(a4)) == (False, False, False))
        a5 = T(d, """create_assessment(:c, 'Positional', null, 'desc', null, null, 'points', 10, 1.0, null, null, null,
                                       '{}'::uuid[], null, '{}'::text[], gen_random_uuid())""", c=w.c)
        ok('create: the old call with all sixteen arguments in order still works, and makes an assigned piece', draft(a5) is False)
        a6 = T(d, "create_assessment(p_course_id => :c, p_title => 'Named', p_score_mode => 'points', p_max_points => 5)", c=w.c)
        ok('create: the old call by name still works', draft(a6) is False)
        ok('create: one create_assessment, the new signature',
           d.all("select oid::regprocedure::text from pg_proc where proname = 'create_assessment'") ==
           [['create_assessment(uuid,text,uuid,text,date,date,text,numeric,numeric,text,uuid,uuid,uuid[],uuid,text[],uuid,boolean)']])
        k = nid()
        x = T(d, "create_assessment(:c, 'Idem', p_is_draft => true, p_idempotency_key => :k)", c=w.c, k=k)
        y = T(d, "create_assessment(:c, 'Idem', p_is_draft => true, p_idempotency_key => :k)", c=w.c, k=k)
        z = T(d, "create_assessment(:c, 'Idem', p_is_draft => false, p_idempotency_key => :k)", c=w.c, k=k)
        ok('create: the same request again gives the same id and makes no second row; a replay with p_is_draft changed changes nothing',
           x == y == z and d.one("select count(*) from assessment where title = 'Idem'") == 1 and draft(x) is True)
        e = err(d, lambda: T(d, "create_assessment(:c, 'Nobody', p_is_draft => true)", '', c=w.c))
        ok('create: nobody signed in: not authenticated (PT401)', e and e[1] == 'PT401', e)
    finally:
        d.close()

# ── update ────────────────────────────────────────────────────────────────────────────────────────────
WORK_KINDS = [
    ('a score', lambda w, a: T(w.d, "upsert_score(:e, :a, 7, null)", e=w.e1, a=a)),
    ('a status: Missing', lambda w, a: T(w.d, "set_score_status(:e, :a, 'NS')", e=w.e1, a=a)),
    ('a status: Excused', lambda w, a: T(w.d, "set_score_status(:e, :a, 'EXC')", e=w.e1, a=a)),
    ('a comment on the score, nothing else', lambda w, a: T(w.d, "save_score_comment(:e, :a, 'Comment only')", e=w.e1, a=a)),
    ('a Note for the Report, nothing else', lambda w, a: T(w.d, "save_score_report_note(:e, :a, 'Note', gen_random_uuid())", e=w.e1, a=a)),
    ('a rubric score', lambda w, a: T(w.d, "upsert_rubric_score(:e, :a, :c, 2, null, null, null)", e=w.e1, a=a, c=w.crit)),
    ('a competency score', lambda w, a: T(w.d, "upsert_tag_score(:e, :a, :t, 3, null, null)", e=w.e1, a=a, t=w.tag)),
    ('a ticked rubric box', lambda w, a: T(w.d, "set_rubric_check(:e, :a, :k, true)", e=w.e1, a=a, k=w.chk)),
    # a grade returned whose score was cleared since: the student has seen it
    ('a grade returned', lambda w, a: w.d.run("""insert into grade_return (enrollment_id, assessment_id, returned_at)
                                                 values (:e, :a, now())""", e=w.e1, a=a)),
    ('a Draft grade held (grade_return is_draft)', lambda w, a: w.d.run("""insert into grade_return (enrollment_id, assessment_id, is_draft, working_copy)
                                                                           values (:e, :a, true, '{}'::jsonb)""", e=w.e1, a=a)),
    ('work the student sent', lambda w, a: w.d.run("""insert into submission (course_id, assessment_id, enrollment_id, state, intent, sent_by, sent_at)
                                                      values (:c, :a, :e, 'sent', 'new', 'student', now())""", c=w.c, a=a, e=w.e1)),
    ('work being sent', lambda w, a: w.d.run("""insert into submission (course_id, assessment_id, enrollment_id, state, intent, sent_by, request_id)
                                                values (:c, :a, :e, 'sending', 'new', 'student', gen_random_uuid())""", c=w.c, a=a, e=w.e1)),
    ("the teacher's Handed In on Paper", lambda w, a: w.d.run("""insert into submission (course_id, assessment_id, enrollment_id, state, intent, sent_by, on_paper, sent_at)
                                                                 values (:c, :a, :e, 'sent', 'new', 'teacher', true, now())""", c=w.c, a=a, e=w.e1)),
    ('a revision request', lambda w, a: w.d.run("""insert into revision_request (course_id, assessment_id, enrollment_id, what_to_fix, created_by)
                                                   values (:c, :a, :e, 'Fix', :t)""", c=w.c, a=a, e=w.e1, t=A)),
    ('a reflection on feedback', lambda w, a: w.d.run("""insert into feedback_reflection (course_id, assessment_id, enrollment_id, makes_sense)
                                                         values (:c, :a, :e, 'yes')""", c=w.c, a=a, e=w.e1)),
    ('a DIBELS measure', None),
    ("a withdrawn student's score", None),
]
NOT_BLOCKING = [
    ('a score row with nothing in it', lambda w, a: w.d.run("insert into score (enrollment_id, assessment_id) values (:e, :a)", e=w.e1, a=a)),
    ('the student opened the list (grade_return seen_at only)',
     lambda w, a: S(w.d, "student_submit.seen(:t, :e, array[:a::uuid], 'ip')", t=w.t1, e=w.e1, a=a)),
    ('a rubric printed for the student', lambda w, a: T(w.d, "set_rubric_printed(:e, :a, 'hash', now(), gen_random_uuid())", e=w.e1, a=a)),
    ('a handout', lambda w, a: w.d.run("""insert into assessment_resource (assessment_id, course_id, kind, title, url, status, position)
                                          values (:a, :c, 'link', 'L', 'https://example.test', 'ready', 1)""", a=a, c=w.c)),
    ('competencies tagged', lambda w, a: w.d.run("insert into assessment_tag (assessment_id, tag_id) values (:a, :t) on conflict do nothing", a=a, t=w.tag)),
]

def unassign(d, a, uid=A, extra=''):
    return err(d, lambda: T(d, """update_assessment(:a, ('{"is_draft": true%s}')::jsonb)""" % extra, uid, a=a))
def state(d, a): return d.all('select is_draft, title from assessment where id = :a', a=a)[0]

def scen_update():
    w = world('update'); d = w.d
    try:
        a = T(d, "create_assessment(:c, 'Fresh', p_is_draft => true)", c=w.c)
        ok('update: Assign (true -> false) is allowed and makes it assigned',
           err(d, lambda: T(d, """update_assessment(:a, '{"is_draft": false}'::jsonb)""", a=a)) is None and state(d, a)[0] is False)
        ok('update: Unassign on a piece no student has touched is allowed', unassign(d, a) is None and state(d, a)[0] is True)
        T(d, """update_assessment(:a, '{"title": "Renamed"}'::jsonb)""", a=a)
        ok('update: a patch without is_draft leaves it', state(d, a) == [True, 'Renamed'])
        for bad in ('"yes"', 'null', '1', '{}'):
            e = err(d, lambda: T(d, """update_assessment(:a, ('{"is_draft": %s, "title": "Bad"}')::jsonb)""" % bad, a=a))
            ok('update: is_draft %s is refused (22023) and nothing changes' % bad, e and e[1] == '22023' and state(d, a) == [True, 'Renamed'], e)
        # each kind of result or work blocks Unassign; the patch's other fields are not applied either
        dib = T(d, "create_assessment(:c, 'Reading', p_score_mode => 'dibels')", c=w.c)
        for name, put in WORK_KINDS:
            rub = w.rub if name in ('a rubric score', 'a ticked rubric box') else None
            x = dib if name == 'a DIBELS measure' else T(d, "create_assessment(:c, :t, p_rubric_id => :r, p_tag_ids => array[:g::uuid])",
                                                          c=w.c, t='K ' + name, r=rub, g=w.tag)
            if name == 'a DIBELS measure': T(d, "upsert_dibels_score(:e, :a, 'boy', 50, null, null, null)", e=w.e1, a=x)
            elif name == "a withdrawn student's score":
                T(d, "upsert_score(:e, :a, 5, null)", e=w.e3, a=x); T(d, "withdraw_student(:e, gen_random_uuid())", e=w.e3)
            else: put(w, x)
            before = state(d, x)
            e = unassign(d, x, extra=', "title": "Should Not Apply"')
            ok('update: Unassign refused with %s: draft_has_work, P0001, nothing of the patch applied' % name,
               e == ('draft_has_work', 'P0001') and state(d, x) == before, (e, state(d, x)))
        # the refusal's detail is plain words
        x = T(d, "create_assessment(:c, 'Detail')", c=w.c); T(d, "upsert_score(:e, :a, 7, null)", e=w.e1, a=x)
        try: T(d, """update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=x); det = None
        except Exception as ex: det = ex.args[0].get('D')
        ok('update: the refusal says why in a sentence (detail)', det and det.startswith('A student has a grade'), det)
        # gone again (the score cleared): allowed
        T(d, "clear_score(:e, :a)", e=w.e1, a=x)
        left = d.one('select count(*) from score where assessment_id = :a', a=x)
        ok('update: once the grade is cleared, Unassign is allowed (%d score rows left, empty)' % left, unassign(d, x) is None and state(d, x)[0] is True)
        for name, put in NOT_BLOCKING:
            x = T(d, "create_assessment(:c, :t, p_rubric_id => :r)", c=w.c, t='N ' + name, r=w.rub); put(w, x)
            ok('update: %s does not block Unassign' % name, unassign(d, x) is None and state(d, x)[0] is True)
        # false on an assigned piece with work, and true on a Draft with work: no change, no refusal (the app sends is_draft in every patch)
        x = T(d, "create_assessment(:c, 'Worked')", c=w.c); T(d, "upsert_score(:e, :a, 7, null)", e=w.e1, a=x)
        ok('update: is_draft false on an assigned piece with work: no refusal',
           err(d, lambda: T(d, """update_assessment(:a, '{"is_draft": false, "title": "W2"}'::jsonb)""", a=x)) is None and state(d, x) == [False, 'W2'])
        bypass(d, "update assessment set is_draft = true where id = :a", a=x)
        ok('update: is_draft true on a Draft that has work: no refusal (nothing turns)',
           err(d, lambda: T(d, """update_assessment(:a, '{"is_draft": true, "title": "W3"}'::jsonb)""", a=x)) is None and state(d, x) == [True, 'W3'])
        ok('update: Assign is never refused, work or not',
           err(d, lambda: T(d, """update_assessment(:a, '{"is_draft": false}'::jsonb)""", a=x)) is None and state(d, x)[0] is False)
        # a write to the table straight through the API meets the same rule
        e = err(d, lambda: d.role('authenticated', 'update assessment set is_draft = true where id = :a', A, a=x))
        ok('update: a direct write to the table (as the teacher, through the API) is refused the same way', e == ('draft_has_work', 'P0001'), e)
        y = T(d, "create_assessment(:c, 'Direct')", c=w.c)
        d.role('authenticated', 'update assessment set is_draft = true where id = :a', A, a=y)
        ok('update: ... and allowed on a piece with no work', state(d, y)[0] is True)
        # linked copies: each class's own
        g = nid()
        c1 = T(d, "create_assessment(:c, 'Linked', p_copy_group => :g)", c=w.c, g=g)
        c2 = T(d, "create_assessment(:c, 'Linked', p_copy_group => :g)", c=w.c2, g=g)
        T(d, """update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=c1)
        ok('update: Unassign on one linked copy leaves the copy in the other class assigned', state(d, c1)[0] is True and state(d, c2)[0] is False)
        T(d, """update_assessment(:a, '{"is_draft": false}'::jsonb)""", a=c1); T(d, """update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=c2)
        ok('update: ... and the other way round', state(d, c1)[0] is False and state(d, c2)[0] is True)
        e = err(d, lambda: T(d, """update_assessment(:a, '{"is_draft": true}'::jsonb)""", '', a=y))
        ok('update: nobody signed in: PT401', e and e[1] == 'PT401', e)
        e = unassign(d, nid())
        ok('update: an unknown piece: assessment not found (P0002)', e and e[1] == 'P0002', e)
    finally:
        d.close()

# ── copies ────────────────────────────────────────────────────────────────────────────────────────────
def scen_copies():
    w = world('copies'); d = w.d
    try:
        dr = T(d, "create_assessment(:c, 'Bundle Draft', p_is_draft => true)", c=w.c)
        b = T(d, "get_class_bundle(:c, null)", c=w.c)
        flags = {x['id']: x.get('is_draft') for x in b['gradebook']['assessments']}
        ok('copies: get_class_bundle sends is_draft on every assessment', all(v in (True, False) for v in flags.values()) and flags[dr] is True
           and flags[w.q] is False, flags)
        g = T(d, "get_gradebook(:c)", c=w.c)
        gf = {x['id']: x.get('is_draft') for x in g['assessments']}
        ok('copies: get_gradebook sends is_draft too', gf.get(dr) is True and gf.get(w.q) is False, gf)
        v1 = T(d, "get_class_bundle(:c, null)", c=w.c)['version']
        T(d, """update_assessment(:a, '{"is_draft": false}'::jsonb)""", a=dr)
        v2 = T(d, "get_class_bundle(:c, :v)", c=w.c, v=v1)
        ok('copies: Assign moves the class version, so a browser holding the class reads it again',
           v2.get('not_modified') is not True and {x['id']: x['is_draft'] for x in v2['gradebook']['assessments']}[dr] is False, str(v2)[:200])
        v3 = T(d, "get_class_bundle(:c, :v)", c=w.c, v=v2['version'])
        ok('copies: (and the same version again is not_modified)', v3.get('not_modified') is True, v3)
        T(d, """update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=dr)
        d1 = T(d, "duplicate_assessment(:a, gen_random_uuid())", a=dr); d2 = T(d, "duplicate_assessment(:a, gen_random_uuid())", a=w.q)
        ok('copies: Duplicate of a Draft is a Draft; of an assigned piece, assigned',
           d.one('select is_draft from assessment where id = :a', a=d1) is True and d.one('select is_draft from assessment where id = :a', a=d2) is False)
        r = T(d, """import_teams_class(jsonb_build_object('class_name', 'Teams', 'assignments', jsonb_build_array(
                       jsonb_build_object('title', 'T-true', 'is_draft', true), jsonb_build_object('title', 'T-none'),
                       jsonb_build_object('title', 'T-string', 'is_draft', 'yes'), jsonb_build_object('title', 'T-false', 'is_draft', false))),
                       gen_random_uuid())""")
        got = dict(d.all("select title, is_draft from assessment where title like 'T-%'"))
        ok('copies: import_teams_class: is_draft from the row when it is true or false, else assigned',
           got == {'T-true': True, 'T-none': False, 'T-string': False, 'T-false': False}, got)
        # restore: a Draft in the backup comes back a Draft; a row without the key, assigned; over an existing row both ways
        n1, n2 = nid(), nid()
        pay = {'assessments': [{'id': n1, 'course_id': w.c, 'title': 'R-draft', 'is_draft': True},
                               {'id': n2, 'course_id': w.c, 'title': 'R-none'},
                               {'id': dr, 'course_id': w.c, 'title': 'R-over-draft'},
                               {'id': w.p, 'course_id': w.c, 'title': 'R-over-worked', 'rubric_id': w.rub, 'is_draft': True}]}
        T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(pay))
        got = dict(d.all("select title, is_draft from assessment where title like 'R-%'"))
        ok('copies: import_json_restore: true -> Draft, left out -> assigned, over a Draft without the key -> assigned, '
           'over a piece with work -> the backup\'s Draft (a restore writes the backup\'s state)',
           got == {'R-draft': True, 'R-none': False, 'R-over-draft': False, 'R-over-worked': True}, got)
        T(d, "upsert_score(:e, :a, 4, null)", e=w.e1, a=w.q)
        ok('copies: after the restore the rule is back in force (fv.restoring is off)', unassign(d, w.q) == ('draft_has_work', 'P0001'))
    finally:
        d.close()

# ── rls ───────────────────────────────────────────────────────────────────────────────────────────────
def scen_rls():
    w = world('rls'); d = w.d
    try:
        dr = T(d, "create_assessment(:c, 'A Draft', p_is_draft => true)", c=w.c)
        ok("rls: Teacher B reads no row of Teacher A's", d.role('authenticated', 'select count(*) from assessment where id = :a', B, a=dr)[0][0] == 0)
        e = err(d, lambda: T(d, "get_class_bundle(:c, null)", B, c=w.c))
        ok("rls: Teacher B gets nothing of A's class from get_class_bundle", e is not None or 'A Draft' not in json.dumps(T(d, "get_class_bundle(:c, null)", B, c=w.c)), e)
        for patch in ('{"is_draft": false}', '{"is_draft": true}'):
            for a in (dr, w.q):
                e = err(d, lambda: T(d, "update_assessment(:a, :p::jsonb)", B, a=a, p=patch))
                ok("rls: Teacher B's update_assessment %s on A's piece: not found (P0002)" % patch, e and e[1] == 'P0002', e)
        r = d.role('authenticated', 'update assessment set is_draft = not is_draft where id = any (:ids) returning id', B, ids=[dr, w.q])
        ok("rls: Teacher B's direct write reaches no row", r == [])
        ok("rls: nothing of A's changed", state(d, dr)[0] is True and state(d, w.q)[0] is False)
        e = err(d, lambda: T(d, "duplicate_assessment(:a, gen_random_uuid())", B, a=dr))
        ok("rls: Teacher B cannot duplicate A's Draft", e is not None, e)
        e = err(d, lambda: T(d, "create_assessment(:c, 'Into A', p_is_draft => true)", B, c=w.c))
        ok("rls: Teacher B cannot make a Draft in A's class", e is not None and d.one("select count(*) from assessment where title = 'Into A'") == 0, e)
        for sig in (NEW_CA, 'public.update_assessment(uuid,jsonb,uuid[])', GUARD) + tuple(s for s in REPLACED if s.startswith('student_submit')):
            ok('rls: anon may not run %s' % sig.split('(')[0], d.one("select has_function_privilege('anon', :s, 'execute')", s=sig) is False)
        ok('rls: only the owner may run the trigger function',
           all(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=GUARD) is False for r in ('authenticated', 'service_role')))
        ok('rls: no teacher may run a student page function; the service role runs the routes (the helpers are the owner\'s alone)',
           all(d.one("select has_function_privilege('authenticated', :s, 'execute')", s=s) is False and
               d.one("select has_function_privilege('service_role', :s, 'execute')", s=s) is (not s.startswith('student_submit._'))
               for s in REPLACED if s.startswith('student_submit')))
        e = err(d, lambda: d.role('anon', "select public.create_assessment(p_course_id => :c, p_title => 'x', p_is_draft => true)", None, c=w.c))
        ok('rls: anon calling create_assessment: permission denied', e and e[1] == '42501', e)
        e = err(d, lambda: d.role('anon', 'select count(*) from assessment', None))
        ok('rls: anon reading assessment: permission denied', e and e[1] == '42501', e)
    finally:
        d.close()

# ── race ──────────────────────────────────────────────────────────────────────────────────────────────
class Side:
    """A second connection to the scenario's database, acting as one role."""
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def begin(self, role, uid=None):
        self.c.run('begin')
        if uid: self.c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid)
        self.c.run('set local role ' + role)
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()

def in_thread(fn):
    box = {}
    def go():
        try: box['r'] = fn()
        except Exception as e: box['e'] = (message(e), sqlstate(e))
    t = threading.Thread(target=go); t.start(); return t, box

def waiting(d, n=1, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        if d.one("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'") >= n: return True
        time.sleep(0.05)
    return False

def scen_race():
    w = world('race'); d = w.d
    try:
        for rnd in range(3):
            # 1. a grade being saved, then Unassign: Unassign waits for it and is refused
            a = T(d, "create_assessment(:c, :t)", c=w.c, t='R1-%d' % rnd)
            s1, s2 = Side(d), Side(d)
            s1.begin('authenticated', A); s1.run("select upsert_score(:e, :a, 6, null)", e=w.e1, a=a)
            s2.begin('authenticated', A)
            t, box = in_thread(lambda: s2.run("""select update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=a))
            blocked = waiting(d); s1.run('commit'); t.join(30)
            if 'e' not in box: s2.run('commit')
            else: s2.run('rollback')
            ok('race %d: a grade being saved, then Unassign: Unassign waits, then is refused' % rnd,
               blocked and box.get('e', ('',))[0] == 'draft_has_work' and state(d, a)[0] is False, (blocked, box))
            s1.close(); s2.close()
            # 2. a send being started, then Unassign: refused once the send is in
            a = T(d, "create_assessment(:c, :t)", c=w.c, t='R2-%d' % rnd); d.run("update assessment set students_send = 'photos' where id = :a", a=a)
            s1, s2 = Side(d), Side(d)
            s1.begin('service_role')
            r = s1.run("""select student_submit.send_start(:t, :e, :a, '[{"width":1500,"height":2000}]'::jsonb, null, null, gen_random_uuid(), 'ip')""",
                       t=w.t1, e=w.e1, a=a)[0][0]
            s2.begin('authenticated', A)
            t, box = in_thread(lambda: s2.run("""select update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=a))
            blocked = waiting(d); s1.run('commit'); t.join(30)
            s2.run('commit' if 'e' not in box else 'rollback')
            ok('race %d: a send being started, then Unassign: Unassign waits, then is refused' % rnd,
               r.get('ok') and blocked and box.get('e', ('',))[0] == 'draft_has_work' and state(d, a)[0] is False, (r, blocked, box))
            s1.close(); s2.close()
            # 3. Unassign, then a send: the send waits, then finds no piece
            a = T(d, "create_assessment(:c, :t)", c=w.c, t='R3-%d' % rnd); d.run("update assessment set students_send = 'photos' where id = :a", a=a)
            s1, s2 = Side(d), Side(d)
            s1.begin('authenticated', A); s1.run("""select update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=a)
            s2.begin('service_role')
            t, box = in_thread(lambda: s2.run("""select student_submit.send_start(:t, :e, :a, '[{"width":1500,"height":2000}]'::jsonb, null, null,
                                                  gen_random_uuid(), 'ip')""", t=w.t1, e=w.e1, a=a)[0][0])
            blocked = waiting(d); s1.run('commit'); t.join(30); s2.run('commit' if 'e' not in box else 'rollback')
            ok('race %d: Unassign, then a send: the send waits, then is refused not_found; the Draft has no work' % rnd,
               blocked and box.get('r', {}).get('error') == 'not_found' and d.one('select count(*) from submission where assessment_id = :a', a=a) == 0
               and state(d, a)[0] is True, (blocked, box))
            s1.close(); s2.close()
            # 4. Unassign, then a grade saved: the save waits and goes through (the app keeps a Draft out of grading; the server does not refuse it)
            a = T(d, "create_assessment(:c, :t)", c=w.c, t='R4-%d' % rnd)
            s1, s2 = Side(d), Side(d)
            s1.begin('authenticated', A); s1.run("""select update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=a)
            s2.begin('authenticated', A)
            t, box = in_thread(lambda: s2.run("select upsert_score(:e, :a, 6, null)", e=w.e1, a=a))
            blocked = waiting(d); s1.run('commit'); t.join(30); s2.run('commit' if 'e' not in box else 'rollback')
            ok('race %d: Unassign, then a grade saved: the save waits, then is saved on the Draft, no deadlock' % rnd,
               blocked and 'e' not in box and state(d, a)[0] is True and d.one('select count(*) from score where assessment_id = :a', a=a) == 1, (blocked, box))
            s1.close(); s2.close()
        # The same first race with the trigger's two locks taken out: the Draft goes through with the grade
        # (so the locks are what makes it hold)
        body = defn(d, GUARD)
        cut = body.replace('    perform 1 from assessment where id = new.id for update;\n', '').replace('    perform _grade_return_lock(new.course_id);\n', '')
        assert cut != body and 'for update' not in cut
        d.run(cut)
        a = T(d, "create_assessment(:c, 'R-mutant')", c=w.c)
        s1, s2 = Side(d), Side(d)
        s1.begin('authenticated', A); s1.run("select upsert_score(:e, :a, 6, null)", e=w.e1, a=a)
        s2.begin('authenticated', A)
        t, box = in_thread(lambda: s2.run("""select update_assessment(:a, '{"is_draft": true}'::jsonb)""", a=a))
        t.join(5); blocked = t.is_alive(); s1.run('commit'); t.join(30); s2.run('commit' if 'e' not in box else 'rollback')
        ok('race: (mutant without the locks) the first race lets the Draft through with a grade on it, as it must without them',
           'e' not in box and state(d, a)[0] is True and d.one('select count(*) from score where assessment_id = :a', a=a) == 1, (blocked, box))
        s1.close(); s2.close()
        d.run(body)
    finally:
        d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_apply():
    w = world('apply', applied=False); d = w.d
    try:
        H = header_md5s()
        live = {s: md5(d, s) for s in REPLACED}
        ok('apply: (before) every function the file replaces has the md5 the header records as live (read from gradebook-prod Nov 16)',
           all(H[s.split('(')[0]][0] == live[s] for s in REPLACED) and md5(d, OLD_CA) == H['old_ca'], live)
        pre = d.all(bare_select(text_of(PRE)))
        ok('apply: the pre-check says ok for every fingerprint and finds nothing of the file',
           all(v == 'ok' for k, v in pre if k.startswith('fingerprint')) and dict(pre)['is_draft column exists (want false)'] == 'false'
           and dict(pre)['create_assessment overloads (want 1)'] == '1', pre)
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        bodies0 = {s: defn(d, s) for s in REPLACED + [OLD_CA]}
        # the guards: each wrong state stops it with nothing changed
        def stops(name, setup, undo_sql, want):
            for st in setup: d.run(st)
            cat1 = catalog(d.c)
            r = d.file(FILE)
            changed = differences(cat1, catalog(d.c))
            ok('apply: stops when %s, with nothing changed' % name, r.startswith('STOPPED') and want in r and changed == ([], []), (r, changed))
            for st in undo_sql: d.run(st)
        wrong = bodies0['student_submit._work_window(uuid)'].replace("'listed',", "-- changed\n               'listed',")
        stops('a function it replaces is some other definition', [wrong], [bodies0['student_submit._work_window(uuid)']], 'is not the definition')
        stops('a second create_assessment exists', ["create function public.create_assessment(p uuid) returns uuid language sql as 'select null::uuid'"],
              ['drop function public.create_assessment(uuid)'], 'more than one create_assessment')
        stops('assessment.is_draft exists as something else', ['alter table assessment add column is_draft text'],
              ['alter table assessment drop column is_draft'], 'is_draft exists and is not')
        stops('a trigger named assessment_draft_guard runs another function',
              ["create function public.zz_other() returns trigger language plpgsql as 'begin return new; end'",
               'create trigger assessment_draft_guard before update on assessment for each row execute function public.zz_other()'],
              ['drop trigger assessment_draft_guard on assessment', 'drop function public.zz_other()'], 'already runs another function')
        stops('_assessment_draft_guard exists as something else',
              ["create function public._assessment_draft_guard() returns trigger language plpgsql as 'begin return new; end'"],
              ['drop function public._assessment_draft_guard()'], 'is not this file')
        # the dropped test column above leaves a slot; rebuild the copy so the apply meets live exactly
        d.close(); w = world('apply2', applied=False); d = w.d
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        ok('apply: the file applies', d.file(FILE) == 'ok')
        cat1 = catalog(d.c); rows1 = row_checksums(d.c)
        gone, new = differences(cat0, cat1)
        names = lambda ls: sorted({re.sub(r'\s+.*', '', l.split(' | ')[0] if ' | ' in l else l)[:80] for l in ls})
        ok('apply: no row of any table changed but assessment, which gains is_draft = false on every row',
           all(rows0[t] == rows1[t] for t in rows0 if t != 'public.assessment')
           and d.one('select count(*) from assessment where is_draft') == 0 and rows0['public.assessment'][0] == rows1['public.assessment'][0])
        unexpected = [l for l in gone + new if not l.startswith('depends ') and not any(k in l for k in (
            'create_assessment', '_assessment_draft_guard', 'assessment_draft_guard', 'is_draft', 'comments on',
            *[s.split('(')[0] for s in REPLACED]))]
        ok('apply: the catalog changes only in what the file names', unexpected == [], unexpected[:10])
        after = {s: md5(d, s) for s in REPLACED}
        ok('apply: every replaced function has the md5 the header records as after',
           all(H[s.split('(')[0]][1] == after[s] for s in REPLACED) and md5(d, NEW_CA) == H['new_ca'] and md5(d, GUARD) == H['guard'], after)
        # each replaced body, with the file's is_draft parts taken out, is the live body (white space apart)
        bad = [s for s in REPLACED + [OLD_CA] if squeeze(bodies0[s]) != squeeze(strip_draft(defn(d, NEW_CA if s == OLD_CA else s)))]
        ok('apply: each replaced function is the live definition plus is_draft and nothing else', bad == [], bad)
        sneaky = defn(d, 'student_submit.page(text,uuid,text)').replace("'ok', true, 'v', 1,", "'ok', true, 'v', 2,")
        ok('apply: (that comparison notices a change that is not is_draft)',
           squeeze(strip_draft(sneaky)) != squeeze(bodies0['student_submit.page(text,uuid,text)']))
        attrs = lambda sig: d.all("""select prosecdef, provolatile, proconfig::text, proacl::text from pg_proc where oid = to_regprocedure(:s)""", s=sig)
        ok('apply: create_assessment keeps security invoker, search_path public and the same grants',
           attrs(NEW_CA)[0][:3] == [False, 'v', '{search_path=public}'] and
           d.one("select has_function_privilege('authenticated', :s, 'execute') and has_function_privilege('service_role', :s, 'execute') and not has_function_privilege('anon', :s, 'execute')", s=NEW_CA))
        # a second run
        cat2 = catalog(d.c)
        ok('apply: a second run succeeds and changes nothing', d.file(FILE) == 'ok' and differences(cat2, catalog(d.c)) == ([], []))
        post = d.all(bare_select(text_of(POST)))
        ok('apply: the post-check says ok on every line, 0 drafts',
           all(v == 'ok' for k, v in post if k != 'drafts') and dict(post)['drafts'] == '0', [p for p in post if p[1] != 'ok'])
        pre2 = d.all(bare_select(text_of(PRE)))
        ok('apply: the pre-check on the applied database says NOT AS EXPECTED for every replaced function',
           sum(1 for k, v in pre2 if k.startswith('fingerprint') and v.startswith('NOT')) == len(REPLACED) + 3, pre2)
        # a database in use: the lock timeout gives up rather than queueing behind a long transaction
        s = Side(d); s.c.run('begin'); s.c.run('lock table assessment in access share mode')
        t0 = time.time(); r = d.file(UNDO); dt = time.time() - t0
        s.c.run('rollback'); s.close()
        ok('apply: the undo, meeting a transaction that holds assessment, gives up after the 5 s lock timeout with nothing changed',
           r.startswith('STOPPED') and 'lock timeout' in r and 4 < dt < 15 and differences(cat2, catalog(d.c)) == ([], []), (r, dt))
    finally:
        d.close()

def squeeze(t): return re.sub(r'\s+', ' ', t).strip()
def strip_draft(t):
    """A replaced body without what the file adds: its comments, the patch check, every is_draft clause and column."""
    t = re.sub(r'--[^\n]*(2026111701|draft_has_work)[^\n]*', '', t)
    t = re.sub(r"if p_patch \? 'is_draft'.*?end if;", '', t, flags=re.S)
    t = re.sub(r"is_draft\s*=\s*case when p_patch \? 'is_draft'\s*then \(p_patch->>'is_draft'\)::boolean else is_draft end,", '', t)
    t = re.sub(r"not a\.is_draft and \((a\.date_assigned is null or a\.date_assigned <= d\.today)\)", r'\1', t)
    t = re.sub(r"\s*and not (a\.)?is_draft", '', t)
    t = re.sub(r",\s*'is_draft', (asm|a)\.is_draft", '', t)
    t = re.sub(r",\s*is_draft=excluded\.is_draft", '', t)
    t = re.sub(r",\s*coalesce\(case when jsonb_typeof\(_row->'is_draft'\) = 'boolean' then \(_row->>'is_draft'\)::boolean end, false\)", '', t)
    t = re.sub(r",\s*coalesce\(p_is_draft, false\)", '', t)
    t = t.replace(', p_is_draft boolean DEFAULT false', '')
    t = re.sub(r",\s*is_draft\b", '', t)
    return t if 'is_draft' not in t else t + ' LEFT OVER is_draft'

def bare_select(text):
    """A check file's one statement, its comment lines removed."""
    return '\n'.join(l for l in text.splitlines() if not l.startswith('--')).strip().rstrip(';')

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', applied=False); d = w.d
    try:
        cat0 = catalog(d.c); rows0 = row_checksums(d.c)
        page0 = json.dumps(S(d, "student_submit.page(:t, :e, 'ip')", t=w.t1, e=w.e1), sort_keys=True)
        ok('undo: on a database without the file it succeeds and changes nothing',
           d.file(UNDO) == 'ok' and differences(cat0, catalog(d.c)) == ([], []) and row_checksums(d.c) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        x = T(d, "create_assessment(:c, 'Kept Draft', p_is_draft => true)", c=w.c)
        cat1 = catalog(d.c)
        r = d.file(UNDO)
        ok('undo: refuses while a Draft exists, says how many, nothing changed', r.startswith('STOPPED') and '1 assessment(s) are Drafts' in r
           and differences(cat1, catalog(d.c)) == ([], []), r)
        T(d, """update_assessment(:a, '{"is_draft": false}'::jsonb)""", a=x)
        rows_mid = row_checksums(d.c)
        ok('undo: with no Draft it runs', d.file(UNDO) == 'ok')
        gone, new = differences(cat0, catalog(d.c))
        ok('undo: the catalog is as before the file, but one dropped-column slot on assessment',
           [l for l in gone + new if 'public.assessment' not in l or 'dropped' not in l] == [] and len(new) == 1 and 'dropped' in new[0], (gone, new))
        rows2 = row_checksums(d.c)
        ok('undo: every row is as it was just before the undo (the column apart)',
           all(rows2[t] == rows_mid[t] for t in rows_mid if t != 'public.assessment') and rows2['public.assessment'][0] == rows_mid['public.assessment'][0])
        ok('undo: every function has its live md5 again', all(md5(d, s) == header_md5s()[s.split('(')[0]][0] for s in REPLACED)
           and md5(d, OLD_CA) == header_md5s()['old_ca'] and md5(d, NEW_CA) is None and md5(d, GUARD) is None)
        d.run("delete from assessment where id = :a", a=x)
        ok("undo: page answers as before the file, byte for byte", json.dumps(S(d, "student_submit.page(:t, :e, 'ip')", t=w.t1, e=w.e1), sort_keys=True) == page0)
        cat3 = catalog(d.c)
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and differences(cat3, catalog(d.c)) == ([], []))
        ok('undo: the file applies again afterwards', d.file(FILE) == 'ok')
    finally:
        d.close()

SCEN = {'student': scen_student, 'create': scen_create, 'update': scen_update, 'copies': scen_copies, 'rls': scen_rls,
        'race': scen_race, 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCEN)):
        n = len(ccc.passed) + len(ccc.failed)
        try: SCEN[name]()
        except Exception as e:
            import traceback; traceback.print_exc(); ok('%s: ran to the end' % name, False, e)
        print('%-8s %d checks' % (name, len(ccc.passed) + len(ccc.failed) - n), file=sys.stderr)
    finish()
