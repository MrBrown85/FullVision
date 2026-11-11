-- A stand-in for Supabase's storage schema, for Batch B's local tests
-- (submissions_common.py loads it after the database is built as live).
-- gradebook-prod has the real one, made and owned by Supabase's Storage
-- service; the harness never had one, because nothing used storage.
--
-- Its SHAPE is gradebook-prod's own, read from the live catalog on
-- 2026-11-10 (read-only, by the orchestrator: batch-b-live-storage-facts.md):
-- storage is at the service's migration "lifecycle-writer-coordination".
--   storage.objects   its fifteen columns, with archived_at,
--                     is_delete_marker and is_versioned; its ten indexes,
--                     among them the plain one on (bucket_id, name) and the
--                     unique ones that hold one current row to a name;
--                     row security on, not forced; its two triggers
--   storage.buckets   its fourteen columns, with versioning_status and the
--                     two lifecycle columns; row security on; four of its
--                     nine triggers (below)
--   storage.migrations  the service's own record; the newest name
--   no storage.prefixes table
-- The definitions are copied from the service's published migrations
-- (github.com/supabase/storage, migrations/tenant, read 2026-11-10): 0002,
-- 0003, 0007, 0008, 0011 to 0014, 0016, 0018, 0020, 0025, 0037, 0038, 0051,
-- 0055, 0062, 0065 to 0068, 0071, 0074, 0077, 0078.
--
-- Triggers on storage.buckets that are here:
--   enforce_bucket_name_length_trigger
--   protect_bucket_control_insert   an INSERT that sets either lifecycle
--                     column is refused unless the caller is a member of
--                     service_role; with both NULL it passes
--   enforce_versioning_status_transition   versioning cannot go back to
--                     DISABLED, nor from DISABLED to SUSPENDED
--   protect_buckets_delete   a DELETE from SQL is refused (as on objects)
-- NOT here, because Batch B never changes a bucket's lifecycle or versioning
-- and they need tables this stand-in does not have: protect_bucket_control_
-- update, protect_bucket_control_update_role, protect_active_lifecycle_
-- states, wake_lifecycle_on_policy_write, wake_lifecycle_on_versioning_
-- enable; and the tables bucket_lifecycle_states, buckets_analytics,
-- buckets_vectors, lifecycle_abandoned_artifacts, s3_multipart_uploads,
-- s3_multipart_uploads_parts, vector_indexes.
--
-- Privileges. On gradebook-prod the tables belong to supabase_storage_admin;
-- postgres is not a member of it, has SELECT on both tables and INSERT on
-- storage.buckets, and may create policies on them through Supabase's own
-- extension (supautils), which plain Postgres cannot imitate. postgres and
-- service_role pass row security there. Here the tables belong to
-- supabase_storage_admin too, but the harness runs as a superuser, so that a
-- statement is ALLOWED on gradebook-prod is not something a run here shows.
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
    type               storage.buckettype not null default 'STANDARD',
    versioning_status  text not null default 'DISABLED',
    lifecycle_configuration jsonb,
    lifecycle_configuration_generation uuid,
    constraint buckets_versioning_status_check check (versioning_status in ('DISABLED', 'ENABLED', 'SUSPENDED')),
    constraint buckets_versioning_standard_only_check check (type = 'STANDARD' or versioning_status = 'DISABLED'),
    constraint buckets_lifecycle_configuration_pair_check check ((lifecycle_configuration is null) = (lifecycle_configuration_generation is null))
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
    archived_at      timestamptz,
    is_delete_marker boolean not null default false,
    is_versioned     boolean not null default false,
    constraint "objects_bucketId_fkey" foreign key (bucket_id) references storage.buckets(id)
);
-- The ten indexes gradebook-prod has (the tenth is the primary key). There
-- is no plain unique index on (bucket_id, name): a name may have several
-- rows, one current (archived_at is null) and its older versions.
create index if not exists idx_objects_bucket_id_name on storage.objects (bucket_id, name collate "C");
create index if not exists idx_objects_bucket_id_name_lower on storage.objects (bucket_id, (lower(name) collate "C"));
create unique index if not exists idx_objects_current_version on storage.objects (bucket_id, name collate "C") where archived_at is null;
create index if not exists idx_objects_delete_markers on storage.objects (bucket_id, name collate "C") where is_delete_marker;
create unique index if not exists idx_objects_null_version on storage.objects (bucket_id, name collate "C") where not is_versioned;
create index if not exists name_prefix_search on storage.objects (name text_pattern_ops);
create index if not exists objects_archived_due_idx on storage.objects (bucket_id, archived_at, name collate "C")
    include (id, version, is_delete_marker) where archived_at is not null;
create unique index if not exists objects_archived_order_uq on storage.objects (bucket_id, name collate "C", archived_at) where archived_at is not null;
create unique index if not exists objects_bucket_id_name_version_key on storage.objects (bucket_id, name collate "C", version) nulls not distinct;

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

-- 0037: a bucket's name is 100 characters at most.
create or replace function storage.enforce_bucket_name_length()
 returns trigger
 language plpgsql
as $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$;
drop trigger if exists enforce_bucket_name_length_trigger on storage.buckets;
create trigger enforce_bucket_name_length_trigger before insert or update of name on storage.buckets
    for each row execute function storage.enforce_bucket_name_length();

-- 0068: only the storage service's role may insert a bucket that already
-- has a lifecycle policy. (Its UPDATE half and 0075's role check are left
-- out: Batch B never updates a bucket.)
create or replace function storage.protect_bucket_control_columns()
 returns trigger
 language plpgsql
 set search_path = pg_catalog
as $function$
begin
    if tg_op = 'INSERT' then
        if new.lifecycle_configuration is not null or new.lifecycle_configuration_generation is not null then
            if not pg_has_role(current_user, tg_argv[0], 'MEMBER') then
                raise exception 'only members of the configured storage service role may insert lifecycle policy state'
                    using errcode = '42501',
                          hint = format('Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.', tg_argv[0]);
            end if;
        end if;
    end if;
    return new;
end;
$function$;
drop trigger if exists protect_bucket_control_insert on storage.buckets;
create trigger protect_bucket_control_insert before insert on storage.buckets
    for each row execute function storage.protect_bucket_control_columns('service_role');

-- 0074: versioning, once on, cannot be switched back to DISABLED.
create or replace function storage.enforce_versioning_status_transition()
 returns trigger
 language plpgsql
as $function$
begin
    if new.versioning_status = old.versioning_status then
        return new;
    end if;
    if new.versioning_status = 'DISABLED' or (old.versioning_status = 'DISABLED' and new.versioning_status = 'SUSPENDED') then
        raise exception 'Cannot transition bucket versioning status from % to %', old.versioning_status, new.versioning_status;
    end if;
    return new;
end;
$function$;
drop trigger if exists enforce_versioning_status_transition on storage.buckets;
create trigger enforce_versioning_status_transition before update of versioning_status on storage.buckets
    for each row execute function storage.enforce_versioning_status_transition();

alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets owner to supabase_storage_admin;
alter function storage.foldername(text) owner to supabase_storage_admin;
alter function storage.filename(text) owner to supabase_storage_admin;
alter function storage.extension(text) owner to supabase_storage_admin;
alter function storage.protect_delete() owner to supabase_storage_admin;
alter function storage.protect_bucket_control_columns() owner to supabase_storage_admin;
alter function storage.enforce_versioning_status_transition() owner to supabase_storage_admin;
alter function storage.enforce_bucket_name_length() owner to supabase_storage_admin;
alter function storage.update_updated_at_column() owner to supabase_storage_admin;
-- 0046 and 0073: the API roles have every row privilege on both tables; row
-- security is the gate.
grant select, insert, update, delete on storage.buckets, storage.objects to service_role, authenticated, anon;
-- 0080 and what gradebook-prod shows: postgres reads both and may insert a bucket.
grant select on storage.buckets, storage.objects to postgres;
grant insert on storage.buckets to postgres;

-- 0002: the service's own record of its changes. The live pre-check reads the
-- newest name; gradebook-prod's is this one.
create table if not exists storage.migrations (
    id          integer primary key,
    name        varchar(100) unique not null,
    hash        varchar(40) not null,
    executed_at timestamp default current_timestamp
);
insert into storage.migrations (id, name, hash) values (79, 'lifecycle-writer-coordination', 'stand-in') on conflict do nothing;
