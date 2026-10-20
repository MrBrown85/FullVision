/* report-sheets.js — The Report Card form.
   One layout for the class, laid into explicit sheets that are the same on
   screen and on paper. Fixed blocks print the same for every student; the
   flowing ones (teacher comment, next steps) have reserved room and push
   what follows down the sheet, onto the back, and onto a Continued sheet.
   Nothing is shrunk, clipped or hidden per student.
   docs/DECISIONS.md "Report forms"; docs/report-forms-plan.md Phase 1. */
window.ReportSheets = (function () {
  'use strict';

  var PX_PER_IN = 96;
  var MARGIN_IN = 0.5;
  var PAPER = {
    letter: { w: 8.5, h: 11, size: '8.5in 11in' },
    legal: { w: 8.5, h: 14, size: '8.5in 14in' },
  };
  /* Held back on every side: fonts differ by machine (the Mac's system font
     is narrower than Linux's or Windows'), and a side that measures full on
     one must not overflow on another. */
  var SAFETY = 0.04;
  var PAGE_STYLE_ID = 'report-sheets-page';

  /* ── The layout model (v4) ────────────────────────────────────
     A form is pages of rows of cells. A row holds one to three cells whose
     spans add up to 12 (12; 6+6; 8+4; 4+8; 4+4+4). pages[0] is the front,
     pages[1] the back, later pages continue. One block may be pinned to the
     bottom of the last side (the Parent / Guardian Response). perStudent
     holds exceptions that never change the class layout. The Parent /
     Guardian Response and the student reflection are placed, never
     reworded (DECISIONS "Report forms" 5). */
  var SPANS = [12, 8, 6, 4];
  function _row(cells) {
    return { cells: cells.map(_cellSpec) };
  }
  function _cellSpec(c) {
    return typeof c === 'string' ? { block: c } : c;
  }
  var FORM_REPORT_CARD = {
    v: 4,
    id: 'report-card',
    name: 'Report Card',
    type: 'standard',
    pagesPerStudent: 'auto',
    pinned: 'parent-response',
    pages: [
      {
        rows: [
          _row(['header']),
          _row(['academic-summary']),
          _row([{ block: 'teacher-narrative', height: 'fixed', lines: 8 }]),
          _row(['competency-table']),
          _row(['next-steps']),
        ],
      },
      { rows: [_row(['learner-dimensions']), _row(['parent-response'])] },
    ],
    perStudent: {},
  };
  var FORM_INTERIM = {
    v: 4,
    id: 'interim-update',
    name: 'Interim Update',
    type: 'standard',
    pagesPerStudent: 'auto',
    pinned: null,
    pages: [
      {
        rows: [
          _row(['header']),
          _row(['academic-summary']),
          _row([{ block: 'teacher-narrative', height: 'fixed', lines: 6 }]),
          _row(['next-steps']),
          _row(['legend']),
        ],
      },
    ],
    perStudent: {},
  };
  var FORM_CONFERENCE = {
    v: 4,
    id: 'conference-pack',
    name: 'Conference Pack',
    type: 'standard',
    pagesPerStudent: 'auto',
    pinned: 'parent-response',
    pages: [
      {
        rows: [
          _row(['header']),
          _row(['academic-summary']),
          _row([{ block: 'teacher-narrative', height: 'fixed', lines: 8 }]),
          _row(['competency-table']),
          _row(['next-steps']),
          _row(['grade-table']),
        ],
      },
      { rows: [_row(['learner-dimensions']), _row(['parent-response'])] },
    ],
    perStudent: {},
  };

  /* The Report Card, made whole. */
  function form() {
    return normalizeForm(FORM_REPORT_CARD);
  }

  /* Every block a form can hold. Labels, kinds, the palette group and the
     options a block offers live here, not in the saved form. `fixed` is
     the height mode of a block that reserves lines; `flow` blocks grow
     with the student. */
  var BLOCKS = {
    header: { label: 'Letterhead', kind: 'fixed', locked: true, group: null },
    'academic-summary': { label: 'Overall and Competencies', kind: 'fixed', group: 'Grades' },
    'competency-table': { label: 'Competency Table', kind: 'fixed', group: 'Grades', noEvidence: true },
    'grade-table': { label: 'Assignment Grades', kind: 'flow', group: 'Grades' },
    'section-outcomes': { label: 'Learning Outcomes', kind: 'flow', group: 'Grades' },
    'score-distribution': { label: 'Score Distribution', kind: 'flow', group: 'Grades' },
    'section-chart': { label: 'Section Chart', kind: 'flow', group: 'Grades' },
    attendance: { label: 'Attendance', kind: 'fixed', group: 'Grades' },
    'teacher-narrative': {
      label: 'Teacher Comment',
      kind: 'flow',
      group: 'Comments and Evidence',
      lines: 8,
      whenEmpty: 'box',
      sizable: true,
    },
    observations: { label: 'Observations', kind: 'flow', group: 'Comments and Evidence' },
    'next-steps': { label: 'Growth and Next Steps', kind: 'flow', group: 'Comments and Evidence', whenEmpty: 'omit' },
    'learner-dimensions': { label: 'Learning Dispositions', kind: 'fixed', group: 'Learner Profile', noEvidence: true },
    'core-competencies': { label: 'Core Competencies', kind: 'flow', group: 'Learner Profile', noEvidence: true },
    'student-reflection-learning': { label: 'Reflection: My Learning', kind: 'fixed', group: 'Learner Profile' },
    'student-reflection-habits': { label: 'Reflection: My Habits', kind: 'fixed', group: 'Learner Profile' },
    'parent-response': {
      label: 'Parent / Guardian Response',
      kind: 'fixed',
      group: 'Family',
      pinnable: true,
      sizable: true,
    },
    legend: { label: 'Proficiency Legend', kind: 'fixed', group: 'Family' },
    'text-block': { label: 'Text Block', kind: 'fixed', group: 'Family', sizable: true },
  };
  var BLOCK_ORDER = Object.keys(BLOCKS);
  var PALETTE_GROUPS = ['Grades', 'Comments and Evidence', 'Learner Profile', 'Family'];

  function _cleanCell(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var def = BLOCKS[raw.block];
    if (!def) return null;
    var cell = { block: raw.block, span: SPANS.indexOf(Number(raw.span)) >= 0 ? Number(raw.span) : 12 };
    var lines = Number(raw.lines);
    if (raw.height === 'fixed' && lines >= 1 && lines <= 20) {
      cell.height = 'fixed';
      cell.lines = Math.round(lines);
    } else if (def.lines && raw.height !== 'fit' && raw.height !== 'fixed' && !raw.room) {
      cell.height = 'fixed';
      cell.lines = def.lines;
    } else {
      cell.height = 'fit';
    }
    if (def.kind === 'flow' || def.whenEmpty) {
      cell.whenEmpty = raw.whenEmpty === 'box' || raw.whenEmpty === 'omit' ? raw.whenEmpty : def.whenEmpty || 'omit';
    }
    if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
      cell.options = JSON.parse(JSON.stringify(raw.options));
    }
    if (raw.noEvidence === 'hide' || raw.noEvidence === 'show') cell.noEvidence = raw.noEvidence;
    return cell;
  }

  /* Spans in a row always add up to 12. */
  function _balanceRow(row) {
    var cells = row.cells;
    var sum = cells.reduce(function (a, c) {
      return a + c.span;
    }, 0);
    if (sum === 12 && cells.length <= 3) return row;
    if (cells.length === 1) cells[0].span = 12;
    else if (cells.length === 2) {
      if (!(cells[0].span === 8 && cells[1].span === 4) && !(cells[0].span === 4 && cells[1].span === 8)) {
        cells[0].span = 6;
        cells[1].span = 6;
      }
    } else {
      cells.forEach(function (c) {
        c.span = 4;
      });
    }
    return row;
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
          if (it.whenEmpty) cell.whenEmpty = it.whenEmpty;
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

  /* A saved form (any version, any hand) made whole: known blocks only, no
     block twice, the letterhead first on page 1, spans that add up, at most
     one pinned block and it on the form, pages trimmed of empty tails but
     never fewer than one. A v3 form (front/back lists with pairs) and the
     old presets ({preset, blocks}) migrate here; nothing saved is lost.
     Absent → the Report Card. */
  function normalizeForm(raw) {
    var base = raw && typeof raw === 'object' ? raw : null;
    if (base && !Array.isArray(base.pages) && (Array.isArray(base.front) || Array.isArray(base.back))) {
      base = _v3ToPages(base);
    }
    if (!base || !Array.isArray(base.pages)) base = FORM_REPORT_CARD;
    var seen = {};
    var pages = base.pages
      .map(function (pg) {
        var rows = ((pg && pg.rows) || [])
          .map(function (row) {
            var cells = ((row && row.cells) || [])
              .map(_cleanCell)
              .filter(function (c) {
                if (!c || seen[c.block]) return false;
                seen[c.block] = true;
                return true;
              })
              .slice(0, 3);
            return cells.length ? _balanceRow({ cells: cells }) : null;
          })
          .filter(Boolean);
        return { rows: rows };
      })
      .filter(function (pg, i) {
        return i === 0 || pg.rows.length;
      });
    if (!pages.length) pages = [{ rows: [] }];
    // The letterhead leads page 1, alone on its row.
    pages.forEach(function (pg) {
      pg.rows = pg.rows
        .map(function (row) {
          row.cells = row.cells.filter(function (c) {
            return c.block !== 'header';
          });
          return row.cells.length ? _balanceRow(row) : null;
        })
        .filter(Boolean);
    });
    pages[0].rows.unshift({ cells: [{ block: 'header', span: 12, height: 'fit' }] });
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
      v: 4,
      id: base.id || 'report-card',
      name: base.name || 'Report Card',
      type: base.type === 'compact' ? 'compact' : 'standard',
      pagesPerStudent: pps === 1 || pps === 2 ? pps : 'auto',
      pinned: pinned,
      pages: pages,
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

  /* ── Editing (pure: each returns a new form) ─────────────────── */
  function _clone(f) {
    return JSON.parse(JSON.stringify(f));
  }
  /* Ids on the form, in order. */
  function onForm(f) {
    var ids = [];
    f.pages.forEach(function (pg) {
      pg.rows.forEach(function (row) {
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
  /* Where a block is: { page, row, cell } indexes, or null. */
  function locate(f, id) {
    for (var p = 0; p < f.pages.length; p++) {
      var rows = f.pages[p].rows;
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].cells.length; c++) {
          if (rows[r].cells[c].block === id) return { page: p, row: r, cell: c };
        }
      }
    }
    return null;
  }
  function cellOf(f, id) {
    var at = locate(f, id);
    return at ? f.pages[at.page].rows[at.row].cells[at.cell] : null;
  }
  /* "Page 1 · row 3 · left". */
  function positionText(f, id) {
    var at = locate(f, id);
    if (!at) return '';
    var row = f.pages[at.page].rows[at.row];
    var side = '';
    if (row.cells.length === 2) side = at.cell === 0 ? 'left' : 'right';
    else if (row.cells.length === 3) side = ['left', 'middle', 'right'][at.cell];
    return 'Page ' + (at.page + 1) + ' · row ' + (at.row + 1) + (side ? ' · ' + side : '');
  }
  function _dropEmptyRows(f) {
    f.pages.forEach(function (pg) {
      pg.rows = pg.rows
        .filter(function (row) {
          return row.cells.length;
        })
        .map(_balanceRow);
    });
    return f;
  }
  function _newCell(id) {
    return _cleanCell({ block: id, span: 12 });
  }
  /* Puts a block on the form. `at` is { page, row, side } where side is
     'before' or 'after' (a new full-width row there) or 'left' or 'right'
     (a cell in that row, which gains a column). Without `at` the block
     goes on a new row at the end of the last page. */
  function placeBlock(f, id, at) {
    if (!BLOCKS[id] || id === 'header') return f;
    f = removeCell(f, id);
    var cell = _newCell(id);
    var page = at && f.pages[at.page] ? f.pages[at.page] : f.pages[f.pages.length - 1];
    var row = at && page.rows[at.row] ? page.rows[at.row] : null;
    if (row && (at.side === 'left' || at.side === 'right') && row.cells.length < 3) {
      if (at.side === 'left') row.cells.unshift(cell);
      else row.cells.push(cell);
      _balanceRow(row);
    } else if (row && at.side === 'before') {
      page.rows.splice(at.row, 0, { cells: [cell] });
    } else if (row) {
      page.rows.splice(at.row + 1, 0, { cells: [cell] });
    } else {
      page.rows.push({ cells: [cell] });
    }
    return normalizeForm(f);
  }
  /* A new page after the last, holding the block. */
  function placeOnNewPage(f, id) {
    if (!BLOCKS[id] || id === 'header') return f;
    f = removeCell(f, id);
    f.pages.push({ rows: [{ cells: [_newCell(id)] }] });
    return normalizeForm(f);
  }
  function removeCell(f, id) {
    if (id === 'header') return f;
    f = _clone(f);
    var at = locate(f, id);
    if (!at) return f;
    f.pages[at.page].rows[at.row].cells.splice(at.cell, 1);
    if (f.pinned === id) f.pinned = null;
    return normalizeForm(_dropEmptyRows(f));
  }
  function setSpan(f, id, span) {
    f = _clone(f);
    var at = locate(f, id);
    if (!at || SPANS.indexOf(span) < 0) return f;
    var row = f.pages[at.page].rows[at.row];
    if (row.cells.length === 1) return f; // alone on its row, a cell is full width
    if (row.cells.length === 2) {
      var other = row.cells[1 - at.cell];
      if (span === 12) {
        // Full width: the other cell gets its own row after this one.
        row.cells.splice(1 - at.cell, 1);
        f.pages[at.page].rows.splice(at.row + 1, 0, { cells: [other] });
        return normalizeForm(_dropEmptyRows(f));
      }
      row.cells[at.cell].span = span === 6 ? 6 : span;
      other.span = 12 - row.cells[at.cell].span;
      if (SPANS.indexOf(other.span) < 0) {
        row.cells[at.cell].span = 6;
        other.span = 6;
      }
    }
    return normalizeForm(f);
  }
  function setHeight(f, id, mode, lines) {
    f = _clone(f);
    var cell = cellOf(f, id);
    if (!cell) return f;
    if (mode === 'fixed') {
      cell.height = 'fixed';
      cell.lines = Math.max(1, Math.min(20, Math.round(Number(lines) || cell.lines || BLOCKS[id].lines || 6)));
    } else {
      cell.height = 'fit';
      delete cell.lines;
    }
    return normalizeForm(f);
  }
  function setWhenEmpty(f, id, whenEmpty) {
    f = _clone(f);
    var cell = cellOf(f, id);
    if (cell) cell.whenEmpty = whenEmpty === 'box' ? 'box' : 'omit';
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

  /* ── Packing (pure) ─────────────────────────────────────────
     front, back: item heights in px, in form order. pinned: the height of
     the block pinned to the bottom of the back (0 for none). cap: the
     usable height of a side. Blocks keep their order: the first that does
     not fit, and everything after it, moves to the next side. A block
     taller than a whole side gets a side of its own and is flagged. */
  function pack(front, back, pinned, cap, frontMeta, backMeta) {
    var sides = [];
    var queue = front.map(function (h, i) {
      return _packItem('front', i, h, frontMeta && frontMeta[i]);
    });
    var backQueue = back.map(function (h, i) {
      return _packItem('back', i, h, backMeta && backMeta[i]);
    });
    var rest = fill({ kind: 'front', cap: cap, items: [], used: 0, over: false }, queue);
    rest = fill(
      { kind: 'back', cap: Math.max(0, cap - (pinned || 0)), items: [], used: 0, over: false },
      rest.concat(backQueue),
    );
    while (rest.length) rest = fill({ kind: 'continued', cap: cap, items: [], used: 0, over: false }, rest);
    return sides;

    function place(side, it, h, rowEnd) {
      var out = { from: it.from, i: it.i, h: h };
      if (it.rowStart != null) {
        out.rowStart = it.rowStart;
        out.rowEnd = rowEnd;
      }
      side.items.push(out);
      side.used += h;
      if (h > side.cap) side.over = true;
    }

    function fill(side, items) {
      sides.push(side);
      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        var room = side.cap - side.used;
        if (it.h <= room) {
          place(side, it, it.h, it.rows ? it.rowStart + it.rows.length : undefined);
          continue;
        }
        if (it.rows && it.rows.length > 1) {
          // The rows that fit stay; the rest carry on to the next side. A
          // row taller than a side goes alone and over, never dropped.
          var take = 0;
          var sum = it.chrome;
          while (take < it.rows.length && sum + it.rows[take] <= room) {
            sum += it.rows[take];
            take++;
          }
          if (take === 0 && side.used === 0) {
            sum += it.rows[0];
            take = 1;
          }
          if (take === 0) return items.slice(k);
          if (take >= it.rows.length) {
            place(side, it, it.h, it.rowStart + it.rows.length);
            continue;
          }
          place(side, it, sum, it.rowStart + take);
          var restRows = it.rows.slice(take);
          var restItem = {
            from: it.from,
            i: it.i,
            rows: restRows,
            chrome: it.chrome,
            rowStart: it.rowStart + take,
            h:
              it.chrome +
              restRows.reduce(function (a, b) {
                return a + b;
              }, 0),
          };
          return [restItem].concat(items.slice(k + 1));
        }
        if (side.used === 0) {
          place(side, it, it.h);
          continue;
        }
        return items.slice(k);
      }
      return [];
    }
  }

  function _packItem(from, i, h, meta) {
    var it = { from: from, i: i, h: h };
    if (meta && meta.rows && meta.rows.length > 1) {
      it.rows = meta.rows;
      it.chrome = meta.chrome || 0;
      it.rowStart = 0;
    }
    return it;
  }

  /* A comment box with ruled lines for a student with no comment yet. */
  function _emptyCommentBox(px) {
    return (
      '<div class="report-block-box report-comment-box"><div class="report-block-title">Teacher Comment</div>' +
      '<div class="report-ruled" style="height:' +
      Math.round(px) +
      'px"></div></div>'
    );
  }

  function _cellHtml(cell, cid, student, ctx, probe) {
    var html = ReportBlocks.renderReportBlock(cell.block, cid, student, ctx, cell.options || {});
    var roomPx = cell.height === 'fixed' && cell.lines ? cell.lines * probe.linePx : 0;
    if (!html) {
      if (cell.whenEmpty === 'box' && roomPx) return _emptyCommentBox(roomPx);
      return '';
    }
    if (roomPx) {
      // Reserve the room so a short comment still leaves the form's shape.
      html =
        '<div class="sheet-room" style="min-height:' +
        Math.round(roomPx + probe.boxChromePx) +
        'px">' +
        html +
        '</div>';
    }
    return html;
  }
  /* A row as it sits on the sheet: one cell alone, or cells side by side
     at their spans. Each cell is marked with its block so the Studio can
     select it. Empty cells take no room; an empty row takes none. */
  function _rowHtml(row, cid, student, ctx, probe, hidden) {
    var cells = row.cells
      .filter(function (c) {
        return hidden.indexOf(c.block) < 0;
      })
      .map(function (c) {
        return { cell: c, html: _cellHtml(c, cid, student, ctx, probe) };
      })
      .filter(function (x) {
        return !!x.html;
      });
    if (!cells.length) return '';
    if (cells.length === 1 && row.cells.length === 1) {
      return '<div class="sheet-cell" data-block="' + cells[0].cell.block + '">' + cells[0].html + '</div>';
    }
    return (
      '<div class="sheet-row">' +
      cells
        .map(function (x) {
          return (
            '<div class="sheet-cell" data-block="' +
            x.cell.block +
            '" style="flex:0 0 calc(' +
            x.cell.span +
            ' / 12 * (100% - ' +
            (cells.length - 1) * 12 +
            'px))">' +
            x.html +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function _rowLabel(row) {
    return row.cells
      .map(function (c) {
        return BLOCKS[c.block] ? BLOCKS[c.block].label : c.block;
      })
      .join(' and ');
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
    var footer = _footerHtml('Course', 'Report', 'Teacher', 'Student', 1, 1, 'Front');
    var h = _measureAll(stage, [one, two, footer]);
    var linePx = Math.max(12, h[1] - h[0]);
    return { linePx: linePx, boxChromePx: Math.max(0, h[0] - linePx), footerPx: h[2] };
  }

  /* ── Sheets ─────────────────────────────────────────────────── */
  /* n and total are pages (sides); `side` is kept for callers but not printed. */
  function _footerHtml(course, report, teacher, student, n, total, side) {
    var left = [course, report, teacher].filter(Boolean).map(esc).join(' · ');
    var right = esc(student) + ' · Page ' + n + ' of ' + total;
    return '<div class="sheet-footer"><span>' + left + '</span><span>' + right + '</span></div>';
  }

  function _sideHtml(side, itemHtml, pinnedHtml, footer, paper, extraClass, opts) {
    var body = side
      ? side.items
          .map(function (it) {
            var html = itemHtml[it.from][it.i];
            if (it.rowStart != null) html = _partHtml(html, it.rowStart, it.rowEnd, it.rowStart > 0);
            return '<div class="sheet-item">' + html + '</div>';
          })
          .join('')
      : '<div class="sheet-blank">This side is left blank.</div>';
    var fill = side && side.cap ? Math.min(1, side.used / side.cap) : 0;
    return (
      '<div class="report-sheet' +
      (side && side.over ? ' sheet-overflow' : '') +
      (extraClass ? ' ' + extraClass : '') +
      (opts && opts.type === 'compact' ? ' compact' : '') +
      '" data-paper="' +
      paper +
      '" data-fill="' +
      Math.round(fill * 100) +
      '" style="--fill:' +
      Math.round(fill * 100) +
      '%">' +
      '<div class="sheet-body">' +
      body +
      '</div>' +
      (pinnedHtml ? '<div class="sheet-pinned">' + pinnedHtml + '</div>' : '') +
      footer +
      '</div>'
    );
  }

  /* ── Tall blocks split at row boundaries (plan item 5.6) ──────────
     A table block taller than the room left on a side (the Assignment
     Grades table for a student with many assessments) used to be placed
     alone on a side and spill off it. pack() now cuts such a block at its
     rows: the rows that fit go on the current side and the rest carry on
     to the next, each part a copy of the block with that run of rows, the
     later parts titled "(continued)". */

  /* The row heights and chrome (title, head, padding) of a table block,
     measured on the stage, or null when the block has no table to cut. */
  function _rowsOf(html, h, stage) {
    stage.innerHTML = '<div class="sheet-item">' + html + '</div>';
    var tbody = stage.querySelector('table tbody');
    if (!tbody || tbody.rows.length < 2) return null;
    var rows = Array.prototype.map.call(tbody.rows, function (r) {
      return r.offsetHeight;
    });
    var total = rows.reduce(function (a, b) {
      return a + b;
    }, 0);
    return { rows: rows, chrome: Math.max(0, h - total) };
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

  /* Lays one student into sheets. Returns { html, sheets, sides, over }. */
  /* One plain sentence or two on why a student's report is the shape it is.
     Empty when everything sits where the form puts it. */
  function reasonText(r) {
    var parts = [];
    if (r.room && r.commentLines > r.room) {
      parts.push('Comment is ' + r.commentLines + ' lines; the form keeps ' + r.room + ' on the front.');
    }
    if (r.moved && r.moved.length) parts.push(r.moved.join(' and ') + ' moved to the back.');
    if (r.continued && r.continued.length) parts.push(r.continued.join(' and ') + ' on a second sheet.');
    if (r.noComment) parts.push('No comment yet; the box prints with lines.');
    return parts.join(' ');
  }

  function layoutStudent(cid, student, ctx, opts) {
    var f = opts.form || FORM_REPORT_CARD;
    var probe = opts.probe;
    var paper = opts.paper || 'letter';
    var p = PAPER[paper] || PAPER.letter;
    var sideH = (p.h - 2 * MARGIN_IN) * PX_PER_IN;
    var cap = Math.floor((sideH - probe.footerPx) * (1 - SAFETY));

    var hidden = hiddenFor(f, student.id);
    var commentCell = cellOf(f, 'teacher-narrative');
    var rawComment =
      commentCell && hidden.indexOf('teacher-narrative') < 0
        ? ReportBlocks.renderReportBlock('teacher-narrative', cid, student, ctx, commentCell.options || {})
        : '';
    // pages[0] is the front; every later page flows on from the back. The
    // pinned block comes out of its row and sits at the bottom of the back.
    var isPinned = function (row) {
      return row.cells.length === 1 && row.cells[0].block === f.pinned;
    };
    var frontRows = f.pages[0].rows.filter(function (row) {
      return !isPinned(row);
    });
    var backRows = [];
    f.pages.slice(1).forEach(function (pg) {
      pg.rows.forEach(function (row) {
        if (!isPinned(row)) backRows.push(row);
      });
    });
    var pinnedCell = f.pinned && hidden.indexOf(f.pinned) < 0 ? cellOf(f, f.pinned) : null;
    var frontHtml = frontRows.map(function (row) {
      return _rowHtml(row, cid, student, ctx, probe, hidden);
    });
    var frontLabels = frontRows.map(_rowLabel);
    var backHtml = backRows.map(function (row) {
      return _rowHtml(row, cid, student, ctx, probe, hidden);
    });
    var backLabels = backRows.map(_rowLabel);
    var pinnedHtml = pinnedCell ? _rowHtml({ cells: [pinnedCell] }, cid, student, ctx, probe, hidden) : '';
    var frontSingle = frontRows.map(function (row) {
      return row.cells.length === 1;
    });
    var backSingle = backRows.map(function (row) {
      return row.cells.length === 1;
    });

    // Empty blocks take no room at all.
    var frontKeep = [],
      backKeep = [];
    frontHtml = frontHtml.filter(function (h, i) {
      if (h) frontKeep.push(i);
      return !!h;
    });
    backHtml = backHtml.filter(function (h, i) {
      if (h) backKeep.push(i);
      return !!h;
    });

    var extra = (pinnedHtml ? [pinnedHtml] : []).concat(rawComment ? [rawComment] : []);
    var heights = _measureAll(opts.stage, frontHtml.concat(backHtml, extra));
    var frontH = heights.slice(0, frontHtml.length);
    var backH = heights.slice(frontHtml.length, frontHtml.length + backHtml.length);
    var pinnedH = pinnedHtml ? heights[frontHtml.length + backHtml.length] : 0;
    var commentH = rawComment ? heights[heights.length - 1] : 0;
    var commentLines = rawComment ? Math.max(1, Math.round((commentH - probe.boxChromePx) / probe.linePx)) : 0;
    var room = commentCell && commentCell.height === 'fixed' ? commentCell.lines : 0;

    // A block that may not fit a side gets its row heights, so pack() can
    // cut it where the side ends.
    var backCap = Math.max(0, cap - pinnedH);
    var frontMeta = frontHtml.map(function (h, i) {
      return frontH[i] > backCap && frontSingle[frontKeep[i]] ? _rowsOf(h, frontH[i], opts.stage) : null;
    });
    var backMeta = backHtml.map(function (h, i) {
      return backH[i] > backCap && backSingle[backKeep[i]] ? _rowsOf(h, backH[i], opts.stage) : null;
    });
    var sides = pack(frontH, backH, pinnedH, cap, frontMeta, backMeta);
    var sheetCount = Math.ceil(sides.length / 2);
    var moved = [];
    var continued = [];
    // A block cut into parts is named once in the reason, by its own name.
    var nameOnce = function (list, label) {
      label = label.replace(/ \(continued\)$/, '');
      if (list.indexOf(label) < 0) list.push(label);
    };
    sides.forEach(function (side, idx) {
      side.items.forEach(function (it) {
        var label = it.from === 'front' ? frontLabels[frontKeep[it.i]] : backLabels[backKeep[it.i]];
        if (idx === 1 && it.from === 'front') nameOnce(moved, label);
        if (idx >= 2) nameOnce(continued, label);
      });
    });
    var course = COURSES[cid] || {};
    var teacher = (typeof getConfig === 'function' && getConfig().displayName) || '';
    var name = fullName(student);
    var itemHtml = { front: frontHtml, back: backHtml };
    var used = frontH.concat(backH).reduce(function (a, b) {
      return a + b;
    }, pinnedH);
    var result = {
      sheets: sheetCount,
      sides: sides.length,
      used: used,
      over: false,
      moved: moved,
      continued: continued,
      commentLines: commentLines,
      room: room,
      noComment: !!commentCell && hidden.indexOf('teacher-narrative') < 0 && !rawComment,
    };
    var reason = reasonText(result);
    var badge =
      result.noComment && sheetCount === 1 ? 'No comment' : sheetCount === 1 ? '1 sheet' : sheetCount + ' sheets';
    var html =
      '<div class="sheet-student" data-action="fitMapPick" data-sid="' +
      esc(student.id) +
      '" data-sheets="' +
      sheetCount +
      '">' +
      '<div class="sheet-student-head no-print"><span class="sheet-student-name">' +
      esc(name) +
      '</span><span class="sheet-badge ' +
      (sheetCount > 1 ? 'over' : result.noComment ? 'none' : 'ok') +
      '">' +
      badge +
      '</span></div>' +
      (reason ? '<div class="sheet-note no-print">' + esc(reason) + '</div>' : '');
    var total = sheetCount * 2;
    var over = false;
    for (var s = 0; s < sheetCount; s++) {
      var front = sides[2 * s];
      var back = sides[2 * s + 1] || null;
      over = over || front.over || (back && back.over);
      html +=
        '<div class="sheet-zoom"><div class="sheet-label no-print">Page ' +
        (2 * s + 1) +
        ' of ' +
        total +
        '</div>' +
        _sideHtml(
          front,
          itemHtml,
          '',
          _footerHtml(course.name, ctx.termLabel, teacher, name, 2 * s + 1, total, 'Front'),
          paper,
          '',
          f,
        ) +
        '</div>';
      html +=
        '<div class="sheet-zoom"><div class="sheet-label no-print">Page ' +
        (2 * s + 2) +
        ' of ' +
        total +
        '</div>' +
        _sideHtml(
          back,
          itemHtml,
          s === 0 ? pinnedHtml : '',
          _footerHtml(course.name, ctx.termLabel, teacher, name, 2 * s + 2, total, 'Back'),
          paper,
          back ? '' : 'sheet-blank-side',
          f,
        ) +
        '</div>';
    }
    html += '</div>';
    result.html = html;
    result.over = over;
    result.reason = reason;
    result.badge = badge;
    return result;
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

  /* Renders every student's sheets into `preview`. Returns a summary
     { students, sheets, pages, continued: [names], over: [names] }. */
  function renderPreview(opts) {
    var preview = opts.preview;
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var p = PAPER[paper];
    var contentW = (p.w - 2 * MARGIN_IN) * PX_PER_IN;
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(preview, contentW, formUsed.type);
    var probe = _probe(stage);
    var summary = {
      students: opts.students.length,
      sheets: 0,
      pages: 0,
      continued: [],
      over: [],
      noComment: [],
      perStudent: {},
    };
    var html = opts.students
      .map(function (st) {
        var r = layoutStudent(opts.cid, st, opts.ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
        summary.sheets += r.sheets;
        summary.pages += r.sheets * 2;
        if (r.sheets > 1) summary.continued.push(fullName(st));
        if (r.over) summary.over.push(fullName(st));
        if (r.noComment) summary.noComment.push(fullName(st));
        summary.perStudent[st.id] = {
          sheets: r.sheets,
          sides: r.sides,
          over: r.over,
          badge: r.badge,
          reason: r.reason,
          noComment: r.noComment,
          name: fullName(st),
          html: r.html,
          used: r.used,
        };
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

  /* Sheets per student on each starter form, for the setup list: what a
     form costs the class is known before it is chosen. Lays every student
     out on each form on a stage off-screen; a class of 30 takes well under
     a second. Returns { formId: { most, max } }, most being the sheet
     count the largest number of students need. */
  function sheetsForForms(cid, students, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var type = opts.type === 'compact' ? 'compact' : 'standard';
    var out = {};
    STARTERS.forEach(function (st) {
      var f = normalizeForm(Object.assign({}, st.form, { type: type }));
      var stage = _stage(document.body, contentW, f.type);
      try {
        var probe = _probe(stage);
        var counts = {};
        students.forEach(function (student) {
          var r = layoutStudent(cid, student, ctx, { form: f, paper: paper, stage: stage, probe: probe });
          counts[r.sheets] = (counts[r.sheets] || 0) + 1;
        });
        var sheets = Object.keys(counts).map(Number);
        var most = sheets.sort(function (a, b) {
          return counts[b] - counts[a] || a - b;
        })[0];
        out[st.id] = { most: most || 1, max: sheets.length ? Math.max.apply(null, sheets) : 1 };
      } finally {
        stage.remove();
      }
    });
    return out;
  }
  /* The class laid out on the current form, without rendering: the same
     summary renderPreview returns, minus the HTML. For the Studio's stats
     and the toolbar count while one student is on screen. */
  function classSummary(cid, students, ctx, opts) {
    opts = opts || {};
    var paper = PAPER[opts.paper] ? opts.paper : 'letter';
    var contentW = (PAPER[paper].w - 2 * MARGIN_IN) * PX_PER_IN;
    var formUsed = normalizeForm(opts.form);
    var stage = _stage(document.body, contentW, formUsed.type);
    var summary = {
      students: students.length,
      sheets: 0,
      pages: 0,
      continued: [],
      over: [],
      noComment: [],
      perStudent: {},
    };
    try {
      var probe = _probe(stage);
      students.forEach(function (st) {
        var r = layoutStudent(cid, st, ctx, { form: formUsed, paper: paper, stage: stage, probe: probe });
        summary.sheets += r.sheets;
        summary.pages += r.sheets * 2;
        if (r.sheets > 1) summary.continued.push(fullName(st));
        if (r.over) summary.over.push(fullName(st));
        if (r.noComment) summary.noComment.push(fullName(st));
        summary.perStudent[st.id] = {
          sheets: r.sheets,
          sides: r.sides,
          over: r.over,
          badge: r.badge,
          reason: r.reason,
          noComment: r.noComment,
          name: fullName(st),
          used: r.used,
          hash: ReportIssuesHash(r.html),
        };
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
      var probe = _probe(stage);
      var ids = BLOCK_ORDER.filter(function (id) {
        return id !== 'text-block';
      });
      var htmls = ids.map(function (id) {
        return _cellHtml(_cleanCell({ block: id, span: 12 }), cid, student, ctx, probe);
      });
      var heights = _measureAll(stage, htmls);
      ids.forEach(function (id, i) {
        out[id] = htmls[i] ? heights[i] : 0;
      });
    } finally {
      stage.remove();
    }
    return out;
  }

  /* "1 sheet each", "2 sheets each", "Most need 1 sheet; some 2". */
  function fitLabel(fit) {
    if (!fit) return '';
    var word = function (n) {
      return n + (n === 1 ? ' sheet' : ' sheets');
    };
    if (fit.most === fit.max) return word(fit.most) + ' each';
    return 'Most need ' + word(fit.most) + '; some ' + fit.max;
  }

  /* What the comment box tells the teacher while they write. Never a cap:
     the form never shrinks a student's words. */
  function fitText(r) {
    if (!r || !r.room) return '';
    if (r.noComment)
      return 'No comment yet. The form keeps ' + r.room + ' lines on the front; an empty box prints with lines.';
    var lines = r.commentLines;
    if (lines <= r.room) {
      var left = r.room - lines;
      return (
        'Fits the front. ' +
        lines +
        (lines === 1 ? ' line' : ' lines') +
        (left ? '; room for ' + left + ' more before anything moves.' : '; the front is full.')
      );
    }
    var t = lines + ' lines, ' + (lines - r.room) + ' past the front\u2019s room.';
    if (r.moved && r.moved.length)
      t += ' ' + r.moved.join(' and ') + (r.moved.length === 1 ? ' moves' : ' move') + ' to the back.';
    if (r.continued && r.continued.length) t += ' ' + r.continued.join(' and ') + ' on a second sheet.';
    t += ' Nothing is cut.';
    return t;
  }

  /* The rail's one-line account of the class. */
  function summaryText(s) {
    if (!s || !s.students) return '';
    var one = s.students - s.continued.length;
    var t = s.students + (s.students === 1 ? ' student · ' : ' students · ') + s.pages + ' pages · ';
    if (!s.continued.length) t += s.students === 1 ? 'one sheet' : 'every student on one sheet';
    else t += one + ' on one sheet, ' + s.continued.length + ' need a second (' + s.continued.join(', ') + ')';
    if (s.noComment && s.noComment.length) {
      t += ' · ' + s.noComment.length + ' with no comment yet (' + s.noComment.join(', ') + ')';
    }
    if (s.over.length) t += ' · a block is taller than a side for ' + s.over.join(', ');
    return t;
  }

  return {
    PAPER: PAPER,
    SAFETY: SAFETY,
    SPANS: SPANS,
    form: form,
    BLOCKS: BLOCKS,
    PALETTE_GROUPS: PALETTE_GROUPS,
    normalizeForm: normalizeForm,
    formFor: formFor,
    onForm: onForm,
    available: available,
    locate: locate,
    cellOf: cellOf,
    positionText: positionText,
    placeBlock: placeBlock,
    placeOnNewPage: placeOnNewPage,
    removeCell: removeCell,
    setSpan: setSpan,
    setHeight: setHeight,
    setWhenEmpty: setWhenEmpty,
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
    pack: pack,
    reasonText: reasonText,
    describeStudent: describeStudent,
    sheetsForForms: sheetsForForms,
    classSummary: classSummary,
    blockSizes: blockSizes,
    fitLabel: fitLabel,
    fitText: fitText,
    paperSize: paperSize,
    layoutStudent: layoutStudent,
    renderPreview: renderPreview,
    summaryText: summaryText,
    clearPageStyle: clearPageStyle,
    setPageStyle: _setPageStyle,
  };
})();
