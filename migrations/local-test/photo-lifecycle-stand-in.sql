-- Stand-ins for three Supabase extensions the photo lifecycle file
-- (2026111140) uses, for its local tests only (photo_lifecycle.py loads this
-- into its template). gradebook-prod has the real ones:
--   pg_cron   cron.job and cron.schedule / cron.unschedule, with the
--             columns and signatures pg_cron 1.6 has. Live runs one job,
--             fv_grade_return_repair_daily (S0-M4b); a row for it is here.
--             Nothing here RUNS a job: the tests call what a job would.
--   pg_net    net.http_post with pg_net's signature. It records each call in
--             net.http_request_queue (pg_net's own queue table) and sends
--             nothing.
--   Vault     vault.decrypted_secrets as a plain view over vault.secrets
--             (on Supabase the view decrypts; the columns read are the same:
--             name, decrypted_secret).
-- Owned by the superuser that loads it, as the real ones are owned by
-- Supabase's admin roles; the file under test runs as that superuser too.
create schema if not exists cron;
create table if not exists cron.job (
    jobid    bigserial primary key,
    schedule text not null,
    command  text not null,
    nodename text not null default 'localhost',
    nodeport integer not null default 5432,
    database text not null default current_database(),
    username text not null default current_user,
    active   boolean not null default true,
    jobname  text unique
);
create or replace function cron.schedule(job_name text, schedule text, command text)
 returns bigint
 language sql
as $function$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid;
$function$;
create or replace function cron.unschedule(job_name text)
 returns boolean
 language plpgsql
as $function$
begin
    delete from cron.job where jobname = job_name;
    if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
    return true;
end;
$function$;
insert into cron.job (jobname, schedule, command)
values ('fv_grade_return_repair_daily', '47 10 * * *', 'call public.grade_return_repair_nightly()')
on conflict (jobname) do nothing;

create schema if not exists net;
create table if not exists net.http_request_queue (
    id                   bigserial primary key,
    method               text not null,
    url                  text not null,
    headers              jsonb,
    body                 jsonb,
    timeout_milliseconds integer
);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                         headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
                                         timeout_milliseconds integer default 5000)
 returns bigint
 language sql
as $function$
    insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
    values ('POST', url, headers, body, timeout_milliseconds)
    returning id;
$function$;

create schema if not exists vault;
create table if not exists vault.secrets (
    id     uuid primary key default gen_random_uuid(),
    name   text unique,
    secret text not null
);
create or replace view vault.decrypted_secrets as
    select id, name, secret as decrypted_secret from vault.secrets;
