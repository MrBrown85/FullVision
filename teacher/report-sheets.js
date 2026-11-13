/* report-sheets.js — The report form as sides of rows.
   A report is a Front and a Back (and any further side the teacher adds).
   Each side is a stack of rows; a row is one block at Row width, or one
   or two blocks at Side by Side width. A block keeps its side for every
   student; its height is whatever the student's content needs, so the
   rows close up and the room left stays at the bottom of the side. A side
   that is too full for one student carries its last rows onto a continued
   side for that student only; a block taller than a whole side prints
   after the report. Nothing is shrunk, clipped or hidden per student. The
   same HTML is on screen and on paper.
   docs/DECISIONS.md "Report forms"; docs/report-forms-plan.md Phase 8. */
window.ReportSheets = (function () {
  'use strict';

  var PX_PER_IN = 96;
  var PAPER = {
    // The paper by name and portrait, not inches, so the print dialog picks
    // the Legal tray instead of shrinking the sheet onto Letter (DECISIONS
    // "Printed class grade sheet" 11).
    letter: { w: 8.5, h: 11, size: 'letter portrait' },
    legal: { w: 8.5, h: 14, size: 'legal portrait' },
  };
  /* The sheet's padding: the letterhead sits near the top; the content
     column is 720px wide on both papers. */
  var PAD_TOP = 24;
  var PAD_SIDE = 48;
  var PAD_BOTTOM = 36;
  var PAGE_STYLE_ID = 'report-sheets-page';

  /* ── The layout model (v6) ────────────────────────────────────
     sides[i].rows[j].cells: one cell { block, size, options?, noEvidence?,
     lines? } at size 'row', or one or two at size 'half' (two make a pair;
     one alone prints at half width). The letterhead is always the first
     row of the first side; its options are kept. One block may be pinned:
     always the last row of its side, docked to the bottom (the Parent /
     Guardian Response). `lines` is the writing room of a fill block (the
     comment's ruled lines when a student has none; the Response's comments
     box). perStudent holds blocks left off one student's report. The
     Parent / Guardian Response and the student reflection are placed,
     never reworded (DECISIONS "Report forms" 5). */
  var GAP = 12;
  // The Studio's box for a block that prints nothing (reports.css,
  // .sheet-row-empty .sheet-cell min-height).
  var EMPTY_PX = 30;
  var ROW_W = 720;
  var HALF_W = (ROW_W - GAP) / 2;
  /* One ruled line, from reports.css (.report-ruled repeats every 22px). */
  var LINE_PX = 22;
  /* A v5 (grid) form's rows were 20px; a comment box's chrome about 40px. */
  var ROW_PX = 20;
  var BOX_PX = 40;

  function _c(block, size, extra) {
    var cell = { block: block, size: size || 'row' };
    if (extra)
      Object.keys(extra).forEach(function (k) {
        cell[k] = extra[k];
      });
    return cell;
  }
  function _row() {
    return { cells: Array.prototype.slice.call(arguments) };
  }
  /* A new report: the student's name and their Assignment Grades, a
     printout of how they are doing. Teachers add the rest. */
  var FORM_DEFAULT = {
    v: 6,
    id: 'grades',
    name: 'Grades',
    type: 'standard',
    sides: [
      { rows: [_row(_c('header')), _row(_c('grade-table', 'row', { options: { columns: 'one' } }))] },
      { rows: [] },
    ],
    pinned: null,
    perStudent: {},
  };
  /* The Report Card starter, from the audit canvas. */
  var FORM_REPORT_CARD = {
    v: 6,
    id: 'report-card',
    name: 'Report Card',
    type: 'standard',
    sides: [
      {
        rows: [
          _row(_c('header')),
          _row(_c('proficiency')),
          _row(_c('legend')),
          _row(_c('teacher-narrative', 'row', { lines: 10 })),
          _row(_c('term-attendance', 'half'), _c('missing-work', 'half')),
        ],
      },
      {
        rows: [_row(_c('self-assessment')), _row(_c('grade-table')), _row(_c('parent-response', 'row', { lines: 3 }))],
      },
    ],
    pinned: 'parent-response',
    perStudent: {},
  };
  /* The Report Card starter, made whole. */
  function form() {
    return normalizeForm(FORM_REPORT_CARD);
  }

  /* Every block a form can hold. Labels, the palette group and the options
     a block offers live here, not in the saved form. `half: false` keeps a
     block at Row width (the letterhead, the two reflection forms). `fill`
     blocks rule lines into the room their box leaves and take `lines` of
     writing room (`minLines`..`maxLines`); `table` blocks are cut at their
     rows when they print after the report. A `retired` block is left out
     of the palette; a saved layout that has one keeps it. An option's
     `choices` are numbers or { v, label }; a `text` option is a line the
     teacher writes. */
  var BLOCKS = {
    header: {
      label: 'Letterhead',
      locked: true,
      half: false,
      group: null,
      options: [
        { key: 'school', label: 'School', def: true },
        { key: 'teacher', label: 'Teacher', def: true },
        { key: 'dates', label: 'Term Dates', def: true },
        { key: 'studentNumber', label: 'Student Number', def: true },
        {
          key: 'name',
          label: 'Name',
          def: 'preferred',
          choices: [
            { v: 'preferred', label: 'Preferred Name' },
            { v: 'first', label: 'First Name' },
          ],
        },
      ],
    },
    // Proficiency replaces Overall and Competencies, the Competency Table
    // and Growth Since Last Report (plan PR 3): figures, never dots.
    proficiency: {
      label: 'Proficiency',
      group: 'Grades',
      noEvidence: true,
      options: [
        {
          key: 'rows',
          label: 'Rows',
          // As Graded: a folder that counts as one in the grade prints as
          // one row, so the report shows what the grade is made of.
          def: 'auto',
          choices: [
            { v: 'auto', label: 'As Graded' },
            { v: 'group', label: 'Each Folder' },
            { v: 'each', label: 'Each Competency' },
          ],
          groups: true,
        },
        // Students and families read a proficiency, never a figure out of
        // 4 (DECISIONS, "Student-facing levels are proficiencies",
        // 2026-11-12): a Proficiency class prints the word whatever these
        // say, so neither is offered there; a Both class's Score is its %.
        // hideIn and labelIn were read by Page Studio's inspector.
        { key: 'score', label: 'Score out of 4', def: true, hideIn: ['proficiency'], labelIn: { both: 'Percent' } },
        { key: 'word', label: 'Proficiency Word', def: 'auto', hideIn: ['proficiency', 'both'] },
        { key: 'change', label: 'Change', def: true },
        { key: 'assessed', label: 'Assessed Count', def: true },
        { key: 'overall', label: 'Overall', def: true },
        { key: 'facts', label: 'Highest and Lowest Lines', def: true },
        {
          key: 'order',
          label: 'Order',
          def: 'curriculum',
          choices: [
            { v: 'curriculum', label: 'Curriculum' },
            { v: 'lowest', label: 'Lowest First' },
          ],
        },
      ],
    },
    'academic-summary': { label: 'Overall and Competencies', group: 'Grades', retired: true },
    'competency-table': {
      label: 'Competency Table',
      table: true,
      group: 'Grades',
      retired: true,
      noEvidence: true,
      options: [
        { key: 'evidence', label: 'Evidence Count', def: true },
        { key: 'ican', label: 'I-can Statements', def: false },
        { key: 'assignments', label: 'Assignment Names', def: false },
      ],
    },
    // One row per assessment: date, full title and the marks the teacher
    // picks under Show. Percent and Proficiency Word start from the class
    // grading setting ('auto': ReportBlocks.showDefaults). It always starts
    // in one column, a heading per month, year to date (Colin, Oct 29).
    'grade-table': {
      label: 'Assignment Grades',
      group: 'Grades',
      // Cut at its rows, as a table is, when it is too long for a side.
      gradeRows: true,
      options: [
        { key: 'course', label: 'Course Grade', def: true },
        { key: 'categoryGrade', label: 'Category Grades', def: true },
        { key: 'score', label: 'Score', def: true },
        { key: 'percent', label: 'Percent', def: 'auto' },
        // A Proficiency or Both class prints no word beside a mark (a level
        // is its proficiency; points carry none), so Word is not offered
        // there and a saved form's Word is not read (ReportBlocks.
        // renderBlockGradeTable).
        { key: 'word', label: 'Proficiency Word', def: 'auto', hideIn: ['proficiency', 'both'] },
        {
          key: 'organize',
          label: 'Organize By',
          def: 'date',
          choices: [
            { v: 'category', label: 'Category' },
            { v: 'date', label: 'Date' },
            { v: 'competency', label: 'Competency' },
          ],
        },
        {
          key: 'order',
          label: 'Order',
          def: 'newest',
          choices: [
            { v: 'newest', label: 'Newest First' },
            { v: 'oldest', label: 'Oldest First' },
          ],
        },
        {
          key: 'columns',
          label: 'Columns',
          def: 'one',
          choices: [
            { v: 'one', label: 'One' },
            { v: 'two', label: 'Two' },
          ],
        },
        {
          key: 'range',
          label: 'Range',
          def: 'all',
          choices: [
            { v: 'last10', label: 'Last 10' },
            { v: 'term', label: 'This Term' },
            { v: 'all', label: 'Year to Date' },
          ],
        },
        {
          key: 'per',
          label: 'Per Competency',
          def: 5,
          choices: [3, 5, 8],
          showIf: { key: 'organize', v: 'competency' },
        },
      ],
    },
    'term-glance': { label: 'This Term at a Glance', group: 'Grades', retired: true },
    growth: { label: 'Growth Since Last Report', table: true, group: 'Grades', retired: true },
    'missing-work': {
      label: 'Missing Work',
      group: 'Grades',
      options: [
        {
          key: 'none',
          label: 'When None',
          def: 'say',
          choices: [
            { v: 'say', label: 'Say None' },
            { v: 'off', label: 'Leave Off' },
          ],
        },
        { key: 'titles', label: 'Assignment Titles', def: true },
      ],
    },
    // Totals to date from the Term Questionnaire (classes absent, times late).
    // Not 'attendance': an older block by that name was retired, and forms
    // saved with it drop it.
    'term-attendance': {
      label: 'Attendance',
      group: 'Grades',
      options: [
        {
          key: 'period',
          label: 'Period',
          def: 'term',
          choices: [
            { v: 'term', label: 'This Term' },
            { v: 'year', label: 'Year to Date' },
          ],
        },
        { key: 'late', label: 'Times Late', def: true },
      ],
    },
    'section-outcomes': { label: 'Learning Outcomes', group: 'Grades', retired: true },
    'score-distribution': { label: 'Score Distribution', group: 'Grades', retired: true },
    'section-chart': { label: 'Section Chart', group: 'Grades', retired: true },
    'teacher-narrative': {
      label: 'Teacher Comment',
      fill: true,
      lines: 10,
      minLines: 3,
      maxLines: 16,
      group: 'Comments and Evidence',
    },
    observations: { label: 'Observations', group: 'Comments and Evidence', retired: true },
    // Next Steps, Ways to Support at Home and Progress in One Area share
    // the student's Focus Area: the competency picked in the Term
    // Questionnaire, else the one with the biggest change (plan PR 5).
    'next-steps': {
      label: 'Next Steps',
      group: 'Comments and Evidence',
      options: [
        {
          key: 'areas',
          label: 'Competencies',
          def: 'focus',
          choices: [
            { v: 'focus', label: 'Focus Area' },
            { v: 'two', label: 'Focus Area and Next Lowest' },
          ],
        },
        { key: 'latest', label: 'Latest Score', def: true },
      ],
    },
    progress: {
      label: 'Progress in One Area',
      group: 'Grades',
      options: [
        {
          key: 'area',
          label: 'Area',
          def: 'focus',
          choices: [
            { v: 'focus', label: 'Focus Area' },
            { v: 'lowest', label: 'Lowest Now' },
            { v: 'highest', label: 'Highest Now' },
          ],
        },
        { key: 'list', label: 'Every Score This Term', def: true },
        { key: 'startNow', label: 'Start and Now', def: true },
        { key: 'best', label: 'Best', def: true },
        { key: 'latest', label: 'Latest', def: true },
        { key: 'toward', label: 'Working Toward', def: true },
      ],
    },
    // Learning Dispositions print how often, Rarely to Consistently (plan
    // PR 6); Developing now only means proficiency.
    'learner-dimensions': {
      label: 'Learning Dispositions',
      group: 'Learner Profile',
      options: [
        { key: 'rated', label: 'Only Rated Dispositions', def: true },
        { key: 'scale', label: 'Scale Line', def: true },
      ],
    },
    'core-competencies': {
      label: 'Core Competencies',
      group: 'Learner Profile',
      retired: true,
      noEvidence: true,
      options: [{ key: 'intro', label: 'Introduction', def: true }],
    },
    // The student's own words from Student Voice: About Me, the Core
    // Competency reflection and the Goal Check-In.
    'self-assessment': {
      label: 'Self-Assessment and Goal',
      group: 'Student Voice',
      options: [
        { key: 'strength', label: 'Strength', def: true },
        { key: 'core', label: 'Core Competency Answers', def: true },
        { key: 'goal', label: 'Goal and Check-In', def: true },
      ],
    },
    'student-reflection-learning': { label: 'Reflection: My Learning', half: false, group: 'Student Voice' },
    'student-reflection-habits': { label: 'Reflection: My Habits', half: false, group: 'Student Voice' },
    'parent-response': {
      label: 'Parent / Guardian Response',
      fill: true,
      lines: 3,
      minLines: 1,
      maxLines: 8,
      linesLabel: 'Comment Lines',
      group: 'Family',
      pinnable: true,
    },
    legend: { label: 'Proficiency Legend', group: 'Family' },
    'support-home': {
      label: 'Ways to Support at Home',
      group: 'Family',
      options: [
        { key: 'see', label: 'Ask to See (best work)', def: true },
        { key: 'about', label: 'Ask About (lowest work)', def: true },
        { key: 'note', label: 'Your Own Line', def: '', text: true },
      ],
    },
    'text-block': { label: 'Text Block', fill: true, group: 'Family' },
  };

  function _int(v, d) {
    var n = v == null || v === '' ? NaN : Number(v);
    return isFinite(n) ? Math.round(n) : d;
  }
  function _clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }
  function canHalf(id) {
    var def = BLOCKS[id];
    return !!def && def.half !== false && !def.pinnable;
  }
  function _linesOf(def, v) {
    if (!def.fill || !def.lines) return undefined;
    return _clamp(_int(v, def.lines), def.minLines || 1, def.maxLines || 30);
  }

  /* One cell made whole: a known block, a size it may take, its options,
     its no-evidence rule, its lines. */
  function _cleanCell(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var def = BLOCKS[raw.block];
    if (!def) return null;
    var cell = { block: raw.block, size: raw.size === 'half' && canHalf(raw.block) ? 'half' : 'row' };
    if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
      cell.options = JSON.parse(JSON.stringify(raw.options));
    }
    if (def.noEvidence && (raw.noEvidence === 'hide' || raw.noEvidence === 'show')) cell.noEvidence = raw.noEvidence;
    var lines = _linesOf(def, raw.lines);
    if (lines != null) cell.lines = lines;
    return cell;
  }

  /* ── Migration from the earlier shapes ────────────────────────── */
  function _v3ToPages(raw) {
    var toRows = function (list) {
      return (list || [])
        .map(function (it) {
          if (!it) return null;
          if (Array.isArray(it.pair)) {
            return {
              cells: it.pair.map(function (q) {
                return { block: q.block, span: 6 };
              }),
            };
          }
          var cell = { block: it.block, span: 12 };
          if (it.room && it.room.lines) {
            cell.height = 'fixed';
            cell.lines = it.room.lines;
          }
          return { cells: [cell] };
        })
        .filter(Boolean);
    };
    var pinned = null;
    (raw.front || []).concat(raw.back || []).forEach(function (it) {
      if (it && it.pinned) pinned = it.block;
    });
    return {
      v: 4,
      id: raw.id,
      name: raw.name,
      type: raw.type,
      pinned: pinned,
      pages: [{ rows: toRows(raw.front) }, { rows: toRows(raw.back) }],
    };
  }
  /* A v4 row's spans, made to add up to 12 as v4 did (12; 6+6; 8+4; 4+8;
     4+4+4). */
  function _rowSpans(cells) {
    var spans = cells.map(function (c) {
      return [12, 8, 6, 4].indexOf(Number(c.span)) >= 0 ? Number(c.span) : 12;
    });
    var sum = spans.reduce(function (a, s) {
      return a + s;
    }, 0);
    if (sum === 12) return spans;
    if (cells.length === 1) return [12];
    if (cells.length === 2) return [6, 6];
    return [4, 4, 4];
  }
  /* A v4 cell's room in grid rows: its lines for the comment, response and
     text blocks (the comment held 8 unless set to Fit Content). */
  function _v4Rows(c) {
    var lines = Number(c.lines);
    if (BLOCKS[c.block].fill && c.height === 'fixed' && lines >= 1)
      return Math.ceil((lines * LINE_PX + BOX_PX) / ROW_PX);
    if (c.block === 'teacher-narrative' && c.height !== 'fit') return Math.ceil((8 * LINE_PX + BOX_PX) / ROW_PX);
    return 8;
  }
  /* v4 (pages of rows of cells with spans) to v5: each row's cells side by
     side at the row's running y, x and w from the spans. */
  function _v4ToV5(base) {
    var seen = {};
    var pages = base.pages.map(function (pg) {
      var y = 0;
      var blocks = [];
      ((pg && pg.rows) || []).forEach(function (row) {
        var cells = ((row && row.cells) || [])
          .filter(function (c) {
            if (!c || !BLOCKS[c.block] || seen[c.block]) return false;
            seen[c.block] = true;
            return true;
          })
          .slice(0, 3);
        if (!cells.length) return;
        var spans = _rowSpans(cells);
        var x = 0;
        var rowH = 0;
        cells.forEach(function (c, i) {
          var h = _v4Rows(c);
          var b = { block: c.block, x: x, y: y, w: spans[i], h: h };
          if (c.options) b.options = c.options;
          if (c.noEvidence) b.noEvidence = c.noEvidence;
          blocks.push(b);
          x += spans[i];
          rowH = Math.max(rowH, h);
        });
        y += rowH;
      });
      return { blocks: blocks };
    });
    return {
      v: 5,
      id: base.id,
      name: base.name,
      type: base.type,
      pages: pages,
      pinned: base.pinned,
      perStudent: base.perStudent,
    };
  }
  /* v5 (pages of rectangles on a 12-column grid) to v6: each page's blocks
     in (row, column) order become rows; two blocks that start on the same
     grid row, each at most half the page wide and each allowed Side by
     Side, become a pair; a lone block at most half wide that may go Side
     by Side keeps that width. A fill block's rows become lines. */
  function _v5ToV6(base) {
    var sides = (base.pages || []).map(function (pg) {
      var blocks = ((pg && pg.blocks) || [])
        .filter(function (b) {
          return b && BLOCKS[b.block];
        })
        .slice()
        .sort(function (a, b) {
          if (a.block === 'header' || b.block === 'header') return a.block === 'header' ? -1 : 1;
          return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0);
        });
      var rows = [];
      for (var i = 0; i < blocks.length; i++) {
        var a = blocks[i];
        var cell = _fromV5Block(a);
        var b = blocks[i + 1];
        if (
          b &&
          Number(b.y) === Number(a.y) &&
          Number(a.w) <= 6 &&
          Number(b.w) <= 6 &&
          canHalf(a.block) &&
          canHalf(b.block)
        ) {
          cell.size = 'half';
          var other = _fromV5Block(b);
          other.size = 'half';
          rows.push({ cells: [cell, other] });
          i++;
        } else {
          cell.size = Number(a.w) <= 6 && canHalf(a.block) ? 'half' : 'row';
          rows.push({ cells: [cell] });
        }
      }
      return { rows: rows };
    });
    return {
      v: 6,
      id: base.id,
      name: base.name,
      type: base.type,
      sides: sides,
      pinned: base.pinned,
      perStudent: base.perStudent,
    };
  }
  function _fromV5Block(b) {
    var def = BLOCKS[b.block];
    var cell = { block: b.block, size: 'row' };
    if (b.options) cell.options = b.options;
    if (b.noEvidence) cell.noEvidence = b.noEvidence;
    if (def.fill && def.lines && b.h != null) {
      cell.lines = _linesOf(def, Math.round((Number(b.h) * ROW_PX - BOX_PX) / LINE_PX));
    }
    return cell;
  }

  /* A saved form (any version, any hand) made whole: known blocks only, no
     block twice, sizes a block may take, the letterhead first on the first
     side, at most one pinned block and it last on its side at Row width,
     at least one side. Empty sides stay: the teacher gave them. v5 (the
     page grid), v4 (rows of cells with spans), v3 (front/back lists with
     pairs) and the old presets ({preset, blocks}) migrate here; nothing
     saved is lost. Absent → the Report Card. */
  function normalizeForm(raw) {
    var base = raw && typeof raw === 'object' ? raw : null;
    if (base && !Array.isArray(base.pages) && !Array.isArray(base.sides)) {
      if (Array.isArray(base.front) || Array.isArray(base.back)) base = _v3ToPages(base);
      else base = null;
    }
    if (!base) base = FORM_REPORT_CARD;
    if (
      Array.isArray(base.pages) &&
      base.pages.some(function (pg) {
        return pg && Array.isArray(pg.rows);
      })
    ) {
      base = _v4ToV5(base);
    }
    if (!Array.isArray(base.sides)) base = _v5ToV6(base);
    var seen = {};
    var head = null;
    var sides = base.sides.map(function (sd) {
      var rows = [];
      ((sd && sd.rows) || []).forEach(function (row) {
        var cells = ((row && row.cells) || [])
          .map(_cleanCell)
          .filter(function (c) {
            if (!c || seen[c.block]) return false;
            seen[c.block] = true;
            if (c.block === 'header') {
              head = c;
              return false;
            }
            return true;
          })
          .slice(0, 2);
        if (!cells.length) return;
        if (cells.length === 2) {
          // A pair is two Side by Side blocks; one that can't be goes below.
          if (!canHalf(cells[0].block) || !canHalf(cells[1].block)) {
            cells.forEach(function (c) {
              c.size = canHalf(c.block) && c.size === 'half' ? 'half' : 'row';
              rows.push({ cells: [c] });
            });
            return;
          }
          cells[0].size = 'half';
          cells[1].size = 'half';
        }
        rows.push({ cells: cells });
      });
      return { rows: rows };
    });
    if (!sides.length) sides = [{ rows: [] }];
    var header = { block: 'header', size: 'row' };
    if (head && head.options) header.options = head.options;
    seen.header = true;
    sides[0].rows.unshift({ cells: [header] });
    var pinned =
      base.pinned && BLOCKS[base.pinned] && BLOCKS[base.pinned].pinnable && seen[base.pinned] ? base.pinned : null;
    if (pinned) {
      // The pinned block is the last row of its side, alone, at Row width.
      sides.forEach(function (sd) {
        var at = -1;
        sd.rows.forEach(function (row, i) {
          if (
            row.cells.some(function (c) {
              return c.block === pinned;
            })
          )
            at = i;
        });
        if (at < 0) return;
        var row = sd.rows.splice(at, 1)[0];
        var rest = row.cells.filter(function (c) {
          return c.block !== pinned;
        });
        if (rest.length) sd.rows.splice(at, 0, { cells: rest });
        var cell = row.cells.find(function (c) {
          return c.block === pinned;
        });
        cell.size = 'row';
        sd.rows.push({ cells: [cell] });
      });
    }
    var per = {};
    if (base.perStudent && typeof base.perStudent === 'object') {
      Object.keys(base.perStudent).forEach(function (sid) {
        var e = base.perStudent[sid];
        var hide = Array.isArray(e && e.hide)
          ? e.hide.filter(function (id) {
              return BLOCKS[id] && id !== 'header';
            })
          : [];
        if (hide.length) per[sid] = { hide: hide };
      });
    }
    var out = {
      v: 6,
      id: base.id || 'report-card',
      name: base.name || 'Report Card',
      type: base.type === 'compact' ? 'compact' : 'standard',
      sides: sides,
      pinned: pinned,
      perStudent: per,
    };
    // Front Only remembered the side each folded block came from, so Front
    // and Back could put it back. Only a one-sided form keeps it.
    if (sides.length === 1 && base.folded && typeof base.folded === 'object') {
      var folded = {};
      Object.keys(base.folded).forEach(function (id) {
        var at = Number(base.folded[id]);
        if (seen[id] && id !== 'header' && at >= 1 && at === Math.floor(at)) folded[id] = at;
      });
      if (Object.keys(folded).length) out.folded = folded;
    }
    return out;
  }

  /* The class's saved form, or, without one, the name and Assignment
     Grades (page-reports.js _readSaved). */
  function formFor(reportConfig) {
    if (reportConfig && reportConfig.form) return normalizeForm(reportConfig.form);
    return normalizeForm(FORM_DEFAULT);
  }

  /* ── Reading the form ─────────────────────────────────────────── */
  function hiddenFor(f, sid) {
    var e = f.perStudent && f.perStudent[sid];
    return e && e.hide ? e.hide.slice() : [];
  }

  function paperSize(paper) {
    return (PAPER[paper] || PAPER.letter).size;
  }
  /* The content column's height on a paper, in px. */
  function sideHeight(paper) {
    var p = PAPER[paper] || PAPER.letter;
    return p.h * PX_PER_IN - PAD_TOP - PAD_BOTTOM;
  }

  /* ── The rows engine (pure) ─────────────────────────────────────
     sides: the form's sides, each a list of rows, each a list of cells
     { id, size, px, empty?, rows?, chrome? }: px is the height the
     student's content takes at the cell's width (0 when the block prints
     nothing), rows and chrome a table's row heights and the rest of it in
     px. opts: { H (a side's height), gap, pinned (id), head (the px of
     the line naming the student at the top of every side after the
     Front) }. Every side but the Front keeps room for that line, so the
     Front is the only side with the whole height.
     Each side is laid top to bottom: a row takes the taller of its cells
     and sits `gap` under the row before it. The pinned block is docked to
     the bottom of its side, and the gap above it is the side's limit. A
     row that passes the limit, and every row after it on that side, moves
     to a continued side inserted after it (for this student only).
     Tables (Assignment Grades) go on side by side instead, so no side is
     left blank: one that fits a side but not the room left here goes
     whole onto the next side of the form (the Back), ahead of that side's
     own rows, and the rows after it go with it; one taller than a whole
     side (below the line, unless it fits where it is on the Front)
     starts where it is, with as many of its rows as the room left there
     holds, and goes on onto the next side of the form, then past the
     last side onto continued sides. A row is never cut, and each part
     repeats the table's title. Anything else taller than a side is held
     back and printed after the report, alone and over. Returns { sides:
     [{ rows: [{ y, h, cells: [{ id, size, h, part? }], carried? }],
     pinned?, passed?, kind: 'side' | 'continued' | 'after', from, head }],
     after: [id], continued: [id], over }; head is true on every side but
     the Front. A row is carried when it belongs to an earlier side of the
     form, or is a table's second or later part (the Studio counts each
     block once); a side is passed when the rest of it went on to the
     next side of the form. */
  function pack(sides, opts) {
    var H = opts.H;
    var gap = opts.gap != null ? opts.gap : GAP;
    var out = [];
    var after = [];
    var continued = [];
    var over = false;
    var top = opts.head ? opts.head + gap : 0;
    var full = H - top;
    var rowOf = function (cells, from) {
      var live = cells.filter(function (c) {
        return !c.empty;
      });
      var h = Math.max.apply(
        null,
        [0].concat(
          live.map(function (c) {
            return c.px;
          }),
        ),
      );
      return { h: h, cells: cells, live: live, from: from };
    };
    var isTable = function (c) {
      return !!c.rows && c.rows.length > 1;
    };
    // What a side of the form passes on to the next: the rest of a table
    // it began and the rows after it.
    var carry = [];
    sides.forEach(function (rows, s) {
      var pin = null;
      var queue = carry;
      carry = [];
      rows.forEach(function (cells) {
        var r = rowOf(cells, s);
        if (
          cells.some(function (c) {
            return c.id === opts.pinned;
          })
        )
          pin = r;
        else queue.push(r);
      });
      var limit = H;
      var side = { rows: [], kind: 'side', from: s, head: s > 0 };
      out.push(side);
      if (pin && pin.live.length) {
        var cap = s > 0 ? full : H;
        var ph = Math.min(pin.h, cap);
        if (pin.h > cap) over = true;
        limit = Math.max(0, H - ph - gap);
        side.pinned = { id: pin.cells[0].id, size: 'row', h: ph, y: H - ph };
      }
      var cur = side;
      var y = s > 0 ? top : 0;
      var y0 = y;
      var last = s + 1 >= sides.length;
      // The rest of this side continues on a side of its own, for this
      // student.
      var turn = function () {
        cur = { rows: [], kind: 'continued', from: s, head: true };
        out.push(cur);
        y = y0 = top;
        shown = 0;
      };
      // A block that prints nothing takes no room on paper, but the Studio
      // shows it as a box with its name (reports.css, .sheet-row-empty). A
      // table filling a side keeps room for those boxes, so its last rows
      // are not pushed past the foot of the side on screen.
      var shown = 0;
      var place = function (cells, h, from) {
        var row = { y: y, h: h, cells: cells };
        var carried =
          from !== s ||
          cells.some(function (c) {
            return c.part && c.part.start > 0;
          });
        if (carried) row.carried = true;
        if (cur !== side || carried) {
          cells.forEach(function (c) {
            if (continued.indexOf(c.id) < 0) continued.push(c.id);
          });
        }
        cur.rows.push(row);
        y += h + gap;
      };
      // A table taller than a side, from its row `start`: as many rows as
      // the room left here holds (at least one where nothing is above it),
      // then the next side. Returns the row it stops at when the next side
      // of the form takes the rest, or the table's length when it is done.
      var flow = function (c, start, from) {
        while (start < c.rows.length) {
          var lim = cur === side ? limit : H;
          var room = lim - y - shown - c.chrome - 1;
          var take = 0;
          var used = 0;
          while (start + take < c.rows.length && used + c.rows[start + take] <= room) {
            used += c.rows[start + take];
            take++;
          }
          if (!take) {
            if (y + shown > y0 || lim < H) {
              // No room for a row here: the next side.
              if (!last) return start;
              turn();
              continue;
            }
            // One row taller than a whole side: alone, and over.
            take = 1;
            used = c.rows[start];
            over = true;
          }
          var h = Math.min(H - y, c.chrome + used);
          place([{ id: c.id, size: c.size, h: h, part: { start: start, end: start + take } }], h, from);
          start += take;
          if (start < c.rows.length) {
            if (!last) return start;
            turn();
          }
        }
        return start;
      };
      for (var i = 0; i < queue.length; i++) {
        var r = queue[i];
        if (r.resume) {
          // A table begun on an earlier side goes on at the top of this one.
          var at = flow(r.resume, r.start, r.from);
          if (at < r.resume.rows.length) {
            carry = [{ resume: r.resume, start: at, from: r.from }].concat(queue.slice(i + 1));
            break;
          }
          continue;
        }
        if (!r.live.length) {
          // Nothing to print: the row keeps its place at no height, so the
          // canvas can still show and select the block.
          var none = {
            y: y,
            h: 0,
            empty: true,
            cells: r.cells.map(function (c) {
              return { id: c.id, size: c.size, h: 0 };
            }),
          };
          if (r.from !== s) none.carried = true;
          cur.rows.push(none);
          shown += EMPTY_PX + gap;
          continue;
        }
        // Fits a side: under the line, or where it is on the Front.
        var fits = function (h) {
          return h <= full || (cur === side && s === 0 && y + h <= limit);
        };
        var from = r.from;
        var tables = [];
        if (!fits(r.h)) {
          // Taller than a whole side. A table starts here and goes on side
          // by side; anything else prints after the report. A short partner
          // stays where it is, alone in the row, above the table.
          var short = [];
          r.live.forEach(function (c) {
            if (fits(c.px)) short.push(c);
            else if (isTable(c)) tables.push(c);
            else after.push(c);
          });
          r = short.length ? rowOf(short, from) : null;
        }
        var lim = cur === side ? limit : H;
        var lone = !!r && r.live.length === 1 && isTable(r.live[0]);
        if (lone && y + shown + r.h > lim && (y + shown > y0 || cur === side)) {
          // A table that fits a side but not the room left here goes whole
          // onto the next side of the form (the Back), and the rows after
          // it with it; past the last side, whole onto a continued side. One
          // taller than a side (it fit the Front but for the Studio's boxes),
          // or moved once and still too long for the room there (above a
          // docked block), starts here and goes on.
          // (One Report, opts.fill: a table always starts where it is and
          // goes on, so no side ends with room a row would have filled.)
          if (opts.fill || r.moved || r.h > full) {
            tables.push(r.live[0]);
            r = null;
          } else if (!last) {
            r.moved = true;
            carry = [r].concat(queue.slice(i + 1));
            break;
          } else turn();
        }
        if (r) {
          // (A side with only a docked block above the limit continues
          // too: nothing fits above the block.)
          if (y + r.h > lim && (y > y0 || cur === side)) turn();
          place(
            r.live.map(function (c) {
              return { id: c.id, size: c.size, h: r.h };
            }),
            r.h,
            from,
          );
        }
        for (var t = 0; t < tables.length && !carry.length; t++) {
          var stop = flow(tables[t], 0, from);
          if (stop < tables[t].rows.length) {
            carry = [{ resume: tables[t], start: stop, from: from }]
              .concat(
                tables.slice(t + 1).map(function (c) {
                  return { resume: c, start: 0, from: from };
                }),
              )
              .concat(queue.slice(i + 1));
          }
        }
        if (carry.length) break;
      }
      // What follows goes on the next side, so nothing more fits on this one.
      if (carry.length) side.passed = true;
    });
    // After the report: each held block alone on a side of its own.
    after.forEach(function (c) {
      over = true;
      out.push({
        rows: [{ y: top, h: full, cells: [{ id: c.id, size: 'row', h: full }] }],
        kind: 'after',
        from: null,
        head: true,
      });
    });
    return {
      sides: out,
      after: after.map(function (c) {
        return c.id;
      }),
      continued: continued,
      over: over,
    };
  }

  /* A comment box with ruled lines for a student with no comment yet. */
  function _emptyCommentBox(lines) {
    var n = Math.max(1, Number(lines) || BLOCKS['teacher-narrative'].lines);
    return (
      '<div class="report-block-box report-comment-box"><div class="report-block-title">Teacher Comment</div>' +
      '<div class="report-ruled report-ruled-fill report-ruled-empty" style="height:' +
      n * LINE_PX +
      'px"></div></div>'
    );
  }
  /* Ruled lines into the room a text block leaves. */
  function _withRuled(html) {
    return html.replace(/<\/div>\s*$/, '<div class="report-ruled report-ruled-fill"></div></div>');
  }

  /* A cell's options with the registry's defaults filled in, plus its
     no-evidence rule, its lines and its size, as the renderer reads them.
     An option whose default is 'auto' takes the class's value from `autos`
     ({ key: value }) when given, else stays 'auto' for the renderer. */
  function optionsFor(cell, autos) {
    var def = BLOCKS[cell.block] || {};
    var out = {};
    (def.options || []).forEach(function (o) {
      out[o.key] = o.def;
    });
    Object.keys(cell.options || {}).forEach(function (k) {
      out[k] = cell.options[k];
    });
    if (autos) {
      Object.keys(out).forEach(function (k) {
        if (out[k] === 'auto' && k in autos) out[k] = autos[k];
      });
    }
    if (def.noEvidence) out.noEvidence = cell.noEvidence === 'hide' ? 'hide' : 'show';
    if (def.fill && def.lines) out.lines = cell.lines != null ? cell.lines : def.lines;
    out.size = cell.size === 'half' ? 'half' : 'row';
    return out;
  }

  function _cellHtml(cell, cid, student, ctx) {
    var html = ReportBlocks.renderReportBlock(cell.block, cid, student, ctx, optionsFor(cell));
    if (cell.block === 'teacher-narrative' && !html) return _emptyCommentBox(optionsFor(cell).lines);
    if (html && cell.block === 'text-block') html = _withRuled(html);
    return html;
  }

  /* ── Measuring ──────────────────────────────────────────────── */
  /* The off-screen sheet a part is measured in, in the standard type One
     Report prints in. */
  function _stage(host, contentW) {
    var st = document.createElement('div');
    st.className = 'report-sheet report-sheet-measure';
    st.setAttribute('aria-hidden', 'true');
    st.style.cssText =
      'position:absolute;left:-10000px;top:0;width:' +
      contentW +
      'px;height:auto;min-height:0;padding:0;margin:0;box-shadow:none;display:block;visibility:hidden;overflow:visible';
    host.appendChild(st);
    return st;
  }

  function cellWidth(size) {
    return size === 'half' ? HALF_W : ROW_W;
  }

  /* Assignment Grades is rows of divs in one column or two, not a table:
     each row's height is the distance to the next item's top in its
     column, a group's heading counted with the row under it; the last
     reaches the column's bottom. chrome is the rest of the block, plus
     room for the one heading a part may add ("March (continued)"), so a
     part laid out from these heights is never taller than it is said to
     be. In two columns the rows' sum is about twice the table's height,
     so a part takes no more than a side holds. */
  function _measureGradeRows(el, c) {
    var cols = el.querySelectorAll('.report-grades-col');
    var rows = [];
    var headMax = 0;
    var top = Infinity;
    var bottom = -Infinity;
    Array.prototype.forEach.call(cols, function (col) {
      var box = col.getBoundingClientRect();
      top = Math.min(top, box.top);
      bottom = Math.max(bottom, box.bottom);
      var kids = col.children;
      var carry = 0;
      for (var k = 0; k < kids.length; k++) {
        var from = k === 0 ? box.top : kids[k].getBoundingClientRect().top;
        var to = k + 1 < kids.length ? kids[k + 1].getBoundingClientRect().top : box.bottom;
        if (kids[k].classList.contains('report-grades-head')) {
          carry += to - from;
          headMax = Math.max(headMax, to - from);
        } else {
          rows.push(to - from + carry);
          carry = 0;
        }
      }
    });
    if (rows.length < 2) return;
    c.rows = rows;
    c.chrome = Math.max(0, c.px - (bottom - top)) + headMax;
  }

  /* Assignment Grades with only rows [start, end): the groups those rows
     are in, laid out again as the whole table is (ReportBlocks.
     gradeColumnsHtml); a group begun on an earlier part carries on under
     its name with "(continued)", as a group the column split cuts does. */
  function _gradesPartHtml(html, start, end) {
    var tpl = document.createElement('div');
    // html-safe: html is one cell from _cellHtml (ReportBlocks.renderReportBlock), parsed in a detached div
    tpl.innerHTML = html;
    var cols = tpl.querySelectorAll('.report-grades-col');
    if (!cols.length) return html;
    var one = !tpl.querySelector('.report-grades-cols');
    var body = one ? cols[0] : tpl.querySelector('.report-grades-cols');
    var entries = [];
    Array.prototype.forEach.call(cols, function (col) {
      var head = null;
      Array.prototype.forEach.call(col.children, function (k) {
        if (k.classList.contains('report-grades-head')) {
          var name = k.firstElementChild ? k.firstElementChild.textContent : '';
          var grade = k.querySelector('.report-grades-headgrade');
          head = { base: name.replace(/\s*\(continued\)$/, ''), grade: grade ? grade.textContent : '' };
        } else if (k.classList.contains('report-grades-row') && head) {
          var prev = entries[entries.length - 1];
          entries.push({ head: head, base: head.base, first: !prev || prev.base !== head.base, html: k.outerHTML });
        }
      });
    });
    var groups = [];
    entries.slice(start, end).forEach(function (e) {
      var g = groups[groups.length - 1];
      if (g && g.base === e.base) return g.rows.push(e.html);
      groups.push({
        base: e.base,
        name: e.first ? e.base : e.base + ' (continued)',
        grade: e.first ? e.head.grade : '',
        rows: [e.html],
      });
    });
    var fresh = document.createElement('div');
    // html-safe: gradeColumnsHtml esc()s each name and grade; the rows are this cell's own rows, already escaped
    fresh.innerHTML = ReportBlocks.gradeColumnsHtml(groups, one);
    body.replaceWith(fresh.firstElementChild);
    if (start > 0) {
      var title = tpl.querySelector('.report-block-title');
      if (title) title.textContent = title.textContent.replace(/\s*\(continued\)$/, '') + ' (continued)';
    }
    return tpl.innerHTML;
  }

  /* ── Preview ────────────────────────────────────────────────── */
  function _applyZoom(preview, paper) {
    var p = PAPER[paper] || PAPER.letter;
    var sheetW = p.w * PX_PER_IN;
    var avail = Math.max(320, preview.clientWidth - 56);
    var z = Math.min(1, avail / sheetW);
    preview.style.setProperty('--sheet-zoom', String(Math.round(z * 1000) / 1000));
  }

  function _setPageStyle(paper) {
    var style = document.getElementById(PAGE_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = PAGE_STYLE_ID;
      document.head.appendChild(style);
    }
    // Sheets carry their own padding, so the page itself has none.
    style.textContent = '@media print { @page { size: ' + paperSize(paper) + '; margin: 0; } }';
  }

  function clearPageStyle() {
    var style = document.getElementById(PAGE_STYLE_ID);
    if (style) style.remove();
  }

  function _summary(students) {
    return {
      students: students.length,
      sheets: 0,
      pages: 0,
      continued: [],
      over: [],
      noComment: [],
      noAttendance: [],
      perStudent: {},
    };
  }
  function _count(summary, st, r) {
    summary.sheets += r.sheets;
    summary.pages += r.sheets * 2;
    if (r.sheets > 1) summary.continued.push(fullName(st));
    if (r.over) summary.over.push(fullName(st));
    if (r.noComment) summary.noComment.push(fullName(st));
    if (r.noAttendance) summary.noAttendance.push(fullName(st));
    summary.perStudent[st.id] = {
      sheets: r.sheets,
      sides: r.sides,
      over: r.over,
      feedbackOver: !!r.feedbackOver,
      gradeOver: !!r.gradeOver,
      continued: r.continued,
      after: r.after,
      badge: r.badge,
      noComment: r.noComment,
      noAttendance: r.noAttendance,
      name: fullName(st),
      used: r.used,
      free: r.free,
    };
    return summary.perStudent[st.id];
  }

  /* Renders every student's sheets into `preview`. Returns a summary
     { students, sheets, pages, continued: [names], over: [names],
     noComment: [names], perStudent }. opts.layout lays out one student
     (One Report's, ReportOne.layoutWith). */
  function renderPreview(opts) {
    var preview = opts.preview;
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var lay = opts.layout;
    var stage = _stage(preview, ROW_W);
    var summary = _summary(opts.students);
    summary.sideHeight = sideHeight(paper);
    var html = opts.students
      .map(function (st) {
        var r = lay(opts.cid, st, opts.ctx, { paper: paper, stage: stage });
        _count(summary, st, r).html = r.html;
        return r.html;
      })
      .join('');
    stage.remove();
    // html-safe: the students' renders from opts.layout (ReportOne.layoutStudent): ids and names esc()'d, cells from ReportBlocks.renderReportBlock
    preview.innerHTML = html;
    preview.classList.add('report-sheets-on');
    _applyZoom(preview, paper);
    _setPageStyle(paper);
    return summary;
  }

  /* The class laid out, without rendering: the same
     summary renderPreview returns, minus the HTML. For the fit line while
     one student is on screen. opts.layout as renderPreview. */
  function classSummary(cid, students, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var lay = opts.layout;
    var stage = _stage(document.body, ROW_W);
    var summary = _summary(students);
    try {
      summary.sideHeight = sideHeight(paper);
      students.forEach(function (st) {
        var r = lay(cid, st, ctx, { paper: paper, stage: stage });
        _count(summary, st, r).hash = ReportIssuesHash(r.html);
      });
    } finally {
      stage.remove();
    }
    return summary;
  }
  function ReportIssuesHash(html) {
    return typeof ReportIssues !== 'undefined' && ReportIssues.hash ? ReportIssues.hash(html) : '';
  }

  return {
    GAP: GAP,
    ROW_W: ROW_W,
    HALF_W: HALF_W,
    form: form,
    BLOCKS: BLOCKS,
    canHalf: canHalf,
    normalizeForm: normalizeForm,
    optionsFor: optionsFor,
    formFor: formFor,
    hiddenFor: hiddenFor,
    pack: pack,
    sideHeight: sideHeight,
    cellWidth: cellWidth,
    classSummary: classSummary,
    paperSize: paperSize,
    renderPreview: renderPreview,
    clearPageStyle: clearPageStyle,
    setPageStyle: _setPageStyle,
    // One Report (report-one.js) lays its own cells out with these.
    one: {
      PAPER: PAPER,
      cellHtml: _cellHtml,
      measureGradeRows: _measureGradeRows,
      gradesPartHtml: _gradesPartHtml,
    },
  };
})();
