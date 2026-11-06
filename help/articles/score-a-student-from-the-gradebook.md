---
title: Score a Student From the Gradebook
section: Gradebook
order: 2
summary: Any cell in the Gradebook opens the grader for one student on one assessment, where a score is entered or changed. A level or points can also be typed into a selected cell.
checked: 2026-11-05
pages:
  - /gradebook
demo: /gradebook
labels:
  - Gradebook
  - Emerging
  - Developing
  - Proficient
  - Extending
  - Score
  - Complete
  - Incomplete
  - Overall Comment
  - Note for the Report
  - Done
  - Edit Score
  - Clear Score
  - Mark Missing
  - Excuse
  - Mark Late
  - Add Observation
  - Missing
  - Excused
  - Late
  - Undo
  - Comment (Optional)
  - Undo Missing
  - Undo Excuse
  - Undo Late
next:
  - read-the-gradebook
  - record-observations
shots:
  - file: score-a-student-from-the-gradebook.jpg
    route: /gradebook
    steps:
      - 'click #gb-data tr[data-sid] >> nth=6 >> td >> nth=1'
    clip: 170,96,1100,790
---

## Steps

1. Open the **Gradebook** and select the cell where the student's row meets the assessment's column. The grader opens for that student and assessment.
2. Score the work the way the assessment is set up:

- For levels or a rubric, choose **Emerging**, **Developing**, **Proficient** or **Extending** for each competency or criterion. The − and + buttons beside the chosen level add a minus or a plus.
- For points, type the points earned under **Score**. Points above the total, up to twice the total, count as extra credit.
- For Complete/Incomplete work, choose **Complete** or **Incomplete**. Choosing the same mark again clears it.

![The grader open on one student for an assessment scored on two competencies](img/score-a-student-from-the-gradebook.jpg 'The grader for one student. Each competency takes a level.')

3. Each competency or criterion has a **Comment (Optional)** box; **Overall Comment** and **Note for the Report** are below.
4. Choose **Done**. The cell shows the new score.

The arrows beside the student's name, or the ← and → keys, move to the previous or next student on the same assessment. Esc closes the grader.

## Type a Score Into a Cell

1. Select a cell. After the grader closes, the cell stays selected, and the arrow keys move the selection.
2. Type a level from 1 to 4, or the points earned on points work, then press Enter. Enter saves and moves down to the next student. Esc cancels.

A level typed on work scored on several competencies is given to each of them. Rubric and Complete/Incomplete work cannot be typed into a cell; select the cell or press Enter to open the grader.

## Mark Missing, Excused or Late

Right-click a cell to open the cell menu: **Edit Score**, **Clear Score**, **Mark Missing**, **Excuse**, **Mark Late** and **Add Observation**. The grader has the same marks as **Missing**, **Excused** and **Late** at its top right.

- **Mark Missing** and **Excuse** apply only to a cell with no score or feedback. Clear the score first.
- **Clear Score** removes the score. **Undo** in the message that follows puts it back.
- **Undo Missing**, **Undo Excuse** or **Undo Late** in the same menu takes a mark off.
