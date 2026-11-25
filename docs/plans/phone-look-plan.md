# The phone's new look (2026-11-24)

**Status.** L1 is built on `main` behind the switch. Nothing else is built. Not released.

**Why.** Colin, Nov 24: the phone's grading view is cluttered, and a teacher who is not a software user would be overwhelmed by it. The phone is a tool to be used in the moment: grade, observe, post. One strong control for each decision, the rest behind one tap, no grey lines of explanation.

**Board.** "Phone Grader, Redesigned" (https://claude.ai/artifact/9183YbyUHWKjotWVWo2Guq). Rows: the grader, its stress tests, three gaps filled, the same tabs tweaked with the profile, the profile's stress tests, and Pleasant Surprises.

**Switch.** `phoneLook` in `shared/build-flags.js`, off. When it is on, `<html>` carries the class `m-look`.

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
| L1    | The grader: the student's name in the top bar (tap it for the class list), the progress line, the paper first, one four-word track per criterion, ⋯   | `look.css`; ~120 lines in three files   |
| L2    | Grade list, Bulletins and Observe: the board's tweaks that are styles only                                                                            | `look.css`                              |
| L3    | The grader's three small additions: Next Student in an As Soon As I Save class, a Standard rubric's level words behind the chevron, Undo after Return | `tab-grade.js`                          |
| L4    | Full Screen: score while you read (one criterion over the paper, the dots become the summary)                                                         | `grade-photos.js`, `tab-grade.js`       |
| L5    | The Students card as the student's My Learning, with Not Opened                                                                                       | `tab-students.js`, `card-widgets.js`    |
| L6    | The profile: About Me, the goal, reflections and What You've Noticed first; the private note behind a tap                                             | `student-detail.js`                     |
| L7    | Pleasant Surprises, one PR each                                                                                                                       | as each needs                           |
| L8    | Each screen beside its board, the switch on, the old styles deleted, the help pictures retaken                                                        | `build-flags.js`, `styles.css`, `help/` |

L2 to L6 touch different files and can be built at once. L4 and L7 need L1.

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

## Colin's answers owed

Each is asked when its slice comes up; none holds up L1 or L2.

1. **Undo after Return and Next (L3).** Recommended: the return is held for seven seconds and sent when the toast goes, so Undo never has to take a grade back from a student.
2. **For Revision in an As Soon As I Save class (L3).** The student already sees the grade there.
3. **+ Follow Up on the phone's observation cards (L2).** The board takes it off the card; "Observation follow-ups" 3 puts it on every card. L2 leaves it on until he says.
4. **"Profile" or "View Profile" on the Students card (L5).**
5. **A card made on the spot from the profile (L7).** A card's code cannot be read again once it is made, so this needs a look at who can make one and when.

## Tests, each slice

The unit tests already hold what the markup does; a slice adds tests only for what it adds. One Playwright spec in Demo Mode with the switch on (`localStorage['fv-build-phoneLook'] = '1'`), its fit checks in the wide font too (`e2e/wide-font.js`), and in WebKit. Before the PR opens: `npm test`, `npm run typecheck`, the ratchets, `npm run audit:html`, `npm run format:check`. Each built screen is put beside its board and every difference fixed or listed.

**Rules that hold.** Colours and sizes come from the tokens in `teacher/styles.css` and `teacher-mobile/styles.css`. Levels are worded only by `calc.js` and `constants.js` (`levelCode`, `scoreModSuffix`). Sync problems show only on the sync dot. Title Case on labels and buttons. Demo Mode shows all of it.
