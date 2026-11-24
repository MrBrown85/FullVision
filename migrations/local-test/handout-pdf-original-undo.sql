-- Undo for migrations/2026112408_handout_pdf_original.sql (2026-11-24).
--
-- == PART 0, the stop (deletes nothing) ==
-- Takes start_handout_original and finish_handout_original away from signed-in teachers: no new original can
-- be stored (a PDF handout still works from its pages). An original already ready still opens for students
-- and is still deleted with its handout. Run PART 0 alone (from "PART 0 begins" to "PART 0 ends").
--
-- == PART 1, the full removal: the rest of this file ==
-- Puts the six replaced functions and the shape check back word for word, drops the five new functions and the
-- two columns, and takes application/pdf out of the bucket's types. It stops with nothing changed while any
-- PDF row has an original uploading or ready (remove those handouts first: each removal queues its original; a dropped one holds nothing in storage and is cleared), while a queued
-- original is not yet gone from handout-files, while the bucket holds a .pdf, or if a function is neither as
-- before nor as the file left it. Dropping the columns leaves two dropped-column slots on assessment_resource.
-- Run whole, the file is PART 0 and PART 1 in one transaction. On a database where the file was never
-- applied it changes nothing; a second run changes nothing.

begin;
set local lock_timeout = '5s';
set local search_path = public, pg_temp;

-- PART 0 begins
do $stop$
begin
    if to_regprocedure('public.start_handout_original(uuid,bigint,uuid)') is not null then
        revoke execute on function public.start_handout_original(uuid, bigint, uuid) from authenticated;
    end if;
    if to_regprocedure('public.finish_handout_original(uuid,uuid)') is not null then
        revoke execute on function public.finish_handout_original(uuid, uuid) from authenticated;
    end if;
end
$stop$;
-- PART 0 ends

do $guard$
declare
    _f   record;
    _md5 text;
    _n   int;
    _c   text;
begin
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-new
        ('public._handout_original_path(uuid,uuid)', '8bca6f364391cd12d96027b0a4c02ffb'),
        ('fv_private.handout_original_parts(text)', 'b8f2d9237ed76faf5db4463818088f6e'),
        ('public.start_handout_original(uuid,bigint,uuid)', '72fe4a680ef117111f471d6553ae89ad'),
        ('public.finish_handout_original(uuid,uuid)', 'a7a502a24cdec27cfbdfab95b5cfd723'),
        ('student_submit.handout_original(text,uuid,uuid,text)', '65e00c70081b1234c60679087c117fbe')
        -- FINGERPRINTS-END
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.now then
            raise exception '% is neither absent nor this file''s definition (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-replaced
        ('public._assessment_resource_json(uuid)', 'ba262085f68a12f1320aa12cebf2f4af', '0aac1b8e58091a149e90422df56cddff'),
        ('public._assessment_resource_removed()', 'becec68516a8cd68cccc383cf71325f7', '208a21d723c24b89398d29e1733eff65'),
        ('public._handout_drop_expired(uuid)', '2a89c8ea4984d1832f3dd4370756f253', '8bbc7a7dc0f46717b9d1c59016dc9e8e'),
        ('public.photo_lifecycle_nightly()', '511904d486e08f495f2823aefd80b7e9', '590634077c8115f35e972f1d211e04fc'),
        ('fv_private.handout_file_upload_allowed(text)', 'fd3ee2b395e774629f6e8d2c53a36e59', 'd979e73142f88695a49059c207720b8d'),
        ('fv_private.handout_file_read_allowed(text)', '01f9d53fbc7b87536957dca9984103be', '157cbc9d9aef4f0a10ae4d36f061fc65')
        -- FINGERPRINTS-END
    ) as v(fn, before, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.before and _md5 is distinct from _f.now then
            raise exception '% is neither as before the file nor as the file left it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_attribute where attrelid = 'public.assessment_resource'::regclass and attname = 'original_status' and not attisdropped) then
        select count(*) into _n from public.assessment_resource where original_status in ('uploading', 'ready');
        if _n > 0 then
            raise exception 'assessment_resource still holds % PDF original(s) uploading or ready: remove those handouts first (each removal queues its original). Nothing was changed.', _n;
        end if;
        select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") into _c
          from pg_constraint where conrelid = 'public.assessment_resource'::regclass
           and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check');
        if _c is distinct from
           -- SHAPE-AFTER
           'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL) AND (original_status IS NULL) AND (original_started_at IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (((bytes IS NULL) AND (original_status IS NULL) AND (original_started_at IS NULL)) OR ((status = ''ready''::text) AND (original_status = ANY (ARRAY[''uploading''::text, ''ready''::text])) AND (original_started_at IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520))) OR ((status = ''ready''::text) AND (original_status = ''dropped''::text) AND (original_started_at IS NOT NULL) AND (bytes IS NULL)))) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)) AND (original_status IS NULL) AND (original_started_at IS NULL))))'
           then
            raise exception 'the constraints on assessment_resource are not as the file left them (found %). Nothing was changed.', _c;
        end if;
    end if;
    select count(*) into _n from public.submission_file_removal where bucket = 'handout-files' and right(path, 4) = '.pdf' and not done;
    if _n > 0 then
        raise exception '% queued original(s) are not yet gone from storage: let the worker finish (a few minutes). Nothing was changed.', _n;
    end if;
    select count(*) into _n from storage.objects where bucket_id = 'handout-files' and right(name, 4) = '.pdf';
    if _n > 0 then
        raise exception 'the bucket handout-files still holds % .pdf file(s). Nothing was changed.', _n;
    end if;
end
$guard$;

-- The six as live had them before the file.
-- OLD-DEFINITIONS-BEGIN
CREATE OR REPLACE FUNCTION public._assessment_resource_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object('id', r.id, 'assessment_id', r.assessment_id, 'kind', r.kind, 'title', r.title,
                              'url', r.url, 'page_count', r.page_count, 'status', r.status, 'position', r.position,
                              'created_at', r.created_at, 'updated_at', r.updated_at)
           || case when r.kind = 'pdf'
                   then jsonb_build_object('paths', (select jsonb_agg(_handout_path(r.course_id, r.id, n) order by n)
                                                       from generate_series(1, r.page_count) n))
                   else '{}'::jsonb end
           || case when r.kind in ('html', 'txt', 'epub')
                   then jsonb_build_object('bytes', r.bytes, 'path', _handout_file_path(r.course_id, r.id, r.kind))
                   else '{}'::jsonb end
           || case when r.kind <> 'link' and r.status = 'uploading'
                   then jsonb_build_object('finish_by', r.created_at + _work_hold())
                   else '{}'::jsonb end
      from assessment_resource r
     where r.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public._assessment_resource_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _why text := coalesce(nullif(current_setting('fv.handout_removal_reason', true), ''), 'handout_removed');
begin
    if old.kind = 'pdf' then
        insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
        select _work_bucket(), _handout_path(old.course_id, old.id, n), old.course_id, _why, now() + interval '10 minutes'
          from generate_series(1, old.page_count) n
        on conflict (bucket, path) do nothing;
    elsif old.kind in ('html', 'txt', 'epub') then
        insert into submission_file_removal (bucket, path, course_id, reason, link_dies_at)
        values (_handout_file_bucket(), _handout_file_path(old.course_id, old.id, old.kind), old.course_id, _why,
                now() + interval '10 minutes')
        on conflict (bucket, path) do nothing;
    end if;
    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._handout_drop_expired(p_course_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    _n int;
begin
    perform set_config('fv.handout_removal_reason', 'handout_expired', true);
    delete from assessment_resource
     where course_id = p_course_id and kind <> 'link' and status = 'uploading' and created_at < now() - _work_hold();
    get diagnostics _n = row_count;
    perform set_config('fv.handout_removal_reason', '', true);
    return _n;
end;
$function$;

CREATE OR REPLACE PROCEDURE public.photo_lifecycle_nightly()
 LANGUAGE plpgsql
AS $procedure$
declare
    _course uuid;
    _failed integer := 0;
    _state  text;
    _msg    text;
    _miss   jsonb;
    _stuck  jsonb;
begin
    delete from public.photo_check_log where at < now() - interval '90 days';
    delete from public.photo_keep_check k where not exists (select 1 from public.course c where c.id = k.course_id);
    commit;
    -- Every class with work, and every class that has a folder in the bucket (section 4).
    for _course in
        select s.course_id from public.submission s
        union
        select c.id from public.course c
         where c.id in (select distinct fv_private.work_path_course(o.name) from storage.objects o
                         where o.bucket_id = public._work_bucket() and o.archived_at is null and not o.is_delete_marker)
        union
        -- and every class with a handout still uploading (2026111706), so one never finished is dropped
        select r.course_id from public.assessment_resource r where r.status = 'uploading'
        order by 1
    loop
        begin
            perform set_config('lock_timeout', '10s', true);
            perform public._photo_keep_class(_course, now());
            perform public._photo_strays(_course, now());
            _miss := public._photo_missing(_course);
            if (_miss->>'n')::int > 0 then
                perform public._photo_log(_course, 'missing_file', (_miss->>'n')::int, _miss->'file_ids');
            end if;
        exception when others then
            get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
            perform public._photo_log(_course, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
            _failed := _failed + 1;
        end;
        commit;
    end loop;
    begin
        perform set_config('lock_timeout', '10s', true);
        perform public._photo_strays(null, now());
    exception when others then
        get stacked diagnostics _state = returned_sqlstate, _msg = message_text;
        perform public._photo_log(null, 'error', 1, jsonb_build_object('sqlstate', _state, 'message', _msg));
        _failed := _failed + 1;
    end;
    commit;
    -- Files due for hours: the calls to the edge function are not working (section 6).
    _stuck := public._photo_stuck();
    if (_stuck->>'n')::int > 0 then
        perform public._photo_log(null, 'error', 1, jsonb_build_object('stuck_files', (_stuck->>'n')::int, 'due_since', _stuck->'due_since'));
        _failed := _failed + 1;
    end if;
    commit;
    if _failed > 0 then
        raise exception 'photo_lifecycle_nightly: % part(s) of this run failed or found files stuck in the queue; the rest is done. See public.photo_check_log.', _failed;
    end if;
end;
$procedure$;

CREATE OR REPLACE FUNCTION fv_private.handout_file_upload_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_file_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = h.kind
                      and r.status = 'uploading'
                      and r.created_at >= now() - _work_hold()
                      and fv_owns_assessment(r.assessment_id));
$function$;

CREATE OR REPLACE FUNCTION fv_private.handout_file_read_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select (select auth.uid()) is not null
       and exists (select 1
                     from fv_private.handout_file_path_parts(p_name) h
                     join assessment_resource r on r.id = h.resource_id
                    where r.course_id = h.course_id and r.kind = h.kind
                      and fv_owns_assessment(r.assessment_id));
$function$;

-- OLD-DEFINITIONS-END

drop function if exists student_submit.handout_original(text, uuid, uuid, text);
drop function if exists public.start_handout_original(uuid, bigint, uuid);
drop function if exists public.finish_handout_original(uuid, uuid);
drop function if exists fv_private.handout_original_parts(text);
drop function if exists public._handout_original_path(uuid, uuid);

do $table$
begin
    if exists (select 1 from pg_attribute where attrelid = 'public.assessment_resource'::regclass and attname = 'original_status' and not attisdropped) then
        -- A dropped original has nothing in storage (its name was queued, and the guard above waited for that).
        update public.assessment_resource set original_status = null, original_started_at = null where original_status = 'dropped';
        alter table public.assessment_resource
            drop constraint assessment_resource_shape_check,
            add constraint assessment_resource_shape_check check (
                (kind = 'link' and url is not null and char_length(url) <= 2000 and url ~* '^https?://'
                               and page_count is null and status = 'ready' and bytes is null)
             or (kind = 'pdf' and url is null and page_count is not null and page_count between 1 and 20 and bytes is null)
             or (kind in ('html', 'txt', 'epub') and url is null and page_count is null and bytes is not null
                                                 and bytes between 1 and 20971520));
        alter table public.assessment_resource drop column original_status, drop column original_started_at;
    end if;
end
$table$;

update storage.buckets set allowed_mime_types = array['text/html', 'text/plain', 'application/epub+zip']
 where id = 'handout-files' and allowed_mime_types = array['text/html', 'text/plain', 'application/epub+zip', 'application/pdf'];

commit;
