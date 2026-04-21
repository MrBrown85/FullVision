# FullVision Post-Reconciliation Backlog

> **Status:** opened 2026-04-20 at the close of the [database-wiring reconciliation plan](../shipped/2026-04-20-database-wiring-reconciliation.md). Each item below is a standalone follow-up that surfaced during the reconciliation but was explicitly out-of-scope for it.
>
> **For agentic workers:** this is a punch list, not a ordered recipe. Pick the topmost open item that matches your budget, execute it, tick its checkbox, commit, and append one line to the HANDOFF activity log. Items are grouped by priority, not sequenced.

---

## P1 — operational / security (do first)

### P1.0 · Netlify site is serving 503 "usage_exceeded" — quota hit

- [ ] **User-only, urgent.** 2026-04-20 post-push probe returned `{"error":"usage_exceeded","message":"Usage exceeded"}` from `https://fullvision.ca/`. Site is on the **Team Dev** plan (`nf_team_dev`); monthly bandwidth / build minutes / edge-function invocations are capped.
- Check Netlify dashboard → Billing → see which quota is exhausted.
- Options: (a) wait for the month to roll over (if the cap is soft/monthly), (b) upgrade to Pro/Business, (c) reduce edge-function invocations (the `inject-env` function runs per HTML request — consider caching or pre-substituting at build time).
- While 503ing, the post-reconciliation push (commit `f76c666` and onwards) cannot be verified on production. Local `npm test` + `dev:local` flow still works end-to-end.

### P1.1 · Rotate the leaked publishable key `sb_publishable__CxM2aY7iVOxRid2EMtCiw_jT1g_n96`

- [ ] **User-only** (requires Supabase dashboard access).
- The key's name is "default" and it was committed in an earlier session's `.env.example` / screenshot flow.
- Replace all references in Netlify env vars + any `.env` files with the newer `prod202604` key (`sb_publishable_FfgtpNV7PStzUvYVD7qWOg_aAVjGrTY`).
- Disable the old key in the Supabase dashboard once the rotation is verified.

### P1.2 · Playwright end-to-end smoke: sign-up → write → sign-out → sign-in → read

- [ ] Covers the full auth+persistence round-trip the unit tests can't reach.
- Suggested flow: new account sign-up → email verification → Welcome Class appears → enter a score → sign out → sign back in → confirm the score survives.
- Lives at `tests/e2e/regression-core.spec.ts` (new).
- Runs locally via `npm run test:e2e` and in CI behind a nightly trigger (per-PR is overkill given the ~90s runtime).

### P1.3 · Lift the push embargo on `main`

- [ ] **User-only** — local `main` is 29 commits ahead of `origin/main` at the close of the reconciliation session.
- Decision: push as-is vs. open a single consolidation PR vs. squash the long-tail commits.
- After push, schedule a Demo-Mode smoke on the production Netlify deploy.

---

## P2 — schema & data platform

### P2.1 · Re-establish realtime publication for the v2 schema

- [ ] When `_initRealtimeSync` was removed in Phase 6.1, cross-device sync via Supabase Realtime went with it. The v2 schema never had a publication.
- Design: pick the 3–5 high-change tables (`score`, `tag_score`, `rubric_score`, `observation`, `observation_student`) and publish only them. Client subscribes scoped to `teacher_id = auth.uid()` via RLS.
- Re-enables phone → laptop push updates without round-tripping `get_gradebook`.

### P2.2 · Bulk read RPCs for out-of-gradebook entities

- [ ] `get_gradebook(p_course_id)` covers the active-course surface, but student-profile / goals / reflections / overrides / term-ratings currently require one `get_student_profile` call per student when rendering roster-wide views (e.g. the Reports tab).
- Proposed: `get_course_student_records(p_course_id)` returning the composite bulk payload. One RPC per course swap instead of N per roster paint.
- Sizing: 30-student class × ~6kB each ≈ 180kB per call — still well under PostgREST payload limits.

### P2.3 · `delete_course` semantics decision

- [ ] Currently `delete_course(p_id)` exists on gradebook-prod but has no client call site. ERD says `ON DELETE CASCADE` across course-owned tables — a click would wipe every enrollment, assessment, and score irrecoverably.
- Decide: (a) keep as-is, gated behind a strong confirm; (b) soft-delete via `deleted_at` + a 30-day grace window parallel to teacher soft-delete (Q29); (c) remove the RPC entirely and require archive-only.
- User input required before wiring any UI affordance.

### P2.4 · Regenerate `write-paths.sql` and `read-paths.sql` from live DB

- [x] Resolved during the Phase 5 gap-fill / reconciliation merge. The previously missing 2026-04-19/20 RPCs are now mirrored in `docs/backend-design/read-paths.sql` and `docs/backend-design/write-paths.sql`.
- Keep this entry as a historical note only; no current action required unless new drift appears.

### P2.5 · Wire `saveRubrics` UI → `window.v2.upsertRubric`

- [ ] Discovered 2026-04-21 while shipping T-UI-09/T-UI-10. The rubric editor in `teacher/page-assignments.js` persists via `saveRubrics(cid, arr)` which writes only to localStorage via `_saveCourseField('rubrics', …)`. The v2 `window.v2.upsertRubric` composite RPC exists and is unit-tested, but nothing in the UI invokes it — so rubric creations / edits on main (including the new weight + levelValues fields) don't reach `gradebook-prod`.
- Scope: add a thin adapter in `saveRubrics` that maps the editor's internal shape (`criteria[i].levels = { 4, 3, 2, 1 }` + `weight` + `levelValues`) into the v2 composite payload (`level4Descriptor` etc., plus `linkedTagIds` from `tagIds`) and dispatches one `window.v2.upsertRubric` per rubric when `_useSupabase`.
- Affects every teacher who has non-trivial rubrics once the SMTP / quota issues are resolved and teachers start using the product. High leverage, small code.

---

## P3 — UI polish / copy

### P3.1 · Freeze `Date.now` in the mobile-components test suite

- [x] _Shipped 2026-04-20 via commit `145686d`_ — wrapped the `dateGroupLabel` describe blocks and the multi-group `renders multiple date groups correctly` test with `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-04-20T12:00:00Z'))` + `vi.useRealTimers()` in afterEach / finally. Full suite now 805/805 green (previously 800 + 5 flakes). Root cause was `dateGroupLabel` parsing YYYY-MM-DD as local midnight while fixtures computed today via UTC `.toISOString()`.

### P3.2 · Regenerate `docs/backend-design/decisions.html`

- [ ] Q50 (save_course_score hotfix rationale) and Q51 (`--no-ff` merge strategy) were added to `DECISIONS.md` during Phase 5 but the HTML mirror was not regenerated.
- Whatever tool produced the existing HTML (or a re-render from markdown via pandoc/marp) should be run once to sync.

### P3.3 · Replay the `spec-vs-ui-diff.md` audit

- [ ] The Phase 3 verification added ~111 new unit tests but didn't re-read `spec-vs-ui-diff.md` against the actual post-merge UI. Entries in the "historical" status column may now be "matches" or "fixed."
- Light-touch pass — rerun any grep-based checks the original audit used and update per-row status.

### P3.4 · Fix Playwright e2e webServer to serve the built `dist/` with credentials injected

- [x] _Shipped 2026-04-20 via commit TBD._ Added `scripts/build-e2e.sh` (wraps `build.sh`, then sed-substitutes `__SUPABASE_URL__` / `__SUPABASE_KEY__` with syntactically-valid dummies) + `npm run build:e2e` script. Updated `playwright.config.js` webServer command to `npm run build:e2e && npx serve dist -l 8347` with 60s timeout. Result: went from 0 passing → **123 passing / 18 failing / 1 skipped** out of 142. The remaining 18 are content-mismatch (not infrastructure) and tracked under P3.5.

### P3.5 · Reconcile 18 remaining e2e failures against post-merge UI

- [ ] After P3.4 unblocked the e2e infra, these specs still fail:
  - `gradebook.spec.js` × 4 — filter button, Scores/Summary tab rendering, tab-switching
  - `mobile.spec.js` × 11 — sidebar toggle, dashboard content rendering, heatmap, grid layouts, edge cases at 320/375px
  - `reports.spec.js` × 3 — preset buttons, block toggles, print button
- None of these are infrastructure — the pages load, auth is mocked, data is seeded. The tests reference UI affordances that have either moved, renamed, or regressed during the v2 rebuild. A focused session per spec (~15 min each) should resolve most.
- Priority order: gradebook (highest use), then reports, then mobile.

---

## P4 — demo / seed content

### P4.1 · Promote `_categories_preview` into `import_json_restore`

- [ ] `shared/demo-seed.js` generates a `_categories_preview` array of 3 Q43-spec categories, but `import_json_restore` doesn't currently consume a `categories` section — the preview is informational only.
- Add a `categories` section handler to `import_json_restore` (FK-safe: must come before `assessments` since `assessment.category_id → category.id`), then rename `_categories_preview` → `categories` in `demo-seed.js`.
- Unlocks the demo-seed category weighting flow per the Q43 spec.

### P4.2 · Migrate Demo Mode to consume `buildDemoSeedPayload`

- [ ] Demo Mode currently loads `shared/seed-data.js` (the legacy Science-8 seed). The new `shared/demo-seed.js` Grade-8 Humanities generator (Phase 5.1) is only used for Welcome Class seeding via `applyDemoSeed`.
- Per Q47 follow-up: write a local-only projector that maps the `buildDemoSeedPayload` output into the in-memory cache structure Demo Mode expects, so both Demo Mode and Welcome Class share one source of truth.

---

## Done / archived

- 2026-04-20 — database-wiring reconciliation plan shipped (`../shipped/2026-04-20-database-wiring-reconciliation.md`).

---

> **Conventions** — same as the reconciliation plan: commits stay local until user lifts the push embargo, no AI co-author, Demo-Mode verification on UI changes, one task per session, every tick appends a line to `docs/backend-design/HANDOFF.md`'s activity log.
