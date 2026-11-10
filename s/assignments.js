/* The Assignments list on a student's page (docs/plans/
   student-page-build-plan.md, S0-F3; the artboard's "All Assignments" rows):
   every piece of work in the class with its date and, once the teacher has
   returned it, the result.

   The line this build protects: a grade that was never returned shows
   nothing at all. No level, no "draft", no hint that one exists. The page's
   data holds returned grades only (student-data.js), and a row asks calc.js
   for a result only when the piece has a return date.

   The result is worked out and worded by shared/calc.js and
   shared/constants.js (assessmentCellValue, levelWord, formatPoints), fed by
   student-data.js, so it follows the class's grading style and reads as the
   teacher's gradebook cell does. Nothing here formats a grade.

   app.js opens this screen after Is This You? and draws the frame around
   it. This file adds its screen with StudentPage.addScreens. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var fmtDate = StudentPage.fmtDate;

  var SEP = ' · ';
  var DAY = { month: 'short', day: 'numeric' };
  var DUE_DAY = { weekday: 'short', month: 'short', day: 'numeric' };

  /* What one row says, from the page (student-data.js's shape) and one of
     its assessments: { kind, title, sub, result }.
     kind: 'back' (returned), 'missing', 'excused', or 'due' (anything else:
     not graded, or graded and not returned, which look the same).
     result is '' unless the piece was returned with a score. */
  function rowView(page, a) {
    var due = a.dueDate ? 'Due ' + fmtDate(a.dueDate, DUE_DAY) : a.date ? fmtDate(a.date, DAY) : '';
    var view = { kind: 'due', title: a.title, sub: due, result: '' };
    // Missing and Excused stand in place of a result. They are never drafts
    // and show as soon as the teacher sets them.
    if (a.status === 'NS' || a.status === 'EXC') {
      view.kind = a.status === 'NS' ? 'missing' : 'excused';
      view.sub = [a.status === 'NS' ? 'Missing' : 'Excused', due].filter(Boolean).join(SEP);
      return view;
    }
    // Not returned: the date only, whether or not a draft exists.
    if (!a.returnedAt) {
      if (a.status === 'LATE') view.sub = ['Late', due].filter(Boolean).join(SEP);
      return view;
    }
    var cid = page.course.id;
    var cell = assessmentCellValue(cid, page.student.id, a);
    var bits = ['Back ' + fmtDate(a.returnedAt, DAY)];
    view.kind = 'back';
    if (cell.kind === 'level') {
      var word = levelWord(cid, cell.value);
      if (word) bits.push(word);
      view.result = cell.text;
    } else if (cell.kind === 'points') {
      view.result = formatPoints(cell.value) + ' / ' + formatPoints(a.maxPoints || 100);
    } else if (cell.kind === 'complete') {
      view.result = cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    }
    if (a.status === 'LATE') bits.push('Late');
    view.sub = bits.join(SEP);
    return view;
  }

  // Newest first, by due date, or the date with none.
  function inOrder(assessments) {
    return assessments.slice().sort(function (x, y) {
      var a = x.dueDate || x.date || '';
      var b = y.dueDate || y.date || '';
      return a < b ? 1 : a > b ? -1 : 0;
    });
  }

  function rowHtml(view) {
    return (
      '<li class="sp-row"><span class="sp-dot sp-dot-' +
      view.kind +
      '" aria-hidden="true"></span>' +
      '<span class="sp-row-text"><span class="sp-row-title">' +
      esc(view.title) +
      '</span>' +
      (view.sub ? '<span class="sp-row-sub">' + esc(view.sub) + '</span>' : '') +
      '</span>' +
      (view.result ? '<span class="sp-row-result">' + esc(view.result) + '</span>' : '') +
      '</li>'
    );
  }

  function listHtml(page) {
    var rows = inOrder((page && page.assessments) || []);
    if (!rows.length) return '<p class="sp-lead sp-empty">No assignments yet.</p>';
    return (
      '<ul class="sp-list">' +
      rows
        .map(function (a) {
          return rowHtml(rowView(page, a));
        })
        .join('') +
      '</ul>'
    );
  }

  function renderAssignments(state) {
    return StudentPage.pageFrame(state, '<h1 class="sp-page-title">Assignments</h1>' + listHtml(state.page));
  }

  StudentPage.addScreens({
    file: 'assignments',
    render: { assignments: renderAssignments },
    // The screen reads the state it is handed; it keeps none of its own.
    share: function () {},
    test: { rowView: rowView, listHtml: listHtml },
  });
})();
