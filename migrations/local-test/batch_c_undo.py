"""Batch C's two undo scripts, proved on a database built as live is with Batch B.

    PGDATABASE=<template> BATCH_B_DIR=... python3 batch_c_undo.py

- batch-c2-undo.sql: every hidden grade comes back exactly; the catalog is
  the one C1 alone left, line for line; C2 can be applied again.
- batch-c1-undo.sql PART 1: nothing of Batch C runs, no row changes, and
  grades, Return and sending work still do; PART 1b puts it back.
- PART 2: refuses while C2 is in, and while the tables hold rows unless
  told to discard them; then the catalog is the one before C1, line for
  line, but for the two dropped columns' slots; no row of any table that
  existed before changes; a revision a student sent stays as Batch B's.
"""
from batch_c import *

def normacl(lines):
    """Catalog lines with each grant list in a fixed order (a grant given back may be listed in another order)."""
    return sorted(re.sub(r'\{([^}]*=[^}]*)\}', lambda m: '{' + ','.join(sorted(m.group(1).split(','))) + '}', l) for l in lines)

def undo2():
    d = CDb('undo2')
    try:
        k = seed(d, reflect=False); t1 = d.session(ENR1)
        sub, files = d.send(t1, ENR1, k['lab'], 1)
        ok('undo2: C1 applies', d.apply1() == 'ok')
        cat_c1 = catalog(d.c)
        ok('undo2: C2 applies', d.apply2() == 'ok')
        d.score(ENR1, k['lab'], 6); d.return_work(k['lab'], [ENR1])
        g_before = gr(d, ENR1, k['lab'])
        d.save_markup(files[0], marks('n'))
        r = d.rfr(k['lab'], ENR1, {'what_to_fix': 'x', 'keep_grade': False})
        ok('undo2: a grade is hidden', r['hidden'] is True and piece(d.page(t1, ENR1), k['lab'])['grade'] is None)
        rows_other = row_checksums(d.c, {t: c for t, c in table_columns(d.c).items() if t not in ('public.grade_return', 'public.revision_request')})
        r = d.undo2(); ok('undo2: the undo runs', r == 'ok', r)
        ok('undo2: the hidden grade comes back exactly', gr(d, ENR1, k['lab']) == g_before, (gr(d, ENR1, k['lab']), g_before))
        ok('undo2: the student sees it again', piece(d.page(t1, ENR1), k['lab'])['grade']['value'] == 6)
        ok('undo2: no other table\'s rows change', row_checksums(d.c, {t: c for t, c in table_columns(d.c).items() if t not in ('public.grade_return', 'public.revision_request')}) == rows_other)
        gone, new = differences(cat_c1, catalog(d.c))
        ok('undo2: the catalog is the one C1 alone left, line for line', gone == [] and new == [], (gone[:3], new[:3]))
        ok('undo2: Hide answers hide_not_available again', d.rfr(k['rub'], ENR1, {'what_to_fix': 'x', 'keep_grade': False})['result'] == 'hide_not_available')
        r = d.undo2(); ok('undo2: run again, it stops: nothing to take back', r.startswith('STOPPED') and 'not applied' in r, r)
        ok('undo2: C2 can be applied again', d.apply2() == 'ok' and postcheck(d, 'batch-c2-live-postcheck.sql') == [])
    finally:
        d.close()

def undo2_two():
    """(a) 4: one request whose hide ended long ago (it held a 5) and one hiding the grade now (it holds a 7),
    in both id orders: the undo gives back the 7, the grade of the hide that is on now."""
    for first in ('old request first', 'new request first'):
        d = scenario_db('undo2two', with_c2=True)
        try:
            k = seed(d); lab = k['lab']; t1 = d.session(ENR1)
            d.send(t1, ENR1, lab)
            d.score(ENR1, lab, 5); d.return_work(lab, [ENR1])
            r1 = d.rfr(lab, ENR1, {'what_to_fix': 'Fix', 'keep_grade': False})['request']['id']
            d.revise(t1, ENR1, lab); d.score(ENR1, lab, 7); d.return_work(lab, [ENR1])
            ok('undo2 (a) 4 (%s): the revision\'s grade returned: the student has the 7' % first, shown(d, ENR1, lab) == 7)
            r2 = d.rfr(lab, ENR1, {'what_to_fix': 'Once more', 'keep_grade': False})
            ok('undo2 (a) 4 (%s): a second request hides the 7' % first, r2['result'] == 'made' and r2['hidden'] and shown(d, ENR1, lab) is None, r2)
            r2 = r2['request']['id']
            lo, hi = '00000000-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001'
            d.run('update revision_request set id = :n where id = :o', n=lo if first == 'old request first' else hi, o=r1)
            d.run('update revision_request set id = :n where id = :o', n=hi if first == 'old request first' else lo, o=r2)
            u = d.undo2()
            ok('undo2 (a) 4 (%s): the undo gives back the grade of the hide that is on now (the 7)' % first,
               u == 'ok' and shown(d, ENR1, lab) == 7, (u, shown(d, ENR1, lab)))
        finally:
            d.close()

def undo2_marks():
    """(a) 3 for the undo: a hidden grade given back carries no mark drawn while it was hidden."""
    d = scenario_db('undo2marks', with_c2=True)
    try:
        k = seed(d); lab = k['lab']; t1 = d.session(ENR1)
        sub, files = d.send(t1, ENR1, lab)
        d.score(ENR1, lab, 6); d.return_work(lab, [ENR1])
        d.rfr(lab, ENR1, {'what_to_fix': 'Fix', 'keep_grade': False})
        d.save_markup(files[0], marks('HIDDEN-TIME-NOTE'))
        ok('undo2 (a) 3: the undo runs', d.undo2() == 'ok')
        ok('undo2 (a) 3: the grade is given back', shown(d, ENR1, lab) == 6)
        ok('undo2 (a) 3: without the mark drawn while it was hidden', 'HIDDEN-TIME-NOTE' not in json.dumps(d.marks(t1, ENR1, lab)))
    finally:
        d.close()

def undo1():
    d = CDb('undo1')
    try:
        k = seed(d, reflect=False); t1 = d.session(ENR1); t2 = d.session(ENR2, '2012-06-16')
        sub, files = d.send(t1, ENR1, k['lab'], 1)
        d.score(ENR1, k['lab'], 6)
        cat0 = catalog(d.c); cols0 = table_columns(d.c)
        gs_b = d.one("select md5(pg_get_functiondef('student_submit._grading_started(uuid,uuid)'::regprocedure))")
        ok('undo1: C1 applies', d.apply1() == 'ok')
        ok('undo1: C1 replaced _grading_started', d.one("select md5(pg_get_functiondef('student_submit._grading_started(uuid,uuid)'::regprocedure))") != gs_b)
        # PART 2 on a C1 nobody has used: no discard needed
        P = parts(text_at(UNDO_C1))
        cat_c1 = catalog(d.c)
        ok('undo1: PART 1 runs', d.statements(split(P['1'])) == 'ok')
        fp = row_checksums(d.c)
        ok('undo1: PART 1 changes no row', fp == row_checksums(d.c))
        ok('undo1: PART 1: a teacher can no longer save marks', err(d, lambda: d.save_markup(files[0], marks('x'))) == '42501')
        ok('undo1: PART 1: the student page cannot reach Batch C', err(d, lambda: d.feedback(t1, ENR1)) == '42501')
        ok('undo1: PART 1: Return still works', d.rpc('return_grades(:a, :e, :k)', a=k['lab'], e=[ENR1], k=nid())['returned'] == 1)
        ok('undo1: PART 1: sending work still works', d.send(t2, ENR2, k['lab'], 1)[0] is not None)
        ok('undo1: PART 1b runs', d.statements(split(P['1b'])) == 'ok')
        ok('undo1: PART 1b puts back every permission', normacl(catalog(d.c)) == normacl(cat_c1), differences(normacl(cat_c1), normacl(catalog(d.c))))
        # use it: marks, a reflection, a revision
        d.save_markup(files[0], marks('n')); d.return_work(k['lab'], [ENR1])
        d.run('update course set reflect_on_feedback = true where id = :c', c=COURSE_A)
        ok('undo1: a reflection is sent', d.reflect(t1, ENR1, k['lab'], {'makes_sense': 'yes', 'plan': 'p'})['ok'])
        d.rfr(k['lab'], ENR1, {'what_to_fix': 'x'})
        s, f = d.revise(t1, ENR1, k['lab'])
        ok('undo1: a revision is in', f['ok'], f)
        rows = row_checksums(d.c, cols0)
        ok('undo1: C2 applies', d.apply2() == 'ok')
        r = d.statements(split(P['2'])); ok('undo1: PART 2 refuses while C2 is in', r.startswith('STOPPED') and 'C2 is applied' in r, r)
        ok('undo1: batch-c2-undo runs', d.undo2() == 'ok')
        r = d.statements(split(P['2'])); ok('undo1: PART 2 refuses while the tables hold rows', r.startswith('STOPPED') and 'discard' in r, r)
        d.run("set fv.batch_c_undo = 'discard'")
        r = d.statements(split(P['2'])); ok('undo1: told to discard, PART 2 runs', r == 'ok', r)
        d.run("reset fv.batch_c_undo")
        gone, new = differences(cat0, catalog(d.c))
        ok('undo1: the catalog is the one before C1, but for the dropped columns\' slots',
           [l for l in gone if not l.startswith('dropped columns public.course')] == [] and
           [l for l in new if not l.startswith('dropped columns public.course')] == [], (gone[:3], new[:3]))
        ok("undo1: PART 2 puts Batch B's _grading_started back exactly", d.one("select md5(pg_get_functiondef('student_submit._grading_started(uuid,uuid)'::regprocedure))") == gs_b)
        after = row_checksums(d.c, cols0)
        ok('undo1: no row of a table that existed before changes but what Batch B holds of the revision',
           {t: v for t, v in after.items() if t not in ('public.submission', 'public.submission_file', 'public.submission_file_removal', 'student_submit.send_log', 'storage.objects', 'public.course')}
           == {t: v for t, v in rows.items() if t not in ('public.submission', 'public.submission_file', 'public.submission_file_removal', 'student_submit.send_log', 'storage.objects', 'public.course')})
        ok('undo1: the revision a student sent stays, as Batch B\'s version 2', d.one("select count(*) from submission where version = 2 and state = 'sent'") == 1)
        w = d.service("student_submit.work(:t, :e, 'ip-1')", t=t1, e=ENR1)
        ok('undo1: Batch B reads it as the latest version', w['ok'] and [x for x in w['assessments'] if x['id'] == k['lab']][0]['sent']['submission_id'] == f['submission_id'])
        r = d.statements(split(P['2'])); ok('undo1: PART 2 again: nothing to take out', r.startswith('STOPPED') and 'not applied' in r, r)
        ok('undo1: C1 applies again after its undo', d.apply1() == 'ok' and postcheck(d, 'batch-c1-live-postcheck.sql') == [])
    finally:
        d.close()

if __name__ == '__main__':
    for fn in (undo2, undo2_two, undo2_marks, undo1):
        try: fn()
        except Exception as e:
            import traceback; ok(fn.__name__ + ': ran to the end', False, traceback.format_exc()[-1500:])
    finish()
