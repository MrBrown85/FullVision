"""Does the suite notice when Batch B's SQL is wrong? Each entry below is one
small change to one of the two files: a check taken out, a limit moved, a
policy loosened, a lock dropped, a revoke left off. For each, a copy of the
file with that one change is applied to a fresh copy of the template and
submissions.py is run against it. A change the suite does not notice is a
hole in the suite.

    PGDATABASE=<template> python3 submissions_mutate.py            every change
    PGDATABASE=<template> python3 submissions_mutate.py 7 12       only those (by number)

The changed copy has its fingerprint lists stood aside, so the file's own
"is every function what I expect" checks do not catch the change for the
suite: what is being measured is whether a behaviour check fails. (With the
lists in place every change to a function is caught three more times: by
the file's last step, by a second run, and by the live post-check.) Two
entries are caught by the file itself, which refuses to apply; they say so.

It prints one line per change: how many checks failed, and the first.
"""
import subprocess, tempfile
from submissions_common import *

FAST = 'teacher student storage grants'
ALL = FAST + ' race'
# (what was changed, which file, the text taken out, the text put in, scenarios to run)
CHANGES = [
    ('a locked card may send', M1,
     "    if exists (select 1 from student_card k where k.id = (_in->>'card_id')::uuid and k.locked_at is not null) then\n        return jsonb_build_object('error', 'card_locked');\n    end if;\n    return _in;",
     "    return _in;", FAST),
    ("the class's Send Work switch is not asked when a send starts", M1,
     "    if not _course.send_work then\n        return jsonb_build_object('ok', false, 'error', 'send_off');\n    end if;\n    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;\n    _w := _work_window(_a.id);",
     "    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;\n    _w := _work_window(_a.id);", FAST),
    ('an assessment set to take nothing takes work', M1,
     "    if _a.students_send = 'nothing' then\n        return jsonb_build_object('ok', false, 'error', 'not_taking_work');\n    end if;\n\n    -- The same request again",
     "    -- The same request again", FAST),
    ("an assessment of another class is taken (the class is not compared)", M1,
     "    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;\n    _w := _work_window(_a.id);\n    if _a.id is null or not (_w->>'listed')::boolean then",
     "    select * into _a from assessment where id = p_assessment_id;\n    _w := _work_window(_a.id);\n    if _a.id is null or not (_w->>'listed')::boolean then", FAST),
    ('Stop after the due date never closes', M1,
     "when 'stop' then a.due_date is null or d.today <= a.due_date", "when 'stop' then true", FAST),
    ('Until a date closes a day late', M1,
     "'open', case a.after_due when 'until' then d.today <= a.accept_until", "'open', case a.after_due when 'until' then d.today <= a.accept_until + 1", FAST),
    ('an assessment whose date has not come can be sent to', M1,
     "'listed', a.date_assigned is null or a.date_assigned <= d.today,", "'listed', true,", FAST),
    ('late is never marked', M1,
     "'late', a.due_date is not null and d.today > a.due_date)", "'late', false)", FAST),
    ('the hourly limit is 21', M1, "    if _n >= 20 then", "    if _n >= 21 then", ALL),
    ('a send is not counted toward the hourly limit', M1, "    insert into send_log (card_id) values (_card);\n", "", ALL),
    ('the same request again is counted and makes a second send', M1,
     "    if found then\n        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,",
     "    if false then\n        return jsonb_build_object('ok', true, 'replayed', true, 'submission_id', _sub.id, 'state', _sub.state,", ALL),
    ('a draft does not count as grading (only a returned grade does)', M1,
     "    select coalesce((select g.is_draft or g.returned_at is not null", "    select coalesce((select g.returned_at is not null", FAST),
    ('Unsend does not ask whether grading has started', M1,
     "    if _grading_started(p_enrollment_id, _a.id) then\n        return jsonb_build_object('ok', false, 'error', 'grading_started');\n    end if;\n\n    select count(*) into _pages",
     "    select count(*) into _pages", ALL),
    ('Replace does not ask whether grading has started when it starts', M1,
     "        if _grading_started(p_enrollment_id, _a.id) then\n            return jsonb_build_object('ok', false, 'error', 'grading_started');\n        end if;\n    end if;\n\n    -- Twenty sends",
     "    end if;\n\n    -- Twenty sends", FAST),
    ('Replace does not ask whether grading has started when it finishes', M1,
     "        if _grading_started(p_enrollment_id, _sub.assessment_id) then", "        if false then", ALL),
    ("a student can unsend work the teacher added", M1,
     "    if _sent.sent_by <> 'student' then\n        return jsonb_build_object('ok', false, 'error', 'cannot_change');\n    end if;\n    if not _course.send_work then",
     "    if not _course.send_work then", FAST),
    ("a student can replace work the teacher added", M1,
     "        if _sent.sent_by <> 'student' then\n            -- the teacher added it, or marked it handed in on paper\n            return jsonb_build_object('ok', false, 'error', 'cannot_change');\n        end if;\n", "", FAST),
    ('work is handed in though a page is missing from storage', M1,
     "    _state := public._work_files_state(_sub.id, p_files);\n    if _state->'missing' <> '[]'::jsonb then\n        return jsonb_build_object('ok', false, 'error', 'missing_pages', 'missing', _state->'missing');",
     "    _state := public._work_files_state(_sub.id, p_files);\n    if false then\n        return jsonb_build_object('ok', false, 'error', 'missing_pages', 'missing', _state->'missing');", FAST),
    ("a missing thumbnail is not looked for", M1,
     "filter (where o.n = 0 or th.n = 0)", "filter (where o.n = 0)", FAST),
    ("a finish can name another student's send", M1,
     "     where id = p_submission_id and enrollment_id = p_enrollment_id and course_id = _course.id and sent_by = 'student'\n       for update;",
     "     where id = p_submission_id and course_id = _course.id and sent_by = 'student'\n       for update;", FAST),
    ("file_links gives every student's pages for the piece", M1,
     "             where s.assessment_id = p_assessment_id and s.enrollment_id = p_enrollment_id\n               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'), '[]'::jsonb));",
     "             where s.assessment_id = p_assessment_id\n               and s.course_id = (_in->>'course_id')::uuid and s.state = 'sent'), '[]'::jsonb));", FAST),
    ('Unsend does not take the class lock', M1,
     "    -- The lock a grade's save takes. An Unsend and the first level saved for\n    -- the piece take turns: whichever is second sees what the first did.\n    perform public._grade_return_lock_first((_in->>'course_id')::uuid);\n",
     "", 'race'),
    ('a send does not take the class lock when it starts', M1,
     "    perform public._grade_return_lock_first((_in->>'course_id')::uuid);\n    select * into _course from course where id = (_in->>'course_id')::uuid;\n    if not exists (select 1 from enrollment e\n                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n    if not _course.send_work then",
     "    select * into _course from course where id = (_in->>'course_id')::uuid;\n    if not exists (select 1 from enrollment e\n                    where e.id = p_enrollment_id and e.course_id = _course.id and e.withdrawn_at is null) then\n        return jsonb_build_object('ok', false, 'error', 'not_found');\n    end if;\n    if not _course.send_work then", 'race'),
    ('a deleted page queues no file', M1,
     "    insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)\n    select _work_bucket(), p, fv_private.work_path_course(p), _why, old.created_at + interval '2 hours 10 minutes'\n      from unnest(array[old.path, old.thumb_path]) p\n    on conflict (bucket, path) do nothing;\n    return null;",
     "    return null;", FAST),
    ("a deleted page queues its photo and not its thumbnail", M1, "      from unnest(array[old.path, old.thumb_path]) p", "      from unnest(array[old.path]) p", FAST),
    ("an assessment's submissions are not deleted with it", M1,
     "    else\n        delete from submission where assessment_id = old.id;\n    end if;\n    return null;", "    end if;\n    return null;", FAST + ' race'),
    ('removal_done believes the caller without looking in storage', M1,
     "       and not exists (select 1 from public._work_object(r.path));", "       ;", FAST),
    ("a removed file whose upload link is alive is finished with at once", M1, "       set removed_at = now(), done = now() >= r.link_dies_at", "       set removed_at = now(), done = true", FAST),
    ("a teacher may upload to a path named for a student's send", M1,
     "                      and s.state = 'sending' and s.sent_by = 'teacher'\n                      and fv_owns_course(s.course_id));", "                      and s.state = 'sending'\n                      and fv_owns_course(s.course_id));", FAST),
    ('a teacher may upload to the path of an upload that is finished', M1,
     "                      and s.state = 'sending' and s.sent_by = 'teacher'\n                      and fv_owns_course(s.course_id));", "                      and s.sent_by = 'teacher'\n                      and fv_owns_course(s.course_id));", FAST),
    ("any teacher may upload to another teacher's pending path", M1,
     "                      and s.state = 'sending' and s.sent_by = 'teacher'\n                      and fv_owns_course(s.course_id));", "                      and s.state = 'sending' and s.sent_by = 'teacher');", FAST),
    ("any signed-in teacher may read any class's files", M1,
     "    select coalesce(fv_owns_course(fv_private.work_path_course(p_name)), false);", "    select true;", FAST),
    ("Add Work does not check the student is the teacher's", M1,
     "    if not fv_owns_enrollment(p_enrollment_id)\n       or not exists (select 1 from enrollment e\n                       where e.id = p_enrollment_id and e.course_id = _course and e.withdrawn_at is null) then",
     "    if not exists (select 1 from enrollment e\n                       where e.id = p_enrollment_id and e.withdrawn_at is null) then", FAST),
    ("list_course_submissions does not check the class is the teacher's", M1,
     "    if not fv_owns_course(p_course_id) then\n        raise exception 'course not found' using errcode = 'P0002';\n    end if;\n    return jsonb_build_object(\n        'bucket', _work_bucket(),",
     "    return jsonb_build_object(\n        'bucket', _work_bucket(),", FAST),
    ("delete_submission does not check the class is the teacher's", M1,
     "    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);\n    if _course is not null then\n        perform _grade_return_lock_first(_course);",
     "    select s.course_id into _course from submission s where s.id = p_submission_id;\n    if _course is not null then\n        perform _grade_return_lock_first(_course);", FAST),
    ("a patch to a class's settings also resets the one it does not name", M1,
     "       set send_work = case when p_patch ? 'send_work' then (p_patch->>'send_work')::boolean else send_work end,",
     "       set send_work = coalesce((p_patch->>'send_work')::boolean, false),", FAST),
    ('the same idempotency key again runs the upload start a second time', M1,
     "    _cached := fv_idem_check(p_idempotency_key, 'start_work_upload');\n    if _cached is not null then return _cached; end if;\n", "", FAST),
    ('a helper is left runnable by whoever the defaults allow', M1,
     "revoke all on function public._work_object(text) from public, anon, authenticated, service_role;\n", "", 'grants'),
    ('a student function is left runnable by whoever the defaults allow', M1,
     "revoke all on function student_submit.unsend(text, uuid, uuid, text) from public, anon, authenticated;\n", "", 'grants'),
    ('the two tables are left readable by whoever the defaults allow', M1,
     "revoke all on table public.submission, public.submission_file from public, anon, authenticated;\n", "", 'grants'),
    # For the three tables in public, leaving this statement out changes nothing: the database's own event trigger
    # (ensure_rls, which gradebook-prod has too) turns row security on for every new table there. The send count is
    # in student_submit, where nothing else would.
    ('row security is not turned on for the send count', M1, "alter table student_submit.send_log enable row level security;\n", "", 'grants'),
    ('one function loses pg_temp from its search_path (the file refuses itself)', M1,
     "create or replace function public.delete_submission(p_submission_id uuid, p_idempotency_key uuid default null)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'public', 'pg_temp'",
     "create or replace function public.delete_submission(p_submission_id uuid, p_idempotency_key uuid default null)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'public'", 'teacher'),
    ('the bucket is public (the file refuses itself)', M2,
     "values ('student-photos', 'student-photos', false, 2097152, array['image/jpeg'])", "values ('student-photos', 'student-photos', true, 2097152, array['image/jpeg'])", 'storage'),
    ('the read policy drops the ownership check', M2,
     "    using (bucket_id = 'student-photos' and fv_private.work_read_allowed(name));", "    using (bucket_id = 'student-photos');", 'storage'),
    ('the upload policy drops the named-path check', M2,
     "    with check (bucket_id = 'student-photos' and fv_private.work_upload_allowed(name));", "    with check (bucket_id = 'student-photos');", 'storage'),
    ('the fence lets a signed-in teacher through', M2,
     "    using (bucket_id is distinct from 'student-photos' or fv_private.work_read_allowed(name))\n    with check (bucket_id is distinct from 'student-photos' or fv_private.work_upload_allowed(name));",
     "    using (true)\n    with check (true);", 'storage'),
    ('the teachers-only policy lets every role through', M2,
     "    using (bucket_id is distinct from 'student-photos' or current_user = 'authenticated')\n    with check (bucket_id is distinct from 'student-photos' or current_user = 'authenticated');",
     "    using (true)\n    with check (true);", 'storage'),
    ('the read policy is for every role, not signed-in teachers', M2,
     "create policy fv_student_photos_read on storage.objects\n    for select to authenticated", "create policy fv_student_photos_read on storage.objects\n    for select to public", 'storage'),
]

def neutral(text):
    return MARK.sub(lambda m: m.group(1) + "            ('public.no_such_function_at_all()', 'absent')" + m.group(3), text)

if __name__ == '__main__':
    wanted = [int(a) for a in sys.argv[1:]]
    unnoticed = []; tmp = tempfile.mkdtemp(prefix='batch-b-mutate-')
    texts = {M1: text_of(M1), M2: text_of(M2)}
    for n, (label, which, old, new, scenarios) in enumerate(CHANGES, 1):
        if wanted and n not in wanted: continue
        if texts[which].count(old) != 1:
            print('%2d  CANNOT MAKE THIS CHANGE (its text is in the file %d times): %s' % (n, texts[which].count(old), label)); unnoticed.append(n); continue
        paths = {}
        for f in (M1, M2):
            # M2's guard compares the three policy functions with its list; stood aside like the rest.
            body = neutral(texts[f].replace(old, new) if f == which else texts[f])
            paths[f] = os.path.join(tmp, os.path.basename(f)); open(paths[f], 'w').write(body)
        r = subprocess.run([sys.executable, os.path.join(HERE, 'submissions.py')] + scenarios.split(), capture_output=True, text=True, cwd=HERE,
                           env=dict(os.environ, BATCH_B_M1=paths[M1], BATCH_B_M2=paths[M2]))
        fails = [l[5:].split(' :: ')[0] for l in r.stdout.splitlines() if l.startswith('FAIL ')]
        crashed = r.returncode != 0 and not fails
        if fails: print('%2d  noticed by %3d checks  %s\n      first: %s' % (n, len(fails), label, fails[0][:170]))
        elif crashed: print('%2d  noticed: the suite stopped  %s\n      %s' % (n, label, (r.stderr.strip().splitlines() or ['?'])[-1][:170]))
        else: print('%2d  NOT NOTICED  %s' % (n, label)); unnoticed.append(n)
        sys.stdout.flush()
    print('%d changes, %d not noticed%s' % (len(wanted) or len(CHANGES), len(unnoticed), ': ' + ', '.join(map(str, unnoticed)) if unnoticed else ''))
    sys.exit(1 if unnoticed else 0)
