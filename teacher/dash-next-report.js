// @ts-check
/* dash-next-report.js — the glance row's fourth card, Next Report (Colin,
   Nov 26 2026, in place of Upcoming Birthdays): the class's next report that
   has not ended, how many of its comments are approved, and when it ends. It
   opens Write Comments. The report is the class's reporting term (its school's
   report name when the class is on a school's dates), the same list the
   Reports page's picker shows; a comment counts as ready when it is approved
   on Write Comments for that term (term-N). */
window.DashNextReport = (function () {
  'use strict';

  /** The term the next report is for: the first that has not ended, else the
   * last; null with no terms set. @param {string} cid */
  function nextTerm(cid) {
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    if (!terms.length) return null;
    var today = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
    var names = typeof reportingTermReportNames === 'function' ? reportingTermReportNames(terms) : null;
    var i = terms.findIndex(function (/** @type {any} */ t) {
      return String(t.ends_on || '') >= today;
    });
    var ended = i < 0;
    if (ended) i = terms.length - 1;
    var t = terms[i];
    return {
      ordinal: t.ordinal,
      label: (names && names[i]) || t.label || 'Report ' + t.ordinal,
      ends: String(t.ends_on || ''),
      ended: ended,
    };
  }

  /** "Wed, Jun 30" for a stored YYYY-MM-DD. @param {string} ymd */
  function day(ymd) {
    var p = ymd.split('-').map(Number);
    if (p.length !== 3 || !p[0]) return '';
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  /** How many of these students have an approved comment for the term.
   * @param {string} cid @param {any[]} students @param {number} ordinal */
  function ready(cid, students, ordinal) {
    var termId = 'term-' + ordinal;
    return students.filter(function (s) {
      var r = typeof getStudentTermRating === 'function' ? getStudentTermRating(cid, s.id, termId) : null;
      return !!(r && r.approvedAt);
    }).length;
  }

  /** The card. @param {string} cid @param {any[]} students */
  // html-safe: the report's name and the date esc()'d; the rest numbers and fixed words
  function html(cid, students) {
    var t = nextTerm(cid);
    var total = students.length;
    var done = t ? ready(cid, students, t.ordinal) : 0;
    var when = t && t.ends ? (t.ended ? ' · ended ' : ' · ends ') + day(t.ends) : '';
    var sub = t ? '<b>' + esc(t.label) + '</b>' + esc(when) : 'No report dates set';
    var pct = total ? (done / total) * 100 : 0;
    return (
      '<a class="dash-glance-cell dash-glance-next" role="link" tabindex="0" data-href="' +
      esc('/reports?course=' + (cid || '') + '&tab=questionnaire') +
      '" aria-label="' +
      esc(
        'Next report: ' +
          done +
          ' of ' +
          total +
          ' comments ready' +
          (t ? ', ' + t.label : '') +
          ': open Write Comments',
      ) +
      '"><span class="dash-glance-label">Next Report</span>' +
      '<span class="dash-glance-value">' +
      (t ? done : '—') +
      (t ? '<span class="dash-glance-word">of ' + total + ' ready</span>' : '') +
      '</span>' +
      '<span class="dash-glance-bar" aria-hidden="true"><span style="width:' +
      pct +
      '%"></span></span>' +
      '<span class="dash-glance-sub">' +
      sub +
      '</span></a>'
    );
  }

  return { html: html, nextTerm: nextTerm };
})();
