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
    return { reason: form.sides.length > 1 ? 'No room on either side' : 'No room on the Front' };
  }

  /* tab: 'blocks' | 'templates'. A block on the form is ticked; clicking
     it finds it on the page. A block with no room is greyed with the
     reason. */
  function paletteHtml(form, tab, templates, sizes, fit) {
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
          (nofit ? '<span class="studio-why">' + esc(land.reason) + '</span>' : '') +
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
  var GUTTER_W = 220;
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

  /* Keyboard on a focused block: ArrowUp / ArrowDown move its row, Delete
     removes it; the live region says where it is.
     api: { form(), move(id, dir), remove(id), announce(text) } */
  function initKeys(root, api) {
    if (!root) return null;
    var ac = new AbortController();
    document.addEventListener(
      'keydown',
      function (e) {
        var cell = e.target.closest ? e.target.closest('.studio-pages .sheet-body .sheet-cell[data-block]') : null;
        if (!cell) return;
        var id = cell.dataset.block;
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
    fitLineHtml: fitLineHtml,
    longestStudent: longestStudent,
    hasOptions: hasOptions,
    blockToolbarHtml: blockToolbarHtml,
    popoverHtml: popoverHtml,
    placeText: placeText,
    fitZoom: fitZoom,
    initKeys: initKeys,
  };
})();
