# Term Questionnaire: the redesigned page

Colin and Claude drew this on Nov 25, 2026. The artboards are the "Teacher Comment Board" (https://claude.ai/artifact/DKrmmQUAJndT3xiaEcGGKo): "Term Questionnaire · Whole Page" is the page, "Sentences · One Box per Part" is the Sentences card on its own. Both run when played. A built screen is compared with its artboard before its slice merges.

The intention is the app's: a teacher writes a comment from everything the gradebook knows about the student (work, skills, habits, observations, the student's own words), and the screen shows that evidence beside the words.

## The order of work

Colin, Nov 25: "build the page first, and we'll wire in the database afterwards." So this plan builds what today's data and saves already allow. Anything that needs a new table, a new column or new saved data is listed under "After the page" and is not built here.

## What Colin decided

1. **One box per part.** Each part of the comment (Grade, Best Piece, Strength, Work Habits, the student's Voice, Missing Work, Next Step with Support, Closing) is its own box. Two sentences of one part that sit together share a box.
2. **Each box leads with its evidence.** The top line has the part's tile and name and, at the right, what the sentence rests on (the grade, the piece and its result, the skill, the six habit ratings, the count of missing work). The grey source line under each sentence goes; its words stay in the sentence's tooltip.
3. **No superfluous grey text.** The line under "Sentences" goes. An empty part shows one button ("+ Late Work Line for the Class", "+ Support Line", "+ Closing Sentence for the Class") in place of a grey sentence.
4. **One name per thing:** Strength, Work Habits, the student's Voice ("Liam's Voice"), Missing Work. The same name on the left cards, the boxes, the menus and Browse Sentences.
5. **The header** drops the word under the grade (Excellent … Minimally acceptable) and reads "21 of 31 handed in".
6. **Approve and Next is always on.** The "I checked this" ticks go. Where approving would print something wrong (an IE with no deadline, a sentence that no longer matches the gradebook), pressing it goes to that box. This reverses the ticks of the Generate plan (PR 3, PR 11c).
7. **Missing-work sentences** are the five approved on the board ("He has ten assignments still to hand in." and its kin). None says "this term".
8. **Year to date.** Nothing about grades, work, skills or attendance says "this term"; it is "so far this year" and "since the report".
9. **Nothing is removed.** Reordering, adding between sentences, every Options menu, Browse Sentences, Write Your Own, Show Both and the rest stay.
10. **Adding and editing take one click.** "+ Add a Sentence" beside Browse Sentences; pointing between two sentences shows "+ Add a Sentence Here" after a short pause, drawn over the gap so nothing moves; clicking a sentence edits it in place.
11. **Motion** is 140 to 200 ms and continuous: a dragged sentence lifts and follows the pointer, a slot shows where it lands, the others glide, a new sentence opens downward, nothing fades in. Reduce Motion turns it off.
12. **The projected grade never prints.** If it is built, it is a teacher-only note on the Missing Work box.
13. **Next Step.** A curricular competency's name is never the step. A step is something the student can do; the competency is only the reason. The sentences for this come from a bank written by subject and grade, which is its own project (below).
14. **Comments only.** This page writes the comment and never changes a gradebook status; work is excused or handed in from the grader (Colin, Nov 25: "No, comments only.").

## Slices

The slices are grouped into three pieces, each built by one builder in one pull request: the Sentences card (slices 1, 4, 5 and 6), the wording (slice 3), and Approve, the left cards and Work Habits (slices 2, 7 and 8). Each keeps Demo Mode working and rewrites the browser tests it changes.

| Slice | What it builds                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | The look of the Sentences card: boxes, the evidence line, the tighter sizes, the names (decisions 1 to 4), and the header (5). No behaviour changes.    |
| 2     | Approve and Next always on (6). A DECISIONS entry records the reversal.                                                                                 |
| 3     | The wording: missing-work sentences (7) and year to date (8), with saved comments that use a retired sentence left as they are.                         |
| 4     | Adding and editing (10).                                                                                                                                |
| 5     | Dragging and motion (11), and the keys: Esc closes a menu or cancels a drag, arrow keys move through a menu.                                            |
| 6     | The menus: Pick the Piece on Best Piece, Pick the Skill on Strength, See the N on Missing Work with Open in Grader.                                     |
| 7     | The left cards in the same look: tiles and names, At a Glance rows in their part's colour, a card and its sentence lighting each other when pointed at. |
| 8     | Work Habits in the box (the six bars open the ratings), the note when a habit sentence and the missing work disagree, and "+ Close to a C+".            |

## Waiting on Colin

Each of these is drawn. None is built until he says so.

- **"If Handed In"**, the teacher-only projected grade. New grade math.
- **Grade So Far This Year**, the line of the grade since September. It reads `calc.js` at earlier dates; his review.
- **"+ What You Wrote on It"**, which quotes the teacher's feedback on the best piece.
- **"+ His Next Chance"**, which names the next assignment that assesses the same thing.

## After the page

These need new saved data, so they follow the page:

- The next-step bank, by subject and grade (decision 13), written by the method of the I Can statements: Colin approves examples, the rest are adapted from them and checked, the result is data, and the app makes no AI calls.
- A teacher's own next steps, kept under a competency for the class.
- A second closing for students who need a conversation.

## For each slice

- Read `docs/plans/questionnaire-file-map.md` first; `teacher/report-questionnaire.js` is one closure of about 8,400 lines.
- Grades and levels are worded only by `calc.js` and its helpers (CLAUDE.md rule 3).
- Check the built screen against the artboard at 1280, 1440 and 1680 wide and at the iPad widths (744, 820, 1024), in the page font and in a wide font.
