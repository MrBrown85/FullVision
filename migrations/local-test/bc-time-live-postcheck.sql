-- Read-only post-check, after the apply for migrations/2026112411_bc_time_utc_minus_7.sql (2026-11-24).
-- SELECTs only, catalog facts and the answers of one pure function. Every row says ok. Run it with public on
-- the search path, as Supabase's SQL tools do.
with want(sig, after_md5) as (values
    -- FINGERPRINTS-BEGIN postcheck
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
    ('public._fv_timezone(text)', '028dfb6cb7ab9cf43e29b0267a65d8d6'),
    ('student_submit._closed_reason(questionnaire,text)', 'd1d3d5270abdc21fa20651ab64ae4d6d'),
    ('student_submit."check"(text,text,text)', '87c95addbfe06444c8350a774e8e984c'),
    ('student_submit.forms(text,uuid,text)', 'e0445a5cb7018f27bdcdb1e0f2c2171d'),
    ('student_submit.open(text,text,text,text)', '49d84f9a59520e5ae3b53716ae75f14d'),
    ('student_submit.report(text,uuid,uuid,text)', '1e6beb102ac13d27c852f76075dbee86')
    -- FINGERPRINTS-END
)
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select '_fv_timezone gives Etc/GMT+7 for America/Vancouver, blank, null and a name that is not a zone',
       case when public._fv_timezone('America/Vancouver') = 'Etc/GMT+7' and public._fv_timezone('') = 'Etc/GMT+7'
             and public._fv_timezone(null) = 'Etc/GMT+7' and public._fv_timezone('Not/AZone') = 'Etc/GMT+7' then 'ok' else 'NOT AS EXPECTED' end
union all select '_fv_timezone gives another zone back as given',
       case when public._fv_timezone('America/Toronto') = 'America/Toronto' then 'ok' else 'NOT AS EXPECTED' end
union all select 'BC midnight is 07:00 UTC, winter and summer',
       case when (timestamptz '2026-11-24 06:59:00+00' at time zone public._fv_timezone('America/Vancouver')) = timestamp '2026-11-23 23:59:00'
             and (timestamptz '2026-11-24 07:00:00+00' at time zone public._fv_timezone('America/Vancouver')) = timestamp '2026-11-24 00:00:00'
             and (timestamptz '2026-07-15 07:00:00+00' at time zone public._fv_timezone('America/Vancouver')) = timestamp '2026-07-15 00:00:00' then 'ok' else 'NOT AS EXPECTED' end
union all select 'the five student_submit functions read their zone through _fv_timezone and spell no zone name',
       case when (select count(*) from unnest(array[to_regprocedure('student_submit._closed_reason(questionnaire,text)'),
                                                    to_regprocedure('student_submit."check"(text,text,text)'),
                                                    to_regprocedure('student_submit.forms(text,uuid,text)'),
                                                    to_regprocedure('student_submit.open(text,text,text,text)'),
                                                    to_regprocedure('student_submit.report(text,uuid,uuid,text)')]) f
                   where pg_get_functiondef(f) like '%public._fv_timezone(%' and pg_get_functiondef(f) not like '%America/Vancouver%') = 5 then 'ok' else 'NOT AS EXPECTED' end
union all select 'a stored name is still America/Vancouver on create_course (the default is left alone)',
       case when pg_get_functiondef(to_regprocedure('public.create_course(text,text,text,text,text,text,numeric,text,text,text[],uuid,text)')) like '%p_timezone text DEFAULT ''America/Vancouver''%' then 'ok' else 'NOT AS EXPECTED' end;
