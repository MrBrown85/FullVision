-- Read-only post-check, after the apply for migrations/2026111703_observation_follow_ups.sql (2026-11-17).
-- SELECTs only. Every row says ok. The two counts read how many follow-ups exist, never what they say.
with want(sig, after_md5) as (values
    ('public.get_class_bundle(uuid,bigint)', 'ed59fcd4ef9bc85c6e5bcc24c3fdd608'),
    ('public.get_observations(uuid,jsonb,integer,integer)', '184fc8e045969e593ea641901bf2f0c3'),
    ('public.import_json_restore(jsonb,uuid)', '1a201d1ab42337ebb572469c67e8fcfc'),
    ('public.create_observation_follow_up(uuid,text,text,uuid,timestamptz)', 'ee948114be4962f2286cdc34562c425d'),
    ('public.update_observation_follow_up(uuid,text,text,uuid)', '00e70abda3f41746f89a96969ff33c48'),
    ('fv_private.observation_follow_up_rule()', '20e37bafa4e23be32d1943735c0ee277'))
select 'fingerprint ' || sig as check,
       case when md5(pg_get_functiondef(to_regprocedure(sig))) = after_md5 then 'ok'
            else 'NOT AS EXPECTED: ' || coalesce(md5(pg_get_functiondef(to_regprocedure(sig))), 'absent') end as value
  from want
union all select 'columns follow_up_of uuid and follow_up_kind text',
       case when (select string_agg(attname || ' ' || format_type(atttypid, atttypmod), ', ' order by attname)
                    from pg_attribute where attrelid = 'public.observation'::regclass and attname like 'follow_up%' and not attisdropped)
                 = 'follow_up_kind text, follow_up_of uuid' then 'ok' else 'NOT AS EXPECTED' end
union all select 'the key (on delete cascade) and the check, both validated',
       case when (select count(*) from pg_constraint where conrelid = 'public.observation'::regclass and convalidated
                    and ((conname = 'observation_follow_up_of_fkey' and contype = 'f' and confdeltype = 'c')
                      or (conname = 'observation_follow_up_kind_check' and contype = 'c'))) = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'the index', case when to_regclass('public.observation_follow_up_of_idx') is not null then 'ok' else 'NOT AS EXPECTED' end
union all select 'the rule on observation and observation_student',
       case when (select count(*) from pg_trigger where tgname = 'observation_follow_up_rule' and tgenabled = 'O'
                    and tgrelid in ('public.observation'::regclass, 'public.observation_student'::regclass)) = 2 then 'ok' else 'NOT AS EXPECTED' end
union all select 'a teacher may run the two new functions; a visitor may not',
       case when has_function_privilege('authenticated', 'public.create_observation_follow_up(uuid,text,text,uuid,timestamptz)', 'execute')
             and has_function_privilege('authenticated', 'public.update_observation_follow_up(uuid,text,text,uuid)', 'execute')
             and not has_function_privilege('anon', 'public.create_observation_follow_up(uuid,text,text,uuid,timestamptz)', 'execute')
             and not has_function_privilege('anon', 'public.update_observation_follow_up(uuid,text,text,uuid)', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'nobody may run the rule as a function',
       case when not has_function_privilege('anon', 'fv_private.observation_follow_up_rule()', 'execute')
             and not has_function_privilege('authenticated', 'fv_private.observation_follow_up_rule()', 'execute') then 'ok' else 'NOT AS EXPECTED' end
union all select 'no follow-up has students of its own',
       case when not exists (select 1 from public.observation_student os join public.observation o on o.id = os.observation_id
                              where o.follow_up_of is not null) then 'ok' else 'NOT AS EXPECTED' end
union all select 'no follow-up of a follow-up, none in another class',
       case when not exists (select 1 from public.observation f join public.observation p on p.id = f.follow_up_of
                              where p.follow_up_of is not null or p.course_id <> f.course_id) then 'ok' else 'NOT AS EXPECTED' end;
