# FullVision observations: build plan

Written 2026-10-18 from the review at `~/fullvision-observations-ux-review.md` (mockups at https://claude.ai/artifact/8wZ1hmbs2TmB1aHTPj7ppX) and Colin's choices the same day. Planned on Fable 5.1; each PR is executed in its own Opus 5.5 session. One PR per change (CLAUDE.md rule 8). Mockup letters refer to the review.

## Decisions (2026-10-18)

1. **Tags are stored as `observation.dims text[]`**, the same string keys the client already uses (`engagement`, `cc:3`, `tag:Lab safety`). Not the join tables: `observation_tag` points at the learning map and `custom_tag` is the teacher's tag library. Done in PR #217 (open, migration not yet applied).
2. **The feed's default is a card list** with a coloured type rail, the date on each card and text pills. The sticky-note grid stays as a view toggle.
3. **Capture is roster-first, with one chip strip on every surface** (Observations page, Assignments comment popover, student page, gradebook cell, phone sheet). Inline shorthand (`@name`, `#tag`, `!type`, `/starter`). Sentence starters are a per-class bank in `observation_template`, editable, and replace the phone's six fixed lines. The phone gets a class-sweep screen (Mockup B).
4. **The dashboard's Observations widget becomes "N students have no observation in 3+ weeks" with their names, plus the students-by-week coverage grid** (Mockup E). The three numbers go.
5. **An observation can link to a learning-map competency** (`observation_tag`) **with an optional level** ("looks Proficient"). The level is evidence only and never enters a grade. The competency card gets an evidence drawer listing scores and observations on one dated list (Mockup G).
6. **The student page gets one Evidence panel** (tabs All / By competency / Assessments / Concerns) with the shared capture strip and the timeline strip above it (Mockups D and H). It replaces "Assignment Feedback" and "Notes & Observations".
7. **Text pills replace emoji** for type, context and tags on desktop and phone. **Enter sends, Shift+Enter adds a line. Delete shows an Undo toast** instead of a two-click confirm. **Cards show "Quoted in Report N"** from `term_rating_observation`, with an "unreported" filter. **A concern observation offers to flag the student.**
8. **No dictation and no photo attachments this round.**
9. Not decided: whether a multi-student capture becomes one server row. The client keeps fanning out to one row per student until it is.

These go into `docs/DECISIONS.md` as an "Observations (2026-10-18)" section in PR 2.

## PRs, in order

Each brief lists the files, what done looks like, and the tests. Every PR: branch from `main`, `npm test`, `npm run format:check`, Playwright where the UI changed, Demo Mode still works, commit message ends with the attribution line the session gives you, PR description ends with the Claude Code line. Grade math is untouched by every PR here.

### PR 1 — Tags and assessment titles survive a reload (#217, open)

Branch `fix/observation-tags-roundtrip`. `migrations/20261018_observation_dims.sql`, `shared/data.js`, tests. Colin reviews, then applies the migration before merging (deploy order is in the migration header). Nothing else to do unless review asks.

### PR 2 — Feed restyle, keyboard, undo, quoted mark

Files: `teacher/page-observations.js`, `teacher/observations.css`, `teacher/student-notes.js`, `teacher/student.css` (pill styles only), `teacher-mobile/tab-observe.js`, `teacher-mobile/student-detail.js`, `teacher-mobile/card-widgets.js`, `teacher-mobile/styles.css`, `shared/constants.js` (keep `OBS_ICONS` for now; stop rendering it), `docs/DECISIONS.md`.

- Default feed is a card list: one column, coloured left rail by type (`--score-3` green strength, blue growth, `--score-2` amber concern), student name, "with …" when the same text was captured for several students at the same minute, date and time on every card, context as a text pill, tag pills with the existing colour dot, assessment pill when linked. A "Sticky notes" toggle in the toolbar restores the current grid; the choice is remembered per device.
- Text pills, no emoji, everywhere observations render (desktop feed, focus card, student page notes, phone feed, phone sheet, card widgets, questionnaire panel).
- Enter sends from the capture box; Shift+Enter inserts a newline; Cmd+Enter still works.
- Delete: one click removes the card and shows a 6-second "Observation deleted · Undo" toast; Undo restores it (re-add through `addQuickOb` with the same id is not possible, so hold the deletion client-side until the toast expires, then call `deleteQuickOb`). Same on the phone.
- Filter strip becomes one row of chips: Student, Tag, Type, Context, Date (this week / this term / custom), Assessment (linked / not linked), Quoted (quoted / not yet quoted). Search also matches tag labels.
- "Quoted in Report N" mark on a card whose id appears in any term rating's `mentionObs` for that student (`getTermRatings`). Report N is the term's ordinal from `course.reporting_terms`; "Quoted" alone when there is no term.
- Sentence case throughout; the count reads "117 observations".
- `docs/DECISIONS.md`: add the "Observations (2026-10-18)" section from this plan.

Done when: Demo Mode shows the card list by default, the toggle switches views, every emoji is gone from observation UI, Enter sends, delete undoes, the quoted mark shows on a demo student who has a term rating with `mentionObs`, and vitest + Playwright pass. Add a Playwright spec in `e2e/` for Enter-to-send and Undo.

### PR 3 — Dashboard coverage grid and overdue list

Files: `teacher/dash-overview.js`, `teacher/dashboard.css`, `teacher/page-dashboard.js` if the overview needs more data.

- Replace the "This week / Flagged / Students" widget with: a headline "N students have no observation in 3+ weeks" (amber when N > 0, grey "Everyone observed in the last 3 weeks" when 0) and their names as chips linking to each student page.
- Below it, a coverage grid: rows = students (roster order), columns = ISO weeks from the term start (or the last 8 weeks when the class has no terms), cell = count, tint by type mix (green when strengths dominate, blue growth, amber when concerns dominate, dashed outline when empty). Hover shows the week's observations; click opens the Observations page filtered to that student. Rows with no observation in 3+ weeks have their name in amber.
- Keep it to the active reporting term when one is set (the term picker on the dashboard already exists).

Done when: Demo Mode shows the grid with Science 8, the overdue list names the right students (verify against `getStudentQuickObs`), and it collapses to a horizontal scroll on a 400px viewport. Vitest for the "3+ weeks" and tint calculations as pure functions.

### PR 4 — Shared capture strip, competency link, optional level, flag offer

Depends on PR 1 (merged and applied) and PR 2. Files: new `teacher/obs-capture.js` + `teacher/obs-capture.css`, `teacher/page-observations.js`, `teacher/page-assignments.js` (comment popover), `teacher/student-notes.js`, `teacher/page-gradebook.js` (cell menu entry), `teacher-mobile/tab-observe.js`, `shared/data.js`, one migration, `schema.sql`, tests.

- Migration `20261019_observation_level.sql`: `observation.level smallint null check (level between 1 and 4)`; `create_observation` takes `p_level`; `update_observation` reads `level` from `p_patch`; `get_observations` and `get_class_bundle` return it. Client sends real learning-map tag ids in `p_tag_ids` (one competency per observation is enough) and keeps `cc:` keys in dims. Show Colin the SQL in the PR; do not apply.
- One component renders the strip: student chips (roster click = pick, shift-click = add), type chips (Strength / Growth / Concern, single), context chip (menu), tag chips with a searchable menu, "+ Assessment" chip (defaults to the assessment most recently scored in this class today, else a menu), "+ Competency" chip (learning-map tags, single) with an optional "Level ▾" once a competency is chosen, text box, Add. Shorthand in the text box: `@` names, `#` tags, `!strength|growth|concern`, `/` starters (starters arrive in PR 5; render the menu empty until then).
- Each host pre-fills what it knows and hides what it cannot change: Assignments popover pre-fills the assessment and student; student page pre-fills the student; gradebook cell menu pre-fills both; phone sheet gets the full tag menu including `cc:` and custom tags.
- After Add: students stay selected, text clears, tags clear unless the "Keep tags" toggle is on.
- When type is Concern and the student is not flagged, show "Flag Ethan · Not now" under the box after Add; "Flag" calls the existing flag setter.
- Draft text survives route changes within the app (store per course in session memory).

Done when: all five hosts use the component, an observation captured from the Assignments popover shows with type and tags on the Observations page, a competency-linked observation round-trips the server in `tests/data-observations-v2-dispatch.test.js`, and the phone sheet offers custom tags.

### PR 5 — Starters bank (planned in detail 2026-10-18)

State found on 2026-10-18: `observation_template` exists on gradebook-prod with RLS (`observation_template_via_course`) and two RPCs, `upsert_observation_template(p_id, p_course_id, p_body, p_default_sentiment, p_default_context_type, p_display_order, p_idempotency_key)` and `delete_observation_template(p_id)`. It has zero rows, no column for tags, and no read path: `get_class_bundle` does not return it and there is no list RPC. The client has `upsertObservationTemplate` / `deleteObservationTemplate` in `shared/data.js` and no UI. The capture strip (`teacher/obs-capture.js`, #220) already parses `/` tokens and shows "No sentence starters yet." The phone uses six hard-coded `QUICK_TEMPLATES` in `teacher-mobile/tab-observe.js`.

Decisions for this PR (open question 2 settled by assumption; Colin can reverse it in review):

- **Starters belong to a class**, as the table already does. Duplicate Class copies them (they are class setup, not year data). No cross-class library this round.
- **The editor lives in Class Management** as a "Sentence starters" section, and the `/` menu and the "+ Starter" chip end with "Edit starters…", which opens that section. The phone reads starters; it does not edit them.
- **A starter has** text, an optional default type, an optional default context, and tags (`dims` keys: dispositions, `cc:` keys, `tag:` custom). No competency or level on a starter.
- **A class with no starters** shows the six current phone lines as suggestions with one button, "Add these to this class". They are never written to the server unless the teacher presses it. Demo Mode's Science 8 class has them as real starters.

Migration `20261019_observation_template_dims.sql` (backward compatible; additive):

- `observation_template.default_dims text[] not null default '{}'`.
- `upsert_observation_template` gains `p_default_dims text[] default null` (null on update leaves the column alone; null on insert stores `{}`). Drop and recreate the current seven-argument signature, keep idempotency, the `is_seed` guard, revoke from public/anon and grant to authenticated.
- Every current `get_class_bundle` definition adds `observation_templates`: the class's rows ordered by `display_order, created_at` with `id, body, default_sentiment, default_context_type, default_dims, display_order`. `bundle_schema` stays 3. Copy the newest bundle definition (from `20261019_observation_level.sql`) so nothing it added regresses.
- If `duplicate_course` (or whatever Duplicate Class calls) copies tables server side, copy `observation_template` rows too; if Duplicate Class is client side, copy them there instead.
- Dry run inside `begin … rollback`, never against prod data.

Client:

- `shared/data.js`: `getObservationTemplates(cid)` from the bundle (cache + localStorage like other course fields, Demo Mode local), `upsertObservationTemplate` sends `p_default_dims`, local ids re-key to UUIDs (rule 6), the outbox carries writes offline, reorder writes `p_display_order`.
- `teacher/dash-class-manager.js`: "Sentence starters" section. A list of starters, each with its text, type, context and tag pills; Add, Edit inline, Delete (with the app's normal confirm), Move up / Move down. The empty state shows the six suggestions and "Add these to this class".
- `teacher/obs-capture.js`: the `/` menu lists the class's starters filtered by what follows the slash; a "+ Starter" chip opens the same menu. Picking one replaces the `/token` (or inserts at the caret) with the starter's text, sets type and context only if they are empty, and adds its tags. The menu ends with "Edit starters…".
- `teacher-mobile/tab-observe.js`: the avatar quick menu lists the class's starters instead of `QUICK_TEMPLATES`; tapping one saves at once with its type, context and tags (today's behaviour). Empty class: the six suggestions are shown and work as today, with a line "Add your own in Class Management on a computer."
- Sentence case, no emoji, app tokens, phone width.

Tests: vitest for the template data functions (create, update, reorder, delete, hydrate from bundle, offline outbox), for the `/` menu filtering and the apply rules (type/context only when empty; tags merged); the phone quick menu reading the bank. A Playwright spec: add a starter in Class Management, use it with `/` on the Observations page, see text, type and tags on the saved card.

Database: this session dry-runs the migration and puts the SQL in the PR. It does not apply it to gradebook-prod; Colin is asked first (approval for PR 4's migration does not carry over). The PR is not merged until the migration is applied.

Done when: a starter added in Class Management appears in the `/` menu on desktop and in the phone quick menu after reload, picking one fills text, type and tags, Duplicate Class copies starters, Demo Mode works, and vitest + format + Playwright pass.

### PR 6 — Student page Evidence panel and timeline strip (planned in detail 2026-10-18)

State found on main at 8d01a22 (after #220, #222 and #221): the student page (`teacher/page-student.js`, insights grid around line 1011) still has two lists, "Assignment Feedback" (5 newest assessment-linked notes, line ~1177) and "Notes & Observations" (`teacher/student-notes.js`, which since #220 mounts the shared `ObsCapture` strip and renders its own `.note-inline` rows). Growth Profile shows a stat line ("5 observations · 5 strengths"). The Observations page's card markup (`renderObsCardHtml`, `typePillHtml`, `cardWhen`, quoted mark, assessment pill, `ObsCapture.linkPillsHtml`) is private to `teacher/page-observations.js`. Observations carry `competencyId` and `level` (#220). The active reporting term is `getActiveTerm(cid)` in `shared/calc.js` (`{ordinal, label, startsOn, endsOn}` or null for all time). The dashboard card (`teacher/dash-student-cards.js` ~line 78) still shows an emoji and a 45-character snippet. The phone student detail (`teacher-mobile/student-detail.js` line 363) takes `getStudentQuickObs(...).slice(-3).reverse()`, which is the three oldest, because that list is already newest-first: a bug.

No migration. Client only.

1. **Shared card renderer.** Move the card markup out of `page-observations.js` into `teacher/obs-card.js` (`ObsCard.html(ob, ctx)`, `ObsCard.context(cid)` for quoted/same-capture lookups) with its CSS moved to `teacher/obs-card.css` or kept in `observations.css` if that is already loaded on the student page. The Observations page uses it unchanged; a `showStudent: false` option hides the name on the student page. Load it in `teacher/app.html` before both pages and add it to `sw.js` precache like #220 did for obs-capture.
2. **One Evidence panel** replaces "Assignment Feedback" and "Notes & Observations" on the student page. Title "Evidence". Tabs with counts: All, By competency, Assessments, Concerns. The `ObsCapture` strip at the top, pre-filled with the student (as student-notes does now). The list uses `ObsCard` cards newest first with Undo-toast delete as on the Observations page. "By competency" groups by `competencyId` label (learning-map order), unlinked ones last under "Not linked to a competency". "Assessments" is assessment-linked notes. "Concerns" is sentiment concern. Keep the search box; it filters the active tab. Empty states in plain sentences.
3. **Timeline strip** above the panel, full width of the panel: one mark per observation across the active term (`getActiveTerm`) or, for all time, from the first observation to today. Circle coloured by type (strength / growth / concern tokens; neutral grey when untyped), square for assessment-linked. Month or week ticks depending on span. A labelled gap ("No evidence for 19 days") over any stretch of more than 14 days with nothing, including from the last observation to today. Hover/focus shows date and first line; click scrolls to and highlights the card in the list (switching to the All tab). Keyboard reachable; marks have aria-labels. Pure function for layout (positions, gaps) covered by vitest.
4. **Growth Profile stat line** becomes small type pills with counts (Strength 4 · Growth 1 · Concern 0) in sentence case, no emoji.
5. **Dashboard student card line** (`dash-student-cards.js`): replace the emoji snippet with the three most recent type dots, "last observed N days ago" (or "No observations yet"), and the count this term (or all time when no term is active). Amber text when N ≥ 21, matching #218's overdue rule; reuse #218's pure function for days-since if it exports one.
6. **Phone student detail**: fix the oldest-three bug (take the first three of the newest-first list) and use text pills for type and context, matching the phone feed after #219.
7. Sentence case, no emoji, app tokens, works at phone width (the panel stacks; the timeline scrolls horizontally inside its own container).
8. Tests: vitest for the timeline layout function (term span, all-time span, gap detection at 14 days, today gap), the tab filters, the dashboard days-since/amber rule, and the phone detail newest-three fix. Playwright: open a demo student (Mei Wong, st23), see the Evidence panel with tabs and counts, add an observation through the strip and see it in the list and on the timeline, delete with Undo. `npm test`, `npm run format:check`, Playwright pass; Demo Mode works.

Done when the demo student page shows one Evidence panel with working tabs and the timeline above it, the Observations page looks the same as before the extraction, the dashboard card line shows dots and days since, and the phone detail shows the three newest.

### PR 7 — Evidence drawer on the competency card (planned in detail 2026-10-18)

State found on main at 5f6d20d (after #223): each competency card on the student page (`teacher/page-student.js`, section cards grid around line 790) shows the section level badge, an override button, a growth sparkline, and one tag row for `sec.tags[0]` (level badge, label, bar, a count of scored assessments, a ▶ chevron). Clicking the row (`data-action="toggleTag"`) expands `.tag-detail`, a list of that tag's scores from `getTagScores(cid, sid, tagId)` (level pip, assessment title linking to Assignments, date), or "No evidence yet". Observations link to a competency through `ob.competencyId`, which is the same learning-map tag id (`ObsCapture.competencyItems` lists `sec.tags[*].id`), with an optional `ob.level` 1–4 that is evidence only. #212 put a page-level line "Competency levels: <method>" above the cards. The active term is `getActiveTerm(cid)`. `teacher/obs-card.js` (#223) renders observation cards and `teacher/obs-capture.js` the capture strip.

No migration. Client only. Grade math is untouched: nothing in this PR may change what `getSectionProficiency`, `getTagProficiency` or any calc.js function returns.

1. **The tag row's count** reads "3 scores · 2 observations" (singular/plural correct; "No evidence yet" when both are zero). The row is a real button with `aria-expanded`.
2. **The drawer** (the existing `.tag-detail`) becomes one dated list, newest first, of:
   - every score for that tag, as today (level pip, assessment title linking to Assignments, date), and
   - every observation whose `competencyId` is that tag id: date, type pill, the first line of text (full text on hover/focus), and "Looks Proficient" when `ob.level` is set. Clicking an observation scrolls to it in the Evidence panel (#223) and highlights it.
     When a term is active, both lists are limited to the term's dates, matching how the level badge is scoped.
3. **A one-line explanation at the top of the drawer** in plain words, from data the card already has: the calc method's name as the page line shows it, plus "Overridden to Extending: <reason>" when an override exists. No new calculation; if the method's own explanation helper exists from #212, reuse it, otherwise use the method label only.
4. **"Add observation"** at the bottom of the drawer opens the `ObsCapture` strip inline in the drawer, pre-filled with the student and this competency (level menu available). After Add, the drawer, the Evidence panel and the timeline refresh.
5. Keep each card's height stable when collapsed; the drawer scrolls inside itself past about ten rows.
6. Sentence case, no emoji, app tokens, phone width.
7. Tests: vitest for the merged-and-sorted evidence list (scores and observations, term filtering, count wording), and a test that asserts `getSectionProficiency` / `getTagProficiency` return the same values before and after adding a competency-linked observation with a level. Playwright: open demo student Mei Wong (st23), expand a competency, see scores, add an observation linked to that competency with a level, see it in the drawer and in the Evidence panel. `npm test`, `npm run format:check`, Playwright pass; Demo Mode works.

Done when a demo competency's drawer lists scores and linked observations together with an explanation line, adding from the drawer round-trips, and the level badges do not change.

### PR 8 — Phone class sweep (planned in detail 2026-10-18)

State found on main at 88c8733 (after #224): the phone Observe tab (`teacher-mobile/tab-observe.js`, `MObserve`) renders a feed with an avatar quick bar, filter pills and a + FAB. Tapping an avatar opens a half sheet (`presentQuickMenu`) listing `quickStarters(cid)`: the class's own starters from `getObservationTemplates` (#222) or the six `OBS_STARTER_SUGGESTIONS`, each `{key, text, sentiment, context, dims}`; tapping one calls `quickPost`, which saves through `addQuickOb`. Screens are pushed with `_pushScreen(html)` in `teacher-mobile/shell.js`, and clicks dispatch on `data-action` there. `MC.showToast(message, { onUndo, duration })` already supports an Undo button. `teacher/obs-capture.js` is loaded on the phone. Delete on the phone goes through `holdDelete` (#219).

No migration. Client only, phone only.

1. **Entry point.** A "Start a sweep" button under the Observations large title on the Observe tab (secondary style, full width). It pushes the sweep screen.
2. **Sweep screen.** Nav bar "Sweep" with a back control that ends the sweep. Under it: "6 of 27 observed today" and a toggle "Roster order / Longest since observed" (remembered per device). A grid of first names (3 columns; disambiguate duplicate first names with a last initial). A student is **done** when they have any observation dated today, from any surface, so the sweep composes with everything else and survives a reload. Done tiles are tinted green with a tick and stay tappable. A **Skip** marks a student skipped for today on this device (localStorage keyed by course and date) and shows them muted; skipped students are not counted as done.
3. **Capture panel.** Tapping a name opens an inline panel under the grid (not a modal), scrolled into view: the full name; three large type buttons Strength / Growth / Concern; the class's starters as a list, with the chosen type's starters first and a starter's own type preselecting the type button; "Write instead…" reveals a text box (Enter saves); the starter's tags shown as pills. Buttons: "Save and next" (primary, disabled until a starter is chosen or text is typed) and "Skip".
4. **Save and next** saves through `addQuickOb` with the chosen text, type, the starter's context and tags, gives haptic feedback, shows "Saved for <first name> · Undo" (Undo deletes that observation through the existing phone delete path, no confirm), marks the tile done, and opens the next student who is neither done nor skipped in the current order. When none are left: "Everyone has an observation today" with a "Done" button that pops back to the feed.
5. **Leaving and returning** the same day restores the order toggle and skipped set; done comes from the data. The feed refreshes when the sweep screen closes.
6. Works offline (saves queue as usual). Sentence case, no emoji, app tokens, 44px minimum touch targets, works from 320px wide.
7. Tests: vitest for the done/skipped/next-student logic (roster order and longest-since-observed order, duplicate first names, all done), for Save and next writing the right type/context/tags, and for Undo removing exactly that observation. Playwright on the mobile viewport in Demo Mode: start a sweep, save two students with starters, see the count rise and the second tile done, Undo the second, see it undone. `npm test`, `npm run format:check`, Playwright pass.

Done when a teacher can start a sweep on the phone, work down the class with one or two taps per student, see who is left, and undo a mistake, with nothing changed on the desktop app.

## Open questions for Colin (do not block PRs 2 and 3)

- Multi-student capture as one server row (decision 9).
- Where the Starters editor lives: Class Management (assumed) or a "Starters" button on the Observations page.
- Whether "Quoted in Report N" should also block re-selection in the questionnaire, or only mark it.
