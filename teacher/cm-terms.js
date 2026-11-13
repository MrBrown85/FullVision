// @ts-check
/* cm-terms.js — Class Settings: the Reporting Terms section (dated terms,
   Edit Dates, the school's own dates). Moved from teacher/dash-class-manager.js
   on 2026-11-13 (move only). It owns the edit state (_cmTermState,
   _cmTermSchool, _cmTermEditing); DashClassManager reads the first two through
   the same objects. DashClassManager hands it how to read the selected course
   and how to redraw the screen through configure(). Every function the manager
   calls goes through _entry(), which reads the selected course afresh just
   before the call, so the moved code always sees the course that is selected
   at that moment. */
window.CmTerms = (function () {
  'use strict';

  /** @type {{ selectedCourse: () => (string | null), renderClassManager: () => void } | null} */
  var _host = null;
  /** @type {string | null} */
  var cmSelectedCourse = null;
  /** @param {{ selectedCourse: () => (string | null), renderClassManager: () => void }} opts */
  function configure(opts) {
    _host = opts;
  }
  function renderClassManager() {
    if (_host) _host.renderClassManager();
  }
  /**
   * @param {Function} fn
   * @returns {(...args: unknown[]) => unknown}
   */
  function _entry(fn) {
    return function () {
      cmSelectedCourse = _host ? _host.selectedCourse() : null;
      return fn.apply(this, arguments);
    };
  }

  /* ── Reporting terms ─────────────────────────────────────────
     Up to six dated terms per class (docs/DECISIONS.md, "Reporting
     periods"). Edited like categories: rows change live, Save sends the
     whole list through saveReportingTerms, which numbers them by start
     date. */
  var _cmTermState = {}; // cid → { rows: [{ordinal?, label, starts_on, ends_on}], span, dirty }

  function _cmTermRows(cid) {
    if (!_cmTermState[cid]) {
      var saved = getReportingTerms(cid);
      _cmTermState[cid] = {
        rows: saved.map(function (t) {
          return { ordinal: t.ordinal, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on };
        }),
        span: 'full',
        dirty: false,
      };
      var template = _cmTermTemplate(cid, _cmTermState[cid].rows);
      if (template) _cmTermState[cid].span = termSpanOf(saved, semesterTwoStart(template));
    }
    return _cmTermState[cid];
  }

  // The school year a class is in: September of this year from August on,
  // else September of last year.
  function _cmSchoolYearStart(cid) {
    var today = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
    var y = parseInt(today.slice(0, 4), 10);
    var m = parseInt(today.slice(5, 7), 10);
    return m >= 8 ? y : y - 1;
  }

  var _CM_TERM_PRESETS = {
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

  function _cmTermPresetRows(cid, name) {
    var y = _cmSchoolYearStart(cid);
    return (_CM_TERM_PRESETS[name] || []).map(function (p, i) {
      return { ordinal: i + 1, label: p[0], starts_on: y + p[3] + '-' + p[1], ends_on: y + p[4] + '-' + p[2] };
    });
  }

  /* The whole-year terms the class's rows were cut from: a Surrey school's
     preset or a generic one, matched term by term on number and dates. Null
     for typed terms. Lets "This class runs" go back to Full year. */
  function _cmTermTemplate(cid, rows) {
    if (!rows.length) return null;
    var match = typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(rows) : null;
    if (match) {
      return match.school.terms.map(function (t, i) {
        return { ordinal: i + 1, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on };
      });
    }
    var names = Object.keys(_CM_TERM_PRESETS);
    for (var k = 0; k < names.length; k++) {
      var full = _cmTermPresetRows(cid, names[k]);
      var fits = rows.every(function (r) {
        var t = full[Number(r.ordinal) - 1];
        return !!t && t.starts_on === r.starts_on && t.ends_on === r.ends_on;
      });
      if (fits) return full;
    }
    return null;
  }

  function _cmTermError(cid) {
    return reportingTermsError(normalizeTermOrdinals(_cmTermRows(cid).rows));
  }

  function _cmTermCanSave(cid) {
    return !!_cmTermRows(cid).dirty && !_cmTermError(cid);
  }

  // html-safe: the error text is escaped; term numbers are Number()s from normalizeTermOrdinals.
  function _cmTermFooterHtml(cid) {
    var err = _cmTermError(cid);
    if (err) return '<span class="cm-cat-sum cm-cat-sum-over">' + esc(err) + '</span>';
    var ords = normalizeTermOrdinals(_cmTermRows(cid).rows).map(function (t) {
      return t.ordinal;
    });
    if (ords.length === 0) return '<span class="cm-cat-sum">No terms: every page shows the whole year.</span>';
    var first = ords[0],
      last = ords[ords.length - 1];
    var contiguous = last - first === ords.length - 1;
    var nums = ords.length === 1 ? String(first) : contiguous ? first + '–' + last : ords.join(', ');
    return (
      '<span class="cm-cat-sum">Report ' +
      nums +
      ' on the Reports page ' +
      (ords.length === 1 ? 'matches' : 'match') +
      ' these terms.</span>'
    );
  }

  function _cmTermRefreshFooter(cid) {
    var foot = document.getElementById('cm-term-foot-' + cid);
    if (foot) foot.innerHTML = _cmTermFooterHtml(cid);
    var saveEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('cm-term-save-' + cid));
    if (saveEl) saveEl.disabled = !_cmTermCanSave(cid);
  }

  // The Surrey secondary school whose published dates fill the rows
  // (shared/reporting-term-presets.js), per class: the school the teacher
  // just picked, else the school whose dates the class has, else Grandview
  // Heights. Cancel, Save and leaving the tab drop the pick.
  var _cmTermSchool = {};

  function _cmTermSchoolId(cid) {
    if (cid && _cmTermSchool[cid]) return _cmTermSchool[cid];
    var rows = cid ? _cmTermRows(cid).rows : [];
    var match =
      typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(normalizeTermOrdinals(rows)) : null;
    if (match) return match.school.id;
    return typeof REPORTING_TERM_PRESETS !== 'undefined' ? REPORTING_TERM_PRESETS.defaultSchool : null;
  }

  // The chosen school's terms for this class's span, or null.
  function _cmTermSchoolRows(cid) {
    if (typeof reportingTermPreset !== 'function') return null;
    var full = reportingTermPreset(_cmTermSchoolId(cid), courseToday(cid));
    if (!full) return null;
    return termsInSpan(full, _cmTermRows(cid).span, semesterTwoStart(full));
  }

  function _cmRenderSchoolPreset(cid, hasRows) {
    if (typeof reportingTermSchools !== 'function') return '';
    var schools = reportingTermSchools();
    if (!schools.length) return '';
    var chosen = _cmTermSchoolId(cid);
    var available = typeof reportingTermPreset === 'function' && !!reportingTermPreset(chosen, courseToday(cid));
    var school = schools.find(function (s) {
      return s.id === chosen;
    });
    var html = '<div class="cm-term-school">';
    html +=
      '<label class="cm-term-school-label" for="cm-term-school-' +
      cid +
      '">School</label>' +
      '<select class="cm-input cm-term-school-select" id="cm-term-school-' +
      cid +
      '" data-action-change="cmTermSchool">' +
      schools
        .map(function (s) {
          return (
            '<option value="' + esc(s.id) + '"' + (s.id === chosen ? ' selected' : '') + '>' + esc(s.name) + '</option>'
          );
        })
        .join('') +
      '</select>';
    if (available) {
      html +=
        '<button class="btn btn-primary cm-term-school-btn" data-action="cmTermSchoolPreset">' +
        (hasRows ? 'Replace With This School’s Dates' : 'Use This School’s Dates') +
        '</button>';
    }
    html += '</div>';
    // A school picked from the menu shows its dates before they replace
    // the class's.
    var preview = available ? _cmTermSchoolRows(cid) : null;
    var current = normalizeTermOrdinals(_cmTermRows(cid).rows);
    var same =
      preview &&
      preview.length === current.length &&
      preview.every(function (t, i) {
        return t.starts_on === current[i].starts_on && t.ends_on === current[i].ends_on;
      });
    if (preview && preview.length && !same) {
      html +=
        '<div class="cm-hint cm-term-school-preview">' +
        esc(school ? school.name : '') +
        ': ' +
        preview
          .map(function (t) {
            return esc(t.label + ' ' + _cmTermDay(t.starts_on) + ' \u2013 ' + _cmTermDay(t.ends_on));
          })
          .join(' \u00B7 ') +
        '</div>';
    }
    if (!available) {
      html +=
        '<div class="cm-hint">School dates are loaded for ' +
        esc(REPORTING_TERM_PRESETS.schoolYear) +
        ' only. Use a generic preset or type the dates.</div>';
    } else if (school && school.assumed) {
      html +=
        '<div class="cm-hint">' +
        esc(school.name) +
        ' has not published its semester turnaround, so Semester 2 starts Feb 1. Adjust if yours differs.</div>';
    }
    return html;
  }

  var _cmTermEditing = {}; // cid -> true while Edit Dates is open

  /* Saved terms as tiles: each term's name, dates and report. Edit Dates,
     a change of span or a new school's dates open the editor below. */
  function _cmTermDay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return isNaN(/** @type {number} */ (/** @type {unknown} */ (d)))
      ? iso
      : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _cmRenderTermTiles(cid) {
    var st = _cmTermRows(cid);
    var rows = normalizeTermOrdinals(st.rows);
    var match = typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(rows) : null;
    var reports = typeof reportingTermReportNames === 'function' ? reportingTermReportNames(rows) : null;
    var chosen = _cmTermSchoolId(cid);
    // The school menu offers another school's dates only once a different
    // school is picked.
    var preset = _cmRenderSchoolPreset(cid, true);
    if (match && match.school.id === chosen)
      preset = preset.replace(/<button[^>]*cm-term-school-btn[\s\S]*?<\/button>/, '');
    return (
      '<div class="cm-term-view">' +
      '<div class="cm-hint">Each term is a report date. Grades build all year: a report shows the year to date as of its term’s end.</div>' +
      '<div class="cm-term-view-top">' +
      preset +
      _cmRenderTermSpan(cid) +
      '</div>' +
      '<div class="cm-term-tiles">' +
      rows
        .map(function (t, i) {
          return (
            '<div class="cm-term-tile">' +
            '<div class="cm-term-tile-name">' +
            esc(t.label || 'Term ' + t.ordinal) +
            '</div>' +
            '<div class="cm-term-tile-dates">' +
            esc(_cmTermDay(t.starts_on)) +
            ' \u2013 ' +
            esc(_cmTermDay(t.ends_on)) +
            '</div>' +
            (reports && reports[i] ? '<div class="cm-term-tile-report">' + esc(reports[i]) + '</div>' : '') +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="cm-term-view-foot">' +
      '<div class="cm-hint">' +
      (match ? 'Each term ends the day its report is published. ' : '') +
      _cmTermFooterHtml(cid).replace(/<[^>]+>/g, '') +
      '</div>' +
      '<button type="button" class="cm-action-btn" data-action="cmTermEdit">Edit Dates</button>' +
      '</div>' +
      '</div>'
    );
  }

  function _cmRenderReportingTermsField(cid) {
    if (!cid) return '';
    var st = _cmTermRows(cid);
    var rows = st.rows;
    if (rows.length && !st.dirty && !_cmTermEditing[cid]) return _cmRenderTermTiles(cid);
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Reporting Terms</label>' +
      '<div class="cm-hint" style="margin-bottom:8px">Each term is a report date. Grades build all year: a report shows the year to date as of its term’s end. Up to six. Surrey secondary dates come from each school’s published calendar; a term ends on the day its report is published.</div>';
    html += _cmRenderTermSpan(cid);
    html += _cmRenderSchoolPreset(cid, rows.length > 0);
    if (rows.length === 0) {
      html +=
        '<div class="cm-term-presets">' +
        '<button class="cm-add-link" data-action="cmTermPreset" data-value="quarters">Quarters (4)</button>' +
        '<button class="cm-add-link" data-action="cmTermPreset" data-value="trimesters">Trimesters (3)</button>' +
        '<button class="cm-add-link" data-action="cmTermPreset" data-value="semesters">Semesters (2)</button>' +
        '<button class="cm-add-link" data-action="cmTermAdd">Custom</button>' +
        '</div>';
    }
    html += '<div class="cm-cat-list">';
    rows.forEach(function (row, idx) {
      html +=
        '<div class="cm-cat-row cm-term-row">' +
        '<input class="cm-input cm-term-label" value="' +
        esc(row.label) +
        '" placeholder="Term name" data-action-input="cmTermLive" data-field="label" data-idx="' +
        idx +
        '" aria-label="Term name">' +
        '<input class="cm-input cm-term-date" type="date" value="' +
        esc(row.starts_on) +
        '" data-action-input="cmTermLive" data-field="starts_on" data-idx="' +
        idx +
        '" aria-label="Start date">' +
        '<span class="cm-cat-pct">to</span>' +
        '<input class="cm-input cm-term-date" type="date" value="' +
        esc(row.ends_on) +
        '" data-action-input="cmTermLive" data-field="ends_on" data-idx="' +
        idx +
        '" aria-label="End date">' +
        '<button class="cm-delete-mini" data-action="cmTermDelete" data-idx="' +
        idx +
        '" title="Remove term" aria-label="Remove term">✕</button>' +
        '</div>';
    });
    html += '</div>';
    html +=
      '<div class="cm-cat-footer">' +
      (rows.length > 0 && rows.length < REPORTING_TERMS_MAX
        ? '<button class="cm-add-link" data-action="cmTermAdd">+ Add Term</button>'
        : '<span></span>') +
      '<div id="cm-term-foot-' +
      cid +
      '">' +
      _cmTermFooterHtml(cid) +
      '</div>' +
      '<button class="btn btn-primary cm-cat-save" id="cm-term-save-' +
      cid +
      '" data-action="cmTermSave"' +
      (_cmTermCanSave(cid) ? '' : ' disabled') +
      '>Save Terms</button>' +
      '</div>' +
      (getReportingTerms(cid).length
        ? '<button type="button" class="cm-add-link cm-term-cancel" data-action="cmTermCancel">Cancel</button>'
        : '') +
      '</div>';
    return html;
  }

  function cmTermEdit() {
    if (!cmSelectedCourse) return;
    _cmTermEditing[cmSelectedCourse] = true;
    renderClassManager();
  }

  // Cancel drops unsaved edits and goes back to the tiles.
  function cmTermCancel() {
    if (!cmSelectedCourse) return;
    delete _cmTermState[cmSelectedCourse];
    delete _cmTermSchool[cmSelectedCourse];
    _cmTermEditing[cmSelectedCourse] = false;
    renderClassManager();
  }

  /* "This class runs": Full year, Semester 1 or Semester 2. A semester class
     carries only that semester's terms and keeps their school numbers. */
  function _cmRenderTermSpan(cid) {
    var st = _cmTermRows(cid);
    // Typed terms are the class's own; the choice is for preset terms.
    if (st.rows.length > 0 && !_cmTermTemplate(cid, st.rows)) return '';
    var html =
      '<div class="cm-term-span"><span class="cm-term-span-label" id="cm-term-span-label-' +
      cid +
      '">This Class Runs</span>' +
      '<div class="seg seg-sm cm-seg" role="radiogroup" aria-labelledby="cm-term-span-label-' +
      cid +
      '">' +
      TERM_SPANS.map(function (o) {
        var on = st.span === o.value;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '"' +
          segAttr(on, 'radio') +
          ' data-action="cmTermSpan" data-value="' +
          o.value +
          '">' +
          o.label +
          '</button>'
        );
      }).join('') +
      '</div></div>';
    if (st.span !== 'full')
      html +=
        '<div class="cm-hint">A ' +
        (st.span === 's1' ? 'Semester 1' : 'Semester 2') +
        ' class keeps only that semester’s terms, with the school’s numbers' +
        (st.span === 's2' ? ' (Terms 3 and 4 stay Report 3 and 4)' : '') +
        '.</div>';
    return html;
  }

  function cmTermSpan(span) {
    if (!cmSelectedCourse || ['full', 's1', 's2'].indexOf(span) < 0) return;
    var cid = cmSelectedCourse;
    var st = _cmTermRows(cid);
    if (st.span === span) return;
    if (!st.rows.length) {
      // No terms yet: the choice applies when a preset fills them.
      st.span = span;
      renderClassManager();
      return;
    }
    var template = _cmTermTemplate(cid, st.rows);
    if (!template) return;
    var next = termsInSpan(template, span, semesterTwoStart(template));
    if (!next.length) return;
    st.rows = next.map(function (r) {
      return Object.assign({}, r);
    });
    st.span = span;
    st.dirty = true;
    renderClassManager();
  }

  function cmTermPreset(name) {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    var full = _cmTermPresetRows(cmSelectedCourse, name);
    st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    st.dirty = true;
    renderClassManager();
  }

  function cmTermSchool(id) {
    if (!cmSelectedCourse) return;
    if (id) _cmTermSchool[cmSelectedCourse] = id;
    else delete _cmTermSchool[cmSelectedCourse];
    renderClassManager();
  }

  function cmTermSchoolPreset() {
    if (!cmSelectedCourse || typeof reportingTermPreset !== 'function') return;
    var rows = reportingTermPreset(_cmTermSchoolId(cmSelectedCourse), courseToday(cmSelectedCourse));
    if (!rows) return;
    var st = _cmTermRows(cmSelectedCourse);
    var full = rows.map(function (r) {
      return { ordinal: r.ordinal, label: r.label, starts_on: r.starts_on, ends_on: r.ends_on };
    });
    st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    st.dirty = true;
    renderClassManager();
  }

  /* A new class starts with the default Surrey secondary school's terms
     for the current school year, when the presets cover it: all four for a
     full-year class, or one semester's two, keeping their numbers. */
  function _cmDefaultReportingTerms(cid, span) {
    if (typeof reportingTermPreset !== 'function') return null;
    var full = reportingTermPreset(null, courseToday(cid));
    if (!full) return null;
    return termsInSpan(full, span || 'full', semesterTwoStart(full));
  }

  function cmTermAdd() {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    if (st.rows.length >= REPORTING_TERMS_MAX) return;
    var last = st.rows[st.rows.length - 1];
    st.rows.push({ label: 'Term ' + (st.rows.length + 1), starts_on: '', ends_on: '' });
    if (last && last.ends_on) {
      // Start the day after the previous term ends.
      var d = new Date(last.ends_on + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      st.rows[st.rows.length - 1].starts_on = d.toISOString().slice(0, 10);
    }
    st.dirty = true;
    renderClassManager();
  }

  function cmTermDelete(idx) {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    st.rows.splice(idx, 1);
    st.dirty = true;
    renderClassManager();
  }

  function cmTermLive(idx, field, value) {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row || ['label', 'starts_on', 'ends_on'].indexOf(field) < 0) return;
    row[field] = value;
    st.dirty = true;
    _cmTermRefreshFooter(cmSelectedCourse);
  }

  function cmTermSave() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var st = _cmTermRows(cid);
    if (!_cmTermCanSave(cid)) return;
    var err = saveReportingTerms(cid, st.rows);
    if (err) {
      if (typeof showSyncToast === 'function') showSyncToast('Terms not saved: ' + err, 'error');
      return;
    }
    delete _cmTermState[cid];
    delete _cmTermSchool[cid];
    _cmTermEditing[cid] = false;
    renderClassManager();
  }

  return {
    configure: configure,
    _cmTermState: _cmTermState,
    _cmTermSchool: _cmTermSchool,
    _cmTermRows: _entry(_cmTermRows),
    _cmTermError: _entry(_cmTermError),
    _cmTermDay: _entry(_cmTermDay),
    _cmDefaultReportingTerms: _entry(_cmDefaultReportingTerms),
    _cmRenderReportingTermsField: _entry(_cmRenderReportingTermsField),
    cmTermEdit: _entry(cmTermEdit),
    cmTermCancel: _entry(cmTermCancel),
    cmTermSpan: _entry(cmTermSpan),
    cmTermPreset: _entry(cmTermPreset),
    cmTermSchool: _entry(cmTermSchool),
    cmTermSchoolPreset: _entry(cmTermSchoolPreset),
    cmTermAdd: _entry(cmTermAdd),
    cmTermDelete: _entry(cmTermDelete),
    cmTermLive: _entry(cmTermLive),
    cmTermSave: _entry(cmTermSave),
  };
})();
