-- Helpers for the security rule tests (tests/db/run.mjs). Loaded only into
-- a throwaway database that scripts/db-rebuild.mjs has just rebuilt.
-- Everything here lives in the schema rls_test. The tests leave that schema
-- out when they list the app's tables and functions, and only postgres can
-- use it.

create schema rls_test;
revoke all on schema rls_test from public;

-- Who owns a row: the teacher id behind a class, a student, an enrollment
-- and the rest. These run as postgres, so row security never hides a row.
create function rls_test.of_course(p uuid) returns uuid language sql stable
as $$ select teacher_id from public.course where id = p $$;
create function rls_test.of_student(p uuid) returns uuid language sql stable
as $$ select teacher_id from public.student where id = p $$;
create function rls_test.of_enrollment(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.enrollment where id = p $$;
create function rls_test.of_assessment(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.assessment where id = p $$;
create function rls_test.of_rubric(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.rubric where id = p $$;
create function rls_test.of_criterion(p uuid) returns uuid language sql stable
as $$ select rls_test.of_rubric(rubric_id) from public.criterion where id = p $$;
create function rls_test.of_section(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.section where id = p $$;
create function rls_test.of_tag(p uuid) returns uuid language sql stable
as $$ select rls_test.of_section(section_id) from public.tag where id = p $$;
create function rls_test.of_observation(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.observation where id = p $$;
create function rls_test.of_questionnaire(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.questionnaire where id = p $$;
create function rls_test.of_response(p uuid) returns uuid language sql stable
as $$ select rls_test.of_questionnaire(questionnaire_id) from public.response where id = p $$;
create function rls_test.of_term_rating(p uuid) returns uuid language sql stable
as $$ select rls_test.of_enrollment(enrollment_id) from public.term_rating where id = p $$;
create function rls_test.of_score(p uuid) returns uuid language sql stable
as $$ select rls_test.of_enrollment(enrollment_id) from public.score where id = p $$;
create function rls_test.of_submission(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.submission where id = p $$;
create function rls_test.of_phone_report(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.phone_report where id = p $$;
create function rls_test.of_report_issue(p uuid) returns uuid language sql stable
as $$ select rls_test.of_course(course_id) from public.report_issue where id = p $$;
create function rls_test.of_card(p uuid) returns uuid language sql stable
as $$ select rls_test.of_enrollment(enrollment_id) from public.student_card where id = p $$;
create function rls_test.of_access_code(p uuid) returns uuid language sql stable
as $$ select rls_test.of_enrollment(enrollment_id) from public.student_access_code where id = p $$;
create function rls_test.of_device_session(p uuid) returns uuid language sql stable
as $$ select min(rls_test.of_enrollment(enrollment_id)::text)::uuid
        from student_submit.device_session_enrollment where session_id = p $$;

-- Made by run.mjs from the owner of each table in tests/db/table-owners.mjs:
-- rls_test.prints(teacher) gives {table: md5 of that teacher's rows}, and
-- rls_test.marked(teacher) the tables where that teacher's rows hold teacher
-- B's mark, the word every text of B's starts with.

-- Runs each case in a savepoint and always rolls it back. A case is
-- {id, role, claims, sql, mode}. Mode 'rows' runs the sql for its row
-- count; 'value' for the one text value it gives. The answer says what came
-- back, or the error that refused it, and which tables' rows of teacher A
-- and of teacher B changed while it ran, and where A's rows took in B's words.
create function rls_test.attempt(p_cases jsonb, p_a uuid, p_b uuid) returns jsonb
language plpgsql
as $$
declare
    _out    jsonb := '[]';
    _c      jsonb;
    _val    text;
    _n      bigint;
    _state  text;
    _msg    text;
    _a0     jsonb := rls_test.prints(p_a);
    _b0     jsonb := rls_test.prints(p_b);
    _a1     jsonb;
    _b1     jsonb;
    _m0     jsonb := rls_test.marked(p_a);
    _m1     jsonb;
begin
    for _c in select * from jsonb_array_elements(p_cases) loop
        _val := null; _n := null; _state := null; _msg := null;
        begin
            begin
                perform set_config('statement_timeout', '20s', true);
                perform set_config('request.jwt.claims', coalesce(_c->>'claims', ''), true);
                perform set_config('role', _c->>'role', true);
                if _c->>'mode' = 'rows' then
                    execute _c->>'sql';
                    get diagnostics _n = row_count;
                else
                    execute _c->>'sql' into _val;
                end if;
            exception when others then
                get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            end;
            perform set_config('role', 'none', true);
            _a1 := rls_test.prints(p_a);
            _b1 := rls_test.prints(p_b);
            _m1 := rls_test.marked(p_a);
            raise exception 'roll back' using errcode = 'ZZRB1';
        exception when sqlstate 'ZZRB1' then
            null;
        end;
        _out := _out || jsonb_build_object(
            'id', _c->'id', 'state', _state, 'message', _msg, 'rows', _n, 'value', _val,
            'a_changed', (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(_a0 || _a1) k
                           where (_a0->k) is distinct from (_a1->k)),
            'b_changed', (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(_b0 || _b1) k
                           where (_b0->k) is distinct from (_b1->k)),
            'a_took_b', (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_array_elements_text(_m1) k
                          where not _m0 ? k));
    end loop;
    return _out;
end;
$$;
