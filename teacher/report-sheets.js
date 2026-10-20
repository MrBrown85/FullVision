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

  function form() {
    return FORM_REPORT_CARD;
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

  function _sideHtml(side, itemHtml, pinnedHtml, footer, paper, extraClass) {
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
    var result = {
      sheets: sheetCount,
      sides: sides.length,
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
    var stage = _stage(preview, contentW);
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
        var r = layoutStudent(opts.cid, st, opts.ctx, { form: opts.form, paper: paper, stage: stage, probe: probe });
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
    var stage = _stage(document.body, contentW);
    try {
      var probe = _probe(stage);
      var r = layoutStudent(cid, student, ctx, { form: opts.form, paper: paper, stage: stage, probe: probe });
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
