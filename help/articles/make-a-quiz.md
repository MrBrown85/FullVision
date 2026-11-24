---
title: Make a Quiz
section: Assignments
order: 3
summary: A quiz is a way students do an assessment. The teacher writes the questions on the assessment, students answer on their Student Page, and the teacher confirms the suggested levels before anything counts.
checked: 2026-11-24
pages:
  - /assignments
demo: /assignments
keywords:
  - quiz
  - questions
  - answers
  - confirm
  - tries
labels:
  - Student Work
  - They Answer a Quiz
  - Add Question
  - Choice
  - True or False
  - Number
  - Text
  - Multiple Answers
  - Right Answer
  - Why the Right Answer Is Right
  - Points
  - Competency
  - Counts Toward No Competency
  - Done
  - Evidence by Competency
  - Quiz Settings
  - Shuffle Questions
  - Shuffle Choices
  - Tries
  - Counts
  - When Returned, Students See
  - Grade Only
  - Grade and Which Were Right
  - Grade, Which Were Right and the Answers
  - Add a Total
  - Within
  - One
  - Two
  - Unlimited
  - Best
  - Latest
  - Preview as a Student
  - By Competency
  - By Question
  - By Student
  - Suggested Levels
  - Short Answer to Assess
  - Too Few Questions
  - Reopen
  - Confirm
  - Undo
  - Assign
  - Download All My Data
next:
  - grade-an-assessment
  - where-your-data-lives
shots:
  - file: make-a-quiz.jpg
    route: '/assignments?course=sci8&edit=sci8-quiz-data-patterns'
    steps:
      - wait 800
    selector: '#quiz-mount'
  - file: make-a-quiz-results.jpg
    route: /assignments
    steps:
      - click [data-action="openQuizResults"][data-aid="sci8-quiz-plant-growth"]
      - wait 800
    selector: '.quiz-results-overlay'
  - file: make-a-quiz-student.jpg
    route: '/s/#demo-card'
    width: 390
    height: 844
    steps:
      - click role=button[name="Continue"]
      - 'fill #sp-ident | 1234567'
      - click role=button[name="Yes, That’s Me"]
      - click .sp-tabs-bottom [data-tab="assignments"]
      - wait 600
    selector: '.sp-piece[data-piece="demo-quiz-check"]'
---

A quiz is a way students do an assessment, not a new kind of grade. The assessment keeps its competencies, its category and its scoring. Students answer the questions on their Student Page, and the teacher sees the answers by student, by question and by competency. A suggested level counts nowhere until the teacher confirms it.

A quiz needs the class's Student Page to be on in Class Settings.

## Write the Questions

1. On the assessment form, find the **Student Work** card and choose **They Answer a Quiz**. The Quiz card opens under it.
2. Choose **Add Question**. Choose the kind: **Choice**, **True or False**, **Number** or **Text**. Type the question.
3. Set the **Right Answer**. For a choice question, press the button beside each right choice; turn on **Multiple Answers** when several are right, and a student then gets the points only by choosing every right answer and no other. For a number, **Within** is how far off an answer may be and still be right. A **Text** question has no right answer: the teacher assesses each one.
4. Add a reason in **Why the Right Answer Is Right** if students are to read it once the quiz comes back.
5. Set the **Points** and the **Competency** the question counts toward, or choose **Counts Toward No Competency**. Then choose **Done**.
6. Choose **Preview as a Student** to see the questions as students see them. Nothing in the preview is saved or sent.

![The Quiz card on the assessment form, with its questions, the competency each counts toward and the quiz's settings beside them](img/make-a-quiz.jpg 'A quiz is written on the assessment form. Evidence by Competency counts the questions toward each competency.')

A competency needs at least three questions before a level is suggested for it. **Evidence by Competency** beside the questions shows how many each has. Points on a question are whole numbers.

## Settings

**Quiz Settings** has these choices.

- **Shuffle Questions** and **Shuffle Choices** are on to start. Each try is shuffled again.
- **Tries** is **One**, **Two** or **Unlimited**. With more than one, **Counts** sets whether the **Best** try or the **Latest** one counts. Only one try counts, never a mix of two.
- **When Returned, Students See** is **Grade Only**, **Grade and Which Were Right**, or **Grade, Which Were Right and the Answers**. **Add a Total** shows the points beside the grade, such as 7 of 10.
- The Student Work card's row for the due date sets whether a quiz can still be answered after it.

Students do not see a quiz until the assessment is assigned. Choose **Assign** when it is ready. A quiz with answers in keeps its questions' kinds and choices; the words, the points, the competency and the key can still be changed.

## How Students Answer

On the Student Page, a quiz piece on Assignments has a Start the Quiz button. Each answer saves as the student goes, so the quiz can be left and finished on another phone; the button then reads Carry On with the Quiz. Send Answers sends the quiz. With more than one try, Try Again starts the next one after a try is sent. A quiz past its last day reads Closed.

![A quiz on the Student Page's Assignments list, with its Start the Quiz button](img/make-a-quiz-student.jpg 'On a phone, the quiz is a card on Assignments.')

The right answers never reach a student's phone before the quiz is returned to that student, and then only if the quiz shows answers. FullVision does not time a quiz or watch what a student does on their phone.

## Results and Confirm

When students have sent answers, the assessment's card shows a line such as 18 Answered · Confirm Levels. Select it to open the results.

- **By Competency** shows the suggested level for each competency, as a dashed level until it is confirmed, with the figures behind it. Pick a level, then step it up or down.
- **By Question** lists each question with every student's answer to it.
- **By Student** shows each student's tries and answers.

A **Text** answer waits as a **Short Answer to Assess** until the teacher gives it points; the level it feeds waits too. A competency with fewer than three questions reads **Too Few Questions**. With more than one try, the results show which try counts, and both.

**Reopen** gives one student one more try, even after the quiz closes. It asks first.

Choose **Confirm** to write the levels, or the scores on a quiz scored in points. It asks first, naming what moves, and the scores it writes are ordinary scores, as if each had been entered by hand. **Undo** puts back exactly what was there. A suggestion never counts without Confirm, in any class, including one that saves grades as soon as they are entered. Grades then follow the class's Return Grades setting, as any other grade does.

![The results of a quiz, with the suggested level for each competency and the Confirm button](img/make-a-quiz-results.jpg 'Suggested levels are dashed until Confirm writes them.')

## What Students See When It Comes Back

A returned quiz shows the grade in the class's style and the teacher's comment. Depending on the setting, it also shows which questions were right, the right answers and the reason for each. A question reads Right, Partly Right, Not Right or Not Assessed Yet. A student sees only their own answers.

## Copying, Backups and Downloads

Copy Assessment, Copy to Another Class and Duplicate carry the quiz's questions, key and settings, never any student's answers. A class backup does not hold quizzes, and says so; Restore Class from Backup says the same. **Download All My Data** has two quiz sheets, Quizzes and Quiz Answers, with the questions, the right answers and each student's answers. The file is the teacher's own, so it holds the right answers.
