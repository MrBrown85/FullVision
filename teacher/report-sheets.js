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
    letter: { w: 8.5, h: 11, size: '8.5in 11in' },
    legal: { w: 8.5, h: 14, size: '8.5in 14in' },
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
  var FORM_INTERIM = {
    v: 6,
    id: 'interim-update',
    name: 'Interim Update',
    type: 'standard',
    sides: [
      {
        rows: [
          _row(_c('header')),
          _row(_c('proficiency')),
          _row(_c('teacher-narrative', 'row', { lines: 10 })),
          _row(_c('legend')),
        ],
      },
    ],
    pinned: null,
    perStudent: {},
  };
  var FORM_CONFERENCE = {
    v: 6,
    id: 'conference-pack',
    name: 'Conference Pack',
    type: 'standard',
    sides: [
      {
        rows: [
          _row(_c('header')),
          _row(_c('proficiency')),
          _row(_c('legend')),
          _row(_c('teacher-narrative', 'row', { lines: 10 })),
          _row(_c('next-steps')),
        ],
      },
      {
        rows: [
          _row(_c('learner-dimensions')),
          _row(_c('grade-table', 'row', { options: { range: 'all' } })),
          _row(_c('parent-response', 'row', { lines: 3 })),
        ],
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
          def: 'each',
          choices: [
            { v: 'each', label: 'Each Competency' },
            { v: 'group', label: 'Each Group' },
          ],
          groups: true,
        },
        { key: 'score', label: 'Score out of 4', def: true },
        { key: 'word', label: 'Proficiency Word', def: 'auto' },
        { key: 'change', label: 'Change', def: true },
        { key: 'assessed', label: 'Assessed Count', def: true },
        { key: 'overall', label: 'Overall', def: true },
        { key: 'facts', label: 'Highest and Lowest Lines', def: true },
        {
          key: 'compare',
          label: 'Compare With',
          def: 'last',
          choices: [
            { v: 'last', label: 'Last Report' },
            { v: 'start', label: 'Start of Term' },
          ],
        },
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
      options: [
        { key: 'course', label: 'Course Grade', def: true },
        { key: 'categoryGrade', label: 'Category Grades', def: true },
        { key: 'score', label: 'Score', def: true },
        { key: 'percent', label: 'Percent', def: 'auto' },
        { key: 'word', label: 'Proficiency Word', def: 'auto' },
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
  var BLOCK_ORDER = Object.keys(BLOCKS);
  var PALETTE_GROUPS = ['Grades', 'Comments and Evidence', 'Student Voice', 'Learner Profile', 'Family'];

  function _clone(f) {
    return JSON.parse(JSON.stringify(f));
  }
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

  /* A block new to the form, with the options it starts on. */
  function _newCell(id) {
    var def = BLOCKS[id];
    return _cleanCell({ block: id, options: def && def.start });
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
    return {
      v: 6,
      id: base.id || 'report-card',
      name: base.name || 'Report Card',
      type: base.type === 'compact' ? 'compact' : 'standard',
      sides: sides,
      pinned: pinned,
      perStudent: per,
    };
  }

  /* The class's form from its report config. A class still on the old
     Brief preset opens on the Interim Update; anything else without a
     saved form opens on the name and Assignment Grades. */
  function formFor(reportConfig) {
    if (reportConfig && reportConfig.form) return normalizeForm(reportConfig.form);
    if (reportConfig && reportConfig.preset === 'brief') return normalizeForm(FORM_INTERIM);
    return normalizeForm(FORM_DEFAULT);
  }

  /* ── Reading the form ─────────────────────────────────────────── */
  /* Ids on the form, in order. */
  function onForm(f) {
    var ids = [];
    f.sides.forEach(function (sd) {
      sd.rows.forEach(function (row) {
        row.cells.forEach(function (c) {
          ids.push(c.block);
        });
      });
    });
    return ids;
  }
  function available(f) {
    var on = onForm(f);
    return BLOCK_ORDER.filter(function (id) {
      return !BLOCKS[id].locked && on.indexOf(id) < 0;
    });
  }
  /* Where a block is: { side, row, index }, or null. */
  function locate(f, id) {
    for (var s = 0; s < f.sides.length; s++) {
      var rows = f.sides[s].rows;
      for (var r = 0; r < rows.length; r++) {
        for (var i = 0; i < rows[r].cells.length; i++) {
          if (rows[r].cells[i].block === id) return { side: s, row: r, index: i };
        }
      }
    }
    return null;
  }
  function cellOf(f, id) {
    var at = locate(f, id);
    return at ? f.sides[at.side].rows[at.row].cells[at.index] : null;
  }
  /* The other block in a pair, or null. */
  function partnerOf(f, id) {
    var at = locate(f, id);
    if (!at) return null;
    var row = f.sides[at.side].rows[at.row];
    return row.cells.length === 2 ? row.cells[1 - at.index].block : null;
  }
  /* The rows a block may be dropped at on a side: before the pinned row. */
  function _lastRow(f, side) {
    var rows = f.sides[side].rows;
    var n = rows.length;
    if (
      f.pinned &&
      n &&
      rows[n - 1].cells.some(function (c) {
        return c.block === f.pinned;
      })
    )
      n--;
    return n;
  }

  /* ── Editing (pure: each returns a new, normalized form) ─────────── */
  /* The cell taken off the form, keeping its options, lines and pin; its
     partner, if it had one, stays alone in the row at half width. */
  function _take(f, id) {
    var at = locate(f, id);
    if (!at) return null;
    var row = f.sides[at.side].rows[at.row];
    var cell = row.cells.splice(at.index, 1)[0];
    if (!row.cells.length) f.sides[at.side].rows.splice(at.row, 1);
    return cell;
  }
  /* Puts a block (new or moved) in its own row on a side, at row index
     `row` (clamped before the pinned row; absent → last). size: 'row' or
     'half'; a moved block keeps its size unless one is given. */
  function insert(f, id, to) {
    if (!BLOCKS[id] || id === 'header') return f;
    to = to || {};
    f = _clone(f);
    var cell = _take(f, id) || _newCell(id);
    if (to.size) cell.size = to.size;
    var side = _clamp(_int(to.side, f.sides.length - 1), 0, f.sides.length - 1);
    var last = _lastRow(f, side);
    var row = _clamp(_int(to.row, last), side === 0 ? 1 : 0, last);
    f.sides[side].rows.splice(row, 0, { cells: [cell] });
    return normalizeForm(f);
  }
  /* Puts a block beside another, as a pair, when both may go Side by Side
     and the target is alone in its row. Otherwise the form is unchanged. */
  function beside(f, id, targetId) {
    if (!canHalf(id) || !canHalf(targetId) || id === targetId) return f;
    var target = locate(f, targetId);
    if (!target || f.sides[target.side].rows[target.row].cells.length !== 1) return f;
    f = _clone(f);
    var cell = _take(f, id) || _newCell(id);
    var at = locate(f, targetId);
    var row = f.sides[at.side].rows[at.row];
    cell.size = 'half';
    row.cells[0].size = 'half';
    row.cells.push(cell);
    return normalizeForm(f);
  }
  /* One row up or down on its side (a pair moves together). */
  function moveRow(f, id, dir) {
    var at = locate(f, id);
    if (!at || id === 'header' || id === f.pinned) return f;
    var to = at.row + (dir < 0 ? -1 : 1);
    var lo = at.side === 0 ? 1 : 0;
    if (to < lo || to >= _lastRow(f, at.side)) return f;
    f = _clone(f);
    var rows = f.sides[at.side].rows;
    var row = rows.splice(at.row, 1)[0];
    rows.splice(to, 0, row);
    return normalizeForm(f);
  }
  /* To the end of another side (before its pinned row). A pair moves
     together. */
  function moveToSide(f, id, side) {
    var at = locate(f, id);
    if (!at || id === 'header' || id === f.pinned || !f.sides[side] || side === at.side) return f;
    f = _clone(f);
    var row = f.sides[at.side].rows.splice(at.row, 1)[0];
    f.sides[side].rows.splice(_lastRow(f, side), 0, row);
    return normalizeForm(f);
  }
  /* Layout Rule 6: two Side by Side blocks pair only when the shorter is at
     least half the taller one's height. heights: { id: px at Side by Side }
     (blockSizes' half); a block not measured yet pairs. */
  function pairsWell(a, b, heights) {
    if (!canHalf(a) || !canHalf(b)) return false;
    var ha = heights && heights[a];
    var hb = heights && heights[b];
    if (!(ha > 0) || !(hb > 0)) return true;
    return Math.min(ha, hb) >= Math.max(ha, hb) / 2;
  }

  /* Row or Side by Side. Going Side by Side, a lone Side by Side block in
     the row just above or below becomes its partner when the two pair well
     (heights, as pairsWell). Back to Row, a paired block's partner stays
     alone at half width in the row below it. */
  function setSize(f, id, size, heights) {
    var at = locate(f, id);
    if (!at || id === 'header') return f;
    f = _clone(f);
    var rows = f.sides[at.side].rows;
    var row = rows[at.row];
    var cell = row.cells[at.index];
    if (size === 'half') {
      if (!canHalf(id)) return normalizeForm(f);
      cell.size = 'half';
      if (row.cells.length === 1) {
        var lone = function (r) {
          return (
            r &&
            r.cells.length === 1 &&
            r.cells[0].size === 'half' &&
            canHalf(r.cells[0].block) &&
            r.cells[0].block !== 'header' &&
            r.cells[0].block !== f.pinned &&
            pairsWell(id, r.cells[0].block, heights)
          );
        };
        var near = lone(rows[at.row - 1]) ? at.row - 1 : lone(rows[at.row + 1]) ? at.row + 1 : -1;
        if (near >= 0) {
          var partner = rows.splice(near, 1)[0].cells[0];
          if (near < at.row) row.cells.unshift(partner);
          else row.cells.push(partner);
        }
      }
      return normalizeForm(f);
    }
    cell.size = 'row';
    if (row.cells.length === 2) {
      row.cells.splice(at.index, 1);
      f.sides[at.side].rows.splice(at.row, 0, { cells: [cell] });
    }
    return normalizeForm(f);
  }
  function setLines(f, id, n) {
    f = _clone(f);
    var cell = cellOf(f, id);
    var def = BLOCKS[id];
    if (!cell || !def || !def.fill || !def.lines) return f;
    cell.lines = _linesOf(def, n);
    return normalizeForm(f);
  }
  function removeCell(f, id) {
    if (id === 'header' || !locate(f, id)) return f;
    f = _clone(f);
    _take(f, id);
    if (f.pinned === id) f.pinned = null;
    return normalizeForm(f);
  }
  function setOption(f, id, key, value) {
    f = _clone(f);
    var cell = cellOf(f, id);
    if (!cell) return f;
    cell.options = cell.options || {};
    cell.options[key] = value;
    return normalizeForm(f);
  }
  function setNoEvidence(f, id, rule) {
    f = _clone(f);
    var cell = cellOf(f, id);
    if (cell) cell.noEvidence = rule === 'hide' ? 'hide' : 'show';
    return normalizeForm(f);
  }
  function setPinned(f, id) {
    f = _clone(f);
    f.pinned = id && BLOCKS[id] && BLOCKS[id].pinnable && locate(f, id) ? id : null;
    return normalizeForm(f);
  }
  function setType(f, type) {
    f = _clone(f);
    f.type = type === 'compact' ? 'compact' : 'standard';
    return f;
  }
  function addSide(f) {
    f = _clone(f);
    f.sides.push({ rows: [] });
    return normalizeForm(f);
  }
  /* Only an empty side past the second. */
  function removeSide(f, i) {
    if (i < 2 || !f.sides[i] || f.sides[i].rows.length) return f;
    f = _clone(f);
    f.sides.splice(i, 1);
    return normalizeForm(f);
  }
  /* Front Only (1) or Front and Back (2). Going to Front Only, every row
     past the Front moves onto it, in order, so nothing is lost; the fit
     line then says what that costs. Going to Front and Back from one side
     adds an empty Back. */
  function setSides(f, n) {
    f = _clone(f);
    if (n === 1) {
      var front = f.sides[0];
      var pinnedRow = null;
      f.sides.slice(1).forEach(function (sd) {
        sd.rows.forEach(function (row) {
          if (
            row.cells.some(function (c) {
              return c.block === f.pinned;
            })
          )
            pinnedRow = row;
          else front.rows.push(row);
        });
      });
      if (pinnedRow) front.rows.push(pinnedRow);
      f.sides = [front];
    } else if (f.sides.length < 2) {
      f.sides.push({ rows: [] });
    }
    return normalizeForm(f);
  }
  /* Hide a block for one student without changing the class layout. */
  function hideFor(f, sid, id, on) {
    f = _clone(f);
    var e = f.perStudent[sid] || { hide: [] };
    e.hide = e.hide.filter(function (x) {
      return x !== id;
    });
    if (on) e.hide.push(id);
    if (e.hide.length) f.perStudent[sid] = e;
    else delete f.perStudent[sid];
    return normalizeForm(f);
  }
  function hiddenFor(f, sid) {
    var e = f.perStudent && f.perStudent[sid];
    return e && e.hide ? e.hide.slice() : [];
  }

  /* ── Starters and the teacher's library ─────────────────────── */
  var STARTERS = [
    { id: 'report-card', name: 'Report Card', form: FORM_REPORT_CARD },
    { id: 'interim-update', name: 'Interim Update', form: FORM_INTERIM },
    { id: 'conference-pack', name: 'Conference Pack', form: FORM_CONFERENCE },
  ];
  function starters() {
    return STARTERS.map(function (st) {
      return { id: st.id, name: st.name };
    });
  }
  function starter(id) {
    var st = STARTERS.find(function (x) {
      return x.id === id;
    });
    return st ? normalizeForm(st.form) : null;
  }

  var LIBRARY_KEY = 'gb-report-templates';
  function templates() {
    try {
      var list = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function _writeTemplates(list) {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    } catch (e) {
      /* the copy is a convenience; the server row is the record */
    }
  }
  function _isUuidId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function _sameName(a, b) {
    return (
      String(a || '')
        .trim()
        .toLowerCase() ===
      String(b || '')
        .trim()
        .toLowerCase()
    );
  }
  /* A server row as the device keeps it. */
  function _fromRow(row) {
    return {
      id: row.id,
      name: row.name,
      savedAt: row.updated_at || row.created_at || new Date().toISOString(),
      form: normalizeForm(Object.assign({}, row.form, { name: row.name })),
    };
  }
  function _v2(name) {
    return typeof window !== 'undefined' && window.v2 && typeof window.v2[name] === 'function' ? window.v2[name] : null;
  }
  /* Refresh the device copy from the server. Resolves true when the list
     changed. With no server (Demo Mode, signed out, offline) the copy stays
     as it is; a form saved here that the server has not confirmed yet (a
     non-UUID id) is kept in front of the server's rows. */
  function syncTemplates() {
    var list = _v2('listReportTemplates');
    if (!list) return Promise.resolve(false);
    return list().then(
      function (res) {
        if (!res || !Array.isArray(res.data)) return false;
        var before = JSON.stringify(templates());
        var pending = templates().filter(function (t) {
          return !_isUuidId(t.id);
        });
        var rows = res.data.map(_fromRow);
        var merged = pending
          .filter(function (p) {
            return !rows.some(function (r) {
              return _sameName(r.name, p.name);
            });
          })
          .concat(rows);
        _writeTemplates(merged);
        return JSON.stringify(merged) !== before;
      },
      function () {
        return false;
      },
    );
  }
  /* Saves to the device now and to the server; the entry is returned at
     once with a local id, which the server's id replaces when the save
     lands (template() and removeTemplate() answer to either). The same name
     replaces the earlier form, as the server does. */
  function saveTemplate(name, f) {
    name = String(name || '').trim();
    if (!name) return null;
    var entry = {
      id: 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name: name,
      savedAt: new Date().toISOString(),
      form: normalizeForm(Object.assign({}, _clone(f), { name: name })),
    };
    var existing = templates().find(function (t) {
      return _sameName(t.name, name);
    });
    if (existing && _isUuidId(existing.id)) entry.id = existing.id;
    _writeTemplates(
      [entry]
        .concat(
          templates().filter(function (t) {
            return !_sameName(t.name, name);
          }),
        )
        .slice(0, 30),
    );
    var save = _v2('saveReportTemplate');
    if (save) {
      var localId = entry.id;
      save({ id: _isUuidId(entry.id) ? entry.id : null, name: name, form: entry.form }).then(
        function (res) {
          var row = res && res.data && res.data.id ? res.data : null;
          if (!row || _isUuidId(localId)) return;
          _writeTemplates(
            templates().map(function (t) {
              return t.id === localId ? Object.assign({}, t, { id: row.id, localId: localId }) : t;
            }),
          );
        },
        function () {
          /* the device copy stands; the outbox retries the write */
        },
      );
    }
    return entry;
  }
  function _find(id) {
    return templates().find(function (t) {
      return t.id === id || t.localId === id;
    });
  }
  function removeTemplate(id) {
    var t = _find(id);
    _writeTemplates(
      templates().filter(function (x) {
        return x !== t && x.id !== id && x.localId !== id;
      }),
    );
    var del = _v2('deleteReportTemplate');
    if (t && del && _isUuidId(t.id)) del(t.id);
  }
  function template(id) {
    var t = _find(id);
    return t ? normalizeForm(t.form) : null;
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
     px. opts: { H (a side's height), gap, pinned (id) }.
     Each side is laid top to bottom: a row takes the taller of its cells
     and sits `gap` under the row before it. The pinned block is docked to
     the bottom of its side, and the gap above it is the side's limit. A
     row that passes the limit, and every row after it on that side, moves
     to a continued side inserted after it (for this student only). A row
     taller than a whole side is held back and printed after the report,
     on as many sides as it needs: a table is cut at its rows, anything
     else goes alone and over. Returns { sides: [{ rows: [{ y, h, cells:
     [{ id, size, h, part? }] }], pinned?, kind: 'side' | 'continued' |
     'after', from }], after: [id], continued: [id], over }. */
  function pack(sides, opts) {
    var H = opts.H;
    var gap = opts.gap != null ? opts.gap : GAP;
    var out = [];
    var after = [];
    var continued = [];
    var over = false;
    var sum = function (list) {
      return list.reduce(function (a, b) {
        return a + b;
      }, 0);
    };
    var rowOf = function (cells) {
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
      return { h: h, cells: cells, live: live };
    };
    sides.forEach(function (rows, s) {
      var pin = null;
      var queue = [];
      rows.forEach(function (cells) {
        var r = rowOf(cells);
        if (
          cells.some(function (c) {
            return c.id === opts.pinned;
          })
        )
          pin = r;
        else queue.push(r);
      });
      var limit = H;
      var side = { rows: [], kind: 'side', from: s };
      out.push(side);
      if (pin && pin.live.length) {
        var ph = Math.min(pin.h, H);
        if (pin.h > H) over = true;
        limit = Math.max(0, H - ph - gap);
        side.pinned = { id: pin.cells[0].id, size: 'row', h: ph, y: H - ph };
      }
      var cur = side;
      var y = 0;
      queue.forEach(function (r) {
        if (!r.live.length) {
          // Nothing to print: the row keeps its place at no height, so the
          // canvas can still show and select the block.
          cur.rows.push({
            y: y,
            h: 0,
            empty: true,
            cells: r.cells.map(function (c) {
              return { id: c.id, size: c.size, h: 0 };
            }),
          });
          return;
        }
        if (r.h > H) {
          // Taller than a whole side: after the report. A short partner
          // stays on its side, alone in the row.
          var short = [];
          r.live.forEach(function (c) {
            if (c.px > H) after.push(c);
            else short.push(c);
          });
          if (!short.length) return;
          r = rowOf(short);
        }
        var lim = cur === side ? limit : H;
        if (y + r.h > lim && (y > 0 || cur === side)) {
          // The rest of this side continues on a side of its own, for this
          // student. (A side with only a docked block above the limit
          // continues too: nothing fits above the block.)
          cur = { rows: [], kind: 'continued', from: s };
          out.push(cur);
          y = 0;
        }
        var row = {
          y: y,
          h: r.h,
          cells: r.live.map(function (c) {
            return { id: c.id, size: c.size, h: r.h };
          }),
        };
        if (cur !== side) {
          row.cells.forEach(function (c) {
            if (continued.indexOf(c.id) < 0) continued.push(c.id);
          });
        }
        cur.rows.push(row);
        y += r.h + gap;
      });
    });
    // After the report: each held block on its own sides, a table cut at
    // its rows where a side ends.
    after.forEach(function (c) {
      if (c.rows && c.rows.length > 1) {
        var start = 0;
        while (start < c.rows.length) {
          var room = H - c.chrome - 1;
          var take = 0;
          var used = 0;
          while (start + take < c.rows.length && used + c.rows[start + take] <= room) {
            used += c.rows[start + take];
            take++;
          }
          if (take === 0) {
            take = 1;
            over = true;
          }
          var h = Math.min(H, c.chrome + sum(c.rows.slice(start, start + take)));
          out.push({
            rows: [{ y: 0, h: h, cells: [{ id: c.id, size: 'row', h: h, part: { start: start, end: start + take } }] }],
            kind: 'after',
            from: null,
          });
          start += take;
        }
      } else {
        over = true;
        out.push({ rows: [{ y: 0, h: H, cells: [{ id: c.id, size: 'row', h: H }] }], kind: 'after', from: null });
      }
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
  function _stage(host, contentW, type) {
    var st = document.createElement('div');
    st.className = 'report-sheet report-sheet-measure' + (type === 'compact' ? ' compact' : '');
    st.setAttribute('aria-hidden', 'true');
    st.style.cssText =
      'position:absolute;left:-10000px;top:0;width:' +
      contentW +
      'px;height:auto;min-height:0;padding:0;margin:0;box-shadow:none;display:block;visibility:hidden;overflow:visible';
    host.appendChild(st);
    return st;
  }

  function _measureAll(stage, htmls) {
    stage.innerHTML = htmls
      .map(function (h) {
        return '<div class="sheet-item">' + h + '</div>';
      })
      .join('');
    return Array.prototype.map.call(stage.children, function (c) {
      return c.offsetHeight;
    });
  }

  /* One comment line and the box around it, in px, from the real CSS. */
  function _probe(stage) {
    var one = ReportBlocks.renderCommentBox('A');
    var two = ReportBlocks.renderCommentBox('A<br>A');
    var h = _measureAll(stage, [one, two]);
    var linePx = Math.max(12, h[1] - h[0]);
    return { linePx: linePx, boxChromePx: Math.max(0, h[0] - linePx) };
  }

  function cellWidth(size) {
    return size === 'half' ? HALF_W : ROW_W;
  }

  /* Each cell rendered for the student and measured at its own width, as
     it will sit on the page: { px, rows?, chrome? } on each entry. */
  function _measureCells(stage, cells) {
    stage.innerHTML = cells
      .map(function (c) {
        return (
          '<div class="sheet-cell" data-block="' +
          c.cell.block +
          '" style="width:' +
          cellWidth(c.size) +
          'px">' +
          c.html +
          '</div>'
        );
      })
      .join('');
    Array.prototype.forEach.call(stage.children, function (el, i) {
      var c = cells[i];
      c.px = c.html ? el.offsetHeight : 0;
      if (!c.html || !BLOCKS[c.cell.block].table) return;
      var tbody = el.querySelector('table tbody');
      if (!tbody || tbody.rows.length < 2) return;
      // Each row's height is the distance to the next row's top, so the
      // collapsed borders between rows are counted; the last row reaches
      // the table body's bottom.
      var tops = Array.prototype.map.call(tbody.rows, function (r) {
        return r.getBoundingClientRect().top;
      });
      var bottom = tbody.getBoundingClientRect().bottom;
      c.rows = tops.map(function (t, i) {
        return (i + 1 < tops.length ? tops[i + 1] : bottom) - t;
      });
      c.chrome = Math.max(0, c.px - (bottom - tops[0]));
    });
  }

  /* ── Sheets ─────────────────────────────────────────────────── */
  /* The block with only rows [start, end) of its first table body. */
  function _partHtml(html, start, end, continued) {
    var tpl = document.createElement('div');
    tpl.innerHTML = html;
    var table = tpl.querySelector('table');
    var body = table && table.tBodies[0];
    if (!body) return html;
    Array.prototype.slice.call(body.rows).forEach(function (r, i) {
      if (i < start || i >= end) r.remove();
    });
    if (continued) {
      var title = tpl.querySelector('.report-block-title');
      if (title) title.textContent = title.textContent.replace(/\s*\(continued\)$/, '') + ' (continued)';
    }
    return tpl.innerHTML;
  }

  /* A placed cell. A block left off this student's report keeps its place
     as an empty cell (nothing prints), so the Studio can still select it. */
  function _cellTag(c, html, off, rowH) {
    if (c.part) html = _partHtml(html, c.part.start, c.part.end, c.part.start > 0);
    var def = BLOCKS[c.id] || {};
    return (
      '<div class="sheet-cell' +
      (def.fill ? ' sheet-fill' : '') +
      (html ? '' : ' sheet-empty') +
      (off ? ' sheet-off' : '') +
      '" data-block="' +
      c.id +
      '" data-size="' +
      c.size +
      '" data-label="' +
      esc(def.label || c.id) +
      '" style="width:' +
      cellWidth(c.size) +
      'px;min-height:' +
      rowH +
      'px">' +
      html +
      '</div>'
    );
  }

  function _rowTag(row, cellHtml, offIds, extra) {
    return (
      '<div class="sheet-row' +
      (extra || '') +
      (row.empty ? ' sheet-row-empty' : '') +
      '" style="min-height:' +
      row.h +
      'px">' +
      row.cells
        .map(function (c) {
          return _cellTag(c, cellHtml[c.id] || '', offIds.indexOf(c.id) >= 0, row.h);
        })
        .join('') +
      '</div>'
    );
  }

  function _sideHtml(side, cellHtml, offIds, paper, opts) {
    var body;
    if (!side) body = '<div class="sheet-blank">This side is left blank.</div>';
    else {
      body = side.rows
        .map(function (row) {
          return _rowTag(row, cellHtml, offIds, '');
        })
        .join('');
      if (side.pinned) {
        body += _rowTag(
          { h: side.pinned.h, cells: [{ id: side.pinned.id, size: 'row', h: side.pinned.h }] },
          cellHtml,
          offIds,
          ' sheet-pinned',
        );
      }
    }
    return (
      '<div class="report-sheet' +
      (side && side.over ? ' sheet-overflow' : '') +
      (side ? '' : ' sheet-blank-side') +
      (opts.type === 'compact' ? ' compact' : '') +
      '" data-paper="' +
      paper +
      '"' +
      (side ? ' data-kind="' + side.kind + '"' + (side.from != null ? ' data-side="' + side.from + '"' : '') : '') +
      '>' +
      '<div class="sheet-body">' +
      body +
      '</div>' +
      '</div>'
    );
  }

  /* What a side is called on screen. */
  function sideLabel(side, i) {
    if (!side) return 'Blank';
    if (side.kind === 'continued') return 'Continued';
    if (side.kind === 'after') return 'After the Report';
    if (side.from === 0) return 'Front';
    if (side.from === 1) return 'Back';
    return 'Page ' + (side.from + 1);
  }

  /* Lays one student onto the form's sides. Returns { html, sheets, sides,
     continued: [blockId], after: [label], over, used, free: [px per
     stored side], commentLines, room, noComment, noAttendance, badge }. */
  function layoutStudent(cid, student, ctx, opts) {
    var f = opts.form || normalizeForm(FORM_REPORT_CARD);
    var probe = opts.probe;
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var H = sideHeight(paper);
    var hidden = hiddenFor(f, student.id);
    var cells = [];
    var measured = [];
    var sides = f.sides.map(function (sd) {
      return sd.rows.map(function (row) {
        return row.cells.map(function (cell) {
          var off = hidden.indexOf(cell.block) >= 0;
          var size = row.cells.length === 2 ? 'half' : cell.size;
          var m = { cell: cell, size: size, off: off, html: off ? '' : _cellHtml(cell, cid, student, ctx) };
          measured.push(m);
          cells.push(m);
          return m;
        });
      });
    });
    _measureCells(opts.stage, measured);
    var cellHtml = {};
    var used = 0;
    var comment = null;
    measured.forEach(function (m) {
      cellHtml[m.cell.block] = m.html;
      used += m.px;
      if (m.cell.block === 'teacher-narrative') comment = m;
    });
    var r = pack(
      sides.map(function (rows) {
        return rows.map(function (row) {
          return row.map(function (m) {
            return { id: m.cell.block, size: m.size, px: m.px, empty: !m.html, rows: m.rows, chrome: m.chrome };
          });
        });
      }),
      { H: H, gap: GAP, pinned: f.pinned },
    );
    // The room left on each stored side, for the palette's fit checks.
    var free = f.sides.map(function (sd, s) {
      var side = r.sides.find(function (x) {
        return x.kind === 'side' && x.from === s;
      });
      if (!side) return H;
      var limit = side.pinned ? side.pinned.y - GAP : H;
      var filled = side.rows.filter(function (row) {
        return !row.empty;
      });
      var last = filled[filled.length - 1];
      var bottom = last ? last.y + last.h : 0;
      var contd = r.sides.some(function (x) {
        return x.kind === 'continued' && x.from === s;
      });
      return contd ? 0 : Math.max(0, limit - bottom - (last ? GAP : 0));
    });
    var labelOf = function (id) {
      return BLOCKS[id] ? BLOCKS[id].label : id;
    };
    r.sides.forEach(function (sd) {
      sd.over = sd.rows.some(function (row) {
        return row.y + row.h > H;
      });
    });
    // An Attendance block on the form with nothing to print (no totals
    // entered, and not left off on purpose), for the print dialog.
    var attendance = measured.find(function (m) {
      return m.cell.block === 'term-attendance';
    });
    var noAttendance = !!attendance && !attendance.off && !attendance.html;
    // The comment's lines and its box's room, for the questionnaire.
    var noComment = !!comment && /report-ruled-empty/.test(comment.html);
    var room = comment ? optionsFor(comment.cell).lines : 0;
    var commentLines =
      comment && !noComment ? Math.max(1, Math.round((comment.px - probe.boxChromePx) / probe.linePx)) : 0;

    var sideCount = r.sides.length;
    var sheetCount = Math.max(1, Math.ceil(sideCount / 2));
    var badge = noComment && sheetCount === 1 ? 'No comment' : sheetCount === 1 ? '1 sheet' : sheetCount + ' sheets';
    var name = fullName(student);
    var total = sheetCount * 2;
    var html =
      '<div class="sheet-student" data-action="fitMapPick" data-sid="' +
      esc(student.id) +
      '" data-sheets="' +
      sheetCount +
      '" data-continued="' +
      r.continued.length +
      '" data-after="' +
      r.after.length +
      '">' +
      '<div class="sheet-student-head no-print"><span class="sheet-student-name">' +
      esc(name) +
      '</span><span class="sheet-badge ' +
      (sheetCount > 1 ? 'over' : noComment ? 'none' : 'ok') +
      '">' +
      badge +
      '</span></div>';
    for (var s = 0; s < total; s++) {
      var side = r.sides[s] || null;
      html +=
        '<div class="sheet-zoom"' +
        (side && side.kind === 'side' ? ' data-side="' + side.from + '"' : '') +
        (side && side.kind === 'continued' ? ' data-from="' + side.from + '"' : '') +
        '><div class="sheet-label no-print">' +
        esc(sideLabel(side, s)) +
        '</div>' +
        _sideHtml(side, cellHtml, hidden, paper, { type: f.type }) +
        '</div>';
    }
    html += '</div>';
    return {
      html: html,
      sheets: sheetCount,
      sides: sideCount,
      continued: r.continued,
      after: r.after.map(labelOf),
      over: r.over,
      used: used,
      free: free,
      commentLines: commentLines,
      room: room,
      noComment: noComment,
      noAttendance: noAttendance,
      badge: badge,
    };
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
     noComment: [names], perStudent }. opts.layout replaces layoutStudent
     (the Grade Report, grade-report.js). */
  function renderPreview(opts) {
    var preview = opts.preview;
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var formUsed = normalizeForm(opts.form);
    var lay = opts.layout || layoutStudent;
    var stage = _stage(preview, ROW_W, formUsed.type);
    var probe = _probe(stage);
    var summary = _summary(opts.students);
    summary.sideHeight = sideHeight(paper);
    var html = opts.students
      .map(function (st) {
        var r = lay(opts.cid, st, opts.ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
        _count(summary, st, r).html = r.html;
        return r.html;
      })
      .join('');
    stage.remove();
    preview.innerHTML = html;
    preview.classList.add('report-sheets-on');
    _applyZoom(preview, paper);
    _setPageStyle(paper);
    return summary;
  }

  /* Lays one student out without rendering, for the questionnaire's
     comment box. The stage lives on <body>; .report-sheet carries its own
     sizes, so the measurement matches the preview. */
  function describeStudent(cid, student, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(document.body, ROW_W, formUsed.type);
    try {
      var probe = _probe(stage);
      var r = layoutStudent(cid, student, ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
      delete r.html;
      return r;
    } finally {
      stage.remove();
    }
  }

  /* The class laid out on the current form, without rendering: the same
     summary renderPreview returns, minus the HTML. For the fit line while
     one student is on screen. opts.layout as renderPreview. */
  function classSummary(cid, students, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var formUsed = normalizeForm(opts.form);
    var lay = opts.layout || layoutStudent;
    var stage = _stage(document.body, ROW_W, formUsed.type);
    var summary = _summary(students);
    try {
      var probe = _probe(stage);
      summary.sideHeight = sideHeight(paper);
      students.forEach(function (st) {
        var r = lay(cid, st, ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
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

  /* Each block's height at Row width and at Side by Side width, as the
     tallest of the given students needs: { blockId: { row, half } }. half
     is null for a block that never goes Side by Side. A block that prints
     nothing for a student takes no room for them. For the palette's fit
     checks and its previews. */
  function blockSizes(cid, students, ctx, opts) {
    opts = opts || {};
    var formUsed = opts.form ? normalizeForm(opts.form) : null;
    var stage = _stage(document.body, ROW_W, opts.type === 'compact' ? 'compact' : 'standard');
    var out = {};
    var ids = BLOCK_ORDER.filter(function (id) {
      return id !== 'text-block';
    });
    ids.forEach(function (id) {
      out[id] = { row: 0, half: canHalf(id) ? 0 : null };
    });
    try {
      (Array.isArray(students) ? students : [students]).forEach(function (st) {
        var cells = [];
        ids.forEach(function (id) {
          // A placed block measures with its own options; each width with
          // the layout it prints at that width.
          var placed = formUsed && cellOf(formUsed, id);
          var base = placed ? _cleanCell(placed) : _newCell(id);
          var row = Object.assign({}, base, { size: 'row' });
          cells.push({ cell: row, size: 'row', html: _cellHtml(row, cid, st, ctx) });
          if (canHalf(id)) {
            var half = Object.assign({}, base, { size: 'half' });
            cells.push({ cell: half, size: 'half', html: _cellHtml(half, cid, st, ctx) });
          }
        });
        _measureCells(stage, cells);
        cells.forEach(function (c) {
          var e = out[c.cell.block];
          e[c.size] = Math.max(e[c.size] || 0, c.px);
        });
      });
    } finally {
      stage.remove();
    }
    return out;
  }

  /* What the comment box tells the teacher while they write. Never a cap:
     the form never shrinks a student's words; a comment past its box moves
     the rows under it down, and onto a second sheet when the side is full. */
  function fitText(r) {
    if (!r || !r.room) return '';
    if (r.noComment) return 'No comment yet. The box holds ' + r.room + ' lines.';
    var n = r.commentLines;
    var word = n === 1 ? ' line' : ' lines';
    if (n <= r.room) return 'Fits. ' + n + word + '; room for ' + (r.room - n) + ' more.';
    var past = n + word + ', ' + (n - r.room) + ' past the box; ';
    if (r.sheets > 1) return past + 'this report runs to ' + r.sheets + ' sheets. Nothing is cut.';
    return past + 'what is under it moves down. Nothing is cut.';
  }

  /* One student's sides on a form, as small pictures for the Templates
     tab: { html, sheets }. The sides are the real sheets, scaled by CSS. */
  function thumbs(cid, student, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(document.body, ROW_W, formUsed.type);
    try {
      var probe = _probe(stage);
      var r = layoutStudent(cid, student, ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
      var tpl = document.createElement('div');
      tpl.innerHTML = r.html;
      var sides = Array.prototype.map.call(tpl.querySelectorAll('.sheet-zoom'), function (z) {
        var sheet = z.querySelector('.report-sheet');
        return sheet ? '<div class="studio-tpl-side">' + sheet.outerHTML + '</div>' : '';
      });
      return { html: sides.join(''), sheets: r.sheets };
    } finally {
      stage.remove();
    }
  }

  return {
    PAPER: PAPER,
    GAP: GAP,
    ROW_W: ROW_W,
    HALF_W: HALF_W,
    LINE_PX: LINE_PX,
    form: form,
    BLOCKS: BLOCKS,
    PALETTE_GROUPS: PALETTE_GROUPS,
    canHalf: canHalf,
    pairsWell: pairsWell,
    normalizeForm: normalizeForm,
    optionsFor: optionsFor,
    formFor: formFor,
    onForm: onForm,
    available: available,
    locate: locate,
    cellOf: cellOf,
    partnerOf: partnerOf,
    insert: insert,
    beside: beside,
    moveRow: moveRow,
    moveToSide: moveToSide,
    setSize: setSize,
    setLines: setLines,
    removeCell: removeCell,
    setOption: setOption,
    setNoEvidence: setNoEvidence,
    setPinned: setPinned,
    setType: setType,
    addSide: addSide,
    removeSide: removeSide,
    setSides: setSides,
    hideFor: hideFor,
    hiddenFor: hiddenFor,
    starters: starters,
    starter: starter,
    templates: templates,
    syncTemplates: syncTemplates,
    saveTemplate: saveTemplate,
    removeTemplate: removeTemplate,
    template: template,
    pack: pack,
    sideHeight: sideHeight,
    sideLabel: sideLabel,
    cellWidth: cellWidth,
    describeStudent: describeStudent,
    classSummary: classSummary,
    blockSizes: blockSizes,
    fitText: fitText,
    thumbs: thumbs,
    paperSize: paperSize,
    layoutStudent: layoutStudent,
    renderPreview: renderPreview,
    clearPageStyle: clearPageStyle,
    setPageStyle: _setPageStyle,
  };
})();
