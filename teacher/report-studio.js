/* report-studio.js — Page Studio: the Progress Reports screen.
   A palette of blocks on the left and the previewed student's pages at
   paper size on the right, under the class's fit line. A block is picked
   up and dropped on the page grid, sized by its handles, and carries a
   small toolbar: Options, Leave Off, Remove. This module renders the
   panes and runs the pointer and keyboard work; page-reports.js owns the
   state and the clicks (teacher/report-sheets.js is the model).
   docs/DECISIONS.md "Report forms" 8; docs/report-forms-plan.md Phase 7. */
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

  /* S ≤ 120 px, M ≤ 300, L ≤ 600, else XL. Unknown: an em dash. */
  function sizeBadge(px) {
    if (!(px > 0)) return '—';
    if (px <= 120) return 'S';
    if (px <= 300) return 'M';
    if (px <= 600) return 'L';
    return 'XL';
  }

  /* tab: 'blocks' | 'templates'. sizes: { blockId: px } once measured.
     A block on the form is dimmed; clicking it selects it on the page. */
  function paletteHtml(form, sizes, tab, templates) {
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
      html += '<h4>Starters</h4>';
      sheets.starters().forEach(function (st) {
        html +=
          '<button type="button" class="studio-blk studio-tpl" data-action="studioTemplate" data-starter="' +
          st.id +
          '"><span class="studio-blk-name">' +
          esc(st.name) +
          '</span></button>';
      });
      var list = templates || [];
      html += '<h4>Your Templates</h4>';
      html += '<button type="button" class="studio-save-btn" data-action="openSaveTemplate">Save as Template</button>';
      if (!list.length) html += '<div class="studio-empty">None yet</div>';
      list.forEach(function (t) {
        html +=
          '<div class="studio-tpl-row">' +
          '<button type="button" class="studio-blk studio-tpl" data-action="studioTemplate" data-id="' +
          esc(t.id) +
          '"><span class="studio-blk-name">' +
          esc(t.name) +
          '</span></button>' +
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
        html +=
          '<button type="button" class="studio-blk' +
          (placed ? ' placed' : '') +
          '" data-action="studioBlock" data-block="' +
          id +
          '" draggable="false" aria-pressed="' +
          placed +
          '">' +
          '<span class="studio-grip" aria-hidden="true">⠿</span>' +
          '<span class="studio-blk-name">' +
          esc(def.label) +
          '</span><span class="studio-sz">' +
          sizeBadge(sizes && sizes[id]) +
          '</span></button>';
      });
    });
    return html;
  }

  /* The class fit in one line, from ReportSheets.classSummary: every
     student fits, some push a block past its page (a link to Everyone),
     or, with a Pages cap, some are cut. */
  function fitLineHtml(summary) {
    if (!summary || !summary.perStudent) return '';
    var ids = Object.keys(summary.perStudent);
    var n = ids.length;
    var some = function (key) {
      return ids.filter(function (id) {
        var list = summary.perStudent[id][key];
        return list && list.length;
      }).length;
    };
    var students = function (k) {
      return k + (k === 1 ? ' student' : ' students');
    };
    var cut = some('cut');
    if (cut) return '<span class="studio-fit-cut">Cut for ' + students(cut) + '</span>';
    var pushed = some('pushed');
    if (pushed) {
      return (
        '<button type="button" class="studio-fit-link" data-action="studioView" data-view="all">Pushes past the page for ' +
        students(pushed) +
        '</button>'
      );
    }
    return 'Fits for ' + n + ' of ' + students(n);
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

  /* The small toolbar above the selected block: Options ▾ (blocks with
     options), Leave Off <first name> (a toggle; not the letterhead) and ×
     Remove (not the letterhead). who: { id, name } of the previewed
     student, or null in Everyone view. */
  function blockToolbarHtml(form, id, who) {
    var sheets = S();
    var def = sheets.BLOCKS[id];
    if (!def || !sheets.locate(form, id)) return '';
    var html =
      '<div class="studio-bar no-print" data-block="' + id + '" role="toolbar" aria-label="' + esc(def.label) + '">';
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
        '" aria-label="Remove ' +
        esc(def.label) +
        '" title="Remove">×</button>';
    }
    return html + '</div>';
  }

  /* The Options popover: the block's Show checkboxes, its choices, the
     no-evidence rule and the Text Block's title and text. */
  function popoverHtml(form, id) {
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
      _optionsHtml(id, cell, def) +
      '</div>'
    );
  }

  /* Show, choices, No Evidence and the text block's words. */
  function _optionsHtml(id, cell, def) {
    var sheets = S();
    var opts = sheets.optionsFor(cell);
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
    var bools = (def.options || []).filter(function (o) {
      return !o.choices;
    });
    if (bools.length) {
      html += '<div class="studio-field"><label>Show</label><div class="studio-checks">';
      bools.forEach(function (o) {
        html +=
          '<label class="studio-check"><input type="checkbox" data-action="studioOption" data-block="' +
          id +
          '" data-key="' +
          o.key +
          '"' +
          (opts[o.key] ? ' checked' : '') +
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
        o.choices.forEach(function (c) {
          var on = Number(opts[o.key]) === c;
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
            (c === 0 ? 'None' : c) +
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

  /* The pages scale to the canvas: two side by side at up to 62%, never
     below 45%; narrower than that, one above the other. */
  function fitZoom(canvasWidth, paper) {
    var sheetW = 8.5 * 96;
    var two = Math.min(0.62, (canvasWidth - 72) / (2 * sheetW));
    if (two >= 0.45) return { zoom: Math.round(two * 1000) / 1000, stacked: false };
    var one = Math.min(0.62, Math.max(0.3, (canvasWidth - 40) / sheetW));
    return { zoom: Math.round(one * 1000) / 1000, stacked: true, paper: paper };
  }

  /* "Teacher Comment, page 1, columns 7 to 12, rows 10 to 17" for the
     live region. */
  function placeText(form, id) {
    var sheets = S();
    var at = sheets.locate(form, id);
    var b = sheets.cellOf(form, id);
    if (!at || !b) return '';
    var h = b.h != null ? b.h : sheets.BLOCKS[id].rows;
    return (
      sheets.BLOCKS[id].label +
      ', page ' +
      (at.page + 1) +
      ', columns ' +
      (b.x + 1) +
      ' to ' +
      (b.x + b.w) +
      ', rows ' +
      (b.y + 1) +
      ' to ' +
      (b.y + h)
    );
  }

  /* ── Hands on the page ───────────────────────────────────────────
     Pointer: a block from the palette or the page is picked up after a
     6px move and follows the pointer as its own rendered HTML at the
     canvas scale; while it is held the pages show the grid, a placeholder
     snaps to the cell under the pointer and the blocks it would shove
     slide down to show the result. Dropped on a page it is placed or
     moved there; dropped on the grey field, a block from the page is
     removed; Escape lets go. The selected block's handles (right edge,
     bottom edge, corner) drag its width and height with a chip saying
     "6 × 12". Keyboard: a focused block moves one cell with the arrow
     keys, resizes with Shift and an arrow, is removed with Delete; the
     live region says where it is.
     api: { form(), place(id, rect), move(id, to), resize(id, size),
     remove(id), select(id), announce(text), html(id, w), rows() } */
  var THRESHOLD = 6;

  function initDrag(root, api) {
    if (!root) return null;
    var ac = new AbortController();
    var signal = ac.signal;
    var sheets = S();
    var drag = null; // { id, fromPage, w, h, x, y, gx, gy, started, ghost, hold, over }
    var resize = null; // { id, cell, body, kind, x0, y0, w0, h0, bx, by, k, w, h, box, chip }

    var COLS = sheets.COLS;
    var ROW = sheets.ROW_PX;

    function unit(contentW) {
      return (contentW + sheets.GUTTER) / COLS;
    }
    function sheetScale(sheet) {
      return sheet.getBoundingClientRect().width / sheet.offsetWidth || 1;
    }
    function preview() {
      return root.querySelector('.rb-preview');
    }
    function onePage() {
      var p = preview();
      return !!p && !p.classList.contains('studio-all');
    }
    /* The form page under a point: { page, body, sheet, k, left, top,
       contentW } or null (the grey field, a continued page). */
    function pageAt(x, y) {
      var zooms = root.querySelectorAll('.studio-pages:not(.studio-all) .sheet-zoom[data-page]');
      for (var i = 0; i < zooms.length; i++) {
        var sheet = zooms[i].querySelector('.report-sheet');
        if (!sheet) continue;
        var r = sheet.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        var k = sheetScale(sheet);
        var body = sheet.querySelector('.sheet-body');
        var br = body.getBoundingClientRect();
        return {
          page: Number(zooms[i].dataset.page),
          sheet: sheet,
          body: body,
          k: k,
          left: br.left,
          top: br.top,
          contentW: body.offsetWidth,
        };
      }
      return null;
    }
    function cellOnPage(id) {
      return root.querySelector('.studio-pages:not(.studio-all) .sheet-body > .sheet-cell[data-block="' + id + '"]');
    }

    function blockOf(el) {
      if (el.closest('.studio-bar, .studio-pop, .studio-handle, .studio-page-add, .studio-page-empty')) return null;
      var src = el.closest(
        '.studio-blk[data-block], .studio-pages:not(.studio-all) .sheet-body > .sheet-cell[data-block]',
      );
      if (!src) return null;
      var id = src.dataset.block;
      if (id === 'header' || !sheets.BLOCKS[id]) return null;
      return { id: id, el: src, fromPage: src.classList.contains('sheet-cell') };
    }

    function startDrag(e) {
      drag.started = true;
      root.classList.add('studio-dragging', 'studio-grid-on');
      var f = api.form();
      var b = sheets.cellOf(f, drag.id);
      drag.w = b ? b.w : COLS;
      drag.h = b ? b.h : sheets.BLOCKS[drag.id].rows;
      // The ghost is the block as rendered, at the canvas scale.
      var pg = pageAt(e.clientX, e.clientY) || firstPage();
      var k = pg ? pg.k : 0.6;
      var contentW = pg ? pg.contentW : sheets.contentWidth('letter');
      var wPx = drag.w * unit(contentW) - sheets.GUTTER;
      var ghost = document.createElement('div');
      ghost.className = 'studio-ghost';
      ghost.innerHTML =
        '<div class="report-sheet studio-ghost-sheet" style="width:' +
        wPx +
        'px;transform:scale(' +
        k +
        ')"><div class="sheet-cell" style="width:' +
        wPx +
        'px">' +
        (drag.fromPage && cellOnPage(drag.id) ? cellOnPage(drag.id).innerHTML : api.html(drag.id, drag.w)) +
        '</div></div>';
      ghost.style.width = wPx * k + 'px';
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.k = k;
      // Where the pointer holds the block, in grid units.
      if (drag.fromPage && cellOnPage(drag.id)) {
        var cr = cellOnPage(drag.id).getBoundingClientRect();
        drag.gx = (drag.x - cr.left) / k;
        drag.gy = (drag.y - cr.top) / k;
      } else {
        drag.gx = 24;
        drag.gy = 16;
      }
      var hold = document.createElement('div');
      hold.className = 'studio-place';
      drag.hold = hold;
      moveDrag(e);
    }

    function firstPage() {
      var z = root.querySelector('.studio-pages:not(.studio-all) .sheet-zoom[data-page] .report-sheet');
      if (!z) return null;
      var r = z.getBoundingClientRect();
      return pageAt(r.left + 10, r.top + 10);
    }

    function clearShove() {
      root.querySelectorAll('.sheet-cell[data-shove]').forEach(function (c) {
        c.style.transform = '';
        delete c.dataset.shove;
      });
    }

    function moveDrag(e) {
      if (!drag.ghost) return;
      drag.ghost.style.left = e.clientX - drag.gx * (drag.k || 0.6) + 'px';
      drag.ghost.style.top = e.clientY - drag.gy * (drag.k || 0.6) + 'px';
      var pg = pageAt(e.clientX, e.clientY);
      drag.k = pg ? pg.k : drag.k;
      drag.ghost.classList.toggle('out', !pg && drag.fromPage);
      if (!pg) {
        drag.over = null;
        if (drag.hold.parentNode) drag.hold.remove();
        clearShove();
        return;
      }
      var u = unit(pg.contentW);
      var px = (e.clientX - pg.left) / pg.k - drag.gx;
      var py = (e.clientY - pg.top) / pg.k - drag.gy;
      var x = Math.max(0, Math.min(COLS - drag.w, Math.round(px / u)));
      var y = Math.max(0, Math.min(api.rows() - 2, Math.round(py / ROW)));
      if (drag.over && drag.over.page === pg.page && drag.over.x === x && drag.over.y === y) return;
      drag.over = { page: pg.page, x: x, y: y };
      drag.hold.style.left = x * u + 'px';
      drag.hold.style.top = y * ROW + 'px';
      drag.hold.style.width = drag.w * u - sheets.GUTTER + 'px';
      drag.hold.style.height = drag.h * ROW + 'px';
      if (drag.hold.parentNode !== pg.body) pg.body.appendChild(drag.hold);
      // What the drop would shove: each block's new row against where it sits.
      clearShove();
      var f = api.form();
      var next = sheets.place(f, drag.id, { page: pg.page, x: x, y: y, w: drag.w, h: drag.h });
      (next.pages[pg.page] || { blocks: [] }).blocks.forEach(function (b) {
        if (b.block === drag.id) return;
        var cell = pg.body.querySelector('.sheet-cell[data-block="' + b.block + '"]');
        if (!cell) return;
        var dy = b.y - Number(cell.dataset.y);
        if (dy > 0) {
          cell.style.transform = 'translateY(' + dy * ROW + 'px)';
          cell.dataset.shove = '1';
        }
      });
    }

    function endDrag(drop) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.ghost) d.ghost.remove();
      if (d.hold && d.hold.parentNode) d.hold.remove();
      clearShove();
      root.classList.remove('studio-dragging', 'studio-grid-on');
      if (!drop) {
        api.announce('Let go.');
        return;
      }
      if (d.over) {
        if (d.fromPage) api.move(d.id, { page: d.over.page, x: d.over.x, y: d.over.y });
        else api.place(d.id, { page: d.over.page, x: d.over.x, y: d.over.y, w: d.w, h: d.h });
        api.select(d.id);
        api.announce(placeText(api.form(), d.id) + '.');
      } else if (d.fromPage) {
        api.remove(d.id);
      }
    }

    /* Resize by a handle: the outline snaps to columns and rows and a
       chip says the size; the form takes it on release. */
    function startResize(handle, e) {
      var cell = handle.closest('.sheet-cell');
      var body = cell && cell.closest('.sheet-body');
      var sheet = cell && cell.closest('.report-sheet');
      if (!cell || !body || !sheet) return;
      var k = sheetScale(sheet);
      var box = document.createElement('div');
      box.className = 'studio-place studio-resizing';
      box.style.left = cell.style.left;
      box.style.top = cell.style.top;
      var chip = document.createElement('div');
      chip.className = 'studio-chip';
      resize = {
        id: cell.dataset.block,
        cell: cell,
        body: body,
        kind: handle.dataset.handle,
        x0: e.clientX,
        y0: e.clientY,
        w0: Number(cell.dataset.w),
        h0: Number(cell.dataset.h),
        bx: Number(cell.dataset.x),
        k: k,
        contentW: body.offsetWidth,
        box: box,
        chip: chip,
      };
      resize.w = resize.w0;
      resize.h = resize.h0;
      root.classList.add('studio-grid-on');
      body.appendChild(box);
      preview().appendChild(chip);
      moveResize(e);
    }
    function moveResize(e) {
      var r = resize;
      var u = unit(r.contentW);
      var w = r.w0;
      var h = r.h0;
      if (r.kind !== 's') w = Math.round(r.w0 + (e.clientX - r.x0) / r.k / u);
      if (r.kind !== 'e') h = Math.round(r.h0 + (e.clientY - r.y0) / r.k / ROW);
      r.w = Math.max(3, Math.min(COLS - r.bx, w));
      r.h = Math.max(2, h);
      r.box.style.width = r.w * u - sheets.GUTTER + 'px';
      r.box.style.height = r.h * ROW + 'px';
      r.chip.textContent = r.w + ' × ' + r.h;
      var pr = preview().getBoundingClientRect();
      r.chip.style.left = e.clientX - pr.left + preview().scrollLeft + 14 + 'px';
      r.chip.style.top = e.clientY - pr.top + preview().scrollTop + 14 + 'px';
    }
    function endResize(apply) {
      var r = resize;
      resize = null;
      r.box.remove();
      r.chip.remove();
      root.classList.remove('studio-grid-on');
      if (apply && (r.w !== r.w0 || r.h !== r.h0)) {
        api.resize(r.id, { w: r.w, h: r.h });
        api.announce(placeText(api.form(), r.id) + '.');
      }
    }

    root.addEventListener(
      'pointerdown',
      function (e) {
        if (e.button !== 0 || !onePage()) return;
        var handle = e.target.closest('.studio-handle');
        if (handle) {
          startResize(handle, e);
          e.preventDefault();
          return;
        }
        var b = blockOf(e.target);
        if (!b) return;
        drag = { id: b.id, fromPage: b.fromPage, x: e.clientX, y: e.clientY, started: false, over: null };
      },
      { signal: signal },
    );

    document.addEventListener(
      'pointermove',
      function (e) {
        if (resize) {
          moveResize(e);
          return;
        }
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
        if (resize) {
          endResize(true);
          return;
        }
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
        if (e.key === 'Escape') {
          if (drag && drag.started) {
            endDrag(false);
            e.preventDefault();
            return;
          }
          if (resize) {
            endResize(false);
            e.preventDefault();
            return;
          }
        }
        var cell = e.target.closest ? e.target.closest('.studio-pages .sheet-body > .sheet-cell[data-block]') : null;
        if (!cell || !onePage()) return;
        var id = cell.dataset.block;
        if (id === 'header') return;
        var f = api.form();
        var b = sheets.cellOf(f, id);
        var at = sheets.locate(f, id);
        if (!b || !at) return;
        var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[e.key]) {
          e.preventDefault();
          var d = arrows[e.key];
          if (e.shiftKey) api.resize(id, { w: b.w + d[0], h: (b.h != null ? b.h : sheets.BLOCKS[id].rows) + d[1] });
          else api.move(id, { page: at.page, x: b.x + d[0], y: Math.max(0, b.y + d[1]) });
          api.announce(placeText(api.form(), id) + '.');
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          api.remove(id);
          api.announce(sheets.BLOCKS[id].label + ' removed from the report.');
        }
      },
      { signal: signal },
    );

    return {
      destroy: function () {
        ac.abort();
        if (drag && drag.ghost) drag.ghost.remove();
        if (drag && drag.hold && drag.hold.parentNode) drag.hold.remove();
        if (resize) endResize(false);
        clearShove();
        root.classList.remove('studio-dragging', 'studio-grid-on');
        drag = null;
      },
      dragging: function () {
        return !!(drag && drag.started) || !!resize;
      },
    };
  }

  return {
    layoutHtml: layoutHtml,
    paletteHtml: paletteHtml,
    fitLineHtml: fitLineHtml,
    longestStudent: longestStudent,
    hasOptions: hasOptions,
    blockToolbarHtml: blockToolbarHtml,
    popoverHtml: popoverHtml,
    placeText: placeText,
    sizeBadge: sizeBadge,
    fitZoom: fitZoom,
    initDrag: initDrag,
  };
})();
