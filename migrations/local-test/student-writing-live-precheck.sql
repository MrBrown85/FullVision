-- Read-only pre-check, before the apply of migrations/2026112702_student_writing.sql (2026-11-27).
-- SELECTs only. It returns the rows that differ from what the file was written and tested against, and two
-- count rows ("count: ..."), for the record: the file changes no existing row. Only the count rows means
-- ready. Run it with public on the search path, as Supabase's SQL tools do.
with want(sig, md5) as (values
    -- What the file calls, patches or replaces, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck
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
    ('student_submit.replace(text,uuid,uuid,jsonb,text,text,uuid,text)', '1dad4dba0d66dcd87820b72485ecb28c'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', '340cb72444d555a9cef594b543e2674c'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
    ('student_submit.unsend(text,uuid,uuid,text)', '68665f35e1678f1bba64d30c082409d8'),
    ('student_submit.revision_unsend(text,uuid,uuid,text)', '73ac162e56dde98d11ffcd03aa4b5ffa'),
    ('public.delete_submission(uuid,uuid)', 'c1f98e77a7fb756e75af4334d520f5fc'),
    ('public.finish_work_upload(uuid,jsonb,uuid)', 'c8c5c26be1758ec2e07fe73a68731159'),
    ('public._markup_give(uuid,uuid)', 'f0f07a1b879ff038e2f0afe020233c29'),
    ('public._markup_on_release()', 'a7e8838702d000c42621d72bf8621dfb'),
    ('student_submit._grading_started(uuid,uuid)', '586a6a0b5910e6c153b72e73a5b672bc'),
    ('public._submission_json(uuid)', 'a1933b27974307aeae814ce98714c18f'),
    ('student_submit.work(text,uuid,text)', '9e237f6e19649807b64aa6dc870de3f3'),
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)', '6cad6dd40eb1c33451a5dcf4f60e7624'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84')
    -- FINGERPRINTS-END
),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'already there: function ' || p.oid::regprocedure::text, 'present'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'student_submit' and p.proname in ('writing', 'writing_save', 'writing_start'))
        or (n.nspname = 'public' and p.proname in ('_writing_runs', '_writing_plain', '_writing_comment_list', '_writing_take',
                                                   '_writing_attach', '_writing_draft_done', '_writing_back_to_draft',
                                                   '_work_check_send_files', 'get_submission_writing', 'save_writing_comments'))
        or (n.nspname = 'student_submit' and p.proname in ('_send_begin', 'revision_start')
            and p.oid not in (coalesce(to_regprocedure('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)')::oid, 0),
                              coalesce(to_regprocedure('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)')::oid, 0)))
    union all
    select 'already there: table ' || t, 'present'
      from unnest(array['public.writing_draft', 'public.submission_writing', 'public.writing_comments']) t
     where to_regclass(t) is not null
    union all
    select 'write_log_kind_check', coalesce(pg_get_constraintdef(c.oid), 'absent')
      from (select 1) one
      left join pg_constraint c on c.conrelid = 'student_submit.write_log'::regclass and c.conname = 'write_log_kind_check'
     where pg_get_constraintdef(c.oid) is distinct from
           'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text])))'
    union all
    select 'count: submissions handed in', count(*)::text from public.submission where state = 'sent'
    union all
    select 'count: write_log rows', count(*)::text from student_submit.write_log
)
select check_name, value from checks order by check_name collate "C";
