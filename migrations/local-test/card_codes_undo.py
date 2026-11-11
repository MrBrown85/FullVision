"""Prove migrations/local-test/s3-m1-undo.sql: S3-M1
(2026111003_card_codes_keyed.sql) goes in, is used, and comes out, and the
database is what it was but for what the script's header lists.

    python3 card_codes_undo.py            every scenario
    python3 card_codes_undo.py main       or only some

The database named by PGDATABASE is the template card_codes.py builds
(python3 card_codes.py build): gradebook-prod as it is now, without S3-M1.
Every scenario runs on a copy of it, made and dropped here.

  main        Cards made the old way and used; the catalog (catalog.py) and
              a checksum of every table's rows. S3-M1 applied and used: new
              cards, a signed-in phone, a replaced card. Each of the undo's
              checks stops it with nothing changed. Then the undo: the
              catalog is the one from before S3-M1, line for line; which
              rows differ and how; cards are made the old way again and
              open; the undo refuses a second run; S3-M1 applies again to
              the same catalog as the first time; the undo again.
  apply-only  S3-M1 applied and undone with nothing done in between: the
              only rows that differ from before are the ones the header
              names.
  suites      After apply and undo, Batch A's own suites pass as they do on
              the database from before S3-M1.

PGPORT=54331 PGDATABASE=s3m1_live python3 card_codes_undo.py
"""
import time
from card_codes_common import *
from card_codes import seed, file_bytes

UNDO_TEXT = text_of(UNDO)
UNDO_STATEMENTS = split(UNDO_TEXT)
KEPT = ['id', 'enrollment_id', 'created_at', 'printed_at', 'last_opened_at', 'wrong_tries', 'wrong_times', 'locked_at', 'works_until']
last = lambda st: st.split('\n')[-1].strip().lower()

def record_statement():
    """The optional statement in the undo's header, between `-- record:` and `-- end record`."""
    body = UNDO_TEXT.split('-- record:\n')[1].split('-- end record')[0]
    return '\n'.join(l[2:] for l in body.splitlines()).strip().rstrip(';')

def kept_sum(d, ids):
    """One hash of what a card keeps through S3-M1 and its undo, for the cards named."""
    return d.one("""select md5(coalesce(string_agg(t, '|' order by t), '')) from (
                      select jsonb_build_array(%s)::text as t from student_card x where x.id = any (:ids::uuid[])) s""" % ', '.join('to_jsonb(x.%s)' % c for c in KEPT),
                 ids='{%s}' % ','.join(ids))

def use_old(d):
    """Cards made and used the way Batch A has it: a card each, one replaced, a signed-in phone, a
    returned grade the phone can read, a live slip. Returns what the checks need."""
    k = seed(d)
    d.run('create schema supabase_migrations')
    d.run('create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)')
    d.run("""insert into supabase_migrations.schema_migrations (version, name) values ('20261110153204', 'student_card'),
             ('20261110153719', 'security_definer_search_path'), ('20261110171203', 'grade_return_limits')""")
    d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid())
    d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_B, uid=B, k=nid())
    first = d.one('select id from student_card where enrollment_id = :e', e=ENR1)
    d.teacher('reissue_student_card(:i, :k)', i=first, k=nid())
    d.teacher('unlock_student_card(:i, :k)', i=d.one('select id from student_card where enrollment_id = :e', e=ENR2), k=nid())
    k['quiz'] = nid()
    d.run("insert into assessment (id, course_id, title, score_mode, max_points, date_assigned) values (:a, :c, 'Quiz 1', 'points', 10, current_date - 1)", a=k['quiz'], c=COURSE_A)
    d.teacher('upsert_score(:e, :a, 7)', e=ENR1, a=k['quiz'])
    d.teacher('return_grades(:a, :ids::uuid[], :k)', a=k['quiz'], ids='{%s}' % ENR1, k=nid())
    k['old_code'] = d.one('select code from student_card where enrollment_id = :e and stopped_at is null', e=ENR1)
    k['old_token'] = d.service("student_submit.verify_card(:c, '2012-05-15', null, null, null, 'ip-1', false)", c=k['old_code'])['session_token']
    q = d.teacher("upsert_questionnaire(:c, 'core_reflection', 'November Reflection', 'core-8-1', p_report_period => 1, p_opens_on => (current_date - 1), p_closes_on => (current_date + 7), p_idempotency_key => :k)",
                  c=COURSE_A, k=nid())
    k['slip'] = d.teacher('issue_access_codes(:q, :ids::uuid[], :k)', q=q['id'], ids='{%s}' % ENR1, k=nid())[0]['code']
    k['questionnaire'] = q['id']
    return k

def apply(d):
    r = d.migrate()
    if r == 'ok': d.run("insert into supabase_migrations.schema_migrations (version, name) values ('20261111000000', :n) on conflict do nothing", n=RECORD)
    return r

def scen_main():
    d = Db('undo_main')
    try:
        k = use_old(d)
        cat0, rows0 = catalog(d.c), row_checksums(d.c)
        cards0 = {r[0]: r for r in d.all('select id, enrollment_id, stopped_at::text from student_card')}
        kept0 = kept_sum(d, cards0)
        ok('before S3-M1: %d catalog lines, %d tables; an old card opens the page and shows the returned grade' % (len(cat0), len(rows0)),
           len(cat0) > 1500 and d.page(k['old_token'], ENR1)['assessments'][0]['grade']['value'] == 7)

        # ── S3-M1 goes in and is used ───────────────────────────────────
        r = apply(d)
        cat1 = catalog(d.c)
        ok('S3-M1 applies', r == 'ok', r)
        reply, p = d.issue([(ENR1, None), (ENR2, None)], idem=nid())
        made = p.codes(reply)
        token = d.verify(made[ENR1][0], birthday='2012-05-15')['session_token']
        d.teacher('mark_student_cards_printed(:ids::uuid[], :k)', ids='{%s}' % made[ENR1][2]['card_id'], k=nid())
        newer = d.make(ENR2)
        live_before = d.one('select count(*) from student_card where stopped_at is null')
        ok('S3-M1 is in use: two students have live cards, one of them replaced once; a phone is signed in and reads the returned grade',
           live_before == 2 and d.page(token, ENR1)['assessments'][0]['grade']['value'] == 7 and d.card(made[ENR2][0]) == {'ok': False, 'error': 'card_stopped'}
           and d.card(newer[0]).get('ok') is True)
        ok('using it changes no catalog line', catalog(d.c) == cat1)
        cat_used, rows_used = catalog(d.c), row_checksums(d.c)
        tags = [x[0] for x in d.all('select code_hmac from student_card where code_hmac is not null')]

        # ── The undo's own shape ────────────────────────────────────────
        ok('the undo is one transaction: begin first, commit last, a lock timeout, then its checks before anything is changed',
           last(UNDO_STATEMENTS[0]) == 'begin' and last(UNDO_STATEMENTS[-1]) == 'commit' and last(UNDO_STATEMENTS[1]) == "set local lock_timeout = '5s'"
           and '$guard$' in UNDO_STATEMENTS[2])
        ok("it never names pgcrypto's keyed-hash function either", not re.search(r'(?<![a-z_])hmac\s*\(', UNDO_TEXT, re.I) and 'pgcrypto' not in UNDO_TEXT.lower())

        # ── Each check stops it, at the guard, with nothing changed ─────
        def stopped_by(setup, want):
            d.begin()
            try:
                for st in setup: d.run(st)
                try:
                    for n, st in enumerate(UNDO_STATEMENTS):
                        at = n
                        if last(st) not in ('begin', 'commit'): d.run(st)
                    return (False, 'it ran')
                except Exception as e:
                    return (at == 2 and want in message(e) and 'Nothing was changed' in message(e), message(e)[:400])
            finally:
                d.rollback()
        def retouched(sig):
            return d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig).replace('\nbegin', '\n begin', 1).replace(' select ', '  select ', 1)
        for sig in ('public._issue_access_code(uuid,uuid,timestamptz)', 'public._issue_report_code(uuid,uuid,timestamptz)', 'public._student_card_json(uuid)',
                    'student_submit._as_teacher(uuid)', 'student_submit._card_key_seen(text)', 'student_submit._card_lookup(text,text,text)',
                    'student_submit.card(text,text,text)', 'student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                    'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)'):
            new = retouched(sig)
            good, said = stopped_by([new], sig.split('(')[0])
            ok('undo guard: %s changed since S3-M1 (one space more) stops it, nothing changed' % sig.split('(')[0],
               good and new != d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig) and 'not as S3-M1 leaves it' in said, said)
        for label, setup, want in (
                ('one of the old functions is back', ["create function public.reissue_student_card(uuid, uuid) returns jsonb language sql as $f$ select '{}'::jsonb $f$"], 'public.reissue_student_card'),
                ('a column added to student_card since', ['alter table public.student_card add column note text'], 'columns: '),
                ('an index added since', ['create index later_idx on public.student_card (printed_at)'], 'later_idx'),
                ('a constraint added since', ['alter table public.student_card add constraint later_check check (seq < 30000)'], 'later_check'),
                ('a trigger added since', ["create function public.later_fn() returns trigger language plpgsql as $f$ begin return new; end $f$",
                                           'create trigger later_trg before update on public.student_card for each row execute function public.later_fn()'], 'later_trg'),
                ('a policy added since', ['create policy later_read on public.student_card for select using (true)'], 'later_read'),
                ('a table that points at a card', ['create table public.later_table (card_id uuid constraint later_fk references public.student_card(id))'], 'later_fk'),
                ('a view over the cards', ['create view public.later_view as select id, seq from public.student_card'], 'later_view'),
                ('a function built on S3-M1 that reads the cards', ["create function public.card_count() returns bigint language sql as $f$ select count(*) from student_card where code_hmac is not null $f$"], 'public.card_count()'),
                ('a function built on S3-M1 that reads the key id', ["create function student_submit.which_key() returns text language sql as $f$ select key_id from student_submit.card_key $f$"], 'student_submit.which_key()')):
            good, said = stopped_by(setup, want)
            ok('undo guard: %s: it stops, nothing changed' % label, good, said)
        ok('after every refusal the catalog and every row are what they were', (catalog(d.c), row_checksums(d.c)) == (cat_used, rows_used))
        o = d.other(); o.run('begin'); o.run('select * from student_card for update')
        t0 = time.time(); r = d.undo(); waited = time.time() - t0
        o.run('rollback'); o.close()
        ok('with a card row held by another session it gives up after five seconds, at its guard, with nothing changed (%.1f s)' % waited,
           r.startswith('STOPPED') and 'lock timeout' in r and d.at == 2 and 4 < waited < 9 and (catalog(d.c), row_checksums(d.c)) == (cat_used, rows_used), r)

        # ── The undo ────────────────────────────────────────────────────
        n_cards = d.one('select count(*) from student_card')
        r = d.undo()
        ok('the undo runs', r == 'ok', r)
        ok('its last query says how many cards there are and how many it stopped (%d cards, the %d live ones)' % (n_cards, live_before), d.rows == [[n_cards, live_before]], d.rows)
        cat2, rows2 = catalog(d.c), row_checksums(d.c)
        gone, new = differences(cat0, cat2)
        ok('the catalog is the one from before S3-M1, line for line (%d lines), but for the migration record, which still lists S3-M1' % len(cat2),
           gone == [] and new == ['migration record 20261111000000 | ' + RECORD], (gone[:4], new[:4]))
        d.run(record_statement())
        ok("and with the header's optional statement run, it is identical", catalog(d.c) == cat0)
        ok('no card is live', d.one('select count(*) from student_card where stopped_at is null') == 0)
        ok('every card from before S3-M1 is there with what it had: when it was made, printed and last opened, its wrong tries, its last day',
           d.one('select count(*) from student_card k where k.id = any (:ids::uuid[])', ids='{%s}' % ','.join(cards0)) == len(cards0) and kept_sum(d, cards0) == kept0)
        ok('the card that was already stopped before S3-M1 keeps its time; the cards made under S3-M1 are there too, stopped',
           d.one('select stopped_at::text from student_card where id = :i', i=[i for i, r in cards0.items() if r[2]][0]) == [r[2] for r in cards0.values() if r[2]][0]
           and d.one('select count(*) from student_card') == len(cards0) + 3)
        ok('where a code, hash and salt were there is a stand-in no typed code can equal, and no password',
           d.one("select bool_and(code = 'undone:' || id::text and code_hash = 'undone:' || id::text and salt = 'undone' and password is null) from student_card"))
        differ = sorted(t for t in rows0 if rows2.get(t) != rows0[t])
        allowed = {'public.student_card', 'public.fv_idempotency', 'student_submit.attempt', 'student_submit.device_session', 'student_submit.device_session_enrollment'}
        ok('the only tables whose rows differ from before S3-M1 are the cards, the remembered answers, and what using it wrote (the sign-in log, the sessions)',
           set(differ) <= allowed and set(rows2) == set(rows0), differ)
        ok('compared with just before the undo, the only table that changed is the cards (and the key-id table is gone)',
           sorted(t for t in rows2 if rows_used.get(t) != rows2[t]) == ['public.student_card'] and sorted(set(rows_used) - set(rows2)) == ['student_submit.card_key'])
        ok('the remembered answers S3-M1 deleted stay deleted; the ones issue_cards left hold no tag and no code',
           d.one("select count(*) from fv_idempotency where endpoint in ('issue_student_cards', 'reissue_student_card', 'unlock_student_card')") == 0
           and not re.search(r'[0-9a-f]{64}', json.dumps(d.one("select jsonb_agg(result) from fv_idempotency where endpoint = 'issue_cards'"))))
        raw = file_bytes(d)
        if raw is not None:
            ok("the table was made again: its file on disk holds none of the tags S3-M1's cards had", not any(t.encode() in raw for t in tags))

        # ── It is Batch A's again ───────────────────────────────────────
        e = refused(d, lambda: d.card(made[ENR1][0]))
        ok("S3-M1's functions are gone: a tag is no way in", e is not None and 'does not exist' in e[0], e)
        ok('the phone that was signed in is told its card was replaced', d.page(token, ENR1) == {'ok': False, 'error': 'card_stopped'})
        ok('a card from before S3-M1 does not come back: its code opens nothing',
           d.service("student_submit.card(:c, 'ip-1')", c=k['old_code']) == {'ok': False, 'error': 'not_found'})
        r = d.teacher('issue_student_cards(:c, null, :k)', c=COURSE_A, k=nid())
        codes = {x['enrollment_id']: x for x in r['cards']}
        ok('Make Cards works the old way again: a card for each student, its code readable by their teacher', r['issued'] == 2 and re.fullmatch(r'[A-Z0-9]{3}-[A-Z0-9]{3}', codes[ENR1]['code']), r)
        v = d.service("student_submit.verify_card(:c, '2012-05-15', null, null, null, 'ip-1', false)", c=codes[ENR1]['code'])
        ok('and that card opens the page with the returned grade', v.get('ok') is True and d.page(v['session_token'], ENR1)['assessments'][0]['grade']['value'] == 7, v)
        ok("a teacher's browser reads its own class's cards from the table again, and another teacher's reads none of them",
           len(d.role('authenticated', 'select code from student_card where stopped_at is null', uid=A)) == 2
           and d.role('authenticated', 'select count(*) from student_card where enrollment_id = :e', uid=B, e=ENR1)[0][0] == 0)
        again = d.teacher('reissue_student_card(:i, :k)', i=codes[ENR2]['id'], k=nid())
        ok('Reissue works, with a new password for a student with nothing on file', again['code'] != codes[ENR2]['code'] and re.fullmatch(r'\d{4}', again['password'] or ''), again)
        ok('the slip printed before still opens, and a new one is issued',
           d.service("student_submit.open(:c, 'ip-1')", c=k['slip']).get('kind') == 'questionnaire'
           and len(d.teacher('issue_access_codes(:q, :ids::uuid[], :k)', q=k['questionnaire'], ids='{%s}' % ENR2, k=nid())) == 1)

        # ── Twice, and back in again ────────────────────────────────────
        cat3, rows3 = catalog(d.c), row_checksums(d.c)
        r = d.undo()
        ok('run a second time the undo refuses and changes nothing', r.startswith('STOPPED') and 'S3-M1 (2026111003_card_codes_keyed.sql) is not applied' in r
           and (catalog(d.c), row_checksums(d.c)) == (cat3, rows3), r)
        r = apply(d)
        ok('S3-M1 applies again, and gives the same catalog as the first time', r == 'ok' and catalog(d.c) == cat1, (r, differences(cat1, catalog(d.c))))
        ok('the cards made the old way in between are stopped, and every card has its number',
           d.one('select count(*) from student_card where stopped_at is null') == 0 and d.one('select count(*) = count(distinct (enrollment_id, seq)) from student_card'))
        code, pw, row = d.make(ENR1)
        ok('and cards are made by tag again', d.card(code).get('ok') is True)
        r = d.undo(); d.run(record_statement())
        ok('the undo runs again, and the catalog is again the one from before S3-M1', r == 'ok' and catalog(d.c) == cat0, r)
    finally:
        d.close()

def scen_apply_only():
    d = Db('undo_only')
    try:
        k = use_old(d)
        cat0, rows0 = catalog(d.c), row_checksums(d.c)
        kept0 = row_checksums(d.c, {'public.student_card': KEPT})
        was_live = d.one('select count(*) from student_card where stopped_at is null')
        idem_other = d.all("select key::text, endpoint, result::text from fv_idempotency where endpoint not in ('issue_student_cards', 'reissue_student_card', 'unlock_student_card') order by 1")
        r1 = apply(d); r2 = d.undo(); report = d.rows
        ok('S3-M1 applies and is undone at once', (r1, r2) == ('ok', 'ok'), (r1, r2))
        d.run(record_statement())
        cat2, rows2 = catalog(d.c), row_checksums(d.c)
        ok('the catalog is identical to before, line for line (%d lines)' % len(cat0), cat2 == cat0, differences(cat0, cat2))
        differ = sorted(t for t in rows0 if rows2.get(t) != rows0[t])
        ok('of %d tables, the only two whose rows differ are the cards and the remembered answers' % len(rows0), differ == ['public.fv_idempotency', 'public.student_card'] and set(rows2) == set(rows0), differ)
        ok('the cards differ only in what the header lists: every card stopped (%d were live), stand-ins for code, hash and salt, no password' % was_live,
           row_checksums(d.c, {'public.student_card': KEPT}) == kept0 and d.one('select count(*) from student_card where stopped_at is null') == 0
           and d.one("select bool_and(code = 'undone:' || id::text and code_hash = code and salt = 'undone' and password is null) from student_card"))
        ok('the remembered answers differ only in the three card calls S3-M1 deleted',
           d.all("select key::text, endpoint, result::text from fv_idempotency order by 1") == idem_other)
        ok('the undo says it stopped no card itself: S3-M1 had stopped them all', report == [[d.one('select count(*) from student_card'), 0]], report)
    finally:
        d.close()

def scen_suites():
    d = Db('undo_suites')
    try:
        want = {}
        for script in ('student_page.py', 'grade_return.py', 'score_rpcs.py', 'student_submit.py', 'questionnaire_identity.py', 'phone_reports.py', 'questionnaires.py'):
            want[script] = d.suite(script)
        ok('before S3-M1 the suites pass: ' + ', '.join('%s %s' % (s, w.split(',')[0].replace(' passed', '')) for s, w in want.items()),
           all(w.endswith(' 0 failed') for w in want.values()) and want['student_page.py'] == '216 passed, 0 failed', want)
        cat0 = catalog(d.c)
        r1 = d.migrate(); r2 = d.undo()
        ok('S3-M1 applied and undone', (r1, r2) == ('ok', 'ok') and catalog(d.c) == cat0, (r1, r2))
        for script, w in want.items():
            got = d.suite(script)
            ok('after the undo %s passes as it did before S3-M1: %s' % (script, w), got == w, (got, d.failures[:3]))
    finally:
        d.close()

SCENARIOS = {'main': scen_main, 'apply-only': scen_apply_only, 'suites': scen_suites}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
