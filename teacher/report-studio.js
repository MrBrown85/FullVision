/* report-studio.js — Page Studio: the Progress Reports screen.
   A palette of blocks on the left, the previewed student's pages at paper
   size in the middle, an inspector for the selected block on the right.
   This module renders the panes from the form (teacher/report-sheets.js)
   and the class fit; page-reports.js owns the state and the clicks.
   docs/DECISIONS.md "Report forms" 8; docs/report-forms-plan.md Phase 6. */
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

  /* The three panes. The canvas holds the preview the sheet engine fills. */
  function layoutHtml(opts) {
    opts = opts || {};
    var all = opts.view === 'all';
    return (
      '<div class="studio" id="studio">' +
      '<aside class="studio-palette no-print" id="studio-palette" aria-label="Blocks"></aside>' +
      '<div class="studio-canvas">' +
      '<div class="studio-hint no-print">' +
      '<span class="studio-hint-text">Drag a block onto a page. Drop beside another block to make a two-column row. Drag the corner handle to change its width.</span>' +
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
      '<aside class="studio-inspector no-print" id="studio-inspector" aria-label="Block"></aside>' +
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
          '" title="Delete">\u00D7</button></div>';
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

  /* The class fit, for the stats: from ReportSheets.classSummary. */
  function stats(summary) {
    var out = { longest: null, shortest: null, over: 0, blankBacks: 0, cut: 0 };
    if (!summary || !summary.perStudent) return out;
    Object.keys(summary.perStudent).forEach(function (sid) {
      var p = summary.perStudent[sid];
      var sides = p.sides || p.sheets * 2;
      var pages = { name: p.name, pages: sides, sheets: p.sheets };
      if (!out.longest || sides > out.longest.pages || (sides === out.longest.pages && p.used > out.longest.used)) {
        out.longest = Object.assign({ used: p.used }, pages);
      }
      if (!out.shortest || sides < out.shortest.pages || (sides === out.shortest.pages && p.used < out.shortest.used)) {
        out.shortest = Object.assign({ used: p.used }, pages);
      }
      if (p.over) out.over += 1;
      if (p.cut && p.cut.length) out.cut += 1;
      out.blankBacks += p.sheets * 2 - sides;
    });
    return out;
  }

  function _shortName(name) {
    var parts = String(name || '')
      .trim()
      .split(/\s+/);
    if (parts.length < 2) return name || '';
    return parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '.';
  }

  function _statRows(st) {
    var pagesOf = function (x) {
      return x ? x.pages + (x.pages === 1 ? ' page' : ' pages') + ' · ' + esc(_shortName(x.name)) : '—';
    };
    return (
      '<div class="studio-stats">' +
      '<div class="studio-stat"><span>Longest report in class</span><b>' +
      pagesOf(st.longest) +
      '</b></div>' +
      '<div class="studio-stat"><span>Shortest</span><b>' +
      pagesOf(st.shortest) +
      '</b></div>' +
      '<div class="studio-stat"><span>Blocks that overflow</span><b>' +
      st.over +
      '</b></div>' +
      '<div class="studio-stat"><span>Blank back pages added</span><b>' +
      st.blankBacks +
      '</b></div>' +
      (st.cut ? '<div class="studio-stat"><span>Over the page limit</span><b>' + st.cut + '</b></div>' : '') +
      '</div>'
    );
  }

  /* selected: a block id or null. st: stats(). who: { id, name } of the
     student on the canvas, for Leave Off. */
  function inspectorHtml(form, selected, st, who) {
    var sheets = S();
    var html = '';
    var def = selected && sheets.BLOCKS[selected];
    if (def && sheets.locate(form, selected)) {
      html +=
        '<h3 class="studio-insp-title">' +
        esc(def.label) +
        '</h3><div class="studio-insp-sub">' +
        esc(sheets.positionText(form, selected)) +
        (form.pinned === selected ? ' · pinned to the bottom' : '') +
        '</div>';
      if (!def.locked) {
        var cell = sheets.cellOf(form, selected);
        var choices = sheets.spanChoices(form, selected);
        var names = { 12: 'Full', 8: 'Two-thirds', 6: 'Half', 4: 'Third' };
        html +=
          '<div class="studio-field"><label>Width</label><span class="seg seg-sm" role="radiogroup" aria-label="Width">';
        [12, 8, 6, 4].forEach(function (span) {
          var on = cell.span === span;
          var can = choices.indexOf(span) >= 0;
          html +=
            '<button type="button" class="seg-btn' +
            (on ? ' active' : '') +
            '" data-action="studioSpan" data-block="' +
            selected +
            '" data-span="' +
            span +
            '" role="radio" aria-checked="' +
            on +
            '"' +
            (can ? '' : ' disabled') +
            '>' +
            names[span] +
            '</button>';
        });
        html += '</span></div>';
        if (def.sizable) {
          var fixed = cell.height === 'fixed';
          html +=
            '<div class="studio-field"><label>Height</label><span class="seg seg-sm" role="radiogroup" aria-label="Height">' +
            '<button type="button" class="seg-btn' +
            (!fixed ? ' active' : '') +
            '" data-action="studioHeight" data-block="' +
            selected +
            '" data-height="fit" role="radio" aria-checked="' +
            !fixed +
            '">Fit Content</button>' +
            '<button type="button" class="seg-btn' +
            (fixed ? ' active' : '') +
            '" data-action="studioHeight" data-block="' +
            selected +
            '" data-height="fixed" role="radio" aria-checked="' +
            fixed +
            '">Fixed</button></span>' +
            (fixed
              ? '<label class="studio-lines">Lines <input type="number" min="1" max="20" value="' +
                (cell.lines || 6) +
                '" data-action="studioLines" data-block="' +
                selected +
                '" aria-label="Lines"></label>'
              : '') +
            '</div>';
        }
        html += _optionsHtml(form, selected, cell, def, who);
        html +=
          '<div class="studio-field"><button type="button" class="studio-remove" data-action="studioRemove" data-block="' +
          selected +
          '">Remove from Report</button></div>';
      } else if (def.options) {
        html += _optionsHtml(form, selected, sheets.cellOf(form, selected), def, null);
      }
    } else {
      html += '<h3 class="studio-insp-title">Report</h3><div class="studio-insp-sub">Select a block on the page</div>';
    }
    html += _statRows(st || stats(null));
    return html;
  }

  /* Show, No Evidence, the text block's words and Leave Off. */
  function _optionsHtml(form, id, cell, def, who) {
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
    if (who && who.id && id !== 'header') {
      var off = sheets.hiddenFor(form, who.id).indexOf(id) >= 0;
      html +=
        '<div class="studio-field"><label>This Student</label><label class="studio-check"><input type="checkbox" data-action="studioLeaveOff" data-block="' +
        id +
        '" data-sid="' +
        esc(who.id) +
        '"' +
        (off ? ' checked' : '') +
        '> Leave off ' +
        esc(who.name) +
        '&rsquo;s report</label></div>';
    }
    return html;
  }

  /* "27 students · 54 pages · duplex safe" for the toolbar. */
  function countText(summary) {
    if (!summary || !summary.students) return '';
    var t = summary.students + (summary.students === 1 ? ' student' : ' students') + ' · ' + summary.pages + ' pages';
    if (summary.over && summary.over.length) t += ' · ' + summary.over.length + ' over';
    else t += ' · duplex safe';
    return t;
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

  /* ── Drag and drop ───────────────────────────────────────────────
     Pointer: a block from the palette, or a block on the page, is picked
     up after a short move, follows the pointer as a ghost, and drops on a
     zone drawn over the pages for every slot the form offers. The active
     zone says whether the block fits there (api.fit). The corner handle of
     the selected block drags its width to a span. Keyboard: a focused block
     is picked up with Space, moved between slots with the arrow keys,
     resized with Shift+arrows, dropped with Enter, let go with Escape; a
     live region says where it is. api: { form(), setForm(f), fit(slot, id)
     → { fits, landsOn, left }, announce(text), select(id), span(id, n),
     label(id), slots() } */
  var THRESHOLD = 6;

  function initDrag(root, api) {
    if (!root) return null;
    var ac = new AbortController();
    var signal = ac.signal;
    var sheets = S();
    var drag = null; // { id, from, x, y, started, ghost, zones, active, fit }
    var resize = null; // { id, rowRect, cell, start }
    var kb = null; // { id, slots, i }

    function blockOf(el) {
      var src = el.closest('.studio-blk[data-block], .studio-pages:not(.studio-all) .sheet-cell[data-block]');
      if (!src) return null;
      var id = src.dataset.block;
      if (id === 'header' || !sheets.BLOCKS[id]) return null;
      return { id: id, el: src, fromPage: src.classList.contains('sheet-cell') };
    }

    /* The sheet-item holding a form row, by its first block. */
    function itemFor(preview, page, row) {
      var f = api.form();
      var r = f.pages[page] && f.pages[page].rows[row];
      if (!r) return null;
      for (var i = 0; i < r.cells.length; i++) {
        var cell = preview.querySelector('.sheet-cell[data-block="' + r.cells[i].block + '"]');
        if (cell) return cell.closest('.sheet-item') || cell;
      }
      return null;
    }

    function sheetScale(sheet) {
      var rect = sheet.getBoundingClientRect();
      return rect.width / sheet.offsetWidth || 1;
    }

    /* Draws a zone per slot over the pages. */
    function buildZones(id) {
      var preview = root.querySelector('.rb-preview');
      if (!preview || preview.classList.contains('studio-all')) return [];
      var f = api.form();
      var zones = [];
      var place = function (sheet, slot, left, top, width, height, cls) {
        var z = document.createElement('div');
        z.className = 'studio-drop ' + cls;
        z.dataset.slot = JSON.stringify(slot);
        z.style.left = left + 'px';
        z.style.top = top + 'px';
        z.style.width = width + 'px';
        z.style.height = height + 'px';
        sheet.appendChild(z);
        zones.push(z);
      };
      sheets.slotsFor(f).forEach(function (slot) {
        if (slot.newPage) return;
        var item = itemFor(preview, slot.page, slot.row);
        if (!item) return;
        var row = f.pages[slot.page].rows[slot.row];
        var own = row.cells.length === 1 && row.cells[0].block === id;
        if (own && slot.side !== 'before' && slot.side !== 'after') return;
        var sheet = item.closest('.report-sheet');
        if (!sheet) return;
        var k = sheetScale(sheet);
        var sr = sheet.getBoundingClientRect();
        var ir = item.getBoundingClientRect();
        var left = (ir.left - sr.left) / k;
        var top = (ir.top - sr.top) / k;
        var width = ir.width / k;
        var height = ir.height / k;
        if (slot.side === 'before') place(sheet, slot, left, top - 9, width, 14, 'studio-drop-row');
        else if (slot.side === 'after') place(sheet, slot, left, top + height - 5, width, 14, 'studio-drop-row');
        else if (slot.side === 'left')
          place(sheet, slot, left - 6, top, Math.min(60, width / 4), height, 'studio-drop-col');
        else
          place(
            sheet,
            slot,
            left + width - Math.min(60, width / 4) + 6,
            top,
            Math.min(60, width / 4),
            height,
            'studio-drop-col',
          );
      });
      // A new page: a strip after the last page.
      var last = preview.querySelector('.sheet-student');
      if (last) {
        var z = document.createElement('div');
        z.className = 'studio-drop studio-drop-page';
        z.dataset.slot = JSON.stringify({ newPage: true });
        z.textContent = 'New page';
        last.appendChild(z);
        zones.push(z);
      }
      return zones;
    }

    function clearZones() {
      root.querySelectorAll('.studio-drop').forEach(function (z) {
        z.remove();
      });
    }

    function setActive(zone) {
      if (drag.active === zone) return;
      if (drag.active) {
        drag.active.classList.remove('active');
        if (!drag.active.classList.contains('studio-drop-page')) drag.active.textContent = '';
      }
      drag.active = zone;
      drag.fit = null;
      if (!zone) return;
      zone.classList.add('active');
      var slot = JSON.parse(zone.dataset.slot);
      var fit = api.fit(slot, drag.id);
      drag.fit = fit;
      zone.classList.toggle('no', !(fit && fit.fits));
      if (!zone.classList.contains('studio-drop-page')) zone.textContent = sheets.fitLabelFor(fit);
      else zone.textContent = fit && fit.fits ? 'New page · fits' : 'New page';
    }

    function startDrag(e) {
      drag.started = true;
      root.classList.add('studio-dragging');
      var ghost = document.createElement('div');
      ghost.className = 'studio-ghost';
      ghost.textContent = api.label(drag.id);
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.zones = buildZones(drag.id);
      moveGhost(e);
    }

    function moveGhost(e) {
      if (!drag.ghost) return;
      drag.ghost.style.left = e.clientX + 12 + 'px';
      drag.ghost.style.top = e.clientY + 8 + 'px';
    }

    function endDrag(drop) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.ghost) d.ghost.remove();
      root.classList.remove('studio-dragging');
      clearZones();
      if (drop && d.active) {
        var slot = JSON.parse(d.active.dataset.slot);
        var next = sheets.placeAt(api.form(), d.id, slot);
        api.setForm(next);
        api.select(d.id);
        api.announce(api.label(d.id) + ' placed on ' + sheets.slotText(next, slot) + '.');
      }
    }

    root.addEventListener(
      'pointerdown',
      function (e) {
        if (e.button !== 0) return;
        var handle = e.target.closest('.studio-handle');
        if (handle) {
          var cell = handle.closest('.sheet-cell');
          var rowEl = cell && cell.closest('.sheet-row');
          if (!cell || !rowEl) return;
          resize = {
            id: handle.dataset.handle,
            rowRect: rowEl.getBoundingClientRect(),
            cell: cell,
            cellRect: cell.getBoundingClientRect(),
          };
          e.preventDefault();
          return;
        }
        var b = blockOf(e.target);
        if (!b) return;
        drag = { id: b.id, fromPage: b.fromPage, x: e.clientX, y: e.clientY, started: false, active: null };
      },
      { signal: signal },
    );

    document.addEventListener(
      'pointermove',
      function (e) {
        if (resize) {
          var r = resize.rowRect;
          var frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          var onLeft = resize.cellRect.left - r.left < r.width / 2;
          var span = onLeft
            ? frac < 0.42
              ? 4
              : frac < 0.58
                ? 6
                : frac < 0.92
                  ? 8
                  : 12
            : 1 - frac < 0.42
              ? 4
              : 1 - frac < 0.58
                ? 6
                : 1 - frac < 0.92
                  ? 8
                  : 12;
          resize.span = span;
          resize.cell.dataset.spanPreview = span;
          return;
        }
        if (!drag) return;
        if (!drag.started) {
          if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < THRESHOLD) return;
          startDrag(e);
        }
        moveGhost(e);
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var zone = under && under.closest ? under.closest('.studio-drop') : null;
        setActive(zone);
      },
      { signal: signal },
    );

    document.addEventListener(
      'pointerup',
      function () {
        if (resize) {
          var rz = resize;
          resize = null;
          delete rz.cell.dataset.spanPreview;
          if (rz.span) api.span(rz.id, rz.span);
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
        if (e.key === 'Escape' && drag && drag.started) {
          endDrag(false);
          api.announce('Let go.');
          return;
        }
        var cell = e.target.closest ? e.target.closest('.studio-pages .sheet-cell[data-block]') : null;
        if (!cell) return;
        var id = cell.dataset.block;
        if (id === 'header') return;
        var f = api.form();
        if (kb && kb.id === id) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            kb.i = Math.min(kb.slots.length - 1, kb.i + 1);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            kb.i = Math.max(0, kb.i - 1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            var slot = kb.slots[kb.i];
            kb = null;
            var next = sheets.placeAt(f, id, slot);
            api.setForm(next);
            api.select(id);
            api.announce(api.label(id) + ' placed on ' + sheets.slotText(next, slot) + '.');
            e.preventDefault();
            return;
          } else if (e.key === 'Escape') {
            kb = null;
            api.announce('Let go. ' + api.label(id) + ' stays on ' + sheets.positionText(f, id).toLowerCase() + '.');
            e.preventDefault();
            return;
          } else return;
          e.preventDefault();
          var sl = kb.slots[kb.i];
          var fit = api.fit(sl, id);
          api.announce(
            api.label(id) +
              ', ' +
              sheets.slotText(f, sl) +
              (fit ? (fit.fits ? ', fits' : ', lands on page ' + fit.landsOn) : '') +
              '.',
          );
          return;
        }
        if (e.key === ' ') {
          e.preventDefault();
          var slots = sheets.slotsFor(f).filter(function (sl) {
            if (sl.newPage) return true;
            var row = f.pages[sl.page].rows[sl.row];
            return !(
              row.cells.length === 1 &&
              row.cells[0].block === id &&
              sl.side !== 'before' &&
              sl.side !== 'after'
            );
          });
          var at = sheets.locate(f, id);
          var start = 0;
          slots.forEach(function (sl, i) {
            if (!sl.newPage && sl.page === at.page && sl.row === at.row && sl.side === 'after') start = i;
          });
          kb = { id: id, slots: slots, i: start };
          api.announce(
            'Picked up ' +
              api.label(id) +
              '. Arrow keys move it, Shift with an arrow resizes it, Enter drops it, Escape lets go.',
          );
          return;
        }
        if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          var choices = sheets.spanChoices(f, id);
          var cur = sheets.cellOf(f, id).span;
          var idx = choices.indexOf(cur);
          var ni = e.key === 'ArrowRight' ? Math.min(choices.length - 1, idx + 1) : Math.max(0, idx - 1);
          // choices run full → third; ArrowRight widens, so step the other way
          ni = e.key === 'ArrowRight' ? Math.max(0, idx - 1) : Math.min(choices.length - 1, idx + 1);
          if (choices[ni] !== cur) api.span(id, choices[ni]);
          else api.announce(api.label(id) + ' is already ' + spanWord(cur) + '.');
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          api.remove(id);
        }
      },
      { signal: signal },
    );

    return {
      destroy: function () {
        ac.abort();
        clearZones();
        if (drag && drag.ghost) drag.ghost.remove();
        drag = null;
        kb = null;
      },
      picking: function () {
        return kb ? kb.id : null;
      },
    };
  }

  function spanWord(span) {
    return { 12: 'full width', 8: 'two-thirds', 6: 'half width', 4: 'a third' }[span] || 'full width';
  }

  return {
    layoutHtml: layoutHtml,
    paletteHtml: paletteHtml,
    inspectorHtml: inspectorHtml,
    stats: stats,
    countText: countText,
    sizeBadge: sizeBadge,
    fitZoom: fitZoom,
    initDrag: initDrag,
    spanWord: spanWord,
  };
})();
