/* report-sheets.js — The report form on a page grid.
   A page is a grid of 12 columns and 20px rows, and every block on the
   form owns a rectangle on it. A block whose content needs more room than
   its rectangle grows, and the blocks under it in its columns move down,
   onto the next page when they pass its last row. Nothing is shrunk,
   clipped or hidden per student. The same HTML is on screen and on paper.
   docs/DECISIONS.md "Report forms"; docs/report-forms-plan.md. */
window.ReportSheets = (function () {
  'use strict';

  var PX_PER_IN = 96;
  var MARGIN_IN = 0.5;
  var PAPER = {
    letter: { w: 8.5, h: 11, size: '8.5in 11in' },
    legal: { w: 8.5, h: 14, size: '8.5in 14in' },
  };
  var PAGE_STYLE_ID = 'report-sheets-page';

  /* ── The layout model (v5) ────────────────────────────────────
     pages[i].blocks: { block, x, y, w, h, options?, noEvidence? }. x and w
     are columns of 12 (w at least 3), y and h rows of ROW_PX. h is the
     room the teacher reserved, never a cap. The letterhead is always
     { block: 'header', x: 0, y: 0, w: 12 } first on page 1; its height is
     measured. One block may be pinned: docked to the bottom of its page
     (the Parent / Guardian Response). perStudent holds blocks left off one
     student's report. The Parent / Guardian Response and the student
     reflection are placed, never reworded (DECISIONS "Report forms" 5). */
  var COLS = 12;
  var GUTTER = 12;
  var ROW_PX = 20;
  var MIN_W = 3;
  var MIN_H = 2;
  var MAX_H = 120;
  /* One comment line and the box around it, for a v4 form's lines. */
  var LINE_PX = 22;
  var BOX_PX = 40;

  function _b(block, x, y, w, h) {
    return { block: block, x: x, y: y, w: w, h: h };
  }
  var FORM_REPORT_CARD = {
    v: 5,
    id: 'report-card',
    name: 'Report Card',
    type: 'standard',
    pagesPerStudent: 'auto',
    pages: [
      {
        blocks: [
          { block: 'header', x: 0, y: 0, w: 12 },
          _b('academic-summary', 0, 5, 12, 6),
          _b('teacher-narrative', 0, 11, 12, 8),
          _b('competency-table', 0, 19, 12, 13),
          _b('next-steps', 0, 32, 12, 8),
        ],
      },
      {
        // The legend reads the dots for families; the response's comments
        // box takes the rest of the back as room to write.
        blocks: [
          _b('learner-dimensions', 0, 0, 12, 15),
          _b('legend', 0, 15, 12, 6),
          _b('parent-response', 0, 21, 12, 25),
        ],
      },
    ],
    pinned: 'parent-response',
    perStudent: {},
  };
  var FORM_INTERIM = {
    v: 5,
    id: 'interim-update',
    name: 'Interim Update',
    type: 'standard',
    pagesPerStudent: 'auto',
    pages: [
      {
        blocks: [
          { block: 'header', x: 0, y: 0, w: 12 },
          _b('academic-summary', 0, 5, 12, 6),
          _b('teacher-narrative', 0, 11, 12, 8),
          _b('next-steps', 0, 19, 12, 8),
          _b('legend', 0, 27, 12, 6),
        ],
      },
    ],
    pinned: null,
    perStudent: {},
  };
  var FORM_CONFERENCE = {
    v: 5,
    id: 'conference-pack',
    name: 'Conference Pack',
    type: 'standard',
    pagesPerStudent: 'auto',
    pages: [
      {
        blocks: [
          { block: 'header', x: 0, y: 0, w: 12 },
          _b('academic-summary', 0, 5, 12, 6),
          _b('teacher-narrative', 0, 11, 12, 8),
          _b('competency-table', 0, 19, 12, 13),
          _b('next-steps', 0, 32, 12, 8),
        ],
      },
      {
        blocks: [
          _b('learner-dimensions', 0, 0, 12, 15),
          _b('grade-table', 0, 15, 12, 16),
          _b('parent-response', 0, 31, 12, 15),
        ],
      },
    ],
    pinned: 'parent-response',
    perStudent: {},
  };

  /* The Report Card, made whole. */
  function form() {
    return normalizeForm(FORM_REPORT_CARD);
  }

  /* Every block a form can hold. Labels, the palette group, the default
     room (rows: about a typical student's height at full width) and the
     options a block offers live here, not in the saved form. `fill`
     blocks rule lines into room the content leaves, and stretch to the
     foot of their page when nothing sits under them; `table` blocks are cut
     at their rows when they reach the bottom of a page. A `retired` block
     is left out of the palette; a saved layout that has one keeps it. An
     option's `choices` are numbers or { v, label }; a `text` option is a
     line the teacher writes. */
  var BLOCKS = {
    header: {
      label: 'Letterhead',
      rows: 5,
      locked: true,
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
    'academic-summary': { label: 'Overall and Competencies', rows: 6, group: 'Grades' },
    'competency-table': {
      label: 'Competency Table',
      rows: 13,
      table: true,
      group: 'Grades',
      noEvidence: true,
      options: [
        { key: 'evidence', label: 'Evidence Count', def: true },
        { key: 'ican', label: 'I-can Statements', def: false },
        { key: 'assignments', label: 'Assignment Names', def: false },
      ],
    },
    'grade-table': {
      label: 'Assignment Grades',
      rows: 20,
      table: true,
      group: 'Grades',
      options: [
        { key: 'date', label: 'Date', def: true },
        { key: 'category', label: 'Category', def: true },
        { key: 'area', label: 'Learning Area', def: true },
        { key: 'score', label: 'Score', def: true },
        { key: 'level', label: 'Proficiency', def: true },
        {
          key: 'range',
          label: 'Assessments',
          def: 'term',
          choices: [
            { v: 'last10', label: 'Last 10' },
            { v: 'term', label: 'This Term' },
            { v: 'all', label: 'All' },
          ],
        },
      ],
    },
    'term-glance': { label: 'This Term at a Glance', rows: 5, group: 'Grades' },
    growth: { label: 'Growth Since Last Report', rows: 10, table: true, group: 'Grades' },
    'missing-work': { label: 'Missing Work', rows: 6, table: true, group: 'Grades' },
    // Totals to date from the Term Questionnaire (classes absent, times late).
    // Not 'attendance': an older block by that name was retired, and forms
    // saved with it drop it.
    'term-attendance': {
      label: 'Attendance',
      rows: 5,
      table: true,
      group: 'Grades',
      options: [{ key: 'thisTerm', label: 'This Term Column', def: true }],
    },
    'section-outcomes': { label: 'Learning Outcomes', rows: 20, group: 'Grades', retired: true },
    'score-distribution': { label: 'Score Distribution', rows: 14, group: 'Grades', retired: true },
    'section-chart': { label: 'Section Chart', rows: 20, group: 'Grades', retired: true },
    'teacher-narrative': { label: 'Teacher Comment', rows: 8, fill: true, group: 'Comments and Evidence' },
    observations: { label: 'Observations', rows: 16, group: 'Comments and Evidence' },
    'next-steps': {
      label: 'Growth and Next Steps',
      rows: 8,
      group: 'Comments and Evidence',
      options: [{ key: 'ican', label: 'I-can Statements', def: 2, choices: [0, 1, 2, 3] }],
    },
    'learner-dimensions': {
      label: 'Learning Dispositions',
      rows: 15,
      group: 'Learner Profile',
      options: [
        { key: 'descriptions', label: 'Descriptions', def: false },
        { key: 'examples', label: 'Examples', def: false },
      ],
    },
    'core-competencies': {
      label: 'Core Competencies',
      rows: 16,
      group: 'Learner Profile',
      noEvidence: true,
      options: [{ key: 'intro', label: 'Introduction', def: true }],
    },
    'student-reflection-learning': { label: 'Reflection: My Learning', rows: 40, group: 'Learner Profile' },
    'student-reflection-habits': { label: 'Reflection: My Habits', rows: 32, group: 'Learner Profile' },
    'parent-response': {
      label: 'Parent / Guardian Response',
      rows: 15,
      fill: true,
      group: 'Family',
      pinnable: true,
    },
    legend: { label: 'Proficiency Legend', rows: 6, group: 'Family' },
    'support-home': {
      label: 'Ways to Support at Home',
      rows: 6,
      group: 'Family',
      options: [
        { key: 'lines', label: 'Lines', def: 2, choices: [1, 2, 3] },
        { key: 'note', label: 'Your Own Line', def: '', text: true },
      ],
    },
    'text-block': { label: 'Text Block', rows: 4, fill: true, group: 'Family' },
  };
  var BLOCK_ORDER = Object.keys(BLOCKS);
  var PALETTE_GROUPS = ['Grades', 'Comments and Evidence', 'Learner Profile', 'Family'];

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
  /* The rows a block takes on the stored layout (the letterhead's are
     measured; its registry default stands in). */
  function _hOf(b) {
    return b.h != null ? b.h : BLOCKS[b.block].rows;
  }
  /* Letterhead first, then by row, then by column. */
  function _byPlace(a, b) {
    if (a.block === 'header' || b.block === 'header') return a.block === 'header' ? -1 : 1;
    return a.y - b.y || a.x - b.x;
  }
  function _colsMeet(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w;
  }
  function _overlaps(a, b) {
    return _colsMeet(a, b) && a.y < b.y + _hOf(b) && b.y < a.y + _hOf(a);
  }

  function _cleanBlock(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var def = BLOCKS[raw.block];
    if (!def) return null;
    var w = _clamp(_int(raw.w, COLS), MIN_W, COLS);
    var b = {
      block: raw.block,
      x: _clamp(_int(raw.x, 0), 0, COLS - w),
      y: Math.max(0, _int(raw.y, 0)),
      w: w,
      h: _clamp(_int(raw.h, def.rows), MIN_H, MAX_H),
    };
    if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
      b.options = JSON.parse(JSON.stringify(raw.options));
    }
    if (def.noEvidence && (raw.noEvidence === 'hide' || raw.noEvidence === 'show')) b.noEvidence = raw.noEvidence;
    return b;
  }

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
  /* A v4 cell's room in rows: its lines for the comment, response and text
     blocks (the comment held 8 unless set to Fit Content), else the
     block's default. */
  function _v4Rows(c) {
    var def = BLOCKS[c.block];
    var lines = Number(c.lines);
    if (def.fill && c.height === 'fixed' && lines >= 1) return Math.ceil((lines * LINE_PX + BOX_PX) / ROW_PX);
    if (c.block === 'teacher-narrative' && c.height !== 'fit') return Math.ceil((8 * LINE_PX + BOX_PX) / ROW_PX);
    return def.rows;
  }
  /* v4 (pages of rows of cells with spans) to v5: each row's cells side by
     side at the row's running y, x and w from the spans, the row as tall as
     its tallest cell. settle() then stores where the blocks really land. */
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
      pagesPerStudent: base.pagesPerStudent,
      pages: pages,
      pinned: base.pinned,
      perStudent: base.perStudent,
    };
  }

  /* A saved form (any version, any hand) made whole: known blocks only, no
     block twice, rectangles on the grid, the letterhead first on page 1,
     at most one pinned block and it on the form, at least one page. Empty
     pages stay: the teacher gave them. v4 (rows of cells with spans), v3
     (front/back lists with pairs) and the old presets ({preset, blocks})
     migrate here; nothing saved is lost. Absent → the Report Card. */
  function normalizeForm(raw) {
    var base = raw && typeof raw === 'object' ? raw : null;
    if (base && !Array.isArray(base.pages) && (Array.isArray(base.front) || Array.isArray(base.back))) {
      base = _v3ToPages(base);
    }
    if (!base || !Array.isArray(base.pages)) base = FORM_REPORT_CARD;
    if (
      base.pages.some(function (pg) {
        return pg && Array.isArray(pg.rows);
      })
    ) {
      base = _v4ToV5(base);
    }
    var seen = {};
    var head = null;
    var pages = base.pages.map(function (pg) {
      var blocks = ((pg && pg.blocks) || []).map(_cleanBlock).filter(function (b) {
        if (!b || seen[b.block]) return false;
        seen[b.block] = true;
        if (b.block === 'header') {
          head = b;
          return false;
        }
        return true;
      });
      return { blocks: blocks };
    });
    if (!pages.length) pages = [{ blocks: [] }];
    var header = { block: 'header', x: 0, y: 0, w: COLS };
    if (head && head.options) header.options = head.options;
    seen.header = true;
    pages[0].blocks.unshift(header);
    pages.forEach(function (pg) {
      pg.blocks.sort(_byPlace);
    });
    var pinned =
      base.pinned && BLOCKS[base.pinned] && BLOCKS[base.pinned].pinnable && seen[base.pinned] ? base.pinned : null;
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
    var pps = base.pagesPerStudent;
    return {
      v: 5,
      id: base.id || 'report-card',
      name: base.name || 'Report Card',
      type: base.type === 'compact' ? 'compact' : 'standard',
      pagesPerStudent: pps === 1 || pps === 2 ? pps : 'auto',
      pages: pages,
      pinned: pinned,
      perStudent: per,
    };
  }

  /* The class's form from its report config. A class still on the old
     Brief preset opens on the Interim Update; anything else without a
     saved form is the Report Card. */
  function formFor(reportConfig) {
    if (reportConfig && reportConfig.form) return normalizeForm(reportConfig.form);
    if (reportConfig && reportConfig.preset === 'brief') return normalizeForm(FORM_INTERIM);
    return normalizeForm(FORM_REPORT_CARD);
  }

  /* ── Editing (pure: each returns a new, normalized form) ─────────── */
  /* Ids on the form, in order. */
  function onForm(f) {
    var ids = [];
    f.pages.forEach(function (pg) {
      pg.blocks.forEach(function (b) {
        ids.push(b.block);
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
  /* Where a block is: { page, index }, or null. */
  function locate(f, id) {
    for (var p = 0; p < f.pages.length; p++) {
      var blocks = f.pages[p].blocks;
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].block === id) return { page: p, index: i };
      }
    }
    return null;
  }
  function cellOf(f, id) {
    var at = locate(f, id);
    return at ? f.pages[at.page].blocks[at.index] : null;
  }

  /* One page's blocks moved down until none overlaps another. The blocks
     named in `first` keep their places, in that order (the letterhead,
     then the block just placed); the rest follow in (row, column) order,
     each below every block before it in its columns, and below a first
     block that started above it or that it would cover. */
  function _shove(blocks, first) {
    var fixed = (first || [])
      .map(function (id) {
        return blocks.find(function (b) {
          return b.block === id;
        });
      })
      .filter(Boolean);
    var rest = blocks
      .filter(function (b) {
        return fixed.indexOf(b) < 0;
      })
      .sort(_byPlace);
    var placed = [];
    fixed.concat(rest).forEach(function (b) {
      var y = b.y;
      placed.forEach(function (p) {
        if (fixed.indexOf(p) < 0 && _colsMeet(p, b)) y = Math.max(y, p.y + _hOf(p));
      });
      var moved = true;
      while (moved) {
        moved = false;
        placed.forEach(function (p) {
          if (fixed.indexOf(p) < 0 || !_colsMeet(p, b) || y >= p.y + _hOf(p)) return;
          if (p.y <= b.y || y + _hOf(b) > p.y) {
            y = p.y + _hOf(p);
            moved = true;
          }
        });
      }
      b.y = y;
      placed.push(b);
    });
    return blocks;
  }

  function _without(f, id) {
    f.pages.forEach(function (pg) {
      pg.blocks = pg.blocks.filter(function (b) {
        return b.block !== id;
      });
    });
    return f;
  }

  /* Puts a block (new or moved) at a rectangle { page, x, y, w, h },
     clamped to the grid; w defaults to 12 and h to the block's default.
     What it covers on the page moves down out of its way. Without a page,
     the last one. A moved block keeps its options and its pin. */
  function place(f, id, rect) {
    if (!BLOCKS[id] || id === 'header') return f;
    rect = rect || {};
    var old = cellOf(f, id);
    f = _without(_clone(f), id);
    var page = _clamp(_int(rect.page, f.pages.length - 1), 0, f.pages.length - 1);
    var b = _cleanBlock({
      block: id,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      options: old && old.options,
      noEvidence: old && old.noEvidence,
    });
    f.pages[page].blocks.push(b);
    _shove(f.pages[page].blocks, ['header', id]);
    return normalizeForm(f);
  }
  function move(f, id, to) {
    var at = locate(f, id);
    if (!at || id === 'header') return f;
    var b = f.pages[at.page].blocks[at.index];
    to = to || {};
    return place(f, id, {
      page: to.page != null ? to.page : at.page,
      x: to.x != null ? to.x : b.x,
      y: to.y != null ? to.y : b.y,
      w: b.w,
      h: b.h,
    });
  }
  /* A new width and height; the block keeps its row and stays on the grid. */
  function resize(f, id, size) {
    if (id === 'header') return f;
    f = _clone(f);
    var at = locate(f, id);
    if (!at) return f;
    var b = f.pages[at.page].blocks[at.index];
    size = size || {};
    b.w = _clamp(_int(size.w, b.w), MIN_W, COLS);
    b.x = Math.min(b.x, COLS - b.w);
    b.h = _clamp(_int(size.h, b.h), MIN_H, MAX_H);
    _shove(f.pages[at.page].blocks, ['header', id]);
    return normalizeForm(f);
  }
  /* The stored layout made what the canvas shows: each block's row (and
     page) from where the resolver placed it for the previewed student.
     positions: layoutStudent's { blockId: { page, y } }. A block that
     landed on a continued page, past the form's own, keeps its place. So
     does a block pushed onto a later page while a block after it stays
     behind on an earlier one: moved, it would flow after that block. */
  function settle(f, positions) {
    if (!positions) return f;
    f = _clone(f);
    var n = f.pages.length;
    // Where each block ends up stored: its landing page, or where it is.
    var target = {};
    var flow = [];
    f.pages.forEach(function (pg, p) {
      pg.blocks.forEach(function (b) {
        var at = positions[b.block];
        if (!at || b.block === 'header') return;
        target[b.block] = at.page < n ? at.page : p;
        flow.push({ id: b.block, from: p, page: at.page, y: at.y, x: b.x });
      });
    });
    flow.sort(function (a, b) {
      return a.page - b.page || a.y - b.y || a.x - b.x;
    });
    var behind = Infinity; // the earliest stored page of any block later in the flow
    for (var i = flow.length - 1; i >= 0; i--) {
      var it = flow[i];
      if (target[it.id] > it.from && behind < target[it.id]) target[it.id] = it.from;
      behind = Math.min(behind, target[it.id]);
    }
    var moves = [];
    f.pages.forEach(function (pg, p) {
      pg.blocks = pg.blocks.filter(function (b) {
        var at = positions[b.block];
        if (!at || b.block === 'header' || target[b.block] !== at.page) return true;
        b.y = at.y;
        if (at.page === p) return true;
        moves.push({ page: at.page, block: b });
        return false;
      });
    });
    moves.forEach(function (m) {
      f.pages[m.page].blocks.push(m.block);
    });
    return normalizeForm(f);
  }
  function addPage(f) {
    f = _clone(f);
    f.pages.push({ blocks: [] });
    return normalizeForm(f);
  }
  /* Only an empty page past the second. */
  function removePage(f, i) {
    if (i < 2 || !f.pages[i] || f.pages[i].blocks.length) return f;
    f = _clone(f);
    f.pages.splice(i, 1);
    return normalizeForm(f);
  }
  /* The first row (and column) on a page where a w × h block fits with
     no overlap: { page, x, y }. */
  function firstFree(f, page, w, h) {
    var pg = f.pages[page];
    if (!pg) return null;
    w = _clamp(_int(w, COLS), MIN_W, COLS);
    h = _clamp(_int(h, MIN_H), MIN_H, MAX_H);
    for (var y = 0; ; y++) {
      for (var x = 0; x + w <= COLS; x++) {
        var r = { block: 'text-block', x: x, y: y, w: w, h: h };
        if (
          !pg.blocks.some(function (b) {
            return _overlaps(b, r);
          })
        ) {
          return { page: page, x: x, y: y };
        }
      }
    }
  }
  function removeCell(f, id) {
    if (id === 'header' || !locate(f, id)) return f;
    f = _without(_clone(f), id);
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
  function setPagesPerStudent(f, n) {
    f = _clone(f);
    f.pagesPerStudent = n === 1 || n === 2 ? n : 'auto';
    return f;
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

  /* ── The grid resolver (pure) ──────────────────────────────────
     pages: the form's pages, each a list of items { id, x, w, y, h, need,
     empty?, rows?, chrome? }: need is the rows the student's content takes
     at the block's width (0 when the block prints nothing), rows and chrome
     a table's row heights and the rest of it in px. opts: { rows (a page's
     rows), pinned (id), cap (1 | 2 | null) }.
     Each page is resolved top to bottom in (row, column) order: a block
     takes the larger of its room and its content, and sits below every
     block placed before it in its columns (the shove, which chains). A
     block that passes the page's last row moves to the top of the next
     page in the same columns, pushing that page's blocks down; a table
     that has a row that fits is cut there and continues; whatever came
     after it in its columns follows it. The pinned block is docked to the
     bottom of its page, and the row above it is the page's limit. Pages
     past the form's own are continued pages; a cap drops the pages past it
     and names what was on them. Returns { pages: [{ items, capped? }],
     pushed: [id], cut: [id], over, positions: { id: { page, y } } }. */
  var MAX_PAGES = 30;
  function resolve(pages, opts) {
    var rows = opts.rows;
    var out = [];
    var carry = [];
    var positions = {};
    var drawn = {};
    var pushed = [];
    var over = false;
    pages.forEach(function (pg, p) {
      pg.forEach(function (it) {
        drawn[it.id] = p;
      });
    });
    var sum = function (list) {
      return list.reduce(function (a, b) {
        return a + b;
      }, 0);
    };
    for (var p = 0; (p < pages.length || carry.length) && p < MAX_PAGES; p++) {
      var page = { items: [] };
      var put = function (it, y, h, part) {
        var placed = { id: it.id, x: it.x, w: it.w, y: y, h: h };
        if (part) placed.part = part;
        if (it.pinned) placed.pinned = true;
        if (it.off) placed.off = true;
        page.items.push(placed);
        if (!positions[it.id]) positions[it.id] = { page: p, y: y };
        if (drawn[it.id] !== p && pushed.indexOf(it.id) < 0) pushed.push(it.id);
      };
      var own = (pages[p] || []).slice().sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      });
      var limit = rows;
      var pin = own.find(function (it) {
        return it.id === opts.pinned;
      });
      if (pin) {
        own = own.filter(function (it) {
          return it !== pin;
        });
        var ph = Math.max(pin.h, pin.need);
        if (ph > rows) over = true;
        limit = Math.max(0, rows - ph);
        put(Object.assign({}, pin, { pinned: true }), limit, Math.min(ph, rows));
      }
      var placed = [];
      var next = [];
      var queue = carry
        .map(function (it) {
          return Object.assign({}, it, { y: 0, h: 0 });
        })
        .concat(own);
      queue.forEach(function (it) {
        var y = it.y;
        placed.forEach(function (pl) {
          if (_colsMeet(pl, it)) y = Math.max(y, pl.bottom);
        });
        var need = Math.max(it.h, it.need);
        var start = it.start || 0;
        var part = start > 0 ? { start: start, end: start + it.rows.length } : null;
        if (y + need <= limit) {
          put(it, y, need, part);
          placed.push({ x: it.x, w: it.w, bottom: y + need });
          return;
        }
        // A block that prints nothing for the student takes no room.
        if (it.empty) return;
        // The room runs past the page but the content fits: the room ends there.
        if (y < limit && y + it.need <= limit) {
          put(it, y, limit - y, part);
          placed.push({ x: it.x, w: it.w, bottom: limit });
          return;
        }
        if (it.rows && it.rows.length > 1 && y < limit) {
          // A pixel of slack: the part's rendered height rounds up.
          var room = (limit - y) * ROW_PX - it.chrome - 1;
          var take = 0;
          var used = 0;
          while (take < it.rows.length && used + it.rows[take] <= room) {
            used += it.rows[take];
            take++;
          }
          if (take === 0 && y === 0) {
            take = 1; // a row taller than a page goes alone and over, never dropped
            over = true;
          }
          if (take > 0) {
            put(it, y, limit - y, { start: start, end: start + take });
            placed.push({ x: it.x, w: it.w, bottom: Infinity });
            var rest = it.rows.slice(take);
            next.push({
              id: it.id,
              x: it.x,
              w: it.w,
              y: 0,
              h: 0,
              rows: rest,
              chrome: it.chrome,
              start: start + take,
              need: Math.ceil((it.chrome + sum(rest)) / ROW_PX),
            });
            return;
          }
        }
        // Taller than a whole page: it stays at the top, flagged.
        if (y === 0 && need > rows) {
          put(it, 0, need, part);
          placed.push({ x: it.x, w: it.w, bottom: need });
          over = true;
          return;
        }
        next.push(it);
        placed.push({ x: it.x, w: it.w, bottom: Infinity });
      });
      // A fill block with nothing under it in its columns takes the rest of
      // the page down to the limit: ruled lines, not blank paper.
      page.items.forEach(function (pi) {
        if ((opts.fill || []).indexOf(pi.id) < 0 || pi.pinned || pi.part) return;
        var under = page.items.some(function (o) {
          return o !== pi && !o.pinned && _colsMeet(o, pi) && o.y >= pi.y + pi.h;
        });
        if (!under && pi.y + pi.h < limit) pi.h = limit - pi.y;
      });
      out.push(page);
      carry = next;
    }
    var cut = [];
    if (opts.cap && out.length > opts.cap) {
      out.slice(opts.cap).forEach(function (pg) {
        pg.items
          .slice()
          .sort(function (a, b) {
            return a.y - b.y || a.x - b.x;
          })
          .forEach(function (it) {
            if (cut.indexOf(it.id) < 0) cut.push(it.id);
          });
      });
      out = out.slice(0, opts.cap);
      out[out.length - 1].capped = cut;
    }
    return { pages: out, pushed: pushed, cut: cut, over: over, positions: positions };
  }

  /* A comment box with ruled lines for a student with no comment yet. */
  function _emptyCommentBox() {
    return (
      '<div class="report-block-box report-comment-box"><div class="report-block-title">Teacher Comment</div>' +
      '<div class="report-ruled report-ruled-fill report-ruled-empty"></div></div>'
    );
  }
  /* Ruled lines into the room a short comment or text leaves. */
  function _withRuled(html) {
    return html.replace(/<\/div>\s*$/, '<div class="report-ruled report-ruled-fill"></div></div>');
  }

  /* A cell's options with the registry's defaults filled in, plus its
     no-evidence rule, as the renderer reads them. */
  function optionsFor(cell) {
    var def = BLOCKS[cell.block] || {};
    var out = {};
    (def.options || []).forEach(function (o) {
      out[o.key] = o.def;
    });
    Object.keys(cell.options || {}).forEach(function (k) {
      out[k] = cell.options[k];
    });
    if (def.noEvidence) out.noEvidence = cell.noEvidence === 'hide' ? 'hide' : 'show';
    return out;
  }

  function _cellHtml(cell, cid, student, ctx) {
    var html = ReportBlocks.renderReportBlock(cell.block, cid, student, ctx, optionsFor(cell));
    if (cell.block === 'teacher-narrative' && !html) return _emptyCommentBox();
    if (html && (cell.block === 'teacher-narrative' || cell.block === 'text-block')) html = _withRuled(html);
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

  /* One comment line and the box around it, and the footer, in px, from
     the real CSS. */
  function _probe(stage) {
    var one = ReportBlocks.renderCommentBox('A');
    var two = ReportBlocks.renderCommentBox('A<br>A');
    var footer = _footerHtml('Course', 'Report', 'Teacher', 'Student', 1, 1);
    var h = _measureAll(stage, [one, two, footer]);
    var linePx = Math.max(12, h[1] - h[0]);
    return { linePx: linePx, boxChromePx: Math.max(0, h[0] - linePx), footerPx: h[2] };
  }

  /* A block's width in px at w columns on a page `contentW` wide, and its
     left edge at column x. The Studio reads the same numbers to snap a
     drag to the grid. */
  function _colPx(w, contentW) {
    return (w * (contentW + GUTTER)) / COLS - GUTTER;
  }
  function _leftPx(x, contentW) {
    return (x * (contentW + GUTTER)) / COLS;
  }
  /* The rows on one page: the sheet inside its margins, less the footer. */
  function pageRows(paper, probe) {
    var p = PAPER[paper] || PAPER.letter;
    return Math.floor(((p.h - 2 * MARGIN_IN) * PX_PER_IN - probe.footerPx) / ROW_PX);
  }

  /* Each block rendered for the student and measured at its own width, as
     it will sit on the page: { px, rows?, chrome? } on each entry. */
  function _measureCells(stage, cells, contentW) {
    stage.innerHTML = cells
      .map(function (c) {
        return (
          '<div class="sheet-cell" data-block="' +
          c.b.block +
          '" style="width:' +
          _colPx(c.b.w, contentW) +
          'px">' +
          c.html +
          '</div>'
        );
      })
      .join('');
    Array.prototype.forEach.call(stage.children, function (el, i) {
      var c = cells[i];
      c.px = c.html ? el.offsetHeight : 0;
      if (!c.html || !BLOCKS[c.b.block].table) return;
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
  function _footerHtml(course, report, teacher, student, n, total) {
    var left = [course, report, teacher].filter(Boolean).map(esc).join(' · ');
    var right = esc(student) + ' · Page ' + n + ' of ' + total;
    return '<div class="sheet-footer"><span>' + left + '</span><span>' + right + '</span></div>';
  }

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

  /* A placed block, absolutely on the page at its rectangle. A block left
     off this student's report keeps its place as an empty cell (nothing
     prints), so the Studio can still select it; a block pushed off the
     page it was drawn on is marked for the Everyone view. */
  function _placedHtml(it, html, contentW, pushed) {
    if (it.part) html = _partHtml(html, it.part.start, it.part.end, it.part.start > 0);
    var def = BLOCKS[it.id] || {};
    return (
      '<div class="sheet-cell' +
      (def.fill ? ' sheet-fill' : '') +
      (it.pinned ? ' sheet-pinned' : '') +
      (html ? '' : ' sheet-empty') +
      (it.off ? ' sheet-off' : '') +
      (pushed && pushed.indexOf(it.id) >= 0 ? ' sheet-pushed' : '') +
      '" data-block="' +
      it.id +
      '" data-x="' +
      it.x +
      '" data-y="' +
      it.y +
      '" data-w="' +
      it.w +
      '" data-h="' +
      it.h +
      '" style="left:' +
      _leftPx(it.x, contentW) +
      'px;top:' +
      it.y * ROW_PX +
      'px;width:' +
      _colPx(it.w, contentW) +
      'px;min-height:' +
      it.h * ROW_PX +
      'px">' +
      html +
      '</div>'
    );
  }

  function _pageHtml(page, cellHtml, footer, paper, opts) {
    var body = page
      ? page.items
          .map(function (it) {
            return _placedHtml(it, cellHtml[it.id] || '', opts.contentW, opts.pushed);
          })
          .join('')
      : '<div class="sheet-blank">This side is left blank.</div>';
    return (
      '<div class="report-sheet' +
      (page && page.over ? ' sheet-overflow' : '') +
      (page ? '' : ' sheet-blank-side') +
      (opts.type === 'compact' ? ' compact' : '') +
      '" data-paper="' +
      paper +
      '">' +
      '<div class="sheet-body">' +
      body +
      '</div>' +
      (page && page.capped && page.capped.length
        ? '<div class="sheet-capped no-print">Doesn’t fit · ' + esc(page.capped.join(', ')) + '</div>'
        : '') +
      footer +
      '</div>'
    );
  }

  /* Lays one student onto the form's pages. Returns { html, sheets, sides,
     pushed: [blockId], cut: [label], over, positions, used, commentLines,
     room, noComment, badge }. */
  function layoutStudent(cid, student, ctx, opts) {
    var f = opts.form || normalizeForm(FORM_REPORT_CARD);
    var probe = opts.probe;
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var rows = pageRows(paper, probe);
    var hidden = hiddenFor(f, student.id);
    var cells = [];
    f.pages.forEach(function (pg, p) {
      pg.blocks.forEach(function (b) {
        var off = hidden.indexOf(b.block) >= 0;
        cells.push({ page: p, b: b, off: off, html: off ? '' : _cellHtml(b, cid, student, ctx) });
      });
    });
    _measureCells(opts.stage, cells, contentW);
    var cellHtml = {};
    var used = 0;
    var comment = null;
    var pages = f.pages.map(function () {
      return [];
    });
    cells.forEach(function (c) {
      cellHtml[c.b.block] = c.html;
      used += c.px;
      if (c.b.block === 'teacher-narrative') comment = c;
      pages[c.page].push({
        id: c.b.block,
        x: c.b.x,
        w: c.b.w,
        y: c.b.y,
        h: c.b.h != null ? c.b.h : 0,
        need: Math.ceil(c.px / ROW_PX),
        empty: !c.html,
        off: c.off,
        rows: c.rows,
        chrome: c.chrome,
      });
    });
    var pps = f.pagesPerStudent === 1 || f.pagesPerStudent === 2 ? f.pagesPerStudent : null;
    var fill = BLOCK_ORDER.filter(function (id) {
      return BLOCKS[id].fill;
    });
    var r = resolve(pages, { rows: rows, pinned: f.pinned, cap: pps, fill: fill });
    var labelOf = function (id) {
      return BLOCKS[id] ? BLOCKS[id].label : id;
    };
    r.pages.forEach(function (pg) {
      if (pg.capped) pg.capped = pg.capped.map(labelOf);
      pg.over = pg.items.some(function (it) {
        return it.y + it.h > rows;
      });
    });
    // The comment's lines and its box's room, for the questionnaire.
    var noComment = !!comment && comment.html === _emptyCommentBox();
    var room = comment ? Math.max(0, Math.floor((comment.b.h * ROW_PX - probe.boxChromePx) / probe.linePx)) : 0;
    var commentLines =
      comment && !noComment ? Math.max(1, Math.round((comment.px - probe.boxChromePx) / probe.linePx)) : 0;

    var sides = r.pages.length;
    var sheetCount = Math.ceil(sides / 2);
    var badge = noComment && sheetCount === 1 ? 'No comment' : sheetCount === 1 ? '1 sheet' : sheetCount + ' sheets';
    var course = COURSES[cid] || {};
    var teacher = (typeof getConfig === 'function' && getConfig().displayName) || '';
    var name = fullName(student);
    var total = sheetCount * 2;
    var html =
      '<div class="sheet-student" data-action="fitMapPick" data-sid="' +
      esc(student.id) +
      '" data-sheets="' +
      sheetCount +
      '" data-pushed="' +
      r.pushed.length +
      '" data-cut="' +
      r.cut.length +
      '">' +
      '<div class="sheet-student-head no-print"><span class="sheet-student-name">' +
      esc(name) +
      '</span><span class="sheet-badge ' +
      (sheetCount > 1 ? 'over' : noComment ? 'none' : 'ok') +
      '">' +
      badge +
      '</span></div>';
    for (var s = 0; s < total; s++) {
      html +=
        '<div class="sheet-zoom"' +
        (s < f.pages.length ? ' data-page="' + s + '"' : '') +
        '><div class="sheet-label no-print">Page ' +
        (s + 1) +
        ' of ' +
        total +
        '</div>' +
        _pageHtml(
          r.pages[s] || null,
          cellHtml,
          _footerHtml(course.name, ctx.termLabel, teacher, name, s + 1, total),
          paper,
          { type: f.type, contentW: contentW, pushed: r.pushed },
        ) +
        '</div>';
    }
    html += '</div>';
    return {
      html: html,
      sheets: sheetCount,
      sides: sides,
      pushed: r.pushed,
      cut: r.cut.map(labelOf),
      over: r.over,
      positions: r.positions,
      used: used,
      commentLines: commentLines,
      room: room,
      noComment: noComment,
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
    // Sheets carry their own 0.5in padding, so the page itself has none.
    style.textContent = '@media print { @page { size: ' + paperSize(paper) + '; margin: 0; } }';
  }

  function clearPageStyle() {
    var style = document.getElementById(PAGE_STYLE_ID);
    if (style) style.remove();
  }

  function _summary(students) {
    return { students: students.length, sheets: 0, pages: 0, continued: [], over: [], noComment: [], perStudent: {} };
  }
  function _count(summary, st, r) {
    summary.sheets += r.sheets;
    summary.pages += r.sheets * 2;
    if (r.sheets > 1) summary.continued.push(fullName(st));
    if (r.over) summary.over.push(fullName(st));
    if (r.noComment) summary.noComment.push(fullName(st));
    summary.perStudent[st.id] = {
      sheets: r.sheets,
      sides: r.sides,
      over: r.over,
      pushed: r.pushed,
      cut: r.cut,
      badge: r.badge,
      noComment: r.noComment,
      name: fullName(st),
      used: r.used,
    };
    return summary.perStudent[st.id];
  }

  /* Renders every student's sheets into `preview`. Returns a summary
     { students, sheets, pages, continued: [names], over: [names],
     noComment: [names], perStudent }. */
  function renderPreview(opts) {
    var preview = opts.preview;
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(preview, contentW, formUsed.type);
    var probe = _probe(stage);
    var summary = _summary(opts.students);
    summary.rows = pageRows(paper, probe);
    var html = opts.students
      .map(function (st) {
        var r = layoutStudent(opts.cid, st, opts.ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
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
     comment box and for settle(). The stage lives on <body>; .report-sheet
     carries its own sizes, so the measurement matches the preview. */
  function describeStudent(cid, student, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(document.body, contentW, formUsed.type);
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
     one student is on screen. */
  function classSummary(cid, students, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(document.body, contentW, formUsed.type);
    var summary = _summary(students);
    try {
      var probe = _probe(stage);
      summary.rows = pageRows(paper, probe);
      students.forEach(function (st) {
        var r = layoutStudent(cid, st, ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
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

  /* Each block's height for one student at full width, for the palette's
     size badges: { blockId: px }. A block that prints nothing for the
     student is 0. */
  function blockSizes(cid, student, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var stage = _stage(document.body, contentW, opts.type === 'compact' ? 'compact' : 'standard');
    var out = {};
    try {
      var cells = BLOCK_ORDER.filter(function (id) {
        return id !== 'text-block';
      }).map(function (id) {
        var b = _cleanBlock({ block: id });
        var html = ReportBlocks.renderReportBlock(id, cid, student, ctx, optionsFor(b));
        return { b: b, html: html };
      });
      _measureCells(stage, cells, contentW);
      cells.forEach(function (c) {
        out[c.b.block] = c.px;
      });
    } finally {
      stage.remove();
    }
    return out;
  }

  /* What the comment box tells the teacher while they write. Never a cap:
     the form never shrinks a student's words. */
  function fitText(r) {
    if (!r || !r.room) return '';
    if (r.noComment) return 'No comment yet. The box holds ' + r.room + ' lines.';
    var n = r.commentLines;
    var word = n === 1 ? ' line' : ' lines';
    if (n <= r.room) return 'Fits. ' + n + word + '; room for ' + (r.room - n) + ' more.';
    return n + word + ', ' + (n - r.room) + ' past the box; what is under it moves down. Nothing is cut.';
  }

  return {
    PAPER: PAPER,
    COLS: COLS,
    ROW_PX: ROW_PX,
    form: form,
    BLOCKS: BLOCKS,
    PALETTE_GROUPS: PALETTE_GROUPS,
    normalizeForm: normalizeForm,
    optionsFor: optionsFor,
    formFor: formFor,
    onForm: onForm,
    available: available,
    locate: locate,
    cellOf: cellOf,
    place: place,
    move: move,
    resize: resize,
    settle: settle,
    addPage: addPage,
    removePage: removePage,
    firstFree: firstFree,
    removeCell: removeCell,
    setOption: setOption,
    setNoEvidence: setNoEvidence,
    setPinned: setPinned,
    setType: setType,
    setPagesPerStudent: setPagesPerStudent,
    hideFor: hideFor,
    hiddenFor: hiddenFor,
    starters: starters,
    starter: starter,
    templates: templates,
    syncTemplates: syncTemplates,
    saveTemplate: saveTemplate,
    removeTemplate: removeTemplate,
    template: template,
    resolve: resolve,
    pageRows: pageRows,
    GUTTER: GUTTER,
    MARGIN_PX: MARGIN_IN * PX_PER_IN,
    contentWidth: function (paper) {
      return ((PAPER[paper] || PAPER.letter).w - 2 * MARGIN_IN) * PX_PER_IN;
    },
    describeStudent: describeStudent,
    classSummary: classSummary,
    blockSizes: blockSizes,
    fitText: fitText,
    paperSize: paperSize,
    layoutStudent: layoutStudent,
    renderPreview: renderPreview,
    clearPageStyle: clearPageStyle,
    setPageStyle: _setPageStyle,
  };
})();
