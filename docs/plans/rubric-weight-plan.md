# Rubric Weight and Proficiency to Percent — Plan

Written 2026-10-29 from the competitor research (`~/reports/Rubric weight in competitor gradebooks.md`) and one History 12 student's grade. Nothing here is built. Both pieces change grade math, so each needs Colin's review before it merges (CLAUDE.md rule 2).

## 1. Summary

Two settings, independent of each other, both off by default so no existing grade moves:

1. **Category Calculation** — per category, _Total Points_ (today) or _Average of Percentages_. Fixes the rubric-size problem: a 5-criterion Current Events week stops weighing 2.5× a 2-criterion assignment.
2. **Proficiency to Percent** — a second column in the existing _Points to Proficiency_ setting, giving the percent each level counts as in the course %. Replaces the fixed level ÷ 4 (3 = 75%) and the dead `qToPercentage` table in `shared/calc.js`.

Together they supersede DECISIONS.md D3 ("A proficiency level counts as level ÷ 4"). Linear stays the default, so D3 remains the behaviour of every class until a teacher changes it.

## 2. What it does to one student

One student, 20th Century World History 12, 26 scored assessments, all in _Assignments, Projects, & Papers_ (45%). His Points to Proficiency table is Extending 96 / Proficient 84 / Developing 62.

| Settings                                                   | Course % | Letter |
| ---------------------------------------------------------- | -------- | ------ |
| Today: Total Points, linear (3 = 75%)                      | 66.2     | C      |
| Average of Percentages, linear                             | about 68 | C+     |
| Total Points, percents matched to his table (96 / 84 / 62) | about 76 | B      |
| Average of Percentages, matched table                      | about 77 | B      |

The two settings move him in different ways. The first corrects the weight of Current Events (his weakest work, 88 of his 232 possible points). The second corrects what "Proficient" is worth: his levels are mostly 2+ and 3−, and under the matched table 3− counts 76.7% instead of 66.7%.

## 3. Decisions to record in DECISIONS.md

Add under a new dated heading, "Category calculation and proficiency percents (2026-10-29)":

- **Each category has a Calculation: Total Points (default) or Average of Percentages.** Total Points pools every assessment's points earned and possible, as now. Average of Percentages converts each assessment to a percent first and averages them, each counted its Factor times. A class with no categories stays on total points.
- **Each proficiency level has a percent it counts as in the course %**, set per class under Points to Proficiency. Default 100 / 75 / 50 / 25, which is today's level ÷ 4. Supersedes D3.
- **A + or − is a third of the way to the next level's percent.** 3+ at 84 / 96 is 88%. Same as D8's "3+ counts as 3.33" expressed in percent. 4+ and 1− don't exist.
- **Rubric criteria with custom point values keep their points.** The percent column applies only to criteria on the standard 1–4 values. A teacher who typed 10 / 7 / 4 / 1 chose those on purpose.
- **Changing either setting changes the % of every term, including terms already reported.** The save warns. No snapshot of issued reports exists today; that stays a separate piece of work.

## 4. Setting A — Category Calculation

### Where it lives

Class Management → class → Categories. Each category row gets a calculation picker after the weight. The uncategorised row has none (it is left out of the % already).

```
Categories

⋮⋮  Assignments, Projects, & Papers   [ 45 ] %   Calculation: ( Total Points ▾ )   ✕
⋮⋮  Tests & Quizzes                   [ 35 ] %   Calculation: ( Total Points ▾ )   ✕
⋮⋮  Participation                     [ 20 ] %   Calculation: ( Average of Percentages ▾ )   ✕

    + Add Category   Copy From Another Class                       100%   [ Save ]
```

Picker options and their hints (shown under the picker for the selected one):

- **Total Points** — "Points earned out of points possible. A rubric with five criteria is worth 20 points; one with two is worth 8."
- **Average of Percentages** — "Each assessment becomes a percent and they are averaged. Every assessment counts the same, whatever its points. Factor still counts an assessment more than once."

The existing copy "No categories yet. Letter grades use total points earned out of total points possible." stays true and stays.

### Math

In `getCourseLetterData` (`shared/calc.js`), per category:

- **Total Points:** `getAssessmentGroupPercentage` as now.
- **Average of Percentages:** for each scored assessment, `pct = earned / possible × 100` using the same earned/possible that Total Points would pool (points work, rubric points, level percent), then `R = Σ(factor × pct) / Σ(factor)`. Missing counts as 0% (D7). Excused is left out. An unscored assessment is left out.

`assessmentGroupGrade` and `classAssessmentGroupGrade` (student page group grades, class comparison) take the category's mode when the group is a category, and Total Points otherwise (a module, an assignment type, a rubric's assessments). Open question in §10.

### What it does not touch

- Competency proficiency, category _level_ averages (`getCategoryAverage`), the Breakdown, report-card proficiency words. Those are level means already; each assessment already counts once there.
- The gradebook column and Class Average row, which show the assessment's own points.
- Category weights, Factor, rounding, IE.

### Data

- `category.calc_mode text not null default 'points' check (calc_mode in ('points','percent'))`. Migration `20261029_category_calc_mode.sql`.
- `save_categories(p_course_id, p_categories)` reads an optional `calc_mode` per row; absent means `'points'`, so old clients keep working.
- The class bundle (`fv_load_class` / `_v2GradebookToCache`) carries it; `getCategories` rows gain `calcMode`.
- Demo Mode seed: all `'points'`.
- Server grade calc is isolated and returns null (`fv_legacy`), so nothing server-side computes with it.

## 5. Setting B — Proficiency to Percent

### Where it lives

The existing _Points to Proficiency_ block in Class Management gains a second column. One block, two directions.

```
Points and Proficiency

A points score becomes a proficiency by its percent, and a proficiency
counts as a percent in the course %.

                 Points to Proficiency        Counts as
Extending        [ 96 ] % and up              [ 100 ] %
Proficient       [ 84 ] % and up              [  75 ] %   ⚠ Below Proficient's own 84%
Developing       [ 62 ] % and up              [  50 ] %   ⚠ Below Developing's own 62%
Emerging         Below 62%                    [  25 ] %

[ Match Columns ]   [ Reset to Defaults ]
```

- **Counts as** defaults to 100 / 75 / 50 / 25 for every class, new and old. That is today's math, so nothing moves on upgrade.
- **Match Columns** fills _Counts as_ from the left column: Extending = its own floor + half the gap to 100 (96 → 98), Proficient and Developing = their own floor (84, 62), Emerging = 50, the C− floor, so a Developing student with one Emerging score stays at a pass (Colin, 2026-10-29). If Developing's floor is 50 or lower, Emerging = half of it. It is a button, not automatic, so a teacher sees the numbers before they apply. Values stay editable after.
- **Reset to Defaults** resets both columns (86 / 73 / 50 and 100 / 75 / 50 / 25).
- **Round-trip warning** (⚠): shown beside any _Counts as_ value that falls outside that level's own band in the left column. It is a warning, not a block: linear defaults trip it on day one in any class whose thresholds are above 75 / 50, which is honest. Hint text under the warning: "A student who is Proficient on every assessment would show as Developing."
- Inputs: whole numbers 0–100, each strictly higher than the level below. Same validation style as the left column.

### Math

`levelToPercent(cid, level, mod)` in `shared/calc.js`:

- Whole level: the level's _Counts as_ value.
- With +: `value + (next level's value − value) / 3`. With −: `value − (value − previous level's value) / 3`. Same thirds as `normalizeScoreMod`.
- Used wherever a level becomes a percent today:
  - `getAssessmentGroupPercentage`: `earned += factor × levelToPercent / 100 × 4; possible += factor × 4` (possible stays 4 so levels and points pool as now).
  - `_rubricAssessmentPoints`: a criterion on the standard 1–4 values contributes `levelToPercent(level, mod) / 100 × 4 × weight`; a criterion with `levelValues` set contributes its points as now.
  - `calcLetterGrade` (Letter Grade from an average level): `levelToPercent` of the mean, interpolating between whole levels, instead of `qToPercentage`.
- Not used for points work (its percent is earned / possible) or Complete/Incomplete (1 / 1).

### Data

- `course.grading_scale` jsonb gains `percents: { "4": 100, "3": 75, "2": 50, "1": 25 }` beside `boundaries` and `labels`. No migration: the column already takes any object, and `getGradingScale` fills missing `percents` with the defaults. `DEFAULT_GRADING_SCALE` in `shared/constants.js` gains the same.
- `cmSavePointsScale` saves both columns in one write.

## 6. Removing `qToPercentage`

`qToPercentage` (55 / 68 / 82 breakpoints) is reached only through `calcLetterGrade`, which nothing in `teacher/`, `teacher-mobile/` or `shared/data.js` calls. Its only callers are `tests/calc-pure.test.js` and `tests/letter-grade-ie.test.js`.

- Delete `qToPercentage` and its export.
- `calcLetterGrade(avgProf, cid)` reads `levelToPercent(cid, …)`; with no class it uses the defaults, so `calcLetterGrade(3.0)` becomes `{ letter: 'B', pct: 75 }` instead of 82.
- Rewrite the `calcLetterGrade` tests to the new values. The IE test is unaffected.

## 7. The reported-terms warning

Both saves (`cmCatSave` when a mode changed, `cmSavePointsScale` when a _Counts as_ value changed) use `showConfirm` first when the class has a reporting term that has ended:

> **Change the course %?**
> This changes the course % for every term, including Term 1, which has already ended. Report cards printed before today will not match.
> [ Cancel ] [ Change ]

No warning when no term has ended. The warning is the whole of this piece; a snapshot of issued reports is not in this plan.

## 8. Where it shows

- **Assignment editor and grader:** under the rubric or scoring picker, one line: "Counts as 20 points in Assignments, Projects, & Papers" (Total Points) or "Counts as 1 assessment in Participation, like every other" (Average of Percentages). Reads the category's mode and the rubric's criterion count. This is the part that makes the weight visible; it is why The student's number was a surprise.
- **Gradebook footer / Class Insights:** nothing new. The course % already comes from `getCourseLetterData`.
- **Phone app:** reads the same settings through `calc.js`; no new UI. Class Management is desktop-only.
- **Reports:** nothing new; the % is the %.

## 9. PRs

Each one green on vitest, prettier and the grader/gradebook e2e specs before merge; one per change.

1. **`levelToPercent` and the Counts as column.** `constants.js` defaults, `calc.js` function and its three call sites, `qToPercentage` removed, `calcLetterGrade` tests rewritten, new unit tests (whole levels, +/−, custom `levelValues` untouched, defaults equal today's numbers), Class Management second column with Match Columns and the round-trip warning, the reported-terms confirm. Grade math: Colin reviews.
2. **Category calc mode: data.** Migration, `save_categories`, class bundle, `getCategories`, seed. Migration SQL shown to Colin before it is applied (rule 1).
3. **Category calc mode: math and settings.** `getCourseLetterData` branch, `assessmentGroupGrade` for categories, Categories picker and hints, the reported-terms confirm, unit tests (A matching fixture: 20-point and 8-point rubrics, 66.2 → 68), an e2e test that switches a category and checks the gradebook footer. Grade math: Colin reviews.
4. **"Counts as" line in the assignment editor and grader.**
5. **DECISIONS.md entry and `docs/grading-compliance-plan.md` status row.** Can ride with PR 3.

PR 1 and PRs 2–3 are independent and can go in either order.

## 10. Decisions (Colin, 2026-10-29)

1. **Emerging's "Match Columns" value is 50**, the C− floor, so a Developing student with one Emerging score still passes.
2. **Group grades on the student page** (by module, by assignment type, by rubric) use Total Points. Only a category uses its own mode.
3. **Average of Percentages flattens points work too.** A 10-point quiz and a 36-point unit test count the same in a category on that mode, as in MyEd BC's "Categories Only". Factor is the way to count one more.
4. **New classes start on Total Points and linear.** Nothing changes for anyone until a teacher changes it.
