# Counts As by Step — Plan

Written 2026-10-29. Follows the rubric-weight plan (`~/fullvision-rubric-weight-plan.md`, all merged #496–#499). Nothing here is built. It changes grade math, so the PR needs Colin's review (CLAUDE.md rule 2).

## 1. Why

Counts As today has one box per level, and a + or − is a third of the way to the next level. With the defaults that gives 3+ = 83.3% (a B) and no way to make it 86 (an A). Under BC's letter bands the linear ladder also fails Developing− (41.7%), caps Proficient+ at a B, and puts Emerging at 25%. Colin: "3+ should be 86."

## 2. What changes

Counts As gets a box for every step a teacher can enter: 1, 1+, 2−, 2, 2+, 3−, 3, 3+, 4−, 4 (no 1− or 4+, as D8). Each box is the percent that step counts as in the course %.

```
                 Points to Proficiency        Counts As
                                              −        Whole      +
Extending        [ 86 ] % and up              [ 92 ]   [ 100 ]
Proficient       [ 73 ] % and up              [ 73 ]   [  80 ]    [ 86 ]
Developing       [ 50 ] % and up              [ 55 ]   [  63 ]    [ 67 ]
Emerging         Below 50%                             [  40 ]    [ 50 ]

[ BC Letter Bands ]  [ Match Columns ]  [ Reset to Defaults ]
```

- **Reset to Defaults**: today's ladder, level ÷ 4 with thirds: 100 / 91.7 / 83.3 / 75 / 66.7 / 58.3 / 50 / 41.7 / 33.3 / 25. Every class starts here, so **no grade moves on release**.
- **BC Letter Bands** (new preset): each step on a BC letter band, as proposed 2026-10-29:

  | Step   | 4   | 4−  | 3+  | 3   | 3−  | 2+  | 2   | 2−  | 1+  | 1   |
  | ------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | %      | 100 | 92  | 86  | 80  | 73  | 67  | 63  | 55  | 50  | 40  |
  | Letter | A   | A   | A   | B   | B   | C+  | C   | C−  | C−  | F   |

  Extending is an A, Proficient a B that reaches A with a +, Developing a passing C range, and only plain Emerging fails.

- **Match Columns**: whole levels from the Points to Proficiency column, as now (Emerging 50, or half of Developing's start); each + and − a third of the way between them.
- Each box is a whole number 0–100, and the ten must rise from 1 to 4. Out of order is refused with "Each step must count for more than the one below it."
- The "Shows as Developing" warning stays on the whole levels only. A + at the top of its band (3+ = 86 reads as Extending in the left column) is intended, not flagged.
- A change with a reporting term already ended asks first, as now.

## 3. Math

`levelToPercent(cid, value)` reads the ten steps and goes in straight lines between them. Steps sit at 1, 1⅓, 1⅔, 2, 2⅓, 2⅔, 3, 3⅓, 3⅔, 4, which is where a + or − already puts a level (D8: 3+ = 3.33). So:

- A criterion scored 3+ counts as the 3+ box exactly.
- An average between steps (a competency-scored assessment at 2.889) is that far along between its two neighbouring steps.
- Below 1 it runs down to 0, as now.

With the default boxes this is level ÷ 4 at every point, so the existing course % is unchanged to the last decimal (the linear fast path stays).

Nothing else changes: `_levelPoints`, rubric criteria, `formatLevel`, `formatLevelAs`, `calcLetterGrade` all already go through `levelToPercent`.

## 4. Data

`course.grading_scale.percents` gains the step keys: `{ "4": 100, "4-": 92, "3+": 86, "3": 80, … "1": 40 }`. No migration (jsonb).

A scale saved with only whole-level keys (anything saved since #496) fills its ± boxes by thirds between them, which is exactly what it computes today. `DEFAULT_GRADING_SCALE.percents` gains the ten default steps.

## 5. A History 12 Student

His 54 criterion scores and 4 competency-scored assessments, all in one category on Total Points:

| Ladder          | Course % |
| --------------- | -------- |
| Today (linear)  | 66.2% C  |
| BC Letter Bands | 73.2% B  |

Average of Percentages on the category moves him a little further either way.

## 6. PR

One PR:

- `constants.js` default steps.
- `calc.js` steps in `levelToPercent`, plus the whole-key fallback.
- Class Management Counts As rows with − / whole / + boxes and the BC Letter Bands button.
- Match Columns and Reset for steps.
- Validation, DECISIONS.md (supersedes the "a third of the way" line of Proficiency percents; D8 stays for levels).
- Unit tests: defaults identical to today, BC preset values, between-step interpolation, old whole-key scales.
- A Demo Mode check with screenshots.

## 7. Questions for Colin

1. **Plain Emerging at 40%?** It fails (IE until the course ends). 45 keeps it a fail but closer to a pass.
2. **Should new grade 10–12 classes start on BC Letter Bands** instead of linear? Plan §10.4 kept new classes linear; this preset may be the better default for 10–12.
3. **Should the BC Letter Bands button also set Points to Proficiency** to match (it already agrees with the defaults 86 / 73 / 50), or leave that column alone?
