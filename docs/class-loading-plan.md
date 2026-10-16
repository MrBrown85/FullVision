# Class loading plan

Planned 2026-10-15. Each phase is its own PR, safe to ship alone, in this order.
Database changes go live first and must work with both the current client and
older cached clients; client PRs follow. Never merge on a red drift check.

## Context

Switching classes is slow. A switch awaits `initData(cid)` (`shared/data.js`),
which makes about N + 8 requests, mostly one after another (N = assessments):

`get_gradebook` → `get_learning_map` ‖ `get_observations` → `rubric` → `criterion`
→ `criterion_tag` → `get_assessment_detail` × N in batches of 4 →
`list_course_student_profiles` → `course_sync_cursor` read + realtime join.

Nothing renders until all of it finishes.

| Call (pg_stat_statements, 2026-10-15) | Mean   | Max   |
| ------------------------------------- | ------ | ----- |
| `get_gradebook`                       | 308 ms | 3.7 s |
| `list_course_student_profiles`        | 367 ms | 3.4 s |
| `get_assessment_detail` (× N)         | 34 ms  | 1.0 s |

The database time is per-cell work, not missing indexes; every foreign key used
here is indexed live.

- `get_gradebook` cross-joins enrollment × assessment, calling
  `fv_assessment_overall` for each pair.
- It also calls three grade functions per student, and
  `list_course_student_profiles` repeats those same three per student.
- All of these functions run row-level security (RLS) checks on every row read.
- The client uses none of these server-computed grades. It calculates grades
  itself in `shared/calc.js`.

**Goal.** A class opens instantly from a saved copy, checks the server with one
small request, and reloads only if something changed. It never silently shows
wrong data, never loses an edit, never shows a blank screen, and keeps working as
data grows.

## Decisions

| #   | Decision                                   | Choice                                                                                                                                                 |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Bundle RPC security                        | SECURITY DEFINER with an ownership check first, if measurement shows RLS cost dominates; otherwise INVOKER                                             |
| D2  | Observations in the bundle                 | Most recent 500 plus a total; older ones paged with `get_observations`                                                                                 |
| D3  | Saved copies                               | Kept until sign-out or an expired session; deleted after 14 days unopened                                                                              |
| D4  | Prefetch other classes                     | No, for now. It would add load without measured need                                                                                                   |
| D5  | IndexedDB                                  | Later, when localStorage use passes 50% or quota warnings appear                                                                                       |
| D6  | Conflict detection (version-checked saves) | Later, separate project. Until then, editing is locked while the version check runs                                                                    |
| D7  | Timing                                     | `performance` marks plus a `window.__fvPerf` buffer, logged when `localStorage['fv-perf'] === '1'`. Sentry tracing stays off (`tracesSampleRate` is 0) |
| D8  | Supabase plan                              | Stay on Free for now. Open risks: the project pauses after 7 idle days (a summer break would trigger it), and there are no backups                     |
| D9  | Boot                                       | Cached class list renders after `requireAuth`, never before                                                                                            |

**No TanStack Query.** It would keep its own copy of server data next to
`_cache`/`_serverState`, giving two sources of truth. It has no build that
loads without a bundler, and the lock file can't be regenerated here. The
useful parts are about 80 lines in `data.js`.

## Phase 0: CSP-blocked handlers (shipped, #154)

The CSP has no `'unsafe-inline'`, so browsers ignored three inline `on*`
attributes:

- the sidebar class picker, so changing class did nothing on every tab except
  Dashboard;
- the roster search;
- the report narrative's dirty flag.

**Shipped in #154:**

- The picker and search are now wired by delegation.
- A dirty narrative now saves even when the student has no rating yet.
- `tests/no-inline-handlers.test.js` fails if an inline handler returns.
- CSP violations are now reported to Sentry.

**Not shipped:** reviving the Playwright suite. It mocks retired tables, and
`build-e2e.sh` uses macOS-only `sed`, so it is its own task.

## Phase 1: Load-path safety (shipped, #155)

Every item here is a defect that cache-first loading would make worse.

1. **Report cards can be erased.**
   - Term ratings and report config are set to empty on every class load and
     never read back from the server.
   - `upsertTermRating` then sends the whole blob. `save_term_rating` treats a
     present key as "set this", so after any reload, one rating click sends
     `narrative_html: ''` and `social_traits: []`, which overwrites the saved
     narrative and social traits on the server.
   - Fix: send only the fields the caller changed, and stop wiping
     `termRatings`, `reportConfig` and `courseConfigs` on load.
   - Loading them from the server comes with the bundle in Phase 3.
   - The audit table shows no erased data yet.
2. **A failed load wipes good data.**
   - Today the `_doInitData` catch writes an empty class over localStorage and
     the `_serverState` baselines, with no error shown.
   - Fix:
     - Call `get_gradebook` through `_callRpcWithAuthGuard`.
     - On error, write nothing and record `_loadError[cid]`.
     - Show a non-blocking "Couldn't load the latest — showing your saved copy ·
       Retry" message.
   - A class deleted on another device is removed when the class list loads,
     not on a failed load: an unauthenticated call also reads as "not found".
   - Rewrite the test that locks in the old behaviour
     (`tests/data-pagination.test.js`, "falls back to empty cache").
3. **Fields blanked before they refill.**
   - `_v2GradebookToCache` sets observations, flags, goals, reflections,
     overrides, summaries and the learning map to empty before the follow-up
     reads.
   - If a follow-up read fails, they stay blank.
   - Fix: set a default only when the field is still `undefined`.
4. **Loads overwrite unsent edits.**
   - Only realtime refreshes snapshot `_localWrites`.
   - Switch and page loads can overwrite fields that have writes still in the
     outbox.
   - Fix:
     - Snapshot at the start of every load, so `_refreshMustSkip` covers them.
     - Also count outbox entries queued in earlier sessions (`v2Queue.stats()`),
       not only `_pendingSyncs`.
     - Schedule a follow-up refresh for any field that was skipped.
5. **Two-tab refetch loop.**
   - `_scoreEntryFromCanonical` stamps `Date.now()` into every loaded score, so
     every load rewrites `gb-scores-<cid>`.
   - The other tab's `storage` listener sees that and refetches.
   - Fix:
     - Give loaded scores deterministic ids (`sid:aid:tagId`) and server times.
     - Skip localStorage writes that wouldn't change anything.
     - Listen to `storage` only when `BroadcastChannel` is missing, and only for
       the active class's keys.
6. **One switch helper.**
   - The six page `switchCourse` copies and the mobile one become
     `switchActiveCourse(cid)`, which resolves false when a later switch won.
   - A generation token stops a slow load from rendering, or claiming the
     realtime channel, after a later switch.
7. **Small gaps.**
   - Quick-observation writes now call `_markLocalWrite`.
   - The `'student-records'` realtime refresh now also reloads observations.
   - Deep links with `?course=` now load that class.
   - Mobile pull-to-refresh now really refreshes, instead of calling a removed
     function and showing "Synced".
8. **Owner scoping.**
   - A `gb-owner` key holds the signed-in teacher; on a mismatch, all `gb-*` data
     is wiped before any read.
   - Degraded mode no longer shows another teacher's cached classes.
   - Data is also wiped on the expired-session redirect.
   - Data for classes the server no longer lists is removed.
   - `_clearCourseLocalState` now also clears `categories` and
     `student-profile-summaries`.
9. **Baseline timing (D7).** Record switch times on the current code before
   Phase 3 changes anything.

**Tests:** new `tests/data-load-safety.test.js` covering each item above.

**Rollback:** revert.

## Phase 2: Class version the database maintains (shipped)

Applied 2026-10-15 as `course_sync_version`. It keeps the existing per-row
triggers rather than statement-level ones: equality checks only need the
version to change, and a bulk write bumping it once per row costs nothing
measurable. A rolled-back test as a teacher confirmed every table below
bumps only its own class.

**Problems with today's change signal (`course_sync_cursor`):**

- It uses `now()` timestamps (transaction start), which can move backwards
  between overlapping writers.
- About 20 tables never bump it: the learning map, rubrics, assessment tags,
  modules, notes, custom tags, observation joins and term-rating children.
- `_touch_course_sync_cursor` is callable by any signed-in user, for any class.

**Migration `course_sync_version`:**

1. Add `version bigint not null default 0` to the cursor.
2. Add `_bump_course_versions(uuid[], bucket)`:
   - SECURITY DEFINER, with an empty search path.
   - Locks cursor rows in sorted order, then sets `version = version + 1`.
   - Still updates the old timestamps, so old clients keep working.
3. Replace the per-row triggers with statement-level triggers that use
   transition tables, on every course-data table. Bulk RPCs then bump once per
   statement.
4. Revoke execute on the touch functions from `public`, `anon` and
   `authenticated`.

**Verify (in a transaction that is rolled back, impersonating a teacher):**

- Every write RPC, bulk ones included, raises the version exactly once per
  statement, and only on its own class.
- Old clients still get realtime events.

**Rollback:** a forward migration that restores the per-row triggers.

## Phase 3: One request per class (shipped, #157)

Shipped as `get_class_bundle`, SECURITY DEFINER after an ownership check:
under row-level security, reading 24,000 tag scores took 496 ms instead of
12 ms. Scores travel as compact rows that point into the roster, assessment,
tag and criterion lists. Measured: a 24-student class 16 ms warm; a synthetic
40 × 150 × 4 class 0.6 s and about 1 MB, where `get_gradebook` hit the
statement timeout. Found on the way: the separate reads' first load on a
device keyed a rubric score by its criterion id, because rubrics arrived
after the scores.

1. Commit a snapshot of the live read functions to
   `docs/backend-design/live-snapshot-2026-10-15.sql`. Some function bodies were
   never in the repo.
2. **New RPC `get_class_bundle(p_course_id uuid, p_if_version bigint default null)`
   (migration `get_class_bundle`):**
   - It is STABLE, so it reads from a single snapshot.
   - If the version matches, it returns `{not_modified, version}`.
   - **Otherwise it returns raw data, assembled set-based:**
     - the roster and categories
     - modules
     - assessments with `tag_ids`
     - flat score arrays (`scores`, `tag_scores`, `rubric_scores`, with
       modifiers)
     - the learning map
     - rubrics, criteria and criterion tags
     - goals, reflections, overrides and flags
     - notes with ids
     - term ratings with their children
     - report config, custom tags, and the most recent 500 observations plus a
       total
   - It does no server-side grade computation.
   - It returns nothing for a class that has been deleted.
   - Measure it with EXPLAIN and a synthetic scale test (40 students × 150
     assessments × 4 tags, 3,000 observations). Targets: under 150 ms and under
     1.5 MB.
3. **Client changes:**
   - `_bundleToCache` stages every field, then commits through the Phase 1
     guard. It reuses the existing converters.
   - Rubrics are mapped from the bundle itself, never from a stale cache.
   - The version is recorded only if every field was applied.
   - `report-blocks.js` calculates a section override's `calculated` value
     locally.
   - If the RPC is missing (`PGRST202`), the client falls back to the old path
     behind `__FV_CLASS_BUNDLE`.
4. **Tests:** a golden test feeds one fixture through the old and new paths and
   expects identical getters and identical `calc.js` results.

## Phase 4: Show the saved copy first, then check (with Phase 5, #158)

1. **A `gb-bundle-meta-<cid>` key stores:**
   - `version`
   - `savedAt`
   - `owner`
   - `schema`
   - `dirty`, set by the first local edit and cleared when a bundle is applied
2. **Switch or boot with a valid saved copy:**
   - Render the copy immediately.
   - Then call the bundle with the saved version:
     - `not_modified`: done.
     - Changed: apply through the guard, then re-render. Re-rendering already
       waits while an input has focus.
     - Failed or offline: keep the copy and show "Saved copy from <time>".
   - Seed `_serverState` from the copy only when it is not dirty.
3. **Edit lock:** score editing stays read-only until the check answers. An
   indicator appears only if the check takes longer than 400 ms.
4. **With no saved copy:** show a full-page skeleton. Lock `#main` entirely,
   including the keyboard; today's lock only blocks the mouse.
5. **Print and Export** on Reports wait for fresh data.
6. **Storage budget:**
   - At most 4 classes or about 3 million characters, removing the least
     recently used first.
   - Never remove the active class.
   - Never remove anything while the outbox has entries; the outbox shares the
     5 MB quota.
7. **Kill switch:** `FV_CACHE_FIRST`.

## Phase 5: Realtime by version

- Subscribe when the switch starts, with the bundle version as the baseline.
- Ignore events at or below the known version.
- Revalidate on re-subscribe, on coming back `online`, and on
  `visibilitychange` (at most once every 30 s). This replaces the empty
  `_initVisibilityRefresh`.

## Phase 6: Cleanup (two weeks after Phase 4)

- Remove the legacy load path and the kill-switch flags.
- Once pg_stat_statements shows no callers, drop `get_gradebook`'s
  `row_summaries` work and the unused read RPCs.
- Keep `get_student_profile` and paged `get_observations`.

## Later, separate projects

- **IndexedDB storage (D5).**
- **Conflict detection (D6):** start with whole-blob saves (`upsert_rubric`,
  `save_report_config`, `save_collab`, `save_term_rating`).
- **Grading settings stored on the server.** `gradingScale` and
  `categoryWeights` live only in the browser and reset on every class load.
- **Revive the Playwright suite** and run it in CI.

## User-experience consequences

| Consequence                        | Phase | Mitigation                                                                      |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------- |
| Old values flash, then update      | 4     | Check usually answers in 100–200 ms; one re-render; reports wait for fresh data |
| An edit lands on stale data        | 4     | Edit lock until the check answers; conflict detection later                     |
| A reload overwrites an unsent edit | 1     | Guard covers every load and earlier-session outbox entries                      |
| A failed load blanks the class     | 1     | Keep the copy; message with Retry                                               |
| Report comments erased             | 1     | Partial saves; no wipe on load; loaded from server in Phase 3                   |
| Data left on a shared computer     | 1, 4  | Owner check, wipe on expiry and sign-out, 14-day cap                            |
| Storage full                       | 1, 4  | Deterministic entries, least-recently-used eviction that protects the outbox    |
| A change is never noticed          | 2     | Version bumped by triggers on every course table, tested per RPC                |
| Big classes hit the 8 s timeout    | 3     | Set-based bundle, scale test before shipping                                    |
| Two tabs refetch forever           | 1     | Deterministic writes, BroadcastChannel only                                     |
| Old tabs call old RPCs             | 3, 6  | Old RPCs kept until two quiet weeks                                             |
