/* report-studio.js — Page Studio: the Progress Reports screen.
   A palette of blocks on the left, the previewed student's pages at paper
   size in the middle under the class's fit line, an inspector for the
   selected block's options on the right.
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

  /* The three panes. The canvas holds the fit line, the view switch and
     the preview the sheet engine fills. */
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

  /* selected: a block id or null. who: { id, name } of the student on the
     canvas, for Leave Off. */
  function inspectorHtml(form, selected, who) {
    var sheets = S();
    var html = '';
    var def = selected && sheets.BLOCKS[selected];
    if (def && sheets.locate(form, selected)) {
      html += '<h3 class="studio-insp-title">' + esc(def.label) + '</h3>';
      var cell = sheets.cellOf(form, selected);
      if (!def.locked) {
        html += _optionsHtml(form, selected, cell, def, who);
        html +=
          '<div class="studio-field"><button type="button" class="studio-remove" data-action="studioRemove" data-block="' +
          selected +
          '">Remove from Report</button></div>';
      } else if (def.options) {
        html += _optionsHtml(form, selected, cell, def, null);
      }
    } else {
      html += '<h3 class="studio-insp-title">Report</h3><div class="studio-insp-sub">Select a block on the page</div>';
    }
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
    fitLineHtml: fitLineHtml,
    sizeBadge: sizeBadge,
    fitZoom: fitZoom,
  };
})();
