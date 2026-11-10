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
 * Who writes through it: every screen that writes a grade. The desktop
 * grader dialog and the Assignments page (teacher/page-assignments.js: its
 * grids, ledgers, fills and Set Everyone To; S0-T2 and S1-T3); the
 * gradebook (teacher/page-gradebook.js) and Class Results
 * (teacher/class-results.js; S1-T1); the phone's Grade tab
 * (teacher-mobile/tab-grade.js; S1-T2). The actions a screen brought of its
 * own are together under its name below. tests/grader-guard.test.js fails
 * when any other file calls one of the score writers in data.js.
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

  /* ── The Assignments page (S1-T3) ───────────────────────────────────
     The page's grids and ledgers write through the actions at the top: a
     level, a + or −, points, a mark, a status, a tick and the comments
     pass data.js what the dialog's do. So do its fills (Set Everyone To,
     a row's fill and Clear, Set Unmarked to …), a cell at a time: the page
     looks at each cell just before it writes it, because on pair work the
     first member's mark reaches the partner, who is then passed over. A
     score fill's Undo is undo, below. The actions here are the rest. */

  /* Undo for Set Unmarked to Missing: the status comes off one student.
     setStatus with null does the same and answers false; this answers
     what saving the status list does. */
  function undoMissing(cid, sid, aid) {
    return _saved(cid, sid, aid, 'undo', setAssignmentStatus(cid, sid, aid, null));
  }

  /* An Overall level carried onto a competency ticked later, in the edit
     form: `overall` is the student's Overall entry on the work. Its level,
     + or −, date and type go under `key`; its comment does not. setLevel
     would date and type the copy from the work. */
  function carryOverall(cid, sid, aid, key, overall) {
    return _saved(
      cid,
      sid,
      aid,
      'level',
      upsertScore(cid, sid, aid, key, overall.score, overall.date, overall.type, '', overall.mod),
    );
  }

  /* Edit a Copy on scored work: the work's scores and ticks follow it to
     the copy's criteria and boxes. `maps` is { rubricId, criteria, checks },
     each old id to its new one. */
  function moveToRubric(cid, aid, maps) {
    return _saved(cid, null, aid, 'move', moveRubricScores(cid, aid, maps));
  }

  /* The Note for the Report, in the grader dialog: one line about what
     the student did, for the term comment. It is no part of the grade, so
     it never makes a draft. data.js tidies the text. */
  function setReportNote(cid, sid, aid, text) {
    return _saved(cid, sid, aid, 'reportNote', saveScoreReportNote(cid, sid, aid, text));
  }

  /* ── The phone's Grade tab (S1-T2) ──────────────────────────────────
     The phone's points, marks, statuses, ticks, comments and group
     actions go through the actions above. Its levels and its Undo pass
     data.js something different from the desktop's, so they have actions
     of their own here, kept as the phone had them: the move changed
     nothing that is saved or sent (tests/pin-phone-grade-writes.test.js).
     Each says how it differs. Making them the same changes what a
     teacher's tap saves, so that is a decision, not tidying. */

  /* A level under one score key, as the phone dates and notes it. Work
     with no date of its own is dated today, on every change of the level;
     _writeLevel passes no date for it, so data.js dates a first level today
     and leaves a later one's date alone. */
  function _writeLevelOnPhone(cid, sid, aid, key, level, note, mod) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    return upsertScore(
      cid,
      sid,
      aid,
      key,
      level,
      (assess && assess.date) || courseToday(cid),
      scoreTypeFor(assess),
      note,
      mod,
    );
  }

  /* A level, 1 to 4, under `key`. 0 clears it. */
  function setLevelOnPhone(cid, sid, aid, key, level, mod) {
    return _saved(cid, sid, aid, 'level', _writeLevelOnPhone(cid, sid, aid, key, level, '', mod));
  }

  /* + or − on the level `key` holds. `note` is the Overall Comment the
     phone passes with a competency's + or − ('' on a rubric criterion):
     data.js sends a comment it is given again, which setPlusMinus never
     does. */
  function setPlusMinusOnPhone(cid, sid, aid, key, level, mod, note) {
    return _saved(cid, sid, aid, 'plusMinus', _writeLevelOnPhone(cid, sid, aid, key, level, note, mod));
  }

  /* The phone's Undo. The phone works out the class's scores with the
     undone cells as they were (`after`; `before` is a copy from before it
     did) and saves that list, then sends what changed between the two.
     undo, below, hands both copies to data.js, which puts back only the
     cells that still hold what was undone. */
  function undoOnPhone(cid, sid, aid, before, after) {
    var out = saveScores(cid, after);
    persistScoreDiffToCanonical(cid, before, after);
    return _saved(cid, sid, aid, 'undo', out);
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
    // The Assignments page (S1-T3)
    undoMissing: undoMissing,
    carryOverall: carryOverall,
    moveToRubric: moveToRubric,
    setReportNote: setReportNote,
    // The phone's Grade tab (S1-T2)
    setLevelOnPhone: setLevelOnPhone,
    setPlusMinusOnPhone: setPlusMinusOnPhone,
    undoOnPhone: undoOnPhone,
    undo: undo,
    returnGrades: returnTo,
  };
})();
