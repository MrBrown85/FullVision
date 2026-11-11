-- Batch C, first file (2026111120_markup_reflect_revise.sql): the read-only
-- check to run on gradebook-prod AFTER the apply. It reads the catalog only.
-- Expected: no rows.
with made(fn, becomes, or_c2) as (values
    -- FINGERPRINTS-BEGIN new (written by migrations/local-test/batch_c_fingerprints.py)
    ('public._work_feedback_gone()',                                       '5c760a38a7675c1d49ef95ab994b76e5', '5c760a38a7675c1d49ef95ab994b76e5'),
    ('public._work_feedback_truncated()',                                  '450e3b27b73c51d01f4c431adb402bbd', '450e3b27b73c51d01f4c431adb402bbd'),
    ('public._markup_check(jsonb)',                                        'd5fac66f176bf8f23391a7c6c19b053a', 'd5fac66f176bf8f23391a7c6c19b053a'),
    ('public._markup_give(uuid,uuid)',                                     'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
    ('public._revision_hide_available()',                                  'cd50f4c6493a73b3c42ae51f7580f970', 'a4b4e942de351d6849702b96f25c7356'),
    ('public._revision_hide_grade(uuid)',                                  '247080f6572bb45951cef807a2b849bd', 'a4c3f002d3bb2fc01e58ec5b8dab8ecb'),
    ('public._revision_unhide_grade(uuid)',                                '26d2861325edf27f95d090ebd590eb0f', '12dd830d953d13db1617e40a27f35133'),
    ('public._piece_latest(uuid,uuid)',                                    'fee319ef4d87447eeac9b4d53a1f1b50', 'fee319ef4d87447eeac9b4d53a1f1b50'),
    ('public._revision_state(uuid)',                                       'd8103c802e246bfac948fa620d06fe09', 'd8103c802e246bfac948fa620d06fe09'),
    ('public._revision_json(uuid)',                                        '969f930b121a6714edfde8052a4d876b', '969f930b121a6714edfde8052a4d876b'),
    ('public._reflection_json(uuid)',                                      '89f6847f6ab6a468284ea1df003391a6', '89f6847f6ab6a468284ea1df003391a6'),
    ('public.set_course_feedback_options(uuid,jsonb,uuid)',                '1954af2eef430d63baa91d38e74106d2', '1954af2eef430d63baa91d38e74106d2'),
    ('public.save_markup(uuid,jsonb,integer,uuid)',                        '808290a14511b137bc5c1a4574016429', '808290a14511b137bc5c1a4574016429'),
    ('public.list_assessment_markup(uuid)',                                '5e64579a923a0f0c02791b6428e54d98', '5e64579a923a0f0c02791b6428e54d98'),
    ('public.return_work(uuid,uuid[],uuid)',                               '9175f90ed1158790acef376c98319295', '9175f90ed1158790acef376c98319295'),
    ('public.return_for_revision(uuid,uuid,jsonb,uuid)',                   'f66c0fdd60dd969203a345125280d760', 'f66c0fdd60dd969203a345125280d760'),
    ('public.set_revision_request(uuid,jsonb,uuid)',                       '6f9fb14cc1c8ced04cca7e0302c40b13', '6f9fb14cc1c8ced04cca7e0302c40b13'),
    ('public.cancel_revision(uuid,uuid)',                                  '03f508a459eb621f868b699a0ea3f076', '03f508a459eb621f868b699a0ea3f076'),
    ('public.answer_reflection(uuid,text,uuid,boolean)',                   'b384f9b1c729f42733db290a0f4ddae5', 'b384f9b1c729f42733db290a0f4ddae5'),
    ('public.list_course_feedback(uuid)',                                  '7fbe6b367a0c28fd4dd2b894f0dc7711', '7fbe6b367a0c28fd4dd2b894f0dc7711'),
    ('student_submit._group_members(uuid,uuid)',                           'b38b1af6f2dc142c94ce1cca454fd0fb', 'b38b1af6f2dc142c94ce1cca454fd0fb'),
    ('student_submit.feedback(text,uuid,text)',                            'c45a01cc31eab1111dc89994008ba4d4', 'c45a01cc31eab1111dc89994008ba4d4'),
    ('student_submit.markup(text,uuid,uuid,text)',                         '6cc78118aa4e98252514826aabf957a9', '6cc78118aa4e98252514826aabf957a9'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)',                  '7a4e2ab29d369ef159dce65e1e1e8f77', '7a4e2ab29d369ef159dce65e1e1e8f77'),
    ('student_submit.reply(text,uuid,uuid,jsonb,text)',                    '51e8f1db4f92885e8e310b255fa7aa70', '51e8f1db4f92885e8e310b255fa7aa70'),
    ('student_submit.answer_seen(text,uuid,uuid[],text)',                  'a32cc8e5329954ac909969269afc2518', 'a32cc8e5329954ac909969269afc2518'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', 'aa5207487f67fe4fbc7dcbf803276f6b', 'aa5207487f67fe4fbc7dcbf803276f6b'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)',          'a86921ac1689264c2db5dea1e081f276', 'a86921ac1689264c2db5dea1e081f276'),
    ('student_submit.revision_unsend(text,uuid,uuid,text)',                '763f31c96e1ee07ac5477762db0f7784', '763f31c96e1ee07ac5477762db0f7784'),
    ('student_submit.group_work(text,uuid,text)',                          '1db83448b1b3d7ae998870bdb07c4f36', '1db83448b1b3d7ae998870bdb07c4f36'),
    ('student_submit.group_file_links(text,uuid,uuid,text)',               '1c034fa5647b5808209b0ef9b31e8e4d', '1c034fa5647b5808209b0ef9b31e8e4d')
    -- FINGERPRINTS-END
), replaced(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN replafter (written by migrations/local-test/batch_c_fingerprints.py)
    ('student_submit._grading_started(uuid,uuid)', '13622bbca72904fdf877ce6b336dc6b4')
    -- FINGERPRINTS-END
), rpcs(fn) as (values
    ('public.set_course_feedback_options(uuid,jsonb,uuid)'), ('public.save_markup(uuid,jsonb,integer,uuid)'),
    ('public.list_assessment_markup(uuid)'), ('public.return_work(uuid,uuid[],uuid)'),
    ('public.return_for_revision(uuid,uuid,jsonb,uuid)'), ('public.set_revision_request(uuid,jsonb,uuid)'),
    ('public.cancel_revision(uuid,uuid)'), ('public.answer_reflection(uuid,text,uuid,boolean)'), ('public.list_course_feedback(uuid)')
), student(fn) as (values
    ('student_submit.feedback(text,uuid,text)'), ('student_submit.markup(text,uuid,uuid,text)'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)'), ('student_submit.reply(text,uuid,uuid,jsonb,text)'),
    ('student_submit.answer_seen(text,uuid,uuid[],text)'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)'), ('student_submit.revision_unsend(text,uuid,uuid,text)'),
    ('student_submit.group_work(text,uuid,text)'), ('student_submit.group_file_links(text,uuid,uuid,text)')
)
select 'a function is not as Batch C leaves it' as problem, m.fn as detail,
       coalesce(md5(pg_get_functiondef(to_regprocedure(m.fn))), 'absent') as found, m.becomes as expected
  from made m
 where coalesce(md5(pg_get_functiondef(to_regprocedure(m.fn))), 'absent') not in (m.becomes, m.or_c2)
union all
select 'the function Batch C replaces is not as it leaves it', r.fn,
       coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent'), r.becomes
  from replaced r
 where coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') <> r.becomes
union all
select 'the function Batch C replaces can be run by a role it should not', r.fn, 'yes', 'no'
  from replaced r
 where to_regprocedure(r.fn) is not null
   and (has_function_privilege('anon', to_regprocedure(r.fn), 'execute')
        or has_function_privilege('authenticated', to_regprocedure(r.fn), 'execute')
        or has_function_privilege('service_role', to_regprocedure(r.fn), 'execute'))
union all
select 'anon can run a Batch C function', m.fn, 'yes', 'no'
  from made m where to_regprocedure(m.fn) is not null and has_function_privilege('anon', to_regprocedure(m.fn), 'execute')
union all
select 'a teacher RPC cannot be run by signed-in teachers', r.fn, 'no', 'yes'
  from rpcs r where to_regprocedure(r.fn) is not null and not has_function_privilege('authenticated', to_regprocedure(r.fn), 'execute')
union all
select 'a student function can be run by signed-in teachers', s.fn, 'yes', 'no'
  from student s where to_regprocedure(s.fn) is not null and has_function_privilege('authenticated', to_regprocedure(s.fn), 'execute')
union all
select 'a student function cannot be run by the service role', s.fn, 'no', 'yes'
  from student s where to_regprocedure(s.fn) is not null and not has_function_privilege('service_role', to_regprocedure(s.fn), 'execute')
union all
select 'a helper can be run by a role it should not', m.fn, 'yes', 'no'
  from made m
 where to_regprocedure(m.fn) is not null and m.fn not in (select fn from rpcs) and m.fn not in (select fn from student)
   and (has_function_privilege('authenticated', to_regprocedure(m.fn), 'execute')
        or has_function_privilege('service_role', to_regprocedure(m.fn), 'execute'))
union all
select 'a Batch C table is missing or has row security off', t, coalesce((select c.relrowsecurity::text from pg_class c where c.oid = to_regclass(t)), 'absent'), 'true'
  from unnest(array['public.markup', 'public.revision_request', 'public.feedback_reflection']) t
 where not coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass(t)), false)
union all
select 'a Batch C table can be read through the API', t || ' by ' || r, 'yes', 'no'
  from unnest(array['public.markup', 'public.revision_request', 'public.feedback_reflection']) t
 cross join unnest(array['anon', 'authenticated']) r
 where to_regclass(t) is not null and has_table_privilege(r, to_regclass(t), 'select')
union all
select 'a class switch is missing or not off by default', 'course.' || c, coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attribute a
         join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.course'::regclass and a.attname = c), 'absent'), 'false'
  from unnest(array['reflect_on_feedback', 'show_my_learning']) c
 where coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attribute a
         join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.course'::regclass and a.attname = c), '') <> 'false'
union all
select 'a trigger Batch C adds is missing or off', x.tbl || '.' || x.trg, 'absent or off', 'enabled'
  from (values ('public.assessment', 'work_feedback_gone'), ('public.enrollment', 'work_feedback_gone'),
               ('public.assessment', 'work_feedback_truncate'), ('public.enrollment', 'work_feedback_truncate')) x(tbl, trg)
 where not exists (select 1 from pg_trigger t where t.tgrelid = to_regclass(x.tbl) and t.tgname = x.trg and t.tgenabled = 'O')
union all
select 'a SECURITY DEFINER function does not name pg_temp last', n.nspname || '.' || p.proname, coalesce(p.proconfig::text, ''), 'search_path=…, pg_temp'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$');
