-- Re-approving a changed comment dates the approval today (2026-11-02).
--
-- What broke: save_term_rating set approved_at to
-- coalesce(_old.approved_at, now()) whenever the payload said approved: true.
-- When one save both changed the narrative and re-approved it (Cmd+Return
-- inside the 600 ms debounce), the old approval date was kept, so the record
-- said the comment was approved before its current text existed, while the
-- device showed today.
--
-- What changes: approved: true sets approved_at to now() when the narrative
-- changed in this save or there was no earlier approval, and keeps the old
-- date when the narrative did not change. approved: false still clears it,
-- and an edit without the approved key still clears it. Everything else in
-- save_term_rating is as in 20261031_term_rating_draft_meta.sql.
-- No data changes.

begin;

create or replace function public.save_term_rating(p_enrollment_id uuid, p_term integer, p_payload jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
    _tr_id uuid; _old term_rating%rowtype;
    _new_nar text; _new_wh int; _new_pr int; _new_st text[];
    _new_habits jsonb; _new_approved timestamptz;
    _new_basis text; _new_deadline date; _new_meta jsonb;
    _elem jsonb; _u uuid;
    _old_dim_map jsonb; _new_dim_map jsonb := '{}';
    _sec_id uuid; _rating int;
    _kv record;
begin
    if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
    if p_term < 1 or p_term > 6 then raise exception 'term must be 1..6' using errcode = '22023'; end if;

    if p_payload ? 'work_habits_rating' then
        _new_wh := nullif(p_payload->>'work_habits_rating','')::int;
        if _new_wh is not null and (_new_wh < 1 or _new_wh > 4) then
            raise exception 'work_habits_rating must be 1..4' using errcode = '22023';
        end if;
    end if;
    if p_payload ? 'participation_rating' then
        _new_pr := nullif(p_payload->>'participation_rating','')::int;
        if _new_pr is not null and (_new_pr < 1 or _new_pr > 4) then
            raise exception 'participation_rating must be 1..4' using errcode = '22023';
        end if;
    end if;
    if p_payload ? 'habits' then
        if jsonb_typeof(p_payload->'habits') is distinct from 'object' then
            raise exception 'habits must be an object' using errcode = '22023';
        end if;
        for _kv in select key as k, value as v from jsonb_each(p_payload->'habits') loop
            if _kv.k not in ('completes', 'ready', 'others', 'part', 'feedback', 'devices') then
                raise exception 'unknown habit %', _kv.k using errcode = '22023';
            end if;
            if jsonb_typeof(_kv.v) is distinct from 'number' or (_kv.v #>> '{}') !~ '^[1-5]$' then
                raise exception 'habit % must be 1..5', _kv.k using errcode = '22023';
            end if;
        end loop;
    end if;
    if p_payload ? 'approved' and jsonb_typeof(p_payload->'approved') is distinct from 'boolean' then
        raise exception 'approved must be true or false' using errcode = '22023';
    end if;
    if p_payload ? 'reporting_basis'
       and coalesce(p_payload->>'reporting_basis', '') not in ('grade', 'ie', 'language_goals', 'iep_goals') then
        raise exception 'reporting_basis must be grade, ie, language_goals or iep_goals' using errcode = '22023';
    end if;
    if p_payload ? 'ie_deadline' and jsonb_typeof(p_payload->'ie_deadline') <> 'null'
       and coalesce(p_payload->>'ie_deadline', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'ie_deadline must be a date (YYYY-MM-DD) or null' using errcode = '22023';
    end if;
    if p_payload ? 'draft_meta' and jsonb_typeof(p_payload->'draft_meta') <> 'null' then
        if jsonb_typeof(p_payload->'draft_meta') <> 'object' then
            raise exception 'draft_meta must be an object or null' using errcode = '22023';
        end if;
        if octet_length((p_payload->'draft_meta')::text) > 65536 then
            raise exception 'draft_meta is over 64 KB' using errcode = '22023';
        end if;
        if coalesce(jsonb_typeof(p_payload->'draft_meta'->'sentences'), 'array') <> 'array'
           or coalesce(jsonb_typeof(p_payload->'draft_meta'->'slots'), 'object') <> 'object'
           or coalesce(jsonb_typeof(p_payload->'draft_meta'->'class_sentences'), 'object') <> 'object'
           or coalesce(jsonb_typeof(p_payload->'draft_meta'->'facts_hash'), 'string') <> 'string' then
            raise exception 'draft_meta: sentences must be an array, slots and class_sentences objects, facts_hash a string'
                using errcode = '22023';
        end if;
    end if;

    select * into _old from term_rating where enrollment_id = p_enrollment_id and term = p_term;

    _new_nar := case when p_payload ? 'narrative_html' then p_payload->>'narrative_html' else _old.narrative_html end;
    _new_wh  := case when p_payload ? 'work_habits_rating'
                    then nullif(p_payload->>'work_habits_rating','')::int else _old.work_habits_rating end;
    _new_pr  := case when p_payload ? 'participation_rating'
                    then nullif(p_payload->>'participation_rating','')::int else _old.participation_rating end;
    if p_payload ? 'social_traits' and jsonb_typeof(p_payload->'social_traits') = 'array' then
        select array_agg(v #>> '{}') into _new_st from jsonb_array_elements(p_payload->'social_traits') v;
        _new_st := coalesce(_new_st, '{}');
    else
        _new_st := coalesce(_old.social_traits, '{}');
    end if;
    _new_habits := case when p_payload ? 'habits' then p_payload->'habits' else coalesce(_old.habits, '{}'::jsonb) end;
    _new_approved := case
        when p_payload ? 'approved' and (p_payload->>'approved')::boolean then
            case when _new_nar is distinct from _old.narrative_html then now()
                 else coalesce(_old.approved_at, now()) end
        when p_payload ? 'approved' then null
        when _new_nar is distinct from _old.narrative_html then null
        else _old.approved_at
    end;
    _new_basis := case when p_payload ? 'reporting_basis' then p_payload->>'reporting_basis'
                       else coalesce(_old.reporting_basis, 'grade') end;
    _new_deadline := case when p_payload ? 'ie_deadline' then (p_payload->>'ie_deadline')::date
                          else _old.ie_deadline end;
    _new_meta := case when p_payload ? 'draft_meta' then nullif(p_payload->'draft_meta', 'null'::jsonb)
                      else _old.draft_meta end;
    if _new_basis = 'ie' and _new_deadline is null then
        raise exception 'an IE needs a deadline (ie_deadline)' using errcode = '22023';
    end if;

    insert into term_rating (enrollment_id, term, narrative_html,
                             work_habits_rating, participation_rating, social_traits,
                             habits, approved_at, reporting_basis, ie_deadline, draft_meta)
    values (p_enrollment_id, p_term, _new_nar, _new_wh, _new_pr, _new_st, _new_habits, _new_approved,
            _new_basis, _new_deadline, _new_meta)
    on conflict (enrollment_id, term) do update
       set narrative_html       = excluded.narrative_html,
           work_habits_rating   = excluded.work_habits_rating,
           participation_rating = excluded.participation_rating,
           social_traits        = excluded.social_traits,
           habits               = excluded.habits,
           approved_at          = excluded.approved_at,
           reporting_basis      = excluded.reporting_basis,
           ie_deadline          = excluded.ie_deadline,
           draft_meta           = excluded.draft_meta,
           updated_at           = now()
    returning id into _tr_id;

    perform _term_rating_audit_field(_tr_id, 'narrative_html', _old.narrative_html, _new_nar);
    perform _term_rating_audit_field(_tr_id, 'work_habits_rating', _old.work_habits_rating::text, _new_wh::text);
    perform _term_rating_audit_field(_tr_id, 'participation_rating', _old.participation_rating::text, _new_pr::text);
    perform _term_rating_audit_field(_tr_id, 'social_traits',
        array_to_string(_old.social_traits, ','),
        array_to_string(_new_st, ','));
    perform _term_rating_audit_field(_tr_id, 'habits', coalesce(_old.habits, '{}'::jsonb)::text, _new_habits::text);
    perform _term_rating_audit_field(_tr_id, 'approved_at', _old.approved_at::text, _new_approved::text);
    perform _term_rating_audit_field(_tr_id, 'reporting_basis', coalesce(_old.reporting_basis, 'grade'), _new_basis);
    perform _term_rating_audit_field(_tr_id, 'ie_deadline', _old.ie_deadline::text, _new_deadline::text);
    perform _term_rating_audit_field(_tr_id, 'draft_meta.facts_hash',
        _old.draft_meta->>'facts_hash', _new_meta->>'facts_hash');

    if p_payload ? 'dimensions' and jsonb_typeof(p_payload->'dimensions') = 'array' then
        select jsonb_object_agg(section_id::text, rating::text)
          into _old_dim_map
          from term_rating_dimension where term_rating_id = _tr_id;
        _old_dim_map := coalesce(_old_dim_map, '{}'::jsonb);

        delete from term_rating_dimension where term_rating_id = _tr_id;

        for _elem in select * from jsonb_array_elements(p_payload->'dimensions') loop
            _sec_id := (_elem->>'section_id')::uuid;
            _rating := (_elem->>'rating')::int;
            if _rating < 1 or _rating > 4 then
                raise exception 'dimension rating must be 1..4' using errcode = '22023';
            end if;
            insert into term_rating_dimension (term_rating_id, section_id, rating)
            values (_tr_id, _sec_id, _rating);
            _new_dim_map := _new_dim_map || jsonb_build_object(_sec_id::text, _rating::text);
        end loop;

        -- Audit changes/adds/removes
        for _kv in select key as k, value as v from jsonb_each_text(_new_dim_map) loop
            perform _term_rating_audit_field(_tr_id,
                'dimension:' || _kv.k,
                _old_dim_map->>_kv.k,
                _kv.v);
        end loop;
        for _kv in select key as k, value as v from jsonb_each_text(_old_dim_map) where not (_new_dim_map ? key) loop
            perform _term_rating_audit_field(_tr_id,
                'dimension:' || _kv.k,
                _kv.v, null);
        end loop;
    end if;

    if p_payload ? 'strength_tags' and jsonb_typeof(p_payload->'strength_tags') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'strength_tags',
            (select string_agg(tag_id::text, ',' order by tag_id) from term_rating_strength where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'strength_tags') v));
        delete from term_rating_strength where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'strength_tags') v loop
            insert into term_rating_strength (term_rating_id, tag_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    if p_payload ? 'growth_tags' and jsonb_typeof(p_payload->'growth_tags') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'growth_tags',
            (select string_agg(tag_id::text, ',' order by tag_id) from term_rating_growth_area where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'growth_tags') v));
        delete from term_rating_growth_area where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'growth_tags') v loop
            insert into term_rating_growth_area (term_rating_id, tag_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    if p_payload ? 'mention_assessments' and jsonb_typeof(p_payload->'mention_assessments') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'mention_assessments',
            (select string_agg(assessment_id::text, ',' order by assessment_id) from term_rating_assessment where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'mention_assessments') v));
        delete from term_rating_assessment where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'mention_assessments') v loop
            insert into term_rating_assessment (term_rating_id, assessment_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    if p_payload ? 'mention_observations' and jsonb_typeof(p_payload->'mention_observations') = 'array' then
        perform _term_rating_audit_field(_tr_id, 'mention_observations',
            (select string_agg(observation_id::text, ',' order by observation_id) from term_rating_observation where term_rating_id = _tr_id),
            (select string_agg((v #>> '{}')::text, ',' order by (v #>> '{}'))
               from jsonb_array_elements(p_payload->'mention_observations') v));
        delete from term_rating_observation where term_rating_id = _tr_id;
        for _u in select (v #>> '{}')::uuid from jsonb_array_elements(p_payload->'mention_observations') v loop
            insert into term_rating_observation (term_rating_id, observation_id) values (_tr_id, _u) on conflict do nothing;
        end loop;
    end if;

    return _tr_id;
end; $function$;

commit;
