// @ts-check
/* obs-roster.js — the Observations page's roster (docs/DECISIONS.md,
   "Observations off the Dashboard"), which replaces the Dashboard's
   Observations grid. (Open Concerns is an option in the bar's Show:
   obs-toolbar.js.)

   The roster (ui.js setSidebarAnnotator): beside each name, the days since
   the student was last observed, amber from 3 weeks
   (DashObservations.rosterMark); above the list, Not Observed in 3+ Weeks,
   which keeps only those students. A student picked in the note box stays
   in the list until another is picked, so writing to one doesn't pull
   their row away mid-note.

   The page (page-observations.js) owns the students and the picked
   students; this file owns the switch. */
/** @type {any} */ (window).ObsRoster = (function () {
  'use strict';

  var W = /** @type {any} */ (window);

  var _notObservedOnly = false;

  /* ctx: { cid, students, visible(list) → list without pending deletes,
     picked: [sid] } */
  function sync(ctx) {
    if (typeof W.setSidebarAnnotator !== 'function') return;
    var today = getTodayStr();
    var lists = {};
    var classObserved = false;
    ctx.students.forEach(function (st) {
      lists[st.id] = ctx.visible(getStudentQuickObs(ctx.cid, st.id) || []);
      if (lists[st.id].length) classObserved = true;
    });
    var marks = {};
    var overdue = 0;
    ctx.students.forEach(function (st) {
      marks[st.id] = W.DashObservations.rosterMark(lists[st.id], today, classObserved);
      if (marks[st.id].overdue) overdue++;
    });
    if (!overdue) _notObservedOnly = false;
    var annotate = function (sid) {
      var m = marks[sid];
      if (!m) return {};
      return {
        // html-safe: text and title are fixed words and numbers from rosterMark, escaped anyway.
        mark: m.text
          ? '<span class="student-row-mark obs-days' +
            (m.overdue ? ' is-overdue' : '') +
            '" title="' +
            esc(m.title) +
            '">' +
            esc(m.text) +
            '</span>'
          : '',
        hidden: _notObservedOnly && !m.overdue && ctx.picked.indexOf(sid) < 0,
      };
    };
    annotate.top = function () {
      if (!overdue) return '';
      return (
        '<button type="button" class="obs-roster-toggle' +
        (_notObservedOnly ? ' active' : '') +
        '" data-action="toggleNotObserved" aria-pressed="' +
        _notObservedOnly +
        '"><span class="obs-roster-toggle-label">Not Observed in 3+ Weeks</span><span class="obs-roster-toggle-n">' +
        overdue +
        '</span></button>'
      );
    };
    W.setSidebarAnnotator(annotate);
    document.body.classList.add('obs-roster');
    mark(ctx.picked);
  }

  function toggle() {
    _notObservedOnly = !_notObservedOnly;
  }
  function focusToggle() {
    var btn = /** @type {HTMLElement|null} */ (document.querySelector('#gb-sidebar .obs-roster-toggle'));
    if (btn) btn.focus();
  }

  /* A click on a row: onPick(sid, shiftKey) picks the student and returns
     the picked ids (null to do nothing); the picked rows show selected. */
  function _sidOf(row) {
    return new URLSearchParams((row.getAttribute('data-href') || '').split('?')[1] || '').get('id');
  }
  // The rows of the students picked show selected, whoever picked them.
  function mark(picked) {
    document.querySelectorAll('.student-row').forEach(function (r) {
      r.classList.toggle('selected', picked.indexOf(_sidOf(r)) >= 0);
    });
  }
  function wireRows(onPick) {
    requestAnimationFrame(function () {
      document.querySelectorAll('#gb-roster-list .student-row').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var sid = _sidOf(a);
          var picked = sid ? onPick(sid, /** @type {MouseEvent} */ (e).shiftKey) : null;
          if (picked) mark(picked);
        });
      });
    });
  }

  // Another class: everyone shows again.
  function reset() {
    _notObservedOnly = false;
  }

  // Leaving the page: the roster gets its grades back.
  function stop() {
    _notObservedOnly = false;
    if (typeof W.setSidebarAnnotator === 'function') W.setSidebarAnnotator(null);
    document.body.classList.remove('obs-roster');
  }

  return {
    sync: sync,
    toggle: toggle,
    focusToggle: focusToggle,
    wireRows: wireRows,
    reset: reset,
    stop: stop,
  };
})();
