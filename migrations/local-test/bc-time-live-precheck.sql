-- Read-only pre-check, before the apply for migrations/2026112411_bc_time_utc_minus_7.sql (2026-11-24).
-- SELECTs only, catalog facts only (no row of an app table is read). It returns ONLY the rows that differ
-- from what the file was written and tested against: no rows means ready. Run it with public on the search
-- path, as Supabase's SQL tools do.
with want(sig, md5) as (values
    -- What the file replaces or whose answer it moves, as live has them (md5 of pg_get_functiondef).
    -- FINGERPRINTS-BEGIN precheck
    ('fv_private.bulletin_audience(uuid)', '0cd8d6cc98739a5b53af1916ac0d0be3'),
    ('fv_private.bulletin_patched(bulletin,jsonb,boolean)', 'c89216a349964fc16d39033a365ccaf6'),
    ('fv_private.bulletin_pinned_now(boolean,date,text)', '3d68484d7051fd8f380fe2a84c401546'),
    ('public._cards_work_until(uuid)', '258317511f7b190e41f62a9570c9b7b7'),
    ('public._photo_keep_class(uuid,timestamp with time zone)', '67d1ae88eeacd34543cc0a80f1055991'),
    ('public._photo_keep_cutoff(uuid,timestamp with time zone)', '57f0aac3911eb4657447a951232bed4a'),
    ('student_submit._card_refusal(uuid)', '4b982e451dbd5c9c68916c99d29d2d37'),
    ('student_submit._midnight(text)', 'bf7920f2b31724bd007c66f729ac5edb'),
    ('student_submit._quiz_window(uuid,uuid)', '2eb5a1c0652415e1cd3923b79c22b101'),
    ('student_submit._session_classes(uuid)', '92eb84de662304124deb198baa75111e'),
    ('student_submit._work_window(uuid)', '904f6388c7f2b65bfb9f093f343100e4'),
    ('student_submit.bulletins(text,uuid,text)', '4753e0fa8727403e1311be6c224fd025'),
    ('student_submit.feedback(text,uuid,text)', '73b78adc4b6661bc99ca0eaebf2e81bb'),
    ('student_submit.file_links(text,uuid,uuid,text)', 'cb91bac98d5d9b4fb27ba72769b1f211'),
    ('student_submit.group_file_links(text,uuid,uuid,text)', '6d1929668e5c32090062fbd1025e0699'),
    ('student_submit.group_work(text,uuid,text)', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
    ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511'),
    ('student_submit.handout_links(text,uuid,uuid,text)', '410877d7e4d5b860b8dadb4c1b185f3c'),
    ('student_submit.handout_original(text,uuid,uuid,text)', '65e00c70081b1234c60679087c117fbe'),
    ('student_submit.markup(text,uuid,uuid,text)', '2296aefc4e38f67aad5722a2637c2fb4'),
    ('student_submit.page(text,uuid,text)', '0caa34be2c4c9f26f36a6776664d1bfa'),
    ('student_submit.reflect(text,uuid,uuid,jsonb,text)', '5f65a3ff02460ea810372d172b988b39'),
    ('student_submit.revision_finish(text,uuid,uuid,jsonb,text)', 'a04e2d62a76b00a7f6ad03a76a0ede74'),
    ('student_submit.revision_start(text,uuid,uuid,jsonb,text,uuid,text)', '43ca2e50ff067a4fb51762367895ee84'),
    ('student_submit.send_finish(text,uuid,uuid,jsonb,text)', '340cb72444d555a9cef594b543e2674c'),
    ('public._fv_timezone(text)', '8dbcb5716f155e2441f47416a0b28527'),
    ('student_submit._closed_reason(questionnaire,text)', '118a059d7d73c56cc15bf07ff17c9389'),
    ('student_submit."check"(text,text,text)', '99f1c611b868805f292dfadb6786ce08'),
    ('student_submit.forms(text,uuid,text)', '40ae918432795a5effbdd4cf6efead15'),
    ('student_submit.open(text,text,text,text)', '32b368857d41bff77defa34c3fa0a5a0'),
    ('student_submit.report(text,uuid,uuid,text)', 'd009be8b73801173f816d9a5db036b42')
    -- FINGERPRINTS-END
),
checks(check_name, value) as (
    select 'fingerprint ' || w.sig, coalesce(md5(pg_get_functiondef(to_regprocedure(w.sig))), 'absent')
      from want w
     where md5(pg_get_functiondef(to_regprocedure(w.sig))) is distinct from w.md5
    union all
    select 'Etc/GMT+7 is not UTC-7 with no daylight time here', coalesce((select utc_offset::text from pg_timezone_names where name = 'Etc/GMT+7'), 'absent')
     where not exists (select 1 from pg_timezone_names where name = 'Etc/GMT+7' and utc_offset = interval '-7 hours' and not is_dst)
    union all
    select 'PostgreSQL major version', current_setting('server_version_num')
     where current_setting('server_version_num')::int / 10000 <> 17
    union all
    select 'the role running this does not own ' || p.oid::regprocedure::text, current_user::text
      from pg_proc p
     where p.oid in (to_regprocedure('public._fv_timezone(text)'),
                     to_regprocedure('student_submit._closed_reason(questionnaire,text)'),
                     to_regprocedure('student_submit."check"(text,text,text)'),
                     to_regprocedure('student_submit.forms(text,uuid,text)'),
                     to_regprocedure('student_submit.open(text,text,text,text)'),
                     to_regprocedure('student_submit.report(text,uuid,uuid,text)'))
       and p.proowner is distinct from (select oid from pg_roles where rolname = current_user)
)
select * from checks order by 1;
