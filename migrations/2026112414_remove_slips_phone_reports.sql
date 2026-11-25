-- Questionnaire slips and phone report links are removed (2026-11-24). APPLIED Nov 24 2026 on Colin's word ("get rid of it"), after review; the two edge functions were deployed first.
--
-- Both are retired. Reflect opens questionnaires from the student's card sign-in with no slips, and the phone
-- report was taken off the student page on Nov 14. Colin, Nov 24: "get rid of it, no students actually got them."
-- Less reachable code is the point: nothing here can be opened by a printed code any more.
--
-- == What goes ==
-- Tables (rows go with them):
--   public.phone_report, public.phone_report_student, public.student_access_code, student_submit.session.
-- Functions dropped (15): public._phone_report_json, _phone_report_put, close_phone_report, create_phone_report,
--   list_phone_reports, update_phone_report; student_submit.issue_slips, slip_roster, open, verify, "check",
--   submit, report, _payload, _preview.
-- Functions rewritten in place (three, the rest of each word for word):
--   fv_private.teacher_of   loses its 'phone_report' and 'access_code' kinds.
--   student_submit.forms    (a card session's list of forms) no longer returns 'reports'.
--   student_submit.answer   (a card session sending a questionnaire's answers) no longer marks a slip used.
--
-- == What rows are deleted (read-only counts on gradebook-prod, Nov 24 2026) ==
--   phone_report            1   (closed)
--   phone_report_student   30   (the teacher's copy of each student's report, with its comment)
--   student_access_code   126   (30 phone report codes, 96 questionnaire slips; none live: all expired or revoked)
--   student_submit.session  0
-- THIS DELETES DATA and cannot be undone: the rows are gone once it applies. Answers students already sent
-- through a slip stay (response and answer rows are not touched). The log (student_submit.attempt) keeps its
-- rows; they carry a code id that points at nothing now and age out after 30 days. Cards (student_card,
-- device_session, issue_cards, card sign-in), Reflect (card, forms, form, answer), Bulletins, Send Work and
-- quizzes are not touched.
--
-- == What applying it accepts ==
-- Irreversible. A slip or phone report code that someone still holds answers not found (the edge function's
-- routes open, check, submit and report go in the same pull request; apply this and deploy student-submit and
-- teacher-cards back to back). The edge functions in the pull request call none of the dropped functions.
-- Between the apply and the deploy, an old student-submit would answer a server error to slip routes only; cards
-- and Reflect would not change, because forms keeps working for an old function (it ignores a missing 'reports').
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the running role owns every function it
-- touches; each is the definition it was written against (md5 of pg_get_functiondef: live's, or, on a second run,
-- as this file leaves it, or already gone); no table it drops has a dependent outside the set (a plain DROP, no
-- CASCADE). Its last step checks that none of the four tables remain, nothing left names them, and the three
-- rewritten functions are as written, by their md5 (each is made from its own live text with exact edits, so security, volatility, search path and grants are as they were).
--
-- == Locks and re-running ==
-- One transaction; it gives up after five seconds on a lock with nothing applied. A second run changes nothing.
--
-- == If the empty structure is ever needed again ==
-- The tables came from migrations 20261025_phone_reports and 20261025_questionnaires_tables_and_functions, with
-- later columns from 2026111160 (code_hmac, pw_hmac, key_id) and 2026112406; the functions are in
-- migrations/baseline/30-functions.sql as of commit 9c56d222. The data would not come back.
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

do $guard$
declare
    _f   record;
    _md5 text;
    _me  oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    -- Rewritten: as live has them, or as this file leaves them.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN rewritten
            ('fv_private.teacher_of(text,uuid)', 'c2ed64921a7413c387fafdee8038fae2', 'a722b3c4140ec5c9b5439a3551ff3d4b'),
            ('student_submit.forms(text,uuid,text)', 'e0445a5cb7018f27bdcdb1e0f2c2171d', 'fcaa14dce09f7aff792cb167651ed0a6'),
            ('student_submit.answer(text,uuid,uuid,jsonb,text)', 'd625cba1843c7b409a5cb8743c7471fd', '342ecc1d9858264f8f4b420b9934c38d')
            -- FINGERPRINTS-END
        ) as v(fn, live, after)
    loop
        if to_regprocedure(_f.fn) is null then
            raise exception '% is missing. Nothing was changed.', _f.fn;
        end if;
        if (select proowner from pg_proc where oid = to_regprocedure(_f.fn)) <> _me then
            raise exception 'Run this as the owner of % (% is not). Nothing was changed.', _f.fn, current_user;
        end if;
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 not in (_f.live, _f.after) then
            raise exception '% is not the definition this file was written against (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    -- Dropped: as live has them, or already gone (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN dropped
            ('public._phone_report_json(uuid)', '9a4bdd3d2f08780ec90919777ada3089'),
            ('public._phone_report_put(uuid,uuid,jsonb)', '7f16fa3a62f1b0f6899b1731bf7de022'),
            ('public.close_phone_report(uuid,uuid)', 'c48bba0c9b0518a6cd962482ea8dde47'),
            ('public.create_phone_report(uuid,integer,text,date,jsonb,uuid)', 'ba3b0d2c4e47b3f517bf67648a90f8cf'),
            ('public.list_phone_reports(uuid)', 'e30b974b9b852de21e01049e16e3d7d3'),
            ('public.update_phone_report(uuid,jsonb,date,uuid)', 'af3a4d8dceebd78e2757e15470767100'),
            ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'e5d9e73d108af18b66eee64fa0dca0ef'),
            ('student_submit.slip_roster(uuid,text,uuid)', '33954320e0812e4c22e5936bb2ee76a9'),
            ('student_submit.open(text,text,text,text)', '49d84f9a59520e5ae3b53716ae75f14d'),
            ('student_submit.verify(text,text,text,text,text)', 'fdc95c2c5d2cc6955fc76cfa488b7700'),
            ('student_submit."check"(text,text,text)', '87c95addbfe06444c8350a774e8e984c'),
            ('student_submit.submit(text,jsonb,text)', '0ffa8fff7d8fc10daea29a4a7f90357d'),
            ('student_submit.report(text,uuid,uuid,text)', '1e6beb102ac13d27c852f76075dbee86'),
            ('student_submit._payload(uuid)', '7382a387265a87a32c6e4f22f0b1a898'),
            ('student_submit._preview(uuid)', '336c6ed6f0b914a04ca678fa24137333')
            -- FINGERPRINTS-END
        ) as v(fn, live)
    loop
        if to_regprocedure(_f.fn) is null then
            continue;
        end if;
        if (select proowner from pg_proc where oid = to_regprocedure(_f.fn)) <> _me then
            raise exception 'Run this as the owner of % (% is not). Nothing was changed.', _f.fn, current_user;
        end if;
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 <> _f.live then
            raise exception '% is not the definition this file was written against (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    -- The tables: owned by the running role.
    if exists (select 1 from pg_class c
                where c.oid in (to_regclass('public.phone_report'), to_regclass('public.phone_report_student'),
                                to_regclass('public.student_access_code'), to_regclass('student_submit.session'))
                  and c.relowner <> _me) then
        raise exception 'Run this as the owner of the four tables it drops (% is not). Nothing was changed.', current_user;
    end if;
    -- The rows it will delete, for the record (Colin's pre-check read 1 / 30 / 126 / 0 on Nov 24 2026).
    if to_regclass('public.student_access_code') is not null then
        raise notice 'phone_report % rows, phone_report_student % rows, student_access_code % rows, session % rows',
            (select count(*) from public.phone_report), (select count(*) from public.phone_report_student),
            (select count(*) from public.student_access_code), (select count(*) from student_submit.session);
    end if;
end
$guard$;

-- 1. The three that keep living lose their slip and report branches. Each edit must be found exactly once.
do $rewrite$
declare
    _fn   text;
    _def  text;
    _from text;
    _to   text;
    _edits jsonb;
    _e    jsonb;
begin
    for _fn, _edits in
        select * from (values
        ('fv_private.teacher_of(text,uuid)', $e$[
          ["    when 'phone_report' then\n        select c.teacher_id into _t from phone_report x join course c on c.id = x.course_id where x.id = p_id;\n", ""],
          ["    when 'access_code' then\n        select c.teacher_id into _t\n          from student_access_code x join enrollment e on e.id = x.enrollment_id join course c on c.id = e.course_id where x.id = p_id;\n", ""]
        ]$e$::jsonb),
        ('student_submit.answer(text,uuid,uuid,jsonb,text)', $e$[
          ["    -- A slip of this student's for it, not yet used, can no longer send it.\n    update student_access_code set used_at = _now\n     where questionnaire_id = _q.id and enrollment_id = p_enrollment_id and used_at is null and revoked_at is null;\n", ""]
        ]$e$::jsonb),
        ('student_submit.forms(text,uuid,text)', $e$[
          ["    _today  date;\n", ""],
          ["    _today := (now() at time zone public._fv_timezone(_course.timezone))::date;\n", ""],
          [",\n        'reports', coalesce((\n            select jsonb_agg(jsonb_build_object(\n                       'id', r.id, 'title', coalesce(r.term_label, 'Report ' || r.term),\n                       'issued_at', r.issued_at, 'expires_on', r.expires_on,\n                       'opened_at', (select min(c.opened_at) from student_access_code c\n                                      where c.phone_report_id = r.id and c.enrollment_id = p_enrollment_id),\n                       'overall', s.data->'overall', 'comment', s.data->'comment')\n                     order by r.issued_at desc, r.id)\n              from phone_report r\n              join phone_report_student s on s.report_id = r.id and s.enrollment_id = p_enrollment_id\n             where r.course_id = _course.id and r.closed_at is null and _today <= r.expires_on), '[]'::jsonb));\n", ");\n"]
        ]$e$::jsonb)
        ) as v(fn, edits)
    loop
        _def := pg_get_functiondef(_fn::regprocedure);
        for _e in select * from jsonb_array_elements(_edits) loop
            _from := _e->>0;
            _to := _e->>1;
            if (length(_def) - length(replace(_def, _from, ''))) / length(_from) = 1 then
                _def := replace(_def, _from, _to);
            elsif position(_from in _def) > 0 then
                raise exception '% has the text to remove more than once. Nothing was changed.', _fn;
            end if;
            -- else: already removed (a second run)
        end loop;
        if _def is distinct from pg_get_functiondef(_fn::regprocedure) then
            execute _def;
        end if;
    end loop;
end
$rewrite$;

-- 2. The phone report and slip functions.
drop function if exists public._phone_report_json(uuid);
drop function if exists public._phone_report_put(uuid, uuid, jsonb);
drop function if exists public.close_phone_report(uuid, uuid);
drop function if exists public.create_phone_report(uuid, integer, text, date, jsonb, uuid);
drop function if exists public.list_phone_reports(uuid);
drop function if exists public.update_phone_report(uuid, jsonb, date, uuid);
drop function if exists student_submit.issue_slips(uuid, text, uuid, jsonb, text, uuid);
drop function if exists student_submit.slip_roster(uuid, text, uuid);
drop function if exists student_submit.open(text, text, text, text);
drop function if exists student_submit.verify(text, text, text, text, text);
drop function if exists student_submit."check"(text, text, text);
drop function if exists student_submit.submit(text, jsonb, text);
drop function if exists student_submit.report(text, uuid, uuid, text);
drop function if exists student_submit._payload(uuid);
drop function if exists student_submit._preview(uuid);

-- 3. The tables and their rows (a plain DROP: if anything else depends on one, this stops).
delete from public.fv_idempotency where endpoint in ('create_phone_report', 'update_phone_report', 'close_phone_report', 'issue_slips');
drop table if exists student_submit.session;
drop table if exists public.student_access_code;
drop table if exists public.phone_report_student;
drop table if exists public.phone_report;

-- Nothing left names what was removed, and the three rewritten functions kept their shape.
do $final$
declare
    _got text;
begin
    if to_regclass('public.phone_report') is not null or to_regclass('public.phone_report_student') is not null
       or to_regclass('public.student_access_code') is not null or to_regclass('student_submit.session') is not null then
        raise exception 'a table is still there. Nothing was changed.';
    end if;
    if exists (select 1 from pg_proc
                where pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
                  and (prosrc ~* 'phone_report|student_access_code|issue_slips|slip_roster|student_submit[.]session'
                       or proname ~* 'phone_report|slip')) then
        raise exception 'a function still names a removed table or function. Nothing was changed.';
    end if;
    if exists (select 1 from pg_proc where pronamespace = 'student_submit'::regnamespace
                and proname in ('open', 'verify', 'check', 'submit', 'report', '_payload', '_preview')) then
        raise exception 'a slip function is still there. Nothing was changed.';
    end if;
    select md5(pg_get_functiondef('fv_private.teacher_of(text,uuid)'::regprocedure)) into _got;
    if _got <> 'a722b3c4140ec5c9b5439a3551ff3d4b' then raise exception 'teacher_of came out as % . Nothing was changed.', _got; end if;
    select md5(pg_get_functiondef('student_submit.forms(text,uuid,text)'::regprocedure)) into _got;
    if _got <> 'fcaa14dce09f7aff792cb167651ed0a6' then raise exception 'forms came out as % . Nothing was changed.', _got; end if;
    select md5(pg_get_functiondef('student_submit.answer(text,uuid,uuid,jsonb,text)'::regprocedure)) into _got;
    if _got <> '342ecc1d9858264f8f4b420b9934c38d' then raise exception 'answer came out as % . Nothing was changed.', _got; end if;
end
$final$;

commit;
