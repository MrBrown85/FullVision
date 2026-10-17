-- Serialise calls that share an idempotency key (2026-10-16).
--
-- fv_idem_check reads fv_idempotency and the RPC stores its result with
-- fv_idem_store at the end, with nothing holding the key in between. Two
-- calls with the same key at the same time (two browser tabs draining one
-- outbox, or a retry racing the attempt it thought had failed) could both
-- find no row and both insert: a duplicate assessment, student or note.
--
-- Now fv_idem_check takes a transaction-level advisory lock on the teacher
-- and key before it reads. Every RPC that calls it runs as one transaction,
-- so the lock lasts until that RPC commits, after fv_idem_store. A second
-- call with the same key waits at the lock, then reads the stored result and
-- returns it instead of inserting again. Only callers with the same key wait;
-- everything else is unaffected. Same signature and grants as before
-- (migrations/20260423_write_path_idempotency.sql).
create or replace function fv_idem_check(p_key uuid, p_endpoint text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
as $$
declare
    _uid uuid := (select auth.uid());
    _r   jsonb;
begin
    if _uid is null or p_key is null then
        return null;
    end if;
    -- Held until the calling RPC's transaction ends. A concurrent call with
    -- the same key blocks here, then sees the result the first one stored.
    perform pg_advisory_xact_lock(hashtext(_uid::text), hashtext(p_key::text));
    select result into _r
      from fv_idempotency
     where key = p_key
       and teacher_id = _uid
       and endpoint = p_endpoint;
    return _r;
end;
$$;
