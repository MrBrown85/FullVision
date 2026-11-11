-- SLIPS KEYED, AFTER THE APPLY. Read-only: one query for gradebook-prod, to
-- run right after migrations/2026111160_slips_keyed.sql. It changes
-- nothing and reads no student's row.
-- migrations/local-test/slips_keyed.py runs it on the local stand-in,
-- before the file (it lists what is missing) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the file should
-- have left it: the seven new functions are the ones tested, the eight
-- dropped are gone, the functions relied on are untouched, who may run
-- each, the four columns, the tag index and the password trigger, and no
-- SECURITY DEFINER function lost pg_temp. Batch E's post-check now lists
-- the old student_submit.open and verify as missing: expected. The lists
-- are written by slips_keyed.py, never by hand.
with relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('student_submit._log(text,text,text,uuid,uuid)',     '6737ebb0cb553bf22434d703d666f178'),
    ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389'),
    ('student_submit._preview(uuid)',                     '336c6ed6f0b914a04ca678fa24137333'),
    ('student_submit._payload(uuid)',                     '7382a387265a87a32c6e4f22f0b1a898'),
    ('student_submit._norm(text)',                        '276ee00aa8e488d789af9e2016714c94'),
    ('student_submit._as_teacher(uuid)',                  'a478e6e00d91742951036fcec250ae0d'),
    ('public._access_code_hash(text,text)',               '6795d47c7db1537c7409409c354282a8'),
    ('public.fv_owns_course(uuid)',                       'e3afeca06043a6e907e6f4ae777c85da'),
    ('public.fv_owns_enrollment(uuid)',                   '728526648388367393162be706f7f9ea'),
    ('public.fv_idem_check(uuid,text)',                   '1c7b546434bee4b774557e0e6b16024f'),
    ('public.fv_idem_store(uuid,text,jsonb)',             '6d0b48c458d273a332db39e1a4b68626'),
    ('student_submit."check"(text,text,text)',            'cc54e80ca585024c65926cb5e73f3f43'),
    ('student_submit.submit(text,jsonb,text)',            '90ace3c164dab19f6a77ba7dfb19e40e'),
    ('student_submit.answer(text,uuid,uuid,jsonb,text)',  'd625cba1843c7b409a5cb8743c7471fd'),
    ('student_submit._card_listed(uuid,uuid)',            'a0dc2d9e540be764da89a98e83751260'),
    ('student_submit.forms(text,uuid,text)',              '40ae918432795a5effbdd4cf6efead15'),
    ('student_submit.report(text,uuid,uuid,text)',        'd009be8b73801173f816d9a5db036b42')
    -- FINGERPRINTS-END
), drops(fn, before) as (values
    -- FINGERPRINTS-BEGIN drops
    ('student_submit.open(text,text)',                                'd11b2e67cbf10cae4d44ae6082fd8e01'),
    ('student_submit.verify(text,text,text,text,text)',               '901e62bdb5d94a9ffcebe33563425ad7'),
    ('public.issue_access_codes(uuid,uuid[],uuid)',                   'c96c672abd7d81b00b59c8819c580c78'),
    ('public.issue_report_codes(uuid,uuid[],uuid)',                   'cdda4154e26cd4c2f9b1dd4648de959c'),
    ('public._issue_access_code(uuid,uuid,timestamp with time zone)', '1c4eab088284f90c919d07ba35ffc14d'),
    ('public._issue_report_code(uuid,uuid,timestamp with time zone)', '020cb811d2214dd5866cc2cf4ab705eb'),
    ('public._new_access_code()',                                     '59989059b38fc77419052a42206c3aaa'),
    ('public._slip_password(uuid)',                                   'fc16d2f952f0a9f05ab49d7a1c16a5ea')
    -- FINGERPRINTS-END
), new(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN new
    ('student_submit._slip_old_until()',                           '568527d9c8d239655dd55ab7c52009da'),
    ('public._slip_password_settle(uuid)',                         '9df7e6113498810271631c5a410b1554'),
    ('public._slip_password_on_change()',                          'e6f31871e265ff7c6eb480e60d22c149'),
    ('student_submit.open(text,text,text,text)',                   '1b0862066e6d8c546f3944f12248be26'),
    ('student_submit.verify(text,text,text,text,text,text,text)',  'b6b51a888f68aa5b54ffdf866756ee47'),
    ('student_submit.slip_roster(uuid,text,uuid)',                 '33954320e0812e4c22e5936bb2ee76a9'),
    ('student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)', 'fa4006097230b4d5102ea63e84296448')
    -- FINGERPRINTS-END
)
select 'relied on: ' || fn as what, md5 as expected, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found
  from relied where fn <> 'public.no_such_function_at_all()'
   and md5 <> coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
union all
select 'new: ' || fn, becomes, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
  from new where fn <> 'public.no_such_function_at_all()'
   and becomes <> coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
union all
select 'still there: ' || fn, 'absent', 'present'
  from drops where fn <> 'public.no_such_function_at_all()' and to_regprocedure(fn) is not null
union all
select 'service_role runs ' || f, 'yes', 'no'
  from unnest(array['student_submit.open(text,text,text,text)', 'student_submit.verify(text,text,text,text,text,text,text)',
                    'student_submit.slip_roster(uuid,text,uuid)', 'student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)']) f
 where to_regprocedure(f) is null or not has_function_privilege('service_role', f, 'execute')
union all
select r || ' runs ' || f, 'no', 'yes'
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['student_submit.open(text,text,text,text)', 'student_submit.verify(text,text,text,text,text,text,text)',
                    'student_submit.slip_roster(uuid,text,uuid)', 'student_submit.issue_slips(uuid,text,uuid,jsonb,text,uuid)',
                    'public._slip_password_settle(uuid)', 'public._access_code_hash(text,text)']) f
 where to_regprocedure(f) is not null and has_function_privilege(r, f, 'execute')
union all
select 'student_access_code.' || c, 'present', 'absent'
  from unnest(array['code_hmac', 'pw_hmac', 'key_id', 'converted_at']) c
 where not exists (select 1 from pg_attribute where attrelid = 'public.student_access_code'::regclass and attname = c and not attisdropped)
union all
select 'the tag index', 'present', 'absent' where to_regclass('public.student_access_code_code_hmac') is null
union all
select 'the password trigger', 'present', 'absent'
 where not exists (select 1 from pg_trigger where tgname = 'student_access_code_slip_password')
union all
select 'SECURITY DEFINER without pg_temp last: ' || n.nspname || '.' || p.proname, 'none', 'found'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$')
order by 1;
