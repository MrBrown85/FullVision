/* grader.js — the one grader.
 *
 * The one module a screen writes a grade through
 * (docs/plans/student-page-build-plan.md, 1.4). Each action is named for
 * what the teacher does. Today each is a pass-through: it calls the
 * shared/data.js writer the screen called before, with the same arguments,
 * returns what the writer returns, and tells GradeState a grade was saved
 * (which changes nothing yet). No rule lives here. The rules that go with
 * the actions (locks, the points limit, the state of a piece, the To Grade
 * and To Return counts) move in behind them in later PRs, with Return,
 * Return for Revision and Return N Graded.
 *
 * Clearing is the same action with nothing in it: level 0, points null, a
 * null mark, a null status.
 *
 * Who writes through it: the desktop grader dialog
 * (teacher/page-assignments.js), but for its points box and its Note for
 * the Report, which still call data.js (two older tests look for those
 * calls in the page's text); the gradebook (teacher/page-gradebook.js)
 * and Class Results (teacher/class-results.js), whose own actions are
 * together below (S1-T1). The phone's Grade tab follows in S1-T2 and the
 * rest of the Assignments page (its grids, ledgers, fills and Set Everyone
 * To) in S1-T3; the fills and their Undo get their actions there.
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

  /* ── The gradebook and Class Results (S1-T1) ─────────────────────────
     What the gradebook's cells, keys and menus write, and Class Results'
     Mark Missing. A click on a gradebook cell opens the grader dialog,
     which writes through the actions above; so do the gradebook's points,
     Complete / Incomplete marks, statuses and ticks (setPoints, setMark,
     setStatus, setTick). The actions here are the rest. Each passes on
     what the screen passed to data.js before, in the same order, so some
     take a whole list the screen has built. */

  /* A level typed into a gradebook cell: a digit, or 0 for a cleared cell.
     The gradebook dates and types the score itself and passes its own
     note, as it did before it wrote through here. Its two views differ on
     work with no date: Edit Score in the Scores view passes today's date,
     a key in the Competencies view passes none. */
  function typeLevel(cid, sid, aid, key, level, date, type, note) {
    return _saved(cid, sid, aid, 'level', upsertScore(cid, sid, aid, key, level, date, type, note));
  }

  /* + or − typed on a gradebook cell: `mod` is 1, -1, or 0 to take it
     off. `note` is the comment the cell's entry holds, which goes up
     again with the level. */
  function typePlusMinus(cid, sid, aid, key, level, date, type, note, mod) {
    return _saved(cid, sid, aid, 'plusMinus', upsertScore(cid, sid, aid, key, level, date, type, note, mod));
  }

  /* Clear Score, in the gradebook's cell menu: `keys` come off `sid`'s
     entries for the assessment in `scores` (the class's score list), an
     Overall Comment or Note for the Report staying on one entry, and the
     list is saved. The ticks come off first, through setTick. */
  function clearScore(cid, scores, sid, assessment, keys) {
    clearScoreEntries(cid, scores, sid, assessment, keys);
    return _saved(cid, sid, assessment.id, 'clear', saveScores(cid, scores));
  }

  /* Clear Score's last step: the server clears the cell as well
     (clear_score). The gradebook asks once it has redrawn, as before, so
     it is an action of its own. */
  function clearScoreOnServer(cid, sid, aid) {
    return _saved(cid, sid, aid, 'clear', window.clearScore(sid, aid));
  }

  /* Undo for one gradebook cell (Cmd+Z, or the Score Cleared toast):
     `scores` is the class's score list with the cell's old entries put
     back; it is saved, then what changed since `before` is sent. Saving
     the list sends the change too, so it goes up twice, as before. The
     ticks Clear Score took off go back through setTick. */
  function undoCell(cid, sid, aid, before, scores) {
    var out = saveScores(cid, scores);
    persistScoreDiffToCanonical(cid, before, scores);
    return _saved(cid, sid, aid, 'undo', out);
  }

  /* Mark Blank Cells Missing or Excused, in the gradebook's column menu
     and on Class Results' Unmarked list: `statuses` is the class's whole
     status list with the blank cells of `aid` marked. */
  function markBlankCells(cid, aid, statuses) {
    return _saved(cid, null, aid, 'status', saveAssignmentStatuses(cid, statuses));
  }

  /* Its undo (the toast, Cmd+Z, or Undo Marking Blank Cells): the list
     with those marks taken off. */
  function undoMarkBlankCells(cid, aid, statuses) {
    return _saved(cid, null, aid, 'undo', saveAssignmentStatuses(cid, statuses));
  }

  /* Delete Assessment, in the gradebook's column menu: `scores` is the
     class's score list with the work's scores taken out. The gradebook
     deletes the work itself. */
  function deleteAssessmentScores(cid, aid, scores) {
    return _saved(cid, null, aid, 'delete', saveScores(cid, scores));
  }

  /* And `statuses`, the class's status list with the work's taken out. */
  function deleteAssessmentStatuses(cid, aid, statuses) {
    return _saved(cid, null, aid, 'delete', saveAssignmentStatuses(cid, statuses));
  }

  /* Undo: put back the cells that changed between `before` and `after`
     (copies of the class's scores) and still hold what `after` has. */
  function undo(cid, before, after) {
    return _saved(cid, null, null, 'undo', restoreScoreCells(cid, before, after));
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
    // The gradebook and Class Results (S1-T1)
    typeLevel: typeLevel,
    typePlusMinus: typePlusMinus,
    clearScore: clearScore,
    clearScoreOnServer: clearScoreOnServer,
    undoCell: undoCell,
    markBlankCells: markBlankCells,
    undoMarkBlankCells: undoMarkBlankCells,
    deleteAssessmentScores: deleteAssessmentScores,
    deleteAssessmentStatuses: deleteAssessmentStatuses,
    undo: undo,
  };
})();
