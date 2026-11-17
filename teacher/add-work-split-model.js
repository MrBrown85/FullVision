// @ts-check
/* ── add-work-split-model.js — Split the Scan's model (B2), no DOM ───────
   The parts of Split the Scan (teacher/add-work-split.js) that hold no HTML
   and touch no page: the scan's pages, which are blank, which are kept,
   where the pieces are cut, and the names on them; and the name box's
   matching. Kept apart from the screen so it is tested on its own
   (tests/add-work-split.test.js).

   AddWorkSplitModel.model(pages, students)   the model (see below).
   AddWorkSplitModel.matches(list, text, used) the name box's students.
   AddWorkSplitModel.startPer(kept, students)  Pages per Student to start.
   AddWorkSplitModel.isBlank(sharpness)        under BLANK_BELOW.
   AddWorkSplitModel.pagesText(spans, cap)     "Pages 3–5" or "pages 7–8, 21". */
/** @type {any} */ (window).AddWorkSplitModel = (function () {
  'use strict';

  var MAX_SCAN_PAGES = 150; // DECISIONS, "Add Work for the Class" 7
  var MAX_PIECE_PAGES = 30; // STUDENT_WORK_MAX_PAGES
  // A page is blank when PhotoShrink.sharpness, measured on the page's
  // thumbnail (400 px, JPEG: the JPEG takes the scanner's noise out), is
  // under this. Made-up scans (Nov 17): blank paper with scanner noise, a
  // grey cast or a dark scan edge measured 0.4 to 2.3; one faint pencil line
  // (grey 200 on paper at 245) 2.9 to 5.3; a worksheet about 4,500. Real
  // copier scans, read for these numbers only: near-blank pages 0 to 2.4,
  // pages of work in the thousands. A faint mark can still be left out; it
  // stays on screen, dimmed, one click from kept.
  var BLANK_BELOW = 2.6;

  function _maxPiece() {
    return typeof STUDENT_WORK_MAX_PAGES === 'number' ? STUDENT_WORK_MAX_PAGES : MAX_PIECE_PAGES;
  }

  /* ── Names ──────────────────────────────────────────────────── */

  // Capitals, accents and extra spaces ignored: "  Zoë " → "zoe".
  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _first(st) {
    return String((st && (st.preferred || st.firstName || st.lastName)) || '');
  }
  function _full(st) {
    return ((st && (st.preferred || st.firstName || '')) + ' ' + ((st && st.lastName) || '')).trim();
  }

  /* The students whose first name, last name or full name starts with
     `text`, best first: those on no other piece before those already named
     (`used`: sid → true), then full-name starts, then first names, then last
     names, then the class list's order. [] for empty text. */
  function matches(list, text, used) {
    var t = fold(text);
    if (!t) return [];
    used = used || {};
    var out = [];
    (list || []).forEach(function (st, i) {
      var names = [_full(st), _first(st), st.firstName, st.lastName]
        .concat(String(st.lastName || '').split(/[\s-]+/))
        .map(fold);
      var how = -1;
      if (names[0].indexOf(t) === 0) how = 0;
      else if (names[1].indexOf(t) === 0 || names[2].indexOf(t) === 0) how = 1;
      else if (
        names.slice(3).some(function (n) {
          return n && n.indexOf(t) === 0;
        })
      )
        how = 2;
      if (how >= 0) out.push({ st: st, how: how, i: i, used: Object.prototype.hasOwnProperty.call(used, st.id) });
    });
    out.sort(function (a, b) {
      return +a.used - +b.used || a.how - b.how || a.i - b.i;
    });
    return out.map(function (m) {
      return m.st;
    });
  }

  /* Pages per Student to start with: the kept pages over the students
     listed, when that is a whole number from 1 to 30; otherwise 1. */
  function startPer(kept, students) {
    if (!students || kept % students) return 1;
    var n = kept / students;
    return n >= 1 && n <= _maxPiece() ? n : 1;
  }

  function isBlank(sharpness) {
    return typeof sharpness === 'number' && sharpness < BLANK_BELOW;
  }

  /* ── The model ──────────────────────────────────────────────────
     model(pages, students): pages in scan order, each { page, blank } where
     page is PhotoShrink's page object; students in class-list order.

     A page: { no (its number in the scan, 1-based), page, blank, kept
     (a blank page the teacher kept), cut (a piece starts here) }. A piece
     is the run of pages from one cut to the next; its pages are the ones
     not left out. Pages left out stay in place, so a page kept again goes
     back into the piece it sits in.

     A name belongs to the page it was read from: it is kept against the
     piece's first page (`pins`, page no → sid, '' for "no one"), so a
     piece that still starts on that page keeps it and one that now starts
     elsewhere has none. In Class List Order a piece with no typed name
     gets the listed student in its place, but only while there is one
     piece for each student listed: a pile one paper short would otherwise
     give every piece after the gap to the next student down. */
  function model(given, students) {
    var pages = (given || []).map(function (g, i) {
      return { no: i + 1, page: g.page, blank: !!g.blank, kept: false, cut: false };
    });
    var list = (students || []).slice();
    var st = { per: 1, leaveOut: true, order: 'typed', pins: {} };

    function out(p) {
      return st.leaveOut && p.blank && !p.kept;
    }

    // Runs of pages from one cut to the next: [{ from, to, kept: [index] }].
    function _runs() {
      var runs = [];
      pages.forEach(function (p, i) {
        if (i === 0 || p.cut) runs.push({ from: i, to: i, kept: [] });
        var r = runs[runs.length - 1];
        r.to = i + 1;
        if (!out(p)) r.kept.push(i);
      });
      return runs;
    }

    // Every piece has a page and at most 30: a run with none joins the one
    // before it (the first, the one after); a run over 30 is cut at 30.
    function _tidy() {
      if (pages.length) pages[0].cut = false;
      for (var guard = 0; guard < pages.length + 2; guard++) {
        var runs = _runs();
        var empty = runs.findIndex(function (r) {
          return !r.kept.length;
        });
        if (empty < 0 || runs.length < 2) break;
        if (empty > 0) pages[runs[empty].from].cut = false;
        else pages[runs[1].from].cut = false;
      }
      var max = _maxPiece();
      _runs().forEach(function (r) {
        for (var j = max; j < r.kept.length; j += max) pages[r.kept[j]].cut = true;
      });
    }

    function _keptAll() {
      var k = [];
      pages.forEach(function (p, i) {
        if (!out(p)) k.push(i);
      });
      return k;
    }

    // From kept page `at` (a place in the kept pages) on, a new piece every
    // Pages per Student; every cut after page index `after` is cleared first.
    function _recut(after, at) {
      pages.forEach(function (p, i) {
        if (i > after) p.cut = false;
      });
      var k = _keptAll();
      for (var j = at; j < k.length; j += st.per) if (k[j] > after) pages[k[j]].cut = true;
      _tidy();
    }

    // How many pieces there are now.
    function _count() {
      return _keptAll().length ? _runs().length : 0;
    }

    // Class List Order names pieces only when there is one for each student.
    function listFits() {
      return _count() === list.length;
    }

    function pieces() {
      if (!_keptAll().length) return [];
      var runs = _runs();
      var byList = st.order === 'list' && runs.length === list.length;
      return runs.map(function (r, at) {
        var first = pages[r.kept[0]];
        var pin = Object.prototype.hasOwnProperty.call(st.pins, first.no) ? st.pins[first.no] : undefined;
        var sid = pin !== undefined ? pin : byList ? list[at].id : '';
        return {
          at: at,
          from: r.from,
          to: r.to,
          first: first.no,
          last: pages[r.kept[r.kept.length - 1]].no,
          nos: r.kept.map(function (i) {
            return pages[i].no;
          }),
          all: pages.slice(r.from, r.to).map(function (p) {
            return p.no;
          }),
          sid: sid || '',
          typed: pin !== undefined,
          spans: _spans(r),
        };
      });
    }

    /* A piece's kept pages as runs that sit together in the scan: [[3, 5]]
       for pages 3 to 5 (a blank page 4 left out between them), [[7, 8],
       [21, 21]] once page 21 was moved onto it. */
    function _spans(r) {
      var spans = [];
      var prev = null;
      for (var i = r.from; i < r.to; i++) {
        var p = pages[i];
        if (!prev || p.no !== prev.no + 1) spans.push({ a: 0, b: 0 });
        prev = p;
        if (out(p)) continue;
        var sp = spans[spans.length - 1];
        if (!sp.a) sp.a = p.no;
        sp.b = p.no;
      }
      return spans
        .filter(function (sp) {
          return sp.a;
        })
        .map(function (sp) {
          return [sp.a, sp.b];
        });
    }

    function _index(no) {
      for (var i = 0; i < pages.length; i++) if (pages[i].no === no) return i;
      return -1;
    }

    function setPer(n) {
      n = Math.max(1, Math.min(_maxPiece(), Math.round(Number(n) || 1)));
      st.per = n;
      _recut(-1, n);
      return n;
    }

    // Piece `at` takes the next piece's first page; every piece after is cut again.
    function more(at) {
      var ps = pieces();
      var p = ps[at];
      if (!p || at >= ps.length - 1 || p.nos.length >= _maxPiece()) return false;
      var k = _keptAll();
      _recut(p.from, k.indexOf(_index(ps[at + 1].nos[0])) + 1);
      return true;
    }

    // Piece `at` gives its last page to the next piece; every piece after is cut again.
    function fewer(at) {
      var p = pieces()[at];
      if (!p || p.nos.length < 2) return false;
      var k = _keptAll();
      _recut(p.from, k.indexOf(_index(p.nos[p.nos.length - 1])));
      return true;
    }

    /* Page `no` moved onto piece `toAt`, to be its page `pos` + 1 (`pos`
       from 1, after the piece's first page, to its count, the end; the end
       when left out), for a pile that came out of order. → { ok, reason,
       gone, unnamed }.

       What it does to names (review rule 5: a name belongs to the page it
       was read from):
       - The piece it lands on keeps its first page, so it keeps its name.
         A moved page is never a piece's first page.
       - A name read from the moved page goes nowhere with it.
       - The piece it left keeps its name while it starts on the same page.
         When the moved page was its first, it now starts on another page
         and has no name (`unnamed`: the sid it had), even in Class List
         Order, until the teacher names it.
       - A piece left with no pages goes away, and its name with it
         (`gone`: { at, sid }).
       A piece holds 30 pages at most: a full piece takes none
       ('too_many_pages'). Only a page in a piece moves (not one left out). */
    function move(no, toAt, pos) {
      var ps = pieces();
      var src = ps.find(function (p) {
        return p.nos.indexOf(no) >= 0;
      });
      var dst = ps[toAt];
      if (!src || !dst) return { ok: false, reason: 'not_found' };
      if (src.at === dst.at) return { ok: false, reason: 'same' };
      if (dst.nos.length >= _maxPiece()) return { ok: false, reason: 'too_many_pages' };
      var n = dst.nos.length;
      pos = pos === undefined || pos === null ? NaN : Math.round(Number(pos));
      pos = isFinite(pos) ? Math.max(1, Math.min(n, pos)) : n;
      var wasFirst = src.nos[0] === no;
      var gone = src.nos.length === 1;
      var i = _index(no);
      var p = pages[i];
      delete st.pins[no];
      pages.splice(i, 1);
      // The piece it left still starts where it did (a cut moves to its next page).
      if (p.cut && i < src.to - 1) pages[i].cut = true;
      if (wasFirst && !gone) st.pins[src.nos[1]] = '';
      p.cut = false;
      var at = pos < n ? _index(dst.nos[pos]) : _index(dst.nos[n - 1]) + 1;
      pages.splice(at, 0, p);
      _tidy();
      return {
        ok: true,
        reason: '',
        gone: gone ? { at: src.at, sid: src.sid } : null,
        unnamed: wasFirst && !gone ? src.sid : '',
      };
    }

    // A blank page kept, or left out again. Only a blank page is ever left out.
    function keep(no, on) {
      var i = _index(no);
      if (i < 0 || !pages[i].blank) return false;
      pages[i].kept = !!on;
      _tidy();
      return true;
    }

    function setLeaveOut(on) {
      st.leaveOut = !!on;
      _tidy();
    }

    function setOrder(order) {
      st.order = order === 'list' ? 'list' : 'typed';
    }

    // The name on piece `at`, kept against its first page. '' is no one.
    function name(at, sid) {
      var p = pieces()[at];
      if (!p) return false;
      sid = String(sid || '');
      if (!sid && st.order !== 'list') delete st.pins[p.first];
      else st.pins[p.first] = sid;
      return true;
    }

    function page(no) {
      var i = _index(no);
      return i < 0 ? null : pages[i];
    }

    // A turned page put back in the same place.
    function setPage(no, obj) {
      var p = page(no);
      if (!p || !obj) return false;
      p.page = obj;
      return true;
    }

    // Students on more than one piece: sid → [piece at, …].
    function twice() {
      var on = {};
      pieces().forEach(function (p) {
        if (p.sid) (on[p.sid] = on[p.sid] || []).push(p.at);
      });
      var out2 = {};
      Object.keys(on).forEach(function (sid) {
        if (on[sid].length > 1) out2[sid] = on[sid];
      });
      return out2;
    }

    function counts() {
      var ps = pieces();
      var named = ps.filter(function (p) {
        return p.sid;
      }).length;
      var left = pages.filter(out).length;
      return {
        pages: pages.length,
        blank: pages.filter(function (p) {
          return p.blank;
        }).length,
        left: left,
        kept: pages.length - left,
        pieces: ps.length,
        named: named,
        unnamed: ps.length - named,
        twice: Object.keys(twice()).length,
      };
    }

    function canMatch() {
      var c = counts();
      return c.named > 0 && !c.twice;
    }

    /* The named pieces leave: → [{ sid, from, pages }], each piece's pages
       in order, renamed by their place in the piece, with no file name. The
       pages between those pieces (blank backs left out) go with them. */
    function take() {
      if (!canMatch()) return [];
      var ps = pieces();
      var gone = {};
      var handed = [];
      ps.forEach(function (p) {
        if (!p.sid) return;
        handed.push({
          sid: p.sid,
          from: 'Scan, ' + pagesText(p.spans, false),
          pages: p.nos.map(function (no, i) {
            var copy = Object.assign({}, page(no).page);
            copy.name = 'page-' + (i + 1) + '.jpg';
            copy.page = i + 1;
            copy.pages = p.nos.length;
            return copy;
          }),
        });
        p.all.forEach(function (no) {
          gone[no] = true;
        });
        delete st.pins[p.first];
      });
      pages = pages.filter(function (p) {
        return !gone[p.no];
      });
      // In Class List Order every listed student has just gone: the pieces
      // left must not take the list's names from the top again.
      st.order = 'typed';
      _tidy();
      return handed;
    }

    // "56 pages make 28 pieces of 2."
    function line() {
      var ps = pieces();
      var c = counts();
      if (!ps.length) return c.pages ? 'Every page is left out.' : '';
      var sizes = {};
      ps.forEach(function (p) {
        sizes[p.nos.length] = (sizes[p.nos.length] || 0) + 1;
      });
      var keys = Object.keys(sizes)
        .map(Number)
        .sort(function (a, b) {
          return sizes[b] - sizes[a] || a - b;
        });
      var pageWord = c.kept === 1 ? ' page makes ' : ' pages make ';
      var pieceWord = function (n) {
        return n === 1 ? ' piece' : ' pieces';
      };
      if (keys.length === 1) return c.kept + pageWord + ps.length + pieceWord(ps.length) + ' of ' + keys[0] + '.';
      var parts = keys.map(function (k) {
        return sizes[k] + ' of ' + k;
      });
      var last = parts.pop();
      return (
        c.kept +
        pageWord +
        ps.length +
        pieceWord(ps.length) +
        ': ' +
        (parts.length ? parts.join(', ') + ' and ' : '') +
        last +
        '.'
      );
    }

    return {
      pages: function () {
        return pages.slice();
      },
      page: page,
      out: out,
      pieces: pieces,
      per: function () {
        return st.per;
      },
      leaveOut: function () {
        return st.leaveOut;
      },
      order: function () {
        return st.order;
      },
      listFits: listFits,
      students: function () {
        return list.length;
      },
      setPer: setPer,
      more: more,
      fewer: fewer,
      move: move,
      keep: keep,
      setLeaveOut: setLeaveOut,
      setOrder: setOrder,
      name: name,
      setPage: setPage,
      twice: twice,
      counts: counts,
      canMatch: canMatch,
      take: take,
      line: line,
    };
  }

  /* "Pages 3–5", "Page 12", "Pages 7–8, 21" from a piece's spans; small
     letters when `cap` is false. */
  function pagesText(spans, cap) {
    var list = spans || [];
    var one = list.length === 1 && list[0][0] === list[0][1];
    var word = (cap === false ? 'p' : 'P') + (one ? 'age ' : 'ages ');
    return (
      word +
      list
        .map(function (sp) {
          return sp[0] === sp[1] ? String(sp[0]) : sp[0] + '–' + sp[1];
        })
        .join(', ')
    );
  }

  return {
    model: model,
    pagesText: pagesText,
    matches: matches,
    fold: fold,
    first: _first,
    full: _full,
    startPer: startPer,
    isBlank: isBlank,
    maxPiece: _maxPiece,
    BLANK_BELOW: BLANK_BELOW,
    MAX_SCAN_PAGES: MAX_SCAN_PAGES,
  };
})();
