/* student-groups.js — the Student page's groups of assessments (the Grades tab's Group By), not groups of students.
   Moved from teacher/page-student.js on 2026-11-12. */
window.StudentGroups = (function () {
  'use strict';

  /* ── Groups of assessments (the Grades tab's Group By) ── */
  var TYPE_ORDER = ['written', 'observation', 'audio', 'video', 'photo', 'conversation'];
  function _typeLabel(t) {
    return t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : 'No Type';
  }

  function _rubricIdOf(a) {
    return isPointsScored(a) ? '' : a.rubricId || a.rubric_id || '';
  }

  /* A category group takes its category's Calculation (Total Points or
     Average of Percentages); a module, type or rubric group is points. */
  function _groupCalcMode(g) {
    return g && g.category ? categoryCalcMode(g.category) : 'points';
  }

  /* Assessments sorted into groups by category, module, assignment type or
     rubric, in the class's own order, with the ones in no group last. Each
     group is { key, name, assessments, category?, rubric? }; empty groups
     are left out. */
  function _assessGroups(cid, assessments, by) {
    var groups = [];
    var add = function (key, name, extra) {
      var list = assessments.filter(function (a) {
        return _groupKeyOf(cid, a, by) === key;
      });
      if (list.length) groups.push(Object.assign({ key: key, name: name, assessments: list }, extra || {}));
    };
    if (by === 'category') {
      (getCategories(cid) || []).forEach(function (cat) {
        add(cat.id, cat.name, { category: cat });
      });
      add('', 'No Category');
    } else if (by === 'module') {
      (getModules(cid) || []).forEach(function (m) {
        add(m.id, m.name || 'Untitled Module');
      });
      add('', 'No Module');
    } else if (by === 'type') {
      var seen = [];
      assessments.forEach(function (a) {
        var t = a.evidenceType || '';
        if (t && seen.indexOf(t) < 0) seen.push(t);
      });
      seen.sort(function (x, y) {
        var ix = TYPE_ORDER.indexOf(x);
        var iy = TYPE_ORDER.indexOf(y);
        if (ix < 0 && iy < 0) return x.localeCompare(y);
        if (ix < 0) return 1;
        if (iy < 0) return -1;
        return ix - iy;
      });
      seen.forEach(function (t) {
        add(t, _typeLabel(t));
      });
      add('', 'No Type');
    } else if (by === 'rubric') {
      var ids = [];
      assessments.forEach(function (a) {
        var r = _rubricIdOf(a);
        if (r && ids.indexOf(r) < 0) ids.push(r);
      });
      ids.forEach(function (rid) {
        var rubric = getRubricById(cid, rid);
        add(rid, (rubric && rubric.name) || 'Rubric', { rubric: rubric });
      });
      add('', 'No Rubric');
    }
    return groups;
  }

  function _groupKeyOf(cid, a, by) {
    if (by === 'category') return getAssessmentCategoryId(a) || '';
    if (by === 'module') {
      var mid = a.moduleId || '';
      return mid &&
        (getModules(cid) || []).some(function (m) {
          return m.id === mid;
        })
        ? mid
        : '';
    }
    if (by === 'type') return a.evidenceType || '';
    if (by === 'rubric') return _rubricIdOf(a);
    return '';
  }

  /* A group grade as a tinted pill, as the class shows grades. */
  function _gradePill(g) {
    return '<span class="stu-level stu-level-' + (g ? g.level : 0) + '">' + esc(g ? g.text : '\u2014') + '</span>';
  }

  return {
    typeLabel: _typeLabel,
    groupCalcMode: _groupCalcMode,
    assessGroups: _assessGroups,
    gradePill: _gradePill,
  };
})();
