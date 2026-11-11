-- A stand-in for Supabase's storage schema, for Batch B's local tests
-- (submissions_common.py loads it after the database is built as live).
-- gradebook-prod has the real one, made and owned by Supabase's Storage
-- service; the harness never had one, because nothing used storage.
--
-- Copied from the Storage service's own published migrations
-- (github.com/supabase/storage, migrations/tenant, read 2026-11-10), the
-- parts Batch B touches and nothing else:
--   0002  storage.buckets, storage.objects, the unique index on
--         (bucket_id, name), row security on objects, foldername(),
--         filename(), extension(), the tables owned by
--         supabase_storage_admin
--   0003  objects.path_tokens
--   0007  row security on buckets
--   0008  buckets.public
--   0011  objects.updated_at kept by a trigger
--   0012  buckets.avif_autodetection
--   0013, 0014  buckets.file_size_limit (bytes), buckets.allowed_mime_types
--   0016  objects.version
--   0018  owner_id on both
--   0025  objects.user_metadata
--   0026  objects.level
--   0038  buckets.type
--   0046, 0049  every privilege on both tables to anon, authenticated,
--         service_role and postgres (row security is the gate, as on
--         Supabase)
--   0055  DELETE on either table is refused unless the session has set
--         storage.allow_delete_query, which only the Storage API does
-- Left out: the search functions, multipart uploads, prefixes, analytics and
-- vector buckets, and object versioning (0062 onward: submissions.py adds
-- those columns in one scenario to show the functions read both shapes).
--
-- What this cannot stand in for is the Storage API itself: signed upload
-- links, the size and type checks on an upload, and the removal of a file's
-- bytes. submissions_common.py plays that part in Python, written from the
-- service's source. See README.md, "Batch B".
create schema if not exists storage;
do $roles$
begin
    if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
        create role supabase_storage_admin nologin noinherit;
    end if;
end
$roles$;
grant usage on schema storage to anon, authenticated, service_role;
grant all privileges on schema storage to supabase_storage_admin;

do $type$
begin
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                    where n.nspname = 'storage' and t.typname = 'buckettype') then
        create type storage.buckettype as enum ('STANDARD', 'ANALYTICS', 'VECTOR');
    end if;
end
$type$;

create table if not exists storage.buckets (
    id                 text not null primary key,
    name               text not null,
    owner              uuid,
    created_at         timestamptz default now(),
    updated_at         timestamptz default now(),
    public             boolean default false,
    avif_autodetection boolean default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    owner_id           text,
    type               storage.buckettype not null default 'STANDARD'
);
create unique index if not exists bname on storage.buckets using btree (name);

create table if not exists storage.objects (
    id               uuid not null default gen_random_uuid() primary key,
    bucket_id        text,
    name             text,
    owner            uuid,
    created_at       timestamptz default now(),
    updated_at       timestamptz default now(),
    last_accessed_at timestamptz default now(),
    metadata         jsonb,
    path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
    version          text,
    owner_id         text,
    user_metadata    jsonb,
    level            integer,
    constraint "objects_bucketId_fkey" foreign key (bucket_id) references storage.buckets(id)
);
create unique index if not exists bucketid_objname on storage.objects using btree (bucket_id, name);
create index if not exists name_prefix_search on storage.objects (name text_pattern_ops);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

create or replace function storage.foldername(name text)
 returns text[]
 language plpgsql
 immutable
as $function$
declare
    _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
end
$function$;

create or replace function storage.filename(name text)
 returns text
 language plpgsql
 immutable
as $function$
declare
    _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[array_length(_parts, 1)];
end
$function$;

create or replace function storage.extension(name text)
 returns text
 language plpgsql
 immutable
as $function$
declare
    _parts text[];
    _filename text;
begin
    select string_to_array(name, '/') into _parts;
    select _parts[array_length(_parts, 1)] into _filename;
    return reverse(split_part(reverse(_filename), '.', 1));
end
$function$;

create or replace function storage.update_updated_at_column()
 returns trigger
 language plpgsql
as $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;
drop trigger if exists update_objects_updated_at on storage.objects;
create trigger update_objects_updated_at before update on storage.objects
    for each row execute function storage.update_updated_at_column();

-- 0055: a DELETE that does not come from the Storage API is refused.
create or replace function storage.protect_delete()
 returns trigger
 language plpgsql
as $function$
begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
        raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            using hint = 'This prevents accidental data loss from orphaned objects.',
                  errcode = '42501';
    end if;
    return null;
end;
$function$;
drop trigger if exists protect_buckets_delete on storage.buckets;
create trigger protect_buckets_delete before delete on storage.buckets
    for each statement execute function storage.protect_delete();
drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();

alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets owner to supabase_storage_admin;
alter function storage.foldername(text) owner to supabase_storage_admin;
alter function storage.filename(text) owner to supabase_storage_admin;
alter function storage.extension(text) owner to supabase_storage_admin;
alter function storage.protect_delete() owner to supabase_storage_admin;
grant all on storage.buckets, storage.objects to service_role, authenticated, anon;
grant all on storage.buckets, storage.objects to postgres with grant option;
-- 0020: the index storage keeps on (bucket_id, name), compared byte by byte.
create index if not exists idx_objects_bucket_id_name on storage.objects (bucket_id, name collate "C");

-- 0002: the service's own record of its changes. The live pre-check reads the
-- newest name; this stand-in is at 0055.
create table if not exists storage.migrations (
    id          integer primary key,
    name        varchar(100) unique not null,
    hash        varchar(40) not null,
    executed_at timestamp default current_timestamp
);
insert into storage.migrations (id, name, hash) values (55, 'prevent-direct-deletes', 'stand-in') on conflict do nothing;
