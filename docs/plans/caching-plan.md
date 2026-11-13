# Caching: a fast repeat visit, and no one left on old code (2026-11-12)

The plan for S19-C5, C6 and C7 in `docs/plans/handoff-review-plan.md` (Track C). Step 3, option (d), is built (S19-C6); the rest is design only. Measured on the live site (fullvision.ca, release `dce10ed6`) and checked against `origin/main` at `9eddcecb`.

## 1. What a visit and a release cost today

Measured in Demo Mode with a fresh headless Chrome on a Mac, read-only (no sign-in, no forms). "Usable" is the time from opening the address until the loading screen is gone (Dashboard) or the first score cell is drawn (Gradebook). The slow run limits the page to 2 Mbps with 150 ms of delay and turns off the service worker, the way a student Chromebook on weak Wi-Fi works.

| Visit                                       | Requests | All answered with                | Downloaded                                 | Usable            |
| ------------------------------------------- | -------- | -------------------------------- | ------------------------------------------ | ----------------- |
| First visit (Try Demo Mode, then Dashboard) | 118      | full file (200)                  | 1.89 MB, plus 2.82 MB for the offline copy | 1.6 to 2.7 s      |
| Repeat visit, Dashboard or Gradebook        | 106      | full file (200), **never a 304** | 1.65 MB                                    | 1.5 to 3.9 s      |
| Repeat visit on slow Wi-Fi, no worker       | 106      | full file (200)                  | 1.65 MB                                    | 7.5 to 7.9 s      |
| Repeat visit with the network off           | 106      | the worker's saved copy          | 0                                          | **0.14 to 0.4 s** |
| Student page (`s/`), every open             | 20       | full file (200)                  | 184 KB                                     | not measured      |

**The headline: the site never answers "not changed".** Every script and stylesheet is sent `max-age=0, must-revalidate` so the browser asks every time, expecting a quick "304 Not Modified". Netlify answers every such question on fullvision.ca with the whole file. `curl -H 'If-None-Match: <the file's own ETag>'` returned 200 for every file tried (`shared/calc.js`, `shared/data.js`, `favicon.svg`, `login.html`, `curriculum_by_course.json`), and the browser runs above saw 0 answers of 304 in about 650 requests. Another site on Netlify (jamstack.org) answers the same question with 304. The likely cause is the `inject-env` edge function, which runs on every address (`netlify.toml`, `path = "/*"`) though it changes only HTML. Only a release can prove it (section 6).

So a repeat visit re-downloads 1.65 MB, and the service worker does not help: it asks the network first for every file (`sw.js`, the fetch handler) and uses its copy only when the network fails. Offline, the same page is usable in under half a second.

**A release** costs every device that opens FullVision 152 requests and 2.82 MB (13.6 MB before compression). Each release gives `sw.js` a new cache name (`scripts/build.sh`), and the new worker downloads all 151 saved files again with `cache: 'reload'`, which skips the browser's own copy. The last ten releases changed 0 to 16 of those 151 files (one changed 59); a typical one changed 7 to 16 files, 0.25 to 0.68 MB. There were six releases between 6:13 and 12:14 today, so a laptop left open all morning fetched about 17 MB of files it mostly had.

**How a release reaches people today.** HTML is never cached, and every file is fetched fresh, so the next page load after a release runs new code. Colin sees his change on his first reload. An open teacher tab finds the new worker when it comes back into view or every 30 minutes, and `shared/auto-update.js` reloads it at a safe moment: hidden, or just shown and not yet touched, with an empty outbox and nothing half-typed. There is no prompt or banner. The student page registers no service worker and does not load `auto-update.js`, so an open student tab keeps its code until the student reloads.

**A risk that exists today.** Since PR #1245, Reports' eleven scripts load the first time Reports is opened (`teacher/router.js`, `_onDemand`). A tab opened before a release that has not reloaded yet fetches those scripts from the network, so it runs new Reports code beside old `shared/data.js`. The same is true of the other loaders that fetch a file on demand (`competency-wording.js`, `comment-bank.js`, `page-assignments.js`, `rubric-print.js`, `export-all.js`, the seed file). It has not been seen to break anything; step 5 in section 5 closes it.

## 2. The options

**(e) Run the edge function on HTML only.** Add `excludedPath` to the `[[edge_functions]]` entry for scripts, stylesheets, JSON, images and fonts, so every page address keeps it. _For a teacher:_ nothing changes but speed. _Saves:_ if the edge function is the cause, a repeat visit drops from 1.65 MB to a few KB of 304 answers, and on slow Wi-Fi from about 8 s toward 2 s, since 106 round trips remain. The student page drops from 184 KB a visit to almost nothing. _Can go wrong:_ a pattern that matches an HTML page leaves that page with no content policy and no Supabase address, so sign-in breaks on it. That is loud, immediate and affects no saved data. Or the 304s still do not come, and nothing is lost. _Proof:_ before, a test reads `netlify.toml` and checks that every page address (`tests/app-routes.test.js` has the list) still runs the function and no `.js` or `.css` file does. After the release, `curl` shows a 304 for `shared/calc.js` and a content policy with a fresh nonce on `/login.html`, `/dashboard`, `/s/` and `/teacher-mobile/`. _Undo:_ "Publish deploy" on the previous deploy in Netlify (no build), then revert the PR.

**(d) Keep unchanged files across releases.** `scripts/build.sh` already rewrites `dist/sw.js`; it would also write each saved file's content fingerprint into it. On install, the new worker copies a file whose fingerprint matches from the old cache and downloads only the changed ones. No file name changes and no reference is rewritten, so the no-bundler rule stands. _For a teacher:_ nothing visible. _Saves:_ 2.82 MB per release becomes 0.25 to 0.7 MB on a typical release. _Can go wrong:_ a wrong fingerprint keeps an old copy of a changed file. Today that copy is used only offline. _Proof:_ a unit test that the fingerprints match the built files. A browser test builds the site, visits, changes one file, rebuilds, and checks that the update downloads only that file and `sw.js`, then that Demo Mode, Reports and the Gradebook open with the network off. _Undo:_ revert; the next install downloads everything, as today. The other half of C6, saving only what each page needs, conflicts with "everything works offline after a first visit": a teacher who has never opened Reports must still open it offline (`e2e/loading-on-demand.spec.js`). Not recommended.

**(a) The worker answers from its copy first.** Files come from the worker's copy, and the new version installs in the background. Plain, this changes how a release arrives: the first load after a release runs old code, and the new code arrives only when `auto-update.js` reloads the tab. A failed install, which today costs nothing online, would leave a device on old code until a later install works. A safe version adds one guard. Each page carries its release name (`build.sh` writes it into the HTML beside the cache name). HTML stays network-first. When the page from the network names a different release from the worker's copy, that page's files come from the network, as today. If the worker loses track of a page, it also goes to the network. _For a teacher:_ nothing visible but speed. _Saves:_ a repeat visit becomes about as fast as the offline one, 0.2 to 0.4 s and no file traffic, instead of 1.5 to 3.9 s (or about 2 s on slow Wi-Fi once (e) works). _Can go wrong:_ a bug in the guard serves old files beside new HTML, which is the mix the `netlify.toml` comment warns about. Every way out falls back to today's behaviour. _Proof:_ browser tests on the static build for a first visit, a repeat visit, a release while a tab is open, a release before a fresh load, a failed install, offline, Demo Mode, and the content policy. After the release, the measuring script below shows 0 file requests on a repeat visit. _Undo:_ release the previous `sw.js`; browsers check `sw.js` on every page load, so the next load takes it.

**(b) Fingerprinted file names with a year-long cache.** `data.3f9a1c.js`, cached for a year, renamed when it changes. _For a teacher:_ nothing visible. _Saves:_ on top of (a), (d) and (e), it saves the student page's 20 small 304s and some first-visit bytes. _Can go wrong:_ every reference must be rewritten: four HTML pages, `sw.js`, the router's `_onDemand` list, at least ten loaders inside scripts, and two student-page loaders that build a name in code (`s/student.js`, `name + '.js'`; `s/app.js`). One missed name loads a missing or old file. Tests that pin exact tag text, the precache test and the docs-sync test would all read built output. This is a build step that rewrites code, which the no-bundler rule (CLAUDE.md, "Stack") forbids, and it needs S19-A9 first. Not recommended now.

**(c) A short cache with stale-while-revalidate.** For example `max-age=60, stale-while-revalidate=86400` on scripts. _Can go wrong:_ after a release, a page gets new HTML with an old `shared/constants.js`, one file at a time. That mixing is exactly why `netlify.toml` uses `max-age=0`. Colin's first reload after a release would often run a mix. Not recommended.

**The security headers.** Two reviewers refuted moving them as written (S19-A9, in the review of the night of Nov 11). Only `_headers` sends X-Frame-Options, nosniff, Referrer-Policy and HSTS. Nobody can tell offline which file wins when both set a header, or whether Netlify reads the `/**/` pattern. The move also silently dropped the one-day rule for `curriculum_data.js`. A safe version: `tests/headers.test.js` stays as it is. Take a `curl -sI` capture of `/login.html`, `/dashboard`, `/s/`, `/shared/data.js`, `/manifest.json` and `/curriculum_data.js`. Then one PR moves the four headers and the `curriculum_data.js` rule in a single step, deleting them from `_headers` so no header is ever sent twice ("DENY, DENY" is an invalid X-Frame-Options). Release it alone, compare `curl` with the capture, and use Netlify's "Publish deploy" on the previous deploy at once if any header is missing. None of (a), (d) or (e) needs the move; only (b) does.

## 3. How a release reaches a teacher, a student and Colin

| Option         | A teacher's open tab                                                        | A student's Chromebook        | Colin's reload after releasing                   | Worst case                                   | Way out                                     |
| -------------- | --------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------------- |
| Today          | Within 30 min or on return to the tab, then a quiet reload at a safe moment | Next open of the page         | First reload                                     | An old tab loads new Reports code            | Reload                                      |
| (e)            | Same as today                                                               | Same                          | First reload                                     | One page loses its policy and sign-in        | Publish previous deploy                     |
| (d)            | Same as today, with fewer bytes                                             | Not affected (no worker)      | First reload                                     | One old file kept offline                    | Revert; the next install fetches all        |
| (a) with guard | Same as today                                                               | Not affected                  | First reload (the guard sends it to the network) | A guard bug serves old files beside new HTML | Ship a fixed `sw.js`; Ctrl+Shift+R          |
| (a) plain      | Old code until the quiet reload, often not until the tab is hidden          | Not affected                  | Second reload, a few seconds later               | A failed install keeps a device on old code  | Ctrl+Shift+R; a `sw.js` that removes itself |
| (b)            | Same as today                                                               | Next open, changed files only | First reload                                     | A missed name loads a missing file           | Revert the build step                       |
| (c)            | A mix of old and new files for up to a minute                               | A mix                         | Often a mix on the first reload                  | A broken page until the stale files expire   | Wait, or Ctrl+Shift+R                       |

Escape hatches that work for every option: Ctrl+Shift+R (Shift-Reload on a Mac) skips the service worker and the browser's copy for one load, on a Chromebook too. A `sw.js` that deletes its caches and unregisters itself reaches every device on its next page load. Never use the `Clear-Site-Data: "storage"` header: it would also wipe local storage, and the outbox of unsent marks lives there (`shared/offline-queue.js`).

## 4. What needs Colin, and what does not

Needs Colin:

- **(e), the edge function on HTML only (C7).** It is deploy configuration that only a release proves, and it touches the page that carries the content policy.
- **(a), the worker answering first.** It changes the path every file takes to a teacher's screen, and its worst case is a device on old code.
- **(b), fingerprinted names.** It changes the no-bundler rule.
- **Moving the security headers (S19-A9).** Only a release proves it; a mistake silently drops a protection.
- **The on-demand reload (step 5 below).** A click on Reports in a tab that is behind would reload the page.

No decision needed beyond his usual release: the read-only live check, (d), and the test for the edge-function paths.

## 5. Recommendation and order

Do (e), then (d), then (a) with the guard. Leave (b) and (c). Each step is one small PR.

1. **A read-only live check** (`scripts/check-live-caching.mjs`): the `curl` and browser measurements in this plan as one command, printing requests, 304s, bytes and time for a first and repeat visit, plus the headers on each page. No decision needed. Proof: it reproduces section 1's numbers today.
2. **(e)** `excludedPath` on the edge function, and a unit test that every page address still runs it. Needs Colin. Release it alone. Proof: step 1 before and after, with 304s on files and an unchanged content policy on pages.
3. **Done: (d)** fingerprints in `dist/sw.js` and an install that copies unchanged files. Proof: the browser test in section 2, `tests/sw-precache.test.js`, and offline and Demo Mode runs. After the release, step 1 shows the update's size. Built as planned (`scripts/sw-fingerprints.mjs`, `sw.js` `precacheKeepingUnchanged`; tests `tests/sw-fingerprints.test.js` and `e2e/sw-keep-unchanged.spec.js`). Learned while building it:
   - A copy is kept only when the old version recorded the same fingerprint **and** the stored bytes hash to it. The second check is needed, not belt and braces: the running worker stores every good network answer in its own cache (`cacheIfGood`), so a tab left open across a release can put newer bytes under an old fingerprint.
   - The fingerprints are SHA-256 in base64. The finished install stores them in its own cache at `/__sw-precache-fingerprints.json`, written last, so a cache without it (today's, or an install that failed) is never copied from.
   - HTML pages get no fingerprint and are always downloaded: the edge function gives each HTML response its own nonce, so a stored page never matches the file. An update with nothing changed is `sw.js` and the five pages, 67 KB raw (22 KB gzipped) instead of 154 requests and 13.6 MB.
   - Hashing every precached file (13.5 MB) took 14 ms in Chrome on an M-series Mac, 62 ms with the CPU slowed four times (measured in a page; Chrome cannot slow a worker's CPU).
   - A copied response keeps its original headers. Only HTML carries a content policy, and HTML is never copied; a header change in `netlify.toml` for scripts or styles reaches the offline copy only when the file itself changes.
   - The first release with this downloads everything once (the old cache has no fingerprints); every release after it downloads only the changed files and the pages.
   - Pages are cached under one address each (`sw.js`, `pageKey`): the desktop app's routes under `/teacher/app.html`, a folder under its `index.html`, and no query string. Before, the phone app opened as `/teacher-mobile/` and Demo Mode as `/login.html?demo=1` missed their precached copies and showed the worker's "Offline" page. Files loaded on demand (`shared/bank-sets.js`, `shared/bank-proficiency.js`, `vendor/exceljs.min.js`) are precached too; `tests/sw-precache.test.js` fails when app code names a script that is neither listed nor excused. Proof: `e2e/phone-offline-start.spec.js`.
4. Once (e) works, the install can also use `cache: 'no-cache'` instead of `'reload'`, so a file missing from the old cache becomes a 304, not a download. Proof: as in step 3.
5. **Close the on-demand mix.** When `auto-update.js` already knows a newer version has taken over, opening Reports does a full page load instead of fetching scripts, if it is a safe moment; otherwise it behaves as today. Needs Colin. Proof: a browser test that releases a new build while a tab is open and checks that Reports runs one version.
6. **(a) with the guard.** Needs Colin. Proof: the browser tests in section 2; after the release, step 1 shows no file requests on a repeat visit.

Expected result: a repeat visit on slow Wi-Fi drops from about 8 s to under 1 s, a release costs a device about a quarter of what it does now, and a page load after a release still runs new code.

## 6. What I could not find out

- Why Netlify never answers 304 here. The edge function is the likely cause, since a Netlify site without one answers 304, but only a release with step 2 proves it.
- Whether Netlify reads `excludedPath` patterns such as `/*.js` the way the plan expects. A test can check the file; only a release checks Netlify.
- Real school Wi-Fi and Chromebook speeds. These numbers come from one Mac on one connection, with throttling applied to the page only.
- Whether managed Chromebooks keep the browser's copy of files between sign-ins. If they wipe it, (e) does less for students.
- The phone app's and the student page's time to usable. The student page needs a card code.
- How Safari on an iPad treats the worker's copy over days of disuse.
- Which of `_headers` and `netlify.toml` wins when both set the same header.

## 7. The live check (step 1)

`scripts/check-live-caching.mjs` asks a site how it caches eight files and how it protects every page, and changes nothing. It sends only GET requests, with a generic User-Agent, no cookies and no sign-in, and never prints page content or the Supabase values the edge function puts in.

```bash
node scripts/check-live-caching.mjs                        # fullvision.ca
node scripts/check-live-caching.mjs http://localhost:8347  # a local build
node scripts/check-live-caching.mjs --expect-304 --expect-pages-ok
```

For each file it prints the answer to a plain GET (status, bytes, Cache-Control, ETag) and to a second GET sent with `If-None-Match` set to that ETag: 304 means "not changed", 200 means the whole file came again. For each page address (`/`, `/login.html`, every route in `teacher/router.js`, `/s/`, `/teacher-mobile/`, `/launch.html`, `/privacy.html`, `/help/`) it prints the status, whether a content policy with a nonce came, whether the nonce is new on a second request, how many script tags carry it, whether the Supabase placeholders are gone, and the four security headers. It ends each group with a verdict line. It exits 0, unless `--expect-304` is passed and a file did not answer 304, or `--expect-pages-ok` is passed and a page lacks its policy, a fresh nonce on every script, the Supabase address or a security header.

Today's output from the live site (2026-11-12), matching section 1: every file answers 200 to a conditional request, and every page has its policy.

```text
Caching and page protection on https://fullvision.ca (2026-11-12T20:15:30.070Z)

Files: plain GET, then GET with If-None-Match: <its ETag> (bytes after decompression)
  /shared/calc.js              200    187355 B  cache-control: public,max-age=0,must-revalidate  etag: W/"59b72606002299f9b1bd4bf8bb26c36d-ssl"  ->  200 187355 B
  /shared/data.js              200    877502 B  cache-control: public,max-age=0,must-revalidate  etag: W/"465b2b8e4b3c6ac04165f8a8623cce83-ssl"  ->  200 877502 B
  /teacher/styles.css          200     83274 B  cache-control: public,max-age=0,must-revalidate  etag: W/"f3ac328c9795aa56e40e9a3c8745d1e9-ssl"  ->  200 83274 B
  /sw.js                       200      9247 B  cache-control: public,max-age=0,must-revalidate  etag: W/"f62b9fbeaa5bd416c9d790793b287263-ssl"  ->  200 9247 B
  /manifest.json               200      1052 B  cache-control: public,max-age=0,must-revalidate  etag: W/"d9ec129192787391f7c1bcb5f04281c3-ssl"  ->  200 1052 B
  /curriculum_by_course.json   200   2800070 B  cache-control: public,max-age=86400  etag: W/"a37a03a5e63d497f695a44cc7ebed2f8-ssl"  ->  200 2800070 B
  /favicon.svg                 200       412 B  cache-control: public,max-age=0,must-revalidate  etag: W/"e7c0a42afd65626817685b79722707b9-ssl"  ->  200 412 B
  /assets/icons/icon-192.png   200      3196 B  cache-control: public,max-age=0,must-revalidate  etag: "0d5513a7ebcce6a326e70edd4b4c83d4-ssl"  ->  200 3196 B
Files verdict: 0 of 8 answered 304 Not Modified; the rest sent the whole file again.

Pages: two GETs each
  /                        200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 4/4  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /login.html              200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 11/11  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /dashboard               200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /assignments             200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /student                 200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /gradebook               200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /observations            200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /observations/starters   200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /reports                 200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 88/88  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /s/                      200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 17/17  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /teacher-mobile/         200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 46/46  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /launch.html             200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 3/3  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /privacy.html            200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 2/2  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
  /help/                   200  policy yes  nonce yes  new nonce each time yes  scripts with nonce 5/5  placeholders gone yes  X-Frame-Options=yes X-Content-Type-Options=yes Referrer-Policy=yes Strict-Transport-Security=yes
Pages verdict: all 14 pages have their policy, a fresh nonce on every script and the Supabase address.
```
