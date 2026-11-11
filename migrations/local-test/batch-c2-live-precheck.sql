-- Batch C, second file (2026111121_markup_revise_grade_changes.sql): the
-- read-only check to run on gradebook-prod BEFORE the apply. It reads the
-- catalog only. Expected: no rows. On a database without C1 it answers
-- "C1 is not applied", not an error.
with relied(fn, first_run, later_run) as (values
    -- FINGERPRINTS-BEGIN c2relied (written by migrations/local-test/batch_c_fingerprints.py)
    ('public._markup_give(uuid,uuid)',                               'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
    ('public._revision_settle(uuid,uuid,boolean)',                   '5abc02afbaa29294cdb317838657b37c', '5abc02afbaa29294cdb317838657b37c'),
    ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)',            '89899f9dbc1569f7f1cc4216e252eb32', '89899f9dbc1569f7f1cc4216e252eb32'),
    ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689', '99e3165d005b5b2020ec40dcf307c689'),
    ('public._markup_on_return()',                                   'absent', 'ce8ceaa830617aa9caf935b161d7e379')
    -- FINGERPRINTS-END
)
select 'a function C2 calls or replaces differs from the tested one' as problem, r.fn as detail,
       coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') as found, r.first_run as expected
  from relied r
 where coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') <> r.first_run
union all
select 'C1 is not applied', t, 'absent', 'present'
  from unnest(array['public.markup', 'public.revision_request', 'public.feedback_reflection']) t
 where to_regclass(t) is null
union all
select 'a trigger name C2 makes is taken', t.tgname, 'present', 'absent'
  from pg_trigger t
 where to_regclass('public.grade_return') is not null and t.tgrelid = 'public.grade_return'::regclass and not t.tgisinternal
   and t.tgname in ('markup_given_on_insert', 'markup_given_on_return');
