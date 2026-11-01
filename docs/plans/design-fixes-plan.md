# Design fixes from the UI/UX sweep (web designer items 2–8)

Written 2026-10-19 from `~/fullvision-uiux-sweep.html` (or `.pdf`). Item 1 (text size and uppercase labels) is deferred by Colin. Code references are origin/main at 9376f36.

No grade math, no database change, no change to what any grade shows (rule 3); colour, spacing and labels only. Every PR must check light and dark mode (dark tokens live in `teacher/styles.css` from ~line 3187), Demo Mode, and widths 1024 / 1440.

## PR A — Readable blue and quieter controls (items 2 and 5)

**Finding.** Muted text tokens already pass (`--text-2 #636366`, `--text-3 #58585d` are above 5:1 on white). The failures are the system blue `--active #007aff` used as _text_: about 4.0:1 on white and 3.7:1 on the light grey card surfaces, at 11–12 px ("View Gradebook →", "Record →", competency names on the dashboard, Next Steps line). On the phone, the edit/delete buttons on each observation rest at reduced opacity.

**Changes.**

1. Add a `--link` token (light and dark) for blue **text**: the closest shade to `#007aff` that reaches 4.5:1 on both `--surface` and the lightest grey card background (around `#0066cc`). Keep `--active` for fills, focus rings, selected states and icons. Switch text uses of `--active` (links, "→" actions, blue labels, blue counts) to `--link`. Audit with `git grep "color: var(--active)"` across `teacher/*.css` and `teacher-mobile/styles.css`.
2. Phone observation edit/delete (`teacher-mobile/styles.css` `.m-obs-edit-btn`, `.m-obs-delete-btn`): rest at full opacity in `--text-2`, not faded.
3. Any remaining small text under 4.5:1 found by the check script (below) gets the nearest passing token.
4. **Rubric ± buttons** (`teacher/assignments.css` ~2370–2395): the pressed state is a solid `--text` (black) square. Make it an outline in the row's level colour with the sign in that colour; rest state stays quiet. The chosen level cell should be the strongest thing in each row.

**Gradebook colours are out of scope for every PR** (Colin, 2026-10-19): do not change gradebook cell or tile colours, including when switching blue text to `--link`.

**Check.** A small Playwright spec that loads Demo Mode pages (dashboard, assignments with a rubric open, gradebook, student, reports, phone Observe) and asserts every visible text element under 18 px has contrast ≥ 4.5:1 against its rendered background (skip decorative and disabled). Run in light and dark.

## PR B — One primary action per screen, and a breadcrumb (items 3 and 4)

**Finding.** Solid blue is spent on navigation: the dashboard toolbar's "Class Management" (`teacher/dash-overview.js:24`, `.dash-add-btn`), and on the student page "← Dashboard" and "Edit Student" (`.tb-edit-btn`, page-student.js ~459) sit beside the real action. The top nav keeps "Dashboard" lit on the student page and in Class Management (`teacher/router.js` ~114–119 maps `/student` to `dashboard` on purpose: they are children of the dashboard).

**Changes.**

1. Button rule: one primary (solid) per screen for the main action — Record (Observations), + New Assessment (Assignments), Print Reports / Term Questionnaire (Reports, student page), Save in forms. Navigation and settings (Class Management, ← Dashboard, Edit Student, Student Dashboard) become secondary (outline or quiet). Add the rule to `docs/DECISIONS.md` so new screens follow it.
2. Keep "Dashboard" highlighted for its child screens, but add a breadcrumb at the left of the toolbar on those screens: "Dashboard › Jasper Gill", "Dashboard › Class Management". The first part links back; this replaces the separate "← Dashboard" button.
3. No new page titles on the five top-level pages: the nav pill already names them, and an extra heading would push content down.

## PR C — Gradebook headers (item 6, colours excluded)

**Finding.** Every gradebook cell is a filled tile (`teacher/gradebook.css` ~838–860 `--score-N` / `--score-N-bg`), so a class of mostly 3s is a solid green wall and the 1s and NS do not stand out. Assessment dates wrap onto three lines in narrow columns (`.gb-assess-date`, ~410), and titles truncate with no way to read them.

**Changes.**

1. ~~Tile colours~~ — **dropped 2026-10-19: Colin said do not change the gradebook colours.** Cell and tile colours (`--score-N`, `--score-N-bg`, NS/EXC marks) stay exactly as they are.
2. Dates: one line, short form ("Apr 25"; add the year only when it is not the current school year), `white-space: nowrap`.
3. Titles: clamp to two lines; full title on hover and on keyboard focus of the header.
4. Optional, if small: a "Newest first" toggle beside the view switch, remembered per device. (Engineer item 7; include only if it stays a small change.)

## PR D — No emoji, one segmented control (items 7 and 8)

**Finding.** The Term Questionnaire still renders emoji for dispositions (`teacher/report-questionnaire.js:1340` uses `OBS_ICONS[dim]`); `OBS_SENTIMENTS` / `OBS_CONTEXTS` in `shared/constants.js` (~605–636) still carry emoji `icon` fields. Desktop has about a dozen segmented-control styles (`cm-seg`, `gb-seg-control`, `tb-seg`, `rubric-view-toggle`, `ev-tabs`, `af-type-toggle`, `page-toggle-btn`, `grades-toggle-btn`, `assess-sibling-toggle`, the dashboard Observations tabs…).

**Changes.**

1. Remove emoji from the Term Questionnaire (text labels only, as the observations redesign did) and from any other desktop or phone surface still reading the `icon` fields; then drop the unused `icon` fields from the constants. Grep for `OBS_ICONS`, `.icon` on those objects, and literal emoji in `teacher/` and `teacher-mobile/`.
2. One desktop segmented control in `teacher/styles.css` (`.seg` with `.seg-btn`, `aria-pressed` / `aria-selected`, sizes `sm` / `md`), and migrate the desktop variants to it. The phone keeps its own iOS-style control (`m-seg-btn`), which is already consistent within the phone app.
3. Keyboard behaviour stays as each control has it today (tabs keep arrow keys).

This PR touches the most files; build it last so A–C do not conflict with it.

## Order and independence

A, B and C touch different files and can be built in parallel; D goes last. Each is its own PR with before/after screenshots in light and dark at 1440 px, and Demo Mode checked.
