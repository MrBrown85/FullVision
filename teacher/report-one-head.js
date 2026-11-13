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
   (through ui.js's own toggleSidebar, so the teacher's own setting is what
   comes back); Show Panels brings both back with their scroll positions.
   It lasts this visit only: leaving Progress Reports shows them again. */
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

  function _sidebarShown() {
    var w = /** @type {Window & { _sidebarIsVisible?: () => boolean, _sidebarIsOverlay?: () => boolean }} */ (window);
    if (typeof w._sidebarIsOverlay === 'function' && w._sidebarIsOverlay()) return false;
    return typeof w._sidebarIsVisible === 'function' ? w._sidebarIsVisible() : false;
  }
  function _toggleRoster() {
    var w = /** @type {Window & { toggleSidebar?: () => void }} */ (window);
    if (typeof w.toggleSidebar === 'function') w.toggleSidebar();
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

  /** @param {boolean} hide */
  function setHidden(hide) {
    if (hide === _hidden) return;
    var studio = document.getElementById('studio');
    var slide = false;
    if (hide) {
      _scroll = { palette: _top('studio-palette'), roster: _top('gb-roster-list'), sidebar: _top('gb-sidebar') };
      _hidRoster = _sidebarShown();
      if (_hidRoster) {
        _toggleRoster();
        slide = true;
      }
      if (studio) studio.classList.remove('rail-open');
    } else if (_hidRoster) {
      _hidRoster = false;
      // Only what Hide Panels tucked away comes back: a roster the teacher
      // has opened or closed since stays as they left it.
      if (!_sidebarShown()) {
        _toggleRoster();
        slide = true;
      }
    }
    _hidden = hide;
    _paint();
    if (!hide) {
      _setTop('studio-palette', _scroll.palette);
      _setTop('gb-roster-list', _scroll.roster);
      _setTop('gb-sidebar', _scroll.sidebar);
    }
    var Z = /** @type {Window & { ReportOneZoom?: { refit(glide: boolean): void } }} */ (window).ReportOneZoom;
    if (Z) {
      var zoom = Z;
      zoom.refit(true);
      // The roster slides for 240 ms (ui.js): fit again once it has.
      if (slide) {
        setTimeout(function () {
          zoom.refit(true);
          if (!hide) _setTop('gb-roster-list', _scroll.roster);
        }, 300);
      }
    }
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
