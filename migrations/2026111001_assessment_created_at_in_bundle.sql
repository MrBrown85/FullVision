-- The class bundle sends each assessment's created_at (2026-11-10). S0-M4.
--
-- What is needed: two pieces of work with the same date have to be put in
-- an order, for Most Recent and Decaying Average. The owner's ruling
-- (Nov 10): on the same date, "The one made later" counts as later. The
-- database has kept when each assessment was made since the start
-- (assessment.created_at, not null, default now()), but neither function
-- that sends a class's assessments to the browser sent it:
--   get_class_bundle(p_course_id, p_if_version)   the class load
--   get_gradebook(p_course_id)                    the read the browser falls
--                                                 back to where the bundle is
--                                                 missing or switched off
-- Both go through one converter in the browser (shared/data.js,
-- _v2GradebookToCache), which reads each assessment as an object with
-- snake_case keys. So both now send the same new key.
--
-- ── What it adds ────────────────────────────────────────────────────────────
-- One key on each assessment object, in both functions:
--     "created_at": "2026-11-10T16:04:11.482913+00:00"
-- the assessment's own created_at as jsonb prints a timestamptz: ISO 8601,
-- microseconds, with its offset. It is the same key and form the bundle
-- already uses for a module's and a rubric's created_at.
--   get_class_bundle   bundle.gradebook.assessments[n].created_at
--   get_gradebook      assessments[n].created_at
-- get_assessment_detail returns to_jsonb(assessment), so it has always
-- carried created_at. Not changed.
--
-- Both functions are patched in place from their live definitions: the
-- definition as it stands, plus the one key, and nothing else. Their
-- arguments, return type, owner, SECURITY DEFINER or INVOKER, search_path,
-- volatility and grants stay as they are (create or replace keeps them).
-- The bundle's own bundle_schema stays 3, as for every additive field before
-- this one.
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- Nothing. No table, column, row, trigger or policy changes, and no class's
-- sync version moves.
--
-- ── What a browser that already holds a class sees ──────────────────────────
-- The bundle is cached by the class's sync version: a browser that sends
-- the version it holds gets { not_modified: true } and keeps its copy. This
-- file does not move any version, so a browser holding a class from before
-- it goes on without created_at for that class until the class next
-- changes (any save to it moves the version and the next load brings the
-- whole bundle), or until its saved copy is 14 days unopened, or until the
-- browser's own copy number (_BUNDLE_SCHEMA in shared/data.js) is raised so
-- older copies are fetched again. The loader has to treat a missing
-- created_at as "not known" for that long. To make every browser fetch
-- every class again at once instead, the owner can run this after the file
-- (it is deliberately not in it, so the file changes no row):
--     update public.course_sync_cursor set version = version + 1;
--
-- ── The order the server sends assessments in ───────────────────────────────
-- Not changed: get_class_bundle sends them by display_order, created_at, id
-- and get_gradebook by display_order, created_at. The bundle's score rows
-- point into that list by position, and both are built in one call, so the
-- order matters only inside one response. Once the browser orders same-date
-- pieces by created_at itself, nothing depends on the order they arrive in.
--
-- ── Copies and restores: what created_at they get ───────────────────────────
--   duplicate_assessment, and Copy to another class   one new row, made now:
--       it is later than its original, as "made later" should have it.
--   duplicate_course (the RPC) and Duplicate Class in the desktop app
--       neither copies assessments (the RPC copies the learning map, modules
--       and rubrics; the app copies the learning map), so there is no order
--       to keep.
--   import_json_restore   NOT preserved. It inserts every assessment in one
--       transaction and does not name created_at, so every restored piece
--       gets the same instant (the restore's start). Same-date pieces in a
--       restored class then tie on created_at and fall to whatever the
--       browser breaks ties with. Not fixed here: the fix is for the restore
--       to take created_at from the backup when the backup has it, which
--       needs the browser's export to write it first; and import_json_restore
--       is also patched by Batch A (2026110902), so that patch has to be
--       written against Batch A's body and applied after it.
--
-- ── Order relative to Batch A (2026110901 to 2026110904) ────────────────────
-- Either order. Batch A patches update_course, move_rubric_scores,
-- duplicate_course, import_json_restore, _issue_access_code,
-- _issue_report_code and student_submit.open; this file patches
-- get_class_bundle and get_gradebook. Neither set guards a function the
-- other changes.
--
-- Can be run again: a function that already sends created_at is left alone.
--
-- One transaction: the file opens with begin and ends with commit, as
-- 20261027_score_comments.sql and 20261031_score_report_note.sql do, so it
-- is all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first, before anything
-- is changed.
begin;

-- Give up after five seconds rather than queue behind a long transaction and
-- hold every class load up behind this one. If it gives up, nothing is
-- applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _def text;
begin
    -- Each function must be the one this file was written against (md5 of
    -- pg_get_functiondef, both read from gradebook-prod: get_class_bundle on
    -- 2026-11-09, get_gradebook on 2026-11-10;
    -- migrations/local-test/live-function-md5.txt), or already carry the
    -- patch (a second run).
    for _f in
        select * from (values
            ('public.get_class_bundle(uuid,bigint)', '119165287207814181c5875d81451147', $s$'created_at', asm.created_at$s$),
            ('public.get_gradebook(uuid)',           '2876cd40c373b8a59bff4464008c8601', $s$'created_at', a.created_at$s$)
        ) as v(fn, was, mark)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        if position(_f.mark in _def) = 0 and md5(_def) <> _f.was then
            raise exception '% is not the definition this migration was written against (md5 %, expected %). Nothing was changed.',
                _f.fn, md5(_def), _f.was;
        end if;
    end loop;
end
$guard$;

do $patch$
declare
    _edits text[][] := array[
      -- function, a line only the patch adds, text to find (exactly once), replacement
      array['public.get_class_bundle(uuid,bigint)',
            $s$'created_at', asm.created_at$s$,
            $s$'core_competency_ids', to_jsonb(asm.core_competency_ids)$s$,
            $s$'core_competency_ids', to_jsonb(asm.core_competency_ids),
                       'created_at', asm.created_at$s$],
      array['public.get_gradebook(uuid)',
            $s$'created_at', a.created_at$s$,
            $s$'core_competency_ids', to_jsonb(a.core_competency_ids),$s$,
            $s$'core_competency_ids', to_jsonb(a.core_competency_ids),
               'created_at', a.created_at,$s$]
    ];
    _def  text;
    _hits int;
    i     int;
begin
    for i in 1 .. array_length(_edits, 1) loop
        _def := pg_get_functiondef(_edits[i][1]::regprocedure);
        continue when position(_edits[i][2] in _def) > 0;  -- a second run
        _hits := (length(_def) - length(replace(_def, _edits[i][3], ''))) / length(_edits[i][3]);
        if _hits <> 1 then
            raise exception '% has % matches for the assessment object''s last key, expected 1', _edits[i][1], _hits;
        end if;
        execute replace(_def, _edits[i][3], _edits[i][4]);
    end loop;
end
$patch$;

commit;
