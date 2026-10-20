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

  /* The one form for now. Edit Layout (Phase 3) will make this data a
     teacher can change; until then it is the Report Card. The Parent /
     Guardian Response block is placed, never reworded (DECISIONS "Report
     forms" 5). The student reflection keeps its wording too, and with it
     stands 795px tall at print size: taller than a Letter back with the
     response below it. It stays in the Detailed preset and becomes an
     attachment sheet when Edit Layout arrives. */
  var FORM_REPORT_CARD = {
    id: 'report-card',
    name: 'Report Card',
    front: [
      { block: 'header', kind: 'fixed', label: 'Letterhead' },
      { block: 'academic-summary', kind: 'fixed', label: 'Overall and Competencies' },
      { block: 'teacher-narrative', kind: 'flow', label: 'Teacher Comment', room: { lines: 8 }, whenEmpty: 'box' },
      {
        pair: [
          { block: 'competency-table', kind: 'fixed', label: 'Curricular Competencies' },
          { block: 'attendance', kind: 'fixed', label: 'Attendance' },
        ],
      },
      { block: 'next-steps', kind: 'flow', label: 'Growth and Next Steps', whenEmpty: 'omit' },
    ],
    back: [
      { block: 'learner-dimensions', kind: 'fixed', label: 'Learning Dispositions' },
      { block: 'parent-response', kind: 'fixed', label: 'Parent / Guardian Response', pinned: 'bottom' },
    ],
  };

  /* The Report Card, made whole (labels, kinds and the letterhead's lock
     come from the registry below). */
  function form() {
    return normalizeForm(FORM_REPORT_CARD);
  }

  /* Every block a form can hold. Labels and kinds live here, not in the
     saved form, so a label can change without touching saved layouts. */
  var BLOCKS = {
    header: { label: 'Letterhead', kind: 'fixed', locked: true },
    'academic-summary': { label: 'Overall and Competencies', kind: 'fixed' },
    'teacher-narrative': { label: 'Teacher Comment', kind: 'flow', room: 8, whenEmpty: 'box' },
    'competency-table': { label: 'Curricular Competencies', kind: 'fixed' },
    attendance: { label: 'Attendance', kind: 'fixed' },
    'next-steps': { label: 'Growth and Next Steps', kind: 'flow', whenEmpty: 'omit' },
    'learner-dimensions': { label: 'Learning Dispositions', kind: 'fixed' },
    'parent-response': { label: 'Parent / Guardian Response', kind: 'fixed', pinnable: true },
    'student-reflection-learning': { label: 'Student Reflection: My Learning', kind: 'fixed' },
    'student-reflection-habits': { label: 'Student Reflection: My Habits', kind: 'fixed' },
    'section-chart': { label: 'Section Proficiency Chart', kind: 'flow' },
    'grade-table': { label: 'Assignment Grades', kind: 'flow' },
    'section-outcomes': { label: 'Learning Outcomes', kind: 'flow' },
    'score-distribution': { label: 'Score Distribution', kind: 'flow' },
    'core-competencies': { label: 'Core Competencies', kind: 'flow' },
    observations: { label: 'Observations and Evidence', kind: 'flow' },
    legend: { label: 'Proficiency Legend', kind: 'fixed' },
  };
  var BLOCK_ORDER = Object.keys(BLOCKS);

  function _fill(item) {
    if (!item || typeof item !== 'object') return null;
    if (Array.isArray(item.pair)) {
      var cells = item.pair.map(_fill).filter(function (q) {
        return q && q.kind === 'fixed';
      });
      if (cells.length === 2) return { pair: cells };
      return cells[0] || null;
    }
    var def = BLOCKS[item.block];
    if (!def) return null;
    var out = { block: item.block, kind: def.kind, label: def.label };
    if (def.locked) out.locked = true;
    if (def.kind === 'flow') {
      var lines = Number(item.room && item.room.lines);
      if (def.room || lines) out.room = { lines: lines >= 1 && lines <= 20 ? Math.round(lines) : def.room || 0 };
      if (!out.room || !out.room.lines) delete out.room;
      out.whenEmpty = item.whenEmpty === 'box' || item.whenEmpty === 'omit' ? item.whenEmpty : def.whenEmpty || 'omit';
    }
    if (item.pinned && def.pinnable) out.pinned = 'bottom';
    return out;
  }

  /* A saved form (any version, any hand) made whole: known blocks only,
     the letterhead first on the front, at most one block pinned to the
     bottom of the back, no block twice. Absent → the Report Card. */
  function normalizeForm(raw) {
    var base =
      raw && typeof raw === 'object' && (Array.isArray(raw.front) || Array.isArray(raw.back)) ? raw : FORM_REPORT_CARD;
    var seen = {};
    var keep = function (it) {
      if (!it) return false;
      var ids = it.pair
        ? it.pair.map(function (q) {
            return q.block;
          })
        : [it.block];
      if (
        ids.some(function (id) {
          return seen[id];
        })
      )
        return false;
      ids.forEach(function (id) {
        seen[id] = true;
      });
      return true;
    };
    var front = (base.front || []).map(_fill).filter(keep);
    var back = (base.back || []).map(_fill).filter(keep);
    // The letterhead leads the front.
    var all = front.concat(back);
    var hasHeader = all.some(function (it) {
      return it.block === 'header';
    });
    front = front.filter(function (it) {
      return it.block !== 'header';
    });
    back = back.filter(function (it) {
      return it.block !== 'header';
    });
    front.unshift(_fill({ block: 'header' }));
    if (!hasHeader) seen.header = true;
    // One pinned block, on the back, last.
    var pinned = null;
    var unpin = function (list) {
      return list.filter(function (it) {
        if (it.pinned && !pinned) {
          pinned = it;
          return false;
        }
        if (it.pinned) delete it.pinned;
        return true;
      });
    };
    front = unpin(front);
    back = unpin(back);
    if (pinned) back.push(pinned);
    return {
      v: 3,
      id: base.id || 'report-card',
      name: base.name || 'Report Card',
      type: base.type === 'compact' ? 'compact' : 'standard',
      front: front,
      back: back,
    };
  }

  /* The class's form from its report config, the Report Card by default. */
  function formFor(reportConfig) {
    return normalizeForm(reportConfig && reportConfig.form);
  }

  /* ── Editing (pure: each returns a new form) ─────────────────── */
  function _clone(f) {
    return JSON.parse(JSON.stringify(f));
  }
  function _list(f, side) {
    return side === 'back' ? f.back : f.front;
  }
  function moveItem(f, side, idx, dir) {
    f = _clone(f);
    var list = _list(f, side);
    var j = idx + dir;
    if (idx < 0 || idx >= list.length || j < 0 || j >= list.length) return f;
    if (list[idx].locked || list[j].locked) return f;
    if (list[idx].pinned || list[j].pinned) return f;
    var t = list[idx];
    list[idx] = list[j];
    list[j] = t;
    return f;
  }
  function moveToSide(f, side, idx) {
    f = _clone(f);
    var from = _list(f, side);
    var it = from[idx];
    if (!it || it.locked || it.pinned) return f;
    from.splice(idx, 1);
    var to = _list(f, side === 'back' ? 'front' : 'back');
    var pinnedAt = to.findIndex(function (q) {
      return q.pinned;
    });
    if (pinnedAt >= 0) to.splice(pinnedAt, 0, it);
    else to.push(it);
    return f;
  }
  function removeItem(f, side, idx) {
    f = _clone(f);
    var list = _list(f, side);
    if (!list[idx] || list[idx].locked) return f;
    list.splice(idx, 1);
    return f;
  }
  function addBlock(f, id, side) {
    if (!BLOCKS[id] || onForm(f).indexOf(id) >= 0) return f;
    f = _clone(f);
    var to = _list(f, side === 'back' ? 'back' : 'front');
    var it = _fill({ block: id });
    var pinnedAt = to.findIndex(function (q) {
      return q.pinned;
    });
    if (pinnedAt >= 0) to.splice(pinnedAt, 0, it);
    else to.push(it);
    return f;
  }
  function setRoom(f, lines) {
    f = _clone(f);
    f.front.concat(f.back).forEach(function (it) {
      if (it.block === 'teacher-narrative')
        it.room = { lines: Math.max(1, Math.min(20, Math.round(Number(lines) || 8))) };
    });
    return f;
  }
  function setWhenEmpty(f, id, whenEmpty) {
    f = _clone(f);
    f.front.concat(f.back).forEach(function (it) {
      if (it.block === id && it.kind === 'flow') it.whenEmpty = whenEmpty === 'box' ? 'box' : 'omit';
    });
    return f;
  }
  function setPinned(f, id, on) {
    f = _clone(f);
    var item = null;
    var fromFront = -1;
    f.front.forEach(function (it, i) {
      if (it.block === id) {
        item = it;
        fromFront = i;
      }
    });
    f.back.forEach(function (it) {
      if (it.block === id) item = it;
    });
    if (!item || !BLOCKS[id] || !BLOCKS[id].pinnable) return f;
    f.front.concat(f.back).forEach(function (it) {
      delete it.pinned;
    });
    if (on) {
      if (fromFront >= 0) {
        f.front.splice(fromFront, 1);
        f.back.push(item);
      } else {
        f.back = f.back.filter(function (it) {
          return it !== item;
        });
        f.back.push(item);
      }
      item.pinned = 'bottom';
    }
    return normalizeForm(f);
  }
  function setType(f, type) {
    f = _clone(f);
    f.type = type === 'compact' ? 'compact' : 'standard';
    return f;
  }
  /* Drags: the block at `from` lands at `to` on the same side. */
  function reorder(f, side, from, to) {
    f = _clone(f);
    var list = _list(f, side);
    if (!list[from] || list[from].locked || list[from].pinned) return f;
    var min = side === 'front' ? 1 : 0;
    var max = list.length - 1;
    if (list[max] && list[max].pinned) max -= 1;
    to = Math.max(min, Math.min(max, Number(to) || 0));
    if (from === to) return f;
    var it = list.splice(from, 1)[0];
    list.splice(to, 0, it);
    return f;
  }
  /* Two fixed blocks side by side: the block at idx with the one after it. */
  function pairWith(f, side, idx) {
    f = _clone(f);
    var list = _list(f, side);
    var a = list[idx],
      b = list[idx + 1];
    if (!canPair(a, b)) return f;
    list.splice(idx, 2, { pair: [a, b] });
    return f;
  }
  function canPair(a, b) {
    return !!(
      a &&
      b &&
      !a.pair &&
      !b.pair &&
      a.kind === 'fixed' &&
      b.kind === 'fixed' &&
      !a.locked &&
      !b.locked &&
      !a.pinned &&
      !b.pinned
    );
  }
  function unpair(f, side, idx) {
    f = _clone(f);
    var list = _list(f, side);
    if (!list[idx] || !list[idx].pair) return f;
    list.splice.apply(list, [idx, 1].concat(list[idx].pair));
    return f;
  }

  /* ── Starters and the teacher's library ─────────────────────── */
  var STARTERS = [
    {
      id: 'report-card',
      name: 'Report Card',
      help: 'Front: grades, comment, competencies, next steps. Back: dispositions and the family response. One sheet, front and back.',
      form: FORM_REPORT_CARD,
    },
    {
      id: 'interim-update',
      name: 'Interim Update',
      help: 'Overall, competencies, a six-line comment, next steps and the legend on one side, for the updates between report cards.',
      form: {
        front: [
          { block: 'header' },
          { block: 'academic-summary' },
          { block: 'teacher-narrative', room: { lines: 6 }, whenEmpty: 'box' },
          { block: 'next-steps', whenEmpty: 'omit' },
          { block: 'legend' },
        ],
        back: [],
      },
    },
    {
      id: 'conference-pack',
      name: 'Conference Pack',
      help: 'The Report Card plus this term\u2019s assignment grades, for parent\u2013teacher conferences. Usually two sheets.',
      form: {
        front: [
          { block: 'header' },
          { block: 'academic-summary' },
          { block: 'teacher-narrative', room: { lines: 8 }, whenEmpty: 'box' },
          { pair: [{ block: 'competency-table' }, { block: 'attendance' }] },
          { block: 'next-steps', whenEmpty: 'omit' },
          { block: 'grade-table', whenEmpty: 'omit' },
        ],
        back: [{ block: 'learner-dimensions' }, { block: 'parent-response', pinned: 'bottom' }],
      },
    },
  ];
  function starters() {
    return STARTERS.map(function (st) {
      return { id: st.id, name: st.name, help: st.help };
    });
  }
  function starter(id) {
    var st = STARTERS.find(function (x) {
      return x.id === id;
    });
    return st ? normalizeForm(Object.assign({}, st.form, { id: st.id, name: st.name })) : null;
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
      /* the library is a convenience on this device */
    }
  }
  function saveTemplate(name, f) {
    name = String(name || '').trim();
    if (!name) return null;
    var entry = {
      id: 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name: name,
      savedAt: new Date().toISOString(),
      form: normalizeForm(Object.assign({}, _clone(f), { name: name })),
    };
    _writeTemplates([entry].concat(templates()).slice(0, 30));
    return entry;
  }
  function removeTemplate(id) {
    _writeTemplates(
      templates().filter(function (t) {
        return t.id !== id;
      }),
    );
  }
  function template(id) {
    var t = templates().find(function (x) {
      return x.id === id;
    });
    return t ? normalizeForm(t.form) : null;
  }

  /* Ids on the form, in order. */
  function onForm(f) {
    var ids = [];
    f.front.concat(f.back).forEach(function (it) {
      if (it.pair)
        it.pair.forEach(function (q) {
          ids.push(q.block);
        });
      else ids.push(it.block);
    });
    return ids;
  }
  function available(f) {
    var on = onForm(f);
    return BLOCK_ORDER.filter(function (id) {
      return on.indexOf(id) < 0;
    });
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
  function pack(front, back, pinned, cap) {
    var sides = [];
    var queue = front.map(function (h, i) {
      return { from: 'front', i: i, h: h };
    });
    var backQueue = back.map(function (h, i) {
      return { from: 'back', i: i, h: h };
    });
    var rest = fill({ kind: 'front', cap: cap, items: [], used: 0, over: false }, queue);
    rest = fill(
      { kind: 'back', cap: Math.max(0, cap - (pinned || 0)), items: [], used: 0, over: false },
      rest.concat(backQueue),
    );
    while (rest.length) rest = fill({ kind: 'continued', cap: cap, items: [], used: 0, over: false }, rest);
    return sides;

    function fill(side, items) {
      sides.push(side);
      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if (side.used === 0 || side.used + it.h <= side.cap) {
          side.items.push(it);
          side.used += it.h;
          if (it.h > side.cap) side.over = true;
        } else {
          return items.slice(k);
        }
      }
      return [];
    }
  }

  /* ── Block HTML for a form item ─────────────────────────────── */
  function _emptyCommentBox(px) {
    return (
      '<div class="report-block-box report-comment-box"><div class="report-block-title">Teacher Comment</div>' +
      '<div class="report-ruled" style="height:' +
      Math.round(px) +
      'px"></div></div>'
    );
  }

  function _itemHtml(item, cid, student, ctx, probe) {
    if (item.pair) {
      var cells = item.pair
        .map(function (p) {
          return _itemHtml(p, cid, student, ctx, probe);
        })
        .filter(Boolean);
      if (!cells.length) return '';
      if (cells.length === 1) return cells[0];
      return (
        '<div class="sheet-pair">' +
        cells
          .map(function (c) {
            return '<div class="sheet-pair-cell">' + c + '</div>';
          })
          .join('') +
        '</div>'
      );
    }
    var html = ReportBlocks.renderReportBlock(item.block, cid, student, ctx);
    var roomPx = item.room && item.room.lines ? item.room.lines * probe.linePx : 0;
    if (!html) {
      if (item.whenEmpty === 'box' && roomPx) return _emptyCommentBox(roomPx);
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
  function _footerHtml(course, report, teacher, student, n, total, side) {
    var left = [course, report, teacher].filter(Boolean).map(esc).join(' · ');
    var right = esc(student) + ' · Sheet ' + n + ' of ' + total + ' · ' + side;
    return '<div class="sheet-footer"><span>' + left + '</span><span>' + right + '</span></div>';
  }

  function _sideHtml(side, itemHtml, pinnedHtml, footer, paper, extraClass, opts) {
    var body = side
      ? side.items
          .map(function (it) {
            return '<div class="sheet-item">' + itemHtml[it.from][it.i] + '</div>';
          })
          .join('')
      : '<div class="sheet-blank">This side is left blank.</div>';
    return (
      '<div class="report-sheet' +
      (side && side.over ? ' sheet-overflow' : '') +
      (extraClass ? ' ' + extraClass : '') +
      (opts && opts.type === 'compact' ? ' compact' : '') +
      '" data-paper="' +
      paper +
      '">' +
      '<div class="sheet-body">' +
      body +
      '</div>' +
      (pinnedHtml ? '<div class="sheet-pinned">' + pinnedHtml + '</div>' : '') +
      footer +
      '</div>'
    );
  }

  /* Lays one student into sheets. Returns { html, sheets, sides, over }. */
  function _itemLabel(it) {
    if (it.pair)
      return it.pair
        .map(function (q) {
          return q.label;
        })
        .join(' and ');
    return it.label || it.block;
  }

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

    var commentItem = f.front.find(function (it) {
      return it.block === 'teacher-narrative';
    });
    var rawComment = commentItem ? ReportBlocks.renderReportBlock('teacher-narrative', cid, student, ctx) : '';
    var frontHtml = f.front.map(function (it) {
      return _itemHtml(it, cid, student, ctx, probe);
    });
    var frontLabels = f.front.map(_itemLabel);
    var backItems = f.back.filter(function (it) {
      return !it.pinned;
    });
    var pinnedItem = f.back.find(function (it) {
      return it.pinned;
    });
    var backHtml = backItems.map(function (it) {
      return _itemHtml(it, cid, student, ctx, probe);
    });
    var backLabels = backItems.map(_itemLabel);
    var pinnedHtml = pinnedItem ? _itemHtml(pinnedItem, cid, student, ctx, probe) : '';

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
    var room = commentItem && commentItem.room ? commentItem.room.lines : 0;

    var sides = pack(frontH, backH, pinnedH, cap);
    var sheetCount = Math.ceil(sides.length / 2);
    var moved = [];
    var continued = [];
    sides.forEach(function (side, idx) {
      side.items.forEach(function (it) {
        var label = it.from === 'front' ? frontLabels[frontKeep[it.i]] : backLabels[backKeep[it.i]];
        if (idx === 1 && it.from === 'front') moved.push(label);
        if (idx >= 2) continued.push(label);
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
      noComment: !!commentItem && !rawComment,
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
    var over = false;
    for (var s = 0; s < sheetCount; s++) {
      var front = sides[2 * s];
      var back = sides[2 * s + 1] || null;
      over = over || front.over || (back && back.over);
      var label = s === 0 ? 'Front' : 'Continued · front';
      html +=
        '<div class="sheet-zoom"><div class="sheet-label no-print">' +
        esc(name) +
        ' · Sheet ' +
        (s + 1) +
        ' of ' +
        sheetCount +
        ' · ' +
        label +
        '</div>' +
        _sideHtml(
          front,
          itemHtml,
          '',
          _footerHtml(course.name, ctx.termLabel, teacher, name, s + 1, sheetCount, s === 0 ? 'Front' : 'Continued'),
          paper,
          '',
          f,
        ) +
        '</div>';
      html +=
        '<div class="sheet-zoom"><div class="sheet-label no-print">' +
        esc(name) +
        ' · Sheet ' +
        (s + 1) +
        ' of ' +
        sheetCount +
        ' · Back</div>' +
        _sideHtml(
          back,
          itemHtml,
          s === 0 ? pinnedHtml : '',
          _footerHtml(course.name, ctx.termLabel, teacher, name, s + 1, sheetCount, 'Back'),
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
    form: form,
    BLOCKS: BLOCKS,
    normalizeForm: normalizeForm,
    formFor: formFor,
    moveItem: moveItem,
    moveToSide: moveToSide,
    removeItem: removeItem,
    addBlock: addBlock,
    setRoom: setRoom,
    setWhenEmpty: setWhenEmpty,
    setPinned: setPinned,
    setType: setType,
    onForm: onForm,
    available: available,
    reorder: reorder,
    pairWith: pairWith,
    canPair: canPair,
    unpair: unpair,
    starters: starters,
    starter: starter,
    templates: templates,
    saveTemplate: saveTemplate,
    removeTemplate: removeTemplate,
    template: template,
    pack: pack,
    reasonText: reasonText,
    describeStudent: describeStudent,
    fitText: fitText,
    paperSize: paperSize,
    layoutStudent: layoutStudent,
    renderPreview: renderPreview,
    summaryText: summaryText,
    clearPageStyle: clearPageStyle,
    setPageStyle: _setPageStyle,
  };
})();
