# Write-path rebuild plan

Status: Phases 0–4 done (#118–#122); Phase 5 in review (2026-10-12). Replaces the whole-array save model in `shared/data.js` with a durable outbox of single-record operations.

## Why

Nearly every data type saves the same way. The UI mutates a whole array, calls `saveX(cid, array)`, and the save diffs that array against the copy in localStorage (`_loadPersistedCourseFieldSnapshot`, `shared/data.js:2731`), then sends the differences as RPCs. This model caused most of 2026's data bugs: duplicate learning maps, wrong points scores, and local-id races. It still carries four defects.

### 1. Overlapping saves can duplicate rows

The diff baseline is whatever localStorage held when `saveX` was called, not what the server confirmed. Example with students (`_persistStudentsToCanonical`, `shared/data.js:5306`):

1. The teacher adds student X (local id). Save 1 queues.
2. Before save 1 resolves, any other student save runs. Save 2 captures a baseline that still holds X's local id.
3. Save 1's `create_student_and_enroll` resolves, and `_canonicalEnrollStudent` (`:5382`) re-keys X in the cache to its enrollment UUID.
4. Save 2 runs. X (UUID) isn't in its baseline (local id), so it enrolls X again. Each call gets a fresh idempotency key, so the server can't dedupe.

The learning map had this exact bug; #113 patched it with `_learningMapIdRemap` for learning maps only. Students, assessments, categories and notes still have it. Production has no duplicates today (checked 2026-10-12), so this is latent, not observed.

### 2. A failed write is never retried

When an RPC fails (offline, network blip, server error), localStorage already holds the change, so the next diff sees nothing to send.

- The offline queue (`shared/offline-queue.js`) is never written to: `enqueue` and `callOrEnqueue` have no callers. The sync badge and sign-out warning read a queue that is always empty.
- Degraded-mode recovery (P6.1, `_replayCourseEntities`, `:459`) calls `saveX(cid, getX(cid))`. Both sides of the diff are the same object, so it sends nothing. Its test only checks localStorage.
- Learning maps, modules and rubrics are the exception. They re-send every row on every save, which accidentally heals failures but costs about 70 sequential RPCs to rename one section.

### 3. More than one writer for the same data

- The class wizard calls `saveLearningMap` and its own `_dispatchMapToV2` (`teacher/dash-class-manager.js:321`) at the same time. Both insert the map. `_patchMapId` (`:288`) then calls `saveLearningMap` once per re-keyed id, starting more full-map chains.
- `setAssignmentStatus` sends `set_score_status` from both `saveAssignmentStatuses`' diff and its own direct call.
- `setPointsScore` sends through both `saveScores`' diff and `upsertCellScore`.
- Re-keys cascade into further whole-array saves: categories call `saveAssessments`; `_patchLearningMapReferences` (`:4367`) calls `saveAssessments` and `saveScores`.

### 4. Syncs overwrite newer edits

- When `_persistLearningMapToCanonical` finishes with new ids, it writes its starting clone back into the cache, reverting anything edited while it ran. The server keeps those edits, so screen and server disagree until reload.
- `_persistRubricsToCanonical` does the same through `_reconcileCanonicalRubrics` (`:4899`).
- Realtime refreshes (`_handleExternalCourseUpdate`, `:701`) replace the whole course cache. An 8-second echo guard hides most cases, but a save slower than 8 seconds is overwritten (P7.4).

## Target design

1. **Operations, not arrays.** Every change is one operation on one record (`create_assessment`, `update_student`, `delete_tag` …) with a stable id that doubles as its idempotency key.
2. **Durable outbox.** Operations go to an outbox stored in localStorage and stamped with the teacher's id (already in place since #117). It survives reloads, sends in order per record, retries transient failures, and moves permanent failures to a visible failed list.
3. **One id map.** A saved per-course table maps temporary local ids to server ids. An operation that refers to an unconfirmed record waits for it. When a new id arrives, one function rewrites every reference in cache, localStorage and pending operations.
4. **Server snapshot plus pending.** The cache equals the last confirmed server state with pending operations applied on top. A realtime refresh rebuilds it that way, so local edits never vanish.
5. **One writer per record.** UI code calls data-layer actions only; nothing else writes.

Conflict policy across devices: last write wins, per field. This matches today's behaviour. Detecting conflicts would need a schema change and new UI, and the user hasn't asked for it.

## Phases

Each phase is one pull request, ships on its own, and must pass CI (unit tests and Prettier).

### Phase 0: tests that reproduce the bugs — small to medium

- Add `tests/helpers/fake-supabase.js`: a recording RPC fake that can delay, fail, or fail-then-succeed per call, and assigns UUIDs on create.
- Add `tests/write-path-regressions.test.js`, which fails today:
  - overlapping student saves enroll the same student twice;
  - an RPC that fails once is never sent again;
  - degraded-mode recovery sends no RPCs for students, assessments or scores;
  - re-linking curriculum inserts each subject, section and tag twice (the same two writers as the class wizard);
  - editing a note from an earlier session adds a second note instead of replacing it;
  - a section renamed while a learning-map sync runs reverts on screen;
  - `setAssignmentStatus` and `setPointsScore` each send two writes.
- Mark them `it.fails` so CI stays green. Each later phase flips the ones it fixes to `it`.

**Done when:** every defect above has a failing test in CI.

### Phase 1: make the outbox real — medium to large

Rebuild `shared/offline-queue.js` as the only path to the server for writes.

- Entry shape gains `key` (record identity, e.g. `assessment:<id>`), `deps` (local ids this op needs resolved) and `kind`.
- **Ordering:** operations with the same `key` run one at a time, in order; different keys run in parallel, up to a small limit.
- **Errors:** network errors, 5xx and timeouts retry with backoff and no attempt cap while online. 4xx, validation and RLS errors go straight to the failed list. Session-expired errors pause the outbox until re-auth.
- **Id map — moved to Phase 2.** Callers' own re-key code still runs, because `push()` resolves with the final result after any retries. A create retried after a reload is re-keyed by the next server load instead. The id map below lands with Phase 2's server-state baseline, which needs it anyway. `fv-idmap-<cid>` in localStorage: on a create's success, record `local → uuid` and call `rekey(cid, local, uuid)`. That rewrites the cache, localStorage blobs and pending operations' params and deps, replacing:
  - `_canonicalEnrollStudent`'s patch;
  - the modules → assessments patch;
  - categories → `saveAssessments`;
  - `_learningMapIdRemap` and `_patchLearningMapReferences`;
  - `_patchAssessmentRubricIds`;
  - `_migrateCourseDataLocalToCanonical` (`:528`) for course ids.
- **Draining:** on boot after `bootstrap_teacher`, on `online`, after any successful operation, and every 60 seconds.
- Route `_rpcOrNoop` (`:6532`) and every direct `sb.rpc` write in `shared/data.js` through `outbox.push(...)`, via one `_writeRpc()`. Reads stay direct.
- Writes made while degraded are queued instead of skipped (`_writesEnabled()`); the outbox holds them while `_supabaseDegraded` and sends them on recovery. Course create, rename and delete still need a live connection.
- `_trackPendingSync` counts outbox depth, so the sync badge, `waitForPendingSyncs` and the #117 sign-out warning reflect real unsent work.
- Delete degraded-mode replay (`_replayCourseEntities`, `_degradedTouchedCourses`). The outbox already holds everything sent during the degraded window.

**Done when:** the "failed write never retried" and "recovery sends nothing" tests pass, and a manual offline session in demo-off local mode drains on reconnect.

### Phase 2: diff against confirmed server state — medium (done)

- `_serverState[field][cid]` holds what the server is believed to have, in client shape. It's set when a field loads from the server (`_persistLoadedField`) and advanced to the cache's value when a save's diff is dispatched; the outbox retries until the server has it. Re-keys (`_rekeyServerStateRow`) patch it alongside the cache. Wiping a course's local data (`_clearCourseLocalState`, the P6.2 local-id migration) forgets it.
- Students, assessments, categories, modules, custom tags, notes, the learning map, scores and statuses now diff the live cache against that baseline, not the localStorage copy taken when `saveX` was called. All ~60 UI call sites keep working unchanged.
- Kept, not deleted: `_loadPersistedCourseFieldSnapshot` is the fallback before the first load (or while degraded) when no baseline exists. The per-type promise queues stay, because they serialize each course's diffs.
- Modules and the learning map skip rows whose saved fields haven't changed, but only against a real baseline. Without one they still send every row. Rubrics still re-send and reload, as before.
- Notes: `_noteIds` comes from `get_student_profile` at load time (all ids per enrollment), so editing a note from an earlier session deletes its rows and inserts one replacement instead of adding another row.
- Categories and modules upsert by id, so they were never prone to duplicates. Only students, assessments and notes needed the fix.
- The central id map moves to Phase 3, where the scattered re-key code is removed.

**Done:** the overlapping-save tests for students and assessments and the older-note test pass, and a real-browser run of the overlapping student save sends one enrollment.

### Phase 3: one writer per record — small to medium (done)

- `_dispatchMapToV2` and `_patchMapId` are gone from `dash-class-manager.js`, along with about 20 direct `window.v2.upsert*`/`delete*` calls in the class-manager actions (add, rename, recolour, regroup and delete for subjects, groups and standards). Every one of those actions already called `saveLearningMap`, so each change was written twice. Adding a subject or standard inserted it twice, and partial direct upserts sent `color: null` and could wipe the colour. `saveLearningMap` is now the only writer.
- The class wizard waits up to 15 s for the map to reach the server (`saveLearningMap` now resolves true/false). Offline, the outbox keeps it, and it isn't reported as a failure.
- Duplicating a class gives the copied map fresh local ids (`withFreshLearningMapIds`). Its rows used to keep the source class's ids, so the copy updated the source's rows instead of inserting its own.
- `setAssignmentStatus` and `setPointsScore` send one write each. The score diff sends one `upsert_score` per points cell instead of one per tag.
- The learning-map sync patches new ids into the live map instead of replacing the cache with its starting copy. The rubric sync adopts the server's copy only if nothing was edited while it ran.
- Found while testing in the browser: the class manager renders a new row with its local id, and an input keeps that id after the row is re-keyed, so a rename typed straight away was dropped. `resolveLearningMapId` maps a stale id to the current one at the top of each class-manager action.
- Kept: the re-key follow-up saves (`saveAssessments`/`saveScores` after a tag, category or rubric re-key). They send references the server never had (it rejected the local ids), so they're needed, not redundant. No central id map was added: the per-path re-keys plus `resolveLearningMapId` cover it.
- Brett's two empty "English Studies 12" classes were created 7–8 minutes before the real one: re-creates, not a double-submit.

**Done:** the four Phase 3 regression tests pass, plus new ones for class-manager inserts and the stale-id rename. In a real browser, adding a subject and a standard sent one insert each, and a rename against the stale id was saved.

### Phase 4: realtime without lost edits — medium (done)

- The 8-second echo guard is gone (`_ECHO_GUARD_MS`, `_setEchoGuard`, `_isEchoGuarded`, and the leftover calls in `calc.js` and `page-student.js`). It let a refresh overwrite a write that took longer than 8 s, and it ignored other devices' changes for 8 s after every local edit.
- Every local edit bumps a per-course, per-field counter (`_markLocalWrite`, called from `_saveCourseField`, `upsertScore` and `toggleFlag`).
- `_handleExternalCourseUpdate` coalesces events per course and runs one refresh at a time. Before fetching, it waits until no writes are pending and the course has had no local edit for 2 s (`_REFRESH_QUIET_MS`). During the fetch, `_persistLoadedField` skips any field edited after the refresh started (`_refreshMustSkip`), and the refresh runs again later, up to three passes per event.
- Changed from the plan: the cache isn't rebuilt by replaying pending operations. Waiting for the outbox to drain and skipping fields edited mid-fetch gives the same guarantee — a refresh never overwrites a local edit — without inverting every RPC back into cache shape.
- Teachers who grade continuously no longer trigger a full refetch for every score that lands; the refresh comes after they pause. Changes from another device show up within about 2 s of the teacher pausing.

**Done:** a score entered while a refresh is fetching survives it and reaches the server, and the test fails with the guard disabled. A refresh waits for in-flight writes. A refresh with no local edits applies the server's changes.

### Phase 5: stop the remaining over-sends — small (done; scope changed)

The original goal was to replace every `saveX(cid, wholeArray)` call with explicit per-row actions, mainly to cut traffic. Phases 2–3 already did most of that. Each save of students, assessments, modules, categories, notes, the learning map, scores or statuses now diffs against the server baseline and sends only the rows that changed. Rewriting ~60 call sites into explicit actions would change the code's shape without reducing traffic or fixing a bug, so it isn't planned. Phase 5 instead fixed the places that still sent more than they changed:

- **Rubrics.** Every rubric save re-sent every rubric in the course (each `upsert_rubric` rewrites its criteria and criterion-tag links), then reloaded them all. Against a baseline, only changed rubrics are sent, and the reload runs only when something was inserted (a new rubric or criterion needs its server id).
- **Categories in the class manager.** These were written twice, like the learning map was. The class manager wrote each edit directly, then `saveCategories` sent it again, and a delete ran twice. It's now the only writer; `adoptCategoriesFromServer` updates the cache and baseline without sending.
- **Category order.** `saveCategories` sent `reorder_categories` on every save, including each time the class manager loaded categories. It now does so only when the order changed.
- **Deletes.** Since Phase 1, a delete whose row was already gone (deleted elsewhere, or a retry after a lost response) landed in the failed list. The outbox now treats "not found" on a `delete_*` as done. The exception is seed observation templates, which report "not found" because they can't be deleted.

**Done:** tests cover the single-rubric save, unchanged categories and order, class-manager categories not being re-sent, and idempotent deletes. In a real browser, opening class-manager categories sent no writes, and a weight edit sent one `upsert_category`.

### Phase 6: cleanup — small

Remove dead code left behind: `_DATA_KEYS` entries used only for diffing, `persistScoreDiffToCanonical`, the `saveScores` mass-loss guard (no longer reachable), and the remaining legacy comments. Update `docs/ARCHITECTURE.md` and the offline-sync design doc.

## Out of scope

- Server schema changes. Every operation above maps to an RPC that already exists.
- Conflict detection across devices (see the conflict policy above).
- Moving local storage from localStorage to IndexedDB (codex D3). The outbox caps at 5 MB / 500 entries as today.

## Testing approach

- Unit tests run in CI on every push. No local Node is needed.
- Behaviour in the app: local static server and demo mode in the browser pane, plus demo-off checks against a fake client.
- Database-side checks: run inside `begin … rollback` on `gradebook-prod` while impersonating a teacher, as done for the 2026-10-12 migrations.
- After each phase ships: run the duplicate-row queries from the 2026-10-12 audit against production.
