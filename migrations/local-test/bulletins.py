"""Bulletins, the teacher's side: migrations/2026111801_bulletins.sql on a database rebuilt from the repo and
proved equal to live (scripts/db-rebuild.mjs --check; README.md, "Bulletins"). The contract is
bulletins-contract.md.

    PGPORT=<port> PGDATABASE=<db> python3 bulletins.py fingerprints   write the md5s the file, post-check and undo carry
    PGPORT=<port> PGDATABASE=<db> python3 bulletins.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 bulletins.py post edit      or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped
here. It must mirror live, which sorts text by ICU en-US (made with template template0 locale_provider icu
icu_locale 'en-US' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8', then rebuilt with db-rebuild.mjs --check);
B1A_C_TEMPLATE names a second one rebuilt under C, for scenario collations. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  post      post_bulletin for each kind, with and without files, and its answer; finish_bulletin_file: missing
            and bad pages, a file ready, the bulletin visible only when its last file is; list_bulletins: order,
            pinned, a reminder past its day, not yet visible, the 100 cap, the class's counts.
  edit      edit_bulletin: edited_at only for words and link, a change that changes nothing, clearing a link and
            a pin, the assessment link; every refusal.
  delete    delete_bulletin takes the bulletin, its files, seen and reaction rows, and queues every page.
  counts    Seen by N of M with a paused, a withdrawn, a no-card, a stopped-card, an expired-card and a
            locked-card student (seen rows inserted directly: the student functions are B1b's);
            list_bulletin_seen; show_bulletin_again; the same-class triggers; the page switch.
  others    Teacher B, a class in the trash and ids that do not exist: refused, nothing changes; signed out is
            PT401; a visitor and the service role run nothing; no role reads or writes the tables or runs a
            helper.
  storage   The four policies: the exact page a teacher may write and only while it uploads, two hours, no
            overwrite, change or delete, who reads, a visitor, the other buckets as before, a careless policy.
  cascade   A withdrawn student deleted for good takes their rows; a purged class takes everything and queues
            every page; a deleted assessment unlinks; an upload never finished is dropped (and only hidden in a
            read-only transaction).
  limits    Lengths, the link's scheme, page caps, a linked assessment of another class, kinds, dates, shapes.
  race      One key twice; one key from two connections at once; two posts at the page cap at once; two files
            of one bulletin finished at once.
  defaults  With Supabase's default privileges in place the grants still come out exact.
  missing   A relied-on function that is missing stops the file.
  apply     The guards; a held lock; only the header's changes; no existing row changed; a second run; pre-
            and post-check; the size.
  collations On ICU en-US (as live) and on C: apply, fingerprints the file carries and identical on both, a second
            run, post-check, pre-check, full undo, apply again; the server's own order differs from C on ICU.
  m2        With a stand-in for M2's student_submit functions: M1 again, its post-check, PART 1 and the grants
            back, the full undo refusing until M2 is undone.
  locks     A delete holding the class's lock first: show again, edit, delete, finish and the seen list refuse
            rightly; an expired upload dropped while a file finishes, 20 of 20.
  lastcheck The last check confirms the storage helpers' grant; a stop there leaves nothing, the bucket included.
  spentkey  After an expired upload is dropped the same key answers its first reply; a new key posts.
  undo      PART 1 alone; the full removal refuses while a row, a queued page or a file is kept; then leaves the
            catalog and every row as before; a changed function stops it; a second run; the file again.
"""
import json, os, re, sys, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, refused, ok, finish, nid, connect, message, sqlstate, split, text_of, KEY_ID
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111801_bulletins.sql'
UNDO = 'bulletins-undo.sql'
PRE = 'bulletins-live-precheck.sql'
POST = 'bulletins-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
BUCKET = 'bulletin-files'; MB2 = 2097152
TABLES = ['public.bulletin', 'public.bulletin_file', 'public.bulletin_seen', 'public.bulletin_reaction']
RELIED = ['public.fv_owns_course(uuid)', 'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)', 'public._fv_timezone(text)']
TEACHER = ['list_bulletins(uuid)', 'post_bulletin(uuid,jsonb,jsonb,uuid)', 'finish_bulletin_file(uuid,uuid)', 'edit_bulletin(uuid,jsonb,uuid)',
           'delete_bulletin(uuid,uuid)', 'list_bulletin_seen(uuid)', 'show_bulletin_again(uuid,uuid)']
HELPERS = ['fv_private.bulletin_audience(uuid)', 'fv_private.bulletin_json(uuid)', 'fv_private.bulletin_drop_expired(uuid)',
           'fv_private.bulletin_file_path(uuid,uuid,integer)', 'fv_private.bulletin_pinned_now(boolean,date,text)']
OWN_SQL = """select md5(string_agg(p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text collate "C"))
               from pg_proc p where p.proname = any (string_to_array('%s', ','))
                and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace)""" % ''.join(
    re.findall(r"'([a-z_,]+)'", re.search(r"set_config\('fv\.b1a', (.*?), true\)", text_of(FILE), re.S).group(1)))
TABLES_SQL = """select md5(string_agg(attrelid::regclass::text || '.' || attname || ' ' || format_type(atttypid, atttypmod), ',' order by attrelid::regclass::text collate "C", attnum))
                  from pg_attribute where attrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname ~ '^bulletin' and relkind = 'r')
                   and attnum > 0 and not attisdropped"""
POLICIES_SQL = """select md5(string_agg(polname || polcmd::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname collate "C"))
                    from pg_policy where polrelid = 'storage.objects'::regclass and polname ~ '^fv_bulletin_files_'"""

def obj(v): return json.loads(v) if isinstance(v, str) and v[:1] in ('{', '[') else v
def T(d, sql, uid=A, **kw): return obj(d.teacher(sql, uid, **kw))
def applied(d): return d.one("select to_regclass('public.bulletin') is not null")
def without_final(text):
    a = text.index('do $final$'); b = text.index('$final$;', a + 12) + len('$final$;')
    return text[:a] + text[b:]
def part1(): return text_of(UNDO).split('-- PART 1 begins')[1].split('-- PART 1 ends')[0]
def code(e): return e[1] if e else None
def set_search_path(d): d.run('set search_path = public, pg_temp')

# ── fingerprints ───────────────────────────────────────────────────────────────────────────────────────
def put_fp(text, tag, value):
    """The quoted value on every line tagged '-- fp:<tag>' becomes value."""
    return re.sub(r"(is distinct from ')([^']*)(' (?:then )?-- fp:%s)" % tag, lambda m: m.group(1) + value + m.group(3), text)

def scen_fingerprints():
    d = Db('b1a_fp')
    try:
        if applied(d): sys.exit('the template already has the file: rebuild it from the baseline')
        set_search_path(d)
        r = d.statements(split(without_final(text_of(FILE))))
        if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
        set_search_path(d)
        own, tables, pols = d.one(OWN_SQL), d.one(TABLES_SQL), d.one(POLICIES_SQL)
        each = d.all("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname ~ 'bulletin' and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace) order by p.oid::regprocedure::text collate \"C\"")
        p = os.path.join(HERE, FILE); t = open(p).read()
        t = put_fp(put_fp(put_fp(t, 'own', own), 'tables', tables), 'policies', pols)
        open(p, 'w').write(t)
        p = os.path.join(HERE, UNDO); t = open(p).read(); open(p, 'w').write(put_fp(t, 'own', own))
        p = os.path.join(HERE, POST); t = open(p).read()
        rows = ',\n'.join("    ('%s', '%s')" % (s, m) for s, m in each)
        t = re.sub(r'(-- FINGERPRINTS-BEGIN postcheck[^\n]*\n)(.*?)(\n\s*-- FINGERPRINTS-END)', lambda m: m.group(1) + rows + m.group(3), t, flags=re.S)
        open(p, 'w').write(t)
        print('written: own %s, tables %s, policies %s, %d functions' % (own, tables, pols, len(each)))
    finally:
        d.close()

# ── the world ──────────────────────────────────────────────────────────────────────────────────────────
class W: pass

def world(tag, with_file=True):
    """Teacher A: class c with seven students in class-list order (can1, can2 with working cards; paused; gone,
    withdrawn; nocard; stopped, whose card is stopped; expired, whose card ran out), an assessment a; class c2
    with one student and an assessment; a class in the trash. Teacher B: class cb with a student and an
    assessment."""
    d = Db('b1a_' + tag)
    w = W(); w.d = d
    if applied(d):
        # Once the file is applied and the baseline refreshed, a rebuilt database already has it; the full undo,
        # proven by scenario undo, gives the database from before.
        r = d.file(UNDO)
        if r != 'ok' or applied(d): sys.exit('could not take the template back to before the file: %s' % r)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, add column if not exists active boolean')
    d.run('grant select, insert, update, delete on storage.objects to anon, authenticated, service_role')
    d.run('grant select on storage.buckets to anon, authenticated, service_role')
    d.run("""insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('student-photos', 'student-photos', false, 2097152, array['image/jpeg']) on conflict do nothing""")
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k) on conflict do nothing", k=KEY_ID)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    def course(name, uid=A):
        return str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    def student(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())",
                     uid, c=c, f=first)['enrollment_id'])
    w.c = course('Science 8')
    names = ['can1', 'can2', 'paused', 'gone', 'nocard', 'stopped', 'expired']
    w.e = {n: student(w.c, n.title()) for n in names}
    for i, n in enumerate(names): d.run('update enrollment set roster_position = :i where id = :e', i=i, e=w.e[n])
    for n in names:
        if n != 'nocard': d.make(w.e[n], w.c, A)
    d.run('update student_card set stopped_at = now() where enrollment_id = :e', e=w.e['stopped'])
    d.run("update student_card set works_until = current_date - 2 where enrollment_id = :e", e=w.e['expired'])
    d.run('update enrollment set page_paused_at = now() where id = :e', e=w.e['paused'])
    d.run('update enrollment set withdrawn_at = now() where id = :e', e=w.e['gone'])
    d.run('update course set student_page_enabled = true where id = :c', c=w.c)
    w.a = str(T(d, "create_assessment(:c, 'Lab 1', p_idempotency_key => gen_random_uuid())", c=w.c))
    w.c2 = course('Science 9'); w.e2 = student(w.c2, 'Other')
    w.a2 = str(T(d, "create_assessment(:c, 'Lab 2', p_idempotency_key => gen_random_uuid())", c=w.c2))
    w.trash = course('In the Trash')
    w.cb = course('Bravo Socials', B); w.eb = student(w.cb, 'Bailey', B)
    w.ab = str(T(d, "create_assessment(:c, 'Bravo Lab', p_idempotency_key => gen_random_uuid())", B, c=w.cb))
    d.run("update course set deleted_at = now() - interval '1 day' where id = :c", c=w.trash)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def post(w, b, files=None, key=None, uid=A, c=None):
    return T(w.d, 'post_bulletin(:c, cast(:b as jsonb), cast(:f as jsonb), :k)', uid, c=c or w.c, b=json.dumps(b),
             f=None if files is None else json.dumps(files), k=key)
def finish_(w, fid, key=None, uid=A): return T(w.d, 'finish_bulletin_file(:f, :k)', uid, f=fid, k=key)
def edit(w, bid, patch, key=None, uid=A): return T(w.d, 'edit_bulletin(:b, cast(:p as jsonb), :k)', uid, b=bid, p=json.dumps(patch), k=key)
def delete(w, bid, key=None, uid=A): return T(w.d, 'delete_bulletin(:b, :k)', uid, b=bid, k=key)
def listed(w, c=None, uid=A): return T(w.d, 'list_bulletins(:c)', uid, c=c or w.c)
def seen_list(w, bid, uid=A): return T(w.d, 'list_bulletin_seen(:b)', uid, b=bid)
def again(w, bid, key=None, uid=A): return T(w.d, 'show_bulletin_again(:b, :k)', uid, b=bid, k=key)
def put_page(d, path, size=1000, mime='image/jpeg', bucket=BUCKET):
    d.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', :s::bigint, 'mimetype', :m::text))",
          b=bucket, n=path, s=size, m=mime)
def ready(w, b, files, c=None):
    """A posted bulletin with every page stored and every file finished."""
    p = post(w, b, files, c=c)
    for f in p['bulletin']['files']:
        for path in f['paths']: put_page(w.d, path)
        r = finish_(w, f['id']); assert 'missing' not in r, r
    return p['bulletin']['id']
def bj(d, bid): return obj(d.one('select fv_private.bulletin_json(:b)', b=bid))
def err(d, fn): return refused(d, fn)
def sums(d): return row_checksums(d.c, table_columns(d.c))
def queued(d, like=None):
    return d.all("select path, reason, done from submission_file_removal where bucket = :b order by path", b=BUCKET)

# ── post ───────────────────────────────────────────────────────────────────────────────────────────────
def scen_post():
    w = world('post'); d = w.d
    key = nid()
    p = post(w, {'kind': 'announcement', 'body': '  Bring your lab books.  '}, key=key)
    b = p['bulletin']
    ok('post: an announcement with no files answers the bulletin and the bucket', p['bucket'] == BUCKET and b['kind'] == 'announcement', p)
    ok('post: its words are trimmed', b['body'] == 'Bring your lab books.', b)
    ok('post: visible at once, posted_at set', b['visible'] is True and b['posted_at'], b)
    ok('post: it carries its key', b['idempotency_key'] == key, b)
    ok('post: no files, no seen, two can see, no reactions',
       b['files'] == [] and b['seen'] == 0 and b['can_see'] == 2 and b['reactions'] == {'got_it': 0, 'done': 0, 'question': 0}, b)
    ok('post: the answer has exactly the contract\'s keys',
       sorted(b) == sorted(['id', 'kind', 'body', 'link_url', 'link_title', 'pinned', 'pinned_until', 'assessment_id', 'reactions_on', 'visible',
                            'posted_at', 'shown_again_at', 'edited_at', 'created_at', 'updated_at', 'idempotency_key', 'files', 'seen', 'can_see', 'reactions']), sorted(b))
    ok('post: defaults: not pinned, reactions off, no link, not edited, not shown again',
       b['pinned'] is False and b['reactions_on'] is False and b['link_url'] is None and b['edited_at'] is None and b['shown_again_at'] is None, b)
    tomorrow = d.one("select ((now() at time zone 'America/Vancouver')::date + 1)::text")
    r = post(w, {'kind': 'reminder', 'body': 'Lab due Friday', 'pinned': True, 'pinned_until': tomorrow, 'assessment_id': w.a,
                 'reactions_on': True, 'link_url': 'https://example.org/lab', 'link_title': ' The Lab '})['bulletin']
    ok('post: a reminder pinned until tomorrow, linked, with reactions and a link',
       r['kind'] == 'reminder' and r['pinned'] is True and r['pinned_until'] == tomorrow and r['assessment_id'] == w.a and r['reactions_on'] is True
       and r['link_url'] == 'https://example.org/lab' and r['link_title'] == 'The Lab' and r['visible'] is True, r)
    lk = post(w, {'kind': 'announcement', 'link_url': 'HTTP://Example.org'})['bulletin']
    ok('post: a link alone is enough, and HTTP in capitals is taken', lk['link_url'] == 'HTTP://Example.org' and lk['body'] == '', lk)
    # With files.
    f = post(w, {'kind': 'announcement', 'body': 'The board'}, [{'kind': 'photo', 'title': '', 'pages': 1}, {'kind': 'pdf', 'title': 'Notes', 'pages': 3}])
    fb = f['bulletin']; ph, pdf = fb['files']
    ok('post: with files it is not yet visible', fb['visible'] is False and fb['posted_at'] is None, fb)
    ok('post: each file uploading, in order, its name or Photo', [x['kind'] for x in fb['files']] == ['photo', 'pdf'] and ph['title'] == 'Photo'
       and pdf['title'] == 'Notes' and ph['status'] == pdf['status'] == 'uploading' and [ph['position'], pdf['position']] == [1, 2], fb['files'])
    ok('post: each file\'s exact paths', ph['paths'] == ['%s/%s/1.jpg' % (w.c, ph['id'])] and pdf['paths'] == ['%s/%s/%d.jpg' % (w.c, pdf['id'], n) for n in (1, 2, 3)], fb['files'])
    ok('post: a file uploading has finish_by and no bytes', ph.get('finish_by') and ph['bytes'] is None, ph)
    ok('post: a file has exactly the contract\'s keys', sorted(ph) == sorted(['id', 'kind', 'title', 'page_count', 'bytes', 'status', 'position', 'created_at', 'paths', 'finish_by']), sorted(ph))
    ok('post: a file\'s title "PDF" when it has none', post(w, {'kind': 'announcement'}, [{'kind': 'pdf', 'pages': 1}])['bulletin']['files'][0]['title'] == 'PDF')
    # Finish.
    m = finish_(w, pdf['id'])
    ok('finish: before any upload: every page missing, nothing changes', m['missing'] == [1, 2, 3] and m['bad'] == [] and m['bulletin']['files'][1]['status'] == 'uploading', m)
    put_page(d, pdf['paths'][0], 5000); put_page(d, pdf['paths'][1], 6000, mime='image/png')
    m = finish_(w, pdf['id'])
    ok('finish: a page missing and a page of another type', m['missing'] == [3] and m['bad'] == [2], m)
    d.run("update storage.objects set metadata = jsonb_build_object('size', :s::bigint, 'mimetype', 'image/jpeg') where name = :n", s=MB2 + 1, n=pdf['paths'][1])
    put_page(d, pdf['paths'][2], 7000)
    ok('finish: a page over 2 MB is bad', finish_(w, pdf['id'])['bad'] == [2])
    d.run("update storage.objects set metadata = jsonb_build_object('size', 6000, 'mimetype', 'image/jpeg') where name = :n", n=pdf['paths'][1])
    k2 = nid(); m = finish_(w, pdf['id'], k2)
    ok('finish: the PDF ready, its bytes the pages\' total', m['file_id'] == pdf['id'] and m['bulletin']['files'][1]['status'] == 'ready'
       and m['bulletin']['files'][1]['bytes'] == 18000 and 'finish_by' not in m['bulletin']['files'][1] and 'missing' not in m, m)
    ok('finish: the bulletin still not visible while the photo uploads', m['bulletin']['visible'] is False, m['bulletin'])
    ok('finish: the same key again answers the same', finish_(w, pdf['id'], k2) == m)
    ok('finish: a ready file again: the same answer, nothing changes', finish_(w, pdf['id'])['bulletin']['files'][1] == m['bulletin']['files'][1])
    put_page(d, ph['paths'][0], 1500)
    m = finish_(w, ph['id'])
    ok('finish: the last file ready makes the bulletin visible', m['bulletin']['visible'] is True and m['bulletin']['posted_at'] >= fb['created_at'], m['bulletin'])
    ok('finish: by Teacher B, or an id that is not there: gone', finish_(w, ph['id'], uid=B) == {'file_id': ph['id'], 'status': 'gone'}
       and finish_(w, nid())['status'] == 'gone')
    # List.
    ls = listed(w)
    ok('list: the class\'s counts and switch', (ls['can_see'], ls['no_card'], ls['paused'], ls['page_on'], ls['more']) == (2, 3, 1, True, False), ls)
    ids = [x['id'] for x in ls['bulletins']]
    at = [x['posted_at'] or x['created_at'] for x in ls['bulletins'][1:]]
    ok('list: pinned first, then newest first', ids[0] == r['id'] and len(ids) == 5 and at == sorted(at, reverse=True), (ids, at))
    up = post(w, {'kind': 'announcement', 'body': 'later'}, [{'kind': 'photo', 'pages': 1}])['bulletin']
    ls = listed(w)
    ok('list: one still uploading is there, not visible', [x['visible'] for x in ls['bulletins'] if x['id'] == up['id']] == [False], ls)
    yesterday = d.one("select ((now() at time zone 'America/Vancouver')::date - 1)::text")
    d.run('update bulletin set pinned_until = :y where id = :b', y=yesterday, b=r['id'])
    ls = listed(w)
    mine = [x for x in ls['bulletins'] if x['id'] == r['id']][0]
    ok('list: a reminder past its last day reads as not pinned, and loses its place', mine['pinned'] is False and ls['bulletins'][0]['id'] != r['id'], (mine, ls['bulletins'][0]['id']))
    ok('list: the row itself is not changed', d.one('select pinned from bulletin where id = :b', b=r['id']) is True)
    # "Today" is the class's own day: two zones 25 hours apart, so one is always a day ahead of the other.
    d.run("update student_card set works_until = (now() at time zone 'Pacific/Pago_Pago')::date where enrollment_id = :e", e=w.e['can2'])
    d.run("update bulletin set pinned_until = (now() at time zone 'Pacific/Pago_Pago')::date where id = :b", b=r['id'])
    card = d.one('select id::text from student_card where enrollment_id = :e and stopped_at is null', e=w.e['can2'])
    for tz, works in (('Pacific/Pago_Pago', True), ('Pacific/Kiritimati', False), ('', None), ('Not/A_Zone', None)):
        d.run('update course set timezone = :t where id = :c', t=tz, c=w.c)
        refusal = d.one('select student_submit._card_refusal(:k)', k=card)
        ls = listed(w); mine = [x for x in ls['bulletins'] if x['id'] == r['id']][0]
        want_can = 2 if refusal is None else 1
        ok('list: in zone %r the counts follow _card_refusal (%s)' % (tz, refusal), ls['can_see'] == want_can and ls['no_card'] == 5 - want_can
           and (works is None or (refusal is None) == works), (ls['can_see'], ls['no_card'], refusal))
        ok('list: in zone %r the reminder is pinned exactly while its last day has not passed there' % tz,
           mine['pinned'] == (refusal is None), (mine['pinned'], refusal))
    d.run("update course set timezone = 'America/Vancouver' where id = :c", c=w.c)
    d.run("update student_card set works_until = current_date + 365 where enrollment_id = :e", e=w.e['can2'])
    d.run("insert into bulletin (course_id, kind, body, posted_at) select :c, 'announcement', 'n' || g, now() - g * interval '1 minute' from generate_series(1, 100) g", c=w.c)
    ls = listed(w)
    ok('list: at most 100, and more says there are others', len(ls['bulletins']) == 100 and ls['more'] is True, (len(ls['bulletins']), ls['more']))
    ok('list: an empty class answers an empty list', listed(w, w.c2)['bulletins'] == [] and listed(w, w.c2)['more'] is False)
    ok('list: the class with no students counts none', (listed(w, w.c2)['can_see'], listed(w, w.c2)['no_card']) == (0, 1))
    d.close()

# ── edit ───────────────────────────────────────────────────────────────────────────────────────────────
def scen_edit():
    w = world('edit'); d = w.d
    b = post(w, {'kind': 'reminder', 'body': 'Due Friday', 'link_url': 'https://a.example', 'link_title': 'A', 'pinned': True})['bulletin']
    time.sleep(0.01)
    e = edit(w, b['id'], {'pinned': False, 'reactions_on': True})['bulletin']
    ok('edit: pin and reactions change updated_at, not edited_at', e['pinned'] is False and e['reactions_on'] is True and e['edited_at'] is None and e['updated_at'] > b['updated_at'], e)
    e2 = edit(w, b['id'], {'pinned': False})['bulletin']
    ok('edit: a change that changes nothing writes nothing', e2['updated_at'] == e['updated_at'], (e2['updated_at'], e['updated_at']))
    e3 = edit(w, b['id'], {'body': ' Due Monday '})['bulletin']
    ok('edit: new words set edited_at (trimmed)', e3['body'] == 'Due Monday' and e3['edited_at'] is not None, e3)
    e4 = edit(w, b['id'], {'link_url': None})['bulletin']
    ok('edit: clearing the link clears its name', e4['link_url'] is None and e4['link_title'] is None and e4['edited_at'] >= e3['edited_at'], e4)
    tomorrow = d.one("select ((now() at time zone 'America/Vancouver')::date + 1)::text")
    e5 = edit(w, b['id'], {'pinned': True, 'pinned_until': tomorrow})['bulletin']
    ok('edit: pinned until a date', e5['pinned'] is True and e5['pinned_until'] == tomorrow, e5)
    e6 = edit(w, b['id'], {'pinned': False})['bulletin']
    ok('edit: unpinning clears the last day', e6['pinned'] is False and e6['pinned_until'] is None, e6)
    ok('edit: linked, then unlinked', edit(w, b['id'], {'assessment_id': w.a})['bulletin']['assessment_id'] == w.a
       and edit(w, b['id'], {'assessment_id': None})['bulletin']['assessment_id'] is None)
    key = nid(); x = edit(w, b['id'], {'body': 'Keyed'}, key)
    edit(w, b['id'], {'body': 'Other'})
    ok('edit: the same key again answers the first reply and writes nothing', edit(w, b['id'], {'body': 'Keyed again'}, key) == x
       and d.one('select body from bulletin where id = :b', b=b['id']) == 'Other')
    before = sums(d)
    for name, patch, want in [('the kind', {'kind': 'announcement'}, '22023'), ('an unknown key', {'colour': 'red'}, '22023'),
                              ('words that are not a string', {'body': 5}, '22023'), ('a pin that is not true or false', {'pinned': 'yes'}, '22023'),
                              ('no words, link or file left', {'body': ''}, '22023'), ('another class\'s assessment', {'assessment_id': w.a2}, '22023'),
                              ('an assessment id that is not an id', {'assessment_id': 'x'}, '22023'), ('a date that is not a date', {'pinned_until': '2026-13-40'}, '22023'),
                              ('a past last day', {'pinned': True, 'pinned_until': '2020-01-01'}, '22023'),
                              ('a last day with pinned false', {'pinned': False, 'pinned_until': tomorrow}, '22023'),
                              ('a link\'s name with no link', {'link_title': 'x'}, '22023')]:
        r = err(d, lambda: edit(w, b['id'], patch))
        ok('edit refuses %s (%s)' % (name, want), code(r) == want, r)
    ok('edit: a patch that is not an object is refused', code(err(d, lambda: T(d, "edit_bulletin(:b, '[1]'::jsonb, null)", b=b['id']))) == '22023')
    ok('edit: the refusals changed nothing', sums(d) == before)
    # A last day that has passed is refused only when the change names the pin.
    edit(w, b['id'], {'pinned': True, 'pinned_until': tomorrow}); d.run("update bulletin set pinned_until = date '2020-01-01' where id = :b", b=b['id'])
    ok('edit: new words on a reminder past its day are taken', edit(w, b['id'], {'body': 'Still here'})['bulletin']['body'] == 'Still here')
    ok('edit: an announcement cannot take a last day', code(err(d, lambda: edit(w, post(w, {'kind': 'announcement', 'body': 'x', 'pinned': True})['bulletin']['id'],
                                                                        {'pinned_until': tomorrow}))) == '22023')
    ok('edit: a bulletin that is not there is P0002', code(err(d, lambda: edit(w, nid(), {'body': 'x'}))) == 'P0002')
    fb = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}])['bulletin']
    ok('edit: one with a file may lose its words', edit(w, fb['id'], {'body': ''})['bulletin']['body'] == '')
    d.close()

# ── delete ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_delete():
    w = world('delete'); d = w.d
    bid = ready(w, {'kind': 'announcement', 'body': 'x', 'reactions_on': True}, [{'kind': 'photo', 'pages': 1}, {'kind': 'pdf', 'pages': 2}])
    keep = post(w, {'kind': 'announcement', 'body': 'keep'})['bulletin']['id']
    for k in ('can1', 'can2'):
        d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e), (:k, :e)', b=bid, k=keep, e=w.e[k])
    d.run("insert into bulletin_reaction (bulletin_id, enrollment_id, word) values (:b, :e, 'done')", b=bid, e=w.e['can1'])
    pages = sorted('%s/%s/%d.jpg' % (w.c, f, n) for f, k in d.all('select id::text, page_count from bulletin_file where bulletin_id = :b', b=bid)
                   for n in range(1, k + 1))
    key = nid(); r = delete(w, bid, key)
    ok('delete: answers deleted and the id', r == {'deleted': True, 'id': bid}, r)
    ok('delete: the bulletin, its files, its seen and reaction rows are gone',
       d.one('select count(*) from bulletin where id = :b', b=bid) == 0 and d.one('select count(*) from bulletin_file where bulletin_id = :b', b=bid) == 0
       and d.one('select count(*) from bulletin_seen where bulletin_id = :b', b=bid) == 0 and d.one('select count(*) from bulletin_reaction where bulletin_id = :b', b=bid) == 0)
    q = queued(d)
    ok('delete: every page is queued in bulletin-files, reason bulletin_removed, not yet done',
       [x[0] for x in q] == pages and len(pages) == 3 and all(x[1] == 'bulletin_removed' and x[2] is False for x in q), (q, pages))
    ok('delete: the other bulletin and its seen rows stay', d.one('select count(*) from bulletin_seen where bulletin_id = :k', k=keep) == 2)
    ok('delete: the same key again answers the same', delete(w, bid, key) == r)
    ok('delete: again with another key is P0002', code(err(d, lambda: delete(w, bid))) == 'P0002')
    ok('delete: Teacher B cannot delete A\'s', code(err(d, lambda: delete(w, keep, uid=B))) == 'P0002' and d.one('select count(*) from bulletin where id = :k', k=keep) == 1)
    d.close()

# ── counts ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_counts():
    w = world('counts'); d = w.d; e = w.e
    bid = post(w, {'kind': 'announcement', 'body': 'x', 'reactions_on': True})['bulletin']['id']
    for k in ('can1', 'paused', 'gone', 'nocard', 'stopped', 'expired'):
        d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)', b=bid, e=e[k])
    d.run("insert into bulletin_reaction (bulletin_id, enrollment_id, word) values (:b, :c1, 'got_it'), (:b, :p, 'done'), (:b, :n, 'question')",
          b=bid, c1=e['can1'], p=e['paused'], n=e['nocard'])
    j = bj(d, bid)
    ok('counts: Seen by 1 of 2: only students who can open the page count', (j['seen'], j['can_see']) == (1, 2), j)
    ok('counts: reactions of those students only', j['reactions'] == {'got_it': 1, 'done': 0, 'question': 0}, j)
    s = seen_list(w, bid)
    ok('counts: the seen list, in class-list order, ids only', s == {'bulletin_id': bid, 'not_seen': [e['can2']], 'seen': [e['can1']],
       'reactions': {'got_it': [e['can1']], 'done': [], 'question': []}, 'paused': [e['paused']], 'no_card': [e['nocard'], e['stopped'], e['expired']]}, s)
    ok('counts: the withdrawn student is in no list', e['gone'] not in json.dumps(s))
    ls = listed(w)
    ok('counts: the class: 2 can see, 3 have no card, 1 paused', (ls['can_see'], ls['no_card'], ls['paused']) == (2, 3, 1), ls)
    d.run('update student_card set locked_at = now() where enrollment_id = :e', e=e['can2'])
    ok('counts: a locked card still counts (as _card_refusal has it)', bj(d, bid)['can_see'] == 2)
    d.run("update student_card set works_until = (now() at time zone 'America/Vancouver')::date where enrollment_id = :e", e=e['can2'])
    ok('counts: a card that works until today still counts', bj(d, bid)['can_see'] == 2)
    d.run('update enrollment set page_paused_at = null where id = :e', e=e['paused'])
    ok('counts: unpaused, they count again, seen included', (bj(d, bid)['seen'], bj(d, bid)['can_see']) == (2, 3))
    d.run('update enrollment set page_paused_at = now() where id = :e', e=e['paused'])
    d.run('update course set student_page_enabled = false where id = :c', c=w.c)
    ls = listed(w)
    ok('counts: the page switched off says so, the counts are as before', ls['page_on'] is False and ls['can_see'] == 2, ls)
    ok('counts: a never-seen list for a new bulletin', seen_list(w, post(w, {'kind': 'announcement', 'body': 'y'})['bulletin']['id'])['seen'] == [])
    # Same class.
    r = err(d, lambda: d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)', b=bid, e=w.e2))
    ok('counts: a seen row for a student of another class is refused by the table', code(r) == '23514', r)
    r = err(d, lambda: d.run("insert into bulletin_reaction (bulletin_id, enrollment_id, word) values (:b, :e, 'done')", b=bid, e=w.eb))
    ok('counts: a reaction for Teacher B\'s student is refused by the table', code(r) == '23514', r)
    r = err(d, lambda: d.run("insert into bulletin_reaction (bulletin_id, enrollment_id, word) values (:b, :e, 'wow')", b=bid, e=e['can2']))
    ok('counts: a reaction word not on the list is refused', code(r) == '23514', r)
    r = err(d, lambda: d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)', b=bid, e=e['can1']))
    ok('counts: one seen row per student per bulletin', code(r) == '23505', r)
    # Show again.
    key = nid(); a1 = again(w, bid, key)['bulletin']
    ok('show again: shown_again_at is set', a1['shown_again_at'] is not None, a1)
    ok('show again: the same key answers the same', again(w, bid, key)['bulletin'] == a1)
    up = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}])['bulletin']['id']
    ok('show again: one not yet visible is 22023', code(err(d, lambda: again(w, up))) == '22023')
    ok('show again: not there is P0002', code(err(d, lambda: again(w, nid()))) == 'P0002')
    d.close()

# ── others ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_others():
    w = world('others'); d = w.d
    p = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}])['bulletin']
    bid, fid = p['id'], p['files'][0]['id']
    bb = post(w, {'kind': 'announcement', 'body': 'Bravo secret'}, uid=B, c=w.cb)['bulletin']['id']
    before = sums(d)
    calls = [('list', lambda uid: listed(w, uid=uid)), ('post', lambda uid: post(w, {'kind': 'announcement', 'body': 'x'}, uid=uid)),
             ('edit', lambda uid: edit(w, bid, {'body': 'y'}, uid=uid)), ('delete', lambda uid: delete(w, bid, uid=uid)),
             ('seen list', lambda uid: seen_list(w, bid, uid=uid)), ('show again', lambda uid: again(w, bid, uid=uid))]
    for name, fn in calls:
        r = err(d, lambda: fn(B))
        ok('others: Teacher B on A\'s class, %s: P0002' % name, code(r) == 'P0002', r)
    ok('others: Teacher B finishing A\'s file: gone', finish_(w, fid, uid=B) == {'file_id': fid, 'status': 'gone'})
    ok('others: none of it changed a row', sums(d) == before)
    ok('others: A cannot reach B\'s bulletin', all(code(err(d, lambda f=f: f())) == 'P0002' for f in
       (lambda: edit(w, bb, {'body': 'z'}), lambda: delete(w, bb), lambda: seen_list(w, bb), lambda: again(w, bb), lambda: listed(w, w.cb))))
    ok('others: A\'s answers never hold B\'s words', 'Bravo secret' not in json.dumps(listed(w)))
    ok('others: a class in the trash: list and post are P0002', code(err(d, lambda: listed(w, w.trash))) == 'P0002'
       and code(err(d, lambda: post(w, {'kind': 'announcement', 'body': 'x'}, c=w.trash))) == 'P0002')
    ok('others: ids that do not exist: P0002 (finish: gone)', code(err(d, lambda: listed(w, nid()))) == 'P0002' and finish_(w, nid())['status'] == 'gone'
       and code(err(d, lambda: delete(w, nid()))) == 'P0002')
    ok('others: null ids: P0002 (finish: gone)', code(err(d, lambda: T(d, 'list_bulletins(null)'))) == 'P0002' and T(d, 'finish_bulletin_file(null, null)')['status'] == 'gone')
    key = nid(); mine = post(w, {'kind': 'announcement', 'body': 'keyed'}, key=key)
    r = err(d, lambda: post(w, {'kind': 'announcement', 'body': 'x'}, key=key, uid=B))
    ok("others: B sending A's key is not answered A's reply", code(r) == 'P0002', r)
    sigs = [('list_bulletins(:c)', {'c': w.c}), ("post_bulletin(:c, '{\"kind\": \"announcement\", \"body\": \"x\"}'::jsonb, null, null)", {'c': w.c}),
            ('finish_bulletin_file(:f, null)', {'f': fid}), ("edit_bulletin(:b, '{}'::jsonb, null)", {'b': bid}), ('delete_bulletin(:b, null)', {'b': bid}),
            ('list_bulletin_seen(:b)', {'b': bid}), ('show_bulletin_again(:b, null)', {'b': bid})]
    for sql, kw in sigs:
        name = sql.split('(')[0]
        r = err(d, lambda: d.role('authenticated', 'select ' + sql, uid='', **kw))
        ok('others: signed out, %s is PT401' % name, code(r) == 'PT401', r)
        for role in ('anon', 'service_role'):
            r = err(d, lambda: d.role(role, 'select ' + sql, **kw))
            ok('others: %s may not run %s' % (role, name), code(r) == '42501', r)
    for role in ('anon', 'authenticated', 'service_role'):
        uid = A if role == 'authenticated' else None
        for t in TABLES:
            r = err(d, lambda: d.role(role, 'select count(*) from %s' % t, uid=uid))
            ok('others: %s cannot read %s' % (role, t), code(r) == '42501', r)
            r = err(d, lambda: d.role(role, 'delete from %s' % t, uid=uid))
            ok('others: %s cannot delete from %s' % (role, t), code(r) == '42501', r)
        r = err(d, lambda: d.role(role, "insert into public.bulletin (course_id, kind) values (:c, 'announcement')", uid=uid, c=w.c))
        ok('others: %s cannot write public.bulletin' % role, code(r) == '42501', r)
        r = err(d, lambda: d.role(role, "update public.bulletin_seen set seen_at = now()", uid=uid))
        ok('others: %s cannot change public.bulletin_seen' % role, code(r) == '42501', r)
        for h in HELPERS:
            ok('others: %s cannot run %s' % (role, h), not d.one("select has_function_privilege(:r, :s, 'execute')", r=role, s=h))
    r = err(d, lambda: d.role('authenticated', 'select fv_private.bulletin_json(:b)', uid=A, b=bid))
    ok('others: a teacher calling the answer-building helper directly is refused', code(r) == '42501', r)
    ok('others: the storage helpers: a teacher may run them, a visitor and the service role may not',
       all(d.one("select has_function_privilege('authenticated', :s, 'execute') and not has_function_privilege('anon', :s, 'execute') and not has_function_privilege('service_role', :s, 'execute')", s=s)
           for s in ('fv_private.bulletin_file_upload_allowed(text)', 'fv_private.bulletin_file_read_allowed(text)')))
    ok('others: no function of the student page names the tables (B1b adds them)',
       d.one("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'student_submit' and p.prosrc ~ 'bulletin'") == 0)
    cur = lambda: sums(d).get('public.course_sync_cursor')
    c0 = cur(); nb = post(w, {'kind': 'announcement', 'body': 'cursor'})['bulletin']['id']; edit(w, nb, {'body': 'c2'}); again(w, nb); delete(w, nb)
    ok('others: no sync cursor moves (no other device reloads the class)', c0 is not None and cur() == c0, (c0, cur()))
    d.close()

# ── storage ────────────────────────────────────────────────────────────────────────────────────────────
def insert_as(d, uid, name, bucket=BUCKET, mime='image/jpeg', role='authenticated'):
    e = refused(d, lambda: d.role(role, "insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', 10, 'mimetype', :m::text))",
                                  uid, b=bucket, n=name, m=mime))
    return 'ok' if e is None else e[1]
def count_as(d, role, uid, name): return d.role(role, 'select count(*) from storage.objects where name = :n', uid, n=name)[0][0]

def scen_storage():
    w = world('storage'); d = w.d
    ok('storage: the bucket is private, 2 MB, JPEG only',
       d.all("select public, file_size_limit, allowed_mime_types::text from storage.buckets where id = :b", b=BUCKET) == [[False, MB2, '{image/jpeg}']])
    f = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'pdf', 'pages': 2}])['bulletin']['files'][0]
    p1, p2 = f['paths']
    ok("storage: Teacher B cannot write A's page", insert_as(d, B, p1) == '42501')
    ok('storage: A cannot write a page past the file\'s count', insert_as(d, A, '%s/%s/3.jpg' % (w.c, f['id'])) == '42501')
    ok('storage: A cannot write page 0, 01 or 21', all(insert_as(d, A, '%s/%s/%s.jpg' % (w.c, f['id'], n)) == '42501' for n in ('0', '01', '21')))
    ok('storage: A cannot write under another class', insert_as(d, A, '%s/%s/1.jpg' % (w.c2, f['id'])) == '42501')
    ok('storage: an upload with no uploading row is refused', insert_as(d, A, '%s/%s/1.jpg' % (w.c, nid())) == '42501')
    ok('storage: upper-case ids are refused', insert_as(d, A, p1.upper().replace('.JPG', '.jpg')) == '42501')
    ok('storage: A cannot write the page into student-photos', insert_as(d, A, p1, bucket='student-photos') == '42501')
    ok('storage: a visitor cannot write it', insert_as(d, None, p1, role='anon') != 'ok')
    ok('storage: A writes the page while it uploads', insert_as(d, A, p1) == 'ok')
    ok('storage: A reads it; B and a visitor do not', count_as(d, 'authenticated', A, p1) == 1 and count_as(d, 'authenticated', B, p1) == 0 and count_as(d, 'anon', None, p1) == 0)
    ch = d.role('authenticated', "update storage.objects set metadata = '{}' where name = :n returning 1", A, n=p1)
    de = d.role('authenticated', "delete from storage.objects where name = :n returning 1", A, n=p1)
    ok('storage: A can neither change nor delete it', ch == [] and de == [] and d.one('select count(*) from storage.objects where name = :n', n=p1) == 1, (ch, de))
    d.run("update bulletin_file set created_at = now() - interval '2 hours 1 minute' where id = :f", f=f['id'])
    ok('storage: past its two hours the page cannot be written', insert_as(d, A, p2) == '42501')
    d.run("update bulletin_file set created_at = now() where id = :f", f=f['id'])
    put_page(d, p2); r = finish_(w, f['id']); ok('storage: (setup) finished', r['bulletin']['visible'] is True, r)
    d.run('delete from storage.objects where name = :n', n=p2)
    ok('storage: a second upload to a finished file is refused', insert_as(d, A, p2) == '42501')
    ok('storage: A still reads a ready file\'s page', count_as(d, 'authenticated', A, p1) == 1)
    d.run("create policy careless on storage.objects for all to public using (true) with check (true)")
    try:
        ok('storage: with a careless policy, B still reads nothing of A\'s, a visitor nothing',
           count_as(d, 'authenticated', B, p1) == 0 and count_as(d, 'anon', None, p1) == 0)
        ok('storage: with a careless policy, B writes nothing and A no page never issued',
           insert_as(d, B, '%s/%s/1.jpg' % (w.cb, nid())) == '42501' and insert_as(d, A, '%s/%s/1.jpg' % (w.c, nid())) == '42501')
        de = d.role('authenticated', "delete from storage.objects where name = :n returning 1", B, n=p1)
        ok('storage: with a careless policy, B cannot delete A\'s page', de == [], de)
    finally:
        d.run('drop policy careless on storage.objects')
    # The other buckets as before: a handout page in student-photos still uploads.
    a = T(d, "start_handout_upload(:a, 'Old PDF', 1, gen_random_uuid())", a=w.a)
    ok('storage: student-photos is as before: a handout page uploads', insert_as(d, A, a['paths'][0], bucket='student-photos') == 'ok')
    d.close()

# ── cascade ────────────────────────────────────────────────────────────────────────────────────────────
def scen_cascade():
    w = world('cascade'); d = w.d; e = w.e
    b1 = ready(w, {'kind': 'reminder', 'body': 'x', 'assessment_id': w.a, 'reactions_on': True}, [{'kind': 'pdf', 'pages': 3}])
    b2 = post(w, {'kind': 'announcement', 'body': 'y'}, [{'kind': 'photo', 'pages': 1}])['bulletin']['id']
    other = ready(w, {'kind': 'announcement', 'body': 'other class'}, [{'kind': 'photo', 'pages': 1}], c=w.c2)
    for k in ('can1', 'gone'):
        d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)', b=b1, e=e[k])
        d.run("insert into bulletin_reaction (bulletin_id, enrollment_id, word) values (:b, :e, 'done')", b=b1, e=e[k])
    d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)', b=other, e=w.e2)
    T(d, 'delete_withdrawn_student(:e, gen_random_uuid())', e=e['gone'])
    ok('cascade: a withdrawn student deleted for good takes their seen and reaction rows',
       d.one('select count(*) from bulletin_seen where enrollment_id = :e', e=e['gone']) == 0 and d.one('select count(*) from bulletin_reaction where enrollment_id = :e', e=e['gone']) == 0)
    ok('cascade: the others\' rows stay', d.one('select count(*) from bulletin_seen where bulletin_id = :b', b=b1) == 1)
    T(d, 'delete_assessment(:a)', a=w.a)
    ok('cascade: a deleted assessment unlinks it; the bulletin stays', d.one('select assessment_id is null from bulletin where id = :b', b=b1) is True)
    # Expired: hidden in a read-only transaction, dropped by the next list that can write.
    d.run("update bulletin set created_at = now() - interval '3 hours' where id = :b", b=b2)
    d.run("update bulletin_file set created_at = now() - interval '3 hours' where bulletin_id = :b", b=b2)
    d.begin(); d.run('set transaction read only')
    ls = listed(w)
    d.rollback()
    ok('cascade: in a read-only transaction list hides an upload past two hours and deletes nothing',
       b2 not in [x['id'] for x in ls['bulletins']] and d.one('select count(*) from bulletin where id = :b', b=b2) == 1)
    listed(w)
    ok('cascade: list drops it, and its page is queued (bulletin_expired)', d.one('select count(*) from bulletin where id = :b', b=b2) == 0
       and d.all("select reason from submission_file_removal where path like :p", p=w.c + '/%') == [['bulletin_expired']])
    ok('cascade: one made visible is never dropped', d.one('select count(*) from bulletin where id = :b', b=b1) == 1)
    d.run("update bulletin set created_at = now() - interval '3 hours' where id = :b", b=b1)
    listed(w); ok('cascade: (an old visible one stays)', d.one('select count(*) from bulletin where id = :b', b=b1) == 1)
    n_c2 = d.one('select count(*) from submission_file_removal')
    d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c)
    d.run('select public.fv_retention_cleanup()')
    ok('cascade: a class purged from the trash takes every bulletin, file, seen and reaction row',
       d.one('select count(*) from course where id = :c', c=w.c) == 0 and d.one('select count(*) from bulletin where course_id = :c', c=w.c) == 0
       and d.one('select count(*) from bulletin_file where course_id = :c', c=w.c) == 0
       and d.one('select count(*) from bulletin_seen s join enrollment x on x.id = s.enrollment_id where x.course_id = :c', c=w.c) == 0)
    ok('cascade: and queues every page it had', d.all("select reason, count(*) from submission_file_removal where path like :p and reason = 'bulletin_removed' group by 1", p=w.c + '/%')
       == [['bulletin_removed', 3]], d.all("select path, reason from submission_file_removal"))
    ok('cascade: the other class keeps everything', d.one('select count(*) from bulletin where id = :b', b=other) == 1
       and d.one('select count(*) from bulletin_seen where bulletin_id = :b', b=other) == 1)
    x = post(w, {'kind': 'announcement', 'body': 'z'}, [{'kind': 'photo', 'pages': 1}], c=w.c2)['bulletin']['id']
    d.run("update bulletin set created_at = now() - interval '3 hours' where id = :b", b=x)
    n0 = d.one('select count(*) from bulletin'); r = d.one('select fv_private.bulletin_drop_expired(null)')
    ok('cascade: the drop takes one class only: given none, it drops nothing', r == 0 and d.one('select count(*) from bulletin') == n0, (r, n0))
    ok('cascade: given the class, it drops the expired one', d.one('select fv_private.bulletin_drop_expired(:c)', c=w.c2) == 1
       and d.one('select count(*) from bulletin where id = :b', b=x) == 0)
    # A purge with an assessment still linked to a bulletin, and a teacher's account purge.
    lb = post(w, {'kind': 'reminder', 'body': 'linked', 'assessment_id': w.a2}, c=w.c2)['bulletin']['id']
    d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c2)
    d.run('select public.fv_retention_cleanup()')
    ok('cascade: a class purged with an assessment still linked takes the bulletin, the assessment and everything',
       d.one('select count(*) from bulletin where id = any (:b)', b=[lb, other]) == 0 and d.one('select count(*) from assessment where id = :a', a=w.a2) == 0)
    pb = post(w, {'kind': 'announcement', 'body': 'bravo'}, [{'kind': 'pdf', 'pages': 2}], uid=B, c=w.cb)['bulletin']
    d.run("insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)", b=pb['id'], e=w.eb)
    d.run("update teacher set deleted_at = now() - interval '31 days' where id = :b", b=B)
    d.run('select public.fv_retention_cleanup()')
    ok('cascade: a teacher\'s account purge takes their bulletins and queues every page',
       d.one('select count(*) from bulletin where course_id = :c', c=w.cb) == 0 and d.one('select count(*) from bulletin_seen where enrollment_id = :e', e=w.eb) == 0
       and sorted(r[0] for r in d.all("select path from submission_file_removal where bucket = :k and course_id = :c", k=BUCKET, c=w.cb)) == sorted(pb['files'][0]['paths']),
       d.all("select path from submission_file_removal where course_id = :c", c=w.cb))
    d.close()

# ── limits ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_limits():
    w = world('limits'); d = w.d
    yesterday = d.one("select ((now() at time zone 'America/Vancouver')::date - 1)::text")
    an = lambda **k: dict({'kind': 'announcement', 'body': 'x'}, **k)
    before = sums(d)
    cases = [('words of 2001 characters', an(body='y' * 2001), None), ('a link to ftp', an(link_url='ftp://example.org'), None),
             ('a javascript: link', an(link_url='javascript:alert(1)'), None), ('a link with a space', an(link_url='https://ex ample.org'), None),
             ('a link with no host', an(link_url='https:///x'), None), ('a link of 2001 characters', an(link_url='https://e.org/' + 'a' * 1987), None),
             ('a link name of 201', an(link_url='https://e.org', link_title='t' * 201), None), ('a link name with no link', an(link_title='t'), None),
             ('a photo of 2 pages', an(), [{'kind': 'photo', 'pages': 2}]), ('a PDF of 21 pages', an(), [{'kind': 'pdf', 'pages': 21}]),
             ('a PDF of 0 pages', an(), [{'kind': 'pdf', 'pages': 0}]), ('a PDF of 1.5 pages', an(), [{'kind': 'pdf', 'pages': 1.5}]),
             ('pages as a string', an(), [{'kind': 'pdf', 'pages': '2'}]), ('21 pages in all', an(), [{'kind': 'pdf', 'pages': 20}, {'kind': 'photo', 'pages': 1}]),
             ('a file of another kind', an(), [{'kind': 'epub', 'pages': 1}]), ('a file with another key', an(), [{'kind': 'pdf', 'pages': 1, 'url': 'x'}]),
             ('a file name of 201', an(), [{'kind': 'pdf', 'pages': 1, 'title': 'n' * 201}]), ('a file that is not an object', an(), ['pdf']),
             ('files that are not a list', an(), {'kind': 'pdf'}),
             ('another class\'s assessment', an(assessment_id=None) | {'assessment_id': 'A2'}, None), ('Teacher B\'s assessment', an() | {'assessment_id': 'AB'}, None),
             ('a poll (not in this migration)', {'kind': 'poll', 'body': 'x'}, None), ('no kind', {'body': 'x'}, None),
             ('a last day on an announcement', an(pinned=True, pinned_until='2099-01-01'), None),
             ('a last day with no pin', {'kind': 'reminder', 'body': 'x', 'pinned_until': '2099-01-01'}, None),
             ('a last day that has passed', {'kind': 'reminder', 'body': 'x', 'pinned': True, 'pinned_until': yesterday}, None),
             ('a date that is not a date', {'kind': 'reminder', 'body': 'x', 'pinned': True, 'pinned_until': 'Friday'}, None),
             ('an unknown key', an(colour='red'), None), ('words that are a number', {'kind': 'announcement', 'body': 7}, None),
             ('nothing in it', {'kind': 'announcement', 'body': '   '}, None), ('a bulletin that is a list', [1], None),
             ('words of only newlines and tabs', {'kind': 'announcement', 'body': '\n\t \r\n'}, None),
             ('a link with a name and password', an(link_url='https://user:pass@example.org/'), None),
             ('a link with a backslash before @', an(link_url='https://example.org\\@evil.example/'), None),
             ('a link with a right-to-left override', an(link_url='https://example.org/\u202egpj.exe'), None),
             ('a link with a zero-width space', an(link_url='https://exa\u200bmple.org/'), None),
             ('a PDF of 1.0 pages', an(), [{'kind': 'pdf', 'pages': 1.0}]), ('a PDF of 3.50 pages', an(), [{'kind': 'pdf', 'pages': 3.5}]),
             ('a photo of 1.0 pages', an(), [{'kind': 'photo', 'pages': 1.0}])]
    for bad in ('infinity', '-infinity', 'tomorrow', 'today', '12/31/2099', '20990101', '2099-01-01T00:00:00', '2099-01-01 00:00', '2026-02-30', ' 2099-1-1'):
        cases.append(('a last day of %r' % bad, {'kind': 'reminder', 'body': 'x', 'pinned': True, 'pinned_until': bad}, None))
    for name, b, files in cases:
        if isinstance(b, dict) and b.get('assessment_id') == 'A2': b['assessment_id'] = w.a2
        if isinstance(b, dict) and b.get('assessment_id') == 'AB': b['assessment_id'] = w.ab
        if files == 'RAW2E0':
            r = err(d, lambda: T(d, "post_bulletin(:c, cast(:b as jsonb), '[{\"kind\": \"pdf\", \"pages\": 2e0}]'::jsonb, null)", c=w.c, b=json.dumps(b)))
        else:
            r = err(d, lambda: post(w, b, files))
        ok('limits: post refuses %s (22023)' % name, code(r) == '22023', r)
    ok('limits: the post refusals added nothing', sums(d) == before, [k for k in before if sums(d).get(k) != before[k]])
    tid = post(w, {'kind': 'reminder', 'body': 'x', 'pinned': True})['bulletin']['id']
    before = sums(d)
    for bad in ('infinity', 'tomorrow', '20990101', '2099-01-01T10:00:00'):
        r = err(d, lambda: edit(w, tid, {'pinned_until': bad}))
        ok('limits: edit refuses a last day of %r (22023)' % bad, code(r) == '22023', r)
    ok('limits: edit refuses a pin given as a number', code(err(d, lambda: edit(w, tid, {'pinned': 1}))) == '22023')
    ok('limits: the edit refusals changed nothing', sums(d) == before, [k for k in before if sums(d).get(k) != before[k]])
    ok('limits: words padded with newlines and tabs are trimmed', post(w, an(body='\n\t Hello \r\n'))['bulletin']['body'] == 'Hello')
    ok('limits: a link with @ after the host is taken', post(w, an(link_url='https://example.org/@someone'))['bulletin']['link_url'] == 'https://example.org/@someone')
    r = err(d, lambda: d.run("insert into bulletin (course_id, kind, body, pinned, pinned_until) values (:c, 'reminder', 'x', true, 'infinity')", c=w.c))
    ok('limits: the table refuses a last day of infinity', code(r) == '23514', r)
    r = err(d, lambda: d.run("insert into bulletin (course_id, kind, link_url) values (:c, 'announcement', 'https://u:p@x.org')", c=w.c))
    ok('limits: the table refuses a link with a name and password', code(r) == '23514', r)
    ok('limits: 2000 characters are taken', len(post(w, an(body='y' * 2000))['bulletin']['body']) == 2000)
    ok('limits: a link of 2000 is taken', len(post(w, an(link_url='https://e.org/' + 'a' * 1986))['bulletin']['link_url']) == 2000)
    ok('limits: 20 pages on one bulletin are taken', len(post(w, an(), [{'kind': 'pdf', 'pages': 19}, {'kind': 'photo', 'pages': 1}])['bulletin']['files']) == 2)
    ok('limits: a last day of today is taken', post(w, {'kind': 'reminder', 'body': 'x', 'pinned': True,
       'pinned_until': d.one("select (now() at time zone 'America/Vancouver')::date::text")})['bulletin']['pinned'] is True)
    # 2000 pages a class.
    have = d.one('select coalesce(sum(page_count), 0) from bulletin_file where course_id = :c', c=w.c)
    bid = post(w, an())['bulletin']['id']
    d.run("insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position) select :c, :b, 'pdf', 'x', 20, g from generate_series(1, :n) g",
          c=w.c, b=bid, n=(1990 - have) // 20)
    d.run("insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position) values (:c, :b, 'pdf', 'x', :n, 999)",
          c=w.c, b=bid, n=1990 - have - ((1990 - have) // 20) * 20) if (1990 - have) % 20 else None
    ok('limits: (setup) 1990 pages in the class', d.one('select sum(page_count) from bulletin_file where course_id = :c', c=w.c) == 1990)
    r = err(d, lambda: post(w, an(), [{'kind': 'pdf', 'pages': 11}]))
    ok('limits: the 2001st page in a class is refused', code(r) == '22023' and '2000' in r[0], r)
    ok('limits: up to the 2000th is taken', post(w, an(), [{'kind': 'pdf', 'pages': 10}])['bulletin']['visible'] is False)
    ok('limits: another class is not counted', post(w, an(), [{'kind': 'pdf', 'pages': 5}], c=w.c2)['bulletin']['visible'] is False)
    # The table holds the rules too.
    for name, sql in [('a poll', "insert into bulletin (course_id, kind) values (:c, 'poll')"),
                      ('an ftp link', "insert into bulletin (course_id, kind, link_url) values (:c, 'announcement', 'ftp://x.org')"),
                      ('2001 characters', "insert into bulletin (course_id, kind, body) values (:c, 'announcement', repeat('x', 2001))"),
                      ('a last day on an announcement', "insert into bulletin (course_id, kind, pinned, pinned_until) values (:c, 'announcement', true, current_date)"),
                      ('a photo of two pages', "insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position) select :c, id, 'photo', 'x', 2, 1 from bulletin where course_id = :c limit 1"),
                      ('a ready file with no bytes', "insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position, status) select :c, id, 'pdf', 'x', 2, 1, 'ready' from bulletin where course_id = :c limit 1")]:
        r = err(d, lambda: d.run(sql, c=w.c))
        ok('limits: the table refuses %s' % name, code(r) == '23514', r)
    r = err(d, lambda: d.run("insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position) values (:c2, :b, 'pdf', 'x', 1, 1)", c2=w.c2, b=bid))
    ok('limits: the table refuses a file in another class than its bulletin', code(r) == '23503', r)
    d.close()

# ── race ───────────────────────────────────────────────────────────────────────────────────────────────
class Conn:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()
    def as_teacher(self, uid=A):
        self.c.run("select set_config('request.jwt.claim.sub', :u, false)", u=uid); self.c.run('set role authenticated')

def scen_race():
    w = world('race'); d = w.d
    out = {}
    def call(name, sql, **kw):
        c = Conn(d); c.as_teacher()
        try: out[name] = obj(c.run(sql, **kw)[0][0])
        except Exception as e: out[name] = 'ERROR ' + sqlstate(e) + ' ' + message(e)
        c.close()
    body = json.dumps({'kind': 'announcement', 'body': 'race'})
    key = nid(); a = post(w, {'kind': 'announcement', 'body': 'race'}, key=key); b = post(w, {'kind': 'announcement', 'body': 'race'}, key=key)
    ok('race: one key twice posts once and answers the same', a == b and d.one('select count(*) from bulletin where idempotency_key = :k', k=key) == 1)
    d.run('delete from fv_idempotency where key = :k', k=key)
    c = post(w, {'kind': 'announcement', 'body': 'race'}, key=key)
    ok('race: the key\'s stored reply cleared away: the row as it is, no second row', c['bulletin']['id'] == a['bulletin']['id']
       and d.one('select count(*) from bulletin where idempotency_key = :k', k=key) == 1, c)
    for rnd in range(3):
        key = nid(); out.clear()
        gate = Conn(d); gate.run('begin'); gate.run('select pg_advisory_xact_lock(hashtext(:u), hashtext(:k))', u=A, k=key)
        ts = [threading.Thread(target=call, args=(n, 'select post_bulletin(:c, cast(:b as jsonb), null, :k)'), kwargs={'c': w.c, 'b': body, 'k': key}) for n in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5)
        ok('race %d: both posts with one key wait behind its lock' % rnd, out == {})
        gate.run('commit'); gate.close(); [t.join() for t in ts]
        ok('race %d: one key from two connections at once posts once, both answered the same' % rnd,
           isinstance(out.get('one'), dict) and out['one'] == out.get('two') and d.one('select count(*) from bulletin where idempotency_key = :k', k=key) == 1, out)
    # Two posts at the page cap at once: the class's lock lets one through.
    have = d.one('select coalesce(sum(page_count), 0) from bulletin_file where course_id = :c', c=w.c)
    hold = post(w, {'kind': 'announcement', 'body': 'h'})['bulletin']['id']
    d.run("insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position) select :c, :b, 'pdf', 'x', 20, g from generate_series(1, 99) g", c=w.c, b=hold)
    d.run("insert into bulletin_file (course_id, bulletin_id, kind, title, page_count, position) values (:c, :b, 'pdf', 'x', 10, 100)", c=w.c, b=hold)
    for rnd in range(3):
        d.run("delete from bulletin where course_id = :c and body = 'cap'", c=w.c); out.clear()
        files = json.dumps([{'kind': 'pdf', 'pages': 6}])
        gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(:c))", c=w.c)
        ts = [threading.Thread(target=call, args=(n, 'select post_bulletin(:c, cast(:b as jsonb), cast(:f as jsonb), null)'),
                               kwargs={'c': w.c, 'b': json.dumps({'kind': 'announcement', 'body': 'cap'}), 'f': files}) for n in ('one', 'two')]
        [t.start() for t in ts]; time.sleep(0.5); gate.run('commit'); gate.close(); [t.join() for t in ts]
        res = sorted('ok' if isinstance(v, dict) else v.split(' ')[1] for v in out.values())
        ok('race %d: two posts at the page cap at once: one taken, one refused (22023)' % rnd, res == ['22023', 'ok']
           and d.one('select sum(page_count) from bulletin_file where course_id = :c', c=w.c) == have + 1990 + 6, (res, out))
    d.run('delete from bulletin where id = :b', b=hold)
    # Two files of one bulletin finished at once: the bulletin is visible once, at the second.
    for rnd in range(3):
        p = post(w, {'kind': 'announcement', 'body': 'two'}, [{'kind': 'photo', 'pages': 1}, {'kind': 'photo', 'pages': 1}])['bulletin']
        for f in p['files']: put_page(d, f['paths'][0])
        out.clear()
        gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(:c))", c=w.c)
        ts = [threading.Thread(target=call, args=(f['id'], 'select finish_bulletin_file(:f, null)'), kwargs={'f': f['id']}) for f in p['files']]
        [t.start() for t in ts]; time.sleep(0.5); gate.run('commit'); gate.close(); [t.join() for t in ts]
        st = d.all('select status from bulletin_file where bulletin_id = :b', b=p['id'])
        ok('race %d: two files finished at once: both ready, the bulletin visible' % rnd, st == [['ready'], ['ready']]
           and d.one('select posted_at is not null from bulletin where id = :b', b=p['id']) is True
           and sorted(v['bulletin']['visible'] for v in out.values()) == [False, True], out)
    d.close()

# ── defaults, missing ──────────────────────────────────────────────────────────────────────────────────
def scen_defaults():
    w = world('defaults', with_file=False); d = w.d
    for s in ('public', 'fv_private'):
        d.run('alter default privileges in schema %s grant all on tables to anon, authenticated, service_role' % s)
        d.run('alter default privileges in schema %s grant all on functions to anon, authenticated, service_role' % s)
    r = d.file(FILE); ok('defaults: the file applies', r == 'ok', r)
    set_search_path(d); r = d.statements(split(text_of(POST)))
    ok('defaults: the post-check says ok on every row', r == 'ok' and d.rows and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    ok('defaults: a visitor still may not run list', code(err(d, lambda: d.role('anon', 'select list_bulletins(:c)', c=w.c))) == '42501')
    ok('defaults: the service role still may not run post', code(err(d, lambda: d.role('service_role', "select post_bulletin(:c, '{}'::jsonb, null, null)", c=w.c))) == '42501')
    ok('defaults: a teacher still cannot read a table', code(err(d, lambda: d.role('authenticated', 'select count(*) from public.bulletin_seen', uid=A))) == '42501')
    ok('defaults: a teacher still cannot run a helper', code(err(d, lambda: d.role('authenticated', 'select fv_private.bulletin_drop_expired(null)', uid=A))) == '42501')
    d.close()

def scen_missing():
    w = world('missing', with_file=False); d = w.d
    d.run('drop function public.fv_idem_store(uuid, text, jsonb)')
    before = catalog(d.c); r = d.file(FILE)
    ok('apply guard: a missing fv_idem_store stops the file', r.startswith('STOPPED') and 'fv_idem_store' in r, r)
    ok('apply guard: and leaves the catalog as it was', catalog(d.c) == before)
    set_search_path(d)
    ok('apply guard: the pre-check names it', d.statements(split(text_of(PRE))) == 'ok' and ['fingerprint public.fv_idem_store(uuid,text,jsonb)', 'absent'] in d.rows, d.rows)
    d.close()

# ── apply ──────────────────────────────────────────────────────────────────────────────────────────────
def norm(lines):
    def acl(m): return '{' + ','.join(sorted(m.group(1).split(','))) + '}'
    return [re.sub(r'pg_attver=\d+', 'pg_attver=N', re.sub(r'\{([^{}]*=[^{}]*)\}', acl, l)) for l in lines]
def same(a, b): return norm(a) == norm(b)
EXPECTED = re.compile(r'bulletin|^comments on |^depends |^internal triggers (public\.)?(course|enrollment|assessment) \|')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    base = catalog(d.c); rows0 = sums(d)
    set_search_path(d)
    pre = split(text_of(PRE))
    ok('apply: the pre-check returns no rows before', d.statements(pre) == 'ok' and d.rows == [], d.rows)
    ok('apply: the relied-on functions are as the file has them',
       all(re.search(r"'%s', '%s'" % (re.escape(s), d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=s)), text_of(FILE)) for s in RELIED))
    def guard(name, setup, undo, expect):
        d.run(setup); before = catalog(d.c)
        r = d.file(FILE)
        ok('apply guard: %s stops the file' % name, r.startswith('STOPPED') and expect in r, r)
        ok('apply guard: %s leaves the catalog as it was' % name, catalog(d.c) == before, differences(before, catalog(d.c)))
        set_search_path(d)
        ok('apply guard: %s is named by the pre-check' % name, d.statements(pre) == 'ok' and d.rows != [], d.rows)
        d.run(undo)
    for sig in RELIED:
        d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('%s')) as def" % sig)
        guard('a changed %s' % sig.split('(')[0], "do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed') ; end $$" if 'idem' in sig or 'timezone' in sig
              else "do $$ begin execute replace((select def from kept), 'select exists', 'select  exists'); end $$",
              "do $$ begin execute (select def from kept); end $$", sig.split('(')[0].split('.')[1])
        d.run('drop table kept')
    guard('a helper of this file\'s name with other arguments', 'create function fv_private.bulletin_json(text) returns int language sql as $$ select 1 $$',
          'drop function fv_private.bulletin_json(text)', 'are not exactly this file')
    guard('a post_bulletin with other arguments', 'create function public.post_bulletin(text) returns int language sql as $$ select 1 $$',
          'drop function public.post_bulletin(text)', 'are not exactly this file')
    guard('a bulletin table that is not this file\'s', 'create table public.bulletin (id uuid primary key, words text)', 'drop table public.bulletin', 'are not exactly this file')
    guard('a bucket bulletin-files of other settings', "insert into storage.buckets (id, name, public) values ('bulletin-files', 'bulletin-files', true)",
          "delete from storage.buckets where id = 'bulletin-files'", 'is not private')
    guard('another policy on storage.objects', 'create policy extra on storage.objects for select to authenticated using (false)',
          'drop policy extra on storage.objects', 'ten policies')
    guard('a column it reads that is gone', 'alter table public.student_card rename column works_until to works_til',
          'alter table public.student_card rename column works_til to works_until', 'student_card')
    guard('files already in the bucket', "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('bulletin-files', 'bulletin-files', false, 2097152, array['image/jpeg']); insert into storage.objects (bucket_id, name) values ('bulletin-files', 'x/y.jpg')",
          "delete from storage.objects where bucket_id = 'bulletin-files'; delete from storage.buckets where id = 'bulletin-files'", 'holds files')
    ok('apply: after the guards the catalog is the one before', catalog(d.c) == base, differences(base, catalog(d.c)))
    hold = Conn(d); hold.run('begin'); hold.run('lock table public.enrollment in access exclusive mode')
    t0 = time.time(); r = d.file(FILE); took = time.time() - t0
    hold.run('rollback'); hold.close()
    ok('apply: a held lock makes the file give up after about five seconds', r.startswith('STOPPED') and 'lock timeout' in r and 4 < took < 12, (r, took))
    ok('apply: and nothing was applied', catalog(d.c) == base, differences(base, catalog(d.c)))
    r = d.file(FILE); ok('apply: the file applies', r == 'ok', r)
    after = catalog(d.c); gone, came = differences(base, after)
    ok('apply: the catalog changes only in what the header names', all(EXPECTED.search(l) for l in gone + came), [l for l in gone + came if not EXPECTED.search(l)][:8])
    ok('apply: nothing that existed is dropped or changed, but counts', all(re.match(r'(depends |internal triggers |comments on )', l) for l in gone), gone)
    ok('apply: the internal triggers that change are the new keys\' on course, enrollment and assessment',
       sorted(l for l in came if re.match(r'internal triggers (assessment|course|enrollment) ', l)) == ['internal triggers assessment | 28', 'internal triggers course | 40', 'internal triggers enrollment | 50']
       and sorted(l for l in gone if re.match(r'internal triggers (assessment|course|enrollment) ', l)) == ['internal triggers assessment | 26', 'internal triggers course | 36', 'internal triggers enrollment | 46'], (gone, came))
    now = sums(d)
    changed = {k for k in set(now) | set(rows0) if now.get(k) != rows0.get(k)}
    ok('apply: no existing row changed; rows added only in storage.buckets (the bucket) and the new tables',
       changed - set(TABLES) == {'storage.buckets'} and d.one("select count(*) from storage.buckets") == 2, changed)
    ok('apply: the new tables start empty', all(d.one('select count(*) from %s' % t) == 0 for t in TABLES))
    set_search_path(d)
    r = d.statements(split(text_of(POST)))
    ok('apply: the post-check says ok on every row', r == 'ok' and len(d.rows) > 20 and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    ok('apply: the pre-check now names what is there', d.statements(pre) == 'ok' and len(d.rows) >= 23, len(d.rows))
    post(w, {'kind': 'announcement', 'body': 'x'}); held = sums(d)
    r = d.file(FILE); ok('apply: a second run is ok', r == 'ok', r)
    ok('apply: a second run changes nothing', catalog(d.c) == after and sums(d) == held, differences(after, catalog(d.c)))
    ok('apply: every table has a primary key', d.one("select count(*) from pg_constraint where contype = 'p' and conrelid::regclass::text = any (:t)", t=[t.split('.')[1] for t in TABLES]) == 4)
    size = os.path.getsize(os.path.join(HERE, FILE))
    ok('apply: the file is 40 KB or smaller (%d bytes)' % size, size <= 40960, size)
    h = text_of(FILE)[:1500]
    ok('apply: the header says not applied and names its tests, undo and checks', 'Not applied' in h and 'local-test/bulletins-*' in h and 'undo' in h and 'collate "C"' in h)
    d.close()

# ── undo ───────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', with_file=False); d = w.d
    base = catalog(d.c); rows0 = sums(d)
    r = d.file(UNDO); ok('undo: on a database without the file it is ok', r == 'ok', r)
    ok('undo: and changes nothing', catalog(d.c) == base and sums(d) == rows0, differences(base, catalog(d.c)))
    r = d.file(FILE); ok('undo: (setup) the file applies', r == 'ok', r)
    withfile = catalog(d.c)
    r = d.statements(split(part1())); ok('undo PART 1: runs', r == 'ok', r)
    ok('undo PART 1: a teacher can no longer run any of the seven', all(not d.one("select has_function_privilege('authenticated', :s, 'execute')", s=s) for s in TEACHER))
    ok('undo PART 1: the storage helpers keep their grant', d.one("select has_function_privilege('authenticated', 'fv_private.bulletin_file_read_allowed(text)', 'execute')"))
    gone, came = differences(withfile, catalog(d.c))
    ok('undo PART 1: only the seven grants changed', len(gone) == 7 and all('bulletin' in l for l in gone + came), (gone, came))
    r = d.statements(split(part1())); ok('undo PART 1: a second run is ok', r == 'ok', r)
    r = d.file(FILE); ok('undo: the file again gives the functions back', r == 'ok' and same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    # The full removal of an unused install: catalog and rows as before.
    r = d.file(UNDO); ok('undo: the full removal runs', r == 'ok', r)
    ok('undo: the catalog is as before the file', catalog(d.c) == base, differences(base, catalog(d.c)))
    ok('undo: every row is as before (the bucket\'s row deleted too)', sums(d) == rows0, {k for k in rows0 if sums(d).get(k) != rows0[k]})
    r = d.file(UNDO); ok('undo: a second run is ok and changes nothing', r == 'ok' and catalog(d.c) == base, r)
    r = d.file(FILE); ok('undo: the file applies again', r == 'ok' and same(catalog(d.c), withfile), differences(norm(withfile), norm(catalog(d.c))))
    # With use: it refuses while anything is kept, and changes nothing.
    bid = ready(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}])
    d.run('insert into bulletin_seen (bulletin_id, enrollment_id) values (:b, :e)', b=bid, e=w.e['can1'])
    held = catalog(d.c); rows = sums(d)
    r = d.file(UNDO)
    ok('undo: refuses while a bulletin row is kept', r.startswith('STOPPED') and 'bulletin row' in r, r)
    ok('undo: and the tables and rows are there (only PART 1 ran)', applied(d) and {k: v for k, v in sums(d).items()} == rows
       and differences(held, catalog(d.c))[0] and all('bulletin' in l for l in differences(held, catalog(d.c))[0]))
    d.file(FILE)
    delete(w, bid)
    r = d.file(UNDO); ok('undo: refuses while a queued page is not yet gone', r.startswith('STOPPED') and 'queued' in r, r)
    d.file(FILE)
    d.run("update submission_file_removal set done = true, removed_at = now() where bucket = :b", b=BUCKET)
    r = d.file(UNDO); ok('undo: refuses while the bucket holds a file', r.startswith('STOPPED') and 'still holds' in r, r)
    d.file(FILE)
    d.run('delete from storage.objects where bucket_id = :b', b=BUCKET)
    d.run("create temp table kept as select pg_get_functiondef(to_regprocedure('public.list_bulletins(uuid)')) as def")
    d.run("do $$ begin execute replace((select def from kept), 'begin', 'begin -- changed later'); end $$")
    r = d.file(UNDO)
    ok('undo: a function changed since stops the removal', r.startswith('STOPPED') and 'is not as it left it' in r and applied(d), r)
    d.run("do $$ begin execute (select def from kept); end $$"); d.run('drop table kept')
    r = d.file(UNDO); ok('undo: once nothing is kept, the full removal runs', r == 'ok' and not applied(d), r)
    gone, came = differences(base, catalog(d.c))
    ok('undo: after use, the catalog is as before', (gone, came) == ([], []), (gone, came))
    d.close()

# ── m2: the student side's functions present ───────────────────────────────────────────────────────────
STAND_IN = """create function student_submit.bulletins(p_session_token text, p_enrollment_id uuid, p_ip_hash text) returns jsonb
               language plpgsql security definer set search_path to 'public', 'student_submit', 'pg_temp'
               as $$ begin return jsonb_build_object('n', (select count(*) from public.bulletin)); end $$"""
def way_back():
    return [l[4:] for l in text_of(UNDO).splitlines() if l.startswith('--   grant execute')]

def scen_m2():
    """M2 (functions in student_submit that read the bulletin tables) changes nothing for M1, in each order."""
    w = world('m2'); d = w.d
    d.run(STAND_IN); d.run('grant execute on function student_submit.bulletins(text, uuid, text) to service_role')
    withm2 = catalog(d.c)
    r = d.file(FILE); ok('m2: with M2 present, M1 runs again cleanly', r == 'ok', r)
    ok('m2: and that second run changes nothing', catalog(d.c) == withm2, differences(withm2, catalog(d.c)))
    set_search_path(d); r = d.statements(split(text_of(POST)))
    ok('m2: the post-check says ok on every row', r == 'ok' and all(x[1] == 'ok' for x in d.rows), [x for x in d.rows if x[1] != 'ok'] or r)
    r = d.statements(split(part1())); ok('m2: undo PART 1 runs', r == 'ok', r)
    ok('m2: the undo header gives the seven grants back', len(way_back()) == 7, way_back())
    r = d.statements(way_back()); ok('m2: the seven grants run', r == 'ok', r)
    ok('m2: and give back exactly what PART 1 took', same(catalog(d.c), withm2), differences(norm(withm2), norm(catalog(d.c))))
    post(w, {'kind': 'announcement', 'body': 'x'})
    ok('m2: (setup) the stand-in reads the table', obj(d.service('student_submit.bulletins(null, null, null)'))['n'] == 1)
    d.run('delete from bulletin')
    before = catalog(d.c)
    r = d.file(UNDO)
    ok('m2: the full undo refuses while M2 uses the tables, and says to undo M2 first', r.startswith('STOPPED') and 'undo that file (M2' in r, r)
    ok('m2: and the tables are there (only PART 1 ran)', applied(d))
    d.statements(way_back())
    ok('m2: the grants put back, the catalog is as before', same(catalog(d.c), before), differences(norm(before), norm(catalog(d.c))))
    d.run('drop function student_submit.bulletins(text, uuid, text)')
    r = d.file(UNDO); ok('m2: once M2 is undone, the full undo runs', r == 'ok' and not applied(d), r)
    d.close()

# ── locks: a delete taking the class's lock first; the drop and a finish at once ─────────────────────────
def scen_locks():
    """E: each function that finds the row and then takes the lock gives the right refusal when a delete held
    the lock first. F: an expired upload dropped while another file finishes, 20 of 20 with no deadlock."""
    w = world('locks'); d = w.d
    def arranged(make, call, want, rounds=5):
        good = 0
        for _ in range(rounds):
            bid, fid = make()
            out = {}
            gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(:c))", c=w.c)
            def go():
                c = Conn(d); c.as_teacher()
                try: out['r'] = obj(c.run(call, b=bid, f=fid)[0][0])
                except Exception as e: out['r'] = 'ERROR ' + sqlstate(e)
                c.close()
            t = threading.Thread(target=go); t.start(); time.sleep(0.4)
            gate.run('delete from bulletin where id = :b', b=bid); gate.run('commit'); gate.close(); t.join()
            good += want(out.get('r'))
        return good
    def make_visible():
        b = post(w, {'kind': 'announcement', 'body': 'x'})['bulletin']; return b['id'], nid()
    def make_file():
        b = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}])['bulletin']
        put_page(d, b['files'][0]['paths'][0]); return b['id'], b['files'][0]['id']
    p2 = lambda r: r == 'ERROR P0002'
    for name, make, call, want in [
            ('show again', make_visible, 'select show_bulletin_again(:b, null) where :f::uuid is not null', p2),
            ('edit', make_visible, "select edit_bulletin(:b, '{\"body\": \"y\"}'::jsonb, null) where :f::uuid is not null", p2),
            ('delete', make_visible, 'select delete_bulletin(:b, null) where :f::uuid is not null', p2),
            ('finish', make_file, 'select finish_bulletin_file(:f, null) where :b::uuid is not null', lambda r: isinstance(r, dict) and r.get('status') == 'gone')]:
        n = arranged(make, call, want)
        ok('locks: %s after a delete that took the class\'s lock first gives the right refusal, 5 of 5' % name, n == 5, n)
    bid = post(w, {'kind': 'announcement', 'body': 'x'})['bulletin']['id']; delete(w, bid)
    ok('locks: the seen list of a bulletin just deleted is P0002', code(err(d, lambda: seen_list(w, bid))) == 'P0002')
    # F: an expired upload dropped by a list while another bulletin's file finishes, both queued on the class's lock.
    good = 0
    for _ in range(20):
        old = post(w, {'kind': 'announcement', 'body': 'old'}, [{'kind': 'photo', 'pages': 1}])['bulletin']['id']
        d.run("update bulletin set created_at = now() - interval '3 hours' where id = :b", b=old)
        d.run("update bulletin_file set created_at = now() - interval '3 hours' where bulletin_id = :b", b=old)
        b = post(w, {'kind': 'announcement', 'body': 'new'}, [{'kind': 'photo', 'pages': 1}])['bulletin']
        put_page(d, b['files'][0]['paths'][0])
        out = {}
        gate = Conn(d); gate.run('begin'); gate.run("select pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(:c))", c=w.c)
        def call(name, sql, **kw):
            c = Conn(d); c.as_teacher()
            try: out[name] = obj(c.run(sql, **kw)[0][0])
            except Exception as e: out[name] = 'ERROR ' + sqlstate(e)
            c.close()
        ts = [threading.Thread(target=call, args=('finish', 'select finish_bulletin_file(:f, null)'), kwargs={'f': b['files'][0]['id']}),
              threading.Thread(target=call, args=('list', 'select list_bulletins(:c)'), kwargs={'c': w.c})]
        [t.start() for t in ts]; time.sleep(0.3); gate.run('commit'); gate.close(); [t.join() for t in ts]
        good += (isinstance(out.get('finish'), dict) and out['finish']['bulletin']['visible'] is True and isinstance(out.get('list'), dict)
                 and d.one('select count(*) from bulletin where id = :b', b=old) == 0)
    ok('locks: an expired upload dropped while another file finishes: 20 of 20, no deadlock', good == 20, good)
    d.close()

# ── lastcheck: a failure at the last check leaves nothing behind ───────────────────────────────────────
def scen_lastcheck():
    """G: the last check confirms the storage helpers' grant; any failure there leaves nothing, the bucket row included."""
    w = world('lastcheck', with_file=False); d = w.d
    base = catalog(d.c); rows0 = sums(d)
    text = text_of(FILE)
    broken = text.replace("     or _p::text ~ '^fv_private\\.bulletin_file_(upload|read)_allowed\\(' then", "     or _p::text ~ '^fv_private\\.bulletin_file_upload_allowed\\(' then")
    ok('lastcheck: (setup) the grant of the read helper is taken out of the copy', broken != text)
    r = d.statements(split(broken))
    ok('lastcheck: without the read helper\'s grant the last check stops the file', r.startswith('STOPPED') and 'did not come out as written' in r, r)
    ok('lastcheck: and nothing is left: the catalog as before', catalog(d.c) == base, differences(base, catalog(d.c)))
    ok('lastcheck: and every row as before, the bucket row included', sums(d) == rows0 and d.one("select count(*) from storage.buckets where id = :b", b=BUCKET) == 0)
    r = d.file(FILE); ok('lastcheck: the file itself then applies', r == 'ok', r)
    ok('lastcheck: and the teacher may run both storage helpers', all(d.one("select has_function_privilege('authenticated', :s, 'execute')", s=s)
       for s in ('fv_private.bulletin_file_read_allowed(text)', 'fv_private.bulletin_file_upload_allowed(text)')))
    d.close()

# ── spentkey: an expired upload, then the same key again ───────────────────────────────────────────────
def scen_spentkey():
    """J: after an upload is dropped the key is spent: the same key answers the stored first reply (the dead id), a new key posts."""
    w = world('spentkey'); d = w.d
    key = nid()
    first = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}], key=key)
    bid, fid = first['bulletin']['id'], first['bulletin']['files'][0]['id']
    d.run("update bulletin set created_at = now() - interval '3 hours' where id = :b", b=bid)
    d.run("update bulletin_file set created_at = now() - interval '3 hours' where bulletin_id = :b", b=bid)
    ok('spentkey: finishing the expired file answers gone', finish_(w, fid) == {'file_id': fid, 'status': 'gone'})
    ok('spentkey: the bulletin is dropped', d.one('select count(*) from bulletin where id = :b', b=bid) == 0)
    again_ = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}], key=key)
    ok('spentkey: the same key answers the stored first reply: the dead id, not visible', again_ == first and again_['bulletin']['visible'] is False, again_)
    ok('spentkey: and makes nothing', d.one('select count(*) from bulletin') == 0)
    fresh = post(w, {'kind': 'announcement', 'body': 'x'}, [{'kind': 'photo', 'pages': 1}], key=nid())
    ok('spentkey: a new key posts', fresh['bulletin']['id'] != bid and d.one('select count(*) from bulletin') == 1)
    d.close()

# ── collations: live sorts text by ICU en-US; the file's fingerprints must not care ───────────────────────
C_TEMPLATE = os.environ.get('B1A_C_TEMPLATE', '')
def file_fps():
    t = text_of(FILE)
    return {tag: re.findall(r"is distinct from '([0-9a-f]{32})' (?:then )?-- fp:%s" % tag, t) for tag in ('own', 'tables', 'policies')}

def scen_collations():
    """The template (PGDATABASE) mirrors live: ICU en-US. B1A_C_TEMPLATE is a C database rebuilt from the repo. The file
    applies, runs again, passes its post-check, undoes and applies again on both, and every fingerprint is the same on both."""
    loc = connect(); info = loc.run('select datlocprovider, datlocale, datcollate, datctype from pg_database where datname = current_database()')[0]; loc.close()
    ok('collations: the main template mirrors live (ICU, en-US, en_US.UTF-8)', list(info) == ['i', 'en-US', 'en_US.UTF-8', 'en_US.UTF-8'], info)
    ok('collations: a C template is given (B1A_C_TEMPLATE)', bool(C_TEMPLATE), C_TEMPLATE)
    if not C_TEMPLATE: return
    seen = {}
    for name, tpl in (('icu', None), ('c', C_TEMPLATE)):
        d = Db('b1a_coll_' + name, template=tpl)
        try:
            if applied(d): d.file(UNDO)
            d.run('alter table cron.job add column if not exists database text, add column if not exists username text, add column if not exists active boolean')
            prov = d.one('select datlocprovider from pg_database where datname = current_database()')
            ok('collations %s: (setup) the copy has the template\'s provider (%s)' % (name, prov), prov == ('i' if name == 'icu' else 'c'))
            set_search_path(d)
            sigs = [r[0] for r in d.all("select p.oid::regprocedure::text from pg_proc p where p.proname in ('bulletin_file_path', 'bulletin_file_path_parts')")]
            base = catalog(d.c); rows0 = sums(d)
            r = d.file(FILE); ok('collations %s: the file applies' % name, r == 'ok', r)
            set_search_path(d)
            got = {'own': d.one(OWN_SQL), 'tables': d.one(TABLES_SQL), 'policies': d.one(POLICIES_SQL)}
            seen[name] = got
            ok('collations %s: its fingerprints are the ones the file carries' % name, all(file_fps()[k] and set(file_fps()[k]) == {v} for k, v in got.items()), (got, file_fps()))
            two = d.all("select x from unnest(array['fv_private.bulletin_file_path(uuid,uuid,integer)', 'fv_private.bulletin_file_path_parts(text)']) x order by x")
            if name == 'icu':
                ok('collations icu: the server\'s own text order differs from C here (what stopped the file on live)',
                   [t[0] for t in two] == ['fv_private.bulletin_file_path_parts(text)', 'fv_private.bulletin_file_path(uuid,uuid,integer)'], two)
            after = catalog(d.c)
            r = d.file(FILE); ok('collations %s: a second run is ok and changes nothing' % name, r == 'ok' and catalog(d.c) == after, r)
            set_search_path(d); r = d.statements(split(text_of(POST)))
            ok('collations %s: the post-check says ok on every row' % name, r == 'ok' and len(d.rows) > 20 and all(x[1] == 'ok' for x in d.rows),
               [x for x in d.rows if x[1] != 'ok'] or r)
            set_search_path(d); r = d.statements(split(text_of(PRE)))
            ok('collations %s: the pre-check runs' % name, r == 'ok', r)
            r = d.file(UNDO); ok('collations %s: the full undo runs' % name, r == 'ok', r)
            ok('collations %s: and leaves the catalog and every row as before' % name, catalog(d.c) == base and sums(d) == rows0, differences(base, catalog(d.c)))
            r = d.file(FILE); ok('collations %s: the file applies again' % name, r == 'ok' and same(catalog(d.c), after), differences(norm(after), norm(catalog(d.c))))
        finally:
            d.close()
    ok('collations: every fingerprint is identical under ICU en-US and C', seen.get('icu') == seen.get('c') and len(seen) == 2, seen)

SCENARIOS_MORE = {'collations': scen_collations, 'm2': scen_m2, 'locks': scen_locks, 'lastcheck': scen_lastcheck, 'spentkey': scen_spentkey}

SCENARIOS = {'post': scen_post, 'edit': scen_edit, 'delete': scen_delete, 'counts': scen_counts, 'others': scen_others,
             'storage': scen_storage, 'cascade': scen_cascade, 'limits': scen_limits, 'race': scen_race, 'defaults': scen_defaults,
             'missing': scen_missing, 'apply': scen_apply, 'undo': scen_undo}
SCENARIOS.update(SCENARIOS_MORE)
if __name__ == '__main__':
    if sys.argv[1:] == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (sys.argv[1:] or SCENARIOS):
        SCENARIOS[name]()
    finish()
