// @ts-check
/* dash-inbox-model.js — what the Dashboard's Inbox shows, with no HTML and no
   DOM (D4 of docs/plans/dashboard-inbox-plan.md). From the class's work
   (getCourseSubmissions) and GraderWork alone.

   Every count is GraderWork's: to grade, to return, returned and not in come
   from workCounts, in from workInIds. This file writes no rule for any of
   them, so the rows' to-grade add up to GraderWork.classWorkCounts, the
   number the top bar's To Grade shows. What it adds is sorting and
   tallying of lists GraderWork made, and the work's own marks (who sent it,
   paper, late, pages, when).

   build(cid, { seen }) gives:
     pieces   every piece with work in, work waiting or taking work, each
              { aid, title, in, tograde, toreturn, returned, notin, late,
                onPaper, addedByTeacher, newCount, newest, pages, gradeOrder,
                at, taking, closesOn }
     rows     what the tile draws, four at most: the pieces with work to
              grade, newest work first, then pieces taking work with nothing
              in yet
     fold     the pieces with work to grade that the four rows leave out
     caughtUp nothing to grade in the class
     takingWork  pieces taking work with nothing in yet
     toGrade  the class's total, GraderWork's own
   "New" is a student's own send (sent_by 'student') after `seen`, the time
   kept on this device. Work the teacher added is never new; it is counted
   as addedByTeacher. */
window.DashInboxModel = (function () {
  'use strict';

  var MAX_ROWS = 4;
  // Pages a row pictures: the picture row has room for three.
  var MAX_PICS = 3;
  var NEWEST = 3;
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

  /** @param {string} a @param {string} b */
  function _later(a, b) {
    return Date.parse(a) > Date.parse(b);
  }

  /** The pages of a submission, in page order.
   * @param {any} s */
  function _files(s) {
    return (Array.isArray(s && s.files) ? s.files : [])
      .filter(function (/** @type {any} */ f) {
        return !!f;
      })
      .slice()
      .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return (x.page || 0) - (y.page || 0);
      });
  }

  /** When the piece stops taking work: a day (YYYY-MM-DD) or '' with no end.
   * @param {string} cid @param {any} a */
  function _closes(cid, a) {
    var win = /** @type {any} */ (window)._studentWorkWindow;
    if (typeof win !== 'function' || typeof getAssessmentStudentWork !== 'function') return { open: true, closes: '' };
    var w = win(cid, a, getAssessmentStudentWork(cid, a.id));
    return { open: !!w.open, closes: w.closes_on || '' };
  }

  /** @param {string} cid
   * @param {{ seen?: string | null }} [opts]
   * @returns {any} */
  function build(cid, opts) {
    var GW = _gw();
    /** @type {any} */
    var out = {
      on: false,
      pieces: [],
      rows: [],
      fold: null,
      caughtUp: false,
      takingWork: [],
      toGrade: 0,
    };
    if (!cid || !GW || !GW.workOnInClass(cid)) return out;
    out.on = true;
    var seen = (opts && opts.seen) || null;
    var students = getStudents(cid) || [];
    var ids = students.map(function (s) {
      return s.id;
    });
    /** @type {Record<string, any>} */
    var byId = {};
    students.forEach(function (s) {
      byId[s.id] = s;
    });

    // The newest version of each student's work on each piece, as the
    // readers choose it: the highest version; of two alike, the first stored.
    /** @type {Record<string, any>} */
    var newest = {};
    getCourseSubmissions(cid).submissions.forEach(function (/** @type {any} */ s) {
      if (!s || !byId[s.enrollment_id]) return;
      var key = s.assessment_id + '|' + s.enrollment_id;
      if (!newest[key] || (s.version || 1) > (newest[key].version || 1)) newest[key] = s;
    });
    /** @type {Record<string, any[]>} */
    var subsOf = {};
    Object.keys(newest).forEach(function (k) {
      var s = newest[k];
      (subsOf[s.assessment_id] = subsOf[s.assessment_id] || []).push(s);
    });

    var assessments = getAssessments(cid) || [];
    assessments.forEach(function (/** @type {any} */ a) {
      if (!a || !a.id || (typeof isDibelsScored === 'function' && isDibelsScored(a))) return;
      var counts = GW.workCounts(cid, a.id, ids);
      out.toGrade += counts.tograde;
      var inn = GW.workInIds(cid, a.id, ids).length;
      var win = GW.workOn(cid, a) && !inn ? _closes(cid, a) : null;
      var taking = !!win && win.open;
      if (!inn && !counts.tograde && !counts.toreturn && !taking) return;

      var subs = (subsOf[a.id] || []).slice().sort(function (x, y) {
        return _later(_at(x), _at(y)) ? -1 : _later(_at(y), _at(x)) ? 1 : 0;
      });
      var late = 0;
      var onPaper = 0;
      var added = 0;
      var fresh = 0;
      var students_ = 0;
      subs.forEach(function (s) {
        if (s.is_late) late++;
        if (s.on_paper) onPaper++;
        if (s.sent_by === 'teacher') added++;
        else if (s.sent_by === 'student') {
          students_++;
          if (!seen || _later(String(s.sent_at || ''), seen)) fresh++;
        }
      });
      var pages = [];
      for (var i = 0; i < subs.length && pages.length < MAX_PICS; i++) {
        var f = _files(subs[i])[0];
        if (!f && !subs[i].on_paper) continue;
        pages.push({
          sid: subs[i].enrollment_id,
          name: displayName(byId[subs[i].enrollment_id]),
          file: f || null,
          paper: !f,
        });
      }
      // To grade, in the order the work came in: GraderWork's own list of
      // students, sorted by when each one's work was sent. A student whose
      // work is a group-mate's has none of their own, and follows.
      var when = /** @type {Record<string, string>} */ ({});
      ids.forEach(function (sid) {
        var s = newest[a.id + '|' + sid];
        if (s) when[sid] = _at(s);
      });
      var order = counts.ids.tograde.slice().sort(function (/** @type {string} */ x, /** @type {string} */ y) {
        var p = when[x];
        var q = when[y];
        if (p && q) return Date.parse(p) - Date.parse(q);
        return p ? -1 : q ? 1 : 0;
      });
      out.pieces.push({
        aid: a.id,
        title: String(a.title || 'Untitled'),
        date: String(a.dateAssigned || a.date || ''),
        in: inn,
        tograde: counts.tograde,
        toreturn: counts.toreturn,
        returned: counts.returned,
        notin: counts.notin,
        late: late,
        onPaper: onPaper,
        addedByTeacher: added,
        fromStudents: students_,
        newCount: fresh,
        newest: subs.slice(0, NEWEST).map(function (s) {
          return {
            sid: s.enrollment_id,
            name: displayName(byId[s.enrollment_id]),
            at: _at(s),
            pages: (s.files || []).length,
            late: !!s.is_late,
          };
        }),
        pages: pages,
        gradeOrder: order,
        at: subs.length ? _at(subs[0]) : '',
        taking: taking,
        closesOn: taking && win ? win.closes : '',
      });
    });

    var work = out.pieces
      .filter(function (/** @type {any} */ p) {
        return p.tograde > 0;
      })
      .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return _later(x.at, y.at) ? -1 : _later(y.at, x.at) ? 1 : x.title < y.title ? -1 : 1;
      });
    // Pieces taking work with nothing in: the one dated last first.
    out.takingWork = out.pieces
      .filter(function (/** @type {any} */ p) {
        return p.taking && !p.in && !p.tograde;
      })
      .sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
      });
    out.caughtUp = out.toGrade === 0;
    var all = work.concat(out.takingWork);
    out.rows = all.slice(0, MAX_ROWS);
    var rest = all.slice(MAX_ROWS);
    if (rest.length) {
      var left = rest.filter(function (/** @type {any} */ p) {
        return p.tograde > 0;
      });
      /** @type {any} */
      var fold = {
        pieces: left.length,
        work: 0,
        tograde: 0,
        taking: rest.length - left.length,
        withStudents: [],
        youAdded: { work: 0, pieces: 0 },
      };
      left.forEach(function (/** @type {any} */ p) {
        fold.work += p.in;
        fold.tograde += p.tograde;
        if (p.fromStudents) fold.withStudents.push({ aid: p.aid, title: p.title, tograde: p.tograde });
        if (p.addedByTeacher) {
          fold.youAdded.work += p.addedByTeacher;
          fold.youAdded.pieces++;
        }
      });
      out.fold = fold;
    }
    return out;
  }

  return { build: build, SEEN_KEY: SEEN_KEY, MAX_ROWS: MAX_ROWS, MAX_PICS: MAX_PICS };
})();
