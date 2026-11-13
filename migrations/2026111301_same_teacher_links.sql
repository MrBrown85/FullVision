-- Every id a row names must belong to the same teacher as the row (2026-11-13).
--
-- THIS FILE DELETES NOTHING AND CHANGES NO ROW. It adds two functions in
-- fv_private and one trigger, same_teacher, on each of the 45 tables whose
-- rows name two or more records. It changes no existing function, policy or
-- grant.
--
-- ── What broke, and why ─────────────────────────────────────────────────────
-- Each table's row security rule checks one parent: an enrollment's class,
-- a goal's enrollment, an observation tag's observation. It never checked
-- the other ids the same row names. So a teacher who knew another
-- teacher's id could write a row of their own that pointed at it: enrol the
-- other teacher's student in their own class, tag their own observation
-- with the other teacher's competency, or put a questionnaire response under
-- the other teacher's questionnaire. The app's own write functions took the
-- same path, and some of them skip row security (security definer), so a
-- rule change alone would not have closed it. Once linked, a function that
-- reads the whole class (get_class_bundle) returned the other teacher's
-- student record. Ids are random, so this needed one of the other teacher's
-- ids. The security rule tests on the rebuilt database found it
-- (tests/db/run.mjs).
--
-- ── What this does ──────────────────────────────────────────────────────────
-- 1. fv_private.teacher_of(kind, id): the teacher who owns a class,
--    student, enrollment, assessment, rubric, tag and every other kind a row
--    names, read through the class. Null when the id names no row.
-- 2. fv_private.same_teacher_problem(row, columns): the first column of a
--    row whose record belongs to a different teacher than the row's other
--    records, or null. An id that names no row is not judged here (a
--    foreign key or the app judges that). For a copy group (one assessment
--    or rubric shared by several classes) it is a problem when another
--    teacher's assessment or rubric already uses the group.
-- 3. fv_private.same_teacher(): the trigger. Before an insert, and before an
--    update that changes one of the named columns, it refuses the row with
--    error 42501 ("insufficient privilege", the code row security uses):
--    "<table>.<column> names a record of another teacher". It runs for every
--    caller: a signed-in teacher, the app's security definer functions, the
--    student page's server (service_role) and the nightly jobs.
-- 4. Before any trigger is made, every existing row of the 45 tables is
--    checked the same way. If one breaks the rule, the file stops with
--    nothing changed. The read-only count of those rows, per table and
--    column, is the audit query that goes with this file.
-- 5. One trigger per table, in the list below. Tables whose rows name one
--    record only (a category's class, a note's enrollment) need none: row
--    security already checks that one.
--
-- Left out by name, with the reason:
--   student_submit.device_session_enrollment.session_id: a phone's sign-in
--     may hold the cards of students of several teachers. The card and the
--     enrollment it holds are still checked.
--   student_submit.attempt: a log of sign-in tries, written only by the
--     student page server; code_id holds a card id or a code id.
--   public.markup_kept.file_id: the id a removed file had; it names no row.
--   public.fv_idempotency.key: a request key, not a row id.
--   public.questionnaire.template_id: the shared list of templates, which
--     belongs to no teacher (it is text, not a teacher's row).
--
-- ── What it costs ───────────────────────────────────────────────────────────
-- A few index lookups per row written (one per named id, two or three
-- tables each). An update that changes none of the named columns, such as a
-- score's value or a comment, only compares the old and new ids. Measured
-- on PostgreSQL 17 (the rehearsal database, 2026-11-13): the check takes
-- about 0.025 ms for a score row (two ids) and 0.04 ms for a submission row
-- (six ids), so about 4 ms on a fill of 150 scores.
--
-- ── Checked on the live database before it was applied ──────────────────────
-- 2026-11-13, read-only, counts only: migrations/local-test/same-teacher-links-audit.sql
-- ran its 69 checks, one per (table, column), and found 0 rows that name a
-- record of another teacher. Applied the same day as same_teacher_links;
-- afterwards the three functions' fingerprints matched the ones in the
-- guard below and all 45 triggers were in place and enabled.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- Fast stop, writes exactly as before: migrations/local-test/same-teacher-links-stop.sql
-- drops the 45 triggers. Full removal: migrations/local-test/same-teacher-links-undo.sql
-- drops the triggers and the three functions. Neither touches a row.
--
-- One transaction: all or nothing.
begin;

set local lock_timeout = '5s';

-- The check it makes first: the functions it makes are absent, or exactly
-- as this file makes them (a second run). md5 of pg_get_functiondef on
-- PostgreSQL 17.
do $guard$
declare
    _f text;
    _want text;
    _md5 text;
begin
    for _f, _want in values
        ('fv_private.teacher_of(text,uuid)', 'c2ed64921a7413c387fafdee8038fae2'),
        ('fv_private.same_teacher_problem(jsonb,text[])', 'c79c97b49b7d5d31b1e9e72c9f4145a1'),
        ('fv_private.same_teacher()', '81cd77e2e122e6b12562a3ff412871f0')
    loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f)));
        if _md5 is not null and _md5 <> _want then
            raise exception '% exists and is not the definition this file makes (found %, expected %). Nothing was changed.', _f, _md5, _want;
        end if;
    end loop;
    if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                where t.tgname = 'same_teacher' and not t.tgisinternal
                  and p.oid <> coalesce(to_regprocedure('fv_private.same_teacher()')::oid, 0)) then
        raise exception 'A trigger named same_teacher already exists and runs another function. Nothing was changed.';
    end if;
end
$guard$;

-- 1. The teacher who owns one id of a kind, or null when it names no row.
-- Reads as its owner, so row security never hides another teacher's row.
create or replace function fv_private.teacher_of(p_kind text, p_id uuid)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _t uuid;
begin
    case p_kind
    when 'teacher' then
        return p_id;
    when 'course' then
        select c.teacher_id into _t from course c where c.id = p_id;
    when 'student' then
        select s.teacher_id into _t from student s where s.id = p_id;
    when 'enrollment' then
        select c.teacher_id into _t from enrollment x join course c on c.id = x.course_id where x.id = p_id;
    when 'assessment' then
        select c.teacher_id into _t from assessment x join course c on c.id = x.course_id where x.id = p_id;
    when 'rubric' then
        select c.teacher_id into _t from rubric x join course c on c.id = x.course_id where x.id = p_id;
    when 'category' then
        select c.teacher_id into _t from category x join course c on c.id = x.course_id where x.id = p_id;
    when 'module' then
        select c.teacher_id into _t from module x join course c on c.id = x.course_id where x.id = p_id;
    when 'subject' then
        select c.teacher_id into _t from subject x join course c on c.id = x.course_id where x.id = p_id;
    when 'competency_group' then
        select c.teacher_id into _t from competency_group x join course c on c.id = x.course_id where x.id = p_id;
    when 'section' then
        select c.teacher_id into _t from section x join course c on c.id = x.course_id where x.id = p_id;
    when 'custom_tag' then
        select c.teacher_id into _t from custom_tag x join course c on c.id = x.course_id where x.id = p_id;
    when 'observation' then
        select c.teacher_id into _t from observation x join course c on c.id = x.course_id where x.id = p_id;
    when 'questionnaire' then
        select c.teacher_id into _t from questionnaire x join course c on c.id = x.course_id where x.id = p_id;
    when 'phone_report' then
        select c.teacher_id into _t from phone_report x join course c on c.id = x.course_id where x.id = p_id;
    when 'report_issue' then
        select c.teacher_id into _t from report_issue x join course c on c.id = x.course_id where x.id = p_id;
    when 'submission' then
        select c.teacher_id into _t from submission x join course c on c.id = x.course_id where x.id = p_id;
    when 'revision_request' then
        select c.teacher_id into _t from revision_request x join course c on c.id = x.course_id where x.id = p_id;
    when 'criterion' then
        select c.teacher_id into _t
          from criterion x join rubric r on r.id = x.rubric_id join course c on c.id = r.course_id where x.id = p_id;
    when 'criterion_check' then
        select c.teacher_id into _t
          from criterion_check k join criterion x on x.id = k.criterion_id join rubric r on r.id = x.rubric_id
          join course c on c.id = r.course_id where k.id = p_id;
    when 'tag' then
        select c.teacher_id into _t
          from tag x join section s on s.id = x.section_id join course c on c.id = s.course_id where x.id = p_id;
    when 'observation_template' then
        select coalesce(x.teacher_id, c.teacher_id) into _t
          from observation_template x left join course c on c.id = x.course_id where x.id = p_id;
    when 'question' then
        select c.teacher_id into _t
          from question x join questionnaire n on n.id = x.questionnaire_id join course c on c.id = n.course_id where x.id = p_id;
    when 'response' then
        select c.teacher_id into _t
          from response x join questionnaire n on n.id = x.questionnaire_id join course c on c.id = n.course_id where x.id = p_id;
    when 'submission_file' then
        select c.teacher_id into _t
          from submission_file x join submission s on s.id = x.submission_id join course c on c.id = s.course_id where x.id = p_id;
    when 'term_rating' then
        select c.teacher_id into _t
          from term_rating x join enrollment e on e.id = x.enrollment_id join course c on c.id = e.course_id where x.id = p_id;
    when 'score' then
        select c.teacher_id into _t
          from score x join enrollment e on e.id = x.enrollment_id join course c on c.id = e.course_id where x.id = p_id;
    when 'student_card' then
        select c.teacher_id into _t
          from student_card x join enrollment e on e.id = x.enrollment_id join course c on c.id = e.course_id where x.id = p_id;
    when 'access_code' then
        select c.teacher_id into _t
          from student_access_code x join enrollment e on e.id = x.enrollment_id join course c on c.id = e.course_id where x.id = p_id;
    else
        raise exception 'fv_private.teacher_of: no kind %', p_kind using errcode = '22023';
    end case;
    return _t;
end;
$function$;

-- 2. The first column of a row that names a record of a teacher other than
-- the one its earlier columns name, or null. p_args are 'column:kind', the
-- row's parent first; a kind ending in [] is a list of ids.
create or replace function fv_private.same_teacher_problem(p_row jsonb, p_args text[])
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _arg     text;
    _col     text;
    _kind    text;
    _id      uuid;
    _who     uuid;
    _teacher uuid;
begin
    foreach _arg in array p_args loop
        _col := split_part(_arg, ':', 1);
        _kind := split_part(_arg, ':', 2);
        continue when _kind in ('assessment_copy_group', 'rubric_copy_group');
        for _id in
            select v::uuid
              from jsonb_array_elements_text(case jsonb_typeof(p_row -> _col)
                                                 when 'array' then p_row -> _col
                                                 when 'string' then jsonb_build_array(p_row -> _col)
                                                 else '[]'::jsonb end) v
        loop
            _who := fv_private.teacher_of(replace(_kind, '[]', ''), _id);
            continue when _who is null;
            if _teacher is null then
                _teacher := _who;
            elsif _who <> _teacher then
                return _col;
            end if;
        end loop;
    end loop;
    if _teacher is null then
        return null;
    end if;
    -- A copy group links one teacher's assessments (or rubrics) in several
    -- classes. Another teacher's group is not this row's to join.
    foreach _arg in array p_args loop
        _col := split_part(_arg, ':', 1);
        _kind := split_part(_arg, ':', 2);
        continue when (p_row ->> _col) is null;
        if _kind = 'assessment_copy_group'
           and exists (select 1 from assessment a join course c on c.id = a.course_id
                        where a.copy_group = (p_row ->> _col)::uuid and c.teacher_id <> _teacher) then
            return _col;
        end if;
        if _kind = 'rubric_copy_group'
           and exists (select 1 from rubric r join course c on c.id = r.course_id
                        where r.copy_group = (p_row ->> _col)::uuid and c.teacher_id <> _teacher) then
            return _col;
        end if;
    end loop;
    return null;
end;
$function$;

-- 3. The trigger. Its arguments are the table's 'column:kind' list.
create or replace function fv_private.same_teacher()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _new jsonb := to_jsonb(new);
    _old jsonb;
    _col text;
begin
    if tg_op = 'UPDATE' then
        _old := to_jsonb(old);
        if not exists (select 1 from unnest(tg_argv) a
                        where (_new -> split_part(a, ':', 1)) is distinct from (_old -> split_part(a, ':', 1))) then
            return new;
        end if;
    end if;
    _col := fv_private.same_teacher_problem(_new, tg_argv);
    if _col is not null then
        raise exception '%.% names a record of another teacher', tg_table_name, _col using errcode = '42501';
    end if;
    return new;
end;
$function$;

-- No client role may call them. The trigger runs them for every caller.
revoke all on function fv_private.teacher_of(text, uuid) from public, anon, authenticated, service_role;
revoke all on function fv_private.same_teacher_problem(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function fv_private.same_teacher() from public, anon, authenticated, service_role;

-- 4 and 5. The tables, each with the ids its rows name, the row's parent
-- first. Every existing row is checked before any trigger is made.
do $triggers$
declare
    _t    text;
    _args text[];
    _bad  bigint;
    _list constant jsonb := '[
        ["public.answer", ["response_id:response", "question_id:question"]],
        ["public.assessment", ["course_id:course", "rubric_id:rubric", "category_id:category", "copy_group:assessment_copy_group", "module_id:module"]],
        ["public.assessment_resource", ["course_id:course", "assessment_id:assessment"]],
        ["public.assessment_tag", ["assessment_id:assessment", "tag_id:tag"]],
        ["public.criterion_tag", ["criterion_id:criterion", "tag_id:tag"]],
        ["public.dibels_score", ["enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.enrollment", ["course_id:course", "student_id:student"]],
        ["public.feedback_reflection", ["course_id:course", "enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.goal", ["enrollment_id:enrollment", "section_id:section"]],
        ["public.grade_return", ["enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.markup", ["course_id:course", "file_id:submission_file", "enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.markup_kept", ["course_id:course", "submission_id:submission", "enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.observation", ["course_id:course", "assessment_id:assessment", "template_id:observation_template"]],
        ["public.observation_custom_tag", ["observation_id:observation", "custom_tag_id:custom_tag"]],
        ["public.observation_student", ["observation_id:observation", "enrollment_id:enrollment"]],
        ["public.observation_tag", ["observation_id:observation", "tag_id:tag"]],
        ["public.observation_template", ["teacher_id:teacher", "course_id:course"]],
        ["public.phone_report", ["course_id:course", "created_by:teacher"]],
        ["public.phone_report_student", ["report_id:phone_report", "enrollment_id:enrollment"]],
        ["public.questionnaire", ["course_id:course", "parent_id:questionnaire"]],
        ["public.reflection", ["enrollment_id:enrollment", "section_id:section"]],
        ["public.report_issue", ["course_id:course", "issued_by:teacher"]],
        ["public.report_issue_student", ["issue_id:report_issue", "enrollment_id:enrollment"]],
        ["public.response", ["enrollment_id:enrollment", "created_by:teacher", "questionnaire_id:questionnaire"]],
        ["public.revision_request", ["course_id:course", "enrollment_id:enrollment", "assessment_id:assessment", "created_by:teacher", "criterion_ids:criterion[]", "first_submission_id:submission"]],
        ["public.rubric", ["course_id:course", "copy_group:rubric_copy_group"]],
        ["public.rubric_check_score", ["enrollment_id:enrollment", "assessment_id:assessment", "check_id:criterion_check"]],
        ["public.rubric_print", ["enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.rubric_score", ["criterion_id:criterion", "enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.rubric_tag", ["rubric_id:rubric", "tag_id:tag"]],
        ["public.score", ["enrollment_id:enrollment", "assessment_id:assessment"]],
        ["public.score_audit", ["score_id:score", "changed_by:teacher"]],
        ["public.section", ["course_id:course", "competency_group_id:competency_group", "subject_id:subject"]],
        ["public.section_override", ["enrollment_id:enrollment", "section_id:section"]],
        ["public.student_access_code", ["enrollment_id:enrollment", "phone_report_id:phone_report", "questionnaire_id:questionnaire", "report_issue_id:report_issue"]],
        ["public.submission", ["course_id:course", "enrollment_id:enrollment", "assessment_id:assessment", "card_id:student_card", "request_id:revision_request", "target_id:submission"]],
        ["public.tag_score", ["enrollment_id:enrollment", "assessment_id:assessment", "tag_id:tag"]],
        ["public.teacher_preference", ["teacher_id:teacher", "active_course_id:course"]],
        ["public.term_rating_assessment", ["term_rating_id:term_rating", "assessment_id:assessment"]],
        ["public.term_rating_audit", ["term_rating_id:term_rating", "changed_by:teacher"]],
        ["public.term_rating_dimension", ["term_rating_id:term_rating", "section_id:section"]],
        ["public.term_rating_growth_area", ["term_rating_id:term_rating", "tag_id:tag"]],
        ["public.term_rating_observation", ["observation_id:observation", "term_rating_id:term_rating"]],
        ["public.term_rating_strength", ["term_rating_id:term_rating", "tag_id:tag"]],
        ["student_submit.device_session_enrollment", ["enrollment_id:enrollment", "card_id:student_card"]]
    ]';
    _e jsonb;
begin
    for _e in select * from jsonb_array_elements(_list) loop
        _t := _e ->> 0;
        _args := array(select jsonb_array_elements_text(_e -> 1));
        execute format('select count(*) from %s r where fv_private.same_teacher_problem(to_jsonb(r), $1) is not null', _t)
           into _bad using _args;
        if _bad > 0 then
            raise exception '% has % row(s) that name a record of another teacher. Run the audit query to see which columns. Nothing was changed.', _t, _bad;
        end if;
    end loop;
    for _e in select * from jsonb_array_elements(_list) loop
        _t := _e ->> 0;
        _args := array(select jsonb_array_elements_text(_e -> 1));
        execute format('create or replace trigger same_teacher before insert or update of %s on %s for each row execute function fv_private.same_teacher(%s)',
                       (select string_agg(quote_ident(split_part(a, ':', 1)), ', ') from unnest(_args) a),
                       _t,
                       (select string_agg(quote_literal(a), ', ') from unnest(_args) a));
    end loop;
end
$triggers$;

commit;
