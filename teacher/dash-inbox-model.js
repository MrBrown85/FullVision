// @ts-check
/* dash-inbox-model.js — what the Inbox keeps of its first model (D4 of
   docs/plans/dashboard-inbox-plan.md), now only two things, with no HTML and
   no DOM: the key under which a device keeps the time of the teacher's last
   look at a class (SEEN_KEY), and the order a student's work is graded in
   (gradeOrder). Every count is DashInboxQueue's, and so GraderWork's. */
window.DashInboxModel = (function () {
  'use strict';

  // The time of the teacher's last look, kept per class on this device.
  var SEEN_KEY = 'fv-dash-inbox-seen:';

  /** @returns {any} */
  function _gw() {
    return /** @type {any} */ (window).GraderWork || null;
  }

  /** @param {any} s */
  function _at(s) {
    return String((s && (s.sent_at || s.created_at)) || '');
  }

  /** The students to grade on one piece, in the order their work came in
   * (oldest first): GraderWork's own list, sorted by when each one's work was
   * sent. A student whose work is a pair's or group's goes by the mate's
   * send time. Asked when grading starts, not on every draw.
   * @param {string} cid @param {string} aid
   * @returns {string[]} */
  function gradeOrder(cid, aid) {
    var GW = _gw();
    if (!GW) return [];
    var ids = (getStudents(cid) || []).map(function (s) {
      return s.id;
    });
    var counts = GW.workCounts(cid, aid, ids);
    /** @type {Record<string, any>} */
    var newest = {};
    getCourseSubmissions(cid).submissions.forEach(function (/** @type {any} */ s) {
      if (!s || s.assessment_id !== aid) return;
      var key = s.enrollment_id;
      if (!newest[key] || (s.version || 1) > (newest[key].version || 1)) newest[key] = s;
    });
    var group = /** @type {any} */ (window).getGroupSubmissions;
    // A send with no time (or one that does not read as a time) goes after
    // every timed one; two of them keep the class list's order.
    /** @param {any} s */
    function time(s) {
      var t = Date.parse(_at(s));
      return isNaN(t) ? Infinity : t;
    }
    /** @param {string} sid */
    function when(sid) {
      var s = newest[sid];
      if (s) return time(s);
      var best = Infinity;
      if (typeof group === 'function')
        group(cid, sid, aid).forEach(function (/** @type {any} */ m) {
          best = Math.min(best, time(m));
        });
      return best;
    }
    return counts.ids.tograde.slice().sort(function (/** @type {string} */ x, /** @type {string} */ y) {
      var a = when(x);
      var b = when(y);
      return a === b ? 0 : a < b ? -1 : 1;
    });
  }

  return { gradeOrder: gradeOrder, SEEN_KEY: SEEN_KEY };
})();
