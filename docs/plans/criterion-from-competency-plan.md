# FullVision: a criterion from a competency, and the criterion comment icon

Plan, 2026-10-18. Suggestion 4 from the rubrics comparison plus the comment-button placement from Colin's note.

## What the others do, and what to take

- **Teams** has an AI rubric builder: title, description, grade level, scale and criteria go in; a model fills every cell; you can regenerate one row or column or rewrite the whole thing. No link to standards; the draft is text and the teacher owns it from then on. Take: the draft is produced in one step, the teacher sees the whole grid before saving, and one row can be regenerated without touching the rest.
- **Canvas** "Create From Outcome" copies the outcome's own rating scale and descriptions into the criterion; the row stays linked to the outcome. Take: the criterion is named and linked for you, and the descriptors come from the standard's own text.
- **JumpRope** keeps "scoring criteria" (I-can text per mastery level) on the standard in the bank, so every class that scores the standard shows the same descriptors. Take: descriptors are reusable across classes; what a teacher writes once should not have to be written again.

FullVision already has the raw material: every competency tag carries its I-can statements (`tag.i_can_statements`, 2,069 competencies in `curriculum_by_course.json`, 3.8 statements each, none empty), the BC four-level scale is fixed, and the rubric editor already links criteria to competencies.

## Backend: three layers, and why

**Layer 1, deterministic draft, no backend at all.** A criterion is built in the client from the competency's text: name = the competency's short label; `tagIds = [tag.id]`; descriptors from the I-can statements plus the provincial scale's language (Emerging "with support, beginning to", Developing "in familiar situations, partly", Proficient "independently, in most situations", Extending "consistently, in new situations, and can explain or teach"). The I-can statements become the Proficient column verbatim (they are written at the Proficient level by design); the other three columns are rewrites of the same statements with the scale's qualifiers. This is a pure function, works offline and in Demo Mode, and costs nothing. It is what ships first and what most teachers will use, because a teacher edits a draft faster than they write a blank.

**Layer 2, remember the teacher's own wording.** A teacher who rewrites a drafted descriptor should not do it again in the next class. Store the saved descriptors per competency and per teacher in a new table `competency_descriptor (teacher_id, competency_key, level, text, updated_at)`, keyed by the curriculum id (`cc_sci8_…`) when the tag came from the index, else by the normalised label. "From competency" reads this first and falls back to the draft. Written by `upsert_competency_descriptor` (idempotent, teacher-owned RLS, anon revoked); read in one call per class open (`list_competency_descriptors()` for the signed-in teacher, small: one row per level per competency the teacher has touched). This is JumpRope's bank, scoped to one teacher. It is the only schema change in the plan, and it is additive.

**Layer 3, AI rewrite: dropped (Colin, 2026-10-18). Not to be built.** The design below is kept only as a record. When the draft reads mechanically, "Rewrite with AI" sends the competency text, course name, grade and the current four descriptors to a Supabase Edge Function `rubric-draft` in `ca-central-1`, which holds the model key, calls a current Claude model with a fixed prompt, validates the result (four strings, sentence case, no student names, length caps) and returns it. The client puts the result into the four fields; nothing is saved until the teacher saves the rubric. No student data is ever in the request, so this has no PIA impact, but the function still logs only course, competency key and timing. Rate limit per teacher per day in a `draft_request` table. Demo Mode never calls it. This layer is behind a setting and is not part of the first PR.

Why not generate on the server: layer 1 is text manipulation that is faster and more reliable in the client, and it must work offline. Why not AI first: it costs money per draft, needs a key and a deploy, and the deterministic draft is what Canvas ships. Why a teacher bank and not a district one: there is no district tenancy yet; the schema is `teacher_id` now and a `district_id` column later is a one-line addition.

## UI

**In the rubric editor**, beside "+ Add Criterion": "From competency…". It opens the same chip list the criterion block uses (sections, then competencies, with the competency group headings), with multi-select, and a "Add N criteria" button. Each picked competency becomes one criterion, expanded, with the draft in its four fields and the chip already ticked. A competency that is already on another criterion in this rubric is shown but greyed with "on Scientific inquiry", because the editor already refuses a competency on two criteria.

**In the criterion block**, under the descriptors: "Draft from competency" when exactly one competency is ticked and all four fields are empty, so a teacher who built the criterion by hand can still pull the draft. It never overwrites typed text; if any field has text it asks "Replace the four descriptors?".

**The comment icon on the scoring row.** Today the speech-bubble sits in the criterion label cell on the left and is invisible until the row is hovered, which is why it reads as missing. Move it to the right, in the `.rsg-mods` group after −/+, as a third 20px square with the same border treatment, always visible at low contrast, filled and coloured when a comment exists, tooltip showing the comment text. No word, ever. Keyboard: Tab reaches it after +; Enter opens the popover. The header row's `.rsg-header-mod-spacer` widens from 64px to 96px so the level columns stay aligned.

## Code path, in order

1. `shared/calc.js` is not touched. New `shared/rubric-draft.js` (pure, loaded before the page modules): `draftCriterion(tag, courseName)` → `{ name, tagIds, levels: {4,3,2,1}, weight: 1, levelValues: null }`, plus `draftLevels(iCanStatements)` and `competencyKey(tag)`. Tested on three shapes: full I-can list, one statement, no statements (falls back to the label and the scale language alone).
2. `teacher/page-assignments.js`: `openCriterionFromCompetency()` (the picker, reusing `_rubricTagGroups` and the chip markup), `addCriterionFromTags(tagIds)`, `draftIntoCriterion(idx)` with the replace guard, and the `data-action` handlers. `renderCriterionBlock` gains the "Draft from competency" link. The comment icon moves into the `.rsg-mods` markup (criterionCommentButtonHtml is already an icon; only its placement and CSS change).
3. `teacher/assignments.css`: the picker reuses `.copy-dialog*`; the icon gets `.rsg-mod.rsg-mod-comment` styling; the spacer width.
4. Migration `20261019_competency_descriptor.sql`: table, RLS (`teacher_id = auth.uid()`), `upsert_competency_descriptor(p_competency_key, p_level, p_text, p_idempotency_key)`, `list_competency_descriptors()`, anon revoked. `shared/data.js`: cache `competencyDescriptors` loaded once per session after sign-in (not in the class bundle, since it is per teacher), `saveCompetencyDescriptors(entries)` queued through the outbox, Demo Mode kept in localStorage.
5. On rubric save: for each criterion with exactly one competency, if its four descriptors differ from the draft and from the bank, write them to the bank. This is what makes the second class free.
6. ~~Later, behind a setting: the Edge Function and a "Rewrite with AI" button.~~ Dropped: no AI rewrite.

## Bugs and side effects to design against

- **Two criteria, one competency.** The editor already blocks this (`otherUsed`); the picker must grey those competencies out, and `addCriterionFromTags` must skip them, not throw.
- **A competency with no I-can text** (custom tags, older classes built before the index). The draft falls back to the label and the scale qualifiers and says so in a muted line, so the teacher knows why it reads thin.
- **Tag ids differ per class.** The bank is keyed by curriculum id or normalised label, never by `tag.id`, or the second class would never hit it. Same rule the rubric library uses for matching.
- **Overwriting typed text.** Both "Draft" entry points check for existing text and ask before replacing. Never on the picker's "Add", which only creates new criteria.
- **Scored criteria.** Drafting never changes an existing criterion's `levelValues` or weight, and a criterion that already has scores still goes through #209's guard if its top value changes. Descriptor text changes never affect scores.
- **Linked copies (#213).** A drafted criterion added to a rubric with copies shows up in the "Update the other classes too?" offer as "Add criterion …" with competencies matched by name, exactly like a hand-made one. No new case.
- **Handouts (#210).** The printed rubric uses the criterion's descriptors; drafted text prints as is. The quarter-sheet layout clamps descriptors, and drafts run longer than hand-written ones (three or four I-can statements). Cap the Proficient column at the first three statements and shorten the others to one sentence each, and check the quarter-sheet overflow warning still fires.
- **The bank writing on every save.** Only write when the text differs from both the draft and the current bank row, so a teacher who keeps the draft never creates rows, and a save with no descriptor change sends nothing.
- **Bank rows outliving a tag.** A row is keyed by curriculum id, not a class, so deleting a class leaves it; that is the point. Signing out wipes the local cache like every other `gb-*` key.
- **Mobile.** `teacher-mobile` does not score rubrics or edit them; nothing changes there.
- **The comment icon and keyboard scoring.** The scoring grid has its own key handling (`_kbFocusEl`, Tab moves between rows). Adding a focusable button after + changes the Tab order; it keeps `tabindex="0"` and the row's key handler must treat it as part of the row so arrow keys still move levels. Test with the keyboard before merging.
- **Hover-only affordance was the bug.** Making the icon always visible means 27 × 3 icons on a card; keep it at the `--text-3` tone at rest so the grid stays quiet, and only the filled state is coloured.
- **AI layer, when it comes.** Validate the model output (exactly four non-empty strings, each under 240 characters, no line breaks), never auto-save, never send student names, and fall back to the deterministic draft on any error without a toast (a muted "Could not rewrite; keeping the draft" inside the block).

## Order and size

1. PR A (one day): layer 1 draft + the picker + "Draft from competency" + the comment icon move. No migration.
2. PR B (half a day + migration applied on Colin's OK): the teacher bank, layer 2.
3. ~~PR C: the Edge Function and "Rewrite with AI".~~ Dropped 2026-10-18; PR A (#214) and PR B (#215) are the whole feature.

`docs/DECISIONS.md` gets "Criterion from a competency" with the layer rules; `docs/ROADMAP.md` notes the descriptor bank as the seed for the student-voice question bank.
