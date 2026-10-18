/**
 * Guards for editing a rubric that already carries scores.
 *
 * A rubric criterion's scores are stored per criterion on the server and
 * fanned out to its competencies on the client (rubricCriterionScoreKeys), so
 * removing a criterion drops every score entered under it, and changing a
 * criterion's top value changes what past scores are worth. The editor asks
 * before the first and says so for the second. Nothing here writes data.
 */
(function () {
  'use strict';

  /* The assessments of a class that grade with this rubric. */
  function rubricAssessments(cid, rubricId) {
    return (getAssessments(cid) || []).filter(function (a) {
      return a && (a.rubricId || a.rubric_id) === rubricId;
    });
  }

  /* How many students have a score on each criterion of `rubric`, as
     { criterionId: count }. A score counts once per student however many
     competencies the criterion feeds. */
  function scoredStudentsByCriterion(cid, rubric) {
    var counts = {};
    if (!rubric || !rubric.criteria) return counts;
    var assessIds = {};
    rubricAssessments(cid, rubric.id).forEach(function (a) {
      assessIds[a.id] = true;
    });
    var scores = getScores(cid) || {};
    rubric.criteria.forEach(function (crit) {
      if (!crit) return;
      var keys = rubricCriterionScoreKeys(crit);
      var n = 0;
      Object.keys(scores).forEach(function (sid) {
        var hit = (scores[sid] || []).some(function (entry) {
          return (
            entry &&
            assessIds[entry.assessmentId] &&
            keys.indexOf(entry.tagId) >= 0 &&
            entry.score != null &&
            entry.score !== ''
          );
        });
        if (hit) n++;
      });
      counts[crit.id] = n;
    });
    return counts;
  }

  /* The top point value of a criterion as the editor stores it: the level
     overrides when set, else the default 4. */
  function topValue(crit) {
    var lv = (crit && crit.levelValues) || {};
    var max = 0;
    [1, 2, 3, 4].forEach(function (l) {
      var v = lv[l] != null && lv[l] !== '' ? Number(lv[l]) : l;
      if (!isNaN(v) && v > max) max = v;
    });
    return max;
  }

  /* Compare the rubric as saved (`before`) with the edit in progress
     (`after`). `counts` comes from scoredStudentsByCriterion(before).
     Returns { removed: [{ id, name, students }], topChanged: [{ id, name,
     from, to, students }] }, listing only criteria that have scores. */
  function reviewEdit(before, after, counts) {
    var out = { removed: [], topChanged: [] };
    if (!before || !before.criteria) return out;
    var afterById = {};
    ((after && after.criteria) || []).forEach(function (c) {
      if (c) afterById[c.id] = c;
    });
    before.criteria.forEach(function (crit) {
      if (!crit) return;
      var students = counts[crit.id] || 0;
      if (!students) return;
      var next = afterById[crit.id];
      if (!next) {
        out.removed.push({ id: crit.id, name: crit.name, students: students });
        return;
      }
      var from = topValue(crit);
      var to = topValue(next);
      if (from !== to) out.topChanged.push({ id: crit.id, name: crit.name, from: from, to: to, students: students });
    });
    return out;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  /* The question asked before a scored criterion is removed. */
  function removeMessage(crit, students) {
    return (
      '"' +
      (crit && crit.name ? crit.name : 'This criterion') +
      '" has scores from ' +
      plural(students, 'student') +
      '. Removing it drops those scores from every assessment that uses this rubric.'
    );
  }

  /* The note shown while a scored criterion's top value differs from the
     saved one, or '' when nothing changed. */
  function topChangeNote(review) {
    var list = (review && review.topChanged) || [];
    if (!list.length) return '';
    var names = list
      .map(function (c) {
        return '"' + c.name + '" (' + c.from + ' to ' + c.to + ' points)';
      })
      .join(', ');
    return (
      'Top value changed for ' +
      names +
      '. Past scores keep their level, but overall grades on assessments using this rubric will change.'
    );
  }

  window.RubricGuard = {
    rubricAssessments: rubricAssessments,
    scoredStudentsByCriterion: scoredStudentsByCriterion,
    topValue: topValue,
    reviewEdit: reviewEdit,
    removeMessage: removeMessage,
    topChangeNote: topChangeNote,
  };
})();
