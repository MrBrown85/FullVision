/* report-preview.js — Report preview rendering helpers */
window.ReportPreview = (function () {
  'use strict';

  function renderStudentReport(cid, student, reportConfig, ctx) {
    ctx = ctx || ReportBlocks.reportContext();
    var html = '<div class="report-student">';
    reportConfig.blocks.forEach(function (block) {
      if (block.enabled) html += ReportBlocks.renderReportBlock(block.id, cid, student, ctx);
    });
    html += '</div>';
    return html;
  }

  function renderClassSummary(cid, classSummaryAnon) {
    var course = COURSES[cid];
    var sections = getSections(cid);
    var students = sortStudents(getStudents(cid), 'lastName');
    if (classSummaryAnon) students = anonymizeStudents(students);
    var isLetter = courseShowsLetterGrades(course);

    var html =
      '<h2 style="font-family:var(--font-base);font-size:1.3rem;margin-bottom:12px">' +
      esc(course.name) +
      ' &mdash; Class Summary</h2>';
    html += '<table class="class-summary-table"><thead><tr><th scope="col">Student</th>';

    sections.forEach(function (sec) {
      html += '<th scope="col">' + esc(sec.shortName || sec.name) + '</th>';
    });

    html += '<th scope="col">Overall</th>';
    if (isLetter) html += '<th scope="col">Letter Grade</th>';
    html += '</tr></thead><tbody>';

    students.forEach(function (st) {
      var nameDisplay = classSummaryAnon
        ? esc(st._anonLabel)
        : '<a href="#" data-action="summaryStudentClick" data-sid="' +
          st.id +
          '" style="color:inherit;text-decoration:none">' +
          esc(fullName(st)) +
          '</a>';
      html += '<tr><td class="class-summary-name">' + nameDisplay + '</td>';
      sections.forEach(function (sec) {
        var sp = getSectionProficiency(cid, st.id, sec.id);
        var sr = Math.round(sp);
        var slabel = sp > 0 ? PROF_LABELS[sr] : '—';
        var scolor = sp > 0 ? PROF_COLORS[sr] : 'var(--text-3)';
        html +=
          '<td data-prof="' +
          sr +
          '" style="color:' +
          scolor +
          ';font-weight:600">' +
          (sp > 0 ? ReportBlocks.levelDots(sr) : '') +
          slabel +
          '</td>';
      });
      var op = getOverallProficiency(cid, st.id);
      var or2 = Math.round(op);
      var olabel = op > 0 ? PROF_LABELS[or2] : '—';
      var ocolor = op > 0 ? PROF_COLORS[or2] : 'var(--text-3)';
      html +=
        '<td data-prof="' +
        or2 +
        '" style="color:' +
        ocolor +
        ';font-weight:700">' +
        (op > 0 ? ReportBlocks.levelDots(or2) : '') +
        olabel +
        '</td>';
      if (isLetter) {
        var letterData = getCourseLetterData(cid, st.id);
        html +=
          '<td style="font-weight:700">' +
          (letterData && letterData.S ? letterData.S + ' (' + letterData.R + '%)' : '—') +
          '</td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  function renderReportPreview(opts) {
    var preview = document.getElementById('rb-preview');
    if (!preview) return;
    var cid = opts.cid;
    var selectedStudentIds = opts.selectedStudentIds;
    var reportConfig = opts.reportConfig;
    var allStudents = sortStudents(getStudents(cid), 'lastName');
    var students =
      selectedStudentIds === null
        ? allStudents
        : allStudents.filter(function (s) {
            return selectedStudentIds.includes(s.id);
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
      preview.innerHTML =
        '<div style="text-align:center;color:var(--text-3);padding:40px 0;font-size:0.95rem">Select students above to generate reports.</div>';
    } else if (ReportBuilderUI.usesSheets(reportConfig)) {
      var summary = ReportSheets.renderPreview({
        cid: cid,
        students: students,
        ctx: ReportBlocks.reportContext(),
        preview: preview,
        paper: opts.paper || 'letter',
      });
      var line = document.getElementById('rb-form-summary');
      if (line) line.textContent = ReportSheets.summaryText(summary);
      if (typeof opts.onSheets === 'function') opts.onSheets(summary);
      return;
    } else {
      var ctx = ReportBlocks.reportContext();
      preview.innerHTML = students
        .map(function (st) {
          return renderStudentReport(cid, st, reportConfig, ctx);
        })
        .join('');
    }
    preview.classList.remove('report-sheets-on');
    if (typeof ReportSheets !== 'undefined') ReportSheets.clearPageStyle();
  }

  return {
    renderStudentReport: renderStudentReport,
    renderClassSummary: renderClassSummary,
    renderReportPreview: renderReportPreview,
  };
})();
