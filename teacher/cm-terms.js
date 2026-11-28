// @ts-check
/* cm-terms.js — Class Settings: the Reporting Terms section (dated terms,
   Edit Dates, the school's own dates, the teacher's own dates). Moved from
   teacher/dash-class-manager.js on 2026-11-13 (move only). It owns the edit
   state (_cmTermState, _cmTermSchool, _cmTermEditing and the Create New
   state); DashClassManager reads the first two through the same objects and
   hands every cmTerm* action to handleAction. DashClassManager hands it how
   to read the selected course and how to redraw the screen through
   configure(). Every function the manager calls goes through _entry(),
   which reads the selected course afresh just before the call, so the code
   always sees the course that is selected at that moment.

   Create New (2026-11-17, docs/DECISIONS.md, "Your own reporting dates"):
   a teacher makes their own set of terms without picking a school. It
   starts from a copy of the class's dates, saves on the course row like any
   terms (no new table), and other classes reuse it through Dates From's
   Your Classes and Save's Also Use In.

   New Class (2026-11-27) draws this same section for the class being made,
   under teacher/cm-terms-start.js's draft key (useDraft). */
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
    if (_draft && _draft.active()) _draft.redraw();
    else if (_host) _host.renderClassManager();
  }
  /* The New Class wizard's class, not made yet (teacher/cm-terms-start.js):
     its terms are kept under the draft's key until Create Class saves them.
     opening() is told before Edit Dates or Create New opens the editor, and
     restore() puts back what was shown then, on Cancel. */
  /** @type {{ key: string, active: () => boolean, saved: () => any[], redraw: () => void, changed: () => void, opening: (isNew?: boolean) => void, restore: () => void, currentLabel: () => string } | null} */
  var _draft = null;
  function useDraft(d) {
    _draft = d;
  }
  function _isDraft(cid) {
    return !!_draft && cid === _draft.key;
  }
  // The terms a class has saved; for the class being made, the ones it starts with.
  function _cmSaved(cid) {
    return _draft && cid === _draft.key ? _draft.saved() : getReportingTerms(cid);
  }
  /**
   * @param {Function} fn
   * @returns {(...args: unknown[]) => unknown}
   */
  function _entry(fn) {
    return function () {
      cmSelectedCourse = _draft && _draft.active() ? _draft.key : _host ? _host.selectedCourse() : null;
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
      var saved = _cmSaved(cid);
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

  // The generic layouts (4 Terms, 3 Terms, 2 Semesters): teacher/cm-terms-start.js.
  var _CM_TERM_PRESETS = CmTermsStart.LAYOUTS;
  var _cmTermPresetRows = CmTermsStart.layoutRows;

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

  /* The row a problem belongs to, so it is marked where it is: { idx,
     field, text } for the first problem in the rows as shown, or null. An
     overlap marks the earlier term's end and names the later term's
     start. */
  function _cmTermRowProblem(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var name = String(r.label || '').trim() || 'Term ' + (i + 1);
      if (!String(r.label || '').trim()) return { idx: i, field: 'label', text: 'This term needs a name.' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.starts_on || ''))
        return { idx: i, field: 'starts_on', text: name + ' needs a start date.' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.ends_on || ''))
        return { idx: i, field: 'ends_on', text: name + ' needs an end date.' };
      if (r.starts_on > r.ends_on) return { idx: i, field: 'ends_on', text: name + ' ends before it starts.' };
    }
    var order = rows
      .map(function (r, i) {
        return i;
      })
      .sort(function (a, b) {
        return rows[a].starts_on < rows[b].starts_on ? -1 : rows[a].starts_on > rows[b].starts_on ? 1 : a - b;
      });
    for (var j = 1; j < order.length; j++) {
      var a = rows[order[j - 1]],
        b = rows[order[j]];
      if (b.starts_on <= a.ends_on)
        return {
          idx: order[j - 1],
          field: 'ends_on',
          text:
            String(a.label).trim() +
            ' and ' +
            String(b.label).trim() +
            ' overlap: ' +
            String(b.label).trim() +
            ' starts ' +
            _cmTermDay(b.starts_on) +
            '.',
        };
    }
    return null;
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

  /* Typing in a date or a name redraws only what depends on it, so the
     field keeps its focus: the footer, Save, the marked row, the year strip
     and the saved-reports notice. */
  function _cmTermRefreshFooter(cid) {
    var foot = document.getElementById('cm-term-foot-' + cid);
    if (foot) foot.innerHTML = _cmTermFooterHtml(cid);
    var saveEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('cm-term-save-' + cid));
    if (saveEl) saveEl.disabled = !_cmTermCanSave(cid);
    var rows = _cmTermRows(cid).rows;
    var problem = _cmTermRowProblem(rows);
    rows.forEach(function (_r, i) {
      var rowEl = document.getElementById('cm-term-row-' + cid + '-' + i);
      if (!rowEl || !rowEl.classList || !rowEl.querySelectorAll) return;
      var bad = !!problem && problem.idx === i;
      rowEl.classList.toggle('cm-term-row-bad', bad);
      rowEl.querySelectorAll('[data-field]').forEach(function (inp) {
        inp.classList.toggle(
          'cm-term-input-bad',
          !!problem && bad && /** @type {HTMLElement} */ (inp).dataset.field === problem.field,
        );
      });
      var msg = document.getElementById('cm-term-row-msg-' + cid + '-' + i);
      if (msg) msg.textContent = problem && bad ? problem.text : '';
    });
    var strip = document.getElementById('cm-term-strip-' + cid);
    if (strip) strip.innerHTML = _cmTermStripHtml(rows);
    var kept = document.getElementById('cm-term-kept-' + cid);
    if (kept) kept.innerHTML = _cmTermKeptHtml(cid);
    if (_isDraft(cid) && _draft) _draft.changed();
  }

  /* ── The year strip ─────────────────────────────────────────
     Each term drawn across the school year (Sep to Jun, wider when a term
     runs past it), so an overlap or a gap is seen while typing. */
  function _cmDayNum(iso) {
    return Math.round(Date.parse(iso + 'T12:00:00Z') / 86400000);
  }
  // A position on the strip as CSS percent text (CSS takes any decimals). Not a grade.
  function _cmStripPos(x) {
    return String(x);
  }
  // html-safe: labels go through esc; positions and month names are computed numbers and fixed text.
  function _cmTermStripHtml(rows) {
    var good = (rows || []).filter(function (r) {
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(r.starts_on || '') &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.ends_on || '') &&
        r.starts_on <= r.ends_on
      );
    });
    if (!good.length) return '';
    var firstStart = good
      .map(function (r) {
        return r.starts_on;
      })
      .sort()[0];
    var y = parseInt(firstStart.slice(0, 4), 10);
    if (parseInt(firstStart.slice(5, 7), 10) < 8) y -= 1;
    var from = Math.min(_cmDayNum(y + '-09-01'), _cmDayNum(firstStart));
    var to = Math.max.apply(
      null,
      [_cmDayNum(y + 1 + '-06-30')].concat(
        good.map(function (r) {
          return _cmDayNum(r.ends_on);
        }),
      ),
    );
    var span = to - from + 1;
    var pct = function (d) {
      return ((Math.max(from, Math.min(to + 1, d)) - from) / span) * 100;
    };
    var html = '<div class="cm-term-strip-bar">';
    good.forEach(function (r) {
      var l = pct(_cmDayNum(r.starts_on));
      var w = pct(_cmDayNum(r.ends_on) + 1) - l;
      html +=
        '<span class="cm-term-strip-term" style="left:' +
        _cmStripPos(l) +
        '%;width:' +
        _cmStripPos(w) +
        '%" title="' +
        esc(r.label + ': ' + _cmTermDay(r.starts_on) + ' – ' + _cmTermDay(r.ends_on)) +
        '">' +
        esc(r.label) +
        '</span>';
    });
    // Where two terms share days, a red mark.
    var sorted = good.slice().sort(function (a, b) {
      return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0;
    });
    for (var i = 1; i < sorted.length; i++) {
      for (var k = 0; k < i; k++) {
        if (sorted[i].starts_on <= sorted[k].ends_on) {
          var ol = pct(_cmDayNum(sorted[i].starts_on));
          var oe = pct(_cmDayNum(sorted[k].ends_on < sorted[i].ends_on ? sorted[k].ends_on : sorted[i].ends_on) + 1);
          html +=
            '<span class="cm-term-strip-overlap" style="left:' +
            _cmStripPos(ol) +
            '%;width:' +
            _cmStripPos(Math.max(0.6, oe - ol)) +
            '%"></span>';
        }
      }
    }
    html += '</div><div class="cm-term-strip-months" aria-hidden="true">';
    var months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    months.forEach(function (m, i) {
      var mm = ((i + 8) % 12) + 1;
      var yy = mm >= 9 ? y : y + 1;
      var d = _cmDayNum(yy + '-' + (mm < 10 ? '0' : '') + mm + '-01');
      if (d < from || d > to) return;
      html += '<span style="left:' + _cmStripPos(pct(d)) + '%">' + m + '</span>';
    });
    return html + '</div>';
  }

  /* ── Saved reports stay with their number ──────────────────
     A term rating (the Term Questionnaire's ratings and comment) is saved
     under its report number, not its dates (term_rating.term). Changing
     dates keeps every one. A number the new terms leave out keeps its
     reports on the server, hidden until the class has that term again. */
  function _cmTermSavedReportCounts(cid) {
    var counts = {};
    var all = typeof getTermRatings === 'function' ? getTermRatings(cid) || {} : {};
    Object.keys(all).forEach(function (sid) {
      Object.keys(all[sid] || {}).forEach(function (t) {
        var n = Number(t);
        if (Number.isInteger(n) && n >= 1 && n <= 6 && all[sid][t]) counts[n] = (counts[n] || 0) + 1;
      });
    });
    return counts;
  }

  // html-safe: counts and term numbers are numbers; labels go through esc.
  function _cmTermKeptHtml(cid) {
    var counts = _cmTermSavedReportCounts(cid);
    var draft = normalizeTermOrdinals(_cmTermRows(cid).rows);
    var saved = _cmSaved(cid);
    var lines = [];
    Object.keys(counts).forEach(function (k) {
      var n = Number(k);
      var now = draft.find(function (t) {
        return t.ordinal === n;
      });
      var was = saved.find(function (t) {
        return t.ordinal === n;
      });
      var reports = counts[n] + (counts[n] === 1 ? ' saved report' : ' saved reports');
      if (!now) {
        lines.push(
          'Report ' +
            n +
            ' has ' +
            reports +
            '. They stay saved and come back if this class has a Term ' +
            n +
            ' again.',
        );
      } else if (was && (now.ends_on < was.starts_on || now.starts_on > was.ends_on)) {
        lines.push(
          'Report ' +
            n +
            '’s ' +
            reports +
            (counts[n] === 1 ? ' was' : ' were') +
            ' written for ' +
            _cmTermDay(was.starts_on) +
            ' – ' +
            _cmTermDay(was.ends_on) +
            '. They will show under ' +
            (now.label || 'Term ' + n) +
            ' (' +
            _cmTermDay(now.starts_on) +
            ' – ' +
            _cmTermDay(now.ends_on) +
            ').',
        );
      }
    });
    if (!lines.length) return '';
    return (
      '<div class="cm-term-kept">' +
      lines
        .map(function (l) {
          return '<div>' + esc(l) + '</div>';
        })
        .join('') +
      '</div>'
    );
  }

  // The Surrey secondary school whose published dates fill the rows
  // (shared/reporting-term-presets.js), or another of the teacher's
  // classes ('class:<id>'), per class: what the teacher just picked, else
  // the school whose dates the class has, else 'own' for the class's own
  // dates, else Grandview Heights. Cancel, Save and leaving the tab drop
  // the pick.
  var _cmTermSchool = {};

  function _cmTermSchoolId(cid) {
    if (cid && _cmTermSchool[cid]) return _cmTermSchool[cid];
    var rows = cid ? _cmTermRows(cid).rows : [];
    var match =
      typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(normalizeTermOrdinals(rows)) : null;
    if (match) return match.school.id;
    if (rows.length) return 'own';
    return typeof REPORTING_TERM_PRESETS !== 'undefined' ? REPORTING_TERM_PRESETS.defaultSchool : null;
  }

  function _cmTermSignature(terms) {
    return normalizeTermOrdinals(terms)
      .map(function (t) {
        return t.ordinal + '|' + t.label + '|' + t.starts_on + '|' + t.ends_on;
      })
      .join(';');
  }

  // The teacher's other classes that are not archived, in class-list order.
  function _cmTermOtherClasses(cid) {
    return Object.keys(typeof COURSES !== 'undefined' && COURSES ? COURSES : {}).filter(function (c) {
      return c !== cid && !(typeof isCourseArchived === 'function' && isCourseArchived(c));
    });
  }

  /* Your Classes in Dates From: each set of the teacher's own dates another
     class has (not a school's, which the school stands for), listed once
     with the classes that share it. */
  function _cmTermOwnSets(cid) {
    var mine = _cmTermSignature(_cmSaved(cid));
    var seen = {};
    var sets = [];
    _cmTermOtherClasses(cid).forEach(function (c) {
      var terms = getReportingTerms(c);
      if (!terms.length) return;
      if (typeof reportingTermsSchoolMatch === 'function' && reportingTermsSchoolMatch(terms)) return;
      var sig = _cmTermSignature(terms);
      if (sig === mine) return;
      if (seen[sig]) {
        seen[sig].also.push(c);
        return;
      }
      seen[sig] = { cid: c, terms: normalizeTermOrdinals(terms), also: [] };
      sets.push(seen[sig]);
    });
    return sets;
  }

  function _cmClassName(c) {
    var course = typeof COURSES !== 'undefined' && COURSES ? COURSES[c] : null;
    if (!course) return 'Another class';
    return typeof courseDisplayName === 'function' ? courseDisplayName(course) : course.name || 'Another class';
  }

  // The chosen school's or class's terms for this class's span, or null.
  function _cmTermSchoolRows(cid) {
    var chosen = _cmTermSchoolId(cid);
    if (chosen === 'own') return null;
    if (chosen && chosen.indexOf('class:') === 0) {
      var terms = getReportingTerms(chosen.slice(6));
      return terms.length ? normalizeTermOrdinals(terms) : null;
    }
    if (typeof reportingTermPreset !== 'function') return null;
    var full = reportingTermPreset(chosen, courseToday(cid));
    if (!full) return null;
    return termsInSpan(full, _cmTermRows(cid).span, semesterTwoStart(full));
  }

  // html-safe: every name, id and date goes through esc.
  function _cmRenderSchoolPreset(cid, hasRows) {
    var schools = typeof reportingTermSchools === 'function' ? reportingTermSchools() : [];
    var chosen = _cmTermSchoolId(cid);
    var fromClass = !!chosen && chosen.indexOf('class:') === 0;
    var own = _cmTermOwnSets(cid);
    var school = schools.find(function (s) {
      return s.id === chosen;
    });
    var available = fromClass
      ? !!_cmTermSchoolRows(cid)
      : !!school && typeof reportingTermPreset === 'function' && !!reportingTermPreset(chosen, courseToday(cid));
    var opt = function (value, label) {
      return (
        '<option value="' + esc(value) + '"' + (value === chosen ? ' selected' : '') + '>' + esc(label) + '</option>'
      );
    };
    var html = '<div class="cm-term-school">';
    html +=
      '<label class="cm-term-school-label" for="cm-term-school-' +
      cid +
      '">Dates From</label>' +
      '<select class="cm-input cm-term-school-select" id="cm-term-school-' +
      cid +
      '" data-action-change="cmTermSchool">';
    if (chosen === 'own') html += opt('own', 'Your Own Dates');
    if (own.length) {
      html +=
        '<optgroup label="Your Classes">' +
        own
          .map(function (s) {
            var t = s.terms;
            var label =
              _cmClassName(s.cid) +
              (s.also.length ? ' and ' + s.also.length + ' more' : '') +
              ' (' +
              t.length +
              (t.length === 1 ? ' term, ' : ' terms, ') +
              _cmTermDay(t[0].starts_on) +
              ' – ' +
              _cmTermDay(t[t.length - 1].ends_on) +
              ')';
            return opt('class:' + s.cid, label);
          })
          .join('') +
        '</optgroup><optgroup label="Surrey Schools">';
    }
    html += schools
      .map(function (s) {
        return opt(s.id, s.name);
      })
      .join('');
    if (own.length) html += '</optgroup>';
    html += '</select>';
    if (available) {
      html +=
        '<button class="btn btn-primary cm-term-school-btn" data-action="cmTermSchoolPreset">' +
        (fromClass ? 'Use These Dates' : hasRows ? 'Replace With This School’s Dates' : 'Use This School’s Dates') +
        '</button>';
    }
    html +=
      '<button type="button" class="cm-term-new" data-action="cmTermNew">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"></path></svg>' +
      'Create New</button>';
    html += '</div>';
    // A school or class picked from the menu shows its dates before they
    // replace the class's.
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
        esc(fromClass ? _cmClassName(chosen.slice(6)) : school ? school.name : '') +
        ': ' +
        preview
          .map(function (t) {
            return esc(t.label + ' ' + _cmTermDay(t.starts_on) + ' – ' + _cmTermDay(t.ends_on));
          })
          .join(' · ') +
        '</div>';
    }
    if (school && !available && typeof REPORTING_TERM_PRESETS !== 'undefined') {
      html +=
        '<div class="cm-hint">School dates are loaded for ' +
        esc(REPORTING_TERM_PRESETS.schoolYear) +
        ' only. Use Create New to make your own.</div>';
    } else if (school && school.assumed) {
      html +=
        '<div class="cm-hint">' +
        esc(school.name) +
        ' has not published its semester turnaround, so Semester 2 starts Feb 1. Adjust if yours differs.</div>';
    }
    return html;
  }

  var _cmTermEditing = {}; // cid -> true while Edit Dates is open
  var _cmTermOwn = {}; // cid -> true while Create New's editor is open
  var _cmTermStart = {}; // cid -> the Start With choice: current, quarters, trimesters, semesters, blank
  var _cmTermAlso = {}; // cid -> { otherCid: true }: Also Use In

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
    // The menu offers other dates only once something else is picked.
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
            ' – ' +
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

  /* The editor is in Your Own Dates when Create New opened it, or when the
     class's rows are not a school's (typed or generic terms). */
  function _cmTermOwnMode(cid) {
    if (_cmTermOwn[cid]) return true;
    var rows = _cmTermRows(cid).rows;
    if (!rows.length) return false;
    var match =
      typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(normalizeTermOrdinals(rows)) : null;
    return !match;
  }

  var _CM_TERM_STARTS = [
    { value: 'current', label: 'This Class’s Dates' },
    { value: 'quarters', label: '4 Terms' },
    { value: 'trimesters', label: '3 Terms' },
    { value: 'semesters', label: '2 Semesters' },
    { value: 'blank', label: 'Blank' },
  ];

  // html-safe: values and labels are the fixed list above; the draft's label goes through esc.
  function _cmRenderTermStart(cid) {
    var on = _cmTermStart[cid] || 'current';
    var current = _draft && cid === _draft.key ? _draft.currentLabel() : '';
    var choices = _CM_TERM_STARTS.filter(function (c) {
      return c.value !== 'current' || _cmSaved(cid).length;
    });
    return (
      '<div class="cm-term-start" role="group" aria-label="Start With"><span class="cm-term-span-label">Start With</span>' +
      choices
        .map(function (c) {
          return (
            '<button type="button" class="cm-term-chip' +
            (c.value === on ? ' active' : '') +
            '" aria-pressed="' +
            (c.value === on) +
            '" data-action="cmTermPreset" data-value="' +
            c.value +
            '">' +
            esc((c.value === 'current' && current) || c.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // html-safe: class names go through esc; ids are the course keys, escaped.
  function _cmRenderTermAlso(cid) {
    var others = _isDraft(cid) ? [] : _cmTermOtherClasses(cid);
    if (!others.length) return '';
    var picked = _cmTermAlso[cid] || {};
    return (
      '<div class="cm-term-also" role="group" aria-label="Also Use In"><span class="cm-term-span-label">Also Use In</span>' +
      others
        .map(function (c) {
          var on = !!picked[c];
          return (
            '<button type="button" class="cm-term-chip' +
            (on ? ' active' : '') +
            '" aria-pressed="' +
            on +
            '" data-action="cmTermAlso" data-cid="' +
            esc(c) +
            '">' +
            (on ? '✓ ' : '') +
            esc(_cmClassName(c)) +
            '</button>'
          );
        })
        .join('') +
      (Object.keys(picked).some(function (c) {
        return picked[c];
      })
        ? '<div class="cm-hint cm-term-also-hint">Save gives those classes these terms too. Their saved reports stay with their report numbers.</div>'
        : '') +
      '</div>'
    );
  }

  function _cmRenderReportingTermsField(cid) {
    if (!cid) return '';
    var st = _cmTermRows(cid);
    var rows = st.rows;
    if (rows.length && !st.dirty && !_cmTermEditing[cid] && !_cmTermOwn[cid]) return _cmRenderTermTiles(cid);
    var own = _cmTermOwnMode(cid);
    var html = '<div class="cm-field cm-cat-field">';
    if (own) {
      html +=
        '<div class="cm-term-own-head"><h3 class="cm-term-own-title">Your Own Dates</h3>' +
        '<span class="cm-hint">Name each term and give it a start and an end. Up to six.</span></div>';
      html += _cmRenderTermStart(cid);
      // A generic layout still runs Full Year or one semester.
      html += _cmRenderTermSpan(cid);
    } else {
      html +=
        (_isDraft(cid) ? '' : '<label class="cm-label">Reporting Terms</label>') +
        '<div class="cm-hint" style="margin-bottom:8px">Each term is a report date. Grades build all year: a report shows the year to date as of its term’s end. Up to six. Surrey secondary dates come from each school’s published calendar; a term ends on the day its report is published.</div>';
      html += _cmRenderTermSpan(cid);
      html += _cmRenderSchoolPreset(cid, rows.length > 0);
    }
    var problem = _cmTermRowProblem(rows);
    html += '<div class="cm-cat-list">';
    rows.forEach(function (row, idx) {
      var bad = !!problem && problem.idx === idx;
      var badOn = function (field) {
        return problem && bad && problem.field === field ? ' cm-term-input-bad' : '';
      };
      html +=
        '<div class="cm-term-row-wrap' +
        (bad ? ' cm-term-row-bad' : '') +
        '" id="cm-term-row-' +
        cid +
        '-' +
        idx +
        '">' +
        '<div class="cm-cat-row cm-term-row">' +
        '<input class="cm-input cm-term-label' +
        badOn('label') +
        '" value="' +
        esc(row.label) +
        '" placeholder="Term name" data-action-input="cmTermLive" data-field="label" data-idx="' +
        idx +
        '" aria-label="Term name">' +
        '<input class="cm-input cm-term-date' +
        badOn('starts_on') +
        '" type="date" value="' +
        esc(row.starts_on) +
        '" data-action-input="cmTermLive" data-field="starts_on" data-idx="' +
        idx +
        '" aria-label="Start date">' +
        '<span class="cm-cat-pct">to</span>' +
        '<input class="cm-input cm-term-date' +
        badOn('ends_on') +
        '" type="date" value="' +
        esc(row.ends_on) +
        '" data-action-input="cmTermLive" data-field="ends_on" data-idx="' +
        idx +
        '" aria-label="End date">' +
        '<button class="cm-delete-mini" data-action="cmTermDelete" data-idx="' +
        idx +
        '" title="Remove term" aria-label="Remove term">✕</button>' +
        '</div>' +
        '<div class="cm-term-row-msg" id="cm-term-row-msg-' +
        cid +
        '-' +
        idx +
        '" aria-live="polite">' +
        (problem && bad ? esc(problem.text) : '') +
        '</div>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="cm-term-strip" id="cm-term-strip-' + cid + '">' + _cmTermStripHtml(rows) + '</div>';
    html += '<div id="cm-term-kept-' + cid + '">' + _cmTermKeptHtml(cid) + '</div>';
    if (rows.length) html += _cmRenderTermAlso(cid);
    html +=
      '<div class="cm-cat-footer">' +
      ((rows.length || own) && rows.length < REPORTING_TERMS_MAX
        ? '<button class="cm-add-link" data-action="cmTermAdd">+ Add Term</button>'
        : '<span></span>') +
      '<div id="cm-term-foot-' +
      cid +
      '">' +
      _cmTermFooterHtml(cid) +
      '</div>' +
      _cmTermSaveBtn(cid) +
      '</div>' +
      (_cmSaved(cid).length || _cmTermOwn[cid] || st.dirty
        ? '<button type="button" class="cm-add-link cm-term-cancel" data-action="cmTermCancel">Cancel</button>'
        : '') +
      '</div>';
    return html;
  }

  // Save Terms. The class being made has none: Create Class saves its terms.
  function _cmTermSaveBtn(cid) {
    if (_isDraft(cid)) return '';
    var off = _cmTermCanSave(cid) ? '' : ' disabled';
    return (
      '<button class="btn btn-primary cm-cat-save" id="cm-term-save-' +
      cid +
      '" data-action="cmTermSave"' +
      off +
      '>Save Terms</button>'
    );
  }

  function cmTermEdit() {
    if (!cmSelectedCourse) return;
    if (_draft && cmSelectedCourse === _draft.key) _draft.opening();
    // A class on its own dates edits them as Your Own Dates, even once
    // every row is removed.
    if (_cmTermOwnMode(cmSelectedCourse)) _cmTermOwn[cmSelectedCourse] = true;
    _cmTermEditing[cmSelectedCourse] = true;
    renderClassManager();
  }

  function _cmTermForget(cid) {
    delete _cmTermState[cid];
    delete _cmTermSchool[cid];
    delete _cmTermOwn[cid];
    delete _cmTermStart[cid];
    delete _cmTermAlso[cid];
    _cmTermEditing[cid] = false;
  }

  // Cancel drops unsaved edits and goes back to the tiles.
  function cmTermCancel() {
    if (!cmSelectedCourse) return;
    _cmTermForget(cmSelectedCourse);
    if (_draft && cmSelectedCourse === _draft.key) _draft.restore();
    renderClassManager();
  }

  /* Create New: the teacher's own terms, starting from a copy of the
     class's dates (the school's, for most), or 4 Terms when it has none. */
  function cmTermNew() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    if (_draft && cid === _draft.key) _draft.opening(true);
    _cmTermOwn[cid] = true;
    _cmTermEditing[cid] = true;
    delete _cmTermSchool[cid];
    _cmTermUseStart(cid, _cmSaved(cid).length ? 'current' : 'quarters');
    renderClassManager();
  }

  function _cmTermUseStart(cid, name) {
    var st = _cmTermRows(cid);
    var saved = _cmSaved(cid);
    _cmTermStart[cid] = name;
    if (name === 'current') {
      st.rows = saved.map(function (t) {
        return { ordinal: t.ordinal, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on };
      });
    } else if (name === 'blank') {
      st.rows = [{ label: 'Term 1', starts_on: '', ends_on: '' }];
    } else {
      var full = _cmTermPresetRows(cid, name);
      st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    }
    var template = st.rows.length ? _cmTermTemplate(cid, st.rows) : null;
    st.span = template ? termSpanOf(st.rows, semesterTwoStart(template)) : 'full';
    st.dirty = _cmTermSignature(st.rows) !== _cmTermSignature(saved);
  }

  /* "This class runs": Full year, Semester 1 or Semester 2. A semester class
     carries only that semester's terms and keeps their school numbers. */
  function _cmRenderTermSpan(cid) {
    var st = _cmTermRows(cid);
    // Typed terms are the class's own; the choice is for preset terms. New
    // Class has its own This Class Runs, which drives the draft's span.
    if (_isDraft(cid) || (st.rows.length > 0 && !_cmTermTemplate(cid, st.rows))) return '';
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

  /* A generic layout fills the rows: Quarters, Trimesters, Semesters, or
     in Your Own Dates any Start With choice (which ignores the span). */
  function cmTermPreset(name) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    if (_cmTermOwnMode(cid) && (name === 'current' || name === 'blank' || _CM_TERM_PRESETS[name])) {
      _cmTermUseStart(cid, name);
      renderClassManager();
      return;
    }
    if (!_CM_TERM_PRESETS[name]) return;
    var st = _cmTermRows(cid);
    var full = _cmTermPresetRows(cid, name);
    st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    st.dirty = true;
    renderClassManager();
  }

  /* Make another class's data available without switching to it, as
     Copy Grading Setup does. */
  function _cmTermLoadClass(c) {
    if (typeof initData !== 'function') return Promise.resolve();
    return Promise.resolve(initData(c)).catch(function (e) {
      console.warn('Could not load class for its terms:', c, e);
    });
  }

  function cmTermSchool(id) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    if (id) _cmTermSchool[cid] = id;
    else delete _cmTermSchool[cid];
    renderClassManager();
    // Another class's dates: read them fresh from the server before they
    // can be used, then show them again.
    if (id && id.indexOf('class:') === 0) {
      _cmTermLoadClass(id.slice(6)).then(function () {
        if (_cmTermSchool[cid] === id) renderClassManager();
      });
    }
  }

  function cmTermSchoolPreset() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var chosen = _cmTermSchoolId(cid);
    var st = _cmTermRows(cid);
    if (chosen && chosen.indexOf('class:') === 0) {
      var from = _cmTermSchoolRows(cid);
      if (!from) return;
      st.rows = from.map(function (r) {
        return { ordinal: r.ordinal, label: r.label, starts_on: r.starts_on, ends_on: r.ends_on };
      });
      st.span = 'full';
      st.dirty = true;
      _cmTermOwn[cid] = true;
      delete _cmTermSchool[cid];
      renderClassManager();
      return;
    }
    if (typeof reportingTermPreset !== 'function') return;
    var rows = reportingTermPreset(chosen, courseToday(cid));
    if (!rows) return;
    var full = rows.map(function (r) {
      return { ordinal: r.ordinal, label: r.label, starts_on: r.starts_on, ends_on: r.ends_on };
    });
    st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    st.dirty = true;
    delete _cmTermOwn[cid];
    renderClassManager();
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

  function cmTermAlso(otherCid) {
    if (!cmSelectedCourse || !otherCid || otherCid === cmSelectedCourse) return;
    var picked = (_cmTermAlso[cmSelectedCourse] = _cmTermAlso[cmSelectedCourse] || {});
    if (picked[otherCid]) delete picked[otherCid];
    else picked[otherCid] = true;
    // Also Use In is a change to save even when this class's dates are not.
    renderClassManager();
  }

  function _cmTermAlsoPicked(cid) {
    var picked = _cmTermAlso[cid] || {};
    return _cmTermOtherClasses(cid).filter(function (c) {
      return picked[c];
    });
  }

  /* Save this class's terms, then the same terms in each class picked under
     Also Use In, each loaded first so its save sends only the terms.
     Resolves once every class is saved. */
  function cmTermSave() {
    if (!cmSelectedCourse) return Promise.resolve();
    var cid = cmSelectedCourse;
    var st = _cmTermRows(cid);
    var also = _cmTermAlsoPicked(cid);
    if (_cmTermError(cid) || (!st.dirty && !also.length)) return Promise.resolve();
    var rows = st.rows.map(function (r) {
      return Object.assign({}, r);
    });
    var err = saveReportingTerms(cid, rows);
    if (err) {
      if (typeof showSyncToast === 'function') showSyncToast('Terms not saved: ' + err, 'error');
      return Promise.resolve();
    }
    _cmTermForget(cid);
    renderClassManager();
    return also.reduce(function (p, c) {
      return p.then(function () {
        return _cmTermLoadClass(c).then(function () {
          delete _cmTermState[c];
          saveReportingTerms(c, rows);
        });
      });
    }, Promise.resolve());
  }

  /* Every cmTerm* click from DashClassManager.handleAction. True when
     handled. */
  function handleAction(action, el) {
    var ds = (el && el.dataset) || {};
    var map = {
      cmTermSpan: function () {
        cmTermSpan(ds.value);
      },
      cmTermPreset: function () {
        cmTermPreset(ds.value);
      },
      cmTermSchoolPreset: cmTermSchoolPreset,
      cmTermAdd: cmTermAdd,
      cmTermDelete: function () {
        cmTermDelete(parseInt(ds.idx, 10));
      },
      cmTermEdit: cmTermEdit,
      cmTermNew: cmTermNew,
      cmTermCancel: cmTermCancel,
      cmTermSave: cmTermSave,
      cmTermAlso: function () {
        cmTermAlso(ds.cid);
      },
    };
    if (!map[action]) return false;
    map[action]();
    return true;
  }

  /* Leaving the tab drops a school or class picked but not used. */
  function forgetPick(cid) {
    if (cid) delete _cmTermSchool[cid];
  }

  /* Tests start each case from nothing. */
  function reset() {
    [_cmTermState, _cmTermSchool, _cmTermEditing, _cmTermOwn, _cmTermStart, _cmTermAlso].forEach(function (o) {
      Object.keys(o).forEach(function (k) {
        delete o[k];
      });
    });
  }

  return {
    configure: configure,
    _cmTermState: _cmTermState,
    _cmTermSchool: _cmTermSchool,
    _cmTermOwn: _cmTermOwn,
    _cmTermEditing: _cmTermEditing,
    _cmTermStart: _cmTermStart,
    _cmTermRows: _entry(_cmTermRows),
    _cmTermError: _entry(_cmTermError),
    _cmTermDay: _entry(_cmTermDay),
    useDraft: useDraft,
    forget: _cmTermForget,
    _cmRenderReportingTermsField: _entry(_cmRenderReportingTermsField),
    handleAction: _entry(handleAction),
    forgetPick: forgetPick,
    reset: reset,
    rowProblem: _cmTermRowProblem,
    stripHtml: _cmTermStripHtml,
    keptHtml: _entry(_cmTermKeptHtml),
    cmTermEdit: _entry(cmTermEdit),
    cmTermNew: _entry(cmTermNew),
    cmTermCancel: _entry(cmTermCancel),
    cmTermSpan: _entry(cmTermSpan),
    cmTermPreset: _entry(cmTermPreset),
    cmTermSchool: _entry(cmTermSchool),
    cmTermSchoolPreset: _entry(cmTermSchoolPreset),
    cmTermAdd: _entry(cmTermAdd),
    cmTermDelete: _entry(cmTermDelete),
    cmTermLive: _entry(cmTermLive),
    cmTermAlso: _entry(cmTermAlso),
    cmTermSave: _entry(cmTermSave),
  };
})();
