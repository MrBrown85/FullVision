/* global document, window -- installLedger runs in the app page. */
/**
 * The mark writers: every function exported by shared/data.js, the
 * shared/data-*.js files and shared/grader.js that saves, clears, returns,
 * takes back or restores a score, status, comment, note, rubric tick, DIBELS
 * score or group mark. A differential run counts how often each is called
 * on each side (the writer ledger) and prints the ones it never called: a
 * writer on that list is not guarded by the run.
 *
 * Each writer has an area, for the moves that touch it, and a reason.
 * NOT_WRITERS lists the exported functions whose names look like a writer's
 * (looksLikeWriter) but are not one, each with a reason.
 * tests/differential-writers.test.js fails when a function in those files
 * matches looksLikeWriter and is in neither list, so a new writer cannot be
 * added unseen, and when a listed name no longer exists.
 */

/* The tool's naming pattern for a writer: a verb of writing, and a word for
   a mark. Every export of window.Grader is held to the lists as well. */
export const WRITER_VERB =
  /^(set|save|upsert|clear|apply|return|undo|restore|cancel|unreturn|unsend|take|delete|fill|mark|move|carry|persist|type|copy|withdraw|reenrol|back|grade|toggle|send)/;
export const WRITER_NOUN =
  /Score|Status|Comment|Note|Check|Tick|Dibels|Grade|Group|Mark|Point|Level|Overall|Rubric|Return|Revision|Separately|Cell|Missing|Blank|Work|Student|Override/;
export function looksLikeWriter(name) {
  if (name.startsWith('Grader.')) return true;
  return WRITER_VERB.test(name) && WRITER_NOUN.test(name);
}

/* name: [area, reason]. Areas: status, score, comment, note, tick, dibels,
   group, return, override, roster. */
export const WRITERS = {
  // shared/data.js: scores
  upsertScore: ['score', 'a level under one key (competency, criterion or overall), with its + or −, date and comment'],
  setPointsScore: ['score', 'points for a piece; null clears'],
  setCompletionMark: ['score', 'Complete or Incomplete; null clears'],
  saveScores: ['score', "the class's whole score list (fills, Clear Score, Undo, delete), sending what changed"],
  persistScoreDiffToCanonical: ['score', 'sends what changed between two score lists'],
  restoreScoreCells: ['score', 'Undo of a fill: puts back the cells the fill wrote'],
  clearScoreEntries: ['score', "takes a student's entries under some keys off a score list (Clear Score)"],
  clearScore: ['score', 'clear_score: the server clears one cell'],
  clearRowScores: ['score', "clear_row_scores: every score of one student (no caller in the app's screens)"],
  clearColumnScores: ['score', "clear_column_scores: every score on one piece (no caller in the app's screens)"],
  upsertCellScore: [
    'score',
    'upsert_score for one cell; persistScoreDiffToCanonical sends a removed points score through it',
  ],
  fillRubric: ['score', "every criterion of a rubric piece to one level (no caller in the app's screens)"],
  // shared/data.js: comments and notes
  saveScoreComment: ['comment', 'the Overall Comment on a piece'],
  saveTagComment: ['comment', "a competency's comment on work with no rubric"],
  saveRubricCriterionComment: ['comment', "a rubric criterion's comment (Work On)"],
  saveRubricCriterionBeyond: ['comment', "a single-point rubric criterion's Went Beyond note"],
  saveScoreReportNote: ['note', 'the Note for the Report'],
  // ticks and DIBELS
  setRubricCheck: ['tick', "one box of an Advanced Rubric's checklist"],
  saveRubricChecks: ['tick', 'every tick in a class at once (shared/data-rubrics.js)'],
  moveRubricScores: ['score', "Edit a Copy: the piece's scores and ticks follow it to the copy's criteria"],
  saveDibelsScore: ['dibels', 'one window of a DIBELS benchmark'],
  // statuses
  setAssignmentStatus: ['status', 'Missing, Excused or Late on one cell, or taken off'],
  applyAssignmentStatus: ['status', 'a status as a teacher means it: Missing also clears the levels'],
  saveAssignmentStatuses: ['status', "the class's whole status list (Mark Blank Cells, delete), sending what changed"],
  setCellStatus: ['status', "set_score_status for one cell (no caller in the app's screens)"],
  // group grading
  setGradedSeparately: ['group', 'Grade Separately or Back to Group Grade'],
  // Draft and Returned
  returnGrades: ['return', 'Return: drafts given to students (return_grades)'],
  returnWork: ['return', 'Return with Mark Up: return_work (shared/data-markup.js)'],
  returnForRevision: ['return', 'Return for Revision (shared/data-revisions.js)'],
  cancelRevision: ['return', 'Take Back a revision request (shared/data-revisions.js)'],
  setRevisionRequest: ['return', "an open revision request's What to Fix, Revise By or criteria"],
  saveReturnSettings: ['return', "the class's Return Grades choice; turning holding off returns every waiting draft"],
  setStudentPageSwitch: ['return', "the student page's switch; off returns every waiting draft"],
  // hand-set levels
  saveOverrides: ['override', 'hand-set competency levels (shared/data-overrides.js)'],
  // roster moves that carry marks
  withdrawStudent: ['roster', "puts a student's marks aside (shared/data-withdrawn.js)"],
  reenrolStudent: ['roster', "puts a withdrawn student's marks back"],
  deleteWithdrawnStudent: ['roster', "deletes a withdrawn student's marks for good"],
  // shared/grader.js: every screen writes a grade through these
  'Grader.setLevel': ['score', 'a level, the grader dialog and Assignments page'],
  'Grader.setPlusMinus': ['score', '+ or − on a level'],
  'Grader.setPoints': ['score', 'points'],
  'Grader.setMark': ['score', 'Complete or Incomplete'],
  'Grader.setStatus': ['status', 'Missing, Excused or Late'],
  'Grader.setTick': ['tick', 'an Advanced Rubric box'],
  'Grader.setCriterionComment': ['comment', "a criterion's comment"],
  'Grader.setWentBeyond': ['comment', 'Went Beyond'],
  'Grader.setCompetencyComment': ['comment', "a competency's comment"],
  'Grader.setOverallComment': ['comment', 'the Overall Comment'],
  'Grader.setDibels': ['dibels', 'a DIBELS window'],
  'Grader.gradeSeparately': ['group', 'Grade Separately'],
  'Grader.backToGroupGrade': ['group', 'Back to Group Grade'],
  'Grader.typeLevel': ['score', 'a level typed on a gradebook cell'],
  'Grader.typePlusMinus': ['score', '+ or − typed on a gradebook cell, with its comment'],
  'Grader.clearScore': ['score', 'Clear Score in the cell menu'],
  'Grader.clearScoreOnServer': ['score', "Clear Score's server clear"],
  'Grader.undoCell': ['score', 'Undo for one gradebook cell'],
  'Grader.markBlankCells': ['status', 'Mark Blank Cells Missing or Excused'],
  'Grader.undoMarkBlankCells': ['status', 'its Undo'],
  'Grader.deleteAssessmentScores': ['score', "Delete Assessment: the piece's scores"],
  'Grader.deleteAssessmentStatuses': ['status', "Delete Assessment: the piece's statuses"],
  'Grader.undoMissing': ['status', 'Undo for Set Unmarked to Missing'],
  'Grader.carryOverall': ['score', 'an Overall level carried onto a competency ticked later'],
  'Grader.moveToRubric': ['score', 'Edit a Copy on scored work'],
  'Grader.setReportNote': ['note', 'the Note for the Report'],
  'Grader.setLevelOnPhone': ['score', "the phone Grade tab's level"],
  'Grader.setPlusMinusOnPhone': ['score', "the phone Grade tab's + or −"],
  'Grader.undoOnPhone': ['score', "the phone Grade tab's Undo"],
  'Grader.undo': ['score', 'Undo of a fill'],
  'Grader.returnGrades': ['return', 'Return and Return to All'],
  'Grader.returnForRevision': ['return', 'Return for Revision'],
  'Grader.cancelRevision': ['return', 'Take Back'],
};

/* Exported names that looksLikeWriter matches but write no mark. */
export const NOT_WRITERS = {
  applyDemoStudentPage: 'Demo Mode set-up of the student page switch, before any mark',
  backToGroupGradeSource: 'a read: the member Back to Group Grade would copy from',
  deleteRubric: 'deletes a rubric; the pieces it leaves are saved with saveAssessments',
  deleteStudentWork: "a student's sent photo, not a mark",
  markStudentCardsPrinted: 'the printed sign-in cards',
  markStudentWorkOnPaper: 'says work was handed in on paper; no mark',
  saveAssessmentStudentWork: "a piece's Send Work setting",
  saveCompetencyGroups: 'learning-map groups',
  saveDemoMarkup: "Demo Mode's store for Mark Up drawings",
  saveDemoRevisions: "Demo Mode's store under returnForRevision and cancelRevision",
  saveDemoStudentWork: "Demo Mode's store of sent photos",
  saveMarkup: 'Mark Up drawings on a photo, not a mark',
  saveNotes: 'student notes, not marks on work',
  saveRubrics: 'rubric definitions, not marks',
  saveStudents: 'the roster',
  sendStudentReflection: "the student's own reflection",
  sendStudentReply: "the student's reply to feedback",
  sendStudentRevision: "the student's revised work",
  setCardsWorkUntil: 'sign-in cards',
  setCourseSendWork: "the class's Send Work switch",
  setRubricPrints: 'which rubrics are printed',
  setSectionGroup: 'learning-map groups',
  setStudentFollowedPlan: "the student's reflection",
  unsendStudentRevision: "the student's revised work",
};

export const WRITER_NAMES = Object.keys(WRITERS).sort();

/* Runs in every page (context.addInitScript) before the app: once the
   page's scripts have run, each writer that exists is wrapped so that a
   call is told to the run (window.__diffWriterCalled, a binding the run
   adds) and then made exactly as before, with the same `this`, arguments
   and answer. Nothing is stored in the page. A writer called while the
   page's own scripts are still loading is not counted. */
export function installLedger(names) {
  if (window.__diffLedgerOn) return;
  window.__diffLedgerOn = true;
  const tell = name => {
    try {
      const p = window.__diffWriterCalled(name);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // The binding is gone (the page is closing): nothing to count.
    }
  };
  const wrapAll = () => {
    for (const full of names) {
      const inGrader = full.startsWith('Grader.');
      const holder = inGrader ? window.Grader : window;
      const key = inGrader ? full.slice(7) : full;
      if (!holder) continue;
      const fn = holder[key];
      if (typeof fn !== 'function' || fn.__diffLedger) continue;
      const wrapped = function () {
        tell(full);
        return fn.apply(this, arguments);
      };
      Object.defineProperty(wrapped, '__diffLedger', { value: true });
      holder[key] = wrapped;
    }
  };
  document.addEventListener('DOMContentLoaded', wrapAll);
}

/* The ledger's lines for one mode: the writers called on each side with
   their counts (A | B where the two differ), and those not called on one
   side or both. */
export function ledgerLines(mode, ledgers) {
  const [a, b] = ledgers;
  const called = WRITER_NAMES.filter(n => a[n] || b[n]).map(n =>
    (a[n] || 0) === (b[n] || 0) ? n + ' ' + a[n] : n + ' A ' + (a[n] || 0) + ' | B ' + (b[n] || 0),
  );
  const none = WRITER_NAMES.filter(n => !a[n] && !b[n]);
  return [
    mode + ': writers called (' + called.length + ' of ' + WRITER_NAMES.length + '): ' + (called.join(', ') || 'none'),
    mode + ': writers not called, so not guarded by this run: ' + (none.join(', ') || 'none'),
  ];
}

/* The names of `must` that were not called on both sides, over the whole
   run (`ledgers`: one per side, every mode added up). */
export function unreached(must, ledgers) {
  return must.filter(n => !ledgers.every(l => l[n] > 0));
}
