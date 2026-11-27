# Students' typed work: Write Your Work (paused 2026-11-27)

Colin, Nov 27 2026: students need to submit their actual work as rich text, not just a note. Paused at 97% of the week's usage; resume after the reset (Mon Nov 30). Nothing is built or applied. The migration and its local tests on this branch are an unfinished first draft, untested.

## Colin's decisions (Nov 27 2026)

1. **Kept as text in the database**, not turned into page pictures.
2. **Formatting:** bold, italic, underline, bulleted and numbered lists, two heading sizes, and tables ("lists and tables, yes"). Links show as text but are not clickable. A paste from Google Docs or Word keeps those and drops the rest (fonts, colours, sizes, pictures). Allow-list on the way in and on the way out.
3. **Length:** about 20 pages, 60,000 characters; a count shows near the limit.
4. **Drafts saved on the server** every few seconds, with a quiet "Saved"; they follow the student across devices; nothing stays on a shared device after sign-out; the teacher sees nothing until Send.
5. **Teachers pin comments to passages**, like Google Docs ("this needs to be a state-of-the-art app"); students see them when the work is returned. Rubric and overall comment unchanged.
6. **Any assignment that takes work** (photos or photos and files) also accepts writing. No new Student Work setting.

Design: "the rich text editor and submission should both be FullVision design spec, and should be really intuitive and clean, no fluff." Constraints: data stays in Canada, through `student-submit`, no third-party editor service.

## Still to do

The plan proper (data model, routes, screens, slices, tests), the migration finished and tested on Postgres 17 with its undo, Colin's OK on the SQL, then the build.
