# Writing Help Articles

The help site at fullvision.ca/help is built from Markdown in `help/articles/`. The in-app Help panel reads the same articles. This page covers how to add or change an article, retake its picture, and what the tests check.

## How the Site Is Built

`scripts/build-help.mjs` reads `help/articles/*.md` and writes:

| File                         | What it is                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `help/<slug>.html`           | The full page, served at `/help/<slug>`.                                                     |
| `help/index.html`            | The landing page, served at `/help`: Getting Started in order, then every topic.             |
| `help/fragments/<slug>.html` | The article alone (`<article class="help-article">`), for the in-app Help panel.             |
| `help/index.json`            | `[{slug, title, section, summary, pages, video, demo}]`, for Search Help and the Help panel. |

These four are built on every deploy by `scripts/build.sh` and are not committed (`.gitignore`). The repo holds only the Markdown and the pictures in `help/img/`. To see the site locally, run `node scripts/build-help.mjs`, then open `/help/index.html` on `npm run dev:local`, or `bash scripts/build-e2e.sh` and `node scripts/e2e-server.mjs` for the production CSP. Neither local server knows the `/help/<slug>` addresses; open `/help/<slug>.html`. Netlify serves both (`netlify.toml`).

Pages copy the splash page's look, with styles inline so the edge function adds the CSP nonce. Search Help matches plain text in titles and summaries, inside the page, with no network request.

## Add an Article

1. Drive the task in local Demo Mode first (`node scripts/dev-local.mjs`, then `/login.html?demo=1`). Write the steps from what the screen shows, never from memory.
2. Create `help/articles/<slug>.md`. The slug is the address: lower-case words joined by `-`.
3. Fill in the front matter (below), then the body.
4. Run `node scripts/help-shots.mjs <slug>` to take the picture.
5. Run `node node_modules/.bin/vitest run tests/help-labels.test.js tests/help-build.test.js`.

### Front Matter

```yaml
---
title: Add Your Students # Title Case; names the task
section: Getting Started # one of the sections below
order: 2 # position in its section
summary: Students are added to a class one at a time or from a roster file.
checked: 2026-11-05 # the day the steps were last followed in the app; shown as "Updated"
pages: # app routes the article belongs to; the Help panel lists it there
  - /dashboard
demo: /dashboard # optional: shows Try It in Demo Mode
video: create-a-class.mp4 # optional: a file in help/video/
length: 1:40 # optional: the video's length, shown under it
keywords: # optional: more words Search Help should match (labels and headings already count)
  - CSV
labels: # every label the body puts in bold, exactly as the app shows it
  - Add Student
  - 'Import Roster: Review Changes' # quote a label that holds ": "
next: # optional: slugs for the Next box
  - set-up-grading
shots: # optional: pictures for scripts/help-shots.mjs
  - file: add-your-students.jpg
    route: /dashboard
    steps:
      - click role=button[name="Class Settings"]
      - click main >> text=/^Students/
      - click role=button[name="Add Student"]
    clip: 252,252,1176,548 # x,y,width,height in CSS pixels; or selector: <css>
    # width: 390 and height: 844 take a phone-sized picture (default 1440 by 900)
---
```

Sections, in nav order: Getting Started, Class Settings, Assignments, Gradebook, Observations, Reports, Student Page and Student Voice, Phone App, Privacy and Your Data, and Reference (Glossary, What's New and the other standing pages, listed under the line at the foot of the nav).

Keyboard Shortcuts (`generated: keyboard-shortcuts`) is drawn from `KEYBOARD_SHORTCUTS` in `shared/constants.js`, the list the app's own shortcut sheet shows, followed by the article's own Markdown (keys the app shows only as on-screen hints). A shortcut with an `aria-keyshortcuts` goes in that constant, not in the article.

The summary opens the article. Search Help matches the title, summary, labels, headings and keywords.

Try It in Demo Mode, like the header's Try Demo Mode, opens `/login.html?demo=1` for a visitor. Demo Mode replaces the data on the device, so a signed-in teacher is sent to the sign-in page instead, which asks first, and someone already in Demo Mode goes straight to the article's `demo` route. The splash page uses the same rule.

### Body

The Markdown is a small subset: `##` and `###` headings, paragraphs, numbered and bulleted lists, `**bold**`, `*italic*`, `> note` paragraphs, links and pictures.

- Link to another article by its slug: `[Set Up Grading](set-up-grading)`. The build fails on a slug that has no article.
- A picture is a line of its own: `![What the picture shows](img/file.jpg 'The caption.')`. A numbered list can stop for a picture and carry on with `3.`.
- Put every label the steps quote in bold, and list it under `labels`.

### Wording

Help is written in textbook register: neutral, precise and short, in the words a teacher expects in that spot.

- Open with a one- or two-sentence definition in the third person: "A class is built from one or more BC curriculum courses."
- Steps are imperative and quote labels word for word: "Select a **Grade**, a **Subject** and one or more **Courses**, then choose **Next**."
- State conditions plainly ("If a class already exists, …"). Use the passive where the actor is obvious ("These can be changed later in Class Settings.").
- No "you", "let's" or "we", no questions, exclamations, reassurance or filler.
- One picture per article, one Next box. No email address anywhere: the footer's Report a Problem link opens the form in the app.
- Student names come only from the Demo Mode sample class (`shared/seed-data.js`).

## Retake the Pictures

```bash
node scripts/help-shots.mjs                 # every article
node scripts/help-shots.mjs add-your-students
```

It builds `dist/`, serves it through `scripts/e2e-server.mjs` (the production CSP), and for each shot opens a fresh Demo Mode at 1440 wide and 2x, goes to `route`, runs the `steps`, and saves the `selector` element or the `clip` area. macOS `sips` scales the result to 1800px on the long side as JPEG quality 78, like the splash page's pictures. Set `HELP_SHOTS_URL` to use a server already running. It runs by hand after a UI change, not in CI.

Steps are one per line, with Playwright selectors: `click <selector>`, `fill <selector> | <text>`, `select <selector> | <option label>`, `upload <selector> | <repo file>`, `hover <selector>`, `press <key>`, `scroll <selector>`, `wait <ms>`. Clicks and fills use the first matching element that is on screen.

## What the Tests Check

- `tests/help-labels.test.js` (the drift test): every `labels` entry appears word for word in `teacher/*.js`, `teacher/*.html`, `teacher-mobile/*.js`, `teacher-mobile/index.html`, `shared/*.js` or `login.html`, and every bold phrase in an article is one of its labels. Renaming a button fails this until the article is updated, and its `checked` date moved.
- `tests/help-build.test.js`: the build runs; every `index.json` entry has a page and a fragment; Getting Started comes first in order; every picture exists; every page has the Updated line and Report a Problem, and no email address; fragments hold only the article.

When a test fails after a UI change, follow the article's steps in Demo Mode again, fix the wording and labels, retake the picture, and set `checked` to the day.
