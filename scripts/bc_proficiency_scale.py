#!/usr/bin/env python3
"""Build data/bc-proficiency-scale.json from the Ministry's own proficiency scale file.

The four levels of the Provincial Proficiency Scale (Emerging, Developing,
Proficient, Extending), copied by this script from the Ministry's
"Unpacking the Proficiency Scale: Support for Educators" PDF. Nothing is typed
or paraphrased by hand. Only Unicode NFC and whitespace are normalised. The
proficiency descriptors (~/reports/Proficiency descriptors plan.md) are
anchored to this text.

Each level's `anchor` is a phrase picked from its definition, the words every
descriptor at that level must echo; a test proves each one is a substring of
the copied text.

The PDF is cached outside the repo, in $FV_BC_SOURCES/proficiency (default
~/FullVision-bc-sources). It is Crown copyright and must not be committed.

Usage:
  python3 scripts/bc_proficiency_scale.py fetch    # download the PDF (network)
  python3 scripts/bc_proficiency_scale.py build    # extract, write data/
  python3 scripts/bc_proficiency_scale.py verify   # re-extract and compare (golden check)

build and verify read the PDF with pypdfium2, the one module outside the
standard library. Without it, verify prints "verify: skipped" and exits 3.
"""

import hashlib
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import date

URL = (
    "https://www2.gov.bc.ca/assets/gov/education/administration/kindergarten-to-grade-12/"
    "unpacking-the-proficency-scale-support-for-educators.pdf"
)
TITLE = "Unpacking the Proficiency Scale: Support for Educators"
PAGE = 2
UA = "Mozilla/5.0 (FullVision curriculum sync; contact colin.brown04@gmail.com)"

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(os.path.expanduser(os.environ.get("FV_BC_SOURCES", "~/FullVision-bc-sources")), "proficiency")
PDF = os.path.join(SOURCES, "unpacking-the-proficency-scale-support-for-educators.pdf")
OUT = os.path.join(REPO, "data", "bc-proficiency-scale.json")

LEVELS = ["Emerging", "Developing", "Proficient", "Extending"]
# The phrase each level's descriptors echo, picked from its definition.
ANCHORS = {
    "Emerging": "just beginning to demonstrate learning",
    "Developing": "with growing consistency",
    "Proficient": "consistently or most of the time",
    "Extending": "with increasing depth and complexity",
}


def clean(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z\"“])", text) if s]


def page_text():
    try:
        import pypdfium2
    except ImportError:
        return None
    doc = pypdfium2.PdfDocument(PDF)
    return doc[PAGE - 1].get_textpage().get_text_range()


def extract(text):
    """The four levels from the page: each runs from its quoted name to the next level's heading."""
    flat = clean(text)
    levels = []
    for i, name in enumerate(LEVELS):
        start = flat.find('"%s"' % name)
        if start < 0:
            raise SystemExit("no definition for %s on page %d" % (name, PAGE))
        if i + 1 < len(LEVELS):
            end = flat.find('%s "%s"' % (LEVELS[i + 1], LEVELS[i + 1]), start)
        else:
            end = flat.find("Contact us", start)
        if end < 0:
            raise SystemExit("no end for %s on page %d" % (name, PAGE))
        body = flat[start:end].strip()
        levels.append({"level": i + 1, "name": name, "text": sentences(body), "anchor": ANCHORS[name]})
    return levels


def sha256():
    with open(PDF, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def fetch():
    os.makedirs(SOURCES, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    if body[:4] != b"%PDF":
        raise SystemExit("not a PDF: " + URL)
    with open(PDF, "wb") as f:
        f.write(body)
    print("fetched %s (%d bytes)" % (PDF, len(body)))


def build():
    text = page_text()
    if text is None:
        raise SystemExit("build needs pypdfium2")
    levels = extract(text)
    for lv in levels:
        if lv["anchor"] not in " ".join(lv["text"]):
            raise SystemExit("anchor not in the %s text: %s" % (lv["name"], lv["anchor"]))
    data = {
        "_source": {
            "description": "The Provincial Proficiency Scale, copied word for word from the Ministry's file by "
            "scripts/bc_proficiency_scale.py. Each level's text is its paragraphs on the page, split into sentences; "
            "anchor is the phrase from it that descriptors at that level echo.",
            "title": TITLE,
            "publisher": "BC Ministry of Education and Child Care",
            "url": URL,
            "page": PAGE,
            "format": "pdf",
            "sha256": sha256(),
            "fetched": date.today().isoformat(),
        },
        "levels": levels,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote %s" % OUT)


def verify():
    text = page_text()
    if text is None:
        print("verify: skipped (no PDF reader)")
        sys.exit(3)
    with open(OUT, encoding="utf-8") as f:
        data = json.load(f)
    problems = []
    if data["_source"]["sha256"] != sha256():
        problems.append("the cached PDF's sha256 differs from the recorded one")
    fresh = {lv["name"]: lv["text"] for lv in extract(text)}
    for lv in data["levels"]:
        if fresh.get(lv["name"]) != lv["text"]:
            problems.append("%s text differs from the PDF" % lv["name"])
    for p in problems:
        print(p)
    print("verify: %d problem(s)" % len(problems))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    {"fetch": fetch, "build": build, "verify": verify}.get(mode, lambda: sys.exit(__doc__))()
