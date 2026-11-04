# The Comment Voice

What a Generate draft should sound like, and the rules that hold it there. Decisions: `docs/DECISIONS.md`, "Generate: a data-to-text pipeline (2026-11-04)". Measures: `docs/generate-measures.md`.

## Who Is Writing

A teacher who knows the student, writing to the family. Not a report about a student, not a list of ratings, not praise of the person. The parent should be able to picture the student in class and know one thing to try at home.

## The Shape

Five to seven sentences, one gradebook fact each, two short facts joined when they belong together ("Her Circuit Design Challenge is her best piece, where she showed she can follow safety guidelines"). The parts are the grade, a strength or growth, the best piece, the habits, one next step, and sometimes one thing to try at home. The order is not fixed: the comment leads with what is most worth saying about this student, and the lead rotates along the roster so two neighbours never open the same way.

## The Rules

- **The name first, pronouns after**, the pronouns on file, the name again only at the start of a sentence three or more after it was said.
- **The grade once, in plain words, with the student or the course first**: "Sam is earning a C+, which is good work", "In Science 8, Liam is at a Proficient level". Never the grade before the student ("A B is her mark", "IE is his grade"). What a level means, when it is said, is a family's clause, never the Ministry's descriptor: Proficient "which means she has the learning the course expects", Extending "which means her work goes beyond what the course expects", Developing "which means his understanding is growing but not yet steady", Emerging "which means she is just beginning". It is in three grade frames of eleven, so most comments do not say it. The proficiency scale is named at most once. "So far" at most once. Never "this term": the comment is the year to date.
- **The course named once.** A later sentence drops "in Science 8" ("Looking ahead, she can …").
- **Habits as behaviour a parent can picture**: "She finishes her work by the due date.", "He keeps his phone away during lessons." The behaviour stands alone, with no label in front ("As a habit,", "In her work habits,"). A habit is a rating, not a count: "consistently" or "usually" (the rating's own word) or nothing, never "most days", "each week", "day after day" or "every lesson". Never the questionnaire's labels. Say a habit when it is news for this student, not because it is true of everyone.
- **The strength stated directly**: "She shows data patterns clearly in tables and graphs.", "Her strongest area is reading data: she …". No lead that says nothing ("it is clear that", "her marks show that", "in class tasks"). When the two students before named the same skill, a second strength past the gate is said instead.
- **One next step, as a skill** the student can practise: "find sources of error and suggest improvements".
- **Home as an invitation**, to about a third of the class at a time: "ask her what pattern the numbers from an experiment showed".
- **Skills in the family's words.** The skill card's phrase, inflected by rule ("finds patterns", "at finding patterns"), never the Ministry's sentence pasted in.
- **No trend, frequency or cause the gradebook does not hold.** A strength at its level never says "more often" or "most of the time"; a rise is said only by the growth sentence; a habit carries no "so that".
- **Highest means highest.** "Her best piece" and "her highest mark" only for a piece no other piece equals; a tie reads "one of her strongest pieces".
- **The top strength.** The strength is the student's top competency, or one within 0.2 of it and not falling.
- **Safety as a procedure.** A safety competency is the next step only when it is alone at the bottom, and then as a routine ("go through the safety checklist at the start of each lab").
- **Classmates read different comments.** A frame or a phrasing one of the three students before used is not used again; no comment is within half its words of a classmate's.
- **A comment, not a list.** Two facts that belong together join with "and"; no run of three words is said twice in one comment.
- **Time phrases sparingly.** A sentence opens on a time in one comment of four, and never on "Right now,", "At this point,", "By now," or "For now,".
- **Specific invitations.** Home prompts and the IE meeting line name something a family can do ("convert the millilitres on a juice carton to litres"; "please call or email me").
- **24 words or fewer a sentence, about 15 on average.**
- **Nothing the gradebook does not hold.** Every sentence names a fact `CommentBank.verify` can check. No comparisons with classmates, predictions, the teacher's feelings, or praise of the person.

## Never Say

The lint (`CommentLint.BANNED_PHRASES`) stops these in frames and card strings: "is able to", "ability to", "this term", "rated", "skill by skill", "across skills", "each skill", "every one", "all six", "marks are close", "marked highest", "the work marked", "proficiency scale calls", "keep going", and the frequencies and descriptors above ("day after day", "most days", "every lesson", "as a rule", "depth and complexity", "it is clear that", "marks show that", "top marks went to", and a sentence opening "Each week" or "Every class"). "Work on" as advice is caught by the phrasal-verb rule. They are the phrases that made the Nov 4 drafts read "translated from another language".

## Examples

From Demo Mode, unedited:

> Since the start of the term, Mei’s marks have risen, and she can explore and explain the local environment in depth. Her marks put her at an Extending level in Science 8. On the Data Reading Quiz, she earned her highest mark so far. What would help her most in class is sharing the work in a group. To grow further, she can choose units that suit each measurement and check conversions. One thing to try at home: ask her what pattern the numbers from an experiment showed.

> In Science 8, Sam is earning a C+, which is good work. They would get more from class by sharing the work in a group and making one change from each piece of feedback. So far, their best piece is their Energy Transfer Investigation. By now, they can consistently apply science learning to new situations. The goal for them now is to keep exploring one science topic over several weeks. Families can help too: ask them what question an experiment in class was trying to answer.

Twelve more, two per standing, are in `docs/generate-measures.md`.

## Writing a Frame or a Card

A new frame goes in `shared/comment-bank.js` with its `claims` (what verify checks), its `needs` (the slots it fills) and `when` gates, and passes the lint and the four-audience checklist (families, students, teachers, the Ministry). A part needs at least eight structurally different frames so no one frame takes more than a tenth of the class. A skill card on schema version 2 gives `forms.base` and three phrasings for each standing, a next step, a home prompt and the evidence it rests on, written as a teacher would say it.
