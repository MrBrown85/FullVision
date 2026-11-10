-- SECURITY DEFINER functions name pg_temp last in their search_path
-- (2026-11-10). S0-M5.
--
-- ── What was wrong ──────────────────────────────────────────────────────────
-- A SECURITY DEFINER function runs with its owner's rights, not the
-- caller's, and the ownership helpers (fv_owns_course and the three like it)
-- are what every row-security policy asks "is this the caller's class?".
-- Each has a search_path, the list of schemas Postgres looks in for a table
-- named without one. Sixteen of them listed `public` (or nothing, or
-- pg_catalog) and did not list pg_temp, the caller's own temporary tables.
-- When pg_temp is not in the list, Postgres looks there FIRST, before public
-- and even before its own catalog.
--
-- So a signed-in teacher who could run SQL of their own could make a
-- temporary table called `course`, put one row in it that says another
-- teacher's class is theirs, and fv_owns_course would read that table and
-- answer yes. Row security then lets them read and change that class. An
-- independent reviewer showed it for fv_owns_course; the tests here show it
-- for all four helpers, for the two audit writers (a false line in another
-- teacher's change history) and for the idempotency helpers (a save's
-- "already done" answer read from, and written to, the caller's own table).
--
-- Who could use it: nobody through FullVision. The app's API (PostgREST)
-- runs the public RPCs and reads tables; it has no way to create a table or
-- run a statement. It needs a direct database connection as a signed-in
-- teacher, which no teacher has. It is closed now because these functions
-- decide who owns what.
--
-- ── What this file changes ──────────────────────────────────────────────────
-- One setting on each of sixteen functions: pg_temp is added to the end of
-- its search_path, so a temporary table is looked at last and can never
-- stand in for a real one. No function's code is replaced. Owner, grants,
-- SECURITY DEFINER, volatility, arguments and result all stay as they are
-- (ALTER FUNCTION ... SET changes one column of the function's row,
-- proconfig; migrations/local-test/search_path.py compares the rest).
--
--   search_path today: public           becomes: public, pg_temp
--     _fv_release_orphan_teacher_email()      _fv_teacher_sign_in_deleted()
--     _score_audit_diff(…)                    _term_rating_audit_field(…)
--     _touch_course_sync_cursor(…)            _touch_course_sync_cursor_from_trigger()
--     _touch_teacher_sync_cursor_from_trigger()
--     fv_idem_check(…)                        fv_idem_store(…)
--     fv_owns_assessment(…)                   fv_owns_course(…)
--     fv_owns_enrollment(…)                   fv_owns_term_rating(…)
--     fv_retention_cleanup()
--   search_path today: "" (empty)       becomes: pg_catalog, pg_temp
--     get_class_bundle(uuid, bigint)
--   search_path today: pg_catalog       becomes: pg_catalog, pg_temp
--     rls_auto_enable()
--
-- The two odd ones. get_class_bundle's list is empty, which reads as "trust
-- nothing" but still means pg_temp first: every table it names is written
-- public.<table>, so no temporary table could stand in for one, but the type
-- names in its body (jsonb, text) are looked up the same way, and a
-- temporary table called `jsonb` made the class load fail for that session.
-- With an empty list Postgres looks in pg_temp, then pg_catalog. Naming both,
-- in the other order, is the same list with the trap removed: nothing the
-- function names moves, since everything it uses is in pg_catalog or written
-- with its schema.
--
-- rls_auto_enable is Supabase's "turn row security on for every new table
-- in public": the function of the event trigger ensure_rls, which runs after
-- every CREATE TABLE. The repo has no migration for it; its live body was
-- read on 2026-11-10. It already names pg_catalog, and pg_temp goes after
-- it. Its one table is written pg_catalog.pg_class, and the functions it
-- calls (pg_event_trigger_ddl_commands, format) are never looked up in
-- pg_temp, so for a later migration that makes a table it does exactly what
-- it did (tested: CREATE TABLE, CREATE TABLE AS, SELECT INTO, a quoted name,
-- a partitioned table; in public, in another schema, temporary). What was
-- open is the two type names in its declarations, record and name, in the
-- session that makes the table: with a temporary table called `name`, a new
-- table in public was left WITHOUT row security while the function logged
-- that it had enabled it; with one called `record`, every CREATE TABLE in
-- that session failed. Only a session that can make tables in public could
-- be caught by the first, and FullVision's migrations make no temporary
-- table with either name. With pg_temp last, neither does anything.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing. No table, column, row, trigger or policy changes, and no class's
-- sync version moves. The browser sees no difference: every function
-- returns what it returned.
--
-- ── Order: AFTER S0-M4 (applied Nov 10) and AFTER Batch A; PR 989 either side ─
-- The order is: S0-M4 (2026111001, applied to gradebook-prod on 2026-11-10),
-- Batch A's four files (2026110901 to 2026110904), then this file.
-- S0-M4b (2026110905_grade_return_limits.sql, PR 989) goes on top of Batch A
-- and is expected before this file too. This file neither checks for S0-M4b
-- nor needs it: with S0-M4b applied before it or after it, both apply and
-- the functions end up the same (search_path.py runs both orders; so did the
-- independent reviewer).
--
-- pg_get_functiondef prints the SET search_path line, so all sixteen
-- fingerprints (md5 of pg_get_functiondef) change, though no body does.
--
--   If this had run before S0-M4: S0-M4 checked that get_class_bundle was
--     the definition it was written against (md5
--     119165287207814181c5875d81451147) before it patched it. This file
--     changes that md5, so S0-M4 would have stopped at its first check.
--   If this ran before Batch A: Batch A's four files would still apply (the
--     seven functions they check are not among these sixteen). But Batch A
--     was tested with these sixteen as they are today, and its test harness
--     compares fv_owns_course, fv_owns_enrollment and fv_owns_assessment
--     with migrations/local-test/live-function-md5.txt, which would no
--     longer be true.
--
-- So this file refuses to run, with nothing changed, until all four Batch A
-- files and S0-M4 are in: the one order that was tested. For S0-M4 it goes
-- by get_class_bundle's fingerprint: it must be the one S0-M4 left
-- (845b42513d1f556dc941a1cc11cf9567, length 22591, live since Nov 10); the
-- one before it (119165287207814181c5875d81451147) stops the file with a
-- message naming S0-M4, and any other stops it too. Its last step checks
-- that no SECURITY DEFINER function in public, student_submit or fv_private
-- is left without pg_temp last, Batch A's and S0-M4b's new ones included,
-- and undoes everything if one is.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/s0-m5-undo.sql puts each function's search_path back
-- (not a migration; tested by search_path.py). It reopens what this file
-- closes. S0-M4's undo script (local-test/s0-m4-undo.sql) checks
-- get_class_bundle's fingerprint, so once this file is applied it stops:
-- undo this one first, then S0-M4.
--
-- After the apply, four lines of migrations/local-test/live-function-md5.txt
-- are out of date (fv_owns_assessment, fv_owns_course, fv_owns_enrollment,
-- get_class_bundle), and so are the copies of these functions in
-- harness.sql, score-prelude.sql, term-rating-prelude.sql, bundle-prelude.sql
-- and search-path-prelude.sql. The PR that follows the apply updates them;
-- the new fingerprints are in "After the apply" below.
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- None on any table. Calls to these functions that are running carry on;
-- the next call uses the new setting. The only thing this can wait for is
-- another change to one of the same sixteen functions that has not
-- committed; it gives up after five seconds, with nothing changed.
--
-- ── Before the apply (read-only) ────────────────────────────────────────────
-- This lists every function that is NOT as it was tested (missing, not
-- SECURITY DEFINER, another setting, or another definition, which it
-- prints), and any other SECURITY DEFINER function without pg_temp. No rows:
-- everything is as tested.
--
-- It was run on gradebook-prod on 2026-11-10, after S0-M4 was applied and
-- before Batch A, and returned one row: rls_auto_enable, tested until then
-- from a stand-in. Its live body is now the one tested and the one
-- fingerprinted below, so all sixteen were the live definitions, byte for
-- byte, and no other SECURITY DEFINER function in the three schemas lacked
-- pg_temp. Batch A has been applied since (Nov 10) and the query now checks
-- owners too: run it again before applying. It should return nothing.
--
-- A row whose only difference is the md5 does not stop this file (it
-- replaces no body); it means that function has changed since it was
-- tested. The exception is get_class_bundle, which the file does check.
--
-- Owners. ALTER FUNCTION is refused unless the role applying the file owns
-- the function (or is a member of the role that does). On Supabase the SQL
-- editor and apply_migration both run as postgres, and the repo's own
-- migrations made fifteen of the sixteen, so those should be postgres's;
-- rls_auto_enable came with the Supabase project and is the one that might
-- not be. The query expects postgres as the owner of each and lists any
-- owned by another role (live_owner). If it lists one, do not apply. The
-- file would run its checks, reach that function's ALTER, and stop there
-- with "must be owner of function ..." and nothing changed (search_path.py
-- does this with a function owned by another role). The ways on from there
-- are for the owner to choose: apply the file as a role that owns all
-- sixteen; or have it rewritten without that function, which also means its
-- last check must excuse it.
--
-- precheck:
--   with v(fn, setting, md5, owner) as (values
--       ('public._fv_release_orphan_teacher_email()',                     'search_path=public',      '845a373f326ad7067193bf36960e3185', 'postgres'),
--       ('public._fv_teacher_sign_in_deleted()',                          'search_path=public',      'e303a42f8cd1f9a1859483a84f074cbe', 'postgres'),
--       ('public._score_audit_diff(uuid,numeric,numeric,text,text)',      'search_path=public',      '97b29bd4079fc3326b70b29f55bdeeda', 'postgres'),
--       ('public._term_rating_audit_field(uuid,text,text,text)',          'search_path=public',      'f29ec6599566b90f276ea8fb9e32a4b9', 'postgres'),
--       ('public._touch_course_sync_cursor(uuid,text)',                   'search_path=public',      'ddf717ce0125ec2c0ebb5a45ad0a6c03', 'postgres'),
--       ('public._touch_course_sync_cursor_from_trigger()',               'search_path=public',      '706bc29fddc40bf689d719d3883e7cd7', 'postgres'),
--       ('public._touch_teacher_sync_cursor_from_trigger()',              'search_path=public',      '388d425e8dddc9517759e98c8cc91f0c', 'postgres'),
--       ('public.fv_idem_check(uuid,text)',                               'search_path=public',      '83e3c5590eee5fcb5c2cd8690fe42aa7', 'postgres'),
--       ('public.fv_idem_store(uuid,text,jsonb)',                         'search_path=public',      'afcca752df1bae8350db6f636e4aaa09', 'postgres'),
--       ('public.fv_owns_assessment(uuid)',                               'search_path=public',      '852322ca22024d49dcc4f88a6863a4cf', 'postgres'),
--       ('public.fv_owns_course(uuid)',                                   'search_path=public',      '61fa41c6c4e94a1e27b606e454262baf', 'postgres'),
--       ('public.fv_owns_enrollment(uuid)',                               'search_path=public',      '9c1d01d07ad0e2402784a2257e13aecb', 'postgres'),
--       ('public.fv_owns_term_rating(uuid)',                              'search_path=public',      '1d3c31d45026472c3d3055a6b8718ea6', 'postgres'),
--       ('public.fv_retention_cleanup()',                                 'search_path=public',      '3133ad798bfe7c82d9d203abc3826a94', 'postgres'),
--       ('public.get_class_bundle(uuid,bigint)',                          'search_path=""',          '845b42513d1f556dc941a1cc11cf9567', 'postgres'),
--       ('public.rls_auto_enable()',                                      'search_path=pg_catalog',  '846ec2fbff751d24b890656d63c3a9bf', 'postgres')
--   )
--   select v.fn, v.setting as tested_setting, array_to_string(p.proconfig, '; ') as live_setting,
--          p.prosecdef as live_security_definer, v.md5 as tested_md5,
--          md5(pg_get_functiondef(p.oid)) as live_md5, v.owner as expected_owner,
--          p.proowner::regrole::text as live_owner, pg_get_functiondef(p.oid) as live_definition
--     from v left join pg_proc p on p.oid = to_regprocedure(v.fn)
--    where p.oid is null or not p.prosecdef or p.proconfig is distinct from array[v.setting]
--       or md5(pg_get_functiondef(p.oid)) <> v.md5
--       or p.proowner::regrole::text <> v.owner
--   union all
--   select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
--          'not one of the sixteen', array_to_string(p.proconfig, '; '), p.prosecdef, null,
--          md5(pg_get_functiondef(p.oid)), null, p.proowner::regrole::text, null
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
--      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')
--      and not exists (select 1 from v where to_regprocedure(v.fn) = p.oid);
-- end precheck
--
-- ── After the apply (read-only) ─────────────────────────────────────────────
-- The new setting and fingerprint of each, on PostgreSQL 17 (production's
-- version; 18 prints the same). This lists every function that is not as
-- expected; no rows means all sixteen are done and their fingerprints are
-- the ones to put in live-function-md5.txt.
--
-- postcheck:
--   select v.fn, v.setting as expected_setting, array_to_string(p.proconfig, '; ') as live_setting,
--          v.md5 as expected_md5, md5(pg_get_functiondef(p.oid)) as live_md5,
--          length(pg_get_functiondef(p.oid)) as live_length
--     from (values
--       ('public._fv_release_orphan_teacher_email()',                    'search_path=public, pg_temp',     'd1786f4b0205b700167758f4bb61e32e'),
--       ('public._fv_teacher_sign_in_deleted()',                         'search_path=public, pg_temp',     'f81c14dec41dcf6d95377905e08ed58d'),
--       ('public._score_audit_diff(uuid,numeric,numeric,text,text)',     'search_path=public, pg_temp',     '2f5d1bb44e726f189f029c3e955a84ea'),
--       ('public._term_rating_audit_field(uuid,text,text,text)',         'search_path=public, pg_temp',     '23b66de03546627aa5583ca093946147'),
--       ('public._touch_course_sync_cursor(uuid,text)',                  'search_path=public, pg_temp',     'b0b9eb6dbbe09e9edc5640cde262248d'),
--       ('public._touch_course_sync_cursor_from_trigger()',              'search_path=public, pg_temp',     '225aac90e5534c2826298d084e77991c'),
--       ('public._touch_teacher_sync_cursor_from_trigger()',             'search_path=public, pg_temp',     '01bc5ab445b01366dc915cd8ee57c1ec'),
--       ('public.fv_idem_check(uuid,text)',                              'search_path=public, pg_temp',     '1c7b546434bee4b774557e0e6b16024f'),
--       ('public.fv_idem_store(uuid,text,jsonb)',                        'search_path=public, pg_temp',     '6d0b48c458d273a332db39e1a4b68626'),
--       ('public.fv_owns_assessment(uuid)',                              'search_path=public, pg_temp',     '9f4c680c35f9f3ac32e8290824707673'),
--       ('public.fv_owns_course(uuid)',                                  'search_path=public, pg_temp',     'e3afeca06043a6e907e6f4ae777c85da'),
--       ('public.fv_owns_enrollment(uuid)',                              'search_path=public, pg_temp',     '728526648388367393162be706f7f9ea'),
--       ('public.fv_owns_term_rating(uuid)',                             'search_path=public, pg_temp',     '000876617e013acb95c56932b42d1f02'),
--       ('public.fv_retention_cleanup()',                                'search_path=public, pg_temp',     'a8da46d6664ba5956f4215ba3b2ada39'),
--       ('public.get_class_bundle(uuid,bigint)',                         'search_path=pg_catalog, pg_temp', '116294a41f043458e3ddec694520cf0d'),
--       ('public.rls_auto_enable()',                                     'search_path=pg_catalog, pg_temp', '37475132a56d7604318a225ce900ae7f')
--     ) as v(fn, setting, md5)
--     left join pg_proc p on p.oid = to_regprocedure(v.fn)
--    where p.oid is null or p.proconfig is distinct from array[v.setting]
--       or md5(pg_get_functiondef(p.oid)) <> v.md5;
-- end postcheck
--
-- Can be run again: a function that already has the new setting is set to
-- the same thing.
--
-- One transaction: the file opens with begin and ends with commit, so it is
-- all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first, before anything
-- is changed.
begin;

-- Give up after five seconds rather than wait behind another change to one
-- of these functions. If it gives up, nothing is applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f record;
    _p record;
    _bundle text;
begin
    -- Each function must exist with exactly these arguments, be SECURITY
    -- DEFINER, and have the search_path it had when this was written (read
    -- from gradebook-prod on 2026-11-10) or the new one (a second run).
    for _f in
        select * from (values
            ('public._fv_release_orphan_teacher_email()',                'search_path=public',     'search_path=public, pg_temp'),
            ('public._fv_teacher_sign_in_deleted()',                     'search_path=public',     'search_path=public, pg_temp'),
            ('public._score_audit_diff(uuid,numeric,numeric,text,text)', 'search_path=public',     'search_path=public, pg_temp'),
            ('public._term_rating_audit_field(uuid,text,text,text)',     'search_path=public',     'search_path=public, pg_temp'),
            ('public._touch_course_sync_cursor(uuid,text)',              'search_path=public',     'search_path=public, pg_temp'),
            ('public._touch_course_sync_cursor_from_trigger()',          'search_path=public',     'search_path=public, pg_temp'),
            ('public._touch_teacher_sync_cursor_from_trigger()',         'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_idem_check(uuid,text)',                          'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_idem_store(uuid,text,jsonb)',                    'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_owns_assessment(uuid)',                          'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_owns_course(uuid)',                              'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_owns_enrollment(uuid)',                          'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_owns_term_rating(uuid)',                         'search_path=public',     'search_path=public, pg_temp'),
            ('public.fv_retention_cleanup()',                            'search_path=public',     'search_path=public, pg_temp'),
            ('public.get_class_bundle(uuid,bigint)',                     'search_path=""',         'search_path=pg_catalog, pg_temp'),
            ('public.rls_auto_enable()',                                 'search_path=pg_catalog', 'search_path=pg_catalog, pg_temp')
        ) as v(fn, was, becomes)
    loop
        select p.prosecdef, p.proconfig into _p from pg_proc p where p.oid = to_regprocedure(_f.fn);
        if not found then
            raise exception '% does not exist with these arguments. Nothing was changed.', _f.fn;
        end if;
        if not _p.prosecdef then
            raise exception '% is not SECURITY DEFINER. Nothing was changed.', _f.fn;
        end if;
        if _p.proconfig is distinct from array[_f.was] and _p.proconfig is distinct from array[_f.becomes] then
            raise exception '% has the settings % (expected % or %). Nothing was changed.',
                _f.fn, coalesce(_p.proconfig::text, 'none'), _f.was, _f.becomes;
        end if;
    end loop;

    -- The order (header, "Order"): S0-M4, Batch A's four files, then this.
    if to_regprocedure('public.fv_owns_score_cell(uuid,uuid)') is null
       or to_regclass('public.grade_return') is null
       or to_regclass('public.student_card') is null
       or to_regclass('student_submit.device_session') is null then
        raise exception 'Batch A is not all applied (2026110901 to 2026110904): apply it, then this file. Nothing was changed.';
    end if;
    -- get_class_bundle must be the definition S0-M4 leaves (md5 of
    -- pg_get_functiondef on PostgreSQL 17, confirmed by PR 985's reviewer),
    -- or that one with this file's setting (a second run). The choice of
    -- pg_catalog, pg_temp for it was made by reading that body.
    _bundle := md5(pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure));
    if _bundle = '119165287207814181c5875d81451147'
       or position($s$'created_at', asm.created_at$s$ in pg_get_functiondef('public.get_class_bundle(uuid,bigint)'::regprocedure)) = 0 then
        raise exception 'S0-M4 is not applied (2026111001_assessment_created_at_in_bundle.sql): it checks get_class_bundle''s fingerprint, which this file changes. Apply it first. Nothing was changed.';
    end if;
    if _bundle not in ('845b42513d1f556dc941a1cc11cf9567', '116294a41f043458e3ddec694520cf0d') then
        raise exception 'public.get_class_bundle(uuid,bigint) is not the definition this file was written against (md5 %, expected 845b42513d1f556dc941a1cc11cf9567, as S0-M4 leaves it). Nothing was changed.', _bundle;
    end if;
end
$guard$;

-- ── The change: one setting on each of the sixteen ──────────────────────────
alter function public._fv_release_orphan_teacher_email()                    set search_path = public, pg_temp;
alter function public._fv_teacher_sign_in_deleted()                         set search_path = public, pg_temp;
alter function public._score_audit_diff(uuid, numeric, numeric, text, text) set search_path = public, pg_temp;
alter function public._term_rating_audit_field(uuid, text, text, text)      set search_path = public, pg_temp;
alter function public._touch_course_sync_cursor(uuid, text)                 set search_path = public, pg_temp;
alter function public._touch_course_sync_cursor_from_trigger()              set search_path = public, pg_temp;
alter function public._touch_teacher_sync_cursor_from_trigger()             set search_path = public, pg_temp;
alter function public.fv_idem_check(uuid, text)                             set search_path = public, pg_temp;
alter function public.fv_idem_store(uuid, text, jsonb)                      set search_path = public, pg_temp;
alter function public.fv_owns_assessment(uuid)                              set search_path = public, pg_temp;
alter function public.fv_owns_course(uuid)                                  set search_path = public, pg_temp;
alter function public.fv_owns_enrollment(uuid)                              set search_path = public, pg_temp;
alter function public.fv_owns_term_rating(uuid)                             set search_path = public, pg_temp;
alter function public.fv_retention_cleanup()                                set search_path = public, pg_temp;
alter function public.get_class_bundle(uuid, bigint)                        set search_path = pg_catalog, pg_temp;
alter function public.rls_auto_enable()                                     set search_path = pg_catalog, pg_temp;

-- ── Nothing is left behind ──────────────────────────────────────────────────
-- Every SECURITY DEFINER function in the app's three schemas must now end
-- its search_path with pg_temp: these sixteen, the ten in student_submit and
-- the ones Batch A adds. One that does not stops the file and undoes the
-- sixteen above.
do $check$
declare
    _left text;
begin
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'student_submit', 'fv_private')
       and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s
                        where s ~ '^search_path=(.*, )?pg_temp$');
    if _left is not null then
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. This file does not cover it. Nothing was changed.', _left;
    end if;
end
$check$;

commit;
