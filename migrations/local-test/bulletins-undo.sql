-- Undo for migrations/2026111801_bulletins.sql (2026-11-17).
--
-- ── PART 1, the fast stop (deletes nothing) ─────────────────────────────────
-- Takes the seven teacher functions away from signed-in teachers (revokes
-- execute from authenticated). Every bulletin, file, seen and reaction row is
-- kept, and so is every page in storage. The app's Bulletins page then gets
-- "permission denied" and shows nothing (the plan's rule 7: until the server
-- answers, the app offers nothing). The two storage helpers keep their grant:
-- the storage policies call them for every teacher's every file, in every
-- bucket, so taking them away would stop teachers reading student photos too.
-- With post_bulletin gone no new upload can be started, so the helpers allow
-- nothing new. Run PART 1 alone (from "PART 1 begins" to "PART 1 ends").
--
-- The way back from PART 1 (the seven grants it took away):
--   grant execute on function public.list_bulletins(uuid) to authenticated;
--   grant execute on function public.post_bulletin(uuid, jsonb, jsonb, uuid) to authenticated;
--   grant execute on function public.finish_bulletin_file(uuid, uuid) to authenticated;
--   grant execute on function public.edit_bulletin(uuid, jsonb, uuid) to authenticated;
--   grant execute on function public.delete_bulletin(uuid, uuid) to authenticated;
--   grant execute on function public.list_bulletin_seen(uuid) to authenticated;
--   grant execute on function public.show_bulletin_again(uuid, uuid) to authenticated;
-- (Running the migration file again also restates them, but only while none
-- of its functions or tables has been changed by a later file.)
--
-- ── PART 2, the full removal: the rest of this file ─────────────────────────
-- Drops the four policies, the four tables and the eighteen functions, and
-- deletes the bucket's row. It STOPS WITH NOTHING CHANGED while any function
-- outside this file's own (M2's student_submit functions, say) names a
-- bulletin table (undo that file first); while any bulletin, file, seen or
-- reaction row exists (delete the bulletins first, in the app or with
-- delete_bulletin, which queues their pages); while a queued page of the
-- bucket is not yet gone from storage; while the bucket holds a file; or if
-- one of this file's functions (its names, in public and fv_private) is not
-- exactly as the file left it. So it never deletes a student's row. If Supabase refuses a direct delete of the
-- bucket's row, the row is left (empty) and a notice says so: delete the
-- bucket in the dashboard (Storage).
--
-- Run whole, the file is PART 1 and then PART 2. PART 1 is not inside PART
-- 2's transaction, so a PART 2 that stops leaves PART 1 done: give the
-- functions back with the seven grants above.
--
-- Lock: dropping the tables drops their keys' triggers on course, enrollment
-- and assessment, which needs each to itself for a moment; after five
-- seconds it gives up with PART 2 not applied. Run it at a quiet time.
--
-- On a database where the file was never applied it changes nothing; a
-- second run changes nothing.

-- PART 1 begins
do $stop$
declare
  _p regprocedure;
begin
  for _p in select p.oid from pg_proc p
             where p.oid in (select to_regprocedure(s) from unnest(array['public.list_bulletins(uuid)', 'public.post_bulletin(uuid,jsonb,jsonb,uuid)',
                   'public.finish_bulletin_file(uuid,uuid)', 'public.edit_bulletin(uuid,jsonb,uuid)', 'public.delete_bulletin(uuid,uuid)',
                   'public.list_bulletin_seen(uuid)', 'public.show_bulletin_again(uuid,uuid)']) s) loop
    execute format('revoke execute on function %s from authenticated', _p);
  end loop;
end
$stop$;
-- PART 1 ends

begin;

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

-- This file's own functions: its names, in public and fv_private.
create temp table b1a_own on commit drop as
  select p.oid from pg_proc p where p.proname = any ('{bulletin_file_path,bulletin_file_path_parts,bulletin_file_upload_allowed,bulletin_file_read_allowed,bulletin_audience,bulletin_pinned_now,bulletin_json,bulletin_patched,bulletin_drop_expired,bulletin_student_same_class,bulletin_file_removed,list_bulletins,post_bulletin,finish_bulletin_file,edit_bulletin,delete_bulletin,list_bulletin_seen,show_bulletin_again}'::text[])
     and p.pronamespace in ('public'::regnamespace, 'fv_private'::regnamespace);

do $guard$
declare
  _c text;
  _n bigint;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into _c from pg_proc p
   where p.oid not in (select oid from b1a_own) and p.prosrc ~ 'bulletin';
  if _c is not null then
    raise exception 'functions of a later file use the bulletin tables (%): undo that file (M2, the student side) first. Nothing was changed; if PART 1 ran, give teachers the functions back with the seven grants in this file''s header.', _c;
  end if;
  select md5(string_agg(p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text))
    into _c from pg_proc p where p.oid in (select oid from b1a_own);
  if _c is distinct from null and _c is distinct from '3cdbfe6ce2a43145f01c101ef5377a7f' then -- fp:own
    raise exception 'a function of 2026111801 is not as it left it: a later change would be lost. Nothing was changed; if PART 1 ran, give teachers the functions back with the seven grants in this file''s header.';
  end if;
  if to_regclass('public.bulletin') is not null then
    execute 'select (select count(*) from public.bulletin) + (select count(*) from public.bulletin_file)
                  + (select count(*) from public.bulletin_seen) + (select count(*) from public.bulletin_reaction)' into _n;
    if _n > 0 then
      raise exception '% bulletin row(s) are kept: delete the bulletins first (each delete queues its pages). Nothing was changed.', _n;
    end if;
  end if;
  select count(*) into _n from public.submission_file_removal where bucket = 'bulletin-files' and not done;
  if _n > 0 then
    raise exception '% queued bulletin page(s) are not yet gone from storage: let the removal worker finish. Nothing was changed.', _n;
  end if;
  select count(*) into _n from storage.objects where bucket_id = 'bulletin-files';
  if _n > 0 then
    raise exception 'the bucket bulletin-files still holds % file(s). Nothing was changed.', _n;
  end if;
end
$guard$;

drop policy if exists fv_bulletin_files_fence on storage.objects;
drop policy if exists fv_bulletin_files_teachers_only on storage.objects;
drop policy if exists fv_bulletin_files_upload on storage.objects;
drop policy if exists fv_bulletin_files_read on storage.objects;

drop function if exists fv_private.bulletin_patched(public.bulletin, jsonb, boolean);
drop table if exists public.bulletin_reaction;
drop table if exists public.bulletin_seen;
drop table if exists public.bulletin_file;
drop table if exists public.bulletin;

do $drop$
declare
  _p regprocedure;
begin
  for _p in select p.oid from pg_proc p join b1a_own o on o.oid = p.oid loop
    execute format('drop function %s', _p);
  end loop;
  begin
    delete from storage.buckets where id = 'bulletin-files';
  exception when others then
    raise notice 'the bucket bulletin-files was left (%): delete it in the Supabase dashboard, Storage.', sqlerrm;
  end;
end
$drop$;

commit;
