// @ts-check
/* ── report-toolbar.js — the Reports page's toolbar ────────────────────
   The bar in the Assignments and Gradebook bars' style (Colin, Nov 25:
   "the Reporting bar in the same style"; board: Reporting Same Style).
   Left to right:

   - The two tabs (Term Questionnaire | Print Reports), from page-reports.js.
   - Print Reports only: the Previous and Next Student arrows (narrow
     windows), the student picker, then Report and Copy.
   - Term Questionnaire: Report.
   - A flexible gap.
   - Term Questionnaire: the Ready count (a track that fills, then "N of M
     Ready", or "All M Ready" in green), ⋯ (Edit Student, Where This
     Information Comes From) and Approve and Next ›. While every student is
     Ready that button reads Print Reports › and opens the Print Reports tab.
   - Print Reports: Parts (narrow windows) and Print Reports.

   The ⋯ menu is CardMenu's (card-menu.js), the same look, keys and focus as
   the Assignments and Gradebook bars'. Approve and Next and Print Reports
   share one width, so the right edge stays put between tabs.

   page-reports.js shows and hides the pieces for each tab (.tq-only is the
   questionnaire's); report-questionnaire.js tells this file how many students
   are Ready (setReady) and what keeps Approve and Next off (setApprove). */
/** @type {any} */ (window).ReportToolbar = (function () {
  'use strict';

  var G = /** @type {any} */ (window);

  var DOTS_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

  var APPROVE_WORDS = 'Approve and Next ›';
  var PRINT_WORDS = 'Print Reports ›';

  // What the questionnaire last told this bar.
  var _ready = 0;
  var _total = 0;
  var _off = false;
  /** @type {string | null} */
  var _title = null;

  function reset() {
    _ready = 0;
    _total = 0;
    _off = false;
    _title = null;
  }

  // Every student is Ready (and there is a student).
  function allReady() {
    return _total > 0 && _ready >= _total;
  }
  // Whether the button now opens Print Reports. A comment that cannot be
  // approved (Approve and Next is off) keeps its reason, so it is not.
  function printing() {
    return allReady() && !_off;
  }

  /* ── The Ready count ───────────────────────────────────────── */
  /** @param {number} ready @param {number} total */
  function setReady(ready, total) {
    _ready = ready;
    _total = total;
    var done = allReady();
    var words = done ? 'All ' + total + ' Ready' : ready + ' of ' + total + ' Ready';
    var text = document.getElementById('tq-ready');
    if (text) text.textContent = words;
    var wrap = document.getElementById('tq-ready-wrap');
    if (wrap && wrap.classList) wrap.classList.toggle('is-done', done);
    var track = document.getElementById('tq-ready-track');
    if (track && track.setAttribute) {
      track.setAttribute('aria-valuemax', String(total));
      track.setAttribute('aria-valuenow', String(ready));
      track.setAttribute('aria-valuetext', words);
      var fill = /** @type {HTMLElement | null} */ (track.firstElementChild);
      if (fill) fill.style.width = (total > 0 ? Math.min(100, Math.round((ready / total) * 10000) / 100) : 0) + '%';
    }
    _paintApprove(document.getElementById('tq-approve-next'));
  }

  /* ── Approve and Next ──────────────────────────────────────── */
  // off: it cannot be pressed now; title: the reason, or its usual words.
  /** @param {any} btn @param {boolean} off @param {string} title */
  function setApprove(btn, off, title) {
    _off = off;
    _title = title;
    _paintApprove(btn);
  }
  /** @param {any} btn */
  function _paintApprove(btn) {
    if (!btn) return;
    var print = printing();
    btn.textContent = print ? PRINT_WORDS : APPROVE_WORDS;
    btn.disabled = _off;
    if (print) btn.title = 'Opens Print Reports';
    else if (_title !== null) btn.title = _title;
  }

  /* ── The bar ───────────────────────────────────────────────── */
  // The bar, then #report-output, where the open tab draws.
  // html-safe: fixed markup around the tabs' own markup, which page-reports.js builds through esc
  /** @param {string} tabsHtml */
  function html(tabsHtml) {
    reset();
    return (
      '<div class="page-toolbar report-toolbar no-print">' +
      '<div class="seg report-seg-control" role="tablist" aria-label="Report type">' +
      tabsHtml +
      '</div>' +
      '<div class="report-stepper" id="report-stepper" style="display:none">' +
      _arrow(-1, 'Previous Student', '<path d="M7.5 2.5L4 6l3.5 3.5"/>') +
      _arrow(1, 'Next Student', '<path d="M4.5 2.5L8 6l-3.5 3.5"/>') +
      '</div>' +
      '<div class="student-picker" id="student-picker">' +
      '<button type="button" class="student-picker-btn" data-action="toggleStudentPicker" aria-label="Select students" aria-expanded="false" aria-haspopup="listbox">' +
      '<span id="picker-label">All Students</span></button>' +
      '<div class="student-picker-dropdown" id="picker-dropdown"></div>' +
      '</div>' +
      '<select id="report-period" class="term-select grey-select" aria-label="Report" title="The report you are working on. Each report keeps its own comments and attendance."></select>' +
      '<select id="report-copy" class="term-select grey-select" aria-label="Copy" style="display:none"></select>' +
      '<div class="rtb-end">' +
      '<span class="rtb-ready tq-only" id="tq-ready-wrap" style="display:none">' +
      '<span class="rtb-track" id="tq-ready-track" role="progressbar" aria-label="Students Ready" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span class="rtb-fill"></span></span>' +
      '<span id="tq-ready"></span></span>' +
      '<div class="assess-menu-wrap rtb-more-wrap tq-only" style="display:none">' +
      '<button type="button" class="atb-icon-btn" id="tq-more-btn" data-action="toggleCardMenu" aria-haspopup="menu" aria-expanded="false" aria-label="More" title="More">' +
      DOTS_ICON +
      '</button>' +
      '<div class="assess-menu" role="menu" aria-label="More" hidden>' +
      _item('tqEditStudent', 'Edit Student') +
      _item('tqInfo', 'Where This Information Comes From') +
      '</div></div>' +
      '<button type="button" class="tb-action-btn tq-only" id="tq-approve-next" style="display:none" data-action="tqApproveNext" title="Saves this comment to the report card and opens the next student. ⌘ Return">' +
      APPROVE_WORDS +
      '</button>' +
      '<button type="button" class="tb-toggle-btn" id="tb-rail-btn" style="display:none" data-action="toggleRail" aria-pressed="false" aria-controls="studio-palette">Parts</button>' +
      '<button type="button" class="tb-action-btn" id="tb-print-btn" data-action="printReports">Print Reports</button>' +
      '</div>' +
      '</div>' +
      '\n    <div id="report-output" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto"></div>'
    );
  }
  // html-safe: fixed words
  /** @param {number} dir @param {string} label @param {string} path */
  function _arrow(dir, label, path) {
    return (
      '<button type="button" class="tq-toolbar-arrow" data-action="stepStudent" data-dir="' +
      dir +
      '" title="' +
      label +
      '" aria-label="' +
      label +
      '"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      '</svg></button>'
    );
  }
  // html-safe: fixed words
  /** @param {string} action @param {string} label */
  function _item(action, label) {
    return (
      '<button type="button" role="menuitem" class="assess-menu-item" data-action="' +
      action +
      '"><span>' +
      label +
      '</span></button>'
    );
  }

  /* ── Clicks and keys ───────────────────────────────────────────
     click() is first in the page's click handler. It opens and closes ⋯,
     and closes it on a click outside; choosing an item closes it and hands
     the keyboard to ⋯ first, so a dialog the item opens gives it back there.
     True when the click was wholly its own. */
  /** @param {Event} e */
  function click(e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest) return false;
    if (!t.closest('.rtb-more-wrap')) G.CardMenu.close();
    var el = /** @type {HTMLElement | null} */ (t.closest('[data-action]'));
    if (!el || !el.closest('.report-toolbar')) return false;
    if (el.dataset.action === 'toggleCardMenu') {
      G.CardMenu.toggle(el);
      return true;
    }
    if (el.closest('.rtb-more-wrap .assess-menu')) {
      G.CardMenu.close();
      var btn = document.getElementById('tq-more-btn');
      if (btn) btn.focus({ preventScroll: true });
    }
    return false;
  }

  // ↑ ↓ and Esc in ⋯ are CardMenu's. True when it was the menu's.
  /** @param {KeyboardEvent} e */
  function keydown(e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest || !t.closest('.rtb-more-wrap')) return false;
    return !!G.CardMenu.keydown(e);
  }

  return {
    html: html,
    reset: reset,
    setReady: setReady,
    setApprove: setApprove,
    printing: printing,
    click: click,
    keydown: keydown,
  };
})();
