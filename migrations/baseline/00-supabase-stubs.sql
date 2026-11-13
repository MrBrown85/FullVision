-- What an empty PostgreSQL 17 needs before FullVision's own structure loads.
--
-- Supabase gives every project these roles, schemas and functions. A plain
-- PostgreSQL has none of them, so the app's tables, policies and grants
-- would fail to load. Each piece below is a small stand-in with only what
-- the app's SQL names. None of it is Supabase's own code.
--
-- scripts/db-rebuild.mjs loads it first, into an empty database, as a
-- superuser. Roles belong to the whole server, not one database, so they
-- are made only when missing. Everything else is made fresh.
--
-- Never load this into gradebook-prod or any Supabase project: they have
-- the real pieces, and this would clash with them.

-- Roles
-- anon: a visitor with no sign-in. authenticated: a signed-in teacher.
-- service_role: the edge functions' key, which skips row security.
-- authenticator: the role the API server signs in as, then switches to
-- one of the three above for each request.
do $roles$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticator') then
        create role authenticator nologin noinherit;
    end if;
end
$roles$;
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;

-- Extensions
-- Supabase keeps extensions in their own schema. gen_random_uuid() is
-- built into PostgreSQL 17, so the app needs no extension for its keys.
-- These two are here because every Supabase project has them and a dump
-- may name them.
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;

-- auth: who is asking
-- On Supabase the API server puts the caller's signed token in the
-- setting request.jwt.claims (older versions also set request.jwt.claim.sub
-- to the user id). A test sets the same settings to act as a user.
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- The caller's token as JSON, or NULL with no sign-in.
create function auth.jwt() returns jsonb
 language sql stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

-- The signed-in user's id, or NULL with no sign-in.
create function auth.uid() returns uuid
 language sql stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

-- The caller's role from the token: anon, authenticated or service_role.
create function auth.role() returns text
 language sql stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- Sign-in accounts. The app reads only the id (to find a teacher whose
-- account is gone) and puts a trigger on deletes
-- (migrations/20261108_teacher_outlives_sign_in.sql). Supabase's table has
-- many more columns. email is here so a test can make an account.
create table auth.users (
    id uuid primary key,
    email text
);

-- storage: files students send
-- Supabase's Storage service owns these tables. The app adds a bucket and
-- policies on storage.objects (migrations/2026111102_student_work_storage.sql
-- and later). Only the columns the app's SQL names are here.
-- migrations/local-test/storage-stand-in.sql is the fuller stand-in the
-- storage tests use.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    versioning_status text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    metadata jsonb,
    archived_at timestamptz,
    is_delete_marker boolean not null default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- The folders in an object's name: 'a/b/c.jpg' gives {a,b}.
create function storage.foldername(name text) returns text[]
 language sql immutable
as $$
    select (string_to_array(name, '/'))[1:greatest(cardinality(string_to_array(name, '/')) - 1, 0)]
$$;

-- Realtime
-- The app adds public.course_sync_cursor to this publication so open tabs
-- hear about each write (migrations/20261015_course_sync_version.sql).
create publication supabase_realtime;

-- pg_cron, pg_net and Vault
-- Nightly jobs use pg_cron (cron.job, cron.schedule), pg_net
-- (net.http_post) and Vault (vault.decrypted_secrets). A plain PostgreSQL
-- has none of these. The app's functions name them only inside plpgsql
-- bodies, which PostgreSQL reads when they run, so the structure loads
-- without them. These stand-ins let a check such as to_regclass('cron.job')
-- find something. They run nothing and send nothing.
create schema cron;
create table cron.job (
    jobid bigserial primary key,
    schedule text not null,
    command text not null,
    jobname text unique
);
create table cron.job_run_details (
    runid bigserial primary key,
    jobid bigint,
    status text,
    return_message text,
    start_time timestamptz,
    end_time timestamptz
);
-- Records the job. Nothing ever runs it.
create function cron.schedule(job_name text, schedule text, command text) returns bigint
 language sql
as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean
 language sql
as $$
    with gone as (delete from cron.job where jobname = job_name returning 1)
    select exists (select 1 from gone)
$$;

create schema net;
-- Sends nothing. Returns a request number, as pg_net does.
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds integer default 5000)
 returns bigint
 language sql
as $$ select 0::bigint $$;

create schema vault;
-- Empty: no secret is ever copied out of the live database.
create table vault.decrypted_secrets (
    name text primary key,
    decrypted_secret text
);
