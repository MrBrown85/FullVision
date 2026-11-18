// @ts-check
/* dash-recent.js — Recent Assessments, the Dashboard's left tile while the
   Inbox (DashInbox) does not take the slot: a class with Send Work off, and
   every class until the Inbox is built (D2 of
   docs/plans/dashboard-inbox-plan.md; board E3). The class's latest
   assessments, newest first, each with how many students are assessed.
   "Assessed" is the Assignments page's own test: a student with a score or
   feedback on the piece (hasScoreOrFeedback). Nothing here works out a
   grade. Drafts are left out (getAssignedAssessments). */
window.DashRecent = (function () {
  'use strict';

  // The list scrolls inside the tile, so this is a cap, not what fits.
  var MAX_ROWS = 12;

  /** The pieces newest first: by the date assigned, then the later one in
   * the class's list first.
   * @param {string} cid
   * @returns {any[]} */
  function _newestFirst(cid) {
    var list = getAssignedAssessments(cid) || [];
    return list
      .map(function (/** @type {any} */ a, /** @type {number} */ i) {
        return { a: a, i: i, d: String((a && (a.dateAssigned || a.date)) || '') };
      })
      .filter(function (/** @type {any} */ x) {
        return x.a && x.a.id;
      })
      .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return x.d < y.d ? 1 : x.d > y.d ? -1 : y.i - x.i;
      })
      .map(function (/** @type {any} */ x) {
        return x.a;
      });
  }

  /** What the tile shows.
   * @param {string} cid
   * @param {{ id: string }[]} students
   * @returns {{ rows: { id: string, title: string, assessed: number, total: number, href: string }[], sendWorkOff: boolean }} */
  function model(cid, students) {
    var list = students || [];
    var rows = _newestFirst(cid)
      .slice(0, MAX_ROWS)
      .map(function (a) {
        var assessed = list.filter(function (st) {
          return hasScoreOrFeedback(cid, st.id, a.id);
        }).length;
        return {
          id: String(a.id),
          title: String(a.title || 'Untitled'),
          assessed: assessed,
          total: list.length,
          href: '/assignments?course=' + encodeURIComponent(cid) + '&open=' + encodeURIComponent(a.id),
        };
      });
    var sw = typeof getCourseSendWork === 'function' ? getCourseSendWork(cid) : null;
    return { rows: rows, sendWorkOff: !(sw && sw.send_work) };
  }

  /** @param {string} cid
   * @param {{ id: string }[]} students
   * @returns {string} */
  function html(cid, students) {
    var m = model(cid, students);
    var out =
      '<section class="dash-recent" aria-labelledby="dash-recent-title">' +
      '<div class="dash-section-title dash-recent-head"><h2 class="dash-recent-title" id="dash-recent-title">Recent Assessments</h2>' +
      '<a role="link" tabindex="0" data-href="' +
      esc('/assignments?course=' + encodeURIComponent(cid)) +
      '">Assignments →</a></div>';
    if (m.rows.length) {
      out += '<ul class="dash-recent-list">';
      m.rows.forEach(function (r) {
        out +=
          '<li class="dash-recent-row"><a class="dash-recent-link" role="link" tabindex="0" data-href="' +
          esc(r.href) +
          '"><span class="dash-recent-name">' +
          esc(r.title) +
          '</span><span class="dash-recent-count">' +
          esc(r.assessed + ' of ' + r.total + ' assessed') +
          '</span></a></li>';
      });
      out += '</ul>';
    } else {
      out += '<p class="dash-recent-none">No assessments in this class yet.</p>';
    }
    if (m.sendWorkOff) {
      out +=
        '<p class="dash-recent-hint">Students can send photos of their work once Send Work is on. ' +
        '<a role="link" tabindex="0" data-href="' +
        esc('/dashboard?course=' + encodeURIComponent(cid) + '&manage=student-page') +
        '">Class Settings →</a></p>';
    }
    return out + '</section>';
  }

  return { model: model, html: html, MAX_ROWS: MAX_ROWS };
})();
