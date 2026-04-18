# FullVision — Action Plan

Last refreshed: 2026-04-17. Items are tracked here as they're discovered; closed items live in the Done section at the bottom.

---

## P0 — In flight

### 1. Phase 1c-reads — wire `_doInitData` to canonical RPCs

**Why**: Phase 2 (commit `c02e6e3` on `phase-2-canonical-writes`) wired all high-frequency *writes* to canonical RPCs (`enroll_student`, `create_assessment`, `save_course_score`, `create_observation`, etc.). Reads still come from localStorage — so data written from another device (or imported on the server side) never appears until you log out and back in. The bridge in `_doInitData` short-circuits the broken legacy `.from('students')` etc. calls.

**Plan**:
- Replace `_doInitData(cid)` body with parallel calls to `list_course_roster`, `list_course_assessments`, `list_course_scores`, `list_course_observations`, `get_course_policy`, `get_report_config`, `list_course_outcomes`, `list_assignment_statuses`.
- Per-student loops for `get_student_goals`, `list_student_reflections`, `list_section_overrides` (no bulk variant in the canonical schema).
- Update converter functions to map canonical row shapes to the existing legacy cache shape so consumers don't have to change in lockstep.
- Re-enable `tests/data-pagination.test.js` (currently `describe.skip`) against the canonical reads.

### 2. Score race-window during import

**Why**: When a Teams import enrolls a student and immediately scores the same student in the same tick, the local student `id` is still a non-UUID `uid()` and `_persistScoreToCanonical` skips. The score lands in localStorage but never syncs. Users see scores locally but not on other devices.

**Fix options**: await the per-row `enroll_student` promise inside `teams-import.js` before scoring, OR queue a deferred score sync in `data.js` that fires once all in-flight enrollments resolve.

---

## P1 — Near term

### 3. Rotate the leaked publishable key

`sb_publishable__CxM2aY7iVOxRid2EMtCiw_jT1g_n96` was committed to git history. Even with env-var injection in place now, the leaked key is still active. Step-by-step in the rotation thread; short version: create a new publishable key in Supabase → update `SUPABASE_KEY` in Netlify → "Clear cache and deploy site" → verify in incognito → disable the old key.

### 4. Get the E2E suite green

Last run: 102 of ~141 specs failing. Root cause for the auth specs: [`login-auth.js:33`](login-auth.js#L33) auto-redirects to `/teacher/app.html` whenever `localhost` lacks env vars, so tests that try to assert anything on the login page never see it. Fix: require an explicit `?dev=1` opt-in (mirrors what `shared/supabase.js` already does for the dashboard).

### 5. CI / branch-protection

No GitHub Actions yet. Add a workflow that runs `npm test` + `npm run format:check` on push/PR, then turn on branch protection requiring it on `main`.

### 6. Clear the legacy bridge in `data.js`

Once Phase 1c-reads lands and the canonical write paths have been validated in production, delete the `// CANONICAL-RPC TRANSITION:` early-return short-circuits in `_doSync`, `_initRealtimeSync`, `_handleCrossTabChange`, `_refreshFromSupabase`, and `_deleteFromSupabase`. Their replacements should be the canonical RPC paths added in Phases 1b–2.

---

## P2 — Medium term

### 7. Realtime publication for the canonical schema

`supabase_realtime` was emptied by the `zero_data_publication` migration. Cross-device live sync is offline. Add the canonical entity tables (`assessment.score_current`, `observation.observation`, `academics.enrollment`, etc.) to the publication and re-enable the realtime listener in `data.js`.

### 8. Add bulk RPCs for medium-frequency entities

Goals, reflections, and overrides have only per-student RPCs in the canonical schema. Loading 30 students = 90 round-trips. Add `list_student_goals_for_course`, etc., or accept the latency (acceptable for typical class sizes; revisit if it bites).

### 9. Add a `delete_course` RPC

There's no canonical way to delete a course — only `update_course` to archive it. Decide: archive-only (no delete), or add `delete_course` that cascades through `score_current`, `enrollment`, etc.

### 10. Storage for modules / rubrics / custom tags / student-notes

The canonical schema has no tables for these. They currently live in localStorage only. Decide: keep client-only, or add JSONB fields on `course_policy`.

### 11. Error monitoring

No Sentry-equivalent. The data layer already has a global error logger; wire it to a real backend.

### 12. Asset fingerprinting + minification

Trade off the simplicity of the no-build deploy for cache busting and ~30% size reduction. Only worth it if perf becomes a real complaint.

---

## P3 — Long term

### 13. ES modules migration

IIFE pattern works but blocks tree-shaking and modern tooling. Migrate one leaf module at a time (`shared/constants.js` first), keep IIFE shim for backward compat during the transition.

### 14. Multi-portal scaffolding

`netlify.toml` already reserves `/student` and `/parent` routes. The `projection.dashboard_student_summary` schema also points to a multi-stakeholder future. Build out when there's a real need.

---

## Done

| When | What |
|------|------|
| 2026-04-18 | Phase 2 — high-frequency writes (`saveStudents`, `saveAssessments`, `upsertScore`, `addQuickOb`/`updateQuickOb`/`deleteQuickOb`) wired to canonical RPCs. PR #63. |
| 2026-04-18 | Demo Mode — login-screen button bypasses auth and loads Science 8 sample class. PR #63. |
| 2026-04-17 | Phase 1c-writes — `createCourse`, `updateCourse`, `saveCourseConfig`, `saveReportConfig`, `saveConfig` wired to canonical RPCs. Commit `dfb4331`. |
| 2026-04-17 | Phase 1b — `initAllCourses` wired to `get_teacher_preferences` + `list_teacher_courses`. Commit `39f0461`. |
| 2026-04-17 | Bridge — short-circuited every legacy `.from()` write so production stops throwing 18 PGRST205 errors per page load. Commit `3abbcba`. |
| 2026-04-17 | `schema.sql` regenerated from `supabase_migrations.schema_migrations` (130 KB across 31 migrations). |
| 2026-04-17 | Locked `search_path` on 10 functions flagged by Supabase advisors. Migration `lock_function_search_paths`. |
| Earlier | Move Supabase credentials to env vars (Netlify edge function `inject-env.js`). |
| Earlier | Inline `onclick` handlers replaced with `data-action` delegation in shared modules. |
| Earlier | CSP headers + per-request nonce wired in `inject-env.js`. |
| Earlier | Service worker, PWA manifest, idle-timeout sign-out, FOIPPA-compliant data wiping. |
