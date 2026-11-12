> Drawn in April 2026 (03 and 04 updated Oct 27). Kept for history. How the app is built today: [ARCHITECTURE.md](../../ARCHITECTURE.md).

# FullVision Diagram Reference Assets

Open any `.drawio` file in:

- [app.diagrams.net](https://app.diagrams.net/) (web, free)
- draw.io Desktop
- VS Code with the **Draw.io Integration** extension

These files are preserved reference material from the reconciliation, debugging, and user-flow mapping passes. They are useful background, but they are **not** part of the active documentation path.

For current architecture and what comes next, read:

1. [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md)
2. [`docs/ROADMAP.md`](../../ROADMAP.md)

## System and runtime diagrams

| #   | File                                                            | Reference use                                                       |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| 01  | [system-architecture.drawio](01-system-architecture.drawio)     | Historical high-level app and deployment snapshot.                  |
| 02  | [database-schema.drawio](02-database-schema.drawio)             | Visual companion to the backend design SQL/reference docs.          |
| 03  | [frontend-module-map.drawio](03-frontend-module-map.drawio)     | Shared, desktop, and mobile module relationships.                   |
| 04  | [auth-and-routing.drawio](04-auth-and-routing.drawio)           | Sign-in, auth checks, and route/landing behavior.                   |
| 05  | [hydration-on-login.drawio](05-hydration-on-login.drawio)       | Login/bootstrap hydration flow as diagrammed during reconciliation. |
| 06  | [write-path-map.drawio](06-write-path-map.drawio)               | Write-surface map captured during the v2 wiring pass.               |
| 07  | [score-entry-paths.drawio](07-score-entry-paths.drawio)         | Score-entry interaction/reference map.                              |
| 08  | [observation-lifecycle.drawio](08-observation-lifecycle.drawio) | Observation capture and report-use reference.                       |
| 09  | [term-report-flow.drawio](09-term-report-flow.drawio)           | Report-generation and term-rating flow reference.                   |
| 10  | [service-worker-cache.drawio](10-service-worker-cache.drawio)   | Service worker and offline/cache behavior snapshot.                 |

## User-journey source assets

These user-flow files are also reference-only and were produced for diagramming/delivery work rather than as live operating docs:

- [`lucidchart-user-flows.drawio`](lucidchart-user-flows.drawio)
- [`lucidchart-first-time-report-flow.mmd`](lucidchart-first-time-report-flow.mmd)
- [`lucidchart-teacher-assignment-comment-grade-flow.mmd`](lucidchart-teacher-assignment-comment-grade-flow.mmd)

## Notes

- 03-frontend-module-map names `teams-import.js`, which no longer exists.
- Some diagrams predate the current RPC naming, category-grading rollout, or other current-state cleanup work.
- Treat the `.drawio` and `.mmd` files as preserved source assets, not as authoritative status documents.
