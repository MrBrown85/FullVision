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

   build(cid, { seen, classCounts }) gives:
     pieces   every piece with work to grade or taking work, each
              { aid, title, in, tograde, toreturn, notin, late,
                onPaper, addedByTeacher, newCount, newest, pages,
                at, taking, closesOn }
     rows     what the tile draws, four at most: the pieces with work to
              grade, newest work first, then pieces taking work with nothing
              in yet
     fold     the pieces with work to grade that the four rows leave out
     caughtUp nothing to grade in the class
     takingWork  pieces taking work with nothing in yet
     toGrade  the class's total, GraderWork's own
   One pass per draw: the class is counted once (classWorkCounts, shared
   with the top bar), and workCounts is asked only for the rows drawn.
   "New" is a student's own send (sent_by 'student') after `seen`, the time
   kept on this device, that is still to grade; with no time kept nothing is
   new. Work the teacher added is never new; it is counted as
   addedByTeacher. */
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
   * @param {{ seen?: string | null, classCounts?: (cid: string, ids: string[]) => any }} [opts]
   *   seen: the kept time; classCounts: the draw's one GraderWork.classWorkCounts
   *   answer (DashOverview.classWorkCounts), so the class is counted once.
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
    // Nothing is new until a time is kept: the first look starts it.
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

    // One count of the class's work: the top bar's, when the draw shares it.
    var cc = opts && opts.classCounts ? opts.classCounts(cid, ids) : GW.classWorkCounts(cid, ids);
    out.toGrade = cc.tograde;

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

    /** @type {Record<string, any>} */
    var titles = {};
    (getAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (a && a.id) titles[a.id] = a;
    });

    /** What a piece's work says of itself, from its submissions alone.
     * @param {string} aid @param {any} a @param {any[]} subs */
    function cheap(aid, a, subs) {
      var p = {
        aid: aid,
        title: String((a && a.title) || 'Untitled'),
        date: String((a && (a.dateAssigned || a.date)) || ''),
        in: subs.length,
        tograde: 0,
        toreturn: 0,
        notin: 0,
        late: 0,
        onPaper: 0,
        addedByTeacher: 0,
        fromStudents: 0,
        newCount: 0,
        newest: [],
        pages: [],
        at: '',
        taking: false,
        closesOn: '',
      };
      subs.forEach(function (s) {
        if (s.is_late) p.late++;
        if (s.on_paper) p.onPaper++;
        if (s.sent_by === 'teacher') p.addedByTeacher++;
        else if (s.sent_by === 'student') p.fromStudents++;
        if (!p.at || _later(_at(s), p.at)) p.at = _at(s);
      });
      return p;
    }

    var work = [];
    (cc.pieces || []).forEach(function (/** @type {any} */ c) {
      if (!(c.tograde > 0)) return;
      var p = cheap(c.aid, titles[c.aid], subsOf[c.aid] || []);
      p.tograde = c.tograde;
      p.toreturn = c.toreturn;
      p.notin = c.notin;
      work.push(p);
    });
    work.sort(function (x, y) {
      return _later(x.at, y.at) ? -1 : _later(y.at, x.at) ? 1 : x.title < y.title ? -1 : 1;
    });

    // Pieces taking work with nothing in: the one dated last first. A piece
    // with no work at all is asked about only here.
    var taking = [];
    // Only asked while the rows have room: four pieces with work to grade
    // fill them, and the many pieces taking work are not each looked at.
    Object.keys(titles).forEach(function (aid) {
      if (work.length >= MAX_ROWS) return;
      var a = titles[aid];
      if (subsOf[aid] || (typeof isDibelsScored === 'function' && isDibelsScored(a)) || !GW.workOn(cid, a)) return;
      var win = _closes(cid, a);
      if (!win.open) return;
      var p = cheap(aid, a, []);
      p.taking = true;
      p.closesOn = win.closes;
      taking.push(p);
    });
    taking.sort(function (x, y) {
      return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
    });
    out.takingWork = taking;
    out.pieces = work.concat(taking);
    out.caughtUp = out.toGrade === 0;
    out.rows = out.pieces.slice(0, MAX_ROWS);
    out.rows.forEach(function (/** @type {any} */ p) {
      if (!p.taking) _detail(cid, p, ids, byId, subsOf[p.aid] || [], seen);
    });

    var rest = out.pieces.slice(MAX_ROWS);
    if (rest.length) {
      var left = rest.filter(function (/** @type {any} */ p) {
        return p.tograde > 0;
      });
      /** @type {any} */
      var fold = {
        pieces: left.length,
        work: 0,
        tograde: 0,
        withStudents: [],
        youAdded: { work: 0, pieces: 0 },
      };
      // Each folded piece is counted once: with a student's send it is named;
      // with only the teacher's own work it is part of "You added".
      left.forEach(function (/** @type {any} */ p) {
        fold.work += p.in;
        fold.tograde += p.tograde;
        if (p.fromStudents) fold.withStudents.push({ aid: p.aid, title: p.title, tograde: p.tograde });
        else if (p.addedByTeacher) {
          fold.youAdded.work += p.addedByTeacher;
          fold.youAdded.pieces++;
        }
      });
      out.fold = fold;
    }
    return out;
  }

  /** What only a drawn row needs. Its counts are the class count's (one
   * pass, shared with the top bar); only how many are in, the newest work,
   * the pictures and what is new are worked out here, from the row's own
   * submissions. Who is to grade, in order, waits for a click (gradeOrder).
   * @param {string} cid @param {any} p @param {string[]} ids
   * @param {Record<string, any>} byId @param {any[]} piecesSubs
   * @param {string | null} seen */
  function _detail(cid, p, ids, byId, piecesSubs, seen) {
    var GW = _gw();
    p.in = GW.workInIds(cid, p.aid, ids).length;
    var subs = piecesSubs.slice().sort(function (x, y) {
      return _later(_at(x), _at(y)) ? -1 : _later(_at(y), _at(x)) ? 1 : 0;
    });
    // New: a student's own send after the kept time that is still to grade
    // (GraderWork's word for that student, asked only of the few sends).
    subs.forEach(function (s) {
      if (
        s.sent_by === 'student' &&
        seen &&
        _later(String(s.sent_at || ''), seen) &&
        GW.workStateOf(cid, p.aid, s.enrollment_id) === 'tograde'
      )
        p.newCount++;
    });
    for (var i = 0; i < subs.length && p.pages.length < MAX_PICS; i++) {
      var f = _files(subs[i])[0];
      if (!f && !subs[i].on_paper) continue;
      p.pages.push({
        sid: subs[i].enrollment_id,
        name: displayName(byId[subs[i].enrollment_id]),
        file: f || null,
        paper: !f,
      });
    }
    p.newest = subs.slice(0, NEWEST).map(function (s) {
      return {
        sid: s.enrollment_id,
        name: displayName(byId[s.enrollment_id]),
        at: _at(s),
        pages: (s.files || []).length,
        late: !!s.is_late,
      };
    });
  }

  /** The students to grade on one piece, in the order their work came in
   * (oldest first): GraderWork's own list, sorted by when each one's work was
   * sent. A student whose work is a pair's or group's goes by the mate's
   * send time. Asked when Grade Submissions is clicked, not on every draw.
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

  return { build: build, gradeOrder: gradeOrder, SEEN_KEY: SEEN_KEY, MAX_ROWS: MAX_ROWS, MAX_PICS: MAX_PICS };
})();
