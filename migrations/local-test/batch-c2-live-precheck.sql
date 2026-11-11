-- Batch C, second file (2026111121_markup_revise_grade_changes.sql): the
-- read-only check to run on gradebook-prod BEFORE the apply. It reads the
-- catalog, and counts revision requests (no grade, no name). Expected: no
-- rows.
with relied(fn, first_run, later_run) as (values
    -- FINGERPRINTS-BEGIN c2relied (written by migrations/local-test/batch_c_fingerprints.py)
    ('public._grade_copy(uuid,uuid)',                                '3a8e0dfbc873176692a1160150a8d43b', '3a8e0dfbc873176692a1160150a8d43b'),
    ('public._markup_give(uuid,uuid)',                               'f0f07a1b879ff038e2f0afe020233c29', 'f0f07a1b879ff038e2f0afe020233c29'),
    ('public.return_for_revision(uuid,uuid,jsonb,uuid)',             'f66c0fdd60dd969203a345125280d760', 'f66c0fdd60dd969203a345125280d760'),
    ('public.cancel_revision(uuid,uuid)',                            '03f508a459eb621f868b699a0ea3f076', '03f508a459eb621f868b699a0ea3f076'),
    ('public._grade_return_apply(uuid,uuid,jsonb,jsonb)',            '89899f9dbc1569f7f1cc4216e252eb32', '89899f9dbc1569f7f1cc4216e252eb32'),
    ('public._grade_return_one(uuid,uuid,timestamp with time zone)', '99e3165d005b5b2020ec40dcf307c689', '99e3165d005b5b2020ec40dcf307c689'),
    ('public._revision_hide_available()',                            'cd50f4c6493a73b3c42ae51f7580f970', 'a4b4e942de351d6849702b96f25c7356'),
    ('public._revision_hide_grade(uuid)',                            '247080f6572bb45951cef807a2b849bd', 'a4c3f002d3bb2fc01e58ec5b8dab8ecb'),
    ('public._revision_unhide_grade(uuid)',                          '26d2861325edf27f95d090ebd590eb0f', '12dd830d953d13db1617e40a27f35133'),
    ('public._markup_on_return()',                                   'absent', '7aee1528f49c74565268dd37d191afd0')
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
   and t.tgname in ('markup_given_on_insert', 'markup_given_on_return')
union all
select 'a revision request is marked as hiding a grade before C2', 'revision_request', count(*)::text, '0'
  from public.revision_request where grade_hidden
having count(*) > 0;
