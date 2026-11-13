# Handoff review plan: S19 (2026-11-12)

This is slice S19 of `docs/plans/student-page-build-plan.md`: the rest of cleanup card cp1. It plans the tidying of FullVision from a fresh map of `main` at `439efbf7` (Nov 12, 05:41 UTC), and it sets out the work queued for the night of Nov 11 to 12. Revised the same night after an independent review of the plan and the queue.

Sources: the Nov 2 cleanup plan ("FullVision: Professional, Organized, Fast"), card cp1, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/write-path-plan.md`, and nineteen map reports. Each claim that something is dead was checked by two separate reviewers who did not see each other's work ("the skeptics"). Only claims both passed are queued. The map's reports lived in a scratch folder for one night and are not kept; where this plan says "the map", it means them, and what matters from them is written here.

## How to read this

- Section 1 compares the Nov 2 numbers with today's.
- Section 2 gives the ground rules.
- Section 3 is the work, as slices in six tracks (A to F).
- Section 4 lists the files only one PR may change at a time.
- Section 5 lists what the skeptics refuted, so is NOT dead.
- Section 6 lists the decisions for Colin and what each one blocks.
- Section 7 gives the order of work.

Words used here:

- **Tidying PR:** a pull request that reshapes code and changes no behaviour. The existing tests pass untouched.
- **Feature PR:** a pull request that adds or changes behaviour. Tidying and feature PRs never mix.
- **Pin:** a test written before a reshape that records what the code does today.
- **Dead:** nothing in the app, the tests, the scripts or the docs reads it.
- **Test-only:** nothing in the app reads it, but a test does.
- **Export key:** a name on a module's public object, such as `UI.renderDock`. Removing the key leaves the function itself in place.
- **Wave:** a batch of PRs that run at the same time in separate worktrees. No two PRs in a wave share a file.
- **Rule 2:** `CLAUDE.md` rule 2. Grade math changes and anything that deletes data need Colin's review.

---

## 1. What changed since Nov 2

The app grew fast while the student page was built. Most numbers in the Nov 2 plan are now low.

| Measure                                       | Nov 2                | Nov 12                                                                                                                   | Source                      |
| --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Desktop scripts per page                      | 66                   | 86 (all render-blocking)                                                                                                 | `teacher/app.html`          |
| Desktop stylesheets per page                  | 12                   | 17                                                                                                                       | `teacher/app.html`          |
| Desktop download, gzipped                     | 1.14 MB              | about 1.78 MB                                                                                                            | gzip level 9 per file       |
| Phone page                                    | not given            | 41 scripts, 5 sheets, 635 KB gz                                                                                          | `teacher-mobile/index.html` |
| Student page                                  | not given            | 14 scripts, 4 sheets, 173 KB gz                                                                                          | `s/index.html`              |
| Service worker download on each deploy        | 6.9 MB               | 12.66 MB (138 files)                                                                                                     | `sw.js`                     |
| `shared/data.js` lines                        | 13,071               | 21,583                                                                                                                   | `wc -l`                     |
| `shared/data.js` globals                      | 669                  | 1,103 top-level names, plus 33 `window.X`, 79 `window.v2.X`, and 240 keys on `window.GB`                                 | acorn scan                  |
| `typeof X === 'function'` guards              | 432                  | 686 (841 counting `!==`)                                                                                                 | `rg` count                  |
| Biggest page files                            | 7,000 to 9,900 lines | `page-assignments.js` 16,405; `dash-class-manager.js` 12,918; `report-questionnaire.js` 8,994; `page-gradebook.js` 4,875 | `wc -l`                     |
| Whole-page redraws: Class Management          | about 112            | 107, plus 20 through two wrappers                                                                                        | acorn count                 |
| Whole-page redraws: Assignments               | about 60             | 89                                                                                                                       | acorn count                 |
| Whole-page redraws: Gradebook                 | about 31             | 34                                                                                                                       | acorn count                 |
| `_dev/`                                       | 231 files, 3.2 MB    | the same                                                                                                                 | `git ls-files`              |
| `curriculum_data.js`                          | about 1 MB           | 1.96 MB                                                                                                                  | file size                   |
| Functions never called or test-only           | about 25 and 25      | 159 candidates; 132 passed both skeptics, 88 of them outside the "needs Colin" group                                     | map                         |
| Dead CSS classes                              | about 290            | 415 classes and 2 ids in `teacher/*.css`, plus 19 groups in other sheets                                                 | map                         |
| Unused CSS custom properties                  | 15                   | 16 defined and never read; 7 read and never defined                                                                      | map                         |
| Server functions never called                 | 9                    | 11 with no caller in the repo (2 of those are called from outside it); none passed both skeptics                         | map                         |
| Tests                                         | not given            | 397 vitest files (8,973 passing), 245 browser spec files (1,457 tests), 16 live-account specs                            | map                         |
| ESLint, trial run                             | none                 | 186 warnings, 0 errors                                                                                                   | map                         |
| `tsc` on `calc.js`, `constants.js`, `html.js` | none                 | 18 errors, all fixable with comments only                                                                                | map                         |
| Phone score tap                               | not measured         | 395 ms (target 200 ms)                                                                                                   | trial speed run             |

Main moved after the map. Two merges landed at 06:40 UTC: #1184 (Handouts and Links: form, student page and edge route) and #1183 (its migration, applied). They changed `shared/data.js` (895 lines added), `sw.js`, `s/index.html` and a new `s/handouts.js`, `s/page-view.css`, `teacher/assignments.css`, `teacher/page-assignments.js`, `teacher/preview-student.js`, `teacher/export-all.js` and `tests/grade.test.js`. Every queued item re-checks its claims on the new `main` before it changes anything.

What the Nov 2 plan got wrong, found on re-check:

- `roster-template.csv` is used (the Class Manager's Download Template link). Keep it.
- `schema.sql` is not stale. Eight migration PRs edited it this week, and its header says it keeps notes the generated file cannot. Do not retire it now.
- The two `test.fail()` phone bugs are gone with `e2e/mobile.spec.js`.
- The skipped points test is not about retired points grading. Per-assessment points scoring is live; the test only had a wrong field name. Fix it, do not delete it.
- Write-path Phase 6 is not just dead code. One of its four items (`persistScoreDiffToCanonical`) is the live score send. Another (the `saveScores` mass-loss guard) can refuse a real mark in two rare cases (see S19-B3). The night's report that Delete Assessment trips it was wrong.
- None of the nine "unused" server functions is safe to drop as a mechanical change.

---

## 2. Ground rules

These come from card cp1 (Kent Beck, "Tidy First?") and `CLAUDE.md`.

1. Tidy only the code a change is about to touch, right before it.
2. A tidying PR changes no behaviour. The existing tests pass untouched. A tidying PR never mixes with a feature PR.
3. Many small tidyings, not a rewrite.
4. Cut coupling first: `shared/data.js`, `teacher/page-assignments.js` and the graders.
5. No grade math is touched. No report-card freeze is planned.
6. Phase 4 (ES modules, splitting `data.js` and the big page files) waits for the decision to sell to schools.
7. One PR per change. The only required check is `test-and-format` (vitest, the innerHTML audit, the database drift check, Prettier on changed files). Browser tests do not run on PRs; they run on `main` after each merge. Locally an agent runs only the test files and the one browser spec for its change.
8. Plain language everywhere: in PR titles, in PR bodies, in docs.

### Rules for the night of Nov 11 to 12

Colin is asleep. He approved merging to `main` without him. Merging to `main` deploys nothing, and no release happens tonight.

Allowed tonight, as small PRs that change nothing a teacher can see:

- (a) repo leftovers: `_dev/`, stale `build.sh` lines, `.gitignore`, the package name;
- (b) the `curriculum_crosswalk.json` precache (dropping `curriculum_data.js` was refuted as written; see S19-A8);
- (c) a test that every security header is still sent (the move of `_headers` itself was refuted; see S19-A9);
- (d) the skipped points test and duplicate tests (the map marked the points test `needs Colin`; this rule names it, and the fix touches test files only, so it is queued and its PR says the map flagged it);
- (e) docs fixed in place, the diagrams moved to `docs/history/`, stale comments fixed, and `CLAUDE.md` updated only where a path it names has moved (its other content is Colin's to change, `docs/DECISIONS.md`, Nov 10 entry 16);
- (f) retiring `schema.sql` was allowed, but the map says keep it (see S19-A10), so nothing is queued;
- (g) deleting dead functions, unused export keys and dead CSS, only items both skeptics passed, never an item marked "needs Colin", and CSS only with a before-and-after screenshot comparison of every page that loads the sheet;
- (h) ESLint as warnings, `// @ts-check` with comment-only fixes on `calc.js`, `constants.js` and `html.js`, and `tsc` and lint steps in CI that cannot fail the build yet;
- (i) a speed recorder that records numbers and gates nothing;
- (j) pinning browser tests, each a new spec file;
- (k) a configurable Playwright port, so several worktrees can run browser tests at once;
- (l) this plan, as `docs/plans/handoff-review-plan.md`, with a pointer from the S19 stub in the build plan.

Draft only tonight (opened as a draft PR, never merged): the operations guide's public sections, the re-checked Phase 6 list, and the rest of the `CLAUDE.md` update. The District Review Package is not drafted tonight (see the public-repo rule below).

Not tonight: dropping server functions or backup tables; merging the two boot calls; staging; repo visibility; Sentry; account moves; any release; splitting `data.js` or a page file; any change to how marks are saved, queued, synced or redrawn; any change to grade math; anything that deletes data; the two `.xlsx` files (never touched).

Rules this plan adds for tonight:

- **Tests stay untouched.** If any test, browser spec or live-account spec names a function or export key, it stays. Test-only code is listed for later (S19-A40), not deleted tonight.
- **A refutation wins.** Where one map report passed a name and another refuted the same file or name, the name stays. For example, `fn-mobile-student` passed `MMarkUp.isOpen`, but `window-exports` refuted the `MMarkUp` export because Mark Up is new work behind the build switch. Nothing in `teacher-mobile/markup.js` is deleted tonight. One exception: an item may touch a refuted line when its own instructions answer the refutation's reason, and its PR says so (S19-A12).
- **One rule for the `.xlsx` files.** The `.xlsx` decision covers the two `.xlsx` files and the two `_dev` scripts that build them (with the Apple design rulebook), nothing else. `_dev/make-docs-xlsx.py` writes file names into the inventory as text and never opens them, so a file it names is not held by the decision. S19-A2 and S19-A16 go ahead; S19-A8 and S19-A9 wait only for their own reasons.
- **The repo is public.** Whether it stays public is decision 5. Until then no PR sets out key custody, backups and restore, sign-in controls, security gaps, incident response or privacy impact answers. The operations guide's sections on those are written to a local file for Colin; the District Review Package waits.
- **Fable only orchestrates.** Every queued item names the model that does it (section 7). The orchestrator starts each item on that model and does none itself.

---

## 3. Slices

Each slice says what it changes, the tests that prove it, when it is done, and its status. "Queued for the night of Nov 11" means it is in tonight's work queue (a file kept with the map, not in the repo). The wave number is its place in that queue.

### Track A. Clear out

#### S19-A1. This plan

**Files.** `docs/plans/handoff-review-plan.md` (new), `docs/plans/student-page-build-plan.md` (the S19 stub only).
**Tests.** `tests/docs-sync.test.js`; Prettier on both files.
**Done when.** The plan is on `main` and the S19 stub points at it.
**Status.** Done and released (PR 1185).

#### S19-A2. Delete the old curriculum pipeline in `_dev/`

`_dev/BC Curriculum Documents/` (225 JSON files), `build_curriculum_index.py`, `serve.py` and `category-pill-mockups.html`. Nothing reads them; `scripts/build-curriculum-bank.mjs` and `data/` replaced them. Keep the two `.xlsx` generators and the Apple design rulebook: they belong to Colin's `.xlsx` decision. `_dev/make-docs-xlsx.py` still names the deleted files as text; by the `.xlsx` rule (section 2) that does not hold them.
**Files.** The four paths above.
**Tests.** `npm run audit:html`; `tests/curriculum-labels.test.js`.
**Done when.** 228 files are gone (the 225 JSON files and the three named files; `git ls-files _dev` drops from 231 to 3) and `git grep` finds the names only in `_dev/make-docs-xlsx.py`.
**Status.** Done and released (PR 1190).

#### S19-A3. Delete nine unreferenced screenshots

`docs/rubric-followups/` and `docs/rubric-handouts/` (1.5 MB of PR screenshots from Oct 18).
**Files.** The two folders.
**Tests.** `tests/docs-sync.test.js`.
**Done when.** Both folders are gone and nothing links to them.
**Status.** Done and released (PR 1187).

#### S19-A4. Remove dead lines from `scripts/build.sh`

The `robots.txt` copy (no such file), the "future portals" `student/` and `parent/` copies (no such folders), and the always-true `favicon.svg` guard.
**Files.** `scripts/build.sh`.
**Tests.** The built `dist/` is byte-for-byte the same before and after (with a fixed `COMMIT_REF`); `tests/device-routing.test.js`, `tests/app-routes.test.js`; `e2e/app-loading.spec.js`.
**Done when.** The two file listings match and the script still exits 0.
**Status.** Done and released (PR 1192).

#### S19-A5. Ignore `scratchpad/` and `supabase/.temp/`

**Files.** `.gitignore`.
**Tests.** `git check-ignore -v scratchpad supabase/.temp`; `git ls-files scratchpad supabase/.temp` is empty.
**Done when.** Both folders are ignored and no tracked file changed state.
**Status.** Done and released (PR 1189).

#### S19-A6. Rename the package from `teacher-dashboard` to `fullvision`

Three lines in `package.json` and `package-lock.json`. Nothing reads the name.
**Files.** `package.json`, `package-lock.json`.
**Tests.** `npm ci`; `tests/app-routes.test.js`; `git grep teacher-dashboard` finds nothing.
**Done when.** The three lines say `fullvision`, `npm ci` passes, and nothing else in the lockfile changed.
**Status.** Not done. `package.json` still says `teacher-dashboard`. It needs a rerun.

#### S19-A7. Precache `curriculum_crosswalk.json`

Re-link fetches it, but the service worker does not keep it, so Re-link fails offline on first use. Adds 135 KB to each install. The map rates it medium risk.
**Files.** `sw.js`.
**Tests.** `grep -c "'/curriculum_crosswalk.json'" sw.js` prints 1 (the real check: `tests/sw-precache.test.js` passes with or without the line, and the Re-link spec does not run offline); `tests/sw-precache.test.js`; `e2e/cm-keyboard-focus.spec.js` (Re-link review).
**Done when.** The line is in the precache list and the tests pass.
**Status.** Done and released (PR 1207).

#### S19-A8. Drop `curriculum_data.js` and its fallback

The app loads `curriculum_by_course.json`. `curriculum_data.js` (1.96 MB) is fetched only when that load fails.
**Needs Colin.** The skeptics refuted it as written: dropping it changes what a teacher sees when the JSON fetch fails (the course picker gets nothing instead of the copy). The full edit list is in the map (`repo-leftovers-8`), plus `docs/STUDENT-VOICE-PLAN.md:207`.
**Status.** Closed. Colin's Nov 12 rulings keep the fallback (`docs/DECISIONS.md`, "Handoff review rulings (2026-11-12)").

#### S19-A9. Move the security headers from `_headers` into `netlify.toml`

Only `_headers` sends X-Frame-Options, nosniff, HSTS and Referrer-Policy. Both files set cache rules, and they disagree on `curriculum_data.js`.
**Needs Colin.** Refuted as a night job: only a production check proves Netlify applies the moved headers (`curl -sI` before and after a release). S19-D4 freezes the four headers in a test first.
**Status.** Waits for Colin (after S19-D4 and a release he chooses).

#### S19-A10. Retire `schema.sql`

**Needs Colin.** The map says keep it: it is maintained, and `migrations/local-test/student_page_fields.py` rewrites it. Colin confirms, and the Nov 2 item 10 is dropped.
**Status.** Closed. Colin's Nov 12 rulings keep `schema.sql` (`docs/DECISIONS.md`, "Handoff review rulings (2026-11-12)").

#### S19-A11. Fix the skipped points test and drop duplicate tests

- `tests/mobile-grade.test.js:280`: un-skip "shows +/- stepper for points-based courses". Use `scoreMode: 'points'` (not `score_mode`), and save and restore `getPointsScore` instead of deleting it. It is the only test that draws the phone's points stepper.
- `tests/data.test.js:3656-3659`: the no-op delete test asserts nothing; wrap it in `expect(...).not.toThrow()`.
- `tests/mobile-components.test.js`: drop four duplicate `MComponents.esc` tests (keep 152-165) and the level-0 `profBg` test (384-386), which the 0-to-4 loop covers.

The map marked the points test (`tests-audit-1`) `needs Colin`. It is queued because night rule (d) names it and the change touches test files only: no app code, grade math or saved data. The PR says the map flagged it.
**Files.** The three test files.
**Tests.** The three files pass; the skipped count drops by one.
**Done when.** The points stepper test runs and passes.
**Status.** Done and released (PR 1191).

#### S19-A12. Fix old file names in test comments

`gb-data.js`, `gb-calc.js`, `gb-ui.js`, `gb-router.js` and the `m-*.js` phone names in 19 comments across 13 test files, plus two stale commands (`tests/grader.test.js:9`, `tests/report.test.js:467`).

The skeptics refuted a blind rename of these names (`docs-audit-26` and `-28`): it would hit the live fixture `tests/fixtures/report-calc-callers.json`, the `#gb-data` DOM id and the `gb-` local storage keys. This slice changes only names that end in `.js` and leaves those three alone, which answers the refutation's reasons. Its PR says so.
**Files.** The 13 test files, `tests/setup.js` and `tests/setup-mobile.js` included.
**Tests.** The changed test files pass. A token check shows each file's code is unchanged once comments are ignored.
**Done when.** `git grep -E 'gb-(data|calc|ui|router)\.js|m-(components|students|observe|grade)\.js' tests/` finds nothing.
**Status.** Done and released (PR 1210).

#### S19-A13. Fix docs that contradict the code, in place

- `docs/plans/student-page-build-plan.md`: line 3 ("Nothing here is built yet"), line 124 (a deleted test file), lines 211 and 624 (`s/learning.js` does not exist), line 770 (the redesign is not paused: R1 to R7 merged), and the S9 and S10 status lines (signed in since #1137, a real card since #1141).
- `docs/STUDENT-VOICE-PLAN.md:3`: PRs 2 to 9 are built; PR 10 and "Later" are open.
- `docs/ROADMAP.md:25`: slips moved to the card key (S3-S1, #1150); release pending.
- `README.md`: three runtimes, not two; the student page; the two edge functions; `docs/schema.generated.sql` is the exact schema; the layout block. Its `schema.sql` line (176) is left alone: it waits for decision 12, because the map marked that item (`docs-audit-33`) `needs Colin`.

**Files.** `docs/plans/student-page-build-plan.md`, `docs/STUDENT-VOICE-PLAN.md`, `docs/ROADMAP.md`, `README.md`.
**Tests.** `tests/docs-sync.test.js`; Prettier.
**Done when.** Each listed line says what the code does today.
**Status.** Done and released (PR 1193).

#### S19-A14. Update `CLAUDE.md`

Line 64 names a deleted test file (the guard is `describe('grade-format-guard')` in `tests/grade.test.js`). Tonight only that line changes: night rule (e) allows a `CLAUDE.md` edit only where a path it names has moved.
**Files.** `CLAUDE.md`.
**Tests.** `tests/docs-sync.test.js`; Prettier.
**Done when.** Line 64 names `tests/grade.test.js` and nothing else in the file changed.
**Status.** Done and released (PR 1206).

#### S19-A14b. The rest of the `CLAUDE.md` update, for Colin

"Current state (2026-11-02)" re-dated; a bullet on the student page build that makes no claim about what is released (release #1182 shipped part of it) and asks Colin to say; a pointer to this plan; line 3; rows for `s/` and `supabase/functions/`. Rule numbers and wording stay exactly as they are: tests cite them.
**Files.** `CLAUDE.md`.
**Tests.** `tests/docs-sync.test.js`; Prettier.
**Done when.** Colin accepts or drops each of the five edits.
**Status.** Done and released (PR 1214). It merged after review.

#### S19-A15. `docs/ARCHITECTURE.md`: the student page, and every module named

Line 30 says the card screens run in Demo Mode only; the card routes exist. Lines 10 and 241 say two surfaces; there are three. Line 86 is wrong about the phone's scripts. Seventeen `s/` and `shared/` files are named nowhere (the map's sixteen, plus `s/handouts.js` from #1184); name each, listing them afresh on the new `main`.
**Files.** `docs/ARCHITECTURE.md`.
**Tests.** `tests/docs-sync.test.js`; a short script that lists unnamed `s/` and `shared/` files prints nothing.
**Done when.** Every `s/` and `shared/` file is named and the statements match the code.
**Status.** Done and released (PR 1213).

The test that every `s/` and `shared/` file must be named waits for the morning. Added tonight, it would fail any PR the build session opens that adds such a file without naming it. Add it once that session knows the rule. **Status.** Later.

#### S19-A16. Move the April diagrams to `docs/history/diagrams/`

Ten `.drawio` files, their README and the four `lucidchart-*` files. The README sends readers to `HANDOFF.md` and `codex.md` as current; point it at `ARCHITECTURE.md` and `ROADMAP.md`. `_dev/make-docs-xlsx.py` names these files as text; by the `.xlsx` rule that does not hold them.
**Files.** `docs/diagrams/`, the four `docs/lucidchart-*` files, `docs/history/`, `README.md`, `docs/backend-design/HANDOFF.md`.
**Tests.** `tests/docs-sync.test.js`; Prettier; `git grep -E 'docs/diagrams|lucidchart'`.
**Done when.** The files are under `docs/history/diagrams/` and every link in its README resolves.
**Status.** Done and released (PR 1209).

#### S19-A17. Fix two stale code comments

`teacher/page-student.js:15` (the tab list) and `shared/seed-data.js:1344` (`seedLabChecks` does not exist). Comments only.
**Files.** `teacher/page-student.js`, `shared/seed-data.js`.
**Tests.** A token check shows the code is unchanged once comments are ignored; `tests/student-overview.test.js`, `tests/edit.test.js`, `tests/golden-grades.test.js`; `e2e/student-tabs.spec.js`.
**Done when.** Only the two comments changed.
**Status.** Done and released (PR 1211).

#### S19-A18 to S19-A28. Delete dead functions and unused export keys

Every name below passed both skeptics, is marked low or medium risk, and is named by no test. The map rates every `window-exports` entry medium, so these slices carry medium risk. Each PR deletes only what it lists; an export key goes, the function behind it stays unless the line says "function".

| Slice | Files                                                                                                                           | What goes                                                                                                                                                                                           | Wave                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A18   | `shared/data.js`                                                                                                                | `window.GB` shrinks from 240 keys to 7 (the 233 in the map's `gb-unread-keys.txt`); functions `pronounsSelect`, `formatTs`, `getParam`                                                              | 4                                                |
| A19   | `teacher/ui.js`                                                                                                                 | function `withSwitchingLock` and its `window.` line; 18 `window.UI` keys (keeps `refreshSyncStatusUI`, `queueSessionExpiredRetry`, `copyTextToClipboard`, `profBadge`, `profBar`, `retrySyncQueue`) | 4                                                |
| A20   | `page-dashboard.js`, `page-gradebook.js`, `page-observations.js`, `page-reports.js`, `page-student.js`                          | `switchCourse` from five `Page*` exports (keeps `PageAssignments.switchCourse`); functions `closeClassManager`, `renderOverallHeader`                                                               | 4                                                |
| A21   | `dash-class-manager.js`, `dash-overview.js`, `dash-insights.js`, `dash-observations.js`, `dash-student-cards.js`                | function `_cmRenderRoundPercentField`; function `renderBirthdayWidget`; keys `setActiveCourse`, `missingCounts`, `buildModel`, `obDay`, `newestFirst`, `stripTipLines`, `CHIP_MAX`                  | 4                                                |
| A22   | `rubric-library.js`, `rubric-print.js`, `rubric-guard.js`, `rubric-bank.js`                                                     | function `openPickDialog`; `RubricPrint` keys `unstage`, `LAYOUT_ORDER`, `stage`, `activatePrintMode`, `print`; keys `rubricAssessments`, `matches`                                                 | 4                                                |
| A23   | `comment-realiser.js`, `comment-lint.js`                                                                                        | keys `numberStart`, `PHRASAL`, `IDIOMS`, `PRAISE`, `COMPARISONS`, `SHAME`                                                                                                                           | 4                                                |
| A24   | `grade-report.js`, `report-sheets.js`, `questionnaires.js`, `phone-reports.js`                                                  | keys `DEFAULTS`, `TIERS`, `FB_COL_W`, `PAPER`, `LINE_PX`, `templates`, `age`, `load`, `loaded`, `list`, `update`, `printSlips`                                                                      | 4                                                |
| A25   | `competency-evidence.js`, `student-evidence.js`, `obs-capture.js`, `obs-card.js`, `preview-student.js`, `grading-setup-copy.js` | keys `evidenceFor`, `openCapture`, `closeCapture`, `destroyCapture`, `deleteOb`, `setType`, `setComp`, `starterList`, `metaHtml`, `setDevice`, `GROUPS`                                             | 4                                                |
| A26   | `shared/phone-report-view.js`, `photo-readers.js`, `photo-shrink.js`, `loading-screen.js`, `supabase.js`, `constants.js`        | keys `WORDS`, `STEPS`, `library`, `LIBRARY_URL`, `turnMatrix`, `sha256Hex`, `FVLoading.mount`; the three `window.isLoggedIn` lines; `window.CATEGORY_PALETTE`                                       | 4                                                |
| A27   | `teacher-mobile/card-widgets.js`, `student-detail.js`, `students-list.js`, `sweep.js`, `tab-observe.js`                         | keys `staleNameNote`, `refreshPanels`, `buildCells`, `_state`, `setOrder`, `setType`, `chooseStarter`, `writeInstead`, `shortName`, `typeBlock`, `dayLabel`                                         | 4                                                |
| A28   | `teacher/assessment-copy.js`                                                                                                    | function `renderAlsoAddTo` and its key; key `reviewPlans`                                                                                                                                           | 6 (the assessment form is being changed tonight) |

If `tests/grade.test.js` fails (its list of rounding calls that are not grades), the PR stops and reports; it never edits that test.
**Tests.** Each PR runs the module's own tests and the guard tests that read source by name: `tests/grade.test.js` (the grade-format guard and its rounding list), `tests/grader-guard.test.js`, `tests/level-readings-outside-calc.test.js`, `tests/report-score-seam.test.js`, `tests/no-inline-handlers.test.js`, `tests/help-labels.test.js`, plus `npm run audit:html`.
**Done when.** `git grep -w` finds no read of a removed name, tests pass untouched, and no script list changes (no file is added or removed).
**Status.** Done and released. PRs: A18 1221, A19 1217, A20 1223, A21 1224, A22 1218, A23 1215, A24 1222, A25 1219, A26 1220, A27 1216, A28 1235.

#### S19-A29 to S19-A39. Delete dead CSS, one stylesheet per PR

Each PR deletes only the selectors named in the map's confirmed entries (never a whole "family" by prefix; S19 found live classes inside two such families). Proof is the screenshot harness (S19-D5): every page and state that loads the sheet is captured on `main` and on the branch, and no pixel may differ. The harness also checks that each deleted selector matches nothing on those pages.

| Slice | Sheet                         | Map entries                                                                                    | Pages that load it                             | Wave                                              |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| A29   | `teacher/styles.css`          | css-teacher 79-92, 94-98, and the `styles.css` parts of 1, 2, 12, 23, 28, 43, 44               | desktop, phone, login, privacy, the Help panel | 5                                                 |
| A30   | `teacher/dashboard.css`       | 13-22, and the `dashboard.css` parts of 11, 12                                                 | desktop                                        | 5                                                 |
| A31   | `teacher/student.css`         | 45-57, 59-78, 107, and the `student.css` parts of 11, 43, 44                                   | desktop                                        | 5                                                 |
| A32   | `teacher/gradebook.css`       | 24, 108, and the `gradebook.css` part of 23                                                    | desktop                                        | 5                                                 |
| A33   | `teacher/reports.css`         | 29-42, 109, and the `reports.css` part of 28 (print rules included: compare in print view too) | desktop                                        | 5                                                 |
| A34   | `teacher/observations.css`    | 25, 26                                                                                         | desktop                                        | 5                                                 |
| A35   | `teacher/preview-student.css` | 27                                                                                             | desktop                                        | 5                                                 |
| A36   | `teacher-mobile/styles.css`   | css-other 4-18                                                                                 | phone                                          | 5                                                 |
| A37   | `s/student.css`               | css-other 2, 3                                                                                 | student page                                   | 5                                                 |
| A38   | `s/page-view.css`             | css-other 1                                                                                    | student page, desktop preview                  | 5                                                 |
| A39   | `teacher/assignments.css`     | css-teacher 3-10, 99, and the `assignments.css` parts of 1, 2                                  | desktop                                        | 6 (last; the form's CSS is being changed tonight) |

Not tonight: the seven custom properties read but never defined. Every fix offered for them either changes a colour in dark mode or is a no-op (S19 section 5).
**Status.** Done and released. PRs: A29 1233, A30 1231, A31 1234, A32 1230, A33 1232, A34 1226, A35 1227, A36 1228, A37 1225, A38 1229, A39 1236.

#### S19-A40. Test-only code, and the "needs Colin" dead code

Code nothing in the app calls, kept alive by tests or marked "needs Colin" by the map. Tidy First says tests stay untouched in a tidying PR, so each goes only with a decision: keep it as a test seam, or delete it with its test.

- Test-only, low or medium risk: `MComponents.largeTitleHTML`; `LearnerProfile.aboutHtml`, `courseGoalHtml`, `coreGoalHtml`; `ReportSheets.setPinned`, `fitText`.
- Marked needs Colin: in `shared/data.js` `getSyncStatus`, `isRubricCheckOn`, `setStudentPageSwitch`, `_forgetCardsPrintedHere`, the S10 and S11 student-side Demo Mode writers; `GradeState.afterSeen`, `studentCopy`, `NONE`; `PhotoQueue.isLocalId`, `DB_NAME`, `LOCK_NAME`; `FVBackupRestore.collectIds`, `restoredCourse`, `backupToPayload`; `v2Queue.currentOwner`; `tagScoresByAssessment` in `calc.js`; `selectScore`, `renderOverallCell`, `nextCompletionMark`; `profBadge`, `profBar`, `retrySyncQueue`; `PhoneReports.termNumber`; `RubricPrint.scoreSheetData`; seven `GradesPrint` members and `statusText`; `MMarkUp.saveNote`; `MSweep.saveAndNext`; `MGrade.showLevelSheet`; `ClassResults.otherClassesResults`; `RubricChecks.LEVELS`; `GraderWork.heldForRevision`; `helpGroups`, `skillTags`, `iePending`, `earlierRow`, `highestSkills`, `passesGates`, `cmShowImportPreview`, `categoriesDraft`, `reorderCategory`, and the `StudentCards` test hooks.
  **Needs Colin.** One decision for the list: keep test seams, or delete with their tests.
  **Status.** Later.

#### S19-A41. Move shipped plans to `docs/history/` and add `docs/README.md`

The skeptics refuted every move as written except the diagrams (S19-A16). Several plans still hold open items (`questionnaire-plan.md`, `comment-bank-audit.md`, the teacher student-page redesign plan), and moving `codex.md` or `docs/backend-design/` breaks 142 and many more relative links. The proposed `docs/README.md` test fails on today's tree.
**Status.** Later. Re-map each move with its links, one file per PR.

### Track B. Write-path Phase 6

`docs/write-path-plan.md` Phase 6 named four "dead" items. The re-check found:

- `_DATA_KEYS`: all 25 entries are live. Nothing to remove.
- `persistScoreDiffToCanonical`: the live score send inside `saveScores`. Three extra calls after it (in `restoreScoreCells` and the two undo paths in `shared/grader.js`) send the same cells twice.
- The `saveScores` mass-loss guard: the night's report said Delete Assessment makes it refuse every later save. That was wrong (see S19-B3). The guard can still refuse a real mark in two rare cases, both described in S19-B3.
- Legacy comments: three are wrong (`data.js:100`, `1362-1364`, `14594-14598`).

#### S19-B1. The re-checked Phase 6 list

Rewrite Phase 6 in `docs/write-path-plan.md` with the findings above and the order below. Fix the header ("Phase 5 in review").
**Status.** Done and released (PR 1194).

#### S19-B2. Comment-only fixes in `shared/data.js`

Lines 100, 1362-1364, 2136 and 14594-14598, and `tests/write-path-audit.test.js:2`.
**Files.** `shared/data.js`, `tests/write-path-audit.test.js`.
**Tests.** A token check shows the code is unchanged once comments are ignored; `tests/write-path-audit.test.js`, `tests/data.test.js`, `tests/persistence.test.js`.
**Done when.** Only those comments changed.
**Status.** Done and released (PR 1208).

#### S19-B3. Keep a mark the guard blocks

**What was claimed.** The night's probe reported that Delete Assessment on a piece that holds most of a class's entries makes the `saveScores` mass-loss guard refuse that save and every later score save in the class.
**Why it was wrong.** Both delete paths (`_commitDeleteAssess` in `teacher/page-gradebook.js`, `_confirmDeleteAssess` in `teacher/page-assignments.js`) save the shorter work list first. `saveAssessments` then calls `_cleanOrphanedScores`, which removes the deleted work's marks from the cache and the saved copy, so the guard sees no drop. The probe skipped that step. Two agents tested it 16 ways (30 students; points, competency and rubric work; Gradebook and Assignments; Demo Mode and signed in): no block, and a mark entered afterwards was saved and sent. `e2e/pin-delete-assessment-then-grade.spec.js` (PR #1246) pins it.
**What can still go wrong.** Two rare cases, both found in that testing. In both, the red "Score save blocked" message shows, and its "Retry Now" button retries pending sends only; it does not save the blocked mark again.

1. The browser refuses the one saved-copy write at the moment of a Delete Assessment (storage full or failing). The saved copy keeps the old marks, so the guard blocks every later points or Complete mark. Those marks are lost if the teacher reloads before a level or comment save rewrites the saved copy.
2. Two tabs on the same class. Tab A uses Set Everyone To on a column. Tab B, which saved something in the last two seconds and so has not yet reloaded the class, enters a mark. The guard blocks it, because it would otherwise overwrite tab A's fill. That mark is gone after tab B reloads.
   **The fix.** A blocked mark is kept and saved once the saved copy is fresh. It is never dropped. Tests come first, a test that fails today for each case and one that proves an accidental empty save is still refused. An independent reviewer then tries to break it.
   **Needs Colin.** It changes how marks are saved; his Nov 12 ruling lets it merge once the reviewer cannot break it (section 6, decision 9).
   **Status.** Done and released (PR 1250). Its pin is PR 1246 and the corrected report is PR 1247.

#### S19-B4. Send an undone cell once

Delete the three extra `persistScoreDiffToCanonical` calls. The pin tests change to expect one send per cell.
**Needs Colin.** Save path.
**Status.** Waits for Colin.

#### S19-B5. Make the score send private

Rename it `_sendScoreDiff`, take it off the export list and the grader-guard allowlist.
**Status.** Later (after S19-B4).

#### S19-B6. Delete `_savedCopyHasLegacyRubricKeys`

Its last caller went in `87ed0faa` (S0-F1e), which is titled "Needs Colin's review".
**Needs Colin.** Wait for that review; if he reverts it, the function is needed again.
**Status.** Waits for Colin.

#### S19-B7. Bring the docs up to date

`docs/ARCHITECTURE.md` ("Writes", "Offline and retry", "Cross-tab behavior") and `docs/backend-design/offline-sync.md`, which is almost all stale.
**Status.** Later (after S19-B3 to B5, so they describe the final code).

#### S19-B8. Retire the April-era data shapes

Six readers of old saved-copy shapes still run. Demo classes and copies with no bundle record are never purged, so old shapes can still be on a device.
**Needs Colin.** Each removal; not recommended now.
**Status.** Waits for Colin.

### Track C. Fast

#### S19-C1. A speed recorder

A Playwright spec on a 30-student, 60-assessment class: load time, Largest Contentful Paint, and click response for the Gradebook, Assignments, Class Management and the phone Grade tab, at full speed and at a quarter-speed CPU. It records numbers to the CI summary and an artifact. It has no `expect` on any number. It runs on pushes to `main`, never on PRs, with a concurrency group that cancels an older run, so a burst of merges runs it once.
**Files.** `e2e-perf/speed.spec.js`, `playwright.perf.config.js`, `.github/workflows/perf.yml` (all new).
**Status.** Done and released (PR 1196).

#### S19-C2 to C11. The speed work itself

All of it changes what loads or when, so none of it is tonight's. In order of value:

- **C2.** Remove the eager `shared/bank-comment.js` tag (261 KB); `competency-wording.js` already loads it on demand. Dropped (Nov 12). The tag is still in `teacher/app.html`.
- **C3.** Load the reports-only scripts (11 files, 642 KB) and the print, QR and rubric-bank code only on the pages that use them. Done and released (PRs 1245 and 1286).
- **C4.** `defer` on the scripts, keeping the order rules in the map's loading report (section 6). Closed (Nov 12): no gain.
- **C5.** Versioned file names and a long cache. Later; it needs S19-A9 first.
- **C6.** A service worker that precaches each page's own files and stops re-downloading 12.66 MB on every deploy. Done and released (PR 1290).
- **Plan for C5, C6 and C7:** `docs/plans/caching-plan.md` (Nov 12). The site never answers "not changed", so a repeat visit re-downloads 1.65 MB; it recommends C7 first, then keeping unchanged files across releases, and leaves versioned file names.
- **C7.** Run the `inject-env` edge function on HTML only, not on every file. Done and released (PR 1289). The read-only check script is PR 1288.
- **C8.** One boot call instead of `bootstrap_teacher` then `list_teacher_courses`. Needs Colin (server change). Waits for Colin.
- **C9.** One mark saves one mark; redraw only what changed. Needs Colin (save and redraw paths). Waits for Colin.
- **C10.** Find out why the phone score tap takes 395 ms. Measured in PR 1282 (released). The 395 ms is not fixed. It moves into C9.
- **C11.** Sentry performance tracing. Ruled no (Nov 12): error reports leave Canada.

### Track D. Safety nets

#### S19-D1. A configurable Playwright port

`PORT=8348 npx playwright test` runs a second worktree's tests on its own server. Today the second run silently tests the first worktree's build.
**Files.** `playwright.config.js`, `playwright.real.config.js`, `e2e/student-card-fake.js`.
**Status.** Done and released (PR 1186).

#### S19-D2. ESLint and type checks, reporting only

ESLint with `no-undef` and `no-unused-vars` as warnings, with the globals of each page built from its script tags. `// @ts-check` on `shared/html.js` and `shared/constants.js`, and `tsc` in CI. Both CI steps report and cannot fail the build yet.
**Files.** `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `scripts/lint-globals.mjs`, `tsconfig.json`, `types/globals.d.ts` (the last four new), `shared/html.js`, `shared/constants.js`.
**Tests.** `npm run typecheck` (0 errors); `npx eslint .` (0 errors, about 186 warnings); `npm run audit:html`; `tests/data-utils.test.js`, `tests/grade.test.js`, `tests/csp-directives.test.js`; `e2e/app-loading.spec.js`.
**Done when.** Both new CI steps run with `continue-on-error` and report.
**Status.** Done and released (PR 1197).

#### S19-D3. `// @ts-check` on `calc.js`

Comments only: two `/*` become `/**`, two `@returns`, one `@param`, one `@ts-expect-error`, and two orphan docblocks removed. A token check shows the code is unchanged once comments are ignored (a script reads both copies of the file into tokens, drops the comments and compares), so no grade math changes. The PR says so under rule 2.
**Files.** `shared/calc.js`.
**Tests.** The token check; `npm run typecheck` (0 errors); every calc and golden-grade test, untouched.
**Done when.** All three pass.
**Status.** Done and released (PR 1212).

#### S19-D4. A test that freezes the security headers

`tests/headers.test.js` checks that `_headers` sends exactly the four security headers with today's values. The later move (S19-A9) reuses it.
**Files.** `tests/headers.test.js` (new).
**Tests.** The new test passes on today's files and fails if any of the four values changes.
**Done when.** Both are shown.
**Status.** Done and released (PR 1188).

#### S19-D5. A screenshot harness for CSS deletions

`playwright.visual.config.js` and `e2e-visual/` (new): it captures every page and state that loads a given sheet, at desktop and phone size, with a fixed clock. Run once on `main` to record, once on the branch to compare; no pixel may differ. It also checks that a list of deleted selectors matches nothing. The pictures are kept outside the repo.
**Status.** Done and released (PR 1205).

#### S19-D6 to S19-D13. Pins before any page is split

Each is a new browser spec in Demo Mode. They record what the page does today; they never change app code. Where a step shows a bug, the spec leaves the step out and the PR says what was seen.

| Slice | Spec                                         | What it pins                                                                                                                             | Wave |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| D6    | `e2e/pin-gradebook-sort-filter.spec.js`      | the Student and Overall sorts, the filter strip, To Grade, To Return, Questions, search with sort, Rubric Columns after a reload         | 2    |
| D7    | `e2e/pin-gradebook-edits-reload.spec.js`     | typed scores after a reload, Clear Score and Undo, Cmd+Z, Mark Blank Cells and Undo, Delete Assessment, the Overall Comment, one CSV row | 2    |
| D8    | `e2e/pin-assignments-list-actions.spec.js`   | card order and drag, Expand and Collapse All, Duplicate, Copy to Another Class, Delete and Undo, modules                                 | 6    |
| D9    | `e2e/pin-assignments-grading-reload.spec.js` | rubric, points and Complete grading on cards after a reload, Set Unmarked To and Undo, the row comment popover                           | 6    |
| D10   | `e2e/pin-cm-grading-tab.spec.js`             | grading system, calculation method, rounding, level order, categories, Counts As                                                         | 2    |
| D11   | `e2e/pin-cm-terms-curriculum.spec.js`        | reporting terms, competency groups, wording edit and restore, I Can delete                                                               | 2    |
| D12   | `e2e/pin-cm-roster-class.spec.js`            | roster sort, designation chips, row links, archive, delete, backup download                                                              | 2    |
| D13   | `e2e/pin-phone-grade-tab.spec.js`            | levels, statuses, Complete and Incomplete, Undo after Set To, comments after a reload, a phone grade reaching the desktop gradebook      | 2    |

D8 and D9 wait for the last wave, so they pin the assessment form work that another session is landing tonight.
**Status.** Done and released. PRs: D6 1198, D7 1203, D8 1237, D9 1238, D10 1201, D11 1204, D12 1202, D13 1200.

#### S19-D14 to D17

- **D14.** Make `tests/grader-guard.test.js` read sub-folders before any code moves into a feature folder; today it would stop seeing moved code without failing. Later.
- **D15.** Turn lint warnings into errors file by file, and make `tsc` blocking. Needs Colin (when). Later.
- **D16.** A database the repo can rebuild (a baseline migration) and tests for who can see what (pgTAP). Later; it needs a place to run (D17).
- **D17.** Staging: a Supabase branch or a small second project. Needs Colin. Held (Nov 12).

### Track E. Organized code

The Nov 12 ruling started Track E (`docs/DECISIONS.md`, "Handoff review rulings (2026-11-12)"). A later ruling the same day lets pieces that touch marks move too, as move-only PRs under a method that leaves Colin and Karen with no change they can see (`docs/DECISIONS.md`, "Marks may be moved; Colin and Karen must see no change (2026-11-12)").

**Moved (19 pieces, each a move-only PR merged by an independent reviewer, all released).**

- Into `shared/`: `data-curriculum-index.js`, `data-utilities.js`, `data-demo.js`, `data-student-cards.js`, `data-student-records.js` (flags, goals, reflections, notes and modules), `data-term-ratings.js` (term ratings and report preferences) and `data-observations.js`. `shared/data.js` went from 22,218 lines to 19,123.
- Page pieces: `teacher/cm-roster-file.js`, `teacher/cm-block-picker.js`, `teacher/gradebook-csv.js`, `teacher/gradebook-chrome.js`, `teacher/student-groups.js`, `teacher/student-edit-dialog.js`, `teacher/assign-competency-picker.js` and `teacher/assign-descriptor-bar.js`.

**Stopped with no change (6).** The seam map marked several of these as not touching marks; it was wrong each time, and the agents caught it before changing anything.

- The DIBELS benchmark (`teacher/page-assignments.js`): it reads or writes marks.
- Copy From Another Class: not a separable dialog.
- The Reports Issue dialog: "Return Them, Then Print" returns draft grades, and it shares page state.
- The v2 server-call wrappers: they include the reader that loads every score and the wrappers that save section overrides and term ratings.
- Reflect on Feedback: it reads returned grades and revision requests.
- Student work and feedback: its feedback half returns grades and syncs returned work and revisions.

**The ruling.** Colin, 2026-11-12: marks may be moved, and Colin and Karen must see no change. The remaining pieces proceed as move-only PRs under the method in that entry: a byte-for-byte proof, the same long sequence of real teacher actions on main and on the branch, an independent reviewer with a different sequence, the full browser suite on GitHub before merge, and small releases. Anything that cannot be shown identical stops and goes to Colin. The long sequence is `scripts/differential-run.mjs` (`docs/differential-run.md`): main against the branch, three seeds, both modes, offline and two tabs. Changing how a mark is saved, queued, synced, returned or deleted still needs him. This replaces the old rule that the score writers wait for a day's use on real classes after a release. Recommended order, from the map.

**Tidyings in `shared/data.js` that cut false coupling** (each its own PR):

1. Delete the dead converter layer (about 250 lines at 5358-5420 and 5529-5713). Needs its own two-skeptic check first; it was found after tonight's checks.
2. Move generic helpers (`_isUuid`, `_dateOnly`, `_rpcRows` and others) into utilities.
3. Give `_saveCourseField` a list of on-save hooks instead of calling four other areas by name. Needs Colin (save path).
4. Make the load-time tables lazy (`_WITHDRAWN_RECORD_FIELDS`), so a getter can move to a later file without a load error.
5. Retire the per-table load (about 900 lines), the path every vitest test runs because `tests/setup.js:182` turns the class bundle off. Needs Colin (loading).
6. Drop the 11 self-guards on `data.js`'s own functions and the second `window.v2` init.

**Then the seams, one per PR, leaves first:** curriculum index; utilities; the `v2` RPC wrappers; Demo Mode; student cards; flags, goals, reflections, overrides, notes, modules, profile summaries; term ratings and reports; observations; the student-page cluster (reflections, Mark Up, student work); revisions; learning map, categories, rubrics, assessments, settings; roster; courses and terms; then the mark writers together (statuses, score writes, group grading); Draft and Returned; the load path. The kernel (sync status, RPC plumbing, outbox and re-keying, cross-tab, boot) stays as `data.js`. Every seam from "revisions" on touches marks and moves only under the method above.

**Page seams, smallest first:**

- `teacher-mobile/tab-grade.js`: split its two halves (`List` and `Speed`) into two files; they share two helpers.
- `teacher/dash-class-manager.js`: the roster file reading (611 lines, no outward calls); then the block picker and empty state; then terms, import and the wizard as prefix routes.
- `teacher/page-assignments.js` (after tonight's form work): DIBELS (401 lines); then the descriptor bar, Copy From Another Class, the competency picker; the grader dialog and the form only later, as whole units.
- `teacher/page-gradebook.js`: the grid chrome, CSV export, the two table renderers; share the three category helpers that are byte-identical with Assignments.
- `teacher/page-student.js`: Groups (no outward calls) and the Edit Student dialog.
- `teacher/page-reports.js`: the Issue dialog only. Leave the tabs host (S16 scaffolding).
- Into `shared/grader.js`: `_reviseByText`, `_revisionKey` and the Return for Revision request (byte-identical on desktop and phone).
- **Needs Colin:** desktop and phone show a criterion's level differently when keys are mixed (desktop the first non-zero level, phone the lowest). One of them is wrong. Also the grading order differs (last name on desktop, alphabetical on phone).
- Map `teacher/report-questionnaire.js` (8,994 lines); no one has.

**Status.** In progress. Nineteen pieces that do not touch marks moved first. Then four mark-touching moves merged: PRs 1298, 1299, 1308 and 1309. `shared/data.js` is 9,680 lines on `origin/main`. The comparison tool (the differential run) merged as PR 1304. A follow-up PR for it is owed. Left to move: the mark writers, Draft and Returned, and the load path. Items marked "Needs Colin" still wait for him.

Record of how the four mark-touching moves were checked. For PRs 1298, 1299 and 1308, the full browser suite ran on `main` straight after the merge (green each time), not on GitHub before it, as the method says. For PR 1309 it ran on GitHub before the merge.

### Track F. Run it like a service

#### S19-F1. An operations guide

`docs/operations.md`: run locally, deploy, roll back, what CI does, the edge functions. Facts from the map's `ops-facts` report; gaps only Colin can fill are marked "Colin fills in". Keys and secrets, backups and restore, paid accounts and who pays, who to call, and the domain registrar are written to a local file for Colin (`~/reports/S19 held drafts/`), not to the PR, until decision 5.
**Files.** `docs/operations.md`.
**Done when.** The four public sections are sourced and the held sections are in the local file only.
**Status.** Not done. An operations guide was drafted, but nothing is merged. It needs a rerun.

#### S19-F2. The District Review Package

`docs/district/`: architecture and data flow, data inventory, retention and deletion, security controls, subprocessors and regions, incident response, and answers to the standard BC privacy impact questions. Each claim the repo cannot prove is marked "check on the live service".
**Needs Colin.** Most of it describes security controls and their gaps. In a public repo, even a draft PR publishes them. It waits for decision 5 (and 7 for the region answers).
**Status.** Waits for Colin.

#### S19-F3 to F8

- **F3.** Keep the repo public or make it private. Needs Colin.
- **F4.** Move GitHub, Netlify and Sentry into organizations with two-step sign-in required. Needs Colin.
- **F5.** Sentry in the EU (disclosed) or error reports kept in Canada. Needs Colin.
- **F6.** Closed signup or SSO (ROADMAP 1.5). Later.
- **F7.** The guide's gaps: Sentry build credentials, Netlify's Node version, the edge function deploy command, what `*.nsvcs.net` in the content policy is for. Needs Colin.
- **F8.** Run the live-account specs against staging on a schedule, not against `gradebook-prod`. Today nothing runs them. Waits for S19-D17.

### Nov 2 items with no slice

Each Nov 2 item not covered above, with where it stands.

- **Rule 5's sync toasts** (Phase 1 #6). The "Saving locally — cloud sync paused." toast is gone from the code; about 18 other toasts remain, some about sync ("Learning map saved locally. Cloud sync needs attention.", "Queued changes synced."). Removing them changes what a teacher sees, so it is a feature PR, not a tidying. Later. S19-A19 drops only the unread `UI.showSyncToast` key.
- **`duplicate_course` and `import_teams_class` in `FV_IDEMPOTENT_RPCS`, and `fv_status_counts`** (Phase 1 #11). Both names are still in the list (`shared/constants.js`); `fv_status_counts` is live in the generated schema. Both go only with decision 3 on the server functions. Needs Colin.
- **`recent-work-mockups/`** (Phase 1 #1). It does not exist and was never in the history. Nothing to do.
- **The stale `teacher/app.html` comment** (Phase 1 #9, `docs-audit-27`). Refuted: the same stale claim sits in `codex.md:431`, and `app.html` is a script list file. Later, with `codex.md`.
- **Faster first draw** (Phase 2 #2): drawing from the saved copy before the server answers instead of keeping the page inert, `getSession()` first with the `getUser()` re-check in parallel, and one boot scan of local storage instead of three. Each changes when the page draws or when the sign-in check runs. Later (Track C); the sign-in order needs Colin's OK.
- **The phone redirect check before any stylesheet loads** (Phase 2 #3). It changes load order on every desktop page. Later, with S19-C4.
- **Index lookups in the gradebook loops** (Phase 2 #8). It reshapes the Gradebook's draw code, which Track D holds and S19-C9 changes. Later.
- **Splash images as WebP or AVIF** (Phase 2 #9; `assets/splash/` is 3.5 MB). It changes images a visitor sees. Later.
- **One RPC client** (Phase 4 #3). Phase 4: waits for decision 21.
- **Escape by default with an `html` tagged template** (Phase 4 #5). Phase 4: waits for decision 21, then screen by screen as screens are touched. `npm run audit:html` stays.
- **CSS layers, stylelint and the 328 `!important`s** (Phase 4 #6). Phase 4: waits for decision 21. Tonight's dead-CSS deletions make it smaller.
- **Where the domain is registered** (Phase 5 #2). Only Colin knows. Needs Colin (it goes in the operations guide's held sections).

---

## 4. Files only one PR may change at a time

These files are needed by many PRs. Each has at most one holder per wave tonight. A dash means no PR tonight touches it.

| File                                                                                  | Holders by wave                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `package.json`, `package-lock.json`                                                   | 2: D2; 3: A6                                         |
| `.github/workflows/ci.yml`                                                            | 2: D2                                                |
| `sw.js`                                                                               | 3: A7                                                |
| `scripts/build.sh`                                                                    | 1: A4                                                |
| `tests/setup.js`, `tests/setup-mobile.js`                                             | 3: A12                                               |
| `teacher/app.html`, `teacher-mobile/index.html`, `s/index.html`                       | -                                                    |
| `docs/ARCHITECTURE.md`                                                                | 3: A15                                               |
| `docs/xss-baseline.json`                                                              | - (it is empty; deletions cannot trip it)            |
| `CLAUDE.md`                                                                           | 3: A14; 4: A14b (draft)                              |
| `.gitignore`                                                                          | 1: A5                                                |
| `shared/data.js`                                                                      | 3: B2; 4: A18                                        |
| `teacher/page-assignments.js`, `teacher/assignments.css`                              | 6: A39 only (another session holds the form tonight) |
| `teacher-mobile/tab-grade.js`                                                         | -                                                    |
| `docs/plans/student-page-build-plan.md`                                               | 0: A1; 1: A13                                        |
| `README.md`                                                                           | 1: A13; 3: A16                                       |
| `shared/constants.js`                                                                 | 2: D2; 4: A26                                        |
| `teacher/page-student.js`                                                             | 3: A17; 4: A20                                       |
| `playwright.config.js`                                                                | 0: D1                                                |
| `tests/data.test.js`, `tests/mobile-grade.test.js`, `tests/mobile-components.test.js` | 1: A11; 3: A12                                       |

After tonight, the build plan's rule holds: one PR at a time on `shared/data.js`, `teacher/page-assignments.js`, `teacher-mobile/tab-grade.js`, `teacher/dash-class-manager.js`, the script lists and `docs/schema.generated.sql`.

Two traps for any PR that adds or moves a file: `tests/docs-sync.test.js` needs `<script src="/...">` with `src` first (a `defer` before `src` breaks it), and `tests/setup.js` must `load()` any new global script or tests silently lack it.

---

## 5. What the skeptics refuted, so is NOT dead

Leave these alone until someone re-maps them.

**Server functions (all 27 candidates).** `clear_data`, `relink_student`, `get_class_dashboard`, `get_report`, `get_term_rating`, `duplicate_course`, `import_teams_class`, `fv_q_to_percentage` (and the other grade stubs), `rotate_submission_page`, `apply_report_preset`, `_report_preset_defaults`, `toggle_report_block`, `bulk_apply_pronouns`, `bulk_attendance`, `clear_column_scores`, `clear_row_scores`, `fill_rubric`, `delete_category`, `delete_questionnaire`, `duplicate_assessment`, the five `reorder_*` functions, `reorder_roster`, `soft_delete_teacher`. Reasons: several bodies are not in the repo, so callers on the live database cannot be ruled out; migrations patch some by name, so a fresh replay would fail; the local test harness and tests call others; some are kept for planned features (Teams import); every drop changes the live schema and the snapshot check.

**Data-writing paths in `shared/data.js`.** `resetLearningMap`, `setSectionGroup`, `addCustomSection`, `fillRubric`, `clearRowScores`, `clearColumnScores`, `setCellStatus`, `reorderRoster`, `bulkApplyPronouns`, `duplicateAssessment`, `saveAssessmentTags`, `saveCollab`, `createCustomTag`, `createObservationRich`, `updateObservationRich`, the learning-map and category `v2` wrappers, and seven more `v2` wrappers. No app caller, but each saves or deletes data (rule 2), and some anchor live-account tests.

**Grade math in `calc.js`.** `window.Calc` (four tests enumerate it), `completionRing`, `groupGradeGap`/`Diff`/`Value`, `categoryCourseShares`, `calcLetterGrade`, `getSectionTrend`, `skillMonthChange`. Their test cases also cover live math.

**New work behind the build switch.** The exports of `StudentPageView`, `CommentBank`, `DraftsBeforePrint`, `ReportBlocks`, `ReportQuestionnaire`, `StudentCards`, `MAddWork`, `MGradePhotos`, `MMarkUp` and `StudentData`; `GraderWork.heldForRevision`; `undoLastScore` and `gradingOnly` on the phone; `--ev-att-line`; `.lp-pair`. They were added in the last three weeks, sit in files S15, S16 or S18 will change, or are the only check of a behaviour.

**Others.** `renderStatusToggles` (a comment names it), `attentionModel` and `belowCounts` (a test guards them on purpose), `idCardHtml`, `describeStudent`, `renderCopies`, `anonymizeStudents`, `saveCompetencyGroups`, `getQuickObsByDim` and its two siblings (the proposed test cuts were wrong). The hollow phone tests in `mobile-observe` and `MStudents.filterList` (they are the only guard of names the phone shell calls). The two conditional browser-test skips (no one has run them). `.tb-sync-badge` and `.tb-sync-popover` (a test guards their absence). The fixes for `--text-1`, `--color-primary`, `--accent`, `--divider`, `--active-tint` and `--hover-bg` (each changes a colour in dark mode or makes a hidden border draw).

**Not checked by both skeptics.** The unused keys of `PersonalBank`, `ExportAll` and `FactorField`. Not queued.

**Docs.** Moving `codex.md`, `docs/backend-design/`, `grading-compliance-plan.md`, `questionnaire-plan.md`, `comment-bank-audit.md`, the redesign plan or the student-voice plan as written; the `docs/README.md` test; marking DECISIONS entries superseded by rewriting them (the file's own rule is a dated note); deleting the "Waiting for Colin" section of DECISIONS; the stale `gb-*` names in `shared/` and `teacher/` comments; the `teacher/app.html:59` comment (the same claim in `codex.md:431` was missed); the tombstone comments in `dash-class-manager.js` and `report-blocks.js`.

---

## 6. Decisions for Colin

On 2026-11-12 Colin ruled on several of these; see "Handoff review rulings (2026-11-12)" in `docs/DECISIONS.md`. The rows it settles are marked.

The seven open decisions on card cp1, the server change the Nov 2 plan marked "your OK", and what the map raised. Each says what it blocks.

| #   | Decision                                                                                                                                                                                                    | It blocks                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Delete or keep `fullvision-user-inputs.xlsx` and `fullvision-documentation-inventory.xlsx`, and the two `_dev` scripts that build them (with the Apple design rulebook).                                    | The two `_dev` scripts and the rulebook (see the `.xlsx` rule) |
| 2   | Keep or drop `fv_backup.orphan_student_20261012` and `points_zero_20261016` past this term. **Ruled Nov 12: keep.**                                                                                         | Any backup-table migration                                     |
| 3   | Drop any of the unused server functions. Every candidate was refuted as a mechanical change; each needs its own check against the live database. **Ruled Nov 12: none without its own check.**              | Nov 2 item 11                                                  |
| 4   | Staging: a Supabase branch or a small second project. **Ruled Nov 12: held.**                                                                                                                               | S19-D16, S19-F8, a rehearsed restore                           |
| 5   | Keep the repo public or make it private.                                                                                                                                                                    | S19-F3; S19-F2; the held sections of S19-F1                    |
| 6   | Turn on Sentry performance tracing. **Ruled Nov 12: no.**                                                                                                                                                   | S19-C11 (depends on 7)                                         |
| 7   | Keep Sentry in the EU and disclose it, or keep error reports in Canada.                                                                                                                                     | S19-F5, the privacy impact answers in S19-F2                   |
| 8   | Merge `bootstrap_teacher` and `list_teacher_courses` into one boot call.                                                                                                                                    | S19-C8                                                         |
| 9   | The save guard report was wrong: Delete Assessment does not trip it. The two rare cases in which it drops a real mark get a fix that merges once an independent reviewer cannot break it. **Ruled Nov 12.** | S19-B3, then B4 and B5                                         |
| 10  | Send an undone cell once instead of twice.                                                                                                                                                                  | S19-B4, B5                                                     |
| 11  | Finish the review of `87ed0faa` (S0-F1e).                                                                                                                                                                   | S19-B6                                                         |
| 12  | Keep `schema.sql` (the map says keep). **Ruled Nov 12: keep.**                                                                                                                                              | Closes S19-A10; the README's `schema.sql` line                 |
| 13  | Drop the `curriculum_data.js` fallback, accepting that a failed JSON load then shows no courses. **Ruled Nov 12: keep.**                                                                                    | S19-A8                                                         |
| 14  | Move the security headers, then check them with `curl` after the next release.                                                                                                                              | S19-A9, S19-C5                                                 |
| 15  | Test-only and "needs Colin" dead code: keep as test seams, or delete with their tests.                                                                                                                      | S19-A40                                                        |
| 16  | Does the phone get an Undo button for `undoLastScore`, or does it go with its tests?                                                                                                                        | Part of S19-A40                                                |
| 17  | Which criterion level is right when keys are mixed: the desktop's or the phone's? And should the grading order match?                                                                                       | Sharing that code in Track E                                   |
| 18  | Retire the April-era saved-copy readers.                                                                                                                                                                    | S19-B8                                                         |
| 19  | When to make lint and `tsc` able to fail the build.                                                                                                                                                         | S19-D15                                                        |
| 20  | What `*.nsvcs.net` in the content policy is for; the Sentry build credentials; Netlify's Node version; the edge function deploy command.                                                                    | S19-F1 and F2 final versions                                   |
| 21  | Phase 4 (ES modules and splits) with the decision to sell to schools. **Ruled Nov 12: the split goes ahead, safe pieces first.** **Ruled Nov 12: marks may be moved; no change for Colin or Karen.**        | Track E                                                        |
| 22  | Accept or drop each of the five `CLAUDE.md` edits in the S19-A14b draft, and say what has been released.                                                                                                    | S19-A14b                                                       |
| 23  | Whether the `getUser()` sign-in re-check may run alongside the class load instead of before it.                                                                                                             | Faster first draw (Nov 2 Phase 2 #2)                           |

---

## 7. Order of work

The night's queue of Nov 11 to 12 finished. The status lines in section 3 say what happened to each item. The "Tonight" tables below stay as they were written.

**Tonight (the night of Nov 11 to 12).** Seven waves. A wave starts when the one before it is finished (every item merged, opened as a draft, abandoned or skipped) and the wave gate below is green. Inside a wave, PRs run side by side in their own worktrees and merge on their own when `test-and-format` passes.

| Wave | What                                          | PRs                                                  |
| ---- | --------------------------------------------- | ---------------------------------------------------- |
| 0    | What later waves need                         | A1 (this plan), D1 (the port)                        |
| 1    | Leftovers, test fixes, docs, drafts           | A2, A3, A4, A5, A11, A13, D4, B1 (draft), F1 (draft) |
| 2    | Safety nets and pins                          | D2, C1, D5, D6, D7, D10, D11, D12, D13               |
| 3    | Second holders, comments, docs                | D3, A6, A7, A12, A14, A15, A16, A17, B2              |
| 4    | Dead functions and export keys                | A18 to A27, A14b (draft)                             |
| 5    | Dead CSS                                      | A29 to A38                                           |
| 6    | Last: the files another session holds tonight | A28, A39, D8, D9                                     |

**Who does the work.** Fable 5.2 (`claude-fable-5-2`) only orchestrates: it starts each item on the item's own model, runs the wave gate, traces a red `main` and writes the morning report. It runs no item itself. Each item in the queue names its model and effort:

| Model                            | Effort | Items                                                                  | Why                                                                                                                          |
| -------------------------------- | ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Haiku 5.5 (`claude-haiku-5-5`)   | medium | A1, A2, A3, A4, A5, A6, A7, A17                                        | Mechanical edits, each with a scripted proof (a grep, a byte-for-byte build, a token check).                                 |
| Sonnet 5.5 (`claude-sonnet-5-5`) | high   | A11 to A16, A14b, B2, C1, D1, D3, D4, A19 to A25, A27, A28, A29 to A39 | Deletions proved by grep with tests untouched, comment and doc fixes, small test and tool changes.                           |
| Opus 5.5 (`claude-opus-5-5`)     | high   | D2, D5, D6 to D13, A18, A26, B1, F1                                    | Judgment: new tooling, the screenshot harness, the pins, deletions in `data.js` and in modules every page loads, the drafts. |

If an item's agent reports that the work needs more judgment than its model has, the orchestrator may run it once more on Opus 5.5, never on Fable. The usage limits in `docs/DECISIONS.md` (Nov 10, entry 13) still hold.

**Where agents work.** The base repo is `/Users/brown_colin/FullVision`. Each agent makes its worktree with `git -C /Users/brown_colin/FullVision worktree add /tmp/fv-s19/wt/<name> -b <branch> origin/main`, runs `npm ci` in it, and removes it with `git worktree remove` after its merge or draft. Nothing changes in the base repo's checked-out files or under `/tmp/fv-s19/main`.

**Other sessions.** Before wave 0, the orchestrator tells the session that hands out build work which files tonight's queue holds and in which wave: section 4's table, plus `teacher/dash-class-manager.js`, `teacher/page-gradebook.js`, `teacher/page-reports.js`, the `teacher/report-*.js` files, `teacher-mobile/*`, `shared/phone-report-view.js` and `shared/photo-shrink.js` in wave 4. It asks that session to open no PR on a file while tonight's queue holds it. Every item also checks open PRs on its own files before it starts and again before it merges. A file in another session's open PR holds the item.

**The wave gate.** Items end at "merged" or "draft opened"; they do not watch `main`'s browser run. Its concurrency group (`e2e-<ref>-shard-N`, `cancel-in-progress: true`) cancels every run but the newest, so ten merges in a row leave one result. Instead:

1. Before wave 0, the orchestrator runs the browser tests on `main`'s HEAD by hand and records any spec that already fails. That is the baseline.
2. After a wave's last merge, it waits for one completed (not cancelled) browser run on `main`'s HEAD. Green, or failing only baseline specs: the next wave starts.
3. Red: no new item starts. For each merge commit of that wave, it pushes a branch `s19-bisect/<short sha>` at that commit and runs CI on it by hand (`gh workflow run ci.yml --ref s19-bisect/<short sha>`). Each branch has its own concurrency group, so these runs do not cancel each other. The earliest red commit is the cause.
4. If one merge caused it, the orchestrator reverts that PR in one PR (a revert is the only fix allowed tonight), waits for `main` to go green, marks the item abandoned, deletes the `s19-bisect/` branches and carries on. If every bisect run is green, it re-runs `main` once; green means a flaky spec, and the night carries on.

**Attempts, holds and stops.**

- An item gets at most two attempts. A "stop and report" ends it at once: it is abandoned, not retried.
- An item held by another session's open PR is retried every 20 minutes for at most two hours, then skipped. Wave 6 waits at most two hours from its start.
- When an item is abandoned or skipped, every item that depends on it is skipped. For example: A20 if D6 or D7 fails; A21 if any of D10 to D12; A27 if D13; all of wave 5 if D5; A18 if B2; A6, D3 and A26 if D2. The other wave 4 deletions run without D2 and skip their lint step.
- The night ends when a red `main` is not fixed by one revert, when it goes red a second time, or when two items in one wave fail. A "stop and report" or a reviewer's refusal is a finding, not a failure, and does not end the night.
- **A second pair of eyes before merging.** Any PR that changes a file the app, the build or CI uses is not merged by the agent that wrote it. It stops at a green `test-and-format`; an independent reviewer on Opus 5.5 re-checks the diff against the item and the map, re-runs the greps and the item's tests on the rebased result, and merges it or leaves it open with its findings. PRs that touch only docs or tests merge on their own.

**The morning report.** After the last wave, or when the night ends early, the orchestrator writes one report for Colin as a local file (`~/reports/S19 overnight report.md`), not in the repo. Its first lines say: the next release carries every merge since #1182, all of tonight's work included, so releasing anything, a hotfix included, ships it. Then: every merged PR with its merge commit, in merge order, and the order to revert them (newest first); the draft PRs; every abandoned, held or skipped item and why; everything agents listed under "Kept" and "Seen while pinning"; the baseline and `main`'s last browser run, with links; and where the operations guide's held sections are.

**In the morning.** Colin reads the morning report, the drafts (B1, F1, A14b) and the decisions in section 6. Decision 9 first: the guard can drop a real mark in two rare cases.

**Next.** The save-path fixes he approves (B3, B4, B5), then the speed work (C2 to C6), then Track E an area at a time, only as features need it, until the decision to sell.

---

## 8. What is left (reviewed Nov 12, evening; reviewed again on 2026-11-13)

Reviewed against the council on 2026-11-12. Items marked "yours" wait for Colin; the others stand under "I approve whatever the council would approve" (DECISIONS, Handoff review rulings, 4).

### Do now

1. The rubric-attach fix: attaching a rubric to a graded piece must move its marks at once (found Nov 12; no real class was affected). Tests first, independent review, then a release of its own. **Done and released** (PR 1316).
2. The comparison tool's follow-up: the gaps its review found, then a second review. The mark writers wait for it. **Done and released** (PRs 1319, 1327, 1343).
3. This plan's status lines and this list. **Done.**
4. Undefined names fail the build (`no-undef`) in the files split out of `shared/data.js`, then file by file (S19-D15, decision 19). **Partly done:** the `data-*` files are checked; not yet file by file elsewhere.
5. Delete the dead converter layer in `shared/data.js` (about 250 lines) after its two-skeptic check, before more code moves. **Closed:** already gone in PR 1241.
6. A database the repo can rebuild (S19-D16, board card db1): a baseline dumped from the live schema with no student data, proved by rebuilding it on a local PostgreSQL 17. It no longer needs staging. **Done and released** (PR 1325).

### Next, in this order

7. Move the mark writers (statuses, score writes, group grading) out of `shared/data.js`, move only. **Not started.**
8. One mark saves one mark, and only what changed is redrawn (S19-C9). Design first; yours to approve. It carries the phone's 395 ms tap (C10), "send an undone cell once" (B4, yours), making the score send private (B5), and the fix for a tab that is behind saving over newer marks (closed PR 1263). **Partly done:** step 4 is released (PR 1336); step 5 is parked; step 1 is ready; the phone's 395 ms was the recorder, closed.
9. Move Draft and Returned, with a browser test for Return for Revision with the grade hidden. **Not started.**
10. Retire the per-table load (about 900 lines; yours, it changes loading), then move the load path. Delete before moving. **Not started.**
11. The re-key listener moves into the student-work file (approved Nov 12). **Not started.**
12. The small tidyings: generic helpers into utilities, the self-guards, the second `window.v2` init. **Not started.**
13. The operations guide's four public sections (S19-F1), with Colin's answers for its gaps (F7). **Off Colin's list (2026-11-13).**
14. A Content-Type check in the service worker's copy step. **Done and released** (PR 1330).
15. The sign-in re-check runs alongside the class load, and nothing is drawn or sent until both finish (decision 23). **Not started.**
16. Delete the test-only dead code with its tests (S19-A40, decision 15); keep `undoLastScore` for a phone Undo button (decision 16). **Done except `cmShowImportPreview`** (PRs 1350, 1351, 1354); `undoLastScore` kept.
17. `docs/README.md` as an index; the file moves in S19-A41 are dropped. **Not started.**
18. Bring the write-path docs up to date after item 8 (S19-B7). **Waits for item 8.**
19. Rename the package (S19-A6). **Done and released** (PR 1324).

### Only when a feature touches it

20. The page-file pieces (the phone Grade tab's two halves, Class Settings' terms, import and wizard, the Assignments grader dialog and form, the Gradebook table renderers, the Reports Issue dialog, the shared Return for Revision helpers), and a map of `teacher/report-questionnaire.js`. The grader guard must read sub-folders first (S19-D14). **Partly done:** the questionnaire file is mapped and two pieces are out (PRs 1340, 1342, 1344); two pieces are out of the class manager (PRs 1353, 1355).
21. On-save hooks for `_saveCourseField` (yours), with item 8. **Waits for item 8.**

### Trust and recovery

22. A rehearsed restore and monitoring (board cards i42 and i44). Staging is held. **Off Colin's list (2026-11-13).**
23. Two-step sign-in on the GitHub, Netlify, Supabase and Sentry accounts (yours to switch on). Organizations wait for a second person. **Off Colin's list (2026-11-13).**
24. Closed signup (S19-F6). **Off Colin's list (2026-11-13).**
25. Sentry stays in the EU and is disclosed on the privacy page; error reports carry no student data (decision 7). **Off Colin's list (2026-11-13).**
26. The privacy assessment the district will ask for (S19-F2), written privately first. **Off Colin's list (2026-11-13).**

### Dropped or held

27. Moving the security headers (S19-A9) and versioned file names (S19-C5): no gain now.
28. One boot call (S19-C8): measure it with the speed recorder first.
29. Retiring the April-era saved-copy readers (S19-B8): old copies may still be on devices.
30. Serving from the cache with a guard (caching plan): after item 8.
31. Staging, and the live-account tests on a schedule (S19-D17, F8): held.

### Yours, with no council answer

32. Public or private repo (decision 5). Private costs GitHub Actions minutes; public keeps sensitive docs out of the repo. **Off Colin's list (2026-11-13).**
33. The two `.xlsx` files and their scripts (decision 1). **Ruled:** the files stay (DECISIONS, Wave 0 rulings).
34. Which criterion level is right when keys are mixed (decision 17). It is grade math; the council's lean is that every screen shows the level `calc.js` counts. **Closed:** it cannot happen since PR 502.
35. Your review of `87ed0faa` (decision 11), which S19-B6 waits on. **Done**, and S19-B6 with it (PR 1333).
36. Each release. **The latest release is PR 1347.**
