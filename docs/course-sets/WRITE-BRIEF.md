# Writing Course-Set Wording for One Batch

You are writing report-card comment wording for FullVision, a BC gradebook. Comments go to students and families. Colin (the owner, a Surrey BC secondary teacher) approved the sample in `docs/course-sets/approved-sample.md` and said: "write them all. Remember, Canadian spelling." Read that sample first: it is the quality bar and the format.

Colin's standing direction: **each set of courses gets its own wording**. Generate should get "more granular and longer, better comments and options". Never make wording plainer or more general so that it fits more courses.

## Your Input

`batches/<batch>.json`: each skill group in your batch with its current `phrase` and `next_steps`, its `grades`, and `competencies`: each distinct Ministry wording (`raw`), its I Can statements (`ican`) and its `courses`. Competency ids: `data/bc-curriculum-ican.json` (id → `cluster` = group). Courses and grades: `curriculum_by_course.json`. Findings from a fit audit for your groups (useful hints, re-check them yourself): `audit/<batch>.json`.

Three groups are already written in `sample-sets.json` (`adst-competing-factors`, `ss-sig`, `ela-information-use`). If one is in your batch, copy it in and only vary its next-step openings (see below).

## What to Write

For **every** group in your batch:

1. **Partition** its competencies into course sets: courses whose Ministry wording asks for the same thing go together; merge wordings that differ by a word or two; split where the subject matter or the action differs (Philosophy is not History; Food Studies is not Metalwork; Dance Technique is not Choreography; Computer Science is not Math). A group with one Ministry wording is one set. Every competency id of the group must land in exactly one set.
2. For each set, in each grade band it needs (`"all"` when its courses are all grades 8–9 or all 10–12; both `"8-9"` and `"10-12"` when it spans; the grade 8–9 wording must read clearly younger):
   - `phrase`: the skill in that course's own terms; a lower-case verb phrase that reads after "she can …"; at most 14 words.
   - `next_steps`: `emerging`, `developing`, `proficient`, `extending`; each a lower-case verb phrase that reads after "her next step is to …"; a real step up at each level.
   - `strength`: two full sentences, two different aspects of what the skill looks like in her work.
   - `next`: `developing`, `proficient`, `extending`: three full next-step sentences.
   - `home`: one full sentence, something any family can do: no cost, no equipment, no expertise, not preachy.
3. Keep the group's `old` wording (phrase, next_steps) in the output so the before and after can be shown.

## Rules

- **Read-aloud test.** Every next step and home line must make sense to a parent reading it cold: would they understand why this is the next step for their child? Colin flagged "The next step for her is to suggest fitting ways to remember or respond to a past wrong" as "a super-weird thing to say to someone". Name the skill plainly; never carry the Ministry's abstract wording into a sentence.

- **Next steps name a skill to practise or a work habit, never content.** Not a topic, text, unit, product or set activity. ("Next, she can practise deciding which concern comes first when two conflict in the kitchen", not "Next, she can research the food industry.") Specific to the course set's skill, never generic filler.
- **Vary next-step openings across the batch.** Not every one "practise". Mix: "practise…", "make a habit of…", "build the habit of…", "keep…", "try…" and plain verbs. (The app's lint bans "work on" and "get in" as phrasal verbs.) Full-sentence openers vary too: "Her next step is to…", "Next, she can…", "To go further, she can…", "One habit to build is…", "She is ready to…", "A good next step is to…". No one opening above about a sixth of a batch's next steps.
- **Canadian spelling:** colour, behaviour, honour, favourite, centre, theatre, defence, travelled, modelled, labelled, catalogue, dialogue; "practise" (verb) / "practice" (noun); "program". The BC Ministry's own -ize spellings (analyze, organize, recognize) stay.
- True to the Ministry wording and I Can statements; never invent course content, texts, tools or routines beyond what the wording names.
- Plain, warm, specific, sentence case, one idea per sentence, 20 words or fewer per sentence. Nothing stylized or AI-sounding ("delve", "showcase", "demonstrates a strong", "journey", "foster"). No "classmates", "is able to" or "ability to", no comparison with the class, no exclamation marks, no jargon a parent wouldn't follow. "Indigenous" except in official names (English First Peoples, First Peoples Principles of Learning). Oral knowledge from Elders is never framed as something to doubt. Never use the name "Kai".
- Sentences use the bank's slots: `{He}` `{he}` `{His}` `{his}` `{him}` `{himself}`. A present-tense verb after `{He}`/`{he}` (or after one adverb) is written `[s-form|plain]`: `{He} [weighs|weigh]`, `{he} [is|are]`.

## Output

Write `data/course-sets/<batch>.json` in the sample's shape:

```json
{ "<group>": { "old": { "phrase": "…", "next_steps": { … } },
  "sets": [ { "id": "<group>--<short-set-name>", "courses": ["…"], "competency_ids": ["bc.…"], "ministry": "…",
              "bands": { "all": { "phrase": "…", "next_steps": { "emerging": "…", "developing": "…", "proficient": "…", "extending": "…" },
                                  "strength": ["…", "…"], "next": { "developing": "…", "proficient": "…", "extending": "…" }, "home": "…" } } } ] } }
```

Write the file as you go (a group at a time), so work is never lost.

## Check

Run `node scripts/check-course-sets.mjs data/course-sets/<batch>.json`. Fix until it prints `clean`. Read every `WARN` and fix the real ones. The checker cannot judge truth, grade level or specificity: reread each set against its Ministry wording before you finish.

Reply in under 6 lines: groups, sets, sentences, the checker's last line, and anything Colin should know.
