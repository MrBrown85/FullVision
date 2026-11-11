-- BATCH B SEND RULES, BEFORE THE APPLY. Read-only: one query for
-- gradebook-prod, to run right before
-- migrations/2026111130_student_send_rules.sql. It changes nothing.
-- migrations/local-test/send_rules.py runs it on the local stand-in.
--
-- Expected: NO ROWS, once Batch B, its review fixes (2026111104) and Batch
-- C (2026111120, 2026111121, as of a682b559) are applied and nothing has
-- replaced their functions since. A row for public._markup_on_return() means
-- C2 is not applied (stops = yes); one for C1's _revision_state,
-- revision_start, revision_finish or _revision_gone, or C2's
-- _markup_on_release, a Batch C other than the one tested (round 3).
-- Each row is one thing that is not as the file expects:
-- what it is, what was expected, what was found, and whether the file's
-- first check would stop on it (stops = yes: it would stop with nothing
-- changed; no: it would apply, and the row is worth knowing). A function
-- the file replaces that is already as the file leaves it is listed with
-- stops = no ("already applied").
-- It also covers student_submit.send_paths, the one function the file adds
-- (section 4, approved by Colin Nov 11): absent before, as the file leaves it
-- after, run by the service role only.
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11, the same lists as the file's own. Written by
-- migrations/local-test/send_rules.py, never by hand.
with replaces(fn, before, becomes) as (values
    -- FINGERPRINTS-BEGIN replaces
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '595e0a34dc67e23ca9fadc478c2ab9b7', '6cad6dd40eb1c33451a5dcf4f60e7624'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)',                '286e463dca1842c2586a93c77fb93456', '340cb72444d555a9cef594b543e2674c'),
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
    ('public._submission_target_gone()',                                                    'f4f03a728aa0937ff0d89d9e5b62cc67'),
    ('public._revision_state(uuid)',                                                        '894bb53b0ad066e21f36c3a8038d5c6c'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)',                  '43ca2e50ff067a4fb51762367895ee84'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',                           'a04e2d62a76b00a7f6ad03a76a0ede74'),
    ('public._revision_gone()',                                                             '13b5fb325c563a0475437829446ef089'),
    ('public._markup_on_return()',                                                          'ce8ceaa830617aa9caf935b161d7e379'),
    ('public._markup_on_release()',                                                         'a7e8838702d000c42621d72bf8621dfb')
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
                   ('student_submit.work(text,uuid,text)', 'stable', 'service_role')) t(fn, vol, who)
)
select 'function ' || fn as what, before as expected,
       coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') || case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then ' (already as 2026111130 leaves it)' else '' end as found,
       case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then 'no' else 'yes' end as stops
  from replaces
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> before
union all
select 'function ' || fn, md5, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent'), 'yes'
  from relied
 where coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') <> md5
union all
select 'function ' || fn, 'absent', md5(pg_get_functiondef(to_regprocedure(fn))) || case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then ' (already as 2026111130 leaves it)' else '' end,
       case when md5(pg_get_functiondef(to_regprocedure(fn))) = becomes then 'no' else 'yes' end
  from new
 where to_regprocedure(fn) is not null
union all
select 'table ' || t, 'present', 'absent', 'yes'
  from unnest(array['public.submission', 'public.submission_file', 'public.revision_request']) t
 where to_regclass(t) is null
union all
select 'how ' || fn || ' is run', expected, is_now, 'no'
  from how
 where is_now <> expected;
