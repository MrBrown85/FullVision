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
-- nothing new. To turn it back on, run the migration file again (its grants
-- are restated). Run PART 1 alone (from "PART 1 begins" to "PART 1 ends").
--
-- ── PART 2, the full removal: the rest of this file ─────────────────────────
-- Drops the four policies, the four tables and the eighteen functions, and
-- deletes the bucket's row. It STOPS WITH NOTHING CHANGED while any bulletin,
-- file, seen or reaction row exists (delete the bulletins first, in the app or
-- with delete_bulletin, which queues their pages), while a queued page of the
-- bucket is not yet gone from storage, while the bucket holds a file, or if a
-- function with "bulletin" in its name is not exactly as the file left it. So
-- it never deletes a student's row. If Supabase refuses a direct delete of the
-- bucket's row, the row is left (empty) and a notice says so: delete the
-- bucket in the dashboard (Storage).
--
-- Run whole, the file is PART 1 and then PART 2. PART 1 is not inside PART
-- 2's transaction, so a PART 2 that stops leaves PART 1 done: run the
-- migration file again to give the functions back.
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

do $guard$
declare
  _c text;
  _n bigint;
begin
  select md5(string_agg(p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text))
    into _c from pg_proc p where p.proname ~ 'bulletin';
  if _c is distinct from null and _c is distinct from '3acb30ba3a77020c73686a1bc0ef7ba4' then -- fp:own
    raise exception 'a function with "bulletin" in its name is not as 2026111801 left it: a later change would be lost. Nothing was changed; if PART 1 ran, run the migration file again to give teachers the functions back.';
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
  for _p in select p.oid from pg_proc p where p.proname ~ 'bulletin' loop
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
