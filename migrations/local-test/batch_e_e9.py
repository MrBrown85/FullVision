"""Batch E, E9: My Learning on the student's own device (my-learning-contract.md).
student_submit.page, as E9 replaces it, on top of the Batch E template
(batch_e.py's: live with Batch B, its fixes, C1, C2, the send rules,
Batch D and 2026111150).

    PGDATABASE=be python3 batch_e_e9.py

The "before" side is page as 2026111103 made it, put back on a copy of the
Batch E template; the "after" side is E9's page as 2026111150 carries it
(E9_PAGE, if set, names another file holding a `create or replace function
student_submit.page(...)` to try instead).

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  off     Show My Learning off: page's jsonb is the same, on the same data,
          before and after E9.
  on      show_my_learning true; learning has the class's twelve course
          columns, categories with weights, folders, and its subjects,
          sections and tags as get_class_bundle sends them (I Can
          statements and bank_id; no source_text), and nothing else;
          category_id on each piece; a removed section left out; another
          class's map absent; nothing of another student. The bytes the
          seeded class adds are printed.
  grants  page is still the service role's alone.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import batch_e as be
from batch_e import *

def _e9_from_file():
    """E9's page as the migration carries it, written to a temporary file for d.file()."""
    import tempfile
    t = open(os.path.join(HERE, '..', '2026111150_student_page_last_changes.sql')).read()
    i = t.index('create or replace function student_submit.page(')
    j = t.index('$function$;', i) + len('$function$;')
    path = os.path.join(tempfile.mkdtemp(prefix='batch_e_e9_'), 'page.sql')
    open(path, 'w').write(t[i:j] + '\n')
    return path
E9_PAGE = os.environ.get('E9_PAGE') or _e9_from_file()
COURSE_COLUMNS = ['grading_system', 'calc_method', 'decay_weight', 'recent_score_limit', 'grading_scale',
                  'category_weights', 'round_percent', 'level_order', 'reporting_terms', 'timezone',
                  'folders_count_as_one', 'courses_count_equally']

def compact(v): return json.dumps(v, separators=(',', ':'), ensure_ascii=False)

def learning_seed(d, k):
    """A typical BC class for teacher A: one subject, four sections (two in folders), eighteen
    competencies with I Can text and the Ministry's wording, three categories; a removed section;
    and teacher B's class with a map and a category of its own."""
    k.update(subj=nid(), g1=nid(), g2=nid(), removed=nid(), removed_tag=nid(), cat1=nid(), cat2=nid(), cat3=nid(),
             b_subj=nid(), b_sect=nid(), b_tag=nid(), b_cat=nid())
    k['sections'] = [nid() for _ in range(4)]
    d.run("""update course set calc_method = 'decaying_avg', decay_weight = 0.65, grading_system = 'both',
               reporting_terms = '[{"ordinal":1,"label":"Term 1","starts_on":"2026-09-02","ends_on":"2026-11-20"}]'::jsonb,
               grading_scale = '{"boundaries":[{"min":86,"letter":"A"},{"min":73,"letter":"B"}]}'::jsonb
             where id = :c""", c=COURSE_A)
    d.run("insert into subject (id, course_id, name) values (:s, :c, 'Science 8')", s=k['subj'], c=COURSE_A)
    d.run("insert into competency_group (id, course_id, name, color, display_order) values "
          "(:a, :c, 'Questioning and Predicting', '#336699', 0), (:b, :c, 'Evaluating', '#993366', 1)",
          a=k['g1'], b=k['g2'], c=COURSE_A)
    names = ['Questioning and Predicting', 'Planning and Conducting', 'Processing and Analyzing', 'Communicating']
    groups = [k['g1'], k['g1'], k['g2'], None]
    k['tags'] = []
    for i, (sid, name, g) in enumerate(zip(k['sections'], names, groups)):
        d.run("insert into section (id, course_id, subject_id, competency_group_id, name, display_order) values (:x, :c, :s, :g, :n, :o)",
              x=sid, c=COURSE_A, s=k['subj'], g=g, n=name, o=i)
        for j in range(5 if i < 2 else 4):
            t = nid(); k['tags'].append(t)
            d.run("""insert into tag (id, section_id, code, label, i_can_text, i_can_statements, source_text, bank_id, display_order)
                     values (:t, :x, :code, :label, :ican, array[:ican, 'I can explain why it matters.'],
                             'Demonstrate a sustained intellectual curiosity about a scientific topic or problem of personal interest',
                             :bank, :o)""",
                  t=t, x=sid, code='S%d.%d' % (i + 1, j + 1), label='%s, part %d' % (name, j + 1),
                  ican='I can %s, step %d, in my own words.' % (name.lower(), j + 1), bank='sci8-%d-%d' % (i, j), o=j)
    d.run("insert into section (id, course_id, subject_id, name, removed_at) values (:x, :c, :s, 'Old Section', now())",
          x=k['removed'], c=COURSE_A, s=k['subj'])
    d.run("insert into tag (id, section_id, label, code) values (:t, :x, 'Gone', 'G1')", t=k['removed_tag'], x=k['removed'])
    d.run("insert into category (id, course_id, name, weight, display_order) values "
          "(:a, :c, 'Projects', 50, 0), (:b, :c, 'Tests', 30, 1), (:d, :c, 'Practice', 20, 2)",
          a=k['cat1'], b=k['cat2'], d=k['cat3'], c=COURSE_A)
    d.run('update assessment set category_id = :k where id = :a', k=k['cat1'], a=k['lab'])
    d.run('update assessment set category_id = :k where id = :a', k=k['cat2'], a=k['rub'])
    d.run("insert into assessment_tag (assessment_id, tag_id) values (:a, :t)", a=k['lab'], t=k['tags'][0])
    # Teacher B's class: a map and a category of its own.
    d.run("insert into subject (id, course_id, name) values (:s, :c, 'Socials')", s=k['b_subj'], c=COURSE_B)
    d.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Their Section')", x=k['b_sect'], c=COURSE_B, s=k['b_subj'])
    d.run("insert into tag (id, section_id, label, code) values (:t, :x, 'Their Tag', 'B1')", t=k['b_tag'], x=k['b_sect'])
    d.run("insert into category (id, course_id, name, weight) values (:k, :c, 'Their Category', 100)", k=k['b_cat'], c=COURSE_B)
    # Returned work for both students, so the page carries grades.
    for e in (ENR1, ENR2):
        d.score(e, k['lab'], 7 if e == ENR1 else 9)
    d.return_work(k['lab'], [ENR1, ENR2])

def page_text(d, t, e=ENR1):
    return d.service("student_submit.page(:t, :e, 'ip-1')::text", t=t, e=e)

def apply_e9(d):
    r = d.file(E9_PAGE)
    ok('e9_page.sql applies', r == 'ok', r)

def strip_e9(p):
    p = json.loads(json.dumps(p))
    p.pop('show_my_learning', None); p.pop('learning', None)
    for a in p.get('assessments', []): a.pop('category_id', None)
    return p

def run():
    tpl = be.template(True)
    d = CDb('e9', template=tpl); k = seed(d)
    try:
        if not os.path.exists(E9_PAGE): ok('E9_PAGE exists', False, E9_PAGE); return
        learning_seed(d, k)
        # The template carries E9 now (2026111150): put page back as 2026111103 made it for the "before" side.
        _old = open(os.path.join(HERE, '..', '2026111103_student_page_fields.sql')).read()
        _i = _old.index('create or replace function student_submit.page(')
        d.run(_old[_i:_old.index('$function$;', _i) + len('$function$')])
        t1 = d.session(ENR1); t2 = d.session(ENR2, birthday='2012-06-16')
        ok('(setup) the returned grade is on the page', any(a['id'] == k['lab'] and a.get('grade') for a in json.loads(page_text(d, t1))['assessments']))
        # ── off ──
        before1 = page_text(d, t1); before2 = page_text(d, t2, ENR2)
        d.run('update course set show_my_learning = true where id = :c', c=COURSE_A)
        before_on = page_text(d, t1)   # without E9, the setting changes nothing
        ok('(setup) without E9, Show My Learning on changes nothing', before_on == before1)
        d.run('update course set show_my_learning = false where id = :c', c=COURSE_A)
        apply_e9(d)
        after1 = page_text(d, t1); after2 = page_text(d, t2, ENR2)
        ok('off: page is the same jsonb as before E9 (Cece)', after1 == before1, (len(before1), len(after1)))
        ok('(setup) the other student\'s page answers', json.loads(before2).get('ok') is True, before2[:200])
        ok('off: page is the same jsonb as before E9 (the other student)', after2 == before2)
        ok('off: no new key', all(w not in after1 for w in ('show_my_learning', '"learning"', 'category_id')))
        # ── on ──
        d.run('update course set show_my_learning = true where id = :c', c=COURSE_A)
        on_text = page_text(d, t1); p = json.loads(on_text)
        ok('on: show_my_learning is true', p.get('show_my_learning') is True, p.get('show_my_learning'))
        L = p.get('learning') or {}
        ok('on: learning has course, categories, competency_groups, subjects and nothing else',
           sorted(L) == ['categories', 'competency_groups', 'course', 'subjects'], sorted(L))
        ok("on: learning.course is the twelve columns, and no other", sorted(L.get('course', {})) == sorted(COURSE_COLUMNS), sorted(L.get('course', {})))
        ok('on: everything else on the page is as before', compact(strip_e9(p)) == compact(json.loads(before1)))
        # The bundle's own shapes, read from get_class_bundle as the teacher.
        b = d.rpc('get_class_bundle(:c, null)', c=COURSE_A)
        b = json.loads(b) if isinstance(b, str) else b
        bcourse = b['gradebook']['course']
        ok('on: learning.course is the bundle\'s course, cut to the twelve',
           L['course'] == {c: bcourse[c] for c in COURSE_COLUMNS}, (L['course'], {c: bcourse.get(c) for c in COURSE_COLUMNS}))
        ok('on: categories are the bundle\'s, with weights', L['categories'] == b['gradebook']['categories']
           and [c['weight'] for c in L['categories']] == [50, 30, 20], L['categories'])
        ok('on: competency_groups are the bundle\'s', L['competency_groups'] == b['learning_map']['competency_groups'])
        bsubj = json.loads(json.dumps(b['learning_map']['subjects']))
        for s in bsubj:
            for sec in s['sections']:
                for t in sec['tags']: t.pop('source_text', None)
        ok("on: subjects, sections and tags are the bundle's, without source_text", L['subjects'] == bsubj)
        secs = [sec for s in L['subjects'] for sec in s['sections']]
        tags = [t for sec in secs for t in sec['tags']]
        ok('on: the four sections, in order, with their folders', [s['id'] for s in secs] == k['sections']
           and [s['competency_group_id'] for s in secs] == [k['g1'], k['g1'], k['g2'], None])
        ok('on: the eighteen tags, each with i_can_statements and bank_id', len(tags) == 18
           and all(len(t['i_can_statements']) == 2 and t['bank_id'] and t['i_can_text'] for t in tags), len(tags))
        ok('on: each tag has exactly the contract\'s fields', all(sorted(t) == sorted(
            ['id', 'code', 'label', 'i_can_text', 'i_can_statements', 'bank_id', 'display_order']) for t in tags))
        ok('on: each section and subject has exactly the contract\'s fields',
           all(sorted(s) == ['competency_group_id', 'display_order', 'id', 'name', 'tags'] for s in secs)
           and all(sorted(s) == ['display_order', 'id', 'name', 'sections'] for s in L['subjects']))
        ok('on: no source_text anywhere', 'source_text' not in on_text and 'intellectual curiosity' not in on_text)
        ok('on: the removed section and its tag are left out', k['removed'] not in on_text and k['removed_tag'] not in on_text)
        ok("on: another class's map and categories are absent",
           all(x not in on_text for x in (k['b_subj'], k['b_sect'], k['b_tag'], k['b_cat'], COURSE_B)))
        cats = {a['id']: a.get('category_id', 'missing') for a in p['assessments']}
        ok('on: category_id on each piece', cats.get(k['lab']) == k['cat1'] and cats.get(k['rub']) == k['cat2']
           and cats.get(k['dib']) is None and 'missing' not in cats.values(), cats)
        ok('on: nothing of another student (no other enrollment id, no name)',
           ENR2 not in on_text and STU2 not in on_text and 'Marcus' not in on_text and ENR_B not in on_text)
        ok('on: no teacher id', A not in on_text and B not in on_text)
        p2 = json.loads(page_text(d, t2, ENR2))
        ok('on: the other student gets the same learning, their own grade', p2['learning'] == L and ENR1 not in compact(p2))
        # ── another class off ──
        d.run('update course set show_my_learning = false where id = :c', c=COURSE_A)
        ok('off again: the page is as before E9', page_text(d, t1) == before1)
        # ── size ──
        added = len(compact(p).encode()) - len(compact(json.loads(before1)).encode())
        print('E9 adds %d bytes to the seeded class\'s page (4 sections, 18 competencies with I Can text, 3 categories); '
              'page off %d bytes, on %d bytes' % (added, len(compact(json.loads(before1)).encode()), len(compact(p).encode())))
        # ── grants ──
        sig = 'student_submit.page(text,uuid,text)'
        g = d.all("select has_function_privilege('anon', :f, 'execute'), has_function_privilege('authenticated', :f, 'execute'), "
                  "has_function_privilege('service_role', :f, 'execute')", f=sig)[0]
        ok('grants: page is the service role\'s alone', g == [False, False, True], g)
        attrs = d.all("select p.provolatile, p.prosecdef, array_to_string(p.proconfig, ',') from pg_proc p where p.oid = to_regprocedure(:f)", f=sig)[0]
        ok('page keeps stable, security definer and its search_path',
           attrs == ['s', True, 'search_path=public, student_submit, pg_temp'], attrs)
    finally:
        d.close()

if __name__ == '__main__':
    try:
        run()
    finally:
        be.drop_templates()
    finish()
