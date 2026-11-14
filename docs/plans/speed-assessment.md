# Speed: where FullVision waits, and what would make it feel instant (2026-11-13)

Colin, 2026-11-13, after 1,456 scanned sheets were filed and the pages slowed: "do a major speed assessment of fullvision. what would the council say? it needs to feel magic."

This is an assessment and an order of work. Section 6 is the order and what is built; section 7 is the second sweep, of every screen, made the same evening after Colin's ".1 was an arbitrary number ... it has to be as fast as possible." The bar in section 1 is the least acceptable, not the goal.

## 1. The short answer

- **The server is fast and the student page is fast.** The waits are in the browser, on two pages: Assignments and the Gradebook.
- **Assignments draws about 86,000 elements**, because every card's whole-class grid is built while the card is closed. That one fact is behind its slow open, its slow clicks and its slow Expand.
- **A click often redraws far more than changed.** Closing the grader redraws the whole gradebook. Every click and keystroke on Assignments sweeps every card.
- **Today's slowdown was one of a family.** A lookup that copied the whole class's work for every cell (fixed in PR 1377) has siblings in Mark Up, reflections and revisions.
- **Start-up still waits on the network** before it shows anything, and the live site is sending some scripts uncompressed.
- **Nothing guards speed.** The speed recorder records and never fails, and its class has no student work in it, so it could not have caught today.

"Magic" needs a number. The council's is Nielsen's: a response within 0.1 second feels instant, within 1 second keeps the train of thought. So the bar is: **every click and keystroke under 0.1 s, every page under 1 s, on a school Chromebook.**

## 2. How it was measured

- **The screens:** Demo Mode's Science 8 (27 students, 38 pieces, 2,096 scores) put in History 12's state: student page on, Send Work on, 620 pieces of work in with two pages each. Chromium, 1440 × 900, the production build served through the edge function (`scripts/e2e-server.mjs`). Each number is from the click or the address to two painted frames later, with a CPU profile.
- **Two speeds:** the Mac as it is, and the CPU slowed four times to stand in for a school Chromebook (the Speed workflow's own setting).
- **The server:** `get_class_bundle` and `list_course_submissions` timed inside the live database as Colin, for his four classes. Supabase's performance advisor.
- **Delivery:** `curl` against fullvision.ca at release `5e71902c`, and the code.
- **Two code reviews** by reading: what a draw and a click do, and how the app loads.
- All of it ran on the code with PR 1377's fix in.

Not measured: a real Chromebook, school Wi-Fi, a signed-in browser session, the phone app, and typing a score straight into a gradebook cell (my probe did not land; the cost given below is the full redraw measured when the grader closes).

## 3. The numbers

Milliseconds. **Bold** misses the bar on the slow machine.

| Screen or action                               | Chromebook (4× slower) | This Mac |
| ---------------------------------------------- | ---------------------- | -------- |
| Dashboard: open                                | 585                    | 169      |
| Assignments: open (86,486 elements)            | **1,114**              | 287      |
| Assignments: open one card                     | **743**                | 154      |
| Assignments: click a rubric level              | **205**                | 45       |
| Assignments: click + or −                      | **161**                | 36       |
| Assignments: Expand                            | **1,756**              | 404      |
| Assignments: click a level with all cards open | **719**                | 160      |
| Assignments: one keystroke, all cards open     | 71 (one task of 114)   |          |
| Assignments: one student                       | 943                    | 248      |
| Gradebook: open                                | 820                    | 224      |
| Gradebook: open the grader on a cell           | **170**                | 29       |
| Grader: next student                           | 79                     | 30       |
| Grader: close (the gradebook redraws)          | **396**                | 91       |
| Student page: open                             | 506                    | 174      |
| Student page: open a row, or change tab        | 39 to 66               | 18 to 21 |
| Observations: open                             | 592                    | 169      |
| Reports: open                                  | 987                    | 263      |

The server, warm: a class's bundle in 36 to 73 ms (140 to 547 KB), its work list in about 70 ms. The first call on a cold connection took 1.2 s once. The performance advisor has nothing but notes (unused indexes, backup tables without keys).

On this Mac everything but Expand is already inside the bar. The problem is the slow machine, which is the one in a classroom.

## 4. What is slow, and why

Ranked by how much a teacher feels it.

**1. Assignments builds every closed card's grid.** A closed card holds about 2,050 elements; 38 cards make 78,000 of the page's 86,000. The browser lays all of it out on open and again after clicks. With all cards open a click's script takes 92 ms and the layout after it another 570. Opening one card redraws the whole page (`render`, `teacher/page-assignments.js:2414`: 260 ms of its own time). _Fix:_ build a card's grid when it opens, and open or close only that card. _Expect:_ open and Expand several times faster, and every click's layout cost gone. This is the largest single change.

**2. Assignments sweeps every card on every click and keystroke.** `click`, `change`, `keyup` and `focusout` each run `_syncStatusLocks` over every Missing and Excused button on the page and queue `_refreshReturns` over every card (`page-assignments.js:16236`). `render` also works out each card's drafts and work counts three or more times and ends with a `_refreshReturns(true)` whose result is thrown away (`:2534`). A level click spends 49 ms in `scrollIntoView` forcing layout. _Fix:_ refresh only the student and piece that changed; skip `keyup` in text fields; work the counts out once a draw.

**3. The Gradebook redraws the whole table for one change.** `_redrawCompetencyCell` (`teacher/page-gradebook.js:2438`) calls `render()` and `refreshSidebar()` for one entered score, and closing the grader does the same: 396 ms on the slow machine. Its open spends 64 ms formatting dates and 75 ms in the header (`gradebook-chrome.js:133`). _Fix:_ update the cell, that student's Overall and the class average; keep one date formatter.

**4. Every score write touches the whole class.** With the student page on, `_gradeBefore` (`shared/data.js:7246`) re-reads the whole scores string from this device and compares every cell to find the one that changed. Each click also writes the whole class's scores to this device (about 1 MB). `getScores` re-checks a rubric-key migration on every call (`_migrateRubricScoreKeys`, 44 to 88 ms a draw on the slow machine). _Fix:_ compare the changed cell only; hold the device write for a third of a second; remember the migration's answer until assessments or rubrics change.

**5. The rest of today's bug.** `_studentWorkSubmissions` still copies every submission for Mark Up, reflections and revisions. With the student page on, `studentMarkupWaiting` does it for each student row of every open card: 30 whole-class copies a card, a draw. On the one-student view 242 ms goes to copying single submissions that are only read (`samePhotoAs`). _Fix:_ the index PR 1377 made, used by these readers, and a read-only look for callers that change nothing.

**6. Start-up waits on three calls in a row.** Before anything draws: `getUser`, then `bootstrap_teacher`, then `list_teacher_courses`, one after another (`teacher/router.js:437`, `shared/data.js:444`), after 104 scripts that all block the page. The class itself already draws from this device's copy. _Fix:_ run the three side by side, or draw the saved class list while they answer (decision 23 and S19-C8, both open; D9 would change).

**7. A repeat visit asks the server about every file.** The worker goes to the network first for all 124 files and uses its copy only when that fails. The caching plan measured 1.5 to 3.9 s for a repeat visit against 0.14 to 0.4 s from the saved copy. Its option (a), answer from the copy first, is not built and waits for Colin.

**8. Some scripts go out uncompressed.** Asked the way a browser asks, the live site sometimes sends a file whole: `shared/data.js` at 399 KB where 104 KB is right, `calc.js` and `dash-class-manager.js` the same. It happens when Netlify's edge re-checks a file it holds. Over a full load that is about 4.3 MB where 1.4 MB is right. It costs a first visit and every release's install; a repeat visit gets "not changed" and is not affected. The cause is not proven. _Next:_ confirm in a real browser, then take it to Netlify.

**9. The work list is re-read whole every 30 seconds.** History 12's is 1.1 MB. While Assignments is open it is fetched, parsed and compared twice a minute. _Fix:_ ask "changed since?" first, as the class bundle does (`p_if_version`); that needs a database change, so the SQL goes to Colin.

**10. Everything loads up front.** A Dashboard visit loads Assignments, the class manager and the comment bank: 360 KB compressed it does not use. The caching plan's Phase 4 covers it. It matters less once 7 is built.

Already fine, and checked: the student page, the grader dialog, the calc caches, the roster and assessment getters, the server and its indexes.

## 5. What the council would say

On what each has published. No one is quoted.

- **Nielsen** would set the bar in section 1 and hold the slow machine to it: 0.1 s for a click, 1 s for a page. He would rank a 200 ms level click above a 1 s page open, because grading is hundreds of clicks.
- **Krug** would say a wait makes a teacher wonder whether the click took. Where a wait cannot be removed, the page should answer at once and finish after.
- **Beck** would say it works and is mostly right, so now make it fast, and only where the profile points. Each fix small, with a test that fails without it, as PR 1377's test counts copies.
- **Fowler** would agree: measure first, expect a few places to hold most of the time (they do: one page, a handful of functions), and tidy the code enough that the hot spot is one place to change.
- **Humble and Forsgren** would point at the recorder that cannot fail and the browser tests that did not run before PR 1371 merged. Speed belongs in the pipeline as a check with a budget, and the check needs a class that looks like a real one in November.
- **Nygard** would call today's bug the standard one: code tried with 16 rows and shipped to a class with 635. Test at production size. Never fetch or copy an unbounded list where one row is wanted. He would flag the 1.1 MB re-read as the next of the kind.
- **Kleppmann** would say keep derived data instead of working it out again: an index kept beside the work, counts kept beside the scores. Show the device's copy first and let the network catch up. Ask the server what changed, not for everything again.
- **OWASP and the privacy commissioner's office** would hold two lines. Speed is not bought by keeping more student data on the device or for longer, and photos stay behind 300-second links. Nothing moves to a third party or out of Canada to be faster.
- **Guskey, O'Connor, Wiliam and the Ministry's policy** would rank by teacher time and by feedback reaching students sooner: the grading loop and the conference view before Reports. And a faster number must still be the right number: no screen may show a grade from a stale copy.

They would not be split on the order below. They would leave two things to Colin: option (a) for the worker, and any SQL.

## 6. An order of work

Each line is one PR with its own test. Estimates are mine and not measured.

1. **A guard.** Built: #1379, merged. `tests/speed-guard.test.js` counts what each draw and click on Assignments, the Gradebook and the grader does on a class in History 12's state, against limits in `tests/speed-baseline.json`, in every PR. The speed recorder gained two rows on a class with work in; it still only records.
2. **Assignments: build a card's grid when it opens** (finding 1). Built: #1381, open. 83,000 elements to 3,300.
3. **See the Work's preview** (Colin, "especially hover-overs"). Built: #1380, open. One request signs a draw's links, thumbnails are fetched when the pointer comes into a card, the card shows in 100 ms, and pictures are kept in memory.
4. **Assignments: open or close only that card, and refresh only what changed** (finding 2, and section 7's A2).
5. **Gradebook: update the cell, not the table**, and do not redraw when the grader closes with nothing changed (finding 3, section 7's G1).
6. **Score writes: the changed cell only; hold the device write; remember the migration** (finding 4). This touches how marks are saved, so it goes under "Marks may be moved; Colin and Karen must see no change" and its design is reviewed first.
7. **The rest of the copy family** (finding 5).
8. **Section 7, in its own order.**
9. **Start-up: the three calls side by side** (finding 6).
10. **Uncompressed scripts: confirm, then Netlify** (finding 8).
11. **For Colin:** the worker answering from its copy first (finding 7), and "changed since?" for the work list (finding 9).

## 7. The second sweep: every screen

Four code reviews, by reading, each over one part of the site, after the first fixes. Nothing below is built. Costs are counts from the code; where a millisecond figure is given it is from section 3's profile or a timing of the pure function, multiplied by four for the slow machine. CONFIRMED means the trigger and what it calls were both read.

### The same mistakes, everywhere

Four patterns account for almost every finding. Fixing them by name is quicker than fixing each place:

1. **A small change redraws a whole page.** Dashboard search, sort and flag; an observation added; a Class Settings field; a tick on a report; a level on the phone. Each rebuilds every card or every sheet.
2. **Work done for every row that could be done once.** A date formatter made per cell; a category looked up per score; a class-wide scan per student; the comment bank's usage per keystroke.
3. **Reading the page's layout between writes.** Measure, write, measure again, in a loop: the browser lays the page out each time. Found on the Gradebook, Reports, the Dashboard, Assignments and the phone.
4. **Full-size pictures where thumbnails would do.** The phone grader downloads every student's full pages for a 188 px strip, and again after a level tap.

### Ranked

Most felt first. **[file:line]** is where it starts.

**Phone grading (the most felt, after Assignments)**

- **P1. The phone grader downloads every student's full-size pages when it opens, and again after each rubric tap.** For 25 students with two pages each, about 50 link requests and 25 MB, shown in a 188 px strip; a rubric tap swaps the card and fetches its pages again. CONFIRMED [`teacher-mobile/grade-photos.js:465`, `tab-grade.js:2594`]. _Fix:_ thumbnails in the strip, the full page only when opened; fill only the card on screen and its neighbours; keep the picture when a card is redrawn.
- **P2. A rubric level tap rebuilds the whole card**, and a competency row on rubric work writes and rebuilds once per criterion. CONFIRMED [`tab-grade.js:2594`]. _Fix:_ change the buttons in place, as the competency path already does.
- **P3. Every score tap checks every student three times** (about 90 calls for 30) and re-sorts the roster. CONFIRMED [`tab-grade.js:3317`]. _Fix:_ update the one student.
- **P4. Opening the grader builds every student's card**, about 1,000 buttons for 30 students and five criteria. CONFIRMED [`tab-grade.js:1460`]. _Fix:_ build the card on screen and its neighbours.
- **P5. Two touch listeners that cannot be passive** make every scroll on the phone wait for the page's script. CONFIRMED [`teacher-mobile/shell.js:155`, `:939`]. _Fix:_ add them only when a pull or an edge swipe starts.
- **P6. The phone opens on Students after a network call**, never on the last screen. CONFIRMED [`shell.js:55`]. _Fix:_ draw the saved class list first; open where the teacher left.
- **P7. Observe draws every observation of the class** on each visit and filter. CONFIRMED. _Fix:_ the newest 30, more on scroll.
- **P8. Three 20 px background blurs sit over the swiper**, costly on old phones. PLAUSIBLE [`teacher-mobile/styles.css:293`, `:1737`, `:1756`]. _Fix:_ solid backgrounds.

**Gradebook**

- **G1. Closing the grader always redraws the whole gradebook** (396 ms at a quarter speed), and the draw lays the table out three times: it writes the table, measures a column, writes the header heights, measures again, then scrolls. CONFIRMED [`page-gradebook.js:3490`, `:563-619`; `gradebook-chrome.js:108`, `:134`, `:197`]. _Fix:_ redraw only when a score changed; work the header height out before writing; drop `applyStickyLeft`, whose writes do nothing the stylesheet does not already do.
- **G2. Moving the pointer across a column** clears and sets a highlight class on about 60 cells, each with a transition. CONFIRMED [`gradebook-chrome.js:250`]. _Fix:_ one highlight strip, or no transition on it.

**Assignments, beyond section 4**

- **A1. The grader's `focus()` and a level click's `scrollIntoView` force a layout** straight after a draw (61 and 49 ms). CONFIRMED [`page-assignments.js:12417`, `:10986`]. _Fix:_ `focus({ preventScroll: true })` after the frame; scroll only on keyboard moves, and only if the cell is out of view.
- **A2. A grid's row heights are measured one row at a time** (write, read, write per row). CONFIRMED [`page-assignments.js:5478`]. _Fix:_ write all, read all, write all.

**Reports**

- **R1. A tick, an edit or a saved comment lays out every student's report again** to check how they fit: 30 students, three to five forced layouts each, in one task straight after the click. In Everyone view that is the draw itself. CONFIRMED [`page-reports.js:1354`, `:1519`; `report-sheets.js:1204`; `report-one.js:907`]. _Fix:_ the changed student only; the rest in small pieces when the page is idle.
- **R2. The − buttons beside a report's rows measure and write in turn**, 50 to 80 forced layouts a draw, on every tick, student change and save. CONFIRMED [`report-one-page.js:197`]. _Fix:_ read every row, then place every button; or place them with CSS.
- **R3. Typing in Browse Sentences rescans the comment bank against the class on every key**: 27 ms on a laptop for the scan alone, about 110 ms on the slow machine, before the list is drawn again. No pause between keys. CONFIRMED [`page-reports.js:1871`; `comment-bank.js:5875`]. _Fix:_ work the usage out once when Browse opens; filter the rows already made; wait 120 ms after a key.
- **R4. Generate and every student change repeat the same scan** (about 110 ms each on the slow machine). CONFIRMED [`report-questionnaire.js:3146`, `:7182`]. _Fix:_ keep each comment's sentences, and recount only the comment that changed.
- **R5. Next or Previous student rebuilds the whole Reports tab**, not just the sheet. CONFIRMED [`page-reports.js:1395`]. _Fix:_ redraw the sheet and the head.
- **R6. Reports' first open fetches 858 KB of level wording and draws twice**, whether or not the report uses it. CONFIRMED [`page-reports.js:505`]. _Fix:_ fetch it only when the feedback pages are on.
- **R7. Print from One Student builds Everyone, then One Student again.** CONFIRMED [`page-reports.js:~899`, `~1045`]. _Fix:_ use the fit already worked out.
- **R8. Each key in a questionnaire comment** measures the box, counts long sentences three times and rebuilds a 1,884-entry map. PLAUSIBLE [`report-questionnaire.js:223`; `comment-bank.js:7945`]. _Fix:_ once per key, or on the existing 300 ms pause.

**Dashboard, Observations, Class Settings**

- **D1. Every Dashboard click redraws the whole page**: search (after each pause in typing), sort, flag, view, a competency, an observation added. CONFIRMED [`page-dashboard.js:214`]. _Fix:_ give the student cards their own container and redraw only it; after an observation, only that card and the Observations card.
- **D2. The student cards look a category up for every score**, about 5,000 lookups a draw, through the one grade function with no cache. CONFIRMED [`dash-student-cards.js:290`; `calc.js:2345`]. _Fix:_ cache it with the others, or list the zero-weight categories once.
- **D3. A date formatter is made for every week cell and every observation card**: 240 on the Dashboard, up to 200 on Observations, on each draw. CONFIRMED [`dash-observations.js:378`, `:685`; `obs-card.js:103`]. _Fix:_ one formatter, made once.
- **D4. Class Settings builds every tab's panel and shows one**, on open, on each tab and on most setting clicks. CONFIRMED [`dash-class-manager.js:3687`]. _Fix:_ build the open tab only.
- **D5. The decay slider saves the class and calls the server on every movement**, dozens of times a drag, clearing the grade caches each time. CONFIRMED [`dash-class-manager.js:7793`]. _Fix:_ save when it is let go.
- **D6. Observations redraws all 200 cards on every search or filter**, and a student click redraws the page and its filters. CONFIRMED [`page-observations.js:439`, `:160`]. _Fix:_ work the context out once; the newest 50, more on request.
- **D7. The Dashboard's cards measure their position one by one while moving** after a sort: up to 30 forced layouts. CONFIRMED [`page-dashboard.js:1010`]. _Fix:_ measure all, then move all.

**The teacher's page for one student (desktop)**

- **S1. Every tab switch or row open works the Overview's grades out again, twice on the Overview tab**, and the profile and reflection figures with them. CONFIRMED [`page-student.js:312`, `:937`; `learner-profile.js:445`]. _Fix:_ once per draw, kept with the draw.
- **S2. Closed competency drawers are built in full.** CONFIRMED. _Fix:_ build a drawer when it opens.

**The student page (`s/`)**

- **B1. A student's first list waits for 230 KB more script after the card is entered.** CONFIRMED [`s/app.js:1048`]. _Fix:_ fetch it while the student types.
- **B2. Sending uploads one file at a time**, each photo then its thumbnail. CONFIRMED [`s/send.js:1148`]. _Fix:_ three at a time.
- **B3. Shrinking a photo runs on the page's own thread, one at a time, with nothing shown until all are done**, on the student page and on the phone. CONFIRMED [`shared/photo-shrink.js:567`]. _Fix:_ decode at the size wanted; a worker; show each photo as it is ready.

**Everywhere**

- **E1. The sidebar slides by changing its width**, so the whole page is laid out again every frame of the slide. CONFIRMED [`styles.css:1640`]. _Fix:_ slide it with `transform`.
- **E2. No part of any page is kept from re-laying out the rest.** No card, row or sheet uses CSS containment. PLAUSIBLE until measured [the stylesheets]. _Fix:_ `content-visibility: auto` on closed cards, report sheets and long lists; `contain: layout` on open cards. Measure each before keeping it.
- **E3. Eighteen `:has()` rules are anchored at the top of the page**, so any change under it is checked against them. CONFIRMED [`gradebook.css:7`, `reports.css:8`, `dashboard.css:12`, `assignments.css:1420` and others]. _Fix:_ a class set when the page draws.
- **E4. Seven background blurs on desktop**, two of them 20 px wide bars that appear while hovering levels. CONFIRMED [`assignments.css:4957`, `:6264`, and five full-screen 2 px blurs]. _Fix:_ solid backgrounds.
- **E5. 55 `transition: all` rules.** Cheap one at a time, costly where a class change reaches many elements. CONFIRMED count [all sheets]. _Fix:_ name the properties.
- **E6. Moving between pages builds the new page from nothing every time**, so going back to the Dashboard costs its full draw. CONFIRMED [`teacher/router.js:~350`]. _Fix:_ later, once each page's own draw is cheap.

### What the second sweep found already fine

The sidebar's roster search, the debounced searches, observation typing, the comment bank's compiled patterns (compiled once each), `grade-report.js`'s measurement cache, the Reports loader (19 scripts in parallel), the phone's swipe itself, and the student page's text boxes. No idle timers do real work.

### The order, for section 7

By how often a teacher meets it, then by size:

1. P1 to P5 (the phone grader).
2. G1 (closing the grader).
3. A1, A2.
4. R1 to R5 (a report's ticks, buttons, typing and student changes).
5. D1 to D5.
6. E1, E4 (cheap and everywhere).
7. S1, S2; B1 to B3; the rest, each measured before and after.
