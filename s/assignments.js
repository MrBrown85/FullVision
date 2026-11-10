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
   teacher's gradebook cell does. Nothing here formats a grade, and nothing
   here holds a grade's value: with calc.js not in (app.js fetches it before
   this screen opens; the fetch can fail) a returned piece shows when it
   came back and no result, and the list says the results didn't load.

   One list, two sources: the server's `page` reply for a real card and
   Demo Mode's reply built on the device both go through
   StudentData.fromServer and then through this file, so the two cannot
   show a piece differently.

   A returned grade that was changed and returned again is marked Updated
   until the student has opened it. In this build the list is where a
   result is read, so a piece counts as opened once its row has been on
   screen in a visible tab (Colin, Nov 10). A row that could be opened
   (returned, its result drawn, not opened since it came back) carries its
   piece's id as data-unseen; app.js watches those rows and tells the
   server (`seen`). No other row carries a mark, so a piece with a draft
   still reads exactly as a piece never graded.

   app.js opens this screen after Is This You? and draws the frame around
   it. This file adds its screen with StudentPage.addScreens. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var fmtDate = StudentPage.fmtDate;

  var NO_RESULTS = 'Your results didn’t load. Check your internet and try again.';

  function gradesAreIn() {
    return typeof assessmentCellValue === 'function';
  }

  var SEP = ' · ';
  var DAY = { month: 'short', day: 'numeric' };
  var DUE_DAY = { weekday: 'short', month: 'short', day: 'numeric' };

  /* What one row says, from the page (student-data.js's shape) and one of
     its assessments: { kind, title, sub, result }.
     kind: 'back' (returned), 'missing', 'excused', or 'due' (anything else:
     not graded, or graded and not returned, which look the same).
     result is '' unless the piece was returned with a score and calc.js is
     in to word it. */
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
    var cell = gradesAreIn() ? assessmentCellValue(cid, page.student.id, a) : { kind: 'none' };
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
    if (a.updated) bits.push('Updated');
    view.sub = bits.join(SEP);
    // A result is on the row and the student has not opened it since it came back.
    if (a.unseen && view.result !== '') view.unseen = a.id;
    return view;
  }

  // When the teacher made a piece, in milliseconds, or null when the
  // server has not said.
  function madeAt(a) {
    // To the millisecond, as calc.js reads it and as every browser can.
    var t = a.created_at ? Date.parse(String(a.created_at).replace(/(\.\d{3})\d+/, '$1')) : NaN;
    return isFinite(t) ? t : null;
  }

  /* Newest first, by due date, or the date with none. Two pieces with the
     same date: the one made later is the later one (Colin, Nov 10), so it
     is listed first; two made at the same instant fall to their ids. Where
     the server has not said when a piece was made, the two stay in the
     order they came in, as before. */
  function inOrder(assessments) {
    return assessments.slice().sort(function (x, y) {
      var a = x.dueDate || x.date || '';
      var b = y.dueDate || y.date || '';
      if (a !== b) return a < b ? 1 : -1;
      var m = madeAt(x);
      var n = madeAt(y);
      if (m == null || n == null) return 0;
      if (m !== n) return m < n ? 1 : -1;
      return x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
    });
  }

  function rowHtml(view) {
    return (
      '<li class="sp-row"' +
      (view.unseen ? ' data-unseen="' + esc(view.unseen) + '"' : '') +
      '><span class="sp-dot sp-dot-' +
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

  /* The line over the list when calc.js didn't arrive and a piece has come
     back: the results are missing, not empty. */
  function noResultsHtml(state) {
    var page = state.page;
    var any =
      page &&
      page.assessments.some(function (a) {
        return !!a.returnedAt;
      });
    if (gradesAreIn() || !any) return '';
    return (
      '<div class="sp-no-results"><p class="sp-msg sp-msg-calm" role="status">' +
      esc(NO_RESULTS) +
      '</p><button type="button" class="sp-btn sp-btn-quiet sp-btn-small" data-act="grades-retry"' +
      (state.sending ? ' disabled' : '') +
      '>' +
      (state.sending ? 'Loading…' : 'Try Again') +
      '</button></div>'
    );
  }

  function renderAssignments(state) {
    return StudentPage.pageFrame(
      state,
      // The page's first words, where the keyboard and a screen reader start (app.js moves there).
      '<h1 class="sp-page-title" tabindex="-1">Assignments</h1>' + noResultsHtml(state) + listHtml(state.page),
    );
  }

  StudentPage.addScreens({
    file: 'assignments',
    render: { assignments: renderAssignments },
    // The screen reads the state it is handed; it keeps none of its own.
    share: function () {},
    test: { rowView: rowView, listHtml: listHtml, inOrder: inOrder },
  });
})();
