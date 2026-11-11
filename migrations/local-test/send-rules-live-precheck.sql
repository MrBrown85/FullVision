-- BATCH B SEND RULES, BEFORE THE APPLY. Read-only: one query for
-- gradebook-prod, to run right before
-- migrations/2026111130_student_send_rules.sql. It changes nothing.
-- migrations/local-test/send_rules.py runs it on the local stand-in.
--
-- Expected: NO ROWS, once Batch B, its review fixes (2026111104) and Batch
-- C (2026111120, 2026111121) are applied and nothing has replaced their
-- functions since. Each row is one thing that is not as the file expects:
-- what it is, what was expected, what was found, and whether the file's
-- first check would stop on it (stops = yes: it would stop with nothing
-- changed; no: it would apply, and the row is worth knowing). A function
-- the file replaces that is already as the file leaves it is listed with
-- stops = no ("already applied").
-- The fingerprints are md5(pg_get_functiondef(...)) from the local harness
-- on PostgreSQL 17.11, the same lists as the file's own. Written by
-- migrations/local-test/send_rules.py, never by hand.
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
select 'table ' || t, 'present', 'absent', 'yes'
  from unnest(array['public.submission', 'public.submission_file', 'public.revision_request']) t
 where to_regclass(t) is null
union all
select 'how ' || fn || ' is run', expected, is_now, 'no'
  from how
 where is_now <> expected;
