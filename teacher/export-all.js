/* Download All My Data: one Excel workbook with every class's student data,
   so a teacher is never trapped in FullVision and the file makes sense when
   it is opened (docs/DECISIONS.md, "Download All My Data").

   Two halves. `rows(opts)` is pure: it reads the loaded classes through the
   data layer and returns plain sheets (arrays of strings, numbers and
   'YYYY-MM-DD' dates), which the unit tests check. `workbook(sheets,
   ExcelJS)` turns them into a styled workbook. `run()` is the button:
   it loads every class, builds the file and downloads it.

   Every grade is read through calc.js (assessmentCellValue,
   studentGradeSummary, classColumnAverageText, formatLevel); nothing here
   computes one. Grades read exactly as the class shows them. The export is
   read-only: there is no import. A class backup for restoring is Class
   Settings → Class Actions → Download Class Backup. */
(function () {
  'use strict';

  /* The export is the teacher's own record: all work, drafts included
     (student page build plan 1.3). That is said in one place, ReportScores'
     table (teacher/report-scores.js, 'exportData'), and rows() runs inside
     ReportScores.withReportScores so nothing else can decide it. Comments,
     notes and statuses are read through ReportScores' readers, which have
     the data layer's names. */
  rows = ReportScores.scoped('exportData', rows);

  var LIB_URL = '/vendor/exceljs.min.js';
  var TEXT_WIDTH = 60;

  // The gradebook's soft level colours (teacher/gradebook.css .gb-grid).
  var LEVEL_FILL = { 1: 'FEE2E2', 2: 'F3ECDA', 3: 'DDE9DE', 4: 'DAEAEE' };
  var LEVEL_TEXT = { 1: '991B1B', 2: '7A5A1E', 3: '365C3A', 4: '2A5868' };

  var HABIT_WORDS = { 1: 'Rarely', 2: 'Sometimes', 3: 'Usually', 4: 'Consistently', 5: 'Not Seen' };

  /* ── Small helpers ─────────────────────────────────────────── */

  function day(v) {
    if (!v) return '';
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }

  function text(v) {
    return v == null ? '' : String(v);
  }

  /* A comment saved as HTML by the old editor, as plain text. */
  function plain(stored) {
    var s = text(stored);
    if (!/<[a-z][^>]*>/i.test(s)) return s;
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '')
      .replace(/<[^>]*>/g, '');
    return s
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sortByDate(list, key) {
    return list.slice().sort(function (a, b) {
      return (a[key] || '').localeCompare(b[key] || '');
    });
  }

  /* The classes the export covers, in the order the app lists them. */
  function classIds() {
    var all = typeof COURSES !== 'undefined' ? COURSES : {};
    var list = Object.keys(all)
      .filter(function (cid) {
        return !isCourseArchived(cid);
      })
      .map(function (cid) {
        return Object.assign({}, all[cid], { id: cid });
      });
    return sortCoursesByBlock(list).map(function (c) {
      return c.id;
    });
  }

  function className(cid) {
    var c = COURSES[cid] || {};
    return coursePickerName(c) || c.name || 'Class';
  }

  function studentName(st) {
    return displayName(st);
  }

  /* An Excel sheet name: 31 characters at most, none of []:*?/\, unique. */
  function sheetName(name, taken) {
    var base = String(name || 'Sheet')
      .replace(/[\[\]\*\?\/\\:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31);
    if (!base) base = 'Sheet';
    var out = base;
    var n = 2;
    while (taken[out.toLowerCase()]) {
      var tail = ' (' + n + ')';
      out = base.slice(0, 31 - tail.length) + tail;
      n++;
    }
    taken[out.toLowerCase()] = true;
    return out;
  }

  /* A level from 0 to 4 as the grader names it ("Proficient +") and as a
     figure ("3+"); '' when there is none. */
  function criterionLevelText(v) {
    if (!(v > 0)) return { word: '', figure: '' };
    var step = SCORE_MOD_STEP;
    var steps = Math.round(v / step);
    var level = Math.max(1, Math.min(4, Math.round(steps * step)));
    var mod = Math.round((steps * step - level) / step);
    return { word: scoreLevelText(level, mod), figure: nearestScoreLevel(v).text };
  }

  /* A score as the Scores view shows it, in words a spreadsheet reader
     follows: Missing and Excused in full, Complete / Incomplete, points out
     of the maximum ("8/10"), levels as the class shows them, DIBELS as the
     reading level. */
  function cellText(cell, assessment) {
    var t = '';
    if (cell.kind === 'status') t = cell.status === 'NS' ? 'Missing' : 'Excused';
    else if (cell.kind === 'complete') t = cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    else if (cell.kind === 'points')
      t = formatPoints(cell.value) + '/' + formatPoints(Number(assessment && assessment.maxPoints) || 100);
    else if (cell.kind === 'level') t = cell.text;
    else if (cell.kind === 'dibels') t = cell.dibels ? cell.text : '';
    if (cell.late) t = (t ? t + ' ' : '') + '(Late)';
    return t;
  }

  /* The level a cell's colour comes from, 0 for none. Missing is red, as
     the gradebook's M chip is. */
  function cellLevel(cell) {
    if (cell.kind === 'status') return cell.status === 'NS' ? 1 : 0;
    if (cell.kind === 'level' || cell.kind === 'points') return cell.level || 0;
    if (cell.kind === 'dibels' && cell.dibels) return cell.dibels.level || 0;
    return 0;
  }

  function tagLabel(cid, tagId) {
    var tag = typeof getTagById === 'function' ? getTagById(cid, tagId) : null;
    if (!tag) return text(tagId);
    return [tag.code, tag.label || tag.name].filter(Boolean).join(' ');
  }

  function sectionName(cid, secId) {
    var sec = (getSections(cid) || []).find(function (s) {
      return s.id === secId;
    });
    return sec ? sec.shortName || sec.name || secId : text(secId);
  }

  function termLabel(cid, termKey) {
    var n = _termNumber(termKey);
    var term = getReportingTerms(cid).find(function (t) {
      return t.ordinal === n;
    });
    if (term && term.label) return term.label;
    return n > 0 ? 'Term ' + n : text(termKey);
  }

  function habitsText(habits) {
    if (!habits || typeof habits !== 'object') return '';
    var names = {};
    var list = window.CommentBank && CommentBank.HABITS;
    (Array.isArray(list) ? list : []).forEach(function (h) {
      if (h && h.key) names[h.key] = h.name || h.key;
    });
    return HABIT_KEYS.map(function (k) {
      var v = Number(habits[k]);
      if (!HABIT_WORDS[v]) return '';
      return (names[k] || k) + ': ' + HABIT_WORDS[v];
    })
      .filter(Boolean)
      .join('; ');
  }

  function coreName(id) {
    var list = typeof CORE_COMPETENCIES !== 'undefined' ? CORE_COMPETENCIES : [];
    var c = (list || []).find(function (x) {
      return x && (x.id === id || x.code === id);
    });
    return c ? c.name || c.label || id : id;
  }

  /* A questionnaire answer as text: the words, a number, a picked list,
     or a self-assessment's step for each Core Competency. */
  function answerText(v) {
    if (!v) return '';
    if (v.text != null && String(v.text).trim() !== '') return String(v.text).trim();
    if (v.num != null) return String(v.num);
    var j = v.json;
    if (Array.isArray(j)) return j.filter(Boolean).join(', ');
    if (j && typeof j === 'object') {
      if (j.levels && typeof j.levels === 'object') {
        var why = j.why && typeof j.why === 'object' ? j.why : {};
        return Object.keys(j.levels)
          .map(function (k) {
            var line = coreName(k) + ': ' + j.levels[k];
            if (why[k]) line += ' (' + why[k] + ')';
            return line;
          })
          .join('; ');
      }
      return Object.keys(j)
        .map(function (k) {
          return k + ': ' + text(j[k]);
        })
        .join('; ');
    }
    return '';
  }

  /* ── The sheets ────────────────────────────────────────────── */

  var COL = {
    classCol: { header: 'Class', width: 22 },
    student: { header: 'Student', width: 24 },
    date: { header: 'Date', width: 12, date: true },
    assessment: { header: 'Assessment', width: 32 },
    long: function (header) {
      return { header: header, width: TEXT_WIDTH, wrap: true };
    },
    short: function (header, width) {
      return { header: header, width: width || 14 };
    },
  };

  /* opts.cids: the classes (default: every class that isn't deleted);
     opts.teacher: the teacher's name; opts.date: 'YYYY-MM-DD';
     opts.entries(cid, sid): a student's questionnaire answers
     (StudentVoice.entries), or left out. */
  function rows(opts) {
    opts = opts || {};
    var cids = opts.cids || classIds();
    var entries = typeof opts.entries === 'function' ? opts.entries : null;

    var summary = [];
    var grids = [];
    var rubric = [];
    var feedback = [];
    var observations = [];
    var reports = [];
    var questionnaires = [];
    var goals = [];
    var overrides = [];
    var taken = { contents: true, summary: true };

    cids.forEach(function (cid) {
      var cname = className(cid);
      var students = sortStudents(getStudents(cid), 'lastName');
      var assessments = sortByDate(getAssessments(cid), 'date');
      var statuses = ReportScores.getAssignmentStatuses(cid) || {};
      var byId = {};
      assessments.forEach(function (a) {
        byId[a.id] = a;
      });

      // Summary
      students.forEach(function (st) {
        var missing = 0;
        var late = 0;
        assessments.forEach(function (a) {
          var s = statuses[st.id + ':' + a.id];
          if (s === 'NS') missing++;
          if (s === 'LATE') late++;
        });
        summary.push([cname, studentName(st), studentGradeSummary(cid, st.id).text, missing, late, '']);
      });
      getWithdrawnStudents(cid).forEach(function (w) {
        if (!w || !w.student) return;
        summary.push([cname, studentName(w.student), '', '', '', 'Yes']);
      });

      // The class's gradebook
      var grid = {
        name: sheetName(cname, taken),
        className: cname,
        dates: ['Date', ''].concat(
          assessments.map(function (a) {
            return day(a.date);
          }),
        ),
        categories: ['Category', ''].concat(
          assessments.map(function (a) {
            return text(getAssessmentCategoryName(cid, a));
          }),
        ),
        header: ['Student', 'Course Grade'].concat(
          assessments.map(function (a) {
            return text(a.title);
          }),
        ),
        rows: [],
        average: [],
      };
      students.forEach(function (st) {
        var cells = [studentName(st), studentGradeSummary(cid, st.id).text];
        var levels = [0, 0];
        assessments.forEach(function (a) {
          var cell = assessmentCellValue(cid, st.id, a);
          cells.push(cellText(cell, a));
          levels.push(cellLevel(cell));
        });
        grid.rows.push({ cells: cells, levels: levels });
      });
      if (students.length && assessments.length) {
        grid.average = ['Class Average', ''].concat(
          assessments.map(function (a) {
            var res = classColumnAverage(cid, students, { assessment: a });
            return res ? classColumnAverageText(cid, a, res) : '';
          }),
        );
      }
      grids.push(grid);

      // Rubric levels, feedback
      assessments.forEach(function (a) {
        var date = day(a.date);
        var rub = _assessmentRubric(cid, a);
        var crits = ((rub && rub.criteria) || []).slice().sort(function (x, y) {
          return (x.displayOrder || 0) - (y.displayOrder || 0);
        });
        var tagIds = scoreTagIds(a, cid);
        students.forEach(function (st) {
          crits.forEach(function (crit) {
            if (!crit) return;
            var lv = rubricCriterionLevel(cid, st.id, a, crit);
            var workOn = text(ReportScores.getRubricCriterionComment(cid, st.id, a.id, crit));
            var beyond = text(ReportScores.getRubricCriterionBeyond(cid, st.id, a.id, crit));
            if (!(lv > 0) && !workOn && !beyond) return;
            var lt = criterionLevelText(lv);
            rubric.push([
              cname,
              text(a.title),
              date,
              studentName(st),
              text(crit.name),
              lt.word,
              lt.figure,
              workOn,
              beyond,
            ]);
          });
          var overall = text(ReportScores.getScoreComment(cid, st.id, a.id));
          var note = text(ReportScores.getScoreReportNote(cid, st.id, a.id));
          if (overall || note) feedback.push([cname, text(a.title), date, studentName(st), '', overall, note]);
          tagIds.forEach(function (tid) {
            var c = text(ReportScores.getTagComment(cid, st.id, a.id, tid));
            if (c) feedback.push([cname, text(a.title), date, studentName(st), tagLabel(cid, tid), c, '']);
          });
        });
      });

      // Observations
      var byStudent = {};
      students.forEach(function (st) {
        byStudent[st.id] = st;
      });
      getAllQuickObs(cid)
        .slice()
        .reverse()
        .forEach(function (ob) {
          var st = byStudent[ob.studentId];
          if (!st) return;
          var kind = (typeof OBS_SENTIMENTS !== 'undefined' && OBS_SENTIMENTS[ob.sentiment]) || null;
          var ctx = ob.assignmentContext || null;
          var linked = ctx ? ctx.assessmentTitle || (byId[ctx.assessmentId] || {}).title || '' : '';
          var comp = ob.competencyId ? tagLabel(cid, ob.competencyId) + (ob.level ? ' · ' + ob.level : '') : '';
          observations.push([
            day(ob.date || ob.created),
            cname,
            studentName(st),
            kind ? kind.label : text(ob.sentiment),
            text(linked),
            comp,
            text(ob.text),
          ]);
        });

      // Reports and questionnaires
      var ratings = getTermRatings(cid) || {};
      students.forEach(function (st) {
        var mine = ratings[st.id] || {};
        Object.keys(mine)
          .sort(function (x, y) {
            return _termNumber(x) - _termNumber(y);
          })
          .forEach(function (termKey) {
            var r = mine[termKey] || {};
            var comment = plain(r.narrative);
            var habits = habitsText(r.habits);
            var att = getTermAttendance(cid, st.id, termKey);
            var absences = att.absences == null ? '' : att.absences;
            var lates = att.lates == null ? '' : att.lates;
            if (!comment && !habits && absences === '' && lates === '') return;
            reports.push([
              cname,
              termLabel(cid, termKey),
              studentName(st),
              comment,
              habits,
              absences,
              lates,
              r.approvedAt ? 'Yes' : '',
            ]);
          });
        if (entries) {
          var list = [];
          try {
            list = entries(cid, st.id) || [];
          } catch (e) {
            list = [];
          }
          list
            .slice()
            .reverse()
            .forEach(function (en) {
              (en.items || []).forEach(function (it) {
                var ans = answerText(it.v);
                if (!ans) return;
                questionnaires.push([
                  cname,
                  studentName(st),
                  text(en.title),
                  day(en.at),
                  text(it.q && it.q.prompt),
                  ans,
                ]);
              });
            });
        }
      });

      // Goals, reflections, overrides
      var goalMap = getGoals(cid) || {};
      var goalDates = getGoalDates(cid) || {};
      var reflMap = getReflections(cid) || {};
      var ovMap = getOverrides(cid) || {};
      students.forEach(function (st) {
        var g = goalMap[st.id] || {};
        Object.keys(g).forEach(function (secId) {
          var t = text(g[secId]).trim();
          if (!t) return;
          goals.push([
            cname,
            studentName(st),
            day((goalDates[st.id] || {})[secId]),
            'Goal',
            sectionName(cid, secId),
            t,
            '',
          ]);
        });
        var rf = reflMap[st.id] || {};
        Object.keys(rf).forEach(function (secId) {
          var r = rf[secId] || {};
          var t = text(r.text).trim();
          if (!t && !r.confidence) return;
          goals.push([
            cname,
            studentName(st),
            day(r.date),
            'Reflection',
            sectionName(cid, secId),
            t,
            r.confidence || '',
          ]);
        });
        var ov = ovMap[st.id] || {};
        Object.keys(ov).forEach(function (secId) {
          var o = ov[secId];
          if (!o || !(o.level > 0)) return;
          overrides.push([
            cname,
            studentName(st),
            sectionName(cid, secId),
            formatLevel(cid, o.level, ''),
            o.calculated > 0 ? formatLevel(cid, o.calculated, '') : '',
            text(o.reason),
            day(o.date),
          ]);
        });
      });
    });

    var sheets = [];
    sheets.push({
      name: 'Summary',
      about:
        'Every student in every class, with the course grade as FullVision shows it and how many pieces are Missing or Late.',
      columns: [
        COL.classCol,
        COL.student,
        COL.short('Course Grade', 16),
        COL.short('Missing', 10),
        COL.short('Late', 10),
        COL.short('Withdrawn', 11),
      ],
      rows: summary,
    });
    grids.forEach(function (g) {
      sheets.push({
        name: g.name,
        grid: g,
        about: g.className + ': the gradebook, one row per student and one column per assessment, oldest first.',
      });
    });
    var list = [
      {
        name: 'Rubric Levels',
        about: 'Each criterion level on rubric work, with its Work On and Went Beyond notes.',
        columns: [
          COL.classCol,
          COL.assessment,
          COL.date,
          COL.student,
          COL.short('Criterion', 28),
          COL.short('Level', 16),
          COL.short('Figure', 8),
          COL.long('Work On'),
          COL.long('Went Beyond'),
        ],
        rows: rubric,
      },
      {
        name: 'Feedback',
        about:
          'Overall comments and Notes for the Report on each piece of work; a row with a Competency is feedback on that competency.',
        columns: [
          COL.classCol,
          COL.assessment,
          COL.date,
          COL.student,
          COL.short('Competency', 28),
          COL.long('Comment'),
          COL.long('Note for the Report'),
        ],
        rows: feedback,
      },
      {
        name: 'Observations',
        about: 'Every observation, oldest first, with its type, the work or competency it is linked to, and the text.',
        columns: [
          COL.date,
          COL.classCol,
          COL.student,
          COL.short('Type', 10),
          COL.short('Linked Work', 28),
          COL.short('Competency', 28),
          COL.long('Text'),
        ],
        rows: observations,
      },
      {
        name: 'Reports',
        about:
          'Report comments by reporting term, with work habits, attendance to date and whether the comment was approved.',
        columns: [
          COL.classCol,
          COL.short('Term', 16),
          COL.student,
          COL.long('Report Comment'),
          COL.long('Work Habits'),
          COL.short('Absences', 10),
          COL.short('Lates', 8),
          COL.short('Approved', 10),
        ],
        rows: reports,
      },
      {
        name: 'Questionnaires',
        about: 'Each answer a student gave on a questionnaire, one row per question.',
        columns: [
          COL.classCol,
          COL.student,
          COL.short('Questionnaire', 28),
          { header: 'Submitted', width: 12, date: true },
          COL.long('Question'),
          COL.long('Answer'),
        ],
        rows: questionnaires,
      },
      {
        name: 'Goals & Reflections',
        about: 'Student goals and reflections by competency area, with the confidence a reflection gave.',
        columns: [
          COL.classCol,
          COL.student,
          COL.date,
          COL.short('Kind', 11),
          COL.short('Competency Area', 28),
          COL.long('Text'),
          COL.short('Confidence', 11),
        ],
        rows: goals,
      },
      {
        name: 'Grade Overrides',
        about: 'Where a teacher set a competency area level by hand, the level set, the level calculated, and why.',
        columns: [
          COL.classCol,
          COL.student,
          COL.short('Competency Area', 28),
          COL.short('Level', 12),
          COL.short('Calculated', 12),
          COL.long('Reason'),
          COL.date,
        ],
        rows: overrides,
      },
    ];
    list.forEach(function (s) {
      if (s.rows.length) sheets.push(s);
    });

    var contents = {
      name: 'Contents',
      teacher: text(opts.teacher) || 'Teacher',
      date: opts.date || day(new Date().toISOString()),
      lines: sheets.map(function (s) {
        return [s.name, s.about];
      }),
      notes: [
        'Grades read exactly as FullVision shows them, following each class’s grading style.',
        'Withdrawn students are listed on the Summary sheet. Their records are in Class Settings, under Withdrawn, with Download Records.',
        'Deleted classes are not included.',
      ],
    };
    return [contents].concat(sheets);
  }

  /* ── The workbook ──────────────────────────────────────────── */

  function colLetter(n) {
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function excelDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return s || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function fill(hex) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } };
  }

  function headerRow(ws, rowNumber) {
    var row = ws.getRow(rowNumber);
    row.font = { bold: true };
    row.fill = fill('F1F2F5');
    row.alignment = { vertical: 'middle' };
  }

  function contentsSheet(wb, c) {
    var ws = wb.addWorksheet(c.name);
    ws.columns = [{ width: 24 }, { width: 90 }];
    ws.addRow(['FullVision: All My Data']).font = { bold: true, size: 14 };
    ws.addRow(['Teacher', c.teacher]);
    ws.addRow(['Exported', excelDate(c.date)]).getCell(2).numFmt = 'yyyy-mm-dd';
    ws.addRow([]);
    ws.addRow(['Sheet', 'What It Holds']);
    headerRow(ws, 5);
    c.lines.forEach(function (l) {
      ws.addRow(l).getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });
    ws.addRow([]);
    c.notes.forEach(function (n) {
      ws.addRow(['', n]).getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });
    ws.views = [{ state: 'frozen', ySplit: 5 }];
  }

  function listSheet(wb, s) {
    var ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map(function (c) {
      return { header: c.header, width: c.width };
    });
    headerRow(ws, 1);
    s.rows.forEach(function (r) {
      var row = ws.addRow(
        r.map(function (v, i) {
          return s.columns[i] && s.columns[i].date ? excelDate(v) : v;
        }),
      );
      s.columns.forEach(function (c, i) {
        var cell = row.getCell(i + 1);
        if (c.date) cell.numFmt = 'yyyy-mm-dd';
        cell.alignment = { wrapText: !!c.wrap, vertical: 'top' };
      });
    });
    ws.autoFilter = 'A1:' + colLetter(s.columns.length) + '1';
  }

  function gridSheet(wb, s) {
    var g = s.grid;
    var n = g.header.length;
    var ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
    ws.columns = g.header.map(function (h, i) {
      return { width: i === 0 ? 24 : i === 1 ? 16 : Math.max(12, Math.min(28, String(h).length + 2)) };
    });
    var dates = ws.addRow(
      g.dates.map(function (d, i) {
        return i < 2 ? d : excelDate(d);
      }),
    );
    dates.font = { color: { argb: 'FF5B616B' } };
    for (var i = 3; i <= n; i++) dates.getCell(i).numFmt = 'yyyy-mm-dd';
    ws.addRow(g.categories).font = { color: { argb: 'FF5B616B' } };
    var head = ws.addRow(g.header);
    headerRow(ws, 3);
    head.alignment = { wrapText: true, vertical: 'bottom' };
    g.rows.forEach(function (r) {
      var row = ws.addRow(r.cells);
      r.levels.forEach(function (lv, i) {
        if (!lv || !LEVEL_FILL[lv]) return;
        var cell = row.getCell(i + 1);
        cell.fill = fill(LEVEL_FILL[lv]);
        cell.font = { color: { argb: 'FF' + LEVEL_TEXT[lv] } };
      });
    });
    if (g.average.length) {
      var avg = ws.addRow(g.average);
      avg.font = { bold: true };
      avg.border = { top: { style: 'thin', color: { argb: 'FFC3C7CE' } } };
    }
    ws.autoFilter = 'A3:' + colLetter(n) + '3';
  }

  function workbook(sheets, ExcelJS) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'FullVision';
    wb.created = new Date();
    sheets.forEach(function (s) {
      if (s.lines) contentsSheet(wb, s);
      else if (s.grid) gridSheet(wb, s);
      else listSheet(wb, s);
    });
    return wb;
  }

  /* ── The button ────────────────────────────────────────────── */

  /* The teacher's name as the dock shows it: the signed-in user's display
     name (shared/supabase.js getCurrentUser), the dock's text, or "Teacher". */
  function teacherName() {
    var fromDock = function () {
      var el = document.getElementById('tb-user-name');
      return (el && el.textContent.trim()) || 'Teacher';
    };
    var user = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
    return Promise.resolve(user)
      .then(function (u) {
        var meta = (u && u.user_metadata) || {};
        var email = u && u.email ? String(u.email).split('@')[0] : '';
        return meta.display_name || email || fromDock();
      })
      .catch(fromDock);
  }

  function fileName(name, date) {
    var safe = String(name)
      .replace(/[\/\\:*?"<>|]+/g, ' ')
      .trim();
    return 'FullVision – ' + safe + ' – ' + date + '.xlsx';
  }

  var _lib = null;
  function library() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (_lib) return _lib;
    _lib = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB_URL;
      s.onload = function () {
        if (window.ExcelJS) resolve(window.ExcelJS);
        else reject(new Error('The spreadsheet library did not load.'));
      };
      s.onerror = function () {
        _lib = null;
        reject(new Error('The spreadsheet library did not load.'));
      };
      document.head.appendChild(s);
    });
    return _lib;
  }

  var _status = null;
  function status(message) {
    if (!message) {
      if (_status && _status.parentNode) _status.parentNode.removeChild(_status);
      _status = null;
      return;
    }
    if (!_status) {
      _status = document.createElement('div');
      _status.className = 'sync-toast export-all-toast';
      _status.id = 'export-all-status';
      _status.setAttribute('role', 'status');
      _status.setAttribute('aria-live', 'polite');
      document.body.appendChild(_status);
    }
    _status.textContent = message;
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  var _running = false;
  function run() {
    if (_running) return Promise.resolve();
    _running = true;
    var cids = classIds();
    var voice = window.StudentVoice || null;
    status('Loading classes…');
    var chain = library();
    cids.forEach(function (cid, i) {
      chain = chain
        .then(function (lib) {
          status('Loading class ' + (i + 1) + ' of ' + cids.length + '…');
          return loadClass(cid)
            .then(function () {
              return voice && voice.load ? voice.load(cid).catch(function () {}) : null;
            })
            .then(function () {
              return lib;
            });
        })
        .catch(function (e) {
          throw e;
        });
    });
    return chain
      .then(function (lib) {
        return teacherName().then(function (name) {
          return { lib: lib, name: name };
        });
      })
      .then(function (got) {
        var lib = got.lib;
        var name = got.name;
        status('Building the file…');
        var date = day(new Date().toISOString());
        var sheets = rows({
          cids: cids,
          teacher: name,
          date: date,
          entries: voice && voice.entries ? voice.entries : null,
        });
        return workbook(sheets, lib)
          .xlsx.writeBuffer()
          .then(function (buf) {
            download(
              new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
              fileName(name, date),
            );
            status('');
          });
      })
      .catch(function (e) {
        console.warn('Download All My Data failed:', e);
        status('The file could not be made. Please try again.');
        setTimeout(function () {
          status('');
        }, 4000);
      })
      .then(function () {
        _running = false;
      });
  }

  window.ExportAll = {
    rows: rows,
    workbook: workbook,
    run: run,
    cellText: cellText,
    cellLevel: cellLevel,
    answerText: answerText,
    plain: plain,
    sheetName: sheetName,
    classIds: classIds,
  };
})();
