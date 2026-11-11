-- SLIPS KEYED, BEFORE THE APPLY. Read-only: one query for gradebook-prod, to
-- run right before migrations/2026111160_slips_keyed.sql. It changes
-- nothing and reads no student's row; the last line is a count only.
-- migrations/local-test/slips_keyed.py runs it on the local stand-in.
--
-- Expected: ONE ROW, "slip passwords the file clears": how many stored
-- slip passwords no live printed slip needs (the file erases them). Any
-- other row is one thing that would stop the file, or that is not as the
-- file was tested against. The lists are written by slips_keyed.py, never
-- by hand.
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
), found as (
    select 'relied on: ' || fn as what, md5 as expected,
           coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent') as found
      from relied where fn <> 'public.no_such_function_at_all()'
    union all
    select 'dropped: ' || fn, before, coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
      from drops where fn <> 'public.no_such_function_at_all()'
    union all
    select 'new name already taken: ' || fn, 'absent', coalesce(md5(pg_get_functiondef(to_regprocedure(fn))), 'absent')
      from new where fn <> 'public.no_such_function_at_all()'
)
select what, expected, found from found where expected <> found
union all
select 'student_access_code.' || attname || ' already there', 'absent', 'present'
  from pg_attribute where attrelid = 'public.student_access_code'::regclass
   and attname in ('code_hmac', 'pw_hmac', 'key_id', 'converted_at') and not attisdropped
union all
select 'slip passwords the file clears (no live printed slip needs them)', '0', count(*)::text
  from public.student s
 where s.slip_password is not null
   and not exists (select 1 from public.student_access_code c join public.enrollment e on e.id = c.enrollment_id
                    where e.student_id = s.id and e.withdrawn_at is null and c.questionnaire_id is not null
                      and c.used_at is null and c.revoked_at is null and c.expires_at > now())
order by 1;
