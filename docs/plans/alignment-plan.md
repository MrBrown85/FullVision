# Alignment plan (2026-11-13)

This plans the work Colin kept on 2026-11-13 to bring FullVision in line with established gradebooks: safer mark saving, a database the repo can rebuild, type checks, smaller files, and the rest of the student page. It follows on from [handoff-review-plan.md](handoff-review-plan.md) (S19) and does not replace it: where an item is an S19 item, S19's method and status lines stand.

Colin, 2026-11-13: plan it on Fable, build it on the models that fit each job, and after each PR and each phase stop and think about what was learned, "so that you don't get stuck in loops or building tools that you don't even need."

## How to read this

- Section 1 is what was checked before starting, and what it changed.
- Section 2 is the rules.
- Section 3 is the order of work, with the model for each item.
- Section 4 is what is parked, and why.
- Section 5 is the log: one line per PR, and a note per phase.

Item numbers (`#1`, `#16`) are the numbers of the list Colin kept. `S19 #n` is an item in section 8 of the handoff review plan.

## 1. What was checked first

Each line is something the first draft of this plan assumed, tested against `main` at `1ab3a6f0`.

| Assumed                                                        | Found                                                                                                                                                                                                                                                                                             | So                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builders can run many at once.                                 | The week's allowance was 54% used with four days left (Fable 47%).                                                                                                                                                                                                                                | At most four agents at a time. Sonnet builds routine work, Opus builds security and grade math and reviews, Fable orchestrates and takes the hardest questions. |
| ES modules (#40) are mostly mechanical.                        | The files in `shared/` are plain scripts whose top-level functions are the globals: `calc.js` has 214, and pages call them by bare name (`getScores` 102 times). 216 test files read source as text and run it. A module conversion would rewrite every caller and the way every unit test loads. | #40 is parked. The checks it was wanted for work without it (see the next two rows).                                                                            |
| Type checks need modules, and real types for `Calc` (#43).     | TypeScript treats plain scripts as one shared scope, so a checked file already sees `calc.js`'s functions. Nothing in the app calls `Calc.x`.                                                                                                                                                     | #43 folds into #45. The `v2: any` line goes when `data.js` is checked.                                                                                          |
| `strict` on the grade math (#42) is a few dozen fixes.         | Full `strict` raises 1,190 errors in three files, nearly all from untyped parameters. Checking for missing values alone (`strictNullChecks`) raises about 66 real ones.                                                                                                                           | #42 is `strictNullChecks` on `calc.js`, `constants.js` and `html.js`. Full `strict` is parked.                                                                  |
| A shared test loader must be built before the splits.          | `tests/setup.js` already has one (`load()`), and a new script must be added to it or tests silently lack it (the S19 plan names this trap).                                                                                                                                                       | Not built.                                                                                                                                                      |
| The service worker's file list should be generated.            | `tests/sw-precache.test.js` fails until a new file is listed, and `scripts/sw-fingerprints.mjs` already works from the list.                                                                                                                                                                      | Not built. The S19 rule holds: one PR at a time on the script lists.                                                                                            |
| `teacher/` needs subfolders (#38).                             | The pieces S19 split out are grouped by file-name prefix (`cm-`, `assign-`, `gradebook-`, `student-`), and 216 test files read source by path.                                                                                                                                                    | #38 is parked. New pieces keep the prefixes. The grader guard's sub-folder fix (S19-D14) is not needed while nothing moves into a folder.                       |
| Speed limits (#49) and coverage (#50) are cheap.               | The speed recorder never fails a run, and nobody has measured how much its numbers move between runs. Unit tests run source as text, so a coverage tool may not see `calc.js`.                                                                                                                    | Both wait for a measurement first (section 4).                                                                                                                  |
| Review of `87ed0faa` (#8) is a choice for Colin.               | The choice was made on Nov 10 ("The one made later"). What is owed is a check that the commit does that.                                                                                                                                                                                          | An independent review does it.                                                                                                                                  |
| The S13 math review and the slips release are owed (#13, #20). | PR 1081 merged on Nov 11 and S13 is done for a real class. The slips fix (S3-S1) was released in PR 1321.                                                                                                                                                                                         | Nothing owed on either.                                                                                                                                         |

## 2. Rules

The rules of `CLAUDE.md`, of the handoff review plan (section 2 and section 4) and of `docs/DECISIONS.md` stand. The ones that matter most here:

1. Nothing is released without Colin's word. Merging to `main` deploys nothing.
2. SQL is shown to Colin before it is applied to the live database.
3. Code that touches marks moves only under "Marks may be moved; Colin and Karen must see no change".
4. A tidying PR changes no behaviour and never mixes with a feature PR.
5. One writer per file at a time. The held files are the script lists (`teacher/app.html`, `teacher-mobile/index.html`, `s/index.html`, `sw.js`, `tests/setup.js`), `package.json`, `.github/workflows/ci.yml`, `shared/data.js`, `teacher/page-assignments.js`, `teacher/dash-class-manager.js`, `teacher-mobile/tab-grade.js` and `docs/schema.generated.sql`.
6. Every PR gets an independent review on Opus or Fable before it merges. A reviewer says whether each finding is one instance or a cause.
7. The repo is public. No PR sets out security gaps beyond what `docs/ROADMAP.md` already says.

What this plan adds:

8. **After each PR, one line in the log** (section 5): what was learned, and whether it changes what comes next or makes a planned item unneeded.
9. **After each phase, reread sections 3 and 4 against the log** before starting the next. Drop or merge items the log has made pointless.
10. **No tool is built until it has been needed twice.** A helper, a generator or a harness waits until the same manual step has cost time on two PRs.
11. **The second fault of the same shape stops the work.** The author names the cause and fixes that, or the item goes back to the orchestrator.
12. **A measurement comes before a gate.** Nothing new may fail a build until its numbers have been watched over several runs.

## 3. Order of work

The longest chain is the one that protects marks: the comparison tool's second review, then the mark writers' move, then one mark saves one mark, then the load path. It starts first and is never left waiting.

Wave 0 (Colin's decisions) is settled in `docs/DECISIONS.md`, "Wave 0 rulings (2026-11-13)".

### Phase 1. Start the chain and add the cheap guards

| Item                                                                                          | Model                     | Notes                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| #23 Second review of the comparison tool (S19 #2)                                             | Opus                      | Plants small mark faults and checks the tool reports each one. It gates every mark-touching move. |
| #1 The design for one mark saves one mark (S19 #8), with #10, B4, B5 and C10                  | Fable, then Opus reviews  | A design document only. Wave 0 ruling 1 says how it is approved.                                  |
| #16 A database the repo can rebuild (S19 #6)                                                  | Opus                      | Proved on a local PostgreSQL 17. Nothing connects to the live database.                           |
| #41 The type check can fail a merge; #36 a file-size limit; the package is named `fullvision` | Sonnet, then Opus reviews | One PR: all three touch `package.json` or `ci.yml`.                                               |
| #8 The check of `87ed0faa`                                                                    | Opus                      | Review only. If it passes, S19-B6 goes ahead in Phase 2.                                          |

### Phase 2. Small fixes, and the first mark-touching move

- #31, first part: the two-skeptic check and deletion of the dead converter layer (S19 #5), then the mark writers move out of `shared/data.js` (S19 #7), under the marks method. Opus.
- #42 `strictNullChecks` on the three checked files, with comment-only fixes. A fix that needs a change to `calc.js`'s code stops and is listed. Opus.
- #48 Tests that one teacher cannot read another's rows, on the rebuilt database (S19-D16). Opus.
- #20 Card follow-ups from `docs/ROADMAP.md` 1.8. Opus builds, Fable reviews. Its SQL is shown to Colin with #21's and #63's in one sitting.
- #22 Tied pieces follow `calc.js`'s order. Opus.
- #51 The service worker checks a file's type before keeping it (S19 #14). Sonnet.
- #12 The phone's Undo button, and #7 one level and one order on desktop and phone (Wave 0 rulings 2 and 4). Sonnet builds, Opus reviews.
- The student-page rulings that need building (Wave 0 ruling 6). Sonnet builds, Opus reviews.
- S19-B6, if #8 passed.

### Phase 3. One mark saves one mark

- #1 and #10, built in the steps its design sets out, under the marks method. Opus builds, Fable reviews. Released on its own, on Colin's word.
- #54 The write-path docs, right after.
- #32 The map of `teacher/report-questionnaire.js`, then its split, a piece per PR. It touches no marks, so it runs beside #1. Sonnet builds, Opus reviews.

### Phase 4. The load path

- #9 Retire the per-table load (S19 #10), then #47 and #52 by one builder: all three change how a class loads.
- The rest of #31: Draft and Returned, and the re-key listener (S19 #9, #11).
- #21 Class settings on two computers, with its approved SQL.
- #33 Split `teacher/dash-class-manager.js`.
- #53 Delete test-only code (S19 #16).

### Phase 5. Assignments and the rest

- #34 Split `teacher/page-assignments.js`, each move through the comparison tool. Then #35 for each split file.
- #45 and #46 Type checks and undefined-name errors, file by file, starting with the `data-*` files. #44 database types when the first `data-*` file is checked.
- #37 The phone's six borrowed files move to `shared/`.
- #57, #59, #63 and what is left of #65.
- Measure, then decide: #49, #50, #40 and #38 (section 4).

## 4. Parked

| Item                             | Why                                                                                   | What would bring it back                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| #40 ES modules                   | Not mechanical (section 1). Type checks and undefined-name checks do not need it.     | After Phase 5, count what the script-tag order still costs. Colin's call then.         |
| #38 Subfolders in `teacher/`     | File-name prefixes already group the pieces; moving 68 files breaks 216 tests' paths. | A second naming scheme that the prefixes cannot hold.                                  |
| Full `strict` on the grade math  | 1,190 errors, nearly all untyped parameters.                                          | `strictNullChecks` is done and JSDoc types have spread.                                |
| #49 Speed limits                 | No one knows how much the recorder's numbers move between runs.                       | The spread over ten runs on `main`. A limit is set outside that spread, or not at all. |
| #50 Coverage of `calc.js`        | Unit tests run source as text, so a coverage tool may not see it.                     | One hour's try. If it does not work as is, it is dropped.                              |
| The curriculum files' move (#39) | They are fetched and precached by path.                                               | A change that already touches those paths.                                             |
| #5 Who owns a class              | Nothing in Phases 1 to 5 needs it.                                                    | The first co-teacher work.                                                             |

## 5. Log

One line per PR: what merged, what was learned, what it changed. A note per phase.

| When         | What                                   | Learned                                                                                                            | Changed                                                                                      |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Nov 13, plan | The checks in section 1, before any PR | Three planned tools were not needed, and two items (#40, #42) were several times larger than the first draft said. | Two enablers dropped; #40 and #38 parked; #42 narrowed; #43 folded into #45; four at a time. |

### Phase 1 and most of Phase 2, Nov 13 (one night)

Merged, in order: PRs 1322, 1323, 1324, 1326, 1325, 1328, 1327, 1330, 1333, 1335, 1332, 1331, 1334, 1337, 1338, 1336. Applied to the live database, on Colin's word: `same_teacher_links`. Nothing was released.

| Item                     | What happened                                                                                                                                 | Learned                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #41, #36, package name   | PR 1324. The type check can fail a merge; big files may only shrink.                                                                          | 26 files are over 1,500 lines, not 14.                                                                                                                  |
| #8                       | The check of `87ed0faa` passed.                                                                                                               | Five screens sorted same-date work by date alone: the same cause as #22.                                                                                |
| #22                      | PR 1326. Same-date work shows in made order on six screens; report ties come newest first, as the comment bank already did.                   | My brief gave no direction for the tie, and the first build chose the wrong one. Briefs now say the direction of every sort and name the rule to match. |
| #16                      | PR 1325. The database's structure rebuilds from the repo and equals live three ways.                                                          | The repo had never been able to rebuild it. The baseline is read from the live catalogs by the read-only CI role.                                       |
| #42                      | PR 1328. Missing-value checks on the grade math, comments only.                                                                               | An identical syntax tree, before and after, is a proof a reviewer can re-run in seconds. It is now asked of every move-only or comment-only PR.         |
| #23                      | PR 1327. The comparison tool lists the mark writers a run reached, and a move names the ones it must reach.                                   | The tool guarded only the actions it performed. One cause, fixed once.                                                                                  |
| #51                      | PR 1330. The service worker refuses a file of the wrong type.                                                                                 |                                                                                                                                                         |
| S19 #5, B6               | PR 1333. One dead function went.                                                                                                              | S19 #5 had already been done by PR 1241. Check a plan's list against `main` before briefing from it.                                                    |
| #48                      | PRs 1335, 1337, 1338. Tests that one teacher cannot reach another's rows, on every PR. They found a real gap, closed by `same_teacher_links`. | The most valuable item of the night. A security finding is built and rehearsed locally and pushed only after it is applied.                             |
| #44, part of #45 and #46 | PRs 1331, 1334, 1332, at Colin's request. Typed globals, database types, typed server calls, a ratchet for `// @ts-check`.                    | No wrapper disagrees with its server function.                                                                                                          |
| #1, step 4               | PR 1336. A tab that is behind no longer clears or reverts another tab's marks.                                                                | The plan was wrong about this item: a level tap already saved one mark, and the phone's 395 ms was the recorder. The real fault was a second tab.       |

What the log changes in section 3:

- **#1 is now three small steps (4, 5, 1) that stop marks being lost.** The design is in draft PR 1329. Its largest step (10b) and the two that sit on it (11, 12) are parked: after the three steps plus 6, 9 and 10a no real class's mark is lost, and the lasting fix is one stored record per cell.
- **S19-C10 is closed.** The phone's tap draws in about 15 ms.
- **Moving the mark writers (S19 #7) is no longer on the path to stopping loss.** It stays in Phase 4 as tidying.
- **A fix cannot be proved by the comparison tool past the first place it acts.** The tool stops at the first difference. Steps that change calls are proved by unit tests and two-page browser specs.
- **One heavy job at a time.** Three browser suites at once made unit tests time out and one run useless.
- **A migration PR takes two pushes.** The first fails the snapshot step and uploads the live snapshot; the second commits it with the refreshed baseline. Until it merges, every other PR fails that step.

### Later the same night

Merged: PRs 1339, 1340, 1341, 1342, 1343, 1344. Nothing was applied to the live database after `same_teacher_links`, and nothing was released.

| Item                         | What happened                                                                                                                         | Learned                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7                           | Nothing to build. Since PR 502 a criterion has one key, so the two screens cannot disagree, and both already list by last name.       | The third stale item of the week. An Opus builder is a dear way to find that out.                                                                                                      |
| The queue                    | One read-only scout checked ten queued items against `main`. Six sub-items were already done, six were ready, the rest need Colin.    | From here a scout checks an item's premise before any builder starts.                                                                                                                  |
| ROADMAP 1.7, Wave 0 ruling 6 | PR 1341. A HEIC photo gets a useful message; a category draft survives the 14-day clean-up; two branches that could not run are gone. | Wording that reaches more than one screen is checked on each: the phone's sentence did not fit the computer.                                                                           |
| The comparison tool          | PR 1343. Its fake server answers the category-list read, so a run's outbox no longer sticks.                                          |                                                                                                                                                                                        |
| #32                          | PR 1340 maps `teacher/report-questionnaire.js`. PRs 1342 and 1344 moved its two cheapest pieces: 9,017 lines to 8,429.                | A piece with no shared state costs about five minutes and 120k tokens, type check included. The next piece reads marks; most of the rest wait on a rewrite of eleven shared variables. |

What this changes in section 3:

- **#7 is closed.** Wave 0 ruling 2 ruled on a case that no longer exists.
- **#32 pauses after two pieces.** Going on means the rewrite in section 6c of [questionnaire-file-map.md](questionnaire-file-map.md), which is a decision, not more of the same.
- **Already true, so off the list:** the phone's term filter uses real terms (#63, first half); Keep Photos Until follows the photos; Mark Up counts as started grading; the revision screens are merged.
- **A scout before a builder** is now the rule for anything taken from a plan's list.

## 6. For Colin

**Yours to do**

1. **Release.** `main` holds the fix for the two-tab loss (PR 1336) and everything else above. It is best released alone.
2. **Until then: one tab per class.** The fault needs two tabs of one browser on one class, offline or with changes waiting, and one of them opened or reloaded in that time.

**Yours to decide**

3. **A loose grant.** The signed-out and signed-in roles may create objects in schema `public`. Nothing uses it and nothing relies on it. The fix is one statement: `revoke create on schema public from anon, authenticated;`.
4. **The phone's Undo.** After a score tap on the phone there is no way back. No design exists for where the control sits or when it shows.
5. **Opened.** Where a teacher sees that a returned piece was opened, and the line the privacy page needs. Today the student page counts a piece as opened when its row has been on screen for 600 ms.
6. **Should the graders follow the roster's sort?** Today both always use last name. Grade Lowest First and Most Missing Work reshuffle as marks go in.
7. **Class Results, "before".** A same-date piece made earlier is never listed as before. The fix is one line in `calc.js` and changes what that card lists.
8. **The questionnaire file's split:** whether to do the rewrite that most of the remaining pieces need.
9. **Card follow-ups that need a deploy or a migration:** drop the IP key's fallback (first confirm the secret is set); a database login for the edge functions that can run only the student functions; hashing the session token in the edge function; a count of unknown card codes.
10. **Settings on two computers:** which of the three per-device choices should follow the teacher (report paper size, the bulk-status choice, the phone-reports choice); a category save checked by the database; the wording for the two "waiting" cases.

**To know**

11. **Report lines.** A Best or Lowest line can name different pieces than before when three or more tie at a mark (PR 1326). No grade changed. The comment bank still prefers a piece on the strongest competency, so the comment and the line can differ when a tie spans competencies.
12. **Not rehearsed:** the student page's own writes on a database with `same_teacher_links`. Every existing student-page row on live fits the rule. If a save is ever wrongly refused, `migrations/local-test/same-teacher-links-stop.sql` takes the rule off.
13. **Found, not started:** a piece made offline takes the time it reached the server; a restored class loses made-order; CI's snapshot does not cover schema `fv_private`; two browser specs fail on this Mac and pass on GitHub (`edit-student-dialog.spec.js:21`, `work-wall.spec.js:69`); the Focus Area pick has no server column, and how a teacher sets it today is not settled.
14. **Mark saving, next:** steps 5 and 1 of draft PR 1329 hold with changes from the second review. The designer folds them in, and they are built one at a time after step 4 has been released and used.
