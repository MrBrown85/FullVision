// @ts-check
/* dash-inbox-queue.js — what the redrawn Inbox shows, with no HTML and no DOM
   (slice I1 of docs/plans/inbox-redesign-plan.md). From the class's work
   (getCourseSubmissions) and GraderWork alone: every count is GraderWork's
   (classWorkCounts, workCounts, workStateOf), so the stacks add up to the
   number the top bar's To Grade shows. This file writes no rule for a count;
   it sorts the lists GraderWork made and reads the work's own marks (who
   sent it, paper, late, pages, when).

   build(cid, { seen, classCounts }) gives:
     on        the class takes work (the student page and Send Work on)
     holds     the class holds grades until Return (GradeState.holds)
     toGrade   the class's To Grade, GraderWork's own
     toReturn  grades waiting to be returned, summed over the returns
     caughtUp  nothing to grade
     stacks    one per assessment with work to grade, newest work first:
               { aid, title, tograde, notin, late, isNew, at,
                 top: { sid, name, file, paper } | null }
     returns   one per assessment with grades not yet returned, empty when
               the class does not hold grades: { aid, title, toreturn }
     taking    assessments still taking work with someone not in:
               { aid, title, notin }, the one dated last first
   open(cid, aid) gives { aid, title, items, notIn }: items are the students
   to grade (a pair or group is one item), oldest send first; notIn is
   { sid, name } in class-list order.
   order(cid) gives [{ aid, studentIds }]: the stacks in the order shown,
   each with DashInboxModel.gradeOrder.

   One pass per draw: the class is counted once (classWorkCounts, shared
   with the top bar), the class's work is read once, and workStateOf is asked
   only of the students with work in a piece that has work to grade. "New" is
   a student's own send (sent_by 'student') after `seen` that is still to
   grade; with no time kept nothing is new. */
window.DashInboxQueue = (function () {
  'use strict';

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

  /** Whether the class holds grades until the teacher returns them: the
   * Assignments page's reading (_holdsGrades), from the same data.
   * @param {string} cid */
  function _holds(cid) {
    if (!cid || typeof getReturnSettings !== 'function') return false;
    var klass = getReturnSettings(cid);
    var GS = /** @type {any} */ (window).GradeState;
    return !!klass.student_page && !!GS && !!GS.holds(klass);
  }

  /** When the piece stops taking work.
   * @param {string} cid @param {any} a */
  function _takingOpen(cid, a) {
    var win = /** @type {any} */ (window)._studentWorkWindow;
    if (typeof win !== 'function' || typeof getAssessmentStudentWork !== 'function') return true;
    return !!win(cid, a, getAssessmentStudentWork(cid, a.id)).open;
  }

  /** @param {string} cid @param {{ seen?: string | null, classCounts?: (cid: string, ids: string[]) => any }} [opts]
   * @returns {any} */
  function _buildQueue(cid, opts) {
    var GW = _gw();
    /** @type {any} */
    var out = {
      on: false,
      holds: false,
      toGrade: 0,
      toReturn: 0,
      caughtUp: true,
      stacks: [],
      returns: [],
      taking: [],
    };
    if (!cid || !GW || !GW.workOnInClass(cid)) return out;
    out.on = true;
    out.holds = _holds(cid);
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
    var cc = opts && opts.classCounts ? opts.classCounts(cid, ids) : GW.classWorkCounts(cid, ids);
    out.toGrade = cc.tograde;
    out.caughtUp = !(cc.tograde > 0);

    /** @type {Record<string, any>} */
    var titles = {};
    (getAssessments(cid) || []).forEach(function (/** @type {any} */ a) {
      if (a && a.id) titles[a.id] = a;
    });
    /** @param {string} aid */
    function titleOf(aid) {
      return String((titles[aid] && titles[aid].title) || 'Untitled');
    }

    // The newest version of each student's work on each piece, as the
    // readers choose it, read once, and only if a piece has work to grade.
    /** @type {Record<string, any[]> | null} */
    var subsOf = null;
    function subsByPiece() {
      if (subsOf) return subsOf;
      /** @type {Record<string, any>} */
      var newest = {};
      getCourseSubmissions(cid).submissions.forEach(function (/** @type {any} */ s) {
        if (!s || !byId[s.enrollment_id]) return;
        var key = s.assessment_id + '|' + s.enrollment_id;
        if (!newest[key] || (s.version || 1) > (newest[key].version || 1)) newest[key] = s;
      });
      /** @type {Record<string, any[]>} */
      var by = {};
      Object.keys(newest).forEach(function (k) {
        var s = newest[k];
        (by[s.assessment_id] = by[s.assessment_id] || []).push(s);
      });
      subsOf = by;
      return by;
    }

    (cc.pieces || []).forEach(function (/** @type {any} */ c) {
      if (c.tograde > 0) {
        var subs = (subsByPiece()[c.aid] || []).filter(function (/** @type {any} */ s) {
          return GW.workStateOf(cid, c.aid, s.enrollment_id) === 'tograde';
        });
        subs.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
          return _later(_at(x), _at(y)) ? -1 : _later(_at(y), _at(x)) ? 1 : 0;
        });
        var late = subs.some(function (/** @type {any} */ s) {
          return !!s.is_late;
        });
        var isNew = subs.some(function (/** @type {any} */ s) {
          return s.sent_by === 'student' && !!seen && _later(String(s.sent_at || ''), seen);
        });
        /** @type {any} */
        var top = null;
        for (var i = 0; i < subs.length && !top; i++) {
          var f = _files(subs[i])[0];
          if (f || subs[i].on_paper)
            top = {
              sid: subs[i].enrollment_id,
              name: displayName(byId[subs[i].enrollment_id]),
              file: f || null,
              paper: !f,
            };
        }
        out.stacks.push({
          aid: c.aid,
          title: titleOf(c.aid),
          tograde: c.tograde,
          notin: c.notin,
          late: late,
          isNew: isNew,
          at: subs.length ? _at(subs[subs.length - 1]) : '',
          top: top,
        });
      }
      if (c.toreturn > 0 && out.holds) {
        out.returns.push({ aid: c.aid, title: titleOf(c.aid), toreturn: c.toreturn });
        out.toReturn += c.toreturn;
      }
    });
    out.stacks.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      return _later(x.at, y.at) ? -1 : _later(y.at, x.at) ? 1 : x.title < y.title ? -1 : x.title > y.title ? 1 : 0;
    });

    // Pieces still taking work with someone not in: the one dated last first.
    (cc.pieces || []).forEach(function (/** @type {any} */ c) {
      if (!(c.notin > 0)) return;
      var a = titles[c.aid];
      if (!a || !GW.workOn(cid, a) || !_takingOpen(cid, a)) return;
      out.taking.push({
        aid: c.aid,
        title: titleOf(c.aid),
        notin: c.notin,
        date: String(a.dateAssigned || a.date || ''),
      });
    });
    out.taking.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
      return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
    });
    out.taking.forEach(function (/** @type {any} */ t) {
      delete t.date;
    });
    return out;
  }

  /** One piece, opened: its work to grade and who is not in.
   * @param {string} cid @param {string} aid
   * @returns {any} */
  function open(cid, aid) {
    var GW = _gw();
    /** @type {any} */
    var out = { aid: aid, title: '', items: [], notIn: [] };
    if (!cid || !aid || !GW) return out;
    var piece = (getAssessments(cid) || []).filter(function (/** @type {any} */ a) {
      return a && a.id === aid;
    })[0];
    if (!piece) return out;
    out.title = String(piece.title || 'Untitled');
    var students = getStudents(cid) || [];
    var ids = students.map(function (s) {
      return s.id;
    });
    /** @type {Record<string, any>} */
    var byId = {};
    students.forEach(function (s) {
      byId[s.id] = s;
    });
    var counts = GW.workCounts(cid, aid, ids);
    // Oldest send first (DashInboxModel's order), a pair or group once.
    var order = DashInboxModel.gradeOrder(cid, aid);
    /** @type {Record<string, boolean>} */
    var waiting = {};
    order.forEach(function (/** @type {string} */ sid) {
      waiting[sid] = true;
    });
    /** @type {Record<string, boolean>} */
    var done = {};
    order.forEach(function (/** @type {string} */ sid) {
      if (done[sid]) return;
      var g = getStudentWorkGroup(cid, sid, aid);
      var members =
        g && !g.separate
          ? g.members.filter(function (/** @type {string} */ m) {
              return waiting[m];
            })
          : [sid];
      if (!members.length) members = [sid];
      members.forEach(function (/** @type {string} */ m) {
        done[m] = true;
      });
      var subs = (getGroupSubmissions(cid, members[0], aid) || []).filter(function (/** @type {any} */ s) {
        return members.indexOf(s.enrollment_id) >= 0;
      });
      subs.sort(function (/** @type {any} */ x, /** @type {any} */ y) {
        return (Date.parse(_at(x)) || 0) - (Date.parse(_at(y)) || 0);
      });
      var own = subs[0];
      var sender = own ? own.enrollment_id : members[0];
      var names = [sender]
        .concat(
          members.filter(function (/** @type {string} */ m) {
            return m !== sender;
          }),
        )
        .map(function (/** @type {string} */ m) {
          return displayName(byId[m]);
        });
      var files = _files(own);
      out.items.push({
        sid: sid,
        members: members,
        name:
          names.length === 1
            ? names[0]
            : names.length === 2
              ? names[0] + ' and ' + names[1]
              : names[0] + ' and ' + (names.length - 1) + ' more',
        file: files[0] || null,
        pages: files.length,
        paper: !files.length && !!(own && own.on_paper),
        at: _at(own),
        late: subs.some(function (/** @type {any} */ s) {
          return !!s.is_late;
        }),
        isNew: subs.some(function (/** @type {any} */ s) {
          return s.sent_by === 'student';
        }),
      });
    });
    // Class-list order, as the Students list and Roll Call have it.
    var DI = /** @type {any} */ (window).DashInsights;
    var sorted =
      DI && DI.sortStudents
        ? DI.sortStudents(cid, students.slice(), 'last-asc', {})
        : sortStudents(students.slice(), 'lastName');
    out.notIn = sorted
      .filter(function (s) {
        return counts.ids.notin.indexOf(s.id) >= 0;
      })
      .map(function (s) {
        return { sid: s.id, name: displayName(s) };
      });
    return out;
  }

  /** The stacks in the order shown, each with who to grade, in the order
   * their work came in: what the grader steps through.
   * @param {string} cid
   * @returns {{ aid: string, studentIds: string[] }[]} */
  function order(cid) {
    return _buildQueue(cid, {}).stacks.map(function (/** @type {any} */ s) {
      return { aid: s.aid, studentIds: DashInboxModel.gradeOrder(cid, s.aid) };
    });
  }

  return { build: _buildQueue, open: open, order: order };
})();
