"""Batch C's suite: 2026111120_markup_reflect_revise.sql (C1) and
2026111121_markup_revise_grade_changes.sql (C2), on a database built as
gradebook-prod will be once Batch B is applied (batch_c_common.build).

    PGDATABASE=<template> BATCH_B_DIR=<Batch B's migrations/> python3 batch_c.py            every scenario
    PGDATABASE=...                                            python3 batch_c.py teacher    only those named

Scenarios: apply1 teacher markup reflect revision group grants race apply2 hide given
"""
import threading, time
from batch_c_common import *

def piece(page, a):
    """One assessment's entry in a page or feedback answer."""
    return next((x for x in page['assessments'] if x['id'] == a), None)
def J(v): return json.loads(v) if isinstance(v, str) else v
def err(d, fn):
    r = refused(d, fn); return r[1] if r else None
def parts(text):
    """batch-c1-undo.sql's three parts: {'1': ..., '1b': ..., '2': ...}."""
    out = {}
    for m in re.finditer(r'-- ── PART (\w+)[^\n]*\n(.*?)(?=-- ── PART |\Z)', text, re.S): out[m.group(1)] = m.group(2)
    return out
def postcheck(d, rel): return d.all(text_at(rel).rstrip().rstrip(';'))
def strings(v):
    """Every string inside a JSON value."""
    if isinstance(v, dict): return [s for x in v.values() for s in strings(x)] + list(v.keys())
    if isinstance(v, list): return [s for x in v for s in strings(x)]
    return [str(v)] if v is not None else []

def scenario_db(tag, with_c1=True, with_c2=False):
    """A copy of the template, with C1 (and C2) applied by the files themselves."""
    d = CDb(tag)
    if with_c1:
        r = d.apply1(); assert r == 'ok', r
    if with_c2:
        r = d.apply2(); assert r == 'ok', r
    return d

def busy(d, k):
    """Some life in the class before an apply: a phone signed in, work sent, a grade returned, a draft."""
    t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
    sub, files = d.send(t1, ENR1, k['lab'], 2, note='my note')
    d.score(ENR1, k['lab'], 7)
    d.return_work_plain = d.rpc('return_grades(:a, :e, :k)', a=k['lab'], e=[ENR1], k=nid())
    d.score(ENR2, k['lab'], 5)
    return t1, t2, sub, files

# ── apply1: C1 meets a database in use ─────────────────────────────────────
def apply1():
    d = CDb('apply1')
    try:
        k = seed(d, reflect=False); t1, t2, sub, files = busy(d, k)
        before = catalog(d.c); cols = table_columns(d.c); rows = row_checksums(d.c, cols)
        page_before = d.page(t1, ENR1)
        # the guards: each stops the file with nothing changed
        for name, sql, undo in [
            ('Batch B missing', 'alter table public.submission_file rename to submission_file_x', 'alter table public.submission_file_x rename to submission_file'),
            ('a relied-on Batch B function changed', "create or replace function public._work_hold() returns interval language sql stable set search_path to 'public', 'pg_temp' as $f$ select interval '3 hours'; $f$", None),
            ('a relied-on Batch A function changed', "create or replace function public._grade_return_holds(p_enrollment_id uuid) returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $f$ select true; $f$", None),
            ('a name taken', "create function public.save_markup(p_file_id uuid, p_marks jsonb, p_base_rev integer, p_idempotency_key uuid) returns jsonb language sql as $f$ select null::jsonb $f$", 'drop function public.save_markup(uuid, jsonb, integer, uuid)'),
            ('a column taken', 'alter table public.course add column show_my_learning boolean', 'alter table public.course drop column show_my_learning'),
            ('a trigger name taken', "create trigger work_feedback_gone after delete on public.enrollment for each row execute function public._submission_gone()", 'drop trigger work_feedback_gone on public.enrollment'),
        ]:
            snap = d.one('select md5(pg_get_functiondef(%s))' % ("'public._work_hold()'::regprocedure" if 'Batch B function' in name else "'public._grade_return_holds(uuid)'::regprocedure"))
            d.begin(); d.run(sql)
            mid = catalog(d.c)
            r = d.statements(split(text_at(C1_USED)))   # rolls back on a stop
            d.in_tx = False
            ok('apply1: the guard stops on ' + name, r.startswith('STOPPED') and d.at == 2, r)
            ok('apply1: nothing changed after the stop on ' + name, catalog(d.c) == before, differences(before, catalog(d.c))[1][:3])
        # the pre-check, on this database: clean
        ok('apply1: the pre-check is clean before the apply', postcheck(d, 'batch-c1-live-precheck.sql') == [], postcheck(d, 'batch-c1-live-precheck.sql'))
        # it notices a changed function
        d.begin(); d.run("create or replace function public._work_hold() returns interval language sql stable set search_path to 'public', 'pg_temp' as $f$ select interval '2 hours' ; $f$")
        ok('apply1: the pre-check notices a changed function', any('_work_hold' in str(r) for r in postcheck(d, 'batch-c1-live-precheck.sql')))
        d.rollback()
        # the apply
        r = d.apply1(); ok('apply1: the file applies', r == 'ok', r)
        after = catalog(d.c)
        gone, new = differences(before, after)
        # nothing that existed is changed: the only lines gone are counts that grew
        allowed_gone = [l for l in gone if not (l.startswith('depends ') or l.startswith('comments on ') or l.startswith('internal triggers submission_file '))]
        ok('apply1: no existing catalog line changes (functions, triggers, policies, grants, columns, constraints)', allowed_gone == [], allowed_gone[:5])
        ok('apply1: every existing function keeps its fingerprint',
           [l for l in before if l.startswith('function ')] == [l for l in after if l.startswith('function ') and any(l.split(' | ')[0] == b.split(' | ')[0] for b in before if b.startswith('function '))])
        newfns = sorted(l.split(' ')[1].split(' |')[0] for l in new if l.startswith('function ') and not l.startswith('function more'))
        ok('apply1: exactly the %d functions of C1 are new' % len(C1_FUNCTIONS), len(newfns) == len(C1_FUNCTIONS), (len(newfns), newfns[:3]))
        ok('apply1: no row of any existing table changes in any column it had', row_checksums(d.c, cols) == rows,
           [t for t in rows if row_checksums(d.c, {t: cols[t]})[t] != rows[t]])
        ok('apply1: the phone\'s page is as before', d.page(t1, ENR1) == page_before)
        ok('apply1: both switches are off for every class', d.one('select count(*) from course where reflect_on_feedback or show_my_learning') == 0)
        ok('apply1: the post-check is clean', postcheck(d, 'batch-c1-live-postcheck.sql') == [], postcheck(d, 'batch-c1-live-postcheck.sql'))
        # the post-check notices damage
        for name, sql in [('anon granted', 'grant execute on function public.save_markup(uuid, jsonb, integer, uuid) to anon'),
                          ('row security off', 'alter table public.markup disable row level security'),
                          ('a student function for teachers', 'grant execute on function student_submit.reflect(text, uuid, uuid, jsonb, text) to authenticated'),
                          ('a table readable', 'grant select on public.feedback_reflection to authenticated'),
                          ('a trigger off', 'alter table public.enrollment disable trigger work_feedback_gone'),
                          ('a helper granted', 'grant execute on function public._markup_give(uuid, uuid) to service_role'),
                          ('a function changed', "create or replace function public._revision_hide_available() returns boolean language sql immutable set search_path to 'public', 'pg_temp' as $f$ select true; $f$")]:
            d.begin(); d.run(sql)
            ok('apply1: the post-check notices ' + name, postcheck(d, 'batch-c1-live-postcheck.sql') != [])
            d.rollback()
        # a second run changes nothing
        cat1 = catalog(d.c); rows1 = row_checksums(d.c)
        d.save_markup(files[0], marks('x'))
        cat1 = catalog(d.c); rows1 = row_checksums(d.c)
        r = d.apply1(); ok('apply1: a second run applies', r == 'ok', r)
        ok('apply1: a second run changes no catalog line', catalog(d.c) == cat1, differences(cat1, catalog(d.c)))
        ok('apply1: a second run changes no row', row_checksums(d.c) == rows1)
        # a second run after one of its functions was replaced by something else stops
        d.begin(); d.run("create or replace function public._markup_check(p_marks jsonb) returns void language plpgsql immutable set search_path to 'public', 'pg_temp' as $f$ begin null; end; $f$")
        r = d.statements(split(text_at(C1_USED))); d.in_tx = False
        ok('apply1: a second run after a function was replaced stops', r.startswith('STOPPED') and 'Do not run this file again' in r, r)
        # one transaction, a lock timeout, the guard first
        sts = split(text_at(C1_USED))
        ok('apply1: the file is one transaction with a lock timeout and its guard first',
           bare(sts[0]).endswith('begin') and 'lock_timeout' in sts[1] and sts[2].startswith('do $guard$') and bare(sts[-1]) == 'commit')
        # the file never changes an existing object by name
        body = bare(text_at(C1_USED)).lower()
        ok('apply1: the file replaces no existing function (every create or replace names a new one)',
           all(fn.split('(')[0].lower() in [f.split('(')[0].lower() for f in C1_FUNCTIONS]
               for fn in re.findall(r'create or replace function ([\w.]+)\(', body)))
        top = [bare(x).lower() for x in split(text_at(C1_USED))]
        ok('apply1: no statement of the file writes a row (only its functions, when called, do)',
           not [x for x in top if re.match(r'(update|delete|insert|truncate|merge)\b', x)], [x[:60] for x in top if re.match(r'(update|delete|insert)', x)])
        # it waits on a reader of course and gives up with nothing applied
        d2 = CDb('apply1_lock')
        try:
            o = d2.other(); o.run('begin'); o.run('select 1 from course limit 1')
            t0 = time.time(); r = d2.apply1(); dt = time.time() - t0
            ok('apply1: a transaction reading course: it gives up at five seconds', r.startswith('STOPPED') and 4 <= dt < 15, (r, dt))
            o.run('rollback'); o.close()
            ok('apply1: and nothing was applied', d2.one("select to_regclass('public.markup') is null"))
        finally:
            d2.close()
    finally:
        d.close()

# ── teacher: the teacher's RPCs ────────────────────────────────────────────
def teacher():
    d = scenario_db('teacher')
    try:
        k = seed(d); t1 = d.session(ENR1)
        sub, files = d.send(t1, ENR1, k['lab'], 2)
        # set_course_feedback_options
        r = d.rpc('set_course_feedback_options(:c, :p::jsonb, :k)', c=COURSE_A, p='{"show_my_learning": true}', k=nid())
        ok('teacher: a patch writes only what it names', r == {'reflect_on_feedback': True, 'show_my_learning': True}, r)
        key = nid()
        r = d.rpc('set_course_feedback_options(:c, :p::jsonb, :k)', c=COURSE_A, p='{"reflect_on_feedback": false}', k=key)
        d.run('update course set reflect_on_feedback = true where id = :c', c=COURSE_A)
        r2 = d.rpc('set_course_feedback_options(:c, :p::jsonb, :k)', c=COURSE_A, p='{"reflect_on_feedback": false}', k=key)
        ok('teacher: a replay answers the first answer and writes nothing', r2 == r and d.one('select reflect_on_feedback from course where id = :c', c=COURSE_A))
        for name, p in [('an unknown key', '{"x": true}'), ('a string', '{"show_my_learning": "yes"}'), ('a list', '[]'), ('null', 'null')]:
            ok('teacher: settings refuse ' + name, err(d, lambda: d.rpc('set_course_feedback_options(:c, :p::jsonb, :k)', c=COURSE_A, p=p, k=nid())) == '22023')
        ok('teacher: settings: another teacher\'s class', err(d, lambda: d.rpc('set_course_feedback_options(:c, :p::jsonb, :k)', B, c=COURSE_A, p='{}', k=nid())) == 'P0002')
        ok('teacher: settings: nobody signed in', err(d, lambda: d.rpc('set_course_feedback_options(:c, :p::jsonb, :k)', '', c=COURSE_A, p='{}', k=nid())) == 'PT401')
        # save_markup
        r = d.save_markup(files[0], marks('Is this a reason?'), 0)
        ok('teacher: save_markup saves the first rev', r['result'] == 'saved' and r['rev'] == 1 and r['given'] is False, r)
        key = nid()
        r = d.save_markup(files[0], marks('Is this a reason?', 'Where is the third?'), 1, key=key)
        r2 = d.save_markup(files[0], marks('Something else'), 1, key=key)
        ok('teacher: save_markup replay answers the first and writes nothing', r2 == r and r['rev'] == 2 and
           d.one("select working->'marks'->1->>'text' from markup where file_id = :f", f=files[0]) == 'Where is the third?')
        r = d.save_markup(files[0], marks('stale'), 1)
        ok('teacher: save_markup from a stale screen answers changed with what is there', r['result'] == 'changed' and r['rev'] == 2
           and len(r['marks']['marks']) == 2, r)
        ok('teacher: a stale save changed nothing', d.one('select working_rev from markup where file_id = :f', f=files[0]) == 2)
        r = d.save_markup(files[0], marks('no check'), None)
        ok('teacher: save_markup without a base rev saves', r['result'] == 'saved' and r['rev'] == 3)
        bad = [('not an object', '[]'), ('no marks list', '{"v": 1}'), ('a mark of no type', '{"marks": [{"x": 1}]}'),
               ('an unknown type', '{"marks": [{"type": "eraser"}]}'), ('a note with no text', '{"marks": [{"type": "note"}]}'),
               ('a blank note', '{"marks": [{"type": "note", "text": "  "}]}'),
               ('a note of 501 characters', json.dumps({'marks': [{'type': 'note', 'text': 'x' * 501}]})),
               ('501 marks', json.dumps({'marks': [{'type': 'tick'}] * 501})),
               ('over 256 KB', json.dumps({'marks': [{'type': 'pen', 'points': [0.123456789] * 30000}]})),
               ('a mark that is a string', '{"marks": ["pen"]}')]
        for name, m in bad:
            ok('teacher: save_markup refuses ' + name, err(d, lambda: d.rpc('save_markup(:f, :m::jsonb, null, :k)', f=files[0], m=m, k=nid())) == '22023')
        ok('teacher: save_markup refuses a negative base rev', err(d, lambda: d.save_markup(files[0], marks(), -1)) == '22023')
        ok('teacher: save_markup: another teacher\'s page', err(d, lambda: d.save_markup(files[0], marks(), None, uid=B)) == 'P0002')
        ok('teacher: save_markup: nobody signed in', err(d, lambda: d.save_markup(files[0], marks(), None, uid='')) == 'PT401')
        ok('teacher: save_markup: no such page', err(d, lambda: d.save_markup(nid(), marks(), None)) == 'P0002')
        # a page of a send that is not finished is not the teacher's to mark
        s = d.service("student_submit.send_start(:t, :e, :a, :p::jsonb, null, null, :r, 'ip-1')", t=d.session(ENR2, '2012-06-16'), e=ENR2,
                      a=k['lab'], p='[{"width": 10, "height": 10}]', r=nid())
        ok('teacher: save_markup refuses a page of a send not handed in', err(d, lambda: d.save_markup(s['files'][0]['file_id'], marks(), None)) == 'P0002')
        # in a class that holds grades, marks wait
        ok('teacher: in a class that holds grades, saved marks are not given', d.one('select given from markup where file_id = :f', f=files[0]) is None)
        # list_assessment_markup
        L = d.rpc('list_assessment_markup(:a)', a=k['lab'])
        ok('teacher: list_assessment_markup lists the page with both copies', len(L) == 1 and L[0]['rev'] == 3 and L[0]['given'] is None and L[0]['waiting'], L)
        ok('teacher: list_assessment_markup: another teacher', err(d, lambda: d.rpc('list_assessment_markup(:a)', B, a=k['lab'])) == 'P0002')
        # return_work: grades and marks
        d.score(ENR1, k['lab'], 8)
        key = nid()
        r = d.return_work(k['lab'], [ENR1, ENR2, ENR_B], key=key)
        ok('teacher: return_work returns the draft', r['returned'] == 1 and r['enrollment_ids'] == [ENR1], r)
        ok('teacher: return_work gives the marks', r['marks_given'] == 1 and r['marks_enrollment_ids'] == [ENR1], r)
        ok('teacher: the student\'s copy is the working copy', d.one("select given = working and given_rev = working_rev from markup where file_id = :f", f=files[0]))
        r2 = d.return_work(k['lab'], [ENR1], key=key)
        ok('teacher: return_work replay answers the same', r2 == r)
        r3 = d.return_work(k['lab'], [ENR1])
        ok('teacher: return_work with nothing waiting gives nothing', r3['returned'] == 0 and r3['marks_given'] == 0, r3)
        ok('teacher: return_work: another teacher\'s assessment', err(d, lambda: d.return_work(k['lab'], [ENR1], uid=B)) == 'P0002')
        ok('teacher: return_work: nobody', err(d, lambda: d.return_work(k['lab'], [ENR1], uid='')) == 'PT401')
        ok('teacher: return_work leaves a student of another class alone', d.one('select count(*) from markup where enrollment_id = :e', e=ENR_B) == 0)
        # marks changed after a return wait again; a mark only, with the grade not a draft
        d.save_markup(files[1], marks('page two'))
        L = {x['file_id']: x for x in d.rpc('list_course_feedback(:c)', c=COURSE_A)['markup']}
        ok('teacher: list_course_feedback says which pages wait', L[files[1]]['waiting'] and not L[files[0]]['waiting'])
        r = d.return_work(k['lab'], [ENR1])
        ok('teacher: return_work gives marks on a piece whose grade is not a draft', r['returned'] == 0 and r['marks_given'] == 1, r)
        # an erased mark is gone before the return
        d.save_markup(files[0], marks('keep', 'erase me'))
        d.save_markup(files[0], marks('keep'))
        d.return_work(k['lab'], [ENR1])
        ok('teacher: a mark erased before Return is never given', 'erase me' not in json.dumps(d.marks(t1, ENR1, k['lab'])))
        # As Soon As I Save: marks are given at once
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        r = d.save_markup(files[0], marks('now'))
        ok('teacher: in a class that returns at once, marks are given at once', r['given'] is True and
           'now' in json.dumps(d.marks(t1, ENR1, k['lab'])), r)
        d.run("update course set return_grades = 'on_return', student_page_enabled = false where id = :c", c=COURSE_A)
        r = d.save_markup(files[0], marks('page off'))
        ok('teacher: with the Student Page off, marks are given at once (as a save is returned)', r['given'] is True)
        d.run("update course set student_page_enabled = true where id = :c", c=COURSE_A)
        # anon cannot reach any of it
        for fn in C1_PUBLIC_RPCS:
            ok('teacher: anon cannot run ' + fn, not d.one("select has_function_privilege('anon', to_regprocedure(:f), 'execute')", f=fn))
        # nothing here wrote a score row
        ok('teacher: save_markup writes no score row', d.one("select count(*) from score where enrollment_id = :e and assessment_id = :a", e=ENR1, a=k['lab']) == 1)
        # an assessment deleted: its marks go with its pages
        d.run('delete from assessment where id = :a', a=k['lab'])
        ok('teacher: deleting an assessment takes its marks', d.one('select count(*) from markup') == 0)
    finally:
        d.close()

# ── markup: what a student sees of marks ───────────────────────────────────
def markup():
    d = scenario_db('markup')
    try:
        k = seed(d); t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
        sub, files = d.send(t1, ENR1, k['lab'], 2)
        sub2, files2 = d.send(t2, ENR2, k['lab'], 1)
        d.save_markup(files[0], marks('SECRET-DRAFT-NOTE', pen=2))
        d.score(ENR1, k['lab'], 6)
        ok('markup: before Return the student is given no marks', d.marks(t1, ENR1, k['lab'])['files'] == [])
        f = d.feedback(t1, ENR1)
        ok('markup: before Return the page says nothing of marks', f['ok'] and f['assessments'] == [], f)
        ok('markup: the working copy is in no student answer', 'SECRET-DRAFT-NOTE' not in json.dumps([d.page(t1, ENR1), d.feedback(t1, ENR1),
           d.marks(t1, ENR1, k['lab']), d.service("student_submit.work(:t, :e, 'ip-1')", t=t1, e=ENR1)]))
        d.return_work(k['lab'], [ENR1])
        m = d.marks(t1, ENR1, k['lab'])
        ok('markup: after Return the student has the marks on their page', len(m['files']) == 1 and m['files'][0]['file_id'] == files[0]
           and m['files'][0]['marks']['marks'][0]['text'] == 'SECRET-DRAFT-NOTE', m)
        f = d.feedback(t1, ENR1)['assessments']
        ok('markup: feedback counts the pages and notes', f[0]['id'] == k['lab'] and f[0]['marks'] == {'pages': 1, 'notes': 1}, f)
        # a draft change of marks is not given
        d.save_markup(files[0], marks('NEWER-DRAFT'))
        ok('markup: a later change waits', 'NEWER-DRAFT' not in json.dumps(d.marks(t1, ENR1, k['lab'])))
        # another student sees nothing of them
        ok('markup: another student is given none of them', d.marks(t2, ENR2, k['lab'])['files'] == [] and d.feedback(t2, ENR2)['assessments'] == [])
        ok('markup: a student cannot ask for marks with another student\'s enrollment', d.marks(t2, ENR1, k['lab']) == {'ok': False, 'error': 'not_found'})
        ok('markup: another class\'s assessment', d.marks(t1, ENR1, k['b_lab']) == {'ok': False, 'error': 'not_found'})
        ok('markup: no session', d.marks('0' * 64, ENR1, k['lab'])['error'] == 'signed_out')
        ok('markup: a wrong shape raises', err(d, lambda: d.marks(t1, ENR1, None)) == '22023')
        # Students See Your Mark Up off
        d.run('update assessment set students_see_markup = false where id = :a', a=k['lab'])
        ok('markup: with Students See Your Mark Up off, none', d.marks(t1, ENR1, k['lab'])['files'] == [] and d.feedback(t1, ENR1)['assessments'] == [])
        d.run('update assessment set students_see_markup = true where id = :a', a=k['lab'])
        # Missing hides them
        d.run("update score set status = 'NS' where enrollment_id = :e and assessment_id = :a", e=ENR1, a=k['lab'])
        ok('markup: Missing on the piece hides the marks', d.marks(t1, ENR1, k['lab'])['files'] == [])
        d.run("update score set status = null where enrollment_id = :e and assessment_id = :a", e=ENR1, a=k['lab'])
        # the Student Page off: the session refuses
        d.run('update course set student_page_enabled = false where id = :c', c=COURSE_A)
        ok('markup: Student Page off', d.marks(t1, ENR1, k['lab'])['error'] in ('closed', 'not_found', 'signed_out'))
        d.run('update course set student_page_enabled = true where id = :c', c=COURSE_A)
        # the photo is never touched
        ok('markup: the stored page is unchanged by marks', d.one('select sha256 from submission_file where id = :f', f=files[0]) == HASH)
        # Unsend takes the marks (and the student cannot unsend once graded anyway)
        d.save_markup(files2[0], marks('on two'))
        ok('markup: marks on unsent work', d.one('select count(*) from markup where file_id = :f', f=files2[0]) == 1)
        r = d.service("student_submit.unsend(:t, :e, :a, 'ip-1')", t=t2, e=ENR2, a=k['lab'])
        ok('markup: Unsend before grading takes the page and its marks', r.get('unsent') and d.one('select count(*) from markup where file_id = :f', f=files2[0]) == 0, r)
        # a student deleted: marks go
        d.run('delete from enrollment where id = :e', e=ENR1)
        ok('markup: deleting a student takes their marks', d.one('select count(*) from markup') == 0)
    finally:
        d.close()

# ── reflect: Reflect on Feedback ───────────────────────────────────────────
def reflect():
    d = scenario_db('reflect')
    try:
        k = seed(d); t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
        yes = {'makes_sense': 'yes', 'plan': 'Find all three reasons first.', 'went_well': 'My voice.'}
        d.score(ENR1, k['lab'], 6)
        ok('reflect: on a draft (never returned) it is refused', d.reflect(t1, ENR1, k['lab'], yes) == {'ok': False, 'error': 'not_returned'})
        ok('reflect: on a piece with no grade', d.reflect(t1, ENR1, k['rub'], yes) == {'ok': False, 'error': 'not_returned'})
        d.return_work(k['lab'], [ENR1])
        d.run('update course set reflect_on_feedback = false where id = :c', c=COURSE_A)
        ok('reflect: Reflect on Feedback off', d.reflect(t1, ENR1, k['lab'], yes) == {'ok': False, 'error': 'reflect_off'})
        d.run('update course set reflect_on_feedback = true where id = :c', c=COURSE_A)
        ok('reflect: another student\'s enrollment', d.reflect(t2, ENR1, k['lab'], yes)['error'] == 'not_found')
        ok('reflect: another class\'s assessment', d.reflect(t1, ENR1, k['b_lab'], yes)['error'] == 'not_found')
        d.run("update assessment set date_assigned = current_date + 30 where id = :a", a=k['rub'])
        ok('reflect: an assessment not yet on the page', d.reflect(t1, ENR1, k['rub'], yes)['error'] == 'not_found')
        ok('reflect: no session', d.reflect('f' * 64, ENR1, k['lab'], yes)['error'] == 'signed_out')
        d.run("update student_card set locked_at = now() where enrollment_id = :e and stopped_at is null", e=ENR1)
        ok('reflect: a locked card', d.reflect(t1, ENR1, k['lab'], yes)['error'] == 'card_locked')
        d.run("update student_card set locked_at = null where enrollment_id = :e", e=ENR1)
        for name, r in [('no makes_sense', {'plan': 'x'}), ('a wrong makes_sense', {'makes_sense': 'maybe', 'plan': 'x'}),
                        ('yes with no plan', {'makes_sense': 'yes'}), ('not sure with no question', {'makes_sense': 'not_sure'}),
                        ('an unknown field', {'makes_sense': 'yes', 'plan': 'x', 'grade': 4}),
                        ('a plan that is a number', {'makes_sense': 'yes', 'plan': 4}),
                        ('a plan of 1001', {'makes_sense': 'yes', 'plan': 'x' * 1001}), ('a list', [])]:
            ok('reflect: refuses ' + name, err(d, lambda: d.reflect(t1, ENR1, k['lab'], r)) == '22023')
        ok('reflect: no assessment raises', err(d, lambda: d.reflect(t1, ENR1, None, yes)) == '22023')
        r = d.reflect(t1, ENR1, k['lab'], yes)
        ok('reflect: yes with a plan is taken', r['ok'] and r['reflection']['plan'] == yes['plan'], r)
        at = r['reflection']['sent_at']
        r2 = d.reflect(t1, ENR1, k['lab'], yes)
        ok('reflect: the same reflection twice is the same reflection', r2 == r and d.one('select count(*) from feedback_reflection') == 1)
        unsure = {'makes_sense': 'not_sure', 'question': 'What counts as a reason?'}
        r = d.reflect(t1, ENR1, k['lab'], unsure)
        ok('reflect: sent again before an answer, it takes the place of the first', r['ok'] and r['reflection']['question'] == unsure['question']
           and r['reflection']['plan'] is None and d.one('select count(*) from feedback_reflection') == 1)
        L = d.rpc('list_course_feedback(:c)', c=COURSE_A)['reflections']
        ok('teacher: the question is waiting', len(L) == 1 and L[0]['waiting'] and L[0]['question'] == unsure['question'], L)
        ok('reflect: the student does not see an answer before one is sent', piece(d.feedback(t1, ENR1), k['lab'])['reflection']['answer'] is None)
        rid = L[0]['id']
        ok('teacher: answer: another teacher', err(d, lambda: d.rpc('answer_reflection(:r, :a, :k)', B, r=rid, a='x', k=nid())) == 'P0002')
        ok('teacher: answer: blank', err(d, lambda: d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='  ', k=nid())) == '22023')
        ok('teacher: answer: 2001 characters', err(d, lambda: d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='x' * 2001, k=nid())) == '22023')
        ok('teacher: answer: no such reflection', err(d, lambda: d.rpc('answer_reflection(:r, :a, :k)', r=nid(), a='x', k=nid())) == 'P0002')
        key = nid()
        a1 = d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='A reason says why.', k=key)
        a2 = d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='Something else.', k=key)
        ok('teacher: Send Answer answers the question, once, and a replay is the same', a1['result'] == 'answered' and a2 == a1
           and not a1['reflection']['waiting'], a1)
        ok('teacher: answering clears the waiting mark', not d.rpc('list_course_feedback(:c)', c=COURSE_A)['reflections'][0]['waiting'])
        f = piece(d.feedback(t1, ENR1), k['lab'])['reflection']
        ok('reflect: Your Teacher Answered', f['answer'] == 'A reason says why.' and f['answered_at'] is not None, f)
        ok('reflect: once answered it cannot change', d.reflect(t1, ENR1, k['lab'], yes) == {'ok': False, 'error': 'already_answered'})
        ok('teacher: a second answer with nothing waiting', d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='again', k=nid())['result'] == 'already_answered')
        # reply
        ok('reply: a wrong shape', err(d, lambda: d.reply(t1, ENR1, k['lab'], {'sense_now': 'kind of'})) == '22023')
        ok('reply: a follow-up with yes', err(d, lambda: d.reply(t1, ENR1, k['lab'], {'sense_now': 'yes', 'follow_up': 'x'})) == '22023')
        ok('reply: an unknown field', err(d, lambda: d.reply(t1, ENR1, k['lab'], {'sense_now': 'yes', 'x': 1})) == '22023')
        ok('reply: a piece with no reflection', d.reply(t1, ENR1, k['rub'], {'sense_now': 'yes'})['error'] == 'not_found')
        ok('reply: another student', d.reply(t2, ENR1, k['lab'], {'sense_now': 'yes'})['error'] == 'not_found')
        r = d.reply(t1, ENR1, k['lab'], {'sense_now': 'not_sure', 'follow_up': 'Can you show me one?'})
        ok('reply: Not Sure with one more question', r['ok'] and r['reflection']['follow_up'] == 'Can you show me one?', r)
        ok('reply: the same reply again is the same', d.reply(t1, ENR1, k['lab'], {'sense_now': 'not_sure', 'follow_up': 'Can you show me one?'})['ok'])
        ok('reply: a second, different follow-up', d.reply(t1, ENR1, k['lab'], {'sense_now': 'not_sure', 'follow_up': 'Another?'})['error'] == 'already_asked')
        ok('teacher: the follow-up is waiting', d.rpc('list_course_feedback(:c)', c=COURSE_A)['reflections'][0]['waiting'])
        a = d.rpc('answer_reflection(:r, :a, :k)', r=rid, a='Look at paragraph two.', k=nid())
        ok('teacher: Send Answer answers the follow-up', a['result'] == 'answered' and a['reflection']['follow_up_answer'] == 'Look at paragraph two.')
        ok('reply: yes, it makes sense now', d.reply(t1, ENR1, k['lab'], {'sense_now': 'yes'})['reflection']['sense_now'] == 'yes')
        # reply before an answer
        d.score(ENR2, k['lab'], 4); d.return_work(k['lab'], [ENR2])
        d.reflect(t2, ENR2, k['lab'], yes)
        ok('reply: before the teacher answered', d.reply(t2, ENR2, k['lab'], {'sense_now': 'yes'})['error'] == 'not_answered')
        # the plan reaches the next assignment
        f = d.feedback(t2, ENR2)
        ok('reflect: Your Plan From Last Time is the student\'s own last plan', f['last_plan']['plan'] == yes['plan'] and f['last_plan']['assessment_id'] == k['lab'])
        ok('reflect: one student never sees another\'s reflection', 'What counts' not in json.dumps(d.feedback(t2, ENR2)))
        # a withdrawn student
        d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR2)
        ok('reflect: a withdrawn student', d.reflect(t2, ENR2, k['lab'], yes)['ok'] is False)
        # nothing here touched a grade
        fp = fingerprint_rows(d)
        d.reflect(t1, ENR1, k['lab'], yes); d.reply(t1, ENR1, k['lab'], {'sense_now': 'yes'}); d.feedback(t1, ENR1)
        ok('reflect: the student\'s calls change no grade row', fingerprint_rows(d) == fp)
        d.run('delete from assessment where id = :a', a=k['lab'])
        ok('reflect: deleting an assessment takes its reflections', d.one('select count(*) from feedback_reflection') == 0)
    finally:
        d.close()

# ── revision: Return for Revision and the student's revision ──────────────
def revision():
    d = scenario_db('revision')
    try:
        k = seed(d); t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
        sub, files = d.send(t1, ENR1, k['lab'], 2)
        d.score(ENR1, k['lab'], 6)
        req = {'what_to_fix': 'Add a third reason.', 'revise_by': '2026-12-01', 'keep_grade': True}
        # refusals
        ok('revision: another teacher', err(d, lambda: d.rfr(k['lab'], ENR1, req, uid=B)) == 'P0002')
        ok('revision: a student of another class', err(d, lambda: d.rfr(k['lab'], ENR_B, req)) == 'P0002')
        ok('revision: nobody', err(d, lambda: d.rfr(k['lab'], ENR1, req, uid='')) == 'PT401')
        for name, r in [('no what_to_fix', {'keep_grade': True}), ('a blank what_to_fix', {'what_to_fix': ' '}),
                        ('2001 characters', {'what_to_fix': 'x' * 2001}), ('a bad date', {'what_to_fix': 'x', 'revise_by': 'soon'}),
                        ('an unknown field', {'what_to_fix': 'x', 'grade': 3}), ('keep_grade text', {'what_to_fix': 'x', 'keep_grade': 'yes'}),
                        ('criteria not a list', {'what_to_fix': 'x', 'criterion_ids': 'all'}),
                        ('a criterion that is not an id', {'what_to_fix': 'x', 'criterion_ids': ['plan']}),
                        ('a criterion of another rubric', {'what_to_fix': 'x', 'criterion_ids': [k['other_crit']]}),
                        ('a criterion on work with no rubric', {'what_to_fix': 'x', 'criterion_ids': [k['crit1']]}), ('a list', [])]:
            ok('revision: refuses ' + name, err(d, lambda: d.rfr(k['lab'], ENR1, r)) == '22023')
        ok('revision: DIBELS is not revised', d.rfr(k['dib'], ENR1, req)['result'] == 'not_for_dibels')
        ok('revision: Hide needs the second file', d.rfr(k['lab'], ENR1, dict(req, keep_grade=False))['result'] == 'hide_not_available')
        ok('revision: a refusal writes nothing', d.one('select count(*) from revision_request') == 0 and
           d.one('select is_draft from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=k['lab']))
        d.save_markup(files[0], marks('Where is the third reason?'))
        key = nid()
        r = d.rfr(k['lab'], ENR1, req, key=key)
        ok('revision: made, and the work is returned with it', r['result'] == 'made' and r['returned']['returned'] == 1
           and r['returned']['marks_given'] == 1, r)
        rq = r['request']
        ok('revision: the request keeps the first version and its grade', rq['first_version'] == 1 and rq['first_submission_id'] == sub
           and rq['first_grade']['value'] == 6 and rq['state'] == 'open' and rq['first_returned_at'] is not None, rq)
        ok('revision: a replay answers the same and makes one request', d.rfr(k['lab'], ENR1, req, key=key) == r
           and d.one('select count(*) from revision_request') == 1)
        ok('revision: a second request while one is open', d.rfr(k['lab'], ENR1, req)['result'] == 'already_open')
        f = piece(d.feedback(t1, ENR1), k['lab'])['revision']
        ok('revision: the student sees Needs Revision with what to fix and the first grade', f['state'] == 'open' and f['what_to_fix'] == req['what_to_fix']
           and f['first_grade']['value'] == 6 and f['revise_by'] == '2026-12-01', f)
        ok('revision: the student is given their grade (Keep)', piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 6)
        # set_revision_request
        rid = rq['id']
        s = d.rpc('set_revision_request(:r, :p::jsonb, :k)', r=rid, p='{"revise_by": "2026-12-05"}', k=nid())
        ok('revision: Revise By changed', s['result'] == 'saved' and s['request']['revise_by'] == '2026-12-05' and s['request']['what_to_fix'] == req['what_to_fix'])
        ok('revision: set: a criterion off the rubric', err(d, lambda: d.rpc('set_revision_request(:r, :p::jsonb, :k)', r=rid, p=json.dumps({'criterion_ids': [k['crit1']]}), k=nid())) == '22023')
        ok('revision: set: another teacher', err(d, lambda: d.rpc('set_revision_request(:r, :p::jsonb, :k)', B, r=rid, p='{}', k=nid())) == 'P0002')
        ok('revision: set: keep_grade is not changed here', err(d, lambda: d.rpc('set_revision_request(:r, :p::jsonb, :k)', r=rid, p='{"keep_grade": false}', k=nid())) == '22023')
        # the student's revision
        ok('revision: another student cannot send it', d.rev_start(t2, ENR2, k['lab'])['error'] == 'no_revision')
        ok('revision: not with another student\'s enrollment', d.rev_start(t2, ENR1, k['lab'])['error'] == 'not_found')
        ok('revision: a wrong shape raises', err(d, lambda: d.rev_start(t1, ENR1, k['lab'], 0)) == '22023')
        ok('revision: no request id raises', err(d, lambda: d.service("student_submit.revision_start(:t, :e, :a, '[{}]'::jsonb, null, null, 'ip-1')", t=t1, e=ENR1, a=k['lab'])) == '22023')
        ok('revision: Batch B\'s send_start still refuses a second send', d.service("student_submit.send_start(:t, :e, :a, '[{}]'::jsonb, null, null, :r, 'ip-1')",
                                                                                   t=t1, e=ENR1, a=k['lab'], r=nid())['error'] == 'already_sent')
        rqid = nid()
        s = d.rev_start(t1, ENR1, k['lab'], 1, 'I added the third reason.', request=rqid)
        ok('revision: revision_start names the paths for version 2', s['ok'] and s['version'] == 2 and len(s['files']) == 1, s)
        ok('revision: the same request again', d.rev_start(t1, ENR1, k['lab'], 1, request=rqid)['replayed'] is True)
        f = d.rev_finish(t1, ENR1, s['submission_id'], s['files'])
        ok('revision: nothing is handed in until the page is up', f['error'] == 'missing_pages', f)
        d.upload(s['files'])
        ok('revision: Batch B\'s send_finish will not hand it in as a first send', d.service("student_submit.send_finish(:t, :e, :s, :f::jsonb, 'ip-1')", t=t1, e=ENR1,
           s=s['submission_id'], f=json.dumps([{'file_id': s['files'][0]['file_id'], 'sha256': HASH}]))['error'] == 'already_sent')
        s, f = d.revise(t1, ENR1, k['lab'], 1, 'I added the third reason.')
        ok('revision: handed in as version 2', f['ok'] and f['version'] == 2, f)
        ok('revision: the finish again is a replay', d.rev_finish(t1, ENR1, s['submission_id'], s['files'])['replayed'] is True)
        ok('revision: another student cannot finish it', d.rev_finish(t2, ENR2, s['submission_id'], s['files'])['error'] == 'not_found')
        v1 = d.one('select count(*) from submission where assessment_id = :a and enrollment_id = :e and state = :s and version = 1', a=k['lab'], e=ENR1, s='sent')
        ok('revision: version 1 stays, with its pages', v1 == 1 and d.one('select count(*) from submission_file where submission_id = :s', s=sub) == 2)
        st = piece(d.feedback(t1, ENR1), k['lab'])['revision']
        ok('revision: the student sees it sent, with their note', st['state'] == 'sent' and st['revision_version'] == 2 and st['revision_note'] == 'I added the third reason.', st)
        links = d.service("student_submit.file_links(:t, :e, :a, 'ip-1')", t=t1, e=ENR1, a=k['lab'])['files']
        ok('revision: Batch B\'s file_links lists both versions', sorted({x['version'] for x in links}) == [1, 2])
        ok('revision: Batch B\'s unsend will not take the revision (the first grade was returned)',
           d.service("student_submit.unsend(:t, :e, :a, 'ip-1')", t=t1, e=ENR1, a=k['lab'])['error'] == 'grading_started')
        # Replace My Revision before grading
        s2, f2 = d.revise(t1, ENR1, k['lab'], 2, 'Better.')
        ok('revision: sent again before grading, it takes the place of the first revision', f2['ok'] and f2['version'] == 2
           and d.one('select count(*) from submission where assessment_id = :a and enrollment_id = :e and version = 2', a=k['lab'], e=ENR1) == 1
           and d.one('select count(*) from submission_file_removal where path like :p', p='%' + s['submission_id'] + '%') == 2, f2)
        # unsend it
        u = d.svc('revision_unsend', t1, ENR1, k['lab'])
        ok('revision: revision_unsend takes the revision back', u == {'ok': True, 'unsent': True, 'cancelled': False, 'pages': 2}, u)
        ok('revision: and the request is open again', piece(d.feedback(t1, ENR1), k['lab'])['revision']['state'] == 'open')
        ok('revision: revision_unsend with nothing in', d.svc('revision_unsend', t1, ENR1, k['lab'])['unsent'] is False)
        s, f = d.revise(t1, ENR1, k['lab'], 1, 'Third time.')
        # the teacher grades it
        d.score(ENR1, k['lab'], 8)
        ok('revision: once the grade changes, grading has started', d.rpc('list_course_feedback(:c)', c=COURSE_A)['revisions'][0]['state'] == 'grading')
        ok('revision: and the student cannot take it back', d.svc('revision_unsend', t1, ENR1, k['lab'])['error'] == 'grading_started')
        ok('revision: or send it again', d.rev_start(t1, ENR1, k['lab'])['error'] == 'grading_started')
        ok('revision: the student still sees the first grade (the new one is a draft)', piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 6)
        d.return_work(k['lab'], [ENR1])
        g = piece(d.page(t1, ENR1), k['lab'])['grade']
        ok('revision: returned, the new grade replaces the old', g['value'] == 8)
        st = piece(d.feedback(t1, ENR1), k['lab'])['revision']
        ok('revision: Before and After: the first version\'s grade is kept as history', st['state'] == 'returned' and st['first_grade']['value'] == 6, st)
        # a new request marks the old one done
        r2 = d.rfr(k['lab'], ENR1, {'what_to_fix': 'One more.'})
        ok('revision: a new request after the revision was returned', r2['result'] == 'made' and r2['request']['first_version'] == 2
           and d.one("select state from revision_request where id = :r", r=rid) == 'done', r2)
        c = d.rpc('cancel_revision(:r, :k)', r=r2['request']['id'], k=nid())
        ok('revision: Take Back', c['result'] == 'cancelled' and c['unhidden'] is False)
        ok('revision: cancel again', d.rpc('cancel_revision(:r, :k)', r=r2['request']['id'], k=nid())['result'] == 'not_open')
        ok('revision: cancel: another teacher', err(d, lambda: d.rpc('cancel_revision(:r, :k)', B, r=r2['request']['id'], k=nid())) == 'P0002')
        ok('revision: a taken-back request is not shown', piece(d.feedback(t1, ENR1), k['lab'])['revision']['state'] == 'returned')
        # the hourly limit counts revisions
        d.score(ENR2, k['lab'], 3); sub2, f2 = d.send(t2, ENR2, k['lab'], 1); d.rfr(k['lab'], ENR2, {'what_to_fix': 'x'})
        card2 = d.one('select id from student_card where enrollment_id = :e and stopped_at is null', e=ENR2)
        d.run('insert into student_submit.send_log (card_id) select :c from generate_series(1, 18)', c=card2)
        ok('revision: the 20th send of the hour is taken', d.rev_start(t2, ENR2, k['lab'])['ok'])
        ok('revision: the 21st is refused', d.rev_start(t2, ENR2, k['lab'])['error'] == 'too_many')
        # Send Work off
        d.run('update course set send_work = false where id = :c', c=COURSE_A)
        ok('revision: Send Work off', d.rev_start(t1, ENR1, k['lab'])['error'] == 'send_off')
        d.run('update course set send_work = true where id = :c', c=COURSE_A)
        # a late revision
        d.run("delete from student_submit.send_log")
        d.run("update revision_request set revise_by = current_date - 3 where enrollment_id = :e and state = 'open'", e=ENR2)
        s, f = d.revise(t2, ENR2, k['lab'])
        ok('revision: sent after Revise By, it is marked late', f['ok'] and f['late'] is True, f)
        # expired: a send started more than two hours ago
        d.run("update submission set created_at = now() - interval '3 hours' where state = 'sending'")
        # deleting the student takes the requests
        n = d.one('select count(*) from revision_request where enrollment_id = :e', e=ENR2)
        d.run('delete from enrollment where id = :e', e=ENR2)
        ok('revision: deleting a student takes their requests', n == 1 and d.one('select count(*) from revision_request where enrollment_id = :e', e=ENR2) == 0)
        # a rubric piece's criteria
        d.run("insert into rubric_score (enrollment_id, assessment_id, criterion_id, value) values (:e, :a, :c, 2)", e=ENR1, a=k['rub'], c=k['crit1'])
        r = d.rfr(k['rub'], ENR1, {'what_to_fix': 'The letter.', 'criterion_ids': [k['crit2'], k['crit2']]})
        ok('revision: criteria of the piece\'s rubric are kept, once each', r['result'] == 'made' and r['request']['criterion_ids'] == [k['crit2']], r)
        ok('revision: a piece with nothing handed in (on paper): first_submission_id is null', r['request']['first_submission_id'] is None)
        ok('revision: a revision of work never sent cannot be sent when the piece takes nothing',
           (d.run("update assessment set students_send = 'nothing' where id = :a", a=k['rub']) or True) and d.rev_start(t1, ENR1, k['rub'])['error'] == 'not_taking_work')
    finally:
        d.close()

# ── group: One per Group ───────────────────────────────────────────────────
def group():
    d = scenario_db('group')
    try:
        k = seed(d)
        enr3 = nid(); stu3 = nid()
        d.run("insert into student (id, teacher_id, first_name, last_name, date_of_birth) values (:s, :t, 'Leo', 'Third', '2012-08-18')", s=stu3, t=A)
        d.run("insert into enrollment (id, student_id, course_id) values (:e, :s, :c)", e=enr3, s=stu3, c=COURSE_A)
        d.run("""update assessment set group_work = 'group', collab_mode = 'groups',
                    collab_config = jsonb_build_object('groups', jsonb_build_array(jsonb_build_array(:a::text, :b::text), jsonb_build_array(:c::text)))
                  where id = :x""", a=ENR1, b=ENR2, c=enr3, x=k['lab'])
        t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16'); t3 = d.session(enr3, '2012-08-18')
        g = d.svc('group_work', t1, ENR1)
        ok('group: the group is listed, with no work in', g['ok'] and g['assessments'] == [{'id': k['lab'], 'members': 2, 'sent': False, 'pages': 0,
                                                                                            'you_sent': False, 'first_sent_at': None}], g)
        sub, files = d.send(t2, ENR2, k['lab'], 2)
        g1 = d.svc('group_work', t1, ENR1)['assessments'][0]
        ok('group: one member sent it for the group', g1['sent'] and g1['pages'] == 2 and not g1['you_sent'], g1)
        ok('group: the sender sees they sent it', d.svc('group_work', t2, ENR2)['assessments'][0]['you_sent'])
        names = json.dumps([d.svc('group_work', t1, ENR1), d.svc('group_file_links', t1, ENR1, k['lab'])])
        ok('group: no other student\'s name or id is sent', 'Leo' not in names and ENR2 not in names.replace(sub, '').split('"path"')[0]
           and all(ENR2 not in v for v in strings(d.svc('group_work', t1, ENR1))))
        L = d.svc('group_file_links', t1, ENR1, k['lab'])['files']
        ok('group: the group\'s pages reach every member', len(L) == 2 and not any(x['mine'] for x in L))
        ok('group: a student of another group sees none of them', d.svc('group_file_links', t3, enr3, k['lab'])['files'] == []
           and d.svc('group_work', t3, enr3)['assessments'][0]['sent'] is False)
        # Add a Page: the second member's own send
        sub1, files1 = d.send(t1, ENR1, k['lab'], 1)
        g1 = d.svc('group_work', t1, ENR1)['assessments'][0]
        ok('group: a member adds a page: the group has three', g1['pages'] == 3 and g1['you_sent'])
        ok('group: each member\'s Unsend takes only their own', d.service("student_submit.unsend(:t, :e, :a, 'ip-1')", t=t1, e=ENR1, a=k['lab'])['pages'] == 1
           and d.svc('group_work', t2, ENR2)['assessments'][0]['pages'] == 2)
        # marks on the group's pages, once returned
        d.save_markup(files[0], marks('Group note'))
        d.score(ENR2, k['lab'], 7); d.score(ENR1, k['lab'], 7)
        d.return_work(k['lab'], [ENR1, ENR2])
        ok('group: marks on the group\'s pages reach each member', len(d.marks(t1, ENR1, k['lab'])['files']) == 1
           and piece(d.feedback(t1, ENR1), k['lab'])['marks']['notes'] == 1)
        ok('group: and not a student of another group', d.marks(t3, enr3, k['lab'])['files'] == [])
        # Each Student: no group
        d.run("update assessment set group_work = 'each' where id = :a", a=k['lab'])
        ok('group: Each Student: not listed as group work', d.svc('group_work', t1, ENR1)['assessments'] == [])
        ok('group: Each Student: own pages only', d.svc('group_file_links', t1, ENR1, k['lab'])['files'] == [])
        d.run("update assessment set group_work = 'group' where id = :a", a=k['lab'])
        # a withdrawn member is not counted; a member id that is not a student is ignored
        d.run("""update assessment set collab_config = jsonb_build_object('groups', jsonb_build_array(jsonb_build_array(:a::text, :b::text, 'not-an-id', 7)))
                  where id = :x""", a=ENR1, b=ENR2, x=k['lab'])
        ok('group: odd members are ignored', d.svc('group_work', t1, ENR1)['assessments'][0]['members'] == 2)
        d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR2)
        ok('group: a withdrawn member is left out', d.svc('group_work', t1, ENR1)['assessments'][0]['members'] == 1
           and d.svc('group_file_links', t1, ENR1, k['lab'])['files'] == [])
        # pairs
        d.run('update enrollment set withdrawn_at = null where id = :e', e=ENR2)
        d.run("""update assessment set collab_mode = 'pairs', collab_config = jsonb_build_object('pairs', jsonb_build_array(jsonb_build_array(:a::text, :b::text)))
                  where id = :x""", a=ENR1, b=ENR2, x=k['lab'])
        ok('group: Pairs work too', d.svc('group_work', t1, ENR1)['assessments'][0]['members'] == 2)
        d.run("update assessment set collab_mode = 'none' where id = :x", x=k['lab'])
        ok('group: no groups made: not group work', d.svc('group_work', t1, ENR1)['assessments'] == [])
        ok('group: a wrong shape raises', err(d, lambda: d.svc('group_file_links', t1, ENR1, None)) == '22023')
        ok('group: no session', d.svc('group_work', 'a' * 64, ENR1)['error'] == 'signed_out')
    finally:
        d.close()

# ── grants ─────────────────────────────────────────────────────────────────
def grants():
    d = scenario_db('grants')
    try:
        for fn in C1_FUNCTIONS:
            ok('grants: anon cannot run ' + fn, not d.one("select has_function_privilege('anon', to_regprocedure(:f), 'execute')", f=fn))
        for fn in C1_STUDENT:
            ok('grants: only the service role runs ' + fn, d.one("select has_function_privilege('service_role', to_regprocedure(:f), 'execute') and not has_function_privilege('authenticated', to_regprocedure(:f), 'execute')", f=fn))
        for fn in C1_FUNCTIONS:
            if fn in C1_STUDENT or fn in C1_PUBLIC_RPCS: continue
            ok('grants: nobody but the owner runs the helper ' + fn, d.one("select not has_function_privilege('authenticated', to_regprocedure(:f), 'execute') and not has_function_privilege('service_role', to_regprocedure(:f), 'execute')", f=fn))
        for t in ['public.markup', 'public.revision_request', 'public.feedback_reflection']:
            ok('grants: row security on ' + t, d.one('select relrowsecurity from pg_class where oid = to_regclass(:t)', t=t))
            for r in ['anon', 'authenticated']:
                ok('grants: %s cannot read %s' % (r, t), err(d, lambda: d.role(r, 'select * from ' + t, uid=A if r == 'authenticated' else None)) == '42501')
        bad = d.all("""select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
                          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')""")
        ok('grants: every SECURITY DEFINER function names pg_temp last', bad == [], bad)
        mine = [(f, d.one('select proconfig::text from pg_proc where oid = to_regprocedure(:f)', f=f)) for f in C1_FUNCTIONS]
        ok('grants: every C1 function sets a search path ending in pg_temp', len(mine) == len(C1_FUNCTIONS) and all(c and c.rstrip('"}').endswith('pg_temp') for _, c in mine), mine)
        src = ' '.join(d.one('select prosrc from pg_proc where oid = to_regprocedure(:f)', f=f) for f in C1_STUDENT)
        ok('grants: no student function reads markup.working', 'working' not in re.sub(r'working_copy', '', src))
        ok('grants: no student function names a score table but for its status', not re.search(r'\b(tag_score|rubric_score|rubric_check_score)\b', src))
    finally:
        d.close()

# ── race: two at once ──────────────────────────────────────────────────────
def race():
    d = scenario_db('race')
    try:
        k = seed(d); t1 = d.session(ENR1)
        sub, files = d.send(t1, ENR1, k['lab'], 1)
        d.score(ENR1, k['lab'], 5)
        d.run('commit') if d.in_tx else None
        def twice(label, call, check):
            """The same call with the same key from two connections: the first holds the class lock in an open
            transaction, the second waits. Each answer, and the check, after both."""
            a = CDb.__new__(CDb); a.name = d.name; a.c = d.other(); a.rows = []; a.in_tx = False
            b = CDb.__new__(CDb); b.name = d.name; b.c = d.other(); b.rows = []; b.in_tx = False
            out = {}
            a.begin(); out['a'] = call(a)
            th = threading.Thread(target=lambda: out.__setitem__('b', attempt(lambda: call(b)))); th.start()
            time.sleep(0.8)
            waited = th.is_alive()
            a.c.run('commit'); a.in_tx = False
            th.join(10)
            ok('race: %s: the second waits for the first' % label, waited)
            ok('race: %s: the second gets the first\'s answer' % label, out.get('b') == out['a'], (out.get('b'), out['a']))
            ok('race: %s: %s' % (label, check[0]), check[1](), check[0])
            a.c.close(); b.c.close()
        def attempt(fn):
            try: return fn()
            except Exception as e: return 'ERROR %s' % message(e)
        key = nid()
        twice('return_for_revision', lambda x: x.rfr(k['lab'], ENR1, {'what_to_fix': 'again'}, key=key),
              ('one request is made', lambda: d.one('select count(*) from revision_request') == 1))
        key = nid()
        twice('save_markup', lambda x: x.save_markup(files[0], marks('once'), None, key=key),
              ('one rev', lambda: d.one('select working_rev from markup where file_id = :f', f=files[0]) == 1))
        key = nid()
        d.save_markup(files[0], marks('twice'))
        twice('return_work', lambda x: x.return_work(k['lab'], [ENR1], key=key),
              ('the marks given once', lambda: d.one('select given_rev from markup where file_id = :f', f=files[0]) == 2))
        d.run("update course set reflect_on_feedback = true")
        d.reflect(t1, ENR1, k['lab'], {'makes_sense': 'not_sure', 'question': 'Q?'})
        rid = d.one('select id from feedback_reflection')
        key = nid()
        twice('answer_reflection', lambda x: x.rpc('answer_reflection(:r, :a, :k)', r=rid, a='A.', k=key),
              ('answered once', lambda: d.one('select answer from feedback_reflection') == 'A.'))
        # a revision handed in while the teacher saves a grade: whichever is second sees the first
        d.run("delete from revision_request"); d.rfr(k['lab'], ENR1, {'what_to_fix': 'r'})
        s = d.rev_start(t1, ENR1, k['lab']); d.upload(s['files'])
        a = CDb.__new__(CDb); a.name = d.name; a.c = d.other(); a.rows = []; a.in_tx = False
        a.begin(); a.score(ENR1, k['lab'], 9)    # holds the class lock (the grade_return trigger takes it)
        out = {}
        th = threading.Thread(target=lambda: out.__setitem__('f', d.rev_finish(t1, ENR1, s['submission_id'], s['files']))); th.start()
        time.sleep(0.8); waited = th.is_alive()
        a.c.run('commit'); th.join(10); a.c.close()
        ok('race: a revision finishing while a grade is saved waits for it', waited)
        ok('race: and is handed in, grading not yet started (the save came first)', out['f']['ok'] and
           d.rpc('list_course_feedback(:c)', c=COURSE_A)['revisions'][-1]['state'] == 'sent', out)
    finally:
        d.close()

# ── apply2: C2 meets C1 in use ─────────────────────────────────────────────
def apply2():
    d = scenario_db('apply2')
    try:
        k = seed(d); t1, t2, sub, files = busy(d, k)
        d.save_markup(files[0], marks('a note'))
        d.rfr(k['lab'], ENR1, {'what_to_fix': 'x'})
        # guards
        d2 = CDb('apply2_noc1')
        try:
            r = d2.apply2(); ok('apply2: without C1 it stops at its guard', r.startswith('STOPPED') and 'first file of Batch C' in r, r)
        finally:
            d2.close()
        before = catalog(d.c); rows = row_checksums(d.c)
        for name, sql in [('a stand-in not as C1 left it', "create or replace function public._revision_hide_grade(p_request_id uuid) returns boolean language sql stable set search_path to 'public', 'pg_temp' as $f$ select true; $f$"),
                          ('_markup_give changed', "create or replace function public._markup_give(p_enrollment_id uuid, p_assessment_id uuid) returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$ begin return 0; end; $f$"),
                          ('a hidden grade already marked', "update revision_request set grade_hidden = true")]:
            d.begin(); d.run(sql)
            r = d.statements(split(text_at(C2_USED))); d.in_tx = False
            ok('apply2: the guard stops on ' + name, r.startswith('STOPPED') and d.at == 2, r)
            ok('apply2: nothing changed after ' + name, catalog(d.c) == before)
        ok('apply2: the pre-check is clean', postcheck(d, 'batch-c2-live-precheck.sql') == [], postcheck(d, 'batch-c2-live-precheck.sql'))
        r = d.apply2(); ok('apply2: the file applies', r == 'ok', r)
        after = catalog(d.c); gone, new = differences(before, after)
        fname = lambda l: l.split(' ', 1)[1].split('(')[0] + '()'
        changed_fns = sorted({fname(l) for l in gone if l.startswith('function ') and not l.startswith('function more')})
        ok('apply2: exactly the three stand-ins change', changed_fns == sorted(x.split('(')[0] + '()' for x in C2_REPLACES), changed_fns)
        new_fns = sorted({fname(l) for l in new if l.startswith('function ') and not l.startswith('function more')} - set(changed_fns))
        ok('apply2: and one function is new', new_fns == C2_NEW, new_fns)
        new_trg = sorted(l.split(' | ')[1] for l in new if l.startswith('trigger ') and not l.startswith('trigger comment'))
        ok('apply2: and two triggers on grade_return', new_trg == ['markup_given_on_insert', 'markup_given_on_return'], new_trg)
        other = [l for l in gone if not l.startswith(('function', 'depends', 'comments on'))]
        ok('apply2: nothing else in the catalog changes', other == [], other)
        ok('apply2: the apply changes no row', row_checksums(d.c) == rows)
        ok('apply2: the post-check is clean', postcheck(d, 'batch-c2-live-postcheck.sql') == [], postcheck(d, 'batch-c2-live-postcheck.sql'))
        d.begin(); d.run('alter table public.grade_return disable trigger markup_given_on_return')
        ok('apply2: the post-check notices a trigger off', postcheck(d, 'batch-c2-live-postcheck.sql') != []); d.rollback()
        d.begin(); d.run('grant execute on function public._revision_hide_grade(uuid) to authenticated')
        ok('apply2: the post-check notices a grant', postcheck(d, 'batch-c2-live-postcheck.sql') != []); d.rollback()
        cat2 = catalog(d.c); rows2 = row_checksums(d.c)
        ok('apply2: a second run applies', d.apply2() == 'ok')
        ok('apply2: a second run changes nothing', catalog(d.c) == cat2 and row_checksums(d.c) == rows2)
        ok('apply2: C1 run again after C2 applies and changes nothing', d.apply1() == 'ok' and catalog(d.c) == cat2 and row_checksums(d.c) == rows2)
        ok('apply1: C1\'s post-check is clean with C2 in', postcheck(d, 'batch-c1-live-postcheck.sql') == [])
    finally:
        d.close()

# ── hide: Hide the grade (C2) ──────────────────────────────────────────────
def gr(d, e, a): return d.all('select is_draft, returned_at, returned_copy, previous_copy, updated_at, seen_at, working_copy from grade_return where enrollment_id = :e and assessment_id = :a', e=e, a=a)
def hide():
    d = scenario_db('hide', with_c2=True)
    try:
        k = seed(d); t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
        sub, files = d.send(t1, ENR1, k['lab'], 1)
        # each grade returned, then changed and returned again, so each has an updated_at
        d.score(ENR1, k['lab'], 5); d.return_work(k['lab'], [ENR1]); d.score(ENR1, k['lab'], 6); d.return_work(k['lab'], [ENR1])
        d.score(ENR2, k['lab'], 3); d.return_work(k['lab'], [ENR2]); d.score(ENR2, k['lab'], 4); d.return_work(k['lab'], [ENR2])
        ok('hide: both grades carry an updated_at before the hide', all(gr(d, e, k['lab'])[0][4] is not None for e in (ENR1, ENR2)))
        d.page(t1, ENR1); d.service("student_submit.seen(:t, :e, :a, 'ip-1')", t=t1, e=ENR1, a=[k['lab']])
        g_before = gr(d, ENR1, k['lab']); others = d.all('select * from grade_return where not (enrollment_id = :e and assessment_id = :a) order by 1, 2', e=ENR1, a=k['lab'])
        scores = d.all('select * from score order by id')
        r = d.rfr(k['lab'], ENR1, {'what_to_fix': 'Redo it.', 'keep_grade': False})
        ok('hide: made, hidden', r['result'] == 'made' and r['hidden'] is True and r['request']['grade_hidden'], r)
        g = gr(d, ENR1, k['lab'])[0]
        ok('hide: exactly that grade_return row changes: a draft, never returned', g[0] is True and g[1] is None and g[2] is None and g[4] is None
           and g[3] == g_before[0][3] and g[5] == g_before[0][5] and g[6] == g_before[0][6], (g, g_before))
        ok('hide: no other grade_return row changes', d.all('select * from grade_return where not (enrollment_id = :e and assessment_id = :a) order by 1, 2', e=ENR1, a=k['lab']) == others)
        ok('hide: no score row changes', d.all('select * from score order by id') == scores)
        p = piece(d.page(t1, ENR1), k['lab'])
        ok('hide: the student page shows no grade', p['grade'] is None and p['returned_at'] is None, p)
        f = piece(d.feedback(t1, ENR1), k['lab'])['revision']
        ok('hide: Before and After does not show the hidden grade', f['grade_hidden'] and f['first_grade'] is None, f)
        ok('hide: the teacher sees a draft', d.rpc('course_draft_count(:c)', c=COURSE_A) == 1)
        ok('hide: another student keeps their grade', piece(d.page(t2, ENR2), k['lab'])['grade']['value'] == 4)
        ok('hide: reflecting on hidden work is refused', d.reflect(t1, ENR1, k['lab'], {'makes_sense': 'yes', 'plan': 'p'})['error'] == 'not_returned')
        # the revision comes in and is graded, returned
        s, fin = d.revise(t1, ENR1, k['lab'])
        ok('hide: a revision can be sent while hidden', fin['ok'], fin)
        d.score(ENR1, k['lab'], 9)
        ok('hide: still hidden while the new grade is a draft', piece(d.page(t1, ENR1), k['lab'])['grade'] is None)
        d.return_work(k['lab'], [ENR1])
        ok('hide: returned, the new grade shows', piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 9)
        f = piece(d.feedback(t1, ENR1), k['lab'])['revision']
        ok('hide: and Before and After shows the first grade', f['state'] == 'returned' and f['first_grade']['value'] == 6, f)
        # take back while hidden: exactly what the student had comes back
        d.score(ENR2, k['lab'], 4)
        b2 = gr(d, ENR2, k['lab'])
        r = d.rfr(k['lab'], ENR2, {'what_to_fix': 'x', 'keep_grade': False})
        c = d.rpc('cancel_revision(:r, :k)', r=r['request']['id'], k=nid())
        ok('hide: Take Back gives the grade back exactly', c['unhidden'] is True and gr(d, ENR2, k['lab']) == b2, (gr(d, ENR2, k['lab']), b2))
        ok('hide: after Take Back the request no longer says hidden', c['request']['grade_hidden'] is False)
        ok('hide: Take Back for one student leaves another\'s grade alone', piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 9)
        # hidden while a draft sits on the returned grade (Return for Revision returns the work first, so only the
        # helper itself can meet this): what comes back is what the student had, not the draft
        d.score(ENR2, k['lab'], 5)
        rid = d.one("insert into revision_request (course_id, assessment_id, enrollment_id, what_to_fix, keep_grade) values (:c, :a, :e, 'x', false) returning id",
                    c=COURSE_A, a=k['lab'], e=ENR2)
        ok('hide: the helper hides a grade that has a draft on it', d.one('select public._revision_hide_grade(:r)', r=rid) is True
           and piece(d.page(t2, ENR2), k['lab'])['grade'] is None)
        c = d.rpc('cancel_revision(:r, :k)', r=rid, k=nid())
        ok('hide: taken back, the student has what they had (4) and the draft (5) still waits',
           c['unhidden'] and piece(d.page(t2, ENR2), k['lab'])['grade']['value'] == 4 and gr(d, ENR2, k['lab'])[0][0] is True
           and gr(d, ENR2, k['lab'])[0][2]['value'] == 4, gr(d, ENR2, k['lab']))
        d.score(ENR2, k['lab'], 4); d.return_work(k['lab'], [ENR2]); b2 = gr(d, ENR2, k['lab'])
        # take back after the teacher changed the grade: the change waits as a draft on the old grade
        r = d.rfr(k['lab'], ENR2, {'what_to_fix': 'x', 'keep_grade': False})
        d.score(ENR2, k['lab'], 2)
        c = d.rpc('cancel_revision(:r, :k)', r=r['request']['id'], k=nid())
        g = gr(d, ENR2, k['lab'])[0]
        ok('hide: Take Back after a change: the student has the old grade, the change is a draft', c['unhidden'] and g[0] is True and g[1] == b2[0][1]
           and g[2]['value'] == 4 and piece(d.page(t2, ENR2), k['lab'])['grade']['value'] == 4, g)
        # Hide in a class that does not hold grades
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        ok('hide: refused in a class that returns at once', d.rfr(k['rub'], ENR2, {'what_to_fix': 'x', 'keep_grade': False})['result'] == 'hide_needs_holding')
        d.run("update course set return_grades = 'on_return' where id = :c", c=COURSE_A)
        # nothing to hide
        r = d.rfr(k['rub'], ENR2, {'what_to_fix': 'x', 'keep_grade': False})
        ok('hide: no returned grade: nothing hidden', r['result'] == 'made' and r['hidden'] is False and d.one('select count(*) from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR2, a=k['rub']) == 0, r)
        # leaving When I Return Them returns the hidden grade (no draft where no Draft mark shows)
        r = d.rfr(k['lab'], ENR1, {'what_to_fix': 'y', 'keep_grade': False})
        ok('hide: hidden again', r['hidden'] is True, r)
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        ok('hide: leaving When I Return Them gives it back', piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 9)
        c = d.rpc('cancel_revision(:r, :k)', r=r['request']['id'], k=nid())
        ok('hide: Take Back after that changes nothing', c['unhidden'] is False and piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 9)
    finally:
        d.close()

# ── given: marks given on every return path (C2) ───────────────────────────
def given():
    d = scenario_db('given', with_c2=True)
    try:
        k = seed(d); t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
        sub, files = d.send(t1, ENR1, k['lab'], 1); sub2, files2 = d.send(t2, ENR2, k['lab'], 1)
        d.save_markup(files[0], marks('n1')); d.save_markup(files2[0], marks('n2'))
        d.score(ENR1, k['lab'], 5)
        ok('given: a draft gives no marks', d.marks(t1, ENR1, k['lab'])['files'] == [])
        d.rpc('return_grades(:a, :e, :k)', a=k['lab'], e=[ENR1], k=nid())
        ok('given: return_grades from an older screen gives the marks', len(d.marks(t1, ENR1, k['lab'])['files']) == 1)
        d.service("student_submit.seen(:t, :e, :a, 'ip-1')", t=t2, e=ENR2, a=[k['lab']])
        ok('given: a seen() row is not a return', d.marks(t2, ENR2, k['lab'])['files'] == [])
        d.score(ENR2, k['lab'], 3)
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        ok('given: leaving When I Return Them gives the marks with the grades', len(d.marks(t2, ENR2, k['lab'])['files']) == 1)
        d.run("update course set return_grades = 'on_return' where id = :c", c=COURSE_A)
        d.save_markup(files[0], marks('n1 later'))
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        d.score(ENR1, k['lab'], 6)
        ok('given: a save in a class that returns at once gives the marks', 'n1 later' in json.dumps(d.marks(t1, ENR1, k['lab'])))
        # a draft change on a returned grade gives no marks
        d.run("update course set return_grades = 'on_return' where id = :c", c=COURSE_A)
        d.save_markup(files[0], marks('DRAFT-MARK'))
        d.score(ENR1, k['lab'], 7)
        ok('given: a draft change on a returned grade gives no marks', 'DRAFT-MARK' not in json.dumps(d.marks(t1, ENR1, k['lab'])))
        # marks drawn while the class held grades, on a piece with no grade, then the first save in a class that returns at once
        d.save_markup(files2[0], marks('BEFORE-GRADE'))
        d.run('delete from score where enrollment_id = :e and assessment_id = :a', e=ENR2, a=k['lab'])
        d.run("update course set return_grades = 'on_save' where id = :c", c=COURSE_A)
        d.run("update markup set given = null, given_rev = null, given_at = null where file_id = :f", f=files2[0])
        d.run("delete from grade_return where enrollment_id = :e and assessment_id = :a", e=ENR2, a=k['lab'])
        d.score(ENR2, k['lab'], 4)
        ok('given: a grade first returned (a new row) gives the marks', 'BEFORE-GRADE' in json.dumps(d.marks(t2, ENR2, k['lab'])))
        for fn in C2_REPLACES + C2_NEW:
            ok('given: nobody but the owner runs ' + fn, d.one("select not has_function_privilege('authenticated', to_regprocedure(:f), 'execute') and not has_function_privilege('service_role', to_regprocedure(:f), 'execute') and not has_function_privilege('anon', to_regprocedure(:f), 'execute')", f=fn))
        # a fault would stop saves: the trigger works for every writer (an owner's direct write)
        d.run("update course set return_grades = 'on_return' where id = :c", c=COURSE_A)
        d.run('update score set value = 2 where enrollment_id = :e and assessment_id = :a', e=ENR1, a=k['lab'])
        ok('given: a direct save still works with the trigger in', d.one('select is_draft from grade_return where enrollment_id = :e and assessment_id = :a', e=ENR1, a=k['lab']))
    finally:
        d.close()

SCENARIOS = {'apply1': apply1, 'teacher': teacher, 'markup': markup, 'reflect': reflect, 'revision': revision, 'group': group,
             'grants': grants, 'race': race, 'apply2': apply2, 'hide': hide, 'given': given}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        try: SCENARIOS[name]()
        except Exception as e:
            import traceback; ok(name + ': ran to the end', False, traceback.format_exc()[-1500:])
    finish()
