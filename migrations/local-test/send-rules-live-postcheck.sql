-- BATCH B SEND RULES, AFTER THE APPLY. Read-only: one query for
-- gradebook-prod, to run right after
-- migrations/2026111130_student_send_rules.sql. It changes nothing.
-- migrations/local-test/send_rules.py runs it on the local stand-in,
-- before the file (it lists the three functions) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the file should
-- have left it: what it is, what was expected, what was found. It proves
-- the three functions are the ones tested and are run as before
-- (SECURITY DEFINER, search_path, volatility, owner, who can run them),
-- the functions they rely on are untouched, and no SECURITY DEFINER
-- function lost pg_temp.
-- It also covers student_submit.send_paths, the one function the file adds
-- (section 4, not decided by Colin): absent before, as the file leaves it
-- after, run by the service role only.
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11. Written by migrations/local-test/send_rules.py,
-- never by hand.
with replaces(fn, before, becomes) as (values
    -- FINGERPRINTS-BEGIN replaces
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '595e0a34dc67e23ca9fadc478c2ab9b7', '6cad6dd40eb1c33451a5dcf4f60e7624'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                '286e463dca1842c2586a93c77fb93456', '7c6673bda2f6b2ded4a14da8671fdfac'),
    ('student_submit.work(text,uuid,text)',                                  '64d016d3d102327917e987b24e811129', '2ec445c5d5afadb7c3fc1699d9929e52')
    -- FINGERPRINTS-END
), relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('student_submit._work_window(uuid)',                                                   '767795b7835e3c4d6cb628c76df8e6eb'),
    ('student_submit._grading_started(uuid,uuid)',                                          '13622bbca72904fdf877ce6b336dc6b4'),
    ('student_submit._send_session(text,uuid)',                                             'c39242f54850eeeada19945ac8123644'),
    ('student_submit._session_class(text,uuid)',                                            '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit.send_start(text,uuid,uuid,jsonb,text,text,uuid,text)',                 'e1ccea79acc7dedcbbe10da2a4548643'),
    ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)',                    '1dad4dba0d66dcd87820b72485ecb28c'),
    ('student_submit.unsend(text,uuid,uuid,text)',                                          '68665f35e1678f1bba64d30c082409d8'),
    ('public.finish_work_upload(uuid,jsonb,uuid)',                                          'c8c5c26be1758ec2e07fe73a68731159'),
    ('public._fv_timezone(text)',                                                           '8dbcb5716f155e2441f47416a0b28527'),
    ('public._grade_return_lock_first(uuid)',                                               '4d85813e08aaeb108cda95d85f3d66e4'),
    ('public._work_hold()',                                                                 'e0479f5f0ab703fd3cd77f677ec34eb2'),
    ('public._work_bucket()',                                                               '3f13f4e2c303b5a53caea4925abc8350'),
    ('public._work_check_pages(jsonb)',                                                     '8269b2b9c84377619778ca9154f39652'),
    ('public._work_check_files(jsonb)',                                                     'a3dfe8ce7a7f4eeb82e51d9e02c671c7'),
    ('public._work_begin(uuid,uuid,uuid,text,text,uuid,jsonb,text,text,boolean,uuid,uuid)', '658a51b97817bfa115aa8dc048003c26'),
    ('public._work_drop_expired(uuid)',                                                     '417711d4dadba3966d0358baee0214f0'),
    ('public._work_class_full(uuid,jsonb)',                                                 '5ba6a4c79d6862b3b9543be420bca532'),
    ('public._work_files_state(uuid,jsonb)',                                                '8fe968ca61404cfb4c8706d722c9c9a8'),
    ('public._work_settle_files(uuid,jsonb)',                                               '215b8fe4cc3eada5c45e8c86c847ef19'),
    ('public._work_upload_json(uuid)',                                                      '63982ca7888b11ce9b80e962f674c98a'),
    ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67')
    -- FINGERPRINTS-END
), new(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN new
    ('student_submit.send_paths(text,uuid,uuid,text)', '2f36c08b8ace950b9c7eb905b320aa40')
    -- FINGERPRINTS-END
), how(fn, expected, is_now) as (
    -- how each of the three is run; CREATE OR REPLACE keeps it
    select t.fn,
           'SECURITY DEFINER; search_path=public, student_submit, pg_temp; ' || t.vol || '; owner as public._work_bucket(); run by ' || t.who,
           case when to_regprocedure(t.fn) is null then 'absent' else
           (select case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end || '; '
                   || coalesce(array_to_string(p.proconfig, ', '), 'no settings') || '; '
                   || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end || '; '
                   || case when p.proowner = (select q.proowner from pg_proc q where q.oid = to_regprocedure('public._work_bucket()'))
                           then 'owner as public._work_bucket()' else 'owner ' || p.proowner::regrole::text end || '; run by '
                   || coalesce((select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
                                 where has_function_privilege(r, p.oid, 'execute')), 'nobody')
              from pg_proc p where p.oid = to_regprocedure(t.fn)) end
      from (values ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', 'volatile', 'nobody'),
                   ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'volatile', 'service_role'),
                   ('student_submit.work(text,uuid,text)', 'stable', 'service_role'),
                   ('student_submit.send_paths(text,uuid,uuid,text)', 'stable', 'service_role')) t(fn, vol, who)
)
select 'function ' || fn as what, becomes as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found
  from replaces
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> becomes
union all
select 'function ' || fn, md5, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from relied
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> md5
union all
select 'function ' || fn, becomes, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from new
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> becomes
union all
select 'how ' || fn || ' is run', expected, is_now
  from how
 where is_now <> expected
union all
select 'SECURITY DEFINER without pg_temp last in its search_path', 'none',
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$');
