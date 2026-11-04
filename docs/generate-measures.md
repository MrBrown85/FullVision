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

## After (feat/generate-flow, Nov 4 2026, after the second blind sort)

The harness drafts the way a teacher does: each press goes down the roster with the class's comments so far passed in, and the text on screen from the press before (Generate passes both). "Facts per draft" counts a joined sentence as two. The fresh-seed line reruns the class twice on presses no committed run used.

| Measure                                    | Value             | Target                          | Met |
| ------------------------------------------ | ----------------- | ------------------------------- | --- |
| Top first-sentence shape                   | 7.4%              | ≤ 15%                           | yes |
| Largest shape family                       | 43.1%             | ≤ 25%                           | no  |
| Largest frame share of a part              | 9.9%              | ≤ 10%                           | yes |
| Consecutive same-opener pairs              | 0                 | 0                               | yes |
| "this term" per draft                      | 0                 | 0                               | yes |
| "so far" per draft (max)                   | 1                 | ≤ 1                             | yes |
| "proficiency scale" per draft (max)        | 1                 | ≤ 1                             | yes |
| Banned phrases                             | 0                 | 0                               | yes |
| Presses changing ≥ 4 sentences             | 99.4% (min 3)     | 100%                            | no  |
| Neighbour edit distance                    | 0.89              | ≥ 0.6                           | yes |
| Adjacent students sharing first 3 words    | 0 (worst class 0) | ≤ 2 a class                     | yes |
| Facts per draft (a joined sentence is two) | 5.62 (4–7)        | 5–7                             | no  |
| Words per sentence                         | 14.52 (max 24)    | mean ≈ 15, max ≤ 24             | yes |
| Press edit distance                        | 0.81              | ≥ 0.6                           | yes |
| Comments with a time opener                | 12.5%             | ≤ 25%                           | yes |
| Time openers in one comment (max)          | 1                 | ≤ 1                             | yes |
| Stock time openers                         | 0                 | 0                               | yes |
| Comments repeating a 3-word run            | 0                 | 0                               | yes |
| Classmate pairs under 0.5 edit distance    | 0                 | 0                               | yes |
| Comments of 5+ sentences with no join      | 102               | 0                               | no  |
| Most shared 4-word run in a class          | 59.3% of comments | reported                        | yes |
| Self-BLEU-3                                | 0.7               | reported (lower is more varied) | yes |
| Distinct-2 / distinct-3                    | 0.49 / 0.64       | reported                        | yes |

Frames per part (bank sentences used; the top sentence and its share of the part):

| Part     | Used | Top   | Share |
| -------- | ---- | ----- | ----- |
| example  | 60   | vbt08 | 9.9%  |
| grade    | 64   | vgl06 | 5.9%  |
| habits   | 37   | vh207 | 8.7%  |
| nextStep | 12   | vns21 | 9.3%  |
| home     | 14   | vho01 | 8.3%  |
| overall  | 34   | vcl05 | 6.3%  |

First-sentence families: name-first 43.1%, work-first 22.7%, course-first 13.4%, other 13%, time-first 7.9%.
Top first-sentence shapes: “the biodiversity field” 7.4%, “in science 8” 5.1%, “science 8 marks” 5.1%, “NAME science 8” 5.1%, “the science fair” 3.2% (71 distinct).

Fresh seeds (2 runs of 216, worst): top first-sentence shape 7.9%, largest shape family 45.4%, largest frame share of a part 11.1%; every target met: no.

Not met, and why: the largest shape family is name-first (43.1%), because every frame now opens on the student, the piece, the course or "Next" (the second blind sort: clefts and inversions read as assembled) and a time opener is allowed in one comment of four; the 25% cap was set when clefts were allowed. Presses changing four sentences: 99.4% (one press of 216 changes three). Facts per draft: a few drafts say four true things (an F in a Letter class has no grade sentence; a falling top skill has no strength sentence). Comments with no joined sentence: 102 of 216 (two facts join only when the grade, strength and piece sit side by side). On fresh seeds one frame reached 11.1% of its part.

## Twelve Drafts, Two per Standing

As Generate gives them, unedited, from the run above. Demo Mode has no IE student (grade 8 reports proficiency), so the two IE drafts come from the same class switched to grade 10, Letter, with IE chosen as the reporting basis.

### Extending

**Noor, Proficiency class, press 1.** In Science 8, Noor is at an Extending level, which means she is going beyond what the course expects. She joins in class discussions. To get more from each lesson, she can practise beginning the task as soon as class starts. Her Science Fair Proposal is one of her strongest pieces, and she does well at explaining what she notices in the local environment. Next, she can learn to explain how much each error changed the results.

**Mei, Proficiency class, press 2.** Over the year, Mei studies one local place over time and explains what changes. Science 8 marks place her at an Extending level so far, and she earned one of her top marks on the Data Reading Quiz. Her goal in class is doing her part in a group task. Next, she can learn to show the units at each step of a calculation. You could ask her to measure a room in metres and then in centimetres.

### Proficient

**Cece, Proficiency class, press 1.** The Biodiversity Field Journal shares Cece’s top mark with other pieces. Her marks put her at a Proficient level in Science 8. She both starts the task as soon as class begins and works well in a group. Her next goal is to describe how the issue looks in B.C. and in another country.

**Liam, Proficiency class, press 3.** Liam has worked at a Proficient level in Science 8 over the year. He reliably comes to class ready to work. In class, he could focus on keeping his phone away during lessons. One of his highest marks came on the Microscope Skills Check, and he explains what he observes in the local environment using science ideas. To grow further, he can choose a question with something to measure in the answer. At home, it helps to ask him to think of a question about the kitchen that a simple test could answer.

### Developing

**Ethan, Proficiency class, press 2.** Ethan has grown from Emerging to Developing in giving a graph a title, axis names and units. His Science 8 work is at a Developing level, and the Science Fair Proposal is among his best pieces. He keeps his phone away during lessons. To get more from each lesson, he can practise beginning the task as soon as class starts. Looking ahead, he can add one new note to his topic page each lesson.

**Darius, Proficiency class, press 1.** Science 8 marks place Darius at a Developing level so far, and the Biodiversity Field Journal is one of his strongest pieces. He joins in class discussions and uses feedback to improve his next piece. To get more from each lesson, he can practise coming to class with what he needs. After this, he can add one new note to his topic page each lesson.

### IE

**Ethan, Letter class at grade 10 with IE reporting, press 1.** In Science 8, Ethan has an IE for now. His marks to date average below 50 percent. I notice that he completes his work on time. Showing more of the learning in his work is what he needs to do to earn a grade. I would like to make a plan with you and him; please call or email me to set a time.

**Raj, Letter class at grade 10 with IE reporting, press 2.** In Science 8, Raj has an IE for now. His marks to date average below 50 percent. He finishes his work by the due date. To replace the IE with a grade, he needs to show more of the learning in his work. A short meeting with you and him would help us set a plan; please call or email me.

### C+

**Sam (they/them), Letter class, press 1.** In Sam’s Energy Transfer Investigation, one of their strongest pieces, they calculated averages to compare trials in their lab. Their Science 8 mark is a C+, which is good work. They can make progress by listening to others in group work. With some practice, they can add one new note to their topic page each lesson. At home, ask them to pick one thing in the yard to watch for a few weeks and say what changes.

**Caleb, Letter class, press 2.** On Caleb’s Circuit Design Challenge, he earned his top mark. He has a C+ in Science 8, which is work of a good standard. I notice that he starts the task as soon as class begins. He would gain most from keeping his device on the task. Next, he can learn to use the smallest marks on a ruler.

### Strong, One Habit to Build

**Sofia, Proficiency class, press 1.** Of all Sofia’s work in Science 8, the Circuit Design Challenge stands out, and her work is at a Proficient level. In using what local people know about a nearby place, her work has risen from Developing to Proficient. She consistently starts the task as soon as class begins. Her goal in class is keeping her phone away during lessons. Next, she can learn to explain why the topic matters to families nearby.

**Tessa (B), Letter class, press 3.** In Tessa’s Mineral Identification Lab, one of her strongest pieces, she noted a result that broke the pattern in her lab conclusion. She has earned a B in Science 8, work of a high standard. In her assignments, she explains what a local place means to her and to others. She is a student who finishes her work by the due date. In class, she could focus on using the feedback on one piece in the next. From here, she can describe how the issue looks in B.C. and in another country.

## Blind Sort Sheet

Ten generated drafts mixed with the ten stand-in comments in `docs/generate-gold-standin.md` (seed 37, a new draw). The stand-ins are not Colin's; the release test needs ten to twenty of his own comments in their place, read by three people, sorted at 60% or worse.

### Which Were Written by a Teacher?

For each comment, write T (a teacher wrote it) or G (it was generated). 20 comments; half are each.

1. In Sam’s Energy Transfer Investigation, one of their strongest pieces, they calculated averages to compare trials in their lab. Their mark in Science 8 is a C+, good work. They would gain most from listening to others in group work. Looking ahead, they can return to one science question each week for a month. When they bring work home, ask them to pick one thing in the yard to watch for a few weeks and say what changes.

   T / G

2. Ethan's marks for showing patterns in data have risen from Emerging to Developing. He is now working at a Developing level in Science 8. His Science Fair Proposal is his best piece. He uses the class devices well, and starting work when class begins is the habit to build. Next, he can follow one science topic for several weeks and see what questions it raises. If he notices something odd at home, ask him what he thinks is causing it.

   T / G

3. Ethan has grown from Emerging to Developing in giving a graph a title, axis names and units. His Science 8 work is at a Developing level, and the Science Fair Proposal is among his best pieces. He keeps his phone away during lessons. To get more from each lesson, he can practise beginning the task as soon as class starts. Looking ahead, he can add one new note to his topic page each lesson.

   T / G

4. Anisa’s Science 8 work is at a Proficient level, and the Scientific Method Quiz is among her highest marks. She consistently shares the work in a group. In class, she could focus on finishing each piece by its due date. Next, she can add a column for what she sees during the lab. At home, ask her to measure a cup of flour in the kitchen and say how sure the reading is.

   T / G

5. The Data Reading Quiz is among Mei’s highest marks, and her Science 8 work is at an Extending level. She compares two local places and explains why they differ. Her next steps in class are sharing the work in a group and using the feedback on one piece in the next. From here, she can check that each converted answer makes sense.

   T / G

6. Science 8 work has earned Noor an A, which is work of a very high standard. She asks questions in class and uses feedback to improve her next piece. Her next habits to build are starting work when class begins and listening to others in group work. The Science Fair Proposal is among her best pieces. In her assignments, she connects views of a place to choices about caring for it. With some practice, she can estimate the size of each error. If she talks about class at home, ask her what might make a kitchen scale give a wrong reading.

   T / G

7. Caleb is earning a C+ in Science 8, solid work. He consistently comes to class ready to work and finishes his work by the due date. His goal in class is keeping his device on the task. This year, his best piece is his Circuit Design Challenge. Caleb can now aim to measure twice and compare the readings. You might ask him to measure a cup of flour in the kitchen and say how sure the reading is.

   T / G

8. Liam's marks in Science 8 put him at a Proficient level. He explains what he sees in the local environment, and his Microscope Skills Check earned his highest mark. He comes to class ready and finishes his work on time. Keeping his phone away during lessons is the habit to build. The next step is for him to choose a question that a fair test can answer.

   T / G

9. Jas has a B in Science 8, which is strong work. He completes his work on time. His goal in class is making one change from each piece of feedback. The Data Analysis Project is one of his strongest pieces. To grow further, he can stay with the same question until he has three answers.

   T / G

10. Noor is working at an Extending level in Science 8. Her Science Fair Proposal is the piece that stands out, and it earned her top mark. In class she joins discussions and uses feedback to improve the next piece. Starting the task as soon as class begins would help her get more from each lesson. Her next step is to find the sources of error in an investigation and suggest a change for each. At home, ask her how sure the class can be about a result.

T / G

11. Science 8 work puts Jordan at a Proficient level, and the Science Fair Proposal is one of his strongest pieces. Over the year, he makes tables and graphs that show a pattern in the data. His goal in class is asking a question when something is unclear. Next, he can learn to use lab results to decide whether a claim holds. To support this at home, ask him what evidence a cleaning product label gives for its claims.

T / G

12. Tessa's mark in Science 8 is a B, very good work. Her Mineral Identification Lab earned her highest mark, and in it she used what she had learned in a new setting. She completes her work on time. Reading the feedback on a piece and using it on the next one is the habit to build. Her next step is to explain why a science problem matters to people here and elsewhere.

T / G

13. Sam is working at a Proficient level in Science 8. Their Energy Transfer Investigation is their best piece; it shows they can use a science idea in a new setting. They complete their work and come to class ready. Sharing the work in a group is the habit to build. Their next step is to follow one science topic over several weeks. At home, you could ask them what question an experiment in class was trying to answer.

T / G

14. The Biodiversity Field Journal earned one of Fatima’s top marks, and she is earning a B in Science 8, work of a high standard. I notice that she comes to class ready to work. Her goal in class is finishing each piece by its due date. Next, she can learn to design a fair test of an advertised claim.

T / G

15. Science 8 is going well for Cece, who is working at a Proficient level. Her Biodiversity Field Journal is her best piece, and it shows how clearly she presents data in tables and graphs. She hands in her work on time and comes to class ready. Next, she can explain why a science problem matters to people here and elsewhere. When something in the news is about science, ask her who it affects.

T / G

16. Caleb has a C+ in Science 8, which is good work. His Circuit Design Challenge is his best piece. He looks closely at the world outdoors and asks questions about what he sees, and he hands in his work on time. Putting his phone away when asked is the one habit to build. Next, he can measure carefully and write the units down each time. At home, ask him to measure something in the kitchen and tell you the units.

T / G

17. Darius is at a Developing level in Science 8, which means his understanding is growing and becoming steadier. His best piece is his Biodiversity Field Journal. He asks questions in class and uses feedback on his work. Using the start of class well and sharing the work in a group would help him most. His next step is to follow one science topic over several weeks and keep asking questions about it.

T / G

18. Raj is at an Emerging level in Science 8, so the first signs of the learning are there. His Science Fair Proposal is the piece that shows them most. He comes to class ready, works well in a group and joins discussions. Finishing each piece by its due date would help his marks show what he knows. His next step is to ask his own questions about a science topic that interests him.

T / G

19. Tyler is working at a Developing level in Science 8, and his Forces & Motion Quick Check result is his best. He consistently shares the work in a group and asks questions in class. His next habits to build are keeping track of due dates and starting work when class begins. From here, he can ask what a source leaves unsaid.

T / G

20. Ethan's grade in Science 8 is IE for now, because his marks so far average under 50 percent. There is time to change that. His best piece is his Earth Science Unit Test. He uses the class devices well, and starting work when class begins would help him most. The plan is for him to follow one science topic over several weeks and finish the pieces that count. Please call or email me so we can set a deadline together.

T / G

### Answer Key

Seed 37.

1. G (generated)
2. T (control)
3. G (generated)
4. G (generated)
5. G (generated)
6. G (generated)
7. G (generated)
8. T (control)
9. G (generated)
10. T (control)
11. G (generated)
12. T (control)
13. T (control)
14. G (generated)
15. T (control)
16. T (control)
17. T (control)
18. T (control)
19. G (generated)
20. T (control)
