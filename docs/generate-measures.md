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

## After (feat/generate-flow, Nov 4 2026, after the blind sort and the four-audience review)

The harness now drafts the way a teacher does: each press goes down the roster with the class's comments so far passed in, and the text on screen from the press before (Generate passes both). "Facts per draft" counts a joined sentence as two. The fresh-seed line reruns the class twice on presses no committed run used.

| Measure                                    | Value             | Target                          | Met |
| ------------------------------------------ | ----------------- | ------------------------------- | --- |
| Top first-sentence shape                   | 14.8%             | ≤ 15%                           | yes |
| Largest shape family                       | 28.7%             | ≤ 25%                           | no  |
| Largest frame share of a part              | 9%                | ≤ 10%                           | yes |
| Consecutive same-opener pairs              | 0                 | 0                               | yes |
| "this term" per draft                      | 0                 | 0                               | yes |
| "so far" per draft (max)                   | 1                 | ≤ 1                             | yes |
| "proficiency scale" per draft (max)        | 1                 | ≤ 1                             | yes |
| Banned phrases                             | 0                 | 0                               | yes |
| Presses changing ≥ 4 sentences             | 98.8% (min 3)     | 100%                            | no  |
| Neighbour edit distance                    | 0.9               | ≥ 0.6                           | yes |
| Adjacent students sharing first 3 words    | 3 (worst class 1) | ≤ 2 a class                     | yes |
| Facts per draft (a joined sentence is two) | 5.62 (3–7)        | 5–7                             | no  |
| Words per sentence                         | 14.8 (max 24)     | mean ≈ 15, max ≤ 24             | yes |
| Press edit distance                        | 0.8               | ≥ 0.6                           | yes |
| Comments with a time opener                | 10.2%             | ≤ 25%                           | yes |
| Time openers in one comment (max)          | 1                 | ≤ 1                             | yes |
| Stock time openers                         | 0                 | 0                               | yes |
| Comments repeating a 3-word run            | 0                 | 0                               | yes |
| Classmate pairs under 0.5 edit distance    | 0                 | 0                               | yes |
| Comments of 5+ sentences with no join      | 107               | 0                               | no  |
| Most shared 4-word run in a class          | 59.3% of comments | reported                        | yes |
| Self-BLEU-3                                | 0.72              | reported (lower is more varied) | yes |
| Distinct-2 / distinct-3                    | 0.47 / 0.63       | reported                        | yes |

Frames per part (bank sentences used; the top sentence and its share of the part):

| Part     | Used | Top   | Share |
| -------- | ---- | ----- | ----- |
| example  | 66   | vbt08 | 8.2%  |
| grade    | 67   | vgl04 | 9%    |
| habits   | 35   | vsh18 | 7.1%  |
| nextStep | 14   | vns01 | 7.4%  |
| home     | 17   | vho01 | 8.3%  |
| overall  | 39   | vcl05 | 6.4%  |

First-sentence families: name-first 28.7%, course-first 25.9%, other 21.3%, work-first 13.9%, time-first 7.9%, grade-first 2.3%.
Top first-sentence shapes: “in science 8” 14.8%, “science 8 work” 7.4%, “one of NAME” 4.2%, “science 8 marks” 3.7%, “NAME marks have” 2.8% (78 distinct).

Fresh seeds (2 runs of 216, worst): top first-sentence shape 13%, largest shape family 30.6%, largest frame share of a part 11.1%; every target met: no.

Not met: the largest shape family (28.7% name-first; grade sentences may now open only on the student or the course, and a time opener is allowed in one comment of four, which leaves four families for the first sentence); presses changing four sentences (98.8%: three presses of 216 change three); facts per draft (an F in a Letter class has no grade sentence, and a student whose top skill is falling has no strength sentence, so a few drafts say three or four true things); comments with no joined sentence (107 of 216: two facts join only when they sit side by side and one is the grade, the strength or the piece); and on fresh seeds one frame reached 11.1% of its part.

| Measure                                 | Before             | After            | Target                |
| --------------------------------------- | ------------------ | ---------------- | --------------------- |
| Largest shape family                    | 48.1%              | 28.7%            | ≤ 25%                 |
| Largest frame share of a part           | 30.1%              | 9% (11.1% fresh) | ≤ 10%                 |
| "this term" per draft                   | 1.73               | 0                | 0                     |
| Banned phrases                          | 589                | 0                | 0                     |
| Presses changing ≥ 4 sentences          | 94.4% (min 3)      | 98.8% (min 3)    | 100%                  |
| Adjacent students sharing first 3 words | 24 (worst class 5) | 0                | ≤ 2 a class           |
| Classmate pairs under 0.5 edit distance | not measured       | 0                | 0                     |
| Comments repeating a 3-word run         | not measured       | 0                | 0                     |
| Stock time openers                      | not measured       | 0                | 0                     |
| Comments with a time opener             | not measured       | 10.2%            | ≤ 25%                 |
| Press edit distance                     | 0.54               | 0.8              | ≥ 0.6                 |
| Self-BLEU-3                             | 0.84               | 0.72             | lower is more varied  |
| Distinct-2 / distinct-3                 | 0.33 / 0.45        | 0.47 / 0.63      | higher is more varied |

## Twelve Drafts, Two per Standing

As Generate gives them, unedited, from the run above. Demo Mode has no IE student (grade 8 reports proficiency), so the two IE drafts come from the same class switched to grade 10, Letter, with IE chosen as the reporting basis.

### Extending

**Noor, Proficiency class, press 1.** In Science 8, Noor is at an Extending level, which means she is going beyond what the course expects. The Science Fair Proposal shares her top mark with other pieces, and observing and describing nature close to home stands out in her work. She joins in class discussions. Beginning the task as soon as class starts would help, and so would sharing the work in a group. Next, she can explain how much each source of error changed the results.

**Mei, Proficiency class, press 2.** This year, Mei connects observations of a local place to several science ideas and explains the links. She is now at an Extending level in Science 8, which means she is going beyond what the course expects. Where she can grow in class is sharing the work in a group. She earned one of her top marks on the Data Reading Quiz. With practice in class, she can select fitting units and confirm every conversion. You might ask her to convert the millilitres on a juice carton to litres.

### Proficient

**Cece, Proficiency class, press 1.** Among Cece’s best pieces is her Biodiversity Field Journal. In Science 8, the work she does is at a Proficient level. She consistently starts the task as soon as class begins and works well in a group. Her next step is to connect a science problem to a local or world need.

**Liam, Proficiency class, press 3.** In Science 8, the work Liam does is at a Proficient level, and one of his highest marks came on the Microscope Skills Check. A strength in his work is studying a nearby place first-hand and explaining it. He reliably comes to class ready to work. The one habit that would help him most is keeping his phone away during lessons. One way to grow from here is to choose a question that a fair test can answer. When he brings work home, ask him which question about your kitchen, like why bread goes stale, a test could answer.

### Developing

**Ethan, Proficiency class, press 2.** There has been growth in turning results into a clear chart or labelled table, from Emerging to Developing. Ethan is at a Developing level in Science 8 so far. His Science Fair Proposal is one of his strongest pieces. He keeps his phone away during lessons. The one habit that would help him most is beginning the task as soon as class starts. One way to grow from here is to stay with one science topic across several weeks.

**Darius, Proficiency class, press 1.** Science 8 work puts Darius at a Developing level, and his Biodiversity Field Journal earned one of his top marks. He joins in class discussions and uses feedback to improve his next piece. Coming to class with what he needs would help him most. One way to grow from here is to keep exploring one science topic over several weeks.

### IE

**Ethan, Letter class at grade 10 with IE reporting, press 1.** In Science 8, Ethan has an IE for now. His marks to date average below 50 percent. I notice that he completes his work on time. Showing more of the learning in his work is what he needs to do to earn a grade. I would like to make a plan with you and him; please call or email me to set a time.

**Raj, Letter class at grade 10 with IE reporting, press 2.** In Science 8, Raj has an IE for now. His marks to date average below 50 percent. He finishes his work by the due date. To replace the IE with a grade, he needs to show more of the learning in his work. A short meeting with you and him would help us set a plan; please call or email me.

### C+

**Sam (they/them), Letter class, press 1.** The Energy Transfer Investigation is one of Sam’s strongest pieces, and their Science 8 mark is a C+, which is good work. They would gain most from listening to others in group work. The step that would help most now is to stay with one science topic across several weeks. When they bring work home, ask them what science question they have wondered about lately and why.

**Caleb, Letter class, press 2.** The Circuit Design Challenge is Caleb’s best piece: in it, he followed each safety rule during his lab. He is earning a C+ in Science 8, good work. I notice that he starts the task as soon as class begins. He would gain most from keeping his device on the task. With practice in class, he can check each reading and include its unit.

### Strong, One Habit to Build

**Sofia, Proficiency class, press 1.** Of all Sofia’s work in Science 8, the Circuit Design Challenge stands out, and her work is at a Proficient level. In studying a nearby place first-hand and explaining it, her work has risen from Developing to Proficient. She reliably comes to class ready to work. What would help her most in class is using the device for the work in front of her. The next thing to practise is connecting a science problem to a local or world need.

**Tessa (B), Letter class, press 3.** The Mineral Identification Lab shares Tessa’s top mark with other pieces, and she is earning a B in Science 8, very good work. In class, she finishes her work by the due date. What would help her most in class is asking what to change after a piece is marked. She can describe her own view of a place and consider others, one of her strengths. To grow further, she can connect a science problem to a local or world need.

## Blind Sort Sheet

Ten generated drafts mixed with the ten stand-in comments in `docs/generate-gold-standin.md` (seed 23, a new draw). The stand-ins are not Colin's; the release test needs ten to twenty of his own comments in their place, read by three people, sorted at 60% or worse.

### Which Were Written by a Teacher?

For each comment, write T (a teacher wrote it) or G (it was generated). 20 comments; half are each.

1. Science 8 work has earned Darius a C, which is satisfactory work. His Biodiversity Field Journal is one of his strongest pieces. He consistently asks questions in class. His next habits to build are beginning the task as soon as class starts and listening to others in group work. One way to grow from here is to stay with one science topic across several weeks.

   T / G

2. Caleb has a C+ in Science 8, which is good work. His Circuit Design Challenge is his best piece. He looks closely at the world outdoors and asks questions about what he sees, and he hands in his work on time. Putting his phone away when asked is the one habit to build. Next, he can measure carefully and write the units down each time. At home, ask him to measure something in the kitchen and tell you the units.

   T / G

3. This year, Mei connects observations of a local place to several science ideas and explains the links. She is earning an A in Science 8, excellent work, and the Data Reading Quiz is among her highest marks. Sharing the work in a group would help, and so would making one change from each piece of feedback. Looking ahead, she can select fitting units and confirm every conversion. You might ask her to convert the millilitres on a juice carton to litres.

   T / G

4. In Science 8, Olivia is earning a B, which is very good work. Her Chemical Reactions Lab earned one of her top marks. She reliably completes her work on time. The habit to build is asking what to change after a piece is marked. What would help her most now is to add new facts to one science topic over a month.

   T / G

5. Raj’s Science Fair Proposal earned one of his top marks, and he can keep other variables the same in some of his work. I notice that he comes to class ready to work. He can practise finishing each piece by its due date. What would help him most now is to name a science topic he wonders about and ask one question.

   T / G

6. Noor is working at an Extending level in Science 8. Her Science Fair Proposal is the piece that stands out, and it earned her top mark. In class she joins discussions and uses feedback to improve the next piece. Starting the task as soon as class begins would help her get more from each lesson. Her next step is to find the sources of error in an investigation and suggest a change for each. At home, ask her how sure the class can be about a result.

   T / G

7. Liam's marks in Science 8 put him at a Proficient level. He explains what he sees in the local environment, and his Microscope Skills Check earned his highest mark. He comes to class ready and finishes his work on time. Keeping his phone away during lessons is the habit to build. The next step is for him to choose a question that a fair test can answer.

   T / G

8. Raj is at an Emerging level in Science 8, so the first signs of the learning are there. His Science Fair Proposal is the piece that shows them most. He comes to class ready, works well in a group and joins discussions. Finishing each piece by its due date would help his marks show what he knows. His next step is to ask his own questions about a science topic that interests him.

   T / G

9. Darius is at a Developing level in Science 8, which means his understanding is growing and becoming steadier. His best piece is his Biodiversity Field Journal. He asks questions in class and uses feedback on his work. Using the start of class well and sharing the work in a group would help him most. His next step is to follow one science topic over several weeks and keep asking questions about it.

   T / G

10. Tyler earned one of his top marks on the Forces & Motion Quick Check. His Science 8 mark is a C-, which is minimally acceptable work. In class, he shares the work in a group. His next habits to build are keeping track of due dates and starting work when class begins. Practice at identifying assumptions in a source or in a lab would help him most now.

T / G

11. Jas has a B in Science 8 so far, which is very good work. He consistently completes his work on time. Where he can grow in class is making one change from each piece of feedback. His Data Analysis Project earned one of his top marks. After this, he can keep exploring one science topic over several weeks.

T / G

12. In Science 8, the work Tessa does is at a Proficient level, and her Mineral Identification Lab is among her best pieces. She judges how fair an experiment was and how good its data are, a strength in her work. In class, she completes her work on time. She would get more from each class by making one change from each piece of feedback. The step that would help most now is to say why a science issue matters to people in B.C. or elsewhere.

T / G

13. Ethan's marks for showing patterns in data have risen from Emerging to Developing. He is now working at a Developing level in Science 8. His Science Fair Proposal is his best piece. He uses the class devices well, and starting work when class begins is the habit to build. Next, he can follow one science topic for several weeks and see what questions it raises. If he notices something odd at home, ask him what he thinks is causing it.

T / G

14. Tessa's mark in Science 8 is a B, very good work. Her Mineral Identification Lab earned her highest mark, and in it she used what she had learned in a new setting. She completes her work on time. Reading the feedback on a piece and using it on the next one is the habit to build. Her next step is to explain why a science problem matters to people here and elsewhere.

T / G

15. Sam is working at a Proficient level in Science 8. Their Energy Transfer Investigation is their best piece; it shows they can use a science idea in a new setting. They complete their work and come to class ready. Sharing the work in a group is the habit to build. Their next step is to follow one science topic over several weeks. At home, you could ask them what question an experiment in class was trying to answer.

T / G

16. Maya identifies sources of error and suggests improvements to the method, and her marks show it. She is working at a Proficient level in Science 8, and the Scientific Method Quiz is among her highest marks. In class, she makes changes from the feedback on her work and keeps her phone away during lessons. She can practise completing work on time. What would help her most now is to connect a science problem to a local or world need. One idea for home: ask her what science question she has wondered about lately and why.

T / G

17. Ethan's grade in Science 8 is IE for now, because his marks so far average under 50 percent. There is time to change that. His best piece is his Earth Science Unit Test. He uses the class devices well, and starting work when class begins would help him most. The plan is for him to follow one science topic over several weeks and finish the pieces that count. Please call or email me so we can set a deadline together.

T / G

18. Science 8 work has earned Marcus a C-, which is minimally acceptable work. He is starting to name the variable being changed in a test, which shows in his marks. The piece that stands out is his Chemical Reactions Lab. He asks questions in class and makes changes from the feedback on his work. Marcus’s next habits to build are starting work when class begins and doing his part in a group task. To grow further, he can stay with one science topic across several weeks. You could ask him what science question he has wondered about lately and why.

T / G

19. One of Jordan’s best pieces is his Science Fair Proposal, where he followed each safety rule during his lab. He has earned a B in Science 8, very good work. One thing he does well is showing data patterns in tables, graphs and models. He can practise asking a question when something is unclear and using the device for the work in front of him. Looking ahead, he can plan a simple investigation to test a claim.

T / G

20. Science 8 is going well for Cece, who is working at a Proficient level. Her Biodiversity Field Journal is her best piece, and it shows how clearly she presents data in tables and graphs. She hands in her work on time and comes to class ready. Next, she can explain why a science problem matters to people here and elsewhere. When something in the news is about science, ask her who it affects.

T / G

### Answer Key

Seed 23.

1. G (generated)
2. T (control)
3. G (generated)
4. G (generated)
5. G (generated)
6. T (control)
7. T (control)
8. T (control)
9. T (control)
10. G (generated)
11. G (generated)
12. G (generated)
13. T (control)
14. T (control)
15. T (control)
16. G (generated)
17. T (control)
18. G (generated)
19. G (generated)
20. T (control)
