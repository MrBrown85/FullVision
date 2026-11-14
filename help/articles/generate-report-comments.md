---
title: Generate Report Comments
section: Reporting
order: 2
summary: Generate Comment drafts a report comment from the Comment Bank's written sentences, filled in from the student's grades, work habits and Student Voice. No AI writes the text, and a sentence is used only when the student's record supports it.
checked: 2026-11-05
pages:
  - /reports
demo: /reports
labels:
  - Term Questionnaire
  - Work Habits
  - Generate Comment
  - Teacher Comment
  - Undo
  - Sentences
  - Options
  - Remove From Comment
  - Browse Sentences…
  - Use
  - + Write Your Own
  - Support
  - Choose…
  - Closing
  - Add One…
  - Save for Class
  - Approve and Next
next:
  - print-report-cards
  - getting-ready-for-report-cards
shots:
  - file: generate-report-comments.jpg
    route: /reports
    steps:
      - click .qn-hs-stop[data-habit="completes"][data-value="4"]
      - click .qn-hs-stop[data-habit="ready"][data-value="3"]
      - click .qn-hs-stop[data-habit="others"][data-value="4"]
      - click .qn-hs-stop[data-habit="part"][data-value="4"]
      - click .qn-hs-stop[data-habit="feedback"][data-value="2"]
      - click .qn-hs-stop[data-habit="devices"][data-value="3"]
      - click role=button[name="Generate Comment"]
      - wait 4500
    clip: 252,104,1176,700
---

## Steps

1. In the **Term Questionnaire**, select a student and rate the six **Work Habits**. Habits left blank are left out of the draft.
2. Choose **Generate Comment**. The draft replaces the text under **Teacher Comment**. It opens with the student's grade, then adds sentences on the best piece, strengths, habits, missing work and a next step when the record supports them.
3. Choose **Generate Comment** again for another version. Sentences the teacher typed or edited stay as written, in the order set. **Undo** brings back the text that was replaced.

![The Teacher Comment with a generated draft and its rows under Sentences](img/generate-report-comments.jpg 'A draft for Cece Adeyemi after all six work habits are rated.')

4. Under **Sentences**, each row shows one sentence. Hover over it to see what it comes from. **Options** offers other bank sentences for the same part and **Remove From Comment**. Drag a row by its handle to move it.
5. To add a sentence, choose the plus button between two rows, or open **Browse Sentences…** and choose **Use** beside a sentence. Browse Sentences lists the sentences that fit the student, least used in the class first. **+ Write Your Own** adds a sentence in the teacher's own words.
6. Choose **Approve and Next**.

If the student has no marked work in the report period, nothing is drafted. If a sentence is also in a classmate's comment, a note under the comment says so.

## Class Lines

**Support** and **Closing** are set once for the whole class. Under **Support**, choose **Choose…** and pick the lines that say what the teacher will do in class. Under **Closing**, choose **Add One…**, type a sentence and choose **Save for Class**. It ends every new comment in the class.
