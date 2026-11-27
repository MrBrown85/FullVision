"""Students' typed work: migrations/2026112702_student_writing.sql on a database rebuilt from the repo and proved equal
to live (scripts/db-rebuild.mjs --check; README.md, "Students' typed work").

    PGPORT=<port> PGDATABASE=<db> python3 student_writing.py fingerprints   write the md5 lists the files carry
    PGPORT=<port> PGDATABASE=<db> python3 student_writing.py                every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 student_writing.py draft send     or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and dropped here.
Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  rule      the writing's rule: every kind of block and mark gives the plain text the header says; 30 kinds of bad
            writing and 14 kinds of bad comment list stop with 22023; the largest writing the rule allows fits.
  draft     writing_save and writing: a first save, a save on top, the repeat of a save, a stale save, delete,
            60,000 characters saved and 60,001 refused with nothing saved, a bad shape, another student, another
            teacher's class, signed out, a piece that takes no work, Send Work off, the hour's limit; a second
            device reads the same draft; a save is not held up by the class's lock; no teacher, visitor or
            signed-in role can read or write the draft tables or call the student functions.
  send      writing_start: writing alone (handed in at once, no pages, the draft gone, the same request again
            changes nothing), a stale or empty draft, writing with photos (uploaded, then finished; the draft
            kept if it changed meanwhile), writing with photos finished with none; the teacher's readers.
  pages     the page rules are unchanged: 0 and 31 pages refused for photos, 31 with writing, a photo send
            finished with no files refused, a photo Replace as before.
  remove    Replace with writing; Unsend (writing back to the draft, a newer draft kept); Unsend where the
            teacher added pages; the teacher's Delete and Replace Them (writing back to the draft).
  revision  Send My Revision with writing; Unsend My Revision (writing back to the draft).
  comments  save_writing_comments and get_submission_writing: save, the key replays, a stale rev, offsets past
            the writing, another teacher; a comment starts grading (no Unsend, no Replace); the student sees
            them only once returned, never with Students See Mark Up off or when Missing; a class that returns
            at once gives them at once; a class switched to return at once gives what was waiting.
  limits    the tables' checks: a direct write past 60,000 characters, a plain text that is not the body's, an
            empty sent writing, a body over 600,000 bytes, a comment list over 300, all refused (23514).
  released  the calls the released edge function makes (send_start, replace, send_finish, revision_start with
            seven arguments, unsend, work) answer the same and leave the same rows with and without the file.
  apply     a second run changes nothing; each guard stops with the catalog unchanged; only what the header
            names changes; the three read-only files; plain ASCII, no backslash.
  undo      PART 0 stops every writing call and leaves photo sends working; the full removal refuses while any
            writing is kept, then leaves the catalog exactly as before the file (every function byte for byte);
            a second run changes nothing; the file again.
"""
import hashlib, json, os, re, secrets, sys, threading, time
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pg8000.native
import card_codes_common as ccc
from card_codes_common import Db, ok, finish, nid, split, text_of, tx, refused, code_tag, key_id, pw_tag, FAKE_KEY, message, sqlstate, KEY_ID
from catalog import catalog, differences

FILE = '../2026112702_student_writing.sql'
UNDO = 'student-writing-undo.sql'
PRE = 'student-writing-live-precheck.sql'
POST = 'student-writing-live-postcheck.sql'
FPS = 'student-writing-live-fingerprints.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
BUCKET = 'student-photos'; HASH = 'a' * 64

RELIED = ['public.fv_owns_course(uuid)', 'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)',
          'public._grade_return_lock_first(uuid)', 'public._grade_return_holds(uuid)', 'public._fv_timezone(text)',
          'public._work_check_pages(jsonb)', 'public._work_check_files(jsonb)', 'public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)',
          'public._work_settle_files(uuid,jsonb)', 'public._work_files_state(uuid,jsonb)',
          'student_submit._send_session(text,uuid)', 'student_submit._session_class(text,uuid)',
          'student_submit._write_limit(uuid,text,integer)', 'student_submit._work_window(uuid)',
          'student_submit._listed(public.assessment,date)',
          'student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',
          'student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)']
PATCHED = ['student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'student_submit.revision_finish(text,uuid,uuid,jsonb,text)',
           'student_submit.unsend(text,uuid,uuid,text)', 'student_submit.revision_unsend(text,uuid,uuid,text)',
           'public.delete_submission(uuid,uuid)', 'public.finish_work_upload(uuid,jsonb,uuid)',
           'public._markup_give(uuid,uuid)', 'public._markup_on_release()', 'student_submit._grading_started(uuid,uuid)',
           'public._submission_json(uuid)', 'student_submit.work(text,uuid,text)']
OLD = ['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
       'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)']
RESIGNED = ['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)',
            'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)']
NEW = RESIGNED + ['public._writing_runs(jsonb)', 'public._writing_plain(jsonb)', 'public._writing_comment_list(jsonb,integer)',
                  'public._writing_take(uuid,uuid,integer)', 'public._writing_attach(uuid,integer)', 'public._writing_draft_done(uuid)',
                  'public._writing_back_to_draft(uuid)', 'public._work_check_send_files(uuid,jsonb)',
                  'student_submit.writing(text,uuid,uuid,text)', 'student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)',
                  'student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)',
                  'public.get_submission_writing(uuid)', 'public.save_writing_comments(uuid,jsonb,integer,uuid)']
STUDENT_ENTRY = ['student_submit.writing(text,uuid,uuid,text)', 'student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)',
                 'student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)']
TEACHER_ENTRY = ['public.get_submission_writing(uuid)', 'public.save_writing_comments(uuid,jsonb,integer,uuid)']
TABLES = ['public.writing_draft', 'public.submission_writing', 'public.writing_comments']

# == 2026112401: the edge function hashes a device's token; verify_card is given the hash of a token it made ==
def _verify(self, code, birthday=None, number=None, password=None, token=None, ip='ip-1', add=False, key=FAKE_KEY):
    new = hashlib.sha256(secrets.token_hex(32).encode()).hexdigest()
    r = self.service('student_submit.verify_card(:h, :k, :b, :n, :p, :t, :i, :a, :s)', h=code_tag(code, key), k=key_id(key),
                     b=birthday, n=number, p=None if password is None else pw_tag(code, password, key), t=token, i=ip, a=add, s=new)
    if isinstance(r, dict) and r.get('ok'):
        r = dict(r, session_token=new if r.get('new_session') else token)
    return r
ccc.Db.verify = _verify

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def S(d, sql, **kw): return d.service(sql, **kw)
def applied(d): return d.one("select to_regprocedure('student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)') is not null")
def q(s): return "'" + s.replace("'", "''") + "'"
def tup(*v): return '(' + ', '.join(q(x) for x in v) + ')'
def put_list(text, name, rows):
    """Every list of that name in the text (the undo carries some twice) gets these rows."""
    pat = re.compile(r'(-- FINGERPRINTS-BEGIN %s\n)(.*?)([ \t]*-- FINGERPRINTS-END)' % re.escape(name), re.S)
    if not pat.search(text): sys.exit('no list %s' % name)
    def one(m):
        indent = re.match(r'[ \t]*', m.group(3)).group(0)
        return m.group(1) + ',\n'.join(indent + r for r in rows) + '\n' + m.group(3)
    return pat.sub(one, text)
def copy_edits(migration, undo):
    """The undo's edits are the file's, copied whole."""
    a = migration.index('  _edits text[][] := array['); b = migration.index('  _fn    text;', a)
    x = undo.index('  -- EDITS-BEGIN\n') + len('  -- EDITS-BEGIN\n'); y = undo.index('  -- EDITS-END')
    return undo[:x] + migration[a:b] + undo[y:]
def without_last_check(text):
    a = text.index('do $lastcheck$'); b = text.index('$lastcheck$;', a + 15) + len('$lastcheck$;')
    return text[:a] + text[b:]

# == Writing ==
def para(*runs, t='p'): return {'t': t, 'c': [r if isinstance(r, dict) else {'x': r} for r in runs]}
def doc(*blocks): return {'v': 1, 'blocks': list(blocks)}
def words(s): return doc(para(s))
def J(x): return json.dumps(x)

# == The world ==
class W: pass

def world(tag, with_file=True, template=None):
    """Teacher A: Science 8 (student page and Send Work on; Cece, Dev and Eli with cards): Essay (takes photos),
    Lab (photos and files), Quiz Day (takes nothing). Teacher B: Bravo 10 (Bea with a card): B Essay."""
    d = Db('sw_' + tag, template)
    w = W(); w.d = d
    if applied(d):
        r = d.file(UNDO)
        if r != 'ok' or applied(d): sys.exit('could not take the template back to before the file: %s' % r)
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    d.run("insert into student_submit.card_key (one, key_id) values (true, :k)", k=KEY_ID)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    def course(name, uid=A):
        return str(T(d, "create_course(p_name => :n, p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())", uid, n=name))
    def enrol(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_date_of_birth => date '2012-05-15', p_idempotency_key => gen_random_uuid())",
                     uid, c=c, f=first)['enrollment_id'])
    def piece(c, title, sends, uid=A):
        a = str(T(d, "create_assessment(:c, :t)", uid, c=c, t=title))
        d.run('update assessment set students_send = :s where id = :a', s=sends, a=a)
        return a
    w.c = course('Science 8'); w.cb = course('Bravo 10', B)
    d.run("update course set student_page_enabled = true, send_work = true where id = any (:ids)", ids=[w.c, w.cb])
    w.cece, w.dev, w.eli = (enrol(w.c, n) for n in ('Cece', 'Dev', 'Eli'))
    w.bea = enrol(w.cb, 'Bea', B)
    w.card = {}; w.tok = {}
    for e, c, uid in ((w.cece, w.c, A), (w.dev, w.c, A), (w.eli, w.c, A), (w.bea, w.cb, B)):
        code, _pw, _row = d.make(e, c, uid)
        w.card[e] = code
        w.tok[e] = sign_in(d, code)
    w.a = piece(w.c, 'Essay', 'photos')
    w.lab = piece(w.c, 'Lab', 'photos_files')
    w.none = piece(w.c, 'Quiz Day', 'nothing')
    w.ab = piece(w.cb, 'B Essay', 'photos', B)
    if with_file:
        r = d.file(FILE); ok('(setup %s) the file applies' % tag, r == 'ok', r)
    return w

def sign_in(d, code):
    r = d.verify(code, birthday='2012-05-15'); assert r['ok'], r
    return r['session_token']

# == The student's calls, as the edge function makes them ==
def SAVE(w, body, base, e=None, a=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.writing_save(:t, :e, :a, :b::text::jsonb, :r, 'ip')", t=tok or w.tok[e], e=e, a=a or w.a,
             b=None if body is None else J(body), r=base)
def READ(w, e=None, a=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.writing(:t, :e, :a, 'ip')", t=tok or w.tok[e], e=e, a=a or w.a)
def START(w, rev, pages=0, intent='new', e=None, a=None, req=None, note=None, tok=None):
    e = e or w.cece
    return S(w.d, "student_submit.writing_start(:t, :e, :a, :i, :p::text::jsonb, :r, :n, null, :q, 'ip')", t=tok or w.tok[e], e=e,
             a=a or w.a, i=intent, p=J([{'width': 1500, 'height': 2000}] * pages), r=rev, n=note, q=req or nid())
def PHOTOS(w, pages=1, e=None, a=None, req=None, route='send_start'):
    e = e or w.cece
    return S(w.d, "student_submit.%s(:t, :e, :a, :p::text::jsonb, null, null, :q, 'ip')" % route, t=w.tok[e], e=e, a=a or w.a,
             p=J([{'width': 1500, 'height': 2000}] * pages), q=req or nid())
def UPLOAD(w, files):
    for f in files:
        for p in (f['path'], f['thumb_path']):
            w.d.run("insert into storage.objects (bucket_id, name, metadata) values (:b, :n, jsonb_build_object('size', 300000, 'mimetype', 'image/jpeg'))",
                    b=BUCKET, n=p)
def FINISH(w, sub, files, e=None, route='send_finish'):
    e = e or w.cece
    return S(w.d, "student_submit.%s(:t, :e, :s, :f::text::jsonb, 'ip')" % route, t=w.tok[e], e=e, s=sub,
             f=J([{'file_id': f['file_id'], 'sha256': HASH} for f in files]))
def WORK(w, e=None):
    e = e or w.cece
    r = S(w.d, "student_submit.work(:t, :e, 'ip')", t=w.tok[e], e=e)
    return {x['id']: x for x in r['assessments']}
def UNSEND(w, e=None, a=None, route='unsend'):
    e = e or w.cece
    return S(w.d, "student_submit.%s(:t, :e, :a, 'ip')" % route, t=w.tok[e], e=e, a=a or w.a)
def draft_row(w, e=None, a=None):
    r = w.d.all('select rev, chars, body::text from writing_draft where enrollment_id = :e and assessment_id = :a', e=e or w.cece, a=a or w.a)
    return (r[0][0], r[0][1], json.loads(r[0][2])) if r else None
def sent_rows(w, e=None, a=None):
    return w.d.all("select s.id, s.version, (select count(*) from submission_file f where f.submission_id = s.id), w.body::text "
                   "from submission s left join submission_writing w on w.submission_id = s.id "
                   "where s.enrollment_id = :e and s.assessment_id = :a and s.state = 'sent' order by s.version", e=e or w.cece, a=a or w.a)
def err(fn):
    """(message, SQLSTATE) of what fn raises, or None."""
    try:
        fn(); return None
    except Exception as e:
        return (message(e), sqlstate(e))

# == rule ==
def scen_rule():
    w = world('rule'); d = w.d
    def plain(b): return d.one('select public._writing_plain(:b::text::jsonb)', b=J(b))
    def bad(b): return err(lambda: plain(b))
    full = doc(para('Title', t='h1'), para('Part', t='h2'),
               para('Plain ', {'x': 'bold', 'b': True}, ' ', {'x': 'it', 'i': True, 'u': True}, ' ', {'x': 'link', 'a': 'https://example.ca/x?y=1'}),
               {'t': 'ul', 'items': [{'c': [{'x': 'one'}]}, {'c': [{'x': 'two'}], 'lvl': 1}]},
               {'t': 'ol', 'items': [{'c': [{'x': 'first'}], 'lvl': 0}]},
               {'t': 'table', 'rows': [[{'c': [{'x': 'a'}]}, {'c': []}], [{'c': [{'x': 'c'}]}, {'c': [{'x': 'd', 'b': True}]}]]},
               para())
    ok('rule: every kind of block and mark gives the plain text the header says',
       plain(full) == 'Title\nPart\nPlain bold it link\none\ntwo\nfirst\na\t\nc\td\n', repr(plain(full)))
    ok('rule: an empty writing is the empty text', plain(doc()) == '')
    ok('rule: a character outside the BMP counts once', d.one("select length(public._writing_plain(:b::text::jsonb))", b=J(words('a' + chr(0x1F600) + 'b'))) == 3)
    ok('rule: mailto: is an address', plain(doc(para({'x': 'mail', 'a': 'mailto:a@b.ca'}))) == 'mail')
    bads = {
        'not an object': [], 'v 2': {'v': 2, 'blocks': []}, 'no blocks': {'v': 1}, 'an extra key': {'v': 1, 'blocks': [], 'html': '<b>'},
        'blocks not a list': {'v': 1, 'blocks': {}}, '5001 blocks': {'v': 1, 'blocks': [para()] * 5001},
        'an unknown block': doc({'t': 'img', 'c': []}), 'a block with html': doc({'t': 'p', 'c': [], 'html': 'x'}),
        'a block not an object': doc('text'), 'a run not an object': doc({'t': 'p', 'c': ['text']}),
        'x a number': doc({'t': 'p', 'c': [{'x': 5}]}), 'an empty run': doc(para({'x': ''})),
        'b false': doc(para({'x': 'a', 'b': False})), 'i "yes"': doc(para({'x': 'a', 'i': 'yes'})),
        'a colour': doc(para({'x': 'a', 'color': 'red'})), 'a font size': doc(para({'x': 'a', 'size': 12})),
        'a tab': doc(para('a\tb')), 'a line break': doc(para('a\nb')), 'a carriage return': doc(para('a\rb')),
        'a control character': doc(para('a' + chr(7) + 'b')), 'javascript: link': doc(para({'x': 'a', 'a': 'javascript:alert(1)'})),
        'a link with a space': doc(para({'x': 'a', 'a': 'https://a.ca/x y'})), 'a link not text': doc(para({'x': 'a', 'a': True})),
        'a list with no items': doc({'t': 'ul', 'items': []}), 'lvl 4': doc({'t': 'ul', 'items': [{'c': [], 'lvl': 4}]}),
        'lvl 1.0': doc({'t': 'ol', 'items': [{'c': [], 'lvl': 1.0}]}), 'lvl "1"': doc({'t': 'ol', 'items': [{'c': [], 'lvl': '1'}]}),
        'a ragged table': doc({'t': 'table', 'rows': [[{'c': []}, {'c': []}], [{'c': []}]]}),
        '101 rows': doc({'t': 'table', 'rows': [[{'c': []}]] * 101}), '21 cells': doc({'t': 'table', 'rows': [[{'c': []}] * 21]}),
        'a cell with a key': doc({'t': 'table', 'rows': [[{'c': [], 'span': 2}]]}), 'a nested table': doc({'t': 'table', 'rows': [[{'t': 'table'}]]}),
    }
    for name, b in bads.items():
        r = bad(b)
        ok('rule: %s is refused with 22023' % name, r is not None and r[1] == '22023', r)
    # the largest: 60,000 characters in 5,000 blocks
    big = {'v': 1, 'blocks': [para({'x': 'w' * 11, 'b': True}) for _ in range(5000)]}
    t0 = time.time(); n = d.one('select length(public._writing_plain(:b::text::jsonb))', b=J(big)); t1 = time.time()
    ok('rule: 5,000 blocks of 11 characters is 59,999 characters of plain text', n == 59999, n)
    ok('rule: reading the largest writing takes under a second (%.0f ms)' % ((t1 - t0) * 1000), t1 - t0 < 1.0)
    # comments
    def cl(c, n=20): return d.one('select public._writing_comment_list(:c::text::jsonb, :n)', c=J(c), n=n)
    got = cl([{'id': 'b', 'start': 5, 'end': 9, 'text': '  Good point.\n'}, {'id': 'a', 'start': 0, 'end': 3, 'text': 'Strong start'}])
    ok('comments: trimmed and sorted by start', got == [{'id': 'a', 'start': 0, 'end': 3, 'text': 'Strong start'}, {'id': 'b', 'start': 5, 'end': 9, 'text': 'Good point.'}], got)
    ok('comments: the end may be the last character', cl([{'id': 'a', 'start': 19, 'end': 20, 'text': 'x'}]) is not None)
    cbad = {'not a list': {}, '301 comments': [{'id': str(i), 'start': 0, 'end': 1, 'text': 'x'} for i in range(301)],
            'start at end': [{'id': 'a', 'start': 3, 'end': 3, 'text': 'x'}], 'past the writing': [{'id': 'a', 'start': 3, 'end': 21, 'text': 'x'}],
            'a negative start': [{'id': 'a', 'start': -1, 'end': 2, 'text': 'x'}], 'a start of 1.5': [{'id': 'a', 'start': 1.5, 'end': 2, 'text': 'x'}],
            'a start as text': [{'id': 'a', 'start': '1', 'end': 2, 'text': 'x'}], 'no text': [{'id': 'a', 'start': 0, 'end': 2}],
            'only spaces': [{'id': 'a', 'start': 0, 'end': 2, 'text': '   '}], '1001 characters': [{'id': 'a', 'start': 0, 'end': 2, 'text': 'x' * 1001}],
            'an extra key': [{'id': 'a', 'start': 0, 'end': 2, 'text': 'x', 'quote': 'y'}], 'the same id twice': [{'id': 'a', 'start': 0, 'end': 2, 'text': 'x'}, {'id': 'a', 'start': 3, 'end': 4, 'text': 'y'}],
            'an id of 65': [{'id': 'a' * 65, 'start': 0, 'end': 2, 'text': 'x'}], 'an empty id': [{'id': '', 'start': 0, 'end': 2, 'text': 'x'}]}
    for name, c in cbad.items():
        r = err(lambda: cl(c))
        ok('comments: %s is refused with 22023' % name, r is not None and r[1] == '22023', r)
    d.close()

# == draft ==
def scen_draft():
    w = world('draft'); d = w.d
    one = words('A first line.')
    r = SAVE(w, one, 0)
    ok('draft: a first save is rev 1', r['ok'] and r['rev'] == 1 and r['chars'] == 13 and not r['replayed'], r)
    r = READ(w)
    ok('draft: it reads back as saved', r['ok'] and r['draft']['body'] == one and r['draft']['rev'] == 1 and r['sent'] == [], r)
    two = doc(para('A first line.'), para({'x': 'Second', 'b': True}))
    r = SAVE(w, two, 1)
    ok('draft: a save on top is rev 2', r['ok'] and r['rev'] == 2, r)
    r = SAVE(w, two, 1)
    ok('draft: the same save again is answered as saved, nothing changed', r['ok'] and r['replayed'] and r['rev'] == 2 and draft_row(w)[0] == 2, r)
    r = SAVE(w, words('older device'), 1)
    ok('draft: a save from a stale rev is "changed" with the draft as it is', not r['ok'] and r['error'] == 'changed' and r['draft']['body'] == two and r['draft']['rev'] == 2, r)
    ok('draft: and nothing was saved', draft_row(w)[2] == two)
    r = SAVE(w, words('x'), 0)
    ok('draft: a first save when a draft exists is "changed"', not r['ok'] and r['error'] == 'changed' and r['draft']['rev'] == 2, r)
    tok2 = sign_in(d, w.card[w.cece])
    ok('draft: a second device signed in with the card reads the same draft', READ(w, tok=tok2)['draft']['body'] == two)
    r = SAVE(w, words('from the second device'), 2, tok=tok2)
    ok('draft: and saves on top of it', r['ok'] and r['rev'] == 3, r)
    r = SAVE(w, None, 3)
    ok('draft: a null body deletes the draft', r['ok'] and r['deleted'] and draft_row(w) is None, r)
    ok('draft: deleted, it reads as none', READ(w)['draft'] is None)
    r = SAVE(w, None, 0)
    ok('draft: deleting no draft is fine', r['ok'] and r['deleted'], r)
    # length
    r = SAVE(w, words('x' * 60000), 0)
    ok('draft: 60,000 characters save', r['ok'] and r['chars'] == 60000, r)
    r = SAVE(w, doc(para('x' * 30000), para('x' * 30000)), 1)
    ok('draft: 60,001 (two paragraphs and a line break) is "too_long"', not r['ok'] and r['error'] == 'too_long' and r['chars'] == 60001 and r['max'] == 60000, r)
    ok('draft: and nothing was saved', draft_row(w)[0] == 1 and draft_row(w)[1] == 60000)
    many = {'v': 1, 'blocks': [para(*([{'x': 'a', 'b': True, 'i': True, 'u': True, 'a': 'https://' + 'e' * 120 + '.ca'}] * 20)) for _ in range(250)]}
    r = SAVE(w, many, 1)
    ok('draft: over 600,000 bytes is "too_long"', not r['ok'] and r['error'] == 'too_long', r)
    r = err(lambda: SAVE(w, {'v': 1, 'blocks': [{'t': 'p', 'c': [{'x': '<b>hi</b>', 'style': 'x'}]}]}, 1))
    ok('draft: a shape the rule refuses raises 22023 (the edge function cleans a paste first)', r is not None and r[1] == '22023', r)
    r = err(lambda: SAVE(w, one, -1))
    ok('draft: a negative base_rev raises 22023', r is not None and r[1] == '22023', r)
    # whose
    r = SAVE(w, one, 0, e=w.cece, tok=w.tok[w.dev])
    ok("draft: Dev's session cannot save Cece's draft", not r['ok'] and r['error'] == 'not_found', r)
    r = READ(w, e=w.cece, tok=w.tok[w.dev])
    ok("draft: nor read it", not r['ok'] and r['error'] == 'not_found', r)
    ok("draft: Dev's own draft is empty", READ(w, e=w.dev)['draft'] is None)
    r = SAVE(w, one, 0, e=w.bea, a=w.a)
    ok("draft: a student of Teacher B's class cannot save for Teacher A's piece", not r['ok'] and r['error'] == 'not_found', r)
    r = SAVE(w, one, 0, tok='0' * 64)
    ok('draft: a session that is not one is signed_out', not r['ok'] and r['error'] == 'signed_out', r)
    r = SAVE(w, one, 0, a=w.none)
    ok('draft: a piece that takes no work is refused', not r['ok'] and r['error'] == 'not_taking_work', r)
    r = SAVE(w, one, 0, a=w.lab)
    ok('draft: a piece that takes photos and files takes writing', r['ok'], r)
    d.run('update course set send_work = false where id = :c', c=w.c)
    r = SAVE(w, one, 1, a=w.lab)
    ok('draft: with Send Work off, send_off', not r['ok'] and r['error'] == 'send_off', r)
    d.run('update course set send_work = true where id = :c', c=w.c)
    d.run("update assessment set is_draft = true where id = :a", a=w.lab)
    r = SAVE(w, one, 1, a=w.lab)
    ok('draft: a piece not on the student page (a Draft) is not_found', not r['ok'] and r['error'] == 'not_found', r)
    d.run("update assessment set is_draft = false where id = :a", a=w.lab)
    # the hour's limit
    card = d.one('select card_id from student_submit.device_session_enrollment where enrollment_id = :e limit 1', e=w.eli)
    d.run("insert into student_submit.write_log (card_id, kind) select :c, 'writing' from generate_series(1, 900)", c=card)
    r = SAVE(w, one, 0, e=w.eli)
    ok('draft: the 901st save in an hour is too_many, nothing saved', not r['ok'] and r['error'] == 'too_many' and r['retry_after_s'] >= 1
       and draft_row(w, e=w.eli) is None, r)
    # no class lock
    other = d.other()
    other.run('begin'); other.run('select public._grade_return_lock_first(:c)', c=w.c)
    t0 = time.time(); r = SAVE(w, words('while the teacher grades'), 0, e=w.dev); t1 = time.time()
    other.run('rollback'); other.close()
    ok('draft: a save goes through while the class is locked for a grade (%.0f ms)' % ((t1 - t0) * 1000), r['ok'] and t1 - t0 < 1, r)
    # nobody else
    for role, uid in (('authenticated', A), ('anon', None), ('service_role', None)):
        for t in TABLES:
            r = err(lambda: d.role(role, 'select count(*) from %s' % t, uid))
            ok('draft: %s cannot read %s' % (role, t), r is not None and r[1] == '42501', r)
    for role, uid in (('authenticated', A), ('anon', None)):
        r = err(lambda: d.role(role, "select student_submit.writing_save(:t, :e, :a, '{\"v\":1,\"blocks\":[]}'::jsonb, 0, 'ip')", uid, t=w.tok[w.cece], e=w.cece, a=w.a))
        ok('draft: %s cannot call writing_save' % role, r is not None and r[1] == '42501', r)
    names = d.all("select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                  "where n.nspname = 'public' and p.prokind in ('f', 'p') and pg_get_functiondef(p.oid) like '%writing_draft%' "
                  "and has_function_privilege('authenticated', p.oid, 'execute') order by 1")
    ok('draft: no function a teacher may call reads or writes writing_draft', names == [], names)
    d.close()

# == send ==
def scen_send():
    w = world('send'); d = w.d
    body = doc(para('My essay', t='h1'), para('It begins here.'))
    rev = SAVE(w, body, 0)['rev']
    r = START(w, rev + 1)
    ok('send: a stale draft rev is draft_changed', not r['ok'] and r['error'] == 'draft_changed' and r['rev'] == rev, r)
    req = nid()
    r = START(w, rev, req=req)
    ok('send: writing alone is handed in at once', r['ok'] and r['state'] == 'sent' and r['pages'] == 0 and r['files'] == [] and not r['replayed'], r)
    rows = sent_rows(w)
    ok('send: one sent submission, no pages, the writing on it', len(rows) == 1 and rows[0][2] == 0 and json.loads(rows[0][3]) == body, rows)
    ok('send: the draft is gone', draft_row(w) is None)
    r = START(w, rev, req=req)
    ok('send: the same request again is answered as sent, nothing new', r['ok'] and r['replayed'] and len(sent_rows(w)) == 1, r)
    wk = WORK(w)[w.a]
    ok("send: work() shows the writing's length and no draft", wk['sent']['writing'] == 23 and wk['sent']['pages'] == 0 and wk['draft'] is None, wk)
    r = READ(w)
    ok('send: writing() has the writing sent, no comments yet', r['sent'][0]['body'] == body and r['sent'][0]['comments'] == [] and r['draft'] is None, r)
    sub = rows[0][0]
    g = T(d, 'get_submission_writing(:s)', s=sub)
    ok("send: the class's teacher reads it", g['body'] == body and g['chars'] == 23 and g['comments'] == [] and g['rev'] == 0, g)
    r = err(lambda: T(d, 'get_submission_writing(:s)', B, s=sub))
    ok('send: another teacher is refused (P0002)', r is not None and r[1] == 'P0002', r)
    lst = T(d, 'list_course_submissions(:c)', c=w.c)
    mine = [s for s in lst['submissions'] if s['id'] == sub][0]
    ok('send: the class list carries the writing\'s length and its start', mine['writing'] == {'chars': 23, 'start': 'My essay\nIt begins here.'} and mine['files'] == [], mine)
    # empty and missing drafts
    r = SAVE(w, doc(), 0, e=w.dev)
    r = START(w, r['rev'], e=w.dev)
    ok('send: an empty draft is no_writing, nothing made', not r['ok'] and r['error'] == 'no_writing' and sent_rows(w, e=w.dev) == [], r)
    r = START(w, 5, e=w.eli)
    ok('send: no draft at all is draft_changed', not r['ok'] and r['error'] == 'draft_changed' and r['rev'] is None, r)
    r = START(w, 1, a=w.none, e=w.eli)
    ok('send: a piece that takes no work is refused', not r['ok'] and r['error'] == 'not_taking_work', r)
    # writing with photos
    lab = words('Results: it grew.')
    rev = SAVE(w, lab, 0, a=w.lab)['rev']
    r = START(w, rev, pages=2, a=w.lab)
    ok('send: writing with two photos starts a send with two uploads', r['ok'] and r['state'] == 'sending' and len(r['files']) == 2, r)
    files = r['files']; sid = r['submission_id']
    ok('send: the draft stays until it is handed in', draft_row(w, a=w.lab) is not None)
    r2 = FINISH(w, sid, files)
    ok('send: finished before the photos are up: missing_pages', not r2['ok'] and r2['error'] == 'missing_pages', r2)
    UPLOAD(w, files)
    r2 = FINISH(w, sid, files)
    ok('send: finished with both: two pages and the writing', r2['ok'] and r2['pages'] == 2, r2)
    rows = sent_rows(w, a=w.lab)
    ok('send: on one submission', len(rows) == 1 and rows[0][2] == 2 and json.loads(rows[0][3]) == lab, rows)
    ok('send: the draft is gone', draft_row(w, a=w.lab) is None)
    # changed while the photos went up
    rev = SAVE(w, words('Version one'), 0, e=w.dev, a=w.lab)['rev']
    r = START(w, rev, pages=1, e=w.dev, a=w.lab)
    SAVE(w, words('Version two, typed during the upload'), rev, e=w.dev, a=w.lab)
    UPLOAD(w, r['files'])
    r2 = FINISH(w, r['submission_id'], r['files'], e=w.dev)
    rows = sent_rows(w, e=w.dev, a=w.lab)
    ok('send: what was sent is the draft at the start', r2['ok'] and json.loads(rows[0][3]) == words('Version one'), (r2, rows))
    ok('send: and the newer draft is kept', draft_row(w, e=w.dev, a=w.lab)[2] == words('Version two, typed during the upload'))
    # writing with photos, finished with none
    rev = SAVE(w, words('Only words in the end'), 0, e=w.eli, a=w.lab)['rev']
    r = START(w, rev, pages=1, e=w.eli, a=w.lab)
    r2 = FINISH(w, r['submission_id'], [], e=w.eli)
    rows = sent_rows(w, e=w.eli, a=w.lab)
    ok('send: finished with no photos, the writing alone is handed in', r2['ok'] and r2['pages'] == 0 and rows[0][2] == 0 and rows[0][3] is not None, (r2, rows))
    # the hour's sends
    card = d.one('select card_id from student_submit.device_session_enrollment where enrollment_id = :e limit 1', e=w.eli)
    d.run("insert into student_submit.send_log (card_id) select :c from generate_series(1, 20)", c=card)
    rev = SAVE(w, words('again'), 0, e=w.eli)['rev']
    r = START(w, rev, e=w.eli)
    ok('send: the 21st send in an hour is too_many, as for photos', not r['ok'] and r['error'] == 'too_many', r)
    d.close()

# == pages ==
def scen_pages():
    w = world('pages'); d = w.d
    for n in (0, 31):
        r = err(lambda: PHOTOS(w, pages=n))
        ok('pages: %d photos without writing raise 22023 as before' % n, r is not None and r[1] == '22023' and 'between 1 and 30 pages' in r[0], r)
    rev = SAVE(w, words('x'), 0)['rev']
    r = err(lambda: START(w, rev, pages=31))
    ok('pages: 31 photos with writing raise 22023', r is not None and r[1] == '22023' and 'between 1 and 30 pages' in r[0], r)
    r = PHOTOS(w, pages=1, e=w.dev)
    UPLOAD(w, r['files'])
    e = err(lambda: FINISH(w, r['submission_id'], [], e=w.dev))
    ok('pages: a photo send finished with no files raises 22023 as before', e is not None and e[1] == '22023' and 'between 1 and 30 files' in e[0], e)
    f = FINISH(w, r['submission_id'], r['files'], e=w.dev)
    ok('pages: and with its file, it is handed in', f['ok'] and f['pages'] == 1, f)
    r = PHOTOS(w, pages=2, e=w.dev, route='replace')
    UPLOAD(w, r['files'])
    f = FINISH(w, r['submission_id'], r['files'], e=w.dev)
    rows = sent_rows(w, e=w.dev)
    ok('pages: a photo Replace works as before', f['ok'] and len(rows) == 1 and rows[0][2] == 2 and rows[0][3] is None, (f, rows))
    r = err(lambda: START(w, rev, intent='add'))
    ok('pages: an intent other than new, replace or revision raises 22023', r is not None and r[1] == '22023', r)
    d.close()

# == remove ==
def send_words(w, text, e=None, a=None, intent='new'):
    e = e or w.cece; a = a or w.a
    cur = draft_row(w, e, a)
    rev = SAVE(w, words(text), cur[0] if cur else 0, e=e, a=a)['rev']
    r = START(w, rev, e=e, a=a, intent=intent)
    assert r['ok'], r
    return r['submission_id']

def scen_remove():
    w = world('remove'); d = w.d
    send_words(w, 'First go')
    r = START(w, SAVE(w, words('Second go'), 0)['rev'], intent='replace')
    rows = sent_rows(w)
    ok('remove: Replace with writing: one sent submission, the new writing', r['ok'] and len(rows) == 1 and json.loads(rows[0][3]) == words('Second go'), (r, rows))
    ok('remove: and no draft left behind', draft_row(w) is None)
    r = UNSEND(w)
    ok('remove: Unsend', r['ok'] and r['unsent'] and r['pages'] == 0, r)
    ok('remove: nothing is sent', sent_rows(w) == [])
    ok('remove: the writing is the draft again, rev 1', draft_row(w)[:2] == (1, 9) and draft_row(w)[2] == words('Second go'), draft_row(w))
    # a newer draft is kept
    send_words(w, 'Sent text', e=w.dev)
    SAVE(w, words('Newer draft'), 0, e=w.dev)
    UNSEND(w, e=w.dev)
    ok('remove: Unsend with a newer draft keeps the newer draft', draft_row(w, e=w.dev)[2] == words('Newer draft'))
    # the teacher added pages
    sub = send_words(w, 'With teacher pages', e=w.eli)
    s = T(d, "start_work_upload(:a, :e, :p::text::jsonb, 'add', gen_random_uuid())", a=w.a, e=w.eli, p=J([{'width': 100, 'height': 100}]))
    UPLOAD(w, s['files'])
    T(d, "finish_work_upload(:s, :f::text::jsonb, gen_random_uuid())", s=s['submission_id'], f=J([{'file_id': x['file_id'], 'sha256': HASH} for x in s['files']]))
    r = UNSEND(w, e=w.eli)
    rows = sent_rows(w, e=w.eli)
    ok("remove: Unsend where the teacher added a page: the work stays the teacher's, without the writing",
       r['ok'] and r['kept'] == 1 and len(rows) == 1 and rows[0][2] == 1 and rows[0][3] is None
       and d.one('select sent_by from submission where id = :s', s=rows[0][0]) == 'teacher', (r, rows))
    ok('remove: and the writing is the draft again', draft_row(w, e=w.eli)[2] == words('With teacher pages'))
    # the teacher's Delete
    d.run('delete from writing_draft')
    sub = send_words(w, 'Deleted by the teacher')
    r = T(d, 'delete_submission(:s, gen_random_uuid())', s=sub)
    ok("remove: the teacher's Delete removes the work", r['deleted'] and sent_rows(w) == [], r)
    ok("remove: and puts the writing back as the student's draft", draft_row(w)[2] == words('Deleted by the teacher'))
    r = T(d, 'delete_submission(:s, gen_random_uuid())', B, s=sent_rows(w, e=w.eli)[0][0])
    ok("remove: another teacher's Delete does nothing", not r['deleted'] and len(sent_rows(w, e=w.eli)) == 1, r)
    # the teacher's Replace Them
    d.run('delete from writing_draft')
    send_words(w, 'Replaced by a scan', e=w.dev)
    s = T(d, "start_work_upload(:a, :e, :p::text::jsonb, 'replace', gen_random_uuid())", a=w.a, e=w.dev, p=J([{'width': 100, 'height': 100}]))
    UPLOAD(w, s['files'])
    T(d, "finish_work_upload(:s, :f::text::jsonb, gen_random_uuid())", s=s['submission_id'], f=J([{'file_id': x['file_id'], 'sha256': HASH} for x in s['files']]))
    rows = sent_rows(w, e=w.dev)
    ok("remove: the teacher's Replace Them: the scan is the work", len(rows) == 1 and rows[0][2] == 1 and rows[0][3] is None, rows)
    ok("remove: and the writing is the student's draft", draft_row(w, e=w.dev)[2] == words('Replaced by a scan'))
    d.close()

# == revision ==
def scen_revision():
    w = world('revision'); d = w.d
    send_words(w, 'Version one')
    T(d, "return_for_revision(:a, :e, '{\"what_to_fix\": \"Add a conclusion.\"}'::jsonb, gen_random_uuid())", a=w.a, e=w.cece)
    rev = SAVE(w, words('Version two, with a conclusion.'), 0)['rev']
    r = START(w, rev, intent='revision')
    ok('revision: Send My Revision with writing is handed in at once as version 2', r['ok'] and r['version'] == 2 and r['state'] == 'sent', r)
    rows = sent_rows(w)
    ok('revision: both versions are kept, each with its writing', [x[1] for x in rows] == [1, 2] and json.loads(rows[1][3]) == words('Version two, with a conclusion.'), rows)
    rd = READ(w)
    ok('revision: writing() lists them newest first', [x['version'] for x in rd['sent']] == [2, 1], rd)
    r = UNSEND(w, route='revision_unsend')
    ok('revision: Unsend My Revision', r['ok'] and r['unsent'], r)
    ok('revision: version 1 stays; the revision is the draft again', [x[1] for x in sent_rows(w)] == [1] and draft_row(w)[2] == words('Version two, with a conclusion.'))
    d.close()

# == comments ==
def scen_comments():
    w = world('comments'); d = w.d
    sub = send_words(w, 'The cell is the unit of life.')
    cm = [{'id': 'c1', 'start': 4, 'end': 8, 'text': 'Which cell?'}]
    r = T(d, 'save_writing_comments(:s, :c::text::jsonb, 0, :k)', s=sub, c=J(cm), k='aaaaaaaa-0000-4000-8000-000000000001')
    ok('comments: saved, rev 1, waiting for Return', r['result'] == 'saved' and r['rev'] == 1 and r['waiting'], r)
    r2 = T(d, 'save_writing_comments(:s, :c::text::jsonb, 0, :k)', s=sub, c=J(cm + cm), k='aaaaaaaa-0000-4000-8000-000000000001')
    ok('comments: the same key again replays the first answer', r2 == r, r2)
    r = T(d, 'save_writing_comments(:s, :c::text::jsonb, 0, gen_random_uuid())', s=sub, c=J([]))
    ok('comments: a stale base_rev is "changed", nothing saved', r['result'] == 'changed' and r['rev'] == 1 and r['comments'] == cm, r)
    e = err(lambda: T(d, 'save_writing_comments(:s, :c::text::jsonb, 1, gen_random_uuid())', s=sub, c=J([{'id': 'x', 'start': 0, 'end': 99, 'text': 'x'}])))
    ok('comments: a comment past the writing raises 22023', e is not None and e[1] == '22023', e)
    e = err(lambda: T(d, 'save_writing_comments(:s, :c::text::jsonb, 1, gen_random_uuid())', B, s=sub, c=J([])))
    ok('comments: another teacher is refused (P0002)', e is not None and e[1] == 'P0002', e)
    g = T(d, 'get_submission_writing(:s)', s=sub)
    ok('comments: the teacher reads the working comments', g['comments'] == cm and g['rev'] == 1 and g['waiting'], g)
    ok('comments: a comment means grading has started: no Unsend', UNSEND(w).get('error') == 'grading_started')
    r = START(w, SAVE(w, words('try to replace'), 0)['rev'], intent='replace')
    ok('comments: and no Replace', not r['ok'] and r['error'] == 'grading_started', r)
    ok('comments: not returned, the student sees none', READ(w)['sent'][0]['comments'] == [])
    T(d, 'return_work(:a, cast(:e as uuid[]), gen_random_uuid())', a=w.a, e=[w.cece])
    ok('comments: returned, the student sees them', READ(w)['sent'][0]['comments'] == [{'start': 4, 'end': 8, 'text': 'Which cell?'}], READ(w))
    T(d, 'save_writing_comments(:s, :c::text::jsonb, 1, gen_random_uuid())', s=sub, c=J(cm + [{'id': 'c2', 'start': 0, 'end': 3, 'text': 'Good.'}]))
    ok('comments: a comment added after Return waits for the next Return', len(READ(w)['sent'][0]['comments']) == 1)
    d.run('update assessment set students_see_markup = false where id = :a', a=w.a)
    ok('comments: with Students See Mark Up off, none', READ(w)['sent'][0]['comments'] == [])
    d.run('update assessment set students_see_markup = true where id = :a', a=w.a)
    T(d, "set_score_status(:e, :a, 'NS')", e=w.cece, a=w.a)
    ok('comments: marked Missing, none', READ(w)['sent'][0]['comments'] == [])
    T(d, "set_score_status(:e, :a, null)", e=w.cece, a=w.a)
    # a class that returns at once
    d.run("update course set return_grades = 'on_save' where id = :c", c=w.c)
    ok('comments: switched to return at once, what was waiting is given', len(READ(w)['sent'][0]['comments']) == 2, READ(w))
    sub2 = send_words(w, 'Another student, another essay.', e=w.dev)
    T(d, 'save_writing_comments(:s, :c::text::jsonb, 0, gen_random_uuid())', s=sub2, c=J([{'id': 'a', 'start': 0, 'end': 7, 'text': 'Who?'}]))
    ok('comments: in a class that returns at once they are given at once', READ(w, e=w.dev)['sent'][0]['comments'] == [{'start': 0, 'end': 7, 'text': 'Who?'}])
    e = err(lambda: T(d, 'get_submission_writing(:s)', s=d.one("select id from submission where enrollment_id = :e", e=w.bea) or nid()))
    ok('comments: no writing is P0002', e is not None and e[1] == 'P0002', e)
    d.close()

# == limits ==
def scen_limits():
    w = world('limits'); d = w.d
    sub = send_words(w, 'x')
    e1 = err(lambda: d.run("insert into writing_draft (enrollment_id, assessment_id, course_id, body, plain, chars) values (:e, :a, :c, :b::text::jsonb, :p, 60001)",
                          e=w.dev, a=w.a, c=w.c, b=J(words('x' * 60001)), p='x' * 60001))
    ok('limits: a draft of 60,001 characters written straight to the table is refused (23514)', e1 is not None and e1[1] == '23514', e1)
    e2 = err(lambda: d.run("insert into writing_draft (enrollment_id, assessment_id, course_id, body, plain, chars) values (:e, :a, :c, :b::text::jsonb, 'y', 1)",
                          e=w.dev, a=w.a, c=w.c, b=J(words('x'))))
    ok("limits: a plain text that is not the body's is refused (23514)", e2 is not None and e2[1] == '23514', e2)
    e3 = err(lambda: d.run("insert into writing_draft (enrollment_id, assessment_id, course_id, body, plain, chars) values (:e, :a, :c, :b::text::jsonb, '', 0)",
                          e=w.dev, a=w.a, c=w.cb, b=J(doc())))
    ok("limits: a draft that names another class than its student's is refused (23503)", e3 is not None and e3[1] == '23503', e3)
    e4 = err(lambda: d.run("update submission_writing set body = :b::text::jsonb, plain = '', chars = 0 where submission_id = :s", s=sub, b=J(doc())))
    ok('limits: sent writing of no characters is refused (23514)', e4 is not None and e4[1] == '23514', e4)
    e5 = err(lambda: d.run("update writing_draft set body = :b::text::jsonb where enrollment_id = :e", e=w.cece, b=J({'html': '<p>'})))
    ok('limits: a body the rule refuses, written straight, is refused', e5 is not None and e5[1] in ('22023', '23514'), e5)
    e6 = err(lambda: d.run("insert into writing_comments (submission_id, working) values (:s, :w::text::jsonb)", s=sub,
                          w=J({'comments': [{}] * 301})))
    ok('limits: more than 300 comments written straight are refused (23514)', e6 is not None and e6[1] == '23514', e6)
    d.close()

# == released ==
def story(w):
    """What the released app does, through the released edge function's calls only. Its answers, ids taken out."""
    out = []
    def keep(r):
        if isinstance(r, dict):
            out.append({k: v for k, v in r.items() if k in ('ok', 'error', 'replayed', 'state', 'late', 'pages', 'unsent', 'kept', 'cancelled')}); return r
    req = nid()
    r = keep(PHOTOS(w, pages=2, req=req)); UPLOAD(w, r['files']); keep(FINISH(w, r['submission_id'], r['files']))
    keep(PHOTOS(w, pages=1, req=req))
    keep(UNSEND(w))
    r = keep(PHOTOS(w, pages=1)); UPLOAD(w, r['files']); keep(FINISH(w, r['submission_id'], r['files']))
    r = keep(PHOTOS(w, pages=3, route='replace')); UPLOAD(w, r['files']); keep(FINISH(w, r['submission_id'], r['files']))
    keep(PHOTOS(w, pages=1))
    T(w.d, "return_for_revision(:a, :e, '{\"what_to_fix\": \"Fix it.\"}'::jsonb, gen_random_uuid())", a=w.a, e=w.cece)
    r = keep(S(w.d, "student_submit.revision_start($1::text, $2::uuid, $3::uuid, $4::text::jsonb, $5::text, $6::uuid, $7::text)".replace('$1', ':t').replace('$2', ':e').replace('$3', ':a').replace('$4', ':p').replace('$5', ':n').replace('$6', ':q').replace('$7', ':i'),
                 t=w.tok[w.cece], e=w.cece, a=w.a, p=J([{'width': 10, 'height': 10}]), n=None, q=nid(), i='ip'))
    UPLOAD(w, r['files']); keep(FINISH(w, r['submission_id'], r['files'], route='revision_finish'))
    keep(UNSEND(w, route='revision_unsend'))
    wk = WORK(w)[w.a]
    out.append({'sent_pages': wk['sent']['pages'], 'grading': wk['sent']['grading'], 'can_change': wk['sent']['can_change']})
    out.append(w.d.all('select state, version, sent_by, (select count(*) from submission_file f where f.submission_id = s.id) from submission s order by version, state'))
    return out

def scen_released():
    a = world('rel_a', with_file=False); b = world('rel_b', with_file=True)
    sa = story(a); sb = story(b)
    ok("released: the released edge function's calls answer the same and leave the same rows with and without the file", sa == sb, (sa, sb))
    wa = WORK(a)[a.a]; wb = WORK(b)[b.a]
    ok('released: work() gains only "draft" on a piece and "writing" on sent work',
       set(wb) - set(wa) == {'draft'} and set(wb['sent']) - set(wa['sent']) == {'writing'} and wb['draft'] is None and wb['sent']['writing'] is None, (wa, wb))
    a.d.close(); b.d.close()

# == apply ==
EXPECTED = re.compile(r'writing|_send_begin|revision_start|send_finish|revision_finish|unsend|delete_submission|finish_work_upload|'
                      r'_markup_give|_markup_on_release|_grading_started|_submission_json|student_submit\.work\(|write_log_kind_check|'
                      r'^depends |pg_depend|^comments on |^tables-with-dropped')

def scen_apply():
    w = world('apply', with_file=False); d = w.d
    before = catalog(d.c)
    r = d.file(FILE)
    ok('apply: the file applies', r == 'ok', r)
    after = catalog(d.c)
    gone, came = differences(before, after)
    stray = [l for l in gone + came if not EXPECTED.search(l)]
    ok('apply: only what the header names changes', stray == [], stray[:20])
    r = d.file(FILE)
    ok('apply: a second run applies', r == 'ok', r)
    ok('apply: and changes nothing', differences(after, catalog(d.c)) == ([], []), differences(after, catalog(d.c)))
    rows = d.file(POST) == 'ok' and d.rows
    ok('apply: the post-check is ok on every row', rows and all(x[1] for x in rows), rows)
    d.close()
    # the guards
    for name, sql in (
        ('a patched function that is not the one tested', "create or replace function public._markup_give(p_enrollment_id uuid, p_assessment_id uuid) returns integer language sql as $f$ select 0 $f$"),
        ('a relied-on function that is not the one tested', "create or replace function public._grade_return_holds(p_enrollment_id uuid) returns boolean language sql stable as $f$ select false $f$"),
        ('a function with a new name already there', "create function student_submit.writing(p int) returns int language sql as $f$ select 1 $f$"),
        ('one of the three tables already there', "create table public.writing_comments (x int)"),
        ("write_log's check not as 2026111806 left it", "alter table student_submit.write_log drop constraint write_log_kind_check"),
    ):
        w = world('guard', with_file=False); d = w.d
        d.run(sql)
        cat = catalog(d.c)
        r = d.file(FILE)
        ok('apply: %s stops the file' % name, r.startswith('STOPPED') and 'Nothing was changed' in r, r)
        ok('apply: %s: and the catalog is unchanged' % name, differences(cat, catalog(d.c)) == ([], []))
        d.close()
    w = world('pre', with_file=False); d = w.d
    r = d.file(PRE)
    ok('apply: the pre-check, before the file: only the count rows', r == 'ok' and all(x[0].startswith('count: ') for x in d.rows), d.rows)
    r = d.file(FPS)
    ok('apply: the fingerprints, before the file: no rows', r == 'ok' and d.rows == [], d.rows)
    d.close()
    raw = open(os.path.join(HERE, FILE), 'rb').read()
    ok('apply: the file is plain ASCII with no backslash', all(b < 128 for b in raw) and b'\\' not in raw)
    for f in (UNDO, PRE, POST, FPS):
        raw = open(os.path.join(HERE, f), 'rb').read()
        ok('apply: %s is plain ASCII with no backslash' % f, all(b < 128 for b in raw) and b'\\' not in raw)
    ok('apply: %d bytes' % len(open(os.path.join(HERE, FILE)).read()), True)

# == undo ==
def part0(): return text_of(UNDO).split('-- PART 0 begins')[1].split('-- PART 0 ends')[0]

def scen_undo():
    w = world('undo', with_file=False); d = w.d
    before = catalog(d.c)
    md5s = dict(d.all("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                      "where n.nspname in ('public', 'student_submit', 'fv_private')"))
    r = d.file(FILE); ok('undo: the file applies', r == 'ok', r)
    send_words(w, 'Kept writing')
    r = d.statements(split(part0()))
    ok('undo: PART 0 runs', r == 'ok', r)
    e = err(lambda: SAVE(w, words('x'), 0, e=w.dev))
    ok('undo: after PART 0 a draft save is refused', e is not None and e[1] == '42501', e)
    e = err(lambda: T(d, 'get_submission_writing(:s)', s=sent_rows(w)[0][0]))
    ok("undo: after PART 0 the teacher's reader is refused", e is not None and e[1] == '42501', e)
    r = PHOTOS(w, pages=1, e=w.dev); UPLOAD(w, r['files']); f = FINISH(w, r['submission_id'], r['files'], e=w.dev)
    ok('undo: after PART 0 a photo send works', f['ok'], f)
    ok('undo: PART 0 again changes nothing', d.statements(split(part0())) == 'ok')
    r = d.file(UNDO)
    ok('undo: the full removal refuses while any writing is kept', r.startswith('STOPPED') and 'writing' in r, r)
    ok('undo: and nothing was removed', applied(d) and d.one('select count(*) from submission_writing') == 1)
    d.run('delete from submission s using submission_writing w where w.submission_id = s.id')
    d.run('delete from writing_draft')
    r = d.file(UNDO)
    ok('undo: with no writing kept, the full removal runs', r == 'ok', r)
    after = catalog(d.c)
    diff = differences(before, after)
    ok('undo: the catalog is as before the file', diff == ([], []), diff)
    md5after = dict(d.all("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                          "where n.nspname in ('public', 'student_submit', 'fv_private')"))
    ok('undo: every function byte for byte as before (%d)' % len(md5s), md5s == md5after,
       sorted(set(md5s.items()) ^ set(md5after.items()))[:10])
    r = d.file(UNDO)
    ok('undo: a second run changes nothing', r == 'ok' and differences(after, catalog(d.c)) == ([], []), r)
    r = d.file(FILE)
    ok('undo: the file applies again after it', r == 'ok', r)
    d.close()

# == The md5 lists the files carry ==
def scen_fingerprints():
    w = world('fp', with_file=False); d = w.d
    relied = {s: md5(d, s) for s in RELIED}
    before = {s: md5(d, s) for s in PATCHED}
    old = {s: md5(d, s) for s in OLD}
    runs_before = {s: runs(d, s) for s in PATCHED + OLD}
    missing = [s for s, v in list(relied.items()) + list(before.items()) + list(old.items()) if v is None]
    if missing: sys.exit('not on the template: %s' % missing)
    path = os.path.join(HERE, FILE)
    text = open(path).read()
    text = put_list(text, 'relied', [tup(s, relied[s]) for s in RELIED])
    text = put_list(text, 'replaces', [tup(s, before[s], '-') for s in PATCHED])
    text = put_list(text, 'dropped', [tup(s, old[s]) for s in OLD])
    text = put_list(text, 'new', [tup(s, '-') for s in NEW])
    text = put_list(text, 'patched', [tup(s, '-') for s in PATCHED])
    r = d.statements(split(without_last_check(text)))
    if r != 'ok': sys.exit('the file without its last check did not apply: ' + r)
    after = {s: md5(d, s) for s in PATCHED + NEW}
    run = {s: runs(d, s) for s in PATCHED + NEW}
    for s in PATCHED:
        if run[s] != runs_before[s]: sys.exit('%s: who may run it changed: %s -> %s' % (s, runs_before[s], run[s]))
    if run[RESIGNED[0]] != runs_before[OLD[0]] or run[RESIGNED[1]] != runs_before[OLD[1]]:
        sys.exit('a re-signed function is run by others than before')
    cons = d.one("select string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | ' order by conname collate \"C\") from pg_constraint "
                 "where conrelid in ('public.writing_draft'::regclass, 'public.submission_writing'::regclass, 'public.writing_comments'::regclass)")
    text = put_list(text, 'replaces', [tup(s, before[s], after[s]) for s in PATCHED])
    text = put_list(text, 'new', [tup(s, after[s]) for s in NEW])
    text = put_list(text, 'patched', [tup(s, after[s]) for s in PATCHED])
    text = put_list(text, 'final', [tup(s, after[s], run[s]) for s in PATCHED + NEW])
    text = put_list(text, 'constraints', [q(cons)])
    open(path, 'w').write(text)
    live = list(relied.items()) + list(before.items()) + list(old.items())
    for fn, name, rows in ((FPS, 'live', live), (PRE, 'precheck', live), (POST, 'postcheck', list(relied.items()) + list(after.items()))):
        p = os.path.join(HERE, fn); t = open(p).read()
        open(p, 'w').write(put_list(t, name, [tup(s, v) for s, v in rows]))
    p = os.path.join(HERE, POST); t = open(p).read()
    t = put_list(t, 'runs', [tup(s, run[s]) for s in PATCHED + NEW])
    t = put_list(t, 'constraints', [q(cons)])
    open(p, 'w').write(t)
    p = os.path.join(HERE, UNDO); t = open(p).read()
    t = put_list(t, 'undo-patched', [tup(s, after[s], before[s]) for s in PATCHED])
    t = put_list(t, 'undo-resigned', [tup(RESIGNED[i], after[RESIGNED[i]], OLD[i], old[OLD[i]]) for i in range(2)])
    t = put_list(t, 'undo-new', [tup(s, after[s]) for s in NEW if s not in RESIGNED])
    t = copy_edits(text, t)
    open(p, 'w').write(t)
    print('wrote the lists: %d relied, %d patched, %d new' % (len(RELIED), len(PATCHED), len(NEW)))
    d.close()

def runs(d, s):
    t, st = d.one("select has_function_privilege('authenticated', to_regprocedure(:s), 'execute')::text || has_function_privilege('service_role', to_regprocedure(:s), 'execute')::text", s=s), None
    return {'truetrue': 'teacher', 'falsetrue': 'student', 'falsefalse': 'owner'}.get(t, t)

SCENARIOS = {'rule': scen_rule, 'draft': scen_draft, 'send': scen_send, 'pages': scen_pages, 'remove': scen_remove,
             'revision': scen_revision, 'comments': scen_comments, 'limits': scen_limits, 'released': scen_released,
             'apply': scen_apply, 'undo': scen_undo}

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['fingerprints']:
        scen_fingerprints(); sys.exit(0)
    for name in (args or list(SCENARIOS)):
        try:
            SCENARIOS[name]()
        except Exception as e:
            import traceback
            ok('%s: ran to the end' % name, False, traceback.format_exc()[-1500:])
    finish()
