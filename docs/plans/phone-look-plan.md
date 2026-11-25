# The phone's new look (2026-11-24)

**Status.** On for everyone since Nov 25 (Colin: "Deal with it"): L1, L2, L5, L6, Undo after a return (the first part of L3) and the Write a Bulletin sheet (the first part of L2b). Not built: the rest of L2b, L3, L4 and L7. L8's cleanup is still to do: the old layout's code and styles are not deleted yet, and the help pictures show the old screens.

**Why.** Colin, Nov 24: the phone's grading view is cluttered, and a teacher who is not a software user would be overwhelmed by it. The phone is a tool to be used in the moment: grade, observe, post. One strong control for each decision, the rest behind one tap, no grey lines of explanation.

**Board.** "Phone Grader, Redesigned" (https://claude.ai/artifact/9183YbyUHWKjotWVWo2Guq). Rows: the grader, its stress tests, three gaps filled, the same tabs tweaked with the profile, the profile's stress tests, and Pleasant Surprises.

**Switch.** `phoneLook` in `shared/build-flags.js`, on for everyone. With it on, `<html>` carries the class `m-look`. Turning it back off (its default to false) is the way back if something is wrong.

## The method: write as little as the board needs

The phone already does almost everything the board shows: the four levels, + and −, a criterion's checklist and comment, the Overall Comment, Return and Next, For Revision, Missing, Excused and Late, the photos full screen. The board changes how they look and where they sit, not what they do.

1. **The same markup, the same actions, the same tests.** The look is one stylesheet, `teacher-mobile/look.css`, and every rule in it starts with `.m-look`. With the switch off, nothing on the phone changes: the byte-for-byte walk in `tests/phone-return.test.js` holds it.
2. **JavaScript changes only where a style cannot do it,** and then it adds an attribute or a wrapper to what is already drawn. No second way of drawing a screen, no copy of a handler. A screen's additions live in a small file of their own (`grade-look.js` for the grader), which answers with nothing while the switch is off; the screen's own file only asks it.
3. **Something moved behind ⋯ is the same piece of markup shown in a sheet,** with the action it already had.
4. **Nothing changes a grade, a saved value or the database** until a slice below says so.
5. **Old styles are deleted once,** in the last slice, when the switch turns on.

## Slices

| Slice | What                                                                                                                                                  | Mostly                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| L1    | The grader: the student's name in the top bar (tap it for the class list), the progress line, the paper first, one four-word track per criterion, ⋯   | `look.css`, `grade-look.js`             |
| L2    | The Grade list and Bulletins: the board's tweaks that are styles only                                                                                 | `look.css`                              |
| L2b   | Observe's one filter track and its cards; Bulletins' day headings in place of each card's kind and time; the tabs' own top bar                        | `tab-observe.js`, `tab-bulletins.js`    |
| L3    | The grader's three small additions: Next Student in an As Soon As I Save class, a Standard rubric's level words behind the chevron, Undo after Return | `tab-grade.js`                          |
| L4    | Full Screen: score while you read (one criterion over the paper, the dots become the summary)                                                         | `grade-photos.js`, `tab-grade.js`       |
| L5    | The Students card as the student's My Learning, with Not Opened                                                                                       | `tab-students.js`, `card-widgets.js`    |
| L6    | The profile: About Me, the goal, reflections and What You've Noticed first; the private note behind a tap                                             | `student-detail.js`                     |
| L7    | Pleasant Surprises, one PR each                                                                                                                       | as each needs                           |
| L8    | Each screen beside its board, the switch on, the old styles deleted, the help pictures retaken                                                        | `build-flags.js`, `styles.css`, `help/` |

L2b to L6 touch different files and can be built at once. L4 and L7 need L1.

## What L1 is (switch on)

- **Top bar:** Back, the student's name (a pair's or group's name on their card), the sync dot and ⋯. The name opens the class list: every student in the order they are graded, a tick beside each one graded; a tap goes to that student.
- **Progress line:** the strip of circles drawn as one thin line, a segment for each student: dark when graded, blue for the one on screen.
- **The card:** the paper first, edge to edge, then the student's note. The rubric sits in its own card under it.
- **A criterion:** its name, and one track of four segments reading EMG, DEV, PRF, EXT in the class's level order. The chosen one fills with its level's colour and takes the + or − ("PRF +"). Round − and + buttons and the comment button sit beside the name; − and + show once a level is chosen. An Advanced Rubric's checklist opens from the chevron beside the name. A BC six-point guide keeps its six scores, as one track.
- **Comment for Maya:** the Overall Comment, named for the student.
- **Bottom bar:** For Revision and Return and Next. "Saved. Not returned yet." is not shown; "still sees the grade you returned", Returned and Revising are.
- **⋯:** Missing, Excused and Late (each member of a pair or group has their own, with Grade Separately), Competencies or Rubric, and Unsubmit. Each is the card's own piece, copied into the sheet; a choice closes the sheet. A status that is set shows as one chip on the card. A card with nothing handed in keeps Missing, Excused and Late on it, under Add Work; the line under Add Work about photo sizes is not shown.
- **IEP, MOD and ELL** show on the card only for a student who has one.

Unchanged in L1 with the switch on: the points and Complete or Incomplete controls, one student's work with a tab for each piece (it gains ⋯), the checklist's own lines, and the dark bar that keeps the paper in reach while the rubric scrolls.

**Where L1 differs from the board,** for L8 to settle: the comment button keeps the app's own icon; the tab bar stays under the bottom bar; Mark Up is reached from Full Screen, not from the card; a Standard rubric has no chevron yet (L3).

## What L2 is (switch on)

- **Grade list:** a piece with work waiting shows its name, what waits ("3 to grade", and "20 Not In" as a chip) and the bar. The line of category, date and count stays on a piece with nothing waiting.
- **Bulletins:** no large title; the page is a step darker than the cards and each card has an edge and a shadow; a file is a tile, as a link is; the Seen line reads "8 Not Seen" as one button, or "Seen by All 27". Write a Bulletin is tinted, beside the blue Post a Photo.

## Undo after Return and Next (L3, switch on)

Colin, Nov 24: "Yes, hold it", and the toast must not get in the way of grading the next piece.

- **Held, not taken back.** Return and Next moves on at once, but the return is sent seven seconds later. Undo inside those seconds sends nothing and brings the card back with its grade still a draft. A grade is never taken back from a student.
- **Where the toast sits.** "Returned to Maya" and Undo lie over the tab bar for the seven seconds. That strip is the one part of the grading screen the next student is not graded with: the toast covers no paper, no criterion and neither button.
- **One at a time.** The next Return and Next sends the one held and holds the new one. Leaving the grading screen (Back, a tab) or the app (locking the phone, switching apps) sends it at once (Colin, Nov 24: "Yes, send it"). While it is held, its card reads Returned.
- **If the app is killed outright** inside the seven seconds, the grade is still a draft, in To Return.
- With the switch off, and in a class on As Soon As I Save, nothing changes.

It lives in `grade-look.js` (`hold`, `held`, `flush`, `undo`); `tab-grade.js` hands it the return and asks whether a card's return is held.

## Write a Bulletin (L2b, switch on)

Colin, Nov 24: the Let Students React box alone at the left of its row looks wrong, and "Posts to Science 8: every student's phone." is filler. The line is gone from the sheet and from Post a Photo. Let Students React is a row like the sheet's others, its switch at the right, as Observe's sheet has it. Styles only.

## The Students card and the profile (L5, L6)

Drawn directly: the card by `teacher-mobile/student-card.js`, the profile by `student-detail.js`, their styles in `teacher-mobile/students.css`. The old widget card (its widgets, the Customize Card editor in Settings and the Teacher Comment sheet), the profile's tabs, hero, Focus Areas, "Seen in Observations" table, per-section goals and Grade Newest are deleted with their styles and tests.

- **The card** is the student's My Learning: the name (a tap for every student), the overall level in words with four bars up to it (a Letter class shows its letter, no bars), + Observe and Profile, To Grade and To Return as before, then the five newest pieces with a result and All N Pieces. A piece's result is the class's own wording (`assessmentCellValue`), so a class set to show numbers shows "2.7", not "Proficient". In a class whose student page is on, a blue dot marks a piece returned and not opened since (`seen_at`), with "N Not Opened" over the list. The list says More Below when it runs past the bottom.
- **The profile**: who they are (how to say their name with the stressed syllable bold, pronouns, IEP and the other designations, Flagged, open concerns, languages, how they learn best) and + Observe; their private note behind a tap; their goal and check-in; About Me; What You've Noticed (the newest observation, then All N); Reflections; then All Work and Competencies. Each "All" row and each reflection opens in place (`<details>`). A part with nothing in it is left out. To Grade is the card's, not the profile's.
- **Reflections** lists each reflection the class has on: the ones answered open in place with their date; one not answered says Not Answered. A student who has answered none gets one row, "None Answered" (the board's "No Card Yet" needs a server read).
- **Long answers** in the goal and About Me are cut at five lines with More (and Less), only when they run long.
- **Two small surprises.** + Observe on the profile opens a new note with the student's own words quoted over it (Hard Right Now, else Good At, else Outside School; the quick menu when they have said none). The "N Open Concerns" chip opens a sheet where each open concern closes in one tap: Called Home, Spoke With Student, Still Happening or Resolved, the follow-up the Observe tab already writes (`addObservationFollowUp`), with Undo. A card made on the spot (the board "Surprise Card") waits for a security review.
- **Choices made without Colin** (he had delegated the board's details): the button reads "Profile", as on the board; All N Pieces opens the profile, where All Work is one tap; the private note has no "New" badge (the app does not keep whether the note was read); the profile's bar carries the sync dot and no ⋯.

## Turned on (Nov 25)

Colin asked why the release changed nothing teachers could see, and said to turn it on. Turning it on changed these, each fixed before it merged:

- **Tests.** The unit tests see the switch as each test sets it (`tests/setup-mobile.js`): the old layout's code is still checked until L8 deletes it. The browser tests run the phone as it ships. They go to a student through the class list and to Competencies or Rubric through ⋯ (`e2e/phone-jump.js`), read the bar as the student's name, and send a held return at once where they need it sent. `e2e/mobile-student-tabs.spec.js` is gone with the profile's tabs.
- **Fixed in the look:** the round − + and comment buttons and the checklist's chevron are 44 px to a finger (drawn as the same 34 px circles); the level track's segments are 44 px; Write a Bulletin is back on white (the tint was 4.0:1); the profile's bar names the student again as it scrolls; the profile shows To Grade again (S7-F4); the card's list says More Below when it runs past the bottom.
- **What teachers lose with the old screens:** the bar's "3 of 27" count (the progress line shows where they are), the profile's tabs (All Work and Competencies open in place), Grade Newest on the profile (All Work's first row), and the card's widget choices.

## Colin's answers owed

Each is asked when its slice comes up; none holds up L1 or L2.

1. **For Revision in an As Soon As I Save class (L3).** The student already sees the grade there.
2. **+ Follow Up on the phone's observation cards (L2b).** The board takes it off the card; "Observation follow-ups" 3 puts it on every card. It stays on until he says.
3. **"Profile" or "View Profile" on the Students card (L5).** Built as "Profile", as on the board.
4. **A card made on the spot from the profile (L7).** A card's code cannot be read again once it is made, so this needs a look at who can make one and when.

## Tests, each slice

The unit tests already hold what the markup does; a slice adds tests only for what it adds. One Playwright spec in Demo Mode with the switch on (`localStorage['fv-build-phoneLook'] = '1'`), its fit checks in the wide font too (`e2e/wide-font.js`), and in WebKit. Before the PR opens: `npm test`, `npm run typecheck`, the ratchets, `npm run audit:html`, `npm run format:check`. Each built screen is put beside its board and every difference fixed or listed.

**Rules that hold.** Colours and sizes come from the tokens in `teacher/styles.css` and `teacher-mobile/styles.css`. Levels are worded only by `calc.js` and `constants.js` (`levelCode`, `scoreModSuffix`). Sync problems show only on the sync dot. Title Case on labels and buttons. Demo Mode shows all of it.
