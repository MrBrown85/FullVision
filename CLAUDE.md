# FullVision Backend Design — Charter

**Status:** Design phase complete (Passes A–D). Backend implementation complete on `gradebook-prod` (all Phase 1 write-path RPCs + read-path RPCs + pg_cron retention + imports). Client port complete on branch `rebuild-v2` in the main FullVision repo (Phase 3 + 4 landed as 15 local commits). Phase 5 polish — demo-seed JSON, custom SMTP, pgTAP/smoke-test CI — remains. See [HANDOFF.md](docs/backend-design/HANDOFF.md) for the authoritative activity log and remaining work.

This worktree originally designed the backend **from scratch** from the user inputs inventory. That phase is done. Partway through Pass D the charter shifted to **"match the UI the user already has."** UI references in design docs are intentional and welcome.

## Hard rules (still in force)

- **Source of truth for feature coverage:** `fullvision-user-inputs.xlsx`. Every row worth persisting maps to exactly one entity.
- **Ignore the `Persistence` column** (LS / SB / LS pref / EPH / Mixed). Treat every row that represents real user-authored data as "must persist." The existing split is an implementation artifact, not a domain fact.
- **Ignore rows that are pure UI state:** search boxes, filter toggles, modal open/close, sort toggles, sheet open/close, drag reorders of UI-only elements, tab switches, sidebar toggles. These are client concerns, not backend entities.
- **Collapse mobile + desktop rows** for the same action into one write path. `m-grade-score` and `cycleScore` are the same write.

## Retired rules (design-phase only; no longer in force)

- ~~"Do not read files outside this worktree."~~ The rebuild charter is explicitly "match the existing UI," so referencing UI code is expected. [spec-vs-ui-diff.md](docs/backend-design/spec-vs-ui-diff.md) and Pass C §8.1 cite UI file paths on purpose.
- ~~"No Supabase-specific assumptions."~~ Q1 in [DECISIONS.md](docs/backend-design/DECISIONS.md) committed to Supabase full-stack; Supabase patterns (RLS, Edge Functions, refresh tokens) are now in scope.
- ~~"Ignore existing RPC names."~~ Post-fold, the implementation layer can align with existing RPC names where the UI already calls them.

## Three-pass workflow (complete)

- **Pass A — ERD.** `docs/backend-design/erd.md`. Final state includes the Pass D amendment folded in (2026-04-19).
- **Pass B — Write paths.** `docs/backend-design/write-paths.md`.
- **Pass C — Auth & session lifecycle.** `docs/backend-design/auth-lifecycle.md`.
- **Pass D — Read paths + computations.** `docs/backend-design/read-paths.md`.

## Deliverable conventions

- Mermaid for diagrams (renders in GitHub).
- One markdown file per pass — no sprawl.
- Entity dictionary columns: name, purpose, key attributes, owning actor, cardinality notes.
- When an input doesn't fit cleanly into an entity, flag it in a `## Open questions` section rather than forcing a fit.

## What "done" looks like for Pass A

- Every non-ephemeral row in `All Inputs` maps to exactly one entity (or is explicitly flagged as ambiguous).
- No entity exists that isn't backed by at least one input row.
- FKs form a connected graph rooted at Course + Student.
