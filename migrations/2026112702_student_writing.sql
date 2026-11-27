-- Write Your Work: students' typed work (2026-11-27). NOT APPLIED. Needs Colin's OK before it is applied.
-- A student types or pastes their work on the student page's Send Work, as formatted text, and sends it as the
-- work itself, with or without photos. A draft is kept on the server as they type, follows them to another
-- device and is never shown to the teacher. The teacher pins comments to passages; the student sees them
-- when the work is returned, as Mark Up is seen. The plan is docs/plans/student-writing-plan.md; the six
-- decisions are DECISIONS.md, "Students' typed work (2026-11-27)".
--
-- == The writing's rule (one function, used by every writer and by the tables' checks) ==
-- Writing is a small JSON document, never HTML: {v: 1, blocks: [...]}, at most 5,000 blocks.
--   {t: p | h1 | h2, c: runs}              a paragraph, a heading, a smaller heading
--   {t: ul | ol, items: [{c: runs, lvl?}]} a bulleted or numbered list, 1 to 1,000 items, lvl 0 to 3
--   {t: table, rows: [[{c: runs}]]}        1 to 100 rows of 1 to 20 cells, every row as long as the first
--   a run: {x: text, b?: true, i?: true, u?: true, a?: address}. x is 1 to 60,000 characters with no control
--   character (a tab or line break is the blocks' to make); b, i and u are bold, italic and underline;
--   a is a link's address (http://, https:// or mailto:, up to 2,000 characters, no space), shown as text.
-- Its plain text is each line's runs joined, lines joined by a line break (chr(10)); a list item and a
-- table row are a line each, a row's cells joined by a tab (chr(9)). The 60,000-character limit counts that
-- plain text, in characters (code points, as length() counts them), line breaks included. A pinned
-- comment's start and end count characters of the same plain text. Anything else stops the call with 22023
-- and a plain message: the edge function cleans a paste to this rule first, so 22023 is its bug.
--
-- == What it adds ==
--   Three tables, row security on and no policy, no grant to anon, authenticated or service_role (as
--   submission, submission_file and markup): the only way in is the functions below, which check the
--   student's session or the teacher's class (fv_owns_course).
--   public.writing_draft         one per student and piece: the draft (body, plain, chars, rev, saved_at).
--                                Bound to the class by (enrollment_id, course_id) and (assessment_id,
--                                course_id), both on delete cascade. No teacher function reads it.
--   public.submission_writing    one per submission: the writing sent (body, plain, chars, the draft rev it
--                                was sent from). Cascades with its submission.
--   public.writing_comments      one per submission with writing: the teacher's pinned comments, kept as
--                                Mark Up keeps marks (working, working_rev; given, given_rev, given_at at
--                                Return). Cascades with its writing.
--   The rule: public._writing_runs(jsonb), public._writing_plain(jsonb), public._writing_comment_list(jsonb,
--   integer). Helpers no role may call: public._writing_take, _writing_attach, _writing_draft_done,
--   _writing_back_to_draft, _work_check_send_files.
--   For the student page (service_role only, each starting with the session check):
--     student_submit.writing(token, enrollment, assessment, ip)   the draft, the writing sent (each version,
--         newest first) and, once returned, the comments given (same rule as Mark Up: Students See Mark Up
--         on, not Missing or Excused). Reads only.
--     student_submit.writing_save(token, enrollment, assessment, body, base_rev, ip)   saves the draft if
--         base_rev is the draft's rev (0: no draft yet); a repeat of the save that made rev base_rev + 1 is
--         answered as saved; otherwise "changed" with the draft as it is. A null body deletes the draft.
--         Over 60,000 characters (or 600,000 bytes) is "too_long", nothing saved. 900 saves an hour a card
--         (write_log kind 'writing'). Takes no class lock, so autosave never waits for grading.
--     student_submit.writing_start(token, enrollment, assessment, intent, pages, draft_rev, note,
--         followed_plan, request_id, ip)   a send with writing: intent new, replace or revision, through
--         the same functions photos go through. The draft must be at draft_rev and not empty. With no
--         pages it is handed in at once (send_finish or revision_finish, in the same call); with pages, the
--         photos upload and the phone finishes as today. Idempotent through request_id, as every send.
--   For the teacher (authenticated and service_role, as save_markup):
--     public.get_submission_writing(submission)   the writing and its working comments, for the class's
--         teacher only (P0002 otherwise).
--     public.save_writing_comments(submission, comments, base_rev, idempotency_key)   replaces the list, as
--         save_markup does: a stale base_rev is "changed" and nothing saved; a used key replays
--         (fv_idem_check / fv_idem_store); in a class that returns at once the comments are given now.
--
-- == What it changes that exists ==
-- Each patched from its live definition by exact edits (each found once), behind its live md5
-- (migrations/baseline/function-md5.txt, refreshed after 2026112701). A function with no writing in play
-- behaves exactly as before: every edit is reached only when writing exists or p_draft_rev is given.
--   student_submit._send_begin     gains p_draft_rev (last, default null; the eight-argument one is dropped
--                                  so send_start and replace, which call it with eight, reach this one).
--                                  With p_draft_rev: an empty page list is allowed (1 to 30 still when there
--                                  are pages), the draft is checked and locked, and copied to the new send.
--   student_submit.revision_start  the same, as Send My Revision (p_draft_rev last, default null; the seven-
--                                  argument one is dropped; the released edge function's seven-argument
--                                  call reaches the new one; service_role keeps execute).
--   student_submit.send_finish     no files is a finish only for a send that carries writing; when handed
--   student_submit.revision_finish in, the draft it came from is deleted (a newer draft is kept).
--   student_submit.unsend          the writing goes back to the student's draft (a newer draft is kept);
--   student_submit.revision_unsend where the teacher's pages keep the work, the writing leaves it.
--   public.delete_submission       the teacher's Delete: the student's writing goes back to their draft.
--   public.finish_work_upload      the teacher's Replace Them: the same.
--   public._markup_give            comments on writing are given with the marks, at every Return path.
--   public._markup_on_release      and when the class stops holding grades until Return.
--   student_submit._grading_started  a comment pinned to the writing counts, as a mark does: no Replace or
--                                  Unsend after it.
--   public._submission_json        "writing": {chars, start (the first 280 characters)} or null.
--   student_submit.work            "writing" (chars or null) on each piece's sent work; "draft" ({rev,
--                                  chars, saved_at} or null) on each piece.
--   student_submit.write_log       write_log_kind_check gains 'writing' (dropped and added in one statement).
-- Not changed: students_send keeps its three values (any piece that takes work takes writing); send_start,
-- replace, send_paths, the photo checks and limits, Keep Photos Until (it removes photos, never writing).
--
-- == What it does to existing rows ==
-- None. The tables start empty. write_log's check is rebuilt over its rows (kept a day; every kind it holds
-- is still allowed).
--
-- == What applying it accepts ==
-- Nothing changes for anyone until an edge function and an app that call the new functions are deployed
-- and released. After that: writing is kept as text in the database, in Canada, as every grade is; a draft
-- stays on the server until it is sent, deleted by the student, or its class, piece or student is deleted.
-- Removing sent work in any way but the student's own new send puts its writing back as their draft.
-- The undo's PART 0 stops every writing call and leaves the rest as it is; its full removal refuses while
-- any writing, draft or comment is kept.
--
-- == The checks it makes first ==
-- It stops with nothing changed unless: the server is PostgreSQL 17; the running role owns submission and
-- write_log; every function it relies on or patches is the one it was tested against, or (a second run) as
-- this file leaves it; the new functions and tables are absent or as this file makes them; write_log's check
-- is the one 2026111806 left (or this file's). Its last step checks everything came out as written, grants,
-- row security and checks included.
--
-- == What it does not depend on ==
-- Collation, locale, time zone, search path and the applying role: text is matched under collate "C", texts
-- are compared byte for byte, the file sets its own search path and each function pins its own, the owner
-- is checked, grants are set and read explicitly. Lengths count characters (the database is UTF-8). No
-- backslash and no non-ASCII character is in the file.
--
-- == Locks ==
-- First, share row exclusive on enrollment, assessment and submission, then access exclusive on write_log,
-- in that order, held to commit, for a moment. A save or send in flight is waited for up to five seconds;
-- past that the file stops with "lock timeout" and nothing applied: run it again. One transaction.
--
-- == How to apply ==
-- Only on Colin's OK. Tested on a throwaway PostgreSQL 17, ICU en-US and C (local-test/README.md,
-- "Students' typed work").
--   0. local-test/student-writing-live-fingerprints.sql, read-only. Expected: no rows.
--   1. local-test/student-writing-live-precheck.sql, read-only. Expected: only the count rows.
--   2. This whole file as one migration named student_writing.
--   3. local-test/student-writing-live-postcheck.sql. Every row ok.
--   4. docs/schema.generated.sql and migrations/baseline/ refreshed from live, then types/database.d.ts.
-- Undo: local-test/student-writing-undo.sql. PART 0 alone is the stop that deletes nothing.
begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

lock table public.enrollment, public.assessment, public.submission in share row exclusive mode;
lock table student_submit.write_log in access exclusive mode;

do $guard$
declare
    _f    record;
    _md5  text;
    _me   oid := (select oid from pg_roles where rolname = current_user);
begin
    if current_setting('server_version_num')::int / 10000 <> 17 then
        raise exception 'This file was tested on PostgreSQL 17 only (this is %). Nothing was changed.', current_setting('server_version');
    end if;
    if (select relowner from pg_class where oid = to_regclass('public.submission')) is distinct from _me
       or (select relowner from pg_class where oid = to_regclass('student_submit.write_log')) is distinct from _me then
        raise exception 'Run this as the owner of public.submission and student_submit.write_log (% is not). Nothing was changed.', current_user;
    end if;
    -- What the new code calls or relies on, as live has it.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied
            ('public.fv_owns_course(uuid)', 'e3afeca06043a6e907e6f4ae777c85da'),
            ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f'),
            ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626'),
            ('public._grade_return_lock_first(uuid)', '4d85813e08aaeb108cda95d85f3d66e4'),
            ('public._grade_return_holds(uuid)', '51d6525109333424405e826bbc303b90'),
            ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
            ('public._work_check_pages(jsonb)', '8269b2b9c84377619778ca9154f39652'),
            ('public._work_check_files(jsonb)', 'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
            ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
            ('public._work_settle_files(uuid,jsonb)', '215b8fe4cc3eada5c45e8c86c847ef19'),
            ('public._work_files_state(uuid,jsonb)', '8fe968ca61404cfb4c8706d722c9c9a8'),
            ('student_submit._send_session(text,uuid)', 'c39242f54850eeeada19945ac8123644'),
            ('student_submit._session_class(text,uuid)', '1ae94981ff32f804d12079a24bd7b41a'),
            ('student_submit._write_limit(uuid,text,integer)', 'c2edfa96402a2eb7a839db3c106e11a9'),
            ('student_submit._work_window(uuid)', '904f6388c7f2b65bfb9f093f343100e4'),
            ('student_submit._listed(public.assessment,date)', 'ee5745a778e8ac1cb56f013d1c3e034e'),
            ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)', 'e1ccea79acc7dedcbbe10da2a4548643'),
            ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)', '1dad4dba0d66dcd87820b72485ecb28c')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was tested against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- Patched in place: as live has them, or as this file leaves them (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN replaces
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', '340cb72444d555a9cef594b543e2674c', 'f9a5a0b8a32f4f4d11e8a0715472db6a'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'a04e2d62a76b00a7f6ad03a76a0ede74', 'c318d2887499162bb1e8fe708f3ed923'),
            ('student_submit.unsend(text,uuid,uuid,text)', '68665f35e1678f1bba64d30c082409d8', '697fc569e89c9ec421c00e349fdd853d'),
            ('student_submit.revision_unsend(text,uuid,uuid,text)', '73ac162e56dde98d11ffcd03aa4b5ffa', '2f462712bd33bba734fd4419652c8b9f'),
            ('public.delete_submission(uuid,uuid)', 'c1f98e77a7fb756e75af4334d520f5fc', '534dc8ee7e2448695f6254f5fe3843b7'),
            ('public.finish_work_upload(uuid,jsonb,uuid)', 'c8c5c26be1758ec2e07fe73a68731159', '005384268d5a0be403bdcd52c31b2ad0'),
            ('public._markup_give(uuid,uuid)', 'f0f07a1b879ff038e2f0afe020233c29', '68ed4bdfa5ca39324217788ff02169a4'),
            ('public._markup_on_release()', 'a7e8838702d000c42621d72bf8621dfb', '747a6a625b7be23c096619eb37226739'),
            ('student_submit._grading_started(uuid,uuid)', '586a6a0b5910e6c153b72e73a5b672bc', '059a3ce924808dc33421cee5912b0066'),
            ('public._submission_json(uuid)', 'a1933b27974307aeae814ce98714c18f', 'fe00bc0b12796163e57c273831213cae'),
            ('student_submit.work(text,uuid,text)', '9e237f6e19649807b64aa6dc870de3f3', '2f8c6e8f284e051320620700bc6b054d')
            -- FINGERPRINTS-END
        ) as v(fn, before, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.before and _md5 <> _f.becomes then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.before;
        end if;
    end loop;
    -- Given a new last argument: the old one as live has it, or gone (a second run).
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN dropped
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '6cad6dd40eb1c33451a5dcf4f60e7624'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84')
            -- FINGERPRINTS-END
        ) as v(fn, md5)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.md5 then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.md5;
        end if;
    end loop;
    -- New: absent, or as this file leaves them.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN new
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)', '3fb68d3590a8d265c9343d3743589131'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)', 'a489d7771345b6a75c43cd038733b715'),
            ('public._writing_runs(jsonb)', '04fc22dfbf4abd15a9cd0fb4d0ff2d2d'),
            ('public._writing_plain(jsonb)', 'a3879b9da077187277c9b3a882f6ebab'),
            ('public._writing_comment_list(jsonb,integer)', '4733d9b3998516b26cc80ccdefe56ccf'),
            ('public._writing_take(uuid,uuid,integer)', '74750ed12de507435b19994a9b451706'),
            ('public._writing_attach(uuid,integer)', '82813807957f5922afcb2f6e306de555'),
            ('public._writing_draft_done(uuid)', '3b84964b5ebce61c75bd215821df5bdf'),
            ('public._writing_back_to_draft(uuid)', 'c555af37199c7cd50d72f73a6e57f777'),
            ('public._work_check_send_files(uuid,jsonb)', '69c4c4be2414afec4c99b428846a2cf3'),
            ('student_submit.writing(text,uuid,uuid,text)', 'ded44bf06f5ca15e344c07cfa1a316a1'),
            ('student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)', 'be98cfa8f342ffb87d3453ca39d6bd6c'),
            ('student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)', '49e18446699e681a1cf843e348bd89ac'),
            ('public.get_submission_writing(uuid)', '0c6a5dcb8c91f786c6bccfffbe2822ac'),
            ('public.save_writing_comments(uuid,jsonb,integer,uuid)', 'cbfcd69bc677cf0ee1b3f41b0281da4b')
            -- FINGERPRINTS-END
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> 'absent' and _md5 <> _f.becomes then
            raise exception '% already exists and is not as this file leaves it (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if (to_regprocedure('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)') is null)
       = (to_regprocedure('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)') is null)
       or (to_regprocedure('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)') is null)
       = (to_regprocedure('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)') is null) then
        raise exception '_send_begin or revision_start is in neither or both of its forms. Nothing was changed.';
    end if;
    -- No other function with a new name, and no other _send_begin or revision_start.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where (n.nspname, p.proname) in (('student_submit', '_send_begin'), ('student_submit', 'revision_start'),
                          ('student_submit', 'writing'), ('student_submit', 'writing_save'), ('student_submit', 'writing_start'),
                          ('public', '_writing_runs'), ('public', '_writing_plain'), ('public', '_writing_comment_list'),
                          ('public', '_writing_take'), ('public', '_writing_attach'), ('public', '_writing_draft_done'),
                          ('public', '_writing_back_to_draft'), ('public', '_work_check_send_files'),
                          ('public', 'get_submission_writing'), ('public', 'save_writing_comments'))
                  and p.oid not in (select coalesce(to_regprocedure(s)::oid, 0) from unnest(array[
                      'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
                      'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)',
                      'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
                      'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)',
                      'student_submit.writing(text,uuid,uuid,text)',
                      'student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)',
                      'student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)',
                      'public._writing_runs(jsonb)', 'public._writing_plain(jsonb)', 'public._writing_comment_list(jsonb,integer)',
                      'public._writing_take(uuid,uuid,integer)', 'public._writing_attach(uuid,integer)',
                      'public._writing_draft_done(uuid)', 'public._writing_back_to_draft(uuid)',
                      'public._work_check_send_files(uuid,jsonb)', 'public.get_submission_writing(uuid)',
                      'public.save_writing_comments(uuid,jsonb,integer,uuid)']) s)) then
        raise exception 'a function with one of this file''s names and other arguments is there. Nothing was changed.';
    end if;
    -- The three tables: absent, or this file's (all three or none).
    if (select count(*) from unnest(array['public.writing_draft', 'public.submission_writing', 'public.writing_comments']) t
         where to_regclass(t) is not null) not in (0, 3) then
        raise exception 'some of writing_draft, submission_writing and writing_comments are there and some are not. Nothing was changed.';
    end if;
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       not in ('CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text])))',
               'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text, ''writing''::text])))') then
        raise exception 'student_submit.write_log_kind_check is not the one 2026111806 left. Nothing was changed.';
    end if;
end
$guard$;

-- == 1. write_log takes the draft saves ==
do $kind$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'student_submit.write_log'::regclass
                    and conname = 'write_log_kind_check' and pg_get_constraintdef(oid) like '%''writing''%') then
        alter table student_submit.write_log
            drop constraint write_log_kind_check,
            add constraint write_log_kind_check
                check (kind = any (array['reflect'::text, 'seen'::text, 'finish'::text, 'answer'::text, 'bulletin'::text, 'quiz'::text, 'writing'::text]));
    end if;
end
$kind$;

-- == 2. The writing's rule ==
create or replace function public._writing_runs(p_runs jsonb)
 returns text
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
-- One line's runs, checked, as plain text (the header's rule). Stops with 22023 on anything else.
begin
    if jsonb_typeof(p_runs) is distinct from 'array' or jsonb_array_length(p_runs) > 2000 then
        raise exception 'a line''s runs must be a list of at most 2000' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_runs) r
                where jsonb_typeof(r) <> 'object'
                   or jsonb_typeof(r->'x') is distinct from 'string'
                   or exists (select 1 from jsonb_object_keys(r) k where k collate "C" not in ('x', 'b', 'i', 'u', 'a'))
                   or (r ? 'b' and r->'b' <> 'true'::jsonb)
                   or (r ? 'i' and r->'i' <> 'true'::jsonb)
                   or (r ? 'u' and r->'u' <> 'true'::jsonb)
                   or (r ? 'a' and jsonb_typeof(r->'a') <> 'string')) then
        raise exception 'a run must be {x, b, i, u, a} with x a text and b, i and u true' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_runs) r
                where length(r->>'x') not between 1 and 60000
                   or (r->>'x') collate "C" ~ '[[:cntrl:]]') then
        raise exception 'a run''s text must be 1 to 60000 characters with no tab, line break or other control character' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_runs) r
                where r ? 'a'
                  and (length(r->>'a') not between 1 and 2000
                       or not ((r->>'a') collate "C" ~ '^(https?://|mailto:)[^[:space:][:cntrl:]]+$'))) then
        raise exception 'a link''s address must start http://, https:// or mailto:, with no space, at most 2000 characters' using errcode = '22023';
    end if;
    return coalesce((select string_agg(t.r->>'x', '' order by t.n) from jsonb_array_elements(p_runs) with ordinality as t(r, n)), '');
end;
$function$;

create or replace function public._writing_plain(p_body jsonb)
 returns text
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
-- The writing's rule (the header's), and its plain text: what the 60,000 counts and what a pinned comment's
-- start and end count in. Stops with 22023 and a plain message on anything else.
declare
    _b     jsonb;
    _x     jsonb;
    _t     text;
    _width int;
    _lines text[] := '{}';
begin
    if jsonb_typeof(p_body) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(p_body) k where k collate "C" not in ('v', 'blocks'))
       or p_body->'v' is distinct from '1'::jsonb
       or jsonb_typeof(p_body->'blocks') is distinct from 'array'
       or jsonb_array_length(p_body->'blocks') > 5000 then
        raise exception 'writing must be {v: 1, blocks: a list of at most 5000}' using errcode = '22023';
    end if;
    for _b in select t.x from jsonb_array_elements(p_body->'blocks') with ordinality as t(x, n) order by t.n loop
        _t := case when jsonb_typeof(_b) = 'object' and jsonb_typeof(_b->'t') = 'string' then _b->>'t' end;
        if _t collate "C" in ('p', 'h1', 'h2') then
            if exists (select 1 from jsonb_object_keys(_b) k where k collate "C" not in ('t', 'c')) then
                raise exception 'a paragraph or heading is {t, c}' using errcode = '22023';
            end if;
            _lines := _lines || public._writing_runs(_b->'c');
        elsif _t collate "C" in ('ul', 'ol') then
            if exists (select 1 from jsonb_object_keys(_b) k where k collate "C" not in ('t', 'items'))
               or jsonb_typeof(_b->'items') is distinct from 'array'
               or jsonb_array_length(_b->'items') not between 1 and 1000 then
                raise exception 'a list is {t, items} with 1 to 1000 items' using errcode = '22023';
            end if;
            for _x in select t.x from jsonb_array_elements(_b->'items') with ordinality as t(x, n) order by t.n loop
                if jsonb_typeof(_x) is distinct from 'object'
                   or exists (select 1 from jsonb_object_keys(_x) k where k collate "C" not in ('c', 'lvl'))
                   or (_x ? 'lvl' and (jsonb_typeof(_x->'lvl') <> 'number' or (_x->>'lvl') collate "C" not in ('0', '1', '2', '3'))) then
                    raise exception 'a list item is {c, lvl} with lvl 0 to 3' using errcode = '22023';
                end if;
                _lines := _lines || public._writing_runs(_x->'c');
            end loop;
        elsif _t collate "C" = 'table' then
            if exists (select 1 from jsonb_object_keys(_b) k where k collate "C" not in ('t', 'rows'))
               or jsonb_typeof(_b->'rows') is distinct from 'array'
               or jsonb_array_length(_b->'rows') not between 1 and 100 then
                raise exception 'a table is {t, rows} with 1 to 100 rows' using errcode = '22023';
            end if;
            _width := null;
            for _x in select t.x from jsonb_array_elements(_b->'rows') with ordinality as t(x, n) order by t.n loop
                if jsonb_typeof(_x) is distinct from 'array' or jsonb_array_length(_x) not between 1 and 20
                   or jsonb_array_length(_x) <> coalesce(_width, jsonb_array_length(_x)) then
                    raise exception 'a table row is a list of 1 to 20 cells, as many as the first row' using errcode = '22023';
                end if;
                _width := jsonb_array_length(_x);
                if exists (select 1 from jsonb_array_elements(_x) c
                            where jsonb_typeof(c) <> 'object'
                               or exists (select 1 from jsonb_object_keys(c) k where k collate "C" <> 'c')) then
                    raise exception 'a table cell is {c}' using errcode = '22023';
                end if;
                _lines := _lines || (select string_agg(public._writing_runs(t.c->'c'), chr(9) order by t.n)
                                       from jsonb_array_elements(_x) with ordinality as t(c, n));
            end loop;
        else
            raise exception 'a block is a paragraph (p), a heading (h1, h2), a list (ul, ol) or a table' using errcode = '22023';
        end if;
    end loop;
    return array_to_string(_lines, chr(10));
end;
$function$;

create or replace function public._writing_comment_list(p_comments jsonb, p_chars integer)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
-- The teacher's pinned comments on one piece of writing, as they are to be stored: a list of at most 300
-- {id, start, end, text}; id 1 to 64 characters, once each; start and end whole numbers with
-- 0 <= start < end <= p_chars (the writing's plain text, in characters); text trimmed of spaces, tabs and
-- line breaks at its ends, then 1 to 1000 characters. Sorted by start, then end, then id. Stops with 22023.
declare
    _c    jsonb;
    _s    int;
    _e    int;
    _t    text;
    _ids  text[] := '{}';
    _out  jsonb := '[]'::jsonb;
    _trim text := chr(32) || chr(9) || chr(10) || chr(13);
begin
    if jsonb_typeof(p_comments) is distinct from 'array' or jsonb_array_length(p_comments) > 300 then
        raise exception 'comments must be a list of at most 300' using errcode = '22023';
    end if;
    for _c in select t.x from jsonb_array_elements(p_comments) with ordinality as t(x, n) order by t.n loop
        if jsonb_typeof(_c) is distinct from 'object'
           or exists (select 1 from jsonb_object_keys(_c) k where k collate "C" not in ('id', 'start', 'end', 'text'))
           or jsonb_typeof(_c->'id') is distinct from 'string' or length(_c->>'id') not between 1 and 64
           or jsonb_typeof(_c->'text') is distinct from 'string'
           or jsonb_typeof(_c->'start') is distinct from 'number' or not ((_c->>'start') collate "C" ~ '^[0-9]{1,6}$')
           or jsonb_typeof(_c->'end') is distinct from 'number' or not ((_c->>'end') collate "C" ~ '^[0-9]{1,6}$') then
            raise exception 'a comment is {id, start, end, text}' using errcode = '22023';
        end if;
        _s := (_c->>'start')::int;
        _e := (_c->>'end')::int;
        if _s >= _e or _e > coalesce(p_chars, 0) then
            raise exception 'a comment''s start and end must be within the writing, start before end' using errcode = '22023';
        end if;
        _t := btrim(_c->>'text', _trim);
        if length(_t) not between 1 and 1000 then
            raise exception 'a comment must be 1 to 1000 characters' using errcode = '22023';
        end if;
        if (_c->>'id') collate "C" = any (_ids) then
            raise exception 'a comment''s id is used twice' using errcode = '22023';
        end if;
        _ids := _ids || (_c->>'id');
        _out := _out || jsonb_build_array(jsonb_build_object('id', _c->>'id', 'start', _s, 'end', _e, 'text', _t));
    end loop;
    return coalesce((select jsonb_agg(t.x order by (t.x->>'start')::int, (t.x->>'end')::int, (t.x->>'id') collate "C")
                       from jsonb_array_elements(_out) as t(x)), '[]'::jsonb);
end;
$function$;

revoke all on function public._writing_runs(jsonb), public._writing_plain(jsonb), public._writing_comment_list(jsonb, integer)
    from public, anon, authenticated, service_role;

-- == 3. The tables ==
create table if not exists public.writing_draft (
    enrollment_id uuid not null,
    assessment_id uuid not null,
    course_id     uuid not null,
    body          jsonb not null,
    plain         text not null,
    chars         integer not null,
    rev           integer not null default 1,
    saved_at      timestamptz not null default now(),
    created_at    timestamptz not null default now(),
    constraint writing_draft_pkey primary key (enrollment_id, assessment_id),
    constraint writing_draft_enrollment_fkey foreign key (enrollment_id, course_id)
        references public.enrollment (id, course_id) on delete cascade,
    constraint writing_draft_assessment_fkey foreign key (assessment_id, course_id)
        references public.assessment (id, course_id) on delete cascade,
    constraint writing_draft_rev_check check (rev >= 1),
    constraint writing_draft_chars_check check (chars >= 0 and chars <= 60000 and chars = length(plain)),
    constraint writing_draft_size_check check (octet_length(body::text) <= 600000),
    constraint writing_draft_rule check ((plain collate "C") = (public._writing_plain(body) collate "C"))
);
create index if not exists writing_draft_assessment_idx on public.writing_draft (assessment_id, course_id);

create table if not exists public.submission_writing (
    submission_id uuid not null,
    body          jsonb not null,
    plain         text not null,
    chars         integer not null,
    draft_rev     integer,
    created_at    timestamptz not null default now(),
    constraint submission_writing_pkey primary key (submission_id),
    constraint submission_writing_submission_fkey foreign key (submission_id)
        references public.submission (id) on delete cascade,
    constraint submission_writing_chars_check check (chars >= 1 and chars <= 60000 and chars = length(plain)),
    constraint submission_writing_size_check check (octet_length(body::text) <= 600000),
    constraint submission_writing_rule check ((plain collate "C") = (public._writing_plain(body) collate "C"))
);

create table if not exists public.writing_comments (
    submission_id uuid not null,
    working       jsonb,
    working_rev   integer not null default 0,
    working_at    timestamptz,
    given         jsonb,
    given_rev     integer,
    given_at      timestamptz,
    created_at    timestamptz not null default now(),
    constraint writing_comments_pkey primary key (submission_id),
    constraint writing_comments_writing_fkey foreign key (submission_id)
        references public.submission_writing (submission_id) on delete cascade,
    constraint writing_comments_working_list check (working is null or (jsonb_typeof(working) = 'object'
        and jsonb_typeof(working->'comments') = 'array' and jsonb_array_length(working->'comments') <= 300
        and octet_length(working::text) <= 2000000)),
    constraint writing_comments_given_list check (given is null or (jsonb_typeof(given) = 'object'
        and jsonb_typeof(given->'comments') = 'array' and jsonb_array_length(given->'comments') <= 300
        and octet_length(given::text) <= 2000000)),
    constraint writing_comments_given_has_rev check ((given_rev is null) = (given_at is null))
);

alter table public.writing_draft enable row level security;
alter table public.submission_writing enable row level security;
alter table public.writing_comments enable row level security;
revoke all on table public.writing_draft, public.submission_writing, public.writing_comments
    from public, anon, authenticated, service_role;

comment on table public.writing_draft is
    'A student''s typed work for one piece before it is sent (2026112702). Only the student page''s functions read it; no teacher function does.';
comment on table public.submission_writing is
    'The typed work sent with a submission (2026112702): a JSON document by public._writing_plain''s rule, never HTML.';
comment on table public.writing_comments is
    'The teacher''s comments pinned to passages of a submission''s writing (2026112702), kept and given as Mark Up is.';

-- == 4. The helpers the send and removal paths call (no role may call them) ==
create or replace function public._writing_take(p_enrollment_id uuid, p_assessment_id uuid, p_draft_rev integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
-- A send with writing: the student's draft for the piece, at the revision the phone saved last, and not
-- empty. Locked until the send commits, so a save waits for it. Null when it may go; else the answer.
declare
    _d writing_draft%rowtype;
begin
    select * into _d from writing_draft d
     where d.enrollment_id = p_enrollment_id and d.assessment_id = p_assessment_id
       for update;
    if _d.rev is distinct from p_draft_rev then
        return jsonb_build_object('ok', false, 'error', 'draft_changed', 'rev', _d.rev);
    end if;
    if _d.chars = 0 then
        return jsonb_build_object('ok', false, 'error', 'no_writing');
    end if;
    return null;
end;
$function$;

create or replace function public._writing_attach(p_submission_id uuid, p_draft_rev integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
-- The draft _writing_take checked, copied to the send it made.
begin
    insert into submission_writing (submission_id, body, plain, chars, draft_rev)
    select s.id, d.body, d.plain, d.chars, d.rev
      from submission s
      join writing_draft d on d.enrollment_id = s.enrollment_id and d.assessment_id = s.assessment_id
     where s.id = p_submission_id and d.rev = p_draft_rev;
    if not found then
        raise exception 'the draft to send is not there' using errcode = 'P0002';
    end if;
end;
$function$;

create or replace function public._writing_draft_done(p_submission_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    -- Handed in: the draft it was sent from goes, unless the student has changed it since.
    delete from writing_draft d
     using submission s, submission_writing w
     where s.id = p_submission_id and w.submission_id = s.id
       and d.enrollment_id = s.enrollment_id and d.assessment_id = s.assessment_id
       and d.rev = w.draft_rev and d.body = w.body;
$function$;

create or replace function public._writing_back_to_draft(p_submission_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
    -- Sent work about to be removed (Unsend, the teacher's Delete or Replace Them): its writing becomes the
    -- student's draft again, as rev 1. A draft the student already has is newer and is kept.
    insert into writing_draft (enrollment_id, assessment_id, course_id, body, plain, chars, rev)
    select s.enrollment_id, s.assessment_id, s.course_id, w.body, w.plain, w.chars, 1
      from submission s
      join submission_writing w on w.submission_id = s.id
     where s.id = p_submission_id and s.state = 'sent'
    on conflict (enrollment_id, assessment_id) do nothing;
$function$;

create or replace function public._work_check_send_files(p_submission_id uuid, p_files jsonb)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
-- A finish's files: no files is a finish only for a send that carries writing; otherwise _work_check_files.
begin
    if p_files = '[]'::jsonb and exists (select 1 from submission_writing w where w.submission_id = p_submission_id) then
        return;
    end if;
    perform public._work_check_files(p_files);
end;
$function$;

revoke all on function public._writing_take(uuid, uuid, integer), public._writing_attach(uuid, integer),
    public._writing_draft_done(uuid), public._writing_back_to_draft(uuid), public._work_check_send_files(uuid, jsonb)
    from public, anon, authenticated, service_role;

-- == 5. The patched functions ==
-- Each function's edits are made together, each found exactly once in its live definition, then it is
-- replaced once. _send_begin and revision_start get a new last argument: the new one is made from the old,
-- then the old is dropped. A function already as this file leaves it is skipped.
do $patch$
declare
  _edits text[][] := array[
    -- function, text to find, replacement
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          'p_request_id uuid)',
          'p_request_id uuid, p_draft_rev integer DEFAULT NULL::integer)'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          '    _id      uuid;
begin',
          '    _id      uuid;
    _took    jsonb;
begin'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          '    perform public._work_check_pages(p_pages);',
          '    -- 2026112702: a send with writing (p_draft_rev) may have no pages; pages it has keep the rule.
    if p_draft_rev is null or p_pages is distinct from ''[]''::jsonb then
        perform public._work_check_pages(p_pages);
    end if;'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          '    -- Twenty sends an hour for one card (Colin, Nov 9).',
          '    -- 2026112702: the writing is the student''s draft at the revision the phone saved last, not empty.
    if p_draft_rev is not null then
        _took := public._writing_take(p_enrollment_id, _a.id, p_draft_rev);
        if _took is not null then
            return _took;
        end if;
    end if;

    -- Twenty sends an hour for one card (Colin, Nov 9).'],
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          'p_pages, p_note, p_followed_plan, (_w->>''late'')::boolean, _card, p_request_id);',
          'p_pages, p_note, p_followed_plan, (_w->>''late'')::boolean, _card, p_request_id);
    if p_draft_rev is not null then
        perform public._writing_attach(_id, p_draft_rev);
    end if;'],

    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          'p_request_id uuid, p_ip_hash text)',
          'p_request_id uuid, p_ip_hash text, p_draft_rev integer DEFAULT NULL::integer)'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    _id      uuid;
begin',
          '    _id      uuid;
    _took    jsonb;
begin'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    perform public._work_check_pages(p_pages);',
          '    -- 2026112702: a revision with writing (p_draft_rev) may have no pages; pages it has keep the rule.
    if p_draft_rev is null or p_pages is distinct from ''[]''::jsonb then
        perform public._work_check_pages(p_pages);
    end if;'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    -- Twenty sends an hour for one card, counted as Batch B counts them.',
          '    -- 2026112702: the writing is the student''s draft at the revision the phone saved last, not empty.
    if p_draft_rev is not null then
        _took := public._writing_take(p_enrollment_id, _a.id, p_draft_rev);
        if _took is not null then
            return _took;
        end if;
    end if;

    -- Twenty sends an hour for one card, counted as Batch B counts them.'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          '    update submission set version = _version where id = _id;',
          '    update submission set version = _version where id = _id;
    if p_draft_rev is not null then
        perform public._writing_attach(_id, p_draft_rev);
    end if;'],

    array['student_submit.send_finish(text,uuid,uuid,jsonb,text)',
          '    perform public._work_check_files(p_files);',
          '    -- 2026112702: no files is a finish only for a send that carries writing.
    perform public._work_check_send_files(p_submission_id, p_files);'],
    array['student_submit.send_finish(text,uuid,uuid,jsonb,text)',
          '    returning * into _sub;',
          '    returning * into _sub;
    -- 2026112702: the draft it was sent from is done (a newer draft is kept).
    perform public._writing_draft_done(_sub.id);'],

    array['student_submit.revision_finish(text,uuid,uuid,jsonb,text)',
          '    perform public._work_check_files(p_files);',
          '    -- 2026112702: no files is a finish only for a send that carries writing.
    perform public._work_check_send_files(p_submission_id, p_files);'],
    array['student_submit.revision_finish(text,uuid,uuid,jsonb,text)',
          '    returning * into _sub;',
          '    returning * into _sub;
    -- 2026112702: the draft it was sent from is done (a newer draft is kept).
    perform public._writing_draft_done(_sub.id);'],

    array['student_submit.unsend(text,uuid,uuid,text)',
          '    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    if _kept = 0 then',
          '    -- 2026112702: the student''s writing goes back to their draft (a newer draft is kept).
    perform public._writing_back_to_draft(_sent.id);
    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    if _kept = 0 then'],
    array['student_submit.unsend(text,uuid,uuid,text)',
          '        delete from submission_file where submission_id = _sent.id and added_by = ''student'';',
          '        delete from submission_writing where submission_id = _sent.id;
        delete from submission_file where submission_id = _sent.id and added_by = ''student'';'],

    array['student_submit.revision_unsend(text,uuid,uuid,text)',
          '    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    delete from submission where id = _old;',
          '    -- 2026112702: the student''s writing goes back to their draft (a newer draft is kept).
    perform public._writing_back_to_draft(_old);
    perform set_config(''fv.work_removal_reason'', ''unsend'', true);
    delete from submission where id = _old;'],

    array['public.delete_submission(uuid,uuid)',
          '    perform set_config(''fv.work_removal_reason'', ''teacher'', true);',
          '    -- 2026112702: a student''s writing goes back to the student''s draft (a newer draft is kept).
    if _course is not null then
        perform public._writing_back_to_draft(p_submission_id);
    end if;
    perform set_config(''fv.work_removal_reason'', ''teacher'', true);'],

    array['public.finish_work_upload(uuid,jsonb,uuid)',
          '            perform set_config(''fv.work_removal_reason'', ''replace'', true);
            delete from submission where id = _target.id;',
          '            -- 2026112702: a student''s writing goes back to the student''s draft (a newer draft is kept).
            perform public._writing_back_to_draft(_target.id);
            perform set_config(''fv.work_removal_reason'', ''replace'', true);
            delete from submission where id = _target.id;'],

    array['public._markup_give(uuid,uuid)',
          '    get diagnostics _n = row_count;
    return _n;',
          '    get diagnostics _n = row_count;
    -- 2026112702: comments pinned to the student''s writing for the piece are given with the marks.
    update writing_comments c
       set given = c.working, given_rev = c.working_rev, given_at = clock_timestamp()
      from submission s
     where s.id = c.submission_id and s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id
       and c.given_rev is distinct from c.working_rev
       and not (c.given is null and jsonb_array_length(coalesce(c.working->''comments'', ''[]''::jsonb)) = 0);
    return _n;'],

    array['public._markup_on_release()',
          '                and g.returned_at is not null and not g.is_draft) p;',
          '                and g.returned_at is not null and not g.is_draft
             -- 2026112702: and the pieces with comments on writing waiting
             union
             select s.enrollment_id, s.assessment_id
               from writing_comments c
               join submission s on s.id = c.submission_id and s.course_id = new.id
               join grade_return g on g.enrollment_id = s.enrollment_id and g.assessment_id = s.assessment_id
              where c.given_rev is distinct from c.working_rev
                and g.returned_at is not null and not g.is_draft) p;'],

    array['student_submit._grading_started(uuid,uuid)',
          '                      and jsonb_array_length(coalesce(k.working->''marks'', ''[]''::jsonb)) > 0);',
          '                      and jsonb_array_length(coalesce(k.working->''marks'', ''[]''::jsonb)) > 0)
        -- 2026112702: the teacher''s comments pinned to this student''s writing for the piece
        or exists (select 1 from writing_comments c
                    join submission s on s.id = c.submission_id
                    where s.enrollment_id = p_enrollment_id and s.assessment_id = p_assessment_id
                      and jsonb_array_length(coalesce(c.working->''comments'', ''[]''::jsonb)) > 0);'],

    array['public._submission_json(uuid)',
          '''created_at'', s.created_at, ''sent_at'', s.sent_at,',
          '''created_at'', s.created_at, ''sent_at'', s.sent_at,
               -- 2026112702: the writing sent with it: its length and its first 280 characters
               ''writing'', (select jsonb_build_object(''chars'', sw.chars, ''start'', left(sw.plain, 280))
                             from submission_writing sw where sw.submission_id = s.id),'],

    array['student_submit.work(text,uuid,text)',
          '''pages'', (select count(*) from submission_file f where f.submission_id = s.id),',
          '''pages'', (select count(*) from submission_file f where f.submission_id = s.id),
                                   -- 2026112702: the writing sent with it, its length, or null
                                   ''writing'', (select sw.chars from submission_writing sw where sw.submission_id = s.id),'],
    array['student_submit.work(text,uuid,text)',
          '''late_now'', w.j->''late'',',
          '''late_now'', w.j->''late'',
                       -- 2026112702: the student''s draft for the piece, or null
                       ''draft'', (select jsonb_build_object(''rev'', d.rev, ''chars'', d.chars, ''saved_at'', d.saved_at)
                                   from writing_draft d where d.enrollment_id = p_enrollment_id and d.assessment_id = a.id),']
  ];
  _resigned text[][] := array[
    array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
          'student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)'],
    array['student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',
          'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)']
  ];
  _fn    text;
  _new   text;
  _def   text;
  _hits  int;
  i      int;
  j      int;
begin
  for _fn in select x.f from (select _edits[k][1] as f, k from generate_subscripts(_edits, 1) k) x
              group by x.f order by min(x.k) loop
    _new := null;
    for j in 1 .. array_length(_resigned, 1) loop
      if _resigned[j][1] = _fn then _new := _resigned[j][2]; end if;
    end loop;
    -- Skip a function already as this file leaves it.
    if _new is not null and to_regprocedure(_fn) is null then
      continue;
    end if;
    if _new is null and md5(pg_get_functiondef(_fn::regprocedure)) = (select v.becomes from (values
        -- FINGERPRINTS-BEGIN patched
        ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'f9a5a0b8a32f4f4d11e8a0715472db6a'),
        ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'c318d2887499162bb1e8fe708f3ed923'),
        ('student_submit.unsend(text,uuid,uuid,text)', '697fc569e89c9ec421c00e349fdd853d'),
        ('student_submit.revision_unsend(text,uuid,uuid,text)', '2f462712bd33bba734fd4419652c8b9f'),
        ('public.delete_submission(uuid,uuid)', '534dc8ee7e2448695f6254f5fe3843b7'),
        ('public.finish_work_upload(uuid,jsonb,uuid)', '005384268d5a0be403bdcd52c31b2ad0'),
        ('public._markup_give(uuid,uuid)', '68ed4bdfa5ca39324217788ff02169a4'),
        ('public._markup_on_release()', '747a6a625b7be23c096619eb37226739'),
        ('student_submit._grading_started(uuid,uuid)', '059a3ce924808dc33421cee5912b0066'),
        ('public._submission_json(uuid)', 'fe00bc0b12796163e57c273831213cae'),
        ('student_submit.work(text,uuid,text)', '2f8c6e8f284e051320620700bc6b054d')
        -- FINGERPRINTS-END
        ) as v(fn, becomes) where v.fn = _fn) then
      continue;
    end if;
    _def := pg_get_functiondef(_fn::regprocedure);
    for i in 1 .. array_length(_edits, 1) loop
      if _edits[i][1] = _fn then
        _hits := (length(_def) - length(replace(_def, _edits[i][2], ''))) / length(_edits[i][2]);
        if _hits <> 1 then
          raise exception '% has % matches for "%", expected 1. Nothing was changed.', _fn, _hits, _edits[i][2];
        end if;
        _def := replace(_def, _edits[i][2], _edits[i][3]);
      end if;
    end loop;
    execute _def;
    if _new is not null then
      execute 'drop function ' || _fn;
    end if;
  end loop;
end
$patch$;

-- _send_begin is called only by the database's own functions; revision_start by the edge function.
revoke all on function student_submit._send_begin(text, text, uuid, uuid, jsonb, text, text, uuid, integer)
    from public, anon, authenticated, service_role;
revoke all on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text, integer)
    from public, anon, authenticated, service_role;
grant execute on function student_submit.revision_start(text, uuid, uuid, jsonb, text, uuid, text, integer) to service_role;

-- == 6. The student page's three ==
create or replace function student_submit.writing(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
-- The student's writing for one piece: the draft, the writing sent (each version, newest first) and, once
-- returned, the comments the teacher gave on it, by Mark Up's rule (student_submit.markup). Reads only.
declare
    _in     jsonb := _session_class(p_session_token, p_enrollment_id);
    _course course%rowtype;
    _a      assessment%rowtype;
    _shown  boolean;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    select * into _a from assessment
     where id = p_assessment_id and course_id = _course.id
       and student_submit._listed(assessment, (now() at time zone public._fv_timezone(_course.timezone))::date);
    if _a.id is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    _shown := _a.students_see_markup
              and not exists (select 1 from score s where s.enrollment_id = p_enrollment_id and s.assessment_id = _a.id
                                                     and s.status in ('NS', 'EXC'));
    return jsonb_build_object(
        'ok', true,
        'draft', (select jsonb_build_object('body', d.body, 'rev', d.rev, 'chars', d.chars, 'saved_at', d.saved_at)
                    from writing_draft d where d.enrollment_id = p_enrollment_id and d.assessment_id = _a.id),
        'sent', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'submission_id', s.id, 'version', s.version, 'sent_at', s.sent_at, 'body', w.body, 'chars', w.chars,
                       'comments', case when _shown then coalesce((
                           select jsonb_agg(jsonb_build_object('start', t.x->'start', 'end', t.x->'end', 'text', t.x->'text') order by t.n)
                             from jsonb_array_elements(c.given->'comments') with ordinality as t(x, n)), '[]'::jsonb)
                           else '[]'::jsonb end)
                     order by s.version desc)
              from submission s
              join submission_writing w on w.submission_id = s.id
              left join writing_comments c on c.submission_id = s.id
             where s.assessment_id = _a.id and s.enrollment_id = p_enrollment_id and s.state = 'sent'), '[]'::jsonb));
end;
$function$;

create or replace function student_submit.writing_save(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_body jsonb, p_base_rev integer, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
-- Saves the student's draft for a piece that takes work, if p_base_rev is the draft's rev (0: no draft yet).
-- A repeat of the save that made rev p_base_rev + 1 is answered as saved, with nothing changed; any other
-- difference is "changed", with the draft as it is, and nothing saved. A null body deletes the draft. Over
-- 60,000 characters or 600,000 bytes is "too_long". 900 saves an hour a card. No class lock is taken.
declare
    _in     jsonb;
    _course course%rowtype;
    _a      assessment%rowtype;
    _plain  text;
    _d      writing_draft%rowtype;
    _no     jsonb;
begin
    if p_assessment_id is null then
        raise exception 'an assessment is needed' using errcode = '22023';
    end if;
    if p_base_rev is null or p_base_rev < 0 then
        raise exception 'base_rev must be 0 or more' using errcode = '22023';
    end if;
    if p_body is not null then
        _plain := public._writing_plain(p_body);
    end if;
    _in := _send_session(p_session_token, p_enrollment_id);
    if _in ? 'error' then
        return jsonb_build_object('ok', false, 'error', _in->>'error');
    end if;
    select * into _course from course where id = (_in->>'course_id')::uuid;
    if not _course.send_work then
        return jsonb_build_object('ok', false, 'error', 'send_off');
    end if;
    select * into _a from assessment where id = p_assessment_id and course_id = _course.id;
    if _a.id is null or not (_work_window(_a.id)->>'listed')::boolean then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if _a.students_send = 'nothing' then
        return jsonb_build_object('ok', false, 'error', 'not_taking_work');
    end if;
    if p_body is not null and (length(_plain) > 60000 or octet_length(p_body::text) > 600000) then
        return jsonb_build_object('ok', false, 'error', 'too_long', 'chars', length(_plain), 'max', 60000);
    end if;
    _no := _write_limit((_in->>'card_id')::uuid, 'writing', 900);
    if _no is not null then
        return _no;
    end if;

    select * into _d from writing_draft d
     where d.enrollment_id = p_enrollment_id and d.assessment_id = _a.id
       for update;
    if _d.rev is null then
        if p_base_rev <> 0 then
            return jsonb_build_object('ok', false, 'error', 'changed', 'draft', null);
        end if;
        if p_body is null then
            return jsonb_build_object('ok', true, 'replayed', false, 'rev', 0, 'deleted', true);
        end if;
        insert into writing_draft (enrollment_id, assessment_id, course_id, body, plain, chars, rev)
        values (p_enrollment_id, _a.id, _course.id, p_body, _plain, length(_plain), 1)
        on conflict (enrollment_id, assessment_id) do nothing
        returning * into _d;
        if _d.rev is null then
            -- A first save from another device came first: answered as against that one.
            select * into _d from writing_draft d
             where d.enrollment_id = p_enrollment_id and d.assessment_id = _a.id
               for update;
            if _d.rev = 1 and _d.body = p_body then
                return jsonb_build_object('ok', true, 'replayed', true, 'rev', _d.rev, 'chars', _d.chars, 'saved_at', _d.saved_at);
            end if;
            return jsonb_build_object('ok', false, 'error', 'changed',
                                      'draft', jsonb_build_object('body', _d.body, 'rev', _d.rev, 'chars', _d.chars, 'saved_at', _d.saved_at));
        end if;
        return jsonb_build_object('ok', true, 'replayed', false, 'rev', _d.rev, 'chars', _d.chars, 'saved_at', _d.saved_at);
    end if;
    if _d.rev <> p_base_rev then
        if _d.rev = p_base_rev + 1 and p_body is not null and _d.body = p_body then
            return jsonb_build_object('ok', true, 'replayed', true, 'rev', _d.rev, 'chars', _d.chars, 'saved_at', _d.saved_at);
        end if;
        return jsonb_build_object('ok', false, 'error', 'changed',
                                  'draft', jsonb_build_object('body', _d.body, 'rev', _d.rev, 'chars', _d.chars, 'saved_at', _d.saved_at));
    end if;
    if p_body is null then
        delete from writing_draft d where d.enrollment_id = p_enrollment_id and d.assessment_id = _a.id;
        return jsonb_build_object('ok', true, 'replayed', false, 'rev', 0, 'deleted', true);
    end if;
    update writing_draft d
       set body = p_body, plain = _plain, chars = length(_plain), rev = d.rev + 1, saved_at = now()
     where d.enrollment_id = p_enrollment_id and d.assessment_id = _a.id
    returning * into _d;
    return jsonb_build_object('ok', true, 'replayed', false, 'rev', _d.rev, 'chars', _d.chars, 'saved_at', _d.saved_at);
end;
$function$;

create or replace function student_submit.writing_start(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_intent text, p_pages jsonb, p_draft_rev integer, p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
-- A send with writing, through the functions photos go through: new and replace through _send_begin,
-- revision through revision_start, each given p_draft_rev. With no pages there is nothing to upload, so it
-- is handed in now by the same finish (send_finish or revision_finish) photos go through, in this call.
declare
    _r jsonb;
    _f jsonb;
begin
    if p_intent is null or p_intent not in ('new', 'replace', 'revision') then
        raise exception 'intent must be new, replace or revision' using errcode = '22023';
    end if;
    if p_draft_rev is null or p_draft_rev < 1 then
        raise exception 'a draft revision is needed' using errcode = '22023';
    end if;
    if p_intent = 'revision' then
        _r := student_submit.revision_start(p_session_token, p_enrollment_id, p_assessment_id, p_pages, p_note,
                                            p_request_id, p_ip_hash, p_draft_rev);
    else
        _r := student_submit._send_begin(p_intent, p_session_token, p_enrollment_id, p_assessment_id, p_pages, p_note,
                                         p_followed_plan, p_request_id, p_draft_rev);
    end if;
    if not coalesce((_r->>'ok')::boolean, false) or p_pages is distinct from '[]'::jsonb then
        return _r;
    end if;
    if p_intent = 'revision' then
        _f := student_submit.revision_finish(p_session_token, p_enrollment_id, (_r->>'submission_id')::uuid, '[]'::jsonb, p_ip_hash);
    else
        _f := student_submit.send_finish(p_session_token, p_enrollment_id, (_r->>'submission_id')::uuid, '[]'::jsonb, p_ip_hash);
    end if;
    if coalesce((_f->>'ok')::boolean, false) then
        return _f || jsonb_build_object('state', 'sent', 'files', '[]'::jsonb);
    end if;
    return _f;
end;
$function$;

revoke all on function student_submit.writing(text, uuid, uuid, text),
    student_submit.writing_save(text, uuid, uuid, jsonb, integer, text),
    student_submit.writing_start(text, uuid, uuid, text, jsonb, integer, text, text, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function student_submit.writing(text, uuid, uuid, text),
    student_submit.writing_save(text, uuid, uuid, jsonb, integer, text),
    student_submit.writing_start(text, uuid, uuid, text, jsonb, integer, text, text, uuid, text)
    to service_role;

-- == 7. The teacher's two ==
create or replace function public.get_submission_writing(p_submission_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
-- The writing handed in with a submission of the teacher's class, with the teacher's working comments.
-- P0002 for anything else: never there, a draft, unfinished, deleted, another teacher's.
declare
    _r jsonb;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    select jsonb_build_object(
               'submission_id', s.id, 'assessment_id', s.assessment_id, 'enrollment_id', s.enrollment_id,
               'version', s.version, 'sent_at', s.sent_at, 'body', w.body, 'chars', w.chars,
               'comments', coalesce(c.working->'comments', '[]'::jsonb), 'rev', coalesce(c.working_rev, 0),
               'given_rev', c.given_rev,
               'waiting', c.given_rev is distinct from c.working_rev
                          and not (c.given is null and jsonb_array_length(coalesce(c.working->'comments', '[]'::jsonb)) = 0)
                          and a.students_see_markup)
      into _r
      from submission s
      join submission_writing w on w.submission_id = s.id
      join assessment a on a.id = s.assessment_id
      left join writing_comments c on c.submission_id = s.id
     where s.id = p_submission_id and s.state = 'sent' and fv_owns_course(s.course_id);
    if _r is null then
        raise exception 'writing not found' using errcode = 'P0002';
    end if;
    return _r;
end;
$function$;

create or replace function public.save_writing_comments(p_submission_id uuid, p_comments jsonb, p_base_rev integer DEFAULT NULL::integer, p_idempotency_key uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
-- The teacher's comments pinned to a submission's writing, the whole list replaced, as save_markup replaces
-- a page's marks: a stale p_base_rev is "changed" with nothing saved; a used key replays; in a class that
-- returns at once they are given now, as marks are.
declare
    _cached jsonb;
    _course uuid;
    _s      submission%rowtype;
    _chars  int;
    _list   jsonb;
    _c      writing_comments%rowtype;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_base_rev is not null and p_base_rev < 0 then
        raise exception 'base_rev must be 0 or more' using errcode = '22023';
    end if;
    select s.course_id into _course from submission s where s.id = p_submission_id and fv_owns_course(s.course_id);
    if _course is not null then
        perform _grade_return_lock_first(_course);
    end if;
    -- Asked under the lock (when there is a class to lock).
    _cached := fv_idem_check(p_idempotency_key, 'save_writing_comments');
    if _cached is not null then return _cached; end if;
    -- Only writing handed in, in a class the teacher owns. Read again under the lock: it may have been
    -- unsent while this call waited.
    select s.* into _s from submission s
     where s.id = p_submission_id and s.course_id = _course and s.state = 'sent';
    select w.chars into _chars from submission_writing w where w.submission_id = _s.id;
    if _s.id is null or _chars is null then
        raise exception 'writing not found' using errcode = 'P0002';
    end if;
    _list := public._writing_comment_list(p_comments, _chars);
    select * into _c from writing_comments where submission_id = p_submission_id for update;
    if p_base_rev is not null and coalesce(_c.working_rev, 0) <> p_base_rev then
        -- Not remembered: the screen reads what is there and decides.
        return jsonb_build_object('result', 'changed', 'submission_id', p_submission_id, 'rev', coalesce(_c.working_rev, 0),
                                  'comments', coalesce(_c.working->'comments', '[]'::jsonb));
    end if;
    insert into writing_comments (submission_id, working, working_rev, working_at)
    values (p_submission_id, jsonb_build_object('comments', _list), 1, clock_timestamp())
    on conflict (submission_id) do update
       set working = excluded.working, working_rev = writing_comments.working_rev + 1, working_at = excluded.working_at;
    if not _grade_return_holds(_s.enrollment_id) then
        perform _markup_give(_s.enrollment_id, _s.assessment_id);
    end if;
    select jsonb_build_object('result', 'saved', 'submission_id', p_submission_id, 'rev', c.working_rev, 'given_rev', c.given_rev,
                              'waiting', c.given_rev is distinct from c.working_rev
                                         and not (c.given is null and jsonb_array_length(coalesce(c.working->'comments', '[]'::jsonb)) = 0)
                                         and a.students_see_markup)
      into _cached
      from writing_comments c join assessment a on a.id = _s.assessment_id where c.submission_id = p_submission_id;
    perform fv_idem_store(p_idempotency_key, 'save_writing_comments', _cached);
    return _cached;
end;
$function$;

revoke all on function public.get_submission_writing(uuid), public.save_writing_comments(uuid, jsonb, integer, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.get_submission_writing(uuid), public.save_writing_comments(uuid, jsonb, integer, uuid)
    to authenticated, service_role;

-- == 8. The last check: everything as written ==
do $lastcheck$
declare
    _f   record;
    _bad text[] := '{}';
    _md5 text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN final
            ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'f9a5a0b8a32f4f4d11e8a0715472db6a', 'student'),
            ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'c318d2887499162bb1e8fe708f3ed923', 'student'),
            ('student_submit.unsend(text,uuid,uuid,text)', '697fc569e89c9ec421c00e349fdd853d', 'student'),
            ('student_submit.revision_unsend(text,uuid,uuid,text)', '2f462712bd33bba734fd4419652c8b9f', 'student'),
            ('public.delete_submission(uuid,uuid)', '534dc8ee7e2448695f6254f5fe3843b7', 'teacher'),
            ('public.finish_work_upload(uuid,jsonb,uuid)', '005384268d5a0be403bdcd52c31b2ad0', 'teacher'),
            ('public._markup_give(uuid,uuid)', '68ed4bdfa5ca39324217788ff02169a4', 'owner'),
            ('public._markup_on_release()', '747a6a625b7be23c096619eb37226739', 'owner'),
            ('student_submit._grading_started(uuid,uuid)', '059a3ce924808dc33421cee5912b0066', 'owner'),
            ('public._submission_json(uuid)', 'fe00bc0b12796163e57c273831213cae', 'owner'),
            ('student_submit.work(text,uuid,text)', '2f8c6e8f284e051320620700bc6b054d', 'student'),
            ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)', '3fb68d3590a8d265c9343d3743589131', 'owner'),
            ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)', 'a489d7771345b6a75c43cd038733b715', 'student'),
            ('public._writing_runs(jsonb)', '04fc22dfbf4abd15a9cd0fb4d0ff2d2d', 'owner'),
            ('public._writing_plain(jsonb)', 'a3879b9da077187277c9b3a882f6ebab', 'owner'),
            ('public._writing_comment_list(jsonb,integer)', '4733d9b3998516b26cc80ccdefe56ccf', 'owner'),
            ('public._writing_take(uuid,uuid,integer)', '74750ed12de507435b19994a9b451706', 'owner'),
            ('public._writing_attach(uuid,integer)', '82813807957f5922afcb2f6e306de555', 'owner'),
            ('public._writing_draft_done(uuid)', '3b84964b5ebce61c75bd215821df5bdf', 'owner'),
            ('public._writing_back_to_draft(uuid)', 'c555af37199c7cd50d72f73a6e57f777', 'owner'),
            ('public._work_check_send_files(uuid,jsonb)', '69c4c4be2414afec4c99b428846a2cf3', 'owner'),
            ('student_submit.writing(text,uuid,uuid,text)', 'ded44bf06f5ca15e344c07cfa1a316a1', 'student'),
            ('student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)', 'be98cfa8f342ffb87d3453ca39d6bd6c', 'student'),
            ('student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)', '49e18446699e681a1cf843e348bd89ac', 'student'),
            ('public.get_submission_writing(uuid)', '0c6a5dcb8c91f786c6bccfffbe2822ac', 'teacher'),
            ('public.save_writing_comments(uuid,jsonb,integer,uuid)', 'cbfcd69bc677cf0ee1b3f41b0281da4b', 'teacher')
            -- FINGERPRINTS-END
        ) as v(fn, becomes, runs)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            _bad := _bad || format('function %s is %s, not %s', _f.fn, _md5, _f.becomes);
            continue;
        end if;
        if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = to_regprocedure(_f.fn) and a.grantee = 0)
           or (select proacl from pg_proc where oid = to_regprocedure(_f.fn)) is null then
            _bad := _bad || format('function %s may be run by PUBLIC', _f.fn);
        end if;
        if has_function_privilege('anon', to_regprocedure(_f.fn), 'execute') then
            _bad := _bad || format('function %s may be run by anon', _f.fn);
        end if;
        if has_function_privilege('authenticated', to_regprocedure(_f.fn), 'execute') <> (_f.runs = 'teacher') then
            _bad := _bad || format('function %s: authenticated may run it is not %s', _f.fn, _f.runs = 'teacher');
        end if;
        if has_function_privilege('service_role', to_regprocedure(_f.fn), 'execute') <> (_f.runs in ('teacher', 'student')) then
            _bad := _bad || format('function %s: service_role may run it is not %s', _f.fn, _f.runs in ('teacher', 'student'));
        end if;
    end loop;
    if to_regprocedure('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)') is not null
       or to_regprocedure('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)') is not null then
        _bad := _bad || 'an old _send_begin or revision_start is still there'::text;
    end if;
    for _f in select t::regclass as rel from unnest(array['public.writing_draft', 'public.submission_writing', 'public.writing_comments']) t loop
        if not (select relrowsecurity from pg_class where oid = _f.rel) then
            _bad := _bad || format('table %s has no row security', _f.rel);
        end if;
        if exists (select 1 from pg_policy where polrelid = _f.rel) then
            _bad := _bad || format('table %s has a policy', _f.rel);
        end if;
        if exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = _f.rel and a.grantee <> c.relowner)
           or (select relacl from pg_class where oid = _f.rel) is null
           or exists (select 1 from pg_attribute where attrelid = _f.rel and attacl is not null) then
            _bad := _bad || format('table %s may be read or written by a role other than its owner', _f.rel);
        end if;
    end loop;
    if (select string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C")
          from pg_constraint where conrelid in ('public.writing_draft'::regclass, 'public.submission_writing'::regclass,
                                                'public.writing_comments'::regclass))
       is distinct from (
            -- FINGERPRINTS-BEGIN constraints
            'submission_writing_chars_check: CHECK (((chars >= 1) AND (chars <= 60000) AND (chars = length(plain)))) | submission_writing_pkey: PRIMARY KEY (submission_id) | submission_writing_rule: CHECK (((plain COLLATE "C") = (_writing_plain(body) COLLATE "C"))) | submission_writing_size_check: CHECK ((octet_length((body)::text) <= 600000)) | submission_writing_submission_fkey: FOREIGN KEY (submission_id) REFERENCES submission(id) ON DELETE CASCADE | writing_comments_given_has_rev: CHECK (((given_rev IS NULL) = (given_at IS NULL))) | writing_comments_given_list: CHECK (((given IS NULL) OR ((jsonb_typeof(given) = ''object''::text) AND (jsonb_typeof((given -> ''comments''::text)) = ''array''::text) AND (jsonb_array_length((given -> ''comments''::text)) <= 300) AND (octet_length((given)::text) <= 2000000)))) | writing_comments_pkey: PRIMARY KEY (submission_id) | writing_comments_working_list: CHECK (((working IS NULL) OR ((jsonb_typeof(working) = ''object''::text) AND (jsonb_typeof((working -> ''comments''::text)) = ''array''::text) AND (jsonb_array_length((working -> ''comments''::text)) <= 300) AND (octet_length((working)::text) <= 2000000)))) | writing_comments_writing_fkey: FOREIGN KEY (submission_id) REFERENCES submission_writing(submission_id) ON DELETE CASCADE | writing_draft_assessment_fkey: FOREIGN KEY (assessment_id, course_id) REFERENCES assessment(id, course_id) ON DELETE CASCADE | writing_draft_chars_check: CHECK (((chars >= 0) AND (chars <= 60000) AND (chars = length(plain)))) | writing_draft_enrollment_fkey: FOREIGN KEY (enrollment_id, course_id) REFERENCES enrollment(id, course_id) ON DELETE CASCADE | writing_draft_pkey: PRIMARY KEY (enrollment_id, assessment_id) | writing_draft_rev_check: CHECK ((rev >= 1)) | writing_draft_rule: CHECK (((plain COLLATE "C") = (_writing_plain(body) COLLATE "C"))) | writing_draft_size_check: CHECK ((octet_length((body)::text) <= 600000))'
            -- FINGERPRINTS-END
       ) then
        _bad := _bad || 'the three tables'' constraints are not as written'::text;
    end if;
    if (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'student_submit.write_log'::regclass and conname = 'write_log_kind_check')
       <> 'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text, ''writing''::text])))' then
        _bad := _bad || 'write_log_kind_check is not as written'::text;
    end if;
    if cardinality(_bad) > 0 then
        raise exception 'The last check found: %. Nothing was changed.', array_to_string(_bad, '; ');
    end if;
end
$lastcheck$;

notify pgrst, 'reload schema';

commit;
