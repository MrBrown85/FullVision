-- Record which browser tab made each change to a class (2026-10-16,
-- write-path audit finding 15).
--
-- Every write bumps course_sync_cursor.version, and realtime sends the new
-- row to every open copy of the class, including the tab that made the
-- change. That tab can't tell its own change from another device's, so it
-- downloaded the whole class again after every save. The client now sends
-- an x-fv-client header (one random id per page load); PostgREST exposes
-- request headers as request.headers, and the cursor keeps the id of the
-- last writer. A tab that sees its own id on the very next version knows
-- nothing else changed. Writes without the header (old clients, cron jobs)
-- leave last_client null, and every tab reloads as before.
alter table public.course_sync_cursor add column if not exists last_client text;

create or replace function public._touch_course_sync_cursor(p_course_id uuid, p_bucket text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    _client text := left(nullif(current_setting('request.headers', true), '')::json ->> 'x-fv-client', 64);
begin
    if p_course_id is null then
        return;
    end if;

    -- Course already deleted (we are inside its delete cascade): nothing to touch.
    if not exists (select 1 from public.course where id = p_course_id) then
        return;
    end if;

    insert into public.course_sync_cursor (course_id)
    values (p_course_id)
    on conflict (course_id) do nothing;

    update public.course_sync_cursor
       set version = version + 1,
           last_client = _client,
           gradebook_updated_at =
               case when p_bucket = 'gradebook' then now() else gradebook_updated_at end,
           student_records_updated_at =
               case when p_bucket = 'student-records' then now() else student_records_updated_at end
     where course_id = p_course_id;
end;
$function$;

revoke execute on function public._touch_course_sync_cursor(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
