/* grade-state.js — the Draft and Returned rule.
 *
 * Every grade is Draft or Returned
 * (docs/plans/student-page-build-plan.md, 1.2). Today there is no Draft:
 * every save is returned at once, and nothing about the state is stored,
 * shown or sent. This file only says so, in the two functions the rule
 * will live in. shared/grader.js calls afterSave after each grade it
 * writes.
 *
 * What lands here later:
 * - S0-F2: Draft. In a class set to When I Return Them (and the build
 *   switch on), a save makes the grade a draft and keeps the copy the
 *   student was last given; Missing, Excused and Late are never drafts.
 *   shared/data.js starts calling this on every score write, so Demo Mode
 *   and offline work follow the rule too, and the state is kept beside the
 *   scores. Return is added.
 * - S0-W1: the same state read from and sent to the server (grade_return).
 * - Later slices: the other states a piece can be in (Not In, To Grade,
 *   Revising).
 * One file of worked cases will run through this and through the SQL
 * triggers, so the two cannot drift.
 */
window.GradeState = (function () {
  'use strict';

  var RETURNED = 'returned';

  /* A grade was saved for student `sid` on assessment `aid`; `what` names
     the kind of save ('level', 'points', 'status' …). Returns the state the
     piece is in after it. Today that is Returned, whatever was saved. */
  function afterSave(cid, sid, aid, what) {
    return RETURNED;
  }

  /* The state `sid`'s piece of work on `aid` is in: Returned once it has a
     score or feedback, null while it has neither. */
  function stateOf(cid, sid, aid) {
    return hasScoreOrFeedback(cid, sid, aid) ? RETURNED : null;
  }

  return {
    RETURNED: RETURNED,
    afterSave: afterSave,
    stateOf: stateOf,
  };
})();
