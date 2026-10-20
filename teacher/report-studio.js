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
          '<button type="button" class="studio-blk" data-action="studioTemplate" data-starter="' +
          st.id +
          '"><span class="studio-blk-name">' +
          esc(st.name) +
          '</span></button>';
      });
      var list = templates || [];
      html += '<h4>Your Templates</h4>';
      if (!list.length) html += '<div class="studio-empty">None yet</div>';
      list.forEach(function (t) {
        html +=
          '<button type="button" class="studio-blk" data-action="studioTemplate" data-id="' +
          esc(t.id) +
          '"><span class="studio-blk-name">' +
          esc(t.name) +
          '</span></button>';
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
    var out = { longest: null, shortest: null, over: 0, blankBacks: 0 };
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
      '</div>'
    );
  }

  /* selected: a block id or null. st: stats(). */
  function inspectorHtml(form, selected, st) {
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
        html +=
          '<div class="studio-field"><button type="button" class="studio-remove" data-action="studioRemove" data-block="' +
          selected +
          '">Remove from Report</button></div>';
      }
    } else {
      html += '<h3 class="studio-insp-title">Report</h3><div class="studio-insp-sub">Select a block on the page</div>';
    }
    html += _statRows(st || stats(null));
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

  return {
    layoutHtml: layoutHtml,
    paletteHtml: paletteHtml,
    inspectorHtml: inspectorHtml,
    stats: stats,
    countText: countText,
    sizeBadge: sizeBadge,
    fitZoom: fitZoom,
  };
})();
