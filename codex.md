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

## Platform / integration

### P2.1 · Realtime rollout verification for v2 invalidation

- `course_sync_cursor` schema/docs, SQL trigger/publication plan, and client invalidation wiring exist in the repo.
- Still needs live Supabase rollout verification before this can be treated as fully closed.

### T-UI-05 / T-BE-01 · Data export

- Still blocked on the missing backend export surface: `window.v2.exportMyData` / `export_my_data`.

### T-OPS-02 · Sentry project + DSN wiring

- Still open.

## Validation / demo follow-through

### P3.5 · Reconcile remaining Playwright failures

- Targeted smoke coverage and PR CI are green, but the broader Playwright suite still needs a clean reconciliation pass.

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

### D5 · Migrate Demo Mode to `buildDemoSeedPayload`

- Local Demo Mode still depends on `shared/seed-data.js` (legacy camelCase, string IDs).
- `buildDemoSeedPayload` uses v2 snake_case schema; a full client-side hydration layer would be needed to swap. Deferred until the schema gap is smaller or the maintenance cost becomes acute.

### D4 · UI surfaces deferred beyond the current repo scope

- Parent portal
- Student portal
- File uploads / attachments
- Calendar / schedule view
- Email / push notifications

### D6 · Redesigned Teams import

- The original Microsoft Teams CSV/XLSX import wizard was removed on 2026-04-23 (commit `f618f9b`) because it never dispatched through the v2 `import_teams_class` RPC and silently lost data on sync.
- The server-side `import_teams_class` RPC is still deployed on `gradebook-prod` and untouched — a future client flow can call it once redesigned.
- Before reintroducing: decide on the parse surface (reuse SheetJS vs. CSV-only), define the payload-normalization layer that aligns with the RPC, and spec the UI wizard.
