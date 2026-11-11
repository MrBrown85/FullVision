---
title: Create Your First Assessment
section: Getting Started
order: 5
summary: An assessment is one piece of student work, scored against the competencies it shows. Its scores appear in the gradebook and on reports.
checked: 2026-11-05
pages:
  - /assignments
demo: /assignments
labels:
  - Assignments
  - + New Assessment
  - Assignment Title
  - Category
  - Date Assigned
  - Due Date (optional)
  - Competencies
  - + Choose Competencies
  - Done
  - Scoring
  - Rubric
  - Points
  - Complete/Incomplete
  - Use This Rubric
  - Students
  - Choose Students
  - Create Assessment
next:
  - set-up-grading
shots:
  - file: create-your-first-assessment.jpg
    route: /assignments
    steps:
      - click role=button[name="+ New Assessment"]
      - fill main >> input[placeholder^="e.g. Persuasive"] | Density Lab
      - select main >> select:has(option:text("Choose a Category")) | Labs & Investigations
      - click role=button[name="+ Choose Competencies"]
      - click .af-comp-dialog >> text="Data Recording"
      - click role=button[name="Done"]
    clip: 264,120,1152,662
---

## Steps

1. Open **Assignments** and choose **+ New Assessment**.
2. Enter an **Assignment Title**. If the class has categories, choose a **Category**; without one, the assessment does not count toward the grade. **Date Assigned** starts as today and **Due Date (optional)** a week later. Change either if needed.
3. Under **Competencies**, open **+ Choose Competencies**, tick the competencies the work shows, then choose **Done**.
4. Under **Scoring**, choose **Rubric**, **Points**, **Complete/Incomplete** or **Competencies**. With **Rubric**, a rubric is drafted from the chosen competencies. Choose **Use This Rubric** to save it as a named rubric. Without it, the assessment is scored by competency.

![The New Assessment form with a title, a category and one competency chosen](img/create-your-first-assessment.jpg 'A new assessment with one competency chosen and its rubric drafted.')

5. Under **Students**, every student in the class is included. To include only some students, use **Choose Students**.
6. Choose **Create Assessment**. The assessment opens, ready to score.
