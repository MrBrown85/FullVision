# Comment Bank audit: grade 8–12 subject teachers

Written 2026-10-28 after Generate shipped (#478) on a 250-sentence bank. Method: the bank read sentence by sentence; then one made-up student (Priya, she/her, four habits rated, one observation, twelve scores across six competencies) put through Generate in eight classes built with the app's own curriculum import (`buildLearningMapFromTags`): English 10, Math 8, PE 8, Socials 8, Drama 10, ADST 8, French 8 and Foods 9. The Demo class (Science 8) hides most of what follows because its competency names were written by hand.

Nothing in the app is changed by this audit.

## 1. The questionnaire names competencies by their category, not their label (engine defect)

`CommentBank.facts` takes each competency's name from `sec.name`, which the curriculum import sets to the **category** name. 404 of the 845 categories in `curriculum_by_course.json` hold more than one competency, so in those classes several competencies share one name. The printed report uses the competency's own label (`ReportBlocks._competencyLabel`), so the questionnaire and the report disagree about what a competency is called.

What Priya's drafts said:

- Socials 8: "Her results in **Use Social Studies inquiry processes and skills** have moved up since the start of the term. … **Use Social Studies inquiry processes and skills** is the area to build next." The report calls those competencies Critical Thinking, Interpret Graphics and Cite Sources.
- ADST 8: four Growth rows all named "Applied Design"; the draft says "Priya does her best work in Applied Design … Applied Design is the area to build next."
- English 10: "best work is in Comprehend and Connect" where the report prints "Apply Appropriate Strategies".

Fix: one line in `facts()`, the competency's tag label as the report uses it. This is the first thing to do; nothing below reads right until it is.

## 2. Half the competency labels are not sentence-ready (data defect, outside the bank)

After fix 1 the bank would print the labels in `curriculum_by_course.json`. Of its 2,069 competency labels, 1,101 (53%) start with a verb, and many are machine-cut to three words:

- English 10: "Apply Appropriate Strategies", "Create Thoughtful Engaging"
- Science 10: "Formulate Physical or Mental", "Collaboratively and Individually Plan", "Contribute to Care"
- Drama 10: "Analyze Respond Dramatic", "Document Respond Dramatic Works"
- PE 10: "Develop Refine and Apply"
- Career-Life Education: "Apply a Mentor's Guidance", "Demonstrate Inclusive Respectful"

"Her strongest work is in Create Thoughtful Engaging" is not a sentence a teacher sends home. The grade 8 courses are mostly fine (Math 8: Logic and Patterns, Problem Solving; Socials 8: Evidence, Cause and Consequence); it is the 10–12 courses, 206 of the 223 in the file, that carry the cut labels. The printed Proficiency block has the same problem today.

Fix: clean the labels for the 8–12 courses in the data file (a content job, benefits every report), and have the bank never rely on a label standing alone after "in". Teachers can rename competencies in Class Management, but they should not have to.

## 3. One bank for every subject

The eight drafts were the same draft with different names: 98 sentences fit Priya in every class. The bank has no subject axis, and its wording assumes a class where work is handed in, revised and talked about:

- 28 sentences on Completes Work, 20 on "class discussions", 6 on revising a piece, 11 on handing in.
- PE 8: "A second try at the Skills Check (Developing) would show what Priya has learned since. In class, she will get targeted practice in Healthy and Active Living." Nothing about effort in activity, skill practice, fair play, safety or participation in games.
- Drama 10: nothing about rehearsal, performance, creative risk or working in an ensemble; "best work is in Explore and Create and Communicate and Document" has two "and"s.
- Math 8: nothing about showing the steps, checking an answer, explaining a method, or practice; "Understanding and Solving is the area to build next" is the closest it gets.
- ADST (Foods, Woodwork, Metalwork, Textiles, Computer Studies, Media): nothing about safe tool use, following a process, iterating a design, or working to a plan.
- Science: nothing about lab work, data or safety either; the Demo reads well only because its competency names carry the meaning.
- Languages: no second-language courses are in the curriculum file at all (only ELA, EFP and Spoken Language), so a French or Spanish teacher cannot import competencies; their questionnaire shows no Growth and the bank offers habits and attendance only.

Fix: a `subject` on sentences (the course's subject family from the curriculum file: ADST, Arts, Career, ELA, Math, PE, Science, Socials), general sentences for all, and 15–25 sentences per family for habits in that room, where the student is now, the next step and what helps at home. The handed-in and revise sentences get an `except` for PE and Arts. Roughly 150 sentences of new writing.

## 4. Labels that read as a judgement on the student

PE's competencies are Physical Literacy, Healthy and Active Living, Social and Community Health and **Mental Well-being**. The bank's growth and focus sentences would print "more room to grow in Mental Well-being" or "Mental Well-being is the area to build next", which a family reads as a statement about the student's mental health, not a curricular competency. Career-Life Education has the same shape. The subject wording in fix 3 should keep PE and Career out of the "area to build" sentences, or name the competency as such ("in the Mental Well-being competency").

## 5. Smaller things

- The "For example, on Oct 5 I noted…" sentence follows the Growth sentence, which it does not exemplify. The draft's example-or-note step should come after the Overall sentence.
- The picture of the term calls a term a "challenge" when any competency is Developing. In 8–12 classes with six or more competencies early in a term that will be most students, so the openings skew to the cautious ones. Worth a look once drafts are read in real classes.
- Phones: seven sentences on Uses Devices Well, Rarely to Consistently, plus one home line. Colin wants this covered well; the subject rework is the place to add phone use during instruction, during work time, in group work, and the pattern over the term.
- Letter-grade classes (10–12 with percents) have four `letterStanding` sentences; the rest of the Overall group is proficiency wording that `fits()` keeps out of a Letter class. Fine, but thin.

## What holds up

The openings and closers, the six habit scales at every level, the student's-own-words sentences, the home questions that do not name a competency ("ask Priya to explain one idea from Math 8 in her own words"), the attendance lines, and the tone: plain, family-facing, no superlatives, no teacher's feelings.

## Order of work, if it goes ahead

1. `facts()` uses the competency label (one line; a test with an imported ELA 10 map).
2. Clean the 10–12 competency labels in the data file, or decide teachers rename them.
3. Subject-tagged sentences and the `except` tags; the PE and Career guard; move the example step after Overall.
4. Read Generate's drafts for one student per subject family before merging.
