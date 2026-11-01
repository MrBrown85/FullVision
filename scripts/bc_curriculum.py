#!/usr/bin/env python3
"""Build data/bc-curriculum-source.json from the BC Ministry's own course files.

Stage 1 of the curriculum bank rebuild. Every stored string is copied by this
script from the Ministry's DOCX (or a fallback) for each grade 8-12 course on
curriculum.gov.bc.ca. Nothing is typed or paraphrased by hand. Only Unicode NFC
and whitespace are normalised.

Raw files (HTML pages, DOCX, PDF) are cached outside the repo, in
$FV_BC_SOURCES (default ~/FullVision-bc-sources). They are Crown copyright and
must not be committed.

Usage:
  python3 scripts/bc_curriculum.py discover   # course list + links (network)
  python3 scripts/bc_curriculum.py fetch      # download course files (network)
  python3 scripts/bc_curriculum.py build      # parse cached files, write data/
  python3 scripts/bc_curriculum.py verify     # re-extract and compare (golden check)

Standard library only.
"""

import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from html.parser import HTMLParser

BASE = "https://curriculum.gov.bc.ca"
UA = "Mozilla/5.0 (FullVision curriculum sync; contact colin.brown04@gmail.com)"
THROTTLE_SECONDS = 1.5

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.expanduser(os.environ.get("FV_BC_SOURCES", "~/FullVision-bc-sources"))
MANIFEST = os.path.join(SOURCES, "manifest.json")
OUT_SOURCE = os.path.join(REPO, "data", "bc-curriculum-source.json")
OUT_COURSES = os.path.join(REPO, "data", "bc-curriculum-courses.json")
OUT_FLAGS = os.path.join(REPO, "data", "bc-curriculum-flags.json")
BANK = os.path.join(REPO, "curriculum_by_course.json")

# Subject areas in scope. Second-language areas (languages, fral,
# francais-langue-premiere) are left out by the owner's decision 2.
LISTING_SUBJECTS = [
    "adst",
    "arts-education",
    "english-language-arts",
    "mathematics",
    "physical-health-education",
    "science",
    "social-studies",
]
CORE_SUBJECTS = LISTING_SUBJECTS[:2] + ["career-education"] + LISTING_SUBJECTS[2:]
EXTRA_PAGES = [
    ("career-education/all/career-life-education", "Career-Life Education", "10-12"),
    # The /12/career-life-connections page is an empty stub whose DOCX and PDF
    # links 404; the course's working page and files sit under /all/.
    ("career-education/all/career-life-connections", "Career-Life Connections", "12"),
    ("additional-offerings/11/youth-work-in-trades", "Youth Work in Trades 11", "11"),
    ("additional-offerings/12/youth-work-in-trades", "Youth Work in Trades 12", "12"),
    ("additional-offerings/12A/work-experience", "Work Experience 12A", "12"),
    ("additional-offerings/12B/work-experience", "Work Experience 12B", "12"),
]
EXCLUDED_AREAS = ["languages", "fral", "francais-langue-premiere"]

# The bank's eight family strings, by site subject slug.
FAMILY = {
    "adst": "Applied Design, Skills and Technologies",
    "arts-education": "Arts Education",
    "career-education": "Career Education",
    "english-language-arts": "English Language Arts",
    "mathematics": "Mathematics",
    "physical-health-education": "Physical and Health Education",
    "science": "Science",
    "social-studies": "Social Studies",
    "additional-offerings": "Career Education",
}
CORE_NAME = {
    "adst": "Applied Design, Skills and Technologies",
    "arts-education": "Arts Education",
    "career-education": "Career Education",
    "english-language-arts": "English Language Arts",
    "mathematics": "Mathematics",
    "physical-health-education": "Physical and Health Education",
    "science": "Science",
    "social-studies": "Social Studies",
}

# Official page -> current bank key, where the names alone do not match.
KEY_OVERRIDES = {
    "english-language-arts/10/efp-literary-studies": "EFPLS10",
    "english-language-arts/10/efp-new-media": "EFPNM10",
    "english-language-arts/10/efp-spoken-language": "EFPSL10",
    "english-language-arts/10/efp-writing": "EFPW10",
    "english-language-arts/11/efp-literary-studies-and-new-media": "EFPLSNM11",
    "english-language-arts/11/efp-literary-studies-and-spoken-language": "EFPLSSL11",
    "english-language-arts/11/efp-literary-studies-and-writing": "EFPLSW11",
    "science/11/life-sciences": "LS11SCI",
    "career-education/all/career-life-education": "CLE10",
    "career-education/all/career-life-connections": "CLC12",
}
# Official courses the bank lacks: proposed keys in the bank's style.
NEW_KEYS = {
    "adst/12/economics": "ECONBUS12",
    "adst/12/computer-information-systems": "CISYS12",
    "mathematics/12/geometry": "GEOM12",
    "science/12/specialized-science": "SPSCI12",
    "social-studies/11/francophone-history": "FHC11",
    "additional-offerings/11/youth-work-in-trades": "YWT11",
    "additional-offerings/12/youth-work-in-trades": "YWT12",
    "additional-offerings/12A/work-experience": "WEX12A",
    "additional-offerings/12B/work-experience": "WEX12B",
}


# One page whose Ministry file holds several curricula for the grade, each
# under its own "Area of Learning: … — <title>" header: page -> [(title, key, name)].
SECTION_SPLITS = {
    "arts-education/9/core": [
        ("General", "ARTS9", "Arts Education 9"),
        ("Dance", "DANCE9", "Dance 9"),
        ("Drama", "DRAMA9", "Drama 9"),
        ("Music", "MUSIC9", "Music 9"),
        ("Visual Arts", "VISART9", "Visual Arts 9"),
    ],
}


# ---------------------------------------------------------------- helpers


def norm(s):
    """The only normalisation allowed: Unicode NFC and whitespace."""
    s = unicodedata.normalize("NFC", s)
    s = s.replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


_last_request = [0.0]


def http_get(url):
    """GET through curl (Python here has no CA bundle), with a polite delay
    between requests. Returns (status, bytes)."""
    wait = THROTTLE_SECONDS - (time.time() - _last_request[0])
    if wait > 0:
        time.sleep(wait)
    _last_request[0] = time.time()
    r = subprocess.run(
        ["curl", "-sL", "--max-time", "90", "-A", UA, "-w", "\n%{http_code}", url],
        capture_output=True,
    )
    if r.returncode != 0:
        return 0, b""
    body, _, code = r.stdout.rpartition(b"\n")
    return int(code or 0), body


def cache_path(kind, name):
    d = os.path.join(SOURCES, kind)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def page_slug(path):
    return path.strip("/").replace("/", "_")


def get_page(path, refresh=False):
    """Fetch /curriculum/<path> into the cache; return the HTML text."""
    fn = cache_path("pages", page_slug(path) + ".html")
    if refresh or not os.path.exists(fn):
        status, body = http_get(f"{BASE}/curriculum/{path}")
        if status != 200:
            raise RuntimeError(f"page {path}: HTTP {status}")
        with open(fn, "wb") as f:
            f.write(body)
    with open(fn, encoding="utf-8") as f:
        return f.read()


# --------------------------------------------------------------- discover

ROW_RE = re.compile(
    r'<div (?:lang="en" class="row"|class="row" lang="en")>\s*'
    r'<div class="course-title col-8">(?:<span class="field-content">)?'
    r'<a href=["\']([^"\']*)["\'][^>]*>([^<]*)</a>'
)
FILE_RE = re.compile(r'href=["\'](/sites/curriculum\.gov\.bc\.ca/+files/curriculum/[^"\']+)["\']')


def course_files(page_html):
    """English, no-elaboration DOCX and PDF links from a course page."""
    out = {"docx": None, "pdf": None}
    for href in FILE_RE.findall(page_html):
        href = re.sub(r"/+files/", "/files/", href)
        name = href.rsplit("/", 1)[-1]
        if not name.startswith("en_"):
            continue
        if "elab" in name:
            continue
        key = name.rsplit(".", 1)[-1]
        if key not in out:
            continue
        if out[key] is None:
            out[key] = BASE + href
    return out


def cmd_discover(args):
    refresh = "--refresh" in args
    courses = []
    for subj in CORE_SUBJECTS:
        for g in ("8", "9"):
            path = f"{subj}/{g}/core"
            courses.append(
                {"page": path, "title": f"{CORE_NAME[subj]} {g}", "grade": int(g), "area": subj, "group": None}
            )
    for subj in LISTING_SUBJECTS:
        for g in ("10", "11", "12"):
            h = get_page(f"{subj}/{g}/courses", refresh)
            group = None
            heads = [(m.start(), norm(html.unescape(m.group(1)))) for m in re.finditer(r'<h4 class="ccg[^"]*">([^<]*)</h4>', h)]
            for m in ROW_RE.finditer(h):
                for hp, hn in heads:
                    if hp < m.start():
                        group = hn
                href = m.group(1).strip()
                title = norm(html.unescape(m.group(2)))
                if not href.startswith("/curriculum/"):
                    continue
                path = href[len("/curriculum/") :]
                if any(c["page"] == path for c in courses):
                    continue
                courses.append({"page": path, "title": title, "grade": int(g), "area": subj, "group": group})
    for path, title, g in EXTRA_PAGES:
        grade = int(g) if g.isdigit() else int(g.split("-")[0])
        courses.append({"page": path, "title": title, "grade": grade, "area": path.split("/")[0], "group": None})
    for c in courses:
        h = get_page(c["page"], refresh)
        c["files"] = course_files(h)
        c["page_url"] = f"{BASE}/curriculum/{c['page']}"
        print(f"{c['page']:70s} docx={'y' if c['files']['docx'] else '-'} pdf={'y' if c['files']['pdf'] else '-'}")
    man = load_json(MANIFEST, {}) or {}
    man["discovered"] = date.today().isoformat()
    man["courses"] = courses
    write_json(MANIFEST, man)
    print(f"{len(courses)} courses")


# ------------------------------------------------------------------ fetch


def cmd_fetch(args):
    """Download each course's no-elaboration DOCX; on failure, its PDF."""
    man = load_json(MANIFEST)
    if not man:
        sys.exit("run discover first")
    fetched = man.setdefault("fetched", {})
    refresh = "--refresh" in args
    for c in man["courses"]:
        for kind in ("docx", "pdf"):
            url = c["files"].get(kind)
            if not url:
                continue
            name = url.rsplit("/", 1)[-1]
            fn = cache_path("files", name)
            if not refresh and fetched.get(url, {}).get("ok") and os.path.exists(fn):
                break
            status, body = http_get(url)
            ok = status == 200 and (body[:2] == b"PK" or body[:4] == b"%PDF")
            if ok:
                with open(fn, "wb") as f:
                    f.write(body)
            fetched[url] = {
                "status": status,
                "ok": ok,
                "file": name if ok else None,
                "fetched": date.today().isoformat(),
                "sha256": sha256_file(fn) if ok else None,
            }
            print(f"{status} {'ok ' if ok else 'BAD'} {name}")
            write_json(MANIFEST, man)
            if ok:
                break
    write_json(MANIFEST, man)


# ------------------------------------------------------------- DOCX read

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PR = "{http://schemas.openxmlformats.org/package/2006/relationships}"
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE_RE = re.compile(rf"\b(?:{MONTHS}) \d{{4}}\b")


def para_text(p):
    out = []
    for el in p.iter():
        if el.tag == W + "t":
            out.append(el.text or "")
        elif el.tag in (W + "tab", W + "br", W + "cr"):
            out.append(" ")
    return "".join(out)


def para_style(p):
    ppr = p.find(W + "pPr")
    style, ilvl = None, None
    if ppr is not None:
        st = ppr.find(W + "pStyle")
        if st is not None:
            style = st.get(W + "val")
        num = ppr.find(W + "numPr")
        if num is not None:
            lv = num.find(W + "ilvl")
            ilvl = int(lv.get(W + "val")) if lv is not None else 0
    return style, ilvl


def run_italic(r):
    rpr = r.find(W + "rPr")
    i = rpr.find(W + "i") if rpr is not None else None
    return i is not None and i.get(W + "val") not in ("0", "false")


def para(p):
    style, ilvl = para_style(p)
    runs = [r for r in p.iter(W + "r") if norm("".join(t.text or "" for t in r.iter(W + "t")))]
    italic = bool(runs) and all(run_italic(r) for r in runs)
    return {"style": style or "", "ilvl": ilvl, "italic": italic, "text": norm(para_text(p))}


def block_children(el):
    """Paragraphs and tables in reading order, looking through content controls."""
    for c in el:
        if c.tag in (W + "p", W + "tbl"):
            yield c
        elif c.tag == W + "sdt":
            content = c.find(W + "sdtContent")
            if content is not None:
                yield from block_children(content)


def cell_paras(tc):
    out = []
    for c in block_children(tc):
        if c.tag == W + "p":
            out.append(para(c))
        else:  # nested table: read its cells in order
            for tr in c.findall(W + "tr"):
                for inner in tr.findall(W + "tc"):
                    out.extend(cell_paras(inner))
    return out


def read_docx(path):
    """Return (blocks, footer_dates). A block is ("p", para) or ("tbl", rows),
    rows being lists of cells, cells being lists of paras."""
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body")
    blocks = []
    for c in block_children(body):
        if c.tag == W + "p":
            blocks.append(("p", para(c)))
        else:
            rows = [[cell_paras(tc) for tc in tr.findall(W + "tc")] for tr in c.findall(W + "tr")]
            blocks.append(("tbl", rows))
    # Footer dates from the footers the document's sections actually use.
    rels = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels.iter(PR + "Relationship")}
    used = []
    for ref in root.iter(W + "footerReference"):
        t = target.get(ref.get(R + "id"))
        if t and t not in used:
            used.append(t)
    dates = []
    for t in used:
        name = "word/" + t.lstrip("/").replace("word/", "")
        if name not in z.namelist():
            continue
        froot = ET.fromstring(z.read(name))
        for d in DATE_RE.findall(norm(" ".join(para_text(p) for p in froot.iter(W + "p")))):
            if d not in dates:
                dates.append(d)
    return blocks, dates


# ------------------------------------------------------------------ parse

STEM_RE = re.compile(
    r"^(Students are expected|Students will be able to"
    r"|Using oral, written, visual, and digital texts, students are expected)"
)
LIST_STYLE_RE = re.compile(r"^(ListParagraph|ListBullet|Bullet|Introbullet)", re.I)
# Sub-bullet styles: ListParagraphindent, ListparagraphidentLastsub-bullet.
# (ListParagraphwithsub-bullets is the parent line.)
SUB_STYLE_RE = re.compile(r"indent|ident|lastsub", re.I)
BIG_IDEAS_RE = re.compile(r"(?:^|:\s*)big ideas$", re.I)


def is_list(p):
    return bool(LIST_STYLE_RE.match(p["style"])) or p["ilvl"] is not None


def is_child(p):
    if p["ilvl"]:
        return True
    return bool(LIST_STYLE_RE.match(p["style"])) and bool(SUB_STYLE_RE.search(p["style"]))


def heading_level(p):
    """2 for a sub-heading (ADST's design phases): a Topicsub style, or a
    heading set wholly in italics, as some files format the phases."""
    if p["style"].lower().startswith("topicsub") or p.get("italic"):
        return 2
    return 1


def split_sections(blocks):
    """Split on the running header paragraph 'Area of Learning: … <grade>'.
    Build-your-own courses (Specialized Science 12, Explorations in Social
    Studies 11) also print worked 'Example N: …' pages; those are marked."""
    sections = []
    cur = None
    for kind, b in blocks:
        if kind == "p" and re.match(r"(Area of Learning:|Example \d+:)", b["text"]):
            example = b["text"].startswith("Example")
            head = re.sub(r"^(Area of Learning:|Example \d+:)\s*", "", b["text"])
            m = re.match(r"(.*?)\s+((?:Kindergarten|Grades?)\b[^:]*)$", head)
            title, label = (m.group(1), m.group(2)) if m else (head, "")
            if cur is None or cur["label"] != label or cur["title"] != title or cur["example"] != example:
                cur = {"title": title, "label": label, "example": example, "blocks": []}
                sections.append(cur)
            continue
        if cur is None:
            cur = {"title": "", "label": "", "example": False, "blocks": []}
            sections.append(cur)
        cur["blocks"].append((kind, b))
    return sections


class CourseParse:
    def __init__(self, key, known_headings=()):
        self.key = key
        self.known_headings = set(known_headings)
        self.flags = []
        self.skipped = []
        self.big_ideas = []
        self.categories = []
        self.content = []
        self.path = []
        self.headings = []
        self.last_item = None

    def flag(self, kind, detail, severity="review"):
        self.flags.append({"course": self.key, "severity": severity, "kind": kind, "detail": detail})

    # competencies -------------------------------------------------------
    def comp_para(self, p):
        t = p["text"]
        if not t:
            return
        if STEM_RE.match(t):
            self.skipped.append(t)
            return
        if is_list(p) and t in self.known_headings:
            # A heading mis-styled as a bullet: the same file prints this exact
            # line as a heading elsewhere.
            self.flag("bullet-styled line read as a heading (same file uses it as a heading)", t)
            p = dict(p, style="Topic", ilvl=None)
        if is_list(p):
            if is_child(p):
                if self.categories and self.categories[-1]["competencies"]:
                    self.categories[-1]["competencies"][-1]["children"].append(t)
                else:
                    self.flag("competency sub-bullet with no parent", t)
                return
            if not self.categories or self.categories[-1]["path"] != self.path:
                self.categories.append({"path": list(self.path), "competencies": []})
            self.categories[-1]["competencies"].append({"raw": t, "children": []})
            if t[:1].islower():
                self.flag("competency starts lower case (kept as printed)", t)
            return
        if t.endswith(":"):
            self.flag("unplaced line in competencies", t)
            return
        base = re.sub(r"\s*\(continued\)$", "", t)
        level = heading_level(p)
        if base != t and base in self.path:
            return
        if level == 2 and self.path:
            self.path = self.path[:1] + [t]
        else:
            self.path = [t]
        self.headings.append(list(self.path))
        if p["style"] == "" :
            self.flag("heading has no heading style", t, "info")

    # content ------------------------------------------------------------
    def content_para(self, p):
        t = p["text"]
        if not t:
            return
        if STEM_RE.match(t):
            self.skipped.append(t)
            return
        if is_list(p):
            if is_child(p):
                if self.last_item is None:
                    self.flag("content sub-bullet with no parent", t)
                    self._group().append({"raw": t, "children": []})
                else:
                    self.last_item["children"].append(t)
                return
            self.last_item = {"raw": t, "children": []}
            self._group().append(self.last_item)
            return
        if p["style"].lower() == "contentheader" or len(t) > 90:
            self.skipped.append(t)
            self.flag("note left out of Content", t, "info")
            return
        if self.content and self.content[-1]["name"] == re.sub(r"\s*\(continued\)$", "", t):
            return
        self.content.append({"name": t, "items": []})
        self.last_item = None
        if p["style"] == "":
            self.flag("content heading has no heading style", t, "info")

    def finish(self):
        """Flag headings that ended up with nothing under them."""
        filled = {tuple(c["path"]) for c in self.categories}
        for h in self.headings:
            if tuple(h) not in filled and not any(tuple(f[: len(h)]) == tuple(h) for f in filled):
                self.flag("competency heading with no competencies under it", " > ".join(h))
        for g in self.content:
            if not g["items"]:
                self.flag("content heading with no items under it", g["name"] or "", "info")

    def _group(self):
        if not self.content:
            self.content.append({"name": None, "items": []})
        return self.content[-1]["items"]


def header_cols(row):
    names = [" ".join(p["text"] for p in cell).strip() for cell in row]
    comp = next((i for i, n in enumerate(names) if n.startswith("Curricular Competencies")), None)
    cont = next((i for i, n in enumerate(names) if n.startswith("Content")), None)
    return comp, cont


def cell_text(cell):
    return norm(" ".join(p["text"] for p in cell))


def parse_grid_table(cp, rows):
    """One-table layout (Philosophy 12): a 'Big Ideas | Elaborations' header
    row, one Big Idea per row, then a 'Curricular Competencies | Elaborations |
    Content | Elaborations' header row. Elaboration columns are left out."""
    cp.flag("one-table layout with Elaborations columns (elaborations left out)", "", "info")
    mode, comp, cont = None, None, None
    for row in rows:
        first = cell_text(row[0]) if row else ""
        if first.startswith("Big Ideas"):
            mode = "big"
            continue
        names = [cell_text(c) for c in row]
        if any(n.startswith("Curricular Competencies") for n in names):
            mode = "std"
            comp, cont = header_cols(row)
            continue
        if mode == "big":
            if first:
                cp.big_ideas.append(first)
        elif mode == "std":
            for i, cell in enumerate(row):
                for p in cell:
                    if i == comp:
                        cp.comp_para(p)
                    elif i == cont:
                        cp.content_para(p)


def parse_section_blocks(cp, blocks):
    mode = None
    big_tables = 0
    for kind, b in blocks:
        if kind == "p":
            t = b["text"]
            if BIG_IDEAS_RE.search(t):
                mode, big_tables = "big", 0
            elif t.startswith("Learning Standards"):
                mode = "std"
            elif t and mode == "big" and big_tables:
                mode = None  # text after the Big Ideas tables ends them
            continue
        rows = b
        if mode == "big":
            for row in rows:
                for cell in row:
                    texts = [p["text"] for p in cell if p["text"]]
                    notes = [t for t in texts[1:] if t.startswith("(") and t.endswith(")")]
                    if notes:
                        cp.flag("note under a Big Idea left out", " | ".join(notes), "info")
                        texts = [t for t in texts if t not in notes]
                    if not texts:
                        continue
                    if len(texts) > 1:
                        cp.flag("big idea cell has several paragraphs (joined)", " | ".join(texts))
                    cp.big_ideas.append(" ".join(texts))
            big_tables += 1  # Big Ideas can run over several tables
        elif mode == "std":
            comp, cont = header_cols(rows[0]) if rows else (None, None)
            if comp is None and cont is None:
                cp.flag("learning standards table without headers", " / ".join(p["text"] for c in rows[0] for p in c)[:200])
                continue
            for row in rows[1:]:
                for i, cell in enumerate(row):
                    for p in cell:
                        if i == comp:
                            cp.comp_para(p)
                        elif i == cont:
                            cp.content_para(p)
                        elif p["text"]:
                            cp.flag("text outside the two columns", p["text"])
            mode = None
        elif any(row and cell_text(row[0]).startswith("Big Ideas") for row in rows):
            parse_grid_table(cp, rows)
        else:
            texts = [p["text"] for row in rows for cell in row for p in cell if p["text"]]
            if texts:
                cp.flag("table outside Big Ideas / Learning Standards", " | ".join(texts)[:200], "info")


def label_has_grade(label, grade):
    m = re.match(r"Grades? (\d+)(?:\s*[–-]\s*(?:Grade )?(\d+))?$", label)
    if not m:
        return False
    lo = int(m.group(1))
    hi = int(m.group(2) or lo)
    return lo <= grade <= hi


def pick_sections(sections, grade, multi_grade, title_part=None):
    sections = [s for s in sections if not s["example"]]
    if multi_grade:
        sections = [s for s in sections if label_has_grade(s["label"], grade)]
    if title_part:
        sections = [s for s in sections if s["title"].endswith("— " + title_part)]
    return sections


def competency_headings(sections):
    """Every line a file styles as a competency heading, across all its sections."""
    out = set()
    for s in sections:
        mode = None
        for kind, b in s["blocks"]:
            if kind == "p":
                mode = "std" if b["text"].startswith("Learning Standards") else None
                continue
            if mode != "std" or not b:
                continue
            comp, _ = header_cols(b[0])
            for row in b[1:]:
                if comp is not None and comp < len(row):
                    for p in row[comp]:
                        if p["text"] and not is_list(p) and not STEM_RE.match(p["text"]) and not p["text"].endswith(":"):
                            out.add(p["text"])
    return out


def parse_docx_course(key, path, grade, multi_grade, title_part=None):
    blocks, dates = read_docx(path)
    every = split_sections(blocks)
    sections = pick_sections(every, grade, multi_grade, title_part)
    cp = CourseParse(key, competency_headings(every))
    if not sections:
        cp.flag("no section for this grade", f"Grade {grade} {title_part or ''}".strip())
    if any(s["example"] for s in every):
        cp.flag("worked Example pages left out", str(sum(1 for s in every if s["example"])) + " page(s)", "info")
    labels = sorted({s["label"] for s in sections if s["label"]})
    if len(labels) > 1:
        cp.flag("several grade labels in one file", ", ".join(labels))
    if multi_grade and labels and labels != [f"Grade {grade}"]:
        cp.flag("the Ministry file prints one section for several grades", labels[0], "info")
    if multi_grade and not title_part:
        titles = sorted({s["title"] for s in sections})
        if len(titles) > 1:
            cp.flag("several titled sections for this grade", " / ".join(titles))
    for s in sections:
        parse_section_blocks(cp, s["blocks"])
    if len(dates) != 1:
        cp.flag("footer date not unique", ", ".join(dates) or "none")
    return cp, (dates[0] if dates else None), (sections[0]["title"] if sections else None)

# ------------------------------------------------------------- web pages


class _WebTree(HTMLParser):
    """Turn a course page into a flat event list, dropping elaboration popovers
    and French headings: ("h2", text) ("h4", text) ("row",) ("em", text)
    ("li", depth, text) ("text", text) ("endrow",)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.events = []
        self.stack = []  # (tag, skip?)
        self.buf = None
        self.ul_depth = 0
        self.in_row = False

    def _skipping(self):
        return any(sk for _, sk in self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        skip = "elaboration" in cls or a.get("lang") == "fr" or tag in ("script", "style")
        if tag in ("br", "img", "input", "meta", "link", "hr"):
            return
        self.stack.append((tag, skip))
        if self._skipping():
            return
        if tag in ("h2", "h4", "em", "li"):
            self._flush()
            self.buf = (tag, [])
        if tag == "ul":
            self._flush()
            self.ul_depth += 1
        if "views-row" in cls:
            self._flush()
            self.events.append(("row",))
            self.in_row = True

    def handle_endtag(self, tag):
        if not self.stack:
            return
        # Pop to the matching tag (pages are not always well nested).
        for n in range(len(self.stack) - 1, -1, -1):
            if self.stack[n][0] == tag:
                was_skipping = self._skipping()
                del self.stack[n:]
                break
        else:
            return
        if was_skipping and self._skipping():
            return
        if tag in ("h2", "h4", "em", "li"):
            self._flush()
        if tag == "ul":
            self._flush()
            self.ul_depth -= 1

    def handle_data(self, data):
        if self._skipping():
            return
        if self.buf is None:
            self.buf = ("text", [])
        self.buf[1].append(data)

    def _flush(self):
        if self.buf is None:
            return
        kind, parts = self.buf
        self.buf = None
        t = norm("".join(parts))
        if not t:
            return
        if kind == "li":
            self.events.append(("li", self.ul_depth, t))
        else:
            self.events.append((kind, t))


def web_events(path):
    with open(path, encoding="utf-8") as f:
        h = f.read()
    start = h.find('<div class="view-grouping col-12">')
    end = h.find("<footer")
    t = _WebTree()
    t.feed(h[start:end] if start >= 0 else h)
    t._flush()
    return t.events


def web_texts(path):
    return [e[-1] for e in web_events(path) if len(e) > 1 and isinstance(e[-1], str)]


def parse_web_course(key, path):
    cp = CourseParse(key)
    cp.flag("parsed from the web page (no working DOCX or PDF)", path.rsplit("/", 1)[-1], "info")
    section = None
    pending_li = None
    for e in web_events(path):
        kind = e[0]
        if kind == "h2":
            section = {"Big Ideas": "big", "Content": "content", "Curricular Competency": "comp"}.get(e[1])
            cp.path = []
            continue
        if section is None or kind in ("row", "endrow"):
            continue
        if kind == "text" and e[1] == "Learning Standards":
            continue
        if section == "big":
            if kind == "text":
                cp.big_ideas.append(e[1])
        elif section == "comp":
            if kind == "h4":
                cp.path = [e[1]]
            elif kind == "em":
                cp.path = cp.path[:1] + [e[1]] if cp.path else [e[1]]
            elif kind == "li":
                cp.comp_para({"style": "ListParagraph", "ilvl": None if e[1] <= 1 else 1, "text": e[2]})
            elif kind == "text":
                cp.comp_para({"style": "ListParagraph", "ilvl": None, "text": e[1]})
        elif section == "content":
            if kind in ("h4", "em"):
                cp.content_para({"style": "Topic", "ilvl": None, "text": e[1]})
            elif kind == "li":
                cp.content_para({"style": "ListParagraph", "ilvl": None if e[1] <= 1 else 1, "text": e[2]})
            elif kind == "text":
                cp.content_para({"style": "ListParagraph", "ilvl": None, "text": e[1]})
    return cp, None


# ------------------------------------------------------------------ build


def name_key(name):
    s = name.lower().replace("&", "and").replace("b.c.", "bc")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def expand_courses(courses):
    """Split pages listed in SECTION_SPLITS into one course per section."""
    out = []
    for c in courses:
        for title_part, key, name in SECTION_SPLITS.get(c["page"], [(None, None, None)]):
            if title_part is None:
                out.append(c)
            else:
                out.append(dict(c, title=name, section=title_part, split_key=key))
    return out


def course_id(c):
    return c["page"] + ("#" + c["section"] if c.get("section") else "")


def match_keys(courses, bank):
    """Official course -> bank key. Returns (key per page, unmatched bank keys)."""
    by_name = {}
    for k, v in bank.items():
        if k.startswith("_"):
            continue
        by_name.setdefault((name_key(v["course_name"]), v["grade"]), []).append(k)
    keys, how = {}, {}
    for c in courses:
        page = course_id(c)
        if c.get("split_key"):
            keys[page] = c["split_key"]
            how[page] = "new" if c["split_key"] not in bank else "split"
        elif page in KEY_OVERRIDES:
            keys[page], how[page] = KEY_OVERRIDES[page], "override"
        elif page in NEW_KEYS:
            keys[page], how[page] = NEW_KEYS[page], "new"
        else:
            hits = by_name.get((name_key(c["title"]), c["grade"]), [])
            if len(hits) == 1:
                keys[page], how[page] = hits[0], "name"
            else:
                raise SystemExit(f"no bank key for {page} ({c['title']}): {hits}")
    used = list(keys.values())
    dupes = {k for k in used if used.count(k) > 1}
    if dupes:
        raise SystemExit(f"key used twice: {sorted(dupes)}")
    clash = [k for p, k in keys.items() if how[p] == "new" and k in bank]
    if clash:
        raise SystemExit(f"proposed key already in the bank: {clash}")
    unmatched = [k for k in bank if not k.startswith("_") and k not in used]
    return keys, how, unmatched


def chosen_source(c, man):
    """The file a course is parsed from: DOCX, else PDF, else the web page."""
    fetched = man.get("fetched", {})
    tried = []
    for kind in ("docx", "pdf"):
        url = c["files"].get(kind)
        if not url:
            tried.append(f"{kind}: no link")
            continue
        rec = fetched.get(url)
        if rec and rec["ok"]:
            return kind, url, rec, tried
        tried.append(f"{kind}: HTTP {rec['status'] if rec else 'not fetched'} {url}")
    return "web", c["page_url"], None, tried


def multi_grade_file(url):
    return bool(re.search(r"_k-9[._]|_k-12[._]|_6-9[._]", url.rsplit("/", 1)[-1]))


def course_record(c, key, man):
    kind, url, rec, tried = chosen_source(c, man)
    grade = c["grade"]
    if kind == "docx":
        fn = cache_path("files", rec["file"])
        multi = multi_grade_file(url) and c["page"].endswith("/core")
        cp, doc_date, _ = parse_docx_course(key, fn, grade, multi, c.get("section"))
        sha, fetched = sha256_file(fn), rec["fetched"]
        source = {"page": c["page_url"], "url": url, "file": rec["file"], "format": "docx"}
    elif kind == "web":
        fn = cache_path("pages", page_slug(c["page"]) + ".html")
        cp, doc_date = parse_web_course(key, fn)
        sha, fetched = sha256_file(fn), man.get("discovered")
        source = {"page": c["page_url"], "url": url, "file": os.path.basename(fn), "format": "web"}
    else:
        cp = CourseParse(key)
        cp.flag("only a PDF is available; this script has no PDF reader", url)
        doc_date, sha, fetched = None, rec["sha256"], rec["fetched"]
        source = {"page": c["page_url"], "url": url, "file": rec["file"], "format": "pdf"}
    cp.finish()
    if c.get("section"):
        cp.flag("split from a file that holds several curricula for this grade", f"{c['page']} — {c['section']}")
    for t in tried:
        cp.flag("fell back past a broken link", t)
    source.update({"doc_date": doc_date, "fetched": fetched, "sha256": sha})
    if not cp.big_ideas:
        cp.flag("no Big Ideas found", "")
    if not any(cat["competencies"] for cat in cp.categories):
        cp.flag("no Curricular Competencies found", "")
    if not cp.content:
        cp.flag("no Content found", "")
    return cp, source


def assign_ids(key, cp):
    k = key.lower()
    cur = lambda i, raw: {"id": i, "raw": raw, "status": "current", "replaced_by": []}
    big = [cur(f"bc.{k}.bi.{n}", t) for n, t in enumerate(cp.big_ideas, 1)]
    cats, n = [], 0
    for cat in cp.categories:
        comps = []
        for c in cat["competencies"]:
            n += 1
            comp = cur(f"bc.{k}.cc.{n}", c["raw"])
            comp["children"] = [cur(f"bc.{k}.cc.{n}.{m}", ch) for m, ch in enumerate(c["children"], 1)]
            comps.append(comp)
        cats.append({"path": cat["path"], "competencies": comps})
    content, n = [], 0
    for g in cp.content:
        items = []
        for it in g["items"]:
            n += 1
            item = cur(f"bc.{k}.ct.{n}", it["raw"])
            item["children"] = [cur(f"bc.{k}.ct.{n}.{m}", ch) for m, ch in enumerate(it["children"], 1)]
            items.append(item)
        content.append({"name": g["name"], "items": items})
    return big, cats, content


def build_all():
    man = load_json(MANIFEST)
    if not man or "courses" not in man:
        sys.exit(f"no manifest at {MANIFEST}; run discover and fetch first")
    bank = load_json(BANK)
    all_courses = expand_courses(man["courses"])
    keys, how, unmatched = match_keys(all_courses, bank)
    out = {
        "_source": {
            "description": "BC Ministry curriculum text for grades 8-12, copied by scripts/bc_curriculum.py. "
            "Only Unicode NFC and whitespace are normalised. No codes, names or I Can statements.",
            "licence_note": "© Province of British Columbia. Reproduced from curriculum.gov.bc.ca; permission requested.",
            "excluded_areas": EXCLUDED_AREAS,
        }
    }
    flags = []
    order = sorted(all_courses, key=lambda c: (FAMILY[c["area"]], c["grade"], keys[course_id(c)]))
    for c in order:
        key = keys[course_id(c)]
        cp, source = course_record(c, key, man)
        big, cats, content = assign_ids(key, cp)
        out[key] = {
            "course_name": c["title"],
            "listing_group": c.get("group"),
            "grade": c["grade"],
            "subject": FAMILY[c["area"]],
            "source": source,
            "big_ideas": big,
            "categories": cats,
            "content": content,
        }
        flags.extend(cp.flags)
    courses = {
        "matched": sorted(
            [
                {"key": keys[course_id(c)], "official": c["title"], "bank": bank[keys[course_id(c)]]["course_name"], "page": course_id(c)}
                for c in all_courses
                if how[course_id(c)] != "new"
            ],
            key=lambda r: r["key"],
        ),
        "bank_only_to_drop": sorted(
            [{"key": k, "bank": bank[k]["course_name"], "grade": bank[k]["grade"]} for k in unmatched], key=lambda r: r["key"]
        ),
        "official_new": sorted(
            [
                {"key": keys[course_id(c)], "official": c["title"], "page": course_id(c)}
                for c in all_courses
                if how[course_id(c)] == "new"
            ],
            key=lambda r: r["key"],
        ),
    }
    return out, flags, courses


def cmd_build(args):
    out, flags, courses = build_all()
    write_json(OUT_SOURCE, out)
    write_json(OUT_FLAGS, flags)
    write_json(OUT_COURSES, courses)
    n = len(out) - 1
    print(f"{n} courses, {len(flags)} flags -> {os.path.relpath(OUT_SOURCE, REPO)}")


# ----------------------------------------------------------------- verify


def strings_of(rec):
    """(id, raw) for every stored string in a course record."""
    for b in rec["big_ideas"]:
        yield b["id"], b["raw"]
    for cat in rec["categories"]:
        for c in cat["competencies"]:
            yield c["id"], c["raw"]
            for ch in c["children"]:
                yield ch["id"], ch["raw"]
    for g in rec["content"]:
        for it in g["items"]:
            yield it["id"], it["raw"]
            for ch in it["children"]:
                yield ch["id"], ch["raw"]


def source_texts(rec):
    """Every paragraph and table-cell text in the recorded source file, normalised.
    Independent of the parser: a stored string must equal one of these exactly."""
    fmt, fn = rec["source"]["format"], rec["source"]["file"]
    if fmt == "docx":
        blocks, _ = read_docx(cache_path("files", fn))
        texts = set()
        for kind, b in blocks:
            if kind == "p":
                texts.add(b["text"])
            else:
                for row in b:
                    for cell in row:
                        texts.update(p["text"] for p in cell)
                        texts.add(norm(" ".join(p["text"] for p in cell)))
        return texts
    if fmt == "web":
        return set(web_texts(cache_path("pages", fn)))
    return set()


def cmd_verify(args):
    stored = load_json(OUT_SOURCE)
    problems = []
    man = load_json(MANIFEST)
    if not man:
        sys.exit(f"no raw sources at {SOURCES}; nothing to verify against")
    for key, rec in stored.items():
        if key.startswith("_"):
            continue
        src = rec["source"]
        dirn = "pages" if src["format"] == "web" else "files"
        fn = cache_path(dirn, src["file"])
        if not os.path.exists(fn):
            problems.append(f"{key}: source file missing: {src['file']}")
            continue
        if sha256_file(fn) != src["sha256"]:
            problems.append(f"{key}: SHA-256 differs from the recorded one: {src['file']}")
            continue
        texts = source_texts(rec)
        for sid, raw in strings_of(rec):
            if raw != norm(raw):
                problems.append(f"{sid}: not normalised")
            if texts and raw not in texts:
                problems.append(f"{sid}: not found word for word in {src['file']}: {raw[:80]}")
    # Re-run the whole extraction and compare every string and id.
    rebuilt, _, _ = build_all()
    for key, rec in stored.items():
        if key.startswith("_"):
            continue
        if key not in rebuilt:
            problems.append(f"{key}: not produced by a fresh extraction")
            continue
        a, b = dict(strings_of(rec)), dict(strings_of(rebuilt[key]))
        if a != b:
            for sid in sorted(set(a) | set(b)):
                if a.get(sid) != b.get(sid):
                    problems.append(f"{sid}: stored {a.get(sid)!r} but source gives {b.get(sid)!r}"[:240])
        if [c["path"] for c in rec["categories"]] != [c["path"] for c in rebuilt[key]["categories"]]:
            problems.append(f"{key}: organizer paths differ from a fresh extraction")
        if [g["name"] for g in rec["content"]] != [g["name"] for g in rebuilt[key]["content"]]:
            problems.append(f"{key}: content headings differ from a fresh extraction")
    for k in rebuilt:
        if k not in stored:
            problems.append(f"{k}: in a fresh extraction but not stored")
    for p in problems:
        print(p)
    print(f"verify: {len(problems)} problem(s) in {len(stored) - 1} courses")
    sys.exit(1 if problems else 0)


COMMANDS = {"discover": cmd_discover, "fetch": cmd_fetch, "build": cmd_build, "verify": cmd_verify}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
