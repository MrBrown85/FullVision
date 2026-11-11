-- Batch C, second file (2026111121_markup_revise_grade_changes.sql): the
-- read-only check to run on gradebook-prod AFTER the apply. It reads the
-- catalog only. Expected: no rows.
with made(fn, becomes) as (values
    -- FINGERPRINTS-BEGIN c2new (written by migrations/local-test/batch_c_fingerprints.py)
    ('public._markup_on_return()', 'ce8ceaa830617aa9caf935b161d7e379')
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
-- Each trigger as C2 makes it: when it fires (its events, columns and
-- condition, read from the definition with the function cut off, since how
-- the function is named depends on the search path) and what it runs.
select 'a trigger C2 adds is not as C2 makes it', x.trg,
       coalesce(regexp_replace(pg_get_triggerdef(t.oid), ' EXECUTE FUNCTION .*$', ''), 'absent'), x.fires
  from (values
        ('markup_given_on_insert',
         'CREATE TRIGGER markup_given_on_insert AFTER INSERT ON public.grade_return FOR EACH ROW WHEN (((new.returned_at IS NOT NULL) AND (NOT new.is_draft)))'),
        ('markup_given_on_return',
         'CREATE TRIGGER markup_given_on_return AFTER UPDATE OF returned_at ON public.grade_return FOR EACH ROW WHEN (((new.returned_at IS NOT NULL) AND (NOT new.is_draft) AND (old.returned_at IS DISTINCT FROM new.returned_at)))')
       ) x(trg, fires)
  left join pg_trigger t on t.tgrelid = 'public.grade_return'::regclass and t.tgname = x.trg and not t.tgisinternal
 where t.oid is null
    or regexp_replace(pg_get_triggerdef(t.oid), ' EXECUTE FUNCTION .*$', '') <> x.fires
    or t.tgfoid <> coalesce(to_regprocedure('public._markup_on_return()'), 0)
union all
select 'a SECURITY DEFINER function does not name pg_temp last', n.nspname || '.' || p.proname, coalesce(p.proconfig::text, ''), 'search_path=…, pg_temp'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'student_submit', 'fv_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s ~ '^search_path=(.*, )?pg_temp$');
