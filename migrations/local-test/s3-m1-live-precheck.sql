-- S3-M1, BEFORE THE APPLY. Read-only: two queries for gradebook-prod, to run
-- just before migrations/2026111003_card_codes_keyed.sql is applied. Neither
-- changes anything. Run each by itself (QUERY 1, then QUERY 2).
-- migrations/local-test/card_codes.py runs both on the local stand-in.
--
-- ── QUERY 1: is the database what the migration was tested on? ──────────────
-- Expected: NO ROWS. Each row is one thing that differs, with what was
-- tested, what was found, and whether the migration would stop on it:
--   stops = 'yes'  the migration's own first check refuses it, with nothing
--                  changed. Do not apply; find out why it differs.
--   stops = 'no'   the migration would still apply, but something it relies
--                  on is not the definition the tests ran against. Read it
--                  before applying.
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11 (18.6 prints the same): what Batch A's files, S0-M5
-- and S0-M4b create.
with expected(fn, md5, stops) as (values
    -- the nine functions the migration drops, replaces or patches
    ('public._issue_access_code(uuid,uuid,timestamptz)',                      '42c79553ae6e6900e0e37832ba935405', 'yes'),
    ('public._issue_report_code(uuid,uuid,timestamptz)',                      '3b565e62a12f2a94c90cc59478696e83', 'yes'),
    ('public._issue_student_card(uuid,text)',                                 'ceba59edd2d1cfa8e7f9d7d00fb28a2b', 'yes'),
    ('public.issue_student_cards(uuid,uuid[],uuid)',                          'c232b59d73face32b8cc49dcbc5c6048', 'yes'),
    ('public.reissue_student_card(uuid,uuid)',                                '4633758e69cddd816214f165b62fb550', 'yes'),
    ('public._student_card_json(uuid)',                                       '1daf8f4df98a9fc57fa71a161b490e21', 'yes'),
    ('student_submit._card_lookup(text,text)',                                '5ff7456a4b6f33a9cb444f78b1f3f19b', 'yes'),
    ('student_submit.card(text,text)',                                        '54c166d2ca9b032712bbec0f1f9923c5', 'yes'),
    ('student_submit.verify_card(text,text,text,text,text,text,boolean)',     '57a97ea23e11f6768e32f371242ddfb4', 'yes'),
    -- the six it makes: none may be there yet
    ('student_submit._as_teacher(uuid)',                                      'absent', 'yes'),
    ('student_submit._card_key_seen(text)',                                   'absent', 'yes'),
    ('student_submit._card_lookup(text,text,text)',                           'absent', 'yes'),
    ('student_submit.card(text,text,text)',                                   'absent', 'yes'),
    ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)', 'absent', 'yes'),
    ('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)',                 'absent', 'yes'),
    -- what it calls or leaves in place, as the tests ran against them
    ('public.fv_owns_course(uuid)',                                           'e3afeca06043a6e907e6f4ae777c85da', 'no'),
    ('public.fv_owns_enrollment(uuid)',                                       '728526648388367393162be706f7f9ea', 'no'),
    ('public.fv_idem_check(uuid,text)',                                       '1c7b546434bee4b774557e0e6b16024f', 'no'),
    ('public.fv_idem_store(uuid,text,jsonb)',                                 '6d0b48c458d273a332db39e1a4b68626', 'no'),
    ('public._cards_work_until(uuid)',                                        '258317511f7b190e41f62a9570c9b7b7', 'no'),
    ('public.list_student_cards(uuid)',                                       'e05b6c25e7fbd872bbfcb5f163b6a160', 'no'),
    ('public.mark_student_cards_printed(uuid[],uuid)',                        '2ee4ab4fe90971e69d1ee8083c3a9aa3', 'no'),
    ('public.unlock_student_card(uuid,uuid)',                                 'dcd1eff29a4eff0597c788ae1e940551', 'no'),
    ('public.unlock_all_student_cards(uuid,uuid)',                            '59d2299ae9fe06b7e1015693ba0fa256', 'no'),
    ('public.set_cards_work_until(uuid,date,uuid)',                           '758a28f8ee6a9286323bd5aaed006145', 'no'),
    ('public._new_access_code()',                                             '59989059b38fc77419052a42206c3aaa', 'no'),
    ('public._access_code_hash(text,text)',                                   '6795d47c7db1537c7409409c354282a8', 'no'),
    ('student_submit._card_refusal(uuid)',                                    'cb88af0a6bf62c22ff6c636b291b1a25', 'no'),
    ('student_submit._log(text,text,text,uuid,uuid)',                         '6737ebb0cb553bf22434d703d666f178', 'no'),
    ('student_submit._norm(text)',                                            '5973c7a9f9a337090bb2e49835870d02', 'no'),
    ('student_submit._midnight(text)',                                        'bf7920f2b31724bd007c66f729ac5edb', 'no'),
    ('student_submit._device_session(text)',                                  'fa1e510e4ccd3bccbf91e29540a837bb', 'no'),
    ('student_submit._session_classes(uuid)',                                 '6ef848f90721affa406d2b7fef89d285', 'no'),
    ('student_submit._session_class(text,uuid)',                              '1ae94981ff32f804d12079a24bd7b41a', 'no'),
    ('student_submit.page(text,uuid,text)',                                   'e744f2a27bcfd6fef662bbddeb9659c7', 'no'),
    ('student_submit.seen(text,uuid,uuid[],text)',                            '74a9d8ec7adf0d056ccb8294eea716de', 'no'),
    ('student_submit.done(text,text)',                                        'fae76f2147e885e26a4aa26d763b6dab', 'no'),
    ('student_submit._returned_grade(uuid,uuid)',                             '21706ae9eec783107d9da24e52e1855a', 'no'),
    ('student_submit.open(text,text)',                                        'd11b2e67cbf10cae4d44ae6082fd8e01', 'no'),
    ('student_submit.verify(text,text,text,text,text)',                       '901e62bdb5d94a9ffcebe33563425ad7', 'no'),
    ('student_submit."check"(text,text,text)',                                'e2ba0c71703d86fc860859e7f049e906', 'no'),
    ('student_submit.submit(text,jsonb,text)',                                'c08c00dd76f13de2d88bd83be685280d', 'no')
), known(fn) as (values   -- every function that may name student_card: the ones above that do, and no other
    ('public._issue_access_code(uuid,uuid,timestamptz)'), ('public._issue_report_code(uuid,uuid,timestamptz)'),
    ('public._issue_student_card(uuid,text)'), ('public.issue_student_cards(uuid,uuid[],uuid)'),
    ('public.reissue_student_card(uuid,uuid)'), ('public._student_card_json(uuid)'),
    ('student_submit._card_lookup(text,text)'), ('student_submit.card(text,text)'),
    ('student_submit.verify_card(text,text,text,text,text,text,boolean)'),
    ('public.list_student_cards(uuid)'), ('public.mark_student_cards_printed(uuid[],uuid)'),
    ('public.unlock_student_card(uuid,uuid)'), ('public.unlock_all_student_cards(uuid,uuid)'),
    ('public.set_cards_work_until(uuid,date,uuid)'), ('student_submit._card_refusal(uuid)'),
    ('student_submit._session_classes(uuid)')
)
select 'function ' || e.fn as what, e.md5 as tested,
       coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') as found, e.stops
  from expected e
 where coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') <> e.md5
union all
select 'function ' || e.fn || ' is owned by', 'postgres', p.proowner::regrole::text, 'yes (the role that applies must own what it replaces)'
  from expected e join pg_proc p on p.oid = to_regprocedure(e.fn)
 where e.stops = 'yes' and p.proowner::regrole::text <> 'postgres'
union all
select 'a function names student_card that the migration does not know',
       'none', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'yes'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
   and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~ '\mstudent_card\M'
   and p.oid not in (select to_regprocedure(k.fn)::oid from known k where to_regprocedure(k.fn) is not null)
union all
select 'student_card columns', 'id, enrollment_id, code, code_hash, salt, created_at, printed_at, last_opened_at, wrong_tries, wrong_times, locked_at, stopped_at, works_until, password',
       coalesce((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                  where a.attrelid = to_regclass('public.student_card') and a.attnum > 0 and not a.attisdropped), 'no such table'), 'yes'
 where coalesce((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                  where a.attrelid = to_regclass('public.student_card') and a.attnum > 0 and not a.attisdropped), '')
       <> 'id, enrollment_id, code, code_hash, salt, created_at, printed_at, last_opened_at, wrong_tries, wrong_times, locked_at, stopped_at, works_until, password'
union all
select 'student_card is owned by', 'postgres', c.relowner::regrole::text, 'yes (the role that applies must own it)'
  from pg_class c where c.oid = to_regclass('public.student_card') and c.relowner::regrole::text <> 'postgres'
union all
select 'something else on student_card: ' || x.what, 'none', x.name, 'no (read it: the migration was not tested with it)'
  from (select 'index' as what, c.relname::text as name from pg_index i join pg_class c on c.oid = i.indexrelid
         where i.indrelid = to_regclass('public.student_card')
           and c.relname not in ('student_card_pkey', 'student_card_one_live', 'student_card_live_code', 'student_card_enrollment_idx', 'student_card_code_hash_key')
        union all
        select 'constraint', k.conname::text from pg_constraint k
         where k.conrelid = to_regclass('public.student_card') and k.contype <> 'n'
           and k.conname not in ('student_card_pkey', 'student_card_enrollment_id_fkey', 'student_card_wrong_tries_check', 'student_card_code_hash_key')
        union all
        select 'trigger', t.tgname::text from pg_trigger t where t.tgrelid = to_regclass('public.student_card') and not t.tgisinternal
        union all
        select 'policy', p.polname::text from pg_policy p where p.polrelid = to_regclass('public.student_card') and p.polname <> 'student_card_read'
        union all
        select 'foreign key to it', k.conname::text from pg_constraint k
         where k.confrelid = to_regclass('public.student_card') and k.conname <> 'device_session_enrollment_card_id_fkey'
        union all
        select 'view or rule over it', r.ev_class::regclass::text from pg_depend d join pg_rewrite r on r.oid = d.objid
         where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass and d.refobjid = to_regclass('public.student_card')) x
union all
select 'earlier migrations', 'Batch A, S0-M5 and S0-M4b applied', v.missing, 'yes'
  from (select concat_ws(', ',
                 case when to_regclass('public.grade_return') is null or to_regclass('student_submit.device_session') is null
                           or to_regclass('student_submit.attempt') is null or to_regprocedure('public.fv_owns_score_cell(uuid,uuid)') is null then 'Batch A is not all there' end,
                 case when to_regprocedure('public._grade_return_repair_class(uuid)') is null then 'S0-M4b is not there' end,
                 case when exists (select 1 from unnest(array['public.fv_owns_course(uuid)', 'public.fv_owns_enrollment(uuid)',
                                                              'public.fv_idem_check(uuid,text)', 'public.fv_idem_store(uuid,text,jsonb)']) x
                                    where to_regprocedure(x) is null
                                       or (select p.proconfig from pg_proc p where p.oid = to_regprocedure(x)) is distinct from array['search_path=public, pg_temp'])
                      then 'S0-M5 is not there' end) as missing) v
 where v.missing <> ''
union all
select 'auth.uid()', 'reads request.jwt.claim.sub or request.jwt.claims', 'it names neither',
       'yes (the migration tries it and stops; issue_cards could not act as a teacher)'
 where to_regprocedure('auth.uid()') is null
    or pg_get_functiondef(to_regprocedure('auth.uid()')) !~ 'request\.jwt\.claim'
union all
select 'the teacher table', 'has id and deleted_at', 'a column is missing', 'no (issue_cards would fail when first called)'
 where (select count(*) from pg_attribute a where a.attrelid = to_regclass('public.teacher') and a.attname in ('id', 'deleted_at') and not a.attisdropped) <> 2
union all
select 'PostgreSQL version', '17 (tested on 17.11 and 18.6)', current_setting('server_version'), 'no'
 where current_setting('server_version_num')::int / 10000 not in (17, 18)
order by 1;

-- ── QUERY 2: what the migration will stop and delete ────────────────────────
-- Expected on 2026-11-10: 30, 1, 1, 0, 0, any number, 1.
--   live_cards            cards that work now: every one is stopped
--   classes_with_cards    classes that have a live card
--   teachers_with_cards   teachers who have ever made a card
--   live_sessions         phones signed in with a card right now: each is told
--                         its card was replaced
--   cached_card_answers   remembered answers of the three old card calls:
--                         deleted (above 0: run `vacuum public.fv_idempotency;`
--                         after the apply, as a statement of its own)
--   live_slips            slips that still open: not touched
--   classes_with_page_on  classes whose Make Cards does not work between the
--                         function deploy and the release
select
  (select count(*) from public.student_card where stopped_at is null) as live_cards,
  (select count(distinct e.course_id) from public.student_card k
     join public.enrollment e on e.id = k.enrollment_id where k.stopped_at is null) as classes_with_cards,
  (select count(distinct c.teacher_id) from public.student_card k
     join public.enrollment e on e.id = k.enrollment_id
     join public.course c on c.id = e.course_id) as teachers_with_cards,
  (select count(*) from student_submit.device_session where expires_at > now()) as live_sessions,
  (select count(*) from public.fv_idempotency
    where endpoint in ('issue_student_cards', 'reissue_student_card', 'unlock_student_card')) as cached_card_answers,
  (select count(*) from public.student_access_code
    where revoked_at is null and used_at is null and expires_at > now()) as live_slips,
  (select count(*) from public.course where student_page_enabled and deleted_at is null) as classes_with_page_on;
