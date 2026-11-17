-- Undo for migrations/2026111703_observation_follow_ups.sql (2026-11-17).
--
-- ── PART 1, the fast stop: one statement, on its own ─────────────────────────
-- No new follow-up can be made or changed; nothing else changes. The app's
-- follow-up saves are then refused (the sync dot turns red); observations,
-- reports and the student page are as they are.
--
--   revoke execute on function public.create_observation_follow_up(uuid, text, text, uuid),
--                              public.update_observation_follow_up(uuid, text, text, uuid) from authenticated, service_role;
--
-- ── PART 2, the full removal: the rest of this file ──────────────────────────
-- Puts get_class_bundle, get_observations and import_json_restore back word
-- for word as live had them before the file, drops the two functions, the
-- rule and its two triggers, the index, the key, the check and the two
-- columns. Every other row and definition stays as it is.
--
-- It stops with nothing changed while any follow-up exists (removing the
-- columns would lose a teacher's follow-ups: delete them in the app first),
-- or if a function is neither the file's definition nor the one before it
-- (a later change would be lost). On a database where the file was never
-- applied it changes nothing; a second run changes nothing.
--
-- md5 of pg_get_functiondef (function, before the file, as the file leaves it):
--   public.get_class_bundle(uuid,bigint)                 62bd0c41564652e983ccfbcadaafc5a7  ed59fcd4ef9bc85c6e5bcc24c3fdd608
--   public.get_observations(uuid,jsonb,integer,integer)  b3e204a54b8b988061bcd62bb800aa30  184fc8e045969e593ea641901bf2f0c3
--   public.import_json_restore(jsonb,uuid)               2de65ba2bca9babf90d5efb9134190ab  1a201d1ab42337ebb572469c67e8fcfc

begin;

set local lock_timeout = '5s';

do $guard$
declare
    _f    record;
    _md5  text;
    _n    bigint;
    _cols int := (select count(*) from pg_attribute where attrelid = 'public.observation'::regclass
                    and attname in ('follow_up_of', 'follow_up_kind') and not attisdropped);
begin
    for _f in select * from (values
        ('public.get_class_bundle(uuid,bigint)', '62bd0c41564652e983ccfbcadaafc5a7', 'ed59fcd4ef9bc85c6e5bcc24c3fdd608'),
        ('public.get_observations(uuid,jsonb,integer,integer)', 'b3e204a54b8b988061bcd62bb800aa30', '184fc8e045969e593ea641901bf2f0c3'),
        ('public.import_json_restore(jsonb,uuid)', '2de65ba2bca9babf90d5efb9134190ab', '1a201d1ab42337ebb572469c67e8fcfc'),
        ('public.create_observation_follow_up(uuid,text,text,uuid)', null, '9dec66bdc1d9b34809f58746e14e4f10'),
        ('public.update_observation_follow_up(uuid,text,text,uuid)', null, '00e70abda3f41746f89a96969ff33c48'),
        ('fv_private.observation_follow_up_rule()', null, '20e37bafa4e23be32d1943735c0ee277')
    ) as v(fn, was, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.was and _md5 is distinct from _f.now then
            raise exception '% is neither the file''s definition nor the one before it (md5 %). Nothing was changed.',
                _f.fn, coalesce(_md5, 'none: the function is missing');
        end if;
    end loop;
    if _cols = 2 then
        -- Read only once the column is known to be there (a plain query would not plan without it).
        execute 'select count(*) from public.observation where follow_up_of is not null' into _n;
        if _n > 0 then
            raise exception '% follow-up(s) exist. Removing the columns would lose them. Nothing was changed.', _n;
        end if;
    end if;
end
$guard$;

do $patch$
declare
    _f    record;
    _s    record;
    _def  text;
    _n    int;
begin
    for _f in select * from (values
        ('public.get_class_bundle(uuid,bigint)', '62bd0c41564652e983ccfbcadaafc5a7', 'ed59fcd4ef9bc85c6e5bcc24c3fdd608'),
        ('public.get_observations(uuid,jsonb,integer,integer)', 'b3e204a54b8b988061bcd62bb800aa30', '184fc8e045969e593ea641901bf2f0c3'),
        ('public.import_json_restore(jsonb,uuid)', '2de65ba2bca9babf90d5efb9134190ab', '1a201d1ab42337ebb572469c67e8fcfc')
    ) as v(fn, was, now) loop
        _def := pg_get_functiondef(to_regprocedure(_f.fn));
        continue when md5(_def) = _f.was;
        -- The file's own list of changes, read the other way: each "put" back to its "find".
        for _s in select * from (values
        ('public.get_class_bundle(uuid,bigint)', 1,
         $o$select o.* from public.observation o where o.course_id = p_course_id
         order by o.created_at desc limit 500$o$,
         $n$select o.* from public.observation o where o.course_id = p_course_id and o.follow_up_of is null
         order by o.created_at desc limit 500$n$),
        ('public.get_class_bundle(uuid,bigint)', 1,
         $o$'total', (select count(*) from public.observation o where o.course_id = p_course_id)$o$,
         $n$'total', (select count(*) from public.observation o where o.course_id = p_course_id and o.follow_up_of is null),
        -- Follow-ups of these observations (2026111703): never one of the observations above.
        'follow_ups', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', f.id, 'follow_up_of', f.follow_up_of, 'kind', f.follow_up_kind, 'body', f.body,
                       'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at)
              from public.observation f where f.follow_up_of in (select id from obs)), '[]'::jsonb)$n$),
        ('public.get_observations(uuid,jsonb,integer,integer)', 2,
         $o$where o.course_id = p_course_id
         and (_sent_filter is null$o$,
         $n$where o.course_id = p_course_id
         and o.follow_up_of is null
         and (_sent_filter is null$n$),
        ('public.get_observations(uuid,jsonb,integer,integer)', 1,
         $o$'custom_tags_index', _ctags_index
    );$o$,
         $n$'custom_tags_index', _ctags_index,
      -- Follow-ups of the page's observations (2026111703).
      'follow_ups', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'id', f.id, 'follow_up_of', f.follow_up_of, 'kind', f.follow_up_kind, 'body', f.body,
                  'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at)
           from observation f where f.follow_up_of = any(coalesce(_ids, '{}'::uuid[]))), '[]'::jsonb)
    );$n$),
        ('public.import_json_restore(jsonb,uuid)', 1,
         $o$created_at, dims, level, template_id)$o$,
         $n$created_at, dims, level, template_id, follow_up_of, follow_up_kind)$n$),
        ('public.import_json_restore(jsonb,uuid)', 1,
         $o$where t.id::text = nullif(_row->>'template_id','')))
        on conflict (id) do update set$o$,
         $n$where t.id::text = nullif(_row->>'template_id','')),
                nullif(_row->>'follow_up_of','')::uuid, nullif(_row->>'follow_up_kind',''))
        on conflict (id) do update set$n$),
        ('public.import_json_restore(jsonb,uuid)', 1,
         $o$template_id=excluded.template_id, updated_at=now();$o$,
         $n$template_id=excluded.template_id, follow_up_kind=excluded.follow_up_kind, updated_at=now();$n$)
        ) as s(fn, times, put, find) where s.fn = _f.fn loop
            _n := (length(_def) - length(replace(_def, _s.find, ''))) / length(_s.find);
            if _n <> _s.times then
                raise exception '% holds the text to change % time(s), not %. Nothing was changed.', _f.fn, _n, _s.times;
            end if;
            _def := replace(_def, _s.find, _s.put);
        end loop;
        if md5(_def) <> _f.was then
            raise exception '% would not be the definition before the file (md5 %, expected %). Nothing was changed.', _f.fn, md5(_def), _f.was;
        end if;
        execute _def;
        if md5(pg_get_functiondef(to_regprocedure(_f.fn))) <> _f.was then
            raise exception '% did not come back as before. Nothing was changed.', _f.fn;
        end if;
    end loop;
end
$patch$;

drop function if exists public.create_observation_follow_up(uuid, text, text, uuid);
drop function if exists public.update_observation_follow_up(uuid, text, text, uuid);
drop trigger if exists observation_follow_up_rule on public.observation;
drop trigger if exists observation_follow_up_rule on public.observation_student;
drop function if exists fv_private.observation_follow_up_rule();
drop index if exists public.observation_follow_up_of_idx;
alter table public.observation drop constraint if exists observation_follow_up_kind_check;
alter table public.observation drop constraint if exists observation_follow_up_of_fkey;
alter table public.observation drop column if exists follow_up_kind;
alter table public.observation drop column if exists follow_up_of;

commit;
