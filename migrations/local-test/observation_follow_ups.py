"""Observation follow-ups: migrations/2026111703_observation_follow_ups.sql on a database rebuilt from the repo
and proved equal to live (scripts/db-rebuild.mjs --check; README.md, "Observation follow-ups").

    PGPORT=<port> PGDATABASE=<db> python3 observation_follow_ups.py           every scenario below
    PGPORT=<port> PGDATABASE=<db> python3 observation_follow_ups.py rules     or some

The database named by PGDATABASE is only a template: every scenario runs on its own copy, made and
dropped here. Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  rules    create_observation_follow_up and update_observation_follow_up as Teacher A, as Teacher B
           (A's observation is out of reach) and as a visitor; kinds, words, idempotency; the rule at the
           table (one level, same class, the link and the class never change, no students of a follow-up's
           own, through update_observation too); the check; delete cascades from the parent only.
  readers  Every reader of observations: get_class_bundle (list, total, follow_ups, profiles),
           get_observations (list, total, paging, follow_ups, every filter), get_term_rating's picker,
           get_withdrawn_student_records, list_course_student_profiles, delete_withdrawn_student; no
           student_submit function names the tables.
  same     With no follow-up, get_class_bundle and get_observations give, byte for byte, what they gave
           before the file, but for the new empty 'follow_ups'; every other reader gives the same answer.
  dates    p_created_at: kept when it is after the observation; the observation's own time when before
           it (an observation and its follow-up made offline together); refused more than 5 minutes ahead;
           now() when null.
  purge    fv_retention_cleanup purges a class, and a teacher, holding follow-ups: everything goes.
  restore  import_json_restore keeps a follow-up's link and kind, and refuses one whose parent is missing.
  race     A follow-up made while its parent is deleted, in both orders, on connections of their own:
           never a follow-up without its parent; two follow-ups at once.
  apply    The guards stop with the catalog unchanged; the file changes only what its header says and no
           row; a second run; the header's md5s; pre-check and post-check; lock timeout; the file's size.
  undo     Without the file it changes nothing; after it the catalog (but two dropped-column slots) and
           every row are as before; it stops while a follow-up exists; the fast stop; a second run.
"""
import json, os, re, sys, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from card_codes_common import Db, tx, refused, ok, finish, nid, connect, message, sqlstate, split, text_of
from catalog import catalog, differences, row_checksums, table_columns

FILE = '../2026111703_observation_follow_ups.sql'
UNDO = 'observation-follow-ups-undo.sql'
PRE = 'observation-follow-ups-live-precheck.sql'
POST = 'observation-follow-ups-live-postcheck.sql'
A = '11111111-1111-1111-1111-111111111111'; B = '22222222-2222-2222-2222-222222222222'
PATCHED = ['public.get_class_bundle(uuid,bigint)', 'public.get_observations(uuid,jsonb,integer,integer)',
           'public.import_json_restore(jsonb,uuid)']
NEW = ['public.create_observation_follow_up(uuid,text,text,uuid,timestamptz)', 'public.update_observation_follow_up(uuid,text,text,uuid)',
       'fv_private.observation_follow_up_rule()']
HEADER = text_of(FILE)

def md5(d, sig): return d.one('select md5(pg_get_functiondef(to_regprocedure(:s)))', s=sig)
def T(d, sql, uid=A, **kw): return d.teacher(sql, uid, **kw)
def has_file(d): return d.one("select exists (select 1 from pg_attribute where attrelid = 'public.observation'::regclass and attname = 'follow_up_of' and not attisdropped)")

class W: pass
def world(tag, applied=True):
    d = Db('fu_' + tag)
    w = W(); w.d = d
    d.run('alter table cron.job add column if not exists database text, add column if not exists username text, '
          'add column if not exists active boolean')
    d.run("insert into auth.users (id, email) values (:a, 'alpha@example.test'), (:b, 'bravo@example.test')", a=A, b=B)
    T(d, "bootstrap_teacher('alpha@example.test', 'Alpha Teacher')", A)
    T(d, "bootstrap_teacher('bravo@example.test', 'Bravo Teacher')", B)
    w.c = str(T(d, "create_course(p_name => 'Science 8', p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())"))
    w.c2 = str(T(d, "create_course(p_name => 'Science 8 B', p_subjects => array['Science'], p_idempotency_key => gen_random_uuid())"))
    w.cb = str(T(d, "create_course(p_name => 'Bravo Socials', p_subjects => array['Socials'], p_idempotency_key => gen_random_uuid())", B))
    def enrol(c, first, uid=A):
        return str(T(d, "create_student_and_enroll(:c, :f, 'Tester', p_idempotency_key => gen_random_uuid())", uid, c=c, f=first)['enrollment_id'])
    w.e1, w.e2 = enrol(w.c, 'Cece'), enrol(w.c, 'Dev')
    w.e3 = enrol(w.c2, 'Eli')
    w.eb = enrol(w.cb, 'Bravo Kid', B)
    def obs(c, e, body, sentiment, uid=A):
        return str(T(d, "create_observation(:c, :b, :s, null, null, array[:e::uuid], '{}', '{}', gen_random_uuid())", uid, c=c, b=body, s=sentiment, e=e))
    w.o1 = obs(w.c, w.e1, 'Left the lab early', 'concern')
    w.o2 = obs(w.c, w.e2, 'Strong lab partner', 'strength')
    w.o3 = obs(w.c2, w.e3, 'Other class note', 'note')
    w.ob = obs(w.cb, w.eb, 'BRAVO-SECRET observation', 'concern', B)
    w.obs = lambda *a, **k: obs(*a, **k)
    if applied: ok('(setup %s) the file applies' % tag, d.file(FILE) == 'ok', d.file(FILE))
    return w

def fu(w, parent, body='Called home', kind='called_home', uid=A, key=None):
    return str(T(w.d, "create_observation_follow_up(:p, :b, :k, :i::uuid)", uid, p=parent, b=body, k=kind, i=key or nid()))

# ── rules ─────────────────────────────────────────────────────────────────────────────────────────────
def scen_rules():
    w = world('rules'); d = w.d
    try:
        key = nid()
        f1 = fu(w, w.o1, 'Mom says he is tired', 'called_home', key=key)
        row = d.all('select course_id::text, body, sentiment, context_type, follow_up_of::text, follow_up_kind, dims::text, level, template_id from observation where id = :f', f=f1)[0]
        ok('rules: a follow-up is in its observation\'s class, with its words and kind and nothing else',
           row == [w.c, 'Mom says he is tired', None, None, w.o1, 'called_home', '{}', None, None], row)
        ok('rules: a follow-up has no students of its own', d.one('select count(*) from observation_student where observation_id = :f', f=f1) == 0)
        ok('rules: the same key gives the same follow-up, made once', fu(w, w.o1, 'again', 'resolved', key=key) == f1
           and d.one('select count(*) from observation where follow_up_of = :o', o=w.o1) == 1)
        f2 = fu(w, w.o1, '', 'resolved'); f3 = fu(w, w.o1, 'Just words', None)
        ok('rules: a kind alone, or words alone, makes a follow-up', d.one('select count(*) from observation where follow_up_of = :o', o=w.o1) == 3)
        for kind in ('called_home', 'spoke_with_student', 'still_happening', 'resolved'):
            ok('rules: kind %s is taken' % kind, refused(d, lambda: fu(w, w.o2, 'x', kind)) is None)
        e = refused(d, lambda: fu(w, w.o1, 'x', 'emailed_home'))
        ok('rules: an unknown kind is refused (22023)', e and e[1] == '22023', e)
        e = refused(d, lambda: fu(w, w.o1, '   ', None))
        ok('rules: neither a kind nor words is refused (22023)', e and e[1] == '22023', e)
        e = refused(d, lambda: fu(w, f1, 'x', 'resolved'))
        ok('rules: a follow-up of a follow-up is refused', e and 'cannot be followed up' in e[0], e)
        before_b = d.all("select id::text, body from observation where course_id = :c order by 1", c=w.cb)
        e = refused(d, lambda: fu(w, w.ob, 'x', 'resolved'))
        ok('rules: Teacher A cannot follow up Teacher B\'s observation (P0002, not found)', e and e[1] == 'P0002', e)
        e = refused(d, lambda: fu(w, w.o1, 'x', 'resolved', uid=B))
        ok('rules: Teacher B cannot follow up Teacher A\'s observation (P0002)', e and e[1] == 'P0002', e)
        ok('rules: B\'s rows did not change', d.all("select id::text, body from observation where course_id = :c order by 1", c=w.cb) == before_b)
        for fn in ('create_observation_follow_up(:p, :b)', 'update_observation_follow_up(:p, :b)'):
            e = refused(d, lambda: d.role('anon', 'select ' + fn, p=w.o1, b='x'))
            ok('rules: a visitor cannot run %s' % fn.split('(')[0], e and 'permission denied' in e[0], e)
            e = refused(d, lambda: d.role('authenticated', 'select ' + fn, '', p=w.o1, b='x'))
            ok('rules: signed out, %s is refused (PT401)' % fn.split('(')[0], e and e[1] == 'PT401', e)
        # update
        T(d, "update_observation_follow_up(:f, 'Mom says he is tired. Meeting Friday.', 'still_happening', gen_random_uuid())", f=f1)
        ok('rules: update changes the words and the kind',
           d.all('select body, follow_up_kind from observation where id = :f', f=f1)[0] == ['Mom says he is tired. Meeting Friday.', 'still_happening'])
        k2 = nid()
        T(d, "update_observation_follow_up(:f, 'one', 'resolved', :k::uuid)", f=f1, k=k2)
        T(d, "update_observation_follow_up(:f, 'two', 'called_home', gen_random_uuid())", f=f1)
        T(d, "update_observation_follow_up(:f, 'one', 'resolved', :k::uuid)", f=f1, k=k2)
        ok('rules: an update sent again with its key does not undo a later one',
           d.all('select body, follow_up_kind from observation where id = :f', f=f1)[0] == ['two', 'called_home'])
        e = refused(d, lambda: T(d, "update_observation_follow_up(:f, 'x', null, gen_random_uuid())", f=w.o1))
        ok('rules: update_observation_follow_up on an observation is refused (P0002)', e and e[1] == 'P0002', e)
        e = refused(d, lambda: T(d, "update_observation_follow_up(:f, 'x', null, gen_random_uuid())", B, f=f1))
        ok('rules: Teacher B cannot change A\'s follow-up (P0002)', e and e[1] == 'P0002', e)
        e = refused(d, lambda: T(d, "update_observation_follow_up(:f, 'x', 'bogus', gen_random_uuid())", f=f1))
        ok('rules: update refuses an unknown kind', e and e[1] == '22023', e)
        # the rule at the table, through the old write functions and directly
        e = refused(d, lambda: T(d, "update_observation(:f, '{}'::jsonb, array[:e::uuid])", f=f1, e=w.e1))
        ok('rules: update_observation cannot give a follow-up students', e and 'no students of its own' in e[0], e)
        e = refused(d, lambda: d.run("insert into observation_student (observation_id, enrollment_id) values (:f, :e)", f=f1, e=w.e2))
        ok('rules: no student row for a follow-up, even as the owner', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("update observation_student set observation_id = :f where observation_id = :o", f=f1, o=w.o2))
        ok('rules: a student row cannot be moved onto a follow-up', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("insert into observation (course_id, body, follow_up_of) values (:c, 'x', :p)", c=w.c2, p=w.o1))
        ok('rules: a follow-up in another class than its observation is refused', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("insert into observation (course_id, body, follow_up_of) values (:c, 'x', :p)", c=w.c, p=nid()))
        ok('rules: a follow-up of a missing observation is refused', e is not None, e)
        e = refused(d, lambda: d.run("update observation set follow_up_of = :p where id = :f", p=w.o2, f=f1))
        ok('rules: a follow-up cannot be moved to another observation', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("update observation set follow_up_of = :p where id = :o", p=w.o1, o=w.o2))
        ok('rules: an observation cannot become a follow-up', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("update observation set course_id = :c where id = :f", c=w.c2, f=f1))
        ok('rules: a follow-up cannot change class', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("update observation set course_id = :c where id = :o", c=w.c2, o=w.o1))
        ok('rules: an observation with follow-ups cannot change class', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("update observation set follow_up_kind = 'resolved' where id = :o", o=w.o2))
        ok('rules: only a follow-up may have a kind (the check)', e and e[1] == '23514', e)
        e = refused(d, lambda: d.run("update observation set follow_up_kind = 'phoned' where id = :f", f=f1))
        ok('rules: the check takes only the four kinds', e and e[1] == '23514', e)
        o4 = w.obs(w.c, w.e2, 'No follow-ups here', 'note')
        ok('rules: an observation with no follow-ups still changes class (not this file\'s business)',
           refused(d, lambda: d.run("update observation set course_id = :c where id = :o", c=w.c2, o=o4)) is None)
        ok('rules: update_observation on an observation is as before',
           refused(d, lambda: T(d, "update_observation(:o, jsonb_build_object('body', 'Kind lab partner'), array[:e::uuid])", o=w.o2, e=w.e2)) is None
           and d.one('select body from observation where id = :o', o=w.o2) == 'Kind lab partner')
        # delete
        T(d, "delete_observation(:f)", f=f3)
        ok('rules: deleting a follow-up deletes it alone', d.one('select count(*) from observation where follow_up_of = :o', o=w.o1) == 2
           and d.one('select count(*) from observation where id = :o', o=w.o1) == 1)
        T(d, "delete_observation(:o)", o=w.o1)
        ok('rules: deleting an observation deletes its follow-ups', d.one('select count(*) from observation where id = any(:ids)', ids=[f1, f2]) == 0)
        e = refused(d, lambda: T(d, "delete_observation(:o)", B, o=w.o2))
        ok('rules: Teacher B still cannot delete A\'s observation', e and e[1] == 'P0002', e)
    finally:
        d.close()

# ── readers ───────────────────────────────────────────────────────────────────────────────────────────
def bundle(w, uid=A, c=None): return T(w.d, "get_class_bundle(:c)", uid, c=c or w.c)
def page(w, filters='{}', p=1, size=50, c=None):
    return T(w.d, "get_observations(:c, :f::jsonb, :p, :s)", c=c or w.c, f=filters, p=p, s=size)

def scen_readers():
    w = world('readers'); d = w.d
    try:
        f1 = fu(w, w.o1, 'FOLLOWUP-WORDS called', 'called_home'); f2 = fu(w, w.o1, 'FOLLOWUP-WORDS resolved', 'resolved')
        b = bundle(w); o = b['observations']
        ids = [x['id'] for x in o['observations']]
        ok('readers: get_class_bundle lists the two observations and no follow-up', sorted(ids) == sorted([w.o1, w.o2]), ids)
        ok('readers: its total counts observations only', o['total'] == 2, o['total'])
        fus = o.get('follow_ups')
        ok('readers: its follow_ups carry both, oldest first, with their link, kind, words and dates',
           [x['id'] for x in fus] == [f1, f2] and all(x['follow_up_of'] == w.o1 for x in fus)
           and [x['kind'] for x in fus] == ['called_home', 'resolved'] and fus[0]['body'] == 'FOLLOWUP-WORDS called'
           and all(set(x) == {'id', 'follow_up_of', 'kind', 'body', 'created_at', 'updated_at'} for x in fus), fus)
        prof = json.dumps(b.get('profiles'))
        ok('readers: the bundle\'s profiles name no follow-up', 'FOLLOWUP-WORDS' not in prof and f1 not in prof)
        ok('readers: nothing else in the bundle names a follow-up but follow_ups',
           'FOLLOWUP-WORDS' not in json.dumps({k: v for k, v in b.items() if k != 'observations'}))
        bb = bundle(w, B, w.cb)
        ok('readers: Teacher B\'s bundle has none of A\'s follow-ups', 'FOLLOWUP-WORDS' not in json.dumps(bb) and bb['observations']['follow_ups'] == [])
        p = page(w)
        ok('readers: get_observations lists observations only, and counts them only',
           sorted(x['id'] for x in p['observations']) == sorted([w.o1, w.o2]) and p['total'] == 2 and p['has_more'] is False, p['total'])
        ok('readers: get_observations carries the page\'s follow-ups', [x['id'] for x in p['follow_ups']] == [f1, f2])
        p1 = page(w, size=1); p2 = page(w, p=2, size=1)
        ok('readers: paging by one: two pages, each observation once, each page with its own follow-ups',
           p1['total'] == 2 and p1['has_more'] and not p2['has_more']
           and sorted([p1['observations'][0]['id'], p2['observations'][0]['id']]) == sorted([w.o1, w.o2])
           and sum(len(x['follow_ups']) for x in (p1, p2)) == 2)
        for f in ('{"search": "FOLLOWUP"}', '{"since": "2000-01-01"}', '{"enrollment_ids": ["%s"]}' % w.e1, '{"sentiments": ["concern"]}'):
            r = page(w, f)
            ok('readers: get_observations filtered by %s names no follow-up as an observation' % f[:12],
               all(x['id'] not in (f1, f2) for x in r['observations']), r['observations'])
        e1_term = T(d, "get_term_rating(:e, 1)", e=w.e1)
        ok('readers: the Term Questionnaire\'s picker (get_term_rating) has the concern, not its follow-ups',
           'FOLLOWUP-WORDS' not in json.dumps(e1_term) and w.o1 in json.dumps(e1_term))
        prof2 = T(d, "(select coalesce(jsonb_agg(recent_observations), '[]') from list_course_student_profiles(:c))", c=w.c)
        ok('readers: list_course_student_profiles\' recent observations name no follow-up', 'FOLLOWUP-WORDS' not in json.dumps(prof2) and 'Left the lab' in json.dumps(prof2))
        T(d, "withdraw_student(:e, gen_random_uuid())", e=w.e1)
        rec = T(d, "get_withdrawn_student_records(:e)", e=w.e1)
        ok('readers: a withdrawn student\'s records list the concern, not its follow-ups',
           'FOLLOWUP-WORDS' not in json.dumps(rec) and 'Left the lab' in json.dumps(rec))
        T(d, "delete_withdrawn_student(:e, gen_random_uuid())", e=w.e1)
        ok('readers: deleting the withdrawn student deletes the concern and its follow-ups',
           d.one('select count(*) from observation where id = any(:ids)', ids=[w.o1, f1, f2]) == 0)
        n = d.one(r"""select count(*) from pg_proc p where p.pronamespace = 'student_submit'::regnamespace
                      and p.prosrc ~ '\mobservation(_student|_tag|_custom_tag)?\M'""")
        ok('readers: no student_submit function names the observation tables (the student page never reads them)', n == 0, n)
    finally:
        d.close()

# ── same ──────────────────────────────────────────────────────────────────────────────────────────────
def answers(w):
    d = w.d; out = {}
    out['bundle A'] = bundle(w); out['bundle A2'] = bundle(w, c=w.c2); out['bundle B'] = bundle(w, B, w.cb)
    for f in ('{}', '{"enrollment_id": "%s"}' % w.e1, '{"sentiment": "concern"}', '{"search": "lab"}'):
        for size in (1, 50):
            out['get_observations %s %d' % (f, size)] = page(w, f, 1, size)
            out['get_observations %s %d p2' % (f, size)] = page(w, f, 2, size)
    out['term rating'] = T(d, "get_term_rating(:e, 1)", e=w.e1)
    out['profiles'] = T(d, "(select jsonb_agg(to_jsonb(x) order by x.student->>'id') from list_course_student_profiles(:c) x)", c=w.c)
    return out

def strip(v):
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k != 'follow_ups'}
    if isinstance(v, list): return [strip(x) for x in v]
    return v

def scen_same():
    w = world('same', applied=False); d = w.d
    try:
        for i in range(4): w.obs(w.c, w.e1 if i % 2 else w.e2, 'More lab notes %d' % i, ['strength', 'growth', 'concern', 'note'][i])
        before = answers(w)
        ok('same: (setup) the file applies', d.file(FILE) == 'ok')
        after = answers(w)
        for k in before:
            ok('same: %s: the same answer but the new follow_ups' % k, json.dumps(strip(after[k]), sort_keys=True) == json.dumps(before[k], sort_keys=True), k)
        ok('same: with no follow-up, every follow_ups is empty',
           all(after[k]['observations']['follow_ups'] == [] for k in after if k.startswith('bundle'))
           and all(after[k]['follow_ups'] == [] for k in after if k.startswith('get_observations')))
        ok('same: the old answers had no follow_ups key', 'follow_ups' not in json.dumps(before))
    finally:
        d.close()

# ── dates ───────────────────────────────────────────────────────────────────────────────────────────
def scen_dates():
    w = world('dates'); d = w.d
    try:
        d.run("update observation set created_at = now() - interval '3 days' where id = :o", o=w.o1)
        at = lambda f: d.one("select extract(epoch from created_at)::bigint from observation where id = :f", f=f)
        def fu_at(when, kind='called_home'):
            return str(T(d, "create_observation_follow_up(:p, 'x', :k, gen_random_uuid(), %s)" % when, p=w.o1, k=kind))
        f = fu_at("now() - interval '1 day'")
        ok('dates: a time after the observation is kept (a follow-up made offline yesterday reads yesterday)',
           abs(at(f) - d.one("select extract(epoch from now() - interval '1 day')::bigint")) < 5)
        f = fu_at("now() - interval '10 days'")
        ok('dates: a time before the observation takes the observation\'s own time', at(f) == at(w.o1))
        e = refused(d, lambda: fu_at("now() + interval '6 minutes'"))
        ok('dates: more than 5 minutes ahead is refused (22023)', e and e[1] == '22023', e)
        f = fu_at("now() + interval '4 minutes'")
        ok('dates: up to 5 minutes ahead (a clock a little fast) is taken', f is not None)
        f = str(T(d, "create_observation_follow_up(:p, 'x', null, gen_random_uuid())", p=w.o1))
        ok('dates: with no time it is now()', abs(at(f) - d.one("select extract(epoch from now())::bigint")) < 5)
        ok('dates: the follow-ups sort oldest first in the bundle',
           [x['created_at'] for x in bundle(w)['observations']['follow_ups']] ==
           sorted(x['created_at'] for x in bundle(w)['observations']['follow_ups']))
    finally:
        d.close()

# ── purge ───────────────────────────────────────────────────────────────────────────────────────────
def scen_purge():
    w = world('purge'); d = w.d
    try:
        f1 = fu(w, w.o1, 'purged', 'called_home'); f2 = fu(w, w.o1, 'purged too', 'resolved')
        fb = fu(w, w.ob, 'Bravo follow-up', 'called_home', uid=B)
        d.run("update course set deleted_at = now() - interval '31 days' where id = :c", c=w.c)
        r = refused(d, lambda: d.one('select public.fv_retention_cleanup()'))
        ok('purge: fv_retention_cleanup runs with follow-ups in the purged class', r is None, r)
        ok('purge: the class\'s observations and follow-ups are gone',
           d.one('select count(*) from observation where id = any(:ids)', ids=[w.o1, w.o2, f1, f2]) == 0)
        ok('purge: other classes keep theirs', d.one('select count(*) from observation where id = any(:ids)', ids=[w.o3, w.ob, fb]) == 3)
        d.run("update teacher set deleted_at = now() - interval '31 days' where id = :b", b=B)
        r = refused(d, lambda: d.one('select public.fv_retention_cleanup()'))
        ok('purge: a purged teacher\'s class goes with its follow-ups', r is None
           and d.one('select count(*) from observation where id = any(:ids)', ids=[w.ob, fb]) == 0, r)
    finally:
        d.close()

# ── restore ───────────────────────────────────────────────────────────────────────────────────────────
def scen_restore():
    w = world('restore'); d = w.d
    try:
        c, o, f = nid(), nid(), nid()
        payload = {'courses': [{'id': c, 'name': 'Restored'}],
                   'observations': [{'id': o, 'course_id': c, 'body': 'Restored concern', 'sentiment': 'concern', 'enrollment_ids': []},
                                    {'id': f, 'course_id': c, 'body': 'Restored follow-up', 'follow_up_of': o, 'follow_up_kind': 'resolved',
                                     'enrollment_ids': []}]}
        T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(payload))
        ok('restore: the follow-up comes back under its observation, with its kind',
           d.all('select follow_up_of::text, follow_up_kind, body from observation where id = :f', f=f) == [[o, 'resolved', 'Restored follow-up']])
        ok('restore: the observation comes back as an observation', d.all('select follow_up_of, follow_up_kind from observation where id = :o', o=o) == [[None, None]])
        T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(payload))
        ok('restore: restored again, nothing doubles', d.one('select count(*) from observation where course_id = :c', c=c) == 2)
        old = {'courses': [{'id': nid(), 'name': 'Old backup'}]}
        old['observations'] = [{'id': nid(), 'course_id': old['courses'][0]['id'], 'body': 'Old', 'sentiment': 'note', 'enrollment_ids': []}]
        T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(old))
        ok('restore: a backup with no follow-ups restores as before', d.all('select follow_up_of from observation where id = :o', o=old['observations'][0]['id']) == [[None]])
        bad = {'courses': [{'id': nid(), 'name': 'Bad'}]}
        bad['observations'] = [{'id': nid(), 'course_id': bad['courses'][0]['id'], 'body': 'orphan', 'follow_up_of': nid(), 'follow_up_kind': 'resolved', 'enrollment_ids': []}]
        e = refused(d, lambda: T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(bad)))
        ok('restore: a follow-up whose observation is not there is refused, and nothing of that restore is kept',
           e is not None and d.one('select count(*) from course where id = :c', c=bad['courses'][0]['id']) == 0, e)
        cross = {'courses': [{'id': nid(), 'name': 'Cross'}]}
        cross['observations'] = [{'id': nid(), 'course_id': cross['courses'][0]['id'], 'body': 'x', 'follow_up_of': o, 'enrollment_ids': []}]
        e = refused(d, lambda: T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(cross)))
        ok('restore: a follow-up pointing into another class is refused', e is not None and e[1] == '23514', e)
        steal = {'observations': [{'id': nid(), 'course_id': w.c, 'body': 'x', 'follow_up_of': w.ob, 'enrollment_ids': []}]}
        e = refused(d, lambda: T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(steal)))
        ok('restore: a follow-up of Teacher B\'s observation is refused', e is not None, e)
        withst = {'observations': [{'id': nid(), 'course_id': c, 'body': 'x', 'follow_up_of': o, 'enrollment_ids': [w.e1]}]}
        e = refused(d, lambda: T(d, "import_json_restore(:p::jsonb, gen_random_uuid())", p=json.dumps(withst)))
        ok('restore: a follow-up with students is refused', e is not None, e)
    finally:
        d.close()

# ── race ──────────────────────────────────────────────────────────────────────────────────────────────
class Side:
    def __init__(self, d): self.c = connect(d.name); self.c.run("set lock_timeout = '20s'")
    def begin(self, uid):
        self.c.run('begin'); self.c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid); self.c.run('set local role authenticated')
    def run(self, sql, **kw): return self.c.run(sql, **kw)
    def close(self): self.c.close()

def in_thread(fn):
    box = {}
    def go():
        try: box['r'] = fn()
        except Exception as e: box['e'] = (message(e), sqlstate(e))
    t = threading.Thread(target=go); t.start(); return t, box

def waiting(d, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        if d.one("select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'") >= 1: return True
        time.sleep(0.05)
    return False

def orphans(d): return d.one('select count(*) from observation f where f.follow_up_of is not null and not exists (select 1 from observation p where p.id = f.follow_up_of)')

def scen_race():
    w = world('race'); d = w.d
    try:
        for rnd in range(3):
            o = w.obs(w.c, w.e1, 'race %d' % rnd, 'concern')
            s1, s2 = Side(d), Side(d)
            # 1. the follow-up first, the delete waits on it
            s1.begin(A); s1.run("select create_observation_follow_up(:p, 'first', 'called_home', gen_random_uuid())", p=o)
            s2.begin(A); t, box = in_thread(lambda: s2.run("select delete_observation(:p)", p=o))
            ok('race %d: the delete waits for the follow-up being made' % rnd, waiting(d))
            s1.run('commit'); t.join(); s2.run('commit')
            ok('race %d: then the delete takes the observation and its follow-up' % rnd, 'e' not in box
               and d.one('select count(*) from observation where id = :o or follow_up_of = :o', o=o) == 0, box)
            # 2. the delete first, the follow-up waits and is refused
            o = w.obs(w.c, w.e1, 'race b %d' % rnd, 'concern')
            s1.begin(A); s1.run("select delete_observation(:p)", p=o)
            s2.begin(A); t, box = in_thread(lambda: s2.run("select create_observation_follow_up(:p, 'late', 'resolved', gen_random_uuid())", p=o))
            ok('race %d: a follow-up made during the delete waits' % rnd, waiting(d))
            s1.run('commit'); t.join()
            try: s2.run('rollback' if 'e' in box else 'commit')
            except Exception: pass
            ok('race %d: and is refused once the observation is gone' % rnd, 'e' in box and d.one('select count(*) from observation where follow_up_of = :o', o=o) == 0, box)
            # 3. two follow-ups at once
            o = w.obs(w.c, w.e1, 'race c %d' % rnd, 'concern')
            s1.begin(A); s1.run("select create_observation_follow_up(:p, 'one', 'called_home', gen_random_uuid())", p=o)
            s2.begin(A); t, box = in_thread(lambda: s2.run("select create_observation_follow_up(:p, 'two', 'spoke_with_student', gen_random_uuid())", p=o))
            ok('race %d: a second follow-up made at once waits (the class\'s sync cursor, as every write in a class)' % rnd, waiting(d))
            s1.run('commit'); t.join(); s2.run('commit')
            ok('race %d: two follow-ups made at once are both kept' % rnd, 'e' not in box and d.one('select count(*) from observation where follow_up_of = :o', o=o) == 2)
            s1.close(); s2.close()
        ok('race: never a follow-up without its observation', orphans(d) == 0)
    finally:
        d.close()

# ── apply ─────────────────────────────────────────────────────────────────────────────────────────────
def header_md5s():
    rows = dict((m[0], (m[1], m[2])) for m in re.findall(r'^--   (\S+\(\S*\))\s+([0-9a-f]{32})  ([0-9a-f]{32})$', HEADER, re.M))
    new = dict(re.findall(r'^--   (\S+\(\S*\)) \(new\)\s+([0-9a-f]{32})$', HEADER, re.M))
    return rows, new

def catalog_of(d): return catalog(d.c)
def rows_of(d, cols): return row_checksums(d.c, cols)

def scen_apply():
    w = world('apply', applied=False); d = w.d
    try:
        fu_rows, new = header_md5s()
        ok('apply: the header names the three patched and the three new functions', sorted(fu_rows) == sorted(PATCHED) and sorted(new) == sorted(NEW), (fu_rows, new))
        ok('apply: the header\'s "before" md5s are this database\'s (equal to live)', all(md5(d, f) == fu_rows[f][0] for f in PATCHED))
        pre = d.file(PRE); ok('apply: the pre-check returns no row here', pre == 'ok' and d.rows == [], d.rows)
        cols = table_columns(d.c)
        cat0, rows0 = catalog_of(d), rows_of(d, cols)
        # guards
        for f in PATCHED:
            sig = f
            body = d.one('select pg_get_functiondef(to_regprocedure(:s))', s=sig)
            d.run(body.replace('$function$\n', '$function$\n-- someone changed this\n', 1))
            r = d.file(FILE)
            ok('apply: %s changed since: stopped' % sig.split('(')[0], r.startswith('STOPPED') and 'not the definition' in r, r)
            d.run(body)
        d.run('alter table observation add column follow_up_of text')
        r = d.file(FILE); ok('apply: a follow_up_of column of another type: stopped', r.startswith('STOPPED') and 'did not make' in r, r)
        d.run('alter table observation drop column follow_up_of')
        d.run("create function public.create_observation_follow_up(p uuid) returns uuid language sql as 'select null::uuid'")
        r = d.file(FILE); ok('apply: a create_observation_follow_up with other arguments: stopped', r.startswith('STOPPED') and 'other arguments' in r, r)
        d.run('drop function public.create_observation_follow_up(uuid)')
        cat1 = catalog_of(d); gone, extra = differences(cat0, cat1)
        ok('apply: every stopped run left the catalog as it was (but the dropped-column slot)',
           all('dropped' in l or 'observation' in l for l in gone + extra) and len(gone + extra) <= 2, (gone, extra))
    finally:
        d.close()
    w = world('apply2', applied=False); d = w.d
    try:
        fu_rows, new = header_md5s()
        cols = table_columns(d.c)
        cat0, rows0 = catalog_of(d), rows_of(d, cols)
        ok('apply: the file applies', d.file(FILE) == 'ok')
        cat1, rows1 = catalog_of(d), rows_of(d, cols)
        ok('apply: no row changed (on every column the tables had)', rows0 == rows1, [t for t in rows0 if rows0[t] != rows1.get(t)])
        gone, extra = differences(cat0, cat1)
        expected = re.compile(r'(get_class_bundle|get_observations|import_json_restore|follow_up|observation_follow_up|pg_depend|'
                              r'comments on|^column public\.observation|^table public\.observation \||^internal triggers observation \||^depends )')
        ok('apply: the catalog changes only in what the header names', all(expected.search(l) for l in gone + extra),
           [l for l in gone + extra if not expected.search(l)][:6])
        ok('apply: each patched function has the header\'s "after" md5', all(md5(d, f) == fu_rows[f][1] for f in PATCHED))
        ok('apply: each new function has the header\'s md5', all(md5(d, f) == new[f] for f in NEW))
        mine = lambda cat: [re.sub(r'[0-9a-f]{32}', 'X', l) for l in cat if l.startswith('function') and any(f.split('(')[0] + '(' in l for f in PATCHED)]
        ok('apply: the patched functions keep their owner, grants, attributes and settings (only the body changes)',
           mine(cat0) == mine(cat1) and len(mine(cat0)) == 6, (mine(cat0), mine(cat1)))
        ok('apply: the new functions run as the caller (not SECURITY DEFINER), the rule as its owner with an empty search_path',
           d.all("select prosecdef, coalesce(proconfig::text, '') from pg_proc where oid = to_regprocedure(:s)", s=NEW[0]) == [[False, '{search_path=public}']]
           and d.all("select prosecdef, coalesce(proconfig::text, '') from pg_proc where oid = to_regprocedure(:s)", s=NEW[2]) == [[True, '{"search_path=\\"\\""}']])
        ok('apply: anon may run neither new function; authenticated and service_role may run both; nobody the rule',
           all(not d.one("select has_function_privilege('anon', :s, 'execute')", s=s) for s in NEW)
           and all(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=s) for r in ('authenticated', 'service_role') for s in NEW[:2])
           and not any(d.one("select has_function_privilege(:r, :s, 'execute')", r=r, s=NEW[2]) for r in ('anon', 'authenticated', 'service_role', 'public')))
        post = d.file(POST); ok('apply: the post-check says ok on every row', post == 'ok' and d.rows and all(r[1] == 'ok' for r in d.rows), d.rows)
        r2 = d.file(FILE); cat2, rows2 = catalog_of(d), rows_of(d, cols)
        ok('apply: a second run changes nothing', r2 == 'ok' and cat2 == cat1 and rows2 == rows1, differences(cat1, cat2))
        pre = d.file(PRE); ok('apply: on the database after the file, the pre-check says so', pre == 'ok' and len(d.rows) > 0)
        ok('apply: one transaction with a lock timeout', HEADER.count('\nbegin;') == 1 and HEADER.count('\ncommit;') == 1 and "set local lock_timeout = '5s';" in HEADER)
        size = len(HEADER.encode())
        ok('apply: the file is small enough to send whole (%d bytes, under 40 KB)' % size, size < 40000)
        # a busy table: the lock timeout stops it, nothing changed
        d2 = world('apply3', applied=False)
        try:
            dd = d2.d
            s = Side(dd); s.c.run('begin'); s.c.run('lock table public.observation in access share mode')
            cat_b = catalog(dd.c)
            t0 = time.time(); r = dd.file(FILE); t1 = time.time()
            s.c.run('rollback'); s.close()
            ok('apply: with the table in use it stops after the lock timeout, nothing changed',
               r.startswith('STOPPED') and 'lock timeout' in r and 4 < t1 - t0 < 15 and catalog(dd.c) == cat_b, (r, t1 - t0))
        finally:
            d2.d.close()
    finally:
        d.close()

# ── undo ──────────────────────────────────────────────────────────────────────────────────────────────
def scen_undo():
    w = world('undo', applied=False); d = w.d
    try:
        cols = table_columns(d.c)
        cat0, rows0 = catalog_of(d), rows_of(d, cols)
        ok('undo: it locks observation against new follow-ups before its checks',
           "set local lock_timeout = '5s';\n-- No follow-up can be made between the check below and the columns going.\nlock table public.observation in share row exclusive mode;"
           in text_of(UNDO))
        ok('undo: on a database without the file it changes nothing', d.file(UNDO) == 'ok' and catalog_of(d) == cat0 and rows_of(d, cols) == rows0)
        ok('undo: (setup) the file applies', d.file(FILE) == 'ok')
        f = fu(w, w.o1, 'kept', 'resolved')
        cat1 = catalog_of(d)
        r = d.file(UNDO)
        ok('undo: it stops while a follow-up exists, nothing changed', r.startswith('STOPPED') and '1 follow-up' in r and catalog_of(d) == cat1, r)
        # the fast stop
        fast = re.search(r'^--   (revoke execute on function .*?;)$', text_of(UNDO), re.S | re.M).group(1)
        fast = re.sub(r'\n--\s+', ' ', fast)
        d.run(fast)
        e = refused(d, lambda: fu(w, w.o1, 'after the stop', 'called_home'))
        ok('undo: after the fast stop no follow-up can be made (permission denied)', e and 'permission denied' in e[0], e)
        e = refused(d, lambda: T(d, "update_observation_follow_up(:f, 'x', null, gen_random_uuid())", f=f))
        ok('undo: nor changed', e and 'permission denied' in e[0], e)
        ok('undo: and the rest works as before (a new observation, the bundle)',
           refused(d, lambda: w.obs(w.c, w.e2, 'after the stop', 'note')) is None and len(bundle(w)['observations']['observations']) == 3)
        d.run('grant execute on function public.create_observation_follow_up(uuid, text, text, uuid, timestamptz), public.update_observation_follow_up(uuid, text, text, uuid) to authenticated, service_role')
        T(d, "delete_observation(:f)", f=f)
        d.run("delete from observation where body = 'after the stop'")
        ok('undo: (setup) back to the file applied, no follow-up', catalog_of(d) == cat1)
        rows_before_undo = rows_of(d, cols)
        r = d.file(UNDO)
        cat2, rows2 = catalog_of(d), rows_of(d, cols)
        gone, extra = differences(cat0, cat2)
        ok('undo: the full removal runs', r == 'ok', r)
        ok('undo: the catalog is as before the file, but two dropped-column slots on observation',
           gone == [] and extra == ['dropped columns public.observation | 2'], (gone, extra))
        ok('undo: the removal changed no row (on every column)', rows2 == rows_before_undo, [t for t in rows0 if rows_before_undo[t] != rows2.get(t)])
        books = ('public.course_sync_cursor', 'public.fv_idempotency')   # the setup's own writes in between
        ok('undo: every row is as before the file, but the setup\'s own sync and idempotency bookkeeping',
           {t: v for t, v in rows2.items() if t not in books} == {t: v for t, v in rows0.items() if t not in books},
           [t for t in rows0 if t not in books and rows0[t] != rows2.get(t)])
        ok('undo: the three readers are back, md5 for md5', all(md5(d, f) == header_md5s()[0][f][0] for f in PATCHED))
        ok('undo: a second run changes nothing', d.file(UNDO) == 'ok' and catalog_of(d) == cat2)
        ok('undo: and the file can be applied again', d.file(FILE) == 'ok' and has_file(d))
    finally:
        d.close()

SCENARIOS = {'rules': scen_rules, 'readers': scen_readers, 'same': scen_same, 'dates': scen_dates, 'purge': scen_purge,
             'restore': scen_restore,
             'race': scen_race, 'apply': scen_apply, 'undo': scen_undo}
if __name__ == '__main__':
    for name in (sys.argv[1:] or list(SCENARIOS)):
        SCENARIOS[name]()
    finish()
