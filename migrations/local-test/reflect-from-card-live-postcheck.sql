-- REFLECT FROM THE CARD, AFTER THE APPLY. Read-only: one query for
-- gradebook-prod, to run right after
-- migrations/2026111620_reflect_from_the_card.sql. It changes nothing and
-- reads no row of any table.
-- migrations/local-test/reflect_from_card.py runs it on the local stand-in,
-- before the file (it lists what is missing) and after.
--
-- Expected: NO ROWS. Each row is one thing that is not as the file should
-- have left it: the two functions are the ones tested, the functions that
-- call them are untouched, the two checks read as the file writes them, and
-- who may run each function is as before (the owner only), and each is
-- still SECURITY DEFINER with its search_path. The function lists are
-- written by reflect_from_card.py, never by hand; the two checks' text is
-- written here.
with fns(fn, live, becomes) as (values
    -- FINGERPRINTS-BEGIN functions
    ('student_submit._card_listed(uuid,uuid)',                'a0dc2d9e540be764da89a98e83751260', 'b594802f9fa517b4b5391cab24e31d03'),
    ('student_submit._clean_answer(text,jsonb,text[],jsonb)', '0f8377c8b45d14bc5c1b93c04852e49d', 'b944ef1d218b55c811e41973ebe5126f')
    -- FINGERPRINTS-END
), relied(fn, md5) as (values
    -- FINGERPRINTS-BEGIN relied
    ('student_submit.forms(text,uuid,text)',              '40ae918432795a5effbdd4cf6efead15'),
    ('student_submit.form(text,uuid,uuid,text)',          '8a2fcc6954bd63425d9460dea9800f26'),
    ('student_submit.answer(text,uuid,uuid,jsonb,text)',  'd625cba1843c7b409a5cb8743c7471fd'),
    ('student_submit.submit(text,jsonb,text)',            '90ace3c164dab19f6a77ba7dfb19e40e'),
    ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389'),
    ('student_submit._session_class(text,uuid)',          '1ae94981ff32f804d12079a24bd7b41a'),
    ('student_submit._send_session(text,uuid)',           'c39242f54850eeeada19945ac8123644'),
    ('student_submit._card_refusal(uuid)',                'cb88af0a6bf62c22ff6c636b291b1a25'),
    ('student_submit._part(uuid)',                        'b008fc4bee310de623de95e0296678f7')
    -- FINGERPRINTS-END
), cons(tbl, con, becomes) as (values
    ('public.questionnaire', 'questionnaire_kind_check',
     'CHECK ((kind = ANY (ARRAY[''about_me''::text, ''core_reflection''::text, ''goal_checkin''::text, ''curricular_self_assessment''::text, ''custom''::text])))'),
    ('public.question', 'question_kind_check',
     'CHECK ((kind = ANY (ARRAY[''text''::text, ''short_set''::text, ''scale4''::text, ''choice''::text, ''goal_status''::text, ''core_pick''::text, ''rating''::text, ''date''::text, ''ranking''::text, ''likert''::text, ''section''::text])))')
)
select 'not as the file leaves it: ' || f.fn as what,
       coalesce(md5(pg_get_functiondef(to_regprocedure(f.fn))), 'absent') as found, f.becomes as expected
  from fns f
 where coalesce(md5(pg_get_functiondef(to_regprocedure(f.fn))), 'absent') <> f.becomes
union all
select 'relied on, and changed: ' || r.fn, coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent'), r.md5
  from relied r
 where coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') <> r.md5
union all
select 'the check ' || c.con || ' is not as the file writes it',
       coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k
                  where k.conrelid = to_regclass(c.tbl) and k.conname = c.con), 'no such check'), c.becomes
  from cons c
 where coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k
                  where k.conrelid = to_regclass(c.tbl) and k.conname = c.con), 'no such check') <> c.becomes
union all
select 'someone besides the owner may run ' || f.fn, a.grantee::regrole::text, 'the owner only'
  from fns f
  join pg_proc p on p.oid = to_regprocedure(f.fn)
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where a.grantee <> p.proowner
union all
select 'not SECURITY DEFINER with its search_path: ' || f.fn, coalesce(p.prosecdef::text, 'absent') || ' ' || coalesce(p.proconfig::text, 'none'),
       'true {"search_path=public, student_submit, pg_temp"}'
  from fns f
  left join pg_proc p on p.oid = to_regprocedure(f.fn)
 where p.oid is null or not p.prosecdef
    or p.proconfig is distinct from array['search_path=public, student_submit, pg_temp']
order by 1;
