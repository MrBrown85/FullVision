/* report-preview.js — lays the class's form into #rb-preview (report-sheets.js). */
window.ReportPreview = (function () {
  'use strict';

  /* Lays the students into #rb-preview on the class's form. opts.students
     is the list to show; without it, selectedStudentIds filters the class
     (null means everyone). */
  function renderReportPreview(opts) {
    var preview = document.getElementById('rb-preview');
    if (!preview) return;
    var cid = opts.cid;
    var allStudents = sortStudents(getStudents(cid), 'lastName');
    var students = Array.isArray(opts.students)
      ? opts.students
      : opts.selectedStudentIds === null || opts.selectedStudentIds === undefined
        ? allStudents
        : allStudents.filter(function (s) {
            return opts.selectedStudentIds.includes(s.id);
          });
    var allScoresObj = getScores(cid);
    var hasAnyScores = Object.values(allScoresObj).some(function (arr) {
      return (
        Array.isArray(arr) &&
        arr.some(function (s) {
          return s.score > 0;
        })
      );
    });
    if (!hasAnyScores) {
      preview.innerHTML =
        '<div class="empty-state"><div class="empty-state-title">No report data yet</div><div class="empty-state-text">Score some assignments to generate progress reports.</div></div>';
    } else if (students.length === 0) {
      preview.innerHTML = '<div class="empty-state"><div class="empty-state-title">No students selected</div></div>';
    } else {
      var summary = ReportSheets.renderPreview({
        cid: cid,
        students: students,
        ctx: ReportBlocks.reportContext(),
        preview: preview,
        paper: opts.paper || 'letter',
        form: ReportSheets.formFor(opts.reportConfig),
      });
      if (typeof opts.onSheets === 'function') opts.onSheets(summary);
      return;
    }
    preview.classList.remove('report-sheets-on');
    if (typeof ReportSheets !== 'undefined') ReportSheets.clearPageStyle();
  }

  return {
    renderReportPreview: renderReportPreview,
  };
})();
