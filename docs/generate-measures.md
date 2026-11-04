# Generate Measures

How Generate's drafts read across a class, in numbers. `scripts/generate-measure.mjs` drafts Demo Mode's Science 8 class the way the Nov 4 2026 audit did (27 students × 4 presses, once as a Proficiency class and once as a Letter class, with varied Work Habits ratings: 216 drafts) and reports the measures below. The targets are plan v1 section 4 as revised by plan v2 (`~/reports/generate-ideal-comments-plan-v2.md`). The blind sort against a teacher's own comments is the release bar; these numbers are the floor.

Run it against a local server:

```bash
PORT=8701 node scripts/dev-local.mjs &
node scripts/generate-measure.mjs --base http://localhost:8701 --save drafts.json
node scripts/generate-measure.mjs --from drafts.json --blind 10 --seed 7 --sheet sheet.md --key key.md
```

Shapes are the first three words with the name and pronouns as one word each. A family is what the first sentence opens on (the name, a pronoun, the course, a grade word, the piece of work, a time phrase, other). Self-BLEU is each comment's BLEU-3 against the other 26 of its class set. Edit distance is word-level, over the longer draft.

## Before (main at 46a63b7, Nov 4 2026)

| Measure                                 | Value              | Target                          | Met |
| --------------------------------------- | ------------------ | ------------------------------- | --- |
| Top first-sentence shape                | 11.6%              | ≤ 15%                           | yes |
| Largest shape family                    | 48.1%              | ≤ 25%                           | no  |
| Largest frame share of a part           | 30.1%              | ≤ 10%                           | no  |
| Consecutive same-opener pairs           | 0                  | 0                               | yes |
| "this term" per draft                   | 1.73               | 0                               | no  |
| "so far" per draft (max)                | 2                  | ≤ 1                             | no  |
| "proficiency scale" per draft (max)     | 1                  | ≤ 1                             | yes |
| Banned phrases                          | 589                | 0                               | no  |
| Presses changing ≥ 4 sentences          | 94.4% (min 3)      | 100%                            | no  |
| Neighbour edit distance                 | 0.82               | ≥ 0.6                           | yes |
| Adjacent students sharing first 3 words | 24 (worst class 5) | ≤ 2 a class                     | no  |
| Sentences per draft                     | 5.91 (5–6)         | 5–7                             | yes |
| Words per sentence                      | 13.91 (max 20)     | mean ≈ 15, max ≤ 24             | yes |
| Press edit distance                     | 0.54               | ≥ 0.6                           | no  |
| Self-BLEU-3                             | 0.84               | reported (lower is more varied) | yes |
| Distinct-2 / distinct-3                 | 0.33 / 0.45        | reported                        | yes |

Frames per step (bank sentences used; top sentence and its share of the step):

| Step     | Used | Top   | Share |
| -------- | ---- | ----- | ----- |
| grade    | 44   | gr05  | 9.6%  |
| example  | 11   | n375  | 14.8% |
| overall  | 37   | n1002 | 8.8%  |
| habits   | 21   | hs10  | 16.2% |
| nextStep | 5    | ls04  | 30.1% |
| home     | 22   | f115  | 18.5% |

First-sentence families: name-first 48.1%, other 29.6%, time-first 9.3%, grade-first 8.8%, course-first 4.2%.
Top first-sentence shapes: “NAME is earning” 11.6%, “NAME is proficient” 11.1%, “the work marked” 6%, “across NAME science” 6%, “the bc proficiency” 5.6% (38 distinct).
Banned phrases: “is able to” 16, “the work marked” 27, “this term” 374, “all six” 10, “rated” 20, “proficiency scale calls” 12, “skill by skill” 6, “marks are close” 22, “across skills” 7, “work on” 56, “ability to” 17, “each skill” 4, “marked highest” 14, “every one” 4.
