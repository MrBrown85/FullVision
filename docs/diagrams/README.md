# FullVision — System Diagrams

Open any `.drawio` file in:
- [app.diagrams.net](https://app.diagrams.net/) (web, free)
- draw.io Desktop
- VS Code with the **Draw.io Integration** extension (ships with `.drawio` rendering)

## Reading order

| # | File | Start here if you want to know… |
|---|---|---|
| 01 | [system-architecture.drawio](01-system-architecture.drawio) | What runs where. Containers, trust boundaries, caches, auth token flow. |
| 02 | [database-schema.drawio](02-database-schema.drawio) | The canonical Postgres tables and how they relate. |
| 03 | [frontend-module-map.drawio](03-frontend-module-map.drawio) | Which JS file owns which feature. |
| 04 | [auth-and-routing.drawio](04-auth-and-routing.drawio) | What happens between landing on a URL and seeing a page. |
| 05 | [hydration-on-login.drawio](05-hydration-on-login.drawio) | The `initAllCourses` + `initData` RPC fan-out. Where the April 3–18 data-invisible bug lived. |
| 06 | [write-path-map.drawio](06-write-path-map.drawio) | Every entity and whether its writes reach Supabase. Colour-coded. |
| 07 | [score-entry-paths.drawio](07-score-entry-paths.drawio) | Desktop (canonical) vs mobile (stubbed) scoring — the current open bug. |
| 08 | [observation-lifecycle.drawio](08-observation-lifecycle.drawio) | Full CRUD canonical path — the template to copy for unwired entities. |
| 09 | [term-report-flow.drawio](09-term-report-flow.drawio) | Questionnaire → term rating → progress report render → print. |
| 10 | [service-worker-cache.drawio](10-service-worker-cache.drawio) | SW lifecycle, fetch strategy, cache busting. Why PWA users sometimes need Unregister + hard reload. |

## Conventions

- **Green** shapes = reaches Supabase.
- **Red** shapes = localStorage only (wiped on sign-out).
- **Yellow** shapes = partially/conditionally persisted.
- **Blue** shapes = UI.
- **Purple** shapes = in-memory or projection views.
- **Orange** shapes = Netlify edge.
- **Grey** shapes = legend / notes.

## Source file references

Every diagram names the shared/data.js line numbers it describes where possible. If a line number doesn't match your current checkout, the function name still does (grep will find it).
