---
title: Add Your Students
section: Getting Started
order: 2
summary: Students are added to a class one at a time or from a roster file. Their details can be edited later in the student table.
keywords:
  - CSV
  - class list
  - MyEducation BC
checked: 2026-11-05
pages:
  - /dashboard
demo: /dashboard
labels:
  - Class Management
  - Students
  - Add Student
  - First Name
  - Save
  - Save and Add Another
  - Import Roster
  - 'Import Roster: Review Changes'
  - Columns in This File
  - Import
  - In Your Class, Not in This File
next:
  - set-up-grading
  - create-your-first-assessment
shots:
  - file: add-your-students.jpg
    route: /dashboard
    steps:
      - click role=button[name="Class Management"]
      - click main >> text=/^Students/
      - click role=button[name="Add Student"]
    height: 1200
    clip: 252,256,1176,712
---

## Add One Student

1. Open **Class Management** from the Dashboard, select the class, then open the **Students** tab. A new class opens on this tab.
2. Choose **Add Student**.
3. Enter a **First Name** and any other details. Only the first name is required.
4. Choose **Save and Add Another**, or press Enter, to save and start the next student. Choose **Save** to save and close the form.

![The Add Student form on the Students tab](img/add-your-students.jpg 'The Add Student form. Only First Name is required.')

## Import a Roster

A roster file is a CSV file with a header row. Columns are matched by their headings, such as Last Name, First Name and Student Number, in any order. The [roster template](/roster-template.csv) shows every column the import reads.

1. On the **Students** tab, choose **Import Roster** and select the roster file.
2. **Import Roster: Review Changes** lists what the file will add or change. Students are matched by student number, then by name. Under **Columns in This File**, correct any column that was matched to the wrong field.
3. Untick any student who should not be imported, then choose **Import**. Nothing changes until **Import** is chosen.

Students in the class but not in the file are listed under **In Your Class, Not in This File**. They stay enrolled unless ticked.

## Edit Student Details

Select any field in the student table to edit it. Press Enter or ↓ to move down a column, or Tab to move across.
