# Generate Measures

How Generate's drafts read across a class, in numbers. `scripts/generate-measure.mjs` drafts Demo Mode's Science 8 class the way the Nov 4 2026 audit did (27 students × 4 presses, once as a Proficiency class and once as a Letter class, with varied Work Habits ratings: 216 drafts) and reports the measures below. The targets are plan v1 section 4 as revised by plan v2 (`~/reports/generate-ideal-comments-plan-v2.md`). The blind sort against a teacher's own comments is the release bar; these numbers are the floor.

Run it against a local server:

```bash
PORT=8701 node scripts/dev-local.mjs &
node scripts/generate-measure.mjs --base http://localhost:8701 --save drafts.json
node scripts/generate-measure.mjs --from drafts.json --blind 10 --seed 7 --sheet sheet.md --key key.md
```

Shapes are the first three words with the name and pronouns as one word each. A family is what the first sentence opens on (the name, a pronoun, the course, a grade word, the piece of work, a time phrase, other). Self-BLEU is each comment's BLEU-3 against the other 26 of its class set. Edit distance is word-level, over the longer draft.

## Before (main at 46a63b7, Nov 4 2026)

| Measure                                 | Value              | Target                          | Met |
| --------------------------------------- | ------------------ | ------------------------------- | --- |
| Top first-sentence shape                | 11.6%              | ≤ 15%                           | yes |
| Largest shape family                    | 48.1%              | ≤ 25%                           | no  |
| Largest frame share of a part           | 30.1%              | ≤ 10%                           | no  |
| Consecutive same-opener pairs           | 0                  | 0                               | yes |
| "this term" per draft                   | 1.73               | 0                               | no  |
| "so far" per draft (max)                | 2                  | ≤ 1                             | no  |
| "proficiency scale" per draft (max)     | 1                  | ≤ 1                             | yes |
| Banned phrases                          | 589                | 0                               | no  |
| Presses changing ≥ 4 sentences          | 94.4% (min 3)      | 100%                            | no  |
| Neighbour edit distance                 | 0.82               | ≥ 0.6                           | yes |
| Adjacent students sharing first 3 words | 24 (worst class 5) | ≤ 2 a class                     | no  |
| Sentences per draft                     | 5.91 (5–6)         | 5–7                             | yes |
| Words per sentence                      | 13.91 (max 20)     | mean ≈ 15, max ≤ 24             | yes |
| Press edit distance                     | 0.54               | ≥ 0.6                           | no  |
| Self-BLEU-3                             | 0.84               | reported (lower is more varied) | yes |
| Distinct-2 / distinct-3                 | 0.33 / 0.45        | reported                        | yes |

Frames per step (bank sentences used; top sentence and its share of the step):

| Step     | Used | Top   | Share |
| -------- | ---- | ----- | ----- |
| grade    | 44   | gr05  | 9.6%  |
| example  | 11   | n375  | 14.8% |
| overall  | 37   | n1002 | 8.8%  |
| habits   | 21   | hs10  | 16.2% |
| nextStep | 5    | ls04  | 30.1% |
| home     | 22   | f115  | 18.5% |

First-sentence families: name-first 48.1%, other 29.6%, time-first 9.3%, grade-first 8.8%, course-first 4.2%.
Top first-sentence shapes: “NAME is earning” 11.6%, “NAME is proficient” 11.1%, “the work marked” 6%, “across NAME science” 6%, “the bc proficiency” 5.6% (38 distinct).
Banned phrases: “is able to” 16, “the work marked” 27, “this term” 374, “all six” 10, “rated” 20, “proficiency scale calls” 12, “skill by skill” 6, “marks are close” 22, “across skills” 7, “work on” 56, “ability to” 17, “each skill” 4, “marked highest” 14, “every one” 4.

## After (feat/generate-flow, Nov 4 2026, after the voice review)

| Measure                                 | Value             | Target                          | Met |
| --------------------------------------- | ----------------- | ------------------------------- | --- |
| Top first-sentence shape                | 12%               | ≤ 15%                           | yes |
| Largest shape family                    | 24.5%             | ≤ 25%                           | yes |
| Largest frame share of a part           | 9.7%              | ≤ 10%                           | yes |
| Consecutive same-opener pairs           | 0                 | 0                               | yes |
| "this term" per draft                   | 0                 | 0                               | yes |
| "so far" per draft (max)                | 1                 | ≤ 1                             | yes |
| "proficiency scale" per draft (max)     | 1                 | ≤ 1                             | yes |
| Banned phrases                          | 0                 | 0                               | yes |
| Presses changing ≥ 4 sentences          | 100% (min 4)      | 100%                            | yes |
| Neighbour edit distance                 | 0.89              | ≥ 0.6                           | yes |
| Adjacent students sharing first 3 words | 0 (worst class 0) | ≤ 2 a class                     | yes |
| Sentences per draft                     | 5.26 (5–6)        | 5–7                             | yes |
| Words per sentence                      | 14.28 (max 24)    | mean ≈ 15, max ≤ 24             | yes |
| Press edit distance                     | 0.77              | ≥ 0.6                           | yes |
| Self-BLEU-3                             | 0.77              | reported (lower is more varied) | yes |
| Distinct-2 / distinct-3                 | 0.42 / 0.57       | reported                        | yes |

Frames per part (bank sentences used; the top sentence and its share of the part):

| Part     | Used | Top   | Share |
| -------- | ---- | ----- | ----- |
| overall  | 33   | vst24 | 9%    |
| grade    | 25   | vgl04 | 9.6%  |
| habits   | 39   | vhc06 | 9.7%  |
| example  | 32   | vbo14 | 8.5%  |
| nextStep | 16   | vns08 | 7.9%  |
| home     | 14   | vho10 | 9.4%  |

First-sentence families: name-first 24.5%, course-first 22.2%, other 21.3%, time-first 19%, work-first 9.3%, grade-first 3.7%.
Top first-sentence shapes: “in science 8” 12%, “science 8 work” 6%, “over the year” 5.6%, “the marks on” 5.1%, “at this point” 4.6% (75 distinct).

Every target is met. The largest shape family (24.5%) and the largest frame share (9.7%) sit just under their caps.

The voice review (the twelve drafts read as a teacher would) retired the frames that cleared their throat ("it is clear that", "her marks show that", "in class tasks"), said a level in the Ministry descriptor's words, invented a frequency ("most days", "each week", "day after day"), opened on a label ("As a habit", "In her work habits") or put the grade before the student. The course is named once a comment; a level's meaning is a plain "which means" clause in three grade frames of eleven; and the first sentence goes round the class opening on the student, the course, a time or the work.

| Measure                                 | Before             | After        | Target                |
| --------------------------------------- | ------------------ | ------------ | --------------------- |
| Largest shape family                    | 48.1%              | 24.5%        | ≤ 25%                 |
| Largest frame share of a part           | 30.1%              | 9.7%         | ≤ 10%                 |
| "this term" per draft                   | 1.73               | 0            | 0                     |
| "so far" per draft (max)                | 2                  | 1            | ≤ 1                   |
| Banned phrases                          | 589                | 0            | 0                     |
| Presses changing ≥ 4 sentences          | 94.4% (min 3)      | 100% (min 4) | 100%                  |
| Adjacent students sharing first 3 words | 24 (worst class 5) | 0            | ≤ 2 a class           |
| Press edit distance                     | 0.54               | 0.77         | ≥ 0.6                 |
| Neighbour edit distance                 | 0.82               | 0.89         | ≥ 0.6                 |
| Self-BLEU-3                             | 0.84               | 0.77         | lower is more varied  |
| Distinct-2 / distinct-3                 | 0.33 / 0.45        | 0.42 / 0.57  | higher is more varied |

## Twelve Drafts, Two per Standing

As Generate gives them, unedited, from the run above. Demo Mode has no IE student (grade 8 reports proficiency), so the two IE drafts come from the same class switched to grade 10, Letter, with IE chosen as the reporting basis.

### Extending

**Noor, Proficiency class, press 1.** Over the year, the Science Fair Proposal has stood out as Noor’s best piece. Her marks put her at an Extending level in Science 8. Building two habits would help: beginning the task as soon as class starts, and sharing the work in a group. Right now, she goes into depth when asked to explore and explain the local environment. With practice in class, she can find sources of error and suggest improvements.

**Mei, Proficiency class, press 2.** Since the start of the term, Mei’s marks have risen, and she can explore and explain the local environment in depth. Her marks put her at an Extending level in Science 8. On the Data Reading Quiz, she earned her highest mark so far. What would help her most in class is sharing the work in a group. To grow further, she can choose units that suit each measurement and check conversions. One thing to try at home: ask her what pattern the numbers from an experiment showed.

### Proficient

**Cece, Proficiency class, press 1.** One thing Cece does well in Science 8 is showing data patterns in tables, graphs and models. Her work is at a Proficient level. In lessons, she finishes her work by the due date and comes to class ready to work. Her Biodiversity Field Journal stands out, and in it she showed that she can plan an investigation that collects reliable data. Looking ahead, she can explain why a science problem matters locally or globally.

**Liam, Proficiency class, press 3.** In Science 8, the work Liam does is at a Proficient level. This year, his highest mark was on the Microscope Skills Check, and he can consistently explore and explain the local environment. Putting his phone away when asked is the habit to build. From here, he can choose a question that a fair test can answer. Ask him what question an experiment in class was trying to answer, when the chance is there.

### Developing

**Ethan, Proficiency class, press 2.** In showing data patterns in tables, graphs and models, Ethan’s work has risen from Emerging to Developing. He is at a Developing level in Science 8 so far. The habit to build is coming to class with what he needs, and he already keeps his phone away during lessons. Over the year, the Science Fair Proposal has stood out as his best piece. From here, he can keep exploring one science topic over several weeks.

**Darius, Proficiency class, press 1.** At this point, Darius’s Biodiversity Field Journal is his best piece. He is now at a Developing level in Science 8, which means his understanding is growing but not yet steady. In lessons, he joins in class discussions. Building two habits would help: coming to class with what he needs, and doing his part in a group task. Next, he can keep exploring one science topic over several weeks.

### IE

**Ethan, Letter class at grade 10 with IE reporting, press 1.** In Science 8, Ethan has an IE for now. Across the marked work, his average is under 50 percent. He reliably completes his work on time. Showing more of the learning in his work is what he needs to do to earn a grade. A short meeting would help us agree on this plan; please contact me.

**Raj, Letter class at grade 10 with IE reporting, press 2.** In Science 8, Raj has an IE for now. Across the marked work, his average is under 50 percent. He finishes his work by the due date. To replace the IE with a grade, he needs to show more of the learning in his work. I would like to meet with you to talk about this plan; please contact me.

### C+

**Sam (they/them), Letter class, press 1.** In Science 8, Sam is earning a C+, which is good work. They would get more from class by sharing the work in a group and making one change from each piece of feedback. So far, their best piece is their Energy Transfer Investigation. By now, they can consistently apply science learning to new situations. The goal for them now is to keep exploring one science topic over several weeks. Families can help too: ask them what question an experiment in class was trying to answer.

**Caleb, Letter class, press 2.** Over the year, the Circuit Design Challenge has stood out as Caleb’s best piece. He has a C+ in Science 8, which is good work. The habit to build is keeping his device on the task, and he already starts the task as soon as class begins. He consistently observes nature and asks questions about it, and his marks show it. A good next step is for him to measure correctly and record units each time.

### Strong, One Habit to Build

**Sofia, Proficiency class, press 1.** So far, Sofia’s best piece is her Circuit Design Challenge. Her marks put her at a Proficient level in Science 8. She has moved from Developing to Proficient in exploring and explaining the local environment. In class she completes her work on time; the one habit to build is using the device for the work in front of her. What would help her most now is to explain why a science problem matters locally or globally.

**Tessa (B), Letter class, press 3.** Of all Tessa’s work in Science 8, the Mineral Identification Lab stands out. She has earned a B, very good work. While she finishes her work by the due date, the habit to build is asking what to change after a piece is marked. Right now, she can apply science learning to new situations most of the time. For now, the aim is for her to explain why a science problem matters locally or globally.

## Blind Sort Sheet

Ten generated drafts mixed with the ten stand-in comments in `docs/generate-gold-standin.md` (seed 11). The stand-ins are not Colin's; the release test needs ten to twenty of his own comments in their place, read by three people, sorted at 60% or worse.

### Which Were Written by a Teacher?

For each comment, write T (a teacher wrote it) or G (it was generated). 20 comments; half are each.

1. Ethan's marks for showing patterns in data have risen from Emerging to Developing. He is now working at a Developing level in Science 8. His Science Fair Proposal is his best piece. He uses the class devices well, and starting work when class begins is the habit to build. Next, he can follow one science topic for several weeks and see what questions it raises. If he notices something odd at home, ask him what he thinks is causing it.

   T / G

2. Science 8 work has earned Caleb a C+, which is good work. Right now, he can consistently observe nature and ask questions about it. Of his work so far, the best is the Circuit Design Challenge. Putting his phone away when asked is the habit to build; he already comes to class ready to work. From here, he can measure correctly and record units each time. Ask him how he would test which of two things lasts longer, when the chance is there.

   T / G

3. Liam's marks in Science 8 put him at a Proficient level. He explains what he sees in the local environment, and his Microscope Skills Check earned his highest mark. He comes to class ready and finishes his work on time. Keeping his phone away during lessons is the habit to build. The next step is for him to choose a question that a fair test can answer.

   T / G

4. Ethan's grade in Science 8 is IE for now, because his marks so far average under 50 percent. There is time to change that. His best piece is his Earth Science Unit Test. He uses the class devices well, and starting work when class begins would help him most. The plan is for him to follow one science topic over several weeks and finish the pieces that count. Please call or email me so we can set a deadline together.

   T / G

5. Science 8 is going well for Cece, who is working at a Proficient level. Her Biodiversity Field Journal is her best piece, and it shows how clearly she presents data in tables and graphs. She hands in her work on time and comes to class ready. Next, she can explain why a science problem matters to people here and elsewhere. When something in the news is about science, ask her who it affects.

   T / G

6. From the start of the term to now, Mei’s marks have gone up. She is working at an Extending level in Science 8. Of her marked work, the Data Reading Quiz has the top mark. Listening to others in group work and asking what to change after a piece is marked are the habits to build. The next thing to practise is choosing units that suit each measurement and check conversions.

   T / G

7. Mateo is earning a B in Science 8, very good work. This year, his best piece is his Chemical Reactions Lab. He can build two habits: finishing each piece by its due date and coming to class with what he needs. Over recent weeks, his marks have climbed. The step that would help most now is to explain why a science problem matters locally or globally. At home, ask him what question an experiment in class was trying to answer.

   T / G

8. One thing Cece does well in Science 8 is showing data patterns in tables, graphs and models. Her work is at a Proficient level. In lessons, she finishes her work by the due date and comes to class ready to work. Her Biodiversity Field Journal stands out, and in it she showed that she can plan an investigation that collects reliable data. Looking ahead, she can explain why a science problem matters locally or globally.

   T / G

9. Noor is working at an Extending level in Science 8. Her Science Fair Proposal is the piece that stands out, and it earned her top mark. In class she joins discussions and uses feedback to improve the next piece. Starting the task as soon as class begins would help her get more from each lesson. Her next step is to find the sources of error in an investigation and suggest a change for each. At home, ask her how sure the class can be about a result.

   T / G

10. Caleb has a C+ in Science 8, which is good work. His Circuit Design Challenge is his best piece. He looks closely at the world outdoors and asks questions about what he sees, and he hands in his work on time. Putting his phone away when asked is the one habit to build. Next, he can measure carefully and write the units down each time. At home, ask him to measure something in the kitchen and tell you the units.

T / G

11. Tessa's mark in Science 8 is a B, very good work. Her Mineral Identification Lab earned her highest mark, and in it she used what she had learned in a new setting. She completes her work on time. Reading the feedback on a piece and using it on the next one is the habit to build. Her next step is to explain why a science problem matters to people here and elsewhere.

T / G

12. Darius is at a Developing level in Science 8, which means his understanding is growing and becoming steadier. His best piece is his Biodiversity Field Journal. He asks questions in class and uses feedback on his work. Using the start of class well and sharing the work in a group would help him most. His next step is to follow one science topic over several weeks and keep asking questions about it.

T / G

13. Right now, Sam consistently applies science learning to new situations. They are working at a Proficient level in Science 8. Their next habits to build are listening to others in group work and asking what to change after a piece is marked. The Energy Transfer Investigation is their best piece. Sam’s next step is to keep exploring one science topic over several weeks.

T / G

14. The marks on Amara’s recent work in Science 8 are higher than earlier in the term. Her work has earned her an A, which is excellent work. The one habit that would help her most is listening to others in group work. Her Science Fair Proposal stands out, and in it she showed she can follow safety and ethical guidelines in investigations. The goal for her now is to find sources of error and suggest improvements.

T / G

15. Science 8 is going well for Anisa, at a Proficient level, and her Scientific Method Quiz result is her best. She would get more from each class by finishing each piece by its due date. One thing she does well is showing data patterns in tables, graphs and models. Over time, she can record both observations and measurements with precision. Families can help too: ask her how she would test which of two things lasts longer.

T / G

16. Sam is working at a Proficient level in Science 8. Their Energy Transfer Investigation is their best piece; it shows they can use a science idea in a new setting. They complete their work and come to class ready. Sharing the work in a group is the habit to build. Their next step is to follow one science topic over several weeks. At home, you could ask them what question an experiment in class was trying to answer.

T / G

17. In Science 8, the work Liam does is at a Proficient level. This year, his highest mark was on the Microscope Skills Check, and he can consistently explore and explain the local environment. Putting his phone away when asked is the habit to build. From here, he can choose a question that a fair test can answer. Ask him what question an experiment in class was trying to answer, when the chance is there.

T / G

18. Raj is at an Emerging level in Science 8, so the first signs of the learning are there. His Science Fair Proposal is the piece that shows them most. He comes to class ready, works well in a group and joins discussions. Finishing each piece by its due date would help his marks show what he knows. His next step is to ask his own questions about a science topic that interests him.

T / G

19. The Biodiversity Field Journal is Fatima’s best piece: in it, she showed she can make a prediction and explain the reason for it. Her Science 8 mark is a B, which is very good work. Showing data patterns in tables, graphs and models is a strength for her. Completing work on time would help her most, so her marks show what she knows. Practice at planning a simple investigation to test a claim would help her most now.

T / G

20. This year, Ethan’s highest mark was on the Earth Science Unit Test. He consistently uses the class devices for the work. The one habit that would help him most is beginning the task as soon as class starts. Exploring and explaining the local environment is where his marks are highest. A good next step is for him to keep exploring one science topic over several weeks.

T / G

### Answer Key

Seed 11.

1. T (control)
2. G (generated)
3. T (control)
4. T (control)
5. T (control)
6. G (generated)
7. G (generated)
8. G (generated)
9. T (control)
10. T (control)
11. T (control)
12. T (control)
13. G (generated)
14. G (generated)
15. G (generated)
16. T (control)
17. G (generated)
18. T (control)
19. G (generated)
20. G (generated)
