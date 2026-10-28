/* report-studio.js — Page Studio: the Progress Reports screen.
   A palette of blocks on the left and the previewed student's sides at
   paper size on the right, under the class's fit line. A block is added
   from the palette and lands in a row of its own; the selected block's
   card sits in the gutter beside the page with its Size, Lines, Move,
   Options, Leave Off and Remove. This module renders the panes;
   page-reports.js owns the state and the clicks (teacher/report-sheets.js
   is the model and the engine).
   docs/DECISIONS.md "Report forms" 8; docs/report-forms-plan.md Phase 8. */
window.ReportStudio = (function () {
  'use strict';

  var S = function () {
    return window.ReportSheets;
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The two panes. The canvas holds the fit line, the view switch and the
     preview the sheet engine fills. */
  function layoutHtml(opts) {
    opts = opts || {};
    var all = opts.view === 'all';
    return (
      '<div class="studio" id="studio">' +
      '<aside class="studio-palette no-print" id="studio-palette" aria-label="Blocks"></aside>' +
      '<div class="studio-canvas">' +
      '<div class="studio-head no-print">' +
      '<span class="studio-fit" id="studio-fit"></span>' +
      '<span class="seg seg-sm studio-view" role="radiogroup" aria-label="View">' +
      '<button type="button" class="seg-btn' +
      (all ? '' : ' active') +
      '" data-action="studioView" data-view="one" role="radio" aria-checked="' +
      !all +
      '">One Student</button>' +
      '<button type="button" class="seg-btn' +
      (all ? ' active' : '') +
      '" data-action="studioView" data-view="all" role="radio" aria-checked="' +
      all +
      '">Everyone</button>' +
      '</span></div>' +
      '<div class="rb-preview studio-pages' +
      (all ? ' studio-all' : '') +
      '" id="rb-preview"></div>' +
      '<div class="studio-live" id="studio-live" aria-live="polite"></div>' +
      '</div>' +
      '</div>'
    );
  }

  /* Where a block not on the form would land, from the class's measured
     sizes and the room left on each side for the tightest student:
     { side } for the first side with room, { after: true } for a block
     taller than a side (it prints after the report), or { reason } when
     nothing fits. sizes: ReportSheets.blockSizes; fit: the class summary
     (its perStudent[].free). Null while either is still being measured. */
  function landing(form, id, sizes, fit) {
    var sheets = S();
    if (!sizes || !sizes[id] || !fit || !fit.perStudent) return null;
    var need = sizes[id].row;
    var H = fit.sideHeight || sheets.sideHeight('letter');
    if (need > H) return { after: true };
    var ids = Object.keys(fit.perStudent);
    if (!ids.length) return null;
    for (var s = 0; s < form.sides.length; s++) {
      var free = Infinity;
      ids.forEach(function (sid) {
        var f = fit.perStudent[sid].free;
        free = Math.min(free, f && f[s] != null ? f[s] : 0);
      });
      if (need + sheets.GAP <= free || (need <= free && free === H)) return { side: s };
    }
    // Say what would make room: + Page, or Front and Back for a front-only report.
    return form.sides.length > 1
      ? {
          reason: form.sides.length > 2 ? 'No room on any page' : 'No room on either side',
          fix: 'Add a page or remove a block',
        }
      : { reason: 'No room on the Front', fix: 'Choose Front and Back' };
  }

  /* Whether a block has room on one side for every student: true, false,
     or null while the class is still being measured. A block already on
     that side always has room there (it moves within the side). */
  function fitsOn(form, id, side, sizes, fit) {
    var sheets = S();
    if (!sizes || !sizes[id] || !fit || !fit.perStudent) return null;
    var at = sheets.locate(form, id);
    if (at && at.side === side) return true;
    var need = sizes[id].row;
    var H = fit.sideHeight || sheets.sideHeight('letter');
    var free = Infinity;
    Object.keys(fit.perStudent).forEach(function (sid) {
      var f = fit.perStudent[sid].free;
      free = Math.min(free, f && f[side] != null ? f[side] : 0);
    });
    return need + sheets.GAP <= free || (need <= free && free === H);
  }

  /* { id: Side by Side height } from blockSizes, for pairsWell. */
  function halfHeights(sizes) {
    var out = {};
    Object.keys(sizes || {}).forEach(function (id) {
      if (sizes[id] && sizes[id].half) out[id] = sizes[id].half;
    });
    return out;
  }
  /* Whether a form is a template as it came: the same sides, rows, cells,
     options and pin. An edited Report Card is no longer "the" Report Card. */
  function sameLayout(a, b) {
    if (!a || !b) return false;
    return JSON.stringify([a.sides, a.pinned, a.type]) === JSON.stringify([b.sides, b.pinned, b.type]);
  }

  /* tab: 'blocks' | 'templates'. A block on the form is ticked; clicking
     it finds it on the page. A block with no room is greyed with the
     reason. */
  function paletteHtml(form, tab, templates, sizes, fit, thumbs) {
    var sheets = S();
    var on = sheets.onForm(form);
    var html =
      '<div class="seg studio-tabs" role="tablist" aria-label="Palette">' +
      '<button type="button" class="seg-btn' +
      (tab !== 'templates' ? ' active' : '') +
      '" data-action="studioTab" data-tab="blocks" role="tab" aria-selected="' +
      (tab !== 'templates') +
      '">Blocks</button>' +
      '<button type="button" class="seg-btn' +
      (tab === 'templates' ? ' active' : '') +
      '" data-action="studioTab" data-tab="templates" role="tab" aria-selected="' +
      (tab === 'templates') +
      '">Templates</button>' +
      '</div>';
    if (tab === 'templates') {
      // Each template drawn with the previewed student's real report
      // (thumbs: { id: { html, sheets } }), and how many sheets it takes.
      var card = function (attr, id, name, current) {
        var th = thumbs && thumbs[id];
        var count = th ? (th.sheets === 1 ? '1 sheet' : th.sheets + ' sheets') : '';
        return (
          '<button type="button" class="studio-blk studio-tpl' +
          (current ? ' current' : '') +
          '" data-action="studioTemplate" aria-label="' +
          esc(name) +
          '" ' +
          attr +
          '>' +
          (th ? '<span class="studio-tpl-thumbs" aria-hidden="true">' + th.html + '</span>' : '') +
          '<span class="studio-tpl-name"><span class="studio-blk-name">' +
          esc(name) +
          '</span><span class="studio-tpl-count">' +
          count +
          '</span></span></button>'
        );
      };
      html += '<h4>Starters</h4>';
      sheets.starters().forEach(function (st) {
        html += card('data-starter="' + st.id + '"', st.id, st.name, sameLayout(form, sheets.starter(st.id)));
      });
      var list = templates || [];
      html += '<h4>Your Templates</h4>';
      html += '<button type="button" class="studio-save-btn" data-action="openSaveTemplate">Save as Template</button>';
      if (!list.length) html += '<div class="studio-empty">None yet</div>';
      list.forEach(function (t) {
        html +=
          '<div class="studio-tpl-row">' +
          card('data-id="' + esc(t.id) + '"', t.id, t.name, false) +
          '<button type="button" class="studio-tpl-del" data-action="studioTemplateDelete" data-id="' +
          esc(t.id) +
          '" aria-label="Delete ' +
          esc(t.name) +
          '" title="Delete">×</button></div>';
      });
      return html;
    }
    sheets.PALETTE_GROUPS.forEach(function (group) {
      html += '<h4>' + esc(group) + '</h4>';
      Object.keys(sheets.BLOCKS).forEach(function (id) {
        var def = sheets.BLOCKS[id];
        if (def.group !== group) return;
        var placed = on.indexOf(id) >= 0;
        if (def.retired && !placed) return;
        var land = placed ? null : landing(form, id, sizes, fit);
        var nofit = !!(land && land.reason);
        html +=
          '<button type="button" class="studio-blk' +
          (placed ? ' placed' : '') +
          (nofit ? ' nofit' : '') +
          '" data-action="studioBlock" data-block="' +
          id +
          '" aria-pressed="' +
          placed +
          '"' +
          (nofit ? ' aria-disabled="true"' : '') +
          (placed ? ' title="On the report. Click to find it."' : '') +
          '>' +
          '<span class="studio-tick" aria-hidden="true">' +
          (placed ? '✓' : '') +
          '</span>' +
          '<span class="studio-blk-name">' +
          esc(def.label) +
          '</span>' +
          (nofit ? '<span class="studio-why">' + esc(land.reason) + '. ' + esc(land.fix) + '.</span>' : '') +
          '</button>';
      });
    });
    return html;
  }

  /* The class fit in one line, from ReportSheets.classSummary: the sheets
     every student needs, or how many need a second sheet (a link to
     Everyone, which leads with them). */
  function fitLineHtml(summary, form) {
    if (!summary || !summary.perStudent) return '';
    var ids = Object.keys(summary.perStudent);
    var n = ids.length;
    var students = function (k) {
      return k + (k === 1 ? ' student' : ' students');
    };
    var more = ids.filter(function (id) {
      return summary.perStudent[id].sheets > 1;
    }).length;
    var over = ids.filter(function (id) {
      return summary.perStudent[id].over;
    }).length;
    if (over) {
      return (
        '<button type="button" class="studio-fit-link" data-action="studioView" data-view="all">A block is taller than a page for ' +
        students(over) +
        '</button>'
      );
    }
    if (more) {
      var most = Math.max.apply(
        null,
        ids.map(function (id) {
          return summary.perStudent[id].sheets;
        }),
      );
      return (
        '<button type="button" class="studio-fit-link" data-action="studioView" data-view="all">' +
        most +
        ' sheets for ' +
        students(more) +
        '</button>'
      );
    }
    var frontOnly = form && form.sides.length === 1;
    if (frontOnly) {
      // One side still fits a sheet when it continues onto the back; say so.
      var cont = ids.filter(function (id) {
        return summary.perStudent[id].sides > 1;
      }).length;
      if (cont) {
        return (
          '<button type="button" class="studio-fit-link" data-action="studioView" data-view="all">Continues on the back for ' +
          students(cont) +
          '</button>'
        );
      }
    }
    return (
      (frontOnly ? 'Front only · 1 page for ' : '1 sheet for ') + (n === 1 ? '1 student' : 'all ' + n + ' students')
    );
  }

  /* Everyone leads with the students who need more than one sheet, most
     first, then the rest in roster order. summary: the class fit (or
     null, which keeps the order given). */
  function orderBySheets(students, summary) {
    if (!summary || !summary.perStudent) return students.slice();
    var sheetsOf = function (st) {
      var p = summary.perStudent[st.id];
      return p && p.sheets ? p.sheets : 1;
    };
    return students
      .map(function (st, i) {
        return { st: st, i: i, n: sheetsOf(st) };
      })
      .sort(function (a, b) {
        return b.n - a.n || a.i - b.i;
      })
      .map(function (x) {
        return x.st;
      });
  }

  /* The student whose report is longest (most measured px), for the
     default preview; null until the summary is in. */
  function longestStudent(summary) {
    if (!summary || !summary.perStudent) return null;
    var best = null;
    Object.keys(summary.perStudent).forEach(function (sid) {
      var p = summary.perStudent[sid];
      if (!best || p.used > best.used) best = { id: sid, used: p.used };
    });
    return best ? best.id : null;
  }

  /* Whether a block offers anything in the Options popover. */
  function hasOptions(id) {
    var def = S().BLOCKS[id];
    return !!def && (!!(def.options && def.options.length) || !!def.noEvidence || id === 'text-block');
  }

  function _sideName(form, s) {
    if (s === 0) return 'Front';
    if (s === 1) return 'Back';
    return 'Page ' + (s + 1);
  }

  /* The selected block's card, in the gutter beside the page: where it
     is, its Lines (fill blocks), Size (Row | Side by Side), Move Up, Move
     Down, Move to Back / Front, Options ▾, Leave Off <first name> and
     Remove. The letterhead and the pinned Response say why they don't
     move. who: { id, name } of the previewed student, or null. */
  function blockToolbarHtml(form, id, who) {
    var sheets = S();
    var def = sheets.BLOCKS[id];
    var at = sheets.locate(form, id);
    var cell = sheets.cellOf(form, id);
    if (!def || !at || !cell) return '';
    var pinned = form.pinned === id;
    var opts = sheets.optionsFor(cell);
    var html =
      '<div class="studio-bar no-print" data-block="' +
      id +
      '" role="toolbar" aria-label="' +
      esc(def.label) +
      '">' +
      '<div class="studio-bar-where">On the ' +
      esc(_sideName(form, at.side)) +
      '</div>' +
      '<div class="studio-bar-name">' +
      esc(def.label) +
      '</div>';
    if (def.fill && def.lines) {
      var n = opts.lines;
      html +=
        '<div class="studio-bar-lines"><span>' +
        esc(def.linesLabel || 'Lines') +
        '</span><span class="studio-bar-step">' +
        '<button type="button" class="studio-bar-stepbtn" data-action="studioLines" data-block="' +
        id +
        '" data-dir="-1" aria-label="Fewer lines"' +
        (n <= (def.minLines || 1) ? ' disabled' : '') +
        '>−</button>' +
        '<b>' +
        n +
        '</b>' +
        '<button type="button" class="studio-bar-stepbtn" data-action="studioLines" data-block="' +
        id +
        '" data-dir="1" aria-label="More lines"' +
        (n >= (def.maxLines || 30) ? ' disabled' : '') +
        '>+</button></span></div>';
      if (id === 'teacher-narrative') {
        html +=
          '<div class="studio-bar-hint">Room for the longest comment in the class. A student with no comment yet gets these as ruled lines.</div>';
      }
    }
    if (sheets.canHalf(id)) {
      var half = cell.size === 'half';
      html +=
        '<div class="studio-bar-size"><span>Size</span><span class="seg seg-sm" role="radiogroup" aria-label="Size">' +
        '<button type="button" class="seg-btn' +
        (half ? '' : ' active') +
        '" data-action="studioSize" data-block="' +
        id +
        '" data-size="row" role="radio" aria-checked="' +
        !half +
        '">Row</button>' +
        '<button type="button" class="seg-btn' +
        (half ? ' active' : '') +
        '" data-action="studioSize" data-block="' +
        id +
        '" data-size="half" role="radio" aria-checked="' +
        half +
        '">Side by Side</button></span></div>';
    }
    if (def.locked) html += '<div class="studio-bar-hint">Always first on the Front. Options sets what it shows.</div>';
    if (pinned) html += '<div class="studio-bar-hint">Always last on the Back.</div>';
    html += '<div class="studio-bar-acts">';
    if (!def.locked && !pinned) {
      var rows = form.sides[at.side].rows;
      var lo = at.side === 0 ? 1 : 0;
      var hi = rows.length - (form.pinned && sheets.locate(form, form.pinned).side === at.side ? 2 : 1);
      html +=
        '<button type="button" class="studio-bar-btn" data-action="studioMove" data-block="' +
        id +
        '" data-dir="-1"' +
        (at.row <= lo ? ' disabled' : '') +
        '>Move Up</button>' +
        '<button type="button" class="studio-bar-btn" data-action="studioMove" data-block="' +
        id +
        '" data-dir="1"' +
        (at.row >= hi ? ' disabled' : '') +
        '>Move Down</button>';
      if (form.sides.length > 1) {
        var to = at.side === 0 ? 1 : 0;
        html +=
          '<button type="button" class="studio-bar-btn" data-action="studioMoveSide" data-block="' +
          id +
          '" data-side="' +
          to +
          '">Move to ' +
          esc(_sideName(form, to)) +
          '</button>';
      }
    }
    if (hasOptions(id)) {
      html +=
        '<button type="button" class="studio-bar-btn" data-action="studioOptions" data-block="' +
        id +
        '" aria-haspopup="dialog" aria-expanded="false">Options ▾</button>';
    }
    if (!def.locked && who && who.id) {
      var off = sheets.hiddenFor(form, who.id).indexOf(id) >= 0;
      var first = String(who.name || '')
        .trim()
        .split(/\s+/)[0];
      html +=
        '<button type="button" class="studio-bar-btn' +
        (off ? ' active' : '') +
        '" data-action="studioLeaveOff" data-block="' +
        id +
        '" data-sid="' +
        esc(who.id) +
        '" aria-pressed="' +
        off +
        '">Leave Off' +
        (first ? ' ' + esc(first) : '') +
        '</button>';
    }
    if (!def.locked) {
      html +=
        '<button type="button" class="studio-bar-btn studio-bar-x" data-action="studioRemove" data-block="' +
        id +
        '">Remove</button>';
    }
    return html + '</div></div>';
  }

  /* The Options popover: the block's Show checkboxes, its choices, the
     no-evidence rule and the Text Block's title and text. */
  function popoverHtml(form, id, autos) {
    var sheets = S();
    var def = sheets.BLOCKS[id];
    var cell = sheets.cellOf(form, id);
    if (!def || !cell) return '';
    return (
      '<div class="studio-pop no-print" id="studio-pop" role="dialog" aria-label="' +
      esc(def.label) +
      ' Options" data-block="' +
      id +
      '">' +
      _optionsHtml(id, cell, def, autos) +
      '</div>'
    );
  }

  /* Show, choices, No Evidence and the text block's words. */
  function _optionsHtml(id, cell, def, autos) {
    var sheets = S();
    var opts = sheets.optionsFor(cell, autos || {});
    var html = '';
    if (id === 'text-block') {
      html +=
        '<div class="studio-field"><label for="studio-text-title">Title</label>' +
        '<input type="text" class="studio-text" id="studio-text-title" maxlength="80" data-action="studioText" data-block="text-block" data-key="title" value="' +
        esc((cell.options && cell.options.title) || '') +
        '">' +
        '<label for="studio-text-body">Text</label>' +
        '<textarea class="studio-text" id="studio-text-body" maxlength="1500" data-action="studioText" data-block="text-block" data-key="text">' +
        esc((cell.options && cell.options.text) || '') +
        '</textarea></div>';
    }
    (def.options || [])
      .filter(function (o) {
        return o.text;
      })
      .forEach(function (o) {
        var fid = 'studio-opt-' + id + '-' + o.key;
        html +=
          '<div class="studio-field"><label for="' +
          fid +
          '">' +
          esc(o.label) +
          '</label><input type="text" class="studio-text" id="' +
          fid +
          '" maxlength="200" data-action="studioText" data-block="' +
          id +
          '" data-key="' +
          o.key +
          '" value="' +
          esc(opts[o.key] || '') +
          '"></div>';
      });
    var bools = (def.options || []).filter(function (o) {
      return !o.choices && !o.text;
    });
    if (bools.length) {
      var auto = bools.some(function (o) {
        return o.def === 'auto';
      });
      html +=
        '<div class="studio-field"><label>Show' +
        (auto ? ' <span class="studio-field-note">(starts from the class grading setting)</span>' : '') +
        '</label><div class="studio-checks">';
      bools.forEach(function (o) {
        html +=
          '<label class="studio-check"><input type="checkbox" data-action="studioOption" data-block="' +
          id +
          '" data-key="' +
          o.key +
          '"' +
          (opts[o.key] && opts[o.key] !== 'auto' ? ' checked' : '') +
          '> ' +
          esc(o.label) +
          '</label>';
      });
      html += '</div></div>';
    }
    (def.options || [])
      .filter(function (o) {
        return o.choices;
      })
      .forEach(function (o) {
        html +=
          '<div class="studio-field"><label>' +
          esc(o.label) +
          '</label><span class="seg seg-sm" role="radiogroup" aria-label="' +
          esc(o.label) +
          '">';
        o.choices.forEach(function (choice) {
          var c = typeof choice === 'object' ? choice.v : choice;
          var text = typeof choice === 'object' ? choice.label : c === 0 ? 'None' : c;
          var on = String(opts[o.key]) === String(c);
          html +=
            '<button type="button" class="seg-btn' +
            (on ? ' active' : '') +
            '" data-action="studioChoice" data-block="' +
            id +
            '" data-key="' +
            o.key +
            '" data-value="' +
            c +
            '" role="radio" aria-checked="' +
            on +
            '">' +
            esc(text) +
            '</button>';
        });
        html += '</span></div>';
      });
    if (def.noEvidence) {
      var hide = opts.noEvidence === 'hide';
      html +=
        '<div class="studio-field"><label>When a Student Has No Evidence</label><span class="seg seg-sm" role="radiogroup" aria-label="When a student has no evidence">' +
        '<button type="button" class="seg-btn' +
        (!hide ? ' active' : '') +
        '" data-action="studioNoEvidence" data-block="' +
        id +
        '" data-rule="show" role="radio" aria-checked="' +
        !hide +
        '">Show &ldquo;No Evidence&rdquo;</button>' +
        '<button type="button" class="seg-btn' +
        (hide ? ' active' : '') +
        '" data-action="studioNoEvidence" data-block="' +
        id +
        '" data-rule="hide" role="radio" aria-checked="' +
        hide +
        '">Hide Row</button></span></div>';
    }
    return html;
  }

  /* The pages scale to the canvas, leaving the gutter for the selected
     block's card: two side by side at up to 62%, never below 45%;
     narrower than that, one above the other. */
  var GUTTER_W = 240;
  function fitZoom(canvasWidth, paper) {
    var sheetW = 8.5 * 96;
    var two = Math.min(0.62, (canvasWidth - 72 - GUTTER_W) / (2 * sheetW));
    if (two >= 0.45) return { zoom: Math.round(two * 1000) / 1000, stacked: false };
    var one = Math.min(0.62, Math.max(0.3, (canvasWidth - 40 - GUTTER_W) / sheetW));
    return { zoom: Math.round(one * 1000) / 1000, stacked: true, paper: paper };
  }

  /* "Teacher Comment, Front, row 3 of 5" for the live region. */
  function placeText(form, id) {
    var sheets = S();
    var at = sheets.locate(form, id);
    if (!at) return '';
    var rows = form.sides[at.side].rows.length;
    var partner = sheets.partnerOf(form, id);
    return (
      sheets.BLOCKS[id].label +
      ', ' +
      _sideName(form, at.side) +
      ', row ' +
      (at.row + 1) +
      ' of ' +
      rows +
      (partner ? ', beside ' + sheets.BLOCKS[partner].label : '')
    );
  }

  /* ── Where a held block would land (pure) ───────────────────────
     rows: the side's rows top to bottom in sheet px, each { top, bottom,
     cells: [{ id, size, right }], pinned?, held? } (held: the row the
     dragged block is alone in, which is not a target and not counted);
     x, y: the pointer in sheet px; opts: { lo (the first row index a drop
     may take: 1 on the Front, after the letterhead), canBeside(id) (the
     held block may pair with that lone Side by Side block) }.
     A drop lands between rows: the target is the gap under every row whose
     midpoint is above the pointer, so each gap owns the half of the block
     above it and the half of the block below it. Over the empty half of a
     row that holds one Side by Side block, the drop lands beside that
     block instead. Nothing lands after the pinned row. Returns
     { kind: 'row', index } or { kind: 'beside', target } or null. */
  function targetFor(rows, x, y, opts) {
    opts = opts || {};
    var lo = opts.lo || 0;
    var index = 0;
    var last = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.held) continue;
      if (r.pinned) break;
      if (r.cells.length === 1 && r.cells[0].size === 'half' && y >= r.top && y <= r.bottom && x > r.cells[0].right) {
        if (opts.canBeside && opts.canBeside(r.cells[0].id)) return { kind: 'beside', target: r.cells[0].id };
      }
      if (y > (r.top + r.bottom) / 2) index = last + 1;
      last++;
    }
    return { kind: 'row', index: Math.max(lo, Math.min(index, last)) };
  }

  /* A block from the palette, at its real size for the previewed student,
     shown while the pointer rests on it. */
  function peekHtml(label, who, html) {
    return (
      '<div class="studio-peek no-print" role="presentation">' +
      '<div class="studio-peek-box"><div class="studio-peek-sheet report-sheet"><div class="sheet-cell" style="width:' +
      S().ROW_W +
      'px">' +
      html +
      '</div></div></div>' +
      '<div class="studio-peek-cap">' +
      esc(label) +
      (who ? ' for ' + esc(who) : '') +
      ', at print size</div></div>'
    );
  }

  /* ── Hands on the page ───────────────────────────────────────────
     A block from the palette or the page is picked up after a 6px move
     and follows the pointer as its own rendered HTML at the canvas scale.
     While it is held, the rows under the gap it would take slide down to
     make room and a line marks the gap; over the empty half beside a lone
     Side by Side block, a slot marks the pair. Dropped on a page it lands
     there; dropped anywhere else it is let go, nothing changes. Escape
     lets go.
     api: { form(), sizes() ({ id: { row, half } } or null), insert(id,
     { side, row }), beside(id, targetId), select(id), announce(text),
     html(id, size), canHalf(id) } */
  var THRESHOLD = 6;

  function initDrag(root, api) {
    if (!root) return null;
    var ac = new AbortController();
    var signal = ac.signal;
    var sheets = S();
    var drag = null; // { id, fromPage, x, y, started, ghost, k, over, size }

    function preview() {
      return root.querySelector('.rb-preview');
    }
    function onePage() {
      var p = preview();
      return !!p && !p.classList.contains('studio-all');
    }
    function sheetScale(sheet) {
      return sheet.getBoundingClientRect().width / sheet.offsetWidth || 1;
    }
    /* The side under a point: { side, base (rows on earlier sheets of the
       same side), body, k, left, top, zoom } or null. A continued sheet
       counts as its stored side. */
    function pageAt(x, y) {
      var zooms = root.querySelectorAll(
        '.studio-pages:not(.studio-all) .sheet-zoom[data-side], .studio-pages:not(.studio-all) .sheet-zoom[data-from]',
      );
      for (var i = 0; i < zooms.length; i++) {
        var sheet = zooms[i].querySelector('.report-sheet');
        if (!sheet) continue;
        var r = sheet.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        var side = Number(zooms[i].dataset.side != null ? zooms[i].dataset.side : zooms[i].dataset.from);
        var base = 0;
        for (var j = 0; j < i; j++) {
          var zj = zooms[j];
          var from = zj.dataset.side != null ? zj.dataset.side : zj.dataset.from;
          if (Number(from) !== side) continue;
          // The held block's own row is not counted, as targetFor skips it.
          Array.prototype.forEach.call(zj.querySelectorAll('.sheet-row:not(.sheet-pinned)'), function (row) {
            var cells = row.querySelectorAll(':scope > .sheet-cell');
            if (!(drag && cells.length === 1 && cells[0].dataset.block === drag.id)) base++;
          });
        }
        var body = sheet.querySelector('.sheet-body');
        var br = body.getBoundingClientRect();
        return { side: side, base: base, body: body, k: sheetScale(sheet), left: br.left, top: br.top, zoom: zooms[i] };
      }
      return null;
    }
    function rowsOf(pg) {
      var k = pg.k;
      return Array.prototype.map.call(pg.body.querySelectorAll(':scope > .sheet-row'), function (row) {
        var rr = row.getBoundingClientRect();
        var cells = Array.prototype.map.call(row.querySelectorAll(':scope > .sheet-cell'), function (c) {
          return { id: c.dataset.block, size: c.dataset.size, right: (c.getBoundingClientRect().right - pg.left) / k };
        });
        return {
          el: row,
          top: (rr.top - pg.top) / k,
          bottom: (rr.bottom - pg.top) / k,
          cells: cells,
          pinned: row.classList.contains('sheet-pinned'),
          held: !!drag && cells.length === 1 && cells[0].id === drag.id,
        };
      });
    }
    function blockOf(el) {
      if (el.closest('.studio-bar, .studio-pop, .studio-page-add, .studio-page-empty, .studio-tpl, .studio-tpl-del'))
        return null;
      var src = el.closest(
        '.studio-blk[data-block], .studio-pages:not(.studio-all) .sheet-body .sheet-cell[data-block]',
      );
      if (!src) return null;
      var id = src.dataset.block;
      if (id === 'header' || !sheets.BLOCKS[id]) return null;
      if (src.classList.contains('nofit') || src.classList.contains('placed')) return null;
      var f = api.form();
      if (f.pinned === id) return null;
      return { id: id, el: src, fromPage: src.classList.contains('sheet-cell') };
    }
    /* The pair rule: the shorter block is at least half the taller one. */
    function pairs(a, b) {
      return sheets.pairsWell(a, b, halfHeights(api.sizes()));
    }
    function heldHeight(size) {
      var sizes = api.sizes();
      var s = sizes && sizes[drag.id];
      if (!s) return 120;
      return (size === 'half' ? s.half || s.row : s.row) || 120;
    }

    function startDrag(e) {
      drag.started = true;
      root.classList.add('studio-dragging');
      var f = api.form();
      var cell = sheets.cellOf(f, drag.id);
      drag.size = cell ? cell.size : 'row';
      var pg = pageAt(e.clientX, e.clientY) || firstPage();
      var k = pg ? pg.k : 0.6;
      var wPx = sheets.cellWidth(drag.size);
      var ghost = document.createElement('div');
      ghost.className = 'studio-ghost';
      var own = drag.fromPage
        ? root.querySelector('.studio-pages:not(.studio-all) .sheet-cell[data-block="' + drag.id + '"]')
        : null;
      ghost.innerHTML =
        '<div class="report-sheet studio-ghost-sheet" style="width:' +
        wPx +
        'px;transform:scale(' +
        k +
        ')"><div class="sheet-cell" style="width:' +
        wPx +
        'px">' +
        (own && own.innerHTML ? own.innerHTML : api.html(drag.id, drag.size)) +
        '</div></div>';
      ghost.style.width = wPx * k + 'px';
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.k = k;
      if (own) {
        var cr = own.getBoundingClientRect();
        drag.gx = (drag.x - cr.left) / k;
        drag.gy = (drag.y - cr.top) / k;
        own.classList.add('studio-held');
      } else {
        drag.gx = 24;
        drag.gy = 16;
      }
      moveDrag(e);
    }
    function firstPage() {
      var z = root.querySelector('.studio-pages:not(.studio-all) .sheet-zoom[data-side] .report-sheet');
      if (!z) return null;
      var r = z.getBoundingClientRect();
      return pageAt(r.left + 10, r.top + 10);
    }
    function clearMarks() {
      root.querySelectorAll('.sheet-row[data-slide]').forEach(function (r) {
        r.style.transform = '';
        delete r.dataset.slide;
      });
      root.querySelectorAll('.studio-drop-line, .studio-drop-slot').forEach(function (el) {
        el.remove();
      });
    }
    function moveDrag(e) {
      if (!drag.ghost) return;
      drag.ghost.style.left = e.clientX - drag.gx * (drag.k || 0.6) + 'px';
      drag.ghost.style.top = e.clientY - drag.gy * (drag.k || 0.6) + 'px';
      var pg = pageAt(e.clientX, e.clientY);
      drag.k = pg ? pg.k : drag.k;
      if (!pg) {
        drag.over = null;
        clearMarks();
        return;
      }
      var rows = rowsOf(pg);
      var x = (e.clientX - pg.left) / pg.k;
      var y = (e.clientY - pg.top) / pg.k;
      var t = targetFor(rows, x, y, {
        lo: pg.side === 0 && pg.base === 0 ? 1 : 0,
        canBeside: function (id) {
          return pairs(drag.id, id);
        },
      });
      var key = pg.side + ':' + pg.base + ':' + t.kind + ':' + (t.kind === 'row' ? t.index : t.target);
      if (drag.over && drag.over.key === key) return;
      drag.over = {
        key: key,
        side: pg.side,
        row: t.kind === 'row' ? pg.base + t.index : null,
        target: t.target || null,
      };
      clearMarks();
      if (t.kind === 'beside') {
        var row = rows.find(function (r) {
          return r.cells.length === 1 && r.cells[0].id === t.target;
        });
        if (row) {
          var slot = document.createElement('div');
          slot.className = 'studio-drop-slot';
          slot.style.left = sheets.HALF_W + sheets.GAP + 'px';
          slot.style.width = sheets.HALF_W + 'px';
          slot.style.height = row.bottom - row.top + 'px';
          row.el.appendChild(slot);
        }
        return;
      }
      // The rows from the target gap down slide by the held block's height.
      var h = heldHeight('row') + sheets.GAP;
      var live = rows.filter(function (r) {
        return !r.held;
      });
      var at = live[t.index];
      var line = document.createElement('div');
      line.className = 'studio-drop-line';
      var top = at ? at.top - sheets.GAP / 2 : live.length ? live[live.length - 1].bottom + sheets.GAP / 2 : 0;
      if (at && at.pinned) top = at.top - sheets.GAP / 2;
      line.style.top = top + 'px';
      pg.body.appendChild(line);
      live.forEach(function (r, i) {
        if (i < t.index || r.pinned) return;
        r.el.style.transform = 'translateY(' + h + 'px)';
        r.el.dataset.slide = '1';
      });
    }
    function endDrag(drop) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.ghost) d.ghost.remove();
      clearMarks();
      root.querySelectorAll('.studio-held').forEach(function (el) {
        el.classList.remove('studio-held');
      });
      root.classList.remove('studio-dragging');
      if (!drop || !d.over) {
        api.announce('Let go.');
        return;
      }
      if (d.over.target) api.beside(d.id, d.over.target);
      else api.insert(d.id, { side: d.over.side, row: d.over.row });
      api.select(d.id);
      api.announce(placeText(api.form(), d.id) + '.');
    }

    root.addEventListener(
      'pointerdown',
      function (e) {
        if (e.button !== 0 || !onePage()) return;
        var b = blockOf(e.target);
        if (!b) return;
        drag = { id: b.id, fromPage: b.fromPage, x: e.clientX, y: e.clientY, started: false, over: null };
      },
      { signal: signal },
    );
    document.addEventListener(
      'pointermove',
      function (e) {
        if (!drag) return;
        if (!drag.started) {
          if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < THRESHOLD) return;
          startDrag(e);
          return;
        }
        moveDrag(e);
      },
      { signal: signal },
    );
    document.addEventListener(
      'pointerup',
      function () {
        if (!drag) return;
        if (!drag.started) {
          drag = null;
          return;
        }
        endDrag(true);
      },
      { signal: signal },
    );
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key === 'Escape' && drag && drag.started) {
          endDrag(false);
          e.preventDefault();
        }
      },
      { signal: signal },
    );

    return {
      destroy: function () {
        ac.abort();
        if (drag && drag.ghost) drag.ghost.remove();
        clearMarks();
        root.classList.remove('studio-dragging');
        drag = null;
      },
      dragging: function () {
        return !!(drag && drag.started);
      },
    };
  }

  /* Keyboard on a focused block: Enter or Space selects it, ArrowUp /
     ArrowDown move its row, Delete removes it; the live region says where
     it is. The letterhead only selects.
     api: { form(), move(id, dir), remove(id), select(id), announce(text) } */
  function initKeys(root, api) {
    if (!root) return null;
    var ac = new AbortController();
    document.addEventListener(
      'keydown',
      function (e) {
        var cell = e.target.closest ? e.target.closest('.studio-pages .sheet-body .sheet-cell[data-block]') : null;
        if (!cell) return;
        var id = cell.dataset.block;
        if ((e.key === 'Enter' || e.key === ' ') && e.target === cell) {
          // Enter or Space selects the block and shows its card.
          e.preventDefault();
          if (api.select) api.select(id);
          return;
        }
        if (id === 'header') return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          api.move(id, e.key === 'ArrowUp' ? -1 : 1);
          api.announce(placeText(api.form(), id) + '.');
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          api.remove(id);
          api.announce(S().BLOCKS[id].label + ' removed from the report.');
        }
      },
      { signal: ac.signal },
    );
    return {
      destroy: function () {
        ac.abort();
      },
    };
  }

  return {
    layoutHtml: layoutHtml,
    paletteHtml: paletteHtml,
    landing: landing,
    fitsOn: fitsOn,
    halfHeights: halfHeights,
    sameLayout: sameLayout,
    fitLineHtml: fitLineHtml,
    longestStudent: longestStudent,
    orderBySheets: orderBySheets,
    hasOptions: hasOptions,
    blockToolbarHtml: blockToolbarHtml,
    popoverHtml: popoverHtml,
    placeText: placeText,
    fitZoom: fitZoom,
    initKeys: initKeys,
    initDrag: initDrag,
    targetFor: targetFor,
    peekHtml: peekHtml,
  };
})();
