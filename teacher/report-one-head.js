// @ts-check
/* report-one-head.js — Progress Reports, the preview's head: Previous
   Student and Next Student beside the fit line, and Hide Panels at the
   right end of the tools (2026-11-13).

   Previous and Next step through the roster rail as it is shown now (its
   sort and its search) and open the student by clicking that student's
   row, so they do exactly what a click on the rail does: the same guard
   for a comment being edited on the page, the same highlight, the same
   redraw. At either end they stay where they are, as the Term
   Questionnaire's Previous does at its first student.

   Hide Panels tucks away the parts panel (#studio-palette) and the roster
   for this visit only, writing no preference; Show Panels brings both back
   with their scroll positions. Leaving Progress Reports or reloading shows
   them again. */
window.ReportOneHead = (function () {
  'use strict';

  var ARROW_L =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ARROW_R =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** @type {string | null} */
  var _sid = null;
  var _hidden = false;
  var _hidRoster = false;
  /** @type {{ palette: number, roster: number, sidebar: number }} */
  var _scroll = { palette: 0, roster: 0, sidebar: 0 };

  // html-safe: fixed markup, literal labels and glyphs
  function navHtml() {
    return (
      '<span class="studio-nav" id="studio-nav">' +
      '<button type="button" class="tq-toolbar-arrow studio-nav-btn" data-nav="-1" aria-label="Previous Student" title="Previous Student">' +
      ARROW_L +
      '</button>' +
      '<button type="button" class="tq-toolbar-arrow studio-nav-btn" data-nav="1" aria-label="Next Student" title="Next Student">' +
      ARROW_R +
      '</button></span>'
    );
  }

  // html-safe: fixed markup, a literal label
  function panelsHtml() {
    return '<button type="button" class="tb-toggle-btn studio-panels-btn" id="studio-panels-btn" aria-controls="studio-palette">Hide Panels</button>';
  }

  /* ── Previous and Next ───────────────────────────────────── */

  /** @returns {HTMLElement[]} */
  function _rows() {
    var list = document.getElementById('gb-roster-list');
    return list ? Array.prototype.slice.call(list.querySelectorAll('.student-row[data-sid]')) : [];
  }
  /** @param {HTMLElement} r */
  function _shown(r) {
    return r.style.display !== 'none' && !r.classList.contains('roster-hidden');
  }

  /* The row dir steps from the student shown: the next shown row after
     it in the rail's order (or before it), or null at the end. A student
     the search has hidden still has a place in the order. */
  /** @param {number} dir @returns {HTMLElement | null} */
  function target(dir) {
    var rows = _rows();
    var i = -1;
    for (var k = 0; k < rows.length; k++) if (rows[k].getAttribute('data-sid') === _sid) i = k;
    if (i < 0) {
      var shown = rows.filter(_shown);
      return (dir > 0 ? shown[0] : shown[shown.length - 1]) || null;
    }
    for (var j = i + dir; j >= 0 && j < rows.length; j += dir) if (_shown(rows[j])) return rows[j];
    return null;
  }

  /** @param {number} dir */
  function go(dir) {
    var row = target(dir);
    if (!row) return;
    var sid = row.getAttribute('data-sid');
    var focused = /** @type {HTMLElement | null} */ (document.activeElement);
    var had = focused && focused.closest && focused.closest('.studio-nav') ? focused.getAttribute('data-nav') : null;
    row.click();
    var landed = function () {
      var now = document.querySelector('#gb-roster-list .student-row[data-sid="' + sid + '"]');
      if (now && now.getClientRects().length) now.scrollIntoView({ block: 'nearest' });
      // The head is drawn again with the new student: the focus stays on
      // the arrow pressed, unless the page has put it somewhere (the
      // comment's save question).
      var a = document.activeElement;
      if (had && (!a || a === document.body)) {
        var btn = /** @type {HTMLElement | null} */ (document.querySelector('.studio-nav [data-nav="' + had + '"]'));
        if (btn) btn.focus();
      }
    };
    landed();
    setTimeout(landed, 0);
  }

  /* ── Hide Panels ─────────────────────────────────────────── */

  /* The roster is tucked with a class of this file's own on the page
     layout (teacher/report-one-zoom.css), never through ui.js's
     toggleSidebar: that saves the teacher's preference, which syncs to the
     server and their other devices. Nothing here reads the preference into
     a new value or writes it. */
  var TUCK = 'fv-roster-tucked';

  function _overlay() {
    var w = /** @type {Window & { _sidebarIsOverlay?: () => boolean }} */ (window);
    return typeof w._sidebarIsOverlay === 'function' && w._sidebarIsOverlay();
  }
  /* The roster is on screen beside the pages (not hidden by the teacher's
     own setting, not the narrow layout's overlay). */
  function _rosterBeside() {
    var layout = document.getElementById('page-layout');
    return !!layout && !_overlay() && !layout.classList.contains('sidebar-hidden');
  }
  /** @param {boolean} on */
  function _tuck(on) {
    var layout = document.getElementById('page-layout');
    if (layout) layout.classList.toggle(TUCK, on);
    if (on) document.addEventListener('click', _onSidebarButton, true);
    else document.removeEventListener('click', _onSidebarButton, true);
  }
  /* The app's sidebar button, pressed while Hide Panels has the roster
     tucked: it shows the roster for this visit and goes no further, so the
     saved preference (the roster shown) is not flipped to hidden. The parts
     panel stays hidden. */
  /** @param {Event} e */
  function _onSidebarButton(e) {
    var t = /** @type {Element | null} */ (e.target);
    if (!t || !t.closest || !t.closest('[data-action="toggleSidebar"]') || _overlay()) return;
    e.preventDefault();
    e.stopPropagation();
    _hidRoster = false;
    _tuck(false);
    _setTop('gb-roster-list', _scroll.roster);
    _setTop('gb-sidebar', _scroll.sidebar);
    _refit();
  }
  /** @param {string} id */
  function _top(id) {
    var el = document.getElementById(id);
    return el ? el.scrollTop : 0;
  }
  /** @param {string} id @param {number} v */
  function _setTop(id, v) {
    var el = document.getElementById(id);
    if (el) el.scrollTop = v;
  }
  function _refit() {
    var Z = /** @type {Window & { ReportOneZoom?: { refit(glide: boolean): void } }} */ (window).ReportOneZoom;
    if (Z) Z.refit(true);
  }

  /** @param {boolean} hide */
  function setHidden(hide) {
    if (hide === _hidden) return;
    var studio = document.getElementById('studio');
    if (hide) {
      _scroll = { palette: _top('studio-palette'), roster: _top('gb-roster-list'), sidebar: _top('gb-sidebar') };
      // In the narrow layout the roster is an overlay: only the parts panel goes.
      _hidRoster = _rosterBeside();
      if (_hidRoster) _tuck(true);
      if (studio) studio.classList.remove('rail-open');
    } else if (_hidRoster) {
      _hidRoster = false;
      _tuck(false);
    }
    _hidden = hide;
    _paint();
    if (!hide) {
      _setTop('studio-palette', _scroll.palette);
      _setTop('gb-roster-list', _scroll.roster);
      _setTop('gb-sidebar', _scroll.sidebar);
    }
    // The roster goes at once; the pages fit the new width with the zoom's glide.
    _refit();
  }

  function _paint() {
    var studio = document.getElementById('studio');
    if (studio) studio.classList.toggle('panels-hidden', _hidden);
    var btn = document.getElementById('studio-panels-btn');
    if (btn) btn.textContent = _hidden ? 'Show Panels' : 'Hide Panels';
  }

  /* After each render of the preview: the student shown, the arrows hidden
     in Everyone view, the panels as the teacher left them, the controls
     bound (they are drawn new with the head). */
  /** @param {string} view @param {string | null} sid */
  function sync(view, sid) {
    _sid = sid;
    var nav = document.getElementById('studio-nav');
    if (nav) {
      var navEl = nav;
      nav.hidden = view === 'all';
      if (!nav.dataset.bound) {
        nav.dataset.bound = '1';
        nav.addEventListener('click', function (e) {
          var b = /** @type {Element | null} */ (e.target);
          var btn = b && b.closest ? b.closest('[data-nav]') : null;
          if (btn) go(Number(btn.getAttribute('data-nav')));
        });
        // With the focus on an arrow, Left and Right step too; bare arrow
        // keys on the page are left to the sheets, which are edited there.
        nav.addEventListener('keydown', function (e) {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          var dir = e.key === 'ArrowRight' ? 1 : -1;
          var other = /** @type {HTMLElement | null} */ (navEl.querySelector('[data-nav="' + dir + '"]'));
          if (other) other.focus();
          go(dir);
        });
      }
    }
    var pbtn = document.getElementById('studio-panels-btn');
    if (pbtn && !pbtn.dataset.bound) {
      pbtn.dataset.bound = '1';
      pbtn.addEventListener('click', function () {
        setHidden(!_hidden);
      });
    }
    _paint();
  }

  /* Leaving Progress Reports (another tab, another page): the panels come
     back, so the next visit starts with them. */
  function reset() {
    if (_hidden) setHidden(false);
    _hidden = false;
    _hidRoster = false;
    _tuck(false);
  }

  return {
    navHtml: navHtml,
    panelsHtml: panelsHtml,
    sync: sync,
    reset: reset,
    setHidden: setHidden,
    target: target,
    go: go,
    isHidden: function () {
      return _hidden;
    },
  };
})();
