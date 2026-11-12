/* gradebook-csv.js — the Gradebook's Export CSV (Scores tab toolbar).
   Moved from teacher/page-gradebook.js on 2026-11-12. */
window.GradebookCsv = (function () {
  'use strict';

  /* Handed over by PageGradebook (configure) just before each export. */
  var activeCourse;
  var _getStudentLetterData;
  var _getDisplayedFinalPercent;
  var _csvAverageText;

  function configure(cid, fns) {
    activeCourse = cid;
    _getStudentLetterData = fns._getStudentLetterData;
    _getDisplayedFinalPercent = fns._getDisplayedFinalPercent;
    _csvAverageText = fns._csvAverageText;
  }

  /* ── Scores tab: CSV export ─────────────────────────────── */
  /* A score as the CSV prints it: what the Scores view shows, as plain text. */
  function _csvCellText(cell) {
    if (cell.kind === 'status') return cell.status;
    if (cell.kind === 'complete') return cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    if (cell.kind === 'points') return formatPoints(cell.value);
    if (cell.kind === 'level') return formatLevelAs(null, cell.value, 'proficiency');
    if (cell.kind === 'dibels') return cell.dibels ? cell.text : '';
    return '';
  }

  function exportScoresCSV() {
    var cid = activeCourse;
    var students = sortStudents(getStudents(cid), 'lastName');
    // The export matches the page: the year so far.
    var assessments = getAssessments(cid)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    var sections = getSections(cid);
    var grouped = getGroupedSections(cid);
    var hasGroups = grouped.groups.some(function (g) {
      return g.sections.length > 0;
    });
    var isLetter = courseShowsLetterGrades(COURSES[cid]);

    // Build header
    var headers = ['Student'];
    if (hasGroups) {
      grouped.groups.forEach(function (gi) {
        if (gi.sections.length > 0) headers.push(gi.group.name + ' (Group Avg)');
      });
    }
    sections.forEach(function (sec) {
      headers.push(sec.shortName || sec.name);
    });
    headers.push('Overall', 'Final %');
    if (isLetter) headers.push('Grade');
    assessments.forEach(function (a) {
      headers.push(a.title + ' (' + (a.date || '') + ')');
    });

    var rows = [headers];
    students.forEach(function (s) {
      var row = [fullName(s)];
      // Group averages
      if (hasGroups) {
        grouped.groups.forEach(function (gi) {
          if (gi.sections.length === 0) return;
          var gp = getGroupProficiency(cid, s.id, gi.group.id);
          row.push(gp > 0 ? gp.toFixed(2) : '');
        });
      }
      // Individual sections
      sections.forEach(function (sec) {
        var sp = getSectionProficiency(cid, s.id, sec.id);
        row.push(sp > 0 ? sp.toFixed(2) : '');
      });
      // Overall + final %
      var overall = getOverallProficiency(cid, s.id);
      var letterData = _getStudentLetterData(cid, s.id);
      row.push(overall > 0 ? overall.toFixed(2) : '');
      // The % as the class shows it (whole or one decimal), as the Grade column has it.
      var finalPct = _getDisplayedFinalPercent(cid, s.id);
      row.push(finalPct != null ? formatCoursePercent(cid, finalPct) : '');
      if (isLetter) row.push(letterData.S ? letterData.S + ' (' + letterData.R + '%)' : '');
      // Assessment scores, as the Scores view shows them (calc.js)
      assessments.forEach(function (a) {
        row.push(_csvCellText(assessmentCellValue(cid, s.id, a)));
      });
      rows.push(row);
    });
    // Class Average under each assessment, by calc.js's one column rule
    var avgRow = ['Class Average'];
    for (var pad = 1; pad < headers.length - assessments.length; pad++) avgRow.push('');
    assessments.forEach(function (a) {
      avgRow.push(_csvAverageText(cid, a, classColumnAverage(cid, students, { assessment: a })));
    });
    rows.push(avgRow);

    var csv = rows
      .map(function (r) {
        return r
          .map(function (c) {
            return '"' + String(c).replace(/"/g, '""') + '"';
          })
          .join(',');
      })
      .join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (COURSES[cid] ? COURSES[cid].name : 'gradebook') + '_scores.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    configure: configure,
    exportScoresCSV: exportScoresCSV,
  };
})();
