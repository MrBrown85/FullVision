"""Photo lifecycle (Batch D, S8-M1): migrations/2026111140_photo_lifecycle.sql,
applied after Batch B (2026111101, 2026111102), its fixes (2026111104),
Batch C (2026111120, 2026111121) and the send rules (2026111130), with
Supabase's pg_cron, pg_net and Vault stood in for (photo-lifecycle-stand-in.sql).

    PGDATABASE=pl python3 batch_c_common.py build    an EMPTY database: live with Batch B and the fixes
    PGDATABASE=pl python3 photo_lifecycle.py         every scenario below
    PGDATABASE=pl python3 photo_lifecycle.py keep ... or some
    PGDATABASE=pl python3 photo_lifecycle.py fingerprints [check]   write (or check) the lists the four files carry
    PGDATABASE=pl python3 photo_lifecycle.py mutate [n ...]          wrong versions of the file: are they noticed?

  keepday   The Keep Photos Until day, public._keep_photos_day, against the
            screen's own keepPhotosDate (teacher/cm-student-page.js, run in
            Node), for every day of two school years, both choices, and
            several sets of terms.
  keep      The date job on one class, night by night: kept through the
            day, gone the night after; what stays (grades, comments, the
            submission, Mark Up in markup_kept) and what goes (each page row,
            both files queued, then drained); a page sent after the cutoff
            stays; End of Term; a missed night caught up; a switch to End of
            Term in Term 2 deletes nothing early; the midnight edge in the
            class's time zone; another class untouched.
  strays    A file with no row, older than 24 hours, is queued once (and
            again if it comes back); younger, with a row, as a thumbnail,
            already queued, in another bucket, or another shape of name: not
            queued (the last reported); a class that is gone; a row whose
            file is missing is reported and not changed.
  expired   An unfinished send in a class nobody uses is dropped by the
            nightly job, its files queued.
  paths     Every way a row goes takes its files (ruling 105): delete an
            assessment, delete a withdrawn student, delete a student record,
            the 30-day class purge, the 30-day teacher purge, clear_data
            (stand-in), TRUNCATE. markup_kept goes with its submission.
  timer     photo_removal_due and photo_removal_call: nothing sent when
            nothing is due, one call when something is, never twice inside
            five minutes, refused without the secrets or with a wrong
            address; the two pg_cron jobs.
  nightly   The procedure, committing class by class: a class whose lock is
            held is logged and skipped, the others done, the run ends in an
            error, the next night catches the skipped class up.
  apply     Every guard; a second run; grants; the read-only pre-check and
            post-check and what each notices.
  undo      photo-lifecycle-undo.sql: PART 1 unschedules; PART 2 refuses
            while marks are kept, then puts the catalog back exactly.

Scenarios marked "differs" in keep, strays and expired are also run on the
base without the file (`keep-without` and so on): each such check must fail
there, every other must hold.
"""
import datetime, subprocess, time, threading
from submissions_common import WorkDb, Side, attempt, seed_work, Storage, score_fingerprint
from batch_c_common import *
import batch_c_common as bc
from catalog import catalog, differences, row_checksums

FILE = '../2026111140_photo_lifecycle.sql'
FILE_USED = os.environ.get('PHOTO_LIFECYCLE_FILE') or FILE
MUTATED = FILE_USED != FILE
SEND_RULES = '../2026111130_student_send_rules.sql'
STAND = 'photo-lifecycle-stand-in.sql'
UNDO = 'photo-lifecycle-undo.sql'
PRE = 'photo-lifecycle-live-precheck.sql'
POST = 'photo-lifecycle-live-postcheck.sql'
LIST_FILES = [FILE, UNDO, PRE, POST]
NEW = ['public._keep_photos_day(text,jsonb,date)', 'public._photo_keep_cutoff(uuid,timestamp with time zone)',
       'public._photo_keep_class(uuid,timestamp with time zone)', 'public._photo_strays(uuid,timestamp with time zone)',
       'public._photo_missing(uuid)', 'public._photo_log(uuid,text,integer,jsonb)', 'public._photo_stuck()',
       'public.photo_removal_due()', 'public.photo_removal_call()']
# The one existing function it replaces (C1's): kept marks count as grading started (decision 5).
REPLACED = ['student_submit._grading_started(uuid,uuid)']
PROC = 'public.photo_lifecycle_nightly()'
RELIED = ['public._grade_return_lock(uuid)', 'public._grade_return_lock_first(uuid)', 'public._fv_timezone(text)',
          'public._fv_date(text)', 'public._work_bucket()', 'public._work_object(text)', 'public._work_hold()',
          'public._work_drop_expired(uuid)', 'public._submission_file_removed()', 'public._submission_gone()',
          'public._submission_truncated()', 'public._submission_target_gone()', 'student_submit.removal_batch(integer)',
          'student_submit.removal_done(bigint[])', 'student_submit.send_finish(text,uuid,uuid,jsonb,text)',
          'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', 'student_submit.work(text,uuid,text)',
          'student_submit.send_paths(text,uuid,uuid,text)', 'fv_private.work_path_course(text)',
          'public._revision_gone()', 'public._markup_on_return()', 'public._markup_on_release()']
JOBS = {'fv_photo_lifecycle_daily': ('27 10 * * *', 'call public.photo_lifecycle_nightly()'),
        'fv_photo_removal': ('*/10 * * * *', 'select public.photo_removal_call()')}
SECRET = '5e' * 32   # a test value, never a real secret
URL = 'https://novsfeqjhbleyyaztmlh.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1'   # the project's own, as the file pins it
# The edge function's layout check (supabase/functions/_shared/storage-rest.ts, PATH): what its worker deletes.
ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
EDGE_PATH = re.compile('^(%s)/(%s)/(%s)/(%s)/(%s)(-thumb)?\\.jpg$' % ((ID,) * 5))

LISTS = re.compile(r'(-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*\n)(.*?)(\n[ \t]*-- FINGERPRINTS-END)', re.S)
def lists_of(text):
    return [(m.group(2), re.findall(r"\('([^']+)',\s*'([0-9a-f]{32}|PENDING|absent)'(?:,\s*'([0-9a-f]{32}|PENDING|absent)')?\)", m.group(3))) for m in LISTS.finditer(text)]
def neutral(text):
    """The text with every list stood aside, so it applies whatever the lists hold."""
    return LISTS.sub(lambda m: m.group(1) + ("            ('public.no_such_function_at_all()', 'absent', 'absent')" if m.group(2) == 'replaces'
                                             else "            ('public.no_such_function_at_all()', 'absent')") + m.group(4), text)
def write_lists(text, lists):
    def row(m):
        name = m.group(2); items = lists.get(name)
        if items is None: return m.group(0)
        indent = re.match(r'[ \t]*', m.group(3)).group(0) or '            '
        w = max(len(x[0]) for x in items) + 3
        body = ',\n'.join("%s(%s %s)" % (indent, ("'%s'," % x[0]).ljust(w), ', '.join("'%s'" % h for h in x[1:])) for x in items)
        return m.group(1) + body + m.group(4)
    return LISTS.sub(row, text)

# ── the template: the base, then C1, C2, the send rules and the stand-ins (live as the file meets it) ──
_TPL = {}
def template(with_file):
    key = bool(with_file)
    if key in _TPL: return _TPL[key]
    name = '%s_pl%s%d' % (cc.BASE_DB, 'm' if MUTATED else '', int(key))
    admin('drop database if exists "%s" with (force)' % name)
    admin('create database "%s" template "%s"' % (name, cc.BASE_DB))
    c = connect(name)
    for rel in [C1, C2, SEND_RULES, STAND] + ([FILE_USED] if key else []):
        text = text_at(rel)
        if rel == FILE_USED and MUTATED: text = neutral(text)
        for st in split(text):
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

def world(tag, fixed=True):
    d = WorkDb('pl_' + tag, template=template(fixed)); k = seed_work(d)
    t1, _ = d.session(ENR1); t2, _ = d.session(ENR2, birthday='2012-06-16')
    return d, k, t1, t2

# ── small helpers ───────────────────────────────────────────────────────────
def g(r, *ks):
    for k in ks: r = r.get(k) if isinstance(r, dict) else None
    return r
def has_file(d): return d.one("select to_regprocedure('public._photo_keep_class(uuid,timestamp with time zone)') is not null")
def night(d, course, at):
    """What the nightly job does for one class at `at` (a timestamptz text): its class step, under a transaction of its own.
    On the base there is no job: nothing happens."""
    if not has_file(d): return None
    return d.one('select public._photo_keep_class(:c, :t::timestamptz)', c=course, t=at)
def strays(d, course, at):
    if not has_file(d): return None
    return d.one('select public._photo_strays(:c, :t::timestamptz)', c=course, t=at)
def missing(d, course):
    if not has_file(d): return None
    return d.one('select public._photo_missing(:c)', c=course)
def pages(d, course=COURSE_A): return d.one("select count(*) from submission_file f join submission s on s.id = f.submission_id where s.course_id = :c", c=course)
def page_ids(d, sid): return [r[0] for r in d.all('select id::text from submission_file where submission_id = :s order by page', s=sid)]
def paths_of(d, sid): return sorted(p for r in d.all('select path, thumb_path from submission_file where submission_id = :s', s=sid) for p in r)
def queued(d, reason=None):
    return sorted(r[0] for r in d.all('select path from submission_file_removal where not done' + (' and reason = :r' if reason else ''), **({'r': reason} if reason else {})))
def stored(d): return d.storage.names()
def drain(d):
    """The removal worker until the queue has nothing due (as the edge function's scheduled-sweep runs it)."""
    for _ in range(20):
        b, done = d.drain(1000)
        if not b['items']: break
def tz_at(day, hh, mm=0, ss=0, tz='America/Vancouver'):
    """A moment on `day` (a date) at hh:mm:ss in tz, as timestamptz text."""
    return '%s %02d:%02d:%02d %s' % (day, hh, mm, ss, tz)
RUN = (3, 27)   # the job's time in British Columbia in winter (10:27 UTC)
def run_on(day, tz='America/Vancouver'): return tz_at(day, *RUN, tz=tz)
def set_created(d, sid, at):
    d.run('update submission_file set created_at = :t::timestamptz where submission_id = :s', t=at, s=sid)
    d.run('update submission set created_at = :t::timestamptz, sent_at = :t::timestamptz where id = :s', t=at, s=sid)
def mark(d, file_id, text='Check your units'):
    return d.rpc('save_markup(:f, :m::jsonb, null, :k)', f=file_id, m=json.dumps({'v': 1, 'marks': [{'type': 'note', 'x': 0.5, 'y': 0.5, 'text': text}]}), k=nid())
def comment(d, a, e=ENR1, text='Nice work on the diagram'):
    return d.rpc('save_score_comment(:e, :a, :t)', e=e, a=a, t=text)
def terms(d, course, ends, tz=None):
    t = [{'ordinal': i + 1, 'label': 'Term %d' % (i + 1), 'starts_on': str(e - datetime.timedelta(days=60)), 'ends_on': str(e)} for i, e in enumerate(ends)]
    d.run('update course set reporting_terms = :t::jsonb where id = :c', t=json.dumps(t), c=course)
    if tz: d.run('update course set timezone = :z where id = :c', z=tz, c=course)
def keep(d, course, choice): d.run('update course set keep_photos_until = :k where id = :c', k=choice, c=course)
D = datetime.date
def judged(d, course, through):
    """The job's state as if it had last looked at the class through `through`, with its setting as it is now."""
    if not d.one("select count(*) from pg_attribute where attrelid = 'public.photo_keep_check'::regclass and attname = 'judged_choice'"):
        # the file before its review kept no setting (the review scenario is also run against it, to fail first)
        d.run('insert into photo_keep_check (course_id, checked_through) values (:c, :t::date)', c=course, t=through); return
    d.run("""insert into photo_keep_check (course_id, checked_through, judged_choice, judged_terms)
             select c.id, :t::date, c.keep_photos_until, c.reporting_terms from course c where c.id = :c
             on conflict (course_id) do update set checked_through = excluded.checked_through,
                 judged_choice = excluded.judged_choice, judged_terms = excluded.judged_terms""", c=course, t=through)
def photo_piece(x, course=COURSE_A, title='Another Lab'):
    a = nid()
    x.run("insert into assessment (id, course_id, title, score_mode, max_points, students_send) values (:a, :c, :t, 'points', 10, 'photos')", a=a, c=course, t=title)
    return a

# ── fingerprints: written by script, never by hand ──────────────────────────
def cmd_fingerprints(check_only):
    d0 = WorkDb('pl_fp0', template=template(False))
    try:
        relied = fingerprints(d0, RELIED); before = fingerprints(d0, REPLACED)
        r = d0.statements(split(neutral(text_at(FILE))))
        if r != 'ok': sys.exit('the file does not apply: ' + r)
        new_ = fingerprints(d0, NEW); after_ = fingerprints(d0, REPLACED)
    finally:
        d0.close()
    lists = {'relied': [(f, relied[f] or 'absent') for f in RELIED], 'new': [(f, new_[f] or 'absent') for f in NEW],
             'replaces': [(f, before[f] or 'absent', after_[f] or 'absent') for f in REPLACED]}
    stale = []
    for rel in LIST_FILES:
        path = os.path.join(HERE, rel)
        if not os.path.exists(path): continue
        was = open(path).read(); now = write_lists(was, lists)
        if now != was:
            stale.append(rel)
            if not check_only: open(path, 'w').write(now)
    if check_only: print('stale: ' + ', '.join(stale) if stale else 'every list is current'); return 1 if stale else 0
    print('rewritten: ' + (', '.join(stale) or 'nothing (every list was current)')); return 0

SCENARIOS = {}
def scenario(name, without=False):
    def reg(f): SCENARIOS[name] = (f, without); return f
    return reg

# ── keepday: the day, against the screen's own code ─────────────────────────
SCREEN = os.path.join(HERE, '..', '..', 'teacher', 'cm-student-page.js')
NODE = r'''
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const at = src.indexOf('function keepPhotosDate(');
let i = src.indexOf('{', at), depth = 0, end = -1;
for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } } }
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = cases.map(c => {
  const make = new Function('getReportingTerms', '_today', src.slice(at, end) + '; return keepPhotosDate;');
  return make(() => c.terms, () => c.on)('c', c.choice, c.on);
});
process.stdout.write(JSON.stringify(out));
'''
@scenario('keepday')
def scen_keepday():
    d = WorkDb('pl_keepday', template=template(True))
    try:
        sets = {
            'none': [],
            'grandview': [{'ordinal': 1, 'label': 'Term 1', 'starts_on': '2026-09-02', 'ends_on': '2026-11-20'},
                          {'ordinal': 2, 'label': 'Term 2', 'starts_on': '2026-11-23', 'ends_on': '2027-01-29'},
                          {'ordinal': 3, 'label': 'Term 3', 'starts_on': '2027-02-01', 'ends_on': '2027-04-16'},
                          {'ordinal': 4, 'label': 'Term 4', 'starts_on': '2027-04-19', 'ends_on': '2027-06-25'}],
            'out_of_order': [{'ordinal': 2, 'label': 'B', 'starts_on': '2027-02-01', 'ends_on': '2027-06-24'},
                             {'ordinal': 1, 'label': 'A', 'starts_on': '2026-09-02', 'ends_on': '2027-01-28'}],
            'last_year': [{'ordinal': 1, 'label': 'Old', 'starts_on': '2025-09-02', 'ends_on': '2026-06-26'}],
            'bad_dates': [{'ordinal': 1, 'label': 'X', 'starts_on': '', 'ends_on': 'soon'},
                          {'ordinal': 2, 'label': 'Y', 'starts_on': '2026-12-01', 'ends_on': '2027-03-12'}],
            'one_day': [{'ordinal': 1, 'label': 'Z', 'starts_on': '2026-12-15', 'ends_on': '2026-12-15'}],
        }
        cases = []
        day = D(2026, 6, 1)
        while day <= D(2027, 9, 15):
            for name, t in sets.items():
                for choice in ('end_of_year', 'end_of_term'):
                    cases.append({'on': str(day), 'terms': t, 'choice': choice, 'set': name})
            day += datetime.timedelta(days=1)
        r = subprocess.run(['node', '-e', NODE, SCREEN], input=json.dumps(cases), capture_output=True, text=True)
        if r.returncode != 0:
            ok('the screen\'s keepPhotosDate runs in Node', False, r.stderr[-400:]); return
        screen = json.loads(r.stdout)
        rows = d.all("""select x.ord, public._keep_photos_day(x.c->>'choice', x.c->'terms', (x.c->>'on')::date)::text
                          from jsonb_array_elements(:j::jsonb) with ordinality x(c, ord) order by x.ord""", j=json.dumps(cases))
        sql = [r[1] for r in rows]
        diff = [(c['set'], c['choice'], c['on'], s, q) for c, s, q in zip(cases, screen, sql) if s != q]
        ok('public._keep_photos_day gives the day the screen shows, for each of %d days, choices and sets of terms' % len(cases),
           not diff and len(sql) == len(cases), diff[:5])
        # The rule's corners, by name.
        k = lambda choice, t, on: d.one('select public._keep_photos_day(:c, :t::jsonb, :o::date)::text', c=choice, t=json.dumps(t), o=on)
        ok('End of Year from August: next June 30', k('end_of_year', [], '2026-08-01') == '2027-06-30')
        ok('End of Year in July: the June 30 just gone', k('end_of_year', [], '2027-07-15') == '2027-06-30')
        ok('End of Year on June 30 itself: that day', k('end_of_year', [], '2027-06-30') == '2027-06-30')
        ok('End of Term on a term\'s last day: that day', k('end_of_term', sets['grandview'], '2026-11-20') == '2026-11-20')
        ok('End of Term the day after: the next term\'s last day', k('end_of_term', sets['grandview'], '2026-11-21') == '2027-01-29')
        ok('End of Term after every term: June 30, as End of Year (no more deleting night by night)', k('end_of_term', sets['grandview'], '2027-06-28') == '2027-06-30')
        ok('End of Term with last year\'s terms only, in the autumn: next June 30', k('end_of_term', sets['last_year'], '2026-10-01') == '2027-06-30')
        ok('End of Term with no terms: June 30', k('end_of_term', [], '2026-10-01') == '2027-06-30')
        ok('End of Term with terms not a list: June 30', k('end_of_term', {'x': 1}, '2026-10-01') == '2027-06-30')
        ok('a choice that is neither: End of Year', k(None, sets['grandview'], '2026-10-01') == '2027-06-30')
    finally:
        d.close()

def kept_state(d):
    """Everything Keep Photos Until must leave as it was: grades and comments (the four score tables and grade_return),
    revision requests, reflections, observations, and each submission row whole."""
    return (score_fingerprint(d),
            d.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from revision_request x"),
            d.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from feedback_reflection x"),
            d.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from observation x"),
            d.all('select id::text, state, sent_by, on_paper, note, followed_plan, is_late, version, sent_at::text from submission order by id'))

@scenario('keep', without=True)
def scen_keep(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('keep_%d' % fixed, fixed); a = k['takes']
    try:
        with tx(d):
            # ── End of Year (the default), Vancouver ──
            s1, f1 = d.send(t1, ENR1, a, 2, note='my lab', plan='yes')
            more, _ = d.teacher_upload(a, ENR1, 1, mode='add')
            s2, f2 = d.send(t2, ENR2, a, 1)
            b = photo_piece(d)
            s3, f3 = d.send(t1, ENR1, b, 1)
            ok('three pieces of work handed in (setup)', all(g(f, 'ok') for f in (f1, f2, f3)), (f1, f2, f3))
            set_created(d, s1['submission_id'], '2027-06-29 10:00 America/Vancouver')
            set_created(d, s2['submission_id'], '2027-06-30 23:59:59 America/Vancouver')
            set_created(d, s3['submission_id'], '2027-07-01 00:00:00 America/Vancouver')
            # The teacher's added page moved onto s1's work; its row keeps its own created_at: set it too.
            d.run("update submission_file set created_at = '2027-06-29 11:00 America/Vancouver' where submission_id = :s and added_by = 'teacher'", s=s1['submission_id'])
            first = page_ids(d, s1['submission_id'])[0]
            m = mark(d, first)
            ok('a mark on page 1 of the first work (setup)', g(m, 'ok') is True or g(m, 'result') in ('saved', 'ok') or (isinstance(m, dict) and 'rev' in str(m)), m)
            d.rpc('upsert_score(:e, :a, :v)', e=ENR1, a=a, v=7)
            d.run("update score set comment = 'Clear diagram' where enrollment_id = :e and assessment_id = :a", e=ENR1, a=a)
            # Teacher B's class: its own photos, never this class's job's to touch.
            tb, _ = d.session(ENR_B, course=COURSE_B, teacher=B, birthday='2012-07-17')
            sb, fb = d.send(tb, ENR_B, k['b_takes'], 1)
            set_created(d, sb['submission_id'], '2027-06-01 10:00 America/Vancouver')
            before = kept_state(d); files0 = stored(d); b_paths = paths_of(d, sb['submission_id'])
            s1p, s2p, s3p = paths_of(d, s1['submission_id']), paths_of(d, s2['submission_id']), paths_of(d, s3['submission_id'])
            marks0 = d.all('select working::text, working_rev from markup where file_id = :f', f=first)

            night(d, COURSE_A, run_on('2027-06-30'))
            check('on June 30 itself (the run early that morning): nothing is deleted; the photos are kept through the day',
                  pages(d) == 5 and not queued(d), (pages(d), queued(d)))
            r = night(d, COURSE_A, run_on('2027-07-01'))
            gone = s1p + s2p
            check('the night after June 30: every page of the class sent before July 1 began (Vancouver) is deleted, '
                  'the student\'s and the teacher\'s, 23:59:59 on June 30 included', pages(d) == 1 and page_ids(d, s3['submission_id']), (pages(d), r), differs=True)
            check('both files of each of those pages are queued for deletion, reason keep_photos_until, and nothing else',
                  queued(d, 'keep_photos_until') == sorted(gone) and queued(d) == sorted(gone), queued(d), differs=True)
            check('a page sent at 00:00:00 on July 1 stays (after the cutoff)', paths_of(d, s3['submission_id']) == s3p)
            check('grades, comments, revision requests, reflections, observations and every submission row are as they were '
                  '(the work still reads handed in, when, by whom, Late, the note, Did You Do It)', kept_state(d) == before)
            check("the page's Mark Up is kept, whole, in markup_kept, with its page's number",
                  has_file(d) and bool(marks0) and d.all('select working::text, working_rev, page, submission_id::text from markup_kept where file_id = :f', f=first)
                  == [marks0[0] + [1, s1['submission_id']]], marks0, differs=True)
            check('and is no longer in markup (it went with its page)', not d.all('select 1 from markup where file_id = :f', f=first), differs=True)
            check('Teacher B\'s class is untouched (its own day is its own job\'s)', paths_of(d, sb['submission_id']) == b_paths)
            check("the run is logged: kind keep_photos_until, 4 pages, 1 mark kept, ids only",
                  d.all("select kind, n, detail->>'marks_kept' from photo_check_log where course_id = :c", c=COURSE_A) == [['keep_photos_until', 4, '1']]
                  if has_file(d) else False, differs=True)
            if MODE['fixed']:
                night(d, COURSE_A, run_on('2027-07-01'))
                ok('the same night again: nothing more', pages(d) == 1 and d.one("select count(*) from photo_check_log") == 1)
                drain(d)
                ok('the removal worker then deletes exactly those files from storage', stored(d) == sorted(set(files0) - set(gone)), stored(d))
                ok('and nothing in the queue is still to delete (each is offered once more after its last upload link has died, as Batch B does)',
                   d.one('select count(*) from submission_file_removal where not done and removed_at is null') == 0)
                w = d.work(t1, ENR1)
                ok("the student's page still works and shows the work as handed in", g(w, 'ok') is True, w)
                fl = d.file_links(t1, ENR1, a)
                ok('no link is made for a deleted page', g(fl, 'ok') is True and not (g(fl, 'files') or []), fl)
                lst = d.rpc('list_course_submissions(:c)', c=COURSE_A)
                mine = [x for x in lst.get('submissions', []) if x.get('id') == s1['submission_id']]
                ok("the teacher's list still has the work, with no pages", len(mine) == 1 and not mine[0].get('files'), mine)
                again = d.send_start(t1, ENR1, a, 1)
                ok('a student whose photos were deleted is answered as for work handed in (no error)', isinstance(again, dict) and 'ok' in again, again)
                night(d, COURSE_A, run_on('2027-07-02'))
                ok('in July (End of Year still the June 30 just gone): a page sent on July 1 goes the night after', pages(d) == 0)
                ok('Teacher B\'s class still untouched', paths_of(d, sb['submission_id']) == b_paths)
                st = d.one("select checked_through::text from photo_keep_check where course_id = :c", c=COURSE_A)
                ok('the job remembers the last day it looked at: July 1', st == '2027-07-01', st)

        # ── End of Term, a missed night, a switch, the midnight edge in another zone ──
        T1, T2 = D(2026, 11, 20), D(2027, 1, 29)
        with tx(d):
            keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [T1, T2])
            p1, _ = d.send(t1, ENR1, a, 1); p2, _ = d.send(t2, ENR2, a, 1)
            set_created(d, p1['submission_id'], '2026-11-19 12:00 America/Vancouver')
            set_created(d, p2['submission_id'], '2026-11-21 09:00 America/Vancouver')
            night(d, COURSE_A, run_on('2026-11-20'))
            check("End of Term: nothing on the term's last day", pages(d) == 2)
            night(d, COURSE_A, run_on('2026-11-21'))
            check("the night after the term's last day: the page sent in the term goes", page_ids(d, p1['submission_id']) == [], differs=True)
            check('a page sent the next morning (Term 2) stays', len(page_ids(d, p2['submission_id'])) == 1)
            night(d, COURSE_A, run_on('2026-11-22'))
            check('the next night: Term 2\'s page still stays', len(page_ids(d, p2['submission_id'])) == 1)
        with tx(d):
            keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [T1, T2])
            p1, _ = d.send(t1, ENR1, a, 1); p2, _ = d.send(t2, ENR2, a, 1)
            set_created(d, p1['submission_id'], '2026-11-19 12:00 America/Vancouver')
            set_created(d, p2['submission_id'], '2026-11-21 09:00 America/Vancouver')
            night(d, COURSE_A, run_on('2026-11-20'))
            # The night of Nov 20 to 21 never runs.
            night(d, COURSE_A, run_on('2026-11-22'))
            check('a missed night is caught up the next: the term\'s page goes, by the term\'s own cutoff', page_ids(d, p1['submission_id']) == [], differs=True)
            check("and the next term's page stays", len(page_ids(d, p2['submission_id'])) == 1)
        with tx(d):
            p1, _ = d.send(t1, ENR1, a, 1)
            set_created(d, p1['submission_id'], '2026-11-10 12:00 America/Vancouver')
            night(d, COURSE_A, run_on('2026-11-24'))   # End of Year: nothing; the job has looked at Nov 23
            keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [T1, T2])
            night(d, COURSE_A, run_on('2026-11-25'))
            check('switched to End of Term in Term 2 (Term 1 ended Nov 20): nothing goes; the screen shows Jan 29',
                  len(page_ids(d, p1['submission_id'])) == 1)
            night(d, COURSE_A, run_on('2027-01-30'))
            check('and it goes the night after Jan 29', page_ids(d, p1['submission_id']) == [], differs=True)
        with tx(d):
            p1, _ = d.send(t1, ENR1, a, 1)
            set_created(d, p1['submission_id'], '2026-11-10 12:00 America/Vancouver')
            keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [T1, T2])
            night(d, COURSE_A, run_on('2026-11-25'))
            check("a class's first night looks at yesterday only: a Term 1 day already gone does not come back", len(page_ids(d, p1['submission_id'])) == 1)
        with tx(d):
            keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [T1, T2], tz='America/Toronto')
            p1, _ = d.send(t1, ENR1, a, 1); p2, _ = d.send(t2, ENR2, a, 1)
            set_created(d, p1['submission_id'], '2026-11-20 23:59:59 America/Toronto')
            set_created(d, p2['submission_id'], '2026-11-21 00:00:00 America/Toronto')   # still Nov 20 in Vancouver
            night(d, COURSE_A, '2026-11-20 23:30 America/Toronto')
            check("a run before midnight in the class's own zone deletes nothing", pages(d) == 2)
            night(d, COURSE_A, '2026-11-21 03:27 America/Toronto')
            check("in the class's own time zone (Toronto): 23:59:59 on the last day goes",
                  page_ids(d, p1['submission_id']) == [], differs=True)
            check('and 00:00:00 the next day stays (in Vancouver it is still the last day)', len(page_ids(d, p2['submission_id'])) == 1)
        with tx(d):
            keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [])
            p1, _ = d.send(t1, ENR1, a, 1)
            set_created(d, p1['submission_id'], '2026-12-01 12:00 America/Vancouver')
            night(d, COURSE_A, run_on('2027-06-30'))
            check('End of Term with no terms: kept through June 30', len(page_ids(d, p1['submission_id'])) == 1)
            night(d, COURSE_A, run_on('2027-07-01'))
            check('and gone that night', page_ids(d, p1['submission_id']) == [], differs=True)
        with tx(d):
            s, _ = d.send_start(t1, ENR1, a, 1), None
            d.upload(s['files'])
            night(d, COURSE_A, run_on('2027-07-01'))
            check("an unfinished send (still holding its place) is not Keep Photos Until's: it stays, for its own two hours",
                  d.one("select count(*) from submission_file f join submission x on x.id = f.submission_id where x.state = 'sending'") == 1)
    finally:
        d.close()

def plant(d, name, age_hours, bucket=BUCKET):
    """A file put straight into storage (as the service would hold it), made `age_hours` ago."""
    d.run("insert into storage.objects (bucket_id, name, metadata, created_at) values (:b, :n, jsonb_build_object('size', 1000, 'mimetype', 'image/jpeg'), now() - make_interval(hours => :h))",
          b=bucket, n=name, h=age_hours)
def lay(course=COURSE_A, thumb=False):
    return '/'.join([course, nid(), nid(), nid(), nid()]) + ('-thumb' if thumb else '') + '.jpg'
def now_(d): return str(d.one('select now()::text'))

@scenario('strays', without=True)
def scen_strays(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('strays_%d' % fixed, fixed); a = k['takes']
    try:
        with tx(d):
            s, f = d.send(t1, ENR1, a, 1)
            ok('one piece of work handed in (setup)', g(f, 'ok') is True, f)
            mine = paths_of(d, s['submission_id'])
            d.run("update storage.objects set created_at = now() - interval '3 days'")   # the page's own files are old too
            old, young = lay(), lay()
            plant(d, old, 25); plant(d, young, 23)
            plant(d, lay(thumb=True), 30)
            odd = COURSE_A + '/notes.txt'; plant(d, odd, 48)
            upper = lay().upper(); plant(d, upper, 48)
            plant(d, lay(), 48, bucket='another-bucket') if d.one("select count(*) from storage.buckets where id = 'another-bucket'") else None
            gone_class = lay(course=nid()); plant(d, gone_class, 48)
            waiting = lay(); plant(d, waiting, 48)
            d.run("insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at) values (:b, :p, :c, 'row_deleted', now())",
                  b=BUCKET, p=waiting, c=COURSE_A)
            r = strays(d, COURSE_A, now_(d))
            q = set(queued(d, 'stray'))
            check("a file in this class's folder that no page names, 25 hours old, is queued for deletion (reason stray)", old in q, (r, q), differs=True)
            check('a stray thumbnail, 30 hours old, too', len([p for p in q if p.endswith('-thumb.jpg')]) == 1, q, differs=True)
            check('one 23 hours old is not (24 hours, as Colin accepted)', young not in q)
            check("a page's own files are never queued, however old", not (set(mine) & set(queued(d))))
            check('a file already waiting in the queue is not queued twice', d.one('select count(*) from submission_file_removal where path = :p', p=waiting) == 1)
            check('a name of any other shape is not queued (the worker would never delete it)', odd not in q and upper not in q)
            check("a file of a class that is gone is not this class's", gone_class not in q)
            r2 = strays(d, None, now_(d))
            q2 = set(queued(d, 'stray'))
            check('the last pass queues the stray of a class that is gone', gone_class in q2, differs=True)
            check('and reports the two files of other names, without queuing them',
                  has_file(d) and d.one("select n from photo_check_log where kind = 'stray_other_name'") == 2 and odd not in q2 and upper not in q2,
                  differs=True)
            check("every queued stray is a name the edge function's worker deletes (its PATH)", all(EDGE_PATH.match(p) for p in q2), q2)
            if MODE['fixed']:
                drain(d)
                ok('the worker deletes the strays; the page files stay', old not in stored(d) and all(p in stored(d) for p in mine), stored(d))
                plant(d, old, 26)   # the same name back again
                strays(d, COURSE_A, now_(d))
                ok('a stray deleted once and back again is queued again', old in queued(d, 'stray'))
                ok('a second pass right after queues nothing more', strays(d, COURSE_A, now_(d)).get('queued') == 0)
                # A row whose file is missing: reported, never changed.
                d.storage.remove([mine[0]])
                before = d.all('select id::text, path from submission_file order by id')
                m = missing(d, COURSE_A)
                ok('a page whose file is missing is found, by its id', m.get('n') == 1 and m.get('file_ids') == [page_ids(d, s['submission_id'])[0]], m)
                ok('and nothing is changed or queued for it', d.all('select id::text, path from submission_file order by id') == before
                   and mine[0] not in queued(d) and mine[1] not in queued(d))
                ok('an unfinished send is not reported missing (its files are still coming)',
                   (lambda st: (d.upload([]), missing(d, COURSE_A).get('n'))[1])(d.send_start(t2, ENR2, a, 1)) == 1)
    finally:
        d.close()

@scenario('expired', without=True)
def scen_expired(fixed=True):
    MODE['fixed'] = fixed
    d, k, t1, t2 = world('expired_%d' % fixed, fixed); a = k['takes']
    try:
        with tx(d):
            s = d.send_start(t1, ENR1, a, 2); d.upload(s['files'])
            u, _ = d.teacher_upload(a, ENR2, 1), None
            d.run("update submission set created_at = now() - interval '3 hours' where state = 'sending' and id = :s", s=s['submission_id'])
            paths = paths_of(d, s['submission_id'])
            night(d, COURSE_A, now_(d))
            check('in a class nobody has used since, a send not finished in its two hours is dropped by the nightly job',
                  not d.all('select 1 from submission where id = :s', s=s['submission_id']), differs=True)
            check('and its files are queued (reason expired)', sorted(queued(d, 'expired')) == sorted(paths), queued(d), differs=True)
            check('and it is logged', has_file(d) and d.one("select n from photo_check_log where kind = 'expired'") == 1, differs=True)
    finally:
        d.close()

@scenario('paths')
def scen_paths():
    """Ruling 105: every way a row goes takes its files."""
    d, k, t1, t2 = world('paths', True); a = k['takes']
    try:
        def setup(x):
            s1, f1 = x.send(t1, ENR1, a, 2)
            s2, f2 = x.send(t2, ENR2, a, 1)
            u, fu = x.teacher_upload(a, ENR1, 1, mode='add')
            assert g(f1, 'ok') and g(f2, 'ok') and fu.get('result') == 'sent', (f1, f2, fu)
            mark(x, page_ids(x, s1['submission_id'])[0])
            # One kept mark, as after Keep Photos Until: it must go with its submission too.
            x.run("""insert into markup_kept (file_id, submission_id, course_id, assessment_id, enrollment_id, page, rotation, added_by, working_rev, marked_at)
                     values (gen_random_uuid(), :s, :c, :a, :e, 9, 0, 'student', 1, now())""", s=s2['submission_id'], c=COURSE_A, a=a, e=ENR2)
            return s1, s2
        def all_queued(x, paths): return set(paths) <= set(queued(x))
        cases = [
            ('deleting the assessment', lambda x: x.rpc('delete_assessment(:a)', a=a), 'all'),
            ('permanently deleting a withdrawn student', lambda x: (x.rpc('withdraw_student(:e, :k)', e=ENR1, k=nid()), x.rpc('delete_withdrawn_student(:e, :k)', e=ENR1, k=nid())), ENR1),
            ("deleting a student's record (delete_student)", lambda x: x.run('delete from student where id = :s', s=STU1), ENR1),
            ('the 30-day purge of a deleted class (fv_retention_cleanup)', lambda x: (x.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=COURSE_A), x.run('select public.fv_retention_cleanup()')), 'all'),
            ("the 30-day purge of a deleted teacher's account (fv_retention_cleanup)", lambda x: (x.run("update teacher set deleted_at = now() - interval '31 days' where id = :t", t=A), x.run('select public.fv_retention_cleanup()')), 'all'),
            ("clear_data() (stand-in: it deletes the caller's classes and students)", lambda x: (x.run('delete from course where teacher_id = :t', t=A), x.run('delete from student where teacher_id = :t', t=A)), 'all'),
            ('TRUNCATE enrollment', lambda x: x.run('truncate enrollment cascade'), 'all'),
        ]
        for label, act, scope in cases:
            with tx(d):
                s1, s2 = setup(d)
                p1, p2 = paths_of(d, s1['submission_id']), paths_of(d, s2['submission_id'])
                want = p1 + p2 if scope == 'all' else p1
                keep_ = [] if scope == 'all' else p2
                r = attempt(lambda: act(d))
                ok('%s: it runs' % label, not (isinstance(r, str) and r.startswith('ERROR')), r)
                ok('%s: every file of the work it removes is queued, the teacher\'s added page included' % label, all_queued(d, want), (want, queued(d)))
                ok('%s: and no other' % label, not (set(keep_) & set(queued(d))))
                drain(d)
                ok('%s: the worker then deletes exactly those from storage' % label,
                   not (set(want) & set(stored(d))) and set(keep_) <= set(stored(d)), stored(d))
                ok('%s: kept Mark Up goes with its work' % label,
                   d.one('select count(*) from markup_kept') == (1 if scope != 'all' else 0))
                ok('%s: no page row is left without its work, and no file of a page row is queued' % label,
                   not d.all('select 1 from submission_file f where not exists (select 1 from submission s where s.id = f.submission_id)')
                   and not d.all('select 1 from submission_file f join submission_file_removal r on r.path in (f.path, f.thumb_path) and not r.done'))
    finally:
        d.close()

def secrets(d, url=URL, secret=SECRET):
    d.run('delete from vault.secrets')
    if url is not None: d.run("insert into vault.secrets (name, secret) values ('fv_photo_sweep_url', :u)", u=url)
    if secret is not None: d.run("insert into vault.secrets (name, secret) values ('fv_photo_sweep_secret', :s)", s=secret)
def calls(d): return d.all('select url, body::text, headers::text, timeout_milliseconds from net.http_request_queue order by id')

@scenario('timer')
def scen_timer():
    d, k, t1, t2 = world('timer', True); a = k['takes']
    try:
        jobs = {r[0]: (r[1], r[2], r[3]) for r in d.all("select jobname, schedule, command, active from cron.job")}
        ok('the two pg_cron jobs are scheduled with their tested times and commands, and the repair job is untouched',
           all(jobs.get(n) == (s, c, True) for n, (s, c) in JOBS.items()) and jobs.get('fv_grade_return_repair_daily', (None,))[0] == '47 10 * * *', jobs)
        with tx(d):
            secrets(d)
            ok('nothing queued: nothing due, nothing sent', d.one('select public.photo_removal_due()') is False
               and d.one('select public.photo_removal_call()') is None and not calls(d))
            s, f = d.send(t1, ENR1, a, 1); u = d.unsend(t1, ENR1, a)
            ok('after an Unsend (two files queued): due', d.one('select public.photo_removal_due()') is True, u)
            rid = d.one('select public.photo_removal_call()')
            c = calls(d)
            ok('one call: to the function\'s address, route scheduled-sweep with the secret, JSON, a 10-second wait',
               rid is not None and len(c) == 1 and c[0][0] == URL and json.loads(c[0][1]) == {'route': 'scheduled-sweep', 'secret': SECRET}
               and json.loads(c[0][2]) == {'Content-Type': 'application/json'} and c[0][3] == 10000, c)
            d.service('student_submit.removal_batch(:n)', n=10)   # the worker takes them (and has not said done)
            ok('within five minutes of the worker taking a batch: not due again (no second call while one runs)',
               d.one('select public.photo_removal_due()') is False and d.one('select public.photo_removal_call()') is None and len(calls(d)) == 1)
            d.run("update submission_file_removal set last_try_at = now() - interval '6 minutes'")
            ok('a batch taken six minutes ago and never reported done: due again', d.one('select public.photo_removal_due()') is True)
            drain(d)
            ok('drained (each removed while its upload link could still be used waits for that link to die): not due',
               d.one('select public.photo_removal_due()') is False)
            d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute', last_try_at = now() - interval '6 minutes'")
            ok('once the last upload link has died, the file is offered once more: due', d.one('select public.photo_removal_due()') is True)
        for label, url, secret in [('without the address', None, SECRET), ('without the secret', URL, None),
                                   ('with an address outside the function', 'https://evil.example.com/functions/v1/student-submit?forceFunctionRegion=ca-central-1x', SECRET),
                                   ("with another project's address", URL.replace('novsfeqjhbleyyaztmlh', 'abcdefghijklmnopqrst'), SECRET),
                                   ('with another host made to look like it', URL.replace('.supabase.co', '.supabase.co.evil.example'), SECRET),
                                   ('with an address that is not Canada\'s', URL.replace('ca-central-1', 'us-east-1'), SECRET),
                                   ('with plain http', URL.replace('https', 'http'), SECRET),
                                   ('with a secret that is not 64 hex', URL, 'abc'), ('with upper-case hex', URL, SECRET.upper())]:
            with tx(d):
                secrets(d, url, secret)
                d.send(t1, ENR1, a, 1); d.unsend(t1, ENR1, a)
                e = refused(d, lambda: d.one('select public.photo_removal_call()'))
                ok('a due run %s fails (so pg_cron records it), sends nothing, and never names the secret' % label,
                   e is not None and not calls(d) and SECRET not in e[0] and (secret or 'x') not in e[0], e)
        for role in ('anon', 'authenticated', 'service_role'):
            for fn in NEW + [PROC]:
                callable_ = d.one("select has_function_privilege(:r, to_regprocedure(:f), 'execute')", r=role, f=fn)
                if callable_: ok('%s cannot run %s' % (role, fn), False)
            for t in ('markup_kept', 'photo_keep_check', 'photo_check_log'):
                if d.one("select has_table_privilege(:r, 'public.' || :t, 'select, insert, update, delete')", r=role, t=t):
                    ok('%s cannot read or write %s' % (role, t), False)
        ok('anon, authenticated and service_role can run none of the eight functions and the procedure, and touch none of the three tables', True)
    finally:
        d.close()

@scenario('nightly')
def scen_nightly():
    """The procedure, committing class by class (no surrounding transaction)."""
    d, k, t1, t2 = world('nightly', True); a = k['takes']
    try:
        tb, _ = d.session(ENR_B, course=COURSE_B, teacher=B, birthday='2012-07-17')
        s1, _ = d.send(t1, ENR1, a, 1); sb, _ = d.send(tb, ENR_B, k['b_takes'], 1)
        # Both classes' day long gone: last school year's photos.
        for s in (s1, sb): set_created(d, s['submission_id'], '2026-06-15 12:00 America/Vancouver')
        judged(d, COURSE_A, '2026-06-01'); judged(d, COURSE_B, '2026-11-01')
        holder = d.other(); holder.run('begin'); holder.run('select 1 from course_sync_cursor where course_id = :c for update', c=COURSE_B)
        d.run("set lock_timeout = '1s'")
        for step in ("public._photo_keep_class(:c, now())", "public._photo_strays(:c, now())"):
            e = refused(d, lambda: d.one('select ' + step, c=COURSE_B))
            ok('%s waits for the class\'s lock first (here: gives up after the 1 second this test allows)' % step.split('(')[0], e is not None and e[1] == '55P03', e)
        d.run('reset lock_timeout')
        t0 = time.time()
        e = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        took = time.time() - t0
        holder.run('rollback'); holder.close()
        ok("a class whose lock is held (Teacher B's) is skipped after 10 seconds, the run ends in an error naming how many parts failed",
           isinstance(e, str) and 'part(s) of this run failed' in e and 9 < took < 40, (e, took))
        ok('the skipped class is logged (error, with its SQLSTATE) and nothing of it changed',
           d.one("select detail->>'sqlstate' from photo_check_log where kind = 'error' and course_id = :c", c=COURSE_B) == '55P03'
           and len(page_ids(d, sb['submission_id'])) == 1)
        ok("the other class was done and committed: its photos from June (Keep Photos Until long past, caught up from June 1) are gone",
           page_ids(d, s1['submission_id']) == [] and len(queued(d, 'keep_photos_until')) == 2)
        e2 = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        ok('the next night catches the skipped class up', e2 == [] or e2 is None or not isinstance(e2, str), e2)
        # Teacher B's class was looked at through Nov 1 only; June 30 is before that, so its June photos are judged by
        # days from Nov 2: End of Year's day (next June 30) is ahead, and they stay until then.
        ok("a class the job already looked at past its day keeps what was sent before (judged from the days it has not looked at)",
           len(page_ids(d, sb['submission_id'])) == 1)
        ok('the job remembers yesterday for both classes', d.one('select count(*) from photo_keep_check where checked_through = ((now() at time zone \'America/Vancouver\')::date - 1)') == 2)
        d.run("insert into photo_check_log (at, kind, n) values (now() - interval '91 days', 'stray_queued', 1)")
        d.run("insert into photo_keep_check (course_id, checked_through) values (gen_random_uuid(), '2026-01-01')")
        d.run('call public.photo_lifecycle_nightly()')
        ok("log rows older than 90 days and the job's state for a class that is gone are removed",
           d.one("select count(*) from photo_check_log where at < now() - interval '90 days'") == 0
           and d.one('select count(*) from photo_keep_check k where not exists (select 1 from course c where c.id = k.course_id)') == 0)
    finally:
        d.close()

def procs(d):
    return d.all("""select n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')', md5(pg_get_functiondef(p.oid))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'student_submit', 'fv_private') order by 1""")

@scenario('apply')
def scen_apply():
    text = neutral(text_at(FILE_USED)) if MUTATED else text_at(FILE)
    sts = split(text)
    ok('the file is one transaction: begin first, commit last', bare(sts[0]).lower() == 'begin' and bare(sts[-1]).lower() == 'commit')
    ok('the file names no score table, grade_return, revision_request writes or a student\'s name column',
       not re.search(r'\b(insert into|update|delete from)\s+(public\.)?(score|tag_score|rubric_score|rubric_check_score|grade_return|revision_request|feedback_reflection|student|enrollment)\b', text, re.I)
       and not re.search(r'\b(first_name|last_name|preferred_name|date_of_birth|student_number)\b', text))
    d = WorkDb('pl_apply', template=template(False)); k = seed_work(d)
    try:
        t1, _ = d.session(ENR1)
        s, f = d.send(t1, ENR1, k['takes'], 1)
        d.run("insert into vault.secrets (name, secret) values ('fv_photo_sweep_url', :u), ('fv_photo_sweep_secret', :s)", u=URL, s=SECRET)
        pre = d.statements(split(text_at(PRE))[:1]); pre_rows = d.rows
        ok('the pre-check on the database as live will be: no rows', pre == 'ok' and pre_rows == [], (pre, pre_rows))
        post = d.file(POST)
        ok('the post-check before the apply lists the eight functions, the procedure, the three tables and the two jobs',
           post == 'ok' and len(d.rows) >= 14, (post, d.rows))
        def stopped(setup, want):
            with tx(d):
                for st in setup: d.run(st)
                r = d.statements(split(text))
                d.begin()   # statements() rolled back; tx's rollback needs one open
                return r.startswith('STOPPED') and want in r, r
        for label, setup, want in [
            ('without pg_net', ['drop function net.http_post(text,jsonb,jsonb,jsonb,integer)'], 'pg_net is not installed'),
            ('without pg_cron', ['drop function cron.schedule(text,text,text)'], 'pg_cron is not installed'),
            ('without Vault', ['drop view vault.decrypted_secrets'], 'Vault is not installed'),
            ('with a relied-on function changed (C2 not applied)', ['create or replace function public._markup_on_release() returns trigger language plpgsql as $f$ begin return null; end $f$'], 'is not the definition'),
            ('with a function of its name already there', ['create function public.photo_removal_due() returns boolean language sql as $f$ select false $f$'], 'already exists'),
            ('with a job of its name running something else', ["insert into cron.job (jobname, schedule, command) values ('fv_photo_removal', '* * * * *', 'select 1')"], 'runs something else'),
            ('with markup_kept missing and photo_check_log there', ['create table public.photo_check_log (id int)'], 'already exists'),
        ]:
            if MUTATED and ('relied-on' in label or 'of its name' in label): continue   # a mutant applies with its lists stood aside
            good, r = stopped(setup, want)
            ok('it stops, with nothing changed, %s' % label, good, r)
        before = procs(d); rows_before = row_checksums(d.c)
        cat0 = catalog(d.c)
        r = d.statements(split(text))
        ok('it applies on a database in use', r == 'ok', r)
        after = procs(d)
        changed = [p for p in dict(before) if dict(before)[p] != dict(after).get(p)]
        added = sorted(set(dict(after)) - set(dict(before)))
        ok('the only existing function changed is the one it replaces (_grading_started)', changed == REPLACED, changed)
        ok('it adds exactly its eight functions and the procedure', added == sorted(NEW + [PROC]), added)
        if MUTATED: return   # the rest compares fingerprints, which a mutant changes by design
        rows_after = row_checksums(d.c)
        moved = [t for t in rows_before if rows_before[t] != rows_after.get(t) and not t.startswith('cron.')]
        ok('no existing row of the app changes (only pg_cron gains its two jobs)', not moved, moved)
        ok('the post-check after: no rows', d.file(POST) == 'ok' and d.rows == [], d.rows)
        ok('the pre-check after says it is applied (the new functions, stops = no) and nothing stops',
           d.statements(split(text_at(PRE))[:1]) == 'ok' and d.rows and all(x[3] == 'no' for x in d.rows), d.rows)
        cat1 = catalog(d.c)
        r2 = d.file(FILE)
        ok('a second run: applies, changes nothing (no job made twice)', r2 == 'ok' and catalog(d.c) == cat1
           and d.one("select count(*) from cron.job where jobname like 'fv_photo%'") == 2, r2)
        with tx(d):
            d.run('delete from vault.secrets')
            ok('the post-check notices the Vault secrets missing (by name)', d.file(POST) == 'ok' and sum('Vault secret' in x[0] for x in d.rows) == 2, d.rows)
            d.begin()
        with tx(d):
            d.run("update cron.job set schedule = '0 * * * *' where jobname = 'fv_photo_removal'")
            ok('the post-check notices a job changed', d.file(POST) == 'ok' and any('fv_photo_removal' in x[0] for x in d.rows), d.rows)
            d.begin()
        with tx(d):
            d.run('grant execute on function public.photo_removal_call() to service_role')
            ok('the post-check notices a grant', d.file(POST) == 'ok' and any('who can run' in x[0] for x in d.rows), d.rows)
            d.begin()
        for rel in ['../2026111101_student_work_submissions.sql', C1, C2, SEND_RULES]:
            with tx(d):
                rr = d.file(rel)
                ok('%s run again after this file: it does what it did (this file changes none of its functions)' % os.path.basename(rel),
                   rr == 'ok' or ('STOPPED' in rr and 'photo' not in rr), rr)
                d.begin()
    finally:
        d.close()

@scenario('undo')
def scen_undo():
    d = WorkDb('pl_undo', template=template(False)); k = seed_work(d)
    try:
        cat0 = catalog(d.c); p0 = procs(d)
        r0 = d.file(UNDO)
        ok('the undo where the file was never applied: runs, changes nothing', r0 == 'ok' and catalog(d.c) == cat0, (r0, differences(cat0, catalog(d.c))))
        ok('the file applies', d.file(FILE) == 'ok')
        t1, _ = d.session(ENR1)
        s, f = d.send(t1, ENR1, k['takes'], 1)
        mark(d, page_ids(d, s['submission_id'])[0])
        set_created(d, s['submission_id'], '2026-06-15 12:00 America/Vancouver')
        judged(d, COURSE_A, '2026-06-01')
        d.run('call public.photo_lifecycle_nightly()')
        ok('(setup) a night ran: the photo is gone and its mark is kept', d.one('select count(*) from markup_kept') == 1)
        r = d.file(UNDO)
        ok('PART 1 unschedules both jobs; PART 2 then refuses while marks are kept, saying so',
           'STOPPED' in r and 'markup_kept' in r and d.one("select count(*) from cron.job where jobname like 'fv_photo%'") == 0
           and to_reg(d, 'public.markup_kept'), r)
        ok('the repair job is left alone', d.one("select count(*) from cron.job where jobname = 'fv_grade_return_repair_daily'") == 1)
        d.run('delete from public.markup_kept')
        r = d.file(UNDO)
        ok('with the kept marks deleted on purpose: it runs', r == 'ok', r)
        cat = catalog(d.c)
        diff = differences(cat0, cat)
        ok('the catalog is as before the file, but for the rows the night added to Batch B\'s queue (data, not catalog)', cat == cat0, diff)
        ok('every function as before', procs(d) == p0)
        ok('the queue still names what the night queued, for the worker', len(queued(d, 'keep_photos_until')) == 2)
        r9 = d.file(UNDO)
        ok('the undo a second time: runs, changes nothing', r9 == 'ok' and catalog(d.c) == cat, (r9, differences(cat, catalog(d.c))))
        ok('the file applies again after the undo', d.file(FILE) == 'ok')
    finally:
        d.close()
def to_reg(d, t): return d.one('select to_regclass(:t) is not null', t=t)

# ── The independent review's probes, kept (batch-d-review.md: M1 to M4, decisions) ──
def midnight(d):
    """A zone where it is now between midnight and one in the morning: (zone, its today, that midnight as text)."""
    for n in range(-14, 13):
        tz = 'Etc/GMT%+d' % n
        if d.one('select extract(hour from now() at time zone :z)::int', z=tz) == 0:
            return tz, d.one('select (now() at time zone :z)::date', z=tz), d.one("select (date_trunc('day', now() at time zone :z) at time zone :z)::text", z=tz)
    raise RuntimeError('no zone at midnight')
def back(d, sid, at):
    """A send's (or upload's) first start moved to `at`, as if it had started then."""
    d.run('update submission set created_at = :t::timestamptz where id = :s', t=at, s=sid)
    d.run('update submission_file set created_at = :t::timestamptz where submission_id = :s', t=at, s=sid)
def tupload(d, a, e, mode, started):
    """A teacher's upload started at `started` and finished now: (start, finish)."""
    u = d.rpc('start_work_upload(:a, :e, :p::jsonb, :m, :k)', a=a, e=e, p=json.dumps([{'width': 1500, 'height': 2000}]), m=mode, k=nid())
    back(d, u['submission_id'], started)
    for x in u['files']:
        for pth in (x['path'], x['thumb_path']): d.storage.put_as('authenticated', A, pth)
    return u, d.rpc('finish_work_upload(:s, :f::jsonb, :k)', s=u['submission_id'], f=json.dumps([{'file_id': x['file_id'], 'sha256': HASH} for x in u['files']]), k=nid())

@scenario('review')
def scen_review():
    # M1: a send started inside its two hours before midnight and handed in after it (ruling 106), for real.
    d, k, t1, t2 = world('rv_m1'); a = k['takes']
    try:
        tz, today, mid = midnight(d)
        yday = today - datetime.timedelta(days=1)
        at = lambda hm, day=yday: '%s %s %s' % (day, hm, tz)
        keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [yday, today + datetime.timedelta(days=60)], tz=tz)
        b2 = photo_piece(d, title='Second Lab'); b3 = photo_piece(d, title='Third Lab')
        d.run('update assessment set due_date = :d where id = :a', d=yday, a=a)   # due on the term's last day
        early, ef = d.send(t2, ENR2, a, 1)
        set_created(d, early['submission_id'], at('23:00'))
        d.run('update submission set sent_at = :t::timestamptz, updated_at = :t::timestamptz where id = :s', t=at('23:20'), s=early['submission_id'])
        s = d.send_start(t1, ENR1, a, 1)
        back(d, s['submission_id'], at('23:30'))
        d.upload(s['files']); f = d.send_finish(t1, ENR1, s['submission_id'], s['files'])
        ok('(setup) a send started 23:30 on the last day is handed in after midnight, Late (ruling 106)', g(f, 'ok') is True and f.get('late') is True, f)
        u, uf = tupload(d, b2, ENR1, 'new', at('23:50'))
        old, _ = d.send(t2, ENR2, b3, 1)
        set_created(d, old['submission_id'], at('10:00', yday - datetime.timedelta(days=3)))
        d.run('update submission set updated_at = sent_at where id = :s', s=old['submission_id'])
        old_page = page_ids(d, old['submission_id'])
        m2, mf = tupload(d, b3, ENR2, 'add', at('23:50'))
        ok("(setup) the teacher's two uploads finish after midnight", uf.get('result') == 'sent' and mf.get('result') == 'sent', (uf, mf))
        night(d, COURSE_A, '%s 03:27 %s' % (today, tz))
        ok('M1: the night after the term, work handed in before midnight goes', page_ids(d, early['submission_id']) == [])
        ok("M1: a student's send started at 23:30 on the last day and handed in after midnight STAYS (handed in after the day)",
           len(page_ids(d, s['submission_id'])) == 1)
        ok("M1: the teacher's Add Work started at 23:50 and finished after midnight STAYS", len(page_ids(d, uf['submission']['id'])) == 1, uf)
        left = page_ids(d, old['submission_id'])
        ok("M1: a page the teacher added after midnight stays, while the work's older page goes", len(left) == 1 and left != old_page, (left, old_page))
    finally:
        d.close()

    # M2: the setting changed during nights the job missed: those nights are not judged by it (probe P7).
    d, k, t1, t2 = world('rv_m2'); a = k['takes']
    try:
        s, f = d.send(t1, ENR1, a, 1); sid = s['submission_id']
        set_created(d, sid, '2026-11-19 12:00 America/Vancouver')
        judged(d, COURSE_A, '2026-11-17')   # End of Year, as the teacher had it
        terms(d, COURSE_A, [D(2026, 11, 20), D(2027, 1, 29)]); keep(d, COURSE_A, 'end_of_term')   # switched Nov 23, the job down
        shown = d.one("select public._keep_photos_day('end_of_term', reporting_terms, '2026-11-23')::text from course where id = :c", c=COURSE_A)
        night(d, COURSE_A, run_on('2026-11-25'))
        ok('M2: switched to End of Term during a missed week (the screen showed %s): the Nov 19 photo is KEPT' % shown, len(page_ids(d, sid)) == 1)
        st = attempt(lambda: d.all('select checked_through::text, judged_choice from photo_keep_check where course_id = :c', c=COURSE_A))
        ok('M2: the job now remembers the setting it judged with', st == [['2026-11-24', 'end_of_term']], st)
        night(d, COURSE_A, run_on('2027-01-30'))
        ok('M2: and the photo goes the night after the date the screen showed (Jan 29)', page_ids(d, sid) == [])
    finally:
        d.close()
    d, k, t1, t2 = world('rv_m2b'); a = k['takes']
    try:
        keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [D(2026, 11, 20), D(2027, 1, 29)])
        s, f = d.send(t1, ENR1, a, 1); sid = s['submission_id']
        set_created(d, sid, '2026-11-19 12:00 America/Vancouver')
        judged(d, COURSE_A, '2026-11-17')
        terms(d, COURSE_A, [D(2026, 11, 21), D(2027, 1, 29)])   # Term 1 moved a day later while the job was down
        night(d, COURSE_A, run_on('2026-11-25'))
        ok('M2: terms edited during a missed week: those nights are not judged by the new terms either (kept)', len(page_ids(d, sid)) == 1)
    finally:
        d.close()

    # M3: calls that fail are seen.
    d, k, t1, t2 = world('rv_m3'); a = k['takes']
    try:
        secrets(d)
        s, f = d.send(t1, ENR1, a, 1); d.unsend(t1, ENR1, a)
        d.run("update submission_file_removal set queued_at = now() - interval '7 hours'")
        r1 = d.one('select public.photo_removal_call()'); r2 = d.one('select public.photo_removal_call()')
        errs = d.all("select n, detail->>'stuck_files' from photo_check_log where kind = 'error'")
        ok('M3: files due for 7 hours: the timer logs it (once an hour, not every call) and still makes the call',
           r1 is not None and r2 is not None and errs == [[1, '2']] and len(calls(d)) == 2, (errs, calls(d)))
        e = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        ok('M3: and the nightly run ends in an error, so pg_cron records it as failed', isinstance(e, str) and 'stuck in the queue' in e, e)
        drain(d)
        d.run("update submission_file_removal set link_dies_at = now() - interval '1 minute'")
        drain(d)
        e2 = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        ok('M3: once the files are gone, the night is clean again', not (isinstance(e2, str) and e2.startswith('ERROR')), e2)
        d.run('delete from submission_file_removal')
        s, f = d.send(t1, ENR1, a, 1); d.unsend(t1, ENR1, a)
        d.run("update submission_file_removal set queued_at = now() - interval '5 hours'")
        e3 = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        ok('M3: due for 5 hours is not yet called stuck', not (isinstance(e3, str) and e3.startswith('ERROR')), e3)
    finally:
        d.close()

    # M4: a class with no submission rows still has its strays found (probe P2).
    d, k, t1, t2 = world('rv_m4'); a = k['takes']
    try:
        name = lay(COURSE_A); plant(d, name, 48)
        ok('(setup) class A has no submission rows', d.one('select count(*) from submission where course_id = :c', c=COURSE_A) == 0)
        e = attempt(lambda: d.run('call public.photo_lifecycle_nightly()'))
        ok('M4: a 48-hour-old stray in a class with no submission rows is queued by the nightly job', name in queued(d, 'stray'), (e, queued(d)))
    finally:
        d.close()

    # The stray scan reads only the class's own names (probe P9).
    d, k, t1, t2 = world('rv_p9'); a = k['takes']
    try:
        d.run("""insert into storage.objects (bucket_id, name, metadata, created_at)
                 select 'student-photos', :c || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg',
                        '{"size":1000}', now() - interval '30 days' from generate_series(1, 200000)""", c=COURSE_B)
        d.run("insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at) select bucket_id, name, :c, 'x', now() from storage.objects where bucket_id = 'student-photos'", c=COURSE_B)
        mine = lay(COURSE_A); plant(d, mine, 48)
        d.run('analyze')
        t = time.time(); r = d.one('select public._photo_strays(:c, now())', c=COURSE_A); took = time.time() - t
        print('# strays pass for one class with 200,000 other files in the bucket: %.3f s' % took)
        ok("strays: one class's pass, with 200,000 of another class's files in the bucket, reads by name range (under 1 s; was 6.8 s)",
           took < 1.0 and r.get('queued') == 1, (took, r))
    finally:
        d.close()

    # Decisions: kept marks lock the work; End of Term after the last term; a class in the trash.
    d, k, t1, t2 = world('rv_dec'); a = k['takes']
    try:
        s, f = d.send(t1, ENR1, a, 1); sid = s['submission_id']
        mark(d, page_ids(d, sid)[0])
        set_created(d, sid, '2026-06-15 12:00 America/Vancouver')
        night(d, COURSE_A, run_on('2026-07-01'))
        ok('(setup) the photo is gone and its marks are kept', page_ids(d, sid) == [] and d.one('select count(*) from markup_kept') == 1)
        rp = d.send_start(t1, ENR1, a, 1, replace=True); un = d.unsend(t1, ENR1, a)
        ok("decision 5: kept marks count as grading started: the student's Replace and Unsend are refused, and the marks stay",
           g(rp, 'error') == 'grading_started' and g(un, 'error') == 'grading_started' and d.one('select count(*) from markup_kept') == 1, (rp, un))
        d.run("""update markup_kept set working = '{"v": 1, "marks": []}'::jsonb""")
        un2 = d.unsend(t1, ENR1, a)
        ok('decision 5: kept marks all erased do not count (as C1 reads marks)', g(un2, 'ok') is True, un2)
    finally:
        d.close()
    d, k, t1, t2 = world('rv_p3'); a = k['takes']
    try:
        keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [D(2026, 9, 30), D(2026, 10, 30)])
        s, f = d.send(t1, ENR1, a, 1); sid = s['submission_id']
        set_created(d, sid, '2026-11-12 09:00 America/Vancouver')
        judged(d, COURSE_A, '2026-11-11')
        night(d, COURSE_A, run_on('2026-11-13'))
        ok('End of Term with every term ended: work sent Nov 12 is KEPT (no next-night deleting)', len(page_ids(d, sid)) == 1)
        night(d, COURSE_A, run_on('2027-06-30'))
        ok('... kept through June 30, as End of Year', len(page_ids(d, sid)) == 1)
        night(d, COURSE_A, run_on('2027-07-01'))
        ok('... and gone that night', page_ids(d, sid) == [])
    finally:
        d.close()
    d, k, t1, t2 = world('rv_p5'); a = k['takes']
    try:
        s, f = d.send(t1, ENR1, a, 1); sid = s['submission_id']
        set_created(d, sid, '2027-06-10 12:00 America/Vancouver')
        d.run("update course set deleted_at = '2027-06-25' where id = :c", c=COURSE_A)
        night(d, COURSE_A, run_on('2027-07-01'))
        ok('a class in the trash on its day is skipped: its photos stay (they go with the 30-day purge)', len(page_ids(d, sid)) == 1)
        d.run('update course set deleted_at = null where id = :c', c=COURSE_A)
        night(d, COURSE_A, run_on('2027-07-02'))
        ok('restored: judged as usual the night after (End of Year in July: the June photos go)', page_ids(d, sid) == [])
    finally:
        d.close()

    # Two nightly runs at once (probe P8): files queued once, one log row per class.
    d, k, t1, t2 = world('rv_p8'); a = k['takes']
    try:
        tb, _ = d.session(ENR_B, course=COURSE_B, teacher=B, birthday='2012-07-17')
        s1, _ = d.send(t1, ENR1, a, 2); sb, _ = d.send(tb, ENR_B, k['b_takes'], 1)
        for x in (s1, sb): set_created(d, x['submission_id'], '2026-06-15 12:00 America/Vancouver')
        judged(d, COURSE_A, '2026-06-01'); judged(d, COURSE_B, '2026-06-01')
        res = []
        def go():
            c = d.other()
            try: c.run('call public.photo_lifecycle_nightly()'); res.append('ok')
            except Exception as e: res.append(message(e)[:200])
            finally: c.close()
        th = [threading.Thread(target=go) for _ in range(2)]
        [t.start() for t in th]; [t.join() for t in th]
        q = d.one("select count(*) from submission_file_removal where reason = 'keep_photos_until'")
        logs = d.all("select kind from photo_check_log where kind = 'keep_photos_until'")
        ok('two nightly runs at once: both end well, 6 files queued once, one log row per class', res == ['ok', 'ok'] and q == 6 and len(logs) == 2, (res, q, logs))
    finally:
        d.close()

    # The pre-check's second query: per class, the day and the pages before it (counts only).
    d, k, t1, t2 = world('rv_pre', False); a = k['takes']
    try:
        s, f = d.send(t1, ENR1, a, 2)
        keep(d, COURSE_A, 'end_of_term'); terms(d, COURSE_A, [D(2026, 10, 30)])
        pre = split(text_at(PRE))
        results = []
        for st in pre:
            r = d.c.run(st)
            if bare(st).lower().startswith(('select', 'with')): results.append([[plain(v) for v in x] for x in (r or [])])
        ok('the pre-check has two queries', len(results) == 2, len(results))
        rows = results[-1]
        ok('its second lists the class with photos: End of Term with every term ended reads June 30 (not passed), 2 pages before it, not tonight',
           len(rows) == 1 and rows[0][0] == COURSE_A and rows[0][1:5] == ['end_of_term', '2027-06-30', 'no', 'no'] and rows[0][5] == 2 and rows[0][6] == 'no', rows)
        d.run("update course set keep_photos_until = 'end_of_year', timezone = 'Etc/GMT+12' where id = :c", c=COURSE_A)
        d.run("update course set reporting_terms = null where id = :c", c=COURSE_A)
        rows = [[plain(v) for v in x] for x in d.c.run(pre[-1])]
        ok('End of Year reads next June 30', rows and rows[0][1:3] == ['end_of_year', '2027-06-30'], rows)
        ok('the second query reads no student column (counts only)',
           not re.search(r'\b(first_name|last_name|preferred_name|date_of_birth|student_number|note)\b', pre[-1]))
    finally:
        d.close()

# ── Wrong versions of the file: does this suite notice? ─────────────────────
# (what is wrong, the text, what it becomes, the scenario that must notice)
DEL = "where s.id = f.submission_id and s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff\n           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff);"
CLS = "               and o.created_at < p_now - interval '24 hours'\n               and o.name ~ _layout\n               and not exists (select 1 from submission_file f where f.path = o.name)\n               and not exists (select 1 from submission_file f where f.thumb_path = o.name)\n               and not exists (select 1 from submission_file_removal r where r.bucket = o.bucket_id and r.path = o.name and not r.done)\n        ), q as (\n            insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)\n            select _work_bucket(), s.name, p_course_id"
MUTANTS = [
    ('the cutoff is the start of the day itself, not the day after (photos sent on the last day stay)',
     'return (_due + 1)::timestamp at time zone _tz;', 'return _due::timestamp at time zone _tz;', 'keep'),
    ('a day counts only once its Keep Photos Until day is before it (< for <=): a day late',
     'where _keep_photos_day(_c.keep_photos_until, _c.reporting_terms, g.d::date) <= g.d::date;',
     'where _keep_photos_day(_c.keep_photos_until, _c.reporting_terms, g.d::date) < g.d::date;', 'keep'),
    ('today counts too: photos go the morning of the day, not the night after it',
     'generate_series(_from, _today - 1, interval', 'generate_series(_from, _today, interval', 'keep'),
    ("the class's day is the server's, not the class's time zone", '_today := (p_now at time zone _tz)::date;', "_today := (p_now at time zone 'UTC')::date;", 'keep'),
    ("the cutoff is Vancouver's midnight, whatever the class's zone", 'return (_due + 1)::timestamp at time zone _tz;', "return (_due + 1)::timestamp at time zone 'America/Vancouver';", 'keep'),
    ("a class's first night looks back 400 days (a Term 1 day already gone comes back after a switch)",
     '        _from := _today - 1;\n    else', '        _from := _today - 400;\n    else', 'keep'),
    ('no catch-up: only yesterday is ever looked at', '_from := greatest(_k.checked_through + 1, _today - 400);', '_from := _today - 1;', 'keep'),
    ('the job never remembers the days it looked at', 'set checked_through = greatest(photo_keep_check.checked_through, excluded.checked_through),',
     'set checked_through = photo_keep_check.checked_through,', 'keep'),
    ('unfinished sends are deleted too', DEL, DEL.replace(" and s.state = 'sent'", ''), 'keep'),
    # Not a mutant: taking out 'f.created_at < _cutoff' alone changes nothing, because a page made after the cutoff is on
    # work handed in after it, which the ruling-106 test keeps anyway (checked: keep 36 of 36 with it out).
    ('another class is touched', DEL, DEL.replace(' and s.course_id = p_course_id', ''), 'keep'),
    ('Mark Up is not kept', "         where s.course_id = p_course_id and s.state = 'sent' and f.created_at < _cutoff\n           -- handed in after the day",
     "         where false\n           -- handed in after the day", 'keep'),
    ('M1 taken out: work handed in after midnight goes if its send started before', DEL,
     DEL.replace('\n           and not (f.created_at >= _cutoff - _work_hold() and greatest(s.sent_at, s.updated_at) >= _cutoff);', ';'), 'review'),
    ("M1 reads sent_at only (a teacher's Add as More Pages after midnight goes)", DEL, DEL.replace('greatest(s.sent_at, s.updated_at)', 's.sent_at'), 'review'),
    ('M1 keeps every page of work touched after midnight, however old', DEL, DEL.replace('f.created_at >= _cutoff - _work_hold() and ', ''), 'review'),
    ('M2 taken out: missed nights judged by the setting now',
     'if not found or _k.judged_choice is distinct from _c.keep_photos_until or _k.judged_terms is distinct from _c.reporting_terms then',
     'if not found then', 'review'),
    ('M2 forgets the terms (an edit to them during missed nights counts)', ' or _k.judged_terms is distinct from _c.reporting_terms then', ' then', 'review'),
    ('M3: stuck after 4 hours, not 6', "     where x.since < now() - interval '6 hours';", "     where x.since < now() - interval '4 hours';", 'review'),
    ('M3: the nightly run does not fail on stuck files',
     "        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));\n        _failed := _failed + 1;",
     "        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));", 'review'),
    ('M3: the timer never says files are stuck', "    if (_stuck->>'n')::int > 0\n       and not exists", "    if false\n       and not exists", 'review'),
    ('M3: the timer says it on every call', " and l.at > now() - interval '1 hour') then", " and l.at > now() + interval '1 hour') then", 'review'),
    ('M4 taken out: only classes with work are visited',
     "        union\n        select c.id from public.course c\n         where c.id in (select distinct fv_private.work_path_course(o.name)",
     "        union\n        select c.id from public.course c\n         where false and c.id in (select distinct fv_private.work_path_course(o.name)", 'review'),
    ('the stray scan reads the whole bucket for each class',
     "               and o.name >= (p_course_id::text || '/') collate \"C\" and o.name < (p_course_id::text || '0') collate \"C\"",
     "               and fv_private.work_path_course(o.name) = p_course_id", 'review'),
    ('kept marks do not count as grading started (decision 5)',
     '        -- Mark Up kept after Keep Photos Until took its photos (2026111140)\n        or exists (select 1 from markup_kept k',
     '        -- Mark Up kept after Keep Photos Until took its photos (2026111140)\n        or false and exists (select 1 from markup_kept k', 'review'),
    ('a class in the trash is not skipped', "    if not found or _c.deleted_at is not null then", "    if not found then", 'review'),
    ('End of Term with no term end ahead: the last term, as before the review', 'else coalesce((select min(e.d) from e where e.d >= p_on), j.june)',
     'else coalesce((select min(e.d) from e where e.d >= p_on), (select max(e.d) from e), j.june)', 'keepday'),
    ('End of Year turns in July, not August', 'when extract(month from p_on) >= 8 then 1', 'when extract(month from p_on) >= 7 then 1', 'keepday'),
    ('expired sends are not dropped by the job', '_expired := _work_drop_expired(p_course_id);', '_expired := 0;', 'expired'),
    ('no class lock is taken', "    perform _grade_return_lock_first(p_course_id);\n    _expired", "    _expired", 'nightly'),
    ('a stray 22 hours old is queued', CLS, CLS.replace("interval '24 hours'", "interval '22 hours'"), 'strays'),
    ("a page's thumbnail is taken for a stray", CLS, CLS.replace("               and not exists (select 1 from submission_file f where f.thumb_path = o.name)\n", ''), 'strays'),
    ('a name of another shape is queued', CLS, CLS.replace('               and o.name ~ _layout\n', ''), 'strays'),
    ('a stray that comes back is not queued again',
     "select _work_bucket(), s.name, p_course_id, 'stray', now() from s\n            on conflict (bucket, path) do update\n                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',\n                    queued_at = now(), link_dies_at = now()\n              where submission_file_removal.done",
     "select _work_bucket(), s.name, p_course_id, 'stray', now() from s\n            on conflict (bucket, path) do update\n                set done = false, removed_at = null, tries = 0, last_try_at = null, reason = 'stray',\n                    queued_at = now(), link_dies_at = now()\n              where false", 'strays'),
    ('the strays of a class that is gone are never queued', "               and not exists (select 1 from course c where c.id = fv_private.work_path_course(o.name))", "               and false", 'strays'),
    ('unfinished sends are reported missing', "         where s.course_id = p_course_id and s.state = 'sent'\n           and (not exists", "         where s.course_id = p_course_id\n           and (not exists", 'strays'),
    ('the timer calls again while a batch is being worked',
     "       and not exists (select 1 from submission_file_removal r\n                        where not r.done and r.last_try_at > now() - interval '5 minutes');", ';', 'timer'),
    ('the timer calls when nothing is due', '    if not public.photo_removal_due() then\n        return null;\n    end if;\n', '', 'timer'),
    ("the timer's address may be any host (the check before the review)",
     "    if _url <> 'https://novsfeqjhbleyyaztmlh.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1' then",
     "    if _url !~ '^https://[a-z0-9.-]+/functions/v1/student-submit\\?forceFunctionRegion=ca-central-1$' then", 'timer'),
    ("the timer posts to the teacher's sweep", "jsonb_build_object('route', 'scheduled-sweep', 'secret', _secret)", "jsonb_build_object('route', 'sweep', 'secret', _secret)", 'timer'),
    ('the service role may run the timer', 'revoke all on procedure public.photo_lifecycle_nightly() from public, anon, authenticated, service_role;',
     'revoke all on procedure public.photo_lifecycle_nightly() from public, anon, authenticated, service_role;\ngrant execute on function public.photo_removal_call() to service_role;', 'timer'),
    ('the removal job runs hourly', "'fv_photo_removal', '*/10 * * * *'", "'fv_photo_removal', '0 * * * *'", 'timer'),
    ('the guard does not ask for pg_net', "    if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then", '    if false then', 'apply'),
]

def cmd_mutate(wanted):
    import tempfile
    out = os.environ.get('MUTANT_DIR') or tempfile.mkdtemp(prefix='pl_mutants_')
    base = text_at(FILE)
    picked = [(i, m) for i, m in enumerate(MUTANTS, 1) if not wanted or str(i) in wanted]
    noticed = []
    for i, (label, old, new, scen) in picked:
        if base.count(old) != 1:
            ok('mutant %d (%s) finds its text exactly once' % (i, label), False, base.count(old)); continue
        path = os.path.join(out, 'mutant_%02d.sql' % i)
        open(path, 'w').write(base.replace(old, new))
        r = subprocess.run([sys.executable, os.path.join(HERE, 'photo_lifecycle.py'), scen], capture_output=True, text=True,
                           env=dict(os.environ, PHOTO_LIFECYCLE_FILE=path), cwd=HERE)
        last = (r.stdout.strip().splitlines() or ['?'])[-1]
        caught = r.returncode != 0
        ok('mutant %d noticed by %s: %s (%s)' % (i, scen, label, last), caught, r.stderr[-300:])
        noticed.append(caught)
    print('# %d of %d wrong versions noticed' % (sum(noticed), len(noticed)))
    finish()

if __name__ == '__main__':
    args = sys.argv[1:]
    try:
        if args[:1] == ['fingerprints']:
            sys.exit(cmd_fingerprints(args[1:] == ['check']))
        if args[:1] == ['mutate']:
            sys.exit(cmd_mutate(args[1:]))
        names = args or [n for n in SCENARIOS]
        for n in names:
            base = n[:-len('-without')] if n.endswith('-without') else n
            f, without = SCENARIOS[base]
            if n.endswith('-without'):
                MODE['fixed'] = False; f(False); MODE['fixed'] = True
            else:
                f(True) if without else f()
                if without and not args: MODE['fixed'] = False; f(False); MODE['fixed'] = True
    finally:
        drop_templates()
    finish()
