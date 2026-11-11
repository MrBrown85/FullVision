-- S3-M1, AFTER THE APPLY. Read-only: one query for gradebook-prod, to run
-- right after migrations/2026111003_card_codes_keyed.sql is applied. It
-- changes nothing. migrations/local-test/card_codes.py runs it on the local
-- stand-in, before the migration (it lists what is missing) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the migration
-- should have left it: what it is, what was expected, what was found.
--
-- It proves the apply landed: the readable columns are gone and the tag
-- columns are there; every function is the one tested (md5 of
-- pg_get_functiondef, from the local harness on PostgreSQL 17.11; 18.6
-- prints the same), the old ones gone; who can run and read what; no card
-- from before is live and none of them has a tag; the remembered card
-- answers are gone; no SECURITY DEFINER function lost pg_temp.
--
-- One row is expected to appear LATER and is then no fault: "live cards"
-- counts cards that work. Right after the apply there are none. Once the
-- site is released and a teacher presses Make and Print there are some.
with expected(fn, md5) as (values
    ('public._issue_access_code(uuid,uuid,timestamptz)',                       '1c4eab088284f90c919d07ba35ffc14d'),
    ('public._issue_report_code(uuid,uuid,timestamptz)',                       '020cb811d2214dd5866cc2cf4ab705eb'),
    ('public._issue_student_card(uuid,text)',                                  'absent'),
    ('public.issue_student_cards(uuid,uuid[],uuid)',                           'absent'),
    ('public.reissue_student_card(uuid,uuid)',                                 'absent'),
    ('public._student_card_json(uuid)',                                        'bba8282f322ad6913ecca134c24d5cfa'),
    ('student_submit._card_lookup(text,text)',                                 'absent'),
    ('student_submit.card(text,text)',                                         'absent'),
    ('student_submit.verify_card(text,text,text,text,text,text,boolean)',      'absent'),
    ('student_submit._as_teacher(uuid)',                                       'a478e6e00d91742951036fcec250ae0d'),
    ('student_submit._card_key_seen(text)',                                    '455da128c868ae4c67f9ef1ee2c0a125'),
    ('student_submit._card_lookup(text,text,text)',                            'b35a926e60a39330f8851d368acec7e6'),
    ('student_submit.card(text,text,text)',                                    '253b34cd5da404aca98806f6d334f277'),
    ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)', 'add37c8bb49f28472972920561401580'),
    ('student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)',                  '3662c2827078922670b5347ca37c685e'),
    -- left alone: the same as before the apply
    ('public.list_student_cards(uuid)',                                        'e05b6c25e7fbd872bbfcb5f163b6a160'),
    ('public.mark_student_cards_printed(uuid[],uuid)',                         '2ee4ab4fe90971e69d1ee8083c3a9aa3'),
    ('public.unlock_student_card(uuid,uuid)',                                  'dcd1eff29a4eff0597c788ae1e940551'),
    ('public.unlock_all_student_cards(uuid,uuid)',                             '59d2299ae9fe06b7e1015693ba0fa256'),
    ('public.set_cards_work_until(uuid,date,uuid)',                            '758a28f8ee6a9286323bd5aaed006145'),
    ('student_submit._card_refusal(uuid)',                                     'cb88af0a6bf62c22ff6c636b291b1a25'),
    ('student_submit._session_classes(uuid)',                                  '6ef848f90721affa406d2b7fef89d285'),
    ('student_submit._session_class(text,uuid)',                               '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit.page(text,uuid,text)',                                    'e744f2a27bcfd6fef662bbddeb9659c7'),
    ('student_submit.seen(text,uuid,uuid[],text)',                             '74a9d8ec7adf0d056ccb8294eea716de'),
    ('student_submit.done(text,text)',                                         'fae76f2147e885e26a4aa26d763b6dab'),
    ('student_submit._returned_grade(uuid,uuid)',                              '21706ae9eec783107d9da24e52e1855a'),
    ('student_submit.open(text,text)',                                         'd11b2e67cbf10cae4d44ae6082fd8e01'),
    ('student_submit.verify(text,text,text,text,text)',                        '901e62bdb5d94a9ffcebe33563425ad7'),
    ('student_submit."check"(text,text,text)',                                 'cc54e80ca585024c65926cb5e73f3f43'),
    ('student_submit.submit(text,jsonb,text)',                                 '90ace3c164dab19f6a77ba7dfb19e40e')
), card as (select to_regclass('public.student_card') as oid
), names(kind, expected, found) as (
    select 'student_card columns',
           'id, enrollment_id, created_at, printed_at, last_opened_at, wrong_tries, wrong_times, locked_at, stopped_at, works_until, code_hmac, pw_hmac, key_id, seq',
           coalesce((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a, card
                      where a.attrelid = card.oid and a.attnum > 0 and not a.attisdropped), 'no such table')
    union all
    select 'student_card indexes',
           'student_card_code_hmac_key (unique), student_card_enrollment_idx, student_card_enrollment_seq (unique), student_card_one_live (unique), student_card_pkey (unique)',
           coalesce((select string_agg(c.relname || case when i.indisunique then ' (unique)' else '' end, ', ' order by c.relname)
                       from pg_index i join pg_class c on c.oid = i.indexrelid, card where i.indrelid = card.oid), 'none')
    union all
    select 'student_card constraints',
           'student_card_code_hmac_check, student_card_enrollment_id_fkey, student_card_key_id_check, student_card_live_has_tag, student_card_pkey, student_card_pw_hmac_check, student_card_seq_check, student_card_wrong_tries_check',
           coalesce((select string_agg(k.conname, ', ' order by k.conname) from pg_constraint k, card
                      where k.conrelid = card.oid and k.contype <> 'n'), 'none')
    union all
    select 'student_card policies', 'none',
           coalesce((select string_agg(p.polname, ', ' order by p.polname) from pg_policy p, card where p.polrelid = card.oid), 'none')
    union all
    select 'student_card row security', 'on', (select case when c.relrowsecurity then 'on' else 'off' end from pg_class c, card where c.oid = card.oid)
    union all
    select 'student_card: columns dropped and still marked in the catalog', '4',
           (select count(*)::text from pg_attribute a, card where a.attrelid = card.oid and a.attisdropped)
    union all
    select 'student_card_pkey still marked as the order the table is kept in', 'no',
           (select case when bool_or(i.indisclustered) then 'yes' else 'no' end from pg_index i, card where i.indrelid = card.oid)
    union all
    select 'who can read student_card through the API (anon, signed-in teachers)', 'nobody',
           coalesce((select string_agg(r || ' can ' || p, ', ' order by r, p) from unnest(array['anon', 'authenticated']) r,
                            unnest(array['select', 'insert', 'update', 'delete']) p, card
                      where has_table_privilege(r, card.oid, p)), 'nobody')
    union all
    select 'the key-id table student_submit.card_key', 'there, row security on, at most one row, nothing for anon or signed-in teachers',
           case when to_regclass('student_submit.card_key') is null then 'no such table'
                else concat_ws(', ', 'there',
                         (select case when c.relrowsecurity then 'row security on' else 'row security OFF' end from pg_class c where c.oid = to_regclass('student_submit.card_key')),
                         'at most one row',
                         coalesce((select string_agg(r || ' can ' || p, ' and ' order by r, p) from unnest(array['anon', 'authenticated']) r,
                                          unnest(array['select', 'insert', 'update', 'delete']) p
                                    where has_table_privilege(r, to_regclass('student_submit.card_key'), p)), 'nothing for anon or signed-in teachers')) end
    union all
    select 'functions in student_submit that anon or a signed-in teacher can run', 'none',
           coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'student_submit'
                        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'none')
    union all
    select 'of this migration''s six functions, the ones the service role can run', 'card, issue_cards, verify_card',
           coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'student_submit' and p.proname in ('card', 'verify_card', 'issue_cards', '_card_lookup', '_as_teacher', '_card_key_seen')
                        and has_function_privilege('service_role', p.oid, 'execute')), 'none')
    union all
    select 'SECURITY DEFINER functions without pg_temp last in their search_path', 'none',
           coalesce((select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')), 'none')
    union all
    select 'functions that name student_card, other than the ones tested', 'none',
           coalesce((select string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by 1)
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f', 'p')
                        and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~ '\mstudent_card\M'
                        and p.oid not in (select to_regprocedure(x)::oid from unnest(array[
                                'public._student_card_json(uuid)', 'public.list_student_cards(uuid)', 'public.mark_student_cards_printed(uuid[],uuid)',
                                'public.unlock_student_card(uuid,uuid)', 'public.unlock_all_student_cards(uuid,uuid)', 'public.set_cards_work_until(uuid,date,uuid)',
                                'student_submit._card_refusal(uuid)', 'student_submit._session_classes(uuid)', 'student_submit._card_lookup(text,text,text)',
                                'student_submit.card(text,text,text)', 'student_submit.verify_card(text,text,text,text,text,text,text,boolean)',
                                'student_submit.issue_cards(uuid,uuid,jsonb,text,uuid)']) x where to_regprocedure(x) is not null)), 'none')
    union all
    select 'functions in the app''s schemas that call a keyed-hash function (the database must not be able to make a tag)', 'none',
           coalesce((select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosrc ~* '(^|[^a-z_])hmac\s*\('), 'none')
    union all
    select 'remembered answers of issue_student_cards, reissue_student_card and unlock_student_card from before the apply (they held codes)', '0',
           (select count(*)::text from public.fv_idempotency
             where endpoint in ('issue_student_cards', 'reissue_student_card')
                or (endpoint = 'unlock_student_card' and (result ? 'code' or result ? 'password')))
)
select 'function ' || e.fn as what, e.md5 as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') as found
  from expected e
 where coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') <> e.md5
union all
select kind, expected, found from names where found is distinct from expected
order by 1;

-- ── A second query, once the first one is clean ─────────────────────────────
-- It reads the tag columns, which exist only after the apply (before it this
-- query fails with "column does not exist", which is itself the answer).
-- Expected right after the apply: 0, 0, 0, 0, 0, 0. Later, once the site is
-- released and cards are made: live_cards and cards_with_a_tag go up
-- together, key_ids_seen is 1, and the other three stay 0.
select (select count(*) from public.student_card where stopped_at is null) as live_cards,
       (select count(*) from public.student_card where code_hmac is not null) as cards_with_a_tag,
       (select count(*) from public.student_card where stopped_at is null and (code_hmac is null or key_id is null)) as live_cards_without_a_tag,
       (select count(*) from public.student_card where seq is null) as cards_without_a_number,
       (select count(*) from (select 1 from public.student_card group by enrollment_id, seq having count(*) > 1) x) as numbers_shared,
       (select count(*) from student_submit.card_key) as key_ids_seen;
