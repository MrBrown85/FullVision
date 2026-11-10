/* grader.js — the one grader.
 *
 * The one module a screen writes a grade through
 * (docs/plans/student-page-build-plan.md, 1.4). Each action is named for
 * what the teacher does. Each is a pass-through: it calls the
 * shared/data.js writer the screen called before, with the same arguments,
 * and returns what the writer returns. data.js runs the Draft and Returned
 * rule on the write (shared/grade-state.js), and a screen reads the state a
 * piece is in from GradeState.stateOf. The other rules that go with the
 * actions (locks, the points
 * limit, the To Grade and To Return counts) move in behind them in later
 * PRs, with Return for Revision and Return N Graded.
 *
 * Clearing is the same action with nothing in it: level 0, points null, a
 * null mark, a null status.
 *
 * Who writes through it: the desktop grader dialog
 * (teacher/page-assignments.js), but for its points box and its Note for
 * the Report, which still call data.js (two older tests look for those
 * calls in the page's text). The gradebook and Class Results follow in
 * S1-T1, the phone's Grade tab in S1-T2 and the rest of the Assignments
 * page (its grids, ledgers, fills and Set Everyone To) in S1-T3; Clear
 * Score, the fills and their Undo get their actions there.
 * tests/grader-guard.test.js counts the calls each file still makes to the
 * score writers in data.js and fails when one is added.
 */
window.Grader = (function () {
  'use strict';

  /* Every action ends here: GradeState hears of the save, and the writer's
     answer goes back to the screen. */
  function _saved(cid, sid, aid, what, out) {
    GradeState.afterSave(cid, sid, aid, what);
    return out;
  }

  /* A level under one score key (a competency, a rubric criterion or
     'overall'), dated and typed from the assessment. */
  function _writeLevel(cid, sid, aid, key, level, mod) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    return upsertScore(cid, sid, aid, key, level, assess ? assess.date : '', scoreTypeFor(assess), '', mod);
  }

  /* A level, 1 to 4, under `key`. 0 clears it. */
  function setLevel(cid, sid, aid, key, level, mod) {
    return _saved(cid, sid, aid, 'level', _writeLevel(cid, sid, aid, key, level, mod));
  }

  /* + or − on the level `key` holds: `mod` is 1, -1, or 0 to take it off. */
  function setPlusMinus(cid, sid, aid, key, level, mod) {
    return _saved(cid, sid, aid, 'plusMinus', _writeLevel(cid, sid, aid, key, level, mod));
  }

  /* Points for the whole piece. null clears; 0 is a score. */
  function setPoints(cid, sid, aid, points) {
    return _saved(cid, sid, aid, 'points', setPointsScore(cid, sid, aid, points));
  }

  /* 'complete' or 'incomplete'. null clears. */
  function setMark(cid, sid, aid, mark) {
    return _saved(cid, sid, aid, 'mark', setCompletionMark(cid, sid, aid, mark));
  }

  /* Missing ('NS'), Excused ('EXC') or Late ('LATE'). null takes it off. */
  function setStatus(cid, sid, aid, status) {
    return _saved(cid, sid, aid, 'status', applyAssignmentStatus(cid, sid, aid, status));
  }

  /* One box of an Advanced Rubric's checklist. Returns the ticked ids. */
  function setTick(cid, sid, aid, checkId, on) {
    return _saved(cid, sid, aid, 'tick', setRubricCheck(cid, sid, aid, checkId, on));
  }

  /* The comment under one rubric criterion (Work On, on a single-point
     rubric). */
  function setCriterionComment(cid, sid, aid, criterionId, text) {
    return _saved(cid, sid, aid, 'comment', saveRubricCriterionComment(cid, sid, aid, criterionId, text));
  }

  /* A single-point rubric's Went Beyond note for one criterion. */
  function setWentBeyond(cid, sid, aid, criterionId, text) {
    return _saved(cid, sid, aid, 'comment', saveRubricCriterionBeyond(cid, sid, aid, criterionId, text));
  }

  /* The comment under one competency, on work with no rubric. */
  function setCompetencyComment(cid, sid, aid, tagId, text) {
    return _saved(cid, sid, aid, 'comment', saveTagComment(cid, sid, aid, tagId, text));
  }

  function setOverallComment(cid, sid, aid, text) {
    return _saved(cid, sid, aid, 'comment', saveScoreComment(cid, sid, aid, text));
  }

  /* One window of a DIBELS benchmark: its four numbers. */
  function setDibels(cid, sid, aid, period, values) {
    return _saved(cid, sid, aid, 'dibels', saveDibelsScore(cid, sid, aid, period, values));
  }

  /* Group work: grade `sid` on their own from here on. */
  function gradeSeparately(cid, aid, sid) {
    return _saved(cid, sid, aid, 'gradeSeparately', setGradedSeparately(cid, aid, sid, true));
  }

  /* Group work: `sid` takes the group's grade again, in place of their own. */
  function backToGroupGrade(cid, aid, sid) {
    return _saved(cid, sid, aid, 'backToGroupGrade', setGradedSeparately(cid, aid, sid, false));
  }

  /* Undo: put back the cells that changed between `before` and `after`
     (copies of the class's scores) and still hold what `after` has. */
  function undo(cid, before, after) {
    return _saved(cid, null, null, 'undo', restoreScoreCells(cid, before, after));
  }

  /* Return: the students in `studentIds` (one id or a list) are given
     their grade on `aid`. Only drafts are returned. Answers
     { returned, enrollment_ids, returned_at }. */
  function returnTo(cid, aid, studentIds) {
    var ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    return _saved(cid, ids.length === 1 ? ids[0] : null, aid, 'return', returnGrades(cid, aid, ids));
  }

  return {
    setLevel: setLevel,
    setPlusMinus: setPlusMinus,
    setPoints: setPoints,
    setMark: setMark,
    setStatus: setStatus,
    setTick: setTick,
    setCriterionComment: setCriterionComment,
    setWentBeyond: setWentBeyond,
    setCompetencyComment: setCompetencyComment,
    setOverallComment: setOverallComment,
    setDibels: setDibels,
    gradeSeparately: gradeSeparately,
    backToGroupGrade: backToGroupGrade,
    undo: undo,
    returnGrades: returnTo,
  };
})();
