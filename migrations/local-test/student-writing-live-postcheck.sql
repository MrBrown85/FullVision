-- Read-only post-check, after the apply of migrations/2026112702_student_writing.sql (2026-11-27).
-- SELECTs only. One row per check: (check, ok, found). Every row ok means the file landed as tested.
with want(sig, md5) as (values
    -- FINGERPRINTS-BEGIN postcheck
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
    ('student_submit.work(text,uuid,text)', '2f8c6e8f284e051320620700bc6b054d'),
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
),
runs(sig, runs) as (values
    -- Who may run each: teacher (authenticated and service_role), student (service_role), owner (neither).
    -- FINGERPRINTS-BEGIN runs
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', 'student'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'student'),
    ('student_submit.unsend(text,uuid,uuid,text)', 'student'),
    ('student_submit.revision_unsend(text,uuid,uuid,text)', 'student'),
    ('public.delete_submission(uuid,uuid)', 'teacher'),
    ('public.finish_work_upload(uuid,jsonb,uuid)', 'teacher'),
    ('public._markup_give(uuid,uuid)', 'owner'),
    ('public._markup_on_release()', 'owner'),
    ('student_submit._grading_started(uuid,uuid)', 'owner'),
    ('public._submission_json(uuid)', 'owner'),
    ('student_submit.work(text,uuid,text)', 'student'),
    ('student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid,integer)', 'owner'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text,integer)', 'student'),
    ('public._writing_runs(jsonb)', 'owner'),
    ('public._writing_plain(jsonb)', 'owner'),
    ('public._writing_comment_list(jsonb,integer)', 'owner'),
    ('public._writing_take(uuid,uuid,integer)', 'owner'),
    ('public._writing_attach(uuid,integer)', 'owner'),
    ('public._writing_draft_done(uuid)', 'owner'),
    ('public._writing_back_to_draft(uuid)', 'owner'),
    ('public._work_check_send_files(uuid,jsonb)', 'owner'),
    ('student_submit.writing(text,uuid,uuid,text)', 'student'),
    ('student_submit.writing_save(text,uuid,uuid,jsonb,integer,text)', 'student'),
    ('student_submit.writing_start(text,uuid,uuid,text,jsonb,integer,text,text,uuid,text)', 'student'),
    ('public.get_submission_writing(uuid)', 'teacher'),
    ('public.save_writing_comments(uuid,jsonb,integer,uuid)', 'teacher')
    -- FINGERPRINTS-END
),
checks(check_name, ok, found) as (
    select 'md5 ' || w.sig, md5(pg_get_functiondef(to_regprocedure(w.sig))) is not distinct from w.md5,
           coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
    union all
    select 'who runs ' || r.sig, x.got = r.runs, x.got
      from runs r
     cross join lateral (select case when to_regprocedure(r.sig) is null then 'absent'
                                     when has_function_privilege('anon', to_regprocedure(r.sig), 'execute') then 'anon'
                                     when has_function_privilege('authenticated', to_regprocedure(r.sig), 'execute')
                                          and has_function_privilege('service_role', to_regprocedure(r.sig), 'execute') then 'teacher'
                                     when has_function_privilege('service_role', to_regprocedure(r.sig), 'execute')
                                          and not has_function_privilege('authenticated', to_regprocedure(r.sig), 'execute') then 'student'
                                     when not has_function_privilege('authenticated', to_regprocedure(r.sig), 'execute')
                                          and not has_function_privilege('service_role', to_regprocedure(r.sig), 'execute') then 'owner'
                                     else 'other' end as got) x
    union all
    select 'gone ' || s, to_regprocedure(s) is null, coalesce(to_regprocedure(s)::text, 'gone')
      from unnest(array['student_submit._send_begin(text,text,uuid,uuid,jsonb,text,text,uuid)',
                        'student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)']) s
    union all
    select 'table ' || t, coalesce(c.relrowsecurity, false)
                          and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
                          and c.relacl is not null
                          and not exists (select 1 from aclexplode(c.relacl) a where a.grantee <> c.relowner)
                          and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attacl is not null),
           case when c.oid is null then 'absent' else 'row security ' || c.relrowsecurity::text end
      from unnest(array['public.writing_draft', 'public.submission_writing', 'public.writing_comments']) t
      left join pg_class c on c.oid = to_regclass(t)
    union all
    select 'constraints', x.s is not distinct from (
            -- FINGERPRINTS-BEGIN constraints
            'submission_writing_chars_check: CHECK (((chars >= 1) AND (chars <= 60000) AND (chars = length(plain)))) | submission_writing_pkey: PRIMARY KEY (submission_id) | submission_writing_rule: CHECK (((plain COLLATE "C") = (_writing_plain(body) COLLATE "C"))) | submission_writing_size_check: CHECK ((octet_length((body)::text) <= 600000)) | submission_writing_submission_fkey: FOREIGN KEY (submission_id) REFERENCES submission(id) ON DELETE CASCADE | writing_comments_given_has_rev: CHECK (((given_rev IS NULL) = (given_at IS NULL))) | writing_comments_given_list: CHECK (((given IS NULL) OR ((jsonb_typeof(given) = ''object''::text) AND (jsonb_typeof((given -> ''comments''::text)) = ''array''::text) AND (jsonb_array_length((given -> ''comments''::text)) <= 300) AND (octet_length((given)::text) <= 2000000)))) | writing_comments_pkey: PRIMARY KEY (submission_id) | writing_comments_working_list: CHECK (((working IS NULL) OR ((jsonb_typeof(working) = ''object''::text) AND (jsonb_typeof((working -> ''comments''::text)) = ''array''::text) AND (jsonb_array_length((working -> ''comments''::text)) <= 300) AND (octet_length((working)::text) <= 2000000)))) | writing_comments_writing_fkey: FOREIGN KEY (submission_id) REFERENCES submission_writing(submission_id) ON DELETE CASCADE | writing_draft_assessment_fkey: FOREIGN KEY (assessment_id, course_id) REFERENCES assessment(id, course_id) ON DELETE CASCADE | writing_draft_chars_check: CHECK (((chars >= 0) AND (chars <= 60000) AND (chars = length(plain)))) | writing_draft_enrollment_fkey: FOREIGN KEY (enrollment_id, course_id) REFERENCES enrollment(id, course_id) ON DELETE CASCADE | writing_draft_pkey: PRIMARY KEY (enrollment_id, assessment_id) | writing_draft_rev_check: CHECK ((rev >= 1)) | writing_draft_rule: CHECK (((plain COLLATE "C") = (_writing_plain(body) COLLATE "C"))) | writing_draft_size_check: CHECK ((octet_length((body)::text) <= 600000))'
            -- FINGERPRINTS-END
           ), coalesce(left(x.s, 60), 'absent')
      from (select string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") as s
              from pg_constraint where conrelid in (select to_regclass(t) from unnest(array['public.writing_draft',
                                                     'public.submission_writing', 'public.writing_comments']) t)) x
    union all
    select 'write_log_kind_check', pg_get_constraintdef(c.oid) =
           'CHECK ((kind = ANY (ARRAY[''reflect''::text, ''seen''::text, ''finish''::text, ''answer''::text, ''bulletin''::text, ''quiz''::text, ''writing''::text])))',
           pg_get_constraintdef(c.oid)
      from pg_constraint c where c.conrelid = 'student_submit.write_log'::regclass and c.conname = 'write_log_kind_check'
)
select check_name, ok, found from checks order by check_name collate "C";
