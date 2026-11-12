"""My Learning sends the rest: migrations/2026111201_my_learning_page_sends_rest.sql, applied on top of
live as it is after 2026111170_handouts_links.sql (handouts_links.py's template with the file applied).

    PGDATABASE=mlr python3 batch_c_common.py build     an EMPTY database: live with Batch B and the fixes
    PGDATABASE=mlr python3 my_learning_rest.py         every scenario below
    PGDATABASE=mlr python3 my_learning_rest.py on ...  or some

Never against gradebook-prod: a throwaway PostgreSQL 17 only.

  off    Show My Learning off: page's answer is the same text before and after the file, for both
         students, with a grade level and whole-rubric competencies set on the class.
  on     learning.course.grade_level is the course row's; learning.rubric_tags names each listed
         rubric's whole-rubric competencies (id order), and leaves out a rubric with none, a rubric
         no listed work uses, a competency whose section was removed, and another class's rubric.
         Taking the two keys out gives page's answer before the file, to the byte. Nothing of
         another student; no descriptor or teacher's note is added; the other student gets the same
         two keys (they are the class's).
  apply  the guard: refuses page as some other definition (nothing changed), refuses without
         Handouts and Links; a second run changes nothing; page keeps stable, security definer, its
         search_path and its grants (service role only); md5 after is the one the header records.
  undo   my-learning-rest-undo.sql puts page back to the md5 the file found; a second run changes
         nothing; page then answers as before the file.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handouts_links as hl
from handouts_links import HDb, seed_work
from batch_c_common import *

FILE = '../2026111201_my_learning_page_sends_rest.sql'
UNDO = 'my-learning-rest-undo.sql'
SIG = 'student_submit.page(text,uuid,text)'
HEADER = open(os.path.join(HERE, FILE)).read()
BEFORE_MD5, AFTER_MD5 = re.search(r"Before: ([0-9a-f]{32})\. After: ([0-9a-f]{32})\.", HEADER).groups()

def md5(d): return d.one('select md5(pg_get_functiondef(to_regprocedure(:f)))', f=SIG)
def text(d, t, e=ENR1): return d.service("student_submit.page(:t, :e, 'ip-1')::text", t=t, e=e)
def world(tag):
    """Live as the file meets it, with Teacher A's class: a map of three sections (one removed later),
    two rubrics used by work and one not, whole-rubric competencies on each, and Teacher B's rubric."""
    d = HDb('mlr_' + tag, template=hl.template(True)); k = seed_work(d)
    k.update(subj=nid(), s1=nid(), s2=nid(), gone=nid(), t1=nid(), t2=nid(), tgone=nid(),
             r_used=nid(), r_none=nid(), r_unused=nid(), c1=nid(), b_subj=nid(), b_sec=nid(), b_tag=nid(), b_rub=nid())
    d.run("update course set grade_level = '12' where id = :c", c=COURSE_A)
    d.run("update course set grade_level = '9' where id = :c", c=COURSE_B)
    d.run("insert into subject (id, course_id, name) values (:s, :c, 'History 12')", s=k['subj'], c=COURSE_A)
    for sid, name, o in ((k['s1'], 'Evidence', 0), (k['s2'], 'Significance', 1), (k['gone'], 'Old', 2)):
        d.run("insert into section (id, course_id, subject_id, name, display_order) values (:x, :c, :s, :n, :o)",
              x=sid, c=COURSE_A, s=k['subj'], n=name, o=o)
    for tid, sid in ((k['t1'], k['s1']), (k['t2'], k['s2']), (k['tgone'], k['gone'])):
        d.run("insert into tag (id, section_id, label, code) values (:t, :x, 'Tag', 'T')", t=tid, x=sid)
    d.run("""insert into rubric (id, course_id, name) values (:a, :c, 'Essay'), (:b, :c, 'No Whole'), (:u, :c, 'Unused')""",
          a=k['r_used'], b=k['r_none'], u=k['r_unused'], c=COURSE_A)
    d.run("""insert into criterion (id, rubric_id, name, level_1_descriptor) values (:x, :r, 'Argument', 'DESCRIPTOR-SECRET')""",
          x=k['c1'], r=k['r_used'])
    d.run("""insert into rubric_tag (rubric_id, tag_id) values (:r, :t2), (:r, :t1), (:r, :tg), (:u, :t1)""",
          r=k['r_used'], t1=k['t1'], t2=k['t2'], tg=k['tgone'], u=k['r_unused'])
    d.run("update assessment set rubric_id = :r, score_mode = 'proficiency', max_points = null where id = :a", r=k['r_used'], a=k['nothing'])
    d.run("""insert into assessment (id, course_id, title, score_mode, rubric_id) values (:a, :c, 'Plain', 'proficiency', :r)""",
          a=nid(), c=COURSE_A, r=k['r_none'])
    # Teacher B's class: a rubric with a whole-rubric competency of its own.
    d.run("insert into subject (id, course_id, name) values (:s, :c, 'Socials')", s=k['b_subj'], c=COURSE_B)
    d.run("insert into section (id, course_id, subject_id, name) values (:x, :c, :s, 'Theirs')", x=k['b_sec'], c=COURSE_B, s=k['b_subj'])
    d.run("insert into tag (id, section_id, label) values (:t, :x, 'Their Tag')", t=k['b_tag'], x=k['b_sec'])
    d.run("insert into rubric (id, course_id, name) values (:r, :c, 'Theirs')", r=k['b_rub'], c=COURSE_B)
    d.run("insert into rubric_tag (rubric_id, tag_id) values (:r, :t)", r=k['b_rub'], t=k['b_tag'])
    d.run("insert into assessment (id, course_id, title, score_mode, rubric_id) values (:a, :c, 'Their Essay', 'proficiency', :r)",
          a=nid(), c=COURSE_B, r=k['b_rub'])
    d.run("update section set removed_at = now() where id = :x", x=k['gone'])
    t1, _ = d.session(ENR1); t2, _ = d.session(ENR2, birthday='2012-06-16')
    return d, k, t1, t2

def scen_off():
    d, k, t1, t2 = world('off')
    try:
        found = md5(d)
        print('md5 of page before the file, on this build: %s (header: %s)' % (found, BEFORE_MD5))
        ok('(setup) page is as 2026111170 left it: the md5 the header records', found == BEFORE_MD5, found)
        before1, before2 = text(d, t1), text(d, t2, ENR2)
        ok('(setup) the file applies', d.file(FILE) == 'ok')
        ok('off: page is the same text as before the file (Cece)', text(d, t1) == before1)
        ok('off: page is the same text as before the file (the other student)', text(d, t2, ENR2) == before2)
        ok('off: neither new key', all(w not in before1 + text(d, t1) for w in ('grade_level', 'rubric_tags')))
    finally:
        d.close()

def scen_on():
    d, k, t1, t2 = world('on')
    try:
        d.run('update course set show_my_learning = true where id = :c', c=COURSE_A)
        before = json.loads(text(d, t1)); before_text = text(d, t1)
        ok('(before the file) neither key is sent with Show My Learning on',
           'grade_level' not in before_text and 'rubric_tags' not in before_text and 'learning' in before)
        ok('(setup) the file applies', d.file(FILE) == 'ok')
        on_text = text(d, t1); p = json.loads(on_text); L = p['learning']
        ok("on: learning.course.grade_level is the course row's", L['course'].get('grade_level') == '12', L['course'])
        ok('on: rubric_tags names the listed rubric with whole-rubric competencies, in id order, still on the class',
           L.get('rubric_tags') == {k['r_used']: sorted([k['t1'], k['t2']])}, L.get('rubric_tags'))
        ok('on: a removed section\'s competency is left out', k['tgone'] not in json.dumps(L.get('rubric_tags')))
        ok('on: a rubric no listed work uses is left out, and one with no whole-rubric competencies',
           k['r_unused'] not in json.dumps(L['rubric_tags']) and k['r_none'] not in json.dumps(L['rubric_tags']))
        ok("on: another class's rubric and tag are absent", all(x not in on_text for x in (k['b_rub'], k['b_tag'], COURSE_B)))
        cut = d.service("(student_submit.page(:t, :e, 'ip-1') #- '{learning,course,grade_level}' #- '{learning,rubric_tags}')::text",
                        t=t1, e=ENR1)
        ok('on: taking the two keys out gives page before the file, to the byte', cut == before_text, (len(cut), len(before_text)))
        ok('on: no descriptor beyond what page already sent, nothing of another student',
           on_text.count('DESCRIPTOR-SECRET') == before_text.count('DESCRIPTOR-SECRET') and ENR2 not in on_text and STU2 not in on_text)
        p2 = json.loads(text(d, t2, ENR2))
        ok('on: the other student gets the same two keys (they are the class\'s)',
           p2['learning']['course'].get('grade_level') == '12' and p2['learning']['rubric_tags'] == L['rubric_tags'] and ENR1 not in json.dumps(p2))
        d.run("update course set grade_level = null where id = :c", c=COURSE_A)
        ok('on: a class with no grade level sends null', json.loads(text(d, t1))['learning']['course'].get('grade_level', 'missing') is None)
        d.run('delete from rubric_tag')
        ok('on: a class with no whole-rubric competencies sends {}', json.loads(text(d, t1))['learning']['rubric_tags'] == {})
    finally:
        d.close()

def scen_apply():
    d, k, t1, _ = world('apply')
    try:
        d.run("""create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)
                 returns jsonb language plpgsql stable security definer set search_path to 'public', 'student_submit', 'pg_temp'
                 as $f$ begin return '{}'::jsonb; end $f$""")
        r = d.file(FILE)
        ok('apply: refuses page as some other definition', r.startswith('STOPPED') and 'not the definition' in r, r)
        ok('apply: and changed nothing', d.one("select prosrc like '%{}%' from pg_proc where oid = to_regprocedure(:f)", f=SIG))
    finally:
        d.close()
    d, k, t1, _ = world('apply1')
    try:
        d.run('drop table public.assessment_resource cascade')
        r = d.file(FILE)
        ok('apply: refuses without Handouts and Links', r.startswith('STOPPED') and 'Handouts and Links' in r, r)
        ok('apply: and changed nothing', md5(d) == BEFORE_MD5, md5(d))
    finally:
        d.close()
    d, k, t1, _ = world('apply2')
    try:
        ok('apply: the file applies', d.file(FILE) == 'ok')
        after = md5(d)
        print('md5 of page after the file, on this build: %s (header: %s)' % (after, AFTER_MD5))
        ok('apply: md5 after is the one the header records', after == AFTER_MD5, after)
        once = text(d, t1)
        ok('apply: a second run applies and changes nothing', d.file(FILE) == 'ok' and md5(d) == AFTER_MD5 and text(d, t1) == once)
        g = d.all("select has_function_privilege('anon', :f, 'execute'), has_function_privilege('authenticated', :f, 'execute'), "
                  "has_function_privilege('service_role', :f, 'execute')", f=SIG)[0]
        ok("apply: page is still the service role's alone", g == [False, False, True], g)
        attrs = d.all("select p.provolatile, p.prosecdef, array_to_string(p.proconfig, ',') from pg_proc p where p.oid = to_regprocedure(:f)", f=SIG)[0]
        ok('apply: page keeps stable, security definer and its search_path', attrs == ['s', True, 'search_path=public, student_submit, pg_temp'], attrs)
    finally:
        d.close()

def scen_undo():
    d, k, t1, _ = world('undo')
    try:
        d.run('update course set show_my_learning = true where id = :c', c=COURSE_A)
        before = text(d, t1)
        ok('(setup) the file applies', d.file(FILE) == 'ok')
        ok('undo: applies', d.file(UNDO) == 'ok')
        ok('undo: page is back to the definition the file found', md5(d) == BEFORE_MD5, md5(d))
        ok('undo: page answers as before the file', text(d, t1) == before)
        ok('undo: a second run applies and changes nothing', d.file(UNDO) == 'ok' and md5(d) == BEFORE_MD5)
        g = d.all("select has_function_privilege('anon', :f, 'execute'), has_function_privilege('service_role', :f, 'execute')", f=SIG)[0]
        ok("undo: page is still the service role's alone", g == [False, True], g)
    finally:
        d.close()

SCENARIOS = {'off': scen_off, 'on': scen_on, 'apply': scen_apply, 'undo': scen_undo}

if __name__ == '__main__':
    try:
        for n in sys.argv[1:] or list(SCENARIOS):
            SCENARIOS[n]()
    finally:
        hl.drop_templates()
    finish()
