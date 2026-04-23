# FullVision Open Work

This is the only active work list for the repo. Implementation history belongs in `docs/backend-design/HANDOFF.md`; this file is only for remaining work.

## User-blocked / operational

### P1.0 · Netlify quota fix

- `fullvision.ca` is documented as returning `503 usage_exceeded`.
- User-only. Resolve in Netlify billing/quota settings before trusting production verification.

### P1.1 · Rotate leaked publishable Supabase key

- User-only. Replace the old leaked publishable key in Netlify and local envs, then disable it in Supabase.

### P1.3 · Production push / production smoke follow-through

- User-only decision if more local-only commits accumulate.
- After the quota issue is resolved and the user wants a production update, run a live smoke on the deployed site.

### P2.3 · Decide `delete_course` semantics before wiring UI

- Normal teacher UI is archive-first now.
- A product decision is still required before any user-facing destructive delete affordance should exist.

### T-OPS-03 · Park legacy site at `legacy.fullvision.ca`

- DNS / user-facing operational task.

## Platform / integration

### P2.1 · Realtime rollout verification for v2 invalidation

- `course_sync_cursor` schema/docs, SQL trigger/publication plan, and client invalidation wiring exist in the repo.
- Still needs live Supabase rollout verification before this can be treated as fully closed.

### T-IMPORT-JSON-01 · Route legacy local JSON restore through v2 import

- `teacher/page-assignments.js` still has a lower-priority local `importData()` escape hatch.
- It should dispatch through `window.v2.importJsonRestore(...)` instead of only mutating local state.

### T-BE-02 · Teams import adapter

- `tiParsedFile` still does not match the payload expected by `import_teams_class`.
- Needs a normalization layer before Teams import can dispatch through `window.v2.importTeamsClass(...)` cleanly.

### T-UI-05 / T-BE-01 · Data export

- Still blocked on the missing backend export surface: `window.v2.exportMyData` / `export_my_data`.

### T-OPS-02 · Sentry project + DSN wiring

- Still open.

## Validation / demo follow-through

### P3.5 · Reconcile remaining Playwright failures

- Targeted smoke coverage and PR CI are green, but the broader Playwright suite still needs a clean reconciliation pass.

### P4.2 · Migrate Demo Mode to `buildDemoSeedPayload`

- Local Demo Mode still depends on `shared/seed-data.js`.
- Welcome Class bootstrap uses `buildDemoSeedPayload`, so the repo still maintains two seed paths.

### T-READ-01 · Finish `competency_tree` in student-profile SQL shape

- `docs/backend-design/read-paths.sql` still returns `competency_tree: null`.
- The intended grouped `competency_group -> section -> tag` read shape has not been composed yet.

## Deferred / external work

### D1 · Term-rating narrative auto-generate

- Deferred to the separate external workstream/repo.
- Keep the button hidden in this repo until that workstream is ready.

### D2 · Cross-year historical context on student profiles

- Explicitly deferred to v2+.
- Current product remains course-scoped per active design decisions.

### D3 · Offline read-side caching beyond the current write queue

- The write queue is implemented.
- Read-side cached API snapshots / IndexedDB delta-refresh remain future work in `offline-sync.md`.

### D4 · UI surfaces deferred beyond the current repo scope

- Parent portal
- Student portal
- File uploads / attachments
- Calendar / schedule view
- Email / push notifications
