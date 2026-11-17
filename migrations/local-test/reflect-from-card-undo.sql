-- REFLECT FROM THE CARD, UNDONE. Not a migration: the way back from
-- migrations/2026111620_reflect_from_the_card.sql. Kept under local-test/ so
-- CI's drift check does not wait for it to be applied. Proved by
-- migrations/local-test/reflect_from_card.py (scenario undo).
--
-- It puts the two functions back word for word (the bodies below are written
-- by reflect_from_card.py from the database the file was tested on, never by
-- hand): a card again lists a questionnaire only for a student with a slip
-- for it, and an answer to a rating, date, ranking or likert question is
-- again refused as invalid. It puts each of the two checks back only when no
-- row uses a kind the file added (a reflection a teacher built, or one of
-- its questions); otherwise it leaves that check wide and says so. It
-- deletes nothing: reflections, questions and answers all stay.
--
-- The fast stop, if all that is wanted is the slip rule back: run only the
-- first function below (student_submit._card_listed).
--
-- It refuses, with nothing changed, unless each function is as the file
-- leaves it or already as it was before (a second run changes nothing).
begin;
set local lock_timeout = '5s';
do $guard$
declare
    _f   record;
    _md5 text;
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
            raise exception '% is neither as the file leaves it nor as it was before (found %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
end
$guard$;

-- UNDO-BODIES-BEGIN (written by migrations/local-test/reflect_from_card.py)
CREATE OR REPLACE FUNCTION student_submit._card_listed(p_questionnaire_id uuid, p_enrollment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
    select exists (select 1 from student_access_code c
                    where c.questionnaire_id = p_questionnaire_id and c.enrollment_id = p_enrollment_id
                      and c.revoked_at is null)
        or exists (select 1 from response r
                    where r.questionnaire_id = p_questionnaire_id and r.enrollment_id = p_enrollment_id);
$function$;

CREATE OR REPLACE FUNCTION student_submit._clean_answer(p_kind text, p_options jsonb, p_core_ids text[], p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _t      text;
    _arr    jsonb := '[]'::jsonb;
    _e      jsonb;
    _k      text;
    _n      int;
    _levels jsonb := '{}'::jsonb;
    _why    jsonb;
    _whys   jsonb := '{}'::jsonb;
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
    end if;
    raise exception 'invalid';
end;
$function$;
-- UNDO-BODIES-END

do $checks$
begin
    if exists (select 1 from public.questionnaire where kind = 'custom') then
        raise notice 'questionnaire_kind_check is left as it is: reflections a teacher built are still here.';
    else
        alter table public.questionnaire
            drop constraint questionnaire_kind_check,
            add constraint questionnaire_kind_check
                check (kind = any (array['about_me', 'core_reflection', 'goal_checkin', 'curricular_self_assessment']));
    end if;
    if exists (select 1 from public.question where kind in ('rating', 'date', 'ranking', 'likert', 'section')) then
        raise notice 'question_kind_check is left as it is: questions of the new kinds are still here.';
    else
        alter table public.question
            drop constraint question_kind_check,
            add constraint question_kind_check
                check (kind = any (array['text', 'short_set', 'scale4', 'choice', 'goal_status', 'core_pick']));
    end if;
end
$checks$;

commit;
