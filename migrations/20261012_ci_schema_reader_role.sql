-- Read-only role for the CI drift check (scripts/check-db-drift.mjs).
--
-- It can read the function catalog (pg_proc, readable by every role) and the
-- migration history, and nothing else is granted. It has no password, so it
-- can't log in until the project owner sets one:
--
--     alter role fv_schema_reader with password '<a long random password>';
--
-- then saves the pooler connection string for this role as the GitHub
-- Actions secret FV_SCHEMA_READER_URL.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'fv_schema_reader') then
        create role fv_schema_reader with login nosuperuser nocreatedb nocreaterole noinherit;
    end if;
end $$;

grant usage on schema supabase_migrations to fv_schema_reader;
grant select on supabase_migrations.schema_migrations to fv_schema_reader;
