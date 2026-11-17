-- Reflections reach a student through their card, with no slip, and a teacher
-- can build their own (2026-11-16). docs/plans/reflect-plan.md.
--
-- THIS FILE DELETES NOTHING AND WRITES NO ROW. It replaces two functions
-- (student_submit._card_listed and student_submit._clean_answer) and widens
-- two checks (questionnaire.kind, question.kind). No slip, answer, report,
-- grade or score is touched, and every printed slip opens as before.
--
-- ── What broke, and why ─────────────────────────────────────────────────────
-- On Nov 16 Colin's Philosophy 12 and History 12 classes signed in with their
-- cards for the first time and the Reflect tab was empty. The card's list
-- (student_submit.forms, Batch E) showed a questionnaire only to a student
-- the teacher had printed a slip for (_card_listed: a slip not taken back, or
-- an answer already sent). History 12 had no slips; Philosophy 12 had one,
-- for one student. Turning a questionnaire On in Class Settings did not put
-- it on the student page. No real student has ever answered through a slip.
--
-- Colin: "No more QR code slips specifically for the questionnaires. Students
-- can access them through their regular sign-in. Extra codes complicates
-- things. Allow teachers to turn them on. ... i should also be able to
-- create custom questionnaires that go into their reflect section." And of
-- the builder: "provide more and better options- like MS Forms, almost."
--
-- ── What changes ────────────────────────────────────────────────────────────
-- 1. _card_listed(questionnaire, enrollment) is now true whenever the
--    questionnaire is of the student's own class. It needs no slip. The three
--    card functions that call it are not changed and go on deciding the rest
--    exactly as before: forms lists a questionnaire that is on and either
--    open or not open yet (with the day it opens), or already answered, and
--    leaves out one that is off or closed and never answered; form and answer refuse one
--    that is off or past its date as `closed` (before this file, one with no
--    slip was `not_found`). The session is still checked first, by
--    _session_class and _send_session: a student reaches only their own
--    class, and a withdrawn student reaches nothing.
--    ON THE APPLY, every questionnaire that is on and not past its closing
--    date shows in its class's Reflect tab (one not open yet shows under
--    Coming Up) for every student who signs in with a card, in a class whose
--    Student Page is on. The pre-check below lists them. A locked card can
--    read that list; it cannot open or answer one.
-- 2. questionnaire.kind also takes `custom`: a reflection a teacher builds.
-- 3. question.kind also takes `rating`, `date`, `ranking`, `likert` and
--    `section`, and _clean_answer checks an answer to each:
--      rating   a whole number from 1 to options.levels (2 to 10; 5 when the
--               question names none). Kept as value_num.
--      date     "YYYY-MM-DD", a real day. Kept as value_text.
--      ranking  an array holding every one of options.choices once, in the
--               student's order. Kept as value_json, and value_text
--               "1. A · 2. B".
--      likert   an object {statement: choice} for the statements answered,
--               each statement one of options.statements and each choice one
--               of options.choices. Kept as value_json, and value_text
--               "statement: choice · ...".
--      section  a heading. It takes no answer: one sent for it is `invalid`.
--    Every existing kind (text, short_set, choice, scale4, goal_status,
--    core_pick) is checked word for word as before. A slip's submit and a
--    card's answer both call _clean_answer and are not changed.
--    "Required" on a question (options.required) is checked on the student
--    page only, not here.
--
-- ── What the app already in browsers sends ──────────────────────────────────
-- Nothing is tightened. The released teacher app saves only the old kinds;
-- the released student page sends only the old answers. A student page
-- cached from before the release shows a new kind's question as nothing and
-- sends no answer for it.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, unless each of the two functions is the
-- definition live has today or, on a second run, as this file leaves it
-- (md5 of pg_get_functiondef on PostgreSQL 17); each function it relies on
-- to decide the rest is the one it was tested with; and each of the two
-- checks reads as live has it today or as this file leaves it. The function
-- lists are written by migrations/local-test/reflect_from_card.py, never by
-- hand.
--
-- ── Before and after the apply (read-only) ──────────────────────────────────
-- migrations/local-test/reflect-from-card-live-precheck.sql before, and
-- reflect-from-card-live-postcheck.sql after. Both read the catalogs and
-- counts only.
-- The pre-check on gradebook-prod, 2026-11-16 (read-only): nothing that
-- would stop the file, and every function relied on is the one tested.
-- Three reflections are on and not past their closing date (About Me in two
-- Humanities 8 classes, November Reflection in one), all in classes where
-- no student has a card yet, so no student sees anything new on the apply.
-- Run it again right before applying: that count is of that day.
-- The reflections in Philosophy 12 and History 12 are off: they show once
-- their teacher turns them on.
--
-- ── Taking it back out ──────────────────────────────────────────────────────
-- migrations/local-test/reflect-from-card-undo.sql puts the two functions
-- back word for word, and the two checks back once no row uses a new kind.
-- It deletes nothing.
--
-- One transaction: all or nothing.
begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f   record;
    _md5 text;
    _def text;
begin
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN functions (written by migrations/local-test/reflect_from_card.py)
            ('student_submit._card_listed(uuid,uuid)',                'a0dc2d9e540be764da89a98e83751260', 'b594802f9fa517b4b5391cab24e31d03'),
            ('student_submit._clean_answer(text,jsonb,text[],jsonb)', '0f8377c8b45d14bc5c1b93c04852e49d', 'b944ef1d218b55c811e41973ebe5126f')
            -- FINGERPRINTS-END
        ) as v(fn, live, becomes)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.live and _md5 <> _f.becomes then
            raise exception '% is not the definition this file was written against (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.live;
        end if;
    end loop;
    -- The functions that decide the rest (whose session it is, on or off,
    -- open or closed, already sent), which this file does not change and
    -- now leans on entirely: each must be the one it was tested with.
    for _f in
        select * from (values
            -- FINGERPRINTS-BEGIN relied (written by migrations/local-test/reflect_from_card.py)
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
        ) as v(fn, tested)
    loop
        _md5 := coalesce(md5(pg_get_functiondef(to_regprocedure(_f.fn))), 'absent');
        if _md5 <> _f.tested then
            raise exception '% is relied on, and is not the definition this file was tested with (found %, expected %). Nothing was changed.',
                _f.fn, _md5, _f.tested;
        end if;
    end loop;
    -- The two checks, as live has them or as this file leaves them (these two
    -- lists are written here, by hand, and the harness proves them).
    for _f in
        select * from (values
            ('public.questionnaire', 'questionnaire_kind_check',
             'CHECK ((kind = ANY (ARRAY[''about_me''::text, ''core_reflection''::text, ''goal_checkin''::text, ''curricular_self_assessment''::text])))',
             'CHECK ((kind = ANY (ARRAY[''about_me''::text, ''core_reflection''::text, ''goal_checkin''::text, ''curricular_self_assessment''::text, ''custom''::text])))'),
            ('public.question', 'question_kind_check',
             'CHECK ((kind = ANY (ARRAY[''text''::text, ''short_set''::text, ''scale4''::text, ''choice''::text, ''goal_status''::text, ''core_pick''::text])))',
             'CHECK ((kind = ANY (ARRAY[''text''::text, ''short_set''::text, ''scale4''::text, ''choice''::text, ''goal_status''::text, ''core_pick''::text, ''rating''::text, ''date''::text, ''ranking''::text, ''likert''::text, ''section''::text])))')
        ) as v(tbl, con, live, becomes)
    loop
        select pg_get_constraintdef(c.oid) into _def
          from pg_constraint c where c.conrelid = to_regclass(_f.tbl) and c.conname = _f.con;
        if _def is null or (_def <> _f.live and _def <> _f.becomes) then
            raise exception 'The check % on % does not read as this file was written against (found %). Nothing was changed.',
                _f.con, _f.tbl, coalesce(_def, 'no such check');
        end if;
    end loop;
end
$guard$;

-- ── 1. A card lists its class's questionnaires, slip or no slip ─────────────
-- Whether a questionnaire is this student's: it is of the class they are
-- enrolled in. forms, form and answer check the session before they ask,
-- and decide open, not open yet, closed and already sent themselves.
create or replace function student_submit._card_listed(p_questionnaire_id uuid, p_enrollment_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
    select exists (select 1 from questionnaire q
                     join enrollment e on e.course_id = q.course_id
                    where q.id = p_questionnaire_id and e.id = p_enrollment_id);
$function$;

-- ── 2. A reflection a teacher builds ────────────────────────────────────────
alter table public.questionnaire
    drop constraint questionnaire_kind_check,
    add constraint questionnaire_kind_check
        check (kind = any (array['about_me', 'core_reflection', 'goal_checkin', 'curricular_self_assessment', 'custom']));

-- ── 3. Its kinds of question ────────────────────────────────────────────────
alter table public.question
    drop constraint question_kind_check,
    add constraint question_kind_check
        check (kind = any (array['text', 'short_set', 'scale4', 'choice', 'goal_status', 'core_pick',
                                 'rating', 'date', 'ranking', 'likert', 'section']));

-- One answer, checked and made ready to keep: {num, text, json}, null when
-- it is empty, and an exception when it cannot be read (submit and answer
-- turn that into `invalid`). Every branch down to core_pick is as
-- 20261025_student_submit_phone.sql left it; rating, date, ranking and
-- likert are new. A section takes no answer, so it falls to the last line.
create or replace function student_submit._clean_answer(p_kind text, p_options jsonb, p_core_ids text[], p_value jsonb)
 returns jsonb
 language plpgsql
 immutable
 security definer
 set search_path to 'public', 'student_submit', 'pg_temp'
as $function$
declare
    _t      text;
    _arr    jsonb := '[]'::jsonb;
    _e      jsonb;
    _k      text;
    _n      int;
    _levels jsonb := '{}'::jsonb;
    _why    jsonb;
    _whys   jsonb := '{}'::jsonb;
    _v      numeric;
    _list   jsonb;
    _cols   jsonb;
begin
    if p_value is null or p_value = 'null'::jsonb then return null; end if;
    if p_kind = 'text' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := btrim(p_value #>> '{}');
        if _t = '' then return null; end if;
        if char_length(_t) > 2000 then raise exception 'invalid'; end if;
        return jsonb_build_object('text', _t);
    elsif p_kind = 'short_set' then
        if jsonb_typeof(p_value) <> 'array'
           or jsonb_array_length(p_value) > greatest(jsonb_array_length(coalesce(p_options->'labels', '[]')), 1) then
            raise exception 'invalid';
        end if;
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' or char_length(_e #>> '{}') > 300 then raise exception 'invalid'; end if;
            _arr := _arr || to_jsonb(btrim(_e #>> '{}'));
        end loop;
        if not exists (select 1 from jsonb_array_elements_text(_arr) v where v <> '') then return null; end if;
        return jsonb_build_object('json', _arr,
               'text', (select string_agg(v, ' · ') from jsonb_array_elements_text(_arr) v where v <> ''));
    elsif p_kind = 'choice' then
        if jsonb_typeof(p_value) = 'string' then p_value := jsonb_build_array(p_value); end if;
        if jsonb_typeof(p_value) <> 'array' then raise exception 'invalid'; end if;
        -- Listed choices, plus typed-in ones (60 characters each) when the
        -- question allows another.
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' then raise exception 'invalid'; end if;
            _t := btrim(_e #>> '{}');
            continue when _t = '' or _arr ? _t;
            if not (coalesce(p_options->'choices', '[]') ? _t)
               and (coalesce(p_options->>'other', '') <> 'true' or char_length(_t) > 60) then
                raise exception 'invalid';
            end if;
            _arr := _arr || to_jsonb(_t);
        end loop;
        if jsonb_array_length(_arr) = 0 then return null; end if;
        if jsonb_array_length(_arr) > 20
           or ((p_options->>'multiple') = 'false' and jsonb_array_length(_arr) > 1) then
            raise exception 'invalid';
        end if;
        return jsonb_build_object('json', _arr,
               'text', (select string_agg(v, ', ') from jsonb_array_elements_text(_arr) v));
    elsif p_kind = 'scale4' then
        -- {levels: {PAR: 3, PPI: 2}, why: {PAR: '…', PPI: '…'}} on Core
        -- Competencies (why may also be one string), or {level: 3, why: '…'}.
        if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid'; end if;
        _why := coalesce(p_value->'why', 'null'::jsonb);
        if jsonb_typeof(_why) = 'string' then
            _t := nullif(btrim(_why #>> '{}'), '');
            if char_length(coalesce(_t, '')) > 2000 then raise exception 'invalid'; end if;
        elsif jsonb_typeof(_why) = 'object' and cardinality(p_core_ids) > 0 then
            for _k, _e in select * from jsonb_each(_why) loop
                if not (_k = any(p_core_ids)) or jsonb_typeof(_e) <> 'string' or char_length(_e #>> '{}') > 1000 then
                    raise exception 'invalid';
                end if;
                if btrim(_e #>> '{}') <> '' then
                    _whys := _whys || jsonb_build_object(_k, btrim(_e #>> '{}'));
                end if;
            end loop;
        elsif _why <> 'null'::jsonb then
            raise exception 'invalid';
        end if;
        if cardinality(p_core_ids) > 0 then
            if jsonb_typeof(coalesce(p_value->'levels', '{}')) <> 'object' then raise exception 'invalid'; end if;
            for _k, _e in select * from jsonb_each(coalesce(p_value->'levels', '{}')) loop
                if not (_k = any(p_core_ids)) or jsonb_typeof(_e) <> 'number'
                   or (_e #>> '{}')::numeric not in (1, 2, 3, 4) then
                    raise exception 'invalid';
                end if;
                _levels := _levels || jsonb_build_object(_k, (_e #>> '{}')::int);
            end loop;
            if _levels = '{}'::jsonb and _t is null and _whys = '{}'::jsonb then return null; end if;
            return jsonb_build_object(
                'json', jsonb_build_object('levels', _levels)
                        || case when _whys <> '{}'::jsonb then jsonb_build_object('why', _whys)
                                when _t is not null then jsonb_build_object('why', _t)
                                else '{}'::jsonb end,
                'text', coalesce(_t, (select string_agg(v, ' · ') from jsonb_each_text(_whys) w(k, v))));
        end if;
        if p_value ? 'level' then
            if jsonb_typeof(p_value->'level') <> 'number' or (p_value->>'level')::numeric not in (1, 2, 3, 4) then
                raise exception 'invalid';
            end if;
            _n := (p_value->>'level')::int;
        end if;
        if _n is null and _t is null then return null; end if;
        return jsonb_build_object('num', _n, 'text', _t);
    elsif p_kind = 'goal_status' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := p_value #>> '{}';
        select i into _n from jsonb_array_elements_text(coalesce(p_options->'choices', '[]')) with ordinality c(v, i)
         where v = _t;
        if _n is null then raise exception 'invalid'; end if;
        return jsonb_build_object('num', _n, 'text', _t);
    elsif p_kind = 'core_pick' then
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := p_value #>> '{}';
        if not (_t = any(case when cardinality(p_core_ids) > 0 then p_core_ids
                              else array['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR'] end)) then
            raise exception 'invalid';
        end if;
        return jsonb_build_object('text', _t);
    elsif p_kind = 'rating' then
        -- A whole number from 1 to the question's levels: 2 to 10, and 5
        -- when the question names none or names something else.
        if jsonb_typeof(p_value) <> 'number' then raise exception 'invalid'; end if;
        _n := 5;
        if jsonb_typeof(p_options->'levels') = 'number' then
            _v := (p_options->>'levels')::numeric;
            if _v = trunc(_v) and _v between 2 and 10 then _n := _v::int; end if;
        end if;
        _v := (p_value #>> '{}')::numeric;
        if _v <> trunc(_v) or _v < 1 or _v > _n then raise exception 'invalid'; end if;
        return jsonb_build_object('num', _v::int);
    elsif p_kind = 'date' then
        -- "YYYY-MM-DD", and a real day: make_date refuses February 30.
        if jsonb_typeof(p_value) <> 'string' then raise exception 'invalid'; end if;
        _t := btrim(p_value #>> '{}');
        if _t = '' then return null; end if;
        if _t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid'; end if;
        perform make_date(substr(_t, 1, 4)::int, substr(_t, 6, 2)::int, substr(_t, 9, 2)::int);
        return jsonb_build_object('text', _t);
    elsif p_kind = 'ranking' then
        -- Every one of the question's choices, once, in the student's order.
        _list := coalesce(p_options->'choices', '[]'::jsonb);
        if jsonb_typeof(p_value) <> 'array' or jsonb_typeof(_list) <> 'array' then raise exception 'invalid'; end if;
        if jsonb_array_length(p_value) = 0 then return null; end if;
        for _e in select * from jsonb_array_elements(p_value) loop
            if jsonb_typeof(_e) <> 'string' then raise exception 'invalid'; end if;
            _t := _e #>> '{}';
            if _arr ? _t or not (_list ? _t) then raise exception 'invalid'; end if;
            _arr := _arr || to_jsonb(_t);
        end loop;
        if jsonb_array_length(_arr) <> (select count(distinct v) from jsonb_array_elements_text(_list) v) then
            raise exception 'invalid';
        end if;
        _t := (select string_agg(i || '. ' || v, ' · ' order by i)
                 from jsonb_array_elements_text(_arr) with ordinality x(v, i));
        -- answer.value_text holds 5,000 characters: longer is refused here, not by the table.
        if char_length(_t) > 5000 then raise exception 'invalid'; end if;
        return jsonb_build_object('json', _arr, 'text', _t);
    elsif p_kind = 'likert' then
        -- {statement: choice} for the statements answered: each statement
        -- one of the question's, each choice one of its columns.
        _list := coalesce(p_options->'statements', '[]'::jsonb);
        _cols := coalesce(p_options->'choices', '[]'::jsonb);
        if jsonb_typeof(p_value) <> 'object' or jsonb_typeof(_list) <> 'array' or jsonb_typeof(_cols) <> 'array' then
            raise exception 'invalid';
        end if;
        for _k, _e in select * from jsonb_each(p_value) loop
            if jsonb_typeof(_e) <> 'string' or not (_list ? _k) or not (_cols ? (_e #>> '{}')) then
                raise exception 'invalid';
            end if;
            _levels := _levels || jsonb_build_object(_k, _e #>> '{}');
        end loop;
        if _levels = '{}'::jsonb then return null; end if;
        _t := (select string_agg(s || ': ' || (_levels->>s), ' · ' order by i)
                 from (select s, min(i) as i from jsonb_array_elements_text(_list) with ordinality x(s, i)
                        where _levels ? s group by s) y);
        if char_length(_t) > 5000 then raise exception 'invalid'; end if;
        return jsonb_build_object('json', _levels, 'text', _t);
    end if;
    raise exception 'invalid';
end;
$function$;

commit;
