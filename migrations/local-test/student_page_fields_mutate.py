"""Does the suite notice when S4-M1's SQL is wrong? Each entry below is one
small change to migrations/2026111103_student_page_fields.sql: a rule
dropped, a filter loosened, a column swapped, a line of the old function
altered. For each, a copy of the file with that one change is applied to
fresh copies of the template and student_page_fields.py is run against it.
A change the suite does not notice is a hole in the suite.

    PGDATABASE=<template> python3 student_page_fields_mutate.py          every change
    PGDATABASE=<template> python3 student_page_fields_mutate.py 3 11     only those (by number)

The changed copy carries the fingerprints of its own changed functions
(measured here, not typed), so the file's "is each function what I expect"
check does not catch the change for the suite, and the suite's own
comparisons of fingerprints are skipped (MUTATED): what is measured is
whether a check of what the functions DO fails. With the true fingerprints
in place every change to a function is caught three more times: by the
file's last step, by a second run, and by the live post-check. Two entries
near the end are caught by the file itself, which refuses to apply; they
say so.

It prints one line per change: how many checks failed, and the first.
"""
import subprocess, tempfile
from student_page_fields import *

FAST = 'same fields todo privacy grants'
# (what was changed, the text taken out, the text put in, scenarios to run)
CHANGES = [
    # ── The To Do count ─────────────────────────────────────────────────────
    ('to_do forgets Missing work',
     "                            and (coalesce(g.r->>'status', '') = 'NS'\n                                 or (coalesce(g.r->>'status', '') <> 'EXC' and g.r->>'returned_at' is null)))",
     "                            and (coalesce(g.r->>'status', '') <> 'EXC' and g.r->>'returned_at' is null))", FAST),
    ('to_do counts Excused work',
     "or (coalesce(g.r->>'status', '') <> 'EXC' and g.r->>'returned_at' is null)))", "or (g.r->>'returned_at' is null)))", FAST),
    ('to_do counts a DIBELS benchmark', "                            and a.score_mode <> 'dibels'\n                            and (coalesce(", "                            and (coalesce(", FAST),
    ('to_do counts pieces whose date has not come',
     "                            and (a.date_assigned is null\n                                 or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)\n", "", FAST),
    ("to_do reads today's date where the server is, not where the class is",
     "or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)", "or a.date_assigned <= current_date)", FAST),
    ('to_do asks whether a grade is shown, not whether the piece came back (a returned piece whose competencies were all removed would wait again)',
     "<> 'EXC' and g.r->>'returned_at' is null)))", "<> 'EXC' and g.r->'grade' = 'null'::jsonb)))", FAST),
    ("to_do counts every class's pieces", "                          where a.course_id = c.id\n", "                          where true\n", FAST),
    ("to_do is another student's: whoever is first in the class", "cross join lateral _returned_grade(e.id, a.id) as g(r)",
     "cross join lateral _returned_grade((select e2.id from enrollment e2 where e2.course_id = c.id order by e2.id limit 1), a.id) as g(r)", FAST),
    # ── The other new keys ──────────────────────────────────────────────────
    ("teacher_name is the teacher's email", "(select nullif(t.display_name, '') from teacher t where t.id = _course.teacher_id)",
     "(select nullif(t.email, '') from teacher t where t.id = _course.teacher_id)", FAST),
    ("teacher_name is any teacher's", "from teacher t where t.id = _course.teacher_id)", "from teacher t order by t.id desc limit 1)", FAST),
    ("i_can sends the competency's own wording", "'i_can', to_jsonb(t.i_can_statements)", "'i_can', to_jsonb(array[t.i_can_text])", FAST),
    ('a criterion lists a competency that was taken off the class',
     "                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),",
     "                                                              and s.course_id = _course.id), '[]'::jsonb),", FAST),
    ("a criterion lists another class's competency",
     "                                                              and s.course_id = _course.id and s.removed_at is null), '[]'::jsonb),",
     "                                                              and s.removed_at is null), '[]'::jsonb),", FAST),
    ('an empty description is sent as empty, not null', "'description', nullif(a.description, ''),", "'description', a.description,", FAST),
    ("another class's module is named", "(select m.name from module m where m.id = a.module_id and m.course_id = _course.id)", "(select m.name from module m where m.id = a.module_id)", FAST),
    ("another class's category is named", "left join category k on k.id = a.category_id and k.course_id = _course.id", "left join category k on k.id = a.category_id", FAST),
    ('a Proficiency class is given a percent', "when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight", "when _weights = 100 then k.weight", FAST),
    ('a class whose weights do not total 100 is given a percent', "when _course.grading_system in ('letter', 'both') and _weights = 100 then k.weight",
     "when _course.grading_system in ('letter', 'both') then k.weight", FAST),
    ('a DIBELS benchmark is given a percent', "'category_percent', case when a.score_mode = 'dibels' then null\n                                                    when k.weight = 0 then 0",
     "'category_percent', case when k.weight = 0 then 0", FAST),
    ('a category that weighs 0 is given no percent', "                                                    when k.weight = 0 then 0\n", "", FAST),
    ('Core Competencies come in the order of their codes, not the Ministry\'s', "jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.ord)", "jsonb_build_object('id', cc.id, 'name', cc.name) order by cc.id)", FAST),
    ('one Core Competency is named differently from shared/constants.js', "(4, 'CRT', 'Critical & Reflective Thinking'),", "(4, 'CRT', 'Critical and Reflective Thinking'),", FAST),
    # ── What the reply had before ───────────────────────────────────────────
    ('a draft comes back: the grade is read from the working copy',
     "                       || _returned_grade(p_enrollment_id, a.id)\n",
     "                       || _returned_grade(p_enrollment_id, a.id) || jsonb_build_object('grade', public._grade_copy(p_enrollment_id, a.id))\n", FAST),
    ('pieces whose date has not come are listed',
     "             where a.course_id = _course.id\n               and (a.date_assigned is null or a.date_assigned <= _today)), '[]'::jsonb));",
     "             where a.course_id = _course.id), '[]'::jsonb));", FAST),
    ("the pieces of a day lose the class's own order", "order by a.date_assigned nulls first, a.display_order, a.created_at, a.id)", "order by a.date_assigned nulls first, a.created_at, a.id)", FAST),
    ('a competency taken off the class stays in tags', "             where s.course_id = _course.id and s.removed_at is null), '{}'::jsonb),", "             where s.course_id = _course.id), '{}'::jsonb),", FAST),
    ("the list of classes keeps a class whose page was turned off", "c.deleted_at is null and c.student_page_enabled;", "c.deleted_at is null;", FAST),
    ("the list of classes keeps a class whose card was replaced", "       and k.stopped_at is null and e.withdrawn_at is null", "       and e.withdrawn_at is null", FAST),
    ('the student is called by their first name where they have a preferred one (in the list of classes)',
     "'student', jsonb_build_object('first_name', coalesce(nullif(btrim(s.preferred_name), ''), s.first_name)),\n               'course', jsonb_build_object('name', c.name, 'block', c.block),\n               'to_do'",
     "'student', jsonb_build_object('first_name', s.first_name),\n               'course', jsonb_build_object('name', c.name, 'block', c.block),\n               'to_do'", FAST),
    ('v becomes 2', "'ok', true, 'v', 1,", "'ok', true, 'v', 2,", FAST),
    # ── Caught by the file itself ───────────────────────────────────────────
    ('page is granted to signed-in teachers as well and its revoke is gone (the file refuses itself)',
     "revoke all on function student_submit.page(text, uuid, text) from public, anon, authenticated;\ngrant execute on function student_submit.page(text, uuid, text) to service_role;",
     "grant execute on function student_submit.page(text, uuid, text) to service_role, authenticated;", 'grants'),
    ('page loses pg_temp from its search_path (the file refuses itself)',
     "create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)\n returns jsonb\n language plpgsql\n stable\n security definer\n set search_path to 'public', 'student_submit', 'pg_temp'",
     "create or replace function student_submit.page(p_session_token text, p_enrollment_id uuid, p_ip_hash text)\n returns jsonb\n language plpgsql\n stable\n security definer\n set search_path to 'public', 'student_submit'", 'fields'),
    ('the check that every column is there is taken out (the suite renames a column and expects the file to stop)',
     "    if _left is not null then\n        raise exception 'a column the new lines read is not there: %. Nothing was changed.', _left;\n    end if;\nend\n$guard$;",
     "end\n$guard$;", 'apply'),
]

if __name__ == '__main__':
    wanted = [int(a) for a in sys.argv[1:]]
    unnoticed = []; tmp = tempfile.mkdtemp(prefix='s4-m1-mutate-')
    text = text_of(MIGRATION); true = {s: v[1] for s, v in recorded(text).items()}
    for n, (label, old, new, scenarios) in enumerate(CHANGES, 1):
        if wanted and n not in wanted: continue
        if text.count(old) != 1:
            print('%2d  CANNOT MAKE THIS CHANGE (its text is in the file %d times): %s' % (n, text.count(old), label)); unnoticed.append(n); continue
        changed = text.replace(old, new)
        try:
            changed = restamp(changed, true, measured(changed))      # its own fingerprints, so the file does not refuse itself for that alone
        except Exception as e:
            print('%2d  noticed: the changed function cannot be made  %s\n      %s' % (n, label, message(e)[:170])); continue
        path = os.path.join(tmp, 'changed-%02d.sql' % n); open(path, 'w').write(changed)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'student_page_fields.py')] + scenarios.split(), capture_output=True, text=True, cwd=HERE,
                           env=dict(os.environ, S4_M1_FILE=path))
        fails = [l[5:].split(' :: ')[0] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        crashed = r.returncode != 0 and not fails
        if fails: print('%2d  noticed by %3d checks  %s\n      first: %s' % (n, len(fails), label, fails[0][:170]))
        elif crashed: print('%2d  noticed: the suite stopped  %s\n      %s' % (n, label, ((r.stdout + r.stderr).strip().splitlines() or ['?'])[-1][:170]))
        else: print('%2d  NOT NOTICED  %s' % (n, label)); unnoticed.append(n)
        sys.stdout.flush()
    print('%d changes, %d not noticed%s' % (len(wanted) or len(CHANGES), len(unnoticed), ': ' + ', '.join(map(str, unnoticed)) if unnoticed else ''))
    sys.exit(1 if unnoticed else 0)
