-- Two database logins that can run only their own edge function's calls
-- (2026-11-24).
--
-- student-submit and teacher-cards reached the database over
-- SUPABASE_DB_URL, which signs in as the database's owner (ROADMAP 1.8): a
-- bug in either function, or a statement slipped into one, had every right
-- in the database. Each now gets its own login:
--
--   fv_student_submit  EXECUTE on the 42 student_submit functions
--                      student-submit calls, and nothing else
--   fv_teacher_cards   EXECUTE on issue_cards, slip_roster and issue_slips
--
-- Every one of those functions is SECURITY DEFINER (checked below), so it
-- runs with its owner's rights, as it does today. The logins get no table,
-- sequence or schema rights beyond USAGE on student_submit, and no other
-- FullVision function: public's functions are closed to PUBLIC
-- (20261013_revoke_anon_function_execute.sql), and student_submit's helpers
-- and the teacher's three are refused (checked on gradebook-prod inside a
-- transaction that rolled back).
--
-- What they still have is what every role has: the platform's grant of
-- the net schema (pg_net) to PUBLIC, made by supabase_admin, which this
-- project cannot revoke. Through it a login could send an outbound HTTP
-- request or read the request queue. anon and authenticated have the same;
-- it is far less than the owner's every right, which is what this replaces.
--
-- Neither login has a password, so neither can sign in until Colin sets
-- one, in the SQL editor, never in a file:
--
--     alter role fv_student_submit with password '<a long random password>';
--     alter role fv_teacher_cards with password '<another one>';
--
-- then saves each login's pooler connection string (Connect > Transaction
-- pooler, user fv_student_submit.novsfeqjhbleyyaztmlh) as the function
-- secrets STUDENT_SUBMIT_DB_URL and TEACHER_CARDS_DB_URL, and only then
-- deploys both functions. A function with no secret answers a server
-- error on every call (logged as NoDatabaseLogin); it does not fall back
-- to the owner.
--
-- A later migration that drops and re-creates one of these functions (a
-- new argument, say) must grant EXECUTE to its login again: CREATE OR
-- REPLACE keeps grants, DROP does not.
--
-- No data changes. Undo: deploy the functions from before this change
-- (they use SUPABASE_DB_URL), then drop owned by and drop role for both
-- logins.

begin;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'fv_student_submit') then
        create role fv_student_submit with login nosuperuser nocreatedb nocreaterole noinherit noreplication
            connection limit 20;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'fv_teacher_cards') then
        create role fv_teacher_cards with login nosuperuser nocreatedb nocreaterole noinherit noreplication
            connection limit 10;
    end if;
end $$;

grant usage on schema student_submit to fv_student_submit, fv_teacher_cards;

do $$
declare
    _student text[] := array[
        -- A slip's routes (slip-routes.ts and index.ts).
        'open', 'verify', 'check', 'submit',
        -- A card's routes (card-routes.ts).
        'card', 'verify_card', 'page', 'seen', 'done',
        -- Send Work, its removal worker and the timer's sweep (send-routes.ts).
        'work', 'unsend', 'send_start', 'send_paths', 'send_finish', 'replace', 'file_links', 'group_work',
        'group_file_links', 'removal_batch', 'removal_done',
        -- Feedback, revisions and Reflect (feedback-routes.ts, revision-routes.ts).
        'feedback', 'reflect', 'markup', 'reply', 'answer', 'answer_seen', 'revision_start', 'revision_finish',
        'revision_unsend',
        -- Reflections, handouts, bulletins and quizzes (forms-, handout-, bulletin-, quiz-routes.ts).
        'forms', 'form', 'report', 'handout_links', 'handout_file', 'bulletins', 'bulletin_seen', 'bulletin_react',
        'bulletin_file_links', 'quiz_list', 'quiz', 'quiz_save', 'quiz_send'];
    _teacher text[] := array['issue_cards', 'slip_roster', 'issue_slips'];
    _f regprocedure;
    _n int;
begin
    -- Each name is one function, and each runs as its owner.
    select count(*) into _n from pg_proc
     where pronamespace = 'student_submit'::regnamespace and proname = any(_student || _teacher);
    if _n <> cardinality(_student) + cardinality(_teacher) then
        raise exception 'expected % student_submit functions, found %', cardinality(_student) + cardinality(_teacher), _n;
    end if;
    if exists (select 1 from pg_proc
                where pronamespace = 'student_submit'::regnamespace and proname = any(_student || _teacher)
                  and not prosecdef) then
        raise exception 'a function an edge function calls is not security definer';
    end if;

    for _f in select oid::regprocedure from pg_proc
               where pronamespace = 'student_submit'::regnamespace and proname = any(_student) loop
        execute format('grant execute on function %s to fv_student_submit', _f);
    end loop;
    for _f in select oid::regprocedure from pg_proc
               where pronamespace = 'student_submit'::regnamespace and proname = any(_teacher) loop
        execute format('grant execute on function %s to fv_teacher_cards', _f);
    end loop;
end $$;

commit;
