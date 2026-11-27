# Testing a change

What to run before a pull request opens, and how to read the results. The merge and release rules themselves are CLAUDE.md rule 8; this file is the how. Every item here is here because skipping it once turned `main` red or failed a pull request.

## What gates a merge

A pull request merges only when both required checks pass: `test-and-format` (vitest, the innerHTML audit, the database drift check, Prettier) and `browser-tests` (Playwright). The browser tests run again on `main` after each merge, which catches two pull requests that pass alone and fail together.

Run the checks on your own computer first. A local run is several times faster than GitHub's runners and is the first signal; GitHub's run is the gate, not the place to find out.

## Before a pull request opens

Run each of these once. Not again and again, but once: the changed tests alone miss checks that look across the whole repo.

```bash
npm test                    # the whole unit suite
npm run typecheck           # full tsc, not only the ratchet
npm run typecheck:ratchet
npx playwright test e2e/<the spec for your change>.spec.js
```

The ratchet can pass while full `tsc` fails (a mixed-shape array literal in a checked file did it), so run both.

### A new file must be registered

- A new JavaScript file starts with `// @ts-check` and is added to `tsconfig.json` ("files") and `scripts/typecheck-ratchet.json` ("checked").
- A new script tag also goes in `sw.js`'s precache list, in `tests/setup.js` when the unit tests load it, and in `docs/ARCHITECTURE.md`'s list in `teacher/app.html`'s order (`tests/docs-sync.test.js` checks it). For the phone: `teacher-mobile/index.html` and `tests/setup-mobile.js`. For the student page: the list of scripts in `tests/student-card.test.js`.
- A new `Grader` action is listed in `tests/grader.test.js`, `tests/grade-return-data.test.js` and `scripts/differential/writers.mjs`.
- File and function size limits (`tests/file-size.test.js`, `tests/function-size.test.js`; DECISIONS "Size limits for new code") only shrink. A file at its limit means the new code goes in a new file. Raising a number is a visible edit with a reason (`npm run size -- --update`).
- Two pull requests that each add a file both touch `sw.js`, `tsconfig.json` and the ratchet. The second merges `main` and runs the ratchet again before it merges.

### Layout and fit tests run in a wide font too

The Linux font on GitHub's runners is much wider than a Mac's, and so are the fonts on teachers' Windows laptops and Chromebooks. A fit or size assertion that passes on a Mac can fail there. Run each one twice: in the page's own font, and with a wide stand-in forced on:

```js
'*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
```

`e2e/gradebook-columns-line-up.spec.js` is one of the specs that does this. When the wide run fails, fix the layout, never the assertion, and show that the wide run fails on the old code. A fixed-width box that holds text needs its own check that the text fits inside it, not only that the bar fits. iPad widths in a layout spec include 744 (iPad mini) as well as 820 and 1024.

### Dates

Demo Mode's sample class (`shared/seed-data.js`) is dated from the day it is seeded, so a test that mixes it with fixed dates passes when written and fails later by the calendar.

- Date added work from `Date.now()`, never a fixed day.
- If a test sets a clock, seed the sample class after setting it.
- Take "today" the way the code under test does (the class's zone or the device clock), never `new Date().toISOString()`'s UTC day.
- Run new tests once with `TZ=UTC` before the pull request opens.

### Timing

A test that depends on timing (motion, drags, typing, anything read frame by frame) also runs with the CPU slowed four to six times, through a CDP session's `Emulation.setCPUThrottlingRate` (`e2e/panel-motion.spec.js` does it). Prove a timing fix with `--repeat-each=20 --workers=5` under the slowdown. A slowdown that changes what a teacher sees is a bug in the app, not in the test. In phone specs, wait for the swiper to settle (`settled()` in `e2e/phone-jump.js`) before reading the current card.

### The student page

Check student-page work in WebKit (Safari's engine) as well as Chromium, 320 to 430 px wide: the `webkit-student` project in `playwright.config.js`, on with `FV_WEBKIT=1`. GitHub installs only Chromium. WebKit is not iOS Safari: a real iPhone is the only proof of address-bar, safe-area and text-size behaviour.

### Unit-test traps

- linkedom has no capture phase, so a menu opened inside a click handler is closed by its own click-away. Open it with `contextmenu` in a unit test and test the click in Playwright.
- A CSS `var()` does not work in an SVG `stroke` attribute; use `style`.

## Flaky tests

A test that fails at random is set aside, not chased: add `@flaky` to its title (`playwright.config.js` leaves those out of the gating run, and the `e2e-flaky` job runs them without blocking), open an issue labelled `flaky-test` naming the spec and the failure, and fix it in its own pull request.

A test that fails twice under load is a lead before it is noise. Run it alone, then trace what the app did: more than one "flake" has turned out to be a real bug (a menu closed by a late redraw; the phone grader naming a passed student).

## Reading the results

- A CI run can say "success" while its `e2e (n)` jobs were skipped (a duplicate run for the same commit). To find `main`'s last green commit, read the e2e jobs' own conclusions (`gh run view <id> --json jobs`), not the run's.
- Auto-merge can turn itself off after the checks pass. Confirm `gh pr view N --json state` says `MERGED`; if not, merge it by hand.
- A green pull request whose checks ran before `main` moved can still be broken by what merged since. Update the branch (`gh pr update-branch`) and let the checks run again.
- `e2e/work-wall.spec.js` fails on a Mac on a clean `main` and passes on GitHub; don't chase it locally. Layout-heavy specs need more time on GitHub's slower runners.

## A pull request with a migration

Rehearse it locally first (`docs/migrations.md`) and push it once, with the live schema snapshot, so the database drift check runs once and passes.

## Hooks

`.claude/settings.json` runs `scripts/hooks/guard.mjs` before every shell command and every Supabase migration, SQL or edge-function call a Claude session makes. It holds the limits a session must never cross by accident:

- **Production:** opening, pushing or merging anything into `production` is refused unless Colin's latest message says "release" (CLAUDE.md rule 8).
- **The live database:** every `apply_migration` and `deploy_edge_function` on `gradebook-prod`, and any `execute_sql` there that is not plainly a read, asks him first (CLAUDE.md rule 1). Plain `select` counts go through.
- **Skipped checks:** `--no-verify`, and a force-push to `main` or `production`, are refused.
- **Deleted tests:** a commit that deletes a test file needs a line starting `Tests removed:` saying why.

If the guard itself fails it lets the call through, so a bug in it never stops work. Its cases are in `tests/hooks-guard.test.js`; change both together.
