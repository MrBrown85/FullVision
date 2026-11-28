// @ts-check
/* cm-terms-start.js — Where a class's reporting terms start: the generic
   layouts Start With offers (4 Terms, 3 Terms, 2 Semesters; moved from
   teacher/cm-terms.js), the default school's terms a new class gets, and
   the New Class wizard's draft.

   The draft (Colin, 2026-11-27: "just reuse this"): Change on the wizard's
   Reporting Terms row draws Class Settings' own Reporting Terms section
   (CmTerms) for the class being made, kept under KEY until Create Class
   saves what it holds. Inside the wizard the section leaves out This Class
   Runs (step 2 has it, and it drives the draft's span), Save Terms and Also
   Use In. Loads before cm-terms.js; reads CmTerms only when called. */
/** @type {any} */ (window).CmTermsStart = (function () {
  'use strict';

  var KEY = 'new-class';

  // The school year a class is in: September of this year from August on,
  // else September of last year.
  function _schoolYearStart(cid) {
    var today = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
    var y = parseInt(today.slice(0, 4), 10);
    var m = parseInt(today.slice(5, 7), 10);
    return m >= 8 ? y : y - 1;
  }

  var LAYOUTS = {
    quarters: [
      ['Term 1', '09-01', '11-15', 0, 0],
      ['Term 2', '11-16', '01-31', 0, 1],
      ['Term 3', '02-01', '04-15', 1, 1],
      ['Term 4', '04-16', '06-30', 1, 1],
    ],
    trimesters: [
      ['Term 1', '09-01', '11-30', 0, 0],
      ['Term 2', '12-01', '03-15', 0, 1],
      ['Term 3', '03-16', '06-30', 1, 1],
    ],
    semesters: [
      ['Term 1', '09-01', '01-31', 0, 1],
      ['Term 2', '02-01', '06-30', 1, 1],
    ],
  };

  function layoutRows(cid, name) {
    var y = _schoolYearStart(cid);
    return (LAYOUTS[name] || []).map(function (p, i) {
      return { ordinal: i + 1, label: p[0], starts_on: y + p[3] + '-' + p[1], ends_on: y + p[4] + '-' + p[2] };
    });
  }

  /* A new class starts with the default Surrey secondary school's terms
     for the current school year, when the presets cover it: all four for a
     full-year class, or one semester's two, keeping their numbers. */
  function defaultTerms(span) {
    if (typeof reportingTermPreset !== 'function') return [];
    var full = reportingTermPreset(null, courseToday(null));
    if (!full) return [];
    return termsInSpan(full, span || 'full', semesterTwoStart(full));
  }

  /* ── The New Class wizard's draft ── */
  /** @type {{ state: any, redraw: () => void, changed: () => void } | null} */
  var _host = null;
  // While This Class Runs cuts the draft again, the row is redrawn once, after.
  var _quiet = false;

  function _span() {
    return (_host && _host.state.cwStep2Span) || 'full';
  }

  /** @param {{ state: any, redraw: () => void, changed: () => void }} h */
  function configure(h) {
    _host = h;
    /** @type {any} */ (window).CmTerms.useDraft({
      key: KEY,
      active: function () {
        return !!_host && _host.state.cmMode === 'create';
      },
      saved: function () {
        return defaultTerms(_span());
      },
      redraw: function () {
        if (!_quiet && _host) _host.redraw();
      },
      changed: _refresh,
    });
  }

  function _draft() {
    return /** @type {any} */ (window).CmTerms._cmTermRows(KEY);
  }

  // What Create Class saves: the terms the section shows, numbered.
  function terms() {
    return normalizeTermOrdinals(_draft().rows);
  }

  // Why the terms can't be saved, or null. Create Class waits while there is one.
  function error() {
    return reportingTermsError(terms());
  }

  // Another class whose own dates these are, by name.
  function _sameAs(rows) {
    var sig = JSON.stringify(rows);
    var found = Object.keys(typeof COURSES !== 'undefined' && COURSES ? COURSES : {}).find(function (c) {
      if (typeof isCourseArchived === 'function' && isCourseArchived(c)) return false;
      return JSON.stringify(normalizeTermOrdinals(getReportingTerms(c))) === sig;
    });
    if (!found) return null;
    return typeof courseDisplayName === 'function' ? courseDisplayName(COURSES[found]) : COURSES[found].name;
  }

  // The closed row's words: whose dates, and how many terms.
  function summary() {
    var rows = terms();
    if (!rows.length) return 'None';
    var n = rows.length + (rows.length === 1 ? ' term' : ' terms');
    var match = typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(rows) : null;
    if (match) return /** @type {any} */ (match.school).name + ', ' + n;
    var same = _sameAs(rows);
    return same ? 'Same as ' + same + ', ' + n : 'Your own dates, ' + n;
  }

  // The Reporting Terms section, as Class Settings draws it.
  function html() {
    return /** @type {any} */ (window).CmTerms._cmRenderReportingTermsField(KEY);
  }

  /* The row's words and, when it is open, its section, drawn again in
     place, so This Class Runs and a typed date keep their focus. Then
     Create Class follows. */
  function _refresh(redrawPanel) {
    var btn = document.querySelector('[data-action="cwOpenRow"][data-row="terms"]');
    var head = btn && btn.parentElement;
    var value = head && head.querySelector('.cw-set-value');
    if (value) value.textContent = summary();
    var panel = head && head.nextElementSibling;
    if (redrawPanel === true && panel && panel.classList.contains('cw-set-panel')) panel.innerHTML = html();
    if (_host) _host.changed();
  }

  /* This Class Runs changed on step 2. Terms not changed yet start again
     from the school's for the new span; a school's terms the teacher
     changed are cut again, as Class Settings cuts them; own dates stay. */
  function spanChanged() {
    var st = /** @type {any} */ (window).CmTerms._cmTermState[KEY];
    if (st && st.dirty) {
      _quiet = true;
      try {
        /** @type {any} */ (window).CmTerms.cmTermSpan(_span());
      } finally {
        _quiet = false;
      }
    } else if (st) delete (/** @type {any} */ (window).CmTerms._cmTermState[KEY]);
    _refresh(true);
  }

  // A new wizard starts from the school's terms, with nothing picked.
  function reset() {
    var cm = /** @type {any} */ (window).CmTerms;
    if (cm && cm.forget) cm.forget(KEY);
  }

  return {
    KEY: KEY,
    LAYOUTS: LAYOUTS,
    layoutRows: layoutRows,
    defaultTerms: defaultTerms,
    configure: configure,
    terms: terms,
    error: error,
    summary: summary,
    html: html,
    spanChanged: spanChanged,
    reset: reset,
  };
})();
