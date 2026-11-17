// @ts-check
/* ── assign-show.js — the Assignments page's Show bar ─────────────────
   All | Submitted 14 | To Grade 9 on the toolbar, in a class whose student
   page and Send Work are on. Every number is GraderWork's.

   Submitted (Colin, Nov 16): only the assessments with work in, each open,
   each showing only the students whose work is in (GraderWork.workInIds).
   One click turns it on; a second click, All or To Grade turns it off and
   puts the page back as Submitted found it: the same cards and folders
   open, the same scroll. Work that comes in while it is on opens its card.
   To Grade (S6-F4): only the assessments with work waiting to grade; the
   page keeps that switch (_toGradeOnly) and hands it in.

   PageAssignments binds its view (which cards and folders are open) once,
   calls listed() and students() as it draws, and choose() and afterDraw()
   around a click on the bar. */
/** @type {any} */ (window).AssignShow = (function () {
  'use strict';

  // The other modules this reads, loaded before it in app.html.
  var G = /** @type {any} */ (window);

  /** @typedef {{ open: Set<string>, allExpanded: boolean, collapsed: Set<string>, closed: Record<string, boolean> }} View */
  /** @type {{ get(): View, set(v: View): void } | null} */
  var _page = null;
  var _on = false;
  // Students with work in, summed over the assessments listed at the last draw.
  var _total = 0;
  /** @type {(View & { scroll: number }) | null} */
  var _before = null;
  // The cards Submitted has opened: one the teacher closes stays closed.
  /** @type {Record<string, boolean>} */
  var _opened = {};
  /** @type {number | null} */
  var _scrollTo = null;

  /** @param {{ get(): View, set(v: View): void }} page */
  function bind(page) {
    _page = page;
  }

  // A fresh page or another class: Submitted is off.
  function reset() {
    _on = false;
    _before = null;
    _opened = {};
    _scrollTo = null;
  }

  function on() {
    return _on;
  }

  // The page scrolls in #main when it is a scroller, else the document.
  function _scroller() {
    var main = document.getElementById('main');
    if (main && /auto|scroll/.test(getComputedStyle(main).overflowY)) return main;
    return document.scrollingElement;
  }

  function _enter() {
    if (!_page) return;
    var v = _page.get();
    var sc = _scroller();
    _before = {
      open: new Set(v.open),
      allExpanded: v.allExpanded,
      collapsed: new Set(v.collapsed),
      closed: Object.assign({}, v.closed),
      scroll: sc ? sc.scrollTop : 0,
    };
    _on = true;
    _opened = {};
    _page.set({ open: new Set(), allExpanded: true, collapsed: new Set(), closed: {} });
    _scrollTo = 0;
  }

  /** @param {boolean} scroll whether to put the scroll back too */
  function _leave(scroll) {
    var was = _before;
    reset();
    if (!was || !_page) return;
    _page.set({ open: was.open, allExpanded: was.allExpanded, collapsed: was.collapsed, closed: was.closed });
    if (scroll) _scrollTo = was.scroll;
  }

  /* A click on the bar: 'all', 'submitted' or 'tograde'. A pressed button
     clicked again lets go, to All. Returns what is pressed now. */
  /** @param {string} show @param {boolean} toGradeOnly */
  function choose(show, toGradeOnly) {
    if ((show === 'submitted' && _on) || (show === 'tograde' && toGradeOnly)) show = 'all';
    if (show === 'submitted') {
      if (!_on) _enter();
    } else if (_on) _leave(true);
    return show;
  }

  // After the page is drawn again: the top of the list, or the scroll Submitted found.
  function afterDraw() {
    if (_scrollTo == null) return;
    var sc = _scroller();
    if (sc) sc.scrollTop = _scrollTo;
    _scrollTo = null;
  }

  /* As the page draws: each listed assessment's students with work in
     (nums[aid].submitted) and the bar's total; with Submitted on, only the
     assessments with any, each opened once. A class whose work is off has
     no bar, so Submitted goes off with it. */
  /**
   * @param {string} cid @param {{ id: string }[]} assessments
   * @param {Record<string, any>} nums @param {string[]} shownIds
   */
  function listed(cid, assessments, nums, shownIds) {
    _total = 0;
    if (!G.GraderWork.workOnInClass(cid)) {
      if (_on) _leave(false);
      return assessments;
    }
    assessments.forEach(function (a) {
      nums[a.id].submitted = G.GraderWork.workInIds(cid, a.id, shownIds);
      _total += nums[a.id].submitted.length;
    });
    if (!_on) return assessments;
    var kept = assessments.filter(function (a) {
      return nums[a.id].submitted.length > 0;
    });
    var open = _page ? _page.get().open : null;
    kept.forEach(function (a) {
      if (_opened[a.id] || !open) return;
      _opened[a.id] = true;
      open.add(a.id);
    });
    return kept;
  }

  // An open card's students: with Submitted on, only those with work in.
  /** @param {string} cid @param {{ id: string }} a @param {{ id: string }[]} students */
  function students(cid, a, students) {
    if (!_on) return students;
    var ids = G.GraderWork.workInIds(
      cid,
      a.id,
      students.map(function (st) {
        return st.id;
      }),
    );
    return students.filter(function (st) {
      return ids.indexOf(st.id) >= 0;
    });
  }

  /* The bar. Moved here from page-assignments.js (_toGradeSegHtml). */
  // html-safe: fixed words and numbers
  /** @param {string} cid @param {boolean} toGradeOnly @param {number} toGradeTotal */
  function barHtml(cid, toGradeOnly, toGradeTotal) {
    if (!G.GraderWork.workOnInClass(cid)) return '';
    /** @param {string} show @param {boolean} pressed @param {string} label @param {number | null} n @param {string} tip */
    function btn(show, pressed, label, n, tip) {
      return (
        '<button type="button" class="seg-btn"' +
        G.segAttr(pressed) +
        ' data-action="setToGradeShow" data-show="' +
        show +
        '"' +
        (tip ? ' title="' + tip + '"' : '') +
        '>' +
        label +
        (n == null ? '' : ' <span class="assess-' + show + '-n">' + n + '</span>') +
        '</button>'
      );
    }
    return (
      '<div class="seg seg-sm assess-tograde-seg" role="group" aria-label="Show">' +
      btn('all', !_on && !toGradeOnly, 'All', null, '') +
      btn(
        'submitted',
        _on,
        'Submitted',
        _total,
        _on
          ? 'Showing only the work sent in. Click again to show everything.'
          : 'Show only the assessments with work sent in, and only the students who sent it.',
      ) +
      btn('tograde', toGradeOnly, 'To Grade', toGradeTotal, '') +
      '</div>'
    );
  }

  // A card's "6 to grade". Moved here from page-assignments.js.
  // `tograde`, when given, is the card's To Grade count as render() worked it out.
  // html-safe: a number and fixed words
  /** @param {string} cid @param {{ id: string }} a @param {string[]} shownIds @param {number | undefined} tograde */
  function toGradeChipHtml(cid, a, shownIds, tograde) {
    if (!G.GraderWork.workOn(cid, a)) return '';
    var n = tograde != null ? tograde : G.GraderWork.workCounts(cid, a.id, shownIds).tograde;
    return n ? '<span class="assess-to-grade">' + n + ' to grade</span>' : '';
  }

  return {
    toGradeChipHtml: toGradeChipHtml,
    bind: bind,
    reset: reset,
    on: on,
    choose: choose,
    afterDraw: afterDraw,
    listed: listed,
    students: students,
    barHtml: barHtml,
  };
})();
