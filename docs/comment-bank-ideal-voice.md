# The Comment Voice

What a Generate draft should sound like, and the rules that hold it there. Decisions: `docs/DECISIONS.md`, "Generate: a data-to-text pipeline (2026-11-04)". Measures: `docs/generate-measures.md`.

## Who Is Writing

A teacher who knows the student, writing to the family. Not a report about a student, not a list of ratings, not praise of the person. The parent should be able to picture the student in class and know one thing to try at home.

## The Shape

Five to seven sentences, one gradebook fact each, two short facts joined when they belong together ("Her Circuit Design Challenge is her best piece, where she showed she can follow safety guidelines"). The parts are the grade, a strength or growth, the best piece, the habits, one next step, and sometimes one thing to try at home. The order is not fixed: the comment leads with what is most worth saying about this student, and the lead rotates along the roster so two neighbours never open the same way.

## The Rules

- **The name first, pronouns after**, the pronouns on file, the name again only at the start of a sentence three or more after it was said.
- **The grade once, in plain words**: "working at a Proficient level", "a C+, which is good work". The proficiency scale is named at most once, and only to explain a level. "So far" at most once. Never "this term": the comment is the year to date.
- **Habits as behaviour a parent can picture**: "finishes her work by the due date", "puts his phone away when asked". Never the rating words (Consistently, Usually) or the questionnaire's labels. Say a habit when it is news for this student, not because it is true of everyone.
- **One next step, as a skill** the student can practise: "find sources of error and suggest improvements".
- **Home as an invitation**, to about a third of the class at a time: "ask her what pattern the numbers from an experiment showed".
- **Skills in the family's words.** The skill card's phrase, inflected by rule ("finds patterns", "at finding patterns"), never the Ministry's sentence pasted in.
- **24 words or fewer a sentence, about 15 on average.**
- **Nothing the gradebook does not hold.** Every sentence names a fact `CommentBank.verify` can check. No comparisons with classmates, predictions, the teacher's feelings, or praise of the person.

## Never Say

The lint (`CommentLint.BANNED_PHRASES`) stops these in frames and card strings: "is able to", "ability to", "this term", "rated", "skill by skill", "across skills", "each skill", "every one", "all six", "marks are close", "marked highest", "the work marked", "proficiency scale calls", "keep going". "Work on" as advice is caught by the phrasal-verb rule. They are the phrases that made the Nov 4 drafts read "translated from another language".

## Examples

From Demo Mode, unedited:

> Mei’s marks have climbed since the term began, and she can explore and explain the local environment with depth and complexity. Over the year, she has worked at an Extending level in Science 8. Of her marked work, the Data Reading Quiz has the top mark. What would help her most in class is sharing the work in a group. To grow further, she can choose units that suit each measurement and check conversions. One thing to try at home: ask her what pattern the numbers from an experiment showed.

> With a C+ in Science 8, Sam is doing good work. They would get more from class by sharing the work in a group and making one change from each piece of feedback. So far, their best piece is their Energy Transfer Investigation. In class tasks, they can consistently apply science learning to new situations. The goal for them now is to keep exploring one science topic over several weeks. Families can help too: ask them what question an experiment in class was trying to answer.

Twelve more, two per standing, are in `docs/generate-measures.md`.

## Writing a Frame or a Card

A new frame goes in `shared/comment-bank.js` with its `claims` (what verify checks), its `needs` (the slots it fills) and `when` gates, and passes the lint and the four-audience checklist (families, students, teachers, the Ministry). A part needs at least eight structurally different frames so no one frame takes more than a tenth of the class. A skill card on schema version 2 gives `forms.base` and three phrasings for each standing, a next step, a home prompt and the evidence it rests on, written as a teacher would say it.
