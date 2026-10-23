/* rubric-checks.js — the level rule for Advanced Rubrics.
 *
 * An Advanced Rubric's level cells hold checkboxes as well as a descriptor
 * (criterion.checks: [{ id, level 1..4, label, displayOrder }]). While
 * scoring, the teacher ticks what they saw and FullVision suggests the
 * level: the highest level whose boxes are all ticked. A level with no
 * boxes is never suggested.
 *
 * Nothing records whether a level came from the checks or by hand (Rubric
 * Bank plan §5, decided 2026-10-22). Instead a tick compares the level the
 * student has with what the boxes suggested before the tick: if they matched,
 * or no level was set, the new suggestion replaces it; if not, the teacher
 * picked that level and it stays until they clear it.
 *
 * Pure functions over the criterion and the ticked ids: no data is read or
 * written here. shared/data.js keeps the ticks (getRubricCheckIds,
 * setRubricCheck); the scoring UI writes the level it gets back.
 */
window.RubricChecks = (function () {
  'use strict';

  var LEVELS = [4, 3, 2, 1];

  function _ids(ticked) {
    if (!ticked) return new Set();
    if (ticked instanceof Set) return ticked;
    return new Set(Array.isArray(ticked) ? ticked : [ticked]);
  }

  /* The checkboxes of one level, in display order. */
  function checksAt(criterion, level) {
    return ((criterion && criterion.checks) || [])
      .filter(function (check) {
        return check && Number(check.level) === Number(level);
      })
      .slice()
      .sort(function (a, b) {
        return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
      });
  }

  function hasChecks(criterion) {
    return !!(criterion && criterion.checks && criterion.checks.length);
  }

  /* The level the ticked boxes suggest: the highest level whose boxes are all
     ticked, or 0 when no level is complete. */
  function suggestedLevel(criterion, ticked) {
    var on = _ids(ticked);
    for (var i = 0; i < LEVELS.length; i++) {
      var level = LEVELS[i];
      var boxes = checksAt(criterion, level);
      if (!boxes.length) continue;
      var all = boxes.every(function (check) {
        return on.has(check.id);
      });
      if (all) return level;
    }
    return 0;
  }

  /* The level to write after a tick or untick: `currentLevel` is the level
     the student has now (0 or null for none), `tickedBefore` the ticked ids
     before this change and `tickedAfter` the ticked ids after it. Returns
     the new suggestion when the current level was unset or came from the
     boxes, else the current level; 0 means no level. */
  function levelAfterTick(criterion, currentLevel, tickedBefore, tickedAfter) {
    var current = Number(currentLevel) || 0;
    var before = suggestedLevel(criterion, tickedBefore);
    var after = suggestedLevel(criterion, tickedAfter);
    if (current === 0 || current === before) return after;
    return current;
  }

  /* How many of a criterion's boxes are ticked: { ticked, total }. */
  function tickedCount(criterion, ticked) {
    var on = _ids(ticked);
    var checks = (criterion && criterion.checks) || [];
    var n = 0;
    checks.forEach(function (check) {
      if (check && on.has(check.id)) n++;
    });
    return { ticked: n, total: checks.length };
  }

  /* Every checkbox in a rubric, for "{n} Criteria · {k} Checkboxes". */
  function countChecks(rubric) {
    return ((rubric && rubric.criteria) || []).reduce(function (sum, criterion) {
      return sum + (((criterion && criterion.checks) || []).length || 0);
    }, 0);
  }

  return {
    LEVELS: LEVELS,
    checksAt: checksAt,
    hasChecks: hasChecks,
    suggestedLevel: suggestedLevel,
    levelAfterTick: levelAfterTick,
    tickedCount: tickedCount,
    countChecks: countChecks,
  };
})();
