-- Remove the publication zero_data (2026-11-17).
--
-- ── What it was ─────────────────────────────────────────────────────────────
-- Migration 20260417231417_zero_data_publication ran
--     create publication zero_data for all tables;
-- "that zero-cache will subscribe to for logical replication". Zero was a sync engine tried in
-- April 2026 and not kept: no package, code or doc of the app names it, and nothing ever read the
-- publication.
--
-- ── Why it goes ─────────────────────────────────────────────────────────────
-- 1. It publishes every table in every schema (142 on Nov 17: auth, vault, storage, public,
--    student_submit and the rest). A publication sends nothing by itself, but any replication tool
--    pointed at this database would be handed all of it by default. Student data should have no
--    standing way out that nothing uses.
-- 2. A FOR ALL TABLES publication that publishes updates and deletes makes PostgreSQL refuse
--    UPDATE and DELETE on any table with no primary key ("cannot update table ... because it does
--    not have a replica identity and publishes updates"). Eight tables in fv_backup are in that
--    state today, and so would be any new table made without one.
--
-- ── What it changes ─────────────────────────────────────────────────────────
-- It drops the publication. No table, row, function, policy or grant changes. Supabase Realtime's
-- own publications (supabase_realtime, supabase_realtime_messages_publication) are not touched.
--
-- ── The checks it makes first ───────────────────────────────────────────────
-- It stops, with nothing changed, if anything looks like a reader of the publication: a
-- replication slot or a schema named for zero. If the publication is already gone it does
-- nothing, so it is safe to run twice.
--
-- ── Undo ────────────────────────────────────────────────────────────────────
--     create publication zero_data for all tables;
--
-- Colin, Nov 17, shown the statement and what it covers: "Yes, remove it".
begin;

set local lock_timeout = '5s';

do $drop$
declare
    _reader text;
begin
    if not exists (select 1 from pg_publication where pubname = 'zero_data') then
        raise notice 'publication zero_data is already gone: nothing to do.';
        return;
    end if;
    select string_agg(s.slot_name::text, ', ') into _reader
      from pg_replication_slots s
     where s.slot_name ilike '%zero%';
    if _reader is not null then
        raise exception 'a replication slot named for zero exists (%): something may be reading the publication. Nothing was changed.', _reader;
    end if;
    select string_agg(n.nspname::text, ', ') into _reader
      from pg_namespace n
     where n.nspname ilike 'zero%' or n.nspname ilike '\_zero%';
    if _reader is not null then
        raise exception 'a schema named for zero exists (%): zero-cache may be installed. Nothing was changed.', _reader;
    end if;
    drop publication zero_data;
end
$drop$;

do $final$
begin
    if exists (select 1 from pg_publication where pubname = 'zero_data') then
        raise exception 'publication zero_data is still there. Nothing was changed.';
    end if;
    if (select count(*) from pg_publication where pubname in ('supabase_realtime', 'supabase_realtime_messages_publication')) <> 2 then
        raise exception 'one of Supabase Realtime''s publications is missing. Nothing was changed.';
    end if;
end
$final$;

commit;
