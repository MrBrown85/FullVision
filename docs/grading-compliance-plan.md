# Grade calculation: bug fixes and Schoology/Teams compliance

Written 2026-10-16. Decisions D1–D7 accepted as recommended the same day.

**Status (2026-10-17): Phase 1 and Phase 2 are implemented and live.**

| Item | Where |
| --- | --- |
| 1.1 Letter from the shown % | `shared/calc.js` `_roundPercent` and `getCourseLetterData` (`shown` → `percentageToLetter(shown)`) |
| 1.2 Grade shown whenever a % exists | `teacher/ui.js` student header gates on `R != null`; `teacher/report-blocks.js` summary likewise |
| 1.3 Rubric custom points | `shared/calc.js` `_rubricAssessmentPoints`, used by `getAssessmentGroupPercentage` |
| 1.4 Category required when categories exist | `teacher/page-assignments.js` ("No Category" offered only when the class has none); move-then-delete in `teacher/dash-class-manager.js`; `migrations/20261016_delete_category_in_use_guard.sql` |
| 1.5 Typed 0 is a score | `shared/constants.js` `parsePointsInput` (blank → null, "0" → 0); `migrations/20261016_points_zero_was_cleared.sql` |
| D1 Weights total exactly 100 | `migrations/20261016_category_weights_exactly_100.sql`; class manager saves the whole list and blocks Save until 100 |
| D2 Per-assessment weight hidden on points work | `shared/calc.js` `getAssessmentWeight` returns 1 for points and Complete/Incomplete |
| D3 Level ÷ 4 | `shared/calc.js` `getAssessmentGroupPercentage` |
| D4 Extra credit to 2× max | `shared/constants.js` `POINTS_EXTRA_CREDIT_FACTOR = 2`; `shared/calc.js` `_assessmentPoints` |
| D5 Drop lowest | skipped, as decided |
| D6 Round to whole % | `migrations/20261016_course_round_percent.sql`; `shared/calc.js` `getRoundWholePercent`; class manager "Course %" control |
| D7 Missing = 0 | kept; `shared/calc.js` `_assessmentPoints` (`NS` → 0) |

Phase 3 golden tests: see `tests/course-percentage.test.js` and related; confirm `tests/grade-reference.test.js` exists before claiming the Schoology and Teams worked examples are covered.

## Reference behaviour

Schoology and Microsoft Teams agree on the core rules. FullVision already matches them on the first four.

| Rule                               | Schoology                                     | Teams                         | FullVision now                  |
| ---------------------------------- | --------------------------------------------- | ----------------------------- | ------------------------------- |
| Category grade                     | points earned / possible ("Total Points")     | points earned / possible      | same                            |
| Course grade                       | Σ(weight × category %) / Σ weights, unrounded | same, weights must total 100  | same, weights ≤ 100             |
| Empty category                     | left out, weight shared out                   | not documented                | left out, renormalized          |
| Excused                            | left out                                      | left out                      | left out (EXC)                  |
| Missing                            | 0 (can be turned off)                         | no auto-zero; teacher types 0 | NS = 0                          |
| Typed 0                            | counts as 0                                   | counts as 0                   | **treated as blank**            |
| No category in a categorized class | not allowed                                   | not allowed (doesn't count)   | **allowed, silently dropped**   |
| Delete a category with work        | blocked until work is moved                   | work keeps its grades         | **work drops out of the grade** |
| Letter vs shown %                  | same value                                    | same value                    | **letter uses unrounded %**     |
| Rubric                             | rubric points count as points                 | rubric total becomes points   | **capped at 4 per assessment**  |
| Score above max                    | allowed (extra credit)                        | not documented                | capped at max                   |
| Drop lowest                        | per category                                  | none                          | none                            |
| Round to whole %                   | optional setting                              | not documented                | always 1 decimal                |
| Per-assessment weight              | none                                          | none                          | 0.5×–3× control, ignored in %   |

## Phase 1: bugs (no teacher-facing decisions)

Each item is its own PR, with vitest cases in `tests/course-percentage.test.js` unless noted. Never merge on a red drift check.

### 1.1 Letter must match the % on screen

`getCourseLetterData` ([calc.js:400](../shared/calc.js)) rounds R for display but takes S from the unrounded value. 171.9/200 shows "86%" with a B.

- Round R once (see D6 for precision) and derive S from that rounded number.
- Strip float noise before rounding (`Math.round(Number((R * 10).toPrecision(12))) / 10`), so 36.98/43 = 85.99999… lands on 86.
- Tests: 171.9/200 → 86 / A; 36.98/43 → 86 / A; 99.9/200 → 50 / C-.

### 1.2 Show the grade whenever a % exists

The student header ([ui.js:509](../teacher/ui.js)) and report summary ([report-blocks.js:117](../teacher/report-blocks.js)) require `overall > 0`, which is proficiency. A points class with no linked competencies has an R but shows nothing / "No Evidence".

- Gate both on `letterData.R != null`. Keep the proficiency fallback only when R is null.
- Tests: points-only class with unlinked assessments renders the letter card and the report %.

### 1.3 Rubric custom points

`getRubricAssessmentScore` ([calc.js:194](../shared/calc.js)) clamps to 4. A criterion worth 10/8/6/4 pts scores Developing (6) as 4/4 = 100%.

- Return both a level-scale value (for Mean/proficiency) and `{ earned, possible }` in rubric points: per scored criterion, earned = level value × weight, possible = level-4 value × weight.
- `getAssessmentGroupPercentage` uses earned/possible for rubric assessments instead of level/4.
- The level-scale value maps each criterion's value back to 0–4 (value / level-4 value × 4) instead of clamping.
- Check `fv_assessment_overall` / `fv_rubric_level_value` on gradebook-prod. If anything still reads their output, apply the same change by migration; if nothing does, note it for Phase 6 cleanup.
- Tests: default 4/3/2/1 rubric unchanged; 10/8/6/4 rubric at Developing = 60%; mixed weights.

### 1.4 Every graded assessment has a category when categories exist

Both reference apps enforce this; FullVision drops the work silently.

- Assessment form ([page-assignments.js:937](../teacher/page-assignments.js)): when the class has categories, remove "No Category" and preselect the first (or the class's default) category. Save is blocked without one.
- Category delete ([dash-class-manager.js:2417](../teacher/dash-class-manager.js)): if any assessment uses the category, ask which category to move them to (Schoology's rule), move them, then delete. Server `delete_category` raises if assessments still reference it, so `on delete set null` can no longer orphan work.
- Existing data: a one-time query on gradebook-prod lists classes with categories and uncategorized assessments. The Grading setup panel shows "N assessments have no category" with a fix-up picker. Do not auto-assign.
- Tests: form validation, delete-with-reassign, R includes reassigned work.

### 1.5 A typed 0 is a score; blank is "no score"

`parsePointsInput` turns 0 into blank, so the only way to give a 0 is Missing.

- `parsePointsInput` returns `null` for blank/unreadable input and `0` for a typed 0.
- `setPointsScore(…, null)` clears the entry (`clearScore`); `setPointsScore(…, 0)` saves 0.
- `isScoreEntered`, `_assessmentPoints`, `getAssessmentOverallScore` and `getTagScores` treat a stored points 0 as graded. Completion scoring already works this way, so this generalizes it.
- **Data migration first:** today a stored points 0 means "cleared". Before the client ships, delete those rows (back them up to `fv_backup.points_zero_20261016`), or they all become zeros. Ship the migration and the client in the same release window, and confirm `upsert_tag_score` accepts 0 for points assessments.
- Tests: typed 0 counts as 0/max; clearing removes the entry; legacy 0 rows gone after migration. Extend `tests/id-rekey-and-points-clear.test.js`.

## Phase 2: compliance (decisions accepted 2026-10-16)

| #   | Decision                        | Options                                                                                     | Recommendation                                                                                                                                                           |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Category weights                | relative, any total (Schoology) / must total 100 (Teams)                                    | **Must total 100 to save.** Today's ≤100 cap lets a class silently run at 80% and renormalize.                                                                           |
| D2  | Per-assessment weight (0.5×–3×) | remove from points work / apply to points too / leave                                       | **Hide it on points and Complete/Incomplete assessments** and label it "Proficiency weight" on proficiency ones. Neither app has it; teachers change max points instead. |
| D3  | Proficiency level → %           | level ÷ 4 (current, chosen Oct 16) / middle of the letter band (Teams' letter-scheme style) | **Keep level ÷ 4.** It's your recent call. Revisit only if a level 1 at 25% (F) causes complaints.                                                                       |
| D4  | Extra credit                    | allow points above max / keep the cap                                                       | **Allow up to 2× max** on points assessments; R can exceed 100%. Input shows a "bonus" hint.                                                                             |
| D5  | Drop lowest per category        | add / skip                                                                                  | **Skip for now.** Teams doesn't have it; low demand.                                                                                                                     |
| D6  | Rounding                        | 1 decimal (current) / class setting "round to whole %"                                      | **Add the class setting, default on for grades 10–12.** BC report cards show whole %, and Schoology has the same toggle. Letter always uses the shown value (1.1).       |
| D7  | Missing = 0                     | keep / add a class switch to turn it off                                                    | **Keep.** It matches Schoology's default.                                                                                                                                |

## Phase 3: verification

- Golden tests in a new `tests/grade-reference.test.js`:
  - Schoology's worked example: 12/13 + 11/13 and 15/17 at 50/50 → 88.35%.
  - Teams' worked example: 10 + 40 pts in a 50% category contribute 5% and 20%.
  - BC boundary cases from 1.1, plus every Phase 1 bug.
- Demo Mode seed (`seed-data.js`) gets one example of each case: rubric with custom points, a typed 0, an excused item, extra credit if D4 lands.
- Check each PR in the Browser pane on a Netlify deploy preview with Demo Mode: gradebook column %, student header, report preview, printed report.
- Drift check green on every PR; DB changes tested in `begin … rollback` while impersonating a teacher.

## Order

1. 1.1 + 1.2 (one small PR, display only)
2. 1.3 rubric points
3. 1.4 category integrity (client + `delete_category` migration)
4. 1.5 real zero (migration + client, same window)
5. Phase 2 items, after decisions D1–D7

Out of scope: grading periods/terms, mastery decaying-average changes, SIS sync.
