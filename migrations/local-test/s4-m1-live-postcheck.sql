-- S4-M1, AFTER THE APPLY. Read-only: one query for gradebook-prod, to run
-- right after migrations/2026111103_student_page_fields.sql is applied. It
-- changes nothing. migrations/local-test/student_page_fields.py runs it on
-- the local stand-in, before the migration (it lists the two functions) and
-- after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the migration
-- should have left it: what it is, what was expected, what was found.
--
-- It proves the apply landed: the two functions are the ones tested (md5 of
-- pg_get_functiondef, from the local harness on PostgreSQL 17.11); the
-- functions around them are untouched; who can run the two is as before;
-- both answer when called with nothing (the answers a phone with no session
-- gets); no SECURITY DEFINER function lost pg_temp.
-- With Batch B applied as well, the answer is the same.
with expected(fn, md5) as (values
    -- as this migration leaves them
    ('student_submit.page(text,uuid,text)',                                    '034e6674a25f8a5e1abc067f50784ce6'),
    ('student_submit._session_classes(uuid)',                                  '722d403571069e3e97516f432ed9de5c'),
    -- left alone: the same as before the apply
    ('student_submit._returned_grade(uuid,uuid)',                              '21706ae9eec783107d9da24e52e1855a'),
    ('student_submit._session_class(text,uuid)',                               '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._device_session(text)',                                   'fa1e510e4ccd3bccbf91e29540a837bb'),
    ('student_submit._card_refusal(uuid)',                                     'cb88af0a6bf62c22ff6c636b291b1a25'),
    ('student_submit.seen(text,uuid,uuid[],text)',                             '74a9d8ec7adf0d056ccb8294eea716de'),
    ('student_submit.done(text,text)',                                         'fae76f2147e885e26a4aa26d763b6dab'),
    ('student_submit.card(text,text,text)',                                    '253b34cd5da404aca98806f6d334f277'),
    ('student_submit.verify_card(text,text,text,text,text,text,text,boolean)', 'add37c8bb49f28472972920561401580'),
    ('student_submit.open(text,text)',                                         'd11b2e67cbf10cae4d44ae6082fd8e01'),
    ('student_submit.verify(text,text,text,text,text)',                        '901e62bdb5d94a9ffcebe33563425ad7'),
    ('student_submit."check"(text,text,text)',                                 'cc54e80ca585024c65926cb5e73f3f43'),
    ('student_submit.submit(text,jsonb,text)',                                 '90ace3c164dab19f6a77ba7dfb19e40e'),
    ('public._grade_copy(uuid,uuid)',                                          '3a8e0dfbc873176692a1160150a8d43b'),
    ('public._grade_copy_in_use(jsonb,uuid)',                                  'befe9f034ce927b2abdf8c8825c402bd')
), names(kind, expected, found) as (
    select 'who can run student_submit.page (of the public, anon, signed-in teachers, the service role)', 'service_role',
           coalesce((select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                      where has_function_privilege(r, to_regprocedure('student_submit.page(text,uuid,text)'), 'execute')), 'nobody')
    union all
    select 'who can run student_submit._session_classes (of the same four)', 'nobody',
           coalesce((select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                      where has_function_privilege(r, to_regprocedure('student_submit._session_classes(uuid)'), 'execute')), 'nobody')
    union all
    select 'functions in student_submit that anon or a signed-in teacher can run', 'none',
           coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'student_submit'
                        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'none')
    union all
    select 'the two functions: SECURITY DEFINER, STABLE, search_path public, student_submit, pg_temp', '2',
           (select count(*)::text from pg_proc p
             where p.oid in (to_regprocedure('student_submit.page(text,uuid,text)'), to_regprocedure('student_submit._session_classes(uuid)'))
               and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public, student_submit, pg_temp'])
    union all
    select 'SECURITY DEFINER functions without pg_temp last in their search_path', 'none',
           coalesce((select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')), 'none')
    union all
    -- Both run. page with no session is told what a phone with none is told;
    -- the classes of a session that does not exist are an empty list.
    select 'page, asked with no session', '{"ok": false, "error": "signed_out"}',
           student_submit.page(null, null, null)::text
    union all
    select 'the classes of a session that does not exist', '[]',
           student_submit._session_classes('00000000-0000-0000-0000-000000000000')::text
)
select 'function ' || e.fn as what, e.md5 as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') as found
  from expected e
 where coalesce(md5(pg_get_functiondef(to_regprocedure(e.fn))), 'absent') <> e.md5
union all
select kind, expected, found from names where found is distinct from expected
order by 1;
