"""Does the suite notice when Batch C's SQL is wrong? Each entry is one small
change to one of the two files: a check taken out, a limit moved, a grant
left on, the wrong copy sent. For each, the changed file (and the other,
unchanged) are applied, with their fingerprint lists stood aside, to fresh
copies of the template, and batch_c.py's behaviour scenarios are run on
them. A change no check notices is a hole in the suite.

    PGDATABASE=<template> BATCH_B_DIR=... python3 batch_c_mutate.py          every change
    PGDATABASE=...                         python3 batch_c_mutate.py 3 17    only those (by number)

The fingerprint lists are stood aside so the files' own "is every function
what I expect" checks, the second run and the live post-check do not catch
the change for the suite (with the lists in place each change to a function
is caught three more times). The scenarios run are the behaviour ones, not
apply1 and apply2, which compare fingerprints. A change the file itself
refuses to apply is reported as caught by the file.
"""
import subprocess, tempfile
from batch_c_common import *

C1S = 'teacher markup reflect revision group grants race'
C2S = 'hide given'
CHANGES = [
    # ── C1 ──
    ("save_markup: another teacher's page is saved (ownership not asked)", C1,
     "     where f.id = p_file_id and fv_owns_course(s.course_id);\n    if _course is not null then\n        perform _grade_return_lock_first(_course);\n    end if;\n    -- Asked under the lock (when there is a class to lock).\n    _cached := fv_idem_check(p_idempotency_key, 'save_markup');",
     "     where f.id = p_file_id;\n    if _course is not null then\n        perform _grade_return_lock_first(_course);\n    end if;\n    -- Asked under the lock (when there is a class to lock).\n    _cached := fv_idem_check(p_idempotency_key, 'save_markup');", 'teacher'),
    ("save_markup: a page of a send not handed in can be marked", C1,
     "     where f.id = p_file_id and s.course_id = _course and s.state = 'sent';", "     where f.id = p_file_id and s.course_id = _course;", 'teacher'),
    ("save_markup: marks are given at once in a class that holds grades", C1,
     "    if not _grade_return_holds(_s.enrollment_id) then\n        _given := _markup_give", "    if true then\n        _given := _markup_give", 'teacher markup'),
    ("save_markup: a stale screen overwrites another device's marks", C1,
     "    if p_base_rev is not null and coalesce(_m.working_rev, 0) <> p_base_rev then", "    if false then", 'teacher'),
    ("_markup_check: any mark type is taken", C1,
     "           or _m->>'type' not in ('pen', 'highlight', 'note', 'tick', 'cross') then", "           then", 'teacher'),
    ("_markup_check: no size limit", C1, "    if octet_length(p_marks::text) > 262144 then", "    if octet_length(p_marks::text) > 26214400 then", 'teacher'),
    ("_markup_give: a page given once is never given again", C1,
     "       set given = working, given_rev = working_rev, given_at = clock_timestamp()",
     "       set given = coalesce(given, working), given_rev = working_rev, given_at = clock_timestamp()", 'teacher markup'),
    ("return_work: the marks are not given", C1, "        _n := _markup_give(_e, p_assessment_id);", "        _n := 0;", 'teacher markup'),
    ("student markup: the teacher's working copy is sent", C1,
     "        select jsonb_agg(jsonb_build_object('file_id', m.file_id, 'marks', m.given, 'given_at', m.given_at) order by m.file_id)",
     "        select jsonb_agg(jsonb_build_object('file_id', m.file_id, 'marks', m.working, 'given_at', m.given_at) order by m.file_id)", 'markup'),
    ("student markup: Students See Your Mark Up is not asked", C1,
     "    if not _a.students_see_markup\n       or exists", "    if exists", 'markup'),
    ("student markup: Missing does not hide the marks", C1,
     "       or exists (select 1 from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = _a.id and s.status in ('NS', 'EXC')) then",
     "       or false then", 'markup'),
    ("student markup: every student's marks on the piece", C1,
     "         where m.assessment_id = _a.id and m.given is not null\n           and m.enrollment_id = any (coalesce(_group_members(_a.id, p_enrollment_id), array[p_enrollment_id]))), '[]'::jsonb));",
     "         where m.assessment_id = _a.id and m.given is not null), '[]'::jsonb));", 'markup group'),
    ("feedback: marks are counted before they are given", C1,
     "                           where m.assessment_id = a.id and m.given is not null", "                           where m.assessment_id = a.id", 'markup'),
    ("reflect: Reflect on Feedback off is not asked", C1,
     "    if not _course.reflect_on_feedback then\n        return jsonb_build_object('ok', false, 'error', 'reflect_off');\n    end if;", "", 'reflect'),
    ("reflect: work never returned can be reflected on", C1,
     "                    where g.enrollment_id = p_enrollment_id and g.assessment_id = _a.id and g.returned_at is not null) then",
     "                    where g.enrollment_id = p_enrollment_id and g.assessment_id = _a.id) then", 'reflect'),
    ("reflect: an answered reflection can be changed", C1,
     "    if found and _f.answer is not null then\n        return jsonb_build_object('ok', false, 'error', 'already_answered');\n    end if;\n    insert into feedback_reflection",
     "    insert into feedback_reflection", 'reflect'),
    ("reflect: another class's assessment is taken", C1,
     "    select * into _a from assessment\n     where id = p_assessment_id and course_id = _course.id\n       and (date_assigned",
     "    select * into _a from assessment\n     where id = p_assessment_id\n       and (date_assigned", 'reflect'),
    ("reply: before the teacher answered", C1,
     "    if _f.answer is null then\n        return jsonb_build_object('ok', false, 'error', 'not_answered');\n    end if;", "", 'reflect'),
    ("answer_reflection: another teacher's reflection is answered", C1,
     "    select f.course_id into _course from feedback_reflection f where f.id = p_reflection_id and fv_owns_course(f.course_id);",
     "    select f.course_id into _course from feedback_reflection f where f.id = p_reflection_id;", 'reflect'),
    ("return_for_revision: DIBELS is revised", C1,
     "    if _a.score_mode = 'dibels' then\n        return jsonb_build_object('result', 'not_for_dibels');\n    end if;", "", 'revision'),
    ("return_for_revision: a criterion of another rubric is taken", C1,
     "                    where not exists (select 1 from criterion cr where cr.id = c and cr.rubric_id = _a.rubric_id)) then",
     "                    where not exists (select 1 from criterion cr where cr.id = c)) then", 'revision'),
    ("return_for_revision: Hide is taken with nothing to do it", C1,
     "        if not _revision_hide_available() then", "        if false then", 'revision'),
    ("return_for_revision: the work is not returned first", C1,
     "    _ret := return_work(p_assessment_id, array[p_enrollment_id], null);", "    _ret := '{}'::jsonb;", 'revision'),
    ("revision_start: no open request is needed", C1,
     "    if _r.id is null then\n        return jsonb_build_object('ok', false, 'error', 'no_revision');\n    end if;\n    _st := public._revision_state(_r.id);",
     "    _st := public._revision_state(_r.id);", 'revision'),
    ("revision_start: a revision being graded can be sent again", C1,
     "    if _st->>'state' in ('grading', 'returned') then\n        return jsonb_build_object('ok', false, 'error', 'grading_started');\n    end if;\n    -- A revision in",
     "    -- A revision in", 'revision'),
    ("revision_finish: another student's send is handed in", C1,
     "     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id\n       and sent_by = 'student' and version > 1",
     "     where id = p_submission_id and course_id = _course.id\n       and sent_by = 'student' and version > 1", 'revision'),
    ("revision_finish: handed in with a page missing", C1,
     "    _state := public._work_files_state(_sub.id, p_files);\n    if _state->'missing' <> '[]'::jsonb then",
     "    _state := public._work_files_state(_sub.id, p_files);\n    if false then", 'revision'),
    ("revision_unsend: during grading", C1, "    if _st->>'state' <> 'sent' then", "    if false then", 'revision'),
    ("_revision_state: grading is never noticed", C1,
     "                             when md5(coalesce(g.working_copy::text, '')) is distinct from r.grade_mark then 'grading'\n", "", 'revision race'),
    ("revision_start: the hourly limit is 21", C1, "    if _n >= 20 then\n        return jsonb_build_object('ok', false, 'error', 'too_many',\n                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));\n    end if;\n\n    -- A send this student started for the piece and never finished goes.\n    perform set_config('fv.work_removal_reason', 'abandoned', true);\n    delete from submission\n     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';\n    perform set_config('fv.work_removal_reason', '', true);\n    if public._work_class_full",
     "    if _n >= 21 then\n        return jsonb_build_object('ok', false, 'error', 'too_many',\n                                  'retry_after_s', greatest(1, ceil(extract(epoch from (_oldest + interval '1 hour' - now())))::int));\n    end if;\n\n    -- A send this student started for the piece and never finished goes.\n    perform set_config('fv.work_removal_reason', 'abandoned', true);\n    delete from submission\n     where assessment_id = _a.id and enrollment_id = p_enrollment_id and state = 'sending' and sent_by = 'student';\n    perform set_config('fv.work_removal_reason', '', true);\n    if public._work_class_full", 'revision'),
    ("_group_members: a withdrawn member counts", C1,
     "              join enrollment e on e.id::text = lower(m) and e.course_id = a.course_id and e.withdrawn_at is null)",
     "              join enrollment e on e.id::text = lower(m) and e.course_id = a.course_id)", 'group'),
    ("group_file_links: every student's pages on the piece", C1,
     "               and s.enrollment_id = any (coalesce(_group_members(p_assessment_id, p_enrollment_id), array[p_enrollment_id]))), '[]'::jsonb));",
     "               ), '[]'::jsonb));", 'group'),
    ("a deleted assessment leaves its reflections", C1,
     "        delete from revision_request where assessment_id = old.id;\n        delete from feedback_reflection where assessment_id = old.id;",
     "        delete from revision_request where assessment_id = old.id;", 'reflect'),
    ("a student function is left runnable by signed-in teachers", C1,
     "revoke all on function student_submit.reflect(text, uuid, uuid, jsonb, text) from public, anon, authenticated;\n", "", 'grants'),
    ("a teacher RPC is left runnable by anon", C1,
     "revoke all on function public.save_markup(uuid, jsonb, integer, uuid) from public, anon;\n", "", 'grants teacher'),
    ("a helper is left runnable by the service role", C1,
     "revoke all on function public._markup_give(uuid, uuid) from public, anon, authenticated, service_role;\n", "", 'grants'),
    ("row security left off on markup", C1, "alter table public.markup enable row level security;\n", "", 'grants'),
    ("reflect without pg_temp in its search path", C1,
     " returns jsonb\n language plpgsql\n security definer\n set search_path to 'public', 'student_submit', 'pg_temp'\nas $function$\ndeclare\n    _in     jsonb;\n    _course course%rowtype;\n    _a      assessment%rowtype;",
     " returns jsonb\n language plpgsql\n security definer\n set search_path to 'public', 'student_submit'\nas $function$\ndeclare\n    _in     jsonb;\n    _course course%rowtype;\n    _a      assessment%rowtype;", 'grants'),
    # ── C2 ──
    ("C2: hiding is said to be unavailable", C2, "as $function$\n    select true;\n$function$;", "as $function$\n    select false;\n$function$;", C2S),
    ("C2: hide leaves returned_at", C2, "       set is_draft = true, returned_at = null, returned_copy = null, updated_at = null",
     "       set is_draft = true, returned_copy = null, updated_at = null", C2S),
    ("C2: hide does not make it a draft", C2, "       set is_draft = true, returned_at = null, returned_copy = null, updated_at = null",
     "       set returned_at = null, returned_copy = null, updated_at = null", C2S),
    ("C2: hide leaves updated_at", C2, "       set is_draft = true, returned_at = null, returned_copy = null, updated_at = null",
     "       set is_draft = true, returned_at = null, returned_copy = null", C2S),
    ("C2: hide keeps no copy of what the student had", C2,
     "                                             'copy', _copy, 'hidden_at', clock_timestamp()),", "                                             'hidden_at', clock_timestamp()),", C2S),
    ("C2: hide keeps the draft, not what the student had", C2,
     "    _copy := case when _g.is_draft then _g.returned_copy else _grade_copy(_r.enrollment_id, _r.assessment_id) end;",
     "    _copy := _grade_copy(_r.enrollment_id, _r.assessment_id);", C2S),
    ("C2: hide does not mark the request", C2, "       set grade_hidden = true,\n", "       set grade_hidden = false,\n", C2S),
    ("C2: hide reaches every student of the piece", C2,
     "    update grade_return\n       set is_draft = true, returned_at = null, returned_copy = null, updated_at = null\n     where enrollment_id = _r.enrollment_id and assessment_id = _r.assessment_id;",
     "    update grade_return\n       set is_draft = true, returned_at = null, returned_copy = null, updated_at = null\n     where assessment_id = _r.assessment_id;", C2S),
    ("C2: Take Back always leaves a draft", C2, "    if _now is not distinct from _h->'copy' then", "    if false then", C2S),
    ("C2: Take Back does not give returned_at back", C2,
     "           set is_draft = false, returned_at = (_h->>'returned_at')::timestamptz,", "           set is_draft = false, returned_at = now(),", C2S),
    ("C2: Take Back after the grade was returned changes it again", C2,
     "    if not found or not _g.is_draft or _g.returned_at is not null or _h is null then", "    if not found or _h is null then", C2S),
    ("C2: Take Back leaves the request marked hidden", C2,
     "    update revision_request set grade_hidden = false, updated_at = now() where id = _r.id;\n", "", C2S),
    ("C2: Take Back reaches every student of the piece", C2,
     "           set is_draft = false, returned_at = (_h->>'returned_at')::timestamptz,\n               updated_at = (_h->>'updated_at')::timestamptz, returned_copy = null\n         where enrollment_id = _r.enrollment_id and assessment_id = _r.assessment_id;",
     "           set is_draft = false, returned_at = (_h->>'returned_at')::timestamptz,\n               updated_at = (_h->>'updated_at')::timestamptz, returned_copy = null\n         where assessment_id = _r.assessment_id;", C2S),
    ("C2: the trigger gives nothing", C2, "    perform _markup_give(new.enrollment_id, new.assessment_id);\n    return null;", "    return null;", C2S),
    ("C2: the trigger mixes up student and piece", C2, "    perform _markup_give(new.enrollment_id, new.assessment_id);", "    perform _markup_give(new.assessment_id, new.enrollment_id);", C2S),
    ("C2: the trigger fires on a draft change", C2,
     "    for each row when (new.returned_at is not null and not new.is_draft\n                       and (old.returned_at is distinct from new.returned_at or old.is_draft))",
     "    for each row when (new.returned_at is not null)", C2S),
    ("C2: no trigger on a new row", C2,
     "create or replace trigger markup_given_on_insert after insert on public.grade_return\n    for each row when (new.returned_at is not null and not new.is_draft)\n    execute function public._markup_on_return();\n", "", C2S),
    ("C2: the update trigger watches only is_draft", C2, "after update of returned_at, is_draft on public.grade_return", "after update of is_draft on public.grade_return", C2S),
    ("C2: a hide helper left runnable", C2, "revoke all on function public._revision_hide_grade(uuid) from public, anon, authenticated, service_role;\n", "", C2S),
    ("C2: the trigger function left runnable", C2, "revoke all on function public._markup_on_return() from public, anon, authenticated, service_role;\n", "", C2S),
    ("C2: hide when nothing was returned", C2, "    if not found or _g.returned_at is null then\n        return false;\n    end if;\n    -- What the student sees now",
     "    if not found then\n        return false;\n    end if;\n    -- What the student sees now", C2S),
]

def run(i, desc, rel, old, new, scen):
    text = text_at(rel)
    n = text.count(old)
    if n != 1: return '%2d  NOT APPLIED (the text is there %d times): %s' % (i, n, desc)
    tmp = tempfile.mkdtemp()
    c1 = os.path.join(tmp, 'c1.sql'); c2 = os.path.join(tmp, 'c2.sql')
    open(c1, 'w').write(neutral(text.replace(old, new) if rel == C1 else text_at(C1)))
    open(c2, 'w').write(neutral(text.replace(old, new) if rel == C2 else text_at(C2)))
    names = scen.split()
    if rel == C2: names = [x for x in names] + []
    r = subprocess.run([sys.executable, os.path.join(HERE, 'batch_c.py')] + names, capture_output=True, text=True, cwd=HERE,
                       env=dict(os.environ, BATCH_C1=c1, BATCH_C2=c2))
    fails = [l[5:] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
    if not fails: return '%2d  MISSED: %s' % (i, desc)
    first = fails[0].split(' :: ')[0]
    by_file = 'ran to the end' in first and 'STOPPED' in fails[0] or "AssertionError: STOPPED" in fails[0]
    return '%2d  caught (%d checks%s): %s  [first: %s]' % (i, len(fails), ', the file refused to apply' if by_file else '', desc, first[:110])

if __name__ == '__main__':
    pick = [int(x) for x in sys.argv[1:]] or range(1, len(CHANGES) + 1)
    missed = 0
    for i in pick:
        line = run(i, *CHANGES[i - 1]); print(line, flush=True)
        if 'MISSED' in line or 'NOT APPLIED' in line: missed += 1
    c1n = sum(1 for c in CHANGES if c[1] == C1); c2n = len(CHANGES) - c1n
    print('%d changes (%d to C1, %d to C2); %d missed or not applied' % (len(list(pick)), c1n, c2n, missed))
    sys.exit(1 if missed else 0)
