#!/usr/bin/env python3
"""Build data/bc-core-competencies.json from the BC Ministry's Core Competency pages.

The seven Core Competencies FullVision tags work with (CORE_COMPETENCIES in
shared/constants.js) each have a page on curriculum.gov.bc.ca/competencies.
This script copies, word for word, each one's description (the paragraphs
under its title) and its facets (the Facets tab: a name and its paragraphs).
Only Unicode NFC and whitespace are normalised, as in scripts/bc_curriculum.py,
whose fetching, caching and normalising it reuses.

Raw pages are cached outside the repo, in $FV_BC_SOURCES/core (default
~/FullVision-bc-sources/core). They are Crown copyright and must not be
committed.

Usage:
  python3 scripts/bc_core_competencies.py fetch    # download the seven pages (network)
  python3 scripts/bc_core_competencies.py build    # parse cached pages, write data/
  python3 scripts/bc_core_competencies.py verify   # re-extract and compare (golden check)

Standard library only.
"""

import os
import re
import sys
from datetime import date
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bc_curriculum as bc  # noqa: E402

OUT = os.path.join(bc.REPO, "data", "bc-core-competencies.json")

# FullVision's id (CORE_COMPETENCIES) -> the Ministry page, in the Ministry's order.
PAGES = [
    ("COM", "communication/communicating"),
    ("COL", "communication/collaborating"),
    ("CT", "thinking/creative-thinking"),
    ("CRT", "thinking/critical-and-reflective-thinking"),
    ("PPI", "personal-and-social/positive-personal-and-cultural-identity"),
    ("PAR", "personal-and-social/personal-awareness-and-responsibility"),
    ("SAR", "personal-and-social/social-awareness-and-responsibility"),
]
GROUPS = {
    "communication": "Communication",
    "thinking": "Thinking",
    "personal-and-social": "Personal and Social",
}


def cache_file(path):
    return bc.cache_path("core", bc.page_slug(path) + ".html")


def url_of(path):
    return f"{bc.BASE}/competencies/{path}"


class _Text(HTMLParser):
    """Collects the text of <h1>, <h3> and <p> elements, in order, as
    (tag, text) pairs."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self._tag = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h3", "p") and self._tag is None:
            self._tag = tag
            self._buf = []
        elif tag == "br" and self._tag:
            self._buf.append(" ")

    def handle_endtag(self, tag):
        if tag == self._tag:
            text = bc.norm("".join(self._buf))
            if text:
                self.out.append((tag, text))
            self._tag = None

    def handle_data(self, data):
        if self._tag:
            self._buf.append(data)


def _texts(fragment):
    p = _Text()
    p.feed(fragment)
    p.close()
    return p.out


def _tab_at(html, n):
    """Where the page's nth tab panel starts (0 Facets, 1 Profiles), or -1."""
    m = re.search(r'id="quicktabs-tabpage-[\w-]*?-%d" class="quicktabs-tabpage' % n, html)
    return m.start() if m else -1


def parse_page(html):
    """{ name, description: [paragraph], facets: [{ name, text: [paragraph] }] }"""
    title_at = html.find('<h1 class="title">')
    body_at = html.find("node__content", title_at)
    tabs_at = html.find("quicktabs", body_at)
    facets_at = _tab_at(html, 0)
    profiles_at = _tab_at(html, 1)
    if min(title_at, body_at, tabs_at, facets_at, profiles_at) < 0:
        raise ValueError("page layout not recognised")
    name = _texts(html[title_at:body_at])[0][1]
    description = [t for tag, t in _texts(html[body_at:tabs_at]) if tag == "p" and not t.startswith("Back to ")]
    facets = []
    for tag, text in _texts(html[facets_at:profiles_at]):
        if tag == "h3":
            facets.append({"name": text, "text": []})
        elif tag == "p" and facets:
            facets[-1]["text"].append(text)
    if not description or not facets or any(not f["text"] for f in facets):
        raise ValueError("description or facets missing")
    return {"name": name, "description": description, "facets": facets}


def cmd_fetch(args):
    for _, path in PAGES:
        status, body = bc.http_get(url_of(path))
        if status != 200:
            sys.exit(f"{path}: HTTP {status}")
        with open(cache_file(path), "wb") as f:
            f.write(body)
        print(f"fetched {path} ({len(body)} bytes)")


def build():
    out = {
        "_source": {
            "description": "The Ministry's descriptions of the BC Core Competencies, copied by scripts/bc_core_competencies.py: each one's description and facets, word for word. Only Unicode NFC and whitespace are normalised.",
            "licence_note": "© Province of British Columbia. Reproduced from curriculum.gov.bc.ca; permission requested.",
        }
    }
    for cid, path in PAGES:
        fn = cache_file(path)
        if not os.path.exists(fn):
            sys.exit(f"{path}: not cached; run fetch first")
        with open(fn, encoding="utf-8") as f:
            rec = parse_page(f.read())
        rec["group"] = GROUPS[path.split("/")[0]]
        rec["source"] = {
            "url": url_of(path),
            "format": "web",
            "sha256": bc.sha256_file(fn),
            "fetched": date.fromtimestamp(os.path.getmtime(fn)).isoformat(),
        }
        out[cid] = rec
    return out


def cmd_build(args):
    out = build()
    bc.write_json(OUT, out)
    print(f"wrote {OUT}: {len(out) - 1} Core Competencies")


def cmd_verify(args):
    stored = bc.load_json(OUT)
    fresh = build()
    problems = []
    for cid, _ in PAGES:
        a, b = stored.get(cid), fresh.get(cid)
        if not a:
            problems.append(f"{cid}: not stored")
            continue
        if a["source"]["sha256"] != b["source"]["sha256"]:
            problems.append(f"{cid}: the cached page is not the one the text was built from")
        for field in ("name", "description", "facets", "group"):
            if a[field] != b[field]:
                problems.append(f"{cid}: {field} differs from a fresh extraction")
    for p in problems:
        print(p)
    print(f"verify: {len(problems)} problem(s) in {len(PAGES)} Core Competencies")
    sys.exit(1 if problems else 0)


COMMANDS = {"fetch": cmd_fetch, "build": cmd_build, "verify": cmd_verify}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
