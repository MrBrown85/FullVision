-- Undo for migrations/2026111706_handout_files.sql (2026-11-17).
--
-- ── PART 0, the stop (deletes nothing) ────────────────────────────────────
-- Takes start_handout_file and finish_handout_file away from signed-in
-- teachers: no new file can be added (the app's Add a File then fails like
-- any refused write, on the sync dot). A file already ready still opens for
-- students and can still be removed, and a removed one is still deleted.
-- Run PART 0 alone (from "PART 0 begins" to "PART 0 ends").
--
-- ── PART 1, the full removal: the rest of this file ───────────────────────
-- Puts the five replaced functions and the two constraints back word for
-- word, drops the four policies, the eleven new functions and the column
-- bytes. It stops with nothing changed while assessment_resource holds a
-- file's row (remove them first: each removal queues its file), while a
-- queued file is not yet gone from handout-files, while the bucket holds a
-- file, or if a function is neither as before nor as the file left it.
-- The bucket handout-files is left, empty: a bucket is deleted through the
-- Storage API (the Supabase dashboard). Dropping the column leaves one
-- dropped-column slot on assessment_resource.
--
-- Run whole, the file is PART 0 and PART 1 in one transaction. On a
-- database where the file was never applied it changes nothing; a second
-- run changes nothing.

begin;
set local lock_timeout = '5s';

-- PART 0 begins
do $stop$
begin
    if to_regprocedure('public.start_handout_file(uuid,text,text,bigint,uuid)') is not null then
        revoke execute on function public.start_handout_file(uuid, text, text, bigint, uuid) from authenticated;
    end if;
    if to_regprocedure('public.finish_handout_file(uuid,uuid)') is not null then
        revoke execute on function public.finish_handout_file(uuid, uuid) from authenticated;
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
        -- FINGERPRINTS-BEGIN undo-new (written by migrations/local-test/handout_files.py)
        ('public._handout_file_bucket()', 'f7ed7b1fe72127f538fcc133ebf7e423'),
        ('public._handout_file_max_bytes()', '587c06ecb2e6fa6980dfc027eae9ea00'),
        ('public._handout_file_mime(text)', '234e3efb8c0358be67c1705dea81fac1'),
        ('public._handout_file_path(uuid,uuid,text)', '72ad6e9a0c48f4243ba66a03a42427b0'),
        ('fv_private.handout_file_path_parts(text)', '185ad3fd3fc9ae84d6ae747f54a3423f'),
        ('public._handout_file_object(text)', '797abf1f084660a2cf8254d712f7e040'),
        ('fv_private.handout_file_upload_allowed(text)', 'fd3ee2b395e774629f6e8d2c53a36e59'),
        ('fv_private.handout_file_read_allowed(text)', '01f9d53fbc7b87536957dca9984103be'),
        ('public.start_handout_file(uuid,text,text,bigint,uuid)', 'cfe44806c71f0927070a4299bef64dd6'),
        ('public.finish_handout_file(uuid,uuid)', '88338da511bac8aa1d931244aa1ee559'),
        ('student_submit.handout_file(text,uuid,uuid,text)', '09910f172f6403ac3a15bea4e1b49511')
        -- FINGERPRINTS-END
    ) as v(fn, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is not null and _md5 is distinct from _f.now then
            raise exception '% is neither absent nor this file''s definition (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    for _f in select * from (values
        -- FINGERPRINTS-BEGIN undo-replaced (written by migrations/local-test/handout_files.py)
        ('public._assessment_resource_json(uuid)', '216a6f09d7632edc558686e66a14d086', 'ba262085f68a12f1320aa12cebf2f4af'),
        ('public._assessment_resource_removed()', '331dd8c1a4915e28e1a9ee2131991a93', 'becec68516a8cd68cccc383cf71325f7'),
        ('public._handout_drop_expired(uuid)', 'b73cf6fbb7b2b44d1c308d3cca1dfbaf', '2a89c8ea4984d1832f3dd4370756f253'),
        ('student_submit.removal_done(bigint[])', 'de793c82a2b5aa59052994a82e80d166', '0414f8b4f5b2429c1799dde1a68179d3'),
        ('public.photo_lifecycle_nightly()', '7e3dc52c80eb21f50848d67011385a26', '511904d486e08f495f2823aefd80b7e9')
        -- FINGERPRINTS-END
    ) as v(fn, before, now) loop
        _md5 := md5(pg_get_functiondef(to_regprocedure(_f.fn)));
        if _md5 is distinct from _f.before and _md5 is distinct from _f.now then
            raise exception '% is neither as before the file nor as the file left it (md5 %). Nothing was changed.', _f.fn, _md5;
        end if;
    end loop;
    if exists (select 1 from pg_attribute where attrelid = 'public.assessment_resource'::regclass and attname = 'bytes' and not attisdropped) then
        select count(*) into _n from public.assessment_resource where kind in ('html', 'txt', 'epub');
        if _n > 0 then
            raise exception 'assessment_resource still holds % handout file(s): remove them first (each removal queues its file). Nothing was changed.', _n;
        end if;
        select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) into _c
          from pg_constraint where conrelid = 'public.assessment_resource'::regclass
           and conname in ('assessment_resource_kind_check', 'assessment_resource_shape_check');
        if _c is distinct from
           -- SHAPE-AFTER (written by migrations/local-test/handout_files.py)
           'assessment_resource_kind_check CHECK ((kind = ANY (ARRAY[''pdf''::text, ''link''::text, ''html''::text, ''txt''::text, ''epub''::text]))) | assessment_resource_shape_check CHECK ((((kind = ''link''::text) AND (url IS NOT NULL) AND (char_length(url) <= 2000) AND (url ~* ''^https?://''::text) AND (page_count IS NULL) AND (status = ''ready''::text) AND (bytes IS NULL)) OR ((kind = ''pdf''::text) AND (url IS NULL) AND (page_count IS NOT NULL) AND ((page_count >= 1) AND (page_count <= 20)) AND (bytes IS NULL)) OR ((kind = ANY (ARRAY[''html''::text, ''txt''::text, ''epub''::text])) AND (url IS NULL) AND (page_count IS NULL) AND (bytes IS NOT NULL) AND ((bytes >= 1) AND (bytes <= 20971520)))))'
           then
            raise exception 'the constraints on assessment_resource are not as the file left them (found %). Nothing was changed.', _c;
        end if;
    end if;
    select count(*) into _n from public.submission_file_removal where bucket = 'handout-files' and not done;
    if _n > 0 then
        raise exception '% queued handout file(s) are not yet gone from storage: let the worker finish (a few minutes). Nothing was changed.', _n;
    end if;
    select count(*) into _n from storage.objects where bucket_id = 'handout-files';
    if _n > 0 then
        raise exception 'the bucket handout-files still holds % file(s). Nothing was changed.', _n;
    end if;
end
$guard$;

-- The five as live had them before the file.
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
           || case when r.kind = 'pdf' and r.status = 'uploading'
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
     where course_id = p_course_id and kind = 'pdf' and status = 'uploading' and created_at < now() - _work_hold();
    get diagnostics _n = row_count;
    perform set_config('fv.handout_removal_reason', '', true);
    return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION student_submit.removal_done(p_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'student_submit', 'pg_temp'
AS $function$
declare
    _gone  int;
    _still jsonb;
begin
    update submission_file_removal r
       set removed_at = now(), done = now() >= r.link_dies_at
     where r.id = any (coalesce(p_ids, '{}')) and not r.done
       -- a path a page has since been given cannot happen (a file's name is
       -- its row's id); if it ever did, the file would not be marked gone
       and not exists (select 1 from submission_file f where f.path = r.path or f.thumb_path = r.path)
       and not exists (select 1 from public._work_object(r.path));
    get diagnostics _gone = row_count;
    select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into _still
      from submission_file_removal r
     where r.id = any (coalesce(p_ids, '{}')) and not r.done and r.removed_at is null;
    return jsonb_build_object('ok', true, 'gone', _gone, 'still_there', _still);
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

-- OLD-DEFINITIONS-END

drop policy if exists fv_handout_files_fence on storage.objects;
drop policy if exists fv_handout_files_teachers_only on storage.objects;
drop policy if exists fv_handout_files_upload on storage.objects;
drop policy if exists fv_handout_files_read on storage.objects;

drop function if exists public.start_handout_file(uuid, text, text, bigint, uuid);
drop function if exists public.finish_handout_file(uuid, uuid);
drop function if exists student_submit.handout_file(text, uuid, uuid, text);
drop function if exists fv_private.handout_file_upload_allowed(text);
drop function if exists fv_private.handout_file_read_allowed(text);
drop function if exists public._handout_file_object(text);
drop function if exists fv_private.handout_file_path_parts(text);
drop function if exists public._handout_file_path(uuid, uuid, text);
drop function if exists public._handout_file_mime(text);
drop function if exists public._handout_file_max_bytes();
drop function if exists public._handout_file_bucket();

do $table$
begin
    if exists (select 1 from pg_attribute where attrelid = 'public.assessment_resource'::regclass and attname = 'bytes' and not attisdropped) then
        alter table public.assessment_resource
            drop constraint assessment_resource_kind_check,
            add constraint assessment_resource_kind_check check (kind in ('pdf', 'link')),
            drop constraint assessment_resource_shape_check,
            add constraint assessment_resource_shape_check check (
                (kind = 'link' and url is not null and char_length(url) <= 2000 and url ~* '^https?://'
                               and page_count is null and status = 'ready')
             or (kind = 'pdf' and url is null and page_count is not null and page_count between 1 and 20));
        alter table public.assessment_resource drop column bytes;
    end if;
end
$table$;

commit;
