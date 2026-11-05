---
title: Build and Grade With a Rubric
section: Assignments
order: 2
summary: A rubric describes each level of the work, one row per criterion. A criterion linked to a competency scores that competency.
checked: 2026-11-05
pages:
  - /assignments
demo: /assignments
labels:
  - + New Assessment
  - Scoring
  - Rubric
  - Blank Rubric
  - Name This Rubric
  - Standard
  - Advanced
  - Single-Point
  - + From Competency
  - + Add Criterion
  - + Competency
  - Save Rubric
  - Create Assessment
  - Rubrics
  - Rubric Bank
  - + New Rubric
  - Assignment Title
  - Category
  - Standard Rubric
  - Advanced Rubric
  - Single-Point Rubric
  - Competencies assessed
  - Use in New Assessment
  - Choose a Rubric
  - Set Everyone To
  - Comment
  - Save
  - Save and Next Criterion
  - Work On
  - Went Beyond
next:
  - grade-an-assessment
  - read-the-gradebook
shots:
  - file: build-and-grade-with-a-rubric.jpg
    route: /assignments
    steps:
      - click role=button[name="+ New Assessment"]
      - fill main >> input[placeholder^="e.g. Persuasive"] | Density Lab
      - select main >> select:has(option:text("Choose a Category")) | Labs & Investigations
      - click role=button[name="+ Choose Competencies"]
      - click .af-comp-dialog >> text="Data Recording"
      - click role=button[name="Done"]
      - fill input[placeholder="Name This Rubric"] | Density Lab Rubric
      - click role=button[name="+ From Competency"]
      - click .af-ge-card >> text="Data Recording"
      - wait 500
      - click role=button[name="+ From Competency"]
      - click .af-ge-card >> text="Unit Conversions"
      - wait 500
      - scroll .af-ge-card
    clip: 252,170,1176,500
---

## Build a Rubric in the New Assessment Form

1. On the Assignments page, choose **+ New Assessment**. Enter an **Assignment Title** and choose a **Category**; the assessment cannot be created without one. **Rubric** is selected under **Scoring**, with the **Blank Rubric** editor open.
2. Enter a name in **Name This Rubric**.
3. Choose a style: **Standard** (one descriptor per level), **Advanced** (checkboxes inside each level) or **Single-Point** (the Proficient standard only).
4. Choose **+ From Competency** and select a competency. The competency's wording fills a criterion's four levels. Repeat for each criterion.
5. To write a criterion, choose **+ Add Criterion**, enter its name and type each level's descriptor. **+ Competency** under the name links it to a competency.
6. Choose **Save Rubric**, then **Create Assessment**.

![The Blank Rubric editor with two criteria added from competencies](img/build-and-grade-with-a-rubric.jpg 'A Standard rubric with Data Recording and Unit Conversions added from competencies.')

## Build a Rubric in the Rubric Bank

1. On the Assignments page, choose **Rubrics**. The **Rubric Bank** lists the class's rubrics.
2. Choose **+ New Rubric**, then **Standard Rubric**, **Advanced Rubric** or **Single-Point Rubric**.
3. Enter the name. For each criterion, select its **Competencies assessed** and type the level descriptors. Add rows with **+ Add Criterion** or **+ From Competency**.
4. Choose **Save Rubric**.

To use a saved rubric, select it in the Rubric Bank and choose **Use in New Assessment**, or choose **Choose a Rubric** in the New Assessment form.

## Score With the Rubric

1. Open the assessment on the Assignments page. Each student has a line for each criterion.
2. Select a level on each line. On an Advanced rubric, tick the boxes the work shows; the highest level whose boxes are all ticked is suggested, and any level can be chosen instead. On a Single-Point rubric, type notes under **Work On** and **Went Beyond**.
3. To add a note to one criterion, choose **Comment** at the end of its line, type the note, then choose **Save** or **Save and Next Criterion**. The note prints under that criterion on the rubric handout.
4. To score the whole class, choose a level in the **Set Everyone To** row and confirm. Only criteria not yet scored are set.
