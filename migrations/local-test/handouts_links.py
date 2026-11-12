"""Handouts and Links: migrations/2026111170_handouts_links.sql, applied after
everything through 2026111160_slips_keyed.sql (all on live since 2026-11-11),
with Supabase's storage tables, pg_cron, pg_net and Vault stood in for.

    PGDATABASE=hl python3 batch_c_common.py build       an EMPTY database: live with Batch B and the fixes
    PGDATABASE=hl python3 handouts_links.py             every scenario below
    PGDATABASE=hl python3 handouts_links.py race ...    or some
    PGDATABASE=hl python3 handouts_links.py fingerprints [check]   write (or check) the lists the four files carry
    PGDATABASE=hl python3 handouts_links.py mutate [n ...]          wrong versions of the file: are they noticed?

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  teacher    Add a Link, Add a PDF (start, upload, finish), Remove, the list: what each answers, what
             each refuses, a request sent twice, another teacher, nobody signed in, the table itself
  storage    the policies: which exact names a teacher may write and when, who may read, that nothing
             may be changed or deleted, that Batch B's rules for students' photos still hold, and that
             the two restricting policies still hold when a careless policy is added
  student    page's resources (ready only, in order, only on pieces the page shows); page is otherwise
             the same answer as before the file; handout_links and everything it refuses
  lifecycle  Keep Photos Until leaves a handout alone; the nightly check does not report or queue a
             handout's pages, queues a handout page with no row, and drops an upload never finished.
             The checks marked differs are run again on the database without the file and must fail there.
  deletes    removing a handout, deleting its assessment, the 30-day purge of its class, of its
             teacher, clear_data (stand-in) and TRUNCATE each queue every page; the worker deletes them
  race       start, finish, remove and delete_assessment at the same time, on connections of their own
  apply      every guard; a database in use; what changes and what does not; a second run; grants;
             the read-only pre-check and post-check and what each notices
  undo       handouts-links-undo.sql: PART 1 stops adding; PART 2 refuses while rows are held, then
             puts the catalog and every row back exactly
"""
import datetime, json, os, re, sys, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from submissions_common import WorkDb, Side, attempt, seed_work, Storage, StorageError
from batch_c_common import *
import batch_c_common as bc
import card_codes_common as cc
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111170_handouts_links.sql'
FILE_USED = os.environ.get('HANDOUTS_LINKS_FILE') or FILE
UNDO = 'handouts-links-undo.sql'
PRE = 'handouts-links-live-precheck.sql'
POST = 'handouts-links-live-postcheck.sql'
LIST_FILES = [FILE, UNDO, PRE, POST]
BEFORE = [C1, C2, '../2026111130_student_send_rules.sql', 'photo-lifecycle-stand-in.sql', '../2026111140_photo_lifecycle.sql',
          '../2026111150_student_page_last_changes.sql', '../2026111160_slips_keyed.sql']

NEW = ['public._handout_path(uuid,uuid,integer)', 'fv_private.handout_path_parts(text)', 'public._assessment_resource_json(uuid)',
       'public._assessment_resource_same_class()', 'public._assessment_resource_removed()', 'public._assessment_resource_gone()',
       'public._assessment_resource_truncated()', 'public._handout_drop_expired(uuid)',
       'fv_private.handout_upload_allowed(text)', 'fv_private.handout_read_allowed(text)',
       'public.add_assessment_link(uuid,text,text,uuid)', 'public.start_handout_upload(uuid,text,integer,uuid)',
       'public.finish_handout_upload(uuid,uuid)', 'public.remove_assessment_resource(uuid,uuid)',
       'public.list_course_resources(uuid)', 'student_submit.handout_links(text,uuid,uuid,text)']
TEACHER_RPCS = NEW[10:15]
REPLACED = ['student_submit.page(text,uuid,text)', 'public._photo_strays(uuid,timestamp with time zone)']
# What the new functions call, what the fence calls, and the photo lifecycle's own pieces that must
# stay as tested for "it leaves a handout alone" to mean anything.
RELIED = ['public.fv_owns_assessment(uuid)', 'public.fv_owns_course(uuid)', 'public.fv_idem_check(uuid,text)',
          'public.fv_idem_store(uuid,text,jsonb)', 'public._grade_return_lock(uuid)', 'public._grade_return_lock_first(uuid)',
          'public._fv_timezone(text)', 'public._work_bucket()', 'public._work_object(text)', 'public._work_hold()',
          'public._work_max_bytes()', 'fv_private.work_path_course(text)', 'fv_private.work_read_allowed(text)',
          'fv_private.work_upload_allowed(text)', 'student_submit._session_class(text,uuid)',
          'student_submit._session_classes(uuid)', 'student_submit._returned_grade(uuid,uuid)',
          'student_submit.removal_batch(integer)', 'student_submit.removal_done(bigint[])',
          'public._submission_file_removed()', 'public._submission_gone()', 'public._photo_log(uuid,text,integer,jsonb)',
          'public._photo_keep_class(uuid,timestamp with time zone)', 'public._photo_missing(uuid)', 'public._photo_stuck()',
          'public.photo_removal_due()', 'public.photo_lifecycle_nightly()', 'public.delete_assessment(uuid)',
          'public.fv_retention_cleanup()']
# md5(pg_get_functiondef) of each, read from gradebook-prod on 2026-11-11 (read-only, PostgreSQL 17.6).
# The harness must build the same definitions, or what it proves is not about live.
LIVE = {
    'public.fv_owns_assessment(uuid)': '9f4c680c35f9f3ac32e8290824707673', 'public.fv_owns_course(uuid)': 'e3afeca06043a6e907e6f4ae777c85da',
    'public.fv_idem_check(uuid,text)': '1c7b546434bee4b774557e0e6b16024f', 'public.fv_idem_store(uuid,text,jsonb)': '6d0b48c458d273a332db39e1a4b68626',
    'public._grade_return_lock(uuid)': '530dca441198b1546a4ec4967cd83b9f', 'public._grade_return_lock_first(uuid)': '4d85813e08aaeb108cda95d85f3d66e4',
    'public._fv_timezone(text)': '8dbcb5716f155e2441f47416a0b28527', 'public._work_bucket()': '3f13f4e2c303b5a53caea4925abc8350',
    'public._work_object(text)': '1c78c7884df1e02c326b06989da25c5c', 'public._work_hold()': 'e0479f5f0ab703fd3cd77f677ec34eb2',
    'public._work_max_bytes()': '1384cb1ea953d11cea982d60d87e5421', 'fv_private.work_path_course(text)': '7fb0272243ceef1cb6b42658d27664e3',
    'fv_private.work_read_allowed(text)': '3ea2b37a835c7a86a881ed743b95d1c9', 'fv_private.work_upload_allowed(text)': 'b53e85108b1e870a16e717055c63f2dc',
    'student_submit._session_class(text,uuid)': '1ae94981ff32f804d12079a24bd7b41a', 'student_submit._session_classes(uuid)': '722d403571069e3e97516f432ed9de5c',
    'student_submit._returned_grade(uuid,uuid)': '21706ae9eec783107d9da24e52e1855a', 'student_submit.removal_batch(integer)': '964eef99a747dc7180d4ad61bd19b1db',
    'student_submit.removal_done(bigint[])': 'de793c82a2b5aa59052994a82e80d166', 'public._submission_file_removed()': 'edc99e4c04baefcf83b9ce3c94723023',
    'public._submission_gone()': '606be06c71d963805c12f23208b5c304', 'public._photo_log(uuid,text,integer,jsonb)': '53859922b32f0e4f2da95052edc130e2',
    'public._photo_keep_class(uuid,timestamp with time zone)': 'fb78dde9520f84f0f58faa1bebf98c23', 'public._photo_missing(uuid)': 'd099b00a7d1a2997ee287dfdbb528c43',
    'public._photo_stuck()': '8f35709beffa04b59f36840e2d4e2fa0', 'public.photo_removal_due()': '3faf3499da0753407687386407c8b01f',
    'public.photo_lifecycle_nightly()': '7e3dc52c80eb21f50848d67011385a26', 'public.delete_assessment(uuid)': 'b0557c759c662175194a75bff27c7001', 'public.fv_retention_cleanup()': 'a8da46d6664ba5956f4215ba3b2ada39',
    'student_submit.page(text,uuid,text)': '2f1795ba4c5416788d477a540b49fccb',
    'public._photo_strays(uuid,timestamp with time zone)': '21db626094c7be734d536357c91826c8'}

ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
# The edge function's layout check today (supabase/functions/_shared/storage-rest.ts, PATH): what its worker deletes.
EDGE_PATH = re.compile('^(%s)/(%s)/(%s)/(%s)/(%s)(-thumb)?\\.jpg$' % ((ID,) * 5))
HANDOUT = re.compile('^(%s)/handouts/(%s)/([1-9][0-9]?)\\.jpg$' % (ID, ID))

# ── the lists: written by script, never by hand ─────────────────────────────
LISTS = re.compile(r'(-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def neutral(text):
    """The text with every list stood aside, so it applies whatever the lists hold."""
    return LISTS.sub(lambda m: m.group(1) + ("            ('public.no_such_function_at_all()', 'absent', 'absent')" if m.group(2) == 'replaces'
                                             else "            ('public.no_such_function_at_all()', 'absent')") + m.group(4), text)
def write_lists(text, lists):
    def row(m):
        items = lists.get(m.group(2))
        if items is None: return m.group(0)
        indent = re.match(r'[ \t]*', m.group(3)).group(0) or '            '
        w = max(len(x[0]) for x in items) + 3
        body = ',\n'.join("%s(%s %s)" % (indent, ("'%s'," % x[0]).ljust(w), ', '.join("'%s'" % h for h in x[1:])) for x in items)
        return m.group(1) + body + m.group(4)
    return LISTS.sub(row, text)
def lists_of(text):
    return {m.group(2): re.findall(r"\('([^']+)',\s*'(\w+)'(?:,\s*'(\w+)')?\)", m.group(3)) for m in LISTS.finditer(text)}
def fps(d, fns): return {f: d.one('select md5(pg_get_functiondef(to_regprocedure(:f)))', f=f) for f in fns}

MUTATED = FILE_USED != FILE
def file_text():
    """The file under test. A wrong version (mutate) is applied with its lists stood aside."""
    return neutral(text_at(FILE_USED)) if MUTATED else text_at(FILE_USED)

# ── the template: live as the file meets it, and with the file ──────────────
_TPL = {}
def template(with_file=True):
    key = bool(with_file)
    if key in _TPL: return _TPL[key]
    name = '%s_hl%s%d' % (cc.BASE_DB, 'm' if MUTATED else '', int(key))
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in BEFORE + ([FILE_USED] if key else []):
        for st in split(file_text() if rel == FILE_USED else text_at(rel)):
            try: c.run(st)
            except Exception as e:
                c.close(); ok('%s applies to the template' % os.path.basename(rel), False, message(e)); finish()
    c.close(); _TPL[key] = name
    return name
def drop_templates():
    for name in _TPL.values(): admin('drop database if exists "%s" with (force)' % name)

MODE = {'fixed': True}
def check(name, good, detail='', differs=False):
    """A check. On the base (MODE fixed false) a check marked differs must FAIL, and every other must hold."""
    if MODE['fixed']: ok(name, good, detail)
    elif differs: ok('[without the file this fails] ' + name, not good, 'it held without the file')
    else: ok('[without the file] ' + name, good, detail)

# ── a scenario's copy, with the browser's and the phone's calls ─────────────
class HDb(WorkDb):
    def link(self, a, url, title=None, uid=A, key=None):
        return self.rpc('add_assessment_link(:a, :u, :t, :k)', uid, a=a, u=url, t=title, k=key or nid())
    def start(self, a, title='Lab Sheet.pdf', pages=3, uid=A, key=None):
        return self.rpc('start_handout_upload(:a, :t, :n, :k)', uid, a=a, t=title, n=pages, k=key or nid())
    def finish(self, r, uid=A, key=None):
        return self.rpc('finish_handout_upload(:r, :k)', uid, r=r, k=key or nid())
    def remove(self, r, uid=A, key=None):
        return self.rpc('remove_assessment_resource(:r, :k)', uid, r=r, k=key or nid())
    def listed(self, course=COURSE_A, uid=A): return self.rpc('list_course_resources(:c)', uid, c=course)
    def put_pages(self, paths, uid=A, **kw):
        """The browser uploading pages signed in: the storage policies decide."""
        for p in paths: self.storage.put_as('authenticated', uid, p, **kw)
    def handout(self, a, pages=3, title='Lab Sheet.pdf', uid=A):
        """A whole Add a PDF: start, upload every page, finish. (the start's reply, the finish's reply)."""
        s = self.start(a, title, pages, uid); self.put_pages(s['paths'], uid)
        return s, self.finish(s['id'], uid)
    def links(self, token, e, r): return self.service("student_submit.handout_links(:t, :e, :r, 'ip-1')", t=token, e=e, r=r)
    def resources(self, token, e, a):
        p = self.page(token, e)
        return next((x.get('resources') for x in p.get('assessments', []) if x['id'] == a), None)

class HSide(HDb, Side):
    def __init__(self, d): Side.__init__(self, d)

def world(tag, fixed=True):
    d = HDb('hl_' + tag, template=template(fixed)); k = seed_work(d)
    t1, _ = d.session(ENR1); t2, _ = d.session(ENR2, birthday='2012-06-16')
    return d, k, t1, t2

def rows(d, where='true', **kw): return d.all('select id::text, kind, status, position from assessment_resource where %s order by assessment_id, position' % where, **kw)
def count(d, where='true', **kw): return d.one('select count(*) from assessment_resource where ' + where, **kw)
def queued(d, reason=None):
    return sorted(r[0] for r in d.all('select path from submission_file_removal where not done' + (' and reason = :r' if reason else ''), **({'r': reason} if reason else {})))
def stored(d): return d.storage.names()
def drain(d):
    """The removal worker until the queue has nothing due."""
    for _ in range(20):
        b, done = d.drain(1000)
        if not b['items']: break
def err(d, fn):
    r = refused(d, fn); return r[1] if r else None
def has_file(d): return d.one("select to_regclass('public.assessment_resource') is not null")
def hpath(course, rid, n): return '%s/handouts/%s/%d.jpg' % (course, rid, n)
def plant(d, path, hours):
    """A file put in the bucket by the Storage service, that many hours ago."""
    d.storage.put_signed(d.storage.sign_upload(path))
    d.run("update storage.objects set created_at = now() - make_interval(hours => :h) where bucket_id = :b and name = :n", h=hours, b=BUCKET, n=path)
def age(d, rid, hours):
    d.run('update assessment_resource set created_at = created_at - make_interval(hours => :h) where id = :r', h=hours, r=rid)
def logged(d, kind): return d.all('select course_id::text, n, detail from photo_check_log where kind = :k order by id', k=kind)

SCENARIOS = {}
def scenario(name):
    def deco(f): SCENARIOS[name] = f; return f
    return deco

# ── teacher ─────────────────────────────────────────────────────────────────
@scenario('teacher')
def scen_teacher():
    d, k, t1, t2 = world('teacher'); a = k['takes']; a2 = k['nothing']; b = k['b_takes']
    try:
        l1 = d.link(a, 'https://www.youtube.com/watch?v=abc123', 'Mitosis Video')
        ok('Add a Link answers the row: a link, ready, first in its assessment',
           l1['kind'] == 'link' and l1['status'] == 'ready' and l1['position'] == 1 and l1['assessment_id'] == a
           and l1['title'] == 'Mitosis Video' and l1['url'] == 'https://www.youtube.com/watch?v=abc123'
           and l1['page_count'] is None and 'paths' not in l1, l1)
        l2 = d.link(a, '  https://www.britannica.com/science/cell-biology  ', '   ')
        ok("with no name, students see the site's address", l2['title'] == 'www.britannica.com' and l2['position'] == 2
           and l2['url'] == 'https://www.britannica.com/science/cell-biology', l2)
        ok('...and a sign-in part of an address is not shown', d.link(a2, 'http://user:pw@example.org:8080/x?y#z')['title'] == 'example.org:8080')
        ok('HTTPS in capitals is taken as typed', d.link(a2, 'HTTPS://Example.org')['url'] == 'HTTPS://Example.org')
        for label, url in [('no address', None), ('an empty one', '  '), ('ftp', 'ftp://example.org/a'), ('javascript', 'javascript:alert(1)'),
                           ('no scheme', 'www.example.org'), ('a space inside', 'https://example.org/a b'), ('no host', 'https:///a'),
                           ('a line break', 'https://example.org/\nhttps://x'), ('over 2000 characters', 'https://example.org/' + 'a' * 1990)]:
            ok('a link is refused: %s' % label, err(d, lambda: d.link(a, url)) == '22023')
        ok('a name over 200 characters is refused', err(d, lambda: d.link(a, 'https://example.org', 'n' * 201)) == '22023')
        ok('a name of 200 is taken', len(d.link(a2, 'https://example.org', 'n' * 200)['title']) == 200)
        n0 = count(d)
        ok('none of the refused calls left a row', n0 == 5, n0)

        # Add a PDF
        key = nid(); s = d.start(a, 'Cell Lab.pdf', 3, key=key)
        ok('start answers the row, uploading, with its three paths, the bucket and a finish-by two hours on',
           s['kind'] == 'pdf' and s['status'] == 'uploading' and s['page_count'] == 3 and s['position'] == 3 and s['url'] is None
           and s['paths'] == [hpath(COURSE_A, s['id'], n) for n in (1, 2, 3)] and s['bucket'] == BUCKET and s.get('finish_by'), s)
        ok('every path is <class>/handouts/<resource>/<n>.jpg', all(HANDOUT.match(p) for p in s['paths']))
        ok('the same request again is answered the same, and makes nothing', d.start(a, 'Cell Lab.pdf', 3, key=key) == s and count(d) == 6)
        ok('with no name a handout is called Handout', d.start(a2, '  ', 1)['title'] == 'Handout')
        for label, n in [('no pages', 0), ('21 pages', 21), ('no count', None), ('a negative count', -1)]:
            ok('start is refused: %s' % label, err(d, lambda: d.start(a, 'x.pdf', n)) == '22023')
        ok('20 pages are taken (ruling 18)', len(d.start(a2, 'Long.pdf', 20)['paths']) == 20)
        f0 = d.finish(s['id'])
        ok('finish with nothing uploaded: still uploading, every page missing', f0['status'] == 'uploading' and f0['missing'] == [1, 2, 3] and 'bad' not in f0, f0)
        d.put_pages(s['paths'][:2])
        k2 = nid(); f1 = d.finish(s['id'], key=k2)
        ok('finish with page 3 not up: still uploading, missing [3]', f1['status'] == 'uploading' and f1['missing'] == [3], f1)
        ok('a handout not finished is not ready in the list', [x['status'] for x in d.listed() if x['id'] == s['id']] == ['uploading'])
        d.put_pages(s['paths'][2:])
        f2 = d.finish(s['id'], key=k2)
        ok('the same finish request, once the page is up, looks again and answers ready (a miss is not remembered)',
           f2['status'] == 'ready' and 'missing' not in f2 and 'finish_by' not in f2 and f2['paths'] == s['paths'], f2)
        ok('...and again: the same answer', d.finish(s['id'], key=k2) == f2)
        ok('finish on a ready handout with a new key: ready, nothing changes', d.finish(s['id'])['status'] == 'ready')
        ok('finish on a link: gone', d.finish(l1['id']) == {'id': l1['id'], 'status': 'gone'})
        ok('finish on nothing: gone', d.finish(nid()).get('status') == 'gone')
        # a file that is not a JPEG of the bucket's size (the Storage service refuses these; if one ever landed)
        s3 = d.start(a2, 'Odd.pdf', 2)
        d.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', 5::bigint, 'mimetype', 'image/png'))", b=BUCKET, n=s3['paths'][0])
        f3 = d.finish(s3['id'])
        ok('a page that is there but is not a JPEG is named apart, and the handout is not ready',
           f3['status'] == 'uploading' and f3['bad'] == [1] and f3['missing'] == [2], f3)

        # the list
        ls = d.listed()
        ok('the list: every row of the class, each assessment in the order added',
           [(x['assessment_id'], x['position']) for x in ls] == sorted((x['assessment_id'], x['position']) for x in ls)
           and len(ls) == count(d, 'course_id = :c', c=COURSE_A) and {x['id'] for x in ls} >= {l1['id'], l2['id'], s['id']}, ls)
        ok('...a handout carries its paths, a link none', all(('paths' in x) == (x['kind'] == 'pdf') for x in ls))
        ok("...and none of another teacher's", d.listed(COURSE_B, B) == [])

        # another teacher, nobody, the table itself
        ok("another teacher cannot add a link to it", err(d, lambda: d.link(a, 'https://example.org', uid=B)) == 'P0002')
        ok('...nor start a handout', err(d, lambda: d.start(a, 'x.pdf', 1, uid=B)) == 'P0002')
        ok('...nor finish one (gone, as if it were not there)', d.finish(s3['id'], uid=B).get('status') == 'gone')
        ok('...nor remove one', d.remove(s['id'], uid=B) == {'removed': False} and count(d, 'id = :r', r=s['id']) == 1)
        ok("...nor list the class", err(d, lambda: d.listed(COURSE_A, B)) == 'P0002')
        ok('an assessment that is not there', err(d, lambda: d.link(nid(), 'https://example.org')) == 'P0002')
        for f in TEACHER_RPCS:
            args = ', '.join('null' for _ in f.split('(')[1].rstrip(')').split(','))
            name = f.split('(')[0]
            ok('%s: signed in as nobody, PT401' % name, err(d, lambda: d.teacher('%s(%s)' % (name, args), uid='')) == 'PT401')
            ok('%s: the anonymous role may not run it' % name, err(d, lambda: d.role('anon', 'select %s(%s)' % (name, args))) == '42501')
            ok('%s: nor the service role' % name, err(d, lambda: d.role('service_role', 'select %s(%s)' % (name, args))) == '42501')
        ok('a teacher reads their own rows from the table', d.role('authenticated', 'select count(*) from assessment_resource', uid=A)[0][0] == count(d, 'course_id = :c', c=COURSE_A))
        ok("...and none of another teacher's", d.role('authenticated', 'select count(*) from assessment_resource', uid=B)[0][0] == 0)
        ok('the anonymous role cannot read the table', err(d, lambda: d.role('anon', 'select count(*) from assessment_resource')) == '42501')
        for label, sql in [('insert', "insert into assessment_resource (assessment_id, course_id, kind, title, url, status, position) values ('%s', '%s', 'link', 't', 'https://x.org', 'ready', 9)" % (a, COURSE_A)),
                           ('update', "update assessment_resource set title = 'x'"), ('delete', 'delete from assessment_resource')]:
            ok('a teacher cannot %s a row directly' % label, err(d, lambda: d.role('authenticated', sql, uid=A)) == '42501')
        ok('a row whose assessment is in another class is refused by the table itself',
           err(d, lambda: d.run("insert into assessment_resource (assessment_id, course_id, kind, title, url, status, position) values (:a, :c, 'link', 't', 'https://x.org', 'ready', 1)", a=b, c=COURSE_A)) == '23514')
        for label, vals in [('a link with pages', "'link', 't', 'https://x.org', 2, 'ready'"), ('a link not ready', "'link', 't', 'https://x.org', null, 'uploading'"),
                            ('a link with another scheme', "'link', 't', 'ftp://x.org', null, 'ready'"), ('a handout with an address', "'pdf', 't', 'https://x.org', 2, 'ready'"),
                            ('a handout of 21 pages', "'pdf', 't', null, 21, 'ready'"), ('a handout of no pages', "'pdf', 't', null, null, 'ready'"),
                            ('an empty name', "'pdf', '', null, 2, 'ready'"), ('another kind', "'video', 't', null, 2, 'ready'")]:
            ok('the table itself refuses %s' % label,
               err(d, lambda: d.run("insert into assessment_resource (assessment_id, course_id, kind, title, url, page_count, status, position) values (:a, :c, %s, 1)" % vals, a=a, c=COURSE_A)) == '23514')

        # Remove
        kr = nid(); r1 = d.remove(l2['id'], key=kr)
        ok('Remove a link: removed, nothing queued for storage', r1 == {'removed': True} and count(d, 'id = :r', r=l2['id']) == 0 and queued(d) == [])
        ok('the same request again: the same answer', d.remove(l2['id'], key=kr) == {'removed': True})
        ok('a second Remove with a new key: removed false, no error', d.remove(l2['id']) == {'removed': False})
        r2 = d.remove(s['id'])
        ok('Remove a handout: removed, its three pages queued for deletion (reason handout_removed)',
           r2 == {'removed': True} and queued(d, 'handout_removed') == sorted(s['paths']), queued(d))
        ok('the order of what is left does not change', [x['id'] for x in d.listed() if x['assessment_id'] == a][0] == l1['id'])
        nxt = d.link(a, 'https://example.org/next')
        ok('the next one added goes last', nxt['position'] == max(x['position'] for x in d.listed() if x['assessment_id'] == a))
        # 50 at most
        with tx(d):
            d.run("""insert into assessment_resource (assessment_id, course_id, kind, title, url, status, position)
                     select :a, :c, 'link', 'L' || n, 'https://example.org/' || n, 'ready', 100 + n from generate_series(1, 50) n""", a=k['takes'], c=COURSE_A)
            ok('an assessment that holds 50 takes no more links', err(d, lambda: d.link(a, 'https://example.org/51')) == '22023')
            ok('...and no more handouts', err(d, lambda: d.start(a, 'x.pdf', 1)) == '22023')
        # a class in the trash
        with tx(d):
            d.run('update course set deleted_at = now() where id = :c', c=COURSE_A)
            ok('a class in the trash takes nothing and lists nothing',
               err(d, lambda: d.link(a, 'https://example.org')) == 'P0002' and err(d, lambda: d.listed()) == 'P0002'
               and d.role('authenticated', 'select count(*) from assessment_resource', uid=A)[0][0] == 0)
        # two hours
        s5 = d.start(a, 'Late.pdf', 2); d.put_pages(s5['paths'][:1]); age(d, s5['id'], 3)
        ok('an upload past its two hours is left out of the list', s5['id'] not in [x['id'] for x in d.listed()])
        f5 = d.finish(s5['id'])
        ok('finishing it answers gone, and it is dropped: its row is deleted and its uploaded page queued (reason handout_expired)',
           f5 == {'id': s5['id'], 'status': 'gone'} and count(d, 'id = :r', r=s5['id']) == 0
           and set(queued(d, 'handout_expired')) == set(s5['paths']), (f5, queued(d)))
        s6 = d.start(a, 'Late2.pdf', 1); age(d, s6['id'], 3); d.link(a2, 'https://example.org/z')
        ok('...and so is one in the class when the next link is added', count(d, 'id = :r', r=s6['id']) == 0)
    finally:
        d.close()

# ── storage ─────────────────────────────────────────────────────────────────
@scenario('storage')
def scen_storage():
    d, k, t1, t2 = world('storage'); a = k['takes']; st = d.storage
    def put(uid, path, role='authenticated', **kw): return attempt(lambda: st.put_as(role, uid, path, **kw))
    try:
        s = d.start(a, 'Cell Lab.pdf', 2); p1, p2 = s['paths']
        sb = d.start(k['b_takes'], 'Theirs.pdf', 1, uid=B); pb = sb['paths'][0]
        ok('the teacher uploads page 1 of their uploading handout', put(A, p1) is None and p1 in stored(d), stored(d))
        ok('...and reads it back', st.can_read('authenticated', A, p1))
        ok('the same page a second time is refused (a name holds one file)', str(put(A, p1)).startswith('STORAGE 409'))
        for label, path in [('a page past its count', hpath(COURSE_A, s['id'], 3)), ('page 0', hpath(COURSE_A, s['id'], 0)),
                            ('a page number with a zero in front', '%s/handouts/%s/02.jpg' % (COURSE_A, s['id'])),
                            ('a thumbnail beside it', '%s/handouts/%s/2-thumb.jpg' % (COURSE_A, s['id'])),
                            ('another ending', '%s/handouts/%s/2.png' % (COURSE_A, s['id'])),
                            ('a folder deeper', '%s/handouts/%s/x/2.jpg' % (COURSE_A, s['id'])),
                            ("the handout's id under another class's folder", hpath(COURSE_B, s['id'], 2)),
                            ('a handout that does not exist', hpath(COURSE_A, nid(), 1)),
                            ('upper-case ids', hpath(COURSE_A, s['id'], 2).upper().replace('HANDOUTS', 'handouts').replace('.JPG', '.jpg')),
                            ("another teacher's handout", pb), ('any other name', COURSE_A + '/notes.jpg')]:
            ok('the teacher cannot upload %s' % label, str(put(A, path)).startswith('STORAGE 403'), put(A, path))
        ok("another teacher cannot upload this handout's page", str(put(B, p2)).startswith('STORAGE 403'))
        ok('...nor read the page that is up', not st.can_read('authenticated', B, p1))
        ok('nobody signed in can upload or read it', str(put('', p2)).startswith('STORAGE 403') and not st.can_read('authenticated', '', p1))
        ok('the anonymous role can upload and read nothing', str(put(None, p2, role='anon')).startswith('STORAGE 403') and not st.can_read('anon', None, p1))
        ok('the bucket still refuses a file over 2 MB and one that is not a JPEG',
           str(put(A, p2, size=2097153)).startswith('STORAGE 413') and str(put(A, p2, mime='application/pdf')).startswith('STORAGE 415'))
        ok('the teacher sees only their own files in the bucket', st.visible('authenticated', A) == [p1] and st.visible('authenticated', B) == [])
        ok('the teacher cannot change, move or delete the file',
           st.change_as('authenticated', A, "update storage.objects set name = name || 'x' where name = :n", n=p1) in (0, '42501')
           and st.change_as('authenticated', A, 'delete from storage.objects where name = :n', n=p1) in (0, '42501') and p1 in stored(d))
        # past the two hours
        with tx(d):
            age(d, s['id'], 3)
            ok('after two hours the teacher can no longer upload a page of it', str(put(A, p2)).startswith('STORAGE 403'))
        ok('page 2 goes up', put(A, p2) is None)
        ok('the handout is finished', d.finish(s['id'])['status'] == 'ready')
        p3 = hpath(COURSE_A, s['id'], 1)
        st.remove([p1])   # as the service role would: only to try the upload again
        ok('once it is ready, no page of it can be uploaded again', str(put(A, p1)).startswith('STORAGE 403'))
        st.put_signed(st.sign_upload(p1))
        ok('the teacher still reads the pages of a ready handout', st.can_read('authenticated', A, p1) and st.can_read('authenticated', A, p2))
        with tx(d):
            d.run('update course set deleted_at = now() where id = :c', c=COURSE_A)
            ok("with the class in the trash, its handout's pages cannot be read or uploaded", not st.can_read('authenticated', A, p1))
        d.remove(s['id'])
        ok('a removed handout cannot be read by its teacher (the file waits for the worker)', p1 in stored(d) and not st.can_read('authenticated', A, p1))

        # Batch B's rules still hold
        up, fin = d.teacher_upload(a, ENR1, 1)
        ok("the teacher's Add Work for a student still uploads and finishes (Batch B's policies)", fin and fin.get('result') == 'sent', (up, fin))
        wp = up['files'][0]['path']
        ok("...its page is read by its teacher and not by another", st.can_read('authenticated', A, wp) and not st.can_read('authenticated', B, wp))
        ok('a name of the students\' shape with no row cannot be uploaded',
           str(put(A, '%s/%s/%s/%s/%s.jpg' % (COURSE_A, a, ENR1, nid(), nid()))).startswith('STORAGE 403'))

        # the restricting policies, with a careless policy added
        s9, f9 = d.handout(a, 1); hp = s9['paths'][0]
        d.run("create policy careless on storage.objects for all to public using (true) with check (true)")
        try:
            ok('with a policy that lets everyone do everything: another teacher still cannot read a handout page or a student page',
               not st.can_read('authenticated', B, hp) and not st.can_read('authenticated', B, wp))
            ok('...the anonymous role still reads nothing in the bucket', st.visible('anon', None) == [])
            ok('...and nobody can upload a name the two upload rules do not allow',
               str(put(B, hpath(COURSE_A, s9['id'], 1) + 'x')).startswith('STORAGE 403') and str(put(A, COURSE_A + '/notes.jpg')).startswith('STORAGE 403')
               and str(put(None, hpath(COURSE_A, nid(), 1), role='anon')).startswith('STORAGE 403'))
            ok('...while its own teacher still reads both', st.can_read('authenticated', A, hp) and st.can_read('authenticated', A, wp))
        finally:
            d.run('drop policy careless on storage.objects')
    finally:
        d.close()

# ── student ─────────────────────────────────────────────────────────────────
@scenario('student')
def scen_student():
    # page is the same answer as before the file, but for resources
    d0 = HDb('hl_student0', template=template(False)); k0 = seed_work(d0)
    try:
        t0, _ = d0.session(ENR1)
        d0.run("update course set show_my_learning = true where id = :c", c=COURSE_A)
        before = d0.page(t0, ENR1)
        r = d0.statements(split(file_text()))
        ok('(setup) the file applies to a database with a card session', r == 'ok', r)
        after = d0.page(t0, ENR1)
        ok('every assessment on page now has resources, an empty list', after['assessments'] and all(x.get('resources') == [] for x in after['assessments']), after['assessments'])
        for x in after['assessments']: x.pop('resources')
        ok('page is otherwise exactly the answer it was before the file', after == before)
        old = d0.one("select pg_get_functiondef('student_submit.page(text,uuid,text)'::regprocedure)")
        ok('(setup) page is replaced', 'assessment_resource' in old)
    finally:
        d0.close()
    d, k, t1, t2 = world('student'); a = k['takes']; a2 = k['nothing']
    try:
        l1 = d.link(a, 'https://www.youtube.com/watch?v=abc123', 'Mitosis Video')
        s, f = d.handout(a, 3, 'Cell Lab.pdf')
        l2 = d.link(a, 'https://www.britannica.com/science/cell-biology')
        up = d.start(a, 'Not Yet.pdf', 2); d.put_pages(up['paths'][:1])
        res = d.resources(t1, ENR1, a)
        ok('page lists the ready ones in the order added: link, handout, link',
           res == [{'id': l1['id'], 'kind': 'link', 'title': 'Mitosis Video', 'url': l1['url'], 'page_count': None},
                   {'id': s['id'], 'kind': 'pdf', 'title': 'Cell Lab.pdf', 'url': None, 'page_count': 3},
                   {'id': l2['id'], 'kind': 'link', 'title': 'www.britannica.com', 'url': l2['url'], 'page_count': None}], res)
        ok('a handout still uploading is not on the page', up['id'] not in [x['id'] for x in res])
        ok('no path is on the page', 'handouts/' not in json.dumps(d.page(t1, ENR1)))
        ok('a piece with nothing on it has an empty list', d.resources(t1, ENR1, a2) == [])
        ok("another student of the class sees the same", d.resources(t2, ENR2, a) == res)
        hl = d.links(t1, ENR1, s['id'])
        ok('handout_links: the three pages and their paths, in order, with the bucket',
           hl.get('ok') is True and hl['bucket'] == BUCKET and hl['resource_id'] == s['id'] and hl['assessment_id'] == a
           and hl['page_count'] == 3 and hl['title'] == 'Cell Lab.pdf'
           and hl['pages'] == [{'page': n, 'path': hpath(COURSE_A, s['id'], n)} for n in (1, 2, 3)], hl)
        ok('...every path is a file in storage', all(p['path'] in stored(d) for p in hl['pages']))
        ok('handout_links for one still uploading: not_found', d.links(t1, ENR1, up['id']) == {'ok': False, 'error': 'not_found'})
        ok('...for a link: not_found', d.links(t1, ENR1, l1['id']) == {'ok': False, 'error': 'not_found'})
        ok('...for nothing: not_found', d.links(t1, ENR1, nid()) == {'ok': False, 'error': 'not_found'})
        ok('...with a token that is not a session: signed_out', d.links('f' * 80, ENR1, s['id']).get('error') == 'signed_out')
        ok("...for a student the session is not: not_found", d.links(t1, ENR2, s['id']).get('error') == 'not_found')
        # another class
        sb, fb = d.handout(k['b_takes'], 1, uid=B)
        ok("a handout of another class: not_found, and not on this student's page",
           fb['status'] == 'ready' and d.links(t1, ENR1, sb['id']) == {'ok': False, 'error': 'not_found'}
           and sb['id'] not in json.dumps(d.page(t1, ENR1)))
        # a piece dated into the future is not on the page
        with tx(d):
            d.run("update assessment set date_assigned = (now() at time zone 'America/Vancouver')::date + 1 where id = :a", a=a)
            ok('a piece dated tomorrow is not on the page, and its handout has no links',
               d.resources(t1, ENR1, a) is None and d.links(t1, ENR1, s['id']) == {'ok': False, 'error': 'not_found'})
            d.run("update assessment set date_assigned = (now() at time zone 'America/Vancouver')::date where id = :a", a=a)
            ok('dated today it is, and has', len(d.resources(t1, ENR1, a)) == 3 and d.links(t1, ENR1, s['id']).get('ok') is True)
        with tx(d):
            d.run('update course set student_page_enabled = false where id = :c', c=COURSE_A)
            ok("with the class's Student Page off, handout_links refuses as page does",
               d.links(t1, ENR1, s['id']).get('ok') is False and d.links(t1, ENR1, s['id']).get('error') == d.page(t1, ENR1).get('error'))
        d.remove(s['id'])
        ok('a removed handout is off the page at once and has no links',
           s['id'] not in [x['id'] for x in d.resources(t1, ENR1, a)] and d.links(t1, ENR1, s['id']).get('error') == 'not_found')
        for who in ('anon', 'authenticated'):
            ok('%s cannot run handout_links' % who, err(d, lambda: d.role(who, "select student_submit.handout_links('x', null, null, 'i')", uid=A if who == 'authenticated' else None)) == '42501')
    finally:
        d.close()

# ── lifecycle ───────────────────────────────────────────────────────────────
def scen_lifecycle_run(fixed):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('life_%d' % fixed, fixed); a = k['takes']
    try:
        if fixed:
            s, f = d.handout(a, 2, 'Cell Lab.pdf'); pages = s['paths']; rid = s['id']
        else:
            # Without the file there is no row: the same two files, put where a handout's pages go.
            rid = nid(); pages = [hpath(COURSE_A, rid, 1), hpath(COURSE_A, rid, 2)]
            for p in pages: d.storage.put_signed(d.storage.sign_upload(p))
        w, wf = d.send(t1, ENR1, a, 1)
        assert wf and wf.get('ok'), wf
        work = sorted(p for r in d.all('select path, thumb_path from submission_file where submission_id = :s', s=w['submission_id']) for p in r)
        # Everything in the bucket is three days old.
        d.run("update storage.objects set created_at = now() - interval '3 days'")
        d.run("update submission_file set created_at = now() - interval '3 days'")
        d.run("update submission set created_at = now() - interval '3 days', sent_at = now() - interval '3 days', updated_at = now() - interval '3 days'")
        if fixed: d.run("update assessment_resource set created_at = now() - interval '3 days', updated_at = now() - interval '3 days'")
        # Keep Photos Until: the class's day was yesterday.
        d.run("""update course set keep_photos_until = 'end_of_term',
                        reporting_terms = jsonb_build_array(jsonb_build_object('id', 't1', 'name', 'Term 1', 'starts_on', '2020-01-01',
                            'ends_on', ((now() at time zone 'America/Vancouver')::date - 1)::text))
                  where id = :c""", c=COURSE_A)
        r = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        check('(setup) the nightly job runs', not isinstance(r, str), r)
        check("(setup) Keep Photos Until deleted the student's page: its row is gone and both its files are queued",
              d.one('select count(*) from submission_file') == 0 and set(work) <= set(queued(d, 'keep_photos_until')), queued(d))
        check('Keep Photos Until did not touch the handout: both its pages are in storage and neither is queued',
              set(pages) <= set(stored(d)) and not (set(pages) & set(queued(d))), (stored(d), queued(d)))
        if fixed:
            ok('...its row is as it was, ready', rows(d, 'id = :r', r=rid) == [[rid, 'pdf', 'ready', 1]])
            ok('...the teacher still reads it and the student still gets its links',
               d.storage.can_read('authenticated', A, pages[0]) and d.links(t1, ENR1, rid).get('ok') is True)
        check("the nightly check does not report a handout's pages as files with strange names",
              logged(d, 'stray_other_name') == [], logged(d, 'stray_other_name'), differs=True)
        check('...nor as strays, nor as pages with a missing file',
              not [p for p in queued(d, 'stray') if 'handouts' in p] and logged(d, 'missing_file') == [], (queued(d), logged(d, 'missing_file')))
        check('the nightly job logged no error', logged(d, 'error') == [], logged(d, 'error'))
        drain(d)
        check("the worker deletes the student's files and leaves the handout's", not (set(work) & set(stored(d))) and set(pages) <= set(stored(d)), stored(d))
        if not fixed: return
        # A second night changes nothing for it.
        d.run('call public.photo_lifecycle_nightly()')
        ok('a second night: the handout is still there, nothing of it queued', set(pages) <= set(stored(d)) and not [p for p in queued(d) if 'handouts' in p])

        # Strays of a handout's shape
        gone_rid = nid(); stray_old = hpath(COURSE_A, gone_rid, 1); stray_young = hpath(COURSE_A, nid(), 1)
        beyond = hpath(COURSE_A, rid, 3)                       # a page past the handout's count
        other_class = hpath(nid(), nid(), 1)                   # a class that is gone
        odd = COURSE_A + '/handouts/notes.txt'
        plant(d, stray_old, 25); plant(d, stray_young, 23); plant(d, beyond, 30); plant(d, other_class, 48); plant(d, odd, 48)
        waiting = hpath(COURSE_A, nid(), 2); plant(d, waiting, 48)
        d.run("insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at) values (:b, :p, :c, 'handout_removed', now())", b=BUCKET, p=waiting, c=COURSE_A)
        d.run('delete from photo_check_log')
        d.run('call public.photo_lifecycle_nightly()')
        q = set(queued(d, 'stray'))
        ok("a handout-shaped file no row names, 25 hours old, is queued for deletion (reason stray)", stray_old in q, q)
        ok('one 23 hours old is not', stray_young not in q)
        ok("a page past its handout's count is a stray too", beyond in q)
        ok('a file of a class that is gone is queued by the last pass', other_class in q)
        ok("the handout's own pages are not", not (set(pages) & set(queued(d))))
        ok('a file already waiting is not queued twice', d.one('select count(*) from submission_file_removal where path = :p', p=waiting) == 1)
        ok('a file of any other name under handouts/ is reported, not queued',
           odd not in set(queued(d)) and [x[1] for x in logged(d, 'stray_other_name')] == [1], logged(d, 'stray_other_name'))
        ok('the strays are logged for the class', any(x[0] == COURSE_A and x[1] == 2 for x in logged(d, 'stray_queued')), logged(d, 'stray_queued'))
        d.run("update submission_file_removal set link_dies_at = now() where not done")
        drain(d)
        ok('the worker deletes the strays; the handout stays', not ({stray_old, beyond, other_class, waiting} & set(stored(d))) and set(pages) <= set(stored(d)), stored(d))
        ok('KNOWN, for the edge function: a handout page is not a name its worker deletes today (storage-rest.ts PATH); it must learn the shape before a screen ships',
           not any(EDGE_PATH.match(p) for p in pages) and all(HANDOUT.match(p) for p in pages))

        # An upload never finished, in a class nobody uses
        u = d.start(a, 'Abandoned.pdf', 3); d.put_pages(u['paths'][:2]); age(d, u['id'], 3)
        d.run('delete from photo_check_log')
        d.run('call public.photo_lifecycle_nightly()')
        ok('the nightly job drops an upload never finished: its row is gone and its uploaded pages are queued (reason handout_expired)',
           count(d, 'id = :r', r=u['id']) == 0 and set(u['paths'][:2]) <= set(queued(d, 'handout_expired')), queued(d))
        ok('...and logs it', [x[2] for x in logged(d, 'expired')] == [{'handouts': 1}], logged(d, 'expired'))
        u2 = d.start(a, 'In Time.pdf', 1); d.put_pages(u2['paths'])
        d.run('call public.photo_lifecycle_nightly()')
        ok('an upload still inside its two hours is left alone', count(d, 'id = :r', r=u2['id']) == 1 and u2['paths'][0] not in queued(d))
        # the missing-file report is unchanged: it reads pages of students' work only
        d.storage.remove([pages[0]])
        ok("a handout's missing page is not in the nightly missing-file report (it lists students' pages only)", d.one('select public._photo_missing(:c)', c=COURSE_A)['n'] == 0)
    finally:
        d.close()

@scenario('lifecycle')
def scen_lifecycle():
    scen_lifecycle_run(True); scen_lifecycle_run(False); MODE['fixed'] = True

# ── deletes ─────────────────────────────────────────────────────────────────
@scenario('deletes')
def scen_deletes():
    d, k, t1, t2 = world('deletes'); a = k['takes']; a2 = k['nothing']
    try:
        def setup(x):
            s1, f1 = x.handout(a, 3, 'One.pdf'); s2, f2 = x.handout(a2, 2, 'Two.pdf'); x.link(a, 'https://example.org')
            up = x.start(a, 'Half.pdf', 2); x.put_pages(up['paths'][:1])
            sb, fb = x.handout(k['b_takes'], 1, uid=B)
            assert f1['status'] == f2['status'] == fb['status'] == 'ready'
            return s1['paths'] + up['paths'], s2['paths'], sb['paths']
        cases = [
            ('deleting the assessment (delete_assessment)', lambda x: x.rpc('delete_assessment(:a)', a=a), 'one'),
            ('the 30-day purge of a deleted class (fv_retention_cleanup)', lambda x: (x.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=COURSE_A), x.run('select public.fv_retention_cleanup()')), 'class'),
            ("the 30-day purge of a deleted teacher's account (fv_retention_cleanup)", lambda x: (x.run("update teacher set deleted_at = now() - interval '31 days' where id = :t", t=A), x.run('select public.fv_retention_cleanup()')), 'class'),
            ("clear_data() (stand-in: it deletes the caller's classes and students)", lambda x: (x.run('delete from course where teacher_id = :t', t=A), x.run('delete from student where teacher_id = :t', t=A)), 'class'),
            ('TRUNCATE assessment', lambda x: x.run('truncate assessment cascade'), 'all'),
            ('deleting the rows themselves, as the owner', lambda x: x.run('delete from assessment_resource where course_id = :c', c=COURSE_A), 'class'),
        ]
        for label, act, scope in cases:
            with tx(d):
                p1, p2, pb = setup(d)
                want = p1 if scope == 'one' else p1 + p2 if scope == 'class' else p1 + p2 + pb
                keep = (p2 + pb) if scope == 'one' else pb if scope == 'class' else []
                r = attempt(lambda: act(d))
                ok('%s: it runs' % label, not (isinstance(r, str) and r.startswith('ERROR')), r)
                ok('%s: every page of every handout it removes is queued, the unfinished upload\'s included' % label, set(want) <= set(queued(d)), (want, queued(d)))
                ok('%s: and no other' % label, not (set(keep) & set(queued(d))))
                ok('%s: no row is left without its assessment' % label,
                   d.one('select count(*) from assessment_resource r where not exists (select 1 from assessment a where a.id = r.assessment_id)') == 0)
                drain(d)
                ok('%s: the worker then deletes exactly those from storage' % label, not (set(want) & set(stored(d))) and set(keep) <= set(stored(d)), stored(d))
        # Remove, then the worker, step by step (the queue's two looks)
        s, f = d.handout(a, 2)
        d.remove(s['id'])
        q = d.all("select path, reason, done, removed_at is null, link_dies_at > now() + interval '9 minutes', link_dies_at <= now() + interval '10 minutes', course_id::text from submission_file_removal order by path")
        ok('Remove queues each page once, to be deleted now and looked for once more ten minutes on',
           [x[0] for x in q] == sorted(s['paths']) and all(x[1:] == ['handout_removed', False, True, True, True, COURSE_A] for x in q), q)
        ok('the timer sees files due', d.one('select public.photo_removal_due()') is True)
        b, done = d.drain(100)
        ok('the worker is handed the two paths, deletes them, and the database sees them gone', sorted(i['path'] for i in b['items']) == sorted(s['paths']) and done['gone'] == 2 and not (set(s['paths']) & set(stored(d))), (b, done))
        ok('they are not yet done: the second look is still to come', d.one('select count(*) from submission_file_removal where done') == 0)
        d.storage.put_signed(d.storage.sign_upload(s['paths'][0]))    # an upload that was already under way lands late
        d.run('update submission_file_removal set link_dies_at = now()')
        drain(d)
        ok('at the second look a page that landed late is deleted too, and both are done',
           not (set(s['paths']) & set(stored(d))) and d.one('select count(*) from submission_file_removal where done') == 2, stored(d))
        # A student's page and a handout page leave together
        s2, f2 = d.handout(a, 1); w, wf = d.send(t1, ENR1, a, 1)
        work = sorted(p for r in d.all('select path, thumb_path from submission_file where submission_id = :s', s=w['submission_id']) for p in r)
        d.rpc('delete_assessment(:a)', a=a)
        ok("deleting an assessment with a student's work and a handout: all three files are queued",
           set(work + s2['paths']) <= set(queued(d)), queued(d))
        drain(d)
        ok('...and the worker deletes all three', not (set(work + s2['paths']) & set(stored(d))), stored(d))
        ok('a link leaves nothing in the queue', d.one("select count(*) from submission_file_removal where path not like '%.jpg'") == 0)
    finally:
        d.close()

# ── race ────────────────────────────────────────────────────────────────────
def together(d, calls, course=COURSE_A):
    """Run the calls at the same time, each on its own connection: the class's lock is held until every one
    of them is waiting on it (or on a row), then let go. What each answered, in order."""
    holder = HSide(d); sides = [HSide(d) for _ in calls]; out = [None] * len(calls)
    try:
        holder.run('begin'); holder.run('select public._grade_return_lock(:c)', c=course)
        def go(i):
            out[i] = attempt(lambda: calls[i](sides[i]))
        ts = [threading.Thread(target=go, args=(i,)) for i in range(len(calls))]
        for t in ts: t.start()
        for _ in range(200):
            if d.one("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'") >= len(calls): break
            threading.Event().wait(0.02)
        holder.run('commit')
        for t in ts: t.join(30)
    finally:
        for s in sides + [holder]: s.close()
    return out

@scenario('race')
def scen_race():
    d, k, t1, t2 = world('race'); a = k['takes']
    ROUNDS = 12
    try:
        bad = lambda r: isinstance(r, str) and r.startswith('ERROR')
        # the same start, twice at once
        problems = []
        for _ in range(ROUNDS):
            key = nid(); n0 = count(d)
            r1, r2 = together(d, [lambda s: s.start(a, 'Twice.pdf', 2, key=key)] * 2)
            if bad(r1) or bad(r2) or r1 != r2 or count(d) != n0 + 1: problems.append((r1, r2, count(d) - n0))
        ok('the same start sent twice at once (%d rounds): one handout, the same answer to both' % ROUNDS, not problems, problems[:2])
        # two different adds at once: both land, in an order
        problems = []
        for _ in range(ROUNDS):
            with_ = d.all('select position from assessment_resource where assessment_id = :a', a=a)
            r1, r2 = together(d, [lambda s: s.link(a, 'https://example.org/1'), lambda s: s.start(a, 'B.pdf', 1)])
            pos = sorted(x[0] for x in d.all('select position from assessment_resource where assessment_id = :a', a=a))
            if bad(r1) or bad(r2) or len(pos) != len(with_) + 2 or len(set(pos)) != len(pos): problems.append((r1, r2, pos))
        ok('a link and a handout added at once (%d rounds): both are added, no two share a place in the order' % ROUNDS, not problems, problems[:2])
        d.run('delete from assessment_resource'); drain(d); d.run('delete from submission_file_removal')
        # finish and remove at once
        problems = []; seen = set()
        for _ in range(ROUNDS):
            s = d.start(a, 'FR.pdf', 2); d.put_pages(s['paths'])
            r1, r2 = together(d, [lambda x: x.finish(s['id']), lambda x: x.remove(s['id'])])
            good = (not bad(r1) and not bad(r2) and r2 == {'removed': True} and r1.get('status') in ('ready', 'gone')
                    and count(d, 'id = :r', r=s['id']) == 0 and set(s['paths']) <= set(queued(d)))
            seen.add(r1.get('status') if isinstance(r1, dict) else r1)
            if not good: problems.append((r1, r2, queued(d)))
        ok('finish and remove at once (%d rounds): the handout is removed, every page queued, finish answers ready or gone, never an error' % ROUNDS, not problems, problems[:2])
        # finish twice at once, two keys
        problems = []
        for _ in range(ROUNDS):
            s = d.start(a, 'FF.pdf', 1); d.put_pages(s['paths'])
            r1, r2 = together(d, [lambda x: x.finish(s['id'])] * 2)
            if bad(r1) or bad(r2) or r1.get('status') != 'ready' or r2.get('status') != 'ready': problems.append((r1, r2))
        ok('two finishes at once (%d rounds): both answer ready' % ROUNDS, not problems, problems[:2])
        # remove twice at once, two keys
        problems = []
        for _ in range(ROUNDS):
            s, f = d.handout(a, 1)
            r1, r2 = together(d, [lambda x: x.remove(s['id'])] * 2)
            if bad(r1) or bad(r2) or sorted([r1['removed'], r2['removed']]) != [False, True]: problems.append((r1, r2))
        ok('two removes at once (%d rounds): one removes, the other answers removed false' % ROUNDS, not problems, problems[:2])
        # start, finish and a link against deleting the assessment
        problems = []; answers = set()
        for i in range(ROUNDS):
            x = nid()
            d.run("insert into assessment (id, course_id, title, score_mode, max_points) values (:x, :c, 'Short Lived', 'points', 10)", x=x, c=COURSE_A)
            s = d.start(x, 'Pre.pdf', 1); d.put_pages(s['paths'])
            calls = [lambda q: q.rpc('delete_assessment(:a)', a=x), lambda q: q.start(x, 'New.pdf', 2), lambda q: q.finish(s['id']),
                     lambda q: q.link(x, 'https://example.org')]
            if i % 2: calls = calls[1:] + calls[:1]
            out = together(d, calls)
            dele = out[-1] if i % 2 else out[0]; rest = out[:-1] if i % 2 else out[1:]
            answers.update(r[:11] if isinstance(r, str) else 'answered' for r in rest)
            good = (not bad(dele) and all((not bad(r)) or r.startswith('ERROR P0002') for r in rest)
                    and count(d, 'assessment_id = :x', x=x) == 0 and set(s['paths']) <= set(queued(d)))
            if not good: problems.append(out)
        ok('start, finish and Add a Link against delete_assessment (%d rounds): no deadlock; the delete always goes through; the others are '
           'answered or told the assessment is not found; no row is left and every page is queued' % ROUNDS, not problems, problems[:2])
        ok('...no call ended in a deadlock or a lock timeout', not [x for x in answers if x.startswith('ERROR 40') or x.startswith('ERROR 55')], answers)
        # an upload against its handout being removed: the page lands or is refused, and either way it goes
        problems = []
        for _ in range(ROUNDS):
            s = d.start(a, 'UR.pdf', 1); p = s['paths'][0]
            side = HSide(d)
            try:
                r1 = attempt(lambda: side.storage.put_as('authenticated', A, p)); r2 = d.remove(s['id'])
            finally: side.close()
            d.run('update submission_file_removal set link_dies_at = now()'); drain(d)
            if p in stored(d) or r2 != {'removed': True}: problems.append((r1, r2))
        ok('a page uploaded, then its handout removed (%d rounds): the file is deleted' % ROUNDS, not problems, problems[:2])
        ok('after all of it: no handout row without its assessment, and nothing left in storage that no row names',
           d.one('select count(*) from assessment_resource r where not exists (select 1 from assessment a where a.id = r.assessment_id)') == 0)
    finally:
        d.close()

# ── apply ───────────────────────────────────────────────────────────────────
def procs(d):
    return d.all("""select n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')',
                           md5(pg_get_functiondef(p.oid))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'student_submit', 'fv_private') and p.prokind in ('f', 'p') order by 1""")

@scenario('apply')
def scen_apply():
    text = text_at(FILE_USED); sts = split(text)
    ok('the file is one transaction: begin first, commit last', bare(sts[0]).lower() == 'begin' and bare(sts[-1]).lower() == 'commit')
    ok('every list in the four files is filled in', all('PENDING' not in text_at(f) for f in LIST_FILES))
    d = HDb('hl_apply', template=template(False)); k = seed_work(d); a = k['takes']
    try:
        # In use: a card session, a student's work handed in, a teacher's upload under way.
        t1, _ = d.session(ENR1)
        w, wf = d.send(t1, ENR1, a, 2)
        up = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=ENR2, p=json.dumps([{'width': 1500, 'height': 2000}]), m='new', k=nid())
        local = fps(d, RELIED + REPLACED)
        diff = sorted(f for f in LIVE if f in local and local[f] != LIVE[f])
        ok('every function the file calls or replaces is, here, the definition read from gradebook-prod on 2026-11-11 (%d compared)' % len([f for f in LIVE if f in local]),
           not diff and all(f in LIVE for f in REPLACED), diff)
        in_file = lists_of(text)
        ok('the file\'s lists hold those same fingerprints', all(local[f] == h for f, h, _ in in_file['relied'])
           and all(local[f] == h for f, h, _ in in_file['replaces']) and [x[0] for x in in_file['relied']] == RELIED, in_file)
        pre = d.file(PRE)
        ok('the pre-check on the database as live is: no rows', pre == 'ok' and d.rows == [], (pre, d.rows))
        post = d.file(POST)
        ok('the post-check before the apply lists what is missing', post == 'ok' and len(d.rows) >= len(NEW), (post, len(d.rows)))

        def stopped(setup, want, pre_says=None):
            d.begin()
            try:
                for s in setup: d.run(s)
                seen = None
                if pre_says:
                    r0 = [list(x) for x in d.c.run(bare_query(text_at(PRE)))]
                    seen = any(pre_says in str(x[0]) for x in r0)
                r = d.statements(split(text))
            finally:
                try: d.rollback()
                except Exception: pass
            return (r.startswith('STOPPED') and want in r and 'Nothing was changed' in r and (seen is None or seen)), (r, seen)
        fence_other = "alter policy fv_student_photos_fence on storage.objects using (bucket_id is distinct from 'student-photos' or fv_private.work_read_allowed(name) or true)"
        for label, setup, want, pre_says in [
            ('with a relied-on function changed', ["create or replace function public._work_hold() returns interval language sql stable set search_path to 'public', 'pg_temp' as $f$ select interval '3 hours' $f$"], 'is not the definition this migration was tested against', 'relied on: public._work_hold()'),
            ('with page changed since it was read', ["create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text) returns jsonb language sql stable security definer set search_path to 'public', 'student_submit', 'pg_temp' as $f$ select '{}'::jsonb $f$"], 'is not the definition this migration was written against', 'replaced: student_submit.page'),
            ('with the stray check changed since it was read', ["create or replace function public._photo_strays(p_course_id uuid, p_now timestamptz) returns jsonb language sql security definer set search_path to 'public', 'pg_temp' as $f$ select '{}'::jsonb $f$"], 'is not the definition this migration was written against', 'replaced: public._photo_strays'),
            ('with a function of its name already there', ["create function public.list_course_resources(p uuid) returns jsonb language sql as $f$ select '[]'::jsonb $f$"], 'already exists', 'new name already taken'),
            ('with a table of its name already there', ['create table public.assessment_resource (id uuid)'], 'already exists', 'assessment_resource is there'),
            ('with the slips migration not applied', ['drop function student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)'], 'not all applied', 'earlier migration is missing'),
            ('with the fence saying something else', [fence_other], 'fv_student_photos_fence is not as Batch B wrote it', 'the policy fv_student_photos_fence'),
            ('with one of Batch B\'s policies gone', ['drop policy fv_student_photos_teachers_only on storage.objects'], 'are not all on storage.objects', 'fv_student_photos_teachers_only'),
            ('with a policy of its name saying something else', ["create policy fv_handouts_read on storage.objects for select to authenticated using (true)"], 'says something else', 'fv_handouts_read says something else'),
            ('with the bucket made public', ["update storage.buckets set public = true where id = 'student-photos'"], 'bucket student-photos', 'the bucket student-photos'),
            ('with row security off on storage.objects', ['alter table storage.objects disable row level security'], 'row security turned off', 'storage.objects row security'),
        ]:
            good, r = stopped(setup, want, pre_says)
            ok('it stops, with nothing changed, %s; and the pre-check says so first' % label, good, r)

        ok("(setup) the photo lifecycle's own post-check runs", d.file('photo-lifecycle-live-postcheck.sql') == 'ok'); pl_before = d.rows
        cols = table_columns(d.c)
        before = dict(procs(d)); rows_before = row_checksums(d.c, cols); cat_before = catalog(d.c)
        r = d.statements(sts)
        ok('it applies on a database in use', r == 'ok', r)
        after = dict(procs(d))
        changed = sorted(p for p in before if p in after and before[p] != after[p])
        ok('the only existing functions it changes are page and the stray check', changed == sorted(REPLACED), changed)
        ok('it adds exactly its sixteen functions', sorted(set(after) - set(before)) == sorted(NEW) and len(NEW) == 16, sorted(set(after) - set(before)))
        ok('it drops none', not (set(before) - set(after)))
        rows_after = row_checksums(d.c, cols)
        moved = [t for t in rows_before if rows_before[t] != rows_after.get(t)]
        ok('no row of any table is changed, added or deleted by the apply (%d tables compared)' % len(rows_before), moved == [], moved)
        ok('no file in storage is touched', stored(d) and rows_before['storage.objects'] == rows_after['storage.objects'])
        only0, only1 = differences(cat_before, catalog(d.c))
        gone_lines = [l for l in only0 if not (l.startswith(('function ', 'function more ', 'policy storage.objects | fv_student_photos_fence', 'depends ', 'comments on', 'internal triggers'))
                                                and ('student_submit.page(' in l or 'public._photo_strays(' in l or 'fv_student_photos_fence' in l or l.startswith(('depends ', 'comments on', 'internal triggers'))))]
        ok('nothing else in the catalog is changed or removed: only page, the stray check and the fence differ', gone_lines == [], gone_lines)
        ok('the post-check after: no rows', d.file(POST) == 'ok' and d.rows == [], d.rows)
        ok('the pre-check after: no rows (everything is as the file leaves it)', d.file(PRE) == 'ok' and d.rows == [], d.rows)
        ok('the photo lifecycle\'s own post-check now also names the stray check, which this file replaced, and nothing else new (expected)',
           d.file('photo-lifecycle-live-postcheck.sql') == 'ok' and [x for x in d.rows if x not in pl_before]
           == [['function public._photo_strays(uuid,timestamp with time zone)', LIVE[REPLACED[1]], after[REPLACED[1]]]], d.rows)
        cat1 = catalog(d.c)
        r2 = d.file(FILE_USED)
        ok('a second run: applies, changes nothing', r2 == 'ok' and catalog(d.c) == cat1, (r2, differences(cat1, catalog(d.c))))
        ok('the card session from before still works, and its page has resources', d.page(t1, ENR1).get('ok') is True and d.resources(t1, ENR1, a) == [])
        for f in up['files']:
            for p in (f['path'], f['thumb_path']): d.storage.put_as('authenticated', A, p)
        fin = d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=up['submission_id'], f=json.dumps([{'file_id': f['file_id'], 'sha256': HASH} for f in up['files']]), k=nid())
        ok("the teacher's upload begun before the apply uploads and finishes after it", fin.get('result') == 'sent', fin)
        # with rows, a second run still changes nothing
        s, f = d.handout(a, 2); d.link(a, 'https://example.org')
        cols2 = table_columns(d.c); rb = row_checksums(d.c, cols2)
        r3 = d.file(FILE_USED)
        ok('a run on a database with handouts and links: applies, changes no row', r3 == 'ok' and row_checksums(d.c, cols2) == rb, r3)
        # grants
        g = {f: [d.one('select has_function_privilege(:r, :f, \'execute\')', r=r, f=f) for r in ('anon', 'authenticated', 'service_role')] for f in NEW + REPLACED}
        ok('the anonymous role can run none of it', not any(v[0] for v in g.values()), {f: v for f, v in g.items() if v[0]})
        ok('signed-in teachers run the five functions and the two policy tests, and nothing else of it',
           sorted(f for f, v in g.items() if v[1]) == sorted(TEACHER_RPCS + ['fv_private.handout_upload_allowed(text)', 'fv_private.handout_read_allowed(text)']), g)
        ok('the service role runs handout_links and page, and nothing else of it',
           sorted(f for f, v in g.items() if v[2]) == sorted(['student_submit.handout_links(text,uuid,uuid,text)', 'student_submit.page(text,uuid,text)']), g)
        ok('every SECURITY DEFINER function among them names pg_temp last',
           d.one("""select count(*) from pg_proc p where p.oid = any (:f::regprocedure[]) and p.prosecdef
                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')""", f='{%s}' % ','.join('"%s"' % x for x in NEW + REPLACED)) == 0)
        # the new page differs from the old only by the lines added
        old = d.one("select prosrc from pg_proc where oid = 'student_submit.page(text,uuid,text)'::regprocedure")
        base = HDb('hl_apply_b', template=template(False))
        try:
            was = base.one("select prosrc from pg_proc where oid = 'student_submit.page(text,uuid,text)'::regprocedure")
            was_s = base.one("select prosrc from pg_proc where oid = 'public._photo_strays(uuid,timestamp with time zone)'::regprocedure")
        finally: base.close()
        import difflib
        dl = [l for l in difflib.ndiff(was.splitlines(), old.splitlines()) if l[:1] in '+-']
        ok('page: no line of the old body is removed but the one that closed the list (it gains a comma); nine lines are added, together, for resources',
           [l for l in dl if l.startswith('-')] == ["-                                 where cc.id = any (a.core_competency_ids)), '[]'::jsonb))"]
           and len([l for l in dl if l.startswith('+')]) == 9, dl)
        now_s = d.one("select prosrc from pg_proc where oid = 'public._photo_strays(uuid,timestamp with time zone)'::regprocedure")
        ds = [l for l in difflib.ndiff(was_s.splitlines(), now_s.splitlines()) if l.startswith('-')]
        ok('the stray check: the only lines of the old body that change are the two that test a name\'s shape in the pass for no class',
           sorted(x[1:].strip() for x in ds) == sorted(['and o.name ~ _layout', "and o.created_at < p_now - interval '24 hours' and o.name !~ _layout;"]), ds)
    finally:
        d.close()

def bare_query(text):
    sts = split(text); assert len(sts) == 1, len(sts)
    return sts[0]

# ── undo ────────────────────────────────────────────────────────────────────
@scenario('undo')
def scen_undo():
    d = HDb('hl_undo', template=template(False)); k = seed_work(d); a = k['takes']
    try:
        t1, _ = d.session(ENR1); w, wf = d.send(t1, ENR1, a, 1)
        cols = table_columns(d.c)
        cat0 = catalog(d.c); p0 = procs(d); rows0 = row_checksums(d.c, cols)
        d.file('photo-lifecycle-live-postcheck.sql'); pl0 = d.rows
        r0 = d.file(UNDO)
        ok('the undo where the file was never applied: runs, changes nothing', r0 == 'ok' and catalog(d.c) == cat0 and row_checksums(d.c, cols) == rows0, (r0, differences(cat0, catalog(d.c))))
        ok('the file applies', d.file(FILE_USED) == 'ok')
        r = d.file(UNDO)
        ok('applied and not used, the undo runs', r == 'ok', r)
        ok('...every function is as before', procs(d) == p0, differences([tuple(x) for x in p0], [tuple(x) for x in procs(d)]))
        ok('...the catalog is exactly as before the file', catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
        ok('...and every row of every table (%d tables)' % len(rows0), row_checksums(d.c, cols) == rows0)
        ok('...page answers as before (no resources)', 'resources' not in d.page(t1, ENR1)['assessments'][0])

        ok('the file applies again after the undo', d.file(FILE_USED) == 'ok')
        cat_applied = catalog(d.c)
        l1 = d.link(a, 'https://example.org', 'A Link'); s, f = d.handout(a, 2, 'Kept.pdf')
        up = d.start(a, 'Under Way.pdf', 2); d.put_pages(up['paths'][:1])
        rows1 = row_checksums(d.c, table_columns(d.c))
        r = d.file(UNDO)
        ok('with handouts and links held, PART 2 refuses and says how to go ahead', r.startswith('STOPPED') and 'holds teachers' in r and 'Nothing was changed' in r, r)
        ok('PART 1 had run: a teacher can no longer add a link, start a handout or finish one',
           err(d, lambda: d.link(a, 'https://example.org/2')) == '42501' and err(d, lambda: d.start(a, 'x.pdf', 1)) == '42501'
           and err(d, lambda: d.finish(up['id'])) == '42501')
        ok('...it changed no row', row_checksums(d.c, table_columns(d.c)) == rows1)
        ok('...what is there still shows: the list, the student page and its links', len(d.listed()) == 3
           and [x['id'] for x in d.resources(t1, ENR1, a)] == [l1['id'], s['id']] and d.links(t1, ENR1, s['id']).get('ok') is True)
        ok('...and can still be removed', d.remove(l1['id']) == {'removed': True})
        only0, only1 = differences(cat_applied, catalog(d.c))
        ok('...the only change PART 1 makes to the catalog is those three grants',
           only0 and all(l.startswith('function ') and any(n in l for n in ('add_assessment_link', 'start_handout_upload', 'finish_handout_upload')) for l in only0 + only1), (only0, only1))
        ok('the file run again turns adding back on', d.file(FILE_USED) == 'ok' and catalog(d.c) == cat_applied and d.link(a, 'https://example.org/3')['status'] == 'ready')
        # going ahead: delete the rows, let the worker run, then the undo
        d.run('delete from public.assessment_resource')
        ok('deleting the rows queues every page of both handouts', set(s['paths'] + up['paths']) <= set(queued(d)), queued(d))
        d.run('update submission_file_removal set link_dies_at = now()'); drain(d)
        ok('the worker deletes them', not [p for p in stored(d) if 'handouts' in p], stored(d))
        r = d.file(UNDO)
        ok('with no row held, the undo runs', r == 'ok', r)
        ok('...the catalog is exactly as before the file', catalog(d.c) == cat0, differences(cat0, catalog(d.c)))
        rows2 = row_checksums(d.c, cols)
        moved = sorted(t for t in rows0 if rows0[t] != rows2.get(t))
        ok('...the only tables whose rows differ from before the file are the removal queue, the remembered answers and the class\'s cursor',
           set(moved) <= {'public.submission_file_removal', 'public.fv_idempotency', 'public.course_sync_cursor'}, moved)
        ok("...the student's work and its files are as they were", rows0['public.submission_file'] == rows2['public.submission_file'] and rows0['storage.objects'] == rows2['storage.objects'])
        r9 = d.file(UNDO)
        ok('the undo a second time: runs, changes nothing', r9 == 'ok' and catalog(d.c) == cat0, r9)
        ok('the photo lifecycle\'s post-check says what it said before the file', d.file('photo-lifecycle-live-postcheck.sql') == 'ok' and d.rows == pl0, d.rows)
        d.run('call public.photo_lifecycle_nightly()')
        ok('the nightly job runs on the database the undo leaves', logged(d, 'error') == [], logged(d, 'error'))
        # the undo refuses a function that is not the file's
        ok('the file applies once more', d.file(FILE_USED) == 'ok')
        d.run("create or replace function public.list_course_resources(p_course_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $f$ select '[]'::jsonb $f$")
        r = d.file(UNDO)
        ok('the undo refuses, with nothing dropped, when a function is not as the file leaves it', r.startswith('STOPPED') and 'is not as the file leaves it' in r
           and d.one("select to_regclass('public.assessment_resource') is not null"), r)
    finally:
        d.close()

# ── fingerprints ────────────────────────────────────────────────────────────
def cmd_fingerprints(check_only):
    d0 = HDb('hl_fp0', template=template(False))
    try:
        relied = fps(d0, RELIED); before = fps(d0, REPLACED)
        bodies = '\n'.join(d0.one('select pg_get_functiondef(to_regprocedure(:f))', f=f).rstrip() + ';\n' for f in REPLACED)
        r = d0.statements(split(neutral(text_at(FILE))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        new_ = fps(d0, NEW); becomes = fps(d0, REPLACED)
    finally:
        d0.close()
    lists = {'relied': [(f, relied[f] or 'absent') for f in RELIED],
             'replaces': [(f, before[f] or 'absent', becomes[f] or 'absent') for f in REPLACED],
             'new': [(f, new_[f] or 'absent') for f in NEW]}
    stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel)
        was = open(path).read(); now = write_lists(was, lists)
        if rel == UNDO:
            now = re.sub(r'(-- UNDO-BODIES-BEGIN[^\n]*\n).*?(-- UNDO-BODIES-END)', lambda m: m.group(1) + bodies + m.group(2), now, flags=re.S)
        if now != was:
            stale.append(rel)
            if not check_only: open(path, 'w').write(now)
    if check_only: print('stale: ' + ', '.join(stale) if stale else 'every list is current'); return 1 if stale else 0
    print('rewritten: ' + (', '.join(stale) or 'nothing (every list was current)')); return 0

# ── mutate: wrong versions of the file ──────────────────────────────────────
# Each is the file with one thing taken out or loosened: (what, the text as it is, the text instead).
# A wrong version must be noticed: by a check of the scenarios below failing, or by the file's own last
# step refusing to finish.
MUTANTS = [
    ('the upload rule forgets the handout must still be uploading',
     "and r.status = 'uploading'\n                      and r.created_at >= now() - _work_hold()", "and r.created_at >= now() - _work_hold()"),
    ('the upload rule forgets the two hours',
     "and r.status = 'uploading'\n                      and r.created_at >= now() - _work_hold()", "and r.status = 'uploading'"),
    ('the upload rule forgets the page count',
     "and r.kind = 'pdf' and h.page <= r.page_count\n                      and r.status = 'uploading'", "and r.kind = 'pdf'\n                      and r.status = 'uploading'"),
    ('the read rule forgets whose class it is',
     "where r.course_id = h.course_id and r.kind = 'pdf' and h.page <= r.page_count\n                      and fv_owns_assessment(r.assessment_id));",
     "where r.course_id = h.course_id and r.kind = 'pdf' and h.page <= r.page_count);"),
    ('handout_links forgets the date',
     "and a.course_id = r.course_id\n       and (a.date_assigned is null\n            or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date);", "and a.course_id = r.course_id;"),
    ("handout_links forgets the session's class", "and r.course_id = (_in->>'course_id')::uuid and a.course_id = r.course_id", "and a.course_id = r.course_id"),
    ('handout_links gives a handout still uploading', "where r.id = p_resource_id and r.kind = 'pdf' and r.status = 'ready'", "where r.id = p_resource_id and r.kind = 'pdf'"),
    ('page lists a handout still uploading', "where r.assessment_id = a.id and r.status = 'ready'), '[]'::jsonb))", "where r.assessment_id = a.id), '[]'::jsonb))"),
    ('a removed handout queues nothing', "    if old.kind = 'pdf' then\n        insert into submission_file_removal", "    if false then\n        insert into submission_file_removal"),
    ('the fence is left as Batch B wrote it',
     "alter policy fv_student_photos_fence on storage.objects\n    using (bucket_id is distinct from 'student-photos' or fv_private.work_read_allowed(name) or fv_private.handout_read_allowed(name))\n    with check (bucket_id is distinct from 'student-photos' or fv_private.work_upload_allowed(name) or fv_private.handout_upload_allowed(name));", ""),
    ("the stray check queues a handout's own pages",
     "               -- a page some handout's row still names is not a stray\n               and not exists (select 1 from fv_private.handout_path_parts(o.name) h\n                                 join assessment_resource a on a.id = h.resource_id\n                                where a.course_id = h.course_id and a.kind = 'pdf' and h.page <= a.page_count)\n", ""),
    ('the stray check still reports a handout page as a strange name', "and o.name !~ _layout and o.name !~ _handout;", "and o.name !~ _layout;"),
    ('the stray check queues no handout-shaped stray', "               and o.name ~ _handout\n               -- a page some", "               and false\n               -- a page some"),
    ('the nightly job drops no unfinished upload', "        _gone := _handout_drop_expired(p_course_id);", "        _gone := 0;"),
    ('finish does not look for the pages', "        if _missing <> '[]'::jsonb or _bad <> '[]'::jsonb then", "        if false then"),
    ('Remove forgets whose it is',
     "     where r.id = p_resource_id and fv_owns_assessment(r.assessment_id);\n    if _course is not null then\n        perform _grade_return_lock_first(_course);\n    end if;\n    _cached := fv_idem_check(p_idempotency_key, 'remove_assessment_resource');",
     "     where r.id = p_resource_id;\n    if _course is not null then\n        perform _grade_return_lock_first(_course);\n    end if;\n    _cached := fv_idem_check(p_idempotency_key, 'remove_assessment_resource');"),
    ('start forgets a request it has answered', "    _cached := fv_idem_check(p_idempotency_key, 'start_handout_upload');\n    if _cached is not null then return _cached; end if;\n", ""),
    ('deleting an assessment leaves its handouts', "    perform _grade_return_lock(old.course_id);\n    delete from assessment_resource where assessment_id = old.id;", "    perform _grade_return_lock(old.course_id);"),
    ('TRUNCATE leaves them', "    delete from assessment_resource r\n     where not exists (select 1 from assessment a where a.id = r.assessment_id);\n    return null;", "    return null;"),
    ('an upload out of time is never dropped', "status = 'uploading' and created_at < now() - _work_hold();\n    get diagnostics _n", "status = 'uploading' and created_at < now() - _work_hold() and false;\n    get diagnostics _n"),
    ('a link of any scheme is taken by the function', "_url !~* '^https?://[^[:space:][:cntrl:]/?#]+[^[:space:][:cntrl:]]*$'", "_url !~* '^[a-z]+:'"),
    ("the list gives another teacher's class", "    if not fv_owns_course(p_course_id) then\n        raise exception 'course not found' using errcode = 'P0002';\n    end if;\n    return coalesce((", "    return coalesce(("),
    ('a row may name an assessment of another class', "    if not exists (select 1 from assessment a where a.id = new.assessment_id and a.course_id = new.course_id) then", "    if false then"),
    ('anyone signed in may add to any assessment',
     "    if not fv_owns_assessment(p_assessment_id) then\n        raise exception 'assessment not found' using errcode = 'P0002';\n    end if;\n    if char_length(_url) > 2000", "    if char_length(_url) > 2000"),
    ('the service role is not given handout_links', "grant execute on function student_submit.handout_links(text, uuid, uuid, text) to service_role;", ""),
    ('the anonymous role keeps the right to run the teacher functions',
     "revoke all on function public.add_assessment_link(uuid, text, text, uuid) from public, anon, authenticated, service_role;", ""),
]
MUTANT_SCENARIOS = ['teacher', 'storage', 'student', 'lifecycle', 'deletes']

def cmd_mutate(which):
    import subprocess, tempfile
    text = text_at(FILE); survived = []; n = 0
    for i, (what, was, instead) in enumerate(MUTANTS):
        if which and str(i) not in which: continue
        if text.count(was) != 1: sys.exit('mutant %d (%s): its text is in the file %d times, not once' % (i, what, text.count(was)))
        n += 1
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
            f.write(text.replace(was, instead)); path = f.name
        try:
            r = subprocess.run([sys.executable, os.path.abspath(__file__)] + MUTANT_SCENARIOS, capture_output=True, text=True,
                               env=dict(os.environ, HANDOUTS_LINKS_FILE=path), cwd=HERE)
        finally:
            os.unlink(path)
        fails = [l for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        last = (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[-1]
        # A run that stops on an error it did not expect has noticed too (a step that should work did not).
        stopped = not re.search(r'^\d+ passed, \d+ failed$', last)
        print('%-8s %2d  %s  (%s)' % ('noticed' if fails or stopped else 'SURVIVED', i, what,
                                      ('the run stopped: ' + last[:120]) if stopped else last + ('; first: ' + fails[0][5:120] if fails else '')), flush=True)
        if not fails and not stopped: survived.append(what)
    print('%d wrong versions, %d noticed' % (n, n - len(survived)))
    return 1 if survived else 0

if __name__ == '__main__':
    args = sys.argv[1:]
    try:
        if args[:1] == ['fingerprints']:
            sys.exit(cmd_fingerprints(args[1:] == ['check']))
        if args[:1] == ['mutate']:
            sys.exit(cmd_mutate(args[1:]))
        for n in args or list(SCENARIOS):
            SCENARIOS[n]()
    finally:
        drop_templates()
    finish()
