-- Read-only post-check, after the apply of migrations/2026111804_quizzes.sql (2026-11-17).
-- SELECTs only. Every row says ok. Grants are read from relacl, attacl and proacl themselves, for every role
-- (not information_schema, which shows only grants that involve the role running the query). The last row
-- counts quizzes, never reads one.
with want(sig, after_md5, runs) as (values
    -- runs: who besides its owner may run it.
    ('public.list_quiz(uuid)', '4b5a877bdade0126970b90acbfa613d7', 'authenticated'),
    ('public.save_quiz(uuid,jsonb,uuid)', '0bd413e5fa6ac1ddeaec29673c791be8', 'authenticated'),
    ('fv_private.quiz_json(uuid)', 'c1d41659890c23cb02d0f517cd5c037d', ''),
    ('public._quiz_draft_guard()', '9e6ed6b0336305322b22c309161472f9', ''),
    ('public._quiz_tag_gone()', '3cd4fba9441edaec432cc3322c654826', ''),
    ('public._quiz_attempt_same_class()', '5b0045acab2f7eb94cf3d8ff75210e1f', ''),
    ('public.fv_owns_assessment(uuid)', '9f4c680c35f9f3ac32e8290824707673', null),
    ('public.fv_idem_check(uuid,text)', '1c7b546434bee4b774557e0e6b16024f', null),
    ('public.fv_idem_store(uuid,text,jsonb)', '6d0b48c458d273a332db39e1a4b68626', null)),
tbl(t) as (values ('public.quiz'), ('public.quiz_question'), ('public.quiz_key'), ('public.quiz_attempt'), ('public.quiz_answer')),
fk(child, parent, n) as (values
    -- Each key cascades: (table, the table it names, how many keys to it).
    ('public.quiz', 'public.assessment', 1), ('public.quiz_question', 'public.quiz', 1), ('public.quiz_key', 'public.quiz_question', 1),
    ('public.quiz_attempt', 'public.quiz', 1), ('public.quiz_attempt', 'public.enrollment', 1),
    ('public.quiz_answer', 'public.quiz_attempt', 1), ('public.quiz_answer', 'public.quiz_question', 1)),
trg(name, tbl, fn, deferred, ty, cols, qual) as (values
    -- tgtype: 1 row, 2 before, 4 insert, 8 delete, 16 update.
    ('assessment_quiz_draft_guard', 'public.assessment', 'public._quiz_draft_guard()', false, 19, 'is_draft',
     '((new.is_draft AND (NOT old.is_draft)))'),
    ('quiz_tag_gone', 'public.assessment_tag', 'public._quiz_tag_gone()', true, 25, 'assessment_id,tag_id', ''),
    ('quiz_attempt_same_class', 'public.quiz_attempt', 'public._quiz_attempt_same_class()', false, 23, 'assessment_id,enrollment_id', '')),
fn_acl as (
    select w.sig, (select coalesce(string_agg(x.r, ', ' order by x.r collate "C"), '')
                     from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as r
                             from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where p.oid = to_regprocedure(w.sig) and a.grantee <> p.proowner) x) as got
      from want w where w.runs is not null),
tbl_acl as (
    select t, (select coalesce(string_agg(x.r, ', ' order by x.r collate "C"), '')
                 from (select distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as r
                         from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                        where c.oid = to_regclass(t) and a.grantee <> c.relowner) x) as got
      from tbl)
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'grant: ' || f.sig || ' may be run by ' || coalesce(nullif(w.runs, ''), 'its owner only') || ' and no one else',
       case when f.got = w.runs then 'ok' else 'NOT AS EXPECTED: ' || coalesce(nullif(f.got, ''), 'its owner only') end
  from fn_acl f join want w on w.sig = f.sig
union all select 'table ' || t || ': row security on, no policy',
       case when to_regclass(t) is not null and (select relrowsecurity from pg_class where oid = to_regclass(t))
             and not exists (select 1 from pg_policy where polrelid = to_regclass(t)) then 'ok' else 'NOT AS EXPECTED' end
  from tbl
union all select 'grant: table ' || t || ': no role but its owner (relacl)',
       case when got = '' then 'ok' else 'NOT AS EXPECTED: ' || got end
  from tbl_acl
union all select 'grant: table ' || t || ': no column grant (attacl)',
       case when not exists (select 1 from pg_attribute where attrelid = to_regclass(t) and attacl is not null) then 'ok' else 'NOT AS EXPECTED' end
  from tbl
union all select 'key ' || child || ' -> ' || parent || ' cascades',
       case when (select count(*) from pg_constraint where conrelid = to_regclass(child) and contype = 'f'
                    and confrelid = to_regclass(parent) and confdeltype = 'c' and convalidated) = n then 'ok' else 'NOT AS EXPECTED' end
  from fk
union all select 'no key from quiz_question.tag_id (the deferred trigger empties it instead)',
       case when not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                              where c.conrelid = 'public.quiz_question'::regclass and c.contype = 'f' and a.attname = 'tag_id') then 'ok' else 'NOT AS EXPECTED' end
union all select 'one open try and one confirmed try per student (unique, partial)',
       case when (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = 'public.quiz_attempt'::regclass and i.indisunique and i.indpred is not null
                     and c.relname in ('quiz_attempt_one_open_idx', 'quiz_attempt_one_marked_idx')) = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'trigger ' || r.name || ' on ' || r.tbl || ': its function, events, columns and condition, enabled',
       case when exists (select 1 from pg_trigger g where g.tgname = r.name and g.tgrelid = to_regclass(r.tbl) and g.tgfoid = to_regprocedure(r.fn)
                           and g.tgenabled = 'O' and g.tgdeferrable = r.deferred and g.tginitdeferred = r.deferred and g.tgtype = r.ty
                           and (select string_agg(a.attname, ',' order by a.attname collate "C") from pg_attribute a
                                 where a.attrelid = g.tgrelid and a.attnum = any (g.tgattr)) = r.cols
                           and split_part(split_part(pg_get_triggerdef(g.oid), ' WHEN ', 2), ' EXECUTE ', 1) = r.qual) then 'ok' else 'NOT AS EXPECTED' end
  from trg r
union all select 'the existing assessment_draft_guard is still there and unchanged',
       case when exists (select 1 from pg_trigger where tgrelid = 'public.assessment'::regclass and tgname = 'assessment_draft_guard' and tgenabled = 'O')
             and md5(pg_get_functiondef('public._assessment_draft_guard()'::regprocedure)) = 'c18fcd8b805c83a2b75e8ca051792658' then 'ok' else 'NOT AS EXPECTED' end
union all select 'no function of the student page names the answer key',
       case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'student_submit' and p.prosrc like '%quiz_key%') then 'ok' else 'NOT AS EXPECTED' end
union all select 'the tables start empty (' || (select count(*) from public.quiz) || ' quizzes)',
       case when (select count(*) from public.quiz) = 0 then 'ok' else 'NOT AS EXPECTED' end;
