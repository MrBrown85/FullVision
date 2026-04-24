# Offline Sync — Architecture

Per final decision on **Q33 = B** (full offline with write queue and sync), this document captures the architecture for offline support.

**Status (Phase 4.10, 2026-04-19):** queue model + sync lifecycle below are implemented in [`shared/offline-queue.js`](https://github.com/MrBrown85/FullVision/blob/rebuild-v2/shared/offline-queue.js) on the main repo's `rebuild-v2` branch. Exposed as `window.v2Queue.{enqueue, flush, stats, deadLetter, dismissDeadLetter, clear, callOrEnqueue}`. Read-side caching (service worker + IndexedDB delta-refresh) and the dead-letter UI remain future work.

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
- **Idempotent replay.**
  - **Natural-key UPSERTs** (`upsert_score`, `upsert_goal`, `upsert_reflection`, `upsert_section_override`, `upsert_tag_score`, `upsert_rubric_score`, etc.) are intrinsically retry-safe: a replay overwrites the same row.
  - **INSERT-new-row RPCs** (`create_observation`, `create_assessment`, `duplicate_assessment`, `create_custom_tag`, `upsert_note`, `create_student_and_enroll`) are NOT intrinsically safe: a retry after a server-committed-but-client-missed-200 would insert a second row. These RPCs were retrofitted by migration `20260423_write_path_idempotency` with an optional `p_idempotency_key uuid default null` parameter. When the queue flushes or `callOrEnqueue` runs, it passes the entry's UUID as the key; the RPC consults `fv_idempotency` and returns the cached row id on replay instead of inserting. The allowlist lives in `shared/offline-queue.js`'s `IDEMPOTENT_ENDPOINTS`. The idempotency cache has a 24-hour TTL (pruned by the `fv_idempotency_cleanup` cron job every 15 min).
  - **Still not retrofitted** (same pattern applies, follow-up migration): `create_course`, `duplicate_course`, `import_roster_csv`, `import_teams_class`, `import_json_restore`, `upsert_observation_template`, and the null-id insert branch of `upsert_category` / `upsert_module` / `upsert_rubric` / `upsert_subject` / `upsert_competency_group` / `upsert_section` / `upsert_tag`.
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

## When this was built

Phase 4.10 of the v2 rebuild (2026-04-19). Auth, write paths, and read paths landed first; the queue module was added immediately after the last data.js port (Phase 4.9 imports) so every v2 `sb.rpc` call has a matching `v2Queue.callOrEnqueue` path.

## Risks

- **Conflict resolution UX.** Last-write-wins is simple but can lose work if a teacher edits the same score on two devices while both are offline. Document this clearly in release notes.
- **Queue corruption.** A localStorage parse error could drop queued writes. Defensive: every queue mutation is atomic; corruption is logged and the bad entry skipped.
- **Schema drift.** If the server schema changes while a teacher has 200 queued writes against an old schema, replay may fail. Mitigation: minor schema changes are backward-compatible for a release cycle.

---

> **Last verified 2026-04-20** against `gradebook-prod` + post-merge `main` (Phase 5 doc sweep, reconciliation plan 2026-04-20).
