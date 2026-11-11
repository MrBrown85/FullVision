-- Card codes the database cannot read (2026-11-10). S3-M1.
-- The owner's ruling 63 of Nov 10 ("the stronger fix, built now") and his
-- answers 64 to 68: eight-character card codes, a replaced card says so, a
-- card number. Design: card-codes-design.md; the contract with the edge
-- functions: card-codes-contract.md.
--
-- THIS FILE DELETES DATA (project rule 2: the owner reviews it). Every card
-- that exists is stopped and its code and password are erased. They cannot
-- be brought back, by the undo or by anyone. On 2026-11-10 that is 30 cards
-- in one class, the owner's test class.
--
-- ── What was wrong ──────────────────────────────────────────────────────────
-- Batch A (2026110903) kept each student card's code readable in
-- student_card.code, so a teacher could show or reprint a card, with a
-- salted SHA-256 beside it (code_hash, salt) and the card password in
-- student_card.password. Anyone holding a copy of the database (a leaked
-- backup, a stolen database password, an injection bug) could read every
-- code and password straight off the table. The hash was no protection
-- either: its salt is in the same row, and a code is short, so every code
-- could be worked out from the hash alone in seconds. A card lasts a
-- semester and opens a student's grades.
--
-- ── What it becomes ─────────────────────────────────────────────────────────
-- The database stores a TAG of each code and never the code: a keyed
-- fingerprint that can only be made with a secret key. The key lives in the
-- edge functions' settings (STUDENT_CARD_KEY) and is never sent here. The
-- edge functions make the tags; this database only stores and compares
-- them. It has no key and makes no tag: nothing in this file, and no
-- function it creates, can turn a code into a tag or a tag into a code. So
-- a copy of the database, without the key, gives no code and no way to test
-- a guess.
--   The teacher-cards function draws each new code and password, sends
--     their tags here (student_submit.issue_cards), and hands the code to
--     the teacher's browser once, to print.
--   The student-submit function tidies what a student typed or scanned,
--     makes its tag, and asks here by tag (student_submit.card,
--     verify_card).
-- A card code is now eight characters and a slip code stays six, so a card
-- and a slip can never read the same, and the two functions that draw slip
-- codes no longer need to look at cards (they could not: they would have to
-- see a card's code).
--
-- ── What it does to existing rows ───────────────────────────────────────────
-- student_card, only while its code column still exists (so only the first
-- time the file runs):
--   every live card is stopped (stopped_at = now). A stopped card never
--     opens again. Its row stays as history: when it was made, printed and
--     last opened, its wrong tries.
--   the columns code, code_hash, salt and password are dropped, and the
--     table is rewritten in the same transaction, so the old values leave
--     the table's file when the file commits instead of lingering in it
--     until rows are next rewritten. (Backups taken before this file still
--     hold them; they are codes of stopped cards.)
--   every card gets a card number, seq: 1, 2, 3 for each student in the
--     order their cards were made.
-- fv_idempotency, the same once only: the remembered answers of
--   issue_student_cards, reissue_student_card and unlock_student_card are
--   deleted. The last two remembered a whole card, code and password
--   included, for 24 hours.
-- A phone that is signed in with a card stays in student_submit's session
-- tables, but its class now answers card_stopped ("This card has been
-- replaced"), because its card is stopped.
-- Nothing else: no score, grade, Draft or Returned state, slip, class
-- setting or sign-in log row changes.
--
-- ── What it changes ─────────────────────────────────────────────────────────
-- 1. public.student_card
--      dropped   code, code_hash, salt, password; the index
--                student_card_live_code and the constraint
--                student_card_code_hash_key.
--      added     code_hmac   the code's tag: 64 hex characters, unique
--                            across every card ever made, live or stopped.
--                pw_hmac     the tag of the card's own four-digit password,
--                            kept only for a card made for a student who
--                            had no birthday and no student number then.
--                key_id      the id of the key that made the tags (8 hex
--                            characters; it gives nothing away).
--                seq         the card number.
--                Each tag column is checked to be exactly 64 hex
--                characters, so a plain code can never be stored there by
--                mistake. A live card must have a tag and a key id; no two
--                cards of one student share a number.
--      the read policy student_card_read is dropped and SELECT is revoked
--        from authenticated. Until now a teacher's browser could read its
--        own class's rows straight from the table. Nothing in the app did
--        (it uses the RPCs), and the rows now hold tags that have no reason
--        to leave the database.
-- 2. student_submit.card_key, one row: the id of the key the edge functions
--    last called with. A card made under another key cannot be recognised
--    any more; the teacher's list marks it (needs_new).
-- 3. New functions, for the edge functions only (service_role):
--      student_submit.issue_cards(p_teacher_id, p_course_id, p_items,
--                                 p_key_id, p_idempotency_key)
--        Makes cards. p_items is a list, at most 250:
--          { enrollment_id, replaces: <the card the browser believes is
--            live, or null>, candidates: [ { code_hmac, pw_hmac }, x2 ] }
--        For each student, under a lock on their live card: if the live
--        card is not the one named (another tab got there first) nothing is
--        done and the result is "changed". Otherwise the live card, if
--        any, is stopped and the new one stored, both or neither. The
--        second candidate is used if the first one's tag is already a
--        card's; if both are, the result is "failed" and the old card stays
--        live. A student who is withdrawn or not in the class: "not_found".
--        -> { replayed: false, results: [ { enrollment_id, result, and for
--             "made": card_id, seq, works_until, candidate, has_password } ] }
--        The same idempotency key again returns
--        { replayed: true, results } with no candidate, and makes nothing.
--        It never returns a tag. A request that is malformed is refused
--        whole (SQLSTATE 22023), as is a teacher id that is no teacher
--        (PT401) and a class that is not that teacher's (P0002).
--        It acts as the teacher it is given: student_submit._as_teacher sets
--        the caller's id for the transaction, so the same helpers every
--        teacher RPC uses decide ownership (fv_owns_course) and idempotency
--        (fv_idem_check, fv_idem_store). The teacher-cards function takes
--        that id from Supabase Auth's answer about the teacher's token,
--        never from the request. issue_cards puts the caller's id back as
--        it found it before it returns.
--      student_submit._as_teacher(uuid), student_submit._card_key_seen(text)
--        its helpers. Nobody is granted them.
-- 4. Replaced, with NEW ARGUMENT LISTS on purpose, so an old edge function
--    calling this database, or a new one calling a database without this
--    file, fails with an error and opens nothing:
--      student_submit._card_lookup(p_code_hmac, p_key_id, p_ip_hash)
--      student_submit.card(p_code_hmac, p_key_id, p_ip_hash)
--      student_submit.verify_card(p_code_hmac, p_key_id, p_birthday,
--          p_student_number, p_password_hmac, p_session_token, p_ip_hash,
--          p_add)
--    card and verify_card answer exactly as Batch A's did, with one more
--    refusal: card_stopped for a stopped card (it was not_found). It is
--    logged with the card's id and is not counted as a guess. An unknown
--    tag is still logged not_found and counts toward the address's 300 in
--    15 minutes. The locks are unchanged: five wrong answers in a row, or
--    fifteen in 7 days. The password is checked by its tag only; a birthday
--    and a student number are checked here as before.
--    A tag or key id that is not the right shape is the caller's bug, not a
--    guess: the call fails (22023) and nothing is logged.
-- 5. public._student_card_json(uuid), replaced: no code and no password. It
--    gains seq, has_password (the card has a password of its own) and
--    needs_new (made under a key other than the one last seen).
--    list_student_cards and unlock_student_card are not touched and return
--    the new shape. mark_student_cards_printed, unlock_all_student_cards and
--    set_cards_work_until are not touched.
-- 6. Dropped: public.issue_student_cards(uuid, uuid[], uuid),
--    public.reissue_student_card(uuid, uuid),
--    public._issue_student_card(uuid, text), and the old
--    student_submit._card_lookup(text, text), card(text, text) and
--    verify_card(text, text, text, text, text, text, boolean).
-- 7. public._issue_access_code and public._issue_report_code (they draw
--    slip codes), patched in place: the two lines Batch A added to each are
--    taken out again. They read student_card.code, which is gone, so with
--    them left in every new slip would fail. Both are then checked to be
--    exactly their definitions from before Batch A (fingerprints
--    1c4eab088284f90c919d07ba35ffc14d and 020cb811d2214dd5866cc2cf4ab705eb).
--
-- Functions this file leaves callable by signed-in teachers through the
-- API: none new. Two fewer (issue_student_cards, reissue_student_card).
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless:
--   Batch A, S0-M5 (2026111002) and S0-M4b (2026110905) are applied;
--   each function it drops, replaces or patches is exactly the definition
--     it was written against (md5 of pg_get_functiondef on PostgreSQL 17;
--     18 prints the same). The fingerprints are of what Batch A's files
--     create, and are compared with the live database, read-only, before
--     the apply (migrations/local-test/s3-m1-live-precheck.sql):
--       public._issue_access_code(uuid,uuid,timestamptz)   42c79553ae6e6900e0e37832ba935405
--       public._issue_report_code(uuid,uuid,timestamptz)   3b565e62a12f2a94c90cc59478696e83
--       public._issue_student_card(uuid,text)              ceba59edd2d1cfa8e7f9d7d00fb28a2b
--       public.issue_student_cards(uuid,uuid[],uuid)       c232b59d73face32b8cc49dcbc5c6048
--       public.reissue_student_card(uuid,uuid)             4633758e69cddd816214f165b62fb550
--       public._student_card_json(uuid)                    1daf8f4df98a9fc57fa71a161b490e21
--       student_submit._card_lookup(text,text)             5ff7456a4b6f33a9cb444f78b1f3f19b
--       student_submit.card(text,text)                     54c166d2ca9b032712bbec0f1f9923c5
--       student_submit.verify_card(text,text,text,text,text,text,boolean)
--                                                          57a97ea23e11f6768e32f371242ddfb4
--   no other function, in any schema, names student_card: one the repo does
--     not know about might read a column this file drops, and would then
--     fail when next called;
--   the functions it relies on exist, and the caller's id set the way
--     _as_teacher sets it is what auth.uid() then answers.
-- On a second run the code column is gone, and the same checks ask instead
-- that every function is exactly as this file leaves it:
--       public._issue_access_code(uuid,uuid,timestamptz)   1c4eab088284f90c919d07ba35ffc14d
--       public._issue_report_code(uuid,uuid,timestamptz)   020cb811d2214dd5866cc2cf4ab705eb
--       public._student_card_json(uuid)                    bba8282f322ad6913ecca134c24d5cfa
--       student_submit._as_teacher(uuid)                   a478e6e00d91742951036fcec250ae0d
--       student_submit._card_key_seen(text)                455da128c868ae4c67f9ef1ee2c0a125
--       student_submit._card_lookup(text,text,text)        b35a926e60a39330f8851d368acec7e6
--       student_submit.card(text,text,text)                253b34cd5da404aca98806f6d334f277
--       student_submit.verify_card(text,text,text,text,text,text,text,boolean)
--                                                          add37c8bb49f28472972920561401580
--       student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)
--                                                          3662c2827078922670b5347ca37c685e
-- Its last steps check the same list again, and that every SECURITY DEFINER
-- function in public, student_submit and fv_private still names pg_temp
-- last in its search_path (S0-M5's check). If either fails, everything
-- above it is undone.
--
-- Can be run again. A second run stops no card and changes nothing: the
-- step that stops cards and drops columns runs only while the code column
-- exists (migrations/local-test/card_codes.py makes a card between two runs
-- and checks it is still live).
--
-- ── Order, and what works in between ────────────────────────────────────────
-- 1. The owner creates the key (STUDENT_CARD_KEY), in his own terminal.
-- 2. The new student-submit and the teacher-cards functions are deployed.
--    From here no card opens: the new function asks by tag, and this
--    database, without this file, has no function with those arguments.
--    Slips are untouched: the function answers not_found for a six-character
--    code without asking the database, and the page then opens the slip.
-- 3. This file. Slips still open, and new slips can be issued (the two
--    issuers are back to their bodies from before Batch A). No live card
--    exists. The site as released still calls issue_student_cards, which is
--    gone: Make Cards fails with its usual line until the release.
-- 4. The release. Make and Print works; a new card opens by its tag.
-- The step that can be undone (2: redeploy the previous function) comes
-- before the step that erases (3).
--
-- ── Locks ───────────────────────────────────────────────────────────────────
-- It takes student_card whole (ACCESS EXCLUSIVE) from its first check until
-- it commits: a card scan, the Student Cards list and Unlock wait that
-- long, well under a second for a few dozen cards. No score table, class,
-- student or slip table is locked. If a long transaction holds student_card
-- it gives up after five seconds with nothing applied: run it again.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/s3-m1-live-precheck.sql   expected: no rows from its
--   first query (every function is as tested), and the counts 30, 1, 1, 0,
--   0, any number, 1 from its second.
-- migrations/local-test/s3-m1-live-postcheck.sql  expected: no rows.
-- After the apply, as a statement of its own (it cannot run inside a
-- transaction): vacuum public.fv_idempotency; only if the pre-check counted
-- a remembered card answer (cached_card_answers above 0).
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/s3-m1-undo.sql (not a migration; proved by
-- card_codes_undo.py). It puts the table, the functions, the policy and the
-- grant back as Batch A made them. It cannot restore a code: every card is
-- left stopped and teachers make new ones. To stop cards at once without
-- it: unset STUDENT_CARD_KEY, or turn a class's Student Page off.
-- Batch A's own undo (batch-a-undo.sql, PART 2) refuses while this file is
-- applied: this file's undo goes first.
--
-- One transaction: the file opens with begin and ends with commit, so it is
-- all or nothing whether it is pasted into the SQL editor or sent through
-- apply_migration. Every check that can stop it runs first, before anything
-- is created or changed.
begin;

-- Give up after five seconds rather than queue behind a long transaction and
-- hold every card scan up behind this one. If it gives up, nothing is
-- applied: run the file again.
set local lock_timeout = '5s';

do $guard$
declare
    _f       record;
    _md5     text;
    _first   boolean;    -- true: the code column is still there, so this is the first run
    _left    text;
    _probe   uuid := gen_random_uuid();
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
begin
    -- Batch A, then S0-M5, then S0-M4b: the database this was tested on.
    if to_regclass('public.student_card') is null or to_regclass('student_submit.device_session') is null
       or to_regclass('public.grade_return') is null or to_regclass('student_submit.attempt') is null
       or to_regprocedure('public.fv_owns_score_cell(uuid,uuid)') is null then
        raise exception 'Batch A is not all applied (2026110901 to 2026110904): apply it, then this file. Nothing was changed.';
    end if;
    if to_regprocedure('public._grade_return_repair_class(uuid)') is null then
        raise exception 'S0-M4b is not applied (2026110905_grade_return_limits.sql): apply it, then this file. Nothing was changed.';
    end if;
    if exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)',
                                          'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)']) x
                where to_regprocedure(x) is null
                   or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp']) then
        raise exception 'S0-M5 is not applied (2026111002_security_definer_search_path.sql): apply it, then this file. Nothing was changed.';
    end if;
    -- The functions this file calls and does not make.
    perform 'public._cards_work_until(uuid)'::regprocedure, 'student_submit._card_refusal(uuid)'::regprocedure,
            'student_submit._log(text,text,text,uuid,uuid)'::regprocedure, 'student_submit._norm(text)'::regprocedure,
            'student_submit._midnight(text)'::regprocedure, 'student_submit._device_session(text)'::regprocedure,
            'student_submit._session_classes(uuid)'::regprocedure;

    -- Nothing else may use the table while this runs. Taken here, before the
    -- table is looked at, so what the checks below see is what is changed.
    lock table public.student_card in access exclusive mode;
    _first := exists (select 1 from pg_attribute
                       where attrelid = 'public.student_card'::regclass and attname = 'code' and not attisdropped);

    -- Every function this file drops, replaces or patches is the definition
    -- it was written against (the first run), or the one it leaves (a
    -- second run). 'absent' means it must not be there.
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)',   '42c79553ae6e6900e0e37832ba935405', '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)',   '3b565e62a12f2a94c90cc59478696e83', '020cb811d2214dd5866cc2cf4ab705eb'),
            ('public._issue_student_card(uuid,text)',              'ceba59edd2d1cfa8e7f9d7d00fb28a2b', 'absent'),
            ('public.issue_student_cards(uuid,uuid[],uuid)',       'c232b59d73face32b8cc49dcbc5c6048', 'absent'),
            ('public.reissue_student_card(uuid,uuid)',             '4633758e69cddd816214f165b62fb550', 'absent'),
            ('public._student_card_json(uuid)',                    '1daf8f4df98a9fc57fa71a161b490e21', 'bba8282f322ad6913ecca134c24d5cfa'),
            ('student_submit._card_lookup(text,text)',             '5ff7456a4b6f33a9cb444f78b1f3f19b', 'absent'),
            ('student_submit.card(text,text)',                     '54c166d2ca9b032712bbec0f1f9923c5', 'absent'),
            ('student_submit.verify_card(text,text,text,text,text,text,boolean)',
                                                                   '57a97ea23e11f6768e32f371242ddfb4', 'absent'),
            ('student_submit._as_teacher(uuid)',                   'absent', 'a478e6e00d91742951036fcec250ae0d'),
            ('student_submit._card_key_seen(text)',                'absent', '455da128c868ae4c67f9ef1ee2c0a125'),
            ('student_submit._card_lookup(text,text,text)',        'absent', 'b35a926e60a39330f8851d368acec7e6'),
            ('student_submit.card(text,text,text)',                'absent', '253b34cd5da404aca98806f6d334f277'),
            ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                                                                   'absent', 'add37c8bb49f28472972920561401580'),
            ('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)',
                                                                   'absent', '3662c2827078922670b5347ca37c685e')
        ) as v(fn, was, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _first and _md5 <> _f.was then
            raise exception '% is not the definition this migration was written against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.was;
        elsif not _first and _md5 <> _f.becomes then
            raise exception 'student_card has no code column, so this file has been applied, but % is not as it leaves it (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.becomes;
        end if;
    end loop;

    -- No function this file does not know names student_card (comments left
    -- out). One that did might read a column that is about to go.
    select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', '
                      order by n.nspname, p.proname)
      into _left
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
       and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~ '\mstudent_card\M'
       and p.oid not in (
           select to_regprocedure(x)::oid
             from unnest(array[
                 -- this file drops, replaces or patches these
                 'public._issue_access_code(uuid,uuid,timestamptz)', 'public._issue_report_code(uuid,uuid,timestamptz)',
                 'public._issue_student_card(uuid,text)', 'public.issue_student_cards(uuid,uuid[],uuid)',
                 'public.reissue_student_card(uuid,uuid)', 'public._student_card_json(uuid)',
                 'student_submit._card_lookup(text,text)', 'student_submit.card(text,text)',
                 'student_submit.verify_card(text,text,text,text,text,text,boolean)',
                 -- these read only columns that stay (read on 2026-11-10)
                 'public.list_student_cards(uuid)', 'public.mark_student_cards_printed(uuid[],uuid)',
                 'public.unlock_student_card(uuid,uuid)', 'public.unlock_all_student_cards(uuid,uuid)',
                 'public.set_cards_work_until(uuid,date,uuid)', 'student_submit._card_refusal(uuid)',
                 'student_submit._session_classes(uuid)',
                 -- and these are this file's own (a second run)
                 'student_submit._card_lookup(text,text,text)', 'student_submit.card(text,text,text)',
                 'student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                 'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)']) x
            where to_regprocedure(x) is not null);
    if _left is not null then
        raise exception 'a function this migration does not know names student_card: %. It may read a column this file drops. Nothing was changed.', _left;
    end if;

    -- issue_cards acts as a teacher by setting the caller's id for its
    -- transaction (student_submit._as_teacher, below). That works only if
    -- auth.uid() answers with an id set that way, so it is tried here with
    -- an id that belongs to nobody, and then put back.
    perform set_config('request.jwt.claim.sub', _probe::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', _probe, 'role', 'authenticated')::text, true);
    if (select auth.uid()) is distinct from _probe then
        raise exception 'auth.uid() does not answer with the caller id set in request.jwt.claim.sub and request.jwt.claims, so student_submit.issue_cards could not act as a teacher. Nothing was changed.';
    end if;
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
end
$guard$;

-- ── 1. student_card: the readable columns go, the tags come ─────────────────
-- Only while the code column exists: the first run. On a second run this
-- block does nothing, so a card made since is never stopped.
do $cards$
declare
    _stopped int;
    _cached  int;
begin
    if not exists (select 1 from pg_attribute
                    where attrelid = 'public.student_card'::regclass and attname = 'code' and not attisdropped) then
        return;
    end if;
    -- Every live card stops: its code was readable, and nothing can turn it
    -- into a tag without reading it.
    update public.student_card set stopped_at = now() where stopped_at is null;
    get diagnostics _stopped = row_count;
    -- The remembered answers of the three card calls. Two of them hold a
    -- whole card, its code and password included.
    delete from public.fv_idempotency
     where endpoint in ('issue_student_cards', 'reissue_student_card', 'unlock_student_card');
    get diagnostics _cached = row_count;
    drop index if exists public.student_card_live_code;
    alter table public.student_card drop constraint if exists student_card_code_hash_key;
    alter table public.student_card drop column code, drop column code_hash, drop column salt, drop column password;
    -- Dropping a column only hides it: the old values would stay in the
    -- table's file until each row is next rewritten and its old copy cleaned
    -- away. Rewriting the table now leaves a new file that never held them,
    -- and the old file is removed when this transaction commits. (CLUSTER is
    -- the rewrite; the second statement takes back the "keep it in this
    -- order" mark CLUSTER leaves on the index.)
    cluster public.student_card using student_card_pkey;
    alter table public.student_card set without cluster;
    raise notice 'S3-M1: % live cards stopped; % remembered card answers deleted', _stopped, _cached;
end
$cards$;

alter table public.student_card
    add column if not exists code_hmac text constraint student_card_code_hmac_check check (code_hmac ~ '^[0-9a-f]{64}$'),
    add column if not exists pw_hmac   text constraint student_card_pw_hmac_check check (pw_hmac ~ '^[0-9a-f]{64}$'),
    add column if not exists key_id    text constraint student_card_key_id_check check (key_id ~ '^[0-9a-f]{8}$'),
    add column if not exists seq       smallint constraint student_card_seq_check check (seq >= 1);

-- The card number: each student's cards count 1, 2, 3 in the order they were
-- made. Only rows that have none, so only the first run; it writes every row
-- there is after the columns above were dropped.
update public.student_card k
   set seq = n.seq
  from (select id, row_number() over (partition by enrollment_id order by created_at, id) as seq
          from public.student_card) n
 where n.id = k.id and k.seq is null;
alter table public.student_card alter column seq set not null;

-- One card per tag, across every card ever made, live or stopped: a code
-- that was once a card's is never issued again.
create unique index if not exists student_card_code_hmac_key on public.student_card (code_hmac);
-- No two cards of one student share a number.
create unique index if not exists student_card_enrollment_seq on public.student_card (enrollment_id, seq);
do $live$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.student_card'::regclass and conname = 'student_card_live_has_tag') then
        -- A card that can open has a tag to be found by and a key id.
        alter table public.student_card add constraint student_card_live_has_tag
            check (stopped_at is not null or (code_hmac is not null and key_id is not null));
    end if;
end
$live$;

comment on table public.student_card is
    'A student''s printed card for one class. One live card per enrollment; a new card stops the old one and keeps its row. Holds a keyed tag of the code, never the code.';
comment on column public.student_card.code_hmac is
    'The tag of the card''s code, made by the edge functions with a key this database does not have. Null on a card from before 2026111003.';
comment on column public.student_card.pw_hmac is
    'The tag of the card''s own four-digit password; null when the student had a birthday or student number on file when the card was made.';
comment on column public.student_card.key_id is
    'The id of the key that made the tags (the first 8 hex characters of a tag of a fixed label).';
comment on column public.student_card.seq is
    'The card number: this student''s first, second, third card. Printed on the card; no part of the code.';

-- Nobody reads the table through the API any more: the teacher's screens
-- use list_student_cards, and a tag has no reason to leave the database.
drop policy if exists student_card_read on public.student_card;
revoke all on table public.student_card from public, anon, authenticated;

-- ── 2. The key the edge functions last called with ──────────────────────────
create table if not exists student_submit.card_key (
    one     boolean     primary key default true constraint card_key_one_row check (one),
    key_id  text        not null constraint card_key_key_id_check check (key_id ~ '^[0-9a-f]{8}$'),
    seen_at timestamptz not null default now()
);
comment on table student_submit.card_key is
    'One row: the id of the card key the edge functions last called with. Not the key. A card made under another key id cannot be recognised and needs a new card.';
alter table student_submit.card_key enable row level security;
revoke all on table student_submit.card_key from public, anon, authenticated;

-- Remembers the key id a call came with. It writes only when the id is new,
-- so an ordinary card scan reads one row here and writes none.
create or replace function student_submit._card_key_seen(p_key_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
begin
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    if exists (select 1 from card_key where key_id = p_key_id) then
        return;
    end if;
    insert into card_key (one, key_id) values (true, p_key_id)
    on conflict (one) do update set key_id = excluded.key_id, seen_at = now()
     where card_key.key_id <> excluded.key_id;
end;
$function$;

-- ── 3. One card as the teacher's screens read it: no code, no password ──────
create or replace function public._student_card_json(p_card_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
    select jsonb_build_object(
               'id', k.id, 'enrollment_id', k.enrollment_id, 'seq', k.seq,
               'created_at', k.created_at, 'printed_at', k.printed_at, 'last_opened_at', k.last_opened_at,
               'locked_at', k.locked_at, 'wrong_tries', k.wrong_tries,
               'wrong_tries_7d', (select count(*) from unnest(k.wrong_times) t where t > now() - interval '7 days'),
               'works_until', k.works_until,
               'check', case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null
                             then 'identity' else 'password' end,
               -- the card has a password of its own (printed on it once; only its tag is kept)
               'has_password', k.pw_hmac is not null,
               -- made under a key other than the one the edge functions last called with
               'needs_new', k.key_id is distinct from coalesce((select x.key_id from student_submit.card_key x), k.key_id))
      from student_card k
      join enrollment e on e.id = k.enrollment_id
      join student s on s.id = e.student_id
     where k.id = p_card_id;
$function$;
revoke all on function public._student_card_json(uuid) from public, anon, authenticated;

-- ── 4. The old ways in go ───────────────────────────────────────────────────
-- Each read or wrote a column that is gone. The teacher's two are replaced
-- by student_submit.issue_cards, which only the teacher-cards edge function
-- can call; the student path's three by the same names with new arguments.
drop function if exists public.issue_student_cards(uuid, uuid[], uuid);
drop function if exists public.reissue_student_card(uuid, uuid);
drop function if exists public._issue_student_card(uuid, text);
drop function if exists student_submit.card(text, text);
drop function if exists student_submit.verify_card(text, text, text, text, text, text, boolean);
drop function if exists student_submit._card_lookup(text, text);

-- ── 5. A new slip no longer looks at cards ──────────────────────────────────
-- Batch A (2026110903) added two lines to each of the two functions that
-- draw slip codes: draw again when the code is a live card's. A card is
-- eight characters now and a slip six, so they cannot read the same, and
-- the lines read a column that is gone. Each edit is made backwards.
do $unpatch$
declare
    _f   record;
    _def text;
    _old constant text := $s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt));$s$;
    _new constant text := $s$        continue when exists (
            select 1 from student_access_code
             where revoked_at is null and expires_at > now()
               and code_hash = _access_code_hash(_code, salt))
            -- nor the code of a live student card (2026110903_student_card)
            or exists (select 1 from student_card where stopped_at is null and code = _code);$s$;
begin
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)'),
            ('public._issue_report_code(uuid,uuid,timestamptz)')
        ) as v(fn)
    loop
        _def := pg_get_functiondef(_f.fn::regprocedure);
        continue when position('live student card' in _def) = 0;  -- a second run
        if (length(_def) - length(replace(_def, _new, ''))) / length(_new) <> 1 then
            raise exception '% does not hold the lines Batch A added', _f.fn;
        end if;
        execute replace(_def, _new, _old);
    end loop;
end
$unpatch$;

-- ── 6. Acting as the teacher the edge function names ────────────────────────
-- Sets the caller's id for the rest of the transaction, the way the API
-- sets it for a signed-in teacher, so fv_owns_course, fv_owns_enrollment,
-- fv_idem_check and fv_idem_store answer for that teacher. Refuses an id
-- that is no teacher. Called only by issue_cards; granted to nobody.
create or replace function student_submit._as_teacher(p_teacher_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
begin
    if p_teacher_id is null
       or not exists (select 1 from teacher t where t.id = p_teacher_id and t.deleted_at is null) then
        raise exception 'not a teacher' using errcode = 'PT401';
    end if;
    perform set_config('request.jwt.claim.sub', p_teacher_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_teacher_id, 'role', 'authenticated')::text, true);
end;
$function$;

-- ── 7. issue_cards ──────────────────────────────────────────────────────────
create or replace function student_submit.issue_cards(
    p_teacher_id uuid, p_course_id uuid, p_items jsonb, p_key_id text, p_idempotency_key uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    _hex64   constant text := '^[0-9a-f]{64}$';
    _was_sub text := current_setting('request.jwt.claim.sub', true);
    _was_all text := current_setting('request.jwt.claims', true);
    _cached  jsonb;
    _item    record;
    _cand    jsonb;
    _until   date;
    _live    uuid;
    _made    uuid;
    _seq     int;
    _pick    int;
    _has_pw  boolean;
    _con     text;
    _one     jsonb;
    _by_pos  jsonb := '{}'::jsonb;   -- each student's result, by its place in p_items
    _results jsonb;
begin
    -- The request's shape, before anything is read or changed. A tag is 64
    -- lower-case hex characters and nothing else: a code can never arrive
    -- where a tag goes.
    if coalesce(p_key_id, '') !~ '^[0-9a-f]{8}$' then
        raise exception 'malformed key id' using errcode = '22023';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'items must be a list' using errcode = '22023';
    end if;
    if jsonb_array_length(p_items) > 250 then
        raise exception 'at most 250 students in one request' using errcode = '22023';
    end if;
    for _item in select t.i, t.ord from jsonb_array_elements(p_items) with ordinality as t(i, ord) loop
        if jsonb_typeof(_item.i) <> 'object'
           or jsonb_typeof(_item.i->'enrollment_id') is distinct from 'string' or _item.i->>'enrollment_id' !~ _uuid
           or not (_item.i->'replaces' is null or jsonb_typeof(_item.i->'replaces') = 'null'
                   or (jsonb_typeof(_item.i->'replaces') = 'string' and _item.i->>'replaces' ~ _uuid))
           or jsonb_typeof(_item.i->'candidates') is distinct from 'array' then
            raise exception 'item % is malformed', _item.ord using errcode = '22023';
        end if;
        if jsonb_array_length(_item.i->'candidates') <> 2 then
            raise exception 'item % must have exactly two candidates', _item.ord using errcode = '22023';
        end if;
        for _cand in select c from jsonb_array_elements(_item.i->'candidates') c loop
            if jsonb_typeof(_cand) <> 'object'
               or jsonb_typeof(_cand->'code_hmac') is distinct from 'string' or _cand->>'code_hmac' !~ _hex64
               or jsonb_typeof(_cand->'pw_hmac') is distinct from 'string' or _cand->>'pw_hmac' !~ _hex64 then
                raise exception 'item % has a candidate that is not two tags', _item.ord using errcode = '22023';
            end if;
        end loop;
    end loop;
    if (select count(distinct lower(i->>'enrollment_id')) from jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) then
        raise exception 'a student is named twice' using errcode = '22023';
    end if;
    if (select count(distinct c->>'code_hmac') from jsonb_array_elements(p_items) i, jsonb_array_elements(i->'candidates') c)
       <> 2 * jsonb_array_length(p_items) then
        raise exception 'a code tag is given twice' using errcode = '22023';
    end if;

    -- From here on, as that teacher: ownership and idempotency are the same
    -- helpers every teacher RPC uses.
    perform _as_teacher(p_teacher_id);
    if not fv_owns_course(p_course_id) then
        raise exception 'course not found' using errcode = 'P0002';
    end if;
    -- A replay returns what the first call said of each student and makes
    -- nothing. It cannot return a code or which candidate was used: the
    -- first call's answer is stored without them, and no code was ever here.
    _cached := fv_idem_check(p_idempotency_key, 'issue_cards');
    if _cached is not null then
        perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
        return jsonb_build_object('replayed', true, 'results', _cached->'results');
    end if;
    perform _card_key_seen(p_key_id);
    _until := _cards_work_until(p_course_id);

    -- One student at a time, in the order of their ids whatever order the
    -- request lists them in, so two requests never wait on each other's
    -- students.
    for _item in
        select t.ord, (t.i->>'enrollment_id')::uuid as enrollment_id, (t.i->>'replaces')::uuid as replaces, t.i->'candidates' as candidates
          from jsonb_array_elements(p_items) with ordinality as t(i, ord)
         order by (t.i->>'enrollment_id')::uuid
    loop
        _one := jsonb_build_object('enrollment_id', _item.enrollment_id);
        if not exists (select 1 from enrollment e
                        where e.id = _item.enrollment_id and e.course_id = p_course_id and e.withdrawn_at is null) then
            -- not in this class, or withdrawn
            _one := _one || jsonb_build_object('result', 'not_found');
        else
            -- The block is all or nothing: if no new card can be stored, the
            -- stop of the old one is undone with it.
            begin
                -- The student's live card, locked. A request that named the
                -- same card and got here second waits, then finds it stopped.
                select k.id into _live from student_card k
                 where k.enrollment_id = _item.enrollment_id and k.stopped_at is null
                   for update;
                if _live is distinct from _item.replaces then
                    -- Not the card the browser believed was live (another
                    -- tab made or replaced one first): nothing is done.
                    _one := _one || jsonb_build_object('result', 'changed');
                else
                    if _live is not null then
                        update student_card set stopped_at = now() where id = _live;
                    end if;
                    select coalesce(max(k.seq), 0) + 1 into _seq from student_card k where k.enrollment_id = _item.enrollment_id;
                    -- A password of the card's own only for a student with
                    -- nothing else to answer "Is This You?" with right now.
                    _has_pw := exists (select 1 from enrollment e join student s on s.id = e.student_id
                                        where e.id = _item.enrollment_id and s.date_of_birth is null
                                          and nullif(btrim(s.student_number), '') is null);
                    _made := null;
                    for _try in 0..1 loop
                        begin
                            insert into student_card (enrollment_id, code_hmac, pw_hmac, key_id, seq, works_until)
                            values (_item.enrollment_id, _item.candidates->_try->>'code_hmac',
                                    case when _has_pw then _item.candidates->_try->>'pw_hmac' end,
                                    p_key_id, _seq, _until)
                            returning id into _made;
                            _pick := _try;   -- which candidate was stored: the function returns its code
                            exit;
                        exception when unique_violation then
                            get stacked diagnostics _con = constraint_name;
                            if _con is distinct from 'student_card_code_hmac_key' then
                                -- The student got a live card from another
                                -- request in the meantime.
                                raise exception 'another request made this card' using errcode = 'FVC01';
                            end if;
                            -- That tag is already a card's: try the other candidate.
                        end;
                    end loop;
                    if _made is null then
                        raise exception 'both candidates are taken' using errcode = 'FVC02';
                    end if;
                    _one := _one || jsonb_build_object(
                        'result', 'made', 'card_id', _made, 'seq', _seq, 'works_until', _until,
                        'candidate', _pick, 'has_password', _has_pw);
                end if;
            exception
                when sqlstate 'FVC01' then
                    _one := jsonb_build_object('enrollment_id', _item.enrollment_id, 'result', 'changed');
                when sqlstate 'FVC02' then
                    _one := jsonb_build_object('enrollment_id', _item.enrollment_id, 'result', 'failed');
            end;
        end if;
        _by_pos := _by_pos || jsonb_build_object(_item.ord::text, _one);
    end loop;

    -- In the order of the request.
    select coalesce(jsonb_agg(_by_pos->(t.ord::text) order by t.ord), '[]'::jsonb) into _results
      from jsonb_array_elements(p_items) with ordinality as t(i, ord);
    -- What a replay returns: the same, without which candidate was used.
    perform fv_idem_store(p_idempotency_key, 'issue_cards',
                          jsonb_build_object('results', (select coalesce(jsonb_agg(r - 'candidate' order by n), '[]'::jsonb)
                                                           from jsonb_array_elements(_results) with ordinality as x(r, n))));
    perform set_config('request.jwt.claim.sub', coalesce(_was_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(_was_all, ''), true);
    return jsonb_build_object('replayed', false, 'results', _results);
end;
$function$;

-- ── 8. A tag to its card, behind the limits ─────────────────────────────────
-- Returns { card_id } or { error }. The caller is the student-submit edge
-- function, which has already turned what the student typed into a tag.
create or replace function student_submit._card_lookup(p_code_hmac text, p_key_id text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _k   student_card%rowtype;
    _why text;
begin
    -- A tag is 64 lower-case hex characters. Anything else is a bug in the
    -- caller, not a student's guess: fail, and log nothing.
    if coalesce(p_code_hmac, '') !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed code tag' using errcode = '22023';
    end if;
    perform _card_key_seen(p_key_id);

    -- Housekeeping on every scan, each an index range that is nearly always
    -- empty: sessions past their midnight, and log rows past 30 days (a
    -- slip's open() does the same for the log, one scan in fifty).
    delete from device_session where expires_at < now();
    delete from attempt where at < now() - interval '30 days';

    -- A school's students share one address, so the limit is generous and
    -- counts only codes that were not found (a guess).
    if (select count(*) from attempt
         where ip_hash = p_ip_hash and route = 'card' and outcome in ('not_found', 'bad_format', 'ambiguous')
           and at > now() - interval '15 minutes') >= 300 then
        perform _log('card', 'locked', p_ip_hash);
        return jsonb_build_object('error', 'locked');
    end if;

    -- The card with this tag, live or stopped, through the unique index on
    -- tags: one row read, however many cards there are.
    select * into _k from student_card where code_hmac = p_code_hmac;
    if _k.id is null then
        perform _log('card', 'not_found', p_ip_hash);
        return jsonb_build_object('error', 'not_found');
    end if;

    -- A stopped card says so (card_stopped). It is a real card that was
    -- replaced, not a guess, so it is logged with its id and counts toward
    -- no limit.
    _why := _card_refusal(_k.id);
    if _why is not null then
        perform _log('card', _why, p_ip_hash, _k.id,
                     (select e.course_id from enrollment e where e.id = _k.enrollment_id));
        return jsonb_build_object('error', _why);
    end if;
    if _k.locked_at is not null then
        perform _log('card', 'card_locked', p_ip_hash, _k.id,
                     (select e.course_id from enrollment e where e.id = _k.enrollment_id));
        return jsonb_build_object('error', 'card_locked');
    end if;
    return jsonb_build_object('card_id', _k.id);
end;
$function$;

-- ── 9. card ─────────────────────────────────────────────────────────────────
create or replace function student_submit.card(p_code_hmac text, p_key_id text, p_ip_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _found  jsonb := _card_lookup(p_code_hmac, p_key_id, p_ip_hash);
    _card   uuid := (_found->>'card_id')::uuid;
    _course course%rowtype;
    _name   text;
    _by     text;
    _pw     boolean;
begin
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select c.* into _course
      from student_card k join enrollment e on e.id = k.enrollment_id join course c on c.id = e.course_id
     where k.id = _card;
    -- What the student must prove, as a questionnaire slip asks it.
    select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name),
           case when s.date_of_birth is not null or nullif(btrim(s.student_number), '') is not null then 'identity'
                when k.pw_hmac is not null then 'password' end,
           k.pw_hmac is not null
      into _name, _by, _pw
      from student_card k join enrollment e on e.id = k.enrollment_id join student s on s.id = e.student_id
     where k.id = _card;
    if _by is null then
        perform _log('card', 'no_identity', p_ip_hash, _card, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    perform _log('card', 'ok', p_ip_hash, _card, _course.id);
    return jsonb_build_object(
        'ok', true, 'kind', 'card',
        'student', jsonb_build_object('first_name', _name),
        'course', jsonb_build_object('name', _course.name, 'block', _course.block),
        'check', _by,
        'also_password', _by = 'identity' and _pw);
end;
$function$;

-- ── 10. verify_card (also add-card) ─────────────────────────────────────────
create or replace function student_submit.verify_card(
    p_code_hmac text, p_key_id text, p_birthday text, p_student_number text, p_password_hmac text,
    p_session_token text, p_ip_hash text, p_add boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _found   jsonb;
    _card    uuid;
    _k       student_card%rowtype;
    _course  course%rowtype;
    _dob     date;
    _num     text;
    _given   date;
    _session device_session%rowtype;
    _token   text;
    _ends    timestamptz;
    _row     int;
    _week    int;
begin
    -- The password arrives as its tag (made from the card's code and the
    -- four digits typed), or null when none was typed. Never the digits.
    if p_password_hmac is not null and p_password_hmac !~ '^[0-9a-f]{64}$' then
        raise exception 'malformed password tag' using errcode = '22023';
    end if;
    _found := _card_lookup(p_code_hmac, p_key_id, p_ip_hash);
    _card := (_found->>'card_id')::uuid;
    if _card is null then
        return jsonb_build_object('ok', false, 'error', _found->>'error');
    end if;
    select * into _k from student_card where id = _card for update;
    if _k.locked_at is not null or _k.stopped_at is not null then
        -- Locked or replaced while this call waited for the row.
        return jsonb_build_object('ok', false, 'error', case when _k.stopped_at is not null then 'card_stopped' else 'card_locked' end);
    end if;
    select c.* into _course from enrollment e join course c on c.id = e.course_id where e.id = _k.enrollment_id;

    -- The card's own password: one printed on this card still works after a
    -- birthday or number is added, whatever is printed for the student later.
    select s.date_of_birth, nullif(_norm(s.student_number), '')
      into _dob, _num
      from enrollment e join student s on s.id = e.student_id
     where e.id = _k.enrollment_id;
    if _dob is null and _num is null and _k.pw_hmac is null then
        -- Nothing on file to check against: no try is counted. card() says the same.
        perform _log('card', 'no_identity', p_ip_hash, _k.id, _course.id);
        return jsonb_build_object('ok', false, 'error', 'reprint');
    end if;
    begin
        _given := nullif(btrim(coalesce(p_birthday, '')), '')::date;
    exception when others then
        _given := null;
    end;

    if not coalesce((_dob is not null and _given is not null and _given = _dob)
                 or (_num is not null and _norm(p_student_number) = _num)
                 or (_k.pw_hmac is not null and p_password_hmac is not null and p_password_hmac = _k.pw_hmac), false) then
        -- Five wrong tries in a row lock it (a right answer starts that
        -- count again), and so do fifteen inside 7 days whatever came
        -- between. "Tries left" is the nearer of the two, so it is always true.
        update student_card
           set wrong_tries = wrong_tries + 1,
               wrong_times = array(select t from unnest(wrong_times) t where t > clock_timestamp() - interval '7 days')
                             || clock_timestamp()
         where id = _k.id
        returning wrong_tries, cardinality(wrong_times) into _row, _week;
        perform _log('card', 'wrong_identity', p_ip_hash, _k.id, _course.id);
        if _row >= 5 or _week >= 15 then
            update student_card set locked_at = now() where id = _k.id;
            return jsonb_build_object('ok', false, 'error', 'card_locked');
        end if;
        return jsonb_build_object('ok', false, 'error', 'wrong_identity', 'tries_left', least(5 - _row, 15 - _week));
    end if;

    -- Matched. From the start screen that is a fresh session: whoever was
    -- signed in on this device is signed out. Only Add Another Card (p_add)
    -- joins the session the device has.
    _ends := _midnight(_course.timezone);
    select * into _session from _device_session(p_session_token);
    if _session.id is not null and not coalesce(p_add, false) then
        delete from device_session where id = _session.id;
        _session := null;
    end if;
    if _session.id is null then
        _token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
        insert into device_session (token_hash, expires_at)
        values (encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _ends)
        returning * into _session;
    elsif _ends < _session.expires_at then
        update device_session set expires_at = _ends where id = _session.id returning * into _session;
    end if;
    insert into device_session_enrollment (session_id, enrollment_id, card_id)
    values (_session.id, _k.enrollment_id, _k.id)
    on conflict (session_id, enrollment_id) do update set card_id = excluded.card_id;
    update student_card set last_opened_at = now(), wrong_tries = 0 where id = _k.id;

    perform _log('card', 'verified', p_ip_hash, _k.id, _course.id);
    return jsonb_build_object(
        'ok', true, 'session_token', _token, 'expires_at', _session.expires_at,
        'enrollment_id', _k.enrollment_id, 'classes', _session_classes(_session.id));
end;
$function$;

-- Service role only, as every function in the schema is. The helpers are
-- granted to nobody: they are called by the functions above, as their owner.
revoke all on function student_submit._card_key_seen(text) from public, anon, authenticated;
revoke all on function student_submit._as_teacher(uuid) from public, anon, authenticated;
revoke all on function student_submit._card_lookup(text, text, text) from public, anon, authenticated;
revoke all on function student_submit.card(text, text, text) from public, anon, authenticated;
revoke all on function student_submit.verify_card(text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function student_submit.issue_cards(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function student_submit.card(text, text, text) to service_role;
grant execute on function student_submit.verify_card(text, text, text, text, text, text, text, boolean) to service_role;
grant execute on function student_submit.issue_cards(uuid, uuid, jsonb, text, uuid) to service_role;

-- ── Everything is as the header says ────────────────────────────────────────
do $final$
declare
    _f    record;
    _md5  text;
    _left text;
begin
    for _f in
        select * from (values
            ('public._issue_access_code(uuid,uuid,timestamptz)',   '1c4eab088284f90c919d07ba35ffc14d'),
            ('public._issue_report_code(uuid,uuid,timestamptz)',   '020cb811d2214dd5866cc2cf4ab705eb'),
            ('public._issue_student_card(uuid,text)',              'absent'),
            ('public.issue_student_cards(uuid,uuid[],uuid)',       'absent'),
            ('public.reissue_student_card(uuid,uuid)',             'absent'),
            ('public._student_card_json(uuid)',                    'bba8282f322ad6913ecca134c24d5cfa'),
            ('student_submit._card_lookup(text,text)',             'absent'),
            ('student_submit.card(text,text)',                     'absent'),
            ('student_submit.verify_card(text,text,text,text,text,text,boolean)', 'absent'),
            ('student_submit._as_teacher(uuid)',                   'a478e6e00d91742951036fcec250ae0d'),
            ('student_submit._card_key_seen(text)',                '455da128c868ae4c67f9ef1ee2c0a125'),
            ('student_submit._card_lookup(text,text,text)',        'b35a926e60a39330f8851d368acec7e6'),
            ('student_submit.card(text,text,text)',                '253b34cd5da404aca98806f6d334f277'),
            ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                                                                   'add37c8bb49f28472972920561401580'),
            ('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)',
                                                                   '3662c2827078922670b5347ca37c685e')
        ) as v(fn, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.becomes then
            raise exception '% is not as this migration should leave it (found %, expected %). Nothing was changed.', _f.fn, _md5, _f.becomes;
        end if;
    end loop;
    if exists (select 1 from pg_attribute
                where attrelid = 'public.student_card'::regclass and not attisdropped
                  and attname in ('code', 'code_hash', 'salt', 'password')) then
        raise exception 'student_card still has a readable column. Nothing was changed.';
    end if;
    -- S0-M5's check: no SECURITY DEFINER function in the app's three schemas
    -- is left without pg_temp last in its search_path.
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
        raise exception 'SECURITY DEFINER without pg_temp last in its search_path: %. Nothing was changed.', _left;
    end if;
end
$final$;

notify pgrst, 'reload schema';

commit;
