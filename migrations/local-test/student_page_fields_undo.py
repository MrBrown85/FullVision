"""Prove migrations/local-test/s4-m1-undo.sql: S4-M1
(2026111103_student_page_fields.sql) goes in, is used, and comes out, and
the database is exactly what it was.

    python3 student_page_fields_undo.py            every scenario
    python3 student_page_fields_undo.py main       or only some

The database named by PGDATABASE is the template student_page_fields.py
builds (python3 student_page_fields.py build): gradebook-prod as it is now,
without S4-M1. Every scenario runs on a copy of it, made and dropped here.

  main    A class in use: students signed in, a draft, a returned grade.
          The catalog (catalog.py) and a checksum of every table's rows.
          The undo refuses a database S4-M1 is not applied to. S4-M1
          applied and used. Each of the undo's checks stops it with
          nothing changed. Then the undo: the catalog is the one from
          before S4-M1, line for line, and no row of any table differs;
          the two functions have the fingerprints live has; a signed-in
          phone is still signed in and its page is the page S4-M1 gave
          with the new keys gone; the undo refuses a second run; S4-M1
          applies again to the same catalog as the first time; the undo
          again.
  record  With a migration record, as apply_migration keeps one: the
          optional statement in the undo's header removes S4-M1's row and
          no other.
  order   S4-M1's undo goes before S0-M4b's: with S4-M1 applied S0-M4b's
          undo refuses and changes nothing, and after this one it runs.
  suites  After an apply and an undo, the older suites pass as they do on
          the database from before S4-M1.

PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields_undo.py
"""
from student_page_fields import *

UNDO_TEXT = text_of(UNDO)
UNDO_STATEMENTS = split(UNDO_TEXT)
LIVE_TWO = {PAGE: LIVE_MD5[PAGE], CLASSES: LIVE_MD5[CLASSES]}

def record_statement():
    """The optional statement in the undo's header, between `-- record:` and `-- end record`."""
    body = UNDO_TEXT.split('-- record:\n')[1].split('-- end record')[0]
    return '\n'.join(l[2:] for l in body.splitlines()).strip().rstrip(';')

def use(d, k):
    """A class in use: both students signed in, a returned grade with a draft over it, a draft never returned, a Missing mark."""
    tok1, tok2 = sign_in(d, k)
    d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=k['a_pts'])
    d.teacher("save_score_comment(:e, :a, 'Recounted')", e=ENR1, a=k['a_pts'])
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_pts'], ids='{%s}' % ENR1, k=nid())
    d.teacher('upsert_score(:e, :a, 9)', e=ENR1, a=k['a_pts'])
    d.teacher('upsert_tag_score(:e, :a, :t, 3)', e=ENR1, a=k['a_comp'], t=k['t1'])
    d.teacher("set_score_status(:e, :a, 'NS')", e=ENR2, a=k['a_rub'])
    d.service("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=tok1, e=ENR1, ids='{%s}' % k['a_pts'])
    return tok1, tok2

def page_text(d, token, e):
    return d.c.run("select student_submit.page(:t, :e, 'ip-1')::text", t=token, e=e)[0][0]

def scen_main():
    lines = [bare(s).lower() for s in UNDO_STATEMENTS]
    ok('main: the undo is one transaction with a lock timeout, its check first; it makes two functions and nothing else, and drops, alters and deletes nothing',
       lines[0] == 'begin' and lines[1] == "set local lock_timeout = '5s'" and lines[2].startswith('do $guard$') and lines[-1] == 'commit'
       and [l.split('(')[0].split()[-1] for l in lines if l.startswith('create')] == ['student_submit._session_classes', 'student_submit.page']
       and not any(re.match(r'(drop|alter|delete|update|insert|truncate|grant|revoke)\b', l) for l in lines))
    d = PageDb('undo_main')
    try:
        k = seed(d)
        tok1, tok2 = use(d, k)
        cat0, rows0 = catalog_and_rows(d)
        pages0 = [page_text(d, tok1, ENR1), page_text(d, tok2, ENR2), page_text(d, tok1, k['enr_a2'])]

        r = d.unapply()
        ok('main: on a database S4-M1 was never applied to, the undo stops at its check and changes nothing',
           r.startswith('STOPPED') and 'is not as S4-M1 leaves it' in r and d.at == 2 and catalog_and_rows(d) == (cat0, rows0), r)

        r = d.apply()
        ok('main: S4-M1 applies to the class in use', r == 'ok', r)
        cat1, rows1 = catalog_and_rows(d)
        ok('main: and changed no row', rows1 == rows0)
        new = one_page(d, tok1, ENR1)
        ok('main: it is in use: the page carries the new keys, and without them is the page from before S4-M1',
           set(new['assessments'][0]) == OLD_ASSESSMENT | set(NEW_ASSESSMENT) and new['classes'][0]['to_do'] == 5
           and without_new(exact(page_text(d, tok1, ENR1))) == exact(pages0[0]), new['classes'])
        d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['a_comp'], ids='{%s}' % ENR1, k=nid())   # work goes on with S4-M1 applied
        rows1 = row_checksums(d.c)
        pages1 = [page_text(d, tok1, ENR1), page_text(d, tok2, ENR2), page_text(d, tok1, k['enr_a2'])]

        # ── Each check stops it ─────────────────────────────────────────
        d.c.close()
        def stopped_by(setup):
            c = PageDb('undo_guard', template=d.name)
            try:
                for st in setup: c.run(st)
                cat, rows = catalog_and_rows(c)
                r = c.unapply()
                return r.startswith('STOPPED') and 'is not as S4-M1 leaves it' in r and c.at == 2 and catalog_and_rows(c) == (cat, rows), r
            finally:
                c.close()
        touch = lambda sig, word: ["""do $$ declare _d text := pg_get_functiondef('%s'::regprocedure);
                                      begin execute regexp_replace(_d, '\\m%s\\M', '%s '); end $$""" % (sig, word, word)]
        got = stopped_by(touch(PAGE, 'begin'))
        ok('main: with page changed since S4-M1 (a later migration, or by hand) the undo stops and changes nothing', got[0], got[1])
        got = stopped_by(touch(CLASSES, 'select'))
        ok('main: with _session_classes changed since, the same', got[0], got[1])
        d.c = connect(d.name)

        # ── The undo ────────────────────────────────────────────────────
        r = d.unapply()
        ok('main: the undo runs', r == 'ok', r)
        cat2, rows2 = catalog_and_rows(d)
        gone, came = differences(cat0, cat2)
        ok('main: the catalog is the one from before S4-M1, line for line (%d lines): every function, grant, owner and setting' % len(cat0), cat2 == cat0, (gone[:2], came[:2]))
        ok('main: the two functions have the fingerprints gradebook-prod has now', fingerprints(d, [PAGE, CLASSES]) == LIVE_TWO, fingerprints(d, [PAGE, CLASSES]))
        ok('main: no row of any table differs from just before the undo', rows2 == rows1, [t for t in rows1 if rows1[t] != rows2.get(t)])
        ok('main: the phones are still signed in', one_page(d, tok1, ENR1).get('ok') is True and one_page(d, tok2, ENR2).get('ok') is True)
        now = [page_text(d, tok1, ENR1), page_text(d, tok2, ENR2), page_text(d, tok1, k['enr_a2'])]
        ok('main: each page now is the page S4-M1 gave just before, with the new keys gone and nothing else different (a number compared as it is printed)',
           [without_new(exact(x)) for x in pages1] == [exact(x) for x in now], [x[:200] for x in now][:1])

        r = d.unapply()
        ok('main: the undo refuses a second run and changes nothing', r.startswith('STOPPED') and 'is not as S4-M1 leaves it' in r and catalog_and_rows(d) == (cat2, rows2), r)
        r = d.apply()
        ok('main: S4-M1 applies again, to the same catalog as the first time', r == 'ok' and catalog(d.c) == cat1, r)
        ok('main: and the pages it gives are the ones it gave', [page_text(d, tok1, ENR1), page_text(d, tok2, ENR2), page_text(d, tok1, k['enr_a2'])] == pages1)
        r = d.unapply()
        ok('main: and the undo again leaves the first catalog and the same rows', r == 'ok' and catalog_and_rows(d) == (cat0, rows1), r)
    finally:
        d.close()

def scen_record():
    d = PageDb('undo_record')
    try:
        d.run('create schema supabase_migrations')
        d.run('create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)')
        d.run("""insert into supabase_migrations.schema_migrations (version, name) values ('20261110171203', 'grade_return_limits'), ('20261111020200', 'card_codes_keyed')""")
        cat0 = catalog(d.c)
        r = d.apply()
        d.run("insert into supabase_migrations.schema_migrations (version, name) values ('20261111180000', 'student_page_fields')")
        r2 = d.unapply()
        only_before, only_after = differences(cat0, catalog(d.c))
        ok('record: after the apply and the undo the only catalog line that differs is the record of the apply',
           r == 'ok' and r2 == 'ok' and only_before == [] and len(only_after) == 1 and 'student_page_fields' in only_after[0], (r, r2, only_before, only_after))
        d.run(record_statement())
        ok("record: the optional statement in the undo's header removes that row and no other: the catalog is the first one", catalog(d.c) == cat0,
           d.all('select version, name from supabase_migrations.schema_migrations order by 1'))
    finally:
        d.close()

def scen_suites():
    d = PageDb('undo_suites')
    try:
        scripts = ('student_submit.py', 'grade_return.py', 'grade_return_limits.py', 'score_rpcs.py')
        before = {s: (d.suite(s), list(d.failures)) for s in scripts}
        r = d.apply(); r2 = d.unapply()
        ok('suites: applied and undone on the database as built', r == 'ok' and r2 == 'ok', (r, r2))
        for s in scripts:
            got = (d.suite(s), list(d.failures))
            ok('suites: %s gives the same result as before S4-M1: %s' % (s, before[s][0]), got == before[s] and 'passed' in got[0], (got, before[s]))
    finally:
        d.close()

def scen_order():
    """S4-M1's undo goes before S0-M4b's, which puts page back as Batch A made it."""
    d = PageDb('undo_order')
    try:
        part2 = text_of('s0-m4b-undo.sql'); part2 = split(part2[part2.index('-- PART 2: the full removal'):])
        r = d.apply()
        cat = catalog(d.c)
        r1 = d.statements(part2)
        ok("order: with S4-M1 applied, S0-M4b's undo (PART 2) stops, naming page, and changes nothing: this file's undo goes first",
           r == 'ok' and r1.startswith('STOPPED') and 'student_submit.page' in r1 and catalog(d.c) == cat, (r, r1))
        r2 = d.unapply(); r3 = d.statements(part2)
        ok("order: after this file's undo, S0-M4b's runs, and page is then as Batch A made it",
           r2 == 'ok' and r3 == 'ok' and fingerprints(d, [PAGE])[PAGE] == '7af33e2114372833d7ad7fb97b56ebae', (r2, r3, fingerprints(d, [PAGE])))
    finally:
        d.close()
    d = PageDb('undo_order2')
    try:
        r = d.apply(); mine = fingerprints(d, [PAGE, CLASSES])
        r1 = d.file('s3-m1-undo.sql')
        ok("order: S3-M1's undo runs with S4-M1 applied and leaves S4-M1's two functions as they are (it does not need this file's undo first)",
           r == 'ok' and r1 == 'ok' and fingerprints(d, [PAGE, CLASSES]) == mine, (r, r1))
        r2 = d.unapply()
        ok("order: and this file's undo runs after it", r2 == 'ok' and fingerprints(d, [PAGE, CLASSES]) == LIVE_TWO, r2)
    finally:
        d.close()

SCENARIOS = {'main': scen_main, 'record': scen_record, 'order': scen_order, 'suites': scen_suites}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
