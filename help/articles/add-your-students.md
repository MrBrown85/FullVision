---
title: Add Your Students
section: Getting Started
order: 2
summary: Students are added to a class one at a time or from a roster file. Their details can be edited later in the student table.
keywords:
  - CSV
  - roster
  - import
  - class list
  - MyEducation BC
checked: 2026-11-11
pages:
  - /dashboard
demo: /dashboard
labels:
  - Class Settings
  - Students
  - Add Student
  - First Name
  - Save
  - Save and Add Another
  - Add Your Students
  - Choose File
  - Download Template
  - Import Roster
  - Change What's Kept
  - Check How Your File Was Read
  - Read
  - Best Guess
  - What This File Will Change
  - In Your Class, Not in This File
  - Save Changes
  - Show Them
  - Undo This Import
next:
  - set-up-grading
  - create-your-first-assessment
shots:
  - file: add-your-students.jpg
    route: /dashboard
    steps:
      - click role=button[name="Class Settings"]
      - click main >> text=/^Students/
      - click role=button[name="Add Student"]
    height: 1200
    clip: 252,256,1176,712
---

## Add One Student

1. Open **Class Settings** from the Dashboard, select the class, then open the **Students** tab. A new class opens on this tab.
2. Choose **Add Student**.
3. Enter a **First Name** and any other details. Only the first name is required.
4. Choose **Save and Add Another**, or press Enter, to save and start the next student. Choose **Save** to save and close the form.

![The Add Student form on the Students tab](img/add-your-students.jpg 'The Add Student form. Only First Name is required.')

## Import a Roster

A class list from MyEducation BC goes in as it is: [Get a Class List From MyEducation BC](get-a-class-list-from-myeducation-bc) shows where to find it. Any spreadsheet saved as CSV works too. FullVision reads the file on the computer; the file isn't uploaded.

1. Open the **Students** tab. A class with no students shows **Add Your Students**: choose **Choose File**, or drop the file there. A class that has students has **Import Roster**, which opens a strip to drop the file on, with **Choose File** and **Download Template**.
2. A file whose columns FullVision all knows, such as a MyEd class list or the template, goes straight to Ready to Add, with nothing to match. It names the columns it leaves out, such as Grade and Gender. **Change What's Kept** shows its columns.
3. Any other file opens **Check How Your File Was Read**. Above each of the file's columns is what FullVision will do with it, over the first rows: **Read** when its heading was known, **Best Guess** when it was read from the values. Choose a column's button to change it; each choice says what it takes. A column that looks like designations is left out unless it is chosen.
4. Rows with a date that isn't real, a student number used twice, or no name are listed under the columns. Nothing there stops the import: the student is added with that field blank. Type a fix in the row's box, or fill it in later in the student table. A row with no name is left out until a name is typed.
5. Untick anyone who shouldn't be added, then choose the button that adds them, such as Add 27 Students.

Importing into a class that has students opens **What This File Will Change**: new students, name changes and updated details. Students are matched by student number, then by name. Students in the class but not in the file are listed under **In Your Class, Not in This File**; they stay enrolled unless ticked. Nothing changes until **Save Changes**.

After an import, a panel says what changed. If a student was added with a blank, **Show Them** lists only those students. **Undo This Import** removes the students the import added, while the panel is open, unless something has already been recorded for them.

## Edit Student Details

Select any field in the student table to edit it. Press Enter or ↓ to move down a column, or Tab to move across.
