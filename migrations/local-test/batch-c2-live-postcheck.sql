-- Batch C, second file (2026111121_markup_revise_grade_changes.sql): the
-- read-only check to run on gradebook-prod AFTER the apply. It reads the
-- catalog only. Expected: no rows.
with made(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN c2new (written by migrations/local-test/batch_c_fingerprints.py)
    ('public._revision_hide_available()',   'a4b4e942de351d6849702b96f25c7356'),
    ('public._revision_hide_grade(uuid)',   'a4c3f002d3bb2fc01e58ec5b8dab8ecb'),
    ('public._revision_unhide_grade(uuid)', 'cbbc6fd7654c2b8677c7d210b5e15cc4'),
    ('public._markup_on_return()',          '86761bf5b10476cc72b0fea25387c46e')
    -- FINGERPRINTS-END
)
select 'a function is not as C2 leaves it' as problem, m.fn as detail,
       coalesce(md5(pg_get_functiondef(to_regprocedure(m.fn))), 'absent') as found, m.becomes as expected
  from made m
 where coalesce(md5(pg_get_functiondef(to_regprocedure(m.fn))), 'absent') <> m.becomes
union all
select 'a C2 function can be run by a role it should not', m.fn, 'yes', 'no'
  from made m cross join unnest(array['anon', 'authenticated', 'service_role']) r
 where to_regprocedure(m.fn) is not null and has_function_privilege(r, to_regprocedure(m.fn), 'execute')
union all
select 'a trigger C2 adds is missing or off', x.trg, 'absent or off', 'enabled'
  from (values ('markup_given_on_insert'), ('markup_given_on_return')) x(trg)
 where not exists (select 1 from pg_trigger t where t.tgrelid = 'public.grade_return'::regclass and t.tgname = x.trg and t.tgenabled = 'O')
union all
select 'a SECURITY DEFINER function does not name pg_temp last', n.nspname || '.' || p.proname, coalesce(p.proconfig::text, ''), 'search_path=…, pg_temp'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$');
