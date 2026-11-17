// @ts-check
/* ── assign-show.js — the Assignments page's Show bar ─────────────────
   All | Submitted 17 | To Grade 6 | Not In 21 on the toolbar, in a class
   whose student page and Send Work are on. Every number is GraderWork's.

   Each of the three lists only the assessments it counts, each open, each
   showing only the students it counts (Colin, Nov 16):
   - Submitted: work is in, graded or not (GraderWork.workInIds);
   - To Grade: work is in and grading has not started (S6-F4);
   - Not In: the piece takes work and nothing is in; Excused is left out.
   One click turns one on; a second click, or All, puts the page back as
   the bar found it: the same cards and folders open, the same scroll.
   Going from one to another keeps that view to come back to.

   While one is on, what it listed stays listed until it is let go: grading
   a student does not pull their row, or the card, out from under the
   pointer. The counts on the bar move as they change. Work that comes in
   opens its card.

   PageAssignments binds its view (which cards and folders are open) once,
   calls listed() and students() as it draws, and choose() and afterDraw()
   around a click on the bar. */
/** @type {any} */ (window).AssignShow = (function () {
  'use strict';

  // The other modules this reads, loaded before it in app.html.
  var G = /** @type {any} */ (window);

  var MODES = ['submitted', 'tograde', 'notin'];
  /** @typedef {{ open: Set<string>, allExpanded: boolean, collapsed: Set<string>, closed: Record<string, boolean> }} View */
  /** @type {{ get(): View, set(v: View): void } | null} */
  var _page = null;
  // 'all' or one of MODES.
  var _mode = 'all';
  // Over the assessments listed at the last draw: students for Submitted and
  // Not In, pieces of work for To Grade (a group counts once).
  var _totals = { submitted: 0, tograde: 0, notin: 0 };
  /** @type {(View & { scroll: number }) | null} */
  var _before = null;
  // The cards this mode has opened: one the teacher closes stays closed.
  /** @type {Record<string, boolean>} */
  var _opened = {};
  // What this mode has listed: { aid: { sid: true } }.
  /** @type {Record<string, Record<string, boolean>>} */
  var _kept = {};
  /** @type {number | null} */
  var _scrollTo = null;

  /** @param {{ get(): View, set(v: View): void }} page */
  function bind(page) {
    _page = page;
  }

  /* A fresh page or another class: All, or the mode `show` names (the
     dashboard's To Grade cell opens the page with ?show=tograde). */
  /** @param {string} [show] */
  function reset(show) {
    _mode = 'all';
    _before = null;
    _opened = {};
    _kept = {};
    _scrollTo = null;
    if (show && MODES.indexOf(show) >= 0) {
      _enter(show);
      _scrollTo = null;
    }
  }

  function on() {
    return _mode !== 'all';
  }
  function mode() {
    return _mode;
  }

  // The page scrolls in #main when it is a scroller, else the document.
  function _scroller() {
    var main = document.getElementById('main');
    if (main && /auto|scroll/.test(getComputedStyle(main).overflowY)) return main;
    return document.scrollingElement;
  }

  /** @param {string} next */
  function _enter(next) {
    if (!_page) return;
    if (_mode === 'all') {
      var v = _page.get();
      var sc = _scroller();
      _before = {
        open: new Set(v.open),
        allExpanded: v.allExpanded,
        collapsed: new Set(v.collapsed),
        closed: Object.assign({}, v.closed),
        scroll: sc ? sc.scrollTop : 0,
      };
    }
    _mode = next;
    _opened = {};
    _kept = {};
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

  /* A click on the bar: 'all' or one of MODES. The pressed button clicked
     again lets go, to All. Returns what is pressed now. */
  /** @param {string} show */
  function choose(show) {
    if (show === _mode || MODES.indexOf(show) < 0) show = 'all';
    if (show === 'all') {
      if (_mode !== 'all') _leave(true);
    } else _enter(show);
    return show;
  }

  // After the page is drawn again: the top of the list, or the scroll the bar found.
  function afterDraw() {
    if (_scrollTo == null) return;
    var sc = _scroller();
    if (sc) sc.scrollTop = _scrollTo;
    _scrollTo = null;
  }

  /* As the page draws: each listed assessment's counts (nums[aid].tograde,
     .notin, .submitted) and the bar's totals; with a mode on, only the
     assessments it counts or has listed, each opened once. A class whose
     work is off has no bar, so the mode goes off with it. */
  /**
   * @param {string} cid @param {{ id: string }[]} assessments
   * @param {Record<string, any>} nums @param {string[]} shownIds
   */
  function listed(cid, assessments, nums, shownIds) {
    _totals = { submitted: 0, tograde: 0, notin: 0 };
    if (!G.GraderWork.workOnInClass(cid)) {
      if (_mode !== 'all') _leave(false);
      return assessments;
    }
    assessments.forEach(function (a) {
      var c = G.GraderWork.workCounts(cid, a.id, shownIds);
      var n = nums[a.id];
      n.tograde = c.tograde;
      n.notin = c.notin;
      n.submitted = G.GraderWork.workInIds(cid, a.id, shownIds).length;
      _totals.tograde += n.tograde;
      _totals.notin += n.notin;
      _totals.submitted += n.submitted;
    });
    if (_mode === 'all') return assessments;
    var kept = assessments.filter(function (a) {
      return nums[a.id][_mode] > 0 || !!_kept[a.id];
    });
    var open = _page ? _page.get().open : null;
    kept.forEach(function (a) {
      if (!_kept[a.id]) _kept[a.id] = {};
      if (_opened[a.id] || !open) return;
      _opened[a.id] = true;
      open.add(a.id);
    });
    return kept;
  }

  /** @param {string} cid @param {string} aid @param {string[]} ids */
  function _idsNow(cid, aid, ids) {
    if (_mode === 'submitted') return G.GraderWork.workInIds(cid, aid, ids);
    var lists = G.GraderWork.workCounts(cid, aid, ids).ids;
    return _mode === 'tograde' ? lists.tograde : lists.notin;
  }

  // An open card's students: with a mode on, those it counts or has shown.
  /** @param {string} cid @param {{ id: string }} a @param {{ id: string }[]} students */
  function students(cid, a, students) {
    if (_mode === 'all') return students;
    var keep = _kept[a.id] || (_kept[a.id] = {});
    _idsNow(
      cid,
      a.id,
      students.map(function (st) {
        return st.id;
      }),
    ).forEach(function (sid) {
      keep[sid] = true;
    });
    return students.filter(function (st) {
      return keep[st.id];
    });
  }

  // Grading in place moved the To Grade count: the bar follows.
  /** @param {number} total */
  function toGradeTotal(total) {
    if (total === _totals.tograde) return;
    _totals.tograde = total;
    var n = document.querySelector('.assess-tograde-n');
    if (n) n.textContent = String(total);
  }

  var TIPS = {
    submitted: 'Show only the assessments with work sent in, and only the students who sent it.',
    tograde: 'Show only the work waiting to be graded, and only the students it is from.',
    notin: 'Show only the students who have not sent work yet. Excused students are left out.',
  };

  // html-safe: fixed words and numbers
  /** @param {string} cid */
  function barHtml(cid) {
    if (!G.GraderWork.workOnInClass(cid)) return '';
    /** @param {string} show @param {string} label */
    function btn(show, label) {
      var pressed = _mode === show;
      var n = show === 'all' ? null : _totals[/** @type {'submitted' | 'tograde' | 'notin'} */ (show)];
      var tip = show === 'all' ? '' : pressed ? 'Click again to show everything.' : TIPS[show];
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
      btn('all', 'All') +
      btn('submitted', 'Submitted') +
      btn('tograde', 'To Grade') +
      btn('notin', 'Not In') +
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
    bind: bind,
    reset: reset,
    on: on,
    mode: mode,
    choose: choose,
    afterDraw: afterDraw,
    listed: listed,
    students: students,
    toGradeTotal: toGradeTotal,
    barHtml: barHtml,
    toGradeChipHtml: toGradeChipHtml,
  };
})();
