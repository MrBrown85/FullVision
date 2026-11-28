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
  /* What the section showed when Edit Dates or Create New first opened the
     editor: Cancel puts it back, and Start With's first choice copies it. */
  /** @type {{ st: any, school: any, own: any, editing: any, start: any } | null} */
  var _snap = null;
  // The terms the draft held when Create New was chosen: Start With's first choice.
  /** @type {any[] | null} */
  var _held = null;

  function _cm() {
    return /** @type {any} */ (window).CmTerms;
  }

  function _span() {
    return (_host && _host.state.cwStep2Span) || 'full';
  }

  /** @param {{ state: any, redraw: () => void, changed: () => void }} h */
  function configure(h) {
    _host = h;
    _cm().useDraft({
      key: KEY,
      active: function () {
        return !!_host && _host.state.cmMode === 'create';
      },
      saved: _saved,
      redraw: function () {
        if (_host) _host.redraw();
      },
      changed: _refresh,
      opening: _opening,
      restore: _restore,
      currentLabel: _currentLabel,
    });
  }

  // Where the draft stands: what Create New or the editor opened from, else the school's terms.
  function _saved() {
    if (_held) return normalizeTermOrdinals(_held);
    return _snap ? normalizeTermOrdinals(_snap.st.rows) : defaultTerms(_span());
  }

  function _opening(isNew) {
    var cm = _cm();
    var st = cm._cmTermRows(KEY);
    if (isNew) _held = st.rows.map(_copy);
    if (_snap) return;
    _snap = {
      st: { rows: st.rows.map(_copy), span: st.span, dirty: st.dirty },
      school: cm._cmTermSchool[KEY],
      own: cm._cmTermOwn[KEY],
      editing: cm._cmTermEditing[KEY],
      start: cm._cmTermStart[KEY],
    };
  }

  // Cancel: CmTerms has forgotten the draft; put back what the editor opened from.
  function _restore() {
    var s = _snap;
    _snap = null;
    _held = null;
    if (!s) return;
    var cm = _cm();
    cm._cmTermState[KEY] = s.st;
    if (s.school !== undefined) cm._cmTermSchool[KEY] = s.school;
    if (s.own !== undefined) cm._cmTermOwn[KEY] = s.own;
    if (s.editing !== undefined) cm._cmTermEditing[KEY] = s.editing;
    if (s.start !== undefined) cm._cmTermStart[KEY] = s.start;
  }

  // Start With's first choice, named by what the draft holds.
  function _currentLabel() {
    var match = reportingTermsSchoolMatch(_saved());
    return match ? /** @type {any} */ (match.school).name + '’s Dates' : 'Current Dates';
  }

  function _copy(r) {
    return Object.assign({}, r);
  }

  /* The whole-year terms rows were cut from, unchanged: a school's or a
     Start With layout's, names and dates alike. Null for typed or edited
     terms, which This Class Runs leaves as they are. */
  function _wholeYear(rows) {
    var n = normalizeTermOrdinals(rows);
    if (!n.length) return null;
    var schools = typeof reportingTermSchools === 'function' ? reportingTermSchools() : [];
    var fulls = schools
      .map(function (sc) {
        return reportingTermPreset(sc.id, courseToday(null));
      })
      .concat(
        Object.keys(LAYOUTS).map(function (k) {
          return layoutRows(null, k);
        }),
      );
    return (
      fulls.find(function (full) {
        return (
          !!full &&
          n.every(function (r) {
            var t = full[r.ordinal - 1];
            return !!t && t.label === r.label && t.starts_on === r.starts_on && t.ends_on === r.ends_on;
          })
        );
      }) || null
    );
  }

  function _recut(st, span) {
    var full = _wholeYear(st.rows);
    var next = full ? termsInSpan(full, span, semesterTwoStart(full)) : [];
    if (next.length) st.rows = next.map(_copy);
    st.span = span;
  }

  function _draft() {
    return _cm()._cmTermRows(KEY);
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
  // html-safe: _cmRenderReportingTermsField escapes every name, id and date.
  function sectionHtml() {
    return _cm()._cmRenderReportingTermsField(KEY);
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
    if (redrawPanel === true && panel && panel.classList.contains('cw-set-panel')) panel.innerHTML = sectionHtml(); // html-safe: Class Settings' own section, escaped there.
    if (_host) _host.changed();
  }

  /* This Class Runs changed on step 2. Terms not changed yet start again
     from where the draft stands, for the new span; a school's or a Start
     With layout's terms are cut again; typed or edited dates stay. What
     Cancel would put back is cut the same way. */
  function spanChanged() {
    var span = _span();
    var st = _cm()._cmTermState[KEY];
    if (_snap) _recut(_snap.st, span);
    if (_held) {
      var held = { rows: _held, span: span };
      _recut(held, span);
      _held = held.rows;
    }
    if (st && st.dirty) _recut(st, span);
    else if (st) delete _cm()._cmTermState[KEY];
    _refresh(true);
  }

  // A new wizard starts from the school's terms, with nothing picked.
  function reset() {
    _snap = null;
    _held = null;
    var cm = _cm();
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
    html: sectionHtml,
    spanChanged: spanChanged,
    reset: reset,
  };
})();
