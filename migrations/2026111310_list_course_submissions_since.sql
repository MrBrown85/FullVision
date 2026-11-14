-- A class's work list answers "not changed" in a few bytes (2026-11-13).
--
-- THIS FILE DELETES NOTHING AND CHANGES NO ROW, NO TABLE, NO POLICY AND NO
-- EXISTING FUNCTION. It adds one read-only function,
-- public.list_course_submissions_since, and its grants.
--
-- ── What was slow, and why ────────────────────────────────────────────
-- The teacher's screens read a class's work with list_course_submissions:
-- the settings, every submission handed in and every page's paths. For
-- History 12 on Nov 13, with 635 pieces of work and 1,297 pages in, the
-- answer was 1.1 MB. The browser asks again every 30 seconds while a page
-- that shows work is open, and every time the grader or the Work Wall
-- opens, and almost every time the answer is what it already holds. Each
-- read downloaded, parsed and compared the whole 1.1 MB (speed assessment,
-- docs/plans/speed-assessment.md, finding 9).
--
-- ── What this does ────────────────────────────────────────────────────
-- list_course_submissions_since(p_course_id, p_version):
--   - works out the same answer list_course_submissions gives, by calling
--     it, so who may read what is decided there and nowhere else (the
--     caller must be signed in and own the class; PT401 and P0002 are
--     raised by it as before);
--   - takes the md5 of that answer as its version;
--   - when p_version is that md5, answers
--       { "unchanged": true, "version": "<md5>" }
--     and nothing else;
--   - otherwise answers the whole list with "version" added.
-- The browser keeps the version beside the list and sends it with the next
-- read. A first read sends null and gets everything.
--
-- The version is taken from the answer itself, not from timestamps or
-- counts, so it cannot say "unchanged" for an answer that differs: a page
-- rotated, a setting changed, work deleted or an upload expiring all change
-- the answer and so its md5. jsonb prints its keys in one fixed order, so
-- the same answer always gives the same md5.
--
-- It is security invoker: it has no rights of its own and reads nothing
-- itself. The server does the same work as before (about 70 ms for History
-- 12); what is saved is the download, the parse and the comparison in the
-- browser.
--
-- Colin approved the idea on 2026-11-13 ("Yes, all four") on the condition
-- that the SQL is shown to him before it is applied (CLAUDE.md rule 1). It
-- was run first inside a transaction that was rolled back, shown to him with
-- what that run gave, and applied to gradebook-prod the same day on his word
-- ("Yes, apply it"). Checked live after: History 12 answers 1,158 KB on a
-- first read and 66 bytes on a read with its version; the whole answer is
-- the one list_course_submissions gives; anon cannot run it.
--
-- Undo: migrations/local-test/list-course-submissions-since-undo.sql.

create or replace function public.list_course_submissions_since(p_course_id uuid, p_version text default null)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
declare
    _all     jsonb := public.list_course_submissions(p_course_id);
    _version text  := md5(_all::text);
begin
    if p_version is not null and p_version = _version then
        return jsonb_build_object('unchanged', true, 'version', _version);
    end if;
    return _all || jsonb_build_object('version', _version);
end;
$function$;

comment on function public.list_course_submissions_since(uuid, text) is
    'list_course_submissions, or { unchanged, version } when p_version is the md5 of what it would answer.';

-- ── Who can run it ────────────────────────────────────────────────────
-- As list_course_submissions: signed-in teachers through the API, and the
-- service role. Never the signed-out role.
revoke all on function public.list_course_submissions_since(uuid, text) from public, anon;
grant execute on function public.list_course_submissions_since(uuid, text) to authenticated, service_role;
