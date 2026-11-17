-- REFLECT FROM THE CARD, BEFORE THE APPLY. Read-only: one query for
-- gradebook-prod, to run right before
-- migrations/2026111620_reflect_from_the_card.sql. It changes nothing and
-- reads no student's row: class names, reflection titles and counts only.
-- migrations/local-test/reflect_from_card.py runs it on the local stand-in.
--
-- Expected: only rows that start "shows in Reflect on the apply", one for
-- each reflection that is on and not past its closing date today (one not
-- open yet shows too, under Coming Up): its class and title, how many of
-- the class's students have a card that is not stopped (in a class whose
-- Student Page is on), and how many of those will see it for the first
-- time (no slip for it, no answer yet). Any other row is one thing that
-- would stop the file, or that is not as the file was tested against. Run
-- after the apply, it returns the same rows with "first time" counts as
-- they then are. The function lists are written by reflect_from_card.py,
-- never by hand; the two checks' text is written here.
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
), cons(tbl, con, live, becomes) as (values
    ('public.questionnaire', 'questionnaire_kind_check',
     'CHECK ((kind = ANY (ARRAY[''about_me''::text, ''core_reflection''::text, ''goal_checkin''::text, ''curricular_self_assessment''::text])))',
     'CHECK ((kind = ANY (ARRAY[''about_me''::text, ''core_reflection''::text, ''goal_checkin''::text, ''curricular_self_assessment''::text, ''custom''::text])))'),
    ('public.question', 'question_kind_check',
     'CHECK ((kind = ANY (ARRAY[''text''::text, ''short_set''::text, ''scale4''::text, ''choice''::text, ''goal_status''::text, ''core_pick''::text])))',
     'CHECK ((kind = ANY (ARRAY[''text''::text, ''short_set''::text, ''scale4''::text, ''choice''::text, ''goal_status''::text, ''core_pick''::text, ''rating''::text, ''date''::text, ''ranking''::text, ''likert''::text, ''section''::text])))')
), found as (
    select 'the file would stop: ' || f.fn as what,
           coalesce(md5(pg_get_functiondef(to_regprocedure(f.fn))), 'absent') as a, f.live as b
      from fns f
     where coalesce(md5(pg_get_functiondef(to_regprocedure(f.fn))), 'absent') not in (f.live, f.becomes)
    union all
    select 'relied on, and not as tested: ' || r.fn,
           coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent'), r.md5
      from relied r
     where coalesce(md5(pg_get_functiondef(to_regprocedure(r.fn))), 'absent') <> r.md5
    union all
    select 'the file would stop: the check ' || c.con,
           coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k
                      where k.conrelid = to_regclass(c.tbl) and k.conname = c.con), 'no such check'), c.live
      from cons c
     where coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k
                      where k.conrelid = to_regclass(c.tbl) and k.conname = c.con), 'no such check') not in (c.live, c.becomes)
    union all
    select 'shows in Reflect on the apply: ' || co.name || ' / ' || q.title,
           'students with a card: ' || count(sc.enrollment_id),
           'of them, seeing it for the first time: ' || count(sc.enrollment_id) filter (where not (
               exists (select 1 from public.student_access_code c
                        where c.questionnaire_id = q.id and c.enrollment_id = e.id and c.revoked_at is null)
               or exists (select 1 from public.response r
                           where r.questionnaire_id = q.id and r.enrollment_id = e.id)))
      from public.questionnaire q
      join public.course co on co.id = q.course_id
      left join public.enrollment e on e.course_id = co.id and e.withdrawn_at is null
      left join (select distinct enrollment_id from public.student_card where stopped_at is null) sc
             on sc.enrollment_id = e.id and co.student_page_enabled
     where q.parent_id is null and q.kind <> 'goal_checkin' and q.is_on and co.deleted_at is null
       and (q.closes_on is null or q.closes_on >= (now() at time zone coalesce(nullif(co.timezone, ''), 'America/Vancouver'))::date)
     group by co.name, q.title, q.id
)
select what, a, b from found order by what;
