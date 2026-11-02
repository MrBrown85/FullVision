# Competency name rules

Each file here names the competencies of one group of courses for
`scripts/bc_curriculum_derive.py`. `COURSES` lists the course keys; `RULES` is
an ordered list of `(pattern, name)` pairs. A competency takes the name of the
first rule whose pattern matches its official statement (Python `re.search`,
case-insensitive). A third element, a list of course keys, limits a rule to
those courses; use it only to settle a clash inside one course.

Social Studies names come from the bracket concept and live in the derive
script, not here.

## What a name must be

- A noun phrase in Title Case, 20 characters or fewer. Short words (a, an, the,
  and, or, of, to, in, for, with, on, by, at, as) stay lower case unless first.
  `&` may stand for "and".
- Built from the statement's own verb and object: the verb as a noun or gerund
  (Analysis, Testing, Generation, Planning) and the object it acts on (Idea,
  Data, Prototype). Use the statement's words or their direct noun forms. Add
  no idea the statement does not name.
- Readable in both "Her strongest work is in …" and "An area to build is …".
  Name the skill or practice, never a trait of the student: "Waste Reduction",
  not "Carefulness".
- Unique within each course (case does not count). The same wording gets the
  same name in every course, which is why rules are shared across a list.
- Not the statement's first words cut short, and not ending in a function word
  (and, or, of, to, in, for, with, using, how, about, the, a, an).
- Not the same as its folder's name.

Examples:

| Statement                                                  | Name                |
| ---------------------------------------------------------- | ------------------- |
| Engage in a period of research and empathetic observation  | Empathetic Research |
| Generate potential ideas and add to others’ ideas          | Idea Generation     |
| Test the first version of the product or the prototype     | Prototype Testing   |
| Use materials in ways that minimize waste                  | Waste Reduction     |
| Seek and analyze patterns, trends, and connections in data | Data Patterns       |

## Writing a pattern

Anchor on the verb and the key object, specific rules before general ones:
`r"^Generate (potential )?ideas"` before `r"ideas"`. A pattern that matches
too much gives two competencies in one course the same name, and the check
fails.

## Checking

```bash
python3 scripts/bc_curriculum_derive.py report adst --show
```

lists every competency of the list's courses with its code and name, then
anything unplaced and every broken rule. `check` (run by CI) fails on any
problem; `build` writes `data/bc-curriculum-derived.json`.
