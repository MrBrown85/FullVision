/* report-scores.js — the one entry every report reads grades through
   (docs/plans/student-page-build-plan.md 1.3 and S2; S2-T1).

   A report is anything a family, a student or the office is handed:
   Progress Reports, the Quick Report and its Feedback Pages, the Term
   Questionnaire's facts and Generate, Sent to Phones, Print Grades and
   Export. Each is a surface below, and SURFACES is the one place that says
   which set of scores it uses:
   - 'all': the teacher's working copy, drafts included;
   - 'returned': only what students have been given (shared/calc.js,
     withReturnedOnly).
   Nothing else in the app decides this.

   'returned' changes something only in a class that holds grades (its
   student page on and Return Grades set to When I Return Them). In any
   other class the data layer's returned set is the working copy itself
   (getReturnedScores, getReturnedRubricCheckIds), so such a class prints
   exactly what it printed before (tests/report-surfaces-other-classes.test.js).

   Three things go through here, and tests/report-score-seam.test.js fails
   when a report file goes around any of them:
   1. Grades worked out by calc.js. The function that draws or builds a
      report runs inside withReportScores(surface, fn); scoped() wraps a
      function so it does that every time it is called, from a click, a
      timer or a promise alike.
   2. Scores, comments, notes, ticks and statuses read straight from the
      data layer. A report file reads them with the readers below, never
      with the data layer's own. Each has the name of the data layer's
      reader it stands in for: `getScoreComment(cid, sid, aid)` in a report
      file is written `ReportScores.getScoreComment(cid, sid, aid)`. They
      give the set calc.js is using at that moment.
   3. Anything a report keeps to draw faster. Its key holds
      reportScoreSet(surface), so the two sets never share a kept copy. */
window.ReportScores = (function () {
  'use strict';

  /* Which grades each surface uses (plan 1.3, "Which grades each screen
     uses"; DECISIONS, "Student page build answers" 6). To put a surface on
     returned grades, change its row to 'returned'. */
  var SURFACES = {
    // Progress Reports on Page Studio, and the Quick Report with its Feedback Pages (S2-F1).
    progress: 'returned',
    /* The rubric handout (teacher/rubric-print.js), from each door that
       prints it: the grader, Class Results and the gradebook's column menu.
       It is handed to students (DECISIONS, "Student page build rulings
       (2026-11-10)" 6; S2-F1). Drawn inside a Feedback Page it takes that
       report's set, as any report drawn inside another does. */
    handout: 'returned',
    // The Term Questionnaire's facts, At a Glance, its checks and Generate (S2-F2; Colin's answer 6).
    questionnaire: 'returned',
    // Sent to Phones: each student's phone copy (S2-F2; Colin's answer 6).
    phones: 'returned',
    // MyEdBC Input: the marks and comments a teacher types into MyEd, which families see (S16-F1; Colin's answer 6).
    myed: 'returned',
    /* The grader's own use of a report's reading: the Note for the Report's
       preview under the grader (teacher/page-assignments.js), which asks
       the questionnaire's facts. The grader is the teacher's screen, so all
       work: run inside this, the facts take this set (the outermost
       surface decides). */
    grader: 'all',
    // Print Grades: the teacher's own class sheet. All work, by the artboard; it stays.
    printGrades: 'all',
    // Export (Download All My Data): the teacher's own records. All work, by the artboard; it stays.
    exportData: 'all',
  };

  // The surface whose function is running now, or null. The outermost one decides.
  var _running = null;

  function _row(surface) {
    if (!Object.prototype.hasOwnProperty.call(SURFACES, surface)) {
      throw new Error('"' + surface + '" is not a report surface (teacher/report-scores.js). No report was drawn.');
    }
    return SURFACES[surface];
  }

  /* The set calc.js is working with at this moment: 'all', or 'returned'
     inside withReturnedOnly. calc.js is the one keeper of it; the readers
     below follow it, so a report read can never be in a different set from
     the grades beside it. */
  function setInUse() {
    return typeof _scoreSet === 'string' ? _scoreSet : 'all';
  }

  /* The set of scores a surface's report is drawn from when it is drawn
     now. A report drawn inside another surface's (a block inside a phone
     copy, a rubric sheet inside a Feedback Page) takes that one's set, and
     nothing run inside returned grades is ever given all work. */
  function reportScoreSet(surface) {
    var own = _row(surface);
    if (setInUse() === 'returned') return 'returned';
    return _running ? SURFACES[_running] : own;
  }

  /* Run `fn` in the surface's set of scores and give back what it returns.
     `fn` must finish at once: on returned grades, work it leaves for later
     (a promise, a timer) would run with every score, so calc.js refuses a
     promise. Wrap the function that does the work, inside the timer or the
     promise's callback, never the code that schedules it. */
  function withReportScores(surface, fn) {
    var set = reportScoreSet(surface);
    if (_running) return fn();
    _running = surface;
    try {
      return set === 'returned' && setInUse() !== 'returned' ? withReturnedOnly(fn) : fn();
    } finally {
      _running = null;
    }
  }

  /* `fn` as a function that always runs in the surface's set: same
     arguments, same `this`, same result. */
  function scoped(surface, fn) {
    _row(surface);
    return function () {
      var self = this;
      var args = arguments;
      // Through the name on window, so the one table above is the only thing a test or a later PR changes.
      return window.ReportScores.withReportScores(surface, function () {
        return fn.apply(self, args);
      });
    };
  }

  // The surface whose function is running now, or null outside every report ('ready' while ready() asks).
  function running() {
    return _running;
  }

  /* ── The readers ───────────────────────────────────────────────
     What a report reads straight from the data layer. On all work each
     gives exactly what the data layer's own reader gives. On returned
     grades each reads the returned set (the data layer's
     getReturnedScores, as calc.js does), and stops with an error when it
     cannot: it never falls back to every score. */

  function _returned(cid) {
    if (typeof getReturnedScores !== 'function') {
      throw new Error(
        'Returned grades were asked for, but nothing loaded here can give them. No report was drawn, so no draft is shown.',
      );
    }
    var set = getReturnedScores(cid);
    var plain = !!set && typeof set === 'object' && !Array.isArray(set);
    var proto = plain ? Object.getPrototypeOf(set) : null;
    if (
      !plain ||
      (proto !== Object.prototype && proto !== null) ||
      !Object.keys(set).every(function (sid) {
        return Array.isArray(set[sid]);
      })
    ) {
      throw new Error(
        'Returned grades were asked for, but what came back for this class is not a set of scores. No report was drawn, so no draft is shown.',
      );
    }
    return set;
  }

  // Every student's score entries in the class: { [studentId]: [entry] }.
  function scores(cid) {
    var set = setInUse();
    if (set === 'all') return getScores(cid);
    if (set !== 'returned') throw new Error('There is no set of scores called "' + set + '". No report was drawn.');
    return _returned(cid);
  }

  // One student's score entries, or [].
  function entries(cid, sid) {
    return scores(cid)[sid] || [];
  }

  function _own(cid, sid, aid) {
    return entries(cid, sid).filter(function (e) {
      return e && e.assessmentId === aid;
    });
  }

  // A points score, or null when none is entered; 0 is a score.
  function pointsScore(cid, sid, aid) {
    if (setInUse() === 'all') return getPointsScore(cid, sid, aid);
    var entry = _own(cid, sid, aid).find(function (e) {
      return e.score != null && e.score !== '';
    });
    return entry ? Number(entry.score) : null;
  }

  // A Complete/Incomplete mark: 'complete', 'incomplete', or null when unmarked.
  function completionMark(cid, sid, aid) {
    if (setInUse() === 'all') return getCompletionMark(cid, sid, aid);
    var entry = _own(cid, sid, aid)[0];
    if (!entry || entry.score == null) return null;
    return Number(entry.score) > 0 ? 'complete' : 'incomplete';
  }

  // The Overall Comment on one piece of work, or ''.
  function comment(cid, sid, aid) {
    if (setInUse() === 'all') return getScoreComment(cid, sid, aid);
    var entry = _own(cid, sid, aid).find(function (e) {
      return e.note;
    });
    return entry ? String(entry.note) : '';
  }

  function _criterionNote(cid, sid, aid, criterion, field) {
    var keys = rubricCriterionScoreKeys(criterion);
    var own = _own(cid, sid, aid);
    for (var i = 0; i < keys.length; i++) {
      var entry = own.find(function (e) {
        return e.tagId === keys[i];
      });
      if (entry && entry[field]) return entry[field];
    }
    return '';
  }

  // A rubric criterion's comment (Work On, on a single-point rubric), or ''.
  function criterionComment(cid, sid, aid, criterion) {
    if (setInUse() === 'all') return getRubricCriterionComment(cid, sid, aid, criterion);
    return _criterionNote(cid, sid, aid, criterion, 'critNote');
  }

  // A single-point rubric criterion's Went Beyond, or ''.
  function criterionBeyond(cid, sid, aid, criterion) {
    if (setInUse() === 'all') return getRubricCriterionBeyond(cid, sid, aid, criterion);
    return _criterionNote(cid, sid, aid, criterion, 'critBeyond');
  }

  // The comment on one competency of work scored by competency levels, or ''.
  function tagComment(cid, sid, aid, tagId) {
    if (setInUse() === 'all') return getTagComment(cid, sid, aid, tagId);
    return _criterionNote(cid, sid, aid, { id: tagId }, 'critNote');
  }

  /* The teacher's Note for the Report on one piece of work, or ''. A note
     has no Draft or Returned state of its own, but it prints only once
     that piece's grade has been returned (DECISIONS, "Student page build
     rulings" 11): on returned grades it is given only where the returned
     set holds a grade for the piece. */
  function reportNote(cid, sid, aid) {
    if (setInUse() === 'all') return getScoreReportNote(cid, sid, aid);
    return _own(cid, sid, aid).length ? getScoreReportNote(cid, sid, aid) : '';
  }

  /* The ids of the Advanced Rubric checkboxes ticked for one student on one
     piece of work. The returned set holds no ticks and the data layer has
     no returned reader for them yet, so on returned grades this stops with
     an error until it has one (getReturnedRubricCheckIds): a draft tick is
     never printed, and a returned one is never silently dropped. */
  function checkIds(cid, sid, aid) {
    if (setInUse() === 'all') return getRubricCheckIds(cid, sid, aid);
    if (typeof getReturnedRubricCheckIds !== 'function') {
      throw new Error(
        'Returned grades were asked for, but nothing loaded here can give the returned checklist ticks. No report was drawn, so no draft is shown.',
      );
    }
    return getReturnedRubricCheckIds(cid, sid, aid);
  }

  /* Every status in the class: { 'studentId:assessmentId': 'NS' | 'EXC' | 'LATE' }.
     The same in both sets: Missing, Excused and Late are never drafts
     (plan 1.2; DECISIONS, "Student page build answers" 4). */
  function statuses(cid) {
    return getAssignmentStatuses(cid);
  }

  // One student's status on one piece of work, or null.
  function status(cid, sid, aid) {
    return statuses(cid)[sid + ':' + aid] || null;
  }

  /* ── Ready, or waiting ─────────────────────────────────────────
     The one question a page asks before it draws or acts on anything that
     reads returned grades: can this class's returned grades be read now?
     Always yes in a class that does not hold grades (its returned set is
     the working copy). In a signed-in class that holds grades, no until
     its Draft and Returned rows have loaded this session (the first draw
     of a session, or offline): the data layer then refuses, rightly, to
     call anything returned, with an error whose code is
     RETURNED_NOT_LOADED. Any other error from building the returned set
     is a fault, and is thrown, not waited out. While the answer is no, a surface draws
     WAITING_HTML instead of itself, and a button that needs the returned
     grades does nothing. Once the rows load, the data layer redraws the
     page on screen (_invalidateAndRerender, which calls the page's
     render()). */
  function ready(cid) {
    if (typeof getReturnedScores !== 'function') return false;
    // The seam's own read, not a report's: it draws nothing (running() says 'ready' meanwhile).
    var was = _running;
    if (!was) _running = 'ready';
    try {
      getReturnedScores(cid);
      return true;
    } catch (e) {
      // Only the data layer's not-loaded refusal is waited out; any other error is a fault and surfaces.
      if (e && e.code === 'RETURNED_NOT_LOADED') return false;
      throw e;
    } finally {
      _running = was;
    }
  }

  // html-safe: fixed markup; the words are Class Settings' own loading line
  var WAITING_HTML =
    '<div class="empty-state report-waiting" role="status"><div class="empty-state-text">Loading this class\u2026</div></div>';

  var api = {
    ready: ready,
    WAITING_HTML: WAITING_HTML,
    reportScoreSet: reportScoreSet,
    withReportScores: withReportScores,
    scoped: scoped,
    running: running,
    setInUse: setInUse,
    surfaces: function () {
      return Object.keys(SURFACES);
    },
    // The readers, under the data layer's names. entries(cid, sid) is getScores(cid)[sid] || [].
    getScores: scores,
    entries: entries,
    getPointsScore: pointsScore,
    getCompletionMark: completionMark,
    getScoreComment: comment,
    getRubricCriterionComment: criterionComment,
    getRubricCriterionBeyond: criterionBeyond,
    getTagComment: tagComment,
    getScoreReportNote: reportNote,
    getRubricCheckIds: checkIds,
    getAssignmentStatuses: statuses,
    getAssignmentStatus: status,
  };
  return api;
})();
