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

## After (feat/generate-flow at a2f3632, Nov 4 2026)

| Measure                                 | Value             | Target                          | Met |
| --------------------------------------- | ----------------- | ------------------------------- | --- |
| Top first-sentence shape                | 12.5%             | ≤ 15%                           | yes |
| Largest shape family                    | 24.5%             | ≤ 25%                           | yes |
| Largest frame share of a part           | 9.5%              | ≤ 10%                           | yes |
| Consecutive same-opener pairs           | 0                 | 0                               | yes |
| "this term" per draft                   | 0                 | 0                               | yes |
| "so far" per draft (max)                | 1                 | ≤ 1                             | yes |
| "proficiency scale" per draft (max)     | 1                 | ≤ 1                             | yes |
| Banned phrases                          | 0                 | 0                               | yes |
| Presses changing ≥ 4 sentences          | 100% (min 5)      | 100%                            | yes |
| Neighbour edit distance                 | 0.89              | ≥ 0.6                           | yes |
| Adjacent students sharing first 3 words | 0 (worst class 0) | ≤ 2 a class                     | yes |
| Sentences per draft                     | 5.28 (5–6)        | 5–7                             | yes |
| Words per sentence                      | 14.69 (max 24)    | mean ≈ 15, max ≤ 24             | yes |
| Press edit distance                     | 0.76              | ≥ 0.6                           | yes |
| Self-BLEU-3                             | 0.78              | reported (lower is more varied) | yes |
| Distinct-2 / distinct-3                 | 0.4 / 0.55        | reported                        | yes |

Frames per part (bank sentences used; the top sentence and its share of the part):

| Part     | Used | Top   | Share |
| -------- | ---- | ----- | ----- |
| overall  | 31   | vst16 | 9.5%  |
| grade    | 26   | vgp03 | 7.2%  |
| habits   | 40   | vhi09 | 6.4%  |
| example  | 27   | vbo03 | 7.4%  |
| nextStep | 16   | vns04 | 7.9%  |
| home     | 14   | vho10 | 9.4%  |

First-sentence families: name-first 24.5%, other 21.8%, time-first 17.1%, course-first 14.8%, work-first 14.4%, grade-first 7.4%.
Top first-sentence shapes: “in science 8” 12.5%, “NAME science 8” 5.1%, “over the year” 4.2%, “recent work in” 4.2%, “so far NAME” 3.2% (67 distinct).

Every target is met. The largest shape family (24.5%) and the largest frame share (9.5%) sit just under their caps.

| Measure                                 | Before             | After        | Target                |
| --------------------------------------- | ------------------ | ------------ | --------------------- |
| Largest shape family                    | 48.1%              | 24.5%        | ≤ 25%                 |
| Largest frame share of a part           | 30.1%              | 9.5%         | ≤ 10%                 |
| "this term" per draft                   | 1.73               | 0            | 0                     |
| "so far" per draft (max)                | 2                  | 1            | ≤ 1                   |
| Banned phrases                          | 589                | 0            | 0                     |
| Presses changing ≥ 4 sentences          | 94.4% (min 3)      | 100% (min 5) | 100%                  |
| Adjacent students sharing first 3 words | 24 (worst class 5) | 0            | ≤ 2 a class           |
| Press edit distance                     | 0.54               | 0.76         | ≥ 0.6                 |
| Neighbour edit distance                 | 0.82               | 0.89         | ≥ 0.6                 |
| Self-BLEU-3                             | 0.84               | 0.78         | lower is more varied  |
| Distinct-2 / distinct-3                 | 0.33 / 0.45        | 0.40 / 0.55  | higher is more varied |

## Twelve Drafts, Two per Standing

As Generate gives them, unedited, from the run above. Demo Mode has no IE student in a Letter class at grade 8 (grade 8 reports proficiency), so the two IE drafts come from the same class switched to grade 10, Letter, with IE reporting on.

### Extending

**Noor, Proficiency class, press 1.** Noor’s best piece is her Science Fair Proposal. Science 8 is going well for her, at an Extending level. In class, two habits would help her: using the start of class well and sharing the work in a group. Across the year, her marks show that she goes into depth when asked to explore and explain the local environment. With practice in class, she can find sources of error and suggest improvements.

**Mei, Proficiency class, press 2.** Mei’s marks have climbed since the term began, and she can explore and explain the local environment with depth and complexity. Over the year, she has worked at an Extending level in Science 8. Of her marked work, the Data Reading Quiz has the top mark. What would help her most in class is sharing the work in a group. To grow further, she can choose units that suit each measurement and check conversions. One thing to try at home: ask her what pattern the numbers from an experiment showed.

### Proficient

**Cece, Proficiency class, press 1.** In Science 8, it is clear that Cece consistently shows data patterns in tables, graphs and models. So far in Science 8, her work sits at a Proficient level. In her work habits, she finishes her work by the due date. Her Biodiversity Field Journal stands out, and in it she showed that she can plan an investigation that collects reliable data. Looking ahead in Science 8, she can explain why a science problem matters locally or globally.

**Liam, Proficiency class, press 3.** Right now, Liam is at a Proficient level in Science 8, showing the expected learning, consistently or most of the time. Top marks went to his result on the Microscope Skills Check. Putting his phone away when asked is the habit to build. His Science 8 marks show that he can consistently explore and explain the local environment. From here, he can choose a question that a fair test can answer. Ask him what question an experiment in class was trying to answer, when the chance is there.

### Developing

**Ethan, Proficiency class, press 2.** Showing data patterns in tables, graphs and models is where Ethan’s work has grown most, from Emerging to Developing. He is working at a Developing level in Science 8. Coming to class with what he needs is the habit to build; he already keeps his device on the lesson. Top marks went to his Science Fair Proposal. From here, he can keep exploring one science topic over several weeks.

**Darius, Proficiency class, press 1.** Of Darius’s work so far, the best is the Biodiversity Field Journal. Over the year, he has worked at a Developing level in Science 8. As a habit, he joins class discussions. Building two habits would help: coming to class with what he needs, and doing his part in a group task. Next, he can keep exploring one science topic over several weeks.

### IE

**Ethan, Letter class at grade 10, press 1.** IE is Ethan’s grade in Science 8 at this point. Across the marked work, his average is under 50 percent. Day after day, he uses class devices for the task at hand. Showing more of the learning in his work is what he needs to do to earn a grade. A short meeting would help us agree on this plan; please contact me.

**Raj, Letter class at grade 10, press 2.** For now, Raj’s Science 8 grade is IE. Across the marked work, his average is under 50 percent. Each week, he starts the task as soon as class begins. To replace the IE with a grade, he needs to show more of the learning in his work. I would like to meet with you to talk about this plan; please contact me.

### C+

**Sam (they/them), Letter class, press 1.** With a C+ in Science 8, Sam is doing good work. They would get more from class by sharing the work in a group and making one change from each piece of feedback. So far, their best piece is their Energy Transfer Investigation. In class tasks, they can consistently apply science learning to new situations. The goal for them now is to keep exploring one science topic over several weeks. Families can help too: ask them what question an experiment in class was trying to answer.

**Caleb, Letter class, press 2.** Among Caleb’s pieces, the Circuit Design Challenge earned the top mark. He has a C+ in Science 8, which is good work. Most days he starts the task as soon as class begins, and keeping his device on the task would help him most. Across the year, his marks show that he consistently observes nature and asks questions about it. A good next step is for him to measure correctly and record units each time.

### Strong, One Habit to Build

**Sofia, Proficiency class, press 1.** Sofia’s best piece is her Circuit Design Challenge, where she showed she can follow safety and ethical guidelines in investigations. At a Proficient level in Science 8, she is showing the expected learning, consistently or most of the time. Going forward, using the device for the work in front of her is the habit to build. She has moved from Developing to Proficient in exploring and explaining the local environment. What would help her most now is to explain why a science problem matters locally or globally.

**Tessa (B), Letter class, press 3.** In Tessa’s Mineral Identification Lab, her best piece, she named the trend in her results. A B is her mark in Science 8, and that is very good work. From her marks, it is clear that she can apply science learning to new situations most of the time. A habit that would help her is asking what to change after a piece is marked. For now, the aim is for her to explain why a science problem matters locally or globally.

## Blind Sort Sheet

Ten generated drafts mixed with the ten stand-in comments in `docs/generate-gold-standin.md` (seed 11). The stand-ins are not Colin's; the release test needs ten to twenty of his own comments in their place, read by three people, sorted at 60% or worse.

### Which Were Written by a Teacher?

For each comment, write T (a teacher wrote it) or G (it was generated). 20 comments; half are each.

1. Ethan's marks for showing patterns in data have risen from Emerging to Developing. He is now working at a Developing level in Science 8. His Science Fair Proposal is his best piece. He uses the class devices well, and starting work when class begins is the habit to build. Next, he can follow one science topic for several weeks and see what questions it raises. If he notices something odd at home, ask him what he thinks is causing it.

   T / G

2. The mark Caleb has earned in Science 8 is a C+, good work, and his Circuit Design Challenge earned his highest mark. Across his work in Science 8, he can consistently observe nature and ask questions about it. In class, the habit to build is putting his phone away when asked. From here, he can measure correctly and record units each time. Ask him how he would test which of two things lasts longer, when the chance is there.

   T / G

3. Liam's marks in Science 8 put him at a Proficient level. He explains what he sees in the local environment, and his Microscope Skills Check earned his highest mark. He comes to class ready and finishes his work on time. Keeping his phone away during lessons is the habit to build. The next step is for him to choose a question that a fair test can answer.

   T / G

4. Ethan's grade in Science 8 is IE for now, because his marks so far average under 50 percent. There is time to change that. His best piece is his Earth Science Unit Test. He uses the class devices well, and starting work when class begins would help him most. The plan is for him to follow one science topic over several weeks and finish the pieces that count. Please call or email me so we can set a deadline together.

   T / G

5. Science 8 is going well for Cece, who is working at a Proficient level. Her Biodiversity Field Journal is her best piece, and it shows how clearly she presents data in tables and graphs. She hands in her work on time and comes to class ready. Next, she can explain why a science problem matters to people here and elsewhere. When something in the news is about science, ask her who it affects.

   T / G

6. Recent work in Science 8 shows Mei’s marks rising. In Science 8, the work she does is at an Extending level. Her Data Reading Quiz result is her best. She would get more from class by listening to others in group work and asking what to change after a piece is marked. The next thing to practise is choosing units that suit each measurement and check conversions.

   T / G

7. Over the year, Mateo’s work in Science 8 has earned a B, which is very good work. He works well in a group; finishing each piece by its due date would help him most. It is his Chemical Reactions Lab that stands out as his best piece. Over recent weeks, his marks in Science 8 have climbed. The step that would help most now is to explain why a science problem matters locally or globally. At home, ask him what question an experiment in class was trying to answer.

   T / G

8. In Science 8, it is clear that Cece consistently shows data patterns in tables, graphs and models. So far in Science 8, her work sits at a Proficient level. In her work habits, she finishes her work by the due date. Her Biodiversity Field Journal stands out, and in it she showed that she can plan an investigation that collects reliable data. Looking ahead in Science 8, she can explain why a science problem matters locally or globally.

   T / G

9. Noor is working at an Extending level in Science 8. Her Science Fair Proposal is the piece that stands out, and it earned her top mark. In class she joins discussions and uses feedback to improve the next piece. Starting the task as soon as class begins would help her get more from each lesson. Her next step is to find the sources of error in an investigation and suggest a change for each. At home, ask her how sure the class can be about a result.

   T / G

10. Caleb has a C+ in Science 8, which is good work. His Circuit Design Challenge is his best piece. He looks closely at the world outdoors and asks questions about what he sees, and he hands in his work on time. Putting his phone away when asked is the one habit to build. Next, he can measure carefully and write the units down each time. At home, ask him to measure something in the kitchen and tell you the units.

T / G

11. Tessa's mark in Science 8 is a B, very good work. Her Mineral Identification Lab earned her highest mark, and in it she used what she had learned in a new setting. She completes her work on time. Reading the feedback on a piece and using it on the next one is the habit to build. Her next step is to explain why a science problem matters to people here and elsewhere.

T / G

12. Darius is at a Developing level in Science 8, which means his understanding is growing and becoming steadier. His best piece is his Biodiversity Field Journal. He asks questions in class and uses feedback on his work. Using the start of class well and sharing the work in a group would help him most. His next step is to follow one science topic over several weeks and keep asking questions about it.

T / G

13. Sam’s Science 8 marks show that they consistently apply science learning to new situations. Over the year, they have worked at a Proficient level in Science 8. Two habits would help: listening to others in group work and asking what to change after a piece is marked. The Energy Transfer Investigation is their best piece. Sam’s next step is to keep exploring one science topic over several weeks.

T / G

14. Recent work in Science 8 shows Amara’s marks rising. So far, her mark in Science 8 is an A, which is excellent work. The habits to build are listening to others in group work and asking what to change after a piece is marked. Of all her work in Science 8, the Science Fair Proposal stands out. The goal for her now is to find sources of error and suggest improvements.

T / G

15. Anisa is working at a Proficient level in Science 8. From her marks, it is clear that she can consistently show data patterns in tables, graphs and models. In Science 8, her highest mark came on the Scientific Method Quiz. While she shares the work in a group, the habit to build is finishing each piece by its due date. Over time, she can record both observations and measurements with precision. Families can help too: ask her how she would test which of two things lasts longer.

T / G

16. Sam is working at a Proficient level in Science 8. Their Energy Transfer Investigation is their best piece; it shows they can use a science idea in a new setting. They complete their work and come to class ready. Sharing the work in a group is the habit to build. Their next step is to follow one science topic over several weeks. At home, you could ask them what question an experiment in class was trying to answer.

T / G

17. Right now, Liam is at a Proficient level in Science 8, showing the expected learning, consistently or most of the time. Top marks went to his result on the Microscope Skills Check. Putting his phone away when asked is the habit to build. His Science 8 marks show that he can consistently explore and explain the local environment. From here, he can choose a question that a fair test can answer. Ask him what question an experiment in class was trying to answer, when the chance is there.

T / G

18. Raj is at an Emerging level in Science 8, so the first signs of the learning are there. His Science Fair Proposal is the piece that shows them most. He comes to class ready, works well in a group and joins discussions. Finishing each piece by its due date would help his marks show what he knows. His next step is to ask his own questions about a science topic that interests him.

T / G

19. Top marks went to Fatima’s Biodiversity Field Journal. With a B in Science 8, she is doing very good work. She comes to class ready to work; completing work on time would help her most. Across her work in Science 8, she consistently shows data patterns in tables, graphs and models. Practice at planning a simple investigation to test a claim would help her most now.

T / G

20. Ethan’s highest mark was on the Earth Science Unit Test. As a rule, he uses class devices for the task at hand. The one habit that would help him most is using the start of class well. His Science 8 marks show that he is starting to explore and explain the local environment in more of his work. A good next step is for him to keep exploring one science topic over several weeks.

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
