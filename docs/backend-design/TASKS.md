# FullVision v2 — Claude Code Task Queue

Every remaining task packaged as a self-contained Claude Code session. Copy a task's prompt block into a fresh session; it has enough context to act without prior conversation.

**Branch:** `rebuild-v2` (single review target is PR #76). **Never force-push or rewrite history.**

**Canonical references every session should read first:**
- `docs/backend-design/INSTRUCTIONS.md` — full scope + content strings baked in
- `docs/backend-design/DESIGN-SYSTEM.md` — existing CSS tokens and component patterns
- `docs/backend-design/HANDOFF.md` — implementation log; append per-session entry
- Project `CLAUDE.md` — Demo Mode verification rule, no-AI-refs in git, project title is "FullVision"

**Core rule:** UI stays as literal existing files. Never rewrite visual language. Every new control uses existing CSS classes and tokens. Every UI change is visually verified in Demo Mode before claiming done.

---

## How tasks are structured

Each task block has:
- **ID** — stable; do not renumber when tasks complete
- **Goal** — one-line outcome
- **Prompt** — paste verbatim into a fresh Claude Code session
- **Likely files** — starting point; actual touched files may differ
- **Depends on** — list of task IDs that must land first
- **Acceptance** — observable completion criteria
- **Budget** — rough session size

Mark tasks done by editing the ID to **[DONE]** and adding a commit hash. Do not delete task blocks.

---

## Tier 1 — Backend-to-UI wiring audit (do first)

These unblock the UI tasks and prevent "why isn't my change visible?" confusion.

### T-WIRE-01 · Audit legacy save* calls

**Goal:** Confirm every UI write action calls a `window.v2.*` helper, not a legacy `save*` / `_canonical*` stub.

**Prompt:**
```
Read docs/backend-design/HANDOFF.md to see which legacy functions
were replaced with window.v2.* helpers during Phases 3–4. Then grep the
teacher/ and teacher-mobile/ directories for any remaining call sites of
saveScores, saveRubrics, saveLearningMap, save_*, _canonical*, sb.from,
sb.rpc (other than window.v2 dispatch, shared/supabase.js, and
shared/offline-queue.js). Report each hit with file:line and say
whether it's dead code, fallback path, or an unmigrated UI action. Do
not make changes yet — first produce the audit, then propose a minimal
follow-up patch. Verify in Demo Mode after any changes.
```

**Likely files:** `teacher/**/*.js`, `teacher-mobile/**/*.js`, `shared/data.js`

**Depends on:** nothing

**Acceptance:** Audit report committed to `HANDOFF.md`; any unmigrated UI actions identified with a plan. If the audit finds dead code only, note that and move on.

**Budget:** ~30 min

---

## Tier 2 — Trivial UI edits (single-file, minutes each)

Can run in any order, in parallel. Each lands as its own commit.

### T-UI-01 · Hide term-rating auto-generate button

**Goal:** The existing "auto-generate narrative" button in the term-rating editor is hidden in v1. Do NOT wire to a "coming soon" modal — just hide.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U17 and §12.5, hide the term-rating
auto-generate button in v1. The feature is deferred to a separate repo.
Find the button in the term-rating editor (likely under
teacher/reports* or teacher/page-reports.js), add a visibility check
or simply remove it from the rendered output. Do not wire it to a
"coming soon" modal. Do not delete backend code — just hide the UI
entry point. Verify in Demo Mode: open a term rating, confirm no
auto-generate button is visible. Commit as "Hide term-rating
auto-generate button (deferred to external workstream)".
```

**Likely files:** `teacher/reports.css` or `teacher/page-reports.js`; possibly `teacher-mobile/`

**Depends on:** nothing

**Acceptance:** Auto-generate button no longer visible in term-rating editor. Demo Mode verified.

**Budget:** 10–15 min

---

### T-COPY-01 · Delete-account dialog 30-day grace copy

**Goal:** Update the existing delete-account confirmation dialog with the exact soft-delete copy from INSTRUCTIONS.md §12.4.

**Prompt:**
```
Per INSTRUCTIONS.md §12.4, the delete-account confirmation dialog
must show this exact copy:

  "Deleting your account hides all your data immediately and
  permanently removes it after 30 days. You can cancel the deletion
  by signing in again within 30 days."

Find the existing delete-account confirmation dialog (likely in
teacher/ somewhere — search for "Delete account" / "deleteAccount").
Replace the current copy with the above. The dialog continues to
require password re-entry (already wired) and the existing backend
already soft-deletes via v2.softDeleteTeacher (HANDOFF Phase 4.8).
Do not change the backend call. Do not add new buttons. Just update
the text. Verify in Demo Mode by opening the delete-account dialog
and reading the copy. Commit.
```

**Likely files:** `teacher/page-settings.*` or wherever the dialog lives; `teacher-mobile/` equivalent if separate

**Depends on:** nothing

**Acceptance:** Copy matches §12.4 exactly. Both desktop and mobile variants updated if they differ.

**Budget:** 15 min

---

### T-COPY-02 · Welcome Class banner + auto-seed on first sign-in

**Goal:** When a newly-verified teacher lands for the first time, the Welcome Class is auto-seeded (HANDOFF 5.1 shipped `shared/demo-seed.js`) and a banner renders per INSTRUCTIONS.md §12.3.

**Prompt:**
```
Per INSTRUCTIONS.md §12.3, the Welcome Class banner must render with:

  "Welcome! This is a sample class. Explore the features, then delete
  it anytime from Course Settings."

Two pieces of work:

1. Verify that first-verified-sign-in auto-seeds the Welcome Class via
   shared/demo-seed.js (HANDOFF 5.1). If the auto-seed isn't wired to
   the bootstrap path yet, add the call. It should fire ONCE on the
   teacher's first sign-in when Teacher and TeacherPreference rows are
   fresh-created (see auth-lifecycle.md §1.3).

2. Render a banner inside the gradebook view when the active course is
   the auto-seeded Welcome Class. Use existing --focus-banner-bg and
   --focus-banner-border tokens (see DESIGN-SYSTEM.md §1.7). Include a
   dismiss (×) button; persist the dismissed state in TeacherPreference
   or localStorage. The banner should only show if the Welcome Class is
   currently active AND the teacher hasn't dismissed it.

Verify in Demo Mode: create a new teacher account, verify email, sign
in, land on the gradebook, see the banner. Dismiss; reload; banner
stays dismissed.
```

**Likely files:** auth bootstrap (likely `login-auth.js` or `shared/supabase.js`), gradebook view

**Depends on:** T-WIRE-01 (if audit reveals bootstrap path changes)

**Acceptance:** New teacher → signs in for first time → lands in gradebook with Welcome Class banner using `--focus-banner-bg`. Dismiss persists.

**Budget:** 45 min

---

## Tier 3 — Small controls (30 min–1 hour each)

Each lands as its own commit. Can run in parallel after T-WIRE-01.

### T-UI-02 · `grading_system` segmented control in Course Settings

**Goal:** Add the 3-way segmented control (proficiency / letter / both) in the course-policy panel. Disabled state when no Categories.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U2, §12.9, and spec-vs-ui-diff.md Bucket 3:
add a segmented control in Course Settings for grading_system. Three
segments: Proficiency, Letter, Both. Reuse the existing
.gb-seg-control pattern (see teacher/gradebook.css:41–54 and
DESIGN-SYSTEM.md §4.6).

Behavior:
- Default by grade level: 8–9 → proficiency, 10–12 → letter.
- If the course has zero Categories, the Letter and Both segments
  render disabled (existing .gb-seg-btn disabled state) with an inline
  tooltip "Create a category first →" linking to the (yet-to-exist)
  Category management row. For now, the tooltip can link to the
  categories area of course settings even if the UI isn't wired yet
  (T-UI-12 will land that).
- Click updates course.gradingSystem via the existing update_course
  RPC (HANDOFF 1.2 or similar).
- Reload gradebook/dashboard after change so the display flips.

Visual: use --active / --text colors per DESIGN-SYSTEM.md §1.1–1.2.

Remove the legacy "Report as percentage" toggle if it still exists in
the policy UI (per INSTRUCTIONS.md §2.2 U16 direction and Q26).
Remove the grading-scale editing controls (U14).

Verify in Demo Mode: open Course Settings, toggle between modes, see
the gradebook switch between proficiency and letter displays.
```

**Likely files:** `teacher/page-settings.*` (course policy section), CSS, `shared/data.js` (if a new v2 helper is needed)

**Depends on:** T-WIRE-01

**Acceptance:** Segmented control renders; switching modes persists; letter/both disabled when no categories; legacy toggles removed.

**Budget:** 45–60 min

---

### T-UI-03 · Course `timezone` picker in Course Settings

**Goal:** Add an IANA timezone picker in Course Settings.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U9 and erd.md (Pass D amendment folded in):
Course.timezone is a new text column holding an IANA tz string
(e.g., 'America/Vancouver'). Default on course create = the
teacher's browser timezone (Intl.DateTimeFormat().resolvedOptions().timeZone).

Add a dropdown to Course Settings. Options = the common Canadian tz
list plus "Other..." (which accepts any IANA string). Use a standard
<select> styled like other form inputs (see DESIGN-SYSTEM.md §4.2).

All date rendering in the course (due dates, score timestamps,
attendance) should respect this tz going forward. For v1, just
persist it — per-page rendering changes can land incrementally.

Saves via update_course RPC (existing jsonb patch path).

Verify in Demo Mode: open Course Settings, change tz, confirm it
persists after reload.
```

**Likely files:** `teacher/page-settings.*`, `shared/data.js`

**Depends on:** T-WIRE-01

**Acceptance:** Timezone dropdown renders, persists, reloads correctly.

**Budget:** 30 min

---

### T-UI-04 · Restore-account prompt on sign-in

**Goal:** When a teacher with `deleted_at IS NOT NULL` signs in during the 30-day grace window, show a prompt to restore the account.

**Prompt:**
```
Per INSTRUCTIONS.md §12.5 and auth-lifecycle.md §5: during the
30-day soft-delete grace window, if a teacher signs in while their
Teacher row has deleted_at IS NOT NULL, show this modal:

  "Your account is scheduled for deletion on [date]. Restore it now?"

Buttons:
- Restore (primary) — calls v2.restoreTeacher (HANDOFF 4.8 confirms
  it exists) which flips deleted_at back to NULL.
- Continue deletion (secondary) — signs the user out without
  restoring.

[date] = deleted_at + 30 days, formatted per the course's tz (or
just en-CA if outside any course context).

Detection point: after auth succeeds and before redirecting to the
gradebook, fetch the teacher row; if deleted_at is set, show the
modal instead of redirecting. Use the existing .modal-box pattern
(DESIGN-SYSTEM.md §4.4).

Verify in Demo Mode: soft-delete the demo teacher, sign in again,
see the modal. Click Restore, sign in again, no modal.
```

**Likely files:** `login-auth.js`, `shared/data.js`, `shared/supabase.js`

**Depends on:** T-WIRE-01

**Acceptance:** Soft-deleted account → sign-in shows modal with correct date and buttons. Restore works.

**Budget:** 1 hour

---

### T-UI-05 · Data export menu entry

**Goal:** Add "Export my data" to the user-menu dropdown + secondary button in delete-account dialog.

**Prompt:**
```
Per INSTRUCTIONS.md §12.9: add a "Export my data" entry to the
user-menu dropdown (top-right of the app dock). Clicking it calls
a new v2.exportMyData RPC (or triggers a client-side download if
backend export isn't yet available — check HANDOFF.md first).

Output: single JSON file covering every teacher-owned entity
(Teacher, TeacherPreference, Courses, Categories, Subjects,
Sections, Tags, Modules, Rubrics, Criteria, Students, Enrollments,
Assessments, Scores, RubricScores, TagScores, Observations + join
tables, CustomTags, ObservationTemplates teacher-added only, Notes,
Goals, Reflections, SectionOverrides, Attendance, TermRatings + join
tables, ReportConfig).

Also add the same Export button inside the delete-account
confirmation dialog (from T-COPY-01). Place above the password
re-entry input with a note: "Download a copy of your data before
deleting."

If the v2.exportMyData RPC doesn't exist yet, create a new task
(T-BE-01) for the backend side and wire the button to a disabled
state with a tooltip in the meantime.

Verify in Demo Mode: click Export → downloads a JSON. Inspect to
confirm it contains expected data.
```

**Likely files:** `teacher/page-settings.*`, existing user-menu dropdown component, `shared/data.js`

**Depends on:** T-WIRE-01. Spawns T-BE-01 if backend RPC missing.

**Acceptance:** Menu entry downloads JSON. Same button in delete dialog works.

**Budget:** 1 hour (more if backend RPC needs building)

---

### T-UI-06 · "N unsynced" badge on user avatar

**Goal:** A badge on the user avatar showing the count of writes in the offline queue.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U5 and §12.9: render an "N unsynced" badge
on the user-avatar element in the top dock. Count comes from
window.v2Queue.stats() (see offline-sync.md and
shared/offline-queue.js already shipped per HANDOFF 4.10).

Visual: reuse the existing .obs-badge pattern (teacher/observations.css:76–82)
but colored with --late (#FF9500) instead of --active. Position
absolute, top-right corner of the avatar element.

Badge is hidden when count is 0. Updates when the queue changes —
shared/offline-queue.js exposes event hooks (check its API).

This badge is the click target for the sync status popover (T-UI-08).
Ensure its click handler is reserved for that task (no-op for now
except possibly console.log, or gate behind a flag).

Verify in Demo Mode: disconnect network (DevTools offline mode),
enter a score, see the badge appear with "1". Reconnect, see it
disappear once the queue drains.
```

**Likely files:** `teacher/styles.css` or new shared/offline-badge.js, dock HTML

**Depends on:** T-WIRE-01, `shared/offline-queue.js` (already shipped)

**Acceptance:** Badge appears when queue has entries, disappears when empty. Correct color.

**Budget:** 45 min

---

### T-UI-07 · Offline banner strip

**Goal:** A thin amber banner at the top when `navigator.onLine === false`.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U7 and §12.9: render a thin strip at the
top of the viewport when navigator.onLine === false. Listen to
'online' and 'offline' window events.

Copy: "You're offline. Changes will sync when connection returns."

Visual: full-width strip, height ~28px, background var(--late) at
low opacity (rgba(255,149,0,0.12)), text var(--late) darkened or
--text-2, 12px font. Pushes content down (not an overlay). Appears
above the app dock.

Reuses no existing class exactly — add a new .offline-banner rule in
teacher/styles.css. Dark mode variant too.

Verify in Demo Mode: DevTools offline toggle → banner appears.
Re-enable → banner disappears.
```

**Likely files:** `teacher/styles.css`, top-level HTML (likely `teacher/app.html`), possibly `teacher-mobile/`

**Depends on:** T-WIRE-01

**Acceptance:** Banner correctly appears/disappears with connection state. Doesn't overlap other content.

**Budget:** 30 min

---

## Tier 4 — Medium controls (1–2 hours each)

### T-UI-08 · Sync status popover (anchored to badge)

**Goal:** Clicking the unsynced-count badge opens a popover showing queue detail.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U6 and §12.9: clicking the offline badge
(T-UI-06) opens a small popover anchored to the badge. Popover shows:

- Queue size (N pending)
- Last sync timestamp (formatted relative: "2 minutes ago")
- Dead-letter list: one row per failed entry, each with a "Dismiss"
  button and a short description of what failed ("Score for Kate on
  Essay 1 — Assessment not found")

Actions:
- Dismiss per-entry calls window.v2Queue.dismissDeadLetter(id).
- Clicking outside the popover closes it.
- Retry button at top runs window.v2Queue.flush() and updates the
  list.

Visual: reuses the existing popover styling. Width ~320px, padding
var(--space-4), background var(--surface), border var(--border),
radius var(--radius), shadow var(--shadow-md). Positioned
bottom-right of the badge.

Verify in Demo Mode: with offline queue populated (force some
failures by editing payloads), open popover, dismiss entries,
retry flush.
```

**Likely files:** new module `shared/sync-status-popover.js`, CSS additions

**Depends on:** T-UI-06

**Acceptance:** Popover opens/closes, shows queue state, dismiss and retry work.

**Budget:** 1.5 hours

---

### T-UI-09 · Rubric per-criterion weight input

**Goal:** A numeric input per criterion in the rubric editor, storing `criterion.weight`.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U3, §12.9, and erd.md (Pass D amendment folded in):
Criterion now has a `weight numeric` column (default 1.0). The rubric
editor must let teachers set it per criterion.

Placement: inline in the criterion row header, next to the criterion
name. Small number input labeled "Weight". Allow any positive
number — values are normalized across the rubric at read time per
Pass D §1.1.

The existing rubric save path (check HANDOFF for the v2 RPC, likely
window.v2.saveRubric or save_rubric) should already accept the
criterion.weight field in the criteria array. If not, check
write-paths.sql and fix the RPC.

Visual: small input, ~60px wide, style matches existing rubric form
inputs. Use --text-sm for the label.

Verify in Demo Mode: open a rubric, set weights 1/1/2 on three
criteria, save, reopen — confirm values persist.
```

**Likely files:** `teacher/page-rubrics.*` or equivalent, `shared/data.js`

**Depends on:** T-WIRE-01; ERD migration adding `Criterion.weight` (confirm applied)

**Acceptance:** Weight input renders per criterion, persists, roundtrips correctly.

**Budget:** 1 hour

---

### T-UI-10 · Rubric per-level value inputs (disclosure)

**Goal:** Four numeric inputs per criterion for `level_N_value`, hidden under a disclosure that defaults closed.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U4 and erd.md (Pass D amendment folded in):
Criterion now has level_1_value through level_4_value numeric columns
(defaults 1/2/3/4). Teachers can override per criterion (Teams/Schoology-style
flexibility).

In the rubric editor, add a per-criterion disclosure toggle labeled
"Customize point values" that defaults CLOSED. When opened, reveals
four small inputs under each level descriptor, pre-filled with the
defaults.

Do NOT show these by default — 95% of teachers never need them.

Saves via the existing rubric save path along with the other criterion
fields.

Visual: use <details><summary> or a custom disclosure using existing
styles. Small inputs (40–50px wide) with labels like "L4", "L3", etc.

Verify in Demo Mode: open a rubric, open the disclosure on a
criterion, set custom values (e.g., 5/3/2/1), save, reopen, confirm
values persist and defaults are only used where not overridden.
```

**Likely files:** same as T-UI-09

**Depends on:** T-WIRE-01, T-UI-09 (easier to land together); migration adding level_N_value columns

**Acceptance:** Disclosure closed by default. Opens to reveal 4 inputs. Values persist.

**Budget:** 1 hour

---

### T-UI-11 · Session-expired modal with draft preservation

**Goal:** On 401 in the term-rating narrative or observation capture, show a modal that preserves the form state.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U8, auth-lifecycle.md §8.1, and
DESIGN-SYSTEM.md §4.4: when an API call returns 401 on the
term-rating narrative editor or the observation capture surface,
show a modal that:

1. Does NOT unmount or clear the form.
2. Uses the existing .modal-box pattern with a semi-transparent
   overlay (the form stays visible beneath).
3. Pre-fills the teacher's email from the expired token claim.
4. Accepts a password re-entry.
5. On successful re-auth, retries the failed write and closes.
6. On dismiss, leaves the draft visible and shows a "Copy your draft
   before it's lost" button (copies form contents to clipboard).

Other surfaces (gradebook, settings, etc.) keep the existing
toast+redirect pattern — do NOT apply this modal to them.

Detection: add a guard in the v2 RPC dispatch layer that checks the
response status. If 401 AND we're on one of the two long-form
surfaces (check via a window flag like window.__longFormActive set
when those editors are mounted), trigger the modal.

Verify in Demo Mode: force a 401 (temporarily expire a token via
Supabase dashboard or just override fetch), with the term-rating
narrative open and half-written, trigger the expiry, see modal,
re-auth, confirm draft still there and save succeeds.
```

**Likely files:** `shared/data.js` (401 detection), new `shared/session-expired-modal.js`, CSS additions; surfaces that flip the flag

**Depends on:** T-WIRE-01

**Acceptance:** Modal appears only on the two long-form surfaces. Draft survives. Re-auth retries the failed write.

**Budget:** 2 hours

---

## Tier 5 — Largest single UI task

### T-UI-12 · Category management inline row in Course Settings

**Goal:** The Category CRUD inline row in Course Settings. Clones the existing Modules-panel pattern.

**Prompt:**
```
Per INSTRUCTIONS.md §2.1 U1, §12.7, §12.9, and spec-vs-ui-diff.md
Bucket 3: add Category management as an inline row in Course Settings.
Clone the existing Modules panel pattern — same structural shape
(add-row + name input + drag handle + delete).

Fields per row:
- Name (text input)
- Weight % (number input)
- Drag handle (for reorder)
- Delete (X button)

Running sum display at the bottom of the Category list:
"Sum: 85 / 100 %"
Colored var(--text-2) when ≤100, var(--priority) when >100.

Save button disabled while sum > 100. Per §12.7: live warn, NO
hard-clamp on keystroke.

"+ Add category" button below the list. Drag reorder updates
display_order.

Backend: wire to v2.createCategory / v2.updateCategory / v2.deleteCategory /
v2.reorderCategories (check HANDOFF for exact names; add to
shared/data.js if not there yet — spawns T-BE-02 if backend
RPCs missing).

Placement in Course Settings: below the grading_system toggle
(T-UI-02), above any other category-related controls. When category
count > 0, the grading_system letter/both segments enable.

Connects to T-UI-02: once a category exists, the letter/both
segmented-control tooltip disappears.

Verify in Demo Mode: open Course Settings, add 3 categories (Tests
40, Essays 50, Participation 10), reorder, delete, confirm weights
sum warning appears when > 100. Confirm assessments' category
dropdown now shows the new categories.
```

**Likely files:** `teacher/page-settings.*`, `shared/data.js`, migration SQL if RPCs missing

**Depends on:** T-WIRE-01, T-UI-02 (the segmented control needs to know about category count), ERD migration for Category table (confirm applied)

**Acceptance:** Add/edit/reorder/delete categories works. Sum warning shows. Save disabled at > 100. Letter/both segments enable when categories exist. Assessments' category dropdown populated.

**Budget:** 3 hours

---

## Tier 6 — Operational (infrastructure, pre-cutover)

### T-OPS-01 · Custom SMTP for `noreply@fullvision.ca`

**Goal:** Emails from Supabase Auth (verification, password reset) come from the custom domain.

**Prompt:**
```
Per INSTRUCTIONS.md §1 and DECISIONS.md Q6=B: configure Supabase Auth
to send email via custom domain noreply@fullvision.ca.

Steps:
1. In the fullvision-v2 Supabase project dashboard, navigate to
   Authentication → Email Templates → SMTP Settings.
2. Configure SMTP credentials (Resend / Postmark / SendGrid or
   Supabase's built-in custom SMTP — confirm which the user has
   chosen, DECISIONS Q6 was B without a specific provider).
3. Add DNS records to fullvision.ca via the DNS provider:
   - SPF record (TXT)
   - DKIM record (TXT, provider-specific)
   - DMARC record (TXT, policy=quarantine or reject)
4. Test by triggering a password reset on a test account. Verify
   the email arrives from noreply@fullvision.ca with no spam flag.

Document the DNS records added in HANDOFF.md. Do NOT commit SMTP
credentials to the repo.
```

**Likely files:** Supabase dashboard, DNS provider, `HANDOFF.md` (document results)

**Depends on:** the user has `fullvision.ca` DNS access (per DECISIONS Q7 note)

**Acceptance:** Verification and password-reset emails arrive from `noreply@fullvision.ca`. Not in spam.

**Budget:** 45 min (+ DNS propagation wait)

---

### T-OPS-02 · Sentry project + DSN wiring

**Goal:** Runtime errors captured in Sentry.

**Prompt:**
```
Per INSTRUCTIONS.md §8.2 and DECISIONS.md Q34=A: wire Sentry for
runtime error capture.

1. Create a Sentry project (JavaScript platform).
2. Add the DSN to Netlify production env vars (not committed).
3. Add a minimal Sentry init in the client entry points
   (shared/*.js or teacher/app.html and teacher-mobile/index.html).
   Use the browser SDK, no React integration needed. Enable
   automatic error + unhandled-promise-rejection capture.
4. Test by throwing an error in one component; verify Sentry
   captures it.
5. Configure Sentry to scrub obviously PII fields
   (student names, scores — check the default scrubbing + add
   custom rules).

Do not commit the DSN. Document the env var name in INSTRUCTIONS.md
§1 "Env vars."
```

**Likely files:** `shared/sentry.js` (new), `teacher/app.html`, `teacher-mobile/index.html`, Netlify env config

**Depends on:** nothing

**Acceptance:** Errors in production show up in Sentry dashboard.

**Budget:** 45 min

---

### T-OPS-03 · Park old site at `legacy.fullvision.ca`

**Goal:** Current Netlify deploy is reachable at a legacy subdomain; primary domain is reserved for the new build.

**Prompt:**
```
Per INSTRUCTIONS.md §1 operational decisions: move the current
(legacy) Netlify deploy off the primary fullvision.ca domain.

Steps:
1. In Netlify, create a new site or take the current deploy and
   change its primary domain to legacy.fullvision.ca.
2. Add the DNS CNAME at fullvision.ca for legacy → the Netlify
   site's URL.
3. Leave fullvision.ca pointing nowhere (or at a "Coming soon"
   placeholder) until T-OPS-04 cutover.
4. Verify legacy.fullvision.ca loads the old site; the legacy-v1
   git tag remains accessible.

No code changes in the repo. This is a Netlify + DNS task.
```

**Depends on:** `fullvision.ca` DNS access

**Acceptance:** `legacy.fullvision.ca` serves the old app. `fullvision.ca` is parked.

**Budget:** 30 min

---

### T-OPS-04 · Cutover: `rebuild-v2` → new `main`

**Goal:** The rebuild becomes production.

**Prompt:**
```
Per INSTRUCTIONS.md §11.15: cutover from legacy to v2.

Pre-flight checklist (all must be green):
- [ ] PR #76 reviewed and ready to merge
- [ ] T-WIRE-01 audit clean
- [ ] All Tier 2–5 UI tasks done and Demo-Mode verified
- [ ] T-OPS-01 SMTP working (test password reset end-to-end)
- [ ] T-OPS-02 Sentry capturing errors
- [ ] T-OPS-03 legacy.fullvision.ca serving old site
- [ ] fullvision-v2 Supabase project has latest migrations
- [ ] Supabase Pro backups + PITR active
- [ ] Weekly JSON export cron scheduled (per DECISIONS Q35)

Cutover steps:
1. Merge PR #76 → rebuild-v2 becomes stable.
2. Update main: `git checkout main && git reset --hard rebuild-v2`
   (force-push OK on main ONLY with explicit user authorization;
   confirm first). Alternatively: keep main pointing at
   docs-cleanup-redundant-stale, and have the Netlify prod site
   build from rebuild-v2 directly by switching the production
   branch in Netlify settings — no force-push required.
3. Update Netlify prod site:
   - Production branch → rebuild-v2 (or new main)
   - Env vars → fullvision-v2 Supabase URL + anon key
4. DNS flip: fullvision.ca → Netlify prod deploy.
5. Smoke test production: sign up → verify → sign in → gradebook →
   enter a score → Demo Mode "Try Demo" → report preview.
6. Update HANDOFF.md with cutover timestamp and any issues seen.

Rollback plan: if issues in first hour, DNS back to parked state
(fullvision.ca → placeholder); investigate; re-cutover later.
```

**Depends on:** every Tier 2–5 task above plus OPS-01/02/03

**Acceptance:** fullvision.ca serves new app with backend at fullvision-v2 Supabase. Smoke test passes.

**Budget:** 1 hour + rollback buffer

---

## Parallel vs. serial execution

**Can run in parallel (no dependencies between them):**
- T-UI-01 (hide button) · T-COPY-01 (dialog copy) · T-COPY-02 (welcome class)
- T-UI-02 · T-UI-03 · T-UI-04 · T-UI-05 · T-UI-06 · T-UI-07 — all after T-WIRE-01
- T-OPS-01 · T-OPS-02 · T-OPS-03 — infrastructure, can run any time

**Must be serial:**
- T-UI-08 (sync popover) waits on T-UI-06 (badge exists first)
- T-UI-09 and T-UI-10 easier together (same rubric editor file)
- T-UI-12 (Category row) waits on T-UI-02 (segmented control exists, needs updating when categories populate)
- T-OPS-04 cutover waits on everything else

**Recommended session ordering for one-Claude-Code-session-at-a-time:**

1. T-WIRE-01 (audit)
2. T-UI-01, T-COPY-01 (two quick wins)
3. T-UI-02 (grading_system toggle — biggest behavioral unlock)
4. T-UI-12 (Category row — so the toggle's disabled state goes away)
5. T-UI-09 + T-UI-10 (rubric weights + levels together)
6. T-UI-11 (session-expired modal)
7. T-UI-06 then T-UI-08 (badge + popover)
8. T-UI-07 (offline banner)
9. T-UI-03, T-UI-04, T-UI-05 (timezone, restore prompt, export)
10. T-COPY-02 (welcome class banner + auto-seed)
11. T-OPS-01, 02, 03 (infra — any order)
12. T-OPS-04 (cutover)

---

## Per-session procedure (for every task)

1. Open the task block. Read the prompt.
2. Read the three canonical docs listed at the top of this file.
3. If dependencies aren't done, skip to another task or surface the block.
4. Implement. Commit with clear message. No AI refs in commit messages (per user's memory).
5. Verify in Demo Mode (load the app, exercise the new UI path).
6. Append a line to HANDOFF.md's session log: date · session-id · task-id · commit hash · one-line summary · Demo Mode status.
7. Mark the task block **[DONE]** here with the commit hash.
8. If the task uncovered a new backend RPC need, add a T-BE-NN task block for it.

---

## Future tasks (spawn as needed)

- **T-BE-01** · Backend `export_my_data` RPC (if T-UI-05 audit finds it missing)
- **T-BE-02** · Category CRUD RPCs if missing (create/update/delete/reorder Category)
- **T-BE-03** · `restore_teacher` RPC confirmation (check HANDOFF 4.8 — spec says `v2.restoreTeacher` exists)
- **T-TEST-01** · E2E Playwright flow: sign-up → verify → welcome class → score entry → report → sign-out
- **T-TEST-02** · E2E: soft-delete account → sign-in within 30d → restore
- **T-TEST-03** · E2E: offline queue fills → reconnect → queue drains
- **T-OPS-05** · Weekly JSON export cron
- **T-OPS-06** · Demo Mode smoke test on live fullvision.ca post-cutover
