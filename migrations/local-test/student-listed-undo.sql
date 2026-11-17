-- Undo for migrations/2026111702_student_listed_rule.sql (2026-11-17).
--
-- Puts each of the 10 functions back, word for word as live had it before
-- the file (the rule spelled out again), then drops student_submit._listed.
-- No row changes, and what students see stays the same throughout.
--
-- It stops with nothing changed if a function is neither the file's
-- definition nor the one before it (a later change would be lost), or if
-- _listed is not the file's. On a database where the file was never
-- applied it changes nothing; a second run changes nothing.
--
-- md5 of pg_get_functiondef (function, before the file, as the file leaves it):
--   student_submit._session_classes(uuid)                 f6751bf9a7803a84067df8efad66f490  35e766379278258651709e73b9f05940
--   student_submit._work_window(uuid)                     07e70e0c63675e895b1db9d6b4d8a472  904f6388c7f2b65bfb9f093f343100e4
--   student_submit.feedback(text,uuid,text)               0c01e9f5d2efee024e1592fb8a42b6d8  e093fd549255e5f938491066a5e2ea1c
--   student_submit.group_work(text,uuid,text)             6d1a251fdcc1261129e0c1025c977943  fd39a0807e49ab3e6f68860d0e78ee2f
--   student_submit.page(text,uuid,text)                   0508ea6a4e183bac79c18df4a1135917  b2781abd6d579e3dc72b3f5f801bb917
--   student_submit.file_links(text,uuid,uuid,text)        c977ce3010a3c849110c60195caf2f6e  cb91bac98d5d9b4fb27ba72769b1f211
--   student_submit.group_file_links(text,uuid,uuid,text)  f7a4bf32ea97c2d1dd11e28e7d9cf117  6d1929668e5c32090062fbd1025e0699
--   student_submit.handout_links(text,uuid,uuid,text)     822a5ed9b9433f6ef29af3b8e5856070  410877d7e4d5b860b8dadb4c1b185f3c
--   student_submit.markup(text,uuid,uuid,text)            3f4031af1d0bb67e15e27eaae7c275cf  2296aefc4e38f67aad5722a2637c2fb4
--   student_submit.reflect(text,uuid,uuid,jsonb,text)     c77950cbe4d79e1f0e73a46d720d9545  5f65a3ff02460ea810372d172b988b39

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
    _listed text := md5(pg_get_functiondef(to_regprocedure('student_submit._listed(public.assessment,date)')));
begin
    if _listed is not null and _listed <> 'ee5745a778e8ac1cb56f013d1c3e034e' then
        raise exception 'student_submit._listed is not the file''s (md5 %). Nothing was changed.', _listed;
    end if;
    for _f in select * from (values
        ('student_submit._session_classes(uuid)', 'f6751bf9a7803a84067df8efad66f490', '35e766379278258651709e73b9f05940'),
        ('student_submit._work_window(uuid)', '07e70e0c63675e895b1db9d6b4d8a472', '904f6388c7f2b65bfb9f093f343100e4'),
        ('student_submit.feedback(text,uuid,text)', '0c01e9f5d2efee024e1592fb8a42b6d8', 'e093fd549255e5f938491066a5e2ea1c'),
        ('student_submit.group_work(text,uuid,text)', '6d1a251fdcc1261129e0c1025c977943', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
        ('student_submit.page(text,uuid,text)', '0508ea6a4e183bac79c18df4a1135917', 'b2781abd6d579e3dc72b3f5f801bb917'),
        ('student_submit.file_links(text,uuid,uuid,text)', 'c977ce3010a3c849110c60195caf2f6e', 'cb91bac98d5d9b4fb27ba72769b1f211'),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 'f7a4bf32ea97c2d1dd11e28e7d9cf117', '6d1929668e5c32090062fbd1025e0699'),
        ('student_submit.handout_links(text,uuid,uuid,text)', '822a5ed9b9433f6ef29af3b8e5856070', '410877d7e4d5b860b8dadb4c1b185f3c'),
        ('student_submit.markup(text,uuid,uuid,text)', '3f4031af1d0bb67e15e27eaae7c275cf', '2296aefc4e38f67aad5722a2637c2fb4'),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 'c77950cbe4d79e1f0e73a46d720d9545', '5f65a3ff02460ea810372d172b988b39')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and _md5 is distinct from _f.now then
            raise exception '% is neither the file''s definition nor the one before it (md5 %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing');
        end if;
    end loop;
end
$guard$;

-- Each function back to the definition before the file, then the rule's function goes.
do $patch$
declare
    _f    record;
    _s    record;
    _def  text;
    _n    int;
begin
    for _f in select * from (values
        ('student_submit._session_classes(uuid)', 'f6751bf9a7803a84067df8efad66f490', '35e766379278258651709e73b9f05940'),
        ('student_submit._work_window(uuid)', '07e70e0c63675e895b1db9d6b4d8a472', '904f6388c7f2b65bfb9f093f343100e4'),
        ('student_submit.feedback(text,uuid,text)', '0c01e9f5d2efee024e1592fb8a42b6d8', 'e093fd549255e5f938491066a5e2ea1c'),
        ('student_submit.group_work(text,uuid,text)', '6d1a251fdcc1261129e0c1025c977943', 'fd39a0807e49ab3e6f68860d0e78ee2f'),
        ('student_submit.page(text,uuid,text)', '0508ea6a4e183bac79c18df4a1135917', 'b2781abd6d579e3dc72b3f5f801bb917'),
        ('student_submit.file_links(text,uuid,uuid,text)', 'c977ce3010a3c849110c60195caf2f6e', 'cb91bac98d5d9b4fb27ba72769b1f211'),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 'f7a4bf32ea97c2d1dd11e28e7d9cf117', '6d1929668e5c32090062fbd1025e0699'),
        ('student_submit.handout_links(text,uuid,uuid,text)', '822a5ed9b9433f6ef29af3b8e5856070', '410877d7e4d5b860b8dadb4c1b185f3c'),
        ('student_submit.markup(text,uuid,uuid,text)', '3f4031af1d0bb67e15e27eaae7c275cf', '2296aefc4e38f67aad5722a2637c2fb4'),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 'c77950cbe4d79e1f0e73a46d720d9545', '5f65a3ff02460ea810372d172b988b39')
    ) as v(fn, was, now) loop
        _def := pg_get_functiondef(to_regprocedure(_f.fn));
        continue when md5(_def) = _f.was;
        for _s in select * from (values
        ('student_submit._session_classes(uuid)', 1,
         $o$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date)$o$,
         $n$and (a.date_assigned is null
                                 or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                            and not a.is_draft  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$n$),
        ('student_submit._work_window(uuid)', 1,
         $o$'listed', student_submit._listed(a, d.today),$o$,
         $n$-- 2026111701: a Draft is not on the student's page until the teacher assigns it
               'listed', not a.is_draft and (a.date_assigned is null or a.date_assigned <= d.today),$n$),
        ('student_submit.feedback(text,uuid,text)', 1,
         $o$student_submit._listed(a, _today)$o$,
         $n$(a.date_assigned is null or a.date_assigned <= _today) and not a.is_draft$n$),
        ('student_submit.group_work(text,uuid,text)', 1,
         $o$student_submit._listed(a, _today)$o$,
         $n$(a.date_assigned is null or a.date_assigned <= _today) and not a.is_draft$n$),
        ('student_submit.page(text,uuid,text)', 3,
         $o$student_submit._listed(a, _today)$o$,
         $n$(a.date_assigned is null or a.date_assigned <= _today) and not a.is_draft$n$),
        ('student_submit.file_links(text,uuid,uuid,text)', 1,
         $o$-- E4: a piece not on the student's page (student_submit._listed): no link for its pages$o$,
         $n$-- E4: a piece dated in the future is not on the student's page: no link for its pages$n$),
        ('student_submit.file_links(text,uuid,uuid,text)', 1,
         $o$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date))$o$,
         $n$and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                               and not a.is_draft)$n$),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 1,
         $o$-- E4: a piece not on the student's page (student_submit._listed): no link for its pages$o$,
         $n$-- E4: a piece dated in the future is not on the student's page: no link for its pages$n$),
        ('student_submit.group_file_links(text,uuid,uuid,text)', 1,
         $o$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date))$o$,
         $n$and (a.date_assigned is null
                                    or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
                               and not a.is_draft)$n$),
        ('student_submit.handout_links(text,uuid,uuid,text)', 1,
         $o$and student_submit._listed(a, (now() at time zone public._fv_timezone(c.timezone))::date);$o$,
         $n$and (a.date_assigned is null
            or a.date_assigned <= (now() at time zone public._fv_timezone(c.timezone))::date)
       and not a.is_draft;  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$n$),
        ('student_submit.markup(text,uuid,uuid,text)', 1,
         $o$-- E4: a piece not on the student's page (student_submit._listed): nothing of it is served$o$,
         $n$-- E4: a piece dated in the future is not on the student's page: nothing of it is served$n$),
        ('student_submit.markup(text,uuid,uuid,text)', 1,
         $o$and student_submit._listed(assessment, (now() at time zone public._fv_timezone(_course.timezone))::date);$o$,
         $n$and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date)
       and not is_draft;  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$n$),
        ('student_submit.reflect(text,uuid,uuid,jsonb,text)', 1,
         $o$and student_submit._listed(assessment, (now() at time zone public._fv_timezone(_course.timezone))::date);$o$,
         $n$and (date_assigned is null or date_assigned <= (now() at time zone public._fv_timezone(_course.timezone))::date)
       and not is_draft;  -- 2026111701: a Draft is not on the student's page until the teacher assigns it$n$)
        ) as s(fn, times, find, put) where s.fn = _f.fn loop
            _n := (length(_def) - length(replace(_def, _s.find, ''))) / length(_s.find);
            if _n <> _s.times then
                raise exception '% holds the text to change % time(s), not %. Nothing was changed.', _f.fn, _n, _s.times;
            end if;
            _def := replace(_def, _s.find, _s.put);
        end loop;
        if md5(_def) <> _f.was then
            raise exception '% would not be the expected definition (md5 %, expected %). Nothing was changed.', _f.fn, md5(_def), _f.was;
        end if;
        execute _def;
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) <> _f.was then
            raise exception '% did not come out as expected. Nothing was changed.', _f.fn;
        end if;
    end loop;
end
$patch$;

drop function if exists student_submit._listed(public.assessment, date);

commit;
