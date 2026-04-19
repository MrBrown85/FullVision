# Offline Sync — Architecture Stub

Per final decision on **Q33 = B** (full offline with write queue and sync), this document stubs out the architecture for offline support. The full spec lands during implementation; this captures the key design questions and the default approach.

## Scope

- **Offline reads:** app loads from cached data (service worker + cached read responses).
- **Offline writes:** every Pass B write path that would call the API instead enqueues to a local store. When the client reconnects, the queue drains to the API in order.
- **Conflict resolution:** last-write-wins (matches Pass B's upsert semantics everywhere). `updated_at = now()` on every row; the most recent write wins server-side regardless of origin order.

## Non-goals for v1

- **Multi-device real-time sync.** Not relevant — teacher is a single user per account.
- **Collaborative editing.** Not a use case.
- **Offline schema migration.** If the DB schema changes while a teacher has queued writes, we replay against the new schema best-effort. Complex schema changes are released with client-side migration shims.

## Queue model

Stored in `localStorage` under key `fv-sync-queue-v1`:

```json
{
  "entries": [
    {
      "id": "uuid-v4-client-generated",
      "created_at": "2026-04-19T10:23:14.123Z",
      "endpoint": "upsertScore",
      "payload": { "enrollment_id": "...", "assessment_id": "...", "value": 3 },
      "attempts": 0,
      "last_error": null
    }
  ],
  "last_flush_at": "2026-04-19T10:20:00.000Z"
}
```

- **FIFO order.** The queue drains in insertion order.
- **Idempotent replay.** Every Pass B write path is an upsert keyed on a deterministic unique constraint, so retrying a partially-failed flush is safe.
- **Retry policy.** 3 attempts per entry with exponential backoff (1s, 5s, 30s). After 3 failures, entry is moved to a "dead letter" store and the UI surfaces it to the user for manual resolution.
- **Eviction.** Successfully synced entries are removed from the queue. Dead-letter entries remain until the user dismisses them.

## Sync lifecycle

1. **Online at action time:** write goes directly to the API (current Pass B flow). Queue not touched.
2. **Offline at action time:** write enqueued; UI shows optimistic success; a small "N unsynced" badge appears on the teacher's avatar.
3. **Reconnect detected:** sync engine wakes, drains the queue.
4. **During drain:** each entry processed in order; on success, removed; on failure (after retries), moved to dead-letter.
5. **Drain complete:** badge updates to reflect dead-letter count or disappears.

## UI components needed

- **"N unsynced" badge** on the user avatar / top-right of the app.
- **Sync status panel** showing the queue state, last sync time, dead-letter entries.
- **Offline banner** when the app detects no connectivity.
- **Conflict modal** (rare — for dead-letter entries where the API returned a semantic error like "assessment not found," meaning the assessment was deleted from another device).

## Integration with Pass B write paths

Every write path diagrammed in Pass B gets a wrapper:

```
client calls writePath(…):
    if online:
        POST to API directly (existing Pass B flow)
    else:
        generate client-side UUID for new rows (so optimistic reads work)
        enqueue { endpoint, payload } in fv-sync-queue-v1
        return optimistic success to UI
        UI updates the local cache as if the write succeeded
```

The API-side contract is unchanged. The sync engine is a **client-side concern** — the API has no knowledge of whether a request came from a live action or a queued replay.

## Read-side caching

For offline reads to work, cached GET responses need to survive:

- **Service worker caches**: static assets (HTML, JS, CSS, fonts).
- **IndexedDB cache** (per course): full entity snapshots keyed by `(course_id, last_fetched_at)`. On reconnect, the client performs a delta-refresh: `GET /api/course/{id}/since?t=<last_fetched_at>`.

## Decisions still needed during implementation

1. **Delta-refresh shape.** Does each read endpoint support `?since=<timestamp>`, or does the client diff locally against full refetches? Recommend `since` for bandwidth efficiency.
2. **Dead-letter UX.** Does a dead-letter entry block the queue from draining? Or does the queue skip past and keep going? Recommend: skip, so one bad entry doesn't block 50 others.
3. **Queue size cap.** How many offline writes before the app refuses more? Recommend: 500 entries or 5 MB localStorage, whichever hits first.
4. **Clock-skew tolerance.** Client clocks can be wrong. Does the server reject writes with `updated_at` far in the future? Recommend: client sends `client_timestamp`; server applies `updated_at = server_now()` regardless, using client_timestamp only for ordering among same-second writes.

## When to build this

Offline support is a **later workstream**, after the core online flow ships. The design phase treats it as "architecture known, implementation deferred." Kick off after auth, write paths, and read paths are live.

## Risks

- **Conflict resolution UX.** Last-write-wins is simple but can lose work if a teacher edits the same score on two devices while both are offline. Document this clearly in release notes.
- **Queue corruption.** A localStorage parse error could drop queued writes. Defensive: every queue mutation is atomic; corruption is logged and the bad entry skipped.
- **Schema drift.** If the server schema changes while a teacher has 200 queued writes against an old schema, replay may fail. Mitigation: minor schema changes are backward-compatible for a release cycle.
