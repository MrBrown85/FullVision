"""Prove migrations/local-test/batch-b-undo.sql: Batch B
(2026111101_student_work_submissions.sql, 2026111102_student_work_storage.sql)
goes in, is used, and comes out, and the database is what it was but for
what the script's header lists.

    python3 submissions_undo.py            every scenario
    python3 submissions_undo.py main       or only some

The database named by PGDATABASE is the template submissions_common.py
builds (python3 submissions_common.py build): gradebook-prod as it is now,
with a stand-in for Supabase's storage schema and without Batch B. Every
scenario runs on a copy of it, made and dropped here.

  main        A database in use; the catalog (catalog.py) and a checksum of
              every table's rows. Batch B applied and used: Send Work on,
              a student's send, the teacher's Add Work, a Replace, a paper
              hand-in. PART 2 refuses while a file or a page is left, and at
              each of its other checks, with nothing changed. PART 1 turns
              Send Work off and deletes nothing. Then the photos are deleted
              the way the header says, and PART 2: the catalog is the one
              from before Batch B but for the dropped-column slots; which
              rows differ; everything from before still works; PART 2
              refuses a second run; both files apply again; PART 2 again.
  apply-only  Applied and undone with nothing in between: the catalog but
              for the slots, and every row.

PGPORT=54341 PGDATABASE=bb python3 submissions_undo.py
"""
from submissions_common import *
from submissions import in_use, queued, live_paths, retouched, all_functions

UNDO_TEXT = text_of(UNDO_B)
STATEMENTS = split(UNDO_TEXT)
last = lambda st: st.split('\n')[-1].strip().lower()
CUT = [n for n, st in enumerate(STATEMENTS) if last(st) == 'commit'][0] + 1
PART1, PART2 = STATEMENTS[:CUT], STATEMENTS[CUT:]
SLOTS = ['dropped columns public.assessment | 5', 'dropped columns public.course | 2']

def marked(name):
    """A statement the header gives between `-- <name>:` and `-- end <name>`."""
    body = UNDO_TEXT.split('-- %s:\n' % name)[1].split('-- end %s' % name)[0]
    return '\n'.join(l[2:] for l in body.splitlines()).strip().rstrip(';')

def refuses(d, setup, want):
    """PART 2 run after `setup` (all of it undone afterwards): True when it stops at its first check saying `want`."""
    d.begin()
    try:
        for st in setup: d.run(st)
        try:
            for n, st in enumerate(PART2):
                at = n
                if last(st) not in ('begin', 'commit'): d.run(st)
            return (False, 'it ran')
        except Exception as e:
            return (at == 2 and want in message(e) and 'Nothing was changed' in message(e), message(e)[:300])
    finally:
        d.rollback()

def scen_main():
    d = WorkDb('undo')
    try:
        k = in_use(d)
        d.run('create schema supabase_migrations')
        d.run('create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)')
        d.run("insert into supabase_migrations.schema_migrations (version, name) values ('20261111020227', 'card_codes_keyed')")
        cat0 = catalog(d.c); rows0 = row_checksums(d.c); fps0 = all_functions(d); page0 = d.page(k['token'], ENR1)

        ok('the script is two transactions: PART 1 (three statements between begin and commit) and PART 2 (a lock timeout, then every check, then the drops)',
           last(PART1[0]) == 'begin' and last(PART1[-1]) == 'commit' and last(PART2[0]) == 'begin' and last(PART2[-1]) == 'commit'
           and '$guard$' in PART2[2] and len(PART1) == 6 and not any(w in bare(' '.join(PART1)).lower() for w in ('drop table', 'drop function', 'delete ', 'alter table')))

        # ── Batch B applied and used ────────────────────────────────────
        r = d.apply_b()
        ok('Batch B applies', r == 'ok', r)
        d.run("insert into supabase_migrations.schema_migrations (version, name) values ('20261111100000', 'student_work_submissions'), ('20261111100001', 'student_work_storage')")
        cat1 = catalog(d.c)
        d.run("update course set send_work = true, keep_photos_until = 'end_of_term'")
        d.run("update assessment set students_send = 'photos', after_due = 'until', accept_until = '2027-06-30'")
        s, f = d.send(k['token'], ENR1, k['a2'], 2, note='Here it is.')
        r2 = d.send_start(k['token'], ENR1, k['a2'], pages=1, replace=True); d.upload(r2['files']); d.send_finish(k['token'], ENR1, r2['submission_id'], r2['files'])
        d.teacher_upload(k['a1'], ENR2, 1)
        d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['a1'], e=[ENR1], k=nid()); d.rpc('mark_handed_in_paper(:a, :e, :k)', a=k['a2'], e=[ENR2], k=nid())
        ok('in use: three pieces of work handed in with photos or on paper, one replaced; two pages in storage with their thumbnails, four replaced files still waiting to be deleted',
           d.one("select count(*) from submission where state = 'sent'") == 4 and len(live_paths(d)) == 4 and len(queued(d, 'replace')) == 4 and len(d.storage.names()) == 8)
        cat_used = catalog(d.c); rows_used = row_checksums(d.c)
        same = lambda: (catalog(d.c), row_checksums(d.c)) == (cat_used, rows_used)

        # ── PART 2 refuses while anything of it is in use ───────────────
        good, said = refuses(d, [], 'still holds 8 files')
        ok('PART 2 with files in the bucket: refused, and it says how many', good, said)
        good, said = refuses(d, ["select set_config('storage.allow_delete_query', 'true', true)", "delete from storage.objects where bucket_id = 'student-photos'"], 'still 2 pages of work handed in')
        ok('PART 2 with the bucket emptied behind its back but the pages still listed: refused', good, said)
        ok('neither refusal changed anything', same())

        # ── PART 1 ──────────────────────────────────────────────────────
        r = d.statements(PART1)
        ok('PART 1 runs and lists the classes it turned off', r == 'ok' and sorted(x[1] for x in d.rows) == ['Science 8', 'Socials 10'], (r, d.rows))
        ok('Send Work is off for every class; nothing else of the class changed', d.all('select distinct send_work, keep_photos_until from course') == [[False, 'end_of_term']])
        after1 = row_checksums(d.c)
        ok('PART 1 deleted nothing and changed no other table: only course and each class\'s changed mark differ',
           sorted(t for t in rows_used if after1[t] != rows_used[t]) == ['public.course', 'public.course_sync_cursor'] and catalog(d.c) == cat_used)
        ok('students are told sending is off; what was sent is still there for the teacher and the student',
           d.send_start(k['token'], ENR1, k['a1']).get('error') == 'send_off' and d.unsend(k['token'], ENR1, k['a2']).get('error') == 'send_off'
           and len(d.rpc('list_course_submissions(:c)', c=COURSE_A)['submissions']) == 4 and len(d.file_links(k['token'], ENR1, k['a2'])['files']) == 1)
        ok('PART 1 again: runs, lists nothing', d.statements(PART1) == 'ok' and d.rows == [])

        # ── The photos are deleted, the way the header says ─────────────
        empty = marked('empty')
        ok('the header gives the one statement that deletes every submission', empty == 'delete from public.submission', empty)
        d.run(empty)
        ok('it queues every file (the four that were waiting and the four of the pages just deleted)', d.one('select count(*) from submission') == 0 and len(queued(d)) == 8)
        while d.drain()[0]['items']: pass
        ok('the worker empties the bucket', d.storage.names() == [])
        rows_empty = row_checksums(d.c)
        same = lambda: (catalog(d.c), row_checksums(d.c)) == (cat_used, rows_empty)

        # ── Each of PART 2's other checks ───────────────────────────────
        for sig in ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'public._submission_gone()', 'fv_private.work_read_allowed(text)'):
            good, said = refuses(d, [retouched(d, sig)], sig.split('(')[0])
            ok('PART 2 refuses when %s has been changed since (one space more)' % sig.split('(')[0], good and 'is not as Batch B leaves it' in said, said)
        for label, setup, want in (
                ('a function built on its tables', ["create function public.work_count() returns bigint language sql as $f$ select count(*) from submission $f$"], 'public.work_count()'),
                ('a function that reads one of its columns', ["create function public.takes_work(uuid) returns boolean language plpgsql as $f$ begin return (select a.students_send <> 'nothing' from assessment a where a.id = $1); end $f$"], 'public.takes_work(uuid)'),
                ('a function in another schema that calls one of its functions', ['create schema elsewhere', "create function elsewhere.peek(uuid, uuid) returns boolean language sql as $f$ select student_submit._grading_started($1, $2) $f$"], 'elsewhere.peek'),
                ('a column added to submission', ['alter table public.submission add column grade_hidden boolean'], 'submission columns'),
                ('an index added to submission_file', ['create index later_idx on public.submission_file (sha256)'], 'index later_idx'),
                ('a trigger added to submission', ["create function public.bb_t() returns trigger language plpgsql as $f$ begin return null; end $f$",
                                                   'create trigger later_trg after insert on public.submission for each row execute function public.bb_t()'], 'trigger later_trg'),
                ('a policy added to submission', ['create policy later_read on public.submission for select using (true)'], 'policy later_read'),
                ('a table that points at submission', ['create table public.markup (id uuid primary key, submission_id uuid references public.submission(id))'], 'constraint markup_submission_id_fkey'),
                ('a file put back in the bucket', ["insert into storage.objects (bucket_id, name) values ('student-photos', 'stray.jpg')"], 'still holds 1 files')):
            good, said = refuses(d, setup, want)
            ok('PART 2 refuses with %s, nothing changed' % label, good, said)
        good, said = refuses(d, ["create function public.work_note() returns int language sql as $f$ select 1 -- submission is mentioned only here\n $f$"], 'never')
        ok('a function that only mentions submission in a comment does not stop it', said == 'it ran', said)
        ok('after every refusal the catalog and every row are what they were', same())

        # ── PART 2 ──────────────────────────────────────────────────────
        r = d.statements(PART2)
        ok('PART 2 runs', r == 'ok', r)
        cat2 = catalog(d.c); rows2 = row_checksums(d.c)
        gone, new = differences([l for l in cat0 if not l.startswith('migration record')], [l for l in cat2 if not l.startswith('migration record')])
        ok('THE CATALOG IS THE ONE FROM BEFORE BATCH B, line for line (%d lines), with one trace: course keeps two and assessment five empty slots where the dropped columns were' % len(cat0),
           gone == [] and new == SLOTS, (gone[:3], new[:5]))
        ok('every function from before is byte for byte what it was, and none of Batch B\'s is left', all_functions(d) == fps0)
        differ = sorted(t for t in rows0 if rows2.get(t) != rows0[t])
        ok('no row of any table from before differs, apart from each class\'s changed mark and the empty bucket\'s own row (%d tables compared)' % len(rows0),
           differ == ['public.course_sync_cursor', 'storage.buckets'], differ)
        ok('the four tables are gone', sorted(set(rows2) - set(rows0)) == [] and all(d.one('select to_regclass(:t) is null', t=t) for t in
                                                                                    ('public.submission', 'public.submission_file', 'public.submission_file_removal', 'student_submit.send_log')))
        ok('the bucket is left: empty, private, 2 MB, JPEG only, and with no policy nobody but the service key can reach it',
           d.all("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'student-photos'") == [[False, 2097152, ['image/jpeg']]]
           and d.one("select count(*) from pg_policy where polrelid = 'storage.objects'::regclass") == 0 and d.storage.names() == [])
        ok('what the teacher RPCs remembered is deleted, and no other remembered answer', rows2['public.fv_idempotency'] == rows0['public.fv_idempotency'])
        ok('the signed-in phone reads the page it read before Batch B, and a grade saves, returns and reads as before',
           d.page(k['token'], ENR1) == page0 and d.teacher('upsert_score(:e, :a, 9)', e=ENR2, a=k['a2']) is not None
           and d.teacher('return_grades(:a, :e, :k)', a=k['a2'], e=[ENR2], k=nid())['returned'] == 1)
        e = refused(d, lambda: d.send_start(k['token'], ENR1, k['a1']))
        ok("an edge function still calling send_start gets an error, not an answer", e is not None and 'does not exist' in e[0], e)
        ok('the migration record still lists both files, as the header says', d.one("select count(*) from supabase_migrations.schema_migrations where name like 'student_work%'") == 2)
        d.run(marked('record'))
        ok('and the statement the header gives removes exactly those two rows', d.all('select name from supabase_migrations.schema_migrations') == [['card_codes_keyed']])
        cat3 = catalog(d.c)
        r = d.statements(PART2)
        ok('PART 2 a second time: refused (Batch B is not applied), nothing changed', r.startswith('STOPPED') and 'Batch B is not applied' in r and catalog(d.c) == cat3, r)

        # ── And back in again ───────────────────────────────────────────
        r = d.apply_b()
        gone, new = differences([l for l in cat1 if not l.startswith('migration record')], [l for l in catalog(d.c) if not l.startswith('migration record')])
        moved = lambda l: re.match(r'column public\.(course|assessment) \| \d+ \| (send_work|keep_photos_until|students_send|after_due|accept_until|group_work|students_see_markup) ', l)
        ok('both files apply again, to the bucket that was left; the catalog is the first apply\'s, but that the seven columns sit after the empty slots',
           r == 'ok' and all(moved(l) for l in gone) and sorted(l for l in new if not moved(l)) == SLOTS and len(gone) == 7, (r, [l for l in gone if not moved(l)][:3], [l for l in new if not moved(l)][:5]))
        d.run("update course set send_work = true"); d.run("update assessment set students_send = 'photos' where id = :a", a=k['a1'])
        ok('and it works: a student sends a page', d.send(k['token'], ENR1, k['a1'])[1]['ok'] is True)
    finally:
        d.close()

def scen_apply_only():
    d = WorkDb('undo_only')
    try:
        in_use(d)
        cat0 = catalog(d.c); cols0 = table_columns(d.c); rows0 = row_checksums(d.c)
        r = d.apply_b()
        ok('apply-only: Batch B applies', r == 'ok', r)
        r = d.statements(PART1)
        ok('apply-only: PART 1 with no class on changes no row', r == 'ok' and d.rows == [] and all(v == rows0[t] for t, v in row_checksums(d.c, cols0).items() if t != 'storage.buckets'))
        r = d.statements(PART2)
        ok('apply-only: PART 2 runs straight after', r == 'ok', r)
        gone, new = differences(cat0, catalog(d.c)); rows2 = row_checksums(d.c)
        ok('apply-only: the catalog is identical but for the dropped-column slots', gone == [] and new == SLOTS, (gone[:3], new[:5]))
        ok('apply-only: every row of every table is identical; the only difference is the empty bucket left in storage.buckets',
           sorted(t for t in rows0 if rows2.get(t) != rows0[t]) == ['storage.buckets'] and sorted(set(rows2) - set(rows0)) == [], sorted(t for t in rows0 if rows2.get(t) != rows0[t]))
    finally:
        d.close()

SCENARIOS = {'main': scen_main, 'apply-only': scen_apply_only}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
