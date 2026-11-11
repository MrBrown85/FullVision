"""Exercise migrations/2026111003_card_codes_keyed.sql (S3-M1): card codes
the database cannot read.

    python3 card_codes.py build     load an EMPTY database as gradebook-prod
                                    is now: the harness, S0-M4, Batch A's
                                    four files, S0-M5, S0-M4b. No S3-M1.
    python3 card_codes.py           every scenario
    python3 card_codes.py cards     or only some

The database named by PGDATABASE is only ever a template: each scenario
runs on a copy of it (<PGDATABASE>_<scenario>, made and dropped here), so
this can be run again and again though the scenarios commit.

The edge functions' part is played here with a fixed fake key
(card_codes_common.py): codes are drawn, tagged and remembered in Python,
and the database is sent tags only, as it will be.

  apply    The file meets a database in use: cards made the old way (one of
           them replaced once), a signed-in phone, a live slip, remembered
           card answers. Each guard stops it with nothing changed. Then the
           apply: what it does to every existing row, what the catalog
           gains and loses, the table's file on disk, the slip issuers, the
           grants; a card made afterwards; a second run that changes nothing
           and stops no card.
  cards    issue_cards as the teacher-cards function calls it: ownership,
           replaces, both-or-neither, the second candidate, replay, shapes
           refused, the caller's id put back.
  lookup   card and verify_card as student-submit calls them: by tag, a
           stopped card, the limits and locks, the password by its tag, the
           key id; then sessions, page, seen and done on a card made the
           new way.
  race     Two requests for the same student at once, on connections of
           their own: one live card, never two.
  suites   The slip suites and the score suites, untouched, on a database
           with the file applied.

PGPORT=54331 PGDATABASE=s3m1_live python3 card_codes.py build
PGPORT=54331 PGDATABASE=s3m1_live python3 card_codes.py
"""
import threading, time
from card_codes_common import *

TEXT = text_of('../' + MIGRATION)
STATEMENTS = split(TEXT)
HEX64 = re.compile(r'[0-9a-f]{64}')
TODAY = None

def seed(d):
    """Teacher A's class with the Student Page on. The first student has a birthday; the second has
    nothing on file. A second class of Teacher A's with the first student in it."""
    global TODAY
    TODAY = d.one("select (now() at time zone 'America/Vancouver')::date::text")
    d.run("update student set preferred_name = 'CeCe', date_of_birth = '2012-05-15' where id = :s", s=STU1)
    d.run("update course set student_page_enabled = true, return_grades = 'on_return'")
    k = {'course2': nid(), 'enr_a2': nid()}
    d.run("insert into course (id, teacher_id, name, block, student_page_enabled, return_grades) values (:c, :t, 'Socials 8', 'B', true, 'on_return')", c=k['course2'], t=A)
    d.run('insert into enrollment (id, student_id, course_id) values (:e, :s, :c)', e=k['enr_a2'], s=STU1, c=k['course2'])
    return k

def catalog_and_rows(d):
    return catalog(d.c), row_checksums(d.c)

def file_bytes(d, table='public.student_card'):
    """The bytes of a table's file on disk, after a checkpoint, or None where this script cannot read the server's files."""
    d.run('checkpoint')
    path = os.path.join(d.one("select current_setting('data_directory')"), d.one('select pg_relation_filepath(:t)', t=table))
    try: return open(path, 'rb').read()
    except OSError: return None

# ════════════════════════════════════════════════════════════════════════════
def scen_apply():
    d = Db('apply')
    try:
        k = seed(d)
        # ── The file's shape ────────────────────────────────────────────
        last = lambda st: st.split('\n')[-1].strip().lower()
        ok('the file is one transaction: begin first, commit last', last(STATEMENTS[0]) == 'begin' and last(STATEMENTS[-1]) == 'commit')
        ok('it sets a lock timeout, then runs every check before it creates or changes anything',
           STATEMENTS[1].strip().lower().endswith("set local lock_timeout = '5s'") and '$guard$' in STATEMENTS[2]
           and not any(w in bare(' '.join(STATEMENTS[:2])).lower() for w in ('create ', 'alter ', 'drop ', 'update ', 'delete ')))
        code_only = '\n'.join(bare(st) for st in STATEMENTS)
        ok("the file never names pgcrypto's keyed-hash function, in its code or its comments: the key cannot be used inside the database even by mistake",
           not re.search(r'(?<![a-z_])hmac\s*\(', TEXT, re.I) and 'pgcrypto' not in TEXT.lower() and 'digest(' not in code_only.lower())

        # ── A database in use, the old way ──────────────────────────────
        ok('this database has Batch A, S0-M5 and S0-M4b and not S3-M1',
           d.one("select to_regprocedure('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)') is null and to_regprocedure('public._grade_return_repair_class(uuid)') is not null"))
        d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid())
        d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_B, uid=B, k=nid())
        first = d.one('select id from student_card where enrollment_id = :e', e=ENR1)
        d.teacher('reissue_student_card(:i, :k)', i=first, k=nid())                       # ENR1 now has a stopped card and a live one
        d.teacher('unlock_student_card(:i, :k)', i=d.one('select id from student_card where enrollment_id = :e', e=ENR2), k=nid())
        d.teacher('mark_student_cards_printed(:ids::uuid[], :k)', ids='{%s}' % first, k=nid())
        old = {r[0]: r for r in d.all('select enrollment_id, id, code, code_hash, salt, password, stopped_at::text from student_card where stopped_at is null')}
        code1 = old[ENR1][2]
        token = d.service("student_submit.verify_card(:c, '2012-05-15', null, null, null, 'ip-1', false)", c=code1)['session_token']
        ok('before: an old card opens the page, and its code and password are readable in the table',
           d.page(token, ENR1).get('ok') is True and re.fullmatch(r'[A-Z0-9]{3}-[A-Z0-9]{3}', code1) and re.fullmatch(r'\d{4}', old[ENR2][5] or ''), old)
        as_a = lambda sql: d.role('authenticated', sql, uid=A)
        ok("before: a teacher's browser can read its own class's cards, codes and all, straight from the table",
           sorted(r[0] for r in as_a('select code from student_card where stopped_at is null')) == sorted([old[ENR1][2], old[ENR2][2]]))
        q = d.teacher("upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_report_period => 1, p_opens_on => (:d::date - 1), p_closes_on => (:d::date + 7), p_idempotency_key => :k)",
                      c=COURSE_A, d=TODAY, k=nid())
        slip = d.teacher('issue_access_codes(:q, :ids::uuid[], :k)', q=q['id'], ids='{%s}' % ENR1, k=nid())[0]['code']
        ok('before: a slip opens', d.service("student_submit.open(:c, 'ip-1')", c=slip).get('kind') == 'questionnaire')
        ok('before: the remembered answers of Reissue and Unlock hold a whole card, code included',
           d.one("select count(*) from fv_idempotency where endpoint in ('reissue_student_card', 'unlock_student_card') and result ? 'code'") == 2)
        raw = file_bytes(d)
        can_read_files = raw is not None
        if can_read_files:
            ok("before: the table's file on disk holds the codes, their hashes and salts",
               all(x.encode() in raw for x in (old[ENR1][2], old[ENR1][3], old[ENR1][4], old[ENR2][2])))

        cat0, rows0 = catalog_and_rows(d)
        kept = ['id', 'enrollment_id', 'created_at', 'printed_at', 'last_opened_at', 'wrong_tries', 'wrong_times', 'locked_at', 'works_until']
        cards0 = row_checksums(d.c, {'public.student_card': kept})
        fps0 = {r[0]: r[1] for r in d.all("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                             where n.nspname in ('public', 'student_submit', 'fv_private', 'auth') and p.prokind in ('f', 'p')""")}

        # ── Each guard stops it, at the guard, with nothing changed ─────
        def stopped_by(setup, want, note=None):
            """The file run after `setup` (undone afterwards): True when it stops at its guard saying `want`."""
            d.begin()
            try:
                for st in setup: d.run(st)
                try:
                    for n, st in enumerate(STATEMENTS):
                        at = n
                        if last(st) not in ('begin', 'commit'): d.run(st)
                    return (False, 'it ran')
                except Exception as e:
                    return (at == 2 and want in message(e) and 'Nothing was changed' in message(e), message(e)[:300])
            finally:
                d.rollback()
        def retouched(sig):
            """The function's own definition with one more space in it: the same function to a caller, another fingerprint."""
            return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig).replace('\n begin', '\n  begin', 1).replace('\nbegin', '\n begin', 1).replace(' select ', '  select ', 1)
        WAS = ['public._issue_access_code(uuid,uuid,timestamptz)', 'public._issue_report_code(uuid,uuid,timestamptz)', 'public._issue_student_card(uuid,text)',
               'public.issue_student_cards(uuid,uuid[],uuid)', 'public.reissue_student_card(uuid,uuid)', 'public._student_card_json(uuid)',
               'student_submit._card_lookup(text,text)', 'student_submit.card(text,text)', 'student_submit.verify_card(text,text,text,text,text,text,boolean)']
        for sig in WAS:
            new = retouched(sig)
            good, said = stopped_by([new], sig.split('(')[0])
            ok('guard: %s with another body (one space more) stops the file, nothing changed' % sig.split('(')[0],
               good and new != d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig) and 'not the definition this migration was written against' in said, said)
        good, said = stopped_by(['drop function public.reissue_student_card(uuid, uuid)'], 'public.reissue_student_card')
        ok('guard: a function it expects that is missing stops it', good and 'found absent' in said, said)
        good, said = stopped_by(["create function student_submit.issue_cards(uuid, uuid, jsonb, text, uuid) returns jsonb language sql as $f$ select '{}'::jsonb $f$"], 'student_submit.issue_cards')
        ok('guard: a function with one of its new names already there stops it', good and 'expected absent' in said, said)
        for label, setup, want in (
                ('Batch A is not all applied', ['alter table student_submit.device_session rename to s3m1_renamed'], 'Batch A is not all applied'),
                ('S0-M4b is not applied', ['alter function public._grade_return_repair_class(uuid) rename to s3m1_renamed'], 'S0-M4b is not applied'),
                ('S0-M5 is not applied', ['alter function public.fv_owns_course(uuid) set search_path = public'], 'S0-M5 is not applied'),
                ('a function nobody told it about reads student_card',
                 ["create function public.card_report() returns bigint language sql as $f$ select count(*) from student_card where code is not null $f$"], 'public.card_report()'),
                ('a function in another schema reads student_card',
                 ['create schema elsewhere', "create function elsewhere.peek() returns text language plpgsql as $f$ begin return (select code from public.student_card limit 1); end $f$"], 'elsewhere.peek()'),
                ('auth.uid() would not answer with the id issue_cards sets',
                 ["create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$"], 'auth.uid() does not answer')):
            good, said = stopped_by(setup, want)
            ok('guard: %s: the file stops, nothing changed' % label, good, said)
        good, said = stopped_by(["create function public.card_note() returns int language sql as $f$ select 1 -- student_card is mentioned only here\n $f$"], 'never')
        ok('guard: a function that only mentions student_card in a comment does not stop it', said == 'it ran', said)
        ok('after every refusal the catalog and every row are what they were', catalog_and_rows(d) == (cat0, rows0))
        # A lock it cannot get.
        o = d.other(); o.run('begin'); o.run('select * from student_card for update')
        t0 = time.time(); r = d.statements(STATEMENTS); waited = time.time() - t0
        o.run('rollback'); o.close()
        ok('with a card row held by another session it gives up after five seconds, at its guard, with nothing changed (%.1f s)' % waited,
           r.startswith('STOPPED') and 'lock timeout' in r and d.at == 2 and 4 < waited < 9 and catalog_and_rows(d) == (cat0, rows0), r)

        # ── The apply ───────────────────────────────────────────────────
        r = d.migrate()
        ok('the file applies', r == 'ok', r)
        cat1, rows1 = catalog_and_rows(d)
        cols = [x[0] for x in d.all("select attname from pg_attribute where attrelid = 'public.student_card'::regclass and attnum > 0 and not attisdropped order by attnum")]
        ok('student_card has no code, code_hash, salt or password column; it has code_hmac, pw_hmac, key_id and seq',
           cols == ['id', 'enrollment_id', 'created_at', 'printed_at', 'last_opened_at', 'wrong_tries', 'wrong_times', 'locked_at', 'stopped_at', 'works_until',
                    'code_hmac', 'pw_hmac', 'key_id', 'seq'], cols)
        ok('every card that was live is stopped (3 were), and the one already stopped keeps its time',
           d.one('select count(*) from student_card where stopped_at is null') == 0
           and d.one('select count(*) from student_card where stopped_at = (select max(stopped_at) from student_card)') == 3
           and d.one('select stopped_at < (select max(stopped_at) from student_card) from student_card where id = :i', i=first))
        ok('nothing else about a card changed: when it was made, printed and last opened, its wrong tries and its last day',
           row_checksums(d.c, {'public.student_card': kept}) == cards0)
        ok('no old card has a tag: nothing was made from a code that had been readable',
           d.one('select count(*) from student_card where code_hmac is not null or pw_hmac is not null or key_id is not null') == 0)
        ok("each student's cards are numbered in the order they were made: the replaced card is 1, its replacement 2, the others 1",
           d.all('select seq from student_card where enrollment_id = :e order by created_at, id', e=ENR1) == [[1], [2]]
           and d.all('select distinct seq from student_card where enrollment_id <> :e', e=ENR1) == [[1]])
        ok("the phone that was signed in is told its card was replaced, and its session rows are as they were",
           d.page(token, ENR1) == {'ok': False, 'error': 'card_stopped'}
           and rows1['student_submit.device_session'] == rows0['student_submit.device_session']
           and rows1['student_submit.device_session_enrollment'] == rows0['student_submit.device_session_enrollment'])
        ok('the remembered answers of the three card calls are deleted, and no other remembered answer',
           d.one("select count(*) from fv_idempotency where endpoint in ('issue_student_cards', 'reissue_student_card', 'unlock_student_card')") == 0
           and d.one('select count(*) from fv_idempotency') == rows0['public.fv_idempotency'][0] - 4)
        differ = sorted(t for t in rows0 if rows1.get(t) != rows0[t])
        ok('no row of any other table changed (%d tables compared)' % len(rows0), differ == ['public.fv_idempotency', 'public.student_card'], differ)
        ok('one new table, empty: the key id last seen', sorted(set(rows1) - set(rows0)) == ['student_submit.card_key'] and rows1['student_submit.card_key'][0] == 0)
        if can_read_files:
            raw = file_bytes(d)
            ok("the table was rewritten: its file on disk holds none of the old codes, hashes or salts",
               raw is not None and not any(x.encode() in raw for r in old.values() for x in (r[2], r[3], r[4])), 'still there')
            idem = file_bytes(d, 'public.fv_idempotency')
        # What the catalog lost and gained.
        gone, new = differences(cat0, cat1)
        about = re.compile(r'student_card|card_key|_issue_access_code|_issue_report_code|student_submit\.(card|verify_card|_card_lookup|issue_cards|_as_teacher|_card_key_seen)\(|^(depends|comments on|dropped columns|internal triggers|made here) ')
        ok('every catalog line that changed is about the cards, the key table, the functions the header lists or the two slip issuers (%d lines gone, %d new)' % (len(gone), len(new)),
           all(about.search(l) for l in gone + new), [l for l in gone + new if not about.search(l)][:5])
        fps1 = {r[0]: r[1] for r in d.all("""select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                             where n.nspname in ('public', 'student_submit', 'fv_private', 'auth') and p.prokind in ('f', 'p')""")}
        changed = sorted(f for f in set(fps0) | set(fps1) if fps0.get(f) != fps1.get(f))
        ok('fifteen functions differ and no other: six dropped, three changed, six new. open, verify, check, submit, page, seen, done and _returned_grade are byte for byte what they were',
           changed == sorted(['_issue_access_code(uuid,uuid,timestamp with time zone)', '_issue_report_code(uuid,uuid,timestamp with time zone)', '_issue_student_card(uuid,text)',
                              'issue_student_cards(uuid,uuid[],uuid)', 'reissue_student_card(uuid,uuid)', '_student_card_json(uuid)',
                              'student_submit._card_lookup(text,text)', 'student_submit.card(text,text)', 'student_submit.verify_card(text,text,text,text,text,text,boolean)',
                              'student_submit._as_teacher(uuid)', 'student_submit._card_key_seen(text)', 'student_submit._card_lookup(text,text,text)',
                              'student_submit.card(text,text,text)', 'student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                              'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)']), changed)
        ok('the two functions that draw slip codes are exactly their definitions from before Batch A',
           fps1['_issue_access_code(uuid,uuid,timestamp with time zone)'] == '1c4eab088284f90c919d07ba35ffc14d'
           and fps1['_issue_report_code(uuid,uuid,timestamp with time zone)'] == '020cb811d2214dd5866cc2cf4ab705eb')
        # The header's two lists are the guard's, and the guard's are the truth.
        guard = TEXT[TEXT.index('do $guard$'):TEXT.index('$guard$;')]
        triples = re.findall(r"\('([a-z_.]+\([a-z,\[\]_]*\))',\s*'([0-9a-f]{32}|absent)',\s*'([0-9a-f]{32}|absent)'\)", guard)
        header = TEXT[:TEXT.index('\nbegin;')]
        was_list = header[header.index('It stops, with nothing changed, unless:'):header.index('On a second run')]
        left_list = header[header.index('On a second run'):header.index('Its last steps')]
        ok('the header prints the fingerprint of every function the guard checks, before and after (15 functions)',
           len(triples) == 15 and all(was == 'absent' or was in was_list for fn, was, becomes in triples)
           and all(becomes == 'absent' or becomes in left_list for fn, was, becomes in triples))
        now = fingerprints(d, [t[0] for t in triples])
        ok('and after the apply each is what the header says it leaves', all((now[fn] or 'absent') == becomes for fn, was, becomes in triples),
           [(fn, now[fn]) for fn, was, becomes in triples if (now[fn] or 'absent') != becomes])

        # ── Slips are untouched and still issue ─────────────────────────
        ok('the slip printed before still opens', d.service("student_submit.open(:c, 'ip-1')", c=slip).get('kind') == 'questionnaire')
        slip2 = d.teacher('issue_access_codes(:q, :ids::uuid[], :k)', q=q['id'], ids='{%s}' % ENR2, k=nid())[0]['code']
        ok('a new questionnaire slip is issued, six characters, and opens', re.fullmatch(r'[A-Z0-9]{3}-[A-Z0-9]{3}', slip2) and d.service("student_submit.open(:c, 'ip-1')", c=slip2).get('kind') == 'questionnaire', slip2)
        students = json.dumps([{'enrollment_id': ENR1, 'data': {'v': 1, 'first': 'Cece', 'overall': {'text': '3.0', 'level': 3, 'word': 'Proficient'}}}])
        rep = d.teacher("create_phone_report(:c, 1, 'Report 1', (:d::date + 30), :s::jsonb, :k)", c=COURSE_A, d=TODAY, s=students, k=nid())
        rcodes = d.teacher('issue_report_codes(:r, null, :k)', r=rep['id'], k=nid())
        ok('a new report slip is issued and opens (the other issuer this file patched)',
           re.fullmatch(r'[A-Z0-9]{3}-[A-Z0-9]{3}', rcodes[0]['code']) and d.service("student_submit.open(:c, 'ip-1')", c=rcodes[0]['code']).get('ok') is True, rcodes)

        # ── The old ways in are gone; who can reach what ────────────────
        for sig in ('public.issue_student_cards(uuid,uuid[],uuid)', 'public.reissue_student_card(uuid,uuid)', 'public._issue_student_card(uuid,text)',
                    'student_submit.card(text,text)', 'student_submit.verify_card(text,text,text,text,text,text,boolean)', 'student_submit._card_lookup(text,text)'):
            ok('%s is gone' % sig.split('(')[0] + ('' if 'student_submit' not in sig else ' with its old arguments'), d.one('select to_regprocedure(:s) is null', s=sig))
        e = refused(d, lambda: d.service("student_submit.card(:c, 'ip-1')", c=code1))
        ok('an edge function from before this file, calling card(code, address), gets an error and opens nothing', e is not None and 'does not exist' in e[0], e)
        e = refused(d, lambda: d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid()))
        ok("the site as released, calling issue_student_cards, gets an error (Make Cards fails until the release)", e is not None and 'does not exist' in e[0], e)
        for role in ('anon', 'authenticated'):
            e = refused(d, lambda: d.role(role, 'select * from public.student_card', uid=A if role == 'authenticated' else None))
            ok('%s cannot read student_card' % ('a signed-in teacher' if role == 'authenticated' else 'anon'), e is not None and 'permission denied' in e[0], e)
            e = refused(d, lambda: d.role(role, 'select * from student_submit.card_key'))
            ok('%s cannot read the key id table' % role, e is not None and 'permission denied' in e[0], e)
        ok('student_card keeps row security on and has no policy at all',
           d.one("select relrowsecurity from pg_class where oid = 'public.student_card'::regclass") and d.one("select count(*) from pg_policy where polrelid = 'public.student_card'::regclass") == 0)
        ok('no function in student_submit can be run by anon or a signed-in teacher',
           d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'
                     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))""") == 0)
        ok('the service role can run card, verify_card and issue_cards, and none of their helpers',
           sorted(r[0] for r in d.all("""select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit'
                     and p.proname in ('card', 'verify_card', 'issue_cards', '_card_lookup', '_as_teacher', '_card_key_seen')
                     and has_function_privilege('service_role', p.oid, 'execute')""")) == ['card', 'issue_cards', 'verify_card'])
        ok('no function in public that a signed-in teacher can run names a tag column',
           d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                     and has_function_privilege('authenticated', p.oid, 'execute') and p.prosrc ~ 'code_hmac|pw_hmac'""") == 0)
        ok("no function in the app's schemas calls a keyed-hash function: the database cannot make a tag",
           d.one(r"""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosrc ~* '(^|[^a-z_])hmac\s*\('""") == 0)
        ok('every SECURITY DEFINER function in the three schemas still names pg_temp last',
           d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
                     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')""") == 0)
        ok('the list of cards is empty: no student has a card', d.teacher('list_student_cards(:c)', c=COURSE_A) == [])
        ok('Unlock, Unlock All, Cards Work Until and Mark Printed still answer',
           d.teacher('unlock_all_student_cards(:c, :k)', c=COURSE_A, k=nid()) == {'unlocked': 0}
           and d.teacher("set_cards_work_until(:c, '2027-06-30'::date, :k)", c=COURSE_A, k=nid()) == {'works_until': '2027-06-30'}
           and d.teacher('mark_student_cards_printed(:ids::uuid[], :k)', ids='{%s}' % first, k=nid()) == {'printed': 0}
           and 'code' not in d.teacher('unlock_student_card(:i, :k)', i=first, k=nid()))

        # ── A card made since, and a second run ─────────────────────────
        code, pw, row = d.make(ENR1)
        ok('a card made the new way opens', d.card(code).get('ok') is True and row['seq'] == 3, row)
        token2 = d.verify(code, birthday='2012-05-15')['session_token']
        cat2, rows2 = catalog_and_rows(d)
        r = d.migrate()
        cat3, rows3 = catalog_and_rows(d)
        ok('the file runs a second time', r == 'ok', r)
        ok('a second run changes no catalog line and no row of any table', cat3 == cat2 and rows3 == rows2,
           (differences(cat2, cat3), [t for t in rows2 if rows3.get(t) != rows2[t]]))
        ok('and stops no card made since the first: it is still live, still opens, and its phone is still signed in',
           d.one('select count(*) from student_card where stopped_at is null') == 1 and d.card(code).get('ok') is True and d.page(token2, ENR1).get('ok') is True)
        d.begin()
        d.run(d.one("select pg_get_functiondef('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)'::regprocedure)").replace('at most 250', 'at most  250'))
        try:
            for st in STATEMENTS:
                if last(st) not in ('begin', 'commit'): d.run(st)
            said = 'it ran'
        except Exception as e:
            said = message(e)
        d.rollback()
        ok('a second run on a database where one of its own functions was changed by hand stops at its guard',
           'this file has been applied, but student_submit.issue_cards' in said and 'Nothing was changed' in said, said)
        if can_read_files:
            raw = file_bytes(d)
            ok("with a new card in it, the table's file holds a tag and still no code: not the old ones, not the new one",
               code_tag(code).encode() in raw and code.encode() not in raw and not any(x.encode() in raw for r in old.values() for x in (r[2], r[3], r[4])))
    finally:
        d.close()

    # What the rewrite is for: the same drop without it.
    d = Db('norewrite')
    try:
        seed(d)
        d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid())
        codes = [r[0] for r in d.all('select code from student_card')]
        if file_bytes(d) is not None:
            d.run('update student_card set stopped_at = now()')
            d.run('alter table public.student_card drop column code cascade, drop column code_hash, drop column salt, drop column password')
            raw = file_bytes(d)
            ok('why the file rewrites the table: after the same drop without a rewrite, the codes are still in the file on disk', all(x.encode() in raw for x in codes))
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def applied(tag):
    d = Db(tag); k = seed(d)
    r = d.migrate()
    if r != 'ok': raise SystemExit('the migration did not apply: ' + r)
    return d, k

def scen_cards():
    d, k = applied('cards')
    try:
        call = 'student_submit.issue_cards(:t, :c, :i::jsonb, :k, :d)'
        def raw(items, teacher=A, course=COURSE_A, key=KEY_ID, idem=None):
            return d.service(call, t=teacher, c=course, i=items if isinstance(items, str) else json.dumps(items), k=key, d=idem)
        card_cols = table_columns(d.c)['public.student_card']
        def cards_sum(): return row_checksums(d.c, {'public.student_card': card_cols})['public.student_card']
        def everywhere(needle):
            """How many rows, of every table in the database, hold this text anywhere."""
            n = 0
            for t in table_columns(d.c):
                n += d.one('select count(*) from %s x where to_jsonb(x)::text like :n' % t, n='%' + needle + '%')
            return n

        # ── The owner can ───────────────────────────────────────────────
        reply, p = d.issue([(ENR2, None), (ENR1, None)], idem=(first_key := nid()))
        got = p.codes(reply)
        r1, r2 = got[ENR1][2], got[ENR2][2]
        ok('issue_cards makes a card for each student named, and answers in the order of the request',
           reply['replayed'] is False and [x['enrollment_id'] for x in reply['results']] == [ENR2, ENR1] and all(x['result'] == 'made' for x in reply['results']), reply)
        ok('each result has the card id, its number, its last day, which candidate was used and whether it has a password, and nothing else',
           set(r1) == {'enrollment_id', 'result', 'card_id', 'seq', 'works_until', 'candidate', 'has_password'} and r1['seq'] == 1 and r1['candidate'] == 0, r1)
        ok('a student with a birthday gets no card password; a student with nothing on file gets one', r1['has_password'] is False and r2['has_password'] is True)
        stored = {x[0]: x for x in d.all('select enrollment_id, code_hmac, pw_hmac, key_id, seq, works_until::text, id from student_card where stopped_at is null')}
        ok("what is stored is the tag of the first candidate's code, the key's id, and a password tag only where the student has nothing else on file",
           stored[ENR1][1] == code_tag(got[ENR1][0]) and stored[ENR1][2] is None and stored[ENR1][3] == KEY_ID
           and stored[ENR2][1] == code_tag(got[ENR2][0]) and stored[ENR2][2] == pw_tag(got[ENR2][0], p.drawn[ENR2][0][1]), stored)
        ok('the reply holds no tag at all', not HEX64.search(json.dumps(reply)))
        code1, code2 = got[ENR1][0], got[ENR2][0]; pw2 = got[ENR2][1]
        ok('no table in the database holds either code, with or without its dash, in any row',
           everywhere(code1) == 0 and everywhere(code2) == 0 and everywhere(code1[:4] + '-' + code1[4:]) == 0)
        ok('both cards open by their tag', d.card(code1).get('ok') is True and d.card(code2).get('check') == 'password')
        june30 = d.one("""select make_date(extract(year from x.t)::int + case when x.t > make_date(extract(year from x.t)::int, 6, 30) then 1 else 0 end, 6, 30)::text
                            from (select (now() at time zone 'America/Vancouver')::date as t) x""")
        ok("a new card's last day is the class's Cards Work Until (here the default, the next June 30)", r1['works_until'] == june30 and stored[ENR1][5] == june30, (r1, june30))
        listed = d.cards()
        ok('the Student Cards list shows the card with its number and no code or password',
           set(listed[ENR1]) == {'id', 'enrollment_id', 'seq', 'created_at', 'printed_at', 'last_opened_at', 'locked_at', 'wrong_tries', 'wrong_tries_7d', 'works_until',
                                 'check', 'has_password', 'needs_new'}
           and listed[ENR1]['seq'] == 1 and listed[ENR1]['check'] == 'identity' and listed[ENR1]['has_password'] is False and listed[ENR1]['needs_new'] is False
           and listed[ENR2]['check'] == 'password' and listed[ENR2]['has_password'] is True, listed[ENR1])
        ok('nothing in that list is a tag', not HEX64.search(json.dumps(listed)))
        ok('the request is remembered under the teacher it was made for', d.all("select teacher_id, endpoint from fv_idempotency where endpoint = 'issue_cards'") == [[A, 'issue_cards']])
        ok('and the key id the function called with is remembered', d.all('select key_id from student_submit.card_key') == [[KEY_ID]])

        # ── A replay ────────────────────────────────────────────────────
        before = cards_sum()
        again = raw(p.items, idem=first_key)
        ok('the same idempotency key again: replayed, the same result for each student without the candidate, and nothing made',
           again == {'replayed': True, 'results': [{kk: v for kk, v in x.items() if kk != 'candidate'} for x in reply['results']]} and cards_sum() == before, again)
        ok('a replay returns no tag, and what was remembered holds none',
           not HEX64.search(json.dumps(again)) and not HEX64.search(json.dumps(d.one("select result from fv_idempotency where endpoint = 'issue_cards'"))))
        fresh = Printed([(ENR1, None), (ENR2, None)])
        again = raw(fresh.items, idem=first_key)
        ok('a replay with other candidates still makes nothing (the first answer stands)', again['replayed'] is True and cards_sum() == before)
        again = raw(p.items, idem=nid())
        ok('the same request under a new key finds each student already has a card: changed, nothing made',
           [x['result'] for x in again['results']] == ['changed', 'changed'] and cards_sum() == before, again)
        again = raw(p.items, idem=None)
        ok('and with no key at all', [x['result'] for x in again['results']] == ['changed', 'changed'] and cards_sum() == before)

        # ── Who it will act for ─────────────────────────────────────────
        e = refused(d, lambda: raw(Printed([(ENR1, stored[ENR1][6])]).items, teacher=B))
        ok("another teacher's id on this class: course not found, and nothing changes", e is not None and 'course not found' in e[0] and e[1] == 'P0002' and cards_sum() == before, e)
        e = refused(d, lambda: raw(Printed([(ENR1, stored[ENR1][6])]).items, teacher=nid()))
        ok('an id that is no teacher is refused', e is not None and 'not a teacher' in e[0] and e[1] == 'PT401' and cards_sum() == before, e)
        e = refused(d, lambda: raw(Printed([(ENR1, stored[ENR1][6])]).items, teacher=None))
        ok('no teacher id is refused', e is not None and 'not a teacher' in e[0], e)
        with tx(d):
            d.run('update teacher set deleted_at = now() where id = :t', t=A)
            e = refused(d, lambda: raw(Printed([(ENR1, stored[ENR1][6])]).items))
            ok('a deleted teacher is refused', e is not None and 'not a teacher' in e[0], e)
        with tx(d):
            d.run('update course set deleted_at = now() where id = :c', c=COURSE_A)
            e = refused(d, lambda: raw(Printed([(ENR1, stored[ENR1][6])]).items))
            ok('a deleted class: course not found', e is not None and 'course not found' in e[0], e)
        e = refused(d, lambda: raw(Printed([(ENR_B, None)]).items, teacher=A, course=COURSE_B))
        ok("Teacher A's id on Teacher B's class: course not found", e is not None and 'course not found' in e[0], e)
        reply_b, pb = d.issue([(ENR_B, None)], course=COURSE_B, teacher=B)
        ok('Teacher B makes cards for their own class', reply_b['results'][0]['result'] == 'made')
        for role in ('anon', 'authenticated'):
            for name, sql in (('issue_cards', "select student_submit.issue_cards('%s', '%s', '[]'::jsonb, '%s', null)" % (A, COURSE_A, KEY_ID)),
                              ('_as_teacher', "select student_submit._as_teacher('%s')" % A),
                              ('card', "select student_submit.card('%s', '%s', 'x')" % ('a' * 64, KEY_ID)),
                              ('verify_card', "select student_submit.verify_card('%s', '%s', null, null, null, null, 'x', false)" % ('a' * 64, KEY_ID))):
                e = refused(d, lambda: d.role(role, sql, uid=B if role == 'authenticated' else None))
                ok('%s cannot run %s' % (role, name), e is not None and 'permission denied' in e[0], e)
        e = refused(d, lambda: d.role('service_role', "select student_submit._as_teacher('%s')" % A))
        ok('not even the service role can call _as_teacher by itself', e is not None and 'permission denied' in e[0], e)

        # ── The caller's id is put back ─────────────────────────────────
        with tx(d):
            d.run("select set_config('request.jwt.claim.sub', :u, true)", u=B)
            d.run("select set_config('request.jwt.claims', :j, true)", j='{"sub": "%s", "role": "authenticated"}' % B)
            new_reply, _ = d.issue([(ENR1, stored[ENR1][6])])
            ok('issue_cards acts as the teacher it is given whoever the session was before (the card is made for Teacher A)', new_reply['results'][0]['result'] == 'made', new_reply)
            ok('and puts the caller back as it found it before it returns',
               d.one("select current_setting('request.jwt.claim.sub', true)") == B and json.loads(d.one("select current_setting('request.jwt.claims', true)"))['sub'] == B)
        ok('on a connection with no caller at all, none is left behind: auth.uid() is null after a call',
           raw([]) == {'replayed': False, 'results': []} and d.one('select auth.uid()') is None
           and (d.one("select current_setting('request.jwt.claim.sub', true)") or '') == '')
        with tx(d):
            # Supabase's own auth.uid(), which reads either setting.
            d.run("""create or replace function auth.uid() returns uuid language sql stable as $f$
                     select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                                     (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$""")
            a = refused(d, lambda: raw(Printed([(ENR1, stored[ENR1][6])]).items, teacher=B))
            b, _ = d.issue([(ENR1, stored[ENR1][6])])
            ok("with Supabase's own auth.uid() (it reads either setting) ownership is decided the same: Teacher B refused, Teacher A's card made",
               a is not None and 'course not found' in a[0] and b['results'][0]['result'] == 'made', (a, b))
            d.run("""create or replace function auth.uid() returns uuid language sql stable as $f$
                     select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$""")
            b, _ = d.issue([(ENR2, stored[ENR2][6])])
            ok('and with one that reads only request.jwt.claims', b['results'][0]['result'] == 'made', b)

        # ── replaces: the card the browser believes is live ─────────────
        live1, live2 = stored[ENR1][6], stored[ENR2][6]
        stale = [('no card named, but the student has one', None), ('a card id that does not exist', nid()), ("another student's live card", live2)]
        for label, named in stale:
            before = cards_sum()
            rep, _ = d.issue([(ENR1, named)])
            ok('replaces is %s: changed, and nothing changes' % label, rep['results'] == [{'enrollment_id': ENR1, 'result': 'changed'}] and cards_sum() == before, rep)
        rep, p2 = d.issue([(ENR1, live1)])
        n1 = p2.codes(rep)[ENR1]
        ok('replaces names the live card: it is stopped and the new card is number 2', n1[2]['result'] == 'made' and n1[2]['seq'] == 2
           and d.one('select stopped_at is not null from student_card where id = :i', i=live1) and d.one('select count(*) from student_card where enrollment_id = :e and stopped_at is null', e=ENR1) == 1, rep)
        ok('the old card answers that it was replaced, the new one opens', d.card(code1) == {'ok': False, 'error': 'card_stopped'} and d.card(n1[0]).get('ok') is True)
        before = cards_sum()
        rep, _ = d.issue([(ENR1, live1)])
        ok('replaces names a card that was already replaced (a second press, another tab): changed, nothing changes',
           rep['results'][0]['result'] == 'changed' and cards_sum() == before, rep)
        ok('the Student Cards list shows the new card only', d.cards()[ENR1]['id'] == n1[2]['card_id'] and d.cards()[ENR1]['seq'] == 2)

        # ── Who is skipped ──────────────────────────────────────────────
        with tx(d):
            d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR2)
            before = cards_sum()
            rep, _ = d.issue([(ENR2, live2), (ENR1, n1[2]['card_id'])])
            ok("a withdrawn student is skipped (not_found) and keeps the card they had; the rest of the request goes on",
               [x['result'] for x in rep['results']] == ['not_found', 'made'] and d.one('select stopped_at is null from student_card where id = :i', i=live2), rep)
        before = cards_sum()
        rep, _ = d.issue([(ENR_B, None), (k['enr_a2'], None), (nid(), None)])
        ok("a student of another teacher's class, a student of another class of the teacher's own, and an id that is nobody: not_found, nothing made",
           [x['result'] for x in rep['results']] == ['not_found'] * 3 and cards_sum() == before, rep)

        # ── Both or neither; the second candidate ───────────────────────
        taken = d.all('select code_hmac from student_card where code_hmac is not null order by created_at limit 2')
        pc = Printed([(ENR2, live2)])
        pc.items[0]['candidates'][0]['code_hmac'] = taken[0][0]
        rep, _ = d.issue(None, printed=pc)
        got2 = pc.codes(rep)[ENR2]
        ok("when the first candidate's tag is already a card's, the second is used, and the result says so",
           got2[2]['candidate'] == 1 and got2[2]['result'] == 'made' and d.card(got2[0]).get('ok') is True and got2[0] == pc.drawn[ENR2][1][0], rep)
        ok('its password is the second candidate\'s too', d.verify(got2[0], password=pc.drawn[ENR2][1][1]).get('ok') is True
           and d.verify(got2[0], password=pc.drawn[ENR2][0][1] if pc.drawn[ENR2][0][1] != pc.drawn[ENR2][1][1] else 'x').get('error') == 'wrong_identity')
        d.teacher('unlock_all_student_cards(:c, :k)', c=COURSE_A, k=nid())
        live2 = got2[2]['card_id']; code2 = got2[0]; pw2 = got2[1]
        pf = Printed([(ENR2, live2), (ENR1, n1[2]['card_id'])])
        pf.items[0]['candidates'][0]['code_hmac'] = taken[0][0]; pf.items[0]['candidates'][1]['code_hmac'] = taken[1][0]
        rep, _ = d.issue(None, printed=pf)
        ok('when both candidates are taken the result is failed, and the stop is undone with it: the old card is still live and still opens',
           rep['results'][0] == {'enrollment_id': ENR2, 'result': 'failed'} and d.one('select stopped_at is null from student_card where id = :i', i=live2)
           and d.card(code2).get('ok') is True and d.one('select count(*) from student_card where enrollment_id = :e and stopped_at is null', e=ENR2) == 1, rep)
        ok('while the other student in the same request got their card', rep['results'][1]['result'] == 'made' and rep['results'][1]['seq'] == 3, rep)
        ok('a stopped card keeps its tag, so its code can never be issued again: every tag ever stored is still there, each once',
           d.one('select count(*) = count(distinct code_hmac) and count(*) = (select count(*) from student_card) from student_card where code_hmac is not null'))

        # ── A request that is not the right shape is refused whole ──────
        good = lambda: Printed([(ENR1, None)]).items
        def bent(change):
            items = good(); change(items); return items
        cases = [
            ('a tag in upper case', bent(lambda i: i[0]['candidates'][0].__setitem__('code_hmac', i[0]['candidates'][0]['code_hmac'].upper()))),
            ('a tag one character short', bent(lambda i: i[0]['candidates'][0].__setitem__('code_hmac', i[0]['candidates'][0]['code_hmac'][:63]))),
            ('a plain code where the tag goes', bent(lambda i: i[0]['candidates'][0].__setitem__('code_hmac', 'K7M4QX2P'))),
            ('four digits where the password tag goes', bent(lambda i: i[0]['candidates'][1].__setitem__('pw_hmac', '4821'))),
            ('a missing password tag', bent(lambda i: i[0]['candidates'][0].pop('pw_hmac'))),
            ('a tag that is a number', bent(lambda i: i[0]['candidates'][0].__setitem__('code_hmac', 7))),
            ('one candidate', bent(lambda i: i[0]['candidates'].pop())),
            ('three candidates', bent(lambda i: i[0]['candidates'].append(dict(i[0]['candidates'][0], code_hmac='b' * 64)))),
            ('candidates that are not a list', bent(lambda i: i[0].__setitem__('candidates', 'x'))),
            ('no candidates', bent(lambda i: i[0].pop('candidates'))),
            ('an enrollment id that is not an id', bent(lambda i: i[0].__setitem__('enrollment_id', 'cece'))),
            ('no enrollment id', bent(lambda i: i[0].pop('enrollment_id'))),
            ('replaces that is not an id', bent(lambda i: i[0].__setitem__('replaces', 'the old one'))),
            ('an item that is not an object', ['x']),
            ('items that are not a list', {'enrollment_id': ENR1}),
            ('the same student twice', good() + [dict(good()[0])]),
            ('the same code tag twice', bent(lambda i: i[0]['candidates'][1].__setitem__('code_hmac', i[0]['candidates'][0]['code_hmac']))),
            ('251 students', [Printed([(nid(), None)]).items[0] for n in range(251)]),
        ]
        before = cards_sum(); logged = d.one('select count(*) from fv_idempotency')
        for label, items in cases:
            e = refused(d, lambda: raw(items, idem=nid()))
            ok('refused whole: %s' % label, e is not None and e[1] == '22023', e)
        e = refused(d, lambda: raw('null'))
        ok('refused whole: no items', e is not None and e[1] == '22023', e)
        for label, key in (('upper case', KEY_ID.upper()), ('too short', KEY_ID[:7]), ('missing', None), ('the whole key', FAKE_KEY.hex())):
            e = refused(d, lambda: raw(good(), key=key))
            ok('refused whole: a key id that is %s' % label, e is not None and e[1] == '22023', e)
        ok('none of those made a card or remembered a request', cards_sum() == before and d.one('select count(*) from fv_idempotency') == logged)
        ok('no error message repeats what was sent', all('K7M4QX2P' not in (refused(d, lambda: raw(items)) or ('',))[0] for label, items in cases[2:3]))
        rep = raw([Printed([(nid(), None)]).items[0] for n in range(250)])
        ok('250 students in one request is taken', len(rep['results']) == 250 and all(x['result'] == 'not_found' for x in rep['results']))
        rep = raw([dict(good()[0], enrollment_id=ENR1.upper(), replaces=None)])
        ok('an id written in upper case is the same student', rep['results'][0]['result'] == 'changed' and rep['results'][0]['enrollment_id'] == ENR1, rep)

        # ── The table itself refuses a plain code ───────────────────────
        for label, sql in (('a plain code as a tag', "update student_card set code_hmac = 'K7M4QX2P' where id = '%s'" % live2),
                           ('a four-digit password as a tag', "update student_card set pw_hmac = '4821' where id = '%s'" % live2),
                           ('a key as a key id', "update student_card set key_id = '%s' where id = '%s'" % (FAKE_KEY.hex(), live2)),
                           ('a live card with no tag', "update student_card set code_hmac = null where id = '%s'" % live2),
                           ("a tag another card has", "update student_card set code_hmac = '%s' where id = '%s'" % (taken[0][0], live2)),
                           ('a second live card for one student', "update student_card set stopped_at = null where enrollment_id = '%s'" % ENR1),
                           ('a card number the student already has', "update student_card set seq = 1 where enrollment_id = '%s'" % ENR1)):
            e = refused(d, lambda: d.run(sql))
            ok('the table refuses %s, even from the owner' % label, e is not None and ('violates' in e[0]), e)

        # ── needs_new: a card made under another key ────────────────────
        ok('made under the key last seen: needs_new is false', d.cards()[ENR2]['needs_new'] is False)
        d.card(draw_code(), key=OTHER_KEY)     # the functions now run with another key
        ok('after a call with another key id every card made before is marked needs_new',
           d.all('select key_id from student_submit.card_key') == [[OTHER_KEY_ID]] and all(x['needs_new'] for x in d.cards().values()), d.cards())
        ok('and such a card is not recognised under the new key (its tag is another), while nothing stopped it',
           d.card(code2, key=OTHER_KEY) == {'ok': False, 'error': 'not_found'} and d.one('select stopped_at is null from student_card where id = :i', i=live2))
        newkey = d.make(ENR2, key=OTHER_KEY)
        ok('a card made under the new key is not marked', d.cards()[ENR2]['needs_new'] is False and d.cards()[ENR1]['needs_new'] is True)
        d.card(draw_code())                    # the right key returns
        ok('when the first key returns the marks swap back: the marker stops nothing', d.cards()[ENR1]['needs_new'] is False and d.cards()[ENR2]['needs_new'] is True
           and d.one('select count(*) from student_card where stopped_at is null and enrollment_id in (:a, :b)', a=ENR1, b=ENR2) == 2)
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_lookup():
    d, k = applied('lookup')
    try:
        ENR_A2 = k['enr_a2']; COURSE_A2 = k['course2']
        code1, _, row1 = d.make(ENR1); code2, pw2, row2 = d.make(ENR2); code_a2, _, row_a2 = d.make(ENR_A2, course=COURSE_A2)
        card1, card2 = row1['card_id'], row2['card_id']
        attempts = lambda where="true": d.one("select count(*) from student_submit.attempt where route = 'card' and " + where)
        def unlock_all():
            """Every card of the class as new: no lock, no wrong try in a row or in the week."""
            for x in d.cards().values(): d.teacher('unlock_student_card(:i, :k)', i=x['id'], k=nid())

        # ── card ────────────────────────────────────────────────────────
        r = d.card(code1.lower()[:4] + ' - ' + code1.lower()[4:])
        ok('a good code says who it is (the function tidies what was typed before it makes the tag)',
           r == {'ok': True, 'kind': 'card', 'student': {'first_name': 'CeCe'}, 'course': {'name': 'Science 8', 'block': None}, 'check': 'identity', 'also_password': False}, r)
        ok('a card whose student has no birthday or number asks for the card password', d.card(code2).get('check') == 'password')
        n = attempts("outcome = 'not_found'")
        ok('an unknown code is not found, and is logged as a guess', d.card(draw_code()) == {'ok': False, 'error': 'not_found'} and attempts("outcome = 'not_found'") == n + 1)
        ok("a slip's six characters, if the function ever sent their tag, are just an unknown tag", d.card('K7M4QX') == {'ok': False, 'error': 'not_found'})
        ok('card opens no session', d.one('select count(*) from student_submit.device_session') == 0)
        with tx(d):
            d.run('update course set student_page_enabled = false where id = :c', c=COURSE_A)
            ok("a class whose student page is off: closed", d.card(code1) == {'ok': False, 'error': 'closed'})
        with tx(d):
            d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
            ok('a withdrawn student: not found', d.card(code1) == {'ok': False, 'error': 'not_found'})
        with tx(d):
            d.run('update course set deleted_at = now() where id = :c', c=COURSE_A)
            ok('a deleted class: not found', d.card(code1) == {'ok': False, 'error': 'not_found'})
        with tx(d):
            d.teacher('set_cards_work_until(:c, (:d::date - 1), :k)', c=COURSE_A, d=TODAY, k=nid())
            ok('a card past its last day: card_expired', d.card(code1) == {'ok': False, 'error': 'card_expired'} and d.verify(code1, birthday='2012-05-15') == {'ok': False, 'error': 'card_expired'})
            d.teacher('set_cards_work_until(:c, :d::date, :k)', c=COURSE_A, d=TODAY, k=nid())
            ok('a card works through its last day', d.card(code1).get('ok') is True)

        # ── A caller that sends the wrong shape ─────────────────────────
        n = attempts()
        for label, sql, kw in (('a code where the tag goes', 'student_submit.card(:h, :k, :i)', dict(h=code1, k=KEY_ID, i='ip-1')),
                               ('a tag in upper case', 'student_submit.card(:h, :k, :i)', dict(h=code_tag(code1).upper(), k=KEY_ID, i='ip-1')),
                               ('no tag', 'student_submit.card(:h, :k, :i)', dict(h=None, k=KEY_ID, i='ip-1')),
                               ('a key id that is not one', 'student_submit.card(:h, :k, :i)', dict(h=code_tag(code1), k='nope', i='ip-1')),
                               ('no key id', 'student_submit.card(:h, :k, :i)', dict(h=code_tag(code1), k=None, i='ip-1')),
                               ('four digits where the password tag goes', 'student_submit.verify_card(:h, :k, null, null, :p, null, :i, false)', dict(h=code_tag(code2), k=KEY_ID, p=pw2, i='ip-1')),
                               ('an empty password tag', 'student_submit.verify_card(:h, :k, null, null, :p, null, :i, false)', dict(h=code_tag(code2), k=KEY_ID, p='', i='ip-1')),
                               ('a code where the tag goes, to verify_card', 'student_submit.verify_card(:h, :k, null, null, null, null, :i, false)', dict(h=code1, k=KEY_ID, i='ip-1'))):
            e = refused(d, lambda: d.service(sql, **kw))
            ok('%s is an error, not an answer' % label, e is not None and e[1] == '22023' and code1 not in e[0] and pw2 not in e[0], e)
        ok('none of those was logged, counted as a wrong try or changed the key id', attempts() == n and d.one('select sum(wrong_tries) from student_card') == 0
           and d.all('select key_id from student_submit.card_key') == [[KEY_ID]])

        # ── verify_card: the identity check and the locks ───────────────
        r = d.verify(code1, birthday='2012-05-16')
        ok('a wrong birthday is refused, with the tries left', r == {'ok': False, 'error': 'wrong_identity', 'tries_left': 4}, r)
        for left in (3, 2, 1):
            r = d.verify(code1, number='nope')
            ok('wrong try: %d left' % left, r == {'ok': False, 'error': 'wrong_identity', 'tries_left': left}, r)
        r = d.verify(code1, birthday='not a date')
        ok('the fifth wrong try in a row locks the card', r == {'ok': False, 'error': 'card_locked'}, r)
        ok('a locked card says so, even with the right birthday',
           d.card(code1) == {'ok': False, 'error': 'card_locked'} and d.verify(code1, birthday='2012-05-15') == {'ok': False, 'error': 'card_locked'})
        ok('the Student Cards list shows the lock and the count', d.cards()[ENR1]['locked_at'] is not None and d.cards()[ENR1]['wrong_tries'] == 5)
        ok('no session was opened by any of that', d.one('select count(*) from student_submit.device_session') == 0)
        r = d.teacher('unlock_student_card(:i, :k)', i=card1, k=nid())
        ok('Unlock clears the lock and the count, and returns the card with no code', r['locked_at'] is None and r['wrong_tries'] == 0 and r['seq'] == 1 and 'code' not in r and 'password' not in r, r)
        for n in range(4): d.verify(code1, birthday='2000-01-01')
        ok('four wrong tries, then a right one: the count goes back to zero', d.verify(code1, birthday='2012-05-15').get('ok') is True and d.cards()[ENR1]['wrong_tries'] == 0)
        for n in range(4): d.verify(code1, birthday='2000-01-01')
        ok('so the next four wrong tries do not lock it: only five in a row do',
           d.cards()[ENR1]['locked_at'] is None and d.verify(code1, birthday='2000-01-01') == {'ok': False, 'error': 'card_locked'})
        unlock_all(); d.run('delete from student_submit.device_session')
        r = d.verify(code1, birthday='2012-05-15'); tok = r.get('session_token')
        ok('the right birthday opens a session', r.get('ok') is True and r['enrollment_id'] == ENR1 and re.fullmatch(r'[0-9a-f]{64}', tok or ''), r)
        ok('the session lists the class', r['classes'] == [{'enrollment_id': ENR1, 'student': {'first_name': 'CeCe'}, 'course': {'name': 'Science 8', 'block': None}}], r['classes'])
        ok('last opened is recorded', d.cards()[ENR1]['last_opened_at'] is not None)
        d.run("update student set student_number = 'S-1002' where id = :s", s=STU1)
        ok('the student number opens it too, spaces and case aside', d.verify(code1, number='s 1002').get('ok') is True)
        ok('a wrong try after a right one still counts: 4 left', d.verify(code1, number='S-9999').get('tries_left') == 4)
        unlock_all()
        # The slow lock.
        with tx(d):
            left = []
            for round_ in range(3):
                for n in range(4): left.append(d.verify(code1, birthday='2000-01-01').get('tries_left'))
                d.verify(code1, birthday='2012-05-15')
            r13 = d.verify(code1, birthday='2000-01-01'); r14 = d.verify(code1, birthday='2000-01-01'); r15 = d.verify(code1, birthday='2000-01-01')
            ok('the slow lock: tries left counts down in each round of four, and the fifteenth wrong try inside 7 days locks the card though no five were in a row',
               left == [4, 3, 2, 1] * 3 and [r13.get('tries_left'), r14.get('tries_left')] == [2, 1] and r15 == {'ok': False, 'error': 'card_locked'}
               and d.cards()[ENR1]['wrong_tries'] == 3, (left, r13, r14, r15))
            r = d.teacher('unlock_student_card(:i, :k)', i=card1, k=nid())
            ok("Unlock clears the week's count too", r['wrong_tries_7d'] == 0 and d.verify(code1, birthday='2000-01-01').get('tries_left') == 4, r)

        # ── The password, by its tag only ───────────────────────────────
        r = d.verify(code2, password=pw2); tok2 = r.get('session_token')
        ok('the card password opens a card with nothing else on file', r.get('ok') is True and r['enrollment_id'] == ENR2, r)
        other = '0000' if pw2 != '0000' else '1111'
        ok('a wrong password is a wrong try', d.verify(code2, password=other) == {'ok': False, 'error': 'wrong_identity', 'tries_left': 4})
        def with_tag(tag):
            return d.service('student_submit.verify_card(:h, :k, null, null, :p, null, :i, false)', h=code_tag(code2), k=KEY_ID, p=tag, i='ip-1')
        ok("the right four digits tagged for another card do not open this one: the tag binds the password to its card",
           with_tag(pw_tag(code1, pw2)).get('error') == 'wrong_identity')
        ok("nor does the card's own code tag sent as the password, nor the right digits under another key",
           with_tag(code_tag(code2)).get('error') == 'wrong_identity' and with_tag(pw_tag(code2, pw2, OTHER_KEY)).get('error') == 'wrong_identity')
        ok('five wrong passwords lock the card as wrong birthdays do', d.verify(code2, password=other) == {'ok': False, 'error': 'card_locked'}
           and d.verify(code2, password=pw2) == {'ok': False, 'error': 'card_locked'})
        unlock_all()
        ok('no password typed, on a card that asks for one, is a wrong try', d.verify(code2).get('error') == 'wrong_identity')
        ok('the database holds the password nowhere: no row of student_card or student has the four digits as a value',
           d.one("select count(*) from student_card where :p in (code_hmac, pw_hmac, key_id)", p=pw2) == 0)
        unlock_all()
        with tx(d):
            ok('before: the card with nothing else on file asks for its password', d.card(code2)['check'] == 'password')
            d.run("update student set date_of_birth = '2011-01-02' where id = :s", s=STU2)
            r = d.card(code2)
            ok('a birthday is added: the card asks for it, and still offers the password', r['check'] == 'identity' and r['also_password'] is True, r)
            ok('the password printed on the card still works, and so does the birthday', d.verify(code2, password=pw2).get('ok') is True and d.verify(code2, birthday='2011-01-02').get('ok') is True)
            ok('the list says what Is This You? asks now, and that the card has a password of its own', d.cards()[ENR2]['check'] == 'identity' and d.cards()[ENR2]['has_password'] is True)
            c3, p3, r3 = d.make(ENR2)
            ok('a card made after the birthday has no password: none is returned and no tag is kept', p3 is None and r3['has_password'] is False
               and d.one('select pw_hmac is null from student_card where id = :i', i=r3['card_id']))
        unlock_all()
        with tx(d):
            d.run("update student set date_of_birth = null, student_number = null where id = :s", s=STU1)
            ok('a card with nothing on file to check says reprint', d.card(code1) == {'ok': False, 'error': 'reprint'})
            got = [d.verify(code1, birthday='2012-05-15', password='1234') for n in range(6)]
            ok('verify_card says the same and counts no wrong try, so it never locks', all(x == {'ok': False, 'error': 'reprint'} for x in got)
               and d.all('select wrong_tries, locked_at from student_card where id = :i', i=card1) == [[0, None]], got[:2])
            ok('the list shows it: asks for a password, has none', d.cards()[ENR1]['check'] == 'password' and d.cards()[ENR1]['has_password'] is False)

        # ── A card that was replaced ────────────────────────────────────
        with tx(d):
            n_guess = attempts("outcome in ('not_found', 'bad_format', 'ambiguous')"); n_stopped = attempts("outcome = 'card_stopped'")
            new1 = d.make(ENR1)
            ok('a replaced card answers card_stopped from card and from verify_card, right answer or not',
               d.card(code1) == {'ok': False, 'error': 'card_stopped'} and d.verify(code1, birthday='2012-05-15') == {'ok': False, 'error': 'card_stopped'})
            ok("it is logged with the card's id and class, and not as a guess",
               attempts("outcome = 'card_stopped' and code_id = '%s' and course_id = '%s'" % (card1, COURSE_A)) == n_stopped + 2
               and attempts("outcome in ('not_found', 'bad_format', 'ambiguous')") == n_guess)
            d.run("insert into student_submit.attempt (route, outcome, ip_hash, code_id) select 'card', 'card_stopped', 'ip-class', :i from generate_series(1, 400)", i=card1)
            ok("a whole class scanning replaced cards, 400 times from one address, locks nobody out: a new card still opens there",
               d.card(code1, ip='ip-class') == {'ok': False, 'error': 'card_stopped'} and d.card(new1[0], ip='ip-class').get('ok') is True)
            ok('the session the old card opened stops showing that class, and says why', d.page(tok, ENR1) == {'ok': False, 'error': 'card_stopped'})
            r = d.verify(new1[0], birthday='2012-05-15', token=tok, add=True)
            ok('the new card opens the same class again on that phone', r.get('ok') is True and d.page(tok, ENR1).get('ok') is True)
            with tx2(d):
                d.run('update enrollment set withdrawn_at = now() where id = :e', e=ENR1)
                ok('a replaced card of a withdrawn student still just says it was replaced', d.card(code1) == {'ok': False, 'error': 'card_stopped'})

        # ── The per-address limit ───────────────────────────────────────
        with tx(d):
            d.run("insert into student_submit.attempt (route, outcome, ip_hash) select 'card', 'not_found', 'ip-guess' from generate_series(1, 298)")
            d.card(draw_code(), ip='ip-guess')
            ok('299 unknown codes from one address in 15 minutes still let a good card through',
               d.card(code1, ip='ip-guess').get('ok') is True and d.verify(code1, birthday='2012-05-15', ip='ip-guess').get('ok') is True)
            d.card(draw_code(), ip='ip-guess')
            ok('the 300th locks that address out: a good card and a right answer from it are refused too',
               d.card(code1, ip='ip-guess') == {'ok': False, 'error': 'locked'} and d.verify(code1, birthday='2012-05-15', ip='ip-guess') == {'ok': False, 'error': 'locked'})
            d.run("update student_submit.attempt set at = at - interval '16 minutes' where ip_hash = 'ip-guess'")
            ok('fifteen minutes later the address is open again', d.card(code1, ip='ip-guess').get('ok') is True)
        with tx(d):
            d.run("insert into student_submit.attempt (route, outcome, ip_hash) select 'card', 'not_found', 'ip-guess' from generate_series(1, 300)")
            ok('another address is unaffected, and a slip from the locked address still gets its own answer',
               d.card(code1, ip='ip-other').get('ok') is True and d.service("student_submit.open('ZZZ-ZZZ', 'ip-guess')") == {'ok': False, 'error': 'not_found'})
            d.run("insert into student_submit.attempt (route, outcome, ip_hash) select 'card', 'not_found', 'ip-' || g from generate_series(1, 5000) g")
            ok('there is no everyone-is-busy stop on the card route: 5,000 unknown codes from other addresses stop nobody', d.card(code1, ip='ip-fresh').get('ok') is True)

        # ── Sessions: Add Another Card, the start screen, Done ──────────
        tok = d.verify(code1, birthday='2012-05-15')['session_token']
        ok('the token is stored only as a hash',
           d.one('select count(*) from student_submit.device_session where token_hash = :t', t=tok) == 0
           and d.one("select count(*) from student_submit.device_session where token_hash = encode(sha256(convert_to(:t, 'UTF8')), 'hex')", t=tok) == 1)
        sessions = d.one('select count(*) from student_submit.device_session')
        r = d.verify(code_a2, birthday='2012-05-15', token=tok, add=True)
        ok('Add Another Card: a second class joins the session the device has, and no new session is made',
           r.get('ok') is True and r['session_token'] is None and [x['course']['name'] for x in r['classes']] == ['Science 8', 'Socials 8']
           and d.one('select count(*) from student_submit.device_session') == sessions, r)
        ok('page opens either class with the one token', d.page(tok, ENR1).get('ok') is True and d.page(tok, ENR_A2)['course']['name'] == 'Socials 8')
        first = d.verify(code1, birthday='2012-05-15')['session_token']
        second = d.verify(code2, password=pw2, token=first)
        ok('a card checked from the start screen starts a new session and signs the last student out',
           second.get('ok') is True and second['session_token'] != first and [x['enrollment_id'] for x in second['classes']] == [ENR2]
           and d.page(first, ENR1) == {'ok': False, 'error': 'signed_out'} and d.page(second['session_token'], ENR1) == {'ok': False, 'error': 'not_found'}, second)
        wrong = d.verify(code1, birthday='2000-01-01', token=second['session_token'])
        ok('a wrong answer from the start screen ends nobody', wrong.get('error') == 'wrong_identity' and d.page(second['session_token'], ENR2).get('ok') is True)
        unlock_all()
        r = d.verify(code_a2, birthday='2012-05-15', token='f' * 64, add=True)
        ok('Add Another Card with no live session starts one', r.get('ok') is True and re.fullmatch(r'[0-9a-f]{64}', r['session_token'] or ''), r)
        ok('the session ends at the next midnight in Vancouver',
           d.one("""select bool_and(expires_at = (((now() at time zone 'America/Vancouver')::date + 1)::timestamp at time zone 'America/Vancouver')) from student_submit.device_session"""))
        t3 = r['session_token']
        ok('Done ends the session', d.service("student_submit.done(:t, 'ip-1')", t=t3) == {'ok': True} and d.page(t3, ENR_A2) == {'ok': False, 'error': 'signed_out'})

        # ── page and seen on a card made the new way ────────────────────
        a_pts = nid(); a_fut = nid()
        d.run("""insert into assessment (id, course_id, title, score_mode, max_points, date_assigned) values
                 (:a, :c, 'Quiz 1', 'points', 10, :d::date), (:b, :c, 'Pop Quiz', 'points', 10, :d::date + 1)""", a=a_pts, b=a_fut, c=COURSE_A, d=TODAY)
        p = d.page(tok, ENR1)
        ok('page gives the student, the class and the assignments already assigned',
           p.get('ok') is True and p['student'] == {'enrollment_id': ENR1, 'first_name': 'CeCe'} and p['course']['name'] == 'Science 8'
           and [x['title'] for x in p['assessments']] == ['Quiz 1'] and p['v'] == 1, p)
        result = lambda: {x['id']: x for x in d.page(tok, ENR1)['assessments']}[a_pts]
        d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=a_pts)
        ok('a draft never comes back from page', result()['grade'] is None and result()['returned_at'] is None)
        d.teacher('return_grades(:a, :ids::uuid[], :k)', a=a_pts, ids='{%s}' % ENR1, k=nid())
        ok('once returned, page gives the grade', result()['grade']['value'] == 7 and result()['returned_at'] is not None, result())
        ok("another student's page shows none of it", {x['id']: x for x in d.page(second['session_token'], ENR2)['assessments']}[a_pts]['grade'] is None)
        r = d.service("student_submit.seen(:t, :e, :ids::uuid[], 'ip-1')", t=tok, e=ENR1, ids='{%s}' % a_pts)
        ok('seen records what the student opened, and it comes back on the page', r == {'ok': True, 'seen': 1} and result()['seen_at'] is not None, r)
        ok('nothing in the page is a tag, a key id or a card number', not HEX64.search(json.dumps(p)) and KEY_ID not in json.dumps(d.page(tok, ENR1)))

        # ── Housekeeping and the log ────────────────────────────────────
        with tx(d):
            d.run("insert into student_submit.attempt (at, route, outcome, ip_hash) values (now() - interval '31 days', 'card', 'not_found', 'old'), (now() - interval '29 days', 'card', 'not_found', 'recent')")
            d.run("insert into student_submit.device_session (token_hash, expires_at) values ('expired', now() - interval '1 minute'), ('alive', now() + interval '1 hour')")
            d.card(draw_code(), ip='ip-sweep')
            ok('a card scan removes log rows older than 30 days and every session past its midnight',
               d.all("select ip_hash from student_submit.attempt where ip_hash in ('old', 'recent')") == [['recent']]
               and d.all("select token_hash from student_submit.device_session where token_hash in ('expired', 'alive')") == [['alive']])
        cols = [x[0] for x in d.all("select column_name from information_schema.columns where table_schema = 'student_submit' and table_name = 'attempt' order by ordinal_position")]
        ok('the log still has no answer, name, code, tag or IP column', cols == ['id', 'at', 'route', 'outcome', 'ip_hash', 'code_id', 'course_id'], cols)
        outcomes = set(x[0] for x in d.all("select distinct outcome from student_submit.attempt where route = 'card'"))
        ok('it records card outcomes', {'ok', 'not_found', 'wrong_identity', 'verified', 'card_locked'} <= outcomes and 'bad_format' not in outcomes, outcomes)
        ok('nothing about the student, the code or its tag is in it',
           d.one("select count(*) from student_submit.attempt where concat_ws(' ', route, outcome, ip_hash) ilike any(array['%CeCe%', '%2012-05%', '%1002%', '%' || :c || '%', '%' || :t || '%'])",
                 c=code1, t=code_tag(code1)) == 0)

        # ── A temporary table cannot stand in ───────────────────────────
        with tx(d):
            d.run('create temporary table teacher (id uuid, deleted_at timestamptz)'); d.run('insert into teacher values (:x, null)', x=(fake := nid()))
            d.run('create temporary table course (id uuid, teacher_id uuid, deleted_at timestamptz, name text)'); d.run('insert into course select id, :x, null, name from public.course', x=fake)
            e = refused(d, lambda: d.issue([(ENR1, card1)], teacher=fake))
            ok("temporary tables named teacher and course do not make a stranger a teacher, nor Teacher A's class theirs", e is not None and 'not a teacher' in e[0], e)
        ok('the six functions this file adds are SECURITY DEFINER with pg_temp last in their search_path',
           d.one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'student_submit' and p.proname in ('card', 'verify_card', '_card_lookup', 'issue_cards', '_as_teacher', '_card_key_seen')
                       and p.prosecdef and p.proconfig = array['search_path=public, student_submit, pg_temp']""") == 6)

        # ── A card replaced while a check of it waits ───────────────────
        d.run('delete from student_submit.attempt')
        opened = d.one('select count(*) from student_submit.device_session_enrollment')
        o = d.other(); o.run('begin'); o.run('set role service_role')
        pr = Printed([(ENR1, card1)])
        o.run('select student_submit.issue_cards(:t, :c, :i::jsonb, :k, null)', t=A, c=COURSE_A, i=pr.json(), k=KEY_ID)     # not committed: the old card's row is held
        out = {}
        def waiting():
            w = d.other(); w.run('set role service_role')
            out['r'] = w.run('select student_submit.verify_card(:h, :k, :b, null, null, null, :i, false)', h=code_tag(code1), k=KEY_ID, b='2012-05-15', i='ip-w')[0][0]
            w.close()
        th = threading.Thread(target=waiting); th.start(); time.sleep(0.7)
        still = th.is_alive()
        o.run('commit'); o.close(); th.join(10)
        ok('a right answer on a card that is replaced while the check waits for it: the check waited, then card_stopped, and no session',
           still and out.get('r') == {'ok': False, 'error': 'card_stopped'}
           and d.one('select count(*) from student_submit.device_session_enrollment') == opened, (still, out))
    finally:
        d.close()

class tx2:
    """A savepoint inside a tx(d) block, rolled back."""
    def __init__(self, d): self.d = d
    def __enter__(self): self.d.run('savepoint tx2'); return self.d
    def __exit__(self, *a): self.d.run('rollback to savepoint tx2'); return False

# ════════════════════════════════════════════════════════════════════════════
def scen_race():
    d, k = applied('race')
    try:
        def request(pairs, out, name, idem=None, hold=None):
            c = d.other(); c.run('set role service_role')
            p = Printed(pairs)
            try:
                if hold: c.run('begin')
                out[name] = (c.run('select student_submit.issue_cards(:t, :c, :i::jsonb, :k, :d)', t=A, c=COURSE_A, i=p.json(), k=KEY_ID, d=idem)[0][0], p)
                if hold: hold.wait(10); c.run('commit')
            except Exception as e:
                out[name] = (message(e), p)
                try: c.run('rollback')
                except Exception: pass
            c.close()
        live = lambda e=ENR1: d.all('select id from student_card where enrollment_id = :e and stopped_at is null', e=e)
        def results(out): return sorted(v[0]['results'][0]['result'] if isinstance(v[0], dict) else 'ERROR ' + v[0] for v in out.values())

        # Two first cards for the same student: the second waits for the first to commit.
        out = {}; go = threading.Event()
        t1 = threading.Thread(target=request, args=([(ENR1, None)], out, 'a'), kwargs=dict(hold=go)); t1.start(); time.sleep(0.5)
        t2 = threading.Thread(target=request, args=([(ENR1, None)], out, 'b')); t2.start(); time.sleep(0.7)
        waited = t2.is_alive(); go.set(); t1.join(10); t2.join(10)
        ok('two requests make a first card for one student at once: the second waits, then is told changed; one live card',
           waited and results(out) == ['changed', 'made'] and len(live()) == 1, results(out))
        # Two replacements naming the same card.
        cur = live()[0][0]; out = {}; go = threading.Event()
        t1 = threading.Thread(target=request, args=([(ENR1, cur)], out, 'a'), kwargs=dict(hold=go)); t1.start(); time.sleep(0.5)
        t2 = threading.Thread(target=request, args=([(ENR1, cur)], out, 'b')); t2.start(); time.sleep(0.7)
        waited = t2.is_alive(); go.set(); t1.join(10); t2.join(10)
        ok('two requests replace the same card at once: the second waits on that card, then is told changed; one live card, and it is number 2',
           waited and results(out) == ['changed', 'made'] and len(live()) == 1 and d.one('select seq from student_card where id = :i', i=live()[0][0]) == 2, results(out))
        # The first is rolled back: the second goes through.
        cur = live()[0][0]; out = {}
        c1 = d.other(); c1.run('set role service_role'); c1.run('begin')
        c1.run('select student_submit.issue_cards(:t, :c, :i::jsonb, :k, null)', t=A, c=COURSE_A, i=Printed([(ENR1, cur)]).json(), k=KEY_ID)
        t2 = threading.Thread(target=request, args=([(ENR1, cur)], out, 'b')); t2.start(); time.sleep(0.5)
        c1.run('rollback'); c1.close(); t2.join(10)
        ok('if the first request fails after all, the one that waited makes the card', results(out) == ['made'] and len(live()) == 1, results(out))
        # The same idempotency key twice at once.
        cur = live()[0][0]; out = {}; go = threading.Event(); same = nid()
        t1 = threading.Thread(target=request, args=([(ENR1, cur)], out, 'a'), kwargs=dict(hold=go, idem=same)); t1.start(); time.sleep(0.5)
        t2 = threading.Thread(target=request, args=([(ENR1, cur)], out, 'b'), kwargs=dict(idem=same)); t2.start(); time.sleep(0.7)
        waited = t2.is_alive(); go.set(); t1.join(10); t2.join(10)
        replayed = sorted(v[0].get('replayed') for v in out.values() if isinstance(v[0], dict))
        ok('the same request sent twice at once (one key): the second waits and gets the replay, with no candidate; one card made',
           waited and replayed == [False, True] and len(live()) == 1
           and all('candidate' not in v[0]['results'][0] for v in out.values() if v[0]['replayed']), out)
        # A burst, with nothing held: every round ends with exactly one live card.
        bad = []; made = 0
        for n in range(25):
            cur = live()[0][0]; out = {}
            ts = [threading.Thread(target=request, args=([(ENR1, cur), (ENR2, (live(ENR2) or [[None]])[0][0])][::(1 if i % 2 else -1)], out, i)) for i in range(4)]
            for t in ts: t.start()
            for t in ts: t.join(20)
            errs = [v[0] for v in out.values() if not isinstance(v[0], dict)]
            per = [sorted(r['result'] for v in out.values() if isinstance(v[0], dict) for r in v[0]['results'] if r['enrollment_id'] == e) for e in (ENR1, ENR2)]
            if errs or len(live()) != 1 or len(live(ENR2)) != 1 or any(p.count('made') != 1 or set(p) - {'made', 'changed'} for p in per): bad.append((n, errs, per))
            made += 2
        ok('25 rounds of four requests at once for two students, listed in either order: each round makes one card for each and tells the rest changed; no deadlock, no error',
           not bad, bad[:2])
        ok('every card ever made has its own number, and each student has one live card',
           d.one('select count(*) = count(distinct (enrollment_id, seq)) from student_card') and d.one('select count(*) from student_card where stopped_at is null') == 2)
        # The card a request made is the one whose code the function would hand out.
        out = {}; request([(ENR1, live()[0][0])], out, 'x')
        code = out['x'][1].codes(out['x'][0])[ENR1][0]
        ok('and the code the function hands back for a made card is the one that opens it', d.card(code).get('ok') is True)
    finally:
        d.close()

# ════════════════════════════════════════════════════════════════════════════
def scen_suites():
    """The suites that make no cards, untouched, on a database with the file applied."""
    d = Db('suites')
    try:
        r = d.migrate()
        ok('the file applies to the database as built (no cards in it)', r == 'ok', r)
        for script, want in (('student_submit.py', '79 passed, 0 failed'), ('questionnaire_identity.py', '47 passed, 0 failed'),
                             ('phone_reports.py', '37 passed, 0 failed'), ('questionnaires.py', '42 passed, 0 failed')):
            got = d.suite(script)
            ok('with the file applied %s passes untouched, as before: %s' % (script, want), got == want, (got, d.failures[:3]))
        # score_rpcs.py compares every function with docs/schema.generated.sql, the snapshot of the live
        # database. Until that snapshot is refreshed after the apply it does not have this file's three
        # new argument lists, and that one comparison fails; afterwards all 236 pass.
        got = d.suite('score_rpcs.py')
        ok('with the file applied score_rpcs.py passes untouched: 236, or 235 while the live snapshot is from before the apply (its one comparison with the snapshot)',
           got == '236 passed, 0 failed' or (got == '235 passed, 1 failed' and d.failures == ['every function loaded has the live signature and security']), (got, d.failures[:3]))
    finally:
        d.close()

SCENARIOS = {'apply': scen_apply, 'cards': scen_cards, 'lookup': scen_lookup, 'race': scen_race, 'suites': scen_suites}
if __name__ == '__main__':
    if sys.argv[1:] == ['build']:
        build(); sys.exit(0)
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
