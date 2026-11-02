#!/usr/bin/env python3
"""Folders, codes and names for the BC curriculum bank, by rule.

Stage 2 of the curriculum bank rebuild. Reads data/bc-curriculum-source.json
(the Ministry's text, stage 1) and writes data/bc-curriculum-derived.json:
for every competency, its folder, its code and its name, each with the rule
that made it. The source file is never changed. Nothing here is typed per
competency: every value comes from a heading, a curated list below, or a
name rule in scripts/bc_names/.

Rules (owner decisions 5-9 and 14, Nov 1 2026):
  - Folder: the lowest heading the Ministry prints above the competencies
    (categories[].path[-1]), in Title Case. ADST's parent "Applied Design"
    stays in path only. A heading with one competency gets no folder. Social
    Studies (with Philosophy) gets no folders. ELA bracket glosses stay in
    path only. FOLDER_SHORT shortens headings over 30 characters.
  - Code: the heading's stem (STEMS) plus the competency's position under
    that heading. Social Studies: the bracket concept's code (SS_CONCEPTS),
    numbered only when a course has the concept twice.
  - Name: the first matching rule in the course's name list
    (scripts/bc_names/*.py). Social Studies: the bracket concept's name.

Usage:
  python3 scripts/bc_curriculum_derive.py build           # write the derived file
  python3 scripts/bc_curriculum_derive.py check           # fail if stale or any rule is broken
  python3 scripts/bc_curriculum_derive.py report [list] [--show]
                                                          # problems for one name list

Standard library only. Reads no Ministry files, so it runs in CI.
"""

import hashlib
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(REPO, "data", "bc-curriculum-source.json")
OUT = os.path.join(REPO, "data", "bc-curriculum-derived.json")
NAMES_DIR = os.path.join(REPO, "scripts", "bc_names")

SS = "Social Studies"
SHORT_WORDS = set("a an the and or nor but of to in for with on by at as".split())
FOLDER_MAX = 30
NAME_MAX = 20
CODE_MAX = 6
# A dangling last word means the name was cut mid-thought.
DANGLING = set("and or of to in for with using how about the a an".split())

# Headings over 30 characters, shortened. Every word kept is the Ministry's.
FOLDER_SHORT = {
    "processing and analyzing data and information": "Processing and Analyzing",
    "outdoor activity skills and healthy living": "Outdoor Skills, Healthy Living",
    "collaboration, teamwork, and safety": "Collaboration and Safety",
}

# Heading (lower case, gloss removed) -> code stem. 2-3 letters. A stem may
# not end in I, L or O (they read as 1 or 0 beside a digit) and may not read
# as a word ("AI" for Applying and Innovating, "US" for Understanding and
# solving). Within a course every heading's stem is different.
STEMS = {
    # ADST
    "understanding context": "UC",
    "defining": "DF",
    "ideating": "ID",
    "prototyping": "PR",
    "testing": "TS",
    "making": "MK",
    "sharing": "SH",
    "applied skills": "SK",
    "applied technologies": "TC",
    "applied design": "DS",  # Business Education's single Applied Design heading; EDT12
    # Arts Education (grades 10-12 and 8-9 forms)
    "explore and create": "EC",
    "exploring and creating": "EC",
    "reason and reflect": "RR",
    "reasoning and reflecting": "RR",
    "communicate and document": "CD",
    "communicating and documenting": "CD",
    "connect and expand": "CE",
    "connecting and expanding": "CE",
    # Career Education
    "examine": "EX",
    "interact": "INT",
    "experience": "EXP",
    "initiate": "IA",
    "share": "SH",
    "connect and apply": "CA",
    "reflect and refine": "RR",
    "connect and wonder": "CW",
    "explore and investigate": "EXV",
    "experience and develop": "EXD",
    # English Language Arts
    "comprehend and connect": "CP",
    "create and communicate": "CR",
    # Mathematics
    "reasoning and modelling": "RM",
    "reasoning and analyzing": "RA",
    "understanding and solving": "UND",
    "communicating and representing": "CM",
    "connecting and reflecting": "CN",
    # Physical and Health Education
    "physical literacy": "PHY",
    "healthy and active living": "HAV",
    "health and active living": "HAV",
    "social and community health": "SC",
    "mental well-being": "MW",
    "health and well-being": "HW",
    "safety": "SF",
    "participation": "PT",
    "leadership": "LD",
    "outdoor leadership": "LD",
    "human anatomy and physiology": "ANP",
    "principles of training": "TR",
    "social responsibility": "SR",
    "outdoor activity skills and healthy living": "OS",
    "collaboration, teamwork, and safety": "CTS",
    # Science
    "questioning and predicting": "QP",
    "planning and conducting": "PC",
    "processing and analyzing data and information": "PA",
    "evaluating": "EV",
    "applying and innovating": "AP",
    "communicating": "CM",
}
# Career Education 8 and 9 print their competencies under no heading.
NO_HEADING_STEM = {"Career Education": "CE"}

# Short English words a code stem must not spell. Checked for every stem.
WORD_STEMS = set(
    "AD AH AI AM AN AS AT AX BE BY DO ED GO HA HE HI IF IN IS IT ME MY NO OF OH OK ON OR OW OX SO TO UH UM UN UP US WE "
    "ACT ADD AGE AID AIM AIR AND ANT ANY APE APT ARC ARE ARK ARM ART ASH ASK BAD BAG BAN BAT BED BET BIG BIN BIT BOX "
    "BUS BUT BUY CAN CAP CAR CAT CON COP COW CRY CUP CUT DAD DAY DEN DIE DIG DOG DOT DRY DUE EAR EAT EGG END ERA EVE "
    "EYE FAN FAR FAT FEW FIT FIX FLY FOR FOX FUN GAP GAS GET GOD GOT GUN GUT GUY HAD HAM HAP HAS HAT HEN HER HIM HIP "
    "HIS HIT HOT HOW HUG ICE ILL IMP INK ION ITS JAM JAR JET JOB JOG JOY KEY KID KIT LAB LAP LAW LAY LED LEG LET LID "
    "LIE LIP LOG LOT LOW MAD MAN MAP MAT MED MEN MET MIX MOB MOM MUD NAP NET NEW NOD NOR NOT NOW NUT OAK ODD OFF OIL "
    "OLD ONE OUR OUT OWE OWL OWN PAD PAN PAT PAW PAY PEN PET PIE PIG PIN PIT POP POT PUT RAG RAN RAT RAW RED REL RID "
    "RIP ROB ROD ROT ROW RUB RUG RUN SAD SAT SAW SAY SEA SEE SET SEW SHE SIN SIP SIR SIT SIX SKI SKY SOB SON SOP SOW "
    "SPA SPY SUM SUN TAB TAG TAN TAP TAR TAX TEA TEN THE TIE TIN TIP TOE TON TOO TOP TOY TRY TUB TWO USE VAN VAT WAR "
    "WAS WAX WAY WEB WET WHO WHY WIN WIT WON YES YET YOU ZIP".split()
)

# Social Studies: bracket concept -> (code, name). The seven historical
# thinking concepts, then the geography and religion concepts.
SS_CONCEPTS = {
    "significance": ("SIG", "Significance"),
    "evidence": ("EVI", "Evidence"),
    "continuity and change": ("CHG", "Continuity & Change"),
    "cause and consequence": ("CAU", "Cause & Consequence"),
    "perspective": ("PER", "Perspective"),
    "ethical judgment": ("ETH", "Ethical Judgment"),
    "sense of place": ("PLC", "Sense of Place"),
    "evidence and interpretation": ("EVN", "Geographic Evidence"),
    "patterns and trends": ("PTR", "Patterns & Trends"),
    "geographical value judgments": ("GVJ", "Value Judgments"),
    "geographical importance": ("GIM", "Geographic Merit"),
    "interactions and associations": ("IAS", "Factor Interactions"),
    "critical media literacy": ("CML", "Media Literacy"),
}
# Social Studies statements with no bracket concept: (pattern, code, name).
# The first is the inquiry competency every course opens with; it gets INQ
# even where the Ministry adds a bracket (PGEO12 tags it evidence and
# interpretation).
SS_UNBRACKETED = [
    (r"^Use [\w ]*inquiry processes", "INQ", "Inquiry"),
    (r"^Use indigenous principles of learning", "IPR", "Indigenous Learning"),
    (r"^Assess the relevance of philosophical ideas", "RLV", "Everyday Relevance"),
]
# A course with one concept twice: each gets a number (SIG1, SIG2) and a name
# from its own verb and object. (pattern, name).
SS_TWICE = [
    (r"^Assess the significance of", "Significance"),
    (r"creators of accounts, narratives", "Significance Claims"),
    (r"^Recognize implicit and explicit ethical judgments", "Ethics in Sources"),
    (r"^Make reasoned ethical judgments about actions in the past", "Ethical Judgment"),
    (r"^Make reasoned ethical judgments about current and past issues", "Ethical Judgment"),
    (r"^Make reasoned ethical judgments about legal systems", "Ethics of Law"),
    (r"^Make reasoned ethical judgments about controversial decisions", "Ethics of Policy"),
    (r"^Make reasoned ethical judgments about controversial actions", "Ethical Judgment"),
    (r"^Evaluate how particular geographic actions", "Impact on People"),
    (r"^Assess the long- and short-term causes", "Cause & Consequence"),
    (r"connectedness or the reciprocal relationship between people and place", "People & Place"),
    (r"^Explain different perspectives on past and present", "Perspective"),
    (r"^Explain and infer perspectives and sense of place", "Sense of Place"),
    (r"^Assess how historical conditions influenced", "Theory Origins"),
    (r"^Assess how economic theories affected", "Theory Impacts"),
]


def norm_heading(h):
    return re.sub(r"\s*\([^)]*\)\s*$", "", h).strip()


def title_case(s):
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        if i > 0 and w.lower() in SHORT_WORDS:
            out.append(w.lower())
        else:
            out.append("-".join(p[:1].upper() + p[1:] for p in w.split("-")))
    return " ".join(out)


def raw_sha(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------------ checks


def content_words(t):
    return [w for w in re.findall(r"[a-z][a-z'’-]*", t.lower()) if w not in SHORT_WORDS]


def name_problems(name, raw, siblings):
    """Why a name breaks the name rule, if it does. `siblings` is the number
    of competencies under the same heading (the cut-prefix guard ignores
    lone ones, as tests/curriculum-labels.test.js does)."""
    p = []
    if len(name) > NAME_MAX:
        p.append(f"longer than {NAME_MAX} characters")
    for i, w in enumerate(name.split(" ")):
        if w == "&":
            continue
        if i > 0 and w.lower() in SHORT_WORDS:
            if w != w.lower():
                p.append(f"short word not lower case: {w}")
            continue
        if not all(part[:1].isupper() or part[:1].isdigit() for part in w.split("-")):
            p.append(f"not Title Case: {w}")
    if re.search(r"\band\b", name, re.I):
        p.append('spells "and"; names use "&"')
    if name.split(" ")[-1].lower() in DANGLING:
        p.append("ends in a function word")
    lw, rw = content_words(name), content_words(raw)
    if (
        len(lw) >= 3
        and rw[: len(lw)] == lw
        and name.split(" ")[0].lower() == raw.split(" ")[0].lower()
        and len(rw) > len(lw)
        and siblings > 1
    ):
        p.append("is the statement's first words, cut")
    return p


def code_problems(code):
    p = []
    if len(code) > CODE_MAX:
        p.append(f"longer than {CODE_MAX} characters")
    m = re.fullmatch(r"([A-Z]{2,3})([1-9][0-9]?)?", code)
    if not m:
        return p + ["not 2-3 capital letters plus an optional number"]
    stem, num = m.groups()
    if num and stem[-1] in "ILO":
        p.append("stem ends in I, L or O beside a digit")
    if stem in WORD_STEMS:
        p.append("stem spells a word")
    return p


# ------------------------------------------------------------------- names


def load_name_lists():
    """Every scripts/bc_names/*.py module: COURSES (keys) and RULES, a list of
    (pattern, name) or (pattern, name, [course keys]) tried in order."""
    lists = {}
    for fn in sorted(os.listdir(NAMES_DIR)):
        if not fn.endswith(".py") or fn.startswith("_"):
            continue
        name = fn[:-3]
        spec = importlib.util.spec_from_file_location(f"bc_names_{name}", os.path.join(NAMES_DIR, fn))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        rules = []
        for r in mod.RULES:
            pat, nm = r[0], r[1]
            only = set(r[2]) if len(r) > 2 else None
            rules.append((pat, re.compile(pat, re.I), nm, only))
        lists[name] = {"courses": list(mod.COURSES), "rules": rules}
    return lists


def name_for(raw, key, rules):
    for pat, rx, nm, only in rules:
        if only and key not in only:
            continue
        if rx.search(raw):
            return nm, pat
    return None, None


# ------------------------------------------------------------------- build


def ss_course(key, rec, problems, notes):
    comps = [x for cat in rec["categories"] for x in cat["competencies"]]
    rows = []
    for x in comps:
        raw = x["raw"]
        hit = next(((c, n, p) for p, c, n in SS_UNBRACKETED if re.search(p, raw)), None)
        m = re.search(r"\(([^()]*)\)\s*$", raw)
        if hit:
            rows.append({"x": x, "code": hit[0], "name": hit[1], "rule": hit[2], "concept": None, "how": "list"})
            if m and hit[0] == "INQ":
                notes.append(f"{x['id']}: inquiry statement tagged ({m.group(1)}) by the Ministry; coded INQ")
        elif m and m.group(1) in SS_CONCEPTS:
            c, n = SS_CONCEPTS[m.group(1)]
            rows.append({"x": x, "code": c, "name": n, "rule": f"({m.group(1)})", "concept": m.group(1), "how": "concept"})
        else:
            problems.append(f"{x['id']}: no Social Studies concept for: {raw[:90]}")
            rows.append({"x": x, "code": None, "name": None, "rule": None, "concept": None, "how": None})
    count = Counter(r["code"] for r in rows if r["code"])
    seen = Counter()
    for r in rows:
        if r["code"] and count[r["code"]] > 1:
            seen[r["code"]] += 1
            r["code"] = f"{r['code']}{seen[r['code']]}"
            # The name now comes from the SS_TWICE list, not the concept.
            pat, hit = next(((p, n) for p, n in SS_TWICE if re.search(p, r["x"]["raw"])), (None, None))
            if not hit:
                problems.append(f"{r['x']['id']}: concept appears twice in {key} and no SS_TWICE name fits")
            r["name"], r["rule"], r["how"] = hit, pat, "list"
            notes.append(f"{r['x']['id']}: {key} has this concept twice; coded {r['code']}, named {hit!r}")
    out = []
    for r in rows:
        out.append(
            {
                "id": r["x"]["id"],
                "code": r["code"],
                "short_label": r["name"],
                "prov": {
                    "folder": "none: Social Studies",
                    "code": "concept",
                    "short_label": r["how"],
                    "rule": r["rule"],
                    "raw_sha": raw_sha(r["x"]["raw"]),
                },
            }
        )
    # One flat category, as in the source.
    cats, i = [], 0
    for cat in rec["categories"]:
        n = len(cat["competencies"])
        cats.append({"path": cat["path"], "folder": None, "stem": None, "competencies": out[i : i + n]})
        i += n
    return cats


def course_derived(key, rec, list_name, rules, problems, unplaced, notes):
    if rec["subject"] == SS:
        return ss_course(key, rec, problems, notes)
    cats = []
    printed = Counter()
    phases = any(len(c["path"]) > 1 for c in rec["categories"])
    for cat in rec["categories"]:
        heading = norm_heading(cat["path"][-1]) if cat["path"] and cat["path"][-1] else None
        n = len(cat["competencies"])
        if heading is None:
            stem = NO_HEADING_STEM.get(rec["subject"])
            folder, fprov = None, "none: no heading"
        else:
            stem = STEMS.get(heading.lower())
            if heading.lower() in FOLDER_SHORT:
                folder, fprov = FOLDER_SHORT[heading.lower()], "short list"
            else:
                folder, fprov = title_case(heading), "heading"
            if n == 1:
                folder, fprov = None, "none: one competency under the heading"
            # Decision 5: in a course with phases, "Applied Design" is the
            # parent heading and never a folder, whatever it holds.
            if cat["path"] == ["Applied Design"] and phases:
                folder, fprov = None, "none: printed under Applied Design, above the phases"
                notes.append(
                    f"{key}: {n} competency printed under Applied Design itself, above the phases; "
                    f"coded {stem}, no folder"
                )
        if not stem:
            problems.append(f"{key}: no code stem for heading {heading!r}")
        comps = []
        for pos, x in enumerate(cat["competencies"], 1):
            nm, pat = name_for(x["raw"], key, rules)
            if nm is None:
                unplaced.append({"course": key, "id": x["id"], "list": list_name, "raw": x["raw"]})
            # The Ministry prints a few statements twice in one course: the
            # repeat keeps the name, numbered.
            printed[x["raw"]] += 1
            if nm and printed[x["raw"]] > 1:
                nm = f"{nm} {printed[x['raw']]}"
                pat = f"{pat} (printed twice)"
                notes.append(f"{x['id']}: the Ministry prints this statement twice in {key}; named {nm!r}")
            comps.append(
                {
                    "id": x["id"],
                    "code": f"{stem}{pos}" if stem else None,
                    "short_label": nm,
                    "prov": {
                        "folder": fprov,
                        "code": "stem+position",
                        "short_label": f"rule:{list_name}" if nm else "unplaced",
                        "rule": pat,
                        "raw_sha": raw_sha(x["raw"]),
                    },
                }
            )
        cats.append({"path": cat["path"], "folder": folder, "stem": stem, "competencies": comps})
    return cats


def check_course(key, rec, cats, problems):
    codes, names = Counter(), Counter()
    if any(len(c["path"]) > 1 for c in cats) and any(c["folder"] == "Applied Design" for c in cats):
        problems.append(f"{key}: Applied Design is a folder in a course with phases")
    raws = {x["id"]: x["raw"] for cat in rec["categories"] for x in cat["competencies"]}
    stems = [c["stem"] for c in cats if c["stem"]]
    if len(set(stems)) != len(stems):
        problems.append(f"{key}: two headings share a code stem: {stems}")
    for cat in cats:
        for c in cat["competencies"]:
            if c["code"]:
                codes[c["code"]] += 1
                for p in code_problems(c["code"]):
                    problems.append(f"{c['id']}: code {c['code']}: {p}")
            if c["short_label"]:
                names[c["short_label"].lower()] += 1
                for p in name_problems(c["short_label"], raws[c["id"]], len(cat["competencies"])):
                    problems.append(f"{c['id']}: name {c['short_label']!r}: {p}")
                if cat["folder"] and c["short_label"].lower() == cat["folder"].lower():
                    problems.append(f"{c['id']}: name {c['short_label']!r} is its folder's name")
        if cat["folder"] and len(cat["folder"]) > FOLDER_MAX:
            problems.append(f"{key}: folder {cat['folder']!r} is over {FOLDER_MAX} characters")
    for code, n in codes.items():
        if n > 1:
            problems.append(f"{key}: code {code} used {n} times")
    for nm, n in names.items():
        if n > 1:
            ids = [c["id"] for cat in cats for c in cat["competencies"] if (c["short_label"] or "").lower() == nm]
            problems.append(f"{key}: name {nm!r} used {n} times: {', '.join(ids)}")


def build(only_list=None):
    src = json.load(open(SOURCE, encoding="utf-8"))
    lists = load_name_lists()
    owner = {}
    problems, unplaced, notes = [], [], []
    for ln, l in lists.items():
        for k in l["courses"]:
            if k in owner:
                problems.append(f"{k}: in two name lists ({owner[k]}, {ln})")
            owner[k] = ln
    out = {
        "_derived": {
            "description": "Folders, codes and names for data/bc-curriculum-source.json, made by "
            "scripts/bc_curriculum_derive.py from headings and curated lists. Keyed by course and "
            "competency id. Ministry text lives only in the source file.",
            "source_sha256": hashlib.sha256(open(SOURCE, "rb").read()).hexdigest(),
        }
    }
    for key, rec in src.items():
        if key.startswith("_"):
            continue
        ln = owner.get(key)
        if only_list and ln != only_list:
            continue
        if rec["subject"] != SS and not ln:
            problems.append(f"{key}: in no name list")
        rules = lists[ln]["rules"] if ln else []
        cats = course_derived(key, rec, ln, rules, problems, unplaced, notes)
        check_course(key, rec, cats, problems)
        out[key] = {"categories": cats}
    for k in owner:
        if k not in src:
            problems.append(f"{k}: in a name list but not in the source")
    # A rule that never names anything first is dead weight in the review.
    for ln, l in lists.items():
        if only_list and ln != only_list:
            continue
        fired = {
            (c["prov"]["rule"].removesuffix(" (printed twice)"), re.sub(r" \d+$", "", c["short_label"]))
            for k in l["courses"]
            if k in out
            for cat in out[k]["categories"]
            for c in cat["competencies"]
            if c["prov"]["rule"]
        }
        for pat, _, nm, _ in l["rules"]:
            if (pat, nm) not in fired:
                problems.append(f"{ln}: rule {pat!r} ({nm}) never names a competency first")
    out["_derived"]["unplaced"] = unplaced
    out["_derived"]["notes"] = notes
    return out, problems, unplaced


def write(out):
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


def cmd_build(args):
    out, problems, unplaced = build()
    write(out)
    for p in problems:
        print(p)
    n = sum(len(cat["competencies"]) for k, v in out.items() if not k.startswith("_") for cat in v["categories"])
    print(f"{len(out) - 1} courses, {n} competencies, {len(unplaced)} unplaced, {len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


def cmd_check(args):
    out, problems, unplaced = build()
    try:
        stored = json.load(open(OUT, encoding="utf-8"))
    except FileNotFoundError:
        stored = None
    if stored != out:
        problems.append(f"{os.path.relpath(OUT, REPO)} is not what the script builds; run build")
    for p in problems:
        print(p)
    print(f"check: {len(problems)} problem(s), {len(unplaced)} unplaced")
    sys.exit(1 if problems else 0)


def cmd_report(args):
    show = "--show" in args
    args = [a for a in args if a != "--show"]
    only = args[0] if args else None
    out, problems, unplaced = build(only)
    src = json.load(open(SOURCE, encoding="utf-8"))
    if show:
        for key, v in out.items():
            if key.startswith("_"):
                continue
            raws = {x["id"]: x["raw"] for cat in src[key]["categories"] for x in cat["competencies"]}
            print(f"\n## {key} {src[key]['course_name']}")
            for cat in v["categories"]:
                print(f"  [{cat['folder'] or '-'}]")
                for c in cat["competencies"]:
                    print(f"    {c['code'] or '?':6} {c['short_label'] or '???':20} | {raws[c['id']][:110]}")
    for u in unplaced:
        print(f"UNPLACED {u['id']}: {u['raw']}")
    for p in problems:
        print(p)
    print(f"report{' ' + only if only else ''}: {len(unplaced)} unplaced, {len(problems)} problem(s)")


COMMANDS = {"build": cmd_build, "check": cmd_check, "report": cmd_report}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
