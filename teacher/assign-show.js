// @ts-check
/* ── assign-show.js — the Assignments page's Show bar ─────────────────
   All | Submitted | To Grade 6 | To Return 2 | Not In on the toolbar. Submitted,
   To Grade and Not In show in a class whose student page and Send Work are
   on; To Return shows in a class that holds grades while a draft waits (or
   while it is pressed). Every number is GraderWork's. Only To Grade and
   To Return carry one (Colin, Nov 25: "Three Things").

   Each of the three lists only the assessments it counts, and inside each
   card only the students it counts (Colin, Nov 16):
   - Submitted: work is in, graded or not (GraderWork.workInIds);
   - To Grade: work is in and grading has not started (S6-F4);
   - Not In: the piece takes work and nothing is in; Excused is left out.
   It only filters: it never opens or closes a card or a folder. Each keeps
   what the teacher gave it, through every change and back to All, and the
   teacher opens and closes them freely while one is on (Colin, Nov 17).
   One click turns one on; a second click, or All, lets go and puts back
   the scroll the bar found, even after going from one to another.

   To Return is the page's own filter (the assessments with a draft to
   return), not one of MODES: the page keeps it, and it shows pressed only
   while the bar is on All. Choosing another option lets it go; it cannot be
   combined with another (PageAssignments.setToGradeShow).

   While one is on, what it listed stays listed until it is let go: grading
   a student does not pull their row, or the card, out from under the
   pointer. The counts on the bar move as they change.

   PageAssignments calls listed() and students() as it draws, and choose()
   and afterDraw() around a click on the bar. */
/** @type {any} */ (window).AssignShow = (function () {
  'use strict';

  // The other modules this reads, loaded before it in app.html.
  var G = /** @type {any} */ (window);

  var MODES = ['submitted', 'tograde', 'notin'];
  // 'all' or one of MODES.
  var _mode = 'all';
  // Over the assessments listed at the last draw: students for Submitted and
  // Not In, pieces of work for To Grade (a group counts once).
  var _totals = { submitted: 0, tograde: 0, notin: 0 };
  // The scroll when the bar left All, to put back when it lets go.
  /** @type {number | null} */
  var _before = null;
  // What this mode has listed: { aid: { sid: true } }.
  /** @type {Record<string, Record<string, boolean>>} */
  var _kept = {};
  /** @type {number | null} */
  var _scrollTo = null;

  /* A fresh page or another class: All, or the mode `show` names (the
     dashboard's To Grade cell opens the page with ?show=tograde). */
  /** @param {string} [show] */
  function reset(show) {
    _mode = 'all';
    _before = null;
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
    if (_mode === 'all') {
      var sc = _scroller();
      _before = sc ? sc.scrollTop : 0;
    }
    _mode = next;
    _kept = {};
    _scrollTo = 0;
  }

  /** @param {boolean} scroll whether to put the scroll back too */
  function _leave(scroll) {
    var was = _before;
    reset();
    if (scroll && was != null) _scrollTo = was;
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
     assessments it counts or has listed. A class whose
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
    return assessments.filter(function (a) {
      if (!(nums[a.id][_mode] > 0) && !_kept[a.id]) return false;
      if (!_kept[a.id]) _kept[a.id] = {};
      return true;
    });
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
    if (!n) return;
    n.textContent = String(total);
    n.classList.toggle('atb-badge-off', !total);
  }

  /* The drafts to return moved (a return, a grade): the badge follows, and
     the option comes or goes, alone, when the count crosses 0.
     ret: { holds, total, pressed } from the page. */
  /** @param {string} cid @param {{ holds: boolean, total: number, pressed: boolean }} ret */
  function syncReturn(cid, ret) {
    var slot = document.querySelector('.atb-show-slot');
    if (!slot) return;
    var bar = slot.querySelector('.atb-show');
    var btn = slot.querySelector('[data-show="toreturn"]');
    var want = ret.holds && (ret.total > 0 || ret.pressed);
    if (!bar) {
      // html-safe: built by barHtml
      if (want) slot.innerHTML = barHtml(cid, ret);
    } else if (want && !btn) {
      var notin = bar.querySelector('[data-show="notin"]');
      // html-safe: built by _btn
      (notin || bar).insertAdjacentHTML(notin ? 'beforebegin' : 'beforeend', _btn('toreturn', 'To Return', ret));
    } else if (!want && btn) {
      btn.remove();
      if (bar.children.length < 2) slot.textContent = '';
    } else if (btn) {
      var n = btn.querySelector('.assess-toreturn-n');
      if (n) n.textContent = String(ret.total);
    }
  }

  /** @type {Record<string, string>} */
  var TIPS = {
    submitted: 'Show only the assessments with work sent in, and only the students who sent it.',
    tograde: 'Show only the work waiting to be graded, and only the students it is from.',
    notin: 'Show only the students who have not sent work yet. Excused students are left out.',
    toreturn: 'Show only the assessments with a draft to return.',
  };

  /* One option. ret ({ holds, total, pressed }) is the page's reading of
     To Return. */
  // html-safe: fixed words and numbers
  /** @param {string} show @param {string} label @param {{ holds: boolean, total: number, pressed: boolean }} [ret] */
  function _btn(show, label, ret) {
    var returnOn = !!ret && ret.pressed && _mode === 'all';
    var pressed = show === 'all' ? _mode === 'all' && !returnOn : show === 'toreturn' ? returnOn : _mode === show;
    var tip = show === 'all' ? '' : pressed ? 'Click again to show everything.' : TIPS[show];
    var badge = '';
    if (show === 'tograde')
      badge =
        '<span class="atb-badge atb-badge-blue assess-tograde-n' +
        (_totals.tograde ? '' : ' atb-badge-off') +
        '">' +
        _totals.tograde +
        '</span>';
    else if (show === 'toreturn' && ret)
      badge = '<span class="atb-badge atb-badge-amber assess-toreturn-n">' + ret.total + '</span>';
    return (
      '<button type="button" class="seg-btn"' +
      G.segAttr(pressed) +
      ' data-action="setToGradeShow" data-show="' +
      show +
      '"' +
      (tip ? ' title="' + tip + '"' : '') +
      '><span class="atb-lab" data-t="' +
      label +
      '"><span>' +
      label +
      '</span></span>' +
      badge +
      '</button>'
    );
  }

  /* The bar: All and what the class has. Nothing is drawn when there is no
     option besides All. */
  // html-safe: fixed words and numbers
  /** @param {string} cid @param {{ holds: boolean, total: number, pressed: boolean }} [ret] */
  function barHtml(cid, ret) {
    var work = G.GraderWork.workOnInClass(cid);
    var back = !!ret && ret.holds && (ret.total > 0 || ret.pressed);
    if (!work && !back) return '';
    return (
      '<div class="seg atb-show" role="group" aria-label="Show">' +
      _btn('all', 'All', ret) +
      (work ? _btn('submitted', 'Submitted', ret) + _btn('tograde', 'To Grade', ret) : '') +
      (back ? _btn('toreturn', 'To Return', ret) : '') +
      (work ? _btn('notin', 'Not In', ret) : '') +
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
    reset: reset,
    on: on,
    mode: mode,
    choose: choose,
    afterDraw: afterDraw,
    listed: listed,
    students: students,
    toGradeTotal: toGradeTotal,
    syncReturn: syncReturn,
    barHtml: barHtml,
    toGradeChipHtml: toGradeChipHtml,
  };
})();
