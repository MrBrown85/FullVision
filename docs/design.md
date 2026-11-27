# How FullVision looks and behaves

The design rules every screen follows, and how a designed screen is built. Colours, type sizes and radii are CSS variables in `teacher/styles.css` (`:root`); use them rather than new values. Wording rules for labels are also CLAUDE.md rule 9.

## Who it is for

A classroom teacher who is not a software user. They know their rubric and the proficiency words, work in spare minutes, and will not read instructions. FullVision has to be easier than Schoology and Teams, which are free and already approved. Start every screen from who uses it and the one thing they came to do.

## The look

- **One strong control per decision.** Everything else is quiet, or behind one obvious tap: a chevron on the row, ⋯ for rare actions. When several controls on a row carry the same weight, the hierarchy is missing.
- **No grey helper text.** No captions, explainer lines, counts or meta text, even when they are true. A name on a control is fine; a sentence explaining it is not. Exceptions (Late, IEP, a page count) appear only when they exist.
- **FullVision's own shapes**, measured from the running app with `getComputedStyle`, never invented:
  - page `--bg` (#f5f5f7); white cards (`--surface`) with radius `--radius-xl` (20 px) that stand off the page;
  - segmented controls: a `rgba(0,0,0,.08)` track, radius 8–10, a filled thumb;
  - fields: radius `--radius` (12 px), grey fill, no border;
  - buttons: radius 10–14; secondary buttons blue-tinted; a filled primary uses `--active-fill` (#0066cc, 5.57:1 under white words), never `--active` (#007aff, 4.02:1), which is for links, focus rings and switches;
  - toolbar controls 32 px high and chips 24 px (`e2e/toolbar-consistency.spec.js` holds this);
  - no thin outlined capsules. A cloud of chips reads as early design: use short labelled checklists.
- **Fixed sizes.** Controls keep their size so rows line up; a control's width never follows its text.
- **Rows, not stray boxes.** A lone checkbox at the left of its own row reads as broken: make it a row with the label on the left and a switch on the right. A state must not look like a button.
- **Never cover the next step.** Anything that appears while a teacher works (a toast, an Undo bar) sits where it does not cover what they do next.
- **Lead with the data.** A label column beside a text column reads as a form. Things to read before writing go above the box, as text; things to click go below it, as chips.
- **Tight before restructured.** When a screen takes too much room, tighten sizes and spacing first and keep the structure. Count the clicks to the most common action before adding a menu.
- **One name per thing** across a page and the app; never two lists with the same name.
- **Explainable in three sentences.** If a teacher has to ask what a control means, it failed. Never make the teacher choose where something is stored; no codes as markers.

## The phone and lists of students

- The phone is a tool for a job in the moment (grade, observe, post), not for studying a student. Breakdowns by competency stay on the desktop.
- Lists of students stay in the order teachers expect (alphabetical). Nothing that people find by its position moves.
- The teacher's Dashboard is never projected, so students' names on it are fine.
- Never compare a designation group (ELL, IEP, any BC designation) with the class in any statistic. A designation may appear only as a tag beside a student's name.

## Pleasant surprises

Parts of a page that talk to each other and let teachers act on what they see: clicking a competency filters the page instead of leaving it; a list of students comes with an action ("Record an Observation for These 5"); pointing at a student lights them up elsewhere on the page. The rule: point to preview, click to filter, a named link to leave. Vary the form by the question it answers: names for who, a small table for counts, a sparkline for change over time. A surprise never moves something people find by position.

## Words

- Teachers "assess"; they don't "mark" (to a teacher "marks" means grades). Say "competency", not "skill", for a curricular competency.
- Headings say what the part is ("Record Observations on Your Phone"); sentences state what the app does. No slogans, no chatty copy, never a line that names the reader's job.
- Grades are year to date. A report is a date on which the year so far is reported; nothing resets at a report. Say "so far this year" and "since the last report", never "this term" (DECISIONS, Reporting periods).

## Motion

Fast and continuous, about 150–250 ms. An item that changes place glides from where it was to where it lands (FLIP, about 220 ms), so the eye can follow it. No long staggers, no multi-phase shuffles, no spinners, no fade-in at the new spot, and never a list redrawn so that it flashes. Honour Reduce Motion.

## Building a designed screen

- **The built screen matches the approved artboard.** Before a slice merges, the reviewer sets screenshots of the built screen beside the artboard's same view at about 1680, 1440 and 1280 px wide and lists every difference. Each is fixed or put to Colin.
- **Build it as the screen.** Draw the new markup directly, delete the old markup, CSS and dead code in the same work, and rewrite the tests around the new screen. No CSS layer over old markup, no flag shims, no old assertions patched to fit. A build switch (`shared/build-flags.js`) is for unfinished work while it is built; done means teachers see it after the next release.
- **Least code.** Read the real screen's code first; it usually already does most of what the design shows. Reuse the app's actions and data. No hacks: no hidden old elements, copied markup or forced styles.
- **Keep what works.** A redesign keeps every existing function unless Colin removes it.
- **Ask first and offer Undo** whenever a teacher's action moves a grade: the question names the piece and what moves, Cancel sends nothing, Undo puts it back. Actions that move no grade don't ask.
